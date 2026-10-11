// Serves the built-in Orbis panel (orbis-ui/panel) in an ordinary browser tab, wired to the REAL Orbis helper, for looking at the rail's
// views without a Chromium build.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/panel-ui-check.mjs [--empty] [--nostores]
//   -> prints  PAGE http://127.0.0.1:<port>/index.html?orbis-test-helper=<helper port>#<token>   and keeps running (Ctrl+C to stop).
//
// What is real: the helper (src/helper, all channels), and every store behind it (library, clipboard history, tasks, whiteboard, workspaces,
// search sessions) as temp-folder copies seeded through the stores' own methods / the helper's own channels.
// What is a stand-in: the Browser Control Layer. There is no browser here, so Tabs / Tab groups / Media / Controls talk to a small
// in-memory browser (tabs, groups, zoom) that answers the same capabilities. Those four rows are therefore checked for their UI and their
// wiring, not against Chromium.
// The page gets its port and token by the test-only address form accepted by orbis-ui/panel/helper.js (http: on 127.0.0.1 only).
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname, normalize } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { BrowserLibrary } from '../src/main/browserLibrary.ts'
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
// ---- REAL browser: BrowserManager with these stores, the way src/main/index.ts wires it
import { spawnSync } from 'node:child_process'
import { BrowserManager } from '../src/main/chromium/browserManager.ts'
const REPO = root
await tasks.create({ title: 'Call the dentist', due: Date.now() + 3 * 3_600_000, hasTime: true })
await tasks.create({ title: 'Send the invoice', due: Date.now() - 2 * 3_600_000, hasTime: true })
const board = await whiteboard.create({ name: 'Launch plan' })
const now = Date.now()
sessions.save({ id: 'sreal1', profileId: 'default', topic: 'How does the Fetch API stream a response body', turns: [{ id: 't1', question: 'q', answer: 'a', used: [1], researched: true, at: now }], sources: [{ url: 'https://developer.mozilla.org/en-US/docs/Fetch', title: 'MDN reference', site: 'developer.mozilla.org', snippet: '', turn: 0 }], entities: [], constraints: [], startedAt: now, updatedAt: now })
const manager = new BrowserManager({
  chrome: 'C:/chromium/src/out/Default/chrome.exe',
  extensionSource: join(REPO, 'extension'),
  dataDir: join(dir, 'chromium'),
  profileId: () => 'default',
  apiKeys: () => [],
  adblockBundledDir: join(REPO, 'resources', 'adblock'),
  adblockListsDir: join(dir, 'lists'),
  personalDir: (id) => join(dir, 'personal', id),
  searchSessions: () => sessions,
  stores: () => ({ library, removeFile: async () => undefined, openFile: async () => '', clipboard, tasks, whiteboard, workspaces, research: { withSources: (n) => sessions.withSources(n) }, control: manager.active?.service.control })
})
globalThis.manager = manager
console.log('DIR', dir)
await manager.open('example.org')
const svc = await manager.ensure()
console.log('READY')
globalThis.svc = svc; globalThis.seed = { board, dir }
const { existsSync: ex, readFileSync: rf, unlinkSync: ul } = await import('node:fs')
setInterval(async () => { const f = join(dir, 'drive.mjs'); if (!ex(f)) return; const src = rf(f, 'utf8'); ul(f); const out = join(dir, 'drive.out'); try { const r = await (0, eval)('(async()=>{' + src + '})()'); (await import('node:fs')).writeFileSync(out, JSON.stringify(r ?? null, null, 1)) } catch (e) { (await import('node:fs')).writeFileSync(out, 'ERR ' + (e.stack ?? e)) } }, 500)
process.on('SIGINT', async () => { await manager.stop(); process.exit(0) })
setInterval(() => undefined, 1 << 30)

