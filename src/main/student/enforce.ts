import type { PolicyState } from '../../shared/student/types.ts'

/**
 * Making a Focus policy true in the browser.
 *
 * ## Why this is done here and not in the interface
 *
 * Hiding a link is not blocking a page. A policy that only disables buttons is got round by typing the address, by a
 * redirect, by a page opening a window, by `location.href = ...`, by the back button, or by a bookmark -- and a
 * student who finds one of those once never trusts the feature again.
 *
 * So enforcement sits on the browser's own request pipeline. Every top-level document request is paused before it
 * leaves, asked about, and then either let go or answered with the Focus Shield. That is one place, below everything
 * a page or a student can do:
 *
 *   - the address bar, a link, a bookmark, a restored tab  -- all ordinary document requests
 *   - redirects, including meta-refresh and server redirects -- each is its own document request
 *   - new tabs and pop-ups -- a new target, attached to and treated the same
 *   - `location.assign`, `window.open`, a form post -- document requests
 *   - back and forward -- usually served from the cache, so those are checked separately on navigation
 *   - an encoded address, a different subdomain, a lookalike host -- the decision is made on the resolved URL
 *
 * Nothing in here decides anything. It asks `mayOpen` and does what it is told, so there is exactly one place in
 * Orbis that knows what counts as a distraction. A second opinion would eventually be a different opinion.
 *
 * ## What it must not break
 *
 * When there is no session and safety has nothing to hold back, the pause is switched off entirely rather than left
 * running and answering yes -- a browser that asks Orbis about every page it loads is a slower browser, and normal
 * Orbis is not allowed to get slower because Student exists.
 */

/** The little of a page this needs. Kept narrow so it can be driven by the real browser or by a test. */
export interface EnforceablePage {
  readonly id: number
  readonly targetId: string
  /** What this tab is showing now. The real browser's page calls it `getURL`. */
  getURL?(): string
  debugger: { sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> }
  onEvent(listener: (event: { method: string; params?: Record<string, unknown> }) => void): () => void
}

export interface EnforceableBrowser {
  list(): EnforceablePage[]
  onChange(listener: (change: { type: 'opened' | 'closed' | 'changed'; page: EnforceablePage }) => void): () => void
}

export interface EnforceDecision {
  allowed: boolean
  reason: string
  saveable: boolean
  because: string
  category: string
  remaining: number | null
  sessionTitle: string
}

export interface EnforceHooks {
  /** The one decision point. Everything here goes through it. */
  mayOpen(url: string): Promise<EnforceDecision>
  saveForLater(url: string, title: string): Promise<unknown>
  endFocus(): Promise<unknown>
  /** Opens the Student surface, for the shield's "back to my session" button. */
  showStudent?(): void
  /** Somebody asked Orion about a page they could not open. */
  askOrion?(url: string): void
}

const BINDING = 'orbisStudentShield'

export class FocusEnforcer {
  private browser: EnforceableBrowser | null = null
  private readonly hooks: EnforceHooks
  /** Whether anything is being held back at all. When false the pause is off and the browser is untouched. */
  private active = false
  private state: PolicyState = 'normal'
  private readonly watched = new Map<string, () => void>()
  private readonly armed = new Set<string>()
  private stopWatchingBrowser: (() => void) | null = null

  constructor(hooks: EnforceHooks) {
    this.hooks = hooks
  }

  /** Lent the browser, once there is one. */
  watch(browser: EnforceableBrowser): void {
    this.browser = browser
    this.stopWatchingBrowser?.()
    this.stopWatchingBrowser = browser.onChange((change) => {
      if (change.type === 'closed') {
        this.watched.get(change.page.targetId)?.()
        this.watched.delete(change.page.targetId)
        this.armed.delete(change.page.targetId)
        return
      }
      // A new tab is armed the moment it exists, because a pop-up's first request is the one that matters. A tab
      // that merely changed is swept, since a change can be a navigation that made no request.
      if (!this.active) return
      if (change.type === 'opened') void this.arm(change.page)
      else void this.sweep(change.page)
    })
    if (this.active) void this.armAll()
  }

