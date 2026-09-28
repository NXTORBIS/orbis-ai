/**
 * One vocabulary for things going wrong, across the whole of Orbis.
 *
 * Every subsystem already has its own way of failing. The Browser Control Layer has `ControlErrorCode`. The helper
 * throws `HelperError` with its own strings. Workflows raise validation issues. Research reports a `problem`. Each is
 * reasonable on its own, and together they mean that the one thing a recovery engine needs -- *what kind of failure is
 * this?* -- has to be reconstructed by reading prose, differently, in every place that cares.
 *
 * So this is the shared taxonomy (§119). It does not replace any of those: it is what they map *onto*, so that code
 * deciding whether to retry, re-plan, ask a person or stop can ask one question and get one answer.
 *
 * Two properties carry the actual decision, and they are deliberately separate:
 *
 *   - `retryable` — would doing the same thing again plausibly work? A timeout, yes. A permission refusal, never.
 *   - `userFixable` — is a person the only thing that can get past this? A sign-in, yes. A network blip, no.
 *
 * A failure that is neither is one to stop on and report honestly, which is a real and common outcome rather than a
 * gap in the list.
 */

export type OrbisErrorKind =
  /** The request was malformed before anything was attempted. */
  | 'validation'
  /** A permission or policy refused it. Not a thing to retry. */
  | 'permission'
  /** Who you are could not be established: a sign-in, a token that expired. */
  | 'authentication'
  /** Who you are was established, and is not allowed to do this. */
  | 'authorization'
  /** The thing being acted on is not there. */
  | 'not-found'
  /** Something else changed it first. */
  | 'conflict'
  /** What was known about it is out of date: the page moved, the element went away. */
  | 'stale'
  /** It took too long. */
  | 'timeout'
  /** The network did not carry it. */
  | 'network'
  /** An external provider failed or refused. */
  | 'provider'
  /** Orbis cannot do this here: the capability is absent, or unavailable right now. */
  | 'unavailable'
  /** A limit was reached: memory, disk, concurrency, quota. */
  | 'resource'
  /** The person stopped it, or declined. */
  | 'cancelled'
  /** A security boundary refused it. Never worked around. */
  | 'security'
  /** Stored data is not what it should be. */
  | 'corruption'
  /** Moving data between versions failed. */
  | 'migration'
  /** It ran, and afterwards the world was not what it should have been. */
  | 'unverified'
  /** Genuinely unrecognised. Honest, and treated cautiously. */
  | 'unknown'

export interface OrbisFailure {
  kind: OrbisErrorKind
  /** For a person: what went wrong, in plain words. Never a stack trace, never a secret. */
  message: string
  /** Which subsystem said so, for diagnosis. */
  source?: string
  /** The original code, kept so nothing is lost in translation. */
  code?: string
  /** Doing the same thing again could plausibly work. */
  retryable: boolean
  /** Only a person can get past this. */
  userFixable: boolean
}

/** What each kind means for recovery. The single place those two judgements live. */
const NATURE: Record<OrbisErrorKind, { retryable: boolean; userFixable: boolean }> = {
  validation: { retryable: false, userFixable: true },
  permission: { retryable: false, userFixable: true },
  authentication: { retryable: false, userFixable: true },
  authorization: { retryable: false, userFixable: true },
  'not-found': { retryable: false, userFixable: false },
  conflict: { retryable: true, userFixable: false },
  stale: { retryable: true, userFixable: false },
  timeout: { retryable: true, userFixable: false },
  network: { retryable: true, userFixable: false },
  provider: { retryable: true, userFixable: false },
  unavailable: { retryable: false, userFixable: false },
  resource: { retryable: true, userFixable: false },
  cancelled: { retryable: false, userFixable: false },
  security: { retryable: false, userFixable: true },
  corruption: { retryable: false, userFixable: true },
  migration: { retryable: false, userFixable: true },
  unverified: { retryable: true, userFixable: false },
  unknown: { retryable: false, userFixable: false }
}

export const failure = (kind: OrbisErrorKind, message: string, extra: { source?: string; code?: string } = {}): OrbisFailure => ({
  kind,
  message,
  ...extra,
  ...NATURE[kind]
})

/** The Browser Control Layer's codes, in the shared vocabulary. */
const FROM_CONTROL: Record<string, OrbisErrorKind> = {
  'unknown-capability': 'unavailable',
  unavailable: 'unavailable',
  'invalid-params': 'validation',
  'not-found': 'not-found',
  'stale-element': 'stale',
  declined: 'cancelled',
  blocked: 'security',
  timeout: 'timeout',
  failed: 'unknown',
  'verification-failed': 'unverified',
  aborted: 'cancelled'
}

