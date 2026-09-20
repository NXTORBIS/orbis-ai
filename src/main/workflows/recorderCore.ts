import type { ActionWorkflowStep, RecordingState } from '../../shared/workflows'

export type { RecordingState }

export interface RecordedTarget {
  tag: string
  type?: string
  role?: string
  name?: string
  label?: string
  text?: string
  placeholder?: string
  id?: string
  testId?: string
  nameAttr?: string
  css?: string
  xpath?: string
  href?: string
  sensitive?: boolean
}

export interface PageEvent {
  type: 'click' | 'dblclick' | 'check' | 'select' | 'type' | 'enter' | 'copy'
  target?: RecordedTarget
  value?: string | null
  option?: string
  checked?: boolean
  url: string
}

/** The browser state the recorder reads: the same for the Electron window and for Chromium. */
export interface RecorderBrowserState {
  open: boolean
  tabs: { id: string; active: boolean; url: string; title: string; loading?: boolean; webContentsId?: number | null }[]
  groups: { id: string; name: string; color: string }[]
}

export const PREFIX = '__orbis_record__'

/**
 * Captures what the user does on a page, as meaning rather than coordinates: the element's role, accessible name, label,
 * text and placeholder, with CSS and XPath fallbacks. Password, card and one-time-code fields never have their values
 * captured. Added to a page only while recording, and inert afterwards.
 */
export const CAPTURE_SCRIPT = `(() => {
  if (window.__orbisRecorder) { window.__orbisRecorder.on = true; return 'resumed'; }
  const state = { on: true };
  window.__orbisRecorder = state;
  const clean = (s, n) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().slice(0, n || 120);
  const send = (event) => { if (state.on) console.debug('${PREFIX}' + JSON.stringify(Object.assign(event, { url: location.href }))); };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role'); if (explicit) return explicit;
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type)) || tag === 'summary') return 'button';
    if (tag === 'input' && type === 'checkbox') return 'checkbox';
    if (tag === 'input' && type === 'radio') return 'radio';
    if (tag === 'input' && type === 'search') return 'searchbox';
    if ((tag === 'input' && !['hidden', 'file', 'range', 'color'].includes(type)) || tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    return undefined;
  };
  const nameOf = (el) => {
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const field = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    return clean(el.getAttribute('aria-label') || (forLabel && forLabel.innerText) || (el.closest('label') && el.closest('label').innerText) || el.getAttribute('title') || el.getAttribute('alt') || (field ? el.getAttribute('placeholder') || (['submit', 'button'].includes(el.type) ? el.value : '') : el.innerText));
  };
  const cssPath = (el) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      const testId = node.getAttribute('data-testid') || node.getAttribute('data-test') || node.getAttribute('data-qa');
      if (testId) { parts.unshift('[data-testid="' + CSS.escape(testId) + '"]'); break; }
      let part = node.tagName.toLowerCase();
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      parts.unshift(part);
      if (node.id) { parts[0] = '#' + CSS.escape(node.id); break; }
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const xpathOf = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
      parts.unshift(node.tagName.toLowerCase() + (same.length > 1 ? '[' + (same.indexOf(node) + 1) + ']' : ''));
    }
    return '/' + parts.join('/');
  };
  const describe = (el) => {
    const type = (el.getAttribute('type') || '').toLowerCase() || undefined;
    const sensitive = type === 'password' || /cc-|password|one-time-code/i.test(el.getAttribute('autocomplete') || '') || /pass(word)?|otp|one.?time|cvv|cvc|card.?number|security.?code/i.test((el.getAttribute('name') || '') + ' ' + (el.id || ''));
    return { tag: el.tagName.toLowerCase(), type, role: roleOf(el), name: nameOf(el) || undefined, placeholder: el.getAttribute('placeholder') || undefined, text: ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? undefined : clean(el.innerText, 80) || undefined, id: el.id || undefined, testId: el.getAttribute('data-testid') || undefined, nameAttr: el.getAttribute('name') || undefined, css: cssPath(el), xpath: xpathOf(el), href: el.href || undefined, sensitive };
  };
  const actionable = (el) => el.closest && (el.closest('a[href], button, input, textarea, select, summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [role="tab"], [role="option"], [contenteditable="true"]') || el);
  // Text fields are recorded once their value settles: on change, when focus leaves, shortly after typing stops, and
  // before any click (so the order of steps matches what happened).
  const sentValues = new WeakMap();
  const isTextField = (el) => el && ((el.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'reset'].includes(el.type)) || el.tagName === 'TEXTAREA');
  const flushField = (el) => {
    if (!isTextField(el) || sentValues.get(el) === el.value) return;
    sentValues.set(el, el.value);
    const target = describe(el);
    send({ type: 'type', target, value: target.sensitive ? null : String(el.value).slice(0, 2000) });
  };
  // A field's value when it gains focus is the baseline: only changes from it are recorded.
  document.addEventListener('focusin', (e) => {
    if (isTextField(e.target) && !sentValues.has(e.target)) sentValues.set(e.target, e.target.value);
  }, true);
  let typingTimer = 0;
  document.addEventListener('input', (e) => {
    clearTimeout(typingTimer);
    const el = e.target;
    typingTimer = setTimeout(() => flushField(el), 700);
  }, true);
  document.addEventListener('focusout', (e) => flushField(e.target), true);
  document.addEventListener('pointerdown', () => flushField(document.activeElement), true);
  document.addEventListener('click', (e) => {
    flushField(document.activeElement);
    const el = actionable(e.target);
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'LABEL' && el.control) return; // the field's own click follows
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['INPUT', 'TEXTAREA'].includes(el.tagName) && !['checkbox', 'radio', 'submit', 'button', 'image', 'reset'].includes(type)) return;
    if (el.tagName === 'SELECT') return;
    if (type === 'checkbox' || type === 'radio' || el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch') return send({ type: 'check', target: describe(el), checked: 'checked' in el ? el.checked : el.getAttribute('aria-checked') !== 'true' });
    send({ type: e.detail === 2 ? 'dblclick' : 'click', target: describe(el) });
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.tagName === 'SELECT') return send({ type: 'select', target: describe(el), option: clean(el.options[el.selectedIndex] && el.options[el.selectedIndex].text, 120) });
    flushField(el);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const el = e.target;
    if (!(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const target = describe(el);
    if (isTextField(el)) sentValues.set(el, el.value);
    send({ type: 'enter', target, value: target.sensitive ? null : String(el.isContentEditable ? el.innerText : el.value).slice(0, 2000) });
  }, true);
  document.addEventListener('copy', () => send({ type: 'copy', value: clean(String(getSelection()), 200) }), true);
  return 'recording';
})()`


