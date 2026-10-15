/**
 * General Bayesian inference by MCMC.
 *
 * Everything shown comes from `src/engine/mcmc`: the problems from its
 * registry, the draws from its generator driver, and the diagnostics and
 * summaries from its own code. MCMC output is `empirical`, so no posterior
 * number is shown without its convergence verdict and Monte Carlo error: a
 * non-converged chain's mean is not an estimate of anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONVERGENCE_THRESHOLDS,
  INFERENCE_PROBLEMS,
  betaBinomialPosterior,
  drawsAsVectors,
  getInferenceProblem,
  mcmcSteps,
  posteriorPredictive,
  type McmcProgress,
  type McmcRequest,
  type McmcResult,
  type SamplerConfig,
  type TargetSpec,
} from '../../engine/mcmc/index';
import { updateBayesian } from '../../engine/probability/bayesian';
import { histogram } from '../../engine/stats/descriptive';
import { EngineError, type Issue } from '../../engine/core/result';
import type { Random } from '../../engine/random/rng';
import { randomSeed } from '../../engine/random/rng';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  RunningState,
  SelectField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { HistogramChart, LineChart } from '../../ui/charts/charts';
import { AcfChart } from '../../ui/charts/advanced';
import { formatValue } from '../../ui/charts/scale';
import { Icon } from '../../ui/icons';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

export type SamplerKind = 'metropolis' | 'adaptive-metropolis' | 'hmc' | 'slice' | 'gibbs';

export interface BayesianInferenceConfig {
  /** Id from the engine's `INFERENCE_PROBLEMS` registry. */
  problemId: string;
  sampler: SamplerKind;
  chains: number;
  /** Warm-up iterations per chain; adaptation happens here only. */
  warmup: number;
  /** Retained draws per chain. */
  iterations: number;
  seed: string;
  /** Proposal scale for the plain Metropolis random walk. */
  proposalScale: number;
  /** Leapfrog steps per HMC trajectory. */
  leapfrogSteps: number;
  /** Credible level used for both the equal-tailed interval and the HDI. */
  level: number;
  /** Which parameter the trace, ACF and posterior histogram show. */
  focusParameter: number;
  /** Predictor value at which the logistic model's predictive outcome is drawn. */
  predictiveAt: number;
  /** Data for the conjugate cross-check: successes out of successes + failures, Beta(a, b) prior. */
  crossCheck: { successes: number; failures: number; priorA: number; priorB: number };
}

export const BAYESIAN_INFERENCE_DEFAULT: BayesianInferenceConfig = {
  // Eight schools with HMC converges in a short run and shows the whole point
  // of the tool: a hierarchical posterior with no closed form.
  problemId: 'eight-schools',
  sampler: 'hmc',
  chains: 4,
  warmup: 500,
  iterations: 1000,
  seed: 'mcmc-1',
  proposalScale: 1,
  leapfrogSteps: 12,
  level: 0.95,
  focusParameter: 0,
  predictiveAt: 1,
  crossCheck: { successes: 37, failures: 63, priorA: 2, priorB: 2 },
};

const SAMPLERS: { value: SamplerKind; label: string; note: string }[] = [
  { value: 'metropolis', label: 'Metropolis (fixed random walk)', note: 'Simplest possible sampler. The proposal scale is yours to tune; a badly chosen one mixes very slowly.' },
  { value: 'adaptive-metropolis', label: 'Adaptive Metropolis', note: 'Learns a proposal covariance during warm-up, then freezes it. Needs at least 50 warm-up iterations.' },
  { value: 'hmc', label: 'Hamiltonian Monte Carlo', note: 'Uses the gradient of the log posterior, so it crosses correlated posteriors in few steps. Needs a differentiable target.' },
  { value: 'slice', label: 'Slice sampling', note: 'No proposal scale to tune and no gradient needed. A good default for awkward or non-differentiable targets.' },
  { value: 'gibbs', label: 'Gibbs', note: 'Draws each coordinate from its exact full conditional — only available when the problem supplies those conditionals.' },
];

/**
 * Posterior predictive generators. `posteriorPredictive` takes the sampling
 * distribution from the caller by design: the engine knows the posterior but
 * not what a new observation of this model would be. Each one below is the
 * model's own likelihood evaluated at a posterior draw, written out so it can
 * be checked against the problem definition in `problems.ts`.
 */
