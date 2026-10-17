import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResult } from '../../shared/browserControl.ts'
import type { SurfaceDescriptor, SurfaceOutcome } from '../../shared/surfaces.ts'
import type { FilesCommand, FilesViewState } from '../../shared/filesControl.ts'
import { FILES_CONTROL_CONTRACT } from '../../shared/filesControl.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import { marketsSurface, marketSurface, screenerSurface, watchlistsSurface } from '../../renderer/src/components/marketsSurfaces.ts'
import { openPageSurface, pagesSurface, pageStudioSurface, unitConverterSurface } from '../../renderer/src/components/pagesSurfaces.ts'
import { filesBrowserSurface, filesViewSurface } from '../../renderer/src/components/filesSurfaces.ts'
import { DEFAULT_QUERY, type ScreenerQuery } from '../../shared/markets/screener.ts'
import type { IndicatorKind } from '../../shared/markets/indicators.ts'
import { INDICATORS } from '../../shared/markets/indicators.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * Markets, Pages and Files, driven end to end: a capability in the main process, the bridge, the register in the
 * window, and each module's own getters and setters.
 *
 * The one hop that needs an application -- `control:window-run` between the two processes -- is replaced by a function
 * that turns everything into text and back, which is what that hop does to a value. Everything else is the real
 * thing: the real registry with its real approval, verification and undo, the real six capabilities, the real
 * answering code, the real register, and the real declarations the three screens register.
 *
 * React is not here, so each screen is stood up the way React stands it up: state in a variable, a setter that
 * changes it and then says the screen has drawn, and a panel that is registered while its section is open.
 */

const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

const run = (world: { control: BrowserControl; asks: string[]; approve: boolean }, capability: string, params: Record<string, unknown>, source: 'user' | 'orion' = 'user'): Promise<CommandResult> =>
  world.control.execute(
    { capability, params, source },
    {
      confirm: async (request) => {
        world.asks.push(request.action)
        return world.approve
      }
    }
  )

/** A control layer with the six screen capabilities on it, answered by the real register in this process. */
function controlOver(): { control: BrowserControl; asks: string[]; approve: boolean } {
  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  return {
    control,
    asks,
    get approve() {
      return state.approve
    },
    set approve(value: boolean) {
      state.approve = value
    }
  }
}

// ---------------------------------------------------------------- Markets

interface Watchlist {
  id: string
  name: string
  items: { instrumentId: string }[]
}

