import { INTELLIGENCE_VERSION, DISCOVERY_LEVELS, type DiscoveryLevel, type MusicTuning } from '../../shared/music/config.ts'
import { featuresOf, type AudioFeatures, type TrackFeatures } from '../../shared/music/features.ts'
import { inferIntent, parseRequest, resolveIntent, type Constraints, type IntentState, type ListeningIntent } from '../../shared/music/intent.ts'
import { buildGraph, generate, knownFrom, explorationMap, matching, type Library, type MusicGraph } from '../../shared/music/candidates.ts'
import { emptyModels, learnOutcome, modelFeatures, rank, type Candidate, type RankingModels, type Scored, type Strategy } from '../../shared/music/ranking.ts'
import { STRATEGY_FOR_INTENT } from '../../shared/music/ranking.ts'
import { curveFor, planRun, reflow, type QueueEntry, type QueueOrigin } from '../../shared/music/sequence.ts'
import {
  adapt,
  chooseStrategy,
  contextKey,
  creditStrategy,
  emptyStrategyMemory,
  isSameSession,
  newMusicSession,
  record as recordSession,
  recordDiscovery,
  rewardOf,
  sessionEnergy,
  signalsFrom,
  startingTuning,
  type MusicSession,
  type StrategyMemory
} from '../../shared/music/session.ts'
import {
  affinity,
  emptyTaste,
  forget,
  learn,
  learnDiscoveryAppetite,
  learnFromSkip,
  listenEvent,
  musicDna,
  newSession as newTasteSession,
  state as stateTaste,
  type MusicEvent,
  type TasteDimension,
  type UserTaste
} from '../../shared/music/taste.ts'
import type { OrbisTrack } from '../../shared/music.ts'
import { playableOffline } from '../../shared/music.ts'
import type { MusicStore } from './store.ts'

/**
 * The music intelligence, as one thing with a memory.
 *
 * Everything that decides anything lives in `src/shared/music/*` and is tested without a screen or a disk. This file
 * is the part that holds the state, keeps it on disk, and answers the two questions the rest of Orbis asks: what
 * should play next, and what did that tell us.
 *
 * ## The loop, actually closed
 *
 * The player reports what really happened to every track. That becomes an event, the event moves the taste model and
 * the small outcome models, credits the strategy that chose the track, updates the sitting, and nudges the tunable
 * numbers -- all bounded. The next request reads the updated state. There is no step in that loop that is decorative.
 *
 * ## Where the honesty is enforced
 *
 * Nothing is recommended that cannot be played: candidates come from tracks with audio on this computer. Nothing is
 * claimed about a track that has not been measured. The reasons attached to a choice are the parts that actually
 * contributed to its score. And a request Orbis could not understand says so instead of quietly becoming something
 * else.
 */

export interface Stored {
  taste: UserTaste
  models: RankingModels
  strategies: StrategyMemory
  tuning: MusicTuning
  /** What each track turned out to sound like. */
  features: Record<string, AudioFeatures>
  version: number
}

export interface NextChoice {
  track: OrbisTrack
  /** Why, in words a person could read. */
  because: readonly string[]
  strategy: Strategy
  /** Everything behind the choice, for the developer inspector only. */
  inspect: {
    score: number
    parts: Scored['parts']
    predictions: Scored['predictions']
    novelty: Scored['novelty']
    sources: readonly string[]
    confidence: number
  }
}

export interface Plan {
  /** The run, in order. */
  tracks: NextChoice[]
  /** Where the energy is planned to go, for drawing the shape of the session. */
  energy: (number | null)[]
  notes: readonly string[]
  /** What was asked for, as the engine understood it. */
  intent: IntentState
  /** Anything in the request Orbis could not read. Shown to the person rather than ignored. */
  notUnderstood: readonly string[]
}

export interface EngineOptions {
  store: MusicStore
  /** Asks the player window to measure a track. */
  measure(trackId: string): void
  now?(): number
  random?(): number
}

export class MusicEngine {
  private readonly o: EngineOptions
  private readonly now: () => number
  private readonly random: () => number

