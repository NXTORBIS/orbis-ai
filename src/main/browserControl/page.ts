import type { PageHandle } from '../pageHandle.ts'
import type { ElementInfo } from '../browserSafety.ts'

/**
 * Webpage control: reading pages and acting on their elements, inside Orbis's real browser tabs. Used by the Browser
 * Control Layer and Orion's browser agent alike (one implementation). Everything runs on demand, against the page as it
 * is right now; nothing is injected into pages ahead of time or kept running in them.
 *
 * Elements are found through the DOM first (numbered references, CSS selectors, XPath, ARIA roles, accessible names,
 * labels, text, placeholders), then the accessibility tree; coordinates are only used to deliver real input events at
 * an element Orbis has already identified.
 */

export interface TargetInfo extends ElementInfo {
  x: number
  y: number
  left: number
  top: number
  width: number
  height: number
  covered: boolean
}

export interface PageElement extends ElementInfo {
  ref: number
  value?: string
  checked?: boolean
  inView: boolean
}

export interface PageSnapshot {
  url: string
  title: string
  text: string
  elements: PageElement[]
  scrollY: number
  scrollHeight: number
}

/** Ways to identify an element; the first that matches wins, in this order. */
export interface Locator {
  /** A number from the latest page snapshot. */
  ref?: number
  selector?: string
  xpath?: string
  /** ARIA role (explicit or implied: button, link, textbox, checkbox...). */
  role?: string
  /** Accessible name: aria-label, label text, visible text, alt, title. */
  name?: string
  /** Visible text contained in the element. */
  text?: string
  label?: string
  placeholder?: string
  /** Which match to take when several do (0-based, default 0). */
  index?: number
  /** Match the name/text exactly instead of containing it. */
  exact?: boolean
}

export const KEY_CODES = {
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowDown: 'Down',
  ArrowUp: 'Up',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  Space: 'Space'
} as const
type KeyName = keyof typeof KEY_CODES

export function keyCodeOf(name: string): string | null {
  if (name in KEY_CODES) return KEY_CODES[name as KeyName]
  if (/^[a-z0-9]$/i.test(name)) return name.toUpperCase()
  return null
}

// ---------------------------------------------------------------- page scripts

/** Describes an element for both the model and the safety policy. Runs inside the page. */
export const DESCRIBE = `const orbisDescribe = (el) => {
  const clean = (s, n) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase() || undefined;
  const role = el.getAttribute('role') || undefined;
  const form = el.form || el.closest('form');
  const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
  const img = el.querySelector ? el.querySelector('img[alt]') : null;
  const field = tag === 'input' || tag === 'textarea' || tag === 'select';
  const label = clean(el.getAttribute('aria-label') || (forLabel && forLabel.innerText) || (field ? '' : el.innerText) || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (img && img.alt) || (tag === 'input' && ['submit', 'button'].includes(type || '') ? el.value : '') || (el.closest('label') && el.closest('label').innerText) || el.getAttribute('name') || '', 90);
  const editable = (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'range', 'color', 'hidden'].includes(type || 'text')) || tag === 'textarea' || el.isContentEditable || ['textbox', 'searchbox', 'combobox'].includes(role || '');
  const searchForm = !!form && (form.getAttribute('role') === 'search' || /search/i.test(form.getAttribute('action') || '') || !!form.querySelector('input[type="search"], input[name="q"], input[name="query"], input[name="search"]'));
  const submits = (tag === 'button' && (!type || type === 'submit') && !!form) || (tag === 'input' && (type === 'submit' || type === 'image'));
  const sensitive = type === 'password' || /cc-|password|one-time-code/i.test(el.getAttribute('autocomplete') || '');
  const value = tag === 'select' ? clean(el.options[el.selectedIndex] && el.options[el.selectedIndex].text, 60) : editable && !sensitive ? clean(el.value !== undefined ? el.value : el.innerText, 60) : '';
  return { tag, type, role, label, name: el.getAttribute('name') || undefined, autocomplete: el.getAttribute('autocomplete') || undefined, href: tag === 'a' && el.href ? el.href : undefined, inForm: !!form, searchForm, submits, editable, value: value || undefined, checked: type === 'checkbox' || type === 'radio' ? !!el.checked : undefined };
};`

