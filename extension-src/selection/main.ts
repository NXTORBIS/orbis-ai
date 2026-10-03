import { icon } from '../../orbis-ui/panel/rail/icons.js'
import { buildPalette, selectionAction, type SelectionAction, type SelectionNeed } from '../../src/shared/selectionActions.ts'
import { lastLine, placeOrb, placePanel, selectionBounds, stillVisible, type Rect } from '../../src/shared/selectionPlacement.ts'
import { REWRITE_TONES, TRANSLATE_INTO } from '../../src/shared/selectionPrompts.ts'
import { buildShare, shareSaid, shareText } from '../../src/shared/selectionShare.ts'
import { readSelection, selectionPreview, RISK_REASON, type SelectionReading } from '../../src/shared/selectionText.ts'
import { SELECTION_STYLES } from './styles.ts'

/**
 * The orb that appears when you select something on a page.
 *
 * Select a few words and a small Orbis orb appears at the end of them; click it and the things worth doing with that
 * text appear -- explaining it, looking it up, keeping it, opening it. What appears depends on what was selected, and
 * every one of them runs a real part of Orbis rather than a copy of one.
 *
 * This file is only the part that lives on the page: watching for a selection, drawing the orb, drawing the palette,
 * and showing the answer. It decides nothing. What a selection *is* and which actions that earns are worked out in
 * src/shared (selectionText, selectionActions, selectionPlacement), where they can be tested without a browser; what
 * an action actually *does* happens in the extension's worker, which is the only side that can reach Orbis.
 *
 * Four things it is careful about, each of which was a way to get this wrong:
 *
 * **The page cannot touch any of it.** Everything is in a closed shadow root inside this frame's isolated world. A
 * page can neither read what was selected through Orbis, nor style the orb, nor cover it with an invisible layer and
 * take the clicks, nor call anything here from its own scripts.
 *
 * **The selection is taken a copy of before anything else happens.** Clicking the orb moves the focus, and the
 * browser may drop the native selection when it does. Every action is given the copy taken the moment the orb
 * appeared, so what runs is always what was selected and never what happens to be selected now.
 *
 * **It stays out of the way.** Nothing appears while the mouse is still down, nothing appears for a stray click,
 * nothing appears inside a password box, and the whole thing is gone the moment the selection is.
 *
 * **Nothing sensitive leaves.** A selection that looks like a key, a token or a card number loses every action that
 * would send it anywhere, and the palette says why.
 */

const ORB_SIZE = 18
const PANEL_WIDTH = 268
/** Long enough that dragging through a paragraph does not flicker; short enough not to feel slow. */
const SETTLE_MS = 180

type Need = SelectionNeed

interface Snapshot {
  readonly reading: SelectionReading
  readonly rects: readonly Rect[]
  readonly url: string
  readonly title: string
  readonly at: number
}

const asRect = (r: DOMRect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height })

/** The window this frame can draw in. Insets are left at nothing: inside a page, the page's box is the whole room. */
const room = (): { width: number; height: number } => ({ width: window.innerWidth, height: window.innerHeight })

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Whether the selection is inside something Orbis must not read. */
function inSecretField(selection: Selection | null): boolean {
  const node = selection?.anchorNode ?? null
  const start = node instanceof Element ? node : node?.parentElement
  for (let at: Element | null = start ?? null; at; at = at.parentElement) {
    if (at instanceof HTMLInputElement && (at.type === 'password' || at.autocomplete.includes('one-time-code') || at.autocomplete.includes('cc-'))) return true
  }
  const active = document.activeElement
  return active instanceof HTMLInputElement && active.type === 'password'
}

/** An editor the person is typing in: the orb still appears, but it must never take the caret away. */
function inEditor(selection: Selection | null): boolean {
  const node = selection?.anchorNode ?? null
  const start = node instanceof Element ? node : node?.parentElement
  return start?.closest('[contenteditable=""], [contenteditable="true"], textarea, input') != null
}

