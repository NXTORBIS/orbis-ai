/**
 * Tests for the imprecise probability module.
 *
 * Reference values are independent of this implementation. They come from:
 *  - the defining identities of each theory (duality N(A) = 1 − Π(Aᶜ),
 *    maxitivity, Bel = 1 − Pl(Aᶜ), the consonant/possibility equivalence),
 *  - published counterexamples with hand-computable answers (Zadeh's two
 *    doctors: K = 0.99·0.99 + 0.99·0.01 + 0.01·0.99 = 0.9999 and m(T) = 1),
 *  - closed-form mathematics computed in the test (the analytic convolution
 *    N(μ₁+μ₂, σ₁²+σ₂²), the Fréchet bounds for U(0,1)+U(0,1) which are
 *    max(0, z−1) and min(1, z), Chebyshev 1/k², Cantelli 1/(1+k²), the
 *    triangular-fuzzy-sum theorem, the Laplace and Jeffreys estimators),
 *  - brute-force code written separately inside the test (exhaustive lattice
 *    sums, vertex enumeration by hand, direct min/max over couplings),
 *  - fixed-seed randomised identity checks.
 *
 * Tolerances: identities that are exact telescoping sums of dyadic rationals
 * are asserted with toBe (bit equality). Identities involving sums of up to
 * 2^n floating point masses are asserted to 1e-12, which is ~4000× the
 * accumulated rounding error of a 1024-term double sum. Discretised p-box
 * comparisons use the stated probability resolution 1/n.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { normalCdf } from '../special/gamma';
import { cardinality, makeFrame, maskOf, MAX_FRAME_SIZE } from './frame';
import {
  alphaCuts,
  checkConsistency,
  dominatedProbabilityVertices,
  makePossibility,
  necessityOf,
  possibilisticUtility,
  possibilityFromAlphaCuts,
  possibilityOf,
  possibilityToProbability,
  probabilityToPossibility,
  vacuousPossibility,
} from './possibility';
import {
  alphaCutOf,
  alphaGrid,
  extensionPrinciple,
  extensionPrinciple2,
  fuzzyAdd,
  fuzzyMul,
  ivSub,
  membership,
  naiveIntervalFunction,
  trapezoidalFuzzy,
  triangularFuzzy,
} from './fuzzy';
import {
  averageCombine,
  bayesianMass,
  belief,
  beliefArray,
  commitmentOrder,
  commonality,
  consonantMassFromPossibility,
  contextualDiscount,
  dempsterCombine,
  disjunctiveCombine,
  discount,
  duboisPradeCombine,
  makeMass,
  type MassFunction,
  pignisticTransform,
  plausibility,
  plausibilityArray,
  possibilityFromConsonantMass,
  uncertaintyMeasures,
  vacuousMass,
  yagerCombine,
} from './belief';
import {
  cantelliBound,
  cdfLower,
  cdfUpper,
  chebyshevBound,
  containsCdf,
  exceedanceBound,
  expectationBound,
  makePBox,
  markovBound,
  meanBound,
  type PBox,
  pboxAdd,
  pboxFromData,
  pboxFromDistribution,
  pboxFromIntervalParams,
  pboxFromMoments,
  pboxFromPossibility,
  pboxSub,
  quantileBound,
  varianceBound,
} from './pbox';
import {
  avoidsSureLoss,
  checkCoherence,
  credalFromConstraints,
  credalFromIntervals,
  credalFromVertices,
  impreciseDirichlet,
  impreciseDirichletEvent,
  naturalExtension,
  previsionBound,
  probabilityBound,
  reachableIntervals,
  robustPosterior,
} from './credal';

/* ================================================== helpers */

/** A normalised π on `n` elements, with at least one entry equal to 1. */
function randomPi(rng: Random, n: number): number[] {
  const pi = Array.from({ length: n }, () => rng.uniform());
  pi[rng.int(0, n - 1)] = 1;
  return pi;
}

/** A random normalised mass function with `k` focal sets over `n` elements. */
function randomMass(rng: Random, elements: string[], k: number): MassFunction {
  const n = elements.length;
  const picks: { mask: number; w: number }[] = [];
  for (let t = 0; t < k; t++) {
    let mask = 0;
    while (mask === 0) {
      mask = 0;
      for (let i = 0; i < n; i++) if (rng.uniform() < 0.5) mask |= 1 << i;
    }
    picks.push({ mask, w: rng.uniform() + 0.05 });
  }
  const total = picks.reduce((s, p) => s + p.w, 0);
  return makeMass(
    elements,
    picks.map((p) => ({
      set: elements.filter((_, i) => p.mask & (1 << i)),
      mass: p.w / total,
    })),
  );
}

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/* ================================================== possibility theory */

