// The Orbis new tab page: chrome://orbis-newtab, built into the browser (a WebUI, not an extension page). Chromium's new tab page URL
// resolves to it, so a new tab, Ctrl+T, a new window and startup all show it from the first paint. No request is made to any website
// to render it.
//
// Kept from the extension's page (details: docs/newtab-parity.md): search, greeting with name, clock (12h/24h, seconds), countdown,
// wallpaper (Orbis gradients or a picture kept locally), shortcuts (add/edit/remove), most visited, customization; all per profile.
// Searching and most-visited tiles come from the browser through the built-in handler.
//
// The widgets are the other half of this page. They are not kept here: they belong to the person, with everything else
// personal, in Orbis's own store, and this page asks for them (widgets/main.ts). So the same widgets are there in every
// window, Orion can change them, and the gallery shows exactly what a widget will look like before it is added.

import { GRADIENTS, MAX_IMAGE_BYTES, MAX_SHORTCUTS, MAX_TILES, clockText, countdownText, normalizeSettings, removeShortcut, saveShortcut, siteUrl } from './newtab-logic.js'
import * as store from './newtab-store.js'
import { askBrowser, call } from './helper.js'
// The look the person chose in Orbis, worn here too: the browser and the chat are one application.
import { followAppearance } from './appearance.js'
import { introWanted, runIntro } from './intro.js'
import { mountWidgets } from './widgets.js'
import { mountRail, mountMusicEntry } from './rail.js'

const $ = (id) => document.getElementById(id)
let state = { settings: normalizeSettings(null), shortcuts: [], top: [], widgets: [], image: '' }
let timer = 0
/** The widgets, once they are mounted: the way to open the gallery and to start arranging. */
let widgets = null

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
const favicon = (u) => `chrome://favicon2/?size=32&scaleFactor=2x&pageUrl=${encodeURIComponent(u)}`

// Asked for as early as there is a document, so the page is wearing the right look before anything is read.
void followAppearance()

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
// Two search boxes would be two places to type, and only one of them is where what you type goes. Touching the one on
// the page hands the caret to the window's own address bar, exactly as the Electron browser did. The page's box is kept
// because it is where the eye lands on a new tab; it is a way in to the real one, not a second one.
const toOmnibox = (e) => { e.preventDefault(); $('q').blur(); askBrowser('orbis.focusOmnibox').catch(() => { /* not in a browser window: the box below stays usable */ }) }
$('q').addEventListener('pointerdown', toOmnibox)
$('q').addEventListener('focus', toOmnibox)

/**
 * Ctrl+Enter asks Orion instead of searching.
 *
 * Not "search, then offer Orion at the top": a question you already know you want answered should not cost you a page
 * of links first. So the same words go to the same place, and the key says which of the two things you wanted.
 * Recorded on the way down because the submit that follows cannot see which keys were held.
 */
let askOrion = false
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) askOrion = true
})

$('search').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('q').value.trim()
  const orion = askOrion
  askOrion = false
  if (!text) return
  const url = looksLikeUrl(text)
  if (url) return void (location.href = url)
  if (orion) {
    location.href = `chrome://orbis-search/#q=${encodeURIComponent(text)}&in=orion`
    return
  }
  askBrowser('orbis.search', text).catch(() => { location.href = `chrome://orbis-search/#q=${encodeURIComponent(text)}` })
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

/**
 * One row of tiles, the way a new tab page is read: the shortcuts somebody kept, then the sites they actually use, then
 * a way to add one. It used to be two rows -- kept shortcuts above, most visited below -- which showed the same site
 * twice under two names and read as two unrelated lists.
 */
function renderShortcuts() {
  const box = $('shortcuts')
  box.replaceChildren()
  box.hidden = !state.settings.shortcuts
  if (!state.settings.shortcuts) return

  const seen = new Set()
  for (const s of state.shortcuts) {
    seen.add(hostOf(s.url))
    const name = s.name || hostOf(s.url)
    const edit = el('button', 'mini', 'Edit'); edit.type = 'button'; edit.setAttribute('aria-label', `Edit ${name}`)
    edit.addEventListener('click', () => openShortcutForm(s))
    const del = el('button', 'mini', 'Remove'); del.type = 'button'; del.setAttribute('aria-label', `Remove ${name}`)
    del.addEventListener('click', async () => { state.shortcuts = removeShortcut(state.shortcuts, s.id); await store.saveShortcuts(state.shortcuts); renderShortcuts() })
    box.append(tile(s.url, name, [el('div', 'acts')]))
    box.lastChild.querySelector('.acts').append(edit, del)
  }

  // A site that is already a shortcut is not shown again under whatever the page happens to call itself.
  const room = Math.max(0, MAX_TILES - state.shortcuts.length)
  for (const site of state.top.filter((t) => !seen.has(hostOf(t.url))).slice(0, room)) {
    seen.add(hostOf(site.url))
    box.append(tile(site.url, site.title || hostOf(site.url)))
  }

  if (state.shortcuts.length < MAX_SHORTCUTS) {
    const add = el('button', 'site addtile'); add.type = 'button'
    add.append(el('div', 'ico', '+'), el('span', '', 'Add shortcut'))
    add.addEventListener('click', () => openShortcutForm(null))
    box.append(add)
  }
  $('empty').hidden = Boolean(state.shortcuts.length || state.top.length)
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
    // Chromium seeds the list with a Chrome Web Store tile before anything has been visited; that is Google's, not the person's.
    state.top = top.filter((t) => !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com\/)/.test(t.url))
    renderShortcuts()
  } catch { /* no history yet */ }
}

// ---- settings dialog
function fillSettings() {
  const s = state.settings
  $('sClock').checked = s.clock; $('sHour12').checked = s.hour12
  $('sSeconds').checked = s.seconds; $('sShortcuts').checked = s.shortcuts; $('sRail').checked = s.rail
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
    clock: $('sClock').checked, hour12: $('sHour12').checked,
    seconds: $('sSeconds').checked, shortcuts: $('sShortcuts').checked, rail: $('sRail').checked, wallpaper: $('sWallpaper').value,
    countdown: date ? { label: $('sCdLabel').value, date } : null
  })
  await store.saveSettings(state.settings)
  $('settingsDialog').close()
  render()
})

function render() { applyWallpaper(); tick(); schedule(); renderShortcuts(); mountRail($('rail'), state.settings.rail) }

/*
 * Orbis Music, on every new tab.
 *
 * Mounted once rather than on every render: it keeps itself up to date, and a page that redraws its shortcuts has
 * no reason to rebuild the music line.
 */
void mountMusicEntry($('musicEntry'), call)

async function load() {
  try { state = { ...state, ...(await store.load()) } } catch { /* storage unavailable: defaults */ }
  render()
  /*
   * The widgets.
   *
   * Everything about them is Orbis's: this page hands over where to draw them, a way to read its own clock setting,
   * and the board it used to keep for itself, which Orbis takes in once.
   */
  widgets = mountWidgets({ host: $('widgets'), hour12: () => state.settings.hour12, legacy: state.widgets })
  $('openWidgets').addEventListener('click', () => widgets.openGallery())
  void topSites()
}

async function init() {
  // The introduction is asked for before anything is drawn, so the page is never seen and then covered over.
  if (!(await introWanted())) return void load()
  await runIntro(document, async ({ say }) => {
    say('Loading your page')
    await load()
  })
}
void init()
