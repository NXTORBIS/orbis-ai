/**
 * The live and replay data sources behind one object, so the screen has one thing to subscribe to.
 *
 * What the status says is deliberately conservative:
 *  - "live" only when the feed is connected, the session is in progress AND records arrived recently;
 *  - a connected feed whose session has finished is "last-session": its final state, not a live race;
 *  - a replay is always "replay", whatever it replays.
 *
 * Electron-free: the network pieces and the emitter are parameters.
 */
import { applyFeedUpdate, type RawFeedState } from '../../../shared/f1/live/merge.ts'
import { buildSnapshot } from '../../../shared/f1/live/snapshot.ts'
import type { FeedConnectionState, LiveCar, StreamEvent, StreamPhase, StreamStatus } from '../../../shared/f1/live/stream-types.ts'
import { carPointsFrom, carTelemetryFrom, decodeCompressed, parseJsonStream, type TimedChange } from './archive.ts'
import { ReplayEngine, type ReplayData } from './replay.ts'
import { FeedClient, type FeedClientOptions } from './signalr.ts'

export type { StreamEvent, StreamPhase, StreamStatus } from '../../../shared/f1/live/stream-types.ts'

export const LIVE_FEEDS = [
  'Heartbeat',
  'SessionInfo',
  'SessionStatus',
  'TrackStatus',
  'DriverList',
  'TimingData',
  'TimingAppData',
  'TimingStats',
  'WeatherData',
  'RaceControlMessages',
  'LapCount',
  'ExtrapolatedClock',
  'Position.z',
  'CarData.z'
]

/** The feeds a recorded session is rebuilt from. */
const ARCHIVE_STREAMS = ['DriverList', 'TimingData', 'TimingAppData', 'SessionStatus', 'TrackStatus', 'WeatherData', 'RaceControlMessages', 'LapCount', 'ExtrapolatedClock']

export interface StreamDeps {
  clientOptions: Pick<FeedClientOptions, 'negotiate' | 'socketUrl' | 'socket'>
  /** Reads a text file from the archive; rejects when it is missing. */
  fetchText: (url: string) => Promise<string>
  archiveBase: string
  emit: (e: StreamEvent) => void
  now?: () => number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (h: unknown) => void
}

const FRESH_MS = 20_000
const FINISHED = new Set(['Finished', 'Finalised', 'Ends', 'Aborted'])

export class StreamService {
  private readonly d: StreamDeps
  private readonly now: () => number
  private client: FeedClient | null = null
  private connection: FeedConnectionState = 'idle'
  private raw: RawFeedState = {}
  private liveCars = new Map<string, LiveCar>()
  private liveTrail: { x: number; y: number }[] = []
  private dirty = false
  private emitTimer: unknown = null
  private lastError: string | null = null
  private mode: 'none' | 'live' | 'replay' = 'none'
  private lastRecordAt: number | null = null
  private records = 0

  private replay: ReplayEngine | null = null
  private replayT = 0
  private replayPlaying = false
  private replaySpeed = 1
  private replayTimer: unknown = null
  private replayOutline: { x: number; y: number }[] | null = null
  private loading: { done: number; total: number } | null = null
  private loadToken = 0

  constructor(deps: StreamDeps) {
    this.d = deps
    this.now = deps.now ?? Date.now
  }

  // ---- live --------------------------------------------------------------------------------------------------------------------

  startLive(): void {
    this.stopAll()
    this.mode = 'live'
    this.raw = {}
    this.liveCars.clear()
    this.liveTrail = []
    this.lastError = null
    this.records = 0
    this.lastRecordAt = null
    const client = new FeedClient({
      feeds: LIVE_FEEDS,
      ...this.d.clientOptions,
      onSnapshot: (s) => {
        this.raw = {}
        for (const [feed, v] of Object.entries(s)) this.ingest(feed, v)
        this.touch()
      },
      onChange: (feed, change) => {
        this.ingest(feed, change)
        this.touch()
      },
      onState: (state, detail) => {
        this.connection = state
        if (detail) this.lastError = detail
        this.touch(true)
      }
    })
    this.client = client
    this.connection = 'connecting'
    const every = this.d.setInterval ?? ((fn, ms) => setInterval(fn, ms))
    this.emitTimer = every(() => {
      if (this.dirty || this.mode === 'live') {
        this.dirty = false
        this.emit()
      }
    }, 500)
    client.start()
    this.emit()
  }

  private ingest(feed: string, change: unknown): void {
    if (feed === 'Position.z' || feed === 'CarData.z') {
      this.ingestTelemetry(feed, change)
      return
    }
    this.raw = applyFeedUpdate(this.raw, feed, change)
  }

