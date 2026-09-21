// Serves the built-in Orbis panel (orbis-ui/panel) in an ordinary browser tab, wired to the REAL Orbis helper, for looking at the rail's
// views without a Chromium build.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/panel-ui-check.mjs [--empty] [--nostores]
//   -> prints  PAGE http://127.0.0.1:<port>/index.html?orbis-test-helper=<helper port>#<token>   and keeps running (Ctrl+C to stop).
//
// What is real: the helper (src/helper, all channels), and every store behind it (library, clipboard history, tasks, whiteboard, workspaces,
// search sessions, sidebar layout) as temp-folder copies seeded through the stores' own methods / the helper's own channels.
// What is a stand-in: the Browser Control Layer. There is no browser here, so Tabs / Tab groups / Media / Controls talk to a small
// in-memory browser (tabs, groups, zoom) that answers the same capabilities. Those four rows are therefore checked for their UI and their
// wiring, not against Chromium.
// The page gets its port and token by the test-only address form accepted by orbis-ui/panel/helper.js (http: on 127.0.0.1 only).
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname, normalize } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { newToken } from '../src/helper/auth.ts'
import { createHandlers } from '../src/helper/handlers.ts'
import { createHelperServer } from '../src/helper/server.ts'
import { BrowserLibrary } from '../src/main/browserLibrary.ts'
import { BrowserSidebarStore } from '../src/main/browserSidebarStore.ts'
import { ClipboardHistory } from '../src/main/personal/clipboard.ts'
import { TasksStore } from '../src/main/personal/tasks.ts'
import { WhiteboardStore } from '../src/main/personal/whiteboard.ts'
import { WorkspacesStore } from '../src/main/personal/workspaces.ts'
import { SearchSessionStore } from '../src/main/knowledge/searchSessions.ts'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const empty = process.argv.includes('--empty')
const noStores = process.argv.includes('--nostores')
const dir = await mkdtemp(join(tmpdir(), 'orbis-panel-check-'))

// ---- a small PNG (a gradient), so the screenshot thumbnails have something to show
function png(w, h, colorAt) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) raw.set(colorAt(x, y), y * (w * 3 + 1) + 1 + x * 3)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0)
  head.writeUInt32BE(h, 4)
  head.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- the library's own file: saved pages and pictures an earlier Orbis kept
