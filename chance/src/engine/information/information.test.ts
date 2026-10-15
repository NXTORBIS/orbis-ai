/**
 * Tests for the information-theory module.
 *
 * Reference values are independent of this implementation. They come from
 * three places, in order of preference:
 *   1. EXACT known answers: a fair coin is 1 bit, log₂k for a fair k-sided die,
 *      0 for a deterministic outcome, 1 − H(p) for the binary symmetric
 *      channel, ½ln(2πeσ²) for the normal differential entropy, 1/σ² and
 *      1/(p(1−p)) for the Fisher information, and the textbook closed-form KL
 *      formulae written out longhand here rather than called from the module.
 *   2. EXACT IDENTITIES that any correct implementation must satisfy — the
 *      chain rule, the three equivalent forms of mutual information, Gibbs'
 *      inequality, Pinsker's inequality, the Murphy decomposition. These are
 *      the strongest tests available because they constrain the whole
 *      computation at once.
 *   3. INDEPENDENT NUMERICAL ROUTES: quadrature against closed forms,
 *      numerical score differentiation against analytic Fisher information,
 *      numerical optimisation against known maximum-entropy answers.
 *
 * Every tolerance is justified where it appears. Fixed seeds throughout.
 */
import { describe, expect, it } from 'vitest';
import { Random } from '../random/rng';
import { EngineError } from '../core/result';
import { getDistribution } from '../distributions/registry';
import { logGamma, normalPdf } from '../special/gamma';
import { stableSum } from '../core/numeric';
import {
  collisionEntropy,
  conditionalEntropy,
  conditionalMutualInformation,
  crossEntropy,
  entropyNats,
  hartleyEntropy,
  interactionInformation,
  jointEntropy,
  minEntropy,
  mutualInformation,
  perplexity,
  rankInformationGain,
  renyiEntropy,
  shannonEntropy,
  totalCorrelation,
  tsallisEntropy,
  xLogX,
} from './entropy';
import {
  closedFormKl,
  dirichletKl,
  distances,
  divergenceBounds,
  jensenShannonDivergence,
  klDivergence,
  renyiDivergence,
  wasserstein1,
} from './divergence';
import {
  differentialEntropy,
  differentialEntropyQuadrature,
  discreteSupport,
  gaussLegendre,
  maximumEntropyClosedForm,
  maximumEntropyDistribution,
  midpointGrid,
} from './differential';
import {
  binnedMutualInformation,
  contingency,
  estimateEntropy,
  estimateMutualInformation,
  kozachenkoLeonenkoEntropy,
  ksgMutualInformation,
  plugInMutualInformationNats,
  tally,
} from './estimation';
import {
  brierScore,
  calibration,
  climatologyBrier,
  crpsEnsemble,
  crpsNormal,
  crpsNumerical,
  logScore,
  normalPitValues,
  pitHistogram,
  rankedProbabilityScore,
  sharpness,
  skillScore,
  sphericalScore,
  verifyPropriety,
} from './scoring';
import {
  binarySymmetricCapacity,
  binarySymmetricChannel,
  channelCapacity,
  expectedInformationGain,
  fisherInformation,
  jeffreysPrior,
} from './channel';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const LOG2 = Math.LN2;

/** Normalise a weight vector (test-side, so the module never sees bad input). */
function norm(w: readonly number[]): number[] {
  const s = stableSum(w);
  return w.map((v) => v / s);
}

/** Random probability vector with `zeros` exact zeros inserted. */
function randomVector(rng: Random, k: number, zeros = 0): number[] {
  const w = Array.from({ length: k }, () => rng.uniform() + 1e-3);
  for (let i = 0; i < zeros && i < k - 1; i++) w[i] = 0;
  return norm(w);
}

/** Random joint table, optionally with some exact zero cells. */
function randomJoint(rng: Random, rows: number, cols: number, zeroCells = 0): number[][] {
  const flat = Array.from({ length: rows * cols }, () => rng.uniform() + 1e-3);
  for (let i = 0; i < zeroCells && i < flat.length - 1; i++) flat[rng.int(0, flat.length - 1)] = 0;
  const p = norm(flat);
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) out.push(p.slice(i * cols, (i + 1) * cols));
  return out;
}

/** H(Y|X) computed the long way: Σ_x p(x)·H(Y | X = x). Independent of the module's route. */
function conditionalEntropyLongWay(joint: readonly number[][]): number {
  let total = 0;
  for (const row of joint) {
    const px = stableSum(row);
    if (px === 0) continue;
    const cond = row.map((v) => v / px);
    total += px * entropyNats(cond);
  }
  return total / LOG2; // bits
}

function transpose(m: readonly number[][]): number[][] {
  return m[0].map((_, j) => m.map((row) => row[j]));
}

/**
 * KL divergence between two continuous registry distributions by quadrature,
 * written here independently of the module: the quantile substitution
 * x = Q₁(u) composed with u = (1 + tanh t)/2, so
 *   D = ∫ [ln f₁(x) − ln f₂(x)] · sech²(t)/2 dt.
 */
function continuousKlQuadrature(
  id: string,
  pParams: Record<string, number>,
  qParams: Record<string, number>,
): number {
  const def = getDistribution(id);
  const g = (t: number): number => {
    const e = Math.exp(-2 * Math.abs(t));
    const u = t >= 0 ? 1 / (1 + e) : e / (1 + e);
    const weight = (2 * e) / ((1 + e) * (1 + e));
    if (!(u > 0) || !(u < 1) || weight === 0) return 0;
    const x = def.quantile(u, pParams);
    const l1 = def.logPdf(x, pParams);
    const l2 = def.logPdf(x, qParams);
    if (!Number.isFinite(l1) || !Number.isFinite(l2)) return 0;
    return (l1 - l2) * weight;
  };
  return gaussLegendre(g, -30, 30, 300);
}

/* ================================================================== */
describe('exact discrete entropies', () => {
  it('a fair coin is exactly 1 bit', () => {
    const r = shannonEntropy([0.5, 0.5]);
    expect(r.value).toBe(1);
    expect(r.base).toBe('bits');
    expect(r.exactness).toBe('exact');
    expect(r.perplexity).toBeCloseTo(2, 12);
  });

  it('a fair k-sided die is exactly log2(k) bits', () => {
    for (const k of [2, 3, 4, 5, 6, 8, 10, 16, 52]) {
      const r = shannonEntropy(new Array<number>(k).fill(1 / k));
      // Math.log2 is the independent reference; both are the same IEEE value
      // for a uniform distribution up to one rounding, hence 1e-14.
      expect(r.value).toBeCloseTo(Math.log2(k), 14);
      expect(r.maximum).toBeCloseTo(Math.log2(k), 14);
      expect(r.efficiency).toBeCloseTo(1, 12);
      expect(r.perplexity).toBeCloseTo(k, 10);
    }
  });

  it('a deterministic distribution has exactly zero entropy', () => {
    expect(shannonEntropy([1, 0, 0, 0]).value).toBe(0);
    expect(shannonEntropy([0, 0, 1]).value).toBe(0);
    expect(shannonEntropy([1]).value).toBe(0);
  });

  it('reports entropy in nats and hartleys with the base labelled', () => {
    const bits = shannonEntropy([0.5, 0.5], { base: 'bits' });
    const nats = shannonEntropy([0.5, 0.5], { base: 'nats' });
    const hart = shannonEntropy([0.5, 0.5], { base: 'hartleys' });
    expect(bits.value).toBe(1);
    expect(nats.value).toBeCloseTo(Math.LN2, 15);
    expect(hart.value).toBeCloseTo(Math.log10(2), 15);
    expect(nats.baseLabel).toContain('nats');
    expect(hart.baseLabel).toContain('base 10');
  });

  it('the uniform distribution is the UNIQUE maximiser on k outcomes', () => {
    const rng = new Random('unique-maximiser');
    for (const k of [2, 3, 5, 9]) {
      const maxEntropy = shannonEntropy(new Array<number>(k).fill(1 / k)).value;
      expect(maxEntropy).toBeCloseTo(Math.log2(k), 14);
      for (let trial = 0; trial < 50; trial++) {
        const p = randomVector(rng, k);
        const h = shannonEntropy(p).value;
        // Strictly less: a random vector is non-uniform with probability 1.
        expect(h).toBeLessThan(maxEntropy);
      }
      // A deliberately near-uniform but non-uniform vector is still strictly less.
      const near = new Array<number>(k).fill(1 / k);
      near[0] += 1e-6;
      near[1] -= 1e-6;
      expect(shannonEntropy(near).value).toBeLessThan(maxEntropy);
    }
  });
});

/* ================================================================== */
describe('the 0·log0 = 0 convention', () => {
  it('xLogX(0) is exactly 0, not NaN', () => {
    expect(xLogX(0)).toBe(0);
    expect(xLogX(1)).toBe(0);
  });

  it('distributions containing exact zeros give a finite entropy', () => {
    for (const p of [[1, 0], [0.5, 0.5, 0], [0, 0, 1], [0, 0.25, 0.75, 0], [0.5, 0, 0, 0.5]]) {
      const r = shannonEntropy(p);
      expect(Number.isFinite(r.value)).toBe(true);
      expect(Number.isNaN(r.value)).toBe(false);
    }
    expect(shannonEntropy([1, 0]).value).toBe(0);
    expect(shannonEntropy([0.5, 0.5, 0]).value).toBe(1);
    expect(shannonEntropy([0, 0, 1]).value).toBe(0);
    expect(shannonEntropy([0.25, 0.25, 0.25, 0.25, 0]).value).toBe(2);
  });

  it('zeros in a joint table do not break mutual information', () => {
    const mi = mutualInformation([
      [0.5, 0],
      [0, 0.5],
    ]);
    // A perfectly coupled pair of fair bits: I = H(X) = H(Y) = 1 bit exactly.
    expect(mi.mutualInformation).toBe(1);
    expect(mi.hx).toBe(1);
    expect(mi.hxGivenY).toBe(0);
  });

  it('zeros in a divergence do not produce NaN', () => {
    const d = klDivergence([0.5, 0.5, 0], [0.25, 0.25, 0.5]);
    expect(d.finite).toBe(true);
    expect(Number.isNaN(d.value)).toBe(false);
    // P(x) = 0 means the term is 0 even where Q(x) > 0.
    expect(d.value).toBeCloseTo((0.5 * Math.log(2) + 0.5 * Math.log(2)) / LOG2, 14);
  });

  it('reports a finite entropy for a vector of all zeros but one', () => {
    expect(shannonEntropy([0, 0, 0, 1]).value).toBe(0);
    expect(perplexity([0, 0, 0, 1])).toBeCloseTo(1, 14);
  });
});

