import type { ParamSpec } from '../../../shared/browserControl.ts'
import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'
import { DRAWING_KINDS, type DrawingKind } from '../../../shared/markets/drawings.ts'
import { INDICATORS, type IndicatorInfo, type IndicatorKind } from '../../../shared/markets/indicators.ts'
import { FIELDS, type ScreenerCondition, type ScreenerField, type ScreenerOperator, type ScreenerQuery } from '../../../shared/markets/screener.ts'

/**
 * What Markets lets Orbis do, as data.
 *
 * Here rather than inside `MarketsView.tsx` and `ScreenerPanel.tsx` for the reason the two worked examples are:
 * a declaration written inside a component can only be checked by drawing that component, and there is no browser in
 * the test suite. Written as a function of the screen's own state and its own handlers, the whole chain can be driven
 * without React.
 *
 * Nothing here reaches for anything and nothing here decides anything. Every value is read from the screen that
 * passes itself in, every setter is a function that screen already calls when somebody works the control by hand, and
 * every list of allowed values comes from the module's own model -- the provider's own timeframes, the indicator
 * catalogue, the screener's own fields. A second list written out for Orion would be a second thing to keep level.
 *
 * `market.*` in `src/main/browserControl/marketCapabilities.ts` already asks the market engine questions: search a
 * market, read a quote, run a screen, place a paper order, open a market on screen. None of that is repeated here.
 * This is the half that engine cannot reach: the panels, the chart bar, the screener's own builder and the watchlist
 * on screen in the window.
 */

// ---------------------------------------------------------------- Markets itself

/*
 * One rule about naming, learnt the hard way.
 *
 * A path segment is matched against ids, names on screen and keywords, and one of the ways it matches is "every word
 * you said is the start of a word in it". So on a module called Markets, a control called "Search markets" or an
 * action called "Close Markets" **steals the segment `market`** -- and `markets/market` resolved to the search box
 * while no market was open, with the caller told it had arrived. The names below therefore do not repeat the module's
 * own word; `about` says the rest. Ambiguity is reported, so two things that both answer are safe; one thing that
 * answers wrongly is not.
 */

/** The sections Markets can show. The same ids the header's buttons use. */
export const MARKET_SECTIONS = ['markets', 'screener', 'alerts', 'portfolio', 'backtest', 'replay', 'news'] as const
export type MarketSection = (typeof MARKET_SECTIONS)[number]

/** The three things the first section can show. */
export const MARKET_PANES = ['dashboard', 'watchlists', 'favourites'] as const

export const MOVER_KINDS = ['gainers', 'losers', 'volume'] as const

/**
 * The sections whose own panel says what can be done on it.
 *
 * A list rather than something worked out, for the same reason Settings keeps one: whether a section is somewhere to
 * go is not a property of the section, it is whether the panel inside it registers. A section named here whose panel
 * registers nothing would have Orbis open it, find nothing, and be unable to tell that from a fault. Add to this in
 * the same change as the `useSurface` call in the panel.
 */
export const CONTROLLABLE_SECTIONS: readonly MarketSection[] = ['screener']

const SECTION_NAMES: Record<MarketSection, string> = {
  markets: 'Markets',
  screener: 'Screener',
  alerts: 'Alerts',
  portfolio: 'Paper trading',
  backtest: 'Strategies',
  replay: 'Replay',
  news: 'News'
}

/** What the Markets screen has to hand over. Each one is a live reader or the handler its own controls call. */
export interface MarketsScreen {
  /**
   * Whether the market engine is switched on. Null while that has not come back yet, which is a different thing from
   * off and has to stay different: a screen that answers "off" because a question is in flight is a screen that
   * reports a switch nobody set.
   */
  enabled(): boolean | null
  section(): string
  openSection(id: string): void
  pane(): string
  setPane(id: string): void
  search(): string
  setSearch(text: string): void
  movers(): string
  setMovers(kind: string): void
  moversOpen(): boolean
  setMoversOpen(open: boolean): void
  /** Whether several panels are shown at once instead of one market in depth. */
  panels(): boolean
  setPanels(on: boolean): void
  /** Re-ranks the movers and the heatmap off the provider. Resolves when the answer is in. */
  refresh(): Promise<void>
  /** What the provider connection is doing, in the engine's own word. */
  connection(): string
  /** How many markets came back in the last ranking, and whether a ranking is in flight. */
  ranking(): { available: boolean | null; gainers: number; tiles: number; busy: boolean }
  /** The id of the market that is open, or null. */
  openMarket(): string | null
  close(): void
}

/** The guard every control on a screen that may not be switched on shares. */
const whenEnabled = (screen: Pick<MarketsScreen, 'enabled'>) => (): true | string => {
  const on = screen.enabled()
  if (on === true) return true
  if (on === null) return 'Markets has not said yet whether it is switched on. Ask again in a moment.'
  return 'Markets is switched off, so there is nothing to work. Turn it on in Markets first.'
}

/**
 * Markets, as something Orbis can work rather than click at.
 *
 * The section control is what makes a panel inside Markets reachable without anybody naming it: the walk sets
 * `section` to `screener` and the screener panel registers itself and says what is on it.
 */
