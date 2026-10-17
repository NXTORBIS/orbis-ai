import { CATALOGUE, parametersFor } from '../../shared/native/catalogue.ts'
import { DATASETS, SqlLab, type QueryResult, type Schema, type SqlProblem } from './sql.ts'
import { PHASE2_CATALOGUE, PHASE2_PARAMETERS } from '../../shared/native/phase2.ts'
import { PHASE3_CATALOGUE, PHASE3_PARAMETERS } from '../../shared/native/phase3.ts'
import { PHASE4_CATALOGUE, PHASE4_PARAMETERS } from '../../shared/native/phase4.ts'
import { PHASE5_CATALOGUE, PHASE5_PARAMETERS } from '../../shared/native/phase5.ts'
import { PHASE6_CATALOGUE, PHASE6_PARAMETERS } from '../../shared/native/phase6.ts'
import { PHASE7_CATALOGUE, PHASE7_PARAMETERS } from '../../shared/native/phase7.ts'
import { PHASE8_CATALOGUE, PHASE8_PARAMETERS } from '../../shared/native/phase8.ts'
import { PHASE9_CATALOGUE, PHASE9_PARAMETERS } from '../../shared/native/phase9.ts'
import { PHASE10_CATALOGUE, PHASE10_PARAMETERS } from '../../shared/native/phase10.ts'
import { PHASE11_CATALOGUE, PHASE11_PARAMETERS } from '../../shared/native/phase11.ts'
import { PHASE12_CATALOGUE } from '../../shared/native/phase12.ts'
import {
  EMPTY,
  allApps,
  appById,
  capabilities as capabilityList,
  consumersOf,
  discover,
  isRegistryError,
  launchable,
  registerAll,
  resolve,
  type DiscoveryContext,
  type Hit,
  type Readiness,
  type Registry
} from '../../shared/native/registry.ts'
import {
  accepts,
  add,
  close as closeInstance,
  configure as configureInstance,
  diagnose,
  effort,
  failed,
  find,
  inConversation,
  isInstanceError,
  onScreen as setOnScreen,
  open as openInstance,
  pause as pauseInstance,
  ready as readyInstance,
  replace,
  reset as resetInstance,
  resize as resizeInstance,
  run as runInstance,
  store as storeInstance,
  sweep as sweepInstances,
  whyRejected,
  type Instance,
  type InstanceFailure,
  type InstanceError,
  type Instances
} from '../../shared/native/instances.ts'
import { describe as describeParameter, values as parameterValues, visible as visibleParameters } from '../../shared/native/parameters.ts'
import { plan, readAction, isRefusal, offer, type Action, type ActionResult, type Plan } from '../../shared/native/actions.ts'
import { cardState, mounted, movedOn, reuseOrOpen, type CardFacts, type CardState } from '../../shared/native/chat.ts'
import { describeRestore, read as readState, restore, write as writeState } from '../../shared/native/state.ts'
import type { AppSize, NativeAppManifest } from '../../shared/native/manifest.ts'
import type { NativeStore } from './store.ts'

/**
 * The Native App runtime.
 *
 * ## What this owns, and what it deliberately does not
 *
 * It owns the registry, the instances, their lifecycle, their persistence and the dispatch of Orion's actions. It owns
 * no domain logic whatsoever: there is no branch in this file that knows what gravity is, and adding Phase 3's
 * chemistry engine will not add one. Everything specific to an app lives in the app and in the engines under
 * `shared/compute`, which this file never calls.
 *
 * That boundary is the thing that makes Phase 2 and Phase 3 additive. A runtime with `if (appId === 'physics')` in it
 * is a runtime that has to be edited for every app ever added, which is the architecture §186 of the brief rejects by
 * name.
 *
 * ## Nothing claims success it did not have
 *
 * Every method returns what actually happened. `save` says saved only after the store wrote it; `openApp` says the
 * values it actually applied; a refused action comes back as a refusal with the reason, never as a quiet no-op. Orion
 * repeats these sentences to the user, so a cheerful fiction here becomes a lie on screen.
 *
 * ## Late results are dropped, loudly in the log and silently on screen
 *
 * `applyResult` checks the generation. A worker finishing after a reset is discarded and noted; it never writes a
 * number from the old configuration into the new one.
 */

export interface NativeDeps {
  store: NativeStore
  now(): number
  /** A fresh id. Supplied, so tests are deterministic. */
  newId(prefix: string): string
  /** What this machine and build can provide. Asked for each time, because it can change. */
  readiness(): Readiness
  /** Tells the renderer something changed. */
  announce?(what: string, detail: unknown): void
  /** Lets Ambient Intelligence know what somebody is working on, through its own door. */
  onActivity?(appName: string, appId: string, instanceId: string): void
}

export interface OpenOutcome {
  ok: true
  instance: PublicInstance
  /** True when an app already open in this conversation was used instead of a second one. */
  reused: boolean
  applied: readonly string[]
  says: string
}