/** Numbers the visible interactive elements (on-screen first) and returns what the page shows. */
export const SNAPSHOT_SCRIPT = `(() => {
  ${DESCRIBE}
  const clean = (s, n) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  document.querySelectorAll('[data-orbis-ref]').forEach((el) => el.removeAttribute('data-orbis-ref'));
  const selector = 'a[href], button, input:not([type="hidden"]), textarea, select, summary, canvas, [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [contenteditable="true"]';
  const vh = innerHeight, vw = innerWidth;
  const found = [];
  for (const el of document.querySelectorAll(selector)) {
    if (el.disabled || el.closest('[aria-hidden="true"], [inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    found.push({ el, top: r.top, inView: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw });
  }
  found.sort((a, b) => (a.inView === b.inView ? a.top - b.top : a.inView ? -1 : 1));
  const elements = found.slice(0, 60).map(({ el, inView }, i) => {
    el.setAttribute('data-orbis-ref', String(i + 1));
    const described = orbisDescribe(el);
    if (el.tagName === 'CANVAS' && !described.label) described.label = 'canvas ' + el.width + 'x' + el.height;
    return Object.assign({ ref: i + 1, inView }, described);
  }).filter((e) => e.label || e.editable || e.href);
  const root = document.querySelector('main, [role="main"]') || document.body;
  const page = document.scrollingElement || document.documentElement;
  return { url: location.href, title: document.title, text: clean(root ? root.innerText : '', 2500), elements, scrollY: Math.round(page.scrollTop), scrollHeight: Math.round(page.scrollHeight) };
})()`

export const targetScript = (ref: number): string => `(() => {
  ${DESCRIBE}
  const el = document.querySelector('[data-orbis-ref="${ref}"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  // New-window links would open outside the tab Orbis is working in.
  if (el.tagName === 'A' && el.target && el.target !== '_self') el.target = '_self';
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  const described = orbisDescribe(el);
  if (el.tagName === 'CANVAS' && !described.label) described.label = 'canvas';
  return Object.assign(described, { x, y, left: r.left, top: r.top, width: r.width, height: r.height, covered: !hit || !(hit === el || el.contains(hit) || hit.contains(el)) });
})()`

