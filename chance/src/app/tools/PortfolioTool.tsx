/**
 * Portfolio and aggregate risk.
 *
 * The Risk explorer measures ONE loss distribution. This screen measures a
 * portfolio of them, and the whole difficulty it exists to show is that risks
 * do not add: the aggregate depends on the dependence between the exposures,
 * and when that dependence is unknown the honest answer is a pair of bounds
 * rather than a number.
 *
 * Performance note: everything computed on open is cheap (marginal quadrature,
 * one lattice convolution, one copula simulation of a few tens of thousands of
 * draws). The genuinely expensive work — the scenario aggregation, Shapley
 * allocation, the frontier sweep with mean–CVaR, and the estimation-error
 * resampling study — sits behind explicit buttons with its cost stated, so the
 * first paint is never blocked by seconds of synchronous arithmetic.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EngineError, type Explanation } from '../../engine/core/result';
import { DISTRIBUTIONS, defaultParams, getDistribution, validateParams } from '../../engine/distributions/registry';
import { Random, Xoshiro128 } from '../../engine/random/rng';
import { choleskyWithCheck, type Matrix } from '../../engine/stats/linalg';
import { normalCdf } from '../../engine/special/gamma';
import {
  RISK_MEASURES,
  constructVarSubadditivityCounterexample,
  getRiskMeasure,
  type RiskMeasure,
} from '../../engine/portfolio/measures';
import {
  distributionMarginal,
  marginalMean,
  marginalQuantile,
  marginalRisk,
  marginalSd,
  sampleMarginal,
  type Marginal,
} from '../../engine/portfolio/marginal';
import { compareDependenceAssumptions, type AggregateRiskResult } from '../../engine/portfolio/aggregate';
import {
  SHAPLEY_MAX_EXPOSURES,
  componentValueAtRisk,
  eulerAllocation,
  gaussianEulerAllocation,
  incrementalRiskContributions,
  makeScenarioSet,
  portfolioLosses,
  shapleyAllocation,
  type ScenarioSet,
} from '../../engine/portfolio/allocation';
import {
  analyticEfficientFrontier,
  estimateMoments,
  estimationErrorStudy,
  ledoitWolfShrinkage,
  minimumCvarPortfolio,
  riskParityPortfolio,
  type EstimationErrorStudy,
} from '../../engine/portfolio/optimise';
import {
  backtestVar,
  cornishFisherQuantiles,
  drawdownAnalysis,
  reverseStressScenarios,
  reverseStressTest,
  scenarioAggregationSteps,
  stressTest,
  type ScenarioRiskResult,
  type Shock,
} from '../../engine/portfolio/scenario';
import { Badge, Button, Card, DataTable, Disclosure, KeyValueList, Notice, NumberField, RawNumberInput, RunningState, SelectField, TextField } from '../../ui/primitives';
import { LineChart } from '../../ui/charts/charts';
import { FrontierChart, StepChart } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------------ config */

export interface PortfolioExposureConfig {
  id: string;
  label: string;
  /** Distribution registry id for the marginal loss of this exposure. */
  distributionId: string;
  params: Record<string, number>;
  /** Multiplies the marginal, i.e. how much of this exposure is held. */
  scale: number;
}

export interface PortfolioConfig {
  exposures: PortfolioExposureConfig[];
  /** Optional pasted scenario matrix: one scenario per line, one column per exposure. */
  scenarioText: string;
  /** Confidence levels reported in the tables. */
  levels: number[];
  /** Off-diagonal entry of the equicorrelation matrix used for the Gaussian copula. */
  correlation: number;
  /** Trials for the copula simulation. */
  copulaTrials: number;
  /** Lattice cells per smallest marginal standard deviation for the exact independent convolution. */
  latticeResolution: number;
  /** Scenarios drawn for the allocation, stress and optimisation panels. */
  scenarioCount: number;
  seed: string;
  unit: string;
  /** Risk measure used for allocation and stress testing. */
  measureId: string;
  riskFreeRate: number;
  /** Reverse stress testing: the loss whose most plausible cause is sought. */
  targetLoss: number;
  resamples: number;
  stressVolatilityMultiplier: number;
  stressCorrelation: number;
  /** Gates for the expensive panels; see the module comment. */
  runScenarioAggregation: boolean;
  runShapley: boolean;
  runFrontier: boolean;
  runEstimationStudy: boolean;
}

/**
 * Three positively correlated, differently shaped loss exposures. The default
 * is chosen so the headline panel is immediately interesting: the unknown
 * dependence bounds are several times as wide as the gap between the
 * independent and comonotonic figures, which is the point of the screen.
 */
export const PORTFOLIO_DEFAULT: PortfolioConfig = {
  exposures: [
    { id: 'x1', label: 'Trading book', distributionId: 'lognormal', params: { mu: 3, sigma: 0.9 }, scale: 1 },
    { id: 'x2', label: 'Credit book', distributionId: 'gamma', params: { k: 2, theta: 12 }, scale: 1 },
    { id: 'x3', label: 'Operational', distributionId: 'weibull', params: { k: 0.9, lambda: 18 }, scale: 1 },
  ],
  scenarioText: '',
  levels: [0.95, 0.99],
  correlation: 0.45,
  copulaTrials: 20000,
  latticeResolution: 40,
  scenarioCount: 1500,
  seed: 'portfolio-1',
  unit: 'GBP',
  measureId: 'es',
  riskFreeRate: 0,
  targetLoss: 400,
  resamples: 200,
  stressVolatilityMultiplier: 1.5,
  stressCorrelation: 0.95,
  runScenarioAggregation: false,
  runShapley: false,
  runFrontier: false,
  runEstimationStudy: false,
};

/* ----------------------------------------------------------------- helpers */

/** Levels the dependence chart is drawn at, in addition to the reported ones. */
const CHART_LEVELS = [0.8, 0.9, 0.95, 0.975, 0.99, 0.995];

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Engine failures are shown, never swallowed; anything else is a real bug and rethrows. */
function attempt<T>(f: () => T): Attempt<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Drive one of the engine's generators in chunks. The `setTimeout` between
 * `next()` calls hands control back to the event loop, which is the only way
 * the Cancel button can be clicked — the same reason the engine's runner
 * yields between chunks of trials.
 */
function driveGenerator<R>(
  gen: Generator<number, R, void>,
  handlers: { onProgress(fraction: number): void; onDone(result: R): void; onError(error: unknown): void },
): () => void {
  let cancelled = false;
  const tick = (): void => {
    if (cancelled) return;
    try {
      const step = gen.next();
      if (step.done) {
        handlers.onDone(step.value);
        return;
      }
      handlers.onProgress(step.value);
      window.setTimeout(tick, 0);
    } catch (e) {
      handlers.onError(e);
    }
  };
  window.setTimeout(tick, 0);
  return () => {
    cancelled = true;
  };
}

function equicorrelation(d: number, rho: number): Matrix {
  return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : rho)));
}

/** Parse a pasted scenario matrix. Returns null when nothing has been pasted. */
function parseMatrix(text: string): number[][] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return lines.map((line) =>
    line
      .split(/[,;\t ]+/)
      .filter(Boolean)
      .map(Number),
  );
}

const YES_NO = (v: boolean) => (v ? 'yes' : 'no');

/** Row shapes for the two tables whose columns are built from the exposure list. */
interface WeightRow {
  label: string;
  weights: number[];
}
interface ContributionRow {
  index: number;
  loss: number;
  contributions: number[];
}

/* --------------------------------------------------------------- component */

