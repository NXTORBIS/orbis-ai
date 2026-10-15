/**
 * Regression tests for the defects found by an adversarial audit of the
 * engine. Each reference value here is independent of this codebase: hand
 * computed in a comment, taken from an analytic identity, or verified against
 * SciPy and quoted with the value it produced.
 *
 * Every test in this file fails without its fix.
 */
import { describe, expect, it } from 'vitest';
import { matPow } from './stats/linalg';
import { riskMetrics } from './risk/risk';
import { getSimulationModel } from './simulation/registry';
import { incompleteBetaIsExact } from './special/gamma';
import { analyseRepeated } from './probability/repeated';
import { EngineError } from './core/result';

describe('matPow respects exponents at or beyond 2^32', () => {
  // `e >>>= 1` coerces to a uint32, so every exponent of 2^32 or more was
  // silently reduced modulo 2^32. matPow(P, 2^32) returned the identity and
  // matPow(P, 2^32 + 1) returned P — both wrong, both unsignalled.
  const P = [
    [0.9, 0.1],
    [0.2, 0.8],
  ];

  it('converges to the stationary matrix rather than returning the identity', () => {
    // This chain is irreducible and aperiodic with pi = (2/3, 1/3), so every
    // row of a very high power must approach that.
    for (const e of [2 ** 32, 2 ** 32 + 1, 3 * 2 ** 32]) {
      const M = matPow(P, e);
      // 5 decimals, not more: reaching 2^32 takes about 35 chained matrix
      // squarings, and the rounding they accumulate is expected. The defect
      // under test returned the identity matrix (1 and 0), which this bound
      // still rejects by an enormous margin.
      expect(M[0][0], `matPow(P, ${e})[0][0]`).toBeCloseTo(2 / 3, 5);
      expect(M[1][0], `matPow(P, ${e})[1][0]`).toBeCloseTo(2 / 3, 5);
    }
  });

  it('still agrees with repeated multiplication at small exponents', () => {
    let expected = [
      [1, 0],
      [0, 1],
    ];
    for (let k = 1; k <= 12; k++) {
      expected = expected.map((row) => [
        row[0] * P[0][0] + row[1] * P[1][0],
        row[0] * P[0][1] + row[1] * P[1][1],
      ]);
      const got = matPow(P, k);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) expect(got[i][j]).toBeCloseTo(expected[i][j], 12);
    }
  });

  it('refuses an exponent it cannot represent exactly, rather than truncating it', () => {
    expect(() => matPow(P, 2 ** 53 + 2)).toThrow(EngineError);
    expect(() => matPow(P, -1)).toThrow(EngineError);
    expect(() => matPow(P, 1.5)).toThrow(EngineError);
  });
});

describe('Expected Shortfall is correct when the loss distribution has an atom', () => {
  it('weights a point mass at the quantile correctly', () => {
    // 6,000 losses of 0 and 4,000 of 100 — an ordinary insurance shape, where
    // most outcomes are no loss at all.
    //
    // At alpha = 0.5, VaR = 0. The worst half of outcomes is 4,000 hundreds
    // and 1,000 zeros, so by hand
    //   ES = (4000 x 100 + 1000 x 0) / 5000 = 80.
    // Averaging every outcome at or beyond VaR = 0 averages all ten thousand
    // and gives 40: half the true figure, understating the risk silently.
    const losses = [...new Array<number>(6000).fill(0), ...new Array<number>(4000).fill(100)];
    const r = riskMetrics({ losses, levels: [0.5, 0.6, 0.9] });
    const at = (level: number) => r.var.find((e) => e.level === level)!;

    expect(at(0.5).valueAtRisk).toBe(0);
    expect(at(0.5).expectedShortfall).toBeCloseTo(80, 9);
    // At alpha = 0.6, VaR is still 0 and the worst 40% are all 100s: ES = 100.
    expect(at(0.6).expectedShortfall).toBeCloseTo(100, 9);
    // At alpha = 0.9 every outcome in the worst tenth is a 100.
    expect(at(0.9).expectedShortfall).toBeCloseTo(100, 9);
  });

  it('honours the documented guarantee that ES is never below VaR', () => {
    // The old tail-mean estimator broke this guarantee, which the module
    // header states as holding always.
    const shapes: number[][] = [
      [...new Array<number>(6000).fill(0), ...new Array<number>(4000).fill(100)],
      [...new Array<number>(9990).fill(0), ...new Array<number>(10).fill(1e6)],
      [...new Array<number>(5000).fill(-5), ...new Array<number>(5000).fill(5)],
      new Array<number>(1000).fill(7),
    ];
    for (const losses of shapes) {
      const r = riskMetrics({ losses, levels: [0.5, 0.75, 0.9, 0.99] });
      for (const e of r.var) {
        expect(e.expectedShortfall, `ES at ${e.level}`).toBeGreaterThanOrEqual(e.valueAtRisk - 1e-9);
      }
    }
  });

  it('still matches the analytic answer for a continuous distribution', () => {
    // For Exponential(1) the memorylessness property gives exactly
    //   VaR_a = -ln(1 - a)   and   ES_a = VaR_a + 1.
    // Built from exact quantiles so the only error is the discretisation.
    const n = 400_000;
    const losses = new Array<number>(n);
    for (let i = 0; i < n; i++) losses[i] = -Math.log(1 - (i + 0.5) / n);
    for (const level of [0.9, 0.95, 0.99]) {
      const e = riskMetrics({ losses, levels: [level] }).var[0];
      const varTrue = -Math.log(1 - level);
      expect(e.valueAtRisk).toBeCloseTo(varTrue, 2);
      expect(e.expectedShortfall).toBeCloseTo(varTrue + 1, 2);
    }
  });

  it('reports a standard error derived from the estimator actually used', () => {
    const losses = [...new Array<number>(6000).fill(0), ...new Array<number>(4000).fill(100)];
    const e = riskMetrics({ losses, levels: [0.5] }).var[0];
    // sd of the excesses over VaR = 0 is sd of the losses themselves; the ES
    // standard error is sd(excess) / (sqrt(n) * (1 - level)).
    const mean = 40;
    let ss = 0;
    for (const l of losses) ss += (l - mean) ** 2;
    const sd = Math.sqrt(ss / (losses.length - 1));
    expect(e.esStandardError!).toBeCloseTo(sd / Math.sqrt(losses.length) / 0.5, 6);
  });
});

