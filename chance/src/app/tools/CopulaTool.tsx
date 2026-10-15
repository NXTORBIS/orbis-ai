/**
 * Dependence modelling with copulas.
 *
 * This screen exists to make one assumption visible. Everywhere else in the
 * application a relationship between two quantities is expressed as a rank
 * correlation drawn through a Gaussian copula, and a Gaussian copula has
 * exactly zero tail dependence for every correlation short of ±1: joint
 * extremes are no more likely than the correlation alone implies. That is the
 * assumption that makes a fitted model understate simultaneous losses, and it
 * is not visible from the correlation coefficient. Here it is shown directly,
 * beside families that match the *same* Kendall's τ and disagree sharply in
 * the tail.
 *
 * Every number comes from `src/engine/copula/`. Nothing is recomputed here and
 * nothing is substituted when the engine refuses: an `EngineError` is shown as
 * the engine's own message, per section, so one failed computation does not
 * blank the rest of the screen.
 */
import { useMemo } from 'react';
import {
  COPULAS,
  FITTABLE_COPULAS,
  bivariateNormalCdf,
  comonotonicCopula,
  compareCopulaFamilies,
  countermonotonicCopula,
  empiricalCopula,
  fitCopulaByKendallTau,
  gaussianCopulaSampler,
  getCopula,
  independenceCopula,
  pseudoObservations,
  sampleKendallTau,
  sampleSpearmanRho,
  tCopulaSampler,
  type CopulaComparison,
  type CopulaDef,
  type CopulaFit,
  type CopulaParams,
  type Pair,
  type TailDependence,
} from '../../engine/copula';
import { EXACTNESS_LABEL, type Explanation } from '../../engine/core/result';
import { normalQuantile } from '../../engine/special/gamma';
import { Random } from '../../engine/random/rng';
import {
  Badge,
  Button,
  Card,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  Segmented,
  SelectField,
  SliderField,
  TextField,
} from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { HeatmapChart, LineChart, ScatterChart } from '../../ui/charts/charts';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

export interface CopulaConfig {
  /** Where the paired observations come from. */
  dataSource: 'built-in' | 'pasted';
  /** Which built-in demonstration dataset, when `dataSource` is 'built-in'. */
  builtInId: 'clayton-lower' | 'gumbel-upper' | 'gaussian-plain' | 'independent';
  /** Pasted pairs, one "x, y" per line. */
  pairsText: string;
  /** Family id, as a plain string: one of the ids in `COPULAS`. */
  familyId: string;
  /** Whether the family's parameters are set by hand or inverted from a τ. */
  paramMode: 'manual' | 'from-sample-tau';
  /** Parameter values for `familyId` when `paramMode` is 'manual'. */
  params: Record<string, number>;
  /** Grid resolution of the empirical-vs-fitted difference heatmap. */
  gridSize: number;
  /** The point (u, v) at which the Fréchet–Hoeffding bounds are reported. */
  probeU: number;
  probeV: number;
  /**
   * Whether to run the AIC comparison across every fittable family. Off by
   * default: it evaluates a pseudo-likelihood over all n pseudo-observations
   * for six families, and profiles the Student-t copula over a 13-point ν grid
   * whose density calls each run a quadrature. On a few thousand pairs that is
   * seconds of blocked main thread, so it is something you ask for.
   */
  runComparison: boolean;
  /**
   * Whether to draw from a multivariate sampler. Off by default for the same
   * reason: the draw count is large on purpose (a tail frequency estimated
   * from few draws says nothing) and the loop blocks the main thread.
   */
  runSampler: boolean;
  samplerFamily: 'gaussian' | 't';
  samplerRho: number;
  samplerNu: number;
  samplerDraws: number;
  samplerSeed: string;
  /** Tail quantile q at which joint-extreme frequencies are reported. */
  tailQuantile: number;
}

export const COPULA_DEFAULT: CopulaConfig = {
  dataSource: 'built-in',
  builtInId: 'clayton-lower',
  pairsText: '',
  familyId: 'gaussian',
  paramMode: 'from-sample-tau',
  params: { rho: 0.5 },
  gridSize: 11,
  probeU: 0.1,
  probeV: 0.1,
  runComparison: false,
  runSampler: false,
  samplerFamily: 'gaussian',
  samplerRho: 0.6,
  samplerNu: 4,
  samplerDraws: 20000,
  samplerSeed: 'copula-1',
  tailQuantile: 0.05,
};

/* ------------------------------------------------------------------ helpers */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run an engine call, turning an EngineError into its own message. */
function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Built-in demonstration data. These are *not* observations of anything: each
 * set is drawn from one of the engine's own copula families with a fixed seed,
 * so the figures are identical on every machine and the true dependence
 * structure is known. Every panel that uses them says so.
 */
const BUILT_IN: { id: CopulaConfig['builtInId']; label: string; truth: string; family: string; params: CopulaParams }[] = [
  { id: 'clayton-lower', label: 'Clustered in the lower tail (drawn from a Clayton copula)', truth: 'Clayton copula, θ = 2', family: 'clayton', params: { theta: 2 } },
  { id: 'gumbel-upper', label: 'Clustered in the upper tail (drawn from a Gumbel copula)', truth: 'Gumbel copula, θ = 2', family: 'gumbel', params: { theta: 2 } },
  { id: 'gaussian-plain', label: 'No tail clustering (drawn from a Gaussian copula)', truth: 'Gaussian copula, ρ = 0.7', family: 'gaussian', params: { rho: 0.7 } },
  { id: 'independent', label: 'Unrelated (drawn from the independence copula)', truth: 'Independence copula', family: 'independence', params: {} },
];

const BUILT_IN_N = 200;

/** Deterministic draw from a named family; margins are left uniform. */
function builtInPairs(id: CopulaConfig['builtInId']): Pair[] {
  const spec = BUILT_IN.find((b) => b.id === id) ?? BUILT_IN[0];
  const def = getCopula(spec.family);
  const rng = new Random(`orbis-copula-${spec.id}`);
  const out: Pair[] = [];
  for (let i = 0; i < BUILT_IN_N; i++) {
    const [u, v] = def.sample(rng, spec.params);
    out.push({ x: u, y: v });
  }
  return out;
}

interface ParsedPairs {
  pairs: Pair[];
  skipped: { line: number; text: string }[];
  truncated: boolean;
}

const MAX_PAIRS = 20000;

