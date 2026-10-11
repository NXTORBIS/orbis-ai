/**
 * What a decision is, as Orbis holds it.
 *
 * ## Why there is a structure at all
 *
 * The conversation is not enough. "Cost matters more" four messages ago, "actually five days, not two weeks" two
 * messages ago, and "add a third option" just now are three changes to one thing, and working them out again from
 * the transcript on every message gets a different answer every time. So the decision is a value: the alternatives,
 * what is being weighed, what is known and what is merely assumed, the method, and what came out of it. A message
 * changes part of it; the rest is left exactly as it was.
 *
 * ## The one rule everything here exists to serve
 *
 * **A number in this structure says where it came from.** `Measured`, `UserSaid`, `FromSource`, `Estimated`,
 * `Assumed`, `Unknown` -- and `Unknown` is a real answer, not zero. A model's guess at a laptop's battery life and
 * a figure the user read off a spec sheet are both numbers; treating them as the same number is how a decision
 * engine produces confident nonsense. Nothing in the engine ever sees a bare number without its origin.
 *
 * `Unknown` being distinct from zero is load-bearing twice over: zero is the worst possible value on a benefit
 * criterion and the best on a cost one, so "we do not know what this costs" would silently become "it is free".
 *
 * ## Hard constraints are not a criterion with a big weight
 *
 * A budget of fifty thousand is not "cost is very important". It is a line: above it, the option is out, however
 * good it is at everything else. Held separately from the weighted criteria for exactly that reason, and the
 * engine applies it before it scores anything.
 *
 * ## Versioned on purpose
 *
 * `v` is on every stored decision. A decision saved today has to be readable after the scoring changes, and the
 * alternative -- reading an old shape as though it were the new one -- is how a saved decision quietly becomes a
 * different decision.
 */

/** The shape of a stored decision. Raised when a change cannot be read from the old shape. */
export const DECISION_VERSION = 1

// ---------------------------------------------------------------- where a number came from

/**
 * How well something is known.
 *
 * Ordered worst to best is deliberate: `rankEvidence` below turns these into a number so two alternatives can be
 * compared on how well each is known, which is what stops a well-researched option losing to a guess.
 */
export type Origin =
  /** Measured, counted, or read off the thing itself. */
  | 'measured'
  /** The person said so. Their own budget, their own deadline, their own preference. */
  | 'user-said'
  /** Taken from a page, document or quotation that is named. */
  | 'from-source'
  /** Worked out from something else that is known, with the working recorded. */
  | 'derived'
  /** A guess with a stated basis. Orion's reading of what is likely, labelled as that. */
  | 'estimated'
  /** Made up to let the sums run at all, and shown as an assumption wherever it matters. */
  | 'assumed'
  /** Not known. Never silently a number. */
  | 'unknown'

const EVIDENCE_ORDER: readonly Origin[] = ['unknown', 'assumed', 'estimated', 'derived', 'from-source', 'user-said', 'measured']

/** How well known, as a number from 0 (not at all) to 1 (measured). For comparing, never for scoring. */
export const rankEvidence = (origin: Origin): number => {
  const at = EVIDENCE_ORDER.indexOf(origin)
  return at < 0 ? 0 : at / (EVIDENCE_ORDER.length - 1)
}

/** True for the two origins that are a guess rather than a fact, so a screen can mark them. */
export const isGuess = (origin: Origin): boolean => origin === 'estimated' || origin === 'assumed'

/**
 * One number, or one word, with its origin and its spread.
 *
 * `low`/`high` carry a range when something is known only to within a range -- "somewhere between four and seven
 * days". A single figure leaves them unset. The engine uses them to say whether the answer would change inside
 * that range, which is the honest version of a confidence percentage.
 */
export interface Known {
  /** The number, or null when the answer is that nobody knows. */
  value: number | null
  origin: Origin
  /** The bottom of the range, when there is one. */
  low?: number
  /** The top of the range, when there is one. */
  high?: number
  /** Where it came from, in words somebody would recognise: a page title, "you said", "a guess". */
  says?: string
  /** For a criterion measured in words rather than numbers: which band this is, by name. */
  band?: string
}

