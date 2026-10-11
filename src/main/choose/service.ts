import { methodFor, run } from '../../shared/choose/engine.ts'
import { explainPrompt, plainWords, verdictOf, type Verdict } from '../../shared/choose/explain.ts'
import { extractPrompt, isNotADecision, readExtraction } from '../../shared/choose/extract.ts'
import type { ChooseReply, Kept as WasKept } from '../../shared/choose/reply.ts'
import { difference, readScenario, runScenario, scenarioPrompt } from '../../shared/choose/scenario.ts'
import { fragility } from '../../shared/choose/sensitivity.ts'
import { applyChanges, changePrompt, decisionSketch, readChanges, type Change } from '../../shared/choose/update.ts'
import { isRefusal, no, type Decision, type Refusal, type Result, type Scenario } from '../../shared/choose/types.ts'
import type { Detail } from '../../shared/choose/detect.ts'
import type { ChooseStore, Kept } from './store.ts'

/**
 * The thing that runs a decision from end to end.
 *
 * Thirteen steps on paper; what matters is which of them a model does and which of them it does not. Orion reads
 * the message and writes the wording. **Everything in between is arithmetic**: what is weighed, how it is scaled,
 * what the hard requirements rule out, who leads, how steady that is. Nothing a model says is ever added up.
 *
 * ## Two model calls for a new decision, one for a change, none for a control
 *
 * Laying out a decision needs one call; putting the result into words needs another. A follow-up needs one (what
 * changed) and reuses the engine's own wording unless the answer actually moved. A slider on the card needs none
 * at all -- it is a change with the change already known, and it must feel instant.
 *
 * ## Why the work is queued per conversation
 *
 * Somebody who sends "cost matters more" and then "add a third option" two seconds later must get both, in that
 * order, on top of each other. Running them at once means each starts from the decision as it was, and whichever
 * finishes second overwrites the other. So every operation for a conversation goes through one chain. It costs a
 * little waiting and removes the whole class of bug.
 *
 * ## Why nothing is thrown away on failure
 *
 * The stored decision is only replaced when a step has fully succeeded. A model that does not answer, JSON that
 * does not parse, a change naming an id that is not there -- each leaves the last good decision exactly as it was
 * and reports what happened. The alternative is somebody losing a comparison they built up over ten messages
 * because the fifteenth call timed out.
 */

export interface ChooseOptions {
  store: ChooseStore
  /** The same one-shot ask the labs and the quiz use. Null when no model is configured. */
  ask(prompt: string): Promise<string | null>
  /** Handed in so this file has no clock of its own. */
  now?(): number
}

/**
 * What every operation answers with.
 *
 * The shape itself lives in `src/shared/choose/reply.ts`, so the window reads exactly what this writes and the
 * guards that tell the three outcomes apart exist once.
 */
export type Answer = ChooseReply

export interface StartAsked {
  conversationId: string
  message: string
  /** Everything the person has written in this conversation, for checking what was actually mentioned. */
  said: string
  /** Earlier turns, oldest first, for context. */
  before: readonly string[]
  sort: Parameters<typeof extractPrompt>[0]['sort']
  named: readonly string[]
  /** True when they have asked to be told rather than asked. */
  justDecide?: boolean
}

const SAID_LIMIT = 12_000
const BEFORE_LIMIT = 8

export class Choose {
  private readonly o: ChooseOptions

  private readonly now: () => number

  /** One chain per conversation, so operations land in the order they arrived. */
  private readonly chains = new Map<string, Promise<unknown>>()

  /** The latest ticket per conversation, for spotting an answer that has been overtaken. */
  private readonly tickets = new Map<string, number>()

  /**
   * The last result worked out for a decision, against the inputs it was worked out from.
   *
   * Asking "explain that again" or "why not option C" changes nothing, and running the sensitivity sweep a second
   * time for an unchanged decision is hundreds of pointless passes over the same arithmetic. Keyed by a print of
   * everything that affects the sums, so it cannot be served for a decision that has moved on.
   */
  private readonly worked = new Map<string, { print: string; result: Result; fragility: ReturnType<typeof fragility> }>()

  constructor(o: ChooseOptions) {
    this.o = o
    this.now = o.now ?? ((): number => Date.now())
  }

  // ---------------------------------------------------------------- the queue

  private inOrder<T>(conversationId: string, job: () => Promise<T>): Promise<T> {
    const before = this.chains.get(conversationId) ?? Promise.resolve()
    const mine = before.then(job, job)
    this.chains.set(
      conversationId,
      mine.then(
        () => undefined,
        () => undefined
      )
    )
    return mine
  }

