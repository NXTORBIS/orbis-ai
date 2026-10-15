/**
 * Sensitivity analysis for decisions.
 *
 * The question a decision maker actually has is not "how much does the answer
 * move?" but "would I do something different?". So the headline output here is
 * the **switching point**: the value of the input at which the optimal
 * decision changes. A tornado bar says an input matters; a switching point
 * says whether the input matters *enough to change the decision*, and how far
 * away that threshold is from today's estimate.
 *
 * One-way analysis varies one input across a range; two-way analysis varies
 * two and maps which decision is best in each region of the plane. Both are
 * driven by a caller-supplied evaluator, so the same code works on a decision
 * tree, a payoff matrix or anything else that can be re-valued.
 *
 * For the common case of a two-state problem the switching *probability* is
 * available in closed form and is reported as exact; switching points found by
 * root finding on a general evaluator are reported as numerical, with the
 * residual difference in value at the reported point included so the accuracy
 * is visible rather than claimed.
 */
import { EngineError, Validator } from '../core/result';
import { brentRoot, linspace } from '../core/numeric';
import type { DecisionProblem, Provenance } from './types';
import { validateProblem } from './information';

/** Value of each alternative at one setting of the inputs. */
export interface DecisionEvaluation {
  /** Value (higher is better) of each alternative, in a fixed order. */
  values: number[];
}

export interface OneWayInput {
  parameterLabel: string;
  /** Names of the alternatives, in the order the evaluator returns them. */
  alternatives: string[];
  /** Inclusive range to sweep. */
  range: [number, number];
  /** Current estimate of the parameter. */
  baseline: number;
  evaluate(x: number): DecisionEvaluation;
  steps?: number;
}

export interface SwitchingPoint {
  parameterValue: number;
  /** Alternative that is best just below the switching point. */
  below: string;
  /** Alternative that is best just above it. */
  above: string;
  /** Common value of the two alternatives at the switching point. */
  valueAtSwitch: number;
  /** |value(below) − value(above)| at the reported point; a residual, not a claim. */
  residual: number;
  exactness: 'exact' | 'numerical';
}

export interface OneWayResult {
  parameterLabel: string;
  baseline: number;
  baselineBest: string;
  points: { parameterValue: number; values: number[]; bestAlternative: string }[];
  switchingPoints: SwitchingPoint[];
  /** True when no value in the range changes the decision. */
  decisionIsStable: boolean;
  /** Distance from the baseline to the nearest switching point, or null. */
  distanceToNearestSwitch: number | null;
  provenance: Provenance;
  notes: string[];
}

function bestIndex(values: number[]): number {
  let b = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[b]) b = i;
  return b;
}

/**
 * One-way sensitivity analysis with switching points.
 *
 * The sweep locates every interval in which the best alternative changes, then
 * solves for the crossing of the two alternatives involved by a bracketed root
 * find on their difference. A sweep can only find a switching point it
 * straddles, so the grid resolution is reported: a decision that flips and
 * flips back inside one grid cell will be missed, and the note says so.
 */
