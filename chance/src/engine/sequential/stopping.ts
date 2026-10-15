/**
 * Optimal stopping: when to stop looking and commit.
 *
 * Four families, each with its own honesty problem:
 *
 *  - Rank-based stopping (the secretary problem). Exact, closed form or exact
 *    dynamic programming. The 1/e limit is a limit, not the answer for finite n.
 *  - Search with a known value distribution (house selling, job search). The
 *    answer is a reservation value; the quadrature makes it numerical.
 *  - Sequential hypothesis testing (SPRT, Bayesian stopping, alpha spending).
 *    The error rates are guaranteed ONLY for the pre-declared boundaries. This
 *    is the single most abused idea in applied statistics and the results say
 *    so in their limitations, not in a footnote.
 *  - Markov stopping by the one-stage look-ahead rule, which is optimal only
 *    when the problem is monotone. That condition is CHECKED, not assumed.
 */
import { brentRoot, clamp } from '../core/numeric';
import { EngineError } from '../core/result';
import { incompleteBeta, normalCdf, normalQuantile } from '../special/gamma';
import type { Provenance } from './types';

/* ---------------------------------------------------- secretary problem */

export interface SecretaryResult {
  n: number;
  /** Observe (and reject) this many candidates, then take the next record. */
  skip: number;
  /** Probability the chosen candidate is the best of all n. */
  successProbability: number;
  /** Success probability for every threshold, so the shape is visible. */
  byThreshold: { skip: number; probability: number }[];
  /** The asymptotic 1/e value, for comparison with the finite-n answer. */
  asymptoticProbability: number;
  provenance: Provenance;
}

/**
 * The classical best-choice problem: n candidates in random order, only
 * relative ranks observed, one irrevocable choice, success means picking the
 * single best.
 *
 * Skipping the first r candidates and then taking the first record succeeds
 * with probability
 *
 *     P(r) = (r/n) · Σ_{i=r+1}^{n} 1/(i−1)
 *
 * which is evaluated exactly (a sum of rationals in floating point, accurate to
 * round-off) over every r, so the reported optimum is the true maximiser rather
 * than the n/e rule of thumb. For n = 10 the optimum is to skip 3 and the
 * success probability is 0.398729…, not 1/e.
 */
export function secretaryProblem(n: number): SecretaryResult {
  if (!Number.isInteger(n) || n < 1) {
    throw new EngineError(`The secretary problem needs a whole number of at least 1 candidate; ${n} was supplied.`, 'range');
  }
  const byThreshold: { skip: number; probability: number }[] = [];
  for (let r = 0; r < n; r++) {
    let p: number;
    if (r === 0) {
      // Taking the first candidate sight unseen wins with probability 1/n.
      p = 1 / n;
    } else {
      let sum = 0;
      for (let i = r + 1; i <= n; i++) sum += 1 / (i - 1);
      p = (r / n) * sum;
    }
    byThreshold.push({ skip: r, probability: p });
  }
  let best = 0;
  for (let r = 1; r < n; r++) if (byThreshold[r].probability > byThreshold[best].probability) best = r;
  return {
    n,
    skip: best,
    successProbability: byThreshold[best].probability,
    byThreshold,
    asymptoticProbability: 1 / Math.E,
    provenance: {
      exactness: 'exact',
      method: 'Exact enumeration of the threshold rule P(r) = (r/n)·Σ_{i=r+1}^{n} 1/(i−1)',
      assumedInputs: [
        'The n candidates arrive in a uniformly random order and are strictly comparable with no ties.',
        'Only the relative rank of each candidate is observed, and the choice is irrevocable.',
      ],
      limitations: [
        'Success means picking the single best candidate. Picking the second best counts as total failure, which is rarely what a real hiring decision cares about — use the top-k variant for a more forgiving objective.',
        `The 1/e ≈ ${(1 / Math.E).toFixed(6)} limit applies as n → ∞; at n = ${n} the exact optimum is ${byThreshold[best].probability.toFixed(6)}.`,
      ],
    },
  };
}

/**
 * Bruss's odds algorithm for last-success problems.
 *
 * For independent indicator trials with success probabilities p_1..p_n, the
 * rule that maximises the probability of stopping on the LAST success is: sum
 * the odds r_i = p_i/(1−p_i) backwards from the end until the total reaches 1;
 * stop at the first success from that index onwards. The win probability is
 * (Π_{i=s}^{n} q_i)·(Σ_{i=s}^{n} r_i). With p_i = 1/i this is exactly the
 * secretary problem, which is the cross-check the test performs.
 */
export function oddsAlgorithm(probabilities: number[]): {
  startIndex: number;
  oddsSum: number;
  winProbability: number;
  provenance: Provenance;
} {
  if (!Array.isArray(probabilities) || probabilities.length === 0) {
    throw new EngineError('The odds algorithm needs at least one trial probability.', 'empty');
  }
  const n = probabilities.length;
  for (let i = 0; i < n; i++) {
    const p = probabilities[i];
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new EngineError(`Trial ${i + 1} has probability ${p}, which is not in [0, 1].`, 'range');
    }
  }
  let oddsSum = 0;
  let start = 0; // 0-based index of the first trial from which to accept
  for (let i = n - 1; i >= 0; i--) {
    if (probabilities[i] === 1) {
      // Odds of a certain success are infinite. This only matters when the
      // threshold has not already been reached further along the sequence: a
      // p = 1 trial inside the accept region is simply never reached by the
      // backward sum (the secretary problem, where p_1 = 1, is this case).
      throw new EngineError(
        `Trial ${i + 1} has success probability exactly 1, so its odds are infinite and the backward odds sum cannot be formed at that point. A certain success means the optimal rule is trivially "stop at the last trial with p = 1 or later"; drop the certain trials and apply the algorithm to the rest.`,
        'degenerate',
      );
    }
    oddsSum += probabilities[i] / (1 - probabilities[i]);
    start = i;
    if (oddsSum >= 1) break;
  }
  let qProd = 1;
  for (let i = start; i < n; i++) qProd *= 1 - probabilities[i];
  // When the total odds never reach 1 the rule is "accept any success at all",
  // and the formula still gives the correct win probability.
  const winProbability = qProd * oddsSum;
  return {
    startIndex: start,
    oddsSum,
    winProbability,
    provenance: {
      exactness: 'exact',
      method: "Bruss's odds algorithm (sum of odds from the end until it reaches 1)",
      assumedInputs: ['The trials are INDEPENDENT with the stated success probabilities. Dependence between trials invalidates the rule; it is not assumed away here, it is required.'],
      limitations: [
        'The objective is stopping on the LAST success. Stopping on a success that is not the last counts as failure, as does never stopping.',
        oddsSum < 1
          ? 'The total odds never reach 1, so the optimal rule accepts the first success anywhere in the sequence.'
          : 'The rule ignores everything before the threshold index, however promising it looked.',
      ],
    },
  };
}

