/**
 * Turning what somebody wrote into a decision, and refusing what comes back wrong.
 *
 * Orion reads the message and answers with JSON: the options, what is being weighed, the hard requirements, what is
 * known about each option and how well it is known. Then every line of it is checked here before a single number
 * reaches the arithmetic.
 *
 * ## The checks are the feature
 *
 * A model asked to lay out a decision gets specific things wrong, often, and every one of them produces a
 * perfectly presentable answer:
 *
 *   - **An option nobody mentioned.** Asked to compare two laptops it helpfully adds a third. On screen that is
 *     indistinguishable from a shortlist the person chose, and it may well win.
 *   - **A figure with no source.** "Battery life: 11 hours" for a laptop whose battery life was never discussed.
 *     Marked `measured`, it outranks the figure the person actually read off a spec sheet.
 *   - **The same criterion three times.** "Ease of use", "simplicity" and "user friendliness" together give one
 *     idea three-quarters of the weight, and the option that is simple wins on a technicality.
 *   - **A requirement turned into a weight.** A budget arriving as "cost, importance 9" instead of a line nothing
 *     may cross, so the option that busts the budget gets recommended for being lovely.
 *   - **A direction the wrong way round.** Price as more-is-better, which silently recommends the dearest thing.
 *   - **Zero for unknown.** Which is the best possible price and the worst possible battery life.
 *
 * So: an option that is not in what the person wrote is kept but relabelled a suggestion; a figure claiming to be
 * measured without saying where becomes a guess; criteria that mean the same thing are merged; a requirement
 * without a line is dropped rather than being allowed to masquerade as a criterion; and a missing value is `null`
 * and never zero.
 *
 * ## It is allowed to say no
 *
 * `notADecision` is a legitimate answer, and the gate upstream leans on it: being generous about what might be a
 * decision is only safe because the model can hand a message back, and the conversation then carries on as if none
 * of this ran.
 */
import {
  DECISION_VERSION,
  DEFAULT_POLICY,
  no,
  type Alternative,
  type Assumption,
  type Band,
  type Constraint,
  type ConstraintTest,
  type Criterion,
  type Decision,
  type DecisionSort,
  type Direction,
  type Gap,
  type Known,
  type Origin,
  type Refusal,
  type Scaling
} from './types.ts'

/**
 * The plain scale a word falls on when a criterion did not name its own bands.
 *
 * Five points, evenly spaced, with the words people actually use. It is an ordinal scale and is treated as one:
 * the gap between "fair" and "good" is not claimed to be the same size as the gap between "good" and "great", and
 * nothing downstream reads these as measurements. What it prevents is the alternative, which is throwing away
 * every judgement that was not a number -- and for "which language should I learn first" that is all of them.
 */
const WORD_SCALE: readonly (readonly [RegExp, number])[] = [
  [/^(?:terrible|awful|very\s*(?:bad|low|poor|hard|difficult)|none|worst|lowest)$/i, 0],
  [/^(?:bad|low|poor|weak|hard|difficult|little|small|slow|minimal|limited)$/i, 0.25],
  [/^(?:ok(?:ay)?|fair|medium|moderate|average|middling|some|modest|mixed|neutral|mid)$/i, 0.5],
  [/^(?:good|high|strong|easy|large|big|fast|plenty|solid|broad|wide|significant|substantial)$/i, 0.75],
  [/^(?:excellent|great|very\s*(?:good|high|strong|easy|large|fast)|best|highest|huge|enormous|outstanding|perfect)$/i, 1]
]

/** What a word is worth on a criterion: its own band if it named one, otherwise the plain scale. Null for neither. */
export function worthOfWord(word: string, criterion: Pick<Criterion, 'bands'>): number | null {
  const said = word.trim()
  if (said === '') return null
  for (const band of criterion.bands ?? []) {
    if (band.name.toLowerCase() === said.toLowerCase()) return band.worth
  }
  for (const [pattern, worth] of WORD_SCALE) if (pattern.test(said)) return worth
  return null
}

