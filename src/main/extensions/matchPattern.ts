/**
 * Chrome extension match patterns ("<all_urls>", "*://*.example.com/*", "https://site.org/path*"), as used by
 * host_permissions, tabs.query({ url }) and contextMenus documentUrlPatterns.
 * https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 */

const ALL_URLS_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'data:', 'file:'])

const escape = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

export function matchesPattern(pattern: string, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (pattern === '<all_urls>') return ALL_URLS_SCHEMES.has(parsed.protocol)
  const m = /^(\*|https?|wss?|file|ftp|urn|chrome-extension):\/\/(\*|\*\.[^/*]+|[^/*]+)?(\/.*)$/.exec(pattern)
  if (!m) return false
  const [, scheme, host = '', path] = m
  const protocol = parsed.protocol.slice(0, -1)
  if (scheme === '*' ? !['http', 'https', 'ws', 'wss'].includes(protocol) : scheme !== protocol) return false
  if (protocol !== 'file') {
    const hostname = parsed.hostname.toLowerCase()
    if (host === '*') {
      // any host
    } else if (host.startsWith('*.')) {
      const base = host.slice(2).toLowerCase()
      if (hostname !== base && !hostname.endsWith(`.${base}`)) return false
    } else if (host.toLowerCase() !== hostname && host.toLowerCase() !== parsed.host.toLowerCase()) return false
  }
  const target = `${parsed.pathname}${parsed.search}`
  return new RegExp(`^${path.split('*').map(escape).join('.*')}$`).test(target)
}

export const matchesAny = (patterns: readonly string[], url: string): boolean => patterns.some((p) => matchesPattern(p, url))

/** Whether a manifest entry is a host pattern (host_permissions, or MV2-style hosts listed among permissions). */
export const isHostPattern = (entry: string): boolean => entry === '<all_urls>' || /^[a-z*-]+:\/\//i.test(entry)
