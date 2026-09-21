import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BrowserLibrary } from '../main/browserLibrary.ts'
import { ClipboardHistory } from '../main/personal/clipboard.ts'
import { TasksStore } from '../main/personal/tasks.ts'
import { WhiteboardStore } from '../main/personal/whiteboard.ts'
import { WorkspacesStore } from '../main/personal/workspaces.ts'
import { createPanelStoreHandlers } from './panelStores.ts'
import type { PanelStores } from './panelStores.ts'

const ctx = { signal: new AbortController().signal, emit: () => undefined } as never
const call = async (h: Record<string, (a: unknown[], c: never) => unknown>, channel: string, ...args: unknown[]): Promise<any> => h[channel](args, ctx)

// A real set of stores in a temp folder, seeded through the stores' own methods.
async function world() {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-panel-'))
  const shots = join(dir, 'screenshots')
  await mkdir(shots, { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await writeFile(join(shots, 'one.png'), png)
  await writeFile(join(dir, 'outside.png'), png)
  await writeFile(
    join(dir, 'browser-library.json'),
    JSON.stringify({
      history: [],
      savedPages: [{ url: 'https://a.test/x', title: 'Saved A', path: join(dir, 'a.html'), savedAt: 5 }, { nonsense: true }],
      screenshots: [
        { id: 'one', url: 'https://a.test/', title: 'Shot', path: join(shots, 'one.png'), at: 9, width: 1, height: 1 },
        { id: 'out', url: 'https://a.test/', title: 'Outside', path: join(dir, 'outside.png'), at: 8, width: 1, height: 1 }
      ]
    })
  )
  const library = new BrowserLibrary(dir)
  await library.load()
  let clipText = ''
  const clipboard = new ClipboardHistory({
    userData: dir,
    clipboard: { readText: async () => clipText, writeText: async (t) => void (clipText = t), readImage: async () => null, writeImage: async () => undefined },
    isActive: () => true,
    context: () => ({ url: 'https://a.test/', title: 'A' })
  })
  const copy = async (text: string): Promise<void> => {
    clipText = text
    await clipboard.check()
  }
  await copy('start')
  await clipboard.updateSettings({ skipSecrets: false })
  const tasks = new TasksStore(dir)
  const whiteboard = new WhiteboardStore(dir)
  const workspaces = new WorkspacesStore(dir)
  const removed: string[] = []
  const opened: string[] = []
  const controlCalls: { capability: string; params: Record<string, unknown> }[] = []
  const tabs = [
    { id: '1', url: 'https://a.test/', title: 'A', active: true, pinned: false, groupId: 3 },
    { id: '2', url: 'chrome://settings/', title: 'Settings', active: false, pinned: false, groupId: -1 }
  ]
  const stores: PanelStores = {
    library,
    removeFile: async (p) => void removed.push(p),
    openFile: async (p) => void opened.push(p),
    clipboard,
    tasks,
    whiteboard,
    workspaces,
    research: { withSources: () => [{ id: 's1', title: 'Chromium', updatedAt: 3, sourceList: [{ url: 'https://docs.test/1', title: 'Docs' }, { url: 'javascript:alert(1)', title: 'bad' }] }, { id: 's2', title: 'More', updatedAt: 2, sourceList: [{ url: 'https://docs.test/1', title: 'Docs again' }] }] },
    control: {
      execute: async (c) => {
        controlCalls.push({ capability: c.capability, params: c.params })
        if (c.capability === 'tabs.list') return { ok: true, data: tabs }
        if (c.capability === 'groups.list') return { ok: true, data: [{ id: '3', name: 'Work', color: 'blue', collapsed: false, tabIds: ['1'] }] }
        return { ok: true, data: { tabIds: ['9'] } }
      }
    }
  }
  return { dir, stores, copy, removed, opened, controlCalls, clipboard, library, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('saved pages: listed without damaged rows, opened only from the list, forgotten without touching the file', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    const pages = await call(h, 'library:saved-pages')
    assert.equal(pages.length, 1)
    assert.equal(pages[0].title, 'Saved A')
    await assert.rejects(call(h, 'library:saved-page-open', 'C:/Windows/system32/calc.exe'), /not in the list/)
    await assert.rejects(call(h, 'library:saved-page-open', 42), /not valid/)
    assert.equal(await call(h, 'library:saved-page-open', pages[0].path), true)
    assert.deepEqual(w.opened, [pages[0].path])
    assert.equal(await call(h, 'library:saved-page-forget', pages[0].path), true)
    assert.equal((await call(h, 'library:saved-pages')).length, 0)
    assert.equal(await call(h, 'library:saved-page-forget', pages[0].path), false)
    assert.deepEqual(w.removed, [])
    await writeFile(join(w.dir, 'browser-library.json'), JSON.stringify({ savedPages: [{ url: 'https://a.test/', title: 'x', path: join(w.dir, 'run.exe'), savedAt: 1 }] }))
    await w.library.load()
    await assert.rejects(call(h, 'library:saved-page-open', join(w.dir, 'run.exe')), /not a saved web page/)
    assert.deepEqual(w.opened, [pages[0].path], 'a program is never opened')
  } finally {
    await w.cleanup()
  }
})

test('screenshots: listed without paths, thumbnails only from the library folder, removal deletes only its own file', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    const shots = await call(h, 'library:screenshots')
    assert.deepEqual(shots.map((s: { id: string }) => s.id), ['one', 'out'])
    assert.ok(shots.every((s: object) => !('path' in s)))
    assert.match(await call(h, 'library:screenshot-image', 'one'), /^data:image\/png;base64,/)
    assert.equal(await call(h, 'library:screenshot-image', 'out'), null, 'a file outside the library folder is never read')
    assert.equal(await call(h, 'library:screenshot-image', 'nope'), null)
    await assert.rejects(call(h, 'library:screenshot-image', '../../etc/passwd'), /not valid/)
    assert.equal(await call(h, 'library:screenshot-remove', 'one'), true)
    assert.equal(await call(h, 'library:screenshot-remove', 'out'), true)
    assert.deepEqual(w.removed, [join(w.dir, 'screenshots', 'one.png')])
    assert.equal(await call(h, 'library:screenshot-remove', 'one'), false)
  } finally {
    await w.cleanup()
  }
})

