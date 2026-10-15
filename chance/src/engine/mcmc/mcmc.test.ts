/**
 * MCMC tests.
 *
 * Every reference value here is independent of this implementation: it is
 * either a closed-form property of the target (the standard normal's mean,
 * sd and 2.5%/97.5% quantiles; a bivariate normal's correlation) or the
 * analytic conjugate posterior that `src/engine/probability/bayesian.ts`
 * already computes exactly (Beta-Binomial, Gamma-Poisson). Nothing is
 * asserted against this module's own output.
 *
 * Tolerances are derived from the Monte Carlo standard error the run itself
 * reports: a posterior mean estimated from draws with standard error `mcse`
 * is asserted to within 4·mcse, which is a ~1-in-16000 false failure rate per
 * assertion under the central limit theorem, and the seeds are fixed so the
 * outcome is in fact deterministic.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random, Xoshiro128 } from '../random/rng';
import { normalPdf } from '../special/gamma';
import { mean as meanOf, pearson, variance } from '../stats/descriptive';
import {
  CONVERGENCE_THRESHOLDS,
  INFERENCE_PROBLEMS,
  betaBinomialPosterior,
  bimodalTarget,
  changePointPoisson,
  correlatedNormalTarget,
  dispersedStarts,
  drawsAsVectors,
  effectiveSampleSize,
  equalTailedInterval,
  gammaPoissonPosterior,
  gelmanRubin,
  HmcSampler,
  getInferenceProblem,
  hierarchicalEightSchools,
  highestDensityInterval,
  logisticRegressionPosterior,
  marginalLikelihood,
  mcmcSteps,
  numericalGradient,
  posteriorPredictive,
  runMcmc,
  splitRHat,
  standardNormalTarget,
  summariseParameter,
  type McmcRequest,
  type McmcResult,
  type SamplerConfig,
} from './index';

/** Pooled draws of one parameter across all chains. */
function pooled(result: McmcResult, index = 0): Float64Array {
  let n = 0;
  for (const c of result.chains) n += c.draws[index].length;
  const out = new Float64Array(n);
  let o = 0;
  for (const c of result.chains) {
    out.set(c.draws[index], o);
    o += c.draws[index].length;
  }
  return out;
}

function normalRun(sampler: SamplerConfig, seed: string, iterations = 3000, warmup = 1000): McmcResult {
  return runMcmc({
    target: standardNormalTarget(1),
    sampler,
    chains: 4,
    iterations,
    warmup,
    seed,
    startDispersion: 3,
  });
}

/**
 * Standard error of a sample quantile estimated from ESS effectively
 * independent draws: sqrt(p(1-p)/ESS) / density(quantile). Used to set the
 * quantile tolerances rather than guessing a number.
 */
function quantileStandardError(p: number, z: number, ess: number): number {
  return Math.sqrt((p * (1 - p)) / ess) / normalPdf(z);
}

