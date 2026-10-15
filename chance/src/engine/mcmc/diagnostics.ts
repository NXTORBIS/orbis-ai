/**
 * Convergence and efficiency diagnostics for MCMC output.
 *
 * None of these quantities can prove that a chain has converged — they can
 * only fail to detect that it has not. That asymmetry is why the verdict is
 * conservative and why a failing diagnostic is reported before any posterior
 * number.
 *
 * References: Gelman & Rubin (1992) for R-hat; Geyer (1992) for the
 * initial-positive-sequence autocorrelation estimator; Vehtari, Gelman,
 * Simpson, Carpenter & Bürkner (2021) for split and rank-normalised R-hat and
 * the R-hat < 1.01 / ESS > 400 thresholds used here.
 */
import { normalQuantile } from '../special/gamma';
import { mean as meanOf, variance } from '../stats/descriptive';
import {
  MCMC_LIMITS,
  type AutocorrelationData,
  type ConvergenceAssessment,
  type ConvergenceVerdict,
  type ParameterDiagnostics,
} from './types';

export const CONVERGENCE_THRESHOLDS = {
  /** Modern standard: R-hat below this for every parameter. */
  rHat: 1.01,
  /** Effective sample size above this for every parameter. */
  ess: 400,
  /** Beyond these the chains are clearly not usable. */
  rHatBad: 1.05,
  essBad: 100,
} as const;

/** Biased autocovariance (divisor n) at lags 0..maxLag of a single chain. */
export function autocovariance(x: ArrayLike<number>, maxLag: number): number[] {
  const n = x.length;
  const m = meanOf(x);
  const lag = Math.max(0, Math.min(maxLag, n - 1));
  const out = new Array<number>(lag + 1).fill(0);
  for (let t = 0; t <= lag; t++) {
    let s = 0;
    for (let i = 0; i + t < n; i++) s += (x[i] - m) * (x[i + t] - m);
    out[t] = s / n;
  }
  return out;
}

/** Autocorrelation function of a single chain, normalised to acf(0) = 1. */
export function autocorrelationFunction(x: ArrayLike<number>, maxLag = MCMC_LIMITS.maxAutocorrelationLag): AutocorrelationData {
  const acov = autocovariance(x, maxLag);
  const v0 = acov[0];
  const lags: number[] = [];
  const values: number[] = [];
  for (let t = 0; t < acov.length; t++) {
    lags.push(t);
    values.push(v0 > 0 ? acov[t] / v0 : t === 0 ? 1 : 0);
  }
  return { lags, values };
}

export interface EssResult {
  readonly ess: number;
  /** Integrated autocorrelation time tau = N / ESS. */
  readonly tau: number;
  /** Combined between/within variance estimate used for the MCSE. */
  readonly varPlus: number;
  /** Lag at which the initial positive sequence was truncated. */
  readonly truncationLag: number;
}

/**
 * Effective sample size across chains using Geyer's initial positive
 * sequence, in the multi-chain form of Vehtari et al. (2021).
 *
 * The autocorrelation estimate combines the within-chain autocovariances with
 * the between-chain variance, so chains that have not found the same region
 * are penalised rather than flattered. The sum of adjacent-lag pairs
 * (Gamma_k = rho_2k + rho_2k+1) is truncated at the first non-positive pair,
 * after enforcing monotonicity, which is what keeps the estimator from
 * accumulating noise at long lags.
 */
export function effectiveSampleSize(chains: readonly ArrayLike<number>[]): EssResult {
  const m = chains.length;
  const n = m > 0 ? chains[0].length : 0;
  if (m === 0 || n < 4) return { ess: NaN, tau: NaN, varPlus: NaN, truncationLag: 0 };

  const maxLag = Math.min(n - 1, 1000);
  const acovs = chains.map((c) => autocovariance(c, maxLag));
  const chainMeans = chains.map((c) => meanOf(c));
  // Within-chain variance with the usual (n-1) divisor.
  const chainVars = acovs.map((a) => (a[0] * n) / (n - 1));
  const W = meanOf(chainVars);
  let varPlus = (W * (n - 1)) / n;
  if (m > 1) varPlus += variance(chainMeans, 1);
  if (!(varPlus > 0)) return { ess: NaN, tau: NaN, varPlus, truncationLag: 0 };

  const nLags = acovs[0].length;
  const rho = new Array<number>(nLags).fill(0);
  for (let t = 0; t < nLags; t++) {
    let acovBar = 0;
    for (let c = 0; c < m; c++) acovBar += acovs[c][t];
    acovBar /= m;
    rho[t] = 1 - (W - acovBar) / varPlus;
  }
  rho[0] = 1;

  // Pair sums, made monotone decreasing, truncated at the first non-positive.
  const pairs: number[] = [];
  for (let k = 0; 2 * k + 1 < nLags; k++) {
    let g = rho[2 * k] + rho[2 * k + 1];
    if (k > 0 && g > pairs[k - 1]) g = pairs[k - 1];
    if (g <= 0) break;
    pairs.push(g);
  }
  let sum = 0;
  for (const g of pairs) sum += g;
  let tau = -1 + 2 * sum;
  if (!(tau > 0)) tau = 1 / Math.log10(Math.max(10, m * n)); // ESS capped below, never zero
  const total = m * n;
  // Stan's cap: an ESS above N·log10(N) is noise in the estimator, not information.
  const ess = Math.min(total / tau, total * Math.log10(total));
  return { ess, tau: total / ess, varPlus, truncationLag: 2 * pairs.length };
}

