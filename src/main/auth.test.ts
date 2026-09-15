import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { AuthManager, TRANSACTION_MS, Transactions, authorizationUrl, createPkce, googleProvider, parseCallback, pkceChallenge, verifyIdToken } from './auth.ts'
import type { SecretStore } from './auth.ts'
import type { AuthState } from '../shared/types.ts'

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const CLIENT = 'client-123.apps.googleusercontent.com'
const provider = googleProvider(CLIENT, 'desktop-client-secret')

function idToken(claims: Record<string, unknown>, kid = 'k1'): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' })
  const body = enc(claims)
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
}

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const now = Math.floor(Date.now() / 1000)
  return { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', email: 'user@example.com', email_verified: true, name: 'Test User', iat: now, exp: now + 3600, nonce: 'n1', ...over }
}

test('PKCE challenge matches the RFC 7636 example and verifiers are 43 url-safe characters', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const pair = createPkce()
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(pair.challenge, pkceChallenge(pair.verifier))
})

test('the authorization URL carries state, nonce and an S256 challenge, never the verifier', () => {
  const t = new Transactions().create('google', 'http://127.0.0.1:5555/callback')
  const url = new URL(authorizationUrl(provider, t))
  const p = url.searchParams
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(p.get('response_type'), 'code')
  assert.equal(p.get('client_id'), CLIENT)
  assert.equal(p.get('redirect_uri'), 'http://127.0.0.1:5555/callback')
  assert.equal(p.get('scope'), 'openid email profile')
  assert.equal(p.get('state'), t.state)
  assert.equal(p.get('nonce'), t.nonce)
  assert.equal(p.get('code_challenge_method'), 'S256')
  assert.equal(p.get('code_challenge'), pkceChallenge(t.verifier))
  assert.ok(!url.toString().includes(t.verifier))
  assert.ok(!url.toString().includes('desktop-client-secret'))
})

test('transactions are single-use, unknown states are refused, and they expire', () => {
  const clock = { t: Date.now() }
  const tx = new Transactions(() => clock.t)
  const a = tx.create('google', 'http://127.0.0.1:1/callback')
  assert.equal(tx.take('forged'), 'unknown')
  assert.equal((tx.take(a.state) as { state: string }).state, a.state)
  assert.equal(tx.take(a.state), 'used')
  const b = tx.create('google', 'http://127.0.0.1:1/callback')
  assert.notEqual(a.state, b.state)
  clock.t += TRANSACTION_MS + 1
  assert.equal(tx.take(b.state), 'expired')
})

test('callbacks are parsed strictly', () => {
  assert.deepEqual(parseCallback('/callback?code=abc&state=s1'), { state: 's1', code: 'abc' })
  assert.deepEqual(parseCallback('/callback?error=access_denied&state=s1'), { state: 's1', error: 'access_denied' })
  assert.equal(parseCallback('/other?code=abc&state=s1'), null)
  assert.equal(parseCallback('/callback?code=abc'), null)
  assert.equal(parseCallback('/callback?state=s1'), null)
  assert.equal(parseCallback('/favicon.ico'), null)
})

test('ID tokens are verified: signature, issuer, audience, expiry and nonce', () => {
  const o = { jwks: [jwk], issuers: provider.issuers, audience: CLIENT, nonce: 'n1', now: Date.now() }
  assert.equal(verifyIdToken(idToken(claims()), o).sub, '1234')
  assert.throws(() => verifyIdToken(idToken(claims({ nonce: 'other' })), o), /nonce/)
  assert.throws(() => verifyIdToken(idToken(claims({ aud: 'someone-else' })), o), /audience/)
  assert.throws(() => verifyIdToken(idToken(claims({ iss: 'https://evil.example' })), o), /issuer/)
  assert.throws(() => verifyIdToken(idToken(claims({ exp: Math.floor(Date.now() / 1000) - 3600 })), o), /expired/)
  const [head, , signature] = idToken(claims()).split('.')
  const forged = `${head}.${Buffer.from(JSON.stringify(claims({ sub: 'attacker' }))).toString('base64url')}.${signature}`
  assert.throws(() => verifyIdToken(forged, o), /signature/)
  assert.throws(() => verifyIdToken(idToken(claims(), 'rotated'), o), /unknown key/)
  assert.throws(() => verifyIdToken('not.a.token', o))
})

