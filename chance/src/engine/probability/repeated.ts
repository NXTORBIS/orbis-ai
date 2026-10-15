/**
 * Repeated-trial probability questions, answered exactly from the relevant
 * distributions rather than by simulation.
 *
 * Independent repeated trials use the binomial / geometric / negative binomial
 * families. Dependent processes (drawing without replacement) use the
 * hypergeometric family. Runs of consecutive successes use an exact
 * dynamic-programming recursion, since no simple closed form exists.
 */
import { formatPercent } from '../core/numeric';
import { incompleteBetaIsExact } from '../special/gamma';
import { EngineError, type Explanation, Validator } from '../core/result';
import { binomial, geometric, hypergeometric, negativeBinomial } from '../distributions/discrete';

export type RepeatedQuestion =
  | 'at-least-one'
  | 'exactly-k'
  | 'at-least-k'
  | 'at-most-k'
  | 'none'
  | 'expected'
  | 'first-success-on-trial'
  | 'trials-until-success'
  | 'failures-before-rth-success'
  | 'run-of-length'
  | 'trials-for-probability';

export interface RepeatedInput {
  question: RepeatedQuestion;
  /** Number of trials (n) — not required by every question. */
  trials?: number;
  /** Success probability per trial. */
  p: number;
  /** Target count (k) where relevant. */
  k?: number;
  /** Required run length where relevant. */
  runLength?: number;
  /** Target probability for 'trials-for-probability'. */
  targetProbability?: number;
  /** Draws without replacement from a finite population. */
  withoutReplacement?: { populationSize: number; successesInPopulation: number };
}

export interface RepeatedResult {
  probability?: number;
  expectedValue?: number;
  /** For 'trials-for-probability': smallest n achieving the target. */
  requiredTrials?: number;
  /** Distribution of the count, for charting. */
  distribution?: { value: number; probability: number; cumulative: number }[];
  explanation: Explanation;
  warnings: string[];
}

const MAX_TRIALS = 5_000_000;
const MAX_RUN_TRIALS = 200_000;

