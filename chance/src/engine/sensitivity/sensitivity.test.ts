import { describe, expect, it } from 'vitest';
import { getByPath, rankCorrelations, runSobol, runSweep, runTornado, setByPath, validateSweep } from './sensitivity';
import { analyseRiskRegister, parametricNormalRisk, riskMetrics } from '../risk/risk';
import { runSimulation } from '../simulation/runner';
import type { ScenarioModelConfig } from '../scenario/model';
import { Random } from '../random/rng';
import { getDistribution } from '../distributions/registry';

/** Deterministic scenario whose output is the Ishigami function of three fixed inputs. */
function ishigamiConfig(x1 = 0, x2 = 0, x3 = 0): ScenarioModelConfig {
  return {
    variables: [
      { id: '1', name: 'x1', label: 'x1', kind: 'fixed', value: x1 },
      { id: '2', name: 'x2', label: 'x2', kind: 'fixed', value: x2 },
      { id: '3', name: 'x3', label: 'x3', kind: 'fixed', value: x3 },
    ],
    correlationGroups: [],
    outputs: [
      {
        id: 'o',
        key: 'y',
        label: 'Ishigami y',
        // y = sin(x1) + 7 sin²(x2) + 0.1 x3⁴ sin(x1)
        expression: 'sin(x1) + 7 * sin(x2) * sin(x2) + 0.1 * x3^4 * sin(x1)',
        kind: 'continuous',
      },
    ],
    assumptions: [],
  };
}

describe('path helpers', () => {
  it('reads and writes nested numeric paths without mutating the source', () => {
    const cfg = { a: { b: [1, 2] }, c: 5 };
    expect(getByPath(cfg, 'c')).toBe(5);
    expect(getByPath(cfg, 'a.b.1')).toBe(2);
    const next = setByPath(cfg, 'a.b.0', 99);
    expect(getByPath(next, 'a.b.0')).toBe(99);
    expect(cfg.a.b[0]).toBe(1);
    expect(() => getByPath(cfg, 'a.zz.0')).toThrow(/does not exist/);
    expect(() => getByPath(cfg, 'a')).toThrow(/finite number/);
  });
});

describe('one-at-a-time sweep', () => {
  const base = {
    frequency: { distributionId: 'poisson', params: { lambda: 3 } },
    severity: { distributionId: 'gamma', params: { k: 2, theta: 1000 } },
    threshold: 10000,
    unit: 'GBP',
  };

  it('recovers the known linear relationship between rate and expected loss', () => {
    const r = runSweep({
      modelId: 'risk-aggregate',
      baseConfig: base,
      parameterPath: 'frequency.params.lambda',
      parameterLabel: 'Event rate',
      outputKey: 'total',
      min: 1,
      max: 5,
      steps: 5,
      trialsPerPoint: 20000,
      seed: 'sweep',
    });
    expect(r.points).toHaveLength(5);
    // Expected total = λ × 2000, so the gradient should be about 2000.
    expect(r.localGradient!).toBeGreaterThan(1800);
    expect(r.localGradient!).toBeLessThan(2200);
    // Elasticity of a proportional relationship is 1.
    expect(r.elasticity!).toBeGreaterThan(0.85);
    expect(r.elasticity!).toBeLessThan(1.15);
    expect(r.points[0].outputMean).toBeLessThan(r.points[4].outputMean);
    expect(r.limitations.join(' ')).toMatch(/Only this parameter was varied/);
  });

  it('rejects a range that makes the model invalid', () => {
    const issues = validateSweep({
      modelId: 'risk-aggregate',
      baseConfig: base,
      parameterPath: 'frequency.params.lambda',
      parameterLabel: 'Event rate',
      outputKey: 'total',
      min: -2,
      max: 5,
      steps: 5,
      trialsPerPoint: 100,
      seed: 's',
    });
    expect(issues[0].message).toMatch(/the model is invalid/);
    expect(issues[0].message).toMatch(/Narrow the range/);
  });

  it('rejects malformed sweep settings', () => {
    const bad = (over: Record<string, unknown>) =>
      validateSweep({
        modelId: 'risk-aggregate',
        baseConfig: base,
        parameterPath: 'frequency.params.lambda',
        parameterLabel: 'r',
        outputKey: 'total',
        min: 1,
        max: 5,
        steps: 5,
        trialsPerPoint: 100,
        seed: 's',
        ...over,
      });
    expect(bad({ max: 1 })[0].message).toMatch(/greater than the lower end/);
    expect(bad({ steps: 1 })[0].message).toMatch(/between 2 and/);
    expect(bad({ trialsPerPoint: 0 })[0].message).toMatch(/between 1 and/);
  });

  it('reports an unknown output rather than guessing', () => {
    expect(() =>
      runSweep({
        modelId: 'risk-aggregate',
        baseConfig: base,
        parameterPath: 'threshold',
        parameterLabel: 'Threshold',
        outputKey: 'nonexistent',
        min: 1000,
        max: 2000,
        steps: 2,
        trialsPerPoint: 100,
        seed: 's',
      }),
    ).toThrow(/is not produced by this model/);
  });
});

