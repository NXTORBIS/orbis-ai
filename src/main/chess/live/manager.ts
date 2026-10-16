import {
  clockDisplay,
  freshness,
  ingestLivePayload,
  liveIdOf,
  type ClockDisplay,
  type Freshness,
  type LiveDiagnostic,
  type LiveGameRecord,
  type LiveGameState,
  type LiveOutcome,
  type LiveOutcomeOf,
  type LivePayload,
  type LiveStatus
} from '../../../shared/chess/live.ts'

/**
 * Following live chess, without the rest of Orbis having to know who is broadcasting it.
 *
 * The manager exists to hold three lines that are easy to blur and expensive to get wrong:
 *
 *  1. **Listing what is on is not the same as following it.** A person opening the live page wants to see forty
 *     tournaments; they are watching none of them. Opening a stream per game to populate a list would mean forty
 *     connections to a provider that documents a limit of one request at a time, which is both a self-inflicted
 *     outage and rude. So `refresh()` and `games()` are plain requests, and only `follow()` opens anything.
 *
 *  2. **An old subscription must never be able to speak.** Switching rounds while the previous stream is still
 *     winding down is ordinary -- somebody clicks twice -- and a chunk that was already in flight will arrive after
 *     the switch. Every subscription carries a generation token, and a callback whose token is not the current one is
 *     counted and dropped. Without this, the board shows a game from the round you just left, which looks exactly
 *     like a bug in the chess rather than in the plumbing.
 *
 *  3. **A burst is one change, not sixty.** A round of sixty games sends sixty whole games the moment it is
 *     subscribed to, and a provider catching up after a reconnect does the same. Those are gathered and reported
 *     once. Because every snapshot is the whole truth about its game, coalescing by keeping the newest snapshot per
 *     game loses nothing -- and that is exactly why a queued *update* is never collapsed that way.
 *
 * Per-game state is kept in the normalised model from `shared/chess/live.ts` and nowhere else, so what the screen
 * reads, what a diagnostic refers to, and what could be saved as a game are all the same object.
 *
 * No Electron, no network and no timers of its own: a provider, a clock and a timer are all parameters.
 */

/** One thing that is on, or was: a round, a tournament, whatever the provider's unit of broadcast is. */
export interface LiveEventSummary {
  provider: string
  /** The provider's id for it, which is what `follow` and `games` take. */
  eventId: string
  name: string
  status: LiveStatus
  /** The provider's own page, for a link and for attribution. */
  url?: string
  startsAt?: number
  finishedAt?: number
  /** Seconds the provider says it deliberately holds data back, when it says. */
  delaySeconds?: number
  /** The tournament or series this belongs to. */
  tournamentName?: string
  /** The provider's own featuring rank, when it has one. Lower is more prominent. */
  tier?: number
}

/** One game in an event, as a list shows it before anybody is following anything. */
export interface LiveGameSummary {
  provider: string
  providerGameId: string
  eventId: string
  name: string
  white: { name?: string; rating?: number; title?: string }
  black: { name?: string; rating?: number; title?: string }
  status: LiveStatus
  result: string
}

export interface SubscriptionHandle {
  stop(): void
  done: Promise<void>
}

/**
 * What the manager needs of a provider, and nothing more.
 *
 * Deliberately four methods. Anything a provider can do that is not one of these -- pushing PGN, editing a round,
 * reading a private study -- is that provider's business and is reached through its own adapter.
 */