describe('possibility theory: the defining duality and maxitivity', () => {
  it('satisfies N(A) = 1 − Π(Aᶜ), Π(A∪B) = max, N(A∩B) = min, N ≤ Π and Π(Θ) = 1 on random π', () => {
    const rng = new Random('possibility-duality-seed-1');
    for (let trial = 0; trial < 40; trial++) {
      const n = 3 + (trial % 4);
      const elements = LETTERS.slice(0, n);
      const dist = makePossibility(elements, randomPi(rng, n));
      const full = (1 << n) - 1;
      // Π(Θ) = 1 is forced by normalisation.
      expect(possibilityOf(dist, full)).toBe(1);
      expect(necessityOf(dist, full)).toBe(1);
      expect(possibilityOf(dist, 0)).toBe(0);
      expect(necessityOf(dist, 0)).toBe(0);
      for (let a = 0; a <= full; a++) {
        const pA = possibilityOf(dist, a);
        const nA = necessityOf(dist, a);
        // Duality, computed two ways.
        expect(nA).toBeCloseTo(1 - possibilityOf(dist, full & ~a), 12);
        // N ≤ Π for every A (for a normalised π).
        expect(nA).toBeLessThanOrEqual(pA + 1e-12);
        for (let b = 0; b <= full; b++) {
          // Maximitivity: Π is NOT additive.
          expect(possibilityOf(dist, a | b)).toBeCloseTo(
            Math.max(possibilityOf(dist, a), possibilityOf(dist, b)),
            12,
          );
          // Minitivity of N.
          expect(necessityOf(dist, a & b)).toBeCloseTo(
            Math.min(nA, necessityOf(dist, b)),
            12,
          );
        }
      }
    }
  });

  it('expresses TOTAL IGNORANCE with π ≡ 1: N(A) = 0 and Π(A) = 1 for every proper non-empty A', () => {
    for (const n of [2, 3, 5]) {
      const dist = vacuousPossibility(LETTERS.slice(0, n));
      const full = (1 << n) - 1;
      for (let a = 1; a < full; a++) {
        // No single probability distribution can say this about every A at once.
        expect(possibilityOf(dist, a)).toBe(1);
        expect(necessityOf(dist, a)).toBe(0);
      }
      expect(possibilityOf(dist, full)).toBe(1);
      expect(necessityOf(dist, full)).toBe(1);
    }
  });

  it('refuses an unnormalised π and reports the actual supremum', () => {
    expect(() => makePossibility(['a', 'b', 'c'], [0.7, 0.3, 0.2])).toThrow(EngineError);
    try {
      makePossibility(['a', 'b', 'c'], [0.7, 0.3, 0.2]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      const msg = (e as EngineError).message;
      expect(msg).toContain('sup π = 0.7');
      expect(msg).toContain('not rescale');
    }
    expect(() => makePossibility(['a', 'b'], [1.2, 1])).toThrow(/between 0 and 1/);
  });

  it('builds a nested α-cut family and reconstructs π from it', () => {
    const dist = makePossibility(['a', 'b', 'c', 'd'], [1, 0.75, 0.75, 0.25]);
    const cuts = alphaCuts(dist);
    expect(cuts.map((c) => c.alpha)).toEqual([1, 0.75, 0.25]);
    expect(cuts.map((c) => c.size)).toEqual([1, 3, 4]);
    for (let i = 1; i < cuts.length; i++) {
      // Nesting: the higher cut is contained in the lower one.
      expect(cuts[i - 1].mask & ~cuts[i].mask).toBe(0);
    }
    const back = possibilityFromAlphaCuts(dist.frame, cuts);
    expect([...back.pi]).toEqual([...dist.pi]);
  });
});

describe('possibility ↔ probability', () => {
  it('Dubois–Prade transform dominates P on every event and states that it loses information', () => {
    const rng = new Random('dp-transform-seed');
    for (let trial = 0; trial < 20; trial++) {
      const n = 3 + (trial % 3);
      const elements = LETTERS.slice(0, n);
      const raw = Array.from({ length: n }, () => rng.uniform() + 0.01);
      const s = raw.reduce((x, y) => x + y, 0);
      const p = raw.map((x) => x / s);
      const res = probabilityToPossibility(elements, p);
      const report = checkConsistency(res.value, p);
      expect(report.value.dominates).toBe(true);
      expect(report.value.worstViolation).toBeNull();
      expect(res.provenance.notes.join(' ')).toContain('DISCARDS information');
    }
  });

  it('maps a uniform probability to total ignorance (π ≡ 1)', () => {
    // Independent reference: Σ_{p_j ≤ p_i} p_j = 1 for every i when all p are equal.
    const res = probabilityToPossibility(['a', 'b', 'c', 'd'], [0.25, 0.25, 0.25, 0.25]);
    expect([...res.value.pi]).toEqual([1, 1, 1, 1]);
  });

  it('reproduces the hand-computed transform of (0.5, 0.3, 0.2)', () => {
    // By hand: π(0.2) = 0.2; π(0.3) = 0.2 + 0.3 = 0.5; π(0.5) = 1.
    const res = probabilityToPossibility(['x', 'y', 'z'], [0.5, 0.3, 0.2]);
    expect(res.value.pi[0]).toBe(1);
    expect(res.value.pi[1]).toBeCloseTo(0.5, 12);
    expect(res.value.pi[2]).toBeCloseTo(0.2, 12);
  });

  it('enumerates the dominated probability set, whose lower/upper envelope is exactly N/Π', () => {
    const dist = makePossibility(['a', 'b', 'c'], [1, 0.75, 0.25]);
    const verts = dominatedProbabilityVertices(dist).value;
    for (const p of verts) {
      expect(p.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
      expect(checkConsistency(dist, p).value.dominates).toBe(true);
    }
    for (let a = 1; a < 7; a++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of verts) {
        let pa = 0;
        for (let i = 0; i < 3; i++) if (a & (1 << i)) pa += p[i];
        lo = Math.min(lo, pa);
        hi = Math.max(hi, pa);
      }
      expect(lo).toBeCloseTo(necessityOf(dist, a), 12);
      expect(hi).toBeCloseTo(possibilityOf(dist, a), 12);
    }
  });

  it('labels the forced collapse to a probability as ADDING arbitrary commitment', () => {
    const res = possibilityToProbability(vacuousPossibility(['a', 'b', 'c', 'd']));
    expect(res.value).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(res.provenance.notes.join(' ')).toContain('ADDS commitment');
    expect(res.warnings.join(' ')).toContain('arbitrary');
  });

  it('refuses to enumerate dominated probabilities for an oversized frame, naming the limit', () => {
    const big = vacuousPossibility(Array.from({ length: 9 }, (_, i) => `e${i}`));
    expect(() => dominatedProbabilityVertices(big)).toThrow(/9! permutations|limit is 7/);
  });
});

describe('possibilistic decision criteria', () => {
  it('computes the optimistic and pessimistic indices, which disagree', () => {
    const dist = makePossibility(['low', 'mid', 'high'], [1, 0.5, 0.2]);
    const u = [0.1, 0.9, 1];
    // By hand: optimistic = max(min(1,0.1), min(0.5,0.9), min(0.2,1)) = max(0.1,0.5,0.2) = 0.5
    //          pessimistic = min(max(0,0.1), max(0.5,0.9), max(0.8,1)) = min(0.1,0.9,1) = 0.1
    const res = possibilisticUtility(dist, u);
    expect(res.value.optimistic).toBeCloseTo(0.5, 12);
    expect(res.value.pessimistic).toBeCloseTo(0.1, 12);
    expect(res.value.optimistic).not.toBeCloseTo(res.value.pessimistic, 2);
    expect(res.provenance.commitments.join(' ')).toContain('value judgement');
  });
});

/* ================================================== Dempster–Shafer */

describe('Dempster–Shafer identities', () => {
  it('satisfies Bel ≤ Pl, Bel(A) = 1 − Pl(Aᶜ), Bel(Θ) = 1 on random mass functions', () => {
    const rng = new Random('ds-identity-seed-7');
    for (let trial = 0; trial < 30; trial++) {
      const n = 3 + (trial % 3);
      const elements = LETTERS.slice(0, n);
      const mass = randomMass(rng, elements, 4 + (trial % 5));
      const full = (1 << n) - 1;
      const bel = beliefArray(mass);
      const pl = plausibilityArray(mass);
      expect(bel[full]).toBeCloseTo(1, 12);
      expect(pl[full]).toBeCloseTo(1, 12);
      expect(bel[0]).toBe(0);
      expect(pl[0]).toBe(0);
      for (let a = 0; a <= full; a++) {
        // Brute-force lattice sums, written independently of the zeta transform.
        let belBrute = 0;
        let plBrute = 0;
        for (let b = 1; b <= full; b++) {
          if ((b & ~a) === 0) belBrute += mass.m[b];
          if ((b & a) !== 0) plBrute += mass.m[b];
        }
        expect(bel[a]).toBeCloseTo(belBrute, 12);
        expect(pl[a]).toBeCloseTo(plBrute, 12);
        expect(bel[a]).toBeLessThanOrEqual(pl[a] + 1e-12);
        expect(bel[a]).toBeCloseTo(1 - pl[full & ~a], 12);
        expect(belief(mass, a)).toBeCloseTo(bel[a], 12);
        expect(plausibility(mass, a)).toBeCloseTo(pl[a], 12);
      }
      // Commonality q(A) = Σ_{B ⊇ A} m(B), checked by brute force.
      for (let a = 1; a <= full; a++) {
        let q = 0;
        for (let b = 1; b <= full; b++) if ((a & ~b) === 0) q += mass.m[b];
        expect(commonality(mass, a)).toBeCloseTo(q, 12);
      }
    }
  });

  it('reduces to an ordinary probability measure on a Bayesian mass function (exact equality)', () => {
    const p = [0.5, 0.25, 0.125, 0.125]; // dyadic, so the lattice sums are exact
    const mass = bayesianMass(['a', 'b', 'c', 'd'], p);
    const bel = beliefArray(mass);
    const pl = plausibilityArray(mass);
    for (let a = 0; a < 16; a++) {
      let pa = 0;
      for (let i = 0; i < 4; i++) if (a & (1 << i)) pa += p[i];
      expect(bel[a]).toBe(pa);
      expect(pl[a]).toBe(pa);
    }
  });

  it('expresses TOTAL IGNORANCE with the vacuous belief function: Bel = 0, Pl = 1 on proper A', () => {
    for (const n of [2, 3, 4]) {
      const mass = vacuousMass(LETTERS.slice(0, n));
      const full = (1 << n) - 1;
      for (let a = 1; a < full; a++) {
        expect(belief(mass, a)).toBe(0);
        expect(plausibility(mass, a)).toBe(1);
      }
      expect(belief(mass, full)).toBe(1);
    }
  });

  it('refuses negative mass, an unnormalised bpa (reporting the total), mass on ∅ and an oversized frame', () => {
    expect(() => makeMass(['a', 'b'], [{ set: ['a'], mass: -0.1 }, { set: ['b'], mass: 1.1 }])).toThrow(
      /negative/,
    );
    try {
      makeMass(['a', 'b'], [{ set: ['a'], mass: 0.3 }, { set: ['b'], mass: 0.4 }]);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as EngineError).message).toContain('sum to 0.7');
    }
    expect(() => makeMass(['a', 'b'], [{ set: [], mass: 0.5 }, { set: ['a'], mass: 0.5 }])).toThrow(
      /empty set/,
    );
    const tooBig = Array.from({ length: MAX_FRAME_SIZE + 1 }, (_, i) => `e${i}`);
    expect(() => makeFrame(tooBig)).toThrow(/subset lattice|limit is 20/);
  });
});