describe('tornado analysis', () => {
  it('ranks parameters by the size of their swing', () => {
    const r = runTornado({
      modelId: 'risk-aggregate',
      baseConfig: {
        frequency: { distributionId: 'poisson', params: { lambda: 3 } },
        severity: { distributionId: 'gamma', params: { k: 2, theta: 1000 } },
        threshold: 10000,
        unit: 'GBP',
      },
      outputKey: 'total',
      parameters: [
        { path: 'frequency.params.lambda', label: 'Event rate', low: 2, high: 4 },
        { path: 'severity.params.theta', label: 'Loss scale', low: 900, high: 1100 },
      ],
      trialsPerPoint: 30000,
      seed: 'tor',
    });
    expect(r.entries).toHaveLength(2);
    // Rate 2→4 swings the mean by ~4000; scale 900→1100 by ~1200.
    expect(r.entries[0].parameterLabel).toBe('Event rate');
    expect(r.entries[0].swing).toBeGreaterThan(r.entries[1].swing);
    expect(r.entries.every((e) => e.increasing)).toBe(true);
    expect(r.limitations.join(' ')).toMatch(/depends entirely on the low and high values you chose/);
  });

  it('skips parameters whose endpoints are invalid and says so', () => {
    const r = runTornado({
      modelId: 'risk-aggregate',
      baseConfig: {
        frequency: { distributionId: 'poisson', params: { lambda: 3 } },
        severity: { distributionId: 'gamma', params: { k: 2, theta: 1000 } },
        threshold: 100,
        unit: 'u',
      },
      outputKey: 'total',
      parameters: [
        { path: 'frequency.params.lambda', label: 'Rate', low: 2, high: 4 },
        { path: 'severity.params.k', label: 'Shape', low: -1, high: 3 },
      ],
      trialsPerPoint: 2000,
      seed: 't2',
    });
    expect(r.entries).toHaveLength(1);
    expect(r.limitations.join(' ')).toMatch(/Skipped parameters/);
  });
});

describe('Sobol variance decomposition', () => {
  it('recovers the analytic indices of the Ishigami function', () => {
    // Analytic values for a = 7, b = 0.1 on [−π, π]³:
    //   S1 = 0.3139, S2 = 0.4424, S3 = 0
    //   ST1 = 0.5576, ST2 = 0.4424, ST3 = 0.2437
    const r = runSobol({
      modelId: 'scenario',
      config: ishigamiConfig(),
      outputKey: 'y',
      parameters: [
        { path: 'variables.0.value', label: 'x1', low: -Math.PI, high: Math.PI },
        { path: 'variables.1.value', label: 'x2', low: -Math.PI, high: Math.PI },
        { path: 'variables.2.value', label: 'x3', low: -Math.PI, high: Math.PI },
      ],
      samples: 8000,
      trialsPerEvaluation: 1,
      seed: 'sobol',
    });
    const by = Object.fromEntries(r.entries.map((e) => [e.parameterLabel, e]));
    expect(by.x1.firstOrder).toBeCloseTo(0.3139, 1);
    expect(by.x2.firstOrder).toBeCloseTo(0.4424, 1);
    expect(Math.abs(by.x3.firstOrder)).toBeLessThan(0.05);
    expect(by.x1.total).toBeCloseTo(0.5576, 1);
    expect(by.x2.total).toBeCloseTo(0.4424, 1);
    expect(by.x3.total).toBeCloseTo(0.2437, 1);
    // x3 has no first-order effect but a real total effect: pure interaction.
    expect(by.x3.interaction).toBeGreaterThan(0.15);
    expect(r.modelRuns).toBe(8000 * 5);
    expect(r.limitations.join(' ')).toMatch(/assume the inputs are varied independently/);
    expect(r.limitations.join(' ')).toMatch(/comes from interactions/);
  });

  it('refuses to decompose a constant output', () => {
    const cfg = ishigamiConfig();
    cfg.outputs[0].expression = '42';
    expect(() =>
      runSobol({
        modelId: 'scenario',
        config: cfg,
        outputKey: 'y',
        parameters: [
          { path: 'variables.0.value', label: 'x1', low: -1, high: 1 },
          { path: 'variables.1.value', label: 'x2', low: -1, high: 1 },
        ],
        samples: 64,
        trialsPerEvaluation: 1,
        seed: 's',
      }),
    ).toThrow(/did not vary/);
  });

  it('requires at least two inputs and a valid sample size', () => {
    const p = [{ path: 'variables.0.value', label: 'x1', low: -1, high: 1 }];
    expect(() => runSobol({ modelId: 'scenario', config: ishigamiConfig(), outputKey: 'y', parameters: p, samples: 100, trialsPerEvaluation: 1, seed: 's' })).toThrow(/at least two inputs/);
    expect(() =>
      runSobol({
        modelId: 'scenario',
        config: ishigamiConfig(),
        outputKey: 'y',
        parameters: [...p, { path: 'variables.1.value', label: 'x2', low: -1, high: 1 }],
        samples: 4,
        trialsPerEvaluation: 1,
        seed: 's',
      }),
    ).toThrow(/between 16 and/);
  });
});