/** An instance as the renderer and Orion see it. No internal objects, no parameter definitions it cannot use. */
export interface PublicInstance {
  id: string
  appId: string
  appName: string
  appVersion: number
  surface: NativeAppManifest['surface']
  phase: string
  generation: number
  size: AppSize
  conversationId: string | null
  messageId: string | null
  /** Parameter values, by id. */
  values: Readonly<Record<string, string | number | boolean | readonly number[]>>
  /** Which parameters a panel should currently show. */
  shown: readonly string[]
  /** Each parameter in words, for a summary line. */
  described: Readonly<Record<string, string>>
  /**
   * Enough of each parameter's definition for a panel to render a control for it.
   *
   * Added for Phase 2, which is the first thing to need it: an app whose controls are declared parameters cannot draw
   * a slider without knowing the range, or a dropdown without the options. Values alone were enough while every app
   * kept its own inputs.
   *
   * Deliberately not the whole `Parameter`: no `initial`, no `from`, no `shownWhen` — the runtime has already worked
   * out what is visible and put it in `shown`, and a renderer that re-derived it could disagree.
   */
  definitions: readonly {
    id: string
    name: string
    kind: string
    about: string
    unit?: string
    least?: number
    most?: number
    step?: number
    places?: number
    options?: readonly { id: string; label: string }[]
    group?: string
    /** True when it is worked out from others and cannot be set directly. */
    derived: boolean
  }[]
  domain: Readonly<Record<string, unknown>>
  failure: InstanceFailure | null
  experimentId: string | null
  effort: 'full' | 'reduced' | 'none'
  openedAt: number
  touchedAt: number
}

/**
 * The parameter set for an app, from whichever catalogue declares it.
 *
 * One lookup rather than two, so nothing downstream has to know which phase an app came from -- and an app with no
 * declared parameters gets an empty set rather than an error, which is the correct answer for the thirty-four that
 * keep their own inputs.
 */
const parametersOf = (appId: string): ReturnType<typeof parametersFor> => {
  if (Object.prototype.hasOwnProperty.call(PHASE2_PARAMETERS, appId)) return PHASE2_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE3_PARAMETERS, appId)) return PHASE3_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE4_PARAMETERS, appId)) return PHASE4_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE5_PARAMETERS, appId)) return PHASE5_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE6_PARAMETERS, appId)) return PHASE6_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE7_PARAMETERS, appId)) return PHASE7_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE8_PARAMETERS, appId)) return PHASE8_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE9_PARAMETERS, appId)) return PHASE9_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE10_PARAMETERS, appId)) return PHASE10_PARAMETERS[appId]
  if (Object.prototype.hasOwnProperty.call(PHASE11_PARAMETERS, appId)) return PHASE11_PARAMETERS[appId]
  return parametersFor(appId)
}

/** What the Database Laboratory offers to pick from, without its SQL. */
export interface DatasetChoice {
  id: string
  name: string
  about: string
  teaches: readonly string[]
}

export class Native {
  private readonly o: NativeDeps
  private registry: Registry = EMPTY
  private instances: Instances = Object.freeze({})
  /** Problems found registering the shipped catalogue. Empty in a correct build; reported rather than swallowed. */
  private readonly registrationProblems: string[] = []

  constructor(deps: NativeDeps) {
    this.o = deps
    /*
     * The adopted laboratories and the built environments, registered together.
     *
     * One registry, so Search Labs and Orion rank a Phase 1 Page and a Phase 2 application against each other
     * rather than looking in two places. The registry refuses a duplicate id or a duplicate surface, so the join is
     * checked rather than assumed.
     */
    const made = registerAll(EMPTY, [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE, ...PHASE12_CATALOGUE], deps.now())
    if (isRegistryError(made)) {
      // A bad catalogue is a programming error. Orbis still starts — with no Native Apps — rather than failing to open,
      // and the reason is kept so the health check and the developer panel can say what is wrong.
      this.registrationProblems.push(made.message)
    } else {
      this.registry = made
    }
  }

  // ---------------------------------------------------------------- the catalogue

  /** Every app, with whether it can actually open. One list, which both Search Labs and Orion read. */
  async catalogue(): Promise<
    readonly {
      id: string
      name: string
      summary: string
      domain: string
      icon: string
      /*
       * The words somebody is likely to use for it, and what it says it will not do.
       *
       * Sent because the screen that lists the laboratories searches by tag and prints the first limitation on each
       * card -- it always did, and until now the catalogue did not carry either, so the search quietly looked at
       * nothing and the line never drew. The aliases are here for the same reason: "the projectile motion lab" is
       * what somebody asks for, and only the manifest knows that is `projectile-lab`.
       */
      aliases: readonly string[]
      tags: readonly string[]
      limitations: readonly string[]
      capabilities: readonly string[]
      blocked: string | null
    }[]
  > {
    const readiness = await this.readinessNow()
    return allApps(this.registry).map((manifest) => {
      const can = launchable(manifest, readiness)
      return {
        id: manifest.id,
        name: manifest.name,
        summary: manifest.summary,
        domain: manifest.domain,
        icon: manifest.icon,
        aliases: manifest.aliases,
        tags: manifest.tags,
        limitations: manifest.limitations,
        capabilities: manifest.capabilities.map((one) => one.id),
        blocked: can.ok ? null : (can.blocked?.says ?? 'It cannot open here.')
      }
    })
  }

