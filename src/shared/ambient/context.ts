/**
 * What somebody is doing, worked out from what they have been doing.
 *
 * ## One rule above all the others
 *
 * **A confident wrong answer costs more than no answer.** Everything here is tuned around that. Several
 * independent signals are needed before a context is called certain; a single page about something produces a
 * weak guess at best; and `shouldShow` keeps the weak ones off the screen entirely. Somebody who is shown
 * "Physics" while they shop for shoes stops believing the feature, and never checks again.
 *
 * ## Why there are several contexts and not one
 *
 * People do two things at once — a work tab group and a study tab group, Orion open about one of them. A single
 * `currentContext` would flip between them every time attention moved and would be wrong half the time. So
 * activity is grouped into clusters, each with its own subject and evidence, and one of them is *dominant* based
 * on what has been touched most recently and most deliberately.
 *
 * ## Everything is explained
 *
 * Every context carries the evidence that produced it, in words. It is what the inspector shows, what "why do you
 * think this?" answers, and the only practical way to tell a good inference from a lucky one while building this.
 */

import { freshness, weightOf, type Activity } from './activity.ts'
import { entitiesOf, keywordsOf, meaningOfSite, nameFor, topicsOf, type Entity, type Topic } from './topics.ts'
import { hostOf } from './activity.ts'

/** What somebody is doing, as opposed to what it is about. */
export type Intent =
  | 'browsing'
  | 'searching'
  | 'researching'
  | 'learning'
  | 'studying'
  | 'writing'
  | 'coding'
  | 'shopping'
  | 'comparing'
  | 'watching'
  | 'reading'
  | 'organising'
  | 'listening'
  | 'focusing'

export type Band = 'certain' | 'likely' | 'possible' | 'unknown'

export interface Evidence {
  /** In plain words, for a person: "the page you are on is called Projectile Motion". */
  says: string
  /** How much this contributed, 0..1. */
  weight: number
}

export interface AmbientContext {
  id: string
  profileId: string
  /** What it would be called on screen. Never an id. */
  title: string
  subject: string | null
  concept: string | null
  intent: Intent
  /** 0..1, and the band derived from it. The band is what anything user-facing should read. */
  confidence: number
  band: Band
  entities: Entity[]
  /** The activity ids this was built from, newest first. */
  activityIds: string[]
  startedAt: number
  lastAt: number
  /** Total attention, in seconds, from the dwell on its activities. */
  seconds: number
  evidence: Evidence[]
  state: 'active' | 'recent' | 'dormant'
}

/** Above this, a context may be shown and acted on. Below it, Orbis keeps its guess to itself. */
export const SHOW_FROM = 0.62

export function bandFor(confidence: number): Band {
  if (confidence >= 0.85) return 'certain'
  if (confidence >= SHOW_FROM) return 'likely'
  if (confidence >= 0.4) return 'possible'
  return 'unknown'
}

/** Whether this is worth putting in front of somebody. The gate between an inference and a claim. */
export function shouldShow(context: AmbientContext | null): boolean {
  if (!context) return false
  if (context.confidence < SHOW_FROM) return false
  // One page is never enough, however well it is named.
  if (context.activityIds.length < 2) return false
  return context.subject !== null || context.concept !== null
}

/**
 * Whether two activities belong to the same piece of work.
 *
 * Two tests, and both are needed. Sharing a subject is what makes a tab about kinematics and a PDF about
 * kinematics one thing. Being close in time is what stops this morning's physics and tonight's physics becoming
 * a single nine-hour context that claims to be what somebody is doing now.
 */
export function related(a: Activity, b: Activity, aTopics: readonly Topic[], bTopics: readonly Topic[], withinMinutes = 45): boolean {
  if (Math.abs(a.at - b.at) > withinMinutes * 60_000) return false
  const subjects = new Set(aTopics.map((one) => one.subject))
  if (bTopics.some((one) => subjects.has(one.subject))) return true
  // The same site in the same stretch of time is usually the same piece of work.
  const host = hostOf(a.url)
  if (host && host === hostOf(b.url)) return true
  // Words in common between two titles, when there are enough of them to mean something.
  const words = new Set(keywordsOf(a.title))
  const shared = keywordsOf(b.title).filter((one) => words.has(one)).length
  return shared >= 2
}

const INTENT_FOR_DOING: Readonly<Record<string, Intent>> = {
  code: 'coding',
  watch: 'watching',
  read: 'reading',
  research: 'researching',
  shop: 'shopping',
  write: 'writing',
  learn: 'learning'
}

/**
 * What somebody is doing, from the shape of their activity rather than any single event.
 *
 * Ordered by how much each thing proves. A Focus session is somebody declaring it; everything below is inference,
 * and the last line is the honest shrug.
 */