  /**
   * The number this request gets, taken the moment it arrives rather than when it runs.
   *
   * That ordering is the whole point. Every operation for a conversation goes through one chain, so if the ticket
   * were taken inside the chain nothing newer could ever have started by the time a job finished, and the check
   * below would always say no. Taken here, a request that has something queued behind it knows it: both changes
   * still apply, in order, and only the last answer is drawn -- rather than two cards appearing in turn, the first
   * of them showing the decision half way through being changed.
   */
  private ticket(conversationId: string): number {
    const next = (this.tickets.get(conversationId) ?? 0) + 1
    this.tickets.set(conversationId, next)
    return next
  }

  private overtaken(conversationId: string, ticket: number): boolean {
    return (this.tickets.get(conversationId) ?? 0) > ticket
  }

  /**
   * The decision a request is about: the one it names, or the one open in the conversation.
   *
   * A card names its own, because a conversation can hold more than one and the buttons on a card have to work on
   * the comparison they are drawn from. A typed message names none, and then the most recently touched one is
   * right -- "add another option" means the thing you were just looking at.
   *
   * A named decision belonging to another conversation is refused rather than used. Nothing in the window would
   * send one, which is exactly why it is worth refusing: it means a card can never reach into a conversation it
   * is not part of.
   */
  private async working(conversationId: string, decisionId?: string): Promise<Kept | null> {
    if (!decisionId) return this.o.store.openIn(conversationId)
    const named = await this.o.store.get(decisionId)
    if (!named) return null
    return named.decision.conversationId === conversationId ? named : null
  }

  // ---------------------------------------------------------------- the arithmetic, once per state

  /**
   * Everything that affects the sums, as one string.
   *
   * Only the parts the engine reads: the title, the history and the timestamps are deliberately out, because a
   * decision whose title changed has the same answer and recomputing it would be work for nothing.
   */
  private printOf(decision: Decision): string {
    return JSON.stringify([
      decision.policy,
      decision.criteria.map((one) => [one.id, one.importance, one.direction, one.scaling, one.unit, one.target ?? null, one.bands ?? null, one.scale ?? null]),
      decision.alternatives.map((one) => [one.id, one.values, one.outcomes ?? null]),
      decision.constraints.map((one) => [one.id, one.criterionId, one.test, one.limit])
    ])
  }

  private think(decision: Decision, runNumber: number): { result: Result; fragility: ReturnType<typeof fragility> } {
    const print = this.printOf(decision)
    const had = this.worked.get(decision.id)
    if (had && had.print === print) return { result: had.result, fragility: had.fragility }

    const result = run(decision, { run: runNumber, now: this.now() })
    const found = fragility(decision, result)
    this.worked.set(decision.id, { print, result, fragility: found })
    // Only the decisions in play are kept; past a few dozen this is a leak rather than a cache.
    if (this.worked.size > 32) for (const key of [...this.worked.keys()].slice(0, this.worked.size - 32)) this.worked.delete(key)
    return { result, fragility: found }
  }

  // ---------------------------------------------------------------- Orion's wording

  /**
   * The answer in Orion's words, or the engine's own.
   *
   * Never both and never neither: a failed call falls back to sentences assembled from the numbers, which read a
   * little flat and are exactly right. Nothing is invented to cover an outage.
   */
  private async wording(verdict: Verdict, asked: string): Promise<string> {
    const plain = plainWords(verdict)
    try {
      const text = await this.o.ask(explainPrompt(verdict, asked))
      const said = (text ?? '').trim()
      /*
       * A model that answers with a fence, a heading or a preamble has not followed the instruction, and the
       * cheapest honest response is to use the engine's wording rather than show whatever came back.
       */
      if (said === '' || said.length > 2400 || said.startsWith('```') || said.startsWith('#')) return plain
      return said
    } catch {
      return plain
    }
  }

  // ---------------------------------------------------------------- a new decision

  async start(asked: StartAsked): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const said = asked.said.slice(-SAID_LIMIT)

      let text: string | null
      try {
        text = await this.o.ask(
          extractPrompt({
            message: asked.message,
            before: asked.before.slice(-BEFORE_LIMIT),
            sort: asked.sort,
            named: asked.named
          })
        )
      } catch (error) {
        return no('The comparison could not be worked out.', error instanceof Error ? error.message : String(error), 'extract threw')
      }
      if (text === null || text.trim() === '') {
        return no('Orion did not answer.', 'Try again in a moment, or say what the options are and what matters to you.', 'no answer')
      }