  /** The capability vocabulary as it actually stands. */
  capabilities(): readonly { id: string; summary: string; apps: number }[] {
    return capabilityList(this.registry)
  }

  /**
   * Search Labs and Orion's own search, which are the same function.
   *
   * Recency comes from the store rather than from the caller, so the composer does not have to hold it and the two
   * doors cannot rank differently.
   */
  async find(query: string, context: Omit<DiscoveryContext, 'recent'> = {}): Promise<readonly SearchRow[]> {
    const [readiness, recent] = await Promise.all([this.readinessNow(), this.o.store.recentApps()])
    const hits = discover(this.registry, query, readiness, { ...context, recent: recent.map((one) => one.id) })
    return hits.slice(0, 40).map((one) => this.row(one, recent))
  }

  private row(hit: Hit, recent: readonly { id: string; at: number }[]): SearchRow {
    const used = recent.find((one) => one.id === hit.manifest.id)
    return {
      id: hit.manifest.id,
      name: hit.manifest.name,
      summary: hit.manifest.summary,
      domain: hit.manifest.domain,
      icon: hit.manifest.icon,
      because: hit.because,
      blocked: hit.blocked?.says ?? null,
      lastUsed: used?.at ?? null,
      opensAt: hit.manifest.opensAt
    }
  }

  // ---------------------------------------------------------------- opening

  /**
   * An app opened in a conversation.
   *
   * Reuses one already open in the same conversation unless values were asked for, because the two wrong answers are
   * both bad: a second card claiming to be the same thing, or a mutated experiment somebody was comparing against.
   */
  async openApp(request: {
    appId?: string
    capability?: string
    conversationId?: string | null
    messageId?: string | null
    configure?: Record<string, unknown>
    size?: AppSize
  }): Promise<OpenOutcome | ActionResult> {
    const readiness = await this.readinessNow()
    const recent = await this.o.store.recentApps()

    let manifest: NativeAppManifest | null = null
    if (request.appId) manifest = appById(this.registry, request.appId)
    else if (request.capability) manifest = resolve(this.registry, request.capability, readiness, { recent: recent.map((one) => one.id) })

    if (!manifest) {
      return {
        ok: false,
        says: request.capability
          ? `Nothing in Orbis can do that yet, so there is no app to open.`
          : `There is no app called "${String(request.appId)}".`,
        failure: { error: 'unknown-app', says: 'That app is not part of this build of Orbis.' }
      }
    }

    const can = launchable(manifest, readiness)
    if (!can.ok) {
      return {
        ok: false,
        says: can.blocked?.says ?? `${manifest.name} cannot be opened right now.`,
        failure: { error: can.blocked?.why ?? 'unavailable', says: can.blocked?.says ?? '', recovery: 'Nothing has been changed.' }
      }
    }

    const conversationId = request.conversationId ?? null
    const decision = reuseOrOpen(
      Object.values(this.instances).map((one) => ({
        instanceId: one.id,
        appId: one.appId,
        conversationId: one.conversationId,
        phase: one.phase
      })),
      { appId: manifest.id, conversationId, configure: request.configure }
    )

    if ('reuse' in decision) {
      const held = find(this.instances, decision.reuse)
      if (held) {
        await this.o.store.noteUse(manifest.id, this.o.now())
        return { ok: true, instance: this.publish(held, manifest), reused: true, applied: [], says: `${manifest.name} is already open here.` }
      }
    }

    const made = openInstance({
      id: this.o.newId('na'),
      manifest,
      parameters: parametersOf(manifest.id),
      conversationId,
      messageId: request.messageId ?? null,
      configure: request.configure,
      size: request.size,
      now: this.o.now()
    })

    if (isInstanceError(made)) {
      return {
        ok: false,
        says: made.message,
        failure: { error: made.error, says: made.message, recovery: 'Nothing has been opened.' },
        ...(made.problems ? { warnings: made.problems.map((one) => `${one.says} ${one.fix}`) } : {})
      }
    }

    const held = add(this.instances, made)
    if (isInstanceError(held)) {
      return { ok: false, says: held.message, failure: { error: held.error, says: held.message, recovery: 'Close an app and try again.' } }
    }
    this.instances = held

    await this.o.store.noteUse(manifest.id, this.o.now())
    await this.persist(made, manifest)
    this.o.onActivity?.(manifest.name, manifest.id, made.id)
    this.o.announce?.('native:opened', { instanceId: made.id, appId: manifest.id, conversationId })

    const applied = Object.keys(request.configure ?? {})
    return {
      ok: true,
      instance: this.publish(made, manifest),
      reused: false,
      applied,
      says: applied.length > 0 ? `${manifest.name} is open with ${applied.join(', ')} set.` : `${manifest.name} is open.`
    }
  }