function predictiveGenerator(
  problemId: string,
  predictiveAt: number,
): { generate: (parameters: readonly number[], rng: Random) => number; label: string; detail: string } | null {
  switch (problemId) {
    case 'poisson-lognormal':
      return {
        generate: (p, rng) => rng.poisson(Math.exp(p[0])),
        label: 'Count in one further period',
        detail: 'Poisson(exp(log_lambda)) at each posterior draw, so it carries both rate uncertainty and Poisson variability.',
      };
    case 'normal-unknown-mean-variance':
      return {
        generate: (p, rng) => p[0] + Math.exp(p[1]) * rng.normal(),
        label: 'One further observation',
        detail: 'Normal(mu, sigma) at each posterior draw. Wider than a credible interval for mu, because it also includes observation noise.',
      };
    case 'eight-schools':
      return {
        generate: (p, rng) => p[0] + Math.exp(p[1]) * rng.normal(),
        label: 'True effect in a new group',
        detail: 'mu + tau·eta for a fresh group, at each posterior draw: the spread shows how much the groups are believed to differ.',
      };
    case 'change-point-poisson':
      return {
        generate: (p, rng) => rng.poisson(Math.exp(p[2])),
        label: 'Count after the change point',
        detail: 'Poisson(exp(log_lambda2)) at each posterior draw — the post-change regime.',
      };
    case 'logistic-regression':
      return {
        generate: (p, rng) => (rng.bernoulli(1 / (1 + Math.exp(-(p[0] + p[1] * predictiveAt)))) ? 1 : 0),
        label: `Outcome at predictor = ${formatValue(predictiveAt, 4)}`,
        detail: 'Bernoulli(logistic(intercept + slope·x)) at each posterior draw. The mean of these draws is the predicted probability.',
      };
    default:
      return null;
  }
}

/** Build the sampler configuration the engine expects from the stored settings. */
function samplerConfig(config: BayesianInferenceConfig): SamplerConfig {
  switch (config.sampler) {
    case 'metropolis':
      return { kind: 'metropolis', proposalScale: config.proposalScale };
    case 'adaptive-metropolis':
      return { kind: 'adaptive-metropolis' };
    case 'hmc':
      return { kind: 'hmc', leapfrogSteps: config.leapfrogSteps };
    case 'slice':
      return { kind: 'slice' };
    case 'gibbs':
      return { kind: 'gibbs' };
  }
}

interface RunState {
  status: 'idle' | 'running';
  progress: McmcProgress | null;
  result: McmcResult | null;
  issues: Issue[];
}

const IDLE: RunState = { status: 'idle', progress: null, result: null, issues: [] };

/**
 * Drives `mcmcSteps` on the main thread, yielding to the event loop between
 * chunks. The yield is the whole reason the driver is a generator: without
 * returning to the loop the Cancel button could never be pressed, and this
 * tool has no worker route of its own.
 */