const shots = join(dir, 'screenshots')
await mkdir(shots, { recursive: true })
if (!empty) {
  await writeFile(join(shots, 'a.png'), png(320, 200, (x, y) => [40 + (x % 200), 90 + (y % 120), 200 - (x % 100)]))
  await writeFile(join(shots, 'b.png'), png(320, 200, (x, y) => [220 - (y % 100), 80 + (x % 160), 60 + (y % 150)]))
  await writeFile(
    join(dir, 'browser-library.json'),
    JSON.stringify({
      savedPages: [
        { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', title: 'Fetch API - Web APIs | MDN', path: join(dir, 'fetch.html'), savedAt: Date.now() - 3_600_000 },
        { url: 'https://example.com/long-article', title: 'A very long article title that keeps going so the row has to cut it off with an ellipsis somewhere', path: join(dir, 'long.html'), savedAt: Date.now() - 86_400_000 * 3 }
      ],
      screenshots: [
        { id: 'shot-a', url: 'https://example.com/', title: 'Example Domain', path: join(shots, 'a.png'), at: Date.now() - 600_000, width: 320, height: 200 },
        { id: 'shot-b', url: 'https://developer.mozilla.org/', title: 'MDN', path: join(shots, 'b.png'), at: Date.now() - 86_400_000, width: 320, height: 200 },
        { id: 'shot-gone', url: 'https://example.org/', title: 'File was deleted', path: join(shots, 'gone.png'), at: Date.now() - 172_800_000, width: 320, height: 200 }
      ]
    })
  )
}
const library = new BrowserLibrary(dir)
await library.load()

// ---- clipboard
let clipText = ''
const clipboard = new ClipboardHistory({
  userData: dir,
  clipboard: { readText: async () => clipText, writeText: async (t) => void (clipText = t), readImage: async () => null, writeImage: async () => undefined },
  isActive: () => true,
  context: () => ({ url: 'https://example.com/', title: 'Example' })
})
await clipboard.check()
await clipboard.updateSettings({ skipSecrets: false })
if (!empty) {
  for (const t of ['npm install --save-dev esbuild', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'Meeting notes: agree the launch date on Thursday and send the summary to the whole team afterwards.', 'Xy7#qP9!zLm2$kR8']) {
    clipText = t
    await clipboard.check()
  }
  const first = (await clipboard.all()).find((c) => c.preview.startsWith('npm'))
  if (first) await clipboard.setPinned(first.id, true)
}

const tasks = new TasksStore(dir)
const whiteboard = new WhiteboardStore(dir)
const workspaces = new WorkspacesStore(dir)
const sessions = new SearchSessionStore(dir)

// ---- an in-memory stand-in for the browser (see the note at the top)
const browser = {
  tabs: empty
    ? []
    : [
        { id: '11', index: 0, url: 'https://example.com/', title: 'Example Domain', active: true, loading: false, pinned: true, groupId: -1, muted: false, audible: false },
        { id: '12', index: 1, url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', title: 'Fetch API - Web APIs | MDN', active: false, loading: false, pinned: false, groupId: 5, muted: false, audible: false },
        { id: '13', index: 2, url: 'https://www.youtube.com/watch?v=abc', title: 'A long video title that has to be shortened to fit the narrow side panel', active: false, loading: false, pinned: false, groupId: -1, muted: false, audible: true },
        { id: '14', index: 3, url: 'https://news.ycombinator.com/', title: 'Hacker News', active: false, loading: true, pinned: false, groupId: 5, muted: true, audible: false },
        { id: '15', index: 4, url: 'https://github.com/', title: 'GitHub', active: false, loading: false, pinned: false, groupId: -1, muted: false, audible: false }
      ],
  groups: empty ? [] : [{ id: 5, title: 'Research', color: 'blue', collapsed: false }],
  zoom: 1.25,
  history: { index: 1, length: 3 }
}
const ZOOM = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const okay = (data) => ({ ok: true, data })
const control = {
  async execute({ capability: c, params: p }) {
    const tab = (id) => browser.tabs.find((t) => t.id === String(id))
    const reindex = () => browser.tabs.forEach((t, i) => (t.index = i))
    switch (c) {
      case 'tabs.list':
        return okay(browser.tabs.map((t) => ({ ...t })))
      case 'groups.list':
        return okay(browser.groups.map((g) => ({ id: String(g.id), name: g.title, color: g.color, collapsed: g.collapsed, tabIds: browser.tabs.filter((t) => t.groupId === g.id).map((t) => t.id) })))
      case 'tabs.activate':
        browser.tabs.forEach((t) => (t.active = t.id === String(p.tabId)))
        return okay({})
      case 'tabs.close':
        browser.tabs = browser.tabs.filter((t) => t.id !== String(p.tabId))
        reindex()
        return okay({})
      case 'tabs.mute':
        if (tab(p.tabId)) tab(p.tabId).muted = p.muted === true
        return okay({})
      case 'tabs.pin':
        if (tab(p.tabId)) tab(p.tabId).pinned = p.pinned === true
        return okay({})
      case 'tabs.move': {
        const t = tab(p.tabId)
        if (t) (browser.tabs.splice(browser.tabs.indexOf(t), 1), browser.tabs.splice(Math.min(p.index, browser.tabs.length), 0, t), reindex())
        return okay({})
      }
      case 'tabs.create':
        browser.tabs.push({ id: String(100 + browser.tabs.length), index: browser.tabs.length, url: p.url ?? '', title: p.url ?? '', active: true, loading: false, pinned: false, groupId: -1, muted: false, audible: false })
        return okay({ tabId: '1' })
      case 'groups.create': {
        const id = Math.max(0, ...browser.groups.map((g) => g.id)) + 1
        browser.groups.push({ id, title: p.name ?? '', color: /^#/.test(p.color ?? '') ? 'green' : (p.color ?? 'grey'), collapsed: false })
        for (const t of p.tabIds ?? []) if (tab(t)) tab(t).groupId = id
        return okay({ groupId: String(id) })
      }
      case 'groups.rename': {
        const g = browser.groups.find((x) => String(x.id) === String(p.groupId))
        if (g) (g.title = p.name, p.color && (g.color = /^#/.test(p.color) ? 'green' : p.color))
        return okay({})
      }
      case 'groups.collapse': {
        const g = browser.groups.find((x) => String(x.id) === String(p.groupId))
        if (g) g.collapsed = p.collapsed === true
        return okay({})
      }
      case 'groups.delete':
        browser.tabs.forEach((t) => String(t.groupId) === String(p.groupId) && (t.groupId = -1))
        browser.groups = browser.groups.filter((g) => String(g.id) !== String(p.groupId))
        return okay({})
      case 'groups.addTab':
        if (tab(p.tabId)) tab(p.tabId).groupId = Number(p.groupId)
        return okay({})
      case 'groups.removeTab':
        if (tab(p.tabId)) tab(p.tabId).groupId = -1
        return okay({})
      case 'navigation.info':
        return okay({ url: browser.tabs.find((t) => t.active)?.url ?? '', title: browser.tabs.find((t) => t.active)?.title ?? '', loading: false, canGoBack: browser.history.index > 0, canGoForward: browser.history.index < browser.history.length - 1 })
      case 'navigation.back':
        browser.history.index--
        return okay({})
      case 'navigation.forward':
        browser.history.index++
        return okay({})
      case 'navigation.reload':
      case 'navigation.stop':
        return okay({})
      case 'zoom.get':
        return okay({ factor: browser.zoom })
      case 'zoom.set': {
        if (p.action === 'in') browser.zoom = ZOOM.find((z) => z > browser.zoom + 0.001) ?? 5
        else if (p.action === 'out') browser.zoom = [...ZOOM].reverse().find((z) => z < browser.zoom - 0.001) ?? 0.25
        else if (p.action === 'reset') browser.zoom = 1
        else browser.zoom = p.factor
        return okay({ factor: browser.zoom })
      }
      case 'browser.openWorkspace':
        browser.tabs = p.tabs.map((t, i) => ({ id: String(200 + i), index: i, url: t.url, title: t.title, active: i === 0, loading: false, pinned: t.pinned === true, groupId: -1, muted: false, audible: false }))
        return okay({ tabIds: browser.tabs.map((t) => t.id) })
      default:
        return { ok: false, error: { message: `The stand-in browser does not know ${c}.` } }
    }
  }
}

// ---- the page server and the helper
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' }
const pageServer = createServer(async (request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0].split('#')[0])
  const name = normalize(path === '/' ? 'index.html' : path).replace(/^([/\\]|\.\.[/\\])+/, '')
  for (const base of [join(root, 'orbis-ui', 'panel'), join(root, 'orbis-ui')]) {
    const file = join(base, name)
    if (file.startsWith(base) && existsSync(file) && !file.endsWith('.ts')) {
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      return response.end(await readFile(file))
    }
  }
  response.writeHead(404).end('not found')
})
await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve))
const pagePort = pageServer.address().port

const token = newToken()
const sidebarStore = new BrowserSidebarStore(dir)
const stores = () =>
  noStores
    ? null
    : {
        library,
        removeFile: async (path) => void (await import('node:fs/promises')).rm(path, { force: true }),
        openFile: async () => '',
        clipboard,
        tasks,
        whiteboard,
        workspaces,
        research: { withSources: (limit) => sessions.withSources(limit) },
        control
      }
const helper = createHelperServer({
  token,
  allowedOrigins: [`http://127.0.0.1:${pagePort}`],
  handlers: createHandlers({
    apiKeys: [],
    dataDir: dir,
    searchSessions: () => sessions,
    sidebar: () => ({ read: () => sidebarStore.read('default'), write: (l) => sidebarStore.write('default', l), reset: () => sidebarStore.reset('default') }),
    browserControl: () => (noStores ? null : control),
    stores
  })
})
const { port: helperPort } = await helper.listen()

const rpc = async (channel, args = []) => {
  const res = await fetch(`http://127.0.0.1:${helperPort}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: `http://127.0.0.1:${pagePort}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, args }) })
  const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const last = lines[lines.length - 1]
  if (last.error) throw new Error(`${channel}: ${last.error.message}`)
  return last.result
}

// ---- seeding through the helper's own channels
if (!empty && !noStores) {
  await rpc('reminders:add', ['Call the dentist to move the appointment', Date.now() + 3 * 3_600_000, true])
  await rpc('reminders:add', ['Send the invoice', Date.now() - 2 * 3_600_000, true])
  const done = await rpc('reminders:add', ['Renew the domain', Date.now() + 86_400_000 * 2, true])
  await rpc('reminders:done', [done.id, true])
  const board = await rpc('whiteboard:create', ['Launch plan'])
  await rpc('whiteboard:add-page', [board.id])
  await rpc('whiteboard:create', ['Empty board'])
  await rpc('workspaces:create', ['Research day'])
  const now = Date.now()
  for (const [i, topic] of ['How does the Fetch API stream a response body', 'Chromium side panel APIs'].entries()) {
    sessions.save({
      id: `s${i}test`,
      profileId: 'default',
      topic,
      turns: [{ id: 't1', question: topic, answer: `Here is what I found about ${topic}.`, used: [1], researched: true, at: now - i * 3_600_000 }],
      sources: [{ url: `https://developer.mozilla.org/en-US/docs/${i}`, title: `MDN reference ${i}`, site: 'developer.mozilla.org', snippet: '', turn: 0 }, { url: 'https://chromium.org/developers', title: 'Chromium developers', site: 'chromium.org', snippet: '', turn: 0 }],
      entities: [],
      constraints: [],
      startedAt: now - i * 3_600_000,
      updatedAt: now - i * 3_600_000
    })
  }
}

console.log(`PAGE http://127.0.0.1:${pagePort}/index.html?orbis-test-helper=${helperPort}#${token}`)
console.log(`DIR ${dir}`)
process.on('SIGINT', () => process.exit(0))
setInterval(() => undefined, 1 << 30)