export function analyseRepeated(input: RepeatedInput): RepeatedResult {
  const v = new Validator();
  v.probability(input.p, 'p', 'Success probability');
  const needsTrials: RepeatedQuestion[] = ['at-least-one', 'exactly-k', 'at-least-k', 'at-most-k', 'none', 'expected', 'run-of-length'];
  if (needsTrials.includes(input.question)) {
    v.integer(input.trials ?? NaN, 'trials', 'Number of trials', 1, MAX_TRIALS);
  }
  const needsK: RepeatedQuestion[] = ['exactly-k', 'at-least-k', 'at-most-k', 'first-success-on-trial', 'failures-before-rth-success'];
  if (needsK.includes(input.question)) {
    v.integer(input.k ?? NaN, 'k', input.question === 'first-success-on-trial' ? 'Trial number' : 'Target count', 0);
  }
  if (input.question === 'run-of-length') v.integer(input.runLength ?? NaN, 'runLength', 'Run length', 1);
  if (input.question === 'trials-for-probability') {
    if (!(input.targetProbability !== undefined && input.targetProbability > 0 && input.targetProbability < 1)) {
      v.add('Target probability must be greater than 0 and less than 1.', 'targetProbability', 'range');
    }
  }
  v.throwIfInvalid();

  const warnings: string[] = [];
  const dep = input.withoutReplacement;
  if (dep) {
    v.integer(dep.populationSize, 'populationSize', 'Population size', 1);
    v.integer(dep.successesInPopulation, 'successesInPopulation', 'Successes in population', 0, dep.populationSize);
    v.throwIfInvalid();
    if (input.trials !== undefined && input.trials > dep.populationSize) {
      throw new EngineError(
        `You cannot make ${input.trials} draws without replacement from a population of ${dep.populationSize}.`,
        'range',
      );
    }
  }

  const n = input.trials ?? 0;
  const p = input.p;

  // Dependent case: hypergeometric.
  if (dep && needsTrials.includes(input.question) && input.question !== 'run-of-length') {
    const params = { N: dep.populationSize, K: dep.successesInPopulation, n };
    const dist = buildDistribution((k) => hypergeometric.pdf(k, params), hypergeometric.support(params));
    const mean = (n * dep.successesInPopulation) / dep.populationSize;
    const base = {
      distribution: dist,
      warnings: [
        'Draws are made without replacement, so the trials are dependent: each draw changes what remains. The hypergeometric distribution accounts for this; using the binomial distribution here would understate the variability.',
      ],
    };
    switch (input.question) {
      case 'none':
        return { ...base, probability: hypergeometric.pdf(0, params), explanation: hyperExplanation(params, 'P(X = 0)', hypergeometric.pdf(0, params)) };
      case 'at-least-one': {
        const pr = hypergeometric.sf(0, params);
        return { ...base, probability: pr, explanation: hyperExplanation(params, 'P(X ≥ 1) = 1 − P(X = 0)', pr) };
      }
      case 'exactly-k': {
        const pr = hypergeometric.pdf(input.k!, params);
        return { ...base, probability: pr, explanation: hyperExplanation(params, `P(X = ${input.k})`, pr) };
      }
      case 'at-least-k': {
        const pr = hypergeometric.sf(input.k! - 1, params);
        return { ...base, probability: pr, explanation: hyperExplanation(params, `P(X ≥ ${input.k})`, pr) };
      }
      case 'at-most-k': {
        const pr = hypergeometric.cdf(input.k!, params);
        return { ...base, probability: pr, explanation: hyperExplanation(params, `P(X ≤ ${input.k})`, pr) };
      }
      case 'expected':
        return { ...base, expectedValue: mean, explanation: hyperExplanation(params, 'E[X] = n·K/N', mean) };
    }
  }

  const params = { n, p };
  switch (input.question) {
    case 'none': {
      const pr = binomial.pdf(0, params);
      return {
        probability: pr,
        distribution: binomialDistribution(params),
        warnings,
        explanation: binomialExplanation(params, 'P(X = 0) = (1 − p)ⁿ', pr, [
          { label: 'Calculation', expression: `(1 − ${p})^${n}`, value: pr.toPrecision(8) },
        ]),
      };
    }
    case 'at-least-one': {
      // 1 − (1 − p)^n computed via expm1 for accuracy when p is tiny.
      const pr = -Math.expm1(n * Math.log1p(-p));
      if (p > 0 && pr > 0.999999 && n > 1) {
        warnings.push('The probability is extremely close to 1, but it is not exactly 1: a run of all failures remains possible.');
      }
      return {
        probability: pr,
        distribution: binomialDistribution(params),
        warnings,
        explanation: binomialExplanation(params, 'P(at least one) = 1 − (1 − p)ⁿ', pr, [
          { label: 'Probability all trials fail', expression: `(1 − ${p})^${n}`, value: Math.exp(n * Math.log1p(-p)).toPrecision(8) },
          { label: 'Complement', expression: '1 − that value', value: `${pr.toPrecision(8)} (${formatPercent(pr)})` },
        ]),
      };
    }
    case 'exactly-k': {
      const k = input.k!;
      if (k > n) {
        return {
          probability: 0,
          distribution: binomialDistribution(params),
          warnings: [`You asked for exactly ${k} successes in ${n} trials, which is impossible, so the probability is 0.`],
          explanation: binomialExplanation(params, `P(X = ${k}) = 0 because k exceeds n`, 0, []),
        };
      }
      const pr = binomial.pdf(k, params);
      return {
        probability: pr,
        distribution: binomialDistribution(params),
        warnings,
        explanation: binomialExplanation(params, `P(X = ${k}) = C(n, k) pᵏ (1 − p)ⁿ⁻ᵏ`, pr, [
          { label: 'Number of ways', expression: `C(${n}, ${k})`, value: Math.round(Math.exp(logChooseSafe(n, k))).toLocaleString('en-US') },
          { label: 'Probability of each way', expression: `${p}^${k} × (1 − ${p})^${n - k}`, value: Math.exp(k * Math.log(p) + (n - k) * Math.log1p(-p)).toPrecision(8) },
        ]),
      };
    }
    case 'at-least-k': {
      const k = input.k!;
      const pr = k <= 0 ? 1 : binomial.sf(k - 1, params);
      return {
        probability: pr,
        distribution: binomialDistribution(params),
        warnings,
        explanation: binomialExplanation(params, `P(X ≥ ${k}) = 1 − P(X ≤ ${k - 1})`, pr, [], true),
      };
    }
    case 'at-most-k': {
      const pr = binomial.cdf(input.k!, params);
      return {
        probability: pr,
        distribution: binomialDistribution(params),
        warnings,
        explanation: binomialExplanation(params, `P(X ≤ ${input.k})`, pr, [], true),
      };
    }
    case 'expected': {
      const mean = n * p;
      return {
        expectedValue: mean,
        distribution: binomialDistribution(params),
        warnings: [
          `The expected number of successes is ${mean.toPrecision(6)}. "Expected" means the long-run average over many repetitions of the whole set of ${n} trials; an individual run will usually differ, and a non-whole expected value is never an achievable count.`,
        ],
        explanation: binomialExplanation(params, 'E[X] = n · p', mean, [
          { label: 'Calculation', expression: `${n} × ${p}`, value: mean.toPrecision(8) },
          { label: 'Standard deviation', expression: `√(n·p·(1 − p))`, value: Math.sqrt(n * p * (1 - p)).toPrecision(8) },
        ]),
      };
    }
    case 'first-success-on-trial': {
      const k = input.k!;
      if (k < 1) throw new EngineError('The trial number must be at least 1.', 'range');
      const pr = geometric.pdf(k, { p });
      return {
        probability: pr,
        warnings,
        explanation: {
          method: 'Geometric distribution',
          formula: 'P(first success on trial k) = (1 − p)ᵏ⁻¹ · p',
          steps: [
            { label: `${k - 1} failures then a success`, expression: `(1 − ${p})^${k - 1} × ${p}`, value: `${pr.toPrecision(8)} (${formatPercent(pr)})` },
          ],
          assumptions: ['Trials are independent and the success probability is the same on every trial.'],
          limitations: ['If the process changes over time (learning, fatigue, depletion), the geometric model does not apply.'],
          exactness: 'exact',
        },
      };
    }
    case 'trials-until-success': {
      if (p === 0) {
        throw new EngineError('With a success probability of 0 the first success never occurs, so the expected number of trials is undefined.', 'undefined');
      }
      const mean = 1 / p;
      return {
        expectedValue: mean,
        warnings: [
          `On average ${mean.toPrecision(6)} trials are needed, but the distribution is highly skewed: the most likely single outcome is success on the very first trial, while long waits are possible. The median is ${geometric.quantile(0.5, { p })} trials.`,
        ],
        explanation: {
          method: 'Geometric distribution — expected waiting time',
          formula: 'E[trials until first success] = 1 / p',
          steps: [
            { label: 'Expected number of trials', expression: `1 ÷ ${p}`, value: mean.toPrecision(8) },
            { label: 'Median number of trials', expression: 'smallest k with P(X ≤ k) ≥ 0.5', value: String(geometric.quantile(0.5, { p })) },
            { label: 'Standard deviation', expression: '√(1 − p) / p', value: Math.sqrt(1 - p) / p === Infinity ? '∞' : (Math.sqrt(1 - p) / p).toPrecision(8) },
          ],
          assumptions: ['Trials are independent with a constant success probability (the process is memoryless).'],
          limitations: ['The average is not the typical value here. Use the median and the distribution to judge a realistic wait.'],
          exactness: 'exact',
        },
      };
    }
    case 'failures-before-rth-success': {
      const r = input.k!;
      if (r < 1) throw new EngineError('The target number of successes must be at least 1.', 'range');
      if (p === 0) throw new EngineError('With a success probability of 0 the target is never reached.', 'undefined');
      const mean = (r * (1 - p)) / p;
      const dist = buildDistribution((x) => negativeBinomial.pdf(x, { r, p }), { min: 0, max: Math.min(5000, negativeBinomial.quantile(0.9999, { r, p })) });
      return {
        expectedValue: mean,
        distribution: dist,
        warnings,
        explanation: {
          method: 'Negative binomial distribution',
          formula: 'E[failures before the r-th success] = r(1 − p)/p',
          steps: [
            { label: 'Expected failures', expression: `${r} × (1 − ${p}) ÷ ${p}`, value: mean.toPrecision(8) },
            { label: 'Expected total trials', expression: `${r} + ${mean.toPrecision(6)}`, value: (r + mean).toPrecision(8) },
          ],
          assumptions: ['Trials are independent with a constant success probability.'],
          limitations: ['The distribution is skewed; the mean alone does not describe the realistic range.'],
          exactness: 'exact',
        },
      };
    }
    case 'run-of-length': {
      const r = input.runLength!;
      if (n > MAX_RUN_TRIALS) {
        throw new EngineError(
          `Run calculations are supported up to ${MAX_RUN_TRIALS.toLocaleString('en-US')} trials; reduce the number of trials.`,
          'limit',
        );
      }
      const pr = runProbability(n, p, r);
      return {
        probability: pr,
        warnings: r > n ? [`A run of ${r} cannot occur in only ${n} trials, so the probability is 0.`] : warnings,
        explanation: {
          method: 'Exact recursion over trial outcomes (no closed form exists)',
          formula: 'P(no run of r in n trials) via the recursion f(i, j) = probability of reaching trial i with a current run of j',
          steps: [
            { label: 'Required run length', expression: 'r', value: String(r) },
            { label: 'Trials', expression: 'n', value: String(n) },
            { label: `Probability of at least one run of ${r}`, expression: '1 − P(no such run)', value: `${pr.toPrecision(8)} (${formatPercent(pr)})` },
          ],
          assumptions: ['Trials are independent with a constant success probability.'],
          limitations: [
            'The recursion is exact up to floating-point rounding. Runs are counted as consecutive successes anywhere in the sequence, overlapping runs included.',
          ],
          exactness: 'exact',
        },
      };
    }
    case 'trials-for-probability': {
      const target = input.targetProbability!;
      if (p === 0) throw new EngineError('With a success probability of 0 no number of trials reaches the target.', 'undefined');
      if (p === 1) {
        return {
          requiredTrials: 1,
          warnings: ['With a success probability of 1, a single trial succeeds with certainty.'],
          explanation: {
            method: 'Required number of independent trials',
            formula: 'n = ⌈ln(1 − target) / ln(1 − p)⌉',
            steps: [{ label: 'Required trials', expression: 'p = 1', value: '1' }],
            assumptions: ['Trials are independent with a constant success probability.'],
            limitations: [],
            exactness: 'exact',
          },
        };
      }
      const exactN = Math.log1p(-target) / Math.log1p(-p);
      const required = Math.max(1, Math.ceil(exactN - 1e-12));
      const achieved = -Math.expm1(required * Math.log1p(-p));
      return {
        requiredTrials: required,
        warnings: [
          `With ${required} trials the probability of at least one success is ${formatPercent(achieved)}. No finite number of trials reaches 100%.`,
        ],
        explanation: {
          method: 'Solving 1 − (1 − p)ⁿ ≥ target for n',
          formula: 'n = ⌈ln(1 − target) / ln(1 − p)⌉',
          steps: [
            { label: 'Unrounded solution', expression: `ln(1 − ${target}) ÷ ln(1 − ${p})`, value: exactN.toPrecision(8) },
            { label: 'Rounded up to a whole number of trials', expression: `⌈${exactN.toPrecision(6)}⌉`, value: String(required) },
            { label: 'Probability achieved', expression: `1 − (1 − ${p})^${required}`, value: formatPercent(achieved) },
          ],
          assumptions: ['Trials are independent with a constant success probability.'],
          limitations: ['Reaching a target probability is not a guarantee: even at 99% there remains a 1% chance of no success.'],
          exactness: 'exact',
        },
      };
    }
  }
  throw new EngineError(`Unsupported question type "${input.question}".`, 'unknown');
}