function useMcmcRun(): RunState & { start(request: McmcRequest): void; cancel(): void; reset(): void } {
  const [state, setState] = useState<RunState>(IDLE);
  const cancelled = useRef(false);
  const generation = useRef(0);

  // Abandon any in-flight run when the screen is left, so a cancelled chain is
  // not left consuming the main thread for a result nothing will display.
  useEffect(
    () => () => {
      cancelled.current = true;
      generation.current += 1;
    },
    [],
  );

  const start = useCallback((request: McmcRequest) => {
    cancelled.current = false;
    generation.current += 1;
    const mine = generation.current;
    setState({ status: 'running', progress: null, result: null, issues: [] });
    let steps: Generator<McmcProgress, McmcResult, void>;
    try {
      steps = mcmcSteps(request, { isCancelled: () => cancelled.current });
    } catch (e) {
      setState({ status: 'idle', progress: null, result: null, issues: toIssues(e) });
      return;
    }
    const pump = () => {
      if (generation.current !== mine) return;
      try {
        const next = steps.next();
        if (next.done) {
          setState({ status: 'idle', progress: null, result: next.value, issues: [] });
          return;
        }
        setState((prev) => ({ ...prev, progress: next.value }));
        setTimeout(pump, 0);
      } catch (e) {
        setState({ status: 'idle', progress: null, result: null, issues: toIssues(e) });
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
    setState(IDLE);
  }, []);

  return { ...state, start, cancel, reset };
}

function toIssues(e: unknown): Issue[] {
  if (e instanceof EngineError) return e.issues;
  return [{ code: 'unexpected', message: e instanceof Error ? e.message : String(e) }];
}

export function BayesianInferenceTool({ config }: { config: BayesianInferenceConfig }) {
  const app = useApp();
  const set = (patch: Partial<BayesianInferenceConfig>) => app.updateConfig({ ...config, ...patch });

  const main = useMcmcRun();
  const check = useMcmcRun();

  /** The problem and its target, built from the engine registry. */
  const problem = useMemo(() => {
    try {
      const p = getInferenceProblem(config.problemId);
      return { ok: true as const, problem: p, target: p.build() };
    } catch (e) {
      return { ok: false as const, issues: toIssues(e) };
    }
  }, [config.problemId]);

  const target: TargetSpec | null = problem.ok ? problem.target : null;

  const request = useMemo<McmcRequest | null>(() => {
    if (!target) return null;
    return {
      target,
      sampler: samplerConfig(config),
      chains: config.chains,
      iterations: config.iterations,
      warmup: config.warmup,
      seed: config.seed,
      chunkSize: 100,
    };
  }, [target, config]);

  const checkRequest = useMemo<McmcRequest | null>(() => {
    const { successes, failures, priorA, priorB } = config.crossCheck;
    try {
      return {
        // Sampled on the probability scale, where the comparison against the
        // Beta posterior is direct and no Jacobian enters the summaries.
        target: betaBinomialPosterior({ successes, failures, priorA, priorB, parameterisation: 'probability' }),
        sampler: { kind: 'slice' },
        chains: 4,
        iterations: 2000,
        warmup: 500,
        seed: `${config.seed}:conjugate`,
        chunkSize: 250,
      };
    } catch {
      return null;
    }
  }, [config.crossCheck, config.seed]);

  const exactPosterior = useMemo(() => {
    const { successes, failures, priorA, priorB } = config.crossCheck;
    try {
      return {
        ok: true as const,
        value: updateBayesian({ family: 'beta-binomial', priorAlpha: priorA, priorBeta: priorB, successes, failures }, config.level),
      };
    } catch (e) {
      return { ok: false as const, issues: toIssues(e) };
    }
  }, [config.crossCheck, config.level]);

  // Run once on open so the default configuration shows a real posterior
  // rather than an empty screen. Later runs are explicit.
  const autoRan = useRef(false);
  const startMain = main.start;
  useEffect(() => {
    if (autoRan.current || !request) return;
    autoRan.current = true;
    startMain(request);
  }, [request, startMain]);

  const result = main.result;
  const focus = result ? Math.min(Math.max(0, config.focusParameter), result.parameterNames.length - 1) : config.focusParameter;
  const plot = result?.plots[focus] ?? null;
  const focusSummary = result?.summaries[focus] ?? null;
  const focusDiagnostics = result?.diagnostics[focus] ?? null;

  const posteriorBins = useMemo(() => {
    if (!result) return [];
    const all: number[] = [];
    for (const chain of result.chains) for (const v of chain.draws[focus]) all.push(v);
    all.sort((a, b) => a - b);
    return histogram(all, { minBins: 12, maxBins: 48 });
  }, [result, focus]);

  const predictive = useMemo(() => {
    if (!result || result.partial) return null;
    const gen = predictiveGenerator(config.problemId, config.predictiveAt);
    if (!gen) return null;
    try {
      const draws = posteriorPredictive(drawsAsVectors(result), gen.generate, `${config.seed}:predictive`, 4000);
      const sorted = Array.from(draws).sort((a, b) => a - b);
      let sum = 0;
      for (const v of sorted) sum += v;
      const mean = sum / sorted.length;
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
      return {
        ok: true as const,
        label: gen.label,
        detail: gen.detail,
        bins: histogram(sorted, { minBins: 10, maxBins: 40 }),
        mean,
        low: q((1 - config.level) / 2),
        high: q(1 - (1 - config.level) / 2),
        count: sorted.length,
      };
    } catch (e) {
      return { ok: false as const, issues: toIssues(e) };
    }
  }, [result, config.problemId, config.predictiveAt, config.seed, config.level]);

  const converged = result?.convergence.verdict === 'converged';
  const samplerNote = SAMPLERS.find((s) => s.value === config.sampler)?.note ?? '';
  const gibbsUnavailable = config.sampler === 'gibbs' && !!target && !target.fullConditionals;

  return (
    <>
      <ToolHeader toolId="bayesian-inference" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Inference problem" hint="Problems come from the engine's own registry, each with its data attached.">
            <SelectField
              label="Model"
              value={config.problemId}
              onChange={(problemId) => {
                main.reset();
                autoRan.current = true;
                set({ problemId, focusParameter: 0 });
              }}
              options={INFERENCE_PROBLEMS.map((p) => ({ value: p.id, label: p.name }))}
            />
            {problem.ok && (
              <>
                <p style={{ fontSize: 12.5, margin: '0 0 var(--s3)' }}>{problem.problem.summary}</p>
                <KeyValueList
                  items={[
                    { label: 'Posterior', value: problem.target.name },
                    { label: 'Parameters', value: `${problem.target.dimension}: ${problem.target.parameterNames.join(', ')}` },
                    { label: 'Suggested sampler', value: SAMPLERS.find((s) => s.value === problem.problem.recommendedSampler)?.label ?? problem.problem.recommendedSampler },
                  ]}
                />
                {problem.target.description && <p className="oc-chart-note">{problem.target.description}</p>}
              </>
            )}
            {!problem.ok && <Notice tone="error" items={problem.issues.map((i) => i.message)} />}
          </Card>

          <Card title="Sampler">
            <SelectField
              label="Sampling algorithm"
              value={config.sampler}
              onChange={(sampler) => set({ sampler: sampler as SamplerKind })}
              options={SAMPLERS.map((s) => ({ value: s.value, label: s.label }))}
              hint={samplerNote}
            />
            {config.sampler === 'metropolis' && (
              <NumberField
                label="Proposal scale"
                value={config.proposalScale}
                onChange={(proposalScale) => set({ proposalScale })}
                min={0.001}
                max={100}
                step={0.1}
                hint="Multiplies the random-walk step length. Too small and the chain crawls; too large and almost every move is rejected."
              />
            )}
            {config.sampler === 'hmc' && (
              <NumberField
                label="Leapfrog steps per trajectory"
                value={config.leapfrogSteps}
                onChange={(leapfrogSteps) => set({ leapfrogSteps })}
                min={1}
                max={200}
                integer
                hint="Longer trajectories cost more density and gradient evaluations but travel further per draw. The step size is tuned during warm-up."
              />
            )}
            {gibbsUnavailable && (
              <Notice tone="warning" title="Gibbs is not available for this problem">
                Gibbs sampling needs the exact full conditional of every parameter, and this problem does not supply them. The engine will refuse the run rather
                than substitute an approximation. Choose slice sampling or Metropolis instead.
              </Notice>
            )}
            <NumberField
              label="Chains"
              value={config.chains}
              onChange={(chains) => set({ chains })}
              min={1}
              max={16}
              integer
              hint="R-hat compares variance between chains with variance within them, so at least 2 chains — started at dispersed points — are needed for it to mean anything."
            />
            <NumberField
              label="Warm-up iterations per chain"
              value={config.warmup}
              onChange={(warmup) => set({ warmup })}
              min={0}
              max={50000}
              integer
              hint="Discarded, and the only phase in which tuning happens. Adaptive Metropolis and HMC need at least 50."
            />
            <NumberField
              label="Retained draws per chain"
              value={config.iterations}
              onChange={(iterations) => set({ iterations })}
              min={1}
              max={200000}
              integer
            />
            <TextField
              label="Random seed"
              value={config.seed}
              onChange={(seed) => set({ seed })}
              monospace
              hint="The same seed with the same settings reproduces the run exactly."
            />
            <Button icon="shuffle" onClick={() => set({ seed: randomSeed() })}>
              New seed
            </Button>
          </Card>

          <Card title="Run">
            {main.status === 'running' ? (
              <RunningState
                completed={main.progress?.completedIterations ?? 0}
                total={main.progress?.totalIterations ?? 0}
                unitLabel={main.progress ? `${main.progress.phase === 'warmup' ? 'warm-up' : 'sampling'} iterations (chain ${main.progress.chain + 1} of ${main.progress.chains})` : 'iterations'}
                onCancel={main.cancel}
              />
            ) : (
              <Button variant="primary" icon="mcmc" block disabled={!request} onClick={() => request && main.start(request)}>
                Run the sampler
              </Button>
            )}
            {main.issues.length > 0 && <Notice tone="error" title="The run could not be completed" items={main.issues.map((i) => i.message)} />}
            {result?.partial && (
              <Notice tone="warning" title="Cancelled part-way">
                These draws are an incomplete chain. The diagnostics below describe what was collected, not a finished run.
              </Notice>
            )}
          </Card>

          <AiAssistPanel
            capability="explainUncertainty"
            context="MCMC gives an empirical posterior: every number carries Monte Carlo error, and none of it means anything until the convergence diagnostics pass."
          />
        </div>

        <div className="oc-stack">
          {!result && main.status === 'running' && (
            <Card title="Sampling">
              <p style={{ fontSize: 12.5, margin: 0 }}>
                Chains are running. The sampler yields between chunks of iterations, which is what lets you cancel it part-way.
              </p>
            </Card>
          )}

          {result && (
            <>
              {/* The verdict comes first, and loudest when it is bad: a pooled
                  mean from chains that have not mixed is not an estimate. */}
              <Card title="Convergence verdict">
                <Notice
                  tone={converged ? 'success' : result.convergence.verdict === 'marginal' ? 'warning' : 'error'}
                  title={`${verdictIcon(result.convergence.verdict)} ${verdictLabel(result.convergence.verdict)}`}
                >
                  <p style={{ margin: 0 }}>{result.convergence.headline}</p>
                </Notice>
                {result.convergence.reasons.length > 0 && <Notice tone="info" title="Why" items={result.convergence.reasons} />}
                <KeyValueList
                  items={[
                    { label: 'Worst R-hat', value: `${formatValue(result.convergence.worstRHat, 4)} (${result.convergence.worstRHatParameter})` },
                    {
                      label: 'Lowest effective sample size',
                      value: `${Number.isFinite(result.convergence.lowestEffectiveSampleSize) ? Math.round(result.convergence.lowestEffectiveSampleSize).toLocaleString('en-US') : 'not computable'} (${result.convergence.lowestEffectiveSampleSizeParameter})`,
                    },
                    { label: 'Thresholds', value: `R-hat < ${result.convergence.thresholds.rHat}, ESS > ${result.convergence.thresholds.ess}` },
                    { label: 'Divergences while sampling', value: result.convergence.divergences.toLocaleString('en-US') },
                    { label: 'Acceptance rate', value: formatValue(result.acceptanceRate, 3) },
                    { label: 'Draws', value: `${result.totalDraws.toLocaleString('en-US')} (${result.chains.length} chains x ${result.drawsPerChain.toLocaleString('en-US')})` },
                  ]}
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Per-parameter convergence diagnostics"
                    columns={diagnosticColumns}
                    rows={result.diagnostics.map((d) => ({ d }))}
                  />
                </div>
                <p className="oc-chart-note">
                  R-hat is reported three ways: classic, split (which detects drift within a chain) and rank-normalised (which is not fooled by heavy tails). The
                  verdict uses the worst of them. None of these can prove convergence — they can only fail to detect its absence.
                </p>
                {result.warnings.length > 0 && <Notice tone="warning" title="Sampler warnings" items={result.warnings} />}
              </Card>

              <Card
                title="Posterior summaries"
                hint={`${formatValue(config.level * 100, 4)}% intervals. Sampler: ${result.samplerLabel}.`}
                actions={<Badge variant="empirical">empirical</Badge>}
              >
                {!converged && (
                  <Notice tone={result.convergence.verdict === 'marginal' ? 'warning' : 'error'} title="Read the verdict above first">
                    The chains did not pass the diagnostics, so the numbers in this table are not trustworthy posterior estimates. They are shown so the failure
                    can be diagnosed, not so they can be quoted.
                  </Notice>
                )}
                <div style={{ overflowX: 'auto' }}>
                  <DataTable caption="Posterior summaries per parameter" columns={summaryColumns} rows={result.summaries.map((s, i) => ({ s, mcse: result.diagnostics[i]?.mcseMean ?? NaN }))} />
                </div>
                <p className="oc-chart-note">
                  The two intervals answer different questions. The equal-tailed interval leaves {formatValue(((1 - config.level) / 2) * 100, 3)}% of the
                  posterior in each tail. The highest density interval is the shortest interval holding {formatValue(config.level * 100, 4)}% of the posterior,
                  so every point inside it is more probable than any point outside. For a skewed posterior they differ; for a multimodal one a single interval of
                  either kind is misleading.
                </p>
                <p className="oc-chart-note">
                  MCSE is the Monte Carlo standard error of the posterior mean — how much the mean would move with a different random seed. It is not a statement
                  about the parameter; the credible interval is.
                </p>
                <SelectField
                  label="Parameter shown in the plots below"
                  value={String(focus)}
                  onChange={(v) => set({ focusParameter: Number(v) })}
                  options={result.parameterNames.map((n, i) => ({ value: String(i), label: n }))}
                />
                {posteriorBins.length > 0 && focusSummary && (
                  <HistogramChart
                    title={`Posterior for ${focusSummary.parameter}`}
                    description={`Histogram of ${focusSummary.draws.toLocaleString('en-US')} pooled posterior draws for ${focusSummary.parameter}.`}
                    bins={posteriorBins}
                    xLabel={focusSummary.parameter}
                    markers={[
                      { x: focusSummary.mean, label: 'mean' },
                      { x: focusSummary.highestDensityInterval.lower, label: 'HDI low' },
                      { x: focusSummary.highestDensityInterval.upper, label: 'HDI high' },
                    ]}
                    note="Marked: the posterior mean and the highest density interval."
                  />
                )}
              </Card>

              <Card title="Trace and diagnostic plots" hint="One series per chain. Chains that have mixed are indistinguishable.">
                {plot && (
                  <div style={{ overflowX: 'auto' }}>
                    <LineChart
                      title={`Trace of ${plot.parameter}`}
                      description={`Retained draws of ${plot.parameter} in order, one series per chain.`}
                      series={plot.trace.map((t, c) => ({ label: `Chain ${c + 1}`, points: t.map((y, i) => ({ x: i + 1, y })) }))}
                      xLabel="Retained draw"
                      yLabel={plot.parameter}
                      note="A healthy trace looks like a flat band of noise with the chains overlapping. Trends, plateaus or separated bands mean the run is not usable."
                    />
                    <LineChart
                      title={`Running mean of ${plot.parameter}`}
                      description={`Cumulative mean of ${plot.parameter} within each chain.`}
                      series={plot.runningMean.map((t, c) => ({ label: `Chain ${c + 1}`, points: t.map((y, i) => ({ x: i + 1, y })) }))}
                      xLabel="Retained draw"
                      yLabel={`Running mean of ${plot.parameter}`}
                      note="Converged chains' running means settle on the same value. Means that are still moving, or settling on different values, are the clearest sign of a run that is too short."
                    />
                    <AcfChart
                      title={`Autocorrelation of ${plot.parameter}`}
                      description={`Autocorrelation of the pooled draws of ${plot.parameter} by lag.`}
                      data={plot.autocorrelation.lags.map((lag, i) => ({ lag, value: plot.autocorrelation.values[i] }))}
                      bounds={1.96 / Math.sqrt(Math.max(1, result.totalDraws))}
                      note={
                        focusDiagnostics
                          ? `Integrated autocorrelation time ${formatValue(focusDiagnostics.integratedAutocorrelationTime, 4)}: roughly that many draws are worth one independent one, which is why the effective sample size is below the raw draw count.`
                          : undefined
                      }
                    />
                  </div>
                )}
              </Card>

              <Card title="Posterior predictive">
                {!predictive && (
                  <Notice tone="info">
                    This problem does not define a single new observation to predict, so no predictive draws are generated. Inventing one would mean choosing a
                    sampling distribution the model does not state.
                  </Notice>
                )}
                {predictive && !predictive.ok && <Notice tone="error" items={predictive.issues.map((i) => i.message)} />}
                {predictive && predictive.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Quantity', value: predictive.label },
                        { label: 'Predictive mean', value: formatValue(predictive.mean, 5) },
                        {
                          label: `${formatValue(config.level * 100, 4)}% predictive interval`,
                          value: `${formatValue(predictive.low, 5)} to ${formatValue(predictive.high, 5)}`,
                        },
                        { label: 'Draws', value: predictive.count.toLocaleString('en-US') },
                      ]}
                    />
                    <p className="oc-chart-note">{predictive.detail}</p>
                    <HistogramChart
                      title={predictive.label}
                      description={`Posterior predictive draws of ${predictive.label.toLowerCase()}.`}
                      bins={predictive.bins}
                      xLabel={predictive.label}
                      note="This is a predictive interval for a new outcome, not a credible interval for a parameter. It is wider because it includes the model's own sampling variability."
                    />
                  </>
                )}
              </Card>

              <ExplanationPanel explanation={result.explanation} />
            </>
          )}

          <Card title="Conjugate cross-check" hint="Beta-Binomial: the one case where the exact posterior is known, so the sampler can be checked against it.">
            <p style={{ fontSize: 12.5, margin: '0 0 var(--s3)' }}>
              With a Beta(a, b) prior and binomial data the posterior is exactly Beta(a + successes, b + failures). Sampling that same posterior with slice
              sampling and comparing the two is the sharpest available check that the sampler is drawing from the distribution it claims to.
            </p>
            <NumberField label="Successes" value={config.crossCheck.successes} onChange={(successes) => set({ crossCheck: { ...config.crossCheck, successes } })} min={0} max={1000000} integer />
            <NumberField label="Failures" value={config.crossCheck.failures} onChange={(failures) => set({ crossCheck: { ...config.crossCheck, failures } })} min={0} max={1000000} integer />
            <NumberField label="Prior a" value={config.crossCheck.priorA} onChange={(priorA) => set({ crossCheck: { ...config.crossCheck, priorA } })} min={0.001} max={10000} step={0.5} />
            <NumberField label="Prior b" value={config.crossCheck.priorB} onChange={(priorB) => set({ crossCheck: { ...config.crossCheck, priorB } })} min={0.001} max={10000} step={0.5} />
            {check.status === 'running' ? (
              <RunningState
                completed={check.progress?.completedIterations ?? 0}
                total={check.progress?.totalIterations ?? 0}
                unitLabel="cross-check iterations"
                onCancel={check.cancel}
              />
            ) : (
              <Button icon="check" disabled={!checkRequest} onClick={() => checkRequest && check.start(checkRequest)}>
                Run the cross-check
              </Button>
            )}
            {check.issues.length > 0 && <Notice tone="error" items={check.issues.map((i) => i.message)} />}
            {!exactPosterior.ok && <Notice tone="error" items={exactPosterior.issues.map((i) => i.message)} />}
            {check.result && exactPosterior.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="MCMC estimate against the exact conjugate posterior"
                    columns={crossCheckColumns}
                    rows={crossCheckRows(check.result, exactPosterior.value, config.level)}
                  />
                </div>
                <p className="oc-chart-note">
                  The exact column is <strong>exact</strong> — Beta({formatValue(exactPosterior.value.params.alpha, 6)},{' '}
                  {formatValue(exactPosterior.value.params.beta, 6)}) in closed form. The MCMC column is <strong>empirical</strong>, and should agree to within a
                  couple of Monte Carlo standard errors. A larger gap than that means the sampler, not the arithmetic, is at fault.
                </p>
                <Notice tone={check.result.convergence.verdict === 'converged' ? 'info' : 'warning'} title={`${verdictIcon(check.result.convergence.verdict)} Cross-check chains: ${verdictLabel(check.result.convergence.verdict)}`}>
                  <p style={{ margin: 0 }}>{check.result.convergence.headline}</p>
                </Notice>
                <ExplanationPanel explanation={check.result.explanation} />
              </>
            )}
          </Card>

          <Disclosure title="What MCMC does, and what it cannot tell you" icon="book">
            <p style={{ fontSize: 12.5 }}>
              Conjugate updating gives an exact posterior for a handful of prior and likelihood pairs. MCMC drops that restriction: it needs only the
              unnormalised log posterior density, evaluated point by point. In exchange, every number it produces is an estimate from a finite, correlated sample
              — <strong>empirical</strong>, carrying Monte Carlo error — rather than a value read off a formula.
            </p>
            <p style={{ fontSize: 12.5 }}>
              The diagnostics are asymmetric. R-hat below {CONVERGENCE_THRESHOLDS.rHat} and an effective sample size above {CONVERGENCE_THRESHOLDS.ess} fail to
              detect a problem; they do not demonstrate that the chains have found the whole posterior. A sampler stuck in one mode of a multimodal posterior can
              look perfectly healthy on every plot here.
            </p>
            <p style={{ fontSize: 12.5, margin: 0 }}>
              Chains start from dispersed points for that reason: chains started at the same place, or at the posterior mode, can agree with each other while all
              of them are stuck, and the between-chain comparison is then blind.
            </p>
          </Disclosure>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- Table columns */