  private ingestTelemetry(feed: string, change: unknown): void {
    const decoded = decodeCompressed(typeof change === 'string' ? change : null)
    if (!decoded) return
    if (feed === 'Position.z') {
      const batch = (decoded as { Position?: { Entries?: Record<string, { Status?: string; X?: number; Y?: number; Z?: number }> }[] }).Position
      const last = Array.isArray(batch) ? batch[batch.length - 1] : null
      for (const [n, p] of Object.entries(last?.Entries ?? {})) {
        if (typeof p.X !== 'number' || typeof p.Y !== 'number') continue
        const prev = this.liveCars.get(n)
        this.liveCars.set(n, {
          number: n,
          x: p.X,
          y: p.Y,
          z: p.Z ?? 0,
          onTrack: p.Status === 'OnTrack',
          speed: prev?.speed ?? null,
          rpm: prev?.rpm ?? null,
          gear: prev?.gear ?? null,
          throttle: prev?.throttle ?? null,
          brake: prev?.brake ?? null,
          drs: prev?.drs ?? null
        })
        // The outline is learned from one car's own positions, never invented.
        if (n === [...this.liveCars.keys()][0] && p.Status === 'OnTrack' && this.liveTrail.length < 2500) this.liveTrail.push({ x: p.X, y: p.Y })
      }
    } else {
      const batch = (decoded as { Entries?: { Cars?: Record<string, { Channels?: Record<string, number> }> }[] }).Entries
      const last = Array.isArray(batch) ? batch[batch.length - 1] : null
      for (const [n, car] of Object.entries(last?.Cars ?? {})) {
        const ch = car.Channels ?? {}
        const prev = this.liveCars.get(n)
        if (!prev) continue
        const v = (k: string): number | null => (typeof ch[k] === 'number' ? ch[k] : null)
        this.liveCars.set(n, { ...prev, rpm: v('0'), speed: v('2'), gear: v('3'), throttle: v('4'), brake: v('5'), drs: v('45') })
      }
    }
  }

  private touch(forceEmit = false): void {
    this.lastRecordAt = this.now()
    this.records += 1
    this.dirty = true
    if (forceEmit) this.emit()
  }

  // ---- replay ------------------------------------------------------------------------------------------------------------------

  /** Loads a recorded session by its archive path ("2026/.../2026-10-11_Race/"). Resolves when it can be played. */
  async loadReplay(path: string): Promise<{ ok: true; durationMs: number } | { ok: false; message: string }> {
    if (!/^\d{4}\/[\w.-]+\/[\w.-]+\/$/.test(path)) return { ok: false, message: 'That session path is not valid.' }
    this.stopAll()
    this.mode = 'replay'
    const token = ++this.loadToken
    const total = ARCHIVE_STREAMS.length + 3
    this.loading = { done: 0, total }
    this.emit()
    const feeds: Record<string, TimedChange[]> = {}
    const base = this.d.archiveBase + path
    const tick = (): void => {
      if (this.loading) this.loading = { done: this.loading.done + 1, total }
      this.emit()
    }
    try {
      let sessionInfo: unknown = null
      try {
        sessionInfo = JSON.parse((await this.d.fetchText(`${base}SessionInfo.json`)).replace(/^﻿/, ''))
      } catch {
        sessionInfo = null
      }
      tick()
      for (const feed of ARCHIVE_STREAMS) {
        if (token !== this.loadToken) return { ok: false, message: 'Cancelled.' }
        try {
          feeds[feed] = parseJsonStream(await this.d.fetchText(`${base}${feed}.jsonStream`))
        } catch {
          feeds[feed] = []
        }
        tick()
      }
      const readZ = async (name: string): Promise<TimedChange[]> => {
        try {
          return parseJsonStream(await this.d.fetchText(`${base}${name}.jsonStream`))
        } catch {
          return []
        }
      }
      const positions = carPointsFrom(await readZ('Position.z'))
      tick()
      const telemetry = carTelemetryFrom(await readZ('CarData.z'))
      tick()
      if (token !== this.loadToken) return { ok: false, message: 'Cancelled.' }
      if (!feeds.TimingData?.length && !feeds.SessionStatus?.length) {
        this.loading = null
        this.mode = 'none'
        this.emit()
        return { ok: false, message: 'That session has no recorded timing.' }
      }
      const data: ReplayData = { feeds, sessionInfo, positions, telemetry }
      this.replay = new ReplayEngine(data)
      this.replayOutline = this.replay.outline()
      this.replayT = 0
      this.replaySpeed = 1
      this.replayPlaying = false
      this.loading = null
      this.emit()
      return { ok: true, durationMs: this.replay.durationMs }
    } catch (e) {
      this.loading = null
      this.mode = 'none'
      this.lastError = e instanceof Error ? e.message : String(e)
      this.emit()
      return { ok: false, message: 'The recording could not be loaded.' }
    }
  }

