/**
 * Tests for the decision analysis module.
 *
 * Every reference value here is independent of the implementation: either hand
 * computed in a comment above the assertion, taken from the closed form of the
 * quantity, or derived from an analytic identity (EVPI's two-sided definition,
 * the EVSI limits at a perfect and at a useless test, the Kelly fraction of an
 * even-money bet, the newsvendor critical fractile).
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { getDistribution } from '../distributions/registry';
import {
  bestAction,
  certaintyEquivalent,
  decideWithoutProbabilities,
  elicitExponentialRiskTolerance,
  expectedValueOfIncludingUncertainty,
  expectedValueOfPerfectInformation,
  expectedValueOfSampleInformation,
  kellyFraction,
  kellyGrowthRate,
  lotteryRiskProfile,
  newsvendorOrderQuantity,
  paretoFrontier,
  probabilitySweep,
  realOptionValue,
  regretMatrix,
  rollback,
  stochasticDominance,
  switchingProbabilityTwoStates,
  testFromSensitivitySpecificity,
  tornado,
  utilityFunction,
  validateProblem,
  validateTree,
  weightSensitivity,
  weightedAdditiveValue,
  WORKED_EXAMPLES,
  type DecisionProblem,
  type DecisionTree,
  type MultiCriteriaInput,
  type TreeNode,
} from './index';

/* ------------------------------------------------------------------ fixtures */

/**
 * Hand-computed tree: one decision node with two alternatives, each leading to
 * a chance node with two branches.
 *
 *   A → 0.6 × 100 + 0.4 × (−50) =  60 − 20 = 40
 *   B → 0.3 × 200 + 0.7 ×    0  =  60 −  0 = 60
 *   root = max(40, 60) = 60, choose B.
 */
const HAND_TREE: DecisionTree = {
  id: 'hand',
  name: 'Hand-computed 2 × 2 tree',
  root: {
    kind: 'decision',
    id: 'root',
    label: 'Choose',
    alternatives: [
      {
        label: 'A',
        child: {
          kind: 'chance',
          id: 'cA',
          branches: [
            { label: 'up', probability: 0.6, child: { kind: 'terminal', id: 'a1', payoff: 100 } },
            { label: 'down', probability: 0.4, child: { kind: 'terminal', id: 'a2', payoff: -50 } },
          ],
        },
      },
      {
        label: 'B',
        child: {
          kind: 'chance',
          id: 'cB',
          branches: [
            { label: 'up', probability: 0.3, child: { kind: 'terminal', id: 'b1', payoff: 200 } },
            { label: 'down', probability: 0.7, child: { kind: 'terminal', id: 'b2', payoff: 0 } },
          ],
        },
      },
    ],
  },
};

/** Drill or walk away: wet pays 200, dry costs 70, P(wet) = 0.4. */
const DRILL: DecisionProblem = {
  actions: ['Drill', 'Walk away'],
  states: ['Wet', 'Dry'],
  payoffs: [
    [200, -70],
    [0, 0],
  ],
  priors: [0.4, 0.6],
};

/** The same shape with exactly representable priors, for the exact EVSI limits. */
const DRILL_BINARY_PRIORS: DecisionProblem = {
  actions: ['Drill', 'Walk away'],
  states: ['Wet', 'Dry'],
  payoffs: [
    [200, -70],
    [0, 0],
  ],
  priors: [0.25, 0.75],
};

/* -------------------------------------------------------------------- trees */

