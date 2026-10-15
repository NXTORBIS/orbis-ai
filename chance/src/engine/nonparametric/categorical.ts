/**
 * Exact tests and effect measures for contingency tables.
 *
 * Fisher's test is computed from the hypergeometric distribution, summing
 * whole probabilities — no χ² approximation is involved at any size. The
 * two-sided value uses the "sum of all tables no more probable than the
 * observed one" definition; the alternative "twice the smaller tail"
 * definition gives a different number, so both are reported and the one used
 * is named.
 */
import { brentRoot } from '../core/numeric';
import { EngineError } from '../core/result';
import { chiSquare } from '../distributions/continuous';
import { logChoose, logFactorial, normalQuantile } from '../special/gamma';
import { NO_TIES, P_VALUE_LIMITATIONS, type Alternative, alternativeText, pFromZ, sensitivity } from './support';
import type { NonparametricInterval, NonparametricResult } from './types';

/** Largest number of tables enumerated for an r×c exact test. */
export const EXACT_TABLE_BUDGET = 5_000_000;
/** Largest total sample size for Barnard's test. */
export const BARNARD_MAX_N = 300;

function check2x2(table: number[][], what: string): [number, number, number, number] {
  if (table.length !== 2 || table[0].length !== 2 || table[1].length !== 2) {
    throw new EngineError(`${what} needs a 2 × 2 table.`, 'shape');
  }
  const flat = [table[0][0], table[0][1], table[1][0], table[1][1]];
  for (const v of flat) {
    if (!Number.isInteger(v) || v < 0) throw new EngineError(`${what}: counts must be whole numbers of 0 or more.`, 'range');
  }
  if (flat.reduce((a, b) => a + b, 0) === 0) throw new EngineError(`${what}: the table is empty.`, 'empty');
  return flat as [number, number, number, number];
}

/** Hypergeometric probability of the cell count x given the margins. */
function hyperPmf(x: number, r1: number, r2: number, c1: number): number {
  const n = r1 + r2;
  return Math.exp(logChoose(r1, x) + logChoose(r2, c1 - x) - logChoose(n, c1));
}

export interface FisherExactResult extends NonparametricResult {
  oneSidedGreater: number;
  oneSidedLess: number;
  twoSidedByProbability: number;
  twoSidedByDoubling: number;
}

/**
 * Fisher's exact test for a 2 × 2 table, conditioning on both margins.
 *
 * `[[a, b], [c, d]]` with rows as groups and columns as outcomes.
 */