/* ================================================================== */
describe('exact information identities', () => {
  const rng = new Random('identities-seed-1');
  const cases: number[][][] = [];
  for (let i = 0; i < 12; i++) cases.push(randomJoint(rng, 3 + (i % 3), 2 + (i % 4)));
  // Include tables with exact zero cells so the 0·log0 path is on the identity
  // test paths too.
  for (let i = 0; i < 6; i++) cases.push(randomJoint(rng, 4, 3, 3));

  it('chain rule: H(X,Y) = H(X) + H(Y|X)', () => {
    for (const joint of cases) {
      const mi = mutualInformation(joint);
      const hx = shannonEntropy(mi.px).value;
      const hyGivenX = conditionalEntropyLongWay(joint);
      // 1e-12 bits: the sums involve at most a few dozen terms of magnitude
      // ≤ 3, so double rounding is ~1e-15; 1e-12 is three orders above that
      // and far below any real error.
      expect(mi.hxy).toBeCloseTo(hx + hyGivenX, 12);
      expect(mi.hyGivenX).toBeCloseTo(hyGivenX, 12);
    }
  });

  it('all three forms of I(X;Y) agree', () => {
    for (const joint of cases) {
      const mi = mutualInformation(joint);
      // Form 1 is the direct Σ p log[p/(pq)] sum computed by the module.
      // Form 2: H(X) + H(Y) − H(X,Y), from independently computed entropies.
      const form2 = shannonEntropy(mi.px).value + shannonEntropy(mi.py).value - jointEntropy(joint).value;
      // Form 3: H(X) − H(X|Y), with H(X|Y) computed the long way.
      const form3 = shannonEntropy(mi.px).value - conditionalEntropyLongWay(transpose(joint));
      expect(mi.mutualInformation).toBeCloseTo(form2, 12);
      expect(mi.mutualInformation).toBeCloseTo(form3, 12);
    }
  });

  it('I(X;Y) = D_KL(P(X,Y) ‖ P(X)P(Y))', () => {
    for (const joint of cases) {
      const mi = mutualInformation(joint);
      const product: number[] = [];
      for (let i = 0; i < mi.px.length; i++) for (let j = 0; j < mi.py.length; j++) product.push(mi.px[i] * mi.py[j]);
      const kl = klDivergence(joint.flat(), norm(product));
      expect(kl.finite).toBe(true);
      expect(mi.mutualInformation).toBeCloseTo(kl.value, 12);
    }
  });

  it('I(X;X) = H(X)', () => {
    const rngSelf = new Random('self-information');
    for (let t = 0; t < 10; t++) {
      const k = 2 + (t % 5);
      const p = randomVector(rngSelf, k);
      const joint = p.map((v, i) => p.map((_, j) => (i === j ? v : 0)));
      const mi = mutualInformation(joint);
      expect(mi.mutualInformation).toBeCloseTo(shannonEntropy(p).value, 12);
    }
  });

  it('I(X;Y) ≥ 0 always, and is exactly 0 if and only if X and Y are independent', () => {
    for (const joint of cases) {
      expect(mutualInformation(joint).mutualInformation).toBeGreaterThanOrEqual(0);
    }
    // Independent: an exactly factorised joint built from dyadic rationals, so
    // the product is exact in binary.
    const px = [0.5, 0.25, 0.25];
    const py = [0.25, 0.75];
    const indep = px.map((a) => py.map((b) => a * b));
    expect(mutualInformation(indep).mutualInformation).toBe(0);
    // Independent with a random (non-dyadic) pair of marginals: still zero to
    // within double rounding of log().
    const rngInd = new Random('independent-joint');
    for (let t = 0; t < 10; t++) {
      const a = randomVector(rngInd, 4);
      const b = randomVector(rngInd, 3);
      const j = a.map((u) => b.map((v) => u * v));
      expect(mutualInformation(j).mutualInformation).toBeLessThan(1e-15);
    }
    // Dependent: strictly positive.
    for (const joint of [
      [
        [0.4, 0.1],
        [0.1, 0.4],
      ],
      [
        [0.5, 0],
        [0.2, 0.3],
      ],
      [
        [0.3, 0.2, 0.0],
        [0.0, 0.2, 0.3],
      ],
    ]) {
      expect(mutualInformation(joint).mutualInformation).toBeGreaterThan(1e-3);
    }
  });

  it('conditioning cannot increase entropy: H(X|Y) ≤ H(X)', () => {
    for (const joint of cases) {
      const mi = mutualInformation(joint);
      expect(mi.hxGivenY).toBeLessThanOrEqual(mi.hx + 1e-12);
      expect(mi.hyGivenX).toBeLessThanOrEqual(mi.hy + 1e-12);
    }
  });

  it('variation of information is a metric: symmetric, zero only for identical partitions', () => {
    for (const joint of cases) {
      const a = mutualInformation(joint);
      const b = mutualInformation(transpose(joint));
      expect(a.variationOfInformation).toBeCloseTo(b.variationOfInformation, 12);
      expect(a.variationOfInformation).toBeGreaterThanOrEqual(0);
      expect(a.normalisedVariationOfInformation).toBeLessThanOrEqual(1 + 1e-12);
      // VI = H(X,Y) − I(X;Y) ... check the other standard identity too.
      expect(a.variationOfInformation).toBeCloseTo(a.hxy - a.mutualInformation, 12);
    }
    const identical = [
      [0.5, 0],
      [0, 0.5],
    ];
    expect(mutualInformation(identical).variationOfInformation).toBe(0);
  });

  it('conditional entropy from a joint table matches the long-hand computation', () => {
    for (const joint of cases) {
      expect(conditionalEntropy(joint).value).toBeCloseTo(conditionalEntropyLongWay(joint), 12);
    }
  });

  it('cross-entropy = entropy + KL divergence', () => {
    const rngCe = new Random('cross-entropy');
    for (let t = 0; t < 20; t++) {
      const k = 3 + (t % 4);
      const p = randomVector(rngCe, k);
      const q = randomVector(rngCe, k);
      const ce = crossEntropy(p, q);
      const kl = klDivergence(p, q);
      expect(ce.finite).toBe(true);
      expect(ce.value).toBeCloseTo(shannonEntropy(p).value + kl.value, 12);
    }
  });
});

/* ================================================================== */
describe('multivariate information measures', () => {
  it('total correlation is zero for a fully independent triple and positive otherwise', () => {
    const a = [0.3, 0.7];
    const b = [0.25, 0.75];
    const c = [0.4, 0.6];
    const indep = a.map((x) => b.map((y) => c.map((z) => x * y * z)));
    expect(totalCorrelation(indep).value).toBeLessThan(1e-15);
    // Three copies of the same fair bit: C = 3H − H = 2 bits exactly.
    const copies = [
      [
        [0.5, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [0, 0.5],
      ],
    ];
    expect(totalCorrelation(copies).value).toBeCloseTo(2, 12);
  });

  it('XOR has zero pairwise mutual information but positive conditional mutual information', () => {
    // X, Y fair independent bits; Z = X XOR Y. Every pair is independent, yet
    // I(X;Y|Z) = 1 bit. This is the textbook synergy example.
    const j: number[][][] = [
      [
        [0.25, 0],
        [0, 0.25],
      ],
      [
        [0, 0.25],
        [0.25, 0],
      ],
    ];
    expect(mutualInformation([
      [0.25 + 0, 0 + 0.25],
      [0 + 0.25, 0.25 + 0],
    ]).mutualInformation).toBe(0);
    expect(conditionalMutualInformation(j).value).toBeCloseTo(1, 12);
    // Interaction information = I(X;Y|Z) − I(X;Y) = 1 bit: pure synergy.
    expect(interactionInformation(j).value).toBeCloseTo(1, 12);
  });

  it('conditional mutual information is zero under conditional independence', () => {
    // Z chooses which of two independent-given-Z blocks we are in.
    const j: number[][][] = [
      [
        [0.09, 0.21],
        [0.21, 0.49],
      ],
      [
        [0.04, 0.06],
        [0.06, 0.09],
      ],
    ];
    const flat = j.flat(2);
    const s = stableSum(flat);
    const normed = j.map((za) => za.map((row) => row.map((v) => v / s)));
    // Re-layout as axes (X, Y, Z): the array above is (Z, X, Y), so permute.
    const byXYZ: number[][][] = [0, 1].map((x) => [0, 1].map((y) => [0, 1].map((z) => normed[z][x][y])));
    expect(conditionalMutualInformation(byXYZ).value).toBeLessThan(1e-12);
  });

  it('refuses a conditional mutual information request with the wrong number of axes', () => {
    expect(() => conditionalMutualInformation([[0.5, 0.5]])).toThrow(EngineError);
    expect(() => conditionalMutualInformation([[0.5, 0.5]])).toThrow(/3-dimensional/);
  });

  it('ranks candidate measurements by information gain', () => {
    const informative = [
      [0.45, 0.05],
      [0.05, 0.45],
    ];
    const useless = [
      [0.25, 0.25],
      [0.25, 0.25],
    ];
    const middling = [
      [0.3, 0.2],
      [0.2, 0.3],
    ];
    const r = rankInformationGain([
      { name: 'useless', joint: useless },
      { name: 'informative', joint: informative },
      { name: 'middling', joint: middling },
    ]);
    expect(r.ranking.map((x) => x.name)).toEqual(['informative', 'middling', 'useless']);
    expect(r.targetEntropy).toBe(1);
    expect(r.ranking[2].gain).toBe(0);
    expect(r.ranking[0].residualEntropy).toBeLessThan(r.ranking[2].residualEntropy);
  });

  it('refuses to rank candidates implying different target entropies', () => {
    expect(() =>
      rankInformationGain([
        { name: 'a', joint: [[0.5, 0.5]] },
        {
          name: 'b',
          joint: [
            [0.25, 0.25],
            [0.25, 0.25],
          ],
        },
      ]),
    ).toThrow(/target marginal/);
  });
});

/* ================================================================== */
describe('generalised entropies', () => {
  it('Rényi special cases match their closed forms', () => {
    const p = [0.5, 0.25, 0.125, 0.125];
    // H₀ = log2(4) = 2 (support size, probabilities ignored).
    expect(renyiEntropy(p, 0).value).toBeCloseTo(2, 14);
    // H₁ = Shannon = 0.5·1 + 0.25·2 + 2·0.125·3 = 1.75 bits exactly.
    expect(renyiEntropy(p, 1).value).toBeCloseTo(1.75, 14);
    expect(shannonEntropy(p).value).toBeCloseTo(1.75, 14);
    // H₂ = −log2(Σp²) = −log2(0.25 + 0.0625 + 2·0.015625) = −log2(0.34375).
    expect(renyiEntropy(p, 2).value).toBeCloseTo(-Math.log2(0.34375), 13);
    expect(collisionEntropy(p).value).toBeCloseTo(-Math.log2(0.34375), 13);
    // H_∞ = −log2(0.5) = 1.
    expect(renyiEntropy(p, Infinity).value).toBeCloseTo(1, 14);
    expect(minEntropy(p).value).toBeCloseTo(1, 14);
    expect(hartleyEntropy(p).value).toBeCloseTo(2, 14);
  });

  it('Rényi entropy is non-increasing in α', () => {
    const rng = new Random('renyi-monotone');
    for (let t = 0; t < 8; t++) {
      const p = randomVector(rng, 6);
      let prev = Infinity;
      for (const a of [0, 0.25, 0.5, 0.9, 1, 1.5, 2, 4, 10, Infinity]) {
        const h = renyiEntropy(p, a).value;
        expect(h).toBeLessThanOrEqual(prev + 1e-10);
        prev = h;
      }
    }
  });

  it('Tsallis entropy tends to the Shannon entropy as q → 1', () => {
    const p = [0.2, 0.3, 0.5];
    const shannon = shannonEntropy(p, { base: 'nats' }).value;
    // The q-limit is approached linearly in (q − 1); at q = 1.0001 the gap is
    // O(1e-4), hence the loose comparison at 4 decimal places.
    expect(tsallisEntropy(p, 1.0001, { base: 'nats' }).value).toBeCloseTo(shannon, 3);
    expect(tsallisEntropy(p, 1, { base: 'nats' }).value).toBeCloseTo(shannon, 14);
    // q = 2: S₂ = 1 − Σp² = 1 − 0.38 = 0.62 in the natural scaling.
    expect(tsallisEntropy(p, 2, { base: 'nats' }).value).toBeCloseTo(1 - (0.04 + 0.09 + 0.25), 14);
  });

  it('perplexity of a fair k-sided die is exactly k', () => {
    for (const k of [2, 4, 6, 10]) expect(perplexity(new Array<number>(k).fill(1 / k))).toBeCloseTo(k, 10);
  });

  it('refuses a negative Rényi order', () => {
    expect(() => renyiEntropy([0.5, 0.5], -1)).toThrow(/α must be a number ≥ 0/);
  });
});

/* ================================================================== */
describe('KL divergence properties', () => {
  const rng = new Random('kl-properties');

  it('D(P‖P) = 0 exactly', () => {
    for (let t = 0; t < 30; t++) {
      const p = randomVector(rng, 2 + (t % 6));
      const d = klDivergence(p, p);
      expect(d.value).toBe(0);
      expect(d.reverse).toBe(0);
      expect(d.symmetric).toBe(true);
    }
  });

  it('D ≥ 0 always (Gibbs’ inequality)', () => {
    for (let t = 0; t < 200; t++) {
      const k = 2 + (t % 7);
      const p = randomVector(rng, k);
      const q = randomVector(rng, k);
      const d = klDivergence(p, q);
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.reverse).toBeGreaterThanOrEqual(0);
    }
  });

  it('is ASYMMETRIC: D(P‖Q) ≠ D(Q‖P)', () => {
    const p = [0.9, 0.1];
    const q = [0.5, 0.5];
    const forward = klDivergence(p, q);
    const backward = klDivergence(q, p);
    expect(forward.value).not.toBeCloseTo(backward.value, 6);
    expect(forward.reverse).toBeCloseTo(backward.value, 14);
    expect(forward.symmetric).toBe(false);
    expect(forward.direction).toContain('P ‖ Q');
    // Hand-computed: D(P‖Q) = 0.9log2(1.8) + 0.1log2(0.2) = 0.531 bits (3 dp).
    expect(forward.value).toBeCloseTo(0.9 * Math.log2(1.8) + 0.1 * Math.log2(0.2), 14);
    expect(backward.value).toBeCloseTo(0.5 * Math.log2(0.5 / 0.9) + 0.5 * Math.log2(0.5 / 0.1), 14);
    // The asymmetry is substantial here, not a rounding artefact.
    expect(Math.abs(forward.value - backward.value)).toBeGreaterThan(0.1);
  });

  it('reports a zero-support violation instead of returning a finite number', () => {
    const d = klDivergence([0.5, 0.5], [1, 0]);
    expect(d.finite).toBe(false);
    expect(d.value).toBe(Infinity);
    expect(d.offendingIndices).toEqual([1]);
    expect(d.infiniteReason).toMatch(/zero probability/);
    // The reverse direction IS finite here: direction matters. D(Q‖P) =
    // 1·log₂(1/0.5) = 1 bit exactly.
    expect(d.reverseFinite).toBe(true);
    expect(d.reverse).toBe(1);
  });

  it('reports a zero-support violation in a closed-form family too', () => {
    expect(() => closedFormKl('bernoulli', { p: 0.3 }, { p: 0 })).toThrow(/infinite/);
    expect(() => closedFormKl('bernoulli', { p: 0.3 }, { p: 1 })).toThrow(/infinite/);
    // Q = 0 where P = 0 as well is fine.
    expect(closedFormKl('bernoulli', { p: 0 }, { p: 0.4 }).nats).toBeCloseTo(-Math.log(0.6), 14);
  });

  it('cross-entropy reports its own infinite case', () => {
    const ce = crossEntropy([0.5, 0.5], [1, 0]);
    expect(ce.finite).toBe(false);
    expect(ce.value).toBe(Infinity);
    expect(ce.offendingIndices).toEqual([1]);
  });
});

