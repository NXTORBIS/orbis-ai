// Pure logic for the new-tab page: no DOM, no chrome.* (tested with node --test).
export const MAX_SHORTCUTS = 24
/** Tiles in the row altogether: the kept shortcuts and the sites in use, before it stops being a row. */
export const MAX_TILES = 10
export const MAX_IMAGE_BYTES = 2_000_000
export const GRADIENTS = [
  /*
   * The Orbis background is the one the chat draws, not a copy of it in different colours.
   *
   * It used to be three hardcoded hexes, applied as an inline style -- which beat the stylesheet, ignored the theme,
   * and meant a light theme or an appearance preset reached the chat and stopped at the new tab. Written in the
   * shared tokens it follows both, and `--preset-background` lets a preset repaint this the way it repaints the chat.
   */
  {
    id: 'orbis',
    name: 'Orbis',
    css: 'var(--preset-background, radial-gradient(ellipse 80% 70% at 50% 45%, var(--bg-center) 0%, var(--bg-mid) 55%, var(--bg-edge) 100%))'
  },
  { id: 'aurora', name: 'Aurora', css: 'linear-gradient(135deg, #0b0e14 0%, #0f2a3a 55%, #12394a 100%)' },
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(160deg, #0b0e14 0%, #22163a 60%, #3a1d4a 100%)' },
  { id: 'forest', name: 'Forest', css: 'linear-gradient(150deg, #0b0e14 0%, #0f2a1f 100%)' }
]
export const DEFAULT_SETTINGS = { clock: true, hour12: false, seconds: false, shortcuts: true, rail: true, wallpaper: 'orbis', countdown: null }

/** A typed address as an http(s) URL (https:// added), or null. Same rule as the Electron ShortcutsGrid. */
export function siteUrl(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return /^https?:$/.test(url.protocol) && (url.hostname.includes('.') || url.hostname === 'localhost') ? url.toString() : null
  } catch { return null }
}

export function normalizeShortcuts(raw) {
  const out = []
  const seen = new Set()
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || seen.has(s.id)) continue
    const url = siteUrl(s.url)
    if (!url) continue
    seen.add(s.id)
    out.push({ id: s.id.slice(0, 64), url, name: String(s.name ?? '').trim().slice(0, 60) })
    if (out.length >= MAX_SHORTCUTS) break
  }
  return out
}

/** Returns { ok, shortcuts } or { ok:false, error }. id given = edit, otherwise add. */
export function saveShortcut(list, { id, name, url }, makeId = () => Math.random().toString(36).slice(2, 12)) {
  const clean = siteUrl(url)
  if (!clean) return { ok: false, error: 'Enter a web address such as example.com' }
  const label = String(name ?? '').trim().slice(0, 60)
  if (id) {
    if (!list.some((s) => s.id === id)) return { ok: false, error: 'That shortcut no longer exists' }
    return { ok: true, shortcuts: list.map((s) => (s.id === id ? { ...s, name: label, url: clean } : s)) }
  }
  if (list.length >= MAX_SHORTCUTS) return { ok: false, error: `You can keep up to ${MAX_SHORTCUTS} shortcuts` }
  if (list.some((s) => s.url === clean)) return { ok: false, error: 'That site is already a shortcut' }
  return { ok: true, shortcuts: [...list, { id: makeId(), url: clean, name: label }] }
}
export const removeShortcut = (list, id) => list.filter((s) => s.id !== id)

export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const b = (v, d) => (typeof v === 'boolean' ? v : d)
  const wallpaper = typeof r.wallpaper === 'string' && (r.wallpaper === 'image' || GRADIENTS.some((g) => g.id === r.wallpaper)) ? r.wallpaper : DEFAULT_SETTINGS.wallpaper
  const c = r.countdown
  const countdown = c && typeof c === 'object' && typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && !Number.isNaN(Date.parse(c.date))
    ? { label: String(c.label ?? '').trim().slice(0, 60), date: c.date } : null
  return { clock: b(r.clock, true), hour12: b(r.hour12, false), seconds: b(r.seconds, false), shortcuts: b(r.shortcuts, true), rail: b(r.rail, true), wallpaper, countdown }
}

export function clockText(date, { hour12 = false, seconds = false } = {}, locale) {
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12 })
  const day = date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
  return `${day}, ${time}`
}
/** Whole days from today (local) until the date; negative once passed. */
export function daysUntil(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const a = Date.UTC(y, m - 1, d)
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / 86_400_000)
}
export function countdownText(c, now = new Date()) {
  if (!c) return ''
  const n = daysUntil(c.date, now)
  const what = c.label || 'the date'
  return n === 0 ? `${what}: today` : n > 0 ? `${n} day${n === 1 ? '' : 's'} until ${what}` : `${what}: ${-n} day${n === -1 ? '' : 's'} ago`
}