export function fisherExact2x2(
  table: number[][],
  options: { alternative?: Alternative; level?: number; twoSided?: 'probability' | 'doubling' } = {},
): FisherExactResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const twoSidedRule = options.twoSided ?? 'probability';
  const [a, b, c, d] = check2x2(table, "Fisher's exact test");
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const c2 = b + d;
  const n = r1 + r2;
  if (r1 === 0 || r2 === 0 || c1 === 0 || c2 === 0) {
    throw new EngineError(
      "Fisher's exact test conditions on the row and column totals, and this table has an empty row or column, so every possible table is identical to the observed one. There is nothing to test; report the counts instead.",
      'degenerate',
    );
  }
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  const probs: number[] = [];
  for (let x = lo; x <= hi; x++) probs.push(hyperPmf(x, r1, r2, c1));
  const observed = probs[a - lo];
  let greater = 0;
  let less = 0;
  let byProbability = 0;
  for (let x = lo; x <= hi; x++) {
    const p = probs[x - lo];
    if (x >= a) greater += p;
    if (x <= a) less += p;
    // The relative tolerance guards against a genuinely equal probability
    // being excluded by floating-point error.
    if (p <= observed * (1 + 1e-7)) byProbability += p;
  }
  greater = Math.min(1, greater);
  less = Math.min(1, less);
  byProbability = Math.min(1, byProbability);
  const byDoubling = Math.min(1, 2 * Math.min(greater, less));
  const twoSided = twoSidedRule === 'probability' ? byProbability : byDoubling;
  const pValue = alt === 'greater' ? greater : alt === 'less' ? less : twoSided;
  const effects = twoByTwoEffects(table, { level });
  return {
    name: "Fisher's exact test (2 × 2)",
    nullHypothesis: 'The row and column variables are independent — the odds ratio is 1',
    alternativeHypothesis: alternativeText(alt, 'The odds ratio'),
    statistic: a,
    statisticName: 'count in the first cell',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: 'exact',
    pValueRouteReason:
      alt === 'two-sided'
        ? twoSidedRule === 'probability'
          ? `Exact: conditional on the margins, the first cell is hypergeometric over ${hi - lo + 1} possible tables. The two-sided p-value is the total probability of every table no more probable than the observed one (the standard definition). The alternative "twice the smaller tail" definition gives ${byDoubling.toPrecision(6)}; the two definitions genuinely differ and neither is wrong, so the one used is stated.`
          : `Exact: the two-sided p-value is twice the smaller one-sided tail. The "no more probable than observed" definition gives ${byProbability.toPrecision(6)} instead.`
        : `Exact: conditional on the margins, the first cell is hypergeometric over ${hi - lo + 1} possible tables, and the p-value is the sum of the probabilities in the ${alt} tail.`,
    exactness: 'exact',
    effectSizes: effects.effectSizes,
    interval: effects.oddsRatio.exactInterval ?? effects.oddsRatio.waldInterval,
    assumptions: [
      'Each observation falls in exactly one cell and observations are independent.',
      'The test conditions on both margins being fixed. When only one margin is fixed by the design the test is valid but conservative; Barnard’s unconditional test is more powerful there.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'Because the conditional distribution is discrete, the achievable p-values are a finite set and the test is conservative: its true size is below the nominal level.',
      'An association is not causation, and with a 2 × 2 table there is no room to adjust for anything else.',
    ],
    notes: [
      `Table [[${a}, ${b}], [${c}, ${d}]]; margins ${r1}, ${r2} by ${c1}, ${c2}; n = ${n}.`,
      `Hypergeometric support for the first cell: ${lo} to ${hi}. Probability of the observed table: ${observed.toPrecision(6)}.`,
      `One-sided p (greater) ${greater.toPrecision(6)}, one-sided p (less) ${less.toPrecision(6)}, two-sided by probability ${byProbability.toPrecision(6)}, two-sided by doubling ${byDoubling.toPrecision(6)}.`,
    ],
    ties: { ...NO_TIES, detail: 'Ties do not arise in a contingency table.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'chi-square', df: 1, n }),
    groups: [],
    diagnostics: {
      a,
      b,
      c,
      d,
      n,
      observedProbability: observed,
      oneSidedGreater: greater,
      oneSidedLess: less,
      twoSidedByProbability: byProbability,
      twoSidedByDoubling: byDoubling,
      oddsRatio: effects.oddsRatio.value,
      riskRatio: effects.riskRatio.value,
    },
    oneSidedGreater: greater,
    oneSidedLess: less,
    twoSidedByProbability: byProbability,
    twoSidedByDoubling: byDoubling,
  };
}

export interface EffectMeasure {
  value: number;
  waldInterval: NonparametricInterval | null;
  exactInterval?: NonparametricInterval | null;
}

export interface TwoByTwoEffects {
  oddsRatio: EffectMeasure;
  riskRatio: EffectMeasure;
  riskDifference: EffectMeasure;
  /** Number needed to treat: 1/|risk difference|, with its sign explained. */
  numberNeededToTreat: {
    value: number;
    kind: 'benefit' | 'harm';
    interval: { low: number; high: number; level: number; note: string } | null;
    note: string;
  };
  effectSizes: NonparametricResult['effectSizes'];
  notes: string[];
}

/**
 * Odds ratio, risk ratio, risk difference and number needed to treat, with
 * Wald intervals and — for the odds ratio — the exact conditional interval
 * obtained by inverting the non-central hypergeometric test.
 */
