/**
 * Turning the arithmetic into something worth reading.
 *
 * Everything in here is **derived from the result**, never asserted. "It wins mainly on effort" is true because
 * effort contributed more to its score than anything else did, and that difference is computed below. "You give up
 * about four hours a week" is true because that is the gap between two figures in the table. The reason for
 * building it this way is simple: a model asked to explain a ranking will write a convincing paragraph about a
 * criterion that barely moved the result, and nobody reading it could tell.
 *
 * ## Orion's part is the wording, not the facts
 *
 * The verdict below is complete and readable before any model is involved: plain sentences, assembled from the
 * numbers. Orion is then given the verdict and asked to say the same thing more naturally. If that call fails, the
 * engine's own sentences are what somebody sees -- a little flat, entirely correct -- which is the whole point of
 * doing it in this order rather than asking a model to both decide and describe.
 *
 * ## What is deliberately not here
 *
 * No confidence percentage. There is no honest way to put a number on "how sure are you" when the inputs are part
 * guess, and the useful version of that question has a different answer: how far would something have to be wrong
 * before the answer changed. That comes from `sensitivity.ts` and is reported as a sentence somebody can check.
 */
import { run, weightsFor } from './engine.ts'
import { mattersMost, type Fragility, type Steadiness } from './sensitivity.ts'
import { isGuess, type Alternative, type Criterion, type Decision, type Gap, type Result, type Scored } from './types.ts'

// ---------------------------------------------------------------- the shape the chat shows

export interface VerdictRow {
  alternativeId: string
  name: string
  place: number
  /** 0 to 100, whole numbers. Rounded hard on purpose: a tenth of a point is not a real difference. */
  outOf100: number
  /** The range, when enough is unknown that the figure is not a point. Null when it is. */
  range: { low: number; high: number } | null
  /** How much of what matters is actually known about this option, as a percentage. */
  known: number
  tied: boolean
  feasible: Scored['feasible']
  /** Which hard requirements it breaks, in the person's words. */
  breaks: readonly string[]
  /** True when nothing else beats it outright. */
  notBeaten: boolean
  /** True when this option was Orion's suggestion rather than one the person named. */
  suggested: boolean
  /** Per criterion, for the detailed view. */
  parts: readonly {
    criterionId: string
    name: string
    raw: number | null
    unit: string
    outOf100: number | null
    weight: number
    guessed: boolean
    says: string
  }[]
}

export interface Verdict {
  decisionId: string
  run: number
  title: string
  question: string
  /** The leading option, or null when there honestly is not one. */
  leads: { alternativeId: string; name: string } | null
  /** Why there is no leader, in words. Null when there is one. */
  noLeader: string | null
  rows: readonly VerdictRow[]
  /** The two or three reasons it leads, biggest first. */
  because: readonly string[]
  /** What choosing it costs, in the terms of the comparison. Null when it beats everything on everything. */
  tradeOff: string | null
  /** What would have to be different for the answer to change. Null when nothing inside the tested range would. */
  uncertainty: string | null
  /** A practical next step, or null. */
  nextStep: string | null
  /**
   * Why the recommended option is not first in the table, when it is not. Null when it is.
   *
   * The table is ordered by the figure, and the figure is not the recommendation: an option nobody knows anything
   * about can score highest, and an option over the budget can score highest. Both are shown, because a shorter
   * list answers a question nobody asked -- but then the card says the answer is one thing and shows something
   * else above it, and this is the sentence that stops that reading as a fault in the ranking.
   */
  whyNotFirst: string | null
  /** The one question worth asking, or null. */
  ask: string | null
  steadiness: Steadiness
  /** What the method did, from the engine. */
  howItWorked: string
  /** Anything the engine wanted said about the inputs. */
  notes: readonly string[]
  /** Set when no option clears every hard requirement. */
  nothingIsFeasible: boolean
  /** What is still not known, with whether it would change anything. */
  gaps: readonly { asks: string; worth: Gap['worth']; howToFind: string | null }[]
  /** What is being taken as true. */
  assumptions: readonly string[]
  /** Orion's wording of the same thing. Empty when the model was not asked or could not answer. */
  says: string
  /** True when this decision touches money, health, the law or safety. */
  careful: boolean
}

