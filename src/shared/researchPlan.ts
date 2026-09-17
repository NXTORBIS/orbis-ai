/**
 * Planning research, and checking what came back.
 *
 * A comparison is two questions and a comparison, not one search that happens to contain both names: "compare Chromium
 * and Firefox architecture" finds better sources as "Chromium architecture", "Firefox architecture" and "Chromium vs
 * Firefox architecture", searched side by side. Questions that are one thing stay one search — splitting them would
 * only spend requests. No model is asked to plan, so planning costs nothing and cannot invent a query.
 *
 * After the answer, its citations are checked against the sources that were really found: a number that points at
 * nothing is reported rather than shown as if it were evidence.
 */
import type { SearchResult } from './orbisSearch.ts'

export const MAX_BRANCHES = 3

const clean = (text: string): string => text.replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim()
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** What is being compared, if the question is a comparison of two things. */
export function comparison(question: string): { a: string; b: string; about: string } | null {
  const q = clean(question)
  const patterns: RegExp[] = [
    /^(?:please\s+)?(?:research\s+(?:and\s+)?)?compare\s+(?:the\s+)?(.+?)\s+(?:and|with|to|vs\.?|versus)\s+(.+?)(?:\s+(?:in terms of|for|on|regarding)\s+(.+))?$/i,
    /^(?:what(?:'s| is| are)\s+)?(?:the\s+)?differences?\s+between\s+(.+?)\s+and\s+(.+?)(?:\s+(?:in terms of|for|on|regarding)\s+(.+))?$/i,
    /^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s*[:,-]\s*(.+))?$/i,
    /^(?:is|are)\s+(.+?)\s+better\s+than\s+(.+?)(?:\s+(?:for|at|in)\s+(.+))?$/i
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(q)
    if (!match) continue
    let a = match[1].trim()
    let b = match[2].trim()
    let about = (match[3] ?? '').trim()
    // "Chromium and Firefox architecture": the trailing word belongs to both.
    if (!about) {
      const tail = /^(.+?)\s+(architecture|performance|security|privacy|pricing|prices?|features|design|battery life|range|specs|specifications|benefits|pros and cons)$/i.exec(b)
      if (tail) {
        b = tail[1]
        about = tail[2]
      }
    }
    a = a.replace(/^(?:the|a|an)\s+/i, '')
    b = b.replace(/^(?:the|a|an)\s+/i, '')
    if (a.length < 2 || b.length < 2 || same(a, b) || a.split(' ').length > 6 || b.split(' ').length > 6) continue
    return { a, b, about }
  }
  return null
}

/**
 * The searches to run for a question, at most three, never two the same. The session's topic is added to a question
 * that leans on it, so "which is cheaper" searches for what the session is about.
 */
export function planQueries(question: string, topic?: string, followUp = false): string[] {
  const q = clean(question)
  const out: string[] = []
  const add = (query: string): void => {
    const text = clean(query)
    if (text && !out.some((existing) => same(existing, text))) out.push(text)
  }
  const compared = comparison(q)
  if (compared) {
    const suffix = compared.about ? ` ${compared.about}` : ''
    add(`${compared.a}${suffix}`)
    add(`${compared.b}${suffix}`)
    add(`${compared.a} vs ${compared.b}${suffix}`)
  } else {
    add(followUp && topic && !q.toLowerCase().includes(topic.toLowerCase()) ? `${topic} ${q}` : q)
  }
  return out.slice(0, MAX_BRANCHES)
}

/** Official and primary sources first: a site named after what is asked about, documentation, standards, government and universities. */
export function rankSources<T extends Pick<SearchResult, 'url' | 'site' | 'title'>>(results: T[], about: string[]): T[] {
  const names = about.map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((a) => a.length >= 3)
  const score = (r: T): number => {
    let host = ''
    try {
      host = new URL(r.url).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      return -10
    }
    const bare = host.replace(/[^a-z0-9]/g, '')
    let s = 0
    if (names.some((n) => host.split('.').some((part) => part.replace(/[^a-z0-9]/g, '') === n) || bare.startsWith(n))) s += 5
    if (/^(docs|developer|developers|learn|support|help|spec|specs)\./.test(host) || /\/(docs|documentation|reference|spec)\//i.test(r.url)) s += 3
    if (/\.(gov|edu|int)$|\.gov\.|\.ac\.|\.edu\./.test(host) || /(^|\.)w3\.org$|(^|\.)ietf\.org$|(^|\.)whatwg\.org$/.test(host)) s += 3
    if (/(^|\.)wikipedia\.org$/.test(host)) s += 1
    return s
  }
  return results
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.r)
}

/** Results from several searches as one list: the same page found twice is kept once, in the place it was first found. */
export function mergeResults<T extends Pick<SearchResult, 'url'>>(lists: T[][], limit = 12): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  // Taken in turns, so each branch of the research is represented rather than the first search crowding out the rest.
  for (let i = 0; i < longest && out.length < limit; i++) {
    for (const list of lists) {
      const r = list[i]
      if (!r) continue
      const key = r.url.replace(/#.*$/, '').replace(/\/$/, '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
      if (out.length >= limit) break
    }
  }
  return out
}

export interface CitationCheck {
  /** Source numbers the answer cites that really exist, in order of first use. */
  cited: number[]
  /** Numbers that point at no source found in the session. */
  invalid: number[]
  /** Whether the answer makes claims without citing anything at all. */
  uncited: boolean
}

/** Which of an answer's citations are real. Numbers are the 1-based numbers the session shows. */
export function checkCitations(answer: string, sourceCount: number): CitationCheck {
  const cited: number[] = []
  const invalid: number[] = []
  for (const match of answer.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    for (const part of match[1].split(',')) {
      const n = Number(part.trim())
      const list = n >= 1 && n <= sourceCount ? cited : invalid
      if (!list.includes(n)) list.push(n)
    }
  }
  const saysNoAnswer = /\b(?:do(?:es)? not|don't|doesn't|cannot|can't|couldn't|could not)\b.{0,40}\b(?:answer|say|mention|cover|find|found)\b/i.test(answer)
  return { cited, invalid, uncited: cited.length === 0 && !saysNoAnswer && answer.trim().length > 40 }
}
