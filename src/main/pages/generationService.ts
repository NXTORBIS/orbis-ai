/**
 * Building a Page that does not exist yet.
 *
 * This is the only place a model is asked to write a Page, and it is deliberately the thinnest part of the feature.
 * Everything that decides anything -- whether to build at all, whether the specification is usable, what permissions
 * follow from it, whether the result is fit to keep -- lives in `src/shared/pages/` and is tested without a model,
 * without Electron and without a network. What is left here is the sequence, the prompt, and the one thing that
 * genuinely cannot be done anywhere else: running the Page for real and looking at what came back.
 *
 * ## The model is asked once, and then argued with once
 *
 * A first attempt often gets an argument name or a property name wrong. Both are recoverable and both produce a
 * *specific* complaint -- "motion.projectile does not take velocity, it takes speed, angle, gravity" -- so the second
 * attempt is given the complaint rather than asked again from nothing. Past that it stops. A third attempt with no
 * new information is the same coin flipped again.
 *
 * ## Nothing a model writes is trusted, at any point
 *
 * What comes back is parsed as JSON and handed to `checkSpec`. Nothing here reads a field out of it first, branches
 * on it, or shows it. If it does not validate, the session fails and the text is kept as evidence rather than
 * repaired -- a repaired specification is one whose author did not write what runs, and afterwards there is no way to
 * tell which parts were which.
 *
 * ## Why the trial run matters more than the rest
 *
 * The gates in `validation.ts` check the Page's shape, and a converter with the wrong constant passes all of them.
 * The trial run is the only step that touches reality: it calls the real engines through the real dispatch, with the
 * values the Page starts with, and records what each one returned. That catches two things nothing else can -- an
 * engine refusing the arguments, and a Page trying to show a property its calculation does not produce.
 *
 * It still cannot tell whether the answer is *right*. Nothing here can, and every generated Page says so on its face.
 */

import { compile, isCompileError, type Compiled } from '../../shared/pages/compiler.ts'
import {
  cancel,
  compiled as compiledStage,
  failed as failedStage,
  planned,
  resolved as resolvedStage,
  startSession,
  tried,
  validated,
  isSessionError,
  type Failure,
  type GenerationSession
} from '../../shared/pages/generation.ts'
import { makePageId } from '../../shared/pages/identity.ts'
import { resolve as resolveLadder, type Resolution } from '../../shared/pages/resolution.ts'
import {
  missingPicks,
  validate,
  VALIDATION_LIMITS,
  whatToRun,
  type RunEvidence,
  type ValidationResult
} from '../../shared/pages/validation.ts'
import { argumentsFor, initialState, type PageDocument } from '../../shared/pages/builder.ts'
import { checkSpec, type PageSpec, type SpecProblem } from '../../shared/pages/spec.ts'
import { arrange, shapeFor, shouldWait, type Shape } from '../../shared/pages/shapes.ts'
import { checkLayout, describeForAudit, layout } from '../../shared/pages/layout.ts'
import { audit } from '../../shared/pages/accessibility.ts'
import {
  afterRound,
  constraintFor,
  fromGates,
  fromLayout,
  fromRun,
  fromSpec,
  NOTHING_ATTEMPTED,
  planHealing,
  type Defect,
  type Repair
} from '../../shared/pages/healing.ts'
import type { PageRegistry } from '../../shared/pages/registry.ts'
import type { QueryIntent } from '../../shared/pages/search.ts'
import { catalogueForPrompt, generationOperations, SPEC_SIGNATURES } from './generationCatalogue.ts'

/**
 * What the model is told.
 *
 * Written as rules rather than as encouragement, because the failures that matter here are all failures of *format*:
 * a Page that does slightly the wrong thing is somebody's problem to notice, and a Page whose step names an argument
 * that does not exist is nobody's, because it never opens properly and the reason is invisible.
 */