/* ------------------------------------------- rank-based stopping (exact DP) */

export interface RankStoppingResult {
  n: number;
  topK: number;
  successProbability: number;
  /**
   * acceptIf[i] = the largest relative rank worth accepting at position i
   * (1-based); 0 means accept nothing at that position.
   */
  acceptIf: number[];
  provenance: Provenance;
}

/**
 * Exact dynamic programming for the single-choice rank-based stopping problem
 * with a more forgiving objective than the classical one: success means landing
 * in the top `topK` overall rather than hitting the single best.
 *
 * The probability that a candidate which is the j-th best of the first i is the
 * m-th best overall is C(m−1, j−1)·C(n−m, i−j)/C(n, i), computed in logs. The
 * recursion runs backwards over positions and is a loop, not a recursion. With
 * topK = 1 it reproduces the closed form of secretaryProblem() exactly, which
 * is the cross-check the test performs.
 */
export function rankBasedStopping(n: number, opts: { topK?: number } = {}): RankStoppingResult {
  const topK = opts.topK ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new EngineError(`The number of candidates must be a whole number of at least 1; ${n} was supplied.`, 'range');
  if (!Number.isInteger(topK) || topK < 1 || topK > n) throw new EngineError(`topK must be a whole number in 1..${n}.`, 'range');

  const logFact = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const logC = (a: number, b: number): number => (b < 0 || b > a ? -Infinity : logFact[a] - logFact[b] - logFact[a - b]);

  /** P(overall rank ≤ topK | relative rank j among the first i). */
  const pGood = (i: number, j: number): number => {
    let acc = 0;
    for (let m = j; m <= topK; m++) {
      const lp = logC(m - 1, j - 1) + logC(n - m, i - j) - logC(n, i);
      if (Number.isFinite(lp)) acc += Math.exp(lp);
    }
    return clamp(acc, 0, 1);
  };

  // V[i] = probability of success standing just before position i is revealed.
  const V = new Array<number>(n + 2).fill(0);
  const acceptIf = new Array<number>(n + 1).fill(0);
  for (let i = n; i >= 1; i--) {
    let total = 0;
    let bestAccept = 0;
    for (let j = 1; j <= i; j++) {
      const accept = pGood(i, j);
      if (accept >= V[i + 1] + 1e-15) {
        total += accept / i;
        if (j > bestAccept) bestAccept = j;
      } else {
        total += V[i + 1] / i;
      }
    }
    V[i] = total;
    acceptIf[i] = bestAccept;
  }
  return {
    n,
    topK,
    successProbability: V[1],
    acceptIf,
    provenance: {
      exactness: 'exact',
      method: 'Exact backward induction over (position, relative rank)',
      assumedInputs: ['Uniformly random arrival order, strict comparability, only relative ranks observed, one irrevocable choice.'],
      limitations: [
        'The acceptance rule is a per-position rank threshold and is genuinely time-dependent: the same candidate should be rejected early and accepted late.',
        'Success is landing in the top k; the rule says nothing about which of the k.',
      ],
    },
  };
}

export interface MultipleChoiceSecretaryResult {
  n: number;
  choices: number;
  successProbability: number;
  /** acceptRecord[c][i] = accept a relative record at position i with c choices left. */
  acceptRecord: boolean[][];
  provenance: Provenance;
}

/**
 * The best-choice problem with more than one selection: success means that one
 * of the `choices` candidates selected is the single best overall.
 *
 * Only relative records are ever worth accepting (a non-record cannot be the
 * best, so accepting one spends a choice for nothing), which lets the state be
 * written as "about to see candidate i, c choices left, and the best overall is
 * still among positions i..n". In that state candidate i is the overall best
 * with probability 1/(n−i+1); failing that, it is still a record with
 * probability 1/i, in which case accepting it wastes a choice. Skipping a
 * record forfeits the game outright if that record WAS the best. Hence
 *
 *   accept: V_c(i) = q + (1−q)·[ (1/i)·V_{c−1}(i+1) + (1−1/i)·V_c(i+1) ]
 *   skip:   V_c(i) = (1−q)·V_c(i+1),            q = 1/(n−i+1)
 *
 * and the value is the larger of the two. With one choice this reproduces the
 * classical answer; with two choices the asymptotic probability rises to about
 * 0.574.
 */
export function multipleChoiceSecretary(n: number, choices: number): MultipleChoiceSecretaryResult {
  if (!Number.isInteger(n) || n < 1) throw new EngineError(`The number of candidates must be a whole number of at least 1; ${n} was supplied.`, 'range');
  if (!Number.isInteger(choices) || choices < 1 || choices > n) throw new EngineError(`The number of choices must be a whole number in 1..${n}; ${choices} was supplied.`, 'range');
  // V[c][i], with V[0][·] = 0 and V[·][n+1] = 0.
  const V: number[][] = Array.from({ length: choices + 1 }, () => new Array<number>(n + 2).fill(0));
  const acceptRecord: boolean[][] = Array.from({ length: choices + 1 }, () => new Array<boolean>(n + 2).fill(false));
  for (let c = 1; c <= choices; c++) {
    for (let i = n; i >= 1; i--) {
      const q = 1 / (n - i + 1);
      const accept = q + (1 - q) * ((1 / i) * V[c - 1][i + 1] + (1 - 1 / i) * V[c][i + 1]);
      const skip = (1 - q) * V[c][i + 1];
      if (accept >= skip) {
        V[c][i] = accept;
        acceptRecord[c][i] = true;
      } else {
        V[c][i] = skip;
      }
    }
  }
  return {
    n,
    choices,
    successProbability: V[choices][1],
    acceptRecord,
    provenance: {
      exactness: 'exact',
      method: 'Exact backward induction over (position, choices remaining), conditioned on the best candidate still being ahead',
      assumedInputs: ['Uniformly random arrival order, strict comparability, only relative ranks observed, irrevocable choices.'],
      limitations: [
        'Success means one of the selections is the single best. A selection that turns out second best counts for nothing.',
        'Only relative records are ever accepted, which is optimal for this objective but not for an objective that rewards near-misses.',
      ],
    },
  };
}

