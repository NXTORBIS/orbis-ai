/**
 * Clipboard history: what is kept, what is never kept, and how entries are searched and tidied. Pure — no clipboard, no
 * storage. Capture itself lives in the main process.
 */

export type ClipKind = 'text' | 'link' | 'image' | 'color' | 'code'

export interface ClipItem {
  id: string
  kind: ClipKind
  /** The copied text, or a data URL for an image. */
  content: string
  /** A short line for the list. */
  preview: string
  /** Where it was copied from, when Orbis knows. */
  source?: { url?: string; title?: string; app?: string }
  pinned: boolean
  copiedAt: number
  /** How many times it has been copied (a repeat moves it back to the top instead of adding a duplicate). */
  times: number
  /** Image size, when it is an image. */
  size?: { width: number; height: number }
  bytes: number
}

export interface ClipboardSettings {
  enabled: boolean
  /** How many entries to keep (pinned ones don't count). */
  limit: number
  /** Forget unpinned entries older than this many days; 0 keeps them. */
  keepDays: number
  captureImages: boolean
  /** Never capture while a private tab is in front. */
  skipPrivate: boolean
  /** Never capture from these sites. */
  blockedSites: string[]
  /** Skip anything that looks like a password, card number or key. */
  skipSecrets: boolean
}

export const DEFAULT_CLIPBOARD_SETTINGS: ClipboardSettings = {
  enabled: true,
  limit: 200,
  keepDays: 30,
  captureImages: true,
  skipPrivate: true,
  blockedSites: [],
  skipSecrets: true
}

export const MAX_CLIP_TEXT = 100_000
export const MAX_CLIP_IMAGE_BYTES = 4_000_000

/**
 * The longest a stored picture may be, counted in characters of its data url.
 *
 * A separate number from the byte limit above, and the reason it exists is a bug that made every large copied image
 * unviewable. The byte limit is checked against the real PNG when it is captured; the stored form is base64, which is
 * four characters for every three bytes. Slicing the data url at the *byte* number therefore cut a third off the end
 * of any image above about three megabytes -- and a data url cut mid-base64 is not a smaller picture, it is one no
 * browser can decode. It showed in the clipboard as a broken-image box.
 */
export const MAX_CLIP_IMAGE_CHARS = Math.ceil(MAX_CLIP_IMAGE_BYTES / 3) * 4 + 64

const CODE_HINTS = /(?:^|\n)\s*(?:function|const|let|var|class|import|export|def|public|private|#include|SELECT |<\/?[a-z][\w-]*>|\{\s*"[\w-]+":)/

/** What a copied piece of text is: a link, a color, code, or plain text. */
export function clipKind(text: string): ClipKind {
  const trimmed = text.trim()
  if (/^https?:\/\/\S+$/i.test(trimmed) && !/\s/.test(trimmed)) return 'link'
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\([\d\s.,%/]+\)$|^hsla?\([\d\s.,%/]+\)$/i.test(trimmed)) return 'color'
  if (CODE_HINTS.test(text) || (text.includes('\n') && /[;{}()=<>]/.test(text) && text.split('\n').some((l) => /^\s{2,}\S/.test(l)))) return 'code'
  return 'text'
}

/**
 * Text that should never be kept: anything that looks like a password manager entry, a card number, a private key or a
 * token. Better to miss a copy than to keep a secret.
 */
export function looksSecret(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed)) return true
  // Card numbers: 13–19 digits in groups, passing the Luhn check.
  const digits = trimmed.replace(/[\s-]/g, '')
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return true
  // Well-known token shapes.
  if (/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}\b/.test(trimmed)) return true
  /*
   * The hyphen form, which the underscore shapes above never matched.
   *
   * `sk_live_` is Stripe's. The model services hand out `sk-…`, `sk-proj-…` and `sk-ant-…`, and that is the key
   * somebody is most likely to copy and paste in a day of using Orbis — so of all the shapes here it was the one
   * that mattered most and the only one missing.
   */
  if (/\b(?:sk|pk)-(?:proj-|ant-|or-v1-|live-|test-)?[A-Za-z0-9_-]{20,}\b/.test(trimmed)) return true
  if (/^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(trimmed)) return true
  // A short single line with no spaces, mixing cases, digits and symbols: very likely a password.
  if (!/\s/.test(trimmed) && trimmed.length >= 8 && trimmed.length <= 64 && /[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed) && /\d/.test(trimmed) && /[^A-Za-z0-9]/.test(trimmed) && !/^https?:/i.test(trimmed)) return true
  return false
}

function luhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

export const clipPreview = (kind: ClipKind, content: string, size?: { width: number; height: number }): string =>
  kind === 'image' ? `Image${size ? ` ${size.width}×${size.height}` : ''}` : content.replace(/\s+/g, ' ').trim().slice(0, 200)