export const unknown = (why: Origin = 'unknown'): Known => ({ value: null, origin: why })
export const known = (value: number, origin: Origin, says?: string): Known => ({ value, origin, ...(says ? { says } : {}) })

// ---------------------------------------------------------------- criteria

/** Whether more is better or worse. Never guessed from the numbers. */
export type Direction = 'more-is-better' | 'less-is-better' | 'closest-to-target'

/**
 * How a criterion's raw values are brought onto one scale.
 *
 * Chosen per criterion, never once for the whole decision: price in rupees and a one-to-five rating cannot share a
 * method, and using one for both lets the bigger numbers decide the answer on their own.
 */
export type Scaling =
  /** Spread the observed values across 0 to 1. The usual one for numbers. */
  | 'min-max'
  /** Against a figure that means something outside this decision -- a budget, a target, a deadline. */
  | 'against-target'
  /** Named bands with stated meanings, each worth a fixed amount. For things measured in words. */
  | 'bands'
  /** Yes or no. */
  | 'yes-no'
  /** A scale the person set themselves, with their own ends. */
  | 'own-scale'

export interface Band {
  /** What the band is called, in the words a person would use: "easy", "a few days", "well supported". */
  name: string
  /** What it is worth, 0 to 1. Stated here so the scale is readable rather than hidden in code. */
  worth: number
}

export interface Criterion {
  id: string
  /** What a person would call it. */
  name: string
  /** One sentence: what counts as better, and how it is being judged. */
  describe: string
  direction: Direction
  /**
   * How much it matters, as given. Any nonnegative number; they are normalised at scoring time, so "3" and "0.3"
   * mean the same thing next to a "1".
   */
  importance: number
  scaling: Scaling
  /** The unit the raw numbers are in, for the screen. Empty when the criterion is measured in words. */
  unit: string
  /** The bands, when `scaling` is `bands`. Ordered worst to best. */
  bands?: readonly Band[]
  /** The figure `against-target` compares to, and what `closest-to-target` aims at. */
  target?: number
  /** The ends of an `own-scale`. */
  scale?: { worst: number; best: number }
  /**
   * Where this criterion came from. A criterion the person named is not the same as one Orion proposed, and a
   * proposed one may be dropped without argument.
   */
  origin: Origin
  /** Why it is here, for when somebody asks. */
  because?: string
}

// ---------------------------------------------------------------- hard constraints

export type ConstraintTest = 'at-most' | 'at-least' | 'must-equal' | 'must-be-true' | 'must-be-false'

/**
 * A line an option has to be on the right side of.
 *
 * Deliberately not a criterion. A budget is not "cost matters a lot": no amount of being wonderful elsewhere puts
 * an option back under the budget, and a weighted score cannot express that.
 */
export interface Constraint {
  id: string
  /** In the person's words: "under fifty thousand rupees", "ready in two weeks", "works on Windows". */
  says: string
  /** Which criterion it is about, when it is about one. Null for a condition with no criterion of its own. */
  criterionId: string | null
  test: ConstraintTest
  /** The line itself. Null for the two true/false tests. */
  limit: number | null
  unit: string
  origin: Origin
}

/** What happened when an option was held against a constraint. */
export type Meets =
  /** Clear of it. */
  | 'meets'
  /** Over the line. */
  | 'fails'
  /** On the right side only if something else holds, which is recorded with it. */
  | 'conditional'
  /** Not enough is known to say. Never counted as passing. */
  | 'unknown'

export interface ConstraintCheck {
  constraintId: string
  meets: Meets
  /** How far over, when it fails and the numbers allow it to be said. */
  over?: number
  /** What it depends on, when `conditional`. */
  ifAlso?: string
}

// ---------------------------------------------------------------- alternatives