  /** The host saying the app has finished mounting. Until then it is `loading` and the card shows that. */
  async markReady(instanceId: string): Promise<PublicInstance | null> {
    return this.move(instanceId, (instance) => readyInstance(instance, this.o.now()))
  }

  // ---------------------------------------------------------------- lifecycle

  async run(instanceId: string): Promise<PublicInstance | null> {
    return this.move(instanceId, (instance) => runInstance(instance, this.o.now()))
  }

  async pause(instanceId: string): Promise<PublicInstance | null> {
    return this.move(instanceId, (instance) => pauseInstance(instance, this.o.now()))
  }

  async reset(instanceId: string): Promise<PublicInstance | null> {
    return this.move(instanceId, (instance) => resetInstance(instance, this.o.now()))
  }

  // ---------------------------------------------------------------- the Database Laboratory

  /**
   * One in-memory database per open laboratory, built lazily.
   *
   * Lazily because a conversation with no Database Laboratory in it should hold no databases, and these hold native
   * handles rather than plain objects. `closeDatabases` lets every one of them go at quit.
   */
  private sql: SqlLab | null = null

  private theSqlLab(): SqlLab {
    if (this.sql === null) this.sql = new SqlLab()
    return this.sql
  }

  /** The practice databases, without their fixture SQL — the renderer needs the names, not the rows. */
  sqlDatasets(): readonly DatasetChoice[] {
    return Object.freeze(
      DATASETS.map((one) => ({ id: one.id, name: one.name, about: one.about, teaches: one.teaches }))
    )
  }

  /** Gives a laboratory a fresh practice database, replacing whatever it held. */
  sqlLoad(instanceId: string, datasetId: string): Schema | SqlProblem {
    return this.theSqlLab().load(instanceId, datasetId)
  }

  /** Runs SQL for one laboratory. */
  sqlRun(instanceId: string, sql: string): QueryResult {
    return this.theSqlLab().run(instanceId, sql)
  }

  sqlSchema(instanceId: string): Schema | SqlProblem {
    return this.theSqlLab().schemaOf(instanceId)
  }

  /** Closes every database. Called at quit, because these hold native handles. */
  closeDatabases(): void {
    this.sql?.closeAll()
    this.sql = null
  }

  /**
   * An app closed.
   *
   * Its state is written first and kept, so the conversation's card can offer to reopen it rather than saying it is
   * gone. Closing has never been a way to lose work and must not become one.
   */
  async close(instanceId: string): Promise<PublicInstance | null> {
    // A closed laboratory keeps nothing. Without this, every opened Database Laboratory would hold its database for
    // the rest of the session.
    this.sql?.close(instanceId)
    const held = find(this.instances, instanceId)
    if (!held) return null
    const manifest = appById(this.registry, held.appId)
    const moved = closeInstance(held, this.o.now())
    if (isInstanceError(moved)) return this.publishOf(held)
    this.instances = replace(this.instances, moved)
    if (manifest) await this.persist(moved, manifest)
    this.instances = sweepInstances(this.instances)
    this.o.announce?.('native:closed', { instanceId, appId: held.appId })
    return this.publishOf(moved)
  }

  async resize(instanceId: string, size: AppSize): Promise<PublicInstance | null> {
    const held = find(this.instances, instanceId)
    if (!held) return null
    const manifest = appById(this.registry, held.appId)
    if (!manifest) return this.publishOf(held)
    return this.move(instanceId, (instance) => resizeInstance(instance, manifest, size, this.o.now()))
  }

  async setOnScreen(instanceId: string, visible: boolean): Promise<PublicInstance | null> {
    const held = find(this.instances, instanceId)
    if (!held) return null
    const manifest = appById(this.registry, held.appId)
    if (!manifest) return this.publishOf(held)
    return this.move(instanceId, (instance) => setOnScreen(instance, manifest, visible, this.o.now()))
  }

  /** An app that failed. Recorded rather than refused: the failure has already happened. */
  async fail(instanceId: string, failure: InstanceFailure): Promise<PublicInstance | null> {
    const held = find(this.instances, instanceId)
    if (!held) return null
    const moved = failed(held, failure, this.o.now())
    this.instances = replace(this.instances, moved)
    this.o.announce?.('native:failed', { instanceId, appId: held.appId, says: failure.says })
    return this.publishOf(moved)
  }

  private async move(instanceId: string, change: (instance: Instance) => Instance | InstanceError): Promise<PublicInstance | null> {
    const held = find(this.instances, instanceId)
    if (!held) return null
    const moved = change(held)
    if (isInstanceError(moved)) return this.publishOf(held)
    this.instances = replace(this.instances, moved)
    return this.publishOf(moved)
  }

