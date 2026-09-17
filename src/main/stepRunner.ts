import type { CommandResult, Condition, ControlError } from '../shared/browserControl.ts'
import type { CaptchaEncounter, PageSignals } from '../shared/captcha.ts'
import { abandon, askUser, captchaStep, detect, isOpen, notice, recheck, verified } from '../shared/captcha.ts'
import {
  beginStep,
  describe,
  finish,
  isRunning,
  newSession,
  nextStep,
  pause,
  progress,
  proposeStep,
  publicSession,
  readyCommand,
  recordExecution,
  recordVerification,
  replan,
  resume,
  skipStep,
  stop,
  userDone
} from '../shared/stepPlan.ts'
import type { SessionStatus, StepDraft, StepRunView, StepSession } from '../shared/stepPlan.ts'

/**
 * Working through a goal in the real browser, one step at a time.
 *
 * `stepPlan.ts` holds the rules about what may follow what; this is what actually happens. It asks the planner for the
 * next step, hands it to the Browser Control Layer Orbis already has, looks at the page afterwards, and only then goes
 * back for the step after it. There is no second automation engine here: every action is a control-layer command, with
 * the same approvals, the same logging and the same verification as anything else Orbis does.
 *
 * Two things happen around every step rather than inside it.
 *
 * The browser is looked at before a step is planned, so the assistant plans against what is on the screen now rather
 * than what it was on the screen when the goal was given. A plan made against a remembered page is how an assistant
 * ends up clicking confidently on nothing.
 *
 * And the page is checked for a challenge before and after each step. When one is found, the run stops where it is,
 * the person is asked, and nothing is retried past it. Orbis does not answer challenges; it waits for someone who can.
 */

export interface StepRunnerDeps {
  /** Runs one command through the control layer. */
  execute(command: { capability: string; params: Record<string, unknown>; target?: { tabId?: string; webContentsId?: number } }, runId: string): Promise<CommandResult>
  /** What the page says about itself right now, for challenge detection. Already free of secrets. */
  signals(target?: { tabId?: string; webContentsId?: number }): Promise<PageSignals>
  /** A short description of the page for the assistant to plan against. */
  observe(): Promise<string>
  /** Asks the assistant what to do next, given the goal, the page, and what has happened. Returns nothing when done. */
  plan(request: PlanRequest): Promise<PlanReply>
  /** Told whenever anything changes, with a session that is already safe to show. */
  emit(view: StepRunnerView): void
  newId(): string
  now?(): number
  /** Waiting between looks at a page that is still arriving. Replaceable so tests need not really wait. */
  wait?(ms: number): Promise<void>
}

/** How many times, and how far apart, a page is looked at before a step is judged not to have worked. */
const SETTLE_LOOKS = 5
const SETTLE_MS = 700

export interface PlanRequest {
  goal: string
  /** What the page looks like now. */
  page: string
  /** What has been done, as intents and outcomes — never parameters, never reasoning. */
  history: { intent: string; outcome: 'worked' | 'did not work' | 'skipped'; detail?: string }[]
  /** Names of what earlier steps saved, so the assistant can refer to them without being handed the values. */
  variables: string[]
  /** Set when the last step failed, so the assistant can try another way rather than the same way again. */
  lastFailure?: string
}

export type PlanReply =
  /** Do this next. */
  | { kind: 'step'; step: StepDraft }
  /** The goal is reached. */
  | { kind: 'done'; summary: string }
  /** The page is not what the plan assumed; throw the rest away and think again. */
  | { kind: 'replan'; why: string }
  /** It cannot be done, and saying so is better than flailing. */
  | { kind: 'give-up'; why: string }

export type StepRunnerView = StepRunView

/** A goal being worked through. One per run; several may exist at once, in different tabs. */
export class StepRun {
  private session: StepSession
  private readonly deps: StepRunnerDeps
  private readonly now: () => number
  private readonly wait: (ms: number) => Promise<void>
  private captcha: CaptchaEncounter | null = null
  private lastFailure: string | undefined
  private running = false

  constructor(options: { id: string; profileId: string; goal: string; maxSteps?: number }, deps: StepRunnerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.wait = deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.session = newSession({ ...options, now: this.now() })
  }

  get id(): string {
    return this.session.id
  }

  get state(): StepSession {
    return this.session
  }

  view(): StepRunnerView {
    return { session: publicSession(this.session), saying: describe(this.session), captcha: this.captcha && isOpen(this.captcha) ? this.captcha : undefined }
  }

  /** The status now, read through a call so nothing is answered from what it was before the last await. */
  private statusNow(): SessionStatus {
    return this.session.status
  }

  private changed(): void {
    this.deps.emit(this.view())
  }

  private set(session: StepSession): void {
    this.session = session
    this.changed()
  }

  // ---------------------------------------------------------------- the loop

