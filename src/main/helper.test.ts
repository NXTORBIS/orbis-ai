import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { bearer, checkRequest, hostIsUs, newToken, sameToken } from '../helper/auth.ts'
import { createHandlers } from '../helper/handlers.ts'
import { createHelperServer, HelperError } from '../helper/server.ts'
import type { Handler } from '../helper/server.ts'

const PANEL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const TOKEN = newToken()

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  lines: unknown[]
  raw: string
}

/** A raw HTTP call, so the tests control Host and Origin exactly — which `fetch` does not let them. */
function call(port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer; destroyAfterFirstLine?: boolean }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path ?? '/rpc', headers: { Host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let raw = ''
      res.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
        if (opts.destroyAfterFirstLine && raw.includes('\n')) req.destroy()
      })
      const done = (): void => {
        const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown)
        resolve({ status: res.statusCode ?? 0, headers: res.headers, lines, raw })
      }
      res.on('end', done)
      res.on('close', done)
    })
    req.on('error', (err) => (opts.destroyAfterFirstLine ? undefined : reject(err)))
    req.end(opts.body)
  })
}

const authed = { Authorization: `Bearer ${TOKEN}`, Origin: PANEL, 'Content-Type': 'application/json' }
const rpc = (channel: string, args: unknown[] = []): string => JSON.stringify({ channel, args })

async function withServer<T>(handlers: Record<string, Handler>, fn: (port: number) => Promise<T>, extra: { maxBodyBytes?: number } = {}): Promise<T> {
  const server = createHelperServer({ token: TOKEN, allowedOrigins: [PANEL], handlers, ...extra })
  const { port } = await server.listen()
  try {
    return await fn(port)
  } finally {
    await server.close()
  }
}

const echo: Record<string, Handler> = { 'test:echo': ([value]) => ({ value }) }

// ---------------------------------------------------------------- the rules, on their own