  // ---------------------------------------------------------------- parameters and state

  /** Values set on an open app, all or nothing. */
  async configure(instanceId: string, values: Record<string, unknown>): Promise<{ instance: PublicInstance; changed: readonly string[] } | ActionResult> {
    const held = find(this.instances, instanceId)
    if (!held) return { ok: false, says: 'That app is not open any more.', failure: { error: 'unknown-instance', says: 'That app is not open any more.' } }

    const changed = configureInstance(held, values, this.o.now())
    if (isInstanceError(changed)) {
      return {
        ok: false,
        says: changed.message,
        failure: { error: changed.error, says: changed.message, recovery: 'Nothing was changed.' },
        ...(changed.problems ? { warnings: changed.problems.map((one) => `${one.says} ${one.fix}`) } : {})
      }
    }

    this.instances = replace(this.instances, changed.instance)
    const manifest = appById(this.registry, held.appId)
    if (manifest) await this.persist(changed.instance, manifest)
    if (changed.changed.length > 0) this.o.announce?.('native:changed', { instanceId, changed: changed.changed })
    return { instance: this.publishOf(changed.instance)!, changed: changed.changed }
  }

  /** The app's own state kept. Written through so a restart restores it. */
  async storeState(instanceId: string, domain: Record<string, unknown>): Promise<PublicInstance | null> {
    const held = find(this.instances, instanceId)
    if (!held) return null
    const moved = storeInstance(held, domain, this.o.now())
    if (isInstanceError(moved)) return this.publishOf(held)
    this.instances = replace(this.instances, moved)
    const manifest = appById(this.registry, held.appId)
    if (manifest) await this.persist(moved, manifest)
    return this.publishOf(moved)
  }

  /**
   * A result from an engine or a worker, applied only if it still belongs here.
   *
   * The generation check is the whole point. A result from before a reset is dropped and noted, never written.
   */
  async applyResult(instanceId: string, generation: number, domain: Record<string, unknown>): Promise<{ applied: boolean; why?: string }> {
    const held = find(this.instances, instanceId)
    if (!held) return { applied: false, why: 'That app is not open any more.' }
    if (!accepts(held, generation)) {
      const why = whyRejected(held, generation) ?? 'The result no longer applies.'
      // Logged, because a developer looking at a missing update needs to see that it was dropped on purpose.
      console.log(`[native] ${why}`)
      return { applied: false, why }
    }
    await this.storeState(instanceId, domain)
    return { applied: true }
  }

  // ---------------------------------------------------------------- reading

  instance(instanceId: string): PublicInstance | null {
    return this.publishOf(find(this.instances, instanceId))
  }

  conversation(conversationId: string): readonly PublicInstance[] {
    return inConversation(this.instances, conversationId)
      .map((one) => this.publishOf(one))
      .filter((one): one is PublicInstance => one !== null)
  }

  /** Which of a conversation's apps the chat should actually mount. */
  shouldMount(conversationId: string): readonly string[] {
    return mounted(
      inConversation(this.instances, conversationId).map((one) => ({ instanceId: one.id, phase: one.phase, touchedAt: one.touchedAt }))
    )
  }

  /**
   * What a card in the conversation should render, for one reference.
   *
   * Decided here rather than in the renderer so there is one answer. A card that has to work out whether an app was
   * closed, swept or retired is four components each deciding differently.
   */
  card(reference: { appId: string; instanceId: string; appVersion: number }): { state: CardState; note: string | null; name: string } {
    const manifest = appById(this.registry, reference.appId)
    const held = find(this.instances, reference.instanceId)
    const facts: CardFacts | null = held
      ? {
          exists: true,
          phase: held.phase,
          appVersion: held.appVersion,
          size: held.size,
          failure: held.failure ? { says: held.failure.says, recovery: held.failure.recovery } : null,
          persists: manifest?.persists ?? false
        }
      : null
    return {
      state: cardState(facts, manifest !== null),
      note: manifest ? movedOn({ ...reference, act: 'opened', did: [], openedAt: manifest.opensAt }, manifest.version) : null,
      name: manifest?.name ?? reference.appId
    }
  }

  // ---------------------------------------------------------------- Orion

  /** The catalogue as Orion is shown it: ids, names and capability ids. Nothing more. */
  async offerToOrion(): Promise<readonly { id: string; name: string; can: readonly string[]; summary: string }[]> {
    return offer(this.registry, await this.readinessNow())
  }