/** Markets as React holds it: state, the handlers its own controls call, and panels that come and go. */
function markets(): ReturnType<typeof controlOver> & {
  view: {
    enabled: boolean | null
    section: string
    pane: string
    tab: string
    interval: string
    chartType: string
    indicators: { kind: IndicatorKind; options: Record<string, number> }[]
    candles: number
    candleNote: string
    loadedFor: string[]
    favourites: string[]
    lists: Watchlist[]
    activeList: string | null
    ranked: number
  }
  query: ScreenerQuery
  screenerOpen(): void
} {
  forgetSurfaces()
  const view = {
    enabled: null as boolean | null,
    section: 'markets',
    pane: 'dashboard',
    tab: 'chart',
    interval: '1h',
    chartType: 'candles',
    indicators: [] as { kind: IndicatorKind; options: Record<string, number> }[],
    candles: 300,
    candleNote: '',
    loadedFor: [] as string[],
    favourites: [] as string[],
    lists: [{ id: 'l1', name: 'Watching', items: [] as { instrumentId: string }[] }] as Watchlist[],
    activeList: 'l1' as string | null,
    ranked: 0,
    movers: 'gainers',
    moversOpen: true,
    panels: false,
    search: '',
    open: true as boolean
  }
  // The provider's own timeframes: three of them, which is what makes a fourth a refusal rather than a mistake.
  const intervals = ['1m', '1h', '4h']
  const state = { query: { ...DEFAULT_QUERY, conditions: [{ field: 'changePercent' as const, operator: 'gt' as const, value: 5 }] } as ScreenerQuery, ran: 0, results: null as { results: number; universe: number; measured: number } | null, running: false, problem: '', saved: [] as { id: string; name: string }[] }

  let screener: (() => void) | null = null
  const openScreener = (): void => {
    if (screener) return
    screener = registerSurface(() =>
      screenerSurface({
        query: () => state.query,
        setQuery: (next) => {
          state.query = next
          surfacesDrawn()
        },
        run: async (wanted) => {
          state.running = true
          state.ran += 1
          // The conditions decide the answer, as a real screen's do; nothing matching is a real answer.
          state.results = { results: wanted.conditions.length > 1 ? 0 : 12, universe: 2140, measured: 400 }
          state.problem = ''
          state.running = false
          surfacesDrawn()
        },
        answer: () => state.results,
        running: () => state.running,
        problem: () => state.problem,
        loadable: () => [{ id: 'Big movers', name: 'Big movers', query: { ...DEFAULT_QUERY, conditions: [{ field: 'changePercent', operator: 'gt', value: 10 }] } }, ...state.saved.map((one) => ({ ...one, query: state.query }))],
        load: async (id) => {
          if (id !== 'Big movers') throw new Error(`There is no screen called “${id}”.`)
          state.query = { ...DEFAULT_QUERY, conditions: [{ field: 'changePercent', operator: 'gt', value: 10 }] }
          state.results = { results: 3, universe: 2140, measured: 0 }
          surfacesDrawn()
        },
        save: async (name) => {
          state.saved.push({ id: `s${state.saved.length + 1}`, name })
          surfacesDrawn()
          return { name }
        },
        checkSaved: async () => state.saved
      })
    )
    surfacesDrawn()
  }
  const closeScreener = (): void => {
    screener?.()
    screener = null
    surfacesDrawn()
  }

  registerSurface(() =>
    marketsSurface({
      enabled: () => view.enabled,
      section: () => view.section,
      openSection: (id) => {
        view.section = id
        if (id === 'screener') openScreener()
        else closeScreener()
        surfacesDrawn()
      },
      pane: () => view.pane,
      setPane: (id) => {
        view.pane = id
        surfacesDrawn()
      },
      search: () => view.search,
      setSearch: (text) => {
        view.search = text
        surfacesDrawn()
      },
      movers: () => view.movers,
      setMovers: (kind) => {
        view.movers = kind
        surfacesDrawn()
      },
      moversOpen: () => view.moversOpen,
      setMoversOpen: (on) => {
        view.moversOpen = on
        surfacesDrawn()
      },
      panels: () => view.panels,
      setPanels: (on) => {
        view.panels = on
        surfacesDrawn()
      },
      refresh: async () => {
        view.ranked += 1
        surfacesDrawn()
      },
      connection: () => 'connected',
      ranking: () => ({ available: view.ranked > 0 ? true : null, gainers: view.ranked > 0 ? 8 : 0, tiles: view.ranked > 0 ? 40 : 0, busy: false }),
      openMarket: () => (view.open ? 'binance:BTCUSDT' : null),
      close: () => undefined
    })
  )

  registerSurface(() =>
    watchlistsSurface({
      lists: () => view.lists,
      activeList: () => view.activeList,
      setActiveList: (id) => {
        view.activeList = id
        surfacesDrawn()
      },
      add: async (listId, instrumentId) => {
        view.lists = view.lists.map((one) => (one.id === listId ? { ...one, items: [...one.items, { instrumentId }] } : one))
        surfacesDrawn()
      },
      removeItem: async (listId, instrumentId) => {
        view.lists = view.lists.map((one) => (one.id === listId ? { ...one, items: one.items.filter((each) => each.instrumentId !== instrumentId) } : one))
        surfacesDrawn()
      },
      create: async (name) => {
        view.lists = [...view.lists, { id: `l${view.lists.length + 1}`, name, items: [] }]
        view.activeList = `l${view.lists.length}`
        surfacesDrawn()
      },
      remove: async (listId) => {
        view.lists = view.lists.filter((one) => one.id !== listId)
        view.activeList = null
        surfacesDrawn()
      },
      check: async () => view.lists,
      showing: () => view.section === 'markets' && view.pane === 'watchlists'
    })
  )

  let market: (() => void) | null = null
  const openMarketPage = (): void => {
    if (market) return
    market = registerSurface(() =>
      marketSurface({
        market: () => ({ instrumentId: 'binance:BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin' }),
        // No order book from this provider, which is what keeps `book` out of the tab control's values.
        can: () => ({ candles: true, book: false, trades: true, derivatives: false, intervals }),
        quote: () => ({ last: 64120.5, changePercent: 1.4, freshness: 'real-time' }),
        tab: () => view.tab,
        setTab: (id) => {
          view.tab = id
          surfacesDrawn()
        },
        interval: () => view.interval,
        setInterval: async (id) => {
          view.interval = id
          view.loadedFor.push(id)
          view.candles = 300
          surfacesDrawn()
        },
        chartType: () => view.chartType,
        setChartType: (id) => {
          view.chartType = id
          surfacesDrawn()
        },
        allTimeframes: () => false,
        setAllTimeframes: () => surfacesDrawn(),
        indicators: () => view.indicators,
        // Volume indicators are not offered, as they would not be for a provider without volume.
        offered: () => INDICATORS.filter((one) => !one.needsVolume),
        addIndicator: (kind) => {
          if (!view.indicators.some((one) => one.kind === kind)) view.indicators.push({ kind, options: { ...(INDICATORS.find((one) => one.kind === kind)?.defaults ?? {}) } })
          surfacesDrawn()
        },
        removeIndicator: (kind) => {
          view.indicators = view.indicators.filter((one) => one.kind !== kind)
          surfacesDrawn()
        },
        setIndicatorOption: (kind, option, value) => {
          view.indicators = view.indicators.map((one) => (one.kind === kind ? { ...one, options: { ...one.options, [option]: value } } : one))
          surfacesDrawn()
        },
        drawingTool: () => null,
        setDrawingTool: () => surfacesDrawn(),
        drawings: () => [],
        patternView: () => 'found',
        setPatternView: () => surfacesDrawn(),
        favourite: () => view.favourites.includes('binance:BTCUSDT'),
        toggleFavourite: async () => {
          view.favourites = view.favourites.includes('binance:BTCUSDT') ? [] : ['binance:BTCUSDT']
          surfacesDrawn()
        },
        candles: () => ({ loaded: view.candles, note: view.candleNote, loading: false }),
        reloadCandles: async () => {
          view.loadedFor.push(view.interval)
          surfacesDrawn()
        },
        close: () => {
        view.open = false
        // The page goes with the market, the way the component is taken away when nothing is open.
        market?.()
        market = null
        surfacesDrawn()
        }
      })
    )
    surfacesDrawn()
  }
  openMarketPage()

  return { ...controlOver(), view, get query() { return state.query }, screenerOpen: openScreener }
}

