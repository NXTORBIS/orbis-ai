import { icon } from '../../orbis-ui/panel/rail/icons.js'
import { labFor, labSays, visualActions, type VisualNeed } from '../../src/shared/visual/actions.ts'
import { DEFAULT_QUESTION, MOST_QUESTION, readFinding, surenessSays, searchFor, type VisualFinding } from '../../src/shared/visual/ask.ts'
import { faultFrom, fault, type VisualFault } from '../../src/shared/visual/errors.ts'
import { cornerAt, handleUnder, inside, normalise, type Corner, type Point, type Rect } from '../../src/shared/visual/geometry.ts'
import { kindFacts } from '../../src/shared/visual/kinds.ts'
import { next, overlaid, start, type Event as Step, type State } from '../../src/shared/visual/machine.ts'
import { placePanel } from '../../src/shared/selectionPlacement.ts'
import { readSelection } from '../../src/shared/selectionText.ts'
import { VISUAL_STYLES } from './styles.ts'

/**
 * Orbis Visual Search: hold Ctrl, drag over anything on a page, and ask Orion about what you selected.
 *
 * This file is only the part that lives on the page: watching for the gesture, drawing the selection, drawing the
 * bar, and showing the answer. It decides nothing and can reach nothing. What a rectangle *is* is worked out in
 * src/shared/visual, where it can be tested without a browser; what happens to it happens in the extension's worker,
 * which is the only side that can take a picture or reach Orbis.
 *
 * Five things it is careful about, each of which is a way to get this wrong:
 *
 * **The page cannot touch any of it.** Everything is in a closed shadow root inside this frame's isolated world. A
 * page can neither read what was selected, nor style the frame, nor cover it with an invisible layer and take the
 * clicks, nor call anything here from its own scripts. A page cannot start a Visual Search either: the gesture is
 * real pointer and key events with `isTrusted`, and a synthetic one is ignored.
 *
 * **Ordinary browsing is untouched until the drag threshold is crossed.** Holding Ctrl does nothing. Ctrl-clicking a
 * link opens it in a new tab exactly as it always did. Six pixels of movement is what makes this a Visual Search,
 * and until then not one event is swallowed.
 *
 * **Nothing is ever claimed that did not happen.** The frame is drawn around the pixels that are actually sent. A
 * capture that came back blank says so rather than being sent. An action that Orbis cannot do is not drawn at all --
 * not greyed out, not with a tooltip, not at all.
 *
 * **Every listener has a matching removal.** They are kept in one list and torn off together, because this runs on
 * every page on the web and a leaked `pointermove` listener is somebody's scrolling getting slower all afternoon.
 *
 * **It runs in the top frame only.** The capture is of the whole window and a cross-origin frame cannot know where it
 * sits inside it, so a selection begun inside one would crop the wrong part of the page. A drag begun on the page
 * and swept across an embedded frame works normally; one begun *on* an embedded frame does not begin. That is a real
 * limitation and it is the honest one -- the alternative was covering embedded frames while Ctrl is held, which
 * would have swallowed Ctrl-clicks on the links inside them.
 */

const BAR_WIDTH = 384
/** Taken around the selection for the model only. The frame on screen is never drawn around the padded rectangle. */
const CONTEXT_PAD = 10

type Need = VisualNeed

interface Can {
  readonly can: readonly Need[]
  readonly model: string | null
  readonly on: boolean
  readonly says: string
}

interface Shot {
  readonly image: string
  readonly size: { width: number; height: number }
  readonly scale: number
}

// ---------------------------------------------------------------- talking to the worker

type Reply = { ok: true; data?: unknown } | { ok: false; code?: string; message: string }

function askWorker(message: Record<string, unknown>): Promise<Reply> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply: Reply | undefined) => {
        const failed = chrome.runtime.lastError
        resolve(failed || !reply ? { ok: false, message: failed?.message ?? 'Orbis did not answer.' } : reply)
      })
    } catch {
      resolve({ ok: false, message: 'Orbis is not running.' })
    }
  })
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function svg(name: string): SVGSVGElement | null {
  const markup = icon(name)
  if (!markup) return null
  const holder = document.createElement('div')
  holder.innerHTML = markup
  const found = holder.firstElementChild
  return found instanceof SVGSVGElement ? found : null
}

/** Whether a video is under the selection, which is what tells a blank capture from a protected one. */
function videoUnder(rect: Rect): boolean {
  const r = normalise(rect)
  for (const video of document.querySelectorAll('video')) {
    const box = video.getBoundingClientRect()
    if (box.right > r.x && box.left < r.x + r.width && box.bottom > r.y && box.top < r.y + r.height) return true
  }
  return false
}

/** The time on a video under the selection, when there is one playing. Shown on the result, never invented. */
function videoTime(rect: Rect): string {
  const r = normalise(rect)
  for (const video of document.querySelectorAll('video')) {
    const box = video.getBoundingClientRect()
    if (box.right <= r.x || box.left >= r.x + r.width || box.bottom <= r.y || box.top >= r.y + r.height) continue
    const at = video.currentTime
    if (!Number.isFinite(at) || at <= 0) continue
    const mins = Math.floor(at / 60)
    const secs = Math.floor(at % 60)
    return `${mins}:${String(secs).padStart(2, '0')}`
  }
  return ''
}