export function twoByTwoEffects(table: number[][], options: { level?: number } = {}): TwoByTwoEffects {
  const level = options.level ?? 0.95;
  const [a, b, c, d] = check2x2(table, 'The 2 × 2 effect measures');
  const r1 = a + b;
  const r2 = c + d;
  if (r1 === 0 || r2 === 0) throw new EngineError('Each row (group) must contain at least one observation.', 'empty');
  const z = normalQuantile(0.5 + level / 2);
  const anyZero = a === 0 || b === 0 || c === 0 || d === 0;
  // Haldane–Anscombe correction, used only for the Wald intervals.
  const [aa, bb, cc, dd] = anyZero ? [a + 0.5, b + 0.5, c + 0.5, d + 0.5] : [a, b, c, d];
  const or = (a * d) / (b * c);
  const orAdj = (aa * dd) / (bb * cc);
  const seLogOr = Math.sqrt(1 / aa + 1 / bb + 1 / cc + 1 / dd);
  const risk1 = a / r1;
  const risk2 = c / r2;
  const rr = risk2 === 0 ? Infinity : risk1 / risk2;
  const rrAdj = (aa / (aa + bb)) / (cc / (cc + dd));
  const seLogRr = Math.sqrt(1 / aa - 1 / (aa + bb) + 1 / cc - 1 / (cc + dd));
  const rd = risk1 - risk2;
  const seRd = Math.sqrt((risk1 * (1 - risk1)) / r1 + (risk2 * (1 - risk2)) / r2);
  const c1 = a + c;
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  // Exact conditional interval for the odds ratio: invert the non-central
  // hypergeometric tails.
  const weights: number[] = [];
  for (let x = lo; x <= hi; x++) weights.push(logChoose(r1, x) + logChoose(r2, c1 - x));
  const tail = (psi: number, upper: boolean): number => {
    const logPsi = Math.log(psi);
    let max = -Infinity;
    const terms = weights.map((w, idx) => w + (lo + idx) * logPsi);
    for (const t of terms) if (t > max) max = t;
    let total = 0;
    let part = 0;
    for (let idx = 0; idx < terms.length; idx++) {
      const e = Math.exp(terms[idx] - max);
      total += e;
      const x = lo + idx;
      if (upper ? x >= a : x <= a) part += e;
    }
    return part / total;
  };
  const alpha = 1 - level;
  let exactLow = 0;
  let exactHigh = Infinity;
  if (lo !== hi) {
    if (a > lo) {
      exactLow = Math.exp(brentRoot((lp) => tail(Math.exp(lp), true) - alpha / 2, -40, 40, { tol: 1e-10 }));
    }
    if (a < hi) {
      exactHigh = Math.exp(brentRoot((lp) => tail(Math.exp(lp), false) - alpha / 2, -40, 40, { tol: 1e-10 }));
    }
  }
  const nnt = rd === 0 ? Infinity : 1 / Math.abs(rd);
  const rdLow = rd - z * seRd;
  const rdHigh = rd + z * seRd;
  const nntInterval =
    rdLow * rdHigh > 0
      ? {
          low: 1 / Math.max(Math.abs(rdLow), Math.abs(rdHigh)),
          high: 1 / Math.min(Math.abs(rdLow), Math.abs(rdHigh)),
          level,
          note: 'Both ends of the risk-difference interval have the same sign, so the NNT interval is a single range.',
        }
      : null;
  const notes = [
    `Risk in row 1: ${a}/${r1} = ${(risk1 * 100).toPrecision(4)}%; row 2: ${c}/${r2} = ${(risk2 * 100).toPrecision(4)}%.`,
    ...(anyZero
      ? [
          'A cell contains 0, so the Wald intervals use the Haldane–Anscombe correction (½ added to every cell). The point estimates are reported uncorrected and may be 0 or infinite; the exact conditional interval for the odds ratio needs no correction and is the one to trust here.',
        ]
      : []),
  ];
  const orMeasure: EffectMeasure = {
    value: or,
    waldInterval: {
      low: Math.exp(Math.log(orAdj) - z * seLogOr),
      high: Math.exp(Math.log(orAdj) + z * seLogOr),
      level,
      of: 'the odds ratio',
      method: anyZero ? 'Wald interval on log OR with the Haldane–Anscombe correction' : 'Wald interval on log OR',
      kind: 'estimate',
    },
    exactInterval: {
      low: exactLow,
      high: exactHigh,
      level,
      of: 'the conditional odds ratio',
      method: 'exact conditional interval, by inverting the non-central hypergeometric test (guaranteed coverage, hence wider)',
      kind: 'estimate',
    },
  };
  return {
    oddsRatio: orMeasure,
    riskRatio: {
      value: rr,
      waldInterval: {
        low: Math.exp(Math.log(rrAdj) - z * seLogRr),
        high: Math.exp(Math.log(rrAdj) + z * seLogRr),
        level,
        of: 'the risk ratio (row 1 / row 2)',
        method: anyZero ? 'Wald interval on log RR with the Haldane–Anscombe correction' : 'Wald interval on log RR',
        kind: 'estimate',
      },
    },
    riskDifference: {
      value: rd,
      waldInterval: {
        low: rdLow,
        high: rdHigh,
        level,
        of: 'the difference in risk (row 1 − row 2)',
        method: 'Wald interval on the difference in proportions',
        kind: 'estimate',
      },
    },
    numberNeededToTreat: {
      value: nnt,
      kind: rd < 0 ? 'benefit' : 'harm',
      interval: nntInterval,
      note:
        rd === 0
          ? 'The two risks are identical, so the number needed to treat is infinite: no number of patients would produce one additional outcome.'
          : `${nnt.toPrecision(4)} ${rd < 0 ? 'patients would have to be treated for one fewer outcome (number needed to treat)' : 'patients would have to be treated for one additional outcome (number needed to harm)'}. The NNT is the reciprocal of the risk difference, so it is extremely unstable when the risk difference is near 0, and the interval is unbounded whenever the risk-difference interval spans 0.`,
    },
    effectSizes: [
      {
        name: 'Odds ratio',
        value: or,
        interpretation: Number.isFinite(or)
          ? `The odds of the first-column outcome are ${or.toPrecision(4)} times as high in row 1 as in row 2. 1 means no association. The odds ratio exaggerates the risk ratio when the outcome is common, so do not read it as "times as likely".`
          : 'A zero cell makes the odds ratio infinite; read the exact conditional interval instead.',
        interval: orMeasure.exactInterval,
      },
      {
        name: 'Risk ratio',
        value: rr,
        interpretation: Number.isFinite(rr)
          ? `The outcome is ${rr.toPrecision(4)} times as likely in row 1 as in row 2.`
          : 'Row 2 has no events, so the risk ratio is infinite.',
        interval: {
          low: Math.exp(Math.log(rrAdj) - z * seLogRr),
          high: Math.exp(Math.log(rrAdj) + z * seLogRr),
          level,
          of: 'the risk ratio',
          method: 'Wald interval on log RR',
          kind: 'estimate',
        },
      },
      {
        name: 'Risk difference',
        value: rd,
        interpretation: `${(rd * 100).toPrecision(4)} percentage points. This is the measure that determines how many people are affected; ratios alone cannot say that.`,
        interval: {
          low: rdLow,
          high: rdHigh,
          level,
          of: 'the difference in risk',
          method: 'Wald interval',
          kind: 'estimate',
        },
      },
      {
        name: rd < 0 ? 'Number needed to treat' : 'Number needed to harm',
        value: nnt,
        interpretation:
          rd === 0
            ? 'Infinite: the risks are identical.'
            : `${Math.ceil(nnt)} ${rd < 0 ? '(treating this many prevents one outcome)' : '(treating this many causes one extra outcome)'}${nntInterval ? `, interval ${nntInterval.low.toPrecision(3)} to ${nntInterval.high.toPrecision(3)}` : '; the interval is unbounded because the risk-difference interval includes 0'}.`,
      },
    ],
    notes,
  };
}