test('clipboard: secrets are masked, revealed only by explicit call, copy back, pin, remove, clear', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    await w.copy('hello world')
    await w.copy('Xy7#qP9!zLm2$kR8')
    const listed = await call(h, 'clipboard:list', '', 'all')
    const secret = listed.items.find((i: { masked: boolean }) => i.masked)
    const plain = listed.items.find((i: { preview: string }) => i.preview === 'hello world')
    assert.ok(secret && plain)
    assert.ok(!JSON.stringify(listed).includes('Xy7#qP9'), 'the list never carries the secret text')
    assert.equal((await call(h, 'clipboard:reveal', secret.id)).text, 'Xy7#qP9!zLm2$kR8')
    await assert.rejects(call(h, 'clipboard:reveal', 'x y'), /not valid/)
    await assert.rejects(call(h, 'clipboard:reveal', 'nothere'), /no longer/)
    assert.equal((await call(h, 'clipboard:copy', plain.id)).id, plain.id)
    assert.equal((await call(h, 'clipboard:pin', plain.id, true)).pinned, true)
    await assert.rejects(call(h, 'clipboard:pin', plain.id, 'yes'), /true or false/)
    assert.equal(await call(h, 'clipboard:remove', secret.id), true)
    assert.equal((await call(h, 'clipboard:clear', false)).removed >= 1, true)
    assert.ok((await call(h, 'clipboard:list')).items.some((i: { id: string }) => i.id === plain.id), 'pinned entries survive a clear')
    await assert.rejects(call(h, 'clipboard:list', 'q'.repeat(300)), /not valid/)
    await assert.rejects(call(h, 'clipboard:list', '', 'bogus'), /not valid/)
    assert.equal(await call(h, 'clipboard:image', plain.id), null)
  } finally {
    await w.cleanup()
  }
})

