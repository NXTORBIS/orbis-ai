// Pure logic for the new tab page's widgets: the catalogue, and what a board of them is allowed to be.
// No DOM, no chrome.*, no helper — so it can be tested with `node --test` (widget-logic.test.mjs).
//
// The catalogue here is deliberately smaller than src/shared/widgets.ts. That file is the Electron app's full engine,
// and several of its widgets read stores this page cannot reach. A widget is listed here only when it genuinely works
// on this page: either it needs nothing at all, or it reads a channel the helper actually answers. A widget that would
// have to invent its contents is not listed, because a widget showing made-up numbers is worse than no widget.

export const MAX_WIDGETS = 12
export const SIZES = ['small', 'medium', 'large']

/**
 * `needs` names the helper channel a widget reads, or null when it needs nothing. The page uses it for one thing only:
 * when the helper is not answering, the card says which part of Orbis is quiet instead of sitting empty.
 */
export const WIDGETS = [
  { id: 'clock', name: 'Clock', description: 'The time and date, here', needs: null, sizes: ['small', 'medium'], defaultSize: 'small' },
  { id: 'worldclock', name: 'World clock', description: 'The time somewhere else', needs: null, sizes: ['small', 'medium'], defaultSize: 'small' },
  { id: 'countdown', name: 'Countdown', description: 'How long until a date you choose', needs: null, sizes: ['small', 'medium'], defaultSize: 'small' },
  { id: 'timer', name: 'Timer', description: 'A countdown you start and stop', needs: null, sizes: ['small'], defaultSize: 'small' },
  { id: 'calculator', name: 'Calculator', description: 'Arithmetic, without leaving the page', needs: null, sizes: ['small', 'medium'], defaultSize: 'small' },
  { id: 'notepad', name: 'Scratch note', description: 'A note kept on this page, for whatever is in hand', needs: null, sizes: ['medium', 'large'], defaultSize: 'medium' },
  { id: 'tasks', name: 'Tasks', description: 'What is still to do', needs: 'tasks:list', sizes: ['medium', 'large'], defaultSize: 'medium' },
  { id: 'reminders', name: 'Reminders', description: 'Tasks with a time on them', needs: 'reminders:list', sizes: ['medium', 'large'], defaultSize: 'medium' },
  { id: 'notes', name: 'Notes', description: 'The notes kept in Orbis', needs: 'notes:list', sizes: ['medium', 'large'], defaultSize: 'medium' },
  { id: 'clipboard', name: 'Clipboard', description: 'What has been copied lately', needs: 'clipboard:list', sizes: ['medium', 'large'], defaultSize: 'medium' },
  { id: 'workspaces', name: 'Workspaces', description: 'Sets of tabs, reopened as one', needs: 'workspaces:list', sizes: ['medium'], defaultSize: 'medium' }
]

export const widgetById = (id) => WIDGETS.find((w) => w.id === id)

/** Reads back a saved board, dropping anything that is no longer a widget, and keeping the size within what it offers. */
export function normalizeWidgets(raw) {
  const out = []
  const seen = new Set()
  for (const w of Array.isArray(raw) ? raw : []) {
    if (!w || typeof w !== 'object' || typeof w.id !== 'string' || seen.has(w.id)) continue
    const def = widgetById(w.widget)
    if (!def) continue
    seen.add(w.id)
    const size = def.sizes.includes(w.size) ? w.size : def.defaultSize
    const settings = w.settings && typeof w.settings === 'object' && !Array.isArray(w.settings) ? w.settings : {}
    out.push({ id: w.id.slice(0, 64), widget: def.id, size, settings })
    if (out.length >= MAX_WIDGETS) break
  }
  return out
}