export const focusScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-orbis-ref="${ref}"]');
  if (!el) return false;
  el.focus();
  if (typeof el.select === 'function') el.select();
  else if (el.isContentEditable) { const range = document.createRange(); range.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
  return document.activeElement === el || el.contains(document.activeElement);
})()`

/** Makes sure a field holds \`text\`, using the native value setter so frameworks like React see the change. */
export const fillScript = (ref: number, text: string): string => `(() => {
  const el = document.querySelector('[data-orbis-ref="${ref}"]');
  const text = ${JSON.stringify(text)};
  if (!el) return false;
  if (el.isContentEditable) {
    if (el.innerText.trim() !== text.trim()) { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })); }
    return true;
  }
  if (!('value' in el) || el.value === text) return true;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (setter && setter.set) setter.set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`

export const ACTIVE_SCRIPT = `(() => {
  ${DESCRIBE}
  const el = document.activeElement;
  return el && el !== document.body && el !== document.documentElement ? orbisDescribe(el) : null;
})()`

export const selectScript = (ref: number, option: string): string => `(() => {
  const el = document.querySelector('[data-orbis-ref="${ref}"]');
  if (!el || el.tagName !== 'SELECT') return 'that element is not a dropdown';
  const want = ${JSON.stringify(option.toLowerCase())};
  const options = [...el.options];
  const pick = options.find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) || options.find((o) => o.text.toLowerCase().includes(want));
  if (!pick) return 'no option matches';
  el.value = pick.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok:' + pick.text.trim();
})()`

/** Scrolls the page, or the scrollable container under the centre when the page itself doesn't move (feeds, Shorts). */
export const scrollScript = (down: boolean): string => `(() => {
  const dy = ${down ? 1 : -1} * innerHeight * 0.8;
  const page = document.scrollingElement || document.documentElement;
  const before = page.scrollTop;
  window.scrollBy({ top: dy, behavior: 'instant' });
  if (Math.abs(page.scrollTop - before) > 2) return 'page';
  let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 10) {
      const b = el.scrollTop;
      el.scrollBy({ top: dy, behavior: 'instant' });
      if (Math.abs(el.scrollTop - b) > 2) return 'container';
      break;
    }
    el = el.parentElement;
  }
  return null;
})()`

export const VIEW_SCRIPT = `(() => {
  const p = document.scrollingElement || document.documentElement;
  const t = document.body ? document.body.innerText : '';
  return { url: location.href, top: Math.round(p.scrollTop), height: Math.round(p.scrollHeight), view: innerHeight, width: innerWidth, textLength: t.length };
})()`

/** A digest of what the page shows, for noticing when repeated actions stop changing anything. */
export const FINGERPRINT_SCRIPT = `(() => {
  const p = document.scrollingElement || document.documentElement;
  const t = document.body ? document.body.innerText : '';
  return location.href + '|' + Math.round(p.scrollTop) + '|' + t.length + '|' + t.slice(0, 4000);
})()`

/** The largest video on screen (the Short or clip being watched) and where its playback is. */
export const MEDIA_SCRIPT = `(() => {
  const area = (v) => { const r = v.getBoundingClientRect(); return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); };
  const v = [...document.querySelectorAll('video')].filter((x) => area(x) > 2500).sort((a, b) => area(b) - area(a))[0];
  if (!v) return null;
  return { url: location.href, src: v.currentSrc || v.src || '', time: v.currentTime, duration: v.duration, paused: v.paused, ended: v.ended };
})()`

export const PLAY_SCRIPT = `(() => {
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  const v = [...document.querySelectorAll('video')].sort((a, b) => area(b) - area(a))[0];
  if (v && v.paused) v.play().catch(() => {});
  return !!v;
})()`

/** The structure of one element, or of the page's main game or board area, for understanding its state. */
export const inspectScript = (ref: number | null): string => `(() => {
  let el = ${ref === null ? 'null' : `document.querySelector('[data-orbis-ref="${ref}"]')`};
  if (!el) {
    const candidates = [...document.querySelectorAll('canvas, [id*="game" i], [class*="game" i], [id*="board" i], [class*="board" i], [class*="grid" i], [class*="tile" i], [class*="puzzle" i], main, pre')];
    let best = null, area = 0;
    for (const c of candidates) { const r = c.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; best = c; } }
    el = best || document.body;
  }
  if (el.tagName === 'CANVAS') return 'A canvas of ' + el.width + 'x' + el.height + ' pixels. What it shows is drawn as pixels, which Orbis cannot read as text.';
  const copy = el.cloneNode(true);
  copy.querySelectorAll('script, style, svg, noscript, iframe').forEach((n) => n.remove());
  return copy.outerHTML.replace(/\\s(style|srcset|sizes|d|jsaction|jscontroller|jsname|data-orbis-ref)="[^"]*"/g, '').replace(/\\s+/g, ' ').slice(0, 3500);
})()`

/**
 * Finds an element by locator and gives it a numbered reference (so later actions and fallbacks agree on the element).
 * Tries each identification method that was given; returns the reference, or why nothing matched.
 */
export const locateScript = (locator: Locator): string => `(() => {
  const loc = ${JSON.stringify(locator)};
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none'; };
  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    if (el.getAttribute('role')) return el.getAttribute('role').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return 'button';
    if (tag === 'input' && type === 'checkbox') return 'checkbox';
    if (tag === 'input' && type === 'radio') return 'radio';
    if (tag === 'input' && type === 'search') return 'searchbox';
    if (tag === 'input' && type === 'range') return 'slider';
    if ((tag === 'input' && !['hidden', 'file', 'color'].includes(type)) || tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'li') return 'listitem';
    if (tag === 'option') return 'option';
    if (tag === 'summary') return 'button';
    return '';
  };
  const accessibleName = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.innerText).join(' '); if (t.trim()) return t; }
    const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    return el.getAttribute('aria-label') || (forLabel && forLabel.innerText) || (el.closest('label') && el.closest('label').innerText) || el.getAttribute('alt') || el.getAttribute('title') || (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? el.getAttribute('placeholder') || (el.type === 'submit' || el.type === 'button' ? el.value : '') : el.innerText) || '';
  };
  const matchText = (have, want) => loc.exact ? norm(have) === norm(want) : norm(have).includes(norm(want));
  let found = [], method = '';
  try {
    if (loc.ref) { const el = document.querySelector('[data-orbis-ref="' + loc.ref + '"]'); if (el) { found = [el]; method = 'ref'; } }
    if (!found.length && loc.selector) { found = [...document.querySelectorAll(loc.selector)]; method = 'selector'; }
    if (!found.length && loc.xpath) { const r = document.evaluate(loc.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) if (r.snapshotItem(i).nodeType === 1) found.push(r.snapshotItem(i)); method = 'xpath'; }
  } catch (e) { return { error: 'Invalid selector: ' + e.message }; }
  if (!found.length && (loc.role || loc.name || loc.text || loc.label || loc.placeholder)) {
    const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('[aria-hidden="true"]') && visible(el));
    found = all.filter((el) => {
      if (loc.role && implicitRole(el) !== norm(loc.role)) return false;
      if (loc.name && !matchText(accessibleName(el), loc.name)) return false;
      if (loc.label && !matchText(accessibleName(el), loc.label)) return false;
      if (loc.placeholder && !matchText(el.getAttribute('placeholder'), loc.placeholder)) return false;
      if (loc.text && !matchText(el.innerText || el.value, loc.text)) return false;
      return true;
    });
    // The innermost matches: a text match inside a card shouldn't also pick every ancestor holding that text.
    found = found.filter((el) => !found.some((other) => other !== el && el.contains(other)));
    // A label stands for the field it labels.
    found = [...new Set(found.map((el) => (el.tagName === 'LABEL' && el.control ? el.control : el)))];
    method = 'semantic';
  }
  const visibleFirst = [...found.filter(visible), ...found.filter((el) => !visible(el))];
  const el = visibleFirst[loc.index || 0];
  if (!el) return { error: 'No element matches ' + JSON.stringify(loc) + '.', count: 0 };
  let ref = el.getAttribute('data-orbis-ref');
  if (!ref) { ref = String(100000 + Math.floor(Math.random() * 900000)); el.setAttribute('data-orbis-ref', ref); }
  return { ref: Number(ref), method, count: found.length };
})()`

/** Reads text, attributes, values or a table of fields from the elements a selector matches. */
export const extractScript = (selector: string | undefined, fields: Record<string, string> | undefined, attribute: string | undefined, limit: number): string => `(() => {
  const clean = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const selector = ${JSON.stringify(selector ?? null)}, fields = ${JSON.stringify(fields ?? null)}, attribute = ${JSON.stringify(attribute ?? null)};
  const read = (el, attr) => !attr || attr === 'text' ? clean(el.innerText || el.textContent || el.value) : attr === 'value' ? clean(el.value) : attr === 'html' ? el.outerHTML.slice(0, 5000) : attr === 'href' ? (el.href || el.getAttribute('href') || '') : clean(el.getAttribute(attr));
  if (!selector) return { url: location.href, title: document.title, text: clean(document.body ? document.body.innerText : '').slice(0, 20000) };
  let nodes;
  try { nodes = [...document.querySelectorAll(selector)].slice(0, ${limit}); } catch (e) { return { error: 'Invalid selector: ' + e.message }; }
  if (!fields) return { count: nodes.length, values: nodes.map((n) => read(n, attribute)) };
  return { count: nodes.length, rows: nodes.map((n) => Object.fromEntries(Object.entries(fields).map(([key, spec]) => {
    const [sub, attr] = String(spec).split('@');
    const target = sub ? n.querySelector(sub) : n;
    return [key, target ? read(target, attr) : null];
  }))) };
})()`

// ---------------------------------------------------------------- helpers

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error('timed out')))])
}

/** Waits for loading to finish; `quick` keeps the pause short for game moves. */
export async function settle(wc: PageHandle, signal?: AbortSignal, quick = false): Promise<void> {
  await sleep(quick ? 120 : 350)
  const deadline = Date.now() + 15_000
  while (!wc.isDestroyed() && wc.isLoading() && Date.now() < deadline && !signal?.aborted) await sleep(150)
  await sleep(quick ? 80 : 450)
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`
    return path.length > 60 ? `${path.slice(0, 57)}…` : path
  } catch {
    return url.slice(0, 60)
  }
}