describe('decision tree rollback', () => {
  it('reproduces a hand-computed 2 × 2 tree exactly and picks the right branch', () => {
    const result = rollback(HAND_TREE);
    // Hand computation above: A = 40, B = 60, root = 60.
    expect(result.expectedValue).toBeCloseTo(60, 12);
    expect(result.certaintyEquivalent).toBeCloseTo(60, 12);
    expect(result.nodes.cA.expectedValue).toBeCloseTo(40, 12);
    expect(result.nodes.cB.expectedValue).toBeCloseTo(60, 12);
    expect(result.policy).toHaveLength(1);
    expect(result.policy[0].alternativeLabel).toBe('B');
    expect(result.nodes.root.chosenAlternative?.label).toBe('B');
    expect(result.provenance.exactness).toBe('exact');
    expect(result.provenance.regime).toBe('probabilities-given');
  });

  it('values every node and reports reach probabilities under the optimal policy', () => {
    const result = rollback(HAND_TREE);
    expect(Object.keys(result.nodes).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'cA', 'cB', 'root']);
    // The unchosen subtree is off-policy and therefore unreachable.
    expect(result.nodes.cA.reachProbability).toBe(0);
    expect(result.nodes.cB.reachProbability).toBe(1);
    expect(result.nodes.b1.reachProbability).toBeCloseTo(0.3, 15);
    // Risk profile of the chosen strategy: 200 with 0.3, 0 with 0.7.
    expect(result.riskProfile.outcomes).toHaveLength(2);
    expect(result.riskProfile.outcomes[0]).toEqual({ payoff: 0, probability: 0.7 });
    expect(result.riskProfile.outcomes[1]).toEqual({ payoff: 200, probability: 0.3 });
    expect(result.riskProfile.expectedValue).toBeCloseTo(60, 12);
  });

  it('accumulates payoffs along the path, including on alternatives and branches', () => {
    // Choose: pay 10 to enter a certain 100 → net 90; or take 80 for free.
    const tree: DecisionTree = {
      id: 't',
      name: 'path payoffs',
      root: {
        kind: 'decision',
        id: 'r',
        alternatives: [
          { label: 'pay and win', payoff: -10, child: { kind: 'terminal', id: 'x', payoff: 100 } },
          { label: 'take 80', child: { kind: 'terminal', id: 'y', payoff: 80 } },
        ],
      },
    };
    const result = rollback(tree);
    expect(result.expectedValue).toBe(90);
    expect(result.policy[0].alternativeLabel).toBe('pay and win');
  });

  it('evaluates a 5000-level deep tree without overflowing the stack', () => {
    // Each level: stop for 0, or go on; the final leaf pays 1.
    let node: TreeNode = { kind: 'terminal', id: 'leaf', payoff: 1 };
    for (let i = 0; i < 5000; i++) {
      node = {
        kind: 'decision',
        id: `d${i}`,
        alternatives: [
          { label: 'stop', child: { kind: 'terminal', id: `s${i}`, payoff: 0 } },
          { label: 'go', child: node },
        ],
      };
    }
    const result = rollback({ id: 'deep', name: 'deep', root: node });
    expect(result.expectedValue).toBe(1);
    expect(result.policy).toHaveLength(5000);
    expect(result.policy.every((p) => p.alternativeLabel === 'go')).toBe(true);
  });

  it('refuses a chance node whose branch probabilities do not sum to 1, naming the node', () => {
    const tree: DecisionTree = {
      id: 'bad',
      name: 'bad sums',
      root: {
        kind: 'chance',
        id: 'weather',
        label: 'Weather',
        branches: [
          { label: 'sun', probability: 0.5, child: { kind: 'terminal', id: 'a', payoff: 1 } },
          { label: 'rain', probability: 0.3, child: { kind: 'terminal', id: 'b', payoff: 0 } },
        ],
      },
    };
    expect(() => rollback(tree)).toThrow(EngineError);
    try {
      rollback(tree);
      throw new Error('should have thrown');
    } catch (e) {
      const message = (e as EngineError).message;
      expect(message).toContain('Weather');
      expect(message).toContain('weather');
      expect(message).toContain('0.8');
      expect((e as EngineError).issues[0].code).toBe('sum');
    }
  });

  it('refuses a probability outside [0, 1]', () => {
    const tree: DecisionTree = {
      id: 'bad2',
      name: 'bad range',
      root: {
        kind: 'chance',
        id: 'c',
        branches: [
          { label: 'a', probability: 1.4, child: { kind: 'terminal', id: 'a', payoff: 1 } },
          { label: 'b', probability: -0.4, child: { kind: 'terminal', id: 'b', payoff: 0 } },
        ],
      },
    };
    expect(() => validateTree(tree)).toThrow(EngineError);
  });

  it('refuses a cyclic tree', () => {
    const chance: TreeNode = {
      kind: 'chance',
      id: 'loop',
      label: 'Loop',
      branches: [
        { label: 'out', probability: 0.5, child: { kind: 'terminal', id: 'end', payoff: 1 } },
        { label: 'back', probability: 0.5, child: { kind: 'terminal', id: 'placeholder', payoff: 0 } },
      ],
    };
    // Close the loop: the "back" branch points at the chance node itself.
    if (chance.kind === 'chance') chance.branches[1].child = chance;
    expect(() => validateTree({ id: 'cyc', name: 'cyclic', root: chance })).toThrow(/acyclic|more than once/i);
  });

  it('refuses a node with no children, so that no path fails to terminate', () => {
    expect(() =>
      validateTree({ id: 'e', name: 'empty', root: { kind: 'decision', id: 'd', alternatives: [] } }),
    ).toThrow(/no alternatives/);
    expect(() =>
      validateTree({ id: 'e2', name: 'empty2', root: { kind: 'chance', id: 'c', branches: [] } }),
    ).toThrow(/no branches/);
  });

  it('refuses duplicate node ids', () => {
    const tree: DecisionTree = {
      id: 'dup',
      name: 'dup',
      root: {
        kind: 'chance',
        id: 'c',
        branches: [
          { label: 'a', probability: 0.5, child: { kind: 'terminal', id: 'same', payoff: 1 } },
          { label: 'b', probability: 0.5, child: { kind: 'terminal', id: 'same', payoff: 0 } },
        ],
      },
    };
    expect(() => validateTree(tree)).toThrow(/Duplicate node id/);
  });
});

/* ------------------------------------------------------- stochastic dominance */

describe('stochastic dominance', () => {
  it('classifies a known first-order dominant pair, which must also have a higher EV', () => {
    // A = {10, 20} each ½ (EV 15); B = {5, 15} each ½ (EV 10).
    // F_A(x) ≤ F_B(x) for every x, strictly at x = 5 and x = 10.
    const a = lotteryRiskProfile(
      [
        { payoff: 10, probability: 0.5 },
        { payoff: 20, probability: 0.5 },
      ],
      'A',
    );
    const b = lotteryRiskProfile(
      [
        { payoff: 5, probability: 0.5 },
        { payoff: 15, probability: 0.5 },
      ],
      'B',
    );
    const d = stochasticDominance(a, b);
    expect(d.order).toBe('first-order');
    expect(d.dominant).toBe('a');
    expect(d.expectedValues.a).toBeGreaterThan(d.expectedValues.b);
    expect(d.statement).toMatch(/first order/);
  });

  it('classifies a known second-order-but-not-first-order pair', () => {
    // A = 10 for certain; B = {0, 20} each ½. Both have mean 10, so neither
    // first-order dominates (F_A is below F_B before 10 and above it after),
    // but ∫F_A ≤ ∫F_B everywhere, so A second-order dominates B.
    const a = lotteryRiskProfile([{ payoff: 10, probability: 1 }], 'Certain 10');
    const b = lotteryRiskProfile(
      [
        { payoff: 0, probability: 0.5 },
        { payoff: 20, probability: 0.5 },
      ],
      'Coin flip 0/20',
    );
    const d = stochasticDominance(a, b);
    expect(d.order).toBe('second-order');
    expect(d.dominant).toBe('a');
    expect(d.expectedValues.a).toBeCloseTo(d.expectedValues.b, 12);
    expect(d.statement).toMatch(/risk-averse/);
  });

  it('reports no dominance when the comparison genuinely needs a risk attitude', () => {
    const a = lotteryRiskProfile(
      [
        { payoff: 0, probability: 0.5 },
        { payoff: 30, probability: 0.5 },
      ],
      'Spread',
    );
    const b = lotteryRiskProfile([{ payoff: 12, probability: 1 }], 'Sure 12');
    const d = stochasticDominance(a, b);
    expect(d.order).toBe('none');
    expect(d.dominant).toBeNull();
    expect(d.statement).toMatch(/risk attitude/);
  });
});

/* ------------------------------------------------------- value of information */

