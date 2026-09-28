import type { FeedItem } from '../widgetData.ts'
import type { Instrument } from './instrument.ts'
import { aliasesFor, assetOf } from './assets.ts'

/**
 * Crypto headlines, from feeds the publishers themselves put out for syndication.
 *
 * Everything here is arrangement: normalising what several feeds call the same thing, noticing when two of them carry
 * the same story, and deciding which markets a headline is actually about. Not one line of it produces a headline, a
 * publisher or a date — those come from the feed or they are absent.
 *
 * The part worth reading carefully is `assetsIn`. It would be easy to match a headline to a market whenever the symbol
 * appears anywhere in it, and it would be wrong constantly: "SOL" is inside "SOLD" and "CONSOLIDATES", "OP" is inside
 * "OPENS", and a story about a company called Bitcoin Depot is not a story about bitcoin. So a match needs the symbol or
 * the asset's name on a word boundary, and short symbols are held to the stricter test of the two. The cost is missing
 * some genuine mentions; the alternative is a news panel that confidently attaches the wrong stories to a market, which
 * is worse than one that attaches fewer.
 */

export interface NewsItem {
  id: string
  title: string
  url: string
  publisher: string
  /** When the publisher says it was published. Null when the feed did not say, which is shown as unknown. */
  publishedAt: number | null
  /** Base assets the headline actually names, upper case. Empty when it names none. */
  assets: string[]
  /** Other publishers carrying what looks like the same story. */
  alsoIn: string[]
}

/** A feed Orbis knows how to read. Publishers offer these for syndication; nothing here scrapes a page. */
export interface NewsSource {
  id: string
  name: string
  url: string
  /** The publisher's own site, so a source can be checked. */
  home: string
}

/**
 * The feeds offered by default.
 *
 * Each one is the publisher's own RSS endpoint, which is what RSS is for. A person can switch any of them off, and
 * nothing is fetched from a source that is switched off.
 */