test('markets: a screen that has not said whether it is on cannot be set, and says which of the two it is', async () => {
  const world = markets()
  const refused = await run(world, 'screen.write', { path: 'markets/section', value: 'screener' })
  assert.equal(refused.ok, false)
  assert.match(refused.error?.message ?? '', /has not said yet whether it is switched on/)

  world.view.enabled = false
  const off = await run(world, 'screen.write', { path: 'markets/section', value: 'screener' })
  assert.equal(off.ok, false)
  // A different sentence for a different fact, with the fix in it.
  assert.match(off.error?.message ?? '', /switched off.*Turn it on in Markets first/)
})

test('markets: the walk opens the screener nobody mentioned, and the screener then says what is on it', async () => {
  const world = markets()
  world.view.enabled = true

  const there = await run(world, 'screen.goTo', { path: 'markets/screener' })
  assert.equal(there.ok, true, there.error?.message)
  assert.deepEqual((there.data as { opened: string[] }).opened, ['markets/screener'])
  assert.equal(world.view.section, 'screener')

  // Reached by position, with the field list the screener's own builder draws from.
  const changed = await run(world, 'screen.do', { path: 'markets/screener/setCondition', params: { at: 1, field: 'rsi', operator: 'lt', value: 30, period: 14 } })
  assert.equal(changed.ok, true, changed.error?.message)
  // The screener's own label for the field, not a second name invented for Orion.
  assert.match(changed.verification?.detail ?? '', /Condition 1 is: RSI below 30 over 14\./)

  const ran = await run(world, 'screen.do', { path: 'markets/screener/run' })
  assert.equal(ran.ok, true, ran.error?.message)
  assert.match(ran.verification?.detail ?? '', /12 of 2140 markets match, measured on 400/)
})

test('markets: a condition that is not there is refused with how many there are, and nothing is added', async () => {
  const world = markets()
  world.view.enabled = true
  await run(world, 'screen.goTo', { path: 'markets/screener' })

  const missed = await run(world, 'screen.do', { path: 'markets/screener/setCondition', params: { at: 4, field: 'rsi' } })
  assert.equal(missed.ok, false)
  assert.equal(missed.error?.code, 'failed')
  assert.match(missed.error?.message ?? '', /There is no condition at position 4\. There is 1\./)
  assert.equal(world.query.conditions.length, 1, 'nothing was added')

  // And the range on the row number is the screener's own, refused before anything is touched.
  const silly = await run(world, 'screen.do', { path: 'markets/screener/setCondition', params: { at: 0 } })
  assert.equal(silly.ok, false)
  assert.equal(silly.error?.code, 'invalid-params')
  assert.match(silly.error?.message ?? '', /at least 1/)
})

test('markets: the timeframe control offers what the provider serves, and refuses what it does not', async () => {
  const world = markets()
  world.view.enabled = true

  const reading = await run(world, 'screen.read', { path: 'markets/market/interval' })
  assert.equal(reading.ok, true, reading.error?.message)
  assert.deepEqual((reading.data as { values: string[] }).values, ['1m', '1h', '4h'], 'the provider’s own list')

  const set = await run(world, 'screen.write', { path: 'markets/market/interval', value: '4h' })
  assert.equal(set.ok, true, set.error?.message)
  assert.equal(world.view.interval, '4h')
  assert.deepEqual(world.view.loadedFor, ['4h'], 'the candles for it were loaded, as pressing the button does')

  const nope = await run(world, 'screen.write', { path: 'markets/market/interval', value: '3m' })
  assert.equal(nope.ok, false)
  assert.match(nope.error?.message ?? '', /must be one of: 1m, 1h, 4h/)
  assert.equal(world.view.interval, '4h', 'nothing changed')

  // The half the provider cannot fill is not offered either.
  const tab = await run(world, 'screen.read', { path: 'markets/market/tab' })
  const halves = (tab.data as { values: string[] }).values
  assert.ok(!halves.includes('book'), 'a provider with no order book does not offer the book half')
  assert.ok(halves.includes('trades'))
})

