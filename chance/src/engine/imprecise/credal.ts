/**
 * Credal sets, lower previsions and robust Bayes (Walley).
 *
 * A credal set is a CONVEX set of probability distributions over a finite
 * frame, given either by its vertices or by linear constraints. Lower and
 * upper expectations are the envelope of a linear functional over that
 * polytope, and because a linear functional attains its extrema at vertices,
 * exact vertex enumeration answers the linear programme without an iterative
 * solver.
 *
 * Two coherence conditions matter and are checked, not assumed:
 *  - AVOIDING SURE LOSS: the set must be non-empty. An assessment that forces
 *    an empty set is a bet book you are guaranteed to lose on.
 *  - COHERENCE: each assessed lower bound must already equal its natural
 *    extension. If it does not, the assessment is not wrong but it is weaker
 *    than its own implications, and we report the implied tighter value.
 */
import { EngineError, Validator } from '../core/result';
import { solve } from '../stats/linalg';
import { type Frame, makeFrame, subsetName } from './frame';
import { type Bound, bound, type Labelled, labelled, NORM_TOL, provenance } from './types';

/** Above this the vertex enumeration becomes impractical in a browser tab. */
export const MAX_CREDAL_ELEMENTS = 7;
export const MAX_CREDAL_CONSTRAINTS = 16;

/** a·p ≤ b. */
export interface LinearConstraint {
  a: readonly number[];
  b: number;
  label?: string;
}

export interface CredalSet {
  readonly frame: Frame;
  /** Extreme points. Convexity means every mixture of these is admissible too. */
  readonly vertices: readonly (readonly number[])[];
  /** The constraints the set was built from, when it came from constraints. */
  readonly constraints?: readonly LinearConstraint[];
}

const FEAS_TOL = 1e-9;

/** A credal set given directly by its vertices (each a probability vector). */
export function credalFromVertices(
  elements: readonly string[],
  vertices: readonly (readonly number[])[],
): CredalSet {
  const frame = makeFrame(elements);
  if (vertices.length === 0) {
    throw new EngineError(
      'A credal set needs at least one vertex. An empty set of distributions means the assessments ' +
        'incur sure loss.',
      'empty',
    );
  }
  const v = new Validator();
  vertices.forEach((p, k) => {
    if (p.length !== frame.n) {
      v.add(`Vertex ${k} has ${p.length} entries but the frame has ${frame.n}.`, `vertex[${k}]`, 'length');
      return;
    }
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      if (!v.probability(p[i], `vertex[${k}][${i}]`, `vertex ${k} component ${frame.elements[i]}`)) return;
      s += p[i];
    }
    if (Math.abs(s - 1) > NORM_TOL) {
      v.add(`Vertex ${k} sums to ${s}, not 1.`, `vertex[${k}]`, 'not-normalised');
    }
  });
  v.throwIfInvalid();
  return { frame, vertices: vertices.map((p) => [...p]) };
}

/**
 * Exact vertex enumeration of { p : p ≥ 0, Σp = 1, a_j·p ≤ b_j }.
 *
 * A vertex is the unique solution of the normalisation equality together with
 * n−1 active inequalities, so we enumerate those subsets iteratively and keep
 * the feasible solutions. Exact (up to the linear solve) and complete.
 */