/** The most of each thing a decision may hold. Past these it stops being a decision and becomes a spreadsheet. */
export const MOST_ALTERNATIVES = 8
export const MOST_CRITERIA = 10
export const MOST_CONSTRAINTS = 8
export const MOST_GAPS = 8

// ---------------------------------------------------------------- what Orion is asked

export interface AskFor {
  /** The message to work from. */
  message: string
  /** Earlier turns, oldest first, already trimmed by the caller. Empty when there are none. */
  before: readonly string[]
  /** What the gate thought it was, which Orion may overrule. */
  sort: DecisionSort
  /** The things the gate saw named, as hints. */
  named: readonly string[]
}

export function extractPrompt(o: AskFor): string {
  const careful =
    o.sort === 'high-stakes'
      ? [
          '',
          'This touches money, health, the law or safety. Be more careful than usual: do not fill in figures that were',
          'not given, do not treat a weighing-up as a substitute for professional advice, and put the things that',
          'genuinely need checking into `gaps` rather than assuming them.'
        ]
      : []

  return [
    'Lay out the decision in this message as structured data. You are not answering it; you are describing it.',
    '',
    o.before.length > 0 ? `Earlier in the conversation:\n"""\n${o.before.join('\n---\n').slice(0, 6000)}\n"""\n` : '',
    `The message:\n"""\n${o.message.slice(0, 4000)}\n"""`,
    o.named.length > 0 ? `\nThings that look like the options: ${o.named.join(', ')}` : '',
    ...careful,
    '',
    'Answer with JSON and nothing else:',
    '{',
    '  "notADecision": false,',
    '  "title": "<four or five words, for a saved list>",',
    '  "question": "<the question, as close to their words as you can>",',
    '  "aim": "<what they are actually trying to achieve, which is not always the question>",',
    '  "sort": "buying|what-to-build-first|learning|time|technical|high-stakes|other",',
    '  "alternatives": [',
    '    {',
    '      "name": "<short>",',
    '      "describe": "<a sentence>",',
    '      "mentioned": true,',
    '      "upsides": ["<...>"],',
    '      "downsides": ["<...>"],',
    '      "values": { "<criterion name>": { "value": <number OR a word from that criterion\'s bands>, "origin": "user-said|measured|from-source|derived|estimated|assumed|unknown", "says": "<where it came from>", "low": <number>, "high": <number> } }',
    '    }',
    '  ],',
    '  "criteria": [',
    '    {',
    '      "name": "<two or three ordinary words, as somebody would say them out loud>",',
    '      "describe": "<what counts as better here>",',
    '      "direction": "more-is-better|less-is-better|closest-to-target",',
    '      "importance": <0 to 10>,',
    '      "scaling": "min-max|against-target|bands|yes-no|own-scale",',
    '      "unit": "<e.g. rupees, days, out of 5; empty if measured in words>",',
    '      "target": <number, only for against-target or closest-to-target>,',
    '      "bands": [{ "name": "<e.g. hard>", "worth": 0.2 }],',
    '      "mentioned": true,',
    '      "because": "<why this one is here>"',
    '    }',
    '  ],',
    '  "constraints": [',
    '    { "says": "<in their words, e.g. under 50,000 rupees>", "criterion": "<criterion name>", "test": "at-most|at-least|must-equal|must-be-true|must-be-false", "limit": <number>, "unit": "<...>" }',
    '  ],',
    '  "preferences": ["<things they would like but would trade away>"],',
    '  "assumptions": [{ "says": "<what is being taken as true>", "criterion": "<name or empty>", "alternative": "<name or empty>" }],',
    '  "gaps": [{ "asks": "<the missing thing, as a question>", "criterion": "<name or empty>", "alternative": "<name or empty>", "howToFind": "<a practical way to find out>" }],',
    '  "askThem": "<the single most useful question to ask, or empty if none is worth the interruption>"',
    '}',
    '',
    'Rules. Each one is checked before any arithmetic runs, and breaking one gets the item changed or thrown away:',
    '  - **Set `notADecision` to true if this is not somebody trying to choose something.** A question about how',
    '    deciding works, a request to explain or build something, or ordinary conversation all belong here. Say why',
    '    in `title`. This is a normal answer, not a failure.',
    '  - **Never add an option they did not mention** unless they asked for suggestions. If you do propose one, set',
    '    `mentioned` to false. An option marked as mentioned that is not in their words is relabelled a suggestion.',
    '  - **`values` is keyed by criterion name, and every key must be one of the criteria you listed.**',
    '  - **Leave a value out entirely when it is not known.** Do not write 0, and do not guess a number to fill the',
    '    table. Put the missing thing in `gaps` instead. A table with holes in it is the honest table.',
    '  - **A criterion with no natural number still needs values.** Set its `scaling` to "bands", list three to five',
    '    `bands` worst to best with a `worth` from 0 to 1, and give each option that band\'s name as its `value`.',
    '    This is how things like ease of learning or community support get compared at all; leaving them blank for',
    '    every option means there is nothing to compare on and no answer can be given.',
    '  - **`origin` must say where each figure really came from.** `user-said` only for what they wrote.',
    '    `measured` or `from-source` only when `says` names the source. Your own reckoning is `estimated`.',
    '  - **A hard requirement is a constraint, not an important criterion.** A budget, a deadline, "must run on',
    '    Windows" go in `constraints` with a limit. Being very important is not the same as being a condition.',
    '  - **Check the direction of every criterion.** Price, effort and risk are almost always less-is-better.',
    '  - **Do not list the same idea twice.** Ease of use, simplicity and friendliness are one criterion.',
    '  - **Name things in words, not in identifiers.** "time to build", not "time-to-build"; "community support",',
    '    not "community_support". These names are read out in sentences and printed above a table.',
    '  - **Four to seven criteria is usually right**, and only ones that actually separate these options.',
    '  - **`askThem` should be empty unless the answer would change the ranking.** One question, not a form.'
  ]
    .filter((one) => one !== '')
    .join('\n')
}