export const STOP_SCRIPT = `(() => { if (window.__orbisRecorder) window.__orbisRecorder.on = false; return true; })()`

export const quote = (text: string | undefined): string => `“${String(text ?? '').slice(0, 40)}”`

/** A locator from what was recorded: accessible identity first, then stable attributes, then structure. */
export function locatorFor(t: RecordedTarget): { locator: Record<string, unknown>; alternatives: { locator: Record<string, unknown> }[] } {
  const options: Record<string, unknown>[] = []
  if (t.testId) options.push({ selector: `[data-testid="${t.testId}"]` })
  if (t.id && !/\d{4,}|[a-f0-9]{8,}/i.test(t.id)) options.push({ selector: `#${t.id}` })
  if (t.role && t.name) options.push({ role: t.role, name: t.name, exact: true })
  if (t.label) options.push({ label: t.label })
  if (t.nameAttr && ['input', 'textarea', 'select'].includes(t.tag)) options.push({ selector: `${t.tag}[name="${t.nameAttr}"]` })
  if (t.placeholder) options.push({ placeholder: t.placeholder })
  if (t.text && !t.role) options.push({ text: t.text, exact: true })
  if (t.css) options.push({ selector: t.css })
  if (t.xpath) options.push({ xpath: t.xpath })
  const [first, ...rest] = options.length ? options : [{ selector: t.tag }]
  return { locator: first, alternatives: rest.slice(0, 4).map((locator) => ({ locator })) }
}