/* --------------------------------- known value distribution (full information) */

export interface ReservationValueResult {
  /** Reservation values: accept at step i if the offer is at least this. */
  reservationValues: number[];
  /** Expected value obtained by following the rule from the start. */
  expectedValue: number;
  provenance: Provenance;
}

/** Midpoint quadrature of E[max(X, v)] over the quantile function. */
function expectedMaxWith(quantile: (p: number) => number, v: number, nodes: number): number {
  let acc = 0;
  for (let i = 0; i < nodes; i++) {
    const u = (i + 0.5) / nodes;
    const x = quantile(u);
    if (!Number.isFinite(x)) {
      throw new EngineError(`The quantile function returned a non-finite value at p = ${u}; the reservation value cannot be computed.`, 'finite');
    }
    acc += x > v ? x : v;
  }
  return acc / nodes;
}

/**
 * Finite-horizon search with a KNOWN value distribution and no recall: n offers
 * arrive, each drawn independently from the supplied distribution, and the
 * objective is the expected value of the accepted offer.
 *
 * The reservation values satisfy v_n = −∞ (the last offer must be taken) and
 * v_i = −c + δ·E[max(X, v_{i+1})], computed backwards. They DECLINE as the
 * deadline approaches, which is the whole content of the result: being choosy
 * is only affordable while there is time left.
 */
export function finiteHorizonSearch(
  n: number,
  quantile: (p: number) => number,
  opts: { searchCost?: number; discount?: number; quadratureNodes?: number } = {},
): ReservationValueResult {
  if (!Number.isInteger(n) || n < 1) throw new EngineError(`The number of offers must be a whole number of at least 1; ${n} was supplied.`, 'range');
  const cost = opts.searchCost ?? 0;
  const discount = opts.discount ?? 1;
  const nodes = opts.quadratureNodes ?? 20000;
  if (!Number.isFinite(cost) || cost < 0) throw new EngineError('The search cost per offer must be a finite number of at least 0.', 'range');
  if (!Number.isFinite(discount) || discount <= 0 || discount > 1) throw new EngineError('The discount factor per offer must lie in (0, 1].', 'range');
  if (!Number.isInteger(nodes) || nodes < 100) throw new EngineError('quadratureNodes must be a whole number of at least 100.', 'range');

  const reservation = new Array<number>(n).fill(-Infinity);
  // v_{n-1} (the last offer) has no continuation: accept whatever arrives.
  let continuation = -Infinity;
  for (let i = n - 1; i >= 0; i--) {
    reservation[i] = continuation;
    if (i > 0) continuation = -cost + discount * expectedMaxWith(quantile, continuation === -Infinity ? -Infinity : continuation, nodes);
  }
  // Expected value of the whole policy: the continuation value before offer 1.
  const expectedValue = expectedMaxWith(quantile, reservation[0] === -Infinity ? -Infinity : reservation[0], nodes);
  return {
    reservationValues: reservation,
    expectedValue,
    provenance: {
      exactness: 'numerical',
      method: `Backward induction on reservation values with ${nodes}-node midpoint quadrature of E[max(X, v)]`,
      assumedInputs: ['Offers are INDEPENDENT draws from the supplied distribution, and the distribution is known exactly.'],
      limitations: [
        `E[max(X, v)] is integrated numerically; with ${nodes} midpoint nodes the quadrature error is O(n⁻²) for a smooth quantile function and larger near a jump.`,
        'No recall: a rejected offer is gone. With recall the thresholds would be the same for independent offers, because an offer worth recalling would not have been rejected.',
        'The objective is the expected accepted value, not the probability of catching the best offer. Those two objectives give different rules.',
      ],
    },
  };
}

export interface JobSearchResult {
  /** The single reservation value: accept any offer at or above it. */
  reservationValue: number;
  /** Probability an arriving offer is acceptable. */
  acceptanceProbability: number;
  /** Expected number of offers examined, including the accepted one. */
  expectedOffers: number;
  provenance: Provenance;
}

/**
 * Infinite-horizon search (house selling / job search) with iid offers, a cost
 * c per offer examined and discount δ per period. The value of being about to
 * see an offer solves
 *
 *     V = −c + δ·E[max(X, V)]
 *
 * and V is itself the reservation value: accept an offer iff it is at least V.
 * With δ = 1 the fixed point exists only when c > 0; searching forever for free
 * has no finite answer and that case is refused rather than approximated.
 *
 * Recall is irrelevant here, and that is a result rather than an omission: an
 * offer below the stationary reservation value would never be worth recalling,
 * and one above it would already have been accepted.
 */