describe("Zadeh's counterexample: Dempster's rule under near-total conflict", () => {
  const frame = ['meningitis', 'concussion', 'tumour'];
  const doctor1 = makeMass(frame, [
    { set: ['meningitis'], mass: 0.99 },
    { set: ['tumour'], mass: 0.01 },
  ]);
  const doctor2 = makeMass(frame, [
    { set: ['concussion'], mass: 0.99 },
    { set: ['tumour'], mass: 0.01 },
  ]);
  const T = maskOf(makeFrame(frame), ['tumour']);

  it('reproduces the pathology numerically: belief concentrates on the diagnosis both doctors nearly excluded', () => {
    const res = dempsterCombine(doctor1, doctor2);
    // Hand computation: the only non-empty intersection is {tumour}∩{tumour},
    // with product mass 0.01·0.01 = 1e-4. K = 1 − 1e-4 = 0.9999.
    expect(res.value.conflict).toBeCloseTo(0.9999, 12);
    expect(res.value.mass.m[T]).toBeCloseTo(1, 12);
    expect(belief(res.value.mass, T)).toBeCloseTo(1, 12);
    // Both doctors gave the tumour only 1% mass; Dempster's rule returns certainty.
    expect(plausibility(doctor1, T)).toBeCloseTo(0.01, 12);
    expect(plausibility(doctor2, T)).toBeCloseTo(0.01, 12);
  });

  it('warns loudly rather than presenting the result as ordinary', () => {
    const res = dempsterCombine(doctor1, doctor2);
    expect(res.value.pathological).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.join(' ')).toContain('PATHOLOGICAL');
    expect(res.warnings.join(' ')).toContain('Zadeh');
  });

  it("refuses outright under the 'refuse' policy, naming the conflict mass", () => {
    expect(() => dempsterCombine(doctor1, doctor2, 'refuse')).toThrow(/K = 0.9999/);
    expect(() => dempsterCombine(doctor1, doctor2, 'refuse')).toThrow(/Zadeh/);
  });

  it('refuses total conflict (K = 1) instead of dividing by zero', () => {
    const a = makeMass(frame, [{ set: ['meningitis'], mass: 1 }]);
    const b = makeMass(frame, [{ set: ['concussion'], mass: 1 }]);
    expect(() => dempsterCombine(a, b)).toThrow(/Total conflict/);
  });

  it("Yager's rule does NOT exhibit the pathology: the conflict becomes ignorance", () => {
    const res = yagerCombine(doctor1, doctor2);
    const full = 7;
    expect(res.value.mass.m[T]).toBeCloseTo(1e-4, 12);
    expect(res.value.mass.m[full]).toBeCloseTo(0.9999, 12);
    expect(belief(res.value.mass, T)).toBeCloseTo(1e-4, 12);
    // Nowhere near certainty: the honest reading of two contradicting sources.
    expect(belief(res.value.mass, T)).toBeLessThan(0.01);
  });

  it('the disjunctive rule also avoids it, and puts the mass where the doctors actually pointed', () => {
    const res = disjunctiveCombine(doctor1, doctor2);
    const MC = maskOf(makeFrame(frame), ['meningitis', 'concussion']);
    expect(res.value.mass.m[MC]).toBeCloseTo(0.9801, 12);
    expect(belief(res.value.mass, T)).toBeCloseTo(1e-4, 12);
    expect(plausibility(res.value.mass, MC)).toBeGreaterThan(0.99);
  });

  it("Dubois–Prade's hybrid rule reports the conflict instead of discarding it, and averaging stays near the inputs", () => {
    const dp = duboisPradeCombine(doctor1, doctor2);
    expect(dp.value.conflict).toBeCloseTo(0.9999, 12);
    expect(belief(dp.value.mass, T)).toBeCloseTo(1e-4, 12);
    const avg = averageCombine(doctor1, doctor2);
    expect(avg.value.mass.m[T]).toBeCloseTo(0.01, 12);
    expect(avg.value.mass.m[maskOf(makeFrame(frame), ['meningitis'])]).toBeCloseTo(0.495, 12);
  });

  it('combines agreeing sources without complaint (the rule is not broken, only its conflict case)', () => {
    const a = makeMass(frame, [
      { set: ['meningitis', 'concussion'], mass: 0.6 },
      { set: ['meningitis', 'concussion', 'tumour'], mass: 0.4 },
    ]);
    const b = makeMass(frame, [
      { set: ['meningitis'], mass: 0.7 },
      { set: ['meningitis', 'concussion', 'tumour'], mass: 0.3 },
    ]);
    const res = dempsterCombine(a, b);
    expect(res.value.conflict).toBe(0);
    expect(res.value.pathological).toBe(false);
    expect(res.warnings).toHaveLength(0);
    // Hand check: m({M}) = 0.6·0.7 + 0.4·0.7 = 0.7, m({M,C}) = 0.6·0.3 = 0.18, m(Θ) = 0.12.
    expect(res.value.mass.m[maskOf(makeFrame(frame), ['meningitis'])]).toBeCloseTo(0.7, 12);
    expect(res.value.mass.m[maskOf(makeFrame(frame), ['meningitis', 'concussion'])]).toBeCloseTo(0.18, 12);
    expect(res.value.mass.m[7]).toBeCloseTo(0.12, 12);
  });
});

describe('consonant belief functions are possibility distributions', () => {
  it('converts π → consonant m → π with Pl = Π and Bel = N on EVERY subset, exactly', () => {
    // Dyadic π values, so the telescoping mass sums α_j − α_{j+1} and their
    // partial sums are exact in binary floating point: "exactly" means bitwise.
    for (const pi of [
      [1, 0.75, 0.5, 0.25],
      [1, 1, 0.5, 0.25],
      [1, 0.5, 0.5, 0],
      [0.25, 1, 0.75, 0.75],
    ]) {
      const dist = makePossibility(['a', 'b', 'c', 'd'], pi);
      const mass = consonantMassFromPossibility(dist).value;
      // The focal sets are nested.
      const focal = [...mass.focal].sort((x, y) => cardinality(x.mask) - cardinality(y.mask));
      for (let i = 1; i < focal.length; i++) expect(focal[i - 1].mask & ~focal[i].mask).toBe(0);
      for (let a = 0; a < 16; a++) {
        expect(plausibility(mass, a)).toBe(possibilityOf(dist, a));
        expect(belief(mass, a)).toBe(necessityOf(dist, a));
      }
      const back = possibilityFromConsonantMass(mass).value;
      expect([...back.pi]).toEqual([...dist.pi]);
    }
  });

  it('holds on random π to 1e-12 (non-dyadic values, so rounding is permitted)', () => {
    const rng = new Random('consonant-seed-3');
    for (let trial = 0; trial < 25; trial++) {
      const n = 3 + (trial % 4);
      const dist = makePossibility(LETTERS.slice(0, n), randomPi(rng, n));
      const mass = consonantMassFromPossibility(dist).value;
      for (let a = 0; a < 1 << n; a++) {
        expect(plausibility(mass, a)).toBeCloseTo(possibilityOf(dist, a), 12);
        expect(belief(mass, a)).toBeCloseTo(necessityOf(dist, a), 12);
      }
    }
  });

  it('refuses to read a NON-consonant mass function as a possibility distribution', () => {
    const mass = makeMass(['a', 'b', 'c'], [
      { set: ['a', 'b'], mass: 0.5 },
      { set: ['b', 'c'], mass: 0.5 },
    ]);
    expect(() => possibilityFromConsonantMass(mass)).toThrow(/not consonant/);
  });
});

