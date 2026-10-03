/**
 * What a piece of selected text actually is.
 *
 * When somebody selects something on a page, the useful things to offer depend entirely on what they selected. A line
 * of code does not want translating; an equation does not want summarising; a web address wants opening, not defining.
 * This works out which of those it is, from the text alone, with no model and no network -- because the answer is
 * needed in the handful of milliseconds between letting go of the mouse and the orb appearing, and because a guess
 * that costs a round trip is not a guess worth having.
 *
 * Two rules run through all of it:
 *
 * **The selected text is never altered.** Everything here reads; nothing rewrites. A `normalized` form exists for
 * matching and measuring, and it is kept beside the original rather than instead of it, so every action that runs
 * later is given exactly what the person selected -- the spaces, the punctuation, the capitals and all.
 *
 * **Being unsure is an answer.** A paragraph that is mostly prose with one bracket in it is prose. The kind is only
 * reported as something specific when the text really looks like that thing, because a wrong kind shows the wrong
 * actions, and the wrong actions are worse than a plain list.
 */

/** What the selection looks like. `prose` is the honest fallback, not a failure. */
export type SelectionKind = 'prose' | 'word' | 'code' | 'math' | 'url' | 'email' | 'address' | 'date' | 'data' | 'quote'

/**
 * Why a selection may not be sent anywhere.
 *
 * `none` means nothing suspicious was found -- which is not a promise that the text is harmless, only that nothing
 * matched. The guards below are deliberately narrow: a false alarm costs somebody the use of the feature on ordinary
 * text, so each pattern has to be the shape of the real thing rather than merely reminiscent of it.
 */
export type SelectionRisk = 'none' | 'password-field' | 'secret' | 'card' | 'key'

export interface SelectionReading {
  /** Exactly what was selected. Never touched. */
  readonly raw: string
  /** Whitespace collapsed and ends trimmed. For measuring and matching only. */
  readonly normalized: string
  readonly kind: SelectionKind
  readonly risk: SelectionRisk
  /** Characters in the original. */
  readonly length: number
  /** Words in the original, counted on the normalized form. */
  readonly words: number
  /** Lines in the original. */
  readonly lines: number
  /** A guess at the written language as a two-letter code, or null when there is nothing to go on. */
  readonly language: string | null
  /** True when the selection is long enough that summarising it means anything. */
  readonly substantial: boolean
}

/** Past this, a selection is sent for analysis as an excerpt rather than whole. The original is kept either way. */
export const ANALYSIS_LIMIT = 6000