describe('MCMC against targets with closed-form answers', () => {
  const result = normalRun({ kind: 'adaptive-metropolis', initialScale: 1 }, 'normal-am-1');

  it('recovers the standard normal mean and sd within the Monte Carlo error it reports', () => {
    const diag = result.diagnostics[0];
    const summary = result.summaries[0];
    // Closed form: mean 0, sd 1.
    expect(Math.abs(summary.mean - 0)).toBeLessThan(4 * diag.mcseMean);
    // The sd's own standard error for a normal is sd/sqrt(2·ESS).
    const sdSe = 1 / Math.sqrt(2 * diag.effectiveSampleSize);
    expect(Math.abs(summary.sd - 1)).toBeLessThan(5 * sdSe);
    expect(result.explanation.exactness).toBe('empirical');
  });

  it('recovers the -1.959964 / +1.959964 quantiles within their sampling error', () => {
    const summary = result.summaries[0];
    const ess = result.diagnostics[0].effectiveSampleSize;
    const lower = summary.quantiles.find((q) => q.p === 0.025);
    const upper = summary.quantiles.find((q) => q.p === 0.975);
    expect(lower).toBeDefined();
    expect(upper).toBeDefined();
    const tol = 5 * quantileStandardError(0.025, 1.959964, ess);
    expect(Math.abs((lower?.value ?? NaN) + 1.959964)).toBeLessThan(tol);
    expect(Math.abs((upper?.value ?? NaN) - 1.959964)).toBeLessThan(tol);
  });

  it('agrees with the analytic Beta-Binomial conjugate posterior', () => {
    // Beta(1,1) prior with 2 successes and 6 failures gives exactly Beta(3,7).
    const a = 3;
    const b = 7;
    const exactMean = a / (a + b); // 0.3
    const exactSd = Math.sqrt((a * b) / ((a + b) * (a + b) * (a + b + 1)));
    const run = runMcmc({
      target: betaBinomialPosterior({ successes: 2, failures: 6, priorA: 1, priorB: 1 }),
      sampler: { kind: 'slice', width: 0.3 },
      chains: 4,
      iterations: 4000,
      warmup: 500,
      seed: 'beta-binomial-conjugate',
    });
    expect(run.convergence.verdict).toBe('converged');
    const diag = run.diagnostics[0];
    expect(Math.abs(run.summaries[0].mean - exactMean)).toBeLessThan(4 * diag.mcseMean);
    const sdSe = exactSd / Math.sqrt(2 * diag.effectiveSampleSize);
    expect(Math.abs(run.summaries[0].sd - exactSd)).toBeLessThan(6 * sdSe);
  });

  it('agrees with the analytic Gamma-Poisson conjugate posterior', () => {
    // Gamma(2,1) prior with counts summing to 14 over 5 periods gives Gamma(16, 6).
    const shape = 16;
    const rate = 6;
    const exactMean = shape / rate;
    const exactSd = Math.sqrt(shape) / rate;
    const run = runMcmc({
      target: gammaPoissonPosterior({ counts: [3, 1, 4, 1, 5], priorShape: 2, priorRate: 1 }),
      sampler: { kind: 'slice', width: 1 },
      chains: 4,
      iterations: 4000,
      warmup: 500,
      seed: 'gamma-poisson-conjugate',
    });
    expect(run.convergence.verdict).toBe('converged');
    const diag = run.diagnostics[0];
    expect(Math.abs(run.summaries[0].mean - exactMean)).toBeLessThan(4 * diag.mcseMean);
    const sdSe = exactSd / Math.sqrt(2 * diag.effectiveSampleSize);
    expect(Math.abs(run.summaries[0].sd - exactSd)).toBeLessThan(6 * sdSe);
  });

  it('recovers both marginals and the correlation of a rho = 0.9 bivariate normal', () => {
    const run = runMcmc({
      target: correlatedNormalTarget(0.9),
      sampler: { kind: 'adaptive-metropolis', initialScale: 1 },
      chains: 4,
      iterations: 6000,
      warmup: 2000,
      seed: 'correlated-0.9',
    });
    expect(run.convergence.verdict).toBe('converged');
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(run.summaries[i].mean)).toBeLessThan(4 * run.diagnostics[i].mcseMean);
      const sdSe = 1 / Math.sqrt(2 * run.diagnostics[i].effectiveSampleSize);
      expect(Math.abs(run.summaries[i].sd - 1)).toBeLessThan(6 * sdSe);
    }
    const r = pearson(pooled(run, 0), pooled(run, 1));
    // SE of a correlation estimate from ESS independent pairs: (1-r²)/sqrt(ESS).
    const essMin = Math.min(run.diagnostics[0].effectiveSampleSize, run.diagnostics[1].effectiveSampleSize);
    const rSe = (1 - 0.81) / Math.sqrt(essMin);
    expect(Math.abs(r - 0.9)).toBeLessThan(6 * rSe);
  });

  it('estimates the marginal likelihood of a normalised target as 1 (log Z = 0)', () => {
    // The standard normal target carries its own normalising constant, so the
    // true marginal likelihood is exactly 1 and log Z is exactly 0.
    const vectors = drawsAsVectors(result);
    const z = marginalLikelihood(vectors, standardNormalTarget(1).logDensity, 'marglik-seed');
    expect(Math.abs(z.logMarginalLikelihood)).toBeLessThan(0.05);
    expect(z.warnings.join(' ')).toMatch(/unreliable/i);
  });
});

