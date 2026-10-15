/**
 * Reliability engine tests.
 *
 * Every reference value here is independent of the implementation: either
 * hand-computed in a comment, taken from a textbook closed form, or computed
 * in the test by a deliberately different route (exhaustive enumeration,
 * pivotal decomposition, direct series summation).
 */

import { describe, it, expect } from 'vitest';
import type { Moment } from '../distributions/types';
import { EngineError } from '../core/result';
import { gammaFn, normalCdf } from '../special/gamma';
import { Random } from '../random/rng';
import {
  bridgeNetwork,
  esaryProschanBounds,
  kOfNReliability,
  minimalCutSets,
  minimalPathSets,
  networkMinimalCuts,
  networkMinimalPaths,
  networkReliability,
  networkReliabilityByFactoring,
  reliabilityFromPathSets,
  structureReliability,
  systemReliability,
  unreliabilityFromCutSets,
  type Structure,
} from './structures';
import { importanceMeasures } from './importance';
import {
  faultTreeMinimalCutSets,
  faultTreeProbability,
  rareEventApproximation,
  validateFaultTree,
  type FaultTree,
} from './faulttree';
import {
  availability,
  betaFactorCommonCause,
  classifyWeibullShape,
  cumulativeHazard,
  hazardAt,
  lifetimeModel,
  mttf,
  redundancyReliability,
  reliabilityAt,
  stressStrengthReliability,
  systemAvailability,
  weibullMttf,
} from './lifetime';
import {
  fitExponentialCensored,
  fitWeibullCensored,
  prepareSample,
  reliabilityGrowth,
  sparesRequired,
  weibullProbabilityPlot,
  type LifetimeObservation,
} from './fitting';

/**
 * Unwrap a `Moment` that the test expects to be defined, failing loudly rather
 * than silently comparing against undefined if the measure is unavailable.
 */
function moment(m: Moment | undefined): number {
  if (!m) throw new Error('expected a measure, got undefined');
  if (!m.defined) throw new Error(`expected a defined measure, got: ${m.reason}`);
  return m.value;
}

// ---------------------------------------------------------------------------
// Independent reference helpers, written only for the tests.
// ---------------------------------------------------------------------------

const series = (...ids: string[]): Structure => ({
  kind: 'series',
  children: ids.map((id) => ({ kind: 'component', id }) as Structure),
});
const parallel = (...ids: string[]): Structure => ({
  kind: 'parallel',
  children: ids.map((id) => ({ kind: 'component', id }) as Structure),
});
const comp = (id: string): Structure => ({ kind: 'component', id });

/** Binomial survival P(X ≥ k) for X ~ Bin(n, p), summed directly from the pmf. */
function binomialSurvival(k: number, n: number, p: number): number {
  let total = 0;
  for (let i = k; i <= n; i += 1) {
    let c = 1;
    for (let j = 0; j < i; j += 1) c = (c * (n - j)) / (j + 1);
    total += c * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return total;
}

/**
 * Exact reliability by exhaustive enumeration over all 2^n component states.
 * This is the independent reference for everything structural: it shares no
 * code with the DP convolution, inclusion–exclusion or pivotal decomposition.
 */
function enumerateExact(ids: readonly string[], rs: readonly number[], works: (up: boolean[]) => boolean): number {
  const n = ids.length;
  let total = 0;
  for (let mask = 0; mask < 1 << n; mask += 1) {
    const up: boolean[] = [];
    let w = 1;
    for (let i = 0; i < n; i += 1) {
      const on = (mask & (1 << i)) !== 0;
      up.push(on);
      w *= on ? rs[i] : 1 - rs[i];
    }
    if (works(up)) total += w;
  }
  return total;
}

describe('reliability: system structures', () => {
  it('series of n identical components is exactly r^n', () => {
    const r = 0.97;
    for (const n of [1, 2, 3, 5, 8]) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const rels = Object.fromEntries(ids.map((id) => [id, r]));
      expect(structureReliability(series(...ids), rels)).toBeCloseTo(Math.pow(r, n), 15);
    }
  });

  it('parallel of n identical components is exactly 1 − (1 − r)^n', () => {
    const r = 0.8;
    for (const n of [1, 2, 4, 7]) {
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      const rels = Object.fromEntries(ids.map((id) => [id, r]));
      expect(structureReliability(parallel(...ids), rels)).toBeCloseTo(1 - Math.pow(1 - r, n), 15);
    }
  });

  it('hand-checked 3-component mixed structure', () => {
    // Structure: A in series with (B parallel C).
    // r_A = 0.9, r_B = 0.8, r_C = 0.7.
    // B∥C = 1 − (0.2)(0.3) = 1 − 0.06 = 0.94.
    // System = 0.9 × 0.94 = 0.846  (exact decimal).
    const structure: Structure = { kind: 'series', children: [comp('A'), parallel('B', 'C')] };
    const got = structureReliability(structure, { A: 0.9, B: 0.8, C: 0.7 });
    expect(Math.abs(got - 0.846)).toBeLessThan(1e-12);
  });

  it('reports that independence was assumed', () => {
    const result = systemReliability(series('a', 'b'), { a: 0.9, b: 0.9 });
    expect(result.independenceAssumed).toBe(true);
    expect(result.independenceNote).toMatch(/independent/i);
    expect(result.exactness).toBe('exact');
    expect(result.componentIds).toEqual(['a', 'b']);
  });

  it('evaluates a deeply nested structure without overflowing the stack', () => {
    // 5000-deep right-nested series of components, all r = 1 except one at 0.5.
    let node: Structure = comp('deep');
    for (let i = 0; i < 5000; i += 1) node = { kind: 'series', children: [comp(`pad${i}`), node] };
    const rels: Record<string, number> = { deep: 0.5 };
    for (let i = 0; i < 5000; i += 1) rels[`pad${i}`] = 1;
    // Depth exceeds the declared limit, so it must be refused — not crash.
    expect(() => structureReliability(node, rels)).toThrow(EngineError);
    expect(() => structureReliability(node, rels)).toThrow(/depth limit/i);
  });

  it('evaluates a structure at the edge of the depth limit', () => {
    let node: Structure = comp('deep');
    for (let i = 0; i < 40; i += 1) node = { kind: 'series', children: [comp(`pad${i}`), node] };
    const rels: Record<string, number> = { deep: 0.5 };
    for (let i = 0; i < 40; i += 1) rels[`pad${i}`] = 1;
    expect(structureReliability(node, rels)).toBeCloseTo(0.5, 15);
  });
});

