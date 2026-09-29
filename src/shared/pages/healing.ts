/**
 * Fixing what is wrong with a generated Page, at the layer that is wrong.
 *
 * The first version of this argued with the model once: whatever the complaint, the answer was to ask for the whole
 * specification again. That is the wrong shape for almost every defect. A chart too narrow on a tablet is not a
 * misunderstanding of what was asked for -- the specification is right and the arrangement is wrong -- and asking a
 * model to write it all again is slow, is not reliably an improvement, and throws away the parts that were correct.
 *
 * ## Most repairs need no model at all
 *
 * A defect that arithmetic produced, arithmetic can fix. Too many columns for the room is fewer columns. A section
 * holding more than it can arrange is two sections. A Page recalculating six times per keystroke is a Page where some
 * of that waits for a button. None of those requires anybody to write anything: they are the layout and interaction
 * engines being asked again with a constraint they did not have.
 *
 * So repairs are ranked, and the ranking is the point: **deterministic before generative**. A model is asked only for
 * the defects that are genuinely about meaning -- a calculation that does not exist, an argument that is not real, a
 * property nothing returns. Those are the ones where the specification is wrong rather than its treatment.
 *
 * ## Why it stops
 *
 * A repair loop that can always try one more thing is a loop that never reports failure, and a Page nobody can wait
 * for is worse than a Page that did not build. Every strategy is counted, the model is asked at most twice in a
 * Page's whole life, and a Page that cannot be repaired leaves the previous version in place rather than replacing it
 * with something unverified.
 *
 * ## What it refuses to do
 *
 * It never repairs by removing the thing that failed. A chart that will not fit is not fixed by having no chart, and
 * a calculation that was refused is not fixed by not calculating. Those look like successes to every check
 * downstream, which is exactly what makes them the most dangerous repair available.
 */

import type { EngineId } from './pipeline.ts'
import { blameFor, type VisualCode, type VisualProblem } from './visual.ts'
import type { LayoutProblem } from './layout.ts'
import type { SpecProblem } from './spec.ts'

export const HEALING_LIMITS = Object.freeze({
  /** How many rounds of repair a Page gets. Past this it has been changed more than it was written. */
  rounds: 4,
  /**
   * How many times a model is asked, over the Page's whole life.
   *
   * Two: the first attempt and one argument. A third ask with no new information is the same coin flipped again, and
   * the complaint after a second failure is rarely more specific than the first.
   */
  asks: 2,
  /** How many times one layer may be asked to try again before it is treated as unable to. */
  perLayer: 2,
  /** How long the whole repair may take. */
  budgetMs: 90_000
})

/**
 * A problem, however it was found.
 *
 * Normalised so the classifier has one thing to read. Everything that can find a defect -- the specification checker,
 * the layout arithmetic, the gates, the trial run, the rendered Page -- produces one of these.
 */
export interface Defect {
  /** Where it came from. Not the same as who is answerable for it. */
  found: 'spec' | 'layout' | 'gate' | 'run' | 'visual'
  code: string
  message: string
  /** What it is about, as specifically as the finder could say. */
  at: string
  severity: 'error' | 'warning'
}

export type Strategy =
  /** Lay it out again with a constraint it did not have. No model. */
  | 'relayout'
  /** Choose different components for the same things. No model. */
  | 'recomponent'
  /** Move work off the typing path and onto a button. No model. */
  | 'defer'
  /** Split what is too full. No model. */
  | 'split'
  /** Work the answers out again. No model. */
  | 'rerun'
  /** Ask for the specification again, with exactly what was wrong. */
  | 'respecify'
  /** Nothing here can fix it. */
  | 'give-up'

export interface Repair {
  strategy: Strategy
  /** The engine that owns the fix. */
  engine: EngineId
  /** What the defect was. */
  defect: Defect
  /** What to tell whoever performs the repair, in words. For `respecify` this is what the model is sent. */
  because: string
  /** True when it can be done without asking anybody anything. */
  deterministic: boolean
}