/* ================================================================== */
describe('symmetric divergences and their inequalities', () => {
  const rng = new Random('symmetric-divergences');

  it('JSD is symmetric and bounded by 1 bit', () => {
    for (let t = 0; t < 100; t++) {
      const k = 2 + (t % 6);
      const p = randomVector(rng, k);
      const q = randomVector(rng, k);
      const ab = jensenShannonDivergence(p, q);
      const ba = jensenShannonDivergence(q, p);
      expect(ab.value).toBeCloseTo(ba.value, 14);
      expect(ab.value).toBeGreaterThanOrEqual(0);
      expect(ab.value).toBeLessThanOrEqual(1 + 1e-15);
      expect(ab.upperBound).toBe(1);
      expect(ab.distance).toBeCloseTo(Math.sqrt(ab.value), 14);
    }
    // Disjoint supports attain the bound exactly: JSD = 1 bit.
    expect(jensenShannonDivergence([1, 0], [0, 1]).value).toBeCloseTo(1, 14);
    expect(jensenShannonDivergence([0.5, 0.5], [0.5, 0.5]).value).toBe(0);
  });

  it('Pinsker’s inequality TV ≤ √(KL/2) holds on many random pairs', () => {
    for (let t = 0; t < 500; t++) {
      const k = 2 + (t % 8);
      const p = randomVector(rng, k);
      const q = randomVector(rng, k);
      const b = divergenceBounds(p, q);
      expect(b.pinskerHolds).toBe(true);
      expect(b.bretagnolleHuberHolds).toBe(true);
      expect(b.hellingerSandwichHolds).toBe(true);
      expect(b.totalVariation).toBeLessThanOrEqual(Math.sqrt(b.klNats / 2) + 1e-12);
    }
  });

  it('total variation, Hellinger and Bhattacharyya take their known exact values', () => {
    // Disjoint supports: TV = 1, H = 1, BC = 0, Bhattacharyya distance infinite.
    const d = distances([1, 0], [0, 1]);
    expect(d.totalVariation).toBe(1);
    expect(d.hellinger).toBe(1);
    expect(d.bhattacharyyaCoefficient).toBe(0);
    expect(d.bhattacharyyaFinite).toBe(false);
    expect(d.chiSquaredFinite).toBe(false);
    // Identical: all zero, BC = 1.
    const same = distances([0.3, 0.7], [0.3, 0.7]);
    expect(same.totalVariation).toBe(0);
    expect(same.hellinger).toBe(0);
    expect(same.bhattacharyyaCoefficient).toBeCloseTo(1, 14);
    expect(same.bhattacharyyaDistance).toBeCloseTo(0, 14);
    expect(same.chiSquared).toBeCloseTo(0, 14);
    // Hand-computed: P = (0.5,0.5), Q = (0.25,0.75) ⇒ TV = 0.25.
    expect(distances([0.5, 0.5], [0.25, 0.75]).totalVariation).toBeCloseTo(0.25, 15);
  });

  it('Rényi divergence tends to the KL divergence as α → 1', () => {
    const p = [0.2, 0.3, 0.5];
    const q = [0.4, 0.4, 0.2];
    const kl = klDivergence(p, q).value;
    // Linear convergence in (α − 1); 4 decimal places at α = 1.0001.
    expect(renyiDivergence(p, q, 1.0001).value).toBeCloseTo(kl, 4);
    expect(renyiDivergence(p, q, 1).value).toBeCloseTo(kl, 14);
    // α = ½ is symmetric in the Bhattacharyya sense and finite for disjoint
    // supports only through its α < 1 branch.
    expect(renyiDivergence([1, 0], [0, 1], 2).finite).toBe(false);
  });

  it('Wasserstein-1 between point masses is the distance between them', () => {
    expect(wasserstein1([0], [1], [5], [1]).value).toBe(5);
    expect(wasserstein1([3], [1], [-2], [1]).value).toBe(5);
    expect(wasserstein1([7], [1], [7], [1]).value).toBe(0);
    // Identical distributions: exactly 0.
    expect(wasserstein1([0, 1, 2], [0.2, 0.3, 0.5], [0, 1, 2], [0.2, 0.3, 0.5]).value).toBe(0);
    // Hand-computable: shifting all the mass by d costs exactly d.
    expect(wasserstein1([0, 1], [0.5, 0.5], [2, 3], [0.5, 0.5]).value).toBeCloseTo(2, 14);
    // Moving half the mass one step costs 0.5.
    expect(wasserstein1([0, 1], [1, 0], [0, 1], [0.5, 0.5]).value).toBeCloseTo(0.5, 14);
  });
});

/* ================================================================== */
describe('closed-form KL divergences cross-checked against quadrature', () => {
  it('normal–normal matches the analytic formula written out independently', () => {
    for (const [m1, s1, m2, s2] of [
      [0, 1, 0, 2],
      [1, 2, -1, 1.5],
      [3, 0.5, 3, 0.5],
      [-2, 3, 4, 1],
    ]) {
      const analytic = Math.log(s2 / s1) + (s1 * s1 + (m1 - m2) ** 2) / (2 * s2 * s2) - 0.5;
      const got = closedFormKl('normal', { mu: m1, sigma: s1 }, { mu: m2, sigma: s2 });
      expect(got.nats).toBeCloseTo(Math.max(0, analytic), 14);
      // Independent numerical route: quadrature of ∫f₁ln(f₁/f₂).
      const quad = continuousKlQuadrature('normal', { mu: m1, sigma: s1 }, { mu: m2, sigma: s2 });
      // 1e-9: the tanh-sinh quadrature reaches ~1e-13 on these smooth
      // integrands, so 1e-9 is a loose bound that still excludes any
      // formula error.
      expect(got.nats).toBeCloseTo(quad, 9);
    }
  });

  it('exponential–exponential matches quadrature', () => {
    for (const [l1, l2] of [
      [1, 2],
      [3, 0.5],
      [0.25, 0.25],
    ]) {
      const analytic = Math.log(l1 / l2) + l2 / l1 - 1;
      const got = closedFormKl('exponential', { lambda: l1 }, { lambda: l2 });
      expect(got.nats).toBeCloseTo(analytic, 14);
      const quad = continuousKlQuadrature('exponential', { lambda: l1 }, { lambda: l2 });
      expect(got.nats).toBeCloseTo(quad, 9);
    }
  });

  it('gamma–gamma and beta–beta match quadrature', () => {
    const quadG = continuousKlQuadrature('gamma', { k: 2, theta: 2 }, { k: 3, theta: 1.5 });
    expect(closedFormKl('gamma', { k: 2, theta: 2 }, { k: 3, theta: 1.5 }).nats).toBeCloseTo(quadG, 8);
    const quadB = continuousKlQuadrature('beta', { alpha: 2, beta: 5 }, { alpha: 3, beta: 3 });
    expect(closedFormKl('beta', { alpha: 2, beta: 5 }, { alpha: 3, beta: 3 }).nats).toBeCloseTo(quadB, 8);
  });

  it('Poisson–Poisson matches a direct sum over the support', () => {
    for (const [l1, l2] of [
      [1, 2],
      [4, 3],
      [10, 10.5],
    ]) {
      const analytic = l2 - l1 + l1 * Math.log(l1 / l2);
      const got = closedFormKl('poisson', { lambda: l1 }, { lambda: l2 });
      expect(got.nats).toBeCloseTo(analytic, 14);
      // Direct sum Σ_k p(k) ln[p(k)/q(k)] out to where the mass is exhausted.
      const def = getDistribution('poisson');
      const terms: number[] = [];
      for (let k = 0; k <= 200; k++) {
        const pk = def.pdf(k, { lambda: l1 });
        if (pk <= 0) continue;
        terms.push(pk * (def.logPdf(k, { lambda: l1 }) - def.logPdf(k, { lambda: l2 })));
      }
      // 1e-10: the truncation at k = 200 leaves < 1e-100 of the mass for these
      // rates, so the only error is double rounding over 200 terms.
      expect(got.nats).toBeCloseTo(stableSum(terms), 10);
    }
  });

  it('Bernoulli–Bernoulli matches the discrete KL on two outcomes', () => {
    for (const [p1, p2] of [
      [0.3, 0.6],
      [0.9, 0.1],
      [0.5, 0.5],
    ]) {
      const got = closedFormKl('bernoulli', { p: p1 }, { p: p2 });
      const discrete = klDivergence([1 - p1, p1], [1 - p2, p2], { base: 'nats' });
      expect(got.nats).toBeCloseTo(discrete.value, 14);
    }
  });

  it('Dirichlet KL is zero for identical parameters and positive otherwise', () => {
    expect(dirichletKl([2, 3, 4], [2, 3, 4]).nats).toBeCloseTo(0, 12);
    expect(dirichletKl([2, 3, 4], [1, 1, 1]).nats).toBeGreaterThan(0);
    // Cross-check against the formula written out here independently.
    const a = [2, 3, 4];
    const b = [1, 1, 1];
    const s1 = 9;
    const s2 = 3;
    // digamma via a high-order finite difference of logGamma is enough for a
    // 1e-6 cross-check and uses a completely different code path.
    const h = 1e-5;
    const dg = (x: number) => (logGamma(x + h) - logGamma(x - h)) / (2 * h);
    let expected = logGamma(s1) - logGamma(s2);
    for (let i = 0; i < 3; i++) expected += logGamma(b[i]) - logGamma(a[i]) + (a[i] - b[i]) * (dg(a[i]) - dg(s1));
    expect(dirichletKl(a, b).nats).toBeCloseTo(expected, 6);
  });

  it('refuses an unsupported family and a mismatched Dirichlet dimension', () => {
    expect(() => closedFormKl('weibull', { k: 1 }, { k: 2 })).toThrow(/No closed-form KL/);
    expect(() => closedFormKl('dirichlet', {}, {})).toThrow(/dirichletKl/);
    expect(() => dirichletKl([1, 2], [1, 2, 3])).toThrow(/same dimension/);
  });
});