export interface LiveProviderPort {
  readonly name: string
  /** What is on. A plain request; opens no stream. */
  discover(o: { max?: number; onlyLive?: boolean }): Promise<LiveOutcomeOf<{ events: LiveEventSummary[]; warnings: LiveDiagnostic[] }>>
  /** The games of one event. A plain request; opens no stream. */
  games(eventId: string): Promise<LiveOutcomeOf<{ event: LiveEventSummary; games: LiveGameSummary[]; warnings: LiveDiagnostic[] }>>
  /** Follow one event. This is the only thing that opens a connection. */
  subscribe(
    eventId: string,
    handlers: {
      onPayloads: (payloads: LivePayload[]) => void
      onDiagnostic?: (d: LiveDiagnostic) => void
      onState?: (state: ConnectionState, detail?: string) => void
    }
  ): SubscriptionHandle
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'stopped' | 'failed'

/** One batch of changes, after a burst has been gathered. */
export interface LiveChange {
  provider: string
  eventId: string
  /** The games that changed, in their state afterwards. */
  games: LiveGameRecord[]
  /** What happened to each, by game id, so a screen can tell a correction from an ordinary move. */
  outcomes: Record<string, LiveOutcome>
  /** Notes worth showing: corrections, refusals, out-of-order deliveries. */
  notes: string[]
  at: number
}

export interface LiveManagerOptions {
  now?: () => number
  /** How long a burst is gathered before anyone is told. Zero reports each delivery on its own. */
  coalesceMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** How long a listing is reused before it is fetched again. */
  discoveryTtlMs?: number
  /** The most games held for one event, so a mis-reported round cannot fill memory. */
  maxGames?: number
  onChange?: (change: LiveChange) => void
  onDiagnostic?: (diagnostic: LiveDiagnostic) => void
  onState?: (state: ConnectionState, detail?: string) => void
}

const DEFAULTS = { coalesceMs: 250, discoveryTtlMs: 60_000, maxGames: 400 }

/** A game plus what the manager can say about how current it is. */
export interface LiveGameView {
  record: LiveGameRecord
  freshness: Freshness
  clocks: ClockDisplay
}

interface Pending {
  /** Payloads waiting to be applied, in arrival order. */
  queue: LivePayload[]
}

export class LiveChessManager {
  private readonly providers = new Map<string, LiveProviderPort>()
  private readonly options: Required<Pick<LiveManagerOptions, 'coalesceMs' | 'discoveryTtlMs' | 'maxGames'>>
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly handlers: Pick<LiveManagerOptions, 'onChange' | 'onDiagnostic' | 'onState'>

  /** Every game currently held, by its normalised id. */
  private readonly games = new Map<string, LiveGameState>()
  /** Listings, by the question that produced them. */
  private readonly listings = new Map<string, { at: number; events: LiveEventSummary[] }>()

  /**
   * The generation counter.
   *
   * It only ever goes up, and the current subscription's token is the only one allowed to change anything. This is
   * the whole defence against a late chunk from a round nobody is watching any more.
   */
  private generation = 0
  private active: { token: number; provider: string; eventId: string; handle: SubscriptionHandle; state: ConnectionState } | null = null

  private pending = new Map<string, Pending>()
  private flushTimer: unknown = null
  private stats = { lateDropped: 0, batches: 0, payloads: 0 }

  constructor(options: LiveManagerOptions = {}) {
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.options = {
      coalesceMs: options.coalesceMs ?? DEFAULTS.coalesceMs,
      discoveryTtlMs: options.discoveryTtlMs ?? DEFAULTS.discoveryTtlMs,
      maxGames: options.maxGames ?? DEFAULTS.maxGames
    }
    this.handlers = {
      ...(options.onChange ? { onChange: options.onChange } : {}),
      ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
      ...(options.onState ? { onState: options.onState } : {})
    }
  }

  register(provider: LiveProviderPort): void {
    this.providers.set(provider.name, provider)
  }

  providerNames(): string[] {
    return [...this.providers.keys()]
  }

  // ---- discovery: plain requests, no connections ----------------------------------------------------------------

  /**
   * What is on, from one provider.
   *
   * Reuses a listing that is still fresh, so three screens asking at once cost one request. `force` is for a person
   * pressing refresh, which should mean refresh.
   */
  async refresh(providerName: string, o: { max?: number; onlyLive?: boolean; force?: boolean } = {}): Promise<LiveOutcomeOf<LiveEventSummary[]>> {
    const provider = this.providers.get(providerName)
    if (!provider) return { ok: false, diagnostic: this.fault(providerName, 'discovery', 'refused', `There is no "${providerName}" provider to ask.`) }
    const key = `${providerName}|${o.max ?? ''}|${o.onlyLive ? 'live' : 'all'}`
    const held = this.listings.get(key)
    if (!o.force && held && this.now() - held.at < this.options.discoveryTtlMs) return { ok: true, value: held.events }
    const got = await provider.discover({ ...(o.max !== undefined ? { max: o.max } : {}), ...(o.onlyLive !== undefined ? { onlyLive: o.onlyLive } : {}) })
    if (!got.ok) {
      this.handlers.onDiagnostic?.(got.diagnostic)
      // A listing that is merely old still beats an empty page, and it is returned as what it is rather than refetched.
      if (held) return { ok: true, value: held.events }
      return got
    }
    for (const warning of got.value.warnings) this.handlers.onDiagnostic?.(warning)
    this.listings.set(key, { at: this.now(), events: got.value.events })
    return { ok: true, value: got.value.events }
  }

