import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../main/store.ts'
import { DEFAULT_MODEL } from '../shared/models.ts'
import { newToken } from './auth.ts'
import { createHandlers } from './handlers.ts'
import { createHelperServer } from './server.ts'

const PANEL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const TOKEN = newToken()

async function withHelper<T>(dataDir: string, fn: (rpc: (channel: string, args?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
  const server = createHelperServer({ token: TOKEN, allowedOrigins: [PANEL], handlers: createHandlers({ apiKeys: [], dataDir }) })
  const { port } = await server.listen()
  const rpc = async (channel: string, args: unknown[] = []): Promise<any> => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, Origin: PANEL, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, args }) })
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const last = lines[lines.length - 1]
    if (last.error) throw Object.assign(new Error(last.error.message), { code: last.error.code })
    // `??` would step over a result that is legitimately null, which is how "no such chat" is answered.
    return 'result' in last ? last.result : (last.value ?? last)
  }
  try {
    return await fn(rpc)
  } finally {
    await server.close()
  }
}

const chat = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  model: DEFAULT_MODEL,
  createdAt: 1_000,
  updatedAt: 2_000,
  messages: [
    { id: 'm1', role: 'user', content: 'what is a tide', createdAt: 1_100 },
    { id: 'm2', role: 'assistant', content: 'The sea, pulled about by the moon.', createdAt: 1_200, model: DEFAULT_MODEL }
  ],
  ...extra
})

test('a chat saved from the panel is the same chat the Orbis window reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-c-'))
  try {
    await withHelper(dir, async (rpc) => {
      const saved = await rpc('conversations:save', [chat('first', 'Tides')])
      assert.equal(saved.id, 'first')
      assert.equal(saved.messages, 2, 'the summary counts messages rather than carrying them')
      assert.match(saved.preview, /pulled about by the moon/)

      // The Orbis window's own store, opened on the same folder: the panel did not write somewhere of its own.
      const store = new Store(dir)
      const [read] = await store.listConversations()
      assert.equal(read.title, 'Tides')
      assert.equal(read.messages.length, 2)
      assert.equal(read.messages[0].createdAt, 1_100, 'when a message was written is kept')
      assert.equal(read.messages[1].model, DEFAULT_MODEL)
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('the list is newest first and carries no message bodies; a chat opens again whole', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-c-'))
  try {
    await withHelper(dir, async (rpc) => {
      await rpc('conversations:save', [chat('older', 'Older', { updatedAt: 10 })])
      await rpc('conversations:save', [chat('newer', 'Newer', { updatedAt: 99 })])
      const list = await rpc('conversations:list')
      assert.deepEqual(
        list.map((c: { id: string }) => c.id),
        ['newer', 'older']
      )
      assert.equal(list[0].messages, 2)
      assert.equal(list[0].content, undefined, 'a list row never carries what was said')

      const whole = await rpc('conversations:get', ['older'])
      assert.equal(whole.messages.length, 2)
      assert.equal(whole.messages[0].content, 'what is a tide')
      assert.equal(await rpc('conversations:get', ['missing']), null)
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('an incognito chat is refused, and nothing of it reaches the disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-c-'))
  try {
    await withHelper(dir, async (rpc) => {
      await assert.rejects(() => rpc('conversations:save', [chat('secret', 'Secret', { incognito: true })]), /incognito/i)
      assert.deepEqual(await rpc('conversations:list'), [], 'refusing it means not writing it')
      assert.deepEqual(await new Store(dir).listConversations(), [])
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('what a page sends is checked before it is written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-c-'))
  try {
    await withHelper(dir, async (rpc) => {
      await assert.rejects(() => rpc('conversations:save', [chat('../escape', 'Escaping')]), /id/i)
      await assert.rejects(() => rpc('conversations:save', [{ id: 'nomessages', title: 'x', model: 'm' }]), /messages/i)
      await assert.rejects(() => rpc('conversations:save', [chat('badrole', 'x', { messages: [{ id: 'm', role: 'root', content: 'hi' }] })]), /role/i)
      await assert.rejects(() => rpc('conversations:save', [chat('toolong', 'x', { messages: [{ id: 'm', role: 'user', content: 'x'.repeat(200_001) }] })]), /too long/i)
      await assert.rejects(() => rpc('conversations:get', ['../../etc/passwd']), /id/i)
      await assert.rejects(() => rpc('conversations:remove', ['../../etc/passwd']), /id/i)
      assert.deepEqual(await rpc('conversations:list'), [], 'not one of those was written')
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('a chat can be removed, and removing one leaves the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-c-'))
  try {
    await withHelper(dir, async (rpc) => {
      await rpc('conversations:save', [chat('keep', 'Keep')])
      await rpc('conversations:save', [chat('drop', 'Drop')])
      await rpc('conversations:remove', ['drop'])
      const left = await rpc('conversations:list')
      assert.deepEqual(
        left.map((c: { id: string }) => c.id),
        ['keep']
      )
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})