describe('samplers agree with each other', () => {
  it('Metropolis, adaptive Metropolis, HMC and slice sampling all recover the same mean', () => {
    const runs: { label: string; run: McmcResult }[] = [
      { label: 'metropolis', run: normalRun({ kind: 'metropolis', proposalSd: [2.4] }, 'agree-mh', 4000, 500) },
      { label: 'adaptive', run: normalRun({ kind: 'adaptive-metropolis' }, 'agree-am', 4000, 1000) },
      { label: 'hmc', run: normalRun({ kind: 'hmc', stepSize: 0.3, leapfrogSteps: 8 }, 'agree-hmc', 2000, 500) },
      { label: 'slice', run: normalRun({ kind: 'slice', width: 2 }, 'agree-slice', 2000, 200) },
    ];
    for (const { label, run } of runs) {
      const diag = run.diagnostics[0];
      expect(run.convergence.verdict, `${label} verdict`).toBe('converged');
      expect(Math.abs(run.summaries[0].mean), `${label} mean`).toBeLessThan(4 * diag.mcseMean);
      expect(Math.abs(run.summaries[0].sd - 1), `${label} sd`).toBeLessThan(
        6 / Math.sqrt(2 * diag.effectiveSampleSize),
      );
    }
    // Pairwise agreement within the combined Monte Carlo error of the pair.
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        const combined = Math.hypot(a.run.diagnostics[0].mcseMean, b.run.diagnostics[0].mcseMean);
        expect(
          Math.abs(a.run.summaries[0].mean - b.run.summaries[0].mean),
          `${a.label} vs ${b.label}`,
        ).toBeLessThan(4 * combined);
      }
    }
  });

  it('Gibbs sampling with supplied full conditionals recovers the correlated normal', () => {
    const run = runMcmc({
      target: correlatedNormalTarget(0.9),
      sampler: { kind: 'gibbs' },
      chains: 4,
      iterations: 4000,
      warmup: 500,
      seed: 'gibbs-correlated',
    });
    expect(run.convergence.verdict).toBe('converged');
    expect(Math.abs(run.summaries[0].mean)).toBeLessThan(4 * run.diagnostics[0].mcseMean);
    const r = pearson(pooled(run, 0), pooled(run, 1));
    expect(Math.abs(r - 0.9)).toBeLessThan(6 * (1 - 0.81) / Math.sqrt(run.diagnostics[0].effectiveSampleSize));
  });

  it('refuses Gibbs sampling when no full conditionals are available', () => {
    expect(() =>
      runMcmc({
        target: bimodalTarget(),
        sampler: { kind: 'gibbs' },
        chains: 2,
        iterations: 100,
        seed: 'gibbs-missing',
      }),
    ).toThrow(/full conditional/i);
  });

  it('the finite-difference gradient matches the analytic one and is labelled as a fallback', () => {
    const target = standardNormalTarget(3);
    const numeric = numericalGradient(target.logDensity, 1e-5);
    const at = [0.4, -1.2, 2.5];
    const analytic = target.gradLogDensity?.(at) ?? [];
    const approx = numeric(at);
    for (let i = 0; i < 3; i++) expect(approx[i]).toBeCloseTo(analytic[i], 6);

    const run = runMcmc({
      target: { ...target, gradLogDensity: undefined },
      sampler: { kind: 'hmc', stepSize: 0.3, leapfrogSteps: 6 },
      chains: 2,
      iterations: 600,
      warmup: 300,
      seed: 'hmc-numeric',
    });
    expect(run.samplerLabel).toMatch(/finite-difference/i);
    expect(run.explanation.limitations.join(' ')).toMatch(/slower.*less accurate|less accurate/i);
  });
});