export function jobSearch(
  quantile: (p: number) => number,
  opts: { searchCost?: number; discount?: number; quadratureNodes?: number; bracket?: [number, number] } = {},
): JobSearchResult {
  const cost = opts.searchCost ?? 0;
  const discount = opts.discount ?? 1;
  const nodes = opts.quadratureNodes ?? 20000;
  if (!Number.isFinite(cost) || cost < 0) throw new EngineError('The search cost per offer must be a finite number of at least 0.', 'range');
  if (!Number.isFinite(discount) || discount <= 0 || discount > 1) throw new EngineError('The discount factor per offer must lie in (0, 1].', 'range');
  if (discount === 1 && cost === 0) {
    throw new EngineError(
      'With no discounting and no search cost there is no reason ever to stop: the problem has no optimal stopping rule and no finite reservation value. Supply a positive search cost or a discount factor below 1.',
      'ill-posed',
    );
  }
  const lo = opts.bracket?.[0] ?? quantile(1e-9) - 1;
  const hi = opts.bracket?.[1] ?? quantile(1 - 1e-9) + 1;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
    throw new EngineError('The offer distribution has unbounded support at the tested quantiles; supply an explicit bracket for the reservation value.', 'range');
  }
  const f = (v: number): number => -cost + discount * expectedMaxWith(quantile, v, nodes) - v;
  const flo = f(lo);
  const fhi = f(hi);
  if (!(flo > 0) || !(fhi < 0)) {
    throw new EngineError(
      `The reservation-value equation V = −c + δ·E[max(X, V)] is not bracketed on [${lo}, ${hi}] (residuals ${flo.toExponential(3)} and ${fhi.toExponential(3)}). Supply a wider bracket.`,
      'numerical',
    );
  }
  const reservationValue = brentRoot(f, lo, hi, { tol: 1e-12 });
  // P(X ≥ V) by the same quadrature, so the two numbers are consistent.
  let above = 0;
  for (let i = 0; i < nodes; i++) {
    const u = (i + 0.5) / nodes;
    if (quantile(u) >= reservationValue) above++;
  }
  const acceptanceProbability = above / nodes;
  if (!(acceptanceProbability > 0)) {
    throw new EngineError(
      'No offer in the distribution reaches the reservation value, so the search never ends. The search cost is too high relative to the offers available.',
      'ill-posed',
    );
  }
  return {
    reservationValue,
    acceptanceProbability,
    expectedOffers: 1 / acceptanceProbability,
    provenance: {
      exactness: 'numerical',
      method: `Fixed point of V = −c + δ·E[max(X, V)] by Brent's method with ${nodes}-node quadrature`,
      assumedInputs: ['Offers are INDEPENDENT draws from a known, time-invariant distribution.'],
      limitations: [
        'The reservation value is stationary, so the rule never gets less choosy. That is a consequence of the infinite horizon; with a deadline the thresholds decline (see finiteHorizonSearch).',
        'The expected number of offers is geometric with the acceptance probability; its distribution has a long right tail, so the mean understates how long a bad run can last.',
        'Recall makes no difference for independent offers under the stationary rule.',
      ],
    },
  };
}

/* --------------------------------------------------------------- SPRT */

export interface SPRTResult {
  p0: number;
  p1: number;
  alpha: number;
  beta: number;
  /** Upper log-likelihood-ratio boundary: cross it and reject H0. */
  upperBoundary: number;
  /** Lower boundary: cross it and accept H0. */
  lowerBoundary: number;
  /** Per-observation log-likelihood-ratio increments for success/failure. */
  increments: { success: number; failure: number };
  /** Wald's approximate expected sample size under each hypothesis. */
  expectedSampleSize: { underH0: number; underH1: number };
  /** Fixed-sample size needed for the same two error rates. */
  fixedSampleSize: number;
  /** Exact (truncated) operating characteristic by lattice enumeration. */
  operatingCharacteristic: { p: number; acceptH0: number; rejectH0: number; expectedN: number; unresolved: number }[];
  provenance: Provenance;
}

/**
 * Wald's sequential probability ratio test for Bernoulli data, H0: p = p0
 * against H1: p = p1.
 *
 * Boundaries from the target error rates: reject H0 when the log-likelihood
 * ratio exceeds log((1−β)/α), accept H0 when it falls below log(β/(1−α)).
 * These are Wald's approximations — they ignore overshoot past the boundary, so
 * the realised error rates are slightly BELOW the targets, which is the safe
 * direction.
 *
 * The operating characteristic and the expected sample size are computed
 * EXACTLY by enumerating the lattice of (n, successes) states up to
 * `maxSteps`, with the unresolved probability mass reported rather than
 * ignored, so a truncation that matters is visible.
 */
export function sprt(
  p0: number,
  p1: number,
  alpha: number,
  beta: number,
  opts: { maxSteps?: number; grid?: number[] } = {},
): SPRTResult {
  for (const [name, v] of [
    ['p0', p0],
    ['p1', p1],
    ['alpha', alpha],
    ['beta', beta],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0 || v >= 1) {
      throw new EngineError(`${name} must lie strictly between 0 and 1; ${v} was supplied.`, 'range');
    }
  }
  if (Math.abs(p1 - p0) < 1e-12) {
    throw new EngineError('The two hypotheses are identical, so no test can distinguish them. Separate p0 and p1.', 'degenerate');
  }
  if (alpha + beta >= 1) {
    throw new EngineError(`The error targets α = ${alpha} and β = ${beta} sum to ${alpha + beta}, which is 1 or more. No sensible test has boundaries then (the "reject" boundary would sit below the "accept" boundary).`, 'range');
  }
  const maxSteps = opts.maxSteps ?? 5000;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new EngineError('maxSteps must be a whole number of at least 1.', 'range');

  const A = Math.log((1 - beta) / alpha);
  const B = Math.log(beta / (1 - alpha));
  const cSuccess = Math.log(p1 / p0);
  const cFailure = Math.log((1 - p1) / (1 - p0));
  // E[z] under each hypothesis is ∓ the Kullback–Leibler divergence.
  const ez0 = p0 * cSuccess + (1 - p0) * cFailure;
  const ez1 = p1 * cSuccess + (1 - p1) * cFailure;
  const asn0 = ((1 - alpha) * B + alpha * A) / ez0;
  const asn1 = ((1 - beta) * A + beta * B) / ez1;

  // Fixed-sample size for the same errors, normal approximation at both points.
  const z1 = normalQuantile(1 - alpha);
  const z2 = normalQuantile(1 - beta);
  const s0 = Math.sqrt(p0 * (1 - p0));
  const s1 = Math.sqrt(p1 * (1 - p1));
  const fixedSampleSize = Math.pow((z1 * s0 + z2 * s1) / (p1 - p0), 2);

  const grid = opts.grid ?? [p0, (p0 + p1) / 2, p1];
  const operatingCharacteristic = grid.map((p) => {
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new EngineError(`The operating-characteristic grid contains ${p}, which is not a probability.`, 'range');
    return latticeSequentialOC(p, maxSteps, (n, k) => {
      const llr = k * cSuccess + (n - k) * cFailure;
      if (llr >= A) return 'reject';
      if (llr <= B) return 'accept';
      return 'continue';
    });
  });

  return {
    p0,
    p1,
    alpha,
    beta,
    upperBoundary: A,
    lowerBoundary: B,
    increments: { success: cSuccess, failure: cFailure },
    expectedSampleSize: { underH0: asn0, underH1: asn1 },
    fixedSampleSize,
    operatingCharacteristic,
    provenance: {
      exactness: 'numerical',
      method: "Wald's SPRT boundaries, with the operating characteristic by exact lattice enumeration",
      assumedInputs: ['Observations are independent Bernoulli draws with a constant success probability.'],
      limitations: [
        'THE ERROR RATES HOLD ONLY FOR THESE PRE-DECLARED BOUNDARIES. Stopping for any other reason — a deadline, an encouraging interim look, running out of budget, a boundary changed after seeing data — voids them completely. Optional stopping is valid here precisely because the stopping rule was fixed in advance, and this is the single most abused idea in applied statistics.',
        "Wald's boundaries ignore the overshoot past the boundary, so the realised error rates are slightly below the nominal targets and the test is slightly conservative.",
        'The expected sample sizes are the Wald approximations; the exact values from the lattice enumeration are reported alongside in the operating characteristic.',
        'The SPRT is optimal (Wald–Wolfowitz) for discriminating these TWO points. At a true p between p0 and p1 it takes considerably longer than at either, and the operating characteristic shows it.',
        'The test has no fixed maximum sample size. The enumeration here truncates at the stated maxSteps and reports the unresolved probability mass.',
      ],
    },
  };
}