export function oneWaySensitivity(input: OneWayInput): OneWayResult {
  const v = new Validator();
  const steps = input.steps ?? 101;
  v.integer(steps, 'steps', 'Number of sweep steps', 3);
  v.finite(input.range[0], 'range[0]', 'Range lower bound');
  v.finite(input.range[1], 'range[1]', 'Range upper bound');
  v.finite(input.baseline, 'baseline', 'Baseline value');
  if (!input.alternatives.length) v.add('At least one alternative is needed.', 'alternatives', 'required');
  v.throwIfInvalid();
  if (!(input.range[0] < input.range[1])) {
    throw new EngineError(
      `The sweep range must be increasing; got [${input.range[0]}, ${input.range[1]}].`,
      'range',
    );
  }
  const n = input.alternatives.length;
  const grid = linspace(input.range[0], input.range[1], steps);
  const evaluateAt = (x: number): number[] => {
    const out = input.evaluate(x).values;
    if (out.length !== n) {
      throw new EngineError(
        `The evaluator returned ${out.length} values but ${n} alternatives were declared.`,
        'shape',
      );
    }
    out.forEach((y, i) => {
      if (!Number.isFinite(y)) {
        throw new EngineError(
          `The evaluator returned a non-finite value for "${input.alternatives[i]}" at ${input.parameterLabel} = ${x}.`,
          'finite',
        );
      }
    });
    return out;
  };

  const points = grid.map((x) => {
    const values = evaluateAt(x);
    return { parameterValue: x, values, bestAlternative: input.alternatives[bestIndex(values)] };
  });

  const switchingPoints: SwitchingPoint[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = bestIndex(points[i].values);
    const b = bestIndex(points[i + 1].values);
    if (a === b) continue;
    const diff = (x: number) => {
      const values = evaluateAt(x);
      return values[a] - values[b];
    };
    const lo = points[i].parameterValue;
    const hi = points[i + 1].parameterValue;
    const flo = diff(lo);
    const fhi = diff(hi);
    if (flo === 0 || fhi === 0 || flo * fhi < 0) {
      const root = flo === 0 ? lo : fhi === 0 ? hi : brentRoot(diff, lo, hi, { tol: 1e-15 });
      const values = evaluateAt(root);
      switchingPoints.push({
        parameterValue: root,
        below: input.alternatives[a],
        above: input.alternatives[b],
        valueAtSwitch: (values[a] + values[b]) / 2,
        residual: Math.abs(values[a] - values[b]),
        exactness: 'numerical',
      });
    } else {
      throw new EngineError(
        `The best alternative changes between ${input.parameterLabel} = ${lo} and ${hi}, but the values of ` +
          `"${input.alternatives[a]}" and "${input.alternatives[b]}" do not cross there. The switching point cannot ` +
          'be located, so none is reported.',
        'numerical',
      );
    }
  }

  const baselineValues = evaluateAt(input.baseline);
  const baselineBest = input.alternatives[bestIndex(baselineValues)];
  const distances = switchingPoints.map((s) => Math.abs(s.parameterValue - input.baseline));
  return {
    parameterLabel: input.parameterLabel,
    baseline: input.baseline,
    baselineBest,
    points,
    switchingPoints,
    decisionIsStable: switchingPoints.length === 0,
    distanceToNearestSwitch: distances.length ? Math.min(...distances) : null,
    provenance: {
      exactness: 'numerical',
      assumedInputs: [`The range swept for ${input.parameterLabel} is a user judgement about how wrong the estimate could be.`],
      regime: 'probabilities-given',
    },
    notes: [
      switchingPoints.length
        ? `The decision changes within the range swept. At each switching point the two alternatives are worth the same; the residual difference in value at the reported point is included.`
        : `No value of ${input.parameterLabel} in [${input.range[0]}, ${input.range[1]}] changes the decision: the recommendation "${baselineBest}" is robust to this input over that whole range.`,
      `The sweep used ${steps} points, so a flip and a flip back inside one grid cell of width ${(input.range[1] - input.range[0]) / (steps - 1)} would not be detected.`,
      'A one-way sweep moves one input at a time and therefore cannot show interactions; use the two-way analysis for a pair.',
    ],
  };
}

export interface ExactSwitchingProbability {
  /** The probability of the first state at which the two actions are equal. */
  probability: number;
  /** Whether that probability lies inside [0, 1] and so is attainable. */
  attainable: boolean;
  actionA: string;
  actionB: string;
  valueAtSwitch: number;
  /** Which action is better below the switching probability. */
  betterBelow: string;
  betterAbove: string;
  provenance: Provenance;
  notes: string[];
}