// ---------------------------------------------------------------- the pieces

const pc = (value: number): number => Math.round(value * 100)

const nameOf = (decision: Decision, id: string | null): string =>
  decision.alternatives.find((one) => one.id === id)?.name ?? 'that option'

const criterionOf = (decision: Decision, id: string): Criterion | undefined => decision.criteria.find((one) => one.id === id)

/**
 * Why the leader leads: where it gained the most on whoever came next.
 *
 * Against the runner-up rather than against the field, because that is the comparison somebody is actually making
 * in their head. Against an average, a criterion where the leader beats a distant third would come out as a reason
 * it won, and it is not one.
 */
export function whyItLeads(decision: Decision, result: Result): { for: string[]; against: string[] } {
  const leader = result.scored.find((one) => one.alternativeId === result.leaderId)
  if (!leader) return { for: [], against: [] }
  const next = result.scored
    .filter((one) => one.alternativeId !== leader.alternativeId && (one.feasible === 'meets' || one.feasible === 'conditional'))
    .sort((a, b) => b.score - a.score)[0]
  if (!next) return { for: [], against: [] }

  const gaps = leader.parts
    .map((part) => {
      const theirs = next.parts.find((one) => one.criterionId === part.criterionId)
      const criterion = criterionOf(decision, part.criterionId)
      if (!criterion || part.scaled === null || !theirs || theirs.scaled === null) return null
      return { criterion, by: part.contributed - theirs.contributed, mine: part.raw, theirs: theirs.raw }
    })
    .filter((one): one is { criterion: Criterion; by: number; mine: number | null; theirs: number | null } => one !== null)
    .sort((a, b) => b.by - a.by)

  /*
   * The figures go in the order the sentence names the options.
   *
   * Always putting the leader's first meant "MacBook Air is better on battery (9 hours against 18 hours)" -- the
   * sentence names the MacBook and then gives the ThinkPad's figure first, so read as written it says the MacBook
   * has nine hours. It has eighteen.
   */
  const said = (one: { criterion: Criterion; mine: number | null; theirs: number | null }, better: boolean): string => {
    const unit = one.criterion.unit ? ` ${one.criterion.unit}` : ''
    const both = one.mine !== null && one.theirs !== null && one.mine !== one.theirs
    const first = better ? one.mine : one.theirs
    const second = better ? one.theirs : one.mine
    const figures = both ? ` (${trim(first as number)}${unit} against ${trim(second as number)}${unit})` : ''
    return better
      ? `it is better on ${one.criterion.name}${figures}`
      : `${nameOf(decision, next.alternativeId)} is better on ${one.criterion.name}${figures}`
  }

  return {
    for: gaps.filter((one) => one.by > 0.005).slice(0, 3).map((one) => said(one, true)),
    against: gaps.filter((one) => one.by < -0.005).reverse().slice(0, 2).map((one) => said(one, false))
  }
}

/**
 * A figure rounded to something somebody would say out loud.
 *
 * Used for anything the sensitivity sweep produced, because those come from halving an interval and land on
 * numbers like 79,922.43. The step grows with the size of the figure: hundreds for anything in the tens of
 * thousands, whole numbers around a hundred, one decimal place below ten.
 */
function roughly(value: number): string {
  const size = Math.abs(value)
  if (size >= 10_000) return trim(Math.round(value / 100) * 100)
  if (size >= 1_000) return trim(Math.round(value / 10) * 10)
  if (size >= 100) return trim(Math.round(value))
  if (size >= 10) return trim(Math.round(value * 2) / 2)
  return trim(Math.round(value * 10) / 10)
}

/** A number as somebody would write it: no trailing zeroes, no false precision. */
const trim = (value: number): string => {
  if (Number.isInteger(value)) return String(value)
  if (Math.abs(value) >= 100) return String(Math.round(value))
  return String(Math.round(value * 10) / 10)
}

/**
 * What the leader gives up, as an amount rather than an adjective.
 *
 * Only ever from two figures that both exist. "You give up some performance" is noise; "you give up about 2 hours
 * of battery" is a thing somebody can weigh against what they are getting, and if the figures are not there this
 * returns null rather than reaching for the adjective.
 */
