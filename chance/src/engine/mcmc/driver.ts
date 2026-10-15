/**
 * Multi-chain MCMC driver.
 *
 * Exposed as a generator, exactly like `src/engine/simulation/runner.ts`:
 * JavaScript is single-threaded, so a Web Worker executing a long
 * synchronous loop can never receive the `cancel` message, and
 * `SharedArrayBuffer` is unavailable unless the page is cross-origin
 * isolated. The loop yields progress between chunks of iterations; that yield
 * is what makes cancellation possible. Do not collapse it into a plain loop.
 *
 * Chains start from dispersed points on purpose. R-hat compares between-chain
 * and within-chain variance, so chains started at the same place — or at the
 * posterior mode — can agree while all of them are stuck, and the diagnostic
 * is then blind.
 */
import { EngineError, type Explanation, type Issue } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { createSampler, type Sampler } from './samplers';
import { assessConvergence, parameterDiagnostics } from './diagnostics';
import { plotData, summariseParameter } from './summaries';
import {
  MCMC_LIMITS,
  type ChainOutput,
  type McmcHooks,
  type McmcRequest,
  type McmcResult,
  type McmcProgress,
  type ParameterDiagnostics,
  type ParameterSummary,
  type PlotData,
} from './types';

export function validateMcmcRequest(req: McmcRequest): Issue[] {
  const issues: Issue[] = [];
  const target = req.target;
  if (!target || typeof target.logDensity !== 'function') {
    issues.push({ code: 'required', field: 'target', message: 'A target with a logDensity function is required.' });
    return issues;
  }
  if (!Number.isInteger(target.dimension) || target.dimension < 1) {
    issues.push({ code: 'range', field: 'target.dimension', message: 'The target dimension must be a whole number of at least 1.' });
  }
  if (target.parameterNames.length !== target.dimension) {
    issues.push({
      code: 'shape',
      field: 'target.parameterNames',
      message: `The target has ${target.dimension} parameters but ${target.parameterNames.length} parameter names.`,
    });
  }
  if (!Number.isInteger(req.chains) || req.chains < 1) {
    issues.push({ code: 'range', field: 'chains', message: 'The number of chains must be a whole number of at least 1.' });
  } else if (req.chains > MCMC_LIMITS.maxChains) {
    issues.push({ code: 'limit', field: 'chains', message: `At most ${MCMC_LIMITS.maxChains} chains are supported.` });
  }
  if (!Number.isInteger(req.iterations) || req.iterations < 1) {
    issues.push({ code: 'range', field: 'iterations', message: 'The number of retained iterations per chain must be a whole number of at least 1.' });
  } else if (req.iterations > MCMC_LIMITS.maxIterations) {
    issues.push({ code: 'limit', field: 'iterations', message: `At most ${MCMC_LIMITS.maxIterations.toLocaleString('en-US')} iterations per chain are supported.` });
  }
  const warmup = req.warmup ?? 0;
  if (!Number.isInteger(warmup) || warmup < 0) {
    issues.push({ code: 'range', field: 'warmup', message: 'Warm-up must be a whole number of 0 or more.' });
  }
  const thin = req.thin ?? 1;
  if (!Number.isInteger(thin) || thin < 1) {
    issues.push({ code: 'range', field: 'thin', message: 'Thinning must be a whole number of at least 1.' });
  }
  if (typeof req.seed !== 'string' || !req.seed.length) {
    issues.push({ code: 'required', field: 'seed', message: 'A seed is required so the run can be reproduced.' });
  }
  if (req.initialPoints) {
    for (let c = 0; c < req.initialPoints.length; c++) {
      if (req.initialPoints[c].length !== target.dimension) {
        issues.push({
          code: 'shape',
          field: `initialPoints[${c}]`,
          message: `Starting point ${c} has ${req.initialPoints[c].length} coordinates but the target has ${target.dimension} parameters.`,
        });
      }
    }
  }
  if (!issues.length && req.chains * req.iterations * target.dimension > MCMC_LIMITS.maxStoredValues) {
    issues.push({
      code: 'limit',
      field: 'iterations',
      message: `${req.chains} chains x ${req.iterations} iterations x ${target.dimension} parameters exceeds the memory limit of ${MCMC_LIMITS.maxStoredValues.toLocaleString('en-US')} stored values. Reduce the iterations or thin the draws.`,
    });
  }
  if (req.sampler.kind === 'adaptive-metropolis' || req.sampler.kind === 'hmc') {
    if (warmup < 50) {
      issues.push({
        code: 'range',
        field: 'warmup',
        message: `${req.sampler.kind === 'hmc' ? 'Dual-averaging step-size adaptation' : 'Adaptive Metropolis'} needs a warm-up phase of at least 50 iterations, because adaptation is frozen when sampling begins.`,
      });
    }
  }
  return issues;
}