/**
 * Closed-form switching probability for a two-state problem.
 *
 * With states {s₁, s₂} and p = P(s₁), each action's expected value is linear in
 * p: EV_a(p) = p·V(a,s₁) + (1 − p)·V(a,s₂). Two actions are equal where
 *
 *     p* = (V(b,s₂) − V(a,s₂)) / ((V(a,s₁) − V(a,s₂)) − (V(b,s₁) − V(b,s₂)))
 *
 * which is exact, not a root find. Parallel lines (the denominator is zero)
 * mean the two actions never swap and are refused rather than reported as a
 * switching point at infinity.
 */
export function switchingProbabilityTwoStates(
  problem: DecisionProblem,
  actionIndexA: number,
  actionIndexB: number,
): ExactSwitchingProbability {
  const p = validateProblem(problem, false);
  if (p.states.length !== 2) {
    throw new EngineError(
      `The closed-form switching probability applies to a two-state problem; this one has ${p.states.length} states. ` +
        'Use the one-way sensitivity sweep instead.',
      'shape',
    );
  }
  const v = new Validator();
  v.integer(actionIndexA, 'actionIndexA', 'First action index', 0, p.actions.length - 1);
  v.integer(actionIndexB, 'actionIndexB', 'Second action index', 0, p.actions.length - 1);
  v.throwIfInvalid();
  if (actionIndexA === actionIndexB) {
    throw new EngineError('A switching probability needs two different actions.', 'invalid');
  }
  const [a1, a2] = [p.payoffs[actionIndexA][0], p.payoffs[actionIndexA][1]];
  const [b1, b2] = [p.payoffs[actionIndexB][0], p.payoffs[actionIndexB][1]];
  const slopeA = a1 - a2;
  const slopeB = b1 - b2;
  const denominator = slopeA - slopeB;
  if (denominator === 0) {
    throw new EngineError(
      `"${p.actions[actionIndexA]}" and "${p.actions[actionIndexB]}" have the same sensitivity to the probability, ` +
        'so their expected values never cross and there is no switching probability.',
      'degenerate',
    );
  }
  const star = (b2 - a2) / denominator;
  const valueAtSwitch = star * a1 + (1 - star) * a2;
  const probeLow = Math.max(0, Math.min(1, star)) / 2;
  const probeHigh = (1 + Math.max(0, Math.min(1, star))) / 2;
  const valueAt = (i: number, q: number) => q * p.payoffs[i][0] + (1 - q) * p.payoffs[i][1];
  const betterBelow =
    valueAt(actionIndexA, probeLow) >= valueAt(actionIndexB, probeLow) ? actionIndexA : actionIndexB;
  const betterAbove =
    valueAt(actionIndexA, probeHigh) >= valueAt(actionIndexB, probeHigh) ? actionIndexA : actionIndexB;
  return {
    probability: star,
    attainable: star >= 0 && star <= 1,
    actionA: p.actions[actionIndexA],
    actionB: p.actions[actionIndexB],
    valueAtSwitch,
    betterBelow: p.actions[betterBelow],
    betterAbove: p.actions[betterAbove],
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The payoffs are user estimates; the switching probability is exact given them.'],
      regime: 'probabilities-given',
    },
    notes: [
      'Both expected values are exactly linear in the probability, so the crossing is solved algebraically.',
      star >= 0 && star <= 1
        ? `The two actions are equally good at P(${p.states[0]}) = ${star}. Below that one is better, above it the other; how confident you are that the true probability is on one side is the whole decision.`
        : `The crossing is at ${star}, outside [0, 1], so within the possible probabilities one action is always better than the other.`,
    ],
  };
}

export interface TwoWayResult {
  parameterLabels: [string, string];
  xValues: number[];
  yValues: number[];
  /** grid[yIndex][xIndex] = index of the best alternative there. */
  grid: number[][];
  alternatives: string[];
  /** Alternatives that are optimal somewhere in the rectangle. */
  activeAlternatives: string[];
  /** Grid cells where the optimal alternative differs from a neighbour: the boundary. */
  boundaryCells: { x: number; y: number; from: string; to: string }[];
  provenance: Provenance;
  notes: string[];
}

