import type { Instrument, QuoteView } from './instrument.ts'

/**
 * Movers, volume leaders, the heatmap and market breadth.
 *
 * One place, because they are the same question asked four ways: take every market, keep the ones that can honestly be
 * ranked, and order them. Computing that inside each panel is how a dashboard comes to show a coin among its top gainers
 * that the movers list two rows below disagrees about.
 *
 * Nothing here fetches anything. It is given the universe the engine already holds and returns an ordering, so the same
 * rows can be ranked for a dashboard, a heatmap and a screener without asking a provider three times.
 *
 * Two rules run through all of it:
 *
 *  - **A market that cannot be ranked is left out, not ranked as zero.** A pair with no 24-hour change is not flat; it is
 *    unknown, and putting it at the bottom of a losers list would be inventing a fact about it.
 *  - **Ties break deterministically.** Without a rule, two markets with the same change swap places on every tick and the
 *    list flickers. Turnover decides, and then the symbol, so the same universe always produces the same order.
 */

export interface MarketRow {
  instrument: Instrument
  quote: QuoteView
}

export type MoverKind = 'gainers' | 'losers' | 'volume' | 'active'

export interface DiscoveryFilter {
  /** Only markets priced in this currency, for example USDT. Empty means any. */
  quoteCurrency?: string
  /** The least value traded over the provider's window, in the quote currency. */
  minQuoteVolume?: number
  /** Text the symbol or name must contain. */
  text?: string
}

/**
 * The value traded, which is what makes two different markets comparable.
 *
 * The provider's own quote-volume where it reports one, and price times volume where it does not -- both are the value
 * that changed hands. Null when neither can be worked out, because a market's turnover is not zero just because it was not
 * reported: ranking it as zero would put it last in a volume list as though that were known.
 */
export function turnoverOf(quote: QuoteView): number | null {
  if (typeof quote.quoteVolume === 'number' && Number.isFinite(quote.quoteVolume) && quote.quoteVolume >= 0) {
    return quote.quoteVolume
  }
  if (
    typeof quote.volume === 'number' &&
    Number.isFinite(quote.volume) &&
    quote.volume >= 0 &&
    typeof quote.last === 'number' &&
    Number.isFinite(quote.last) &&
    quote.last > 0
  ) {
    return quote.volume * quote.last
  }
  return null
}

/** Whether a row's numbers are real enough to rank. Unavailable data is excluded rather than treated as zero. */
const rankable = (row: MarketRow): boolean =>
  row.quote.freshness !== 'unavailable' && typeof row.quote.last === 'number' && Number.isFinite(row.quote.last)

export function matches(row: MarketRow, filter: DiscoveryFilter = {}): boolean {
  if (filter.quoteCurrency && row.instrument.currency.toUpperCase() !== filter.quoteCurrency.toUpperCase()) return false
  if (typeof filter.minQuoteVolume === 'number') {
    const turnover = turnoverOf(row.quote)
    // A market whose turnover is unknown does not pass a turnover threshold: it is not known to be above it.
    if (turnover === null || turnover < filter.minQuoteVolume) return false
  }
  if (filter.text) {
    const wanted = filter.text.trim().toLowerCase()
    if (wanted) {
      const haystack = `${row.instrument.symbol} ${row.instrument.name}`.toLowerCase()
      if (!haystack.includes(wanted)) return false
    }
  }
  return true
}

/** Turnover, then symbol. The tie-break that keeps a live list from reordering itself on every tick. */
const settle = (a: MarketRow, b: MarketRow): number => {
  const byVolume = (turnoverOf(b.quote) ?? -1) - (turnoverOf(a.quote) ?? -1)
  if (byVolume !== 0) return byVolume
  return a.instrument.symbol.localeCompare(b.instrument.symbol)
}

/**
 * The movers of one kind.
 *
 * `active` is ranked by how far the price has moved either way, which is a different question from which way it moved: it
 * is the list somebody scanning for something happening wants, and it is stated as absolute movement rather than dressed
 * up as a gain.
 */