/* ================================================================== */
describe('differential entropy', () => {
  it('the normal closed form ½ln(2πeσ²) matches quadrature', () => {
    for (const sigma of [0.5, 1, 2, 5]) {
      const expected = 0.5 * Math.log(2 * Math.PI * Math.E * sigma * sigma);
      const r = differentialEntropy('normal', { mu: 0, sigma }, { base: 'nats' });
      expect(r.value).toBeCloseTo(expected, 14);
      expect(r.exactness).toBe('exact');
      // The two routes agree to ~1e-14; 1e-9 is a safe assertion.
      expect(r.quadrature as number).toBeCloseTo(expected, 9);
      // Differential entropy shifts by ln σ under scaling — the
      // reparameterisation sensitivity, asserted rather than just documented.
      const scaled = differentialEntropy('normal', { mu: 0, sigma: sigma * 3 }, { base: 'nats' });
      expect(scaled.value - r.value).toBeCloseTo(Math.log(3), 12);
    }
  });

  it('the exponential closed form 1 − ln λ matches quadrature', () => {
    for (const lambda of [0.5, 1, 3, 10]) {
      const expected = 1 - Math.log(lambda);
      const r = differentialEntropy('exponential', { lambda }, { base: 'nats' });
      expect(r.value).toBeCloseTo(expected, 14);
      expect(r.quadrature as number).toBeCloseTo(expected, 9);
    }
  });

  it('the uniform closed form ln(b − a) matches quadrature', () => {
    for (const [a, b] of [
      [0, 1],
      [0, 10],
      [-3, 4],
    ]) {
      const r = differentialEntropy('uniform', { a, b }, { base: 'nats' });
      expect(r.value).toBeCloseTo(Math.log(b - a), 14);
      expect(r.quadrature as number).toBeCloseTo(Math.log(b - a), 9);
    }
  });

  it('is returned NEGATIVE when it is negative, never clamped', () => {
    // Uniform on [0, 0.5]: h = ln 0.5 = −0.693…
    const r = differentialEntropy('uniform', { a: 0, b: 0.5 }, { base: 'nats' });
    expect(r.value).toBeCloseTo(Math.log(0.5), 14);
    expect(r.value).toBeLessThan(0);
    expect(r.negative).toBe(true);
    // In bits too.
    expect(differentialEntropy('uniform', { a: 0, b: 0.5 }, { base: 'bits' }).value).toBeCloseTo(-1, 14);
    // A narrow normal is negative as well: ½ln(2πe·0.01) < 0.
    const narrow = differentialEntropy('normal', { mu: 0, sigma: 0.1 }, { base: 'nats' });
    expect(narrow.value).toBeLessThan(0);
    expect(narrow.value).toBeCloseTo(0.5 * Math.log(2 * Math.PI * Math.E * 0.01), 14);
    // An exponential with a high rate is negative.
    expect(differentialEntropy('exponential', { lambda: 10 }, { base: 'nats' }).value).toBeLessThan(0);
  });

  it('states the non-limit, negativity and reparameterisation caveats', () => {
    const lims = differentialEntropy('normal', { mu: 0, sigma: 1 }).explanation.limitations.join(' ');
    expect(lims).toMatch(/NOT the limit/);
    expect(lims).toMatch(/CAN BE NEGATIVE/);
    expect(lims).toMatch(/NOT invariant under reparameterisation/);
  });

  it('agrees with quadrature for every continuous registry distribution that has a closed form', () => {
    const cases: [string, Record<string, number>][] = [
      ['gamma', { k: 2, theta: 2 }],
      ['beta', { alpha: 2, beta: 5 }],
      ['lognormal', { mu: 0, sigma: 0.5 }],
      ['weibull', { k: 1.5, lambda: 1 }],
      ['cauchy', { x0: 0, gamma: 1 }],
      ['pareto', { xm: 1, alpha: 2.5 }],
      ['chiSquare', { k: 3 }],
      ['studentT', { nu: 5, mu: 0, sigma: 1 }],
    ];
    for (const [id, params] of cases) {
      const r = differentialEntropy(id, params, { base: 'nats' });
      expect(r.exactness).toBe('exact');
      // 1e-9: measured agreement is ~1e-14 for these smooth densities.
      expect(r.value).toBeCloseTo(r.quadrature as number, 9);
    }
    // The triangular density has a kink, so the Gauss–Legendre panels straddle
    // a derivative discontinuity and the agreement is only ~1e-6. Asserted at
    // that level rather than weakening the smooth cases.
    const tri = differentialEntropy('triangular', { a: 2, c: 4, b: 9 }, { base: 'nats' });
    expect(tri.value).toBeCloseTo(0.5 + Math.log((9 - 2) / 2), 14);
    expect(tri.value).toBeCloseTo(tri.quadrature as number, 5);
  });

  it('falls back to quadrature, labelled numerical, where no closed form exists', () => {
    const r = differentialEntropy('pert', { a: 2, m: 4, b: 9 }, { base: 'nats' });
    expect(r.exactness).toBe('numerical');
    expect(Number.isFinite(r.value)).toBe(true);
    // A PERT on [2, 9] is a scaled beta; its entropy must be below the
    // maximum-entropy value ln(9 − 2) for that support.
    expect(r.value).toBeLessThan(Math.log(7));
  });

  it('refuses a differential entropy for a discrete distribution', () => {
    expect(() => differentialEntropy('poisson', { lambda: 3 })).toThrow(/discrete/);
    expect(() => differentialEntropyQuadrature('binomial', { n: 10, p: 0.5 })).toThrow(EngineError);
  });
});

/* ================================================================== */
describe('maximum entropy under moment constraints', () => {
  it('with no constraint on a finite set the solution is the uniform distribution', () => {
    const r = maximumEntropyDistribution(discreteSupport([1, 2, 3, 4, 5]), []);
    for (const p of r.probabilities) expect(p).toBeCloseTo(0.2, 15);
    expect(r.entropy).toBeCloseTo(Math.log2(5), 13);
    expect(r.converged).toBe(true);
    const closed = maximumEntropyClosedForm('none-on-finite-set', { outcomes: 5 });
    expect('probability' in closed ? closed.probability : 0).toBeCloseTo(0.2, 15);
  });

  it('with only a mean constraint on [0, ∞) the solution is the exponential', () => {
    const mean = 2;
    // Grid to 40 means at rate 0.5 the omitted tail mass is e^{−20} ≈ 2e-9.
    const r = maximumEntropyDistribution(midpointGrid(0, 80, 8000), [{ name: 'mean', f: (x) => x, target: mean }], {
      tolerance: 1e-11,
    });
    expect(r.converged).toBe(true);
    expect(r.maxMomentError).toBeLessThan(1e-9);
    // The exponential-family multiplier must be −1/mean = −0.5. The midpoint
    // grid of width h = 0.01 introduces an O(h²) ≈ 1e-4 relative error, so 1e-4
    // relative is the honest tolerance.
    expect(r.lambdas[0]).toBeCloseTo(-1 / mean, 4);
    const def = getDistribution('exponential');
    let worst = 0;
    for (let i = 0; i < r.support.length; i++) {
      const want = def.pdf(r.support[i], { lambda: 1 / mean });
      if (want > 1e-6) worst = Math.max(worst, Math.abs(r.density[i] - want) / want);
    }
    // Measured worst relative density error is ~2.4e-5; 1e-3 is a safe bound
    // that still rules out recovering any other family.
    expect(worst).toBeLessThan(1e-3);
    const closed = maximumEntropyClosedForm('mean-on-positive-halfline', { mean });
    expect('distributionId' in closed ? closed.distributionId : '').toBe('exponential');
    expect('params' in closed ? closed.params.lambda : 0).toBeCloseTo(0.5, 15);
  });

  it('with a mean and variance on (−∞, ∞) the solution is the normal', () => {
    const mu = 1;
    const sd = 2;
    const r = maximumEntropyDistribution(
      midpointGrid(mu - 12 * sd, mu + 12 * sd, 9600),
      [
        { name: 'mean', f: (x) => x, target: mu },
        { name: 'second moment', f: (x) => x * x, target: mu * mu + sd * sd },
      ],
      { tolerance: 1e-11 },
    );
    expect(r.converged).toBe(true);
    // p ∝ exp(λ₁x + λ₂x²) is normal with σ² = −1/(2λ₂) and μ = −λ₁/(2λ₂).
    expect(r.lambdas[1]).toBeCloseTo(-1 / (2 * sd * sd), 10);
    expect(-r.lambdas[0] / (2 * r.lambdas[1])).toBeCloseTo(mu, 9);
    expect(Math.sqrt(-1 / (2 * r.lambdas[1]))).toBeCloseTo(sd, 9);
    let worst = 0;
    for (let i = 0; i < r.support.length; i++) {
      worst = Math.max(worst, Math.abs(r.density[i] - normalPdf((r.support[i] - mu) / sd) / sd));
    }
    // Measured worst absolute density error ~9e-15 on this grid.
    expect(worst).toBeLessThan(1e-10);
    const closed = maximumEntropyClosedForm('mean-and-variance-on-reals', { mean: mu, variance: sd * sd });
    expect('distributionId' in closed ? closed.distributionId : '').toBe('normal');
    expect('params' in closed ? closed.params.sigma : 0).toBeCloseTo(2, 15);
  });

  it('matches a known discrete answer: mean constraint on {0,1} gives Bernoulli(mean)', () => {
    const r = maximumEntropyDistribution(discreteSupport([0, 1]), [{ name: 'mean', f: (x) => x, target: 0.3 }]);
    expect(r.probabilities[0]).toBeCloseTo(0.7, 10);
    expect(r.probabilities[1]).toBeCloseTo(0.3, 10);
    expect(r.entropy).toBeCloseTo(shannonEntropy([0.7, 0.3]).value, 10);
  });

  it('refuses an infeasible moment constraint instead of returning a near-miss', () => {
    expect(() =>
      maximumEntropyDistribution(discreteSupport([0, 1, 2]), [{ name: 'mean', f: (x) => x, target: 5 }]),
    ).toThrow(/infeasible/);
    expect(() =>
      maximumEntropyDistribution(midpointGrid(0, 1, 100), [{ name: 'mean', f: (x) => x, target: -3 }]),
    ).toThrow(/infeasible/);
  });

  it('refuses contradictory duplicate constraints rather than returning a compromise', () => {
    // The same statistic constrained to two different values has no solution,
    // although each target is individually feasible, so the feasibility check
    // cannot catch it and the solver must refuse.
    expect(() =>
      maximumEntropyDistribution(discreteSupport([0, 1, 2, 3]), [
        { name: 'mean', f: (x) => x, target: 1.5 },
        { name: 'mean again', f: (x) => x, target: 2.5 },
      ]),
    ).toThrow(EngineError);
    // A consistent duplicate is harmless and still reaches the right answer.
    const r = maximumEntropyDistribution(discreteSupport([0, 1, 2, 3]), [
      { name: 'mean', f: (x) => x, target: 1.5 },
      { name: 'mean again', f: (x) => x, target: 1.5 },
    ]);
    expect(r.achieved[0]).toBeCloseTo(1.5, 8);
    for (const p of r.probabilities) expect(p).toBeCloseTo(0.25, 6);
  });
});

