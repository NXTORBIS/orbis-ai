/**
 * Estimating entropy and mutual information FROM DATA.
 *
 * Everything in this file is `empirical`: it is an estimate with sampling
 * error, and for entropy it is also BIASED. The plug-in (maximum-likelihood)
 * entropy of observed frequencies is biased DOWNWARD — unseen outcomes cannot
 * contribute, and the observed frequencies are always "lumpier" than the truth
 * — with bias ≈ −(K−1)/(2n) for K outcomes and n observations. At n = 30 over
 * 10 outcomes that is about 0.15 nats, which is not a rounding error.
 *
 * Reporting a plug-in entropy from a small sample and calling it "the entropy"
 * would be exactly the sort of plausible-looking number this project forbids,
 * so every estimator here reports its bias correction and the direction of the
 * bias it is correcting.
 */
import { EngineError } from '../core/result';
import type { Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { digamma, logGamma } from '../special/gamma';
import { Random } from '../random/rng';
import { BASE_LABEL, fromNats, resolveBase, type BaseOptions, type LogBase } from './types';
import { entropyNats } from './entropy';

export type BiasDirection = 'underestimates' | 'overestimates' | 'approximately unbiased';

export interface EntropyEstimate {
  name: string;
  /** Estimate in the requested unit. */
  value: number;
  /** The correction added to the plug-in value, in the requested unit (0 for the plug-in itself). */
  correction: number;
  /** Direction of the bias this estimator still has, as far as is known. */
  biasDirection: BiasDirection;
  note: string;
}

export interface EntropyEstimationResult {
  base: LogBase;
  baseLabel: string;
  /** Number of observations. */
  n: number;
  /** Number of distinct observed outcomes. */
  observedOutcomes: number;
  /** Number of outcomes seen exactly once (Good–Turing f₁). */
  singletons: number;
  /** Number of outcomes seen exactly twice. */
  doubletons: number;
  /** Good–Turing coverage estimate 1 − f₁/n. */
  coverage: number;
  /** Number of outcomes assumed to exist, when the caller supplied it. */
  assumedAlphabetSize?: number;
  estimates: EntropyEstimate[];
  /** The estimator recommended for this sample, by name. */
  recommended: string;
  exactness: 'empirical';
  explanation: Explanation;
}

export interface EstimationOptions extends BaseOptions {
  /**
   * Known size of the alphabet, if it is known. Several corrections need it;
   * without it the number of OBSERVED outcomes is used instead, which itself
   * underestimates the alphabet and so under-corrects. That substitution is
   * reported.
   */
  alphabetSize?: number;
  /** Concentration for the Bayesian (Dirichlet-prior) estimator. Default ½ (Jeffreys). */
  dirichletAlpha?: number;
}

/** Tally integer-coded or string-coded observations into counts. */
export function tally<T extends string | number>(samples: ArrayLike<T>): { counts: number[]; labels: T[] } {
  if (samples.length === 0) throw new EngineError('Cannot estimate entropy from an empty sample.', 'empty');
  const map = new Map<T, number>();
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) {
      throw new EngineError(`Observation ${i} is not a valid category label (${String(v)}).`, 'finite');
    }
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  const labels = [...map.keys()];
  return { counts: labels.map((l) => map.get(l) as number), labels };
}

function validateCounts(counts: ArrayLike<number>): number[] {
  if (counts.length === 0) throw new EngineError('The count vector is empty.', 'empty');
  const out = new Array<number>(counts.length);
  let n = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (!Number.isFinite(c) || c < 0 || !Number.isInteger(c)) {
      throw new EngineError(`counts[${i}] = ${String(c)} must be a non-negative whole number.`, 'integer');
    }
    out[i] = c;
    n += c;
  }
  if (n === 0) throw new EngineError('All counts are zero: there is no data to estimate from.', 'empty');
  return out;
}

/**
 * Grassberger's G function: G(1) = −γ − ln2, G(n+2) = G(n) + 2/(n+1).
 * Expressed in closed form as ψ(n) + ½(−1)^n[ψ((n+1)/2) − ψ(n/2)].
 */