function parsePairs(text: string): ParsedPairs {
  const pairs: Pair[] = [];
  const skipped: { line: number; text: string }[] = [];
  const lines = text.split(/\r?\n/);
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    if (pairs.length >= MAX_PAIRS) {
      truncated = true;
      break;
    }
    const parts = raw.split(/[,;\t ]+/).filter(Boolean);
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (parts.length < 2 || !Number.isFinite(x) || !Number.isFinite(y)) {
      skipped.push({ line: i + 1, text: raw.length > 48 ? `${raw.slice(0, 48)}…` : raw });
      continue;
    }
    pairs.push({ x, y });
  }
  return { pairs, skipped, truncated };
}

/** The Explanation a fit carries, assembled from the engine's own fields. */
function fitExplanation(fit: CopulaFit, def: CopulaDef): Explanation {
  return {
    method: `${fit.familyName} fitted to ${fit.n.toLocaleString('en-US')} pairs. ${fit.method}`,
    formula: def.formula,
    steps: [
      { label: "Sample Kendall's τ of the data", expression: 'τ̂', value: formatValue(fit.sampleKendallTau, 6) },
      ...def.params.map((spec) => ({
        label: spec.label,
        expression: spec.symbol,
        value: formatValue(fit.params[spec.key], 6),
      })),
      { label: 'τ the fitted parameters reproduce', expression: 'τ(θ̂)', value: formatValue(fit.fittedKendallTau, 6) },
      {
        label: 'Pseudo log-likelihood at the pseudo-observations',
        expression: 'Σ log c(û_i, v̂_i)',
        value: fit.logLikelihood === null ? 'not finite, or this family has no density' : formatValue(fit.logLikelihood, 6),
      },
      {
        label: `AIC (${fit.parameterCount} parameter${fit.parameterCount === 1 ? '' : 's'})`,
        expression: '2k − 2 log L',
        value: fit.aic === null ? 'not available without a finite pseudo-likelihood' : formatValue(fit.aic, 6),
      },
      {
        label: 'Coefficients of tail dependence of the fitted family',
        expression: 'λ_L, λ_U',
        value: `${formatValue(fit.tailDependence.lower, 4)}, ${formatValue(fit.tailDependence.upper, 4)}`,
      },
    ],
    assumptions: def.notes,
    limitations: fit.limitations,
    exactness: fit.exactness,
  };
}

function describeTail(t: TailDependence): string {
  if (t.lower === 0 && t.upper === 0) {
    return 'No tail dependence in either tail: conditional on one variable being extreme, the probability that the other is equally extreme falls to zero.';
  }
  if (t.lower > 0 && t.upper === 0) return 'Lower-tail dependence only: joint lows cluster, joint highs do not.';
  if (t.upper > 0 && t.lower === 0) return 'Upper-tail dependence only: joint highs cluster, joint lows do not.';
  return 'Dependence in both tails.';
}

/* --------------------------------------------------------------- the screen */