/**
 * Dispersed starting points. A deterministic sub-stream per chain keeps the
 * whole run reproducible from the single seed.
 */
export function dispersedStarts(req: McmcRequest): number[][] {
  const d = req.target.dimension;
  const starts: number[][] = [];
  const suggested = req.target.suggestedStarts;
  const spread = req.startDispersion ?? 2;
  for (let c = 0; c < req.chains; c++) {
    if (req.initialPoints && req.initialPoints[c]) {
      starts.push([...req.initialPoints[c]]);
      continue;
    }
    if (suggested && suggested.length) {
      starts.push([...suggested[c % suggested.length]]);
      continue;
    }
    const rng = new Random(new Xoshiro128(`${req.seed}:start:${c}`));
    const base = new Array<number>(d);
    // Chain 0 starts at the origin; later chains are spread further out so
    // between-chain variance has something to detect.
    for (let i = 0; i < d; i++) base[i] = c === 0 ? 0 : spread * rng.normal();
    starts.push(base);
  }
  return starts;
}

function describeStart(x: readonly number[]): string {
  return `[${x.map((v) => (Number.isFinite(v) ? v.toPrecision(6) : String(v))).join(', ')}]`;
}

/** Fails loudly when a chain cannot start, instead of returning a number. */
function checkStart(sampler: Sampler, chain: number, start: readonly number[]): void {
  const lp = sampler.logDensityValue;
  if (!Number.isFinite(lp)) {
    throw new EngineError(
      [
        {
          code: 'outside-support',
          field: `initialPoints[${chain}]`,
          message: `Chain ${chain + 1} cannot start at ${describeStart(start)}: the target log-density there is ${String(lp)}, so the starting point is outside the support of the posterior. Supply a starting point where the log-density is finite.`,
        },
      ],
      'outside-support',
    );
  }
}

