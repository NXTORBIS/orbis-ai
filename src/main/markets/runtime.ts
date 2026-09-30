import { MarketEngine, type EngineEvent } from './engine.ts'
import { MarketsStore } from './store.ts'
import {
  consider,
  considerTerm,
  describeAlert,
  measure,
  type Alert,
  type AlertContext,
  type AlertTerm
} from '../../shared/markets/alerts.ts'
import { considerTrigger, describeTrigger, type MarketTrigger } from '../../shared/markets/triggers.ts'
import { measureSubject } from '../../shared/markets/alerts.ts'
import { summariseLiquidations } from '../../shared/markets/derivatives.ts'
import { touchOf } from '../../shared/markets/orderbook.ts'
import { onQuote, valueOf, type PaperFill } from '../../shared/markets/paper.ts'
import { allWatched, TICKER_HEIGHTS, type MarketsWorkspace } from '../../shared/markets/workspace.ts'
import { stripSlots, type StripOrigin } from '../../shared/markets/strip.ts'
import type { Instrument, QuoteView } from '../../shared/markets/instrument.ts'

/**
 * Markets, joined up.
 *
 * The engine has the data, the store has the choices, and this is what makes them one thing: it keeps the engine
 * subscribed to exactly what the profile is watching, judges the alerts as prices arrive, and answers the strip and the
 * window.
 *
 * It is also where the one piece of real-time plumbing lives that neither of the other two should own: a way for a page to
 * wait for the next change rather than ask over and over. A ticker that polled four times a second would be four requests
 * a second through the helper for a market that moved once a minute; a ticker that waits costs one held request and
 * arrives as fast as the price does.
 */

export interface MarketsRuntimeOptions {
  engine: MarketEngine
  store: MarketsStore
  profileId(): Promise<string>
  /** Told when an alert fires, so it can become a notification. Never given anything but the alert and the value. */
  onAlert?(event: { alert: Alert; value: number; instrument: Instrument | null }): void
  /**
   * A workflow trigger has just become true.
   *
   * The runtime decides *that* it happened and says so; starting the workflow is the workflow engine's job. Keeping the
   * two apart is what stops market logic leaking into the engine and workflow logic leaking into here.
   */
  onTrigger?(event: { trigger: MarketTrigger; instrumentId: string; describe: string; value: number | null }): void
  /** Told when the ticker's configuration changes, so the browser can show or hide the strip. */
  onTickerChanged?(config: { enabled: boolean; height: number }): void
  /** Told when a simulated order fills, so it can be shown. Always a simulation, and said so wherever it surfaces. */
  onPaperFill?(event: { fill: PaperFill; instrument: Instrument | null }): void
  now?(): number
}

/** What a page waiting for changes is given. */
export interface QuoteBatch {
  quotes: QuoteView[]
  /** Instruments whose alert fired since the last batch, so the strip can mark them. */
  alerts: { instrumentId: string; label: string }[]
  connection: string
}

/** How long a waiting request is held before answering with nothing. Long enough to be worth it, short enough to notice a drop. */
const HOLD_MS = 25_000

export class MarketsRuntime {
  private readonly o: MarketsRuntimeOptions
  private readonly now: () => number
  private releaseWatch: (() => void) | null = null
  /** One simulation at a time, so two quotes cannot each write back an account missing the other's fill. */
  private simulating: Promise<void> = Promise.resolve()
  private stopEngine: (() => void) | null = null
  private stopStore: (() => void) | null = null

