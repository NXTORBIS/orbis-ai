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
  orb.title = 'Ask Orion (Alt+O)'
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
  orb.addEventListener('click', () => open(pop.hidden))
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
