/**
 * Explain it yourself: the user explains, and what they leave out is the finding.
 *
 * Every other Page in Orbis computes something. This one measures an explanation against a decomposition of the
 * topic, and reports what was not said. The thing being tested is whether the explanation covers the concepts, not
 * whether it matches a model answer -- a correct explanation in unexpected words is still correct, and a fluent
 * paraphrase of the textbook that skips the mechanism is not.
 *
 * ## What is and is not claimed
 *
 * Coverage is keyword matching over a stated concept map. That is a real, checkable signal and it is not
 * understanding. Every result here says which it is: `mentioned` is measured, `understood` is never asserted. A
 * learning tool that reports a mastery percentage it cannot measure teaches the user to trust a number that means
 * nothing, which is worse than reporting nothing.
 *
 * ## Hints do not give the answer
 *
 * Hints escalate in stated levels, and the last level is still a question. A hint that completes the explanation
 * ends the exercise -- the user gets a filled-in page and no more idea than they started with.
 */

export interface LearningError {
  error: string
  message: string
}

export const isLearningError = (value: unknown): value is LearningError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): LearningError => ({ error, message })

export const LEARNING_LIMITS: Readonly<Record<'concepts' | 'attempts' | 'hints' | 'explanationLength' | 'queue', number>> =
  Object.freeze({
    concepts: 500,
    attempts: 200,
    hints: 6,
    explanationLength: 100_000,
    queue: 2_000
  })

// ---------------------------------------------------------------- the topic

export interface Concept {
  id: string
  name: string
  /** Other names for the same idea. An explanation using any of them has mentioned it. */
  aliases: string[]
  /** Concepts that have to be in place first. */
  requires: string[]
  /** Whether leaving this out makes the explanation wrong rather than incomplete. */
  essential: boolean
  /** A wrong belief that commonly stands in for this concept, with what distinguishes it. */
  confusedWith: { belief: string; signal: string[]; because: string }[]
}

export interface Topic {
  id: string
  name: string
  concepts: Concept[]
}

export interface TopicProblem {
  kind: 'missing-requirement' | 'cycle' | 'duplicate' | 'no-essentials' | 'empty-signal'
  ids: string[]
  describe: string
  blocking: boolean
}

/** Whether a topic's decomposition can be taught from: no circular prerequisites, no dangling ones. */
export function checkTopic(topic: Topic): TopicProblem[] {
  const problems: TopicProblem[] = []
  const byId = new Map<string, Concept>()

  for (const concept of topic.concepts) {
    if (byId.has(concept.id)) {
      problems.push({ kind: 'duplicate', ids: [concept.id], describe: `Two concepts share the id "${concept.id}".`, blocking: true })
    }
    byId.set(concept.id, concept)
  }

  for (const concept of topic.concepts) {
    const dangling = concept.requires.filter((one) => !byId.has(one))
    if (dangling.length > 0) {
      problems.push({
        kind: 'missing-requirement',
        ids: dangling,
        describe: `"${concept.name}" requires ${dangling.join(', ')}, which ${dangling.length === 1 ? 'is' : 'are'} not part of this topic. Either add ${dangling.length === 1 ? 'it' : 'them'}, or the user is expected to already know ${dangling.length === 1 ? 'it' : 'them'} and that should be said.`,
        blocking: false
      })
    }
    for (const confusion of concept.confusedWith) {
      if (confusion.signal.length === 0) {
        problems.push({
          kind: 'empty-signal',
          ids: [concept.id],
          describe: `The misconception "${confusion.belief}" has nothing that identifies it in an explanation, so it can never be detected.`,
          blocking: true
        })
      }
    }
  }

  const cycle = prerequisiteCycle(topic)
  if (cycle) {
    problems.push({
      kind: 'cycle',
      ids: cycle,
      describe: `${cycle.map((id) => byId.get(id)?.name ?? id).join(' -> ')} require each other, so there is no order to learn them in.`,
      blocking: true
    })
  }

  if (topic.concepts.length > 0 && !topic.concepts.some((one) => one.essential)) {
    problems.push({
      kind: 'no-essentials',
      ids: [],
      describe: 'No concept in this topic is marked essential, so no explanation can be wrong -- only more or less complete.',
      blocking: false
    })
  }

  return problems
}