  /** One event's games, listed. Still no connection: this is how a round is shown before anyone follows it. */
  async listGames(providerName: string, eventId: string): Promise<LiveOutcomeOf<{ event: LiveEventSummary; games: LiveGameSummary[] }>> {
    const provider = this.providers.get(providerName)
    if (!provider) return { ok: false, diagnostic: this.fault(providerName, `event ${eventId}`, 'refused', `There is no "${providerName}" provider to ask.`) }
    const got = await provider.games(eventId)
    if (!got.ok) {
      this.handlers.onDiagnostic?.(got.diagnostic)
      return got
    }
    for (const warning of got.value.warnings) this.handlers.onDiagnostic?.(warning)
    return { ok: true, value: { event: got.value.event, games: got.value.games } }
  }

  // ---- following: the only thing that connects ------------------------------------------------------------------

  /**
   * Follow one event.
   *
   * Any previous subscription is stopped first and its generation retired, so nothing it still has in flight can
   * reach the state. Following the event already being followed is a no-op rather than a reconnect, because a screen
   * re-rendering should not drop and remake a connection to a provider that limits connections.
   */
  follow(providerName: string, eventId: string, o: { keepExistingGames?: boolean } = {}): LiveOutcomeOf<{ generation: number }> {
    const provider = this.providers.get(providerName)
    if (!provider) return { ok: false, diagnostic: this.fault(providerName, `event ${eventId}`, 'refused', `There is no "${providerName}" provider to follow.`) }
    if (this.active && this.active.provider === providerName && this.active.eventId === eventId) {
      return { ok: true, value: { generation: this.active.token } }
    }
    this.unfollow(o.keepExistingGames === true)
    const token = ++this.generation
    const handle = provider.subscribe(eventId, {
      onPayloads: (payloads) => this.accept(token, providerName, eventId, payloads),
      onDiagnostic: (d) => {
        if (!this.current(token)) return
        this.handlers.onDiagnostic?.(d)
      },
      onState: (state, detail) => {
        if (!this.current(token)) return
        if (this.active) this.active.state = state
        this.handlers.onState?.(state, detail)
      }
    })
    this.active = { token, provider: providerName, eventId, handle, state: 'connecting' }
    return { ok: true, value: { generation: token } }
  }

  /**
   * Stop following.
   *
   * The generation is retired before the handle is stopped, not after: a provider is entitled to deliver one more
   * chunk synchronously from inside `stop()`, and by then it must already be too late for it to matter.
   */
  unfollow(keepGames = false): void {
    const active = this.active
    this.generation += 1
    this.active = null
    this.discardPending()
    if (!keepGames) this.games.clear()
    if (active) {
      active.handle.stop()
      this.handlers.onState?.('stopped')
    }
  }

  /** Whether a token is the one currently allowed to change anything. */
  private current(token: number): boolean {
    return this.active !== null && this.active.token === token && token === this.generation
  }

  /**
   * Payloads from a subscription.
   *
   * The token check is the first thing that happens and the reason this method exists. A dropped late batch is
   * counted rather than ignored in silence, so "the board stopped updating" can be told apart from "the board is
   * being updated by a round nobody is watching".
   */
  private accept(token: number, providerName: string, eventId: string, payloads: LivePayload[]): void {
    if (!this.current(token)) {
      this.stats.lateDropped += payloads.length
      return
    }
    if (this.active && (this.active.provider !== providerName || this.active.eventId !== eventId)) {
      this.stats.lateDropped += payloads.length
      return
    }
    for (const payload of payloads) {
      const id = liveIdOf(payload.provider, payload.providerGameId)
      if (!this.games.has(id) && !this.pending.has(id) && this.games.size + this.pending.size >= this.options.maxGames) {
        this.handlers.onDiagnostic?.(
          this.fault(providerName, `event ${eventId}`, 'refused', `This round reports more than ${this.options.maxGames} games, which is more than Orbis will follow at once. The rest were not taken.`)
        )
        break
      }
      const slot = this.pending.get(id) ?? { queue: [] }
      // A snapshot is the whole truth about its game, so it supersedes anything still queued for that game. An
      // update is only a fragment, so it is appended -- collapsing updates would silently throw moves away.
      if (payload.kind === 'snapshot') slot.queue = [payload]
      else slot.queue.push(payload)
      this.pending.set(id, slot)
      this.stats.payloads += 1
    }
    if (this.options.coalesceMs <= 0) {
      this.flush(token)
      return
    }
    if (this.flushTimer === null) {
      this.flushTimer = this.setTimer(() => {
        this.flushTimer = null
        this.flush(token)
      }, this.options.coalesceMs)
    }
  }