/* ================================================================== */
describe('entropy estimation from data and its bias', () => {
  it('the plug-in estimator is biased DOWNWARD and the corrections reduce the bias', () => {
    const k = 10;
    const n = 20;
    const trueEntropyBits = Math.log2(k);
    const rng = new Random('entropy-bias-2024');
    const reps = 500;
    const names = ['plug-in (maximum likelihood)', 'Miller–Madow', 'Grassberger', 'Chao–Shen'];
    const sums = new Map<string, number>(names.map((x) => [x, 0]));
    const finiteCount = new Map<string, number>(names.map((x) => [x, 0]));
    for (let r = 0; r < reps; r++) {
      const counts = new Array<number>(k).fill(0);
      for (let i = 0; i < n; i++) counts[rng.int(0, k - 1)] += 1;
      const est = estimateEntropy(counts, { alphabetSize: k });
      for (const e of est.estimates) {
        if (!names.includes(e.name) || !Number.isFinite(e.value)) continue;
        sums.set(e.name, (sums.get(e.name) as number) + e.value);
        finiteCount.set(e.name, (finiteCount.get(e.name) as number) + 1);
      }
    }
    const meanOf = (name: string) => (sums.get(name) as number) / (finiteCount.get(name) as number);
    const plugIn = meanOf('plug-in (maximum likelihood)');
    // The plug-in bias at n = 20, k = 10 is about −(k−1)/(2n) nats = −0.32 bits,
    // far larger than the Monte Carlo standard error over 500 reps (~0.01 bits).
    expect(plugIn).toBeLessThan(trueEntropyBits - 0.1);
    const plugInBias = Math.abs(plugIn - trueEntropyBits);
    for (const corrected of ['Miller–Madow', 'Grassberger']) {
      const bias = Math.abs(meanOf(corrected) - trueEntropyBits);
      // "Materially smaller": at most half the plug-in bias.
      expect(bias).toBeLessThan(plugInBias * 0.5);
    }
    // The direction is reported, not merely implied.
    const one = estimateEntropy(new Array<number>(k).fill(2), { alphabetSize: k });
    expect(one.estimates[0].biasDirection).toBe('underestimates');
    expect(one.estimates[0].note).toMatch(/DOWNWARD/);
    expect(one.exactness).toBe('empirical');
  });

  it('a large sample from a known distribution recovers its entropy', () => {
    const rng = new Random('entropy-large-sample');
    const k = 4;
    const counts = new Array<number>(k).fill(0);
    const n = 200000;
    for (let i = 0; i < n; i++) counts[rng.int(0, k - 1)] += 1;
    const est = estimateEntropy(counts, { alphabetSize: k });
    for (const e of est.estimates) {
      if (!Number.isFinite(e.value)) continue;
      // With n = 2e5 over 4 outcomes every estimator should be within 0.001
      // bits of log₂4 = 2.
      expect(e.value).toBeCloseTo(2, 2);
    }
  });

  it('reports Chao–Shen as unavailable rather than inventing a value when coverage is zero', () => {
    const est = estimateEntropy([1, 1, 1, 1, 1]);
    const cs = est.estimates.find((e) => e.name === 'Chao–Shen');
    expect(cs).toBeDefined();
    expect(Number.isNaN(cs?.value as number)).toBe(true);
    expect(cs?.note).toMatch(/Not available/);
  });

  it('warns that an unsupplied alphabet size makes the corrections too small', () => {
    const est = estimateEntropy([5, 3, 2]);
    expect(est.explanation.limitations.join(' ')).toMatch(/alphabet size was not supplied/);
    expect(est.assumedAlphabetSize).toBeUndefined();
  });

  it('tallies samples and refuses bad counts', () => {
    const t = tally(['a', 'b', 'a', 'c', 'a']);
    expect(t.counts.reduce((x, y) => x + y, 0)).toBe(5);
    expect(t.counts[t.labels.indexOf('a')]).toBe(3);
    expect(() => estimateEntropy([1, -2])).toThrow(/non-negative whole number/);
    expect(() => estimateEntropy([1.5, 2])).toThrow(/whole number/);
    expect(() => estimateEntropy([0, 0, 0])).toThrow(/no data/);
    expect(() => estimateEntropy([5, 5], { alphabetSize: 1 })).toThrow(/at least as large/);
  });
});

/* ================================================================== */
describe('mutual-information estimation and the permutation test', () => {
  it('estimated MI is POSITIVE even for genuinely independent data', () => {
    const rng = new Random('mi-independent-positive');
    const n = 100;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(rng.int(0, 2));
      ys.push(rng.int(0, 2));
    }
    const table = contingency(xs, ys);
    const est = estimateMutualInformation(table.counts);
    // This is the whole point: the plug-in estimate is strictly above zero
    // despite true independence.
    expect(est.plugIn).toBeGreaterThan(0);
    expect(est.biasDirection).toBe('overestimates');
    expect(est.correction).toBeLessThan(0);
  });

  it('the permutation test is calibrated: it rejects independent data at about 5%', () => {
    const rng = new Random('mi-permutation-calibration');
    const trials = 200;
    const n = 100;
    let rejections = 0;
    for (let t = 0; t < trials; t++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < n; i++) {
        xs.push(rng.int(0, 2));
        ys.push(rng.int(0, 2));
      }
      const table = contingency(xs, ys);
      const est = estimateMutualInformation(table.counts, { permutations: 199, seed: `perm-${t}`, alpha: 0.05 });
      if (est.permutation?.reject) rejections += 1;
    }
    const rate = rejections / trials;
    // The nominal rate is 5%. With 200 trials the binomial standard error is
    // √(0.05·0.95/200) ≈ 1.5%, so 12% is roughly 4.6 standard errors above
    // nominal — a bound a calibrated test passes comfortably and a broken one
    // (which would reject most of the time) fails.
    expect(rate).toBeLessThan(0.12);
    // And the null mean MI is clearly positive, which is why the test is needed.
    const example = estimateMutualInformation(
      contingency([0, 1, 2, 0, 1, 2, 0, 1, 2, 1], [0, 1, 2, 1, 2, 0, 2, 0, 1, 1]).counts,
      { permutations: 299, seed: 'null-mean' },
    );
    expect(example.permutation?.nullMean as number).toBeGreaterThan(0);
  });

  it('the permutation test rejects clearly dependent data', () => {
    const rng = new Random('mi-permutation-dependent');
    const n = 150;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = rng.int(0, 2);
      xs.push(x);
      // y equals x 85% of the time: a strong but not deterministic dependence.
      ys.push(rng.uniform() < 0.85 ? x : rng.int(0, 2));
    }
    const est = estimateMutualInformation(contingency(xs, ys).counts, {
      permutations: 499,
      seed: 'dependent',
      alpha: 0.05,
    });
    expect(est.permutation?.reject).toBe(true);
    expect(est.permutation?.pValue as number).toBeLessThanOrEqual(0.05);
    expect(est.plugIn).toBeGreaterThan(est.permutation?.null95 as number);
  });

  it('plug-in MI of a contingency table matches the exact MI of its frequencies', () => {
    const table = [
      [20, 5],
      [5, 20],
    ];
    const n = 50;
    const exact = mutualInformation(table.map((r) => r.map((v) => v / n)), { base: 'nats' });
    expect(plugInMutualInformationNats(table)).toBeCloseTo(exact.mutualInformation, 12);
  });

  it('refuses malformed contingency tables', () => {
    expect(() => estimateMutualInformation([[1, 2], [3]])).toThrow(/entries but row 0/);
    expect(() => estimateMutualInformation([[1, -1]])).toThrow(/non-negative whole numbers/);
    expect(() => estimateMutualInformation([[0, 0]])).toThrow(/zero/);
    expect(() => contingency([1, 2], [1])).toThrow(/equal length/);
  });
});

/* ================================================================== */
describe('continuous mutual information', () => {
  it('binned MI reports its sensitivity to the bin count', () => {
    const rng = new Random('binned-mi');
    const n = 400;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = rng.normal();
      xs.push(x);
      ys.push(0.9 * x + Math.sqrt(1 - 0.81) * rng.normal());
    }
    const r = binnedMutualInformation(xs, ys);
    expect(r.rows.length).toBeGreaterThan(2);
    // The estimates genuinely differ across bin counts — that IS the finding,
    // and it is reported rather than hidden behind one number.
    expect(r.sensitivityRange.max - r.sensitivityRange.min).toBeGreaterThan(0);
    expect(r.explanation.limitations.join(' ')).toMatch(/DEPENDS ON THE BIN COUNT/);
    // More bins resolve more of the dependence, so MI increases with bins here.
    expect(r.rows[r.rows.length - 1].plugIn).toBeGreaterThan(r.rows[0].plugIn);
    // The true MI of a bivariate normal with ρ = 0.9 is −½ln(1 − ρ²) nats
    // = 0.8302 nats = 1.198 bits. Binning cannot exceed it by much and must
    // get within reach of it at the finest binning.
    const trueBits = (-0.5 * Math.log(1 - 0.81)) / Math.LN2;
    expect(r.rows[r.rows.length - 1].millerMadow).toBeLessThan(trueBits * 1.5);
    expect(r.rows[r.rows.length - 1].millerMadow).toBeGreaterThan(trueBits * 0.4);
  });

  it('the Kozachenko–Leonenko estimator recovers a known differential entropy', () => {
    const rng = new Random('kl-knn');
    const n = 4000;
    const xs = Array.from({ length: n }, () => rng.normal() * 2);
    const est = kozachenkoLeonenkoEntropy(xs, { base: 'nats', k: 4 });
    const truth = 0.5 * Math.log(2 * Math.PI * Math.E * 4);
    // A k-NN entropy estimate at n = 4000 is accurate to a few percent; 0.05
    // nats is about 2% of the 2.11-nat truth and well inside its sampling
    // error.
    expect(est.value).toBeCloseTo(truth, 1);
    expect(Math.abs(est.value - truth)).toBeLessThan(0.05);
    expect(est.exactness).toBe('empirical');
  });

  it('the KSG estimator recovers the known MI of a bivariate normal', () => {
    const rng = new Random('ksg');
    const n = 1200;
    const rho = 0.8;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = rng.normal();
      xs.push(x);
      ys.push(rho * x + Math.sqrt(1 - rho * rho) * rng.normal());
    }
    const truthNats = -0.5 * Math.log(1 - rho * rho);
    const est = ksgMutualInformation(xs, ys, { base: 'nats', k: 4 });
    // KSG at n = 1200 is good to a few percent; 0.06 nats is ~12% of the
    // 0.511-nat truth, a bound that excludes a wrong formula.
    expect(Math.abs(est.value - truthNats)).toBeLessThan(0.06);
    // Independent data: the estimate must be near zero (it may be slightly
    // negative, which is reported rather than clamped).
    const zs = Array.from({ length: n }, () => rng.normal());
    const indep = ksgMutualInformation(xs, zs, { base: 'nats', k: 4 });
    expect(Math.abs(indep.value)).toBeLessThan(0.05);
  });

  it('refuses a k-NN estimate on effectively discrete data', () => {
    expect(() => kozachenkoLeonenkoEntropy(new Array<number>(50).fill(1), { k: 3 })).toThrow(/duplicates/);
    expect(() => kozachenkoLeonenkoEntropy([1, 2], { k: 5 })).toThrow(/more than k/);
    expect(() => binnedMutualInformation([1, 2, 3], [1, 2])).toThrow(/equal length/);
    expect(() => binnedMutualInformation([1, 2], [1, 2])).toThrow(/at least 4/);
  });
});