/** A whole word on its own: no spaces, and letters rather than symbols. */
const ONE_WORD = /^[\p{L}\p{M}'’-]{1,40}$/u

/**
 * A web address.
 *
 * Deliberately strict. "example.com" on its own is text somebody might want defined or searched as easily as opened,
 * so a bare host only counts when it carries a path or a scheme. Anything looser turns every sentence containing a
 * full stop into a link.
 */
const WEB_ADDRESS = /^(https?:\/\/[^\s]+|www\.[^\s]+\.[a-z]{2,}(\/[^\s]*)?|[a-z0-9-]+(\.[a-z0-9-]+)+\/[^\s]*)$/i

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

/**
 * Code.
 *
 * No single mark proves it, so this counts marks that are common in code and rare in writing, and asks for several of
 * them. A sentence with a semicolon in it is still a sentence; a line with a semicolon, braces and an arrow is not.
 */
const CODE_MARKS = [
  /[{}]/,
  /;\s*$/m,
  /\b(function|const|let|var|def|class|import|export|return|if|else|for|while|async|await|public|private|void|struct|impl|fn)\b/,
  /=>|->|::|\|\||&&|!==|===|\+=|\?\./,
  /^\s*(#include|using namespace|package |from .+ import|<\?php)/m,
  /^\s{2,}\S/m,
  /\$\w+|\w+\(\)|\w+\.\w+\(/
]

/**
 * An equation.
 *
 * It has to be mostly symbols and numbers. "I have 2 apples and 3 pears" contains digits and a plus-shaped idea and is
 * not an equation, so prose words disqualify it.
 */
const MATH_SHAPE = /^[\s\d+\-*/^()[\]{}=<>.,:;|√∑∏∫πεθλμσΩ∞≈≠≤≥±×÷%!a-zA-Z_]+$/
const MATH_OPERATOR = /[=+\-*/^√∑∏∫]|\b(sin|cos|tan|log|ln|sqrt|lim|dx|dy)\b/
const MATH_WORDS = /\b(the|a|an|and|or|is|are|was|were|this|that|with|from|have|has|will|would|can|could)\b/i

/** A date, in the forms people actually write them. */
const DATE_SHAPES = [
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?Z?$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/,
  /^(\d{1,2}\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2},?\s*)?\d{2,4}$/i,
  /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+\d{1,2}\s+\w+\s+\d{4}$/i
]

/** A postal address: a number, then a street word, then more of it. */
const ADDRESS = /\b\d+[a-z]?\s+[\p{L}\s.'-]{2,40}\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|court|ct|place|pl|close|terrace|nagar|colony|marg)\b/iu
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|\d{5}(-\d{4})?|\d{6})\b/

/** Rows and columns: several lines that each split the same way. */
const COLUMN_SPLIT = /\t| {2,}|\s*\|\s*|\s*,\s*/

/** Something quoted, with the marks still on it. */
const QUOTED = /^["“”'‘’«»](.|\s)+["“”'‘’«»]$/

/*
 * The guards.
 *
 * Each one is the shape of a real secret rather than of a word that sounds like one. "my api key is in the drawer" is
 * a sentence about a key and must stay usable; `sk-` followed by forty characters is a key.
 */
const LOOKS_SECRET = [
  /\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(?:api[_-]?key|secret|token|password|passwd|bearer)\b\s*[:=]\s*\S{8,}/i
]

/** A run of 32 or more characters with no vowels to speak of and both cases: the shape of a generated key. */
const KEY_SHAPE = /\b(?=[A-Za-z0-9+/_-]{32,}\b)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9+/_-]{32,}\b/

/** Thirteen to nineteen digits that pass the checksum a real card number passes. */
function looksLikeCard(text: string): boolean {
  for (const run of text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []) {
    const digits = run.replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) continue
    let sum = 0
    let double = false
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48
      if (double) {
        d *= 2
        if (d > 9) d -= 9
      }
      sum += d
      double = !double
    }
    if (sum % 10 === 0) return true
  }
  return false
}

/**
 * What alphabet it is written in, as a two-letter code.
 *
 * Scripts only. This can tell Devanagari from Latin, and it cannot tell Spanish from Portuguese -- so Latin text comes
 * back as `null` rather than as a guess, and nothing downstream is allowed to claim a language this did not find.
 */
function scriptOf(text: string): string | null {
  const tests: [string, RegExp][] = [
    ['ta', /[஀-௿]/],
    ['hi', /[ऀ-ॿ]/],
    ['bn', /[ঀ-৿]/],
    ['te', /[ఀ-౿]/],
    ['kn', /[ಀ-೿]/],
    ['ml', /[ഀ-ൿ]/],
    ['gu', /[઀-૿]/],
    ['pa', /[਀-੿]/],
    ['ar', /[؀-ۿ]/],
    ['he', /[֐-׿]/],
    ['ru', /[Ѐ-ӿ]/],
    ['el', /[Ͱ-Ͽ]/],
    ['th', /[฀-๿]/],
    ['ja', /[぀-ヿ]/],
    ['ko', /[가-힯]/],
    ['zh', /[一-鿿]/]
  ]
  for (const [code, pattern] of tests) if (pattern.test(text)) return code
  return null
}

