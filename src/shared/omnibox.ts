import type { BrowserBookmark, BrowserHistoryEntry, BrowserPick, BrowserSearchEntry } from './types'

/** What a line typed in the address bar is for. The first detected intent is the main one. */
export type OmniIntent = 'url' | 'question' | 'news' | 'images' | 'videos' | 'shopping' | 'search'

export type SuggestionKind =
  | 'navigate' // open what was typed, or the address it completes to
  | 'query' // search for what was typed
  | 'history'
  | 'search' // a search the user ran before
  | 'bookmark'
  | 'research' // a question Orion researched
  | 'web' // the search engine's suggestion
  | 'orion' // Orion's prediction
  | 'site' // search inside a specific site
  | 'vertical' // news / images / videos / shopping results

export interface OmniSuggestion {
  /** Stable identity: "u:" + page key, or "q:" + lower-cased query. */
  id: string
  kind: SuggestionKind
  /** Main line: a page title or a query. */
  text: string
  /** Second line: domain, address, when, or where the suggestion came from. */
  detail?: string
  /** Opens this address. */
  url?: string
  /** Searches this. */
  query?: string
  /** What removing it deletes. */
  removable?: 'history' | 'search'
  bookmarked?: boolean
  /** Grouping label for the list shown before typing. */
  section?: string
  score: number
}

export interface OmniResult {
  items: OmniSuggestion[]
  /** The address the typed text completes to inline (it always starts with the typed text), or null. */
  completion: string | null
}

export interface OmniSources {
  history: BrowserHistoryEntry[]
  bookmarks: BrowserBookmark[]
  searches: BrowserSearchEntry[]
  picks: Record<string, BrowserPick>
  /** Questions Orion researched in saved chats. */
  research: { question: string; at: number }[]
  /** The search engine's suggestions for the current text. */
  web: string[]
  /** Orion's predictions for the current text. */
  orion: string[]
  now: number
  /** Use the user's own history, searches, bookmarks and research. */
  personalized: boolean
  /** The page the browser is on, left out of "recently visited". */
  currentUrl?: string
}

const GOOGLE = 'https://www.google.com/search'
const DAY = 86_400_000

/** File extensions that look like top-level domains ("node.js", "index.html") but are almost always searches. */
const NOT_TLD = new Set(
  'js ts jsx tsx mjs cjs py rb php java kt cpp cs go rs json txt md csv log ini yml yaml toml exe dll msi zip rar pdf doc docx xls xlsx ppt pptx css scss html htm xml svg png jpg jpeg gif webp mp3 mp4 mov wav'.split(' ')
)

const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i
const DOMAIN = /^([^\s/@]+)\.([a-z]{2,})(:\d+)?(\/\S*)?$/i

/** Typed text is an address to open rather than something to search. */
export function isAddress(input: string): boolean {
  const text = input.trim()
  if (/^https?:\/\/\S+$/i.test(text) || LOCAL.test(text)) return true
  const m = DOMAIN.exec(text)
  if (!m) return false
  // "node.js" searches; "github.io", "www.site.md", "example.py/docs" or "host.js:8080" open.
  return !NOT_TLD.has(m[2].toLowerCase()) || /^www\./i.test(text) || Boolean(m[3] || m[4])
}

export function searchUrl(query: string, vertical?: 'news' | 'images' | 'videos' | 'shopping'): string {
  const tbm = { news: 'nws', images: 'isch', videos: 'vid', shopping: 'shop' }
  return `${GOOGLE}?q=${encodeURIComponent(query.trim())}${vertical ? `&tbm=${tbm[vertical]}` : ''}`
}

/** The page to load for typed text: the address itself, or a web search. */
export function toUrl(input: string): string {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) return text
  if (LOCAL.test(text)) return `http://${text}`
  if (isAddress(text)) return `https://${text}`
  return searchUrl(text)
}

export function detectIntents(input: string): OmniIntent[] {
  const text = input.trim().toLowerCase()
  if (!text) return ['search']
  if (isAddress(text)) return ['url']
  const intents: OmniIntent[] = []
  if (text.endsWith('?') || /^(who|what|when|where|why|how|which|whose|is|are|was|were|can|could|does|do|did|should|will|would|explain)\b/.test(text)) intents.push('question')
  if (/\b(news|headlines|breaking|announced|announcement|update)\b/.test(text)) intents.push('news')
  if (/\b(images?|pictures?|pics|photos?|wallpapers?|logos?|icons?|clipart)\b/.test(text)) intents.push('images')
  if (/\b(videos?|trailers?|clips?|watch|livestream)\b/.test(text)) intents.push('videos')
  if (/\b(buy|price|prices|pricing|cost|cheap|cheapest|deals?|discount|coupons?|for sale)\b|\bunder \$?\d/.test(text)) intents.push('shopping')
  intents.push('search')
  return intents
}