/* ================================================================== */
describe('Brier score and the Murphy decomposition', () => {
  it('the decomposition sums to the Brier score exactly', () => {
    const rng = new Random('murphy-decomposition');
    for (let trial = 0; trial < 20; trial++) {
      const n = 300;
      const p: number[] = [];
      const o: number[] = [];
      for (let i = 0; i < n; i++) {
        // Forecasts restricted to a modest set of distinct values, as a real
        // forecaster's would be.
        const f = Math.round(rng.uniform() * 10) / 10;
        p.push(f);
        o.push(rng.uniform() < f ? 1 : 0);
      }
      const r = brierScore(p, o);
      // 1e-10 as specified; the measured residual is ~1e-17.
      expect(r.decompositionResidual).toBeLessThan(1e-10);
      expect(r.decompositionExact).toBe(true);
      expect(r.reliability - r.resolution + r.uncertainty).toBeCloseTo(r.brierScore, 10);
      // Binning by distinct forecast value makes the within-bin term vanish
      // identically. The residue is pure double rounding: the bin mean p̄ is
      // recomputed as a sum/count and differs from p by ~1e-17, so 1e-15 is
      // the floor here, against a Brier score of order 0.1.
      expect(Math.abs(r.withinBinTerm)).toBeLessThan(1e-15);
    }
  });

  it('a perfect forecast has Brier score 0 and perfect resolution', () => {
    const p = [1, 0, 1, 1, 0, 0];
    const o = [1, 0, 1, 1, 0, 0];
    const r = brierScore(p, o);
    expect(r.brierScore).toBe(0);
    expect(r.reliability).toBe(0);
    // With a perfect forecast the resolution equals the uncertainty exactly.
    expect(r.resolution).toBeCloseTo(r.uncertainty, 15);
  });

  it('a perfectly calibrated forecast has reliability ≈ 0', () => {
    // 1000 forecasts of 0.3 with exactly 300 events, and 1000 of 0.8 with
    // exactly 800: calibration is exact by construction, so reliability is 0.
    const p: number[] = [];
    const o: number[] = [];
    for (let i = 0; i < 1000; i++) {
      p.push(0.3);
      o.push(i < 300 ? 1 : 0);
    }
    for (let i = 0; i < 1000; i++) {
      p.push(0.8);
      o.push(i < 800 ? 1 : 0);
    }
    const r = brierScore(p, o);
    expect(r.reliability).toBeLessThan(1e-28);
    expect(r.resolution).toBeGreaterThan(0.05);
    // The Brier score then equals uncertainty − resolution exactly.
    expect(r.brierScore).toBeCloseTo(r.uncertainty - r.resolution, 12);
  });

  it('closes the decomposition with a within-bin term when binning is coarse', () => {
    const rng = new Random('coarse-binning');
    const p: number[] = [];
    const o: number[] = [];
    for (let i = 0; i < 500; i++) {
      const f = rng.uniform();
      p.push(f);
      o.push(rng.uniform() < f ? 1 : 0);
    }
    const r = brierScore(p, o, { bins: 10 });
    expect(r.binning).toBe('fixed-bins');
    expect(Math.abs(r.withinBinTerm)).toBeGreaterThan(0);
    expect(r.decompositionResidual).toBeLessThan(1e-10);
  });

  it('refuses malformed forecast data', () => {
    expect(() => brierScore([0.5], [1, 0])).toThrow(/every forecast needs exactly one outcome/);
    expect(() => brierScore([1.5], [1])).toThrow(/not a probability/);
    expect(() => brierScore([0.5], [2])).toThrow(/must be 0 .* or 1/);
    expect(() => brierScore([], [])).toThrow(/no forecasts/);
  });
});

/* ================================================================== */
describe('logarithmic, spherical and ranked scores', () => {
  it('the log score is infinite for a confident wrong forecast and reports it', () => {
    const r = logScore([0.9, 0, 0.5], [1, 1, 0]);
    expect(r.finite).toBe(false);
    expect(r.value).toBe(Infinity);
    expect(r.offendingIndices).toEqual([1]);
    expect(r.explanation.limitations.join(' ')).toMatch(/INFINITE/);
  });

  it('clips only on request and reports the clip and its effect', () => {
    const plain = logScore([0.9, 0.5], [1, 0], { base: 'bits' });
    expect(plain.clip).toBeUndefined();
    const clipped = logScore([0.9, 0, 0.5], [1, 1, 0], { base: 'bits', clipEpsilon: 1e-4 });
    expect(clipped.finite).toBe(false);
    expect(clipped.value).toBe(Infinity);
    expect(clipped.clip?.clippedCount).toBe(1);
    expect(Number.isFinite(clipped.clip?.valueWithClip as number)).toBe(true);
    expect(clipped.clip?.effect).toMatch(/1 of 3/);
    expect(() => logScore([0.5], [1], { clipEpsilon: 0.9 })).toThrow(/clipEpsilon/);
  });

  it('matches a hand-computed value in bits and nats', () => {
    // Two forecasts: 0.8 on an event that happened, 0.3 on one that did not.
    const bits = logScore([0.8, 0.3], [1, 0], { base: 'bits' });
    const expectedBits = (-Math.log(0.8) - Math.log(0.7)) / 2 / Math.LN2;
    expect(bits.value).toBeCloseTo(expectedBits, 14);
    const nats = logScore([0.8, 0.3], [1, 0], { base: 'nats' });
    expect(nats.value).toBeCloseTo(expectedBits * Math.LN2, 14);
  });

  it('the spherical score is 1 for a perfect forecast', () => {
    const s = sphericalScore(
      [
        [1, 0, 0],
        [0, 0, 1],
      ],
      [0, 2],
    );
    expect(s.reward).toBeCloseTo(1, 14);
    expect(s.loss).toBeCloseTo(0, 14);
    // A uniform forecast over k categories scores 1/√k.
    const u = sphericalScore([[0.25, 0.25, 0.25, 0.25]], [1]);
    expect(u.reward).toBeCloseTo(1 / 2, 14);
  });

  it('RPS is 0 for a perfect ordered forecast and rewards being close', () => {
    expect(
      rankedProbabilityScore(
        [
          [1, 0, 0],
          [0, 0, 1],
        ],
        [0, 2],
      ).value,
    ).toBeCloseTo(0, 14);
    // Being one category out costs less than being two out.
    const near = rankedProbabilityScore([[0, 1, 0]], [0]).value;
    const far = rankedProbabilityScore([[0, 0, 1]], [0]).value;
    expect(near).toBeLessThan(far);
    // Hand-computed: forecast (0,1,0), outcome 0 ⇒ F_p = (0,1), F_o = (1,1)
    // ⇒ RPS = (1 + 0)/2 = 0.5.
    expect(near).toBeCloseTo(0.5, 14);
    // Forecast (0,0,1), outcome 0 ⇒ F_p = (0,0) ⇒ RPS = (1 + 1)/2 = 1.
    expect(far).toBeCloseTo(1, 14);
  });

  it('refuses an unnormalised categorical forecast, reporting the sum', () => {
    expect(() => sphericalScore([[0.5, 0.2]], [0])).toThrow(/sum to 0.7/);
    expect(() => rankedProbabilityScore([[0.5, 0.2]], [0])).toThrow(/not normalised/);
    expect(() => sphericalScore([[0.5, 0.5]], [5])).toThrow(/category index/);
  });
});

/* ================================================================== */
describe('CRPS', () => {
  it('the normal closed form matches a numerical integral of the definition', () => {
    const def = getDistribution('normal');
    for (const [mu, sigma, y] of [
      [0, 1, 0],
      [0, 1, 1.5],
      [2, 0.5, 1.2],
      [-1, 3, 4],
    ]) {
      const closed = crpsNormal(mu, sigma, y);
      const num = crpsNumerical(
        (x) => def.cdf(x, { mu, sigma }),
        y,
        Math.min(mu - 15 * sigma, y - 5 * sigma),
        Math.max(mu + 15 * sigma, y + 5 * sigma),
        20000,
      );
      // 1e-6 as specified; Simpson's rule with 20 000 panels on a smooth
      // integrand, split at the kink, reaches better than that.
      expect(closed.value).toBeCloseTo(num.value, 6);
      expect(closed.exactness).toBe('exact');
    }
  });

  it('a point forecast reduces exactly to the absolute error', () => {
    expect(crpsNormal(3, 0, 5).value).toBe(2);
    expect(crpsNormal(3, 0, 3).value).toBe(0);
    expect(crpsEnsemble([4], 7).value).toBe(3);
    // The σ → 0 limit of the closed form is |y − μ|.
    expect(crpsNormal(3, 1e-7, 5).value).toBeCloseTo(2, 6);
  });

  it('the ensemble form matches the closed form for a large normal sample', () => {
    const rng = new Random('crps-ensemble');
    const members = Array.from({ length: 4000 }, () => 2 + 1.5 * rng.normal());
    const got = crpsEnsemble(members, 3.1);
    const closed = crpsNormal(2, 1.5, 3.1);
    // The empirical-CDF CRPS converges at O(m^{-1/2}); at m = 4000 agreement
    // to 0.03 (about 3% of the 1.0 value) is the expected precision.
    expect(Math.abs(got.value - closed.value)).toBeLessThan(0.03);
    expect(got.exactness).toBe('empirical');
  });

  it('is minimised by the true predictive distribution (propriety, numerically)', () => {
    // Observations drawn from N(0,1); score candidate predictive sds.
    const rng = new Random('crps-propriety');
    const ys = Array.from({ length: 4000 }, () => rng.normal());
    let best = Infinity;
    let bestSigma = 0;
    for (const sigma of [0.5, 0.7, 0.9, 1.0, 1.1, 1.3, 1.8]) {
      const mean = stableSum(ys.map((y) => crpsNormal(0, sigma, y).value)) / ys.length;
      if (mean < best) {
        best = mean;
        bestSigma = sigma;
      }
    }
    expect(bestSigma).toBe(1.0);
  });

  it('refuses invalid CRPS inputs', () => {
    expect(() => crpsNormal(0, -1, 0)).toThrow(/standard deviation/);
    expect(() => crpsEnsemble([], 0)).toThrow(/at least one member/);
    expect(() => crpsNumerical((x) => x, 0, 1, 0)).toThrow(/upper > lower/);
  });
});

