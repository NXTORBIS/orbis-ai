type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const MAX_ICON_BYTES = 300_000
const MAX_PAGE_CHARS = 600_000

/** A site address as typed ("github.com") made into a web URL, or null when it isn't one. */
export function toSiteUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.toString()
  } catch {
    return null
  }
}

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

/** How good an icon link is: bigger (up to about 192px) is better; Apple touch icons are large full-colour logos. */
function score(rel: string, sizes: string, type: string, href: string): number {
  const dims = [...sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)].map((m) => Math.max(Number(m[1]), Number(m[2])))
  let size = dims.length ? Math.max(...dims) : 0
  if (/any/i.test(sizes) || /svg/i.test(type) || /\.svg(\?|$)/i.test(href)) size = Math.max(size, 256)
  if (!size) size = rel.includes('apple-touch-icon') ? 180 : 32
  return size >= 48 ? 1000 - Math.abs(Math.min(size, 512) - 128) : size
}

/** The icons a page declares, best first, resolved to absolute URLs; the site's /favicon.ico is always the last resort. */
export function iconCandidates(html: string, pageUrl: string): string[] {
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }
  // The last resort is always the site's own /favicon.ico, even when the page sets a <base> elsewhere.
  const siteOrigin = base.origin
  const baseTag = /<base\b[^>]*>/i.exec(html)
  if (baseTag) {
    try {
      base = new URL(attrs(baseTag[0]).href ?? '', base)
    } catch {
      // A broken <base> is ignored.
    }
  }
  const found: { url: string; score: number; order: number }[] = []
  let order = 0
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0])
    const rel = (a.rel ?? '').toLowerCase()
    // mask-icon is a single-colour silhouette meant for Safari pinned tabs, not a logo.
    if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(rel) || rel.includes('mask-icon') || !a.href) continue
    try {
      const url = new URL(a.href, base)
      if (!/^https?:$/.test(url.protocol) && !/^data:image\//i.test(a.href)) continue
      found.push({ url: /^data:/i.test(a.href) ? a.href : url.toString(), score: score(rel, a.sizes ?? '', a.type ?? '', a.href), order: order++ })
    } catch {
      // Unusable href.
    }
  }
  const ranked = found.sort((x, y) => y.score - x.score || x.order - y.order).map((f) => f.url)
  const fallback = `${siteOrigin}/favicon.ico`
  return [...new Set([...ranked, fallback])]
}

/** The real image type from the file's first bytes; headers are not trusted. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes
  if (b.length < 4) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return 'image/x-icon'
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp'
  const head = new TextDecoder().decode(b.slice(0, 512)).trimStart().toLowerCase()
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg')) return 'image/svg+xml'
  return null
}

async function fetchIcon(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<string | null> {
  if (/^data:image\//i.test(url)) return url.length <= MAX_ICON_BYTES * 1.4 ? url : null
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' } })
  if (!res.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_ICON_BYTES) return null
  const type = sniffImageType(bytes)
  return type ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null
}

/**
 * The site's own logo or favicon as a data URL, read from the page's icon links (best first) or its /favicon.ico.
 * Resolves null when the site has no usable icon or can't be reached.
 */
export async function fetchFavicon(siteUrl: string, fetchFn: FetchFn, timeoutMs = 8000): Promise<string | null> {
  const url = toSiteUrl(siteUrl)
  if (!url) return null
  let candidates: string[]
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'text/html,application/xhtml+xml' } })
    const html = res.ok && /html/i.test(res.headers.get('content-type') ?? 'text/html') ? (await res.text()).slice(0, MAX_PAGE_CHARS) : ''
    candidates = iconCandidates(html, res.url || url)
  } catch {
    candidates = iconCandidates('', url)
  }
  for (const candidate of candidates.slice(0, 6)) {
    try {
      const icon = await fetchIcon(candidate, fetchFn, timeoutMs)
      if (icon) return icon
    } catch {
      // Try the next one.
    }
  }
  return null
}