export function runMcmc(req: McmcRequest, hooks: McmcHooks = {}): McmcResult {
  const steps = mcmcSteps(req, hooks);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/**
 * Chunked multi-chain run. Yields an `McmcProgress` after every chunk of
 * iterations and returns the completed (or, on cancellation, explicitly
 * partial) result.
 */
export function* mcmcSteps(req: McmcRequest, hooks: McmcHooks = {}): Generator<McmcProgress, McmcResult, void> {
  const issues = validateMcmcRequest(req);
  if (issues.length) throw new EngineError(issues);

  const target = req.target;
  const d = target.dimension;
  const warmup = req.warmup ?? 0;
  const thin = req.thin ?? 1;
  const chunk = req.chunkSize ?? MCMC_LIMITS.defaultChunkSize;
  if (!Number.isInteger(chunk) || chunk < 1) {
    throw new EngineError('chunkSize must be a whole number of at least 1.', 'range');
  }
  const perChainRaw = warmup + req.iterations * thin;
  const totalIterations = perChainRaw * req.chains;
  const starts = dispersedStarts(req);
  const started = Date.now();

  const chainOutputs: ChainOutput[] = [];
  const limitations = new Set<string>();
  let samplerLabel = '';
  let cancelled = false;
  let completedIterations = 0;

  for (let c = 0; c < req.chains && !cancelled; c++) {
    const rng = new Random(new Xoshiro128(`${req.seed}:chain:${c}`));
    const sampler = createSampler(target, req.sampler, starts[c]);
    checkStart(sampler, c, starts[c]);
    samplerLabel = sampler.label;
    for (const l of sampler.limitations) limitations.add(l);

    const draws: Float64Array[] = Array.from({ length: d }, () => new Float64Array(req.iterations));
    const logDensity = new Float64Array(req.iterations);
    let kept = 0;
    let warmupProposals = 0;
    let warmupAccepted = 0;
    let warmupDivergences = 0;
    let iteration = 0;

    while (iteration < perChainRaw) {
      const stop = Math.min(perChainRaw, iteration + chunk);
      for (; iteration < stop; iteration++) {
        const adapting = iteration < warmup;
        const beforeProposals = sampler.stats.proposals;
        const beforeAccepted = sampler.stats.accepted;
        const beforeDivergences = sampler.stats.divergences;
        sampler.step(rng, adapting);
        if (adapting) {
          warmupProposals += sampler.stats.proposals - beforeProposals;
          warmupAccepted += sampler.stats.accepted - beforeAccepted;
          warmupDivergences += sampler.stats.divergences - beforeDivergences;
          if (iteration === warmup - 1) sampler.freeze();
          continue;
        }
        const sinceWarmup = iteration - warmup;
        if (sinceWarmup % thin === 0 && kept < req.iterations) {
          for (let i = 0; i < d; i++) draws[i][kept] = sampler.position[i];
          logDensity[kept] = sampler.logDensityValue;
          kept++;
        }
      }
      // Recomputed rather than accumulated, so progress cannot drift.
      completedIterations = c * perChainRaw + iteration;
      const progress: McmcProgress = {
        phase: iteration < warmup ? 'warmup' : 'sampling',
        chain: c,
        chains: req.chains,
        chainIteration: iteration,
        chainTotal: perChainRaw,
        completedIterations,
        totalIterations,
      };
      hooks.onProgress?.(progress);
      yield progress;
      if (hooks.isCancelled?.()) {
        cancelled = true;
        break;
      }
    }
    if (warmup > 0 && iteration >= warmup) sampler.freeze();

    const total = sampler.stats.proposals;
    const sampleProposals = total - warmupProposals;
    chainOutputs.push({
      chain: c,
      start: starts[c],
      draws: draws.map((a) => (kept === req.iterations ? a : a.slice(0, kept))),
      logDensity: kept === req.iterations ? logDensity : logDensity.slice(0, kept),
      acceptanceRate: sampleProposals > 0 ? (sampler.stats.accepted - warmupAccepted) / sampleProposals : NaN,
      warmupAcceptanceRate: warmupProposals > 0 ? warmupAccepted / warmupProposals : NaN,
      divergences: sampler.stats.divergences - warmupDivergences,
      warmupDivergences,
      tuning: sampler.tuning(),
      stats: { ...sampler.stats },
    });
  }

  const elapsedMs = Date.now() - started;
  const elapsedSeconds = elapsedMs / 1000;
  const usable = chainOutputs.filter((c) => c.draws[0] && c.draws[0].length >= 4);
  const warnings: string[] = [];
  if (cancelled) {
    warnings.push(
      `The run was cancelled after ${completedIterations.toLocaleString('en-US')} of ${totalIterations.toLocaleString('en-US')} iterations. These results are PARTIAL: ${usable.length} of ${req.chains} chains have usable draws, and the diagnostics below describe only what was completed.`,
    );
  }

  const diagnostics: ParameterDiagnostics[] = [];
  const summaries: ParameterSummary[] = [];
  const plots: PlotData[] = [];
  if (!usable.length) {
    throw new EngineError(
      [
        {
          code: 'insufficient',
          message: `No chain produced at least 4 retained draws${cancelled ? ' before the run was cancelled' : ''}, so no posterior summary can be computed. Nothing is reported rather than a summary of a handful of draws.`,
        },
      ],
      'insufficient',
    );
  }
  for (let i = 0; i < d; i++) {
    const name = target.parameterNames[i] ?? `theta[${i}]`;
    const perChain = usable.map((c) => c.draws[i]);
    const pooled = concat(perChain);
    const summary = summariseParameter(name, pooled);
    const diag = parameterDiagnostics({ parameter: name, chains: perChain, sd: summary.sd, elapsedSeconds });
    summaries.push(summary);
    diagnostics.push(diag);
    plots.push(plotData(name, perChain, diag.autocorrelation));
  }

  // Only sampling-phase divergences drive the verdict: during warm-up the
  // step size is still being tuned, so divergences there are expected.
  const divergences = chainOutputs.reduce((s, c) => s + c.divergences, 0);
  const warmupDivergences = chainOutputs.reduce((s, c) => s + c.warmupDivergences, 0);
  if (warmupDivergences > 0) {
    warnings.push(
      `${warmupDivergences} divergent transition${warmupDivergences === 1 ? '' : 's'} occurred during warm-up, while the step size was still being tuned. Those iterations are discarded and do not affect the draws.`,
    );
  }
  const convergence = assessConvergence(diagnostics, divergences, usable.length);
  if (convergence.verdict !== 'converged') warnings.unshift(convergence.headline);

  let acceptedTotal = 0;
  let proposalTotal = 0;
  for (const c of chainOutputs) {
    acceptedTotal += c.stats.accepted;
    proposalTotal += c.stats.proposals;
  }

  const explanation: Explanation = {
    method: `${samplerLabel}: ${usable.length} chain(s) x ${req.iterations} retained draws, ${warmup} warm-up iterations discarded${thin > 1 ? `, thinned by ${thin}` : ''}.`,
    formula: 'posterior(theta) proportional to likelihood(data | theta) x prior(theta)',
    steps: [
      { label: 'Chains', value: String(req.chains) },
      { label: 'Warm-up discarded per chain', value: String(warmup) },
      { label: 'Retained draws per chain', value: String(req.iterations) },
      { label: 'Pooled draws', value: String(usable.length * req.iterations) },
      { label: 'Acceptance rate (sampling phase)', value: proposalTotal ? (acceptedTotal / proposalTotal).toFixed(3) : 'n/a' },
      { label: 'Worst R-hat', value: Number.isFinite(convergence.worstRHat) ? convergence.worstRHat.toFixed(4) : 'not computable' },
      {
        label: 'Lowest effective sample size',
        value: Number.isFinite(convergence.lowestEffectiveSampleSize) ? String(Math.round(convergence.lowestEffectiveSampleSize)) : 'not computable',
      },
      { label: 'Verdict', value: convergence.verdict },
    ],
    assumptions: [
      'The supplied log-density is the correct unnormalised log posterior; the engine cannot verify the model, only sample from what it is given.',
      'Chains were started from dispersed points so that between-chain variance is informative.',
    ],
    limitations: [
      'Every value here is a sampling estimate carrying Monte Carlo error: the Monte Carlo standard error of each posterior mean is reported alongside it. Re-running with a different seed gives slightly different numbers.',
      'Convergence diagnostics can only detect failure to mix; passing them is not proof that the chains have explored the whole posterior. A posterior with well-separated modes can pass every check while missing a mode entirely.',
      'Credible intervals (equal-tailed and HDI) are statements about the posterior; the Monte Carlo standard error is the uncertainty of our estimate of them. They are not interchangeable.',
      ...limitations,
      ...(cancelled ? ['The run was cancelled: these are partial results from an incomplete run.'] : []),
    ],
    exactness: 'empirical',
  };

  return {
    target: target.name,
    samplerLabel,
    parameterNames: target.parameterNames.map((n, i) => n ?? `theta[${i}]`),
    chains: chainOutputs,
    diagnostics,
    summaries,
    convergence,
    plots,
    drawsPerChain: usable[0].draws[0].length,
    totalDraws: usable.reduce((s, c) => s + c.draws[0].length, 0),
    warmup,
    thin,
    elapsedMs,
    acceptanceRate: proposalTotal ? acceptedTotal / proposalTotal : NaN,
    divergences,
    partial: cancelled,
    warnings,
    explanation,
  };
}

function concat(arrays: readonly Float64Array[]): Float64Array {
  let n = 0;
  for (const a of arrays) n += a.length;
  const out = new Float64Array(n);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** All posterior draws as plain parameter vectors, for predictive sampling. */
export function drawsAsVectors(result: McmcResult): number[][] {
  const out: number[][] = [];
  for (const chain of result.chains) {
    const n = chain.draws[0]?.length ?? 0;
    for (let i = 0; i < n; i++) out.push(chain.draws.map((p) => p[i]));
  }
  return out;
}
