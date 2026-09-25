// The new tab page's widget board: the "+ Widget" button, the picker behind it, and the cards themselves.
//
// Everything a card shows is real. The ones that need nothing (clock, timer, calculator, ...) compute it here; the ones
// that read Orbis (tasks, notes, clipboard, ...) ask the helper on the channel named in widget-logic.js. When the helper
// is not answering, the card says which part of Orbis is quiet — it does not fall back to an example.
//
// The arrangement is the person's: add, reorder, resize, remove, all from the card itself, all kept per profile.

import { WIDGETS, addWidget, calculate, moveWidget, normalizeWidgets, removeWidget, resizeWidget, setWidgetSetting, timerText, widgetById, zoneTime } from './widget-logic.js'
import { askBrowser } from './helper.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

const ZONES = ['UTC', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Los_Angeles']

let board = []
let save = async () => {}
let hour12 = false
/** Per-card working state that is not worth keeping between visits: a running timer, a half-typed sum. */
const scratch = new Map()

// ---------------------------------------------------------------- the cards

/** Asks the helper and renders, or says plainly that the channel is quiet. Never invents rows. */
async function fill(body, channel, args, draw) {
  body.replaceChildren(el('p', 'w-quiet', 'Loading…'))
  try {
    const rows = await askBrowser(channel, ...args)
    body.replaceChildren()
    draw(body, Array.isArray(rows) ? rows : (rows && Array.isArray(rows.items) ? rows.items : []))
  } catch {
    body.replaceChildren(el('p', 'w-quiet', 'Orbis is not answering, so this cannot be shown.'))
  }
}

function list(body, rows, text, href) {
  if (!rows.length) { body.append(el('p', 'w-quiet', 'Nothing here yet.')); return }
  const ul = el('ul', 'w-list')
  for (const row of rows.slice(0, 8)) {
    const li = el('li')
    const label = text(row)
    if (href && href(row)) { const a = el('a', '', label); a.href = href(row); li.append(a) } else li.append(el('span', '', label))
    ul.append(li)
  }
  body.append(ul)
}

const RENDER = {
  clock(body, inst) {
    const time = el('div', 'w-big')
    const date = el('div', 'w-sub')
    const tick = () => {
      const now = new Date()
      time.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12 }).format(now)
      date.textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
    }
    tick()
    body.append(time, date)
    return setInterval(tick, 10_000)
  },

  worldclock(body, inst) {
    const zone = typeof inst.settings.zone === 'string' ? inst.settings.zone : 'UTC'
    const time = el('div', 'w-big')
    const pick = el('select', 'w-pick')
    for (const z of ZONES) { const o = el('option', '', z.replace(/_/g, ' ')); o.value = z; pick.append(o) }
    pick.value = ZONES.includes(zone) ? zone : 'UTC'
    pick.addEventListener('change', async () => { board = setWidgetSetting(board, inst.id, 'zone', pick.value); await save(board); render() })
    const tick = () => {
      const text = zoneTime(new Date(), pick.value, hour12)
      time.textContent = text ?? '—'
      time.title = text ? '' : 'This browser does not know that time zone'
    }
    tick()
    body.append(time, pick)
    return setInterval(tick, 10_000)
  },

  countdown(body, inst) {
    const date = typeof inst.settings.date === 'string' ? inst.settings.date : ''
    const label = typeof inst.settings.label === 'string' ? inst.settings.label : ''
    const out = el('div', 'w-big')
    const name = el('div', 'w-sub', label)
    const when = el('input', 'w-pick'); when.type = 'date'; when.value = date
    const what = el('input', 'w-pick'); what.type = 'text'; what.maxLength = 60; what.placeholder = 'What for'; what.value = label
    when.addEventListener('change', async () => { board = setWidgetSetting(board, inst.id, 'date', when.value); await save(board); render() })
    what.addEventListener('change', async () => { board = setWidgetSetting(board, inst.id, 'label', what.value); await save(board); render() })
    const tick = () => {
      if (!date) { out.textContent = '—'; return }
      const days = Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000)
      out.textContent = days > 0 ? `${days} day${days === 1 ? '' : 's'}` : days === 0 ? 'Today' : `${-days} day${days === -1 ? '' : 's'} ago`
    }
    tick()
    body.append(out, name, when, what)
    return setInterval(tick, 60_000)
  },

  timer(body, inst) {
    const state = scratch.get(inst.id) ?? { endsAt: 0, left: 5 * 60_000, running: false }
    scratch.set(inst.id, state)
    const out = el('div', 'w-big')
    const row = el('div', 'w-row')
    const start = el('button', 'w-mini'); start.type = 'button'
    const reset = el('button', 'w-mini', 'Reset'); reset.type = 'button'
    const plus = el('button', 'w-mini', '+1 min'); plus.type = 'button'
    const show = () => {
      out.textContent = timerText(state.running ? state.endsAt - Date.now() : state.left)
      start.textContent = state.running ? 'Pause' : 'Start'
    }
    start.addEventListener('click', () => {
      if (state.running) { state.left = Math.max(0, state.endsAt - Date.now()); state.running = false } else { state.endsAt = Date.now() + state.left; state.running = true }
      show()
    })
    reset.addEventListener('click', () => { state.running = false; state.left = 5 * 60_000; show() })
    plus.addEventListener('click', () => { if (state.running) state.endsAt += 60_000; else state.left += 60_000; show() })
    show()
    row.append(start, plus, reset)
    body.append(out, row)
    return setInterval(() => { if (state.running && state.endsAt - Date.now() <= 0) { state.running = false; state.left = 0 } show() }, 500)
  },

  calculator(body, inst) {
    const input = el('input', 'w-pick'); input.type = 'text'; input.placeholder = '12 * (3 + 4)'; input.spellcheck = false
    input.value = scratch.get(inst.id) ?? ''
    const out = el('div', 'w-big', '')
    const err = el('div', 'w-quiet', '')
    const run = () => {
      scratch.set(inst.id, input.value)
      const r = calculate(input.value)
      out.textContent = r.ok ? String(r.value) : ''
      err.textContent = r.ok ? '' : r.error
    }
    input.addEventListener('input', run)
    run()
    body.append(input, out, err)
    return 0
  },

  notepad(body, inst) {
    const area = el('textarea', 'w-note')
    area.placeholder = 'Anything worth keeping to hand'
    area.value = typeof inst.settings.text === 'string' ? inst.settings.text : ''
    let pending = 0
    area.addEventListener('input', () => {
      clearTimeout(pending)
      // Written once the typing stops, so the board is not rewritten on every keystroke.
      pending = setTimeout(async () => { board = setWidgetSetting(board, inst.id, 'text', area.value.slice(0, 4000)); await save(board) }, 600)
    })
    body.append(area)
    return 0
  },

  tasks(body) {
    void fill(body, 'tasks:list', [{ done: false }], (b, rows) => list(b, rows, (t) => String(t.title ?? t.name ?? 'Untitled')))
    return 0
  },
  reminders(body) {
    void fill(body, 'reminders:list', [], (b, rows) => list(b, rows, (t) => String(t.title ?? 'Untitled')))
    return 0
  },
  notes(body) {
    void fill(body, 'notes:list', [{}], (b, rows) => list(b, rows, (n) => String(n.title || n.text || 'Untitled').slice(0, 80)))
    return 0
  },
  clipboard(body) {
    void fill(body, 'clipboard:list', ['', 'text'], (b, rows) => list(b, rows, (c) => String(c.preview ?? c.text ?? '').slice(0, 80) || '(not text)'))
    return 0
  },
  workspaces(body) {
    void fill(body, 'workspaces:list', [], (b, rows) => list(b, rows, (w) => `${w.name ?? 'Workspace'}${typeof w.count === 'number' ? ` — ${w.count} tab${w.count === 1 ? '' : 's'}` : ''}`))
    return 0
  }
}