export const hostOf = (url: string | undefined): string => {
  if (!url) return ''
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** Whether a copy should be kept at all, given the settings and where it came from. */
export function shouldCapture(text: string, settings: ClipboardSettings, context: { private?: boolean; url?: string } = {}): { keep: boolean; reason?: string } {
  if (!settings.enabled) return { keep: false, reason: 'Clipboard history is off.' }
  if (!text.trim()) return { keep: false, reason: 'Nothing to keep.' }
  if (text.length > MAX_CLIP_TEXT) return { keep: false, reason: 'Too large to keep.' }
  if (settings.skipPrivate && context.private) return { keep: false, reason: 'Copied in a private tab.' }
  const host = hostOf(context.url)
  if (host && settings.blockedSites.some((site) => host === site.toLowerCase() || host.endsWith(`.${site.toLowerCase()}`))) return { keep: false, reason: `${host} is on the do-not-record list.` }
  if (settings.skipSecrets && looksSecret(text)) return { keep: false, reason: 'It looks like a password or key.' }
  return { keep: true }
}

/** Adds a copy to the history: a repeat moves up instead of duplicating, pinned entries always stay, the rest are capped. */
export function addClip(history: ClipItem[], item: ClipItem, settings: ClipboardSettings): ClipItem[] {
  const same = history.find((c) => c.kind === item.kind && c.content === item.content)
  const rest = same ? history.filter((c) => c !== same) : history
  const entry: ClipItem = same ? { ...same, copiedAt: item.copiedAt, times: same.times + 1, source: item.source ?? same.source } : item
  const next = [entry, ...rest]
  const pinned = next.filter((c) => c.pinned)
  const loose = next.filter((c) => !c.pinned).slice(0, Math.max(1, settings.limit))
  return [...pinned, ...loose].sort((a, b) => b.copiedAt - a.copiedAt)
}

/** Unpinned entries older than the setting allows are dropped. */
export function pruneClips(history: ClipItem[], settings: ClipboardSettings, time = Date.now()): ClipItem[] {
  if (!settings.keepDays) return history
  const cutoff = time - settings.keepDays * 86_400_000
  return history.filter((c) => c.pinned || c.copiedAt >= cutoff)
}

export function searchClips(history: ClipItem[], query: string, kind?: ClipKind | 'all' | 'pinned'): ClipItem[] {
  const q = query.trim().toLowerCase()
  return history
    .filter((c) => (kind === 'pinned' ? c.pinned : !kind || kind === 'all' || c.kind === kind))
    .filter((c) => !q || c.preview.toLowerCase().includes(q) || (c.kind !== 'image' && c.content.toLowerCase().includes(q)) || hostOf(c.source?.url).includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.copiedAt - a.copiedAt)
}

export function normalizeClip(raw: unknown): ClipItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<ClipItem>
  if (typeof r.id !== 'string' || !r.id || typeof r.content !== 'string' || !r.content) return null
  const kind: ClipKind = (['text', 'link', 'image', 'color', 'code'] as ClipKind[]).includes(r.kind as ClipKind) ? (r.kind as ClipKind) : 'text'
  if (kind === 'image' && !r.content.startsWith('data:image/')) return null
  // Refused rather than trimmed. Anything longer than this cannot be a picture within the byte limit, so it is
  // already damaged -- and storing a trimmed copy of damaged base64 only makes a broken image that looks kept.
  if (kind === 'image' && r.content.length > MAX_CLIP_IMAGE_CHARS) return null
  return {
    id: r.id,
    kind,
    // Text is trimmed; a picture never is, because every character of base64 is load-bearing.
    content: kind === 'image' ? r.content : r.content.slice(0, MAX_CLIP_TEXT),
    preview: (typeof r.preview === 'string' && r.preview) || clipPreview(kind, r.content, r.size),
    ...(r.source && typeof r.source === 'object' ? { source: { ...(r.source.url ? { url: String(r.source.url).slice(0, 2048) } : {}), ...(r.source.title ? { title: String(r.source.title).slice(0, 300) } : {}), ...(r.source.app ? { app: String(r.source.app).slice(0, 80) } : {}) } } : {}),
    pinned: r.pinned === true,
    copiedAt: Number(r.copiedAt) || Date.now(),
    times: Math.max(1, Math.round(Number(r.times) || 1)),
    ...(r.size && Number(r.size.width) ? { size: { width: Number(r.size.width), height: Number(r.size.height) } } : {}),
    bytes: Number(r.bytes) || r.content.length
  }
}

export function normalizeClipboardSettings(raw: unknown): ClipboardSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ClipboardSettings>
  return {
    enabled: r.enabled !== false,
    limit: Math.min(2000, Math.max(10, Math.round(Number(r.limit) || DEFAULT_CLIPBOARD_SETTINGS.limit))),
    keepDays: Math.min(365, Math.max(0, Math.round(Number(r.keepDays) ?? DEFAULT_CLIPBOARD_SETTINGS.keepDays))),
    captureImages: r.captureImages !== false,
    skipPrivate: r.skipPrivate !== false,
    blockedSites: [...new Set((Array.isArray(r.blockedSites) ? r.blockedSites : []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 200),
    skipSecrets: r.skipSecrets !== false
  }
}
