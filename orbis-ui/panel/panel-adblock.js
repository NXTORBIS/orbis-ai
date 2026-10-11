import { call } from './helper.js'

// Ad blocking, in the Orbis panel: the controls the Electron build had in its browser menu (on/off, strength, this page's
// results, a site exception, blocked resources, filter lists). Everything shown comes from the worker that does the
// blocking; nothing here counts or decides anything. Text is only ever put on the page as text.

const root = document.getElementById('block')
// The blocker's worker is a component of the browser; the built-in page reaches it through the helper (which the app connects
// to the worker), and an extension page reaches it directly.
const send = (message) => (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage ? chrome.runtime.sendMessage(message) : call('adblock:control', [message]))
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  node.append(...children.filter((c) => c !== null && c !== undefined))
  return node
}
const LABEL = { ads: 'Ads', trackers: 'Trackers', annoyances: 'Overlays & anti-adblock', popups: 'Popups', redirects: 'Ad redirects' }
const LEVELS = [
  ['standard', 'Standard', 'Strong blocking with the best site compatibility'],
  ['strict', 'Strict', 'Also overlays, anti-adblock walls, uncertain matches and third-party popups'],
  ['custom', 'Custom', 'Choose what to block']
]
const short = (url) => {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname.length > 1 ? u.pathname : ''}`
  } catch {
    return url
  }
}

let state = null
let notice = ''
let busy = false

async function load() {
  try {
    state = await send({ type: 'adblock:state' })
  } catch {
    state = null
  }
  draw()
}
async function act(message) {
  state = await send(message)
  draw()
}

function draw() {
  root.replaceChildren()
  if (!state) return void root.append(el('p', { class: 'empty' }, 'Ad blocking is not available.'))
  const { settings, report, tab, lists } = state
  const on = settings.enabled

  root.append(
    el('section', {}, el('div', { class: 'row' }, el('strong', { class: 'grow' }, on ? 'Ad blocking is on' : 'Ad blocking is off'), el('button', { onclick: () => act({ type: 'adblock:settings', update: { enabled: !on } }) }, on ? 'Turn off' : 'Turn on')),
      state.ready ? null : el('div', { class: 'muted' }, 'The filter lists are not built yet, so pages are not being filtered. Use “Update filters” below.'))
  )

  // This page: real counts from the blocking engine.
  const page = el('section', {}, el('h3', {}, 'This page'))
  if (report && /^https?:/.test(report.pageUrl)) {
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0)
    page.append(el('div', { class: 'big' }, String(total)), el('div', { class: 'muted' }, ['ads', 'trackers', 'annoyances', 'popups', 'redirects'].filter((c) => report.counts[c] > 0 || c === 'ads' || c === 'trackers').map((c) => `${report.counts[c]} ${LABEL[c].toLowerCase()}`).join(' · ') + ' blocked'))
    if (report.hidingRules) page.append(el('div', { class: 'muted' }, `${report.hidingRules} element-hiding rules and ${report.scriptlets} page fixes applied`))
    page.append(el('div', { class: 'row' }, el('span', { class: 'grow' }, report.host), el('button', { onclick: () => act({ type: 'adblock:site', host: report.host, allowed: !report.siteAllowed }) }, report.siteAllowed ? 'Block ads here again' : 'Allow ads on this site')))
    if (report.recent.length) {
      page.append(el('h3', {}, 'Recently handled'))
      for (const r of report.recent.slice(0, 12)) {
        page.append(el('div', { class: 'entry' }, el('span', { class: 'muted' }, r.action === 'blocked' ? r.category : r.action), el('span', { class: 'u', title: r.url }, short(r.url)), r.action === 'blocked' && r.type !== 'popup' ? el('button', { title: 'Let this resource load on every site', onclick: () => act({ type: 'adblock:resource', url: r.url }) }, 'Allow') : null))
      }
    }
  } else page.append(el('div', { class: 'muted' }, 'Open a web page to see what was blocked on it.'))
  root.append(page)

  // Strength.
  const strength = el('section', { class: 'seg' }, el('h3', {}, 'Blocking strength'))
  const buttons = el('div', { class: 'row' })
  for (const [id, label, hint] of LEVELS) buttons.append(el('button', { 'aria-pressed': String(settings.level === id), title: hint, onclick: () => act({ type: 'adblock:settings', update: { level: id } }) }, label))
  strength.append(buttons, el('div', { class: 'muted' }, LEVELS.find((l) => l[0] === settings.level)?.[2] ?? ''))
  if (settings.level === 'custom') {
    for (const c of ['ads', 'trackers', 'annoyances', 'popups', 'redirects']) {
      strength.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', ...(settings.custom[c] ? { checked: '' } : {}), onchange: (e) => act({ type: 'adblock:settings', update: { custom: { [c]: e.target.checked } } }) }), LABEL[c]))
    }
  }
  root.append(strength)

  // Exceptions.
  if (settings.siteExceptions.length || settings.resourceExceptions.length) {
    const ex = el('section', {}, el('h3', {}, 'Exceptions'))
    for (const s of settings.siteExceptions) ex.append(el('div', { class: 'entry' }, el('span', { class: 'muted' }, 'site'), el('span', { class: 'u' }, s), el('button', { onclick: () => act({ type: 'adblock:remove-exception', kind: 'site', value: s }) }, 'Remove')))
    for (const r of settings.resourceExceptions) ex.append(el('div', { class: 'entry' }, el('span', { class: 'muted' }, 'resource'), el('span', { class: 'u' }, r), el('button', { onclick: () => act({ type: 'adblock:remove-exception', kind: 'resource', value: r }) }, 'Remove')))
    root.append(ex)
  }

  // Filter lists.
  const filters = el('section', {}, el('h3', {}, 'Filter lists'))
  if (lists) {
    filters.append(el('div', { class: 'muted' }, `Version ${new Date(lists.version).toLocaleDateString?.() ?? lists.version} · ${lists.lists.length} lists · ${Object.values(lists.rulesets).reduce((a, r) => a + r.rules, 0).toLocaleString()} network rules`))
    for (const l of lists.lists) filters.append(el('div', { class: 'entry' }, el('span', { class: 'muted' }, l.category), el('span', { class: 'u' }, l.id), el('span', { class: 'muted' }, `${l.networkRules.toLocaleString()} rules`)))
  }
  if (notice) filters.append(el('div', { class: 'muted' }, notice))
  filters.append(el('div', { class: 'row' }, el('button', { ...(busy ? { disabled: '' } : {}), onclick: () => updateFilters('adblock:update', 'Filters updated.') }, busy ? 'Working…' : 'Update filters'), el('button', { ...(busy ? { disabled: '' } : {}), title: 'Go back to the previous set of filter lists', onclick: () => updateFilters('adblock:rollback', 'Went back to the previous filters.') }, 'Roll back')))
  root.append(filters)
}

async function updateFilters(channel, done) {
  busy = true
  notice = ''
  draw()
  try {
    const result = await call(channel)
    notice = result.failed?.length ? `${done} ${result.failed.length} list(s) could not be downloaded and were kept as they were.` : done
    await send({ type: 'adblock:reload-lists' }).catch(() => undefined)
  } catch (err) {
    notice = err?.message || 'The filters could not be updated.'
  }
  busy = false
  draw()
}

document.addEventListener('orbis:blocking-shown', () => void load())
// Results change as the page loads; keep them current while the tab is showing.
setInterval(() => { if (!document.getElementById('view-block').hidden && !busy) void load() }, 1500)

/*
 * And once, now, if this is the view the panel opened at.
 *
 * The event above is dispatched by `showTab`, which runs as the page loads for whichever view the address names --
 * before this module has been evaluated, so there is nobody listening yet. Without this, landing straight on
 * #block drew the frame and nothing in it, and going to another view and back filled it in: a fault that only
 * shows itself to somebody who opens the address directly and does not look twice.
 */
{
  const here = document.getElementById('view-block')
  if (here && !here.hidden) void load()
}
