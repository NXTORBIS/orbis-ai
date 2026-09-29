import type { ParamSpec } from '../../shared/browserControl.ts'
import { fail } from '../browserControl/registry.ts'
import type { ChromiumCapabilityDeps } from './chromiumCapabilities.ts'
import type { CdpPage } from './cdpPage.ts'
import { BrowserUi, BrowserUiError, type UiWindow } from './browserUi.ts'

/**
 * The browser's own interface: its address bar and developer-tools window. CDP cannot operate those, so these capabilities send real
 * operating-system key presses to the window of the browser process Orbis launched (see browserUi.ts) and then check, in the browser
 * or through UI Automation, that it really happened. If Windows will not bring the window to the front, they fail saying so.
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface BrowserUiDeps extends ChromiumCapabilityDeps {
  activePage(): Promise<CdpPage>
  /** The browser process id Orbis launched. Only this process's windows are ever touched. */
  pid?: number
  /** A test may pass its own. */
  ui?: BrowserUi
}

export const SHORTCUTS: Record<string, { keys: string; description: string }> = {
  'new-tab': { keys: 'ctrl+t', description: 'Open a new tab' },
  'new-window': { keys: 'ctrl+n', description: 'Open a new window' },
  'reload': { keys: 'ctrl+r', description: 'Reload the tab' },
  'hard-reload': { keys: 'ctrl+shift+r', description: 'Reload ignoring the cache' },
  'find': { keys: 'ctrl+f', description: 'Open find in page' },
  'bookmarks-bar': { keys: 'ctrl+shift+b', description: 'Show or hide the bookmarks bar' },
  'bookmark-page': { keys: 'ctrl+d', description: 'Bookmark this page' },
  'history': { keys: 'ctrl+h', description: 'Open History' },
  'downloads': { keys: 'ctrl+j', description: 'Open Downloads' },
  'zoom-in': { keys: 'ctrl+plus', description: 'Zoom in' },
  'zoom-out': { keys: 'ctrl+minus', description: 'Zoom out' },
  'zoom-reset': { keys: 'ctrl+0', description: 'Reset zoom' },
  'print': { keys: 'ctrl+p', description: 'Print' },
  'view-source': { keys: 'ctrl+u', description: 'View the page source' },
  'fullscreen': { keys: 'f11', description: 'Toggle full screen' },
  'close-tab': { keys: 'ctrl+w', description: 'Close the tab' },
  'reopen-tab': { keys: 'ctrl+shift+t', description: 'Reopen the last closed tab' },
  'next-tab': { keys: 'ctrl+tab', description: 'Next tab' },
  'previous-tab': { keys: 'ctrl+shift+tab', description: 'Previous tab' }
}

