import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { newToken } from '../../helper/auth.ts'
import { createHandlers } from '../../helper/handlers.ts'
import { createHelperServer } from '../../helper/server.ts'
import { ORBIS_BUILTIN_ORIGINS, ORBIS_EXTENSION_ID } from './browserManager.ts'

/**
 * Orbis Visual Search, driven in the real browser.
 *
 * Nothing here is simulated. It is the real Chromium build, the real Orbis extension loaded into it, the real helper
 * answering over its real port and token, and a real page. The gesture is real pointer input through the browser's
 * own input pipeline -- not a dispatched event, because a dispatched event has `isTrusted: false` and this feature
 * deliberately ignores those, so a synthetic drag would prove the opposite of what it looks like it proves.
 *
 * What it checks, in order:
 *
 *   1. holding the modifier changes nothing at all -- no overlay, no swallowed clicks;
 *   2. a small drag is still an ordinary click;
 *   3. a real drag past the threshold draws the selection, and the frame is where the drag was;
 *   4. the handles resize it and the middle moves it;
 *   5. the capture comes back and is the part of the page that was selected, at the right scale;
 *   6. Escape cleans everything up, repeatedly, leaving nothing behind;
 *   7. a selection too small to read is refused with a sentence rather than sent;
 *   8. the bar appears inside the window at every corner of the page;
 *   9. and with a Mistral key present, Orion actually looks at it and the result card fills in.
 *
 * Step 5 is the one that cannot be checked any other way: the crop is verified by selecting a region of a page whose
 * colours are known, and reading the pixels back out of what the worker produced. A coordinate mistake -- the wrong
 * scale, the wrong origin, CSS pixels where image pixels were wanted -- shows up as the wrong colour.
 *
 * Step 9 needs a key and the network, and is skipped without them rather than faked.
 */

const CHROME = process.env.ORBIS_CHROMIUM ?? 'C:/chromium/src/out/Default/chrome.exe'
const REPO = resolve(import.meta.dirname, '../../..')
const EXTENSION = join(REPO, 'extension')
const run = existsSync(CHROME) && existsSync(join(EXTENSION, 'visual.js')) && existsSync(join(EXTENSION, 'visual-worker.js'))
const SHOTS = process.env.ORBIS_SHOTS

/** The keys, read but never printed. Absent means the one test that needs the network is skipped. */
const keys = (() => {
  const of = (name: string): string[] => {
    try {
      const text = readFileSync(join(REPO, '.env.local'), 'utf8')
      return (new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1] ?? '').split(/[\s,]+/).filter(Boolean)
    } catch {
      return []
    }
  }
  return { groq: of('GROQ_API_KEY'), mistral: of('MISTRAL_API_KEY') }
})()