  /**
   * An action from Orion, checked and then carried out.
   *
   * Four gates — shape, existence, declaration, permission — and then dispatch. Each refusal names which gate, so what
   * Orion tells the user is accurate rather than "that did not work".
   */
  async act(raw: unknown): Promise<ActionResult> {
    const action = readAction(raw)
    if (isRefusal(action)) return { ok: false, says: action.says, failure: { error: action.error, says: action.says } }

    const readiness = await this.readinessNow()
    const recent = await this.o.store.recentApps()
    const checked = plan(
      action,
      this.registry,
      readiness,
      Object.values(this.instances).map((one) => ({ id: one.id, appId: one.appId, phase: one.phase })),
      { recent: recent.map((one) => one.id) }
    )
    if (isRefusal(checked)) return { ok: false, says: checked.says, failure: { error: checked.error, says: checked.says } }

    return this.carryOut(checked)
  }

  /**
   * What an action would do, without doing it.
   *
   * Used for the confirmation the host shows before anything destructive, so the description somebody approves is the
   * one that was validated rather than a second sentence written beside it.
   */
  async preview(raw: unknown): Promise<{ ok: true; describes: string; confirm: boolean } | ActionResult> {
    const action = readAction(raw)
    if (isRefusal(action)) return { ok: false, says: action.says, failure: { error: action.error, says: action.says } }
    const readiness = await this.readinessNow()
    const checked = plan(
      action,
      this.registry,
      readiness,
      Object.values(this.instances).map((one) => ({ id: one.id, appId: one.appId, phase: one.phase }))
    )
    if (isRefusal(checked)) return { ok: false, says: checked.says, failure: { error: checked.error, says: checked.says } }
    return { ok: true, describes: checked.describes, confirm: checked.confirm }
  }

  private async carryOut(checked: Plan): Promise<ActionResult> {
    const action: Action = checked.action

    switch (action.kind) {
      case 'find': {
        const hits = await this.find(action.query)
        return {
          ok: true,
          says: hits.length === 0 ? `Nothing in Orbis matches "${action.query}".` : `${hits.length} ${hits.length === 1 ? 'app' : 'apps'} match "${action.query}".`,
          data: hits.slice(0, 8).map((one) => ({ id: one.id, kind: 'app', label: one.name }))
        }
      }
      case 'open': {
        const made = await this.openApp({
          appId: action.appId,
          capability: action.capability,
          conversationId: action.conversationId ?? null,
          configure: action.configure,
          size: action.size
        })
        // Narrowed on the field rather than on `ok`: both shapes carry `ok`, and only an opened app carries an instance.
        if (!('instance' in made)) return made
        return { ok: true, says: made.says, instanceId: made.instance.id }
      }
      case 'configure': {
        const made = await this.configure(action.instanceId, action.values)
        if ('ok' in made) return made
        return {
          ok: true,
          says: made.changed.length === 0 ? 'Those were already the values.' : `Set ${made.changed.join(', ')}.`,
          instanceId: action.instanceId,
          measurements: made.changed.map((id) => ({ id, label: id, value: made.instance.described[id] ?? '' }))
        }
      }
      case 'run':
      case 'pause':
      case 'reset':
      case 'close': {
        const after =
          action.kind === 'run'
            ? await this.run(action.instanceId)
            : action.kind === 'pause'
              ? await this.pause(action.instanceId)
              : action.kind === 'reset'
                ? await this.reset(action.instanceId)
                : await this.close(action.instanceId)
        if (!after) return { ok: false, says: 'That app is not open any more.', failure: { error: 'unknown-instance', says: 'That app is not open any more.' } }
        return { ok: true, says: checked.describes, instanceId: action.instanceId }
      }
      case 'resize': {
        const after = await this.resize(action.instanceId, action.size)
        if (!after) return { ok: false, says: 'That app is not open any more.', failure: { error: 'unknown-instance', says: 'That app is not open any more.' } }
        return { ok: true, says: checked.describes, instanceId: action.instanceId }
      }
      case 'state': {
        const held = this.instance(action.instanceId)
        if (!held) return { ok: false, says: 'That app is not open any more.', failure: { error: 'unknown-instance', says: 'That app is not open any more.' } }
        const measurements = Object.entries(held.described).map(([id, value]) => ({ id, label: id, value }))
        return {
          ok: true,
          says: `${held.appName} is ${held.phase}.`,
          instanceId: held.id,
          measurements: action.detail === 'full' ? measurements : measurements.slice(0, 12)
        }
      }
      case 'save': {
        const held = find(this.instances, action.instanceId)
        const manifest = held ? appById(this.registry, held.appId) : null
        if (!held || !manifest) {
          return { ok: false, says: 'That app is not open any more.', failure: { error: 'unknown-instance', says: 'That app is not open any more.' } }
        }
        const written = await this.persist(held, manifest)
        // Said only after the store confirmed it. "Saved" when the write failed is the one message that must never be
        // wrong, because it is the one somebody closes the window on.
        if (!written) {
          return {
            ok: false,
            says: `${manifest.name} could not be saved, so nothing has been written.`,
            failure: { error: 'persistence', says: 'The file could not be written.', recovery: 'What is on screen is unchanged. Try again.' }
          }
        }
        return { ok: true, says: `${manifest.name} saved.`, instanceId: held.id }
      }
      case 'load': {
        const made = await this.restoreSaved(action.instanceId)
        if (!made.ok) return made
        return { ok: true, says: made.says, instanceId: action.instanceId, ...(made.warnings ? { warnings: made.warnings } : {}) }
      }
      case 'export':
        // Declared by four apps and carried out by the app itself; the runtime has no file writer of its own, and
        // inventing one here would put a second file path beside the Creation Engine's.
        return {
          ok: false,
          says: `Exporting is done from inside ${checked.manifest?.name ?? 'the app'} — its own export button writes the file.`,
          failure: { error: 'not-here', says: 'The runtime does not write files on an app’s behalf.' }
        }
      case 'invoke':
        // An app's own action is carried out in the renderer, where the app is. The runtime validated it and says so.
        return {
          ok: true,
          says: checked.describes,
          instanceId: action.instanceId,
          data: [{ id: action.action, kind: 'action', label: checked.declaration?.summary ?? action.action }]
        }
      default:
        return { ok: false, says: 'That is not something an app can be asked to do.', failure: { error: 'shape', says: 'Unknown action.' } }
    }
  }