export function credalFromConstraints(
  elements: readonly string[],
  constraints: readonly LinearConstraint[],
): Labelled<CredalSet> {
  const frame = makeFrame(elements);
  if (frame.n > MAX_CREDAL_ELEMENTS) {
    throw new EngineError(
      `Vertex enumeration is supported up to ${MAX_CREDAL_ELEMENTS} frame elements; this frame has ` +
        `${frame.n}. The number of candidate vertex systems grows as C(n + m, n − 1). Coarsen the ` +
        'frame, supply the vertices directly, or bound individual events instead.',
      'frame-too-large',
    );
  }
  if (constraints.length > MAX_CREDAL_CONSTRAINTS) {
    throw new EngineError(
      `At most ${MAX_CREDAL_CONSTRAINTS} linear constraints are supported; got ${constraints.length}.`,
      'too-many-constraints',
    );
  }
  const v = new Validator();
  constraints.forEach((c, k) => {
    if (c.a.length !== frame.n) {
      v.add(`Constraint ${k} has ${c.a.length} coefficients but the frame has ${frame.n}.`, `c[${k}]`, 'length');
    }
    for (let i = 0; i < c.a.length; i++) v.finite(c.a[i], `c[${k}].a[${i}]`);
    v.finite(c.b, `c[${k}].b`);
  });
  v.throwIfInvalid();

  const n = frame.n;
  const rows: { a: number[]; b: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = new Array<number>(n).fill(0);
    a[i] = -1;
    rows.push({ a, b: 0 });
  }
  for (const c of constraints) rows.push({ a: [...c.a], b: c.b });

  const feasible = (p: number[]): boolean => {
    let s = 0;
    for (const x of p) {
      if (x < -FEAS_TOL) return false;
      s += x;
    }
    if (Math.abs(s - 1) > 1e-8) return false;
    for (const r of rows) {
      let d = 0;
      for (let i = 0; i < n; i++) d += r.a[i] * p[i];
      if (d > r.b + FEAS_TOL) return false;
    }
    return true;
  };

  const vertices: number[][] = [];
  const seen = new Set<string>();
  const k = n - 1;
  const ones = new Array<number>(n).fill(1);
  if (k === 0) {
    if (feasible([1])) vertices.push([1]);
  } else {
    const idx = Array.from({ length: k }, (_, i) => i);
    const M = rows.length;
    if (M >= k) {
      for (;;) {
        const A: number[][] = [ones.slice()];
        const b: number[] = [1];
        for (const j of idx) {
          A.push(rows[j].a.slice());
          b.push(rows[j].b);
        }
        const sol = solve(A, b);
        if (sol) {
          const p = sol.map((x) => (x > -FEAS_TOL && x < 0 ? 0 : x));
          if (feasible(p)) {
            const key = p.map((x) => x.toFixed(9)).join('|');
            if (!seen.has(key)) {
              seen.add(key);
              vertices.push(p);
            }
          }
        }
        // Iterative odometer over k-subsets of {0..M-1}.
        let i = k - 1;
        while (i >= 0 && idx[i] === M - k + i) i--;
        if (i < 0) break;
        idx[i]++;
        for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
      }
    }
  }
  if (vertices.length === 0) {
    throw new EngineError(
      'The constraints define an EMPTY credal set: no probability distribution over ' +
        `{${frame.elements.join(', ')}} satisfies them all. The assessment incurs sure loss — there ` +
        'is a combination of the accepted bets that loses money whatever happens. At least one ' +
        'constraint must be relaxed.',
      'sure-loss',
    );
  }
  return labelled(
    { frame, vertices, constraints: constraints.map((c) => ({ ...c, a: [...c.a] })) },
    provenance('credal', 'numerical', [
      `${vertices.length} extreme points found by exact enumeration of the active-constraint systems.`,
      'Results from this set are obtained by linear programming over a polytope, so the optimum is ' +
        'attained at a vertex and the enumeration is complete; the numerical label reflects the ' +
        'linear solves, not an iterative search.',
      'The set is convex: every mixture of these vertices is an admissible distribution.',
    ]),
  );
}

/** Does any distribution satisfy the constraints? (Walley's avoiding sure loss.) */
export function avoidsSureLoss(
  elements: readonly string[],
  constraints: readonly LinearConstraint[],
): Labelled<boolean> {
  try {
    credalFromConstraints(elements, constraints);
    return labelled(
      true,
      provenance('credal', 'numerical', [
        'At least one distribution satisfies every assessment, so no combination of the accepted ' +
          'bets loses under all outcomes.',
      ]),
    );
  } catch (e) {
    if (e instanceof EngineError && e.issues.some((i) => i.code === 'sure-loss')) {
      return labelled(
        false,
        provenance('credal', 'numerical', ['The assessments are jointly unsatisfiable: sure loss.']),
        ['The assessment incurs sure loss and cannot be used for inference until it is relaxed.'],
      );
    }
    throw e;
  }
}