export function describePage(page: PageSnapshot): string {
  const lines = page.elements.map((e) => {
    const kind = e.role ?? (e.tag === 'input' ? `input${e.type ? `[${e.type}]` : ''}` : e.tag)
    const extra = [e.href ? `-> ${displayUrl(e.href)}` : '', e.value ? `value="${e.value}"` : '', e.checked === undefined ? '' : e.checked ? 'checked' : 'unchecked', e.inView ? '' : '(off-screen)']
      .filter(Boolean)
      .join(' ')
    return `[${e.ref}] ${kind} "${e.label}"${extra ? ` ${extra}` : ''}`
  })
  return [`URL: ${page.url}`, `Title: ${page.title}`, `Scrolled ${page.scrollY}px of ${page.scrollHeight}px`, '', 'Visible text:', page.text || '(none)', '', 'Interactive elements:', lines.join('\n') || '(none)'].join('\n')
}

export async function snapshot(wc: PageHandle): Promise<PageSnapshot> {
  return (await withTimeout(wc.executeJavaScript(SNAPSHOT_SCRIPT), 8000)) as PageSnapshot
}

export async function pageState(wc: PageHandle): Promise<string> {
  try {
    return describePage(await snapshot(wc))
  } catch {
    return `URL: ${wc.getURL() || '(blank)'}\n(The page content couldn't be read yet. Try read_page again.)`
  }
}