export const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'secret'

/**
 * Records a workflow from what the user really does: page actions, addresses opened, tabs opened, switched and closed,
 * groups created, and downloads. Everything becomes editable workflow steps using the capabilities a run will use.
 * The browser-specific parts (attaching to pages, toggling capture, watching state) are the abstract hooks.
 */
export abstract class RecorderCore {
  protected state: RecordingState = { active: false, paused: false, steps: [], inputs: [], startedAt: 0 }
  protected lastState: RecorderBrowserState | null = null
  /** When the last page action happened in each tab (a navigation right after it was caused by it). */
  protected lastPageAction = new Map<number, number>()
  protected downloadsBefore = new Set<string>()
  private readonly emit: (state: RecordingState) => void

  constructor(emit: (state: RecordingState) => void) {
    this.emit = emit
  }

  /** Starts watching pages, browser state and downloads (state is already reset and active). */
  protected abstract begin(): void
  /** Removes everything added to pages and stops watching. */
  protected abstract end(): void
  /** Turns capture on or off in the attached pages. */
  protected abstract setCapture(on: boolean): void

  current(): RecordingState {
    return { ...this.state, steps: [...this.state.steps], inputs: [...this.state.inputs] }
  }

  protected publish(): void {
    this.emit(this.current())
  }

  protected push(step: Omit<ActionWorkflowStep, 'id' | 'type'>): void {
    if (!this.state.active || this.state.paused) return
    const previous = this.state.steps.at(-1)
    // Typing into the same field again replaces the earlier value.
    if (previous && step.capability === 'page.type' && previous.capability === 'page.type' && JSON.stringify(previous.params.locator) === JSON.stringify(step.params.locator)) {
      this.state.steps[this.state.steps.length - 1] = { ...previous, params: step.params, name: step.name }
    } else this.state.steps.push({ id: crypto.randomUUID(), type: 'action', ...step })
    this.publish()
  }

  start(): RecordingState {
    if (this.state.active) return this.current()
    this.state = { active: true, paused: false, steps: [], inputs: [], startedAt: Date.now() }
    this.begin()
    this.publish()
    return this.current()
  }

  pause(paused: boolean): RecordingState {
    if (!this.state.active) return this.current()
    this.state.paused = paused
    this.setCapture(!paused)
    this.publish()
    return this.current()
  }

  /** Ends the recording, removes everything it added to pages, and returns the steps. */
  stop(): RecordingState {
    if (!this.state.active) return this.current()
    this.end()
    this.state.active = false
    const result = this.current()
    this.publish()
    return result
  }

  protected secretInput(target: RecordedTarget): string {
    const label = target.name || target.label || target.placeholder || target.nameAttr || 'Secret'
    let name = slug(label)
    for (let n = 2; this.state.inputs.some((i) => i.name === name); n++) name = `${slug(label)}_${n}`
    this.state.inputs.push({ name, label, type: 'secret', required: true, description: 'Recorded from a private field; its value was not recorded.' })
    return name
  }

  protected onPageEvent(pageId: number, event: PageEvent): void {
    if (!this.state.active || this.state.paused) return
    this.lastPageAction.set(pageId, Date.now())
    const t = event.target
    const { locator, alternatives } = t ? locatorFor(t) : { locator: {}, alternatives: [] }
    const retry = alternatives.length ? { attempts: 1, alternatives } : undefined
    const what = quote(t?.name || t?.text || t?.placeholder || t?.label || t?.tag)
    switch (event.type) {
      case 'click':
      case 'dblclick':
        return this.push({ name: `${event.type === 'dblclick' ? 'Double-click' : 'Click'} ${what}`, capability: 'page.click', params: { locator, ...(event.type === 'dblclick' ? { clickCount: 2 } : {}) }, ...(retry ? { retry } : {}) })
      case 'check':
        return this.push({ name: `${event.checked ? 'Check' : 'Uncheck'} ${what}`, capability: 'page.check', params: { locator, checked: event.checked === true }, ...(retry ? { retry } : {}) })
      case 'select':
        return this.push({ name: `Choose ${quote(event.option)} in ${what}`, capability: 'page.select', params: { locator, option: event.option ?? '' }, ...(retry ? { retry } : {}) })
      case 'type':
      case 'enter': {
        const text = t?.sensitive ? `{{${this.secretInput(t)}}}` : (event.value ?? '')
        if (event.type === 'type' || text) this.push({ name: `Type into ${what}`, capability: 'page.type', params: { locator, text }, ...(retry ? { retry } : {}) })
        if (event.type === 'enter') this.push({ name: `Press Enter in ${what}`, capability: 'page.press', params: { keys: ['Enter'], locator }, ...(retry ? { retry } : {}) })
        return
      }
      case 'copy':
        return this.push({ name: 'Copy the selection', capability: 'clipboard.copyFromPage', params: {} })
    }
  }