function memorySecrets(): SecretStore & { value: string | null } {
  const store = {
    value: null as string | null,
    load: async () => store.value,
    save: async (v: string) => {
      store.value = v
      return true
    },
    clear: async () => {
      store.value = null
    }
  }
  return store
}

interface HarnessOptions {
  tokenStatus?: number
  refreshStatus?: number
  tokenClaims?: (nonce: string) => Record<string, unknown>
  /** What the "browser" does with the authorization URL; by default it approves and follows the redirect. */
  browser?: (url: URL) => Promise<void>
  timeoutMs?: number
}

function harness(over: HarnessOptions = {}) {
  const calls: { url: string; body: string }[] = []
  const states: AuthState[] = []
  const secrets = memorySecrets()
  let nonce = ''
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = String(init?.body ?? '')
    calls.push({ url, body })
    if (url === provider.jwksUri) return Response.json({ keys: [jwk] })
    if (url === provider.revocationEndpoint) return new Response('', { status: 200 })
    if (url === provider.tokenEndpoint) {
      if (new URLSearchParams(body).get('grant_type') === 'refresh_token') return new Response('{}', { status: over.refreshStatus ?? 200 })
      if (over.tokenStatus && over.tokenStatus !== 200) return new Response('{"error":"invalid_grant"}', { status: over.tokenStatus })
      return Response.json({ id_token: idToken((over.tokenClaims ?? ((n) => claims({ nonce: n })))(nonce)), refresh_token: 'refresh-1', access_token: 'access-1' })
    }
    throw new Error(`unexpected request to ${url}`)
  }
  const openExternal = async (url: string): Promise<void> => {
    const u = new URL(url)
    nonce = u.searchParams.get('nonce') ?? ''
    if (over.browser) return over.browser(u)
    setTimeout(() => void fetch(`${u.searchParams.get('redirect_uri')}?code=code-1&state=${u.searchParams.get('state')}`).catch(() => undefined), 10)
  }
  let waiters: [(s: AuthState) => boolean, (s: AuthState) => void][] = []
  const manager = new AuthManager({
    provider,
    fetchFn,
    openExternal,
    secrets,
    timeoutMs: over.timeoutMs,
    onChange: (s) => {
      states.push(s)
      waiters = waiters.filter(([done, resolve]) => (done(s) ? (resolve(s), false) : true))
    }
  })
  const until = (done: (s: AuthState) => boolean): Promise<AuthState> =>
    new Promise((resolve, reject) => {
      if (done(manager.state())) return resolve(manager.state())
      waiters.push([done, resolve])
      setTimeout(() => reject(new Error(`timed out; last state ${JSON.stringify(manager.state())}`)), 5000).unref()
    })
  return { manager, secrets, calls, states, until }
}

test('sign-in: system browser → loopback callback → PKCE code exchange → verified identity → secure storage', async () => {
  const h = harness()
  const started = await h.manager.signIn()
  assert.equal(started.status, 'waiting')
  const done = await h.until((s) => s.status === 'signed-in' || Boolean(s.error))
  assert.equal(done.status, 'signed-in', JSON.stringify(done))
  assert.deepEqual(done.user, { name: 'Test User', email: 'user@example.com', picture: undefined })
  const exchange = new URLSearchParams(h.calls.find((c) => c.url === provider.tokenEndpoint)!.body)
  assert.equal(exchange.get('grant_type'), 'authorization_code')
  assert.equal(exchange.get('code'), 'code-1')
  assert.match(exchange.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43}$/)
  assert.match(exchange.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.match(h.secrets.value ?? '', /refresh-1/)
  const shown = JSON.stringify(h.states)
  assert.ok(!shown.includes('refresh-1') && !shown.includes('code-1') && !shown.includes('access-1'), 'codes and tokens never reach the window')
})

