/**
 * Utility functions, certainty equivalents and risk attitude.
 *
 * A utility function turns a payoff into a number whose *expectation* is the
 * thing a decision maker is assumed to maximise. The decision-relevant output
 * is not the utility (whose scale is arbitrary) but the **certainty
 * equivalent**: the sure payoff the decision maker would accept instead of the
 * lottery. The gap
 *
 *     risk premium = expected value − certainty equivalent
 *
 * is the price of the risk. For a risk-neutral (linear) utility it is exactly
 * zero; for a risk-averse utility it is strictly positive on any lottery that
 * is not degenerate. That gap, not the expected value, is what makes a
 * risk-averse decision maker buy insurance at a negative expected value.
 *
 * Families implemented
 * --------------------
 *  - linear        u(x) = x                       risk-neutral
 *  - exponential   u(x) = −exp(−x/R)              CARA, constant absolute risk
 *                                                 aversion, risk tolerance R
 *  - power         u(x) = (x^(1−γ) − 1)/(1 − γ)   CRRA, relative risk aversion
 *                  and u(x) = ln x at γ = 1       (the limit is taken, not
 *                                                 divided by zero)
 *  - log           u(x) = ln(x + shift)           CRRA with γ = 1
 *
 * Utility evaluation is exact (closed form). Inverting a utility to recover an
 * implied risk tolerance from a stated certainty equivalent is a root find and
 * is reported as `numerical`.
 */
import { EngineError, Validator } from '../core/result';
import { brentRoot, logSumExp, stableSum } from '../core/numeric';
import type { Lottery, OutcomePoint } from './types';

export type RiskAttitude = 'risk-neutral' | 'risk-averse' | 'risk-seeking';

export type UtilitySpec =
  | { kind: 'linear' }
  /** u(x) = −exp(−x/R); R > 0 is risk-averse, R < 0 is rejected. */
  | { kind: 'exponential'; riskTolerance: number }
  /** CRRA with coefficient γ; γ = 1 is handled as the logarithmic limit. */
  | { kind: 'power'; gamma: number; shift?: number }
  | { kind: 'log'; shift?: number };

export interface UtilityFunction {
  spec: UtilitySpec;
  label: string;
  attitude: RiskAttitude;
  /** Utility of a payoff. Throws if the payoff is outside the domain. */
  u(x: number): number;
  /** Payoff whose utility is the given value. */
  inverse(utility: number): number;
  /** Lowest payoff the function is defined for (−Infinity when unbounded). */
  domainMin: number;
  notes: string[];
}

function requireDomain(x: number, min: number, label: string): void {
  if (!Number.isFinite(x)) {
    throw new EngineError(`Payoff must be a finite number to evaluate ${label}.`, 'finite');
  }
  if (x <= min) {
    throw new EngineError(
      `${label} is only defined for payoffs greater than ${min}; got ${x}. ` +
        'Shift the payoff scale so every outcome is inside the domain.',
      'domain',
    );
  }
}