describe('reliability: k-of-n', () => {
  it('matches the binomial survival function for identical components', () => {
    for (const n of [3, 5, 8]) {
      for (let k = 1; k <= n; k += 1) {
        for (const p of [0.1, 0.5, 0.85, 0.99]) {
          const got = kOfNReliability(k, Array.from({ length: n }, () => p));
          expect(got).toBeCloseTo(binomialSurvival(k, n, p), 13);
        }
      }
    }
  });

  it('the non-identical DP matches exact enumeration over all 2^6 states', () => {
    // Independent reference: enumerate every one of the 64 up/down states.
    const rs = [0.91, 0.62, 0.77, 0.45, 0.99, 0.38];
    const ids = rs.map((_, i) => `c${i}`);
    for (let k = 1; k <= 6; k += 1) {
      const reference = enumerateExact(ids, rs, (up) => up.filter(Boolean).length >= k);
      expect(kOfNReliability(k, rs)).toBeCloseTo(reference, 14);
    }
  });

  it('1-of-n equals parallel and n-of-n equals series', () => {
    const rs = [0.8, 0.6, 0.95];
    expect(kOfNReliability(1, rs)).toBeCloseTo(1 - 0.2 * 0.4 * 0.05, 15);
    expect(kOfNReliability(3, rs)).toBeCloseTo(0.8 * 0.6 * 0.95, 15);
  });

  it('a nested k-of-n structure matches exact enumeration', () => {
    // 2-of-3 over: {A}, {B series C}, {D parallel E}
    const rs = { A: 0.8, B: 0.9, C: 0.7, D: 0.6, E: 0.5 };
    const structure: Structure = {
      kind: 'kofn',
      k: 2,
      children: [comp('A'), series('B', 'C'), parallel('D', 'E')],
    };
    const ids = ['A', 'B', 'C', 'D', 'E'] as const;
    const reference = enumerateExact(
      ids,
      ids.map((i) => rs[i]),
      ([a, b, c, d, e]) => [a, b && c, d || e].filter(Boolean).length >= 2,
    );
    expect(structureReliability(structure, rs)).toBeCloseTo(reference, 14);
  });
});

describe('reliability: the classic bridge network', () => {
  // Pivotal decomposition on the bridging component c3, written out here as the
  // independent reference. With c3 up, nodes a and b merge:
  //   (c1 ∥ c2) in series with (c4 ∥ c5)
  // With c3 down:
  //   (c1·c4) ∥ (c2·c5)
  function bridgeByFactoring(r1: number, r2: number, r3: number, r4: number, r5: number): number {
    const up = (1 - (1 - r1) * (1 - r2)) * (1 - (1 - r4) * (1 - r5));
    const down = 1 - (1 - r1 * r4) * (1 - r2 * r5);
    return r3 * up + (1 - r3) * down;
  }

  it('all components at r = 0.9 gives the known exact value 0.97848', () => {
    // Textbook closed form for the identical-component bridge:
    //   R = 2r⁵ − 5r⁴ + 2r³ + 2r²
    // At r = 0.9: 2(0.59049) − 5(0.6561) + 2(0.729) + 2(0.81) = 0.97848 exactly.
    const r = 0.9;
    const closedForm = 2 * r ** 5 - 5 * r ** 4 + 2 * r ** 3 + 2 * r ** 2;
    expect(Math.abs(closedForm - 0.97848)).toBeLessThan(1e-12);

    const rels = { c1: r, c2: r, c3: r, c4: r, c5: r };
    const result = networkReliability(bridgeNetwork(), rels);
    expect(Math.abs(result.reliability - 0.97848)).toBeLessThan(1e-12);
    expect(Math.abs(result.reliability - bridgeByFactoring(r, r, r, r, r))).toBeLessThan(1e-12);
    expect(result.exactness).toBe('exact');
    expect(result.independenceAssumed).toBe(true);
  });

  it('non-identical bridge: inclusion–exclusion, factoring and enumeration all agree', () => {
    const rels = { c1: 0.95, c2: 0.8, c3: 0.6, c4: 0.9, c5: 0.75 };
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;
    const reference = enumerateExact(
      ids,
      ids.map((i) => rels[i]),
      ([x1, x2, x3, x4, x5]) =>
        (x1 && x4) || (x2 && x5) || (x1 && x3 && x5) || (x2 && x3 && x4),
    );
    const viaPaths = networkReliability(bridgeNetwork(), rels).reliability;
    expect(Math.abs(viaPaths - reference)).toBeLessThan(1e-12);
    expect(Math.abs(networkReliabilityByFactoring(bridgeNetwork(), rels) - reference)).toBeLessThan(1e-12);
    expect(
      Math.abs(bridgeByFactoring(rels.c1, rels.c2, rels.c3, rels.c4, rels.c5) - reference),
    ).toBeLessThan(1e-12);
  });

  it('a repeated-component structure (the path-set form) is still exact', () => {
    // The bridge written as the union of its 4 minimal paths. Components repeat,
    // so a naive product formula would double count; pivotal decomposition must
    // recover the same exact answer.
    const rels = { c1: 0.95, c2: 0.8, c3: 0.6, c4: 0.9, c5: 0.75 };
    const pathForm: Structure = {
      kind: 'parallel',
      children: [series('c1', 'c4'), series('c2', 'c5'), series('c1', 'c3', 'c5'), series('c2', 'c3', 'c4')],
    };
    const exact = networkReliability(bridgeNetwork(), rels).reliability;
    expect(Math.abs(structureReliability(pathForm, rels) - exact)).toBeLessThan(1e-12);
  });

  it('enumerates the four minimal paths and the four minimal cuts', () => {
    const paths = networkMinimalPaths(bridgeNetwork()).map((p) => p.join('')).sort();
    expect(paths).toEqual(['c1c3c5', 'c1c4', 'c2c3c4', 'c2c5'].sort());
    const cuts = networkMinimalCuts(bridgeNetwork()).map((c) => c.join('')).sort();
    expect(cuts).toEqual(['c1c2', 'c1c3c5', 'c2c3c4', 'c4c5'].sort());
  });
});

describe('reliability: minimal sets and bounds', () => {
  it('minimal path and cut sets of a mixed structure are the hand-derived ones', () => {
    // A series (B ∥ C): paths {A,B} and {A,C}; cuts {A} and {B,C}.
    const structure: Structure = { kind: 'series', children: [comp('A'), parallel('B', 'C')] };
    expect(minimalPathSets(structure).map((s) => s.join('')).sort()).toEqual(['AB', 'AC']);
    expect(minimalCutSets(structure).map((s) => s.join('')).sort()).toEqual(['A', 'BC']);
  });

  it('inclusion–exclusion over path sets and over cut sets both match enumeration', () => {
    const structure: Structure = {
      kind: 'parallel',
      children: [series('a', 'b'), { kind: 'kofn', k: 2, children: [comp('c'), comp('d'), comp('e')] }],
    };
    const rels = { a: 0.9, b: 0.85, c: 0.7, d: 0.6, e: 0.5 };
    const ids = ['a', 'b', 'c', 'd', 'e'] as const;
    const reference = enumerateExact(
      ids,
      ids.map((i) => rels[i]),
      ([a, b, c, d, e]) => (a && b) || [c, d, e].filter(Boolean).length >= 2,
    );
    expect(Math.abs(reliabilityFromPathSets(minimalPathSets(structure), rels) - reference)).toBeLessThan(1e-12);
    expect(Math.abs(1 - unreliabilityFromCutSets(minimalCutSets(structure), rels) - reference)).toBeLessThan(1e-12);
    expect(Math.abs(structureReliability(structure, rels) - reference)).toBeLessThan(1e-12);
  });

  it('Esary–Proschan bounds bracket the exact value and are labelled as bounds', () => {
    const rels = { c1: 0.95, c2: 0.8, c3: 0.6, c4: 0.9, c5: 0.75 };
    const pathForm: Structure = {
      kind: 'parallel',
      children: [series('c1', 'c4'), series('c2', 'c5'), series('c1', 'c3', 'c5'), series('c2', 'c3', 'c4')],
    };
    const exact = networkReliability(bridgeNetwork(), rels).reliability;
    const bounds = esaryProschanBounds(pathForm, rels);
    expect(bounds.isBound).toBe(true);
    expect(bounds.exactness).toBe('numerical');
    expect(bounds.note).toMatch(/bounds, not the reliability/i);
    // Hand-computed for these reliabilities.
    //   cuts {c1,c2}=0.01, {c4,c5}=0.025, {c1,c3,c5}=0.005, {c2,c3,c4}=0.008
    //   lower = 0.99·0.975·0.995·0.992 = 0.95265...
    //   paths 0.855, 0.6, 0.4275, 0.432
    //   upper = 1 − 0.145·0.4·0.5725·0.568 = 0.98114...
    expect(bounds.lower).toBeCloseTo(0.99 * 0.975 * 0.995 * 0.992, 12);
    expect(bounds.upper).toBeCloseTo(1 - 0.145 * 0.4 * 0.5725 * 0.568, 12);
    expect(bounds.lower).toBeLessThanOrEqual(exact + 1e-15);
    expect(bounds.upper).toBeGreaterThanOrEqual(exact - 1e-15);
  });

  it('the bounds are exact when paths and cuts share no components', () => {
    // Two independent parallel branches sharing nothing: both bounds are tight.
    const structure: Structure = parallel('a', 'b');
    const bounds = esaryProschanBounds(structure, { a: 0.6, b: 0.7 });
    expect(bounds.lower).toBeCloseTo(1 - 0.4 * 0.3, 14);
    expect(bounds.upper).toBeCloseTo(1 - 0.4 * 0.3, 14);
  });
});