// ---------------------------------------------------------------- talking to Orbis

type WorkerReply = { ok: true; data?: unknown } | { ok: false; message: string }

function askWorker(message: Record<string, unknown>): Promise<WorkerReply> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply: WorkerReply | undefined) => {
        const failed = chrome.runtime.lastError
        resolve(failed || !reply ? { ok: false, message: failed?.message ?? 'Orbis did not answer.' } : reply)
      })
    } catch {
      resolve({ ok: false, message: 'Orbis is not running.' })
    }
  })
}

// ---------------------------------------------------------------- the surface

class SelectionOrb {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private readonly layer: HTMLElement
  private orb: HTMLButtonElement | null = null
  private panel: HTMLElement | null = null
  private toastNode: HTMLElement | null = null
  private snapshot: Snapshot | null = null
  /** What Orbis can do right now. Empty until the worker says otherwise: never assumed. */
  private can: Need[] = []
  private settle = 0
  private pointerDown = false
  private running: { port: chrome.runtime.Port; id: string } | null = null
  private readonly listeners: (() => void)[] = []

  constructor() {
    this.host = document.createElement('orbis-selection')
    // Closed: the page cannot reach inside, even knowing the element is there.
    this.root = this.host.attachShadow({ mode: 'closed' })
    const sheet = document.createElement('style')
    sheet.textContent = SELECTION_STYLES
    this.layer = el('div', 'layer')
    this.root.append(sheet, this.layer)
    this.watch()
  }

  // ---------------------------------------------------------------- watching

  private on<T extends keyof DocumentEventMap>(target: Document | Window, type: T, run: (event: DocumentEventMap[T]) => void, options?: AddEventListenerOptions): void {
    const handler = run as EventListener
    target.addEventListener(type, handler, options)
    this.listeners.push(() => target.removeEventListener(type, handler, options))
  }

  private watch(): void {
    this.on(document, 'selectionchange', () => this.selectionChanged())
    this.on(document, 'pointerdown', (event) => {
      this.pointerDown = true
      if (!this.ours(event.target)) this.dismiss()
    })
    this.on(document, 'pointerup', () => {
      this.pointerDown = false
      this.selectionChanged()
    })
    this.on(document, 'keydown', (event) => {
      if (event.key === 'Escape' && (this.panel || this.orb)) {
        // Only ours. The page's own Escape handling is left alone when nothing of Orbis's is open.
        if (this.panel) {
          this.closePanel()
          event.stopPropagation()
        } else {
          this.dismiss()
        }
      }
    })
    this.on(window, 'scroll' as keyof DocumentEventMap, () => this.reposition(), { capture: true, passive: true } as AddEventListenerOptions)
    this.on(window, 'resize' as keyof DocumentEventMap, () => this.reposition())
    this.on(document, 'visibilitychange', () => {
      // A tab that is no longer in front must not leave its orb lying over the one that is.
      if (document.hidden) this.dismiss()
    })
    window.addEventListener('pagehide', () => this.destroy(), { once: true })
  }

  private ours(target: EventTarget | null): boolean {
    return target instanceof Node && this.host.contains(target)
  }

  private selectionChanged(): void {
    window.clearTimeout(this.settle)
    this.settle = window.setTimeout(() => this.settled(), SETTLE_MS)
  }