/* --------------------------------------------- lower / upper previsions */

/** Lower and upper expectation of a gamble f, exact over the vertices. */
export function previsionBound(set: CredalSet, f: readonly number[]): Bound {
  if (f.length !== set.frame.n) {
    throw new EngineError(
      `The gamble has ${f.length} values but the frame has ${set.frame.n} elements.`,
      'length',
    );
  }
  const vv = new Validator();
  for (let i = 0; i < f.length; i++) vv.finite(f[i], `f[${i}]`, `f(${set.frame.elements[i]})`);
  vv.throwIfInvalid();
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of set.vertices) {
    let e = 0;
    for (let i = 0; i < f.length; i++) e += p[i] * f[i];
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  return bound(
    lo,
    hi,
    provenance('credal', 'exact', [
      'Lower and upper expectation over the credal set. A linear functional attains its extrema at ' +
        'extreme points, so the vertex minimum and maximum ARE the LP optimum.',
      'The interval is an envelope over admissible distributions; it is not a distribution of E[f].',
    ]),
  );
}

/** Lower and upper probability of an event given as a bitmask. */
export function probabilityBound(set: CredalSet, mask: number): Bound {
  const f = set.frame.elements.map((_, i) => ((mask >> i) & 1 ? 1 : 0));
  const b = previsionBound(set, f);
  return bound(
    b.lower,
    b.upper,
    provenance('credal', 'exact', [
      `Lower and upper probability of ${subsetName(set.frame, mask)} over the credal set.`,
      'Lower probability is super-additive and upper probability sub-additive; neither is a probability.',
    ]),
  );
}

export interface Assessment {
  /** The gamble assessed, one value per frame element. */
  gamble: readonly number[];
  /** The assessed lower expectation: the price at which you would buy f. */
  lowerBound: number;
  label?: string;
}

export interface CoherenceReport {
  avoidsSureLoss: boolean;
  coherent: boolean;
  /** Assessments whose natural extension is strictly tighter than stated. */
  improvable: { index: number; label?: string; assessed: number; naturalExtension: number }[];
}

/**
 * Natural extension: the credal set implied by a set of lower-expectation
 * assessments, i.e. { p : E_p[f_k] ≥ L_k for all k }.
 */
export function naturalExtension(
  elements: readonly string[],
  assessments: readonly Assessment[],
): Labelled<CredalSet> {
  const constraints: LinearConstraint[] = assessments.map((a, k) => ({
    // E_p[f] ≥ L  ⟺  (−f)·p ≤ −L
    a: a.gamble.map((x) => -x),
    b: -a.lowerBound,
    label: a.label ?? `assessment ${k}`,
  }));
  const res = credalFromConstraints(elements, constraints);
  return labelled(
    res.value,
    provenance('credal', 'numerical', [
      'The natural extension is the LEAST committal coherent lower prevision that dominates the ' +
        'assessments. Anything narrower would add information you did not supply.',
      ...res.provenance.notes,
    ]),
    res.warnings,
  );
}

/**
 * Coherence check: an assessment is coherent when each stated lower bound
 * already equals its natural extension. An incoherent (but sure-loss-avoiding)
 * assessment is not refused — it is weaker than its own implications, and the
 * implied tighter values are reported.
 */