export interface Alternative {
  id: string
  name: string
  /** One or two sentences. What this option actually is. */
  describe: string
  /** What each criterion measures for this option, keyed by criterion id. */
  values: Readonly<Record<string, Known>>
  /** Said for it, in the person's or Orion's words. Not scored; for the explanation. */
  upsides: readonly string[]
  /** Said against it. */
  downsides: readonly string[]
  /**
   * Whether the person named this option or Orion proposed it.
   *
   * An option Orion proposed is marked on screen as a suggestion. Presenting one as though the person had offered
   * it is how a shortlist quietly becomes Orion's shortlist.
   */
  origin: Origin
  /** How hard this one would be to undo, when it is known. */
  reversibility?: Reversibility
  /**
   * What might happen if this option is taken, with the chance of each.
   *
   * Only ever set when real chances exist -- a measured failure rate, a quoted probability, a figure the person
   * gave. It is what `expected-value` works on, and it is absent far more often than it is present, which is why
   * that method reports that it cannot be used rather than inventing percentages.
   */
  outcomes?: readonly Outcome[]
}

/** One thing that might happen, its chance, and what it would be worth. */
export interface Outcome {
  says: string
  /** 0 to 1. */
  chance: Known
  /** What it is worth if it happens, on whatever scale the decision uses throughout. */
  worth: Known
}

export type Reversibility = 'easy' | 'some-cost' | 'hard' | 'effectively-final' | 'unknown'

// ---------------------------------------------------------------- what is not known

export interface Assumption {
  id: string
  /** What is being taken as true: "a working day is six hours". */
  says: string
  /** What it affects, so changing it can be followed through. */
  about: { criterionId?: string; alternativeId?: string; constraintId?: string }
  /** Whether the answer moves when this is wrong. Filled in by the sensitivity run, not asserted here. */
  matters?: 'a-lot' | 'some' | 'little' | 'not-tested'
}

export interface Gap {
  id: string
  /** What is missing, as a question: "how much of Files is already done?" */
  asks: string
  about: { criterionId?: string; alternativeId?: string; constraintId?: string }
  /** How much it would change things. Set by the engine where it can be worked out, never guessed. */
  worth?: 'would-decide-it' | 'could-change-it' | 'would-not-change-it' | 'not-tested'
  /** A practical way to find out. */
  howToFind?: string
}

// ---------------------------------------------------------------- method and policy

export type Method =
  /** Importance times value, added up. The usual one. */
  | 'weighted-sum'
  /** Most important criterion first, and only look at the next one when the first cannot separate them. */
  | 'in-order-of-importance'
  /** Rule out whatever breaks a hard requirement, and say if nothing is left. */
  | 'rule-out'
  /** Which options nothing else beats outright. */
  | 'nothing-beats-it'
  /** How close each option gets to the targets that were set. */
  | 'closest-to-what-you-asked'
  /** Chance times outcome. Only when real chances and real outcomes exist. */
  | 'expected-value'

/** What to do about a criterion an option has no value for. */
export type WhenMissing =
  /** Score each option over the criteria it has, and say how much of the weight that covered. The default. */
  | 'share-out-the-rest'
  /** Drop any criterion that is missing for anybody, so every option is judged on the same things. */
  | 'drop-the-criterion'
  /** Refuse to rank when too little is known, and say so. */
  | 'say-it-is-not-known'

export interface Policy {
  method: Method
  whenMissing: WhenMissing
  /**
   * How close two scores have to be to count as the same, on the 0-to-1 scale.
   *
   * There is a number here because the alternative is pretending that 0.82 beats 0.81. Two hundredths of the whole
   * range is about the finest distinction qualitative inputs can honestly support.
   */
  tieWithin: number
  /** Below this much of the weight covered, an option is reported as not properly comparable. */
  needsCoverage: number
}

export const DEFAULT_POLICY: Policy = Object.freeze({
  method: 'weighted-sum',
  whenMissing: 'share-out-the-rest',
  tieWithin: 0.02,
  needsCoverage: 0.6
})

// ---------------------------------------------------------------- the decision itself

export interface Decision {
  id: string
  v: number
  /** A short name, for the saved list. */
  title: string
  /** The question in the person's own words, as near as it can be kept. */
  question: string
  /** What they are trying to achieve, which is not always the same as the question. */
  aim: string
  alternatives: readonly Alternative[]
  criteria: readonly Criterion[]
  constraints: readonly Constraint[]
  /** Things they would like but would trade away. Kept as words; the criteria carry the weighing. */
  preferences: readonly string[]
  assumptions: readonly Assumption[]
  gaps: readonly Gap[]
  policy: Policy
  /** The conversation it belongs to, so a follow-up finds it again. */
  conversationId: string
  /** Set once the person asked for it to be kept. */
  saved: boolean
  /** What kind of decision it is, which is what picks the extra checks that apply. */
  sort: DecisionSort
  madeAt: number
  changedAt: number
  /** Each change, oldest first, so "show me the first answer" can be honoured. */
  history: readonly Revision[]
}