  /** Parses a console message from a page; returns the recorder event, or null when it is not one. */
  protected parseMessage(message: string): PageEvent | null {
    if (!message.startsWith(PREFIX)) return null
    try {
      return JSON.parse(message.slice(PREFIX.length)) as PageEvent
    } catch {
      return null
    }
  }

  /** Tab-level actions, from how the browser state changed. */
  protected onBrowserState(next: RecorderBrowserState): void {
    const before = this.lastState
    this.lastState = next
    if (!before || !this.state.active || this.state.paused) return
    if (!before.open && next.open) return this.push({ name: 'Open the browser', capability: 'browser.open', params: {} })
    const known = new Set(before.tabs.map((t) => t.id))
    for (const tab of next.tabs) {
      if (!known.has(tab.id)) this.push({ name: `Open a tab${tab.url ? ` at ${tab.url}` : ''}`, capability: 'tabs.create', params: tab.url ? { url: tab.url, active: tab.active } : { active: tab.active } })
    }
    for (const tab of before.tabs) {
      if (!next.tabs.some((t) => t.id === tab.id)) this.push({ name: `Close the tab ${quote(tab.title)}`, capability: 'tabs.closeMatching', params: { urlContains: tab.url } })
    }
    const wasActive = before.tabs.find((t) => t.active)
    const nowActive = next.tabs.find((t) => t.active)
    if (nowActive && wasActive && nowActive.id !== wasActive.id && known.has(nowActive.id) && next.tabs.length === before.tabs.length) {
      this.push({ name: `Switch to ${quote(nowActive.title)}`, capability: 'tabs.activateMatching', params: { urlContains: nowActive.url } })
    }
    for (const tab of next.tabs) {
      const old = before.tabs.find((t) => t.id === tab.id)
      if (!old || !tab.url || old.url === tab.url || !/^https?:/i.test(tab.url)) continue
      // A navigation right after a page action came from that action; otherwise the user opened the address.
      const sincePageAction = tab.webContentsId != null ? Date.now() - (this.lastPageAction.get(tab.webContentsId) ?? 0) : Infinity
      if (sincePageAction > 2500 && !old.loading) this.push({ name: `Open ${tab.url}`, capability: 'navigation.go', params: { url: tab.url } })
    }
    const knownGroups = new Set(before.groups.map((g) => g.id))
    for (const group of next.groups) if (!knownGroups.has(group.id)) this.push({ name: `Group tabs as ${quote(group.name)}`, capability: 'groups.create', params: { name: group.name, color: group.color } })
  }

  /** Downloads seen now; any not seen at the start become steps. */
  protected onDownloads(downloads: { id: string; filename: string }[]): void {
    if (!this.state.active || this.state.paused) return
    for (const d of downloads) {
      if (this.downloadsBefore.has(d.id)) continue
      this.downloadsBefore.add(d.id)
      this.push({ name: `Wait for the download ${quote(d.filename)}`, capability: 'downloads.waitFor', params: { match: d.filename.replace(/\s*\(\d+\)(?=\.[^.]+$)/, ''), timeoutMs: 120_000 }, saveAs: 'download' })
    }
  }
}