export function whatItCosts(decision: Decision, result: Result): string | null {
  const against = whyItLeads(decision, result).against
  /*
   * Returned as written, capitals and all. It used to be lowercased so it would read as a continuation of "What
   * it costs:" -- and the first word of it is an option's name, so "MacBook Air" came out as "macBook Air".
   */
  return against.length === 0 ? null : against[0]
}

/**
 * Which missing figures would actually change the answer.
 *
 * Measured, not guessed: the unknown is filled in with the best and the worst value anybody else has for that
 * criterion, and the arithmetic is run both ways. If the leader is the same both times, knowing it would not change
 * the recommendation -- which is the single most useful thing to be able to say, because it is what makes the
 * difference between asking a question and not needing to.
 */
export function wouldItMatter(decision: Decision, result: Result): Map<string, Gap['worth']> {
  const out = new Map<string, Gap['worth']>()
  if (result.leaderId === null) return out

  for (const gap of decision.gaps) {
    const criterionId = gap.about.criterionId
    const alternativeId = gap.about.alternativeId
    if (!criterionId) {
      out.set(gap.id, 'not-tested')
      continue
    }

    const observed = decision.alternatives
      .map((one) => one.values[criterionId]?.value)
      .filter((one): one is number => typeof one === 'number' && Number.isFinite(one))
    if (observed.length === 0) {
      out.set(gap.id, 'not-tested')
      continue
    }

    const low = Math.min(...observed)
    const high = Math.max(...observed)
    const who = alternativeId ? [alternativeId] : decision.alternatives.filter((one) => one.values[criterionId]?.value === undefined).map((one) => one.id)
    if (who.length === 0) {
      out.set(gap.id, 'would-not-change-it')
      continue
    }

    const at = (value: number): Record<string, { value: number; origin: 'assumed' }> =>
      Object.fromEntries(who.map((id) => [`${id}/${criterionId}`, { value, origin: 'assumed' as const }]))
    const atLow = run(decision, { values: at(low) }).leaderId
    const atHigh = run(decision, { values: at(high) }).leaderId

    out.set(gap.id, atLow === atHigh ? (atLow === result.leaderId ? 'would-not-change-it' : 'could-change-it') : 'would-decide-it')
  }

  return out
}

/**
 * Whether to ask a question, and which one.
 *
 * The six tests from the clarification policy, in the order they rule things out. Most messages end up at "do not
 * ask", which is the point: a decision engine that asks three questions before saying anything is a form with a
 * chat window around it.
 */
export function whatToAsk(
  decision: Decision,
  result: Result,
  worth: Map<string, Gap['worth']>,
  o: { orionSuggested?: string; justDecide?: boolean } = {}
): string | null {
  // They said to get on with it. Asking anyway is not listening.
  if (o.justDecide) return null

  // Nothing can be said at all without more: then the question is not an interruption, it is the answer.
  if (result.leaderId === null && result.noLeader === 'too-little-known') {
    const first = decision.gaps[0]
    return first ? first.asks : 'What matters most to you here?'
  }

  const deciding = decision.gaps.filter((one) => worth.get(one.id) === 'would-decide-it')
  if (deciding.length > 0) return deciding[0].asks

  /*
   * Nothing known would change the answer, so the only reason left to ask is that being wrong would be expensive.
   * Money, health, the law and safety are where a wrong recommendation costs more than an extra question does.
   */
  if (decision.sort === 'high-stakes') {
    const could = decision.gaps.filter((one) => worth.get(one.id) === 'could-change-it')
    if (could.length > 0) return could[0].asks
  }

  // Orion's own suggestion is used last, and only when the engine found no reason of its own to ask.
  return o.orionSuggested && o.orionSuggested.trim() !== '' && deciding.length === 0 && decision.gaps.length > 0
    ? o.orionSuggested.trim()
    : null
}

/**
 * One thing worth doing next.
 *
 * Taken from whatever the analysis actually found: a gap that would settle it, an option that needs filling in, a
 * near-tie that a stated preference would break. Null when there is nothing useful to say, because a next step
 * invented to fill the slot is the kind of advice that trains people to stop reading.
 */