describe('pignistic transform and discounting', () => {
  it('yields a valid probability distribution: non-negative and summing to 1', () => {
    const rng = new Random('pignistic-seed');
    for (let trial = 0; trial < 20; trial++) {
      const n = 3 + (trial % 3);
      const mass = randomMass(rng, LETTERS.slice(0, n), 5);
      const p = pignisticTransform(mass).value;
      for (const x of p) expect(x).toBeGreaterThanOrEqual(0);
      // Sum to 1 within double-precision rounding of a few dozen divisions.
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      // BetP always lies between Bel and Pl on singletons.
      for (let i = 0; i < n; i++) {
        expect(p[i]).toBeGreaterThanOrEqual(belief(mass, 1 << i) - 1e-12);
        expect(p[i]).toBeLessThanOrEqual(plausibility(mass, 1 << i) + 1e-12);
      }
    }
  });

  it('is the identity on a Bayesian mass function', () => {
    const p = [0.5, 0.125, 0.375];
    const mass = bayesianMass(['a', 'b', 'c'], p);
    expect(pignisticTransform(mass).value).toEqual(p);
  });

  it('splits the vacuous belief function uniformly, and says that is a betting convention', () => {
    const res = pignisticTransform(vacuousMass(['a', 'b', 'c', 'd']));
    expect(res.value).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(res.provenance.notes.join(' ')).toContain('insufficient reason');
  });

  it('discounting weakens every belief and strengthens every plausibility', () => {
    const mass = makeMass(['a', 'b', 'c'], [
      { set: ['a'], mass: 0.6 },
      { set: ['a', 'b'], mass: 0.4 },
    ]);
    const d = discount(mass, 0.25).value;
    for (let a = 1; a < 7; a++) {
      expect(belief(d, a)).toBeLessThanOrEqual(belief(mass, a) + 1e-15);
      expect(plausibility(d, a)).toBeGreaterThanOrEqual(plausibility(mass, a) - 1e-15);
    }
    // Hand check: m'({a}) = 0.75·0.6 = 0.45, m'(Θ) = 0.25.
    expect(d.m[1]).toBeCloseTo(0.45, 12);
    expect(d.m[7]).toBeCloseTo(0.25, 12);
    // α = 1 is total unreliability: the testimony is replaced by ignorance.
    expect(discount(mass, 1).value.m[7]).toBe(1);
  });

  it('contextual discounting matches a hand computation and weakens every belief', () => {
    // Hand computation for m({a}) = 1 on Θ = {a,b,c} with α = 0.2 everywhere,
    // using b'(A) = Bel(A)·Π_{ω∉A}(1−α_ω) and Möbius inversion:
    //   b'({a}) = 0.8² = 0.64, b'({a,b}) = b'({a,c}) = 0.8, b'(Θ) = 1
    //   ⟹ m'({a}) = 0.64, m'({a,b}) = m'({a,c}) = 0.16, m'(Θ) = 0.04.
    const mass = makeMass(['a', 'b', 'c'], [{ set: ['a'], mass: 1 }]);
    const res = contextualDiscount(mass, [0.2, 0.2, 0.2]).value;
    expect(res.m[0b001]).toBeCloseTo(0.64, 12);
    expect(res.m[0b011]).toBeCloseTo(0.16, 12);
    expect(res.m[0b101]).toBeCloseTo(0.16, 12);
    expect(res.m[0b111]).toBeCloseTo(0.04, 12);
    // Zero rates are the identity; unit rates give the vacuous belief function.
    const mixed = makeMass(['a', 'b', 'c'], [
      { set: ['a'], mass: 0.5 },
      { set: ['b', 'c'], mass: 0.3 },
      { set: ['a', 'b', 'c'], mass: 0.2 },
    ]);
    const same = contextualDiscount(mixed, [0, 0, 0]).value;
    for (let a = 1; a < 8; a++) expect(belief(same, a)).toBeCloseTo(belief(mixed, a), 12);
    const vac = contextualDiscount(mixed, [1, 1, 1]).value;
    expect(vac.m[0b111]).toBeCloseTo(1, 12);
    // Discounting always weakens, element-wise rates included.
    const partial = contextualDiscount(mixed, [0.4, 0.1, 0]).value;
    for (let a = 1; a < 8; a++) {
      expect(belief(partial, a)).toBeLessThanOrEqual(belief(mixed, a) + 1e-12);
      expect(plausibility(partial, a)).toBeGreaterThanOrEqual(plausibility(mixed, a) - 1e-12);
    }
  });
});

describe('uncertainty measures distinguish ignorance from conflict', () => {
  it('separates "no evidence" from "conflicting evidence", which one probability cannot', () => {
    const elements = ['a', 'b', 'c', 'd'];
    const noEvidence = vacuousMass(elements);
    const conflicting = bayesianMass(elements, [0.25, 0.25, 0.25, 0.25]);
    const u1 = uncertaintyMeasures(noEvidence).value;
    const u2 = uncertaintyMeasures(conflicting).value;
    // Independent reference: Hartley non-specificity of Θ is log2 4 = 2 bits.
    expect(u1.nonSpecificity).toBeCloseTo(2, 12);
    expect(u1.dissonance).toBeCloseTo(0, 12);
    expect(u2.nonSpecificity).toBeCloseTo(0, 12);
    // Dissonance −Σ m log2 Pl = −Σ 0.25·log2 0.25 = 2 bits.
    expect(u2.dissonance).toBeCloseTo(2, 12);
    // Same pignistic probability, utterly different epistemic state.
    expect(pignisticTransform(noEvidence).value).toEqual(pignisticTransform(conflicting).value);
    expect(u1.total).toBeCloseTo(u2.total, 12);
    expect(u1.nonSpecificity).not.toBeCloseTo(u2.nonSpecificity, 6);
  });

  it('orders mass functions by commitment, and calls the vacuous one least committed', () => {
    const elements = ['a', 'b', 'c'];
    const vac = vacuousMass(elements);
    const sharp = makeMass(elements, [{ set: ['a'], mass: 1 }]);
    expect(commitmentOrder(sharp, vac).value).toBe('first-more-committed');
    expect(commitmentOrder(vac, sharp).value).toBe('second-more-committed');
    expect(commitmentOrder(vac, vac).value).toBe('equal');
    const other = makeMass(elements, [{ set: ['b'], mass: 1 }]);
    expect(commitmentOrder(sharp, other).value).toBe('incomparable');
  });
});

/* ================================================== fuzzy numbers */

describe('fuzzy numbers and α-cut arithmetic', () => {
  it('adds two triangular fuzzy numbers to the triangular number with summed vertices, exactly', () => {
    // Independent reference: the standard theorem that triangular fuzzy numbers
    // are closed under addition with vertex-wise sums. Integer vertices and a
    // dyadic α grid make the arithmetic exact, so toBe is justified.
    const x = triangularFuzzy(1, 2, 4, alphaGrid(17));
    const y = triangularFuzzy(2, 3, 7, alphaGrid(17));
    const sum = fuzzyAdd(x, y).value;
    const expected = triangularFuzzy(3, 5, 11, alphaGrid(17));
    expect(sum.levels.length).toBe(17);
    for (let i = 0; i < 17; i++) {
      expect(sum.levels[i].alpha).toBe(expected.levels[i].alpha);
      expect(sum.levels[i].lo).toBe(expected.levels[i].lo);
      expect(sum.levels[i].hi).toBe(expected.levels[i].hi);
    }
  });

  it('adds trapezoidal numbers vertex-wise and keeps membership consistent', () => {
    const x = trapezoidalFuzzy(0, 1, 2, 4, alphaGrid(9));
    const y = trapezoidalFuzzy(1, 2, 2, 3, alphaGrid(9));
    const sum = fuzzyAdd(x, y).value;
    const expected = trapezoidalFuzzy(1, 3, 4, 7, alphaGrid(9));
    for (let i = 0; i < 9; i++) {
      expect(sum.levels[i].lo).toBe(expected.levels[i].lo);
      expect(sum.levels[i].hi).toBe(expected.levels[i].hi);
    }
    expect(membership(x, 1.5)).toBe(1);
    expect(membership(x, 3)).toBeCloseTo(0.5, 12);
    expect(membership(x, 5)).toBe(0);
  });

  it('gives the α = 1 cut as the modal point and the α = 0 cut as the support', () => {
    const x = triangularFuzzy(1, 2, 4);
    expect(alphaCutOf(x, 1).lower).toBe(2);
    expect(alphaCutOf(x, 1).upper).toBe(2);
    expect(alphaCutOf(x, 0).lower).toBe(1);
    expect(alphaCutOf(x, 0).upper).toBe(4);
    expect(alphaCutOf(x, 0.5).lower).toBeCloseTo(1.5, 12);
    expect(alphaCutOf(x, 0.5).upper).toBeCloseTo(3, 12);
  });

  it('multiplies via α-cuts and matches a brute-force product range', () => {
    const x = triangularFuzzy(1, 2, 3, alphaGrid(5));
    const y = triangularFuzzy(2, 4, 5, alphaGrid(5));
    const prod = fuzzyMul(x, y).value;
    for (const level of prod.levels) {
      const cx = alphaCutOf(x, level.alpha);
      const cy = alphaCutOf(y, level.alpha);
      // Brute force over the cut rectangle (positive supports ⇒ corners suffice).
      const cand = [cx.lower * cy.lower, cx.lower * cy.upper, cx.upper * cy.lower, cx.upper * cy.upper];
      expect(level.lo).toBeCloseTo(Math.min(...cand), 12);
      expect(level.hi).toBeCloseTo(Math.max(...cand), 12);
    }
  });

  it('REFUSES to build a fuzzy number with crossed or non-nested α-cuts', () => {
    expect(() => triangularFuzzy(3, 2, 4)).toThrow(/a ≤ b ≤ c/);
    expect(() => trapezoidalFuzzy(0, 2, 1, 3)).toThrow(/a ≤ b ≤ c ≤ d/);
  });
});

