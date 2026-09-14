const ENDPOINT = 'https://www.google.com/search'

export interface WebResult {
  title: string
  url: string
  snippet: string
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function searchWeb(query: string, fetchFn: FetchFn, signal?: AbortSignal, limit = 4): Promise<WebResult[]> {
  const url = new URL(ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(limit * 2))

  const res = await fetchFn(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal
  })
  if (!res.ok) throw new Error(`search returned ${res.status}`)
  return parseResults(await res.text()).slice(0, limit)
}

export function parseResults(html: string): WebResult[] {
  const results: WebResult[] = []
  const regex = /<div\s+data-sokoban-container[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/g

  let match
  while ((match = regex.exec(html)) !== null) {
    const href = match[1]
    const title = match[2]
    const snippet = match[3]

    const url = resolveUrl(href)
    if (url === null || !title) continue

    const text = clean(snippet)
    results.push({ url, title: clean(title), snippet: text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text })
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
  // Google wraps some links in a redirect whose `url` parameter holds the real target.
  try {
    if (url.includes('google.com/url?')) {
      const params = new URL(url).searchParams
      url = params.get('url') ?? ''
    }
  } catch {
    // Continue with original URL if parsing fails
  }
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