/** How a strategy is performed, and who owns it. */
const OWNER: Readonly<Record<Strategy, { engine: EngineId; deterministic: boolean }>> = Object.freeze({
  relayout: { engine: 'layout', deterministic: true },
  recomponent: { engine: 'component', deterministic: true },
  defer: { engine: 'interaction', deterministic: true },
  split: { engine: 'layout', deterministic: true },
  rerun: { engine: 'runtime', deterministic: true },
  respecify: { engine: 'planner', deterministic: false },
  'give-up': { engine: 'validation', deterministic: false }
})

/**
 * Defects the specification is genuinely wrong about.
 *
 * These are the only ones worth a model. Each is a statement about meaning -- a calculation that does not exist, an
 * argument that is not one, a property nothing returns -- and no rearrangement fixes any of them.
 */
const MEANING: ReadonlySet<string> = new Set([
  'unknown-operation',
  'no-such-argument',
  'missing-argument',
  'not-an-option',
  'unknown-input',
  'unknown-step',
  'nothing-picked',
  'bad-pick',
  'nothing-computed',
  'nothing-shown',
  'step-goes-nowhere',
  'input-goes-nowhere',
  'nothing-to-build'
])

/** Defects arithmetic produced, which arithmetic can fix, and the strategy for each. */
const MECHANICAL: Readonly<Record<string, Strategy>> = Object.freeze({
  'columns-too-narrow': 'relayout',
  'too-narrow-to-draw': 'relayout',
  'wider-than-the-row': 'relayout',
  'off-screen': 'relayout',
  overlapping: 'relayout',
  clipped: 'relayout',
  buried: 'relayout',
  'nothing-leads': 'relayout',
  'everything-leads': 'relayout',
  'section-too-full': 'split',
  'too-small': 'recomponent',
  invisible: 'recomponent',
  unreadable: 'recomponent',
  'no-answer': 'rerun'
})

/**
 * What to do about one defect.
 *
 * Mechanical first, because a defect that can be fixed without asking anybody should be. A defect that is about
 * meaning goes to the model. Anything else is given up on by name rather than guessed at -- a repair chosen because
 * nothing better was found is a repair nobody can predict.
 */
export function classify(defect: Defect): Repair {
  const mechanical = Object.prototype.hasOwnProperty.call(MECHANICAL, defect.code) ? MECHANICAL[defect.code] : undefined
  if (mechanical !== undefined) {
    const owner = OWNER[mechanical]
    return {
      strategy: mechanical,
      engine: owner.engine,
      defect,
      deterministic: owner.deterministic,
      because: defect.message
    }
  }

  // A Page doing more per keystroke than somebody will wait for is fixed by some of it waiting for a button. That is
  // the interaction engine's, and it needs nobody's opinion.
  if (defect.code === 'gate' && /calculations, and the most that can happen while somebody types/.test(defect.message)) {
    return { strategy: 'defer', engine: 'interaction', defect, deterministic: true, because: defect.message }
  }

  // Anything the specification checker found is, by definition, about what the model wrote -- and the model is the
  // only thing that can write it differently. Enumerating the codes instead was a real gap: one unlisted structural
  // complaint ("each input has to be an object") made a whole Page unrepairable, because a defect nothing could fix
  // takes the round with it.
  //
  // `MEANING` is still read, for the same complaints arriving from somewhere other than the checker.
  if (defect.found === 'spec' || MEANING.has(defect.code)) {
    return {
      strategy: 'respecify',
      engine: 'planner',
      defect,
      deterministic: false,
      because: defect.at === '' ? defect.message : `${defect.at}: ${defect.message}`
    }
  }

  // Anything found by running it that is not one of the above is a refusal from an engine, and the engine's own
  // sentence is the most specific thing anybody has. That is worth a model.
  if (defect.found === 'run') {
    return { strategy: 'respecify', engine: 'planner', defect, deterministic: false, because: defect.message }
  }

  return { strategy: 'give-up', engine: 'validation', defect, deterministic: false, because: defect.message }
}

