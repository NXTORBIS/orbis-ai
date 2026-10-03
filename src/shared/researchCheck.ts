/**
 * Noticing when two sources are the same page, and when they disagree.
 *
 * Research read several pages and then handed all of them to a model with a line in the prompt asking it to mention
 * any disagreement. That is not cross-checking; it is hoping. Two things were actually missing, and both are
 * arithmetic rather than judgement, so both belong here where they can be tested without a model or a network.
 *
 * **The same page at two addresses.** Dropping repeats by web address already happens, and it only catches the easy
 * case: a syndicated article, a mirror and an AMP copy are three addresses carrying one page, and reading all three
 * makes one source look like three agreeing ones. So the *text* is fingerprinted too.
 *
 * **Sources that state different numbers for the same thing.** When one page says a thing costs 40,000 and another
 * says 55,000, that is the single most useful thing research can tell somebody, and it was being left to the model to
 * spot. Here it is found by comparing what the pages actually say.
 *
 * The honesty rule both obey: **a disagreement is reported, never resolved.** Nothing here decides which page is
 * right -- it has no way to know, and a wrong pick is worse than two numbers and the names of who said each. What it
 * produces is a note for the person and for Orion, both of whom can see the sources.
 */

/** Words too common to say anything about what a page is. */
const COMMON = new Set([
  'the','a','an','and','or','but','if','of','to','in','on','for','with','as','by','at','from','is','are','was','were','be','been','it','its','this','that','these','those','not','no','you','your','we','our','they','their','he','she','his','her','has','have','had','do','does','did','can','could','will','would','should','may','might','than','then','so','such','there','here','what','which','who','when','where','how','all','any','more','most','other','some','only','own','same','too','very','just','also'
])

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu

/** The meaningful words of a page, in order, lowercased. */
function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 2 && !COMMON.has(w))
}

/**
 * A fingerprint of what a page says, as a set of overlapping word triples.
 *
 * Triples rather than single words because two pages about one subject share most of their words and almost none of
 * their phrasing; it is the phrasing that tells a copy from a second account of the same story.
 */
export function fingerprint(text: string): Set<string> {
  const w = words(text).slice(0, 1200)
  const out = new Set<string>()
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)
  return out
}

/** How much two fingerprints share, from 0 (nothing) to 1 (identical). */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const one of small) if (large.has(one)) shared++
  // Measured against the shorter page, so an extract of a long article still reads as the same text.
  return shared / small.size
}

/**
 * Two pages are the same page past this much shared phrasing.
 *
 * Set high on purpose. Two independent reports of one event share facts and names; they do not share four fifths of
 * their three-word phrases. Dropping a genuinely separate source is the costlier mistake, so the bar favours keeping
 * both.
 */
export const SAME_PAGE = 0.8

/**
 * A page too short to fingerprint honestly.
 *
 * Twenty-five triples is about thirty meaningful words -- a short paragraph. Below that, four fifths of the phrasing
 * matching says very little, so such a page is always kept rather than judged.
 */
const ENOUGH = 25

export interface Deduped<T> {
  kept: T[]
  /** What was dropped, and which kept source it repeated, so this can be said rather than silently done. */
  repeats: { dropped: T; sameAs: T }[]
}

/**
 * Drops sources whose text repeats one already kept.
 *
 * The first one wins, because the list arrives already ordered by how good a source is, so the first copy is the one
 * worth keeping. A source with too little text to judge is always kept: a wrong drop cannot be noticed afterwards.
 */
export function dropRepeats<T>(sources: readonly T[], textOf: (one: T) => string): Deduped<T> {
  const kept: T[] = []
  const prints: Set<string>[] = []
  const repeats: { dropped: T; sameAs: T }[] = []
  for (const one of sources) {
    const print = fingerprint(textOf(one))
    if (print.size < ENOUGH) {
      kept.push(one)
      prints.push(print)
      continue
    }
    const at = prints.findIndex((other) => other.size >= ENOUGH && overlap(print, other) >= SAME_PAGE)
    if (at >= 0) repeats.push({ dropped: one, sameAs: kept[at] })
    else {
      kept.push(one)
      prints.push(print)
    }
  }
  return { kept, repeats }
}

// ---------------------------------------------------------------- sources that state different numbers