/* ================================================================== */
describe('calibration, sharpness and PIT', () => {
  it('a calibrated forecaster shows a small ECE and a well-calibrated one a large one', () => {
    const rng = new Random('calibration');
    const n = 4000;
    const good: number[] = [];
    const goodOut: number[] = [];
    const over: number[] = [];
    const overOut: number[] = [];
    for (let i = 0; i < n; i++) {
      const truth = rng.uniform();
      const happened = rng.uniform() < truth ? 1 : 0;
      good.push(truth);
      goodOut.push(happened);
      // An overconfident forecaster pushes every probability away from ½.
      over.push(Math.min(1, Math.max(0, 0.5 + 1.8 * (truth - 0.5))));
      overOut.push(happened);
    }
    const g = calibration(good, goodOut, { bins: 10 });
    const b = calibration(over, overOut, { bins: 10 });
    // The ECE of a calibrated forecaster is not 0 — it is of order
    // √(bin size)/bin size ≈ 0.025 here — so the assertion is "small", and the
    // limitation text says why.
    expect(g.ece).toBeLessThan(0.05);
    expect(b.ece).toBeGreaterThan(g.ece * 2);
    expect(g.explanation.limitations.join(' ')).toMatch(/BIASED UPWARD/);
    // Every non-empty bin has a confidence interval.
    for (const bin of g.bins) {
      if (bin.count === 0) continue;
      expect(bin.interval.low).toBeLessThanOrEqual(bin.observedFrequency + 1e-12);
      expect(bin.interval.high).toBeGreaterThanOrEqual(bin.observedFrequency - 1e-12);
    }
    expect(g.mce).toBeGreaterThanOrEqual(g.ece);
  });

  it('separates sharpness from calibration', () => {
    // A constant ½ forecaster is perfectly calibrated on a fair coin and
    // completely unsharp.
    const n = 2000;
    const p = new Array<number>(n).fill(0.5);
    const o = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0));
    const c = calibration(p, o, { bins: 10 });
    expect(c.ece).toBeLessThan(1e-12);
    expect(c.sharpness.forecastVariance).toBe(0);
    expect(c.sharpness.meanPredictiveVariance).toBeCloseTo(0.25, 15);
    expect(c.sharpness.fractionDecisive).toBe(0);
    expect(c.sharpness.note).toMatch(/subject to/i);
    // A sharp forecaster: all forecasts near 0 or 1.
    const sharp = sharpness([0.02, 0.98, 0.01, 0.99]);
    expect(sharp.forecastVariance).toBeGreaterThan(0.2);
    expect(sharp.fractionDecisive).toBe(1);
    expect(sharp.meanPredictiveVariance).toBeLessThan(0.03);
  });

  it('the PIT histogram is flat for calibrated normal forecasts and U-shaped for overconfident ones', () => {
    const rng = new Random('pit');
    const n = 3000;
    const mus: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const mu = rng.normal() * 3;
      mus.push(mu);
      ys.push(mu + rng.normal());
    }
    const calibrated = pitHistogram(normalPitValues(mus, new Array<number>(n).fill(1), ys), { bins: 10 });
    // Under calibration the χ² with 9 df has mean 9; its 99.9th percentile is
    // about 27.9, so 40 is a bound a calibrated sequence passes essentially
    // always.
    expect(calibrated.chiSquared).toBeLessThan(40);
    expect(calibrated.mean).toBeCloseTo(0.5, 1);
    expect(calibrated.variance).toBeCloseTo(1 / 12, 2);
    // Predictive sd of 0.4 instead of 1: far too narrow, so U-shaped.
    const narrow = pitHistogram(normalPitValues(mus, new Array<number>(n).fill(0.4), ys), { bins: 10 });
    expect(narrow.chiSquared).toBeGreaterThan(100);
    expect(narrow.diagnosis).toMatch(/TOO NARROW/);
    // Predictive sd of 3 instead of 1: far too wide, so hump-shaped.
    const wide = pitHistogram(normalPitValues(mus, new Array<number>(n).fill(3), ys), { bins: 10 });
    expect(wide.diagnosis).toMatch(/TOO WIDE/);
    // A biased forecaster slopes.
    const biased = pitHistogram(
      normalPitValues(mus.map((m) => m - 1.5), new Array<number>(n).fill(1), ys),
      { bins: 10 },
    );
    expect(biased.diagnosis).toMatch(/biased LOW/);
    expect(calibrated.explanation.limitations.join(' ')).toMatch(/DISCRETE/);
  });

  it('refuses PIT values outside [0,1] and bad bin counts', () => {
    expect(() => pitHistogram([0.5, 1.2])).toThrow(/outside \[0, 1\]/);
    expect(() => pitHistogram([0.5], { bins: 1 })).toThrow(/≥ 2/);
    expect(() => normalPitValues([0], [0], [0])).toThrow(/must be > 0/);
    expect(() => calibration([0.5], [1], { bins: 0 })).toThrow(/positive whole number/);
  });
});

/* ================================================================== */
describe('skill scores', () => {
  it('skill is 1 for a perfect forecast, 0 against the baseline and negative when worse', () => {
    const o = [1, 0, 1, 1, 0, 0, 1, 0];
    const clim = climatologyBrier(o);
    expect(clim.baseRate).toBe(0.5);
    expect(clim.brierScore).toBe(0.25);
    const perfect = skillScore(0, clim.brierScore, { reference: 'climatology' });
    expect(perfect.skill).toBe(1);
    const same = skillScore(clim.brierScore, clim.brierScore);
    expect(same.skill).toBe(0);
    const worse = skillScore(0.5, clim.brierScore);
    expect(worse.skill).toBe(-1);
  });

  it('a good forecaster beats climatology and a bad one does not', () => {
    const rng = new Random('skill');
    const n = 2000;
    const p: number[] = [];
    const o: number[] = [];
    for (let i = 0; i < n; i++) {
      const truth = rng.uniform() < 0.5 ? 0.15 : 0.85;
      p.push(truth);
      o.push(rng.uniform() < truth ? 1 : 0);
    }
    const bs = brierScore(p, o).brierScore;
    const clim = climatologyBrier(o);
    expect(skillScore(bs, clim.brierScore).skill).toBeGreaterThan(0.3);
    // A contrarian forecaster (reporting 1 − p) must have negative skill.
    const bad = brierScore(p.map((v) => 1 - v), o).brierScore;
    expect(skillScore(bad, clim.brierScore).skill).toBeLessThan(0);
  });

  it('refuses a degenerate baseline instead of dividing by zero', () => {
    expect(() => skillScore(0.1, 0)).toThrow(/no room for skill/);
    expect(() => skillScore(Infinity, 0.25)).toThrow(/must be finite/);
    expect(() => climatologyBrier([])).toThrow(/no outcomes/);
  });
});

/* ================================================================== */
describe('proper scoring rule verification', () => {
  it('the Brier score is minimised at the true probability', () => {
    for (const p of [0.05, 0.2, 0.35, 0.5, 0.73, 0.9]) {
      const r = verifyPropriety('brier', p, { gridPoints: 4001 });
      expect(r.optimisedAtTruth).toBe(true);
      expect(r.optimalReport).toBeCloseTo(p, 3);
      expect(r.verdict).toMatch(/behaves properly/);
      // The expected Brier score at the truth is p(1−p); the known minimum.
      expect(r.optimalScore).toBeCloseTo(p * (1 - p), 5);
    }
  });

  it('the log score is minimised at the true probability', () => {
    for (const p of [0.1, 0.25, 0.5, 0.8]) {
      const r = verifyPropriety('log', p, { gridPoints: 4001 });
      expect(r.optimisedAtTruth).toBe(true);
      expect(r.optimalReport).toBeCloseTo(p, 3);
      // The minimum expected log score is the binary entropy in nats.
      expect(r.optimalScore).toBeCloseTo(entropyNats([p, 1 - p]), 5);
    }
  });

  it('the spherical score is minimised at the true probability', () => {
    for (const p of [0.15, 0.4, 0.66]) {
      expect(verifyPropriety('spherical', p, { gridPoints: 4001 }).optimisedAtTruth).toBe(true);
    }
  });

  it('the absolute (linear) score is IMPROPER: its optimum is elsewhere', () => {
    for (const p of [0.2, 0.35, 0.65, 0.8]) {
      const r = verifyPropriety('absolute', p, { gridPoints: 4001 });
      expect(r.optimisedAtTruth).toBe(false);
      expect(r.verdict).toMatch(/IMPROPER/);
      // It pays to report the more likely outcome with certainty.
      expect(r.optimalReport).toBeCloseTo(p > 0.5 ? 1 : 0, 3);
    }
    // At p = ½ the absolute score is flat, so no optimum is distinguishable;
    // that is a degenerate case, not evidence of propriety.
    const half = verifyPropriety('absolute', 0.5, { gridPoints: 4001 });
    expect(Math.abs(half.expectedScores[0] - half.expectedScores[half.grid.length - 1])).toBeLessThan(1e-9);
  });

  it('accepts a caller-supplied rule and refuses an unknown name', () => {
    // A second improper rule: the "probability reported" bonus, maximised at 1.
    const r = verifyPropriety('custom', 0.3, { gridPoints: 1001, rule: (rep) => -rep });
    expect(r.optimisedAtTruth).toBe(false);
    expect(() => verifyPropriety('nonexistent', 0.5)).toThrow(/Unknown scoring rule/);
    expect(() => verifyPropriety('brier', 1.5)).toThrow(/must lie in \[0, 1\]/);
  });
});

/* ================================================================== */
describe('channel capacity', () => {
  it('the binary symmetric channel matches the exact capacity 1 − H(p)', () => {
    for (const p of [0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.45]) {
      const exact = 1 - entropyNats([p, 1 - p]) / Math.LN2;
      expect(binarySymmetricCapacity(p).capacity).toBeCloseTo(exact, 14);
      const ba = channelCapacity(binarySymmetricChannel(p), { tolerance: 1e-14 });
      // 1e-8 as specified; the algorithm converges to the symmetric fixed
      // point in a handful of iterations and the measured error is ~1e-16.
      expect(ba.capacity).toBeCloseTo(exact, 8);
      expect(ba.converged).toBe(true);
      // The capacity-achieving input is uniform for a symmetric channel.
      expect(ba.optimalInput[0]).toBeCloseTo(0.5, 10);
    }
    // A completely noisy BSC (p = ½) has capacity exactly 0.
    expect(binarySymmetricCapacity(0.5).capacity).toBe(0);
    expect(channelCapacity(binarySymmetricChannel(0.5)).capacity).toBeCloseTo(0, 12);
    // A noiseless BSC (p = 0) has capacity exactly 1 bit.
    expect(binarySymmetricCapacity(0).capacity).toBe(1);
  });

  it('a noiseless channel has capacity exactly log2(outputs)', () => {
    for (const k of [2, 3, 4, 8]) {
      const identity = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
      const c = channelCapacity(identity, { tolerance: 1e-14 });
      expect(c.capacity).toBeCloseTo(Math.log2(k), 10);
      for (const r of c.optimalInput) expect(r).toBeCloseTo(1 / k, 8);
    }
  });

  it('a useless channel has capacity exactly 0', () => {
    const useless = [
      [0.3, 0.7],
      [0.3, 0.7],
      [0.3, 0.7],
    ];
    const c = channelCapacity(useless, { tolerance: 1e-14 });
    expect(c.capacity).toBeCloseTo(0, 14);
  });

  it('matches the known capacity of the binary erasure channel', () => {
    // The BEC with erasure probability e has capacity 1 − e bits exactly.
    for (const e of [0.1, 0.25, 0.5, 0.75]) {
      const bec = [
        [1 - e, 0, e],
        [0, 1 - e, e],
      ];
      expect(channelCapacity(bec, { tolerance: 1e-14 }).capacity).toBeCloseTo(1 - e, 9);
    }
  });

  it('refuses a channel whose rows are not conditional distributions, reporting the sum', () => {
    expect(() => channelCapacity([[0.5, 0.2], [0.5, 0.5]])).toThrow(/sum to 0.7/);
    expect(() => channelCapacity([[0.5, 0.5], [1.2, -0.2]])).toThrow(/negative/);
    expect(() => channelCapacity([[1, 0], [0, 1, 0]])).toThrow(/same outputs/);
    expect(() => channelCapacity([])).toThrow(/no inputs/);
  });

  it('refuses to report a capacity when Blahut–Arimoto has not converged', () => {
    // A channel needing many iterations, cut off after one.
    const awkward = [
      [0.98, 0.01, 0.01],
      [0.3, 0.4, 0.3],
      [0.05, 0.05, 0.9],
    ];
    expect(() => channelCapacity(awkward, { tolerance: 1e-15, maxIterations: 1 })).toThrow(/did not converge/);
    expect(() => channelCapacity(awkward, { tolerance: 1e-15, maxIterations: 1 })).toThrow(EngineError);
    // With enough iterations it does converge, and the gap certificate is small.
    const ok = channelCapacity(awkward, { tolerance: 1e-12, maxIterations: 100000 });
    expect(ok.converged).toBe(true);
    expect(ok.boundGap).toBeLessThanOrEqual(1e-12);
    // The capacity cannot exceed log2(3) bits, nor the input entropy bound.
    expect(ok.capacity).toBeLessThan(Math.log2(3) + 1e-12);
    expect(ok.capacity).toBeGreaterThan(0);
  });

  it('the capacity equals the mutual information at the optimal input', () => {
    const channel = [
      [0.7, 0.2, 0.1],
      [0.1, 0.8, 0.1],
      [0.2, 0.1, 0.7],
    ];
    const c = channelCapacity(channel, { tolerance: 1e-14 });
    const joint = channel.map((row, x) => row.map((w) => c.optimalInput[x] * w));
    expect(mutualInformation(joint).mutualInformation).toBeCloseTo(c.capacity, 9);
  });
});