export function registerBrowserUiCapabilities(d: BrowserUiDeps): void {
  const { control, browser } = d
  let ui = d.ui
  const getUi = (): BrowserUi => {
    if (ui) return ui
    if (!BrowserUi.supported()) return fail('unavailable', "Controlling the browser's own window is only available on Windows.")
    if (d.pid === undefined) return fail('unavailable', "Orbis did not start this browser, so it cannot tell which window is its own.")
    const pid: number = d.pid
    return (ui = new BrowserUi(pid))
  }
  const unavailable = (): string | null => {
    if (!BrowserUi.supported()) return "Controlling the browser's own window is only available on Windows."
    if (d.ui || d.pid !== undefined) return null
    return 'Orbis did not start this browser, so it cannot tell which window is its own.'
  }

  /** Turns the window layer's failures into the control layer's typed errors. */
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (err) {
      if (!(err instanceof BrowserUiError)) throw err
      const code = err.code === 'focus-refused' ? 'blocked' : err.code === 'unsupported' || err.code === 'no-window' ? 'unavailable' : 'failed'
      return fail(code, `[${err.code}] ${err.message}`, err.code === 'focus-refused' || err.code === 'no-window')
    }
  }

  /** The window that shows the active tab, made active in the browser first so the keys land on it. */
  const target = async (): Promise<{ win: UiWindow; page: CdpPage }> => {
    const page = await d.activePage()
    await page.activate().catch(() => undefined)
    const u = getUi()
    let win: UiWindow | undefined
    for (let i = 0; i < 20 && !win; i++) {
      const title = page.getTitle() || page.getURL()
      win = (await u.windows()).find((w) => title && w.title.includes(title)) ?? (i >= 5 ? await u.pickWindow() : undefined)
      if (!win) await sleep(150)
    }
    return { win: win ?? (await u.pickWindow()), page }
  }

  const devtoolsTargets = async (): Promise<{ targetId: string; url: string }[]> => {
    const { targetInfos } = await browser.conn.send<{ targetInfos: { targetId: string; url: string; type: string }[] }>('Target.getTargets')
    return targetInfos.filter((t) => t.url.startsWith('devtools://'))
  }
  const untilDevtools = async (open: boolean, ms = 6000): Promise<boolean> => {
    const end = Date.now() + ms
    let now = (await devtoolsTargets()).length > 0
    while (now !== open && Date.now() < end) {
      await sleep(150)
      now = (await devtoolsTargets()).length > 0
    }
    return now === open
  }

  const common = { confirmation: 'none' as const, unavailable }

  // ---------------------------------------------------------------- developer tools

  control.register({
    id: 'devtools.open',
    domain: 'devtools',
    name: 'Open developer tools',
    description: "Opens Chromium's developer tools for the active tab by pressing F12 in the browser window (a real key press; the window must be brought to the front, which Windows can refuse).",
    params: {},
    mutates: true,
    ...common,
    run: async () =>
      guard(async () => {
        if ((await devtoolsTargets()).length) return { alreadyOpen: true }
        const { win } = await target()
        for (let attempt = 0; attempt < 3; attempt++) {
          await getUi().press(win, 'f12')
          if (await untilDevtools(true, 3000)) return { alreadyOpen: false }
        }
        return fail('failed', 'F12 was sent to the browser but developer tools did not open.', true)
      }),
    verify: async () => {
      const ok = await untilDevtools(true, 1500)
      return { verified: ok, detail: ok ? 'A developer-tools target exists in the browser.' : 'No developer-tools target was found.' }
    }
  })

  control.register({
    id: 'devtools.close',
    domain: 'devtools',
    name: 'Close developer tools',
    description: "Closes Chromium's developer tools.",
    params: {},
    mutates: true,
    ...common,
    run: async () => {
      const open = await devtoolsTargets()
      if (!open.length) return { alreadyClosed: true }
      // Close it the way a person does (F12 toggles the tools); closing its page over the protocol is only the fallback.
      const pressed = await guard(async () => {
        const { win } = await target()
        await getUi().press(win, 'f12')
        return true
      }).catch(() => false)
      if (pressed && (await untilDevtools(false, 3000))) return { alreadyClosed: false }
      for (const t of open) await browser.conn.send('Target.closeTarget', { targetId: t.targetId }).catch(() => undefined)
      return (await untilDevtools(false, 3000)) ? { alreadyClosed: false } : fail('failed', 'Developer tools did not close.', true)
    },
    verify: async () => {
      const ok = await untilDevtools(false, 1500)
      return { verified: ok, detail: ok ? 'No developer-tools target remains.' : 'Developer tools are still open.' }
    }
  })

  control.register({
    id: 'devtools.inspect',
    domain: 'devtools',
    name: 'Inspect an element',
    description:
      'Opens developer tools, turns on its element picker (Ctrl+Shift+C) and clicks the element (found by CSS selector), so it is selected in the Elements panel. Limit: the element must be visible in the tab.',
    params: { selector: str('CSS selector of the element.', true) },
    mutates: true,
    ...common,
    run: async (p) => {
      const selector = String(p.selector ?? '')
      if (!selector) fail('invalid-params', 'Give a selector.')
      const page = await d.activePage()
      const locate = async (): Promise<{ x: number; y: number } | 'hidden' | null> =>
        (await page.executeJavaScript(
          `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center',inline:'center'}); const r = e.getBoundingClientRect(); return r.width && r.height ? {x: r.left + r.width/2, y: r.top + r.height/2} : 'hidden' })()`
        )) as { x: number; y: number } | 'hidden' | null
      const first = await locate()
      if (first === null) fail('not-found', `Nothing on the page matches ${selector}.`, true)
      if (first === 'hidden') fail('invalid-params', 'That element has no visible size.', true)
      if (!(await devtoolsTargets()).length) await control.execute({ capability: 'devtools.open', params: {}, source: 'orion' }, { confirm: async () => true })
      // The panel has to be up before the picker shortcut means anything -- see elementsPanelReady.
      if (!(await elementsPanelReady(browser))) {
        return fail('failed', 'Developer tools opened but the Elements panel did not come up, so there was nothing to select an element in.', true)
      }
      await guard(async () => {
        const { win } = await target()
        await getUi().press(win, 'ctrl+shift+c')
      })
      await sleep(400)
      // Opening developer tools resizes the page, so find the element again now.
      const rect = await locate()
      if (rect === null || rect === 'hidden') return fail('failed', 'The element is no longer visible after developer tools opened.', true)
      const at = rect
      // With the element picker on, a real mouse click on the element reports it to developer tools. The click point is the element's
      // centre in the page's own pixels, placed on screen through the page's area as UI Automation reports it.
      const innerWidth = Number(await page.executeJavaScript('window.innerWidth'))
      await guard(async () => {
        const { win } = await target()
        await getUi().clickPage(win, at.x, at.y, innerWidth)
      })
      const tag = String(await page.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.tagName ?? ''`))
      // The picker is not always taken up (it depends on where the keyboard focus is), so if the panel does not show the element yet,
      // do what a person does: right-click it and choose Inspect from the browser's own menu (its accelerator is N).
      const got = await selectedInDevtools(browser, tag, 2500)
      let via = 'element picker'
      if (!got?.matches) {
        via = 'context menu'
        await page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => undefined)
        await guard(async () => {
          const { win } = await target()
          await getUi().press(win, 'esc')
          const again = await locate()
          if (again === null || again === 'hidden') return fail('failed', 'The element is no longer visible.', true)
          await getUi().clickPage(win, again.x, again.y, Number(await page.executeJavaScript('window.innerWidth')), true)
          await sleep(500)
          await getUi().pressInMenu('n')
        })
      }
      return { selector, tag, via }
    },
    verify: async (out) => {
      const found = await selectedInDevtools(browser, String((out as { tag: string }).tag))
      return found === null
        ? { verified: false, detail: 'Developer tools opened, but the selected element could not be read back.' }
        : { verified: found.matches, detail: found.matches ? `The Elements panel selects ${found.description} (chosen with the ${(out as { via: string }).via}).` : `The Elements panel selects ${found.description}, not the requested element.` }
    }
  })

  // ---------------------------------------------------------------- the address bar

  const readOmnibox = async (): Promise<{ win: UiWindow; text: string | null }> => {
    const { win } = await target()
    return { win, text: await getUi().omnibox(win) }
  }
  const focusOmnibox = async (win: UiWindow): Promise<void> => {
    await getUi().press(win, 'ctrl+l')
  }
  const setOmnibox = async (text: string): Promise<UiWindow> => {
    // Another program can take the keyboard between two key presses, so check the text really landed and retry if not.
    let win: UiWindow | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      win = (await target()).win
      await focusOmnibox(win)
      await getUi().press(win, 'ctrl+a')
      if (text) await getUi().type(win, text)
      else await getUi().press(win, 'backspace')
      if ((await awaitOmnibox(win, text, 1500)) === text) return win
    }
    return win!
  }
  const awaitOmnibox = async (win: UiWindow, expected: string, ms = 3000): Promise<string | null> => {
    const end = Date.now() + ms
    let text = await getUi().omnibox(win)
    while (text !== expected && Date.now() < end) {
      await sleep(120)
      text = await getUi().omnibox(win)
    }
    return text
  }

  control.register({
    id: 'addressBar.focus',
    domain: 'addressBar',
    name: 'Focus the address bar',
    description: "Puts the cursor in the browser's address bar (Ctrl+L).",
    params: {},
    mutates: false,
    ...common,
    run: () => guard(async () => focusOmnibox((await target()).win)).then(() => ({ focused: true }))
  })

  control.register({
    id: 'addressBar.type',
    domain: 'addressBar',
    name: 'Type in the address bar',
    description: "Focuses the browser's address bar, replaces what is there with the text and stops (does not press Enter).",
    params: { text: str('The text to type.', true) },
    mutates: false,
    ...common,
    run: (p) => guard(async () => ({ win: await setOmnibox(String(p.text ?? '')) })).then(() => ({ typed: String(p.text ?? '') })),
    verify: async (_d, p) => {
      const { win } = await guard(readOmnibox)
      const text = await guard(() => awaitOmnibox(win, String(p.text ?? '')))
      const ok = text !== null && text === String(p.text ?? '')
      return { verified: ok, detail: text === null ? 'The address bar could not be read.' : `The address bar holds "${text}".` }
    }
  })

  control.register({
    id: 'addressBar.submit',
    domain: 'addressBar',
    name: 'Go from the address bar',
    description: "Types into the browser's address bar and presses Enter, so Chromium itself decides whether it is a web address or a search (Orbis Search is the default engine).",
    params: { text: str('A web address or search words.', true) },
    mutates: true,
    ...common,
    run: async (p) => {
      const text = String(p.text ?? '').trim()
      if (!text) fail('invalid-params', 'Give the text to go to.')
      const page = await d.activePage()
      const before = page.getURL()
      await guard(async () => {
        const win = await setOmnibox(text)
        if ((await getUi().omnibox(win)) !== text) fail('failed', 'The text did not land in the address bar (another program may have taken the keyboard). Nothing was submitted.', true)
        await getUi().press(win, 'enter')
      })
      return { submitted: text, before }
    },
    verify: async (out) => {
      const before = (out as { before: string }).before
      const page = await d.activePage()
      const end = Date.now() + 8000
      while ((page.getURL() === before || page.isLoading()) && Date.now() < end) await sleep(150)
      const changed = page.getURL() !== before
      return { verified: changed, detail: changed ? `The tab went to ${page.getURL()}.` : 'The tab did not navigate.' }
    }
  })

  control.register({
    id: 'addressBar.read',
    domain: 'addressBar',
    name: 'Read the address bar',
    description: "What is currently in the browser's address bar, read through Windows UI Automation.",
    params: {},
    mutates: false,
    ...common,
    run: async () => {
      const { text } = await guard(readOmnibox)
      if (text === null) fail('unavailable', "The browser's address bar is not exposed to UI Automation.", false)
      return { text }
    }
  })

  control.register({
    id: 'addressBar.clear',
    domain: 'addressBar',
    name: 'Clear the address bar',
    description: "Empties the browser's address bar text (the page stays as it is).",
    params: {},
    mutates: false,
    ...common,
    run: () => guard(async () => ({ win: await setOmnibox('') })).then(() => ({ cleared: true })),
    verify: async () => {
      const { win } = await guard(readOmnibox)
      const text = await guard(() => awaitOmnibox(win, ''))
      return { verified: text === '', detail: text === null ? 'The address bar could not be read.' : `The address bar holds "${text}".` }
    }
  })

  control.register({
    id: 'addressBar.suggestions',
    domain: 'addressBar',
    name: "Read the address bar's suggestions",
    description: "The rows in the address bar's drop-down (after addressBar.type), read through UI Automation.",
    params: {},
    mutates: false,
    ...common,
    run: () =>
      guard(async () => {
        const { win } = await target()
        return { suggestions: await getUi().suggestions(win) }
      })
  })

  control.register({
    id: 'browser.shortcut',
    domain: 'browser',
    name: 'Press a browser shortcut',
    description: `Presses one of the browser's own shortcuts in its window: ${Object.keys(SHORTCUTS).join(', ')}.`,
    params: { name: { type: 'string', description: 'The shortcut name.', required: true, enum: Object.keys(SHORTCUTS) } as ParamSpec },
    mutates: true,
    ...common,
    run: async (p) => {
      const s = SHORTCUTS[String(p.name)] ?? fail('invalid-params', `Unknown shortcut. Use one of: ${Object.keys(SHORTCUTS).join(', ')}.`)
      await guard(async () => getUi().press((await target()).win, s.keys))
      return { pressed: s.keys, name: String(p.name) }
    }
  })
  void bool
}

/**
 * Finds the selected row of the element tree inside the developer-tools page.
 *
 * The tools page keeps its panels in shadow roots, so this walks through them. Shared by the read and by the
 * readiness wait, so the two cannot drift apart and start looking for different things.
 */
const SELECTED_ROW_EXPRESSION = `(() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.matches && el.matches('li.selected, [aria-selected="true"]') && /^\s*</.test(el.textContent || '')) out.push(el.textContent); if (el.shadowRoot) walk(el.shadowRoot) } }; walk(document); return out[0] ?? null })()`

/**
 * Waits until the Elements panel has actually rendered its tree.
 *
 * Opening developer tools and pressing the picker shortcut in the same breath is a race. The panel takes a moment to
 * come up, and a picker click that lands before the tree exists selects nothing -- leaving the panel on the <body>
 * it starts with, which is precisely the wrong answer this capability used to report intermittently. Waiting for a
 * row to exist is waiting for the thing that has to be there, rather than for a fixed number of milliseconds.
 */
async function elementsPanelReady(browser: ChromiumCapabilityDeps['browser'], ms = 6000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const { targetInfos } = await browser.conn.send<{ targetInfos: { targetId: string; url: string }[] }>('Target.getTargets')
      const tool = targetInfos.find((t) => t.url.startsWith('devtools://'))
      if (tool !== undefined) {
        const { sessionId } = await browser.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: tool.targetId, flatten: true })
        try {
          const r = await browser.conn.send<{ result?: { value?: unknown } }>(
            'Runtime.evaluate',
            { expression: SELECTED_ROW_EXPRESSION, returnByValue: true },
            sessionId
          )
          const text = r.result?.value
          if (typeof text === 'string' && text !== '') return true
        } finally {
          await browser.conn.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
        }
      }
    } catch {
      // The tools page is still coming up; try again.
    }
    await sleep(200)
  }
  return false
}

