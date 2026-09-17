/**
 * ORION Auto: choosing an Orion model for each message rather than for the whole conversation.
 *
 * A two-word question does not need the slowest, most careful model, and a proof or a debugging session should not get
 * the quickest one. The choice is made from what the message is plainly asking for, without a model call of its own —
 * routing that costs a round trip is slower than just using a good default. Nothing here is hidden: the reply says which
 * model answered, and a person who picks a model themselves always gets that model.
 */

export const AUTO_MODEL = 'orion/auto'

export const CORE = 'openai/gpt-oss-20b'
export const MAX = 'openai/gpt-oss-120b'
export const ULTRA = 'qwen/qwen3.8-27b'

export interface RouteInput {
  text: string
  /** Attached files, by size in characters, since long material needs a stronger reader. */
  attachmentChars?: number
  /** Earlier turns in this conversation. */
  turns?: number
}

export interface Route {
  model: string
  /** Short and plain, for diagnostics: why this model. */
  reason: string
}

const REASONING = /\b(prove|proof|derive|derivation|step[- ]by[- ]step|reason through|analy[sz]e|analysis|trade-?offs?|compare|comparison|evaluate|debug|bug|stack ?trace|error|exception|algorithm|complexity|optimi[sz]e|refactor|architecture|design (?:a|the)|strategy|plan (?:for|out)|calculate|equation|integral|derivative|probability|statistics|regression|why does|why is|how does .{3,40} work)\b/i
const CODE = /```|\b(function|class|const|let|def|import|return|SELECT|FROM|WHERE)\b.*[;{(=]|\b(typescript|javascript|python|rust|golang|java|c\+\+|sql|regex|react|node\.?js|compile|runtime)\b/i
const MATH = /[∫∑√π≤≥≠]|\b\d+\s*[-+*/^]\s*\d+\s*[-+*/^=]|\$[^$]+\$/
const WRITING = /\b(write|draft|rewrite|reword|polish|proofread|edit|essay|article|blog|story|poem|lyrics|cover letter|email|letter|speech|caption|tagline|slogan|summari[sz]e (?:this|the following)|make (?:it|this) (?:sound|more))\b/i

/** The model for one message, and why. */
export function routeModel(input: RouteInput): Route {
  const text = input.text.trim()
  const long = text.length > 700 || (input.attachmentChars ?? 0) > 6000

  if (CODE.test(text)) return { model: MAX, reason: 'code' }
  if (MATH.test(text)) return { model: MAX, reason: 'maths' }
  if (REASONING.test(text)) return { model: MAX, reason: 'needs careful reasoning' }
  if (WRITING.test(text)) return { model: ULTRA, reason: 'writing' }
  if (long) return { model: MAX, reason: 'long material' }
  return { model: CORE, reason: 'everyday question' }
}

/** The model a request really uses: Auto becomes a concrete model; anything else is exactly what was chosen. */
export function resolveModel(requested: string, input: RouteInput): Route {
  return requested === AUTO_MODEL ? routeModel(input) : { model: requested, reason: 'chosen' }
}
