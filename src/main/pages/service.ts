import { randomUUID } from 'node:crypto'
import {
  decide,
  permissionSummary,
  type DecideInput,
  type PageTrust,
  type PermissionGrant,
  type Scope
} from '../../shared/pages/capabilities.ts'
import { versionToText } from '../../shared/pages/identity.ts'
import { compatibility, manifestToJson, type PageManifest } from '../../shared/pages/manifest.ts'
import {
  canOpen,
  emptyRegistry,
  listPages,
  pageById,

  registerPage,
  setFavourite,
  type PageRegistry,
  type RegisteredPage,
  type Resolution
} from '../../shared/pages/registry.ts'
import { BUILT_IN_MANIFESTS } from './builtins.ts'
import { BadInput, ENGINE_CAPABILITY, runEngineOperation } from './engines.ts'
import { EM_CAPABILITY, runEmOperation } from './emEngines.ts'
import { ENGINEERING_CAPABILITY, runEngineeringOperation } from './engineeringEngines.ts'
import { EARTH_CAPABILITY, runEarthOperation } from './earthEngines.ts'
import { HUMANITIES_CAPABILITY, runHumanitiesOperation } from './humanitiesEngines.ts'
import { MATH_CAPABILITY, runMathOperation } from './mathEngines.ts'
import { REASONING_CAPABILITY, runReasoningOperation } from './reasoningEngines.ts'
import { PHYSICS_CAPABILITY, runPhysicsOperation } from './physicsEngines.ts'
import { SCIENCE_CAPABILITY, runScienceOperation } from './scienceEngines.ts'
import { STUDY_CAPABILITY, runStudyOperation } from './studyEngines.ts'
import { audit, type ElementDescription } from '../../shared/pages/accessibility.ts'
import { check as checkDocument, type PageDocument } from '../../shared/pages/builder.ts'
import { classify, type Fault } from '../../shared/pages/diagnostics.ts'
import { packForExport, readPackage, type PackageEntry } from '../../shared/pages/packaging.ts'
import { pagesModule, type QueryIntent } from '../../shared/pages/search.ts'
import { planAnswer, presentAnswer } from '../../shared/pages/orion.ts'
import { isCompositionError, send, type Participant } from '../../shared/pages/composition.ts'
import type { PagesStore } from './store.ts'

import {
  compatibleUnits,
  convertQuantity,
  formatQuantity,
  isQuantityError,
  isUnitError,
  nameDimension,
  parseUnit,
  quantity,
  readDimension,
  type Quantity
} from '../../shared/compute/units.ts'
import {
  describeExpression,
  differentiate,
  evaluateExpression,
  expressionToText,
  isEvaluateError,
  isParseError,
  parseExpression,
  simplify,
  sizeOf,
  substitute,
  variablesOf
} from '../../shared/compute/expression.ts'
import {
  parseEquation,
  rearrangeFor,
  solveFor,
  solveLinearSystem,
  solutionSteps,
  unknownsOf,
  type Equation
} from '../../shared/compute/solver.ts'

/**
 * The Pages service: what exists, what may run, and the one door computation goes through.
 *
 * Two jobs, and the second is the important one.
 *
 * The first is holding the register. Orbis's own Pages are registered at start from the build, and a profile's decisions --
 * which are favourites, which are allowed what, what each Page has saved -- are layered on from the store. The register is
 * rebuilt rather than persisted, so a Page removed from a build cannot linger as an entry that resolves to nothing.
 *
 * The second is `run`. Every computation a Page performs arrives here, and every one is checked against the capability
 * system *before* the engine is called. That is what makes a declared capability mean something: there is no second path
 * to the unit engine or the solver, so a Page with no `computation.units` cannot convert anything, whatever its own code
 * believes. The check and the work happen in the same function for exactly that reason -- a check in one place and the work
 * in another is a check that eventually gets skipped.
 */

/** How much a single operation may be given. Bounded so one Page cannot make the main process unresponsive. */
const LIMITS = Object.freeze({
  expression: 2000,
  unit: 200,
  equations: 12,
  scopeEntries: 64,
  /** The most nodes a parsed expression may have before it is refused as too large to work with. */
  nodes: 4000,
  /** The range a scanning solver may be asked to sweep, and how finely. */
  samples: 50_000
})