  /** Works through the goal until it is reached, cannot be, or something is waiting for a person. */
  async start(): Promise<StepSession> {
    if (this.running) return this.session
    this.running = true
    // Said straight away: a person who asked for something should see it being worked on before the first step exists.
    this.changed()
    try {
      while (isRunning(this.statusNow()) && this.statusNow() !== 'waiting') {

        const ready = nextStep(this.session)
        if (!ready) {
          // Nothing to run: ask what comes next, against the page as it is now rather than as it was.
          const more = await this.think()
          if (!more) break
          continue
        }
        await this.runOne(ready.id)
        // Read fresh each time round: the step may have stopped the run, and a person may have paused it while it ran.
        if (this.statusNow() === 'waiting' || this.statusNow() === 'paused') break
      }
    } finally {
      this.running = false
      this.changed()
    }
    return this.session
  }

  /** Asks for one more step, having first looked at the page. Returns whether there is more to do. */
  private async think(): Promise<boolean> {
    // A challenge standing in the way is not something to plan around.
    if (await this.challengeInTheWay()) return false

    const page = await this.deps.observe().catch(() => 'The page could not be read.')
    const reply = await this.deps.plan({
      goal: this.session.goal,
      page,
      history: this.session.steps.map((step) => ({
        intent: step.intent,
        outcome: step.phase === 'success' ? 'worked' : step.phase === 'failed' ? 'did not work' : 'skipped',
        detail: step.phase === 'failed' ? (step.error?.message ?? step.note) : undefined
      })),
      variables: Object.keys(this.session.variables),
      lastFailure: this.lastFailure
    })
    this.lastFailure = undefined

    switch (reply.kind) {
      case 'step':
        this.set(proposeStep(this.session, reply.step, this.deps.newId(), this.now()))
        return isRunning(this.session.status)
      case 'replan':
        this.set(replan(this.session, reply.why, this.now()))
        return isRunning(this.session.status)
      case 'done':
        this.set(finish(this.session, reply.summary, this.now()))
        return false
      default:
        this.set(stop(this.session, reply.why, this.now()))
        return false
    }
  }

  /** Think, execute, verify — in that order, and the browser decides the last one. */
  private async runOne(stepId: string): Promise<void> {
    this.set(beginStep(this.session, stepId, this.now()))
    const step = this.session.steps.find((s) => s.id === stepId)
    if (!step || step.phase !== 'executing') return

    const command = readyCommand(this.session, step)
    if (!command) {
      // Nothing to run and nobody to wait for: a step that says what it wants but not how is no step at all.
      this.set(recordExecution(this.session, stepId, { ok: false, error: { code: 'invalid-params', message: 'That step said what it wanted but not how to do it.', recoverable: false } }, this.now()))
      return
    }

    const result = await this.deps.execute(command, this.session.id).catch(
      (err): CommandResult => ({ ok: false, capability: command.capability, error: { code: 'failed', message: err instanceof Error ? err.message : 'It did not work.', recoverable: true }, attempts: 1, durationMs: 0 })
    )

    // A challenge that appeared while the step was running explains the failure, and is what to do about it.
    if (await this.challengeInTheWay(command.target)) {
      this.set(skipStep(this.session, stepId, 'A site asked to verify a person, so Orbis stopped here.', this.now()))
      return
    }

    // When the step said what to expect, that is what decides — the control layer's own check is about whether the
    // command did what a command does, which is a smaller question than whether the step did what it was for.
    this.set(
      recordExecution(
        this.session,
        stepId,
        { ok: result.ok, error: result.error, summary: summarize(result.data), verification: step.expect ? undefined : result.verification },
        this.now()
      )
    )

    const after = this.session.steps.find((s) => s.id === stepId)
    if (after?.phase === 'verifying') {
      this.set(recordVerification(this.session, stepId, await this.check(step.expect, command.target), this.now()))
    }
    const settled = this.session.steps.find((s) => s.id === stepId)
    if (settled?.phase === 'failed' || settled?.phase === 'retrying') {
      this.lastFailure = settled.error?.message ?? settled.note
    }
  }

  /**
   * Looks at the browser to see whether the step did what it was for.
   *
   * When the step said what to expect, that is asked of the real browser through `state.check`. When it did not, the
   * control layer's own verification has already been taken; reaching here without one means nothing looked, and
   * nothing looked means not verified. Silence is not agreement.
   */
  private async check(expect: Condition | undefined, target?: { tabId?: string; webContentsId?: number }): Promise<{ verified: boolean; detail: string }> {
    if (!expect) {
      return { verified: false, detail: 'Nothing checked the page afterwards, so Orbis is not treating this as done.' }
    }
    // A click that starts a navigation returns before the new page has arrived, so the first look can be too early.
    // The page is asked again a few times over a few seconds — each time the real browser, never an assumption — and
    // a step that still does not match after that has genuinely not worked.
    let detail = 'The page did not end up the way this step needed it to.'
    for (let look = 0; look < SETTLE_LOOKS; look++) {
      if (look > 0) await this.wait(SETTLE_MS)
      const result = await this.deps
        .execute({ capability: 'state.check', params: { condition: expect as unknown as Record<string, unknown> }, target }, this.session.id)
        .catch((): CommandResult => ({ ok: false, capability: 'state.check', error: { code: 'failed', message: 'The page could not be checked.', recoverable: true }, attempts: 1, durationMs: 0 }))
      if (!result.ok) {
        detail = result.error?.message ?? 'The page could not be checked.'
        continue
      }
      if ((result.data as { value?: boolean })?.value === true) return { verified: true, detail: 'The page is as the step needed it to be.' }
    }
    return { verified: false, detail }
  }

