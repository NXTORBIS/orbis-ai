import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { newToken } from '../../helper/auth.ts'
import { createHandlers } from '../../helper/handlers.ts'
import { createHelperServer } from '../../helper/server.ts'
import { ORBIS_EXTENSION_ID } from './browserManager.ts'

/**
 * Orbis Search, the results page of the Orbis browser, driven in the real browser: every vertical with results, the viewer, Orion's
 * saved sessions, the search box and its recent searches, bangs, and how it looks light and dark, wide and narrow.
 *
 * Web search and Orion use the helper's real providers (skipped when there is no network / no key). The specialized categories need
 * Orbis's own aggregation service, which is a separate service not run in tests: a small stand-in speaking its JSON API serves
 * payloads shaped like the real ones (see specializedSearch.test.ts), so the page's drawing of each category is tested for real.
 * Set ORBIS_SHOTS=<folder> to keep screenshots of each state.
 */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const REPO = resolve(import.meta.dirname, '../../..')
const run = existsSync(CHROME) && existsSync(join(REPO, 'extension', 'results.js'))
const SHOTS = process.env.ORBIS_SHOTS

const keys = (() => {
  try {
    const text = readFileSync(join(REPO, '.env.local'), 'utf8')
    return (/^GROQ_API_KEY=(.*)$/m.exec(text)?.[1] ?? '').split(/[\s,]+/).filter(Boolean)
  } catch {
    return []
  }
})()

/** A real PNG (a gradient), made here so the stand-in can serve pictures without any file. */
function png(w: number, h: number, hue: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = (hue + (x * 120) / w) % 256
      raw[o + 1] = (80 + (y * 150) / h) % 256
      raw[o + 2] = (200 - (x * 100) / w) % 256
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Stands in for Orbis's aggregation service: its JSON API, with payloads shaped like the real ones. */
function stand_in(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    if (url.pathname.startsWith('/img/')) {
      res.setHeader('content-type', 'image/png')
      return void res.end(png(url.pathname.includes('wide') ? 320 : 160, 120, Number(url.pathname.replace(/\D/g, '')) || 0))
    }
    const category = url.searchParams.get('categories') ?? ''
    const q = url.searchParams.get('q') ?? ''
    const many = (n: number, make: (i: number) => Record<string, unknown>): Record<string, unknown>[] => Array.from({ length: n }, (_, i) => make(i))
    let results: Record<string, unknown>[] = []
    if (category === 'images')
      results = many(9, (i) => ({ title: `${q} picture ${i + 1}`, url: `https://example.org/gallery/${i + 1}`, img_src: `${origin}/img/${i * 20}`, thumbnail: `${origin}/img/${i * 20}`, img_width: 1600 + i, img_height: 1200, engines: ['openverse'] }))
    else if (category === 'videos')
      results = many(4, (i) => ({ title: `${q} film ${i + 1}`, url: `https://videos.example.net/watch/${i + 1}`, content: 'A description of the film.', author: 'Some Channel', length: 300 + i * 61, thumbnail: `${origin}/img/${i * 40}-wide`, ...(i % 2 === 0 ? { iframe_src: `${origin}/embed/${i}` } : {}), views: 12000 * (i + 1), engines: ['peertube'] }))
    else if (category === 'news')
      results = many(4, (i) => ({ title: `${q} in the news ${i + 1}`, url: `https://news.example.com/story/${i + 1}`, content: 'What happened, in a sentence or two.', publishedDate: '2026-05-0' + (i + 1) + 'T10:00:00+00:00', engines: ['wikinews'] }))
    else if (category === 'map')
      results = many(3, (i) => ({ title: `${q} place ${i + 1}`, url: `https://openstreetmap.org/node/${100 + i}`, geojson: { type: 'Point', coordinates: [86.9 + i, 27.98 + i] }, address: { locality: 'Khumjung', country: 'Nepal' }, engines: ['openstreetmap'] }))
    else if (category === 'music')
      results = many(3, (i) => ({ title: `${q} song ${i + 1}`, url: `https://music.example.com/t/${i}`, author: 'An Artist', length: 200, thumbnail: `${origin}/img/${i * 30}`, audio_src: `${origin}/audio/${i}.mp3`, engines: ['bandcamp'] }))
    else if (category === 'science')
      results = many(3, (i) => ({ title: `${q}: a paper ${i + 1}`, url: `https://arxiv.example.org/abs/${i}`, content: 'An abstract about the thing.', author: 'A. Author', publisher: 'Journal of Things', publishedDate: '2025-01-1' + i, engines: ['arxiv'] }))
    else if (category === 'files')
      results = many(3, (i) => ({ title: `${q}-file-${i}.zip`, url: `https://files.example.com/${i}`, content: 'A file.', engines: ['piratebay'] }))
    else if (category === 'social media')
      results = many(3, (i) => ({ title: `${q} post ${i + 1}`, url: `https://social.example.com/p/${i}`, content: 'A post about it.', author: 'someone', engines: ['mastodon'] }))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ query: q, results, unresponsive_engines: category === 'files' ? [['some-engine', 'timeout']] : [] }))
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: (server.address() as { port: number }).port })))
}