/** A number a page states, with the words either side of it, so two can be compared only when they are about the same thing. */
export interface StatedNumber {
  /** The number itself, with any thousands separators removed and any suffix applied. */
  value: number
  /** Exactly as the page wrote it, so a note can quote rather than reformat. */
  said: string
  /** The meaningful words around it, lowercased: what the number is about. */
  about: string[]
}

const NUMBER = /(?<![\p{L}\p{N}.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|percent|k\b|m\b|bn\b|billion|million|thousand|crore|lakh)?/giu

const SUFFIX: Readonly<Record<string, number>> = Object.freeze({
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
  lakh: 1e5,
  crore: 1e7
})

/** How many words either side count as what a number is about. */
const AROUND = 4

/** The numbers a page states, each with what it is about. */
export function statedNumbers(text: string, limit = 60): StatedNumber[] {
  const out: StatedNumber[] = []
  for (const match of text.matchAll(NUMBER)) {
    const raw = match[1].replace(/,/g, '')
    const base = Number(raw)
    if (!Number.isFinite(base)) continue
    const suffix = (match[2] ?? '').toLowerCase().trim()
    const scale = SUFFIX[suffix] ?? 1
    const at = match.index ?? 0
    const before = words(text.slice(Math.max(0, at - 90), at)).slice(-AROUND)
    const after = words(text.slice(at + match[0].length, at + match[0].length + 90)).slice(0, AROUND)
    const about = [...before, ...after]
    // A number nothing is said about cannot be compared with another, so it is not collected.
    if (about.length < 2) continue
    out.push({ value: base * scale, said: match[0].trim(), about })
    if (out.length >= limit) break
  }
  return out
}

/** Two numbers are about the same thing when enough of the words around them match. */
function sameSubject(a: StatedNumber, b: StatedNumber): boolean {
  const set = new Set(b.about)
  const shared = a.about.filter((w) => set.has(w)).length
  return shared >= 2 && shared / Math.min(a.about.length, b.about.length) >= 0.5
}

/** Percentage difference between two numbers, against the larger, so the order does not matter. */
function apart(a: number, b: number): number {
  const big = Math.max(Math.abs(a), Math.abs(b))
  return big === 0 ? 0 : Math.abs(a - b) / big
}

/** Closer than this and two figures are a rounding, not a disagreement. */
export const CLOSE_ENOUGH = 0.05

export interface Disagreement {
  /** The words both pages used around the figure. */
  about: string
  /** The two readings, as each page wrote them, with which source said it. */
  readings: { n: number; said: string; value: number }[]
}

export interface NumberedSource {
  /** The source's number in the answer's citations. */
  n: number
  text: string
}

/**
 * Where the sources state different figures for the same thing.
 *
 * At most one disagreement is reported per subject, and the list is capped, because the point is to say "these two
 * do not match" and not to produce a table nobody reads. Nothing here decides which is right.
 */
export function disagreements(sources: readonly NumberedSource[], limit = 4): Disagreement[] {
  const read = sources.map((one) => ({ n: one.n, numbers: statedNumbers(one.text) }))
  const found: Disagreement[] = []
  const claimed = new Set<string>()

  for (let i = 0; i < read.length; i++) {
    for (let j = i + 1; j < read.length; j++) {
      for (const a of read[i].numbers) {
        for (const b of read[j].numbers) {
          if (!sameSubject(a, b) || apart(a.value, b.value) < CLOSE_ENOUGH) continue
          const about = a.about.filter((w) => b.about.includes(w)).join(' ')
          if (about === '' || claimed.has(about)) continue
          claimed.add(about)
          found.push({
            about,
            readings: [
              { n: read[i].n, said: a.said, value: a.value },
              { n: read[j].n, said: b.said, value: b.value }
            ]
          })
          if (found.length >= limit) return found
        }
      }
    }
  }
  return found
}

/** What to tell Orion about them, or null when the sources do not disagree. Facts and source numbers; no verdict. */
export function disagreementNote(found: readonly Disagreement[]): string | null {
  if (!found.length) return null
  const lines = found.map((one) => `- about "${one.about}": ${one.readings.map((r) => `[${r.n}] says ${r.said}`).join(', ')}`)
  return [
    'The sources do not agree on these figures. Orbis found this by comparing what the pages state; it has not decided which is right.',
    'Say that they differ, give both with their source numbers, and do not quietly pick one:',
    ...lines
  ].join(String.fromCharCode(10))
}
