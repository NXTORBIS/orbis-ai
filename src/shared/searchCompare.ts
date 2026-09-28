/**
 * "X vs Y", and a life told in order (§45, §46).
 *
 * Two modules, one idea: both are claims about specific things, and both are the kind of claim a model will produce
 * flawlessly and falsely if asked. A comparison table invents a specification; a timeline invents a date. Neither
 * error announces itself.
 *
 * So neither is generated here. The comparison reuses the tray's engine (src/shared/tray.ts) -- the same rule that a
 * cell exists only when the words that say it are in the page it cites -- and the timeline applies that rule to
 * dates. What this file adds is only the reading of the query: which two things are being compared, and nothing else.
 */

import type { Provenance } from './searchModules.ts'

export interface Sides {
  left: string
  right: string
}

/** A moment in a life or a history, and the page that says so. */
export interface TimelineEntry {
  /** As the page writes it: "1879", "14 March 1879", "March 2008". Not normalised, because normalising invents precision. */
  when: string
  what: string
  /** For ordering. Null when the page gave something that has no year in it, which is kept but sorted last. */
  year: number | null
  provenance: Provenance
}

const SPLIT = /\s+(?:vs\.?|versus|compared to|compared with|or)\s+/i
const DIFFERENCE = /^(?:what(?:'s| is) the )?difference between\s+(.+?)\s+and\s+(.+)$/i

const clean = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '')

/**
 * The two things being compared, or null.
 *
 * Null for anything that is not plainly a comparison. "or" is included because people write "python or java", but it
 * is also an ordinary word -- "coffee or tea near me" is a local search -- so a side that reads as a sentence rather
 * than a subject means this is not a comparison after all.
 */
export function splitComparison(query: string): Sides | null {
  const raw = clean(query)
  if (!raw) return null

  const difference = DIFFERENCE.exec(raw)
  if (difference) {
    const sides = { left: clean(difference[1]), right: clean(difference[2]) }
    return usable(sides) ? sides : null
  }

  const parts = raw.split(SPLIT)
  if (parts.length !== 2) return null
  const sides = { left: clean(parts[0]), right: clean(parts[1]) }
  return usable(sides) ? sides : null
}

/** Whether both sides look like things rather than phrases. Four words is already a sentence, not a subject. */
function usable(sides: Sides): boolean {
  for (const side of [sides.left, sides.right]) {
    if (side.length < 2 || side.length > 60) return false
    const words = side.split(' ').filter(Boolean)
    if (!words.length || words.length > 4) return false
    // "near me", "the best one" -- asking words on a side mean this was never two things being compared.
    if (/\b(near me|nearby|best|cheapest|which|should i|me)\b/i.test(side)) return false
  }
  return sides.left.toLowerCase() !== sides.right.toLowerCase()
}

const YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/

/** The year in a date, for ordering. Null when there is none, which is different from year zero. */
export const yearIn = (when: string): number | null => {
  const found = YEAR.exec(String(when ?? ''))
  return found ? Number(found[1]) : null
}

/**
 * Keeps the timeline entries the page actually supports (§45).
 *
 * Both halves have to be present in the page: the date and what happened. A real date attached to an invented event,
 * or a real event given an invented date, are the two ways this goes wrong, and requiring both closes both. Entries
 * are ordered by year, and anything without one is kept but sorted last rather than dropped -- "during the war" is a
 * real thing for a page to say.
 */
export function acceptTimeline(raw: unknown, pageText: string, provenance: Provenance, limit = 12): TimelineEntry[] {
  const haystack = String(pageText ?? '').toLowerCase()
  if (!haystack) return []
  const out: TimelineEntry[] = []
  const seen = new Set<string>()

  for (const item of Array.isArray(raw) ? raw : []) {
    const o = (item ?? {}) as Record<string, unknown>
    const when = clean(String(o.when ?? o.date ?? '')).slice(0, 60)
    const what = clean(String(o.what ?? o.event ?? '')).slice(0, 220)
    if (!when || !what) continue

    // The page has to say the date, and has to say what happened. Either alone is not evidence of the pair.
    if (!haystack.includes(when.toLowerCase())) continue
    const words = what
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
    const supported = words.length > 0 && words.filter((w) => haystack.includes(w)).length / words.length >= 0.75
    if (!supported) continue

    const key = `${when.toLowerCase()}|${what.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ when, what, year: yearIn(when), provenance })
    if (out.length >= limit) break
  }

  // Earliest first; anything without a year goes last, in the order the page gave it.
  return out.sort((a, b) => {
    if (a.year === null && b.year === null) return 0
    if (a.year === null) return 1
    if (b.year === null) return -1
    return a.year - b.year
  })
}
