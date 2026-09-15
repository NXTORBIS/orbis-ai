import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import type { JsonWebKey } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AuthState } from '../shared/types'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
type Jwk = JsonWebKey & { kid?: string }

/**
 * An OAuth 2.0 / OpenID Connect provider for a native (public) client. Every provider uses the same flow: the system
 * browser, Authorization Code with PKCE, and a loopback redirect (RFC 8252).
 */
export interface OAuthProvider {
  id: string
  name: string
  authorizationEndpoint: string
  tokenEndpoint: string
  revocationEndpoint?: string
  jwksUri: string
  issuers: string[]
  clientId: string
  /** Google requires its desktop clients' "secret" at the token endpoint. It ships inside the app, so it is never a security boundary. */
  clientSecret?: string
  scopes: string[]
  extraAuthParams?: Record<string, string>
}

export function googleProvider(clientId: string, clientSecret?: string): OAuthProvider {
  return {
    id: 'google',
    name: 'Google',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    clientId,
    clientSecret: clientSecret || undefined,
    scopes: ['openid', 'email', 'profile'],
    // A refresh token lets Orbis check on startup that the session still stands; the account chooser allows switching.
    extraAuthParams: { access_type: 'offline', prompt: 'select_account consent' }
  }
}

export class AuthError extends Error {
  readonly code: string
  constructor(message: string, code = 'auth') {
    super(message)
    this.code = code
  }
}

export const CALLBACK_PATH = '/callback'
/** How long a sign-in attempt (and its state, nonce and PKCE verifier) stays valid. */
export const TRANSACTION_MS = 5 * 60_000

export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: pkceChallenge(verifier) }
}

export interface Transaction {
  state: string
  nonce: string
  verifier: string
  providerId: string
  redirectUri: string
  expiresAt: number
  used: boolean
}

/** Sign-in attempts in progress. Each is found only by its state, can be used once, and expires. */
export class Transactions {
  private readonly items = new Map<string, Transaction>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  create(providerId: string, redirectUri: string): Transaction {
    const now = this.now()
    for (const [state, t] of this.items) if (now > t.expiresAt) this.items.delete(state)
    const transaction: Transaction = {
      state: randomBytes(24).toString('base64url'),
      nonce: randomBytes(24).toString('base64url'),
      verifier: createPkce().verifier,
      providerId,
      redirectUri,
      expiresAt: now + TRANSACTION_MS,
      used: false
    }
    this.items.set(transaction.state, transaction)
    return transaction
  }

  /** Uses up the attempt for a callback's state, or says why there is none. Used ones are kept until expiry so replays are recognised. */
  take(state: string): Transaction | 'unknown' | 'expired' | 'used' {
    const t = this.items.get(state)
    if (!t) return 'unknown'
    if (t.used) return 'used'
    if (this.now() > t.expiresAt) {
      this.items.delete(state)
      return 'expired'
    }
    t.used = true
    return t
  }

  cancel(state: string): void {
    this.items.delete(state)
  }
}

export function authorizationUrl(provider: OAuthProvider, t: Transaction): string {
  const url = new URL(provider.authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: provider.clientId,
    redirect_uri: t.redirectUri,
    scope: provider.scopes.join(' '),
    state: t.state,
    nonce: t.nonce,
    code_challenge: pkceChallenge(t.verifier),
    code_challenge_method: 'S256',
    ...provider.extraAuthParams
  }).toString()
  return url.toString()
}

/** Reads a loopback callback. Anything that isn't exactly a callback with a state and a code or error is null. */
export function parseCallback(requestUrl: string): { state: string; code?: string; error?: string } | null {
  let url: URL
  try {
    url = new URL(requestUrl, 'http://127.0.0.1')
  } catch {
    return null
  }
  if (url.pathname !== CALLBACK_PATH) return null
  const state = url.searchParams.get('state')
  if (!state || state.length > 200) return null
  const error = url.searchParams.get('error')
  if (error) return { state, error: error.slice(0, 100) }
  const code = url.searchParams.get('code')
  if (!code || code.length > 4000) return null
  return { state, code }
}