describe('rank correlation sensitivity', () => {
  const config: ScenarioModelConfig = {
    variables: [
      { id: '1', name: 'big', label: 'Big driver', kind: 'distribution', distributionId: 'normal', params: { mu: 10, sigma: 3 }, track: true },
      { id: '2', name: 'small', label: 'Small driver', kind: 'distribution', distributionId: 'normal', params: { mu: 10, sigma: 0.2 }, track: true },
      { id: '3', name: 'unused', label: 'Unused', kind: 'distribution', distributionId: 'normal', params: { mu: 0, sigma: 1 }, track: true },
      { id: '4', name: 'constant', label: 'Constant', kind: 'distribution', distributionId: 'discreteUniform', params: { a: 5, b: 5 }, track: true },
    ],
    correlationGroups: [],
    outputs: [{ id: 'o', key: 'total', label: 'Total', expression: 'big * 2 + small', kind: 'continuous' }],
    assumptions: [],
  };

  it('ranks the influential input first and flags constants', () => {
    const r = runSimulation({ modelId: 'scenario', config, trials: 20000, seed: 'rank', keepSamples: true });
    const rc = rankCorrelations(r, 'total');
    expect(rc.entries[0].inputLabel).toBe('Big driver');
    expect(Math.abs(rc.entries[0].spearman)).toBeGreaterThan(0.9);
    const unused = rc.entries.find((e) => e.inputLabel === 'Unused')!;
    expect(Math.abs(unused.spearman)).toBeLessThan(0.05);
    const constant = rc.entries.find((e) => e.inputLabel === 'Constant')!;
    expect(Number.isNaN(constant.spearman)).toBe(true);
    expect(constant.note).toMatch(/did not vary/);
    expect(rc.limitations.join(' ')).toMatch(/does not establish that changing an input causes/);
    expect(rc.limitations.join(' ')).toMatch(/not a decomposition of variance/);
  });

  it('explains what is missing when samples or tracked inputs are absent', () => {
    const noSamples = runSimulation({ modelId: 'scenario', config, trials: 100, seed: 'ns' });
    expect(() => rankCorrelations(noSamples, 'total')).toThrow(/sample retention/);
    const untracked: ScenarioModelConfig = { ...config, variables: config.variables.map((v) => ({ ...v, track: false })) };
    const r = runSimulation({ modelId: 'scenario', config: untracked, trials: 100, seed: 'ut', keepSamples: true });
    expect(() => rankCorrelations(r, 'total')).toThrow(/No inputs were tracked/);
  });
});