describe('the Markov model never labels a wrong number exact', () => {
  const model = getSimulationModel('markov-chain');

  it('computes the n-step distribution correctly past the old 100,000 cap', () => {
    // Deterministic alternation. After an ODD number of steps the chain is in
    // state B (index 1) with probability 1, so the mean state index is 1.
    // The old code stopped multiplying at 100,000 steps while still calling
    // the result exact, and the interface drew it as the exact reference line
    // against the simulation.
    const base = { states: ['A', 'B'], matrix: [[0, 1], [1, 0]], initialState: 0 };
    expect(model.prepare({ ...base, steps: 100_001 } as never).theoretical!.finalState!.mean).toBeCloseTo(1, 12);
    expect(model.prepare({ ...base, steps: 100_002 } as never).theoretical!.finalState!.mean).toBeCloseTo(0, 12);
    expect(model.prepare({ ...base, steps: 999_999 } as never).theoretical!.finalState!.mean).toBeCloseTo(1, 12);
  });

  it('agrees with step-by-step multiplication below the old cap', () => {
    const matrix = [
      [0.7, 0.3],
      [0.4, 0.6],
    ];
    let dist = [1, 0];
    for (let s = 0; s < 40; s++) {
      dist = [dist[0] * matrix[0][0] + dist[1] * matrix[1][0], dist[0] * matrix[0][1] + dist[1] * matrix[1][1]];
    }
    const expectedMean = dist[1];
    const got = model.prepare({ states: ['A', 'B'], matrix, initialState: 0, steps: 40 } as never);
    expect(got.theoretical!.finalState!.mean).toBeCloseTo(expectedMean, 12);
  });
});

describe('a binomial tail from the incomplete beta is not called exact', () => {
  it('labels a large-n cumulative probability numerical, with the reason', () => {
    // The finding was measured at n = 1e7, which `discrete.ts` permits:
    // SciPy gives binom.cdf(5e6, 1e7, 0.5) = 0.5001261566229462 while the
    // incomplete beta here gives 0.5001261409098403 — an error of 1.6e-8, the
    // eighth significant digit, which is exactly the precision these steps
    // print at. This tool caps trials at MAX_TRIALS = 5e6, so that is the
    // largest case reachable through it; the shape parameters are 2.5e6,
    // still far above the threshold at which full double precision holds.
    const r = analyseRepeated({ question: 'at-most-k', p: 0.5, trials: 5_000_000, k: 2_500_000 });
    expect(r.explanation!.exactness).toBe('numerical');
    expect(r.explanation!.limitations.join(' ')).toMatch(/incomplete beta|eighth significant digit/i);
  });

  it('still labels a small-n cumulative probability exact', () => {
    const r = analyseRepeated({ question: 'at-most-k', p: 0.5, trials: 20, k: 10 });
    expect(r.explanation!.exactness).toBe('exact');
  });

  it('exposes the threshold helper the label depends on', () => {
    expect(incompleteBetaIsExact(100, 100)).toBe(true);
    expect(incompleteBetaIsExact(5_000_000, 5_000_000)).toBe(false);
  });
});
