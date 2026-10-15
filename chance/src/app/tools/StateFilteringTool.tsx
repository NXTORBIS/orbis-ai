/**
 * State-space filtering: Kalman filter, EM fitting and filter diagnostics.
 *
 * Every number on this screen comes from `src/engine/filtering/`. Nothing is
 * recomputed here and nothing is substituted when the engine refuses: an
 * `EngineError` is shown as the engine's own message, per panel, so one failed
 * computation does not blank the rest of the screen.
 *
 * Two distinctions this screen is careful about, because they are easy to
 * conflate and the project forbids conflating them:
 *  - uncertainty in the STATE (the filtered covariance, a confidence statement
 *    about an estimate) versus the predictive spread of the next OBSERVATION,
 *    which also contains measurement noise. They are shown in separate panels
 *    with separate labels.
 *  - a known true state only exists because the series is simulated here. NEES
 *    and interval coverage say so, and they are not offered as something
 *    available on real data.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extendedKalmanFilter,
  innovationWhiteness,
  intervalCoverage,
  kalmanFilter,
  kalmanLogLikelihood,
  maximiseLikelihoodSteps,
  constantVelocityTracker,
  localLevel,
  localLinearTrend,
  nees,
  noisyPendulum,
  linearGaussianAsParticleModel,
  sequentialImportanceResamplingSteps,
  simulateLinearGaussian,
  simulateNonlinear,
  univariateGrowth,
  unscentedKalmanFilter,
  type CovarianceForm,
  type DirectFitResult,
  type LinearGaussianModel,
  type NonlinearFilterResult,
  type NonlinearModel,
  type Observation,
  type ParticleFilterResult,
  type ResamplingScheme,
} from '../../engine/filtering';
import { EXACTNESS_LABEL } from '../../engine/core/result';
import { normalQuantile } from '../../engine/special/gamma';
import { Random } from '../../engine/random/rng';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  RunningState,
  SelectField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { LineChart } from '../../ui/charts/charts';
import { FanChart } from '../../ui/charts/advanced';
import { formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useEngineJob } from '../shared/useEngineJob';
import { EngineJobPanel } from '../shared/EngineJobPanel';
import { useApp } from '../store';

/**
 * Ranges for the knobs that drive a loop count or a series length. A
 * `NumberField` reports whatever was typed and shows its own out-of-range
 * message beside the field, but it does not clamp, so a typed "1e9" would
 * otherwise reach the simulator and freeze the tab permanently. Each such
 * knob is read through `withinRange`, the fields declare the same limits, and
 * a value outside them is reported rather than quietly used.
 */
const KNOB_LIMITS = {
  steps: { min: 2, max: 2000, label: 'Time steps' },
  whitenessLags: { min: 0, max: 200, label: 'Lags for the whiteness test' },
  emMaxIterations: { min: 1, max: 500, label: 'Maximum EM iterations' },
  directMaxIterations: { min: 10, max: 5000, label: 'Maximum Nelder-Mead iterations' },
  nonlinearSteps: { min: 2, max: 2000, label: 'Time steps (non-linear series)' },
  particleCount: { min: 1, max: 50000, label: 'Particles' },
} as const;

type KnobName = keyof typeof KNOB_LIMITS;

function withinRange(name: KnobName, value: number): number {
  const { min, max } = KNOB_LIMITS[name];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export type FilteringModelKind = 'local-level' | 'local-linear-trend' | 'constant-velocity';

export interface StateFilteringConfig {
  /** Which linear-Gaussian model from the engine's model library is used. */
  modelKind: FilteringModelKind;
  /** Number of simulated time steps. The truth is known only because it is simulated. */
  steps: number;
  /** Seed for the simulated path, so every figure is reproducible. */
  seed: string;
  /** Standard deviation of the level's random walk (local level and local linear trend). */
  levelNoise: number;
  /** Standard deviation of the slope's random walk (local linear trend). */
  slopeNoise: number;
  /** Standard deviation of the measurement, every model. */
  measurementNoise: number;
  /** Time between measurements (constant-velocity tracker). */
  dt: number;
  /** Acceleration noise driving the velocity (constant-velocity tracker). */
  accelerationNoise: number;
  /** Covariance update form; 'naive' exists to show that it degrades. */
  covarianceForm: CovarianceForm;
  /** First step (1-based) of a deliberate gap in the observations. 0 means no gap. */
  missingFrom: number;
  /** Length of that gap in steps. */
  missingCount: number;
  /** Interval level shared by the state band, the whiteness test, NEES and coverage. */
  level: number;
  /** Lags for the innovation whiteness test. 0 lets the engine choose. */
  whitenessLags: number;
  /** Which state component the charts and the coverage highlight follow. */
  focusState: number;
  /**
   * Whether to fit the model by EM. Off by default: EM runs a full Kalman
   * smoother per iteration, so a few hundred iterations on a few hundred steps
   * is seconds of blocked main thread. Two screens in this app once shipped
   * exactly that freeze, so this is something you ask for.
   */
  runEmFit: boolean;
  emMaxIterations: number;
  /**
   * Whether to maximise the exact likelihood directly by Nelder-Mead. Off by
   * default for the same reason: every trial point is a complete Kalman filter
   * run and the search makes hundreds of them.
   */
  runDirectFit: boolean;
  directMaxIterations: number;

  /* ---------------------------------------------- the non-linear section */
  /**
   * Which genuinely non-linear model from the engine's library the EKF and
   * UKF section runs on. Both entries are `kind: 'nonlinear'` in
   * `FILTERING_MODELS`; nothing here invents a model the engine cannot run.
   */
  nonlinearModel: NonlinearModelKind;
  /** What the pendulum measures. 'sine' adds a non-linear measurement. */
  pendulumMeasure: 'angle' | 'sine';
  /** Steps of the simulated non-linear series. */
  nonlinearSteps: number;
  /** Seed for the non-linear path. */
  nonlinearSeed: string;
  /** Process-noise standard deviation of the non-linear model. */
  nonlinearProcessNoise: number;
  /** Measurement-noise standard deviation of the non-linear model. */
  nonlinearMeasurementNoise: number;
  /** Pendulum amplitude: at large angles sin θ is nowhere near θ. */
  pendulumInitialAngle: number;
  /** Logistic growth rate and capacity. */
  growthRate: number;
  growthCapacity: number;
  /**
   * Drop the analytic Jacobians so the EKF has to use finite differences. The
   * engine then reports `numericalJacobian` and says what that costs; this
   * exists so that report is reachable rather than theoretical.
   */
  useNumericalJacobian: boolean;
  /** Which of the two non-linear filters the detail panels follow. */
  nonlinearFilter: 'ekf' | 'ukf';
  /** State component the non-linear charts follow. */
  nonlinearFocusState: number;

  /* -------------------------------------------------- the particle filter */
  /**
   * Whether to run the particle filter. Off by default: it is N complete
   * model evaluations per step, so a few thousand particles over a few
   * hundred steps is far past 300 ms, and it is driven as a yielding
   * generator rather than one synchronous loop.
   */
  runParticleFilter: boolean;
  particleCount: number;
  particleScheme: ResamplingScheme;
  /** Resample when ESS/N falls below this. */
  particleEssThreshold: number;
  /** ESS/N below this makes the engine flag the step as degenerate. */
  particleDegeneracyThreshold: number;
  /** Use the auxiliary (look-ahead) filter rather than the bootstrap filter. */
  particleAuxiliary: boolean;
  /** Seed for the particle filter's own randomness. */
  particleSeed: string;
}

export const STATE_FILTERING_DEFAULT: StateFilteringConfig = {
  modelKind: 'constant-velocity',
  steps: 120,
  seed: 'filter-1',
  levelNoise: 1,
  slopeNoise: 0.1,
  measurementNoise: 2,
  dt: 1,
  accelerationNoise: 0.3,
  covarianceForm: 'joseph',
  missingFrom: 41,
  missingCount: 8,
  level: 0.95,
  whitenessLags: 0,
  focusState: 0,
  runEmFit: false,
  emMaxIterations: 60,
  runDirectFit: false,
  directMaxIterations: 400,
  nonlinearModel: 'noisy-pendulum',
  pendulumMeasure: 'sine',
  nonlinearSteps: 120,
  // These defaults are chosen so the lesson is visible on arrival rather than
  // only reachable: at this amplitude and disturbance the EKF's mean NEES is
  // reported inconsistent and its whiteness p-value falls, while the UKF on
  // the same data stays consistent. The EKF's own covariance says nothing.
  nonlinearSeed: 'pendulum-2',
  nonlinearProcessNoise: 1.5,
  nonlinearMeasurementNoise: 0.2,
  pendulumInitialAngle: 3,
  growthRate: 0.35,
  growthCapacity: 100,
  useNumericalJacobian: false,
  nonlinearFilter: 'ukf',
  nonlinearFocusState: 0,
  runParticleFilter: false,
  particleCount: 2000,
  particleScheme: 'systematic',
  particleEssThreshold: 0.5,
  particleDegeneracyThreshold: 0.1,
  particleAuxiliary: false,
  particleSeed: 'particles-1',
};

export type NonlinearModelKind = 'noisy-pendulum' | 'univariate-growth';

const NONLINEAR_MODEL_OPTIONS: { value: NonlinearModelKind; label: string; note: string }[] = [
  {
    value: 'noisy-pendulum',
    label: 'Noisy pendulum',
    note:
      'Strongly non-linear. At large amplitude the EKF linearisation about the current estimate is poor, and its ' +
      'covariance — computed from that linearisation — does not know it.',
  },
  {
    value: 'univariate-growth',
    label: 'Logistic growth',
    note: 'Saturating growth. The filter uncertainty depends strongly on where the state currently is, which a linear filter cannot express.',
  },
];

const SCHEME_OPTIONS: { value: ResamplingScheme; label: string }[] = [
  { value: 'systematic', label: 'Systematic — lowest count variance of the four' },
  { value: 'stratified', label: 'Stratified — one draw per 1/N stratum' },
  { value: 'residual', label: 'Residual — deterministic copies, remainder by multinomial' },
  { value: 'multinomial', label: 'Multinomial — simplest and highest variance' },
];

const MODEL_OPTIONS: { value: FilteringModelKind; label: string; note: string }[] = [
  {
    value: 'local-level',
    label: 'Local level (random walk plus noise)',
    note: 'One state. The filter on this model is exponential smoothing and its steady-state gain is the smoothing constant.',
  },
  {
    value: 'local-linear-trend',
    label: 'Local linear trend (level and slope)',
    note: 'Two states, only the level measured. The slope is estimated purely through the dynamics.',
  },
  {
    value: 'constant-velocity',
    label: 'Constant-velocity tracker',
    note: 'Position and velocity with a position-only measurement, and Q the exact integral of a white-noise acceleration over one step.',
  },
];

const FORM_OPTIONS: { value: CovarianceForm; label: string }[] = [
  { value: 'joseph', label: 'Joseph form (symmetric and PSD for any gain)' },
  { value: 'sqrt', label: 'Square-root (Cholesky) filter — most robust, roughly twice the cost' },
  { value: 'naive', label: 'Naive P = (I − KC)P — shown so its failure is visible, not recommended' },
];

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run an engine call, turning an EngineError into its own message. */
function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Build the chosen model from the configuration. Validation is the engine's. */
function buildModel(config: StateFilteringConfig): LinearGaussianModel {
  switch (config.modelKind) {
    case 'local-level':
      return localLevel({
        levelNoise: config.levelNoise,
        measurementNoise: config.measurementNoise,
        initialLevel: 0,
      });
    case 'local-linear-trend':
      return localLinearTrend({
        levelNoise: config.levelNoise,
        slopeNoise: config.slopeNoise,
        measurementNoise: config.measurementNoise,
      });
    case 'constant-velocity':
    default:
      return constantVelocityTracker({
        dt: config.dt,
        accelerationNoise: config.accelerationNoise,
        measurementNoise: config.measurementNoise,
      });
  }
}

/**
 * Build the chosen non-linear model. The engine's own builders are used, and
 * the only thing done here is to drop the analytic Jacobians when that has
 * been asked for, so the EKF falls back to finite differences and the engine
 * reports what that costs.
 */
function buildNonlinearModel(config: StateFilteringConfig): NonlinearModel {
  const base: NonlinearModel =
    config.nonlinearModel === 'univariate-growth'
      ? univariateGrowth({
          rate: config.growthRate,
          capacity: config.growthCapacity,
          processNoise: config.nonlinearProcessNoise,
          measurementNoise: config.nonlinearMeasurementNoise,
        })
      : noisyPendulum({
          dt: 0.1,
          processNoise: config.nonlinearProcessNoise,
          measurementNoise: config.nonlinearMeasurementNoise,
          measure: config.pendulumMeasure,
          initialAngle: config.pendulumInitialAngle,
        });
  if (!config.useNumericalJacobian) return base;
  const { jacobianF: _f, jacobianH: _h, ...withoutJacobians } = base;
  return withoutJacobians;
}

/** A pumped particle-filter run: progress, or a finished run, never a partial one. */
type ParticleState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; result: ParticleFilterResult; elapsedMs: number }
  | { status: 'cancelled'; done: number; total: number }
  | { status: 'error'; message: string };