export type DecisionSort =
  | 'buying'
  | 'what-to-build-first'
  | 'learning'
  | 'time'
  | 'technical'
  | 'high-stakes'
  | 'other'

/** One change to a decision, kept so the person can go back and so a diff can be shown. */
export interface Revision {
  at: number
  /** What changed, in plain words: "cost now matters more", "added Option C". */
  what: string
  /** The message that caused it, trimmed. */
  from: string
}

// ---------------------------------------------------------------- results

export interface Scored {
  alternativeId: string
  /** 0 to 1. Only meaningful against the others in the same run. */
  score: number
  /** The lowest this could be if everything unknown turned out badly. */
  atWorst: number
  /** The highest this could be if everything unknown turned out well. */
  atBest: number
  /** How much of the weight was actually covered by what is known, 0 to 1. */
  coverage: number
  /** Per criterion: what it contributed, and why. */
  parts: readonly ScoredPart[]
  /** How each hard requirement went. */
  checks: readonly ConstraintCheck[]
  feasible: Meets
  /** Where it came, 1 upwards. Equal scores share a place. */
  place: number
  /** True when another option scores within `tieWithin` of this one. */
  tied: boolean
  /** How well this option is known compared with the others, 0 to 1. */
  evidence: number
}

export interface ScoredPart {
  criterionId: string
  /** The raw figure, before scaling. Null when not known. */
  raw: number | null
  /** After scaling, 0 to 1. Null when not known. */
  scaled: number | null
  /** The weight actually applied, after sharing out for anything missing. */
  weight: number
  /** weight times scaled. */
  contributed: number
  origin: Origin
}

export interface Result {
  decisionId: string
  /** Which run this is. Raised on every recalculation, so a late answer cannot replace a newer one. */
  run: number
  method: Method
  whenMissing: WhenMissing
  scored: readonly Scored[]
  /** The leader, or null when there is honestly no leader. */
  leaderId: string | null
  /** Why there is no leader, when there is not. */
  noLeader?: 'everything-ruled-out' | 'too-little-known' | 'too-close-to-call' | 'nothing-to-compare'
  /** Set when no option clears every hard requirement. */
  nothingIsFeasible: boolean
  /** Which options nothing else beats outright. */
  notBeaten: readonly string[]
  /** What the method did, in words, so it can be explained rather than asserted. */
  howItWorked: string
  /** Anything the engine itself wants said about the inputs. */
  notes: readonly string[]
  at: number
}

// ---------------------------------------------------------------- scenarios

/**
 * A what-if, held apart from the decision.
 *
 * It is a patch, not a copy: which weights, values and limits to change. So exploring "what if cost matters twice
 * as much" cannot overwrite what the person actually said, and going back to the real assumptions is just dropping
 * the patch.
 */
export interface Scenario {
  id: string
  /** What it is, in words: "cost twice as important", "three days instead of two weeks". */
  name: string
  weights?: Readonly<Record<string, number>>
  /** New raw values, keyed `alternativeId/criterionId`. */
  values?: Readonly<Record<string, Known>>
  /** New limits on hard requirements, keyed by constraint id. */
  limits?: Readonly<Record<string, number>>
  /** Criteria to leave out entirely. */
  without?: readonly string[]
  madeAt: number
}

// ---------------------------------------------------------------- refusals

/**
 * Why something could not be done, in the shape the rest of Orbis already uses.
 *
 * `failed` is for the log and never shown; `problem` and `fix` are what a person reads.
 */
export interface Refusal {
  problem: string
  fix: string
  failed: string
}

export const isRefusal = (held: unknown): held is Refusal =>
  typeof held === 'object' && held !== null && 'failed' in held

export const no = (problem: string, fix: string, failed: string): Refusal => ({ problem, fix, failed })
