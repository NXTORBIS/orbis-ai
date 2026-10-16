import { CHAT_MODELS, DEFAULT_MODEL, modelInfo } from './models.ts'
import type { ModelInfo, ModelStrength } from './types.ts'

/**
 * ORION Auto: choosing an Orion model for each message rather than for the whole conversation.
 *
 * A two-word question does not need the slowest, most careful model, and a proof or a debugging session should not get
 * the quickest one. The choice is made from what the message is plainly asking for, without a model call of its own --
 * routing that costs a round trip is slower than just using a good default. Nothing here is hidden: the reply says which
 * model answered, and a person who picks a model themselves always gets that model.
 *
 * **What changed, and why it matters.** This file used to name three models by id. That meant two silent failures:
 * retiring a model left Auto pointing at an id the service no longer served, and a better model added to the table
 * could never be chosen however good it was, because nothing here knew it existed. So the models are no longer named
 * here at all. What a message needs is worked out here; which model meets that need is read from the model table,
 * where each model says what it is good at and how much it can hold. Changing the models is now editing one table.
 *
 * Two rules:
 *
 * **Only a model that is really there is ever chosen.** The candidates are the models a person could pick; a model
 * that has been removed cannot be routed to, because it is not in the list being read.
 *
 * **Nothing is claimed about a model that the table does not say.** A model with no strengths listed is never chosen
 * by Auto -- not because it is bad, but because nobody has written down what it is for, and guessing is how a picture
 * ends up at a model that cannot see.
 */

export const AUTO_MODEL = 'orion/auto'

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

/** What a message is asking for, and the words for it. The order is the order they are checked in. */
const NEEDS: { need: ModelStrength; reason: string; matches(text: string): boolean }[] = [
  { need: 'code', reason: 'code', matches: (t) => CODE.test(t) },
  { need: 'maths', reason: 'maths', matches: (t) => MATH.test(t) },
  { need: 'reasoning', reason: 'needs careful reasoning', matches: (t) => REASONING.test(t) },
  { need: 'writing', reason: 'writing', matches: (t) => WRITING.test(t) }
]

/** Roughly how many characters fit in a model's input, from what the table says about it. */
export function inputRoomOf(model: ModelInfo): number {
  // About four characters to a token. The stricter of the two limits is the one that actually binds.
  const tokens = Math.min(model.contextWindow, model.inputTokenLimit ?? model.contextWindow)
  return tokens * 4
}

/** The models Auto may choose between: ones a person could pick, that say what they are for. */
export function routable(models: readonly ModelInfo[] = CHAT_MODELS): ModelInfo[] {
  return models.filter((one) => one.id !== AUTO_MODEL && (one.strengths?.length ?? 0) > 0)
}

/**
 * The best model for a need, given how much has to fit, or null when nothing in the table claims it.
 *
 * Among the models that claim the need, the one with the most room wins, and a tie is broken by the order of the
 * table -- which is the order somebody wrote them in, best first.
 */
export function bestFor(need: ModelStrength, roomNeeded: number, models: readonly ModelInfo[] = CHAT_MODELS): ModelInfo | null {
  const able = routable(models).filter((one) => one.strengths!.includes(need))
  const fits = able.filter((one) => inputRoomOf(one) >= roomNeeded)
  // Nothing has room for it: the roomiest is still the least bad, and history is trimmed to fit either way.
  const pool = fits.length ? fits : able
  if (!pool.length) return null
  return pool.reduce((best, one) => (inputRoomOf(one) > inputRoomOf(best) ? one : best))
}

/**
 * How hard a message looks, from 0 (a greeting) up. No model call: only what is plainly on the page.
 *
 * It exists for the messages the keyword needs above miss: "why does my sourdough collapse and what should I change
 * on the next bake" has no code, no maths and no verb like "analyse", yet it is a two-part, why-and-how question that
 * a quick model answers thinly. Each signal below is something a careful reader would also count.
 */
