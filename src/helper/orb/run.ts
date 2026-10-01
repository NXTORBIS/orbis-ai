import { HelperError } from '../server.ts'
import type { Handler } from '../server.ts'
import type { PanelControl } from '../browserControl.ts'
import { PendingApprovals } from '../browser/host.ts'
import { createEyes, describeCapabilities, describeWorld } from './perceive.ts'
import {
  MAX_REPEATS,
  MAX_REPLANS,
  nextPass,
  describeOutcome,
  groundPlan,
  newTask,
  runnable,
  settle,
  stuck
} from '../../shared/orbTask.ts'
import type { OrbStep, OrbTaskState, Perception } from '../../shared/orbTask.ts'
import { isFollowUp, needsContext, resolve } from '../../shared/orbReference.ts'
import { asEvidence, holdsSecret, isConsequential, redact, refusedProtection } from '../../shared/orbSafety.ts'

/**
 * The Orb's control loop.
 *
 * Observe, perceive, understand, contextualise, reason, plan, decompose, select capabilities, execute, observe again,
 * verify, recover, re-plan, continue, complete. Not as a slogan -- as the actual shape of `orb:ask` below, where each
 * of those is a step that can fail and be recovered from.
 *
 * What it is built on is as important as what it does. Every action runs through the Browser Control Layer that
 * already exists, which already retries, verifies its own work and reports structured errors. Orion is asked through
 * the same chat the rest of Orbis uses, so Auto Mode picks the model. Research, Vision, image generation, Voice,
 * workflows, skills and memory are the existing channels. There is no second automation engine here, and there is no
 * second browser: this decides what to ask those systems for, and what to make of what they say.
 *
 * The rules it will not break:
 *
 *   - A step is done when the browser confirms it (src/shared/orbTask.ts). Sending a command is not doing a thing.
 *   - A plan may only contain capabilities the registry really has and says are available, right now.
 *   - A page is evidence, never instructions (src/shared/orbSafety.ts).
 *   - Anything consequential is gated on a person, from the capability's own policy.
 *   - Protections are not obstacles: a request to get past one is refused in words.
 *   - What could not be done is reported as not done, with the reason the browser gave.
 */

export interface OrbDeps {
  control(): PanelControl | null | undefined
  /** One question to Orion, answered in full. Auto Mode chooses the model; this never names one. */
  ask(prompt: string, signal: AbortSignal, options?: { image?: string }): Promise<string>
  /** The existing channels, so the Orb coordinates Orbis rather than reimplementing it. */
  channel(name: string, args: unknown[], ctx: { emit(event: unknown): void; signal: AbortSignal }): Promise<unknown>
  /** Which channels exist right now, so the Orb offers only what this Orbis actually has. */
  has(name: string): boolean
}

const NEWLINE = String.fromCharCode(10)
const MAX_STEPS = 24

/** JSON out of an answer that may be fenced or wrapped in prose. Nothing rather than a guess. */
function jsonFrom(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer)?.[1]
  for (const candidate of [fenced, answer]) {
    if (!candidate) continue
    const start = candidate.search(/[[{]/)
    if (start < 0) continue
    const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'))
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      // Not JSON after all.
    }
  }
  return null
}

/** Steps as a planner returned them, made into the shape the loop runs. Anything malformed is dropped, not repaired. */
function readSteps(raw: unknown): OrbStep[] {
  const out: OrbStep[] = []
  for (const [i, item] of (Array.isArray(raw) ? raw : []).entries()) {
    const o = (item ?? {}) as Record<string, unknown>
    const capability = typeof o.capability === 'string' ? o.capability.trim() : ''
    if (!capability) continue
    const id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `s${i + 1}`
    out.push({
      id,
      name: String(o.name ?? capability).slice(0, 120),
      capability,
      params: o.params && typeof o.params === 'object' && !Array.isArray(o.params) ? (o.params as Record<string, unknown>) : {},
      needs: Array.isArray(o.needs) ? o.needs.filter((n): n is string => typeof n === 'string').slice(0, 8) : [],
      ...(typeof o.saveAs === 'string' && o.saveAs ? { saveAs: o.saveAs.slice(0, 40) } : {}),
      ...(o.optional === true ? { optional: true } : {}),
      /*
       * A loop, when the plan asked for one.
       *
       * Both are read from the plan rather than inferred: steps that belong together say so by sharing a group, and
       * how many times they go round is a number, not a guess. Clamped, because a plan asking for a thousand passes
       * is a mistake rather than a request.
       */
      ...(typeof o.group === 'string' && o.group ? { group: o.group.slice(0, 40) } : {}),
      ...(Number.isFinite(Number(o.repeat)) && Number(o.repeat) > 1
        ? { repeat: Math.min(Math.trunc(Number(o.repeat)), MAX_REPEATS), pass: 1 }
        : {}),
      status: 'planned',
      tries: 0
    })
    if (out.length >= MAX_STEPS) break
  }
  return out
}