/**
 * The free parameters for direct likelihood maximisation: the logs of the
 * process and measurement standard deviations, so the search is unconstrained
 * and every trial point is a valid model.
 */
interface FreeParameterSpec {
  names: string[];
  start: number[];
  build: (p: number[]) => LinearGaussianModel;
}

/** The pumped direct search: progress, or a finished fit, never a partial one. */
type DirectState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; spec: FreeParameterSpec; result: DirectFitResult }
  | { status: 'cancelled'; done: number; total: number }
  | { status: 'error'; message: string };

function freeParameters(config: StateFilteringConfig): FreeParameterSpec {
  if (config.modelKind === 'local-level') {
    return {
      names: ['log level noise', 'log measurement noise'],
      start: [Math.log(config.levelNoise), Math.log(config.measurementNoise)],
      build: (p) => localLevel({ levelNoise: Math.exp(p[0]), measurementNoise: Math.exp(p[1]) }),
    };
  }
  if (config.modelKind === 'local-linear-trend') {
    return {
      names: ['log level noise', 'log slope noise', 'log measurement noise'],
      start: [Math.log(config.levelNoise), Math.log(Math.max(config.slopeNoise, 1e-6)), Math.log(config.measurementNoise)],
      build: (p) =>
        localLinearTrend({
          levelNoise: Math.exp(p[0]),
          slopeNoise: Math.exp(p[1]),
          measurementNoise: Math.exp(p[2]),
        }),
    };
  }
  return {
    names: ['log acceleration noise', 'log measurement noise'],
    start: [Math.log(config.accelerationNoise), Math.log(config.measurementNoise)],
    build: (p) =>
      constantVelocityTracker({
        dt: config.dt,
        accelerationNoise: Math.exp(p[0]),
        measurementNoise: Math.exp(p[1]),
      }),
  };
}

/** Apply the configured gap. Missing data is never imputed; it is marked null. */
function withGap(observations: Observation[], from: number, count: number): Observation[] {
  if (from < 1 || count < 1) return observations;
  const out = observations.slice();
  for (let i = from - 1; i < Math.min(observations.length, from - 1 + count); i++) out[i] = null;
  return out;
}

interface StateRow {
  name: string;
  filtered: number;
  sd: number;
  low: number;
  high: number;
}

interface PredictiveRow {
  channel: string;
  mean: number;
  sd: number;
  low: number;
  high: number;
}

interface CoverageRow {
  name: string;
  empirical: number;
  nominal: number;
}

interface ParameterRow {
  name: string;
  start: number;
  fitted: number;
}

interface NonlinearCompareRow {
  label: string;
  ekf: string;
  ukf: string;
}

interface ParticleCompareRow {
  name: string;
  kalman: string;
  particle: string;
  mcse: string;
  particleSd: string;
}

interface DegeneracyRow {
  time: number;
  ess: string;
  essRatio: string;
  maxWeight: string;
  resampled: string;
}