  private discardPending(): void {
    this.pending = new Map()
    if (this.flushTimer !== null) {
      this.clearTimer(this.flushTimer)
      this.flushTimer = null
    }
  }

  /** Applies everything gathered and reports it as one change. */
  private flush(token: number): void {
    if (!this.current(token)) {
      this.discardPending()
      return
    }
    const batch = this.pending
    this.pending = new Map()
    if (!batch.size) return
    const changed: LiveGameRecord[] = []
    const outcomes: Record<string, LiveOutcome> = {}
    const notes: string[] = []
    for (const [id, slot] of batch) {
      let touched = false
      for (const payload of slot.queue) {
        const before = this.games.get(id) ?? null
        const result = ingestLivePayload(before, payload)
        if (result.outcome === 'refused') {
          this.handlers.onDiagnostic?.(
            this.fault(payload.provider, `game ${payload.providerGameId}`, result.problem === 'illegal-move' ? 'pgn' : 'refused', result.note ?? 'This update could not be applied.')
          )
          continue
        }
        outcomes[id] = result.outcome
        if (result.outcome === 'duplicate' || result.outcome === 'out-of-order') {
          if (result.note) notes.push(result.note)
          continue
        }
        this.games.set(id, result.state)
        if (result.note) notes.push(result.note)
        if (result.outcome !== 'unchanged') touched = true
      }
      const state = this.games.get(id)
      if (touched && state) changed.push(state.record)
    }
    if (!changed.length && !notes.length) return
    this.stats.batches += 1
    const active = this.active
    this.handlers.onChange?.({
      provider: active?.provider ?? '',
      eventId: active?.eventId ?? '',
      games: changed,
      outcomes,
      notes,
      at: this.now()
    })
  }

  // ---- reading what is held -------------------------------------------------------------------------------------

  /** One game as it should be shown: the record, how old it is, and clocks that say where they came from. */
  view(gameId: string, o: { delaySeconds?: number; extrapolate?: boolean } = {}): LiveGameView | null {
    const state = this.games.get(gameId)
    if (!state) return null
    const now = this.now()
    return {
      record: state.record,
      freshness: freshness({
        ...(state.record.sourceTimestamp !== undefined ? { sourceTimestamp: state.record.sourceTimestamp } : {}),
        receivedAt: state.record.receivedAt,
        now,
        provider: state.record.provider,
        ...(o.delaySeconds !== undefined ? { delaySeconds: o.delaySeconds } : {})
      }),
      clocks: clockDisplay({ record: state.record, now, ...(o.extrapolate !== undefined ? { extrapolate: o.extrapolate } : {}) })
    }
  }

  /** Everything held, in a stable order so a list does not reshuffle itself as moves arrive. */
  all(): LiveGameRecord[] {
    return [...this.games.values()]
      .map((s) => s.record)
      .sort((a, b) => (a.round ?? '').localeCompare(b.round ?? '', undefined, { numeric: true }) || a.providerGameId.localeCompare(b.providerGameId))
  }

  /** What is being followed, if anything, and how the connection is doing. */
  following(): { provider: string; eventId: string; generation: number; state: ConnectionState } | null {
    if (!this.active) return null
    return { provider: this.active.provider, eventId: this.active.eventId, generation: this.active.token, state: this.active.state }
  }

  /** Counters worth having when somebody reports that the board froze. */
  health(): { games: number; generation: number; lateDropped: number; batches: number; payloads: number; pending: number } {
    return {
      games: this.games.size,
      generation: this.generation,
      lateDropped: this.stats.lateDropped,
      batches: this.stats.batches,
      payloads: this.stats.payloads,
      pending: this.pending.size
    }
  }

  private fault(provider: string, operation: string, kind: LiveDiagnostic['kind'], message: string): LiveDiagnostic {
    return { provider, operation, kind, message, at: this.now() }
  }
}

export const createLiveChessManager = (options: LiveManagerOptions = {}): LiveChessManager => new LiveChessManager(options)