export const PLANNER_INSTRUCTIONS = `You write specifications for Orbis Pages. A Page is a small calculator: some boxes somebody fills in, some calculations Orbis already has, and some answers shown.

Answer with a single JSON object and nothing else. It has exactly these keys:

{
  "specVersion": 1,
  "title": "short, at most 80 characters",
  "purpose": "one sentence saying what it works out",
  "inputs": [{"name":"speed","kind":"number","label":"Launch speed","initial":20,"minimum":0,"maximum":200,"help":"optional"}],
  "steps": [{"name":"flight","operation":"motion.projectile","when":"change","describe":"optional","arguments":{"speed":{"input":"speed"},"gravity":{"value":9.81}}}],
  "outputs": [{"name":"range","label":"How far it goes","display":"statistic","step":"flight","pick":"range"}],
  "sections": [{"title":"The throw","members":["speed"]},{"title":"The answer","members":["range"]}],
  "notes": ["what this does not account for"],
  "keywords": ["projectile","range"]
}

The rules, all of which are checked:

- "kind" is one of number, text, boolean, choice, quantity. A choice needs "options": [{"value":"a","label":"A"}]. A quantity needs "unit".
- "operation" must be one of the calculations listed below, spelled exactly. There are no others. If nothing listed can work out what was asked, say so with {"specVersion":1,"cannot":"why"} instead of inventing one.
- Each argument comes from exactly one of {"input":"name"}, {"step":"earlierStepName"} or {"value":<a literal>}. A step may only use a step listed before it.
- Give every argument the calculation requires and no argument it does not take. The list below shows which; a "?" means it may be left out.
- "display" is value, statistic, table or plot. A value or a statistic must say which single property of the result to "pick". A table or a plot shows the whole result and must not.
- Every input and every output must appear in exactly one section. Steps are never named in a section.
- Labels are what somebody reads. Never label a box with its own name.
- "when" is "change" to recalculate as somebody types, or "button" to wait. Use "button" when a calculation is heavy, and keep the number that run on "change" small.
- "notes" says what the calculation does not account for. Write at least one, honestly.

There is no way to ask for a permission, fetch anything, or run any code. A Page only does the calculations listed.

The calculations available:
`

const MODEL = 'openai/gpt-oss-120b'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface GenerationServiceOptions {
  /** The register, so the ladder can look for a Page that already does this. */
  registry(profileId: string): Promise<PageRegistry>
  /** Runs one engine operation directly. The permission question is answered separately, by the gates. */
  runOperation(operation: string, input: Record<string, unknown>): unknown
  /** Every operation the compute service knows, with its capability. Filtered to the catalogue before use. */
  allOperations: Readonly<Record<string, string>>
  apiKeys(): Promise<string[]>
  fetchFn: FetchFn
  /** Random, for page ids and session ids. Supplied so a test can pin it. */
  random(): string
  now?(): number
  /** Whether a generated Page may remember what was typed into it. Orbis's decision, never the model's. */
  allowStorage?: boolean
  /** Asks the model. Replaced in a test; `requestJson` in the application. */
  ask(system: string, user: string, apiKeys: string[], fetchFn: FetchFn, timeoutMs: number, options: { maxTokens?: number; model?: string }): Promise<Record<string, unknown> | null>
}

export interface GenerationOutcome {
  session: GenerationSession
  /** The built Page, when there is one. Not registered yet -- somebody has to want it first. */
  compiled: Compiled | null
  /** What the ladder decided, so a caller that wanted a Page can offer the existing one instead. */
  resolution: Resolution | null
}

/**
 * What a trial run found, and the complaint to send back if it found something.
 *
 * The complaint is the whole reason this returns more than a boolean. "It did not work" gives a second attempt
 * nothing; "motion.projectile returns range, highest, seconds, not distance" gives it the answer.
 */
function complaintFrom(document: PageDocument, evidence: RunEvidence): string | null {
  const refused = evidence.results.filter((one) => !one.ok)
  const missing = missingPicks(document, evidence)
  if (refused.length === 0 && missing.length === 0) return null
  const lines: string[] = []
  for (const one of refused) lines.push(`The step "${one.name}" was refused: ${one.message ?? 'no reason given'}`)
  for (const one of missing) {
    lines.push(`"${one.pick}" is not something ${one.step} returns. It returns: ${one.available.join(', ')}.`)
  }
  return lines.join('\n')
}

export class GenerationService {
  private readonly o: GenerationServiceOptions

