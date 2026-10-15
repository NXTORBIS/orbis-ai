/**
 * Optimisation under a probabilistic constraint: chance-constrained and
 * CVaR-constrained linear programs.
 *
 * Four routes to the same shape of question — "this row must hold often
 * enough" — are presented side by side rather than as alternatives to choose
 * between, because they are not interchangeable and the differences are the
 * point:
 *
 *  - the exact Gaussian quantile reformulation, per row;
 *  - the Bonferroni split for a joint requirement, which is CONSERVATIVE and
 *    is labelled as such everywhere, with the realised joint probability
 *    measured by Monte Carlo next to the level it guarantees;
 *  - the distribution-free scenario approximation with its Calafiore–Campi
 *    sample size, which is costly and therefore run only on request;
 *  - the CVaR reformulation, which is a strictly stronger requirement than a
 *    probability and is never presented as the same thing.
 *
 * The configuration stores the covariance of each uncertain row as a standard
 * deviation per variable plus one equicorrelation, not as a full matrix: a
 * matrix edited cell by cell stops being positive definite constantly, and a
 * covariance that is not positive definite has no square root, so the
 * reformulation does not exist. Independence is not assumed — the correlation
 * is an explicit, editable input, and it defaults to a non-zero value so that
 * leaving it alone is not silently an independence assumption.
 */
import { useMemo } from 'react';
import {
  calafioreCampiSampleSize,
  discreteCvar,
  discreteVar,
  gaussianChanceConstraint,
  jointSatisfactionProbability,
  requirePositiveDefinite,
  simulatedAnnealing,
  solveCvarConstrainedLp,
  solveGaussianChanceLp,
  solveJointChanceBonferroni,
  solveScenarioApproximation,
  tailSensitivity,
  type GaussianChanceSpec,
  type LossScenario,
  type LpProblem,
  type LpRow,
  type Provenance,
  type RowSense,
} from '../../engine/stochopt';
import { Random } from '../../engine/random/rng';
import { EXACTNESS_LABEL, type Explanation } from '../../engine/core/result';
import {
  Badge,
  Button,
  Card,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  ProbabilityField,
  Segmented,
  SelectField,
  SliderField,
  TextField,
} from '../../ui/primitives';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------- configuration */

/** One deterministic linear row of the program. */
interface DeterministicRowConfig {
  name: string;
  coef: number[];
  sense: RowSense;
  rhs: number;
}

/**
 * One row whose coefficient vector is uncertain. The covariance is stored as a
 * standard deviation per variable and a single correlation between them, which
 * is always a valid covariance for a correlation strictly inside
 * (−1/(n−1), 1) and is refused otherwise rather than repaired silently.
 */
interface ChanceRowConfig {
  name: string;
  meanCoef: number[];
  sd: number[];
  correlation: number;
  rhs: number;
  reliability: number;
}

/** One realisation of the loss used by the CVaR route: loss = coefᵀx − rhs. */
interface LossScenarioConfig {
  name: string;
  probability: number;
  coef: number[];
  rhs: number;
}

export interface StochasticOptimisationConfig {
  /** Which route the right-hand column leads with. Every route stays visible. */
  route: 'individual' | 'joint';
  variableNames: string[];
  sense: 'min' | 'max';
  objective: number[];
  upperBounds: number[];
  rows: DeterministicRowConfig[];
  chanceRows: ChanceRowConfig[];
  /** Required probability that ALL uncertain rows hold together (Bonferroni). */
  jointReliability: number;
  /** Draws used to MEASURE the realised joint probability of a decision. */
  measureDraws: number;
  measureSeed: string;
  cvarLevel: number;
  cvarBound: number;
  lossScenarios: LossScenarioConfig[];
  /** Reliability levels the tail-sensitivity comparison is drawn at. */
  tailLevels: number[];
  scenarioEpsilon: number;
  scenarioBeta: number;
  scenarioDraws: number;
  scenarioSeed: string;
  /** Opt-in: the scenario program adds one row per draw and is slow. */
  runScenarioApproximation: boolean;
  annealIterations: number;
  annealInitialTemperature: number;
  annealCoolingRate: number;
  annealStep: number;
  annealSeed: string;
  /** Opt-in: tens of thousands of objective evaluations on the main thread. */
  runAnnealing: boolean;
}

export const STOCHASTIC_OPTIMISATION_DEFAULT: StochasticOptimisationConfig = {
  route: 'individual',
  variableNames: ['Product A', 'Product B', 'Product C'],
  sense: 'max',
  objective: [12, 9, 7],
  upperBounds: [60, 60, 60],
  rows: [
    { name: 'Labour hours', coef: [3, 2, 4], sense: '<=', rhs: 240 },
    { name: 'Budget', coef: [8, 6, 5], sense: '<=', rhs: 480 },
  ],
  chanceRows: [
    { name: 'Machine hours', meanCoef: [2.5, 3, 1.8], sd: [0.4, 0.5, 0.3], correlation: 0.2, rhs: 200, reliability: 0.95 },
    { name: 'Scarce material', meanCoef: [1.2, 0.8, 1.5], sd: [0.2, 0.15, 0.3], correlation: 0.2, rhs: 100, reliability: 0.95 },
  ],
  jointReliability: 0.95,
  measureDraws: 4000,
  measureSeed: 'joint-1',
  cvarLevel: 0.95,
  cvarBound: 0,
  lossScenarios: [
    { name: 'Machine time as planned', probability: 0.4, coef: [2, 2.6, 1.5], rhs: 200 },
    { name: 'Mild overrun', probability: 0.3, coef: [2.5, 3, 1.8], rhs: 200 },
    { name: 'Serious overrun', probability: 0.2, coef: [3.1, 3.6, 2.2], rhs: 200 },
    { name: 'Breakdown', probability: 0.1, coef: [3.9, 4.4, 2.8], rhs: 200 },
  ],
  tailLevels: [0.9, 0.95, 0.99, 0.999],
  scenarioEpsilon: 0.05,
  scenarioBeta: 0.05,
  scenarioDraws: 240,
  scenarioSeed: 'scenario-1',
  runScenarioApproximation: false,
  annealIterations: 20000,
  annealInitialTemperature: 40,
  annealCoolingRate: 0.9995,
  annealStep: 4,
  annealSeed: 'anneal-1',
  runAnnealing: false,
};

