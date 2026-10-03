/**
 * Which passage in a source actually supports a claim.
 *
 * A citation said "this came from source 2". It did not say *where* in source 2, so checking a claim meant opening
 * the page and reading it looking for the sentence -- which is the work the citation was supposed to save. Worse, a
 * number next to a sentence looks like proof whether or not the source says anything of the kind, and nothing
 * anywhere checked that it did.
 *
 * This matches each cited claim back to the piece of the source that carries it, by comparing the words. It runs
 * after the answer is written and changes nothing about it.
 *
 * The rule the whole file turns on: **finding nothing is a real answer, and it is the important one.** A claim that
 * does not match anything in the source it cites is reported as unsupported rather than quietly given a passage that
 * looks close enough. That is the case worth catching: a citation pointing at a page that does not say it.
 */

const SENTENCE = /[^.!?\n]+[.!?]*/g
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu

const COMMON = new Set([
  'the','a','an','and','or','but','if','of','to','in','on','for','with','as','by','at','from','is','are','was','were','be','been','being','it','its','this','that','these','those','not','no','you','your','we','our','they','their','there','here','what','which','who','when','where','how','all','any','more','most','other','some','such','than','then','so','too','very','just','also','can','could','will','would','should','may','might','has','have','had','do','does','did','about','into','over','after','before'
])

const words = (text: string): string[] => (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 2 && !COMMON.has(w))

/** The sentences of a piece of text, trimmed, with the very short ones dropped. */
export function sentences(text: string): string[] {
  return (text.match(SENTENCE) ?? []).map((one) => one.trim()).filter((one) => one.length >= 25)
}

/** How much of a claim's meaningful words appear in a passage, from 0 to 1. */
export function support(claim: string, passage: string): number {
  const wanted = new Set(words(claim))
  if (wanted.size === 0) return 0
  const have = new Set(words(passage))
  let shared = 0
  for (const one of wanted) if (have.has(one)) shared++
  return shared / wanted.size
}

/**
 * How much of a claim a passage has to carry before it counts as supporting it.
 *
 * Set where it is because the two mistakes are not equal. Saying "this passage supports that claim" when it does not
 * is the thing this file exists to prevent, and saying "I could not find it" when the passage is really there costs
 * one line on the screen. So the bar favours admitting nothing was found.
 */
export const ENOUGH_SUPPORT = 0.6

export interface Supported {
  /** The claim as the answer wrote it. */
  claim: string
  /** The source number the answer cited for it. */
  n: number
  /** The passage in that source that carries it, or null when the source does not appear to say it. */
  passage: string | null
  /** How much of the claim the passage carries, 0 to 1. Zero when nothing was found. */
  strength: number
}

const CITATION = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g

/**
 * Each cited claim in an answer, with the passage that supports it.
 *
 * A "claim" is the sentence the citation is attached to, because that is the unit somebody reads and the unit they
 * would want to check. A sentence citing two sources is checked against both: each gets its own entry, so a sentence
 * half-supported by one source and not at all by the other says exactly that.
 */
export function traceClaims(answer: string, sources: readonly { n: number; excerpt: string }[]): Supported[] {
  const byNumber = new Map(sources.map((one) => [one.n, one]))
  const out: Supported[] = []

  for (const sentence of sentences(answer)) {
    const cited = new Set<number>()
    for (const match of sentence.matchAll(CITATION)) {
      for (const part of match[1].split(',')) {
        const n = Number(part.trim())
        if (Number.isFinite(n)) cited.add(n)
      }
    }
    if (cited.size === 0) continue
    // The citation marks themselves are not part of what was claimed.
    const claim = sentence.replace(CITATION, ' ').replace(/\s+/g, ' ').trim()
    if (claim.length < 25) continue

    for (const n of cited) {
      const source = byNumber.get(n)
      if (!source) continue
      let best: { passage: string; strength: number } | null = null
      for (const passage of sentences(source.excerpt)) {
        const strength = support(claim, passage)
        if (!best || strength > best.strength) best = { passage, strength }
      }
      const found = best && best.strength >= ENOUGH_SUPPORT ? best : null
      out.push({ claim, n, passage: found?.passage ?? null, strength: found?.strength ?? 0 })
    }
  }
  return out
}

/** The cited claims whose source does not appear to say them. The list worth looking at. */
export const unsupported = (traced: readonly Supported[]): Supported[] => traced.filter((one) => one.passage === null)

/**
 * What to tell somebody about citations that do not hold up, or null when they all do.
 *
 * It says what was checked and how, because "Orbis could not find this in the source" has two explanations -- the
 * source does not say it, or the part Orbis read did not include it -- and claiming the first would be going beyond
 * what was actually established.
 */
export function provenanceNote(traced: readonly Supported[]): string | null {
  const missing = unsupported(traced)
  if (!missing.length) return null
  const which = [...new Set(missing.map((one) => one.n))].sort((a, b) => a - b)
  return missing.length === 1
    ? `One claim cites source ${which[0]}, and Orbis could not find it in the part of that page it read.`
    : `${missing.length} claims cite sources (${which.join(', ')}) where Orbis could not find them in the part of those pages it read.`
}