/**
 * Exact operating characteristic of any Bernoulli sequential rule that depends
 * only on (n, successes), by forward enumeration of the lattice. Returns the
 * probability of each decision, the expected sample size among resolved paths
 * and the probability mass still undecided at the truncation point.
 */
export function latticeSequentialOC(
  p: number,
  maxSteps: number,
  decide: (n: number, k: number) => 'accept' | 'reject' | 'continue',
): { p: number; acceptH0: number; rejectH0: number; expectedN: number; unresolved: number } {
  // mass[k] = P(reach step n with k successes and still continuing).
  let mass = new Float64Array(1);
  mass[0] = 1;
  let accept = 0;
  let reject = 0;
  let expectedN = 0;
  for (let n = 1; n <= maxSteps; n++) {
    const next = new Float64Array(n + 1);
    for (let k = 0; k < mass.length; k++) {
      const m = mass[k];
      if (m === 0) continue;
      next[k + 1] += m * p;
      next[k] += m * (1 - p);
    }
    for (let k = 0; k <= n; k++) {
      if (next[k] === 0) continue;
      const d = decide(n, k);
      if (d === 'accept') {
        accept += next[k];
        expectedN += n * next[k];
        next[k] = 0;
      } else if (d === 'reject') {
        reject += next[k];
        expectedN += n * next[k];
        next[k] = 0;
      }
    }
    mass = next;
    let remaining = 0;
    for (let k = 0; k <= n; k++) remaining += mass[k];
    if (remaining < 1e-15) break;
  }
  let unresolved = 0;
  for (let k = 0; k < mass.length; k++) unresolved += mass[k];
  const resolved = accept + reject;
  return { p, acceptH0: accept, rejectH0: reject, expectedN: resolved > 0 ? expectedN / resolved : NaN, unresolved };
}

/* ------------------------------------------- Bayesian sequential analysis */

export interface BayesianSequentialResult {
  /** Posterior-probability threshold used to stop for H1. */
  threshold: number;
  /** For each n, the smallest success count that triggers stopping (or null). */
  stoppingCounts: (number | null)[];
  /** Frequentist operating characteristic of this Bayesian rule. */
  operatingCharacteristic: { p: number; stopForH1: number; expectedN: number; unresolved: number }[];
  provenance: Provenance;
}

/**
 * Bayesian sequential analysis for a Bernoulli parameter with a Beta(a, b)
 * prior: keep sampling until P(p > pRef | data) ≥ threshold (stop for H1) or
 * P(p > pRef | data) ≤ 1 − threshold (stop against it), up to maxSteps.
 *
 * The posterior probability is exact (a regularised incomplete beta), and the
 * frequentist error rates of the resulting rule are computed by the same exact
 * lattice enumeration used for the SPRT — because a Bayesian stopping rule has
 * frequentist properties whether or not anyone looks at them, and they are
 * usually the thing a reader cares about.
 */
export function bayesianSequential(
  pRef: number,
  threshold: number,
  opts: { priorA?: number; priorB?: number; maxSteps?: number; grid?: number[]; minSteps?: number } = {},
): BayesianSequentialResult {
  if (!Number.isFinite(pRef) || pRef <= 0 || pRef >= 1) throw new EngineError(`The reference probability must lie strictly between 0 and 1; ${pRef} was supplied.`, 'range');
  if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold >= 1) {
    throw new EngineError(`The posterior threshold must lie strictly between 0.5 and 1; ${threshold} was supplied. A threshold of 0.5 or below would stop immediately in one direction or the other.`, 'range');
  }
  const a = opts.priorA ?? 1;
  const b = opts.priorB ?? 1;
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) throw new EngineError('The Beta prior parameters must both be greater than 0.', 'range');
  const maxSteps = opts.maxSteps ?? 500;
  const minSteps = opts.minSteps ?? 1;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new EngineError('maxSteps must be a whole number of at least 1.', 'range');
  if (!Number.isInteger(minSteps) || minSteps < 1 || minSteps > maxSteps) throw new EngineError(`minSteps must be a whole number in 1..${maxSteps}.`, 'range');

  // Posterior P(p > pRef) = 1 − I_{pRef}(a+k, b+n−k).
  const posteriorAbove = (n: number, k: number): number => regularisedBetaUpper(pRef, a + k, b + n - k);
  const decide = (n: number, k: number): 'accept' | 'reject' | 'continue' => {
    if (n < minSteps) return 'continue';
    const post = posteriorAbove(n, k);
    if (post >= threshold) return 'reject'; // reject the reference value in favour of H1
    if (post <= 1 - threshold) return 'accept';
    return 'continue';
  };
  const stoppingCounts: (number | null)[] = [null];
  for (let n = 1; n <= maxSteps; n++) {
    let found: number | null = null;
    for (let k = 0; k <= n; k++) {
      if (decide(n, k) === 'reject') {
        found = k;
        break;
      }
    }
    stoppingCounts.push(found);
  }
  const grid = opts.grid ?? [pRef, Math.min(0.999, pRef * 1.5)];
  const operatingCharacteristic = grid.map((p) => {
    const oc = latticeSequentialOC(p, maxSteps, decide);
    return { p, stopForH1: oc.rejectH0, expectedN: oc.expectedN, unresolved: oc.unresolved };
  });
  return {
    threshold,
    stoppingCounts,
    operatingCharacteristic,
    provenance: {
      exactness: 'numerical',
      method: `Posterior-probability stopping rule under a Beta(${a}, ${b}) prior, with frequentist properties by exact lattice enumeration`,
      assumedInputs: [
        `The Beta(${a}, ${b}) prior is an assumption and it changes the stopping times, especially early on when the data are thin.`,
        'Observations are independent Bernoulli draws with a constant success probability.',
      ],
      limitations: [
        'A posterior-probability threshold is NOT a type I error rate. The frequentist probability of stopping for H1 when the reference value is true is reported separately, and it is generally larger than 1 − threshold.',
        'The rule has no fixed sample size; the enumeration truncates at maxSteps and reports the undecided mass.',
        'The posterior is exact given the prior and the likelihood; the honesty problem here is the prior, not the arithmetic.',
      ],
    },
  };
}

