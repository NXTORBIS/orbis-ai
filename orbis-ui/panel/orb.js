// The Orbis assistant orb, on the built-in Orbis pages (new tab page, search results).
//
// A floating orb: click it (or press Alt+O) for a quick Orion prompt. The prompt runs on the real Orion chat channel of the local helper
// (the same `chat:send` the side panel uses; the same model the panel last chose), streams the answer here, and offers to continue in
// the native Orbis side panel. Nothing is faked: with the helper not running, the orb says so.
//
// Not here: a floating orb over web pages themselves (a chrome:// page cannot draw over another page; see docs/orbis-ui-inventory.md).
import { call, askBrowser, HelperDown } from './helper.js'

const MODEL_KEY = 'orbis.model'
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

export function mountOrb(root = document.body) {
  const orb = el('button', 'orb')
  orb.type = 'button'
  orb.setAttribute('aria-label', 'Ask Orion (Alt+O)')
  orb.setAttribute('aria-expanded', 'false')
  orb.title = 'Ask Orion (Alt+O) — drag to move'
  const ring = el('img'); ring.src = 'orbis-ring.png'; ring.alt = ''; ring.width = 30; ring.height = 30
  orb.append(ring)

  const pop = el('div', 'orb-pop')
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Ask Orion'); pop.hidden = true
  const answer = el('div', 'orb-answer'); answer.setAttribute('aria-live', 'polite')
  const note = el('p', 'orb-note')
  const form = el('form', 'orb-form')
  const input = el('input'); input.type = 'text'; input.placeholder = 'Ask Orion…'; input.setAttribute('aria-label', 'Ask Orion'); input.autocomplete = 'off'; input.spellcheck = false
  const go = el('button', 'orb-go', 'Ask'); go.type = 'submit'
  const stop = el('button', 'orb-stop', 'Stop'); stop.type = 'button'; stop.hidden = true
  form.append(input, go, stop)
  const foot = el('div', 'orb-foot')
  const panel = el('button', 'orb-link', 'Open the Orbis panel'); panel.type = 'button'
  foot.append(panel)
  pop.append(answer, note, form, foot)
  root.append(pop, orb)

  let controller = null
  const open = (on) => {
    pop.hidden = !on
    orb.setAttribute('aria-expanded', String(on))
    if (on) input.focus()
  }

  // ------------------------------------------------------------------ dragging
  //
  // The orb can be moved. It is a button first, so a press only becomes a drag once
  // the pointer has travelled far enough to mean it: below that threshold the press
  // is a click and opens the prompt. Without that distinction every click would
  // jitter the orb a pixel and every drag would also ask Orion.
  const PLACE_KEY = 'orbis.orb.place'
  const DRAG_START_PX = 4
  const EDGE = 8

  /** Where the orb sits, as a fraction of the viewport, so it keeps its corner when the window resizes. */
  let place = null
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null')
    if (saved && Number.isFinite(saved.xr) && Number.isFinite(saved.yr)) place = { xr: saved.xr, yr: saved.yr }
  } catch { /* nothing saved, or unreadable: the default corner */ }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

  const apply = () => {
    if (!place) return
    const w = orb.offsetWidth || 46
    const h = orb.offsetHeight || 46
    const x = clamp(place.xr * window.innerWidth, EDGE, Math.max(EDGE, window.innerWidth - w - EDGE))
    const y = clamp(place.yr * window.innerHeight, EDGE, Math.max(EDGE, window.innerHeight - h - EDGE))
    // Keep what is remembered inside the window too. Storing the raw pointer position
    // lets a drag past the edge persist a fraction greater than 1, which is only
    // harmless for as long as every read happens to clamp it again.
    place = { xr: x / window.innerWidth, yr: y / window.innerHeight }
    orb.style.left = `${Math.round(x)}px`
    orb.style.top = `${Math.round(y)}px`
    orb.style.right = 'auto'
    orb.style.bottom = 'auto'
    // The prompt follows the orb, and flips to whichever side of it has room.
    const below = y + h + 12
    const roomBelow = window.innerHeight - below > 220
    pop.style.left = `${Math.round(clamp(x + w / 2 - pop.offsetWidth / 2, EDGE, Math.max(EDGE, window.innerWidth - pop.offsetWidth - EDGE)))}px`
    pop.style.right = 'auto'
    if (roomBelow) { pop.style.top = `${Math.round(below)}px`; pop.style.bottom = 'auto' }
    else { pop.style.bottom = `${Math.round(window.innerHeight - y + 12)}px`; pop.style.top = 'auto' }
  }

  let drag = null
  let moved = false

  orb.addEventListener('pointerdown', (e) => {
    // Left button (or touch/pen) only: a right-click is the context menu, not a drag.
    if (e.button !== 0) return
    const r = orb.getBoundingClientRect()
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY }
    moved = false
    orb.setPointerCapture(e.pointerId)
  })

  orb.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    if (!moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_START_PX) return
    if (!moved) {
      moved = true
      orb.classList.add('dragging')
      // While dragging, the prompt gets out of the way rather than trailing the orb.
      if (!pop.hidden) open(false)
    }
    // The pointer is captured, so this cannot land on the page, the address bar or
    // anything else underneath; scrolling and text selection are unaffected.
    e.preventDefault()
    place = { xr: (e.clientX - drag.dx) / window.innerWidth, yr: (e.clientY - drag.dy) / window.innerHeight }
    apply()
  })

  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return
    const wasMoved = moved
    drag = null
    orb.classList.remove('dragging')
    if (wasMoved && place) {
      try { localStorage.setItem(PLACE_KEY, JSON.stringify(place)) } catch { /* not kept; the orb still moved */ }
    }
    // The click that follows a drag is the end of the drag, not a request to Orion.
    if (wasMoved) setTimeout(() => (moved = false), 0)
  }
  orb.addEventListener('pointerup', endDrag)
  orb.addEventListener('pointercancel', endDrag)

  orb.addEventListener('click', () => {
    if (moved) return
    open(pop.hidden)
  })

  // A keyboard user moves it too: the orb is focusable, so the arrows nudge it.
  orb.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 32 : 8
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const r = orb.getBoundingClientRect()
    place = { xr: (r.left + d[0]) / window.innerWidth, yr: (r.top + d[1]) / window.innerHeight }
    apply()
    try { localStorage.setItem(PLACE_KEY, JSON.stringify(place)) } catch { /* not kept */ }
  })

  window.addEventListener('resize', apply)
  apply()
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'o') { e.preventDefault(); open(pop.hidden) }
    else if (e.key === 'Escape' && !pop.hidden) { open(false); orb.focus() }
  })
  panel.addEventListener('click', () => { askBrowser('orbis.openPanel').catch(() => { note.textContent = 'The panel could not be opened.' }) })
  stop.addEventListener('click', () => controller?.abort())

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text || controller) return
    input.value = ''
    answer.textContent = ''
    note.textContent = ''
    controller = new AbortController()
    go.hidden = true; stop.hidden = false
    let model
    try { model = localStorage.getItem(MODEL_KEY) || undefined } catch { /* none saved */ }
    try {
      const list = await call('models:list').catch(() => null)
      if (list && !list.models.some((m) => m.id === model)) model = list.default
      await call('chat:send', [{ model, webSearch: false, messages: [{ role: 'user', content: text }] }], {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'delta' && typeof event.content === 'string') answer.textContent += event.content
          else if (event.type === 'error') note.textContent = event.message || 'Orion could not answer.'
        }
      })
    } catch (err) {
      if (!controller?.signal.aborted) note.textContent = err instanceof HelperDown ? err.message : err?.message || 'That did not work.'
    } finally {
      controller = null
      go.hidden = false; stop.hidden = true
      input.focus()
    }
  })
  return { open }
}