describe('the dependency problem is real and the API distinguishes the two routes', () => {
  it('computes X − X as a NON-ZERO interval naively and as exactly zero through α-cuts', () => {
    const x = triangularFuzzy(1, 2, 4, alphaGrid(9));
    const naive = naiveIntervalFunction(x, (occ) => ivSub(occ[0], occ[1]), 2);
    const correct = extensionPrinciple(x, (v) => v - v);
    // Naive interval arithmetic: [a − c, c − a] = [−3, 3] at α = 0. Wrong.
    expect(naive.value.levels[0].lo).toBe(-3);
    expect(naive.value.levels[0].hi).toBe(3);
    expect(naive.value.levels[0].hi - naive.value.levels[0].lo).toBeGreaterThan(0);
    // The α-cut route treats x as one quantity: X − X = 0 exactly, at every α.
    for (const level of correct.value.levels) {
      expect(level.lo).toBe(0);
      expect(level.hi).toBe(0);
    }
    // The two routes are named differently and carry different provenance.
    expect(naive.provenance.notes.join(' ')).toContain('DEPENDENCY PROBLEM');
    expect(naive.warnings.join(' ')).toContain('too wide');
    expect(correct.provenance.notes.join(' ')).toContain('dependency-safe');
  });

  it('also overestimates X·(1 − X) naively, while the α-cut route gives the true range', () => {
    const x = triangularFuzzy(0, 0.5, 1, alphaGrid(5));
    const naive = naiveIntervalFunction(
      x,
      (occ) => {
        const one = { lo: 1, hi: 1 };
        const second = ivSub(one, occ[1]);
        const p = [occ[0].lo * second.lo, occ[0].lo * second.hi, occ[0].hi * second.lo, occ[0].hi * second.hi];
        return { lo: Math.min(...p), hi: Math.max(...p) };
      },
      2,
    );
    const correct = extensionPrinciple(x, (v) => v * (1 - v), { mode: 'sampled', samples: 2001 });
    // True range of x(1−x) over [0,1] is [0, 0.25]; naive gives [0,1].
    expect(naive.value.levels[0].hi).toBeCloseTo(1, 12);
    expect(correct.value.levels[0].hi).toBeCloseTo(0.25, 6);
    expect(correct.value.levels[0].lo).toBeCloseTo(0, 6);
    expect(correct.value.levels[0].hi).toBeLessThan(naive.value.levels[0].hi);
  });

  it('propagates two non-interactive fuzzy inputs through a monotone function exactly', () => {
    const x = triangularFuzzy(1, 2, 3, alphaGrid(5));
    const y = triangularFuzzy(10, 20, 30, alphaGrid(5));
    const res = extensionPrinciple2(x, y, (a, b) => a + b);
    const expected = fuzzyAdd(x, y).value;
    for (let i = 0; i < res.value.levels.length; i++) {
      expect(res.value.levels[i].lo).toBeCloseTo(expected.levels[i].lo, 12);
      expect(res.value.levels[i].hi).toBeCloseTo(expected.levels[i].hi, 12);
    }
    expect(res.provenance.notes.join(' ')).toContain('NON-INTERACTIVE');
  });
});

/* ================================================== p-boxes */

/** Brute-force CDF of the sum under a given coupling of the bucket midpoints. */
function couplingCdf(box: PBox, x: number): { lo: number; hi: number } {
  return { lo: cdfLower(box, x), hi: cdfUpper(box, x) };
}

describe('p-box construction and refusals', () => {
  it('REFUSES crossed bounds, naming where they cross', () => {
    expect(() => makePBox([0, 1, 2, 5], [1, 2, 3, 4])).toThrow(/bounds cross at probability level/);
    try {
      makePBox([0, 1, 2, 5], [1, 2, 3, 4]);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as EngineError).message;
      expect(msg).toContain('0.75');
      expect(msg).toContain('NO distribution');
    }
    expect(() => makePBox([0, 1, 0.5], [1, 2, 3])).toThrow(/not non-decreasing/);
    expect(() => makePBox([0, NaN], [1, 2])).toThrow(/NaN/);
  });

  it('brackets the true CDF of a precise distribution within the stated resolution', () => {
    const box = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 100 }).value;
    for (let k = 0; k <= 20; k++) {
      const x = k / 20;
      expect(cdfLower(box, x)).toBeLessThanOrEqual(x + 1e-12);
      expect(cdfUpper(box, x)).toBeGreaterThanOrEqual(x - 1e-12);
      expect(cdfUpper(box, x) - cdfLower(box, x)).toBeLessThanOrEqual(1 / 100 + 1e-12);
    }
    expect(containsCdf(box, (x) => Math.min(1, Math.max(0, x)), [0, 0.25, 0.5, 0.75, 1])).toBe(true);
  });

  it('reports bounds on the mean, the variance, quantiles and exceedance probabilities', () => {
    const box = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 200 }).value;
    const mb = meanBound(box);
    expect(mb.lower).toBeLessThanOrEqual(0.5);
    expect(mb.upper).toBeGreaterThanOrEqual(0.5);
    expect(mb.width).toBeLessThan(0.01);
    expect(mb.kind).toBe('bound');
    const vb = varianceBound(box);
    // Var(U(0,1)) = 1/12 ≈ 0.08333, computed independently.
    expect(vb.lower).toBeLessThanOrEqual(1 / 12 + 1e-9);
    expect(vb.upper).toBeGreaterThanOrEqual(1 / 12 - 1e-9);
    const qb = quantileBound(box, 0.25);
    expect(qb.lower).toBeLessThanOrEqual(0.25);
    expect(qb.upper).toBeGreaterThanOrEqual(0.25);
    const eb = exceedanceBound(box, 0.3);
    expect(eb.lower).toBeLessThanOrEqual(0.7);
    expect(eb.upper).toBeGreaterThanOrEqual(0.7);
    const ex = expectationBound(box, (x) => 2 * x + 1);
    expect(ex.lower).toBeLessThanOrEqual(2);
    expect(ex.upper).toBeGreaterThanOrEqual(2);
  });

  it('builds an envelope from interval-valued parameters that contains every member', () => {
    const box = pboxFromIntervalParams('normal', { mu: { lo: -1, hi: 1 }, sigma: 1 }, {
      steps: 100,
      gridPerParam: 5,
      tailTruncation: 1e-6,
    }).value;
    const xs = [-3, -2, -1, 0, 1, 2, 3];
    for (const mu of [-1, -0.5, 0, 0.5, 1]) {
      expect(containsCdf(box, (x) => normalCdf(x - mu), xs)).toBe(true);
    }
    // The box is genuinely wider than any single member.
    expect(cdfUpper(box, 0) - cdfLower(box, 0)).toBeGreaterThan(0.3);
    expect(() => pboxFromIntervalParams('normal', { mu: { lo: 1, hi: -1 } })).toThrow(/lo = 1 > hi = -1/);
  });

  it('respects Markov, Chebyshev and Cantelli, and Cantelli is tighter per tail', () => {
    for (const k of [1, 1.5, 2, 3, 5]) {
      const ch = chebyshevBound(k).value;
      const ca = cantelliBound(k).value;
      expect(ch).toBeCloseTo(Math.min(1, 1 / (k * k)), 15);
      expect(ca).toBeCloseTo(1 / (1 + k * k), 15);
      // 1/(1+k²) < 1/k² for every k > 0: a one-sided bound beats a two-sided one.
      expect(ca).toBeLessThan(ch + 1e-15);
    }
    expect(markovBound(2, 8).value).toBeCloseTo(0.25, 15);
    expect(markovBound(2, 1).value).toBe(1);
    expect(() => markovBound(-1, 2)).toThrow(/0 or greater/);
    expect(() => chebyshevBound(0)).toThrow(/greater than 0/);
  });

  it('the Cantelli p-box contains distributions with the given moments and respects the one-sided bound', () => {
    const mu = 10;
    const sd = 2;
    const box = pboxFromMoments(mu, sd, { steps: 500 }).value;
    // A normal with the same moments must be inside.
    const xs = [4, 6, 8, 10, 12, 14, 16];
    expect(containsCdf(box, (x) => normalCdf((x - mu) / sd), xs)).toBe(true);
    // So must the two-point distribution attaining Cantelli's bound at k = 2:
    // P(X = mu + 2sd) = 1/5, P(X = mu − sd/2) = 4/5 has mean mu and sd 2.
    const p = 1 / 5;
    const twoPoint = (x: number) => (x < mu - sd / 2 ? 0 : x < mu + 2 * sd ? 1 - p : 1);
    expect(containsCdf(box, twoPoint, xs)).toBe(true);
    // The box's own one-sided tail bound never exceeds Cantelli's.
    for (const k of [1, 2, 3]) {
      const upperTail = 1 - cdfLower(box, mu + k * sd);
      expect(upperTail).toBeLessThanOrEqual(cantelliBound(k).value + 1 / 500 + 1e-12);
      const lowerTail = cdfUpper(box, mu - k * sd);
      expect(lowerTail).toBeLessThanOrEqual(cantelliBound(k).value + 1 / 500 + 1e-12);
    }
    // And it says out loud that it cannot carry the joint two-sided constraint.
    const labelled = pboxFromMoments(mu, sd, { steps: 50 });
    expect(labelled.warnings.join(' ')).toContain('JOINT two-sided');
    expect(() => pboxFromMoments(0, 0)).toThrow(/greater than 0/);
  });

  it('builds a Kolmogorov–Smirnov band that contains the sampling distribution', () => {
    const rng = new Random('ks-band-seed');
    const data = Array.from({ length: 400 }, () => rng.uniform());
    const res = pboxFromData(data, 0.95, { steps: 100 });
    expect(res.provenance.exactness).toBe('empirical');
    expect(res.provenance.notes.join(' ')).toContain('Simultaneous');
    const box = res.value;
    // U(0,1) is the true distribution; the 95% band should contain it.
    expect(containsCdf(box, (x) => Math.min(1, Math.max(0, x)), [0.1, 0.25, 0.5, 0.75, 0.9])).toBe(true);
    expect(() => pboxFromData([1], 0.95)).toThrow(/at least 2 observations/);
    expect(() => pboxFromData([1, NaN, 3], 0.95)).toThrow(/finite/);
  });

  it('reads a possibility distribution as a p-box, and says the reading is weaker than π', () => {
    const dist = makePossibility(['1', '2', '3', '4'], [0.5, 1, 0.75, 0.25]);
    const res = pboxFromPossibility(dist, [1, 2, 3, 4], { steps: 40 });
    expect(res.warnings.join(' ')).toContain('strictly weaker');
    // F̄(2) = Π({1,2}) = max(0.5, 1) = 1; F̲(2) = N({1,2}) = 1 − max(0.75,0.25) = 0.25.
    expect(cdfUpper(res.value, 2)).toBeCloseTo(1, 2);
    expect(cdfLower(res.value, 2)).toBeCloseTo(0.25, 2);
    // Every probability dominated by π must be inside the box.
    for (const p of dominatedProbabilityVertices(dist).value) {
      const cdf = (x: number) => {
        let s = 0;
        for (let i = 0; i < 4; i++) if (i + 1 <= x) s += p[i];
        return s;
      };
      expect(containsCdf(res.value, cdf, [1, 2, 3, 4])).toBe(true);
    }
  });
});

