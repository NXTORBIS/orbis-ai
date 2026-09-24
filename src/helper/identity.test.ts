import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newToken } from './auth.ts'
import { createHandlers } from './handlers.ts'
import type { HandlerDeps } from './handlers.ts'
import { createHelperServer } from './server.ts'

/**
 * `identity:get` is how the browser learns what to call the person. Orbis has no account, so this is a name from the
 * app's settings and nothing more — which is exactly why the tests below care about what it does *not* carry.
 */

const PANEL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const TOKEN = newToken()

type Rpc = (channel: string, args?: unknown[]) => Promise<any>
async function withHelper<T>(extra: Partial<HandlerDeps>, fn: (rpc: Rpc, raw: (c: string) => Promise<string>) => Promise<T>): Promise<T> {
  const server = createHelperServer({ token: TOKEN, allowedOrigins: [PANEL], handlers: createHandlers({ apiKeys: ['sk-a-real-looking-key'], ...extra }) })
  const { port } = await server.listen()
  const post = async (channel: string, args: unknown[] = []): Promise<string> => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: PANEL, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args })
    })
    return res.text()
  }
  const rpc: Rpc = async (channel, args = []) => {
    const lines = (await post(channel, args)).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const last = lines[lines.length - 1]
    if (last.error) throw Object.assign(new Error(last.error.message), { code: last.error.code })
    // `result` may legitimately be null, so test for the key rather than coalescing past it.
    return 'result' in last ? last.result : 'value' in last ? last.value : last
  }
  try {
    return await fn(rpc, (c) => post(c))
  } finally {
    await server.close()
  }
}

test('the browser is told the name the person gave themselves', async () => {
  await withHelper({ identity: async () => ({ name: 'Ada', title: 'Commander' }) }, async (rpc) => {
    assert.deepEqual(await rpc('identity:get'), { name: 'Ada', title: 'Commander' })
  })
})

test('a rename in the app reaches the browser without a restart', async () => {
  let name = 'Ada'
  await withHelper({ identity: async () => ({ name, title: '' }) }, async (rpc) => {
    assert.equal((await rpc('identity:get')).name, 'Ada')
    name = 'Grace'
    assert.equal((await rpc('identity:get')).name, 'Grace', 'the name is read at call time, not cached at startup')
  })
})

test('nothing but the name and the title crosses to the browser', async () => {
  const withExtras = async () => ({ name: 'Ada', title: 'Commander', apiKey: 'sk-must-never-appear', email: 'ada@example.test' })
  await withHelper({ identity: withExtras as HandlerDeps['identity'] }, async (rpc, raw) => {
    assert.deepEqual(Object.keys(await rpc('identity:get')).sort(), ['name', 'title'])
    const body = await raw('identity:get')
    assert.ok(!body.includes('sk-must-never-appear'), 'a key placed on the identity object is not forwarded')
    assert.ok(!body.includes('ada@example.test'), 'nor is anything else that happens to be on it')
  })
})

test('with nothing to report the answer is nothing, not a stand-in name', async () => {
  await withHelper({ identity: async () => null }, async (rpc) => {
    assert.equal(await rpc('identity:get'), null)
  })
})

test('without the app there is no channel at all, rather than an empty account', async () => {
  await withHelper({}, async (rpc) => {
    await assert.rejects(() => rpc('identity:get'), /unknown|not available|channel/i)
  })
})