export function checkCoherence(
  elements: readonly string[],
  assessments: readonly Assessment[],
): Labelled<CoherenceReport> {
  const asl = avoidsSureLoss(
    elements,
    assessments.map((a) => ({ a: a.gamble.map((x) => -x), b: -a.lowerBound })),
  );
  if (!asl.value) {
    return labelled(
      { avoidsSureLoss: false, coherent: false, improvable: [] },
      provenance('credal', 'numerical', [
        'Sure loss: no distribution satisfies the assessments, so coherence is not even definable.',
      ]),
      ['The assessment incurs sure loss; relax it before asking about coherence.'],
    );
  }
  const set = naturalExtension(elements, assessments).value;
  const improvable: CoherenceReport['improvable'] = [];
  assessments.forEach((a, k) => {
    const ne = previsionBound(set, a.gamble).lower;
    if (ne > a.lowerBound + 1e-9) {
      improvable.push({ index: k, label: a.label, assessed: a.lowerBound, naturalExtension: ne });
    }
  });
  return labelled(
    { avoidsSureLoss: true, coherent: improvable.length === 0, improvable },
    provenance('credal', 'numerical', [
      'Coherence means no assessed price can be raised without changing the implied credal set.',
      improvable.length === 0
        ? 'Every assessment is already tight: the assessment is coherent.'
        : `${improvable.length} assessment(s) imply a strictly higher lower price than stated; the ` +
          'implied values are listed. This is under-commitment, not an error.',
    ]),
  );
}

/* ------------------------------------- interval-valued probability tables */

export interface IntervalTableReport {
  /** Reachable (tightened) intervals, which are what the table actually implies. */
  lower: number[];
  upper: number[];
  /** True if the given intervals were already reachable. */
  alreadyReachable: boolean;
}

/**
 * An interval-valued probability table [l_i, u_i].
 *
 * It is coherent (non-empty) iff Σl ≤ 1 ≤ Σu. Even then the given bounds may
 * be unreachable: the implied, reachable bounds are
 *     l'_i = max(l_i, 1 − Σ_{j≠i} u_j)      u'_i = min(u_i, 1 − Σ_{j≠i} l_j)
 * Refuses an incoherent table, reporting the sums.
 */
export function reachableIntervals(
  elements: readonly string[],
  lower: readonly number[],
  upper: readonly number[],
): Labelled<IntervalTableReport> {
  const frame = makeFrame(elements);
  const v = new Validator();
  if (lower.length !== frame.n || upper.length !== frame.n) {
    v.add(
      `Need one interval per element: got ${lower.length} lower and ${upper.length} upper bounds for ` +
        `${frame.n} elements.`,
      'length',
      'length',
    );
  }
  v.throwIfInvalid();
  for (let i = 0; i < frame.n; i++) {
    v.probability(lower[i], `lower[${i}]`, `lower bound for ${frame.elements[i]}`);
    v.probability(upper[i], `upper[${i}]`, `upper bound for ${frame.elements[i]}`);
  }
  v.throwIfInvalid();
  for (let i = 0; i < frame.n; i++) {
    if (lower[i] > upper[i]) {
      throw new EngineError(
        `The interval for ${frame.elements[i]} is [${lower[i]}, ${upper[i]}], which is empty.`,
        'crossed-bounds',
      );
    }
  }
  let sl = 0;
  let su = 0;
  for (let i = 0; i < frame.n; i++) {
    sl += lower[i];
    su += upper[i];
  }
  if (sl > 1 + NORM_TOL || su < 1 - NORM_TOL) {
    throw new EngineError(
      `Incoherent interval probability table: the lower bounds sum to ${sl} and the upper bounds to ` +
        `${su}. Coherence requires Σl ≤ 1 ≤ Σu, so no probability distribution fits inside these ` +
        `intervals` +
        (sl > 1
          ? ` — the lower bounds alone already demand more than total probability 1.`
          : ` — the upper bounds cannot reach total probability 1.`),
      'incoherent',
    );
  }
  const lo: number[] = [];
  const hi: number[] = [];
  let tight = true;
  for (let i = 0; i < frame.n; i++) {
    const l = Math.max(lower[i], 1 - (su - upper[i]));
    const u = Math.min(upper[i], 1 - (sl - lower[i]));
    if (Math.abs(l - lower[i]) > 1e-12 || Math.abs(u - upper[i]) > 1e-12) tight = false;
    lo.push(l);
    hi.push(u);
  }
  return labelled(
    { lower: lo, upper: hi, alreadyReachable: tight },
    provenance('credal', 'exact', [
      'Reachable bounds: the tightest intervals containing exactly the same distributions.',
      'The table defines a credal set; the per-element intervals do NOT determine it on compound ' +
        'events, where lower probability is super-additive.',
      ...(tight ? [] : ['The supplied bounds were not reachable and have been tightened.']),
    ]),
    tight ? [] : ['Some supplied bounds were unreachable; the reported bounds are the implied ones.'],
  );
}