export interface IdClaims {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

/** Checks an OpenID Connect ID token: RS256 signature from the provider's keys, issuer, audience, expiry and nonce. */
export function verifyIdToken(token: string, o: { jwks: Jwk[]; issuers: string[]; audience: string; nonce: string; now: number }): IdClaims {
  const invalid = (why: string): AuthError => new AuthError(`The sign-in response couldn't be verified (${why}).`, 'invalid-token')
  const parts = token.split('.')
  if (parts.length !== 3) throw invalid('malformed')
  let header: { alg?: string; kid?: string }
  let claims: IdClaims
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw invalid('malformed')
  }
  if (header.alg !== 'RS256') throw invalid('unexpected algorithm')
  const jwk = o.jwks.find((k) => k.kid === header.kid && k.kty === 'RSA')
  if (!jwk) throw new AuthError('The sign-in response was signed with an unknown key.', 'unknown-key')
  let signed = false
  try {
    signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))
  } catch {
    signed = false
  }
  if (!signed) throw invalid('bad signature')
  if (!o.issuers.includes(claims.iss)) throw invalid('wrong issuer')
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(o.audience)) throw invalid('wrong audience')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < o.now - 60_000) throw invalid('expired')
  if (typeof claims.iat === 'number' && claims.iat * 1000 > o.now + 5 * 60_000) throw invalid('issued in the future')
  if (!claims.nonce || claims.nonce !== o.nonce) throw invalid('nonce mismatch')
  if (typeof claims.sub !== 'string' || !claims.sub) throw invalid('no subject')
  return claims
}

/** Where the session is kept: OS-protected storage, never plain text. */
export interface SecretStore {
  load(): Promise<string | null>
  /** Resolves false when secure storage isn't available (the session then lasts only while Orbis runs). */
  save(value: string): Promise<boolean>
  clear(): Promise<void>
}

interface Session {
  providerId: string
  sub: string
  email: string
  name: string
  picture?: string
  refreshToken?: string
  signedInAt: number
}

export interface AuthOptions {
  provider: OAuthProvider | null
  fetchFn: FetchFn
  /** Opens a URL in the user's default browser. */
  openExternal(url: string): Promise<void>
  secrets: SecretStore
  onChange(state: AuthState): void
  /** The browser handed the sign-in back: bring Orbis forward. */
  onReturn?(): void
  now?: () => number
  timeoutMs?: number
}

const PAGE_STYLE =
  'body{font-family:system-ui,sans-serif;background:#05070a;color:#e8ecf2;display:grid;place-items:center;height:100vh;margin:0}main{text-align:center;max-width:420px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{color:#9aa3ad;margin:0}'

/**
 * Desktop sign-in: Orbis → system browser → provider → loopback redirect → Orbis. Orbis never sees the password or the
 * provider's cookies. The authorization code is exchanged with PKCE and the ID token is verified before the session is
 * stored in OS-protected storage. Tokens and codes are never logged or sent to the window.
 */
export class AuthManager {
  private readonly o: AuthOptions
  private readonly transactions: Transactions
  private current: AuthState
  private session: Session | null = null
  private attempt: { id: number; server: Server; state: string; timer: NodeJS.Timeout } | null = null
  private attempts = 0
  private jwks: { keys: Jwk[]; at: number } | null = null

  constructor(o: AuthOptions) {
    this.o = o
    this.transactions = new Transactions(o.now)
    this.current = { status: o.provider ? 'signed-out' : 'unconfigured' }
  }

  state(): AuthState {
    return this.current
  }

  private now(): number {
    return (this.o.now ?? Date.now)()
  }

  private set(state: AuthState): void {
    this.current = state
    this.o.onChange(state)
  }

  private signedIn(s: Session, notice?: string): AuthState {
    return { status: 'signed-in', provider: this.o.provider?.name, user: { name: s.name, email: s.email, picture: s.picture }, ...(notice ? { notice } : {}) }
  }

