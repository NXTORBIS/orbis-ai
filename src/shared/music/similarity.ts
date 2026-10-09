/**
 * How alike two playlists are, and what exactly differs.
 *
 * ## Why this exists
 *
 * Somebody importing from three services ends up with "Gym", "Gym 2024" and "workout" holding mostly the same
 * tracks. Nothing here merges them — it measures the overlap and shows the difference, so the person can see that
 * two playlists are 94% the same and decide for themselves.
 *
 * ## Overlap is measured both ways
 *
 * A 10-track playlist entirely inside a 500-track one is *fully contained* and only 2% of the big one. One number
 * cannot say that, so both are returned: a small playlist swallowed by a big one is a different situation from two
 * playlists that genuinely match, and only `containment` tells them apart.
 *
 * ## Same tracks, different order, is a real answer
 *
 * Reported separately, because reordering is cheap and re-importing is not: somebody who sees "the same 40 tracks,
 * in a different order" knows there is nothing to import.
 */

import { identityKey, type Identifiable } from './identity.ts'

export interface Similarity {
  /** Shared ÷ all distinct tracks across both. 1 means identical sets. */
  overlap: number
  /** Shared ÷ the smaller playlist. 1 means one is entirely inside the other. */
  containment: number
  shared: number
  onlyLeft: number
  onlyRight: number
  /** True when the sets are the same but the order is not. */
  reordered: boolean
  says: string
}

const keysOf = (tracks: readonly Identifiable[]): string[] => tracks.map((one) => identityKey(one))

export function similarity(left: readonly Identifiable[], right: readonly Identifiable[]): Similarity {
  const a = keysOf(left)
  const b = keysOf(right)
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) {
    return { overlap: 1, containment: 1, shared: 0, onlyLeft: 0, onlyRight: 0, reordered: false, says: 'Both are empty.' }
  }
  if (setA.size === 0 || setB.size === 0) {
    return {
      overlap: 0,
      containment: 0,
      shared: 0,
      onlyLeft: setA.size,
      onlyRight: setB.size,
      reordered: false,
      says: 'One of them is empty, so there is nothing to compare.'
    }
  }

  let shared = 0
  for (const key of setA) if (setB.has(key)) shared += 1
  const all = new Set([...setA, ...setB]).size
  const overlap = shared / all
  const containment = shared / Math.min(setA.size, setB.size)
  const onlyLeft = setA.size - shared
  const onlyRight = setB.size - shared
  const sameSet = onlyLeft === 0 && onlyRight === 0
  const reordered = sameSet && a.join('|') !== b.join('|')

  let says: string
  if (sameSet) says = reordered ? 'The same tracks, in a different order.' : 'Exactly the same tracks, in the same order.'
  else if (containment === 1) {
    const smaller = setA.size < setB.size ? 'The first' : 'The second'
    says = `${smaller} is entirely inside the other. ${Math.max(onlyLeft, onlyRight)} tracks are only in the larger one.`
  } else if (overlap >= 0.8) says = `Nearly the same — ${shared} shared, ${onlyLeft + onlyRight} not.`
  else if (shared === 0) says = 'Nothing in common.'
  else says = `${shared} shared, ${onlyLeft} only in the first, ${onlyRight} only in the second.`

  return { overlap, containment, shared, onlyLeft, onlyRight, reordered, says }
}

export interface Difference<T extends Identifiable> {
  shared: readonly T[]
  onlyLeft: readonly T[]
  onlyRight: readonly T[]
}

/** The two playlists side by side, for the screen that shows what would change. */
export function difference<T extends Identifiable>(left: readonly T[], right: readonly T[]): Difference<T> {
  const rightKeys = new Set(keysOf(right))
  const leftKeys = new Set(keysOf(left))
  return {
    shared: left.filter((one) => rightKeys.has(identityKey(one))),
    onlyLeft: left.filter((one) => !rightKeys.has(identityKey(one))),
    onlyRight: right.filter((one) => !leftKeys.has(identityKey(one)))
  }
}

export interface Pair {
  leftId: string
  leftName: string
  rightId: string
  rightName: string
  similarity: Similarity
  /** What this probably is, said plainly rather than as a score. */
  looksLike: 'the same playlist' | 'one inside the other' | 'nearly the same' | 'overlapping'
}

/**
 * Playlists across sources that look like the same playlist.
 *
 * Only pairs above `least` are returned, and the threshold is deliberately high: offering somebody a list of
 * "possible duplicates" that is mostly coincidence teaches them to ignore the list.
 */
export function duplicatePlaylists(
  playlists: readonly { id: string; name: string; tracks: readonly Identifiable[] }[],
  least = 0.6
): Pair[] {
  const pairs: Pair[] = []
  for (let i = 0; i < playlists.length; i += 1) {
    for (let j = i + 1; j < playlists.length; j += 1) {
      const left = playlists[i]
      const right = playlists[j]
      const how = similarity(left.tracks, right.tracks)
      if (how.shared === 0) continue
      // Containment counts as well as overlap: a 10-of-500 subset is worth offering and scores 0.02 on overlap.
      if (how.overlap < least && how.containment < 0.95) continue
      const looksLike: Pair['looksLike'] =
        how.onlyLeft === 0 && how.onlyRight === 0
          ? 'the same playlist'
          : how.containment >= 0.95
            ? 'one inside the other'
            : how.overlap >= 0.8
              ? 'nearly the same'
              : 'overlapping'
      pairs.push({ leftId: left.id, leftName: left.name, rightId: right.id, rightName: right.name, similarity: how, looksLike })
    }
  }
  pairs.sort((a, b) => b.similarity.overlap - a.similarity.overlap)
  return pairs
}

/**
 * The destination a source playlist probably belongs to, by name.
 *
 * Used by the bulk mapping screen to pre-fill the dropdowns. It is only ever a suggestion — the screen shows the
 * name it matched and nothing is merged without somebody confirming the row.
 */
export function suggestDestination(
  sourceName: string,
  destinations: readonly { id: string; name: string }[]
): { id: string; name: string; why: string } | null {
  const plain = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(playlist|mix|copy|imported|from spotify|from apple)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const wanted = plain(sourceName)
  if (wanted === '') return null

  const exact = destinations.find((one) => plain(one.name) === wanted)
  if (exact) return { id: exact.id, name: exact.name, why: 'The same name.' }

  // Word overlap, and only when most of the words agree — "Gym" must not pick "Gym Shoes Shopping".
  const words = new Set(wanted.split(' ').filter(Boolean))
  let best: { id: string; name: string; score: number } | null = null
  for (const one of destinations) {
    const theirs = new Set(plain(one.name).split(' ').filter(Boolean))
    if (theirs.size === 0) continue
    let shared = 0
    for (const word of words) if (theirs.has(word)) shared += 1
    const score = shared / Math.max(words.size, theirs.size)
    if (score > (best?.score ?? 0)) best = { id: one.id, name: one.name, score }
  }
  if (best && best.score >= 0.7) return { id: best.id, name: best.name, why: 'A very similar name.' }
  return null
}