/** Reads what the Elements panel has selected, from the developer-tools page itself. */
async function selectedInDevtools(browser: ChromiumCapabilityDeps['browser'], tag: string, ms = 5000): Promise<{ matches: boolean; description: string } | null> {
  const { targetInfos } = await browser.conn.send<{ targetInfos: { targetId: string; url: string }[] }>('Target.getTargets')
  const tool = targetInfos.find((t) => t.url.startsWith('devtools://'))
  if (!tool) return null
  const { sessionId } = await browser.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: tool.targetId, flatten: true })
  try {
    let last: { matches: boolean; description: string } | null = null
    if (process.env.ORBIS_UI_DEBUG) {
      const dbg = await browser.conn.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: `(() => { const out = []; const walk = (root) => { for (const el of root.querySelectorAll('*')) { const l = (el.getAttribute && (el.getAttribute('aria-label') || el.title || '')) || ''; if (/select an element|inspect/i.test(l)) out.push(el.tagName + ' ' + l + ' toggled=' + el.getAttribute('aria-pressed') + ' ' + el.className); if (el.shadowRoot) walk(el.shadowRoot) } }; walk(document); return out.join(' | ') + ' ## ' + document.title })()`, returnByValue: true }, sessionId)
      console.error('[devtools dbg]', JSON.stringify(dbg.result?.value))
    }
    const end = Date.now() + ms
    while (Date.now() < end) {
      const r = (await browser.conn.send<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        {
          expression: SELECTED_ROW_EXPRESSION,
          returnByValue: true
        },
        sessionId
      )) as { result?: { value?: unknown } }
      const text = r.result?.value
      if (typeof text === 'string' && text) {
        last = { matches: text.toLowerCase().includes(`<${tag.toLowerCase()}`), description: text.slice(0, 120) }
        if (last.matches) return last
      }
      await sleep(250)
    }
    return last
  } catch {
    return null
  } finally {
    await browser.conn.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}