  private taste: UserTaste = emptyTaste()
  private models: RankingModels = emptyModels()
  private strategies: StrategyMemory = emptyStrategyMemory()
  private tuning: MusicTuning = startingTuning()
  private measured = new Map<string, AudioFeatures>()

  private session: MusicSession
  /** What was asked for outright, until it expires or is replaced. */
  private stated: IntentState | null = null
  /** A mode somebody chose in the interface. */
  private mode: IntentState | null = null

  /** The library as the engine sees it, rebuilt when the library changes. */
  private library: Library = { features: [], stats: new Map() }
  private graph: MusicGraph = buildGraph(this.library)
  private featureById = new Map<string, TrackFeatures>()
  private libraryStamp = ''

  /** Which strategy chose which track, so the credit goes to the right place. */
  private chosenBy = new Map<string, Strategy>()
  /** Tracks measured as unmeasurable, so Orbis does not try for ever. */
  private unmeasurable = new Set<string>()
  private measuringNow: string | null = null

  private dirty = false
  private saveTimer: NodeJS.Timeout | null = null

  constructor(options: EngineOptions) {
    this.o = options
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.session = newMusicSession(`s-${this.now().toString(36)}`, this.now())
  }

  // ---------------------------------------------------------------- keeping it

  async load(): Promise<void> {
    const stored = await this.o.store.intelligence<Stored>()
    if (stored) {
      this.taste = stored.taste
      this.models = stored.models
      this.strategies = stored.strategies
      this.tuning = stored.tuning
      this.measured = new Map(Object.entries(stored.features))
    } else {
      this.taste = emptyTaste()
      this.models = emptyModels()
      this.strategies = emptyStrategyMemory()
      this.tuning = startingTuning()
      this.measured = new Map()
    }
    this.session = newMusicSession(`s-${this.now().toString(36)}`, this.now())
    this.stated = null
    this.mode = null
    this.chosenBy.clear()
    this.unmeasurable.clear()
    await this.refreshLibrary(true)
  }