/**
 * Turning a request into a plan the browser could actually carry out.
 *
 * The planner is shown what the browser can really do and where it really is, and told to use nothing else. What it
 * proposes is then grounded against the registry anyway (`groundPlan`), because being told is not the same as being
 * prevented -- a plan naming a capability Orbis does not have is refused rather than attempted.
 */
async function planSteps(
  request: string,
  perception: Perception,
  deps: OrbDeps,
  signal: AbortSignal,
  note?: string,
  /**
   * What has already been done, and worked.
   *
   * Without this a second attempt plans the whole task again from the beginning, and every part that had already
   * succeeded is done a second time. Asked to open YouTube and read its title, a re-plan opened YouTube again --
   * three tabs, from three attempts, because each one was planned as though nothing had happened yet.
   *
   * Those steps are kept either way; the planner simply was not told about them. For opening a tab that is three
   * tabs and an annoyance. For anything that sends, buys or deletes it is the same mistake with a real cost, which
   * is why it is fixed here rather than guarded against one capability at a time.
   */
  done?: readonly OrbStep[]
): Promise<{ steps: OrbStep[]; refused: { step: OrbStep; why: string }[]; said: string }> {
  const already = (done ?? []).filter((s) => s.status === 'done')
  const prompt = [
    'You are planning actions for a web browser. Use only the capabilities listed; there are no others.',
    '',
    'What the browser can do right now:',
    describeCapabilities(perception.capabilities),
    '',
    'Where the browser is right now:',
    describeWorld(perception),
    '',
    note ? `This is a second attempt. What went wrong before: ${note}` : '',
    already.length
      ? [
          'These parts are already done and confirmed. Do not do them again:',
          ...already.map((s) => `- ${s.name} (${s.capability})`),
          'Plan only what is still left to do.'
        ].join(NEWLINE)
      : '',
    `The person asked: ${request}`,
    '',
    'Give the shortest sequence of capability calls that does what they asked. Rules:',
    '- Use only capability ids from the list above, exactly as written.',
    '- Use only parameters that capability declares.',
    '- Do not repeat anything listed above as already done.',
    '- "needs" lists the ids of steps that must finish first. Steps with no needs may run in any order.',
    '- "saveAs" names a result later steps can use.',
    /*
     * How to ask for something to happen repeatedly, and how to wait for something to happen at all.
     *
     * Both are said here because neither is guessable from a list of capabilities: a planner that has never been
     * told a loop exists writes the same three steps out five times, and one that has not been told to wait reaches
     * for a pause and hopes.
     */
    '- To do something repeatedly, give the steps that repeat the same "group" name and put "repeat": <times> on the first of them. Do not write the same steps out more than once.',
    '- To wait for something rather than guessing how long it takes, use a waiting capability (media.waitFor for a video, page.waitFor for an element or a page, downloads.waitFor for a download). Never plan a fixed delay when one of those can answer.',
    '- If the request needs no browser action at all, return an empty array.',
    '',
    'Reply with only a JSON array of {"id","name","capability","params","needs","saveAs","group","repeat"}.'
  ]
    .filter(Boolean)
    .join(NEWLINE)

  const said = await deps.ask(prompt, signal).catch(() => '')
  const grounded = groundPlan(readSteps(jsonFrom(said)), perception.capabilities)
  return { ...grounded, said }
}