export function PortfolioTool({ config }: { config: PortfolioConfig }) {
  const app = useApp();
  const set = (patch: Partial<PortfolioConfig>) => app.updateConfig({ ...config, ...patch });

  // Scenario aggregation runs through the engine's generator, so its state
  // lives here rather than in a memo.
  const cancelRef = useRef<(() => void) | null>(null);
  const [aggStatus, setAggStatus] = useState<'idle' | 'running'>('idle');
  const [aggProgress, setAggProgress] = useState(0);
  const [aggResult, setAggResult] = useState<ScenarioRiskResult | null>(null);
  const [aggError, setAggError] = useState<string | null>(null);
  // A run left in flight would keep computing a result nothing will display.
  useEffect(() => () => cancelRef.current?.(), []);

  const parameterIssues = useMemo(() => {
    const out: string[] = [];
    for (const e of config.exposures) {
      const def = attempt(() => getDistribution(e.distributionId));
      if (!def.ok) {
        out.push(`${e.label}: ${def.error}`);
        continue;
      }
      out.push(...validateParams(def.value, e.params).map((i) => `${e.label}: ${i.message}`));
      if (!(e.scale > 0)) out.push(`${e.label}: the exposure size must be greater than 0.`);
    }
    if (config.exposures.length < 2) out.push('A portfolio needs at least two exposures; with one there is no dependence to discuss.');
    return out;
  }, [config.exposures]);

  const pastedMatrix = useMemo(() => parseMatrix(config.scenarioText), [config.scenarioText]);

  /**
   * The marginals. A pasted matrix replaces the distributions entirely: each
   * column becomes an empirical marginal, so nothing about the shape of the
   * losses is assumed.
   */
  const marginals = useMemo<Attempt<Marginal[]>>(() => {
    if (pastedMatrix) {
      return attempt(() => {
        const d = pastedMatrix[0].length;
        return Array.from({ length: d }, (_, i) =>
          sampleMarginal(config.exposures[i]?.label ?? `Exposure ${i + 1}`, pastedMatrix.map((row) => {
            const v = row[i];
            if (!Number.isFinite(v)) throw new EngineError(`The pasted matrix has a missing or non-numeric entry in column ${i + 1}.`, 'finite');
            return v;
          })),
        );
      });
    }
    if (parameterIssues.length) return { ok: false, error: parameterIssues[0] };
    return attempt(() => config.exposures.map((e) => distributionMarginal(e.label, e.distributionId, e.params, e.scale)));
  }, [pastedMatrix, config.exposures, parameterIssues]);

  const marginalList = marginals.ok ? marginals.value : null;

  const perExposure = useMemo(() => {
    if (!marginalList) return null;
    const level = config.levels[0] ?? 0.95;
    return attempt(() =>
      marginalList.map((m) => ({
        label: m.label,
        mean: marginalMean(m),
        sd: marginalSd(m),
        risk: marginalRisk(m, level),
      })),
    );
  }, [marginalList, config.levels]);

  /** The registry drives this table; nothing about the measures is hardcoded here. */
  const measureCatalogue = useMemo(
    () =>
      RISK_MEASURES.map((def) => ({
        def,
        measure: attempt<RiskMeasure>(() => getRiskMeasure(def.id)),
      })),
    [],
  );

  const selectedMeasure = useMemo(() => attempt(() => getRiskMeasure(config.measureId)), [config.measureId]);

  /* ------------------------------------------------- dependence comparison */

  const chartLevels = useMemo(
    () => [...new Set([...config.levels, ...CHART_LEVELS])].filter((l) => l > 0 && l < 1).sort((a, b) => a - b),
    [config.levels],
  );

  const comparison = useMemo(() => {
    if (!marginalList) return null;
    return attempt(() =>
      compareDependenceAssumptions(marginalList, chartLevels, {
        correlation: equicorrelation(marginalList.length, config.correlation),
        trials: config.copulaTrials,
        seed: config.seed,
        independence: { resolution: config.latticeResolution },
      }),
    );
  }, [marginalList, chartLevels, config.correlation, config.copulaTrials, config.seed, config.latticeResolution]);

  const counterexample = useMemo(() => attempt(() => constructVarSubadditivityCounterexample({})), []);

  /* ------------------------------------------------------- scenario matrix */

  /**
   * A scenario matrix is needed for allocation, stress testing and
   * optimisation, which are all defined on joint outcomes rather than on
   * marginals. When one has been pasted it is used as given; otherwise it is
   * drawn from the marginals above with a Gaussian copula at the stated
   * correlation, which is an assumption and is labelled as one everywhere it
   * is used.
   */
  const scenarios = useMemo(() => {
    if (!marginalList) return null;
    if (pastedMatrix) {
      return attempt(() => ({
        set: makeScenarioSet(pastedMatrix, marginalList.map((m) => m.label)),
        source: 'pasted' as const,
      }));
    }
    return attempt(() => {
      const d = marginalList.length;
      const corr = equicorrelation(d, config.correlation);
      const chol = choleskyWithCheck(corr);
      if (!chol.ok) {
        throw new EngineError(`An equicorrelation of ${config.correlation} is not a valid correlation matrix for ${d} exposures; it has a negative eigenvalue and cannot be simulated from.`, 'notPositiveDefinite');
      }
      const n = config.scenarioCount;
      if (!Number.isInteger(n) || n < 200) throw new EngineError('At least 200 scenarios are needed before any tail figure means anything.', 'range');
      const rng = new Random(new Xoshiro128(`${config.seed}-scenarios`));
      const rows: number[][] = [];
      const z = new Float64Array(d);
      for (let s = 0; s < n; s++) {
        for (let i = 0; i < d; i++) z[i] = rng.normal();
        const row = new Array<number>(d).fill(0);
        for (let i = 0; i < d; i++) {
          let acc = 0;
          for (let j = 0; j <= i; j++) acc += chol.L[i][j] * z[j];
          // Clamped off 0 and 1 because a heavy-tailed quantile at exactly 1 is infinite.
          const u = Math.min(1 - 1e-12, Math.max(1e-12, normalCdf(acc)));
          row[i] = marginalQuantile(marginalList[i], u);
        }
        rows.push(row);
      }
      return { set: makeScenarioSet(rows, marginalList.map((m) => m.label)), source: 'simulated' as const };
    });
  }, [marginalList, pastedMatrix, config.correlation, config.scenarioCount, config.seed]);

  const scenarioSet: ScenarioSet | null = scenarios?.ok ? scenarios.value.set : null;
  /** One unit of each exposure; the size of an exposure is set in the table above. */
  const weights = useMemo(() => (scenarioSet ? scenarioSet.labels.map(() => 1) : []), [scenarioSet]);

  const allocation = useMemo(() => {
    if (!scenarioSet || !selectedMeasure.ok) return null;
    const level = config.levels[0] ?? 0.95;
    return {
      euler: attempt(() => eulerAllocation(scenarioSet, weights, selectedMeasure.value)),
      componentVar: attempt(() => componentValueAtRisk(scenarioSet, weights, level)),
      incremental: attempt(() => incrementalRiskContributions(scenarioSet, weights, selectedMeasure.value)),
    };
  }, [scenarioSet, weights, selectedMeasure, config.levels]);

  const shapley = useMemo(() => {
    if (!config.runShapley || !scenarioSet || !selectedMeasure.ok) return null;
    return attempt(() => shapleyAllocation(scenarioSet, weights, selectedMeasure.value));
  }, [config.runShapley, scenarioSet, weights, selectedMeasure]);

  /* ------------------------------------------------------------ moments */

  /** Returns are the negatives of the losses: losing x is a return of −x. */
  const returns = useMemo(() => (scenarioSet ? scenarioSet.scenarios.map((row) => row.map((v) => -v)) : null), [scenarioSet]);

  const moments = useMemo(() => (returns ? attempt(() => estimateMoments(returns)) : null), [returns]);

  const gaussianAllocation = useMemo(() => {
    if (!moments?.ok) return null;
    const level = config.levels[0] ?? 0.95;
    const d = moments.value.mean.length;
    // The covariance is of returns; losses are their negatives, so the loss
    // means are the negated return means and the covariance is unchanged.
    return attempt(() => gaussianEulerAllocation(moments.value.covariance, new Array<number>(d).fill(1), moments.value.mean.map((m) => -m), level));
  }, [moments, config.levels]);

  const optimisation = useMemo(() => {
    if (!config.runFrontier || !moments?.ok || !returns) return null;
    const level = config.levels[0] ?? 0.95;
    return {
      frontier: attempt(() => analyticEfficientFrontier(moments.value.mean, moments.value.covariance, { points: 40, riskFreeRate: config.riskFreeRate })),
      cvar: attempt(() => minimumCvarPortfolio(returns, level, {})),
      parity: attempt(() => riskParityPortfolio(moments.value.covariance)),
      shrinkage: attempt(() => ledoitWolfShrinkage(returns)),
    };
  }, [config.runFrontier, config.riskFreeRate, config.levels, moments, returns]);

  const study = useMemo<Attempt<EstimationErrorStudy> | null>(() => {
    if (!config.runEstimationStudy || !returns) return null;
    return attempt(() => estimationErrorStudy(returns, { resamples: config.resamples, seed: config.seed, riskFreeRate: config.riskFreeRate, withShrinkage: true }));
  }, [config.runEstimationStudy, returns, config.resamples, config.seed, config.riskFreeRate]);

  /* --------------------------------------------------- stress and backtest */

  const stress = useMemo(() => {
    if (!scenarioSet || !selectedMeasure.ok || !perExposure?.ok) return null;
    const d = scenarioSet.labels.length;
    const shocks: Shock[] = [
      { label: 'Expected loss up by one standard deviation', meanShift: perExposure.value.map((e) => e.sd) },
      { label: `Volatility multiplied by ${config.stressVolatilityMultiplier}`, volatilityMultiplier: new Array<number>(d).fill(config.stressVolatilityMultiplier) },
      { label: `Correlation forced to ${config.stressCorrelation}`, correlation: equicorrelation(d, config.stressCorrelation), seed: `${config.seed}-stress` },
    ];
    const level = config.levels[0] ?? 0.95;
    return attempt(() => stressTest(scenarioSet, weights, shocks, [selectedMeasure.value, getRiskMeasure('var', { level })]));
  }, [scenarioSet, weights, selectedMeasure, perExposure, config.stressVolatilityMultiplier, config.stressCorrelation, config.seed, config.levels]);

  const reverse = useMemo(() => {
    if (!moments?.ok || !scenarioSet) return null;
    const d = moments.value.mean.length;
    return {
      factor: attempt(() => reverseStressTest(new Array<number>(d).fill(1), moments.value.covariance, config.targetLoss)),
      closest: attempt(() => reverseStressScenarios(scenarioSet, weights, config.targetLoss, 5)),
    };
  }, [moments, scenarioSet, weights, config.targetLoss]);

  const pathAnalysis = useMemo(() => {
    if (!scenarioSet) return null;
    const losses = portfolioLosses(scenarioSet, weights);
    const take = Math.min(losses.length, 500);
    const path: number[] = [];
    let acc = 0;
    for (let i = 0; i < take; i++) {
      acc -= losses[i];
      path.push(acc);
    }
    const level = config.levels[0] ?? 0.95;
    const sorted = Float64Array.from(losses).sort();
    const forecast = sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(level * sorted.length) - 1))];
    return {
      drawdown: attempt(() => drawdownAnalysis(path, { relative: false, level })),
      backtest: attempt(() => backtestVar(Array.from(losses.slice(0, take)), new Array<number>(take).fill(forecast), level)),
      forecast,
      observations: take,
      path,
    };
  }, [scenarioSet, weights, config.levels]);

  /** Cornish–Fisher is refused outside its monotonicity domain; the refusal is the result. */
  const cornishFisher = useMemo(() => {
    if (!scenarioSet) return null;
    const losses = portfolioLosses(scenarioSet, weights);
    const n = losses.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += losses[i] / n;
    let m2 = 0;
    let m3 = 0;
    let m4 = 0;
    for (let i = 0; i < n; i++) {
      const dv = losses[i] - mean;
      m2 += (dv * dv) / n;
      m3 += (dv * dv * dv) / n;
      m4 += (dv * dv * dv * dv) / n;
    }
    const sd = Math.sqrt(m2);
    const skew = m2 > 0 ? m3 / m2 ** 1.5 : 0;
    const kurt = m2 > 0 ? m4 / (m2 * m2) - 3 : 0;
    return { moments: { mean, sd, skew, kurt }, result: attempt(() => cornishFisherQuantiles(mean, sd, skew, kurt, config.levels)) };
  }, [scenarioSet, weights, config.levels]);

  /* ------------------------------------------------------------ actions */

  const runAggregation = () => {
    if (!scenarioSet) return;
    cancelRef.current?.();
    setAggError(null);
    setAggResult(null);
    setAggProgress(0);
    setAggStatus('running');
    const gen = scenarioAggregationSteps(scenarioSet, weights, config.levels, {
      source: pastedMatrix ? 'historical' : 'monteCarlo',
      chunkSize: 2048,
    });
    cancelRef.current = driveGenerator(gen, {
      onProgress: (f) => setAggProgress(f),
      onDone: (r) => {
        setAggResult(r);
        setAggStatus('idle');
      },
      onError: (e) => {
        if (!(e instanceof EngineError)) throw e;
        setAggError(e.message);
        setAggStatus('idle');
      },
    });
  };

  const cancelAggregation = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setAggStatus('idle');
  };

  const unit = config.unit;
  const reportedLevel = config.levels[0] ?? 0.95;
  const unknown = comparison?.ok ? comparison.value.results.find((r) => r.dependenceKind === 'unknown') ?? null : null;

  /** Built entirely from the engine's own method, note and limitation strings. */
  const explanation = useMemo<Explanation | null>(() => {
    if (!comparison?.ok) return null;
    const results = comparison.value.results;
    const row = (r: AggregateRiskResult) => r.rows[chartLevels.indexOf(reportedLevel)] ?? r.rows[0];
    return {
      method: results.map((r) => `${r.dependenceKind}: ${r.method}`).join(' '),
      steps: results.map((r) => ({
        label: `${r.dependenceAssumption.split(':')[0]} — aggregate Value at Risk at ${formatPercent(reportedLevel, 4)}`,
        expression: r.dependenceAssumption,
        value:
          row(r).valueAtRisk === null
            ? `bounded between ${formatValue(row(r).varBounds.lower)} and ${formatValue(row(r).varBounds.upper)} ${unit}`
            : `${formatValue(row(r).valueAtRisk as number)} ${unit}`,
      })),
      assumptions: results.map((r) => r.dependenceAssumption),
      limitations: [...new Set(results.flatMap((r) => r.limitations))],
      exactness: results.some((r) => r.exactness === 'empirical') ? 'empirical' : 'numerical',
    };
  }, [comparison, chartLevels, reportedLevel, unit]);

  return (
    <>
      <ToolHeader toolId="portfolio" />
      <div className="oc-stack">
        {/* ------------------------------------------------------ exposures */}
        <Card title="Exposures" hint="Each exposure is a loss distribution. The size multiplies it; the portfolio holds one unit of each exposure as configured.">
          {parameterIssues.length > 0 && <Notice tone="error" title="The exposures are not configured correctly" items={parameterIssues} />}
          {pastedMatrix && (
            <Notice tone="info" title="A pasted scenario matrix is in use">
              <p style={{ margin: 0 }}>
                Every marginal below comes from a column of the pasted matrix as an empirical distribution, and the joint dependence is whatever is in the
                rows. The distributions and sizes in the table are not used while a matrix is pasted.
              </p>
            </Notice>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="oc-table">
              <caption className="sr-only">Exposures, their marginal distributions and parameters</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Marginal distribution</th>
                  <th scope="col">Parameters</th>
                  <th scope="col">Size</th>
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {config.exposures.map((e, i) => {
                  const def = attempt(() => getDistribution(e.distributionId));
                  return (
                    <tr key={e.id}>
                      <td>
                        <TextField
                          label={`Name of exposure ${i + 1}`}
                          value={e.label}
                          onChange={(label) => set({ exposures: config.exposures.map((x) => (x.id === e.id ? { ...x, label } : x)) })}
                          maxLength={32}
                        />
                      </td>
                      <td>
                        <SelectField
                          label={`Distribution for ${e.label}`}
                          value={e.distributionId}
                          onChange={(distributionId) =>
                            set({
                              exposures: config.exposures.map((x) =>
                                x.id === e.id ? { ...x, distributionId, params: { ...defaultParams(getDistribution(distributionId)) } } : x,
                              ),
                            })
                          }
                          options={DISTRIBUTIONS.filter((d) => d.kind === 'continuous').map((d) => ({ value: d.id, label: d.name }))}
                        />
                      </td>
                      <td>
                        {def.ok ? (
                          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                            {def.value.params.map((spec) => (
                              <label key={spec.key} className="oc-field__label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span aria-hidden="true">{spec.symbol ?? spec.key}</span>
                                <RawNumberInput
                                  ariaLabel={`${spec.label} of ${e.label}`}
                                  value={e.params[spec.key] ?? spec.defaultValue}
                                  onChange={(v) =>
                                    set({ exposures: config.exposures.map((x) => (x.id === e.id ? { ...x, params: { ...x.params, [spec.key]: v } } : x)) })
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        ) : (
                          <span>{def.error}</span>
                        )}
                      </td>
                      <td>
                        <RawNumberInput
                          ariaLabel={`Size of ${e.label}`}
                          value={e.scale}
                          min={0}
                          onChange={(scale) => set({ exposures: config.exposures.map((x) => (x.id === e.id ? { ...x, scale } : x)) })}
                        />
                      </td>
                      <td>
                        <Button
                          icon="trash"
                          title={`Remove ${e.label}`}
                          disabled={config.exposures.length <= 2}
                          onClick={() => set({ exposures: config.exposures.filter((x) => x.id !== e.id) })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="oc-btn-row">
            <Button
              icon="plus"
              disabled={config.exposures.length >= 8}
              onClick={() =>
                set({
                  exposures: [
                    ...config.exposures,
                    {
                      id: `x${Date.now().toString(36)}`,
                      label: `Exposure ${config.exposures.length + 1}`,
                      distributionId: 'lognormal',
                      params: { ...defaultParams(getDistribution('lognormal')) },
                      scale: 1,
                    },
                  ],
                })
              }
            >
              Add an exposure
            </Button>
          </div>

          {perExposure?.ok && (
            <div style={{ overflowX: 'auto' }}>
              <DataTable
                caption="Marginal mean, standard deviation and risk of each exposure on its own"
                columns={[
                  { key: 'l', header: 'Exposure', render: (r) => r.label },
                  { key: 'm', header: `Mean (${unit})`, numeric: true, render: (r) => formatValue(r.mean) },
                  { key: 's', header: `Standard deviation (${unit})`, numeric: true, render: (r) => formatValue(r.sd) },
                  { key: 'v', header: `VaR ${formatPercent(reportedLevel, 4)}`, numeric: true, render: (r) => formatValue(r.risk.valueAtRisk) },
                  { key: 'e', header: `ES ${formatPercent(reportedLevel, 4)}`, numeric: true, render: (r) => formatValue(r.risk.expectedShortfall) },
                  { key: 'x', header: 'Exactness', render: (r) => <Badge variant={r.risk.exactness}>{r.risk.exactness}</Badge> },
                ]}
                rows={perExposure.value}
              />
            </div>
          )}
          {perExposure && !perExposure.ok && <Notice tone="error">{perExposure.error}</Notice>}
          {marginals.ok === false && <Notice tone="error">{marginals.error}</Notice>}

          <Disclosure title="Paste a scenario matrix instead">
            <TextField
              label="Scenario matrix"
              value={config.scenarioText}
              onChange={(scenarioText) => set({ scenarioText })}
              multiline
              rows={5}
              monospace
              placeholder={'120 40 15\n80 55 0\n...'}
              hint="One scenario per line, one column per exposure, separated by spaces or commas. Losses are positive. Leave empty to use the distributions above."
            />
          </Disclosure>

          <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <TextField label="Unit" value={config.unit} onChange={(u) => set({ unit: u })} maxLength={12} />
            <TextField label="Random seed" value={config.seed} onChange={(seed) => set({ seed })} maxLength={32} />
            <NumberField label="Dependence (equicorrelation) for the Gaussian copula" value={config.correlation} onChange={(correlation) => set({ correlation })} min={-0.99} max={0.99} step={0.05} />
            <NumberField label="Copula trials" value={config.copulaTrials} onChange={(copulaTrials) => set({ copulaTrials })} min={1000} max={400000} step={1000} integer />
            <NumberField label="Scenarios for allocation and optimisation" value={config.scenarioCount} onChange={(scenarioCount) => set({ scenarioCount })} min={200} max={20000} step={100} integer />
          </div>
        </Card>

        {/* -------------------------------------------------- risk measures */}
        <Card title="Risk measures" hint="Driven by the engine's measure registry: every measure the engine implements appears here with the axioms it actually satisfies.">
          <SelectField
            label="Measure used for allocation and stress testing"
            value={config.measureId}
            onChange={(measureId) => set({ measureId })}
            options={RISK_MEASURES.map((d) => ({ value: d.id, label: d.name }))}
            hint={RISK_MEASURES.find((d) => d.id === config.measureId)?.description}
          />
          <div style={{ overflowX: 'auto' }}>
            <DataTable
              caption="Coherence axioms, elicitability and backtestability of each risk measure"
              columns={[
                { key: 'n', header: 'Measure', render: (r) => r.def.name },
                { key: 'mo', header: 'Monotone', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.monotone) : '—') },
                { key: 'ti', header: 'Translation invariant', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.translationInvariant) : '—') },
                { key: 'ph', header: 'Positively homogeneous', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.positiveHomogeneous) : '—') },
                { key: 'sa', header: 'Subadditive', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.subadditive) : '—') },
                { key: 'cv', header: 'Convex', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.convex) : '—') },
                { key: 'ca', header: 'Comonotone additive', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.comonotoneAdditive) : '—') },
                { key: 'co', header: 'Coherent', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.axioms.coherent) : '—') },
                { key: 'el', header: 'Elicitable', render: (r) => (r.measure.ok ? YES_NO(r.measure.value.elicitable) : '—') },
              ]}
              rows={measureCatalogue}
            />
          </div>
          <p className="oc-chart-note">
            &ldquo;Coherent&rdquo; means monotone, translation invariant, positively homogeneous and subadditive together. &ldquo;Elicitable&rdquo; means the
            measure is the minimiser of some expected scoring function, which is what makes a direct backtest possible.
          </p>
          {measureCatalogue.map(({ def, measure }) => (
            <Disclosure key={def.id} title={`${def.name}: axioms, elicitability and backtesting`}>
              {measure.ok ? (
                <>
                  <p>{def.description}</p>
                  <ul>
                    {measure.value.axioms.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  <KeyValueList
                    items={[
                      { label: 'Elicitable', value: YES_NO(measure.value.elicitable) },
                      { label: 'Elicitability', value: measure.value.elicitabilityNote },
                      { label: 'Backtesting', value: measure.value.backtestNote },
                      { label: 'Parameters used', value: Object.entries(measure.value.params).map(([k, v]) => `${k} = ${formatValue(v)}`).join(', ') || 'none' },
                    ]}
                  />
                </>
              ) : (
                <Notice tone="error">{measure.error}</Notice>
              )}
            </Disclosure>
          ))}
        </Card>

        {/* ----------------------------------------------------- dependence */}
        <Card title="Dependence is the whole problem" hint="The same marginals, aggregated under every assumption the engine can apply — and under none.">
          {comparison && !comparison.ok && <Notice tone="error" title="The exposures could not be aggregated">{comparison.error}</Notice>}
          {comparison?.ok && (
            <>
              {(() => {
                const idx = chartLevels.indexOf(reportedLevel);
                const at = idx >= 0 ? idx : 0;
                const rows = comparison.value.results.map((r) => ({
                  assumption: r.dependenceAssumption.split(':')[0],
                  full: r.dependenceAssumption,
                  kind: r.dependenceKind,
                  row: r.rows[at],
                  exactness: r.exactness,
                }));
                return (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption={`Aggregate risk at ${formatPercent(reportedLevel, 4)} under each dependence assumption`}
                        columns={[
                          { key: 'a', header: 'Dependence assumption', render: (r) => r.assumption },
                          {
                            key: 'v',
                            header: `Aggregate VaR (${unit})`,
                            numeric: true,
                            render: (r) =>
                              r.row.valueAtRisk === null
                                ? `${formatValue(r.row.varBounds.lower)} to ${formatValue(r.row.varBounds.upper)} (bounds)`
                                : formatValue(r.row.valueAtRisk),
                          },
                          {
                            key: 'e',
                            header: `Aggregate ES (${unit})`,
                            numeric: true,
                            render: (r) =>
                              r.row.expectedShortfall === null
                                ? `${formatValue(r.row.esBounds.lower)} to ${formatValue(r.row.esBounds.upper)} (bounds)`
                                : formatValue(r.row.expectedShortfall),
                          },
                          { key: 's', header: `Σ of the parts, VaR (${unit})`, numeric: true, render: (r) => formatValue(r.row.sumOfMarginalVar) },
                          {
                            key: 'd',
                            header: 'Diversification benefit on VaR',
                            numeric: true,
                            render: (r) => (r.row.diversificationBenefitVar === null ? 'not a number — bounds only' : formatValue(r.row.diversificationBenefitVar)),
                          },
                          { key: 'x', header: 'Exactness', render: (r) => <Badge variant={r.exactness}>{r.exactness}</Badge> },
                        ]}
                        rows={rows}
                      />
                    </div>

                    {unknown && (
                      <Notice tone="warning" title="With unknown dependence the answer is a pair of bounds, not a number">
                        <p style={{ marginTop: 0 }}>
                          Aggregate Value at Risk at {formatPercent(reportedLevel, 4)} lies between{' '}
                          <strong>{formatValue(unknown.rows[at].varBounds.lower)}</strong> and <strong>{formatValue(unknown.rows[at].varBounds.upper)}</strong> {unit} over
                          every joint distribution with these marginals. That range is{' '}
                          {formatValue(unknown.rows[at].varBounds.upper - unknown.rows[at].varBounds.lower)} {unit} wide — usually far wider than people expect, and
                          it is the honest answer when the dependence is not known.
                        </p>
                        <ul style={{ marginBottom: 0 }}>
                          {unknown.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </Notice>
                    )}

                    <div style={{ overflowX: 'auto' }}>
                      <StepChart
                        title="Aggregate Value at Risk by confidence level and dependence assumption"
                        description="One series per dependence assumption. The dashed pair is the model-free bound when dependence is unknown; everything else lies inside it."
                        series={[
                          ...comparison.value.results
                            .filter((r) => r.dependenceKind !== 'unknown')
                            .map((r) => ({
                              label: r.dependenceAssumption.split(':')[0],
                              points: r.rows.flatMap((row) => (row.valueAtRisk === null ? [] : [{ x: row.level, y: row.valueAtRisk }])),
                            })),
                          ...(unknown
                            ? [
                                { label: 'Unknown dependence — upper bound', points: unknown.rows.map((row) => ({ x: row.level, y: row.varBounds.upper })), dashed: true },
                                { label: 'Unknown dependence — lower bound', points: unknown.rows.map((row) => ({ x: row.level, y: row.varBounds.lower })), dashed: true },
                              ]
                            : []),
                        ]}
                        xLabel="Confidence level"
                        yLabel={`Aggregate Value at Risk (${unit})`}
                        yDomain={[
                          Math.min(...(unknown ? unknown.rows.map((r) => r.varBounds.lower) : [0]), 0),
                          Math.max(...(unknown ? unknown.rows.map((r) => r.varBounds.upper) : [1])) * 1.05,
                        ]}
                        note="The series are also distinguished by dashing, so the bounds are identifiable without relying on colour."
                      />
                    </div>

                    <Notice tone={comparison.value.orderingHolds ? 'success' : 'error'} title={comparison.value.orderingHolds ? 'The ordering that must hold does hold' : 'The required ordering failed'}>
                      <p style={{ margin: 0 }}>{comparison.value.orderingNote}</p>
                    </Notice>

                    {rows.map((r) => (
                      <Disclosure key={r.kind} title={`${r.assumption}: what this figure assumes`}>
                        <p>{r.full}</p>
                        <KeyValueList
                          items={[
                            {
                              label: `Diversification benefit on ES at ${formatPercent(reportedLevel, 4)}`,
                              value:
                                r.row.diversificationBenefitEs === null
                                  ? 'Not a number: with unknown dependence only bounds exist, so no benefit can be measured.'
                                  : `${formatValue(r.row.diversificationBenefitEs)} ${unit}, measured under ${r.assumption}`,
                            },
                            {
                              label: 'Estimate precision (simulation only)',
                              value:
                                r.row.estimation === null
                                  ? 'Not a simulated figure, so it carries no sampling error.'
                                  : `${r.row.estimation.trials.toLocaleString('en-US')} trials, ${r.row.estimation.tailScenarioCount.toLocaleString('en-US')} in the tail; 95% interval for the VaR ESTIMATE ${
                                      r.row.estimation.varInterval95
                                        ? `${formatValue(r.row.estimation.varInterval95.low)} to ${formatValue(r.row.estimation.varInterval95.high)}`
                                        : 'not available'
                                    }`,
                            },
                          ]}
                        />
                        {r.row.warnings.length > 0 && <Notice tone="warning" items={r.row.warnings} />}
                      </Disclosure>
                    ))}
                  </>
                );
              })()}
            </>
          )}
        </Card>

        {/* ------------------------------------------------- subadditivity */}
        <Card title="Value at Risk is not subadditive — a constructed counterexample" hint="Computed by exact convolution of two two-point laws: nothing here is simulated.">
          {!counterexample.ok ? (
            <Notice tone="error">{counterexample.error}</Notice>
          ) : (
            (() => {
              const c = counterexample.value;
              return (
                <>
                  <p>{c.description}</p>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Value at Risk and Expected Shortfall of each exposure and of their independent sum"
                      columns={[
                        { key: 'q', header: 'Quantity', render: (r) => r.label },
                        { key: 'x', header: 'Exposure X', numeric: true, render: (r) => formatValue(r.x) },
                        { key: 'y', header: 'Exposure Y', numeric: true, render: (r) => formatValue(r.y) },
                        { key: 's', header: 'X + Y (independent)', numeric: true, render: (r) => formatValue(r.sum) },
                        { key: 'p', header: 'Σ of the parts', numeric: true, render: (r) => formatValue(r.parts) },
                        { key: 'v', header: 'Subadditive here?', render: (r) => r.verdict },
                      ]}
                      rows={[
                        {
                          label: `Value at Risk at ${formatPercent(c.level, 4)}`,
                          x: c.varX,
                          y: c.varY,
                          sum: c.varSum,
                          parts: c.varX + c.varY,
                          verdict: c.varSum > c.varX + c.varY ? `NO — violated by ${formatValue(c.varExcess)}` : 'yes',
                        },
                        {
                          label: `Expected Shortfall at ${formatPercent(c.level, 4)}`,
                          x: c.esX,
                          y: c.esY,
                          sum: c.esSum,
                          parts: c.esX + c.esY,
                          verdict: c.esSum <= c.esX + c.esY ? `yes — slack ${formatValue(c.esSlack)}` : 'NO',
                        },
                      ]}
                    />
                  </div>
                  <Notice tone={c.verified ? 'success' : 'error'} title={c.verified ? 'Verified on screen' : 'The construction did not verify'}>
                    <p style={{ marginTop: 0 }}>
                      {c.verified
                        ? `Each exposure alone has VaR ${formatValue(c.varX)}, while their sum has VaR ${formatValue(c.varSum)}. Diversifying across two independent exposures therefore appears to INCREASE measured risk by ${formatValue(c.varExcess)} — which is the central technical criticism of Value at Risk. Expected Shortfall on the same pair satisfies subadditivity with ${formatValue(c.esSlack)} to spare.`
                        : 'The engine reports that the inequalities did not come out as the construction requires. No conclusion is drawn from it.'}
                    </p>
                    <ul style={{ marginBottom: 0 }}>
                      {c.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </Notice>
                  <div style={{ overflowX: 'auto' }}>
                    <StepChart
                      title="Distribution function of one exposure and of the independent sum"
                      description="The two-point marginal and its exact convolution. The sum breaches the confidence level where the marginal does not."
                      series={[
                        {
                          label: 'One exposure',
                          points: Array.from(c.marginal.values, (v, i) => ({
                            x: v,
                            y: Array.from(c.marginal.probs).slice(0, i + 1).reduce((a, b) => a + b, 0),
                          })),
                        },
                        {
                          label: 'Independent sum',
                          points: Array.from(c.sum.values, (v, i) => ({
                            x: v,
                            y: Array.from(c.sum.probs).slice(0, i + 1).reduce((a, b) => a + b, 0),
                          })),
                          dashed: true,
                        },
                      ]}
                      xLabel="Loss"
                      yLabel="Probability of no more than this loss"
                      yDomain={[0, 1]}
                      referenceLines={[{ value: c.level, label: `α = ${formatPercent(c.level, 4)}`, axis: 'y' }]}
                      note="Read across at α: the level where each curve first reaches it is that distribution's Value at Risk."
                    />
                  </div>
                  <Badge variant={c.exactness}>{c.exactness}</Badge>
                </>
              );
            })()
          )}
        </Card>

        {/* ------------------------------------------------- scenario matrix */}
        <Card title="Scenario aggregation" hint="Portfolio risk measured on the joint scenarios rather than on the marginals.">
          {scenarios && !scenarios.ok && <Notice tone="error">{scenarios.error}</Notice>}
          {scenarioSet && (
            <>
              <p className="oc-chart-note">
                {scenarios?.ok && scenarios.value.source === 'pasted'
                  ? `${scenarioSet.scenarios.length.toLocaleString('en-US')} pasted scenarios over ${scenarioSet.labels.length} exposures. The dependence is whatever is in the rows.`
                  : `${scenarioSet.scenarios.length.toLocaleString('en-US')} scenarios drawn from the marginals above with a GAUSSIAN COPULA at equicorrelation ${config.correlation}. That copula is an assumption: it has no tail dependence, so joint extremes are rarer in these scenarios than under most alternatives.`}
              </p>
              {!config.runScenarioAggregation ? (
                <>
                  <Notice tone="info" title="Scenario aggregation is not run automatically">
                    <p style={{ marginTop: 0 }}>
                      Aggregating {scenarioSet.scenarios.length.toLocaleString('en-US')} scenarios and estimating the standard error of every figure is a full
                      pass over the matrix per level. It runs only when you ask for it, and it yields between chunks so it can be cancelled.
                    </p>
                    <p style={{ marginBottom: 0 }}>
                      At {formatPercent(config.levels[config.levels.length - 1] ?? 0.99, 4)} the tail holds about{' '}
                      {Math.round((1 - (config.levels[config.levels.length - 1] ?? 0.99)) * scenarioSet.scenarios.length)} scenarios, which is what the
                      Expected Shortfall estimate rests on.
                    </p>
                  </Notice>
                  <div className="oc-btn-row">
                    <Button icon="play" variant="primary" onClick={() => { set({ runScenarioAggregation: true }); }}>
                      Enable scenario aggregation
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="oc-btn-row">
                    <Button icon="play" variant="primary" disabled={aggStatus === 'running'} onClick={runAggregation}>
                      {aggResult ? 'Aggregate again' : 'Aggregate the scenarios'}
                    </Button>
                    <Button icon="x" onClick={() => set({ runScenarioAggregation: false })}>
                      Hide this panel
                    </Button>
                  </div>
                  {aggStatus === 'running' && (
                    <RunningState completed={Math.round(aggProgress * scenarioSet.scenarios.length)} total={scenarioSet.scenarios.length} unitLabel="scenarios" onCancel={cancelAggregation} />
                  )}
                  {aggError && <Notice tone="error" title="The aggregation was refused">{aggError}</Notice>}
                  {aggResult && (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <DataTable
                          caption="Portfolio risk from the scenarios, with the sampling uncertainty of each ESTIMATE shown separately"
                          columns={[
                            { key: 'l', header: 'Level', numeric: true, render: (r) => formatPercent(r.level, 4) },
                            { key: 'v', header: `VaR (${unit})`, numeric: true, render: (r) => formatValue(r.valueAtRisk) },
                            { key: 'e', header: `ES (${unit})`, numeric: true, render: (r) => formatValue(r.expectedShortfall) },
                            { key: 'n', header: 'Scenarios in the tail', numeric: true, render: (r) => r.tailScenarioCount.toLocaleString('en-US') },
                            {
                              key: 'ci',
                              header: '95% interval for the VaR estimate',
                              render: (r) => (r.varInterval95 ? `${formatValue(r.varInterval95.low)} to ${formatValue(r.varInterval95.high)}` : 'not available'),
                            },
                            {
                              key: 'cie',
                              header: '95% interval for the ES estimate',
                              render: (r) => (r.esInterval95 ? `${formatValue(r.esInterval95.low)} to ${formatValue(r.esInterval95.high)}` : 'not available'),
                            },
                          ]}
                          rows={aggResult.rows}
                        />
                      </div>
                      <KeyValueList
                        items={[
                          { label: 'Dependence assumption', value: aggResult.dependenceAssumption },
                          { label: 'Mean portfolio loss', value: `${formatValue(aggResult.mean)} ${unit}` },
                          { label: 'Standard deviation', value: `${formatValue(aggResult.standardDeviation)} ${unit}` },
                          { label: 'Worst scenario', value: `${formatValue(aggResult.worst)} ${unit}` },
                          { label: 'Exactness', value: <Badge variant={aggResult.exactness}>{aggResult.exactness}</Badge> },
                        ]}
                      />
                      <Notice tone="info" title="Two different statements">
                        <ul style={{ margin: 0 }}>
                          {aggResult.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </Notice>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </Card>

        {/* ----------------------------------------------------- allocation */}
        <Card title="Risk allocation" hint="Who owns the portfolio's risk. The defining property of an allocation is that it adds up to the total.">
          {!selectedMeasure.ok && <Notice tone="error">{selectedMeasure.error}</Notice>}
          {allocation && (
            <>
              {allocation.euler.ok ? (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption={`Euler (gradient) allocation of ${allocation.euler.value.measureName}`}
                      columns={[
                        { key: 'l', header: 'Exposure', render: (r) => r.label },
                        { key: 'c', header: `Component risk (${unit})`, numeric: true, render: (r) => formatValue(r.component) },
                        { key: 'm', header: 'Marginal risk ∂ρ/∂wᵢ', numeric: true, render: (r) => formatValue(r.marginal) },
                        { key: 's', header: 'Share of the total', numeric: true, render: (r) => formatPercent(r.share, 4) },
                      ]}
                      rows={allocation.euler.value.labels.map((label, i) => ({
                        label,
                        component: allocation.euler.ok ? allocation.euler.value.componentRisk[i] : NaN,
                        marginal: allocation.euler.ok ? allocation.euler.value.marginalRisk[i] : NaN,
                        share: allocation.euler.ok ? allocation.euler.value.share[i] : NaN,
                      }))}
                    />
                  </div>
                  <Notice tone={Math.abs(allocation.euler.value.residual) < 1e-8 ? 'success' : 'warning'} title="Does the allocation add up?">
                    <p style={{ margin: 0 }}>
                      Σ components = {formatValue(allocation.euler.value.sumOfComponents)} {unit}; total ={' '}
                      {formatValue(allocation.euler.value.total)} {unit}; residual = {formatValue(allocation.euler.value.residual)} {unit}. For a spectral
                      measure the decomposition is an identity, so the residual is floating-point noise and nothing else.
                    </p>
                  </Notice>
                </>
              ) : (
                <Notice tone="error" title="No Euler allocation for this measure">{allocation.euler.error}</Notice>
              )}

              {allocation.componentVar.ok && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption={`Component Value at Risk at ${formatPercent(allocation.componentVar.value.level, 4)}, raw and smoothed`}
                      columns={[
                        { key: 'l', header: 'Exposure', render: (r) => r.label },
                        { key: 'c', header: `Component VaR (${unit})`, numeric: true, render: (r) => formatValue(r.component) },
                        { key: 's', header: `Smoothed over nearby scenarios (${unit})`, numeric: true, render: (r) => formatValue(r.smoothed) },
                      ]}
                      rows={allocation.componentVar.value.labels.map((label, i) => ({
                        label,
                        component: allocation.componentVar.ok ? allocation.componentVar.value.componentRisk[i] : NaN,
                        smoothed: allocation.componentVar.ok ? allocation.componentVar.value.smoothed.componentRisk[i] : NaN,
                      }))}
                    />
                  </div>
                  <p className="oc-chart-note">
                    The raw component figures add to {formatValue(allocation.componentVar.value.sumOfComponents)} {unit} against a VaR of{' '}
                    {formatValue(allocation.componentVar.value.total)} {unit} (residual {formatValue(allocation.componentVar.value.residual)}); the smoothed
                    figures add to {formatValue(allocation.componentVar.value.smoothed.sumOfComponents)} {unit}, leaving a residual of{' '}
                    {formatValue(allocation.componentVar.value.smoothed.residual)} {unit} which is reported rather than rescaled away.
                  </p>
                  <Notice tone="warning" items={allocation.componentVar.value.notes} />
                </>
              )}
              {!allocation.componentVar.ok && <Notice tone="error">{allocation.componentVar.error}</Notice>}

              {allocation.incremental.ok && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Marginal (component) against incremental contributions — these answer different questions"
                      columns={[
                        { key: 'l', header: 'Exposure', render: (r) => r.label },
                        { key: 'm', header: `Marginal/component (${unit})`, numeric: true, render: (r) => (r.component === null ? '—' : formatValue(r.component)) },
                        { key: 'i', header: `Incremental: ρ(all) − ρ(without i) (${unit})`, numeric: true, render: (r) => formatValue(r.incremental) },
                      ]}
                      rows={allocation.incremental.value.labels.map((label, i) => ({
                        label,
                        component: allocation.incremental.ok ? allocation.incremental.value.component?.[i] ?? null : null,
                        incremental: allocation.incremental.ok ? allocation.incremental.value.incremental[i] : NaN,
                      }))}
                    />
                  </div>
                  <Notice tone="warning" title="Routinely conflated, and they are not the same thing">
                    <p style={{ marginTop: 0 }}>
                      The incremental contributions sum to {formatValue(allocation.incremental.value.sumOfIncremental)} {unit} against a total of{' '}
                      {formatValue(allocation.incremental.value.total)} {unit}: a gap of {formatValue(allocation.incremental.value.additivityGap)} {unit}. The
                      gap is not an error — it is what distinguishes the two quantities.
                    </p>
                    <ul style={{ marginBottom: 0 }}>
                      {allocation.incremental.value.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </Notice>
                </>
              )}

              {gaussianAllocation?.ok && (
                <Disclosure title="Closed-form Gaussian allocation, for comparison">
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Euler allocation under a joint normal model with the estimated covariance"
                      columns={[
                        { key: 'l', header: 'Exposure', render: (r) => r.label },
                        { key: 'sd', header: `Component standard deviation (${unit})`, numeric: true, render: (r) => formatValue(r.sd) },
                        { key: 'v', header: `Component VaR (${unit})`, numeric: true, render: (r) => formatValue(r.cvar) },
                        { key: 'e', header: `Component ES (${unit})`, numeric: true, render: (r) => formatValue(r.ces) },
                      ]}
                      rows={gaussianAllocation.value.labels.map((label, i) => ({
                        label,
                        sd: gaussianAllocation.ok ? gaussianAllocation.value.componentSd[i] : NaN,
                        cvar: gaussianAllocation.ok ? gaussianAllocation.value.componentVar[i] : NaN,
                        ces: gaussianAllocation.ok ? gaussianAllocation.value.componentEs[i] : NaN,
                      }))}
                    />
                  </div>
                  <p>{gaussianAllocation.value.method}</p>
                  <ul>
                    {gaussianAllocation.value.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Disclosure>
              )}
              {gaussianAllocation && !gaussianAllocation.ok && <Notice tone="error">{gaussianAllocation.error}</Notice>}

              {!config.runShapley ? (
                <>
                  <Notice tone="info" title="Shapley allocation is not run automatically">
                    <p style={{ margin: 0 }}>
                      The Shapley value evaluates the measure on every subset of exposures, so its cost is exponential: 2^{config.exposures.length} ={' '}
                      {2 ** config.exposures.length} subsets here, each a full pass over the scenario matrix. The engine refuses more than{' '}
                      {SHAPLEY_MAX_EXPOSURES} exposures outright.
                    </p>
                  </Notice>
                  <div className="oc-btn-row">
                    <Button icon="play" onClick={() => set({ runShapley: true })} disabled={!scenarioSet}>
                      Compute the Shapley allocation
                    </Button>
                  </div>
                </>
              ) : shapley?.ok ? (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption={`Shapley allocation of ${shapley.value.measureName} over ${shapley.value.subsetsEvaluated} subsets`}
                      columns={[
                        { key: 'l', header: 'Exposure', render: (r) => r.label },
                        { key: 's', header: `Shapley value (${unit})`, numeric: true, render: (r) => formatValue(r.value) },
                      ]}
                      rows={shapley.value.labels.map((label, i) => ({ label, value: shapley.ok ? shapley.value.shapley[i] : NaN }))}
                    />
                  </div>
                  <Notice tone={Math.abs(shapley.value.residual) < 1e-6 ? 'success' : 'warning'} title="Does it add up?">
                    <p style={{ margin: 0 }}>
                      Σ Shapley values = {formatValue(shapley.value.sumOfShapley)} {unit}; total = {formatValue(shapley.value.total)} {unit}; residual ={' '}
                      {formatValue(shapley.value.residual)} {unit}. Efficiency — adding up exactly to the total — is one of the axioms that define the Shapley
                      value, so a non-zero residual here would be numerical, not conceptual.
                    </p>
                  </Notice>
                  <ul>
                    {shapley.value.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  <div className="oc-btn-row">
                    <Button icon="x" onClick={() => set({ runShapley: false })}>Hide the Shapley allocation</Button>
                  </div>
                </>
              ) : (
                shapley && <Notice tone="error">{shapley.error}</Notice>
              )}
            </>
          )}
        </Card>

        {/* --------------------------------------------------- optimisation */}
        <Card title="Optimisation" hint="Mean–variance, mean–CVaR and risk parity — and then whether the optimum can be identified from the data at all.">
          {!config.runFrontier ? (
            <>
              <Notice tone="info" title="The frontier sweep is not run automatically">
                <p style={{ marginTop: 0 }}>
                  The sweep solves a quadratic programme at every point on the frontier and then minimises Expected Shortfall over{' '}
                  {config.scenarioCount.toLocaleString('en-US')} scenarios by subgradient descent with a pairwise refinement. The mean–CVaR solve alone takes a
                  couple of seconds at this scenario count and blocks the page while it runs, so it is run only when you ask for it.
                </p>
                <p style={{ marginBottom: 0 }}>The analytic frontier, risk parity and the Ledoit–Wolf shrinkage estimate are computed in the same pass.</p>
              </Notice>
              <NumberField label="Risk-free rate per period" value={config.riskFreeRate} onChange={(riskFreeRate) => set({ riskFreeRate })} step={0.001} />
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runFrontier: true })} disabled={!moments?.ok}>
                  Run the optimisation
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="oc-btn-row">
                <Button icon="x" onClick={() => set({ runFrontier: false })}>Hide the optimisation</Button>
              </div>
              {optimisation?.frontier.ok && moments?.ok && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <FrontierChart
                      title="Mean–variance efficient frontier"
                      description="The frontier in return space, with the minimum-variance and maximum-Sharpe portfolios and the capital market line."
                      frontier={optimisation.frontier.value.points.map((p) => ({ risk: p.standardDeviation, return: p.expectedReturn }))}
                      assets={moments.value.mean.map((m, i) => ({
                        risk: Math.sqrt(Math.max(0, moments.ok ? moments.value.covariance[i][i] : 0)),
                        return: m,
                        label: scenarioSet?.labels[i] ?? `Exposure ${i + 1}`,
                      }))}
                      highlights={[
                        { risk: optimisation.frontier.value.minimumVariance.standardDeviation, return: optimisation.frontier.value.minimumVariance.expectedReturn, label: 'Minimum variance' },
                        ...(optimisation.frontier.value.tangency
                          ? [{ risk: optimisation.frontier.value.tangency.standardDeviation, return: optimisation.frontier.value.tangency.expectedReturn, label: 'Maximum Sharpe (tangency)' }]
                          : []),
                      ]}
                      capitalMarketLine={
                        optimisation.frontier.value.capitalMarketLine && optimisation.frontier.value.tangency
                          ? {
                              riskFree: optimisation.frontier.value.capitalMarketLine.riskFreeRate,
                              tangencyRisk: optimisation.frontier.value.tangency.standardDeviation,
                              tangencyReturn: optimisation.frontier.value.tangency.expectedReturn,
                              label: 'Capital market line',
                            }
                          : null
                      }
                      note="Returns here are the negatives of the simulated losses, so an exposure with a large expected loss appears with a large negative return."
                    />
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Weights of the named portfolios"
                      columns={[
                        { key: 'p', header: 'Portfolio', render: (r) => r.label },
                        ...(scenarioSet?.labels ?? []).map((lab, i) => ({
                          key: `w${i}`,
                          header: lab,
                          numeric: true,
                          render: (r: WeightRow) => formatPercent(r.weights[i], 4),
                        })),
                      ]}
                      rows={[
                        { label: 'Minimum variance', weights: optimisation.frontier.value.minimumVariance.weights } satisfies WeightRow,
                        ...(optimisation.frontier.value.tangency ? [{ label: 'Maximum Sharpe', weights: optimisation.frontier.value.tangency.weights }] : []),
                        ...(optimisation.cvar.ok ? [{ label: `Minimum ES at ${formatPercent(optimisation.cvar.value.level, 4)}`, weights: optimisation.cvar.value.weights }] : []),
                        ...(optimisation.parity.ok ? [{ label: 'Risk parity', weights: optimisation.parity.value.weights }] : []),
                      ]}
                    />
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Frontier method', value: optimisation.frontier.value.method },
                      { label: 'Exactness of the frontier', value: <Badge variant={optimisation.frontier.value.exactness}>{optimisation.frontier.value.exactness}</Badge> },
                      ...(optimisation.cvar.ok
                        ? [
                            {
                              label: 'Minimum-ES portfolio',
                              value: `ES ${formatValue(optimisation.cvar.value.expectedShortfall)}, VaR ${formatValue(optimisation.cvar.value.valueAtRisk)}, driven by ${optimisation.cvar.value.tailScenarioCount} tail scenarios`,
                            },
                          ]
                        : [{ label: 'Minimum-ES portfolio', value: `refused: ${optimisation.cvar.error}` }]),
                      ...(optimisation.parity.ok
                        ? [
                            {
                              label: 'Risk parity',
                              value: `largest deviation from an equal risk share ${formatPercent(optimisation.parity.value.maximumShareDeviation, 3)} after ${optimisation.parity.value.iterations} iterations (${optimisation.parity.value.converged ? 'converged' : 'did not converge'})`,
                            },
                          ]
                        : []),
                      ...(optimisation.shrinkage.ok
                        ? [{ label: 'Ledoit–Wolf shrinkage intensity', value: formatPercent(optimisation.shrinkage.value.intensity, 4) }]
                        : []),
                    ]}
                  />
                  <Notice tone="warning" items={optimisation.frontier.value.notes} />
                </>
              )}
              {optimisation && !optimisation.frontier.ok && <Notice tone="error" title="The frontier could not be computed">{optimisation.frontier.error}</Notice>}

              {/* ------------------------------------------- error maximiser */}
              <NumberField label="Resamples for the estimation-error study" value={config.resamples} onChange={(resamples) => set({ resamples })} min={10} max={2000} step={10} integer />
              {!config.runEstimationStudy ? (
                <>
                  <Notice tone="info" title="The estimation-error study is not run automatically">
                    <p style={{ margin: 0 }}>
                      The study resamples the return history {config.resamples} times, re-estimates μ and Σ, and re-optimises each time — with and without
                      Ledoit–Wolf shrinkage. That is {config.resamples * 2} optimisations, which takes long enough to be worth asking for.
                    </p>
                  </Notice>
                  <div className="oc-btn-row">
                    <Button icon="play" onClick={() => set({ runEstimationStudy: true })}>Run the estimation-error study</Button>
                  </div>
                </>
              ) : study?.ok ? (
                <>
                  <Notice tone="warning" title="Mean–variance optimisation is an error maximiser">
                    <p style={{ margin: 0 }}>{study.value.verdict}</p>
                  </Notice>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Dispersion of the optimal weight across resamples, with and without shrinkage"
                      columns={[
                        { key: 'l', header: 'Exposure', render: (r) => r.label },
                        { key: 'b', header: 'Weight on the full sample', numeric: true, render: (r) => formatPercent(r.base, 4) },
                        { key: 'm', header: 'Mean resampled weight', numeric: true, render: (r) => formatPercent(r.mean, 4) },
                        { key: 's', header: 'Standard deviation of the weight', numeric: true, render: (r) => formatPercent(r.sd, 4) },
                        { key: 'i', header: '5th to 95th percentile', render: (r) => `${formatPercent(r.low, 3)} to ${formatPercent(r.high, 3)}` },
                        { key: 'sh', header: 'Standard deviation with shrinkage', numeric: true, render: (r) => (r.shrunkSd === null ? '—' : formatPercent(r.shrunkSd, 4)) },
                      ]}
                      rows={(scenarioSet?.labels ?? []).map((label, i) => ({
                        label,
                        base: study.ok ? study.value.baseWeights[i] : NaN,
                        mean: study.ok ? study.value.meanWeights[i] : NaN,
                        sd: study.ok ? study.value.weightStandardDeviation[i] : NaN,
                        low: study.ok ? study.value.weightInterval[i].low : NaN,
                        high: study.ok ? study.value.weightInterval[i].high : NaN,
                        shrunkSd: study.ok ? study.value.shrunk?.weightStandardDeviation[i] ?? null : null,
                      }))}
                    />
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Resamples used', value: `${study.value.resamples} (${study.value.skipped} skipped as infeasible)` },
                      { label: 'Mean absolute deviation from the full-sample weights', value: formatPercent(study.value.meanAbsoluteDeviation, 4) },
                      {
                        label: 'With Ledoit–Wolf shrinkage',
                        value: study.value.shrunk
                          ? `mean absolute deviation ${formatPercent(study.value.shrunk.meanAbsoluteDeviation, 4)} at an average shrinkage intensity of ${formatPercent(study.value.shrunk.averageIntensity, 3)}`
                          : 'not computed',
                      },
                      { label: 'Dispersion reduction from shrinkage', value: study.value.dispersionReduction === null ? 'not available' : formatPercent(study.value.dispersionReduction, 4) },
                      { label: 'Exactness', value: <Badge variant={study.value.exactness}>{study.value.exactness}</Badge> },
                    ]}
                  />
                  <div style={{ overflowX: 'auto' }}>
                    <LineChart
                      title="How far the optimal weights move when the data are resampled"
                      description="For each exposure, the full-sample optimal weight and the 5th-to-95th percentile range of that weight across resamples."
                      series={[
                        { label: 'Full-sample optimum', points: study.value.baseWeights.map((w, i) => ({ x: i + 1, y: w })) },
                        { label: '5th percentile across resamples', points: study.value.weightInterval.map((b, i) => ({ x: i + 1, y: b.low })), dashed: true },
                        { label: '95th percentile across resamples', points: study.value.weightInterval.map((b, i) => ({ x: i + 1, y: b.high })), dashed: true },
                      ]}
                      xLabel="Exposure number"
                      yLabel="Weight"
                      note="A band this wide means the optimal portfolio is not identifiable from this much data. Showing that is more useful than reporting the point optimum alone."
                    />
                  </div>
                  <ul>
                    {study.value.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  <div className="oc-btn-row">
                    <Button icon="x" onClick={() => set({ runEstimationStudy: false })}>Hide the study</Button>
                  </div>
                </>
              ) : (
                study && <Notice tone="error">{study.error}</Notice>
              )}
            </>
          )}
        </Card>

        {/* ------------------------------------------ stress and backtesting */}
        <Card title="Stress and backtesting" hint="Named shocks, the scenario behind a given loss, drawdowns, and whether the Value at Risk model survives a backtest.">
          <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <NumberField label="Volatility multiplier in the stress" value={config.stressVolatilityMultiplier} onChange={(stressVolatilityMultiplier) => set({ stressVolatilityMultiplier })} min={0} max={10} step={0.1} />
            <NumberField label="Stressed correlation" value={config.stressCorrelation} onChange={(stressCorrelation) => set({ stressCorrelation })} min={-0.99} max={0.99} step={0.05} />
            <NumberField label={`Reverse stress target loss (${unit})`} value={config.targetLoss} onChange={(targetLoss) => set({ targetLoss })} />
          </div>

          {stress?.ok && (
            <div style={{ overflowX: 'auto' }}>
              <DataTable
                caption="Named shocks to the marginals and to the correlation"
                columns={[
                  { key: 's', header: 'Shock', render: (r) => r.label },
                  { key: 'm', header: 'Measure', render: (r) => r.measure },
                  { key: 'b', header: `Base (${unit})`, numeric: true, render: (r) => formatValue(r.base) },
                  { key: 'a', header: `Stressed (${unit})`, numeric: true, render: (r) => formatValue(r.stressed) },
                  { key: 'c', header: `Change (${unit})`, numeric: true, render: (r) => formatValue(r.change) },
                  { key: 'r', header: 'Relative change', numeric: true, render: (r) => (Number.isFinite(r.relative) ? formatPercent(r.relative, 3) : 'base is zero') },
                ]}
                rows={stress.value.flatMap((s) => Object.keys(s.base).map((measure) => ({
                  label: s.label,
                  measure,
                  base: s.base[measure],
                  stressed: s.stressed[measure],
                  change: s.change[measure],
                  relative: s.relativeChange[measure],
                })))}
              />
            </div>
          )}
          {stress?.ok && <Notice tone="info" items={[...new Set(stress.value.map((s) => s.description))]} />}
          {stress && !stress.ok && <Notice tone="error">{stress.error}</Notice>}

          {reverse?.factor.ok && (
            <>
              <h3>Reverse stress test</h3>
              <p>
                The most plausible way to lose {formatValue(config.targetLoss)} {unit}, under a joint normal factor model with the estimated covariance, is the
                shock below. Its distance from normal conditions is {formatValue(reverse.factor.value.mahalanobisDistance, 4)} standard deviations, which under
                that model has probability {formatPercent(reverse.factor.value.equivalentNormalProbability, 4)}.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="Smallest factor shock that produces the target loss"
                  columns={[
                    { key: 'l', header: 'Exposure', render: (r) => r.label },
                    { key: 's', header: `Shock (${unit})`, numeric: true, render: (r) => formatValue(r.shock) },
                  ]}
                  rows={(scenarioSet?.labels ?? []).map((label, i) => ({ label, shock: reverse.factor.ok ? reverse.factor.value.factorShock[i] : NaN }))}
                />
              </div>
              <Notice tone="warning" items={reverse.factor.value.notes} />
              <Badge variant={reverse.factor.value.exactness}>{reverse.factor.value.exactness}</Badge>
            </>
          )}
          {reverse && !reverse.factor.ok && <Notice tone="error" title="The reverse stress test was refused">{reverse.factor.error}</Notice>}
          {reverse?.closest.ok && scenarioSet && (
            <Disclosure title="The scenarios closest to that loss">
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="Scenarios whose portfolio loss is nearest the target, with each exposure's contribution"
                  columns={[
                    { key: 'i', header: 'Scenario', numeric: true, render: (r) => r.index + 1 },
                    { key: 'l', header: `Loss (${unit})`, numeric: true, render: (r) => formatValue(r.loss) },
                    ...scenarioSet.labels.map((lab, i) => ({
                      key: `c${i}`,
                      header: lab,
                      numeric: true,
                      render: (r: ContributionRow) => formatValue(r.contributions[i]),
                    })),
                  ]}
                  rows={reverse.closest.value.map((s): ContributionRow => ({ index: s.scenarioIndex, loss: s.loss, contributions: s.contributions }))}
                />
              </div>
            </Disclosure>
          )}

          {pathAnalysis?.drawdown.ok && (
            <>
              <h3>Drawdown statistics</h3>
              <KeyValueList
                items={[
                  { label: 'Maximum drawdown', value: `${formatValue(pathAnalysis.drawdown.value.maximumDrawdown)} ${unit}` },
                  { label: 'Average drawdown', value: `${formatValue(pathAnalysis.drawdown.value.averageDrawdown)} ${unit}` },
                  { label: `Conditional drawdown at risk at ${formatPercent(pathAnalysis.drawdown.value.level, 4)}`, value: `${formatValue(pathAnalysis.drawdown.value.conditionalDrawdownAtRisk)} ${unit}` },
                  { label: 'Longest drawdown duration', value: `${pathAnalysis.drawdown.value.longestDuration} periods` },
                  { label: 'Episodes', value: `${pathAnalysis.drawdown.value.episodes.length} (${pathAnalysis.drawdown.value.episodes.filter((e) => e.recovered).length} recovered)` },
                  { label: 'Exactness', value: <Badge variant={pathAnalysis.drawdown.value.exactness}>{pathAnalysis.drawdown.value.exactness}</Badge> },
                ]}
              />
              <p className="oc-chart-note">
                The path is the cumulative profit and loss of the first {pathAnalysis.observations.toLocaleString('en-US')} scenarios taken in draw order. It is a
                SIMULATED path from this model, not an observed history, so the drawdown figures describe the model and nothing else.
              </p>
              <ul>
                {pathAnalysis.drawdown.value.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          {pathAnalysis && !pathAnalysis.drawdown.ok && <Notice tone="error">{pathAnalysis.drawdown.error}</Notice>}

          {pathAnalysis?.backtest.ok && (
            <>
              <h3>Value at Risk backtests</h3>
              <p>
                A constant forecast of {formatValue(pathAnalysis.forecast)} {unit} — the model&rsquo;s own{' '}
                {formatPercent(pathAnalysis.backtest.value.level, 4)} quantile — is tested against the{' '}
                {pathAnalysis.backtest.value.observations.toLocaleString('en-US')} losses in the path above.
              </p>
              <KeyValueList
                items={[
                  { label: 'Exceptions observed', value: `${pathAnalysis.backtest.value.exceptions} against ${formatValue(pathAnalysis.backtest.value.kupiec.expectedExceptions, 4)} expected` },
                  { label: 'Kupiec unconditional coverage', value: `statistic ${formatValue(pathAnalysis.backtest.value.kupiec.statistic, 4)}, p = ${formatValue(pathAnalysis.backtest.value.kupiec.pValue, 4)} — ${pathAnalysis.backtest.value.kupiec.interpretation}` },
                  { label: 'Christoffersen independence', value: `p = ${formatValue(pathAnalysis.backtest.value.christoffersen.independencePValue, 4)}; conditional coverage p = ${formatValue(pathAnalysis.backtest.value.christoffersen.conditionalCoveragePValue, 4)} — ${pathAnalysis.backtest.value.christoffersen.interpretation}` },
                  { label: 'Basel traffic light', value: `${pathAnalysis.backtest.value.trafficLight.zone} zone — ${pathAnalysis.backtest.value.trafficLight.interpretation}` },
                ]}
              />
              <Notice tone="warning" title="What this backtest can and cannot establish">
                <p style={{ marginTop: 0 }}>
                  The forecast and the realised losses come from the same model, so these tests check internal consistency only. A VaR model is only genuinely
                  verified against data it did not see — but a model that is never backtested at all is an unverified claim, which is why the tests are shown
                  rather than described.
                </p>
                <ul style={{ marginBottom: 0 }}>
                  {pathAnalysis.backtest.value.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Notice>
              <div style={{ overflowX: 'auto' }}>
                <LineChart
                  title="Cumulative profit and loss of the simulated path"
                  description="The path the drawdown statistics are computed from."
                  series={[{ label: 'Cumulative profit and loss', points: pathAnalysis.path.map((v, i) => ({ x: i + 1, y: v })) }]}
                  xLabel="Period"
                  yLabel={`Cumulative profit and loss (${unit})`}
                />
              </div>
            </>
          )}
          {pathAnalysis && !pathAnalysis.backtest.ok && <Notice tone="error" title="The backtest was refused">{pathAnalysis.backtest.error}</Notice>}
        </Card>

        {/* ----------------------------------------------------- explanation */}
        <Card title="Explanation" hint="What each figure is, how exact it is, and the two statements this screen keeps apart.">
          {explanation && <ExplanationPanel explanation={explanation} />}
          <Notice tone="info" title="A risk measure and an estimate of it are different things">
            <p style={{ marginTop: 0 }}>
              <strong>The risk measure</strong> is a property of the loss distribution — a tail quantile for Value at Risk, a tail average for Expected
              Shortfall. It has no confidence interval: it is not a parameter being estimated from a sample, it is the number the distribution implies.
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong>A confidence interval for an estimated risk measure</strong> says how precisely a finite sample or simulation pins that number down. The
              scenario aggregation panel reports it separately for exactly that reason, and it is never shown as though it were a range of possible losses.
            </p>
          </Notice>

          {cornishFisher && (
            <>
              <h3>Cornish–Fisher from the first four moments</h3>
              <p className="oc-chart-note">
                Portfolio losses have mean {formatValue(cornishFisher.moments.mean)}, standard deviation {formatValue(cornishFisher.moments.sd)}, skewness{' '}
                {formatValue(cornishFisher.moments.skew, 4)} and excess kurtosis {formatValue(cornishFisher.moments.kurt, 4)}.
              </p>
              {cornishFisher.result.ok ? (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Cornish–Fisher quantiles against the normal quantiles with the same mean and standard deviation"
                      columns={[
                        { key: 'l', header: 'Level', numeric: true, render: (r) => formatPercent(r.level, 4) },
                        { key: 'c', header: `Cornish–Fisher (${unit})`, numeric: true, render: (r) => formatValue(r.value) },
                        { key: 'n', header: `Normal (${unit})`, numeric: true, render: (r) => formatValue(r.normalValue) },
                      ]}
                      rows={cornishFisher.result.value.quantiles}
                    />
                  </div>
                  <Notice tone="warning" items={cornishFisher.result.value.notes} />
                  <Badge variant={cornishFisher.result.value.exactness}>{cornishFisher.result.value.exactness}</Badge>
                </>
              ) : (
                <Notice tone="error" title="Cornish–Fisher is refused for these moments">
                  <p style={{ marginTop: 0 }}>{cornishFisher.result.error}</p>
                  <p style={{ marginBottom: 0 }}>
                    A refusal is the correct output here. Outside its monotonicity domain the expansion returns quantiles that fall as the confidence level
                    rises, which is not a distribution at all, so no number is reported in its place.
                  </p>
                </Notice>
              )}
            </>
          )}

          <AiAssistPanel
            capability="explainUncertainty"
            context="Every aggregate figure on this screen names the dependence assumption that produced it, and the unknown-dependence case gives bounds rather than a number. The confidence intervals shown describe the precision of an estimate, not the spread of outcomes."
          />
        </Card>
      </div>
    </>
  );
}