  /**
   * The selection has stopped changing.
   *
   * Nothing is drawn while the pointer is still down, which is what stops the orb flickering along behind the cursor
   * as somebody drags through a paragraph.
   */
  private settled(): void {
    if (this.pointerDown) return
    const selection = document.getSelection()
    const raw = selection?.toString() ?? ''
    if (raw.trim() === '') {
      /*
       * The orb belongs to the selection; the panel does not.
       *
       * An open answer is not taken away by the selection going -- people click into an answer to read it, and
       * clicking is what clears the selection. The orb is not an answer, so it goes with the words it was about.
       * These used to be one decision, which meant an open panel kept the orb alive over a selection that no longer
       * existed, pointing at nothing.
       */
      this.orb?.remove()
      this.orb = null
      if (!this.panel) this.dismiss()
      return
    }
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rects = range ? [...range.getClientRects()].map(asRect) : []
    if (rects.length === 0) return

    const reading = readSelection(raw, { inPasswordField: inSecretField(selection) })
    const fresh: Snapshot = { reading, rects, url: location.href, title: document.title, at: Date.now() }
    // The same words in the same place: leave what is already there rather than redrawing it under the pointer.
    if (this.snapshot && this.snapshot.reading.raw === raw && this.panel) return
    this.snapshot = fresh
    if (this.panel) this.closePanel()
    this.showOrb()
  }

  // ---------------------------------------------------------------- the orb

  private mounted(): void {
    if (!this.host.isConnected) (document.body ?? document.documentElement).append(this.host)
  }