interface DiagnosticRow {
  d: McmcResult['diagnostics'][number];
}

/** Failures are flagged by icon and words, never by colour alone. */
function flag(pass: boolean, text: string) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <Icon name={pass ? 'check' : 'alert'} size={13} />
      <span>{text}</span>
    </span>
  );
}

const diagnosticColumns: ColumnDef<DiagnosticRow>[] = [
  { key: 'p', header: 'Parameter', render: (r) => r.d.parameter },
  {
    key: 'rhat',
    header: `R-hat (< ${CONVERGENCE_THRESHOLDS.rHat})`,
    numeric: true,
    title: 'The worst of the classic, split and rank-normalised R-hat.',
    render: (r) => flag(r.d.worstRHat < CONVERGENCE_THRESHOLDS.rHat, `${formatValue(r.d.worstRHat, 4)}${r.d.worstRHat < CONVERGENCE_THRESHOLDS.rHat ? '' : ' — too high'}`),
  },
  { key: 'split', header: 'Split R-hat', numeric: true, render: (r) => formatValue(r.d.splitRHat, 4) },
  { key: 'rank', header: 'Rank-normalised', numeric: true, render: (r) => formatValue(r.d.rankNormalisedRHat, 4) },
  {
    key: 'ess',
    header: `ESS (> ${CONVERGENCE_THRESHOLDS.ess})`,
    numeric: true,
    title: 'Effective sample size: the number of independent draws this correlated sample is worth.',
    render: (r) =>
      flag(
        r.d.effectiveSampleSize > CONVERGENCE_THRESHOLDS.ess,
        `${Number.isFinite(r.d.effectiveSampleSize) ? Math.round(r.d.effectiveSampleSize).toLocaleString('en-US') : 'not computable'}${r.d.effectiveSampleSize > CONVERGENCE_THRESHOLDS.ess ? '' : ' — too low'}`,
      ),
  },
  { key: 'tau', header: 'Autocorr. time', numeric: true, render: (r) => formatValue(r.d.integratedAutocorrelationTime, 4) },
  { key: 'mcse', header: 'MCSE of mean', numeric: true, render: (r) => formatValue(r.d.mcseMean, 4) },
];

