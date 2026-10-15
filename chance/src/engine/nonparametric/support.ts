/**
 * Validation, tie bookkeeping and the shared "what does a non-significant
 * result mean" machinery used by every test in this module.
 */
import { EngineError } from '../core/result';
import { normal } from '../distributions/continuous';
import { mean, quantile, variance } from '../stats/descriptive';
import {
  RANK_TEST_ARE_NORMAL,
  anovaMinimumDetectableEffect,
  anovaPower,
  chiSquareMinimumDetectableEffect,
  chiSquarePower,
  oneSampleMinimumDetectableEffect,
  oneSampleTPower,
  twoSampleMinimumDetectableEffect,
  twoSampleTPower,
} from './power';
import type { GroupSummary, SensitivityStatement, TieHandling } from './types';

export type Alternative = 'two-sided' | 'greater' | 'less';

export const P_VALUE_LIMITATIONS = [
  'A p-value is the probability of a result at least this extreme if the null hypothesis were true. It is not the probability that the null hypothesis is true.',
  'Statistical significance is not importance. Read the effect size and the interval alongside the p-value.',
];

/** Reject only on strict inequality, so p exactly equal to α does not reject. */
export function rejects(p: number, level: number): boolean {
  return p < level;
}

export interface NamedGroup {
  label: string;
  values: number[];
}

/**
 * Validate and normalise a list of groups. Empty groups, single-observation
 * groups, non-finite values and too few groups each raise a named error rather
 * than being silently dropped or filled in.
 */
export function requireGroups(
  groups: { label?: string; values: ArrayLike<number> }[],
  minGroups: number,
  minPerGroup: number,
  what: string,
): NamedGroup[] {
  if (groups.length < minGroups) {
    throw new EngineError(
      `${what} needs at least ${minGroups} groups; ${groups.length} ${groups.length === 1 ? 'was' : 'were'} supplied.`,
      'insufficient',
    );
  }
  return groups.map((g, i) => {
    const label = g.label ?? `Group ${i + 1}`;
    const values = Array.from(g.values);
    if (values.length === 0) {
      throw new EngineError(`${what}: group "${label}" is empty. Every group needs observations.`, 'empty');
    }
    for (const v of values) {
      if (!Number.isFinite(v)) {
        throw new EngineError(
          `${what}: group "${label}" contains a value that is not a finite number. Remove or impute missing values before testing.`,
          'finite',
        );
      }
    }
    if (values.length < minPerGroup) {
      throw new EngineError(
        `${what}: group "${label}" has ${values.length} observation(s); at least ${minPerGroup} are needed.`,
        'insufficient',
      );
    }
    return { label, values };
  });
}

/** Require at least one group to vary; a completely constant sample has no test statistic. */
export function requireVariation(groups: NamedGroup[], what: string): void {
  const all = groups.flatMap((g) => g.values);
  const first = all[0];
  if (all.every((v) => v === first)) {
    throw new EngineError(
      `${what}: every observation equals ${first}, so there is no variation and no test statistic can be computed.`,
      'undefined',
    );
  }
}

/** Require matched pairs of equal length, returning the complete pairs. */
export function requirePairs(a: ArrayLike<number>, b: ArrayLike<number>, what: string): { a: number[]; b: number[] } {
  if (a.length !== b.length) {
    throw new EngineError(
      `${what} needs matched pairs: received ${a.length} and ${b.length} values. Align the two columns first.`,
      'shape',
    );
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      xs.push(a[i]);
      ys.push(b[i]);
    }
  }
  if (xs.length < 2) {
    throw new EngineError(`${what} needs at least 2 complete pairs; ${xs.length} were usable.`, 'insufficient');
  }
  return { a: xs, b: ys };
}

export interface TieInfo extends TieHandling {
  /** Σ(t³ − t) over tied groups, the quantity every tie correction uses. */
  tieSum: number;
  counts: number[];
}

/** Tie structure of a sample: the group sizes and Σ(t³ − t). */
export function tieInfo(values: ArrayLike<number>, correctionApplied: boolean, context = 'the statistic'): TieInfo {
  const counts = new Map<number, number>();
  for (let i = 0; i < values.length; i++) counts.set(values[i], (counts.get(values[i]) ?? 0) + 1);
  const tied = [...counts.values()].filter((c) => c > 1);
  let tieSum = 0;
  for (const c of tied) tieSum += c ** 3 - c;
  const tiesPresent = tied.length > 0;
  const applied = tiesPresent && correctionApplied;
  return {
    tiesPresent,
    correctionApplied: applied,
    tiedGroups: tied.length,
    tieSum,
    counts: tied,
    detail: !tiesPresent
      ? 'No tied values; no tie correction is needed.'
      : applied
        ? `${tied.length} group(s) of tied values (Σ(t³−t) = ${tieSum}); ${context} has been corrected for ties. Uncorrected formulas give wrong p-values on tied data.`
        : `${tied.length} group(s) of tied values (Σ(t³−t) = ${tieSum}); no correction is applied by this route.`,
  };
}

export const NO_TIES: TieHandling = {
  tiesPresent: false,
  correctionApplied: false,
  tiedGroups: 0,
  detail: 'Ties are not meaningful for this test.',
};

export function summarizeGroups(groups: NamedGroup[], meanRanks?: number[]): GroupSummary[] {
  return groups.map((g, i) => ({
    label: g.label,
    n: g.values.length,
    mean: mean(g.values),
    sd: g.values.length > 1 ? Math.sqrt(variance(g.values)) : NaN,
    median: quantile(g.values, 0.5),
    ...(meanRanks ? { meanRank: meanRanks[i] } : {}),
  }));
}