function prerequisiteCycle(topic: Topic): string[] | null {
  const colour = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const byId = new Map(topic.concepts.map((one) => [one.id, one]))
  let found: string[] | null = null

  const visit = (id: string): boolean => {
    colour.set(id, 1)
    stack.push(id)
    for (const next of byId.get(id)?.requires ?? []) {
      if (!byId.has(next)) continue
      if (colour.get(next) === 1) {
        found = [...stack.slice(stack.indexOf(next)), next]
        return true
      }
      if ((colour.get(next) ?? 0) === 0 && visit(next)) return true
    }
    colour.set(id, 2)
    stack.pop()
    return false
  }

  for (const concept of topic.concepts) {
    if ((colour.get(concept.id) ?? 0) === 0 && visit(concept.id)) break
  }
  return found
}

/** The order the concepts can be learned in, prerequisites first. */
export function learningOrder(topic: Topic): string[] | LearningError {
  if (prerequisiteCycle(topic)) return fail('cycle', 'These concepts require each other, so there is no order to learn them in.')

  const byId = new Map(topic.concepts.map((one) => [one.id, one]))
  const done = new Set<string>()
  const order: string[] = []
  let progressed = true

  while (progressed && order.length < topic.concepts.length) {
    progressed = false
    for (const concept of [...topic.concepts].sort((a, b) => a.id.localeCompare(b.id))) {
      if (done.has(concept.id)) continue
      if (concept.requires.some((one) => byId.has(one) && !done.has(one))) continue
      done.add(concept.id)
      order.push(concept.id)
      progressed = true
    }
  }
  return order
}

// ---------------------------------------------------------------- reading an explanation

