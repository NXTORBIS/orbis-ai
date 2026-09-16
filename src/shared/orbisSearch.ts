/**
 * Orbis Search: searching without leaving Orbis.
 *
 * Typing a question in the address bar has always meant being handed to somebody else's website, with their logo and
 * their idea of what an answer looks like. This is the other way round: Orbis asks the web on your behalf, Orion reads
 * what came back, and the result is shown on a page that belongs to Orbis.
 *
 * Nothing here searches anything. It decides what a search *is*: the address of the results page, how a query travels
 * in it, and when somebody has asked for a particular site rather than for an answer.
 *
 * Pure — no browser, no network.
 */

/** Orbis's own pages. In Chromium these become real internal pages; the shape is chosen now so it does not change. */
export const ORBIS_SCHEME = 'orbis:'
export const SEARCH_PAGE = 'orbis://search'

/**
 * What Orbis Search can be asked for.
 *
 * "all" is ordinary web search and goes to its own provider. Everything else is a specialized category and goes to the
 * specialized provider, which queries sources that actually hold that kind of thing. The two are separate on purpose:
 * either can be replaced, or be down, without the other noticing.
 */
export type SearchVertical = 'all' | 'images' | 'videos' | 'news' | 'maps' | 'music' | 'science' | 'files' | 'social'
export const VERTICALS: SearchVertical[] = ['all', 'images', 'videos', 'news', 'maps', 'music', 'science', 'files', 'social']

/** Ordinary web search, as opposed to a category with sources of its own. */
export const isWebSearch = (vertical: SearchVertical): boolean => vertical === 'all'

/** Where a search lives, as an address a tab can hold and history can remember. */
export function searchPageUrl(query: string, vertical: SearchVertical = 'all'): string {
  const q = encodeURIComponent(query.trim())
  return vertical === 'all' ? `${SEARCH_PAGE}?q=${q}` : `${SEARCH_PAGE}?q=${q}&in=${vertical}`
}

/** What a search page is showing, or null when the address is not one. */
export function readSearchPageUrl(url: string): { query: string; vertical: SearchVertical } | null {
  if (!url.toLowerCase().startsWith(SEARCH_PAGE)) return null
  try {
    const parsed = new URL(url)
    const query = (parsed.searchParams.get('q') ?? '').trim()
    const asked = parsed.searchParams.get('in') as SearchVertical | null
    return { query, vertical: asked && VERTICALS.includes(asked) ? asked : 'all' }
  } catch {
    return null
  }
}

export const isOrbisPage = (url: string): boolean => url.toLowerCase().startsWith(ORBIS_SCHEME)

/**
 * Searching somewhere in particular.
 *
 * `!g something` goes to Google, `!yt something` to YouTube. Orbis's own search is the default rather than the only
 * choice: when what you want is the ten blue links, they are one keystroke away, and nobody has to change a setting
 * to get them.
 */
export const BANGS: Record<string, { name: string; url: string }> = {
  g: { name: 'Google', url: 'https://www.google.com/search?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  b: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  w: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  wiki: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  gh: { name: 'GitHub', url: 'https://github.com/search?q=' },
  so: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
  npm: { name: 'npm', url: 'https://www.npmjs.com/search?q=' },
  a: { name: 'Amazon', url: 'https://www.amazon.com/s?k=' },
  r: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
  maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/' }
}

/** A bang and what was asked, when one was used. The bang may lead or trail: both read naturally. */
export function readBang(input: string): { bang: string; site: { name: string; url: string }; query: string } | null {
  const text = input.trim()
  const leading = /^!([a-z]{1,12})\s+(.+)$/i.exec(text)
  const trailing = /^(.+?)\s+!([a-z]{1,12})$/i.exec(text)
  const match = leading ? { word: leading[1], query: leading[2] } : trailing ? { word: trailing[2], query: trailing[1] } : null
  if (!match) return null
  const site = BANGS[match.word.toLowerCase()]
  return site ? { bang: match.word.toLowerCase(), site, query: match.query.trim() } : null
}

/** Where typed text should go: somebody else's site when they asked for one, and Orbis Search when they did not. */
export function searchDestination(input: string, vertical: SearchVertical = 'all'): { url: string; where: string } {
  const bang = readBang(input)
  if (bang) return { url: `${bang.site.url}${encodeURIComponent(bang.query)}`, where: bang.site.name }
  return { url: searchPageUrl(input, vertical), where: 'Orbis Search' }
}

// ---------------------------------------------------------------- what a results page holds

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** The site it came from, shown instead of the whole address. */
  site: string
}

export interface SearchAnswer {
  /** What Orion made of it, as it arrives. */
  text: string
  /** Which results it drew on, by index, so the answer can be traced back to something real. */
  used: number[]
  /** Still being written. */
  streaming: boolean
}

export interface SearchPage {
  query: string
  vertical: SearchVertical
  results: SearchResult[]
  answer: SearchAnswer | null
  /** Why there is nothing, when there is nothing. */
  problem: string | null
  /** How long the web took, so slowness is visible rather than mysterious. */
  tookMs: number
}

/** The site a result is from, as a person would say it: "wikipedia.org", not "https://en.wikipedia.org/wiki/…". */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/** Results worth showing: no duplicates, nothing from a search engine itself, and the best first. */
export function tidyResults(hits: { title: string; url: string; snippet: string }[], limit = 12): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const hit of hits) {
    const site = siteOf(hit.url)
    // A link back to another search engine is not a result; it is the thing being replaced.
    if (/^(www\.)?(google|bing|duckduckgo|yahoo|yandex)\./i.test(site)) continue
    const key = hit.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ title: hit.title.trim() || site, url: hit.url, snippet: hit.snippet.trim(), site })
    if (out.length >= limit) break
  }
  return out
}

/** Whether a question is worth Orion writing an answer for, or whether the links speak for themselves. */
export function wantsAnswer(query: string): boolean {
  const text = query.trim().toLowerCase()
  if (text.length < 8) return false
  // Somebody looking for a particular site wants that site, not an essay about it.
  if (/^[a-z0-9-]+\.(com|org|net|io|dev|ai)$/i.test(text)) return false
  if (/^(facebook|youtube|gmail|twitter|x|instagram|reddit|amazon|netflix|spotify)$/i.test(text)) return false
  return /\b(how|why|what|when|where|who|which|should|can|does|is|are|compare|vs|versus|best|difference|explain|meaning)\b/.test(text) || text.split(/\s+/).length >= 4
}
