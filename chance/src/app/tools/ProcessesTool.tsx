/**
 * Stochastic processes: probability evolving over time.
 *
 * The screen is ordered the way the engine is: closed forms first, because
 * they are instant and they are what makes a simulated ensemble checkable,
 * then the simulated paths, then the practical first-passage question.
 *
 * Nothing heavy runs before first paint. Every analytic result below is a
 * handful of floating-point operations (the CTMC occupancy curve is a few
 * dozen small matrix exponentials), while every ensemble of trajectories sits
 * behind a button and is driven as a cancellable generator — `ensembleSteps`
 * and friends yield between chunks, so the Cancel button can actually be
 * pressed. See `useGeneratorRun` below.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BranchingSimulationResult,
  type FirstPassageEstimate,
  type PathEnsemble,
  type ProcessDefinition,
  type Quantity,
  type RuinSimulationResult,
  ar1Conditional,
  ar1Stationary,
  branchingExpectedSize,
  branchingSimulationSteps,
  brownianFirstPassage,
  brownianMarginal,
  brownianMarginalSf,
  brownianRunningMaxSf,
  compoundPoissonMoments,
  ctmcHittingTimes,
  ctmcStateSummary,
  ctmcStationary,
  ctmcTransient,
  elementaryRenewalRate,
  ensembleSteps,
  extinctionProbability,
  fanChart,
  firstPassageFromEnsemble,
  gamblersRuin,
  gamblersRuinSimulationSteps,
  gbmFirstPassageProbability,
  gbmMarginal,
  gbmMarginalSf,
  getProcessDefinition,
  jumpDiffusionMean,
  jumpSamplerFromDistribution,
  nhppExpectedCount,
  ouMarginal,
  ouStationary,
  poissonCountSummary,
  poissonInterarrivalLaw,
  poissonWaitingTime,
  poissonOffspring,
  randomWalkMoments,
  sampleAr1Path,
  sampleBrownianPath,
  sampleCompoundPoissonPath,
  sampleGbmPath,
  sampleJumpDiffusionPath,
  sampleNhppCountPath,
  sampleOuPath,
  samplePoissonCountPath,
  sampleRandomWalkPath,
  sampleRenewalCountPath,
  PROCESS_DEFINITIONS,
  type PathSampler,
} from '../../engine/processes';
import { getDistribution } from '../../engine/distributions/registry';
import { EngineError, EXACTNESS_LABEL, type Explanation, type Exactness } from '../../engine/core/result';
import type { Matrix } from '../../engine/stats/linalg';
import type { Random } from '../../engine/random/rng';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Disclosure,
  EmptyState,
  KeyValueList,
  Notice,
  NumberField,
  RawNumberInput,
  RunningState,
  Segmented,
  SelectField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { Icon } from '../../ui/icons';
import { LineChart } from '../../ui/charts/charts';
import { FanChart } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel, AssumptionsPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';
import type { ReportSection, ReportTable, ToolReportContent } from '../../persistence/report';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * JSON-serialisable configuration: the process id, its numeric parameters,
 * the time grid, a seed and the per-panel display options. No functions, no
 * Maps, no `undefined` — this is persisted and re-validated on import.
 */
export interface ProcessesConfig {
  /** An id from the engine's `PROCESS_DEFINITIONS` catalogue. */
  processId: string;
  /** Parameter values keyed by the definition's `params[].key`. */
  params: Record<string, number>;
  horizon: number;
  gridPoints: number;
  paths: number;
  bandLevel: number;
  seed: string;
  passageLevel: number;
  passageDirection: 'above' | 'below';
  /** Gambler's ruin (random walk). */
  ruinStart: number;
  ruinTarget: number;
  ruinWalks: number;
  /** Galton–Watson branching, with a Poisson offspring law. */
  offspringMean: number;
  initialPopulation: number;
  generations: number;
  lines: number;
  /** Log-normal jump size for the compound Poisson process. */
  jumpLogMean: number;
  jumpLogSd: number;
  /** Gamma interarrival law for the renewal process. */
  renewalShape: number;
  renewalScale: number;
  /** λ(t) = base + amplitude·(1 + sin(2πt/period))/2 for the NHPP. */
  intensityBase: number;
  intensityAmplitude: number;
  intensityPeriod: number;
  /** CTMC: state names and the OFF-DIAGONAL rates (diagonals are derived). */
  ctmcStates: string[];
  ctmcRates: number[][];
  ctmcTime: number;
  ctmcInitialState: number;
  ctmcTargetState: number;
}

export const PROCESSES_DEFAULT: ProcessesConfig = {
  // Geometric Brownian motion on open: it has a full set of closed forms, an
  // exact first-passage answer, and the drift convention that this screen
  // exists partly to make unambiguous.
  processId: 'gbm',
  params: { s0: 100, drift: 0.08, volatility: 0.25 },
  horizon: 1,
  gridPoints: 60,
  paths: 400,
  bandLevel: 0.9,
  seed: 'processes-1',
  passageLevel: 120,
  passageDirection: 'above',
  ruinStart: 20,
  ruinTarget: 50,
  ruinWalks: 2000,
  offspringMean: 1.4,
  initialPopulation: 1,
  generations: 40,
  lines: 2000,
  jumpLogMean: 0,
  jumpLogSd: 0.6,
  renewalShape: 4,
  renewalScale: 0.25,
  intensityBase: 0.5,
  intensityAmplitude: 1.5,
  intensityPeriod: 4,
  ctmcStates: ['Running', 'Degraded', 'Failed'],
  ctmcRates: [
    [0, 1, 0.05],
    [2, 0, 0.5],
    [0.25, 0, 0],
  ],
  ctmcTime: 1,
  ctmcInitialState: 0,
  ctmcTargetState: 2,
};

/** Processes simulated on a whole-step grid rather than a continuous one. */
const DISCRETE_TIME = new Set(['random-walk', 'ar1']);

/**
 * Guards on the branching simulation, chosen so that pressing Cancel is
 * answered within a fraction of a second.
 *
 * A single supercritical line is the expensive unit: its population grows
 * geometrically until the cap, so one line costs on the order of the cap
 * itself in offspring draws. The cap is set where it stops mattering to the
 * answer rather than at an arbitrary large number — from a population of z the
 * extinction probability is q^z, so once a line has ten thousand individuals
 * its chance of dying out is far below the last digit this screen prints.
 */
const BRANCHING_POPULATION_CAP = 10_000;
const BRANCHING_CHUNK_LINES = 25;
/** Processes whose paths are not real-valued trajectories on a grid. */
const NO_PATH_SAMPLER = new Set(['galton-watson', 'ctmc']);

/* ------------------------------------------------------------------ *
 * Generator driver
 * ------------------------------------------------------------------ */

interface RunState<T> {
  status: 'idle' | 'running';
  completed: number;
  total: number;
  result: T | null;
  error: string[] | null;
}

function idleState<T>(): RunState<T> {
  return { status: 'idle', completed: 0, total: 0, result: null, error: null };
}

/**
 * Drives a chunked engine generator on the main thread, returning to the
 * event loop between chunks. The yield is the whole point: a synchronous loop
 * over thousands of trajectories would freeze the tab and make the Cancel
 * button unreachable.
 */
function useGeneratorRun<T>(): RunState<T> & {
  start(total: number, make: (isCancelled: () => boolean) => Generator<number, T, void>): void;
  cancel(): void;
  reset(): void;
} {
  const [state, setState] = useState<RunState<T>>(idleState<T>);
  const cancelled = useRef(false);
  const generation = useRef(0);

  // Abandon an in-flight run when the screen is left, so the main thread is
  // not left producing a result nothing will display.
  useEffect(
    () => () => {
      cancelled.current = true;
      generation.current += 1;
    },
    [],
  );

  const start = useCallback((total: number, make: (isCancelled: () => boolean) => Generator<number, T, void>) => {
    cancelled.current = false;
    generation.current += 1;
    const mine = generation.current;
    setState({ status: 'running', completed: 0, total, result: null, error: null });
    let steps: Generator<number, T, void>;
    try {
      steps = make(() => cancelled.current);
    } catch (e) {
      setState({ status: 'idle', completed: 0, total, result: null, error: messagesOf(e) });
      return;
    }
    const pump = () => {
      if (generation.current !== mine) return;
      try {
        const next = steps.next();
        if (next.done) {
          setState({ status: 'idle', completed: total, total, result: next.value, error: null });
          return;
        }
        setState((prev) => ({ ...prev, completed: next.value }));
        setTimeout(pump, 0);
      } catch (e) {
        setState({ status: 'idle', completed: 0, total, result: null, error: messagesOf(e) });
      }
    };
    setTimeout(pump, 0);
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelled.current = true;
    generation.current += 1;
    setState(idleState<T>());
  }, []);

  return { ...state, start, cancel, reset };
}

function messagesOf(e: unknown): string[] {
  if (e instanceof EngineError) return e.issues.map((i) => i.message);
  return [e instanceof Error ? e.message : String(e)];
}

/* ------------------------------------------------------------------ *
 * Building blocks shared by the panels
 * ------------------------------------------------------------------ */

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; errors: string[] };
type Attempt<T> = Ok<T> | Err;

function attempt<T>(f: () => T): Attempt<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, errors: messagesOf(e) };
  }
}

function paramOf(def: ProcessDefinition, params: Record<string, number>, key: string): number {
  const stored = params[key];
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  const spec = def.params.find((p) => p.key === key);
  // A missing or corrupted value falls back to the catalogue default rather
  // than to 0, which would silently be a different (and often invalid) model.
  if (!spec) throw new EngineError(`The process "${def.id}" has no parameter "${key}".`, 'unknown');
  return spec.defaultValue;
}

/** The time grid every path and every analytic time-series result uses. */
function buildGrid(config: ProcessesConfig): number[] {
  const points = Math.max(2, Math.min(2000, Math.round(config.gridPoints)));
  if (DISCRETE_TIME.has(config.processId)) {
    // A random walk and an AR(1) process are only defined at whole steps.
    const steps = Math.max(1, Math.min(5000, Math.round(config.horizon)));
    return Array.from({ length: steps + 1 }, (_, i) => i);
  }
  if (!(config.horizon > 0)) throw new EngineError('The horizon must be greater than 0.', 'range');
  return Array.from({ length: points }, (_, j) => (config.horizon * j) / (points - 1));
}

/** The generator matrix Q from the stored off-diagonal rates: rows sum to 0. */
function buildGenerator(config: ProcessesConfig): Matrix {
  const n = config.ctmcStates.length;
  return config.ctmcRates.slice(0, n).map((row, i) => {
    const off = row.slice(0, n).map((v, j) => (i === j ? 0 : v));
    const total = off.reduce((a, b) => a + b, 0);
    return off.map((v, j) => (i === j ? -total : v));
  });
}