// ---------------------------------------------------------------- reading it back

const ORIGINS: readonly Origin[] = ['measured', 'user-said', 'from-source', 'derived', 'estimated', 'assumed', 'unknown']
const DIRECTIONS: readonly Direction[] = ['more-is-better', 'less-is-better', 'closest-to-target']
const SCALINGS: readonly Scaling[] = ['min-max', 'against-target', 'bands', 'yes-no', 'own-scale']
const TESTS: readonly ConstraintTest[] = ['at-most', 'at-least', 'must-equal', 'must-be-true', 'must-be-false']
const SORTS: readonly DecisionSort[] = ['buying', 'what-to-build-first', 'learning', 'time', 'technical', 'high-stakes', 'other']

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const words = (value: unknown, most = 200): string => (typeof value === 'string' ? value.trim().slice(0, most) : '')
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/**
 * A name as somebody would say it.
 *
 * A model asked for a short name routinely answers with an identifier -- `time-to-build`, `community_support` --
 * and that then appears in the table header, on the controls, and inside sentences: "tell me which matters more:
 * effort, time-to-build, community-support". Only applied to a name that is plainly an identifier: one word with
 * a hyphen or an underscore in it. A real name with a hyphen in it ("day-to-day cost") has spaces too and is left
 * exactly as written.
 */