test('markets: an indicator is added, its period changed, and a period on one that is not there fails with why', async () => {
  const world = markets()
  world.view.enabled = true

  const added = await run(world, 'screen.do', { path: 'markets/market/addIndicator', params: { indicator: 'rsi' } })
  assert.equal(added.ok, true, added.error?.message)
  assert.match(added.verification?.detail ?? '', /Relative strength index is on the chart, with period 14\./)

  const period = await run(world, 'screen.do', { path: 'markets/market/setIndicatorOption', params: { indicator: 'rsi', option: 'period', value: 21 } })
  assert.equal(period.ok, true, period.error?.message)
  assert.equal(world.view.indicators[0].options.period, 21)

  const absent = await run(world, 'screen.do', { path: 'markets/market/setIndicatorOption', params: { indicator: 'macd', option: 'fast', value: 8 } })
  assert.equal(absent.ok, false)
  assert.match(absent.error?.message ?? '', /MACD is not on the chart\. Add it first\./)

  // A setting that indicator does not have is refused with the ones it does.
  const wrong = await run(world, 'screen.do', { path: 'markets/market/setIndicatorOption', params: { indicator: 'rsi', option: 'deviations', value: 2 } })
  assert.equal(wrong.ok, false)
  assert.match(wrong.error?.message ?? '', /has no setting called “deviations”\. It has: period\./)

  // An indicator the candles cannot carry is not even offered.
  const volume = await run(world, 'screen.do', { path: 'markets/market/addIndicator', params: { indicator: 'obv' } })
  assert.equal(volume.ok, false)
  assert.match(volume.error?.message ?? '', /must be one of/)
})

test('markets: a market is added to a watchlist and the list is asked again to confirm it', async () => {
  const world = markets()
  world.view.enabled = true

  const added = await run(world, 'screen.do', { path: 'markets/watchlists/add', params: { market: 'binance:ETHUSDT' } })
  assert.equal(added.ok, true, added.error?.message)
  assert.match(added.verification?.detail ?? '', /binance:ETHUSDT is in Watching, which now has 1\./)

  const inList = await run(world, 'screen.read', { path: 'markets/watchlists/items' })
  assert.deepEqual((inList.data as { value: string[] }).value, ['binance:ETHUSDT'])
})

test('markets: deleting a watchlist asks first, and is not done when the answer is no', async () => {
  const world = markets()
  world.view.enabled = true

  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'markets/watchlists/delete' }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.equal(world.view.lists.length, 1, 'nothing was deleted')
  assert.deepEqual(world.asks, ['Do markets/watchlists/delete in Orbis'])

  world.approve = true
  const done = await run(world, 'screen.do', { path: 'markets/watchlists/delete' }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.match(done.verification?.detail ?? '', /“Watching” is gone, and 0 watchlists are left\./)

  // And with no list left, the controls say what would fix it rather than going quiet.
  const none = await run(world, 'screen.do', { path: 'markets/watchlists/add', params: { market: 'binance:ETHUSDT' } })
  assert.equal(none.ok, false)
  assert.match(none.error?.message ?? '', /There are no watchlists yet\. Create one first\./)
})

test('markets: the market page goes when the market does, and the walk says so rather than guessing', async () => {
  const world = markets()
  world.view.enabled = true
  assert.equal((await run(world, 'screen.read', { path: 'markets/market/chartType' })).ok, true)

  const closed = await run(world, 'screen.do', { path: 'markets/market/close' })
  assert.equal(closed.ok, true, closed.error?.message)

  const gone = await run(world, 'screen.read', { path: 'markets/market/chartType' })
  assert.equal(gone.ok, false)
  assert.equal(gone.error?.code, 'not-found')

  // Markets says a market can be opened and that only a person or `market.open` can do it.
  const walk = await run(world, 'screen.goTo', { path: 'markets/market' })
  assert.equal(walk.ok, false)
  assert.match(walk.error?.message ?? '', /cannot be opened by Orbis: a market has to be named first\. Ask market\.open/)
})

// ---------------------------------------------------------------- Pages

