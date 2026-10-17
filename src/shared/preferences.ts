/**
 * Noticing a STANDING preference in something the person typed: "always answer in short bullet points", "call me Sam",
 * "I use TypeScript and pnpm", "never use emojis".
 *
 * Precision over recall. A missed preference costs nothing (they can still say "remember that ..."); a wrong one is an
 * offer on screen that should never have appeared. So only a few plain shapes are recognised, and anything that reads
 * as a question, a one-off ("this time", "for now", "just"), a hypothetical, or a secret is left alone.
 *
 * This only ever PROPOSES text. Nothing is saved here or by the caller without the person pressing Remember; saving goes
 * through the existing memory store (see memory.ts), so the secret check there still applies.
 */
import { checkMemory } from './memory.ts'

export interface StandingPreference {
  /** What would be remembered, in the person's own words, tidied. */
  text: string
  kind: 'style' | 'name' | 'tools'
  /** How to ask about it, when reading the stored wording back as a question would come out stilted. */
  question?: string
}

const ONE_OFF = /\b(?:this time|for now|just (?:this|for|once|now|today)|only (?:this|for|once|now|today)|right now|this once|today|tonight|tomorrow|at the moment|in this (?:chat|conversation|thread|message)|for this (?:one|chat|conversation|message|question|task|answer|reply)|for (?:this|that)\b|for the next|next (?:message|reply|answer|time))\b/i
const HYPOTHETICAL = /\b(?:if i|when i ask|whenever i ask|should i|would it|pretend|imagine|suppose|for example|e\.g\.|as if|hypothetically)\b/i
/** "Do not use emojis" opens with "do" and is an instruction, not a question, so that one word is let through. */
const QUESTION_START = /^(?:what|who|when|where|why|how|which|is|are|do(?!n'?t\b| not\b)|does|did|can|could|should|would|will|shall|may|might|have|has)\b/i
const POLITE_PREFIX = /^(?:(?:hey|ok|okay|hi|so|and|also|btw|by the way|oh)[,\s]+)*(?:orion[,\s]+|orbis[,\s]+)?(?:please[,\s]+|pls[,\s]+)?/i
const TIME_PREFIX = /^(?:from now on|going forward|from here on|in (?:the )?future|by default|as a rule)[,:\s]+/i
const TIME_SUFFIX = /[,\s]+(?:from now on|going forward|from here on|in (?:the )?future|by default|every time|always)$/i

/** Verbs that make "always/never ..." a way of working rather than "never mind" or "always late". */
const STYLE_VERBS = 'answer|answers|reply|replies|respond|responses|write|use|explain|keep|give|show|format|speak|address|include|add|avoid|skip|start|begin|end|summari[sz]e|cite|put|make|talk|lead|prefix|open|close|sign|number|bold|quote|translate|spell|refer'
const ALWAYS_NEVER = new RegExp(`^(always|never)\\s+(?:${STYLE_VERBS})\\b[^?]{3,110}$`, 'i')
const STOP_DOING = /^(?:stop|quit)\s+(?:using|adding|including|saying|apologi[sz]ing|writing|giving|starting|ending)\s+[^?]{2,80}$/i
const YOU_SHOULD = new RegExp(`^(?:i (?:want|need|would like|'d like|d like) you to|you (?:should|must|need to|have to)|make sure (?:you|to)|i (?:want|need) it to)\\s+(always|never)\\s+(?:${STYLE_VERBS})\\b[^?]{3,110}$`, 'i')
const WITH_TIME_MARKER = new RegExp(`^(?:${STYLE_VERBS}|do not|don't|dont|only|no more)\\b[^?]{4,110}$`, 'i')
const CALL_ME = /^(?:you can |feel free to |just )?(?:call|address) me (?:by |as )?(?:"|')?([A-Za-z][\w'-]{1,24}(?: [A-Za-z][\w'-]{1,24})?)(?:"|')?$/i
const NOT_A_NAME = new Set('back later when if maybe anytime now please crazy a an the it this that again sometime tomorrow today whenever then soon at on in about names name'.split(' '))
const I_USE = /^i (?:always |mostly |usually )?(?:use|code in|write in|work with|work in|prefer|develop in|build with|run)\s+(.{2,80})$/i
const OBJECT_NOT_A_TOOL = /^(?:option|choice|answer|number|plan|version|it|this|that|these|those|them|the|a|an|my|your|some|any|here|there|to|one|which|what|more|less|both)\b/i

function tidy(sentence: string): string {
  let t = sentence.trim().replace(/[.!]+$/, '').trim()
  // A quote left dangling by the sentence split is dropped; a matched pair is kept, because it is part of what they said.
  if (((t.match(/["“”]/g) ?? []).length & 1) === 1) t = t.replace(/["“”]\s*$/, '').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function candidates(message: string): string[] {
  return message
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function viable(s: string): boolean {
  if (s.length < 8 || s.length > 160) return false
  if (/\?\s*$/.test(s) || ONE_OFF.test(s) || HYPOTHETICAL.test(s)) return false
  if (QUESTION_START.test(s.replace(POLITE_PREFIX, ''))) return false
  return true
}

/** One sentence as a standing preference, or null. */
function fromSentence(raw: string): StandingPreference | null {
  if (!viable(raw)) return null
  const s = raw.replace(POLITE_PREFIX, '').replace(/[.!]+$/, '').trim()

  const name = CALL_ME.exec(s)
  if (name) {
    const who = name[1].trim()
    if (who.split(' ').some((w) => NOT_A_NAME.has(w.toLowerCase()))) return null
    return { text: `Prefers to be called ${who}`, kind: 'name', question: `Remember to call you ${who}?` }
  }

  const you = YOU_SHOULD.exec(s)
  if (you) return { text: tidy(s.replace(/^.*?(always|never)\s/i, (_m, w: string) => `${w} `)), kind: 'style' }

  const hadPrefix = TIME_PREFIX.test(s)
  const hadSuffix = TIME_SUFFIX.test(s) && !/^(?:always|never)\b/i.test(s)
  if (hadPrefix || hadSuffix) {
    const core = s.replace(TIME_PREFIX, '').replace(TIME_SUFFIX, '').trim()
    if (WITH_TIME_MARKER.test(core) && !QUESTION_START.test(core)) return { text: tidy(core), kind: 'style' }
    return null
  }

  if (ALWAYS_NEVER.test(s) || STOP_DOING.test(s)) return { text: tidy(s), kind: 'style' }

  const use = I_USE.exec(s)
  if (use) {
    const object = use[1].trim()
    const words = object.split(' ').length
    if (OBJECT_NOT_A_TOOL.test(object) || words > 9 || /\b(?:to|because|when|while|if|so)\b/i.test(object) || /^\d+$/.test(object)) return null
    return { text: tidy(s), kind: 'tools' }
  }
  return null
}

/**
 * The standing preference stated in this message, if there plainly is one.
 *
 * The first matching sentence wins; a message that states a secret never offers anything.
 */
export function standingPreference(message: string): StandingPreference | null {
  if (typeof message !== 'string' || message.length > 600) return null
  for (const sentence of candidates(message)) {
    const found = fromSentence(sentence)
    if (!found) continue
    const checked = checkMemory(found.text)
    if (checked.ok) return { ...found, text: checked.text }
    return null
  }
  return null
}

/** The question shown on the chip, short enough for one line. */
export function preferenceQuestion(p: StandingPreference): string {
  if (p.question) return p.question
  const t = p.text.length > 90 ? `${p.text.slice(0, 87)}...` : p.text
  const lower = /^[A-Z][a-z]/.test(t) ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : t
  return `Remember: ${lower}?`
}