export function asWords(name: string): string {
  const said = name.trim()
  if (said.includes(' ') || !/[-_]/.test(said)) return said
  return said.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** A stable id from a name. Same name, same id, so a follow-up can name a thing and be understood. */
export function idFrom(name: string, taken: Set<string>, prefix: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || prefix
  let id = base
  let at = 2
  while (taken.has(id)) id = `${base}-${at++}`
  taken.add(id)
  return id
}

/**
 * Two criterion names that mean the same thing.
 *
 * Deliberately shallow: the filler words come off, a handful of pairs that genuinely are one idea are listed, and
 * that is all. Anything cleverer would start merging criteria that are actually different -- "cost" and "running
 * cost" are two things, and a decision that cannot tell them apart is worse than one with a near-duplicate in it.
 */
const SAME_IDEA: readonly (readonly string[])[] = [
  ['easy', 'easiness', 'ease', 'simple', 'simplicity', 'friendly', 'friendliness', 'usable', 'usability', 'use', 'usage', 'straightforward'],
  ['quick', 'quickness', 'fast', 'speed', 'speedy', 'rapid'],
  ['cost', 'price', 'pricing', 'cheap', 'cheapness', 'affordable', 'affordability', 'inexpensive', 'expense', 'expensive'],
  ['reliable', 'reliability', 'dependable', 'dependability', 'stable', 'stability', 'robust', 'robustness'],
  ['maintain', 'maintainable', 'maintainability', 'maintenance', 'upkeep'],
  ['effort', 'labour', 'labor', 'difficulty', 'difficult', 'hardness']
]

const FILLER = /\b(?:of|the|a|an|to|for|and|is|it|how|very|quite|more|less|overall|level|degree|amount)\b/g

/** The family a word belongs to, or -1. The word itself and its stem are both tried. */
function familyOf(word: string): number {
  const stem = word.replace(/(?:ness|ility|ity|ance|ence|ing|ed|s)$/, '')
  for (let at = 0; at < SAME_IDEA.length; at++) {
    if (SAME_IDEA[at].includes(word) || SAME_IDEA[at].includes(stem)) return at
  }
  return -1
}

/**
 * Two names that mean the same thing come out as the same string here.
 *
 * The rule is narrow on purpose: a name collapses to a family only when **every** word in it belongs to that one
 * family. "Ease of use" and "simplicity" both come out as `easy`; "running cost" does not come out as `cost`,
 * because `running` is in no family and the two are genuinely different things. The looser version -- collapsing
 * as soon as any word is in a family -- merges "learning difficulty" with "development effort", and a comparison
 * that cannot tell those apart is worse than one with a near-duplicate in it.
 */
function ideaOf(name: string): string {
  const plain = name.toLowerCase().replace(FILLER, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const bits = plain.split(' ').filter((one) => one.length > 2)
  if (bits.length === 0) return ''

  const families = bits.map((word) => familyOf(word))
  const first = families[0]
  if (first >= 0 && families.every((one) => one === first)) return SAME_IDEA[first][0]

  // Not one idea: the stemmed words, so "maintainability" and "maintainable" still land together.
  return [...new Set(bits.map((word) => word.replace(/(?:ness|ility|ity|ance|ence|ing|ed|s)$/, '')))].sort().join(' ')
}

export interface ReadOptions {
  /** Everything the person has actually written in this conversation, for checking what was mentioned. */
  said: string
  conversationId: string
  id: string
  now: number
  /** What the gate thought it was. Used when Orion does not say. */
  sort: DecisionSort
}

export interface Extracted {
  decision: Decision
  /** The one question worth asking, or empty. */
  askThem: string
  /** What was changed or thrown away on the way in, for the log. Never shown as it is. */
  fixed: readonly string[]
}

/** Orion handed the message back: this is not a decision. */
export interface NotADecision {
  notADecision: true
  because: string
}

export const isNotADecision = (held: unknown): held is NotADecision =>
  typeof held === 'object' && held !== null && (held as { notADecision?: unknown }).notADecision === true

/**
 * JSON from Orion to a decision, or a reason there is not one.
 *
 * Everything is coerced rather than trusted, and the nothing-but-JSON instruction is not relied on: a model that
 * wraps its answer in a fence or a sentence is routine, so the outermost braces are found first.
 */
export function readExtraction(text: string, o: ReadOptions): Extracted | NotADecision | Refusal {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return no('Orion did not answer in a shape this could use.', 'Ask again, or say what the options are and what matters.', 'no json')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return no('Orion did not answer in a shape this could use.', 'Ask again in a moment.', 'json did not parse')
  }

  const top = object(parsed)
  if (top.notADecision === true) {
    return { notADecision: true, because: words(top.title, 160) || 'it is not a decision' }
  }

  const fixed: string[] = []
  const said = o.said.toLowerCase()

  // ---- criteria first: everything else refers to them by name
  const criterionIds = new Set<string>()
  const byIdea = new Map<string, Criterion>()
  const nameToId = new Map<string, string>()

  for (const entry of list(top.criteria).slice(0, MOST_CRITERIA * 2)) {
    const one = object(entry)
    const name = asWords(words(one.name, 60))
    if (name === '') continue

    const idea = ideaOf(name)
    const already = idea === '' ? undefined : byIdea.get(idea)
    if (already) {
      /*
       * The same idea twice. The importances are added rather than one being dropped, because somebody who said
       * "it has to be simple and easy to pick up" did mean that it matters a lot -- just once, not twice.
       */
      const merged: Criterion = { ...already, importance: already.importance + Math.max(0, number(one.importance) ?? 0) }
      byIdea.set(idea, merged)
      nameToId.set(name.toLowerCase(), already.id)
      fixed.push(`"${name}" was merged into "${already.name}" because they are the same idea.`)
      continue
    }

    const direction = oneOf(one.direction, DIRECTIONS, 'more-is-better')
    let scaling = oneOf(one.scaling, SCALINGS, 'min-max')
    const target = number(one.target)
    const bands = list(one.bands)
      .map((two) => {
        const band = object(two)
        const bandName = words(band.name, 40)
        const worth = number(band.worth)
        return bandName === '' || worth === null ? null : ({ name: bandName, worth: Math.min(1, Math.max(0, worth)) } satisfies Band)
      })
      .filter((two): two is Band => two !== null)
      .slice(0, 8)

    // A scaling that needs something it was not given cannot be used, and falling back is better than failing.
    if (scaling === 'against-target' && (target === null || target === 0)) {
      scaling = 'min-max'
      fixed.push(`"${name}" asked to be measured against a target but gave none, so it is spread across what the options offer.`)
    }
    if (scaling === 'bands' && bands.length < 2) {
      scaling = 'min-max'
      fixed.push(`"${name}" asked for named bands but gave fewer than two.`)
    }

    const id = idFrom(name, criterionIds, 'criterion')
    const criterion: Criterion = {
      id,
      name,
      describe: words(one.describe, 240),
      direction,
      importance: Math.min(100, Math.max(0, number(one.importance) ?? 1)),
      scaling,
      unit: words(one.unit, 24),
      ...(bands.length >= 2 ? { bands } : {}),
      ...(target !== null ? { target } : {}),
      origin: one.mentioned === false ? 'estimated' : 'user-said',
      ...(words(one.because, 200) ? { because: words(one.because, 200) } : {})
    }
    if (idea !== '') byIdea.set(idea, criterion)
    else byIdea.set(`#${id}`, criterion)
    nameToId.set(name.toLowerCase(), id)
  }

  const criteria: Criterion[] = [...byIdea.values()].slice(0, MOST_CRITERIA)
  const liveCriteria = new Set(criteria.map((one) => one.id))
  const criterionByName = (value: unknown): string | null => {
    const name = words(value, 60).toLowerCase()
    if (name === '') return null
    const id = nameToId.get(name)
    return id && liveCriteria.has(id) ? id : null
  }

  // ---- alternatives
  const alternativeIds = new Set<string>()
  const alternatives: Alternative[] = []
  const nameToAlternative = new Map<string, string>()

  for (const entry of list(top.alternatives).slice(0, MOST_ALTERNATIVES)) {
    const one = object(entry)
    const name = words(one.name, 80)
    if (name === '') continue
    if (nameToAlternative.has(name.toLowerCase())) {
      fixed.push(`"${name}" was listed twice; the second was dropped.`)
      continue
    }

    /*
     * Was this actually mentioned? A rough test on purpose -- the longest word in the name appearing somewhere in
     * what the person wrote. Being too strict here would relabel "the 16GB one" as a suggestion, which is worse
     * than occasionally believing a claim.
     */
    const longest = name
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      .filter((two) => two.length > 2)
      .sort((a, b) => b.length - a.length)[0]
    const reallyMentioned = longest !== undefined && said.includes(longest)
    let origin: Origin = one.mentioned === false ? 'estimated' : 'user-said'
    if (origin === 'user-said' && !reallyMentioned) {
      origin = 'estimated'
      fixed.push(`"${name}" is not in anything you wrote, so it is shown as a suggestion rather than as one of your options.`)
    }

    const values: Record<string, Known> = {}
    for (const [key, held] of Object.entries(object(one.values))) {
      const criterionId = criterionByName(key)
      if (!criterionId) {
        fixed.push(`A figure for "${name}" was given under "${key}", which is not one of the things being weighed.`)
        continue
      }
      const cell = object(held)
      const criterion = criteria.find((two) => two.id === criterionId)
      let value = number(cell.value)
      let asWord = ''

      /*
       * A word is an answer too.
       *
       * "Ease of learning: high" is the only kind of answer that criterion has, and insisting on a number threw
       * every one of them away -- which turned a real comparison into a table of blanks. The word is placed on the
       * criterion's own named bands if it gave any, and on a plain five-point scale if it did not.
       */
      if (value === null && typeof cell.value === 'string' && criterion) {
        const worth = worthOfWord(cell.value, criterion)
        if (worth !== null) {
          value = worth
          asWord = cell.value.trim().slice(0, 40)
        }
      }
      if (value === null && typeof cell.band === 'string' && criterion) {
        const worth = worthOfWord(cell.band, criterion)
        if (worth !== null) {
          value = worth
          asWord = cell.band.trim().slice(0, 40)
        }
      }

      // Neither a number nor a word anybody could place. Not known, and never zero.
      if (value === null) continue

      let cellOrigin = oneOf(cell.origin, ORIGINS, 'estimated')
      const says = words(cell.says, 160)
      if ((cellOrigin === 'measured' || cellOrigin === 'from-source') && says === '') {
        cellOrigin = 'estimated'
        fixed.push(`A figure for "${name}" claimed to be measured but did not say where from, so it counts as a guess.`)
      }
      const low = number(cell.low)
      const high = number(cell.high)

      values[criterionId] = {
        value,
        origin: cellOrigin,
        ...(asWord === '' && low !== null && low <= value ? { low } : {}),
        ...(asWord === '' && high !== null && high >= value ? { high } : {}),
        ...(says ? { says } : {}),
        ...(asWord ? { band: asWord } : {})
      }
      /*
       * A word was placed on a scale, so the criterion is measured in words whatever it said it was. Without this
       * the values sit between nought and one and get spread across that range again, which turns "good" and
       * "excellent" into nought and one -- the full width of the scale for one step along it.
       */
      if (asWord !== '' && criterion && criterion.scaling !== 'bands') {
        const at = criteria.findIndex((two) => two.id === criterionId)
        if (at >= 0) {
          criteria[at] = { ...criteria[at], scaling: 'bands', unit: '' }
          fixed.push(`"${criteria[at].name}" was answered in words, so it is judged on a named scale rather than on numbers.`)
        }
      }
    }

    const id = idFrom(name, alternativeIds, 'option')
    nameToAlternative.set(name.toLowerCase(), id)
    alternatives.push({
      id,
      name,
      describe: words(one.describe, 300),
      values,
      upsides: list(one.upsides).map((two) => words(two, 160)).filter((two) => two !== '').slice(0, 6),
      downsides: list(one.downsides).map((two) => words(two, 160)).filter((two) => two !== '').slice(0, 6),
      origin
    })
  }

  const alternativeByName = (value: unknown): string | null => {
    const name = words(value, 80).toLowerCase()
    return name === '' ? null : nameToAlternative.get(name) ?? null
  }

  // ---- hard requirements
  const constraintIds = new Set<string>()
  const constraints: Constraint[] = []
  for (const entry of list(top.constraints).slice(0, MOST_CONSTRAINTS)) {
    const one = object(entry)
    const says = words(one.says, 200)
    if (says === '') continue
    const test = oneOf(one.test, TESTS, 'at-most')
    const limit = number(one.limit)
    const criterionId = criterionByName(one.criterion)

    /*
     * A requirement with nothing to test is not a requirement. Keeping it would mean every option sitting at
     * "cannot tell", which blocks a recommendation for ever over a line that was never actually drawn.
     */
    if (test !== 'must-be-true' && test !== 'must-be-false' && limit === null) {
      fixed.push(`"${says}" was given as a hard requirement with no line to be on the right side of, so it is only a preference.`)
      continue
    }
    if (criterionId === null) {
      fixed.push(`"${says}" was given as a hard requirement about something that is not being weighed, so it cannot be checked.`)
      continue
    }

    constraints.push({
      id: idFrom(says, constraintIds, 'must'),
      says,
      criterionId,
      test,
      limit: test === 'must-be-true' || test === 'must-be-false' ? null : limit,
      unit: words(one.unit, 24),
      origin: 'user-said'
    })
  }

  // ---- what is assumed and what is missing
  const assumptionIds = new Set<string>()
  const assumptions: Assumption[] = list(top.assumptions)
    .map((entry): Assumption | null => {
      const one = object(entry)
      const says = words(one.says, 240)
      if (says === '') return null
      const criterionId = criterionByName(one.criterion)
      const alternativeId = alternativeByName(one.alternative)
      return {
        id: idFrom(says, assumptionIds, 'assumed'),
        says,
        about: { ...(criterionId ? { criterionId } : {}), ...(alternativeId ? { alternativeId } : {}) },
        matters: 'not-tested'
      }
    })
    .filter((one): one is Assumption => one !== null)
    .slice(0, MOST_GAPS)

  const gapIds = new Set<string>()
  const gaps: Gap[] = list(top.gaps)
    .map((entry): Gap | null => {
      const one = object(entry)
      const asks = words(one.asks, 240)
      if (asks === '') return null
      const criterionId = criterionByName(one.criterion)
      const alternativeId = alternativeByName(one.alternative)
      const howToFind = words(one.howToFind, 200)
      return {
        id: idFrom(asks, gapIds, 'gap'),
        asks,
        about: { ...(criterionId ? { criterionId } : {}), ...(alternativeId ? { alternativeId } : {}) },
        worth: 'not-tested',
        ...(howToFind ? { howToFind } : {})
      }
    })
    .filter((one): one is Gap => one !== null)
    .slice(0, MOST_GAPS)

  const question = words(top.question, 400)
  if (alternatives.length === 0) {
    return no(
      'There is nothing to compare yet.',
      'Say what the options are, even roughly, and I will work from those.',
      'no alternatives'
    )
  }
  /*
   * Nothing to weigh. Letting this through produces a table of zeroes and a dead heat, which looks like an answer
   * and is the absence of one.
   */
  if (criteria.length === 0) {
    return no(
      'Nothing came back about what actually matters here, so there is nothing to weigh the options on.',
      'Say what you care about -- cost, time, how well it works -- and I will compare them on that.',
      'no criteria'
    )
  }

  const decision: Decision = {
    id: o.id,
    v: DECISION_VERSION,
    title: words(top.title, 80) || question.slice(0, 60) || 'A decision',
    question,
    aim: words(top.aim, 300),
    alternatives,
    criteria,
    constraints,
    preferences: list(top.preferences).map((one) => words(one, 160)).filter((one) => one !== '').slice(0, 8),
    assumptions,
    gaps,
    policy: { ...DEFAULT_POLICY },
    conversationId: o.conversationId,
    saved: false,
    sort: oneOf(top.sort, SORTS, o.sort),
    madeAt: o.now,
    changedAt: o.now,
    history: [{ at: o.now, what: 'Worked out from what you wrote.', from: o.said.slice(0, 300) }]
  }

  return { decision, askThem: words(top.askThem, 300), fixed }
}