describe('expected value of perfect information', () => {
  it('satisfies the EVPI identity, with both sides computed independently in the test', () => {
    // With perfect information: 0.4 × max(200, 0) + 0.6 × max(−70, 0) = 80.
    // Best single action: max(0.4 × 200 + 0.6 × (−70), 0) = max(38, 0) = 38.
    // EVPI = 80 − 38 = 42.
    const expectedWithInfo = 0.4 * Math.max(200, 0) + 0.6 * Math.max(-70, 0);
    const expectedBest = Math.max(0.4 * 200 + 0.6 * -70, 0.4 * 0 + 0.6 * 0);
    const result = expectedValueOfPerfectInformation(DRILL);
    expect(result.expectedValueWithPerfectInformation).toBeCloseTo(expectedWithInfo, 12);
    expect(result.expectedValueBestAction).toBeCloseTo(expectedBest, 12);
    expect(result.evpi).toBeCloseTo(expectedWithInfo - expectedBest, 12);
    expect(result.evpi).toBeCloseTo(42, 12);
    expect(result.bestActionWithoutInformation.label).toBe('Drill');
    expect(result.isUpperBound).toBe(true);
    expect(result.notes.join(' ')).toMatch(/upper bound/);
  });

  it('is never negative, over a grid of priors', () => {
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      const result = expectedValueOfPerfectInformation({ ...DRILL, priors: [p, 1 - p] });
      expect(result.evpi).toBeGreaterThanOrEqual(0);
    }
  });

  it('is exactly 0 when one action dominates under every state of nature', () => {
    // A beats B in both states, so no information can change the choice.
    const dominated: DecisionProblem = {
      actions: ['A', 'B'],
      states: ['s1', 's2'],
      payoffs: [
        [10, 20],
        [5, 5],
      ],
      priors: [0.4, 0.6],
    };
    const result = expectedValueOfPerfectInformation(dominated);
    expect(result.evpi).toBe(0);
    expect(result.oneActionDominates).toBe(true);
    expect(result.notes.join(' ')).toMatch(/exactly 0/);
  });
});

describe('expected value of sample information', () => {
  it('stays within 0 ≤ EVSI ≤ EVPI over a grid of sensitivities and specificities', () => {
    const evpi = expectedValueOfPerfectInformation(DRILL).evpi;
    for (const sens of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      for (const spec of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
        const test = testFromSensitivitySpecificity({
          sensitivity: sens,
          specificity: spec,
          positiveStateIndex: 0,
          stateCount: 2,
        });
        const result = expectedValueOfSampleInformation(DRILL, test);
        expect(result.evsi).toBeGreaterThanOrEqual(0);
        expect(result.evsi).toBeLessThanOrEqual(evpi + 1e-12);
      }
    }
  });

  it('gives EVSI exactly equal to EVPI for a perfect test (sens = spec = 1)', () => {
    const evpi = expectedValueOfPerfectInformation(DRILL_BINARY_PRIORS).evpi;
    const perfect = testFromSensitivitySpecificity({
      sensitivity: 1,
      specificity: 1,
      positiveStateIndex: 0,
      stateCount: 2,
    });
    const result = expectedValueOfSampleInformation(DRILL_BINARY_PRIORS, perfect);
    expect(result.evsi).toBe(evpi);
    expect(result.efficiency).toBe(1);
  });

  it('gives EVSI exactly 0 for a useless test (sens = spec = 0.5)', () => {
    const useless = testFromSensitivitySpecificity({
      sensitivity: 0.5,
      specificity: 0.5,
      positiveStateIndex: 0,
      stateCount: 2,
    });
    const result = expectedValueOfSampleInformation(DRILL_BINARY_PRIORS, useless);
    expect(result.evsi).toBe(0);
    expect(result.changesDecision).toBe(false);
    // The posterior after either signal is the prior, unchanged.
    expect(result.signals[0].posterior[0]).toBe(0.25);
    expect(result.signals[1].posterior[0]).toBe(0.25);
  });

  it('values the seismic survey of the wildcat example and reports the posteriors', () => {
    const example = WORKED_EXAMPLES.find((e) => e.id === 'wildcat');
    expect(example?.problem).toBeDefined();
    expect(example?.test).toBeDefined();
    const result = expectedValueOfSampleInformation(example!.problem!, example!.test!);
    // P(favourable) = 0.4 × 0.9 + 0.6 × 0.2 = 0.48; P(wet | favourable) = 0.36/0.48 = 0.75.
    expect(result.signals[0].probability).toBeCloseTo(0.48, 12);
    expect(result.signals[0].posterior[0]).toBeCloseTo(0.75, 12);
    expect(result.signals[1].posterior[0]).toBeCloseTo(0.04 / 0.52, 12);
    expect(result.evsi).toBeGreaterThan(0);
    expect(result.evsi).toBeLessThanOrEqual(result.evpi);
    expect(result.changesDecision).toBe(true);
  });

  it('refuses a likelihood matrix whose rows are not distributions over the signals', () => {
    expect(() =>
      expectedValueOfSampleInformation(DRILL, {
        label: 'broken',
        signals: ['+', '−'],
        likelihood: [
          [0.9, 0.2],
          [0.2, 0.8],
        ],
      }),
    ).toThrow(/sums to/);
  });
});

describe('expected value of including uncertainty', () => {
  it('is non-negative and measures the cost of optimising against a base case', () => {
    const problem: DecisionProblem = {
      actions: ['Build small', 'Build large'],
      states: ['Low demand', 'Medium demand', 'High demand'],
      payoffs: [
        [10, 12, 12],
        [-20, 5, 60],
      ],
      priors: [0.3, 0.4, 0.3],
    };
    const result = expectedValueOfIncludingUncertainty(problem, { baseStateIndex: 1 });
    // Base case "Medium": best is Build small (12 vs 5). Its true EV is
    // 0.3 × 10 + 0.4 × 12 + 0.3 × 12 = 3 + 4.8 + 3.6 = 11.4.
    // Under uncertainty: Build large = −6 + 2 + 18 = 14 > 11.4, so EVIU = 2.6.
    expect(result.deterministicAction.label).toBe('Build small');
    expect(result.expectedValueOfDeterministicChoice).toBeCloseTo(11.4, 12);
    expect(result.bestUnderUncertainty.label).toBe('Build large');
    expect(result.eviu).toBeCloseTo(2.6, 12);
    expect(result.eviu).toBeGreaterThanOrEqual(0);
  });

  it('refuses to guess which single number the base case uses', () => {
    expect(() => expectedValueOfIncludingUncertainty(DRILL)).toThrow(/will not be guessed/);
  });
});

/* ------------------------------------------------------------------- utility */

