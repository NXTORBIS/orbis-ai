import type { Research, ResearchSource } from '../shared/types'
import { normalizeUrl } from '../shared/research.ts'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
export type Recency = Research['recency']

/** One search result, before its page is read. */
export interface SearchHit {
  title: string
  url: string
  snippet: string
  query: string
}

/** What a page itself says about what it is and when it was published. */
export interface PageInfo {
  title?: string
  publisher?: string
  published?: string
  updated?: string
  text: string
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const MAX_SOURCES = 6
const MAX_CANDIDATES = 8
const EXCERPT_CHARS = 1400
/** Search engines' own pages are never sources. */
const SEARCH_ENGINES = /(^|\.)(bing\.com|duckduckgo\.com|google\.[a-z.]+|yahoo\.com|yandex\.[a-z]+)$/i
/** Downloads and media can't be read as pages. */
const NOT_A_PAGE = /\.(zip|exe|msi|dmg|apk|iso|mp4|mp3|jpe?g|png|gif|webp)(\?|$)/i
const BING_FRESHNESS: Partial<Record<Recency, string>> = { day: 'ez1', week: 'ez2', month: 'ez3' }
const DDG_FRESHNESS: Partial<Record<Recency, string>> = { day: 'd', week: 'w', month: 'm', year: 'y' }
const DAY_MS = 86_400_000
const RECENCY_DAYS: Partial<Record<Recency, number>> = { day: 2, week: 8, month: 32, year: 366 }
const STOP_WORDS = new Set(
  'what which who whom whose when where why how the and for are was were with from that this these those have has had about into your you their there them they will would should could does did done latest newest current currently recent recently today yesterday week month year now news update updates updated tell find show give please more most some any than then just also only'.split(
    ' '
  )
)

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(nbsp|ensp|emsp|thinsp);/g, ' ')
    .replace(/&amp;/g, '&')
}

const clean = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** The real destination of a Bing result link (Bing wraps it as u=a1<base64url>). */
export function bingTarget(href: string): string | null {
  try {
    const url = new URL(decodeEntities(href))
    if (!/(^|\.)bing\.com$/i.test(url.hostname)) return /^https?:$/.test(url.protocol) ? url.toString() : null
    const encoded = url.searchParams.get('u')
    if (!encoded?.startsWith('a1')) return null
    const target = Buffer.from(encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return /^https?:\/\/\S+$/i.test(target) ? target : null
  } catch {
    return null
  }
}

export function parseBing(html: string, query: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of html.split('<li class="b_algo"').slice(1)) {
    const link = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue
    const url = bingTarget(link[1])
    const title = clean(link[2])
    if (!url || !title) continue
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block.slice(link.index + link[0].length))
    hits.push({ title, url, snippet: snippet ? clean(snippet[1]).slice(0, 300) : '', query })
  }
  return hits
}

export function parseDuckDuckGo(html: string, query: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of html.split('class="result__title"').slice(1)) {
    const link = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue
    let url: string
    try {
      const raw = decodeEntities(link[1])
      const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
      url = parsed.searchParams.get('uddg') ?? parsed.toString()
    } catch {
      continue
    }
    const title = clean(link[2])
    if (!/^https?:\/\//i.test(url) || !title) continue
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(block)
    hits.push({ title, url, snippet: snippet ? clean(snippet[1]).slice(0, 300) : '', query })
  }
  return hits
}

function request(url: string, fetchFn: FetchFn, signal: AbortSignal | undefined, ms: number): Promise<Response> {
  const timeout = AbortSignal.timeout(ms)
  return fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'follow'
  })
}

/** Results from both lists in turn, so neither engine's ordering dominates. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const list of lists) if (list[i]) out.push(list[i])
  return out
}

/** Searches Bing and DuckDuckGo together; fails only when neither can be reached. */
export async function searchWeb(query: string, recency: Recency, fetchFn: FetchFn, signal?: AbortSignal): Promise<SearchHit[]> {
  const bing = new URL('https://www.bing.com/search')
  bing.searchParams.set('q', query)
  bing.searchParams.set('setlang', 'en')
  if (BING_FRESHNESS[recency]) bing.searchParams.set('filters', `ex1:"${BING_FRESHNESS[recency]}"`)
  const ddg = new URL('https://html.duckduckgo.com/html/')
  ddg.searchParams.set('q', query)
  if (DDG_FRESHNESS[recency]) ddg.searchParams.set('df', DDG_FRESHNESS[recency]!)
  const results = await Promise.allSettled([
    request(bing.toString(), fetchFn, signal, 10_000).then(async (res) => (res.ok ? parseBing(await res.text(), query) : [])),
    request(ddg.toString(), fetchFn, signal, 10_000).then(async (res) => (res.ok ? parseDuckDuckGo(await res.text(), query) : []))
  ])
  if (results.every((r) => r.status === 'rejected')) throw new Error('web search could not be reached')
  return interleave(results.map((r) => (r.status === 'fulfilled' ? r.value : [])))
}