  /** Restores a saved session on startup, and ends it if the provider has revoked it. Offline, the session is kept. */
  async restore(): Promise<void> {
    const provider = this.o.provider
    if (!provider) return
    const raw = await this.o.secrets.load().catch(() => null)
    if (!raw) return
    let saved: Session
    try {
      saved = JSON.parse(raw) as Session
    } catch {
      await this.o.secrets.clear()
      return
    }
    if (saved.providerId !== provider.id || !saved.sub) {
      await this.o.secrets.clear()
      return
    }
    this.session = saved
    this.set(this.signedIn(saved))
    if (!saved.refreshToken) return
    try {
      const res = await this.token({ grant_type: 'refresh_token', refresh_token: saved.refreshToken })
      if (res.status === 400 || res.status === 401) await this.forget(`Your ${provider.name} session ended. Sign in again.`)
    } catch {
      // No connection: keep the session.
    }
  }

  async signIn(): Promise<AuthState> {
    const provider = this.o.provider
    if (!provider) return this.current
    this.cancel(false)
    const id = ++this.attempts
    const server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve())
      })
    } catch {
      this.set({ status: this.session ? 'signed-in' : 'signed-out', error: "Couldn't start sign-in on this computer. Try again." })
      return this.current
    }
    const { port } = server.address() as AddressInfo
    const transaction = this.transactions.create(provider.id, `http://127.0.0.1:${port}${CALLBACK_PATH}`)
    const timer = setTimeout(() => this.fail(id, 'Sign-in timed out. Try again.'), this.o.timeoutMs ?? TRANSACTION_MS)
    timer.unref()
    this.attempt = { id, server, state: transaction.state, timer }
    server.on('request', (req, res) => void this.handle(id, req, res))
    this.set({ status: 'waiting', provider: provider.name })
    try {
      await this.o.openExternal(authorizationUrl(provider, transaction))
    } catch {
      this.fail(id, "Couldn't open your default browser. Check that one is set in Windows, then try again.")
    }
    return this.current
  }

  /** Stops waiting for the browser. */
  cancel(announce = true): void {
    if (!this.attempt) return
    this.end(this.attempt.id)
    if (announce) this.set(this.session ? this.signedIn(this.session) : { status: 'signed-out' })
  }

  async signOut(): Promise<void> {
    this.cancel(false)
    const provider = this.o.provider
    const session = this.session
    this.session = null
    await this.o.secrets.clear()
    this.set({ status: provider ? 'signed-out' : 'unconfigured' })
    if (session?.refreshToken && provider?.revocationEndpoint) {
      await this.o
        .fetchFn(provider.revocationEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: session.refreshToken }).toString(),
          signal: AbortSignal.timeout(10_000)
        })
        .catch(() => undefined)
    }
  }

  private async forget(message: string): Promise<void> {
    this.session = null
    await this.o.secrets.clear()
    this.set({ status: 'signed-out', error: message })
  }

  private end(id: number): void {
    const attempt = this.attempt
    if (!attempt || attempt.id !== id) return
    this.attempt = null
    clearTimeout(attempt.timer)
    this.transactions.cancel(attempt.state)
    attempt.server.close()
    setTimeout(() => attempt.server.closeAllConnections(), 1000).unref()
  }

  private fail(id: number, message: string): void {
    if (this.attempt?.id !== id) return
    this.end(id)
    this.set({ ...(this.session ? this.signedIn(this.session) : { status: 'signed-out' as const }), error: message })
  }

  private async handle(id: number, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const page = (status: number, title: string, text: string): void => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
      res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>${PAGE_STYLE}</style><main><h1>${title}</h1><p>${text}</p></main>`)
    }
    const provider = this.o.provider
    if (req.method !== 'GET') return page(405, 'Not allowed', '')
    const callback = parseCallback(req.url ?? '')
    if (!callback) return page(404, 'Not found', '')
    const attempt = this.attempt
    if (!provider || !attempt || attempt.id !== id) return page(400, 'This sign-in link is no longer valid', 'Start again from Orbis.')
    if (callback.state !== attempt.state) {
      // Not this attempt's callback (forged, or from an older attempt): refused, and the real attempt keeps waiting.
      return page(400, "Sign-in couldn't be verified", 'This link is expired, already used, or not from this sign-in. Start again from Orbis.')
    }
    const transaction = this.transactions.take(callback.state)
    if (typeof transaction === 'string') {
      page(400, "Sign-in couldn't be verified", 'This link is expired or already used. Start again from Orbis.')
      return this.fail(id, 'That sign-in link expired or was already used. Try again.')
    }
    if (callback.error) {
      page(200, 'Sign-in cancelled', 'You can close this tab and return to Orbis.')
      this.fail(id, callback.error === 'access_denied' ? 'Sign-in was cancelled.' : `${provider.name} didn't complete the sign-in. Try again.`)
      return this.o.onReturn?.()
    }
    this.set({ status: 'signing-in', provider: provider.name })
    try {
      const session = await this.exchange(provider, transaction, callback.code!)
      if (this.attempt?.id !== id) return page(400, 'This sign-in was cancelled', 'Start again from Orbis.')
      const stored = await this.o.secrets.save(JSON.stringify(session)).catch(() => false)
      this.session = session
      this.end(id)
      this.set(this.signedIn(session, stored ? undefined : "Signed in until Orbis closes: Windows secure storage isn't available, so the session isn't saved."))
      page(200, 'Signed in to Orbis', 'You can close this tab and return to Orbis.')
    } catch (err) {
      page(400, 'Sign-in failed', 'Return to Orbis to try again.')
      this.fail(id, err instanceof AuthError ? err.message : `Couldn't reach ${provider.name}. Check your connection and try again.`)
    }
    this.o.onReturn?.()
  }

  private token(params: Record<string, string>): Promise<Response> {
    const provider = this.o.provider!
    const body = new URLSearchParams({ client_id: provider.clientId, ...(provider.clientSecret ? { client_secret: provider.clientSecret } : {}), ...params })
    return this.o.fetchFn(provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000)
    })
  }

  private async exchange(provider: OAuthProvider, t: Transaction, code: string): Promise<Session> {
    const res = await this.token({ grant_type: 'authorization_code', code, redirect_uri: t.redirectUri, code_verifier: t.verifier })
    if (!res.ok) throw new AuthError(res.status >= 500 ? `${provider.name} is having trouble right now. Try again.` : `${provider.name} refused the sign-in. Try again.`)
    const json = (await res.json().catch(() => ({}))) as { id_token?: unknown; refresh_token?: unknown }
    if (typeof json.id_token !== 'string') throw new AuthError(`${provider.name} didn't return an identity. Try again.`)
    const claims = await this.verify(provider, json.id_token, t.nonce)
    if (claims.email && claims.email_verified === false) throw new AuthError('That account’s email address isn’t verified.')
    return {
      providerId: provider.id,
      sub: claims.sub,
      email: claims.email ?? '',
      name: claims.name || claims.email || `${provider.name} account`,
      picture: typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture : undefined,
      refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      signedInAt: this.now()
    }
  }

  private async keys(provider: OAuthProvider, refresh: boolean): Promise<Jwk[]> {
    if (!refresh && this.jwks && this.now() - this.jwks.at < 60 * 60_000) return this.jwks.keys
    const res = await this.o.fetchFn(provider.jwksUri, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new AuthError(`Couldn't check the sign-in with ${provider.name}. Try again.`)
    const json = (await res.json()) as { keys?: Jwk[] }
    this.jwks = { keys: Array.isArray(json.keys) ? json.keys : [], at: this.now() }
    return this.jwks.keys
  }

  private async verify(provider: OAuthProvider, token: string, nonce: string): Promise<IdClaims> {
    const check = async (refresh: boolean): Promise<IdClaims> =>
      verifyIdToken(token, { jwks: await this.keys(provider, refresh), issuers: provider.issuers, audience: provider.clientId, nonce, now: this.now() })
    try {
      return await check(false)
    } catch (err) {
      // Providers rotate signing keys; an unknown key fetches the current set once.
      if (err instanceof AuthError && err.code === 'unknown-key') return check(true)
      throw err
    }
  }
}