/* ----------------------------------------- imprecise Dirichlet model */

export interface IDMResult {
  category: string;
  bound: Bound;
}

/**
 * The imprecise Dirichlet model (Walley 1996).
 *
 * With counts n_i out of N and a learning parameter s, the posterior
 * probability of category i is bounded by
 *
 *     lower = n_i / (N + s)      upper = (n_i + s) / (N + s)
 *
 * obtained as the envelope over ALL Dirichlet priors with strength s, i.e. all
 * prior means. This is the principled answer to "what is the probability when I
 * have seen 0 out of 3?": the lower bound is exactly 0 — you have observed
 * nothing that rules the event in — while the upper bound is s/(3+s) > 0, and
 * it falls as more data arrives. Any single posterior here (Laplace, Jeffreys,
 * Haldane) is the consequence of an arbitrary prior choice; all of them lie
 * inside this interval.
 */
export function impreciseDirichlet(
  elements: readonly string[],
  counts: readonly number[],
  s = 1,
): Labelled<IDMResult[]> {
  const frame = makeFrame(elements);
  const v = new Validator();
  if (counts.length !== frame.n) {
    v.add(`Need one count per category: got ${counts.length} for ${frame.n} categories.`, 'counts', 'length');
  }
  v.positive(s, 's', 'Learning parameter s');
  v.throwIfInvalid();
  for (let i = 0; i < counts.length; i++) {
    v.integer(counts[i], `counts[${i}]`, `count for ${frame.elements[i]}`, 0);
  }
  v.throwIfInvalid();
  let N = 0;
  for (const c of counts) N += c;
  const rows = frame.elements.map((name, i) => ({
    category: name,
    bound: bound(
      counts[i] / (N + s),
      (counts[i] + s) / (N + s),
      provenance('credal', 'exact', [
        `From ${counts[i]} of ${N} observations with learning parameter s = ${s}.`,
        'The envelope is over every Dirichlet prior of strength s, so no prior mean was chosen.',
        'The bounds are representation invariant: they do not change if categories are merged or split.',
        counts[i] === 0
          ? 'The lower bound is exactly 0 because nothing observed supports this category; it is not ' +
            'a rounded small number.'
          : 'Both bounds converge to the observed frequency as N grows.',
      ]),
    ),
  }));
  return labelled(
    rows,
    provenance('credal', 'exact', [
      `s = ${s} controls how fast the interval shrinks; s = 1 and s = 2 are the usual choices and ` +
        'the choice must be reported because it changes the width (never the lower bound at zero ' +
        'counts, which is 0 for any s).',
      'Lower and upper probabilities here are bounds, not an estimate and an error bar.',
    ]),
  );
}

/** IDM bounds for a compound event (a union of categories). */
export function impreciseDirichletEvent(
  counts: readonly number[],
  mask: number,
  s = 1,
): Bound {
  const v = new Validator();
  v.positive(s, 's', 'Learning parameter s');
  v.throwIfInvalid();
  let N = 0;
  let k = 0;
  for (let i = 0; i < counts.length; i++) {
    N += counts[i];
    if ((mask >> i) & 1) k += counts[i];
  }
  return bound(
    k / (N + s),
    (k + s) / (N + s),
    provenance('credal', 'exact', [
      'IDM bounds for a compound event depend only on the count inside it, which is what makes the ' +
        'model representation invariant.',
    ]),
  );
}

/* ------------------------------------------- robust Bayesian analysis */

export interface RobustPosterior {
  /** Bounds on P(hypothesis | data) over the whole set of priors. */
  posterior: Bound;
  /** The prior vertex attaining the lower bound, and the one attaining the upper. */
  argmin: readonly number[];
  argmax: readonly number[];
}