class Cdp {
  private id = 0
  private pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>()
  private ws: WebSocket
  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id !== undefined) this.pending.get(msg.id)?.(msg)
    })
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url)
    await new Promise((ok, no) => (ws.addEventListener('open', ok), ws.addEventListener('error', no)))
    return new Cdp(ws)
  }
  send<T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.id
    return new Promise((ok, no) => {
      // A page in the middle of loading a real site may not answer for a long time; a call that gets no answer fails instead of hanging the test.
      const timer = setTimeout(() => no(new Error(`${method}: no answer`)), 20_000)
      this.pending.set(id, (m) => (clearTimeout(timer), m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok((m.result ?? {}) as T)))
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  close(): void {
    this.ws.close()
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('Orbis Search in the real browser: every vertical, the viewer, Orion sessions, box, bangs and looks', { skip: run ? false : 'no Chromium build with the Orbis extension built', timeout: 420_000 }, async (t) => {
  const dir = join(tmpdir(), `orbis-search-page-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })

  const service = await stand_in()
  process.env.ORBIS_SEARCH_ENDPOINT = `http://127.0.0.1:${service.port}`
  const extDir = join(dir, 'extension')
  cpSync(join(REPO, 'extension'), extDir, { recursive: true, filter: (s) => !/[\\/](helper\.json|_metadata)$/.test(s) })
  const token = newToken()
  const helper = createHelperServer({
    token,
    allowedOrigins: [`chrome-extension://${ORBIS_EXTENSION_ID}`],
    handlers: createHandlers({ apiKeys: keys, dataDir: join(dir, 'userdata'), profileId: 'test-profile' })
  })
  const { port } = await helper.listen()

  const debugPort = 9700 + Math.floor(Math.random() * 100)
  let chrome: ChildProcess | null = null
  let cdp: Cdp | null = null
  t.after(async () => {
    cdp?.close()
    chrome?.kill()
    await helper.close()
    service.server.close()
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // The browser may still be letting go of its files; the temp folder is cleaned by the OS later.
      }
    }, 4000).unref()
  })
  chrome = spawn(CHROME, [`--user-data-dir=${join(dir, 'profile')}`, `--orbis-extension-dir=${extDir}`, `--remote-debugging-port=${debugPort}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', '--window-size=1280,900'], { stdio: 'ignore' })
  let wsUrl = ''
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      wsUrl = ((await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl
    } catch {
      await wait(250)
    }
  }
  assert.ok(wsUrl, 'the browser started')
  cdp = await Cdp.connect(wsUrl)
  const c = cdp
  // The extension's pages get the helper's port and token from the worker's session storage (the app puts them there).
  {
    let worker: { targetId: string } | undefined
    for (let i = 0; i < 40 && !worker; i++) {
      worker = (await c.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${ORBIS_EXTENSION_ID}/`))
      if (!worker) await wait(250)
    }
    assert.ok(worker, 'the component extension runs in the browser')
    const attached = (await c.send<{ sessionId: string }>('Target.attachToTarget', { targetId: worker!.targetId, flatten: true })).sessionId
    await c.send('Runtime.enable', {}, attached)
    // A worker that has only just started has no `chrome` object yet.
    let stored = false
    for (let i = 0; i < 40 && !stored; i++) {
      const r = await c.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: `typeof chrome !== 'undefined' && !!chrome.storage ? chrome.storage.session.set({ 'orbis.helper': ${JSON.stringify({ port, token })} }).then(() => true) : false`, awaitPromise: true, returnByValue: true }, attached)
      stored = r.result?.value === true
      if (!stored) await wait(250)
    }
    assert.ok(stored, 'the helper connection was handed to the component')
  }

  const base = `chrome-extension://${ORBIS_EXTENSION_ID}/results.html`
  let session = ''
  const open = async (hash: string, opts: { width?: number; dark?: boolean; offline?: boolean } = {}): Promise<void> => {
    // A page that went to a real site (the bang test) can take long to answer a close; do not wait for it.
    if (session) await Promise.race([c.send('Target.closeTarget', { targetId: targetId }).catch(() => undefined), wait(3000)])
    const created = await c.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
    targetId = created.targetId
    session = (await c.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })).sessionId
    await c.send('Page.enable', {}, session)
    await c.send('Emulation.setDeviceMetricsOverride', { width: opts.width ?? 1200, height: opts.width && opts.width < 700 ? 800 : 900, deviceScaleFactor: 1, mobile: false }, session)
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.dark === false ? 'light' : 'dark' }] }, session)
    if (opts.offline) {
      await c.send('Network.enable', {}, session)
      await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, session)
    }
    await c.send('Page.navigate', { url: `${base}${hash}` }, session)
    await wait(400)
  }
  let targetId = ''
  const js = async <T = unknown>(expression: string): Promise<T> => {
    const r = await c.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result.value
  }
  const until = async (expression: string, ms = 30_000): Promise<void> => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await js<boolean>(`Boolean(${expression})`).catch(() => false)) return
      await wait(250)
    }
    throw new Error(`timed out waiting for: ${expression}\nPAGE: ${(await js<string>('document.body.innerText').catch(() => '')).slice(0, 600)}`)
  }
  const shot = async (name: string): Promise<void> => {
    if (!SHOTS) return
    const { data } = await c.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, session)
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
  }
  const text = (): Promise<string> => js<string>('document.body.innerText')

  await t.test('the page has no browser branding and shows the Orbis look', async () => {
    await open('#q=hello', { dark: true })
    await until("document.querySelector('.vertical')")
    const shown = await text()
    assert.ok(!/chrom(e|ium)/i.test(shown), shown)
    assert.deepEqual(await js('[...document.querySelectorAll(".vertical")].map(a => a.textContent)'), ['Orion', 'All', 'Images', 'Videos', 'News', 'Maps', 'Music', 'Science', 'Files', 'Social'])
    assert.equal(await js('document.title'), 'hello · Orbis Search')
  })

  await t.test('web search shows real results with the site, a favicon, and try Google instead', async () => {
    await open('#q=how%20do%20tides%20work', { dark: true })
    await until("document.querySelector('.results .title') || document.querySelector('.status.problem')", 45_000)
    if (await js('Boolean(document.querySelector(".status.problem"))')) return void t.diagnostic(`web search unavailable here: ${await text()}`)
    assert.ok((await js<number>('document.querySelectorAll(".results > li").length')) >= 3)
    assert.match(await js<string>('document.querySelector(".foot").innerText'), /results in .*s · searched by Orbis.*try Google instead/)
    assert.match(await js<string>('document.querySelector(".elsewhere").href'), /^https:\/\/www\.google\.com\/search\?q=how%20do%20tides%20work$/)
    assert.equal(await js<number>('document.querySelectorAll(".results a.result").length'), await js<number>('document.querySelectorAll(".results > li").length'))
    assert.match(await js<string>('document.querySelector(".ask-link")?.href ?? ""'), /in=orion/, 'a question offers Orion')
    await shot('web-dark-wide')
  })

  const specialized = async (name: string, selector: string, expected: RegExp): Promise<void> => {
    await open(`#q=everest&in=${name}`, { dark: true })
    await until(`document.querySelector('${selector}')`)
    const shown = await text()
    assert.match(shown, expected)
    assert.ok(!/chrom(e|ium)/i.test(shown))
    await shot(`${name}-dark-wide`)
  }
  await t.test('images: a grid of pictures with size and site, opened in a viewer that walks the set with the arrow keys and closes with Escape', async () => {
    await specialized('images', '.images img', /everest picture 1[\s\S]*example\.org · 1600×1200/)
    assert.equal(await js('document.querySelectorAll(".images li").length'), 9)
    await js('document.querySelector(".images .image").click()')
    await until("!document.getElementById('viewer').hidden && document.querySelector('.stage img')")
    await until("document.querySelector('.stage img') && document.querySelector('.stage img').naturalWidth > 0")
    assert.match(await js('location.hash'), /at=0/)
    assert.match(await js<string>('document.querySelector(".viewer-foot").innerText'), /1 of 9/)
    await shot('images-viewer-dark')
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session)
    await until("/2 of 9/.test(document.querySelector('.viewer-foot').innerText)")
    assert.match(await js('location.hash'), /at=1/)
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session)
    await until("document.getElementById('viewer').hidden")
    assert.doesNotMatch(await js('location.hash'), /at=/)
    assert.equal(await js('document.querySelectorAll(".images li").length'), 9, 'the results are as they were')
    // The address alone reopens the same picture.
    await open('#q=everest&in=images&at=3', { dark: true })
    await until("!document.getElementById('viewer').hidden")
    assert.match(await js<string>('document.querySelector(".viewer-foot").innerText'), /4 of 9/)
  })
  await t.test('videos: thumbnail with length, channel and views; a viewer that plays the source’s own player, or says where to watch', async () => {
    await specialized('videos', '.thumbbox', /everest film 1[\s\S]*Some Channel · 12K views/)
    assert.match(await js<string>('document.querySelector(".thumbbox em").textContent'), /^\d+:\d\d$/)
    await shot('videos-dark-wide')
    // The most watched come first: film 4 has no player, film 3 has one.
    await js('document.querySelectorAll(".results .result")[1].click()')
    await until("document.querySelector('.play')")
    await shot('videos-viewer-dark')
    await js('document.querySelector(".play").click()')
    await until("document.querySelector('.stage iframe')")
    assert.match(await js('document.querySelector(".stage iframe").src'), /\/embed\/2$/)
    await js('document.querySelectorAll(".rail button")[0].click()')
    await until("document.querySelector('.elsewhere-box')")
    assert.match(await text(), /does not offer a player Orbis can use[\s\S]*Watch on videos\.example\.net/)
  })
  await t.test('news, maps, music, science, files and social each draw what their results hold', async () => {
    await specialized('news', '.results .title', /everest in the news 1[\s\S]*2026-05-01/)
    await specialized('maps', '.results .title', /everest place 1[\s\S]*Khumjung, Nepal · 27\.9800, 86\.9000/)
    await specialized('music', '.results audio.preview', /everest song 1[\s\S]*An Artist/)
    await specialized('science', '.results .title', /everest: a paper 1[\s\S]*A\. Author · Journal of Things · 2025-01-10/)
    await specialized('files', '.results .title', /everest-file-0\.zip[\s\S]*One source could not be reached: some-engine\./)
    await specialized('social', '.results .title', /everest post 1[\s\S]*someone/)
    assert.equal(await js('document.querySelectorAll(".results a.result").length'), 3)
  })
  await t.test('the search box: recent searches, arrow keys, Escape, "/" and bangs', async () => {
    await open('#q=first%20thing', { dark: true })
    await until("document.querySelector('.vertical')")
    await js('localStorage.setItem("orbis.search.recent", JSON.stringify(["alpha cats", "alpha dogs", "beta"]))')
    await js('document.getElementById("q").focus(); document.getElementById("q").value = "alpha"; document.getElementById("q").dispatchEvent(new Event("input"))')
    await until("!document.getElementById('suggest').hidden")
    assert.deepEqual(await js('[...document.querySelectorAll("#suggest li span:nth-child(2)")].map(s => s.textContent)'), ['alpha cats', 'alpha dogs'])
    await shot('suggest-dark')
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }, session)
    assert.equal(await js('document.querySelector("#suggest li[aria-selected=true] span:nth-child(2)").textContent'), 'alpha cats')
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session)
    assert.equal(await js('document.getElementById("suggest").hidden'), true)
    await js('document.getElementById("q").blur()')
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/', windowsVirtualKeyCode: 191 }, session)
    assert.equal(await js('document.activeElement.id'), 'q')
    // A submitted search opens a new Orbis Search, in the vertical being looked at.
    await js('document.getElementById("q").value = "second thing"; document.getElementById("search").requestSubmit()')
    await until("location.hash.includes('second%20thing') || location.hash.includes('second+thing')")
    assert.match(await js<string>('localStorage.getItem("orbis.search.recent")'), /second thing/)
    // The reserved characters of a query survive the trip through the address.
    await open(`#q=${encodeURIComponent('a&b=c #1 <script>x</script>')}`, { dark: true })
    await until("document.querySelector('.status, .results')")
    assert.equal(await js('document.getElementById("q").value'), 'a&b=c #1 <script>x</script>')
    assert.equal(await js('document.querySelectorAll("script:not([src])").length'), 0, 'nothing from a query is ever put in as markup')
  })

  await t.test('the browser’s default search engine (what the address bar uses) lands on this same page', async () => {
    await open('#q=hello', { dark: true })
    await js('chrome.search.query({ text: "how do magnets work", disposition: "NEW_TAB" })')
    let found: { url: string; title: string } | undefined
    for (let i = 0; i < 40 && !found; i++) {
      const targets = ((await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as { url: string; title: string }[])
      found = targets.find((x) => x.url.startsWith(base) && /how(%20|\+)do(%20|\+)magnets(%20|\+)work/.test(x.url) && /magnets work . Orbis Search/.test(x.title))
      if (!found) await wait(250)
    }
    assert.ok(found, 'a search made with the default engine opens Orbis Search')
    assert.match(found.title, /how do magnets work . Orbis Search/)
  })

  await t.test('a bang goes to the site asked for, on purpose', async () => {
    await open('#q=%21g%20cats')
    await until("location.hostname !== '' && !location.href.startsWith('chrome-extension')", 20_000).catch(() => undefined)
    const now = await js<string>('location.href').catch(() => '')
    assert.ok(/google\.com\/search\?q=cats|chrome-error/.test(now) || now.startsWith('https://'), now)
  })

  await t.test('narrow and light: the layout fits a phone and follows the light theme', async () => {
    await open('#q=everest&in=images', { width: 390, dark: false })
    await until("document.querySelector('.images img')")
    assert.ok((await js<number>('document.documentElement.scrollWidth')) <= 392, 'no sideways scrolling')
    assert.equal(await js('getComputedStyle(document.body).backgroundColor'), 'rgb(245, 247, 251)')
    await shot('images-light-narrow')
    await open('#q=everest&in=videos', { width: 390, dark: false })
    await until("document.querySelector('.thumbbox')")
    assert.ok((await js<number>('document.documentElement.scrollWidth')) <= 392)
    await shot('videos-light-narrow')
    await open('#q=everest&in=news', { dark: false })
    await until("document.querySelector('.results .title')")
    await shot('news-light-wide')
  })

  await t.test('Orion: a real answer with numbered sources, saved as a session that can be listed, reopened, continued and deleted', { skip: keys.length ? false : 'no Groq key in this checkout' }, async () => {
    await open('#q=why%20is%20the%20sky%20blue&in=orion', { dark: true })
    await until("document.querySelector('.thread .answer')", 60_000)
    await until("document.querySelector('.sources li') && !document.querySelector('.caret')", 90_000)
    await shot('orion-dark-wide')
    const shown = await text()
    assert.ok(!/chrom(e|ium)/i.test(shown))
    assert.ok((await js<number>('document.querySelectorAll(".sources li").length')) >= 2, 'real sources are listed')
    // The model sometimes answers without citing; then the page must say so rather than pretend.
    const cites = await js<number>('document.querySelectorAll(".answer .cite").length')
    if (cites) assert.match(await js<string>('document.querySelector(".answer .cite").href'), /^https?:\/\//)
    else assert.match(await text(), /does not cite any of the sources found/)
    await shot('orion-dark-wide')
    // It was saved into the same store the Orbis window uses, and the address remembers which session this is.
    await until("location.hash.includes('s=')")
    const sessionId = new URLSearchParams(await js<string>('location.hash.slice(1)')).get('s')!
    // A follow-up continues the same session and its numbering.
    await js('(() => { const t = document.querySelector(".follow textarea"); t.value = "explain it to a child"; t.dispatchEvent(new Event("input")); t.form.requestSubmit() })()')
    await until("document.querySelectorAll('.thread > li').length === 2 && !document.querySelector('.caret')", 90_000)
    await shot('orion-followup-dark')
    // Earlier research: listed, reopened from a fresh page, and deleted.
    // The address carries the session it is about, so the page opens it without asking Orion anything new.
    await open(`#q=why%20is%20the%20sky%20blue&in=orion&s=${sessionId}`, { dark: true })
    await until("document.querySelectorAll('.thread > li').length === 2")
    await js('(() => { const b = [...document.querySelectorAll(".chip")].find(x => x.textContent === "Earlier research"); b.click() })()')
    await until("document.querySelector('.earlier .open')")
    assert.match(await js<string>('document.querySelector(".earlier").innerText'), /why is the sky blue[\s\S]*2 questions/)
    await shot('orion-earlier-dark')
    await js('[...document.querySelectorAll(".earlier .open")].find((b) => /sky blue/.test(b.textContent)).click()')
    await until("document.querySelectorAll('.thread > li').length === 2")
    assert.ok((await js<number>('document.querySelectorAll(".sources li").length')) >= 2)
    await js('(() => { [...document.querySelectorAll(".chip")].find(x => x.textContent === "Earlier research").click() })()')
    await until("document.querySelector('.earlier .del')")
    await js('document.querySelector(".earlier .del").click()')
    await until("/Nothing saved yet/.test(document.querySelector('.earlier').innerText)")
  })

  await t.test('offline: the page says so and offers to try again', async () => {
    await open('#q=hello&in=news', { dark: true, offline: true })
    await until("document.querySelector('.status.problem')")
    assert.match(await text(), /You are offline[\s\S]*Try again/)
    await shot('offline-dark')
  })

  await t.test('a category whose service is down says so plainly and offers to try again', async () => {
    const before = process.env.ORBIS_SEARCH_ENDPOINT
    service.server.close()
    await service.server.closeAllConnections?.()
    await open('#q=everest&in=news', { dark: true })
    await until("document.querySelector('.status.problem')")
    assert.match(await text(), /Try again/)
    await shot('unavailable-dark')
    process.env.ORBIS_SEARCH_ENDPOINT = before
  })

  await t.test('the helper being absent is explained, not a blank page', async () => {
    await helper.close()
    await open('#q=everest&in=maps', { dark: true })
    await until("document.querySelector('.status.problem')")
    assert.match(await text(), /Orbis Search runs on this computer/)
    await shot('helper-down-dark')
  })
})