function logChooseSafe(n: number, k: number): number {
  // Local helper to avoid importing the special-function module into the UI path.
  let acc = 0;
  const kk = Math.min(k, n - k);
  for (let i = 1; i <= kk; i++) acc += Math.log(n - kk + i) - Math.log(i);
  return acc;
}

/**
 * Exact probability of at least one run of `r` consecutive successes in `n`
 * independent trials, by forward recursion on the current run length.
 * State: probability of having no completed run of r and a current run of j.
 */
export function runProbability(n: number, p: number, r: number): number {
  if (r > n) return 0;
  if (r <= 0) return 1;
  if (p === 0) return 0;
  if (p === 1) return 1;
  const q = 1 - p;
  // state[j] = P(no run of r yet, current trailing run = j)
  let state = new Float64Array(r);
  state[0] = 1;
  for (let i = 0; i < n; i++) {
    const next = new Float64Array(r);
    for (let j = 0; j < r; j++) {
      const s = state[j];
      if (s === 0) continue;
      next[0] += s * q; // failure resets the run
      if (j + 1 < r) next[j + 1] += s * p; // success extends it
      // j + 1 === r means the run completes: that mass leaves the "no run" states.
    }
    state = next;
  }
  let noRun = 0;
  for (let j = 0; j < r; j++) noRun += state[j];
  return Math.min(1, Math.max(0, 1 - noRun));
}