function kindOf(raw: string, normalized: string): SelectionKind {
  if (normalized === '') return 'prose'
  if (EMAIL.test(normalized)) return 'email'
  if (WEB_ADDRESS.test(normalized)) return 'url'
  if (DATE_SHAPES.some((shape) => shape.test(normalized))) return 'date'

  const lines = raw.split('\n')
  const filled = lines.filter((line) => line.trim() !== '')

  // Rows and columns: three or more lines that each split into the same number of parts, more than one.
  if (filled.length >= 3) {
    const counts = filled.map((line) => line.trim().split(COLUMN_SPLIT).filter((cell) => cell !== '').length)
    const first = counts[0]!
    if (first > 1 && counts.every((n) => n === first)) return 'data'
  }

  const codeScore = CODE_MARKS.reduce((n, mark) => n + (mark.test(raw) ? 1 : 0), 0)
  if (codeScore >= 2) return 'code'

  if (MATH_SHAPE.test(normalized) && MATH_OPERATOR.test(normalized) && !MATH_WORDS.test(normalized) && /\d/.test(normalized)) return 'math'

  if (ADDRESS.test(normalized) || (POSTCODE.test(normalized) && /\d+\s+\p{L}/u.test(normalized) && normalized.split(/\s+/).length <= 14)) return 'address'

  if (QUOTED.test(normalized.trim())) return 'quote'
  if (ONE_WORD.test(normalized)) return 'word'
  return 'prose'
}

/**
 * Whether the selection may be sent anywhere.
 *
 * `inPasswordField` is told to this rather than worked out here, because only the page knows where the selection was
 * made and this file must stay usable from anywhere.
 */
function riskOf(raw: string, inPasswordField: boolean): SelectionRisk {
  if (inPasswordField) return 'password-field'
  if (LOOKS_SECRET.some((pattern) => pattern.test(raw))) return 'secret'
  if (looksLikeCard(raw)) return 'card'
  if (KEY_SHAPE.test(raw)) return 'key'
  return 'none'
}

/** Reads a selection. Cheap enough to run on every settled selection; no network, no model, no DOM. */
export function readSelection(raw: string, options: { inPasswordField?: boolean } = {}): SelectionReading {
  const normalized = raw.replace(/\s+/g, ' ').trim()
  const words = normalized === '' ? 0 : normalized.split(' ').length
  return {
    raw,
    normalized,
    kind: kindOf(raw, normalized),
    risk: riskOf(raw, options.inPasswordField === true),
    length: raw.length,
    words,
    lines: raw === '' ? 0 : raw.split('\n').length,
    language: scriptOf(raw),
    substantial: words >= 25
  }
}

/**
 * The part of a very long selection that is sent for analysis.
 *
 * It takes the beginning and the end and says, in the middle, how much was left out -- because the end of a passage
 * usually carries the conclusion, and a model given only the first six thousand characters will answer as though the
 * piece simply stopped there. The original selection is untouched and is what every action that needs the whole thing
 * is given.
 */
export function analysisExcerpt(raw: string, limit = ANALYSIS_LIMIT): { text: string; shortened: boolean } {
  if (raw.length <= limit) return { text: raw, shortened: false }
  const head = Math.floor(limit * 0.7)
  const tail = limit - head
  const missing = raw.length - limit
  const text = `${raw.slice(0, head)}\n\n[... ${missing.toLocaleString('en')} characters of the selection are not shown here ...]\n\n${raw.slice(-tail)}`
  // A selection only just over the limit costs more in explaining the gap than the gap saves. Send that one whole.
  return text.length < raw.length ? { text, shortened: true } : { text: raw, shortened: false }
}

/** A few words of the selection, for showing what an action is about. Never the whole thing. */
export function selectionPreview(raw: string, limit = 90): string {
  const normalized = raw.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`
}

/** Plain words for why a selection is being held back, for showing to the person. */
export const RISK_REASON: Readonly<Record<Exclude<SelectionRisk, 'none'>, string>> = Object.freeze({
  'password-field': 'This is a password box, so Orbis will not read it.',
  secret: 'This looks like a secret, so Orbis will not send it anywhere.',
  card: 'This looks like a card number, so Orbis will not send it anywhere.',
  key: 'This looks like a key or token, so Orbis will not send it anywhere.'
})
