/**
 * Replay of a recorded session through the same merge and snapshot code the live feed uses.
 *
 * `ReplayEngine` is pure: it is given parsed changes and answers "what did the feeds say at time t". Playing,
 * pausing and speed belong to whoever drives it (the service), so that is testable without a clock.
 */
import { mergeDelta, type RawFeedState } from '../../../shared/f1/live/merge.ts'
import { buildSnapshot, type LiveSnapshot } from '../../../shared/f1/live/snapshot.ts'
import type { LiveCar } from '../../../shared/f1/live/stream-types.ts'
import { lastAtOrBefore, type CarPoint, type CarTelemetryPoint, type TimedChange } from './archive.ts'

export interface ReplayData {
  /** Changes per feed, each ascending in time. */
  feeds: Record<string, TimedChange[]>
  /** The one-piece SessionInfo document, when the archive has it. */
  sessionInfo: unknown | null
  positions: Map<string, CarPoint[]>
  telemetry: Map<string, CarTelemetryPoint[]>
}

export type ReplayCar = LiveCar

interface Flat {
  t: number
  feed: string
  data: unknown
}

const CHECKPOINT_EVERY_MS = 60_000
/** Cars are shown at their last known position unless that reading is older than this. */
const MAX_POSITION_AGE_MS = 5_000

export class ReplayEngine {
  readonly durationMs: number
  private readonly events: Flat[]
  private readonly checkpoints: { index: number; state: RawFeedState }[] = []
  private cursor = { index: 0, state: {} as RawFeedState }

  private readonly data: ReplayData

  constructor(data: ReplayData) {
    this.data = data
    const flat: Flat[] = []
    for (const [feed, list] of Object.entries(data.feeds)) for (const c of list) flat.push({ t: c.t, feed, data: c.data })
    flat.sort((a, b) => a.t - b.t)
    this.events = flat
    let last = flat.length ? flat[flat.length - 1].t : 0
    for (const pts of data.positions.values()) if (pts.length) last = Math.max(last, pts[pts.length - 1].t)
    this.durationMs = last
    this.cursor = { index: 0, state: this.initial() }
    this.buildCheckpoints()
  }

  private initial(): RawFeedState {
    return this.data.sessionInfo ? { SessionInfo: this.data.sessionInfo } : {}
  }

  private buildCheckpoints(): void {
    let state = this.initial()
    let next = 0
    this.checkpoints.push({ index: 0, state })
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]
      if (e.t >= next + CHECKPOINT_EVERY_MS) {
        next = e.t - (e.t % CHECKPOINT_EVERY_MS)
        this.checkpoints.push({ index: i, state })
      }
      state = { ...state, [e.feed]: mergeDelta(state[e.feed], e.data) }
    }
  }

  /** The merged feed state as it stood at `t`. Moving forward from the last answer is cheap; moving back restarts at a checkpoint. */
  stateAt(t: number): RawFeedState {
    let { index, state } = this.cursor
    const prevT = index > 0 ? this.events[index - 1].t : -1
    if (t < prevT) {
      // Backwards: the nearest checkpoint at or before the target.
      let cp = this.checkpoints[0]
      for (const c of this.checkpoints) if (this.events[c.index]?.t <= t) cp = c
      index = cp.index
      state = cp.state
    }
    while (index < this.events.length && this.events[index].t <= t) {
      const e = this.events[index]
      state = { ...state, [e.feed]: mergeDelta(state[e.feed], e.data) }
      index += 1
    }
    this.cursor = { index, state }
    return state
  }

  snapshotAt(t: number): LiveSnapshot {
    return buildSnapshot(this.stateAt(t))
  }

  carsAt(t: number): ReplayCar[] {
    const out: ReplayCar[] = []
    for (const [number, pts] of this.data.positions) {
      const i = lastAtOrBefore(pts, t)
      if (i < 0 || t - pts[i].t > MAX_POSITION_AGE_MS) continue
      const p = pts[i]
      const tel = this.data.telemetry.get(number)
      const j = tel ? lastAtOrBefore(tel, t) : -1
      const c = j >= 0 && tel && t - tel[j].t <= MAX_POSITION_AGE_MS ? tel[j] : null
      out.push({
        number,
        x: p.x,
        y: p.y,
        z: p.z,
        onTrack: p.onTrack,
        speed: c?.speed ?? null,
        rpm: c?.rpm ?? null,
        gear: c?.gear ?? null,
        throttle: c?.throttle ?? null,
        brake: c?.brake ?? null,
        drs: c?.drs ?? null
      })
    }
    return out
  }

  /**
   * The circuit's outline, taken from one real lap of one car: the points between two consecutive lap-counter
   * changes in the timing feed. Null when no whole lap of position data exists. Never drawn from anything else.
   */
  outline(): { x: number; y: number }[] | null {
    const timing = this.data.feeds.TimingData ?? []
    let best: { number: string; times: number[] } | null = null
    const laps = new Map<string, number[]>()
    const seen = new Map<string, number>()
    for (const c of timing) {
      const lines = (c.data as { Lines?: Record<string, { NumberOfLaps?: number }> })?.Lines
      if (!lines) continue
      for (const [n, v] of Object.entries(lines)) {
        const l = v?.NumberOfLaps
        if (typeof l === 'number' && l !== seen.get(n)) {
          seen.set(n, l)
          const arr = laps.get(n) ?? []
          arr.push(c.t)
          laps.set(n, arr)
        }
      }
    }
    for (const [number, times] of laps) {
      if (!this.data.positions.has(number)) continue
      if (!best || times.length > best.times.length) best = { number, times }
    }
    if (!best || best.times.length < 5) return null
    // A lap in the middle of the recording, away from the formation lap and from any in/out laps at the start and end.
    const mid = Math.floor(best.times.length / 2)
    const from = best.times[mid]
    const to = best.times[mid + 1]
    const pts = (this.data.positions.get(best.number) ?? []).filter((p) => p.t >= from && p.t <= to && p.onTrack)
    if (pts.length < 40) return null
    return pts.map((p) => ({ x: p.x, y: p.y }))
  }
}
