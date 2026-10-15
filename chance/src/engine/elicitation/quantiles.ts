/**
 * Fitting a parametric distribution to elicited quantiles.
 *
 * THE METHOD
 * ----------
 * The judge states a handful of quantiles — typically a median and a credible
 * interval, sometimes a tercile split, sometimes an arbitrary set. For a
 * candidate family with parameters θ the fit minimises
 *
 *     SSE(θ) = Σ_j ( F⁻¹(p_j; θ) − x_j )²
 *
 * i.e. least squares on the QUANTILE scale, in the units the judge actually
 * spoke in. Residuals are therefore interpretable: a residual of 3 means the
 * fitted distribution puts that quantile 3 units away from where the judge put
 * it. Least squares on the quantile scale (rather than on probabilities) is the
 * standard choice for elicitation precisely because the judge's statements are
 * about values, and it is the scale on which they can check the fit.
 *
 * THE POINT THE USER MUST SEE
 * ---------------------------
 * Three stated quantiles cannot distinguish between families. Several
 * two-parameter families will reproduce them to within rounding, and those
 * same families then disagree violently about the tails — which is usually what
 * the number is wanted for. The family choice is normally a LARGER source of
 * variation than the judge's own imprecision, so `familySensitivity` reports
 * the spread of tail probabilities across every family that fitted about as
 * well as the winner. A single "best fit" reported without that spread is a
 * fabricated precision.
 */
import { EngineError, type Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random } from '../random/rng';
import { DISTRIBUTIONS, defaultParams, getDistribution, validateParams } from '../distributions/registry';
import type { DistributionDef, Params } from '../distributions/types';
import { makeTransform, nelderMead, paramBound, type Bound } from '../fitting/optimize';
import {
  judgementBasis,
  JUDGEMENT_EXACTNESS,
  type ElicitedQuantile,
  type JudgementBasis,
  type JudgementExactness,
  validateElicitedQuantiles,
} from './types';

/**
 * Families excluded from the automatic scan, with the reason. Excluding them
 * silently would be a hidden modelling choice, so they are named.
 */
export const EXCLUDED_FAMILIES: Readonly<Record<string, string>> = {
  vonMises: 'Circular support of fixed width 2π; it answers a question about angles, not about a real-valued quantity.',
};

export interface QuantileResidual {
  level: number;
  /** What the judge said. */
  stated: number;
  /** What the fitted distribution says. */
  fitted: number;
  /** fitted − stated, in the judge's own units. */
  residual: number;
}

export interface QuantileFit {
  distributionId: string;
  distributionName: string;
  params: Params;
  residuals: QuantileResidual[];
  /** Σ residual². */
  sse: number;
  /** √(SSE/m), in the judge's units. */
  rmse: number;
  /** rmse divided by the stated inter-quantile span — a unit-free fit quality. */
  relativeRmse: number;
  converged: boolean;
  /** Number of free parameters, which is also how many stated quantiles it consumes. */
  parameterCount: number;
}

export interface FamilyProbe {
  /** Where the tail probability is compared. */
  x: number;
  label: string;
  /** Exceedance probability P(X > x) under each near-tied family. */
  byFamily: { distributionId: string; exceedance: number }[];
  lowest: number;
  highest: number;
  /** highest − lowest. */
  spread: number;
  /** highest / lowest, or Infinity when some family gives exactly 0. */
  ratio: number;
}

export interface FamilySensitivity {
  /** Families whose fit is statistically indistinguishable from the winner's. */
  nearTiedFamilies: string[];
  /** A family counts as near-tied when its rmse is within this factor of the best. */
  tieFactor: number;
  probes: FamyProbeList;
  /** Largest absolute spread of exceedance probability over the probes. */
  maxSpread: number;
  /** Largest ratio of exceedance probabilities over the probes. */
  maxRatio: number;
  /** True when the family choice moves a tail probability by more than `materialThreshold`. */
  material: boolean;
  materialThreshold: number;
  note: string;
}

/** Alias kept readable in the interface above. */
type FamyProbeList = FamilyProbe[];