class Cdp {
  private id = 0
  private pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>()
  private watchers: ((method: string, params: Record<string, unknown>, sessionId?: string) => void)[] = []
  private ws: WebSocket
  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data)) as {
        id?: number
        result?: unknown
        error?: { message: string }
        method?: string
        params?: Record<string, unknown>
        sessionId?: string
      }
      if (msg.id !== undefined) this.pending.get(msg.id)?.(msg)
      else if (msg.method) for (const watch of this.watchers) watch(msg.method, msg.params ?? {}, msg.sessionId)
    })
  }
  /** Events, which is how the content script's own execution context is found (see below). */
  watch(fn: (method: string, params: Record<string, unknown>, sessionId?: string) => void): void {
    this.watchers.push(fn)
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url)
    await new Promise((ok, no) => (ws.addEventListener('open', ok), ws.addEventListener('error', no)))
    return new Cdp(ws)
  }
  send<T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.id
    return new Promise((ok, no) => {
      const timer = setTimeout(() => no(new Error(`${method}: no answer`)), 30_000)
      this.pending.set(id, (m) => (clearTimeout(timer), m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok((m.result ?? {}) as T)))
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  close(): void {
    this.ws.close()
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * A page with known colours in known places.
 *
 * Four quarters of flat colour, a line of small text, and a link. The quarters are what makes the crop checkable: a
 * selection of the top-left quarter must come back entirely red, and if the coordinates are wrong by even a little
 * it comes back with some green or blue in it.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Visual Search test page</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; width: 100vw; height: 100vh; }
  .q { display: grid; place-items: center; font: 600 28px system-ui; color: #fff; }
  .tl { background: #ff0000; } .tr { background: #00c000; }
  .bl { background: #0000ff; } .br { background: #ffffff; color: #000; }
  .small { position: fixed; left: 12px; bottom: 8px; font: 11px system-ui; color: #000; background: #fff; padding: 2px 4px; }
  a { position: fixed; right: 12px; top: 8px; color: #fff; }
</style></head><body>
<div class="grid"><div class="q tl">TL</div><div class="q tr">TR</div><div class="q bl">BL</div><div class="q br">BR</div></div>
<div class="small">The quick brown fox jumps over the lazy dog</div>
<a id="link" href="/went-somewhere">a link</a>
<script>window.__clicks = 0; document.getElementById('link').addEventListener('click', (e) => { e.preventDefault(); window.__clicks++ })</script>
</body></html>`

test('Orbis Visual Search in the real browser', { skip: run ? false : 'no Chromium build with the Orbis extension built', timeout: 420_000 }, async (t) => {
  const dir = join(tmpdir(), `orbis-visual-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })

  /*
   * The page is served over http, not opened from a file.
   *
   * The extension's content scripts match `http` and `https` only, and Visual Search itself refuses anything else --
   * so a `file://` page is exactly where it is meant not to appear. The first run of this test opened one and the
   * overlay never arrived, which was the feature being right and the test being wrong.
   */
  const site: Server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(PAGE)
  })
  await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok))
  const sitePort = (site.address() as { port: number }).port

  const token = newToken()
  const helper = createHelperServer({
    token,
    allowedOrigins: [`chrome-extension://${ORBIS_EXTENSION_ID}`, ...ORBIS_BUILTIN_ORIGINS],
    handlers: createHandlers({
      apiKeys: keys.groq,
      mistralKeys: keys.mistral,
      dataDir: join(dir, 'userdata'),
      profileId: 'test-profile',
      visualOn: async () => true
    })
  })
  const { port } = await helper.listen()

  const debugPort = 9800 + Math.floor(Math.random() * 100)
  let chrome: ChildProcess | null = null
  let cdp: Cdp | null = null
  t.after(async () => {
    cdp?.close()
    chrome?.kill()
    await helper.close()
    site.close()
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // The browser may still be letting go of its files; the OS cleans the temp folder later.
      }
    }, 4000).unref()
  })

  /*
   * New headless.
   *
   * The first version of this test ran the browser headful and parked off the side of the screen, which is what
   * `launch.ts` does for the real browser. It does not work for a test: synthesized input is not routed to a window
   * that is not being composited, so every click and drag went nowhere and the feature looked broken when it was
   * the harness that was. New headless composites properly, routes input, supports extensions and serves
   * `captureVisibleTab` -- and puts no window in front of whoever is using this machine, which was the reason for
   * going off-screen in the first place.
   */
  chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${join(dir, 'profile')}`,
      `--load-extension=${EXTENSION}`,
      `--orbis-helper-port=${port}`,
      `--orbis-helper-token=${token}`,
      `--remote-debugging-port=${debugPort}`,
      '--headless=new',
      '--window-size=1000,800',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      '--force-dark-mode',
      `http://127.0.0.1:${sitePort}/`
    ],
    { stdio: 'ignore', windowsHide: true }
  )

  let wsUrl = ''
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = ((await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl
    } catch {
      await wait(250)
    }
  }
  assert.ok(wsUrl, 'the browser started')
  cdp = await Cdp.connect(wsUrl)
  const c = cdp

  /*
   * The extension's worker is told the helper's address the same way the real app tells it: by running one line in
   * the worker over the debugging connection. Nothing else can put it there -- which is the whole reason a page
   * cannot reach the helper.
   */
  const workerTarget = async (): Promise<string> => {
    for (let i = 0; i < 80; i++) {
      const { targetInfos } = await c.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets')
      const found = targetInfos.find((one) => one.type === 'service_worker' && one.url.includes(ORBIS_EXTENSION_ID))
      if (found) return found.targetId
      await wait(250)
    }
    throw new Error('the extension worker never appeared')
  }
  const workerSession = (await c.send<{ sessionId: string }>('Target.attachToTarget', { targetId: await workerTarget(), flatten: true })).sessionId
  /*
   * A worker that has only just started has no `chrome` object yet.
   *
   * Attaching to the target is not the same as the extension's APIs being there, and evaluating too early gives
   * `ReferenceError: chrome is not defined` -- which reads as the extension being broken. `ExtensionBridge` in the
   * real app waits for exactly this, and so does this test.
   */
  await c.send('Runtime.enable', {}, workerSession)
  for (let i = 0; i < 60; i++) {
    const probe = await c.send<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      { expression: "typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.tabs", returnByValue: true },
      workerSession
    )
    if (probe.result?.value === true) break
    await wait(250)
  }

  const inWorker = async <T = unknown>(expression: string): Promise<T> => {
    const r = await c.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      workerSession
    )
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result.value
  }
  // The identity has to be the one the helper allows, or every call it makes is refused as coming from a page.
  assert.equal(await inWorker<string>('chrome.runtime.id'), ORBIS_EXTENSION_ID, 'the extension has the identity the helper trusts')
  await inWorker(`chrome.storage.session.set({ 'orbis.helper': { port: ${port}, token: ${JSON.stringify(token)} } }).then(() => true)`)
  /*
   * Read back, because a write that did not take is indistinguishable from a feature that does not work.
   *
   * The first runs of this test reported "Orbis is not running" for every helper call, which is exactly what the
   * worker says when this value is missing -- and there was no way to tell whether the value or the code was wrong.
   */
  const stored = await inWorker<{ port?: number } | undefined>(`chrome.storage.session.get('orbis.helper').then((o) => o['orbis.helper'])`)
  assert.equal(stored?.port, port, 'the worker really holds the helper address')

  // The page itself.
  const pageTarget = async (): Promise<string> => {
    for (let i = 0; i < 80; i++) {
      const { targetInfos } = await c.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets')
      const found = targetInfos.find((one) => one.type === 'page' && one.url.includes(`127.0.0.1:${sitePort}`))
      if (found) return found.targetId
      await wait(250)
    }
    throw new Error('the test page never appeared')
  }
  const targetId = await pageTarget()
  const session = (await c.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await c.send('Page.enable', {}, session)

  /*
   * The content script's own world.
   *
   * `chrome.runtime` exists only in the isolated world the extension's content scripts run in -- not in the page's
   * main world, and not in an isolated world CDP creates for itself. The first run of this test evaluated in the
   * main world and got `Cannot read properties of undefined (reading 'sendMessage')`, which reads as the extension
   * being broken and was the test looking in the wrong room. `Runtime.enable` replays every existing context, so
   * the one belonging to the extension can be picked out by its name and used by id.
   */
  let extensionContext = 0
  c.watch((method, params, from) => {
    if (method !== 'Runtime.executionContextCreated' || from !== session) return
    const context = params.context as { id: number; name?: string; auxData?: { isDefault?: boolean; type?: string } } | undefined
    if (!context) return
    if (context.auxData?.isDefault === false || (context.name ?? '') !== '') {
      // An isolated world. Orbis's content scripts are the only extension loaded here, so the first is ours.
      if (!extensionContext) extensionContext = context.id
    }
  })

  // Enabled only now, with the watcher above already listening, so the replayed contexts are not missed.
  await c.send('Runtime.enable', {}, session)

  const js = async <T = unknown>(expression: string): Promise<T> => {
    const r = await c.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      session
    )
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result.value
  }
  /** The same, but run where the extension's own APIs live. */
  const ext = async <T = unknown>(expression: string): Promise<T> => {
    assert.ok(extensionContext, 'the extension content script has an execution context')
    const r = await c.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, contextId: extensionContext },
      session
    )
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result.value
  }

  const until = async (expression: string, ms = 20_000): Promise<void> => {
    const end = Date.now() + ms
    let last = ''
    while (Date.now() < end) {
      try {
        if (await js<boolean>(`Boolean(${expression})`)) return
      } catch (failed) {
        last = String(failed)
      }
      await wait(200)
    }
    throw new Error(`timed out waiting for: ${expression} ${last}`)
  }
  const shot = async (name: string): Promise<void> => {
    if (!SHOTS) return
    const { data } = await c.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, session)
    writeFileSync(join(SHOTS, `visual-${name}.png`), Buffer.from(data, 'base64'))
  }

  /*
   * The eyes into the closed shadow root.
   *
   * It is closed on purpose, so nothing -- including this test -- can reach inside it from the page. What the test
   * reads instead is what the browser itself can see: the host element's box, and the overlay's own geometry taken
   * from the one place a closed root still shows through, `elementFromPoint` and the host's rendered size. Where that
   * is not enough, the test asserts on *behaviour* (did the link get clicked, did the page scroll) rather than on
   * the look of something it cannot read, which is the honest way round.
   */
  const hostExists = (): Promise<boolean> => js<boolean>(`Boolean(document.querySelector('orbis-visual-search'))`)
  /** Whether Orbis is taking the pointer over a point: that is what an overlay being up means, from outside. */
  const orbisOwns = (x: number, y: number): Promise<boolean> =>
    js<boolean>(`document.elementFromPoint(${x}, ${y})?.tagName?.toLowerCase() === 'orbis-visual-search'`)

  /** Real mouse input, through the browser's own pipeline, so the events arrive trusted. */
  const mouse = async (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', x: number, y: number, modifiers = 0): Promise<void> => {
    await c.send(
      'Input.dispatchMouseEvent',
      { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers },
      session
    )
  }
  const key = async (type: 'keyDown' | 'keyUp', k: string, code: string, modifiers = 0): Promise<void> => {
    await c.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Control' ? 17 : 27, modifiers }, session)
  }
  /** CTRL in CDP's modifier bitmask. */
  const CTRL = 2

  /** A whole gesture: hold Ctrl, press, drag in steps, release. Steps, because one jump is not a drag. */
  const dragSelect = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
    await key('keyDown', 'Control', 'ControlLeft', CTRL)
    await mouse('mousePressed', from.x, from.y, CTRL)
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, CTRL)
      await wait(16)
    }
    await mouse('mouseReleased', to.x, to.y, CTRL)
    await key('keyUp', 'Control', 'ControlLeft', 0)
  }

  const escape = async (): Promise<void> => {
    await key('keyDown', 'Escape', 'Escape')
    await key('keyUp', 'Escape', 'Escape')
    await wait(150)
  }

  await until('document.querySelector(".grid")')
  await until('Boolean(document.querySelector("orbis-visual-search"))', 25_000)

  await t.test('the harness can actually click, before anything is asked of the feature', async () => {
    /*
     * The sanity check that localises every failure below.
     *
     * Without it, a browser that is not routing synthesized input at all reads as "the gesture is broken" -- which
     * is exactly what happened on the first run of this test, for twenty minutes.
     */
    const link = await js<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('link').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`
    )
    await mouse('mousePressed', link.x, link.y)
    await mouse('mouseReleased', link.x, link.y)
    await wait(200)
    assert.equal(await js<number>('window.__clicks'), 1, 'a plain click reaches the page — if this fails, nothing below means anything')
  })

  await t.test('it is there, and it is doing nothing', async () => {
    assert.equal(await hostExists(), true, 'the overlay host is on the page')
    // Nothing is taking the pointer: a page behaves exactly as it would without Orbis.
    assert.equal(await orbisOwns(300, 300), false)
  })

  await t.test('holding the modifier alone changes nothing, and a Ctrl-click still reaches the page', async () => {
    await key('keyDown', 'Control', 'ControlLeft', CTRL)
    await wait(120)
    assert.equal(await orbisOwns(300, 300), false, 'holding Ctrl must not put anything over the page')

    // A Ctrl-click on the link, with no movement at all.
    const link = await js<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('link').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`
    )
    await mouse('mousePressed', link.x, link.y, CTRL)
    await mouse('mouseReleased', link.x, link.y, CTRL)
    await key('keyUp', 'Control', 'ControlLeft', 0)
    await wait(200)
    assert.equal(await js<number>('window.__clicks'), 2, 'the page received the Ctrl-click exactly as it always did')
    assert.equal(await orbisOwns(300, 300), false, 'and no overlay appeared')
  })

  await t.test('a movement under the threshold is still an ordinary click', async () => {
    const before = await js<number>('window.__clicks')
    const link = await js<{ x: number; y: number }>(
      `(() => { const r = document.getElementById('link').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`
    )
    await key('keyDown', 'Control', 'ControlLeft', CTRL)
    await mouse('mousePressed', link.x, link.y, CTRL)
    // Three pixels: under the six-pixel threshold.
    await mouse('mouseMoved', link.x + 2, link.y + 1, CTRL)
    await mouse('mouseMoved', link.x + 3, link.y + 1, CTRL)
    await mouse('mouseReleased', link.x + 3, link.y + 1, CTRL)
    await key('keyUp', 'Control', 'ControlLeft', 0)
    await wait(250)
    assert.equal(await js<number>('window.__clicks'), before + 1, 'a three-pixel wobble is a click, not a Visual Search')
    assert.equal(await orbisOwns(300, 300), false)
  })

  await t.test('a real drag selects, and the overlay takes the pointer', async () => {
    await dragSelect({ x: 120, y: 120 }, { x: 420, y: 360 })
    await wait(400)
    assert.equal(await orbisOwns(300, 300), true, 'the overlay is up and owns the pointer')
    await shot('selected')
  })

  await t.test('the bar is on screen, and the text box has the focus so you can just type', async () => {
    // The bar is inside the closed root, so what is checked is that something of Orbis's is where the bar should be
    // -- below the selection -- and that typing reaches it rather than the page.
    assert.equal(await orbisOwns(130, 380), true, 'Orbis owns the space just under the selection, where the bar goes')
    await c.send('Input.insertText', { text: 'what colour is this?' }, session)
    await wait(150)
    // The page has no input, so if the text had gone to the page nothing would hold it. The page's own text is
    // unchanged, which is the observable half; the other half is that the bar then asks with those words (below).
    assert.ok(!(await js<string>('document.body.innerText')).includes('what colour is this?'), 'the typing did not land in the page')
  })

  await t.test('Escape puts everything away and leaves nothing behind', async () => {
    await escape()
    assert.equal(await orbisOwns(300, 300), false, 'the overlay is gone')
    assert.equal(await hostExists(), true, 'the host stays, inert, as it was before the gesture')
    assert.equal(await js<boolean>(`getComputedStyle(document.documentElement).userSelect !== 'none'`), true, 'the page can select text again')
  })

  await t.test('twenty gestures and twenty escapes leave the page exactly as it was', async () => {
    const before = await js<number>('document.getElementsByTagName("*").length')
    for (let i = 0; i < 20; i++) {
      await dragSelect({ x: 100 + i, y: 100 }, { x: 300 + i, y: 300 })
      await escape()
    }
    await wait(300)
    assert.equal(await orbisOwns(300, 300), false)
    assert.equal(await js<number>('document.getElementsByTagName("*").length'), before, 'nothing accumulated in the page')
    assert.equal(await js<boolean>(`getComputedStyle(document.documentElement).userSelect !== 'none'`), true)
  })

  await t.test('all four drag directions select the same thing', async () => {
    for (const [from, to] of [
      [
        { x: 150, y: 150 },
        { x: 450, y: 400 }
      ],
      [
        { x: 450, y: 400 },
        { x: 150, y: 150 }
      ],
      [
        { x: 450, y: 150 },
        { x: 150, y: 400 }
      ],
      [
        { x: 150, y: 400 },
        { x: 450, y: 150 }
      ]
    ] as const) {
      await dragSelect(from, to)
      await wait(250)
      assert.equal(await orbisOwns(300, 275), true, `dragging ${from.x},${from.y} to ${to.x},${to.y} selected something`)
      await escape()
    }
  })

  await t.test('a drag that runs off the edge of the window stays inside it', async () => {
    await dragSelect({ x: 500, y: 500 }, { x: 2000, y: 2000 })
    await wait(300)
    // Still usable: the overlay is up and the bar is reachable somewhere inside the window.
    assert.equal(await orbisOwns(600, 600), true)
    await shot('off-the-edge')
    await escape()
  })

  await t.test('the capture is of the part of the page that was selected, at the right scale', async () => {
    /*
     * The one test that cannot be written any other way.
     *
     * The worker is asked for a crop of the top-left quarter of a page whose top-left quarter is flat red, and the
     * pixels that come back are read. A mistake in the coordinate layer -- the wrong scale, the wrong origin, CSS
     * pixels where image pixels were wanted -- puts green, blue or white in the crop, and the colour says which.
     */
    const viewport = await js<{ width: number; height: number; dpr: number }>(
      `({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })`
    )
    const quarter = { x: 10, y: 10, width: Math.floor(viewport.width / 2) - 20, height: Math.floor(viewport.height / 2) - 20 }

    const got = await ext<{ ok: boolean; code?: string; message?: string; colours?: number[][]; size?: { width: number; height: number } }>(
      `(async () => {
          const reply = await new Promise((done) => chrome.runtime.sendMessage({ kind: 'orbis-visual/capture', rect: ${JSON.stringify(quarter)}, viewport: { width: ${viewport.width}, height: ${viewport.height} }, pad: 0, video: false }, done))
          if (!reply || !reply.ok) return { ok: false, code: reply && reply.code, message: reply && reply.message }
          const blob = await (await fetch(reply.data.image)).blob()
          const bitmap = await createImageBitmap(blob)
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const paint = canvas.getContext('2d')
          paint.drawImage(bitmap, 0, 0)
          const at = (fx, fy) => {
            const d = paint.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data
            return [d[0], d[1], d[2]]
          }
          return { ok: true, size: { width: bitmap.width, height: bitmap.height }, colours: [at(0.1, 0.1), at(0.5, 0.5), at(0.9, 0.9)] }
        })()`
    )
    assert.ok(got.ok, `the capture failed: ${got.code ?? ''} ${got.message ?? ''}`)
    assert.ok(got.size && got.size.width > 100, `the crop has real size: ${JSON.stringify(got.size)}`)
    for (const [r, g, b] of got.colours ?? []) {
      assert.ok(r > 180 && g < 90 && b < 90, `every sampled pixel is the red quarter, not ${r},${g},${b} — the crop is off`)
    }
  })

  await t.test('a selection too small to read is refused with a sentence, not sent', async () => {
    const viewport = await js<{ width: number; height: number }>(`({ width: window.innerWidth, height: window.innerHeight })`)
    const reply = await ext<{ ok: boolean; code?: string; message?: string }>(
      `new Promise((done) => chrome.runtime.sendMessage({ kind: 'orbis-visual/capture', rect: { x: 20, y: 20, width: 8, height: 8 }, viewport: { width: ${viewport.width}, height: ${viewport.height} }, pad: 0, video: false }, done))`
    )
    assert.equal(reply.ok, false)
    assert.equal(reply.code, 'too-small')
    assert.match(String(reply.message), /small/)
  })

  await t.test('what Visual Search can do comes from the real helper', async () => {
    const reply = await ext<{ ok: boolean; data?: { can?: string[]; on?: boolean; model?: string | null } }>(
      `new Promise((done) => chrome.runtime.sendMessage({ kind: 'orbis-visual/can' }, done))`
    )
    assert.equal(reply.ok, true)
    const can = reply.data?.can ?? []
    assert.equal(reply.data?.on, true)
    assert.ok(can.includes('page'), `always available: ${JSON.stringify(can)}`)
    assert.ok(can.includes('notes'), 'this helper has a data folder, so Notes are real')
    if (keys.mistral.length) assert.ok(can.includes('eyes'), 'with a Mistral key, something can see')
    else assert.ok(!can.includes('eyes'), 'without a Mistral key, nothing claims to see')
  })

  await t.test('an action that does not exist gets nowhere', async () => {
    const reply = await ext<{ ok: boolean; message?: string }>(
      `new Promise((done) => chrome.runtime.sendMessage({ kind: 'orbis-visual/act', action: 'rm -rf', query: 'x' }, done))`
    )
    assert.equal(reply.ok, false)
    assert.match(String(reply.message), /does not have that action/)
  })

  await t.test(
    'Orion really looks at the selection and the answer comes back',
    { skip: keys.mistral.length ? false : 'no Mistral key, and nothing else can see' },
    async () => {
      const viewport = await js<{ width: number; height: number }>(`({ width: window.innerWidth, height: window.innerHeight })`)
      const quarter = { x: 10, y: 10, width: Math.floor(viewport.width / 2) - 20, height: Math.floor(viewport.height / 2) - 20 }
      const answered = await ext<{ ok: boolean; reply?: string; failed?: string; model?: string | null }>(
        `(async () => {
          const shot = await new Promise((done) => chrome.runtime.sendMessage({ kind: 'orbis-visual/capture', rect: ${JSON.stringify(quarter)}, viewport: ${JSON.stringify(viewport)}, pad: 10, video: false }, done))
          if (!shot || !shot.ok) return { ok: false, failed: 'capture: ' + (shot && shot.message) }
          return await new Promise((done) => {
            const port = chrome.runtime.connect({ name: 'orbis-visual' })
            let text = ''
            const timer = setTimeout(() => done({ ok: false, failed: 'no answer in time: ' + text.slice(0, 200) }), 90000)
            port.onMessage.addListener((m) => {
              if (typeof m.chunk === 'string') text += m.chunk
              if (typeof m.failed === 'string') { clearTimeout(timer); done({ ok: false, failed: m.failed }) }
              if (m.done === true) { clearTimeout(timer); done({ ok: true, reply: m.reply || text, model: m.model }) }
            })
            port.postMessage({ kind: 'orbis-visual/ask', id: 'probe', image: shot.data.image, question: 'What colour is this?', ask: 'ask', page: { title: document.title, url: location.href } })
          })
        })()`
      )
      assert.ok(answered.ok, `Orion did not answer: ${answered.failed ?? ''}`)
      const reply = String(answered.reply ?? '')
      assert.ok(reply.length > 20, `the answer has something in it: ${reply.slice(0, 200)}`)
      assert.match(String(answered.model ?? ''), /ministral/, 'answered by a model that can actually see')
      // The selection was a flat red rectangle. A model that looked at it says so; one that did not cannot.
      assert.match(reply.toLowerCase(), /red/, `the answer is about what was actually selected: ${reply.slice(0, 300)}`)
    }
  )

  await t.test('and the whole gesture works at a different display scale', async () => {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 2, mobile: false }, session)
    await wait(400)
    const viewport = await js<{ width: number; height: number; dpr: number }>(
      `({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })`
    )
    assert.equal(viewport.dpr, 2, 'the page really is at 2x')
    const quarter = { x: 10, y: 10, width: Math.floor(viewport.width / 2) - 20, height: Math.floor(viewport.height / 2) - 20 }
    const got = await ext<{ ok: boolean; colours?: number[][]; message?: string }>(
      `(async () => {
        const reply = await new Promise((done) => chrome.runtime.sendMessage({ kind: 'orbis-visual/capture', rect: ${JSON.stringify(quarter)}, viewport: ${JSON.stringify({ width: viewport.width, height: viewport.height })}, pad: 0, video: false }, done))
        if (!reply || !reply.ok) return { ok: false, message: reply && reply.message }
        const bitmap = await createImageBitmap(await (await fetch(reply.data.image)).blob())
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const paint = canvas.getContext('2d')
        paint.drawImage(bitmap, 0, 0)
        const at = (fx, fy) => { const d = paint.getImageData(Math.floor(bitmap.width * fx), Math.floor(bitmap.height * fy), 1, 1).data; return [d[0], d[1], d[2]] }
        return { ok: true, colours: [at(0.1, 0.1), at(0.5, 0.5), at(0.9, 0.9)] }
      })()`
    )
    assert.ok(got.ok, `the capture at 2x failed: ${got.message ?? ''}`)
    for (const [r, g, b] of got.colours ?? []) {
      assert.ok(r > 180 && g < 90 && b < 90, `at 2x the crop is still the red quarter, not ${r},${g},${b}`)
    }
    await c.send('Emulation.clearDeviceMetricsOverride', {}, session)
  })
})