  // ---------------------------------------------------------------- challenges

  /**
   * Whether a site is asking for a person, and if so, stopping.
   *
   * Nothing is retried past this and nothing is worked around. The run holds where it is, with everything it has
   * already done left intact, and waits to be told the person has dealt with it.
   */
  private async challengeInTheWay(target?: { tabId?: string; webContentsId?: number }): Promise<boolean> {
    const signals = await this.deps.signals(target).catch(() => null)
    if (!signals) return false
    const found = detect(signals)

    if (!found.present) {
      // One that was in the way has gone: the page itself says so, which is the only thing that would.
      if (this.captcha && isOpen(this.captcha)) {
        this.captcha = recheck(this.captcha, signals, this.now())
        this.changed()
      }
      return false
    }
    if (this.captcha && isOpen(this.captcha)) return true

    const encounter = notice(found, { id: this.deps.newId(), tabId: target?.tabId ?? 'active', profileId: this.session.profileId, url: signals.url }, this.now())
    if (!encounter) return false
    this.captcha = askUser(encounter, this.now())

    // It becomes an ordinary step that waits for a person, so the run pauses through the machinery it already has.
    const draft = captchaStep(this.captcha)
    const id = this.deps.newId()
    this.set(proposeStep(this.session, draft, id, this.now()))
    this.set(beginStep(this.session, id, this.now()))
    return true
  }

  /** The person says they have dealt with the challenge. The page is looked at before that is believed. */
  async captchaDone(): Promise<StepSession> {
    if (!this.captcha || !isOpen(this.captcha)) return this.session
    const signals = await this.deps.signals({ tabId: this.captcha.tabId }).catch(() => null)
    this.captcha = signals ? recheck(this.captcha, signals, this.now()) : this.captcha

    const waiting = this.session.steps.find((step) => step.phase === 'waiting')
    if (!verified(this.captcha)) {
      // Still there. The run stays where it is rather than being told a comforting thing.
      this.changed()
      return this.session
    }
    if (waiting) {
      this.set(userDone(this.session, waiting.id))
      this.set(recordVerification(this.session, waiting.id, { verified: true, detail: 'The challenge is no longer on the page.' }, this.now()))
    }
    return this.start()
  }

  // ---------------------------------------------------------------- what a person can do to a run

  pauseRun(why?: string): void {
    this.set(pause(this.session, why))
  }

  async resumeRun(): Promise<StepSession> {
    this.set(resume(this.session))
    return this.start()
  }

  stopRun(why = 'Stopped.'): void {
    if (this.captcha) this.captcha = abandon(this.captcha, why, this.now())
    this.set(stop(this.session, why, this.now()))
  }

  async skipCurrent(why = 'Skipped.'): Promise<StepSession> {
    const current = this.session.steps.find((step) => step.phase === 'waiting' || step.phase === 'ready' || step.phase === 'retrying')
    if (!current) return this.session
    if (this.captcha && isOpen(this.captcha)) this.captcha = abandon(this.captcha, why, this.now())
    this.set(skipStep(this.session, current.id, why, this.now()))
    this.set(resume({ ...this.session, status: this.statusNow() === 'waiting' ? 'paused' : this.statusNow() }))
    return this.start()
  }

  summary(): { done: number; planned: number; failed: number } {
    const p = progress(this.session)
    return { done: p.done, planned: p.planned, failed: p.failed }
  }
}

/** A short, plain version of what a command returned, small enough to keep and dull enough to show. */
function summarize(data: unknown): unknown {
  if (data === null || data === undefined) return undefined
  if (typeof data === 'string') return data.length > 500 ? `${data.slice(0, 500)}…` : data
  if (typeof data === 'number' || typeof data === 'boolean') return data
  if (Array.isArray(data)) return data.slice(0, 20).map(summarize)
  const entries = Object.entries(data as Record<string, unknown>).slice(0, 20)
  return Object.fromEntries(entries.map(([key, value]) => [key, summarize(value)]))
}

/** Failures that mean the assistant should try another way rather than the same way again. */
export function worthReplanning(error: ControlError | undefined): boolean {
  return error?.code === 'not-found' || error?.code === 'stale-element' || error?.code === 'unavailable'
}
