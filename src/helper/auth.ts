import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Who may talk to the Orbis helper.
 *
 * The helper runs on this computer and does real things — it talks to Orion with the person's own key, reads their
 * memory and notes. A webpage in any tab can send requests to 127.0.0.1 just as easily as Orbis's own panel can, so the
 * only thing that keeps a page out is the rules below. They are pure functions of the request, and every one of them
 * has to say yes:
 *
 *   1. The Host header names this server. A page that tricks the browser into resolving its own domain to 127.0.0.1
 *      ("DNS rebinding") arrives with the attacker's domain in Host, and is refused here.
 *   2. If the request says where it came from (Origin), that origin is on the list of allowed panels. Browsers always
 *      send Origin on a cross-site request, so a webpage cannot leave it out; a request with none at all came from a
 *      program on this computer, not a page.
 *   3. It carries the secret token made when the helper started, compared without leaking how much of it was right.
 *
 * Nothing here logs, stores or prints the token.
 */

export interface RequestFacts {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
}

export interface AuthConfig {
  token: string
  port: number
  /** Exact origins of the Orbis panel, e.g. `chrome-extension://<id>`. Anything else is refused. */
  allowedOrigins: string[]
}

export type Verdict = { ok: true } | { ok: false; status: 400 | 401 | 403 | 404 | 405; message: string }

/** A fresh secret for this run of the helper: 256 bits, unguessable, never reused. */
export function newToken(): string {
  return randomBytes(32).toString('hex')
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/** Whether two secrets match, taking the same time whether they differ at the first character or the last. */
export function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Whether the Host header names this server and nothing else. */
export function hostIsUs(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/.exec(header ?? '')
  return match ? match[1] : null
}

/** CORS preflight: the browser asks whether the real request would be allowed. */
export function checkPreflight(request: RequestFacts, config: AuthConfig): Verdict {
  if (!hostIsUs(first(request.headers.host), config.port)) return { ok: false, status: 403, message: 'Not addressed to this helper.' }
  const origin = first(request.headers.origin)
  if (!origin || !config.allowedOrigins.includes(origin)) return { ok: false, status: 403, message: 'That page is not allowed to use the helper.' }
  return { ok: true }
}

/** The whole decision for one real request. The order matters: cheapest and least revealing checks first. */
export function checkRequest(request: RequestFacts, config: AuthConfig): Verdict {
  if (!hostIsUs(first(request.headers.host), config.port)) return { ok: false, status: 403, message: 'Not addressed to this helper.' }
  const origin = first(request.headers.origin)
  if (origin !== undefined && !config.allowedOrigins.includes(origin)) return { ok: false, status: 403, message: 'That page is not allowed to use the helper.' }
  if (request.method !== 'POST') return { ok: false, status: 405, message: 'Use POST.' }
  if (request.path !== '/rpc') return { ok: false, status: 404, message: 'No such address.' }
  const given = bearer(first(request.headers.authorization))
  // The same answer for "no token" and "wrong token": nothing to learn from the difference.
  if (given === null || !sameToken(given, config.token)) return { ok: false, status: 401, message: 'Not signed in.' }
  return { ok: true }
}