export function exec<T>(wc: PageHandle, code: string, ms = 8000): Promise<T> {
  return withTimeout(wc.executeJavaScript(code, true) as Promise<T>, ms)
}

/** A key pressed in the page as real keyboard input; never acts as a browser shortcut. */
export async function pressNamedKey(wc: PageHandle, name: string, holdMs = 0, modifiers: ('shift' | 'control' | 'alt' | 'meta')[] = []): Promise<void> {
  const keyCode = keyCodeOf(name)
  if (!keyCode) return
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  const char = name === 'Enter' ? '\r' : name === 'Space' ? ' ' : name.length === 1 ? name : null
  if (char && !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt')) wc.sendInputEvent({ type: 'char', keyCode: char, modifiers })
  if (holdMs > 0) await sleep(holdMs)
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

export type MouseButton = 'left' | 'right' | 'middle'

/** A real mouse click at a point of the page (CSS pixels), for an element already identified. */
export function mouseClick(wc: PageHandle, x: number, y: number, button: MouseButton = 'left', clickCount = 1): void {
  const zoom = wc.getZoomFactor()
  const px = Math.round(x * zoom)
  const py = Math.round(y * zoom)
  wc.sendInputEvent({ type: 'mouseMove', x: px, y: py })
  for (let n = 1; n <= clickCount; n++) {
    wc.sendInputEvent({ type: 'mouseDown', x: px, y: py, button, clickCount: n })
    wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button, clickCount: n })
  }
}

export function mouseMove(wc: PageHandle, x: number, y: number): void {
  const zoom = wc.getZoomFactor()
  wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x * zoom), y: Math.round(y * zoom) })
}

