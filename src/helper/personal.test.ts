import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newToken } from './auth.ts'
import { createHandlers } from './handlers.ts'
import { createHelperServer } from './server.ts'
import { noteFilter, notePatch, taskPatch } from './personal.ts'
import { NotesStore } from '../main/personal/notes.ts'
import { TasksStore } from '../main/personal/tasks.ts'

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
    return last.result ?? last.value ?? last
  }
  try {
    return await fn(rpc)
  } finally {
    await server.close()
  }
}

test('notes through the real server: create, update, search, delete, and they persist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-p-'))
  try {
    let id = ''
    await withHelper(dir, async (rpc) => {
      const note = await rpc('notes:create', [{ title: 'Groceries', body: 'milk and eggs', tags: ['Home Stuff'] }])
      id = note.id
      assert.deepEqual(note.tags, ['home-stuff'])
      await rpc('notes:update', [id, { pinned: true, body: 'milk, eggs, tea' }])
      assert.equal((await rpc('notes:search', ['tea']))[0].id, id)
      assert.equal((await rpc('notes:search', ['nothing-here'])).length, 0)
    })
    await withHelper(dir, async (rpc) => {
      const list = await rpc('notes:list', [{}])
      assert.equal(list.length, 1)
      assert.equal(list[0].pinned, true)
      assert.equal((await rpc('notes:delete', [id])).removed, true)
      assert.equal((await rpc('notes:list', [])).length, 0)
      await assert.rejects(rpc('notes:update', [id, { title: 'x' }]), /no longer exists/)
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('tasks through the real server: create, complete, update, delete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-p-'))
  try {
    await withHelper(dir, async (rpc) => {
      const t = await rpc('tasks:create', [{ title: 'Pay rent', priority: 'high' }])
      assert.equal(t.listId, 'inbox')
      assert.equal((await rpc('tasks:complete', [t.id, true])).task.done, true)
      assert.equal((await rpc('tasks:list', [{ view: 'completed' }])).length, 1)
      const u = await rpc('tasks:update', [t.id, { title: 'Pay rent today', subtasks: [{ id: 's1', title: 'log in', done: false }] }])
      assert.equal(u.subtasks.length, 1)
      const snap = await rpc('tasks:snapshot')
      assert.equal(snap.lists[0].id, 'inbox')
      assert.equal((await rpc('tasks:clear-completed', [])).cleared, 1)
      assert.equal((await rpc('tasks:delete', [t.id])).removed, false)
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('two profiles with different data folders never see each other', async () => {
  const a = await mkdtemp(join(tmpdir(), 'orbis-p-'))
  const b = await mkdtemp(join(tmpdir(), 'orbis-p-'))
  try {
    await withHelper(a, (rpc) => rpc('notes:create', [{ title: 'mine' }]))
    await withHelper(b, async (rpc) => assert.equal((await rpc('notes:list', [])).length, 0))
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})

test('bad shapes are refused before they reach the store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-p-'))
  try {
    await withHelper(dir, async (rpc) => {
      for (const [channel, args] of [
        ['notes:create', ['string']], ['notes:create', [{ title: 5 }]], ['notes:create', [{ color: 'pink' }]], ['notes:create', [{ tags: 'a' }]],
        ['notes:update', [{}, {}]], ['notes:delete', [42]], ['notes:search', [7]], ['notes:list', [{ sort: 'x' }]],
        ['tasks:create', [{}]], ['tasks:create', [{ title: 'a', listId: 'nope' }]], ['tasks:create', [{ title: 'a', priority: 'urgent' }]],
        ['tasks:create', [{ title: 'a', due: 'tomorrow' }]], ['tasks:complete', ['x', 'yes']], ['tasks:list', [{ view: 'zzz' }]]
      ] as [string, unknown[]][]) {
        await assert.rejects(rpc(channel, args), (e: any) => e.code === 'bad-request', `${channel} ${JSON.stringify(args)}`)
      }
      // Unknown fields are dropped, not stored.
      const n = await rpc('notes:create', [{ title: 'ok', id: 'forced', createdAt: 1, evil: true }])
      assert.notEqual(n.id, 'forced')
      assert.equal(n.evil, undefined)
    })
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('pure validators', () => {
  assert.deepEqual(noteFilter(undefined), {})
  assert.deepEqual(notePatch({ pinned: true, junk: 1 }), { pinned: true })
  assert.deepEqual(taskPatch({ due: null }), { due: undefined })
  assert.throws(() => taskPatch({ subtasks: [{ id: 'a' }] }))
})

test('a task can be set to repeat, and to stop', () => {
  /*
   * `repeat` was not in the patch at all, so the browser panel could show a repeating task and had no way to set
   * one or stop one. A field a screen can show and cannot change is the half of a feature that looks finished.
   */
  assert.deepEqual(taskPatch({ repeat: { every: 'week', interval: 2 } }), { repeat: { every: 'week', interval: 2 } })
  assert.deepEqual(taskPatch({ repeat: null }), { repeat: undefined }, 'null is how somebody stops it repeating')
  // Not mentioned is not the same as cleared: an editor that does not know about repeats leaves them alone.
  assert.deepEqual(taskPatch({ title: 'just a rename' }), { title: 'just a rename' })

  assert.throws(() => taskPatch({ repeat: { every: 'fortnight', interval: 1 } }), /Unknown repeat/)
  assert.throws(() => taskPatch({ repeat: { every: 'day', interval: 0 } }), /every 1 to 365/)
  assert.throws(() => taskPatch({ repeat: { every: 'day', interval: 400 } }), /every 1 to 365/)
  assert.throws(() => taskPatch({ repeat: { every: 'day', interval: 'often' } }), /every 1 to 365/)
})

test('a due time survives being edited', () => {
  /*
   * The fault this is really for. `tasks:update` replaces what it is given, and the panel's editor sent
   * `hasTime: false` on every save -- so opening a task due at three o'clock and pressing Save moved it to
   * midnight, with nothing said and no way to put it back.
   */
  const threeOClock = new Date('2026-03-04T15:00:00').getTime()
  assert.deepEqual(taskPatch({ due: threeOClock, hasTime: true }), { due: threeOClock, hasTime: true })
  // And a day with no time on it is still a day with no time on it.
  const theDay = new Date('2026-03-04T00:00:00').getTime()
  assert.deepEqual(taskPatch({ due: theDay, hasTime: false }), { due: theDay, hasTime: false })
})

test('one set of notes and tasks, not two', async () => {
  /*
   * The fault, measured. The panel and the window each held their own store over the same file, and both keep what
   * they read in memory -- so a step added to a task in the browser was written to disk, the panel showed it, and
   * the window went on showing the task without it for as long as it stayed open. Worse, the window's next save
   * wrote its own stale copy back, and the step had never happened.
   *
   * Lending the application's store to the helper is the whole fix, and this is what it has to hold: a change made
   * through the helper's channels is visible to whoever holds the store, immediately, with nothing re-read.
   */
  const dir = await mkdtemp(join(tmpdir(), 'orbis-personal-'))
  try {
    const notes = new NotesStore(dir)
    const tasks = new TasksStore(dir)
    const server = createHelperServer({
      token: TOKEN,
      allowedOrigins: [PANEL],
      handlers: createHandlers({ apiKeys: [], dataDir: dir, personal: () => ({ notes, tasks }) })
    })
    const { port } = await server.listen()
    const rpc = async (channel: string, args: unknown[] = []): Promise<any> => {
      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, Origin: PANEL, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, args })
      })
      const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
      const last = lines[lines.length - 1]
      if (last.error) throw Object.assign(new Error(last.error.message), { code: last.error.code })
      return last.result ?? last.value ?? last
    }

    try {
      // Made by the application.
      const task = await tasks.create({ title: 'Ring the dentist' })
      const note = await notes.create({ title: 'A note', body: 'Something' })

      // Changed through the helper, the way the browser panel does it.
      await rpc('tasks:update', [task.id, { subtasks: [{ id: 'st_1', title: 'Find the number', done: false }] }])
      await rpc('notes:update', [note.id, { body: 'Something else' }])

      // And the application sees it, with nothing re-read and no watcher anywhere.
      const seen = await tasks.get(task.id)
      assert.deepEqual(
        seen?.subtasks.map((one) => one.title),
        ['Find the number'],
        'a change made in the panel is a change the window can see'
      )
      assert.equal((await notes.get(note.id))?.body, 'Something else')

      // And the other way round, which is the half that used to overwrite the first.
      await tasks.update(task.id, { title: 'Ring the dentist back' })
      const listed = await rpc('tasks:list', [{ view: 'all' }])
      assert.equal(listed[0].title, 'Ring the dentist back')
      assert.deepEqual(listed[0].subtasks.map((one: { title: string }) => one.title), ['Find the number'], 'and nothing was written over')
    } finally {
      await server.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('without a data folder there are no personal channels', async () => {
  await withHelper('', async (rpc) => {
    await assert.rejects(rpc('notes:list', []))
  })
})
