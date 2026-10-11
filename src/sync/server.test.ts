import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bytes, decode, groups, num, str, sub, Writer } from './protobuf.ts'
import { COMMIT_RESULT, CONTENTS, ERROR } from './protocol.ts'
import { createSyncServer } from './server.ts'
import type { RunningSyncServer } from './server.ts'

const TOKEN = 'token-for-ada'
const OTHER = 'token-for-grace'
const accounts: Record<string, string> = { [TOKEN]: 'ada@example.test', [OTHER]: 'grace@example.test' }

async function withServer(fn: (s: RunningSyncServer, post: Post) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sync-'))
  const running = await createSyncServer({ dir, resolveAccount: (t) => accounts[t] ?? null, batch: 3 }).listen()
  const post: Post = async (body, token = TOKEN) => {
    const res = await fetch(running.url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: Buffer.from(body)
    })
    return { status: res.status, fields: res.status === 200 ? decode(new Uint8Array(await res.arrayBuffer())) : [] }
  }
  try {
    await fn(running, post)
  } finally {
    await running.close()
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

type Post = (body: Uint8Array, token?: string) => Promise<{ status: number; fields: ReturnType<typeof decode> }>

/** EntitySpecifics with one field set: field 32904 is what Chromium uses for a data type, and the payload is opaque here. */
const specifics = (dataTypeId: number, payload: string): Uint8Array =>
  new Writer().message(dataTypeId, (s) => s.string(1, payload)).finish()

const commitBody = (entries: { tag: string; payload: string; type?: number; version?: number; deleted?: boolean }[], birthday = ''): Uint8Array => {
  const w = new Writer()
  w.string(1, 'ada')
  w.varint(2, 99)
  w.varint(3, CONTENTS.COMMIT)
  if (birthday) w.string(7, birthday)
  w.message(4, (commit) => {
    commit.string(2, 'cache-guid-1')
    for (const e of entries) {
      commit.message(1, (entity) => {
        entity.string(23, e.tag)
        entity.string(7, e.tag)
        if (e.version) entity.varint(4, e.version)
        if (e.deleted) entity.boolean(18, true)
        else entity.bytes(21, specifics(e.type ?? 32904, e.payload))
      })
    }
  })
  return w.finish()
}

const getUpdatesBody = (markers: { type: number; token: string }[], birthday = ''): Uint8Array => {
  const w = new Writer()
  w.string(1, 'ada')
  w.varint(2, 99)
  w.varint(3, CONTENTS.GET_UPDATES)
  if (birthday) w.string(7, birthday)
  w.message(5, (gu) => {
    for (const m of markers) {
      gu.message(6, (marker) => {
        marker.varint(1, m.type)
        marker.string(2, m.token)
      })
    }
  })
  return w.finish()
}

const readUpdates = (fields: ReturnType<typeof decode>) => {
  const gu = sub(fields, 2)
  assert.ok(gu, 'the response carries a GetUpdatesResponse')
  const entries = fields.length
    ? (gu.filter((f) => f.no === 1).map((f) => decode(f.value as Uint8Array)) as ReturnType<typeof decode>[])
    : []
  return {
    entries: entries.map((e) => ({
      id: str(e, 1),
      version: num(e, 4),
      name: str(e, 7),
      deleted: num(e, 18) === 1,
      payload: bytes(e, 21) ? str(decode(bytes(e, 21) as Uint8Array), 0) : ''
    })),
    remaining: num(gu, 4),
    markers: gu.filter((f) => f.no === 5).map((f) => decode(f.value as Uint8Array)).map((m) => ({ type: num(m, 1), token: str(m, 2) })),
    birthday: str(fields, 6)
  }
}

test('a commit is stored and comes back on the next request for updates', async () => {
  await withServer(async (_s, post) => {
    const committed = await post(commitBody([{ tag: 'bookmark-a', payload: 'first' }]))
    assert.equal(committed.status, 200)
    assert.equal(num(committed.fields, 4), ERROR.SUCCESS)
    const results = groups(sub(committed.fields, 1) ?? [], 1)
    assert.equal(results.length, 1)
    assert.equal(num(results[0], 2), COMMIT_RESULT.SUCCESS)
    assert.equal(num(results[0], 6), 1, 'the first thing written is version 1')

    const updates = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    assert.equal(updates.entries.length, 1)
    assert.equal(updates.entries[0].name, 'bookmark-a')
    assert.equal(updates.entries[0].version, 1)
  })
})

test('a marker means the client is not sent the same thing twice', async () => {
  await withServer(async (_s, post) => {
    await post(commitBody([{ tag: 'a', payload: '1' }, { tag: 'b', payload: '2' }]))
    const first = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    assert.equal(first.entries.length, 2)
    const token = first.markers.find((m) => m.type === 32904)?.token
    assert.equal(token, '2', 'the marker is the highest version sent')

    const again = readUpdates((await post(getUpdatesBody([{ type: 32904, token }]))).fields)
    assert.equal(again.entries.length, 0, 'nothing has changed since')
    assert.equal(again.markers.find((m) => m.type === 32904)?.token, '2', 'and the marker holds')
  })
})

test('what one device commits, another device is told about', async () => {
  await withServer(async (_s, post) => {
    // The second device has never synced, so it starts from nothing and asks for everything.
    await post(commitBody([{ tag: 'shared', payload: 'from-laptop' }]))
    const onPhone = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    assert.equal(onPhone.entries.length, 1)
    assert.equal(onPhone.entries[0].name, 'shared')
  })
})

test('one account cannot see another account', async () => {
  await withServer(async (_s, post) => {
    await post(commitBody([{ tag: 'ada-only', payload: 'secret' }]), TOKEN)
    const grace = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]), OTHER)).fields)
    assert.equal(grace.entries.length, 0, "Grace sees nothing of Ada's")
  })
})