/** Defects from each finder, turned into the one shape the classifier reads. */
export const fromSpec = (problems: readonly SpecProblem[]): Defect[] =>
  problems.map((one) => ({ found: 'spec' as const, code: one.code, message: one.message, at: one.at, severity: one.severity }))

export const fromLayout = (problems: readonly LayoutProblem[]): Defect[] =>
  problems.map((one) => ({ found: 'layout' as const, code: one.code, message: one.message, at: one.at, severity: one.severity }))

export const fromVisual = (problems: readonly VisualProblem[]): Defect[] =>
  problems.map((one) => ({ found: 'visual' as const, code: one.code, message: one.message, at: one.at, severity: one.severity }))

export const fromGates = (problems: readonly string[]): Defect[] =>
  problems.map((one) => ({ found: 'gate' as const, code: 'gate', message: one, at: '', severity: 'error' as const }))

export const fromRun = (problems: readonly { name: string; message: string }[]): Defect[] =>
  problems.map((one) => ({ found: 'run' as const, code: 'refused', message: one.message, at: one.name, severity: 'error' as const }))

export interface Attempted {
  /** How many rounds have been run. */
  rounds: number
  /** How many times a model has been asked, over the Page's whole life. */
  asks: number
  /** How many times each layer has been asked to try again. */
  byEngine: Readonly<Record<string, number>>
  /** How long repairing has taken. */
  spentMs: number
}

export const NOTHING_ATTEMPTED: Attempted = Object.freeze({ rounds: 0, asks: 0, byEngine: Object.freeze({}), spentMs: 0 })

export interface HealingPlan {
  /**
   * What to do, in order.
   *
   * Deterministic repairs first, and never more than one `respecify` -- the model is given every meaning defect at
   * once rather than one per round, because a second round would ask about a specification the first round replaced.
   */
  repairs: readonly Repair[]
  /** True when there is nothing left to try. */
  exhausted: boolean
  /** Why, when there is nothing left. */
  because: string
}

/**
 * What to try next, given what is wrong and what has already been tried.
 *
 * Warnings are not repaired. A warning is something worth knowing that is not worth changing the Page over, and
 * spending a repair round on one means a real defect gets one fewer.
 */
export function planHealing(defects: readonly Defect[], attempted: Attempted = NOTHING_ATTEMPTED): HealingPlan {
  const real = defects.filter((one) => one.severity === 'error')
  if (real.length === 0) {
    return { repairs: [], exhausted: true, because: 'There is nothing wrong with it.' }
  }
  if (attempted.rounds >= HEALING_LIMITS.rounds) {
    return {
      repairs: [],
      exhausted: true,
      because: `It has been through ${attempted.rounds} rounds of repair, which is more than it was written in.`
    }
  }
  if (attempted.spentMs >= HEALING_LIMITS.budgetMs) {
    return { repairs: [], exhausted: true, because: 'Repairing it has taken longer than anybody would wait.' }
  }

  const classified = real.map(classify)
  const usable = classified.filter((repair) => {
    if (repair.strategy === 'give-up') return false
    const tried = attempted.byEngine[repair.engine] ?? 0
    return tried < HEALING_LIMITS.perLayer
  })

  const deterministic = usable.filter((one) => one.deterministic)
  const generative = usable.filter((one) => !one.deterministic)

  // Every meaning defect goes in one ask. Asking again in a later round would be asking about a specification the
  // first ask already replaced, and the answer would be about a Page that no longer exists.
  const asks = attempted.asks < HEALING_LIMITS.asks && generative.length > 0 ? [mergeAsks(generative)] : []

  const repairs = [...deterministic, ...asks]
  if (repairs.length === 0) {
    const why =
      generative.length > 0
        ? `The model has already been asked ${attempted.asks} times, and asking again with nothing new is the same question.`
        : classified.length > 0
          ? `Nothing here can fix: ${classified[0].defect.message}`
          : 'There is nothing left to try.'
    return { repairs: [], exhausted: true, because: why }
  }
  return { repairs: Object.freeze(repairs), exhausted: false, because: '' }
}