export function whatNext(decision: Decision, result: Result, worth: Map<string, Gap['worth']>, found: Fragility): string | null {
  const deciding = decision.gaps.find((one) => worth.get(one.id) === 'would-decide-it')
  if (deciding?.howToFind) return deciding.howToFind
  if (deciding) return `Find out: ${deciding.asks}`

  if (result.noLeader === 'too-close-to-call' && decision.criteria.length > 0) {
    const names = result.scored.filter((one) => one.tied && one.place === 1).map((one) => nameOf(decision, one.alternativeId))
    return names.length >= 2
      ? `Tell me which of these matters more to you and it will separate ${names.join(' and ')}: ${decision.criteria.slice(0, 3).map((one) => one.name).join(', ')}.`
      : null
  }

  if (result.nothingIsFeasible) {
    const closest = [...result.scored].sort((a, b) => fewestBreaks(a) - fewestBreaks(b))[0]
    const breaks = closest?.checks.filter((one) => one.meets === 'fails') ?? []
    const first = decision.constraints.find((one) => one.id === breaks[0]?.constraintId)
    return first ? `Either relax "${first.says}" or look for something else: nothing here clears it.` : null
  }

  const fragile = mattersMost(found)
  if (fragile && fragile.move < 0.25 && fragile.alternativeId) {
    const criterion = criterionOf(decision, fragile.criterionId)
    return criterion ? `Worth checking ${criterion.name} for ${nameOf(decision, fragile.alternativeId)}: the answer turns on it.` : null
  }

  const thin = result.scored.find((one) => one.coverage < decision.policy.needsCoverage)
  if (thin) return `Fill in what you know about ${nameOf(decision, thin.alternativeId)} and the comparison gets a lot firmer.`

  return null
}

const fewestBreaks = (one: Scored): number => one.checks.filter((two) => two.meets === 'fails').length

/** How steady the answer is, as a sentence rather than a score. */
export function howSteady(decision: Decision, found: Fragility): string | null {
  const first = mattersMost(found)
  if (found.stability.steadiness === 'steady' && !first) {
    return 'Nothing inside a reasonable range of what you said changes the answer.'
  }

  if (!first) return null
  const criterion = criterionOf(decision, first.criterionId)
  if (!criterion) return null

  if (first.alternativeId) {
    const who = nameOf(decision, first.alternativeId)
    const then = nameOf(decision, first.thenLeads)
    const unit = criterion.unit ? ` ${criterion.unit}` : ''
    /*
     * The figure is rounded before it is shown. The point where the answer changes is found by halving an interval
     * twelve times, so it arrives as something like 79,922 -- a number accurate to the rupee about a price that is
     * itself an estimate. Saying "about 79,900" and meaning it is better than saying 79,922 and not.
     */
    return `The answer rests on ${criterion.name} for ${who}: at about ${roughly(first.flipsAt)}${unit} instead of ${roughly(first.from)}${unit}, ${then === who ? 'it' : then} wins instead.`
  }

  const was = pc(first.from)
  const becomes = pc(first.flipsAt)
  return `The answer rests on how much ${criterion.name} matters: you have it at about ${was}% of what matters overall, and at around ${becomes}% ${nameOf(decision, first.thenLeads)} wins instead.`
}

// ---------------------------------------------------------------- putting it together

export interface VerdictOptions {
  /** Orion's suggested question, from the extraction. Used only if the engine found no reason of its own to ask. */
  orionSuggested?: string
  /** True when they said to stop asking and just answer. */
  justDecide?: boolean
  /** Orion's wording. Empty when it was not asked or could not answer. */
  says?: string
}