export function movers(rows: MarketRow[], kind: MoverKind, limit = 10, filter: DiscoveryFilter = {}): MarketRow[] {
  const usable = rows.filter((row) => rankable(row) && matches(row, filter))

  if (kind === 'volume') {
    return usable
      .filter((row) => turnoverOf(row.quote) !== null)
      .sort(
        (a, b) =>
          (turnoverOf(b.quote) as number) - (turnoverOf(a.quote) as number) ||
          a.instrument.symbol.localeCompare(b.instrument.symbol)
      )
      .slice(0, limit)
  }

  // Every other kind is about the change, so a market without one is not in the answer at all.
  const withChange = usable.filter(
    (row) => typeof row.quote.changePercent === 'number' && Number.isFinite(row.quote.changePercent)
  )
  const percent = (row: MarketRow): number => row.quote.changePercent as number

  if (kind === 'gainers') {
    return withChange
      .filter((row) => percent(row) > 0)
      .sort((a, b) => percent(b) - percent(a) || settle(a, b))
      .slice(0, limit)
  }
  if (kind === 'losers') {
    return withChange
      .filter((row) => percent(row) < 0)
      .sort((a, b) => percent(a) - percent(b) || settle(a, b))
      .slice(0, limit)
  }
  return withChange
    .sort((a, b) => Math.abs(percent(b)) - Math.abs(percent(a)) || settle(a, b))
    .slice(0, limit)
}

export interface HeatmapTile {
  instrument: Instrument
  quote: QuoteView
  /** The turnover this tile is sized by, in the quote currency. */
  turnover: number
  /** Its share of the turnover of the tiles shown, 0 to 1. What the tile's area represents. */
  weight: number
}

/**
 * A heatmap of the markets with the most turnover.
 *
 * Sized by value traded, because that is a figure the feed actually reports. It is **not** market capitalisation: no
 * exchange feed knows a token's supply, and sizing tiles by turnover while labelling them as market cap would be a real
 * number under a false name.
 *
 * The weight is each tile's share of the turnover of the tiles shown, so the areas add up to the whole and the share is of
 * what is drawn rather than of the exchange.
 */
export function heatmap(rows: MarketRow[], limit = 40, filter: DiscoveryFilter = {}): HeatmapTile[] {
  const usable = rows
    .filter((row) => rankable(row) && matches(row, filter))
    .map((row) => ({ row, turnover: turnoverOf(row.quote) }))
    .filter((r): r is { row: MarketRow; turnover: number } => r.turnover !== null && r.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover || a.row.instrument.symbol.localeCompare(b.row.instrument.symbol))
    .slice(0, limit)

  const total = usable.reduce((sum, r) => sum + r.turnover, 0)
  return usable.map(({ row, turnover }) => ({
    instrument: row.instrument,
    quote: row.quote,
    turnover,
    // A total of zero cannot happen here, since every turnover above is greater than zero, but dividing without checking
    // is how a NaN reaches a stylesheet.
    weight: total > 0 ? turnover / total : 0
  }))
}

export interface Breadth {
  advancing: number
  declining: number
  unchanged: number
  /** How many markets were counted, so the figures can be read as a proportion of something known. */
  total: number
  /** Advancing over declining. Null when nothing is declining, because dividing by it would not be a ratio. */
  ratio: number | null
}

/**
 * How much of a defined set of markets is up.
 *
 * Only over the set it is given, and it says how large that set was: "62 advancing" means nothing without knowing whether
 * it was out of 100 or 3,000. Markets with no reported change are not counted as unchanged -- they are not counted at all,
 * because an unknown move is not a flat one.
 */
export function breadth(rows: MarketRow[], filter: DiscoveryFilter = {}): Breadth {
  let advancing = 0
  let declining = 0
  let unchanged = 0
  for (const row of rows) {
    if (!rankable(row) || !matches(row, filter)) continue
    const percent = row.quote.changePercent
    if (typeof percent !== 'number' || !Number.isFinite(percent)) continue
    if (percent > 0) advancing++
    else if (percent < 0) declining++
    else unchanged++
  }
  return {
    advancing,
    declining,
    unchanged,
    total: advancing + declining + unchanged,
    ratio: declining > 0 ? advancing / declining : null
  }
}