/** Pages as React holds it: the library, a studio that is open or not, and a Page that is open or not. */
function pages(): ReturnType<typeof controlOver> & {
  // `permissionsIn` is here because a test turns it on: what a Page may reach is unreadable until the main process has
  // answered, and that is the only way to drive the moment it answers.
  view: { screen: string; search: string; subject: string | null; favourites: string[]; loading: boolean; amount: string; from: string; to: string; converted: number; permissionsIn: boolean }
} {
  forgetSurfaces()
  const library = [
    { pageId: 'p1', slug: 'unit-converter', title: 'Unit Converter', url: 'orbis://pages/unit-converter', favourite: false },
    { pageId: 'p2', slug: 'function-plotter', title: 'Function Plotter', url: 'orbis://pages/function-plotter', favourite: false }
  ]
  const view = { screen: 'library', search: '', subject: null as string | null, favourites: [] as string[], loading: true, studioTab: 'describe', amount: '36', from: 'km/h', to: 'm/s', converted: 0, answer: null as { display: string; dimension: string; exact: boolean } | null, problem: '', showing: false, permissionsIn: false }

  let page: (() => void) | null = null
  let tool: (() => void) | null = null
  let studio: (() => void) | null = null

  const openStudio = (): void => {
    view.screen = 'studio'
    page?.()
    page = null
    tool?.()
    tool = null
    studio = registerSurface(() =>
      pageStudioSurface({
        tab: () => view.studioTab,
        setTab: (id) => {
          view.studioTab = id
          surfacesDrawn()
        },
        tabs: [
          { id: 'describe', label: 'Describe' },
          { id: 'builder', label: 'Build' },
          { id: 'diagnostics', label: 'Diagnostics' }
        ],
        back: () => {
          view.screen = 'library'
          studio?.()
          studio = null
          surfacesDrawn()
        }
      })
    )
    surfacesDrawn()
  }

  const openPage = (slug: string): void => {
    const card = library.find((one) => one.slug === slug)!
    view.screen = 'page'
    studio?.()
    studio = null
    page?.()
    tool?.()
    page = registerSurface(() =>
      openPageSurface({
        page: () => ({ pageId: card.pageId, slug: card.slug, title: card.title, url: card.url, categories: ['maths'], limitations: ['No network, so no exchange rates.'] }),
        permissions: () => {
          // Throws until the answer is in, which is what the real frame does.
          if (!view.permissionsIn) throw new Error('What this Page may reach has not come back yet.')
          return [{ capabilityId: 'units.convert', name: 'Convert units', outcome: 'allow', risk: 'low' }]
        },
        showingPermissions: () => view.showing,
        setShowingPermissions: (on) => {
          view.showing = on
          surfacesDrawn()
        },
        back: () => {
          view.screen = 'library'
          page?.()
          page = null
          tool?.()
          tool = null
          surfacesDrawn()
        },
        close: () => undefined
      })
    )
    if (slug === 'unit-converter') {
      tool = registerSurface(() =>
        unitConverterSurface({
          amount: () => view.amount,
          setAmount: (text) => {
            view.amount = text
            surfacesDrawn()
          },
          from: () => view.from,
          setFrom: (text) => {
            view.from = text
            surfacesDrawn()
          },
          to: () => view.to,
          setTo: (text) => {
            view.to = text
            surfacesDrawn()
          },
          convert: async () => {
            view.converted += 1
            const amount = Number(view.amount)
            // The engine's answer, including its refusal: a length is not a speed, and it says so.
            if (!Number.isFinite(amount)) {
              view.answer = null
              view.problem = 'That is not a number.'
            } else if (view.from === 'km/h' && view.to === 'm/s') {
              view.answer = { display: `${(amount / 3.6).toFixed(4)} m/s`, dimension: 'speed', exact: true }
              view.problem = ''
            } else {
              view.answer = null
              view.problem = `Cannot convert ${view.from} to ${view.to}: they do not measure the same kind of thing.`
            }
            surfacesDrawn()
          },
          answer: () => view.answer,
          problem: () => view.problem,
          options: () => [{ id: 'metre-per-second', symbol: 'm/s', name: 'metre per second' }],
          save: async () => true
        })
      )
    }
    surfacesDrawn()
  }

  registerSurface(() =>
    pagesSurface({
      screen: () => view.screen,
      search: () => view.search,
      setSearch: (text) => {
        view.search = text
        surfacesDrawn()
      },
      subject: () => view.subject,
      setSubject: (path) => {
        view.subject = path
        surfacesDrawn()
      },
      subjects: () => [
        { path: 'maths', name: 'Maths', total: 2 },
        { path: 'maths.calculus', name: 'Calculus', total: 1 }
      ],
      pages: () => library.map((one) => ({ ...one, favourite: view.favourites.includes(one.pageId) })),
      unavailable: () => [],
      problems: () => [],
      loading: () => view.loading,
      open: async (address) => {
        const card = library.find((one) => one.url === address || one.slug === address || one.title === address)
        if (!card) throw new Error(`That Page is not in this library: “${address}”.`)
        openPage(card.slug)
        return { title: card.title, url: card.url, slug: card.slug }
      },
      setFavourite: async (address, on) => {
        const card = library.find((one) => one.url === address || one.slug === address || one.title === address)!
        view.favourites = on ? [...view.favourites, card.pageId] : view.favourites.filter((one) => one !== card.pageId)
        surfacesDrawn()
      },
      setScreen: (id) => {
        if (id === 'page') throw new Error('A Page has to be named. Do pages/open with its address, slug or title.')
        if (id === 'studio') openStudio()
        else {
          view.screen = id
          studio?.()
          studio = null
          page?.()
          page = null
          tool?.()
          tool = null
          surfacesDrawn()
        }
      },
      close: () => undefined
    })
  )

  return { ...controlOver(), view }
}

test('pages: the library cannot be narrowed until it has loaded, and says that rather than looking empty', async () => {
  const world = pages()
  const tooSoon = await run(world, 'screen.write', { path: 'pages/subject', value: 'maths' })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /has not finished loading/)

  const state = await run(world, 'screen.state', { path: 'pages' })
  // Not 0 pages: a count nobody has taken is said to be one nobody has taken.
  assert.equal((state.data as { state: { values: { pages: unknown } } }).state.values.pages, 'not loaded yet')

  world.view.loading = false
  const now = await run(world, 'screen.write', { path: 'pages/subject', value: 'maths.calculus' })
  assert.equal(now.ok, true, now.error?.message)
  assert.equal(world.view.subject, 'maths.calculus')
})

