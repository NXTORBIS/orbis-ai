/**
 * The live feed sends a full picture once and then only the pieces that changed. This is the merge that turns a
 * stream of those pieces back into the full picture.
 *
 * Its shape follows what the feed does:
 *  - objects merge key by key, recursively;
 *  - a list that is later updated arrives as an object keyed by index ({"1": {...}} means "item 1 changed"), and
 *    those updates change that item only;
 *  - a list that arrives as a list replaces the old one;
 *  - the `_kf` key marks a keyframe; it is bookkeeping and is dropped.
 *
 * Pure, with no network and no clock, so it can be tested against recorded streams.
 */

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

export function mergeDelta(target: unknown, delta: unknown): unknown {
  if (Array.isArray(delta)) return delta.map((d) => stripKeyframe(d))
  if (!isObject(delta)) return delta

  if (Array.isArray(target)) {
    // Index-keyed update of a list.
    const out = target.slice()
    for (const [k, v] of Object.entries(delta)) {
      if (k === '_kf') continue
      const i = Number(k)
      if (!Number.isInteger(i) || i < 0) continue
      out[i] = mergeDelta(out[i], v)
    }
    return out
  }

  const base: Json = isObject(target) ? { ...target } : {}
  delete base._kf
  for (const [k, v] of Object.entries(delta)) {
    if (k === '_kf') continue
    base[k] = mergeDelta(base[k], v)
  }
  return base
}

function stripKeyframe(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripKeyframe)
  if (!isObject(v)) return v
  const out: Json = {}
  for (const [k, x] of Object.entries(v)) if (k !== '_kf') out[k] = stripKeyframe(x)
  return out
}

/** The accumulated raw state of every subscribed feed, by feed name. */
export type RawFeedState = Record<string, unknown>

export function applyFeedUpdate(state: RawFeedState, feed: string, delta: unknown): RawFeedState {
  return { ...state, [feed]: mergeDelta(state[feed], delta) }
}