/** A date a page states, as YYYY-MM-DD; anything unparseable, implausible or in the future is ignored rather than guessed. */
export function toIsoDate(value: string | undefined, now = Date.now()): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  let time: number
  if (/^\d{8}$/.test(text)) time = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)))
  else if (/^\d+$/.test(text)) return undefined
  else time = Date.parse(text)
  if (!Number.isFinite(time)) return undefined
  if (new Date(time).getUTCFullYear() < 1995 || time > now + 1.5 * DAY_MS) return undefined
  return new Date(time).toISOString().slice(0, 10)
}

function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {}
    for (const m of tag.matchAll(/([a-zA-Z:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '')
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase()
    if (key && attrs.content?.trim() && !tags.has(key)) tags.set(key, attrs.content.trim())
  }
  return tags
}

/** The readable text of a page: headings, paragraphs and list items from its article or main content, without menus and scripts. */
export function extractText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside|button|select)\b[\s\S]*?<\/\1>/gi, ' ')
  const article = /<article\b[\s\S]*<\/article>/i.exec(body)?.[0]
  const main = /<main\b[\s\S]*<\/main>/i.exec(body)?.[0]
  const scope = [article, main].find((part) => part && clean(part).length >= 400) ?? body
  const lines: string[] = []
  for (const m of scope.matchAll(/<(h[1-4]|p|li|blockquote|pre|td|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const line = clean(m[2])
    if (line.length >= (/^h/i.test(m[1]) ? 3 : 25) && !lines.includes(line)) lines.push(line)
  }
  const text = lines.join('\n')
  return (text.length >= 200 ? text : clean(scope)).slice(0, 20_000)
}

export function readPage(html: string, now = Date.now()): PageInfo {
  const meta = metaTags(html)
  const jsonDate = (field: string): string | undefined => new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`).exec(html)?.[1]
  const first = (...keys: string[]): string | undefined => keys.map((k) => meta.get(k)).find(Boolean)
  const published = toIsoDate(
    first('article:published_time', 'og:published_time', 'datepublished', 'date', 'pubdate', 'publish-date', 'parsely-pub-date', 'sailthru.date', 'dc.date', 'dcterms.date') ??
      jsonDate('datePublished'),
    now
  )
  const updated = toIsoDate(first('article:modified_time', 'og:updated_time', 'datemodified', 'last-modified') ?? jsonDate('dateModified'), now)
  const title = first('og:title', 'twitter:title') ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  return {
    title: title ? clean(title).slice(0, 200) || undefined : undefined,
    publisher: first('og:site_name', 'application-name')?.slice(0, 80),
    published,
    updated: updated && updated !== published ? updated : undefined,
    text: extractText(html)
  }
}

/** The distinctive words of a question and its searches. */
function keyWords(terms: string[]): string[] {
  return [...new Set(terms.join(' ').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.+-]{2,}/gu) ?? [])].filter((w) => !STOP_WORDS.has(w))
}

/** How well a result's title (weighted) and snippet match the question. */
function relevance(hit: SearchHit, words: string[]): number {
  const title = hit.title.toLowerCase()
  const snippet = hit.snippet.toLowerCase()
  return words.reduce((score, w) => score + (title.includes(w) ? 2 : 0) + (snippet.includes(w) ? 1 : 0), 0)
}

/** The page's lead plus the passages that mention the question's key words, in page order. */
export function excerptFor(text: string, terms: string[], max = EXCERPT_CHARS): string {
  const lines = text.split('\n').filter(Boolean)
  const words = keyWords(terms)
  const ranked = lines
    .map((line, i) => ({ line, i, score: words.reduce((n, w) => n + (line.toLowerCase().includes(w) ? 1 : 0), 0) + (i < 2 ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
  const picked: { line: string; i: number }[] = []
  let used = 0
  for (const entry of ranked) {
    if (used + entry.line.length > max) {
      if (!picked.length) picked.push({ line: entry.line.slice(0, max), i: entry.i })
      continue
    }
    picked.push(entry)
    used += entry.line.length + 1
  }
  return picked
    .sort((a, b) => a.i - b.i)
    .map((p) => p.line)
    .join('\n')
}

export interface ResearchOptions {
  question: string
  queries: string[]
  recency: Recency
  fetchFn: FetchFn
  signal?: AbortSignal
  onStatus?(message: string): void
  now?: number
}

/**
 * Searches the web, reads the most relevant pages and keeps each as a source with the dates it states.
 * Readable, suitably recent pages come first; nothing is invented when a page can't be read or shows no date.
 */
export async function runResearch(o: ResearchOptions): Promise<Research> {
  const queries = [...new Set(o.queries.map((q) => q.replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean))].slice(0, 3)
  // The user's own wording is searched too: it often finds the most direct page (e.g. "React Versions").
  const asked = o.question.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (asked && queries.length < 3 && !queries.some((q) => q.toLowerCase() === asked.toLowerCase())) queries.push(asked)
  const research: Research = { id: crypto.randomUUID(), question: o.question.trim().slice(0, 500), queries, recency: o.recency, retrievedAt: Date.now(), sources: [] }

  o.onStatus?.(`Searching the web for “${queries[0]}”…`)
  const searches = await Promise.allSettled(queries.map((q) => searchWeb(q, o.recency, o.fetchFn, o.signal)))
  const seen = new Set<string>()
  const perSite = new Map<string, number>()
  const candidates: SearchHit[] = []
  // The results that best match the question are read first, before the per-site limit applies.
  const words = keyWords([o.question, ...queries])
  const ranked = interleave(searches.map((s) => (s.status === 'fulfilled' ? s.value : [])))
    .map((hit, index) => ({ hit, index, score: relevance(hit, words) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.hit)
  for (const hit of ranked) {
    let host: string
    try {
      host = new URL(hit.url).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      continue
    }
    const key = normalizeUrl(hit.url)
    if (seen.has(key) || SEARCH_ENGINES.test(host) || NOT_A_PAGE.test(hit.url) || (perSite.get(host) ?? 0) >= 2) continue
    seen.add(key)
    perSite.set(host, (perSite.get(host) ?? 0) + 1)
    candidates.push(hit)
    if (candidates.length >= MAX_CANDIDATES) break
  }
  if (!candidates.length) {
    research.problem = searches.every((s) => s.status === 'rejected') ? "the web search couldn't be reached" : 'the web search found no usable pages'
    return research
  }

  o.onStatus?.(`Reading ${candidates.length} sources…`)
  const terms = [o.question, ...queries]
  const now = o.now ?? Date.now()
  const pages = await Promise.all(
    candidates.map(async (hit) => {
      try {
        const res = await request(hit.url, o.fetchFn, o.signal, 9000)
        const finalUrl = res.url || hit.url
        if (!res.ok || !/html|xml/i.test(res.headers.get('content-type') ?? '')) return { hit, url: finalUrl, page: null }
        return { hit, url: finalUrl, page: readPage((await res.text()).slice(0, 2_000_000), now) }
      } catch {
        return { hit, url: hit.url, page: null }
      }
    })
  )

  const windowDays = RECENCY_DAYS[o.recency]
  const finalUrls = new Set<string>()
  const sources = pages
    .map(({ hit, url, page }, index): (ResearchSource & { rank: number; index: number }) | null => {
      const readable = Boolean(page && page.text.length >= 200)
      if (!readable && !hit.snippet) return null
      if (finalUrls.has(normalizeUrl(url))) return null
      finalUrls.add(normalizeUrl(url))
      let domain = ''
      try {
        domain = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        return null
      }
      const dated = page?.updated ?? page?.published
      const age = dated ? (now - Date.parse(dated)) / DAY_MS : undefined
      // Pages that could be read come first; with a freshness window, dated pages inside it lead and older ones trail.
      const freshness = windowDays === undefined || o.recency === 'year' ? 0 : age === undefined ? 0.5 : age <= windowDays ? 0 : 1
      return {
        n: 0,
        title: page?.title || hit.title,
        url,
        domain,
        publisher: page?.publisher || undefined,
        published: page?.published,
        updated: page?.updated,
        snippet: hit.snippet,
        excerpt: readable ? excerptFor(page!.text, terms) : hit.snippet,
        query: hit.query,
        read: readable,
        rank: (readable ? 0 : 2) + freshness,
        index
      }
    })
    .filter((s): s is ResearchSource & { rank: number; index: number } => s !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)

  research.sources = sources.slice(0, MAX_SOURCES).map(({ rank: _rank, index: _index, ...source }, i) => ({ ...source, n: i + 1 }))
  research.retrievedAt = Date.now()
  if (!research.sources.length) research.problem = "none of the pages found could be read"
  return research
}

const dateLine = (s: ResearchSource): string =>
  s.published ? `published ${s.published}${s.updated ? `, updated ${s.updated}` : ''}` : s.updated ? `updated ${s.updated}` : 'no date shown on the page'

/** What the answering model gets: the sources with their dates and extracts, and how to use them. */
export function researchBrief(r: Research): string {
  const when = new Date(r.retrievedAt)
  if (!r.sources.length) {
    return `Orbis tried to research this on the web just now (${when.toUTCString()}), but ${r.problem ?? 'found no usable sources'}. Tell the user you couldn't get current information from the web this time, answer only with what you reliably know, say it may be out of date, and don't cite sources.`
  }
  return [
    `Web research done just now for this question (${when.toUTCString()}; today is ${when.toDateString()}). Searches: ${r.queries.map((q) => `"${q}"`).join(', ')}${r.recency === 'any' ? '' : `; wanted: information from the past ${r.recency}`}.`,
    'Sources:',
    ...r.sources.map((s) => `[${s.n}] ${s.title} — ${s.publisher ?? s.domain} — ${dateLine(s)} — ${s.url}\n${s.read ? 'Extract' : "Search snippet only (the page couldn't be read)"}: ${s.excerpt}`),
    '',
    'Answer from these sources. Put the source numbers in square brackets right after each claim they support, like [2] or [1][3]; cite only these numbers, and only for what that source actually says.',
    'Prefer official, primary and authoritative sources and the most recent dated information that fits the question. Give dates when freshness matters, using only dates a source states.',
    "Don't call something the latest or current unless the sources show it. If the sources don't answer the question, are undated or look outdated, say so plainly.",
    'If sources disagree, point out the disagreement with their dates and numbers instead of silently choosing one.',
    "Don't add a list of sources or links at the end: Orbis shows the sources under your answer."
  ].join('\n')
}

/** Earlier research the conversation refers to. With new research too, its sources are labelled E1, E2… so the numbers don't clash. */
export function earlierResearchBrief(r: Research, alongsideNew: boolean): string {
  return [
    `Earlier in this chat Orbis researched "${r.question}" (${new Date(r.retrievedAt).toUTCString()}).`,
    alongsideNew
      ? 'Its sources are listed as E1, E2…: mention them by name; cite only the new sources by number.'
      : 'Its sources, numbered as in that answer; cite them with these numbers when you use them:',
    ...r.sources.map((s) => `${alongsideNew ? `E${s.n}` : `[${s.n}]`} ${s.title} — ${s.publisher ?? s.domain} — ${dateLine(s)} — ${s.url}\n${s.excerpt.slice(0, 500)}`)
  ].join('\n')
}

export interface AnswerContext {
  research?: Research
  earlier?: Research
  browser?: { url: string; title: string }
  /** The browser page's number in the earlier research, when it is one of its sources. */
  onScreen?: number
  pageText?: string | null
  /** Whether the question is about the open page. */
  includePage: boolean
}

/** Research, earlier research and the open page, put in front of the question for the answering model. */
export function answerContext(c: AnswerContext): string {
  const parts: string[] = []
  if (c.research) parts.push(researchBrief(c.research))
  if (c.earlier && c.earlier.id !== c.research?.id) parts.push(earlierResearchBrief(c.earlier, Boolean(c.research?.sources.length)))
  if (c.browser && c.includePage) {
    const identity = c.onScreen !== undefined && c.earlier ? `, which is source ${c.research?.sources.length ? `E${c.onScreen}` : `[${c.onScreen}]`} of the earlier research` : ''
    parts.push(
      `The user is looking at this page in the Orbis browser: ${c.browser.url} ("${c.browser.title}")${identity}.` +
        (c.pageText ? `\nIts visible text (may be cut off):\n${c.pageText}` : " Its text couldn't be read; say so if the question depends on it.")
    )
  }
  return parts.join('\n\n')
}