/** Build a utility function from its specification. */
export function utilityFunction(spec: UtilitySpec): UtilityFunction {
  switch (spec.kind) {
    case 'linear':
      return {
        spec,
        label: 'Linear utility (risk-neutral)',
        attitude: 'risk-neutral',
        u: (x) => x,
        inverse: (v) => v,
        domainMin: -Infinity,
        notes: ['Maximising expected linear utility is maximising expected value; the risk premium is exactly 0.'],
      };
    case 'exponential': {
      const R = spec.riskTolerance;
      const v = new Validator();
      if (v.finite(R, 'riskTolerance', 'Risk tolerance R') && R <= 0) {
        v.add(
          `Risk tolerance R must be greater than 0 for the exponential utility u(x) = −exp(−x/R); got ${R}. ` +
            'A non-positive R has no risk interpretation — use the linear utility for risk neutrality.',
          'riskTolerance',
          'range',
        );
      }
      v.throwIfInvalid();
      return {
        spec,
        label: `Exponential (CARA) utility, risk tolerance R = ${R}`,
        attitude: 'risk-averse',
        u: (x) => {
          if (!Number.isFinite(x)) throw new EngineError('Payoff must be a finite number.', 'finite');
          return -Math.exp(-x / R);
        },
        inverse: (value) => {
          if (!(value < 0)) {
            throw new EngineError(
              'Exponential utility takes only negative values; cannot invert a value ≥ 0.',
              'domain',
            );
          }
          return -R * Math.log(-value);
        },
        domainMin: -Infinity,
        notes: [
          'Constant absolute risk aversion: the risk premium of a gamble does not depend on existing wealth.',
          'R is the payoff scale at which risk matters; a gamble small relative to R is treated almost risk-neutrally.',
        ],
      };
    }
    case 'power': {
      const gamma = spec.gamma;
      const shift = spec.shift ?? 0;
      const v = new Validator();
      v.finite(gamma, 'gamma', 'Relative risk aversion γ');
      v.finite(shift, 'shift', 'Payoff shift');
      v.throwIfInvalid();
      const eta = 1 - gamma;
      const min = -shift;
      const label = `Power (CRRA) utility, γ = ${gamma}`;
      return {
        spec,
        label,
        attitude: gamma > 0 ? 'risk-averse' : gamma < 0 ? 'risk-seeking' : 'risk-neutral',
        u: (x) => {
          requireDomain(x + shift, 0, label);
          const y = x + shift;
          // γ = 1 is the logarithmic limit of (y^(1−γ) − 1)/(1 − γ); taking it
          // explicitly avoids a 0/0 division.
          if (eta === 0) return Math.log(y);
          return Math.expm1(eta * Math.log(y)) / eta;
        },
        inverse: (value) => {
          if (!Number.isFinite(value)) throw new EngineError('Utility value must be finite.', 'finite');
          if (eta === 0) return Math.exp(value) - shift;
          const arg = eta * value;
          if (arg <= -1) {
            throw new EngineError(
              'Utility value is outside the range of this power utility; no payoff attains it.',
              'domain',
            );
          }
          return Math.exp(Math.log1p(arg) / eta) - shift;
        },
        domainMin: min,
        notes: [
          'Constant relative risk aversion: the risk premium scales with the payoff level.',
          'Defined only for payoffs above the shift point; shift the scale if any outcome is non-positive.',
          'γ = 1 is evaluated as the logarithmic limit, not by dividing by 1 − γ.',
        ],
      };
    }
    case 'log': {
      const shift = spec.shift ?? 0;
      const v = new Validator();
      v.finite(shift, 'shift', 'Payoff shift');
      v.throwIfInvalid();
      const label = 'Logarithmic utility';
      return {
        spec,
        label,
        attitude: 'risk-averse',
        u: (x) => {
          requireDomain(x + shift, 0, label);
          return Math.log(x + shift);
        },
        inverse: (value) => {
          if (!Number.isFinite(value)) throw new EngineError('Utility value must be finite.', 'finite');
          return Math.exp(value) - shift;
        },
        domainMin: -shift,
        notes: [
          'Logarithmic utility is CRRA with γ = 1 and is the utility whose expectation the Kelly criterion maximises.',
          'It assigns utility −∞ to a payoff at the shift point: ruin is treated as infinitely bad.',
        ],
      };
    }
  }
}

/** Validate an outcome list as a probability distribution over payoffs. */
export function validateLottery(lottery: Lottery, field = 'outcomes'): OutcomePoint[] {
  const v = new Validator();
  if (!lottery.outcomes.length) v.add('A lottery needs at least one outcome.', field, 'required');
  let total = 0;
  lottery.outcomes.forEach((o, i) => {
    v.finite(o.payoff, `${field}[${i}].payoff`, `Payoff of outcome ${i + 1}`);
    if (v.probability(o.probability, `${field}[${i}].probability`, `Probability of outcome ${i + 1}`)) {
      total += o.probability;
    }
  });
  v.throwIfInvalid();
  total = stableSum(lottery.outcomes.map((o) => o.probability));
  if (Math.abs(total - 1) > 1e-9) {
    throw new EngineError(
      `Outcome probabilities must sum to 1; they sum to ${total}.`,
      'sum',
    );
  }
  return lottery.outcomes;
}

export function expectedPayoff(lottery: Lottery): number {
  const outcomes = validateLottery(lottery);
  return stableSum(outcomes.map((o) => o.probability * o.payoff));
}

export interface CertaintyEquivalentResult {
  expectedValue: number;
  certaintyEquivalent: number;
  /** expectedValue − certaintyEquivalent: the price of the risk. */
  riskPremium: number;
  expectedUtility: number;
  utilityLabel: string;
  attitude: RiskAttitude;
  /** True when every outcome has the same payoff (risk premium must be 0). */
  degenerate: boolean;
  notes: string[];
}

/**
 * Certainty equivalent and risk premium of a lottery under a utility function.
 *
 * For the exponential family the certainty equivalent is evaluated in log
 * space, CE = −R · log Σ pᵢ exp(−xᵢ/R), which is algebraically identical to
 * inverting the expected utility but does not overflow for payoffs large
 * relative to R.
 */
