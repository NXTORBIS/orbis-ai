import { promises as fs, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { readStored } from '../storedFile.ts'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDirFor } from '../../shared/profiles.ts'
import {
  allWatched,
  cleanInstrument,
  cleanTicker,
  cleanWatchlist,
  cleanScreen,
  cleanWorkspace,
  DEFAULT_COLUMNS,
  EMPTY_WORKSPACE,
  cleanLayout,
  cleanRun,
  type BacktestRun,
  type MarketsLayout,
  type MarketsWorkspace,
  type PaperState,
  type TickerConfig,
  type TickerGroup,
  type Watchlist
} from '../../shared/markets/workspace.ts'
import { cleanAlert, type Alert, type AlertFiring } from '../../shared/markets/alerts.ts'
import type { MuteRule, PatternAlertRule, PatternFiring } from '../../shared/markets/patternAlerts.ts'
import { prune, type PatternRecord } from '../../shared/markets/patternHistory.ts'
import {
  DEFAULT_PATTERN_SETTINGS,
  PATTERN_LIMITS,
  cleanPatternMutes,
  cleanPatternRule,
  cleanPatternSettings,
  type PatternSettings,
  type PatternState
} from '../../shared/markets/patternSettings.ts'
import { cleanQuery, type SavedScreen, type ScreenerQuery } from '../../shared/markets/screener.ts'
import { newAccount, type PaperAccount, type PaperSettings } from '../../shared/markets/paper.ts'
import { shouldRecord, type EquityPoint } from '../../shared/markets/portfolio.ts'
import { cleanStrategy, type Strategy } from '../../shared/markets/strategy.ts'
import {
  cleanCurrencyPreference,
  isSupported,
  resolvePreference,
  type CurrencyPreference,
  type DetectionSignals
} from '../../shared/markets/currency.ts'
import type { Instrument } from '../../shared/markets/instrument.ts'
import {
  cleanExperience,
  cleanSettings,
  type ExperienceSettings,
  type MarketsExperienceProfile
} from '../../shared/markets/experience.ts'
import {
  cleanDraft,
  EMPTY_ONBOARDING,
  ONBOARDING_VERSION,
  type AppliedSetup,
  type OnboardingRecord
} from '../../shared/markets/onboarding.ts'
import { cleanDrawing, type Drawing } from '../../shared/markets/drawings.ts'
import { cleanLayout as cleanPanelLayout, defaultLayout, type Layout as PanelLayout } from '../../shared/markets/panels.ts'
import { cleanTrigger, type MarketTrigger } from '../../shared/markets/triggers.ts'
import { cleanMargin, type MarginSettings } from '../../shared/markets/margin.ts'

/**
 * Watchlists, ticker groups and alerts, kept on this computer, per profile.
 *
 * Choices rather than data: none of this comes from a provider and none of it needs one. A watchlist keeps working with
 * the network off and simply shows no prices, which is the point of keeping the two apart.
 *
 * Per profile, in the profile's own folder, like every other per-profile thing in Orbis. One profile's watchlists are
 * never another's, and switching profile swaps the whole file rather than merging anything.
 *
 * Writes are batched and atomic: a watchlist edited a dozen times in a second is one write, and a write that is
 * interrupted leaves the old file rather than half of the new one.
 */

const FILE = 'markets.json'
const FLUSH_MS = 400

/** How many firings a profile keeps. Enough to see what happened overnight, few enough that the file stays small. */
const HISTORY_KEPT = 200
/** Equity readings kept per profile. About a month at one an hour. */
const EQUITY_KEPT = 2000
/** Recorded runs kept per profile, so a comparison has something to compare without rerunning both. */
const RUNS_KEPT = 50
/** The simulation's defaults, named here so starting an account does not have to restate them. */
const DEFAULT_PAPER: PaperSettings = { slippage: 0.0005, feeRate: 0.001, allowShort: false }

export class MarketsStore {
  private readonly userData: string
  private readonly cache = new Map<string, MarketsWorkspace>()
  private readonly reading = new Map<string, Promise<MarketsWorkspace>>()
  private readonly dirty = new Set<string>()
  private readonly listeners = new Set<(profileId: string, workspace: MarketsWorkspace) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number

  constructor(userData: string, now: () => number = Date.now) {
    this.userData = userData
    this.now = now
  }

  private path(profileId: string): string {
    return join(this.userData, dataDirFor(profileId), FILE)
  }

  /** Told whenever anything changes, so the strip and the window can follow without asking. */
  onChange(listener: (profileId: string, workspace: MarketsWorkspace) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async read(profileId: string): Promise<MarketsWorkspace> {
    const held = this.cache.get(profileId)
    if (held) return held
    const already = this.reading.get(profileId)
    if (already) return already
    const job = (async () => {
      let workspace: MarketsWorkspace
      try {
        const stored = await readStored(this.path(profileId))
        if (stored.kind === 'unreadable') this.unreadable.add(profileId)
        else this.unreadable.delete(profileId)
        if (stored.kind !== 'read') throw new Error('nothing to read')
        workspace = cleanWorkspace(JSON.parse(stored.text), this.now())
      } catch {
        // No file yet, or one that cannot be read. An empty workspace is the right answer to both -- and never an error,
        // because somebody who has never opened Markets should not meet one.
        workspace = { ...EMPTY_WORKSPACE, updatedAt: this.now() }
      }
      this.cache.set(profileId, workspace)
      this.reading.delete(profileId)
      return workspace
    })()
    this.reading.set(profileId, job)
    return job
  }

  /**
   * Changes the workspace and remembers to write it.
   *
   * Every mutation goes through here, so there is one place that stamps the time, marks it dirty and tells the listeners.
   * A mutation that edited the cached object directly would be a change nothing wrote down.
   */
  private async change(
    profileId: string,
    edit: (workspace: MarketsWorkspace) => MarketsWorkspace
  ): Promise<MarketsWorkspace> {
    const current = await this.read(profileId)
    const next = { ...edit(current), updatedAt: this.now() }
    this.cache.set(profileId, next)
    this.dirty.add(profileId)
    this.arm()
    for (const listener of this.listeners) {
      try {
        listener(profileId, next)
      } catch {
        // A listener that throws must not stop the next one, or the write.
      }
    }
    return next
  }

  private arm(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, FLUSH_MS)
    this.timer.unref?.()
  }