export function pFromZ(z: number, alt: Alternative): number {
  const params = { mu: 0, sigma: 1 };
  switch (alt) {
    case 'greater':
      return normal.sf(z, params);
    case 'less':
      return normal.cdf(z, params);
    case 'two-sided':
      return Math.min(1, 2 * normal.sf(Math.abs(z), params));
  }
}

export function alternativeText(alt: Alternative, what: string): string {
  switch (alt) {
    case 'two-sided':
      return `${what} differs from the null value`;
    case 'greater':
      return `${what} is greater than the null value`;
    case 'less':
      return `${what} is less than the null value`;
  }
}

/** Design description from which power and the minimum detectable effect follow. */
export type PowerDesign =
  | { kind: 'two-sample'; n1: number; n2: number; rank?: boolean }
  | { kind: 'one-sample'; n: number; rank?: boolean }
  | { kind: 'anova'; groupSizes: number[] }
  | { kind: 'chi-square'; df: number; n: number }
  | { kind: 'none'; reason: string };

const NOT_EVIDENCE =
  'Failing to reject the null hypothesis is not evidence that there is no effect: it means this data does not distinguish the two.';

/**
 * Build the sensitivity statement. A non-significant result always carries the
 * "absence of evidence" sentence plus the smallest effect this sample size
 * could have detected with 80% power; a significant result still reports the
 * same sensitivity figures, because they say how fragile the finding is.
 */
export function sensitivity(pValue: number, level: number, design: PowerDesign, targetPower = 0.8): SensitivityStatement {
  const rejected = rejects(pValue, level);
  let achievedPower: number | null = null;
  let mde: SensitivityStatement['minimumDetectableEffect'] = null;
  try {
    switch (design.kind) {
      case 'two-sample': {
        // Conventional "medium" reference effect, Cohen's d = 0.5.
        achievedPower = twoSampleTPower(0.5, design.n1, design.n2, level, true);
        const d = twoSampleMinimumDetectableEffect(design.n1, design.n2, level, targetPower);
        const inflate = design.rank ? 1 / Math.sqrt(RANK_TEST_ARE_NORMAL) : 1;
        mde = {
          value: d * inflate,
          scale: "standardised mean difference (Cohen's d)",
          power: targetPower,
          note: design.rank
            ? `With n₁ = ${design.n1} and n₂ = ${design.n2}, an effect below about d = ${(d * inflate).toPrecision(3)} would be missed more often than not. The figure is the t-test value inflated by the rank test's asymptotic relative efficiency of 3/π for normal data.`
            : `With n₁ = ${design.n1} and n₂ = ${design.n2}, an effect below about d = ${d.toPrecision(3)} would be missed more often than not.`,
        };
        break;
      }
      case 'one-sample': {
        achievedPower = oneSampleTPower(0.5, design.n, level, true);
        const d = oneSampleMinimumDetectableEffect(design.n, level, targetPower);
        const inflate = design.rank ? 1 / Math.sqrt(RANK_TEST_ARE_NORMAL) : 1;
        mde = {
          value: d * inflate,
          scale: "standardised difference (Cohen's d) on the paired differences",
          power: targetPower,
          note: `With ${design.n} pair(s), an effect below about d = ${(d * inflate).toPrecision(3)} would be missed more often than not.`,
        };
        break;
      }
      case 'anova': {
        achievedPower = anovaPower(0.25, design.groupSizes, level);
        const f = anovaMinimumDetectableEffect(design.groupSizes, level, targetPower);
        mde = {
          value: f,
          scale: "Cohen's f across the group means",
          power: targetPower,
          note: `With group sizes ${design.groupSizes.join(', ')}, a between-group effect below about f = ${f.toPrecision(3)} (η² ≈ ${((f * f) / (1 + f * f)).toPrecision(3)}) would be missed more often than not.`,
        };
        break;
      }
      case 'chi-square': {
        achievedPower = chiSquarePower(0.3, design.df, design.n, level);
        const w = chiSquareMinimumDetectableEffect(design.df, design.n, level, targetPower);
        mde = {
          value: w,
          scale: "Cohen's w",
          power: targetPower,
          note: `With ${design.n} observations and ${design.df} degree(s) of freedom, an association below about w = ${w.toPrecision(3)} would be missed more often than not.`,
        };
        break;
      }
      case 'none':
        break;
    }
  } catch {
    // Power could not be assessed (e.g. the sample is too small for any
    // effect to reach the target). Leave the figures null and say so below;
    // never report a made-up power.
    achievedPower = null;
    mde = null;
  }
  const tail =
    mde !== null
      ? ` ${mde.note}`
      : design.kind === 'none'
        ? ` No standard power calculation applies here: ${design.reason}`
        : ' The sample is too small for any effect size to reach the target power, so no minimum detectable effect can be reported — treat this result as uninformative about the size of the effect.';
  return {
    level,
    rejected,
    statement: rejected
      ? `p = ${pValue.toPrecision(3)} is below the ${level} level, so the null hypothesis is rejected at that level.${tail}`
      : `p = ${pValue.toPrecision(3)} is not below the ${level} level. ${NOT_EVIDENCE}${tail}`,
    achievedPower,
    minimumDetectableEffect: mde,
  };
}

export function interpretMagnitude(x: number, small: number, medium: number, large: number): string {
  const a = Math.abs(x);
  if (a < small) return 'negligible';
  if (a < medium) return 'small';
  if (a < large) return 'moderate';
  return 'large';
}