describe('reliability: importance measures', () => {
  it('Birnbaum importance in a series system is the product of the other reliabilities', () => {
    // Analytic: R_sys = Π r_j, so ∂R/∂r_i = Π_{j≠i} r_j exactly.
    const rels = { a: 0.9, b: 0.8, c: 0.95 };
    const result = importanceMeasures(series('a', 'b', 'c'), rels);
    const byId = new Map(result.components.map((c) => [c.id, c]));
    expect(Math.abs((byId.get('a')?.birnbaum ?? 0) - 0.8 * 0.95)).toBeLessThan(1e-15);
    expect(Math.abs((byId.get('b')?.birnbaum ?? 0) - 0.9 * 0.95)).toBeLessThan(1e-15);
    expect(Math.abs((byId.get('c')?.birnbaum ?? 0) - 0.9 * 0.8)).toBeLessThan(1e-15);
    // In a series system the least reliable component matters most.
    expect(result.birnbaumRanking[0]).toBe('b');
  });

  it('in a parallel system Birnbaum importance orders the components by their own reliability', () => {
    // Analytic: for a parallel system R = 1 − Π(1 − r_j), so
    //   ∂R/∂r_i = Π_{j≠i} (1 − r_j).
    // That product is LARGEST for the component whose partners are most
    // reliable — which, with distinct reliabilities, is the most reliable
    // component itself. Ordered from least to most important, the most reliable
    // component therefore comes last. Values here are hand-computed:
    //   a: (1−0.7)(1−0.99) = 0.003
    //   b: (1−0.5)(1−0.99) = 0.005
    //   c: (1−0.5)(1−0.7)  = 0.15
    const rels = { a: 0.5, b: 0.7, c: 0.99 };
    const result = importanceMeasures(parallel('a', 'b', 'c'), rels);
    const byId = new Map(result.components.map((c) => [c.id, c]));
    expect(byId.get('a')?.birnbaum).toBeCloseTo(0.003, 15);
    expect(byId.get('b')?.birnbaum).toBeCloseTo(0.005, 15);
    expect(byId.get('c')?.birnbaum).toBeCloseTo(0.15, 15);
    // Ascending importance puts the most reliable component last.
    const ascending = [...result.birnbaumRanking].reverse();
    expect(ascending).toEqual(['a', 'b', 'c']);
    expect(ascending[ascending.length - 1]).toBe('c');
    // Criticality importance, by contrast, is exactly 1 for every component of
    // a parallel system: Π q_j / Q_sys = 1.
    for (const c of result.components) {
      expect(c.criticality.defined).toBe(true);
      if (c.criticality.defined) expect(c.criticality.value).toBeCloseTo(1, 12);
    }
  });

  it('Fussell–Vesely, RAW and RRW are consistent with the exact system values', () => {
    const structure: Structure = { kind: 'series', children: [comp('A'), parallel('B', 'C')] };
    const rels = { A: 0.9, B: 0.8, C: 0.7 };
    const result = importanceMeasures(structure, rels);
    const byId = new Map(result.components.map((c) => [c.id, c]));
    const qSys = 1 - 0.846;
    // A is in the single-component cut set {A}: FV_A = q_A / Q_sys = 0.1/0.154.
    expect(moment(byId.get('A')?.fussellVesely)).toBeCloseTo(0.1 / qSys, 12);
    // Cut set {B,C}: FV_B = q_B·q_C / Q_sys = 0.06/0.154.
    expect(moment(byId.get('B')?.fussellVesely)).toBeCloseTo(0.06 / qSys, 12);
    // RAW_A: with A certain to fail the system fails, so Q = 1 and RAW = 1/Q_sys.
    expect(moment(byId.get('A')?.riskAchievementWorth)).toBeCloseTo(1 / qSys, 12);
    // RRW_A: with A perfect, Q = 0.06, so RRW = 0.154/0.06.
    expect(moment(byId.get('A')?.riskReductionWorth)).toBeCloseTo(qSys / 0.06, 12);
    // Criticality = Birnbaum · q / Q_sys; Birnbaum_A = 0.94.
    expect(moment(byId.get('A')?.criticality)).toBeCloseTo((0.94 * 0.1) / qSys, 12);
    expect(result.independenceAssumed).toBe(true);
  });

  it('does not invent importance numbers for a perfectly reliable system', () => {
    const result = importanceMeasures(parallel('a', 'b'), { a: 1, b: 1 });
    // A perfectly reliable system makes these measures undefined, and the
    // reason must travel with them so the interface can explain itself.
    expect(result.components[0].criticality.defined).toBe(false);
    if (!result.components[0].criticality.defined) {
      expect(result.components[0].criticality.reason).toMatch(/cannot fail/);
    }
    expect(result.components[0].riskAchievementWorth.defined).toBe(false);
    expect(result.notes.join(' ')).toMatch(/undefined/i);
  });
});