interface SummaryRow {
  s: McmcResult['summaries'][number];
  mcse: number;
}

const summaryColumns: ColumnDef<SummaryRow>[] = [
  { key: 'p', header: 'Parameter', render: (r) => r.s.parameter },
  { key: 'mean', header: 'Mean', numeric: true, render: (r) => formatValue(r.s.mean, 5) },
  { key: 'mcse', header: '± MCSE', numeric: true, title: 'Monte Carlo standard error of the mean.', render: (r) => formatValue(r.mcse, 3) },
  { key: 'sd', header: 'SD', numeric: true, render: (r) => formatValue(r.s.sd, 5) },
  { key: 'median', header: 'Median', numeric: true, render: (r) => formatValue(r.s.median, 5) },
  {
    key: 'eti',
    header: 'Equal-tailed interval',
    numeric: true,
    title: 'Equal posterior probability excluded in each tail.',
    render: (r) => `${formatValue(r.s.equalTailedInterval.lower, 5)} to ${formatValue(r.s.equalTailedInterval.upper, 5)}`,
  },
  {
    key: 'hdi',
    header: 'Highest density interval',
    numeric: true,
    title: 'The shortest interval containing the stated probability. A different statement from the equal-tailed interval.',
    render: (r) => `${formatValue(r.s.highestDensityInterval.lower, 5)} to ${formatValue(r.s.highestDensityInterval.upper, 5)}`,
  },
];

