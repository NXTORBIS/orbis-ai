import { searchWeb } from './research.ts'
import type { FetchFn } from './research'
import { tidyResults, wantsAnswer } from '../shared/orbisSearch.ts'
import type { SearchResult, SearchVertical } from '../shared/orbisSearch'

/**
 * Running an Orbis search.
 *
 * The web is asked the same way Orion's research already asks it, so there is one way of searching in Orbis rather
 * than two that drift apart. What is different is what happens to the answer: results come back as results, for a page
 * Orbis draws itself, rather than being handed to somebody else's site to display.
 *
 * Nothing about who asked leaves this machine. A search sends the words and nothing else — no identifier, no history,
 * no profile. What Orbis knows about you stays where it is.
 */

export interface SearchOptions {
  query: string
  vertical: SearchVertical
  fetchFn: FetchFn
  signal?: AbortSignal
}

export interface SearchOutcome {
  query: string
  vertical: SearchVertical
  results: SearchResult[]
  /** Whether an Orion answer is worth writing for this, decided before one is asked for. */
  wantsAnswer: boolean
  problem: string | null
  tookMs: number
}

/** How a vertical is asked for, since the engines take it as part of the words. */
const VERTICAL_TERMS: Record<SearchVertical, string> = {
  all: '',
  images: ' images',
  videos: ' video',
  news: ' news'
}

export async function runSearch(o: SearchOptions): Promise<SearchOutcome> {
  const query = o.query.replace(/\s+/g, ' ').trim().slice(0, 300)
  const started = Date.now()
  const empty = { query, vertical: o.vertical, results: [], wantsAnswer: false, problem: null as string | null, tookMs: 0 }
  if (!query) return { ...empty, problem: 'Nothing was searched for.' }

  try {
    // News is asked for recently; everything else takes the web as it is.
    const hits = await searchWeb(`${query}${VERTICAL_TERMS[o.vertical]}`, o.vertical === 'news' ? 'week' : 'any', o.fetchFn, o.signal)
    const results = tidyResults(hits)
    return {
      query,
      vertical: o.vertical,
      results,
      wantsAnswer: results.length > 0 && wantsAnswer(query),
      problem: results.length ? null : 'Nothing came back for that. Try different words, or !g to search Google.',
      tookMs: Date.now() - started
    }
  } catch (err) {
    if (o.signal?.aborted) return { ...empty, problem: 'The search was stopped.', tookMs: Date.now() - started }
    return {
      ...empty,
      problem: `The web could not be reached (${err instanceof Error ? err.message : String(err)}).`,
      tookMs: Date.now() - started
    }
  }
}

/**
 * What Orion is given to answer from: the results themselves, numbered, so that what it says can be traced back to
 * something real. It is told to answer from these and to say when they do not contain the answer, rather than filling
 * the gap from memory.
 */
export function answerPrompt(query: string, results: SearchResult[]): string {
  const sources = results
    .slice(0, 8)
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.site}\n${r.snippet}`)
    .join('\n\n')
  return [
    `Someone searched for: ${query}`,
    '',
    'These are the results that came back:',
    '',
    sources,
    '',
    'Answer the search in two or three sentences, in plain words, using only what these results say.',
    'Put the number of the result you used in square brackets after each claim, like [2].',
    'If the results do not answer it, say so plainly and say what would.',
    'Do not invent anything that is not in the results above.'
  ].join('\n')
}