function intensityOf(config: ProcessesConfig): (t: number) => number {
  const { intensityBase: base, intensityAmplitude: amp, intensityPeriod: period } = config;
  if (!(period > 0)) throw new EngineError('The intensity period must be greater than 0.', 'range');
  return (t: number) => base + (amp * (1 + Math.sin((2 * Math.PI * t) / period))) / 2;
}

/** Largest value λ(t) takes, which thinning needs as its bound λ*. */
function intensityPeak(config: ProcessesConfig): number {
  return config.intensityBase + Math.max(0, config.intensityAmplitude);
}

/**
 * The engine path sampler for the chosen process. Every sampler here is an
 * engine function; this only selects one and binds its parameters.
 */
function buildSampler(def: ProcessDefinition, config: ProcessesConfig): { sampler: PathSampler; yLabel: string } {
  const p = (key: string) => paramOf(def, config.params, key);
  switch (def.id) {
    case 'poisson-process':
      return { sampler: (rng, times) => samplePoissonCountPath(rng, p('rate'), times), yLabel: 'Events counted, N(t)' };
    case 'nhpp': {
      const intensity = intensityOf(config);
      const bound = p('bound');
      return { sampler: (rng, times) => sampleNhppCountPath(rng, intensity, bound, times), yLabel: 'Events counted, N(t)' };
    }
    case 'compound-poisson': {
      const jump = jumpSamplerFromDistribution('lognormal', { mu: config.jumpLogMean, sigma: config.jumpLogSd });
      return { sampler: (rng, times) => sampleCompoundPoissonPath(rng, p('rate'), jump, times), yLabel: 'Aggregate amount, X(t)' };
    }
    case 'renewal-process': {
      const gamma = getDistribution('gamma');
      const draw = (rng: Random) => gamma.sample(rng, { k: config.renewalShape, theta: config.renewalScale });
      return { sampler: (rng, times) => sampleRenewalCountPath(rng, draw, times), yLabel: 'Renewals counted, N(t)' };
    }
    case 'brownian-motion':
      return {
        sampler: (rng, times) => sampleBrownianPath(rng, { x0: p('x0'), drift: p('drift'), volatility: p('volatility') }, times),
        yLabel: 'X(t)',
      };
    case 'gbm':
      return {
        sampler: (rng, times) => sampleGbmPath(rng, { s0: p('s0'), drift: p('drift'), volatility: p('volatility') }, times),
        yLabel: 'S(t)',
      };
    case 'ornstein-uhlenbeck':
      return {
        sampler: (rng, times) =>
          sampleOuPath(rng, { x0: p('x0'), meanLevel: p('meanLevel'), reversionRate: p('reversionRate'), volatility: p('volatility') }, times),
        yLabel: 'X(t)',
      };
    case 'merton-jump-diffusion':
      return {
        sampler: (rng, times) =>
          sampleJumpDiffusionPath(
            rng,
            {
              s0: p('s0'),
              drift: p('drift'),
              volatility: p('volatility'),
              jumpRate: p('jumpRate'),
              jumpLogMean: p('jumpLogMean'),
              jumpLogSd: p('jumpLogSd'),
            },
            times,
          ),
        yLabel: 'S(t)',
      };
    case 'random-walk':
      return { sampler: (rng, times) => sampleRandomWalkPath(rng, { p: p('p'), start: p('start') }, times), yLabel: 'Position, X_n' };
    case 'ar1':
      return {
        sampler: (rng, times) => sampleAr1Path(rng, { phi: p('phi'), intercept: p('intercept'), noiseSd: p('noiseSd'), x0: p('x0') }, times),
        yLabel: 'X_t',
      };
    default:
      throw new EngineError(
        `The process "${def.name}" has no trajectory sampler on a time grid in this module. Use the panel for it below instead.`,
        'unsupported',
      );
  }
}

/* ------------------------------------------------------------------ *
 * Analytic results
 * ------------------------------------------------------------------ */

interface AnalyticBlock {
  /** Closed forms and numerical summaries, each carrying its own exactness. */
  quantities: Quantity[];
  /** Named laws, e.g. "log(S(t)/S₀) ~ Normal(…)". */
  laws: { label: string; text: string; exactness: Exactness }[];
  /** Convention that a user comparing with another tool needs to know. */
  convention: string | null;
  /**
   * Probability mass P(N(t) = k) against k, for the counting processes.
   * `poissonCountSummary().pmf` really is the mass function — each entry is
   * e^{−λt}(λt)^k / k! — so it is labelled as mass. An earlier version of this
   * screen plotted the same numbers as an exceedance curve, which read every
   * value as a far larger probability than it is.
   */
  countMass: { k: number; p: number }[] | null;
}

function normalLaw(label: string, law: { mean: number; variance: number; sd: number; formula: string; exactness: Exactness }): AnalyticBlock['laws'][number] {
  return {
    label,
    text: `${law.formula} — mean ${formatValue(law.mean, 6)}, variance ${formatValue(law.variance, 6)}, SD ${formatValue(law.sd, 6)}`,
    exactness: law.exactness,
  };
}