function grassbergerG(n: number): number {
  if (n <= 0) return 0;
  const sign = n % 2 === 0 ? 1 : -1;
  return digamma(n) + 0.5 * sign * (digamma((n + 1) / 2) - digamma(n / 2));
}

/**
 * Entropy of a sample, with several bias corrections side by side.
 *
 * Estimators implemented:
 *  - plug-in / maximum likelihood: Ĥ = −Σ (nᵢ/n) ln(nᵢ/n). Biased DOWNWARD.
 *  - Miller–Madow: Ĥ + (K̂−1)/(2n), the first-order analytic correction.
 *  - Grassberger (1988/2003): ln n − (1/n)Σ nᵢ G(nᵢ), markedly better than
 *    Miller–Madow when many counts are small.
 *  - Chao–Shen: Horvitz–Thompson weighting with Good–Turing coverage, which
 *    accounts for the probability mass of the outcomes never seen.
 *  - Bayesian with a Dirichlet(α) prior: the posterior-mean entropy, in closed
 *    form via digamma. α = ½ is Jeffreys, α = 1 is Laplace, α = 1/K is Perks.
 */
export function estimateEntropy(counts: ArrayLike<number>, options: EstimationOptions = {}): EntropyEstimationResult {
  const base = resolveBase(options);
  const c = validateCounts(counts);
  const n = c.reduce((a, b) => a + b, 0);
  const observed = c.filter((x) => x > 0);
  const K = observed.length;
  const singletons = c.filter((x) => x === 1).length;
  const doubletons = c.filter((x) => x === 2).length;
  const coverage = 1 - singletons / n;
  const alphabetKnown = options.alphabetSize !== undefined;
  if (alphabetKnown) {
    const A = options.alphabetSize as number;
    if (!Number.isInteger(A) || A < K) {
      throw new EngineError(
        `alphabetSize must be a whole number at least as large as the ${K} outcomes actually observed; got ${A}.`,
        'range',
      );
    }
  }
  const effectiveK = alphabetKnown ? (options.alphabetSize as number) : K;

  const p = observed.map((x) => x / n);
  const plugInNats = entropyNats(p);

  const millerMadowNats = plugInNats + (effectiveK - 1) / (2 * n);

  const grassbergerNats = Math.log(n) - stableSum(observed.map((ni) => (ni * grassbergerG(ni)) / n));

  // Chao–Shen: p̃ᵢ = C·p̂ᵢ with C the coverage, inclusion probability
  // 1 − (1 − p̃ᵢ)ⁿ.
  let chaoShenNats: number;
  if (coverage <= 0) {
    // Every outcome was a singleton: the coverage estimate is 0 and the
    // estimator is undefined. Say so rather than inventing a number.
    chaoShenNats = NaN;
  } else {
    const terms = observed.map((ni) => {
      const pt = (coverage * ni) / n;
      const incl = 1 - Math.pow(1 - pt, n);
      if (!(incl > 0)) return 0;
      return (-pt * Math.log(pt)) / incl;
    });
    chaoShenNats = stableSum(terms);
  }

  // Bayesian posterior mean entropy under a Dirichlet(α,…,α) prior:
  // E[H] = ψ(A+1) − Σ (aᵢ/A) ψ(aᵢ+1), with aᵢ = nᵢ + α and A = Σ aᵢ.
  const alpha = options.dirichletAlpha ?? 0.5;
  if (!(alpha > 0)) throw new EngineError(`The Dirichlet concentration must be > 0; got ${alpha}.`, 'range');
  const bayesCounts = new Array<number>(effectiveK);
  for (let i = 0; i < effectiveK; i++) bayesCounts[i] = (i < observed.length ? observed[i] : 0) + alpha;
  const A = stableSum(bayesCounts);
  const bayesNats = digamma(A + 1) - stableSum(bayesCounts.map((a) => (a / A) * digamma(a + 1)));

  const f = (x: number) => fromNats(x, base);
  const estimates: EntropyEstimate[] = [
    {
      name: 'plug-in (maximum likelihood)',
      value: f(plugInNats),
      correction: 0,
      biasDirection: 'underestimates',
      note:
        `Biased DOWNWARD by roughly (K−1)/(2n) = ${f((effectiveK - 1) / (2 * n)).toPrecision(4)} ${base} here. ` +
        'Outcomes that never occurred contribute nothing, and observed frequencies are always less even than the truth.',
    },
    {
      name: 'Miller–Madow',
      value: f(millerMadowNats),
      correction: f((effectiveK - 1) / (2 * n)),
      biasDirection: 'underestimates',
      note:
        'Adds the first-order analytic bias term (K−1)/(2n) to the plug-in value. Removes most of the bias when every outcome is ' +
        'reasonably well sampled; still biased downward when many counts are 0 or 1' +
        (alphabetKnown ? '.' : ', and under-corrects further because the number of OBSERVED outcomes was used in place of the unknown alphabet size.'),
    },
    {
      name: 'Grassberger',
      value: f(grassbergerNats),
      correction: f(grassbergerNats - plugInNats),
      biasDirection: 'approximately unbiased',
      note:
        'ln n − (1/n)Σ nᵢ G(nᵢ) with G(n) = ψ(n) + ½(−1)ⁿ[ψ((n+1)/2) − ψ(n/2)]. Uses the exact small-count behaviour rather than ' +
        'an asymptotic term, so it is the most reliable of these when counts are small.',
    },
  ];
  if (Number.isFinite(chaoShenNats)) {
    estimates.push({
      name: 'Chao–Shen',
      value: f(chaoShenNats),
      correction: f(chaoShenNats - plugInNats),
      biasDirection: 'approximately unbiased',
      note:
        `Horvitz–Thompson weighting with the Good–Turing coverage estimate C = 1 − f₁/n = ${coverage.toPrecision(4)}. ` +
        'Designed for samples where a substantial share of the probability mass was never observed.',
    });
  } else {
    estimates.push({
      name: 'Chao–Shen',
      value: NaN,
      correction: NaN,
      biasDirection: 'approximately unbiased',
      note:
        'Not available for this sample: every observed outcome occurred exactly once, so the Good–Turing coverage estimate is 0 ' +
        'and the estimator is undefined. No substitute value is reported.',
    });
  }
  estimates.push({
    name: `Bayesian, Dirichlet(${alpha}) prior`,
    value: f(bayesNats),
    correction: f(bayesNats - plugInNats),
    biasDirection: alpha >= 1 ? 'overestimates' : 'approximately unbiased',
    note:
      `Posterior mean entropy E[H] = ψ(A+1) − Σ(aᵢ/A)ψ(aᵢ+1) with aᵢ = nᵢ + ${alpha}. ` +
      `α = ½ is the Jeffreys prior, α = 1 Laplace, α = 1/K Perks. A larger α pulls the estimate towards log ${effectiveK} ` +
      'and can overestimate. The prior is a real assumption, not a neutral default.',
  });

  const recommended = n < 10 * effectiveK ? 'Grassberger' : 'Miller–Madow';
  return {
    base,
    baseLabel: BASE_LABEL[base],
    n,
    observedOutcomes: K,
    singletons,
    doubletons,
    coverage,
    assumedAlphabetSize: alphabetKnown ? (options.alphabetSize as number) : undefined,
    estimates,
    recommended,
    exactness: 'empirical',
    explanation: {
      method: 'Entropy estimation from a finite sample, with bias corrections',
      formula: 'Ĥ_plug-in = −Σ (nᵢ/n) log(nᵢ/n);  Ĥ_MM = Ĥ + (K−1)/(2n);  Ĥ_G = log n − (1/n)Σ nᵢG(nᵢ)',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Distinct outcomes observed', value: String(K) },
        { label: 'Seen exactly once (f₁)', value: String(singletons) },
        { label: 'Good–Turing coverage', value: coverage.toPrecision(6) },
        ...estimates.map((e) => ({ label: e.name, value: Number.isFinite(e.value) ? `${e.value.toPrecision(8)} ${base}` : 'not available' })),
        { label: 'Recommended here', value: recommended },
      ],
      assumptions: ['The observations are independent draws from a fixed discrete distribution.'],
      limitations: [
        'Every value here is an ESTIMATE from a finite sample, not the entropy. The plug-in estimator is biased DOWNWARD and the bias grows with the number of outcomes relative to the sample size.',
        alphabetKnown
          ? `The alphabet size ${options.alphabetSize} was supplied and used in the corrections.`
          : 'The alphabet size was not supplied, so the number of OBSERVED outcomes was used in its place. Since unobserved outcomes are missed, the corrections are themselves too small — the true entropy is probably higher than even the corrected estimates.',
        'No sampling-error interval is attached to the corrections themselves; the corrections remove bias, they do not remove variance.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'empirical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mutual information from data                                       */
/* ------------------------------------------------------------------ */

export interface ContingencyTable {
  counts: number[][];
  rowLabels: (string | number)[];
  colLabels: (string | number)[];
  n: number;
}

/** Build a contingency table from paired categorical observations. */
export function contingency<T extends string | number, U extends string | number>(
  xs: ArrayLike<T>,
  ys: ArrayLike<U>,
): ContingencyTable {
  if (xs.length !== ys.length) {
    throw new EngineError(`Paired data must have equal length; got ${xs.length} and ${ys.length}.`, 'shape');
  }
  if (xs.length === 0) throw new EngineError('Cannot estimate mutual information from an empty sample.', 'empty');
  const xi = new Map<T, number>();
  const yi = new Map<U, number>();
  for (let i = 0; i < xs.length; i++) {
    if (!xi.has(xs[i])) xi.set(xs[i], xi.size);
    if (!yi.has(ys[i])) yi.set(ys[i], yi.size);
  }
  const counts: number[][] = Array.from({ length: xi.size }, () => new Array<number>(yi.size).fill(0));
  for (let i = 0; i < xs.length; i++) {
    counts[xi.get(xs[i]) as number][yi.get(ys[i]) as number] += 1;
  }
  return { counts, rowLabels: [...xi.keys()], colLabels: [...yi.keys()], n: xs.length };
}

/** Plug-in mutual information in nats of a contingency table of counts. */
export function plugInMutualInformationNats(counts: readonly number[][]): number {
  const rows = counts.length;
  const cols = counts[0].length;
  let n = 0;
  const rowSums = new Array<number>(rows).fill(0);
  const colSums = new Array<number>(cols).fill(0);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = counts[i][j];
      n += v;
      rowSums[i] += v;
      colSums[j] += v;
    }
  }
  if (n === 0) throw new EngineError('The contingency table is empty.', 'empty');
  const terms: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const nij = counts[i][j];
      if (nij === 0) continue; // 0·log0 = 0
      terms.push((nij / n) * (Math.log(nij) + Math.log(n) - Math.log(rowSums[i]) - Math.log(colSums[j])));
    }
  }
  return Math.max(0, stableSum(terms));
}