describe('utility and risk attitude', () => {
  it('reproduces the plain expected-value decision exactly when risk-neutral', () => {
    const linear = rollback(HAND_TREE, { kind: 'linear' });
    const plain = rollback(HAND_TREE);
    expect(linear.certaintyEquivalent).toBe(plain.expectedValue);
    expect(linear.riskPremium).toBe(0);
    expect(linear.policy[0].alternativeLabel).toBe('B');
    const ce = certaintyEquivalent({
      outcomes: [
        { payoff: 200, probability: 0.3 },
        { payoff: 0, probability: 0.7 },
      ],
    });
    expect(ce.certaintyEquivalent).toBe(ce.expectedValue);
    expect(ce.riskPremium).toBe(0);
  });

  it('matches the closed-form CARA certainty equivalent of a 50/50 gamble', () => {
    // CE = −R · ln( ½ ( exp(−x₁/R) + exp(−x₂/R) ) ), computed here independently.
    const R = 80;
    const x1 = 100;
    const x2 = -50;
    const reference = -R * Math.log(0.5 * (Math.exp(-x1 / R) + Math.exp(-x2 / R)));
    const result = certaintyEquivalent(
      {
        outcomes: [
          { payoff: x1, probability: 0.5 },
          { payoff: x2, probability: 0.5 },
        ],
      },
      { kind: 'exponential', riskTolerance: R },
    );
    expect(result.certaintyEquivalent).toBeCloseTo(reference, 12);
    // EV is 25, and a risk-averse CE must be below it.
    expect(result.expectedValue).toBeCloseTo(25, 12);
    expect(result.certaintyEquivalent).toBeLessThan(result.expectedValue);
  });

  it('has a strictly positive risk premium for a risk-averse utility and exactly 0 for the linear one', () => {
    const lottery = {
      outcomes: [
        { payoff: 100, probability: 0.5 },
        { payoff: -50, probability: 0.5 },
      ],
    };
    expect(certaintyEquivalent(lottery, { kind: 'exponential', riskTolerance: 80 }).riskPremium).toBeGreaterThan(0);
    expect(certaintyEquivalent(lottery, { kind: 'log', shift: 1000 }).riskPremium).toBeGreaterThan(0);
    expect(certaintyEquivalent(lottery, { kind: 'power', gamma: 2, shift: 1000 }).riskPremium).toBeGreaterThan(0);
    expect(certaintyEquivalent(lottery, { kind: 'linear' }).riskPremium).toBe(0);
    // A degenerate lottery carries no risk under any utility.
    const sure = { outcomes: [{ payoff: 42, probability: 1 }] };
    expect(certaintyEquivalent(sure, { kind: 'exponential', riskTolerance: 5 }).riskPremium).toBeCloseTo(0, 12);
  });

  it('takes the CRRA γ → 1 limit as the log utility rather than dividing by zero', () => {
    const logU = utilityFunction({ kind: 'log' });
    for (const gamma of [1, 1 + 1e-10, 1 - 1e-10]) {
      const powerU = utilityFunction({ kind: 'power', gamma });
      for (const x of [0.5, 1, 2, 10, 1000]) {
        expect(powerU.u(x)).toBeCloseTo(logU.u(x), 8);
      }
    }
    const lottery = {
      outcomes: [
        { payoff: 1000, probability: 0.5 },
        { payoff: 4000, probability: 0.5 },
      ],
    };
    const logCE = certaintyEquivalent(lottery, { kind: 'log' }).certaintyEquivalent;
    for (const gamma of [1, 1 + 1e-10, 1 - 1e-10]) {
      const powerCE = certaintyEquivalent(lottery, { kind: 'power', gamma }).certaintyEquivalent;
      expect(Math.abs(powerCE - logCE)).toBeLessThan(1e-4);
    }
    // At γ = 1 exactly the CE is the geometric mean √(1000 × 4000) = 2000.
    expect(certaintyEquivalent(lottery, { kind: 'power', gamma: 1 }).certaintyEquivalent).toBeCloseTo(2000, 9);
    expect(logCE).toBeCloseTo(2000, 9);
  });

  it('round-trips the certainty equivalent through risk-tolerance elicitation', () => {
    const lottery = {
      outcomes: [
        { payoff: 100, probability: 0.5 },
        { payoff: -50, probability: 0.5 },
      ],
    };
    for (const statedCE of [-40, -10, 0, 10, 20, 24]) {
      const elicited = elicitExponentialRiskTolerance(lottery, statedCE);
      expect(elicited.riskTolerance).toBeGreaterThan(0);
      expect(elicited.exactness).toBe('numerical');
      const back = certaintyEquivalent(lottery, {
        kind: 'exponential',
        riskTolerance: elicited.riskTolerance,
      }).certaintyEquivalent;
      expect(back).toBeCloseTo(statedCE, 8);
      expect(elicited.impliedCertaintyEquivalent).toBeCloseTo(statedCE, 8);
    }
  });

  it('refuses a negative risk tolerance and an unattainable stated certainty equivalent', () => {
    expect(() => utilityFunction({ kind: 'exponential', riskTolerance: -5 })).toThrow(EngineError);
    expect(() => utilityFunction({ kind: 'exponential', riskTolerance: -5 })).toThrow(/greater than 0/);
    expect(() => utilityFunction({ kind: 'exponential', riskTolerance: 0 })).toThrow(/greater than 0/);
    const lottery = {
      outcomes: [
        { payoff: 100, probability: 0.5 },
        { payoff: -50, probability: 0.5 },
      ],
    };
    // The EV is 25; no positive R produces a CE at or above it.
    expect(() => elicitExponentialRiskTolerance(lottery, 25)).toThrow(/cannot be produced/);
    expect(() => elicitExponentialRiskTolerance(lottery, -60)).toThrow(/cannot be produced/);
  });

  it('refuses a payoff outside the domain of a logarithmic utility', () => {
    expect(() => utilityFunction({ kind: 'log' }).u(-1)).toThrow(/only defined for payoffs greater than 0/);
  });
});

