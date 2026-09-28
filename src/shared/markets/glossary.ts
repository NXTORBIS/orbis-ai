import type { Terminology } from './experience.ts'

/**
 * What the words mean.
 *
 * One glossary for the whole of Markets. Every "What is this?", every tooltip, every beginner explanation and every
 * definition Orion gives comes from here, which is the only way they can agree — a definition written beside each panel
 * is a definition that drifts from the others until three screens describe market cap three different ways.
 *
 * Three rules for the text itself.
 *
 * **Accurate before simple.** The beginner wording is shorter, not truer or falser. Where a simple sentence would be
 * wrong, it says the careful thing instead: funding is a payment between traders on certain perpetual futures, not "a
 * fee for holding a position", because the second one is easier and incorrect.
 *
 * **Nothing here promises an outcome.** No definition says what an indicator predicts, what a level means price will
 * do, or that anything is a signal to act. RSI measures the size of recent gains against recent losses. What that is
 * worth is not a fact and is not in this file.
 *
 * **No numbers.** A definition explains a term; a value comes from a provider. Putting "typically above 70" in a
 * definition would be putting a claim about markets in a place nobody would think to check it.
 */

export interface Term {
  /** The key other code refers to. Stable: it goes in `learned`, and a rename would forget what somebody has read. */
  id: string
  /** What it is called on screen. */
  term: string
  /** The expansion, where it has one. */
  full?: string
  /** One line, for a tooltip. */
  short: string
  /** For somebody new to markets. Plain words, same fact. */
  plain: string
  /** For somebody who knows the field and wants it exactly. */
  technical: string
  /** How to use the thing in Orbis, where that is a sensible question about it. */
  howToUse?: string
  /** Why anybody looks at it. Never why anybody should act on it. */
  whyItMatters?: string
  related: string[]
  /** Where in Markets the term appears, so a panel can ask for its own terms. */
  surfaces: string[]
}