export function marketsSurface(screen: MarketsScreen): SurfaceDeclaration {
  const settable = whenEnabled(screen)
  return {
    id: 'markets',
    parent: null,
    name: 'Markets',
    about: 'Prices, watchlists, the screener and one market in as much detail as its provider serves.',
    kind: 'module',
    keywords: ['markets', 'prices', 'trading', 'crypto', 'charts', 'tickers'],
    controls: {
      section: {
        name: 'Section',
        about: 'Which part of Markets is on screen.',
        spec: { type: 'string', description: 'Which part of Markets is on screen.', enum: [...MARKET_SECTIONS] },
        get: () => screen.section(),
        writable: settable,
        set: (value) => screen.openSection(String(value)),
        default: 'markets'
      },
      pane: {
        name: 'List',
        about: 'Whether the first section shows what is moving, the watchlists, or the markets marked as favourites.',
        spec: { type: 'string', description: 'What the list beside the chart shows.', enum: [...MARKET_PANES] },
        get: () => screen.pane(),
        // Only meaningful on the first section: the screener and the alerts builder are full-width and have no list.
        writable: () => {
          const ready = settable()
          if (ready !== true) return ready
          return screen.section() === 'markets' ? true : `The ${SECTION_NAMES[screen.section() as MarketSection] ?? screen.section()} section has no list beside it. Set section to markets first.`
        },
        set: (value) => screen.setPane(String(value)),
        default: 'dashboard'
      },
      search: {
        name: 'Search',
        about: 'Looks a market up by name or ticker. Two letters is the shortest that searches.',
        spec: { type: 'string', description: 'What to look for. Empty clears the results.' },
        get: () => screen.search(),
        writable: settable,
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      },
      movers: {
        name: 'Movers',
        about: 'Whether the movers list ranks by rise, by fall, or by how much was traded.',
        spec: { type: 'string', description: 'How the movers list is ranked.', enum: [...MOVER_KINDS] },
        get: () => screen.movers(),
        writable: settable,
        set: (value) => screen.setMovers(String(value)),
        default: 'gainers'
      },
      moversOpen: {
        name: 'Show movers',
        spec: { type: 'boolean', description: 'Whether the movers panel is open. Closed it is one line.' },
        get: () => screen.moversOpen(),
        writable: settable,
        set: (on) => screen.setMoversOpen(on === true),
        default: true
      },
      panels: {
        name: 'Several panels at once',
        about: 'Shows the open market as a workspace of panels instead of one market in depth.',
        spec: { type: 'boolean', description: 'Whether the open market is shown as several panels at once.' },
        get: () => screen.panels(),
        writable: () => {
          const ready = settable()
          if (ready !== true) return ready
          return screen.openMarket() ? true : 'No market is open, so there is nothing to arrange in panels. Open a market first.'
        },
        set: (on) => screen.setPanels(on === true),
        default: false
      }
    },
    actions: {
      refresh: {
        name: 'Refresh the movers',
        about: 'Asks the provider for the ranking again. The prices on each row arrive on their own.',
        effects: ['read'],
        unavailable: () => (screen.enabled() === true ? null : 'Markets is switched off.'),
        run: async () => {
          const before = screen.ranking()
          await screen.refresh()
          return { before }
        },
        /*
         * What is checked is that an answer came back, not that the numbers moved.
         *
         * A ranking that is the same twice running is a true answer about a quiet market, so "the figures changed"
         * would report a fault at something fine. What a refresh promises is that the provider answered.
         */
        verify: () => {
          const now = screen.ranking()
          if (now.available === true) return { done: true, detail: `The provider answered: ${now.gainers} movers and ${now.tiles} markets, and the connection is ${screen.connection() || 'not reported'}.` }
          if (now.available === null) return { done: false, detail: 'the provider has not answered yet.' }
          return { done: false, detail: `the provider could not answer, and the connection is ${screen.connection() || 'not reported'}.` }
        }
      },
      close: {
        name: 'Close',
        about: 'Closes Markets and goes back to where you were.',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: [
      ...CONTROLLABLE_SECTIONS.map((one) => ({
        id: one,
        name: SECTION_NAMES[one],
        kind: 'page' as const,
        reach: { kind: 'control' as const, control: 'section', value: one }
      })),
      {
        id: 'watchlists',
        name: 'Watchlists',
        kind: 'panel' as const,
        // Always there once Markets is: the lists are loaded with the screen rather than with the pane that shows them.
        reach: { kind: 'always' as const }
      },
      {
        id: 'market',
        name: 'The open market',
        kind: 'page' as const,
        /*
         * A market is opened by naming one, and a route cannot carry a name it was never given.
         *
         * So this is said rather than tried. `market.open` resolves "bitcoin" to an instrument through the engine's own
         * search and shows it, which is the honest way in -- and it is named here so the sentence a failed walk gives
         * back is the next thing to do rather than a dead end.
         */
        reach: { kind: 'manual' as const, how: 'a market has to be named first. Ask market.open with its name or ticker, or press one in the list.' }
      }
    ],
    state: () => {
      const ranking = screen.ranking()
      return {
        activity: ranking.busy ? 'running' : 'idle',
        values: {
          switchedOn: screen.enabled() === null ? 'not answered yet' : screen.enabled(),
          section: screen.section(),
          list: screen.pane(),
          connection: screen.connection() || 'not reported',
          openMarket: screen.openMarket() ?? 'none',
          // The ranking is a question about every market, so "could not answer" is a real third state here.
          ranking: ranking.available === null ? 'not answered yet' : ranking.available ? `${ranking.gainers} movers, ${ranking.tiles} markets` : 'the provider could not answer'
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the open market

export const CHART_TYPE_IDS = ['candles', 'line', 'area', 'ohlc'] as const
export const MARKET_TABS = ['overview', 'chart', 'book', 'trades', 'derivatives', 'compare', 'margin', 'triggers', 'patterns'] as const
export const PATTERN_VIEWS = ['found', 'library', 'alerts', 'history'] as const

/** What the open market's page has to hand over. */
export interface MarketScreen {
  /**
   * The market that is open.
   *
   * Throws when nothing is open rather than answering with a blank: a control that reports an empty symbol is a
   * control reporting a market nobody opened.
   */
  market(): { instrumentId: string; symbol: string; name: string }
  /** What this market's provider can actually serve. The chart bar is built from this and so is every range below. */
  can(): { candles: boolean; book: boolean; trades: boolean; derivatives: boolean; intervals: readonly string[] }
  quote(): { last: number | null; changePercent: number | null; freshness: string } | null
  tab(): string
  setTab(id: string): void
  interval(): string
  /** Sets the timeframe and loads that timeframe's candles, which is what pressing one of the buttons does. */
  setInterval(id: string): void | Promise<void>
  chartType(): string
  setChartType(id: string): void
  allTimeframes(): boolean
  setAllTimeframes(on: boolean): void
  /** The indicators on the chart now, in the order they were added. */
  indicators(): readonly { kind: IndicatorKind; options: Record<string, number> }[]
  /** Which indicators can honestly be drawn for the candles that are loaded. */
  offered(): readonly IndicatorInfo[]
  addIndicator(kind: IndicatorKind): void
  removeIndicator(kind: IndicatorKind): void
  setIndicatorOption(kind: IndicatorKind, option: string, value: number): void
  drawingTool(): DrawingKind | null
  setDrawingTool(kind: DrawingKind | null): void
  drawings(): readonly { id: string }[]
  patternView(): string
  setPatternView(id: string): void
  favourite(): boolean
  toggleFavourite(): Promise<void>
  /** How many candles are loaded, and what the provider said when there are none. */
  candles(): { loaded: number; note: string; loading: boolean }
  reloadCandles(): Promise<void>
  close(): void
}

/** The indicator spec, built from the catalogue and narrowed to what these candles can carry. */
const indicatorSpec = (screen: MarketScreen, description: string): ParamSpec => ({
  type: 'string',
  description,
  required: true,
  enum: screen.offered().map((one) => one.kind)
})

/**
 * The open market: its tabs, its chart bar, its indicators and its annotations.
 *
 * Registered while a market is open and gone when it is closed, which is the whole reason this is a surface of its own
 * rather than more controls on Markets. A timeframe only exists because a provider serves it, and offering one after
 * the market has been closed would be offering a control that cannot be set.
 */
export function marketSurface(screen: MarketScreen): SurfaceDeclaration {
  /** Lazily, like every `writable`: called while the declaration is being built it would run before anything is open. */
  const whenCandles = (): true | string => {
    if (!screen.can().candles) return 'This provider serves no historical data, so there is no chart to work on.'
    return screen.candles().loaded > 0 ? true : `No candles are loaded.${screen.candles().note ? ` ${screen.candles().note}` : ''}`
  }

  return {
    id: 'market',
    parent: 'markets',
    name: 'The open market',
    about: 'One market: its chart, its depth, its trades and whatever else its provider serves.',
    kind: 'page',
    keywords: ['market', 'chart', 'ticker', 'instrument', 'candles'],
    controls: {
      tab: {
        name: 'Half',
        about: 'Which half of the market page is showing.',
        /*
         * Only the halves this provider can fill.
         *
         * The buttons on screen are built from the same answer, so a tab that is not offered here is one that is not
         * on screen either. Offering `book` for a provider with no order book would be offering a page that can only
         * say it has nothing.
         */
        spec: {
          type: 'string',
          description: 'Which half of the market page is showing.',
          enum: MARKET_TABS.filter((one) => {
            const can = screen.can()
            if (one === 'book') return can.book
            if (one === 'trades') return can.trades
            if (one === 'derivatives') return can.derivatives
            if (one === 'chart' || one === 'patterns') return can.candles
            return true
          })
        },
        get: () => screen.tab(),
        set: (value) => screen.setTab(String(value))
      },
      interval: {
        name: 'Timeframe',
        about: 'Which candles the chart draws. Setting it loads that timeframe.',
        // The provider's own list, not a list of timeframes Orbis knows about.
        spec: { type: 'string', description: 'The candle length, as the provider names it.', enum: [...screen.can().intervals] },
        get: () => screen.interval(),
        writable: () => (screen.can().candles ? true : 'This provider serves no historical data, so there is no timeframe to choose.'),
        set: (value) => screen.setInterval(String(value))
      },
      chartType: {
        name: 'Chart type',
        spec: { type: 'string', description: 'How the candles are drawn.', enum: [...CHART_TYPE_IDS] },
        get: () => screen.chartType(),
        writable: whenCandles,
        set: (value) => screen.setChartType(String(value)),
        default: 'candles'
      },
      allTimeframes: {
        name: 'Show every timeframe',
        about: 'Puts every timeframe the provider serves on the bar, not just the ones in use.',
        spec: { type: 'boolean', description: 'Whether every timeframe the provider serves is on the bar.' },
        get: () => screen.allTimeframes(),
        set: (on) => screen.setAllTimeframes(on === true),
        default: false
      },
      drawingTool: {
        name: 'Drawing tool',
        about: 'Which annotation tool is armed. "none" puts the tools away.',
        spec: { type: 'string', description: 'The armed annotation tool, or none.', enum: ['none', ...DRAWING_KINDS] },
        get: () => screen.drawingTool() ?? 'none',
        writable: whenCandles,
        set: (value) => screen.setDrawingTool(String(value) === 'none' ? null : (String(value) as DrawingKind)),
        default: 'none'
      },
      patternView: {
        name: 'Patterns list',
        about: 'Which list the patterns half shows.',
        spec: { type: 'string', description: 'Which list the patterns half shows.', enum: [...PATTERN_VIEWS] },
        get: () => screen.patternView(),
        set: (value) => screen.setPatternView(String(value)),
        default: 'found'
      },
      favourite: {
        name: 'Favourite',
        about: 'Whether this market is marked. Marked markets have their own list.',
        spec: { type: 'boolean', description: 'Whether this market is marked as a favourite.' },
        get: () => screen.favourite(),
        set: (on) => {
          // The screen's own button toggles, and the register never calls a setter for a value already held, so
          // asking for the value it does not have is exactly one press of that button.
          void (on === screen.favourite() ? undefined : screen.toggleFavourite())
        }
      },
      /** Read-only: what is on the chart. Which indicators are on is changed by adding and removing them. */
      indicators: {
        name: 'Indicators on the chart',
        spec: { type: 'array', description: 'The indicators drawn on the chart now, with their periods.' },
        get: () => screen.indicators().map((one) => ({ indicator: one.kind, ...one.options }))
      }
    },
    actions: {
      addIndicator: {
        name: 'Add an indicator',
        about: 'Draws one of the indicators these candles can carry, with its own default period.',
        params: { indicator: indicatorSpec(screen, 'Which indicator to draw. Only the ones these candles can carry are offered.') },
        unavailable: () => {
          const why = whenCandles()
          return why === true ? null : why
        },
        run: (params) => {
          const kind = String(params.indicator) as IndicatorKind
          screen.addIndicator(kind)
          return { indicator: kind }
        },
        // Asked of the chart afterwards rather than assumed: an indicator already on is not added twice, and that is
        // a different sentence from one that was just put on.
        verify: (data) => {
          const kind = (data as { indicator: IndicatorKind }).indicator
          const on = screen.indicators().find((one) => one.kind === kind)
          const name = INDICATORS.find((one) => one.kind === kind)?.name ?? kind
          return on ? { done: true, detail: `${name} is on the chart, with ${Object.entries(on.options).map(([k, v]) => `${k} ${v}`).join(', ') || 'no settings'}.` } : { done: false, detail: `${name} is not on the chart.` }
        }
      },
      removeIndicator: {
        name: 'Remove an indicator',
        params: { indicator: { type: 'string', description: 'Which indicator to take off the chart.', required: true, enum: INDICATORS.map((one) => one.kind) } },
        run: (params) => {
          const kind = String(params.indicator) as IndicatorKind
          const was = screen.indicators().some((one) => one.kind === kind)
          screen.removeIndicator(kind)
          return { indicator: kind, was }
        },
        verify: (data) => {
          const { indicator, was } = data as { indicator: IndicatorKind; was: boolean }
          const name = INDICATORS.find((one) => one.kind === indicator)?.name ?? indicator
          if (screen.indicators().some((one) => one.kind === indicator)) return { done: false, detail: `${name} is still on the chart.` }
          return { done: true, detail: was ? `${name} is off the chart.` : `${name} was not on the chart.` }
        }
      },
      setIndicatorOption: {
        name: 'Change an indicator’s period',
        about: 'The same boxes in the chart legend, which only take a whole number of periods.',
        params: {
          indicator: { type: 'string', description: 'Which indicator to change.', required: true, enum: INDICATORS.map((one) => one.kind) },
          option: { type: 'string', description: 'Which of its settings: period, fast, slow, signal, deviations, multiplier.', required: true },
          // The same range the boxes on screen accept, so a refusal here is the refusal a person would get.
          value: { type: 'integer', description: 'The new value. A whole number of periods.', required: true, min: 1, max: 400 }
        },
        run: (params) => {
          const kind = String(params.indicator) as IndicatorKind
          const option = String(params.option)
          const on = screen.indicators().find((one) => one.kind === kind)
          if (!on) throw new Error(`${INDICATORS.find((one) => one.kind === kind)?.name ?? kind} is not on the chart. Add it first.`)
          if (!(option in on.options)) throw new Error(`${INDICATORS.find((one) => one.kind === kind)?.name ?? kind} has no setting called “${option}”. It has: ${Object.keys(on.options).join(', ') || 'none'}.`)
          screen.setIndicatorOption(kind, option, Number(params.value))
          return { indicator: kind, option, value: Number(params.value) }
        },
        verify: (data) => {
          const { indicator, option, value } = data as { indicator: IndicatorKind; option: string; value: number }
          const on = screen.indicators().find((one) => one.kind === indicator)
          const got = on?.options[option]
          return got === value
            ? { done: true, detail: `${INDICATORS.find((one) => one.kind === indicator)?.name ?? indicator} ${option} is ${value}.` }
            : { done: false, detail: `it reads ${got === undefined ? 'nothing' : got}.` }
        }
      },
      /*
       * Clearing the annotations is not here, on purpose.
       *
       * The only thing that clears them is the drawing toolbar's own two-step button, which exists while the chart
       * half is open. Reaching past it to the engine would be a second way of deleting somebody's lines, with its own
       * idea of when to ask -- and the number of them is in `state` below either way, which is the part worth knowing.
       */
      reloadCandles: {
        name: 'Load the candles again',
        about: 'Asks the provider for this timeframe again, which is what the “Try again” button does.',
        effects: ['read'],
        unavailable: () => (screen.can().candles ? null : 'This provider serves no historical data.'),
        run: async () => {
          await screen.reloadCandles()
          return { interval: screen.interval() }
        },
        verify: () => {
          const got = screen.candles()
          return got.loaded > 0
            ? { done: true, detail: `${got.loaded} candles are loaded for ${screen.interval()}.` }
            : { done: false, detail: got.note || 'the provider returned no candles.' }
        }
      },
      close: {
        name: 'Close the market',
        about: 'Stops the price stream for it as well as taking it off screen.',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    state: () => {
      const quote = screen.quote()
      const candles = screen.candles()
      const can = screen.can()
      return {
        activity: candles.loading ? 'running' : 'idle',
        detail: candles.loading ? `Loading ${screen.interval()} candles for ${screen.market().symbol}` : undefined,
        values: {
          symbol: screen.market().symbol,
          instrument: screen.market().instrumentId,
          // A price that has not arrived is said to be missing, never 0.
          price: quote?.last ?? 'not reported',
          change: quote?.changePercent ?? 'not reported',
          freshness: quote?.freshness ?? 'no price has arrived',
          timeframe: screen.interval(),
          candles: candles.loaded,
          candleNote: candles.note || undefined,
          indicators: screen.indicators().map((one) => one.kind),
          annotations: screen.drawings().length,
          providerServes: [can.candles ? 'candles' : null, can.book ? 'order book' : null, can.trades ? 'trades' : null, can.derivatives ? 'derivatives' : null].filter(Boolean)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- watchlists

/** What the watchlists have to hand over. */
export interface WatchlistsScreen {
  lists(): readonly { id: string; name: string; items: readonly { instrumentId: string }[] }[]
  activeList(): string | null
  setActiveList(id: string): void
  add(listId: string, instrumentId: string): Promise<unknown>
  removeItem(listId: string, instrumentId: string): Promise<unknown>
  create(name: string): Promise<unknown>
  remove(listId: string): Promise<unknown>
  /** The lists as they really are now, asked of the store, for checking that a change happened. */
  check(): Promise<readonly { id: string; name: string; items: readonly { instrumentId: string }[] }[]>
  /** Whether the watchlists are the list on screen. */
  showing(): boolean
}

/**
 * The watchlists.
 *
 * On Markets rather than inside the pane that draws them, because the lists are loaded with the screen and every
 * handler below works whichever pane is showing. `visible` says whether somebody can see them, which is a different
 * question from whether they can be changed.
 */
export function watchlistsSurface(screen: WatchlistsScreen): SurfaceDeclaration {
  const active = (): { id: string; name: string; items: readonly { instrumentId: string }[] } | null => {
    const id = screen.activeList()
    const lists = screen.lists()
    return lists.find((one) => one.id === id) ?? lists[0] ?? null
  }
  /** Said as a sentence, because "no list" has a fix and a bare false does not say what it is. */
  const whenList = (): true | string => (active() ? true : 'There are no watchlists yet. Create one first.')

  return {
    id: 'watchlists',
    parent: 'markets',
    name: 'Watchlists',
    about: 'The lists of markets being watched, and what is in the one that is open.',
    kind: 'panel',
    keywords: ['watchlist', 'watchlists', 'lists', 'watching'],
    visible: () => screen.showing(),
    controls: {
      list: {
        name: 'Open list',
        about: 'Which watchlist is open. Everything below acts on it.',
        spec: { type: 'string', description: 'The watchlist that is open, by its id or its name.', enum: screen.lists().map((one) => one.id) },
        get: () => {
          const id = screen.activeList()
          if (id === null) throw new Error('No watchlist is open yet.')
          return id
        },
        writable: whenList,
        set: (value) => screen.setActiveList(String(value))
      },
      /*
       * Read-only: what is in the open list. Changed by adding and removing.
       *
       * Not called "markets", and the name does not contain the word either. A path is matched forgivingly, so a
       * control called `markets` on a screen inside Markets makes `markets/market` resolve to *it* -- and the caller
       * is told it has arrived somewhere it has not.
       */
      items: {
        name: 'What is in the list',
        spec: { type: 'array', description: 'The instrument ids in the open watchlist.' },
        get: () => {
          const list = active()
          if (!list) throw new Error('There are no watchlists yet.')
          return list.items.map((one) => one.instrumentId)
        }
      }
    },
    actions: {
      add: {
        name: 'Add to the list',
        params: { market: { type: 'string', description: 'The instrument id, as market.search gives it: “binance:BTCUSDT”.', required: true } },
        unavailable: () => {
          const why = whenList()
          return why === true ? null : why
        },
        run: async (params) => {
          const list = active()!
          await screen.add(list.id, String(params.market))
          return { list: list.id, market: String(params.market) }
        },
        verify: async (data) => {
          const { list, market } = data as { list: string; market: string }
          const now = (await screen.check()).find((one) => one.id === list)
          if (!now) return { done: false, detail: 'that list is no longer there.' }
          return now.items.some((one) => one.instrumentId === market)
            ? { done: true, detail: `${market} is in ${now.name}, which now has ${now.items.length}.` }
            : { done: false, detail: `${market} is not in ${now.name}.` }
        }
      },
      remove: {
        name: 'Take out of the list',
        params: { market: { type: 'string', description: 'The instrument id to take out.', required: true } },
        unavailable: () => {
          const why = whenList()
          return why === true ? null : why
        },
        run: async (params) => {
          const list = active()!
          await screen.removeItem(list.id, String(params.market))
          return { list: list.id, market: String(params.market) }
        },
        verify: async (data) => {
          const { list, market } = data as { list: string; market: string }
          const now = (await screen.check()).find((one) => one.id === list)
          if (!now) return { done: false, detail: 'that list is no longer there.' }
          return now.items.some((one) => one.instrumentId === market)
            ? { done: false, detail: `${market} is still in ${now.name}.` }
            : { done: true, detail: `${market} is out of ${now.name}, which now has ${now.items.length}.` }
        }
      },
      create: {
        name: 'Create a watchlist',
        params: { name: { type: 'string', description: 'What to call it.', required: true } },
        run: async (params) => {
          const before = screen.lists().length
          await screen.create(String(params.name))
          return { name: String(params.name), before }
        },
        verify: async (data) => {
          const { name } = data as { name: string; before: number }
          const now = await screen.check()
          const made = now.find((one) => one.name === name)
          return made ? { done: true, detail: `“${made.name}” is there, and there are ${now.length} watchlists.` } : { done: false, detail: `no watchlist called “${name}” came back.` }
        }
      },
      /*
       * There is no rename here, on purpose.
       *
       * Nothing on this screen renames a watchlist, so a setter that did would be the surface adding a feature rather
       * than describing one -- a second code path, which is the one thing a surface must never be. It belongs here
       * the day the screen itself grows the control.
       */
      delete: {
        name: 'Delete the open list',
        about: 'Forgets the list and everything in it. The markets themselves are untouched.',
        effects: ['delete'],
        confirmation: 'always',
        unavailable: () => {
          const why = whenList()
          return why === true ? null : why
        },
        run: async () => {
          const list = active()!
          await screen.remove(list.id)
          return { list: list.id, name: list.name }
        },
        verify: async (data) => {
          const { list, name } = data as { list: string; name: string }
          const now = await screen.check()
          return now.some((one) => one.id === list) ? { done: false, detail: `“${name}” is still there.` } : { done: true, detail: `“${name}” is gone, and ${now.length} watchlists are left.` }
        }
      }
    },
    state: () => {
      const list = active()
      return {
        values: {
          lists: screen.lists().length,
          open: list ? list.name : 'none',
          markets: list ? list.items.length : 0,
          onScreen: screen.showing()
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the screener

export const SCREENER_OPERATORS: readonly ScreenerOperator[] = ['gt', 'lt', 'between']

/** What the screener panel has to hand over. */
export interface ScreenerScreen {
  query(): ScreenerQuery
  setQuery(next: ScreenerQuery): void
  /** Runs the screen as it stands. The same call the Run button makes. */
  run(query: ScreenerQuery): Promise<void>
  /** What came back last: null when nothing has been run, which is not the same as nothing matching. */
  answer(): { results: number; universe: number; measured: number } | null
  running(): boolean
  problem(): string
  /** The screens that can be loaded: the presets Orbis ships and whatever has been saved. */
  loadable(): readonly { id: string; name: string; query: ScreenerQuery }[]
  load(id: string): void | Promise<void>
  save(name: string): Promise<unknown>
  /** The saved screens as they really are now, for checking that saving happened. */
  checkSaved(): Promise<readonly { id: string; name: string }[]>
}

const conditionText = (one: ScreenerCondition): string => {
  const field = FIELDS.find((f) => f.field === one.field)?.label ?? one.field
  const how = one.operator === 'gt' ? 'above' : one.operator === 'lt' ? 'below' : 'between'
  const value = one.operator === 'between' ? `${one.value} and ${one.value2 ?? '?'}` : String(one.value)
  return `${field} ${how} ${value}${one.period ? ` over ${one.period}` : ''}${one.interval ? ` on ${one.interval}` : ''}`
}

/**
 * The screener: its conditions, its sort and its limit.
 *
 * Every field, operator and unit below comes from `src/shared/markets/screener.ts` -- the same model the builder on
 * screen draws itself from -- so a field added there is one Orbis can use in the same change. The conditions are a
 * list, so they are reached by position: `setCondition` takes the row and changes it, which is exactly what the row's
 * own boxes do.
 */
export function screenerSurface(screen: ScreenerScreen): SurfaceDeclaration {
  const fieldSpec = (description: string, required = false): ParamSpec => ({ type: 'string', description, required, enum: FIELDS.map((one) => one.field) })
  const rows = (): ScreenerCondition[] => screen.query().conditions

  return {
    id: 'screener',
    parent: 'markets',
    name: 'Screener',
    about: 'Asks every market a set of questions and lists the ones that answer.',
    kind: 'page',
    /*
     * No "markets" among these, and it is not a style choice.
     *
     * A path segment is matched against keywords too, so a keyword of "find markets" made `markets/market` resolve to
     * the screener whenever no market was open -- and a walk was told it had arrived at a market page while looking at
     * a table of conditions. A keyword that is a prefix of a sibling's id steals that sibling's path.
     */
    keywords: ['screener', 'filter', 'screen', 'conditions'],
    controls: {
      match: {
        name: 'Match',
        about: 'Whether every condition has to hold, or any one of them.',
        spec: { type: 'string', description: 'Whether every condition has to hold, or any one of them.', enum: ['all', 'any'] },
        get: () => screen.query().match,
        set: (value) => screen.setQuery({ ...screen.query(), match: value === 'any' ? 'any' : 'all' }),
        default: 'all'
      },
      groupMatch: {
        name: 'Match between groups',
        spec: { type: 'string', description: 'How the groups of conditions join each other.', enum: ['all', 'any'] },
        get: () => screen.query().groupMatch ?? null,
        // Nothing to join without groups, and the sentence says so rather than leaving a dead control.
        writable: () => ((screen.query().groups ?? []).length > 0 ? true : 'There are no groups of conditions, so there is nothing for this to join.'),
        set: (value) => screen.setQuery({ ...screen.query(), groupMatch: value === 'any' ? 'any' : 'all' })
      },
      limit: {
        name: 'How many results',
        spec: { type: 'integer', description: 'At most this many markets come back.', min: 1, max: 500 },
        get: () => screen.query().limit,
        set: (value) => screen.setQuery({ ...screen.query(), limit: Number(value) }),
        default: 50
      },
      sortField: {
        name: 'Sort by',
        spec: fieldSpec('Which measurement the results are ordered by.'),
        get: () => screen.query().sort.field,
        set: (value) => screen.setQuery({ ...screen.query(), sort: { ...screen.query().sort, field: String(value) as ScreenerField } })
      },
      sortDirection: {
        name: 'Sort direction',
        spec: { type: 'string', description: 'Highest first or lowest first.', enum: ['asc', 'desc'] },
        get: () => screen.query().sort.direction,
        set: (value) => screen.setQuery({ ...screen.query(), sort: { ...screen.query().sort, direction: value === 'asc' ? 'asc' : 'desc' } }),
        default: 'desc'
      },
      /** Read-only: the conditions as sentences, so a caller can see what it is about to change by position. */
      conditions: {
        name: 'Conditions',
        spec: { type: 'array', description: 'The conditions as they read, in the order the rows are in.' },
        get: () => rows().map((one, at) => ({ at, reads: conditionText(one), ...one }))
      }
    },
    actions: {
      run: {
        name: 'Run the screen',
        about: 'Asks every market in the universe the conditions as they stand.',
        effects: ['read'],
        unavailable: () => (screen.running() ? 'A screen is already running.' : null),
        run: async () => {
          await screen.run(screen.query())
          return { conditions: rows().length }
        },
        /*
         * Nothing matching is a real answer, and it is reported as one.
         *
         * Verifying "some results came back" would report a correct screen as a failure whenever the conditions are
         * strict, which is most of the time. What is checked is that the run finished and the panel has an answer.
         */
        verify: () => {
          if (screen.problem() !== '') return { done: false, detail: screen.problem() }
          const got = screen.answer()
          if (!got) return { done: false, detail: 'the screen has no answer, and nothing said why.' }
          return { done: true, detail: `${got.results} of ${got.universe} markets match${got.measured ? `, measured on ${got.measured}` : ''}.` }
        }
      },
      addCondition: {
        name: 'Add a condition',
        about: 'Adds a row. Without parameters it is the row the Add button makes, ready to be changed.',
        params: {
          field: fieldSpec('What to measure.'),
          operator: { type: 'string', description: 'above, below, or between two numbers.', enum: [...SCREENER_OPERATORS] },
          value: { type: 'number', description: 'The number to compare against.' },
          value2: { type: 'number', description: 'The high end, for between.' },
          period: { type: 'integer', description: 'The indicator period, where the field has one.', min: 1, max: 400 },
          interval: { type: 'string', description: 'Which candles an indicator is measured on: “1h”, “1d”.' }
        },
        run: (params) => {
          const field = (params.field ? String(params.field) : 'changePercent') as ScreenerField
          const operator = (params.operator ? String(params.operator) : 'gt') as ScreenerOperator
          if (operator === 'between' && typeof params.value2 !== 'number') throw new Error('“between” needs value2 as well as value.')
          const condition: ScreenerCondition = {
            field,
            operator,
            value: typeof params.value === 'number' ? params.value : 5,
            ...(typeof params.value2 === 'number' ? { value2: params.value2 } : {}),
            // The field's own default period when one was not given, which is what the row on screen starts with.
            ...(typeof params.period === 'number' ? { period: params.period } : FIELDS.find((one) => one.field === field)?.defaultPeriod ? { period: FIELDS.find((one) => one.field === field)!.defaultPeriod } : {}),
            ...(params.interval ? { interval: String(params.interval) } : {})
          }
          screen.setQuery({ ...screen.query(), conditions: [...rows(), condition] })
          return { at: rows().length, condition }
        },
        verify: (data) => {
          const { at } = data as { at: number }
          const now = rows()[at]
          return now ? { done: true, detail: `Condition ${at + 1} of ${rows().length} is: ${conditionText(now)}.` } : { done: false, detail: `there is no condition at position ${at + 1}.` }
        }
      },
      setCondition: {
        name: 'Change a condition',
        about: 'Changes one row. Only what is given is changed; the rest of the row stays as it was.',
        params: {
          at: { type: 'integer', description: 'Which row, counting from 1 as they read on screen.', required: true, min: 1, max: 40 },
          field: fieldSpec('What to measure.'),
          operator: { type: 'string', description: 'above, below, or between two numbers.', enum: [...SCREENER_OPERATORS] },
          value: { type: 'number', description: 'The number to compare against.' },
          value2: { type: 'number', description: 'The high end, for between.' },
          period: { type: 'integer', description: 'The indicator period, where the field has one.', min: 1, max: 400 },
          interval: { type: 'string', description: 'Which candles an indicator is measured on.' }
        },
        run: (params) => {
          const at = Number(params.at) - 1
          const was = rows()[at]
          // Refused rather than silently adding a row: a plan that lost count must be told, not obeyed.
          if (!was) throw new Error(`There is no condition at position ${Number(params.at)}. There ${rows().length === 1 ? 'is 1' : `are ${rows().length}`}.`)
          const next: ScreenerCondition = {
            ...was,
            ...(params.field ? { field: String(params.field) as ScreenerField } : {}),
            ...(params.operator ? { operator: String(params.operator) as ScreenerOperator } : {}),
            ...(typeof params.value === 'number' ? { value: params.value } : {}),
            ...(typeof params.value2 === 'number' ? { value2: params.value2 } : {}),
            ...(typeof params.period === 'number' ? { period: params.period } : {}),
            ...(params.interval ? { interval: String(params.interval) } : {})
          }
          if (next.operator === 'between' && typeof next.value2 !== 'number') throw new Error('“between” needs value2 as well as value.')
          screen.setQuery({ ...screen.query(), conditions: rows().map((one, i) => (i === at ? next : one)) })
          return { at, next }
        },
        verify: (data) => {
          const { at, next } = data as { at: number; next: ScreenerCondition }
          const now = rows()[at]
          return now && now.field === next.field && now.operator === next.operator && now.value === next.value
            ? { done: true, detail: `Condition ${at + 1} is: ${conditionText(now)}.` }
            : { done: false, detail: now ? `condition ${at + 1} reads ${conditionText(now)}.` : `there is no condition at position ${at + 1} any more.` }
        }
      },
      removeCondition: {
        name: 'Remove a condition',
        params: { at: { type: 'integer', description: 'Which row, counting from 1.', required: true, min: 1, max: 40 } },
        run: (params) => {
          const at = Number(params.at) - 1
          const was = rows()[at]
          if (!was) throw new Error(`There is no condition at position ${Number(params.at)}. There ${rows().length === 1 ? 'is 1' : `are ${rows().length}`}.`)
          screen.setQuery({ ...screen.query(), conditions: rows().filter((_one, i) => i !== at) })
          return { was: conditionText(was), left: rows().length }
        },
        verify: (data) => {
          const { was } = data as { was: string; left: number }
          return { done: true, detail: `“${was}” is gone, and ${rows().length} ${rows().length === 1 ? 'condition is' : 'conditions are'} left.` }
        }
      },
      load: {
        name: 'Load a screen',
        about: 'Loads one of the screens Orbis ships or one that was saved, and runs it.',
        params: { screen: { type: 'string', description: 'Which screen to load, by its name or its id.', required: true, enum: screen.loadable().map((one) => one.id) } },
        run: async (params) => {
          const id = String(params.screen)
          const found = screen.loadable().find((one) => one.id === id)
          if (!found) throw new Error(`There is no screen called “${id}”. There is: ${screen.loadable().map((one) => one.name).join(', ')}.`)
          await screen.load(id)
          return { screen: found.name, conditions: found.query.conditions.length }
        },
        verify: (data) => {
          const { screen: name } = data as { screen: string; conditions: number }
          const got = screen.answer()
          if (screen.problem() !== '') return { done: false, detail: screen.problem() }
          return got ? { done: true, detail: `“${name}” is loaded and ran: ${got.results} of ${got.universe} markets match.` } : { done: false, detail: `“${name}” was loaded and nothing has come back yet.` }
        }
      },
      save: {
        name: 'Save this screen',
        params: { name: { type: 'string', description: 'What to call it.', required: true } },
        run: async (params) => {
          await screen.save(String(params.name))
          return { name: String(params.name) }
        },
        verify: async (data) => {
          const { name } = data as { name: string }
          const saved = await screen.checkSaved()
          return saved.some((one) => one.name === name) ? { done: true, detail: `“${name}” is in the saved screens, of which there are ${saved.length}.` } : { done: false, detail: `“${name}” is not in the saved screens.` }
        }
      }
    },
    state: () => {
      const got = screen.answer()
      return {
        activity: screen.running() ? 'running' : screen.problem() !== '' ? 'failed' : got ? 'finished' : 'idle',
        detail: screen.problem() || undefined,
        values: {
          conditions: rows().length,
          groups: (screen.query().groups ?? []).length,
          // Nothing run yet is a different thing from nothing matching, and both are said in words.
          results: got ? got.results : 'nothing has been run yet',
          universe: got ? got.universe : 'nothing has been run yet',
          sort: `${screen.query().sort.field} ${screen.query().sort.direction}`,
          limit: screen.query().limit
        }
      }
    }
  }
}