/**
 * Whether the selection covers something Orbis must not send anywhere.
 *
 * A password field, a one-time code, a card number. The same reading the selection orb uses for text is applied to
 * what is under the rectangle, so the two halves of Orbis agree about what counts as private. This is a sweep of the
 * elements the selection overlaps rather than of the whole page -- what is elsewhere on the page is not being sent.
 */
function risky(rect: Rect): boolean {
  const r = normalise(rect)
  const fields = document.querySelectorAll('input')
  for (const field of fields) {
    const box = field.getBoundingClientRect()
    if (box.right <= r.x || box.left >= r.x + r.width || box.bottom <= r.y || box.top >= r.y + r.height) continue
    if (field.type === 'password') return true
    const hint = `${field.autocomplete} ${field.name} ${field.id}`.toLowerCase()
    if (/one-time-code|otp|\bcc-|card-?number|cvc|cvv|security-?code/.test(hint)) return true
    if (field.value && readSelection(field.value).risk !== 'none') return true
  }
  return false
}

// ---------------------------------------------------------------- the surface

class VisualSearch {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private readonly layer: HTMLElement
  private readonly veil: HTMLElement
  private frame: HTMLElement | null = null
  private bar: HTMLElement | null = null
  private core: HTMLElement | null = null
  private toastNode: HTMLElement | null = null
  private hintNode: HTMLElement | null = null

  private state: State = start({ width: window.innerWidth, height: window.innerHeight })
  /** What Orbis can do, asked of it rather than assumed. Empty until the worker answers. */
  private able: Can = { can: [], model: null, on: true, says: '' }
  private shot: Shot | null = null
  private finding: VisualFinding | null = null
  private streamed = ''
  private statusLine = ''
  private answered = false
  private asked = ''
  private port: chrome.runtime.Port | null = null
  private runningId = ''
  private readonly listeners: (() => void)[] = []
  private pointerId: number | null = null
  private suppressClick = false
  private zoomed = false
  private toastTimer = 0
  /**
   * Whether this selection covers something private, worked out once.
   *
   * It was worked out on every draw, which meant sweeping every input on the page twice for every few words of a
   * streaming answer. The selection does not change while an answer arrives, so the answer does not either -- and
   * on a page with a long form that sweep was costing frames of somebody's reading.
   */
  private riskyNow = false
  /**
   * When abilities were last asked for.
   *
   * Ctrl is pressed dozens of times an hour for copying, for new tabs, for everything -- and asking the helper on
   * every one of them would be a request storm for an answer that almost never changes. Three seconds is short
   * enough that opening the Orbis window is noticed before the next selection and long enough that ordinary
   * keyboard use costs nothing.
   */
  private ableAt = 0

  constructor() {
    this.host = document.createElement('orbis-visual-search')
    // Closed: the page cannot reach inside, even knowing the element is there.
    this.root = this.host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = VISUAL_STYLES
    this.root.append(style)

    this.layer = el('div', 'layer')
    this.veil = el('div', 'veil')
    this.layer.append(this.veil)
    this.root.append(this.layer)
    ;(document.documentElement || document.body).append(this.host)

    this.watch()
    void this.refreshAbilities()
  }

  // -------------------------------------------------------------- listening

  private on<K extends keyof WindowEventMap>(target: Window | Document, type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions): void {
    const listener = handler as EventListener
    target.addEventListener(type, listener, options)
    this.listeners.push(() => target.removeEventListener(type, listener, options))
  }