  // ---------------------------------------------------------------- persistence

  /** True only when the store actually wrote it. */
  private async persist(instance: Instance, manifest: NativeAppManifest): Promise<boolean> {
    if (!manifest.persists) return true
    try {
      await this.o.store.save(writeState(instance, manifest, this.o.now()))
      return true
    } catch (error) {
      console.error('[native] could not save an app’s state', error)
      return false
    }
  }

  /**
   * A saved state read back into an open instance.
   *
   * Reports what it could not restore. A laboratory quietly running a starting value instead of a saved one is a
   * laboratory whose results cannot be attributed to anything.
   */
  async restoreSaved(instanceId: string): Promise<ActionResult> {
    const held = find(this.instances, instanceId)
    if (!held) return { ok: false, says: 'That app is not open any more.', failure: { error: 'unknown-instance', says: 'That app is not open any more.' } }
    const manifest = appById(this.registry, held.appId)
    if (!manifest) return { ok: false, says: 'That app is no longer part of this build.', failure: { error: 'unknown-app', says: 'Retired.' } }

    const saved = await this.o.store.saved(instanceId)
    const found = readState(saved, manifest)
    if (found.state === 'absent') {
      return { ok: false, says: `Nothing has been saved for ${manifest.name} yet.`, failure: { error: 'absent', says: 'There is no saved state.' } }
    }
    if (found.state === 'damaged') {
      return {
        ok: false,
        says: found.says,
        failure: { error: 'damaged', says: found.says, recovery: found.recovery }
      }
    }

    const restored = restore(found.saved, manifest, parametersOf(manifest.id), this.o.now())
    this.instances = replace(this.instances, { ...restored.instance, onScreen: held.onScreen, messageId: held.messageId, conversationId: held.conversationId })
    const note = describeRestore(restored)
    return {
      ok: true,
      says: note ? `${manifest.name} restored — ${note}` : `${manifest.name} restored.`,
      instanceId,
      ...(note ? { warnings: [note] } : {}),
      ...(found.note ? { warnings: [...(note ? [note] : []), found.note] } : {})
    }
  }

  /**
   * Saved instances put back on startup, as references rather than running apps.
   *
   * Restored `loading` and off screen, and never `running`: resuming an expensive computation nobody asked to resume
   * is how an app costs somebody a core at launch.
   */
  async restoreAll(): Promise<{ restored: number; damaged: readonly { appId: string; says: string }[] }> {
    const saved = await this.o.store.all()
    const damaged: { appId: string; says: string }[] = []
    let restored = 0

    for (const record of saved) {
      if (record.phase === 'closed') continue
      const manifest = appById(this.registry, record.appId)
      if (!manifest) continue
      const found = readState(record, manifest)
      if (found.state === 'damaged') {
        damaged.push({ appId: record.appId, says: found.says })
        continue
      }
      if (found.state !== 'ok') continue
      const made = restore(found.saved, manifest, parametersOf(manifest.id), this.o.now())
      const held = add(this.instances, made.instance)
      if (isInstanceError(held)) break
      this.instances = held
      restored += 1
    }

    if (damaged.length > 0) for (const one of damaged) console.error(`[native] ${one.appId}: ${one.says}`)
    return { restored, damaged }
  }

  // ---------------------------------------------------------------- settings and housekeeping

  async setCapabilityEnabled(capability: string, enabled: boolean): Promise<readonly string[]> {
    return this.o.store.setCapabilityEnabled(capability, enabled)
  }

  async recent(): Promise<readonly { id: string; name: string; at: number }[]> {
    const held = await this.o.store.recentApps()
    return held
      .map((one) => {
        const manifest = appById(this.registry, one.id)
        return manifest ? { id: one.id, name: manifest.name, at: one.at } : null
      })
      .filter((one): one is { id: string; name: string; at: number } => one !== null)
  }