describe('the insurance flip', () => {
  it('flips the recommendation from self-insure to insure once risk aversion is strong enough', () => {
    // A loss of 50 000 with probability 0.01 is an expected loss of 500.
    // Cover costs 800, so expected value says decline: −800 < −500.
    const problem: DecisionProblem = {
      actions: ['Buy cover', 'Carry the risk'],
      states: ['Loss occurs', 'No loss'],
      payoffs: [
        [-800, -800],
        [-50_000, 0],
      ],
      priors: [0.01, 0.99],
    };
    const validated = validateProblem(problem, true);
    const riskNeutral = bestAction(validated, validated.priors, { kind: 'linear' });
    expect(riskNeutral.label).toBe('Carry the risk');
    expect(riskNeutral.values[1]).toBeCloseTo(-500, 12);
    expect(riskNeutral.values[0]).toBeCloseTo(-800, 12);

    const riskAverse = bestAction(validated, validated.priors, { kind: 'exponential', riskTolerance: 10_000 });
    expect(riskAverse.label).toBe('Buy cover');
    // Hand check: CE of carrying the risk at R = 10 000 is
    // −10000 · ln(0.99 + 0.01·e⁵) = −10000 · ln(2.474131...) ≈ −9059.8.
    const reference = -10_000 * Math.log(0.99 + 0.01 * Math.exp(5));
    expect(riskAverse.values[1]).toBeCloseTo(reference, 8);
    expect(riskAverse.values[1]).toBeLessThan(riskAverse.values[0]);
    expect(riskNeutral.label).not.toBe(riskAverse.label);
  });

  it('exposes the risk premium that drives the flip', () => {
    const example = WORKED_EXAMPLES.find((e) => e.id === 'insurance');
    expect(example?.insurance).toBeDefined();
    const { uninsured, premium, riskAverseUtility } = example!.insurance!;
    const neutral = certaintyEquivalent(uninsured, { kind: 'linear' });
    const averse = certaintyEquivalent(uninsured, riskAverseUtility);
    expect(neutral.expectedValue).toBeCloseTo(-500, 12);
    expect(neutral.riskPremium).toBe(0);
    expect(averse.riskPremium).toBeGreaterThan(0);
    // The risk premium exceeds the loading in the premium quoted, which is why
    // a risk-averse buyer accepts a negative-expected-value contract.
    expect(-averse.certaintyEquivalent).toBeGreaterThan(premium);
  });
});

/* --------------------------------------------------- decisions without priors */

describe('decisions without probabilities', () => {
  /**
   * Hand-built payoff matrix:
   *            s1    s2
   *   A:       100    20
   *   B:        60    40
   *
   *   maximin:  A → 20,  B → 40           → B
   *   maximax:  A → 100, B → 60           → A
   *   best by state: s1 = 100, s2 = 40
   *   regret A: [0, 20] → max 20
   *   regret B: [40, 0] → max 40
   *   minimax regret                      → A
   *   Laplace:  A → 60, B → 50            → A
   */
  const MATRIX: DecisionProblem = {
    actions: ['A', 'B'],
    states: ['s1', 's2'],
    payoffs: [
      [100, 20],
      [60, 40],
    ],
  };

  it('matches the hand-derived minimax regret answer and the hand-built regret matrix', () => {
    const regret = regretMatrix(MATRIX);
    expect(regret.bestByState).toEqual([100, 40]);
    expect(regret.regret).toEqual([
      [0, 20],
      [40, 0],
    ]);
    expect(regret.maxRegret).toEqual([20, 40]);
    const result = decideWithoutProbabilities(MATRIX);
    const minimax = result.results.find((r) => r.criterion === 'minimax-regret');
    expect(minimax?.chosenAction).toBe('A');
    expect(minimax?.scores).toEqual([20, 40]);
    expect(minimax?.objective).toBe('minimise');
  });

  it('shows maximin and minimax regret choosing differently on the same matrix, and reports it', () => {
    const result = decideWithoutProbabilities(MATRIX);
    const maximin = result.results.find((r) => r.criterion === 'maximin');
    const maximax = result.results.find((r) => r.criterion === 'maximax');
    const minimax = result.results.find((r) => r.criterion === 'minimax-regret');
    const laplace = result.results.find((r) => r.criterion === 'laplace');
    expect(maximin?.chosenAction).toBe('B');
    expect(maximin?.scores).toEqual([20, 40]);
    expect(maximax?.chosenAction).toBe('A');
    expect(maximax?.scores).toEqual([100, 60]);
    expect(minimax?.chosenAction).toBe('A');
    expect(laplace?.chosenAction).toBe('A');
    expect(laplace?.scores).toEqual([60, 50]);
    // The disagreement must be reported, not resolved.
    expect(maximin?.chosenAction).not.toBe(minimax?.chosenAction);
    expect(result.criteriaAgree).toBe(false);
    expect(result.statement).toMatch(/DISAGREE/);
    expect(result.statement).toMatch(/value judgement/);
    expect(result.provenance.regime).toBe('no-probabilities');
  });

  it('labels the attitude each criterion encodes, and labels Laplace as an assumption', () => {
    const result = decideWithoutProbabilities(MATRIX, { hurwiczAlpha: 0.25 });
    for (const r of result.results) expect(r.attitude.length).toBeGreaterThan(10);
    const hurwicz = result.results.find((r) => r.criterion === 'hurwicz');
    // α = 0.25: A → 0.25 × 100 + 0.75 × 20 = 40; B → 0.25 × 60 + 0.75 × 40 = 45.
    expect(hurwicz?.scores[0]).toBeCloseTo(40, 12);
    expect(hurwicz?.scores[1]).toBeCloseTo(45, 12);
    expect(hurwicz?.chosenAction).toBe('B');
    expect(result.results.find((r) => r.criterion === 'laplace')?.attitude).toMatch(/uniform probability/);
  });

  it('refuses to invent probabilities when a probabilistic method is asked for without them', () => {
    expect(() => expectedValueOfPerfectInformation(MATRIX)).toThrow(/must not be invented/);
  });

  it('reproduces maximin at α = 0 and maximax at α = 1', () => {
    const atZero = decideWithoutProbabilities(MATRIX, { hurwiczAlpha: 0 });
    const atOne = decideWithoutProbabilities(MATRIX, { hurwiczAlpha: 1 });
    expect(atZero.results.find((r) => r.criterion === 'hurwicz')?.scores).toEqual(
      atZero.results.find((r) => r.criterion === 'maximin')?.scores,
    );
    expect(atOne.results.find((r) => r.criterion === 'hurwicz')?.scores).toEqual(
      atOne.results.find((r) => r.criterion === 'maximax')?.scores,
    );
  });
});

/* ------------------------------------------------------------- multi-criteria */