test('pages: the walk opens the studio, and the studio’s own section list is what can be set', async () => {
  const world = pages()
  world.view.loading = false

  const there = await run(world, 'screen.goTo', { path: 'pages/studio' })
  assert.equal(there.ok, true, there.error?.message)
  assert.deepEqual((there.data as { opened: string[] }).opened, ['pages/studio'])

  const section = await run(world, 'screen.write', { path: 'pages/studio/section', value: 'Diagnostics' })
  assert.equal(section.ok, true, section.error?.message)
  // Matched by what it is called on screen, and the answer says so.
  assert.match(section.verification?.detail ?? '', /read “Diagnostics” as diagnostics/)
})

test('pages: a Page is opened by its address, and its own parameters are then reachable', async () => {
  const world = pages()
  world.view.loading = false

  const opened = await run(world, 'screen.do', { path: 'pages/open', params: { address: 'unit-converter' } })
  assert.equal(opened.ok, true, opened.error?.message)
  assert.match(opened.verification?.detail ?? '', /Unit Converter is open at orbis:\/\/pages\/unit-converter\./)

  const tree = await run(world, 'screen.tree', {})
  assert.deepEqual(
    (tree.data as { surfaces: SurfaceDescriptor[] }).surfaces.map((one) => one.path),
    ['pages', 'pages/page', 'pages/page/unit-converter']
  )

  const set = await run(world, 'screen.write', { path: 'pages/page/unit-converter/amount', value: '90' })
  assert.equal(set.ok, true, set.error?.message)

  const converted = await run(world, 'screen.do', { path: 'pages/unit-converter/convert' })
  assert.equal(converted.ok, true, converted.error?.message)
  assert.equal(world.view.converted, 1, 'the engine was asked once, not twice')
  assert.match(converted.verification?.detail ?? '', /90 km\/h is 25\.0000 m\/s, exact by definition\./)
})

test('pages: a conversion the engine refuses is reported as refused, in the engine’s own words', async () => {
  const world = pages()
  world.view.loading = false
  await run(world, 'screen.do', { path: 'pages/open', params: { address: 'unit-converter' } })

  await run(world, 'screen.write', { path: 'pages/page/unit-converter/to', value: 'kg' })
  const bad = await run(world, 'screen.do', { path: 'pages/page/unit-converter/convert' })
  // The action was done and the screen said it did not work, so it is `attempted` with the engine's sentence.
  assert.equal((bad.data as SurfaceOutcome).status, 'attempted')
  assert.equal((bad.data as SurfaceOutcome).verified, false)
  assert.match(bad.verification?.detail ?? '', /they do not measure the same kind of thing/)

  const state = await run(world, 'screen.state', { path: 'pages/page/unit-converter' })
  const values = (state.data as { state: { activity: string; values: Record<string, unknown> } }).state
  assert.equal(values.activity, 'failed')
  assert.equal(values.values.answer, 'no answer')
})

test('pages: what a Page may reach is “not answered yet” until it is answered', async () => {
  const world = pages()
  world.view.loading = false
  await run(world, 'screen.do', { path: 'pages/open', params: { address: 'unit-converter' } })

  const early = await run(world, 'screen.read', { path: 'pages/page/permissions' })
  assert.equal(early.ok, true)
  assert.equal((early.data as { readable: boolean; value: unknown }).readable, false)
  assert.equal((early.data as { value: unknown }).value, null, 'never an empty list that reads as “it asks for nothing”')

  world.view.permissionsIn = true
  surfacesDrawn()
  const now = await run(world, 'screen.read', { path: 'pages/page/permissions' })
  assert.equal((now.data as { readable: boolean }).readable, true)
  assert.deepEqual((now.data as { value: unknown[] }).value, [{ capability: 'units.convert', name: 'Convert units', outcome: 'allow', risk: 'low' }])
})

// ---------------------------------------------------------------- Files

const FILES_COMMANDS: FilesCommand[] = [
  { id: 'nav.up', title: 'Up', description: 'Go to the folder above.', permission: 'navigate', asksFirst: false },
  { id: 'nav.refresh', title: 'Refresh', description: 'Read the folder again.', permission: 'navigate', asksFirst: false },
  { id: 'edit.selectAll', title: 'Select all', description: 'Select everything the view shows.', permission: 'navigate', asksFirst: false },
  { id: 'view.details', title: 'Details', description: 'Show the folder as a table.', permission: 'settings', asksFirst: false },
  { id: 'file.createChecksums', title: 'Create checksum file', description: 'Write a checksum file beside the selection.', permission: 'read', asksFirst: false },
  { id: 'file.duplicate', title: 'Duplicate', description: 'Copy the selection beside itself.', permission: 'modify', asksFirst: false },
  { id: 'file.trash', title: 'Move to Trash', description: 'Move the selection to the Trash.', permission: 'destructive', asksFirst: false },
  { id: 'file.rename', title: 'Rename…', description: 'Asks for a new name.', permission: 'modify', asksFirst: true }
]

const SNAPSHOT: FilesViewState = {
  contract: FILES_CONTROL_CONTRACT,
  at: Date.now(),
  folder: 'C:\\Users\\sam\\Pictures',
  place: 'fs',
  placeDetail: 'C:\\Users\\sam\\Pictures',
  parent: 'C:\\Users\\sam',
  view: 'grid',
  sortBy: 'name',
  sortDirection: 'asc',
  foldersFirst: true,
  groupBy: 'none',
  filter: '',
  selection: ['C:\\Users\\sam\\Pictures\\one.png'],
  entries: 12,
  listing: 'ready',
  tabs: 1,
  panes: 1,
  canGoBack: true,
  canGoForward: false,
  operations: 0,
  canTrash: true,
  offers: { views: ['details', 'list', 'grid'], sortKeys: ['name', 'size', 'modified'], groupKeys: ['none', 'type'] }
}