export function certaintyEquivalent(lottery: Lottery, spec: UtilitySpec = { kind: 'linear' }): CertaintyEquivalentResult {
  const outcomes = validateLottery(lottery);
  const uf = utilityFunction(spec);
  const ev = stableSum(outcomes.map((o) => o.probability * o.payoff));
  const first = outcomes[0].payoff;
  const degenerate = outcomes.every((o) => o.payoff === first || o.probability === 0);

  let expectedUtility: number;
  let ce: number;
  if (spec.kind === 'exponential') {
    const R = spec.riskTolerance;
    const terms = outcomes
      .filter((o) => o.probability > 0)
      .map((o) => Math.log(o.probability) - o.payoff / R);
    const lse = logSumExp(terms);
    ce = -R * lse;
    expectedUtility = -Math.exp(lse);
  } else {
    expectedUtility = stableSum(outcomes.map((o) => (o.probability === 0 ? 0 : o.probability * uf.u(o.payoff))));
    ce = uf.inverse(expectedUtility);
  }

  return {
    expectedValue: ev,
    certaintyEquivalent: ce,
    riskPremium: ev - ce,
    expectedUtility,
    utilityLabel: uf.label,
    attitude: uf.attitude,
    degenerate,
    notes: [
      'The certainty equivalent is the sure payoff equivalent to the lottery for this decision maker.',
      'Expected value − certainty equivalent is the risk premium: what the risk itself costs.',
      ...(degenerate ? ['Every outcome has the same payoff, so the risk premium is 0 by construction.'] : []),
    ],
  };
}

export interface RiskToleranceElicitation {
  riskTolerance: number;
  /** The certainty equivalent recomputed at the fitted R; a round-trip check. */
  impliedCertaintyEquivalent: number;
  expectedValue: number;
  iterationsBracketed: number;
  exactness: 'numerical';
  notes: string[];
}

/**
 * Invert the exponential utility: given a lottery and the sure amount the
 * decision maker says they would accept instead of it, recover the risk
 * tolerance R that reproduces that statement.
 *
 * CE(R) is strictly increasing in R, from the worst payoff as R → 0⁺ to the
 * expected value as R → ∞. A stated certainty equivalent outside
 * (min payoff, expected value) is therefore not representable by any R > 0 and
 * is refused rather than clipped.
 */
export function elicitExponentialRiskTolerance(lottery: Lottery, statedCE: number): RiskToleranceElicitation {
  const outcomes = validateLottery(lottery);
  const v = new Validator();
  v.finite(statedCE, 'statedCE', 'Stated certainty equivalent');
  v.throwIfInvalid();
  const ev = stableSum(outcomes.map((o) => o.probability * o.payoff));
  const live = outcomes.filter((o) => o.probability > 0);
  const worst = Math.min(...live.map((o) => o.payoff));
  const best = Math.max(...live.map((o) => o.payoff));
  if (worst === best) {
    throw new EngineError(
      'The lottery is degenerate (a single payoff), so it carries no risk and no risk tolerance can be elicited from it.',
      'degenerate',
    );
  }
  if (!(statedCE > worst && statedCE < ev)) {
    throw new EngineError(
      `A stated certainty equivalent of ${statedCE} cannot be produced by any positive risk tolerance: ` +
        `the exponential utility gives a certainty equivalent strictly between the worst payoff (${worst}) ` +
        `and the expected value (${ev}). A value at or above the expected value is risk-seeking or risk-neutral, ` +
        'not risk-averse.',
      'range',
    );
  }
  const f = (R: number) => certaintyEquivalent({ outcomes }, { kind: 'exponential', riskTolerance: R }).certaintyEquivalent - statedCE;
  const scale = Math.max(1e-12, best - worst);
  let lo = scale * 1e-6;
  let hi = scale;
  let steps = 0;
  while (f(lo) > 0 && steps < 200) {
    lo /= 4;
    steps++;
  }
  while (f(hi) < 0 && steps < 400) {
    hi *= 4;
    steps++;
  }
  if (f(lo) > 0 || f(hi) < 0) {
    throw new EngineError(
      'Elicitation of the risk tolerance did not converge: no positive R reproduces the stated certainty equivalent ' +
        'within the searched range. Check that the stated value is strictly between the worst payoff and the expected value.',
      'numerical',
    );
  }
  const R = brentRoot(f, lo, hi, { tol: 1e-14 });
  const back = certaintyEquivalent({ outcomes }, { kind: 'exponential', riskTolerance: R }).certaintyEquivalent;
  if (!Number.isFinite(R) || R <= 0 || Math.abs(back - statedCE) > 1e-6 * Math.max(1, Math.abs(statedCE))) {
    throw new EngineError(
      'Elicitation of the risk tolerance did not converge to a usable value; the round-trip certainty equivalent ' +
        `was ${back} against a stated ${statedCE}.`,
      'numerical',
    );
  }
  return {
    riskTolerance: R,
    impliedCertaintyEquivalent: back,
    expectedValue: ev,
    iterationsBracketed: steps,
    exactness: 'numerical',
    notes: [
      'R was found by a bracketed root find on CE(R) − stated CE; CE(R) is monotone in R, so the root is unique.',
      'The elicited R describes only this decision maker and only the payoff range of the lottery used to elicit it.',
    ],
  };
}