/* ------------------------------------------------------------------ helpers */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    // EngineError messages say what is missing; they are surfaced unchanged.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Equicorrelation covariance from per-variable standard deviations. */
function covarianceOf(row: ChanceRowConfig): number[][] {
  return row.sd.map((si, i) => row.sd.map((sj, j) => (i === j ? si * si : row.correlation * si * sj)));
}

function toSpec(row: ChanceRowConfig): GaussianChanceSpec {
  return { name: row.name, meanCoef: row.meanCoef, covariance: covarianceOf(row), rhs: row.rhs, reliability: row.reliability };
}

/** An engine Provenance shown through the standard explanation panel. */
function asExplanation(p: Provenance, formula?: string): Explanation {
  return { exactness: p.exactness, method: p.method, formula, steps: [], assumptions: p.assumedInputs, limitations: p.limitations };
}

/** Budget on rows in the sampled program; see `maxScenarioDraws`. */
const SCENARIO_MAX_SAMPLED_ROWS = 1600;

const SENSE_OPTIONS: { value: RowSense; label: string }[] = [
  { value: '<=', label: 'at most (≤)' },
  { value: '>=', label: 'at least (≥)' },
  { value: '=', label: 'exactly (=)' },
];

/* --------------------------------------------------------------------- tool */

export function StochasticOptimisationTool({ config }: { config: StochasticOptimisationConfig }) {
  const app = useApp();
  const set = (patch: Partial<StochasticOptimisationConfig>) => app.updateConfig({ ...config, ...patch });
  const n = config.variableNames.length;

  /* ---------------------------------------------------------- input checks */

  const issues = useMemo(() => {
    const out: string[] = [];
    if (n < 1) out.push('The program needs at least one decision variable.');
    if (config.objective.length !== n) out.push(`The objective has ${config.objective.length} coefficients but there are ${n} variables.`);
    if (config.chanceRows.length === 0) out.push('There are no uncertain rows, so there is no chance constraint to impose. Add one, or use a deterministic optimiser instead.');
    config.chanceRows.forEach((r) => {
      if (r.meanCoef.length !== n || r.sd.length !== n) out.push(`Uncertain row "${r.name}" does not have one mean coefficient and one standard deviation per variable.`);
      if (r.sd.some((s) => !(s > 0))) out.push(`Uncertain row "${r.name}" has a standard deviation that is not positive. A row with no uncertainty is a deterministic row; move it there.`);
      const limit = n > 1 ? -1 / (n - 1) : -1;
      if (!(r.correlation > limit && r.correlation < 1)) {
        out.push(`The correlation of uncertain row "${r.name}" is ${r.correlation}. An equicorrelation matrix over ${n} variables is a covariance only for values strictly inside (${limit.toPrecision(3)}, 1).`);
      }
    });
    const pSum = config.lossScenarios.reduce((a, s) => a + s.probability, 0);
    if (config.lossScenarios.length > 0 && Math.abs(pSum - 1) > 1e-9) out.push(`The loss-scenario probabilities sum to ${pSum.toPrecision(10)}, not 1. The CVaR route needs a probability distribution over the scenarios.`);
    return out;
  }, [config.objective, config.chanceRows, config.lossScenarios, n]);

  const lp = useMemo<LpProblem>(
    () => ({
      sense: config.sense,
      objective: config.objective,
      rows: config.rows.map((r) => ({ coef: r.coef, sense: r.sense, rhs: r.rhs, name: r.name })),
      lower: new Array<number>(n).fill(0),
      upper: config.upperBounds.slice(0, n),
      names: config.variableNames,
    }),
    [config.sense, config.objective, config.rows, config.upperBounds, config.variableNames, n],
  );

  const specs = useMemo(() => config.chanceRows.map(toSpec), [config.chanceRows]);

  /*
   * The sampled program has one row per draw per uncertain row and is solved
   * synchronously. Measured in a browser, 2,000 draws over the two default
   * uncertain rows (4,000 sampled rows) held the main thread for 2.4 s, while
   * 1,600 sampled rows stayed under 0.4 s. The field maximum is therefore a
   * budget on sampled rows rather than on draws, so adding uncertain rows
   * cannot walk past it.
   */
  const maxScenarioDraws = Math.max(1, Math.floor(SCENARIO_MAX_SAMPLED_ROWS / Math.max(1, config.chanceRows.length)));
  const blocked = issues.length > 0;

  /* ----------------------------------------- 1. individual chance constraints */

  const individual = useMemo(() => (blocked ? null : attempt(() => solveGaussianChanceLp(lp, specs))), [blocked, lp, specs]);

  /* --------------------------------------------- 2. joint, via Bonferroni */

  const joint = useMemo(
    () =>
      blocked
        ? null
        : attempt(() =>
            solveJointChanceBonferroni(
              lp,
              specs.map(({ name, meanCoef, covariance, rhs }) => ({ name, meanCoef, covariance, rhs })),
              config.jointReliability,
            ),
          ),
    [blocked, lp, specs, config.jointReliability],
  );

  /**
   * The realised joint probability of the Bonferroni decision, measured rather
   * than asserted. This is what makes the conservatism a number: the bound
   * guarantees `jointReliability`, the measurement says what was actually
   * bought.
   */
  const measured = useMemo(
    () =>
      joint?.ok
        ? attempt(() =>
            jointSatisfactionProbability(
              joint.value.solution.x,
              specs.map(({ name, meanCoef, covariance, rhs }) => ({ name, meanCoef, covariance, rhs })),
              { seed: config.measureSeed, draws: config.measureDraws },
            ),
          )
        : null,
    [joint, specs, config.measureSeed, config.measureDraws],
  );

  /* --------------------------------------------------- 3. CVaR constrained */

  const lossScenarios = useMemo<LossScenario[]>(
    () => config.lossScenarios.map((s) => ({ name: s.name, probability: s.probability, coef: s.coef, rhs: s.rhs })),
    [config.lossScenarios],
  );

  const cvar = useMemo(
    () => (blocked || lossScenarios.length === 0 ? null : attempt(() => solveCvarConstrainedLp(lp, lossScenarios, config.cvarLevel, { bound: config.cvarBound }))),
    [blocked, lp, lossScenarios, config.cvarLevel, config.cvarBound],
  );

  /**
   * VaR and CVaR of the same loss evaluated at the CHANCE-constrained decision,
   * so the two routes are compared on one scale. VaR is a threshold and CVaR is
   * the average beyond it; they are never merged into one figure.
   */
  const chanceTail = useMemo(() => {
    if (!individual?.ok || lossScenarios.length === 0) return null;
    return attempt(() => {
      const x = individual.value.solution.x;
      const losses = lossScenarios.map((s) => s.coef.reduce((a, c, j) => a + c * x[j], 0) - s.rhs);
      const probs = lossScenarios.map((s) => s.probability);
      return {
        varAtLevel: discreteVar(losses, probs, config.cvarLevel),
        cvarAtLevel: discreteCvar(losses, probs, config.cvarLevel),
        losses,
      };
    });
  }, [individual, lossScenarios, config.cvarLevel]);

  /* ---------------------------------------------------- 4. tail sensitivity */

  const tail = useMemo(() => config.tailLevels.map((level) => ({ level, result: attempt(() => tailSensitivity(level)) })), [config.tailLevels]);

  /* -------------------------------------- 5. scenario approximation (gated) */

  const requiredDraws = useMemo(() => attempt(() => calafioreCampiSampleSize(config.scenarioEpsilon, config.scenarioBeta, Math.max(1, n))), [config.scenarioEpsilon, config.scenarioBeta, n]);

  const scenario = useMemo(() => {
    if (blocked || !config.runScenarioApproximation) return null;
    return attempt(() => {
      const factors = specs.map((s) => requirePositiveDefinite(s.covariance, n, `The covariance of "${s.name}"`));
      const rng = new Random(config.scenarioSeed);
      const sampled: LpRow[][] = [];
      // Clamped, so a stored configuration from before the budget — or a value
      // typed past the field maximum — cannot build a program that freezes the
      // page. The field states the cap.
      const draws = Math.max(1, Math.min(maxScenarioDraws, Math.round(config.scenarioDraws)));
      for (let d = 0; d < draws; d++) {
        const rows: LpRow[] = specs.map((s, i) => {
          const z = Array.from({ length: n }, () => rng.normal());
          const coef = s.meanCoef.map((a, j) => {
            let v = a;
            for (let k = 0; k <= j; k++) v += factors[i][j][k] * z[k];
            return v;
          });
          return { coef, sense: '<=' as RowSense, rhs: s.rhs, name: s.name };
        });
        sampled.push(rows);
      }
      return solveScenarioApproximation(lp, sampled, { epsilon: config.scenarioEpsilon, beta: config.scenarioBeta });
    });
  }, [blocked, config.runScenarioApproximation, config.scenarioDraws, config.scenarioSeed, config.scenarioEpsilon, config.scenarioBeta, specs, lp, n, maxScenarioDraws]);

  /* ---------------------------------------- 6. simulated annealing (gated) */

  const annealing = useMemo(() => {
    if (blocked || !config.runAnnealing) return null;
    return attempt(() => {
      const constraints = specs.map((s) => gaussianChanceConstraint(s, n));
      const upper = config.upperBounds.slice(0, n);
      const feasible = (x: number[]) => {
        for (const r of config.rows) {
          const lhs = r.coef.reduce((a, c, j) => a + c * x[j], 0);
          if (r.sense === '<=' && lhs > r.rhs + 1e-9) return false;
          if (r.sense === '>=' && lhs < r.rhs - 1e-9) return false;
          if (r.sense === '=' && Math.abs(lhs - r.rhs) > 1e-9) return false;
        }
        return constraints.every((c) => c.value(x) <= 1e-9);
      };
      const sign = config.sense === 'max' ? -1 : 1;
      const result = simulatedAnnealing<number[]>({
        initial: new Array<number>(n).fill(0),
        // Infeasible states have undefined energy and are rejected, not penalised
        // into a plausible-looking number.
        energy: (x) => (feasible(x) ? sign * config.objective.reduce((a, c, j) => a + c * x[j], 0) : Infinity),
        neighbour: (x, rng) => {
          const next = [...x];
          const j = Math.floor(rng.uniform() * n) % n;
          next[j] = Math.min(upper[j] ?? Infinity, Math.max(0, next[j] + rng.normal() * config.annealStep));
          return next;
        },
        iterations: config.annealIterations,
        initialTemperature: config.annealInitialTemperature,
        coolingRate: config.annealCoolingRate,
        seed: config.annealSeed,
      });
      return { result, objective: sign * result.bestEnergy };
    });
  }, [blocked, config.runAnnealing, config.rows, config.objective, config.sense, config.upperBounds, config.annealIterations, config.annealInitialTemperature, config.annealCoolingRate, config.annealStep, config.annealSeed, specs, n]);

  /* ---------------------------------------------------------------- charts */

  const decisionBars = useMemo(() => {
    if (!individual?.ok) return [];
    return config.variableNames.map((label, j) => ({
      x: j + 1,
      y: individual.value.solution.x[j] ?? 0,
      label,
      compare: cvar?.ok ? cvar.value.x[j] : undefined,
    }));
  }, [individual, cvar, config.variableNames]);

  const tailSeries = useMemo(() => {
    const ok = tail.filter((t) => t.result.ok) as { level: number; result: { ok: true; value: ReturnType<typeof tailSensitivity> } }[];
    if (ok.length < 2) return [];
    return [
      { label: 'Gaussian', points: ok.map((t) => ({ x: t.level, y: t.result.value.gaussian })) },
      { label: 'Laplace, same variance', points: ok.map((t) => ({ x: t.level, y: t.result.value.laplace })), dashed: true },
      { label: 'Logistic, same variance', points: ok.map((t) => ({ x: t.level, y: t.result.value.logistic })), dashed: true },
    ];
  }, [tail]);

  const annealSeries = useMemo(() => {
    if (!annealing?.ok) return [];
    const history = annealing.value.result.history;
    const sign = config.sense === 'max' ? -1 : 1;
    const stride = Math.max(1, Math.floor(history.length / 600));
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < history.length; i += stride) {
      if (Number.isFinite(history[i])) points.push({ x: i + 1, y: sign * history[i] });
    }
    return points.length > 1 ? [{ label: 'Best objective found so far', points }] : [];
  }, [annealing, config.sense]);

  /* ------------------------------------------------------------------ view */

  return (
    <>
      <ToolHeader toolId="stochastic-optimisation" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What this screen decides">
            <p className="oc-field__hint" style={{ marginTop: 0 }}>
              A linear program in which some constraint coefficients are not known. A chance constraint requires a row to hold with a stated probability
              instead of always. The four routes below are not interchangeable, and the results column shows what each one actually guarantees.
            </p>
            <Segmented
              label="Leading route"
              value={config.route}
              onChange={(route) => set({ route })}
              options={[
                { value: 'individual', label: 'Row by row' },
                { value: 'joint', label: 'All rows together' },
              ]}
            />
          </Card>

          <Card title="Objective">
            <Segmented
              label="Direction"
              value={config.sense}
              onChange={(sense) => set({ sense })}
              options={[
                { value: 'max', label: 'Maximise' },
                { value: 'min', label: 'Minimise' },
              ]}
            />
            {config.variableNames.map((name, j) => (
              <div key={j} className="oc-field">
                <TextField label={`Variable ${j + 1} name`} value={name} onChange={(v) => set({ variableNames: config.variableNames.map((s, k) => (k === j ? v : s)) })} maxLength={32} />
                <NumberField
                  label={`Objective coefficient for ${name}`}
                  value={config.objective[j] ?? 0}
                  onChange={(v) => set({ objective: config.objective.map((c, k) => (k === j ? v : c)) })}
                />
                <NumberField
                  label={`Upper bound on ${name}`}
                  value={config.upperBounds[j] ?? 0}
                  onChange={(v) => set({ upperBounds: config.upperBounds.map((c, k) => (k === j ? v : c)) })}
                  min={0}
                />
              </div>
            ))}
            <p className="oc-field__hint">
              Every variable is bounded below by zero. A finite upper bound is required by the cutting-plane solve: without one the program can be unbounded,
              which is reported as such rather than returned as a number.
            </p>
          </Card>

          <Card title="Rows that always hold">
            {config.rows.map((row, i) => (
              <Card key={i} variant="inset" title={row.name}>
                <TextField label="Row name" value={row.name} onChange={(name) => set({ rows: config.rows.map((r, k) => (k === i ? { ...r, name } : r)) })} maxLength={32} />
                {config.variableNames.map((name, j) => (
                  <NumberField
                    key={j}
                    label={`Coefficient on ${name}`}
                    value={row.coef[j] ?? 0}
                    onChange={(v) => set({ rows: config.rows.map((r, k) => (k === i ? { ...r, coef: r.coef.map((c, q) => (q === j ? v : c)) } : r)) })}
                  />
                ))}
                <SelectField label="Sense" value={row.sense} onChange={(sense) => set({ rows: config.rows.map((r, k) => (k === i ? { ...r, sense } : r)) })} options={SENSE_OPTIONS} />
                <NumberField label="Right-hand side" value={row.rhs} onChange={(rhs) => set({ rows: config.rows.map((r, k) => (k === i ? { ...r, rhs } : r)) })} />
                <div className="oc-btn-row">
                  <Button icon="trash" onClick={() => set({ rows: config.rows.filter((_, k) => k !== i) })}>
                    Remove this row
                  </Button>
                </div>
              </Card>
            ))}
            <div className="oc-btn-row">
              <Button
                icon="plus"
                disabled={config.rows.length >= 8}
                onClick={() => set({ rows: [...config.rows, { name: `Row ${config.rows.length + 1}`, coef: new Array<number>(n).fill(1), sense: '<=', rhs: 100 }] })}
              >
                Add a deterministic row
              </Button>
            </div>
          </Card>

          <Card title="Rows with uncertain coefficients">
            <p className="oc-field__hint" style={{ marginTop: 0 }}>
              Each row&rsquo;s coefficient vector is taken to be multivariate Gaussian with the mean and standard deviations given here. The correlation applies
              between every pair of coefficients in that row; it is an input, not a default of zero, because independence is an assumption like any other.
            </p>
            {config.chanceRows.map((row, i) => (
              <Card key={i} variant="inset" title={row.name}>
                <TextField label="Row name" value={row.name} onChange={(name) => set({ chanceRows: config.chanceRows.map((r, k) => (k === i ? { ...r, name } : r)) })} maxLength={32} />
                {config.variableNames.map((name, j) => (
                  <div key={j} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-end' }}>
                    <NumberField
                      label={`Mean coefficient on ${name}`}
                      value={row.meanCoef[j] ?? 0}
                      onChange={(v) => set({ chanceRows: config.chanceRows.map((r, k) => (k === i ? { ...r, meanCoef: r.meanCoef.map((c, q) => (q === j ? v : c)) } : r)) })}
                    />
                    <NumberField
                      label={`Standard deviation`}
                      value={row.sd[j] ?? 0}
                      onChange={(v) => set({ chanceRows: config.chanceRows.map((r, k) => (k === i ? { ...r, sd: r.sd.map((c, q) => (q === j ? v : c)) } : r)) })}
                      min={0}
                      step={0.05}
                    />
                  </div>
                ))}
                <SliderField
                  label="Correlation between the coefficients of this row"
                  value={row.correlation}
                  onChange={(correlation) => set({ chanceRows: config.chanceRows.map((r, k) => (k === i ? { ...r, correlation } : r)) })}
                  min={-0.4}
                  max={0.95}
                  step={0.05}
                />
                <NumberField label="Right-hand side" value={row.rhs} onChange={(rhs) => set({ chanceRows: config.chanceRows.map((r, k) => (k === i ? { ...r, rhs } : r)) })} />
                <ProbabilityField
                  label="Required probability that this row holds"
                  value={row.reliability}
                  onChange={(reliability) => set({ chanceRows: config.chanceRows.map((r, k) => (k === i ? { ...r, reliability } : r)) })}
                />
                <div className="oc-btn-row">
                  <Button icon="trash" onClick={() => set({ chanceRows: config.chanceRows.filter((_, k) => k !== i) })}>
                    Remove this row
                  </Button>
                </div>
              </Card>
            ))}
            <div className="oc-btn-row">
              <Button
                icon="plus"
                disabled={config.chanceRows.length >= 6}
                onClick={() =>
                  set({
                    chanceRows: [
                      ...config.chanceRows,
                      { name: `Uncertain row ${config.chanceRows.length + 1}`, meanCoef: new Array<number>(n).fill(1), sd: new Array<number>(n).fill(0.2), correlation: 0.2, rhs: 100, reliability: 0.95 },
                    ],
                  })
                }
              >
                Add an uncertain row
              </Button>
            </div>
            <ProbabilityField
              label="Required probability that ALL uncertain rows hold together"
              value={config.jointReliability}
              onChange={(jointReliability) => set({ jointReliability })}
              hint="Imposed by the Bonferroni split, which is conservative: it allocates the shortfall equally across rows and guarantees at least this level, usually delivering more."
            />
            <NumberField label="Draws used to measure the realised joint probability" value={config.measureDraws} onChange={(measureDraws) => set({ measureDraws })} min={100} max={100000} integer />
            <TextField label="Seed for that measurement" value={config.measureSeed} onChange={(measureSeed) => set({ measureSeed })} maxLength={32} />
          </Card>

          <Card title="The CVaR route">
            <p className="oc-field__hint" style={{ marginTop: 0 }}>
              A discrete model of one loss, loss = coefᵀx − right-hand side, required to hold in the average of its worst tail rather than with a probability.
              This is a strictly stronger requirement than the chance constraint above and generally costs more objective value.
            </p>
            <ProbabilityField label="CVaR level" value={config.cvarLevel} onChange={(cvarLevel) => set({ cvarLevel })} />
            <NumberField label="Bound the CVaR must stay within" value={config.cvarBound} onChange={(cvarBound) => set({ cvarBound })} />
            {config.lossScenarios.map((s, i) => (
              <Card key={i} variant="inset" title={s.name}>
                <TextField label="Scenario name" value={s.name} onChange={(name) => set({ lossScenarios: config.lossScenarios.map((r, k) => (k === i ? { ...r, name } : r)) })} maxLength={32} />
                <ProbabilityField label="Probability" value={s.probability} onChange={(probability) => set({ lossScenarios: config.lossScenarios.map((r, k) => (k === i ? { ...r, probability } : r)) })} />
                {config.variableNames.map((name, j) => (
                  <NumberField
                    key={j}
                    label={`Loss coefficient on ${name}`}
                    value={s.coef[j] ?? 0}
                    onChange={(v) => set({ lossScenarios: config.lossScenarios.map((r, k) => (k === i ? { ...r, coef: r.coef.map((c, q) => (q === j ? v : c)) } : r)) })}
                  />
                ))}
                <NumberField label="Right-hand side" value={s.rhs} onChange={(rhs) => set({ lossScenarios: config.lossScenarios.map((r, k) => (k === i ? { ...r, rhs } : r)) })} />
                <div className="oc-btn-row">
                  <Button icon="trash" onClick={() => set({ lossScenarios: config.lossScenarios.filter((_, k) => k !== i) })}>
                    Remove this scenario
                  </Button>
                </div>
              </Card>
            ))}
            <div className="oc-btn-row">
              <Button
                icon="plus"
                disabled={config.lossScenarios.length >= 12}
                onClick={() => set({ lossScenarios: [...config.lossScenarios, { name: `Scenario ${config.lossScenarios.length + 1}`, probability: 0, coef: new Array<number>(n).fill(1), rhs: 100 }] })}
              >
                Add a loss scenario
              </Button>
            </div>
          </Card>

          <Card title="The scenario approximation" hint="Distribution-free, and expensive.">
            <NumberField label="Violation level ε" value={config.scenarioEpsilon} onChange={(scenarioEpsilon) => set({ scenarioEpsilon })} min={0.001} max={0.5} step={0.005} />
            <NumberField label="Confidence parameter β" value={config.scenarioBeta} onChange={(scenarioBeta) => set({ scenarioBeta })} min={0.001} max={0.5} step={0.005} />
            <NumberField
              label="Sampled constraint sets to enforce"
              value={config.scenarioDraws}
              onChange={(scenarioDraws) => set({ scenarioDraws })}
              min={1}
              max={maxScenarioDraws}
              integer
              hint={`Each draw adds one row per uncertain row, and the whole thing is solved as one linear program on this thread. Capped at ${maxScenarioDraws.toLocaleString('en-US')} for the ${Math.max(1, config.chanceRows.length)} uncertain row(s) here, which keeps the sampled program at ${SCENARIO_MAX_SAMPLED_ROWS.toLocaleString('en-US')} rows or fewer; 2,000 draws built a ${(2000 * Math.max(1, config.chanceRows.length)).toLocaleString('en-US')}-row program and held the page for 2.4 seconds.`}
            />
            <TextField label="Sampling seed" value={config.scenarioSeed} onChange={(scenarioSeed) => set({ scenarioSeed })} maxLength={32} />
            <p className="oc-field__hint">
              {requiredDraws.ok
                ? `The Calafiore–Campi requirement for these settings and ${n} variables is ${requiredDraws.value.toLocaleString('en-US')} draws. Fewer draws still give a solution, but no confidence statement about its violation probability.`
                : requiredDraws.error}
            </p>
            {!config.runScenarioApproximation ? (
              <>
                <Notice tone="info" title="The scenario program is not solved automatically">
                  <p style={{ marginTop: 0 }}>
                    It adds one row per sampled constraint set per uncertain row — {(Math.max(1, Math.min(maxScenarioDraws, Math.round(config.scenarioDraws))) * Math.max(1, config.chanceRows.length)).toLocaleString('en-US')} extra rows
                    for the current settings — and solves the whole thing as one linear program. That takes long enough to make the page unresponsive while it
                    runs, so it is solved only when you ask for it.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={blocked} onClick={() => set({ runScenarioApproximation: true })}>
                    Solve the scenario program
                  </Button>
                </div>
              </>
            ) : (
              <div className="oc-btn-row">
                <Button icon="x" onClick={() => set({ runScenarioApproximation: false })}>
                  Stop solving it on every change
                </Button>
              </div>
            )}
          </Card>

          <Card title="Heuristic search, for comparison" hint="No optimality guarantee of any kind.">
            <NumberField label="Iterations" value={config.annealIterations} onChange={(annealIterations) => set({ annealIterations })} min={1} max={200000} integer />
            <NumberField label="Initial temperature" value={config.annealInitialTemperature} onChange={(annealInitialTemperature) => set({ annealInitialTemperature })} min={0.0001} />
            <NumberField label="Geometric cooling factor" value={config.annealCoolingRate} onChange={(annealCoolingRate) => set({ annealCoolingRate })} min={0.5} max={0.99999} step={0.0001} />
            <NumberField label="Neighbourhood step size" value={config.annealStep} onChange={(annealStep) => set({ annealStep })} min={0.01} />
            <TextField label="Seed" value={config.annealSeed} onChange={(annealSeed) => set({ annealSeed })} maxLength={32} />
            {!config.runAnnealing ? (
              <>
                <Notice tone="info" title="The heuristic search is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    {config.annealIterations.toLocaleString('en-US')} iterations means that many objective and constraint evaluations on this thread, which
                    would block the page. It exists only to show how far a general-purpose heuristic falls short of the exact reformulation on a problem the
                    reformulation can actually solve.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={blocked} onClick={() => set({ runAnnealing: true })}>
                    Run the heuristic search
                  </Button>
                </div>
              </>
            ) : (
              <div className="oc-btn-row">
                <Button icon="x" onClick={() => set({ runAnnealing: false })}>
                  Stop running it on every change
                </Button>
              </div>
            )}
          </Card>

          <AiAssistPanel
            capability="explainUncertainty"
            context="Each route below states what it guarantees: the Gaussian reformulation is exact for its assumption, the Bonferroni joint solution is a lower bound, the scenario program is distribution-free, and the CVaR solution answers a stronger question than a probability."
          />
        </div>

        <div className="oc-stack">
          {issues.length > 0 && <Notice tone="error" title="The program is not fully specified" items={issues} />}

          {/* ------------------------------------------------ row by row */}
          {!blocked && individual && (
            <Card title="Each uncertain row held on its own">
              {!individual.ok ? (
                <Notice tone="error" title="No solution was returned">
                  <p style={{ margin: 0 }}>{individual.error}</p>
                </Notice>
              ) : (
                <>
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">{config.sense === 'max' ? 'Best objective value' : 'Lowest objective value'}</span>
                    <span className="oc-result-hero__value">{formatValue(individual.value.solution.objective)}</span>
                    <span className="oc-result-hero__detail">
                      <Badge variant={individual.value.provenance.exactness}>{EXACTNESS_LABEL[individual.value.provenance.exactness]}</Badge>{' '}
                      {individual.value.solution.cuts} cutting planes, largest remaining constraint residual{' '}
                      {individual.value.solution.maxViolation.toExponential(2)}
                    </span>
                  </div>
                  <KeyValueList items={config.variableNames.map((name, j) => ({ label: name, value: formatValue(individual.value.solution.x[j] ?? 0, 5) }))} />
                  <DataTable
                    caption="Each uncertain row at this decision"
                    columns={[
                      { key: 'name', header: 'Row', render: (r) => r.name },
                      { key: 'req', header: 'Required', numeric: true, render: (r) => formatPercent(r.required, 4) },
                      { key: 'mean', header: 'Mean of the left-hand side', numeric: true, render: (r) => formatValue(r.mean, 5) },
                      { key: 'sd', header: 'Standard deviation', numeric: true, render: (r) => formatValue(r.sd, 4) },
                      { key: 'z', header: 'Safety margin (sd)', numeric: true, render: (r) => formatValue(r.safetyCoefficient, 4) },
                      { key: 'slack', header: 'Slack', numeric: true, render: (r) => formatValue(r.slack, 4) },
                      { key: 'ach', header: 'Probability it holds', numeric: true, render: (r) => formatPercent(r.achieved, 5) },
                    ]}
                    rows={individual.value.constraints}
                  />
                  <Notice tone="warning" title="These are individual statements, not a joint one">
                    <p style={{ margin: 0 }}>
                      {config.chanceRows.length} rows each holding with probability {formatPercent(config.chanceRows[0]?.reliability ?? 0, 4)} may hold together
                      with probability as low as{' '}
                      {formatPercent(Math.max(0, 1 - config.chanceRows.reduce((a, r) => a + (1 - r.reliability), 0)), 4)}. Nothing here pins the dependence
                      between the rows down, so that is a bound and not an estimate.
                    </p>
                  </Notice>
                  <ExplanationPanel
                    explanation={asExplanation(individual.value.provenance, 'P(aᵀx ≤ b) ≥ 1 − ε  ⟺  āᵀx + z₁₋ε·√(xᵀΣx) ≤ b')}
                    defaultOpen={config.route === 'individual'}
                  />
                </>
              )}
            </Card>
          )}

          {decisionBars.length > 0 && (
            <Card>
              <BarChart
                title="The decision under each requirement"
                description="Quantity of each variable at the chance-constrained solution, beside the CVaR-constrained solution where one exists."
                data={decisionBars}
                xLabel="Variable"
                yLabel="Quantity"
                seriesLabel="Chance constrained"
                compareLabel="CVaR constrained"
                note="The CVaR requirement is stronger, so its decision is normally the more cautious of the two and its objective value worse."
              />
            </Card>
          )}

          {/* ------------------------------------------------ joint */}
          {!blocked && joint && (
            <Card title="All uncertain rows held together">
              {!joint.ok ? (
                <Notice tone="error" title="No joint solution was returned">
                  <p style={{ margin: 0 }}>{joint.error}</p>
                </Notice>
              ) : (
                <>
                  <Notice tone="warning" title="This is a conservative solution, not the exact joint optimum">
                    <p style={{ marginTop: 0 }}>
                      The Bonferroni split allocates the shortfall ε = {formatValue(1 - config.jointReliability, 4)} equally across{' '}
                      {config.chanceRows.length} rows and holds each at {formatPercent(joint.value.perRowLevel, 5)}. That GUARANTEES a joint probability of at
                      least {formatPercent(joint.value.guaranteedJoint, 4)}; it is not the joint probability itself. The bound is tight only when the rows never
                      fail at the same time, which is the worst possible dependence rather than a typical one.
                    </p>
                    <p style={{ marginBottom: 0 }}>The gap between the guarantee and what the decision actually achieves is objective value given away.</p>
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Objective value', value: formatValue(joint.value.solution.objective) },
                      { label: 'Required jointly', value: formatPercent(joint.value.jointRequired, 4) },
                      { label: 'Per-row level allocated', value: formatPercent(joint.value.perRowLevel, 5) },
                      { label: 'Guaranteed jointly (lower bound)', value: `at least ${formatPercent(joint.value.guaranteedJoint, 4)}` },
                      {
                        label: 'Measured jointly (Monte Carlo)',
                        value: !measured
                          ? 'not measured'
                          : measured.ok
                            ? `${formatPercent(measured.value.probability, 4)} ± ${formatPercent(measured.value.standardError * 1.96, 3)} from ${measured.value.draws.toLocaleString('en-US')} draws`
                            : measured.error,
                      },
                      {
                        label: 'Cost of the joint requirement',
                        value: individual?.ok ? formatValue(joint.value.solution.objective - individual.value.solution.objective, 5) : 'row-by-row solve unavailable',
                      },
                    ]}
                  />
                  {measured?.ok && (
                    <>
                      <DataTable
                        caption="Realised probability per row at the joint decision"
                        columns={[
                          { key: 'n', header: 'Row', render: (r) => r.name },
                          { key: 'p', header: 'Measured probability it holds', numeric: true, render: (r) => formatPercent(r.p, 5) },
                        ]}
                        rows={config.chanceRows.map((r, i) => ({ name: r.name, p: measured.value.perRow[i] ?? 0 }))}
                      />
                      <p className="oc-chart-note">
                        The measured joint figure is an empirical estimate from {measured.value.draws.toLocaleString('en-US')} draws of the assumed Gaussian
                        model, with the interval shown next to it. It is a property of the model, not independent evidence that the model is right.
                      </p>
                    </>
                  )}
                  <ExplanationPanel explanation={asExplanation(joint.value.provenance, 'P(all rows hold) ≥ 1 − Σ P(row i fails)')} defaultOpen={config.route === 'joint'} />
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------------ CVaR */}
          {!blocked && cvar && (
            <Card title="The CVaR-constrained solution">
              {!cvar.ok ? (
                <Notice tone="error" title="No CVaR-constrained solution was returned">
                  <p style={{ margin: 0 }}>{cvar.error}</p>
                </Notice>
              ) : (
                <>
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Objective value under the CVaR requirement</span>
                    <span className="oc-result-hero__value">{formatValue(cvar.value.objective)}</span>
                    <span className="oc-result-hero__detail">
                      <Badge variant={cvar.value.provenance.exactness}>{EXACTNESS_LABEL[cvar.value.provenance.exactness]}</Badge> Rockafellar–Uryasev linear
                      reformulation over {config.lossScenarios.length} loss scenarios
                    </span>
                  </div>
                  <DataTable
                    caption="Value at Risk and Conditional Value at Risk of the loss, at each solution"
                    columns={[
                      { key: 'k', header: 'Decision', render: (r) => r.k },
                      { key: 'v', header: `VaR at ${formatPercent(config.cvarLevel, 4)}`, numeric: true, render: (r) => r.v },
                      { key: 'c', header: `CVaR at ${formatPercent(config.cvarLevel, 4)}`, numeric: true, render: (r) => r.c },
                    ]}
                    rows={[
                      { k: 'CVaR constrained', v: formatValue(cvar.value.varAtLevel, 5), c: formatValue(cvar.value.cvarAtLevel, 5) },
                      {
                        k: 'Chance constrained',
                        v: chanceTail?.ok ? formatValue(chanceTail.value.varAtLevel, 5) : chanceTail ? chanceTail.error : 'unavailable',
                        c: chanceTail?.ok ? formatValue(chanceTail.value.cvarAtLevel, 5) : chanceTail ? chanceTail.error : 'unavailable',
                      },
                    ]}
                  />
                  <Notice tone="info" title="VaR and CVaR are different statements">
                    <p style={{ marginTop: 0 }}>
                      <strong>Value at Risk</strong> at {formatPercent(config.cvarLevel, 4)} is the loss that is not exceeded in that fraction of scenarios. It
                      is a threshold and says nothing about how far beyond it the loss can go.
                    </p>
                    <p style={{ margin: 'var(--s2) 0 0' }}>
                      <strong>Conditional Value at Risk</strong> is the average loss in exactly the worst 1 − {formatPercent(config.cvarLevel, 4)} of cases. It
                      is always at least as large as VaR, and constraining it to {formatValue(config.cvarBound, 4)} forces the probability that the loss stays
                      within that bound to be at least {formatPercent(config.cvarLevel, 4)} — the implication runs one way only.
                    </p>
                    <p style={{ marginBottom: 0 }}>
                      Probability the loss stays within the bound at this solution: {formatPercent(cvar.value.satisfactionProbability, 5)}.
                    </p>
                  </Notice>
                  <ExplanationPanel explanation={asExplanation(cvar.value.provenance, 'CVaR_α(L) = min_t { t + E[(L − t)⁺] / (1 − α) }')} />
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------------ tail sensitivity */}
          <Card title="How much of the safety margin is the Gaussian assumption">
            <DataTable
              caption="Required margin in standard deviations under three laws of identical variance"
              columns={[
                { key: 'l', header: 'Reliability', numeric: true, render: (r) => formatPercent(r.level, 5) },
                { key: 'g', header: 'Gaussian', numeric: true, render: (r) => r.g },
                { key: 'la', header: 'Laplace', numeric: true, render: (r) => r.la },
                { key: 'lo', header: 'Logistic', numeric: true, render: (r) => r.lo },
                { key: 'w', header: 'Worst / Gaussian', numeric: true, render: (r) => r.w },
              ]}
              rows={tail.map((t) => ({
                level: t.level,
                g: t.result.ok ? formatValue(t.result.value.gaussian, 4) : t.result.error,
                la: t.result.ok ? formatValue(t.result.value.laplace, 4) : '—',
                lo: t.result.ok ? formatValue(t.result.value.logistic, 4) : '—',
                w: t.result.ok ? formatValue(t.result.value.worstRatio, 4) : '—',
              }))}
            />
            {tailSeries.length > 0 && (
              <LineChart
                title="Safety margin against reliability"
                description="The margin a chance constraint demands, in standard deviations, under three distributions with the same mean and variance."
                series={tailSeries}
                xLabel="Required reliability"
                yLabel="Margin (standard deviations)"
                note="Only the tail shape differs between these curves. The gap between them at a high reliability is the part of the margin that comes from the distributional assumption rather than from the data."
              />
            )}
            {tail.map((t, i) => (t.result.ok ? <p className="oc-chart-note" key={i}>{t.result.value.message}</p> : null))}
          </Card>

          {/* ------------------------------------------------ scenario program */}
          {config.runScenarioApproximation && (
            <Card title="The scenario approximation">
              {!scenario ? (
                <Notice tone="info">The program is not fully specified, so the scenario program was not solved.</Notice>
              ) : !scenario.ok ? (
                <Notice tone="error" title="The scenario program did not solve">
                  <p style={{ margin: 0 }}>{scenario.error}</p>
                </Notice>
              ) : (
                <>
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Objective value with every sampled row enforced</span>
                    <span className="oc-result-hero__value">{formatValue(scenario.value.solution.objective)}</span>
                    <span className="oc-result-hero__detail">
                      <Badge variant={scenario.value.provenance.exactness}>{EXACTNESS_LABEL[scenario.value.provenance.exactness]}</Badge>{' '}
                      {scenario.value.draws.toLocaleString('en-US')} draws enforced, {scenario.value.solution.iterations.toLocaleString('en-US')} simplex
                      iterations
                    </span>
                  </div>
                  <Notice
                    tone={scenario.value.guaranteeHolds ? 'success' : 'warning'}
                    title={
                      scenario.value.guaranteeHolds
                        ? `The Calafiore–Campi guarantee holds at ε = ${scenario.value.epsilon}, β = ${scenario.value.beta}`
                        : `Too few draws for any guarantee: ${scenario.value.draws} given, ${scenario.value.requiredDraws} needed`
                    }
                  >
                    <p style={{ margin: 0 }}>
                      {scenario.value.guaranteeHolds
                        ? `The solution violates the constraint with probability at most ${scenario.value.epsilon} with confidence at least ${1 - scenario.value.beta}, whatever the distribution of the coefficients actually is.`
                        : 'The solution is feasible for the sample that was drawn, and nothing follows from that about its violation probability. Raise the number of draws or relax ε.'}
                    </p>
                  </Notice>
                  <KeyValueList items={config.variableNames.map((name, j) => ({ label: name, value: formatValue(scenario.value.solution.x[j] ?? 0, 5) }))} />
                  <ExplanationPanel explanation={asExplanation(scenario.value.provenance, 'N ≥ (2/ε)·(ln(1/β) + d)')} />
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------------ annealing */}
          {config.runAnnealing && (
            <Card title="Heuristic search, for comparison">
              {!annealing ? (
                <Notice tone="info">The program is not fully specified, so the heuristic search was not run.</Notice>
              ) : !annealing.ok ? (
                <Notice tone="error" title="The heuristic search did not run">
                  <p style={{ margin: 0 }}>{annealing.error}</p>
                </Notice>
              ) : (
                <>
                  <KeyValueList
                    items={[
                      { label: 'Best objective found', value: formatValue(annealing.value.objective, 5) },
                      {
                        label: 'Shortfall against the exact reformulation',
                        value: individual?.ok
                          ? formatValue(Math.abs(individual.value.solution.objective - annealing.value.objective), 5)
                          : 'the reformulated solve is unavailable, so there is nothing to compare against',
                      },
                      { label: 'Evaluations', value: annealing.value.result.evaluations.toLocaleString('en-US') },
                      { label: 'Moves accepted', value: `${annealing.value.result.accepted.toLocaleString('en-US')} (${formatPercent(annealing.value.result.accepted / Math.max(1, config.annealIterations), 3)})` },
                    ]}
                  />
                  <Notice tone="warning" title="No optimality guarantee">
                    <p style={{ margin: 0 }}>{annealing.value.result.guarantee.statement}</p>
                  </Notice>
                  {annealSeries.length > 0 && (
                    <LineChart
                      title="Best objective found as the search progressed"
                      description="The best feasible objective value seen so far, against iteration number."
                      series={annealSeries}
                      xLabel="Iteration"
                      yLabel="Objective value"
                      note="A curve still moving at the end means the search was stopped early rather than converged. Two seeds will give two different curves, and the spread between them is the only measure of reliability available here."
                    />
                  )}
                  <ExplanationPanel explanation={asExplanation(annealing.value.result.provenance, 'T_k = T₀ · ρ^k')} />
                </>
              )}
            </Card>
          )}

          {!blocked && (
            <Card title="Which route answers which question" variant="inset">
              <DataTable
                caption="What each route guarantees"
                columns={[
                  { key: 'r', header: 'Route', render: (r) => r.r },
                  { key: 'g', header: 'What it guarantees', render: (r) => r.g },
                ]}
                rows={[
                  { r: 'Row by row, Gaussian', g: 'Each row holds with its stated probability. Exact for the Gaussian assumption and for no other, and says nothing jointly.' },
                  { r: 'Bonferroni joint', g: 'All rows hold together with AT LEAST the stated probability. Conservative; the realised figure is normally higher and the difference is objective value forgone.' },
                  { r: 'Scenario approximation', g: 'Violation probability at most ε with confidence 1 − β, for any coefficient distribution, provided the draws are independent and the sample size is met.' },
                  { r: 'CVaR', g: 'The average loss in the worst tail stays within the bound. Stronger than a probability requirement, and convex where the probability is not.' },
                  { r: 'Simulated annealing', g: 'Nothing. It is here as a comparison against a problem that can be solved properly.' },
                ]}
              />
            </Card>
          )}

        </div>
      </div>
    </>
  );
}