/** Every meaning defect as one complaint, so the model is asked once and told everything. */
function mergeAsks(generative: readonly Repair[]): Repair {
  const lines = [...new Set(generative.map((one) => one.because))]
  return {
    strategy: 'respecify',
    engine: 'planner',
    defect: generative[0].defect,
    deterministic: false,
    because: lines.join('\n')
  }
}

/** What a round of repair did, folded into what had already been tried. */
export function afterRound(attempted: Attempted, performed: readonly Repair[], tookMs: number): Attempted {
  const byEngine: Record<string, number> = { ...attempted.byEngine }
  for (const repair of performed) byEngine[repair.engine] = (byEngine[repair.engine] ?? 0) + 1
  return {
    rounds: attempted.rounds + 1,
    asks: attempted.asks + performed.filter((one) => one.strategy === 'respecify').length,
    byEngine: Object.freeze(byEngine),
    spentMs: attempted.spentMs + tookMs
  }
}

/**
 * The constraint a deterministic repair passes back to its engine.
 *
 * This is what makes `relayout` mean something rather than being a word: the layout engine is asked again with a
 * limit it did not have, so the second answer differs from the first for a reason. An engine asked again with nothing
 * new returns what it returned before, which is a repair loop that cannot converge.
 */
export interface Constraint {
  engine: EngineId
  /** What to change. */
  kind: 'fewer-columns' | 'full-row' | 'split-section' | 'larger-target' | 'defer-computation' | 'reorder' | 'recompute'
  /** What it applies to, where it applies to one thing. */
  at: string
}

export function constraintFor(repair: Repair): Constraint | null {
  switch (repair.strategy) {
    case 'relayout':
      if (repair.defect.code === 'columns-too-narrow') return { engine: 'layout', kind: 'fewer-columns', at: repair.defect.at }
      if (repair.defect.code === 'too-narrow-to-draw' || repair.defect.code === 'wider-than-the-row') {
        return { engine: 'layout', kind: 'full-row', at: repair.defect.at }
      }
      if (repair.defect.code === 'buried' || repair.defect.code === 'nothing-leads' || repair.defect.code === 'everything-leads') {
        return { engine: 'layout', kind: 'reorder', at: repair.defect.at }
      }
      return { engine: 'layout', kind: 'fewer-columns', at: repair.defect.at }
    case 'split':
      return { engine: 'layout', kind: 'split-section', at: repair.defect.at }
    case 'recomponent':
      return { engine: 'component', kind: 'larger-target', at: repair.defect.at }
    case 'defer':
      return { engine: 'interaction', kind: 'defer-computation', at: repair.defect.at }
    case 'rerun':
      return { engine: 'runtime', kind: 'recompute', at: repair.defect.at }
    default:
      return null
  }
}

/** Which engine a visual defect belongs to, from the visual module's own attribution. */
export const engineForVisual = (code: VisualCode): EngineId => {
  const blamed = blameFor(code)
  return blamed === 'runtime' ? 'runtime' : blamed === 'layout' ? 'layout' : blamed === 'component' ? 'component' : 'compiler'
}

export const HEALING_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A defect that arithmetic produced, arithmetic can fix. Deterministic repairs run before a model is asked anything.',
  'A model is asked only about meaning: a calculation that does not exist, an argument that is not one, a property nothing returns. No rearrangement fixes those.',
  'The model is asked at most twice over a Page’s whole life, and every meaning defect goes in one ask. A second ask would be about a specification the first one replaced.',
  'A deterministic repair passes a constraint its engine did not have. An engine asked again with nothing new returns what it returned before, which is a loop that cannot converge.',
  'Nothing is repaired by removing what failed. A chart that will not fit is not fixed by having no chart, and that repair looks like a success to every check downstream.',
  'Warnings are not repaired. Spending a round on one means a real defect gets one fewer.',
  'A Page that cannot be repaired leaves the previous version in place rather than replacing it with something unverified.'
])