  /**
   * Told what the policy is now.
   *
   * Called on every change -- a session starting or ending, a break, a settings change, a profile switch -- and it is
   * cheap to call repeatedly: arming a tab twice does nothing.
   */
  apply(policy: { state: PolicyState; blockedCategories: readonly string[]; blockedHosts: readonly string[]; safetyBlocked: readonly string[] }): void {
    this.state = policy.state
    const needed = policy.blockedCategories.length > 0 || policy.blockedHosts.length > 0 || policy.safetyBlocked.length > 0
    if (needed === this.active) {
      // Already in the right mode. Newly opened tabs still need arming.
      if (needed) void this.armAll()
      return
    }
    this.active = needed
    if (needed) void this.armAll()
    else void this.disarmAll()
  }

  private async armAll(): Promise<void> {
    for (const page of this.browser?.list() ?? []) {
      // Arming is skipped for a tab already armed, so the sweep is asked for separately -- a policy that has just
      // become stricter has to look again at tabs it was already watching.
      const armed = this.armed.has(page.targetId)
      await this.arm(page).catch(() => undefined)
      if (armed) await this.sweep(page).catch(() => undefined)
    }
  }

  private async disarmAll(): Promise<void> {
    for (const page of this.browser?.list() ?? []) {
      this.watched.get(page.targetId)?.()
      this.watched.delete(page.targetId)
      this.armed.delete(page.targetId)
      await page.debugger.sendCommand('Fetch.disable').catch(() => undefined)
    }
  }