export function intentOf(activities: readonly Activity[], hasFocus: boolean): { intent: Intent; why: string } {
  if (hasFocus) return { intent: 'studying', why: 'a Focus session is running' }

  const kinds = activities.map((one) => one.kind)
  const count = (kind: string): number => kinds.filter((one) => one === kind).length

  if (count('search') >= 2 && activities.length >= 4) {
    return { intent: 'researching', why: 'several searches and several pages, close together' }
  }
  if (count('note-edited') >= 1 && activities.length >= 3) return { intent: 'writing', why: 'you have been editing a note' }
  if (count('orion-asked') >= 2) return { intent: 'learning', why: 'you have asked Orion more than once' }

  // What the sites themselves are for, when enough of them agree.
  const doings = activities.map((one) => meaningOfSite(hostOf(one.url))?.doing).filter((one): one is string => !!one)
  if (doings.length >= 2) {
    const tally = new Map<string, number>()
    for (const one of doings) tally.set(one, (tally.get(one) ?? 0) + 1)
    const [best, howMany] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    if (howMany >= 2 && INTENT_FOR_DOING[best]) {
      return { intent: INTENT_FOR_DOING[best], why: `most of what is open is for ${best === 'code' ? 'code' : `${best}ing`}` }
    }
  }

  if (count('search') >= 1) return { intent: 'searching', why: 'you searched for something' }
  if (count('file-opened') >= 1) return { intent: 'reading', why: 'you opened a file' }
  return { intent: 'browsing', why: 'nothing stronger than ordinary browsing' }
}

export interface BuildOptions {
  profileId: string
  now: number
  /** The subject of a running Focus session, when there is one. The strongest signal there is. */
  focusSubject?: string | null
  id: string
}

/**
 * One cluster of activity turned into a context.
 *
 * The confidence is built up from independent agreements rather than set from a table: each distinct kind of
 * evidence adds, and the total is capped so nothing can ever be certain from one source saying the same thing
 * repeatedly.
 */
export function buildContext(activities: readonly Activity[], options: BuildOptions): AmbientContext | null {
  if (activities.length === 0) return null
  const rows = [...activities].sort((a, b) => b.at - a.at)
  const evidence: Evidence[] = []

  // ---- what it is about
  const votes = new Map<string, { subject: string; concept: string | null; score: number; from: Set<string> }>()
  for (const one of rows) {
    const weight = weightOf(one) * freshness(one.at, options.now)
    for (const topic of topicsOf(one.title, one.kind)) {
      const key = `${topic.subject}|${topic.concept ?? ''}`
      const held = votes.get(key) ?? { subject: topic.subject, concept: topic.concept, score: 0, from: new Set<string>() }
      held.score += topic.confidence * weight
      held.from.add(one.kind)
      votes.set(key, held)
    }
  }

  const ranked = [...votes.values()].sort((a, b) => b.score - a.score)
  const best = ranked[0] ?? null

  /*
   * A running Focus session names the subject outright.
   *
   * It is the one case where somebody has told Orbis what they are doing, so it outranks every inference — and
   * when the inference agrees with it, that agreement is itself strong evidence.
   */
  const declared = options.focusSubject?.trim() || null
  let subject = best?.subject ?? null
  let concept = best?.concept ?? null
  if (declared) {
    if (!subject || subject.toLowerCase() !== declared.toLowerCase()) {
      // Keep the concept only when it belongs to the declared subject.
      const matching = ranked.find((one) => one.subject.toLowerCase() === declared.toLowerCase())
      concept = matching?.concept ?? null
    }
    subject = declared
    evidence.push({ says: `your Focus session is about ${declared}`, weight: 1 })
  }

  let confidence = 0
  if (best) {
    const sources = best.from.size
    // One source is a hint. Two different kinds of activity agreeing is the real evidence.
    confidence = Math.min(0.78, 0.3 + best.score * 0.22 + (sources - 1) * 0.16)
    evidence.push({
      says: concept
        ? `${sources > 1 ? 'several things you opened mention' : 'what you opened mentions'} ${concept}`
        : `what you opened is about ${best.subject}`,
      weight: Math.min(1, best.score)
    })
  }
  if (declared) confidence = Math.min(0.97, confidence + 0.25)

  // Agreement between a search and a page is worth more than either alone.
  const kinds = new Set(rows.map((one) => one.kind))
  if (kinds.has('search') && (kinds.has('page-opened') || kinds.has('page-active'))) {
    confidence = Math.min(0.97, confidence + 0.07)
    evidence.push({ says: 'you searched for it and then opened pages about it', weight: 0.8 })
  }
  if (kinds.has('file-opened') && (kinds.has('page-opened') || kinds.has('page-active'))) {
    confidence = Math.min(0.97, confidence + 0.06)
    evidence.push({ says: 'a file and the pages you are reading are about the same thing', weight: 0.7 })
  }
  if (kinds.has('orion-asked')) {
    confidence = Math.min(0.97, confidence + 0.05)
    evidence.push({ says: 'you asked Orion about it', weight: 0.7 })
  }

  const { intent, why } = intentOf(rows, Boolean(declared))
  evidence.push({ says: why, weight: 0.5 })

  const entities: Entity[] = []
  for (const one of rows.slice(0, 8)) {
    for (const entity of entitiesOf(one.title, hostOf(one.url))) {
      if (!entities.some((two) => two.id === entity.id)) entities.push(entity)
    }
  }

  const topicsForName = best ? [{ subject: best.subject, concept: best.concept, confidence: 1, from: 'cluster' }] : []
  const title = concept ?? (subject ? subject : nameFor(topicsForName, rows[0].title))
  const lastAt = rows[0].at
  const startedAt = rows[rows.length - 1].at
  const sinceLast = (options.now - lastAt) / 60_000

  return {
    id: options.id,
    profileId: options.profileId,
    title,
    subject,
    concept,
    intent,
    confidence: Math.max(0, Math.min(1, confidence)),
    band: bandFor(confidence),
    entities: entities.slice(0, 10),
    activityIds: rows.map((one) => one.id),
    startedAt,
    lastAt,
    seconds: rows.reduce((sum, one) => sum + (one.seconds ?? 0), 0),
    evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 6),
    // Nothing here is permanent: a context untouched for an hour is no longer what somebody is doing.
    state: sinceLast < 12 ? 'active' : sinceLast < 90 ? 'recent' : 'dormant'
  }
}