  /** Quotes that have changed since each waiting page last heard, keyed by the set it asked about. */
  private pending = new Map<string, QuoteView>()
  private firedSince: { instrumentId: string; label: string }[] = []
  private waiting: ((batch: QuoteBatch) => void)[] = []
  private waitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: MarketsRuntimeOptions) {
    this.o = options
    this.now = options.now ?? Date.now
  }

  /** Starts following the profile's choices. */
  async start(): Promise<void> {
    this.stopEngine = this.o.engine.on((event) => this.onEngineEvent(event))
    this.stopStore = this.o.store.onChange((_profileId, workspace) => void this.follow(workspace))
    await this.follow(await this.o.store.read(await this.o.profileId()))
  }

  /**
   * Subscribes to exactly what this profile is watching.
   *
   * Re-derived from the workspace rather than adjusted, and released as one, so a watchlist emptied in Settings really
   * does stop the subscriptions it was holding.
   */
  private async follow(workspace: MarketsWorkspace): Promise<void> {
    // The instruments are remembered in the workspace, so the engine can describe them before any provider answers.
    for (const instrument of workspace.known) this.o.engine.remember(instrument)

    // One function decides what is watched, and it is the same one the store and the settings screen reason about. It
    // returns nothing at all when Markets is switched off, which is what makes the master switch release sockets rather
    // than only change a label.
    const watched = allWatched(workspace)

    this.releaseWatch?.()
    this.releaseWatch = watched.length ? this.o.engine.watchAll(watched, 'ticker') : null
    if (!workspace.enabled) {
      // Nothing held, nothing pending: a price that arrived a moment before the switch should not be delivered after it.
      this.pending.clear()
      this.firedSince = []
    }

    this.o.onTickerChanged?.({
      // The strip follows both switches. A ticker left on inside a Markets that is off would be a band across the bottom
      // of the browser with nothing behind it.
      enabled: workspace.enabled && workspace.ticker.enabled,
      height: TICKER_HEIGHTS[workspace.ticker.size]
    })
  }

  // ---------------------------------------------------------------- prices in

  private onEngineEvent(event: EngineEvent): void {
    if (event.type === 'quote' && event.quote && event.instrumentId) {
      this.pending.set(event.instrumentId, event.quote)
      void this.judge(event.instrumentId, event.quote)
      // The simulation runs on arriving prices, like the alerts do. A limit order that only filled when somebody happened
      // to open the portfolio screen would be a simulation of the screen rather than of the market.
      void this.simulate(event.quote)
      this.deliver()
      return
    }
    if (event.type === 'provider-status') {
      // A change of connection is worth telling a waiting page about at once: it is the difference between a green dot
      // and an honest one.
      this.deliver()
    }
  }

  /**
   * Judges the alerts for one instrument.
   *
   * On the quote rather than on a timer, so an alert fires when the price does. Indicator alerts are the exception -- they
   * need candles, which are fetched, so those are judged on the candles the engine already holds rather than fetching per
   * tick.
   */
  /**
   * What the derivatives and book conditions need, for one market.
   *
   * Read from what the engine already holds rather than fetched: a condition judged on every tick must not cost a
   * request. Everything absent measures as null, and null never fires — so a funding condition on a spot pair is silent
   * rather than wrong.
   */
  private contextFor(instrumentId: string, quote: QuoteView): AlertContext {
    const book = this.o.engine.bookView(instrumentId, 1)
    const touch = book ? touchOf(book) : null
    const funding = this.o.engine.fundingFor(instrumentId)
    const openInterest = this.o.engine.openInterestFor(instrumentId)
    const liquidations = this.o.engine.liquidationsFor(instrumentId)
    return {
      // From the book when one is open, from the quote's own two sides otherwise. Null when neither has both.
      spreadFraction:
        touch?.spreadFraction ??
        (typeof quote.bid === 'number' && typeof quote.ask === 'number' && quote.ask >= quote.bid && quote.ask + quote.bid > 0
          ? (quote.ask - quote.bid) / ((quote.ask + quote.bid) / 2)
          : null),
      fundingRate: funding?.rate ?? null,
      openInterest: openInterest?.amount ?? null,
      // Needs history, which is a request. Null here rather than fetched per tick; the panel asks for it directly.
      openInterestChange: () => null,
      liquidations: (windowMs, side) => {
        const summary = summariseLiquidations(liquidations, windowMs, this.now())
        if (summary.count === 0 && liquidations.length === 0) return null
        return side === 'long' ? summary.longNotional : side === 'short' ? summary.shortNotional : summary.totalNotional
      },
      available: quote.freshness !== 'unavailable' && quote.freshness !== 'stale'
    }
  }

  private async judge(instrumentId: string, quote: QuoteView): Promise<void> {
    const profileId = await this.o.profileId()
    const alerts = (await this.o.store.alerts(profileId)).filter((a) => a.instrumentId === instrumentId && a.enabled)
    // Triggers are judged on the same tick, from the same values, so a workflow and an alert about one event cannot
    // disagree about whether it happened.
    void this.judgeTriggers(profileId, instrumentId, quote)
    if (alerts.length === 0) return

    const context = this.contextFor(instrumentId, quote)
    const changed: Alert[] = []
    for (const alert of alerts) {
      const candles =
        alert.subject.kind === 'indicator'
          ? await this.o.engine.candlesFor(instrumentId, alert.subject.interval as never, 300)
          : []
      const { value } = measure(alert, quote, candles, context)
      // Every extra condition, judged with the same rules and its memory advanced.
      const terms: AlertTerm[] = []
      const others: boolean[] = []
      for (const term of alert.extra ?? []) {
        const judged = considerTerm(term, quote, candles, context)
        terms.push(judged.next)
        others.push(judged.holds)
      }
      const outcome = consider(
        terms.length > 0 ? { ...alert, extra: terms } : alert,
        value,
        this.now(),
        others
      )
      changed.push(outcome.next)
      if (!outcome.fired || outcome.value === null) continue
      const instrument = await this.o.engine.instrument(instrumentId)
      const label = alert.label || describeAlert(alert, instrument?.symbol ?? instrumentId)
      this.firedSince.push({ instrumentId, label })
      // Written down, so what fired overnight is still there in the morning. The observed value and the condition, not a
      // snapshot of the market: the value is what the alert was about, and the market has moved on since.
      await this.o.store.recordFiring(profileId, {
        alertId: alert.id,
        instrumentId,
        symbol: instrument?.symbol ?? '',
        label,
        value: outcome.value,
        at: this.now()
      })
      this.o.onAlert?.({ alert: outcome.next, value: outcome.value, instrument })
    }
    // Written back whether or not anything fired: the memory of what each alert last saw has to advance either way, or a
    // crossing is never detected again.
    await this.o.store.rememberAlertState(profileId, changed)
  }

  /**
   * Whether any workflow trigger has just become true.
   *
   * On the same tick as the alerts, from the same quote. A trigger fires on the edge, so the memory is written back
   * whether or not it fired — without it, a condition that stays true would start a workflow every time a price arrived.
   */
  private async judgeTriggers(profileId: string, instrumentId: string, quote: QuoteView): Promise<void> {
    const all = await this.o.store.triggers(profileId)
    const mine = all.filter(
      (one) => one.enabled && (one.kind === 'market' ? one.instrumentId === instrumentId : one.kind === 'connection')
    )
    if (mine.length === 0) return

    const context = this.contextFor(instrumentId, quote)
    const connection = this.connection()
    const changed: MarketTrigger[] = []
    for (const trigger of mine) {
      const value =
        trigger.kind === 'market'
          ? measureSubject(trigger.subject ?? { kind: 'price' }, quote, [], context).value
          : undefined
      const outcome = considerTrigger(trigger, { value, connection }, this.now())
      changed.push(outcome.next)
      if (!outcome.fired) continue
      const instrument = await this.o.engine.instrument(instrumentId)
      this.o.onTrigger?.({
        trigger: outcome.next,
        instrumentId,
        describe: describeTrigger(outcome.next, instrument?.symbol ?? ''),
        value: value ?? null
      })
    }
    await this.o.store.rememberTriggerState(profileId, changed)
  }

  // ---------------------------------------------------------------- the simulated account

  /**
   * Moves the paper account against one price.
   *
   * Two things happen here, and they are deliberately in this order: waiting orders are filled, and then what the account
   * is worth is written down. Recording first would record a value from before a fill that has just happened.
   *
   * Serialised through one promise, because two quotes arriving together must not both read the same account, each apply
   * their own fill, and each write back a version missing the other's.
   */
  private simulate(quote: QuoteView): Promise<void> {
    this.simulating = this.simulating.then(() => this.simulateOne(quote)).catch(() => undefined)
    return this.simulating
  }

  private async simulateOne(quote: QuoteView): Promise<void> {
    const profileId = await this.o.profileId()
    const held = await this.o.store.paper(profileId)
    if (!held) return

    const waiting = held.account.orders.some((o) => o.state === 'pending' && o.instrumentId === quote.instrumentId)
    let account = held.account
    if (waiting) {
      const outcome = onQuote(account, quote, this.now(), held.settings)
      if (outcome.fills.length > 0) {
        account = outcome.account
        await this.o.store.setPaperAccount(profileId, account)
        for (const fill of outcome.fills) {
          this.o.onPaperFill?.({ fill, instrument: await this.o.engine.instrument(fill.instrumentId) })
        }
      }
    }

    // Only for instruments the account actually holds, so an unrelated price does not cost a read of every position.
    if (account.positions.length === 0 && account.cash === held.account.cash && !waiting) return
    const prices = new Map<string, number | null>()
    for (const position of account.positions) {
      prices.set(position.instrumentId, this.o.engine.quote(position.instrumentId)?.last ?? null)
    }
    const value = valueOf(account, prices)
    await this.o.store.recordEquity(profileId, {
      at: this.now(),
      total: value.total,
      cash: value.cash,
      realised: value.realised
    })
  }

  // ---------------------------------------------------------------- pages waiting

  /**
   * Waits for the next change, for up to `HOLD_MS`.
   *
   * Answers at once when something is already pending, so a page that has fallen behind catches up immediately rather
   * than waiting for the next tick. Answers empty after the hold, which is how a page notices the connection is gone
   * rather than believing a silent market.
   */
  nextBatch(): Promise<QuoteBatch> {
    return new Promise((resolve) => {
      this.waiting.push(resolve)
      if (this.pending.size > 0 || this.firedSince.length > 0) {
        this.deliver()
        return
      }
      if (!this.waitTimer) {
        this.waitTimer = setTimeout(() => {
          this.waitTimer = null
          this.deliver(true)
        }, HOLD_MS)
        this.waitTimer.unref?.()
      }
    })
  }

  private deliver(evenIfEmpty = false): void {
    if (this.waiting.length === 0) return
    if (!evenIfEmpty && this.pending.size === 0 && this.firedSince.length === 0) return
    const batch: QuoteBatch = {
      quotes: [...this.pending.values()],
      alerts: [...this.firedSince],
      connection: this.connection()
    }
    this.pending.clear()
    this.firedSince = []
    const waiting = this.waiting
    this.waiting = []
    if (this.waitTimer) {
      clearTimeout(this.waitTimer)
      this.waitTimer = null
    }
    for (const resolve of waiting) resolve(batch)
  }

  /**
   * One word for how the market data is doing.
   *
   * The worst of the providers rather than the best: a screen showing "Live" because one of three feeds is up would be
   * describing the feed somebody is not looking at.
   */
  connection(): string {
    const statuses = this.o.engine.statuses().filter((s) => s.configured)
    if (statuses.length === 0) return 'not-configured'
    if (statuses.some((s) => s.connection === 'connected')) {
      // Delayed beats live: if anything being shown is behind, the strip must not claim otherwise.
      const anyDelayed = this.o.engine.list().some((p) => p.ready().ok && p.capabilities.delayedByMs > 0)
      return anyDelayed ? 'delayed' : 'connected'
    }
    if (statuses.some((s) => s.connection === 'reconnecting')) return 'reconnecting'
    // Nothing subscribed is not a failure. A provider that is configured, has never been asked for anything and has
    // nothing streaming is idle, and saying "Disconnected" above a screen that simply has not asked for a price yet
    // reports an outage that is not happening.
    if (statuses.every((s) => s.subscriptions === 0 && s.connection !== 'disconnected')) return 'idle'
    if (statuses.every((s) => s.subscriptions === 0)) return 'idle'
    return 'disconnected'
  }

  // ---------------------------------------------------------------- what the strip asks for

  /** Everything the strip needs to draw itself: its settings, its instruments, and the last price of each. */
  /**
   * Switches the strip off, for the close control on the strip itself.
   *
   * One setting, and two strips read it, so this hides both. That is the intent: the band along the bottom of the
   * browser and the band along the bottom of the Orbis window are the same strip in two places, not two features, and
   * somebody who closes one has said they do not want it.
   *
   * One-way on purpose. Switching it back on is the Orbis window's to do, so a page can never put a band on somebody's
   * browser -- only take one away.
   */
  async hideStrip(): Promise<void> {
    const profileId = await this.o.profileId()
    const ticker = await this.o.store.ticker(profileId)
    if (!ticker.enabled) return
    await this.o.store.setTicker(profileId, { ...ticker, enabled: false })
  }

  async tickerState(): Promise<{
    config: {
      groupName: string
      speed: number
      direction: string
      pauseOnHover: boolean
      fields: string[]
      height: number
      enabled: boolean
      slots: number
      auto: boolean
      stillWhenReducedMotion: boolean
    }
    items: { instrument: Instrument; quote: QuoteView | null; origin: StripOrigin }[]
    connection: string
  }> {
    const profileId = await this.o.profileId()
    const workspace = await this.o.store.read(profileId)
    const ticker = workspace.ticker
    const group = ticker.groups.find((g) => g.id === ticker.activeGroupId) ?? ticker.groups[0]

    /**
     * What goes on the rail, decided by the shared rule rather than here.
     *
     * The same three lists are handed to the same function that the strip inside the Orbis window uses, so the two
     * strips cannot drift into showing different coins -- which is the one thing a second copy of a feature reliably
     * does. Nothing is invented: every id below came from this person's own group, their own recents, or their own
     * watchlists and alerts.
     */
    const slots = workspace.enabled
      ? stripSlots({
          chosen: allWatched({ ...workspace, watchlists: [], alerts: [] }),
          viewed: workspace.recent,
          watched: allWatched({ ...workspace, ticker: { ...ticker, groups: [] } }),
          slots: ticker.slots,
          auto: ticker.auto
        })
      : []

    const items: { instrument: Instrument; quote: QuoteView | null; origin: StripOrigin }[] = []
    for (const slot of slots) {
      const instrument = await this.o.engine.instrument(slot.instrumentId)
      // An instrument nobody can describe is not drawn: a row with a blank name and no price says nothing and looks broken.
      if (!instrument) continue
      items.push({ instrument, quote: this.o.engine.quote(slot.instrumentId), origin: slot.origin })
    }
    return {
      config: {
        groupName: group?.name ?? '',
        speed: ticker.speed,
        direction: ticker.direction,
        pauseOnHover: ticker.pauseOnHover,
        fields: ticker.fields,
        height: TICKER_HEIGHTS[ticker.size],
        enabled: workspace.enabled && ticker.enabled,
        slots: ticker.slots,
        auto: ticker.auto,
        stillWhenReducedMotion: ticker.stillWhenReducedMotion
      },
      items,
      connection: this.connection()
    }
  }

  /** Asks for fresh prices now, for anything with none. Used when the strip first opens. */
  async prime(): Promise<void> {
    const profileId = await this.o.profileId()
    const workspace = await this.o.store.read(profileId)
    if (!workspace.enabled) return
    const watching = await this.o.store.watching(profileId)
    const missing = watching.filter((id) => this.o.engine.quote(id) === null)
    if (missing.length) await this.o.engine.refresh(missing)
  }

  async profileChanged(): Promise<void> {
    this.releaseWatch?.()
    this.releaseWatch = null
    this.o.engine.reset()
    await this.o.store.profileChanged()
    this.pending.clear()
    this.firedSince = []
    await this.follow(await this.o.store.read(await this.o.profileId()))
  }

  stop(): void {
    this.releaseWatch?.()
    this.releaseWatch = null
    this.stopEngine?.()
    this.stopStore?.()
    if (this.waitTimer) clearTimeout(this.waitTimer)
    this.waitTimer = null
    // Anything still waiting is answered rather than left hanging when Orbis is closing.
    this.deliver(true)
    this.o.engine.stop()
    this.o.store.stop()
  }
}
