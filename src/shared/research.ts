import type { ChatMessage, Research, ResearchSource } from './types'

/** A URL reduced to what identifies the page: no fragment, tracking parameters, "www." or trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) parsed.searchParams.delete(key)
    const search = parsed.searchParams.toString()
    return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${search ? `?${search}` : ''}`
  } catch {
    return url.trim()
  }
}

export const sameUrl = (a: string | undefined, b: string | undefined): boolean => Boolean(a && b) && normalizeUrl(a!) === normalizeUrl(b!)

/** Fenced and inline code, where [n] is code rather than a citation. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g

/** The source numbers an answer cites, like [2] or [1][3], in order of first use. */
export function citedNumbers(text: string, sources: ResearchSource[]): number[] {
  const valid = new Set(sources.map((s) => s.n))
  const cited: number[] = []
  for (const match of text.replace(CODE, ' ').matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(match[1])
    if (valid.has(n) && !cited.includes(n)) cited.push(n)
  }
  return cited
}

/** Turns citations into links Markdown renders as source chips; code, existing links and unknown numbers are left alone. */
export function linkCitations(text: string, sources: ResearchSource[]): string {
  const valid = new Set(sources.map((s) => s.n))
  return text
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\[(\d{1,2})\](?![(:])/g, (whole, n: string) => (valid.has(Number(n)) ? `[${n}](#orbis-source-${n})` : whole))))
    .join('')
}

/** The most recent research in the last `within` messages. */
export function latestResearch(messages: ChatMessage[], within = 8): Research | undefined {
  return messages
    .slice(-within)
    .reverse()
    .find((m) => m.role === 'assistant' && m.research?.sources.length)?.research
}

/** The research a page belongs to, when the page is one of its sources. */
export function findSource(messages: ChatMessage[], url: string): { research: Research; source: ResearchSource } | undefined {
  for (const m of [...messages].reverse()) {
    const source = m.research?.sources.find((s) => sameUrl(s.url, url))
    if (m.research && source) return { research: m.research, source }
  }
  return undefined
}

/** A compact list of a reply's sources, for context that only needs to know which pages they were. */
export function sourceNotes(research: Research): string {
  return `Sources of that answer: ${research.sources.map((s) => `[${s.n}] ${s.title.slice(0, 80)} <${s.url}>`).join('; ')}`
}