test('every run gets a fresh, long, unguessable token', () => {
  const a = newToken()
  const b = newToken()
  assert.notEqual(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('tokens are compared for equality only, whatever their length', () => {
  assert.equal(sameToken('abc', 'abc'), true)
  assert.equal(sameToken('abc', 'abd'), false)
  assert.equal(sameToken('abc', 'abcd'), false)
  assert.equal(sameToken('', ''), true)
})

test('only a Host naming this server on its own port is accepted', () => {
  assert.equal(hostIsUs('127.0.0.1:4000', 4000), true)
  assert.equal(hostIsUs('localhost:4000', 4000), true)
  assert.equal(hostIsUs('evil.example:4000', 4000), false, 'DNS rebinding arrives with the attacker’s name')
  assert.equal(hostIsUs('127.0.0.1:4001', 4000), false)
  assert.equal(hostIsUs(undefined, 4000), false)
})

test('a bearer token is read only from a well-formed header', () => {
  assert.equal(bearer(`Bearer ${'a'.repeat(32)}`), 'a'.repeat(32))
  assert.equal(bearer(undefined), null)
  assert.equal(bearer('Basic abc'), null)
  assert.equal(bearer('Bearer short'), null)
  assert.equal(bearer(`Bearer ${'a'.repeat(32)} extra`), null)
})

test('the decision needs the right host, an allowed origin (or none), POST, /rpc and the token — all of them', () => {
  const config = { token: TOKEN, port: 4000, allowedOrigins: [PANEL] }
  const good = { method: 'POST', path: '/rpc', headers: { host: '127.0.0.1:4000', origin: PANEL, authorization: `Bearer ${TOKEN}` } }
  assert.deepEqual(checkRequest(good, config), { ok: true })
  assert.deepEqual(checkRequest({ ...good, headers: { host: '127.0.0.1:4000', authorization: `Bearer ${TOKEN}` } }, config), { ok: true }, 'a program on this computer sends no Origin')
  assert.equal(checkRequest({ ...good, headers: { ...good.headers, host: 'evil.example:4000' } }, config).ok, false)
  assert.equal(checkRequest({ ...good, headers: { ...good.headers, origin: 'https://evil.example' } }, config).ok, false)
  assert.equal(checkRequest({ ...good, headers: { ...good.headers, authorization: undefined } }, config).ok, false)
  assert.equal(checkRequest({ ...good, method: 'GET' }, config).ok, false)
  assert.equal(checkRequest({ ...good, path: '/other' }, config).ok, false)
})

// ---------------------------------------------------------------- against a real server

test('a request with the token and the panel’s origin is answered', () =>
  withServer(echo, async (port) => {
    const reply = await call(port, { headers: authed, body: rpc('test:echo', ['hello']) })
    assert.equal(reply.status, 200)
    assert.deepEqual(reply.lines, [{ result: { value: 'hello' } }])
    assert.equal(reply.headers['access-control-allow-origin'], PANEL)
  }))

test('no token and a wrong token get the identical refusal, so nothing can be learnt from the difference', () =>
  withServer(echo, async (port) => {
    const none = await call(port, { headers: { Origin: PANEL }, body: rpc('test:echo') })
    const wrong = await call(port, { headers: { Origin: PANEL, Authorization: `Bearer ${'x'.repeat(64)}` }, body: rpc('test:echo') })
    assert.equal(none.status, 401)
    assert.equal(wrong.status, 401)
    assert.equal(none.raw, wrong.raw)
  }))

test('a webpage cannot use the helper even if it somehow has the token: its origin is not on the list', () =>
  withServer(echo, async (port) => {
    const reply = await call(port, { headers: { ...authed, Origin: 'https://evil.example' }, body: rpc('test:echo') })
    assert.equal(reply.status, 403)
    assert.equal(reply.headers['access-control-allow-origin'], undefined, 'a refused page is not even told it may read the answer')
  }))

test('a page using DNS rebinding is refused, because its own domain is in Host', () =>
  withServer(echo, async (port) => {
    const reply = await call(port, { headers: { ...authed, Host: `evil.example:${port}` }, body: rpc('test:echo') })
    assert.equal(reply.status, 403)
  }))

test('only POST to /rpc is served', () =>
  withServer(echo, async (port) => {
    assert.equal((await call(port, { method: 'GET', headers: authed })).status, 405)
    assert.equal((await call(port, { path: '/anything', headers: authed, body: rpc('test:echo') })).status, 404)
  }))

test('a browser’s preflight is answered for the panel and refused for anyone else', () =>
  withServer(echo, async (port) => {
    const ok = await call(port, { method: 'OPTIONS', headers: { Origin: PANEL, 'Access-Control-Request-Method': 'POST' } })
    assert.equal(ok.status, 204)
    assert.equal(ok.headers['access-control-allow-origin'], PANEL)
    const bad = await call(port, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    assert.equal(bad.status, 403)
  }))

test('unknown channels are refused, including the names every object has', () =>
  withServer(echo, async (port) => {
    for (const channel of ['nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal((await call(port, { headers: authed, body: rpc(channel) })).status, 404, channel)
    }
  }))

test('malformed and oversized requests are refused without running anything', () =>
  withServer(
    echo,
    async (port) => {
      assert.equal((await call(port, { headers: authed, body: '{not json' })).status, 400)
      assert.equal((await call(port, { headers: authed, body: JSON.stringify({ args: [] }) })).status, 400)
      assert.equal((await call(port, { headers: authed, body: JSON.stringify({ channel: 'test:echo', args: 'x' }) })).status, 400)
      assert.equal((await call(port, { headers: authed, body: Buffer.alloc(5_000, 'a') })).status, 413)
    },
    { maxBodyBytes: 1_000 }
  ))

test('events stream in order, then exactly one result', () =>
  withServer(
    {
      'test:stream': async (_args, { emit }) => {
        emit({ n: 1 })
        emit({ n: 2 })
        return 'done'
      }
    },
    async (port) => {
      const reply = await call(port, { headers: authed, body: rpc('test:stream') })
      assert.deepEqual(reply.lines, [{ event: { n: 1 } }, { event: { n: 2 } }, { result: 'done' }])
    }
  ))

test('a handler’s own error reaches the panel; any other failure does not leak its detail', () =>
  withServer(
    {
      'test:known': () => {
        throw new HelperError('no-key', 'The helper has no key.')
      },
      'test:bug': () => {
        throw new Error('secret path C:\\Users\\someone\\thing failed')
      }
    },
    async (port) => {
      assert.deepEqual((await call(port, { headers: authed, body: rpc('test:known') })).lines, [{ error: { code: 'no-key', message: 'The helper has no key.' } }])
      const bug = await call(port, { headers: authed, body: rpc('test:bug') })
      assert.deepEqual(bug.lines, [{ error: { code: 'helper-error', message: 'The helper could not do that.' } }])
      assert.doesNotMatch(bug.raw, /secret path|Users/)
    }
  ))

test('when the panel disconnects (the Stop button), the handler is told to stop', async () => {
  let aborted: (() => void) | null = null
  const sawAbort = new Promise<void>((resolve) => (aborted = resolve))
  await withServer(
    {
      'test:long': async (_args, { emit, signal }) => {
        signal.addEventListener('abort', () => aborted?.())
        emit({ started: true })
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    },
    async (port) => {
      void call(port, { headers: authed, body: rpc('test:long'), destroyAfterFirstLine: true })
      await Promise.race([sawAbort, new Promise((_, reject) => setTimeout(() => reject(new Error('the handler was never told to stop')), 3_000))])
    }
  )
})

test('it listens on this computer only, never on the network', async () => {
  const server = createHelperServer({ token: TOKEN, allowedOrigins: [PANEL], handlers: echo })
  const { port } = await server.listen()
  try {
    const { networkInterfaces } = await import('node:os')
    const external = Object.values(networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')
    if (external) {
      await assert.rejects(
        new Promise((resolve, reject) => {
          const req = request({ host: external.address, port, method: 'POST', path: '/rpc', timeout: 1_500 }, resolve)
          req.on('error', reject)
          req.on('timeout', () => reject(new Error('timed out')))
          req.end('{}')
        }),
        /ECONNREFUSED|timed out|ECONNRESET/,
        'the helper answered on a network address'
      )
    }
  } finally {
    await server.close()
  }
})

// ---------------------------------------------------------------- Orion, end to end, with the network faked

const sse = (...chunks: unknown[]): Response =>
  new Response([...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), 'data: [DONE]\n\n'].join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const piece = (content: string, finish: string | null = null): unknown => ({ choices: [{ delta: { content }, finish_reason: finish }] })

test('helper:ping reports the helper is up and whether it has a key, never the key', () =>
  withServer(createHandlers({ apiKeys: ['gsk_secret_key_value'] }), async (port) => {
    const reply = await call(port, { headers: authed, body: rpc('helper:ping') })
    assert.deepEqual(reply.lines, [{ result: { ok: true, version: 'dev', hasApiKey: true } }])
    assert.doesNotMatch(reply.raw, /gsk_secret/)
  }))

test('chat:send streams Orion’s answer back and says which model gave it', () =>
  withServer(createHandlers({ apiKeys: ['k'], fetchFn: (async () => sse(piece('Hel'), piece('lo'), piece('', 'stop'))) as typeof fetch }), async (port) => {
    const reply = await call(port, { headers: authed, body: rpc('chat:send', [{ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'Say hello.' }] }]) })
    const events = reply.lines.filter((l): l is { event: { type: string; content?: string } } => typeof l === 'object' && l !== null && 'event' in l).map((l) => l.event)
    assert.equal(events[0].type, 'start')
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.content ?? '').join(''), 'Hello')
    assert.equal(events.at(-1)?.type, 'done')
    assert.deepEqual(reply.lines.at(-1), { result: { model: 'openai/gpt-oss-20b' } })
  }))

test('chat:send continues a long answer past one call’s output limit on its own', () => {
  let calls = 0
  const fetchFn = (async () => {
    calls++
    return calls === 1 ? sse(piece('First part of the essay, '), piece('', 'length')) : sse(piece('and the rest of it.'), piece('', 'stop'))
  }) as typeof fetch
  return withServer(createHandlers({ apiKeys: ['k'], fetchFn }), async (port) => {
    const reply = await call(port, { headers: authed, body: rpc('chat:send', [{ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'Write a 10,000-word essay about numbers.' }] }]) })
    const text = reply.lines
      .map((l) => (l as { event?: { type: string; content?: string } }).event)
      .filter((e): e is { type: string; content?: string } => e?.type === 'delta')
      .map((e) => e.content ?? '')
      .join('')
    assert.equal(calls, 2, 'the second call was made without anyone asking for it')
    assert.equal(text, 'First part of the essay, and the rest of it.')
  })
})

test('chat:send refuses a missing key and a malformed conversation with words the panel can show', () =>
  withServer(createHandlers({ apiKeys: [] }), async (port) => {
    const noKey = await call(port, { headers: authed, body: rpc('chat:send', [{ messages: [{ role: 'user', content: 'hi' }] }]) })
    assert.deepEqual(noKey.lines, [{ error: { code: 'no-key', message: 'The helper has no Groq API key.' } }])
  }).then(() =>
    withServer(createHandlers({ apiKeys: ['k'], fetchFn: (async () => sse(piece('x', 'stop'))) as typeof fetch }), async (port) => {
      for (const messages of [[], 'nope', [{ role: 'system', content: 'x' }], [{ role: 'user', content: 5 }], [{ role: 'assistant', content: 'last is not the person' }]]) {
        const reply = await call(port, { headers: authed, body: rpc('chat:send', [{ messages }]) })
        assert.equal((reply.lines[0] as { error?: { code: string } }).error?.code, 'bad-request', JSON.stringify(messages))
      }
    })
  ))