export function StateFilteringTool({ config }: { config: StateFilteringConfig }) {
  const app = useApp();
  const set = (patch: Partial<StateFilteringConfig>) => app.updateConfig({ ...config, ...patch });

  // Loop- and length-driving knobs, read through their declared range. The
  // fields show the out-of-range message; this keeps the engine from being
  // handed the typed value, and `outOfRange` says what was used instead.
  const steps = withinRange('steps', config.steps);
  const whitenessLags = withinRange('whitenessLags', config.whitenessLags);
  const emMaxIterations = withinRange('emMaxIterations', config.emMaxIterations);
  const directMaxIterations = withinRange('directMaxIterations', config.directMaxIterations);
  const outOfRange = (Object.keys(KNOB_LIMITS) as KnobName[]).flatMap((name) => {
    const typed = config[name];
    const used = withinRange(name, typed);
    if (used === typed) return [];
    const { min, max, label } = KNOB_LIMITS[name];
    return [
      `“${label}” is ${Number.isFinite(typed) ? typed.toLocaleString('en-US') : String(typed)}, outside its range ${min}–${max}. Everything below used ${used.toLocaleString('en-US')}.`,
    ];
  });

  const model = useMemo(() => attempt(() => buildModel(config)), [config]);

  const simulated = useMemo(
    () =>
      attempt(() => {
        if (!model.ok) throw new Error(model.error);
        return simulateLinearGaussian(model.value, steps, new Random(config.seed));
      }),
    [model, steps, config.seed],
  );

  const observations = useMemo(
    () => (simulated.ok ? withGap(simulated.value.observations, config.missingFrom, config.missingCount) : null),
    [simulated, config.missingFrom, config.missingCount],
  );

  const filtered = useMemo(
    () =>
      attempt(() => {
        if (!model.ok) throw new Error(model.error);
        if (!observations) throw new Error('There is no simulated series to filter yet.');
        return kalmanFilter(model.value, observations, { form: config.covarianceForm });
      }),
    [model, observations, config.covarianceForm],
  );

  // The likelihood on its own, from the engine, so the fitting panels below
  // have a baseline that was not taken from the filter result object.
  const baselineLogLikelihood = useMemo(
    () =>
      attempt(() => {
        if (!model.ok) throw new Error(model.error);
        if (!observations) throw new Error('There is no simulated series to evaluate.');
        return kalmanLogLikelihood(model.value, observations, { form: config.covarianceForm });
      }),
    [model, observations, config.covarianceForm],
  );

  const whiteness = useMemo(
    () =>
      filtered.ok
        ? attempt(() =>
            innovationWhiteness(filtered.value.steps, {
              level: config.level,
              ...(whitenessLags > 0 ? { lags: whitenessLags } : {}),
            }),
          )
        : null,
    [filtered, config.level, whitenessLags],
  );

  const neesResult = useMemo(
    () =>
      filtered.ok && simulated.ok
        ? attempt(() => nees(filtered.value.steps, simulated.value.states, { level: config.level }))
        : null,
    [filtered, simulated, config.level],
  );

  const coverage = useMemo(
    () =>
      filtered.ok && simulated.ok ? attempt(() => intervalCoverage(filtered.value.steps, simulated.value.states, config.level)) : null,
    [filtered, simulated, config.level],
  );

  /**
   * EM runs in the engine-job worker. Every iteration is a complete Kalman
   * smoother pass over the series, which is seconds of work on the main
   * thread; off it, the screen stays usable and the fit can be cancelled.
   * The job is (re)started whenever the opt-in is on and its inputs change,
   * which is the same dependency rule the computation had as a memo.
   */
  const emJob = useEngineJob('filtering.em');
  const emReady = config.runEmFit && model.ok && observations !== null;
  const emStart = emJob.start;
  const emReset = emJob.reset;
  useEffect(() => {
    if (!config.runEmFit) {
      emReset();
      return;
    }
    if (!model.ok || !observations) return;
    emStart({ initial: model.value, observations, options: { maxIterations: emMaxIterations } });
  }, [config.runEmFit, emMaxIterations, model, observations, emStart, emReset]);
  const emFit = emJob.state.result;

  /**
   * The direct Nelder-Mead search is driven a slice at a time off a timer,
   * the way `ProcessesTool` drives the engine's generators. Every trial point
   * is a complete Kalman filter run over the whole series, so a few thousand
   * iterations on a long series is many seconds: run as one synchronous loop
   * it froze the tab and left nothing able to receive a cancel. Each slice
   * runs for about 40 ms and then yields to the browser, so the page keeps
   * repainting and Cancel lands between slices.
   *
   * It cannot go to the engine-job worker: the parameterisation is a callback
   * built here, and a function cannot cross `postMessage`.
   */
  const [direct, setDirect] = useState<DirectState>({ status: 'idle' });
  const directToken = useRef<{ cancelled: boolean } | null>(null);
  useEffect(
    () => () => {
      if (directToken.current) directToken.current.cancelled = true;
    },
    [],
  );
  useEffect(() => {
    if (directToken.current) directToken.current.cancelled = true;
    if (!config.runDirectFit) {
      setDirect({ status: 'idle' });
      return;
    }
    if (!observations) {
      setDirect({ status: 'error', message: 'There is no simulated series to fit.' });
      return;
    }
    const token = { cancelled: false };
    directToken.current = token;
    let spec: FreeParameterSpec;
    let generator: Generator<{ completed: number; total: number }, DirectFitResult, void>;
    try {
      spec = freeParameters(config);
      generator = maximiseLikelihoodSteps(spec.build, spec.start, observations, { maxIterations: directMaxIterations });
    } catch (e) {
      setDirect({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setDirect({ status: 'running', done: 0, total: directMaxIterations });
    const pump = () => {
      if (token.cancelled) return;
      const started = Date.now();
      try {
        for (;;) {
          const step = generator.next();
          if (step.done) {
            setDirect({ status: 'done', spec, result: step.value });
            return;
          }
          if (Date.now() - started > 40) {
            setDirect({ status: 'running', done: step.value.completed, total: step.value.total });
            break;
          }
        }
      } catch (e) {
        setDirect({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      window.setTimeout(pump, 0);
    };
    window.setTimeout(pump, 0);
    return () => {
      token.cancelled = true;
    };
  }, [config, observations, directMaxIterations]);

  const cancelDirect = () => {
    if (directToken.current) directToken.current.cancelled = true;
    setDirect((prev) => (prev.status === 'running' ? { status: 'cancelled', done: prev.done, total: prev.total } : prev));
  };

  /**
   * The finished search in the shape the cards below read. A run that is
   * still going, or was cancelled, is deliberately not represented here:
   * there is no partial fit to show, only progress.
   */
  const directFit = useMemo((): Attempt<{ spec: FreeParameterSpec; result: DirectFitResult }> | null => {
    if (direct.status === 'done') return { ok: true, value: { spec: direct.spec, result: direct.result } };
    if (direct.status === 'error') return { ok: false, error: direct.message };
    return null;
  }, [direct]);

  const stateNames = useMemo(
    () => (model.ok ? (model.value.stateNames ?? model.value.mu0.map((_, i) => `state ${i + 1}`)) : []),
    [model],
  );
  // Clamped at BOTH ends: a negative index typed into the field used to reach
  // past the start of every per-step array and crash the screen.
  const focus = Math.min(Math.max(0, Math.round(config.focusState) || 0), Math.max(0, stateNames.length - 1));
  const z = useMemo(() => Math.abs(normalQuantile((1 - config.level) / 2)), [config.level]);

  // Chart inputs only: the values themselves are the engine's filtered mean
  // and covariance, read off the result, never recomputed.
  const chartData = useMemo(() => {
    if (!filtered.ok || !simulated.ok) return null;
    const steps = filtered.value.steps;
    const x = steps.map((_, i) => i + 1);
    const truth = steps.map((_, i) => ({ x: i + 1, y: simulated.value.states[i][focus] }));
    const estimate = steps.map((s, i) => ({ x: i + 1, y: s.filteredMean[focus] }));
    const measured: { x: number; y: number }[] = [];
    for (let i = 0; i < steps.length; i++) {
      const obs = observations ? observations[i] : null;
      const v = obs ? obs[0] : null;
      if (v !== null && v !== undefined && Number.isFinite(v)) measured.push({ x: i + 1, y: v });
    }
    const centre = estimate.map((p) => p.y);
    const sd = steps.map((s) => Math.sqrt(s.filteredCov[focus][focus]));
    return {
      x,
      truth,
      estimate,
      measured,
      centre,
      lower: centre.map((m, i) => m - z * sd[i]),
      upper: centre.map((m, i) => m + z * sd[i]),
    };
  }, [filtered, simulated, observations, focus, z]);

  const lastStep = filtered.ok ? filtered.value.steps[filtered.value.steps.length - 1] : null;

  const stateRows: StateRow[] = useMemo(() => {
    if (!lastStep) return [];
    return lastStep.filteredMean.map((m, i) => {
      const sd = Math.sqrt(lastStep.filteredCov[i][i]);
      return { name: stateNames[i] ?? `state ${i + 1}`, filtered: m, sd, low: m - z * sd, high: m + z * sd };
    });
  }, [lastStep, stateNames, z]);

  const predictiveRows: PredictiveRow[] = useMemo(() => {
    if (!lastStep) return [];
    const mean = lastStep.observationPredMean;
    const cov = lastStep.observationPredCov;
    if (!mean || !cov) return [];
    const names = model.ok ? (model.value.observationNames ?? []) : [];
    return mean.map((m, i) => {
      const sd = Math.sqrt(cov[i][i]);
      return { channel: names[i] ?? `channel ${i + 1}`, mean: m, sd, low: m - z * sd, high: m + z * sd };
    });
  }, [lastStep, model, z]);

  const coverageRows: CoverageRow[] = useMemo(() => {
    if (!coverage || !coverage.ok) return [];
    return coverage.value.coverage.map((c, i) => ({
      name: stateNames[i] ?? `state ${i + 1}`,
      empirical: c,
      nominal: coverage.value.nominal,
    }));
  }, [coverage, stateNames]);

  const directRows: ParameterRow[] = useMemo(() => {
    if (!directFit || !directFit.ok) return [];
    return directFit.value.spec.names.map((name, i) => ({
      name,
      start: directFit.value.spec.start[i],
      fitted: directFit.value.result.parameters[i],
    }));
  }, [directFit]);

  const stateColumns: ColumnDef<StateRow>[] = [
    { key: 'name', header: 'State component', render: (r) => r.name },
    { key: 'filtered', header: 'Filtered estimate', numeric: true, render: (r) => formatValue(r.filtered, 6) },
    { key: 'sd', header: 'Standard deviation', numeric: true, render: (r) => formatValue(r.sd, 6) },
    {
      key: 'interval',
      header: `${Math.round(config.level * 100)}% interval for the state`,
      numeric: true,
      render: (r) => `${formatValue(r.low, 5)} to ${formatValue(r.high, 5)}`,
    },
  ];

  const predictiveColumns: ColumnDef<PredictiveRow>[] = [
    { key: 'channel', header: 'Observation channel', render: (r) => r.channel },
    { key: 'mean', header: 'Predictive mean', numeric: true, render: (r) => formatValue(r.mean, 6) },
    { key: 'sd', header: 'Predictive standard deviation', numeric: true, render: (r) => formatValue(r.sd, 6) },
    {
      key: 'interval',
      header: `${Math.round(config.level * 100)}% range for a NEW observation`,
      numeric: true,
      render: (r) => `${formatValue(r.low, 5)} to ${formatValue(r.high, 5)}`,
    },
  ];

  const coverageColumns: ColumnDef<CoverageRow>[] = [
    { key: 'name', header: 'State component', render: (r) => r.name },
    { key: 'empirical', header: 'Empirical coverage', numeric: true, render: (r) => `${(r.empirical * 100).toFixed(1)}%` },
    { key: 'nominal', header: 'Nominal level', numeric: true, render: (r) => `${(r.nominal * 100).toFixed(1)}%` },
  ];

  const parameterColumns: ColumnDef<ParameterRow>[] = [
    { key: 'name', header: 'Free parameter', render: (r) => r.name },
    { key: 'start', header: 'Start', numeric: true, render: (r) => formatValue(r.start, 6) },
    { key: 'fitted', header: 'At the best point found', numeric: true, render: (r) => formatValue(r.fitted, 6) },
  ];

  /* ======================================================================
   * The non-linear section: EKF, UKF and the particle filter.
   *
   * Every number below is the engine's. The EKF and UKF are O(T) with two
   * states, so they run in a memo on the main thread and their measured time
   * is reported; the particle filter is N model evaluations per step, so it is
   * opt-in and driven as a yielding generator.
   * ==================================================================== */
  const nonlinearSteps = withinRange('nonlinearSteps', config.nonlinearSteps);
  const particleCount = withinRange('particleCount', config.particleCount);

  const nlModel = useMemo(() => attempt(() => buildNonlinearModel(config)), [config]);

  const nlSimulated = useMemo(
    () =>
      attempt(() => {
        if (!nlModel.ok) throw new Error(nlModel.error);
        return simulateNonlinear(nlModel.value, nonlinearSteps, new Random(config.nonlinearSeed));
      }),
    [nlModel, nonlinearSteps, config.nonlinearSeed],
  );

  const nlObservations = useMemo(
    () => (nlSimulated.ok ? withGap(nlSimulated.value.observations, config.missingFrom, config.missingCount) : null),
    [nlSimulated, config.missingFrom, config.missingCount],
  );

  type TimedRun = { result: NonlinearFilterResult; elapsedMs: number };

  const ekf = useMemo(
    () =>
      attempt((): TimedRun => {
        if (!nlModel.ok) throw new Error(nlModel.error);
        if (!nlObservations) throw new Error('There is no simulated non-linear series to filter yet.');
        const t0 = performance.now();
        const result = extendedKalmanFilter(nlModel.value, nlObservations);
        return { result, elapsedMs: performance.now() - t0 };
      }),
    [nlModel, nlObservations],
  );

  const ukf = useMemo(
    () =>
      attempt((): TimedRun => {
        if (!nlModel.ok) throw new Error(nlModel.error);
        if (!nlObservations) throw new Error('There is no simulated non-linear series to filter yet.');
        const t0 = performance.now();
        const result = unscentedKalmanFilter(nlModel.value, nlObservations);
        return { result, elapsedMs: performance.now() - t0 };
      }),
    [nlModel, nlObservations],
  );

  /**
   * The same three diagnostics the linear section uses, run on each
   * non-linear filter. This is the whole point of showing the two side by
   * side: the EKF's own covariance cannot report its divergence, and the
   * innovation and NEES tests can.
   */
  const nlDiagnostics = useMemo(() => {
    const forRun = (run: Attempt<TimedRun>) => {
      if (!run.ok || !nlSimulated.ok) return null;
      return {
        whiteness: attempt(() =>
          innovationWhiteness(run.value.result.steps, {
            level: config.level,
            ...(whitenessLags > 0 ? { lags: whitenessLags } : {}),
          }),
        ),
        nees: attempt(() => nees(run.value.result.steps, nlSimulated.value.states, { level: config.level })),
        coverage: attempt(() => intervalCoverage(run.value.result.steps, nlSimulated.value.states, config.level)),
      };
    };
    return { ekf: forRun(ekf), ukf: forRun(ukf) };
  }, [ekf, ukf, nlSimulated, config.level, whitenessLags]);

  const nlRun = config.nonlinearFilter === 'ekf' ? ekf : ukf;
  const nlStateNames = useMemo(
    () => (nlModel.ok ? (nlModel.value.stateNames ?? nlModel.value.mu0.map((_, i) => `state ${i + 1}`)) : []),
    [nlModel],
  );
  const nlFocus = Math.min(
    Math.max(0, Math.round(config.nonlinearFocusState) || 0),
    Math.max(0, nlStateNames.length - 1),
  );

  const nlChartData = useMemo(() => {
    if (!nlSimulated.ok || !nlRun.ok) return null;
    const steps = nlRun.value.result.steps;
    const x = steps.map((_, i) => i + 1);
    const truth = steps.map((_, i) => ({ x: i + 1, y: nlSimulated.value.states[i][nlFocus] }));
    const ekfLine = ekf.ok ? ekf.value.result.steps.map((st, i) => ({ x: i + 1, y: st.filteredMean[nlFocus] })) : [];
    const ukfLine = ukf.ok ? ukf.value.result.steps.map((st, i) => ({ x: i + 1, y: st.filteredMean[nlFocus] })) : [];
    const centre = steps.map((st) => st.filteredMean[nlFocus]);
    const sd = steps.map((st) => Math.sqrt(st.filteredCov[nlFocus][nlFocus]));
    return {
      x,
      truth,
      ekfLine,
      ukfLine,
      centre,
      lower: centre.map((m, i) => m - z * sd[i]),
      upper: centre.map((m, i) => m + z * sd[i]),
    };
  }, [nlSimulated, nlRun, ekf, ukf, nlFocus, z]);

  const nlLastStep = nlRun.ok ? nlRun.value.result.steps[nlRun.value.result.steps.length - 1] : null;

  const nlStateRows: StateRow[] = useMemo(() => {
    if (!nlLastStep) return [];
    return nlLastStep.filteredMean.map((m, i) => {
      const sd = Math.sqrt(nlLastStep.filteredCov[i][i]);
      return { name: nlStateNames[i] ?? `state ${i + 1}`, filtered: m, sd, low: m - z * sd, high: m + z * sd };
    });
  }, [nlLastStep, nlStateNames, z]);

  const nlPredictiveRows: PredictiveRow[] = useMemo(() => {
    if (!nlLastStep) return [];
    const mean = nlLastStep.observationPredMean;
    const cov = nlLastStep.observationPredCov;
    if (!mean || !cov) return [];
    const names = nlModel.ok ? (nlModel.value.observationNames ?? []) : [];
    return mean.map((m, i) => {
      const sd = Math.sqrt(cov[i][i]);
      return { channel: names[i] ?? `channel ${i + 1}`, mean: m, sd, low: m - z * sd, high: m + z * sd };
    });
  }, [nlLastStep, nlModel, z]);

  /** The EKF-versus-UKF comparison, read off the two engine results. */
  const nlCompareRows: NonlinearCompareRow[] = useMemo(() => {
    const cell = (run: Attempt<TimedRun>, read: (r: NonlinearFilterResult) => string): string =>
      run.ok ? read(run.value.result) : run.error;
    const diag = (
      side: { whiteness: Attempt<ReturnType<typeof innovationWhiteness>>; nees: Attempt<ReturnType<typeof nees>>; coverage: Attempt<ReturnType<typeof intervalCoverage>> } | null,
      read: (d: NonNullable<typeof side>) => string,
    ): string => (side === null ? 'not available' : read(side));
    return [
      {
        label: 'Exactness reported by the engine',
        ekf: cell(ekf, (r) => EXACTNESS_LABEL[r.exactness]),
        ukf: cell(ukf, (r) => EXACTNESS_LABEL[r.exactness]),
      },
      {
        label: 'Approximate log-likelihood (Gaussian approximation, not exact)',
        ekf: cell(ekf, (r) => formatValue(r.approximateLogLikelihood, 8)),
        ukf: cell(ukf, (r) => formatValue(r.approximateLogLikelihood, 8)),
      },
      {
        label: 'Jacobians',
        ekf: cell(ekf, (r) => (r.numericalJacobian ? 'finite differences (less accurate)' : 'analytic')),
        ukf: cell(ukf, (r) => (r.numericalJacobian ? 'finite differences' : 'none needed — derivative-free')),
      },
      {
        label: 'Innovation whiteness p-value (needs no truth)',
        ekf: diag(nlDiagnostics.ekf, (d) => (d.whiteness.ok ? `${formatValue(d.whiteness.value.pValue, 5)}${d.whiteness.value.rejected ? ' — rejected' : ''}` : d.whiteness.error)),
        ukf: diag(nlDiagnostics.ukf, (d) => (d.whiteness.ok ? `${formatValue(d.whiteness.value.pValue, 5)}${d.whiteness.value.rejected ? ' — rejected' : ''}` : d.whiteness.error)),
      },
      {
        label: 'Mean NEES (expected = state dimension; needs the simulated truth)',
        ekf: diag(nlDiagnostics.ekf, (d) => (d.nees.ok ? `${formatValue(d.nees.value.mean, 5)}${d.nees.value.consistent ? '' : ' — inconsistent'}` : d.nees.error)),
        ukf: diag(nlDiagnostics.ukf, (d) => (d.nees.ok ? `${formatValue(d.nees.value.mean, 5)}${d.nees.value.consistent ? '' : ' — inconsistent'}` : d.nees.error)),
      },
      {
        label: `Interval coverage of component ${nlFocus} (nominal ${Math.round(config.level * 100)}%)`,
        ekf: diag(nlDiagnostics.ekf, (d) => (d.coverage.ok ? `${((d.coverage.value.coverage[nlFocus] ?? 0) * 100).toFixed(1)}%` : d.coverage.error)),
        ukf: diag(nlDiagnostics.ukf, (d) => (d.coverage.ok ? `${((d.coverage.value.coverage[nlFocus] ?? 0) * 100).toFixed(1)}%` : d.coverage.error)),
      },
      {
        label: 'Measured run time on this machine',
        ekf: ekf.ok ? `${ekf.value.elapsedMs.toFixed(1)} ms` : ekf.error,
        ukf: ukf.ok ? `${ukf.value.elapsedMs.toFixed(1)} ms` : ukf.error,
      },
    ];
  }, [ekf, ukf, nlDiagnostics, nlFocus, config.level]);

  /* ----------------------------------------------- the particle filter run */

  /**
   * The particle model. The engine supplies exactly one route from a model it
   * already has to a `ParticleModel`: `linearGaussianAsParticleModel`. That
   * makes this the one particle run with a reference value — the exact Kalman
   * answer on the very same observations — which is why it is the pairing
   * shown. The particle-only model in the library (stochastic volatility) is
   * NOT offered: the engine has no simulator for it, and inventing one here
   * would be inventing data.
   */
  const particleModel = useMemo(
    () =>
      attempt(() => {
        if (!model.ok) throw new Error(model.error);
        return linearGaussianAsParticleModel(model.value);
      }),
    [model],
  );

  const [particle, setParticle] = useState<ParticleState>({ status: 'idle' });
  const particleToken = useRef<{ cancelled: boolean } | null>(null);
  useEffect(
    () => () => {
      if (particleToken.current) particleToken.current.cancelled = true;
    },
    [],
  );
  useEffect(() => {
    if (particleToken.current) particleToken.current.cancelled = true;
    if (!config.runParticleFilter) {
      setParticle({ status: 'idle' });
      return;
    }
    if (!particleModel.ok) {
      setParticle({ status: 'error', message: particleModel.error });
      return;
    }
    if (!observations) {
      setParticle({ status: 'error', message: 'There is no simulated series to filter.' });
      return;
    }
    const token = { cancelled: false };
    particleToken.current = token;
    let generator: Generator<{ completed: number; total: number }, ParticleFilterResult, void>;
    try {
      generator = sequentialImportanceResamplingSteps(particleModel.value, observations, new Random(config.particleSeed), {
        particles: particleCount,
        scheme: config.particleScheme,
        essThreshold: config.particleEssThreshold,
        degeneracyThreshold: config.particleDegeneracyThreshold,
        auxiliary: config.particleAuxiliary,
        chunk: 8,
      });
    } catch (e) {
      setParticle({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    setParticle({ status: 'running', done: 0, total: observations.length });
    let elapsed = 0;
    const pump = () => {
      if (token.cancelled) return;
      const started = performance.now();
      try {
        for (;;) {
          const step = generator.next();
          if (step.done) {
            elapsed += performance.now() - started;
            setParticle({ status: 'done', result: step.value, elapsedMs: elapsed });
            return;
          }
          if (performance.now() - started > 40) {
            elapsed += performance.now() - started;
            setParticle({ status: 'running', done: step.value.completed, total: step.value.total });
            break;
          }
        }
      } catch (e) {
        setParticle({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      window.setTimeout(pump, 0);
    };
    window.setTimeout(pump, 0);
    return () => {
      token.cancelled = true;
    };
  }, [
    config.runParticleFilter,
    config.particleScheme,
    config.particleEssThreshold,
    config.particleDegeneracyThreshold,
    config.particleAuxiliary,
    config.particleSeed,
    particleCount,
    particleModel,
    observations,
  ]);

  const cancelParticle = () => {
    if (particleToken.current) particleToken.current.cancelled = true;
    setParticle((prev) => (prev.status === 'running' ? { status: 'cancelled', done: prev.done, total: prev.total } : prev));
  };

  const particleRun = particle.status === 'done' ? particle.result : null;
  const particleElapsedMs = particle.status === 'done' ? particle.elapsedMs : null;
  const particleLast = particleRun ? particleRun.steps[particleRun.steps.length - 1] : null;

  /**
   * The exact Kalman answer against the particle estimate at the last step,
   * on the same data. The particle columns carry the Monte Carlo standard
   * error, which is NOT the particle spread: the spread describes the
   * posterior, the standard error describes how well N particles pin down its
   * mean.
   */
  const particleCompareRows: ParticleCompareRow[] = useMemo(() => {
    if (!particleRun || !particleLast) return [];
    return particleLast.mean.map((m, i) => ({
      name: stateNames[i] ?? `state ${i + 1}`,
      kalman: lastStep ? formatValue(lastStep.filteredMean[i], 6) : 'the Kalman filter did not run',
      particle: formatValue(m, 6),
      mcse: formatValue(particleRun.monteCarloStandardError[i], 6),
      particleSd: formatValue(Math.sqrt(particleLast.covariance[i][i]), 6),
    }));
  }, [particleRun, particleLast, lastStep, stateNames]);

  /** The steps the engine itself flagged as degenerate, never summarised away. */
  const degeneracyRows: DegeneracyRow[] = useMemo(() => {
    if (!particleRun) return [];
    return particleRun.degenerateSteps.slice(0, 200).map((t) => {
      const st = particleRun.steps[t];
      return {
        time: t + 1,
        ess: st ? formatValue(st.ess, 4) : 'not recorded',
        essRatio: st ? `${(st.essRatio * 100).toFixed(2)}%` : 'not recorded',
        maxWeight: st ? formatValue(st.maxWeight, 6) : 'not recorded',
        resampled: st ? (st.resampled ? 'yes' : 'no') : 'not recorded',
      };
    });
  }, [particleRun]);

  const nonlinearCompareColumns: ColumnDef<NonlinearCompareRow>[] = [
    { key: 'label', header: 'On the same simulated data', render: (r) => r.label },
    { key: 'ekf', header: 'Extended Kalman filter', render: (r) => r.ekf },
    { key: 'ukf', header: 'Unscented Kalman filter', render: (r) => r.ukf },
  ];

  const particleCompareColumns: ColumnDef<ParticleCompareRow>[] = [
    { key: 'name', header: 'State component', render: (r) => r.name },
    { key: 'kalman', header: 'Kalman filter (exact)', numeric: true, render: (r) => r.kalman },
    { key: 'particle', header: 'Particle filter (empirical)', numeric: true, render: (r) => r.particle },
    { key: 'mcse', header: 'Monte Carlo standard error of that mean', numeric: true, render: (r) => r.mcse },
    { key: 'particleSd', header: 'Particle standard deviation (the posterior spread)', numeric: true, render: (r) => r.particleSd },
  ];

  const degeneracyColumns: ColumnDef<DegeneracyRow>[] = [
    { key: 'time', header: 'Step', numeric: true, render: (r) => String(r.time) },
    { key: 'ess', header: 'Effective sample size', numeric: true, render: (r) => r.ess },
    { key: 'essRatio', header: 'ESS as a share of the particles', numeric: true, render: (r) => r.essRatio },
    { key: 'maxWeight', header: 'Largest single weight', numeric: true, render: (r) => r.maxWeight },
    { key: 'resampled', header: 'Resampled here', render: (r) => r.resampled },
  ];

  return (
    <>
      {/* "state-filtering" is not yet a member of TOOL_IDS; the coordinator wires it. */}
      <ToolHeader toolId="state-filtering" />
      <div className="oc-stack">
        {outOfRange.length > 0 && <Notice tone="warning" title="A setting is outside the range its field allows" items={outOfRange} />}
        <Card
          title="The model and the simulated series"
          hint="The true state is known here only because the series is simulated. On real data the diagnostics that need a truth are unavailable, and this screen says so where they appear."
        >
          <SelectField
            label="Model"
            value={config.modelKind}
            onChange={(modelKind) => set({ modelKind: modelKind as FilteringModelKind, focusState: 0 })}
            options={MODEL_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
            hint={MODEL_OPTIONS.find((m) => m.value === config.modelKind)?.note}
          />
          <NumberField label="Time steps" value={config.steps} onChange={(steps) => set({ steps })} min={2} max={2000} integer />
          <TextField label="Seed" value={config.seed} onChange={(seed) => set({ seed })} hint="The same seed gives the same path on every machine." />
          <NumberField
            label="Measurement noise (standard deviation)"
            value={config.measurementNoise}
            onChange={(measurementNoise) => set({ measurementNoise })}
            min={0.0001}
            step={0.1}
          />
          {config.modelKind === 'constant-velocity' ? (
            <>
              <NumberField label="Time between measurements" value={config.dt} onChange={(dt) => set({ dt })} min={0.0001} step={0.1} />
              <NumberField
                label="Acceleration noise (standard deviation)"
                value={config.accelerationNoise}
                onChange={(accelerationNoise) => set({ accelerationNoise })}
                min={0.0001}
                step={0.05}
              />
            </>
          ) : (
            <>
              <NumberField label="Level noise (standard deviation)" value={config.levelNoise} onChange={(levelNoise) => set({ levelNoise })} min={0.0001} step={0.1} />
              {config.modelKind === 'local-linear-trend' && (
                <NumberField label="Slope noise (standard deviation)" value={config.slopeNoise} onChange={(slopeNoise) => set({ slopeNoise })} min={0} step={0.05} />
              )}
            </>
          )}
          <SelectField
            label="Covariance update form"
            value={config.covarianceForm}
            onChange={(covarianceForm) => set({ covarianceForm: covarianceForm as CovarianceForm })}
            options={FORM_OPTIONS}
          />
          <NumberField
            label="Observation gap starts at step (0 for none)"
            value={config.missingFrom}
            onChange={(missingFrom) => set({ missingFrom })}
            min={0}
            max={config.steps}
            integer
            hint="Missing observations are marked missing and skipped. They are never imputed with a zero, and the state uncertainty grows across the gap."
          />
          <NumberField label="Gap length in steps" value={config.missingCount} onChange={(missingCount) => set({ missingCount })} min={0} max={config.steps} integer />
          <NumberField
            label="Interval level"
            value={config.level}
            onChange={(level) => set({ level })}
            min={0.5}
            max={0.9999}
            step={0.01}
            hint="Shared by the state band, the whiteness test, the NEES acceptance region and the coverage check."
          />
          {!model.ok && <Notice tone="error">{model.error}</Notice>}
          {model.ok && !simulated.ok && <Notice tone="error">{simulated.error}</Notice>}
        </Card>

        <AiAssistPanel
          capability="interpretStatistics"
          context="Every quantity on this screen — the filtered states, the log-likelihood, the innovation whiteness test, NEES, coverage and both fits — is computed by the filtering engine. The assistant can only help read them; it never produces a number."
        />

        {/* ------------------------------------------------------ the filter */}
        <Card title="Kalman filter" hint="Exact conditional means and covariances for a linear-Gaussian model, up to floating point.">
          {!filtered.ok ? (
            <Notice tone="error">{filtered.error}</Notice>
          ) : (
            <>
              <KeyValueList
                items={[
                  { label: 'State dimension', value: String(filtered.value.stateDim) },
                  { label: 'Observation dimension', value: String(filtered.value.obsDim) },
                  { label: 'Steps filtered', value: filtered.value.steps.length.toLocaleString('en-US') },
                  {
                    label: 'Scalar observations used',
                    value: `${filtered.value.observedCount.toLocaleString('en-US')} (missing steps contribute nothing rather than a substituted value)`,
                  },
                  { label: 'Log-likelihood', value: formatValue(filtered.value.logLikelihood, 8) },
                  {
                    label: 'Log-likelihood recomputed on its own',
                    value: baselineLogLikelihood.ok ? formatValue(baselineLogLikelihood.value, 8) : baselineLogLikelihood.error,
                  },
                  { label: 'Covariance form', value: filtered.value.form },
                  {
                    label: 'Exactness',
                    value: <Badge variant={filtered.value.exactness}>{EXACTNESS_LABEL[filtered.value.exactness]}</Badge>,
                  },
                ]}
              />
              {filtered.value.partial && <Notice tone="warning">The filter run is marked partial, so the series was not filtered to the end.</Notice>}
              {config.covarianceForm === 'naive' && (
                <Notice tone="warning" title="The naive covariance form is selected">
                  P = (I − KC)P is not symmetric or positive semi-definite by construction. It is offered so that its failure on an
                  ill-conditioned problem is visible, not because it should be used.
                </Notice>
              )}
              <NumberField
                label="State component shown in the charts"
                value={config.focusState}
                onChange={(focusState) => set({ focusState })}
                min={0}
                max={Math.max(0, filtered.value.stateDim - 1)}
                integer
                hint={stateNames.map((n, i) => `${i} = ${n}`).join(', ')}
              />
              {chartData && (
                <>
                  <LineChart
                    title={`Truth, measurements and filtered estimate: ${stateNames[focus] ?? `state ${focus + 1}`}`}
                    description="The simulated true state, the measurements that were actually available, and the filter's estimate of the state at each step."
                    series={[
                      { label: 'True state (simulated)', points: chartData.truth },
                      { label: 'Filtered estimate', points: chartData.estimate },
                      { label: 'Measurement', points: chartData.measured, dashed: true },
                    ]}
                    xLabel="Time step"
                    yLabel="Value"
                    note={
                      config.missingFrom > 0 && config.missingCount > 0
                        ? `The measurement series has a deliberate gap of ${config.missingCount} step(s) from step ${config.missingFrom}. Across it the estimate is a prediction only.`
                        : undefined
                    }
                  />
                  <FanChart
                    title={`Uncertainty in the state: ${stateNames[focus] ?? `state ${focus + 1}`}`}
                    description="The filtered mean with its interval from the filtered covariance. This is uncertainty about the state estimate, not the spread of future measurements."
                    x={chartData.x}
                    bands={[{ label: `${Math.round(config.level * 100)}% interval for the state`, lower: chartData.lower, upper: chartData.upper }]}
                    center={{ label: 'Filtered estimate', values: chartData.centre }}
                    bandMeaning="mean-uncertainty"
                    observed={{ label: 'True state (simulated)', points: chartData.truth }}
                    xLabel="Time step"
                    yLabel="Value"
                    note="The band widens wherever measurements are missing, because only the dynamics carry the state there."
                  />
                </>
              )}
              <ExplanationPanel explanation={filtered.value.explanation} />
              <WarningList warnings={filtered.value.warnings} />
            </>
          )}
        </Card>

        {/* ------------------------------- state estimate vs next observation */}
        <Card
          title="The final step: an interval for the state, and a range for the next observation"
          hint="These are two different statements and they are not interchangeable."
        >
          {!filtered.ok ? (
            <Notice tone="error">{filtered.error}</Notice>
          ) : (
            <>
              <h3 style={{ margin: 0 }}>Interval for the state (an estimate)</h3>
              <div style={{ overflowX: 'auto' }}>
                <DataTable caption="Filtered state at the last step, from the filtered covariance" columns={stateColumns} rows={stateRows} />
              </div>
              <h3 style={{ margin: 0 }}>Predictive range for an observation (an outcome)</h3>
              {predictiveRows.length === 0 ? (
                <Notice tone="info">
                  The last step has no observation predictive moments — the observation there is missing, so the engine reports none rather than a
                  substituted value.
                </Notice>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <DataTable caption="Predictive distribution of the observation, C P Cᵀ + R" columns={predictiveColumns} rows={predictiveRows} />
                </div>
              )}
              <Notice tone="info" title="Why the second range is wider">
                The interval for the state describes how well the state is known. The predictive range for an observation adds the measurement noise R
                on top of that, because a new measurement is a draw, not an estimate. Reading one as the other overstates or understates the
                uncertainty every time.
              </Notice>
            </>
          )}
        </Card>

        {/* ------------------------------------------------- diagnostics */}
        <Card
          title="Innovation whiteness"
          hint="The one filter diagnostic that needs no knowledge of the truth, so it is the one available on real data."
        >
          <NumberField
            label="Lags (0 lets the engine choose)"
            value={config.whitenessLags}
            onChange={(whitenessLags) => set({ whitenessLags })}
            min={0}
            max={40}
            integer
          />
          {!whiteness ? (
            <Notice tone="info">The filter did not run, so there are no innovations to test.</Notice>
          ) : !whiteness.ok ? (
            <Notice tone="error">{whiteness.error}</Notice>
          ) : (
            <>
              <Notice
                tone={whiteness.value.rejected ? 'error' : 'success'}
                title={
                  whiteness.value.rejected
                    ? 'The standardised innovations are NOT white: the model does not match the data'
                    : 'The standardised innovations are consistent with white noise'
                }
              >
                <p style={{ margin: 0 }}>
                  Under a correct model the standardised innovations are uncorrelated with identity covariance. Rejection means the model, not the
                  filter arithmetic, is wrong.
                </p>
              </Notice>
              <KeyValueList
                items={[
                  { label: 'Ljung-Box statistic', value: formatValue(whiteness.value.statistic, 6) },
                  { label: 'Degrees of freedom', value: String(whiteness.value.df) },
                  { label: 'p-value', value: formatValue(whiteness.value.pValue, 6) },
                  { label: 'Lags tested', value: String(whiteness.value.lags) },
                  { label: 'Usable innovations', value: String(whiteness.value.n) },
                  { label: 'Max |sample covariance − I|', value: formatValue(whiteness.value.covarianceDeviation, 6) },
                  {
                    label: 'Exactness',
                    value: <Badge variant={whiteness.value.exactness}>{EXACTNESS_LABEL[whiteness.value.exactness]}</Badge>,
                  },
                ]}
              />
              <ExplanationPanel explanation={whiteness.value.explanation} />
              <WarningList warnings={whiteness.value.warnings} />
            </>
          )}
        </Card>

        <Card
          title="Covariance calibration: NEES and interval coverage"
          hint="Both need the true state, so both exist here only because the series is simulated. Neither is available on real data."
        >
          {!neesResult ? (
            <Notice tone="info">There is no filtered run and known truth to compare, so there is nothing to check.</Notice>
          ) : !neesResult.ok ? (
            <Notice tone="error">{neesResult.error}</Notice>
          ) : (
            <>
              <Notice
                tone={neesResult.value.consistent ? 'success' : 'error'}
                title={neesResult.value.consistent ? 'The filter covariance is consistent with the errors' : 'The filter covariance is not consistent with the errors'}
              >
                <p style={{ margin: 0 }}>
                  A filter with a wrong covariance still produces plausible means, which is why the mean alone cannot reveal this.
                </p>
              </Notice>
              <KeyValueList
                items={[
                  { label: 'Mean NEES', value: formatValue(neesResult.value.mean, 6) },
                  { label: 'Expected (state dimension)', value: String(neesResult.value.expected) },
                  {
                    label: `${Math.round(neesResult.value.level * 100)}% acceptance region for the mean`,
                    value: `${formatValue(neesResult.value.interval.low, 5)} to ${formatValue(neesResult.value.interval.high, 5)}`,
                  },
                  { label: 'Steps', value: String(neesResult.value.n) },
                  {
                    label: 'Exactness',
                    value: <Badge variant={neesResult.value.exactness}>{EXACTNESS_LABEL[neesResult.value.exactness]}</Badge>,
                  },
                ]}
              />
              <LineChart
                title="Normalised estimation error squared, per step"
                description="Per-step NEES from the engine, against its expected value: the state dimension."
                series={[{ label: 'NEES', points: neesResult.value.perStep.map((v, i) => ({ x: i + 1, y: v })) }]}
                xLabel="Time step"
                yLabel="NEES"
                referenceLines={[{ value: neesResult.value.expected, label: `expected = ${neesResult.value.expected}`, axis: 'y' }]}
              />
              <ExplanationPanel explanation={neesResult.value.explanation} />
              <WarningList warnings={neesResult.value.warnings} />
            </>
          )}
          {coverage && !coverage.ok && <Notice tone="error">{coverage.error}</Notice>}
          {coverage && coverage.ok && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption={`Share of steps where the true state fell inside its ${Math.round(coverage.value.nominal * 100)}% filtered interval`}
                  columns={coverageColumns}
                  rows={coverageRows}
                />
              </div>
              <KeyValueList
                items={[
                  { label: 'Steps', value: String(coverage.value.n) },
                  {
                    label: 'Exactness',
                    value: <Badge variant={coverage.value.exactness}>{EXACTNESS_LABEL[coverage.value.exactness]}</Badge>,
                  },
                ]}
              />
              <WarningList warnings={coverage.value.warnings} />
            </>
          )}
        </Card>

        {/* --------------------------------------------------------- EM fit */}
        <Card title="Fitting the model by EM" hint="Estimates A, C, Q, R and the prior mean from the observations alone.">
          <NumberField label="Maximum EM iterations" value={config.emMaxIterations} onChange={(emMaxIterations) => set({ emMaxIterations })} min={1} max={500} integer />
          {!config.runEmFit ? (
            <>
              <Notice tone="info" title="EM is not run automatically">
                <p style={{ marginTop: 0 }}>
                  Each EM iteration runs a complete Kalman smoother over all {steps} steps, so {emMaxIterations} iterations is{' '}
                  {emMaxIterations} smoother passes. That is seconds of computation, so it runs in a background worker and only when you ask
                  for it: the page stays usable while it runs and the fit can be cancelled.
                </p>
                <p style={{ marginBottom: 0 }}>
                  EM is monotone in exact arithmetic. Any iteration that decreased the log-likelihood is reported as a fault rather than smoothed over.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runEmFit: true })} disabled={!simulated.ok}>
                  Fit by EM
                </Button>
              </div>
              {!simulated.ok && <p className="oc-muted">There is no simulated series yet, so there is nothing to fit.</p>}
            </>
          ) : !emReady ? (
            <Notice tone="info">There is nothing to fit.</Notice>
          ) : (
            <EngineJobPanel
              job={emJob}
              onClear={() => set({ runEmFit: false })}
              clearLabel="Stop fitting by EM"
              unitLabel="EM iterations"
              errorTitle="The EM fit failed"
              testId="em-fit"
            >
              {emFit && (
            <>
              <KeyValueList
                items={[
                  { label: 'Iterations run', value: String(emFit.iterations) },
                  { label: 'Converged', value: emFit.converged ? 'yes' : 'no — the iteration limit was reached first' },
                  { label: 'Log-likelihood at the fit', value: formatValue(emFit.logLikelihood, 8) },
                  {
                    label: 'Log-likelihood at the generating model',
                    value: baselineLogLikelihood.ok ? formatValue(baselineLogLikelihood.value, 8) : baselineLogLikelihood.error,
                  },
                  {
                    label: 'Exactness',
                    value: <Badge variant={emFit.exactness}>{EXACTNESS_LABEL[emFit.exactness]}</Badge>,
                  },
                ]}
              />
              {!emFit.converged && (
                <Notice tone="warning" title="This fit is not converged">
                  The parameters shown are the last iterate, not a maximum. Raise the iteration limit before reading anything into them.
                </Notice>
              )}
              {emFit.monotonicityViolations.length > 0 && (
                <Notice
                  tone="error"
                  title={`${emFit.monotonicityViolations.length} iteration(s) decreased the log-likelihood, which EM cannot do`}
                  items={emFit.monotonicityViolations.map((v) => `iteration ${v.iteration}: decrease of ${formatValue(v.decrease, 6)}`)}
                />
              )}
              {emFit.partial && <Notice tone="warning">The fit is marked partial: it was stopped before finishing.</Notice>}
              <LineChart
                title="Log-likelihood by EM iteration"
                description="The log-likelihood after each iteration, as reported by the engine's EM path."
                series={[{ label: 'Log-likelihood', points: emFit.logLikelihoodPath.map((v, i) => ({ x: i + 1, y: v })) }]}
                xLabel="Iteration"
                yLabel="Log-likelihood"
              />
              <ExplanationPanel explanation={emFit.explanation} />
              <WarningList warnings={emFit.warnings} />
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runEmFit: false })}>
                  Clear the EM fit
                </Button>
              </div>
            </>
              )}
            </EngineJobPanel>
          )}
        </Card>

        {/* ------------------------------------------- direct maximisation */}
        <Card
          title="Maximising the exact likelihood directly"
          hint="Nelder-Mead over the log standard deviations, where EM has no closed form for the parameterisation you want."
        >
          <NumberField
            label="Maximum Nelder-Mead iterations"
            value={config.directMaxIterations}
            onChange={(directMaxIterations) => set({ directMaxIterations })}
            min={10}
            max={5000}
            integer
          />
          {!config.runDirectFit ? (
            <>
              <Notice tone="info" title="The direct search is not run automatically">
                <p style={{ marginTop: 0 }}>
                  Every trial point in the search is a complete Kalman filter run over all {steps} steps, and the search makes hundreds of them.
                  That blocks the page while it runs, so it happens only on request.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Nelder-Mead is derivative-free because the parameterisation is arbitrary. A search that does not converge is reported as not
                  converged, and its best point is not a maximum.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runDirectFit: true })} disabled={!simulated.ok}>
                  Maximise the likelihood
                </Button>
              </div>
              {!simulated.ok && <p className="oc-muted">There is no simulated series yet, so there is nothing to maximise over.</p>}
            </>
          ) : direct.status === 'running' ? (
            <RunningState completed={direct.done} total={direct.total} unitLabel="Nelder-Mead iterations" onCancel={cancelDirect} />
          ) : direct.status === 'cancelled' ? (
            <>
              <Notice tone="warning" title="Cancelled before it finished">
                <p style={{ margin: 0 }}>
                  The search was stopped after {direct.done.toLocaleString('en-US')} of {direct.total.toLocaleString('en-US')} iterations. No parameters
                  are shown: the simplex at an arbitrary iteration is not a less precise version of the maximum, so there is no number here that would
                  mean anything.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runDirectFit: false })}>
                  Clear the direct search
                </Button>
              </div>
            </>
          ) : !directFit ? (
            <Notice tone="info">There is nothing to maximise over.</Notice>
          ) : !directFit.ok ? (
            <>
              <Notice tone="error">{directFit.error}</Notice>
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runDirectFit: false })}>
                  Stop the direct search
                </Button>
              </div>
            </>
          ) : (
            <>
              <KeyValueList
                items={[
                  { label: 'Iterations', value: String(directFit.value.result.iterations) },
                  {
                    label: 'Converged',
                    value: directFit.value.result.converged ? 'yes' : 'no — the best point found is not a maximum',
                  },
                  { label: 'Log-likelihood at the best point', value: formatValue(directFit.value.result.logLikelihood, 8) },
                  {
                    label: 'Log-likelihood at the generating model',
                    value: baselineLogLikelihood.ok ? formatValue(baselineLogLikelihood.value, 8) : baselineLogLikelihood.error,
                  },
                  {
                    label: 'Exactness',
                    value: (
                      <Badge variant={directFit.value.result.exactness}>{EXACTNESS_LABEL[directFit.value.result.exactness]}</Badge>
                    ),
                  },
                ]}
              />
              {!directFit.value.result.converged && (
                <Notice tone="warning" title="This search is not converged">
                  The point below is the best one found, not a maximum of the likelihood. The engine reports it as such rather than presenting it as a
                  fit.
                </Notice>
              )}
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="Free parameters, on the log scale the search works on"
                  columns={parameterColumns}
                  rows={directRows}
                />
              </div>
              <p className="oc-chart-note">
                The parameters are logs of standard deviations, so the search is unconstrained and every trial point is a valid model. These are point
                estimates with no interval: this screen does not report a confidence interval for them, because the engine returns none and one would
                have to be invented.
              </p>
              <ExplanationPanel explanation={directFit.value.result.explanation} />
              <WarningList warnings={directFit.value.result.warnings} />
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runDirectFit: false })}>
                  Clear the direct fit
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* ===================================================== non-linear */}
        <Card
          title="Non-linear filtering: the extended and unscented Kalman filters"
          hint="A separate simulated series from a genuinely non-linear model in the engine's library. Both filters are approximations, and the engine says so in its own exactness field rather than leaving it to be inferred."
        >
          <SelectField
            label="Non-linear model"
            value={config.nonlinearModel}
            onChange={(nonlinearModel) => set({ nonlinearModel: nonlinearModel as NonlinearModelKind, nonlinearFocusState: 0 })}
            options={NONLINEAR_MODEL_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
            hint={NONLINEAR_MODEL_OPTIONS.find((m) => m.value === config.nonlinearModel)?.note}
          />
          <NumberField
            label="Time steps (non-linear series)"
            value={config.nonlinearSteps}
            onChange={(nonlinearSteps) => set({ nonlinearSteps })}
            min={2}
            max={2000}
            integer
          />
          <TextField label="Seed (non-linear series)" value={config.nonlinearSeed} onChange={(nonlinearSeed) => set({ nonlinearSeed })} />
          <NumberField
            label="Process noise (standard deviation)"
            value={config.nonlinearProcessNoise}
            onChange={(nonlinearProcessNoise) => set({ nonlinearProcessNoise })}
            min={0.0001}
            step={0.05}
          />
          <NumberField
            label="Measurement noise (standard deviation)"
            value={config.nonlinearMeasurementNoise}
            onChange={(nonlinearMeasurementNoise) => set({ nonlinearMeasurementNoise })}
            min={0.0001}
            step={0.05}
          />
          {config.nonlinearModel === 'noisy-pendulum' ? (
            <>
              <SelectField
                label="What is measured"
                value={config.pendulumMeasure}
                onChange={(pendulumMeasure) => set({ pendulumMeasure: pendulumMeasure as 'angle' | 'sine' })}
                options={[
                  { value: 'sine', label: 'Horizontal displacement, sin θ — a non-linear measurement as well as non-linear dynamics' },
                  { value: 'angle', label: 'The angle itself — non-linear through the dynamics only' },
                ]}
              />
              <NumberField
                label="Initial angle in radians"
                value={config.pendulumInitialAngle}
                onChange={(pendulumInitialAngle) => set({ pendulumInitialAngle })}
                min={-3}
                max={3}
                step={0.1}
                hint="At a large angle sin θ is nowhere near θ, which is exactly where the EKF linearisation stops being usable."
              />
            </>
          ) : (
            <>
              <NumberField label="Growth rate per step" value={config.growthRate} onChange={(growthRate) => set({ growthRate })} min={-5} max={5} step={0.05} />
              <NumberField label="Carrying capacity" value={config.growthCapacity} onChange={(growthCapacity) => set({ growthCapacity })} min={0.0001} step={10} />
            </>
          )}
          <Checkbox
            checked={config.useNumericalJacobian}
            onChange={(useNumericalJacobian) => set({ useNumericalJacobian })}
            label="Withhold the analytic Jacobians"
            description="The EKF then differentiates the model by finite differences, and the engine reports that the linearisation — and therefore the covariance — is less accurate for it."
          />
          {!nlModel.ok ? (
            <Notice tone="error">{nlModel.error}</Notice>
          ) : !nlSimulated.ok ? (
            <Notice tone="error">{nlSimulated.error}</Notice>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="The two filters on one series. The divergence is the point: the EKF's own covariance cannot report it, and the innovation and NEES rows can."
                  columns={nonlinearCompareColumns}
                  rows={nlCompareRows}
                />
              </div>
              <Notice tone="info" title="Why neither of these is labelled exact">
                The linear section's intervals are exact conditional Gaussians. These are not: the EKF replaces f and h by their first-order
                expansions about the current estimate, and the UKF matches a Gaussian to propagated sigma points. The engine returns each result
                with its own exactness field, and the badges below are that field, not a judgement made on this screen.
              </Notice>
              <SelectField
                label="Filter followed by the charts and the tables below"
                value={config.nonlinearFilter}
                onChange={(nonlinearFilter) => set({ nonlinearFilter: nonlinearFilter as 'ekf' | 'ukf' })}
                options={[
                  { value: 'ukf', label: 'Unscented Kalman filter' },
                  { value: 'ekf', label: 'Extended Kalman filter' },
                ]}
              />
              <NumberField
                label="State component shown in the non-linear charts"
                value={config.nonlinearFocusState}
                onChange={(nonlinearFocusState) => set({ nonlinearFocusState })}
                min={0}
                max={Math.max(0, nlStateNames.length - 1)}
                integer
                hint={nlStateNames.map((n, i) => `${i} = ${n}`).join(', ')}
              />
              {!nlRun.ok && <Notice tone="error">{nlRun.error}</Notice>}
              {nlRun.ok && (
                <KeyValueList
                  items={[
                    { label: 'Method', value: nlRun.value.result.method === 'ekf' ? 'extended Kalman filter' : 'unscented Kalman filter' },
                    { label: 'Steps filtered', value: nlRun.value.result.steps.length.toLocaleString('en-US') },
                    { label: 'Scalar observations used', value: nlRun.value.result.observedCount.toLocaleString('en-US') },
                    { label: 'Approximate log-likelihood', value: formatValue(nlRun.value.result.approximateLogLikelihood, 8) },
                    { label: 'Measured run time', value: `${nlRun.value.elapsedMs.toFixed(1)} ms` },
                    {
                      label: 'Exactness',
                      value: <Badge variant={nlRun.value.result.exactness}>{EXACTNESS_LABEL[nlRun.value.result.exactness]}</Badge>,
                    },
                  ]}
                />
              )}
              {nlChartData && (
                <>
                  <LineChart
                    title={`Truth and both non-linear filters: ${nlStateNames[nlFocus] ?? `state ${nlFocus + 1}`}`}
                    description="The simulated true state with the EKF and UKF estimates of it, on the same measurements."
                    series={[
                      { label: 'True state (simulated)', points: nlChartData.truth },
                      { label: 'Extended Kalman filter', points: nlChartData.ekfLine },
                      { label: 'Unscented Kalman filter', points: nlChartData.ukfLine, dashed: true },
                    ]}
                    xLabel="Time step"
                    yLabel="Value"
                    note="Where the two estimates separate, at most one of them is tracking the state — and neither filter's covariance says which."
                  />
                  <FanChart
                    title={`Uncertainty in the state, ${config.nonlinearFilter === 'ekf' ? 'EKF' : 'UKF'}: ${nlStateNames[nlFocus] ?? `state ${nlFocus + 1}`}`}
                    description="The filtered mean with its interval from the filtered covariance. This is an approximate statement about the state estimate, not the spread of future measurements."
                    x={nlChartData.x}
                    bands={[{ label: `${Math.round(config.level * 100)}% interval for the state (approximate)`, lower: nlChartData.lower, upper: nlChartData.upper }]}
                    center={{ label: 'Filtered estimate', values: nlChartData.centre }}
                    bandMeaning="mean-uncertainty"
                    observed={{ label: 'True state (simulated)', points: nlChartData.truth }}
                    xLabel="Time step"
                    yLabel="Value"
                    note="The band comes from a Gaussian approximation to the posterior. On a strongly non-linear model it can be narrow and wrong at the same time."
                  />
                </>
              )}
              {nlRun.ok && (
                <>
                  <h3 style={{ margin: 0 }}>Interval for the state (an estimate, approximate here)</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable caption="Filtered state at the last step of the non-linear series" columns={stateColumns} rows={nlStateRows} />
                  </div>
                  <h3 style={{ margin: 0 }}>Predictive range for an observation (an outcome)</h3>
                  {nlPredictiveRows.length === 0 ? (
                    <Notice tone="info">
                      The last step has no observation predictive moments — the observation there is missing, so the engine reports none rather than
                      a substituted value.
                    </Notice>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable caption="Predictive distribution of the observation, H P Hᵀ + R at the linearisation point" columns={predictiveColumns} rows={nlPredictiveRows} />
                    </div>
                  )}
                  <ExplanationPanel explanation={nlRun.value.result.explanation} />
                  <WarningList warnings={nlRun.value.result.warnings} />
                </>
              )}
              {config.nonlinearFilter === 'ukf' && ekf.ok && <WarningList warnings={ekf.value.result.warnings} />}
              {config.nonlinearFilter === 'ekf' && ukf.ok && <WarningList warnings={ukf.value.result.warnings} />}
            </>
          )}
        </Card>

        {/* ====================================================== particles */}
        <Card
          title="Particle filter, against the exact answer on the same data"
          hint="A particle filter assumes neither linearity nor Gaussianity, and pays for it in Monte Carlo error and in weight degeneracy. Both are shown."
        >
          <Notice tone="info" title="Which model this runs on, and why">
            <p style={{ marginTop: 0 }}>
              The engine offers one route from a model it already has to a particle model, and it is the linear-Gaussian one. That is the valuable
              pairing: on the series the Kalman filter above already filtered, the exact answer is known, so the particle filter can be read against
              it instead of against itself. The library's particle-only model — stochastic volatility, where the latent state enters the observation
              variance and no Gaussian filter applies at all — is deliberately not offered here, because the engine has no simulator for it and this
              screen will not invent data.
            </p>
            <p style={{ marginBottom: 0 }}>
              The non-linear models above are not offered to the particle filter either: the engine supplies no sampler or observation density for
              them, and writing one on this screen would be putting a model in the interface.
            </p>
          </Notice>
          <NumberField
            label="Particles"
            value={config.particleCount}
            onChange={(particleCount) => set({ particleCount })}
            min={1}
            max={50000}
            integer
            hint="Every particle is a complete model evaluation at every step. The cost is linear in this number."
          />
          <SelectField
            label="Resampling scheme"
            value={config.particleScheme}
            onChange={(particleScheme) => set({ particleScheme: particleScheme as ResamplingScheme })}
            options={SCHEME_OPTIONS}
          />
          <NumberField
            label="Resample when ESS/N falls below"
            value={config.particleEssThreshold}
            onChange={(particleEssThreshold) => set({ particleEssThreshold })}
            min={0}
            max={1}
            step={0.05}
            hint="1 resamples every step; 0 never resamples, which is the fastest way to watch the weights collapse."
          />
          <NumberField
            label="Flag a step as degenerate below ESS/N"
            value={config.particleDegeneracyThreshold}
            onChange={(particleDegeneracyThreshold) => set({ particleDegeneracyThreshold })}
            min={0}
            max={1}
            step={0.05}
          />
          <Checkbox
            checked={config.particleAuxiliary}
            onChange={(particleAuxiliary) => set({ particleAuxiliary })}
            label="Use the auxiliary (look-ahead) filter"
            description="Its first stage pre-weights particles by how well the predicted state would explain the next observation, so particles that cannot explain it are dropped before being propagated."
          />
          <TextField label="Seed (particle filter)" value={config.particleSeed} onChange={(particleSeed) => set({ particleSeed })} />
          {!config.runParticleFilter ? (
            <>
              <Notice tone="warning" title="The particle filter is not run automatically">
                <p style={{ marginTop: 0 }}>
                  {particleCount.toLocaleString('en-US')} particles over {steps.toLocaleString('en-US')} steps is{' '}
                  {(particleCount * steps).toLocaleString('en-US')} model evaluations, which is well past the 300 ms this screen tries to stay
                  inside. It is driven as a yielding generator a slice at a time, so the page keeps repainting and Cancel lands between slices, but
                  it still only runs when you ask for it.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Every number it produces is a Monte Carlo estimate. If the effective sample size collapses, the mean and covariance come from a
                  handful of surviving particles and mean very little — so the effective sample size, the resampling events and the largest single
                  weight are reported beside the estimate rather than behind it.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runParticleFilter: true })} disabled={!simulated.ok}>
                  Run the particle filter
                </Button>
              </div>
              {!simulated.ok && <p className="oc-muted">There is no simulated series yet, so there is nothing to filter.</p>}
            </>
          ) : particle.status === 'running' ? (
            <RunningState completed={particle.done} total={particle.total} unitLabel="time steps" onCancel={cancelParticle} />
          ) : particle.status === 'cancelled' ? (
            <>
              <Notice tone="warning" title="Cancelled before it finished">
                <p style={{ margin: 0 }}>
                  The run was stopped after {particle.done.toLocaleString('en-US')} of {particle.total.toLocaleString('en-US')} steps. No estimates
                  are shown: a filter stopped part-way has not seen the rest of the data, and its last cloud is not a less precise answer to the
                  question asked.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runParticleFilter: false })}>
                  Clear the particle run
                </Button>
              </div>
            </>
          ) : particle.status === 'error' ? (
            <>
              <Notice tone="error">{particle.message}</Notice>
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runParticleFilter: false })}>
                  Stop the particle filter
                </Button>
              </div>
            </>
          ) : particleRun === null ? (
            <Notice tone="info">The particle filter has not produced a run yet.</Notice>
          ) : (
            <>
              <Notice
                tone={particleRun.degenerateSteps.length > 0 ? 'error' : 'success'}
                title={
                  particleRun.degenerateSteps.length > 0
                    ? `WEIGHT DEGENERACY at ${particleRun.degenerateSteps.length} of ${particleRun.steps.length} steps`
                    : 'No step fell below the degeneracy threshold'
                }
              >
                <p style={{ margin: 0 }}>
                  The smallest effective sample size reached was {formatValue(particleRun.minEss, 4)} of {particleRun.particles.toLocaleString('en-US')}{' '}
                  particles, at step {particleRun.minEssTime + 1}. A filter running on a handful of surviving particles still reports a mean and a
                  covariance, and they look perfectly reasonable: the effective sample size is the only thing that says otherwise.
                </p>
              </Notice>
              <KeyValueList
                items={[
                  { label: 'Method', value: particleRun.method },
                  { label: 'Particles', value: particleRun.particles.toLocaleString('en-US') },
                  { label: 'Resampling scheme', value: particleRun.scheme },
                  { label: 'Resampling events', value: `${particleRun.resampleTimes.length.toLocaleString('en-US')} of ${particleRun.steps.length} steps` },
                  { label: 'Minimum effective sample size', value: `${formatValue(particleRun.minEss, 4)} at step ${particleRun.minEssTime + 1}` },
                  { label: 'Steps flagged degenerate', value: particleRun.degenerateSteps.length.toLocaleString('en-US') },
                  { label: 'Largest single weight at the last step', value: particleLast ? formatValue(particleLast.maxWeight, 6) : 'not recorded' },
                  { label: 'Log-likelihood estimate (Monte Carlo)', value: formatValue(particleRun.logLikelihood, 6) },
                  {
                    label: 'Log-likelihood, exactly, from the Kalman filter on the same data',
                    value: baselineLogLikelihood.ok ? formatValue(baselineLogLikelihood.value, 6) : baselineLogLikelihood.error,
                  },
                  {
                    label: 'Measured run time',
                    value: particleElapsedMs === null ? 'not recorded' : `${particleElapsedMs.toFixed(0)} ms`,
                  },
                  {
                    label: 'Exactness',
                    value: <Badge variant={particleRun.exactness}>{EXACTNESS_LABEL[particleRun.exactness]}</Badge>,
                  },
                ]}
              />
              <LineChart
                title="Effective sample size at every step"
                description="ESS = 1 / Σ wᵢ², from the engine. It is the number of particles the estimate at that step actually rests on."
                series={[{ label: 'Effective sample size', points: particleRun.steps.map((st, i) => ({ x: i + 1, y: st.ess })) }]}
                xLabel="Time step"
                yLabel="Effective sample size"
                referenceLines={[
                  { value: particleRun.particles * config.particleEssThreshold, label: 'resampling trigger', axis: 'y' },
                  { value: particleRun.particles * config.particleDegeneracyThreshold, label: 'degeneracy threshold', axis: 'y' },
                ]}
                note="A drop towards 1 means one particle is carrying the whole estimate. Resampling restores the count but not the lost diversity."
              />
              <LineChart
                title="Largest single normalised weight at every step"
                description="1 means one particle carries everything and the reported covariance is the spread of a single point."
                series={[{ label: 'Largest weight', points: particleRun.steps.map((st, i) => ({ x: i + 1, y: st.maxWeight })) }]}
                xLabel="Time step"
                yLabel="Largest weight"
              />
              <h3 style={{ margin: 0 }}>The particle estimate against the exact one</h3>
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="Last step: the exact Kalman mean, the particle mean, and the two different spreads that belong to it"
                  columns={particleCompareColumns}
                  rows={particleCompareRows}
                />
              </div>
              <Notice tone="info" title="The two spreads in that table are different quantities">
                The Monte Carlo standard error says how precisely {particleRun.particles.toLocaleString('en-US')} particles locate the posterior
                mean, and it shrinks as the particle count grows. The particle standard deviation is the posterior spread itself, and it does not.
                Neither is a predictive range for a new observation: that is the Kalman section's second table, and nothing in a particle step
                provides it, so none is shown here.
              </Notice>
              {degeneracyRows.length > 0 && (
                <>
                  <h3 style={{ margin: 0 }}>Every step the engine flagged as degenerate</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption={`Steps where the effective sample size fell below ${(config.particleDegeneracyThreshold * 100).toFixed(0)}% of the particles${particleRun.degenerateSteps.length > 200 ? ', first 200 shown' : ''}`}
                      columns={degeneracyColumns}
                      rows={degeneracyRows}
                      maxHeight={320}
                    />
                  </div>
                </>
              )}
              {particleRun.partial && (
                <Notice tone="warning">The run is marked partial, so the series was not filtered to the end.</Notice>
              )}
              <ExplanationPanel explanation={particleRun.explanation} />
              <WarningList warnings={particleRun.warnings} />
              <div className="oc-btn-row">
                <Button icon="reset" onClick={() => set({ runParticleFilter: false })}>
                  Clear the particle run
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

/** The engine's own warnings, never paraphrased and never hidden. */
function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return <Notice tone="warning" title={warnings.length === 1 ? 'One caveat from the engine' : `${warnings.length} caveats from the engine`} items={warnings} />;
}