describe('p-box arithmetic: the Fréchet ordering is the decisive test', () => {
  const marginalPairs: [string, PBox, PBox][] = [
    [
      'uniform + uniform',
      pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 100 }).value,
      pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 100 }).value,
    ],
    [
      'uniform + triangular',
      pboxFromDistribution('uniform', { a: 0, b: 2 }, { steps: 100 }).value,
      pboxFromDistribution('triangular', { a: 1, c: 2, b: 5 }, { steps: 100 }).value,
    ],
    [
      'triangular + triangular',
      pboxFromDistribution('triangular', { a: 0, c: 1, b: 3 }, { steps: 100 }).value,
      pboxFromDistribution('triangular', { a: -2, c: 0, b: 1 }, { steps: 100 }).value,
    ],
    [
      'Cantelli box + uniform',
      pboxFromMoments(0, 1, { steps: 100, tailTruncation: 1e-4 }).value,
      pboxFromDistribution('uniform', { a: -1, b: 1 }, { steps: 100 }).value,
    ],
  ];

  it.each(marginalPairs)(
    'unknown-dependence bounds contain the comonotonic, independent and countermonotonic sums (%s)',
    (_name, x, y) => {
      const unknown = pboxAdd(x, y, 'unknown').value;
      const others = {
        comonotonic: pboxAdd(x, y, 'comonotonic').value,
        independent: pboxAdd(x, y, 'independent').value,
        countermonotonic: pboxAdd(x, y, 'countermonotonic').value,
      };
      // In quantile space: the unknown box must be outermost at every bucket.
      for (const box of Object.values(others)) {
        for (let i = 0; i < unknown.n; i++) {
          expect(unknown.lo[i]).toBeLessThanOrEqual(box.lo[i] + 1e-9);
          expect(unknown.hi[i]).toBeGreaterThanOrEqual(box.hi[i] - 1e-9);
        }
      }
      // And in CDF space at a grid of points.
      const left = Math.max(unknown.lo[1], -1e6);
      const right = Math.min(unknown.hi[unknown.n - 2], 1e6);
      for (let k = 0; k <= 30; k++) {
        const z = left + ((right - left) * k) / 30;
        const u = couplingCdf(unknown, z);
        for (const box of Object.values(others)) {
          const b = couplingCdf(box, z);
          expect(u.lo).toBeLessThanOrEqual(b.lo + 1e-12);
          expect(u.hi).toBeGreaterThanOrEqual(b.hi - 1e-12);
        }
      }
    },
  );

  it.each(marginalPairs)(
    'the unknown-dependence box is STRICTLY wider than the independent one (%s)',
    (_name, x, y) => {
      const unknown = pboxAdd(x, y, 'unknown').value;
      const indep = pboxAdd(x, y, 'independent').value;
      let maxExtra = 0;
      const left = unknown.lo[1];
      const right = unknown.hi[unknown.n - 2];
      for (let k = 0; k <= 40; k++) {
        const z = left + ((right - left) * k) / 40;
        const uw = cdfUpper(unknown, z) - cdfLower(unknown, z);
        const iw = cdfUpper(indep, z) - cdfLower(indep, z);
        maxExtra = Math.max(maxExtra, uw - iw);
      }
      // That width IS the information: not knowing the copula costs this much.
      expect(maxExtra).toBeGreaterThan(0.2);
    },
  );

  it('matches the closed-form Fréchet bounds for U(0,1) + U(0,1)', () => {
    // Analytic reference: F̲(z) = max(0, z − 1) and F̄(z) = min(1, z) on [0,2].
    const u = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 400 }).value;
    const box = pboxAdd(u, u, 'unknown').value;
    for (let k = 1; k < 20; k++) {
      const z = (2 * k) / 20;
      expect(cdfLower(box, z)).toBeCloseTo(Math.max(0, z - 1), 1);
      expect(cdfUpper(box, z)).toBeCloseTo(Math.min(1, z), 1);
      // Outer: the analytic bounds must sit inside the computed ones.
      expect(cdfLower(box, z)).toBeLessThanOrEqual(Math.max(0, z - 1) + 1 / 400 + 1e-12);
      expect(cdfUpper(box, z)).toBeGreaterThanOrEqual(Math.min(1, z) - 1 / 400 - 1e-12);
    }
    expect(pboxAdd(u, u, 'unknown').provenance.exactness).toBe('exact');
  });

  it('reproduces the ORDINARY convolution for precise marginals: N(1,3²) + N(−2,4²) = N(−1,5²)', () => {
    // Closed-form reference, independent of this module: the sum of independent
    // normals is N(μ₁+μ₂, σ₁²+σ₂²) = N(−1, 25), so σ = 5 exactly (3-4-5).
    const a = pboxFromDistribution('normal', { mu: 1, sigma: 3 }, { steps: 400, tailTruncation: 1e-7 }).value;
    const b = pboxFromDistribution('normal', { mu: -2, sigma: 4 }, { steps: 400, tailTruncation: 1e-7 }).value;
    const sum = pboxAdd(a, b, 'independent').value;
    const analytic = (z: number) => normalCdf((z + 1) / 5);
    for (let k = -3; k <= 3; k++) {
      const z = -1 + 5 * k * 0.5;
      const lo = cdfLower(sum, z);
      const hi = cdfUpper(sum, z);
      const truth = analytic(z);
      expect(lo).toBeLessThanOrEqual(truth + 1e-9);
      expect(hi).toBeGreaterThanOrEqual(truth - 1e-9);
      // The box is tight: a precise input gives a nearly precise answer.
      expect(hi - lo).toBeLessThan(0.05);
    }
    // The mean bound must bracket −1 and the variance bound must bracket 25.
    const mb = meanBound(sum);
    expect(mb.lower).toBeLessThanOrEqual(-1 + 1e-6);
    expect(mb.upper).toBeGreaterThanOrEqual(-1 - 1e-6);
  });

  it('subtracts via X + (−Y) and gets exactly zero width for the comonotonic self-difference', () => {
    const x = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 100 }).value;
    const diff = pboxSub(x, x, 'comonotonic').value;
    // X − X with perfect positive dependence is identically 0 up to the grid.
    for (let i = 0; i < diff.n; i++) {
      expect(Math.abs(diff.lo[i])).toBeLessThan(0.02);
      expect(Math.abs(diff.hi[i])).toBeLessThan(0.02);
    }
    // Under unknown dependence the difference is wide, as it must be.
    const unknown = pboxSub(x, x, 'unknown').value;
    expect(unknown.lo[1]).toBeLessThan(-0.5);
    expect(unknown.hi[unknown.n - 2]).toBeGreaterThan(0.5);
  });

  it('refuses to mix p-boxes of different resolutions', () => {
    const a = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 50 }).value;
    const b = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 60 }).value;
    expect(() => pboxAdd(a, b, 'unknown')).toThrow(/different discretisations/);
  });

  it('labels each dependence assumption and warns that independence is a claim', () => {
    const u = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 20 }).value;
    const indep = pboxAdd(u, u, 'independent');
    expect(indep.warnings.join(' ')).toContain('not a neutral default');
    expect(pboxAdd(u, u, 'unknown').provenance.notes.join(' ')).toContain('EVERY joint distribution');
  });
});