/** Classic Gelman–Rubin potential scale reduction factor on the chains as given. */
export function gelmanRubin(chains: readonly ArrayLike<number>[]): number {
  const m = chains.length;
  if (m < 2) return NaN;
  const n = chains[0].length;
  if (n < 2) return NaN;
  const means = chains.map((c) => meanOf(c));
  const vars = chains.map((c) => variance(c, 1));
  const W = meanOf(vars);
  const B = variance(means, 1);
  if (!(W > 0)) return B > 0 ? Infinity : NaN;
  const varPlus = ((n - 1) / n) * W + B;
  return Math.sqrt(varPlus / W);
}

/** Split each chain in half; R-hat on the 2m halves also detects within-chain drift. */
export function splitChains(chains: readonly ArrayLike<number>[]): Float64Array[] {
  const out: Float64Array[] = [];
  for (const c of chains) {
    const half = Math.floor(c.length / 2);
    if (half < 2) continue;
    const a = new Float64Array(half);
    const b = new Float64Array(half);
    for (let i = 0; i < half; i++) a[i] = c[i];
    for (let i = 0; i < half; i++) b[i] = c[c.length - half + i];
    out.push(a, b);
  }
  return out;
}

export function splitRHat(chains: readonly ArrayLike<number>[]): number {
  const split = splitChains(chains);
  return split.length >= 2 ? gelmanRubin(split) : NaN;
}

/**
 * Rank-normalise draws pooled across chains, then map to normal scores:
 * z = Phi^-1((r - 3/8) / (N + 1/4)). This makes R-hat usable when the
 * posterior has no finite variance, which the classic statistic silently
 * requires.
 */
export function rankNormalise(chains: readonly ArrayLike<number>[]): Float64Array[] {
  const pooled: { v: number; c: number; i: number }[] = [];
  for (let c = 0; c < chains.length; c++) {
    for (let i = 0; i < chains[c].length; i++) pooled.push({ v: chains[c][i], c, i });
  }
  pooled.sort((a, b) => a.v - b.v);
  const N = pooled.length;
  const out = chains.map((c) => new Float64Array(c.length));
  let k = 0;
  while (k < N) {
    let j = k;
    while (j + 1 < N && pooled[j + 1].v === pooled[k].v) j++;
    // Average rank for ties (ranks are 1-based).
    const avgRank = (k + 1 + j + 1) / 2;
    const z = normalQuantile((avgRank - 3 / 8) / (N + 1 / 4));
    for (let t = k; t <= j; t++) out[pooled[t].c][pooled[t].i] = z;
    k = j + 1;
  }
  return out;
}

/**
 * Rank-normalised split R-hat, taken as the larger of the bulk statistic (on
 * the normal scores) and the tail statistic (on folded, rank-normalised
 * draws, which is sensitive to disagreement in scale rather than location).
 */
export function rankNormalisedSplitRHat(chains: readonly ArrayLike<number>[]): number {
  if (chains.length < 2) return NaN;
  const bulk = splitRHat(rankNormalise(chains));
  const pooled: number[] = [];
  for (const c of chains) for (let i = 0; i < c.length; i++) pooled.push(c[i]);
  const med = median(pooled);
  const folded = chains.map((c) => {
    const f = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) f[i] = Math.abs(c[i] - med);
    return f;
  });
  const tail = splitRHat(rankNormalise(folded));
  const candidates = [bulk, tail].filter((v) => Number.isFinite(v));
  return candidates.length ? Math.max(...candidates) : NaN;
}

function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const n = a.length;
  if (n === 0) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export interface ParameterDiagnosticsInput {
  readonly parameter: string;
  readonly chains: readonly ArrayLike<number>[];
  readonly sd: number;
  readonly elapsedSeconds: number;
}

export function parameterDiagnostics(input: ParameterDiagnosticsInput): ParameterDiagnostics {
  const { chains, parameter, sd, elapsedSeconds } = input;
  const essResult = effectiveSampleSize(chains);
  const rHat = gelmanRubin(chains);
  const split = splitRHat(chains);
  const ranked = rankNormalisedSplitRHat(chains);
  const finiteRHats = [rHat, split, ranked].filter((v) => Number.isFinite(v));
  const worstRHat = finiteRHats.length ? Math.max(...finiteRHats) : NaN;
  const ess = essResult.ess;
  // MCSE of the posterior mean: sd / sqrt(ESS). Not sd / sqrt(N) — correlated
  // draws carry less information than their count suggests.
  const mcseMean = Number.isFinite(ess) && ess > 0 ? sd / Math.sqrt(ess) : NaN;
  const acfChain = chains.length ? chains[0] : [];
  return {
    parameter,
    rHat,
    splitRHat: split,
    rankNormalisedRHat: ranked,
    worstRHat,
    effectiveSampleSize: ess,
    effectiveSampleSizePerSecond: elapsedSeconds > 0 ? ess / elapsedSeconds : NaN,
    integratedAutocorrelationTime: essResult.tau,
    mcseMean,
    autocorrelation: autocorrelationFunction(acfChain),
  };
}