/** Everything closed-form (or cheaply numerical) for the chosen process. */
function analyticResults(def: ProcessDefinition, config: ProcessesConfig): AnalyticBlock {
  const p = (key: string) => paramOf(def, config.params, key);
  const t = DISCRETE_TIME.has(def.id) ? Math.max(1, Math.round(config.horizon)) : config.horizon;
  const quantities: Quantity[] = [];
  const lawList: AnalyticBlock['laws'] = [];
  let convention: string | null = null;
  let countMass: AnalyticBlock['countMass'] = null;

  switch (def.id) {
    case 'poisson-process': {
      const summary = poissonCountSummary(p('rate'), t, 25);
      const inter = poissonInterarrivalLaw(p('rate'));
      const wait = poissonWaitingTime(p('rate'), 5);
      quantities.push(summary.mean, summary.variance, inter.mean, inter.variance, wait.mean, wait.variance, wait.cdf(t));
      lawList.push(
        { label: `N(${formatValue(t, 4)})`, text: `Poisson(λt) with λt = ${formatValue(p('rate') * t, 6)}`, exactness: 'exact' },
        { label: 'Interarrival time', text: inter.distribution, exactness: 'exact' },
        { label: 'Waiting time to the 5th event', text: wait.distribution, exactness: 'exact' },
      );
      countMass = summary.pmf;
      convention =
        'The variance of the count equals its mean. If observed counts are more spread out than that, this process is the wrong model and no amount of fitting λ will fix it.';
      break;
    }
    case 'nhpp': {
      const expected = nhppExpectedCount(intensityOf(config), t, 2048);
      quantities.push(expected);
      lawList.push({ label: `N(${formatValue(t, 4)})`, text: `Poisson(Λ(t)) with Λ(t) = ${formatValue(expected.value, 6)}`, exactness: 'numerical' });
      convention = `λ(t) = ${formatValue(config.intensityBase, 4)} + ${formatValue(config.intensityAmplitude, 4)}·(1 + sin(2πt/${formatValue(config.intensityPeriod, 4)}))/2, so its peak is ${formatValue(intensityPeak(config), 6)}. Λ(t) is a numerical integral (Simpson), not a closed form.`;
      break;
    }
    case 'compound-poisson': {
      const lognormal = getDistribution('lognormal');
      const jumpParams = { mu: config.jumpLogMean, sigma: config.jumpLogSd };
      const jm = lognormal.mean(jumpParams);
      const jv = lognormal.variance(jumpParams);
      if (!jm.defined || !jv.defined) {
        throw new EngineError('The log-normal jump size has no finite mean or variance for these parameters, so the aggregate moments do not exist.', 'undefined');
      }
      const moments = compoundPoissonMoments(p('rate'), t, jm.value, jv.value + jm.value * jm.value);
      quantities.push(moments.mean, moments.variance, moments.sd);
      lawList.push({
        label: 'Jump size J',
        text: `Log-normal(μ = ${formatValue(config.jumpLogMean, 4)}, σ = ${formatValue(config.jumpLogSd, 4)}) — E[J] = ${formatValue(jm.value, 6)}, E[J²] = ${formatValue(jv.value + jm.value * jm.value, 6)}`,
        exactness: 'exact',
      });
      convention = moments.note;
      break;
    }
    case 'renewal-process': {
      const gamma = getDistribution('gamma');
      const gammaParams = { k: config.renewalShape, theta: config.renewalScale };
      const gm = gamma.mean(gammaParams);
      const gv = gamma.variance(gammaParams);
      if (!gm.defined || !gv.defined) throw new EngineError('The gamma interarrival law has no finite mean for these parameters.', 'undefined');
      quantities.push(elementaryRenewalRate(gm.value));
      lawList.push({
        label: 'Interarrival time T',
        text: `Gamma(shape ${formatValue(config.renewalShape, 4)}, scale ${formatValue(config.renewalScale, 4)}) — mean ${formatValue(gm.value, 6)}, SD ${formatValue(Math.sqrt(gv.value), 6)}`,
        exactness: 'exact',
      });
      convention =
        'm(t) = E[N(t)] has no closed form for a general interarrival law, so only the long-run rate 1/μ is exact here. The simulated ensemble below estimates m(t) itself; 1/μ·t is a limit, not a short-horizon count.';
      break;
    }
    case 'brownian-motion': {
      const params = { x0: p('x0'), drift: p('drift'), volatility: p('volatility') };
      const law = brownianMarginal(params, t);
      lawList.push(normalLaw(`X(${formatValue(t, 4)})`, law));
      quantities.push(brownianMarginalSf(params, config.passageLevel, t));
      if (config.passageLevel > params.x0) {
        quantities.push(brownianRunningMaxSf(params, config.passageLevel, t));
        const fp = brownianFirstPassage(params, config.passageLevel);
        lawList.push({ label: 'First passage time T_a', text: fp.distribution, exactness: 'exact' });
        if (fp.mean.defined) {
          quantities.push({ label: 'E[T_a]', value: fp.mean.value, exactness: 'exact', formula: '(a − x₀)/μ' });
        } else {
          convention = fp.mean.reason;
        }
      }
      break;
    }
    case 'gbm': {
      const params = { s0: p('s0'), drift: p('drift'), volatility: p('volatility') };
      const m = gbmMarginal(params, t);
      quantities.push(m.mean, m.variance, m.median, m.itoCorrection);
      lawList.push(normalLaw(`log(S(${formatValue(t, 4)})/S₀)`, m.logLaw));
      if (config.passageLevel > 0) {
        quantities.push(gbmMarginalSf(params, config.passageLevel, t), gbmFirstPassageProbability(params, config.passageLevel, t));
      }
      convention = m.parameterisation;
      break;
    }
    case 'ornstein-uhlenbeck': {
      const params = { x0: p('x0'), meanLevel: p('meanLevel'), reversionRate: p('reversionRate'), volatility: p('volatility') };
      const marginal = ouMarginal(params, t);
      const stat = ouStationary(params);
      quantities.push(stat.halfLife, stat.autocorrelation(Math.max(0, t / 2)));
      lawList.push(normalLaw(`X(${formatValue(t, 4)}) from x₀`, marginal), normalLaw('Stationary law', stat.law));
      convention = 'σ is the instantaneous noise scale, not the stationary standard deviation, which is σ/√(2κ).';
      break;
    }
    case 'merton-jump-diffusion': {
      const params = {
        s0: p('s0'),
        drift: p('drift'),
        volatility: p('volatility'),
        jumpRate: p('jumpRate'),
        jumpLogMean: p('jumpLogMean'),
        jumpLogSd: p('jumpLogSd'),
      };
      const mean = jumpDiffusionMean(params, t);
      quantities.push(mean);
      lawList.push({
        label: `log S(${formatValue(t, 4)})`,
        text: 'a Poisson mixture of normals: normal given the number of jumps, mixed over Poisson(λt)',
        exactness: 'exact',
      });
      convention = mean.note ?? null;
      break;
    }
    case 'random-walk': {
      const steps = Math.max(0, Math.round(t));
      const moments = randomWalkMoments({ p: p('p'), start: p('start') }, steps);
      quantities.push(moments.mean, moments.variance);
      lawList.push({
        label: `X_${steps}`,
        text: `start + (2·Binomial(${steps}, p) − ${steps}): a shifted and scaled binomial, exactly`,
        exactness: 'exact',
      });
      convention = 'The walk is only defined at whole steps, so the horizon is read as a number of steps here.';
      break;
    }
    case 'ar1': {
      const params = { phi: p('phi'), intercept: p('intercept'), noiseSd: p('noiseSd'), x0: p('x0') };
      const stat = ar1Stationary(params);
      const steps = Math.max(0, Math.round(t));
      const cond = ar1Conditional(params, params.x0, steps);
      quantities.push(stat.mean, stat.variance, stat.sd, stat.autocorrelation(1));
      if (stat.halfLife.defined) {
        quantities.push({ label: 'Half-life of a shock', value: stat.halfLife.value, exactness: 'exact', formula: 'ln(1/2)/ln φ' });
      } else {
        convention = stat.halfLife.reason;
      }
      lawList.push(normalLaw(`X_${steps} given x₀`, cond), {
        label: 'Stationary law',
        text: `Normal(c/(1−φ), σ²/(1−φ²)) — mean ${formatValue(stat.mean.value, 6)}, variance ${formatValue(stat.variance.value, 6)}, SD ${formatValue(stat.sd.value, 6)}`,
        exactness: 'exact',
      });
      break;
    }
    case 'galton-watson': {
      const offspring = poissonOffspring(config.offspringMean);
      const extinction = extinctionProbability(offspring.gf, offspring.mean);
      quantities.push(
        { label: 'Mean offspring m', value: extinction.mean, exactness: 'exact', formula: 'E[X] for the offspring law' },
        { label: 'P(eventual extinction)', value: extinction.probability, exactness: extinction.exactness, formula: extinction.formula, note: extinction.note },
        branchingExpectedSize(config.initialPopulation, offspring.mean, config.generations),
      );
      lawList.push({ label: 'Offspring law', text: `Poisson(${formatValue(config.offspringMean, 4)}), G(s) = e^{m(s−1)}`, exactness: 'exact' });
      convention = `Criticality rule: extinction is certain if and only if m ≤ 1 (excluding the degenerate law X ≡ 1). Here m = ${formatValue(extinction.mean, 6)}, so the line is ${extinction.regime}.`;
      break;
    }
    case 'ctmc': {
      const Q = buildGenerator(config);
      const state = Math.min(Math.max(0, Math.round(config.ctmcInitialState)), Q.length - 1);
      const summary = ctmcStateSummary(Q, state);
      quantities.push(summary.holdingRate, summary.meanHoldingTime);
      lawList.push({
        label: `Holding time in ${config.ctmcStates[state]}`,
        text: `Exponential(${formatValue(summary.holdingRate.value, 6)}) — memoryless, so time already spent carries no information`,
        exactness: 'exact',
      });
      convention =
        'Each row of the generator sums to ZERO, not to one: the off-diagonal entries are rates (per unit time, unbounded), and the diagonal is minus their total. P(t) = exp(Qt) is a numerical computation, not a closed form.';
      break;
    }
    default:
      break;
  }
  return { quantities, laws: lawList, convention, countMass };
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function ProcessesTool({ config }: { config: ProcessesConfig }) {
  const app = useApp();
  const set = (patch: Partial<ProcessesConfig>) => app.updateConfig({ ...config, ...patch });

  const ensembleRun = useGeneratorRun<PathEnsemble>();
  const ruinRun = useGeneratorRun<RuinSimulationResult>();
  const branchingRun = useGeneratorRun<BranchingSimulationResult>();

  const definition = useMemo(() => attempt(() => getProcessDefinition(config.processId)), [config.processId]);
  const def = definition.ok ? definition.value : null;

  const analytic = useMemo(() => (def ? attempt(() => analyticResults(def, config)) : null), [def, config]);
  const grid = useMemo(() => attempt(() => buildGrid(config)), [config]);

  const ensemble = ensembleRun.result;
  const fan = useMemo(() => (ensemble ? attempt(() => fanChart(ensemble, config.bandLevel)) : null), [ensemble, config.bandLevel]);
  const passage = useMemo(
    () => (ensemble ? attempt(() => firstPassageFromEnsemble(ensemble, config.passageLevel, config.passageDirection)) : null),
    [ensemble, config.passageLevel, config.passageDirection],
  );

  // Exact first-passage answers, where the engine has one.
  const exactPassage = useMemo(() => (def ? attempt(() => exactPassageResult(def, config)) : null), [def, config]);

  const ruin = useMemo(
    () => (config.processId === 'random-walk' && def ? attempt(() => gamblersRuin(paramOf(def, config.params, 'p'), config.ruinStart, config.ruinTarget)) : null),
    [config.processId, def, config.params, config.ruinStart, config.ruinTarget],
  );

  const branching = useMemo(
    () =>
      config.processId === 'galton-watson'
        ? attempt(() => {
            const offspring = poissonOffspring(config.offspringMean);
            return { offspring, extinction: extinctionProbability(offspring.gf, offspring.mean) };
          })
        : null,
    [config.processId, config.offspringMean],
  );

  const ctmc = useMemo(() => (config.processId === 'ctmc' ? attempt(() => ctmcResults(config)) : null), [config]);

  const canSimulatePaths = def !== null && !NO_PATH_SAMPLER.has(def.id);

  const startEnsemble = () => {
    if (!grid.ok || !def) return;
    const total = Math.max(2, Math.round(config.paths));
    const times = grid.value;
    ensembleRun.start(total, (isCancelled) => {
      const { sampler } = buildSampler(def, config);
      return ensembleSteps(sampler, times, total, config.seed, { isCancelled });
    });
  };

  const switchProcess = (processId: string) => {
    const next = attempt(() => getProcessDefinition(processId));
    if (!next.ok) return;
    ensembleRun.reset();
    ruinRun.reset();
    branchingRun.reset();
    // Parameters are per-process, so they are reset to the catalogue defaults
    // rather than carried across to keys that do not exist on the new process.
    set({
      processId,
      params: Object.fromEntries(next.value.params.map((spec) => [spec.key, spec.defaultValue])),
    });
  };

  const explanation: Explanation | null = def ? buildExplanation(def, config) : null;

  /**
   * The report contribution. This screen mixes closed forms with simulated
   * ensembles, so each section carries the engine's own per-quantity exactness
   * rather than one label for the screen, and the two bands of the fan chart —
   * a confidence interval for E[X(t)] and quantiles of the paths themselves —
   * are reported as the different statements they are.
   */
  const buildReport = (): ToolReportContent => {
    const sections: ReportSection[] = [];
    const quantityTable = (caption: string, quantities: Quantity[]): ReportTable => ({
      caption,
      columns: ['Quantity', 'Value', 'Exactness', 'Formula or method', 'Note'],
      rows: quantities.map((q) => [q.label, q.value, EXACTNESS_LABEL[q.exactness], q.formula ?? 'not stated', q.note ?? '']),
    });

    if (!def) {
      sections.push({
        title: 'Process',
        refusal: definition.ok ? 'No process definition was available.' : definition.errors.join(' '),
      });
      return { sections };
    }

    sections.push({
      title: `Closed forms for ${def.name}`,
      description: def.description,
      rows: [{ label: 'Process', value: def.name }, { label: 'Horizon', value: config.horizon }, { label: 'Seed', value: config.seed }],
      ...(analytic && !analytic.ok
        ? { refusal: analytic.errors.join(' ') }
        : analytic?.ok
          ? {
              tables: analytic.value.quantities.length
                ? [quantityTable('Analytic results for the chosen process', analytic.value.quantities)]
                : undefined,
              missing: analytic.value.quantities.length
                ? undefined
                : 'This process has no scalar closed form on this screen, so no analytic figures are reported; its laws are listed below instead.',
              limitations: analytic.value.convention ? [analytic.value.convention] : undefined,
              assumptions: analytic.value.laws.map((l) => `${l.label}: ${l.text} (${EXACTNESS_LABEL[l.exactness]})`),
            }
          : { missing: 'The analytic results were not evaluated on this screen.' }),
      explanation: explanation ?? undefined,
    });

    if (!canSimulatePaths) {
      sections.push({
        title: 'Simulated path ensemble',
        missing: 'This process has no path sampler on this screen, so no ensemble, bands or simulated first-passage figures exist for it.',
      });
    } else if (!ensemble) {
      sections.push({
        title: 'Simulated path ensemble',
        missing: `No paths had been simulated when this report was exported${ensembleRun.error ? `; the last attempt failed: ${ensembleRun.error.join(' ')}` : ''}. The spread of individual outcomes and the simulated first-passage figures need the ensemble: press "Simulate paths" on the Processes screen and export the report again.`,
      });
    } else if (fan && !fan.ok) {
      sections.push({ title: 'Simulated path ensemble', refusal: fan.errors.join(' ') });
    } else if (fan?.ok) {
      const f = fan.value;
      const last = f.times.length - 1;
      sections.push({
        title: 'Simulated path ensemble',
        description: `${f.pathsUsed.toLocaleString('en-US')} paths on ${f.times.length} time points, seed "${config.seed}".${f.partial ? ' The run was partial, so fewer paths contributed than requested.' : ''}`,
        exactness: f.exactness,
        intervals: [
          {
            label: `the expected value E[X(t)] at the final time t = ${formatValue(f.times[last], 6)}`,
            kind: 'confidence-interval',
            lower: f.meanBand.low[last],
            upper: f.meanBand.high[last],
            level: f.meanBand.level,
            note: f.meanBand.meaning,
          },
          {
            label: `a single path at the final time t = ${formatValue(f.times[last], 6)}`,
            kind: 'simulated-percentile-range',
            lower: f.pathBand.low[last],
            upper: f.pathBand.high[last],
            percentiles: [((1 - f.pathBand.level) / 2) * 100, (1 - (1 - f.pathBand.level) / 2) * 100],
            note: f.pathBand.meaning,
          },
        ],
        charts: [
          {
            title: 'Fan chart',
            description: 'The mean path with both bands at each time point.',
            table: {
              caption: 'Mean path, confidence band for the mean, and path quantile band',
              columns: ['Time', 'Mean path', 'Mean band: low', 'Mean band: high', 'Path quantile: low', 'Path quantile: high'],
              rows: f.times.map((t, i) => [t, f.meanPath[i], f.meanBand.low[i], f.meanBand.high[i], f.pathBand.low[i], f.pathBand.high[i]]),
              note: 'The two bands are different statements: the mean band is about how precisely the average is estimated, the quantile band about how widely individual paths vary.',
            },
          },
        ],
        warnings: f.warnings,
      });
    }

    const passageSection: ReportSection = { title: `First passage to level ${formatValue(config.passageLevel, 6)}` };
    if (exactPassage && !exactPassage.ok) {
      passageSection.refusal = exactPassage.errors.join(' ');
    } else if (exactPassage?.ok) {
      if (exactPassage.value.quantities.length) passageSection.tables = [quantityTable('Analytic first-passage results', exactPassage.value.quantities)];
      else passageSection.missing = `No analytic first-passage result is available for this process and direction. ${exactPassage.value.note ?? ''}`.trim();
      if (exactPassage.value.note) passageSection.limitations = [exactPassage.value.note];
    }
    if (passage && !passage.ok) {
      passageSection.subsections = [{ title: 'Simulated first passage', refusal: passage.errors.join(' ') }];
    } else if (passage?.ok) {
      const e = passage.value;
      passageSection.subsections = [
        {
          title: 'Simulated first passage',
          exactness: e.exactness,
          rows: [
            { label: `Fraction of paths crossing ${formatValue(e.level, 6)} ${e.direction === 'above' ? 'upwards' : 'downwards'} by the horizon`, value: e.probability },
            { label: 'Paths that crossed', value: e.crossed },
            { label: 'Paths used', value: e.pathsUsed },
            { label: 'Mean crossing time, over the paths that crossed', value: e.meanCrossingTime === null ? 'no path crossed' : e.meanCrossingTime },
          ],
          intervals: [
            {
              label: 'the probability of crossing by the horizon',
              kind: 'confidence-interval',
              lower: e.probabilityInterval.low,
              upper: e.probabilityInterval.high,
              level: e.probabilityInterval.level,
            },
          ],
          tables: e.crossingTimeQuantiles.length
            ? [
                {
                  caption: 'Quantiles of the crossing time, over the paths that crossed',
                  columns: ['Quantile', 'Crossing time'],
                  rows: e.crossingTimeQuantiles.map((q) => [q.p, q.t]),
                  note: 'These are percentiles of the simulated crossing times themselves, conditional on crossing, and not an interval for an estimate.',
                },
              ]
            : undefined,
          assumptions: e.notes,
          warnings: e.warnings,
          limitations: ['A crossing that happens and reverses between two grid points is invisible to the simulation, so a coarse grid understates every first-passage probability.'],
        },
      ];
    } else {
      passageSection.subsections = [
        {
          title: 'Simulated first passage',
          missing: 'The path ensemble had not been run, so there is no simulated crossing frequency to put beside the analytic answer.',
        },
      ];
    }
    sections.push(passageSection);

    if (config.processId === 'random-walk') {
      const section: ReportSection = { title: "Gambler's ruin" };
      if (ruin && !ruin.ok) section.refusal = ruin.errors.join(' ');
      else if (ruin?.ok) {
        section.tables = [quantityTable("Exact gambler's-ruin results", [ruin.value.winProbability, ruin.value.ruinProbability, ruin.value.expectedDuration])];
        section.assumptions = ruin.value.notes;
        if (ruinRun.result) {
          section.subsections = [
            {
              title: 'Simulated walks, against the closed form',
              exactness: 'empirical',
              rows: [
                { label: 'Simulated frequency of reaching the target', value: ruinRun.result.winFrequency },
                { label: 'Exact probability of reaching the target', value: ruin.value.winProbability.value, note: 'closed form' },
                { label: 'Mean simulated duration (steps)', value: ruinRun.result.meanDuration === null ? 'no walk resolved' : ruinRun.result.meanDuration },
                { label: 'Exact expected duration (steps)', value: ruin.value.expectedDuration.value, note: 'closed form' },
                { label: 'Walks resolved', value: `${(ruinRun.result.reachedTarget + ruinRun.result.ruined).toLocaleString('en-US')} of ${ruinRun.result.pathsUsed.toLocaleString('en-US')}` },
              ],
              intervals: [
                {
                  label: 'the simulated probability of reaching the target',
                  kind: 'confidence-interval',
                  lower: ruinRun.result.winInterval.low,
                  upper: ruinRun.result.winInterval.high,
                  level: 0.95,
                },
              ],
              warnings: ruinRun.result.warnings,
            },
          ];
        } else {
          section.subsections = [
            { title: 'Simulated walks', missing: 'No walks had been simulated, so there is no empirical figure to compare with the closed form above.' },
          ];
        }
      }
      sections.push(section);
    }

    if (config.processId === 'galton-watson') {
      const section: ReportSection = { title: 'Branching and extinction' };
      if (branching && !branching.ok) section.refusal = branching.errors.join(' ');
      else if (branching?.ok) {
        const ex = branching.value.extinction;
        section.exactness = ex.exactness;
        section.rows = [
          { label: 'Mean offspring m', value: ex.mean },
          { label: 'Regime', value: ex.regime },
          { label: 'Probability of extinction', value: ex.probability },
          { label: 'Found by', value: ex.formula },
          { label: 'Fixed-point iterations', value: ex.iterations },
        ];
        section.limitations = [ex.note];
        section.subsections = branchingRun.result
          ? [
              {
                title: 'Simulated lines, against the fixed point',
                exactness: 'empirical',
                rows: [
                  { label: 'Simulated extinction frequency', value: branchingRun.result.extinctionFrequency },
                  { label: 'Lines still alive at the generation cap', value: branchingRun.result.survivedToCap, note: 'counted as not yet extinct, so the simulated frequency is a lower bound' },
                  {
                    label: 'Mean generation of extinction',
                    value: branchingRun.result.meanExtinctionGeneration === null ? 'no line died out' : branchingRun.result.meanExtinctionGeneration,
                  },
                ],
                intervals: [
                  {
                    label: 'the simulated extinction probability',
                    kind: 'confidence-interval',
                    lower: branchingRun.result.extinctionInterval.low,
                    upper: branchingRun.result.extinctionInterval.high,
                    level: 0.95,
                  },
                ],
                warnings: branchingRun.result.warnings,
              },
            ]
          : [{ title: 'Simulated lines', missing: 'No lines had been simulated, so there is no empirical extinction frequency in this report.' }];
      }
      sections.push(section);
    }

    if (config.processId === 'ctmc') {
      if (ctmc && !ctmc.ok) sections.push({ title: 'Continuous-time Markov chain', refusal: ctmc.errors.join(' ') });
      else if (ctmc?.ok) {
        const c = ctmc.value;
        sections.push({
          title: 'Continuous-time Markov chain',
          description:
            'Each row of the generator sums to zero, not to one: the off-diagonal entries are rates and the diagonal is minus their total. P(t) = exp(Qt) is computed numerically.',
          exactness: 'numerical',
          rows: [
            { label: 'Time for the transient distribution', value: c.transient.t },
            { label: 'Method for P(t)', value: c.transient.method },
            { label: 'Largest |row sum − 1| of P(t)', value: c.transient.rowSumError, note: 'a direct check on the computation, not an assumption' },
            { label: 'Residual of πQ = 0 for the stationary distribution', value: c.stationary.residual },
            { label: 'Formula for the stationary distribution', value: c.stationary.formula },
          ],
          tables: [
            {
              caption: `Distribution at time t = ${formatValue(c.transient.t, 6)}, and the stationary distribution`,
              columns: ['State', `P(X(t) = state) at t = ${formatValue(c.transient.t, 6)}`, 'Stationary probability', 'Expected time to reach the target state'],
              rows: config.ctmcStates.map((name, i) => [
                name,
                c.transient.distribution ? c.transient.distribution[i] : 'not computed for this starting state',
                c.stationary.distribution[i],
                c.hitting.expected[i],
              ]),
              note: `Expected hitting times solved by ${c.hitting.formula}.`,
            },
          ],
          charts: [
            {
              title: 'Occupancy over time',
              description: 'The probability of being in each state as time passes.',
              table: {
                caption: 'Occupancy probability by time and state',
                columns: ['Time', ...config.ctmcStates],
                rows: c.occupancy.map((o) => [o.t, ...o.distribution]),
              },
            },
          ],
          warnings: [...c.transient.warnings, ...c.stationary.warnings],
          limitations: c.hitting.notes,
        });
      }
    }

    return { sections, configNote: `Process: ${def.name}.` };
  };

  return (
    <>
      <ToolHeader toolId="processes" report={buildReport} />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Process">
            <SelectField
              label="Stochastic process"
              value={config.processId}
              onChange={switchProcess}
              options={PROCESS_DEFINITIONS.map((d) => ({ value: d.id, label: `${d.name} — ${CATEGORY_LABEL[d.category]}` }))}
              hint={def?.description}
            />
            {!definition.ok && <Notice tone="error" items={definition.errors} />}
            {def && (
              <>
                <div className="oc-explanation__formula" style={{ overflowX: 'auto' }}>
                  {def.formula}
                </div>
                <p className="oc-chart-note">{def.stateSpaceText}</p>
                {def.params.map((spec) => (
                  <NumberField
                    key={spec.key}
                    label={spec.label}
                    symbol={spec.symbol}
                    value={paramOf(def, config.params, spec.key)}
                    onChange={(v) => set({ params: { ...config.params, [spec.key]: v } })}
                    min={spec.min}
                    max={spec.max}
                    integer={spec.integer}
                    hint={spec.description}
                  />
                ))}
                <ExtraParameters config={config} set={set} />
                {!DISCRETE_TIME.has(def.id) && (
                  <NumberField
                    label="Horizon"
                    symbol="T"
                    value={config.horizon}
                    onChange={(horizon) => set({ horizon })}
                    min={1e-9}
                    hint="End of the time grid. Every result below is at or up to this time."
                  />
                )}
                {DISCRETE_TIME.has(def.id) && (
                  <NumberField
                    label="Number of steps"
                    symbol="n"
                    value={Math.max(1, Math.round(config.horizon))}
                    onChange={(horizon) => set({ horizon })}
                    min={1}
                    max={5000}
                    integer
                    hint="This process is defined only at whole steps, so the horizon is a step count."
                  />
                )}
                <TextField label="Seed" value={config.seed} onChange={(seed) => set({ seed })} hint="Same seed, same simulated paths." monospace />
              </>
            )}
          </Card>
          <AiAssistPanel
            capability="suggestMethod"
            context="Choosing between a counting process, a diffusion, a discrete-time series and a Markov jump process for a quantity that evolves over time."
          />
          {def && <AssumptionsPanel assumptions={def.assumptions} limitations={def.limitations} />}
        </div>

        <div className="oc-stack">
          {/* 2. Exact results first: instant, and the check on everything simulated. */}
          <Card title="Exact results" hint="Closed forms from the process itself. These are what make the simulation below checkable rather than merely plausible.">
            {analytic && !analytic.ok && <Notice tone="error" title="These results could not be computed" items={analytic.errors} />}
            {analytic && analytic.ok && (
              <>
                {analytic.value.quantities.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable caption="Analytic results for the chosen process" columns={QUANTITY_COLUMNS} rows={analytic.value.quantities} />
                  </div>
                ) : (
                  <Notice tone="info">This process has no scalar closed form on this screen; its laws are listed below.</Notice>
                )}
                {analytic.value.laws.length > 0 && (
                  <KeyValueList
                    items={analytic.value.laws.map((law) => ({
                      label: law.label,
                      value: (
                        <span style={{ display: 'inline-flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span>{law.text}</span>
                          <Badge variant={law.exactness}>{law.exactness}</Badge>
                        </span>
                      ),
                    }))}
                  />
                )}
                {analytic.value.convention && (
                  <Notice tone="info" title="Convention and caveat">
                    <p style={{ margin: 0 }}>{analytic.value.convention}</p>
                  </Notice>
                )}
                {def?.exactResults.length ? (
                  <Disclosure title="Every closed form this process provides" icon="book">
                    <ul className="oc-assumption-list">
                      {def.exactResults.map((r) => (
                        <li key={r} style={{ overflowWrap: 'anywhere' }}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                ) : null}
                {analytic.value.countMass && (
                  <LineChart
                    title="Probability mass of the count"
                    description="P(N(T) = k) against k, from the exact Poisson law of the count at the horizon."
                    series={[{ label: 'P(N(T) = k)', points: analytic.value.countMass.map((row) => ({ x: row.k, y: row.p })) }]}
                    xLabel="k (number of events)"
                    yLabel="P(N(T) = k)"
                    yDomain={[0, 1]}
                    note="Each point is the probability of exactly k events, not of k or more. The points sum to one across the whole support, so an individual value is much smaller than the corresponding exceedance probability."
                  />
                )}
              </>
            )}
          </Card>

          {/* 3. Paths: behind a button, driven as a cancellable generator. */}
          <Card
            title="Simulated paths"
            hint="A modest ensemble runs only when you ask: thousands of trajectories are seconds of work and would otherwise freeze the screen."
            actions={
              canSimulatePaths ? (
                <>
                  <Button icon="play" variant="primary" disabled={ensembleRun.status === 'running' || !grid.ok} onClick={startEnsemble}>
                    {ensemble ? 'Run again' : 'Run paths'}
                  </Button>
                  {ensemble && (
                    <Button icon="reset" onClick={ensembleRun.reset}>
                      Clear
                    </Button>
                  )}
                </>
              ) : null
            }
          >
            {!canSimulatePaths && (
              <EmptyState icon="processes" title="This process is not a trajectory on a time grid">
                {config.processId === 'galton-watson'
                  ? 'A branching process is a sequence of generation sizes, not a path on a continuous grid. Its simulated panel is "Branching and extinction" below.'
                  : 'A continuous-time Markov chain moves between labelled states, so a fan chart of a state index would be meaningless. Its occupancy over time is plotted in the chain panel below.'}
              </EmptyState>
            )}
            {canSimulatePaths && (
              <>
                <NumberField
                  label="Paths to simulate"
                  value={config.paths}
                  onChange={(paths) => set({ paths })}
                  min={2}
                  max={200000}
                  integer
                  hint="The mean band narrows like 1/√n; the path band does not narrow at all."
                />
                <NumberField
                  label="Grid points"
                  value={config.gridPoints}
                  onChange={(gridPoints) => set({ gridPoints })}
                  min={2}
                  max={2000}
                  integer
                  disabled={DISCRETE_TIME.has(config.processId)}
                  hint={
                    DISCRETE_TIME.has(config.processId)
                      ? 'Fixed to the whole steps of this discrete-time process.'
                      : 'A crossing between two grid points is invisible, so a coarse grid understates every first-passage probability.'
                  }
                />
                <NumberField
                  label="Band level"
                  value={config.bandLevel}
                  onChange={(bandLevel) => set({ bandLevel })}
                  min={0.5}
                  max={0.9999}
                  step={0.01}
                  hint="Used for both bands below, which mean different things."
                />
                {!grid.ok && <Notice tone="error" title="The time grid is not valid" items={grid.errors} />}
                {ensembleRun.status === 'running' && (
                  <RunningState completed={ensembleRun.completed} total={ensembleRun.total} unitLabel="paths" onCancel={ensembleRun.cancel} />
                )}
                {ensembleRun.error && <Notice tone="error" title="The ensemble could not be simulated" items={ensembleRun.error} />}
                {!ensemble && ensembleRun.status === 'idle' && !ensembleRun.error && (
                  <Notice tone="info">
                    The exact results above need no simulation. Run the paths when you want to see the spread of individual outcomes, the Monte Carlo check on
                    those closed forms, and the first-passage panel.
                  </Notice>
                )}
                {ensemble?.partial && (
                  <Notice tone="warning" title="Partial run: this ensemble was cancelled">
                    <p style={{ margin: 0 }}>
                      {ensemble.pathsCompleted.toLocaleString('en-US')} of the {ensemble.pathsRequested.toLocaleString('en-US')} requested paths finished before
                      the run was stopped. Everything below — the bands, the Monte Carlo check and the first-passage figures — rests on those paths only, so it
                      is noisier than the requested path count implies. Run it again without cancelling for the precision you asked for.
                    </p>
                  </Notice>
                )}
                {ensemble && fan && !fan.ok && <Notice tone="error" title="No bands could be formed" items={fan.errors} />}
                {ensemble && fan && fan.ok && def && (
                  <PathBands
                    fan={fan.value}
                    yLabel={attempt(() => buildSampler(def, config).yLabel).ok ? buildSampler(def, config).yLabel : 'Value'}
                    xLabel={DISCRETE_TIME.has(def.id) ? 'Step n' : 'Time t'}
                  />
                )}
              </>
            )}
          </Card>

          {/* 4. First passage. */}
          <Card title="First passage: when does it breach the limit?" hint="The probability of crossing a level by the horizon, and the distribution of the crossing time.">
            <div className="oc-field">
              <NumberField
                label="Level to cross"
                symbol="a"
                value={config.passageLevel}
                onChange={(passageLevel) => set({ passageLevel })}
                hint="The analytic answer below exists for an upward crossing of Brownian motion and geometric Brownian motion."
              />
              <Segmented
                label="Direction of crossing"
                value={config.passageDirection}
                onChange={(passageDirection) => set({ passageDirection })}
                options={[
                  { value: 'above', label: 'Rises to a' },
                  { value: 'below', label: 'Falls to a' },
                ]}
              />
            </div>
            {exactPassage && !exactPassage.ok && <Notice tone="error" title="The analytic first-passage result failed" items={exactPassage.errors} />}
            {exactPassage && exactPassage.ok && exactPassage.value.quantities.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <DataTable caption="Analytic first-passage results" columns={QUANTITY_COLUMNS} rows={exactPassage.value.quantities} />
              </div>
            )}
            {exactPassage && exactPassage.ok && exactPassage.value.note && <Notice tone="info">{exactPassage.value.note}</Notice>}
            {!ensemble && <Notice tone="info">Run the path ensemble above to put the simulated crossing frequency beside the analytic answer.</Notice>}
            {passage && !passage.ok && <Notice tone="error" title="The simulated first-passage analysis failed" items={passage.errors} />}
            {passage && passage.ok && (
              <PassagePanel
                estimate={passage.value}
                analytic={exactPassage && exactPassage.ok ? exactPassage.value.cdf : null}
                direction={config.passageDirection}
              />
            )}
          </Card>

          {/* 5. Gambler's ruin. */}
          {config.processId === 'random-walk' && (
            <Card
              title="Gambler's ruin"
              hint="Absorbing barriers at 0 and N. Both the ruin probability and the expected duration are closed forms, so the simulation has something exact to agree with."
              actions={
                <Button
                  icon="play"
                  variant="primary"
                  disabled={ruinRun.status === 'running' || !def}
                  onClick={() => {
                    if (!def) return;
                    const total = Math.max(1, Math.round(config.ruinWalks));
                    const prob = paramOf(def, config.params, 'p');
                    ruinRun.start(total, (isCancelled) =>
                      gamblersRuinSimulationSteps(prob, config.ruinStart, config.ruinTarget, total, `${config.seed}-ruin`, 2_000_000, { isCancelled }),
                    );
                  }}
                >
                  {ruinRun.result ? 'Run again' : 'Simulate walks'}
                </Button>
              }
            >
              <NumberField label="Starting wealth" symbol="k" value={config.ruinStart} onChange={(ruinStart) => set({ ruinStart })} min={1} integer />
              <NumberField label="Target wealth" symbol="N" value={config.ruinTarget} onChange={(ruinTarget) => set({ ruinTarget })} min={2} integer />
              <NumberField label="Walks to simulate" value={config.ruinWalks} onChange={(ruinWalks) => set({ ruinWalks })} min={1} max={200000} integer />
              {ruin && !ruin.ok && <Notice tone="error" title="The ruin problem could not be solved" items={ruin.errors} />}
              {ruin && ruin.ok && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Exact gambler's-ruin results"
                      columns={QUANTITY_COLUMNS}
                      rows={[ruin.value.winProbability, ruin.value.ruinProbability, ruin.value.expectedDuration]}
                    />
                  </div>
                  <Notice tone="info" title="What these say" items={ruin.value.notes} />
                </>
              )}
              {ruinRun.status === 'running' && <RunningState completed={ruinRun.completed} total={ruinRun.total} unitLabel="walks" onCancel={ruinRun.cancel} />}
              {ruinRun.error && <Notice tone="error" title="The simulation failed" items={ruinRun.error} />}
              {ruinRun.result && ruin && ruin.ok && (
                <>
                  <KeyValueList
                    items={[
                      {
                        label: 'Simulated frequency of reaching N',
                        value: (
                          <span>
                            {formatPercent(ruinRun.result.winFrequency)} (95% interval {formatPercent(ruinRun.result.winInterval.low)} to{' '}
                            {formatPercent(ruinRun.result.winInterval.high)}) <Badge variant="empirical">empirical</Badge>
                          </span>
                        ),
                      },
                      {
                        label: 'Exact probability of reaching N',
                        value: (
                          <span>
                            {formatPercent(ruin.value.winProbability.value)} <Badge variant="exact">exact</Badge>
                          </span>
                        ),
                      },
                      {
                        label: 'Mean simulated duration',
                        value:
                          ruinRun.result.meanDuration === null ? (
                            'no resolved walk'
                          ) : (
                            <span>
                              {formatValue(ruinRun.result.meanDuration, 6)} steps <Badge variant="empirical">empirical</Badge>
                            </span>
                          ),
                      },
                      {
                        label: 'Exact expected duration',
                        value: (
                          <span>
                            {formatValue(ruin.value.expectedDuration.value, 6)} steps <Badge variant="exact">exact</Badge>
                          </span>
                        ),
                      },
                      { label: 'Walks resolved', value: `${(ruinRun.result.reachedTarget + ruinRun.result.ruined).toLocaleString('en-US')} of ${ruinRun.result.pathsUsed.toLocaleString('en-US')}` },
                    ]}
                  />
                  {ruinRun.result.warnings.length > 0 && <Notice tone="warning" items={ruinRun.result.warnings} />}
                </>
              )}
            </Card>
          )}

          {/* 6. Branching and extinction. */}
          {config.processId === 'galton-watson' && (
            <Card
              title="Branching and extinction"
              hint="The extinction probability is the smallest fixed point of the offspring generating function G."
              actions={
                <Button
                  icon="play"
                  variant="primary"
                  disabled={branchingRun.status === 'running'}
                  onClick={() => {
                    const total = Math.max(1, Math.round(config.lines));
                    const mean = config.offspringMean;
                    branchingRun.start(total, (isCancelled) =>
                      branchingSimulationSteps(
                        (rng: Random) => rng.poisson(mean),
                        Math.max(1, Math.round(config.initialPopulation)),
                        Math.max(1, Math.round(config.generations)),
                        total,
                        `${config.seed}-branching`,
                        // A line that reaches this many individuals is stopped
                        // and counted as not extinct. The previous cap of a
                        // million cost roughly a hundred times as much work
                        // and bought nothing: from a population of z the
                        // extinction probability is q^z, and with q < 1 that
                        // is already far below any digit this screen reports
                        // by z = 10,000. The old cap made a supercritical run
                        // (the default m = 1.4) block the page for tens of
                        // seconds per chunk, which is exactly how long Cancel
                        // went unanswered.
                        BRANCHING_POPULATION_CAP,
                        { isCancelled },
                        // A single line is the expensive unit here, not a
                        // thousand of them, so the runner yields after every
                        // few lines. Cancel is honoured at a yield.
                        BRANCHING_CHUNK_LINES,
                      ),
                    );
                  }}
                >
                  {branchingRun.result ? 'Run again' : 'Simulate lines'}
                </Button>
              }
            >
              <NumberField
                label="Mean offspring"
                symbol="m"
                value={config.offspringMean}
                onChange={(offspringMean) => set({ offspringMean })}
                min={0}
                step={0.05}
                hint="The offspring law here is Poisson(m). Extinction is certain if and only if m ≤ 1."
              />
              <NumberField label="Initial population" value={config.initialPopulation} onChange={(initialPopulation) => set({ initialPopulation })} min={1} integer />
              <NumberField
                label="Generation cap"
                value={config.generations}
                onChange={(generations) => set({ generations })}
                min={1}
                max={10000}
                integer
                hint="A line still alive at the cap is counted as not yet extinct, so the simulated frequency is a lower bound."
              />
              <NumberField label="Lines to simulate" value={config.lines} onChange={(lines) => set({ lines })} min={1} max={200000} integer />
              {branching && !branching.ok && <Notice tone="error" title="The extinction probability could not be computed" items={branching.errors} />}
              {branching && branching.ok && (
                <>
                  <KeyValueList
                    items={[
                      { label: 'Mean offspring m', value: formatValue(branching.value.extinction.mean, 6) },
                      { label: 'Regime', value: branching.value.extinction.regime },
                      {
                        label: 'P(extinction)',
                        value: (
                          <span>
                            {formatPercent(branching.value.extinction.probability)}{' '}
                            <Badge variant={branching.value.extinction.exactness}>{branching.value.extinction.exactness}</Badge>
                          </span>
                        ),
                      },
                      { label: 'Found by', value: branching.value.extinction.formula },
                      { label: 'Fixed-point iterations', value: branching.value.extinction.iterations.toLocaleString('en-US') },
                    ]}
                  />
                  <Notice tone="info" title="The criticality rule">
                    <p style={{ margin: 0 }}>
                      Extinction is certain if and only if the mean offspring m is at most 1 (the degenerate law in which every individual has exactly one child
                      is the single exception). Above 1 the extinction probability is the smallest root of G(s) = s in [0, 1), found by iterating q ← G(q) from 0
                      — which is why it is labelled numerical, not exact. {branching.value.extinction.note}
                    </p>
                  </Notice>
                </>
              )}
              {branchingRun.status === 'running' && (
                <RunningState completed={branchingRun.completed} total={branchingRun.total} unitLabel="lines" onCancel={branchingRun.cancel} />
              )}
              {branchingRun.error && <Notice tone="error" title="The simulation failed" items={branchingRun.error} />}
              {branchingRun.result && branching && branching.ok && (
                <>
                  <KeyValueList
                    items={[
                      {
                        label: 'Simulated extinction frequency',
                        value: (
                          <span>
                            {formatPercent(branchingRun.result.extinctionFrequency)} (95% interval {formatPercent(branchingRun.result.extinctionInterval.low)} to{' '}
                            {formatPercent(branchingRun.result.extinctionInterval.high)}) <Badge variant="empirical">empirical</Badge>
                          </span>
                        ),
                      },
                      {
                        label: 'Against the fixed point',
                        value: (
                          <span>
                            {formatPercent(branching.value.extinction.probability)}{' '}
                            <Badge variant={branching.value.extinction.exactness}>{branching.value.extinction.exactness}</Badge>
                          </span>
                        ),
                      },
                      { label: 'Lines still alive at the cap', value: branchingRun.result.survivedToCap.toLocaleString('en-US') },
                      {
                        label: 'Mean generation of extinction',
                        value: branchingRun.result.meanExtinctionGeneration === null ? 'no line died out' : formatValue(branchingRun.result.meanExtinctionGeneration, 5),
                      },
                    ]}
                  />
                  <Notice tone="warning" items={branchingRun.result.warnings} />
                </>
              )}
            </Card>
          )}

          {/* 7. Continuous-time Markov chains. */}
          {config.processId === 'ctmc' && (
            <Card title="Continuous-time Markov chain" hint="A generator matrix of rates: every row sums to zero, not to one.">
              <GeneratorEditor config={config} set={set} />
              <NumberField label="Time for the transient distribution" symbol="t" value={config.ctmcTime} onChange={(ctmcTime) => set({ ctmcTime })} min={0} />
              <SelectField
                label="Starting state"
                value={String(config.ctmcInitialState)}
                onChange={(v) => set({ ctmcInitialState: Number(v) })}
                options={config.ctmcStates.map((s, i) => ({ value: String(i), label: s }))}
              />
              <SelectField
                label="State to reach (for expected hitting times)"
                value={String(config.ctmcTargetState)}
                onChange={(v) => set({ ctmcTargetState: Number(v) })}
                options={config.ctmcStates.map((s, i) => ({ value: String(i), label: s }))}
              />
              {ctmc && !ctmc.ok && <Notice tone="error" title="The chain could not be analysed" items={ctmc.errors} />}
              {ctmc && ctmc.ok && <CtmcResults result={ctmc.value} states={config.ctmcStates} config={config} />}
            </Card>
          )}

          {/* 8. Explanation. */}
          {explanation && <ExplanationPanel explanation={explanation} />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

const CATEGORY_LABEL: Record<ProcessDefinition['category'], string> = {
  counting: 'counting process',
  diffusion: 'diffusion',
  'discrete-time': 'discrete time',
  'markov-jump': 'Markov jump process',
};

const QUANTITY_COLUMNS: ColumnDef<Quantity>[] = [
  { key: 'label', header: 'Quantity', render: (q) => <span style={{ overflowWrap: 'anywhere' }}>{q.label}</span> },
  { key: 'value', header: 'Value', numeric: true, render: (q) => formatValue(q.value, 7) },
  { key: 'basis', header: 'Basis', render: (q) => <Badge variant={q.exactness}>{q.exactness}</Badge> },
  {
    key: 'formula',
    header: 'How',
    render: (q) => (
      <span style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
        {q.formula ?? '—'}
        {q.note ? ` — ${q.note}` : ''}
      </span>
    ),
  },
];

/** Parameters that belong to a panel rather than to the process definition. */
function ExtraParameters({ config, set }: { config: ProcessesConfig; set(patch: Partial<ProcessesConfig>): void }) {
  switch (config.processId) {
    case 'nhpp':
      return (
        <>
          <NumberField label="Baseline intensity" value={config.intensityBase} onChange={(intensityBase) => set({ intensityBase })} min={0} step={0.1} hint="The floor of λ(t)." />
          <NumberField
            label="Intensity swing"
            value={config.intensityAmplitude}
            onChange={(intensityAmplitude) => set({ intensityAmplitude })}
            min={0}
            step={0.1}
            hint="Peak-to-trough variation added by the sine term."
          />
          <NumberField label="Cycle length" value={config.intensityPeriod} onChange={(intensityPeriod) => set({ intensityPeriod })} min={1e-6} step={0.5} hint="Period of the cycle in λ(t)." />
          {config.params.bound !== undefined && config.params.bound < intensityPeak(config) && (
            <Notice tone="warning" title="The thinning bound is too low">
              <p style={{ marginTop: 0 }}>
                λ(t) peaks at {formatValue(intensityPeak(config), 6)}, above the bound λ* = {formatValue(config.params.bound, 6)}. Simulating by thinning with
                too small a bound would quietly produce a different process, so the engine refuses to produce paths.
              </p>
              <Button onClick={() => set({ params: { ...config.params, bound: intensityPeak(config) } })}>Set λ* to {formatValue(intensityPeak(config), 6)}</Button>
            </Notice>
          )}
        </>
      );
    case 'compound-poisson':
      return (
        <>
          <NumberField label="Jump log-mean" symbol="μ_J" value={config.jumpLogMean} onChange={(jumpLogMean) => set({ jumpLogMean })} step={0.1} hint="Mean of log J: the jump size is log-normal." />
          <NumberField label="Jump log-SD" symbol="σ_J" value={config.jumpLogSd} onChange={(jumpLogSd) => set({ jumpLogSd })} min={1e-9} step={0.1} hint="Standard deviation of log J." />
        </>
      );
    case 'renewal-process':
      return (
        <>
          <NumberField label="Interarrival shape" symbol="k" value={config.renewalShape} onChange={(renewalShape) => set({ renewalShape })} min={1e-6} step={0.5} hint="Gamma shape. k = 1 is the exponential case, i.e. a Poisson process; k > 1 is more regular than random." />
          <NumberField label="Interarrival scale" symbol="θ" value={config.renewalScale} onChange={(renewalScale) => set({ renewalScale })} min={1e-9} step={0.05} hint="Gamma scale; the mean interarrival time is kθ." />
        </>
      );
    default:
      return null;
  }
}

/**
 * The two bands, each in its own chart with its own `bandMeaning`, plus the
 * root-n relationship between their widths measured on the actual ensemble.
 */
function PathBands({
  fan,
  yLabel,
  xLabel,
}: {
  fan: ReturnType<typeof fanChart>;
  yLabel: string;
  xLabel: string;
}) {
  const last = fan.times.length - 1;
  const pathWidth = fan.pathBand.high[last] - fan.pathBand.low[last];
  const meanWidth = fan.meanBand.high[last] - fan.meanBand.low[last];
  const ratio = meanWidth > 0 ? pathWidth / meanWidth : null;
  const level = `${(fan.pathBand.level * 100).toFixed(0)}%`;
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <FanChart
          title={`Where ${level} of individual paths lie`}
          description={`The ${level} band of simulated path values at each time, with the mean path through the middle.`}
          x={fan.times}
          bands={[{ label: `${level} of paths`, lower: fan.pathBand.low, upper: fan.pathBand.high }]}
          center={{ label: 'Mean of the simulated paths', values: fan.meanPath }}
          bandMeaning="paths"
          xLabel={xLabel}
          yLabel={yLabel}
          note={fan.pathBand.meaning}
        />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <FanChart
          title={`Confidence interval for the MEAN path (${level})`}
          description={`A ${level} confidence interval for E[X(t)] at each time, from Monte Carlo sampling error alone.`}
          x={fan.times}
          bands={[{ label: `${level} interval for the mean`, lower: fan.meanBand.low, upper: fan.meanBand.high }]}
          center={{ label: 'Mean of the simulated paths', values: fan.meanPath }}
          bandMeaning="mean-uncertainty"
          xLabel={xLabel}
          yLabel={yLabel}
          note={fan.meanBand.meaning}
        />
      </div>
      <Notice tone="info" title="These two bands are different statements">
        <p style={{ marginTop: 0 }}>
          The first band says where individual trajectories lie; it does not narrow however many paths you run, because it is a property of the process. The
          second says where the average lies; it is a property of the simulation and narrows like 1/√n.
        </p>
        <p style={{ marginBottom: 0 }}>
          At the final time the path band is {formatValue(pathWidth, 6)} wide and the mean interval {formatValue(meanWidth, 6)} wide, a ratio of{' '}
          {ratio === null ? 'undefined (the mean interval has zero width)' : formatValue(ratio, 5)}. With {fan.pathsUsed.toLocaleString('en-US')} paths the
          expected ratio is about √n = {formatValue(Math.sqrt(fan.pathsUsed), 5)}, because the path band is roughly ±z·s while the mean interval is ±z·s/√n.
        </p>
      </Notice>
      {fan.warnings.length > 0 && <Notice tone="warning" items={fan.warnings} />}
    </>
  );
}

function PassagePanel({
  estimate,
  analytic,
  direction,
}: {
  estimate: FirstPassageEstimate;
  analytic: { label: string; points: { x: number; y: number }[] } | null;
  direction: 'above' | 'below';
}) {
  const empiricalCurve = estimate.crossingTimeQuantiles.map((q) => ({ x: q.t, y: q.p * estimate.probability }));
  return (
    <>
      <KeyValueList
        items={[
          {
            label: `Simulated P(crossing ${direction === 'above' ? 'up to' : 'down to'} the level by the horizon)`,
            value: (
              <span>
                {formatPercent(estimate.probability)} (95% interval {formatPercent(estimate.probabilityInterval.low)} to{' '}
                {formatPercent(estimate.probabilityInterval.high)}) <Badge variant="empirical">empirical</Badge>
              </span>
            ),
          },
          { label: 'Paths that crossed', value: `${estimate.crossed.toLocaleString('en-US')} of ${estimate.pathsUsed.toLocaleString('en-US')}` },
          {
            label: 'Mean crossing time, among paths that crossed',
            value: estimate.meanCrossingTime === null ? 'no path crossed' : formatValue(estimate.meanCrossingTime, 6),
          },
        ]}
      />
      {estimate.crossingTimeQuantiles.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            caption="Quantiles of the crossing time, conditional on crossing"
            columns={[
              { key: 'p', header: 'Quantile', render: (row: { p: number; t: number }) => formatPercent(row.p) },
              { key: 't', header: 'Crossing time', numeric: true, render: (row: { p: number; t: number }) => formatValue(row.t, 6) },
            ]}
            rows={estimate.crossingTimeQuantiles}
          />
        </div>
      )}
      {(analytic || empiricalCurve.length > 0) && (
        <LineChart
          title="Probability of having crossed by time t"
          description="The analytic reflection-principle answer, where one exists, beside the simulated crossing times."
          series={[
            ...(analytic ? [{ label: `${analytic.label} (exact)`, points: analytic.points }] : []),
            ...(empiricalCurve.length > 0 ? [{ label: 'Simulated P(crossed by t)', points: empiricalCurve, dashed: true }] : []),
          ]}
          xLabel="Time t"
          yLabel="P(crossed by t)"
          yDomain={[0, 1]}
          note="The simulated curve is the unconditional probability of having crossed by t, built from the conditional crossing-time quantiles multiplied by the overall crossing frequency. It can only fall below the exact curve, because a crossing between two grid points is invisible."
        />
      )}
      <Notice tone="info" title="How to read this" items={estimate.notes} />
      {estimate.warnings.length > 0 && <Notice tone="warning" items={estimate.warnings} />}
    </>
  );
}

/**
 * Generator editor. Only the off-diagonal rates are editable and the diagonal
 * is shown as minus their sum, because a generator's rows sum to ZERO by
 * definition — unlike a transition matrix, whose rows sum to one. The row-sum
 * column gives the same feedback as `MatrixEditor`, with an icon as well as
 * colour so the signal is not carried by colour alone.
 */
function GeneratorEditor({ config, set }: { config: ProcessesConfig; set(patch: Partial<ProcessesConfig>): void }) {
  const n = config.ctmcStates.length;
  const rates = config.ctmcRates;

  const setCell = (i: number, j: number, value: number) => {
    set({ ctmcRates: rates.map((row, ri) => (ri === i ? row.map((v, cj) => (cj === j ? value : v)) : [...row])) });
  };
  const renameState = (i: number, name: string) => {
    set({ ctmcStates: config.ctmcStates.map((s, j) => (j === i ? name : s)) });
  };
  const addState = () => {
    set({
      ctmcStates: [...config.ctmcStates, `State ${n + 1}`],
      ctmcRates: [...rates.map((row) => [...row, 0]), new Array<number>(n + 1).fill(0)],
    });
  };
  const removeState = (i: number) => {
    const keep = <T,>(arr: T[]) => arr.filter((_, j) => j !== i);
    set({
      ctmcStates: keep(config.ctmcStates),
      ctmcRates: keep(rates).map((row) => keep(row)),
      ctmcInitialState: Math.min(config.ctmcInitialState, n - 2),
      ctmcTargetState: Math.min(config.ctmcTargetState, n - 2),
    });
  };

  return (
    <div className="oc-field">
      <span className="oc-field__label">Transition rates (generator Q)</span>
      <p className="oc-field__hint" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
        Row <em>i</em>, column <em>j</em> is the rate q<sub>ij</sub> of jumping from state <em>i</em> to state <em>j</em> — a rate per unit time, not a
        probability, so it is not capped at 1. Each diagonal entry is minus the total of its row, so <strong>every row sums to zero</strong>; it is shown here
        rather than typed.
      </p>
      <div style={{ overflowX: 'auto', paddingBottom: 'var(--s2)' }}>
        <div className="oc-matrix-grid" style={{ gridTemplateColumns: `minmax(90px, 120px) repeat(${n}, minmax(62px, 1fr)) 72px 28px`, minWidth: 'max-content' }}>
          <div />
          {config.ctmcStates.map((s, j) => (
            <div key={`h-${j}`} className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`To ${s}`}>
              {s}
            </div>
          ))}
          <div className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            Row sum
          </div>
          <div />
          {config.ctmcStates.map((s, i) => {
            const off = (rates[i] ?? []).map((v, j) => (i === j ? 0 : v));
            const total = off.reduce((a, b) => a + (Number.isFinite(b) ? b : NaN), 0);
            const bad = !Number.isFinite(total) || off.some((v) => v < 0);
            return (
              <div key={`r-${i}`} style={{ display: 'contents' }}>
                <input
                  className="oc-matrix-input"
                  style={{ textAlign: 'left' }}
                  value={s}
                  maxLength={40}
                  aria-label={`Name of state ${i + 1}`}
                  onChange={(e) => renameState(i, e.target.value)}
                />
                {config.ctmcStates.map((_, j) =>
                  i === j ? (
                    <div key={`c-${i}-${j}`} className="oc-matrix-cell" style={{ color: 'var(--text-muted)' }} title={`Derived: minus the total exit rate from ${s}`}>
                      {Number.isFinite(total) ? (-total).toFixed(3) : '—'}
                    </div>
                  ) : (
                    <RawNumberInput
                      key={`c-${i}-${j}`}
                      value={rates[i]?.[j] ?? 0}
                      min={0}
                      ariaLabel={`Rate of jumping from ${s} to ${config.ctmcStates[j]}`}
                      onChange={(v) => setCell(i, j, v)}
                    />
                  ),
                )}
                <div
                  className="oc-matrix-cell"
                  style={{ color: bad ? 'var(--status-warning)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
                  title={bad ? 'A rate is negative or not a number' : 'This row sums to zero, as a generator must'}
                >
                  {bad && <Icon name="alert" size={11} />}
                  {bad ? '—' : '0.000'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {n > 2 && <Button icon="trash" size="sm" variant="ghost" title={`Remove ${s}`} onClick={() => removeState(i)} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="oc-btn-row" style={{ marginTop: 'var(--s2)' }}>
        <Button icon="plus" size="sm" disabled={n >= 8} onClick={addState}>
          Add a state
        </Button>
        {n >= 8 && (
          <span className="oc-muted" style={{ fontSize: 11.5, alignSelf: 'center' }}>
            Maximum 8 states in this editor.
          </span>
        )}
      </div>
    </div>
  );
}

interface CtmcComputed {
  transient: ReturnType<typeof ctmcTransient>;
  stationary: ReturnType<typeof ctmcStationary>;
  hitting: ReturnType<typeof ctmcHittingTimes>;
  occupancy: { t: number; distribution: number[] }[];
}

/** P(t), π, expected hitting times and the occupancy curve. All numerical. */
function ctmcResults(config: ProcessesConfig): CtmcComputed {
  const Q = buildGenerator(config);
  const n = Q.length;
  const initialState = Math.min(Math.max(0, Math.round(config.ctmcInitialState)), n - 1);
  const initial = Array.from({ length: n }, (_, i) => (i === initialState ? 1 : 0));
  const transient = ctmcTransient(Q, Math.max(0, config.ctmcTime), initial);
  const stationary = ctmcStationary(Q);
  const hitting = ctmcHittingTimes(Q, [Math.min(Math.max(0, Math.round(config.ctmcTargetState)), n - 1)]);
  // A few dozen small matrix exponentials: milliseconds, so this stays with
  // the analytic results rather than behind the simulation button.
  const horizon = Math.max(config.ctmcTime, 1) * 2;
  const points = 31;
  const occupancy = Array.from({ length: points }, (_, j) => {
    const t = (horizon * j) / (points - 1);
    const step = ctmcTransient(Q, t, initial);
    return { t, distribution: step.distribution ?? [] };
  });
  return { transient, stationary, hitting, occupancy };
}

function CtmcResults({ result, states, config }: { result: CtmcComputed; states: string[]; config: ProcessesConfig }) {
  const rows = states.map((s, i) => ({
    state: s,
    transient: result.transient.distribution?.[i] ?? NaN,
    stationary: result.stationary.distribution[i] ?? NaN,
    hitting: result.hitting.expected[i] ?? NaN,
  }));
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <DataTable
          caption="Transient distribution, stationary distribution and expected hitting times"
          columns={[
            { key: 'state', header: 'State', render: (r) => r.state },
            { key: 'pt', header: `P(X(${formatValue(config.ctmcTime, 4)}) = state)`, numeric: true, render: (r) => formatPercent(r.transient) },
            { key: 'pi', header: 'Stationary π', numeric: true, render: (r) => formatPercent(r.stationary) },
            { key: 'h', header: `E[time to reach ${states[Math.min(Math.max(0, Math.round(config.ctmcTargetState)), states.length - 1)]}]`, numeric: true, render: (r) => formatValue(r.hitting, 6) },
          ]}
          rows={rows}
        />
      </div>
      <KeyValueList
        items={[
          { label: 'P(t) computed by', value: <span>{result.transient.method} <Badge variant="numerical">numerical</Badge></span> },
          { label: 'Largest |row sum − 1| of P(t)', value: result.transient.rowSumError.toExponential(3) },
          { label: 'Stationary distribution from', value: <span>{result.stationary.formula} <Badge variant="numerical">numerical</Badge></span> },
          { label: 'Residual of πQ = 0', value: result.stationary.residual.toExponential(3) },
          { label: 'Hitting times from', value: <span>{result.hitting.formula} <Badge variant="numerical">numerical</Badge></span> },
        ]}
      />
      <div style={{ overflowX: 'auto' }}>
        <LineChart
          title="State occupancy over time"
          description="P(X(t) = state) for each state, from exp(Qt) applied to the chosen starting state."
          series={states.map((s, i) => ({ label: s, points: result.occupancy.map((row) => ({ x: row.t, y: row.distribution[i] ?? NaN })) }))}
          xLabel="Time t"
          yLabel="P(X(t) = state)"
          yDomain={[0, 1]}
          note="Each curve starts at the starting state and settles towards the stationary distribution in the table above. The curves are numerical (matrix exponential), not closed forms."
        />
      </div>
      {result.transient.warnings.length > 0 && <Notice tone="warning" items={result.transient.warnings} />}
      {result.stationary.warnings.length > 0 && <Notice tone="warning" items={result.stationary.warnings} />}
      <Notice tone="info" title="Reading the hitting times" items={result.hitting.notes} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Analytic first passage and the explanation
 * ------------------------------------------------------------------ */

interface ExactPassage {
  quantities: Quantity[];
  cdf: { label: string; points: { x: number; y: number }[] } | null;
  note: string | null;
}

/**
 * The analytic first-passage answer where the engine has one: the reflection
 * principle for Brownian motion, and the same result applied to log S for
 * geometric Brownian motion.
 */
function exactPassageResult(def: ProcessDefinition, config: ProcessesConfig): ExactPassage {
  const p = (key: string) => paramOf(def, config.params, key);
  const t = config.horizon;
  const curvePoints = 40;
  if (config.passageDirection === 'below') {
    return {
      quantities: [],
      cdf: null,
      note: 'The engine provides the reflection-principle result for an upward crossing. For a downward one, mirror the process (negate the drift, the start and the level) or read the simulated result below, which handles either direction.',
    };
  }
  if (def.id === 'brownian-motion') {
    const params = { x0: p('x0'), drift: p('drift'), volatility: p('volatility') };
    if (!(config.passageLevel > params.x0)) {
      return { quantities: [], cdf: null, note: `The level a = ${formatValue(config.passageLevel, 6)} is at or below the start x₀ = ${formatValue(params.x0, 6)}, so first passage happens at time 0. Choose a level above the start.` };
    }
    const law = brownianFirstPassage(params, config.passageLevel);
    const points = Array.from({ length: curvePoints }, (_, j) => {
      const tj = (t * (j + 1)) / curvePoints;
      return { x: tj, y: law.cdf(tj).value };
    });
    return {
      quantities: [brownianRunningMaxSf(params, config.passageLevel, t), brownianMarginalSf(params, config.passageLevel, t)],
      cdf: { label: 'P(T_a ≤ t)', points },
      note:
        params.drift === 0
          ? 'With no drift the reflection principle gives exactly P(max ≤ t crosses a) = 2·P(X(t) ≥ a), which is why the first row is twice the second. Any difference between that and the simulated frequency is grid resolution and Monte Carlo error, nothing else.'
          : 'With drift the reflection principle gains the exponential term (Bachelier–Lévy); the running-maximum probability is strictly above the marginal tail, because a path can cross the level and come back.',
    };
  }
  if (def.id === 'gbm') {
    const params = { s0: p('s0'), drift: p('drift'), volatility: p('volatility') };
    if (!(config.passageLevel > 0)) {
      return { quantities: [], cdf: null, note: 'Geometric Brownian motion is strictly positive, so the level must be above 0.' };
    }
    const points = Array.from({ length: curvePoints }, (_, j) => {
      const tj = (t * (j + 1)) / curvePoints;
      return { x: tj, y: gbmFirstPassageProbability(params, config.passageLevel, tj).value };
    });
    return {
      quantities: [gbmFirstPassageProbability(params, config.passageLevel, t), gbmMarginalSf(params, config.passageLevel, t)],
      cdf: { label: 'P(max S ≥ a by t)', points },
      note: 'log is strictly increasing, so S crosses the level exactly when log S crosses log(a/S₀); the reflection principle is applied to log S, which drifts at μ − σ²/2, not at μ.',
    };
  }
  return {
    quantities: [],
    cdf: null,
    note: `This module has no closed-form first-passage law for ${def.name}, so only the simulated estimate is shown. The engine lists its exact first-passage processes as Brownian motion, geometric Brownian motion and the random walk (through the gambler's-ruin formulas).`,
  };
}

function buildExplanation(def: ProcessDefinition, config: ProcessesConfig): Explanation {
  const steps = [
    {
      label: 'Closed forms first',
      expression: def.formula,
      value: `Marginal laws, stationary laws, ruin probabilities and reflection-principle first-passage probabilities are exact: ${def.exactResults.length} closed form(s) for this process.`,
    },
    {
      label: 'Numerical results',
      expression: 'exp(Qt), ∫λ(s) ds, fixed-point iteration q ← G(q)',
      value: 'Matrix exponentials, numerical integrals of an intensity and the extinction fixed point are labelled numerical: deterministic, but approximate.',
    },
    {
      label: 'Simulated paths',
      expression: `${Math.max(2, Math.round(config.paths))} paths on a grid of ${buildGridSizeText(config)}, seed "${config.seed}"`,
      value: 'Empirical, with Monte Carlo error. The mean band narrows like 1/√n; the path band does not narrow at all, because it describes the process.',
    },
    {
      label: 'The geometric-Brownian-motion convention',
      expression: 'log(S(t)/S₀) ~ Normal((μ − σ²/2)t, σ²t), E[S(t)] = S₀e^{μt}',
      value:
        'μ is the drift of dS/S, not of log S. The −σ²/2 Itô correction means the median S₀e^{(μ−σ²/2)t} is strictly below the mean S₀e^{μt}, and with σ² > 2μ the median falls while the mean rises. A tool that takes μ as a log-return drift will give different numbers for the same inputs.',
    },
  ];
  return {
    method: `${def.name}: ${def.stateSpaceText}`,
    formula: def.formula,
    steps,
    assumptions: def.assumptions,
    limitations: [
      ...def.limitations,
      'A crossing that happens and reverses between two grid points is invisible to the simulation, so every simulated first-passage probability is a lower bound.',
      'A band containing 90% of simulated paths and a 90% confidence interval for the mean path are different statements; they are shown in separate charts here and should never be read as one.',
    ],
    exactness: 'exact',
  };
}

function buildGridSizeText(config: ProcessesConfig): string {
  if (DISCRETE_TIME.has(config.processId)) return `${Math.max(1, Math.round(config.horizon))} whole steps`;
  return `${Math.max(2, Math.min(2000, Math.round(config.gridPoints)))} times up to T = ${formatValue(config.horizon, 6)}`;
}