  async clearRecent(): Promise<void> {
    await this.o.store.clearRecent()
  }

  /** Which apps could take what this one produces. The foundation for "analyse this somewhere else". */
  flowsFrom(appId: string): readonly { id: string; name: string }[] {
    return consumersOf(this.registry, appId).map((one) => ({ id: one.id, name: one.name }))
  }

  async useProfile(profileId: string): Promise<void> {
    // Everything open belongs to the profile that was active, so it goes before the files move. Nothing is carried
    // across: an instance left mounted would then be writing into the new profile's directory.
    for (const one of Object.values(this.instances)) {
      const manifest = appById(this.registry, one.appId)
      if (manifest && one.phase !== 'closed') await this.persist(one, manifest)
    }
    this.instances = Object.freeze({})
    await this.o.store.useProfile(profileId)
    this.o.announce?.('native:profile', { profileId })
  }

  /** What a developer panel shows. Never shown to anybody else. */
  async health(): Promise<Readonly<Record<string, string>>> {
    const readiness = await this.readinessNow()
    const open = Object.values(this.instances).filter((one) => one.phase !== 'closed')
    return Object.freeze({
      registry: this.registrationProblems.length === 0 ? `OK — ${allApps(this.registry).length} apps` : `PROBLEM — ${this.registrationProblems.join('; ')}`
      ,
      capabilities: String(this.capabilities().length),
      instances: `${open.length} open, ${Object.keys(this.instances).length} held`,
      running: String(open.filter((one) => one.phase === 'running').length),
      engines: readiness.engines.join(', ') || 'none',
      permissions: readiness.available.join(', '),
      profile: this.o.store.profile
    })
  }

  diagnostics(instanceId: string): Readonly<Record<string, string>> | null {
    const held = find(this.instances, instanceId)
    if (!held) return null
    return diagnose(held, appById(this.registry, held.appId))
  }

  async flush(): Promise<void> {
    for (const one of Object.values(this.instances)) {
      const manifest = appById(this.registry, one.appId)
      if (manifest && one.phase !== 'closed') await this.persist(one, manifest)
    }
    await this.o.store.flush()
  }

  /** Every running app stopped. Called when Orbis is quitting or the window is closing. */
  stopEverything(): void {
    for (const one of Object.values(this.instances)) {
      if (one.phase === 'running') {
        const moved = pauseInstance(one, this.o.now())
        if (!isInstanceError(moved)) this.instances = replace(this.instances, moved)
      }
    }
  }

  // ---------------------------------------------------------------- internals

  private async readinessNow(): Promise<Readiness> {
    const base = this.o.readiness()
    const disabled = await this.o.store.disabledCapabilities().catch(() => [])
    return { ...base, disabled }
  }

  private publishOf(instance: Instance | null): PublicInstance | null {
    if (!instance) return null
    const manifest = appById(this.registry, instance.appId)
    return manifest ? this.publish(instance, manifest) : null
  }

  private publish(instance: Instance, manifest: NativeAppManifest): PublicInstance {
    const described: Record<string, string> = {}
    const definitions: PublicInstance['definitions'][number][] = []
    for (const [id, one] of Object.entries(instance.parameters)) {
      described[id] = describeParameter(one)
      definitions.push({
        id,
        name: one.name,
        kind: one.kind,
        about: one.about,
        ...(one.unit !== undefined ? { unit: one.unit } : {}),
        ...(one.least !== undefined ? { least: one.least } : {}),
        ...(one.most !== undefined ? { most: one.most } : {}),
        ...(one.step !== undefined ? { step: one.step } : {}),
        ...(one.places !== undefined ? { places: one.places } : {}),
        ...(one.options ? { options: one.options.map((two) => ({ id: two.id, label: two.label })) } : {}),
        ...(one.group !== undefined ? { group: one.group } : {}),
        derived: (one.from ?? []).length > 0
      })
    }
    return {
      id: instance.id,
      appId: instance.appId,
      appName: manifest.name,
      appVersion: instance.appVersion,
      surface: manifest.surface,
      phase: instance.phase,
      generation: instance.generation,
      size: instance.size,
      conversationId: instance.conversationId,
      messageId: instance.messageId,
      values: parameterValues(instance.parameters),
      shown: visibleParameters(instance.parameters),
      described,
      definitions,
      domain: instance.domain,
      failure: instance.failure,
      experimentId: instance.experimentId,
      effort: effort(instance, manifest),
      openedAt: instance.openedAt,
      touchedAt: instance.touchedAt
    }
  }
}

export interface SearchRow {
  id: string
  name: string
  summary: string
  domain: string
  icon: string
  /** Why it matched, for the row's second line. */
  because: string
  /** Set when it cannot open. The row says so rather than failing on click. */
  blocked: string | null
  lastUsed: number | null
  opensAt: AppSize
}
