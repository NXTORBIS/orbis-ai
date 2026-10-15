/**
 * Telemetry for one lap: building the trace, aligning two laps, and the time delta between them.
 *
 * What is measured and what is derived, so the screen can say so:
 *  - speed, throttle, brake, gear, rpm and DRS are the car's own readings (about 3.7 per second);
 *  - DISTANCE is derived: the speed readings integrated over time. It is not a surveyed track distance, and two laps'
 *    totals differ slightly, so laps are aligned by FRACTION of the lap rather than by metres.
 *  - the DELTA is derived from that alignment: time at the same fraction of the lap, other lap minus reference lap.
 *    Positive means the other lap was slower there.
 */

export interface CarSample {
  /** Milliseconds, absolute (epoch) or relative; only differences matter. */
  t: number
  speed: number | null
  throttle: number | null
  brake: number | null
  gear: number | null
  rpm: number | null
  /** The raw DRS code. 10, 12 and 14 mean the flap is open; 0-8 closed or not available. */
  drs: number | null
}

export interface TracePoint extends CarSample {
  /** Seconds since the start of the lap. */
  time: number
  /** Metres since the start of the lap, from integrating speed. */
  distance: number
  /** 0..1 along the lap by distance. */
  fraction: number
}

export interface LapTrace {
  points: TracePoint[]
  /** Seconds the samples span. Slightly under the lap time when the first or last reading is missing. */
  duration: number
  /** Metres, integrated. */
  length: number
  /** True when fewer readings than a lap should have were found, so the trace should be treated with care. */
  sparse: boolean
}

export const DRS_OPEN = new Set([10, 12, 14])

/** Readings of one lap: those between its start and end, ordered, with distance, time and fraction added. */
export function buildLapTrace(samples: CarSample[], startMs: number, endMs: number): LapTrace | null {
  const inLap = samples.filter((s) => s.t >= startMs && s.t <= endMs && s.speed !== null).sort((a, b) => a.t - b.t)
  if (inLap.length < 10) return null
  const points: TracePoint[] = []
  let distance = 0
  for (let i = 0; i < inLap.length; i++) {
    const s = inLap[i]
    if (i > 0) {
      const p = inLap[i - 1]
      const dt = (s.t - p.t) / 1000
      // Trapezoid: km/h -> m/s is /3.6.
      distance += (((p.speed as number) + (s.speed as number)) / 2 / 3.6) * dt
    }
    points.push({ ...s, time: (s.t - inLap[0].t) / 1000, distance, fraction: 0 })
  }
  const length = distance
  if (length <= 0) return null
  for (const p of points) p.fraction = p.distance / length
  const duration = points[points.length - 1].time
  const expected = (endMs - startMs) / 1000
  return { points, duration, length, sparse: duration < expected * 0.9 || inLap.length < expected * 2 }
}

/** The value of `pick` at a fraction of the lap, by linear interpolation between the neighbouring readings. */
export function valueAtFraction(trace: LapTrace, fraction: number, pick: (p: TracePoint) => number | null): number | null {
  const pts = trace.points
  if (fraction <= 0) return pick(pts[0])
  if (fraction >= 1) return pick(pts[pts.length - 1])
  let lo = 0
  let hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].fraction <= fraction) lo = mid
    else hi = mid
  }
  const a = pick(pts[lo])
  const b = pick(pts[hi])
  if (a === null || b === null) return a ?? b
  const span = pts[hi].fraction - pts[lo].fraction
  return span <= 0 ? a : a + ((b - a) * (fraction - pts[lo].fraction)) / span
}

export interface DeltaPoint {
  fraction: number
  /** Metres into the reference lap at this fraction. */
  distance: number
  /** Seconds. Positive: the compared lap is slower than the reference at this point. */
  delta: number
}

/** Delta of `other` against `reference` on an even grid of lap fractions. */
export function deltaTrace(reference: LapTrace, other: LapTrace, steps = 200): DeltaPoint[] {
  const out: DeltaPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const tr = valueAtFraction(reference, f, (p) => p.time)
    const to = valueAtFraction(other, f, (p) => p.time)
    if (tr === null || to === null) continue
    out.push({ fraction: f, distance: f * reference.length, delta: to - tr })
  }
  return out
}

export interface LapSummary {
  maxSpeed: number | null
  minSpeed: number | null
  /** Share of the lap's time with the throttle at 99% or more. */
  fullThrottle: number | null
  /** Share of the lap's time with the brake applied. */
  braking: number | null
  /** Share of the lap's time with the DRS flap open. */
  drsOpen: number | null
  /** Seconds in each gear, index 1..8. */
  gearTime: Record<number, number>
  gearChanges: number
}

export function summarize(trace: LapTrace): LapSummary {
  const pts = trace.points
  let maxSpeed: number | null = null
  let minSpeed: number | null = null
  let full = 0
  let brake = 0
  let drs = 0
  let measured = 0
  const gearTime: Record<number, number> = {}
  let changes = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.speed !== null) {
      maxSpeed = maxSpeed === null ? p.speed : Math.max(maxSpeed, p.speed)
      minSpeed = minSpeed === null ? p.speed : Math.min(minSpeed, p.speed)
    }
    if (i === 0) continue
    const dt = p.time - pts[i - 1].time
    measured += dt
    if ((p.throttle ?? 0) >= 99) full += dt
    if ((p.brake ?? 0) > 0) brake += dt
    if (p.drs !== null && DRS_OPEN.has(p.drs)) drs += dt
    if (p.gear !== null && p.gear > 0) gearTime[p.gear] = (gearTime[p.gear] ?? 0) + dt
    if (p.gear !== null && pts[i - 1].gear !== null && p.gear !== pts[i - 1].gear && p.gear > 0 && (pts[i - 1].gear as number) > 0) changes += 1
  }
  return {
    maxSpeed,
    minSpeed,
    fullThrottle: measured > 0 ? full / measured : null,
    braking: measured > 0 ? brake / measured : null,
    drsOpen: measured > 0 ? drs / measured : null,
    gearTime,
    gearChanges: changes
  }
}

/** Which laps can be compared fairly. Returns the reasons it cannot, or an empty list. */
export function compatibility(a: { session: number; driver: number; lap: number; pitOut?: boolean }, b: { session: number; pitOut?: boolean }): string[] {
  const why: string[] = []
  if (a.session !== b.session) why.push('The laps are from different sessions, so track and weather conditions differ.')
  if (a.pitOut || b.pitOut) why.push('One lap is an out-lap from the pits, which is not a flying lap.')
  return why
}