/** The Files screen as the window holds it: a tab strip, and a frame that has or has not said anything yet. */
function files(): ReturnType<typeof controlOver> & {
  view: { tab: string; said: { state: FilesViewState; at: number } | null; commands: FilesCommand[]; asked: { name: string; params: Record<string, unknown> }[] }
} {
  forgetSurfaces()
  const view = {
    tab: 'files',
    said: null as { state: FilesViewState; at: number } | null,
    commands: [] as FilesCommand[],
    asked: [] as { name: string; params: Record<string, unknown> }[]
  }

  registerSurface(() =>
    filesViewSurface({
      tab: () => view.tab,
      setTab: (id) => {
        view.tab = id
        surfacesDrawn()
      },
      made: () => 3,
      close: () => undefined
    })
  )

  registerSurface(() =>
    filesBrowserSurface({
      said: () => view.said,
      commands: () => view.commands,
      // The frame's end, standing in for the hop over postMessage: it records what was asked and answers as Files does.
      ask: async (name, params = {}) => {
        view.asked.push({ name, params })
        const state = view.said!.state
        if (name === 'setView') {
          view.said = { state: { ...state, view: String(params.view) }, at: Date.now() }
          surfacesDrawn()
          return { view: params.view }
        }
        if (name === 'goTo') {
          const path = String(params.path)
          if (!path.startsWith('C:')) throw new Error(`Files did not go to ${path}.`)
          view.said = { state: { ...state, folder: path, placeDetail: path, selection: [], entries: 4 }, at: Date.now() }
          surfacesDrawn()
          return { folder: path }
        }
        if (name === 'select') {
          const paths = (params.paths as string[]) ?? []
          view.said = { state: { ...state, selection: paths }, at: Date.now() }
          surfacesDrawn()
          return { selected: paths.length }
        }
        if (name === 'runCommand') {
          const id = String(params.id)
          const found = FILES_COMMANDS.find((one) => one.id === id)!
          if (id === 'file.trash') {
            view.said = { state: { ...state, selection: [], entries: 11 }, at: Date.now() }
            surfacesDrawn()
            return { id, title: found.title, permission: found.permission, finished: true, stillThere: 0, acted: 1 }
          }
          if (id === 'file.duplicate') {
            // Files asking something on screen: carried out, and nothing could finish it.
            return { id, title: found.title, permission: found.permission, finished: false, waiting: 'Duplicate is waiting for an answer on screen in Files.', acted: 1 }
          }
          return { id, title: found.title, permission: found.permission, finished: true, acted: 0 }
        }
        throw new Error(`Files was asked for “${name}”, which it does not know.`)
      }
    })
  )

  return { ...controlOver(), view }
}

test('files: before the frame has spoken, every reading says so and nothing can be set', async () => {
  const world = files()
  const reading = await run(world, 'screen.read', { path: 'files/browser/folder' })
  assert.equal(reading.ok, true)
  const got = reading.data as { readable: boolean; value: unknown; writable: boolean; note?: string }
  assert.equal(got.readable, false)
  assert.equal(got.value, null, 'never an empty path that reads as a folder')
  assert.equal(got.writable, false)

  const set = await run(world, 'screen.write', { path: 'files/browser/folder', value: 'C:\\Temp' })
  assert.equal(set.ok, false)
  assert.match(set.error?.message ?? '', /has not said what is on screen yet, so nothing on it can be set/)
})

test('files: once the frame has spoken, the folder, the view and the selection are all real', async () => {
  const world = files()
  world.view.said = { state: SNAPSHOT, at: Date.now() }
  world.view.commands = FILES_COMMANDS
  surfacesDrawn()

  const folder = await run(world, 'screen.read', { path: 'files/browser/folder' })
  assert.equal((folder.data as { value: unknown; readable: boolean }).value, 'C:\\Users\\sam\\Pictures')
  assert.equal((folder.data as { readable: boolean }).readable, true)

  // The views offered are Files' own list, sent in the snapshot rather than copied into this window.
  const view = await run(world, 'screen.read', { path: 'files/browser/view' })
  assert.deepEqual((view.data as { values: string[] }).values, ['details', 'list', 'grid'])

  const set = await run(world, 'screen.write', { path: 'files/browser/view', value: 'list' })
  assert.equal(set.ok, true, set.error?.message)
  assert.match(set.verification?.detail ?? '', /View is now “list”/)

  const went = await run(world, 'screen.write', { path: 'files/browser/folder', value: 'C:\\Users\\sam\\Documents' })
  assert.equal(went.ok, true, went.error?.message)
  assert.deepEqual(world.view.asked.at(-1), { name: 'goTo', params: { path: 'C:\\Users\\sam\\Documents' } })

  const selected = await run(world, 'screen.write', { path: 'files/browser/selection', value: ['C:\\Users\\sam\\Documents\\a.txt'] })
  assert.equal(selected.ok, true, selected.error?.message)
  assert.match(selected.verification?.detail ?? '', /Selection is now a list of 1/)
})