  /** Profiles whose workspace file is there and could not be read. Nothing is written over those. */
  private readonly unreadable = new Set<string>()

  async flush(): Promise<void> {
    const pending = [...this.dirty]
    this.dirty.clear()
    for (const profileId of pending) {
      const workspace = this.cache.get(profileId)
      if (!workspace) continue
      if (this.unreadable.has(profileId)) {
        // A workspace file is there that Orbis could not read: watchlists, layouts and drawings live in it, so an
        // empty one is never written over it. Looked at again next time.
        this.unreadable.delete(profileId)
        continue
      }
      const path = this.path(profileId)
      try {
        await fs.mkdir(dirname(path), { recursive: true })
        // Beside and renamed over, so an interrupted write leaves the old file rather than half of the new one.
        await fs.writeFile(`${path}.tmp`, JSON.stringify(workspace), { mode: 0o600 })
        await fs.rename(`${path}.tmp`, path)
      } catch {
        this.dirty.add(profileId)
      }
    }
  }

  // ---------------------------------------------------------------- watchlists

  async watchlists(profileId: string): Promise<Watchlist[]> {
    return (await this.read(profileId)).watchlists
  }

  async createWatchlist(profileId: string, name: string): Promise<Watchlist> {
    const list: Watchlist = {
      id: randomUUID(),
      name: name.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Watchlist',
      items: [],
      sortBy: 'symbol',
      sortDescending: false,
      columns: [...DEFAULT_COLUMNS]
    }
    await this.change(profileId, (w) => ({ ...w, watchlists: [...w.watchlists, list] }))
    return list
  }