interface CrossCheckRow {
  quantity: string;
  mcmc: string;
  exact: string;
  note: string;
}

const crossCheckColumns: ColumnDef<CrossCheckRow>[] = [
  { key: 'q', header: 'Quantity', render: (r) => r.quantity },
  { key: 'm', header: 'MCMC (empirical)', numeric: true, render: (r) => r.mcmc },
  { key: 'e', header: 'Conjugate (exact)', numeric: true, render: (r) => r.exact },
  { key: 'n', header: 'Difference', numeric: true, render: (r) => r.note },
];

function crossCheckRows(result: McmcResult, exact: ReturnType<typeof updateBayesian>, level: number): CrossCheckRow[] {
  const s = result.summaries[0];
  const mcse = result.diagnostics[0]?.mcseMean ?? NaN;
  const meanDiff = s.mean - exact.mean;
  return [
    {
      quantity: 'Posterior mean',
      mcmc: formatValue(s.mean, 6),
      exact: formatValue(exact.mean, 6),
      note: `${formatValue(meanDiff, 3)} (${Number.isFinite(mcse) && mcse > 0 ? `${formatValue(Math.abs(meanDiff) / mcse, 2)} MCSE` : 'MCSE not computable'})`,
    },
    { quantity: 'Posterior SD', mcmc: formatValue(s.sd, 6), exact: formatValue(exact.sd, 6), note: formatValue(s.sd - exact.sd, 3) },
    {
      quantity: `${formatValue(level * 100, 4)}% equal-tailed interval, lower`,
      mcmc: formatValue(s.equalTailedInterval.lower, 6),
      exact: formatValue(exact.credibleInterval.low, 6),
      note: formatValue(s.equalTailedInterval.lower - exact.credibleInterval.low, 3),
    },
    {
      quantity: `${formatValue(level * 100, 4)}% equal-tailed interval, upper`,
      mcmc: formatValue(s.equalTailedInterval.upper, 6),
      exact: formatValue(exact.credibleInterval.high, 6),
      note: formatValue(s.equalTailedInterval.upper - exact.credibleInterval.high, 3),
    },
    {
      quantity: `${formatValue(s.highestDensityInterval.level * 100, 4)}% highest density interval`,
      mcmc: `${formatValue(s.highestDensityInterval.lower, 6)} to ${formatValue(s.highestDensityInterval.upper, 6)}`,
      exact: 'not computed in closed form here',
      note: 'The HDI of a Beta posterior needs a numerical search; only the equal-tailed interval is compared exactly.',
    },
  ];
}

function verdictLabel(v: McmcResult['convergence']['verdict']): string {
  return v === 'converged' ? 'Diagnostics passed' : v === 'marginal' ? 'Marginal — do not rely on these numbers yet' : 'Not converged — these are not posterior estimates';
}

/** Text accompanies this in every use, so the icon is reinforcement, not the message. */
function verdictIcon(v: McmcResult['convergence']['verdict']): string {
  return v === 'converged' ? '✓' : v === 'marginal' ? '!' : '✕';
}