describe('multi-criteria decisions', () => {
  /**
   * Two benefit criteria. Hand-derived Pareto frontier:
   *   O1 (5, 1)  — nothing beats it on criterion 1            → frontier
   *   O2 (3, 3)  — nothing beats it on both                   → frontier
   *   O3 (1, 5)  — nothing beats it on criterion 2            → frontier
   *   O4 (2, 2)  — O2 is better on both                       → dominated
   *   O5 (3, 3)  — equal to O2 on everything, so neither
   *                strictly beats the other                   → frontier
   */
  const INPUT: MultiCriteriaInput = {
    criteria: [
      { key: 'c1', label: 'Criterion 1', weight: 1, direction: 'benefit' },
      { key: 'c2', label: 'Criterion 2', weight: 1, direction: 'benefit' },
    ],
    options: [
      { label: 'O1', values: { c1: 5, c2: 1 } },
      { label: 'O2', values: { c1: 3, c2: 3 } },
      { label: 'O3', values: { c1: 1, c2: 5 } },
      { label: 'O4', values: { c1: 2, c2: 2 } },
      { label: 'O5', values: { c1: 3, c2: 3 } },
    ],
  };

  it('identifies exactly the hand-derived Pareto frontier, excluding the dominated option', () => {
    const result = paretoFrontier(INPUT);
    expect(result.frontier.sort()).toEqual(['O1', 'O2', 'O3', 'O5']);
    expect(result.frontier).not.toContain('O4');
    expect(result.dominated).toHaveLength(1);
    expect(result.dominated[0].option).toBe('O4');
    expect(result.dominated[0].dominatedBy.sort()).toEqual(['O2', 'O5']);
  });

  it('handles a cost criterion by orientation, not by negating the user data', () => {
    const costly: MultiCriteriaInput = {
      criteria: [
        { key: 'benefit', label: 'Benefit', weight: 1, direction: 'benefit' },
        { key: 'price', label: 'Price', weight: 1, direction: 'cost' },
      ],
      options: [
        { label: 'Cheap and good', values: { benefit: 10, price: 1 } },
        { label: 'Dear and good', values: { benefit: 10, price: 9 } },
      ],
    };
    const result = paretoFrontier(costly);
    expect(result.frontier).toEqual(['Cheap and good']);
  });

  it('warns about the effect of the normalisation on the ranking', () => {
    const result = weightedAdditiveValue(INPUT);
    expect(result.warnings.join(' ')).toMatch(/NORMALISATION CAN CHANGE THE RANKING/);
    expect(result.normalisationLabel.length).toBeGreaterThan(0);
    expect(result.options.find((o) => o.label === 'O4')?.onParetoFrontier).toBe(false);
    for (const option of result.options) {
      const total = option.contributions.reduce((s, c) => s + c.contribution, 0);
      expect(total).toBeCloseTo(option.score, 12);
    }
  });

  it('reports the weight range over which the recommendation is unchanged', () => {
    // Two options, two criteria, min–max normalised so each column is {0, 1}:
    //   Fast (speed 1, cost 0), Cheap (speed 0, cost 1).
    // Score(Fast) = w, Score(Cheap) = 1 − w, so the recommendation switches at
    // exactly w = 0.5.
    const input: MultiCriteriaInput = {
      criteria: [
        { key: 'speed', label: 'Speed', weight: 0.7, direction: 'benefit' },
        { key: 'cost', label: 'Cost', weight: 0.3, direction: 'cost' },
      ],
      options: [
        { label: 'Fast', values: { speed: 10, cost: 100 } },
        { label: 'Cheap', values: { speed: 2, cost: 20 } },
      ],
    };
    const result = weightSensitivity(input, 'speed');
    expect(result.currentRecommendation).toBe('Fast');
    expect(result.stableRange.lower).toBeCloseTo(0.5, 12);
    expect(result.stableRange.upper).toBe(1);
    expect(result.switchingPoints).toHaveLength(1);
    expect(result.switchingPoints[0].weight).toBeCloseTo(0.5, 12);
    expect(result.switchingPoints[0].to).toBe('Fast');
  });

  it('refuses a missing criterion value rather than filling it in', () => {
    expect(() =>
      weightedAdditiveValue({
        criteria: [{ key: 'c1', label: 'C1', weight: 1, direction: 'benefit' }],
        options: [{ label: 'X', values: {} }],
      }),
    ).toThrow(/will not be filled in with a guess/);
  });
});

/* --------------------------------------------------------------- sensitivity */

describe('sensitivity and switching points', () => {
  it('reports a switching probability at which the two decisions are exactly equal', () => {
    // EV(Drill) = 200p − 70(1 − p) = 270p − 70, zero at p = 70/270.
    const exact = switchingProbabilityTwoStates(DRILL, 0, 1);
    expect(exact.probability).toBeCloseTo(70 / 270, 15);
    expect(exact.attainable).toBe(true);
    expect(exact.provenance.exactness).toBe('exact');
    expect(exact.betterBelow).toBe('Walk away');
    expect(exact.betterAbove).toBe('Drill');

    const sweep = probabilitySweep(DRILL, { steps: 51 });
    expect(sweep.switchingPoints).toHaveLength(1);
    const point = sweep.switchingPoints[0];
    expect(point.parameterValue).toBeCloseTo(70 / 270, 10);
    // At the reported switching point the two expected values are equal.
    const evDrill = point.parameterValue * 200 + (1 - point.parameterValue) * -70;
    const evWalk = 0;
    expect(Math.abs(evDrill - evWalk)).toBeLessThan(1e-10);
    expect(point.residual).toBeLessThan(1e-10);
    // And the optimal choice differs either side of it.
    const below = point.parameterValue - 1e-3;
    const above = point.parameterValue + 1e-3;
    const evAt = (p: number, row: number[]) => p * row[0] + (1 - p) * row[1];
    expect(evAt(below, DRILL.payoffs[0])).toBeLessThan(evAt(below, DRILL.payoffs[1]));
    expect(evAt(above, DRILL.payoffs[0])).toBeGreaterThan(evAt(above, DRILL.payoffs[1]));
  });

  it('says plainly when no value in the range changes the decision', () => {
    const dominated: DecisionProblem = {
      actions: ['A', 'B'],
      states: ['s1', 's2'],
      payoffs: [
        [10, 20],
        [5, 5],
      ],
    };
    const sweep = probabilitySweep(dominated, { steps: 21, baseline: 0.5 });
    expect(sweep.decisionIsStable).toBe(true);
    expect(sweep.switchingPoints).toHaveLength(0);
    expect(sweep.distanceToNearestSwitch).toBeNull();
    expect(sweep.notes.join(' ')).toMatch(/robust/);
  });

  it('refuses a closed-form switching probability for two actions that never cross', () => {
    const parallel: DecisionProblem = {
      actions: ['A', 'B'],
      states: ['s1', 's2'],
      payoffs: [
        [10, 0],
        [15, 5],
      ],
    };
    expect(() => switchingProbabilityTwoStates(parallel, 0, 1)).toThrow(/never cross/);
  });

  it('produces tornado data sorted by swing and flags the decision-critical inputs', () => {
    const result = tornado({
      parameters: [
        { name: 'pWet', baseline: 0.4, low: 0.1, high: 0.7 },
        { name: 'dryCost', baseline: -70, low: -120, high: -40 },
      ],
      evaluate: (values) => {
        const evDrill = values.pWet * 200 + (1 - values.pWet) * values.dryCost;
        return evDrill > 0 ? { value: evDrill, choice: 'Drill' } : { value: 0, choice: 'Walk away' };
      },
    });
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].swing).toBeGreaterThanOrEqual(result.bars[1].swing);
    expect(result.baselineBest).toBe('Drill');
    // At pWet = 0.1 the EV of drilling is 20 − 63 = −43, so walking away wins.
    expect(result.decisionCritical).toContain('pWet');
    expect(result.notes.join(' ')).toMatch(/cannot show interactions/);
  });
});