/** Two-way sensitivity analysis: which alternative is best over a rectangle. */
export function twoWaySensitivity(input: {
  parameterLabels: [string, string];
  alternatives: string[];
  xRange: [number, number];
  yRange: [number, number];
  steps?: number;
  evaluate(x: number, y: number): DecisionEvaluation;
}): TwoWayResult {
  const steps = input.steps ?? 41;
  const v = new Validator();
  v.integer(steps, 'steps', 'Grid resolution', 3, 501);
  v.throwIfInvalid();
  if (!(input.xRange[0] < input.xRange[1]) || !(input.yRange[0] < input.yRange[1])) {
    throw new EngineError('Both sweep ranges must be increasing.', 'range');
  }
  const xValues = linspace(input.xRange[0], input.xRange[1], steps);
  const yValues = linspace(input.yRange[0], input.yRange[1], steps);
  const grid: number[][] = [];
  const active = new Set<number>();
  for (const y of yValues) {
    const row: number[] = [];
    for (const x of xValues) {
      const values = input.evaluate(x, y).values;
      if (values.length !== input.alternatives.length) {
        throw new EngineError('The evaluator returned the wrong number of alternative values.', 'shape');
      }
      values.forEach((val) => {
        if (!Number.isFinite(val)) {
          throw new EngineError(
            `The evaluator returned a non-finite value at (${x}, ${y}); no region map is produced.`,
            'finite',
          );
        }
      });
      const b = bestIndex(values);
      active.add(b);
      row.push(b);
    }
    grid.push(row);
  }
  const boundaryCells: { x: number; y: number; from: string; to: string }[] = [];
  for (let iy = 0; iy < yValues.length; iy++) {
    for (let ix = 0; ix < xValues.length; ix++) {
      const here = grid[iy][ix];
      const right = ix + 1 < xValues.length ? grid[iy][ix + 1] : here;
      const up = iy + 1 < yValues.length ? grid[iy + 1][ix] : here;
      if (right !== here) {
        boundaryCells.push({ x: xValues[ix], y: yValues[iy], from: input.alternatives[here], to: input.alternatives[right] });
      } else if (up !== here) {
        boundaryCells.push({ x: xValues[ix], y: yValues[iy], from: input.alternatives[here], to: input.alternatives[up] });
      }
    }
  }
  return {
    parameterLabels: input.parameterLabels,
    xValues,
    yValues,
    grid,
    alternatives: input.alternatives,
    activeAlternatives: [...active].sort((a, b) => a - b).map((i) => input.alternatives[i]),
    boundaryCells,
    provenance: {
      exactness: 'numerical',
      assumedInputs: ['The two ranges swept are user judgements about how wrong the estimates could be.'],
      regime: 'probabilities-given',
    },
    notes: [
      `The region map is evaluated on a ${steps} × ${steps} grid, so the boundary is located to within one cell; it is not an exact curve.`,
      active.size === 1
        ? `One alternative ("${input.alternatives[[...active][0]]}") is best over the whole rectangle: the decision is robust to both inputs together, which a pair of one-way sweeps cannot establish.`
        : `${active.size} alternatives are optimal somewhere in the rectangle, so the two inputs interact and one-way analysis is not sufficient here.`,
    ],
  };
}

export interface TornadoBar {
  parameter: string;
  low: number;
  high: number;
  valueAtLow: number;
  valueAtHigh: number;
  baselineValue: number;
  /** |valueAtHigh − valueAtLow|: the width of the bar. */
  swing: number;
  bestAtLow: string;
  bestAtHigh: string;
  /** True when the optimal decision is not the same at both ends. */
  changesDecision: boolean;
}

export interface TornadoResult {
  baselineValue: number;
  baselineBest: string;
  bars: TornadoBar[];
  /** Parameters whose range is enough to change the decision. */
  decisionCritical: string[];
  provenance: Provenance;
  notes: string[];
}