      const read = readExtraction(text, {
        said,
        conversationId: asked.conversationId,
        id: `dc_${this.now().toString(36)}_${ticket}`,
        now: this.now(),
        sort: asked.sort
      })
      if (isNotADecision(read)) return read
      if (isRefusal(read)) return read

      /*
       * The method comes from the shape of the decision, not from the model. A decision where only one option
       * clears the hard requirements is settled by those requirements, and weighing it anyway would produce a
       * ranking in which the winner is an option that is not allowed.
       */
      const picked = methodFor(read.decision)
      const decision: Decision = { ...read.decision, policy: { ...read.decision.policy, method: picked.method } }

      const { result, fragility: found } = this.think(decision, 1)
      const verdict = verdictOf(decision, result, found, {
        orionSuggested: read.askThem,
        ...(asked.justDecide ? { justDecide: true } : {})
      })
      const withWords: Verdict = { ...verdict, says: await this.wording(verdict, asked.message) }

      const stored = await this.o.store.put({ id: decision.id, decision, result, scenarios: [] })
      if (!stored) {
        // Written and not readable back. Still answered -- the analysis is correct -- but not claimed as kept.
        return {
          verdict: { ...withWords, notes: [...withWords.notes, 'This comparison could not be written to disk, so it will not survive closing Orbis.'] },
          ...(this.overtaken(asked.conversationId, ticket) ? { stale: true } : {})
        }
      }