test('a deletion travels, and carries no payload with it', async () => {
  await withServer(async (_s, post) => {
    await post(commitBody([{ tag: 'going', payload: 'here' }]))
    await post(commitBody([{ tag: 'going', payload: '', deleted: true }]))
    const updates = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    const gone = updates.entries.find((e) => e.id.includes('going'))
    assert.ok(gone, 'the deletion is sent, not silently dropped')
    assert.equal(gone.deleted, true)
    assert.equal(gone.payload, '', 'nothing of what it held goes with it')
  })
})

test('committing against a version the server has moved past is refused, not overwritten', async () => {
  await withServer(async (_s, post) => {
    await post(commitBody([{ tag: 'contested', payload: 'first' }]))
    await post(commitBody([{ tag: 'contested', payload: 'second' }]))
    // A device that was offline still thinks this is at version 1 and tries to write over it.
    const stale = await post(commitBody([{ tag: 'contested', payload: 'stale', version: 1 }]))
    const results = groups(sub(stale.fields, 1) ?? [], 1)
    assert.equal(num(results[0], 2), COMMIT_RESULT.CONFLICT, 'the client is told to catch up first')
    assert.match(str(results[0], 9), /newer/i)
  })
})

test('a client quoting the wrong birthday is told to start again', async () => {
  await withServer(async (_s, post) => {
    const commit = await post(commitBody([{ tag: 'x', payload: 'y' }]))
    const birthday = str(commit.fields, 6)
    assert.ok(birthday, 'every response names the data it belongs to')

    const wrong = await post(getUpdatesBody([{ type: 32904, token: '0' }], 'a-birthday-from-before'))
    assert.equal(num(wrong.fields, 4), ERROR.NOT_MY_BIRTHDAY)
    assert.equal(str(wrong.fields, 6), birthday, 'and is given the current one to adopt')

    const right = await post(getUpdatesBody([{ type: 32904, token: '0' }], birthday))
    assert.equal(num(right.fields, 4), ERROR.SUCCESS)
  })
})

test('clearing an account changes its birthday, which is what resets every client', async () => {
  await withServer(async (s, post) => {
    const before = str((await post(commitBody([{ tag: 'a', payload: '1' }]))).fields, 6)
    const after = await s.store.clear('ada@example.test')
    assert.notEqual(after, before)
    const updates = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    assert.equal(updates.entries.length, 0, 'the data went with it')
  })
})

test('a long batch is handed over in pieces, and says how much is left', async () => {
  await withServer(async (_s, post) => {
    await post(commitBody([1, 2, 3, 4, 5].map((n) => ({ tag: `item-${n}`, payload: String(n) }))))
    const first = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    assert.equal(first.entries.length, 3, 'the batch size is respected')
    assert.equal(first.remaining, 2, 'and the rest is reported rather than dropped')
    const token = first.markers.find((m) => m.type === 32904)?.token
    const second = readUpdates((await post(getUpdatesBody([{ type: 32904, token }]))).fields)
    assert.equal(second.entries.length, 2)
    assert.equal(second.remaining, 0)
  })
})

test('only the types asked for come back', async () => {
  await withServer(async (_s, post) => {
    await post(commitBody([{ tag: 'a-bookmark', payload: '1', type: 32904 }, { tag: 'a-password', payload: '2', type: 32907 }]))
    const updates = readUpdates((await post(getUpdatesBody([{ type: 32904, token: '0' }]))).fields)
    assert.equal(updates.entries.length, 1)
    assert.equal(updates.entries[0].name, 'a-bookmark', 'the password is not sent to a client that did not ask for passwords')
  })
})

test('nothing is answered without a token the server recognises', async () => {
  await withServer(async (_s, post) => {
    assert.equal((await post(commitBody([{ tag: 'a', payload: '1' }]), '')).status, 401, 'no token')
    assert.equal((await post(commitBody([{ tag: 'a', payload: '1' }]), 'not-a-real-token')).status, 401, 'an unknown token')
  })
})

test('a body that is not a sync request is refused without detail', async () => {
  await withServer(async (_s, post) => {
    const junk = await post(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
    assert.equal(junk.status, 400)
  })
})