/* ================================================================== */
describe('Fisher information and the Cramér–Rao bound', () => {
  it('matches the analytic normal and Bernoulli values, and the numerical route agrees', () => {
    for (const sigma of [0.5, 1, 2]) {
      const f = fisherInformation('normal', 'mu', { mu: 0, sigma });
      expect(f.fisherInformation).toBeCloseTo(1 / (sigma * sigma), 14);
      expect(f.exactness).toBe('exact');
      // The numerical score-squared expectation is a genuinely independent
      // route; central differences give about 6 significant digits, so 1e-4
      // relative is the honest bound.
      expect(Math.abs((f.numerical as number) - 1 / (sigma * sigma))).toBeLessThan(1e-4 / (sigma * sigma));
    }
    for (const p of [0.1, 0.3, 0.5, 0.8]) {
      const f = fisherInformation('bernoulli', 'p', { p });
      expect(f.fisherInformation).toBeCloseTo(1 / (p * (1 - p)), 12);
      expect(Math.abs((f.numerical as number) - 1 / (p * (1 - p)))).toBeLessThan(1e-4 / (p * (1 - p)));
    }
    // Poisson and exponential too.
    expect(fisherInformation('poisson', 'lambda', { lambda: 4 }).fisherInformation).toBeCloseTo(0.25, 14);
    expect(fisherInformation('exponential', 'lambda', { lambda: 2 }).fisherInformation).toBeCloseTo(0.25, 14);
    const pois = fisherInformation('poisson', 'lambda', { lambda: 4 });
    expect(Math.abs((pois.numerical as number) - 0.25)).toBeLessThan(1e-5);
  });

  it('falls back to a numerical value, labelled as such, where no analytic form is coded', () => {
    const f = fisherInformation('weibull', 'lambda', { k: 1.5, lambda: 2 }, { quadraturePoints: 20000 });
    expect(f.exactness).toBe('numerical');
    // For a Weibull scale parameter the analytic value is k²/λ² = 2.25/4.
    expect(f.fisherInformation).toBeCloseTo((1.5 * 1.5) / 4, 3);
  });

  it('Cramér–Rao: an efficient estimator attains the bound', () => {
    const sigma = 2;
    const n = 25;
    const f = fisherInformation('normal', 'mu', { mu: 0, sigma });
    const bound = f.cramerRaoBound(n);
    // The sample mean of n normals is efficient: Var = σ²/n, which equals the
    // bound exactly.
    expect(bound).toBeCloseTo((sigma * sigma) / n, 14);
    // Confirmed empirically: the sampling variance of the sample mean matches
    // the bound. Over 8000 replications the relative standard error of a
    // variance estimate is √(2/8000) ≈ 1.6%, so 8% is a safe bound.
    const rng = new Random('cramer-rao');
    const means: number[] = [];
    for (let r = 0; r < 8000; r++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += sigma * rng.normal();
      means.push(s / n);
    }
    const m = stableSum(means) / means.length;
    const variance = stableSum(means.map((v) => (v - m) ** 2)) / (means.length - 1);
    expect(Math.abs(variance / bound - 1)).toBeLessThan(0.08);
    // No unbiased estimator does better: the first observation alone has
    // variance σ², which is n times the bound.
    expect(sigma * sigma).toBeGreaterThan(bound);
    expect(f.explanation.limitations.join(' ')).toMatch(/UNBIASED/);
  });

  it('the Jeffreys prior for a Bernoulli p is the Beta(½,½) arcsine density', () => {
    const j = jeffreysPrior('bernoulli', 'p', { p: 0.5 }, { lower: 0.001, upper: 0.999 }, { points: 1001 });
    const beta = getDistribution('beta');
    // Compare the normalised Jeffreys density with Beta(½,½), itself
    // renormalised over the same truncated range.
    const mass = beta.cdf(0.999, { alpha: 0.5, beta: 0.5 }) - beta.cdf(0.001, { alpha: 0.5, beta: 0.5 });
    let worst = 0;
    for (let i = 1; i < j.theta.length - 1; i++) {
      const want = beta.pdf(j.theta[i], { alpha: 0.5, beta: 0.5 }) / mass;
      worst = Math.max(worst, Math.abs(j.density[i] - want) / want);
    }
    // 2% relative: the Jeffreys density is built from a 1001-point
    // trapezoidal normalisation of a function that diverges at both ends.
    expect(worst).toBeLessThan(0.02);
    expect(j.proper).toBe(true);
    expect(j.explanation.limitations.join(' ')).toMatch(/Beta\(½,½\)/);
  });

  it('refuses an unknown parameter, a boundary value and an unbounded Jeffreys range', () => {
    expect(() => fisherInformation('normal', 'nope', { mu: 0, sigma: 1 })).toThrow(/not a parameter/);
    expect(() => fisherInformation('bernoulli', 'p', { p: 0 })).toThrow(EngineError);
    expect(() => jeffreysPrior('normal', 'mu', { mu: 0, sigma: 1 }, { lower: -Infinity, upper: Infinity })).toThrow(
      /finite range/,
    );
    expect(() => fisherInformation('normal', 'mu', { mu: 0, sigma: 1 }).cramerRaoBound(0)).toThrow(/positive whole/);
  });
});

/* ================================================================== */
describe('expected information gain', () => {
  it('ranks a perfectly informative experiment above a useless one', () => {
    const prior = [0.5, 0.5];
    const perfect = { name: 'perfect test', likelihood: [[1, 0], [0, 1]] };
    const useless = { name: 'useless test', likelihood: [[0.5, 0.5], [0.5, 0.5]] };
    const noisy = { name: 'noisy test', likelihood: [[0.8, 0.2], [0.2, 0.8]] };
    const r = expectedInformationGain(prior, [useless, perfect, noisy]);
    expect(r.evaluations.map((e) => e.name)).toEqual(['perfect test', 'noisy test', 'useless test']);
    // A perfect test on a 1-bit prior gains exactly 1 bit and leaves no
    // uncertainty.
    expect(r.evaluations[0].expectedInformationGain).toBeCloseTo(1, 12);
    expect(r.evaluations[0].expectedPosteriorEntropy).toBeCloseTo(0, 12);
    expect(r.evaluations[0].fractionOfPriorEntropy).toBeCloseTo(1, 12);
    expect(r.evaluations[2].expectedInformationGain).toBe(0);
    // The noisy test gains exactly 1 − H(0.8) bits, the BSC capacity at a
    // uniform input.
    expect(r.evaluations[1].expectedInformationGain).toBeCloseTo(1 - entropyNats([0.8, 0.2]) / Math.LN2, 12);
  });

  it('equals the mutual information between θ and the outcome', () => {
    const prior = [0.2, 0.3, 0.5];
    const likelihood = [
      [0.7, 0.2, 0.1],
      [0.1, 0.6, 0.3],
      [0.2, 0.2, 0.6],
    ];
    const r = expectedInformationGain(prior, [{ name: 'design', likelihood }]);
    const joint = likelihood.map((row, i) => row.map((w) => prior[i] * w));
    expect(r.evaluations[0].expectedInformationGain).toBeCloseTo(mutualInformation(joint).mutualInformation, 12);
    // H(θ) − E[H(θ|Y)] is the same number by the chain rule.
    expect(r.evaluations[0].expectedInformationGain).toBeCloseTo(
      r.priorEntropy - r.evaluations[0].expectedPosteriorEntropy,
      12,
    );
  });

  it('shows that a particular outcome can increase uncertainty even though the expectation cannot', () => {
    const prior = [0.9, 0.1];
    const likelihood = [
      [0.5, 0.5],
      [0.95, 0.05],
    ];
    const r = expectedInformationGain(prior, [{ name: 'd', likelihood }]);
    expect(r.evaluations[0].expectedInformationGain).toBeGreaterThanOrEqual(0);
    // The posterior entropy after at least one outcome exceeds the prior entropy.
    const priorEntropy = r.priorEntropy;
    const worst = Math.max(
      ...r.evaluations[0].outcomes.filter((o) => o.probability > 0).map((o) => shannonEntropy(o.posterior).value),
    );
    expect(worst).toBeGreaterThan(priorEntropy);
    expect(r.explanation.limitations.join(' ')).toMatch(/raise the posterior entropy/);
  });

  it('refuses a mismatched or unnormalised design specification', () => {
    expect(() => expectedInformationGain([0.5, 0.5], [{ name: 'd', likelihood: [[1, 0]] }])).toThrow(
      /one row per possible θ/,
    );
    expect(() =>
      expectedInformationGain([0.5, 0.5], [{ name: 'd', likelihood: [[0.6, 0.6], [0.5, 0.5]] }]),
    ).toThrow(/sum to 1.2/);
    expect(() => expectedInformationGain([0.5, 0.6], [{ name: 'd', likelihood: [[1, 0], [0, 1]] }])).toThrow(
      /not normalised/,
    );
    expect(() => expectedInformationGain([0.5, 0.5], [])).toThrow(/No designs/);
  });
});

/* ================================================================== */
describe('refusals on malformed distributions', () => {
  it('refuses an unnormalised vector and reports the actual sum', () => {
    expect(() => shannonEntropy([0.3, 0.3, 0.3])).toThrow(/sum to 0.900000000000, not 1/);
    expect(() => shannonEntropy([0.5, 0.6])).toThrow(/not normalised/);
    expect(() => shannonEntropy([2, 3])).toThrow(/sum to 5/);
    // Normalises only when explicitly asked, and shows the transformation.
    const r = shannonEntropy([2, 2], { normalise: true });
    expect(r.value).toBe(1);
    expect(r.transformation).toMatch(/divided by the input total 4/);
    expect(r.explanation.steps[0].label).toBe('Normalisation applied');
  });

  it('refuses a negative probability', () => {
    expect(() => shannonEntropy([1.5, -0.5])).toThrow(/negative/);
    expect(() => shannonEntropy([0.5, 0.5, -0])).not.toThrow();
    expect(() => klDivergence([0.5, 0.5], [1.2, -0.2])).toThrow(/negative/);
  });

  it('refuses mismatched supports', () => {
    expect(() => klDivergence([0.5, 0.5], [1 / 3, 1 / 3, 1 / 3])).toThrow(/different supports/);
    expect(() => crossEntropy([0.5, 0.5], [1])).toThrow(/same support/);
    expect(() => jensenShannonDivergence([1], [0.5, 0.5])).toThrow(/different supports/);
  });

  it('refuses non-finite and empty input', () => {
    expect(() => shannonEntropy([NaN, 1])).toThrow(/not a finite number/);
    expect(() => shannonEntropy([Infinity, 1])).toThrow(/not a finite number/);
    expect(() => shannonEntropy([])).toThrow(/at least one outcome/);
    expect(() => shannonEntropy([0, 0])).toThrow(/positive total mass/);
  });

  it('refuses a ragged or non-rectangular joint table', () => {
    expect(() => mutualInformation([[0.5, 0.25], [0.25]])).toThrow(/rectangular/);
    expect(() => jointEntropy([[0.5, 0.25], [0.25]])).toThrow(/ragged/);
    expect(() => mutualInformation([])).toThrow(/no rows/);
  });

  it('refuses an unknown logarithm base', () => {
    // A deliberately invalid base, as could arrive from untyped input.
    expect(() => shannonEntropy([0.5, 0.5], { base: 'decibels' as 'bits' })).toThrow(/Unknown logarithm base/);
  });

  it('refuses a Wasserstein-1 request with mismatched support values', () => {
    expect(() => wasserstein1([0, 1], [1], [0], [1])).toThrow(/support values/);
    expect(() => wasserstein1([0, NaN], [0.5, 0.5], [0], [1])).toThrow(/not finite/);
  });
});