/** P(p > x) under a Beta(a, b) posterior = 1 − I_x(a, b), the upper tail. */
function regularisedBetaUpper(x: number, a: number, b: number): number {
  return clamp(incompleteBeta(x, a, b).upper, 0, 1);
}

/* -------------------------------------------------- group sequential designs */

export type SpendingFunction = 'obrien-fleming' | 'pocock';

export interface AlphaSpendingResult {
  looks: number;
  alpha: number;
  spending: SpendingFunction;
  /** Information fractions t_k = k/K. */
  informationFractions: number[];
  /** Two-sided critical values on the standardised test statistic Z_k. */
  boundaries: number[];
  /** Cumulative α spent by look k (equals the spending function at t_k). */
  cumulativeAlpha: number[];
  /** Incremental α spent at look k. */
  incrementalAlpha: number[];
  /**
   * Maximum sample size inflation relative to a fixed-sample design with the
   * same α and power: the price of being allowed to stop early.
   */
  maximumSampleSizeInflation: number;
  power: number;
  provenance: Provenance;
}

/**
 * O'Brien–Fleming and Pocock alpha-spending boundaries for a group sequential
 * design with K equally spaced looks.
 *
 * Boundaries are found sequentially: at look k the critical value is chosen so
 * that the cumulative probability of crossing, under the null, equals the
 * spending function at t_k = k/K. The joint crossing probabilities come from
 * the Armitage–McPherson–Rowe recursion — a numerical convolution of the
 * Brownian increments on a grid — so this is numerical, with the grid stated.
 *
 * The price of the interim looks is reported as the inflation of the maximum
 * sample size needed to keep the same power. It is small for O'Brien–Fleming
 * (a few per cent) and substantial for Pocock (around a fifth), and it is
 * routinely left out of sample-size calculations.
 */
