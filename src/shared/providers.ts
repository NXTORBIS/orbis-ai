/**
 * The two services Orbis asks, and which one each job goes to.
 *
 * Orbis had one provider and one key list, and that was fine until it was asked to look at something. Groq serves no
 * model on this account that can see an image -- so the picture was built, encoded, attached, and then dropped by the
 * one line in `nim.ts` that checks `model.vision` before sending it. Everything worked and nothing looked.
 *
 * So there are two now, and the division is not about preference. It is about what each can actually do:
 *
 *   - **Text stays on Groq.** Its largest model is 120 billion parameters; the largest Mistral model this account can
 *     reach is 14 billion. Moving text to Mistral would be a downgrade dressed as an upgrade.
 *   - **Anything with an image goes to Mistral**, because Groq cannot do it at all.
 *   - **Generated Page code goes to Codestral**, which is built for it.
 *   - **Either can stand in for the other's text work**, so one service being down degrades Orbis rather than stopping
 *     it.
 *
 * Nothing here holds a key. A provider is a name, an address and a rate; the keys live in the main process and are
 * passed in, so this file can be tested and can be read without any secret being anywhere near it.
 */

export type ProviderId = 'groq' | 'mistral'

export interface Provider {
  id: ProviderId
  label: string
  /** The OpenAI-shaped chat endpoint's base. Both services speak the same request shape. */
  baseUrl: string
}

export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = Object.freeze({
  groq: { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  mistral: { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' }
})

/**
 * What a model is for, so a job can ask for a kind rather than name a model.
 *
 * Naming a model at a call site is how a call site comes to depend on a model that gets retired. Asking for "something
 * that can look at a page" survives the model changing underneath it.
 */
export type Job =
  /** Ordinary conversation and reasoning. */
  | 'text'
  /** Looking at a page to pick one of its elements: short question, short answer, happens mid-task. */
  | 'glance'
  /** A person's own question about an image, where they are waiting for an answer they care about. */
  | 'look'
  /** Writing the code of a generated Page. */
  | 'code'

export interface Choice {
  provider: ProviderId
  model: string
  why: string
}

/**
 * Which model does a job, and what to fall back to.
 *
 * The order is measured rather than assumed. Every entry below was tried against the real services in October 2026:
 * `requests per second` turned out to be the binding limit, not tokens -- so a model with an enormous token allowance
 * and half a request per second cannot be a default however good it is.
 */
const LADDER: Readonly<Record<Job, readonly Choice[]>> = Object.freeze({
  text: [
    { provider: 'groq', model: 'openai/gpt-oss-120b', why: '120 billion parameters, the most capable model Orbis can reach' },
    { provider: 'groq', model: 'openai/gpt-oss-20b', why: 'smaller, and still on the service that holds the conversation' },
    { provider: 'mistral', model: 'ministral-14b-2512', why: 'a different service entirely, so Groq being down is a worse answer rather than no answer' }
  ],
  glance: [
    /*
     * 8b rather than the larger one, deliberately.
     *
     * The question is "which of these numbered things is the one described", asked while somebody waits. 14b is
     * cleverer and rate-limited to one request every two seconds, which for a step in a running task is worse than a
     * slightly less clever answer now. 3b answered a real screenshot correctly in 1.2 seconds.
     */
    { provider: 'mistral', model: 'ministral-8b-2512', why: 'sees, and allows three requests a second' },
    { provider: 'mistral', model: 'ministral-3b-2512', why: 'twelve requests a second, for when the task is looking repeatedly' }
  ],
  look: [
    { provider: 'mistral', model: 'ministral-14b-2512', why: 'the best eyes available, and a person asking once can wait' },
    { provider: 'mistral', model: 'ministral-8b-2512', why: 'quicker, when the better one is busy' }
  ],
  code: [
    { provider: 'mistral', model: 'codestral-2508', why: 'built for writing code, 256,000 tokens of context, and fill-in for repairs' },
    { provider: 'mistral', model: 'ministral-14b-2512', why: 'general, for when Codestral is busy' }
  ]
})

/**
 * The models to try for a job, best first, limited to the services that have keys.
 *
 * A provider with no keys is not offered at all rather than attempted and failed: a fallback that cannot work is not a
 * fallback, and trying it costs a round trip and produces an error about authentication rather than about the thing
 * that was asked for.
 */
export function modelsFor(job: Job, have: { groq: boolean; mistral: boolean }): Choice[] {
  return LADDER[job].filter((c) => have[c.provider])
}

/** The first thing to try for a job, or null when nothing can do it. */
export function modelFor(job: Job, have: { groq: boolean; mistral: boolean }): Choice | null {
  return modelsFor(job, have)[0] ?? null
}

/**
 * Why a job cannot be done, in words a person can act on.
 *
 * Specific about which service is missing, because "no model available" tells somebody nothing and "Orbis has no key
 * for Mistral, which is the only service here that can look at an image" tells them exactly what to do.
 */
export function cannotDo(job: Job, have: { groq: boolean; mistral: boolean }): string | null {
  if (modelsFor(job, have).length > 0) return null
  const needed = [...new Set(LADDER[job].map((c) => PROVIDERS[c.provider].label))]
  if (job === 'glance' || job === 'look') {
    return `Looking at an image needs ${needed.join(' or ')}, and Orbis has no key for it. Nothing on the other service can see.`
  }
  if (job === 'code') return `Writing a Page's code needs ${needed.join(' or ')}, and Orbis has no key for it.`
  return `Orbis has no key for ${needed.join(' or ')}.`
}

/**
 * Which key to use for a request, by position rather than at random.
 *
 * Requests per second is the limit that actually bites -- several accounts multiply the request rate, and only if the
 * requests are spread across them. Rotating per request is the whole point; rotating per session would leave one key
 * doing all the work and the rest idle while that one is throttled.
 */
export function keyFor(keys: readonly string[], sequence: number): string | null {
  if (!keys.length) return null
  // Math.abs, so a counter that has been allowed to go negative does not index backwards off the array.
  return keys[Math.abs(Math.trunc(sequence)) % keys.length]
}

/**
 * What a refusal from a provider actually means.
 *
 * Mistral answers `429 "Rate limit exceeded"` both for a quota that will recover in a minute and for a model its plan
 * does not really give you -- and `403` for one that is not in the tier at all. Told apart, because the first is worth
 * retrying on another key and the second is worth never trying again this session. Treated the same, Orbis either
 * hammers a model it will never be allowed to use, or gives up on one that was briefly busy.
 */
export function refusalKind(status: number, body: string): 'busy' | 'not-allowed' | 'bad-key' | 'other' {
  const text = String(body ?? '')
  if (status === 401 || /invalid_api_key/.test(text)) return 'bad-key'
  if (status === 403 || /labs_not_enabled|not available in your subscription/i.test(text)) return 'not-allowed'
  if (status === 429) return 'busy'
  if (status === 400 && /invalid model/i.test(text)) return 'not-allowed'
  return 'other'
}