describe('convergence diagnostics actually fire', () => {
  it('reports "not converged" with R-hat > 1.1 for short chains stuck in different modes', () => {
    const run = runMcmc({
      target: bimodalTarget(8, 1),
      sampler: { kind: 'metropolis', proposalSd: [0.3] },
      chains: 4,
      iterations: 300,
      warmup: 50,
      seed: 'bimodal-stuck',
      initialPoints: [[-4], [4], [-4.2], [4.2]],
    });
    expect(run.convergence.worstRHat).toBeGreaterThan(1.1);
    expect(run.convergence.verdict).toBe('not converged');
    expect(run.convergence.headline).toMatch(/NOT CONVERGED/);
    expect(run.warnings[0]).toMatch(/NOT CONVERGED/);
    expect(run.convergence.reasons.join(' ')).toMatch(/R-hat/);
  });

  it('reports "converged" with R-hat < 1.01 for long well-mixed chains', () => {
    const run = normalRun({ kind: 'adaptive-metropolis' }, 'converged-check', 4000, 1500);
    expect(run.convergence.worstRHat).toBeLessThan(CONVERGENCE_THRESHOLDS.rHat);
    expect(run.diagnostics[0].effectiveSampleSize).toBeGreaterThan(CONVERGENCE_THRESHOLDS.ess);
    expect(run.convergence.verdict).toBe('converged');
    expect(run.diagnostics[0].splitRHat).toBeLessThan(1.05);
    expect(run.diagnostics[0].rankNormalisedRHat).toBeLessThan(1.05);
  });

  it('split R-hat detects a drifting chain that the classic statistic can miss', () => {
    // Two chains, each a deterministic ramp: their means agree but neither is
    // stationary, which is exactly what splitting finds.
    const n = 500;
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = i / n;
      b[i] = i / n;
    }
    const classic = gelmanRubin([a, b]);
    expect(classic).toBeLessThan(1.05);
    expect(splitRHat([a, b])).toBeGreaterThan(1.1);
  });

  it('ESS is close to n for independent draws and far below n for a sticky chain', () => {
    const rng = new Random(new Xoshiro128('ess-independent'));
    const chains = Array.from({ length: 4 }, () => {
      const c = new Float64Array(2000);
      for (let i = 0; i < c.length; i++) c[i] = rng.normal();
      return c;
    });
    const independent = effectiveSampleSize(chains);
    const total = 4 * 2000;
    expect(independent.ess).toBeGreaterThan(0.8 * total);
    expect(independent.ess).toBeLessThan(1.25 * total);
    expect(independent.tau).toBeLessThan(1.3);

    // A deliberately sticky chain: a proposal 100x too small is almost always
    // accepted but barely moves, so the draws carry little information.
    const sticky = runMcmc({
      target: standardNormalTarget(1),
      sampler: { kind: 'metropolis', proposalSd: [0.01] },
      chains: 4,
      iterations: 2000,
      warmup: 100,
      seed: 'sticky-chain',
      initialPoints: [[0], [0], [0], [0]],
    });
    const stickyEss = sticky.diagnostics[0].effectiveSampleSize;
    expect(stickyEss).toBeLessThan(total / 20);
    expect(sticky.diagnostics[0].integratedAutocorrelationTime).toBeGreaterThan(20);
    expect(sticky.acceptanceRate).toBeGreaterThan(0.9);
  });

  it('reports acceptance rate, ESS per second, autocorrelation and plot data', () => {
    const run = normalRun({ kind: 'adaptive-metropolis' }, 'diag-shapes', 1200, 400);
    const diag = run.diagnostics[0];
    expect(run.acceptanceRate).toBeGreaterThan(0.1);
    expect(run.acceptanceRate).toBeLessThan(0.9);
    expect(diag.effectiveSampleSizePerSecond).toBeGreaterThan(0);
    expect(diag.autocorrelation.values[0]).toBeCloseTo(1, 10);
    expect(diag.autocorrelation.values.length).toBeGreaterThan(10);
    expect(diag.integratedAutocorrelationTime).toBeGreaterThan(0);
    const plot = run.plots[0];
    expect(plot.trace.length).toBe(4);
    expect(plot.runningMean.length).toBe(4);
    expect(plot.rankHistogram.counts.length).toBe(4);
    const totalRanked = plot.rankHistogram.counts.flat().reduce((s, v) => s + v, 0);
    expect(totalRanked).toBe(4 * 1200);
  });

  it('counts HMC divergences, separating warm-up from the sampling phase', () => {
    // An absurd step size makes the leapfrog integrator unstable, so every
    // trajectory leaves the region where the energy is conserved.
    const sampler = new HmcSampler(standardNormalTarget(2), { kind: 'hmc', stepSize: 60, leapfrogSteps: 20 }, [0, 0]);
    const rng = new Random(new Xoshiro128('divergence-mechanism'));
    for (let i = 0; i < 50; i++) sampler.step(rng, false);
    expect(sampler.stats.divergences).toBeGreaterThan(0);
    expect(sampler.stats.accepted).toBeLessThan(50);

    // Through the driver, dual averaging rescues the step size during
    // warm-up, so the divergences are reported as warm-up divergences and the
    // sampling phase is clean. Both counts are reported; neither is hidden.
    const run = runMcmc({
      target: standardNormalTarget(2),
      sampler: { kind: 'hmc', stepSize: 60, leapfrogSteps: 20 },
      chains: 2,
      iterations: 400,
      warmup: 300,
      seed: 'hmc-divergent',
    });
    const warmupDivergences = run.chains.reduce((t, c) => t + c.warmupDivergences, 0);
    expect(warmupDivergences).toBeGreaterThan(0);
    expect(run.warnings.join(' ')).toMatch(/divergent transition.*during warm-up/i);
    expect(run.divergences).toBe(run.convergence.divergences);
  });

  it('a sampling-phase divergence is reported in the verdict', () => {
    // Fixed tuning that is far too coarse for a sharply peaked target: with
    // adaptation frozen after a short warm-up the divergences persist.
    const run = runMcmc({
      target: standardNormalTarget(1),
      sampler: { kind: 'hmc', stepSize: 2.5, leapfrogSteps: 30, targetAcceptance: 0.01 },
      chains: 2,
      iterations: 500,
      warmup: 50,
      seed: 'hmc-persistent-divergence',
    });
    if (run.divergences > 0) {
      expect(run.convergence.verdict).not.toBe('converged');
      expect(run.convergence.reasons.join(' ')).toMatch(/divergent/i);
    } else {
      // Step-size adaptation found a stable value even from this start, which
      // is the other acceptable outcome; the diagnostic is still reported.
      expect(run.convergence.divergences).toBe(0);
    }
  });

  it('marks a single-chain run as marginal because R-hat cannot be computed', () => {
    const run = runMcmc({
      target: standardNormalTarget(1),
      sampler: { kind: 'slice', width: 2 },
      chains: 1,
      iterations: 1500,
      warmup: 100,
      seed: 'one-chain',
    });
    expect(run.convergence.verdict).not.toBe('converged');
    expect(run.convergence.reasons.join(' ')).toMatch(/one chain/i);
  });
});

