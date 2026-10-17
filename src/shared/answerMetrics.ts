/**
 * Measurable facts about one chat answer, for comparing prompt and routing changes before and after.
 *
 * Deliberately NOT a quality score. Each field is a count, a yes/no, or `null` when the question did not ask for that
 * check. A single number would hide which thing moved; these let a comparison say "now has filler" or "now over the
 * word limit" and stay honest about what was never measured (tone, correctness of prose, usefulness).
 */

export interface AnswerExpectation {
  /** Numeric answer that must appear somewhere in the text. Compared as a number, so "1,989" and "1989.0" both match. */
  answer?: string | number
  /** Substrings that must all appear (case-insensitive). */
  mustContain?: string[]
  /** The answer must be at most this many words. */
  maxWords?: number
  /** The answer must contain exactly this many bullet or numbered list items. */
  bullets?: number
  /** The honest reply is uncertain, so hedging language should be present. */
  uncertain?: boolean
}

export interface AnswerMetrics {
  wordCount: number
  /** First sentence is not a filler opener ("Great question", "Certainly", "Sure!", "As an AI"). A heuristic. */
  leadsWithAnswer: boolean
  /** How many filler openers and closers appear ("I hope this helps", "Let me know if"). */
  fillerPhrases: number
  /** The word limit was met; null when no limit was set. */
  withinMaxWords: boolean | null
  bulletCount: number
  /** The bullet count matches exactly; null when no count was set. */
  bulletsOk: boolean | null
  /** The expected number appears (normalised); null when no answer was set. */
  numericAnswerPresent: boolean | null
  /** Every required substring appears; null when none were set. */
  mustContainOk: boolean | null
  mustContainMissing: string[]
  /** An odd number of ``` fences: a code block was opened and never closed, or the reverse. */
  unbalancedCodeFence: boolean
  /** Sentences of four or more words that appear more than once (extra copies counted). */
  repeatedSentences: number
  /** Share (0 to 1, two decimals) of six-word windows that repeat an earlier window. */
  repeatedWindowShare: number
  /** Hedging or uncertainty language is present; null when the question did not expect uncertainty. */
  hedged: boolean | null
}

const OPENERS: RegExp[] = [
  /^(?:that'?s |what )?an? (?:great|good|excellent|interesting|fantastic|wonderful|fascinating|really good) (?:question|point)\b/i,
  /^(?:great|good|excellent|interesting|fantastic|wonderful|fascinating) (?:question|point)\b/i,
  /^certainly\b/i,
  /^sure(?:\s+thing)?\s*[!,.:]/i,
  /^sure\s*$/i,
  /^of course\b/i,
  /^absolutely\b/i,
  /^definitely\b/i,
  /^as an ai\b/i,
  /^as a (?:large )?language model\b/i,
  /^i(?:'d| would) be (?:happy|glad|delighted) to\b/i,
  /^i(?:'m| am) (?:happy|glad|delighted) to\b/i,
  /^happy to help\b/i,
  /^thanks? for (?:asking|your question|reaching out)\b/i
]

const FILLER: RegExp[] = [
  /\bi hope (?:this|that|it) helps\b/gi,
  /\blet me know if\b/gi,
  /\bfeel free to (?:ask|reach out|let me know)\b/gi,
  /\bdon'?t hesitate to\b/gi,
  /\bis there anything else\b/gi,
  /\bhappy to help\b/gi,
  /\bgreat question\b/gi,
  /\bas an ai\b/gi
]

const HEDGES: RegExp[] = [
  /\bi (?:don'?t|do not) know\b/i,
  /\bi (?:can'?t|cannot) (?:know|predict|see|tell|guess|access|browse|verify)\b/i,
  /\b(?:can'?t|cannot|impossible to|no way to|unable to) (?:be )?(?:know|predict|tell|say|determine|read)\b/i,
  /\bnot (?:sure|certain)\b/i,
  /\buncertain\b/i,
  /\bunclear\b/i,
  /\bit depends\b/i,
  /\bdepends (?:on|upon)\b/i,
  /\bprobably\b/i,
  /\blikely\b/i,
  /\bmight\b/i,
  /\bdon'?t have (?:access|real-?time|current|up-to-date|live)\b/i,
  /\bknowledge cut-?off\b/i,
  /\bas of my\b/i,
  /\bno one can\b/i,
  /\bcould you (?:tell|share|clarify)\b/i,
  /\bcan you (?:tell|share|clarify)\b/i,
  /\bit'?s hard to say\b/i
]

export function countWords(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

function firstSentence(text: string): string {
  const line = text
    .replace(/^[#>*_\-\s]+/, '')
    .split(/\n/)
    .find((l) => l.trim().length > 0)
  if (!line) return ''
  const m = line.match(/^.*?[.!?](?=\s|$)/)
  return (m ? m[0] : line).trim()
}

export function leadsWithAnswer(text: string): boolean {
  const first = firstSentence(text.trim())
  if (!first) return false
  return !OPENERS.some((re) => re.test(first))
}

export function countFiller(text: string): number {
  let n = 0
  for (const re of FILLER) n += (text.match(re) ?? []).length
  return n
}

/** Bullet or numbered list items outside code fences. */
export function countBullets(text: string): number {
  let inFence = false
  let n = 0
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence && /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)) n++
  }
  return n
}

export function numbersIn(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const v = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

export function hasNumericAnswer(text: string, answer: string | number): boolean {
  const want = Number(String(answer).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(want)) return false
  return numbersIn(text).some((v) => Math.abs(v - want) < 1e-9 * Math.max(1, Math.abs(want)))
}

export function hasUnbalancedFence(text: string): boolean {
  return (text.match(/^\s*```/gm) ?? []).length % 2 === 1
}

function repetition(text: string): { sentences: number; windowShare: number } {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, ' ')
  const seen = new Map<string, number>()
  let sentences = 0
  for (const raw of prose.split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
    if (s.split(' ').length < 4) continue
    const c = (seen.get(s) ?? 0) + 1
    seen.set(s, c)
    if (c > 1) sentences++
  }
  const words = prose.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const windows = new Set<string>()
  let repeated = 0
  const total = Math.max(0, words.length - 5)
  for (let i = 0; i < total; i++) {
    const w = words.slice(i, i + 6).join(' ')
    if (windows.has(w)) repeated++
    else windows.add(w)
  }
  return { sentences, windowShare: total === 0 ? 0 : Math.round((repeated / total) * 100) / 100 }
}

export function analyzeAnswer(text: string, expect: AnswerExpectation = {}): AnswerMetrics {
  const wordCount = countWords(text)
  const bulletCount = countBullets(text)
  const missing = (expect.mustContain ?? []).filter((s) => !text.toLowerCase().includes(s.toLowerCase()))
  const rep = repetition(text)
  return {
    wordCount,
    leadsWithAnswer: leadsWithAnswer(text),
    fillerPhrases: countFiller(text),
    withinMaxWords: expect.maxWords === undefined ? null : wordCount <= expect.maxWords,
    bulletCount,
    bulletsOk: expect.bullets === undefined ? null : bulletCount === expect.bullets,
    numericAnswerPresent: expect.answer === undefined ? null : hasNumericAnswer(text, expect.answer),
    mustContainOk: expect.mustContain === undefined || expect.mustContain.length === 0 ? null : missing.length === 0,
    mustContainMissing: missing,
    unbalancedCodeFence: hasUnbalancedFence(text),
    repeatedSentences: rep.sentences,
    repeatedWindowShare: rep.windowShare,
    hedged: expect.uncertain ? HEDGES.some((re) => re.test(text)) : null
  }
}