      return { verdict: withWords, ...(this.overtaken(asked.conversationId, ticket) ? { stale: true } : {}) }
    })
  }

  // ---------------------------------------------------------------- a follow-up

  async change(asked: { conversationId: string; message: string }): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const open = await this.o.store.openIn(asked.conversationId)
      if (!open) return no('There is no comparison open here to change.', 'Say what you are choosing between and I will start one.', 'nothing open')

      let text: string | null
      try {
        text = await this.o.ask(changePrompt(open.decision, asked.message))
      } catch (error) {
        return no('That change could not be worked out.', error instanceof Error ? error.message : String(error), 'change threw')
      }
      if (text === null || text.trim() === '') {
        return no('Orion did not answer.', 'Try saying it another way.', 'no answer')
      }

      const read = readChanges(text)
      if (read.startOver) {
        return { notADecision: true, because: 'that is a different decision, not a change to this one' }
      }
      if (read.changes.length === 0) {
        return no('Nothing in that changes the comparison.', 'Say what to add, take out, or weigh differently.', 'no changes')
      }

      return this.applyAndAnswer(open, read.changes, asked.message, ticket, asked.conversationId)
    })
  }

  /**
   * A change from a control on the card rather than from a message.
   *
   * No model is involved: the change is already known, which is the whole point of the control. The wording falls
   * back to the engine's own, so dragging a slider is as fast as the arithmetic and no faster.
   */
  async adjust(asked: { conversationId: string; decisionId?: string; changes: readonly Change[] }): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const open = await this.working(asked.conversationId, asked.decisionId)
      if (!open) return no('There is no comparison open here to change.', 'Start one and the controls will work on it.', 'nothing open')
      if (asked.changes.length === 0) return no('Nothing was changed.', 'Try the control again.', 'no changes')
      return this.applyAndAnswer(open, asked.changes, '', ticket, asked.conversationId, { quiet: true })
    })
  }

  private async applyAndAnswer(
    open: Kept,
    changes: readonly Change[],
    message: string,
    ticket: number,
    conversationId: string,
    o: { quiet?: boolean } = {}
  ): Promise<Answer> {
    const applied = applyChanges(open.decision, changes, { now: this.now(), from: message })
    if (applied.applied.length === 0) {
      return no(
        'That change could not be made.',
        applied.refused[0] ?? 'Say it another way and I will try again.',
        'nothing applied'
      )
    }

    /*
     * The method is reconsidered, because a change can alter the shape of the decision: a new hard requirement that
     * only one option clears turns a weighing-up into an elimination, and carrying on weighing would rank an option
     * that is now ruled out.
     */
    const picked = methodFor(applied.decision)
    const decision: Decision = { ...applied.decision, policy: { ...applied.decision.policy, method: picked.method } }

    const { result, fragility: found } = this.think(decision, (open.result?.run ?? 0) + 1)
    const verdict = verdictOf(decision, result, found)
    const says = o.quiet ? plainWords(verdict) : await this.wording(verdict, message || applied.applied.join(' '))

    const stored = await this.o.store.put({ ...open, decision, result })
    const notes = stored ? verdict.notes : [...verdict.notes, 'This change could not be written to disk, so it will not survive closing Orbis.']

    return {
      verdict: { ...verdict, says, notes },
      applied: applied.applied,
      ...(applied.refused.length ? { refused: applied.refused } : {}),
      ...(this.overtaken(conversationId, ticket) ? { stale: true } : {})
    }
  }

  // ---------------------------------------------------------------- a what-if

  async whatIf(asked: { conversationId: string; message: string }): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const open = await this.o.store.openIn(asked.conversationId)
      if (!open) return no('There is no comparison open here to ask a what-if about.', 'Start one first.', 'nothing open')

      let text: string | null
      try {
        text = await this.o.ask(scenarioPrompt(open.decision, asked.message))
      } catch (error) {
        return no('That what-if could not be worked out.', error instanceof Error ? error.message : String(error), 'scenario threw')
      }
      if (text === null || text.trim() === '') return no('Orion did not answer.', 'Try saying it another way.', 'no answer')

      const read = readScenario(text, open.decision, { id: `sc_${this.now().toString(36)}_${ticket}`, now: this.now() })
      if (!read.scenario) {
        return no('That what-if could not be applied to this comparison.', read.cannotDo || 'Try naming what should be different.', 'no scenario')
      }

      const base = this.think(open.decision, open.result?.run ?? 1)
      const after = runScenario(open.decision, read.scenario, { run: (open.result?.run ?? 1) + 1, now: this.now() })
      /*
       * The sensitivity sweep is of the what-if, not of the real decision, because that is what somebody is looking
       * at -- and it is run against the patched values, so "how solid is that" means the hypothetical's solidity.
       */
      const patched = this.underScenario(open.decision, read.scenario)
      const found = fragility(patched, after)
      const verdict = verdictOf(patched, after, found)
      const moved = difference(base.result, after)

      const says = await this.wording(verdict, `${asked.message}\n\n(this is a what-if: ${read.scenario.name})`)

      /*
       * A what-if changes nothing on disk except the list of what-ifs asked about. The decision keeps the figures
       * the person actually gave, so "go back to the original" needs nothing undone.
       */
      const scenarios: Scenario[] = [read.scenario, ...open.scenarios.filter((one) => one.id !== read.scenario?.id)].slice(0, 12)
      await this.o.store.put({ ...open, scenarios })

      return {
        verdict: { ...verdict, says },
        difference: moved,
        scenario: read.scenario.name,
        ...(this.overtaken(asked.conversationId, ticket) ? { stale: true } : {})
      }
    })
  }

  /**
   * The decision as a what-if sees it, for the parts of the explanation that read the decision rather than the
   * result -- the units, the names, the targets.
   *
   * A copy, used for one answer and dropped. The stored decision never sees any of this.
   */
  private underScenario(decision: Decision, scenario: Scenario): Decision {
    return {
      ...decision,
      title: `${decision.title} — ${scenario.name}`,
      criteria: decision.criteria
        .filter((one) => !scenario.without?.includes(one.id))
        .map((one) => (scenario.weights?.[one.id] !== undefined ? { ...one, importance: scenario.weights[one.id] } : one)),
      constraints: decision.constraints.map((one) => (scenario.limits?.[one.id] !== undefined ? { ...one, limit: scenario.limits[one.id] } : one)),
      alternatives: decision.alternatives.map((one) => {
        const values = { ...one.values }
        for (const [key, held] of Object.entries(scenario.values ?? {})) {
          const [alternativeId, criterionId] = key.split('/')
          if (alternativeId === one.id && criterionId) values[criterionId] = held
        }
        return { ...one, values }
      })
    }
  }

  // ---------------------------------------------------------------- more of the working

  /**
   * An answer to a question about the result, grounded in the result.
   *
   * No arithmetic is redone -- the question does not change anything -- so the cached run is used and the whole
   * cost is one model call. If that fails, what comes back is the part of the verdict the question was about,
   * which is less fluent and still answers it.
   */
  async explain(asked: { conversationId: string; decisionId?: string; of: Detail; message: string }): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const open = await this.working(asked.conversationId, asked.decisionId)
      if (!open) return no('There is no comparison open here.', 'Start one first.', 'nothing open')

      const { result, fragility: found } = this.think(open.decision, open.result?.run ?? 1)
      const verdict = verdictOf(open.decision, result, found)

      const wanted = {
        everything: 'Walk through the whole thing: every option, what each was judged on, the figures, and where each one stands against the hard requirements.',
        'why-not': 'Explain why the other options did not win, one short paragraph each, in the terms of the table.',
        'how-it-worked': `Explain the method and why it suits this decision. The method used: ${verdict.howItWorked}`,
        'what-would-change-it': 'Explain what would have to be different for the answer to change, using only what is said above about how solid it is and what is still unknown.'
      }[asked.of]

      let says = ''
      try {
        const text = await this.o.ask(`${explainPrompt(verdict, asked.message)}\n\nInstead of the four sentences above: ${wanted}\nKeep it under two hundred words and stay inside the figures given.`)
        says = (text ?? '').trim()
      } catch {
        says = ''
      }
      if (says === '' || says.length > 3000) {
        says = [
          plainWords(verdict),
          verdict.howItWorked,
          ...verdict.notes,
          ...(asked.of === 'what-would-change-it' && verdict.uncertainty ? [verdict.uncertainty] : [])
        ]
          .filter((one) => one.trim() !== '')
          .join(' ')
      }

      // The decision is untouched: nothing here changed anything, so nothing is written.
      return { verdict: { ...verdict, says }, ...(this.overtaken(asked.conversationId, ticket) ? { stale: true } : {}) }
    })
  }

  /** The best answer available with no further questions, because they asked to be told. */
  async justDecide(asked: { conversationId: string; message: string }): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const open = await this.o.store.openIn(asked.conversationId)
      if (!open) return no('There is no comparison open here.', 'Say what you are choosing between.', 'nothing open')

      const { result, fragility: found } = this.think(open.decision, open.result?.run ?? 1)
      const verdict = verdictOf(open.decision, result, found, { justDecide: true })
      const says = await this.wording(verdict, asked.message)
      return { verdict: { ...verdict, says }, ...(this.overtaken(asked.conversationId, ticket) ? { stale: true } : {}) }
    })
  }

  // ---------------------------------------------------------------- keeping it

  /**
   * Keeps the open decision.
   *
   * Reads back what was written before saying it is kept, because a save that is claimed and did not happen is the
   * one failure here that loses somebody's work without telling them.
   */
  async keep(asked: { conversationId: string; decisionId?: string }): Promise<WasKept | Refusal> {
    return this.inOrder(asked.conversationId, async () => {
      const open = await this.working(asked.conversationId, asked.decisionId)
      if (!open) return no('There is no comparison open here to keep.', 'Start one first.', 'nothing open')
      const ok = await this.o.store.keep(open.decision.id)
      if (!ok) return no('That could not be saved.', 'Something else may have the file open. Try again in a moment.', 'keep failed')
      return { kept: true as const, title: open.decision.title }
    })
  }

  /** The kept ones, for a list. */
  async kept(): Promise<{ decisions: readonly { id: string; title: string; question: string; changedAt: number; leads: string | null }[] }> {
    const all = await this.o.store.savedOnes()
    return {
      decisions: all.map((one) => ({
        id: one.decision.id,
        title: one.decision.title,
        question: one.decision.question,
        changedAt: one.decision.changedAt,
        leads: one.result?.leaderId ? one.decision.alternatives.find((two) => two.id === one.result?.leaderId)?.name ?? null : null
      }))
    }
  }

  /** Brings a kept decision into a conversation, so follow-ups land on it. */
  async reopen(asked: { decisionId: string; conversationId: string; message: string }): Promise<Answer> {
    const ticket = this.ticket(asked.conversationId)
    return this.inOrder(asked.conversationId, async () => {
      const had = await this.o.store.get(asked.decisionId)
      if (!had) return no('That comparison is not here any more.', 'It may have been removed.', 'not found')

      /*
       * Re-pointed at this conversation, and the answer is worked out again rather than the stored one being shown.
       * The arithmetic is deterministic, so it is the same answer -- and if this Orbis scales something differently
       * from the one that saved it, showing a figure it would not produce today is worse than showing a new one.
       */
      const decision: Decision = { ...had.decision, conversationId: asked.conversationId, changedAt: this.now() }
      const { result, fragility: found } = this.think(decision, (had.result?.run ?? 0) + 1)
      const verdict = verdictOf(decision, result, found)
      const says = await this.wording(verdict, asked.message || decision.question)
      await this.o.store.put({ ...had, decision, result })
      return { verdict: { ...verdict, says }, ...(this.overtaken(asked.conversationId, ticket) ? { stale: true } : {}) }
    })
  }

  async forget(asked: { decisionId: string }): Promise<{ gone: boolean }> {
    const gone = await this.o.store.remove(asked.decisionId)
    this.worked.delete(asked.decisionId)
    return { gone }
  }

  /** The open decision as a short summary, for keeping a long conversation's context without the transcript. */
  async sketch(conversationId: string): Promise<{ sketch: string } | null> {
    const open = await this.o.store.openIn(conversationId)
    return open ? { sketch: decisionSketch(open.decision) } : null
  }

  flush(): Promise<void> {
    return this.o.store.flush()
  }
}