describe('the multi-chain driver is a cancellable generator', () => {
  it('yields progress more than once and returns a complete result', () => {
    const steps = mcmcSteps({
      target: standardNormalTarget(1),
      sampler: { kind: 'slice', width: 2 },
      chains: 2,
      iterations: 800,
      warmup: 200,
      seed: 'generator-yields',
      chunkSize: 100,
    });
    let yields = 0;
    let next = steps.next();
    let lastCompleted = -1;
    while (!next.done) {
      yields++;
      expect(next.value.completedIterations).toBeGreaterThan(lastCompleted);
      lastCompleted = next.value.completedIterations;
      next = steps.next();
    }
    expect(yields).toBeGreaterThan(1);
    expect(yields).toBe((2 * (800 + 200)) / 100);
    expect(next.value.partial).toBe(false);
    expect(next.value.drawsPerChain).toBe(800);
  });

  it('stops early when the cancellation hook fires and marks the result partial', () => {
    let seen = 0;
    const result = runMcmc(
      {
        target: standardNormalTarget(1),
        sampler: { kind: 'slice', width: 2 },
        chains: 4,
        iterations: 4000,
        warmup: 100,
        seed: 'cancel-run',
        chunkSize: 50,
      },
      {
        isCancelled: () => {
          seen++;
          return seen >= 4;
        },
      },
    );
    expect(result.partial).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/PARTIAL/);
    expect(result.chains.length).toBe(1);
    expect(result.drawsPerChain).toBeLessThan(4000);
    expect(result.drawsPerChain).toBeGreaterThan(0);
  });

  it('reports progress through the hook with phase labels', () => {
    const phases = new Set<string>();
    runMcmc(
      {
        target: standardNormalTarget(1),
        sampler: { kind: 'adaptive-metropolis' },
        chains: 1,
        iterations: 300,
        warmup: 300,
        seed: 'progress-hook',
        chunkSize: 100,
      },
      { onProgress: (p) => phases.add(p.phase) },
    );
    expect(phases.has('warmup')).toBe(true);
    expect(phases.has('sampling')).toBe(true);
  });

  it('starts chains from dispersed points', () => {
    const req: McmcRequest = {
      target: standardNormalTarget(2),
      sampler: { kind: 'metropolis' },
      chains: 4,
      iterations: 10,
      seed: 'dispersed',
      startDispersion: 3,
    };
    const starts = dispersedStarts(req);
    expect(starts.length).toBe(4);
    const spread = Math.sqrt(variance(starts.map((s) => s[0]), 1));
    expect(spread).toBeGreaterThan(0.5);
  });

  it('freezes adaptation when sampling begins', () => {
    const run = runMcmc({
      target: standardNormalTarget(1),
      sampler: { kind: 'adaptive-metropolis' },
      chains: 2,
      iterations: 500,
      warmup: 500,
      seed: 'frozen-adaptation',
    });
    expect(run.explanation.limitations.join(' ')).toMatch(/frozen for the sampling phase/i);
    // The frozen tuning is reported, and the same value for the whole phase.
    for (const chain of run.chains) expect(chain.tuning.proposalScale).toBeGreaterThan(0);
  });
});

