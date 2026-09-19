/**
 * Long-form generation: continuing an answer past one backend call's output limit, without the person ever saying
 * "continue".
 *
 * A model stopping because it ran out of output tokens is not the same thing as it finishing. Orbis already knows
 * the difference — it is `truncated: true` on the 'done' event (main/nim.ts's own `finish_reason === 'length'`,
 * not a guess from the last character) — this file is what happens next: whether more was asked for, how much more,
 * and what to tell the model so it picks up exactly where it left off.
 *
 * Pure — no network, no model, no IPC. The loop that actually calls the model again lives in main/longGeneration.ts.
 */

// ---------------------------------------------------------------- what was actually asked for

export interface RequestedLength {
  /** An explicit target, in words, when the person gave one ("10,000 words", "a 20000-word report"). */
  words: number | null
  /** True for "comprehensive" / "complete guide" / "write everything" and the like — long, but no number given. */
  wantsLong: boolean
}

const WORD_TARGET = /(\d[\d,]*)\s*[-\s]?(?:words?)\b/i
const PAGE_TARGET = /(\d[\d,]*)\s*[-\s]?(?:pages?)\b/i
/** Rough, and said as rough everywhere it is used: about what a page holds in ordinary prose. */
const WORDS_PER_PAGE = 500
const SOFT_SIGNALS = /\b(comprehensive|very detailed|in[\s-]?depth|exhaustive|thorough|complete guide|full report|write everything|entire (?:chapter|book|guide)|extensive)\b/i

/** What the person's message asks for, in length. Never throws; an ordinary short request returns both fields empty. */
export function detectRequestedLength(text: string): RequestedLength {
  const wordMatch = text.match(WORD_TARGET)
  if (wordMatch) return { words: Number(wordMatch[1].replace(/,/g, '')), wantsLong: true }
  const pageMatch = text.match(PAGE_TARGET)
  if (pageMatch) return { words: Number(pageMatch[1].replace(/,/g, '')) * WORDS_PER_PAGE, wantsLong: true }
  return { words: null, wantsLong: SOFT_SIGNALS.test(text) }
}

/** Whether a request is asking for something long enough that automatic continuation might matter at all. */
export function isLongFormRequest(length: RequestedLength): boolean {
  return length.wantsLong || (length.words !== null && length.words > 0)
}

// ---------------------------------------------------------------- counting what has actually been generated

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// ---------------------------------------------------------------- safety limits, so this can never run away

/** However long a document, this many backend calls for one answer is the ceiling. */
export const MAX_SEGMENTS = 12
/** A hard stop on total length, independent of what was asked for — well past any request Orbis will actually get. */
export const MAX_TOTAL_WORDS = 60_000
/** Wall-clock ceiling for one answer's continuation chain, so a slow provider cannot hold a reply open indefinitely. */
export const MAX_DURATION_MS = 20 * 60_000

/**
 * Whether another segment should be generated.
 *
 * Only ever true when the previous call stopped on the output limit specifically — never for a normal finish, an
 * error, or a refusal, which are not this file's business. Below the explicit target (with a little slack, so a
 * reply is not cut one word short of 10,000) or still short of the soft "make it long" signal's minimum, and still
 * inside every safety ceiling.
 */
export function shouldContinue(args: { truncated: boolean; length: RequestedLength; generatedWords: number; segments: number; elapsedMs: number }): boolean {
  if (!args.truncated) return false
  if (args.segments >= MAX_SEGMENTS) return false
  if (args.generatedWords >= MAX_TOTAL_WORDS) return false
  if (args.elapsedMs >= MAX_DURATION_MS) return false
  if (args.length.words !== null) return args.generatedWords < Math.round(args.length.words * 0.97)
  // No explicit number: "comprehensive" and the like ask for long, not infinite. A generous floor, then stop
  // continuing once the model itself is satisfied (a normal finish) rather than chasing an arbitrary number.
  if (args.length.wantsLong) return true
  return false
}

// ---------------------------------------------------------------- the continuation instruction

/** How much of what has already been generated is sent back as immediate context — not the whole document. */
export const CONTINUATION_CONTEXT_CHARS = 2_000

/**
 * The internal instruction that continues the reply, never shown to the person.
 *
 * It carries the original request so instructions are not diluted across calls, only the tail of what has already
 * been written (full context lives in the `assistant` message placed right before this one), and how much is left,
 * so the model paces itself rather than writing another 10,000 words on top of an already-finished 9,800.
 */
export function continuationInstruction(args: { originalRequest: string; length: RequestedLength; generatedWords: number }): string {
  const remaining = args.length.words !== null ? Math.max(0, args.length.words - args.generatedWords) : null
  const lines = [
    'The previous part of this answer stopped only because the reply reached its output limit for that one call — not because it was finished.',
    'Continue it from the exact point it stopped. Do not restart, summarize, or repeat anything already written; do not write a heading like "Part 2" or announce that you are continuing. Carry on the same sentence or paragraph if it was left mid-way.',
    'Keep the same structure, style, formatting, language and terminology as what has already been written.',
    '',
    `The original request was: ${args.originalRequest}`
  ]
  if (remaining !== null) lines.push(`About ${remaining.toLocaleString()} more words would complete the requested length; do not overshoot it.`)
  return lines.join('\n')
}

// ---------------------------------------------------------------- keeping the seam clean

/**
 * Strips an accidental repeat at the join between what was already generated and what a continuation started with —
 * the model restating the end of the last sentence, say. Mirrors the same idea already used for joining long voice
 * recordings (shared/voiceInput.ts's `joinTranscripts`): the longest run of words that ends one piece and begins
 * the next is dropped from the second, not the first, so nothing already shown to the person is touched.
 */
export function dedupeSeam(before: string, after: string): string {
  const tail = before.slice(-400)
  const words = tail.split(/\s+/).filter(Boolean)
  for (let take = Math.min(20, words.length); take >= 3; take--) {
    const phrase = words.slice(-take).join(' ')
    const at = after.toLowerCase().indexOf(phrase.toLowerCase())
    // Only a match right at (or very near) the start counts — a coincidence of common words deeper in must not eat content.
    // Whatever follows the matched phrase is kept exactly as it was written, space and all — that space is what
    // separates it from the word already on the page; stripping it would fuse the two together with none at all.
    if (at !== -1 && at <= 3) return after.slice(at + phrase.length)
  }
  return after
}
