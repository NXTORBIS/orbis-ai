/**
 * Tyres, stops and pace: what the session's records say, and a clearly-labelled what-if built on them.
 *
 * Observed (from the provider): stints, compounds, tyre age at the start, pit stops, lap times.
 * Derived here: stint pace, a lap-time trend against tyre age, pit-lane loss.
 * Hypothetical: the strategy calculator, which only ever adds up the assumptions it is given.
 */
import { mean, median } from './time.ts'
import type { F1Lap } from './types.ts'

export interface Stint {
  driverNumber: number
  stint: number
  lapStart: number
  lapEnd: number
  compound: string | null
  tyreAgeAtStart: number | null
}

export interface PitStop {
  driverNumber: number
  lap: number
  /** Seconds in the pit lane (entry line to exit line). */
  laneDuration: number | null
  /** Seconds stationary, when the provider measured it. */
  stopDuration: number | null
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' ? (v as Json) : null)
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
}

export function normalizeStints(payload: unknown): Stint[] {
  const out: Stint[] = []
  for (const raw of Array.isArray(payload) ? payload : []) {
    const s = obj(raw)
    const d = num(s?.driver_number)
    const a = num(s?.lap_start)
    const b = num(s?.lap_end)
    if (!s || d === null || a === null || b === null) continue
    const c = typeof s.compound === 'string' && s.compound !== '' && s.compound.toUpperCase() !== 'UNKNOWN' ? s.compound.toUpperCase() : null
    out.push({ driverNumber: d, stint: num(s.stint_number) ?? out.length + 1, lapStart: a, lapEnd: b, compound: c, tyreAgeAtStart: num(s.tyre_age_at_start) })
  }
  return out.sort((x, y) => x.driverNumber - y.driverNumber || x.stint - y.stint)
}

export function normalizePitStops(payload: unknown): PitStop[] {
  const out: PitStop[] = []
  for (const raw of Array.isArray(payload) ? payload : []) {
    const p = obj(raw)
    const d = num(p?.driver_number)
    const lap = num(p?.lap_number)
    if (!p || d === null || lap === null) continue
    const lane = num(p.lane_duration) ?? num(p.pit_duration)
    out.push({ driverNumber: d, lap, laneDuration: lane !== null && lane > 0 ? lane : null, stopDuration: (() => { const s = num(p.stop_duration); return s !== null && s > 0 ? s : null })() })
  }
  return out.sort((a, b) => a.driverNumber - b.driverNumber || a.lap - b.lap)
}

export interface StintPace {
  stint: Stint
  laps: number
  eligible: number
  median: number | null
  average: number | null
  best: number | null
  /** Seconds per lap of tyre age, from a least-squares line; null when there are too few laps to say anything. */
  trend: { perLap: number; r2: number; n: number } | null
}

/** The laps of a stint that say something about pace: a time exists, not an out-lap, not the lap that ends in the pits. */
export function eligibleLaps(laps: F1Lap[], stint: Stint, pitLaps: Set<number>): F1Lap[] {
  return laps.filter(
    (l) =>
      l.driverNumber === stint.driverNumber &&
      l.lap >= stint.lapStart &&
      l.lap <= stint.lapEnd &&
      l.duration !== null &&
      !l.isPitOut &&
      !pitLaps.has(l.lap) &&
      // The first lap of a race is a standing start; it is not representative.
      l.lap !== 1
  )
}

/** Ordinary least squares of y on x. Null with fewer than 5 points or no spread in x. */
export function linearTrend(xs: number[], ys: number[]): { slope: number; r2: number; n: number } | null {
  const n = xs.length
  if (n < 5 || n !== ys.length) return null
  const mx = xs.reduce((t, v) => t + v, 0) / n
  const my = ys.reduce((t, v) => t + v, 0) / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
    syy += (ys[i] - my) ** 2
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy)
  return { slope, r2, n }
}

export function stintPace(stint: Stint, laps: F1Lap[], pitLaps: Set<number>): StintPace {
  const used = eligibleLaps(laps, stint, pitLaps)
  const times = used.map((l) => l.duration as number)
  const age0 = stint.tyreAgeAtStart ?? 0
  const t = linearTrend(
    used.map((l) => age0 + (l.lap - stint.lapStart)),
    times
  )
  return {
    stint,
    laps: stint.lapEnd - stint.lapStart + 1,
    eligible: used.length,
    median: median(times),
    average: mean(times),
    best: times.length ? Math.min(...times) : null,
    trend: t ? { perLap: t.slope, r2: t.r2, n: t.n } : null
  }
}

/** The median time lost in the pit lane across stops that were measured. Null when none were. */
export function pitLaneLoss(stops: PitStop[]): { median: number; n: number } | null {
  const v = stops.map((s) => s.laneDuration).filter((x): x is number => x !== null)
  const m = median(v)
  return m === null ? null : { median: m, n: v.length }
}

// ---- hypothetical strategy -------------------------------------------------------------------------------------------------------

export interface PlanStint {
  compound: string
  laps: number
}

export interface PlanAssumptions {
  /** Seconds per lap on a fresh set of each compound. */
  basePace: Record<string, number>
  /** Seconds added per lap of tyre age, per compound. */
  wear: Record<string, number>
  /** Seconds lost in the pit lane per stop. */
  pitLoss: number
}

export interface PlanResult {
  totalSeconds: number
  perStint: { compound: string; laps: number; seconds: number }[]
  stops: number
  /** Assumptions that were needed and missing; when non-empty the total is not meaningful. */
  missing: string[]
}

/**
 * Adds up a plan: for each stint, lap k (0-based) takes base + wear * k; every stop adds the pit loss.
 * It does not model fuel, traffic, track evolution or safety cars, and the screen says so.
 */
export function evaluatePlan(plan: PlanStint[], a: PlanAssumptions): PlanResult {
  const missing: string[] = []
  const perStint: PlanResult['perStint'] = []
  let total = 0
  for (const s of plan) {
    const base = a.basePace[s.compound]
    const wear = a.wear[s.compound] ?? 0
    if (base === undefined) {
      if (!missing.includes(`pace for ${s.compound}`)) missing.push(`pace for ${s.compound}`)
      continue
    }
    let seconds = 0
    for (let k = 0; k < s.laps; k++) seconds += base + wear * k
    perStint.push({ compound: s.compound, laps: s.laps, seconds })
    total += seconds
  }
  const stops = Math.max(0, plan.length - 1)
  total += stops * a.pitLoss
  return { totalSeconds: total, perStint, stops, missing }
}