  private watch(): void {
    this.on(window, 'keydown', (event) => this.onKeyDown(event), { capture: true })
    this.on(window, 'keyup', (event) => this.onKeyUp(event), { capture: true })
    this.on(window, 'pointerdown', (event) => this.onPointerDown(event), { capture: true })
    this.on(window, 'pointermove', (event) => this.onPointerMove(event), { capture: true })
    this.on(window, 'pointerup', (event) => this.onPointerUp(event), { capture: true })
    this.on(window, 'pointercancel', () => this.step({ kind: 'cancel' }), { capture: true })
    this.on(window, 'blur', () => this.onBlur())
    this.on(window, 'resize', () => this.step({ kind: 'room', room: { width: window.innerWidth, height: window.innerHeight } }))
    // A page that navigates or scrolls out from under the selection: the pixels it was about are gone.
    this.on(window, 'scroll', () => this.onScroll(), { capture: true, passive: true })
    this.on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.step({ kind: 'interrupted' })
    })
    // A Ctrl-drag that began on a link is also the browser's own drag-and-drop. Stopped only once this is a Visual
    // Search, so dragging a link out of the page keeps working when it is not.
    this.on(window, 'dragstart', (event) => {
      if (overlaid(this.state.phase)) event.preventDefault()
    }, { capture: true })
    // The click that follows a drag. Swallowed once, so the page does not also act on it.
    this.on(window, 'click', (event) => {
      if (!this.suppressClick) return
      this.suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }, { capture: true })
    this.listeners.push(() => this.stopAsking())
  }

  private get modifier(): 'Control' | 'Meta' {
    // The platform's own convention, taken from the one the browser itself uses for "open in a new tab".
    return navigator.platform.toLowerCase().includes('mac') ? 'Meta' : 'Control'
  }

  private held(event: MouseEvent | PointerEvent | KeyboardEvent): boolean {
    return this.modifier === 'Meta' ? event.metaKey : event.ctrlKey
  }

  // -------------------------------------------------------------- the gesture

  private onKeyDown(event: KeyboardEvent): void {
    if (!event.isTrusted) return
    if (event.key === 'Escape' && overlaid(this.state.phase)) {
      event.preventDefault()
      event.stopPropagation()
      this.step({ kind: 'cancel' })
      return
    }
    if (overlaid(this.state.phase)) {
      // Everything else is left alone: the bar's own input and buttons handle their own keys, inside the shadow root.
      return
    }
    if (event.key !== this.modifier) return
    /*
     * Armed whenever it is not switched off, rather than only when something can see.
     *
     * The first version armed only once `visual:can` had come back saying there were eyes, which had a consequence
     * worth spelling out: a page that loaded before Orbis was reachable had Visual Search dead on it for ever, with
     * no way for the person to find out why. Now the gesture always begins and the reason -- no key, Orbis not
     * running -- is said in the bar, which is the one place they would look. Abilities are asked for again here
     * because the answer genuinely changes while a page is open.
     */
    if (this.able.on === false) return
    if (Date.now() - this.ableAt > 3000) void this.refreshAbilities()
    this.step({ kind: 'modifier-down' })
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (!event.isTrusted) return
    if (event.key === this.modifier) this.step({ kind: 'modifier-up' })
  }

  private onBlur(): void {
    // Alt-Tab away mid-drag: the pointer is gone and the modifier's key-up will never arrive, so a selection in
    // progress is abandoned. One that is finished is kept -- there is nothing wrong with it.
    if (this.state.phase === 'selecting' || this.state.phase === 'adjusting' || this.state.phase === 'armed') this.step({ kind: 'cancel' })
  }

  private onScroll(): void {
    // Scrolling under a finished selection moves the page out from under the rectangle, so what the frame is drawn
    // around is no longer what it was drawn around. Only while nothing has been captured: once the picture is taken
    // the answer is about the picture, and scrolling is irrelevant to it.
    if (this.state.phase === 'ready') this.step({ kind: 'cancel' })
  }

  private point(event: PointerEvent): Point {
    return { x: event.clientX, y: event.clientY }
  }

  private onPointerDown(event: PointerEvent): void {
    if (!event.isTrusted || event.button !== 0) return

    if (overlaid(this.state.phase)) {
      const at = this.point(event)
      const rect = this.state.rect
      if (!rect) return
      // Inside the bar: the bar's own handlers deal with it.
      if (this.bar && event.composedPath().includes(this.bar)) return
      const corner = handleUnder(rect, at)
      if (corner) {
        event.preventDefault()
        event.stopPropagation()
        this.capturePointer(event)
        this.step({ kind: 'grab-handle', corner, at })
        return
      }
      if (inside(rect, at)) {
        event.preventDefault()
        event.stopPropagation()
        this.capturePointer(event)
        this.step({ kind: 'grab-inside', at })
        return
      }
      /*
       * A click outside the selection closes it.
       *
       * The click itself is swallowed rather than being let through to the page. Letting it through was tried first
       * and was wrong in use: dismissing the bar also followed whatever link happened to be under where you clicked.
       */
      event.preventDefault()
      event.stopPropagation()
      this.step({ kind: 'cancel' })
      return
    }

    if (!this.held(event)) return
    if (this.state.phase !== 'armed') {
      // The key-down may have gone to another element first; the modifier being down is enough to arm it.
      if (this.able.on === false) return
      this.step({ kind: 'modifier-down' })
    }
    // Deliberately nothing else: no preventDefault, no stopPropagation. Until the threshold is crossed this is an
    // ordinary Ctrl-click and the page must receive it exactly as it always has.
    this.step({ kind: 'pointer-down', at: this.point(event) })
    this.pointerId = event.pointerId
  }

  private capturePointer(event: PointerEvent): void {
    this.pointerId = event.pointerId
    try {
      // On the host, so the pointer keeps coming even when it leaves the window -- which is what a drag to the very
      // edge of the screen does.
      this.host.setPointerCapture(event.pointerId)
    } catch {
      // Not available on this input. The window-level listeners still carry the drag.
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!event.isTrusted) return
    const phase = this.state.phase
    if (phase !== 'armed' && phase !== 'selecting' && phase !== 'adjusting') return
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return

    const before = this.state.phase
    this.step({ kind: 'pointer-move', at: this.point(event) })
    if (this.state.phase === 'selecting' || this.state.phase === 'adjusting') {
      event.preventDefault()
      event.stopPropagation()
      // The click at the end of this drag belongs to the gesture, not to the page.
      this.suppressClick = true
      if (before === 'armed') {
        this.capturePointer(event)
        // Dragging over text selects it, which leaves the page with a highlight nobody asked for.
        document.documentElement.style.setProperty('user-select', 'none')
        window.getSelection()?.removeAllRanges()
      }
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (!event.isTrusted) return
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return
    const was = this.state.phase
    if (was === 'selecting' || was === 'adjusting') {
      event.preventDefault()
      event.stopPropagation()
    }
    this.releasePointer()
    this.step({ kind: 'pointer-up', at: this.point(event) })
    if (this.state.phase === 'ready' && was === 'selecting') {
      // The bar opens focused, so somebody can select something and type immediately.
      window.setTimeout(() => this.focusInput(), 0)
    }
  }

  private releasePointer(): void {
    if (this.pointerId !== null) {
      try {
        this.host.releasePointerCapture(this.pointerId)
      } catch {
        // It was never captured, which is the ordinary case for a click.
      }
    }
    this.pointerId = null
    document.documentElement.style.removeProperty('user-select')
  }

  // -------------------------------------------------------------- the machine

  private step(event: Step): void {
    const before = this.state
    const after = next(before, event)
    if (after === before) return
    this.state = after

    if (before.run !== after.run) {
      // A new run: everything about the old one goes, including anything still arriving for it.
      this.stopAsking()
      this.shot = null
      this.finding = null
      this.streamed = ''
      this.statusLine = ''
      this.answered = false
      this.zoomed = false
    }
    if (after.phase === 'idle') this.releasePointer()
    // Settled: worked out here, once, rather than on every draw.
    if (after.phase === 'ready' && before.phase !== 'ready') this.riskyNow = after.rect ? risky(after.rect) : false
    if (after.phase === 'capturing' && before.phase !== 'capturing') void this.lookAt(after.run)

    this.draw()
  }

  // -------------------------------------------------------------- doing the work

  private async refreshAbilities(): Promise<void> {
    this.ableAt = Date.now()
    const reply = await askWorker({ kind: 'orbis-visual/can' })
    if (reply.ok) {
      const got = (reply.data ?? {}) as { can?: unknown; model?: unknown; on?: unknown; says?: unknown }
      this.able = {
        can: Array.isArray(got.can) ? (got.can.filter((one): one is Need => typeof one === 'string') as Need[]) : [],
        model: typeof got.model === 'string' ? got.model : null,
        on: got.on !== false,
        says: typeof got.says === 'string' ? got.says : ''
      }
    } else {
      this.able = { can: [], model: null, on: true, says: 'Orbis is not running.' }
    }
    if (this.able.on && this.able.can.includes('eyes')) void this.maybeHint()
  }

  /**
   * Take the picture and ask about it.
   *
   * The run number is carried the whole way and checked at every point an answer could arrive. Without that, a second
   * selection made while the first was still being looked at ended with the first answer appearing over the second
   * selection -- the result looked like a bad answer and was a right answer to a question nobody was asking any more.
   */
  private async lookAt(run: number): Promise<void> {
    const rect = this.state.rect
    if (!rect) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const video = videoUnder(rect)

    let shot = this.shot
    if (!shot) {
      const reply = await askWorker({ kind: 'orbis-visual/capture', rect, viewport, pad: CONTEXT_PAD, video })
      if (this.state.run !== run) return
      if (!reply.ok) {
        const known = reply.code ? fault(reply.code as never) : faultFrom(reply.message)
        this.step({ kind: 'fail', code: known.code, says: known.code === 'action-failed' ? reply.message : known.says })
        return
      }
      const got = (reply.data ?? {}) as Partial<Shot>
      if (typeof got.image !== 'string' || !got.size) {
        this.step({ kind: 'fail', code: 'no-capture', says: fault('no-capture').says })
        return
      }
      shot = { image: got.image, size: got.size, scale: typeof got.scale === 'number' ? got.scale : 1 }
      this.shot = shot
    }
    if (this.state.run !== run) return
    this.step({ kind: 'captured' })

    if (risky(rect)) {
      this.step({ kind: 'fail', code: 'action-failed', says: 'That selection covers something private, so Orbis will not send it anywhere.' })
      return
    }

    const at = video ? videoTime(rect) : ''
    this.streamed = ''
    this.statusLine = 'Looking at what you selected…'
    this.ask(run, shot.image, at)
  }

  private ask(run: number, image: string, at: string): void {
    this.stopAsking()
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connect({ name: 'orbis-visual' })
    } catch {
      this.step({ kind: 'fail', code: 'no-orbis', says: fault('no-orbis').says })
      return
    }
    this.port = port
    const id = `v${run}`
    this.runningId = id

    port.onMessage.addListener((message: { id?: string; chunk?: string; status?: string; done?: boolean; reply?: string; failed?: string; model?: string | null }) => {
      if (message.id !== id || this.state.run !== run) return
      if (typeof message.chunk === 'string') {
        this.streamed += message.chunk
        this.statusLine = ''
        this.drawAnswer()
        return
      }
      if (typeof message.status === 'string') {
        this.statusLine = message.status
        this.drawAnswer()
        return
      }
      if (typeof message.failed === 'string') {
        const known = faultFrom(message.failed)
        this.step({ kind: 'fail', code: known.code, says: known.says })
        return
      }
      if (message.done === true) {
        const whole = typeof message.reply === 'string' && message.reply !== '' ? message.reply : this.streamed
        if (whole.trim() === '') {
          this.step({ kind: 'fail', code: 'empty', says: fault('empty').says })
          return
        }
        this.finding = readFinding(whole)
        if (typeof message.model === 'string') this.able = { ...this.able, model: message.model }
        this.answered = true
        this.statusLine = ''
        this.step({ kind: 'answer' })
      }
    })
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null
    })

    port.postMessage({
      kind: 'orbis-visual/ask',
      id,
      image,
      question: this.state.question || DEFAULT_QUESTION,
      // A quick action asks for that task; anything else is a plain question about the picture.
      ask: this.quickKind || 'ask',
      page: { title: document.title, url: location.href },
      ...(at ? { at } : {})
    })
  }

  /** Which quick action is running, so the request asks for that task rather than for a plain question. */
  private quickKind = ''

  private stopAsking(): void {
    if (this.port) {
      try {
        if (this.runningId) this.port.postMessage({ kind: 'orbis-visual/stop', id: this.runningId })
        this.port.disconnect()
      } catch {
        // Already gone, which is the usual reason to be stopping.
      }
      this.port = null
    }
    this.runningId = ''
  }

  private submit(question: string, quick = ''): void {
    if (!this.able.can.includes('eyes')) {
      // Said rather than attempted. A request that cannot be served is a failure with a known cause, and the person
      // can act on "add a key in Settings" in a way they cannot act on silence.
      const why = this.able.says === '' ? fault('no-orbis') : fault('no-eyes')
      this.step({ kind: 'ask', question: question.trim().slice(0, MOST_QUESTION) || DEFAULT_QUESTION })
      this.step({ kind: 'fail', code: why.code, says: this.able.says || why.says })
      return
    }
    const words = question.trim().slice(0, MOST_QUESTION)
    this.asked = words
    this.quickKind = quick
    this.step({ kind: 'ask', question: words === '' ? DEFAULT_QUESTION : words })
  }

  // -------------------------------------------------------------- actions

  private async run(id: string): Promise<void> {
    const found = this.finding
    const rect = this.state.rect
    if (!rect) return

    if (id === 'copy') {
      const text = found ? [found.title, found.prose, found.text].filter((one) => one !== '').join('\n\n') : this.streamed
      try {
        await navigator.clipboard.writeText(text)
        this.toast('Copied.')
      } catch {
        this.toast('Orbis could not reach the clipboard.')
      }
      return
    }

    if (['identify', 'explain', 'read', 'translate', 'summarise', 'solve', 'extract'].includes(id)) {
      this.submit('', id)
      return
    }

    const page = { title: document.title, url: location.href }
    let message: Record<string, unknown> | null = null
    if (id === 'search' || id === 'similar') {
      const query = found ? searchFor(found) : null
      if (!query) {
        this.toast('There is nothing definite enough to search for.')
        return
      }
      message = { kind: 'orbis-visual/act', action: id, query }
    } else if (id === 'open') {
      if (!found?.address) return
      message = { kind: 'orbis-visual/act', action: 'open', url: found.address }
    } else if (id === 'note') {
      message = {
        kind: 'orbis-visual/act',
        action: 'note',
        title: found?.title || 'From the screen',
        body: [found?.prose ?? this.streamed, found?.text ?? '', `— ${page.title || page.url}`, page.url].filter((one) => one !== '').join('\n\n')
      }
    } else if (id === 'chat') {
      message = {
        kind: 'orbis-visual/act',
        action: 'chat',
        image: this.shot?.image ?? '',
        question: this.state.question,
        answer: found?.prose ?? this.streamed,
        title: found?.title ?? '',
        page
      }
    } else if (id === 'lab') {
      const appId = found ? labFor(found.kind) : null
      if (!appId || !found?.data) return
      /*
       * `found` rather than `kind`.
       *
       * The envelope's own `kind` is what the worker routes on, so naming the content's category `kind` as well
       * meant the category silently overwrote the routing -- the build's duplicate-key warning was the only thing
       * that said so, and the laboratory button would have reached nothing.
       */
      message = { kind: 'orbis-visual/act', action: 'lab', appId, found: found.kind, data: found.data, title: found.title }
    }
    if (!message) return

    const reply = await askWorker(message)
    if (!reply.ok) {
      this.toast(faultFrom(reply.message).says)
      return
    }
    if (id === 'note') this.toast('Kept in Notes.')
    else if (id === 'chat') {
      this.toast('Carried into the conversation.')
      this.step({ kind: 'cancel' })
    } else if (id === 'lab') {
      this.toast(`Opened ${labSays(found!.kind).replace(/^Open (the )?/i, '')}.`)
      this.step({ kind: 'cancel' })
    } else if (id === 'similar') {
      const how = (reply.data as { how?: string } | undefined)?.how
      if (how) this.toast(how)
      this.step({ kind: 'cancel' })
    } else if (id === 'search' || id === 'open') {
      this.step({ kind: 'cancel' })
    }
  }

  // -------------------------------------------------------------- drawing

  private clear(): void {
    this.frame?.remove()
    this.frame = null
    this.bar?.remove()
    this.bar = null
    this.core?.remove()
    this.core = null
  }

  private draw(): void {
    const { phase, rect } = this.state
    const live = overlaid(phase)
    this.layer.classList.toggle('live', live)
    this.layer.classList.toggle('holding', phase === 'adjusting')
    this.veil.classList.toggle('on', live)

    if (!live || !rect) {
      this.veil.style.removeProperty('clip-path')
      this.clear()
      return
    }

    const r = normalise(rect)
    // One element with a hole in it: the selected pixels are untouched, so what is on screen is what is sent.
    this.veil.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${r.x}px ${r.y}px, ${r.x}px ${r.y + r.height}px, ${r.x + r.width}px ${r.y + r.height}px, ${r.x + r.width}px ${r.y}px, ${r.x}px ${r.y}px)`

    this.drawFrame(r)
    this.drawCore(r)
    if (phase === 'selecting' || phase === 'adjusting') {
      this.bar?.remove()
      this.bar = null
    } else {
      this.drawBar(r)
    }
  }

  private drawFrame(r: Rect): void {
    if (!this.frame) {
      this.frame = el('div', 'frame')
      this.layer.append(this.frame)
      const grip = el('div', 'grip')
      this.frame.append(grip)
      for (const corner of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
        const node = el('div', `corner ${corner}`)
        node.dataset.corner = corner
        this.frame.append(node)
      }
    }
    this.frame.classList.toggle('holding', this.state.phase === 'adjusting')
    Object.assign(this.frame.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })

    const grip = this.frame.querySelector('.grip') as HTMLElement | null
    if (grip) Object.assign(grip.style, { left: '0', top: '0', width: '100%', height: '100%' })
    for (const node of this.frame.querySelectorAll('.corner')) {
      const corner = (node as HTMLElement).dataset.corner as Corner
      const at = cornerAt({ x: 0, y: 0, width: r.width, height: r.height }, corner)
      const place = node as HTMLElement
      place.style.left = `${corner === 'nw' || corner === 'sw' ? at.x - 1 : at.x - 13}px`
      place.style.top = `${corner === 'nw' || corner === 'ne' ? at.y - 1 : at.y - 13}px`
      // The handles only exist once there is a selection to adjust.
      place.style.display = this.state.phase === 'selecting' ? 'none' : ''
    }

    // The size, while it is being drawn. One number that genuinely helps during a drag.
    let size = this.layer.querySelector('.size') as HTMLElement | null
    if (this.state.phase === 'selecting' || this.state.phase === 'adjusting') {
      if (!size) {
        size = el('div', 'size')
        this.layer.append(size)
      }
      size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`
      const below = r.y + r.height + 6
      size.style.left = `${Math.min(r.x, window.innerWidth - 90)}px`
      size.style.top = `${below + 22 > window.innerHeight ? Math.max(r.y - 22, 4) : below}px`
    } else size?.remove()

    // The scanning band, while Orion is looking.
    let scan = this.layer.querySelector('.scan') as HTMLElement | null
    if (this.state.phase === 'analysing') {
      if (!scan) {
        scan = el('div', 'scan')
        scan.append(el('i'))
        this.layer.append(scan)
      }
      Object.assign(scan.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
    } else scan?.remove()
  }

  private drawCore(r: Rect): void {
    if (!this.core) {
      this.core = el('div', 'core')
      this.layer.append(this.core)
    }
    const phase = this.state.phase
    this.core.className = `core${phase === 'capturing' ? ' scanning' : ''}${phase === 'analysing' ? ' thinking' : ''}${phase === 'failed' ? ' failed' : ''}${phase === 'answered' ? ' done' : ''}`
    this.core.style.left = `${r.x + r.width - 5}px`
    this.core.style.top = `${r.y - 5}px`
  }

  /** Where the bar goes: never over the selection, never off the window. The same arithmetic the selection orb uses. */
  private place(node: HTMLElement, r: Rect): void {
    const height = Math.min(node.offsetHeight || 120, window.innerHeight - 24)
    const placed = placePanel(
      { x: r.x + r.width, y: r.y, width: 0, height: 0 },
      r,
      { width: BAR_WIDTH, height },
      { width: window.innerWidth, height: window.innerHeight }
    )
    node.style.left = `${placed.x}px`
    node.style.top = `${placed.y}px`
    node.classList.toggle('from-above', placed.from === 'above')
  }

  private drawBar(r: Rect): void {
    const fresh = !this.bar
    if (!this.bar) {
      this.bar = el('div', 'bar')
      this.bar.setAttribute('role', 'dialog')
      this.bar.setAttribute('aria-label', 'Orbis Visual Search')
      this.layer.append(this.bar)
      this.bar.addEventListener('keydown', (event) => this.onBarKey(event))
    }
    const bar = this.bar
    const input = bar.querySelector('input.ask') as HTMLInputElement | null
    const kept = input?.value ?? ''
    bar.replaceChildren()

    bar.append(this.askRow(kept))
    const body = this.body()
    if (body) bar.append(body)
    const list = this.offer()
    bar.append(this.actionRow(list))

    const says = this.quietLine(list)
    if (says) bar.append(says)

    this.place(bar, r)
    if (fresh) window.requestAnimationFrame(() => this.bar && this.place(this.bar, normalise(this.state.rect ?? r)))
  }

  private askRow(kept: string): HTMLElement {
    const row = el('div', 'row')
    const mark = el('div', 'mark')
    mark.append(el('b'))
    row.append(mark)

    const input = el('input', 'ask') as HTMLInputElement
    input.type = 'text'
    input.placeholder = 'Ask Orion about this…'
    input.setAttribute('aria-label', 'Ask Orion about what you selected')
    input.maxLength = MOST_QUESTION
    input.value = kept
    input.spellcheck = false
    input.autocomplete = 'off'
    row.append(input)

    const working = this.state.phase === 'capturing' || this.state.phase === 'analysing'
    if (working) {
      const stop = el('button', 'shut')
      stop.type = 'button'
      stop.setAttribute('aria-label', 'Stop')
      const mark2 = svg('stop') ?? svg('close')
      if (mark2) stop.append(mark2)
      else stop.textContent = '×'
      stop.addEventListener('click', () => this.step({ kind: 'cancel' }))
      row.append(stop)
    } else {
      const go = el('button', 'go')
      go.type = 'button'
      go.setAttribute('aria-label', 'Ask')
      const arrow = svg('forward') ?? svg('chevronRight')
      if (arrow) go.append(arrow)
      else go.textContent = '→'
      go.disabled = !this.able.can.includes('eyes')
      go.addEventListener('click', () => this.submit(input.value))
      row.append(go)
    }

    const shut = el('button', 'shut')
    shut.type = 'button'
    shut.setAttribute('aria-label', 'Close Visual Search')
    const cross = svg('close')
    if (cross) shut.append(cross)
    else shut.textContent = '×'
    shut.addEventListener('click', () => this.step({ kind: 'cancel' }))
    row.append(shut)
    return row
  }

  /** The middle of the bar: what it is doing, what it found, or what went wrong. */
  private body(): HTMLElement | null {
    const phase = this.state.phase
    if (phase === 'capturing' || (phase === 'analysing' && this.streamed === '')) {
      const doing = el('div', 'doing')
      doing.append(el('span', 'dot'))
      doing.append(el('span', undefined, phase === 'capturing' ? 'Taking the picture…' : this.statusLine || 'Looking at what you selected…'))
      const stop = el('button', 'stop', 'Stop')
      stop.type = 'button'
      stop.addEventListener('click', () => this.step({ kind: 'cancel' }))
      doing.append(stop)
      return doing
    }
    if (phase === 'failed') return this.wrongBlock()
    if (phase === 'analysing' || phase === 'answered') return this.foundBlock()
    return null
  }

  private wrongBlock(): HTMLElement {
    const failure = this.state.failure
    const known = failure ? fault(failure.code as never) : fault('action-failed')
    const wrong = el('div', 'wrong')
    const why = el('div', 'why')
    const warn = svg('alert')
    if (warn) why.append(warn)
    why.append(el('span', undefined, 'Could not do that'))
    wrong.append(why)
    wrong.append(el('p', undefined, failure?.says ?? known.says))

    const row = el('div', 'acts')
    row.style.borderTop = 'none'
    row.style.padding = '0'
    const offers = failure ? fault(failure.code as never).offer : []
    if (offers.includes('retry')) {
      const retry = el('button', 'act lead', 'Try again')
      retry.type = 'button'
      retry.addEventListener('click', () => this.step({ kind: 'retry' }))
      row.append(retry)
    }
    if (offers.includes('reselect')) {
      const again = el('button', 'act', 'Select again')
      again.type = 'button'
      again.addEventListener('click', () => this.step({ kind: 'reselect' }))
      row.append(again)
    }
    const close = el('button', 'act', 'Close')
    close.type = 'button'
    close.addEventListener('click', () => this.step({ kind: 'cancel' }))
    row.append(close)
    wrong.append(row)
    return wrong
  }

  private foundBlock(): HTMLElement {
    const found = this.finding
    const block = el('div', 'found')
    const head = el('div', 'head')

    if (this.shot) {
      const thumb = el('img', `thumb${this.zoomed ? ' big' : ''}`) as HTMLImageElement
      thumb.src = this.shot.image
      thumb.alt = 'What you selected'
      thumb.addEventListener('click', () => {
        this.zoomed = !this.zoomed
        this.drawAnswer()
      })
      // A page with a strict `img-src` can refuse to render it. Taken out rather than left as a broken-image box,
      // which would read as Orbis having failed at something when only the preview is missing.
      thumb.addEventListener('error', () => thumb.remove())
      head.append(thumb)
    }

    const about = el('div', 'about')
    about.append(el('div', 'title', found?.title || (this.answered ? 'Looked at' : 'Reading…')))
    const line = el('div', 'kind')
    const facts = kindFacts(found?.kind ?? 'unknown')
    line.append(el('span', undefined, facts.label))
    const sure = surenessSays(found?.sure ?? null)
    if (sure !== '') {
      line.append(el('span', undefined, '·'))
      line.append(el('span', `sure${found?.sure === 'low' ? ' low' : ''}`, sure))
    }
    about.append(line)
    head.append(about)
    block.append(head)

    const prose = el('div', 'prose')
    prose.textContent = found ? found.prose : this.streamed
    if (!this.answered) prose.append(el('span', 'caret'))
    block.append(prose)

    if (found?.details.length) {
      const list = el('ul', 'details')
      for (const one of found.details) list.append(el('li', undefined, one))
      block.append(list)
    }

    if (found?.text) {
      const words = el('div', 'words')
      words.textContent = found.text
      words.setAttribute('aria-label', 'The words read out of the selection')
      block.append(words)
    }

    if (found?.address) {
      const address = el('div', 'address')
      const label = el('span', undefined, 'Address found:')
      const code = el('code', undefined, found.address)
      address.append(label, code)
      block.append(address)
    }

    if (this.answered && found?.ask.length) {
      const next = el('div', 'next')
      for (const question of found.ask) {
        const button = el('button', 'ask-next', question)
        button.type = 'button'
        button.addEventListener('click', () => this.submit(question))
        next.append(button)
      }
      block.append(next)
    }
    return block
  }

  /** What can be done with this selection right now. Worked out once per draw and shared by the row and the note. */
  private offer(): ReturnType<typeof visualActions> {
    const found = this.finding
    return visualActions({
      kind: found?.kind ?? 'unknown',
      can: this.able.can,
      structured: Boolean(found?.data),
      address: Boolean(found?.address),
      answered: this.answered,
      risky: this.riskyNow
    })
  }

  private actionRow(list: ReturnType<typeof visualActions>): HTMLElement {
    const found = this.finding
    const row = el('div', 'acts')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', 'What to do with this')
    for (const [at, action] of list.actions.entries()) {
      const button = el('button', `act${at === 0 ? ' lead' : ''}`)
      button.type = 'button'
      button.title = action.says
      button.setAttribute('aria-label', action.says)
      const mark = svg(action.icon)
      if (mark) button.append(mark)
      button.append(el('span', undefined, action.id === 'lab' && found ? labSays(found.kind) : action.label))
      button.addEventListener('click', () => void this.run(action.id))
      row.append(button)
    }
    if (list.actions.length === 0) {
      row.append(el('span', 'model', list.says || 'Nothing can be done with this just now.'))
    }
    return row
  }

  private quietLine(list: ReturnType<typeof visualActions>): HTMLElement | null {
    const lines: string[] = []
    if (list.says) lines.push(list.says)
    if (this.answered && this.able.model) lines.push(`Looked at by ${this.able.model}.`)
    if (lines.length === 0) return null
    const note = el('div', `note${list.says && !this.able.can.includes('eyes') ? ' warn' : ''}`)
    note.textContent = lines.join(' ')
    return note
  }

  /** Redraw only the parts that change while an answer streams, so the bar does not jump under the pointer. */
  private drawAnswer(): void {
    if (!this.bar || !this.state.rect) return
    this.drawBar(normalise(this.state.rect))
  }

  private focusInput(): void {
    const input = this.bar?.querySelector('input.ask') as HTMLInputElement | null
    input?.focus()
  }

  private onBarKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.step({ kind: 'cancel' })
      return
    }
    const input = event.target as HTMLElement | null
    if (event.key === 'Enter' && input instanceof HTMLInputElement) {
      event.preventDefault()
      event.stopPropagation()
      this.submit(input.value)
      return
    }
    if (event.key === 'Tab') {
      // Kept inside the bar: tabbing out of it and into the page would leave the overlay up with the focus behind it.
      const focusable = [...(this.bar?.querySelectorAll('input, button') ?? [])] as HTMLElement[]
      if (focusable.length === 0) return
      const at = focusable.indexOf(document.activeElement as HTMLElement)
      const to = event.shiftKey ? at - 1 : at + 1
      if (to < 0 || to >= focusable.length) {
        event.preventDefault()
        focusable[to < 0 ? focusable.length - 1 : 0].focus()
      }
    }
  }

  // -------------------------------------------------------------- the small things

  private toast(words: string): void {
    this.toastNode?.remove()
    const node = el('div', 'toast', words)
    node.setAttribute('role', 'status')
    this.layer.append(node)
    this.toastNode = node
    const r = this.state.rect ? normalise(this.state.rect) : { x: 20, y: 20, width: 0, height: 0 }
    node.style.left = `${Math.min(r.x, window.innerWidth - 340)}px`
    node.style.top = `${Math.min(r.y + r.height + 8, window.innerHeight - 50)}px`
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      node.remove()
      if (this.toastNode === node) this.toastNode = null
    }, 2600)
  }

  /**
   * The first-use hint: one line, once.
   *
   * Not a modal, not over the page's own content, and gone the moment it is used or dismissed. Shown at most once per
   * installation, which is what the stored flag is for -- a hint that comes back is an advertisement.
   */
  private async maybeHint(): Promise<void> {
    if (this.hintNode) return
    let seen = true
    try {
      seen = (await chrome.storage.local.get('orbis.visual.hinted'))['orbis.visual.hinted'] === true
    } catch {
      seen = true
    }
    if (seen) return
    const hint = el('div', 'hint')
    const key = this.modifier === 'Meta' ? 'Cmd' : 'Ctrl'
    const strong = el('b', undefined, `Hold ${key} and drag`)
    hint.append(strong, el('span', undefined, 'to ask Orion about anything you can see.'))
    const shut = el('button', 'shut')
    shut.type = 'button'
    shut.setAttribute('aria-label', 'Dismiss')
    const cross = svg('close')
    if (cross) shut.append(cross)
    else shut.textContent = '×'
    const away = (): void => {
      hint.remove()
      this.hintNode = null
      void chrome.storage.local.set({ 'orbis.visual.hinted': true }).catch(() => undefined)
    }
    shut.addEventListener('click', away)
    hint.append(shut)
    this.layer.append(hint)
    this.hintNode = hint
    // The layer does not take the pointer while idle, so the hint takes it for itself.
    hint.style.pointerEvents = 'auto'
    window.setTimeout(away, 12_000)
  }

  destroy(): void {
    for (const off of this.listeners) off()
    this.listeners.length = 0
    this.stopAsking()
    window.clearTimeout(this.toastTimer)
    this.releasePointer()
    this.host.remove()
  }
}

/*
 * Started once, in the top frame, on a real web page.
 *
 * The top frame only, for the reason in the file's opening note. And never on Orbis's own pages: they have their own
 * surfaces, and a selection overlay on top of the panel would be two Orbis interfaces arguing over the same pointer.
 */
if (window.top === window && /^https?:$/.test(location.protocol)) {
  const search = new VisualSearch()
  window.addEventListener('pagehide', () => search.destroy(), { once: true })
}