/** Sites people often search directly: "youtube lofi beats" offers a YouTube search. */
const SITE_SEARCH: Record<string, { name: string; url: string }> = {
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  github: { name: 'GitHub', url: 'https://github.com/search?q=' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  wiki: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  reddit: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
  amazon: { name: 'Amazon', url: 'https://www.amazon.com/s?k=' },
  stackoverflow: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
  npm: { name: 'npm', url: 'https://www.npmjs.com/search?q=' },
  maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/' }
}

/** The query of a search results page from a common engine, or null. */
export function searchQueryOf(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    let q: string | null = null
    if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/search') q = u.searchParams.get('q')
    else if (host === 'bing.com' && u.pathname === '/search') q = u.searchParams.get('q')
    else if (host === 'duckduckgo.com' && u.pathname === '/') q = u.searchParams.get('q')
    else if ((host === 'youtube.com' || host === 'm.youtube.com') && u.pathname === '/results') q = u.searchParams.get('search_query')
    const text = q?.replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, 200) : null
  } catch {
    return null
  }
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** "The same page": no scheme, www, fragment or trailing slash; host lower-cased. */
export function urlKey(url: string): string {
  const bare = url.trim().split('#')[0].replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  const slash = bare.indexOf('/')
  const host = (slash < 0 ? bare : bare.slice(0, slash)).toLowerCase()
  const rest = slash < 0 ? '' : bare.slice(slash)
  return (host + rest).replace(/\/+$/, '')
}

export const queryKey = (query: string): string => query.replace(/\s+/g, ' ').trim().toLowerCase()

/** The key a chosen suggestion is learned under. */
export const pickKey = (s: { url?: string; query?: string; text: string }): string => (s.url ? `u:${urlKey(s.url)}` : `q:${queryKey(s.query ?? s.text)}`)

export function timeAgo(now: number, then: number): string {
  const ms = Math.max(0, now - then)
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h ago`
  if (ms < 2 * DAY) return 'yesterday'
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)} days ago`
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Reads the search engine's suggestion response: `[query, [suggestion, ...]]`. */
export function parseWebSuggestions(json: unknown, query: string): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return []
  const typed = queryKey(query)
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of json[1]) {
    if (typeof item !== 'string') continue
    const text = item.replace(/\s+/g, ' ').trim()
    const key = queryKey(text)
    if (!text || text.length > 120 || key === typed || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length === 8) break
  }
  return out
}

// ---------------------------------------------------------------- matching and ranking

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** How well typed text matches a query or title, 0..1. */
export function textMatch(input: string, text: string): number {
  const q = queryKey(input)
  const t = queryKey(text)
  if (!q || !t) return 0
  if (t === q) return 1
  if (t.startsWith(q)) return 0.95
  const qw = words(q)
  const tw = words(t)
  if (qw.length && qw.every((w) => tw.some((x) => x.startsWith(w)))) return 0.75
  if (q.length >= 3 && t.includes(q)) return 0.5
  return 0
}

/** How well typed text matches a page (its address or title), 0..1. */
export function urlMatch(input: string, url: string, title: string): number {
  const q = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  if (!q) return 0
  const bare = urlKey(url).toLowerCase()
  const host = bare.split('/')[0]
  if (bare.startsWith(q)) return 1
  if (!q.includes(' ') && host.split('.').some((part) => part.startsWith(q))) return 0.8
  const byTitle = textMatch(input, title) * 0.9
  return Math.max(byTitle, !q.includes(' ') && q.length >= 3 && bare.includes(q) ? 0.5 : 0)
}

/** Many recent uses score high; the value fades over weeks. */
export function frecency(count: number, last: number, now: number): number {
  const ageDays = Math.max(0, now - last) / DAY
  return Math.min(4, Math.log2(1 + count)) / (1 + ageDays / 7)
}

interface Page {
  url: string
  title: string
  visits: number
  last: number
}

interface Search {
  query: string
  count: number
  last: number
  /** Stored as a recent search (removable there), not only seen in history. */
  stored: boolean
}

function aggregate(sources: OmniSources): { pages: Page[]; searches: Search[] } {
  const pages = new Map<string, Page>()
  const searches = new Map<string, Search>()
  for (const s of sources.searches) {
    const key = queryKey(s.query)
    if (key) searches.set(key, { query: s.query, count: Math.max(1, s.count), last: s.searchedAt, stored: true })
  }
  for (const h of sources.history) {
    const q = searchQueryOf(h.url)
    if (q) {
      const key = queryKey(q)
      const known = searches.get(key)
      if (known) known.last = Math.max(known.last, h.visitedAt)
      else searches.set(key, { query: q, count: 1, last: h.visitedAt, stored: false })
      continue
    }
    const key = urlKey(h.url)
    const page = pages.get(key)
    if (page) {
      page.visits++
      if (h.visitedAt > page.last) page.last = h.visitedAt
      if (!page.title && h.title) page.title = h.title
    } else pages.set(key, { url: h.url, title: h.title, visits: 1, last: h.visitedAt })
  }
  return { pages: [...pages.values()], searches: [...searches.values()] }
}