/** Returns { ok, widgets } or { ok: false, error }. The same widget may be added more than once: two clocks is a choice. */
export function addWidget(list, widgetId, makeId = () => Math.random().toString(36).slice(2, 12)) {
  const def = widgetById(widgetId)
  if (!def) return { ok: false, error: 'That is not a widget Orbis has' }
  if (list.length >= MAX_WIDGETS) return { ok: false, error: `The page holds ${MAX_WIDGETS} widgets. Remove one first.` }
  return { ok: true, widgets: [...list, { id: makeId(), widget: def.id, size: def.defaultSize, settings: {} }] }
}

export const removeWidget = (list, id) => list.filter((w) => w.id !== id)

/** Moves a widget one place earlier or later. Out of range, the board is returned unchanged rather than wrapping around. */
export function moveWidget(list, id, delta) {
  const from = list.findIndex((w) => w.id === id)
  if (from < 0) return list
  const to = from + delta
  if (to < 0 || to >= list.length) return list
  const out = [...list]
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved)
  return out
}

/** Cycles a widget to its next offered size, so one control does the whole job. */
export function resizeWidget(list, id) {
  return list.map((w) => {
    if (w.id !== id) return w
    const def = widgetById(w.widget)
    if (!def || def.sizes.length < 2) return w
    const next = def.sizes[(def.sizes.indexOf(w.size) + 1) % def.sizes.length]
    return { ...w, size: next }
  })
}

export function setWidgetSetting(list, id, name, value) {
  return list.map((w) => (w.id === id ? { ...w, settings: { ...w.settings, [name]: value } } : w))
}

// ---------------------------------------------------------------- the widgets that compute something

/** Milliseconds as h:mm:ss (or m:ss under an hour), for the timer. Never negative. */
export function timerText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Arithmetic for the calculator, without eval: a page that evaluates typed source is a page that runs whatever is
 * pasted into it. Numbers, + - * / %, brackets and a leading minus; anything else is refused by name.
 */
export function calculate(input) {
  const text = String(input ?? '').trim()
  if (!text) return { ok: false, error: '' }
  if (!/^[\d\s+\-*/%.()]+$/.test(text)) return { ok: false, error: 'Numbers and + - * / % only' }

  const tokens = text.match(/\d*\.?\d+|[+\-*/%()]/g)
  if (!tokens || tokens.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) return { ok: false, error: 'That is not a sum' }

  let at = 0
  const peek = () => tokens[at]
  const eat = (t) => (peek() === t ? (at++, true) : false)

  // expression := term (('+'|'-') term)*   term := factor (('*'|'/'|'%') factor)*   factor := number | '(' expression ')' | '-' factor
  const factor = () => {
    if (eat('-')) { const v = factor(); return v === null ? null : -v }
    if (eat('(')) { const v = expression(); if (v === null || !eat(')')) return null; return v }
    const t = peek()
    if (t === undefined || !/^\d*\.?\d+$/.test(t)) return null
    at++
    return Number(t)
  }
  const term = () => {
    let v = factor()
    if (v === null) return null
    for (;;) {
      if (eat('*')) { const r = factor(); if (r === null) return null; v *= r }
      else if (eat('/')) { const r = factor(); if (r === null) return null; if (r === 0) return null; v /= r }
      else if (eat('%')) { const r = factor(); if (r === null) return null; if (r === 0) return null; v %= r }
      else return v
    }
  }
  const expression = () => {
    let v = term()
    if (v === null) return null
    for (;;) {
      if (eat('+')) { const r = term(); if (r === null) return null; v += r }
      else if (eat('-')) { const r = term(); if (r === null) return null; v -= r }
      else return v
    }
  }

  const value = expression()
  if (value === null || at !== tokens.length) return { ok: false, error: 'That is not a sum' }
  if (!Number.isFinite(value)) return { ok: false, error: 'Cannot divide by zero' }
  // Binary floating point makes 0.1 + 0.2 long; the extra digits are noise, not precision.
  return { ok: true, value: Math.round(value * 1e10) / 1e10 }
}

/** The named zone's time, or null when the zone is not one this browser knows. */
export function zoneTime(date, zone, hour12 = false) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12 }).format(date)
  } catch {
    return null
  }
}