/**
 * One honest verdict for the whole run. "converged" requires every parameter
 * to pass both thresholds; anything worse is stated plainly, and the headline
 * is written so a non-converged run cannot be read as an answer.
 */
export function assessConvergence(
  diagnostics: readonly ParameterDiagnostics[],
  divergences: number,
  chains: number,
): ConvergenceAssessment {
  const reasons: string[] = [];
  let worstRHat = -Infinity;
  let worstRHatParameter = '';
  let lowestEss = Infinity;
  let lowestEssParameter = '';
  for (const d of diagnostics) {
    const r = Number.isFinite(d.worstRHat) ? d.worstRHat : Infinity;
    if (r > worstRHat) {
      worstRHat = r;
      worstRHatParameter = d.parameter;
    }
    const e = Number.isFinite(d.effectiveSampleSize) ? d.effectiveSampleSize : 0;
    if (e < lowestEss) {
      lowestEss = e;
      lowestEssParameter = d.parameter;
    }
  }
  if (!diagnostics.length) {
    worstRHat = NaN;
    lowestEss = NaN;
  }

  let verdict: ConvergenceVerdict = 'converged';
  if (chains < 2) {
    verdict = 'marginal';
    reasons.push(
      'Only one chain was run, so R-hat cannot be computed and between-chain disagreement cannot be detected. Run at least 2 (preferably 4) chains from dispersed starts.',
    );
  }
  if (!Number.isFinite(worstRHat)) {
    if (chains >= 2) {
      verdict = 'not converged';
      reasons.push('R-hat could not be computed, so there is no evidence that the chains agree.');
    }
  } else if (worstRHat >= CONVERGENCE_THRESHOLDS.rHatBad) {
    verdict = 'not converged';
    reasons.push(
      `R-hat for ${worstRHatParameter} is ${worstRHat.toFixed(3)}, far above the ${CONVERGENCE_THRESHOLDS.rHat} threshold: the chains are exploring different regions, so their pooled summary is not a posterior estimate.`,
    );
  } else if (worstRHat >= CONVERGENCE_THRESHOLDS.rHat) {
    if (verdict === 'converged') verdict = 'marginal';
    reasons.push(
      `R-hat for ${worstRHatParameter} is ${worstRHat.toFixed(4)}, above the ${CONVERGENCE_THRESHOLDS.rHat} threshold. Run longer chains before relying on these numbers.`,
    );
  }

  if (!Number.isFinite(lowestEss) || lowestEss < CONVERGENCE_THRESHOLDS.essBad) {
    verdict = 'not converged';
    reasons.push(
      `Effective sample size for ${lowestEssParameter} is ${Number.isFinite(lowestEss) ? Math.round(lowestEss) : 'not computable'}, below ${CONVERGENCE_THRESHOLDS.essBad}. There is too little independent information here to report a posterior mean, let alone a tail quantile.`,
    );
  } else if (lowestEss < CONVERGENCE_THRESHOLDS.ess) {
    if (verdict === 'converged') verdict = 'marginal';
    reasons.push(
      `Effective sample size for ${lowestEssParameter} is ${Math.round(lowestEss)}, below the recommended ${CONVERGENCE_THRESHOLDS.ess} per parameter. The Monte Carlo error on the quantiles is large.`,
    );
  }

  if (divergences > 0) {
    if (verdict === 'converged') verdict = 'marginal';
    reasons.push(
      `${divergences} divergent transition${divergences === 1 ? '' : 's'} occurred. Divergences indicate the integrator failed in part of the posterior, which biases the draws towards the regions it could handle; reduce the step size or reparameterise.`,
    );
  }

  const headline =
    verdict === 'converged'
      ? `Converged: R-hat <= ${worstRHat.toFixed(4)} and effective sample size >= ${Math.round(lowestEss)} for every parameter. The summaries below are sampling estimates with the stated Monte Carlo error.`
      : verdict === 'marginal'
        ? 'Marginal: the chains pass some but not all convergence checks. Treat the summaries below as provisional and run longer chains before quoting them.'
        : 'NOT CONVERGED — the summaries below do not describe the posterior. The chains have not mixed, so their mean, interval and quantiles are artefacts of where the chains happened to be. Do not report them as an answer.';

  return {
    verdict,
    headline,
    reasons,
    worstRHat,
    worstRHatParameter,
    lowestEffectiveSampleSize: lowestEss,
    lowestEffectiveSampleSizeParameter: lowestEssParameter,
    thresholds: { rHat: CONVERGENCE_THRESHOLDS.rHat, ess: CONVERGENCE_THRESHOLDS.ess },
    divergences,
  };
}