const pickBoost = (sources: OmniSources, key: string): number => {
  const pick = sources.picks[key]
  return pick ? Math.min(160, 40 * Math.log2(1 + pick.count)) : 0
}

const pageDetail = (url: string, when: number | undefined, now: number): string => [hostOf(url) || url, when ? timeAgo(now, when) : ''].filter(Boolean).join(' · ')

/**
 * Ranked suggestions for typed text. The first item is always what Enter does with nothing else selected.
 * `inline` is false right after the user deleted text, so a completion doesn't come straight back.
 */
export function buildSuggestions(input: string, sources: OmniSources, limit = 8, inline = true): OmniResult {
  const text = input.replace(/\s+/g, ' ').trim()
  if (!text) return { items: [], completion: null }
  const { now, personalized } = sources
  const found = new Map<string, OmniSuggestion>()
  const add = (s: OmniSuggestion): void => {
    const prev = found.get(s.id)
    if (!prev || prev.score < s.score) found.set(s.id, prev?.bookmarked ? { ...s, bookmarked: true } : s)
  }
  const bookmarked = new Set(sources.bookmarks.map((b) => urlKey(b.url)))
  const { pages, searches } = personalized ? aggregate(sources) : { pages: [], searches: [] }

  // Inline completion: typing the start of a site the user really uses completes to that site.
  let completion: string | null = null
  let defaultItem: OmniSuggestion | undefined
  const bareTyped = text.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  if (inline && personalized && bareTyped.length >= 2 && !/[\s/]/.test(bareTyped) && !/^https?:\/\//i.test(text)) {
    const hosts = new Map<string, { host: string; weight: number; url: string }>()
    for (const p of pages) {
      const host = hostOf(p.url)
      if (!host.startsWith(bareTyped)) continue
      const weight = frecency(p.visits, p.last, now) + pickBoost(sources, `u:${host}`) / 40 + (bookmarked.has(urlKey(p.url)) ? 1 : 0)
      const known = hosts.get(host)
      if (known) known.weight += weight
      else hosts.set(host, { host, weight, url: p.url })
    }
    const best = [...hosts.values()].sort((a, b) => b.weight - a.weight)[0]
    if (best && best.weight >= 0.5) {
      const typedHostStart = text.replace(/^www\./i, '')
      completion = text + best.host.slice(typedHostStart.length)
      const root = `${new URL(best.url).origin}/`
      defaultItem = { id: `u:${urlKey(root)}`, kind: 'navigate', text: best.host, detail: root, url: root, score: 10_000 }
    }
  }
  add(
    defaultItem ??
      (isAddress(text)
        ? { id: `u:${urlKey(toUrl(text))}`, kind: 'navigate', text: toUrl(text), detail: 'Open address', url: toUrl(text), score: 10_000 }
        : { id: `q:${queryKey(text)}`, kind: 'query', text, detail: 'Search the web', query: text, score: 10_000 })
  )

  for (const p of pages) {
    const match = urlMatch(text, p.url, p.title)
    if (!match) continue
    const key = `u:${urlKey(p.url)}`
    const score = 600 * match + 60 * frecency(p.visits, p.last, now) + pickBoost(sources, key)
    add({ id: key, kind: 'history', text: p.title || hostOf(p.url) || p.url, detail: pageDetail(p.url, p.last, now), url: p.url, removable: 'history', bookmarked: bookmarked.has(urlKey(p.url)), score })
  }
  for (const s of searches) {
    const match = textMatch(text, s.query)
    if (!match) continue
    const key = `q:${queryKey(s.query)}`
    const score = 580 * match + 60 * frecency(s.count, s.last, now) + pickBoost(sources, key)
    add({ id: key, kind: 'search', text: s.query, detail: `You searched · ${timeAgo(now, s.last)}`, query: s.query, removable: 'search', score })
  }
  if (personalized) {
    for (const b of sources.bookmarks) {
      const match = urlMatch(text, b.url, b.title)
      if (!match) continue
      const key = `u:${urlKey(b.url)}`
      add({ id: key, kind: 'bookmark', text: b.title || hostOf(b.url), detail: hostOf(b.url) || b.url, url: b.url, bookmarked: true, score: 380 * match + 40 + pickBoost(sources, key) })
    }
    for (const r of sources.research) {
      const match = textMatch(text, r.question)
      if (!match) continue
      const key = `q:${queryKey(r.question)}`
      add({ id: key, kind: 'research', text: r.question, detail: `Researched with Orion · ${timeAgo(now, r.at)}`, query: r.question, score: 360 * match + 20 * frecency(1, r.at, now) })
    }
  }
  sources.web.forEach((w, i) => {
    const address = isAddress(w)
    const key = address ? `u:${urlKey(toUrl(w))}` : `q:${queryKey(w)}`
    add({ id: key, kind: 'web', text: w, url: address ? toUrl(w) : undefined, query: address ? undefined : w, score: 400 - i * 12 + (personalized ? pickBoost(sources, key) : 0) })
  })
  sources.orion.forEach((o, i) => {
    const key = `q:${queryKey(o)}`
    add({ id: key, kind: 'orion', text: o, detail: 'Predicted by Orion', query: o, score: 390 - i * 12 })
  })

  if (!isAddress(text)) {
    const [first, ...rest] = text.split(' ')
    const site = SITE_SEARCH[first.toLowerCase()]
    const siteQuery = rest.join(' ').trim()
    if (site && siteQuery) {
      const url = site.url + encodeURIComponent(siteQuery)
      add({ id: `u:${urlKey(url)}`, kind: 'site', text: siteQuery, detail: `Search ${site.name}`, url, score: 450 })
    }
    const vertical = detectIntents(text).find((i): i is 'news' | 'images' | 'videos' | 'shopping' => i === 'news' || i === 'images' || i === 'videos' || i === 'shopping')
    if (vertical) {
      const label = { news: 'News results', images: 'Image results', videos: 'Video results', shopping: 'Shopping results' }[vertical]
      const url = searchUrl(text, vertical)
      add({ id: `u:${urlKey(url)}`, kind: 'vertical', text, detail: label, url, score: 300 })
    }
  }

  const items = [...found.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  return { items, completion }
}

/** What the address bar shows before anything is typed: only things that really happened. */
export function recentSuggestions(sources: OmniSources, limit = 12): OmniSuggestion[] {
  if (!sources.personalized) return []
  const { now } = sources
  const { pages, searches } = aggregate(sources)
  const bookmarked = new Set(sources.bookmarks.map((b) => urlKey(b.url)))
  const current = sources.currentUrl ? urlKey(sources.currentUrl) : ''
  const out: OmniSuggestion[] = []
  const used = new Set<string>()
  const push = (s: OmniSuggestion): void => {
    if (used.has(s.id)) return
    used.add(s.id)
    out.push(s)
  }

  for (const s of [...searches].sort((a, b) => b.last - a.last).slice(0, 4)) {
    push({ id: `q:${queryKey(s.query)}`, kind: 'search', text: s.query, detail: timeAgo(now, s.last), query: s.query, removable: 'search', section: 'Recent searches', score: 0 })
  }
  const visible = pages.filter((p) => urlKey(p.url) !== current)
  for (const p of [...visible].sort((a, b) => b.last - a.last).slice(0, 4)) {
    push({ id: `u:${urlKey(p.url)}`, kind: 'history', text: p.title || hostOf(p.url), detail: pageDetail(p.url, p.last, now), url: p.url, removable: 'history', bookmarked: bookmarked.has(urlKey(p.url)), section: 'Recently visited', score: 0 })
  }
  const frequent = visible
    .filter((p) => p.visits >= 2 && !used.has(`u:${urlKey(p.url)}`))
    .sort((a, b) => b.visits - a.visits || b.last - a.last)
    .slice(0, 3)
  for (const p of frequent) {
    push({ id: `u:${urlKey(p.url)}`, kind: 'history', text: p.title || hostOf(p.url), detail: `${hostOf(p.url)} · visited ${p.visits} times`, url: p.url, removable: 'history', bookmarked: bookmarked.has(urlKey(p.url)), section: 'Frequently visited', score: 0 })
  }
  for (const r of [...sources.research].sort((a, b) => b.at - a.at).slice(0, 2)) {
    push({ id: `q:${queryKey(r.question)}`, kind: 'research', text: r.question, detail: timeAgo(now, r.at), query: r.question, section: 'Researched with Orion', score: 0 })
  }
  if (out.length < 4) {
    for (const b of sources.bookmarks.slice(0, 3)) {
      push({ id: `u:${urlKey(b.url)}`, kind: 'bookmark', text: b.title || hostOf(b.url), detail: hostOf(b.url), url: b.url, bookmarked: true, section: 'Bookmarks', score: 0 })
    }
  }
  return out.slice(0, limit)
}