/** The helper's codes, in the shared vocabulary. */
const FROM_HELPER: Record<string, OrbisErrorKind> = {
  'bad-request': 'validation',
  unavailable: 'unavailable',
  'no-browser': 'unavailable',
  'no-key': 'authentication',
  'not-ready': 'unavailable',
  failed: 'unknown',
  aborted: 'cancelled'
}

/**
 * Anything that went wrong, in the shared vocabulary.
 *
 * Deliberately generous about what it accepts, because failures arrive from everywhere: a control result, a helper
 * error, a DOMException from fetch, a plain string, something thrown that was never an Error. The alternative to
 * accepting all of them is each caller inventing its own guesswork, which is the situation this replaces.
 *
 * Where a real code exists it decides, because a code is a fact. Only when there is none does this read the message,
 * and it says `unknown` rather than guessing when the message says nothing useful.
 */
export function asFailure(error: unknown, source?: string): OrbisFailure {
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>

    // Already in this vocabulary.
    if (typeof o.kind === 'string' && o.kind in NATURE) {
      return failure(o.kind as OrbisErrorKind, String(o.message ?? ''), { source: (o.source as string) ?? source, code: o.code as string })
    }

    const code = typeof o.code === 'string' ? o.code : ''
    const message = String(o.message ?? 'Something went wrong.')
    if (code && code in FROM_CONTROL) return failure(FROM_CONTROL[code], message, { source: source ?? 'browser', code })
    if (code && code in FROM_HELPER) return failure(FROM_HELPER[code], message, { source: source ?? 'helper', code })

    // The shapes the platform throws that carry their meaning in a name rather than a code.
    const name = typeof o.name === 'string' ? o.name : ''
    if (name === 'AbortError') return failure('cancelled', 'Stopped.', { source, code: name })
    if (name === 'TimeoutError') return failure('timeout', 'That took too long.', { source, code: name })
    if (name === 'TypeError' && /fetch|network/i.test(message)) return failure('network', 'The network did not carry that.', { source, code: name })

    return fromMessage(message, source, code)
  }
  return fromMessage(typeof error === 'string' ? error : 'Something went wrong.', source)
}

/** Last resort: read the words. Only used when no code was given, and it says so when it cannot tell. */
function fromMessage(message: string, source?: string, code?: string): OrbisFailure {
  const text = message.toLowerCase()
  const pick = (): OrbisErrorKind => {
    if (/\b(timed? ?out|timeout|deadline)\b/.test(text)) return 'timeout'
    if (/\b(offline|network|econnrefused|enotfound|dns|unreachable|fetch failed)\b/.test(text)) return 'network'
    if (/\b(permission|not allowed|forbidden|denied)\b/.test(text)) return 'permission'
    if (/\b(sign ?in|log ?in|unauthenti|credential|token expired|401)\b/.test(text)) return 'authentication'
    if (/\b(403|unauthoris|unauthoriz)\b/.test(text)) return 'authorization'
    if (/\b(not found|no such|missing|404)\b/.test(text)) return 'not-found'
    if (/\b(stopped|cancell?ed|aborted)\b/.test(text)) return 'cancelled'
    if (/\b(conflict|already exists|in use)\b/.test(text)) return 'conflict'
    if (/\b(quota|limit|too many|rate ?limit|429|out of memory)\b/.test(text)) return 'resource'
    if (/\b(corrupt|malformed|unreadable|parse)\b/.test(text)) return 'corruption'
    if (/\b(unavailable|not ready|no browser|503)\b/.test(text)) return 'unavailable'
    return 'unknown'
  }
  return failure(pick(), message, { source, ...(code ? { code } : {}) })
}

/**
 * What to do about it, in one place.
 *
 * `tries` is how many attempts have already been made, so a retry loop cannot run forever by asking the same question
 * and getting the same answer.
 */
export type Response = 'retry' | 'refresh' | 'ask-user' | 'stop'

export function respondTo(f: OrbisFailure, tries = 0, maxTries = 3): Response {
  if (f.kind === 'cancelled') return 'stop'
  if (f.userFixable) return 'ask-user'
  // What went out of date is worth looking at again rather than repeating blindly.
  if (f.kind === 'stale' || f.kind === 'conflict' || f.kind === 'unverified') return tries < maxTries ? 'refresh' : 'stop'
  if (f.retryable && tries < maxTries) return 'retry'
  return 'stop'
}

/** How long to wait before trying again: backing off, with a ceiling, so a failing provider is not hammered. */
export const backoffMs = (tries: number, base = 400, ceiling = 8000): number => Math.min(ceiling, base * 2 ** Math.max(0, tries))
