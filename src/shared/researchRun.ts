import type { Research } from './types.ts'

/** How fresh the information had to be. Named here so this file needs nothing from the main process. */
export type Recency = Research['recency']
import { readSourcePreferences, type SourceKind, type SourcePreferences } from './researchSources.ts'

/**
 * A research run you can see, change and hold, rather than one you can only stop.
 *
 * Research was a single call: a question went in, an answer came back, and the only control was to abort the whole
 * thing. So you could not see what it was about to search before it searched, could not say "stay on official
 * sources" once it had started without throwing away what it had already read, and could not hold it while you
 * thought. Stopping and starting again was the only way to change anything, which threw away every page it had read.
 *
 * This is the part of that which is arithmetic: what a plan is, what a change to a plan does to it, and what may be
 * changed once a stage has already happened. Research itself waits at stage boundaries and asks this what to do.
 *
 * Three rules:
 *
 * **Work already done is never thrown away.** A page that has been read stays read however the plan changes. That is
 * the whole reason for changing a plan mid-run rather than starting again, and anything that discarded it would make
 * steering worse than stopping.
 *
 * **A change can only affect what has not happened yet.** Asking for official sources after every page has been read
 * cannot un-read them, and saying so is better than silently reordering a list that is already fixed. What a change
 * can still reach is stated here, per stage, rather than decided by whichever code ran last.
 *
 * **Nothing here waits on a person unless somebody asked it to.** Showing the plan first is off by default: research
 * that stops to ask permission on every question is research nobody uses.
 */

/** Where a run has got to. Each stage is a point it can be held at or changed at. */
export type ResearchStage =
  /** Nothing has happened; the plan can be changed completely. */
  | 'planning'
  /** Searching. The queries are fixed; which sources are preferred is not. */
  | 'searching'
  /** Reading the pages found. Preferences still decide the order of what is left to read. */
  | 'reading'
  /** Everything is read. Nothing a change could reach. */
  | 'done'

export interface ResearchPlan {
  /** What will actually be searched for, in order. */
  readonly queries: readonly string[]
  /** How fresh the information has to be. */
  readonly recency: Recency
  /** Which kinds of source to lean towards, and which sites never to read. */
  readonly prefer: SourcePreferences
}

/** What somebody can change about a run, as a request rather than as a done thing. */
export interface ResearchChange {
  readonly queries?: readonly string[]
  readonly recency?: Recency
  readonly prefer?: readonly SourceKind[]
  readonly avoid?: readonly SourceKind[]
  readonly blocked?: readonly string[]
}

/** How many searches a plan may hold. The same ceiling research has always had. */
export const MAX_PLANNED_QUERIES = 3

const RECENCIES: readonly Recency[] = ['day', 'week', 'month', 'year', 'any']

/** A plan, with everything checked. Used both for the first plan and for every change to one. */
export function makePlan(raw: { queries?: readonly string[]; recency?: unknown; prefer?: unknown }): ResearchPlan {
  const queries: string[] = []
  for (const one of raw.queries ?? []) {
    const text = String(one).replace(/\s+/g, ' ').trim().slice(0, 200)
    if (text && !queries.some((have) => have.toLowerCase() === text.toLowerCase())) queries.push(text)
    if (queries.length >= MAX_PLANNED_QUERIES) break
  }
  return {
    queries,
    recency: RECENCIES.includes(raw.recency as Recency) ? (raw.recency as Recency) : 'any',
    prefer: readSourcePreferences(raw.prefer)
  }
}

/** Which parts of a plan a change can still reach at this stage. */
export function reachable(stage: ResearchStage): { queries: boolean; recency: boolean; sources: boolean } {
  switch (stage) {
    case 'planning':
      return { queries: true, recency: true, sources: true }
    case 'searching':
      // The searches are already away. Which of their results are preferred is still open.
      return { queries: false, recency: false, sources: true }
    case 'reading':
      // Everything found is found; preferences decide the order of what is left to read.
      return { queries: false, recency: false, sources: true }
    default:
      return { queries: false, recency: false, sources: false }
  }
}

export interface Applied {
  readonly plan: ResearchPlan
  /** What really changed, in the words somebody would use. Empty when the change reached nothing. */
  readonly changed: readonly string[]
  /** What was asked for but could not be done any more, and why. Said rather than silently dropped. */
  readonly tooLate: readonly string[]
}

/**
 * Applies a change to a plan at the stage it is actually at.
 *
 * Returns what changed and what was too late, because both have to be said: a person who asks for official sources
 * while the last page is being read needs to know the request arrived after it could do anything, rather than
 * believing it was applied and wondering why the answer looks the same.
 */
export function applyChange(plan: ResearchPlan, change: ResearchChange, stage: ResearchStage): Applied {
  const can = reachable(stage)
  const changed: string[] = []
  const tooLate: string[] = []

  let queries = plan.queries
  if (change.queries) {
    if (can.queries) {
      const next = makePlan({ queries: change.queries }).queries
      if (next.length && next.join('|') !== plan.queries.join('|')) {
        queries = next
        changed.push(`searching for ${next.map((q) => `"${q}"`).join(', ')}`)
      }
    } else {
      tooLate.push('the searches had already been sent')
    }
  }

  let recency = plan.recency
  if (change.recency && change.recency !== plan.recency) {
    if (can.recency) {
      recency = change.recency
      changed.push(change.recency === 'any' ? 'looking at pages of any age' : `wanting information from the past ${change.recency}`)
    } else {
      tooLate.push('the searches had already been sent, so how fresh they had to be was fixed')
    }
  }

  let prefer = plan.prefer
  const wantsSources = change.prefer !== undefined || change.avoid !== undefined || change.blocked !== undefined
  if (wantsSources) {
    if (can.sources) {
      prefer = readSourcePreferences({
        prefer: change.prefer ?? plan.prefer.prefer,
        avoid: change.avoid ?? plan.prefer.avoid,
        blocked: change.blocked ?? plan.prefer.blocked
      })
      if (change.prefer?.length) changed.push(`putting ${change.prefer.join(' and ')} sources first`)
      if (change.avoid?.length) changed.push(`putting ${change.avoid.join(' and ')} sources last`)
      if (change.blocked?.length) changed.push(`not reading ${change.blocked.join(', ')}`)
    } else {
      tooLate.push('every page had already been read')
    }
  }

  return { plan: { queries, recency, prefer }, changed, tooLate }
}

/** What to say about a change that was applied, or about one that arrived too late. Never both invented. */
export function changeNote(applied: Applied): string | null {
  if (applied.changed.length) return `Now ${applied.changed.join('; ')}.`
  if (applied.tooLate.length) return `That arrived too late to change anything: ${applied.tooLate[0]}.`
  return null
}

/** What a plan says it is going to do, for showing before it runs. */
export function describePlan(plan: ResearchPlan): string[] {
  const lines = plan.queries.map((q, i) => `${i + 1}. Search for "${q}"`)
  if (plan.recency !== 'any') lines.push(`Prefer information from the past ${plan.recency}`)
  if (plan.prefer.prefer.length) lines.push(`Put ${plan.prefer.prefer.join(' and ')} sources first`)
  if (plan.prefer.avoid.length) lines.push(`Put ${plan.prefer.avoid.join(' and ')} sources last`)
  if (plan.prefer.blocked.length) lines.push(`Do not read ${plan.prefer.blocked.join(', ')}`)
  return lines
}