function binomialDistribution(params: { n: number; p: number }) {
  if (params.n > 2000) return undefined;
  return buildDistribution((k) => binomial.pdf(k, params), { min: 0, max: params.n });
}

function buildDistribution(pmf: (k: number) => number, support: { min: number; max: number }) {
  const out: { value: number; probability: number; cumulative: number }[] = [];
  let cum = 0;
  const hi = Math.min(support.max, support.min + 5000);
  for (let k = support.min; k <= hi; k++) {
    const pr = pmf(k);
    cum += pr;
    out.push({ value: k, probability: pr, cumulative: Math.min(1, cum) });
  }
  return out;
}

/**
 * `cdfDerived` is set by callers whose probability came from `binomial.cdf` or
 * `binomial.sf`, which go through the regularised incomplete beta. At large n
 * that function loses the eighth significant digit — exactly the precision
 * these steps print with `toPrecision(8)` — so such a result is a numerical
 * approximation and must not be labelled exact. A single-term pmf is exact at
 * any n, which is why the distinction is per call site rather than global.
 */
function binomialExplanation(
  params: { n: number; p: number },
  formula: string,
  value: number,
  extraSteps: { label: string; expression?: string; value?: string }[],
  cdfDerived = false,
): Explanation {
  const beta = incompleteBetaIsExact(params.n, params.n);
  const exact = !cdfDerived || beta;
  return {
    method: 'Binomial distribution (independent repeated trials)',
    formula,
    steps: [
      { label: 'Trials', expression: 'n', value: String(params.n) },
      { label: 'Success probability per trial', expression: 'p', value: String(params.p) },
      ...extraSteps,
      { label: 'Result', value: value <= 1 && value >= 0 ? `${value.toPrecision(8)} (${formatPercent(value)})` : value.toPrecision(8) },
    ],
    assumptions: [
      'Each trial is independent of the others.',
      'The success probability is identical on every trial.',
      'There are exactly two outcomes per trial (success or failure).',
    ],
    limitations: [
      'If trials influence one another, or the probability drifts between trials, the binomial model does not apply. Sampling without replacement needs the hypergeometric distribution instead.',
      ...(exact
        ? []
        : [
            `With n = ${params.n.toLocaleString('en-US')} this cumulative probability is computed through the regularised incomplete beta function, which at this scale is accurate to about the eighth significant digit rather than to full double precision. The figure is a close numerical approximation, not an exact value.`,
          ]),
    ],
    exactness: exact ? 'exact' : 'numerical',
  };
}

function hyperExplanation(params: { N: number; K: number; n: number }, formula: string, value: number): Explanation {
  return {
    method: 'Hypergeometric distribution (drawing without replacement)',
    formula,
    steps: [
      { label: 'Population size', expression: 'N', value: String(params.N) },
      { label: 'Successes in the population', expression: 'K', value: String(params.K) },
      { label: 'Draws', expression: 'n', value: String(params.n) },
      { label: 'Result', value: value <= 1 && value >= 0 ? `${value.toPrecision(8)} (${formatPercent(value)})` : value.toPrecision(8) },
    ],
    assumptions: [
      'Objects are drawn without replacement, so each draw changes the composition of what remains.',
      'Every object remaining is equally likely to be drawn next.',
    ],
    limitations: ['The binomial distribution would give a different (and here incorrect) answer, because it assumes the probability stays constant.'],
    exactness: 'exact',
  };
}