describe('risk metrics', () => {
  it('matches the closed-form normal VaR and ES', () => {
    const d = getDistribution('normal');
    const params = { mu: 100, sigma: 20 };
    const rng = new Random('risk-normal');
    const losses = new Float64Array(400000);
    for (let i = 0; i < losses.length; i++) losses[i] = d.sample(rng, params);
    const r = riskMetrics({ losses, levels: [0.95, 0.99], thresholds: [100, 150] });
    const exact95 = parametricNormalRisk(100, 20, 0.95);
    const exact99 = parametricNormalRisk(100, 20, 0.99);
    expect(r.var[0].valueAtRisk).toBeCloseTo(exact95.valueAtRisk, 0);
    expect(r.var[0].expectedShortfall).toBeCloseTo(exact95.expectedShortfall, 0);
    expect(r.var[1].valueAtRisk).toBeCloseTo(exact99.valueAtRisk, 0);
    expect(r.var[1].expectedShortfall).toBeCloseTo(exact99.expectedShortfall, 0);
    // ES is always at least VaR.
    for (const e of r.var) expect(e.expectedShortfall).toBeGreaterThanOrEqual(e.valueAtRisk);
    expect(r.exceedance[0].probability).toBeCloseTo(0.5, 2);
    expect(r.exceedance[0].low).toBeLessThan(0.5);
    expect(r.exceedance[0].high).toBeGreaterThan(0.5);
    expect(r.lossConvention).toMatch(/Positive values are losses/);
  });

  it('exact normal formulas match published values', () => {
    // Reference values from SciPy: φ(Φ⁻¹(α))/(1−α).
    const e = parametricNormalRisk(0, 1, 0.95);
    expect(e.valueAtRisk).toBeCloseTo(1.6448536269514722, 12);
    expect(e.expectedShortfall).toBeCloseTo(2.0627128075074257, 12);
    expect(parametricNormalRisk(0, 1, 0.99).expectedShortfall).toBeCloseTo(2.665214220345806, 12);
  });

  it('warns when the tail contains too few trials', () => {
    const rng = new Random('thin');
    const losses = Array.from({ length: 500 }, () => rng.normal());
    const r = riskMetrics({ losses, levels: [0.999] });
    expect(r.var[0].warnings.join(' ')).toMatch(/imprecise/);
    expect(r.var[0].tailCount).toBeLessThan(30);
  });

  it('reports a zero exceedance count without calling it impossible', () => {
    const r = riskMetrics({ losses: [1, 2, 3, 4, 5], levels: [0.9], thresholds: [100] });
    expect(r.exceedance[0].count).toBe(0);
    expect(r.exceedance[0].probability).toBe(0);
    expect(r.exceedance[0].high).toBeGreaterThan(0);
    expect(Number.isNaN(r.exceedance[0].conditionalMean)).toBe(true);
    expect(r.limitations.join(' ')).toMatch(/No outcome is impossible merely because/);
  });

  it('rejects invalid levels and too little data', () => {
    expect(() => riskMetrics({ losses: [1], levels: [0.95] })).toThrow(/At least 2/);
    expect(() => riskMetrics({ losses: [1, 2], levels: [1] })).toThrow(/greater than 0 and less than 1/);
  });
});

describe('risk register', () => {
  const entries = [
    { id: 'a', label: 'Supplier fails', probability: 0.1, probabilitySource: 'estimate' as const, impact: 50000, impactSource: 'estimate' as const },
    {
      id: 'b',
      label: 'Key person leaves',
      probability: 0.3,
      probabilitySource: 'estimate' as const,
      impact: 20000,
      impactSource: 'estimate' as const,
      mitigation: { label: 'Cross-train the team', probability: 0.3, impact: 8000, cost: 2000 },
    },
  ];

  it('computes expected loss, shares and mitigation benefit', () => {
    const r = analyseRiskRegister(entries);
    expect(r.totalExpectedLoss).toBeCloseTo(0.1 * 50000 + 0.3 * 20000, 9);
    // Rows are sorted by expected loss: 0.3 × 20000 = 6000 ranks above 0.1 × 50000 = 5000.
    expect(r.entries.map((e) => e.entry.label)).toEqual(['Key person leaves', 'Supplier fails']);
    expect(r.entries[0].expectedLoss).toBeCloseTo(6000, 9);
    expect(r.entries[1].expectedLoss).toBeCloseTo(5000, 9);
    const keyPerson = r.entries.find((e) => e.entry.id === 'b')!;
    expect(keyPerson.mitigatedExpectedLoss).toBeCloseTo(2400, 9);
    expect(keyPerson.netBenefit).toBeCloseTo(6000 - 2400 - 2000, 9);
    expect(r.probabilityAtLeastOne).toBeCloseTo(1 - 0.9 * 0.7, 12);
    expect(r.limitations.join(' ')).toMatch(/assumes the risks are independent/);
    expect(r.limitations.join(' ')).toMatch(/2 of 2 risk probabilities/);
  });

  it('uses the union bound when independence is not assumed', () => {
    const r = analyseRiskRegister(entries, false);
    expect(r.probabilityAtLeastOne).toBeCloseTo(0.4, 12);
    expect(r.limitations.join(' ')).toMatch(/only the bound/);
  });

  it('explains that equal expected losses are not equal situations', () => {
    const r = analyseRiskRegister([
      { id: 'rare', label: 'Rare catastrophe', probability: 0.01, probabilitySource: 'estimate', impact: 1000000, impactSource: 'estimate' },
      { id: 'certain', label: 'Routine cost', probability: 1, probabilitySource: 'data', impact: 10000, impactSource: 'data' },
    ]);
    expect(r.entries[0].expectedLoss).toBeCloseTo(10000, 9);
    expect(r.entries[1].expectedLoss).toBeCloseTo(10000, 9);
    expect(r.limitations.join(' ')).toMatch(/are not the same situation/);
  });

  it('validates inputs', () => {
    expect(() => analyseRiskRegister([])).toThrow(/at least one risk/);
    expect(() => analyseRiskRegister([{ ...entries[0], probability: 1.4 }])).toThrow(/between 0 and 1/);
    expect(() => analyseRiskRegister([{ ...entries[0], impact: NaN }])).toThrow(/finite number/);
  });
});