export interface QuantileFitOptions {
  /** Restrict the scan to these registry ids. Default: every compatible continuous family. */
  families?: readonly string[];
  /** rmse within this factor of the lowest counts as a tie. Default 1.5. */
  tieFactor?: number;
  /**
   * How precisely the judge meant the stated values, in their own units. Any
   * family fitting within this is reproducing the judgements as well as the
   * judge stated them. Default: 2% of the stated span, because nobody states a
   * quantile to better than that.
   */
  elicitationTolerance?: number;
  /** A tail-probability spread above this is reported as material. Default 0.05. */
  materialThreshold?: number;
  /** Random probes per deterministic seed during the coarse search. Default 24. */
  probesPerSeed?: number;
  /** Nelder–Mead iteration cap per start. Default 600. */
  maxIterations?: number;
}

export interface QuantileFitResult {
  stated: ElicitedQuantile[];
  /**
   * The reported answer: the FEWEST-PARAMETER family that reproduces the
   * judgements to within `elicitationTolerance`, breaking remaining ties by
   * rmse. Lowest SSE alone is the wrong rule here — a family with as many
   * parameters as there are stated quantiles reproduces them exactly by
   * construction, with zero residual and zero evidence.
   */
  best: QuantileFit;
  /** The lowest-residual fit, which may be a saturated family. Reported for comparison. */
  lowestResidual: QuantileFit;
  /** The residual band inside which families are treated as indistinguishable. */
  tieBand: number;
  /** Every family that was fitted, ascending by SSE. */
  fits: QuantileFit[];
  /** Families that were not fitted, each with the reason. */
  rejected: { distributionId: string; reason: string }[];
  familySensitivity: FamilySensitivity;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Support compatibility                                              */
/* ------------------------------------------------------------------ */

interface SupportProfile {
  /** A support bound that no parameter choice can move. */
  fixedMin: number | null;
  fixedMax: number | null;
}

const PROFILE_CACHE = new Map<string, SupportProfile>();

/**
 * Which support bounds of a family are FIXED (the same for every parameter
 * value) rather than set by a parameter. A judge who states a negative value
 * cannot be described by a family whose support is fixed at [0, ∞), and that
 * is detected here instead of being discovered as a hopeless fit.
 */
function supportProfile(def: DistributionDef): SupportProfile {
  const cached = PROFILE_CACHE.get(def.id);
  if (cached) return cached;
  const base = defaultParams(def);
  const s0 = def.support(base);
  let fixedMin: number | null = Number.isFinite(s0.min) ? s0.min : null;
  let fixedMax: number | null = Number.isFinite(s0.max) ? s0.max : null;
  for (const spec of def.params) {
    for (const factor of [0.37, 2.9]) {
      const trial: Params = { ...base };
      const lo = spec.min ?? -Infinity;
      const hi = spec.max ?? Infinity;
      let v = base[spec.key] * factor + (base[spec.key] === 0 ? factor : 0);
      if (spec.integer) v = Math.round(v);
      if (!(v > lo || (!spec.minExclusive && v >= lo)) || v > hi) continue;
      trial[spec.key] = v;
      if (validateParams(def, trial).length) continue;
      const s = def.support(trial);
      if (fixedMin !== null && s.min !== fixedMin) fixedMin = null;
      if (fixedMax !== null && s.max !== fixedMax) fixedMax = null;
    }
  }
  const profile = { fixedMin, fixedMax };
  PROFILE_CACHE.set(def.id, profile);
  return profile;
}

/* ------------------------------------------------------------------ */
/* Starting points                                                    */
/* ------------------------------------------------------------------ */

/**
 * Deterministic data-informed seeds. A parameter bounded below at 0 and
 * unbounded above behaves like a scale, so it is seeded with the stated spread
 * and location magnitude; a two-sided-unbounded parameter behaves like a
 * location and is seeded with the stated median. Without this the simplex
 * starts at the registry defaults (order 1) and never reaches a quantity
 * measured in thousands.
 */
function seedStarts(def: DistributionDef, qs: readonly ElicitedQuantile[]): number[][] {
  const values = qs.map((q) => q.value);
  const loc = values[Math.floor(values.length / 2)];
  const span = values[values.length - 1] - values[0];
  const scale = span > 0 ? span / 2 : Math.max(1e-9, Math.abs(loc));
  const candidates: number[][] = def.params.map((spec) => {
    const lo = spec.min ?? -Infinity;
    const hi = spec.max ?? Infinity;
    const wide = 1e9;
    const unboundedBelow = lo <= -wide;
    const unboundedAbove = hi >= wide;
    const raw: number[] = [spec.defaultValue];
    if (!unboundedBelow && unboundedAbove) raw.push(scale, Math.max(Math.abs(loc), 1e-9), 1 / Math.max(scale, 1e-9));
    else if (unboundedBelow && unboundedAbove) raw.push(loc, loc - scale, loc + scale);
    else raw.push((lo + hi) / 2);
    const clampToBounds = (x: number): number => {
      const eps = Math.max(1e-9, Math.abs(x) * 1e-9);
      let v = x;
      if (Number.isFinite(lo)) v = Math.max(v, spec.minExclusive ? lo + eps : lo);
      if (Number.isFinite(hi)) v = Math.min(v, spec.maxExclusive ? hi - eps : hi);
      return spec.integer ? Math.max(1, Math.round(v)) : v;
    };
    const seen = new Set<number>();
    const out: number[] = [];
    for (const r of raw) {
      if (!Number.isFinite(r)) continue;
      const v = clampToBounds(r);
      if (!Number.isFinite(v) || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out.length ? out : [spec.defaultValue];
  });
  const depth = Math.max(...candidates.map((c) => c.length));
  const starts: number[][] = [];
  for (let k = 0; k < depth; k++) {
    starts.push(candidates.map((c) => c[Math.min(k, c.length - 1)]));
  }
  return starts;
}

/* ------------------------------------------------------------------ */
/* Fitting one family                                                 */
/* ------------------------------------------------------------------ */

function residualsFor(def: DistributionDef, params: Params, qs: readonly ElicitedQuantile[]): QuantileResidual[] {
  return qs.map((q) => {
    const fitted = def.quantile(q.level, params);
    return { level: q.level, stated: q.value, fitted, residual: fitted - q.value };
  });
}

function makeFit(def: DistributionDef, params: Params, qs: readonly ElicitedQuantile[], converged: boolean): QuantileFit {
  const residuals = residualsFor(def, params, qs);
  const sse = stableSum(residuals.map((r) => r.residual ** 2));
  const rmse = Math.sqrt(sse / residuals.length);
  const values = qs.map((q) => q.value);
  const span = values[values.length - 1] - values[0];
  return {
    distributionId: def.id,
    distributionName: def.name,
    params,
    residuals,
    sse,
    rmse,
    relativeRmse: span > 0 ? rmse / span : NaN,
    converged,
    parameterCount: def.params.length,
  };
}

/**
 * Least-squares quantile fit of ONE named family.
 *
 * Refuses a family with more parameters than the judge gave quantiles: the
 * system is underdetermined and any "fit" would be one of infinitely many
 * exact solutions chosen by the optimiser's accidents.
 */
export function fitQuantilesToFamily(
  distributionId: string,
  quantiles: readonly ElicitedQuantile[],
  options: QuantileFitOptions = {},
): QuantileFit {
  const qs = validateElicitedQuantiles(quantiles);
  const def = getDistribution(distributionId);
  if (def.params.length > qs.length) {
    throw new EngineError(
      `The ${def.name} family has ${def.params.length} parameters but only ${qs.length} quantile` +
        `${qs.length === 1 ? ' was' : 's were'} elicited. The fit is underdetermined: infinitely many parameter ` +
        `sets reproduce the stated quantiles exactly, and no single one of them is the answer. Elicit at least ` +
        `${def.params.length} quantiles, or choose a family with fewer parameters.`,
      'underdetermined',
    );
  }
  const profile = supportProfile(def);
  const fixedMin = profile.fixedMin;
  if (fixedMin !== null) {
    const bad = qs.find((q) => q.value < fixedMin);
    if (bad) {
      throw new EngineError(
        `The ${def.name} family has support fixed at or above ${fixedMin}, but the judge stated the ` +
          `value ${bad.value} at level ${bad.level}. The family cannot represent it.`,
        'support',
      );
    }
  }
  const fixedMax = profile.fixedMax;
  if (fixedMax !== null) {
    const bad = qs.find((q) => q.value > fixedMax);
    if (bad) {
      throw new EngineError(
        `The ${def.name} family has support fixed at or below ${fixedMax}, but the judge stated the ` +
          `value ${bad.value} at level ${bad.level}. The family cannot represent it.`,
        'support',
      );
    }
  }

  const bounds: Bound[] = def.params.map(paramBound);
  const objective = (natural: number[]): number => {
    const params: Params = {};
    def.params.forEach((spec, i) => {
      params[spec.key] = spec.integer ? Math.round(natural[i]) : natural[i];
    });
    if (validateParams(def, params).length) return Infinity;
    let s = 0;
    for (const q of qs) {
      const f = def.quantile(q.level, params);
      if (!Number.isFinite(f)) return Infinity;
      s += (f - q.value) ** 2;
    }
    return s;
  };

  // Coarse search: deterministic data-informed seeds plus random probes around
  // each, in the bounded-to-unbounded transformed space so no probe is invalid.
  const transforms = bounds.map(makeTransform);
  const starts = seedStarts(def, qs);
  const probes = options.probesPerSeed ?? 24;
  const rng = new Random(`elicitation-quantile-fit:${def.id}`);
  const scored: { x: number[]; v: number }[] = [];
  for (const s of starts) {
    scored.push({ x: s, v: objective(s) });
    const free = s.map((v, i) => transforms[i].toFree(v));
    for (let t = 0; t < probes; t++) {
      const trial = free.map((v) => v + rng.normal() * 3);
      const nat = trial.map((v, i) => transforms[i].toNatural(v));
      if (nat.some((v) => !Number.isFinite(v))) continue;
      scored.push({ x: nat, v: objective(nat) });
    }
  }
  scored.sort((a, b) => a.v - b.v);
  const usable = scored.filter((c) => Number.isFinite(c.v));
  if (usable.length === 0) {
    throw new EngineError(
      `No parameter values of the ${def.name} family produced a finite quantile function for the stated ` +
        'levels, so no fit exists. This family is not applicable to these judgements.',
      'infeasible',
    );
  }
  let best: { params: Params; value: number; converged: boolean } | null = null;
  for (const start of usable.slice(0, 3)) {
    const out = nelderMead(objective, start.x, bounds, {
      maxIterations: options.maxIterations ?? 600,
      tol: 1e-12,
    });
    const params: Params = {};
    def.params.forEach((spec, i) => {
      params[spec.key] = spec.integer ? Math.round(out.x[i]) : out.x[i];
    });
    const value = objective(out.x);
    if (!Number.isFinite(value)) continue;
    if (best === null || value < best.value) best = { params, value, converged: out.converged };
  }
  if (best === null) {
    throw new EngineError(
      `The least-squares search for the ${def.name} family ended at a non-finite objective; no parameters ` +
        'are reported rather than reporting an arbitrary point.',
      'numerical',
    );
  }
  return makeFit(def, best.params, qs, best.converged);
}

/* ------------------------------------------------------------------ */
/* Scanning every compatible family                                   */
/* ------------------------------------------------------------------ */

function candidateFamilies(options: QuantileFitOptions): DistributionDef[] {
  if (options.families) return options.families.map((id) => getDistribution(id));
  return DISTRIBUTIONS.filter((d) => d.kind === 'continuous' && !(d.id in EXCLUDED_FAMILIES));
}

/**
 * Fit every compatible family to the elicited quantiles and report the spread
 * of the answers they imply.
 *
 * The winner is reported, but so is every near-tie and the tail probabilities
 * they disagree about. Reading only `best` is reading the module wrong.
 */
export function fitElicitedQuantiles(
  quantiles: readonly ElicitedQuantile[],
  options: QuantileFitOptions = {},
): QuantileFitResult {
  const qs = validateElicitedQuantiles(quantiles);
  const families = candidateFamilies(options);
  if (families.length === 0) {
    throw new EngineError('No candidate families were supplied, so nothing can be fitted.', 'empty');
  }
  const fits: QuantileFit[] = [];
  const rejected: { distributionId: string; reason: string }[] = [];
  for (const def of families) {
    try {
      fits.push(fitQuantilesToFamily(def.id, qs, options));
    } catch (e) {
      if (e instanceof EngineError) rejected.push({ distributionId: def.id, reason: e.message });
      else throw e;
    }
  }
  if (fits.length === 0) {
    throw new EngineError(
      [
        {
          code: 'no-family',
          message:
            `None of the ${families.length} candidate families could be fitted to these ${qs.length} elicited ` +
            `quantiles. The reasons were: ` +
            rejected.map((r) => `${r.distributionId}: ${r.reason}`).join(' | '),
        },
      ],
    );
  }
  fits.sort((a, b) => a.rmse - b.rmse || a.parameterCount - b.parameterCount);
  const lowestResidual = fits[0];

  const tieFactor = options.tieFactor ?? 1.5;
  if (!(tieFactor >= 1)) throw new EngineError(`tieFactor must be at least 1; got ${tieFactor}.`, 'range');
  const materialThreshold = options.materialThreshold ?? 0.05;
  const values = qs.map((q) => q.value);
  const lo = values[0];
  const hi = values[values.length - 1];
  const span = hi - lo;
  const tolerance = options.elicitationTolerance ?? Math.max(span * 0.02, 1e-12);
  if (!(tolerance > 0)) {
    throw new EngineError(`elicitationTolerance must be greater than 0; got ${tolerance}.`, 'range');
  }
  // The tie band is anchored to the judge's own precision, NOT to the lowest
  // rmse. A family with as many parameters as stated quantiles fits exactly, so
  // anchoring to the minimum would declare every genuinely-competing family a
  // loser on a residual the judge could never have meant.
  const tieBand = Math.max(lowestResidual.rmse * tieFactor, tolerance);
  const nearTied = fits.filter((f) => f.rmse <= tieBand);
  // Parsimony among the indistinguishable: the simplest description that
  // reproduces what was said.
  const best = [...nearTied].sort((a, b) => a.parameterCount - b.parameterCount || a.rmse - b.rmse)[0];

  const probeSpec: { x: number; label: string }[] = [
    { x: lo - span, label: `one stated span below the lowest stated value (${(lo - span).toPrecision(6)})` },
    { x: lo, label: `the lowest stated value (${lo.toPrecision(6)})` },
    { x: hi, label: `the highest stated value (${hi.toPrecision(6)})` },
    { x: hi + span, label: `one stated span above the highest stated value (${(hi + span).toPrecision(6)})` },
    {
      x: hi + 4 * span,
      label: `far upper tail, four stated spans above the highest stated value (${(hi + 4 * span).toPrecision(6)}) — the judge said nothing whatsoever about this region and the family is answering alone`,
    },
  ];
  const probes: FamilyProbe[] = probeSpec.map((spec) => {
    const byFamily = nearTied.map((f) => ({
      distributionId: f.distributionId,
      exceedance: getDistribution(f.distributionId).sf(spec.x, f.params),
    }));
    const es = byFamily.map((b) => b.exceedance).filter((v) => Number.isFinite(v));
    const lowest = es.length ? Math.min(...es) : NaN;
    const highest = es.length ? Math.max(...es) : NaN;
    return {
      x: spec.x,
      label: spec.label,
      byFamily,
      lowest,
      highest,
      spread: highest - lowest,
      ratio: lowest > 0 ? highest / lowest : highest > 0 ? Infinity : 1,
    };
  });
  const spreads = probes.map((p) => p.spread).filter((v) => Number.isFinite(v));
  const maxSpread = spreads.length ? Math.max(...spreads) : NaN;
  const ratios = probes.map((p) => p.ratio).filter((v) => Number.isFinite(v));
  const maxRatio = ratios.length ? Math.max(...ratios) : Infinity;
  const material = Number.isFinite(maxSpread) && maxSpread > materialThreshold;

  const familySensitivity: FamilySensitivity = {
    nearTiedFamilies: nearTied.map((f) => f.distributionId),
    tieFactor,
    probes,
    maxSpread,
    maxRatio,
    material,
    materialThreshold,
    note:
      nearTied.length === 1
        ? `Only ${best.distributionName} fitted within a factor of ${tieFactor} of the best rmse, so the family ` +
          'choice is pinned down by these judgements. That is unusual and normally means many quantiles were stated.'
        : `${nearTied.length} families fit these judgements about equally well (${nearTied
            .map((f) => f.distributionName)
            .join(', ')}), and they disagree by up to ${Number.isFinite(maxSpread) ? maxSpread.toPrecision(3) : 'an unbounded amount'} ` +
          `in exceedance probability (a factor of ${Number.isFinite(maxRatio) ? maxRatio.toPrecision(3) : '∞'}). ` +
          (material
            ? 'THE FAMILY CHOICE IS THE DOMINANT UNCERTAINTY HERE, larger than anything the judge said. Report the range, not the winner.'
            : 'The families happen to agree closely over the probed range, which does not extend to the far tails.'),
  };

  const warnings: string[] = [];
  if (best.rmse > 0 && span > 0 && best.rmse / span > 0.02) {
    warnings.push(
      `The best fit still misses the stated quantiles by an rmse of ${best.rmse.toPrecision(4)}, which is ` +
        `${((best.rmse / span) * 100).toPrecision(3)}% of the stated span. No candidate family reproduces these ` +
        'judgements well; the judge may be describing a shape (bimodal, bounded, heavy-tailed) that none of them has.',
    );
  }
  if (!best.converged) {
    warnings.push(
      `The optimiser did not formally converge for ${best.distributionName}; the residuals below are the ` +
        'evidence of fit quality and should be checked directly.',
    );
  }
  if (material) warnings.push(familySensitivity.note);

  return {
    stated: qs,
    best,
    lowestResidual,
    tieBand,
    fits,
    rejected,
    familySensitivity,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      `Least-squares fit on the quantile scale across ${fits.length} parametric families`,
      `${qs.length} quantiles stated by a judge: ${qs.map((q) => `P(X ≤ ${q.value}) = ${q.level}`).join(', ')}`,
      [
        'The fitted parameters are only as good as the stated quantiles, which are an opinion.',
        'The family choice is a modelling decision the judge did not make. See familySensitivity before using any tail probability.',
        'Least squares on the quantile scale weights every stated quantile equally, which assumes the judge was equally confident about each. If they were not, state fewer quantiles rather than weighting them.',
        'A family with as many parameters as there are stated quantiles fits them exactly and tells you nothing. The reported family is the simplest one inside the tie band, not the one with the smallest residual.',
      ],
    ),
    explanation: {
      method: 'Distribution fitted to elicited quantiles by least squares on the quantile scale',
      formula: 'θ̂ = argmin_θ Σ_j (F⁻¹(p_j; θ) − x_j)²',
      steps: [
        { label: 'Stated quantiles', value: qs.map((q) => `${q.level} → ${q.value}`).join('; ') },
        { label: 'Families fitted', value: `${fits.length} of ${families.length} (${rejected.length} rejected)` },
        { label: 'Reported family (fewest parameters within tolerance)', value: `${best.distributionName} (${best.distributionId}, ${best.parameterCount} parameters)` },
        { label: 'Lowest-residual family', value: `${lowestResidual.distributionName} (rmse ${lowestResidual.rmse.toExponential(3)}, ${lowestResidual.parameterCount} parameters)` },
        { label: 'Tie band (judge units)', value: tieBand.toPrecision(6) },
        {
          label: 'Winning parameters',
          value: Object.entries(best.params)
            .map(([k, v]) => `${k} = ${v.toPrecision(8)}`)
            .join(', '),
        },
        { label: 'Winning rmse (judge units)', value: best.rmse.toPrecision(6) },
        { label: 'Per-quantile residuals', value: best.residuals.map((r) => `${r.level}: ${r.residual.toExponential(3)}`).join('; ') },
        { label: 'Near-tied families', value: familySensitivity.nearTiedFamilies.join(', ') },
        { label: 'Largest tail-probability spread across near-ties', value: Number.isFinite(maxSpread) ? maxSpread.toPrecision(4) : 'unbounded' },
      ],
      assumptions: [
        'The judge meant the stated levels as cumulative probabilities of the same quantity.',
        'The quantity is continuous. A discrete quantity needs a discrete family and a different protocol.',
        'Each stated quantile is treated as equally reliable.',
      ],
      limitations: [
        'A few quantiles cannot identify a family. The winner is the best of several near-equivalent descriptions, not the truth.',
        'Extrapolation beyond the stated range is governed entirely by the family, i.e. by an assumption the judge never made.',
        'Everything here is `assumed`: the input is an opinion.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}
