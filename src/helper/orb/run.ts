import { HelperError } from '../server.ts'
import type { Handler } from '../server.ts'
import type { PanelControl } from '../browserControl.ts'
import { PendingApprovals } from '../browser/host.ts'
import { createEyes, describeCapabilities, describeWorld } from './perceive.ts'
import {
  MAX_REPEATS,
  MAX_REPLANS,
  fillIn,
  nextPass,
  describeOutcome,
  groundPlan,
  newTask,
  runnable,
  settle,
  settleConditions,
  stuck
} from '../../shared/orbTask.ts'
import type { OrbCondition, OrbStep, OrbTaskState, Perception } from '../../shared/orbTask.ts'
import { isFollowUp, needsContext, resolve } from '../../shared/orbReference.ts'
import { looksLikeScheduleRequest, readRequest } from '../../shared/temporal/phrase.ts'
import { describeWanted, readChoice, visionQuestion, wantsEyes, WORTH_LOOKING_KINDS } from '../../shared/orbVision.ts'
import type { SeenElement } from '../../shared/orbVision.ts'
import { asEvidence, holdsSecret, isConsequential, redact, refusedProtection, wallInTheWay } from '../../shared/orbSafety.ts'

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
  /**
   * One question to Orion, answered in full.
   *
   * `image` is a data url for the few questions a picture answers, and `model` names the one that can see it: the
   * ordinary choice goes to a model with no eyes, which drops the picture and answers from text instead.
   */
  ask(prompt: string, signal: AbortSignal, options?: { image?: string; model?: string }): Promise<string>
  /** The existing channels, so the Orb coordinates Orbis rather than reimplementing it. */
  channel(name: string, args: unknown[], ctx: { emit(event: unknown): void; signal: AbortSignal }): Promise<unknown>
  /** Which channels exist right now, so the Orb offers only what this Orbis actually has. */
  has(name: string): boolean
  /**
   * The model that can look at a page, or null when none is set up.
   *
   * Asked rather than assumed, because the answer depends on which keys this copy of Orbis was built with -- and
   * "no model can see" has to be sayable out loud. Attaching a picture to a model without eyes gets it dropped on
   * the way out and answered from the page's text, which is a confident wrong answer.
   */
  eyes?(): { model: string } | null
}

const NEWLINE = String.fromCharCode(10)
const MAX_STEPS = 24

/** The longest a single request may keep the browser busy before it is stopped and said so. */
const MAX_TASK_MS = 20 * 60_000

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
/**
 * A condition from the plan, reduced to the few shapes it is allowed to have.
 *
 * Anything else is dropped rather than approximated, and a dropped condition means the step simply runs -- which is
 * the safe direction for a read and is why `groundPlan` is what stops a mutating step being planned on a guess. The
 * point of the narrow shape is that a condition can never be anything a page could turn into an instruction: there is
 * no expression here to evaluate, only a name and a comparison.
 */
/**
 * The shape of a saved result, for telling a planner what it may reach into.
 *
 * Shapes and never contents. A planner needs to know that `newWindow` holds an `id`, so it can write `{{newWindow.id}}`
 * instead of `{{newWindow}}`; it does not need the page text that another step saved, and putting that in a prompt
 * would send a page's contents to a model on every re-plan.
 */
function shapeOf(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return 'nothing'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'boolean') return 'true or false'
  if (Array.isArray(value)) {
    if (!value.length) return 'an empty list'
    return `a list of ${value.length}, each ${depth > 1 ? 'an item' : shapeOf(value[0], depth + 1)}`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 8)
    if (!keys.length) return 'an empty object'
    if (depth > 1) return `an object (${keys.join(', ')})`
    return `an object with ${keys.map((k) => `${k} (${shapeOf((value as Record<string, unknown>)[k], depth + 1)})`).join(', ')}`
  }
  return 'something'
}