// ---------------------------------------------------------------- the board

let timers = []

function card(inst) {
  const def = widgetById(inst.widget)
  const box = el('section', `w-card w-${inst.size}`)
  box.setAttribute('aria-label', def.name)

  const head = el('header', 'w-head')
  head.append(el('h2', '', def.name))
  const acts = el('div', 'w-acts')
  const act = (label, title, fn) => { const b = el('button', 'w-icon', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', `${title}: ${def.name}`); b.addEventListener('click', fn); return b }
  acts.append(act('‹', 'Move earlier', async () => { board = moveWidget(board, inst.id, -1); await save(board); render() }))
  acts.append(act('›', 'Move later', async () => { board = moveWidget(board, inst.id, 1); await save(board); render() }))
  if (def.sizes.length > 1) acts.append(act('⤢', 'Change size', async () => { board = resizeWidget(board, inst.id); await save(board); render() }))
  acts.append(act('✕', 'Remove', async () => { board = removeWidget(board, inst.id); scratch.delete(inst.id); await save(board); render() }))
  head.append(acts)

  const body = el('div', 'w-body')
  box.append(head, body)
  const timer = RENDER[inst.widget](body, inst)
  if (timer) timers.push(timer)
  return box
}

export function render() {
  for (const t of timers) clearInterval(t)
  timers = []
  const host = $('widgets')
  if (!host) return
  host.replaceChildren(...board.map(card))
  host.hidden = board.length === 0
}

function openPicker() {
  const dlg = $('widgetDialog')
  const grid = $('widgetChoices')
  grid.replaceChildren()
  for (const w of WIDGETS) {
    const b = el('button', 'w-choice'); b.type = 'button'
    b.append(el('strong', '', w.name), el('span', '', w.description))
    b.addEventListener('click', async () => {
      const r = addWidget(board, w.id)
      if (!r.ok) { $('widgetError').textContent = r.error; return }
      board = r.widgets
      await save(board)
      dlg.close()
      render()
    })
    grid.append(b)
  }
  $('widgetError').textContent = ''
  dlg.showModal()
}

/**
 * Starts the board. `saved` is what was kept, `persist` writes it back, and `use12Hour` follows the page's own setting so
 * the clocks read the way the rest of the page does.
 */
export function mountWidgets({ saved, persist, use12Hour }) {
  board = normalizeWidgets(saved)
  save = persist
  hour12 = Boolean(use12Hour)
  $('addWidget')?.addEventListener('click', openPicker)
  $('widgetCancel')?.addEventListener('click', () => $('widgetDialog').close())
  render()
}

/** Called when the page's own settings change, so the clocks follow the 12/24-hour choice without a reload. */
export function widgetsFollowSettings(settings) {
  hour12 = Boolean(settings.hour12)
  render()
}
