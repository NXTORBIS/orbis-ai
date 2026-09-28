/**
 * Putting the useful result first (§47, §54, §55).
 *
 * "how to install python" should lead with python.org, not with the fourth tutorial site to have written about it.
 * "iphone 15 review" should not lead with Apple. Both are the same rule seen from two sides: which source is
 * authoritative depends on what is being asked, and no fixed list of good domains can encode that.
 *
 * So the signals here are computed from the query rather than declared in advance:
 *
 *   - a domain that contains a word from the query is very likely that thing's own site
 *   - documentation-shaped hosts (docs., developer., *.readthedocs.io) matter for a how-to and not for a review
 *   - a title that answers the question beats one that merely mentions it
 *   - freshness counts when the question was about now, and not otherwise
 *
 * The one thing deliberately absent is a hand-written ranking of sites Orbis likes. §55 asks for no arbitrary
 * hardcoded rankings, and a list like that is also how a search engine quietly becomes an opinion: independent
 * reviews would be demoted for not being official, which for a review is precisely backwards.
 */

import type { Understanding } from './searchIntent.ts'
import type { NormalizedResult } from './searchModules.ts'

export interface Ranked {
  result: NormalizedResult
  score: number
  /** What earned it its place, in words. Kept so a bad ranking can be explained rather than guessed at. */
  because: string[]
}

/**
 * Words that describe the asking rather than the subject of it.
 *
 * Dropping them is what keeps a site called "independentreviews.com" from being read as the official home of the word
 * "review" and demoted for it -- which is the opposite of what a review query wants.
 */
const STOP = new Set(['how', 'to', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'and', 'is', 'do', 'i', 'my', 'what', 'why', 'with', 'from', 'install', 'use', 'make', 'fix', 'set', 'up', 'get', 'best', 'vs', 'review', 'reviews', 'comparison', 'guide', 'tutorial'])


/** The words of a query that actually identify a subject. "how to install python" -> ["python"]. */
export function subjectWords(query: string): string[] {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

/** Hosts shaped like documentation. A shape, not a list of favourites: any project's docs match this. */
const DOCS = /^(docs?|developer|dev|api|learn|guide|manual|help|support|wiki)\./i
const DOCS_TAIL = /(readthedocs\.io|\.dev$|docs\.rs$|godoc\.org$|javadoc\.io$)/i
const FORUM = /(stackoverflow\.com|superuser\.com|serverfault\.com|askubuntu\.com|stackexchange\.com|github\.com)$/i
const REFERENCE = /(wikipedia\.org|britannica\.com|\.gov$|\.gov\.[a-z]{2}$|\.edu$|\.ac\.[a-z]{2}$)/i

/**
 * Whether this domain looks like it belongs to the thing being asked about.
 *
 * "python.org" for "install python", "rust-lang.org" for "rust". The test is that a subject word appears in the
 * domain, which is a strong signal and a cheap one, and which needs no list of which projects exist.
 */
export function looksOfficial(domain: string, subjects: string[]): boolean {
  const host = String(domain ?? '').toLowerCase()
  const bare = host.replace(/^www\./, '').split('.')[0] ?? ''
  return subjects.some((word) => word.length > 2 && (bare === word || bare.includes(word) || host.startsWith(`${word}.`)))
}

/**
 * Scores and sorts.
 *
 * Scores are relative and only meaningful against each other; what matters is the order they produce. Ties keep the
 * order the provider gave, so a result never moves for no reason.
 */
export function rankResults(results: NormalizedResult[], u: Understanding, now = Date.now()): Ranked[] {
  const subjects = subjectWords(u.shape.normal)
  const howto = u.intents.some((i) => i.intent === 'howto' && i.confidence >= 0.5)
  const technical = u.shape.looksTechnical || howto
  const reviewish = /\b(review|reviews|opinion|comparison|worth it|problems?|issues?)\b/i.test(u.shape.normal)

  const ranked = results.map((result, order) => {
    let score = 0
    const because: string[] = []
    const domain = result.domain.toLowerCase()
    const title = result.title.toLowerCase()

    // The provider's own order is the starting point, not something to be overridden lightly.
    score += Math.max(0, 20 - order) * 0.5

    const official = looksOfficial(domain, subjects)
    if (official) {
      // Official first for a how-to, where the project's own instructions are the answer. For a review it is the
      // opposite: a company's page about its own product is the least independent thing on the list.
      if (reviewish) {
        score -= 6
        because.push('the maker’s own page, which is not an independent review')
      } else {
        score += howto ? 16 : 8
        because.push('the official site for what was asked about')
      }
    }

    if (technical && (DOCS.test(domain) || DOCS_TAIL.test(domain))) {
      score += 12
      because.push('documentation')
    }
    if (howto && FORUM.test(domain)) {
      score += 5
      because.push('where this question gets answered')
    }
    if (REFERENCE.test(domain)) {
      score += u.entity ? 10 : 5
      because.push('a reference source')
    }

    // A title that contains the subject is about the subject, rather than merely mentioning it somewhere.
    const hits = subjects.filter((word) => title.includes(word)).length
    if (subjects.length && hits) {
      score += (hits / subjects.length) * 8
      if (hits === subjects.length) because.push('the title is about exactly this')
    }

    // Freshness, but only when the question was about now. An old page about a theorem is not worse for being old.
    if (u.needsFresh && result.publishedAt) {
      const days = (now - result.publishedAt) / 86_400_000
      if (days <= 2) { score += 10; because.push('published in the last couple of days') }
      else if (days <= 14) { score += 5; because.push('recent') }
      else if (days > 365) { score -= 4; because.push('over a year old, for a question about now') }
    }

    return { result, score, because, order }
  })

  return ranked
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ result, score, because }) => ({ result, score, because }))
}

/** Just the results, in the order ranking put them. What the page iterates over. */
export const rankedResults = (results: NormalizedResult[], u: Understanding, now = Date.now()): NormalizedResult[] =>
  rankResults(results, u, now).map((r) => r.result)