export interface MiEstimateResult {
  base: LogBase;
  baseLabel: string;
  n: number;
  rows: number;
  cols: number;
  /** Plug-in estimate. Biased UPWARD: positive even for independent variables. */
  plugIn: number;
  /** Miller–Madow corrected estimate, composed from the three entropy corrections. */
  millerMadow: number;
  /** The correction applied (negative, because plug-in MI is biased upward). */
  correction: number;
  biasDirection: BiasDirection;
  /** Permutation test of H₀: X and Y are independent. */
  permutation?: PermutationTest;
  exactness: 'empirical';
  explanation: Explanation;
}

export interface PermutationTest {
  /** Observed plug-in MI in the requested unit. */
  observed: number;
  permutations: number;
  /** Mean MI under the independence null — this is NOT zero. */
  nullMean: number;
  nullSd: number;
  /** 95th percentile of the null distribution. */
  null95: number;
  /** (1 + #{I_perm ≥ I_obs}) / (1 + B) — the standard, never-zero p-value. */
  pValue: number;
  /** True when p ≤ alpha. */
  reject: boolean;
  alpha: number;
  seed: string | number;
  note: string;
}

/**
 * Mutual information from paired categorical data, with the Miller–Madow
 * correction and a permutation test.
 *
 * The permutation test is not optional decoration: the plug-in MI of
 * independent variables is strictly positive (its expectation is roughly
 * (r−1)(c−1)/(2n) nats), so "MI > 0" is not evidence of dependence. Only the
 * comparison against the permutation null is.
 */
