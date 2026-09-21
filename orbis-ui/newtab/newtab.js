// The Orbis new tab page: chrome://orbis-newtab, built into the browser (a WebUI, not an extension page). Chromium's new tab page URL
// resolves to it, so a new tab, Ctrl+T, a new window and startup all show it from the first paint. No request is made to any website
// to render it.
//
// Kept from the extension's page (details: docs/newtab-parity.md): search, greeting with name, clock (12h/24h, seconds), countdown,
// wallpaper (Orbis gradients or a picture kept locally), shortcuts (add/edit/remove), most visited, customization; all per profile.
// Searching and most-visited tiles come from the browser through the built-in handler. The quote, widgets and timers of the old
// Electron start page live in the Orbis app's own stores and are not on this page (see the parity doc).

import { GRADIENTS, MAX_IMAGE_BYTES, MAX_SHORTCUTS, clockText, countdownText, greetingText, normalizeSettings, removeShortcut, saveShortcut, siteUrl } from './newtab-logic.js'
import * as store from './newtab-store.js'
import { askBrowser } from './helper.js'
import { mountOrb } from './orb.js'

const $ = (id) => document.getElementById(id)
let state = { settings: normalizeSettings(null), shortcuts: [], image: '' }
let timer = 0

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
const favicon = (u) => `chrome://favicon2/?size=32&scaleFactor=2x&pageUrl=${encodeURIComponent(u)}`

function applyWallpaper() {
  const s = state.settings
  if (s.wallpaper === 'image' && state.image) {
    document.body.style.background = `center / cover no-repeat url("${state.image}")`
  } else {
    const g = GRADIENTS.find((x) => x.id === s.wallpaper) || GRADIENTS[0]
    document.body.style.background = g.css
  }
}

function tick() {
  const s = state.settings
  const now = new Date()
  $('greeting').textContent = s.greeting ? greetingText(now, s.name) : 'Orbis'
  $('clock').textContent = s.clock ? clockText(now, s) : ''
  $('countdown').textContent = countdownText(s.countdown, now)
}
function schedule() {
  clearInterval(timer)
  timer = setInterval(tick, state.settings.seconds ? 1000 : 15_000)
}

function looksLikeUrl(text) {
  if (/\s/.test(text)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return null
}
$('search').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('q').value.trim()
  if (!text) return
  const url = looksLikeUrl(text)
  if (url) location.href = url
  else askBrowser('orbis.search', text).catch(() => { location.href = `chrome://orbis-search/#q=${encodeURIComponent(text)}` })
})

function tile(href, name, extra) {
  const wrap = el('div', 'tile')
  const a = el('a', 'site')
  a.href = href
  const ico = el('div', 'ico')
  const img = el('img'); img.alt = ''; img.src = favicon(href)
  img.addEventListener('error', () => { img.remove(); ico.textContent = (name || '?').slice(0, 1).toUpperCase() })
  ico.append(img)
  a.append(ico, el('span', '', name))
  wrap.append(a)
  if (extra) wrap.append(...extra)
  return wrap
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

function renderShortcuts() {
  const box = $('shortcuts')
  box.replaceChildren()
  box.hidden = !state.settings.shortcuts
  if (!state.settings.shortcuts) return
  for (const s of state.shortcuts) {
    const name = s.name || hostOf(s.url)
    const edit = el('button', 'mini', 'Edit'); edit.type = 'button'; edit.setAttribute('aria-label', `Edit ${name}`)
    edit.addEventListener('click', () => openShortcutForm(s))
    const del = el('button', 'mini', 'Remove'); del.type = 'button'; del.setAttribute('aria-label', `Remove ${name}`)
    del.addEventListener('click', async () => { state.shortcuts = removeShortcut(state.shortcuts, s.id); await store.saveShortcuts(state.shortcuts); renderShortcuts() })
    box.append(tile(s.url, name, [el('div', 'acts')]))
    box.lastChild.querySelector('.acts').append(edit, del)
  }
  if (state.shortcuts.length < MAX_SHORTCUTS) {
    const add = el('button', 'site addtile'); add.type = 'button'
    add.append(el('div', 'ico', '+'), el('span', '', 'Add shortcut'))
    add.addEventListener('click', () => openShortcutForm(null))
    box.append(add)
  }
  if (!state.shortcuts.length) $('empty').hidden = false
  else $('empty').hidden = true
}

function openShortcutForm(existing) {
  const dlg = $('shortcutDialog')
  $('scTitle').textContent = existing ? 'Edit shortcut' : 'Add shortcut'
  $('scName').value = existing ? existing.name : ''
  $('scUrl').value = existing ? existing.url : ''
  $('scError').textContent = ''
  dlg.dataset.id = existing ? existing.id : ''
  dlg.showModal()
  $('scUrl').focus()
}
$('shortcutForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const dlg = $('shortcutDialog')
  const r = saveShortcut(state.shortcuts, { id: dlg.dataset.id || undefined, name: $('scName').value, url: $('scUrl').value })
  if (!r.ok) { $('scError').textContent = r.error; return }
  state.shortcuts = r.shortcuts
  await store.saveShortcuts(state.shortcuts)
  dlg.close()
  renderShortcuts()
})
$('scCancel').addEventListener('click', () => $('shortcutDialog').close())

