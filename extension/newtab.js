// The Orbis new-tab page (Chromium chrome_url_overrides). Loads entirely from the extension; no request is made to any
// website to render it. Search uses chrome.search (the person's own engine); tiles are chrome.topSites.
//
// PARITY WITH THE ELECTRON START PAGE (details: docs/newtab-parity.md)
// Electron has: logo, private note, shortcuts grid (24, add/edit/remove, icons), widgets (clock, countdown, timer, tasks,
// notes, bookmarks, downloads, tabs, workspaces, clipboard, whiteboard, quote, games, calculator, greeting, world clock,
// weather, news, recent), wallpaper (image data URL or Orbis gradient), greeting (userName), clock option, quote option,
// "restore tabs", quick links.
// PORTED here: shortcuts (chrome.storage.local), greeting with name, clock (12h/24h, seconds), wallpaper (Orbis gradients
// + own image kept locally), countdown. Most-visited tiles stay (Chromium-native).
// NOT PORTED: weather/news (network feeds), quote (needs the Electron-side collection; not duplicated), tasks/notes/
// clipboard/whiteboard/workspaces/games/timer/calculator/world clock (live in the Orbis app's own stores, not reachable
// from an extension page), restore-last-time (Chromium's own session restore), private-tab note (extension pages do not
// know about incognito here).

import { GRADIENTS, MAX_IMAGE_BYTES, MAX_SHORTCUTS, clockText, countdownText, greetingText, normalizeSettings, removeShortcut, saveShortcut, siteUrl } from './newtab-logic.js'
import * as store from './newtab-store.js'

const $ = (id) => document.getElementById(id)
let state = { settings: normalizeSettings(null), shortcuts: [], image: '' }
let timer = 0

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
const favicon = (u) => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(u)}&size=32`

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
  else chrome.search.query({ text, disposition: 'CURRENT_TAB' })
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
    const top = await chrome.topSites.get()
    const nav = $('sites')
    // Chromium seeds the list with a Chrome Web Store tile before anything has been visited; that is Google's, not the person's.
    for (const s of top.filter((t) => !/^https:\/\/chrome(web)?store\.google\.com\//.test(t.url)).slice(0, 8)) nav.append(tile(s.url, s.title || hostOf(s.url)))
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
