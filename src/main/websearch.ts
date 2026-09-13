const ENDPOINT = 'https://html.duckduckgo.com/html/'

export interface WebResult {
  title: string
  url: string
  snippet: string
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function searchWeb(query: string, fetchFn: FetchFn, signal?: AbortSignal, limit = 5): Promise<WebResult[]> {
  const res = await fetchFn(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    body: new URLSearchParams({ q: query }).toString(),
    signal
  })
  if (!res.ok) throw new Error(`search returned ${res.status}`)
  return parseResults(await res.text()).slice(0, limit)
}

export function parseResults(html: string): WebResult[] {
  const results: WebResult[] = []
  for (const block of html.split('class="result__a"').slice(1)) {
    const href = /href="([^"]+)"/.exec(block)?.[1]
    const title = /^[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1]
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? ''
    const url = href ? resolveUrl(decodeEntities(href)) : null
    if (!url || !title) continue
    results.push({ url, title: clean(title), snippet: clean(snippet) })
  }
  return results
}

export function formatResults(query: string, results: WebResult[]): string {
  if (results.length === 0) return `A web search for "${query}" returned no results. Say so if the question needs current information.`
  const lines = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`)
  return [
    `Web search results for "${query}" (retrieved ${new Date().toDateString()}).`,
    'Use them to answer, cite sources inline as [n], and say so if they do not cover the question.',
    '',
    ...lines
  ].join('\n')
}

function resolveUrl(href: string): string | null {
  let url = href.startsWith('//') ? `https:${href}` : href
  // DuckDuckGo wraps some links in a redirect whose `uddg` parameter holds the real target.
  if (url.includes('duckduckgo.com/l/')) url = new URL(url).searchParams.get('uddg') ?? ''
  if (url.includes('duckduckgo.com/y.js')) return null
  return /^https?:\/\//i.test(url) ? url : null
}

function clean(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}