const WORD = /[a-z0-9]+(?:['-][a-z0-9]+)*/g

/** Split text into lowercase words. Kept here so coverage and misconception detection read the text the same way. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? []
}

const containsPhrase = (words: readonly string[], phrase: string): boolean => {
  const needle = wordsOf(phrase)
  if (needle.length === 0) return false
  for (let i = 0; i + needle.length <= words.length; i += 1) {
    let all = true
    for (let j = 0; j < needle.length; j += 1) {
      if (words[i + j] !== needle[j]) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

export interface Coverage {
  conceptId: string
  name: string
  /** Measured: the words are there. Never read as "understood". */
  mentioned: boolean
  /** Which alias matched, so the user can see what was counted. */
  matchedOn: string | null
  essential: boolean
}

export interface Analysis {
  covered: Coverage[]
  /** Essential concepts that were not mentioned. These make the explanation wrong, not merely short. */
  missingEssential: string[]
  missingOther: string[]
  /** Misconceptions whose signal words are present, with what distinguishes them. */
  possibleMisconceptions: { conceptId: string; belief: string; because: string; matchedOn: string }[]
  /** Concepts used before their prerequisites were established. */
  outOfOrder: { conceptId: string; before: string[] }[]
  wordCount: number
  /** What this analysis does and does not establish, carried with the result rather than left to the screen. */
  claim: string
  describe: string
}

/**
 * Compare an explanation against the topic's concepts.
 *
 * Matching is by phrase over the alias list, so "rate of change" matches the concept whose alias that is, regardless
 * of the surrounding sentence. This finds absence reliably and presence only approximately: mentioning a concept is
 * not explaining it, and `claim` says so on every result.
 */
export function analyse(topic: Topic, explanation: string): Analysis | LearningError {
  if (explanation.length > LEARNING_LIMITS.explanationLength) {
    return fail('too-long', `That explanation is ${explanation.length.toLocaleString('en')} characters, past the ${LEARNING_LIMITS.explanationLength.toLocaleString('en')} this can read.`)
  }
  if (topic.concepts.length > LEARNING_LIMITS.concepts) {
    return fail('too-many-concepts', `This topic has ${topic.concepts.length} concepts, past the ${LEARNING_LIMITS.concepts} allowed.`)
  }

  const words = wordsOf(explanation)
  const covered: Coverage[] = []
  const firstAt = new Map<string, number>()

  for (const concept of topic.concepts) {
    let matchedOn: string | null = null
    for (const phrase of [concept.name, ...concept.aliases]) {
      if (containsPhrase(words, phrase)) {
        matchedOn = phrase
        break
      }
    }
    covered.push({ conceptId: concept.id, name: concept.name, mentioned: matchedOn !== null, matchedOn, essential: concept.essential })
    if (matchedOn !== null) firstAt.set(concept.id, positionOf(words, matchedOn))
  }

  const mentioned = new Set(covered.filter((one) => one.mentioned).map((one) => one.conceptId))
  const missingEssential = topic.concepts.filter((one) => one.essential && !mentioned.has(one.id)).map((one) => one.id)
  const missingOther = topic.concepts.filter((one) => !one.essential && !mentioned.has(one.id)).map((one) => one.id)

  const possibleMisconceptions: Analysis['possibleMisconceptions'] = []
  for (const concept of topic.concepts) {
    for (const confusion of concept.confusedWith) {
      const hit = confusion.signal.find((one) => containsPhrase(words, one))
      if (hit !== undefined) {
        possibleMisconceptions.push({ conceptId: concept.id, belief: confusion.belief, because: confusion.because, matchedOn: hit })
      }
    }
  }

  const outOfOrder: Analysis['outOfOrder'] = []
  for (const concept of topic.concepts) {
    if (!mentioned.has(concept.id)) continue
    const here = firstAt.get(concept.id) ?? 0
    const late = concept.requires.filter((one) => {
      if (!mentioned.has(one)) return false
      return (firstAt.get(one) ?? 0) > here
    })
    if (late.length > 0) outOfOrder.push({ conceptId: concept.id, before: late })
  }

  const describe =
    missingEssential.length > 0
      ? `${missingEssential.length} essential concept${missingEssential.length === 1 ? '' : 's'} ${missingEssential.length === 1 ? 'is' : 'are'} not mentioned: ${missingEssential.map((id) => topic.concepts.find((one) => one.id === id)?.name).join(', ')}. Without ${missingEssential.length === 1 ? 'it' : 'them'} the explanation is not just short, it does not hold.`
      : mentioned.size === topic.concepts.length
        ? 'Every concept in this topic appears in the explanation. Whether each is explained correctly is a separate question this cannot answer.'
        : `Every essential concept appears. ${missingOther.length} supporting concept${missingOther.length === 1 ? '' : 's'} ${missingOther.length === 1 ? 'is' : 'are'} not mentioned.`

  return {
    covered,
    missingEssential,
    missingOther,
    possibleMisconceptions,
    outOfOrder,
    wordCount: words.length,
    claim:
      'This checks which concepts are mentioned, by matching their names and aliases. It does not check whether they are explained correctly, and mentioning a concept is not understanding it.',
    describe
  }
}

function positionOf(words: readonly string[], phrase: string): number {
  const needle = wordsOf(phrase)
  for (let i = 0; i + needle.length <= words.length; i += 1) {
    let all = true
    for (let j = 0; j < needle.length; j += 1) {
      if (words[i + j] !== needle[j]) {
        all = false
        break
      }
    }
    if (all) return i
  }
  return words.length
}

// ---------------------------------------------------------------- hints

export interface Hint {
  level: number
  text: string
  /** True only for the last level, which is still a question rather than the answer. */
  last: boolean
}

/**
 * A hint at the requested level, escalating from "there is something missing" to a direct question about it.
 *
 * No level states the missing concept's explanation. The most direct hint names the concept and asks what it does,
 * which leaves the work where it belongs: the user who is handed the sentence has a completed page and has learned
 * the shape of the exercise rather than the topic.
 */
export function hintFor(topic: Topic, analysis: Analysis, level: number): Hint | LearningError {
  if (level < 1 || level > LEARNING_LIMITS.hints || !Number.isInteger(level)) {
    return fail('no-such-level', `Hints run from level 1 to ${LEARNING_LIMITS.hints}.`)
  }

  const missing = [...analysis.missingEssential, ...analysis.missingOther]
  if (missing.length === 0 && analysis.possibleMisconceptions.length === 0) {
    return fail('nothing-to-hint', 'Everything in this topic is mentioned, so there is nothing to point at. Whether it is right is a different question.')
  }

  if (analysis.possibleMisconceptions.length > 0 && level >= 2) {
    const one = analysis.possibleMisconceptions[0] as Analysis['possibleMisconceptions'][number]
    const concept = topic.concepts.find((c) => c.id === one.conceptId)
    if (level >= 4) {
      return {
        level,
        text: `Your explanation says something close to "${one.belief}". ${one.because} What would you expect to see if that were true, and does ${concept?.name ?? 'the concept'} predict the same thing?`,
        last: level === LEARNING_LIMITS.hints
      }
    }
    return { level, text: 'One part of this explanation would lead to a wrong prediction. Which part, and what would it predict?', last: false }
  }

  const target = topic.concepts.find((one) => one.id === missing[0])
  if (!target) return fail('nothing-to-hint', 'The missing concept is not in this topic.')

  const ladder: string[] = [
    'Something is missing. Read it back and ask what a reader would still not be able to work out.',
    `There is a ${target.essential ? 'necessary' : 'supporting'} idea that has not appeared. Without it, part of what you said has no reason behind it.`,
    `The missing idea sits ${target.requires.length > 0 ? `just after ${target.requires.map((id) => topic.concepts.find((one) => one.id === id)?.name ?? id).join(' and ')}` : 'at the start'}. What comes next?`,
    `The missing idea is ${target.name}. Where in your explanation would it go?`,
    `The missing idea is ${target.name}. What does it do that nothing else in your explanation does?`,
    `The missing idea is ${target.name}. If you removed it from the topic entirely, what would stop working?`
  ]

  return { level, text: ladder[level - 1] as string, last: level === LEARNING_LIMITS.hints }
}

/** A question that makes the user extend their own explanation rather than confirm it. */
export function socraticQuestion(topic: Topic, analysis: Analysis): string {
  if (analysis.possibleMisconceptions.length > 0) {
    const one = analysis.possibleMisconceptions[0] as Analysis['possibleMisconceptions'][number]
    return `You wrote something that reads as "${one.belief}". What would that predict, and is that what actually happens?`
  }
  const missing = analysis.missingEssential[0] ?? analysis.missingOther[0]
  if (missing !== undefined) {
    const concept = topic.concepts.find((one) => one.id === missing)
    const dependents = topic.concepts.filter((one) => one.requires.includes(missing))
    if (dependents.length > 0) {
      return `You explained ${dependents[0]?.name}. What has to be true for that to work?`
    }
    return `What happens to the rest of your explanation if ${concept?.name} is not the case?`
  }
  const essential = topic.concepts.find((one) => one.essential)
  return essential
    ? `Where would ${essential.name} break down? An explanation that has no edges has not been tested.`
    : 'Where would this explanation stop being true?'
}

// ---------------------------------------------------------------- attempts

export type Mastery = 'not-started' | 'partial' | 'complete-coverage' | 'needs-review'

export interface Attempt {
  id: string
  version: number
  text: string
  analysis: Analysis
  /** What the user said their confidence was, kept beside what was measured rather than averaged with it. */
  statedConfidence: number | null
  hintsUsed: number
}

export interface Session {
  id: string
  topicId: string
  attempts: Attempt[]
}

/** Record an attempt. Earlier attempts are never replaced, because the change between them is the learning. */
export function addAttempt(session: Session, attempt: Omit<Attempt, 'version'>): Session | LearningError {
  if (session.attempts.length >= LEARNING_LIMITS.attempts) {
    return fail('too-many-attempts', `This session already has ${LEARNING_LIMITS.attempts} attempts.`)
  }
  if (attempt.statedConfidence !== null && (attempt.statedConfidence < 0 || attempt.statedConfidence > 1)) {
    return fail('bad-confidence', 'A stated confidence runs from 0 to 1.')
  }
  return { ...session, attempts: [...session.attempts, { ...attempt, version: session.attempts.length + 1 }] }
}

export interface Progress {
  /** Which concepts newly appeared, and which stopped appearing. Both matter. */
  gained: string[]
  lost: string[]
  misconceptionsResolved: string[]
  misconceptionsIntroduced: string[]
  describe: string
}

/** What changed between two attempts. A concept that disappeared is reported as loudly as one that appeared. */
export function compareAttempts(topic: Topic, before: Attempt, after: Attempt): Progress {
  const name = (id: string): string => topic.concepts.find((one) => one.id === id)?.name ?? id
  const mentionedIn = (attempt: Attempt): Set<string> =>
    new Set(attempt.analysis.covered.filter((one) => one.mentioned).map((one) => one.conceptId))

  const was = mentionedIn(before)
  const now = mentionedIn(after)
  const gained = [...now].filter((one) => !was.has(one)).sort()
  const lost = [...was].filter((one) => !now.has(one)).sort()

  const beliefsOf = (attempt: Attempt): Set<string> => new Set(attempt.analysis.possibleMisconceptions.map((one) => one.belief))
  const wasBeliefs = beliefsOf(before)
  const nowBeliefs = beliefsOf(after)
  const misconceptionsResolved = [...wasBeliefs].filter((one) => !nowBeliefs.has(one)).sort()
  const misconceptionsIntroduced = [...nowBeliefs].filter((one) => !wasBeliefs.has(one)).sort()

  const parts: string[] = []
  if (gained.length > 0) parts.push(`${gained.map(name).join(', ')} now appear${gained.length === 1 ? 's' : ''}`)
  if (lost.length > 0) parts.push(`${lost.map(name).join(', ')} no longer appear${lost.length === 1 ? 's' : ''}, which is worth a look -- a rewrite that tightens usually drops something`)
  if (misconceptionsResolved.length > 0) parts.push(`${misconceptionsResolved.length} misconception${misconceptionsResolved.length === 1 ? '' : 's'} no longer showing`)
  if (misconceptionsIntroduced.length > 0) parts.push(`${misconceptionsIntroduced.length} new misconception${misconceptionsIntroduced.length === 1 ? '' : 's'}`)

  return {
    gained,
    lost,
    misconceptionsResolved,
    misconceptionsIntroduced,
    describe: parts.length === 0 ? 'Nothing measurable changed between these two attempts.' : `${parts.join('; ')}.`
  }
}

export interface MasteryReport {
  state: Mastery
  /** Measured coverage: mentioned over total. Reported as coverage, never as understanding. */
  coverage: number
  essentialCoverage: number
  attempts: number
  hintsUsed: number
  /** Where the user's stated confidence and the measured coverage disagree. */
  calibration: { stated: number; measured: number; gap: number; describe: string } | null
  describe: string
}

/**
 * Where the session stands.
 *
 * `complete-coverage` is deliberately not called mastery: it means every concept was mentioned, which is what was
 * measured. Calibration is reported as the gap between what the user said and what was measured, with no claim that
 * the measurement is the truth -- an explanation can be excellent and score badly here if it uses different words.
 */
export function masteryOf(topic: Topic, session: Session): MasteryReport {
  const latest = session.attempts[session.attempts.length - 1]
  if (!latest) {
    return {
      state: 'not-started',
      coverage: 0,
      essentialCoverage: 0,
      attempts: 0,
      hintsUsed: 0,
      calibration: null,
      describe: 'No explanation has been written yet.'
    }
  }

  const total = topic.concepts.length
  const mentioned = latest.analysis.covered.filter((one) => one.mentioned).length
  const essentials = topic.concepts.filter((one) => one.essential)
  const essentialsMentioned = essentials.filter((one) =>
    latest.analysis.covered.some((c) => c.conceptId === one.id && c.mentioned)
  ).length

  const coverage = total === 0 ? 0 : mentioned / total
  const essentialCoverage = essentials.length === 0 ? 1 : essentialsMentioned / essentials.length
  const hintsUsed = session.attempts.reduce((running, one) => running + one.hintsUsed, 0)

  const state: Mastery =
    latest.analysis.possibleMisconceptions.length > 0
      ? 'needs-review'
      : coverage === 1
        ? 'complete-coverage'
        : 'partial'

  let calibration: MasteryReport['calibration'] = null
  if (latest.statedConfidence !== null) {
    const gap = latest.statedConfidence - coverage
    calibration = {
      stated: latest.statedConfidence,
      measured: coverage,
      gap,
      describe:
        Math.abs(gap) < 0.15
          ? 'Stated confidence and measured coverage are close.'
          : gap > 0
            ? `Confidence is ${Math.round(gap * 100)} points above measured coverage. Either something is being left out as obvious, or the words used are not the ones this is matching on -- both are worth checking before the next attempt.`
            : `Measured coverage is ${Math.round(-gap * 100)} points above stated confidence. The explanation covers more than it feels like it does.`
    }
  }

  return {
    state,
    coverage,
    essentialCoverage,
    attempts: session.attempts.length,
    hintsUsed,
    calibration,
    describe:
      state === 'needs-review'
        ? 'Something in the latest explanation matches a known misconception, so coverage is not the thing to look at yet.'
        : state === 'complete-coverage'
          ? `Every concept is mentioned across ${session.attempts.length} attempt${session.attempts.length === 1 ? '' : 's'}. That is coverage, not mastery: it says nothing about whether each was explained correctly.`
          : `${mentioned} of ${total} concepts mentioned, including ${essentialsMentioned} of ${essentials.length} essential ones.`
  }
}

// ---------------------------------------------------------------- review

export interface ReviewItem {
  topicId: string
  conceptId: string
  reason: 'never-mentioned' | 'dropped' | 'misconception' | 'needed-hints'
  /** Ordered by how much else in the topic depends on it. */
  dependents: number
  describe: string
}

/**
 * What to come back to, ordered by how much rests on it.
 *
 * Ordering by dependents rather than by how recently it was missed: a prerequisite that never appeared blocks
 * everything built on it, and revisiting the thing that was missed most recently is usually revisiting a symptom.
 */
export function reviewQueue(topic: Topic, session: Session): ReviewItem[] {
  const latest = session.attempts[session.attempts.length - 1]
  if (!latest) return []

  const dependentsOf = (id: string): number => topic.concepts.filter((one) => one.requires.includes(id)).length
  const items: ReviewItem[] = []
  const seen = new Set<string>()

  const add = (conceptId: string, reason: ReviewItem['reason'], describe: string): void => {
    const key = `${conceptId}:${reason}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({ topicId: topic.id, conceptId, reason, dependents: dependentsOf(conceptId), describe })
  }

  for (const one of latest.analysis.possibleMisconceptions) {
    const concept = topic.concepts.find((c) => c.id === one.conceptId)
    add(one.conceptId, 'misconception', `${concept?.name ?? one.conceptId}: the explanation reads as "${one.belief}". ${one.because}`)
  }
  for (const id of [...latest.analysis.missingEssential, ...latest.analysis.missingOther]) {
    const concept = topic.concepts.find((c) => c.id === id)
    const everMentioned = session.attempts.some((attempt) =>
      attempt.analysis.covered.some((c) => c.conceptId === id && c.mentioned)
    )
    add(
      id,
      everMentioned ? 'dropped' : 'never-mentioned',
      everMentioned
        ? `${concept?.name ?? id} appeared in an earlier attempt and not in the latest one.`
        : `${concept?.name ?? id} has not appeared in any attempt.`
    )
  }
  if (latest.hintsUsed >= 3) {
    for (const covered of latest.analysis.covered.filter((one) => one.mentioned && one.essential)) {
      add(covered.conceptId, 'needed-hints', `${covered.name} only appeared after ${latest.hintsUsed} hints.`)
    }
  }

  const rank: Record<ReviewItem['reason'], number> = { misconception: 0, 'never-mentioned': 1, dropped: 2, 'needed-hints': 3 }
  return items
    .sort((a, b) => rank[a.reason] - rank[b.reason] || b.dependents - a.dependents || a.conceptId.localeCompare(b.conceptId))
    .slice(0, LEARNING_LIMITS.queue)
}

/** The assumptions the Page rests on, shown rather than implied. */
export const LEARNING_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Coverage is measured by matching concept names and aliases in the explanation. That is checkable, and it is not understanding.',
  'Mentioning a concept is never reported as understanding it, and no result here claims otherwise.',
  'An essential concept left out makes the explanation wrong, not merely short, and is reported that way.',
  'A misconception is only reported when its stated signal words appear; a misconception with no signal is refused at topic-check time.',
  'Hints escalate through stated levels and the last one is still a question. None of them completes the explanation.',
  'Every attempt is kept. The change between attempts is the learning, and replacing the earlier one loses it.',
  'A concept that disappeared between attempts is reported as prominently as one that appeared.',
  'The furthest state is called complete coverage, not mastery, because coverage is what was measured.',
  'Stated confidence is kept beside measured coverage, never averaged into it.',
  'The review queue is ordered by how much depends on each concept, not by what was missed most recently.'
])