/** Everything the chat needs, built entirely from the decision and the result. */
export function verdictOf(decision: Decision, result: Result, found: Fragility, o: VerdictOptions = {}): Verdict {
  const shares = weightsFor(decision.criteria).share
  const worth = wouldItMatter(decision, result)
  const reasons = whyItLeads(decision, result)

  const rows: VerdictRow[] = [...result.scored]
    .sort((a, b) => a.place - b.place)
    .map((one) => {
      const alternative = decision.alternatives.find((two) => two.id === one.alternativeId)
      const spread = one.atBest - one.atWorst
      return {
        alternativeId: one.alternativeId,
        name: alternative?.name ?? one.alternativeId,
        place: one.place,
        outOf100: pc(one.score),
        // A range only when it is wide enough to mean something; two points of slop is not a range worth drawing.
        range: spread > 0.03 ? { low: pc(one.atWorst), high: pc(one.atBest) } : null,
        known: pc(one.coverage),
        tied: one.tied,
        feasible: one.feasible,
        breaks: one.checks
          .filter((two) => two.meets === 'fails')
          .map((two) => decision.constraints.find((three) => three.id === two.constraintId)?.says ?? '')
          .filter((two) => two !== ''),
        notBeaten: result.notBeaten.includes(one.alternativeId),
        suggested: alternative?.origin !== 'user-said',
        parts: decision.criteria.map((criterion) => {
          const part = one.parts.find((two) => two.criterionId === criterion.id)
          const held = alternative?.values[criterion.id]
          return {
            criterionId: criterion.id,
            name: criterion.name,
            raw: part?.raw ?? null,
            unit: criterion.unit,
            outOf100: part?.scaled === null || part?.scaled === undefined ? null : pc(part.scaled),
            weight: shares[criterion.id] ?? 0,
            guessed: held ? isGuess(held.origin) : false,
            says: held?.says ?? ''
          }
        })
      }
    })

  const noLeader =
    result.leaderId !== null
      ? null
      : result.noLeader === 'everything-ruled-out'
        ? 'Nothing here clears everything you said it has to.'
        : result.noLeader === 'too-little-known'
          ? result.scored.every((one) => one.coverage === 0)
            ? 'Nothing is known yet about how these compare, so there is nothing to put in front.'
            : 'Too little is known yet to put one in front.'
          : result.noLeader === 'too-close-to-call'
            ? 'Two of these come out level, and the difference between them is smaller than the figures can honestly support.'
            : 'There is nothing to compare yet.'

  return {
    decisionId: decision.id,
    run: result.run,
    title: decision.title,
    question: decision.question,
    leads: result.leaderId ? { alternativeId: result.leaderId, name: nameOf(decision, result.leaderId) } : null,
    noLeader,
    rows,
    because: reasons.for,
    tradeOff: whatItCosts(decision, result),
    uncertainty: howSteady(decision, found),
    nextStep: whatNext(decision, result, worth, found),
    whyNotFirst: whyNotFirst(result, rows),
    ask: whatToAsk(decision, result, worth, o),
    steadiness: found.stability.steadiness,
    howItWorked: result.howItWorked,
    notes: result.notes,
    nothingIsFeasible: result.nothingIsFeasible,
    gaps: decision.gaps.map((one) => ({ asks: one.asks, worth: worth.get(one.id) ?? 'not-tested', howToFind: one.howToFind ?? null })),
    assumptions: decision.assumptions.map((one) => one.says),
    says: o.says ?? '',
    careful: decision.sort === 'high-stakes'
  }
}

/**
 * Why the recommended option is below something else in the table.
 *
 * Worked out from the rows rather than from the engine's notes: whatever is above the leader is above it for a
 * reason the result already records -- it breaks a hard requirement, or too little is known about it to put it in
 * front of something that has actually been compared.
 */
function whyNotFirst(result: Result, rows: readonly VerdictRow[]): string | null {
  if (result.leaderId === null) return null
  const leader = rows.find((one) => one.alternativeId === result.leaderId)
  if (!leader || leader.place <= 1) return null

  const above = rows.filter((one) => one.place < leader.place)
  const reasons = above.map((one) => {
    if (one.feasible === 'fails') return `${one.name} scores higher but is out on ${one.breaks.join(' and ') || 'a hard requirement'}`
    if (one.feasible === 'unknown') return `${one.name} scores higher but it is not known whether it clears what you said it has to`
    return `${one.name} scores higher but only ${one.known}% of what matters is known about it`
  })
  if (reasons.length === 0) return null
  return `${reasons.join('; ')}. ${leader.name} is the best option that has actually been compared.`
}

// ---------------------------------------------------------------- Orion's wording

/**
 * What Orion is given to put into words.
 *
 * The verdict, and an instruction not to change any of it. Everything numerical is already decided; what is wanted
 * is the difference between a correct paragraph and a readable one.
 */