  replayControl(action: 'play' | 'pause' | 'seek' | 'speed', value?: number): void {
    if (!this.replay) return
    if (action === 'seek' && typeof value === 'number' && Number.isFinite(value)) {
      this.replayT = Math.max(0, Math.min(this.replay.durationMs, value))
    } else if (action === 'speed' && typeof value === 'number' && [1, 2, 4, 8, 16, 32].includes(value)) {
      this.replaySpeed = value
    } else if (action === 'play') {
      if (this.replayT >= this.replay.durationMs) this.replayT = 0
      this.replayPlaying = true
      if (this.replayTimer === null) {
        const every = this.d.setInterval ?? ((fn, ms) => setInterval(fn, ms))
        this.replayTimer = every(() => this.advanceReplay(250), 250)
      }
    } else if (action === 'pause') {
      this.replayPlaying = false
    }
    this.emit()
  }

  private advanceReplay(realMs: number): void {
    if (!this.replay || !this.replayPlaying) return
    this.replayT = Math.min(this.replay.durationMs, this.replayT + realMs * this.replaySpeed)
    if (this.replayT >= this.replay.durationMs) this.replayPlaying = false
    this.emit()
  }

  // ---- shared ------------------------------------------------------------------------------------------------------------------

  stopAll(): void {
    this.loadToken += 1
    this.client?.stop()
    this.client = null
    const clear = this.d.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
    if (this.emitTimer !== null) clear(this.emitTimer)
    if (this.replayTimer !== null) clear(this.replayTimer)
    this.emitTimer = this.replayTimer = null
    this.replay = null
    this.replayPlaying = false
    this.replayOutline = null
    this.loading = null
    this.connection = 'idle'
    this.mode = 'none'
    this.raw = {}
    this.liveCars.clear()
    this.liveTrail = []
  }

  status(): StreamStatus {
    const age = this.lastRecordAt === null ? null : this.now() - this.lastRecordAt
    const sessionStatus = buildSnapshot(this.mode === 'replay' && this.replay ? this.replay.stateAt(this.replayT) : this.raw).sessionStatus
    let phase: StreamPhase = 'idle'
    let message = 'Not connected.'
    if (this.mode === 'replay') {
      if (this.loading) {
        phase = 'loading'
        message = 'Loading the recorded session…'
      } else {
        phase = 'replay'
        message = 'REPLAY of a finished session. These are recorded values, not a live race.'
      }
    } else if (this.mode === 'live') {
      if (this.connection === 'connecting') {
        phase = 'connecting'
        message = 'Connecting to the live-timing service…'
      } else if (this.connection === 'reconnecting') {
        phase = 'disconnected'
        message = 'The live-timing connection was lost. Reconnecting; what is shown is the last data received and may be old.'
      } else if (this.connection === 'connected') {
        if (sessionStatus === 'Started' || sessionStatus === 'Resumed') {
          if (age !== null && age > FRESH_MS) {
            phase = 'stale'
            message = 'The session is in progress but no update has arrived for a while. The values below may be out of date.'
          } else {
            phase = 'live'
            message = 'LIVE. The session is in progress and updates are arriving.'
          }
        } else if (sessionStatus && FINISHED.has(sessionStatus)) {
          phase = 'last-session'
          message = 'Not live. The service is connected, but the latest session has finished. This is its final state.'
        } else if (sessionStatus === 'Inactive') {
          phase = 'waiting'
          message = 'Connected. The session has not started yet.'
        } else {
          phase = 'waiting'
          message = 'Connected. Waiting for session data.'
        }
      } else if (this.connection === 'stopped') {
        phase = 'idle'
        message = 'Stopped.'
      }
    }
    return {
      source: this.mode === 'none' ? 'none' : this.mode,
      connection: this.connection,
      phase,
      sessionStatus,
      lastRecordAt: this.lastRecordAt === null ? null : new Date(this.lastRecordAt).toISOString(),
      ageMs: age,
      reconnects: this.client?.stats.reconnects ?? 0,
      records: this.client?.stats.records ?? this.records,
      lastError: this.lastError ?? this.client?.stats.lastError ?? null,
      message,
      replay: this.replay ? { durationMs: this.replay.durationMs, t: this.replayT, playing: this.replayPlaying, speed: this.replaySpeed } : null,
      loading: this.loading
    }
  }

  event(): StreamEvent {
    if (this.mode === 'replay' && this.replay) {
      return { status: this.status(), snapshot: this.replay.snapshotAt(this.replayT), cars: this.replay.carsAt(this.replayT), outline: this.replayOutline }
    }
    return {
      status: this.status(),
      snapshot: buildSnapshot(this.raw),
      cars: [...this.liveCars.values()],
      outline: this.liveTrail.length > 200 ? this.liveTrail : null
    }
  }

  private emit(): void {
    this.d.emit(this.event())
  }
}