export function estimateMutualInformation(
  table: readonly number[][],
  options: EstimationOptions & { permutations?: number; seed?: string | number; alpha?: number } = {},
): MiEstimateResult {
  const base = resolveBase(options);
  if (table.length === 0 || table[0].length === 0) throw new EngineError('The contingency table is empty.', 'empty');
  const cols = table[0].length;
  for (let i = 0; i < table.length; i++) {
    if (table[i].length !== cols) throw new EngineError(`Contingency row ${i} has ${table[i].length} entries but row 0 has ${cols}.`, 'shape');
    for (let j = 0; j < cols; j++) {
      const v = table[i][j];
      if (!Number.isInteger(v) || v < 0) throw new EngineError(`Contingency counts must be non-negative whole numbers; counts[${i}][${j}] = ${String(v)}.`, 'integer');
    }
  }
  const rows = table.length;
  let n = 0;
  const rowSums = new Array<number>(rows).fill(0);
  const colSums = new Array<number>(cols).fill(0);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      n += table[i][j];
      rowSums[i] += table[i][j];
      colSums[j] += table[i][j];
    }
  }
  if (n === 0) throw new EngineError('All contingency counts are zero.', 'empty');
  const plugInNats = plugInMutualInformationNats(table);
  // Miller–Madow for I = H(X) + H(Y) − H(X,Y): the three (K−1)/(2n) terms
  // combine to a NEGATIVE net correction, matching the upward bias of MI.
  const kx = rowSums.filter((v) => v > 0).length;
  const ky = colSums.filter((v) => v > 0).length;
  const kxy = table.flat().filter((v) => v > 0).length;
  const correctionNats = (kx - 1) / (2 * n) + (ky - 1) / (2 * n) - (kxy - 1) / (2 * n);
  const mmNats = Math.max(0, plugInNats + correctionNats);

  let permutation: PermutationTest | undefined;
  const B = options.permutations ?? 0;
  if (B > 0) {
    if (!Number.isInteger(B) || B < 1) throw new EngineError(`permutations must be a positive whole number; got ${B}.`, 'integer');
    const alpha = options.alpha ?? 0.05;
    const seed = options.seed ?? 'mi-permutation';
    const rng = new Random(seed);
    // Expand the table back to paired labels so the pairing can be broken.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        for (let k = 0; k < table[i][j]; k++) {
          xs.push(i);
          ys.push(j);
        }
      }
    }
    const shuffled = ys.slice();
    const nulls = new Array<number>(B);
    let atLeast = 0;
    for (let b = 0; b < B; b++) {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const t = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = t;
      }
      const perm: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
      for (let i = 0; i < xs.length; i++) perm[xs[i]][shuffled[i]] += 1;
      const v = plugInMutualInformationNats(perm);
      nulls[b] = v;
      // A strict ">=" with a tiny tolerance: ties must count towards the
      // p-value, otherwise the test is anti-conservative for sparse tables.
      if (v >= plugInNats - 1e-15) atLeast += 1;
    }
    const nullMean = stableSum(nulls) / B;
    const nullVar = B > 1 ? stableSum(nulls.map((v) => (v - nullMean) ** 2)) / (B - 1) : 0;
    const sorted = nulls.slice().sort((a, b2) => a - b2);
    const idx = Math.min(B - 1, Math.max(0, Math.ceil(0.95 * B) - 1));
    const pValue = (1 + atLeast) / (1 + B);
    permutation = {
      observed: fromNats(plugInNats, base),
      permutations: B,
      nullMean: fromNats(nullMean, base),
      nullSd: fromNats(Math.sqrt(nullVar), base),
      null95: fromNats(sorted[idx], base),
      pValue,
      reject: pValue <= alpha,
      alpha,
      seed,
      note:
        `Under independence the plug-in MI averages ${fromNats(nullMean, base).toPrecision(4)} ${base}, not 0 — that is the upward bias, ` +
        'and it is why a positive estimate on its own says nothing. The p-value uses the (1 + count)/(1 + B) form, so it is never 0.',
    };
  }

  return {
    base,
    baseLabel: BASE_LABEL[base],
    n,
    rows,
    cols,
    plugIn: fromNats(plugInNats, base),
    millerMadow: fromNats(mmNats, base),
    correction: fromNats(correctionNats, base),
    biasDirection: 'overestimates',
    permutation,
    exactness: 'empirical',
    explanation: {
      method: 'Mutual information estimated from a contingency table',
      formula: 'Î = Σ (nᵢⱼ/n) log[n·nᵢⱼ / (nᵢ·nⱼ)];  Î_MM = Î + [(Kx−1) + (Ky−1) − (Kxy−1)]/(2n)',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Table size', value: `${rows} × ${cols}` },
        { label: 'Plug-in Î', value: `${fromNats(plugInNats, base).toPrecision(8)} ${base}` },
        { label: 'Miller–Madow Î', value: `${fromNats(mmNats, base).toPrecision(8)} ${base}` },
        ...(permutation ? [{ label: 'Permutation p-value', value: permutation.pValue.toPrecision(4) }] : []),
      ],
      assumptions: ['The pairs are independent draws from a fixed joint distribution.'],
      limitations: [
        'The plug-in estimate is biased UPWARD: it is strictly positive even when X and Y are independent, with expectation roughly (r−1)(c−1)/(2n). A positive value is not evidence of dependence.',
        'Only the permutation test, or a comparable null calibration, can tell a real dependence from the bias. Request permutations if none were run.',
        'The Miller–Madow correction is asymptotic; for sparse tables it can over- or under-correct.',
        'Mutual information measures dependence, never direction or causation.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'empirical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Continuous mutual information                                      */
/* ------------------------------------------------------------------ */

export interface BinnedMiRow {
  bins: number;
  /** Plug-in MI from the binned table. */
  plugIn: number;
  /** Miller–Madow corrected value. */
  millerMadow: number;
}

export interface BinnedMiResult {
  base: LogBase;
  n: number;
  /** One row per bin count tried. The spread across rows IS the uncertainty. */
  rows: BinnedMiRow[];
  /** Rice-rule bin count, offered as a default rather than as the answer. */
  suggestedBins: number;
  /** Plug-in MI at the suggested bin count. */
  atSuggested: number;
  /** Range of the corrected estimates across the bin counts tried. */
  sensitivityRange: { min: number; max: number };
  exactness: 'empirical';
  explanation: Explanation;
}

/**
 * Mutual information between two continuous samples by binning, evaluated at a
 * range of bin counts because the answer genuinely depends on the bin count.
 * Reporting one number from one arbitrary bin choice would hide that.
 */
export function binnedMutualInformation(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  options: BaseOptions & { binCounts?: number[]; strategy?: 'equal-width' | 'equal-frequency' } = {},
): BinnedMiResult {
  const base = resolveBase(options);
  if (xs.length !== ys.length) throw new EngineError(`Paired samples must have equal length; got ${xs.length} and ${ys.length}.`, 'shape');
  const n = xs.length;
  if (n < 4) throw new EngineError(`Binned mutual information needs at least 4 paired observations; got ${n}.`, 'range');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
      throw new EngineError(`Observation ${i} is not finite; remove or impute missing values before estimating.`, 'finite');
    }
  }
  const strategy = options.strategy ?? 'equal-frequency';
  const suggested = Math.max(2, Math.ceil(2 * Math.cbrt(n)));
  const binCounts = options.binCounts ?? [...new Set([2, 3, 4, 5, suggested, suggested * 2].filter((b) => b >= 2 && b <= Math.floor(n / 2)))].sort((a, b) => a - b);
  if (binCounts.length === 0) throw new EngineError(`No usable bin count for n = ${n}; supply binCounts explicitly.`, 'range');

  const assign = (vals: ArrayLike<number>, bins: number): number[] => {
    if (strategy === 'equal-width') {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] < lo) lo = vals[i];
        if (vals[i] > hi) hi = vals[i];
      }
      if (hi === lo) return new Array<number>(vals.length).fill(0);
      const w = (hi - lo) / bins;
      return Array.from({ length: vals.length }, (_, i) => Math.min(bins - 1, Math.floor((vals[i] - lo) / w)));
    }
    const order = Array.from({ length: vals.length }, (_, i) => i).sort((a, b) => vals[a] - vals[b]);
    const out = new Array<number>(vals.length).fill(0);
    for (let r = 0; r < order.length; r++) out[order[r]] = Math.min(bins - 1, Math.floor((r * bins) / order.length));
    return out;
  };

  const rows: BinnedMiRow[] = [];
  for (const bins of binCounts) {
    const bx = assign(xs, bins);
    const by = assign(ys, bins);
    const counts: number[][] = Array.from({ length: bins }, () => new Array<number>(bins).fill(0));
    for (let i = 0; i < n; i++) counts[bx[i]][by[i]] += 1;
    const est = estimateMutualInformation(counts, { base });
    rows.push({ bins, plugIn: est.plugIn, millerMadow: est.millerMadow });
  }
  const corrected = rows.map((r) => r.millerMadow);
  const atSuggestedRow = rows.find((r) => r.bins === suggested) ?? rows[Math.floor(rows.length / 2)];
  return {
    base,
    n,
    rows,
    suggestedBins: suggested,
    atSuggested: atSuggestedRow.plugIn,
    sensitivityRange: { min: Math.min(...corrected), max: Math.max(...corrected) },
    exactness: 'empirical',
    explanation: {
      method: `Mutual information of continuous data by ${strategy} binning`,
      formula: 'Î(X;Y) from the binned contingency table, for several bin counts',
      steps: rows.map((r) => ({ label: `${r.bins} bins per axis`, value: `plug-in ${r.plugIn.toPrecision(5)}, corrected ${r.millerMadow.toPrecision(5)} ${base}` })),
      assumptions: ['The pairs are independent draws from a fixed joint distribution.'],
      limitations: [
        'THE ANSWER DEPENDS ON THE BIN COUNT. The range across the bin counts tried is reported for exactly that reason; no single row is "the" mutual information.',
        'Binning discretises, so the result estimates the MI of the binned variables, which is a lower bound on the MI of the underlying continuous pair (data processing inequality).',
        'More bins increase the upward small-sample bias; fewer bins destroy real structure. The Kozachenko–Leonenko / KSG estimator avoids the choice.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'empirical',
    },
  };
}