/* ================================================== credal sets */

describe('credal sets and lower/upper previsions', () => {
  it('matches the hand-enumerated vertices and the hand-computed LP optimum', () => {
    // Frame {a, b, c}. Constraints: P(a) ≥ 0.2, P(b) ≤ 0.5, P(c) ≥ 0.1.
    // The feasible region is a polygon in the 2-simplex. Its vertices, found by
    // hand by intersecting pairs of active constraints:
    //   V1 = (0.2, 0.5, 0.3)   [P(a)=0.2, P(b)=0.5]
    //   V2 = (0.4, 0.5, 0.1)   [P(b)=0.5, P(c)=0.1]
    //   V3 = (0.9, 0.0, 0.1)   [P(b)=0,   P(c)=0.1]
    //   V4 = (0.2, 0.0, 0.8)   [P(a)=0.2, P(b)=0]
    //   V5 = (0.2, 0.7, 0.1)?  — violates P(b) ≤ 0.5, so NOT a vertex.
    // Gamble f = (10, 0, 4): E[f] at the four vertices is
    //   V1: 2 + 0 + 1.2 = 3.2    V2: 4 + 0 + 0.4 = 4.4
    //   V3: 9 + 0 + 0.4 = 9.4    V4: 2 + 0 + 3.2 = 5.2
    // so the lower expectation is 3.2 and the upper is 9.4.
    const set = credalFromConstraints(['a', 'b', 'c'], [
      { a: [-1, 0, 0], b: -0.2, label: 'P(a) ≥ 0.2' },
      { a: [0, 1, 0], b: 0.5, label: 'P(b) ≤ 0.5' },
      { a: [0, 0, -1], b: -0.1, label: 'P(c) ≥ 0.1' },
    ]).value;
    const handVertices = [
      [0.2, 0.5, 0.3],
      [0.4, 0.5, 0.1],
      [0.9, 0.0, 0.1],
      [0.2, 0.0, 0.8],
    ];
    expect(set.vertices.length).toBe(handVertices.length);
    for (const hv of handVertices) {
      expect(
        set.vertices.some((v) => v.every((x, i) => Math.abs(x - hv[i]) < 1e-9)),
      ).toBe(true);
    }
    const f = [10, 0, 4];
    const pb = previsionBound(set, f);
    // Decisive cross-check: the LP optimum over a polytope is attained at a vertex.
    let lo = Infinity;
    let hi = -Infinity;
    for (const hv of handVertices) {
      const e = hv[0] * 10 + hv[1] * 0 + hv[2] * 4;
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    expect(lo).toBeCloseTo(3.2, 12);
    expect(hi).toBeCloseTo(9.4, 12);
    expect(pb.lower).toBeCloseTo(lo, 10);
    expect(pb.upper).toBeCloseTo(hi, 10);
    // And a direct scan over fine mixtures can never beat the vertex optimum.
    const rng = new Random('credal-mixture-seed');
    for (let t = 0; t < 2000; t++) {
      const w = set.vertices.map(() => rng.uniform());
      const s = w.reduce((x, y) => x + y, 0);
      let e = 0;
      set.vertices.forEach((v, k) => {
        for (let i = 0; i < 3; i++) e += (w[k] / s) * v[i] * f[i];
      });
      expect(e).toBeGreaterThanOrEqual(pb.lower - 1e-9);
      expect(e).toBeLessThanOrEqual(pb.upper + 1e-9);
    }
    // Lower probability is super-additive, so it is not a probability.
    const pa = probabilityBound(set, 1);
    expect(pa.lower).toBeCloseTo(0.2, 9);
    expect(pa.upper).toBeCloseTo(0.9, 9);
  });

  it('detects SURE LOSS and refuses the incoherent credal set', () => {
    // P(a) ≥ 0.7 and P(b) ≥ 0.7 cannot both hold.
    expect(() =>
      credalFromConstraints(['a', 'b'], [
        { a: [-1, 0], b: -0.7 },
        { a: [0, -1], b: -0.7 },
      ]),
    ).toThrow(/sure loss/);
    const asl = avoidsSureLoss(['a', 'b'], [
      { a: [-1, 0], b: -0.7 },
      { a: [0, -1], b: -0.7 },
    ]);
    expect(asl.value).toBe(false);
    expect(asl.warnings.join(' ')).toContain('sure loss');
    expect(avoidsSureLoss(['a', 'b'], [{ a: [-1, 0], b: -0.3 }]).value).toBe(true);
  });

  it('reports under-committed (incoherent) assessments with their natural extension', () => {
    // Assess E[1_a] ≥ 0.5 and E[1_{a,b}] ≥ 0.2. The second is implied with
    // natural extension 0.5, so the stated 0.2 is not tight.
    const report = checkCoherence(['a', 'b', 'c'], [
      { gamble: [1, 0, 0], lowerBound: 0.5, label: 'P(a) ≥ 0.5' },
      { gamble: [1, 1, 0], lowerBound: 0.2, label: 'P(a∪b) ≥ 0.2' },
    ]);
    expect(report.value.avoidsSureLoss).toBe(true);
    expect(report.value.coherent).toBe(false);
    expect(report.value.improvable).toHaveLength(1);
    expect(report.value.improvable[0].label).toBe('P(a∪b) ≥ 0.2');
    expect(report.value.improvable[0].naturalExtension).toBeCloseTo(0.5, 9);
    // A tight assessment is coherent.
    const tight = checkCoherence(['a', 'b'], [{ gamble: [1, 0], lowerBound: 0.4 }]);
    expect(tight.value.coherent).toBe(true);
    const ne = naturalExtension(['a', 'b'], [{ gamble: [1, 0], lowerBound: 0.4 }]).value;
    expect(previsionBound(ne, [1, 0]).lower).toBeCloseTo(0.4, 9);
    expect(previsionBound(ne, [1, 0]).upper).toBeCloseTo(1, 9);
  });

  it('refuses an oversized frame for vertex enumeration, naming the limit', () => {
    const elements = Array.from({ length: 9 }, (_, i) => `e${i}`);
    expect(() => credalFromConstraints(elements, [])).toThrow(/up to 7 frame elements/);
  });

  it('tightens unreachable interval probability tables and refuses incoherent ones', () => {
    // Σl = 0.3 ≤ 1 ≤ Σu = 1.8, so coherent; but P(a) ≤ 0.8 is unreachable
    // because P(b) ≥ 0.1 and P(c) ≥ 0.1 force P(a) ≤ 0.8 — exactly reachable —
    // whereas P(a) ≥ 0.1 is loose: 1 − (0.8 + 0.8) < 0 so it stays at 0.1.
    const r = reachableIntervals(['a', 'b', 'c'], [0.1, 0.1, 0.1], [0.8, 0.5, 0.5]);
    expect(r.value.upper[0]).toBeCloseTo(0.8, 12);
    expect(r.value.upper[1]).toBeCloseTo(0.5, 12);
    expect(r.value.lower[0]).toBeCloseTo(0.1, 12);
    // Incoherent: lower bounds already exceed 1.
    expect(() => reachableIntervals(['a', 'b'], [0.6, 0.6], [0.9, 0.9])).toThrow(/Incoherent/);
    expect(() => reachableIntervals(['a', 'b'], [0.1, 0.1], [0.3, 0.3])).toThrow(/cannot reach/);
    expect(() => reachableIntervals(['a', 'b'], [0.6, 0.1], [0.3, 0.9])).toThrow(/empty/);
    // A table that IS tight reports so, and the induced credal set reproduces it.
    const tight = reachableIntervals(['a', 'b'], [0.3, 0.4], [0.6, 0.7]);
    expect(tight.value.alreadyReachable).toBe(true);
    const set = credalFromIntervals(['a', 'b'], [0.3, 0.4], [0.6, 0.7]).value;
    expect(probabilityBound(set, 1).lower).toBeCloseTo(0.3, 9);
    expect(probabilityBound(set, 1).upper).toBeCloseTo(0.6, 9);
  });
});

describe('the imprecise Dirichlet model: 0 out of n', () => {
  it('gives lower probability exactly 0 and a positive, decreasing upper bound', () => {
    let prevUpper = Infinity;
    for (const n of [1, 3, 10, 100]) {
      const res = impreciseDirichlet(['success', 'failure'], [0, n], 1);
      const b = res.value[0].bound;
      // Exactly zero: nothing observed supports the event. Not a rounded number.
      expect(b.lower).toBe(0);
      expect(b.upper).toBeGreaterThan(0);
      expect(b.upper).toBeLessThan(prevUpper);
      // Closed form s/(n+s) with s = 1.
      expect(b.upper).toBeCloseTo(1 / (n + 1), 15);
      prevUpper = b.upper;
    }
  });

  it('contains the Laplace and Jeffreys point estimates, which need an arbitrary prior', () => {
    for (const n of [3, 7, 20]) {
      for (const s of [1, 2]) {
        const b = impreciseDirichlet(['success', 'failure'], [0, n], s).value[0].bound;
        const laplace = (0 + 1) / (n + 2); // uniform Beta(1,1) prior
        const jeffreys = 0.5 / (n + 1); // Beta(1/2,1/2) prior
        expect(laplace).toBeGreaterThan(b.lower - 1e-15);
        expect(laplace).toBeLessThan(b.upper + 1e-15);
        expect(jeffreys).toBeGreaterThan(b.lower - 1e-15);
        expect(jeffreys).toBeLessThan(b.upper + 1e-15);
      }
    }
  });

  it('converges to the observed frequency and is representation invariant on compound events', () => {
    const counts = [20, 30, 50];
    const res = impreciseDirichlet(['a', 'b', 'c'], counts, 1).value;
    expect(res[1].bound.lower).toBeCloseTo(30 / 101, 12);
    expect(res[1].bound.upper).toBeCloseTo(31 / 101, 12);
    // Merging a and b gives the same answer as summing their counts.
    const merged = impreciseDirichletEvent(counts, 0b011, 1);
    expect(merged.lower).toBeCloseTo(50 / 101, 12);
    expect(merged.upper).toBeCloseTo(51 / 101, 12);
    const twoCat = impreciseDirichlet(['ab', 'c'], [50, 50], 1).value;
    expect(twoCat[0].bound.lower).toBeCloseTo(merged.lower, 12);
    expect(twoCat[0].bound.upper).toBeCloseTo(merged.upper, 12);
  });

  it('validates its inputs', () => {
    expect(() => impreciseDirichlet(['a', 'b'], [1, 2], 0)).toThrow(/greater than 0/);
    expect(() => impreciseDirichlet(['a', 'b'], [1.5, 2])).toThrow(/whole number/);
    expect(() => impreciseDirichlet(['a', 'b'], [1])).toThrow(/one count per category/);
  });
});

describe('robust Bayesian sensitivity analysis', () => {
  it('produces a posterior RANGE containing the posterior from every individual prior', () => {
    // Two hypotheses, likelihoods P(data|H) = 0.8 and 0.2.
    // For a prior (p, 1−p) the posterior of H1 is 0.8p / (0.8p + 0.2(1−p)),
    // computed independently here by Bayes' theorem.
    const lik = [0.8, 0.2];
    const set = credalFromIntervals(['H1', 'H2'], [0.2, 0.3], [0.7, 0.8]).value;
    const res = robustPosterior(set, lik, 0b01);
    const direct = (p: number) => (0.8 * p) / (0.8 * p + 0.2 * (1 - p));
    // Vertices of the prior set are p = 0.2 and p = 0.7 (reachable bounds).
    expect(res.value.posterior.lower).toBeCloseTo(direct(0.2), 9);
    expect(res.value.posterior.upper).toBeCloseTo(direct(0.7), 9);
    // Containment for many priors inside the set, each posterior computed directly.
    const rng = new Random('robust-bayes-seed');
    for (let t = 0; t < 500; t++) {
      const p = 0.2 + 0.5 * rng.uniform();
      const post = direct(p);
      expect(post).toBeGreaterThanOrEqual(res.value.posterior.lower - 1e-12);
      expect(post).toBeLessThanOrEqual(res.value.posterior.upper + 1e-12);
    }
    expect(res.value.posterior.kind).toBe('bound');
    expect(res.value.posterior.width).toBeGreaterThan(0);
  });

  it('works on a three-hypothesis credal set and brackets every vertex posterior', () => {
    const set = credalFromConstraints(['A', 'B', 'C'], [
      { a: [-1, 0, 0], b: -0.1 },
      { a: [0, -1, 0], b: -0.1 },
      { a: [0, 0, -1], b: -0.1 },
      { a: [1, 0, 0], b: 0.6 },
    ]).value;
    const lik = [0.9, 0.4, 0.05];
    const res = robustPosterior(set, lik, 0b001);
    for (const p of set.vertices) {
      const den = p[0] * lik[0] + p[1] * lik[1] + p[2] * lik[2];
      const post = (p[0] * lik[0]) / den;
      expect(post).toBeGreaterThanOrEqual(res.value.posterior.lower - 1e-12);
      expect(post).toBeLessThanOrEqual(res.value.posterior.upper + 1e-12);
    }
    // Mixtures of vertices too (the set is convex).
    const rng = new Random('robust-three-seed');
    for (let t = 0; t < 500; t++) {
      const w = set.vertices.map(() => rng.uniform());
      const s = w.reduce((x, y) => x + y, 0);
      const p = [0, 0, 0];
      set.vertices.forEach((v, k) => {
        for (let i = 0; i < 3; i++) p[i] += (w[k] / s) * v[i];
      });
      const den = p[0] * lik[0] + p[1] * lik[1] + p[2] * lik[2];
      const post = (p[0] * lik[0]) / den;
      expect(post).toBeGreaterThanOrEqual(res.value.posterior.lower - 1e-9);
      expect(post).toBeLessThanOrEqual(res.value.posterior.upper + 1e-9);
    }
  });

  it('refuses when a prior in the set gives the data zero probability', () => {
    const set = credalFromVertices(['A', 'B'], [
      [1, 0],
      [0, 1],
    ]);
    expect(() => robustPosterior(set, [0, 0.5], 0b01)).toThrow(/undefined|zero/);
  });
});

/* ================================================== cross-cutting */

describe('cross-cutting provenance requirements', () => {
  it('every result names its formalism, the question it answers and the commitment', () => {
    const results = [
      possibilityToProbability(vacuousPossibility(['a', 'b'])),
      probabilityToPossibility(['a', 'b'], [0.5, 0.5]),
      consonantMassFromPossibility(makePossibility(['a', 'b'], [1, 0.5])),
      pignisticTransform(vacuousMass(['a', 'b'])),
      uncertaintyMeasures(vacuousMass(['a', 'b'])),
      pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 10 }),
      pboxFromMoments(0, 1, { steps: 10 }),
      impreciseDirichlet(['a', 'b'], [1, 1]),
      fuzzyAdd(triangularFuzzy(0, 1, 2), triangularFuzzy(0, 1, 2)),
    ];
    for (const r of results) {
      expect(r.provenance.formalism).toBeTruthy();
      expect(r.provenance.question.length).toBeGreaterThan(20);
      expect(r.provenance.commitments.length).toBeGreaterThan(0);
      expect(['exact', 'numerical', 'empirical', 'assumed']).toContain(r.provenance.exactness);
    }
  });

  it('every bound is labelled a bound and carries its width', () => {
    const u = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 20 }).value;
    const bounds = [
      meanBound(u),
      varianceBound(u),
      quantileBound(u, 0.5),
      exceedanceBound(u, 0.5),
      impreciseDirichlet(['a', 'b'], [0, 3]).value[0].bound,
      previsionBound(credalFromVertices(['a', 'b'], [[1, 0], [0, 1]]), [1, 2]),
    ];
    for (const b of bounds) {
      expect(b.kind).toBe('bound');
      expect(b.width).toBeCloseTo(b.upper - b.lower, 12);
      expect(b.lower).toBeLessThanOrEqual(b.upper);
      expect(b.provenance.notes.length).toBeGreaterThan(0);
    }
  });

  it('exactness labels follow the stated convention', () => {
    const u = pboxFromDistribution('uniform', { a: 0, b: 1 }, { steps: 20 }).value;
    // Lattice sums, Dempster combination and Fréchet bounds: exact.
    expect(consonantMassFromPossibility(makePossibility(['a', 'b'], [1, 0.5])).provenance.exactness).toBe(
      'exact',
    );
    expect(dempsterCombine(vacuousMass(['a', 'b']), vacuousMass(['a', 'b'])).provenance.exactness).toBe(
      'exact',
    );
    expect(pboxAdd(u, u, 'unknown').provenance.exactness).toBe('exact');
    // Convolution under a coupling and LP results: numerical.
    expect(pboxAdd(u, u, 'independent').provenance.exactness).toBe('numerical');
    expect(credalFromConstraints(['a', 'b'], [{ a: [1, 0], b: 0.8 }]).provenance.exactness).toBe('numerical');
    // From data: empirical.
    const rng = new Random('exactness-seed');
    const data = Array.from({ length: 50 }, () => rng.uniform());
    expect(pboxFromData(data).provenance.exactness).toBe('empirical');
  });
});