export const GLOSSARY: Term[] = [
  {
    id: 'marketCap',
    term: 'Market cap',
    full: 'Market capitalisation',
    short: 'The price multiplied by the number of coins in circulation.',
    plain:
      'The total value of all the coins currently in circulation: the price of one, multiplied by how many there are.',
    technical:
      'Circulating supply multiplied by last price. Excludes tokens that are locked, unissued or provably burned, which is what separates it from fully diluted valuation.',
    whyItMatters: 'It is the usual way of comparing the size of one cryptocurrency with another.',
    related: ['fdv', 'supply', 'price'],
    surfaces: ['overview', 'movers', 'watchlist', 'detail']
  },
  {
    id: 'fdv',
    term: 'Fully diluted valuation',
    short: 'What the market cap would be if every token that can exist did.',
    plain: 'The value of every coin that will ever exist, at the current price — not just the ones circulating today.',
    technical: 'Maximum or total supply multiplied by last price, depending on which the issuer defines.',
    whyItMatters: 'It shows how much of a token is not yet in circulation.',
    related: ['marketCap', 'supply'],
    surfaces: ['detail']
  },
  {
    id: 'supply',
    term: 'Circulating supply',
    short: 'How many coins are in circulation now.',
    plain: 'The number of coins that exist and can be traded right now.',
    technical:
      'Issued units not held in locked, escrowed, treasury or provably burned addresses, as reported by the issuer or an index.',
    related: ['marketCap', 'fdv'],
    surfaces: ['detail']
  },
  {
    id: 'volume',
    term: '24h volume',
    short: 'How much was traded over the last twenty-four hours.',
    plain: 'How much of this was bought and sold in the last day — a measure of how busy the market has been.',
    technical:
      'Total traded quantity over a rolling twenty-four-hour window on the venue reporting it. Quoted either in base units or in the quote currency; Orbis shows turnover in the quote currency where the venue reports it.',
    whyItMatters: 'A market with very little volume can move a long way on a small order.',
    related: ['liquidity', 'turnover'],
    surfaces: ['overview', 'movers', 'watchlist', 'detail']
  },
  {
    id: 'turnover',
    term: 'Turnover',
    short: 'Volume counted in money rather than in coins.',
    plain: 'The same thing as volume, but measured in money: how much value changed hands.',
    technical: 'Quote-currency volume. Where a venue reports only base volume, Orbis derives it as volume × last price.',
    related: ['volume'],
    surfaces: ['movers', 'screener']
  },
  {
    id: 'liquidity',
    term: 'Liquidity',
    short: 'How much can be traded without moving the price much.',
    plain: 'How easily something can be bought or sold without pushing its price around.',
    technical:
      'The depth available near the touch, and how quickly it replenishes. Observable in the order book as resting size within a distance of the mid.',
    whyItMatters: 'It is what decides how far an order moves the price against itself.',
    related: ['orderBook', 'spread', 'slippage'],
    surfaces: ['book', 'detail']
  },
  {
    id: 'volatility',
    term: 'Volatility',
    short: 'How much the price has been moving.',
    plain: 'How much the price has been jumping around recently. High volatility means large moves in both directions.',
    technical:
      'The dispersion of returns over a window, usually the standard deviation of log returns, annualised where stated.',
    whyItMatters: 'It describes how large recent moves have been. It says nothing about which way the next one goes.',
    related: ['atr', 'drawdown'],
    surfaces: ['overview', 'screener', 'risk']
  },
  {
    id: 'price',
    term: 'Last price',
    short: 'The price of the most recent trade.',
    plain: 'What it last traded at — the price of the most recent completed trade.',
    technical: 'The price of the last matched trade on the reporting venue. Not the mid, and not a consolidated price.',
    related: ['bid', 'ask', 'spread'],
    surfaces: ['overview', 'watchlist', 'detail']
  },
  {
    id: 'bid',
    term: 'Bid',
    short: 'The highest price somebody is currently willing to buy at.',
    plain: 'The best price somebody is offering to buy at right now. Sell into the bid and that is what you get.',
    technical: 'The highest resting buy limit price on the book.',
    related: ['ask', 'spread', 'orderBook'],
    surfaces: ['book', 'detail']
  },
  {
    id: 'ask',
    term: 'Ask',
    short: 'The lowest price somebody is currently willing to sell at.',
    plain: 'The best price somebody is offering to sell at right now. Buy from the ask and that is what you pay.',
    technical: 'The lowest resting sell limit price on the book. Also called the offer.',
    related: ['bid', 'spread', 'orderBook'],
    surfaces: ['book', 'detail']
  },
  {
    id: 'spread',
    term: 'Spread',
    short: 'The gap between the best bid and the best ask.',
    plain: 'The difference between the buying price and the selling price. A wide gap costs you more to trade.',
    technical: 'Best ask minus best bid, usually expressed in basis points of the mid.',
    related: ['bid', 'ask', 'liquidity'],
    surfaces: ['book']
  },
  {
    id: 'orderBook',
    term: 'Order book',
    short: 'The buy and sell orders currently resting on the exchange.',
    plain:
      'A list of the orders waiting to be filled. Bids are people wanting to buy, asks are people wanting to sell, and the gap between the two is where trading happens.',
    technical:
      'Resting limit orders aggregated by price level, per side, as published by the venue. A snapshot: it is what was waiting at one instant and it changes continuously.',
    howToUse: 'Open a market and choose Book. Bids are on one side, asks on the other, and size is shown at each price.',
    whyItMatters: 'It shows where the size is, which is what decides how far an order moves the price.',
    related: ['bid', 'ask', 'liquidity', 'depth'],
    surfaces: ['book']
  },
  {
    id: 'depth',
    term: 'Market depth',
    short: 'How much size is resting near the current price.',
    plain: 'How many orders are waiting close to the current price — how much the market can absorb.',
    technical: 'Cumulative resting quantity as a function of distance from the mid, per side.',
    related: ['orderBook', 'liquidity'],
    surfaces: ['book']
  },
  {
    id: 'trades',
    term: 'Trades',
    short: 'The individual trades as they happen.',
    plain: 'Each trade as it happens: the price, the size, and whether the buyer or the seller was the one in a hurry.',
    technical:
      'The public trade print stream. The aggressor side is derived from the venue’s buyer-maker flag, so a print marked sell is one that hit the bid.',
    related: ['orderBook', 'price'],
    surfaces: ['trades']
  },
  {
    id: 'candlestick',
    term: 'Candlestick',
    short: 'One bar showing the open, high, low and close of a period.',
    plain:
      'Each candle covers one slice of time and shows four things: where the price started, its highest and lowest points, and where it finished.',
    technical: 'An OHLC bar over the interval. The body spans open to close; the wicks span the period high and low.',
    howToUse: 'Pick an interval above the chart. Each candle then covers that much time.',
    related: ['interval', 'price'],
    surfaces: ['chart']
  },
  {
    id: 'interval',
    term: 'Interval',
    short: 'How much time one candle covers.',
    plain: 'How much time each bar on the chart covers — a minute, an hour, a day.',
    technical: 'The aggregation period of each bar. Bars are stamped at their open.',
    related: ['candlestick'],
    surfaces: ['chart']
  },
  {
    id: 'sma',
    term: 'SMA',
    full: 'Simple moving average',
    short: 'The average closing price over a set number of bars.',
    plain: 'The average price over the last so many bars, drawn as a line. It smooths out the jumpiness.',
    technical: 'The unweighted mean of closes over the period, recomputed each bar.',
    howToUse: 'Add it from the indicator list on a chart and choose a period.',
    related: ['ema', 'wma'],
    surfaces: ['chart']
  },
  {
    id: 'ema',
    term: 'EMA',
    full: 'Exponential moving average',
    short: 'A moving average that weights recent bars more heavily.',
    plain: 'Like a moving average, but it pays more attention to what happened recently.',
    technical:
      'A geometrically weighted mean with smoothing factor 2/(period+1), seeded from the first window’s simple mean.',
    related: ['sma', 'macd'],
    surfaces: ['chart']
  },
  {
    id: 'wma',
    term: 'WMA',
    full: 'Weighted moving average',
    short: 'A moving average with linearly increasing weights.',
    plain: 'A moving average where each newer bar counts a little more than the one before it.',
    technical: 'Weights rise linearly from 1 to the period length across the window.',
    related: ['sma', 'ema'],
    surfaces: ['chart']
  },
  {
    id: 'vwap',
    term: 'VWAP',
    full: 'Volume-weighted average price',
    short: 'The average price, weighted by how much traded at each one.',
    plain: 'The average price, but prices where a lot was traded count for more than prices where little was.',
    technical: 'Cumulative typical price × volume divided by cumulative volume. Needs volume, so it is not offered for a market without it.',
    related: ['volume', 'price'],
    surfaces: ['chart']
  },
  {
    id: 'rsi',
    term: 'RSI',
    full: 'Relative strength index',
    short: 'Compares the size of recent gains with recent losses, on a scale of 0 to 100.',
    plain: 'A number between 0 and 100 that compares how big the recent rises have been against the recent falls.',
    technical:
      '100 − 100/(1+RS), where RS is the Wilder-smoothed mean gain over the mean loss across the period. Bounded by construction.',
    howToUse: 'Add it from the indicator list. It draws in its own pane below the price.',
    whyItMatters: 'It is a compact way of describing recent momentum. It is a description, not a forecast.',
    related: ['macd', 'stochastic'],
    surfaces: ['chart', 'screener', 'alerts']
  },
  {
    id: 'macd',
    term: 'MACD',
    full: 'Moving average convergence divergence',
    short: 'The distance between a fast and a slow moving average, and an average of that distance.',
    plain: 'It measures the gap between a fast average and a slow one, to show how the trend is changing.',
    technical: 'Fast EMA minus slow EMA, with a signal EMA of that difference and a histogram of the two.',
    related: ['ema', 'rsi'],
    surfaces: ['chart', 'screener']
  },
  {
    id: 'bollinger',
    term: 'Bollinger Bands',
    short: 'A moving average with bands a number of standard deviations either side.',
    plain: 'A moving average with a band above and below it that widens when the price gets more volatile.',
    technical: 'A simple moving average with bands at ±k standard deviations of closes over the same window.',
    related: ['sma', 'volatility', 'atr'],
    surfaces: ['chart']
  },
  {
    id: 'atr',
    term: 'ATR',
    full: 'Average true range',
    short: 'The average size of a bar’s range, including gaps.',
    plain: 'How much the price typically moves within one bar. A measure of how big the swings are.',
    technical: 'Wilder-smoothed mean of the true range: max of high−low, |high−prevClose| and |low−prevClose|.',
    related: ['volatility', 'bollinger'],
    surfaces: ['chart', 'risk']
  },
  {
    id: 'adx',
    term: 'ADX',
    full: 'Average directional index',
    short: 'How strongly the price has been trending, without saying which way.',
    plain: 'How strong a trend has been — not whether it was up or down, just how consistent it was.',
    technical: 'The smoothed mean of |+DI − −DI|/(+DI + −DI), from Wilder’s directional movement.',
    related: ['atr'],
    surfaces: ['chart']
  },
  {
    id: 'stochastic',
    term: 'Stochastic',
    short: 'Where the close sits within the recent high–low range.',
    plain: 'Where the price finished compared with its recent range: near the top, near the bottom, or in between.',
    technical: '%K is (close − lowest low)/(highest high − lowest low) over the period; %D is a moving average of %K.',
    related: ['rsi'],
    surfaces: ['chart']
  },
  {
    id: 'obv',
    term: 'OBV',
    full: 'On-balance volume',
    short: 'A running total of volume, added on up bars and subtracted on down bars.',
    plain: 'A running tally that adds the volume on days the price rose and subtracts it on days it fell.',
    technical: 'Cumulative sum of signed volume by close-to-close direction. Needs volume.',
    related: ['volume'],
    surfaces: ['chart']
  },
  {
    id: 'roc',
    term: 'ROC',
    full: 'Rate of change',
    short: 'The percentage change over a set number of bars.',
    plain: 'How much the price has changed over the last so many bars, as a percentage.',
    technical: 'One hundred times (close − close n bars ago) divided by close n bars ago.',
    related: ['rsi', 'price'],
    surfaces: ['chart']
  },
  {
    id: 'williamsR',
    term: 'Williams %R',
    short: 'Where the close sits in the recent range, on a scale of 0 to −100.',
    plain: 'Where the price finished within its recent high and low, counted downward from zero.',
    technical: '−100 × (highest high − close)/(highest high − lowest low) over the period.',
    related: ['stochastic', 'rsi'],
    surfaces: ['chart']
  },
  {
    id: 'cci',
    term: 'CCI',
    full: 'Commodity channel index',
    short: 'How far the typical price is from its average, in units of its own deviation.',
    plain: 'How far the price has strayed from its recent average, measured against how much it usually strays.',
    technical:
      '(typical price − its simple moving average) divided by 0.015 times the mean absolute deviation, where typical price is the mean of high, low and close.',
    related: ['bollinger', 'atr'],
    surfaces: ['chart']
  },
  {
    id: 'keltner',
    term: 'Keltner Channels',
    short: 'A moving average with bands a multiple of the average true range either side.',
    plain: 'A moving average with a band above and below it, set by how much the price typically moves in a bar.',
    technical: 'An exponential moving average with bands at ±k × ATR.',
    related: ['bollinger', 'atr', 'ema'],
    surfaces: ['chart']
  },
  {
    id: 'historicalVolatility',
    term: 'Historical volatility',
    short: 'The variability of past returns over a window.',
    plain: 'How much the price has varied over a stretch of time, as a single number.',
    technical: 'The standard deviation of log returns over the period, annualised where stated.',
    related: ['volatility', 'atr'],
    surfaces: ['chart', 'risk']
  },
  {
    id: 'mfi',
    term: 'MFI',
    full: 'Money flow index',
    short: 'Like RSI, but weighted by how much traded.',
    plain: 'A measure of recent rises against recent falls, where bars with more trading count for more.',
    technical:
      'An RSI computed on money flow — typical price × volume — rather than on price alone. Needs volume.',
    related: ['rsi', 'volume', 'obv'],
    surfaces: ['chart']
  },
  {
    id: 'accumulationDistribution',
    term: 'Accumulation/distribution',
    short: 'A running total of volume weighted by where the close sat in each bar.',
    plain:
      'A running tally that adds more of a bar’s volume when the price closed near the top of its range, and less when it closed near the bottom.',
    technical:
      'Cumulative sum of volume × ((close − low) − (high − close))/(high − low). Needs volume.',
    related: ['obv', 'volume'],
    surfaces: ['chart']
  },
  {
    id: 'funding',
    term: 'Funding rate',
    short: 'A periodic payment between long and short holders of a perpetual future.',
    plain:
      'On perpetual futures, traders on one side pay traders on the other at regular intervals. Which way it flows depends on whether the future is trading above or below the spot price.',
    technical:
      'The periodic exchange between long and short perpetual positions, set from the premium of the perpetual over an index price plus an interest component, as each venue defines it.',
    whyItMatters: 'It is what keeps a perpetual future tracking the spot price without an expiry.',
    related: ['openInterest', 'basis', 'markPrice'],
    surfaces: ['derivatives']
  },
  {
    id: 'openInterest',
    term: 'Open interest',
    short: 'How many derivative contracts are currently open.',
    plain: 'The number of futures contracts that are still open — positions that have been taken and not yet closed.',
    technical: 'Total outstanding contracts, counted once per contract rather than once per side.',
    related: ['funding', 'liquidations'],
    surfaces: ['derivatives']
  },
  {
    id: 'liquidations',
    term: 'Liquidation',
    short: 'A leveraged position force-closed because its margin ran out.',
    plain:
      'When a leveraged position no longer has enough money behind it, the exchange closes it. That is a liquidation.',
    technical: 'Forced reduction or closure of a margined position when maintenance margin is breached.',
    related: ['openInterest', 'leverage'],
    surfaces: ['derivatives']
  },
  {
    id: 'markPrice',
    term: 'Mark price',
    short: 'The price a venue values open positions at.',
    plain: 'The price the exchange uses to value open positions, which can differ slightly from the last trade.',
    technical: 'A venue-computed fair price, usually an index plus a smoothed basis, used for margin and liquidation.',
    related: ['indexPrice', 'liquidations'],
    surfaces: ['derivatives']
  },
  {
    id: 'indexPrice',
    term: 'Index price',
    short: 'A composite spot price from several venues.',
    plain: 'An average spot price taken from several exchanges, so no single one can move it on its own.',
    technical: 'A weighted composite of constituent spot venues, per the venue’s published methodology.',
    related: ['markPrice', 'basis'],
    surfaces: ['derivatives']
  },
  {
    id: 'basis',
    term: 'Basis',
    short: 'The gap between a future’s price and the spot price.',
    plain: 'The difference between what a future is trading at and the current spot price.',
    technical: 'Futures price minus index price, often expressed as a percentage and annualised for dated contracts.',
    related: ['funding', 'indexPrice'],
    surfaces: ['derivatives']
  },
  {
    id: 'leverage',
    term: 'Leverage',
    short: 'Trading a position larger than the money behind it.',
    plain:
      'Borrowing to hold a position bigger than your own money. It scales both gains and losses, and a loss can end the position entirely.',
    technical: 'Position notional divided by posted margin. Raises sensitivity to price by the same multiple in both directions.',
    related: ['liquidations', 'drawdown'],
    surfaces: ['derivatives', 'risk']
  },
  {
    id: 'slippage',
    term: 'Slippage',
    short: 'The difference between the price expected and the price filled.',
    plain: 'When an order fills at a slightly worse price than you saw, that difference is slippage.',
    technical: 'Realised fill price minus decision price. Grows with order size relative to resting depth.',
    howToUse: 'The paper simulator applies a slippage assumption to every fill, and shows what it assumed.',
    related: ['liquidity', 'paperTrading'],
    surfaces: ['paper', 'backtest']
  },
  {
    id: 'paperTrading',
    term: 'Paper trading',
    short: 'Simulated trading with virtual money.',
    plain:
      'Practice trading. Nothing is sent to an exchange, no real money moves, and the balance is not money you have.',
    technical:
      'A local simulator: orders fill against streamed prices under stated slippage and fee assumptions. No credential in Orbis can reach an exchange.',
    whyItMatters: 'It is how a strategy or an interface can be tried without anything being at stake.',
    related: ['slippage', 'backtest'],
    surfaces: ['paper', 'portfolio']
  },
  {
    id: 'backtest',
    term: 'Backtest',
    short: 'Running a set of rules over past candles.',
    plain: 'Trying out a set of rules against what the price actually did in the past, to see what would have happened.',
    technical:
      'Deterministic replay of a rule set over historical bars. A signal on bar i executes at bar i+1’s open, and a bar containing both stop and target is resolved as the stop and counted as ambiguous.',
    whyItMatters: 'It says what rules did on data that already exists. It is not a measure of what they will do.',
    related: ['paperTrading', 'drawdown', 'sharpe'],
    surfaces: ['backtest']
  },
  {
    id: 'drawdown',
    term: 'Drawdown',
    short: 'The fall from a peak to the low that followed it.',
    plain: 'How far a balance fell from its highest point before recovering — the worst dip along the way.',
    technical: 'Peak-to-trough decline of the equity curve, as a percentage of the peak. Maximum drawdown is the largest such decline.',
    related: ['sharpe', 'volatility'],
    surfaces: ['backtest', 'portfolio', 'risk']
  },
  {
    id: 'sharpe',
    term: 'Sharpe ratio',
    short: 'Return divided by the variability of that return.',
    plain: 'A way of comparing how much was gained against how bumpy the ride was.',
    technical: 'Mean excess return over its standard deviation, annualised by the periodicity of the series.',
    whyItMatters: 'It puts a return and its variability in one number, so two results can be compared on both at once.',
    related: ['drawdown', 'volatility'],
    surfaces: ['backtest', 'portfolio', 'risk']
  },
  {
    id: 'roundTrip',
    term: 'Round trip',
    short: 'A position opened and then fully closed.',
    plain: 'One complete trade: buying and then selling the whole of it, or the other way round.',
    technical: 'A completed cycle reconstructed from fills, from flat to flat. A fill is not a trade.',
    related: ['paperTrading'],
    surfaces: ['portfolio', 'backtest', 'journal']
  },
  {
    id: 'freshness',
    term: 'Freshness',
    short: 'How recently a figure arrived.',
    plain:
      'How new a number is. Live means it is arriving now; stale means it has stopped arriving and what is shown is old.',
    technical:
      'Derived from the age of the last update against a per-asset-class threshold. Combined with the exchange rate’s age wherever a price is converted, because a live price through an old rate is not a live converted price.',
    whyItMatters: 'It is the difference between a price and a price that used to be true.',
    related: ['price'],
    surfaces: ['overview', 'watchlist', 'detail', 'ticker']
  },
  {
    id: 'breadth',
    term: 'Market breadth',
    short: 'How many markets are up against how many are down.',
    plain: 'Whether most things are rising or most things are falling, rather than just one of them.',
    technical: 'Counts of advancing, declining and unchanged markets across the ranked universe, with the universe size stated.',
    related: ['movers'],
    surfaces: ['breadth', 'overview']
  },
  {
    id: 'movers',
    term: 'Movers',
    short: 'The markets that moved the most.',
    plain: 'The biggest risers and fallers over the last day.',
    technical:
      'Ranked by twenty-four-hour change, from the markets a provider can report at once. A market with no reported change is excluded rather than ranked as zero.',
    related: ['breadth', 'volume'],
    surfaces: ['movers', 'overview']
  },
  {
    id: 'screener',
    term: 'Screener',
    short: 'A filter over every market at once.',
    plain: 'A way of asking which markets match what you are looking for — say, above a price and busier than usual.',
    technical:
      'Two stages: snapshot conditions sweep the whole universe, and conditions needing candles examine only the most-traded markets, with the number skipped reported.',
    howToUse: 'Open Screener, add conditions, and run it. Save the query to run it again later.',
    related: ['rsi', 'volume'],
    surfaces: ['screener']
  },
  {
    id: 'alert',
    term: 'Alert',
    short: 'A condition Orbis watches for you.',
    plain: 'Tell Orbis what to watch for — a price, a move — and it tells you when it happens.',
    technical:
      'A stored condition evaluated against the live feed, with a cooldown and an optional daily cap. Firings are recorded with the value that triggered them.',
    howToUse: 'Open Alerts, choose a market and a condition, and save it. It is watched whether or not the market is on a list.',
    related: ['rsi', 'price'],
    surfaces: ['alerts']
  },
  {
    id: 'replay',
    term: 'Replay',
    short: 'Stepping through past candles one at a time.',
    plain: 'Playing the chart back bar by bar, as if you were watching it happen, so you can see how it unfolded.',
    technical:
      'A cursor over historical bars: only bars up to the cursor are visible, and seeking rebuilds from the start so the state is identical however you arrived at it.',
    howToUse: 'Open Replay, pick a market and a starting point, and step or play.',
    related: ['backtest', 'candlestick'],
    surfaces: ['replay']
  }
]