/**
 * Activity split into the separate pieces of work it actually represents.
 *
 * Greedy and deliberately simple: each activity joins the first cluster it is related to, and starts a new one
 * otherwise. Elaborate clustering would be harder to explain and no better at the thing that matters, which is
 * keeping two unrelated subjects apart.
 */
export function cluster(activities: readonly Activity[], options: { now: number; profileId: string; focusSubject?: string | null }): AmbientContext[] {
  const rows = [...activities].sort((a, b) => a.at - b.at)
  const groups: Activity[][] = []
  const topicCache = new Map<string, Topic[]>()
  const topicsFor = (one: Activity): Topic[] => {
    const held = topicCache.get(one.id)
    if (held) return held
    const made = topicsOf(one.title, one.kind)
    topicCache.set(one.id, made)
    return made
  }

  for (const one of rows) {
    let joined = false
    for (const group of groups) {
      const last = group[group.length - 1]
      if (related(last, one, topicsFor(last), topicsFor(one))) {
        group.push(one)
        joined = true
        break
      }
    }
    if (!joined) groups.push([one])
  }

  return groups
    .map((group, index) =>
      buildContext(group, {
        profileId: options.profileId,
        now: options.now,
        focusSubject: options.focusSubject,
        id: `ctx-${group[0].at.toString(36)}-${index}`
      })
    )
    .filter((one): one is AmbientContext => one !== null)
}

/**
 * Which of several contexts is the one somebody is in.
 *
 * Recency does most of the work, but not all of it: a cluster of six things touched a few minutes ago is what
 * somebody is doing, and a single page opened thirty seconds ago is not, even though it is newer.
 */
export function dominant(contexts: readonly AmbientContext[], now: number): AmbientContext | null {
  if (contexts.length === 0) return null
  const scored = contexts.map((one) => ({
    one,
    score: freshness(one.lastAt, now, 25) * (0.5 + Math.min(0.5, one.activityIds.length * 0.08)) * (0.4 + one.confidence * 0.6)
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0].one
}

/**
 * The same context, with one correction applied.
 *
 * When somebody says "this is not about Physics", the subject is cleared and the context is marked down so that
 * nothing acts on it again — rather than the whole context being thrown away, which would lose the grouping they
 * did not complain about.
 */
export function correct(context: AmbientContext, change: { subject?: string | null; concept?: string | null; wrong?: boolean }): AmbientContext {
  if (change.wrong) {
    return {
      ...context,
      subject: null,
      concept: null,
      confidence: 0,
      band: 'unknown',
      title: context.title,
      evidence: [{ says: 'you said this was not right, so Orbis stopped guessing', weight: 1 }]
    }
  }
  const subject = change.subject === undefined ? context.subject : change.subject
  const concept = change.concept === undefined ? context.concept : change.concept
  return {
    ...context,
    subject,
    concept,
    title: concept ?? subject ?? context.title,
    // Somebody saying what it is beats anything Orbis worked out.
    confidence: 0.99,
    band: 'certain',
    evidence: [{ says: 'you told Orbis what this is', weight: 1 }, ...context.evidence.slice(0, 3)]
  }
}

/** A session, in words, for "what did I do yesterday". Only ever counts, never content. */
export function summarise(context: AmbientContext): string {
  const minutes = Math.round(context.seconds / 60)
  const bits: string[] = []
  if (minutes >= 1) bits.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  const pages = context.activityIds.length
  bits.push(`${pages} ${pages === 1 ? 'thing' : 'things'}`)
  return `${context.title} — ${bits.join(', ')}`
}