export interface PagesServiceOptions {
  store: PagesStore
  profileId(): Promise<string>
  now?(): number
  /** Engines available in this build, for the compatibility check. */
  engines?: Record<string, { major: number; minor: number; patch: number }>
  /**
   * The Pages this profile built, with the document each one opens as.
   *
   * A hook rather than a store, so the service does not have to know where generated Pages are kept and a test can
   * hand it two. They are layered on in `withProfile` rather than in `start`, because a generated Page belongs to one
   * profile: registering them once at startup would put one person's Pages in front of another.
   */
  generated?(profileId: string): Promise<readonly { manifest: PageManifest; document: PageDocument }[]>
}

export interface ComputeRequest {
  pageId: string
  operation: string
  input: Record<string, unknown>
}

export type ComputeResult =
  | { ok: true; operation: string; value: unknown }
  | { ok: false; operation: string; error: string; message: string; capability?: string }

/** Which capability each operation needs. An operation missing from here cannot run -- deny by default, by construction. */
const OPERATION_CAPABILITY: Record<string, string> = {
  'units.parse': 'computation.units',
  'units.convert': 'computation.units',
  'units.compatible': 'computation.units',
  'expression.evaluate': 'computation.arithmetic',
  'expression.simplify': 'computation.arithmetic',
  'expression.differentiate': 'computation.arithmetic',
  'expression.substitute': 'computation.arithmetic',
  'solver.solve': 'computation.arithmetic',
  'solver.system': 'computation.arithmetic',
  'solver.rearrange': 'computation.arithmetic',
  // The engines that live in their own files, folded in here so there is still exactly one map and one check. An
  // operation is reachable only because it appears in this object; a file that forgets to export its map has
  // operations nobody can call, which is the right way round.
  ...ENGINE_CAPABILITY,
  ...MATH_CAPABILITY,
  ...STUDY_CAPABILITY,
  ...REASONING_CAPABILITY,
  ...SCIENCE_CAPABILITY,
  ...PHYSICS_CAPABILITY,
  ...EM_CAPABILITY,
  ...ENGINEERING_CAPABILITY,
  ...EARTH_CAPABILITY,
  ...HUMANITIES_CAPABILITY
}

export const KNOWN_OPERATIONS = Object.freeze(Object.keys(OPERATION_CAPABILITY))

/**
 * The map itself, for callers that need to know what an operation requires before there is a Page to ask about.
 *
 * Frozen, and the same object the check below reads. A second copy would be a second answer to "what does this need",
 * and the copy is the one that ends up wrong.
 */
export const OPERATION_CAPABILITIES: Readonly<Record<string, string>> = Object.freeze({ ...OPERATION_CAPABILITY })

export class PagesService {
  private registry: PageRegistry = emptyRegistry()
  private readonly o: PagesServiceOptions
  private started = false
  /** Problems found while registering the built-in Pages, kept so diagnostics can show them rather than hiding them. */
  private startupProblems: { slug: string; message: string }[] = []
  /**
   * The document each generated Page opens as, by profile and then by Page.
   *
   * Held rather than looked up again because `withProfile` has just read them and the renderer asks for one
   * immediately afterwards. Keyed by profile rather than kept as one map that is cleared each time: two profiles
   * asking at once would otherwise have the second empty the first's entries between it filling them and reading
   * them, which shows up as a Page that opens as nothing and works on the next try.
   */
  private readonly documents = new Map<string, Map<string, PageDocument>>()