test('files: a folder Files will not go to is reported as that, not as done', async () => {
  const world = files()
  world.view.said = { state: SNAPSHOT, at: Date.now() }
  surfacesDrawn()

  const nope = await run(world, 'screen.write', { path: 'files/browser/folder', value: '/not/on/this/computer' })
  assert.equal(nope.ok, false)
  assert.equal(nope.error?.code, 'failed')
  assert.match(nope.error?.message ?? '', /Files did not go to \/not\/on\/this\/computer/)
})

test('files: what Files can be asked to do is read from Files, and grouped by what Files says it does', async () => {
  const world = files()
  world.view.said = { state: SNAPSHOT, at: Date.now() }
  world.view.commands = FILES_COMMANDS
  surfacesDrawn()

  const tree = await run(world, 'screen.tree', { path: 'files/browser' })
  const browser = (tree.data as { surfaces: SurfaceDescriptor[] }).surfaces[0]
  assert.deepEqual(
    browser.actions.map((one) => one.id),
    ['go', 'look', 'inspect', 'change', 'delete']
  )
  // The commands at each level are Files' own, and the one that asks for a name is left out with that said.
  const go = browser.actions.find((one) => one.id === 'go')!
  assert.deepEqual(go.params?.command.enum, ['nav.up', 'nav.refresh', 'edit.selectAll'])
  const change = browser.actions.find((one) => one.id === 'change')!
  assert.deepEqual(change.params?.command.enum, ['file.duplicate'])
  assert.match(change.about ?? '', /1 more ask for something on screen/)

  // And the bar is raised exactly where Files says it should be.
  assert.deepEqual(browser.actions.find((one) => one.id === 'delete')?.effects, ['delete'])
  assert.equal(browser.actions.find((one) => one.id === 'delete')?.confirmation, 'always')
  assert.deepEqual(browser.actions.find((one) => one.id === 'inspect')?.effects, ['read'])

  const went = await run(world, 'screen.do', { path: 'files/browser/go', params: { command: 'nav.up' } })
  assert.equal(went.ok, true, went.error?.message)
  assert.match(went.verification?.detail ?? '', /Files did Up\./)
})

test('files: a deletion asks first and is confirmed by what the folder still lists', async () => {
  const world = files()
  world.view.said = { state: SNAPSHOT, at: Date.now() }
  world.view.commands = FILES_COMMANDS
  surfacesDrawn()

  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'files/browser/delete', params: { command: 'file.trash' } }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.equal(world.view.asked.length, 0, 'Files was never asked')

  world.approve = true
  const done = await run(world, 'screen.do', { path: 'files/browser/delete', params: { command: 'file.trash' } }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.match(done.verification?.detail ?? '', /Move to Trash: 1 item is no longer listed\./)
})

test('files: a command still waiting for a person is not reported as done', async () => {
  const world = files()
  world.view.said = { state: SNAPSHOT, at: Date.now() }
  world.view.commands = FILES_COMMANDS
  surfacesDrawn()

  const waiting = await run(world, 'screen.do', { path: 'files/browser/change', params: { command: 'file.duplicate' } })
  // An action that was carried out and could not be confirmed: ok, and verified false, with why.
  assert.equal(waiting.ok, true, waiting.error?.message)
  /*
   * `status` is the thing to read, not `ok`.
   *
   * An action that was carried out and could not be confirmed comes back ok -- deliberately, because a retry is what
   * a caller does with a failure and an action done twice is a file duplicated twice. What says it was not confirmed
   * is the status and the sentence beside it.
   */
  assert.equal((waiting.data as SurfaceOutcome).status, 'attempted')
  assert.equal((waiting.data as SurfaceOutcome).verified, false)
  assert.match(waiting.verification?.detail ?? '', /waiting for an answer on screen in Files/)
})

test('files: the walk into Files shows the half first, and then the frame says what is on it', async () => {
  const world = files()
  world.view.tab = 'created'
  surfacesDrawn()

  const there = await run(world, 'screen.goTo', { path: 'files/browser' })
  // Already registered here, because this test stands the frame up at once; what matters is that it was found.
  assert.equal(there.ok, true, there.error?.message)
  assert.equal((there.data as { alreadyThere: boolean }).alreadyThere, true)

  const half = await run(world, 'screen.write', { path: 'files/half', value: 'files' })
  assert.equal(half.ok, true, half.error?.message)
  assert.equal(world.view.tab, 'files')
})

test('all three modules can be on screen at once, and each says what is going on', async () => {
  forgetSurfaces()
  const world = markets()
  world.view.enabled = true
  const snapshot = (await world.control.snapshot(['screens'])) as { screens: { registered: number; screens: { path: string; controls: number; canOpen: string[] }[] } }
  assert.deepEqual(
    snapshot.screens.screens.map((one) => one.path),
    ['markets', 'markets/watchlists', 'markets/market']
  )
  assert.deepEqual(snapshot.screens.screens[0].canOpen, ['screener', 'watchlists', 'market'])
})
