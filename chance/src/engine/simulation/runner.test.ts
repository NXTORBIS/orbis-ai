import { describe, expect, it } from 'vitest';
import { convergenceCheckpoints, runSimulation, validateRequest } from './runner';
import { exactSumDistribution, tableSummary } from '../experiments/exact';
import { exactSuccessDistribution, exactTotalDistribution, prepareExperiment, validateExperiment } from '../experiments/model';
import { prepareScenario, validateScenario, type ScenarioModelConfig } from '../scenario/model';
import { Random } from '../random/rng';
import { spearman } from '../stats/descriptive';
import { getDistribution } from '../distributions/registry';

const out = (r: ReturnType<typeof runSimulation>, key: string) => r.outputs.find((o) => o.spec.key === key)!;

describe('simulation runner', () => {
  it('estimates π within Monte Carlo error and the interval covers the truth', () => {
    const r = runSimulation({ modelId: 'pi-estimation', config: { method: 'quarter-circle' }, trials: 200000, seed: 'pi-1' });
    const o = out(r, 'inside');
    expect(o.estimateInterval.low).toBeLessThan(Math.PI / 4);
    expect(o.estimateInterval.high).toBeGreaterThan(Math.PI / 4);
    expect(Math.abs(o.summary.mean - Math.PI / 4)).toBeLessThan(4 * Math.sqrt(((Math.PI / 4) * (1 - Math.PI / 4)) / 200000));
    expect(o.theoretical?.probability).toBeCloseTo(Math.PI / 4, 15);
  });

  it('is exactly reproducible for the same seed and differs for another', () => {
    const cfg = { modelId: 'dice-sum', config: { diceCount: 3, faces: 6, threshold: 12 }, trials: 5000, seed: 'abc', keepSamples: true } as const;
    const a = runSimulation({ ...cfg });
    const b = runSimulation({ ...cfg });
    const c = runSimulation({ ...cfg, seed: 'abd' });
    expect(Array.from(a.samples!.total)).toEqual(Array.from(b.samples!.total));
    expect(Array.from(a.samples!.total)).not.toEqual(Array.from(c.samples!.total));
    expect(a.outputs[0].summary.mean).toBe(b.outputs[0].summary.mean);
  });

  it('reports progress and honours cancellation', () => {
    const progress: number[] = [];
    const r = runSimulation(
      { modelId: 'pi-estimation', config: {}, trials: 100000, seed: 's' },
      { onProgress: (p) => progress.push(p.completed), isCancelled: () => progress.length >= 3 },
    );
    expect(r.cancelled).toBe(true);
    expect(r.trialsCompleted).toBeLessThan(100000);
    expect(r.trialsCompleted).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(r.warnings.join(' ')).toMatch(/cancelled/);
    // Statistics are still computed from the completed trials only.
    expect(out(r, 'inside').summary.n).toBe(r.trialsCompleted);
  });

  it('rejects invalid requests with actionable messages', () => {
    expect(validateRequest({ modelId: 'pi-estimation', config: {}, trials: 0, seed: 's' })[0].message).toMatch(/at least 1/);
    expect(validateRequest({ modelId: 'pi-estimation', config: {}, trials: 1e9, seed: 's' })[0].message).toMatch(/maximum/);
    expect(validateRequest({ modelId: 'nope', config: {}, trials: 10, seed: 's' })[0].message).toMatch(/Unknown simulation model/);
    expect(validateRequest({ modelId: 'dice-sum', config: { diceCount: 0, faces: 6, threshold: 1 }, trials: 10, seed: 's' })[0].field).toBe('diceCount');
    expect(() => runSimulation({ modelId: 'pi-estimation', config: {}, trials: -1, seed: 's' })).toThrow();
  });

  it('records non-finite trial values instead of silently replacing them', () => {
    const config: ScenarioModelConfig = {
      variables: [
        { id: 'v1', name: 'd', label: 'Denominator', kind: 'distribution', distributionId: 'discreteUniform', params: { a: -1, b: 1 } },
      ],
      correlationGroups: [],
      outputs: [{ id: 'o1', key: 'ratio', label: 'Ratio', expression: '1 / d', kind: 'continuous' }],
      assumptions: [],
    };
    const r = runSimulation({ modelId: 'scenario', config, trials: 3000, seed: 'div' });
    const o = out(r, 'ratio');
    expect(o.nonFinite).toBeGreaterThan(0);
    expect(o.warnings.join(' ')).toMatch(/not a finite number/);
    expect(Number.isFinite(o.summary.mean)).toBe(true);
  });

  it('warns when an indicator event never occurs and does not call it impossible', () => {
    const config: ScenarioModelConfig = {
      variables: [{ id: 'v', name: 'x', label: 'x', kind: 'distribution', distributionId: 'normal', params: { mu: 0, sigma: 1 } }],
      correlationGroups: [],
      outputs: [{ id: 'o', key: 'tail', label: 'Beyond 8 sigma', expression: 'x > 8', kind: 'indicator' }],
      assumptions: [],
    };
    const r = runSimulation({ modelId: 'scenario', config, trials: 2000, seed: 'tail' });
    const o = out(r, 'tail');
    expect(o.summary.mean).toBe(0);
    expect(o.warnings.join(' ')).toMatch(/does not make it impossible/);
    expect(o.estimateInterval.high).toBeGreaterThan(0);
  });

  it('builds geometric convergence checkpoints covering the whole run', () => {
    const cp = convergenceCheckpoints(100000, 50);
    expect(cp[0]).toBe(1);
    expect(cp[cp.length - 1]).toBe(100000);
    expect(cp.every((v, i) => i === 0 || v > cp[i - 1])).toBe(true);
    expect(convergenceCheckpoints(7, 50)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('convergence interval narrows roughly as 1/√n', () => {
    const r = runSimulation({ modelId: 'pi-estimation', config: {}, trials: 100000, seed: 'conv' });
    const c = out(r, 'inside').convergence;
    const at100 = c.find((p) => p.n >= 100)!;
    const at10000 = c.find((p) => p.n >= 10000)!;
    const ratio = (at100.high - at100.low) / (at10000.high - at10000.low);
    expect(ratio).toBeGreaterThan(5);
    expect(ratio).toBeLessThan(20);
  });
});

describe('built-in models against analytic results', () => {
  it('dice sum matches the exact convolution distribution', () => {
    const exact = exactSumDistribution([1, 2, 3, 4, 5, 6].map((v) => ({ value: v, probability: 1 / 6 })), 3)!;
    const s = tableSummary(exact);
    expect(s.total).toBeCloseTo(1, 12);
    expect(s.mean).toBeCloseTo(10.5, 12);
    expect(s.variance).toBeCloseTo(3 * (35 / 12), 12);
    // P(sum = 10) for 3d6 is 27/216
    expect(exact.rows.find((r) => r.value === 10)!.probability).toBeCloseTo(27 / 216, 14);
    const r = runSimulation({ modelId: 'dice-sum', config: { diceCount: 3, faces: 6, threshold: 10 }, trials: 200000, seed: 'dice' });
    const total = out(r, 'total');
    expect(Math.abs(total.summary.mean - 10.5)).toBeLessThan(4 * total.summary.standardError);
    const pAtLeast10 = exact.rows.filter((x) => x.value >= 10).reduce((a, x) => a + x.probability, 0);
    const ind = out(r, 'atLeast');
    expect(ind.estimateInterval.low).toBeLessThan(pAtLeast10);
    expect(ind.estimateInterval.high).toBeGreaterThan(pAtLeast10);
  });

  it('M/M/1 average wait approaches the steady-state formula', () => {
    const r = runSimulation({ modelId: 'queue', config: { arrivalRate: 0.5, serviceRate: 1, customers: 4000 }, trials: 400, seed: 'q' });
    const w = out(r, 'meanWait');
    const expected = 0.5 / (1 - 0.5); // ρ/(μ−λ) = 1
    expect(w.summary.mean).toBeGreaterThan(expected * 0.8);
    expect(w.summary.mean).toBeLessThan(expected * 1.2);
    expect(w.theoretical?.mean).toBeCloseTo(expected, 12);
  });

  it('unstable queue is flagged rather than reported as a steady state', () => {
    const r = runSimulation({ modelId: 'queue', config: { arrivalRate: 2, serviceRate: 1, customers: 500 }, trials: 50, seed: 'q2' });
    expect(out(r, 'meanWait').theoretical).toBeUndefined();
    expect(r.assumptions.join(' ')).toMatch(/grows without limit/);
  });

  it('Markov chain fractions approach the stationary distribution', () => {
    // Two-state chain with stationary distribution (0.25, 0.75).
    const matrix = [
      [0.7, 0.3],
      [0.1, 0.9],
    ];
    const r = runSimulation({
      modelId: 'markov-chain',
      config: { states: ['A', 'B'], matrix, initialState: 0, steps: 20000, targetState: 1 },
      trials: 60,
      seed: 'mk',
    });
    expect(out(r, 'fraction:0').summary.mean).toBeCloseTo(0.25, 2);
    expect(out(r, 'fraction:1').summary.mean).toBeCloseTo(0.75, 2);
    expect(out(r, 'reachedTarget').summary.mean).toBe(1);
  });

  it('rejects a transition matrix whose rows do not sum to one', () => {
    const issues = validateRequest({
      modelId: 'markov-chain',
      config: { states: ['A', 'B'], matrix: [[0.7, 0.2], [0.1, 0.9]], initialState: 0, steps: 10, targetState: -1 },
      trials: 10,
      seed: 's',
    });
    expect(issues[0].message).toMatch(/sums to 0.9/);
  });

  it('aggregate risk mean and variance match the compound formulas', () => {
    const config = {
      frequency: { distributionId: 'poisson', params: { lambda: 3 } },
      severity: { distributionId: 'gamma', params: { k: 2, theta: 1000 } },
      threshold: 10000,
      unit: 'GBP',
    };
    const r = runSimulation({ modelId: 'risk-aggregate', config, trials: 200000, seed: 'risk' });
    const t = out(r, 'total');
    // E = 3 × 2000 = 6000; Var = 3·(2·1000²) + 3·2000² = 6e6 + 1.2e7 = 1.8e7
    expect(t.theoretical?.mean).toBeCloseTo(6000, 9);
    expect(t.theoretical?.variance).toBeCloseTo(1.8e7, 6);
    expect(Math.abs(t.summary.mean - 6000)).toBeLessThan(4 * t.summary.standardError);
    expect(Math.abs(t.summary.variance - 1.8e7) / 1.8e7).toBeLessThan(0.05);
  });

  it('sampling distribution of the mean has variance sigma squared over n', () => {
    const r = runSimulation({
      modelId: 'sampling-distribution',
      config: { distributionId: 'exponential', params: { lambda: 1 }, sampleSize: 25, statistic: 'mean' },
      trials: 100000,
      seed: 'clt',
    });
    const o = out(r, 'statistic');
    expect(Math.abs(o.summary.mean - 1)).toBeLessThan(4 * o.summary.standardError);
    expect(o.summary.variance).toBeCloseTo(1 / 25, 2);
    // The sampling distribution is far less skewed than the parent exponential (skew 2).
    expect(o.summary.skewness).toBeLessThan(1);
  });

  it('notes that the Cauchy sample mean does not converge', () => {
    const r = runSimulation({
      modelId: 'sampling-distribution',
      config: { distributionId: 'cauchy', params: { x0: 0, gamma: 1 }, sampleSize: 50, statistic: 'mean' },
      trials: 2000,
      seed: 'cau',
    });
    expect(r.assumptions.join(' ')).toMatch(/law of large numbers does not apply/);
  });

  it('project schedule respects dependencies and detects cycles', () => {
    const tasks = [
      { id: 'a', name: 'Design', distributionId: 'uniform', params: { a: 2, b: 4 }, dependsOn: [] },
      { id: 'b', name: 'Build', distributionId: 'uniform', params: { a: 5, b: 9 }, dependsOn: ['a'] },
      { id: 'c', name: 'Docs', distributionId: 'uniform', params: { a: 1, b: 2 }, dependsOn: ['a'] },
    ];
    const r = runSimulation({ modelId: 'project-schedule', config: { tasks, deadline: 12, unit: 'days' }, trials: 50000, seed: 'proj' });
    const c = out(r, 'completion');
    // Serial path a→b dominates: mean ≈ 3 + 7 = 10, and completion ≥ 7 always.
    expect(c.summary.min).toBeGreaterThanOrEqual(7);
    expect(c.summary.mean).toBeGreaterThan(9.5);
    expect(c.summary.mean).toBeLessThan(10.5);
    const cyc = validateRequest({
      modelId: 'project-schedule',
      config: { tasks: [{ ...tasks[0], dependsOn: ['b'] }, tasks[1]], deadline: 5, unit: 'd' },
      trials: 10,
      seed: 's',
    });
    expect(cyc.some((i) => i.code === 'cycle')).toBe(true);
  });

  it('rejects a duration distribution that allows negative values', () => {
    const issues = validateRequest({
      modelId: 'project-schedule',
      config: { tasks: [{ id: 'a', name: 'T', distributionId: 'normal', params: { mu: 5, sigma: 1 }, dependsOn: [] }], deadline: 5, unit: 'd' },
      trials: 10,
      seed: 's',
    });
    expect(issues[0].message).toMatch(/negative durations/);
  });
});

describe('experiments', () => {
  it('coin experiment frequencies approach the binomial distribution', () => {
    const config = { source: { kind: 'coin' as const, count: 10, headsProbability: 0.5 } };
    const exact = exactSuccessDistribution(config)!;
    expect(exact.rows.find((r) => r.value === 5)!.probability).toBeCloseTo(252 / 1024, 14);
    const r = runSimulation({ modelId: 'experiment', config, trials: 100000, seed: 'coin' });
    const s = out(r, 'successes');
    expect(Math.abs(s.summary.mean - 5)).toBeLessThan(4 * s.summary.standardError);
    const five = s.frequencies!.find((f) => f.value === 5)!;
    expect(Math.abs(five.proportion - 252 / 1024)).toBeLessThan(0.01);
  });

  it('cards without replacement match the hypergeometric distribution', () => {
    const config = {
      source: { kind: 'deck' as const, decks: 1, draws: 5, withReplacement: false, successRanks: ['A'], successSuits: [] },
    };
    const exact = exactSuccessDistribution(config)!;
    const hyper = getDistribution('hypergeometric');
    expect(exact.rows.find((r) => r.value === 1)!.probability).toBeCloseTo(hyper.pdf(1, { N: 52, K: 4, n: 5 }), 14);
    expect(exact.rows.reduce((a, r) => a + r.probability, 0)).toBeCloseTo(1, 12);
    const r = runSimulation({ modelId: 'experiment', config, trials: 200000, seed: 'cards' });
    const s = out(r, 'successes');
    const expectedMean = (5 * 4) / 52;
    expect(Math.abs(s.summary.mean - expectedMean)).toBeLessThan(4 * s.summary.standardError);
    expect(s.theoretical?.mean).toBeCloseTo(expectedMean, 12);
    // Variance must use the finite-population correction, not the binomial one.
    const binomialVar = 5 * (4 / 52) * (1 - 4 / 52);
    expect(s.theoretical!.variance!).toBeLessThan(binomialVar);
  });

  it('drawing more objects than exist without replacement is rejected', () => {
    const issues = validateExperiment({
      source: { kind: 'urn', items: [{ label: 'red', count: 3, value: 1, success: true }], draws: 5, withReplacement: false },
    });
    expect(issues[0].message).toMatch(/cannot draw 5 objects without replacement/);
  });

  it('does not silently normalise custom weights', () => {
    const prepared = prepareExperiment({
      source: { kind: 'custom', faces: [{ label: 'a', value: 1, weight: 3 }, { label: 'b', value: 0, weight: 1 }], draws: 1, withReplacement: true },
    });
    expect(prepared.assumptions.join(' ')).toMatch(/treated as relative weights/);
    expect(prepared.assumptions.join(' ')).toMatch(/No weight was altered/);
  });

  it('non-integer weights cannot be drawn without replacement', () => {
    const issues = validateExperiment({
      source: { kind: 'custom', faces: [{ label: 'a', value: 1, weight: 1.5 }, { label: 'b', value: 0, weight: 1 }], draws: 1, withReplacement: false },
    });
    expect(issues[0].message).toMatch(/whole-number counts/);
  });

  it('success conditions are evaluated and restricted to known variables', () => {
    const r = runSimulation({
      modelId: 'experiment',
      config: { source: { kind: 'dice', count: 2, faces: 6 }, successCondition: 'total >= 11' },
      trials: 100000,
      seed: 'cond',
    });
    const o = out(r, 'conditionMet');
    expect(Math.abs(o.summary.mean - 3 / 36)).toBeLessThan(0.01);
    expect(validateExperiment({ source: { kind: 'dice', count: 1, faces: 6 }, successCondition: 'banana > 1' })[0].message).toMatch(/not available/);
  });

  it('exact total distribution for weighted dice sums to one', () => {
    const t = exactTotalDistribution({ source: { kind: 'dice', count: 4, faces: 6, weights: [3, 1, 1, 1, 1, 1] } })!;
    expect(t.rows.reduce((a, r) => a + r.probability, 0)).toBeCloseTo(1, 12);
    const s = tableSummary(t);
    // Weighted die mean: (3·1+2+3+4+5+6)/8 = 23/8
    expect(s.mean).toBeCloseTo(4 * (23 / 8), 12);
  });
});

describe('scenario models', () => {
  it('evaluates derived variables and dependency order', () => {
    const config: ScenarioModelConfig = {
      variables: [
        { id: '1', name: 'base', label: 'Base', kind: 'fixed', value: 100 },
        { id: '2', name: 'growth', label: 'Growth', kind: 'distribution', distributionId: 'uniform', params: { a: 0, b: 0.2 } },
        { id: '3', name: 'total', label: 'Total', kind: 'derived', expression: 'base * (1 + growth)' },
      ],
      correlationGroups: [],
      outputs: [{ id: 'o', key: 'total', label: 'Total', expression: 'total', kind: 'continuous' }],
      assumptions: [],
    };
    const r = runSimulation({ modelId: 'scenario', config, trials: 50000, seed: 'sc' });
    const o = out(r, 'total');
    expect(o.summary.mean).toBeCloseTo(110, 0);
    expect(o.summary.min).toBeGreaterThanOrEqual(100);
    expect(o.summary.max).toBeLessThanOrEqual(120);
  });

  it('reproduces a requested rank correlation through the Gaussian copula', () => {
    const config: ScenarioModelConfig = {
      variables: [
        { id: '1', name: 'a', label: 'A', kind: 'distribution', distributionId: 'lognormal', params: { mu: 0, sigma: 1 }, track: true },
        { id: '2', name: 'b', label: 'B', kind: 'distribution', distributionId: 'exponential', params: { lambda: 2 }, track: true },
      ],
      correlationGroups: [{ id: 'g', label: 'Linked', variables: ['a', 'b'], pairs: [{ a: 'a', b: 'b', rho: 0.8 }] }],
      outputs: [{ id: 'o', key: 'sum', label: 'Sum', expression: 'a + b', kind: 'continuous' }],
      assumptions: [],
    };
    const r = runSimulation({ modelId: 'scenario', config, trials: 30000, seed: 'copula', keepSamples: true });
    const rho = spearman(r.samples!['input:a'], r.samples!['input:b']);
    // The requested value is the target Spearman correlation, so the realised
    // rank correlation should match it: the latent normal correlation is
    // converted with rho = 2·sin(pi·rho_s/6) before the copula uses it.
    expect(Math.abs(rho - 0.8)).toBeLessThan(0.02);
    expect(r.assumptions.join(' ')).toMatch(/no tail dependence/);
  });

  it('rejects an inconsistent correlation matrix', () => {
    const config: ScenarioModelConfig = {
      variables: ['a', 'b', 'c'].map((n, i) => ({
        id: String(i),
        name: n,
        label: n,
        kind: 'distribution' as const,
        distributionId: 'normal',
        params: { mu: 0, sigma: 1 },
      })),
      correlationGroups: [
        {
          id: 'g',
          label: 'Impossible',
          variables: ['a', 'b', 'c'],
          pairs: [
            { a: 'a', b: 'b', rho: 0.9 },
            { a: 'b', b: 'c', rho: 0.9 },
            { a: 'a', b: 'c', rho: -0.9 },
          ],
        },
      ],
      outputs: [{ id: 'o', key: 's', label: 'S', expression: 'a + b + c', kind: 'continuous' }],
      assumptions: [],
    };
    const issues = validateScenario(config);
    expect(issues.some((i) => i.code === 'not-positive-definite')).toBe(true);
    expect(issues[0].message).toMatch(/mutually inconsistent/);
  });

  it('supports conditional parameters and rejects them inside correlation groups', () => {
    const config: ScenarioModelConfig = {
      variables: [
        { id: '1', name: 'quality', label: 'Quality', kind: 'distribution', distributionId: 'beta', params: { alpha: 5, beta: 2 } },
        {
          id: '2',
          name: 'defects',
          label: 'Defects',
          kind: 'distribution',
          distributionId: 'binomial',
          params: { n: 100, p: 0.1 },
          paramExpressions: { p: '1 - quality' },
        },
      ],
      correlationGroups: [],
      outputs: [{ id: 'o', key: 'defects', label: 'Defects', expression: 'defects', kind: 'discrete' }],
      assumptions: [],
    };
    expect(validateScenario(config)).toEqual([]);
    const r = runSimulation({ modelId: 'scenario', config, trials: 40000, seed: 'cond2' });
    // E[defects] = 100 · E[1 − quality] = 100 · (1 − 5/7) ≈ 28.57
    expect(out(r, 'defects').summary.mean).toBeCloseTo(100 * (2 / 7), 0);
    const bad = validateScenario({ ...config, correlationGroups: [{ id: 'g', label: 'g', variables: ['quality', 'defects'], pairs: [] }] });
    expect(bad.some((i) => i.message.includes('cannot be both conditional'))).toBe(true);
  });

  it('detects circular variable definitions and unknown references', () => {
    const base = { correlationGroups: [], outputs: [{ id: 'o', key: 'x', label: 'x', expression: 'a', kind: 'continuous' as const }], assumptions: [] };
    const cyclic = validateScenario({
      ...base,
      variables: [
        { id: '1', name: 'a', label: 'a', kind: 'derived', expression: 'b + 1' },
        { id: '2', name: 'b', label: 'b', kind: 'derived', expression: 'a + 1' },
      ],
    });
    expect(cyclic.some((i) => i.code === 'cycle')).toBe(true);
    const unknown = validateScenario({
      ...base,
      variables: [{ id: '1', name: 'a', label: 'a', kind: 'derived', expression: 'zzz * 2' }],
    });
    expect(unknown.some((i) => i.message.includes('unknown variable "zzz"'))).toBe(true);
  });

  it('declares independence between unconnected variables as an assumption', () => {
    const prepared = prepareScenario({
      variables: [
        { id: '1', name: 'a', label: 'A', kind: 'distribution', distributionId: 'normal', params: { mu: 0, sigma: 1 } },
        { id: '2', name: 'b', label: 'B', kind: 'distribution', distributionId: 'normal', params: { mu: 0, sigma: 1 } },
      ],
      correlationGroups: [],
      outputs: [{ id: 'o', key: 's', label: 'S', expression: 'a + b', kind: 'continuous' }],
      assumptions: [],
    });
    expect(prepared.assumptions.join(' ')).toMatch(/sampled independently/);
  });
});

describe('resampling models', () => {
  const data = [4.1, 5.2, 6.8, 3.3, 7.7, 5.5, 4.9, 6.1, 5.0, 8.2, 2.9, 6.6];

  it('bootstrap standard error approximates the analytic standard error of the mean', () => {
    const r = runSimulation({ modelId: 'bootstrap', config: { data, statistic: 'mean' }, trials: 20000, seed: 'boot' });
    const o = out(r, 'statistic');
    const n = data.length;
    const m = data.reduce((a, b) => a + b, 0) / n;
    const s2 = data.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
    const analyticSe = Math.sqrt(s2 / n);
    // The bootstrap SE estimates √((n−1)/n)·analytic SE for the mean.
    expect(o.summary.sd).toBeGreaterThan(analyticSe * 0.85);
    expect(o.summary.sd).toBeLessThan(analyticSe * 1.1);
    expect(o.theoretical?.mean).toBeCloseTo(m, 12);
  });

  it('bootstrap rejects data with missing values', () => {
    expect(validateRequest({ modelId: 'bootstrap', config: { data: [1, NaN, 3], statistic: 'mean' }, trials: 10, seed: 's' })[0].message).toMatch(/finite numbers/);
  });

  it('permutation test p-value is near 1 for identical groups and small for separated ones', () => {
    const same = runSimulation({
      modelId: 'permutation-test',
      config: { groupA: data.slice(0, 6), groupB: data.slice(6), statistic: 'meanDifference', alternative: 'two-sided' },
      trials: 20000,
      seed: 'perm1',
    });
    expect(out(same, 'asExtreme').summary.mean).toBeGreaterThan(0.1);
    const far = runSimulation({
      modelId: 'permutation-test',
      config: { groupA: [10, 11, 12, 13, 14, 15], groupB: [1, 2, 3, 4, 5, 6], statistic: 'meanDifference', alternative: 'two-sided' },
      trials: 20000,
      seed: 'perm2',
    });
    expect(out(far, 'asExtreme').summary.mean).toBeLessThan(0.01);
    expect(far.assumptions.join(' ')).toMatch(/does not say how large/);
  });
});

describe('RNG quality and reproducibility', () => {
  it('produces a uniform distribution over dice faces', () => {
    const rng = new Random('chi');
    const counts = new Array(6).fill(0);
    const n = 600000;
    for (let i = 0; i < n; i++) counts[rng.int(1, 6) - 1]++;
    const expected = n / 6;
    const chi2 = counts.reduce((a, c) => a + (c - expected) ** 2 / expected, 0);
    // 5 degrees of freedom: the 99.9% critical value is 20.5.
    expect(chi2).toBeLessThan(20.5);
  });

  it('the same seed reproduces the same stream across instances', () => {
    const a = new Random('seed-x');
    const b = new Random('seed-x');
    for (let i = 0; i < 100; i++) expect(a.uniform()).toBe(b.uniform());
  });

  it('shuffle is a permutation and reaches many orderings', () => {
    const rng = new Random('shuf');
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const arr = rng.shuffle([1, 2, 3, 4]);
      expect([...arr].sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);
      seen.add(arr.join(''));
    }
    expect(seen.size).toBe(24);
  });
});