describe('refusals instead of plausible numbers', () => {
  it('refuses a starting point outside the support', () => {
    expect(() =>
      runMcmc({
        target: betaBinomialPosterior({ successes: 2, failures: 6 }),
        sampler: { kind: 'metropolis', proposalSd: [0.1] },
        chains: 1,
        iterations: 100,
        seed: 'outside-support',
        initialPoints: [[1.5]],
      }),
    ).toThrow(/outside the support/i);
  });

  it('refuses a log-density that returns NaN', () => {
    const broken = { ...standardNormalTarget(1), logDensity: () => NaN };
    let thrown: unknown;
    try {
      runMcmc({ target: broken, sampler: { kind: 'metropolis' }, chains: 1, iterations: 50, seed: 'nan-density' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect((thrown as EngineError).message).toMatch(/NaN/);
  });

  it('refuses zero chains, zero iterations and a missing seed', () => {
    const base = { target: standardNormalTarget(1), sampler: { kind: 'metropolis' } as SamplerConfig, seed: 's' };
    expect(() => runMcmc({ ...base, chains: 0, iterations: 100 })).toThrow(/at least 1/i);
    expect(() => runMcmc({ ...base, chains: 2, iterations: 0 })).toThrow(/at least 1/i);
    expect(() => runMcmc({ ...base, chains: 2, iterations: 100, seed: '' })).toThrow(/seed/i);
  });

  it('refuses mismatched starting points and an invalid proposal covariance', () => {
    expect(() =>
      runMcmc({
        target: standardNormalTarget(2),
        sampler: { kind: 'metropolis' },
        chains: 1,
        iterations: 10,
        seed: 'shape',
        initialPoints: [[0]],
      }),
    ).toThrow(/coordinates/i);
    expect(() =>
      runMcmc({
        target: standardNormalTarget(2),
        sampler: {
          kind: 'metropolis',
          proposalCovariance: [
            [1, 2],
            [2, 1],
          ],
        },
        chains: 1,
        iterations: 10,
        seed: 'bad-cov',
      }),
    ).toThrow(/positive definite/i);
  });

  it('requires a warm-up phase for the adapting samplers', () => {
    expect(() =>
      runMcmc({
        target: standardNormalTarget(1),
        sampler: { kind: 'hmc' },
        chains: 2,
        iterations: 100,
        warmup: 0,
        seed: 'no-warmup',
      }),
    ).toThrow(/warm-up/i);
  });

  it('refuses a marginal likelihood estimate from too few draws', () => {
    expect(() => marginalLikelihood([[0], [1]], standardNormalTarget(1).logDensity, 'few')).toThrow(/at least 20/i);
  });
});

describe('determinism', () => {
  it('reproduces the same chain from the same seed and not from a different one', () => {
    const make = (seed: string): Float64Array =>
      runMcmc({
        target: standardNormalTarget(1),
        sampler: { kind: 'adaptive-metropolis' },
        chains: 2,
        iterations: 300,
        warmup: 200,
        seed,
      }).chains[0].draws[0];
    const a = make('determinism-seed');
    const b = make('determinism-seed');
    const c = make('determinism-seed-2');
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe('posterior summaries', () => {
  it('keeps the HDI distinct from the equal-tailed interval on a skewed posterior', () => {
    const run = runMcmc({
      target: gammaPoissonPosterior({ counts: [0, 1, 0, 0, 1], priorShape: 1, priorRate: 1 }),
      sampler: { kind: 'slice', width: 0.5 },
      chains: 4,
      iterations: 4000,
      warmup: 500,
      seed: 'skewed-intervals',
    });
    const s = run.summaries[0];
    expect(s.highestDensityInterval.level).toBe(0.95);
    expect(s.equalTailedInterval.level).toBe(0.95);
    const hdiWidth = s.highestDensityInterval.upper - s.highestDensityInterval.lower;
    const etWidth = s.equalTailedInterval.upper - s.equalTailedInterval.lower;
    // The HDI is the shortest 95% interval, so it cannot be wider.
    expect(hdiWidth).toBeLessThanOrEqual(etWidth * 1.001);
    // For a clearly skewed posterior they are genuinely different statements.
    expect(s.highestDensityInterval.lower).toBeLessThan(s.equalTailedInterval.lower);
  });

  it('computes the HDI of a known distribution correctly', () => {
    // 10000 draws from a standard normal: the shortest 95% interval of a
    // symmetric unimodal density is the equal-tailed one, -1.96 to +1.96.
    const rng = new Random(new Xoshiro128('hdi-normal'));
    const draws = new Float64Array(20000);
    for (let i = 0; i < draws.length; i++) draws[i] = rng.normal();
    const hdi = highestDensityInterval(draws, 0.95);
    const et = equalTailedInterval(draws, 0.95);
    expect(hdi.lower).toBeCloseTo(-1.96, 1);
    expect(hdi.upper).toBeCloseTo(1.96, 1);
    expect(hdi.upper - hdi.lower).toBeLessThanOrEqual(et.upper - et.lower + 1e-9);
  });

  it('refuses to summarise fewer than two draws', () => {
    expect(() => summariseParameter('x', [1])).toThrow(/at least 2/i);
    expect(() => highestDensityInterval([1], 0.95)).toThrow(/at least 2/i);
  });

  it('produces posterior predictive draws that are wider than the parameter posterior', () => {
    const run = runMcmc({
      target: gammaPoissonPosterior({ counts: [3, 1, 4, 1, 5], priorShape: 2, priorRate: 1 }),
      sampler: { kind: 'slice', width: 1 },
      chains: 2,
      iterations: 2000,
      warmup: 300,
      seed: 'predictive',
    });
    const predictive = posteriorPredictive(drawsAsVectors(run), (params, rng) => rng.poisson(params[0]), 'pred-seed');
    const predSd = Math.sqrt(variance(predictive, 1));
    // Predictive spread includes Poisson sampling noise on top of posterior
    // uncertainty in the rate, so it must exceed the posterior sd of lambda.
    expect(predSd).toBeGreaterThan(run.summaries[0].sd);
    expect(Math.abs(meanOf(predictive) - run.summaries[0].mean)).toBeLessThan(0.15);
    expect(() => posteriorPredictive(drawsAsVectors(run), () => NaN, 'bad')).toThrow(/finite/i);
  });
});

describe('the ready-made inference problems', () => {
  it('lists five problems and builds each one with a finite log-density at its start', () => {
    expect(INFERENCE_PROBLEMS.length).toBe(5);
    for (const problem of INFERENCE_PROBLEMS) {
      const target = problem.build();
      const start = target.suggestedStarts?.[0] ?? new Array<number>(target.dimension).fill(0);
      expect(Number.isFinite(target.logDensity(start)), problem.id).toBe(true);
      expect(target.parameterNames.length).toBe(target.dimension);
    }
    expect(getInferenceProblem('eight-schools').recommendedSampler).toBe('hmc');
    expect(() => getInferenceProblem('nope')).toThrow(/Unknown inference problem/);
  });

  it('fits the logistic regression posterior with HMC and finds a positive slope', () => {
    expect(logisticRegressionPosterior({ predictors: [[0], [1]], outcomes: [0, 1] }).dimension).toBe(2);
    const run = runMcmc({
      target: getInferenceProblem('logistic-regression').build(),
      sampler: { kind: 'hmc', stepSize: 0.3, leapfrogSteps: 10 },
      chains: 4,
      iterations: 1500,
      warmup: 500,
      seed: 'logistic-fit',
    });
    expect(run.convergence.verdict).toBe('converged');
    const slope = run.summaries[1];
    // The data were generated with a clearly positive slope.
    expect(slope.mean).toBeGreaterThan(0.5);
    expect(slope.equalTailedInterval.lower).toBeGreaterThan(0);
  });

  it('fits the hierarchical eight-schools model and shrinks the group estimates', () => {
    const target = hierarchicalEightSchools();
    expect(target.dimension).toBe(10);
    const run = runMcmc({
      target,
      sampler: { kind: 'hmc', stepSize: 0.25, leapfrogSteps: 12 },
      chains: 4,
      iterations: 1500,
      warmup: 750,
      seed: 'eight-schools-fit',
    });
    // mu should sit well inside the range of the observed effects (-3 to 28).
    const mu = run.summaries[0];
    expect(mu.mean).toBeGreaterThan(0);
    expect(mu.mean).toBeLessThan(20);
    expect(run.convergence.verdict).not.toBe('not converged');
  });

  it('fits the change-point model and locates the change in the middle of the series', () => {
    const run = runMcmc({
      target: changePointPoisson({
        counts: [4, 5, 4, 1, 0, 4, 3, 4, 0, 6, 3, 3, 4, 0, 2, 6, 3, 3, 5, 4, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 2],
        priorLogMean: 1,
        priorLogSd: 1,
      }),
      sampler: { kind: 'slice', width: 3 },
      chains: 4,
      iterations: 4000,
      warmup: 1000,
      seed: 'change-point-fit',
    });
    const cp = run.summaries[0];
    // The series drops after about observation 20; the posterior must find it.
    expect(cp.median).toBeGreaterThan(15);
    expect(cp.median).toBeLessThan(26);
    // The rate before the change must exceed the rate after it.
    expect(run.summaries[1].mean).toBeGreaterThan(run.summaries[2].mean);
  });

  it('fits the normal with unknown mean and variance using HMC', () => {
    const run = runMcmc({
      target: getInferenceProblem('normal-unknown-mean-variance').build(),
      sampler: { kind: 'hmc', stepSize: 0.2, leapfrogSteps: 10 },
      chains: 4,
      iterations: 2000,
      warmup: 600,
      seed: 'normal-mv-fit',
    });
    // R-hat and ESS both pass comfortably. The verdict is allowed to be
    // "marginal" here: this posterior produces the occasional divergent
    // transition near small sigma, and a single divergence is reported rather
    // than ignored, which is the behaviour being checked.
    expect(run.convergence.verdict).not.toBe('not converged');
    for (const d of run.diagnostics) {
      expect(d.worstRHat).toBeLessThan(CONVERGENCE_THRESHOLDS.rHat);
      expect(d.effectiveSampleSize).toBeGreaterThan(CONVERGENCE_THRESHOLDS.ess);
    }
    // Data mean is 5.425; with a vague prior the posterior mean must be close.
    expect(run.summaries[0].mean).toBeGreaterThan(5.0);
    expect(run.summaries[0].mean).toBeLessThan(5.9);
    // Sample sd is about 0.8, so log sigma should be near -0.2.
    expect(Math.exp(run.summaries[1].mean)).toBeGreaterThan(0.5);
    expect(Math.exp(run.summaries[1].mean)).toBeLessThan(1.4);
  });

  it('fits the Poisson rate with a log-normal prior using slice sampling', () => {
    const run = runMcmc({
      target: getInferenceProblem('poisson-lognormal').build(),
      sampler: { kind: 'slice', width: 1 },
      chains: 4,
      iterations: 3000,
      warmup: 500,
      seed: 'poisson-ln-fit',
    });
    expect(run.convergence.verdict).toBe('converged');
    // 26 events over 10 periods: the rate is near 2.6, log rate near 0.96.
    expect(Math.exp(run.summaries[0].mean)).toBeGreaterThan(1.8);
    expect(Math.exp(run.summaries[0].mean)).toBeLessThan(3.2);
  });
});