  private touch(): void {
    this.dirty = true
    if (this.saveTimer) return
    // Written a little after the event rather than on every play: this is a few hundred kilobytes of model.
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 4000)
    this.saveTimer.unref?.()
  }

  async save(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    await this.o.store
      .saveIntelligence({
        taste: this.taste,
        models: this.models,
        strategies: this.strategies,
        tuning: this.tuning,
        features: Object.fromEntries(this.measured),
        version: INTELLIGENCE_VERSION
      })
      .catch(() => undefined)
  }

  /** Called when the profile changes: everything personal is dropped and the new profile's is read. */
  async useProfile(): Promise<void> {
    await this.save()
    await this.load()
  }

  // ---------------------------------------------------------------- the library, as features

  /**
   * Rebuilds what the engine knows about the library.
   *
   * The graph is the expensive part, so it is rebuilt only when the set of tracks actually changes -- a play count
   * ticking over does not change who is related to whom.
   */
  async refreshLibrary(force = false): Promise<void> {
    const tracks = (await this.o.store.all()).filter(playableOffline)
    const stamp = `${tracks.length}:${tracks.map((one) => one.id).join(',')}`.slice(0, 4000)
    const changed = stamp !== this.libraryStamp
    const features = tracks.map((one) => featuresOf(one, this.measured.get(one.id) ?? null))
    this.featureById = new Map(features.map((one) => [one.trackId, one]))
    this.library = {
      features,
      stats: new Map(
        tracks.map((one) => [
          one.id,
          { playCount: one.playCount ?? 0, lastPlayedAt: one.lastPlayedAt ?? null, favourite: one.favourite === true, everCompleted: (one.playCount ?? 0) > 0 }
        ])
      )
    }
    if (changed || force) {
      this.libraryStamp = stamp
      this.graph = buildGraph(this.library)
    }
    this.measureSomething()
  }

  /** Starts measuring one track that has not been measured. Called when things are quiet. */
  measureSomething(): void {
    if (this.measuringNow) return
    const next = this.library.features.find((one) => !one.audio && !this.unmeasurable.has(one.trackId))
    if (!next) return
    this.measuringNow = next.trackId
    this.o.measure(next.trackId)
  }

  /** What the player found out about a track. */
  onMeasured(trackId: string, features: AudioFeatures | null, problem: string | null): void {
    if (this.measuringNow === trackId) this.measuringNow = null
    if (!features) {
      // Marked so it is not tried for ever. A file that cannot be decoded is simply a track with no measurements.
      this.unmeasurable.add(trackId)
      if (problem) console.warn('[music] could not measure a track:', problem.slice(0, 120))
      this.measureSomething()
      return
    }
    this.measured.set(trackId, features)
    const track = this.featureById.get(trackId)
    if (track) this.featureById.set(trackId, featuresOf({ ...(track as unknown as OrbisTrack), id: trackId } as OrbisTrack, features))
    this.touch()
    void this.refreshLibrary()
  }

  get measurement(): { measured: number; total: number; unmeasurable: number; working: boolean } {
    return {
      measured: this.library.features.filter((one) => one.audio).length,
      total: this.library.features.length,
      unmeasurable: this.unmeasurable.size,
      working: this.measuringNow !== null
    }
  }

  // ---------------------------------------------------------------- what is wanted

  /** Something said outright, in words. Returns what was understood and what was not. */
  request(said: string): { intent: IntentState; notUnderstood: string[] } {
    const parsed = parseRequest(said, this.now())
    if (parsed.intent.confidence > 0) this.stated = parsed.intent
    return parsed
  }

  /** Something asked for as structured constraints, which is how Orion hands over a request it interpreted. */
  setConstraints(intent: ListeningIntent, constraints: Constraints, said?: string, forMs?: number): IntentState {
    this.stated = {
      intent,
      confidence: 1,
      source: 'stated',
      constraints,
      until: forMs ? this.now() + forMs : null,
      said
    }
    return this.stated
  }

  /** A mode chosen in the interface: weaker than a spoken request, stronger than a guess. */
  setMode(mode: ListeningIntent | null): void {
    if (!mode) {
      this.mode = null
      return
    }
    const parsed = parseRequest(mode, this.now())
    this.mode = { ...parsed.intent, intent: mode, source: 'chosen-mode', confidence: 0.8, until: null }
  }

  setDiscovery(level: DiscoveryLevel): void {
    this.tuning = { ...this.tuning, discovery: { ...this.tuning.discovery, value: DISCOVERY_LEVELS[level] } }
    this.touch()
  }

  clearRequest(): void {
    this.stated = null
  }

  /** What the engine currently believes is wanted, from everything it has. */
  intentNow(): IntentState {
    return resolveIntent(this.stated, this.mode, inferIntent(signalsFrom(this.session, this.now()), this.now()), this.now())
  }

  // ---------------------------------------------------------------- choosing

  private contextFor(currentTrackId: string | null): { previous: TrackFeatures | null; sessionEnergy: number | null; hour: number; offlineOnly: boolean } {
    return {
      previous: currentTrackId ? this.featureById.get(currentTrackId) ?? null : null,
      sessionEnergy: sessionEnergy(this.session, this.featureById),
      hour: new Date(this.now()).getHours(),
      // Everything the engine can offer is already on this computer, so this is never a restriction in practice.
      offlineOnly: true
    }
  }

  /**
   * What should play next, and why.
   *
   * The whole pass: work out what is wanted, choose a way of choosing, gather candidates from every direction, rank
   * them in stages, then arrange the best few into a run that goes somewhere. `length` of one is "the next track";
   * more is a plan.
   */
  plan(o: { currentTrackId: string | null; recentTrackIds: readonly string[]; length?: number; exclude?: Iterable<string>; said?: string }): Plan {
    const now = this.now()
    const notUnderstood: string[] = []
    if (o.said) {
      const parsed = this.request(o.said)
      notUnderstood.push(...parsed.notUnderstood)
    }
    const intent = this.intentNow()
    const key = contextKey(intent.intent, new Date(now).getHours(), this.session.quality)
    const preferred = STRATEGY_FOR_INTENT[intent.intent]
    const { strategy } = chooseStrategy(this.strategies, key, preferred, this.tuning.exploration.value, this.random)

    const exclude = new Set<string>([...(o.exclude ?? []), ...o.recentTrackIds.slice(0, 5)])
    const seed = o.currentTrackId ? this.featureById.get(o.currentTrackId) ?? null : null
    const pool = generate({
      library: this.library,
      graph: this.graph,
      taste: this.taste,
      intent,
      seed,
      exclude,
      strategy,
      now
    })

    const known = knownFrom(this.library)
    const context = this.contextFor(o.currentTrackId)
    const ranked = rank(pool.candidates, {
      taste: this.taste,
      models: this.models,
      intent,
      context,
      known,
      recent: { trackIds: [...o.recentTrackIds], artistKeys: o.recentTrackIds.map((id) => this.featureById.get(id)?.artistKey ?? '').filter(Boolean), genres: [] },
      tuning: this.tuning,
      now
    })

    const length = Math.max(1, Math.min(o.length ?? 1, this.tuning.horizon.value))
    const curve = curveFor(intent, this.tuning, context.previous?.audio?.energy ?? context.sessionEnergy)
    const planned = planRun(ranked.chosen, { previous: context.previous, curve, known: known.playedTrackIds, length })

    const byId = new Map(this.library.features.map((one) => [one.trackId, one]))
    const tracks: NextChoice[] = []
    for (const one of planned.run) {
      const features = byId.get(one.trackId)
      if (!features) continue
      this.chosenBy.set(one.trackId, strategy)
      tracks.push({
        // The caller turns the id back into a row; the engine deals in features.
        track: { id: one.trackId } as OrbisTrack,
        because: one.because,
        strategy,
        inspect: { score: one.score, parts: one.parts, predictions: one.predictions, novelty: one.novelty, sources: one.sources, confidence: one.confidence }
      })
    }
    return { tracks, energy: planned.energy, notes: planned.notes, intent, notUnderstood }
  }

  /** The inspector's view of the last pass, for the developer panel. Nothing here is shown to an ordinary person. */
  inspect(o: { currentTrackId: string | null; recentTrackIds: readonly string[] }): {
    intent: IntentState
    strategy: string
    tuning: MusicTuning
    session: MusicSession
    candidates: { trackId: string; sources: string[]; score: number; parts: Scored['parts']; predictions: Scored['predictions'] }[]
    rejected: { trackId: string; why: string }[]
    weights: Record<string, number>
    measurement: { measured: number; total: number; unmeasurable: number; working: boolean }
    models: { skip: number; complete: number; replay: number; favourite: number }
  } {
    const now = this.now()
    const intent = this.intentNow()
    const key = contextKey(intent.intent, new Date(now).getHours(), this.session.quality)
    const { strategy, why } = chooseStrategy(this.strategies, key, STRATEGY_FOR_INTENT[intent.intent], 0, () => 1)
    const seed = o.currentTrackId ? this.featureById.get(o.currentTrackId) ?? null : null
    const pool = generate({ library: this.library, graph: this.graph, taste: this.taste, intent, seed, exclude: new Set(o.recentTrackIds), strategy, now })
    const ranked = rank(pool.candidates, {
      taste: this.taste,
      models: this.models,
      intent,
      context: this.contextFor(o.currentTrackId),
      known: knownFrom(this.library),
      recent: { trackIds: [...o.recentTrackIds], artistKeys: [], genres: [] },
      tuning: this.tuning,
      now
    })
    return {
      intent,
      strategy: `${strategy} (${why})`,
      tuning: this.tuning,
      session: this.session,
      candidates: ranked.chosen.map((one) => ({ trackId: one.trackId, sources: one.sources, score: one.score, parts: one.parts, predictions: one.predictions })),
      rejected: ranked.rejected.slice(0, 40),
      weights: ranked.weights,
      measurement: this.measurement,
      models: { skip: this.models.skip.seen, complete: this.models.complete.seen, replay: this.models.replay.seen, favourite: this.models.favourite.seen }
    }
  }

  // ---------------------------------------------------------------- learning from what happened

  /**
   * One thing that happened, folded into everything.
   *
   * This is the only way the models change. Every call moves the taste layers, the outcome models, the sitting, the
   * strategy's credit and the tunable numbers -- which is what makes the loop a loop rather than a diagram.
   */
  observe(event: MusicEvent): void {
    const features = this.featureById.get(event.trackId)
    if (!features) return
    if (!isSameSession(this.session, event.at)) {
      this.session = newMusicSession(`s-${event.at.toString(36)}`, event.at)
      this.taste = newTasteSession(this.taste)
    }
    const strategy = this.chosenBy.get(event.trackId)

    // What was going well, for working out what a skip meant.
    const liked = this.session.tracks
      .filter((one) => one.outcome === 'completed')
      .map((one) => this.featureById.get(one.trackId))
      .filter((one): one is TrackFeatures => Boolean(one))
      .slice(-8)

    if (event.kind === 'skipped-early' || event.kind === 'skipped-late') this.taste = learnFromSkip(this.taste, event, features, liked)
    else this.taste = learn(this.taste, event, features)

    // The outcome models, from the same event.
    const candidate: Candidate = {
      trackId: event.trackId,
      features,
      sources: [],
      retrieval: 0.5,
      lastPlayedDaysAgo: null,
      playCount: this.library.stats.get(event.trackId)?.playCount ?? 0,
      favourite: this.library.stats.get(event.trackId)?.favourite ?? false,
      everCompleted: this.library.stats.get(event.trackId)?.everCompleted ?? false
    }
    const modelInput = modelFeatures(candidate, this.taste, this.intentNow(), event.at)
    switch (event.kind) {
      case 'completed':
        this.models = learnOutcome(this.models, 'complete', modelInput, true)
        this.models = learnOutcome(this.models, 'skip', modelInput, false)
        break
      case 'skipped-early':
      case 'skipped-late':
        this.models = learnOutcome(this.models, 'skip', modelInput, true)
        this.models = learnOutcome(this.models, 'complete', modelInput, false)
        break
      case 'replayed':
        this.models = learnOutcome(this.models, 'replay', modelInput, true)
        break
      case 'favourited':
        this.models = learnOutcome(this.models, 'favourite', modelInput, true)
        break
      case 'unfavourited':
        this.models = learnOutcome(this.models, 'favourite', modelInput, false)
        break
      default:
        break
    }

    this.session = recordSession(this.session, event, features.audio?.energy ?? null, strategy)

    // Whether a suggestion of something new was taken, which is how the discovery appetite is learned.
    const wasNew = (this.library.stats.get(event.trackId)?.playCount ?? 0) <= 1
    if (event.chosenBy === 'orbis' && wasNew) {
      const accepted = event.kind === 'completed' || event.kind === 'favourited' || event.kind === 'replayed' || event.kind === 'played-half'
      const refused = event.kind === 'skipped-early'
      if (accepted || refused) {
        this.session = recordDiscovery(this.session, accepted)
        this.taste = learnDiscoveryAppetite(this.taste, accepted, event.at)
      }
    }

    // The strategy that chose it is credited with what happened.
    if (strategy && ['completed', 'skipped-early', 'skipped-late', 'favourited', 'replayed', 'added-to-playlist'].includes(event.kind)) {
      const outcome = event.kind === 'completed' ? 'completed' : event.kind === 'skipped-early' ? 'skipped-early' : event.kind === 'skipped-late' ? 'skipped-late' : 'completed'
      const reward = rewardOf(outcome, {
        favourited: event.kind === 'favourited',
        replayed: event.kind === 'replayed',
        addedToPlaylist: event.kind === 'added-to-playlist'
      })
      const key = contextKey(this.intentNow().intent, new Date(event.at).getHours(), this.session.quality)
      this.strategies = creditStrategy(this.strategies, key, strategy, reward, event.at)
    }

    this.tuning = adapt(this.tuning, this.session)
    this.touch()
  }

  /** A listen that has finished, turned into the right event. */
  observeListen(trackId: string, seconds: number, duration: number, stopped: 'ended' | 'skipped', chosenBy: 'person' | 'orbis'): void {
    this.observe({ kind: listenEvent(seconds, duration, stopped), trackId, at: this.now(), seconds, duration, chosenBy })
  }

  /** Something said outright about one thing: "never this artist", "more like this genre". */
  say(dimension: TasteDimension, name: string, value: number): void {
    this.taste = stateTaste(this.taste, dimension, name, value, this.now())
    this.touch()
  }

  /** Forgets one opinion entirely, in every layer. */
  forgetAbout(dimension: TasteDimension, name: string): void {
    this.taste = forget(this.taste, dimension, name)
    this.touch()
  }

  // ---------------------------------------------------------------- what somebody can see

  dna(): ReturnType<typeof musicDna> {
    return musicDna(this.taste)
  }

  exploration(): ReturnType<typeof explorationMap> {
    return explorationMap(this.library, this.taste, this.now())
  }

  sessionNow(): MusicSession {
    return this.session
  }

  tuningNow(): MusicTuning {
    return this.tuning
  }

  /** How much Orbis thinks it knows, so an interface can be honest about a thin profile. */
  confidence(): { events: number; measured: number; trackCount: number; ready: boolean } {
    const measured = this.library.features.filter((one) => one.audio).length
    return {
      events: this.taste.counts.events,
      measured,
      trackCount: this.library.features.length,
      // Below this there is not enough to personalise with, and saying so is better than pretending.
      ready: this.taste.counts.events >= 10
    }
  }

  /** How much a track is wanted, for showing a reason beside it. */
  affinityFor(trackId: string): { score: number; confidence: number; because: { dimension: string; name: string; value: number }[] } | null {
    const features = this.featureById.get(trackId)
    if (!features) return null
    const answer = affinity(this.taste, features, this.now())
    return { score: answer.score, confidence: answer.confidence, because: answer.because.map((one) => ({ dimension: one.dimension, name: one.name, value: one.value })) }
  }

  /** Whether there are enough tracks to satisfy a request, before promising a playlist. */
  enoughFor(constraints: Constraints): { found: number; needed: number; enough: boolean } {
    const found = matching(this.library, constraints, knownFrom(this.library)).length
    const needed = constraints.count ?? (constraints.duration ? Math.ceil(constraints.duration / 240) : 10)
    return { found, needed, enough: found >= needed }
  }

  /** Starts a fresh sitting by hand, which is what "reset this session" means. */
  resetSession(): void {
    this.session = newMusicSession(`s-${this.now().toString(36)}`, this.now())
    this.taste = newTasteSession(this.taste)
    this.stated = null
    this.chosenBy.clear()
    this.touch()
  }

  /** Forgets what has been learned, at the scope asked for. Never touches the library or the files. */
  reset(scope: 'session' | 'recent' | 'recommendations' | 'everything'): void {
    switch (scope) {
      case 'session':
        this.resetSession()
        break
      case 'recent':
        this.taste = { ...this.taste, recent: emptyTaste().recent }
        break
      case 'recommendations':
        this.models = emptyModels()
        this.strategies = emptyStrategyMemory()
        this.tuning = startingTuning()
        break
      case 'everything':
        this.taste = emptyTaste()
        this.models = emptyModels()
        this.strategies = emptyStrategyMemory()
        this.tuning = startingTuning()
        break
    }
    this.touch()
  }

  /** The measurements, kept, because they are about the music rather than about the person. */
  featuresOfTrack(trackId: string): AudioFeatures | null {
    return this.measured.get(trackId) ?? null
  }

  // ---------------------------------------------------------------- the queue

  /**
   * Replaces the part of the queue Orbis owns with a freshly planned run.
   *
   * What somebody added or pinned is untouched, which is the rule that makes an adaptive queue bearable.
   */
  requeue(queue: readonly QueueEntry[], o: { currentTrackId: string | null; recentTrackIds: readonly string[] }): QueueEntry[] {
    const slots = queue.filter((one) => one.origin === 'orbis' || one.origin === 'discovery').length
    if (slots === 0) return [...queue]
    const planned = this.plan({ ...o, length: slots, exclude: queue.map((one) => one.trackId) })
    const replacement: QueueEntry[] = planned.tracks.map((one) => ({
      trackId: one.track.id,
      origin: (one.inspect.novelty.neverPlayed ? 'discovery' : 'orbis') as QueueOrigin,
      because: one.because
    }))
    return reflow(queue, replacement)
  }
}