export function difficulty(text: string, turns = 0): number {
  const t = text.trim()
  if (!t) return 0
  let score = 0
  const words = t.split(/\s+/).length
  if (words >= 40) score += 1
  if (words >= 120) score += 1
  // Several questions in one message, or an explicit numbered/bulleted list of things to do.
  if ((t.match(/\?/g) ?? []).length >= 2) score += 1
  if ((t.match(/^\s*(?:\d+[.)]|[-*•])\s+/gm) ?? []).length >= 3) score += 1
  // Causal and procedural asks need more than a lookup.
  if (/\b(why (?:does|do|is|are|did|would|can't|cannot)|how (?:does|do|would|should|can|could) (?:i|we|you|it|one|this|that)\b.*\b(?:and|then|so that|while)\b|what(?:'s| is) the difference|pros and cons|should i|which is better|root cause|best way to)\b/i.test(t)) score += 1
  /*
   * Two different things asked in one message: "why does X ... and how should I Y".
   *
   * Only once the message is long enough to really be two asks. "And what about the second one? Does that change it?"
   * has two question words and is a cheap follow-up, which is why the length guard is here rather than the count alone.
   */
  if (words >= 12) {
    const asked = new Set((t.toLowerCase().match(/\b(why|how|what|which|when|where|should|can|could|would)\b/g) ?? []))
    if (asked.size >= 2) score += 1
  }
  // Constraints stacked on a request ("under 100 words, for beginners, with an example, in a table").
  if ((t.match(/\b(?:under|within|at most|at least|exactly|only|without|must|should not|don't|do not)\b/gi) ?? []).length >= 3) score += 1
  // A long running conversation usually means the question leans on what came before.
  if (turns >= 8) score += 1
  // A greeting or a thanks is never hard, whatever else is true.
  if (words <= 4 && /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|cool|great)\b/i.test(t)) return 0
  return score
}

/** From this score a message with no keyword need is still treated as needing careful reasoning. */
export const HARD_FROM = 2

/** The model for one message, and why. */
export function routeModel(input: RouteInput, models: readonly ModelInfo[] = CHAT_MODELS): Route {
  const text = input.text.trim()
  const roomNeeded = text.length + (input.attachmentChars ?? 0)
  const long = text.length > 700 || (input.attachmentChars ?? 0) > 6000

  const matched = NEEDS.find((one) => one.matches(text))
  const hard = !matched && difficulty(text, input.turns ?? 0) >= HARD_FROM
  const wanted = matched ?? (hard ? { need: 'reasoning' as ModelStrength, reason: 'a hard, multi-part question' } : undefined)
  const order: { need: ModelStrength; reason: string }[] = [
    ...(wanted ? [{ need: wanted.need, reason: wanted.reason }] : []),
    ...(long ? [{ need: 'long' as ModelStrength, reason: 'long material' }] : []),
    { need: 'everyday', reason: 'everyday question' }
  ]

  for (const step of order) {
    const found = bestFor(step.need, roomNeeded, models)
    if (found) return { model: found.id, reason: step.reason }
  }

  /*
   * Nothing in the table claims anything.
   *
   * This is not a case anybody should reach, and it is handled rather than thrown because a routing failure must
   * never be the reason a message does not get an answer. The default model is what a person gets without Auto.
   */
  return { model: DEFAULT_MODEL, reason: 'nothing else to choose from' }
}

/** The model a request really uses: Auto becomes a concrete model; anything else is exactly what was chosen. */
export function resolveModel(requested: string, input: RouteInput, models: readonly ModelInfo[] = CHAT_MODELS): Route {
  return requested === AUTO_MODEL ? routeModel(input, models) : { model: requested, reason: 'chosen' }
}

/** How much a model can write in one reply, or null when nobody has measured it. Never guessed at. */
export const outputRoomOf = (id: string): number | null => modelInfo(id).maxOutputTokens ?? null