/**
 * Fisher–Freeman–Halton exact test for an r × c table, by complete
 * enumeration of the tables with the observed margins. When the number of
 * such tables exceeds the budget the function refuses rather than falling back
 * silently to a χ² approximation.
 */
export function fisherFreemanHalton(
  table: number[][],
  options: { level?: number; budget?: number } = {},
): NonparametricResult {
  const level = options.level ?? 0.95;
  const budget = options.budget ?? EXACT_TABLE_BUDGET;
  const rows = table.length;
  if (rows < 2) throw new EngineError('The Fisher–Freeman–Halton test needs at least 2 rows.', 'shape');
  const cols = table[0].length;
  if (cols < 2) throw new EngineError('The Fisher–Freeman–Halton test needs at least 2 columns.', 'shape');
  for (const row of table) {
    if (row.length !== cols) throw new EngineError('Every row must have the same number of columns.', 'shape');
    for (const v of row) {
      if (!Number.isInteger(v) || v < 0) throw new EngineError('Counts must be whole numbers of 0 or more.', 'range');
    }
  }
  const rowSums = table.map((r) => r.reduce((x, y) => x + y, 0));
  const colSums = Array.from({ length: cols }, (_, j) => table.reduce((acc, r) => acc + r[j], 0));
  const n = rowSums.reduce((x, y) => x + y, 0);
  if (n === 0) throw new EngineError('The table is empty.', 'empty');
  if (rowSums.some((s) => s === 0) || colSums.some((s) => s === 0)) {
    throw new EngineError('Every row and column must contain at least one observation. Remove the empty rows or columns first.', 'empty');
  }
  const logMarginConstant =
    rowSums.reduce((acc, s) => acc + logFactorial(s), 0) +
    colSums.reduce((acc, s) => acc + logFactorial(s), 0) -
    logFactorial(n);
  const logProb = (cells: number[][]): number => {
    let acc = logMarginConstant;
    for (const row of cells) for (const v of row) acc -= logFactorial(v);
    return acc;
  };
  const observedLogP = logProb(table);
  let enumerated = 0;
  let pValue = 0;
  const current: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const remainingCol = [...colSums];
  const recurse = (i: number, logAcc: number): void => {
    if (enumerated > budget) {
      throw new EngineError(
        `The Fisher–Freeman–Halton test enumerates every table with the observed margins, and this ${rows} × ${cols} table with n = ${n} has more than ${budget.toLocaleString('en-US')} of them. The exact test is refused rather than approximated: use a Monte Carlo permutation test on the table, or collapse categories.`,
        'limit',
      );
    }
    if (i === rows - 1) {
      // The last row is determined by the remaining column totals.
      let acc = logAcc;
      for (let j = 0; j < cols; j++) {
        current[i][j] = remainingCol[j];
        acc -= logFactorial(remainingCol[j]);
      }
      enumerated++;
      const lp = logMarginConstant + acc;
      if (lp <= observedLogP + 1e-9) pValue += Math.exp(lp);
      return;
    }
    const fill = (j: number, left: number, accRow: number): void => {
      if (j === cols - 1) {
        if (left > remainingCol[j]) return;
        current[i][j] = left;
        remainingCol[j] -= left;
        recurse(i + 1, accRow - logFactorial(left));
        remainingCol[j] += left;
        return;
      }
      const max = Math.min(left, remainingCol[j]);
      for (let v = 0; v <= max; v++) {
        current[i][j] = v;
        remainingCol[j] -= v;
        fill(j + 1, left - v, accRow - logFactorial(v));
        remainingCol[j] += v;
      }
    };
    fill(0, rowSums[i], logAcc);
  };
  recurse(0, 0);
  pValue = Math.min(1, Math.max(0, pValue));
  // Pearson statistic and Cramér's V, reported as a descriptive effect size.
  let chi = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = (rowSums[i] * colSums[j]) / n;
      chi += (table[i][j] - e) ** 2 / e;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const v = Math.sqrt(chi / (n * Math.min(rows - 1, cols - 1)));
  return {
    name: 'Fisher–Freeman–Halton exact test',
    nullHypothesis: 'The row and column variables are independent',
    alternativeHypothesis: 'The row and column variables are associated',
    statistic: Math.exp(observedLogP),
    statisticName: 'probability of the observed table',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: 'exact',
    pValueRouteReason: `Exact: all ${enumerated.toLocaleString('en-US')} tables with the observed margins were enumerated, and the p-value is the total probability of those no more probable than the observed table.`,
    exactness: 'exact',
    effectSizes: [
      {
        name: "Cramér's V",
        value: v,
        interpretation: `${v < 0.1 ? 'negligible' : v < 0.3 ? 'small' : v < 0.5 ? 'moderate' : 'large'} association (V = ${v.toPrecision(3)}). This is a descriptive measure computed from the Pearson statistic; it does not depend on the exact p-value.`,
      },
    ],
    interval: null,
    assumptions: [
      'Each observation falls in exactly one cell and observations are independent.',
      'Both sets of margins are treated as fixed, as in Fisher’s 2 × 2 test.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The test is an omnibus test of independence: it does not say which cells drive the association. Inspect the standardised residuals for that.',
      'The conditional reference set makes the test conservative; its true size is below the nominal level.',
      `The Pearson χ² here is ${chi.toPrecision(6)} on ${df} degrees of freedom, which would give p = ${chiSquare.sf(chi, { k: df }).toPrecision(6)}; that approximation is unreliable with small expected counts, which is the reason for the exact test.`,
    ],
    notes: [
      `${rows} × ${cols} table, n = ${n}; row totals ${rowSums.join(', ')}, column totals ${colSums.join(', ')}.`,
      `${enumerated.toLocaleString('en-US')} tables with these margins were enumerated.`,
    ],
    ties: { ...NO_TIES, detail: 'Ties do not arise in a contingency table.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'chi-square', df, n }),
    groups: [],
    diagnostics: { enumerated, pearsonChiSquare: chi, df, cramersV: v, n },
  };
}

/**
 * Cochran–Armitage test for a linear trend in proportions across ordered
 * groups. Scores default to 1, 2, …, k; supplying the real exposure levels
 * instead is usually better, because the test is a test of trend *in the
 * scores*.
 */
export function cochranArmitageTrend(
  successes: number[],
  totals: number[],
  options: { scores?: number[]; alternative?: Alternative; level?: number } = {},
): NonparametricResult {
  const alt = options.alternative ?? 'two-sided';
  const level = options.level ?? 0.95;
  const k = successes.length;
  if (k < 3) throw new EngineError('The Cochran–Armitage trend test needs at least 3 ordered groups.', 'insufficient');
  if (totals.length !== k) throw new EngineError('The counts of successes and of trials must have the same length.', 'shape');
  const scores = options.scores ?? Array.from({ length: k }, (_, i) => i + 1);
  if (scores.length !== k) throw new EngineError('The number of scores must match the number of groups.', 'shape');
  for (let i = 0; i < k; i++) {
    if (!Number.isInteger(successes[i]) || !Number.isInteger(totals[i]) || totals[i] < 1 || successes[i] < 0 || successes[i] > totals[i]) {
      throw new EngineError(`Group ${i + 1}: successes must be a whole number between 0 and the number of trials.`, 'range');
    }
    if (!Number.isFinite(scores[i])) throw new EngineError(`Score ${i + 1} is not a finite number.`, 'finite');
  }
  const n = totals.reduce((a, b) => a + b, 0);
  const totalSuccess = successes.reduce((a, b) => a + b, 0);
  const pBar = totalSuccess / n;
  if (pBar === 0 || pBar === 1) {
    throw new EngineError(
      `Every trial has the same outcome (${totalSuccess === 0 ? 'no successes' : 'all successes'}), so the variance of the trend statistic is 0 and no test is possible.`,
      'undefined',
    );
  }
  let t = 0;
  let sNt = 0;
  let sNt2 = 0;
  for (let i = 0; i < k; i++) {
    t += (successes[i] - totals[i] * pBar) * scores[i];
    sNt += totals[i] * scores[i];
    sNt2 += totals[i] * scores[i] * scores[i];
  }
  const varT = pBar * (1 - pBar) * (sNt2 - (sNt * sNt) / n);
  if (!(varT > 0)) {
    throw new EngineError('The scores do not vary across groups, so no trend can be estimated.', 'undefined');
  }
  const z = t / Math.sqrt(varT);
  const pValue = pFromZ(z, alt);
  const chi = z * z;
  // Slope of the weighted least-squares line through the proportions, as an
  // interpretable effect size.
  const meanScore = sNt / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    num += totals[i] * (scores[i] - meanScore) * (successes[i] / totals[i] - pBar);
    den += totals[i] * (scores[i] - meanScore) ** 2;
  }
  const slope = num / den;
  return {
    name: 'Cochran–Armitage test for trend',
    nullHypothesis: 'The success probability is the same in every group (no linear trend in the scores)',
    alternativeHypothesis: alternativeText(alt, 'The linear trend in the success probability'),
    statistic: z,
    statisticName: 'z',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: 'asymptotic',
    pValueRouteReason: `The statistic is referred to the standard normal distribution (equivalently χ² = ${chi.toPrecision(6)} on 1 degree of freedom). The approximation needs the expected counts to be reasonable — roughly 5 successes and 5 failures per group; the observed totals are ${totals.join(', ')} with ${successes.join(', ')} successes.`,
    exactness: 'numerical',
    effectSizes: [
      {
        name: 'Slope of the proportion per unit score',
        value: slope,
        interpretation: `The success probability changes by about ${(slope * 100).toPrecision(3)} percentage points per unit of the score, by weighted least squares.`,
      },
    ],
    interval: null,
    assumptions: [
      'Observations are independent and each group is a set of binary trials.',
      'The groups are ordered and the supplied scores reflect that order on a meaningful scale.',
      'The departure from the null is a monotone trend. The test has little power against a non-monotone pattern, which a χ² test of independence would detect.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      'The answer depends on the scores chosen. Equally spaced scores are a convention, not a fact about the data; if the real exposure levels are unequally spaced, use them.',
      'A significant trend across observational groups does not establish a dose-response relationship in the causal sense.',
    ],
    notes: [
      `k = ${k} ordered groups, n = ${n}, overall proportion ${(pBar * 100).toPrecision(4)}%.`,
      `Scores ${scores.join(', ')}; proportions ${successes.map((s, i) => (s / totals[i]).toPrecision(3)).join(', ')}.`,
    ],
    ties: { ...NO_TIES, detail: 'Ties do not arise in a contingency table.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'chi-square', df: 1, n }),
    groups: [],
    diagnostics: { z, chiSquare: chi, slope, n, pBar, varT },
  };
}

/**
 * Barnard's unconditional exact test for a 2 × 2 table with fixed row totals
 * (two independent binomials). It is more powerful than Fisher's test in that
 * design because it does not condition on the second margin.
 *
 * The nuisance parameter is eliminated by maximising the tail probability over
 * a grid of values of the common success probability, refined around the
 * maximum. The enumeration of tables is exact; the maximisation is numerical,
 * so the result is reported as `numerical`.
 */
export function barnardExactTest(
  table: number[][],
  options: { level?: number; gridSize?: number } = {},
): NonparametricResult {
  const level = options.level ?? 0.95;
  const gridSize = options.gridSize ?? 200;
  const [a, b, c, d] = check2x2(table, "Barnard's exact test");
  const n1 = a + b;
  const n2 = c + d;
  const n = n1 + n2;
  if (n1 === 0 || n2 === 0) throw new EngineError("Barnard's test needs observations in both rows.", 'empty');
  if (n > BARNARD_MAX_N) {
    throw new EngineError(
      `Barnard's test enumerates all ${(n1 + 1) * (n2 + 1)} tables for each of ${gridSize} nuisance values, which is impractical for n = ${n}. The limit is ${BARNARD_MAX_N}; use Fisher's exact test, which is valid (if conservative) at any size.`,
      'limit',
    );
  }
  // Score statistic for the difference in proportions, using the pooled
  // variance. Tables with |z| at least as large as the observed one are extreme.
  const zOf = (x: number, y: number): number => {
    const p1 = x / n1;
    const p2 = y / n2;
    const pooled = (x + y) / n;
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
    if (!(se > 0)) return 0;
    return (p1 - p2) / se;
  };
  const zObs = Math.abs(zOf(a, c));
  if (!(zObs > 0)) {
    throw new EngineError(
      'The two rows have exactly the same proportion, so the observed table is the least extreme possible and every table is at least as extreme. There is no evidence of a difference; report the proportions instead.',
      'degenerate',
    );
  }
  const extreme: [number, number][] = [];
  for (let x = 0; x <= n1; x++) {
    for (let y = 0; y <= n2; y++) {
      if (Math.abs(zOf(x, y)) >= zObs - 1e-12) extreme.push([x, y]);
    }
  }
  const tailAt = (pi: number): number => {
    const logPi = Math.log(pi);
    const log1mPi = Math.log1p(-pi);
    const lp1 = Array.from({ length: n1 + 1 }, (_, x) => logChoose(n1, x) + x * logPi + (n1 - x) * log1mPi);
    const lp2 = Array.from({ length: n2 + 1 }, (_, y) => logChoose(n2, y) + y * logPi + (n2 - y) * log1mPi);
    let sum = 0;
    for (const [x, y] of extreme) sum += Math.exp(lp1[x] + lp2[y]);
    return sum;
  };
  let best = 0;
  let bestPi = 0.5;
  for (let g = 1; g < gridSize; g++) {
    const pi = g / gridSize;
    const value = tailAt(pi);
    if (value > best) {
      best = value;
      bestPi = pi;
    }
  }
  // Refine around the grid maximum.
  const step = 1 / gridSize;
  for (let g = -10; g <= 10; g++) {
    const pi = bestPi + (g * step) / 10;
    if (pi <= 0 || pi >= 1) continue;
    const value = tailAt(pi);
    if (value > best) {
      best = value;
      bestPi = pi;
    }
  }
  const pValue = Math.min(1, best);
  const effects = twoByTwoEffects(table, { level });
  return {
    name: "Barnard's unconditional exact test",
    nullHypothesis: 'The two rows have the same success probability',
    alternativeHypothesis: 'The two success probabilities differ',
    statistic: zObs,
    statisticName: '|z| (pooled score statistic)',
    degreesOfFreedom: null,
    pValue,
    pValueRoute: 'exact',
    pValueRouteReason: `The probability of the ${extreme.length} tables at least as extreme as the observed one is computed exactly from the two binomial distributions, then maximised over the unknown common success probability. The maximum was found at π = ${bestPi.toPrecision(4)} on a grid of ${gridSize} points with local refinement, so the value is exact in its enumeration and numerical in its maximisation.`,
    exactness: 'numerical',
    effectSizes: effects.effectSizes,
    interval: effects.riskDifference.waldInterval,
    assumptions: [
      'The two rows are independent samples with fixed sizes, and each observation is an independent binary trial. This is the design in which Barnard’s test applies; if both margins were fixed by the design, use Fisher’s test.',
    ],
    limitations: [
      ...P_VALUE_LIMITATIONS,
      "Barnard's test is typically more powerful than Fisher's for this design, but it is computationally heavy and is only available here for small tables.",
      'The nuisance maximisation is over a finite grid, so the reported p-value could understate the true supremum by a small amount; the grid is refined around the maximum to keep that below about 1e-4.',
    ],
    notes: [
      `Table [[${a}, ${b}], [${c}, ${d}]]; row totals ${n1} and ${n2}.`,
      `Observed |z| = ${zObs.toPrecision(6)}; ${extreme.length} of ${(n1 + 1) * (n2 + 1)} possible tables are at least as extreme.`,
    ],
    ties: { ...NO_TIES, detail: 'Ties do not arise in a contingency table.' },
    sensitivity: sensitivity(pValue, 1 - level, { kind: 'chi-square', df: 1, n }),
    groups: [],
    diagnostics: { zObserved: zObs, worstCasePi: bestPi, extremeTables: extreme.length, n },
  };
}