  /** Puts the pause on one tab, and listens for what it catches. */
  private async arm(page: EnforceablePage): Promise<void> {
    if (this.armed.has(page.targetId)) return
    this.armed.add(page.targetId)

    const stop = page.onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') void this.onPaused(page, event.params ?? {})
      else if (event.method === 'Runtime.bindingCalled') void this.onShieldAction(page, event.params ?? {})
      else if (event.method === 'Page.frameNavigated') void this.onNavigated(page, event.params ?? {})
    })
    this.watched.set(page.targetId, stop)

    // Only top-level documents. Pausing every image and script would make Orbis the slowest browser on the machine
    // and would not block one more page than this does: a page is reached by its own document request.
    await page.debugger
      .sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] })
      .catch(() => undefined)
    await page.debugger.sendCommand('Runtime.addBinding', { name: BINDING }).catch(() => undefined)
    // And whatever it is already showing.
    await this.sweep(page)
  }

  /**
   * A tab that was already open when the policy arrived.
   *
   * Without this, starting a session with the thing you are trying to avoid already on screen leaves it on screen:
   * the pause only sees *new* requests, and a page that has already loaded makes none. Somebody who opens Focus
   * because a feed has their attention would find the feed still there, which is the exact moment the feature is
   * supposed to work.
   *
   * It is also what covers a page restored from the back-forward cache and a tab merely brought to the front.
   */
  private async sweep(page: EnforceablePage): Promise<void> {
    if (!this.active) return
    const url = page.getURL?.() ?? ''
    if (!url || !/^https?:/i.test(url)) return
    const decision = await this.hooks.mayOpen(url).catch(() => null)
    if (!decision || decision.allowed) return
    await page.debugger
      .sendCommand('Page.navigate', { url: `data:text/html;charset=utf-8;base64,${Buffer.from(shieldPage(url, decision, this.state), 'utf8').toString('base64')}` })
      .catch(() => undefined)
  }

  private async onPaused(page: EnforceablePage, params: Record<string, unknown>): Promise<void> {
    const requestId = typeof params.requestId === 'string' ? params.requestId : null
    const request = (params.request ?? {}) as { url?: string }
    const url = typeof request.url === 'string' ? request.url : ''
    if (!requestId) return

    const go = (): Promise<unknown> => page.debugger.sendCommand('Fetch.continueRequest', { requestId }).catch(() => undefined)
    if (!url || !/^https?:/i.test(url)) return void go()

    let decision: EnforceDecision
    try {
      decision = await this.hooks.mayOpen(url)
    } catch {
      // Orbis could not answer. The page goes through: a broken Student must not become a browser that loads
      // nothing, and failing closed here would mean a bug in a study feature stopping somebody's browsing.
      return void go()
    }
    if (decision.allowed) return void go()

    const body = shieldPage(url, decision, this.state)
    await page.debugger
      .sendCommand('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Cache-Control', value: 'no-store' }
        ],
        body: Buffer.from(body, 'utf8').toString('base64')
      })
      .catch(() => undefined)
  }

  /**
   * Back and forward, which usually do not make a request at all.
   *
   * A page served from the back-forward cache never reaches the pause above, so the address is checked once the
   * navigation is reported and the tab is sent to the shield if it should not be there. It shows a moment later than
   * the pause does, and it is the difference between a policy and a policy with a hole in it.
   */
  private async onNavigated(page: EnforceablePage, params: Record<string, unknown>): Promise<void> {
    if (!this.active) return
    const frame = (params.frame ?? {}) as { url?: string; parentId?: string }
    if (frame.parentId) return
    const url = typeof frame.url === 'string' ? frame.url : ''
    if (!url || !/^https?:/i.test(url)) return
    const decision = await this.hooks.mayOpen(url).catch(() => null)
    if (!decision || decision.allowed) return
    await page.debugger
      .sendCommand('Page.navigate', { url: `data:text/html;charset=utf-8;base64,${Buffer.from(shieldPage(url, decision, this.state), 'utf8').toString('base64')}` })
      .catch(() => undefined)
  }

  /** The shield's buttons, which reach Orbis through a binding rather than through a page's network access. */
  private async onShieldAction(page: EnforceablePage, params: Record<string, unknown>): Promise<void> {
    if (params.name !== BINDING) return
    let message: { action?: string; url?: string; title?: string } = {}
    try {
      message = JSON.parse(String(params.payload ?? '{}'))
    } catch {
      return
    }
    const url = typeof message.url === 'string' ? message.url.slice(0, 2048) : ''
    switch (message.action) {
      case 'save':
        if (url) await this.hooks.saveForLater(url, typeof message.title === 'string' ? message.title : url)
        break
      case 'end':
        await this.hooks.endFocus()
        break
      case 'student':
        this.hooks.showStudent?.()
        break
      case 'orion':
        if (url) this.hooks.askOrion?.(url)
        break
      case 'back':
        await page.debugger.sendCommand('Page.navigateToHistoryEntry', {}).catch(() => undefined)
        break
    }
  }

  stop(): void {
    this.stopWatchingBrowser?.()
    this.stopWatchingBrowser = null
    for (const stop of this.watched.values()) stop()
    this.watched.clear()
    this.armed.clear()
  }
}

const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A value put inside the shield's own script tag.
 *
 * `JSON.stringify` alone is not enough: an address containing `</script>` closes the tag and whatever followed
 * becomes markup. The address came from a page, so it is exactly the sort of thing that can be chosen deliberately.
 * Escaping `<` as a unicode sequence keeps it a string to JavaScript and invisible to the HTML parser.
 */
const inScript = (value: string): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // Two characters JavaScript treats as line breaks inside a string but JSON does not escape.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

const spellOut = (seconds: number | null): string => {
  if (seconds === null) return ''
  const minutes = Math.max(0, Math.round(seconds / 60))
  if (minutes === 0) return 'less than a minute remaining'
  return minutes === 1 ? '1 minute remaining' : `${minutes} minutes remaining`
}

/**
 * The Focus Shield.
 *
 * Deliberately not an error page. It says what is happening, what the student was doing, and offers the three things
 * somebody actually wants at that moment: go back to the work, keep the page for afterwards, or stop the session. No
 * technical detail, no blame, and never the word "denied".
 *
 * Self-contained, because it is served in place of a page that was refused: no network, no fonts, no scripts from
 * anywhere. It is also what a student sees when safety rather than focus held something back, and in that case it
 * offers neither saving nor ending -- there is nothing to come back to later.
 */