export function createOrbHandlers(deps: OrbDeps): Record<string, Handler> {
  const eyes = createEyes(deps.control)
  const approvals = new PendingApprovals()
  /** What the last task produced, so "use the previous result" and "make it darker" mean something real. */
  let lastVariables: Record<string, unknown> = {}
  let lastOrder: string[] = []
  let lastAnswer = ''

  /** Runs one step against the real browser, and settles it from what the browser reported. */
  async function act(
    step: OrbStep,
    emit: (event: unknown) => void,
    signal: AbortSignal,
    /*
     * Whether this capability changes anything, from the live registry.
     *
     * Settling needs it: an absent verification means "nothing proved this happened" for something that changes the
     * browser, and "there was never anything to prove" for something that only looks.
     */
    mutates = true
  ): Promise<OrbStep> {
    const control = deps.control()
    if (!control) return settle(step, { ok: false, error: { code: 'unavailable', message: 'The browser is not ready.', recoverable: false }, attempts: 0 })

    // Never put a secret in a plan, in history, or in anything a model is shown.
    if (holdsSecret(step.params)) {
      return settle(step, { ok: false, error: { code: 'blocked', message: 'That step would have carried something private. Orbis will not send it.', recoverable: false }, attempts: 0 })
    }

    emit({ type: 'step', step: { id: step.id, name: step.name, capability: step.capability, status: 'running' } })
    try {
      const outcome = (await control.execute(
        { capability: step.capability, params: step.params, source: 'user' },
        {
          confirm: () => {
            const confirmation = {
              id: `orb-${step.id}-${Math.random().toString(36).slice(2, 8)}`,
              action: step.name,
              reason: isConsequential(step.capability) ? 'This cannot be undone.' : 'This changes something in the browser.'
            }
            emit({ type: 'confirm', confirmation })
            return approvals.ask(confirmation, signal)
          }
        }
      )) as { ok: boolean; data?: unknown; error?: never; verification?: { verified: boolean; detail: string }; attempts?: number }

      const result = {
        ok: outcome.ok,
        data: outcome.data,
        error: (outcome as { error?: { code: string; message: string; recoverable: boolean } }).error,
        verification: outcome.verification,
        attempts: outcome.attempts ?? 1
      }
      return settle(step, result as never, mutates)
    } catch (error) {
      return settle(step, { ok: false, error: { code: 'failed', message: (error as Error)?.message ?? 'That did not work.', recoverable: true }, attempts: 1 })
    }
  }

  return {
    /**
     * One request, carried out.
     *
     * Streams what is happening as it happens -- perception, the plan, each step, each confirmation, each failure and
     * what was decided about it -- so a long task is watchable rather than a spinner, and a failed one is diagnosable.
     */
    'orb:ask': async ([raw], { emit, signal }): Promise<{ task: OrbTaskState; answer: string }> => {
      const request = typeof raw === 'string' ? raw.trim().slice(0, 4000) : ''
      if (!request) throw new HelperError('bad-request', 'Ask Orbis something.')

      // ---- a protection is not an obstacle. Refused in words, before anything is perceived or planned.
      const refused = refusedProtection(request)
      if (refused) {
        const task = newTask(`t${Date.now().toString(36)}`, request)
        task.status = 'failed'
        task.outcome = refused.why
        emit({ type: 'refused', what: refused.what, why: refused.why })
        return { task, answer: refused.why }
      }

      const task = newTask(`t${Date.now().toString(36)}`, request)

      // ---- observe and perceive: the real browser, read now
      emit({ type: 'status', message: 'Looking at the browser…' })
      const wantsText = needsContext(request) || /\b(summar|explain|read|what does|translate|extract)\b/i.test(request)
      task.perception = await eyes.look({ text: wantsText })

      // ---- contextualise: what "this", "that" and "the second one" are pointing at
      const following = isFollowUp(request, Boolean(lastAnswer) || lastOrder.length > 0)
      if (following) {
        task.variables = { ...lastVariables }
      }
      const pointed = resolve(request, task.perception, task.variables, lastOrder)
      if (pointed.referent) emit({ type: 'context', because: pointed.because })
      if (!pointed.referent && pointed.ask) {
        // Ambiguity that cannot be settled from what is there. Asking beats acting on the wrong thing.
        task.status = 'waiting'
        task.outcome = pointed.ask
        emit({ type: 'ask-user', question: pointed.ask })
        return { task, answer: pointed.ask }
      }

      // ---- reason and plan, against what the browser can really do
      emit({ type: 'status', message: 'Working out what to do…' })
      let { steps, refused: dropped } = await planSteps(request, task.perception, deps, signal)
      task.steps = steps
      for (const d of dropped) emit({ type: 'refused-step', name: d.step.name, why: d.why })

      // ---- nothing to do in the browser
      //
      // This was a question, a picture to make, something to look at, or something to read the web for -- and Orbis
      // already has one router that decides which of those it is and answers with the right system (orion:ask, which
      // does image generation, research with real sources, Vision on the page, and plain chat with Auto Mode choosing
      // the model). The Orb hands it over rather than deciding again, because deciding again is how two answers to
      // the same question start to differ.
      if (!steps.length) {
        if (!deps.has('orion:ask')) {
          // No router in this build. Answering directly is the honest fallback, not a second router.
          const page = task.perception.page
          const evidence = page?.text ? asEvidence({ url: page.url, title: page.title }, page.text) : ''
          const answer = await deps.ask([evidence, `The person asked: ${request}`].filter(Boolean).join(NEWLINE), signal)
          task.status = 'done'
          task.outcome = 'Answered.'
          lastAnswer = answer
          emit({ type: 'answer', text: answer })
          return { task, answer }
        }

        let answer = ''
        let routed = ''
        const outcome = (await deps.channel(
          'orion:ask',
          [{ text: request, seed: following && typeof lastVariables.__seed === 'number' ? lastVariables.__seed : undefined }],
          {
            signal,
            emit: (event) => {
              const e = (event ?? {}) as { type?: string; content?: unknown; seed?: unknown }
              // Everything the router streams reaches the Orb unchanged: its statuses, its sources, its picture.
              emit(event)
              if (e.type === 'delta' && typeof e.content === 'string') answer += e.content
              if (e.type === 'image' && typeof e.seed === 'number') lastVariables = { ...lastVariables, __seed: e.seed }
            }
          }
        )) as { routed?: string }
        routed = String(outcome?.routed ?? '')
        task.status = 'done'
        task.outcome = dropped.length
          ? `Nothing could be done in the browser: ${dropped[0].why}`
          : routed
            ? `Answered by ${routed}.`
            : 'Answered.'
        if (answer) lastAnswer = answer
        return { task, answer: answer || task.outcome }
      }

      // ---- execute, observe, verify, recover, re-plan
      task.status = 'running'
      emit({ type: 'plan', steps: task.steps.map((s) => ({ id: s.id, name: s.name, capability: s.capability, needs: s.needs })) })

      while (task.status === 'running') {
        if (signal.aborted) { task.status = 'stopped'; break }

        const go = runnable(task.steps, task.perception.capabilities)
        if (!go.length) {
          if (task.steps.every((s) => s.status === 'done' || s.status === 'skipped')) { task.status = 'done'; break }
          /*
         * A finished group with passes left goes round again before anything else is decided.
         *
         * Here, at the top of the loop, so a repeat is indistinguishable from the first pass to everything below it:
         * the same readiness, the same verification, the same recovery. A loop that ran through a different path
         * would be a second engine wearing the first one's name.
         */
        const again = nextPass(task.steps)
        if (again) {
          task.steps = again.steps
          emit({ type: 'status', message: `Round ${again.pass} of ${task.steps.find((x) => x.group === again.group)?.repeat ?? '?'}` })
          emit({ type: 'pass', group: again.group, pass: again.pass })
          continue
        }

        if (stuck(task.steps)) { task.status = 'failed'; break }
          break
        }

        // Reads can go together; anything that changes the browser goes alone. runnable() decides which.
        const done = await Promise.all(
          go.map((s) =>
            // What the registry says about this capability, now, rather than an assumption about its name.
            act(
              { ...s, status: 'running' },
              emit,
              signal,
              task.perception?.capabilities.find((c) => c.id === s.capability)?.mutates !== false
            )
          )
        )
        for (const finished of done) {
          const at = task.steps.findIndex((s) => s.id === finished.id)
          task.steps[at] = finished
          task.history.push({
            at: Date.now(),
            stepId: finished.id,
            capability: finished.capability,
            ok: finished.status === 'done',
            // Redacted before it is kept: history is read back, shown, and sometimes sent to a model.
            detail: JSON.stringify(redact({ params: finished.params, verified: finished.result?.verification?.detail ?? null })).slice(0, 400)
          })
          if (finished.saveAs && finished.status === 'done') {
            task.variables[finished.saveAs] = finished.result?.data
            lastOrder = [...lastOrder.filter((n) => n !== finished.saveAs), finished.saveAs]
          }
          emit({
            type: 'step',
            step: {
              id: finished.id,
              name: finished.name,
              capability: finished.capability,
              status: finished.status,
              ...(finished.failure ? { failure: finished.failure } : {}),
              ...(finished.result?.verification ? { verified: finished.result.verification.verified } : {})
            }
          })
        }

        // Anything that changed the browser makes what was perceived out of date.
        if (done.some((s) => task.perception?.capabilities.find((c) => c.id === s.capability)?.mutates !== false)) eyes.changed()

        // ---- recover
        const broken = done.find((s) => s.status === 'failed' && !s.optional)
        if (!broken) continue
        const recovery = broken.failure?.recovery ?? 'give-up'
        emit({ type: 'recovery', step: broken.name, kind: broken.failure?.kind, decision: recovery, why: broken.failure?.message })

        if (recovery === 'retry') {
          task.steps[task.steps.findIndex((s) => s.id === broken.id)] = { ...broken, status: 'planned' }
          continue
        }
        if (recovery === 're-perceive') {
          task.perception = await eyes.look({ text: wantsText, force: true })
          task.steps[task.steps.findIndex((s) => s.id === broken.id)] = { ...broken, status: 'planned' }
          continue
        }
        if (recovery === 're-plan') {
          if (task.replans >= MAX_REPLANS) { task.status = 'failed'; break }
          task.replans += 1
          emit({ type: 'status', message: 'That way did not work. Finding another…' })
          task.perception = await eyes.look({ text: wantsText, force: true })
          // What was already confirmed stays confirmed, and the planner is told so, or it plans it all again.
          const kept = task.steps.filter((s) => s.status === 'done')
          const again = await planSteps(request, task.perception, deps, signal, broken.failure?.message, kept)
          if (!again.steps.length) { task.status = 'failed'; break }
          task.steps = [...kept, ...again.steps.map((s) => ({ ...s, id: `r${task.replans}-${s.id}`, needs: [] }))]
          continue
        }
        if (recovery === 'ask-user') {
          task.status = 'waiting'
          task.outcome = broken.failure?.message ?? 'Orbis needs you for this step.'
          emit({ type: 'ask-user', question: task.outcome })
          break
        }
        task.status = 'failed'
        break
      }

      // ---- complete: say what really happened, verified or not
      if (task.status === 'running') task.status = task.steps.every((s) => s.status === 'done' || s.status === 'skipped') ? 'done' : 'failed'
      task.outcome = task.outcome ?? describeOutcome(task)
      lastVariables = { ...task.variables }

      emit({ type: 'outcome', status: task.status, text: task.outcome })
      return { task, answer: task.outcome }
    },

    /** The answer to a confirmation. Only a literal true approves; anything else and the step does not happen. */
    'orb:answer': ([id, approved]) => {
      if (typeof id !== 'string' || !id) throw new HelperError('bad-request', 'That is not an approval.')
      return { answered: approvals.answer(id, approved === true) }
    },

    /** What the Orb can see and do right now. What the Orb's own interface is drawn from. */
    'orb:state': async () => {
      const perception = await eyes.look()
      return {
        browser: Boolean(deps.control()),
        capabilities: perception.capabilities.length,
        available: perception.capabilities.filter((c) => c.available).length,
        tabs: perception.tabs.length,
        page: perception.page ? { url: perception.page.url, title: perception.page.title } : null,
        // Which of Orbis's own systems this build actually has. Never a claim about one it does not.
        systems: {
          research: deps.has('chat:send'),
          vision: deps.has('browser:do'),
          imagegen: deps.has('orion:ask'),
          voice: deps.has('voice:transcribe'),
          workflows: deps.has('workflows:list'),
          skills: deps.has('skills:list'),
          memory: deps.has('memory:list'),
          galaxy: deps.has('galaxy:graph'),
          notes: deps.has('notes:list'),
          tasks: deps.has('tasks:list'),
          whiteboard: deps.has('whiteboard:list'),
          workspaces: deps.has('workspaces:list'),
          tray: deps.has('tray:list')
        }
      }
    }
  }
}