export async function mouseDrag(wc: PageHandle, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  const zoom = wc.getZoomFactor()
  wc.sendInputEvent({ type: 'mouseMove', x: Math.round(fromX * zoom), y: Math.round(fromY * zoom) })
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(fromX * zoom), y: Math.round(fromY * zoom), button: 'left', clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    const x = Math.round((fromX + ((toX - fromX) * i) / 8) * zoom)
    const y = Math.round((fromY + ((toY - fromY) * i) / 8) * zoom)
    wc.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftbuttondown'] })
    await sleep(16)
  }
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(toX * zoom), y: Math.round(toY * zoom), button: 'left', clickCount: 1 })
}

/** Resolves a locator to a numbered reference and the element's position and description. */
export async function locate(wc: PageHandle, locator: Locator): Promise<{ ref: number; method: string; count: number; target: TargetInfo } | { error: string }> {
  type Found = { ref?: number; method?: string; count?: number; error?: string }
  const found = await exec<Found>(wc, locateScript(locator)).catch((err: Error): Found => ({ error: `The page didn't answer: ${err.message}` }))
  if (!found.ref) return { error: found.error ?? 'No matching element.' }
  const target = await exec<TargetInfo | null>(wc, targetScript(found.ref)).catch(() => null)
  if (!target) return { error: 'The element disappeared before Orbis could use it.' }
  return { ref: found.ref, method: found.method ?? 'ref', count: found.count ?? 1, target }
}

/** The accessibility tree Chromium builds for the page, read through the page's own debugger connection and released straight after. */
export async function accessibilityTree(wc: PageHandle, limit = 400): Promise<{ role: string; name: string; value?: string; depth: number }[]> {
  const dbg = wc.debugger
  const attachedHere = !dbg.isAttached()
  if (attachedHere) {
    try {
      dbg.attach('1.3')
    } catch (err) {
      throw new Error(`The accessibility tree isn't available while developer tools are attached (${err instanceof Error ? err.message : String(err)}).`)
    }
  }
  try {
    const { nodes } = (await withTimeout(dbg.sendCommand('Accessibility.getFullAXTree'), 8000)) as {
      nodes: { nodeId: string; parentId?: string; ignored: boolean; role?: { value: string }; name?: { value: string }; value?: { value: unknown } }[]
    }
    const depthOf = new Map<string, number>()
    const out: { role: string; name: string; value?: string; depth: number }[] = []
    for (const node of nodes) {
      const depth = node.parentId ? (depthOf.get(node.parentId) ?? 0) + (node.ignored ? 0 : 1) : 0
      depthOf.set(node.nodeId, depth)
      if (node.ignored) continue
      const role = node.role?.value ?? ''
      const name = String(node.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!name && ['generic', 'none', 'InlineTextBox', 'StaticText', 'LineBreak'].includes(role)) continue
      out.push({ role, name, ...(node.value?.value !== undefined && node.value.value !== '' ? { value: String(node.value.value).slice(0, 120) } : {}), depth })
      if (out.length >= limit) break
    }
    return out
  } finally {
    if (attachedHere && dbg.isAttached()) dbg.detach()
  }
}

/** A screenshot through the page's DevTools protocol (works while the page is hidden); released straight after. */
export async function debuggerScreenshot(wc: PageHandle): Promise<Electron.NativeImage> {
  const { nativeImage } = await import('electron')
  const dbg = wc.debugger
  const attachedHere = !dbg.isAttached()
  if (attachedHere) dbg.attach('1.3')
  try {
    const { data } = (await withTimeout(dbg.sendCommand('Page.captureScreenshot', { format: 'png' }), 10_000)) as { data: string }
    return nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
  } finally {
    if (attachedHere && dbg.isAttached()) dbg.detach()
  }
}

/** http(s) URLs and bare domains open directly, other text becomes a Google search, and other schemes are refused. */
export function toWebUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return text
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}