export function CopulaTool({ config }: { config: CopulaConfig }) {
  const app = useApp();
  const set = (patch: Partial<CopulaConfig>) => app.updateConfig({ ...config, ...patch });

  // ---- data -------------------------------------------------------------
  const parsed = useMemo(() => parsePairs(config.pairsText), [config.pairsText]);
  const pairs = useMemo(
    () => (config.dataSource === 'built-in' ? builtInPairs(config.builtInId) : parsed.pairs),
    [config.dataSource, config.builtInId, parsed.pairs],
  );
  const builtInSpec = BUILT_IN.find((b) => b.id === config.builtInId) ?? BUILT_IN[0];

  // ---- rank dependence --------------------------------------------------
  const pseudo = useMemo(() => attempt(() => pseudoObservations(pairs)), [pairs]);
  const tau = useMemo(() => attempt(() => sampleKendallTau(pairs)), [pairs]);
  const rhoS = useMemo(() => attempt(() => sampleSpearmanRho(pairs)), [pairs]);
  const empirical = useMemo(() => attempt(() => empiricalCopula(pairs)), [pairs]);

  // ---- the selected family ----------------------------------------------
  const familyDef = useMemo(() => attempt(() => getCopula(config.familyId)), [config.familyId]);
  const manualParams = useMemo<CopulaParams | null>(() => {
    if (!familyDef.ok) return null;
    const out: CopulaParams = {};
    for (const spec of familyDef.value.params) {
      const v = config.params[spec.key];
      out[spec.key] = Number.isFinite(v) ? v : spec.defaultValue;
    }
    return out;
  }, [familyDef, config.params]);

  const fit = useMemo(() => {
    if (config.paramMode !== 'from-sample-tau') return null;
    const r = fitCopulaByKendallTau(pairs, config.familyId);
    return r.ok ? ({ ok: true, value: r.value } as Attempt<CopulaFit>) : ({ ok: false, error: r.errors.map((e) => e.message).join(' ') } as Attempt<CopulaFit>);
  }, [pairs, config.familyId, config.paramMode]);

  /** The parameters actually in force, however they were obtained. */
  const activeParams = useMemo<CopulaParams | null>(() => {
    if (config.paramMode === 'from-sample-tau') return fit && fit.ok ? fit.value.params : null;
    return manualParams;
  }, [config.paramMode, fit, manualParams]);

  const activeFamilyStats = useMemo(() => {
    if (!familyDef.ok || !activeParams) return null;
    const def = familyDef.value;
    return attempt(() => {
      def.validate(activeParams);
      return {
        kendallTau: def.kendallTau(activeParams),
        spearmanRho: def.spearmanRho(activeParams),
        tail: def.tailDependence(activeParams),
      };
    });
  }, [familyDef, activeParams]);

  // ---- families that match the SAME tau ---------------------------------
  // Closed-form only: `fromKendallTau` then `tailDependence`, O(1) per family.
  // No likelihood is evaluated here, which is why this is not behind a button.
  const sameTauFamilies = useMemo(() => {
    if (!tau.ok) return null;
    const t = tau.value;
    return FITTABLE_COPULAS.map((def) => {
      const a = attempt(() => {
        const params = def.fromKendallTau(t);
        def.validate(params);
        return { params, tail: def.tailDependence(params), fittedTau: def.kendallTau(params) };
      });
      return { def, attempt: a };
    });
  }, [tau]);

  /** Conditional joint-exceedance curves: P(V ≤ q | U ≤ q) = C(q, q)/q. */
  const exceedanceCurves = useMemo(() => {
    if (!sameTauFamilies || !empirical.ok) return null;
    const qs: number[] = [];
    for (let i = 1; i <= 40; i++) qs.push(i / 80);
    const series: { label: string; points: { x: number; y: number }[]; dashed?: boolean }[] = [];
    for (const row of sameTauFamilies) {
      if (!row.attempt.ok) continue;
      const pts: { x: number; y: number }[] = [];
      for (const q of qs) {
        const c = attempt(() => row.def.cdf(q, q, row.attempt.ok ? row.attempt.value.params : {}));
        if (c.ok && Number.isFinite(c.value)) pts.push({ x: q, y: c.value / q });
      }
      if (pts.length) series.push({ label: row.def.name, points: pts });
    }
    const emp = empirical.value;
    const empPts = qs.map((q) => ({ x: q, y: emp.cdf(q, q) / q }));
    series.push({ label: `Your data (empirical copula, n = ${emp.n})`, points: empPts, dashed: true });
    return series;
  }, [sameTauFamilies, empirical]);

  /** Difference between the empirical copula and the family in force. */
  const differenceGrid = useMemo(() => {
    if (!empirical.ok || !familyDef.ok || !activeParams) return null;
    const k = Math.max(5, Math.min(21, Math.round(config.gridSize)));
    const def = familyDef.value;
    const emp = empirical.value;
    return attempt(() => {
      def.validate(activeParams);
      const labels: string[] = [];
      for (let i = 1; i <= k; i++) labels.push((i / (k + 1)).toFixed(3));
      const values: number[][] = [];
      // Rows run top to bottom, so v descends to put (0,0) at the bottom left.
      for (let r = 0; r < k; r++) {
        const v = (k - r) / (k + 1);
        const row: number[] = [];
        for (let c = 0; c < k; c++) {
          const u = (c + 1) / (k + 1);
          row.push(emp.cdf(u, v) - def.cdf(u, v, activeParams));
        }
        values.push(row);
      }
      return { rowLabels: [...labels].reverse(), colLabels: labels, values, k };
    });
  }, [empirical, familyDef, activeParams, config.gridSize]);

  /** Fréchet–Hoeffding bounds at the probe point, from the engine's own
   *  comonotonic and countermonotonic copulas. */
  const bounds = useMemo(() => {
    const u = config.probeU;
    const v = config.probeV;
    return attempt(() => {
      const lower = countermonotonicCopula.cdf(u, v, {});
      const upper = comonotonicCopula.cdf(u, v, {});
      const indep = independenceCopula.cdf(u, v, {});
      const family =
        familyDef.ok && activeParams
          ? (() => {
              familyDef.value.validate(activeParams);
              return familyDef.value.cdf(u, v, activeParams);
            })()
          : null;
      const emp = empirical.ok ? empirical.value.cdf(u, v) : null;
      return { lower, upper, indep, family, emp };
    });
  }, [config.probeU, config.probeV, familyDef, activeParams, empirical]);

  /** Gaussian tail decay, computed from the bivariate normal CDF directly. */
  const gaussianDecay = useMemo(() => {
    const rho = familyDef.ok && familyDef.value.id === 'gaussian' && activeParams ? activeParams.rho : config.samplerRho;
    return attempt(() => {
      const qs = [0.2, 0.1, 0.05, 0.01, 0.001, 0.0001];
      return {
        rho,
        rows: qs.map((q) => {
          const z = normalQuantile(q);
          const joint = bivariateNormalCdf(z, z, rho);
          return { q, joint, conditional: joint / q };
        }),
      };
    });
  }, [familyDef, activeParams, config.samplerRho]);

  // ---- gated: AIC comparison across families ----------------------------
  const comparison = useMemo(() => {
    if (!config.runComparison) return null;
    const r = compareCopulaFamilies(pairs);
    return r.ok
      ? ({ ok: true, value: r.value } as Attempt<CopulaComparison>)
      : ({ ok: false, error: r.errors.map((e) => e.message).join(' ') } as Attempt<CopulaComparison>);
  }, [config.runComparison, pairs]);

  // ---- gated: multivariate sampler draws --------------------------------
  const sampled = useMemo(() => {
    if (!config.runSampler) return null;
    return attempt(() => {
      const rho = config.samplerRho;
      const corr = [
        [1, rho, rho],
        [rho, 1, rho],
        [rho, rho, 1],
      ];
      const sampler = config.samplerFamily === 't' ? tCopulaSampler(corr, config.samplerNu) : gaussianCopulaSampler(corr);
      const rng = new Random(config.samplerSeed);
      const draws = Math.max(100, Math.min(200000, Math.round(config.samplerDraws)));
      const q = config.tailQuantile;
      const points: { x: number; y: number }[] = [];
      const keepEvery = Math.max(1, Math.ceil(draws / 4000));
      let pairBelow = 0;
      let allBelow = 0;
      let allAbove = 0;
      for (let i = 0; i < draws; i++) {
        const u = sampler.sample(rng);
        if (i % keepEvery === 0) points.push({ x: u[0], y: u[1] });
        if (u[0] <= q && u[1] <= q) pairBelow++;
        if (u[0] <= q && u[1] <= q && u[2] <= q) allBelow++;
        if (u[0] > 1 - q && u[1] > 1 - q && u[2] > 1 - q) allAbove++;
      }
      return {
        sampler,
        draws,
        q,
        points,
        pairJoint: pairBelow / draws,
        tripleLow: allBelow / draws,
        tripleHigh: allAbove / draws,
        independenceTriple: q ** 3,
        tail: sampler.tailDependence(0, 1),
      };
    });
  }, [config.runSampler, config.samplerFamily, config.samplerRho, config.samplerNu, config.samplerDraws, config.samplerSeed, config.tailQuantile]);

  const dataLabel = config.dataSource === 'built-in' ? builtInSpec.label : `${pairs.length.toLocaleString('en-US')} pasted pairs`;

  return (
    <>
      <ToolHeader toolId="copula" />
      <div className="oc-workspace">
        <div className="oc-stack">
          {/* ------------------------------------------------------- data */}
          <Card title="Paired observations" hint="A copula describes the dependence between two quantities once each one's own distribution is set aside.">
            <Segmented
              label="Where the pairs come from"
              value={config.dataSource}
              onChange={(dataSource) => set({ dataSource })}
              options={[
                { value: 'built-in', label: 'Demonstration data' },
                { value: 'pasted', label: 'Paste your own' },
              ]}
            />
            {config.dataSource === 'built-in' ? (
              <>
                <SelectField
                  label="Demonstration dataset"
                  value={config.builtInId}
                  onChange={(builtInId) => set({ builtInId })}
                  options={BUILT_IN.map((b) => ({ value: b.id, label: b.label }))}
                />
                <Notice tone="warning" title="These are not observations of anything">
                  <p style={{ marginBottom: 0 }}>
                    Each demonstration set is {BUILT_IN_N} pairs drawn by the engine's own sampler from a known copula — here a{' '}
                    <strong>{builtInSpec.truth}</strong> — with a fixed seed, so the figures are the same on every machine. They are here so you can check
                    whether the fitting and comparison below recover a dependence structure that is known in advance. They describe no real quantity.
                  </p>
                </Notice>
              </>
            ) : (
              <>
                <TextField
                  label="Pairs, one per line"
                  value={config.pairsText}
                  onChange={(pairsText) => set({ pairsText })}
                  multiline
                  rows={8}
                  monospace
                  maxLength={400000}
                  placeholder={'1.42, 0.87\n2.01, 1.13\n0.55, 0.40'}
                  hint={`Two numbers per line, separated by a comma, semicolon, tab or space. Up to ${MAX_PAIRS.toLocaleString('en-US')} pairs. Nothing is uploaded; the text stays in your browser.`}
                />
                {parsed.skipped.length > 0 && (
                  <Notice
                    tone="warning"
                    title={`${parsed.skipped.length} line(s) could not be read as a pair and were left out`}
                    items={parsed.skipped.slice(0, 8).map((s) => `Line ${s.line}: ${s.text}`)}
                  />
                )}
                {parsed.truncated && <Notice tone="warning">Only the first {MAX_PAIRS.toLocaleString('en-US')} pairs were read.</Notice>}
              </>
            )}
          </Card>

          {/* ----------------------------------------------------- family */}
          <Card title="A copula family" hint="Pick a family and either set its parameter or match it to the rank concordance of the data.">
            <SelectField
              label="Family"
              value={config.familyId}
              onChange={(familyId) => {
                const def = attempt(() => getCopula(familyId));
                const params: Record<string, number> = {};
                if (def.ok) for (const spec of def.value.params) params[spec.key] = spec.defaultValue;
                set({ familyId, params });
              }}
              options={COPULAS.map((c) => ({ value: c.id, label: `${c.name} (${c.family})` }))}
              hint={familyDef.ok ? familyDef.value.description : undefined}
              error={familyDef.ok ? undefined : familyDef.error}
            />
            <Segmented
              label="How the parameters are set"
              value={config.paramMode}
              onChange={(paramMode) => set({ paramMode })}
              options={[
                { value: 'from-sample-tau', label: "Match the data's τ" },
                { value: 'manual', label: 'Set by hand' },
              ]}
            />
            {config.paramMode === 'manual' && familyDef.ok && (
              <>
                {familyDef.value.params.length === 0 && (
                  <p className="oc-field__hint">{familyDef.value.name} has no parameters to set.</p>
                )}
                {familyDef.value.params.map((spec) => (
                  <SliderField
                    key={spec.key}
                    label={spec.label}
                    symbol={spec.symbol}
                    value={config.params[spec.key] ?? spec.defaultValue}
                    onChange={(v) => set({ params: { ...config.params, [spec.key]: v } })}
                    min={spec.sliderMin}
                    max={spec.sliderMax}
                    step={spec.step}
                    hint={spec.description}
                  />
                ))}
              </>
            )}
            {config.paramMode === 'from-sample-tau' && (
              <p className="oc-field__hint">
                The parameter is obtained by inverting Kendall's τ — the method of moments for dependence. It uses only the rank concordance of the data and
                does not check that the shape of the dependence matches the family, which is the whole point of the comparison further down.
              </p>
            )}
            {familyDef.ok && familyDef.value.limitations.length > 0 && (
              <Notice tone="info" title={`What ${familyDef.value.name} cannot represent`} items={familyDef.value.limitations} />
            )}
          </Card>

          {/* ------------------------------------------------------ bounds */}
          <Card title="Probe a point of the unit square" hint="Where the relationship is unknown, only bounds can be stated.">
            <SliderField label="u" value={config.probeU} onChange={(probeU) => set({ probeU })} min={0.01} max={0.99} step={0.01} />
            <SliderField label="v" value={config.probeV} onChange={(probeV) => set({ probeV })} min={0.01} max={0.99} step={0.01} />
            <NumberField
              label="Tail quantile q used for joint-extreme figures"
              value={config.tailQuantile}
              onChange={(tailQuantile) => set({ tailQuantile })}
              min={0.0001}
              max={0.5}
              step={0.005}
            />
            <NumberField label="Heatmap grid resolution" value={config.gridSize} onChange={(gridSize) => set({ gridSize })} min={5} max={21} integer />
          </Card>

          {/* ------------------------------------------- gated: comparison */}
          <Card title="Compare every fittable family" hint="Fit all six by Kendall's τ and rank them by AIC.">
            {!config.runComparison ? (
              <>
                <Notice tone="info" title="The comparison is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    It fits {FITTABLE_COPULAS.length} families and evaluates a pseudo log-likelihood at all{' '}
                    {pairs.length.toLocaleString('en-US')} pseudo-observations for each, and for the Student-t copula it repeats that over a 13-point ν grid
                    with a quadrature inside every density call. On a large set of pairs that takes long enough to make the page unresponsive while it runs,
                    so it is run only when you ask for it.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    Everything above this point is closed-form and runs on every keystroke; nothing below it does.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runComparison: true })} disabled={pairs.length < 5}>
                    Compare the families
                  </Button>
                </div>
                {pairs.length < 5 && <p className="oc-muted">At least 5 pairs are needed before any family can be fitted.</p>}
              </>
            ) : (
              <div className="oc-btn-row">
                <Button icon="x" onClick={() => set({ runComparison: false })}>
                  Stop comparing
                </Button>
              </div>
            )}
          </Card>

          {/* ---------------------------------------------- gated: sampler */}
          <Card title="Draw from a multivariate sampler" hint="Three equicorrelated variables, to see how often their extremes coincide.">
            <SelectField
              label="Sampler"
              value={config.samplerFamily}
              onChange={(samplerFamily) => set({ samplerFamily })}
              options={[
                { value: 'gaussian', label: 'Gaussian copula (no tail dependence)' },
                { value: 't', label: 'Student-t copula (tail dependence in both tails)' },
              ]}
            />
            <SliderField label="Correlation of every pair" symbol="ρ" value={config.samplerRho} onChange={(samplerRho) => set({ samplerRho })} min={-0.95} max={0.95} step={0.05} />
            {config.samplerFamily === 't' && (
              <SliderField label="Degrees of freedom" symbol="ν" value={config.samplerNu} onChange={(samplerNu) => set({ samplerNu })} min={1} max={50} step={0.5} hint="Smaller ν means heavier joint tails. As ν grows the t copula approaches the Gaussian one." />
            )}
            <NumberField label="Draws" value={config.samplerDraws} onChange={(samplerDraws) => set({ samplerDraws })} min={100} max={200000} integer />
            <TextField label="Seed" value={config.samplerSeed} onChange={(samplerSeed) => set({ samplerSeed })} maxLength={80} monospace />
            {!config.runSampler ? (
              <>
                <Notice tone="info" title="The sampler is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    {config.samplerDraws.toLocaleString('en-US')} draws of a 3-vector, each a Cholesky multiply and three CDF evaluations, run on the main
                    thread. A joint-extreme frequency estimated from few draws says nothing, so the count has to be large, and a large count blocks the page.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runSampler: true })}>
                    Draw the sample
                  </Button>
                </div>
              </>
            ) : (
              <div className="oc-btn-row">
                <Button icon="x" onClick={() => set({ runSampler: false })}>
                  Stop sampling
                </Button>
              </div>
            )}
          </Card>

          <AiAssistPanel
            capability="explainUncertainty"
            context="The tail-dependence coefficients, the family comparison and the Fréchet–Hoeffding bounds below are all computed by the engine and state their own limitations; no interpretation here is generated."
          />
        </div>

        {/* =================================================== results */}
        <div className="oc-stack">
          {/* ------------------------------------------ rank dependence */}
          <Card title="Rank dependence in your data" hint={dataLabel}>
            {!tau.ok && <Notice tone="error" title="Kendall's τ could not be computed">{tau.error}</Notice>}
            {!rhoS.ok && <Notice tone="error" title="Spearman's ρ could not be computed">{rhoS.error}</Notice>}
            {!pseudo.ok && <Notice tone="error" title="Pseudo-observations could not be formed">{pseudo.error}</Notice>}
            {(tau.ok || rhoS.ok) && (
              <>
                <div className="oc-figure-grid">
                  <Fig label="Pairs" value={pairs.length.toLocaleString('en-US')} />
                  <Fig label="Kendall's τ" value={tau.ok ? formatValue(tau.value, 5) : '—'} sub="Rank concordance; the quantity the fits below match" />
                  <Fig label="Spearman's ρ" value={rhoS.ok ? formatValue(rhoS.value, 5) : '—'} sub="Rank correlation" />
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge variant="empirical">{EXACTNESS_LABEL.empirical}</Badge>
                  <span style={{ fontSize: 12.5 }}>
                    Both are statistics of these {pairs.length.toLocaleString('en-US')} pairs. A different sample would give different values.
                  </span>
                </div>
                <Notice tone="warning" title="Neither number says anything about the tails">
                  <p style={{ marginBottom: 0 }}>
                    τ and ρ summarise concordance over the whole square. Copulas with identical τ can differ by an arbitrary amount in how often both variables
                    are extreme at once — the table below shows exactly that for these data. Nothing here establishes that one variable moves the other.
                  </p>
                </Notice>
              </>
            )}
          </Card>

          {/* ------------------------- pseudo-observation scatter (key view) */}
          {pseudo.ok && (
            <Card>
              <ScatterChart
                title="Pseudo-observations on the unit square"
                description={`Scatter of ${pseudo.value.u.length} pseudo-observations: each pair's ranks divided by n + 1.`}
                points={pseudo.value.u.map((u, i) => ({ x: u, y: pseudo.value.v[i] }))}
                xLabel="û — rank of the first variable / (n + 1)"
                yLabel="v̂ — rank of the second variable / (n + 1)"
                note="Dividing the ranks by n + 1 keeps every point strictly inside the square, which is what allows a copula density to be evaluated at them. The margins have been removed entirely: only the dependence is left. Crowding in the bottom-left or top-right corner is tail dependence; an even scatter near the corners is not."
              />
            </Card>
          )}

          {/* ----------------------------------------- the family in force */}
          {familyDef.ok && (
            <Card title={`${familyDef.value.name}: ${config.paramMode === 'from-sample-tau' ? "fitted by matching the data's τ" : 'with the parameters you set'}`}>
              {config.paramMode === 'from-sample-tau' && fit && !fit.ok && (
                <Notice tone="error" title={`${familyDef.value.name} could not be fitted to these data`}>{fit.error}</Notice>
              )}
              {activeFamilyStats && !activeFamilyStats.ok && (
                <Notice tone="error" title="These parameters are not valid for this family">{activeFamilyStats.error}</Notice>
              )}
              {activeFamilyStats && activeFamilyStats.ok && activeParams && (
                <>
                  <div className="oc-figure-grid">
                    {familyDef.value.params.map((spec) => (
                      <Fig key={spec.key} label={`${spec.label} (${spec.symbol})`} value={formatValue(activeParams[spec.key], 6)} />
                    ))}
                    <Fig label="Kendall's τ of the family" value={formatValue(activeFamilyStats.value.kendallTau, 5)} sub={`Representable range ${formatValue(familyDef.value.kendallTauRange.min, 3)} to ${formatValue(familyDef.value.kendallTauRange.max, 3)}`} />
                    <Fig label="Spearman's ρ of the family" value={formatValue(activeFamilyStats.value.spearmanRho, 5)} />
                    <Fig label="Lower tail dependence λ_L" value={formatValue(activeFamilyStats.value.tail.lower, 5)} sub="P(V extreme low | U extreme low), in the limit" />
                    <Fig label="Upper tail dependence λ_U" value={formatValue(activeFamilyStats.value.tail.upper, 5)} sub="P(V extreme high | U extreme high), in the limit" />
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Structural class', value: familyDef.value.family },
                      { label: 'Tail behaviour', value: describeTail(activeFamilyStats.value.tail) },
                      { label: 'How it is sampled', value: familyDef.value.samplingMethod },
                      {
                        label: 'Exactness of the tail-dependence figure',
                        value: (
                          <span style={{ display: 'inline-flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Badge variant={familyDef.value.exactness.tailDependence}>{EXACTNESS_LABEL[familyDef.value.exactness.tailDependence]}</Badge>
                            <span>
                              CDF: {EXACTNESS_LABEL[familyDef.value.exactness.cdf].toLowerCase()} · τ:{' '}
                              {EXACTNESS_LABEL[familyDef.value.exactness.kendallTau].toLowerCase()}
                            </span>
                          </span>
                        ),
                      },
                    ]}
                  />
                  {familyDef.value.id === 'gaussian' && (
                    <Notice tone="error" title="A Gaussian copula has zero tail dependence at every correlation below 1">
                      <p>
                        λ_L = λ_U = 0 for every ρ with |ρ| &lt; 1. It is not 0 because the correlation here happens to be moderate: raise ρ to 0.99 and both
                        coefficients are still exactly 0. Conditional on one variable being in its most extreme q, the chance the other is too falls to zero as
                        q shrinks — the table further down shows that decay.
                      </p>
                      <p style={{ marginBottom: 0 }}>
                        This is the single assumption most likely to make a fitted model understate joint extremes. If simultaneous worst cases are the thing
                        you are trying to size, a Gaussian copula fitted to the right τ will still give you too few of them, and no amount of correlation will
                        fix it.
                      </p>
                    </Notice>
                  )}
                  {config.paramMode === 'from-sample-tau' && fit && fit.ok && (
                    <>
                      <KeyValueList
                        items={[
                          { label: 'Pseudo log-likelihood', value: fit.value.logLikelihood === null ? 'Not available for this family' : formatValue(fit.value.logLikelihood, 6) },
                          { label: 'AIC', value: fit.value.aic === null ? 'Not available without a finite pseudo-likelihood' : formatValue(fit.value.aic, 6) },
                        ]}
                      />
                      <ExplanationPanel explanation={fitExplanation(fit.value, familyDef.value)} />
                    </>
                  )}
                  {config.dataSource === 'built-in' && (
                    <Notice tone="info" title="What the demonstration data were actually drawn from">
                      <p style={{ marginBottom: 0 }}>
                        {builtInSpec.truth}. Compare the tail-dependence figures above with that: matching τ does not oblige a family to match the tail.
                      </p>
                    </Notice>
                  )}
                </>
              )}
            </Card>
          )}

          {/* --------------------------- same tau, different tails (ungated) */}
          {sameTauFamilies && tau.ok && (
            <Card
              title="Six families matched to the same Kendall's τ"
              hint={`Each parameter is inverted from τ̂ = ${formatValue(tau.value, 5)}. Every row therefore has the same rank concordance.`}
            >
              <DataTable
                caption="Families matched to the same Kendall's tau"
                columns={[
                  { key: 'f', header: 'Family', render: (r) => (r as TauRow).name },
                  { key: 'p', header: 'Parameters', render: (r) => (r as TauRow).params },
                  { key: 't', header: 'τ reproduced', numeric: true, render: (r) => (r as TauRow).fittedTau },
                  { key: 'l', header: 'λ_L', numeric: true, render: (r) => (r as TauRow).lower },
                  { key: 'u', header: 'λ_U', numeric: true, render: (r) => (r as TauRow).upper },
                ]}
                rows={sameTauFamilies.map((row): TauRow => ({
                  name: row.def.name,
                  params: row.attempt.ok
                    ? row.def.params.map((s) => `${s.symbol} = ${formatValue(row.attempt.ok ? row.attempt.value.params[s.key] : NaN, 4)}`).join(', ') || '—'
                    : row.attempt.error,
                  fittedTau: row.attempt.ok ? formatValue(row.attempt.value.fittedTau, 4) : '—',
                  lower: row.attempt.ok ? formatValue(row.attempt.value.tail.lower, 4) : '—',
                  upper: row.attempt.ok ? formatValue(row.attempt.value.tail.upper, 4) : '—',
                }))}
              />
              <Notice tone="warning" title="This is the disagreement, not a ranking">
                <p>
                  Every family in this table reproduces the same τ as your data. Their λ values do not agree, and in some cases differ by the whole range from
                  0 to near 1. Choosing between them is a choice about joint extremes that the τ of your data cannot make for you, and that the sample has very
                  few observations to settle: by definition only a handful of points land in the corners.
                </p>
                <p style={{ marginBottom: 0 }}>
                  A family whose row says λ_L = 0 is asserting that simultaneous extreme lows become arbitrarily unlikely relative to the marginal rate. If that
                  assertion is wrong, the model understates exactly the event most worth sizing.
                </p>
              </Notice>
              {sameTauFamilies.some((r) => !r.attempt.ok) && (
                <Notice
                  tone="info"
                  title="Families that cannot represent this τ"
                  items={sameTauFamilies.filter((r) => !r.attempt.ok).map((r) => `${r.def.name}: ${r.attempt.ok ? '' : r.attempt.error}`)}
                />
              )}
            </Card>
          )}

          {exceedanceCurves && exceedanceCurves.length > 0 && (
            <Card>
              <LineChart
                title="Conditional joint-exceedance, P(V ≤ q | U ≤ q)"
                description="For each family matched to the same Kendall's tau, the probability that the second variable is below its q-quantile given the first is, plotted against q."
                series={exceedanceCurves}
                xLabel="q — how far into the lower tail"
                yLabel="P(V ≤ q | U ≤ q)"
                yDomain={[0, 1]}
                valueFormatter={(v) => formatPercent(v)}
                note="Read these curves right to left. A family with lower-tail dependence flattens out at a positive level as q → 0: that level is λ_L. A family without it slides towards 0, however large its correlation. The dashed line is your data's empirical copula, which is a step function with one jump per observation and is least reliable exactly here, in the corner — it cannot settle the question on its own."
              />
            </Card>
          )}

          {/* ------------------------- the Gaussian decay, from Φ₂ directly */}
          {gaussianDecay.ok && (
            <Card title="The Gaussian decay, computed directly" hint={`Bivariate normal CDF at ρ = ${formatValue(gaussianDecay.value.rho, 4)}.`}>
              <DataTable
                caption="Gaussian copula joint-tail probabilities"
                columns={[
                  { key: 'q', header: 'q', numeric: true, render: (r) => formatValue((r as DecayRow).q, 6) },
                  { key: 'j', header: 'C(q, q) = Φ₂(z_q, z_q, ρ)', numeric: true, render: (r) => (r as DecayRow).joint.toExponential(3) },
                  { key: 'c', header: 'P(V ≤ q | U ≤ q)', numeric: true, render: (r) => formatPercent((r as DecayRow).conditional, 4) },
                  { key: 'i', header: 'Under independence', numeric: true, render: (r) => formatPercent((r as DecayRow).q, 4) },
                ]}
                rows={gaussianDecay.value.rows as DecayRow[]}
              />
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge variant="numerical">{EXACTNESS_LABEL.numerical}</Badge>
                <span style={{ fontSize: 12.5 }}>Gauss–Legendre quadrature of the bivariate normal density, as the engine's own CDF uses.</span>
              </div>
              <p className="oc-chart-note">
                The conditional column stays well above the independence column — the correlation is doing real work — and yet it keeps falling as q shrinks. Its
                limit is 0. That limit is what λ_L = 0 means, and it is a property of the family, not of the correlation.
              </p>
            </Card>
          )}
          {!gaussianDecay.ok && <Notice tone="error" title="The bivariate normal CDF could not be evaluated">{gaussianDecay.error}</Notice>}

          {/* ----------------------------------- empirical vs fitted heatmap */}
          {differenceGrid && !differenceGrid.ok && (
            <Notice tone="error" title="The empirical-against-family comparison could not be computed">{differenceGrid.error}</Notice>
          )}
          {differenceGrid && differenceGrid.ok && familyDef.ok && (
            <Card>
              <HeatmapChart
                title={`Empirical copula minus ${familyDef.value.name}`}
                description="Difference between the empirical copula of your pairs and the copula in force, on a grid of the unit square."
                rows={differenceGrid.value.rowLabels}
                columns={differenceGrid.value.colLabels}
                values={differenceGrid.value.values}
                valueLabel="Ĉₙ(u, v) − C(u, v)"
                diverging
              />
              <p className="oc-chart-note">
                Rows are v, descending, so the lower-left corner of the plot is the lower-left corner of the unit square. A positive cell means your data put
                more probability below that point than the family does. The empirical copula has {empirical.ok ? empirical.value.n : 0} jumps, so it cannot
                resolve anything finer than {empirical.ok ? formatValue(1 / empirical.value.n, 4) : '—'}; a difference smaller than that is not evidence of
                anything.
              </p>
            </Card>
          )}

          {/* -------------------------------------------------- the bounds */}
          <Card title={`What can be said at (u, v) = (${formatValue(config.probeU, 3)}, ${formatValue(config.probeV, 3)})`}>
            {!bounds.ok ? (
              <Notice tone="error" title="The bounds could not be computed">{bounds.error}</Notice>
            ) : (
              <>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">C(u, v) must lie between</span>
                  <span className="oc-result-hero__value">
                    {formatValue(bounds.value.lower, 5)} and {formatValue(bounds.value.upper, 5)}
                  </span>
                  <span className="oc-result-hero__detail">
                    Fréchet–Hoeffding bounds: max(u + v − 1, 0) ≤ C(u, v) ≤ min(u, v). No copula, of any family, can fall outside them.
                  </span>
                </div>
                <KeyValueList
                  items={[
                    { label: 'If the relationship is unknown', value: `Only the interval ${formatValue(bounds.value.lower, 5)} to ${formatValue(bounds.value.upper, 5)} can be stated. This is the honest answer when nothing is known about how the two move together.` },
                    { label: 'If they were independent', value: `${formatValue(bounds.value.indep, 5)} — a single point inside that interval, and an assumption, not a default.` },
                    { label: familyDef.ok ? `Under ${familyDef.value.name}` : 'Under the selected family', value: bounds.value.family === null ? 'Not available: the family or its parameters are not valid.' : formatValue(bounds.value.family, 5) },
                    { label: 'In your data', value: bounds.value.emp === null ? 'Not available: the empirical copula could not be formed.' : `${formatValue(bounds.value.emp, 5)} (empirical, a step function with ${empirical.ok ? empirical.value.n : 0} jumps)` },
                  ]}
                />
                <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge variant="exact">{EXACTNESS_LABEL.exact}</Badge>
                  <span style={{ fontSize: 12.5 }}>The bounds follow exactly from u and v. They hold whatever the dependence is.</span>
                </div>
                <Notice tone="warning" title="Independence is not the default">
                  <p style={{ marginBottom: 0 }}>
                    The independence value above is one point in an interval{' '}
                    {formatValue(bounds.value.upper - bounds.value.lower, 4)} wide. Assuming it because nothing is known about the relationship is a modelling
                    choice with consequences, and it is usually the choice that understates joint extremes. Where you do not know, report the interval.
                  </p>
                </Notice>
              </>
            )}
          </Card>

          {/* ------------------------------------- gated: AIC comparison */}
          {comparison && (
            <Card title="Family comparison by AIC">
              {!comparison.ok ? (
                <Notice tone="error" title="The families could not be compared">{comparison.error}</Notice>
              ) : (
                <>
                  <Notice tone="info" title="What this comparison is, exactly">
                    <p style={{ marginBottom: 0 }}>{comparison.value.statement}</p>
                  </Notice>
                  <DataTable
                    caption="Fitted families ranked by AIC"
                    columns={[
                      { key: 'f', header: 'Family', render: (r) => (r as RankRow).name },
                      { key: 'a', header: 'AIC', numeric: true, render: (r) => (r as RankRow).aic },
                      { key: 'd', header: 'ΔAIC', numeric: true, render: (r) => (r as RankRow).delta },
                      { key: 'l', header: 'Pseudo log-likelihood', numeric: true, render: (r) => (r as RankRow).ll },
                      { key: 'tl', header: 'λ_L', numeric: true, render: (r) => (r as RankRow).lower },
                      { key: 'tu', header: 'λ_U', numeric: true, render: (r) => (r as RankRow).upper },
                    ]}
                    rows={comparison.value.ranked.map((f): RankRow => ({
                      name: f.familyName,
                      aic: f.aic === null ? '—' : formatValue(f.aic, 5),
                      delta: formatValue(f.deltaAic, 4),
                      ll: f.logLikelihood === null ? '—' : formatValue(f.logLikelihood, 5),
                      lower: formatValue(f.tailDependence.lower, 4),
                      upper: formatValue(f.tailDependence.upper, 4),
                    }))}
                  />
                  <div className="oc-figure-grid">
                    <Fig label="Pairs compared" value={comparison.value.n.toLocaleString('en-US')} />
                    <Fig label="Sample Kendall's τ" value={formatValue(comparison.value.sampleKendallTau, 5)} />
                    <Fig label="Sample Spearman's ρ" value={formatValue(comparison.value.sampleSpearmanRho, 5)} />
                    <Fig
                      label="Spread of λ_L across the fitted families"
                      value={`${formatValue(Math.min(...comparison.value.ranked.map((f) => f.tailDependence.lower)), 4)} to ${formatValue(Math.max(...comparison.value.ranked.map((f) => f.tailDependence.lower)), 4)}`}
                      sub="All of them fit these data; they disagree about joint extreme lows by this much"
                    />
                    <Fig
                      label="Spread of λ_U across the fitted families"
                      value={`${formatValue(Math.min(...comparison.value.ranked.map((f) => f.tailDependence.upper)), 4)} to ${formatValue(Math.max(...comparison.value.ranked.map((f) => f.tailDependence.upper)), 4)}`}
                      sub="And by this much about joint extreme highs"
                    />
                  </div>
                  {comparison.value.ranked.length > 1 && comparison.value.ranked[1].deltaAic < 2 && (
                    <Notice tone="warning" title="The top two families are not distinguishable by these data">
                      <p style={{ marginBottom: 0 }}>
                        ΔAIC = {formatValue(comparison.value.ranked[1].deltaAic, 3)} between {comparison.value.ranked[0].familyName} and{' '}
                        {comparison.value.ranked[1].familyName}, which is within the range where both remain plausible. Their tail-dependence coefficients are
                        λ_L = {formatValue(comparison.value.ranked[0].tailDependence.lower, 4)} against{' '}
                        {formatValue(comparison.value.ranked[1].tailDependence.lower, 4)} and λ_U ={' '}
                        {formatValue(comparison.value.ranked[0].tailDependence.upper, 4)} against{' '}
                        {formatValue(comparison.value.ranked[1].tailDependence.upper, 4)}. Presenting the first as the answer would hide a disagreement the data
                        cannot resolve.
                      </p>
                    </Notice>
                  )}
                  {comparison.value.skipped.length > 0 && (
                    <Notice
                      tone="info"
                      title="Families that were not compared, and why"
                      items={comparison.value.skipped.map((s) => `${getCopula(s.familyId).name}: ${s.reason}`)}
                    />
                  )}
                  <ExplanationPanel explanation={fitExplanation(comparison.value.best, getCopula(comparison.value.best.familyId))} />
                  <Notice tone="info" title="Limitations the engine attached to this comparison" items={comparison.value.limitations} />
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------- gated: sampler */}
          {sampled && (
            <Card title="Draws from the sampler">
              {!sampled.ok ? (
                <Notice tone="error" title="The sampler could not be built or run">{sampled.error}</Notice>
              ) : (
                <>
                  <p style={{ fontSize: 12.5 }}>{sampled.value.sampler.description}</p>
                  <div className="oc-figure-grid">
                    <Fig label="Draws" value={sampled.value.draws.toLocaleString('en-US')} />
                    <Fig label="Pairwise λ (variables 1 and 2)" value={formatValue(sampled.value.tail.lower, 5)} sub="Closed form from the family, not estimated from the draws" />
                    <Fig label={`Both of 1 and 2 below q = ${formatValue(sampled.value.q, 4)}`} value={formatPercent(sampled.value.pairJoint, 4)} sub="Observed frequency in the draws" />
                    <Fig
                      label="Closed form for that pair probability"
                      value={(() => {
                        const z = normalQuantile(sampled.value.q);
                        const c = attempt(() => bivariateNormalCdf(z, z, config.samplerRho));
                        return config.samplerFamily === 'gaussian' ? (c.ok ? formatPercent(c.value, 4) : '—') : 'Not the Gaussian value';
                      })()}
                      sub={config.samplerFamily === 'gaussian' ? 'Φ₂(z_q, z_q, ρ), for comparison with the frequency' : 'The t copula has its own CDF; the Gaussian figure does not apply'}
                    />
                    <Fig label={`All three below q`} value={formatPercent(sampled.value.tripleLow, 4)} />
                    <Fig label="All three above 1 − q" value={formatPercent(sampled.value.tripleHigh, 4)} />
                    <Fig label="All three below q if they were independent" value={formatPercent(sampled.value.independenceTriple, 4)} sub="q³ — the figure an independence assumption would give" />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge variant="empirical">{EXACTNESS_LABEL.empirical}</Badge>
                    <span style={{ fontSize: 12.5 }}>
                      The three frequencies are estimates from {sampled.value.draws.toLocaleString('en-US')} draws with seed{' '}
                      <code>{config.samplerSeed}</code>. A frequency of 0 here means no draw landed in that corner, not that the probability is 0.
                    </span>
                  </div>
                  {(sampled.value.tripleLow === 0 || sampled.value.tripleHigh === 0) && (
                    <Notice tone="warning" title="A corner frequency came out as zero">
                      <p style={{ marginBottom: 0 }}>
                        No draw out of {sampled.value.draws.toLocaleString('en-US')} landed in that corner. That is an upper bound on the probability of roughly{' '}
                        {formatValue(3 / sampled.value.draws, 4)}, not a probability of zero. Increase the draws or widen q before reading anything into it.
                      </p>
                    </Notice>
                  )}
                  <Notice tone={config.samplerFamily === 'gaussian' ? 'error' : 'info'} title={config.samplerFamily === 'gaussian' ? 'What this sampler cannot produce' : 'What this sampler does and does not couple'}>
                    <p style={{ marginBottom: 0 }}>
                      {config.samplerFamily === 'gaussian'
                        ? 'Lower the tail quantile and the observed joint frequency keeps shrinking relative to the marginal rate, because the pairwise λ above is exactly 0. Correlation alone will not make extremes coincide.'
                        : 'A single chi-square draw is shared by all three coordinates, which is what couples their extremes — and it couples them symmetrically, so joint lows cannot cluster without joint highs clustering equally.'}
                    </p>
                  </Notice>
                  <Notice tone="info" title="Limitations the engine attached to this sampler" items={sampled.value.sampler.limitations} />
                  <ScatterChart
                    title="Variables 1 and 2 of the draws"
                    description="Scatter of the first two coordinates of each draw, already on the unit square."
                    points={sampled.value.points}
                    xLabel="U₁"
                    yLabel="U₂"
                    note={`Thinned to ${sampled.value.points.length.toLocaleString('en-US')} of ${sampled.value.draws.toLocaleString('en-US')} draws for the plot; the frequencies above use all of them. Compare the density of points in the two corners with the middle.`}
                  />
                </>
              )}
            </Card>
          )}

          {empirical.ok && <Notice tone="info" title="Limitations the engine attached to the empirical copula" items={empirical.value.limitations} />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ row helpers */

interface TauRow {
  name: string;
  params: string;
  fittedTau: string;
  lower: string;
  upper: string;
}

interface RankRow {
  name: string;
  aic: string;
  delta: string;
  ll: string;
  lower: string;
  upper: string;
}

interface DecayRow {
  q: number;
  joint: number;
  conditional: number;
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="oc-figure">
      <span className="oc-figure__label">{label}</span>
      <div className="oc-figure__value" style={{ fontSize: 16 }}>
        {value}
      </div>
      {sub && <div className="oc-figure__sub">{sub}</div>}
    </div>
  );
}
