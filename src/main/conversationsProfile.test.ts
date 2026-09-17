import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './store.ts'
import type { Conversation } from '../shared/types'

const chat = (id: string, title: string): Conversation => ({ id, title, messages: [], model: 'openai/gpt-oss-20b', createdAt: 1, updatedAt: 1 }) as unknown as Conversation

test('each profile has its own conversations, and the default profile keeps the folder it always had', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-chats-'))
  try {
    const store = new Store(dir)
    await store.saveConversation(chat('c1', 'Default chat'))
    assert.ok(existsSync(join(dir, 'conversations', 'c1.json')))

    store.useProfile('work')
    assert.deepEqual(await store.listConversations(), [], 'the work profile sees none of the default chats')
    await store.saveConversation(chat('c2', 'Work chat'))
    assert.ok(existsSync(join(dir, 'profiles', 'work', 'conversations', 'c2.json')))
    await store.deleteConversation('c1')
    store.useProfile('default')
    assert.deepEqual((await store.listConversations()).map((c) => c.title), ['Default chat'], 'deleting in one profile cannot reach another')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