export function alphaSpendingBoundaries(
  looks: number,
  alpha = 0.05,
  spending: SpendingFunction = 'obrien-fleming',
  opts: { power?: number; gridPoints?: number; range?: number } = {},
): AlphaSpendingResult {
  if (!Number.isInteger(looks) || looks < 1 || looks > 40) throw new EngineError(`The number of looks must be a whole number in 1..40; ${looks} was supplied.`, 'range');
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 0.5) throw new EngineError(`The two-sided α must lie in (0, 0.5); ${alpha} was supplied.`, 'range');
  const power = opts.power ?? 0.9;
  if (!Number.isFinite(power) || power <= alpha || power >= 1) throw new EngineError(`The target power must lie in (α, 1); ${power} was supplied.`, 'range');
  const grid = opts.gridPoints ?? 801;
  if (!Number.isInteger(grid) || grid < 201) throw new EngineError('gridPoints must be a whole number of at least 201.', 'range');
  const range = opts.range ?? 8;

  const t = Array.from({ length: looks }, (_, k) => (k + 1) / looks);
  const zAlpha = normalQuantile(1 - alpha / 2);
  const spend = (frac: number): number => {
    if (spending === 'pocock') return alpha * Math.log(1 + (Math.E - 1) * frac);
    // O'Brien–Fleming spending function (Lan–DeMets).
    return 2 * (1 - normalCdf(zAlpha / Math.sqrt(frac)));
  };
  const cumulativeAlpha = t.map((frac) => Math.min(alpha, spend(frac)));

  // Grid over the un-standardised statistic S_k (Brownian motion in
  // information time, Var(S_k) = t_k).
  const half = range;
  const h = (2 * half) / (grid - 1);
  const xs = new Float64Array(grid);
  for (let i = 0; i < grid; i++) xs[i] = -half + i * h;

  /**
   * One step of the Armitage–McPherson–Rowe recursion: propagate the
   * sub-density of the continuation region forward by an increment of
   * information dt under drift θ. Passing `null` starts from S_0 = 0.
   */
  const propagate = (dens: Float64Array | null, dt: number, theta: number): Float64Array => {
    const sd = Math.sqrt(dt);
    const mu = theta * dt;
    const norm = 1 / (sd * Math.sqrt(2 * Math.PI));
    const out = new Float64Array(grid);
    if (dens === null) {
      for (let i = 0; i < grid; i++) out[i] = norm * Math.exp(-0.5 * Math.pow((xs[i] - mu) / sd, 2));
      return out;
    }
    for (let j = 0; j < grid; j++) {
      const d = dens[j];
      if (d === 0) continue;
      const w = d * h * norm;
      const centre = xs[j] + mu;
      for (let i = 0; i < grid; i++) {
        const z = (xs[i] - centre) / sd;
        if (z > 8 || z < -8) continue;
        out[i] += w * Math.exp(-0.5 * z * z);
      }
    }
    return out;
  };

  /** Mass of a sub-density outside ±limit, and the restricted density. */
  const splitAt = (dens: Float64Array, limit: number): { crossed: number; inside: Float64Array } => {
    const inside = new Float64Array(grid);
    let insideMass = 0;
    let total = 0;
    for (let i = 0; i < grid; i++) {
      total += dens[i];
      if (Math.abs(xs[i]) < limit) {
        inside[i] = dens[i];
        insideMass += dens[i];
      }
    }
    return { crossed: (total - insideMass) * h, inside };
  };

  /** Total crossing probability by the final look, under drift θ. */
  const crossingByEnd = (bounds: number[], theta: number): number => {
    let dens: Float64Array | null = null;
    let prev = 0;
    let crossed = 0;
    for (let k = 0; k < bounds.length; k++) {
      const pred = propagate(dens, t[k] - prev, theta);
      const split = splitAt(pred, bounds[k] * Math.sqrt(t[k]));
      crossed += split.crossed;
      dens = split.inside;
      prev = t[k];
    }
    return crossed;
  };

  const boundaries: number[] = [];
  const incrementalAlpha: number[] = [];
  let dens: Float64Array | null = null;
  let prevT = 0;
  let spentSoFar = 0;
  for (let k = 0; k < looks; k++) {
    const pred = propagate(dens, t[k] - prevT, 0);
    // Crossing is monotone decreasing in the critical value, so the boundary is
    // found by a single root find on the tail mass of a density already fixed.
    const target = cumulativeAlpha[k] - spentSoFar;
    if (!(target > 0)) {
      throw new EngineError(
        `The ${spending} spending function allocates no further α at look ${k + 1} (cumulative target ${cumulativeAlpha[k].toExponential(3)} is already spent). Reduce the number of looks.`,
        'degenerate',
      );
    }
    const f = (c: number): number => splitAt(pred, c * Math.sqrt(t[k])).crossed - target;
    const loC = 0.05;
    let hiC = 12;
    if (!(f(loC) > 0)) {
      throw new EngineError(
        `The α-spending boundary at look ${k + 1} could not be bracketed: even a critical value of ${loC} spends less than the target ${target.toExponential(3)}.`,
        'numerical',
      );
    }
    while (f(hiC) > 0 && hiC < 40) hiC *= 1.5;
    if (!(f(hiC) < 0)) {
      throw new EngineError(`The α-spending boundary at look ${k + 1} could not be bracketed from above.`, 'numerical');
    }
    const c = brentRoot(f, loC, hiC, { tol: 1e-9 });
    const split = splitAt(pred, c * Math.sqrt(t[k]));
    boundaries.push(c);
    incrementalAlpha.push(split.crossed);
    spentSoFar += split.crossed;
    dens = split.inside;
    prevT = t[k];
  }

  // Inflation: find the drift θ (per unit information) giving the target power,
  // and compare the information it needs with the fixed-sample design's.
  const zBeta = normalQuantile(power);
  const fixedDrift = zAlpha + zBeta;
  const g = (theta: number): number => crossingByEnd(boundaries, theta) - power;
  let thetaHi = fixedDrift * 1.5;
  while (g(thetaHi) < 0 && thetaHi < fixedDrift * 8) thetaHi *= 1.3;
  if (!(g(0) < 0) || !(g(thetaHi) > 0)) {
    throw new EngineError('The group-sequential power curve could not be bracketed; the maximum-sample-size inflation is not reported.', 'numerical');
  }
  const theta = brentRoot(g, 0, thetaHi, { tol: 1e-6 });
  // Information scales as the squared drift ratio, and sample size with information.
  const maximumSampleSizeInflation = Math.pow(theta / fixedDrift, 2);

  return {
    looks,
    alpha,
    spending,
    informationFractions: t,
    boundaries,
    cumulativeAlpha,
    incrementalAlpha,
    maximumSampleSizeInflation,
    power,
    provenance: {
      exactness: 'numerical',
      method: `${spending === 'pocock' ? 'Pocock' : "O'Brien–Fleming"} α-spending with boundaries from the Armitage–McPherson–Rowe recursion on a ${grid}-point grid`,
      assumedInputs: [
        'The test statistic is assumed to follow a Brownian motion in the information time — the usual large-sample approximation for a sequence of z-tests. With small groups or heavy-tailed data this is the weak link, not the boundary calculation.',
        'The looks are assumed equally spaced in information. Unequal spacing changes the boundaries.',
      ],
      limitations: [
        `INTERIM LOOKS ARE NOT FREE: keeping ${(power * 100).toFixed(0)}% power with ${looks} looks requires ${((maximumSampleSizeInflation - 1) * 100).toFixed(1)}% more maximum sample size than the fixed-sample design. The EXPECTED sample size is usually smaller, but the budget has to cover the maximum.`,
        "O'Brien–Fleming spends almost no α at the first looks, so it is very hard to stop early but costs little in maximum sample size; Pocock spends evenly, stops early more readily, and costs considerably more. Neither is 'correct' — they trade the same quantity in opposite directions.",
        'The α spent is exhausted by design. Adding an unplanned look after seeing the data invalidates the whole scheme, exactly as with the SPRT.',
        'Boundary crossing probabilities are computed on a finite grid; the reported α may differ from the target in the last digits shown.',
      ],
    },
  };
}

/* ----------------------------------------- Markov stopping / one-stage rule */

export interface MarkovStoppingProblem {
  /** Reward for stopping in each state. */
  stopReward: number[];
  /** Reward received for choosing to continue from each state. */
  continueReward?: number[];
  /** Transition matrix used when continuing. Rows must sum to 1. */
  transitions: number[][];
  discount?: number;
  stateLabels?: string[];
}

export interface MarkovStoppingResult {
  /** The one-stage look-ahead set B: states where stopping beats one more step. */
  oneStageSet: boolean[];
  /** Whether B is closed under the transition law (the monotone condition). */
  monotone: boolean;
  /** The exact optimal stopping value, by value iteration to tolerance. */
  values: number[];
  /** The exactly optimal stop/continue decision. */
  stopOptimal: boolean[];
  /** States where the one-stage rule differs from the optimum. */
  disagreements: number[];
  provenance: Provenance;
}