async function topSites() {
  try {
    const top = await askBrowser('orbis.mostVisited')
    const nav = $('sites')
    // Chromium seeds the list with a Chrome Web Store tile before anything has been visited; that is Google's, not the person's.
    for (const s of top.filter((t) => !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com\/)/.test(t.url)).slice(0, 8)) nav.append(tile(s.url, s.title || hostOf(s.url)))
  } catch { /* no history yet */ }
}

// ---- settings dialog
function fillSettings() {
  const s = state.settings
  $('sName').value = s.name; $('sGreeting').checked = s.greeting; $('sClock').checked = s.clock; $('sHour12').checked = s.hour12
  $('sSeconds').checked = s.seconds; $('sShortcuts').checked = s.shortcuts
  $('sCdLabel').value = s.countdown ? s.countdown.label : ''; $('sCdDate').value = s.countdown ? s.countdown.date : ''
  const sel = $('sWallpaper'); sel.replaceChildren()
  for (const g of GRADIENTS) { const o = el('option', '', g.name); o.value = g.id; sel.append(o) }
  if (state.image) { const o = el('option', '', 'My picture'); o.value = 'image'; sel.append(o) }
  sel.value = s.wallpaper === 'image' && !state.image ? 'orbis' : s.wallpaper
  $('sError').textContent = ''
}
$('openSettings').addEventListener('click', () => { fillSettings(); $('settingsDialog').showModal() })
$('sCancel').addEventListener('click', () => $('settingsDialog').close())
$('sPicture').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type) || f.size > MAX_IMAGE_BYTES) { $('sError').textContent = 'Pick a PNG, JPEG or WebP picture under 2 MB'; return }
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })
  state.image = data
  try { await store.saveImage(data) } catch { $('sError').textContent = 'Could not keep that picture'; state.image = ''; return }
  fillSettings(); $('sWallpaper').value = 'image'
})
$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const date = $('sCdDate').value
  state.settings = normalizeSettings({
    name: $('sName').value, greeting: $('sGreeting').checked, clock: $('sClock').checked, hour12: $('sHour12').checked,
    seconds: $('sSeconds').checked, shortcuts: $('sShortcuts').checked, wallpaper: $('sWallpaper').value,
    countdown: date ? { label: $('sCdLabel').value, date } : null
  })
  await store.saveSettings(state.settings)
  $('settingsDialog').close()
  render()
})

function render() { applyWallpaper(); tick(); schedule(); renderShortcuts() }

async function init() {
  try { state = await store.load() } catch { /* storage unavailable: defaults */ }
  render()
  void topSites()
}
void init()
mountOrb()
