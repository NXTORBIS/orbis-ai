import { bestFor, routable } from './modelRoute.ts'
import { CHAT_MODELS } from './models.ts'
import type { ModelInfo, ModelStrength } from './types.ts'

/**
 * Whether a finished reply is plainly broken, so it can be asked for once more from a stronger model.
 *
 * The rule the whole file turns on: **length is never a problem.** "4" and "Yes." are complete answers. Every check
 * here looks for a specific, visible way a reply fails -- nothing at all, cut off in the middle of a sentence or a
 * code block, a loop saying the same line again and again, a claim that it cannot see something that was never
 * needed, or a reply that is only a polite noise. When in doubt a reply is fine: a needless retry costs a second model
 * call, but a retry that replaces a good answer is worse than the weak one it was meant to fix.
 */

export type ReplyProblemCode = 'empty' | 'filler' | 'unclosed-code' | 'cut-off' | 'dangling' | 'repetition' | 'false-refusal'

export interface ReplyProblem {
  code: ReplyProblemCode
  /** Plain words, for a log line. */
  message: string
}

export interface ReplyContext {
  /** What the person asked, in their words. */
  userText: string
  /** Files were attached to the message. */
  hasAttachments?: boolean
  /** A page, search results or an earlier artifact were put in front of the model. */
  hasPageContext?: boolean
}

export interface ReplyAssessment {
  ok: boolean
  problems: ReplyProblem[]
}

/** Below this a missing full stop means nothing: short replies are often a phrase. */
const LONG_REPLY = 600

const FILLER = [
  'sure', 'certainly', 'of course', 'absolutely', 'great question', 'good question', 'let me think', 'let me think about that', 'let me see',
  'let me check', 'one moment', 'just a moment', 'give me a moment', 'here you go', 'here it is', 'here is the answer', "here's the answer",
  "i'd be happy to help", 'i would be happy to help', 'happy to help', "i'll help with that", 'thinking', 'working on it', 'okay, let me', 'alright'
]

const TERMINAL = /[.!?…。！？)\]}"'”’»*_`~:;|>]$|\p{Extended_Pictographic}$|\d$/u

const CONNECTIVE_START = /^\s*(?:[-*•+>#|]|\d+[.)]|```)/

const NEEDS_THE_WORLD =
  /\b(my (?:e-?mails?|inbox|files?|calendar|screen|computer|camera|account|folder|drive|desktop)|this (?:link|url|page|image|photo|picture|file|video|screenshot|document|pdf|site|website)|https?:\/\/|www\.|attached|screenshot|real[- ]time|live (?:score|data|price|feed)|right now|today'?s|currently|weather|stock price|latest news|open (?:the|this) )/i

const REFUSAL_TO_SEE =
  /\bI(?:'m| am)? (?:can(?:no|')t|cannot|am unable to|'m unable to|am not able to|'m not able to|don't have (?:the ability|access) to|do not have (?:the ability|access) to) (?:access|see|view|open|read|browse|look at|load|check|visit)\b/i

const CREATIVE_REPEAT = /\b(poem|song|lyrics?|chorus|verse|refrain|rhyme|repeat|mantra|chant|loop|times)\b/i

const normalise = (s: string): string => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/^[\s\-*•+>\d.)]+/, '').trim()

/** The lines outside code fences. Repeated lines of code (a closing brace, a log call) are normal. */
function proseLines(text: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) out.push(line)
  }
  return out
}

function fenceCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^\s*```/.test(line)).length
}

function mostRepeated(items: string[]): number {
  const seen = new Map<string, number>()
  let most = 0
  for (const item of items) {
    const n = (seen.get(item) ?? 0) + 1
    seen.set(item, n)
    if (n > most) most = n
  }
  return most
}

const PUNCTUATION_RUN = /[\s.!,…:;—-]+/g
// Every phrase above is plain letters, spaces and apostrophes, so none needs escaping inside a pattern.
const FILLER_LONGEST_FIRST = [...FILLER].sort((a, b) => b.length - a.length)

/** Whether a reply is only polite filler, with nothing in it that answers. */
function isOnlyFiller(text: string, user: string): boolean {
  // "Can you help me?" -- "Sure!" is the whole correct answer.
  if (/^\s*(?:can|could|will|would|are|do|did|is|may)\s+(?:you|we|i|orion|orbis)\b/i.test(user)) return false
  let rest = text.toLowerCase().replace(PUNCTUATION_RUN, ' ').trim()
  if (!rest) return false
  // Longest phrases first, so "let me think about that" is not left with "about that".
  for (const phrase of FILLER_LONGEST_FIRST) {
    rest = rest.replace(new RegExp('(?<!\\p{L})' + phrase + '(?!\\p{L})', 'gu'), ' ')
  }
  rest = rest.replace(/\s+/g, ' ').trim()
  return rest === ''
}

export function assessReply(text: string, ctx: ReplyContext): ReplyAssessment {
  const problems: ReplyProblem[] = []
  const add = (code: ReplyProblemCode, message: string): void => void problems.push({ code, message })
  const reply = text ?? ''
  const trimmed = reply.trim()

  if (trimmed === '') {
    add('empty', 'The reply is empty.')
    return { ok: false, problems }
  }

  const user = ctx.userText ?? ''

  if (isOnlyFiller(trimmed, user)) add('filler', 'The reply is only a polite phrase and answers nothing.')

  // ----- cut off -----
  if (fenceCount(trimmed) % 2 === 1) add('unclosed-code', 'A code block was opened and never closed.')

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim() !== '')
  const lastLine = lines.at(-1) ?? ''
  const closedFences = fenceCount(trimmed) % 2 === 0
  if (/^\s*(?:[-*•+]|\d+[.)])\s*$/.test(lastLine)) {
    add('dangling', 'The reply ends on an empty list item.')
  } else if (closedFences && trimmed.length >= 20 && /:\s*$/.test(lastLine) && !/^\s*(?:#|\|)/.test(lastLine)) {
    // A line that ends in a colon promises something that did not arrive.
    add('dangling', 'The reply ends on a colon, promising something that never came.')
  } else if (
    closedFences &&
    trimmed.length >= LONG_REPLY &&
    !TERMINAL.test(trimmed) &&
    !CONNECTIVE_START.test(lastLine) &&
    !/^\s{4,}\S/.test(lastLine) &&
    !/https?:\/\/\S+$/.test(lastLine) &&
    lastLine.trim().length >= 30 &&
    /[\p{L}\p{M},-]$/u.test(trimmed)
  ) {
    add('cut-off', 'A long reply stops in the middle of a sentence.')
  }

  // ----- repetition -----
  const creative = CREATIVE_REPEAT.test(user)
  const prose = proseLines(trimmed)
  const lineThreshold = creative ? 6 : 3
  const repeatedLines = mostRepeated(prose.map(normalise).filter((l) => l.length >= 12 && !/^[\s|:\-=_*#~]+$/.test(l)))
  const sentenceBits = prose
    .join('\n')
    .split(/(?<=[.!?])\s+/)
    .map(normalise)
    .filter((s) => s.length >= 15)
  const repeatedSentences = mostRepeated(sentenceBits)
  const loops = !creative && trimmed.length >= 120 && /([^\n]{20,}?)\1{3,}/s.test(prose.join('\n').slice(-20000))
  if (repeatedLines >= lineThreshold || repeatedSentences >= lineThreshold || loops) add('repetition', 'The reply repeats the same words over and over.')

  // ----- a refusal to look at something that was never needed -----
  if (
    !ctx.hasAttachments &&
    !ctx.hasPageContext &&
    trimmed.length <= 400 &&
    REFUSAL_TO_SEE.test(trimmed) &&
    !NEEDS_THE_WORLD.test(user)
  ) {
    add('false-refusal', 'The reply says it cannot look at something, but nothing was needed to answer.')
  }

  return { ok: problems.length === 0, problems }
}

/**
 * The model to try when a reply came out weak: a different one, with more reasoning behind it, never the one that
 * just failed. Null when the table has no other candidate, in which case the weak reply is kept.
 *
 * "Different" means a different service model, not just a different id: ORION Pro is ORION Ultra with thinking off, so
 * asking it again would be asking the same weights the same question.
 */
export function strongerModel(
  current: string,
  input: { need?: ModelStrength; roomNeeded?: number },
  models: readonly ModelInfo[] = CHAT_MODELS
): ModelInfo | null {
  const now = models.find((m) => m.id === current)
  const sameWeights = (m: ModelInfo): boolean => m.id === current || (now !== undefined && (m.apiModel ?? m.id) === (now.apiModel ?? now.id))
  const others = routable(models).filter((m) => !sameWeights(m))
  if (!others.length) return null
  const room = input.roomNeeded ?? 0
  // Reasoning first: what a weak reply most needs is a model that thinks harder. Then what the message was about.
  const order: ModelStrength[] = ['reasoning', ...(input.need && input.need !== 'reasoning' ? [input.need] : []), 'everyday']
  for (const need of order) {
    const found = bestFor(need, room, others)
    if (found) return found
  }
  return null
}

/** Whether the retry should be offered at all, from what the message carried. */
export function canRetry(opts: { hasImages: boolean; aborted: boolean }): boolean {
  return !opts.hasImages && !opts.aborted
}