export const NEWS_SOURCES: NewsSource[] = [
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', home: 'https://www.coindesk.com' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', home: 'https://cointelegraph.com' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', home: 'https://decrypt.co' },
  { id: 'bitcoinmagazine', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', home: 'https://bitcoinmagazine.com' }
]

/** Escapes a word for use in a pattern, so an asset called `C++` cannot become a regular expression. */
const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The base assets a headline names.
 *
 * A symbol matches only on a word boundary, and a symbol of three characters or fewer must appear in upper case — "sol"
 * in "solid ground" is not Solana, while "SOL" in a headline is. Names match case-insensitively because prose uses
 * them properly.
 */
export function assetsIn(text: string, known: string[]): string[] {
  if (!text) return []
  const found = new Set<string>()
  const lower = text.toLowerCase()

  for (const symbol of known) {
    const upper = symbol.toUpperCase()
    const pattern = new RegExp(`\\b${escape(upper)}\\b`, symbol.length <= 3 ? '' : 'i')
    if (pattern.test(text)) {
      found.add(upper)
      continue
    }
    // The one asset registry decides what names an asset, so news and search cannot disagree about it.
    for (const name of aliasesFor(upper)) {
      // A name is several words sometimes, so the boundary goes either side of the whole phrase.
      if (new RegExp(`\\b${escape(name)}\\b`).test(lower)) {
        found.add(upper)
        break
      }
    }
  }
  return [...found].sort()
}

/**
 * The base asset of an instrument, for matching a headline against a watchlist.
 *
 * Through the one asset registry rather than trimming the symbol here: a second implementation of "what is this a
 * market in" is how news comes to disagree with the logo shown beside it.
 */
export const baseOf = (instrument: Instrument): string => assetOf(instrument).symbol

/** Normalised for comparison: punctuation and spacing gone, so two publishers' spellings of one headline meet. */
const normalise = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A stable id for an item, from its link. Two feeds carrying one URL are one item. */
const idFor = (url: string, title: string): string => {
  const cleaned = url.split('?')[0].replace(/\/$/, '').toLowerCase()
  return cleaned || normalise(title)
}

/** The words of a headline that carry its meaning, in order. */
const significant = (title: string): string[] => normalise(title).split(' ').filter((word) => word.length > 2)

/**
 * Whether two headlines are the same story.
 *
 * **The opening words, in order** — not the overlap between them. Publishers rewrite a headline's ending far more often
 * than its subject, so "Bitcoin falls below $80,000 as ETFs bleed" and "Bitcoin falls below $80,000 amid ETF outflows"
 * begin identically and diverge at the end.
 *
 * Counting shared words instead was tried and is badly wrong in both directions. "Bitcoin price falls today" and
 * "Bitcoin price rises today" share three words of four and are opposite stories; meanwhile two headlines whose only
 * long word is "story" overlap completely and are unrelated. Order is what separates them: these two differ at the third
 * word, which is exactly where the meaning differs.
 *
 * Headlines too short to have four meaningful words fall back to being identical, because there is not enough of them to
 * judge on.
 */
export function sameStory(a: string, b: string): boolean {
  const left = significant(a)
  const right = significant(b)
  if (left.length === 0 || right.length === 0) return false
  if (left.length < 4 || right.length < 4) return normalise(a) === normalise(b)
  for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return false
  return true
}

export interface NormaliseOptions {
  /** The base assets worth looking for, usually what the person is watching plus the majors. */
  known: string[]
  /** The most items to return. */
  limit?: number
}

/**
 * Turns several feeds into one list.
 *
 * Newest first, with anything the publisher did not date at the end rather than pretended to be now. Duplicates are
 * merged into the earliest copy, and the other publishers are named on it — "three publishers carried this" is worth
 * more than three rows saying the same thing.
 */
export function normaliseNews(
  feeds: { source: NewsSource; items: FeedItem[] }[],
  options: NormaliseOptions
): NewsItem[] {
  const out: NewsItem[] = []
  const byId = new Map<string, NewsItem>()

  for (const { source, items } of feeds) {
    for (const item of items) {
      const title = (item.title ?? '').trim()
      const url = (item.url ?? '').trim()
      // A headline with no title or no link is not a headline anybody can read or check.
      if (!title || !url) continue

      const id = idFor(url, title)
      const existing = byId.get(id)
      if (existing) {
        if (!existing.alsoIn.includes(source.name) && existing.publisher !== source.name) existing.alsoIn.push(source.name)
        continue
      }

      const duplicate = out.find((one) => sameStory(one.title, title))
      if (duplicate) {
        if (!duplicate.alsoIn.includes(source.name) && duplicate.publisher !== source.name) duplicate.alsoIn.push(source.name)
        continue
      }

      const entry: NewsItem = {
        id,
        title,
        url,
        publisher: source.name,
        publishedAt:
          typeof item.publishedAt === 'number' && Number.isFinite(item.publishedAt) && item.publishedAt > 0
            ? item.publishedAt
            : null,
        assets: assetsIn(title, options.known),
        alsoIn: []
      }
      byId.set(id, entry)
      out.push(entry)
    }
  }

  // Dated first and newest first among those; undated last, because a story with no date is not a recent story, it is a
  // story whose date the feed did not give.
  out.sort((a, b) => {
    if (a.publishedAt === null && b.publishedAt === null) return a.title.localeCompare(b.title)
    if (a.publishedAt === null) return 1
    if (b.publishedAt === null) return -1
    return b.publishedAt - a.publishedAt
  })
  return out.slice(0, Math.max(1, options.limit ?? 60))
}

/** Headlines naming one asset. Empty when none do, which is a fact about the feeds rather than about the market. */
export const newsAbout = (items: NewsItem[], asset: string): NewsItem[] => {
  const wanted = asset.toUpperCase()
  return items.filter((one) => one.assets.includes(wanted))
}
