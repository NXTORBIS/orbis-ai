/**
 * OpenF1 `car_data` and `location` payloads -> the shapes telemetry.ts works on.
 */
import type { CarSample } from './telemetry.ts'

type Json = Record<string, unknown>
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Rows without a date are dropped; everything else the provider did not supply stays null. */
export function normalizeCarData(payload: unknown): CarSample[] {
  const out: CarSample[] = []
  for (const raw of Array.isArray(payload) ? payload : []) {
    const r = raw as Json
    const t = typeof r?.date === 'string' ? Date.parse(r.date) : NaN
    if (!Number.isFinite(t)) continue
    out.push({ t, speed: asNum(r.speed), throttle: asNum(r.throttle), brake: asNum(r.brake), gear: asNum(r.n_gear), rpm: asNum(r.rpm), drs: asNum(r.drs) })
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface LocationSample {
  t: number
  x: number
  y: number
  z: number
}

/** The coordinates are the provider's own units; only their shape (the outline of the track) is used. */
export function normalizeLocation(payload: unknown): LocationSample[] {
  const out: LocationSample[] = []
  for (const raw of Array.isArray(payload) ? payload : []) {
    const r = raw as Json
    const t = typeof r?.date === 'string' ? Date.parse(r.date) : NaN
    const x = asNum(r?.x)
    const y = asNum(r?.y)
    if (!Number.isFinite(t) || x === null || y === null) continue
    out.push({ t, x, y, z: asNum(r.z) ?? 0 })
  }
  return out.sort((a, b) => a.t - b.t)
}