function readCondition(raw: unknown): OrbCondition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const of = typeof o.of === 'string' ? o.of.trim().slice(0, 80) : ''
  if (!of || !/^[A-Za-z0-9_.]+$/.test(of)) return null

  const when: OrbCondition = { of }
  if (o.is === 'present' || o.is === 'empty' || o.is === 'true' || o.is === 'false') when.is = o.is
  else if (typeof o.equals === 'string' || typeof o.equals === 'number' || typeof o.equals === 'boolean') when.equals = o.equals
  else if (typeof o.contains === 'string') when.contains = o.contains.slice(0, 200)
  else if (Number.isFinite(Number(o.atLeast))) when.atLeast = Number(o.atLeast)
  else if (Number.isFinite(Number(o.atMost))) when.atMost = Number(o.atMost)
  if (o.not === true) when.not = true
  return when
}

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
      ...(readCondition(o.when) ? { when: readCondition(o.when) as OrbCondition } : {}),
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
          /*
           * What each finished step actually saved, by shape.
           *
           * Without this the planner knows a name and not what is behind it, so it writes {{newWindow}} where the
           * saved value is {id, tabs, focused} and the call is refused for passing an object where a number was
           * wanted. Keys, never values: a key list is what lets the next step reach into the thing, and the values
           * could be somebody's page text.
           */
          ...already.map((s) => `- ${s.name} (${s.capability})${s.saveAs ? ` → saved as ${s.saveAs}: ${shapeOf(s.result?.data)}` : ''}`),
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
    /*
     * How to make part of a plan depend on what the browser turns out to say.
     *
     * Said here because it is not guessable, and because without it the planner has only two bad options for "close
     * it if it is a duplicate": decide now, before anything has been looked at, or hand the question back to the
     * person who already answered it once.
     */
    "- To use what an earlier step found, put \"saveAs\" on it and write {{thatName}} in a later step's parameters. Use a path for part of it: {{page.title}}, {{tabs.0.url}}.",
    '- To make a step happen only sometimes, give it "when": {"of": "<a saveAs name, optionally with a path>", and one of "is": "present"|"empty"|"true"|"false", "equals": <value>, "contains": "<text>", "atLeast": <number>, "atMost": <number>}. Add "not": true for the opposite. A step whose condition turns out false is skipped, and so is anything that was only there to use its result.',
    '- "Otherwise" is two steps with opposite conditions on the same thing, not a different kind of step.',
    /*
     * "Until" asked for in the two things that already exist, rather than as a third.
     *
     * A group that repeats, whose members only run while something is true, stops the moment it stops being true --
     * and stops finished rather than stuck. Saying so here is what keeps a planner from inventing a fixed number of
     * passes for a request that did not have one, or a wait that hopes.
     */
    '- "Until" and "while" are a loop with a condition: give the group a "repeat" high enough to cover it and put "when" on its steps. The loop ends on the pass where the condition stops holding. There is no unbounded loop.',
    /*
     * Why this is said rather than left to be discovered.
     *
     * The Shorts run failed here: the plan was right -- wait until this one ends, then go to the next, three times --
     * and the second step waited fifteen seconds for a "next" button. There is no next button on a feed of short
     * videos, and given a list of capabilities containing a click, a model looks for something to click.
     */
    '- A feed of items shown one at a time (short videos, reels, stories) has no "next" button. Use feed.next to move to the next one; do not look for a button and do not plan a scroll by hand.',
    /*
     * Which of two things a request about the browser is about.
     *
     * The failure this prevents is specific and was the most embarrassing one available: somebody says "open browser
     * settings", and a planner holding a search capability and a browser full of web pages writes a web search for the
     * words "browser settings". It is a reasonable sentence and a completely wrong act, and nothing in a list of
     * capabilities distinguishes the two -- the distinction is in the request, so it is said here.
     *
     * Stated as priority rather than as a list of phrases, because the phrasings are endless and the ordering is not:
     * if something the browser itself owns does the job, nothing else should be reached for.
     */
    '- Parts of the browser itself -- settings, privacy, history, downloads, bookmarks, extensions, permissions, passwords, profiles -- are opened with the capability for them (surface.open), not by searching the web and not by typing their name into the address bar. "Open settings" opens settings; "search for settings" searches the web; "find a page explaining settings" searches the web.',
    '- Prefer the most direct capability that does the job. Never search the web for something the browser can answer: what was visited is in history, what was saved is in bookmarks, what was downloaded is in downloads, what is open is in the tab list.',
    '- Say which stretch of time by name ("today", "last-hour", "yesterday", "everything"), never by computing a timestamp. You do not know what time it is.',
    '- If the request needs no browser action at all, return an empty array.',
    '',
    'Reply with only a JSON array of {"id","name","capability","params","needs","saveAs","group","repeat","when"}.'
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

  /**
   * Looks at the page and picks which numbered element was meant, or null.
   *
   * Null for every reason there is -- no browser, no picture, no model that can see, nothing on the page, a model
   * that answered "none" or answered with a number the page never offered. Null means the ordinary recovery carries
   * on, which is the right outcome for all of them: looking is an extra chance, never a requirement.
   *
   * Nothing from the model reaches the browser except a number that the page itself produced.
   */
  async function lookForIt(step: OrbStep, page: Perception['page'], emit: (event: unknown) => void, signal: AbortSignal): Promise<number | null> {
    const wanted = describeWanted(step.params, step.failure?.message ?? '', step.name)
    if (!wanted) return null

    const choice = deps.eyes?.() ?? null
    if (!choice) {
      /*
       * Said once, plainly, rather than looking and quietly not looking.
       *
       * Without a Mistral key there is no model on this account that can see an image -- Groq serves none. Attaching
       * the picture anyway gets it dropped on the way out and answered from the page's text, which is the failure
       * this whole path exists to end.
       */
      emit({ type: 'status', message: 'I could look at the page, but no model that can see images is set up.' })
      return null
    }

    emit({ type: 'status', message: `Looking at the page for ${wanted}…` })

    const shot = await eyes.see()
    if (!shot) return null

    const snapshot = (await deps
      .control()
      ?.execute({ capability: 'page.snapshot', params: {}, source: 'user' }, { confirm: async () => false })
      .catch(() => null)) ?? null
    const elements = (snapshot?.ok ? ((snapshot.data as { elements?: SeenElement[] })?.elements ?? []) : []) as SeenElement[]
    if (!elements.length) return null

    const said = await deps
      .ask(visionQuestion(wanted, elements, page ?? undefined), signal, { image: shot, model: choice.model })
      .catch((err) => ` ${err instanceof Error ? err.message : String(err)}`)

    /*
     * What came back is said, not summarised away.
     *
     * "Nothing came back from looking at the page" was the message for every failure here, and it is the least useful
     * sentence available: it reads the same whether the model refused, answered in prose, or was never reached at
     * all. Each of those needs a different fix, and the only way to tell them apart is to repeat what it said.
     */
    if (said.startsWith(' ')) {
      emit({ type: 'status', message: `Looking at the page failed: ${said.slice(1, 120)}` })
      return null
    }

    const read = readChoice(said, elements)
    if ('why' in read) {
      const quoted = said.trim() ? ` It said: "${said.trim().slice(0, 90)}"` : ' It said nothing at all.'
      emit({ type: 'status', message: `${read.why}${quoted}` })
      return null
    }
    const picked = elements.find((e) => e.ref === read.ref)
    emit({ type: 'status', message: `On the page that is ${picked?.label ? `"${picked.label}"` : `number ${read.ref}`}.` })
    return read.ref
  }

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

      /*
       * "Tomorrow at nine" is not a browser task, it is a time.
       *
       * Asked before anything is perceived or planned, because planning it would be planning to do it now -- which
       * is precisely what somebody who said tomorrow did not ask for. The Orb hands it to the scheduler Orbis
       * already has; it does not keep a clock of its own.
       *
       * The same strict reader the chat uses, behind the same gate: a message has to begin like a request and carry
       * no "I" and no question mark, because "every day I open this and it is slow" parses perfectly and is not a
       * request to open it every day.
       */
      if (deps.has('schedules:add') && looksLikeScheduleRequest(request)) {
        const reading = readRequest(request, Date.now())
        if (reading.ok) {
          const task = newTask(`t${Date.now().toString(36)}`, request)
          emit({ type: 'status', message: 'Setting that up for later…' })
          const kept = (await deps
            .channel('schedules:add', [{ phrase: request }], { emit, signal })
            .catch(() => null)) as { ok?: boolean; said?: string; problems?: string[]; why?: string } | null

          if (kept && kept.ok) {
            task.status = 'done'
            task.outcome = `Scheduled: ${kept.said ?? reading.said}`
            emit({ type: 'outcome', status: 'done', text: task.outcome })
            /*
             * Said with what it cannot do, every time.
             *
             * A schedule somebody believes will run with their computer off is one they find out about after the
             * moment has gone, which is not recoverable. It is one sentence and it belongs here.
             */
            return {
              task,
              answer: `${task.outcome}. It runs on this computer with Orbis open; if Orbis is closed when it is due, I do it next time you open it and say how late it was.`
            }
          }

          const why = (kept && (kept.problems?.[0] ?? kept.why)) ?? 'Orbis could not keep that schedule.'
          task.status = 'failed'
          task.outcome = why
          emit({ type: 'outcome', status: 'failed', text: why })
          return { task, answer: why }
        }
        /*
         * A phrase that could not be read falls through to the ordinary path.
         *
         * Being told "I could not find a time in that" for a sentence that was never about a time is worse than an
         * ordinary answer, and some of them are real browser tasks that merely open like a schedule.
         */
      }

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

      /*
       * A task may take a long time and may not take for ever.
       *
       * Waiting for a video to end, a download to finish or a page to load is minutes, legitimately -- so there is no
       * honest short limit. But a plan that has stopped making progress for reasons nobody will notice is a browser
       * doing something unattended, and the person who asked has long since looked away. Measured from here, not
       * per step, because it is the whole task's running away that matters.
       */
      const deadline = Date.now() + MAX_TASK_MS

      /*
       * Which steps have already been looked at, so a picture is taken once per step and not once per attempt.
       *
       * Looking twice at the same failure asks the same model the same question about the same screen and gets the
       * same answer, slowly. If the first look did not settle it, the ordinary recovery is the better next move.
       */
      const looked = new Set<string>()

      while (task.status === 'running') {
        if (signal.aborted) { task.status = 'stopped'; break }
        if (Date.now() > deadline) {
          task.status = 'failed'
          task.outcome = `This took longer than ${Math.round(MAX_TASK_MS / 60000)} minutes, so I stopped. ${task.steps.filter((x) => x.status === 'done').length} of ${task.steps.length} steps were finished.`
          emit({ type: 'outcome', status: 'failed', text: task.outcome })
          break
        }

        /*
         * The branches that did not happen are written down before anything is chosen to run.
         *
         * Here rather than inside `runnable`, because skipping is a change to the plan and `runnable` only reports on
         * one. A step whose condition came out false becomes a visible "skipped" with a reason, which is an answer --
         * rather than a step that quietly never ran, which a person reading the run cannot tell from a bug.
         */
        task.steps = settleConditions(task.steps, task.variables)

        const go = runnable(task.steps, task.perception.capabilities, task.variables)
        if (!go.length) {
          /*
           * A finished group with passes left goes round again, and that is asked first.
           *
           * Before "everything is done, so the task is done" -- which is the whole point. Asked after it, a group
           * that had just completed its first pass was declared finished and the loop never ran: a plan that said
           * twice did it once, and reported success for it. The question "is there another pass owed" has to come
           * before the question "is there anything left to do", because the answer to the first changes the second.
           *
           * It goes round at the top of the same loop everything else runs in, so a repeat is indistinguishable from
           * a first pass to every line below: the same readiness, the same verification, the same recovery.
           */
          const again = nextPass(task.steps)
          if (again) {
            task.steps = again.steps
            emit({ type: 'status', message: `Round ${again.pass} of ${task.steps.find((x) => x.group === again.group)?.repeat ?? '?'}` })
            emit({ type: 'pass', group: again.group, pass: again.pass })
            continue
          }

          if (task.steps.every((s) => s.status === 'done' || s.status === 'skipped')) { task.status = 'done'; break }
          if (stuck(task.steps, task.variables)) { task.status = 'failed'; break }
          break
        }

        // Reads can go together; anything that changes the browser goes alone. runnable() decides which.
        const done = await Promise.all(
          go.map((s) =>
            // What the registry says about this capability, now, rather than an assumption about its name.
            act(
              /*
               * Filled in now, not at planning time.
               *
               * A plan is written before the browser has been asked anything, so a step that needs the previous
               * step's answer could only ever have guessed it. `{{tabs}}` becomes the list that step actually
               * returned, at the moment this one runs.
               */
              { ...s, status: 'running', params: fillIn(s.params, task.variables) },
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
        /*
         * Before deciding how to recover, look at whether there is a door in the way.
         *
         * A sign-in wall or a human-verification page does not fail a step in a way that says so -- it replaces the
         * page, so the element the plan wanted is merely absent. Left to the ordinary recovery that becomes two more
         * attempts, a re-plan, and finally "I could not find the button": true, useless, and hiding the one thing the
         * person could have fixed in five seconds.
         *
         * Only asked after a failure, and only for the failures a wall would cause. A detector that ran on every page
         * would be a detector looking for reasons to stop.
         */
        const pageish = broken.failure?.kind === 'not-found' || broken.failure?.kind === 'stale' || broken.failure?.kind === 'timeout' || broken.failure?.kind === 'unverified'
        if (pageish) {
          task.perception = await eyes.look({ text: true, force: true })
          const door = wallInTheWay(task.perception.page)
          if (door) {
            const finished = task.steps.filter((x) => x.status === 'done').length
            task.status = 'waiting'
            task.outcome =
              door.what === 'captcha'
                ? `The page is asking to verify that a person is here. ${door.why} Do that in the browser and say "continue" — ${finished} of ${task.steps.length} steps are already done and I will carry on from there.`
                : `That page wants you signed in. ${door.why} Sign in in the browser and say "continue" — ${finished} of ${task.steps.length} steps are already done and I will carry on from there.`
            // The run's own ending emits the outcome; this says what kind of stop it is, which the panel shows differently.
            emit({ type: 'blocked', what: door.what, text: task.outcome })
            break
          }
        }

        /*
         * Looking at the page, for the one failure a picture can answer.
         *
         * "The thumbnail of the latest interview", "the red button", "the chart on the right" -- a page's structure
         * holds none of that. Every one of those may be a link with an image inside it whose accessible name is
         * somebody's video title, and no amount of reading the tree says which picture is of an interview.
         *
         * Three rules keep it a fallback rather than a habit, and they are all in `wantsEyes`: only after reading has
         * failed to find the thing, only when what was wanted was described in words rather than addressed exactly,
         * and only once per step. A screenshot costs a capture, a round trip and a model; reading the page costs none
         * of those and answers almost everything.
         *
         * The answer is grounded, never obeyed. The model picks from the page's own numbered elements and a number
         * the page did not offer is refused -- so nothing here can produce a place on the screen to click, which a
         * model's idea of where something is would be.
         */
        /*
         * Why looking was or was not tried, said out loud.
         *
         * Twice during this work the eyes silently did not open and the run looked identical to one where they had
         * opened and found nothing. A decision nobody can see is a decision nobody can debug -- and the person
         * watching deserves to know whether Orbis considered looking at the page.
         */
        if (WORTH_LOOKING_KINDS.has(broken.failure?.kind ?? '') && !looked.has(broken.id)) {
          const words = describeWanted(broken.params, broken.failure?.message ?? '', broken.name)
          if (!words) {
            emit({
              type: 'status',
              message: `Not worth looking at the page for this: ${JSON.stringify(redact(broken.params)).slice(0, 90)} does not describe something by sight.`
            })
          }
        }

        if (wantsEyes(broken.failure?.kind ?? '', broken.params, broken.failure?.message ?? '', broken.name) && !looked.has(broken.id)) {
          looked.add(broken.id)
          const chosen = await lookForIt(broken, task.perception?.page ?? null, emit, signal)
          if (chosen !== null) {
            task.steps[task.steps.findIndex((s) => s.id === broken.id)] = {
              ...broken,
              status: 'planned',
              // The ref replaces the words: an exact address for the element that was actually on the screen.
              params: { ...broken.params, locator: { ref: chosen } },
              failure: undefined
            }
            continue
          }
        }

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
