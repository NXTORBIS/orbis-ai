/**
 * What a market surface can show.
 *
 * The columns a watchlist can have and the fields a ticker can carry, in one place that depends on nothing. Both the
 * saved configuration and the experience layer need this vocabulary — the workspace to validate what is in a file, the
 * experience presets to say which columns a level starts with — and neither should have to import the other to get it.
 *
 * A column here is a field a provider actually reports. Adding one that nothing supplies would be adding a column that
 * is permanently empty.
 */

export const DEFAULT_COLUMNS = ['symbol', 'price', 'change', 'changePercent', 'volume']

export const ALL_COLUMNS = [
  'symbol',
  'name',
  'price',
  'change',
  'changePercent',
  'volume',
  'dayHigh',
  'dayLow',
  'bid',
  'ask',
  'exchange',
  'currency'
]

export type TickerField = 'price' | 'change' | 'changePercent' | 'volume' | 'marketStatus'

export const TICKER_FIELDS: TickerField[] = ['price', 'change', 'changePercent', 'volume', 'marketStatus']