export function explainPrompt(verdict: Verdict, asked: string): string {
  const table = verdict.rows
    .map((one) => {
      const bits = one.parts
        .filter((two) => two.raw !== null)
        .map((two) => `${two.name} ${trim(two.raw as number)}${two.unit ? ' ' + two.unit : ''}${two.guessed ? ' (a guess)' : ''}`)
        .join(', ')
      return `  ${one.place}. ${one.name} — ${one.outOf100}/100${one.range ? ` (between ${one.range.low} and ${one.range.high})` : ''}${one.feasible === 'fails' ? ' — RULED OUT: ' + one.breaks.join('; ') : ''}${one.known < 100 ? ` — ${one.known}% of what matters is known about it` : ''}${bits ? `\n     ${bits}` : ''}`
    })
    .join('\n')

  return [
    'Put this result into ordinary language. The arithmetic is done and is not yours to change.',
    '',
    `They asked: ${asked.slice(0, 600)}`,
    '',
    verdict.leads ? `The answer: ${verdict.leads.name}.` : `There is no clear answer: ${verdict.noLeader}`,
    verdict.because.length ? `It leads because ${verdict.because.join(', and ')}.` : '',
    verdict.tradeOff ? `What it costs: ${verdict.tradeOff}.` : '',
    verdict.uncertainty ? `How solid it is: ${verdict.uncertainty}` : '',
    '',
    'The table:',
    table,
    '',
    verdict.notes.length ? `Worth knowing: ${verdict.notes.join(' ')}` : '',
    verdict.assumptions.length ? `Taken as true: ${verdict.assumptions.join('; ')}` : '',
    verdict.gaps.length ? `Still unknown: ${verdict.gaps.map((one) => `${one.asks} (${one.worth})`).join('; ')}` : '',
    verdict.careful
      ? '\nThis touches money, health, the law or safety. Say plainly that a weighing-up is not a substitute for somebody qualified, name what genuinely needs checking, and do not sound more certain than the figures allow.'
      : '',
    '',
    'Write it as four or five short sentences, in this order:',
    '  1. What you would go with, or that there is no clear answer.',
    '  2. Why, in their terms rather than in scores.',
    '  3. What it costs them.',
    '  4. What could change it, if anything would.',
    '',
    'Rules:',
    '  - **Do not invent a figure, an option, or a reason.** Everything you may use is above.',
    '  - **Do not quote the scores out of 100** unless they asked for detail. They are for ordering, not for',
    '    reporting, and "82 against 81" reads as a real difference when it is not.',
    '  - **Do not say how confident you are as a percentage.** What is above about how solid it is is the honest',
    '    version; use that or say nothing.',
    '  - If an option is marked RULED OUT, do not recommend it and do not soften why.',
    '  - A figure marked as a guess must not be stated as a fact.',
    '  - No preamble, no headings, no bullet points, no restating the question. Just the answer.'
  ]
    .filter((one) => one !== '')
    .join('\n')
}

/** The engine's own wording, for when there is no model answer. Flat, and never wrong. */
export function plainWords(verdict: Verdict): string {
  const bits: string[] = []
  if (verdict.leads) {
    bits.push(
      verdict.because.length > 0
        ? `${verdict.leads.name}, mainly because ${verdict.because.join(', and ')}.`
        : `${verdict.leads.name} comes out ahead.`
    )
  } else if (verdict.noLeader) {
    bits.push(verdict.noLeader)
  }
  if (verdict.tradeOff) bits.push(`What it costs you: ${verdict.tradeOff}.`)
  if (verdict.uncertainty) bits.push(verdict.uncertainty)
  if (verdict.careful) bits.push('This is the kind of decision worth putting to somebody qualified as well; what is above is a way of laying it out, not advice.')
  return bits.join(' ')
}

/** Alternatives whose values nothing else beats, as names, for the trade-off wording. */
export const notBeatenNames = (decision: Decision, result: Result): string[] =>
  result.notBeaten.map((id) => decision.alternatives.find((one) => one.id === id)?.name ?? id)

/** Whether an option was the person's own or Orion's suggestion. Used on the card to mark the difference. */
export const wasSuggested = (one: Alternative): boolean => one.origin !== 'user-said'