  constructor(options: GenerationServiceOptions) {
    this.o = options
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  /** The operations a generated Page may use, with their capabilities. */
  private operations(): Readonly<Record<string, string>> {
    return generationOperations(this.o.allOperations)
  }

  /**
   * Runs the Page, and records what came back.
   *
   * Every calculation it contains, including the ones that wait for a button. See the note on `whatToRun` about why
   * that is right here and wrong for a Page that already belongs to somebody: there is nobody's behalf to act on yet,
   * and a Page whose work all waits for a button would otherwise be the one Page that gets no check at all.
   */
  tryRun(document: PageDocument): RunEvidence {
    const plan = whatToRun(document, true)
    const state = initialState(document)
    const values: Record<string, unknown> = { ...state.values }
    const results: RunEvidence['results'][number][] = []

    for (const name of plan.run) {
      const computation = document.computations.find((one) => one.name === name)
      if (computation === undefined) continue
      try {
        const value = this.o.runOperation(computation.operation, argumentsFor(computation, { values }))
        // Two refusals reach here and they look different. The engine bridge throws for bad arguments, and an engine
        // that refuses the physics returns an object saying so. A check that noticed only the first would report the
        // second as a Page that ran.
        if (value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
          results.push({
            name,
            ok: false,
            message: String((value as { message?: unknown }).message ?? 'The calculation refused these numbers.')
          })
          continue
        }
        values[computation.writes] = value
        results.push({
          name,
          ok: true,
          keys: value !== null && typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : []
        })
      } catch (err) {
        results.push({ name, ok: false, message: err instanceof Error && err.message.length < 400 ? err.message : 'That calculation did not work.' })
      }
    }
    return { results, notRun: plan.waiting }
  }

  private gates(built: Compiled, evidence?: RunEvidence): ValidationResult {
    return validate({
      spec: built.spec,
      manifest: built.manifest,
      document: built.document,
      operations: this.operations(),
      allowStorage: this.o.allowStorage === true,
      evidence
    })
  }

  /** One request to the model, returning the raw object or null. */
  private async askOnce(request: string, complaint: string | null, guidance = ''): Promise<Record<string, unknown> | null> {
    const keys = await this.o.apiKeys()
    if (keys.length === 0) return null
    // The shape says what kind of Page this is, and deliberately nothing about how it is arranged -- that is decided
    // afterwards by `arrange`, so it is the same for every Page of the same shape.
    const system = `${PLANNER_INSTRUCTIONS}${catalogueForPrompt()}${guidance === '' ? '' : `\n\n${guidance}`}`
    const user =
      complaint === null
        ? request
        : `${request}

The last attempt did not work. What was wrong:
${complaint}

Write it again, fixing those. Everything else about the format is the same.`
    return this.o.ask(system, user, keys, this.o.fetchFn, 60_000, { maxTokens: 4000, model: MODEL })
  }

  /**
   * A Page built for a request, or a reason there is not one.
   *
   * Runs the whole ladder, so a caller does not have to: most requests never reach the model, and the ones that do
   * are the ones nothing in the library answered.
   */
  async generate(
    profileId: string,
    request: string,
    options: { intents?: readonly { intent: QueryIntent; confidence: number }[]; looksLikeUrl?: boolean } = {}
  ): Promise<GenerationOutcome> {
    const now = this.now()
    const started = startSession({ sessionId: `gen_${this.o.random()}`.slice(0, 40), request, profileId, now })
    if (isSessionError(started)) {
      // A session that could not start has nothing to record, so the failure is reported as a finished one.
      return {
        session: {
          sessionId: 'gen_none',
          request,
          profileId,
          startedAt: now,
          updatedAt: now,
          stage: 'failed',
          attempts: 1,
          resolution: null,
          raw: null,
          spec: null,
          built: null,
          validation: null,
          failure: { code: 'nothing-to-build', message: started.message, problems: [] },
          history: []
        },
        compiled: null,
        resolution: null
      }
    }
    let session = started

    // ---- the ladder
    const ladder = resolveLadder({
      registry: await this.o.registry(profileId),
      query: request,
      profileId,
      intents: options.intents,
      looksLikeUrl: options.looksLikeUrl,
      canGenerate: (await this.o.apiKeys()).length > 0
    })
    const afterLadder = resolvedStage(session, ladder, this.now())
    if (isSessionError(afterLadder)) return { session, compiled: null, resolution: ladder }
    session = afterLadder
    if (session.stage !== 'planning') return { session, compiled: null, resolution: ladder }

    // ---- ask, and argue once
    // What kind of Page this is. It decides the guidance the model is given and, afterwards, how the Page is
    // arranged -- which is the part a model is deliberately not asked about, because a model asked for an
    // arrangement gives the one it felt like and this gives the same one every time.
    const shape = shapeFor(request)

    let complaint: string | null = null
    let lastFailure: Failure | null = null
    let attempted = NOTHING_ATTEMPTED

    for (;;) {
      const roundStarted = this.now()
      // A later round starts from `planning` whatever the last one got as far as, so the transitions below are the
      // same every time. Putting it here rather than at each failure is what stops one of them being forgotten.
      if (attempted.rounds > 0) session = this.restart(session, request, profileId, now)

      const raw = await this.askOnce(request, complaint, shape.guidance)
      if (raw === null) {
        return this.stop(session, { code: 'model-failed', message: 'Nothing answered the request to write a Page.', problems: [] })
      }
      const afterPlan = planned(session, JSON.stringify(raw), this.now())
      if (isSessionError(afterPlan)) return { session, compiled: null, resolution: ladder }
      session = afterPlan
      // The first ask counts. `HEALING_LIMITS.asks` is how many times a model is asked over a Page's whole life, and
      // writing it the first time is one of those -- counting only the arguments would quietly allow one more.
      if (attempted.rounds === 0) attempted = { ...attempted, asks: 1 }

      // The model's own way of saying nothing here can do it. Believed, because a Page built from an operation that
      // does not fit is worse than no Page.
      if (typeof raw.cannot === 'string') {
        return this.stop(session, {
          code: 'cannot-be-built',
          message: `This could not be built from the calculations Orbis has: ${raw.cannot.slice(0, 200)}`,
          problems: []
        })
      }

      const attempt = await this.buildOnce(raw, profileId, shape)
      if (attempt.built === null) {
        // It did not compile. There is no Page to check anything else against.
        lastFailure = {
          code: 'spec-rejected',
          message: 'This description could not be turned into a Page.',
          problems: attempt.defects.map((one) => ({ at: one.at, severity: 'error' as const, code: one.code, message: one.message }))
        }
        const plan = planHealing(attempt.defects, attempted)
        if (plan.exhausted) break
        complaint = plan.repairs.map((one) => one.because).join('\n')
        attempted = afterRound(attempted, plan.repairs, this.now() - roundStarted)
        continue
      }

      const built = attempt.built
      const afterCompile = compiledStage(session, built, this.now())
      if (isSessionError(afterCompile)) return { session, compiled: built, resolution: ladder }
      session = afterCompile

      const shapeGates = this.gates(built)
      const afterGates = validated(session, shapeGates, this.now())
      if (!shapeGates.passed) {
        // The session has to finish before another round starts; the machine has no way back from `validating`.
        session = isSessionError(afterGates) ? session : afterGates
        lastFailure = {
          code: 'gates-failed',
          message: 'The Page that was built did not pass its checks.',
          problems: shapeGates.problems.map((one) => ({ at: '', severity: 'error' as const, code: 'gate', message: one }))
        }
        const plan = planHealing([...attempt.defects, ...fromGates(shapeGates.problems)], attempted)
        if (plan.exhausted) break
        const repaired = this.repair(built, plan.repairs)
        const toAsk = plan.repairs.filter((one) => !one.deterministic).map((one) => one.because).join('\n')
        attempted = afterRound(attempted, plan.repairs, this.now() - roundStarted)
        // A deterministic repair produced a new Page without asking anybody. If it is now fit, nothing more is
        // needed -- which is the whole point of repairing at the layer that was wrong.
        if (repaired !== null && toAsk === '') {
          const again = this.checkBuilt(repaired, attempt.defects)
          if (again.ready) return { session: this.finish(session, repaired, again.validation), compiled: repaired, resolution: ladder }
        }
        complaint = toAsk
        continue
      }
      if (isSessionError(afterGates)) return { session, compiled: built, resolution: ladder }
      session = afterGates

      // ---- the one step that touches reality
      const evidence = this.tryRun(built.document)
      const trouble = complaintFrom(built.document, evidence)
      const full = this.gates(built, evidence)
      const afterRun = tried(session, full, this.now())
      session = isSessionError(afterRun) ? session : afterRun

      if (trouble === null && full.passed && !attempt.defects.some((one) => one.severity === 'error')) {
        return { session, compiled: built, resolution: ladder }
      }

      lastFailure = {
        code: 'would-not-run',
        message: 'The Page was built and its calculations did not answer.',
        problems: (full.problems.length > 0 ? full.problems : [trouble ?? 'It did not work.']).map((one) => ({
          at: '',
          severity: 'error' as const,
          code: 'run',
          message: one
        }))
      }
      // What running it actually found, as run defects rather than as gate problems.
      //
      // The difference decides where they go. A gate problem is a sentence about the Page as a whole and the
      // classifier can only give up on it; a run defect carries an engine's own words about one calculation -- "the
      // angle has to be between 0 and 90", "distance is not something flight returns, it returns range" -- which is
      // the most specific thing anybody has and is worth asking a model about.
      const refused = evidence.results
        .filter((one) => !one.ok)
        .map((one) => ({ name: one.name, message: one.message ?? 'The calculation refused these numbers.' }))
      const wrongPicks = missingPicks(built.document, evidence).map((one) => ({
        name: one.step,
        message: `"${one.pick}" is not something ${one.step} returns. It returns: ${one.available.join(', ')}.`
      }))
      const defects = [
        ...attempt.defects,
        ...fromRun([...refused, ...wrongPicks]),
        // The gates only where the run found nothing, so the same trouble is not counted twice.
        ...(refused.length === 0 && wrongPicks.length === 0 ? fromGates(full.problems) : [])
      ]
      const plan = planHealing(defects, attempted)
      if (plan.exhausted) break
      const toAsk = plan.repairs.filter((one) => !one.deterministic).map((one) => one.because).join('\n')
      complaint = toAsk === '' ? trouble : toAsk
      attempted = afterRound(attempted, plan.repairs, this.now() - roundStarted)
    }

    return {
      session: this.stop(session, lastFailure ?? { code: 'model-failed', message: 'A Page could not be built.', problems: [] }).session,
      compiled: null,
      resolution: ladder
    }
  }

  /**
   * One attempt at turning what the model wrote into a Page, with everything that checks its shape.
   *
   * The order is the pipeline's, and each step changes what the next one sees: the specification is read, arranged
   * to its shape, and has its heavy work moved off the typing path -- all before it is compiled, because all of it
   * changes what would be compiled. The layout is then worked out and checked, which is arithmetic on what is there
   * and needs nothing to have been rendered.
   */
  private async buildOnce(raw: unknown, profileId: string, shape: Shape): Promise<{ built: Compiled | null; defects: Defect[] }> {
    const read = checkSpec(raw, this.operations(), SPEC_SIGNATURES)
    if (!read.usable || read.normalised === null) {
      return { built: null, defects: fromSpec(read.problems.filter((one) => one.severity === 'error')) }
    }

    const arranged = arrange(read.normalised, shape)
    const waits = shouldWait(arranged, VALIDATION_LIMITS.perKeystroke)
    const ready: PageSpec =
      waits.length === 0
        ? arranged
        : { ...arranged, steps: arranged.steps.map((one) => (waits.includes(one.name) ? { ...one, when: 'button' as const } : one)) }

    const built = compile(ready, {
      operations: this.operations(),
      signatures: SPEC_SIGNATURES,
      pageId: makePageId(this.o.random()),
      taken: (await this.o.registry(profileId)).pages.map((one) => one.identity.slug),
      allowStorage: this.o.allowStorage === true
    })
    if (isCompileError(built)) return { built: null, defects: fromSpec(built.problems) }

    // Everything that can be checked without rendering: the arrangement, and whether the Page can be used by
    // somebody who is not looking at it. What is left -- contrast, target size -- needs pixels, and `visual.ts`
    // checks those after it renders rather than this guessing at them.
    const arrangement = layout(ready)
    const reachable = audit(describeForAudit(ready))
    const stopping = reachable.findings.filter((one) => one.severity === 'blocker')
    return {
      built,
      defects: [
        ...fromLayout(checkLayout(arrangement, ready.outputs)),
        ...stopping.map((one) => ({
          found: 'gate' as const,
          code: 'accessibility',
          // The problem and its fix together. The audit never gives one without the other, and a repair that was
          // told only what is wrong has to guess the rest.
          message: `${one.problem} ${one.fix}`,
          at: one.element,
          severity: 'error' as const
        }))
      ]
    }
  }

  /**
   * A deterministic repair performed.
   *
   * Only the ones that can be done here without asking anybody. Moving a calculation off the typing path is the one
   * that fires in practice, because the layout engine prevents its own defects by construction rather than producing
   * them and fixing them afterwards. Null means nothing could be done here, which is not a failure -- it means the
   * repair belongs to a layer this does not own.
   */
  private repair(built: Compiled, repairs: readonly Repair[]): Compiled | null {
    const constraints = repairs.map(constraintFor).filter((one): one is NonNullable<typeof one> => one !== null)
    if (!constraints.some((one) => one.kind === 'defer-computation')) return null

    // One fewer per keystroke than the gate allows, so the repaired Page is inside the limit rather than exactly on
    // it. A repair that lands on the boundary fails again the moment anything else changes.
    const waits = shouldWait(built.spec, Math.max(1, VALIDATION_LIMITS.perKeystroke - 1))
    if (waits.length === 0) return null
    const next: PageSpec = {
      ...built.spec,
      steps: built.spec.steps.map((one) => (waits.includes(one.name) ? { ...one, when: 'button' as const } : one))
    }
    const again = compile(next, {
      operations: this.operations(),
      signatures: SPEC_SIGNATURES,
      pageId: built.manifest.pageId,
      taken: [],
      allowStorage: this.o.allowStorage === true
    })
    return isCompileError(again) ? null : again
  }

  /** Whether a repaired Page is now fit to offer. */
  private checkBuilt(built: Compiled, carried: readonly Defect[]): { ready: boolean; validation: ValidationResult } {
    const evidence = this.tryRun(built.document)
    const validation = this.gates(built, evidence)
    const stillWrong = carried.some((one) => one.severity === 'error')
    return { ready: validation.passed && complaintFrom(built.document, evidence) === null && !stillWrong, validation }
  }

  /** A session taken to ready, for a Page that was repaired rather than written correctly the first time. */
  private finish(session: GenerationSession, built: Compiled, validation: ValidationResult): GenerationSession {
    const afterCompile = compiledStage(session, built, this.now())
    if (isSessionError(afterCompile)) return session
    const afterGates = validated(afterCompile, validation, this.now())
    if (isSessionError(afterGates)) return afterCompile
    const afterRun = tried(afterGates, validation, this.now())
    return isSessionError(afterRun) ? afterGates : afterRun
  }

  /**
   * A fresh session for a second attempt, carrying the history of the first.
   *
   * A new session object rather than a rewind, because the state machine has no backwards transition -- adding one
   * so this could reuse a session would put a move into the machine that exists for one caller's convenience and is
   * then available to every other.
   */
  private restart(session: GenerationSession, request: string, profileId: string, startedAt: number): GenerationSession {
    return {
      ...session,
      stage: 'planning',
      attempts: session.attempts + 1,
      startedAt,
      request,
      profileId,
      updatedAt: this.now(),
      spec: null,
      built: null,
      validation: null,
      failure: null,
      history: [...session.history, { stage: 'planning' as const, at: this.now(), note: 'Writing it again with what was wrong.' }].slice(-40)
    }
  }

  private stop(session: GenerationSession, failure: Failure): GenerationOutcome {
    const stopped = failedStage(session, failure, this.now())
    return {
      session: isSessionError(stopped) ? { ...session, stage: 'failed', failure } : stopped,
      compiled: null,
      resolution: session.resolution
    }
  }

  /** Somebody changed their mind while it was being built. */
  stopFor(session: GenerationSession): GenerationSession {
    const stopped = cancel(session, this.now())
    return isSessionError(stopped) ? session : stopped
  }
}

/** The errors from a compile, as sentences somebody can read. */
export const explainProblems = (problems: readonly SpecProblem[]): string[] =>
  problems.filter((one) => one.severity === 'error').map((one) => (one.at === '' ? one.message : `${one.at}: ${one.message}`))