  async renameWatchlist(profileId: string, id: string, name: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      watchlists: w.watchlists.map((l) =>
        l.id === id ? { ...l, name: name.replace(/\s+/g, ' ').trim().slice(0, 60) || l.name } : l
      )
    }))
  }

  async removeWatchlist(profileId: string, id: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, watchlists: w.watchlists.filter((l) => l.id !== id) }))
  }

  /** Adds an instrument, and remembers it so the list can be drawn before any provider answers. */
  async addToWatchlist(profileId: string, id: string, instrument: Instrument): Promise<void> {
    const clean = cleanInstrument(instrument)
    if (!clean) return
    await this.change(profileId, (w) => ({
      ...w,
      known: w.known.some((k) => k.instrumentId === clean.instrumentId) ? w.known : [...w.known, clean],
      watchlists: w.watchlists.map((l) =>
        l.id !== id || l.items.some((i) => i.instrumentId === clean.instrumentId)
          ? l
          : { ...l, items: [...l.items, { instrumentId: clean.instrumentId, instrument: clean, addedAt: this.now() }] }
      )
    }))
  }

  async removeFromWatchlist(profileId: string, id: string, instrumentId: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      watchlists: w.watchlists.map((l) =>
        l.id === id ? { ...l, items: l.items.filter((i) => i.instrumentId !== instrumentId) } : l
      )
    }))
  }

  /** Replaces a whole list, for reordering and for an import. Cleaned on the way in like anything from outside. */
  async setWatchlist(profileId: string, raw: unknown): Promise<void> {
    const list = cleanWatchlist(raw, this.now())
    if (!list) return
    await this.change(profileId, (w) => ({
      ...w,
      watchlists: w.watchlists.some((l) => l.id === list.id)
        ? w.watchlists.map((l) => (l.id === list.id ? list : l))
        : [...w.watchlists, list]
    }))
  }

  // ---------------------------------------------------------------- the master switch

  /** Whether Markets is on for this profile. */
  async enabled(profileId: string): Promise<boolean> {
    return (await this.read(profileId)).enabled
  }

  /**
   * Turns Markets on or off.
   *
   * Everything else in the file is left alone. Switching Markets off and on again should find the same watchlists, the
   * same alerts and the same ticker groups, because a switch that quietly discarded them would be a reset wearing a
   * switch's label.
   */
  async setEnabled(profileId: string, enabled: boolean): Promise<boolean> {
    const next = await this.change(profileId, (w) => ({ ...w, enabled }))
    return next.enabled
  }

  // ---------------------------------------------------------------- the ticker

  async ticker(profileId: string): Promise<TickerConfig> {
    return (await this.read(profileId)).ticker
  }

  /**
   * Changes the strip's settings, treating what it is given as a change rather than as a replacement.
   *
   * The merge is the whole point, and it is here rather than in every caller because leaving it to callers lost data.
   * `cleanTicker` rebuilds `groups` and `fields` from its input and does not take them from the fallback -- so a caller
   * sending `{ slots: 48 }`, meaning "make the strip longer", got back a configuration with no groups at all, and the
   * markets somebody had chosen were gone. The strip's own settings panel sends exactly that shape, and it happened.
   *
   * Merging first means a partial change can only ever change what it names. A caller that really does want to empty
   * the groups still can, by sending `groups: []`, which says so.
   */
  async setTicker(profileId: string, raw: unknown): Promise<TickerConfig> {
    const next = await this.change(profileId, (w) => {
      const patch = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      return { ...w, ticker: cleanTicker({ ...w.ticker, ...patch }, w.ticker) }
    })
    return next.ticker
  }

  async setTickerGroup(profileId: string, group: TickerGroup): Promise<void> {
    await this.change(profileId, (w) => {
      const groups = w.ticker.groups.some((g) => g.id === group.id)
        ? w.ticker.groups.map((g) => (g.id === group.id ? group : g))
        : [...w.ticker.groups, group]
      return { ...w, ticker: cleanTicker({ ...w.ticker, groups }, w.ticker) }
    })
  }

  async removeTickerGroup(profileId: string, groupId: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      ticker: cleanTicker({ ...w.ticker, groups: w.ticker.groups.filter((g) => g.id !== groupId) }, w.ticker)
    }))
  }

  // ---------------------------------------------------------------- alerts

  async alerts(profileId: string): Promise<Alert[]> {
    return (await this.read(profileId)).alerts
  }

  async saveAlert(profileId: string, raw: unknown): Promise<Alert | null> {
    const alert = cleanAlert(raw, this.now())
    if (!alert) return null
    await this.change(profileId, (w) => ({
      ...w,
      alerts: w.alerts.some((a) => a.id === alert.id)
        ? w.alerts.map((a) => (a.id === alert.id ? alert : a))
        : [...w.alerts, alert]
    }))
    return alert
  }

  async removeAlert(profileId: string, id: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, alerts: w.alerts.filter((a) => a.id !== id) }))
  }

  /**
   * Writes back what an alert has seen, after it was considered.
   *
   * Separate from `saveAlert` because it is a different kind of change: it happens constantly, in the background, and must
   * not be mistaken for somebody editing an alert. Nothing about the condition is touched -- only the memory.
   */
  async rememberAlertState(profileId: string, alerts: Alert[]): Promise<void> {
    if (alerts.length === 0) return
    const byId = new Map(alerts.map((a) => [a.id, a]))
    await this.change(profileId, (w) => ({
      ...w,
      alerts: w.alerts.map((existing) => {
        const seen = byId.get(existing.id)
        if (!seen) return existing
        return {
          ...existing,
          lastValue: seen.lastValue,
          lastFiredAt: seen.lastFiredAt,
          firedToday: seen.firedToday,
          firedDay: seen.firedDay
        }
      })
    }))
  }

  // ---------------------------------------------------------------- what has fired

  /** Newest last, as it is stored. */
  async alertHistory(profileId: string): Promise<AlertFiring[]> {
    return (await this.read(profileId)).alertHistory
  }

  /**
   * Records that an alert fired.
   *
   * Bounded here rather than when it is read, so the file itself cannot grow without limit: an alert on a busy market can
   * fire every cooldown for a week, and the oldest are what a history can afford to forget.
   */
  async recordFiring(profileId: string, firing: Omit<AlertFiring, 'id'>): Promise<void> {
    const entry: AlertFiring = { ...firing, id: randomUUID() }
    await this.change(profileId, (w) => ({
      ...w,
      alertHistory: [...w.alertHistory, entry].slice(-HISTORY_KEPT)
    }))
  }

  async clearAlertHistory(profileId: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, alertHistory: [] }))
  }

  // ---------------------------------------------------------------- saved screens

  async screens(profileId: string): Promise<SavedScreen[]> {
    return (await this.read(profileId)).screens
  }

  /**
   * Saves a screen's definition.
   *
   * The query only. Saving the rows it returned would be saving a moment: they were true when it ran and would be wrong
   * the next time anybody opened it, while looking exactly as authoritative.
   */
  async saveScreen(profileId: string, name: string, query: unknown, id?: string): Promise<SavedScreen> {
    const at = this.now()
    const cleaned: ScreenerQuery = cleanQuery(query)
    let saved: SavedScreen | null = null
    await this.change(profileId, (w) => {
      const existing = id ? w.screens.find((one) => one.id === id) : undefined
      const screen: SavedScreen = {
        id: existing?.id ?? randomUUID(),
        name: name.trim().slice(0, 60) || 'Screen',
        query: cleaned,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at
      }
      saved = screen
      return {
        ...w,
        screens: existing ? w.screens.map((one) => (one.id === screen.id ? screen : one)) : [...w.screens, screen]
      }
    })
    // `change` runs its updater synchronously, so this is set by the time we are here.
    return saved ?? (cleanScreen({ id: randomUUID(), name, query: cleaned }, at) as SavedScreen)
  }

  async removeScreen(profileId: string, id: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, screens: w.screens.filter((one) => one.id !== id) }))
  }

  // ---------------------------------------------------------------- what money is shown in

  async currency(profileId: string): Promise<CurrencyPreference> {
    return (await this.read(profileId)).currency
  }

  /**
   * Settles the currency, running detection only while it is on automatic.
   *
   * A manual choice is never revisited. Somebody who chose dollars while travelling did not ask to be switched back
   * when they landed, and an application that keeps undoing a setting is one nobody trusts with settings.
   */
  async resolveCurrency(profileId: string, signals: DetectionSignals): Promise<CurrencyPreference> {
    const saved = await this.currency(profileId)
    const resolved = resolvePreference(saved, signals)
    if (resolved.code === saved.code && resolved.mode === saved.mode && resolved.detectedRegion === saved.detectedRegion) {
      return saved
    }
    const next = await this.change(profileId, (w) => ({ ...w, currency: resolved }))
    return next.currency
  }

  /**
   * Chooses a currency by hand.
   *
   * Recorded as manual, which is what stops detection reaching for it again. The recents list is how the chooser puts
   * what somebody actually uses near the top without them having to mark anything.
   */
  async setCurrency(profileId: string, code: string): Promise<CurrencyPreference> {
    const wanted = String(code ?? '').toUpperCase()
    if (!isSupported(wanted)) return this.currency(profileId)
    const next = await this.change(profileId, (w) => ({
      ...w,
      currency: {
        ...w.currency,
        mode: 'manual' as const,
        code: wanted,
        recents: [wanted, ...w.currency.recents.filter((one) => one !== wanted)].slice(0, 8)
      }
    }))
    return next.currency
  }

  /** Back to automatic, so detection decides again from here. */
  async resetCurrency(profileId: string, signals: DetectionSignals): Promise<CurrencyPreference> {
    await this.change(profileId, (w) => ({ ...w, currency: { ...w.currency, mode: 'automatic' as const } }))
    return this.resolveCurrency(profileId, signals)
  }

  async setCurrencyOptions(profileId: string, patch: unknown): Promise<CurrencyPreference> {
    const next = await this.change(profileId, (w) => ({
      ...w,
      currency: cleanCurrencyPreference({ ...w.currency, ...((patch && typeof patch === 'object' ? patch : {}) as object) })
    }))
    return next.currency
  }

  // ---------------------------------------------------------------- where Markets was left

  async layout(profileId: string): Promise<MarketsLayout> {
    return (await this.read(profileId)).layout
  }

  /** Remembers where Markets was, so it comes back there rather than at the top. */
  async setLayout(profileId: string, raw: unknown): Promise<MarketsLayout> {
    const next = await this.change(profileId, (w) => ({ ...w, layout: cleanLayout(raw) }))
    return next.layout
  }

  // ---------------------------------------------------------------- strategies

  async strategies(profileId: string): Promise<Strategy[]> {
    return (await this.read(profileId)).strategies
  }

  /**
   * Saves a strategy, bumping its version when the rules actually changed.
   *
   * The version is what lets a stored run say which rules produced it. Renaming is not a new version -- a result is a
   * fact about rules, and a strategy that was renamed is still the strategy that produced it.
   */
  async saveStrategy(profileId: string, raw: unknown): Promise<Strategy | null> {
    const at = this.now()
    const incoming = cleanStrategy({ ...(raw && typeof raw === 'object' ? raw : {}), id: (raw as { id?: string })?.id || randomUUID() }, at)
    if (!incoming) return null

    let saved: Strategy | null = null
    await this.change(profileId, (w) => {
      const existing = w.strategies.find((one) => one.id === incoming.id)
      const rulesChanged =
        !existing ||
        JSON.stringify({ ...existing, name: '', version: 0, updatedAt: 0, createdAt: 0 }) !==
          JSON.stringify({ ...incoming, name: '', version: 0, updatedAt: 0, createdAt: 0 })
      const strategy: Strategy = {
        ...incoming,
        version: existing ? existing.version + (rulesChanged ? 1 : 0) : 1,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at
      }
      saved = strategy
      return {
        ...w,
        strategies: existing
          ? w.strategies.map((one) => (one.id === strategy.id ? strategy : one))
          : [...w.strategies, strategy]
      }
    })
    return saved
  }

  /** Removes a strategy. Its recorded runs go with it: a run of rules nobody has is not comparable to anything. */
  async removeStrategy(profileId: string, id: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      strategies: w.strategies.filter((one) => one.id !== id),
      backtestRuns: w.backtestRuns.filter((one) => one.strategyId !== id)
    }))
  }

  // ---------------------------------------------------------------- recorded runs

  async backtestRuns(profileId: string): Promise<BacktestRun[]> {
    return (await this.read(profileId)).backtestRuns
  }

  /** Records a run's headline figures. The detail is not kept because it can be produced again from these. */
  async recordRun(profileId: string, raw: unknown): Promise<BacktestRun | null> {
    const run = cleanRun({ ...(raw && typeof raw === 'object' ? raw : {}), id: randomUUID() })
    if (!run) return null
    await this.change(profileId, (w) => ({ ...w, backtestRuns: [...w.backtestRuns, run].slice(-RUNS_KEPT) }))
    return run
  }

  async clearRuns(profileId: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, backtestRuns: [] }))
  }

  // ---------------------------------------------------------------- paper trading

  async paper(profileId: string): Promise<PaperState | null> {
    return (await this.read(profileId)).paper
  }

  /**
   * Starts a simulated account, replacing any that was there.
   *
   * Deliberately destructive and deliberately explicit: starting again is a thing somebody asks for, and it throws away a
   * history that cannot be got back, so the interface confirms it rather than this pretending otherwise.
   */
  async startPaper(profileId: string, startingCash: number, currency: string, settings?: Partial<PaperSettings>): Promise<PaperState> {
    const at = this.now()
    const state: PaperState = {
      account: newAccount(startingCash, currency),
      settings: { ...DEFAULT_PAPER, ...settings },
      equity: [{ at, total: startingCash, cash: startingCash, realised: 0 }],
      createdAt: at
    }
    await this.change(profileId, (w) => ({ ...w, paper: state }))
    return state
  }

  async closePaper(profileId: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, paper: null }))
  }

  /** Writes back an account after the simulation has moved it. */
  async setPaperAccount(profileId: string, account: PaperAccount): Promise<void> {
    await this.change(profileId, (w) => (w.paper ? { ...w, paper: { ...w.paper, account } } : w))
  }

  async setPaperSettings(profileId: string, settings: Partial<PaperSettings>): Promise<PaperState | null> {
    const next = await this.change(profileId, (w) =>
      w.paper ? { ...w, paper: { ...w.paper, settings: { ...w.paper.settings, ...settings } } } : w
    )
    return next.paper
  }

  /**
   * Records what the account was worth, if it is worth recording.
   *
   * The decision belongs to `shouldRecord`, which keeps an idle account from filling the curve with identical points --
   * a flat line made of a thousand readings looks like activity and is not.
   */
  async recordEquity(profileId: string, point: EquityPoint, minGapMs = 60_000): Promise<boolean> {
    const held = (await this.read(profileId)).paper
    if (!held) return false
    const last = held.equity[held.equity.length - 1] ?? null
    if (!shouldRecord(last, point, minGapMs)) return false
    await this.change(profileId, (w) =>
      w.paper ? { ...w, paper: { ...w.paper, equity: [...w.paper.equity, point].slice(-EQUITY_KEPT) } } : w
    )
    return true
  }

  // ---------------------------------------------------------------- how Markets should behave

  async experience(profileId: string): Promise<MarketsExperienceProfile> {
    return (await this.read(profileId)).experience
  }

  /**
   * Changes some of what somebody said about how they want Markets.
   *
   * A patch, cleaned as a whole, so a field that arrives as nonsense cannot land beside the good ones. Overrides are
   * merged rather than replaced: changing a level must not discard the settings somebody set by hand, which is the one
   * promise the whole precedence order rests on.
   */
  async setExperience(profileId: string, patch: unknown): Promise<MarketsExperienceProfile> {
    const raw = (patch && typeof patch === 'object' ? patch : {}) as Partial<MarketsExperienceProfile>
    const next = await this.change(profileId, (w) => ({
      ...w,
      experience: cleanExperience(
        {
          ...w.experience,
          ...raw,
          overrides: { ...w.experience.overrides, ...cleanSettings(raw.overrides) },
          updatedAt: this.now()
        },
        this.now()
      )
    }))
    return next.experience
  }

  /** One setting, set deliberately. From here on no preset touches it. */
  async setExperienceOverride(profileId: string, patch: unknown): Promise<MarketsExperienceProfile> {
    const wanted = cleanSettings(patch)
    const next = await this.change(profileId, (w) => ({
      ...w,
      experience: cleanExperience(
        { ...w.experience, overrides: { ...w.experience.overrides, ...wanted }, updatedAt: this.now() },
        this.now()
      )
    }))
    return next.experience
  }

  /**
   * Back to the preset.
   *
   * Clears the hand-set overrides and nothing else: the level, the goals and the answers stay, and so does every
   * watchlist, alert and account. A reset of presentation preferences is not a reset of Markets, and certainly not of
   * anything else in Orbis.
   */
  async resetExperience(profileId: string): Promise<MarketsExperienceProfile> {
    const next = await this.change(profileId, (w) => ({
      ...w,
      experience: { ...w.experience, overrides: {} as Partial<ExperienceSettings>, updatedAt: this.now() }
    }))
    return next.experience
  }

  /** Remembers that a term has been explained, so the same definition is not pushed at somebody twice. */
  async markLearned(profileId: string, termId: string, hint = false): Promise<MarketsExperienceProfile> {
    const clean = String(termId ?? '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40)
    if (!clean) return this.experience(profileId)
    const field = hint ? 'seenHints' : 'learned'
    const next = await this.change(profileId, (w) => {
      const held = w.experience[field]
      if (held.includes(clean)) return w
      return { ...w, experience: { ...w.experience, [field]: [...held, clean].slice(-120) } }
    })
    return next.experience
  }

  // ---------------------------------------------------------------- the first launch

  async onboarding(profileId: string): Promise<OnboardingRecord> {
    return (await this.read(profileId)).onboarding
  }

  /**
   * Writes down how far through the questions somebody is.
   *
   * A draft, not a profile. Closing Orbis eight screens in should not lose eight screens, and it should also not leave a
   * half-answered configuration behind pretending to be a settled one -- which is why this writes to `onboarding.draft`
   * and never touches `experience`.
   */
  async saveDraft(profileId: string, raw: unknown): Promise<OnboardingRecord> {
    const draft = cleanDraft(raw, this.now())
    const next = await this.change(profileId, (w) =>
      // A finished onboarding does not take drafts. Anything arriving after it is a stale window, not a new answer.
      w.onboarding.completed ? w : { ...w, onboarding: { ...w.onboarding, draft } }
    )
    return next.onboarding
  }

  async clearDraft(profileId: string): Promise<OnboardingRecord> {
    const next = await this.change(profileId, (w) => ({ ...w, onboarding: { ...w.onboarding, draft: null } }))
    return next.onboarding
  }

  /**
   * Applies a finished setup, all of it or none of it.
   *
   * One change, so there is no moment where the profile has been replaced but the ticker has not: a crash between two
   * writes would leave Markets half-configured, which looks exactly like a configuration somebody chose. The instruments
   * arrive already resolved against a provider, because this must never write a watchlist row for a market nobody could
   * find.
   */
  async completeOnboarding(
    profileId: string,
    applied: AppliedSetup,
    instruments: Instrument[] = []
  ): Promise<MarketsWorkspace> {
    const at = this.now()
    const known = new Map<string, Instrument>()
    for (const one of instruments) {
      const clean = cleanInstrument(one)
      if (clean) known.set(clean.instrumentId, clean)
    }
    const experience = cleanExperience({ ...applied.profile, updatedAt: at }, at)
    const wantedCurrency = applied.currency

    return this.change(profileId, (w) => {
      let watchlists = w.watchlists
      if (applied.watchlist) {
        const items = applied.watchlist.assets
          .map((asset) => known.get(asset.instrumentId))
          .filter((one): one is Instrument => one !== undefined)
          .map((instrument) => ({ instrumentId: instrument.instrumentId, instrument, addedAt: at }))
        // An empty list is one somebody would have to delete, so it is not created.
        if (items.length > 0) {
          watchlists = [
            ...watchlists,
            {
              id: randomUUID(),
              name: applied.watchlist.name,
              items,
              sortBy: 'symbol',
              sortDescending: false,
              columns: [...(experience.overrides.columns ?? DEFAULT_COLUMNS)]
            }
          ]
        }
      }

      let ticker = w.ticker
      if (applied.ticker) {
        const ids = applied.ticker.instrumentIds.filter((id) => known.has(id))
        const fresh = w.ticker.groups.length === 0
        const groups =
          applied.ticker.enabled && ids.length > 0 && fresh
            ? [{ id: randomUUID(), name: 'My markets', instrumentIds: ids }]
            : w.ticker.groups
        ticker = cleanTicker(
          {
            ...w.ticker,
            enabled: applied.ticker.enabled,
            groups,
            activeGroupId: groups[0]?.id ?? '',
            // The fields somebody's answers imply, unless they had already set up a ticker of their own.
            fields: fresh ? (experience.overrides.tickerFields ?? w.ticker.fields) : w.ticker.fields
          },
          w.ticker
        )
      }

      const currency =
        wantedCurrency === null
          ? w.currency
          : wantedCurrency.mode === 'manual'
            ? {
                ...w.currency,
                mode: 'manual' as const,
                code: wantedCurrency.code,
                recents: [wantedCurrency.code, ...w.currency.recents.filter((one) => one !== wantedCurrency.code)].slice(
                  0,
                  8
                )
              }
            : { ...w.currency, mode: 'automatic' as const }

      const mergedKnown = new Map<string, Instrument>()
      for (const one of w.known) mergedKnown.set(one.instrumentId, one)
      for (const [id, one] of known) mergedKnown.set(id, one)

      return {
        ...w,
        experience,
        watchlists,
        ticker,
        currency,
        known: [...mergedKnown.values()],
        onboarding: {
          completed: true,
          version: ONBOARDING_VERSION,
          skipped: false,
          completedAt: at,
          // Finished, so the draft goes: keeping it would keep a half-answered copy of a settled configuration.
          draft: null
        }
      }
    })
  }

  /**
   * Somebody chose not to answer.
   *
   * Recorded as skipped rather than completed, because they are different facts and a settings screen should be able to
   * say "you skipped setup, run it whenever". Their configuration is the balanced default and is complete -- nothing is
   * left undefined for want of an answer.
   */
  async skipOnboarding(profileId: string): Promise<OnboardingRecord> {
    const at = this.now()
    const next = await this.change(profileId, (w) => ({
      ...w,
      onboarding: { completed: true, version: ONBOARDING_VERSION, skipped: true, completedAt: at, draft: null }
    }))
    return next.onboarding
  }

  /** Runs the questions again. Nothing saved is touched: it is an offer to change preferences, not a reset. */
  async restartOnboarding(profileId: string): Promise<OnboardingRecord> {
    const next = await this.change(profileId, (w) => ({ ...w, onboarding: { ...EMPTY_ONBOARDING } }))
    return next.onboarding
  }

  // ---------------------------------------------------------------- favourites and what was just open

  async favourites(profileId: string): Promise<string[]> {
    return (await this.read(profileId)).favourites
  }

  /** Marks a market as a favourite, or unmarks it. Returns what it is now, so the caller need not guess. */
  async toggleFavourite(profileId: string, instrumentId: string): Promise<boolean> {
    const wanted = String(instrumentId ?? '').slice(0, 200)
    if (!wanted) return false
    let now = false
    await this.change(profileId, (w) => {
      const held = w.favourites.includes(wanted)
      now = !held
      return {
        ...w,
        favourites: held ? w.favourites.filter((one) => one !== wanted) : [...w.favourites, wanted].slice(-200)
      }
    })
    return now
  }

  /**
   * Remembers that a market was opened.
   *
   * Newest first and bounded. A convenience for getting back to what was just looked at -- deliberately short, because a
   * long one would be a browsing history nobody asked Orbis to keep.
   */
  async remember_(profileId: string, instrumentId: string): Promise<void> {
    const wanted = String(instrumentId ?? '').slice(0, 200)
    if (!wanted) return
    await this.change(profileId, (w) => ({
      ...w,
      recent: [wanted, ...w.recent.filter((one) => one !== wanted)].slice(0, 20)
    }))
  }

  async clearRecent(profileId: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, recent: [] }))
  }

  // ---------------------------------------------------------------- chart annotations

  async drawings(profileId: string, instrumentId?: string): Promise<Drawing[]> {
    const all = (await this.read(profileId)).drawings
    return instrumentId ? all.filter((one) => one.instrumentId === instrumentId) : all
  }

  /** Saves one drawing. Refused rather than repaired when it is not one -- a repaired drawing moves. */
  async saveDrawing(profileId: string, raw: unknown): Promise<Drawing | null> {
    const at = this.now()
    const drawing = cleanDrawing({ ...(raw && typeof raw === 'object' ? raw : {}), id: (raw as { id?: string })?.id || randomUUID() }, at)
    if (!drawing) return null
    await this.change(profileId, (w) => ({
      ...w,
      drawings: w.drawings.some((one) => one.id === drawing.id)
        ? w.drawings.map((one) => (one.id === drawing.id ? drawing : one))
        : [...w.drawings, drawing].slice(-500)
    }))
    return drawing
  }

  async removeDrawing(profileId: string, id: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, drawings: w.drawings.filter((one) => one.id !== id) }))
  }

  /** Clears one market's annotations, or all of them. Deliberately explicit: this cannot be got back. */
  async clearDrawings(profileId: string, instrumentId?: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      drawings: instrumentId ? w.drawings.filter((one) => one.instrumentId !== instrumentId) : []
    }))
  }

  // ---------------------------------------------------------------- how the panels are arranged

  async panels(profileId: string): Promise<PanelLayout> {
    return (await this.read(profileId)).panels
  }

  async setPanels(profileId: string, raw: unknown): Promise<PanelLayout> {
    const next = await this.change(profileId, (w) => ({ ...w, panels: cleanPanelLayout(raw) }))
    return next.panels
  }

  /** Back to the starting arrangement. Panels only: nothing saved anywhere else is touched. */
  async resetPanels(profileId: string): Promise<PanelLayout> {
    const next = await this.change(profileId, (w) => ({ ...w, panels: defaultLayout(w.layout.instrumentId) }))
    return next.panels
  }

  // ---------------------------------------------------------------- what starts a workflow

  async triggers(profileId: string): Promise<MarketTrigger[]> {
    return (await this.read(profileId)).triggers
  }

  async saveTrigger(profileId: string, raw: unknown): Promise<MarketTrigger | null> {
    const at = this.now()
    const trigger = cleanTrigger({ ...(raw && typeof raw === 'object' ? raw : {}), id: (raw as { id?: string })?.id || randomUUID() }, at)
    // Null when it could never fire. Not stored, because a trigger that cannot fire is a dead control.
    if (!trigger) return null
    await this.change(profileId, (w) => ({
      ...w,
      triggers: w.triggers.some((one) => one.id === trigger.id)
        ? w.triggers.map((one) => (one.id === trigger.id ? trigger : one))
        : [...w.triggers, trigger].slice(-50)
    }))
    return trigger
  }

  async removeTrigger(profileId: string, id: string): Promise<void> {
    await this.change(profileId, (w) => ({ ...w, triggers: w.triggers.filter((one) => one.id !== id) }))
  }

  /**
   * Writes back what a trigger has seen.
   *
   * Like the alerts' own: it happens constantly and must not be mistaken for somebody editing a trigger. The condition
   * is untouched -- only the memory that makes an edge an edge.
   */
  async rememberTriggerState(profileId: string, triggers: MarketTrigger[]): Promise<void> {
    if (triggers.length === 0) return
    const byId = new Map(triggers.map((one) => [one.id, one]))
    await this.change(profileId, (w) => ({
      ...w,
      triggers: w.triggers.map((existing) => {
        const seen = byId.get(existing.id)
        if (!seen) return existing
        return {
          ...existing,
          lastValue: seen.lastValue,
          lastFiredAt: seen.lastFiredAt,
          firedToday: seen.firedToday,
          firedDay: seen.firedDay,
          wasTrue: seen.wasTrue
        }
      })
    }))
  }

  // ---------------------------------------------------------------- leverage

  async margin(profileId: string): Promise<MarginSettings> {
    return (await this.read(profileId)).margin
  }

  async setMargin(profileId: string, raw: unknown): Promise<MarginSettings> {
    const next = await this.change(profileId, (w) => ({ ...w, margin: cleanMargin({ ...w.margin, ...(raw && typeof raw === 'object' ? raw : {}) }) }))
    return next.margin
  }

  // ---------------------------------------------------------------- instruments

  /** Remembers an instrument's details, so a saved list survives a provider being unreachable. */
  async remember(profileId: string, instruments: Instrument[]): Promise<void> {
    const clean = instruments.map(cleanInstrument).filter((i): i is Instrument => i !== null)
    if (clean.length === 0) return
    await this.change(profileId, (w) => {
      const known = new Map(w.known.map((k) => [k.instrumentId, k]))
      for (const one of clean) known.set(one.instrumentId, one)
      return { ...w, known: [...known.values()] }
    })
  }

  async known(profileId: string): Promise<Instrument[]> {
    return (await this.read(profileId)).known
  }

  /** Everything this profile is watching for any reason, for deciding what to subscribe to. */
  async watching(profileId: string): Promise<string[]> {
    return allWatched(await this.read(profileId))
  }

  /** Everything, for an export. Credentials are not here because none are kept here. */
  async export(profileId: string): Promise<MarketsWorkspace> {
    return { ...(await this.read(profileId)) }
  }

  /** An import, cleaned like anything from outside. Replaces, because a half-merge is nobody's configuration. */
  async import(profileId: string, raw: unknown): Promise<MarketsWorkspace> {
    return this.change(profileId, () => cleanWorkspace(raw, this.now()))
  }

  /** A profile change: the cache is dropped after being written, because another profile's markets are not this one's. */
  async profileChanged(): Promise<void> {
    await this.flush()
    this.cache.clear()
    this.reading.clear()
  }

  /**
   * Stops, and writes down anything still waiting.
   *
   * Writes are batched, so at any moment there may be a change from the last second that has not reached the disk.
   * Cancelling the timer and leaving is how a watchlist added a moment before quitting disappears -- which looks exactly
   * like it was never added.
   *
   * Synchronously, because this runs while Orbis is closing and there is no promise anybody is left to await. It is a
   * handful of small files at most, written the same way as `flush`: beside, then renamed over, so an interrupted write
   * leaves the old file rather than half of the new one.
   */

  // ---------------------------------------------------------------- candlestick patterns

  async patterns(profileId: string): Promise<PatternState> {
    return (await this.read(profileId)).patterns
  }

  /**
   * Change the pattern settings.
   *
   * Only the keys given are changed, so a screen that knows about one switch cannot reset the others by sending a
   * partial object. Switching detection off deliberately leaves the rules, the history and the mutes exactly where
   * they were: it is a switch, not a reset, and somebody turning it off for an afternoon should not lose their rules.
   */
  async savePatternSettings(profileId: string, raw: unknown): Promise<PatternSettings> {
    const current = (await this.read(profileId)).patterns.settings
    const merged = cleanPatternSettings({ ...current, ...(raw && typeof raw === 'object' ? raw : {}) })
    await this.change(profileId, (w) => ({ ...w, patterns: { ...w.patterns, settings: merged } }))
    return merged
  }

  async savePatternRule(profileId: string, raw: unknown): Promise<PatternAlertRule | null> {
    const at = this.now()
    // The id is minted here rather than demanded of the caller: a rule somebody has just typed has no id yet, and
    // `cleanPatternRule` refuses one without an id so that a corrupt stored record is not given a new identity.
    const rule = cleanPatternRule({ ...(raw && typeof raw === 'object' ? raw : {}), id: (raw as { id?: string })?.id || randomUUID() }, at)
    if (!rule) return null
    await this.change(profileId, (w) => ({
      ...w,
      patterns: {
        ...w.patterns,
        rules: w.patterns.rules.some((one) => one.id === rule.id)
          ? w.patterns.rules.map((one) => (one.id === rule.id ? rule : one))
          : [...w.patterns.rules, rule].slice(-PATTERN_LIMITS.rules)
      }
    }))
    return rule
  }

  async removePatternRule(profileId: string, ruleId: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      patterns: { ...w.patterns, rules: w.patterns.rules.filter((one) => one.id !== ruleId) }
    }))
  }

  /**
   * Add detections to the history.
   *
   * Keyed, so the same formation arriving twice -- from a re-examination, a reconnection or a backfill -- replaces its
   * record rather than adding a second one. Retention is applied on the way in, and the images belonging to removed
   * records come back so the caller can delete them.
   */
  async addPatternRecords(profileId: string, records: readonly PatternRecord[]): Promise<{ stored: number; orphanedSnapshots: string[] }> {
    if (records.length === 0) return { stored: 0, orphanedSnapshots: [] }
    const at = this.now()
    let orphaned: string[] = []
    await this.change(profileId, (w) => {
      const byKey = new Map(w.patterns.records.map((one) => [one.key, one]))
      for (const one of records) byKey.set(one.key, one)
      const pruned = prune([...byKey.values()], w.patterns.settings.retention, at, PATTERN_LIMITS.history)
      orphaned = pruned.orphanedSnapshots
      return { ...w, patterns: { ...w.patterns, records: pruned.kept } }
    })
    return { stored: records.length, orphanedSnapshots: orphaned }
  }

  async patternRecords(profileId: string): Promise<PatternRecord[]> {
    return (await this.read(profileId)).patterns.records
  }

  /** Forget recorded detections. Market data is untouched: it belongs to the cache, not to this history. */
  async clearPatternRecords(profileId: string, keys?: readonly string[]): Promise<{ removed: number; orphanedSnapshots: string[] }> {
    let removed = 0
    let orphaned: string[] = []
    await this.change(profileId, (w) => {
      const keep = keys === undefined ? [] : w.patterns.records.filter((one) => !keys.includes(one.key))
      const gone = keys === undefined ? w.patterns.records : w.patterns.records.filter((one) => keys.includes(one.key))
      removed = gone.length
      orphaned = gone.map((one) => one.snapshotRef).filter((one): one is string => one !== null)
      return { ...w, patterns: { ...w.patterns, records: keep } }
    })
    return { removed, orphanedSnapshots: orphaned }
  }

  /**
   * Record that an alert fired.
   *
   * Bounded, and the bound is why the deduplication key is also stored on the record: once a firing scrolls off this
   * list the same formation could fire again, and the only thing preventing it is that the candle it belongs to is by
   * then far in the past.
   */
  async addPatternFirings(profileId: string, firings: readonly PatternFiring[]): Promise<PatternFiring[]> {
    if (firings.length === 0) return (await this.read(profileId)).patterns.firings
    let after: PatternFiring[] = []
    await this.change(profileId, (w) => {
      const byKey = new Map(w.patterns.firings.map((one) => [one.key, one]))
      for (const one of firings) byKey.set(one.key, one)
      after = [...byKey.values()].sort((a, b) => a.firedAt - b.firedAt).slice(-PATTERN_LIMITS.firings)
      return { ...w, patterns: { ...w.patterns, firings: after } }
    })
    return after
  }

  /** Mark a firing delivered, or record why it was not. Delivery is never assumed. */
  async markPatternDelivered(profileId: string, key: string, delivered: boolean, note: string): Promise<void> {
    await this.change(profileId, (w) => ({
      ...w,
      patterns: {
        ...w.patterns,
        firings: w.patterns.firings.map((one) => (one.key === key ? { ...one, delivered, deliveryNote: note.slice(0, 500) } : one))
      }
    }))
  }

  async patternFirings(profileId: string): Promise<PatternFiring[]> {
    return (await this.read(profileId)).patterns.firings
  }

  async savePatternMutes(profileId: string, raw: unknown): Promise<MuteRule[]> {
    const at = this.now()
    // Expired mutes are dropped on the way in as well as on read: a decision that has finished is not state.
    const mutes = cleanPatternMutes(raw).filter((one) => one.until > at)
    await this.change(profileId, (w) => ({ ...w, patterns: { ...w.patterns, mutes } }))
    return mutes
  }

  async patternMutes(profileId: string): Promise<MuteRule[]> {
    const at = this.now()
    return (await this.read(profileId)).patterns.mutes.filter((one) => one.until > at)
  }

  /** The settings a fresh profile starts with, for a screen that wants to offer a reset. */
  defaultPatternSettings(): PatternSettings {
    return { ...DEFAULT_PATTERN_SETTINGS }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const pending = [...this.dirty]
    this.dirty.clear()
    for (const profileId of pending) {
      const workspace = this.cache.get(profileId)
      if (!workspace) continue
      const path = this.path(profileId)
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(`${path}.tmp`, JSON.stringify(workspace), { mode: 0o600 })
        renameSync(`${path}.tmp`, path)
      } catch {
        // Nothing useful can be done while closing, and throwing here would take the shutdown with it.
      }
    }
  }
}
