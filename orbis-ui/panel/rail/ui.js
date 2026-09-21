// Shared bits for the rail's own views (Tabs, Tab groups, Media, Controls, Saved pages, ...): building elements from text (never HTML),
// asking the helper, the loading / empty / error states, and the registry that shows one view at a time in the panel.
// Bundled into sidebar.js (scripts/build-extension.mjs), so these views need no resource of their own in the browser.
import { call, HelperDown } from '../helper.js'
import { icon } from './icons.js'

export { icon }

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  return node
}

/** A small icon-only button: always has an accessible name and a tooltip. */
export const iconButton = (name, label, onclick, extra = {}) => {
  const b = el('button', { type: 'button', class: `iconbtn${extra.class ? ` ${extra.class}` : ''}`, 'aria-label': label, title: label, ...(extra.pressed !== undefined ? { 'aria-pressed': String(extra.pressed) } : {}), ...(extra.disabled ? { disabled: true } : {}), onclick }, icon(name, extra.size ?? 15))
  return b
}

/** A button with an icon and a visible label. */
export const labelButton = (name, label, onclick, extra = {}) => el('button', { type: 'button', class: `labelbtn${extra.class ? ` ${extra.class}` : ''}`, title: extra.title ?? label, ...(extra.disabled ? { disabled: true } : {}), onclick }, icon(name, 14), el('span', {}, label))

export const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

export const when = (time) => {
  if (!time) return ''
  const date = new Date(time)
  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The sentence shown when a call fails: what happened, in words the person can act on. */
export const problemText = (err) => {
  if (err instanceof HelperDown) return 'Orbis is not running, so this cannot be shown. Start it from run-orbis-chromium.bat.'
  const code = err?.code
  if (code === 'unavailable' || code === 'not-ready') return err.message || 'This is not available yet.'
  return err?.message || 'That did not work.'
}

/** Runs one helper channel: { ok: true, value } or { ok: false, message, code }. Never throws, never logs what was sent or returned. */
export async function ask(channel, args = []) {
  try {
    return { ok: true, value: await call(channel, args) }
  } catch (err) {
    return { ok: false, message: problemText(err), code: err?.code ?? (err instanceof HelperDown ? 'down' : 'error') }
  }
}

/** A loading / empty / error block. */
export const state = (kind, text, action) =>
  el('div', { class: `rv-state ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, el('p', {}, text), action ?? null)

/** A site's own icon from the browser's favicon service, falling back to a globe. Only inside the built-in page; anywhere else it is the globe. */
export function favicon(url) {
  const holder = el('span', { class: 'rv-fav', 'aria-hidden': 'true' }, icon('globe', 14))
  if (location.protocol === 'chrome:' && /^https?:\/\//i.test(url || '')) {
    const img = el('img', { alt: '', width: '16', height: '16', src: `chrome://favicon2/?size=16&pageUrl=${encodeURIComponent(url)}` })
    img.addEventListener('load', () => holder.replaceChildren(img))
  }
  return holder
}

// ---------------------------------------------------------------- the views

const views = new Map()
let current = 'ask'

export const isVisible = () => document.visibilityState === 'visible'

/**
 * Registers a view. `draw(body, ctx)` fills the view's body; the view is told when it is shown or hidden (`ctx.onShow`, `ctx.onHide`) so it can
 * poll only while it is on screen. `ctx.active()` says whether it is the view in front and the page is visible.
 */
export function registerView(id, { title, iconName, draw }) {
  const body = el('main', { class: 'rv-body', 'aria-live': 'polite' })
  const section = el(
    'section',
    { class: 'view rail-view', id: `view-${id}`, role: 'region', 'aria-label': title, hidden: true },
    el('header', { class: 'rv-head' }, icon(iconName, 16), el('h2', {}, title), iconButton('close', `Close ${title}`, () => showView('ask'))),
    body
  )
  const listeners = { show: [], hide: [] }
  const ctx = {
    id,
    body,
    active: () => current === id && isVisible(),
    onShow: (fn) => listeners.show.push(fn),
    onHide: (fn) => listeners.hide.push(fn)
  }
  document.getElementById('app')?.append(section)
  views.set(id, { section, listeners })
  draw(body, ctx)
}

export const hasView = (id) => views.has(id)

/** Shows a rail view, or one of the panel's own tabs (by the name showTab knows, e.g. "ask"). */
export function showView(id) {
  const previous = current
  if (views.has(id)) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${id}`
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', 'false')
    current = id
  } else {
    // One of the panel's own tabs: panel.js shows it and tells us (orbis:view), which hides the view that was in front.
    document.getElementById(`tab-${id}`)?.click()
    return
  }
  if (previous !== id) views.get(previous)?.listeners.hide.forEach((fn) => fn())
  views.get(id).listeners.show.forEach((fn) => fn())
  document.dispatchEvent(new CustomEvent('orbis:view', { detail: { name: id } }))
}

// A panel tab was chosen (panel.js): the view in front, if it is one of ours, is no longer shown.
document.addEventListener('orbis:view', (event) => {
  const name = event.detail?.name
  if (name && name !== current) {
    views.get(current)?.listeners.hide.forEach((fn) => fn())
    current = name
  }
})

// Polling belongs to the view in front and to a page that can be seen: hiding the page stops it, showing it starts it again.
document.addEventListener('visibilitychange', () => {
  const v = views.get(current)
  if (!v) return
  ;(isVisible() ? v.listeners.show : v.listeners.hide).forEach((fn) => fn())
})

/** A repeating job that runs only while `ctx.active()`: start on show, stop on hide. Returns { refresh }. */
export function poller(ctx, job, every = 2000) {
  let timer = null
  let busy = false
  const tick = async () => {
    if (busy || !ctx.active()) return
    busy = true
    try {
      await job()
    } finally {
      busy = false
    }
  }
  const start = () => {
    if (timer) return
    void tick()
    timer = setInterval(() => void tick(), every)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  ctx.onShow(start)
  ctx.onHide(stop)
  return { refresh: tick, running: () => timer !== null }
}

/** Replaces a container's children, leaving out anything that is null (replaceChildren would write the word "null"). */
export const fill = (container, ...nodes) => container.replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false))