/**
 * Robust Bayesian sensitivity analysis (the generalised Bayes rule).
 *
 * Given a credal set of priors and a likelihood for each hypothesis, the
 * posterior probability of an event is
 *
 *     P(A | data) = Σ_{i∈A} p_i L_i / Σ_i p_i L_i
 *
 * a ratio of linear functions of p with a positive denominator, so it attains
 * its extrema at vertices of the prior polytope: the range below is exact.
 *
 * This answers the question the ordinary Bayes tools cannot: they demand one
 * exact prior, and the answer's dependence on that arbitrary choice is invisible.
 */
export function robustPosterior(
  set: CredalSet,
  likelihood: readonly number[],
  mask: number,
): Labelled<RobustPosterior> {
  if (likelihood.length !== set.frame.n) {
    throw new EngineError(
      `The likelihood vector has ${likelihood.length} entries but the frame has ${set.frame.n}.`,
      'length',
    );
  }
  const v = new Validator();
  for (let i = 0; i < likelihood.length; i++) {
    v.nonNegative(likelihood[i], `likelihood[${i}]`, `P(data | ${set.frame.elements[i]})`);
  }
  v.throwIfInvalid();
  let lo = Infinity;
  let hi = -Infinity;
  let argmin: readonly number[] = set.vertices[0];
  let argmax: readonly number[] = set.vertices[0];
  for (const p of set.vertices) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < p.length; i++) {
      const w = p[i] * likelihood[i];
      den += w;
      if ((mask >> i) & 1) num += w;
    }
    if (den <= NORM_TOL) {
      throw new EngineError(
        `At the prior vertex (${p.map((x) => x.toPrecision(4)).join(', ')}) the marginal likelihood ` +
          `of the data is ${den}: this prior assigns essentially zero probability to the data having ` +
          'happened, so the posterior is undefined there. The prior set and the data are ' +
          'incompatible; no posterior range exists.',
        'zero-evidence',
      );
    }
    const post = num / den;
    if (post < lo) {
      lo = post;
      argmin = p;
    }
    if (post > hi) {
      hi = post;
      argmax = p;
    }
  }
  return labelled(
    {
      posterior: bound(
        lo,
        hi,
        provenance('credal', 'exact', [
          `Posterior bounds for ${subsetName(set.frame, mask)} over every prior in the credal set.`,
          'The posterior is a linear-fractional function of the prior with a positive denominator, so ' +
            'the extrema are attained at prior vertices and these bounds are exact over the set.',
          'The width is prior sensitivity: how much the conclusion rests on an arbitrary prior choice.',
          'Every single-prior Bayesian posterior from a prior in this set lies inside this interval.',
        ]),
      ),
      argmin,
      argmax,
    },
    provenance('credal', 'exact', [
      'Generalised Bayes rule (Walley): condition each prior in the set, then take the envelope.',
      'This is NOT a distribution over posteriors; no prior in the set is more plausible than another.',
    ]),
    hi - lo > 0.3
      ? [
          `The posterior ranges over ${(hi - lo).toPrecision(3)} across admissible priors. A single ` +
            'prior would have concealed that.',
        ]
      : [],
  );
}

/** A credal set of priors from per-element probability intervals (the usual ε-contamination style input). */
export function credalFromIntervals(
  elements: readonly string[],
  lower: readonly number[],
  upper: readonly number[],
): Labelled<CredalSet> {
  const report = reachableIntervals(elements, lower, upper);
  const constraints: LinearConstraint[] = [];
  elements.forEach((name, i) => {
    const e = new Array<number>(elements.length).fill(0);
    e[i] = 1;
    constraints.push({ a: e, b: report.value.upper[i], label: `P(${name}) ≤ ${report.value.upper[i]}` });
    const ne = new Array<number>(elements.length).fill(0);
    ne[i] = -1;
    constraints.push({ a: ne, b: -report.value.lower[i], label: `P(${name}) ≥ ${report.value.lower[i]}` });
  });
  const res = credalFromConstraints(elements, constraints);
  return labelled(res.value, res.provenance, [...report.warnings, ...res.warnings]);
}