test('a callback with a forged state is refused while the real attempt keeps waiting; a replay is refused', async () => {
  let redirect = ''
  let state = ''
  const h = harness({
    browser: async (u) => {
      redirect = u.searchParams.get('redirect_uri') ?? ''
      state = u.searchParams.get('state') ?? ''
    }
  })
  await h.manager.signIn()
  assert.equal((await fetch(`${redirect}?code=stolen&state=forged`)).status, 400)
  assert.equal(h.manager.state().status, 'waiting')
  assert.ok(!h.calls.some((c) => c.url === provider.tokenEndpoint), 'no code exchange for a forged callback')
  assert.equal((await fetch(`${redirect}?code=code-1&state=${state}`)).status, 200)
  await h.until((s) => s.status === 'signed-in')
  const replay = await fetch(`${redirect}?code=code-1&state=${state}`).catch(() => null)
  assert.ok(!replay || replay.status === 400)
  assert.equal(h.calls.filter((c) => c.url === provider.tokenEndpoint).length, 1, 'the code is exchanged only once')
})

test('starting again invalidates the earlier attempt', async () => {
  const opened: URL[] = []
  const h = harness({ browser: async (u) => void opened.push(u) })
  await h.manager.signIn()
  await h.manager.signIn()
  const [first, second] = opened
  const old = await fetch(`${first.searchParams.get('redirect_uri')}?code=c&state=${first.searchParams.get('state')}`).catch(() => null)
  assert.ok(!old || old.status === 400)
  assert.equal(h.manager.state().status, 'waiting')
  await fetch(`${second.searchParams.get('redirect_uri')}?code=code-1&state=${second.searchParams.get('state')}`)
  assert.equal((await h.until((s) => s.status === 'signed-in' || Boolean(s.error))).status, 'signed-in')
})

test('cancelled consent, a timeout, a swapped nonce and a refused code all leave a usable signed-out state', async () => {
  const denied = harness({
    browser: async (u) => {
      setTimeout(() => void fetch(`${u.searchParams.get('redirect_uri')}?error=access_denied&state=${u.searchParams.get('state')}`), 10)
    }
  })
  await denied.manager.signIn()
  const d = await denied.until((s) => Boolean(s.error))
  assert.equal(d.status, 'signed-out')
  assert.match(d.error ?? '', /cancelled/)

  const slow = harness({ browser: async () => undefined, timeoutMs: 100 })
  await slow.manager.signIn()
  assert.match((await slow.until((s) => Boolean(s.error))).error ?? '', /timed out/)

  const swapped = harness({ tokenClaims: () => claims({ nonce: 'from-another-login' }) })
  await swapped.manager.signIn()
  const s = await swapped.until((x) => Boolean(x.error))
  assert.equal(s.status, 'signed-out')
  assert.equal(swapped.secrets.value, null)

  const refused = harness({ tokenStatus: 400 })
  await refused.manager.signIn()
  const r = await refused.until((x) => Boolean(x.error))
  assert.equal(r.status, 'signed-out')
  assert.match(r.error ?? '', /refused/)

  // After any failure, signing in again works.
  const retry = await refused.manager.signIn()
  assert.equal(retry.status, 'waiting')
  refused.manager.cancel()
  assert.equal(refused.manager.state().status, 'signed-out')
})

test('sessions restore from secure storage, end when revoked, and sign-out clears and revokes', async () => {
  const h = harness()
  await h.manager.signIn()
  await h.until((s) => s.status === 'signed-in')
  const stored = h.secrets.value

  const restarted = harness()
  restarted.secrets.value = stored
  await restarted.manager.restore()
  assert.equal(restarted.manager.state().status, 'signed-in')

  const revoked = harness({ refreshStatus: 400 })
  revoked.secrets.value = stored
  await revoked.manager.restore()
  assert.equal(revoked.manager.state().status, 'signed-out')
  assert.equal(revoked.secrets.value, null)

  await h.manager.signOut()
  assert.equal(h.manager.state().status, 'signed-out')
  assert.equal(h.secrets.value, null)
  assert.ok(h.calls.some((c) => c.url === provider.revocationEndpoint && new URLSearchParams(c.body).get('token') === 'refresh-1'))
})

test('without a client ID, sign-in reports that it is not set up', async () => {
  const manager = new AuthManager({ provider: null, fetchFn: fetch, openExternal: async () => undefined, secrets: memorySecrets(), onChange: () => undefined })
  assert.equal(manager.state().status, 'unconfigured')
  assert.equal((await manager.signIn()).status, 'unconfigured')
})