  constructor(options: PagesServiceOptions) {
    this.o = options
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  /**
   * The register, built.
   *
   * Every built-in manifest goes through the same validation an imported one would. A built-in that fails is left out and
   * recorded rather than forced in: shipping a Page whose manifest is wrong should show up as a missing Page and a
   * diagnostic, not as an entry that misbehaves later.
   */
  start(): void {
    if (this.started) return
    this.started = true
    let state = emptyRegistry()
    const problems: { slug: string; message: string }[] = []
    for (const manifest of BUILT_IN_MANIFESTS) {
      const result = registerPage(state, manifest, { trust: 'system', profileId: null, now: this.now() })
      if ('error' in result) {
        problems.push({ slug: String((manifest as { slug?: string }).slug ?? 'unknown'), message: result.message })
        continue
      }
      state = result.state
      // A Page that cannot open in this build says so in the register rather than at the moment somebody clicks it.
      const fit = compatibility(result.page.manifest, this.o.engines ?? {})
      if (!fit.canOpen) {
        state = {
          pages: state.pages.map((one) =>
            one.identity.pageId === result.page.identity.pageId ? { ...one, status: 'incompatible', note: fit.message } : one
          ),
          aliases: state.aliases
        }
      }
    }
    this.registry = state
    this.startupProblems = problems
  }

  /** The register with this profile's decisions layered on. Read rather than stored, so the two cannot drift. */
  private async withProfile(profileId: string): Promise<PageRegistry> {
    const favourites = new Set(await this.o.store.favourites(profileId))
    const usage = await this.o.store.usage(profileId)

    // This profile's generated Pages, registered through the same door as every other Page. A generated manifest that
    // does not validate is left out rather than forced in -- the same rule the built-ins get, and for the same
    // reason: a Page that appears in a list and fails when somebody clicks it is worse than one that is missing.
    let base = this.registry
    const mine = new Map<string, PageDocument>()
    for (const one of await (this.o.generated?.(profileId) ?? Promise.resolve([]))) {
      const result = registerPage(base, manifestToJson(one.manifest), {
        trust: 'user',
        profileId,
        now: this.now(),
        // A generated slug that collides takes the next free one. Refusing would mean a Page somebody built is simply
        // absent, with no way to find out why.
        renameOnCollision: true
      })
      if ('error' in result) continue
      base = result.state
      mine.set(result.page.identity.pageId, one.document)
    }

    this.documents.set(profileId, mine)

    return {
      pages: base.pages.map((page) => {
        const seen = usage[page.identity.pageId]
        return {
          ...page,
          favourite: favourites.has(page.identity.pageId),
          openCount: seen?.openCount ?? 0,
          lastOpenedAt: seen?.lastOpenedAt ?? null
        }
      }),
      aliases: base.aliases
    }
  }

  async state(profileId: string): Promise<PageRegistry> {
    this.start()
    return this.withProfile(profileId)
  }

  problems(): { slug: string; message: string }[] {
    return [...this.startupProblems]
  }

  async resolve(profileId: string, url: string): Promise<Resolution> {
    return canOpen(await this.state(profileId), url, profileId, this.o.engines ?? {})
  }

  async open(profileId: string, url: string): Promise<Resolution> {
    const resolved = await this.resolve(profileId, url)
    if (resolved.found) {
      // Local, for ranking and a recents list. Written to the profile's own file and sent nowhere.
      await this.o.store.recordOpen(profileId, resolved.page.identity.pageId, this.now())
    }
    return resolved
  }

  async favourite(profileId: string, pageId: string, favourite: boolean): Promise<boolean> {
    const result = await this.o.store.setFavourite(profileId, pageId, favourite)
    this.registry = setFavourite(this.registry, pageId, result)
    return result
  }

  // ---------------------------------------------------------------- permissions

  private async decideInput(profileId: string, page: RegisteredPage): Promise<Omit<DecideInput, 'capabilityId' | 'scope'>> {
    return {
      pageId: page.identity.pageId,
      pageVersion: versionToText(page.manifest.version),
      trust: page.trust as PageTrust,
      declared: page.manifest.capabilities,
      grants: await this.o.store.grants(profileId),
      now: this.now(),
      // Nothing is marked unavailable yet: every capability these Pages use is local computation and storage. When a
      // device capability arrives, this is where the environment gets to say the camera does not exist.
      unavailable: [],
      blocked: []
    }
  }

  /** What a Page may actually do, built from decisions rather than from its manifest. */
  async permissions(profileId: string, pageId: string): Promise<ReturnType<typeof permissionSummary> | null> {
    const page = pageById(await this.state(profileId), pageId)
    if (!page) return null
    return permissionSummary(await this.decideInput(profileId, page))
  }

  /**
   * A permission recorded after somebody answered a prompt.
   *
   * Refuses to record a grant the policy would not allow anyway -- an undeclared capability, a forbidden one, one the
   * profile blocks. Storing it would create a grant that never takes effect, and a permission list showing an allowance
   * that does nothing is worse than showing none.
   */
  async grant(
    profileId: string,
    pageId: string,
    capabilityId: string,
    scope: Scope,
    expiresAt: number | null
  ): Promise<{ granted: true; grants: PermissionGrant[] } | { granted: false; message: string }> {
    const page = pageById(await this.state(profileId), pageId)
    if (!page) return { granted: false, message: 'There is no Page with that id.' }

    const base = await this.decideInput(profileId, page)
    const decision = decide({ ...base, capabilityId, scope })
    // `prompt` is the only outcome a grant can follow: `deny` means no answer would help, and `allow` means it is already
    // permitted.
    if (decision.outcome === 'deny' || decision.outcome === 'unavailable') {
      return { granted: false, message: decision.message }
    }

    const grants = await this.o.store.grant(profileId, {
      pageId,
      capabilityId,
      scope,
      grantedAt: this.now(),
      expiresAt,
      source: 'user',
      pageVersion: versionToText(page.manifest.version),
      state: 'active'
    })
    return { granted: true, grants }
  }

  async revoke(profileId: string, pageId: string, capabilityId?: string): Promise<PermissionGrant[]> {
    return this.o.store.revoke(profileId, pageId, capabilityId)
  }

  // ---------------------------------------------------------------- the computation gateway

  /**
   * A Page's computation, checked and then carried out.
   *
   * The only way into the engines. An unknown operation is refused rather than passed through; a Page that has not been
   * granted the capability the operation needs is refused whatever it asked for; and every input is bounded before any
   * engine sees it.
   */
  async run(profileId: string, request: ComputeRequest): Promise<ComputeResult> {
    const { operation } = request
    const fail = (error: string, message: string, capability?: string): ComputeResult => ({
      ok: false,
      operation,
      error,
      message,
      ...(capability ? { capability } : {})
    })

    // Read with `hasOwnProperty`, not by indexing.
    //
    // `OPERATION_CAPABILITY['constructor']` on a plain object returns `Object.prototype.constructor`, which is truthy --
    // so `if (!needed)` let `constructor` past this guard and carried on with a function where a capability id belongs. It
    // was refused further down, but being refused by luck is not being refused.
    const needed = Object.prototype.hasOwnProperty.call(OPERATION_CAPABILITY, operation)
      ? OPERATION_CAPABILITY[operation]
      : undefined
    // Deny by default: an operation nobody has mapped to a capability cannot run at all.
    if (needed === undefined) return fail('unknown-operation', `Orbis Pages have no operation called "${operation}".`)

    const page = pageById(await this.state(profileId), request.pageId)
    if (!page) return fail('not-found', 'There is no Page with that id.')
    if (page.status !== 'available') return fail('unavailable', page.note || 'That Page is not available.')

    const base = await this.decideInput(profileId, page)
    const decision = decide({ ...base, capabilityId: needed })
    if (decision.outcome !== 'allow') {
      // The capability is named, so a Page can ask for it rather than guessing why it failed.
      return fail(decision.outcome === 'unavailable' ? 'unavailable' : 'not-allowed', decision.message, needed)
    }

    try {
      return { ok: true, operation, value: this.carryOut(operation, request.input ?? {}) }
    } catch (err) {
      // A `BadInput` is the Page getting the arguments wrong, and its message is written for the person to read. Anything
      // else is a bug in Orbis, and a Page gets a flat sentence rather than a stack trace.
      if (err instanceof BadInput) return fail('bad-input', err.message)
      return fail('failed', err instanceof Error && err.message.length < 200 ? err.message : 'That calculation did not work.')
    }
  }

  // ---------------------------------------------------------------- the rest of the platform
  //
  // Each of these is a thin call into a module that decides everything. Keeping the deciding out of here is what lets
  // all of it be tested without a window, and what will let it move to Chromium unchanged.

  /**
   * A Page packed up for export.
   *
   * Refused when the scan finds something that looks like a credential, unless `acceptSecrets` -- which only ever comes
   * from a person who was shown each finding. An export is a file that leaves this machine.
   */
  async exportPage(
    profileId: string,
    pageId: string,
    entries: readonly PackageEntry[],
    acceptSecrets: boolean
  ): Promise<Record<string, unknown>> {
    const page = pageById(await this.state(profileId), pageId)
    if (!page) return { ok: false, error: 'not-found', message: 'There is no Page with that id.' }
    const result = packForExport({
      manifest: page.manifest,
      entries,
      packedAt: this.now(),
      packedBy: 'Orbis',
      acceptSecrets
    })
    if ('error' in result) return { ok: false, ...result }
    return { ok: true, package: result.package, secrets: result.secrets, notes: result.notes }
  }

  /**
   * A package read and described.
   *
   * Nothing is installed and nothing is granted: what comes back is a description for somebody to look at and a decision
   * for them to make.
   */
  async inspectPackage(raw: unknown, packedBytes?: number): Promise<Record<string, unknown>> {
    const result = readPackage(raw, packedBytes)
    if ('error' in result) return { ok: false, ...result }
    return {
      ok: true,
      manifest: result.manifest,
      files: result.entries.length,
      requested: result.requested,
      unknownCapabilities: result.unknownCapabilities,
      intact: result.intact,
      warnings: result.warnings,
      beforeYouDecide: result.beforeYouDecide
    }
  }

  /** A fault classified into advice, with the cost of each recovery attached. */
  async diagnose(
    profileId: string,
    fault: Fault,
    context: { hasCheckpoint?: boolean; hasUnsavedWork?: boolean; everStarted?: boolean }
  ): Promise<Record<string, unknown>> {
    void profileId
    const diagnosis = classify({ fault, ...context })
    return { ok: true, ...diagnosis }
  }

  /** An accessibility audit of a Page's own elements, which never returns a pass. */
  async audit(elements: readonly ElementDescription[]): Promise<Record<string, unknown>> {
    return { ok: true, ...audit(elements) }
  }

  /** A built Page checked before it is allowed to run. */
  async checkDocument(document: PageDocument): Promise<Record<string, unknown>> {
    const result = checkDocument(document)
    return { ok: true, ...result }
  }

  /**
   * A question answered by an engine, where it can be.
   *
   * This is the call that stops Orion producing a number it could have computed. A question that maps exactly onto an
   * engine is run through it and comes back labelled as computed; anything else comes back as `computed: false`, which
   * means "answer this the ordinary way" rather than "this has no answer".
   *
   * The capability check is the same one every Page goes through -- this runs as the Page that owns the operation, so
   * Orion cannot reach an engine that a Page could not.
   */
  async answerQuestion(profileId: string, question: string): Promise<Record<string, unknown>> {
    const plan = planAnswer(question)
    if (plan === null) {
      return {
        ok: true,
        computed: false,
        // Said plainly, because "no plan" and "no answer" are different and only the first is true here.
        because: 'This is not a question with an exact answer an engine can work out, so it should be answered normally.'
      }
    }

    // Run as the Page that owns this operation, so the same capability check applies as it would to the Page itself.
    const state = await this.state(profileId)
    const owner = listPages(state, { profileId }).find(
      (one) => one.status === 'available' && this.operationSuitsPage(plan.operation, one)
    )
    if (owner === undefined) {
      return {
        ok: true,
        computed: false,
        because: 'No available Page is allowed to do that, so Orbis will not work it out here.'
      }
    }

    const result = await this.run(profileId, {
      pageId: owner.identity.pageId,
      operation: plan.operation,
      input: plan.input
    })
    if (!result.ok) {
      // The engine refused, which is an answer: it means the question could not be worked out, not that it was routed
      // wrongly. Orion answers normally and says why rather than presenting a failure as a result.
      return { ok: true, computed: false, because: result.message }
    }

    const presented = presentAnswer(plan, (result.value ?? {}) as Record<string, unknown>)
    return {
      ok: true,
      computed: true,
      text: presented.text,
      operation: presented.operation,
      understood: presented.understood,
      notes: presented.notes,
      pageId: owner.identity.pageId,
      pageTitle: owner.manifest.title
    }
  }

  /**
   * Who can receive what, for the screen that shows it.
   *
   * Only what each Page has declared, never inferred. A Page that has not said it accepts something is a Page that
   * cannot have anything pushed at it, and this list says so by simply not carrying it.
   */
  async participants(profileId: string): Promise<Record<string, unknown>[]> {
    const state = await this.state(profileId)
    const rows: Record<string, unknown>[] = []
    for (const page of listPages(state, { profileId })) {
      rows.push({
        pageId: page.identity.pageId,
        title: page.manifest.title,
        slug: page.identity.slug,
        running: page.status === 'available',
        accepts: page.manifest.accepts,
        // Whether this Page may send at all. Half the permission; the other half is the receiver's declaration.
        canSend: page.manifest.capabilities.includes('page.send')
      })
    }
    return rows
  }

  /**
   * One Page's message to another.
   *
   * Every check is `composition.send`'s, run here with a directory the sender never sees. The sender's own permission
   * is tested before the receiver is looked at, so a Page without `page.send` learns nothing at all -- not even whether
   * the Page it named exists.
   */
  async sendBetweenPages(
    profileId: string,
    fromPageId: string,
    toPageId: string,
    kind: string,
    body: unknown
  ): Promise<Record<string, unknown>> {
    const state = await this.state(profileId)
    const pages = listPages(state, { profileId })
    const asParticipant = (page: RegisteredPage): Participant => ({
      pageId: page.identity.pageId,
      accepts: page.manifest.accepts,
      granted: page.manifest.capabilities,
      running: page.status === 'available'
    })

    const from = pages.find((one) => one.identity.pageId === fromPageId)
    if (!from) return { ok: false, error: 'not-found', message: 'There is no Page with that id.' }

    const directory = new Map<string, Participant>(pages.map((one) => [one.identity.pageId, asParticipant(one)]))
    const result = send({
      from: asParticipant(from),
      toPageId,
      kind,
      body,
      id: randomUUID(),
      directory
    })
    if (isCompositionError(result)) return { ok: false, ...result }

    return {
      ok: true,
      to: result.to.pageId,
      kind: result.message.kind,
      hops: result.message.hops,
      expectsReply: result.expectsReply,
      notes: result.notes
    }
  }

  /** Whether a Page holds the capability an operation needs. Used to pick who an engine call runs as. */
  private operationSuitsPage(operation: string, page: RegisteredPage): boolean {
    const needed = Object.prototype.hasOwnProperty.call(OPERATION_CAPABILITY, operation)
      ? OPERATION_CAPABILITY[operation]
      : undefined
    if (needed === undefined) return false
    return page.manifest.capabilities.includes(needed)
  }

  /** Which Pages, if any, answer a search better than the results they would displace. */
  async searchModule(
    profileId: string,
    query: string,
    intents: readonly { intent: QueryIntent; confidence: number }[],
    looksLikeUrl: boolean
  ): Promise<Record<string, unknown>> {
    const registry = await this.state(profileId)
    const usage = await this.o.store.usage(profileId)
    const opened: Record<string, number> = {}
    for (const [pageId, seen] of Object.entries(usage)) opened[pageId] = seen.openCount
    const module = pagesModule({ registry, query, profileId, intents, looksLikeUrl, opened })
    return {
      ok: true,
      show: module.show,
      rank: module.rank,
      heading: module.heading,
      because: module.because,
      // Only what a results page needs, rather than the whole registered Page.
      suggestions: module.suggestions.map((one) => ({
        pageId: one.page.identity.pageId,
        slug: one.page.identity.slug,
        title: one.page.manifest.title,
        summary: one.page.manifest.search.summary,
        icon: one.page.manifest.icon,
        confidence: one.confidence,
        because: one.because,
        prefill: one.prefill
      }))
    }
  }

  /** The engines, reached only from `run` and only after the check above. */
  private carryOut(operation: string, input: Record<string, unknown>): unknown {
    const text = (key: string, max: number): string => {
      const value = input[key]
      if (typeof value !== 'string') throw new Error(`"${key}" has to be text.`)
      if (value.length > max) throw new Error(`"${key}" is too long.`)
      return value
    }
    const maybeNumber = (key: string): number => {
      const value = input[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${key}" has to be a number.`)
      return value
    }
    const scopeOf = (key: string): Record<string, number> => {
      const value = input[key]
      if (value === undefined) return {}
      if (typeof value !== 'object' || value === null) throw new Error(`"${key}" has to be a set of values.`)
      const entries = Object.entries(value as Record<string, unknown>).slice(0, LIMITS.scopeEntries)
      const out: Record<string, number> = {}
      for (const [name, held] of entries) {
        if (typeof held === 'number' && Number.isFinite(held)) out[name] = held
      }
      return out
    }
    /** A parsed expression, with its size bounded before anything walks it. */
    const tree = (key: string) => {
      const parsed = parseExpression(text(key, LIMITS.expression))
      if (isParseError(parsed)) throw new Error(parsed.message)
      if (sizeOf(parsed) > LIMITS.nodes) throw new Error('That expression is too large to work with.')
      return parsed
    }
    const equationOf = (key: string): Equation => {
      const parsed = parseEquation(text(key, LIMITS.expression))
      if ('error' in parsed) throw new Error(parsed.message)
      return parsed
    }

    // Anything belonging to one of the newer engines is handled there, with its own readers and its own work budget.
    if (Object.prototype.hasOwnProperty.call(ENGINE_CAPABILITY, operation)) {
      return runEngineOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(MATH_CAPABILITY, operation)) {
      return runMathOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(STUDY_CAPABILITY, operation)) {
      return runStudyOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(REASONING_CAPABILITY, operation)) {
      return runReasoningOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(SCIENCE_CAPABILITY, operation)) {
      return runScienceOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(PHYSICS_CAPABILITY, operation)) {
      return runPhysicsOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(EM_CAPABILITY, operation)) {
      return runEmOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(ENGINEERING_CAPABILITY, operation)) {
      return runEngineeringOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(EARTH_CAPABILITY, operation)) {
      return runEarthOperation(operation, input)
    }
    if (Object.prototype.hasOwnProperty.call(HUMANITIES_CAPABILITY, operation)) {
      return runHumanitiesOperation(operation, input)
    }

    switch (operation) {
      // ---- units
      case 'units.parse': {
        const parsed = parseUnit(text('unit', LIMITS.unit))
        if (isUnitError(parsed)) return { ok: false, message: parsed.message, error: parsed.error }
        return {
          ok: true,
          display: parsed.display,
          dimension: parsed.dimension,
          dimensionName: readDimension(parsed.dimension),
          single: parsed.single?.id ?? null
        }
      }

      case 'units.convert': {
        const made = quantity(maybeNumber('value'), text('from', LIMITS.unit))
        if (isQuantityError(made)) return { ok: false, message: made.message, error: made.error }
        const converted = convertQuantity(made as Quantity, text('to', LIMITS.unit))
        if (isQuantityError(converted)) return { ok: false, message: converted.message, error: converted.error }
        const result = converted as Quantity
        return {
          ok: true,
          value: result.value,
          display: formatQuantity(result, 10),
          unit: result.unit.display,
          dimension: nameDimension(result.unit.dimension) ?? readDimension(result.unit.dimension),
          exact: made.unit.single?.exact === true && result.unit.single?.exact === true
        }
      }

      case 'units.compatible': {
        const parsed = parseUnit(text('unit', LIMITS.unit))
        if (isUnitError(parsed)) return { ok: false, message: parsed.message, error: parsed.error }
        return {
          ok: true,
          dimension: readDimension(parsed.dimension),
          // Only the ones that could actually work: offering a pressure for a length is offering an error.
          units: compatibleUnits(parsed).map((one) => ({ id: one.id, symbol: one.symbol, name: one.name, system: one.system }))
        }
      }

      // ---- expressions
      case 'expression.evaluate': {
        const parsed = tree('text')
        const value = evaluateExpression(parsed, scopeOf('scope'))
        if (isEvaluateError(value)) return { ok: false, message: value.message, error: value.error, symbol: value.symbol ?? null }
        return { ok: true, value, variables: variablesOf(parsed), describe: describeExpression(parsed) }
      }

      case 'expression.simplify': {
        const parsed = tree('text')
        return { ok: true, text: expressionToText(simplify(parsed)), variables: variablesOf(parsed) }
      }

      case 'expression.differentiate': {
        const parsed = tree('text')
        const variable = input.variable === undefined ? (variablesOf(parsed)[0] ?? 'x') : text('variable', 60)
        const derivative = differentiate(parsed, variable)
        if ('error' in derivative) return { ok: false, message: derivative.message, error: derivative.error, what: derivative.what }
        return {
          ok: true,
          variable,
          text: expressionToText(derivative),
          original: expressionToText(simplify(parsed))
        }
      }

      case 'expression.substitute': {
        const parsed = tree('text')
        const replacement = tree('replacement')
        const after = simplify(substitute(parsed, text('variable', 60), replacement))
        return { ok: true, text: expressionToText(after), variables: variablesOf(after) }
      }

      // ---- solving
      case 'solver.solve': {
        const equation = equationOf('equation')
        const unknowns = unknownsOf(equation)
        const variable = input.variable === undefined ? (unknowns[0] ?? 'x') : text('variable', 60)
        const from = input.searchFrom === undefined ? -100 : maybeNumber('searchFrom')
        const to = input.searchTo === undefined ? 100 : maybeNumber('searchTo')
        if (!(to > from)) throw new Error('The range to search has to end after it starts.')
        const result = solveFor(equation, variable, {
          parameters: scopeOf('parameters'),
          searchFrom: from,
          searchTo: to,
          samples: LIMITS.samples
        })
        return { ok: true, unknowns, result, steps: solutionSteps(equation, result) }
      }

      case 'solver.system': {
        const raw = input.equations
        if (!Array.isArray(raw)) throw new Error('"equations" has to be a list.')
        if (raw.length === 0) throw new Error('There are no equations to solve.')
        if (raw.length > LIMITS.equations) throw new Error(`At most ${LIMITS.equations} equations at once.`)
        const equations: Equation[] = raw.map((one, i) => {
          if (typeof one !== 'string') throw new Error(`Equation ${i + 1} has to be text.`)
          if (one.length > LIMITS.expression) throw new Error(`Equation ${i + 1} is too long.`)
          const parsed = parseEquation(one)
          if ('error' in parsed) throw new Error(`Equation ${i + 1}: ${parsed.message}`)
          return parsed
        })
        return { ok: true, result: solveLinearSystem(equations) }
      }

      case 'solver.rearrange': {
        const equation = equationOf('equation')
        const variable = text('variable', 60)
        const rearranged = rearrangeFor(equation, variable)
        if (!rearranged) {
          return {
            ok: false,
            error: 'not-rearrangeable',
            // The honest reason: an answer that is only sometimes right is worse than no answer.
            message: `Orbis can only rearrange exactly when ${variable} appears once and to the first power. Solving for it instead will give every answer.`
          }
        }
        return {
          ok: true,
          subject: rearranged.subject,
          text: expressionToText(rearranged.expression),
          conditions: rearranged.conditions
        }
      }

      default:
        // Unreachable: the capability map above is the list of operations, and an unmapped one is refused before here.
        throw new Error(`"${operation}" is not implemented.`)
    }
  }

  // ---------------------------------------------------------------- each Page's own work

  async saveProject(
    profileId: string,
    pageId: string,
    projectId: string | null,
    name: string,
    state: Record<string, unknown>
  ): Promise<{ ok: true; project: unknown } | { ok: false; error: string; message: string }> {
    const page = pageById(await this.state(profileId), pageId)
    if (!page) return { ok: false, error: 'not-found', message: 'There is no Page with that id.' }

    // Saving is a capability like any other, even though every Page Orbis ships has it.
    const base = await this.decideInput(profileId, page)
    const decision = decide({ ...base, capabilityId: 'storage.page' })
    if (decision.outcome !== 'allow') return { ok: false, error: 'not-allowed', message: decision.message }

    const result = await this.o.store.saveProject(
      profileId,
      { projectId: projectId ?? `project_${randomUUID().replace(/-/g, '').slice(0, 24)}`, pageId, name, state },
      this.now()
    )
    if ('error' in result) return { ok: false, error: result.error, message: result.message }
    return { ok: true, project: result.project }
  }

  async projects(profileId: string, pageId: string): Promise<unknown[]> {
    return this.o.store.projects(profileId, pageId)
  }

  async deleteProject(profileId: string, projectId: string): Promise<boolean> {
    return this.o.store.deleteProject(profileId, projectId)
  }

  /** Called when the active profile changes: the register keeps its Pages, the decisions are re-read. */
  profileChanged(): void {
    this.o.store.forget()
    this.documents.clear()
  }

  /** For diagnostics: what the register looks like without any profile's decisions on it. */
  /**
   * The document a generated Page opens as.
   *
   * The register is read first rather than trusting whatever was cached, so asking for another profile's Page finds
   * nothing instead of finding something.
   */
  async documentFor(profileId: string, pageId: string): Promise<PageDocument | null> {
    await this.state(profileId)
    return this.documents.get(profileId)?.get(pageId) ?? null
  }

  /**
   * One engine operation, run with no Page behind it.
   *
   * For the trial run that happens while a Page is being built, where there is nothing registered for a permission
   * check to be about. It is not a way round the permission check: what a generated Page may run is decided by its
   * manifest, and the gates in `validation.ts` check that manifest against these same operations before this is
   * called. The operation is still looked up in the one map, so nothing outside it can be reached here either.
   */
  carryOutFor(operation: string, input: Record<string, unknown>): unknown {
    if (!Object.prototype.hasOwnProperty.call(OPERATION_CAPABILITY, operation)) {
      throw new BadInput(`Orbis Pages have no operation called "${operation}".`)
    }
    return this.carryOut(operation, input)
  }

  rawPages(): readonly RegisteredPage[] {
    this.start()
    return this.registry.pages
  }

  /** The manifests as registered, for a Page that wants to describe itself. */
  manifestFor(pageId: string): PageManifest | null {
    this.start()
    return pageById(this.registry, pageId)?.manifest ?? null
  }

  /** Every Page in the build, for a listing that does not need a profile. */
  builtIn(): RegisteredPage[] {
    this.start()
    return listPages(this.registry, { profileId: null, status: 'any' })
  }
}