export function shieldPage(url: string, decision: EnforceDecision, state: PolicyState): string {
  const safety = decision.because === 'safety'
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  })()
  const remaining = spellOut(decision.remaining)
  const locked = state === 'locked' || state === 'deep'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safety ? 'Not available' : 'Focus Shield'}</title>
<style>
  :root { color-scheme: dark light;
    --bg: #080b12; --panel: rgba(255,255,255,.04); --line: rgba(255,255,255,.1);
    --ink: #eef2f8; --faint: #93a0b4; --cyan: #3fd8ff; --warn: #ffbe4d; }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f6f8fc; --panel: rgba(0,0,0,.03); --line: rgba(0,0,0,.1); --ink: #0d1420; --faint: #5a6578; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: radial-gradient(1200px 700px at 50% -10%, rgba(63,216,255,.10), transparent 60%), var(--bg);
    color: var(--ink); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 520px; text-align: center; }
  .ring { width: 92px; height: 92px; margin: 0 auto 22px; border-radius: 50%;
    border: 2px solid var(--line); display: grid; place-items: center; position: relative; }
  .ring::before { content: ""; position: absolute; inset: -2px; border-radius: 50%;
    border: 2px solid transparent; border-top-color: var(--cyan); opacity: .8; }
  .orb { width: 44px; height: 44px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #bdf0ff, var(--cyan) 55%, #1b6f8c);
    box-shadow: 0 0 26px rgba(63,216,255,.35); }
  h1 { margin: 0 0 6px; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); font-weight: 600; }
  h2 { margin: 0 0 10px; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
  p { margin: 0 0 6px; color: var(--faint); }
  .session { margin-top: 18px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
  .session strong { display: block; font-weight: 600; color: var(--ink); }
  .session span { font-size: 13px; color: var(--faint); }
  .actions { margin-top: 22px; display: flex; flex-direction: column; gap: 10px; }
  button { font: inherit; font-weight: 550; padding: 12px 16px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink); transition: border-color .15s, background .15s; }
  button:hover { border-color: var(--cyan); }
  button.primary { background: var(--cyan); border-color: var(--cyan); color: #04212c; }
  button.quiet { border-color: transparent; color: var(--faint); }
  button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  .host { font-size: 13px; color: var(--faint); word-break: break-all; margin-top: 14px; }
  @media (prefers-reduced-motion: no-preference) { main { animation: in .28s ease-out both; } }
  @keyframes in { from { opacity: 0; transform: translateY(8px); } }
</style></head>
<body><main>
  <div class="ring"><div class="orb"></div></div>
  <h1>${safety ? 'Not available on this profile' : 'Focus Shield'}</h1>
  <h2>${escape(host)} can wait.</h2>
  <p>${escape(decision.reason)}</p>
  ${
    decision.sessionTitle
      ? `<div class="session"><strong>${escape(decision.sessionTitle)}</strong><span>${escape(remaining)}</span></div>`
      : ''
  }
  <div class="actions">
    <button class="primary" id="back" autofocus>Return to Focus</button>
    ${decision.saveable ? '<button id="save">Save for later</button>' : ''}
    ${safety ? '' : '<button id="orion" class="quiet">Ask Orion about this instead</button>'}
    ${safety || locked ? '' : '<button id="end" class="quiet">End session</button>'}
  </div>
  <div class="host">${escape(url)}</div>
</main>
<script>
  (function () {
    var url = ${inScript(url)};
    var title = ${inScript(host)};
    function tell(action) {
      try { window.${BINDING}(JSON.stringify({ action: action, url: url, title: title })); } catch (e) { /* the page is still readable without Orbis */ }
    }
    function on(id, action, then) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', function () { tell(action); if (then) then(el); });
    }
    on('back', 'back', function () { history.length > 1 ? history.back() : tell('student'); });
    on('save', 'save', function (el) { el.textContent = 'Saved for later'; el.disabled = true; });
    on('orion', 'orion');
    on('end', 'end');
    // Escape goes back, the same as the button, so the keyboard alone is enough.
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { tell('back'); if (history.length > 1) history.back(); } });
  })();
</script>
</body></html>`
}