const BY_ID = new Map(GLOSSARY.map((one) => [one.id, one]))

export const termFor = (id: string): Term | undefined => BY_ID.get(id)

/** Every term a panel should be able to explain. */
export const termsFor = (surface: string): Term[] => GLOSSARY.filter((one) => one.surfaces.includes(surface))

/**
 * Finds a term from what somebody typed or said.
 *
 * Exact id, then exact name, then the expansion, then a word-boundary mention. Never a loose substring: "at" inside
 * "average true range" must not answer a question about something else.
 */
export function lookupTerm(said: string): Term | undefined {
  const asked = String(said ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!asked) return undefined
  const direct = BY_ID.get(asked)
  if (direct) return direct
  for (const one of GLOSSARY) {
    if (one.id.toLowerCase() === asked) return one
    if (one.term.toLowerCase() === asked) return one
    if (one.full && one.full.toLowerCase() === asked) return one
  }
  for (const one of GLOSSARY) {
    for (const label of [one.term, one.full ?? '', one.id]) {
      if (!label) continue
      const needle = label.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').trim()
      if (!needle) continue
      // A whole word, or the whole phrase. "rsi" matches "what does rsi mean"; it does not match "rsid".
      const at = asked.indexOf(needle)
      if (at < 0) continue
      const before = at === 0 ? ' ' : asked[at - 1]
      const after = at + needle.length >= asked.length ? ' ' : asked[at + needle.length]
      if (before === ' ' && after === ' ') return one
    }
  }
  return undefined
}

/** The definition for somebody's vocabulary. Same fact, their words. */
export function definitionFor(term: Term, terminology: Terminology): string {
  if (terminology === 'plain') return term.plain
  if (terminology === 'technical') return term.technical
  // Standard sits between the two: the one-liner, then the exact version for anybody who reads on.
  return `${term.short} ${term.technical}`
}

/** What "Learn this" shows: the definition, why anybody looks at it, and how to use it here. */
export interface Explanation {
  id: string
  title: string
  definition: string
  whyItMatters: string
  howToUse: string
  related: { id: string; term: string }[]
}

export function explain(term: Term, terminology: Terminology): Explanation {
  return {
    id: term.id,
    title: term.full && term.full !== term.term ? `${term.term} — ${term.full}` : term.term,
    definition: definitionFor(term, terminology),
    whyItMatters: term.whyItMatters ?? '',
    howToUse: term.howToUse ?? '',
    related: term.related
      .map((id) => BY_ID.get(id))
      .filter((one): one is Term => one !== undefined)
      .map((one) => ({ id: one.id, term: one.term }))
  }
}