/**
 * Markov optimal stopping with the one-stage look-ahead (OSLA) rule.
 *
 * The OSLA set is B = { s : g(s) ≥ c(s) + δ·Σ P(s,s')·g(s') } — the states
 * where stopping now beats continuing exactly one more step and then stopping.
 * The OSLA rule (stop as soon as you enter B) is optimal if and only if the
 * problem is MONOTONE, i.e. B is closed: from inside B the process cannot leave
 * B. That condition is checked here against the transition matrix rather than
 * assumed, and a non-monotone problem is reported as an error — the rule does
 * not apply, and reporting its answer anyway would be reporting a wrong policy
 * with a confident face.
 *
 * The exact optimum is computed by value iteration regardless, so the two can
 * be compared.
 */
export function markovStopping(problem: MarkovStoppingProblem, opts: { tolerance?: number; maxIterations?: number } = {}): MarkovStoppingResult {
  const n = problem.stopReward.length;
  if (n < 1) throw new EngineError('A Markov stopping problem needs at least one state.', 'empty');
  if (problem.transitions.length !== n) throw new EngineError(`The transition matrix must have one row per state (${n}).`, 'shape');
  const name = (s: number): string => problem.stateLabels?.[s] ?? String(s);
  const discount = problem.discount ?? 1;
  if (!Number.isFinite(discount) || discount < 0 || discount > 1) throw new EngineError('The discount factor must lie in [0, 1].', 'range');
  const cont = problem.continueReward ?? new Array<number>(n).fill(0);
  if (cont.length !== n) throw new EngineError(`continueReward must have one entry per state (${n}).`, 'shape');
  for (let s = 0; s < n; s++) {
    if (!Number.isFinite(problem.stopReward[s])) throw new EngineError(`The stopping reward in state ${name(s)} is not a finite number.`, 'finite');
    if (!Number.isFinite(cont[s])) throw new EngineError(`The continuation reward in state ${name(s)} is not a finite number.`, 'finite');
    const row = problem.transitions[s];
    if (!Array.isArray(row) || row.length !== n) throw new EngineError(`Transition row for state ${name(s)} must have one probability per state (${n}).`, 'shape');
    let sum = 0;
    for (const p of row) {
      if (!Number.isFinite(p) || p < 0) throw new EngineError(`Transition row for state ${name(s)} contains a value that is not a probability.`, 'range');
      sum += p;
    }
    if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`Transition probabilities for state ${name(s)} sum to ${sum.toPrecision(12)}, not 1.`, 'sum');
  }

  const g = problem.stopReward;
  const oneStageSet: boolean[] = [];
  for (let s = 0; s < n; s++) {
    let acc = 0;
    for (let j = 0; j < n; j++) if (problem.transitions[s][j] !== 0) acc += problem.transitions[s][j] * g[j];
    oneStageSet.push(g[s] >= cont[s] + discount * acc - 1e-12);
  }
  // Monotone ⇔ B is closed: from s ∈ B, every reachable state is in B.
  const leaks: { from: number; to: number }[] = [];
  for (let s = 0; s < n; s++) {
    if (!oneStageSet[s]) continue;
    for (let j = 0; j < n; j++) {
      if (problem.transitions[s][j] > 0 && !oneStageSet[j]) leaks.push({ from: s, to: j });
    }
  }
  const monotone = leaks.length === 0;

  // Exact optimum by value iteration: v(s) = max(g(s), c(s) + δ·Σ P v).
  const tolerance = opts.tolerance ?? 1e-12;
  const maxIterations = opts.maxIterations ?? 200000;
  const values = g.slice();
  let delta = Infinity;
  let iterations = 0;
  while (iterations < maxIterations) {
    delta = 0;
    const next = new Array<number>(n).fill(0);
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let j = 0; j < n; j++) if (problem.transitions[s][j] !== 0) acc += problem.transitions[s][j] * values[j];
      const v = Math.max(g[s], cont[s] + discount * acc);
      const d = Math.abs(v - values[s]);
      if (d > delta) delta = d;
      next[s] = v;
    }
    for (let s = 0; s < n; s++) values[s] = next[s];
    iterations++;
    if (delta <= tolerance) break;
  }
  if (delta > tolerance) {
    throw new EngineError(
      `The optimal stopping value iteration did not converge within ${maxIterations} sweeps (achieved change ${delta.toExponential(3)}). With δ = 1 the value can be unbounded if continuing is free and the reward can grow without limit; no value function is reported.`,
      'convergence',
    );
  }
  const stopOptimal: boolean[] = [];
  const disagreements: number[] = [];
  for (let s = 0; s < n; s++) {
    let acc = 0;
    for (let j = 0; j < n; j++) if (problem.transitions[s][j] !== 0) acc += problem.transitions[s][j] * values[j];
    const stop = g[s] >= cont[s] + discount * acc - 1e-10;
    stopOptimal.push(stop);
    if (stop !== oneStageSet[s]) disagreements.push(s);
  }
  if (!monotone) {
    const ex = leaks[0];
    throw new EngineError(
      `This stopping problem is NOT monotone, so the one-stage look-ahead rule is not optimal and its answer is withheld: from state ${name(ex.from)}, which is in the one-stage stopping set, the process moves with probability ${problem.transitions[ex.from][ex.to]} to state ${name(ex.to)}, which is not. ${leaks.length} such leak(s) were found. The exact optimum from value iteration is available from the value-iteration route instead.`,
      'not-monotone',
    );
  }
  return {
    oneStageSet,
    monotone,
    values,
    stopOptimal,
    disagreements,
    provenance: {
      exactness: 'numerical',
      method: `One-stage look-ahead set with a closure check, alongside exact optimal stopping by value iteration (${iterations} sweeps)`,
      assumedInputs: ['The transition law, the stopping reward and the continuation reward are supplied by the user.'],
      limitations: [
        'The one-stage look-ahead rule is optimal here BECAUSE the problem was verified monotone. The same rule on a non-monotone problem is simply wrong, and this routine refuses that case rather than reporting it.',
        `The value function comes from value iteration to a change of ${delta.toExponential(3)} per sweep; with δ = 1 there is no contraction bound, so convergence of the iterates is the only evidence of accuracy.`,
      ],
    },
  };
}