/* ----------------------------------------------------------------- portfolio */

describe('Kelly criterion', () => {
  it('gives exactly 2p − 1 for an even-money bet', () => {
    expect(kellyFraction({ winProbability: 0.75 }).kellyFraction).toBe(2 * 0.75 - 1);
    for (const p of [0.55, 0.6, 0.7, 0.9]) {
      expect(kellyFraction({ winProbability: p }).kellyFraction).toBeCloseTo(2 * p - 1, 15);
    }
  });

  it('refuses a bet with no edge instead of returning a negative stake', () => {
    expect(() => kellyFraction({ winProbability: 0.5 })).toThrow(EngineError);
    expect(() => kellyFraction({ winProbability: 0.5 })).toThrow(/no edge/);
    expect(() => kellyFraction({ winProbability: 0.3 })).toThrow(/no edge/);
    // With favourable odds the same win probability can have an edge.
    expect(kellyFraction({ winProbability: 0.5, netOdds: 3 }).kellyFraction).toBeCloseTo(
      (0.5 * 3 - 0.5) / 3,
      15,
    );
  });

  it('has a long-run growth rate at Kelly above both half Kelly and double Kelly', () => {
    const input = { winProbability: 0.6 };
    const result = kellyFraction(input);
    expect(result.growthRateAtKelly).toBeGreaterThan(result.growthRateAtHalfKelly);
    expect(result.growthRateAtKelly).toBeGreaterThan(result.growthRateAtDoubleKelly);
    // The asymmetry: double Kelly gives up far more than half Kelly does.
    const lossFromHalf = result.growthRateAtKelly - result.growthRateAtHalfKelly;
    const lossFromDouble = result.growthRateAtKelly - result.growthRateAtDoubleKelly;
    expect(lossFromDouble).toBeGreaterThan(lossFromHalf);
    // Hand check at p = 0.6, f* = 0.2: g(2f*) = 0.6·ln(1.4) + 0.4·ln(0.6)
    // = 0.201883... − 0.204333... = −0.002450..., i.e. strictly negative:
    // double Kelly loses money in the long run, while half Kelly does not.
    const doubleKelly = 0.6 * Math.log(1.4) + 0.4 * Math.log(0.6);
    expect(kellyGrowthRate(2 * result.kellyFraction, input)).toBeCloseTo(doubleKelly, 12);
    expect(kellyGrowthRate(2 * result.kellyFraction, input)).toBeLessThan(0);
    expect(result.growthRateAtHalfKelly).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/DRAWDOWNS|drawdowns/);
  });

  it('refuses a growth rate at a stake that wipes out the bankroll', () => {
    expect(() => kellyGrowthRate(1, { winProbability: 0.6 })).toThrow(/entire bankroll/);
    expect(() => kellyGrowthRate(-0.2, { winProbability: 0.6 })).toThrow(/different bet/);
  });
});

describe('newsvendor', () => {
  it('orders the critical fractile quantile, checked against the distribution quantile', () => {
    const cu = 5;
    const co = 4;
    const result = newsvendorOrderQuantity({
      demandDistributionId: 'poisson',
      demandParams: { lambda: 40 },
      underageCost: cu,
      overageCost: co,
    });
    // Critical fractile 5/(5+4) = 0.5555...; the reference quantile comes from
    // the distribution registry directly.
    const fractile = cu / (cu + co);
    expect(result.criticalFractile).toBe(fractile);
    const reference = getDistribution('poisson').quantile(fractile, { lambda: 40 });
    expect(result.optimalQuantity).toBe(reference);
    expect(result.provenance.exactness).toBe('exact');
  });

  it('has a lower expected mismatch cost at the optimum than one unit either side', () => {
    const result = newsvendorOrderQuantity({
      demandDistributionId: 'poisson',
      demandParams: { lambda: 40 },
      underageCost: 5,
      overageCost: 4,
    });
    expect(result.neighbourCosts).not.toBeNull();
    for (const neighbour of result.neighbourCosts!) {
      expect(neighbour.expectedCost).toBeGreaterThan(result.expectedCost);
    }
  });

  it('moves the order quantity up when a stockout gets more expensive', () => {
    const low = newsvendorOrderQuantity({
      demandDistributionId: 'poisson',
      demandParams: { lambda: 40 },
      underageCost: 5,
      overageCost: 4,
    });
    const high = newsvendorOrderQuantity({
      demandDistributionId: 'poisson',
      demandParams: { lambda: 40 },
      underageCost: 50,
      overageCost: 4,
    });
    expect(high.optimalQuantity).toBeGreaterThan(low.optimalQuantity);
  });

  it('works for a continuous demand and reports the quadrature as numerical', () => {
    const result = newsvendorOrderQuantity({
      demandDistributionId: 'normal',
      demandParams: { mu: 100, sigma: 20 },
      underageCost: 3,
      overageCost: 1,
    });
    // F⁻¹(0.75) for N(100, 20) = 100 + 20 × 0.6744897... = 113.4898...
    expect(result.optimalQuantity).toBeCloseTo(100 + 20 * 0.6744897501960817, 6);
    expect(result.expectedLeftover).toBeGreaterThan(0);
    expect(result.expectedShortage).toBeGreaterThan(0);
  });

  it('refuses a non-positive cost', () => {
    expect(() =>
      newsvendorOrderQuantity({
        demandDistributionId: 'poisson',
        demandParams: { lambda: 40 },
        underageCost: 0,
        overageCost: 4,
      }),
    ).toThrow(EngineError);
  });
});