/**
 * Tornado data for the expected value of a decision: the swing in value as
 * each input moves alone from its low to its high estimate, sorted widest
 * first, with the far more important flag of whether that swing is enough to
 * change the recommendation.
 */
export function tornado(input: {
  parameters: { name: string; baseline: number; low: number; high: number }[];
  evaluate(values: Record<string, number>): { value: number; choice: string };
}): TornadoResult {
  const v = new Validator();
  if (!input.parameters.length) v.add('At least one parameter is needed for a tornado.', 'parameters', 'required');
  input.parameters.forEach((p, i) => {
    v.finite(p.baseline, `parameters[${i}].baseline`, `Baseline of "${p.name}"`);
    v.finite(p.low, `parameters[${i}].low`, `Low value of "${p.name}"`);
    v.finite(p.high, `parameters[${i}].high`, `High value of "${p.name}"`);
    if (p.low > p.high) v.add(`The low value of "${p.name}" is above its high value.`, `parameters[${i}]`, 'range');
  });
  v.throwIfInvalid();
  const baselineValues: Record<string, number> = {};
  for (const p of input.parameters) baselineValues[p.name] = p.baseline;
  const baseline = input.evaluate({ ...baselineValues });
  if (!Number.isFinite(baseline.value)) {
    throw new EngineError('The evaluator returned a non-finite baseline value; no tornado is produced.', 'finite');
  }
  const bars: TornadoBar[] = input.parameters.map((p) => {
    const atLow = input.evaluate({ ...baselineValues, [p.name]: p.low });
    const atHigh = input.evaluate({ ...baselineValues, [p.name]: p.high });
    if (!Number.isFinite(atLow.value) || !Number.isFinite(atHigh.value)) {
      throw new EngineError(
        `The evaluator returned a non-finite value at an endpoint of "${p.name}"; no tornado is produced.`,
        'finite',
      );
    }
    return {
      parameter: p.name,
      low: p.low,
      high: p.high,
      valueAtLow: atLow.value,
      valueAtHigh: atHigh.value,
      baselineValue: baseline.value,
      swing: Math.abs(atHigh.value - atLow.value),
      bestAtLow: atLow.choice,
      bestAtHigh: atHigh.choice,
      changesDecision: atLow.choice !== atHigh.choice,
    };
  });
  bars.sort((a, b) => b.swing - a.swing);
  return {
    baselineValue: baseline.value,
    baselineBest: baseline.choice,
    bars,
    decisionCritical: bars.filter((b) => b.changesDecision).map((b) => b.parameter),
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The low and high values of each parameter are user judgements about plausible error, not confidence limits.'],
      regime: 'probabilities-given',
    },
    notes: [
      'Bar width depends entirely on how wide a range was chosen for each input, so the ordering is a statement about the ranges as much as about the model.',
      'Only one input moves at a time, so a tornado cannot show interactions.',
      'The flag that matters is whether the swing changes the decision; a wide bar that never changes the recommendation does not need resolving.',
    ],
  };
}

/** Build a one-way sweep over the probability of the first state of a two-state problem. */
export function probabilitySweep(problem: DecisionProblem, options: { steps?: number; baseline?: number } = {}): OneWayResult {
  const p = validateProblem(problem, false);
  if (p.states.length !== 2) {
    throw new EngineError(
      `A probability sweep over a single probability needs a two-state problem; this one has ${p.states.length} states.`,
      'shape',
    );
  }
  const baseline = options.baseline ?? (problem.priors ? problem.priors[0] : 0.5);
  return oneWaySensitivity({
    parameterLabel: `P(${p.states[0]})`,
    alternatives: p.actions,
    range: [0, 1],
    baseline,
    steps: options.steps ?? 101,
    evaluate: (q) => ({ values: p.payoffs.map((row) => q * row[0] + (1 - q) * row[1]) }),
  });
}