describe('reliability: fault trees', () => {
  // Hand-built tree:
  //   TOP = OR(G1, G2)
  //   G1  = AND(e1, e2)
  //   G2  = AND(e2, e3)
  // Hand-derived minimal cut sets: {e1,e2} and {e2,e3}.
  const tree: FaultTree = {
    topId: 'TOP',
    nodes: [
      { id: 'TOP', kind: 'or', children: ['G1', 'G2'] },
      { id: 'G1', kind: 'and', children: ['e1', 'e2'] },
      { id: 'G2', kind: 'and', children: ['e2', 'e3'] },
      { id: 'e1', kind: 'basic', probability: 0.1 },
      { id: 'e2', kind: 'basic', probability: 0.2 },
      { id: 'e3', kind: 'basic', probability: 0.3 },
    ],
  };

  it('minimal cut sets match the hand-derived list exactly', () => {
    expect(faultTreeMinimalCutSets(tree).map((c) => c.join(',')).sort()).toEqual(['e1,e2', 'e2,e3']);
  });

  it('exact top-event probability matches direct enumeration', () => {
    // Enumeration over the 8 basic-event states, written independently.
    const ids = ['e1', 'e2', 'e3'];
    const ps = [0.1, 0.2, 0.3];
    const reference = enumerateExact(ids, ps, ([a, b, c]) => (a && b) || (b && c));
    // Also by hand: P = q2(q1 + q3 − q1q3) = 0.2(0.1 + 0.3 − 0.03) = 0.2·0.37 = 0.074.
    expect(reference).toBeCloseTo(0.074, 14);
    const result = faultTreeProbability(tree);
    expect(Math.abs(result.topEventProbability - reference)).toBeLessThan(1e-12);
    expect(result.exactness).toBe('exact');
    expect(result.method).toBe('inclusion-exclusion over minimal cut sets');
  });

  it('the rare-event approximation overestimates and says so', () => {
    const exact = faultTreeProbability(tree).topEventProbability;
    const rare = rareEventApproximation(tree);
    // Σ cut probabilities = 0.1·0.2 + 0.2·0.3 = 0.02 + 0.06 = 0.08 > 0.074.
    expect(rare.value).toBeCloseTo(0.08, 14);
    expect(rare.value).toBeGreaterThanOrEqual(exact);
    expect(rare.isApproximation).toBe(true);
    expect(rare.biasDirection).toBe('over');
    expect(rare.note).toMatch(/OVERESTIMATES/);
    expect(rare.exactness).toBe('numerical');
  });

  it('handles a k-of-n gate exactly', () => {
    const kTree: FaultTree = {
      topId: 'TOP',
      nodes: [
        { id: 'TOP', kind: 'kofn', k: 2, children: ['a', 'b', 'c'] },
        { id: 'a', kind: 'basic', probability: 0.3 },
        { id: 'b', kind: 'basic', probability: 0.4 },
        { id: 'c', kind: 'basic', probability: 0.5 },
      ],
    };
    // 2-of-3: cut sets {a,b},{a,c},{b,c}. Exact by enumeration:
    const reference = enumerateExact(['a', 'b', 'c'], [0.3, 0.4, 0.5], (up) => up.filter(Boolean).length >= 2);
    expect(faultTreeMinimalCutSets(kTree).map((c) => c.join('')).sort()).toEqual(['ab', 'ac', 'bc']);
    expect(Math.abs(faultTreeProbability(kTree).topEventProbability - reference)).toBeLessThan(1e-12);
  });

  it('handles a NOT gate by enumeration and refuses to name its cut sets', () => {
    const notTree: FaultTree = {
      topId: 'TOP',
      nodes: [
        { id: 'TOP', kind: 'and', children: ['a', 'nb'] },
        { id: 'nb', kind: 'not', children: ['b'] },
        { id: 'a', kind: 'basic', probability: 0.4 },
        { id: 'b', kind: 'basic', probability: 0.25 },
      ],
    };
    // Hand value: P(a AND NOT b) = 0.4 × 0.75 = 0.3 exactly.
    const result = faultTreeProbability(notTree);
    expect(Math.abs(result.topEventProbability - 0.3)).toBeLessThan(1e-12);
    expect(result.method).toBe('exhaustive enumeration of basic events');
    expect(() => faultTreeMinimalCutSets(notTree)).toThrow(/non-coherent/i);
  });

  it('refuses a cyclic fault tree and names the cycle', () => {
    const cyclic: FaultTree = {
      topId: 'TOP',
      nodes: [
        { id: 'TOP', kind: 'or', children: ['G1'] },
        { id: 'G1', kind: 'and', children: ['G2', 'e1'] },
        { id: 'G2', kind: 'or', children: ['G1'] },
        { id: 'e1', kind: 'basic', probability: 0.1 },
      ],
    };
    expect(() => validateFaultTree(cyclic)).toThrow(EngineError);
    let message = '';
    try {
      validateFaultTree(cyclic);
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/cycle/i);
    expect(message).toContain('G1');
    expect(message).toContain('G2');
    expect(message).toContain('→');
  });

  it('refuses malformed trees with a message naming the problem', () => {
    expect(() =>
      validateFaultTree({
        topId: 'TOP',
        nodes: [
          { id: 'TOP', kind: 'kofn', k: 4, children: ['a', 'b'] },
          { id: 'a', kind: 'basic', probability: 0.1 },
          { id: 'b', kind: 'basic', probability: 0.1 },
        ],
      }),
    ).toThrow(/k must not exceed n|k = 4 of only n = 2/);
    expect(() =>
      validateFaultTree({
        topId: 'TOP',
        nodes: [{ id: 'TOP', kind: 'basic', probability: 1.4 }],
      }),
    ).toThrow(/outside \[0, 1\]/);
    expect(() =>
      validateFaultTree({
        topId: 'MISSING',
        nodes: [{ id: 'TOP', kind: 'basic', probability: 0.1 }],
      }),
    ).toThrow(/not among the tree's nodes/);
  });
});

describe('reliability: time-dependent lifetimes', () => {
  it('exponential: R(t) = exp(−λt), hazard = λ, MTTF = 1/λ, all exactly', () => {
    const lambda = 0.004;
    const model = lifetimeModel('exponential', { lambda });
    for (const t of [0, 1, 50, 250, 1000]) {
      expect(reliabilityAt(model, t)).toBeCloseTo(Math.exp(-lambda * t), 15);
      expect(Math.abs(hazardAt(model, t) - lambda)).toBeLessThan(1e-15);
      expect(cumulativeHazard(model, t)).toBeCloseTo(lambda * t, 13);
    }
    const m = mttf(model);
    expect(Math.abs(m.mttf - 1 / lambda)).toBeLessThan(1e-12);
    expect(m.exactness).toBe('exact');
  });

  it('Weibull: MTTF = η·Γ(1 + 1/β)', () => {
    for (const [beta, eta] of [
      [0.7, 120],
      [1, 50],
      [2, 1000],
      [3.4, 7.5],
    ]) {
      const reference = eta * gammaFn(1 + 1 / beta); // independent of the fit code
      const model = lifetimeModel('weibull', { k: beta, lambda: eta });
      expect(mttf(model).mttf).toBeCloseTo(reference, 10);
      expect(weibullMttf(beta, eta)).toBeCloseTo(reference, 12);
    }
  });

  it('Weibull hazard is the analytic (β/η)(t/η)^{β−1}', () => {
    const beta = 2.5;
    const eta = 300;
    const model = lifetimeModel('weibull', { k: beta, lambda: eta });
    for (const t of [10, 100, 300, 600]) {
      const reference = (beta / eta) * Math.pow(t / eta, beta - 1);
      expect(hazardAt(model, t)).toBeCloseTo(reference, 12);
      expect(cumulativeHazard(model, t)).toBeCloseTo(Math.pow(t / eta, beta), 11);
    }
  });

  it('log-normal and gamma lifetimes expose R, h and MTTF', () => {
    const ln = lifetimeModel('lognormal', { mu: 4, sigma: 0.8 });
    // R(t) = 1 − Φ((ln t − μ)/σ): at t = e⁴, ln t = μ so R = 0.5 exactly.
    expect(reliabilityAt(ln, Math.exp(4))).toBeCloseTo(0.5, 12);
    expect(mttf(ln).mttf).toBeCloseTo(Math.exp(4 + 0.32), 10);
    const g = lifetimeModel('gamma', { k: 3, theta: 20 });
    expect(mttf(g).mttf).toBeCloseTo(60, 11);
    // Gamma(k=3): R(t) = e^{−t/θ}(1 + t/θ + (t/θ)²/2), summed here independently.
    const x = 40 / 20;
    expect(reliabilityAt(g, 40)).toBeCloseTo(Math.exp(-x) * (1 + x + (x * x) / 2), 11);
    expect(hazardAt(g, 40)).toBeGreaterThan(0);
  });

  it('refuses a hazard where no units remain at risk instead of returning NaN', () => {
    const model = lifetimeModel('weibull', { k: 2, lambda: 1 });
    expect(() => hazardAt(model, 1e6)).toThrow(EngineError);
    expect(() => hazardAt(model, 1e6)).toThrow(/undefined/i);
    expect(() => reliabilityAt(model, -1)).toThrow(/0 or more/);
  });
});

describe('reliability: bathtub curve regimes', () => {
  it('classifies β = 0.5 as infant mortality', () => {
    const r = classifyWeibullShape(0.5);
    expect(r.regime).toBe('infant-mortality');
    expect(r.hazardTrend).toBe('decreasing');
    expect(r.maintenanceImplication).toMatch(/burn-in/i);
  });

  it('classifies β = 1 as constant random failure', () => {
    const r = classifyWeibullShape(1);
    expect(r.regime).toBe('constant-random');
    expect(r.hazardTrend).toBe('constant');
  });

  it('classifies β = 2.5 as wear-out', () => {
    const r = classifyWeibullShape(2.5);
    expect(r.regime).toBe('wear-out');
    expect(r.hazardTrend).toBe('increasing');
    expect(r.maintenanceImplication).toMatch(/preventive replacement/i);
  });

  it('refuses a non-positive shape', () => {
    expect(() => classifyWeibullShape(0)).toThrow(/positive/);
    expect(() => classifyWeibullShape(Number.NaN)).toThrow(EngineError);
  });
});

describe('reliability: availability', () => {
  it('MTBF = 100, MTTR = 5 gives exactly 100/105', () => {
    const a = availability(100, 5);
    expect(a.steadyState).toBe(100 / 105);
    expect(a.exactness).toBe('exact');
    expect(a.atTime).toBeNull();
  });

  it('time-dependent availability starts at 1 and decays to the steady state', () => {
    const lambda = 1 / 100;
    const mu = 1 / 5;
    const at = (t: number): number => mu / (lambda + mu) + (lambda / (lambda + mu)) * Math.exp(-(lambda + mu) * t);
    expect(availability(100, 5, 0).atTime).toBeCloseTo(1, 14);
    expect(availability(100, 5, 10).atTime).toBeCloseTo(at(10), 14);
    expect(availability(100, 5, 1e5).atTime).toBeCloseTo(100 / 105, 12);
  });

  it('system availability composes component availabilities through the structure', () => {
    // Two units in parallel, each A = 100/105. System A = 1 − (5/105)².
    const result = systemAvailability(parallel('u1', 'u2'), {
      u1: { mtbf: 100, mttr: 5 },
      u2: { mtbf: 100, mttr: 5 },
    });
    expect(result.availability).toBeCloseTo(1 - (5 / 105) ** 2, 14);
    expect(result.independenceAssumed).toBe(true);
    expect(result.note).toMatch(/repair/i);
  });

  it('refuses non-positive MTBF or MTTR', () => {
    expect(() => availability(0, 5)).toThrow(/greater than 0/);
    expect(() => availability(100, -1)).toThrow(/greater than 0/);
  });
});

describe('reliability: redundancy', () => {
  it('cold standby of 2 identical exponential units is exactly (1 + λt)e^{−λt}', () => {
    const lambda = 0.01;
    for (const t of [0, 10, 100, 500]) {
      const reference = (1 + lambda * t) * Math.exp(-lambda * t);
      const got = redundancyReliability({ mode: 'cold-standby', units: 2, failureRate: lambda, time: t });
      expect(Math.abs(got.reliability - reference)).toBeLessThan(1e-14);
      expect(got.exactness).toBe('exact');
    }
  });

  it('cold standby of n units is the Erlang / truncated-Poisson sum', () => {
    const lambda = 0.02;
    const t = 60;
    const x = lambda * t;
    for (const n of [1, 3, 5]) {
      let sum = 0;
      let term = 1;
      for (let i = 0; i < n; i += 1) {
        if (i > 0) term *= x / i;
        sum += term;
      }
      const reference = Math.exp(-x) * sum;
      const got = redundancyReliability({ mode: 'cold-standby', units: n, failureRate: lambda, time: t });
      expect(got.reliability).toBeCloseTo(reference, 14);
    }
  });

  it('active parallel redundancy is worse than cold standby for the same units', () => {
    const input = { units: 2, failureRate: 0.01, time: 100 } as const;
    const active = redundancyReliability({ ...input, mode: 'active' }).reliability;
    const cold = redundancyReliability({ ...input, mode: 'cold-standby' }).reliability;
    // Active: 1 − (1 − e^{−1})² ; cold: 2e^{−1}. Both computed here by hand.
    expect(active).toBeCloseTo(1 - (1 - Math.exp(-1)) ** 2, 14);
    expect(cold).toBeCloseTo(2 * Math.exp(-1), 14);
    expect(cold).toBeGreaterThan(active);
  });

  it('imperfect switching reduces standby reliability towards the single unit', () => {
    const base = { mode: 'cold-standby', units: 2, failureRate: 0.01, time: 100 } as const;
    const perfect = redundancyReliability(base).reliability;
    const imperfect = redundancyReliability({ ...base, switchSuccessProbability: 0.9 }).reliability;
    const noSwitch = redundancyReliability({ ...base, switchSuccessProbability: 0 }).reliability;
    expect(imperfect).toBeLessThan(perfect);
    // p_s = 0.9: e^{−1}(1 + 0.9) by hand.
    expect(imperfect).toBeCloseTo(Math.exp(-1) * 1.9, 14);
    // p_s = 0 collapses to a single unit.
    expect(noSwitch).toBeCloseTo(Math.exp(-1), 14);
  });

  it('warm standby sits between cold standby and active redundancy', () => {
    const lambda = 0.01;
    const t = 100;
    const cold = redundancyReliability({ mode: 'cold-standby', units: 2, failureRate: lambda, time: t }).reliability;
    const warm = redundancyReliability({
      mode: 'warm-standby',
      units: 2,
      failureRate: lambda,
      time: t,
      standbyFailureRate: lambda / 2,
    }).reliability;
    const active = redundancyReliability({ mode: 'active', units: 2, failureRate: lambda, time: t }).reliability;
    // Analytic warm standby: e^{−λt}[1 + (λ/λs)(1 − e^{−λs t})], λs = λ/2.
    const reference = Math.exp(-1) * (1 + (lambda / (lambda / 2)) * -Math.expm1(-(lambda / 2) * t));
    expect(warm).toBeCloseTo(reference, 14);
    expect(warm).toBeLessThan(cold);
    expect(warm).toBeGreaterThan(active);
  });

  it('refuses a dormant failure rate on cold standby and warm standby beyond two units', () => {
    expect(() =>
      redundancyReliability({ mode: 'cold-standby', units: 2, failureRate: 0.01, time: 10, standbyFailureRate: 0.001 }),
    ).toThrow(/warm standby/i);
    expect(() =>
      redundancyReliability({ mode: 'warm-standby', units: 3, failureRate: 0.01, time: 10 }),
    ).toThrow(/2 units/);
    expect(() => redundancyReliability({ mode: 'active', units: 0, failureRate: 0.01, time: 10 })).toThrow(EngineError);
  });
});

describe('reliability: common-cause failure', () => {
  it('a non-zero beta factor reduces a parallel system reliability', () => {
    const input = { units: 2, failureRate: 0.01, time: 100 };
    const independent = betaFactorCommonCause({ ...input, beta: 0 });
    const coupled = betaFactorCommonCause({ ...input, beta: 0.1 });
    expect(independent.independenceAssumed).toBe(true);
    expect(independent.independenceNote).toMatch(/independent/i);
    expect(coupled.independenceAssumed).toBe(false);
    expect(coupled.withCommonCauseReliability).toBeLessThan(independent.independentReliability);
    expect(coupled.difference).toBeLessThan(0);
    expect(coupled.failureProbabilityRatio).toBeGreaterThan(1);
    // β = 0 must reproduce the plain independent parallel result exactly.
    expect(independent.withCommonCauseReliability).toBeCloseTo(independent.independentReliability, 14);
    expect(independent.independentReliability).toBeCloseTo(1 - (1 - Math.exp(-1)) ** 2, 14);
  });

  it('redundancy cannot beat the common-cause floor however many units are added', () => {
    const base = { failureRate: 0.01, time: 100, beta: 0.05 };
    const floor = Math.exp(-base.beta * base.failureRate * base.time);
    for (const units of [2, 4, 16, 64]) {
      const r = betaFactorCommonCause({ ...base, units }).withCommonCauseReliability;
      expect(r).toBeLessThanOrEqual(floor + 1e-15);
    }
    expect(betaFactorCommonCause({ ...base, units: 64 }).withCommonCauseReliability).toBeCloseTo(floor, 6);
    expect(betaFactorCommonCause({ ...base, units: 2 }).headline).toMatch(/common-cause floor/);
  });

  it('refuses a beta outside [0, 1]', () => {
    expect(() => betaFactorCommonCause({ units: 2, failureRate: 0.01, time: 10, beta: 1.2 })).toThrow(/between 0 and 1/);
  });
});

describe('reliability: stress–strength interference', () => {
  it('normal–normal matches the exact closed form', () => {
    // R = Φ((μ_strength − μ_stress)/√(σ₁² + σ₂²)).
    const stress = { family: 'normal', params: { mu: 100, sigma: 12 } };
    const strength = { family: 'normal', params: { mu: 140, sigma: 16 } };
    const reference = normalCdf((140 - 100) / Math.sqrt(12 * 12 + 16 * 16));
    const got = stressStrengthReliability({ stress, strength });
    expect(got.method).toBe('closed form (normal–normal)');
    expect(got.exactness).toBe('exact');
    expect(Math.abs(got.reliability - reference)).toBeLessThan(1e-15);
    expect(reference).toBeCloseTo(normalCdf(2), 15); // √(144+256) = 20, so z = 2
  });

  it('the numerical route reproduces the normal–normal closed form', () => {
    // Same inputs, quadrature instead of Φ. The integral ∫f_stress(x)·R_strength(x)dx
    // must land on the closed form Φ(2) = 0.977249868051821...
    const stress = { family: 'normal', params: { mu: 100, sigma: 12 } };
    const strength = { family: 'normal', params: { mu: 140, sigma: 16 } };
    const closedForm = normalCdf(2);
    const numerical = stressStrengthReliability({ stress, strength, forceNumerical: true });
    expect(numerical.method).toBe('numerical integration');
    expect(numerical.exactness).toBe('numerical');
    // Tolerance 1e-9: composite Simpson over 8000 panels on a smooth bounded
    // integrand, with the reported Richardson error estimate below 1e-6.
    expect(Math.abs(numerical.reliability - closedForm)).toBeLessThan(1e-9);
    expect(numerical.estimatedError).not.toBeNull();
  });

  it('exponential stress against exponential strength matches λ_X/(λ_X + λ_S)', () => {
    // P(S > X) with X ~ Exp(λ_X), S ~ Exp(λ_S) is λ_X/(λ_X + λ_S) exactly.
    const got = stressStrengthReliability({
      stress: { family: 'exponential', params: { lambda: 0.5 } },
      strength: { family: 'exponential', params: { lambda: 0.2 } },
    });
    expect(got.method).toBe('numerical integration');
    expect(got.exactness).toBe('numerical');
    // Tolerance 1e-7: the composite Simpson rule over 8000 panels has a
    // Richardson error estimate below 1e-6 and the integrand is smooth.
    expect(Math.abs(got.reliability - 0.5 / (0.5 + 0.2))).toBeLessThan(1e-7);
  });

  it('log-normal strength against log-normal stress matches the analytic normal result', () => {
    // ln S − ln X is normal, so P(S > X) = Φ((μ_S − μ_X)/√(σ_S² + σ_X²)).
    const reference = normalCdf((5 - 4) / Math.sqrt(0.3 * 0.3 + 0.4 * 0.4));
    const got = stressStrengthReliability({
      stress: { family: 'lognormal', params: { mu: 4, sigma: 0.4 } },
      strength: { family: 'lognormal', params: { mu: 5, sigma: 0.3 } },
    });
    expect(Math.abs(got.reliability - reference)).toBeLessThan(1e-6);
  });
});

describe('reliability: censored lifetime fitting', () => {
  it('exponential MLE is d / total time on test', () => {
    // 3 failures at 10, 20, 30; 2 units censored at 40.
    // T = 10+20+30+40+40 = 140, d = 3, λ̂ = 3/140 by hand.
    const obs: LifetimeObservation[] = [
      { time: 10, failed: true },
      { time: 20, failed: true },
      { time: 30, failed: true },
      { time: 40, failed: false },
      { time: 40, failed: false },
    ];
    const fit = fitExponentialCensored(obs);
    expect(fit.rate).toBeCloseTo(3 / 140, 15);
    expect(fit.mttf).toBeCloseTo(140 / 3, 13);
    expect(fit.rateStandardError).toBeCloseTo(3 / 140 / Math.sqrt(3), 14);
    expect(fit.censored).toBe(2);
    expect(fit.rateInterval.lower).toBeLessThan(fit.rate);
    expect(fit.rateInterval.upper).toBeGreaterThan(fit.rate);
  });

  it('refuses a sample in which every observation is censored', () => {
    const obs: LifetimeObservation[] = [
      { time: 100, failed: false },
      { time: 100, failed: false },
    ];
    expect(() => prepareSample(obs)).toThrow(EngineError);
    expect(() => prepareSample(obs)).toThrow(/right-censored/i);
    expect(() => fitWeibullCensored(obs)).toThrow(/not one failure/);
    expect(() => fitExponentialCensored(obs)).toThrow(/not one failure/);
  });

  it('refuses non-positive or non-finite lifetimes', () => {
    expect(() => prepareSample([{ time: 0, failed: true }])).toThrow(/strictly positive/);
    expect(() => prepareSample([{ time: Number.NaN, failed: true }])).toThrow(/non-finite/);
    expect(() => prepareSample([])).toThrow(/No lifetime observations/);
  });

  it('refuses a Weibull fit with fewer than two distinct failure times', () => {
    expect(() =>
      fitWeibullCensored([
        { time: 50, failed: true },
        { time: 50, failed: true },
        { time: 90, failed: false },
      ]),
    ).toThrow(/two distinct failure times/);
  });

  it('recovers the true Weibull parameters from right-censored data, and the naive fit does not', () => {
    // 5,000 Weibull(β = 2.2, η = 1000) lifetimes from a fixed seed, right
    // censored at t = 900 (type I). Sampling by inverse transform here, in the
    // test, so the data generation is independent of the fitting code.
    const beta = 2.2;
    const eta = 1000;
    const censorAt = 900;
    const rng = new Random('reliability-weibull-censoring-seed');
    const all: number[] = [];
    for (let i = 0; i < 5000; i += 1) {
      all.push(eta * Math.pow(-Math.log(rng.uniformOpen()), 1 / beta));
    }
    const observations: LifetimeObservation[] = all.map((t) =>
      t <= censorAt ? { time: t, failed: true } : { time: censorAt, failed: false },
    );
    const censoredCount = observations.filter((o) => !o.failed).length;
    expect(censoredCount).toBeGreaterThan(400); // a meaningful amount of censoring
    expect(censoredCount).toBeLessThan(2500);

    const fit = fitWeibullCensored(observations);
    // The censoring-aware MLE must sit within ~3 standard errors of the truth.
    // 3 SE is the usual 99.7% band for an asymptotically normal MLE; with 5,000
    // units the SEs are small, so this is a tight test, not a loose one.
    expect(Math.abs(fit.shape - beta)).toBeLessThan(3 * fit.shapeStandardError);
    expect(Math.abs(fit.scale - eta)).toBeLessThan(3 * fit.scaleStandardError);
    expect(fit.shapeStandardError).toBeLessThan(0.1);
    expect(fit.scaleStandardError).toBeLessThan(20);
    expect(fit.censoringType).toBe('type-I');
    expect(fit.censored).toBe(censoredCount);

    // The naive analysis: pretend every censoring time was a failure time.
    const naive = fitWeibullCensored(observations.map((o) => ({ time: o.time, failed: true })));
    // Treating suspensions as failures understates the characteristic life.
    expect(naive.scale).toBeLessThan(eta);
    expect(Math.abs(naive.scale - eta)).toBeGreaterThan(Math.abs(fit.scale - eta));
    // And the bias is far larger than the honest fit's own uncertainty.
    expect(Math.abs(naive.scale - eta)).toBeGreaterThan(10 * fit.scaleStandardError);
  });

  it('recovers an exponential rate from right-censored data and shows the naive bias', () => {
    const lambda = 1 / 500;
    const censorAt = 400;
    const rng = new Random('reliability-exponential-censoring-seed');
    const observations: LifetimeObservation[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const t = -Math.log(rng.uniformOpen()) / lambda;
      observations.push(t <= censorAt ? { time: t, failed: true } : { time: censorAt, failed: false });
    }
    const fit = fitExponentialCensored(observations);
    // 3 asymptotic standard errors around the true rate.
    expect(Math.abs(fit.rate - lambda)).toBeLessThan(3 * fit.rateStandardError);
    // Dropping the censored units entirely inflates the rate badly.
    const dropped = fitExponentialCensored(observations.filter((o) => o.failed));
    expect(dropped.rate).toBeGreaterThan(fit.rate);
    expect(Math.abs(dropped.rate - lambda)).toBeGreaterThan(Math.abs(fit.rate - lambda));
  });

  it('type-II censoring is recognised', () => {
    const obs: LifetimeObservation[] = [
      { time: 5, failed: true },
      { time: 9, failed: true },
      { time: 14, failed: true },
      { time: 14, failed: false },
      { time: 14, failed: false },
    ];
    expect(prepareSample(obs).censoringType).toBe('type-II');
    const fit = fitWeibullCensored(obs);
    expect(fit.shape).toBeGreaterThan(0);
    expect(fit.scale).toBeGreaterThan(0);
  });
});

describe('reliability: Weibull probability plot', () => {
  it('median ranks with no censoring are Bernard’s (i − 0.3)/(n + 0.4)', () => {
    const times = [100, 200, 300, 400, 500];
    const plot = weibullProbabilityPlot(times.map((t) => ({ time: t, failed: true })));
    plot.points.forEach((p, i) => {
      expect(p.adjustedRank).toBeCloseTo(i + 1, 12);
      expect(p.medianRank).toBeCloseTo((i + 1 - 0.3) / (5 + 0.4), 13);
    });
  });

  it('recovers a Weibull shape close to the MLE on a clean sample', () => {
    const beta = 1.8;
    const eta = 400;
    const rng = new Random('reliability-weibull-plot-seed');
    const obs: LifetimeObservation[] = [];
    for (let i = 0; i < 400; i += 1) {
      obs.push({ time: eta * Math.pow(-Math.log(rng.uniformOpen()), 1 / beta), failed: true });
    }
    const plot = weibullProbabilityPlot(obs);
    const fit = fitWeibullCensored(obs);
    expect(plot.rSquared).toBeGreaterThan(0.98);
    // Two different estimators on n = 400: agreement to 10% of the shape is the
    // expected order of their sampling difference, not a tight identity.
    expect(Math.abs(plot.shape - fit.shape) / fit.shape).toBeLessThan(0.1);
    expect(Math.abs(plot.shape - beta) / beta).toBeLessThan(0.15);
    expect(Math.abs(plot.scale - eta) / eta).toBeLessThan(0.1);
  });

  it('advances ranks past censored units instead of discarding them', () => {
    // 5 units: failure at 10, suspension at 20, failures at 30 and 40.
    // Johnson adjustment for the failure after one suspension:
    //   first failure (i = 0): increment = (5+1−0)/(1+5) = 1 → rank 1
    //   suspension at 20 skipped
    //   failure at 30 (i = 2, reverse rank 3): increment = (6−1)/(1+3) = 1.25
    //       → rank 2.25
    //   failure at 40 (i = 3, reverse rank 2): increment = (6−2.25)/(1+2) = 1.25
    //       → rank 3.5
    const plot = weibullProbabilityPlot([
      { time: 10, failed: true },
      { time: 20, failed: false },
      { time: 30, failed: true },
      { time: 40, failed: true },
      { time: 50, failed: false },
    ]);
    expect(plot.points.map((p) => p.adjustedRank)).toHaveLength(3);
    expect(plot.points[0].adjustedRank).toBeCloseTo(1, 12);
    expect(plot.points[1].adjustedRank).toBeCloseTo(2.25, 12);
    expect(plot.points[2].adjustedRank).toBeCloseTo(3.5, 12);
  });

  it('refuses a plot when all failures share one time', () => {
    expect(() =>
      weibullProbabilityPlot([
        { time: 30, failed: true },
        { time: 30, failed: true },
      ]),
    ).toThrow(/same time|no slope/);
  });
});

describe('reliability: growth models', () => {
  it('Crow–AMSAA recovers a known power-law intensity', () => {
    // Generate exact NHPP failure times for E[N(t)] = λt^β by inverting the mean
    // function on the arrival times of a unit-rate Poisson process.
    // Here instead use the deterministic "expected" times t_i = (i/λ)^{1/β},
    // for which the MLE identity β̂ = n / Σ ln(T/t_i) can be checked by hand.
    const beta = 0.6;
    const lambdaTrue = 0.4;
    const n = 40;
    const times = Array.from({ length: n }, (_, i) => Math.pow((i + 1) / lambdaTrue, 1 / beta));
    const T = Math.pow((n + 1) / lambdaTrue, 1 / beta); // time terminated after the last failure
    const result = reliabilityGrowth(times, T);
    // Independent reference: the MLE formula evaluated directly in the test.
    const reference = n / times.reduce((s, t) => s + Math.log(T / t), 0);
    expect(result.shape).toBeCloseTo(reference, 12);
    expect(result.growthRate).toBeCloseTo(1 - reference, 12);
    // The recovered shape should be near the generating β (deterministic times).
    expect(Math.abs(result.shape - beta)).toBeLessThan(0.1);
    expect(result.shape).toBeLessThan(1);
    expect(result.notes.join(' ')).toMatch(/reliability is growing/i);
  });

  it('instantaneous MTBF exceeds cumulative MTBF when reliability is growing', () => {
    const times = [10, 30, 70, 150, 310, 630];
    const result = reliabilityGrowth(times, 700);
    expect(result.shape).toBeLessThan(1);
    expect(result.instantaneousMtbf).toBeGreaterThan(result.cumulativeMtbf);
    expect(result.cumulativeMtbf).toBeCloseTo(700 / 6, 12);
    // Cumulative/instantaneous MTBF ratio is exactly β for a power law.
    expect(result.cumulativeMtbf / result.instantaneousMtbf).toBeCloseTo(result.shape, 10);
  });

  it('flags a deteriorating system', () => {
    // Failures bunching up: inter-arrival times shrinking.
    const times = [100, 190, 270, 340, 400, 450, 490, 520];
    const result = reliabilityGrowth(times, 540);
    expect(result.shape).toBeGreaterThan(1);
    expect(result.notes.join(' ')).toMatch(/RISING/);
  });

  it('refuses inconsistent growth data', () => {
    expect(() => reliabilityGrowth([10])).toThrow(/at least two/);
    expect(() => reliabilityGrowth([10, 20], 15)).toThrow(/earlier than the last failure/);
    expect(() => reliabilityGrowth([10, -5])).toThrow(/positive/);
  });
});

describe('reliability: spare-parts provisioning', () => {
  /** Independent Poisson cdf for the test, summed from the pmf. */
  function poissonCdf(k: number, mean: number): number {
    let term = Math.exp(-mean);
    let total = term;
    for (let i = 1; i <= k; i += 1) {
      term *= mean / i;
      total += term;
    }
    return total;
  }

  it('matches the Poisson quantile computed independently', () => {
    for (const [units, rate, period, confidence] of [
      [10, 0.001, 1000, 0.95],
      [1, 0.01, 500, 0.9],
      [200, 0.0005, 2000, 0.99],
      [4, 0.02, 100, 0.999],
    ] as const) {
      const mean = units * rate * period;
      let reference = 0;
      while (poissonCdf(reference, mean) < confidence) reference += 1;
      const result = sparesRequired({ units, failureRate: rate, period, confidence });
      expect(result.spares).toBe(reference);
      expect(result.expectedDemand).toBeCloseTo(mean, 12);
      expect(result.achievedConfidence).toBeGreaterThanOrEqual(confidence);
      if (result.spares > 0) expect(result.confidenceWithOneFewer).toBeLessThan(confidence);
      expect(result.exactness).toBe('exact');
    }
  });

  it('a hand-computed case: mean 2, confidence 0.95 needs 5 spares', () => {
    // P(N ≤ 4) = e^{−2}(1 + 2 + 2 + 4/3 + 2/3) = e^{−2}·7 = 0.94735 < 0.95
    // P(N ≤ 5) = 0.94735 + e^{−2}·2⁵/120 = 0.98344 ≥ 0.95
    const result = sparesRequired({ units: 1, failureRate: 0.002, period: 1000, confidence: 0.95 });
    expect(result.spares).toBe(5);
    expect(result.achievedConfidence).toBeCloseTo(0.983436391519257, 10);
  });

  it('refuses impossible inputs', () => {
    expect(() => sparesRequired({ units: 0, failureRate: 0.01, period: 10, confidence: 0.9 })).toThrow(EngineError);
    expect(() => sparesRequired({ units: 1, failureRate: 0.01, period: 10, confidence: 1 })).toThrow(EngineError);
    expect(() => sparesRequired({ units: 1, failureRate: -1, period: 10, confidence: 0.9 })).toThrow(/greater than 0/);
  });
});

describe('reliability: refusals on malformed structures', () => {
  it('refuses k > n with a message that names both', () => {
    expect(() => kOfNReliability(4, [0.9, 0.9])).toThrow(/k = 4, n = 2/);
    expect(() =>
      structureReliability({ kind: 'kofn', k: 3, children: [comp('a')] }, { a: 0.9 }),
    ).toThrow(/k ≤ n/);
  });

  it('refuses a reliability outside [0, 1] and never clamps silently', () => {
    expect(() => structureReliability(series('a'), { a: 1.2 })).toThrow(/outside \[0, 1\]/);
    expect(() => structureReliability(series('a'), { a: -0.1 })).toThrow(/outside \[0, 1\]/);
    expect(() => kOfNReliability(1, [0.5, 2])).toThrow(/outside \[0, 1\]/);
  });

  it('refuses a missing component reliability instead of assuming one', () => {
    expect(() => structureReliability(series('a', 'b'), { a: 0.9 })).toThrow(/No reliability was given for component "b"/);
  });

  it('refuses an empty block and an unknown kind', () => {
    expect(() => structureReliability({ kind: 'series', children: [] }, {})).toThrow(/no sub-structures/);
    expect(() => structureReliability({ kind: 'kofn', k: 1, children: [] }, {})).toThrow(/no sub-structures/);
  });

  it('refuses a disconnected network rather than reporting 0', () => {
    expect(() =>
      networkReliability(
        { source: 's', sink: 't', edges: [{ id: 'e1', from: 's', to: 'a' }, { id: 'e2', from: 'b', to: 't' }] },
        { e1: 0.9, e2: 0.9 },
      ),
    ).toThrow(/No path connects/);
  });

  it('refuses duplicate network component ids', () => {
    expect(() =>
      networkReliability(
        { source: 's', sink: 't', edges: [{ id: 'e1', from: 's', to: 'a' }, { id: 'e1', from: 'a', to: 't' }] },
        { e1: 0.9 },
      ),
    ).toThrow(/Duplicate component id/);
  });
});