test('reminders: only tasks with a time, add / complete / remove with checked arguments', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    await w.stores.tasks!.create({ title: 'No time set' })
    const made = await call(h, 'reminders:add', 'Call the bank', Date.now() + 3_600_000, true)
    let list = await call(h, 'reminders:list')
    assert.deepEqual(list.map((r: { title: string }) => r.title), ['Call the bank'])
    await call(h, 'reminders:done', made.id, true)
    list = await call(h, 'reminders:list')
    assert.equal(list[0].done, true)
    assert.equal(await call(h, 'reminders:remove', made.id), true)
    for (const bad of [['', 5], ['x', 'soon'], ['x', -1], [7, 5]]) await assert.rejects(call(h, 'reminders:add', ...bad), /not valid/)
    await assert.rejects(call(h, 'reminders:done', made.id, 'yes'), /true or false/)
  } finally {
    await w.cleanup()
  }
})

test('whiteboard: list, create, rename, add the page in front, read as text, remove', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    const board = await call(h, 'whiteboard:create', 'Ideas')
    await call(h, 'whiteboard:rename', board.id, 'Ideas 2')
    await call(h, 'whiteboard:add-page', board.id)
    const listed = await call(h, 'whiteboard:list')
    assert.deepEqual(listed.map((b: { name: string; count: number }) => [b.name, b.count]), [['Ideas 2', 1]])
    const got = await call(h, 'whiteboard:get', board.id)
    assert.match(got.items[0].text, /https:\/\/a\.test\//)
    await assert.rejects(call(h, 'whiteboard:get', 'missing'), /no longer exists/)
    await assert.rejects(call(h, 'whiteboard:create', ''), /not valid/)
    await assert.rejects(call(h, 'whiteboard:rename', board.id, 'x'.repeat(200)), /not valid/)
    assert.equal(await call(h, 'whiteboard:remove', board.id), true)
  } finally {
    await w.cleanup()
  }
})

test('workspaces: create from open web tabs, list, open through the control layer, rename, remove', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    const made = await call(h, 'workspaces:create', 'Research day')
    const list = await call(h, 'workspaces:list')
    assert.equal(list.length, 1)
    assert.equal(list[0].tabs, 1, 'chrome:// pages are not saved')
    assert.equal(list[0].current, true)
    const opened = await call(h, 'workspaces:open', made.id, true)
    assert.deepEqual(opened, { tabIds: ['9'] })
    const open = w.controlCalls.find((c) => c.capability === 'browser.openWorkspace')!
    assert.equal(open.params.replace, true)
    assert.equal((open.params.tabs as unknown[]).length, 1)
    await call(h, 'workspaces:rename', made.id, 'Renamed')
    assert.equal((await call(h, 'workspaces:list'))[0].name, 'Renamed')
    await assert.rejects(call(h, 'workspaces:open', 'missing'), /no longer exists/)
    await assert.rejects(call(h, 'workspaces:create', '  '), /not valid/)
    assert.equal(await call(h, 'workspaces:remove', made.id), true)
  } finally {
    await w.cleanup()
  }
})

test('sources: flattened, de-duplicated, web pages only', async () => {
  const w = await world()
  try {
    const h = createPanelStoreHandlers(() => w.stores)
    const sources = await call(h, 'research:sources')
    assert.deepEqual(sources.map((s: { url: string }) => s.url), ['https://docs.test/1'])
    assert.equal(sources[0].sessionTitle, 'Chromium')
  } finally {
    await w.cleanup()
  }
})

test('with no store lent, every channel says it is not available and nothing else', async () => {
  const none = createPanelStoreHandlers(() => null)
  const partial = createPanelStoreHandlers(() => ({}))
  const channels = ['library:saved-pages', 'library:screenshots', 'clipboard:list', 'reminders:list', 'whiteboard:list', 'workspaces:list', 'research:sources']
  for (const h of [none, partial]) for (const channel of channels) await assert.rejects(call(h, channel), /not available/, channel)
  await assert.rejects(call(none, 'workspaces:create', 'x'), /not available/)
  await assert.rejects(call(none, 'whiteboard:add-page', 'b1'), /not available/)
  await assert.rejects(call(none, 'clipboard:reveal', 'id1'), /not available/)
})

test('a library file is left as it was when nothing is forgotten', async () => {
  const w = await world()
  try {
    await w.library.flush()
    const raw = JSON.parse(await readFile(join(w.dir, 'browser-library.json'), 'utf8'))
    assert.equal(raw.savedPages.length, 2, 'rows the panel cannot show are kept, never dropped')
    assert.ok(existsSync(join(w.dir, 'screenshots', 'one.png')))
  } finally {
    await w.cleanup()
  }
})