describe('real options', () => {
  it('values a deferral option at or above its immediate exercise value', () => {
    const result = realOptionValue({
      kind: 'defer',
      projectValue: 100,
      volatility: 0.3,
      riskFreeRate: 0.05,
      years: 2,
      steps: 200,
      investmentCost: 105,
    });
    // Static NPV is max(0, 100 − 105) = 0, so all the value is the option.
    expect(result.staticValue).toBe(0);
    expect(result.optionValue).toBeGreaterThan(0);
    expect(result.flexibilityValue).toBeCloseTo(result.optionValue, 12);
    expect(result.lattice.riskNeutralProbability).toBeGreaterThan(0);
    expect(result.lattice.riskNeutralProbability).toBeLessThan(1);
    expect(result.provenance.exactness).toBe('numerical');
  });

  it('values abandonment and expansion options, both non-negative', () => {
    const abandon = realOptionValue({
      kind: 'abandon',
      projectValue: 100,
      volatility: 0.4,
      riskFreeRate: 0.04,
      years: 3,
      steps: 150,
      salvageValue: 90,
    });
    expect(abandon.optionValue).toBeGreaterThan(0);
    const expand = realOptionValue({
      kind: 'expand',
      projectValue: 100,
      volatility: 0.35,
      riskFreeRate: 0.04,
      years: 2,
      steps: 150,
      expansionFactor: 1.5,
      expansionCost: 60,
    });
    expect(expand.optionValue).toBeGreaterThanOrEqual(expand.staticValue);
  });

  it('refuses a lattice with no arbitrage-free risk-neutral probability', () => {
    expect(() =>
      realOptionValue({
        kind: 'defer',
        projectValue: 100,
        volatility: 0.01,
        riskFreeRate: 2,
        years: 1,
        steps: 2,
        investmentCost: 100,
      }),
    ).toThrow(/arbitrage-free/);
  });

  it('refuses an expansion factor that does not expand', () => {
    expect(() =>
      realOptionValue({
        kind: 'expand',
        projectValue: 100,
        volatility: 0.3,
        riskFreeRate: 0.04,
        years: 1,
        expansionFactor: 1,
        expansionCost: 10,
      }),
    ).toThrow(/does not expand/);
  });
});

/* ------------------------------------------------------------------ examples */

describe('worked examples', () => {
  it('provides five worked decisions, each with the content the interface needs', () => {
    expect(WORKED_EXAMPLES).toHaveLength(5);
    expect(WORKED_EXAMPLES.map((e) => e.id).sort()).toEqual([
      'insurance',
      'newsvendor',
      'product-launch',
      'test-and-treat',
      'wildcat',
    ]);
    for (const example of WORKED_EXAMPLES) {
      expect(example.summary.length).toBeGreaterThan(40);
      expect(example.teaches.length).toBeGreaterThan(20);
      expect(example.questions.length).toBeGreaterThan(0);
    }
  });

  it('rolls back every example tree and validates every example problem', () => {
    for (const example of WORKED_EXAMPLES) {
      if (example.tree) {
        const result = rollback(example.tree);
        expect(Number.isFinite(result.expectedValue)).toBe(true);
        expect(result.riskProfile.outcomes.length).toBeGreaterThan(0);
        const totalProbability = result.riskProfile.outcomes.reduce((s, o) => s + o.probability, 0);
        expect(totalProbability).toBeCloseTo(1, 12);
      }
      if (example.problem) {
        const validated = validateProblem(example.problem, true);
        expect(validated.priors).toHaveLength(validated.states.length);
      }
    }
  });

  it('finds the wildcat survey worth buying, and worth less than perfect information', () => {
    const example = WORKED_EXAMPLES.find((e) => e.id === 'wildcat')!;
    const tree = rollback(example.tree!);
    const evsi = expectedValueOfSampleInformation(example.problem!, example.test!);
    // The tree pays for the survey, so its value net of the 10 cost must exceed
    // the 38 available from drilling blind.
    expect(tree.expectedValue).toBeGreaterThan(38);
    expect(tree.policy[0].alternativeLabel).toBe('Run the seismic survey');
    expect(tree.expectedValue).toBeCloseTo(evsi.expectedValueBestAction + evsi.evsi - 10, 10);
    expect(evsi.evsi).toBeLessThan(evsi.evpi);
  });

  it('shows the product-launch option value: testing first is worth its cost', () => {
    const example = WORKED_EXAMPLES.find((e) => e.id === 'product-launch')!;
    const result = rollback(example.tree!);
    // Launching blind: 0.25 × 100 + 0.45 × 20 + 0.3 × (−120) = 25 + 9 − 36 = −2.
    expect(result.nodes['national-demand'].expectedValue).toBeCloseTo(-2, 12);
    expect(result.policy[0].alternativeLabel).toBe('Test market first');
    // The option to shelve is exercised after an unfavourable test:
    // 0.05 × 100 + 0.4 × 20 + 0.55 × (−120) = 5 + 8 − 66 = −53 < 0.
    expect(result.nodes['after-unfavourable'].chosenAlternative?.label).toBe('Shelve the product');
    expect(result.riskProfile.outcomes.some((o) => o.payoff < 0)).toBe(true);
  });

  it('solves the newsvendor example', () => {
    const example = WORKED_EXAMPLES.find((e) => e.id === 'newsvendor')!;
    const result = newsvendorOrderQuantity(example.newsvendor!);
    expect(result.criticalFractile).toBeCloseTo(5 / 9, 15);
    expect(result.optimalQuantity).toBeGreaterThan(40);
    expect(result.expectedProfit).not.toBeNull();
  });

  it('shows the medical example has a treatment threshold inside [0, 1]', () => {
    const example = WORKED_EXAMPLES.find((e) => e.id === 'test-and-treat')!;
    const threshold = switchingProbabilityTwoStates(example.problem!, 0, 1);
    expect(threshold.attainable).toBe(true);
    // Treat: −2 if present, −8 if absent. Do not treat: −40 if present, 0 if absent.
    // −2p − 8(1 − p) = −40p + 0 ⇒ −8 + 6p = −40p ⇒ p = 8/46.
    expect(threshold.probability).toBeCloseTo(8 / 46, 12);
    const evsi = expectedValueOfSampleInformation(example.problem!, example.test!);
    expect(evsi.evsi).toBeGreaterThanOrEqual(0);
    expect(evsi.evsi).toBeLessThanOrEqual(evsi.evpi);
  });
});