/**
 * Kozachenko–Leonenko k-nearest-neighbour differential entropy estimator for a
 * one-dimensional sample:
 *   ĥ = −ψ(k) + ψ(n) + log(c_d) + (d/n)Σ log ε_i,
 * with d = 1, c_d = 2 (the volume of the unit interval [−1,1]) and ε_i the
 * distance to the k-th nearest neighbour.
 */
export function kozachenkoLeonenkoEntropy(
  samples: ArrayLike<number>,
  options: BaseOptions & { k?: number } = {},
): { value: number; base: LogBase; k: number; n: number; exactness: 'empirical'; explanation: Explanation } {
  const base = resolveBase(options);
  const n = samples.length;
  const k = options.k ?? 3;
  if (!Number.isInteger(k) || k < 1) throw new EngineError(`k must be a positive whole number; got ${k}.`, 'integer');
  if (n <= k) throw new EngineError(`The Kozachenko–Leonenko estimator needs more than k = ${k} observations; got ${n}.`, 'range');
  const x = Array.from({ length: n }, (_, i) => {
    if (!Number.isFinite(samples[i])) throw new EngineError(`Observation ${i} is not finite.`, 'finite');
    return samples[i];
  }).sort((a, b) => a - b);
  const logs: number[] = [];
  let ties = 0;
  for (let i = 0; i < n; i++) {
    // In 1-D the k nearest neighbours lie within the sorted window, so a
    // two-pointer scan finds the k-th distance in O(k).
    let lo = i - 1;
    let hi = i + 1;
    let eps = 0;
    for (let c = 0; c < k; c++) {
      const dl = lo >= 0 ? x[i] - x[lo] : Infinity;
      const dr = hi < n ? x[hi] - x[i] : Infinity;
      if (dl <= dr) {
        eps = dl;
        lo -= 1;
      } else {
        eps = dr;
        hi += 1;
      }
    }
    if (!(eps > 0)) {
      ties += 1;
      continue;
    }
    logs.push(Math.log(eps));
  }
  if (logs.length === 0) {
    throw new EngineError(
      'Every k-th nearest-neighbour distance was 0: the sample contains too many exact duplicates for a k-NN differential entropy ' +
        'estimate. The data is effectively discrete — use the discrete entropy estimators instead.',
      'degenerate',
    );
  }
  const nats = -digamma(k) + digamma(n) + Math.LN2 + stableSum(logs) / logs.length;
  const warnings: string[] = [];
  if (ties > 0) warnings.push(`${ties} of ${n} points had a zero k-th neighbour distance (exact duplicates) and were dropped, which biases the estimate upward.`);
  return {
    value: fromNats(nats, base),
    base,
    k,
    n,
    exactness: 'empirical',
    explanation: {
      method: `Kozachenko–Leonenko k-NN differential entropy estimator (k = ${k}, 1-D)`,
      formula: 'ĥ = −ψ(k) + ψ(n) + log 2 + (1/n) Σ log ε_i',
      steps: [
        { label: 'n', value: String(n) },
        { label: 'ĥ', value: `${fromNats(nats, base).toPrecision(8)} ${base}` },
      ],
      assumptions: ['The sample is an independent draw from a continuous distribution with a density.'],
      limitations: [
        'This estimates a DIFFERENTIAL entropy, which can be negative and is not unit-invariant — see the differential-entropy caveats.',
        'The estimator is consistent but biased for small n, and the bias grows with k and with heavy tails.',
        ...warnings,
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'empirical',
    },
  };
}

/**
 * KSG (Kraskov–Stögbauer–Grassberger) algorithm 1 estimator of mutual
 * information between two continuous 1-D samples. Unlike binning it needs no
 * bin count, and it is designed so the bias largely cancels between the joint
 * and marginal terms.
 */
export function ksgMutualInformation(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  options: BaseOptions & { k?: number } = {},
): { value: number; base: LogBase; k: number; n: number; exactness: 'empirical'; explanation: Explanation } {
  const base = resolveBase(options);
  if (xs.length !== ys.length) throw new EngineError(`Paired samples must have equal length; got ${xs.length} and ${ys.length}.`, 'shape');
  const n = xs.length;
  const k = options.k ?? 3;
  if (!Number.isInteger(k) || k < 1) throw new EngineError(`k must be a positive whole number; got ${k}.`, 'integer');
  if (n <= k + 1) throw new EngineError(`The KSG estimator needs more than k + 1 = ${k + 1} paired observations; got ${n}.`, 'range');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) throw new EngineError(`Observation ${i} is not finite.`, 'finite');
  }
  const terms: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Array<number>(n);
    for (let j = 0; j < n; j++) d[j] = Math.max(Math.abs(xs[i] - xs[j]), Math.abs(ys[i] - ys[j]));
    const sorted = d.slice().sort((a, b) => a - b);
    const eps = sorted[k]; // index 0 is the point itself
    let nx = 0;
    let ny = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (Math.abs(xs[i] - xs[j]) < eps) nx += 1;
      if (Math.abs(ys[i] - ys[j]) < eps) ny += 1;
    }
    terms.push(digamma(nx + 1) + digamma(ny + 1));
  }
  const nats = digamma(k) + digamma(n) - stableSum(terms) / n;
  return {
    value: fromNats(nats, base),
    base,
    k,
    n,
    exactness: 'empirical',
    explanation: {
      method: `KSG algorithm 1 mutual-information estimator (k = ${k})`,
      formula: 'Î = ψ(k) + ψ(n) − (1/n) Σ [ψ(nx_i + 1) + ψ(ny_i + 1)]',
      steps: [
        { label: 'n', value: String(n) },
        { label: 'Î', value: `${fromNats(nats, base).toPrecision(8)} ${base}` },
      ],
      assumptions: ['The pairs are independent draws from a joint distribution with a density.'],
      limitations: [
        'The KSG estimate can come out slightly NEGATIVE for independent data even though mutual information cannot be. That is estimator noise and is reported as computed rather than clamped to 0.',
        'Still biased for small n, and sensitive to k: small k means low bias and high variance.',
        'Ties (exact duplicate values) break the method’s assumptions; add a tiny jitter if the data is heavily tied.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'empirical',
    },
  };
}

/** Log of the Dirichlet normalising constant, exported for the Bayesian tests. */
export function logDirichletNorm(alpha: readonly number[]): number {
  let s = 0;
  let g = 0;
  for (const a of alpha) {
    s += a;
    g += logGamma(a);
  }
  return g - logGamma(s);
}