  private showOrb(): void {
    const shot = this.snapshot
    if (!shot) return
    this.mounted()
    const line = lastLine(shot.rects)
    if (!line) return
    const at = placeOrb(line, ORB_SIZE, room())

    if (!this.orb) {
      const button = el('button', 'orb')
      button.type = 'button'
      button.setAttribute('aria-label', 'Orbis actions for the selected text')
      button.append(icon('spark', 11))
      // Down, not click: taking the pointer before the browser clears the selection keeps the words highlighted.
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        void this.openPalette()
      })
      this.orb = button
      this.layer.append(button)
    }
    this.orb.style.left = `${at.x}px`
    this.orb.style.top = `${at.y}px`
  }

  private reposition(): void {
    const shot = this.snapshot
    if (!shot || !this.orb) return
    // The rectangles were taken before the page moved, so they are measured again from the live selection.
    const selection = document.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rects = range ? [...range.getClientRects()].map(asRect) : shot.rects
    const whole = selectionBounds(rects)
    if (!whole || !stillVisible(whole, room())) {
      this.dismiss()
      return
    }
    const line = lastLine(rects)
    if (line) {
      const at = placeOrb(line, ORB_SIZE, room())
      this.orb.style.left = `${at.x}px`
      this.orb.style.top = `${at.y}px`
    }
    if (this.panel) this.placeThePanel(whole)
  }

  private placeThePanel(whole: Rect): void {
    if (!this.panel || !this.orb) return
    const anchor = asRect(this.orb.getBoundingClientRect())
    /*
     * Measured with the cap taken off first.
     *
     * The panel is measured to find out how tall it wants to be, and it was being measured while still wearing the
     * cap from the last time -- so it reported the cap back as its wish, and an answer arriving into it had nowhere
     * to go. The first line of the answer appeared and the rest of it had no room at all.
     */
    /*
     * Width first, then measure, then cap.
     *
     * All three in that order, and each one for a reason that cost a bug. The width goes on before measuring, because
     * a panel with no width set shrink-wraps to its content and measures as though every line were one line -- the
     * two-line warning about a secret measured as one, and its second line ended up below the panel's bottom edge.
     * The cap comes off before measuring, or the panel reports the last cap back as its wish and an answer arriving
     * into it has nowhere to go. And the real height is taken rather than the scroll height, which leaves out the
     * panel's own bottom padding.
     */
    const width = Math.min(PANEL_WIDTH, room().width - 16)
    this.panel.style.width = `${width}px`
    this.panel.style.maxHeight = ''
    /*
     * The larger of what it measures and what it contains.
     *
     * The panel clips what overflows it, so once it has been given a height it will happily report that height as its
     * own and swallow the last row -- which it did, cutting "More" in half. Its scroll height plus its own padding is
     * what it actually needs; the rectangle is what it currently is. Taking the larger is right in both directions.
     */
    const pad = 14
    const natural = Math.max(Math.ceil(this.panel.getBoundingClientRect().height), this.panel.scrollHeight + pad)
    const wanted = { width, height: Math.min(420, natural + 2) }
    const at = placePanel(anchor, whole, wanted, room())
    this.panel.style.left = `${at.x}px`
    this.panel.style.top = `${at.y}px`
    this.panel.style.maxHeight = `${at.height}px`
    this.panel.dataset.from = at.from
  }

  // ---------------------------------------------------------------- the palette

  private async openPalette(): Promise<void> {
    const shot = this.snapshot
    if (!shot) return
    if (this.can.length === 0) {
      const reply = await askWorker({ kind: 'orbis-selection/can' })
      this.can = reply.ok && Array.isArray((reply as { data?: unknown }).data) ? ((reply as { data: Need[] }).data ?? []) : []
    }
    this.drawPalette()
  }

  /**
   * Gives everything in the panel its place in the order, so it arrives top to bottom the way an eye reads it.
   *
   * Done once after the panel is filled rather than by each caller counting as it goes: the order is a property of
   * the finished list, and anything that forgot to count would simply arrive first.
   */
  private stagger(panel: HTMLElement): void {
    const parts = [...panel.children].filter((node): node is HTMLElement => node instanceof HTMLElement)
    parts.forEach((node, at) => node.style.setProperty('--i', String(Math.min(at, 8))))
  }

  private freshPanel(): HTMLElement {
    this.closePanel()
    const panel = el('div', 'panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'What to do with the selected text')
    panel.addEventListener('pointerdown', (event) => event.stopPropagation())
    this.panel = panel
    this.layer.append(panel)
    return panel
  }

  private drawPalette(back?: () => void): void {
    const shot = this.snapshot
    if (!shot) return
    const palette = buildPalette({ reading: shot.reading, available: this.can, ownLanguage: ownLanguage(), top: 4 })
    const panel = this.freshPanel()

    if (this.can.length === 0) {
      panel.append(note('Orbis is not running, so there is nothing it can do with this yet.', 'warn'))
      this.placeThePanel(selectionBounds(shot.rects) ?? shot.rects[0]!)
      return
    }

    /*
     * Why the list is short.
     *
     * Without a key for Orion there is no explaining, summarising or asking -- only the things the browser itself
     * does. Saying so is the difference between a palette that looks broken and one that is telling the truth about
     * what this Orbis can do.
     */
    if (!this.can.includes('orion')) {
      panel.append(note('Orion has no API key in this Orbis, so it cannot explain, summarise or answer. The rest still works.', 'warn'))
    }

    /*
     * A line of the text this is about.
     *
     * The panel can open over a long page after the selection has scrolled out of sight, and "Explain" means nothing
     * without "explain what". It is also the thread back to the orb: the same accent bar, in the same place.
     */
    panel.append(aboutLine(selectionPreview(shot.reading.raw, 110)))

    const ask = palette.top.find((one) => one.id === 'ask') ?? palette.more.find((one) => one.id === 'ask')
    if (ask) {
      const box = el('input', 'ask')
      box.type = 'text'
      box.placeholder = 'Ask anything…'
      box.setAttribute('aria-label', 'Ask Orion about the selected text')
      box.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const typed = box.value.trim()
        if (typed !== '') void this.run(ask, typed)
      })
      panel.append(box)
      // Focus goes to the box, except where the person is typing on the page and the caret is theirs to keep.
      if (!inEditor(document.getSelection())) window.setTimeout(() => box.focus(), 0)
    }

    const rows = palette.top.filter((one) => one.id !== 'ask')
    for (const one of rows) panel.append(this.actionRow(one))

    const rest = palette.more.filter((one) => one.id !== 'ask')
    if (rest.length > 0) {
      panel.append(el('div', 'rule'))
      panel.append(
        this.row('layers', 'More', '›', () => {
          const more = this.freshPanel()
          more.append(this.row('globe', 'Back', '', () => this.drawPalette(back), 'Back to the first actions'))
          more.append(el('div', 'rule'))
          for (const one of rest) more.append(this.actionRow(one))
          this.stagger(more)
          this.placeThePanel(selectionBounds(shot.rects) ?? shot.rects[0]!)
        })
      )
    }

    if (palette.withheld) {
      panel.append(el('div', 'rule'))
      panel.append(note(RISK_REASON[palette.withheld as keyof typeof RISK_REASON] ?? 'Orbis will not send this anywhere.', 'warn'))
    }

    if (back) {
      panel.append(el('div', 'rule'))
      panel.append(this.row('globe', 'Back', '', back))
    }

    this.stagger(panel)
    this.placeThePanel(selectionBounds(shot.rects) ?? shot.rects[0]!)
    panel.querySelector<HTMLElement>('.ask, .row')?.focus()
  }

  private actionRow(one: SelectionAction): HTMLElement {
    // The two that need a choice first open a second list rather than guessing which tone or language was meant.
    if (one.id === 'rewrite') return this.row(one.icon, one.label, '›', () => this.chooseThen(one, REWRITE_TONES.map((t) => ({ id: t.ask, label: t.label }))), one.hint)
    if (one.id === 'translate') return this.row(one.icon, one.label, '›', () => this.chooseThen(one, TRANSLATE_INTO.map((t) => ({ id: `Translate it into ${t.label}.`, label: t.label }))), one.hint)
    return this.row(one.icon, one.label, '', () => void this.run(one), one.hint)
  }

  private chooseThen(one: SelectionAction, choices: readonly { id: string; label: string }[]): void {
    const shot = this.snapshot
    if (!shot) return
    const panel = this.freshPanel()
    panel.append(note(one.label, 'plain'))
    for (const choice of choices) panel.append(this.row(one.icon, choice.label, '', () => void this.run(one, choice.id)))
    panel.append(el('div', 'rule'))
    panel.append(this.row('globe', 'Back', '', () => this.drawPalette()))
    this.stagger(panel)
    this.placeThePanel(selectionBounds(shot.rects) ?? shot.rects[0]!)
    panel.querySelector<HTMLElement>('.row')?.focus()
  }

  private row(iconName: string, label: string, mark: string, run: () => void, hint?: string): HTMLElement {
    const button = el('button', 'row')
    button.type = 'button'
    if (hint) button.title = hint
    button.append(icon(iconName, 15))
    button.append(el('span', 'label', label))
    if (mark) button.append(el('span', 'more-mark', mark))
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      run()
    })
    button.addEventListener('keydown', (event) => this.arrows(event))
    return button
  }

  /** Up and down move between the rows, so the whole thing works without a mouse. */
  private arrows(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...(this.panel?.querySelectorAll<HTMLElement>('.ask, .row') ?? [])]
    const at = rows.indexOf(event.currentTarget as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length
    rows[next]?.focus()
  }

  // ---------------------------------------------------------------- running one

  private async run(action: SelectionAction, extra?: string): Promise<void> {
    const shot = this.snapshot
    if (!shot) return
    // Pressing the same thing twice must not start it twice.
    if (this.running) return

    if (action.surface === 'panel') {
      this.stream(action, shot, extra)
      return
    }

    /*
     * The two the clipboard does, done here rather than through the helper.
     *
     * The clipboard belongs to the page, not to the helper, and routing these through it meant they reached the
     * helper's list of things it knows how to run, found nothing, and threw -- which is what "Copy" did. Doing them
     * here also means they still work when Orbis itself is not running, which is exactly when somebody wants to keep
     * hold of something they are reading.
     */
    if (action.id === 'copy' || action.id === 'share') {
      const built = buildShare({ text: shot.reading.raw, title: shot.title, url: shot.url })
      const text = action.id === 'copy' ? shot.reading.raw : shareText(built.payload)
      const ok = await this.copy(text)
      this.closePanel()
      // "Copied", never "Shared": nothing left this computer, and saying otherwise is the one thing this must not do.
      this.toast(ok ? (action.id === 'copy' ? 'Copied' : shareSaid('copied', built.shortened)) : shareSaid('failed'), ok ? 'good' : 'bad')
      if (ok) this.dismiss()
      return
    }

    const reply = await askWorker({
      kind: 'orbis-selection/do',
      action: action.id,
      text: shot.reading.raw,
      url: shot.url,
      title: shot.title,
      extra: extra ?? ''
    })
    if (action.surface === 'browser') {
      reply.ok ? this.dismiss() : this.toast(reply.message, 'bad')
      return
    }
    this.closePanel()
    this.toast(reply.ok ? said(action.id) : reply.message, reply.ok ? 'good' : 'bad')
    if (reply.ok) this.dismiss()
  }

  /**
   * An answer, as it arrives.
   *
   * The selection is taken from the copy made when the orb appeared, never from the page as it is now -- so an answer
   * started before somebody clicked elsewhere is still an answer about what they selected.
   */
  private stream(action: SelectionAction, shot: Snapshot, extra?: string): void {
    const panel = this.freshPanel()
    const head = el('div', 'head')
    const live = el('span', 'live')
    live.setAttribute('aria-hidden', 'true')
    head.append(live, el('span', 'what', action.label))
    const shut = el('button', 'icon-btn')
    shut.type = 'button'
    shut.title = 'Close'
    shut.setAttribute('aria-label', 'Close')
    shut.append(icon('close', 14))
    shut.addEventListener('click', () => {
      this.cancel()
      this.closePanel()
    })
    head.append(shut)
    panel.append(head)
    panel.append(el('p', 'quoted', selectionPreview(shot.reading.raw)))

    const answer = el('div', 'answer')
    answer.setAttribute('role', 'status')
    answer.setAttribute('aria-live', 'polite')
    const waiting = composing()
    answer.append(waiting)
    panel.append(answer)

    const feet = el('div', 'feet')
    const stopChip = el('button', 'chip', 'Stop')
    stopChip.type = 'button'
    stopChip.dataset.kind = 'stop'
    stopChip.addEventListener('click', () => this.cancel())
    feet.append(stopChip, el('span', 'spacer'))
    panel.append(feet)
    this.placeThePanel(selectionBounds(shot.rects) ?? shot.rects[0]!)

    let text = ''
    const id = `sel${Date.now()}`
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connect({ name: 'orbis-selection' })
    } catch {
      answer.textContent = 'Orbis is not running.'
      answer.dataset.state = 'failed'
      stopChip.remove()
      return
    }
    this.running = { port, id }

    const done = (failed?: string): void => {
      this.running = null
      waiting.remove()
      // The lit dot is only true while something is arriving, so it goes the moment nothing is.
      live.remove()
      stopChip.remove()
      if (failed !== undefined) {
        answer.textContent = failed
        answer.dataset.state = 'failed'
        const retry = el('button', 'chip', 'Try again')
        retry.type = 'button'
        retry.addEventListener('click', () => this.stream(action, shot, extra))
        feet.prepend(retry)
        return
      }
      if (text.trim() === '') {
        answer.textContent = 'Orion had nothing to say about this.'
        return
      }
      const copy = el('button', 'chip', 'Copy')
      copy.type = 'button'
      copy.addEventListener('click', () => void this.copy(text).then((ok) => this.toast(ok ? 'Copied' : 'Could not copy', ok ? 'good' : 'bad')))
      const keep = el('button', 'chip', 'Save')
      keep.type = 'button'
      keep.addEventListener('click', () => void this.keepAnswer(action, shot, text))
      feet.prepend(copy, keep)
    }

    port.onMessage.addListener((message: { id?: string; chunk?: string; done?: boolean; failed?: string }) => {
      if (message.id !== id) return
      if (typeof message.chunk === 'string') {
        text += message.chunk
        answer.textContent = text
        answer.append(waiting)
        answer.scrollTop = answer.scrollHeight
        this.placeThePanel(selectionBounds(shot.rects) ?? shot.rects[0]!)
      }
      if (message.failed !== undefined) done(message.failed)
      else if (message.done) done()
    })
    port.onDisconnect.addListener(() => {
      if (this.running?.id === id) done('Orbis stopped answering.')
    })
    port.postMessage({ kind: 'orbis-selection/ask', id, action: action.id, text: shot.reading.raw, url: shot.url, title: shot.title, extra: extra ?? '' })
  }

  private cancel(): void {
    const running = this.running
    if (!running) return
    this.running = null
    try {
      running.port.postMessage({ kind: 'orbis-selection/stop', id: running.id })
      running.port.disconnect()
    } catch {
      // Already gone, which is the state we wanted.
    }
  }

  /** Puts something on the clipboard. Returns whether it really went, so nobody is told it did when it did not. */
  private async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  private async keepAnswer(action: SelectionAction, shot: Snapshot, text: string): Promise<void> {
    const reply = await askWorker({
      kind: 'orbis-selection/do',
      action: 'note',
      text: `${action.label} — ${selectionPreview(shot.reading.raw, 60)}\n\n${text}`,
      url: shot.url,
      title: shot.title,
      extra: ''
    })
    this.toast(reply.ok ? 'Saved to Notes' : reply.message, reply.ok ? 'good' : 'bad')
  }

  // ---------------------------------------------------------------- saying what happened

  private toast(words: string, tone: 'good' | 'bad'): void {
    this.mounted()
    this.toastNode?.remove()
    const node = el('div', 'toast', words)
    node.dataset.tone = tone === 'bad' ? 'bad' : 'good'
    node.setAttribute('role', 'status')
    this.toastNode = node
    this.layer.append(node)
    const anchor = this.orb?.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(room().width - node.offsetWidth - 8, (anchor?.x ?? 20) - 10))}px`
    node.style.top = `${Math.max(8, (anchor?.y ?? 20) + 26)}px`
    window.setTimeout(() => {
      if (this.toastNode === node) {
        node.remove()
        this.toastNode = null
      }
    }, 2400)
  }

  // ---------------------------------------------------------------- going away

  private closePanel(): void {
    this.panel?.remove()
    this.panel = null
  }

  private dismiss(): void {
    this.cancel()
    this.closePanel()
    this.orb?.remove()
    this.orb = null
    this.snapshot = null
  }

  destroy(): void {
    this.dismiss()
    this.toastNode?.remove()
    for (const off of this.listeners.splice(0)) off()
    this.host.remove()
  }
}

/** A line of the selected text, so the panel says what it is about. */
function aboutLine(words: string): HTMLElement {
  const node = el('div', 'about')
  node.append(el('span', undefined, words))
  return node
}

/** Three dots that rise in turn: something is being composed, rather than a cursor that has got stuck. */
function composing(): HTMLElement {
  const node = el('span', 'waiting')
  node.setAttribute('aria-label', 'Orion is answering')
  for (let i = 0; i < 3; i++) node.append(el('i'))
  return node
}

function note(words: string, tone: 'warn' | 'plain'): HTMLElement {
  const node = el('p', 'note', words)
  node.dataset.tone = tone
  return node
}

function said(actionId: string): string {
  if (actionId === 'copy') return 'Copied'
  if (actionId === 'note') return 'Saved to Notes'
  if (actionId === 'whiteboard') return 'Sent to the Whiteboard'
  return 'Done'
}

/** The language this person reads, for deciding whether offering to translate makes sense. */
function ownLanguage(): string | null {
  const tag = navigator.language || ''
  return tag === '' ? null : tag.slice(0, 2).toLowerCase()
}

/*
 * Started once per frame, and never on Orbis's own pages -- those have the real thing and do not want a second one
 * floating over it.
 */
if (!/^(chrome|chrome-extension|devtools):/.test(location.protocol) && document.contentType !== 'application/pdf') {
  const started = (): void => void new SelectionOrb()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', started, { once: true })
  else started()
}
