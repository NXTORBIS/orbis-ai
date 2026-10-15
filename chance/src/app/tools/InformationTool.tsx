/**
 * Information theory and forecast scoring: how much uncertainty a
 * distribution carries, how much one variable tells you about another, and
 * whether stated probabilities were any good.
 *
 * Every number here comes from `src/engine/information`. Three things in this
 * screen are deliberately *not* computed on open — the maximum-entropy Newton
 * solver, the mutual-information permutation test and Blahut–Arimoto — because
 * each one can run long enough to block the first paint. They sit behind
 * buttons with the cost stated, following the pattern in `TimeSeriesTool`.
 */
import { useMemo } from 'react';
import {
  BASE_LABEL,
  binarySymmetricCapacity,
  binarySymmetricChannel,
  brierScore,
  calibration,
  channelCapacity,
  climatologyBrier,
  crpsNormal,
  differentialEntropy,
  distances,
  divergenceBounds,
  estimateEntropy,
  estimateMutualInformation,
  expectedInformationGain,
  fisherInformation,
  jeffreysPrior,
  jensenShannonDivergence,
  klDivergence,
  logScore,
  maximumEntropyClosedForm,
  maximumEntropyDistribution,
  midpointGrid,
  minEntropy,
  mutualInformation,
  normalPitValues,
  perplexity,
  pitHistogram,
  rankInformationGain,
  renyiEntropy,
  shannonEntropy,
  skillScore,
  verifyPropriety,
  wasserstein1,
  type GainCandidate,
  type LogBase,
  type MomentConstraint,
} from '../../engine/information';
import { EngineError } from '../../engine/core/result';
import type { Exactness } from '../../engine/core/result';
import type { Params } from '../../engine/distributions/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  RawNumberInput,
  Segmented,
  SelectField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { CalibrationChart } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { Icon } from '../../ui/icons';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

export type InformationMode =
  | 'entropy'
  | 'mutual'
  | 'divergence'
  | 'maxent'
  | 'estimation'
  | 'scoring'
  | 'propriety'
  | 'channel';

export interface InformationConfig {
  mode: InformationMode;
  /** Unit every information quantity is reported in. */
  base: LogBase;

  /* Entropy */
  outcomeNames: string[];
  outcomeProbs: number[];
  renyiAlpha: number;

  /* Mutual information */
  jointRowNames: string[];
  jointColNames: string[];
  joint: number[][];

  /* Divergences */
  supportValues: number[];
  p: number[];
  q: number[];

  /* Maximum entropy */
  maxentLower: number;
  maxentUpper: number;
  maxentPoints: number;
  maxentMean: number;
  maxentUseVariance: boolean;
  maxentVariance: number;
  runMaxEnt: boolean;

  /* Estimating from data */
  countsText: string;
  /** 0 means "the alphabet size is unknown", which the engine reports as a substitution. */
  alphabetSize: number;
  contingencyText: string;
  permutations: number;
  runPermutation: boolean;

  /* Forecast scoring */
  forecastRecord: string;
  continuousRecord: string;
  calibrationBins: number;
  pitBins: number;

  /* Propriety */
  trueProbability: number;

  /* Channel capacity and design */
  crossover: number;
  channel: number[][];
  runCapacity: boolean;
  fisherCase: 'bernoulli-p' | 'poisson-lambda' | 'normal-mu';
  fisherValue: number;
  fisherSamples: number;
  prior: number[];
  designA: number[][];
  designB: number[][];
}

/** 48 forecasts at five probability levels, with the hit rate written in. */
const DEFAULT_RECORD = ([
  [0.1, 10, 1],
  [0.3, 10, 4],
  [0.5, 8, 4],
  [0.7, 10, 6],
  [0.9, 10, 9],
] as [number, number, number][])
  .flatMap(([p, m, k]) => Array.from({ length: m }, (_, i) => `${p} ${i < k ? 1 : 0}`))
  .join('\n');

/** 20 normal predictive forecasts, all N(0,1), with the values that occurred. */
const DEFAULT_CONTINUOUS = [
  -2.6, -1.9, -1.55, -1.2, -0.9, -0.62, -0.4, -0.2, -0.05, 0.08, 0.22, 0.44, 0.61, 0.85, 1.1, 1.35, 1.7, 2.0, 2.4, 2.9,
]
  .map((y) => `0 1 ${y}`)
  .join('\n');

export const INFORMATION_DEFAULT: InformationConfig = {
  mode: 'entropy',
  base: 'bits',

  // Dyadic probabilities, so H = 1.75 bits exactly and the gap to log₂4 = 2 is visible.
  outcomeNames: ['A', 'B', 'C', 'D'],
  outcomeProbs: [0.5, 0.25, 0.125, 0.125],
  renyiAlpha: 2,

  jointRowNames: ['Rain', 'Cloud', 'Clear'],
  jointColNames: ['Barometer low', 'Barometer mid', 'Barometer high'],
  joint: [
    [0.1875, 0.0625, 0.0625],
    [0.0625, 0.1875, 0.0625],
    [0.0625, 0.0625, 0.25],
  ],

  supportValues: [0, 1, 2, 3],
  p: [0.5, 0.25, 0.125, 0.125],
  q: [0.25, 0.25, 0.25, 0.25],

  maxentLower: 0,
  maxentUpper: 20,
  maxentPoints: 160,
  maxentMean: 2.5,
  maxentUseVariance: false,
  maxentVariance: 1,
  runMaxEnt: false,

  countsText: '12 8 5 3 1 1',
  alphabetSize: 0,
  contingencyText: '10 6 4\n5 7 8',
  permutations: 200,
  runPermutation: false,

  forecastRecord: DEFAULT_RECORD,
  continuousRecord: DEFAULT_CONTINUOUS,
  calibrationBins: 10,
  pitBins: 5,

  trueProbability: 0.7,

  crossover: 0.11,
  channel: [
    [0.8, 0.1, 0.1],
    [0.1, 0.1, 0.8],
  ],
  runCapacity: false,
  fisherCase: 'bernoulli-p',
  fisherValue: 0.3,
  fisherSamples: 25,
  prior: [0.2, 0.5, 0.3],
  designA: [
    [0.9, 0.1],
    [0.5, 0.5],
    [0.2, 0.8],
  ],
  designB: [
    [0.99, 0.01],
    [0.3, 0.7],
    [0.02, 0.98],
  ],
};

const MODE_OPTIONS: { value: InformationMode; label: string }[] = [
  { value: 'entropy', label: 'Entropy' },
  { value: 'mutual', label: 'Mutual information' },
  { value: 'divergence', label: 'Divergences' },
  { value: 'maxent', label: 'Maximum entropy' },
  { value: 'estimation', label: 'From data' },
  { value: 'scoring', label: 'Forecast scoring' },
  { value: 'propriety', label: 'Propriety' },
  { value: 'channel', label: 'Channel and design' },
];

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function InformationTool({ config }: { config: InformationConfig }) {
  const app = useApp();
  const set = (patch: Partial<InformationConfig>) => app.updateConfig({ ...config, ...patch });

  // One memo, switching on the mode, so only the visible section is computed.
  // That is what keeps the default open fast: the entropy branch is a handful
  // of sums over four numbers.
  const computed = useMemo<Computed>(() => {
    try {
      switch (config.mode) {
        case 'entropy':
          return { kind: 'entropy', data: computeEntropy(config) };
        case 'mutual':
          return { kind: 'mutual', data: computeMutual(config) };
        case 'divergence':
          return { kind: 'divergence', data: computeDivergence(config) };
        case 'maxent':
          return { kind: 'maxent', data: computeMaxEnt(config) };
        case 'estimation':
          return { kind: 'estimation', data: computeEstimation(config) };
        case 'scoring':
          return { kind: 'scoring', data: computeScoring(config) };
        case 'propriety':
          return { kind: 'propriety', data: computePropriety(config) };
        case 'channel':
          return { kind: 'channel', data: computeChannel(config) };
      }
    } catch (e) {
      if (e instanceof EngineError) return { kind: 'error', message: e.message };
      return { kind: 'error', message: (e as Error).message };
    }
  }, [config]);

  const baseName = config.base;

  return (
    <>
      <ToolHeader toolId="information" />
      <div className="oc-stack">
        <Card title="What are you measuring?">
          <div style={{ overflowX: 'auto' }}>
            <Segmented label="Section" value={config.mode} onChange={(mode) => set({ mode })} options={MODE_OPTIONS} />
          </div>
          <SelectField
            label="Unit"
            value={config.base}
            onChange={(base) => set({ base: base as LogBase })}
            options={[
              { value: 'bits', label: 'Bits (log base 2)' },
              { value: 'nats', label: 'Nats (natural log)' },
              { value: 'hartleys', label: 'Hartleys / dits (log base 10)' },
            ]}
            hint={`Every quantity below is reported in ${BASE_LABEL[config.base]}. The unit is part of the number: 1 bit = 0.6931 nats.`}
          />
        </Card>

        <AiAssistPanel
          capability="interpretQuestion"
          context="Describe what you are trying to measure — the uncertainty in a distribution, the dependence between two variables, or the quality of a set of forecasts — and the matching section above is the one to use."
        />

        {computed.kind === 'error' && <Notice tone="error">{computed.message}</Notice>}

        {computed.kind === 'entropy' && <EntropySection config={config} set={set} data={computed.data} />}
        {computed.kind === 'mutual' && <MutualSection config={config} set={set} data={computed.data} />}
        {computed.kind === 'divergence' && <DivergenceSection config={config} set={set} data={computed.data} />}
        {computed.kind === 'maxent' && <MaxEntSection config={config} set={set} data={computed.data} />}
        {computed.kind === 'estimation' && <EstimationSection config={config} set={set} data={computed.data} />}
        {computed.kind === 'scoring' && <ScoringSection config={config} set={set} data={computed.data} />}
        {computed.kind === 'propriety' && <ProprietySection config={config} set={set} data={computed.data} />}
        {computed.kind === 'channel' && <ChannelSection config={config} set={set} data={computed.data} />}

        {/* Inputs are editable even when the engine refused the current ones,
            otherwise a bad entry would leave the section with no way back. */}
        {computed.kind === 'error' && <RefusedInputs config={config} set={set} />}

        <Card title="Reading these numbers" variant="inset">
          <KeyValueList
            items={[
              { label: 'Unit', value: BASE_LABEL[baseName] },
              {
                label: 'Exactness labels',
                value:
                  'Closed forms are exact. Quadrature, the maximum-entropy solver, Blahut–Arimoto and the propriety grid are numerical. Anything estimated from data is empirical and carries its bias direction.',
              },
            ]}
          />
          <Notice tone="info" title="Differential entropy is a different object from discrete entropy">
            <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 12.5 }}>
              <li>It is not the limit of discrete entropy under finer binning: binning at width Δ gives H ≈ h(X) − log Δ, which diverges.</li>
              <li>It can be negative, and a negative value is a correct answer rather than an error.</li>
              <li>It is not invariant under reparameterisation: changing units changes the number. Only differences — mutual information, KL divergence — are invariant.</li>
            </ul>
          </Notice>
          <Notice tone="info" title="A confidence interval and a percentile are different statements">
            An interval around an estimate describes where the unknown quantity plausibly lies. A percentile of a set of outcomes describes how
            those outcomes are spread. This screen labels every interval it shows, and never converts one into the other.
          </Notice>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Computation — one helper per section                               */
/* ------------------------------------------------------------------ */

type Setter = (patch: Partial<InformationConfig>) => void;

type Computed =
  | { kind: 'error'; message: string }
  | { kind: 'entropy'; data: ReturnType<typeof computeEntropy> }
  | { kind: 'mutual'; data: ReturnType<typeof computeMutual> }
  | { kind: 'divergence'; data: ReturnType<typeof computeDivergence> }
  | { kind: 'maxent'; data: ReturnType<typeof computeMaxEnt> }
  | { kind: 'estimation'; data: ReturnType<typeof computeEstimation> }
  | { kind: 'scoring'; data: ReturnType<typeof computeScoring> }
  | { kind: 'propriety'; data: ReturnType<typeof computePropriety> }
  | { kind: 'channel'; data: ReturnType<typeof computeChannel> };

function computeEntropy(config: InformationConfig) {
  const opts = { base: config.base };
  const h = shannonEntropy(config.outcomeProbs, opts);
  const renyi = renyiEntropy(config.outcomeProbs, config.renyiAlpha, opts);
  const hMin = minEntropy(config.outcomeProbs, opts);
  const pp = perplexity(config.outcomeProbs);
  const listed = config.outcomeProbs.length;
  // The engine's `maximum`, `redundancy` and `efficiency` are all relative to
  // the SUPPORT — the outcomes with strictly positive probability — so the
  // bound shown beside them has to be the same one, or the three numbers
  // contradict each other as soon as an outcome is given probability 0. The
  // bound over every listed outcome is a different (and unattainable)
  // statement, so it is reported separately and only when the two differ.
  const uniformOverListed = shannonEntropy(new Array<number>(listed).fill(1 / listed), opts);
  return { h, renyi, hMin, pp, uniformOverListed, listed, k: h.support };
}

function computeMutual(config: InformationConfig) {
  const opts = { base: config.base };
  const mi = mutualInformation(config.joint, opts);
  const joint = config.joint;
  const rows = joint.length;
  const cols = joint[0]?.length ?? 0;

  // Identity checks, computed from the engine's own quantities rather than
  // asserted: the chain rule, the three forms of I, and non-negativity.
  const flat = joint.flat();
  const product = mi.px.flatMap((px) => mi.py.map((py) => px * py));
  const kl = klDivergence(flat, product, opts);
  const chainResidual = Math.abs(mi.hxy - (mi.hx + mi.hyGivenX));
  const identityResidual = Math.abs(mi.mutualInformation - (mi.hx + mi.hy - mi.hxy));
  const klResidual = kl.finite ? Math.abs(mi.mutualInformation - kl.value) : Infinity;
  const independent = mi.mutualInformation <= 1e-12;

  // Candidate measurements, all derived from the edited joint so that each one
  // has the same target marginal — the engine refuses them otherwise.
  const candidates: GainCandidate[] = [{ name: `${config.jointColNames.join(' / ')} (as entered)`, joint }];
  if (cols >= 3) {
    candidates.push({
      name: `Coarsened: "${config.jointColNames[0]}" versus the rest`,
      joint: joint.map((row) => [row[0], row.slice(1).reduce((a, b) => a + b, 0)]),
    });
  }
  candidates.push({
    name: 'A measurement independent of the target',
    joint: Array.from({ length: rows }, (_, i) => mi.py.map((py) => mi.px[i] * py)),
  });
  const ranking = rankInformationGain(candidates, opts);

  return { mi, kl, chainResidual, identityResidual, klResidual, independent, ranking };
}

function computeDivergence(config: InformationConfig) {
  const opts = { base: config.base };
  const kl = klDivergence(config.p, config.q, opts);
  const klReverse = klDivergence(config.q, config.p, opts);
  const jsd = jensenShannonDivergence(config.p, config.q, opts);
  const dist = distances(config.p, config.q, opts);
  const bounds = divergenceBounds(config.p, config.q);
  const w1 = wasserstein1(config.supportValues, config.p, config.supportValues, config.q);
  return { kl, klReverse, jsd, dist, bounds, w1 };
}

function computeMaxEnt(config: InformationConfig) {
  const opts = { base: config.base };
  // The closed form is exact and instant, so it is always available; the
  // numerical solver is what sits behind the button.
  const closed = config.maxentUseVariance
    ? maximumEntropyClosedForm('mean-and-variance-on-reals', { mean: config.maxentMean, variance: config.maxentVariance })
    : maximumEntropyClosedForm('mean-on-positive-halfline', { mean: config.maxentMean });
  const closedParametric = 'distributionId' in closed ? closed : null;
  const differential = closedParametric
    ? differentialEntropy(closedParametric.distributionId, closedParametric.params as Params, { ...opts, crossCheck: true })
    : null;

  if (!config.runMaxEnt) return { closed, closedParametric, differential, solved: null };

  const constraints: MomentConstraint[] = [{ name: 'mean', f: (x) => x, target: config.maxentMean }];
  if (config.maxentUseVariance) {
    // E[x²] = variance + mean², which is the linear form the solver needs.
    constraints.push({
      name: 'second moment',
      f: (x) => x * x,
      target: config.maxentVariance + config.maxentMean * config.maxentMean,
    });
  }
  const grid = midpointGrid(config.maxentLower, config.maxentUpper, config.maxentPoints);
  const solved = maximumEntropyDistribution(grid, constraints, opts);
  return { closed, closedParametric, differential, solved };
}

function computeEstimation(config: InformationConfig) {
  const counts = parseIntegerRow(config.countsText, 'counts');
  const table = parseIntegerTable(config.contingencyText, 'contingency table');
  const opts = {
    base: config.base,
    ...(config.alphabetSize > 0 ? { alphabetSize: config.alphabetSize } : {}),
  };
  const entropy = estimateEntropy(counts, opts);
  const mi = estimateMutualInformation(table, {
    base: config.base,
    ...(config.runPermutation ? { permutations: config.permutations, seed: 'orbis-information' } : {}),
  });
  return { counts, table, entropy, mi };
}

function computeScoring(config: InformationConfig) {
  const record = parseForecastRecord(config.forecastRecord);
  const forecasts = record.map((r) => r[0]);
  const outcomes = record.map((r) => r[1]);

  const brier = brierScore(forecasts, outcomes);
  const log = logScore(forecasts, outcomes, { base: config.base });
  const cal = calibration(forecasts, outcomes, { bins: config.calibrationBins });
  const climatology = climatologyBrier(outcomes);
  const skill = skillScore(brier.brierScore, climatology.brierScore, {
    reference: `the constant base-rate forecast p = ${formatValue(climatology.baseRate, 4)}`,
  });

  // Continuous side: CRPS of each normal predictive forecast, and the PIT.
  const cont = parseContinuousRecord(config.continuousRecord);
  const crps = cont.map(([mu, sigma, y]) => crpsNormal(mu, sigma, y));
  const crpsMean = crps.reduce((a, c) => a + c.value, 0) / crps.length;
  const pit = pitHistogram(
    normalPitValues(
      cont.map((r) => r[0]),
      cont.map((r) => r[1]),
      cont.map((r) => r[2]),
    ),
    { bins: config.pitBins },
  );

  return { brier, log, cal, climatology, skill, crps, crpsMean, pit, n: record.length, contN: cont.length };
}

function computePropriety(config: InformationConfig) {
  // 401 grid points for each of three rules: about a thousand arithmetic
  // evaluations, far below the gating threshold.
  const grid = 401;
  const checks = (['brier', 'log', 'absolute'] as const).map((rule) =>
    verifyPropriety(rule, config.trueProbability, { gridPoints: grid }),
  );
  return { checks };
}

function computeChannel(config: InformationConfig) {
  const opts = { base: config.base };
  const bsc = binarySymmetricCapacity(config.crossover, opts);
  const bscMatrix = binarySymmetricChannel(config.crossover);

  const fisher = FISHER_CASES[config.fisherCase];
  const fisherResult = fisherInformation(fisher.id, fisher.param, fisher.params(config.fisherValue));
  const prior = jeffreysPrior(fisher.id, fisher.param, fisher.params(config.fisherValue), fisher.range, { points: 201 });

  const design = expectedInformationGain(
    config.prior,
    [
      { name: 'Design A', likelihood: config.designA },
      { name: 'Design B', likelihood: config.designB },
    ],
    opts,
  );

  if (!config.runCapacity) {
    return { bsc, bscMatrix, fisher, fisherResult, prior, design, bscNumerical: null, general: null };
  }
  const bscNumerical = channelCapacity(bscMatrix, opts);
  const general = channelCapacity(config.channel, opts);
  return { bsc, bscMatrix, fisher, fisherResult, prior, design, bscNumerical, general };
}

const FISHER_CASES: Record<
  InformationConfig['fisherCase'],
  { id: string; param: string; label: string; params(v: number): Params; range: { lower: number; upper: number } }
> = {
  'bernoulli-p': {
    id: 'bernoulli',
    param: 'p',
    label: 'Bernoulli success probability p',
    params: (v) => ({ p: v }),
    range: { lower: 0.001, upper: 0.999 },
  },
  'poisson-lambda': {
    id: 'poisson',
    param: 'lambda',
    label: 'Poisson rate λ',
    params: (v) => ({ lambda: v }),
    range: { lower: 0.01, upper: 20 },
  },
  'normal-mu': {
    id: 'normal',
    param: 'mu',
    label: 'Normal mean μ (σ = 1)',
    params: (v) => ({ mu: v, sigma: 1 }),
    range: { lower: -10, upper: 10 },
  },
};

/* ------------------------------------------------------------------ */
/* Parsing of the text-entered data sets                              */
/* ------------------------------------------------------------------ */

function parseIntegerRow(text: string, field: string): number[] {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) throw new EngineError(`Enter the ${field} as whole numbers separated by spaces or commas.`, 'empty');
  return parts.map((s, i) => {
    const v = Number(s);
    if (!Number.isInteger(v) || v < 0) {
      throw new EngineError(`Entry ${i + 1} of the ${field} is "${s}". Counts must be whole numbers of 0 or more.`, 'integer');
    }
    return v;
  });
}

function parseIntegerTable(text: string, field: string): number[][] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new EngineError(`Enter the ${field} as one row of counts per line.`, 'empty');
  const rows = lines.map((line, i) => parseIntegerRow(line, `${field} row ${i + 1}`));
  const cols = rows[0].length;
  rows.forEach((row, i) => {
    if (row.length !== cols) {
      throw new EngineError(`Row ${i + 1} of the ${field} has ${row.length} entries but row 1 has ${cols}. The table must be rectangular.`, 'shape');
    }
  });
  return rows;
}

function parseForecastRecord(text: string): [number, number][] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new EngineError('Enter one forecast per line as a probability followed by the outcome (0 or 1).', 'empty');
  return lines.map((line, i) => {
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) {
      throw new EngineError(`Line ${i + 1} ("${line}") has ${parts.length} value(s). Each line needs exactly two: the forecast probability and the outcome, 0 or 1.`, 'shape');
    }
    const p = Number(parts[0]);
    const o = Number(parts[1]);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new EngineError(`Line ${i + 1}: "${parts[0]}" is not a probability in [0, 1].`, 'range');
    if (o !== 0 && o !== 1) throw new EngineError(`Line ${i + 1}: the outcome "${parts[1]}" must be 0 (did not happen) or 1 (happened).`, 'range');
    return [p, o];
  });
}

function parseContinuousRecord(text: string): [number, number, number][] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new EngineError('Enter one forecast per line as the predictive mean, the predictive standard deviation and the value that occurred.', 'empty');
  return lines.map((line, i) => {
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 3) {
      throw new EngineError(`Line ${i + 1} ("${line}") has ${parts.length} value(s). Each line needs three: the predictive mean, the predictive standard deviation and the observed value.`, 'shape');
    }
    const [mu, sigma, y] = parts.map(Number);
    if (!Number.isFinite(mu) || !Number.isFinite(y)) throw new EngineError(`Line ${i + 1}: the mean and the observed value must both be numbers.`, 'finite');
    if (!Number.isFinite(sigma) || sigma <= 0) throw new EngineError(`Line ${i + 1}: the predictive standard deviation "${parts[1]}" must be a positive number.`, 'range');
    return [mu, sigma, y];
  });
}

/* ------------------------------------------------------------------ */
/* Shared input components                                            */
/* ------------------------------------------------------------------ */

/** Sum feedback with a non-colour indicator, as `MatrixEditor` does for rows. */
function SumBadge({ sum, label }: { sum: number; label: string }) {
  const bad = !Number.isFinite(sum) || Math.abs(sum - 1) > 1e-9;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11.5,
        fontFamily: 'var(--font-mono)',
        color: bad ? 'var(--status-warning)' : 'var(--text-muted)',
      }}
      title={bad ? `${label} does not sum to 1` : `${label} sums to 1`}
    >
      {bad && <Icon name="alert" size={11} />}
      {label}: {Number.isFinite(sum) ? sum.toPrecision(8) : '—'}
    </span>
  );
}

/** A vector of probabilities over named outcomes, with editable labels. */
function VectorEditor({
  title,
  hint,
  names,
  values,
  onChange,
  nameLabel,
}: {
  title: string;
  hint?: string;
  names: string[] | null;
  values: number[];
  onChange(names: string[] | null, values: number[]): void;
  nameLabel?: string;
}) {
  const sum = values.reduce((a, b) => a + (Number.isFinite(b) ? b : NaN), 0);
  return (
    <div className="oc-field">
      <span className="oc-field__label">{title}</span>
      {hint && (
        <p className="oc-field__hint" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
          {hint}
        </p>
      )}
      <div style={{ overflowX: 'auto', paddingBottom: 'var(--s2)' }}>
        <div
          className="oc-matrix-grid"
          style={{ gridTemplateColumns: `${names ? 'minmax(90px, 140px) ' : ''}minmax(70px, 110px) 28px`, minWidth: 'max-content' }}
        >
          {values.map((v, i) => (
            <div key={i} style={{ display: 'contents' }}>
              {names && (
                <input
                  className="oc-matrix-input"
                  style={{ textAlign: 'left' }}
                  value={names[i] ?? ''}
                  maxLength={40}
                  aria-label={`${nameLabel ?? 'Name of outcome'} ${i + 1}`}
                  onChange={(e) => onChange(names.map((s, j) => (j === i ? e.target.value : s)), values)}
                />
              )}
              <RawNumberInput
                value={v}
                min={0}
                max={1}
                ariaLabel={`Probability of ${names ? names[i] : `outcome ${i + 1}`}`}
                onChange={(nv) => onChange(names, values.map((x, j) => (j === i ? nv : x)))}
              />
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {values.length > 2 && (
                  <Button
                    icon="trash"
                    size="sm"
                    variant="ghost"
                    title={`Remove outcome ${i + 1}`}
                    onClick={() => onChange(names ? names.filter((_, j) => j !== i) : null, values.filter((_, j) => j !== i))}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="oc-btn-row" style={{ marginTop: 'var(--s2)', alignItems: 'center', gap: 'var(--s3)' }}>
        <Button
          icon="plus"
          size="sm"
          disabled={values.length >= 12}
          onClick={() => onChange(names ? [...names, `Outcome ${values.length + 1}`] : null, [...values, 0])}
        >
          Add an outcome
        </Button>
        <SumBadge sum={sum} label="Total" />
      </div>
    </div>
  );
}

/** A rectangular table of probabilities with per-row sums and a grand total. */
function TableEditor({
  title,
  hint,
  rowNames,
  colNames,
  table,
  onChange,
  rowStochastic,
}: {
  title: string;
  hint: string;
  rowNames: string[];
  colNames: string[];
  table: number[][];
  onChange(table: number[][]): void;
  /** True when each row must sum to 1 (a conditional distribution). */
  rowStochastic: boolean;
}) {
  const cols = colNames.length;
  const total = table.flat().reduce((a, b) => a + (Number.isFinite(b) ? b : NaN), 0);
  return (
    <div className="oc-field">
      <span className="oc-field__label">{title}</span>
      <p className="oc-field__hint" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
        {hint}
      </p>
      <div style={{ overflowX: 'auto', paddingBottom: 'var(--s2)' }}>
        <div
          className="oc-matrix-grid"
          style={{ gridTemplateColumns: `minmax(90px, 150px) repeat(${cols}, minmax(62px, 1fr)) 86px`, minWidth: 'max-content' }}
        >
          <div />
          {colNames.map((c, j) => (
            <div key={`h-${j}`} className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }} title={c}>
              {c}
            </div>
          ))}
          <div className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            Row sum
          </div>
          {rowNames.map((r, i) => {
            const rowSum = (table[i] ?? []).reduce((a, b) => a + (Number.isFinite(b) ? b : NaN), 0);
            const bad = rowStochastic && (!Number.isFinite(rowSum) || Math.abs(rowSum - 1) > 1e-9);
            return (
              <div key={`r-${i}`} style={{ display: 'contents' }}>
                <div className="oc-matrix-cell" style={{ fontSize: 11, justifyContent: 'flex-start' }}>
                  {r}
                </div>
                {colNames.map((c, j) => (
                  <RawNumberInput
                    key={`c-${i}-${j}`}
                    value={table[i]?.[j] ?? 0}
                    min={0}
                    max={1}
                    ariaLabel={`${r}, ${c}`}
                    onChange={(v) => onChange(table.map((row, ri) => (ri === i ? row.map((x, cj) => (cj === j ? v : x)) : [...row])))}
                  />
                ))}
                <div
                  className="oc-matrix-cell"
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: bad ? 'var(--status-warning)' : 'var(--text-muted)' }}
                  title={bad ? 'This row does not sum to 1' : undefined}
                >
                  {bad && <Icon name="alert" size={11} />}
                  {Number.isFinite(rowSum) ? rowSum.toFixed(4) : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!rowStochastic && <SumBadge sum={total} label="Grand total" />}
    </div>
  );
}

function ExactnessBadge({ exactness }: { exactness: Exactness }) {
  return <Badge variant={exactness}>{exactness}</Badge>;
}

/** A check the tool performed, shown with its residual rather than asserted. */
function CheckRow({ label, holds, detail }: { label: string; holds: boolean; detail: string }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', fontSize: 12.5, marginBottom: 'var(--s2)' }}>
      <Icon name={holds ? 'check' : 'alert'} size={13} />
      <div>
        <strong>{label}</strong> — {holds ? 'checked and holds' : 'DOES NOT hold'}
        <div className="oc-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

function RefusedInputs({ config, set }: { config: InformationConfig; set: Setter }) {
  return (
    <Card title="Inputs" hint="The engine refused the current inputs. Correct them here.">
      {config.mode === 'entropy' && (
        <>
          <VectorEditor
            title="Distribution over outcomes"
            names={config.outcomeNames}
            values={config.outcomeProbs}
            onChange={(names, values) => set({ outcomeNames: names ?? config.outcomeNames, outcomeProbs: values })}
          />
          <NumberField label="Rényi order" symbol="α" value={config.renyiAlpha} onChange={(renyiAlpha) => set({ renyiAlpha })} min={0} max={64} step={0.5} />
        </>
      )}
      {config.mode === 'divergence' && (
        <>
          <VectorEditor title="P" names={null} values={config.p} onChange={(_n, p) => set({ p })} />
          <VectorEditor title="Q" names={null} values={config.q} onChange={(_n, q) => set({ q })} />
          <TextField
            label="Support values (for the Wasserstein distance only)"
            value={config.supportValues.join(', ')}
            onChange={(text) => set({ supportValues: text.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean).map(Number) })}
            monospace
          />
        </>
      )}
      {config.mode === 'mutual' && (
        <TableEditor
          title="Joint distribution of (X, Y)"
          hint="Every cell is a joint probability. The whole table must sum to 1."
          rowNames={config.jointRowNames}
          colNames={config.jointColNames}
          table={config.joint}
          onChange={(joint) => set({ joint })}
          rowStochastic={false}
        />
      )}
      {config.mode === 'estimation' && (
        <>
          <TextField label="Counts per outcome" value={config.countsText} onChange={(countsText) => set({ countsText })} monospace />
          <NumberField
            label="Known alphabet size (0 if unknown)"
            value={config.alphabetSize}
            onChange={(alphabetSize) => set({ alphabetSize })}
            min={0}
            max={100_000}
            integer
          />
          <TextField label="Contingency table of counts" value={config.contingencyText} onChange={(contingencyText) => set({ contingencyText })} multiline rows={4} monospace />
          <NumberField label="Permutations" value={config.permutations} onChange={(permutations) => set({ permutations })} min={1} max={5000} integer />
        </>
      )}
      {config.mode === 'scoring' && (
        <>
          <TextField label="Forecast record (probability, then outcome)" value={config.forecastRecord} onChange={(forecastRecord) => set({ forecastRecord })} multiline rows={8} monospace />
          <TextField label="Continuous forecasts (mean, standard deviation, observed value)" value={config.continuousRecord} onChange={(continuousRecord) => set({ continuousRecord })} multiline rows={6} monospace />
          <NumberField label="Reliability-diagram bins" value={config.calibrationBins} onChange={(calibrationBins) => set({ calibrationBins })} min={2} max={20} integer />
          <NumberField label="PIT histogram bins" value={config.pitBins} onChange={(pitBins) => set({ pitBins })} min={2} max={20} integer />
        </>
      )}
      {config.mode === 'maxent' && (
        <>
          <NumberField label="Required mean" value={config.maxentMean} onChange={(maxentMean) => set({ maxentMean })} />
          {config.maxentUseVariance && (
            <NumberField label="Required variance" value={config.maxentVariance} onChange={(maxentVariance) => set({ maxentVariance })} min={1e-9} />
          )}
          <NumberField label="Grid lower bound" value={config.maxentLower} onChange={(maxentLower) => set({ maxentLower })} />
          <NumberField label="Grid upper bound" value={config.maxentUpper} onChange={(maxentUpper) => set({ maxentUpper })} />
          <NumberField label="Grid points" value={config.maxentPoints} onChange={(maxentPoints) => set({ maxentPoints })} min={16} max={2000} integer />
        </>
      )}
      {config.mode === 'channel' && (
        <>
          <NumberField label="Crossover probability" value={config.crossover} onChange={(crossover) => set({ crossover })} min={0} max={1} step={0.01} />
          <TableEditor
            title="Channel P(output | input)"
            hint="Each row is one input letter and must sum to 1."
            rowNames={config.channel.map((_, i) => `Input ${i + 1}`)}
            colNames={(config.channel[0] ?? []).map((_, j) => `Output ${j + 1}`)}
            table={config.channel}
            onChange={(channel) => set({ channel })}
            rowStochastic
          />
          <NumberField label="Parameter value" symbol="θ" value={config.fisherValue} onChange={(fisherValue) => set({ fisherValue })} step={0.05} />
          <NumberField label="Observations" symbol="n" value={config.fisherSamples} onChange={(fisherSamples) => set({ fisherSamples })} min={1} max={100_000} integer />
          <VectorEditor title="Prior over θ" names={null} values={config.prior} onChange={(_n, prior) => set({ prior })} />
          <TableEditor
            title="Design A: P(outcome | θ)"
            hint="Each row is one value of θ and must sum to 1."
            rowNames={config.designA.map((_, i) => `θ${i + 1}`)}
            colNames={(config.designA[0] ?? []).map((_, j) => `Outcome ${j + 1}`)}
            table={config.designA}
            onChange={(designA) => set({ designA })}
            rowStochastic
          />
          <TableEditor
            title="Design B: P(outcome | θ)"
            hint="Each row is one value of θ and must sum to 1."
            rowNames={config.designB.map((_, i) => `θ${i + 1}`)}
            colNames={(config.designB[0] ?? []).map((_, j) => `Outcome ${j + 1}`)}
            table={config.designB}
            onChange={(designB) => set({ designB })}
            rowStochastic
          />
        </>
      )}
      {config.mode === 'propriety' && (
        <NumberField label="True probability" value={config.trueProbability} onChange={(trueProbability) => set({ trueProbability })} min={0} max={1} step={0.05} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Entropy                                                         */
/* ------------------------------------------------------------------ */

function EntropySection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeEntropy> }) {
  const { h, renyi, hMin, pp, uniformOverListed, listed, k } = data;
  const unit = config.base;
  return (
    <>
      <Card title="Entropy of a distribution">
        <VectorEditor
          title="Distribution over outcomes"
          hint="The probabilities must sum to 1. An unnormalised vector is refused with its actual total — it is never divided through silently, because that would change the question without saying so."
          names={config.outcomeNames}
          values={config.outcomeProbs}
          onChange={(names, values) => set({ outcomeNames: names ?? config.outcomeNames, outcomeProbs: values })}
        />
        <NumberField
          label="Rényi order"
          symbol="α"
          value={config.renyiAlpha}
          onChange={(renyiAlpha) => set({ renyiAlpha })}
          min={0}
          max={64}
          step={0.5}
          hint="α = 0 counts possibilities (Hartley), α → 1 is Shannon, α = 2 is the collision entropy, and α → ∞ is the min-entropy."
        />
      </Card>

      <Card title="Result" actions={<ExactnessBadge exactness={h.exactness} />}>
        <div className="oc-result-hero">
          <span className="oc-result-hero__label">Shannon entropy</span>
          <span className="oc-result-hero__value">
            {formatValue(h.value, 6)} {unit}
          </span>
          <span className="oc-result-hero__detail">{h.baseLabel}</span>
        </div>
        <KeyValueList
          items={[
            { label: 'Perplexity (base^H)', value: `${formatValue(pp, 6)} equally likely outcomes` },
            { label: `Rényi H_${config.renyiAlpha}`, value: `${formatValue(renyi.value, 6)} ${unit}` },
            { label: 'Min-entropy H_∞', value: `${formatValue(hMin.value, 6)} ${unit}` },
            { label: `Maximum on the ${k} outcome(s) with positive probability`, value: `log ${k} = ${formatValue(h.maximum, 6)} ${unit}` },
            { label: 'Redundancy (maximum − H)', value: `${formatValue(h.redundancy, 6)} ${unit}` },
            { label: 'Efficiency (H / maximum)', value: formatPercent(h.efficiency, 3) },
            { label: 'Outcomes with positive probability', value: `${h.support} of ${h.outcomes}` },
            ...(listed !== k
              ? [
                  {
                    label: `Maximum if all ${listed} listed outcomes were possible`,
                    value: `log ${listed} = ${formatValue(uniformOverListed.value, 6)} ${unit} — not attainable while ${
                      listed - k === 1 ? 'one of them has' : `${listed - k} of them have`
                    } probability 0`,
                  },
                ]
              : []),
          ]}
        />
        {renyi.specialCase && <Notice tone="info">{renyi.specialCase}</Notice>}
        <Notice tone="info" title={`The uniform bound: H ≤ log ${k}`}>
          On the {k} outcome(s) this distribution can actually produce, no distribution has entropy above log {k} ={' '}
          {formatValue(h.maximum, 6)} {unit}, and the uniform distribution on them is the <em>only</em> one that attains it. This distribution falls{' '}
          {formatValue(h.redundancy, 6)} {unit} short, which is exactly the redundancy above.{' '}
          {h.redundancy <= 1e-12
            ? 'Here the entropy equals the bound, so this distribution is the uniform one.'
            : 'Any entropy below the bound therefore means the outcomes are not equally likely.'}
        </Notice>
        <Notice tone="info">
          The Rényi family is non-increasing in α, so H_∞ ≤ H_2 ≤ H_1 ≤ H_0 always. Only α = 1 is additive for independent variables in the usual
          sense; the orders are not interchangeable.
        </Notice>
        <ExplanationPanel explanation={h.explanation} />
      </Card>

      <Card title="Where the entropy comes from">
        <div style={{ overflowX: 'auto' }}>
          <BarChart
            title="Contribution of each outcome"
            description={`Each bar is −p log p for one outcome, in ${unit}. They sum to the entropy.`}
            data={config.outcomeProbs.map((p, i) => ({
              x: i,
              y: p > 0 ? (-p * Math.log(p)) / (unit === 'bits' ? Math.LN2 : unit === 'hartleys' ? Math.LN10 : 1) : 0,
              label: config.outcomeNames[i] ?? `Outcome ${i + 1}`,
            }))}
            xLabel="Outcome"
            yLabel={`Contribution (${unit})`}
            seriesLabel="−p log p"
            note="A near-certain outcome and an impossible one both contribute almost nothing; the middling probabilities carry the uncertainty."
          />
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Mutual information                                              */
/* ------------------------------------------------------------------ */

function MutualSection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeMutual> }) {
  const { mi, kl, chainResidual, identityResidual, klResidual, independent, ranking } = data;
  const unit = config.base;
  const tol = 1e-9;
  return (
    <>
      <Card title="Joint distribution of two variables">
        <TableEditor
          title="Joint probabilities P(X = x, Y = y)"
          hint="Rows index X (the target), columns index Y (the measurement). Every cell is a joint probability and the whole table must sum to 1 — the row sums are shown so you can see the marginal of X build up."
          rowNames={config.jointRowNames}
          colNames={config.jointColNames}
          table={config.joint}
          onChange={(joint) => set({ joint })}
          rowStochastic={false}
        />
      </Card>

      <Card title="Mutual information" actions={<ExactnessBadge exactness={mi.exactness} />}>
        <div className="oc-result-hero">
          <span className="oc-result-hero__label">I(X;Y)</span>
          <span className="oc-result-hero__value">
            {formatValue(mi.mutualInformation, 6)} {unit}
          </span>
          <span className="oc-result-hero__detail">
            {formatPercent(mi.hx > 0 ? mi.mutualInformation / mi.hx : 0, 3)} of the uncertainty in X
          </span>
        </div>
        <KeyValueList
          items={[
            { label: 'H(X)', value: `${formatValue(mi.hx, 6)} ${unit}` },
            { label: 'H(Y)', value: `${formatValue(mi.hy, 6)} ${unit}` },
            { label: 'H(X,Y)', value: `${formatValue(mi.hxy, 6)} ${unit}` },
            { label: 'H(X|Y)', value: `${formatValue(mi.hxGivenY, 6)} ${unit}` },
            { label: 'H(Y|X)', value: `${formatValue(mi.hyGivenX, 6)} ${unit}` },
            { label: 'Symmetric uncertainty 2I/(H(X)+H(Y))', value: formatValue(mi.normalisedSum, 6) },
            { label: 'Variation of information H(X|Y)+H(Y|X)', value: `${formatValue(mi.variationOfInformation, 6)} ${unit}` },
          ]}
        />
        <ExplanationPanel explanation={mi.explanation} />
      </Card>

      <Card title="Identities this tool checked" hint="Each line is a computation whose residual is shown, not a claim.">
        <CheckRow
          label="Chain rule: H(X,Y) = H(X) + H(Y|X)"
          holds={chainResidual <= tol}
          detail={`${formatValue(mi.hxy, 8)} versus ${formatValue(mi.hx + mi.hyGivenX, 8)} ${unit}; residual ${chainResidual.toExponential(2)}`}
        />
        <CheckRow
          label="I(X;Y) = H(X) + H(Y) − H(X,Y)"
          holds={identityResidual <= tol}
          detail={`${formatValue(mi.mutualInformation, 8)} versus ${formatValue(mi.hx + mi.hy - mi.hxy, 8)} ${unit}; residual ${identityResidual.toExponential(2)}`}
        />
        <CheckRow
          label="I(X;Y) = D(P(X,Y) ‖ P(X)P(Y))"
          holds={klResidual <= 1e-9}
          detail={
            kl.finite
              ? `${formatValue(mi.mutualInformation, 8)} versus the KL divergence ${formatValue(kl.value, 8)} ${unit}; residual ${klResidual.toExponential(2)}`
              : 'The KL divergence against the product of the marginals is infinite, which cannot happen for a valid joint table.'
          }
        />
        <CheckRow
          label="I(X;Y) ≥ 0, with equality exactly when X and Y are independent"
          holds={mi.mutualInformation >= -tol}
          detail={
            independent
              ? `I = ${mi.mutualInformation.toExponential(2)} ${unit}: the table is (to rounding) a product of its marginals, so X and Y are independent.`
              : `I = ${formatValue(mi.mutualInformation, 8)} ${unit} > 0, so the table is not the product of its marginals and the two variables are dependent.`
          }
        />
        <Notice tone="info">
          Mutual information measures dependence of any shape, not a direction of causation, and not a linear relationship. A correlation of zero
          with a positive I is perfectly possible.
        </Notice>
      </Card>

      <Card title="Which measurement is worth taking?" hint={`Ranked by I(X; candidate), with H(X) = ${formatValue(ranking.targetEntropy, 6)} ${unit}.`}>
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            caption="Candidate measurements ranked by information gain"
            columns={
              [
                { key: 'n', header: 'Candidate measurement', render: (r) => r.name },
                { key: 'g', header: `Gain (${unit})`, numeric: true, render: (r) => formatValue(r.gain, 6) },
                { key: 'f', header: 'Share of H(X) removed', numeric: true, render: (r) => formatPercent(r.fractionOfTargetEntropy, 3) },
                { key: 'r', header: `Uncertainty left (${unit})`, numeric: true, render: (r) => formatValue(r.residualEntropy, 6) },
              ] as ColumnDef<(typeof ranking.ranking)[number]>[]
            }
            rows={ranking.ranking}
          />
        </div>
        <Notice tone="info" title="Candidates are derived from the table above">
          The coarsened candidate merges columns of Y, and the independent candidate is the product of the two marginals. Both keep the marginal of X
          unchanged, which is what makes the gains comparable — the engine refuses candidates whose target marginals disagree. The independent
          candidate scores zero, which is the check that the ranking means what it says.
        </Notice>
        <Notice tone="info">
          Information is not additive across measurements: two individually informative variables can be largely redundant, and two individually
          uninformative ones can be jointly informative. This ranks single measurements, and it ignores their cost. It complements the Sobol indices,
          which apportion output variance rather than uncertainty.
        </Notice>
        <ExplanationPanel explanation={ranking.explanation} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Divergences                                                     */
/* ------------------------------------------------------------------ */

function DivergenceSection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeDivergence> }) {
  const { kl, klReverse, jsd, dist, bounds, w1 } = data;
  const unit = config.base;
  const n = config.p.length;
  return (
    <>
      <Card title="Two distributions on the same support">
        <VectorEditor
          title="P — the reference distribution"
          hint="P and Q must have the same number of outcomes. Include zero-probability outcomes explicitly rather than dropping them."
          names={null}
          values={config.p}
          onChange={(_n, p) => set({ p })}
        />
        <VectorEditor title="Q — the approximating model" names={null} values={config.q} onChange={(_n, q) => set({ q })} />
        <TextField
          label="Support values (for the Wasserstein distance only)"
          value={config.supportValues.slice(0, n).join(', ')}
          onChange={(text) => {
            const parsed = text.split(/[\s,]+/).filter(Boolean).map(Number);
            if (parsed.every(Number.isFinite)) set({ supportValues: parsed });
          }}
          hint="Where the outcomes sit on a numeric scale. The entropy-based measures ignore these; W₁ needs them, and takes their units."
          monospace
        />
        <div className="oc-btn-row">
          <Button
            size="sm"
            onClick={() => {
              // A model that rules out an outcome P allows: the case where KL
              // is genuinely infinite rather than merely large.
              const next = new Array<number>(n).fill(0);
              next[0] = 0.5;
              next[1] = 0.5;
              set({ q: next });
            }}
            disabled={n < 2}
          >
            Set Q to a model with zero support
          </Button>
        </div>
      </Card>

      <Card title="Kullback–Leibler divergence: both directions" actions={<ExactnessBadge exactness={kl.exactness} />}>
        <KeyValueList
          items={[
            { label: 'D(P ‖ Q) — coding P with a code built for Q', value: kl.finite ? `${formatValue(kl.value, 6)} ${unit}` : 'infinite' },
            { label: 'D(Q ‖ P) — the other direction', value: kl.reverseFinite ? `${formatValue(kl.reverse, 6)} ${unit}` : 'infinite' },
            { label: 'Symmetric?', value: kl.symmetric ? 'The two directions happen to agree here' : 'No — the two numbers differ, as they generally do' },
          ]}
        />
        {!kl.finite && (
          <Notice tone="warning" title="D(P ‖ Q) is infinite, not merely large">
            {kl.infiniteReason}
          </Notice>
        )}
        {!kl.reverseFinite && (
          <Notice tone="warning" title="D(Q ‖ P) is infinite">
            {klReverse.infiniteReason ?? 'P assigns zero probability where Q is positive, so the reverse divergence has no finite value.'}
          </Notice>
        )}
        <Notice tone="info" title="The direction is part of the quantity">
          {kl.direction} D(P‖Q) penalises Q for ruling out what P allows, which is why it is the right direction for model criticism; D(Q‖P)
          penalises Q for spreading mass where P has none, which is why variational methods that minimise it produce narrow approximations.
        </Notice>
        <ExplanationPanel explanation={kl.explanation} />
      </Card>

      <Card title="The symmetric and bounded alternatives">
        <KeyValueList
          items={[
            { label: 'Jensen–Shannon divergence', value: `${formatValue(jsd.value, 6)} ${unit} (bounded by ${formatValue(jsd.upperBound, 6)})` },
            { label: 'Jensen–Shannon distance √JSD (a metric)', value: formatValue(jsd.distance, 6) },
            { label: 'Total variation ½Σ|p−q|', value: formatValue(dist.totalVariation, 6) },
            { label: 'Hellinger distance', value: formatValue(dist.hellinger, 6) },
            { label: 'Bhattacharyya coefficient Σ√(pq)', value: formatValue(dist.bhattacharyyaCoefficient, 6) },
            {
              label: 'Bhattacharyya distance −log BC',
              value: dist.bhattacharyyaFinite ? `${formatValue(dist.bhattacharyyaDistance, 6)} ${unit}` : 'infinite — the supports do not overlap at all',
            },
            { label: 'χ² divergence Σ(p−q)²/q', value: dist.chiSquaredFinite ? formatValue(dist.chiSquared, 6) : 'infinite — Q is zero where P is positive' },
            { label: 'Wasserstein-1 (units of the support)', value: formatValue(w1.value, 6) },
          ]}
        />
        <Notice tone="info">
          W₁ is the only measure here that knows how far apart the outcomes are, and the only one that stays finite when the supports are disjoint.
          The others see only how the mass is split between labelled outcomes.
        </Notice>
        <ExplanationPanel explanation={dist.explanation} />
      </Card>

      <Card title="Inequalities this tool checked">
        <CheckRow
          label="Pinsker: TV ≤ √(KL/2), with KL in nats"
          holds={bounds.pinskerHolds}
          detail={`TV = ${formatValue(bounds.totalVariation, 8)} ≤ ${Number.isFinite(bounds.pinskerBound) ? formatValue(bounds.pinskerBound, 8) : '∞'}${
            Number.isFinite(bounds.klNats) ? ` (KL = ${formatValue(bounds.klNats, 8)} nats)` : ' (KL is infinite, so the bound is vacuous)'
          }`}
        />
        <CheckRow
          label="Bretagnolle–Huber: TV ≤ √(1 − e^−KL)"
          holds={bounds.bretagnolleHuberHolds}
          detail={`TV = ${formatValue(bounds.totalVariation, 8)} ≤ ${formatValue(bounds.bretagnolleHuberBound, 8)} — the tighter bound once KL is large, where Pinsker can exceed 1 and say nothing`}
        />
        <CheckRow
          label="Hellinger sandwich: H² ≤ TV ≤ H√(2 − H²)"
          holds={bounds.hellingerSandwichHolds}
          detail={`${formatValue(bounds.hellingerSquared, 8)} ≤ ${formatValue(bounds.totalVariation, 8)} ≤ ${formatValue(bounds.hellingerUpperBound, 8)}`}
        />
        <Notice tone="info">
          These bounds run one way only: a small KL forces a small total variation, but a large KL does not force a large one. Pinsker is stated in
          nats, so the KL above is converted for the comparison regardless of the unit chosen at the top.
        </Notice>
        <ExplanationPanel explanation={bounds.explanation} />
      </Card>

      <Card title="P against Q">
        <div style={{ overflowX: 'auto' }}>
          <BarChart
            title="The two distributions"
            description="P as bars with Q overlaid, on the same support."
            data={config.p.map((p, i) => ({ x: config.supportValues[i] ?? i, y: p, compare: config.q[i] ?? 0, label: String(config.supportValues[i] ?? i) }))}
            xLabel="Outcome"
            yLabel="Probability"
            seriesLabel="P"
            compareLabel="Q"
          />
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Maximum entropy                                                 */
/* ------------------------------------------------------------------ */

function MaxEntSection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeMaxEnt> }) {
  const { closed, closedParametric, differential, solved } = data;
  const unit = config.base;
  return (
    <>
      <Card title="What do you actually know?">
        <Checkbox
          checked={config.maxentUseVariance}
          onChange={(maxentUseVariance) => set({ maxentUseVariance })}
          label="I know a variance as well as a mean"
          description="A mean alone on the positive half-line gives the exponential. A mean and a variance on the whole line give the normal."
        />
        <NumberField label="Required mean" symbol="E[X]" value={config.maxentMean} onChange={(maxentMean) => set({ maxentMean })} />
        {config.maxentUseVariance && (
          <NumberField label="Required variance" symbol="Var[X]" value={config.maxentVariance} onChange={(maxentVariance) => set({ maxentVariance })} min={1e-9} />
        )}
        <NumberField label="Grid lower bound" value={config.maxentLower} onChange={(maxentLower) => set({ maxentLower })} />
        <NumberField label="Grid upper bound" value={config.maxentUpper} onChange={(maxentUpper) => set({ maxentUpper })} />
        <NumberField
          label="Grid points"
          value={config.maxentPoints}
          onChange={(maxentPoints) => set({ maxentPoints })}
          min={2}
          max={2000}
          integer
          hint="The continuum is discretised on a midpoint grid. The grid must reach far enough that the mass left outside it is negligible."
        />
      </Card>

      <Card title="The closed form" actions={<ExactnessBadge exactness="exact" />}>
        {'distributionId' in closed ? (
          <KeyValueList
            items={[
              { label: 'Distribution', value: closed.distributionId },
              { label: 'Parameters', value: Object.entries(closed.params).map(([k, v]) => `${k} = ${formatValue(v, 6)}`).join(', ') },
              { label: 'Why', value: closed.reason },
            ]}
          />
        ) : (
          <KeyValueList
            items={[
              { label: 'Outcomes', value: String(closed.outcomes) },
              { label: 'Probability of each', value: formatValue(closed.probability, 6) },
              { label: 'Why', value: closed.reason },
            ]}
          />
        )}
        <Notice tone="info" title="What maximum entropy does and does not claim">
          It gives the least-committal distribution consistent with the stated constraints. It is a statement about the state of your knowledge, not
          a claim that reality has that shape. It is also the only honest route to assuming a normal distribution: that assumption is justified when
          a mean and a variance really are all you know, and not otherwise.
        </Notice>
      </Card>

      {differential && closedParametric && (
        <Card title="Differential entropy of that density" actions={<ExactnessBadge exactness={differential.exactness} />}>
          <KeyValueList
            items={[
              { label: 'h(X)', value: `${formatValue(differential.value, 6)} ${unit}` },
              { label: 'Closed form', value: differential.formula },
              ...(differential.quadrature !== undefined
                ? [{ label: 'Quadrature cross-check', value: `${formatValue(differential.quadrature, 6)} ${unit}` }]
                : []),
              { label: 'Sign', value: differential.negative ? 'Negative — a correct value, not an error' : 'Positive' },
            ]}
          />
          <ExplanationPanel explanation={differential.explanation} />
        </Card>
      )}

      <Card title="The numerical solver">
        {!solved ? (
          <>
            <Notice tone="info" title="The maximum-entropy solver is not run automatically">
              <p style={{ marginTop: 0 }}>
                Finding the Lagrange multipliers is a Newton iteration with a line search over {config.maxentPoints} grid points, re-evaluating the
                partition function at every step. On a fine grid with several constraints that is long enough to make the page unresponsive, so it
                runs only when you ask.
              </p>
              <p style={{ marginBottom: 0 }}>
                The closed form above is already exact for this constraint set. The solver is what lets you check it, and what handles constraint
                sets with no closed form.
              </p>
            </Notice>
            <div className="oc-btn-row">
              <Button icon="play" variant="primary" onClick={() => set({ runMaxEnt: true })}>
                Solve for the maximum-entropy distribution
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="oc-btn-row">
              <Button icon="reset" size="sm" onClick={() => set({ runMaxEnt: false })}>
                Clear the solution
              </Button>
            </div>
            {!solved.converged && (
              <Notice tone="warning" title="The solver did not converge">
                The largest moment mismatch is still {solved.maxMomentError.toExponential(3)} after {solved.iterations} iterations. Widen the grid or
                relax the constraints; the numbers below should not be read as the answer.
              </Notice>
            )}
            <KeyValueList
              items={[
                { label: 'Entropy of the solution', value: `${formatValue(solved.entropy, 6)} ${unit} (discrete entropy of the grid)` },
                { label: 'Iterations', value: `${solved.iterations}${solved.converged ? ' (converged)' : ''}` },
                { label: 'Largest moment mismatch', value: solved.maxMomentError.toExponential(3) },
                ...solved.targets.map((t, i) => ({
                  label: `Constraint ${i + 1}: target versus achieved`,
                  value: `${formatValue(t, 8)} versus ${formatValue(solved.achieved[i], 8)}`,
                })),
                { label: 'Lagrange multipliers', value: solved.lambdas.map((l) => formatValue(l, 6)).join(', ') },
              ]}
            />
            <div style={{ overflowX: 'auto' }}>
              <LineChart
                title="The maximum-entropy density"
                description="The density on the midpoint grid, p(x) ∝ exp(Σ λ f(x))."
                series={[{ label: 'Maximum-entropy density', points: solved.support.map((x, i) => ({ x, y: solved.density[i] })), area: true }]}
                xLabel="x"
                yLabel="Density"
                note="The exponential family form is not an assumption: it is forced by maximising entropy under moment constraints."
              />
            </div>
            <Badge variant="numerical">numerical</Badge>
            <ExplanationPanel explanation={solved.explanation} />
          </>
        )}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Estimating from data                                            */
/* ------------------------------------------------------------------ */

function EstimationSection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeEstimation> }) {
  const { entropy, mi, table } = data;
  const unit = config.base;
  const perm = mi.permutation;
  return (
    <>
      <Card title="Observed counts">
        <TextField
          label="Counts per outcome"
          value={config.countsText}
          onChange={(countsText) => set({ countsText })}
          hint="Whole numbers separated by spaces or commas — how many times each outcome occurred."
          monospace
        />
        <NumberField
          label="Known alphabet size (0 if unknown)"
          value={config.alphabetSize}
          onChange={(alphabetSize) => set({ alphabetSize })}
          min={0}
          max={10_000}
          integer
          hint="Several corrections need the number of outcomes that could have occurred. Leave it at 0 and the number observed is used instead, which under-corrects — the engine says so."
        />
        <TextField
          label="Contingency table of counts"
          value={config.contingencyText}
          onChange={(contingencyText) => set({ contingencyText })}
          multiline
          rows={4}
          hint="One row of counts per line, for the mutual information between two categorical variables."
          monospace
        />
      </Card>

      <Card title="Entropy from data: five estimators" actions={<Badge variant="empirical">empirical</Badge>}>
        <KeyValueList
          items={[
            { label: 'Observations', value: String(entropy.n) },
            { label: 'Distinct outcomes seen', value: String(entropy.observedOutcomes) },
            { label: 'Seen exactly once (Good–Turing f₁)', value: String(entropy.singletons) },
            { label: 'Seen exactly twice', value: String(entropy.doubletons) },
            { label: 'Good–Turing coverage 1 − f₁/n', value: formatPercent(entropy.coverage, 3) },
            {
              label: 'Alphabet size used',
              value: entropy.assumedAlphabetSize !== undefined ? String(entropy.assumedAlphabetSize) : `${entropy.observedOutcomes} (the observed count, substituted because the true size was not given)`,
            },
            { label: 'Recommended for this sample', value: entropy.recommended },
          ]}
        />
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            caption="Entropy estimators with their bias directions"
            columns={
              [
                { key: 'n', header: 'Estimator', render: (r) => r.name },
                { key: 'v', header: `Estimate (${unit})`, numeric: true, render: (r) => (Number.isFinite(r.value) ? formatValue(r.value, 6) : 'undefined for this sample') },
                { key: 'c', header: `Correction (${unit})`, numeric: true, render: (r) => formatValue(r.correction, 6) },
                { key: 'b', header: 'Remaining bias', render: (r) => r.biasDirection },
                { key: 'x', header: 'Why', render: (r) => <span style={{ fontSize: 11.5 }}>{r.note}</span> },
              ] as ColumnDef<(typeof entropy.estimates)[number]>[]
            }
            rows={entropy.estimates}
          />
        </div>
        <Notice tone="warning" title="There is no single number to report here">
          The plug-in estimator is biased DOWNWARD, badly so for small samples: outcomes that never occurred contribute nothing, and observed
          frequencies are always more even than the truth. With {entropy.n} observations over {entropy.observedOutcomes} outcomes the spread between
          these estimators is the honest measure of how little the sample determines. Reporting the uncorrected value as &ldquo;the entropy&rdquo; is
          false precision.
        </Notice>
        <Notice tone="info">
          The Good–Turing coverage of {formatPercent(entropy.coverage, 3)} estimates the share of the probability mass that the observed outcomes
          account for. The remainder belongs to outcomes you have not seen, and no estimator can tell you what their probabilities are.
        </Notice>
        <ExplanationPanel explanation={entropy.explanation} />
      </Card>

      <Card title="Mutual information from a contingency table" actions={<Badge variant="empirical">empirical</Badge>}>
        <KeyValueList
          items={[
            { label: 'Table', value: `${mi.rows} × ${mi.cols}, ${mi.n} observations` },
            { label: 'Plug-in estimate', value: `${formatValue(mi.plugIn, 6)} ${unit}` },
            { label: 'Miller–Madow corrected', value: `${formatValue(mi.millerMadow, 6)} ${unit}` },
            { label: 'Correction applied', value: `${formatValue(mi.correction, 6)} ${unit}` },
            { label: 'Bias of the plug-in estimate', value: mi.biasDirection },
          ]}
        />
        <Notice tone="warning" title="Estimated mutual information is positive even for independent variables">
          The plug-in estimate of I has expectation roughly (r−1)(c−1)/2n under independence, so a positive value is not evidence of dependence. Only
          a comparison against the permutation null is.
        </Notice>
        {!perm ? (
          <>
            <NumberField
              label="Permutations"
              value={config.permutations}
              onChange={(permutations) => set({ permutations })}
              min={20}
              max={5000}
              integer
              hint="Each permutation reshuffles the pairing and recomputes the mutual information."
            />
            <Notice tone="info" title="The permutation test is not run automatically">
              {config.permutations} permutations of {table.flat().reduce((a, b) => a + b, 0)} paired observations is {config.permutations} shuffles
              and {config.permutations} full recomputations of the table. On a larger sample that is seconds of synchronous work, so it runs only on
              request.
            </Notice>
            <div className="oc-btn-row">
              <Button icon="play" variant="primary" onClick={() => set({ runPermutation: true })}>
                Run the permutation test
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="oc-btn-row">
              <Button icon="reset" size="sm" onClick={() => set({ runPermutation: false })}>
                Clear the test
              </Button>
            </div>
            <KeyValueList
              items={[
                { label: 'Observed I', value: `${formatValue(perm.observed, 6)} ${unit}` },
                { label: 'Mean I under independence', value: `${formatValue(perm.nullMean, 6)} ${unit} — note that this is not zero` },
                { label: 'Standard deviation of the null', value: `${formatValue(perm.nullSd, 6)} ${unit}` },
                { label: '95th percentile of the null', value: `${formatValue(perm.null95, 6)} ${unit}` },
                { label: 'Permutations', value: String(perm.permutations) },
                { label: 'p-value (1 + #{I* ≥ I}) / (1 + B)', value: formatValue(perm.pValue, 4) },
                {
                  label: `Decision at α = ${perm.alpha}`,
                  value: perm.reject
                    ? 'The independence null is rejected: the observed dependence is larger than reshuffling produces.'
                    : 'The independence null is not rejected: this much apparent dependence is what reshuffling produces anyway.',
                },
              ]}
            />
            <Notice tone="info">{perm.note}</Notice>
          </>
        )}
        <ExplanationPanel explanation={mi.explanation} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Forecast scoring                                                */
/* ------------------------------------------------------------------ */

function ScoringSection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeScoring> }) {
  const { brier, log, cal, climatology, skill, crpsMean, pit, n, contN } = data;
  const unit = config.base;
  return (
    <>
      <Card title="The forecast record">
        <TextField
          label="Binary forecasts: probability, then outcome"
          value={config.forecastRecord}
          onChange={(forecastRecord) => set({ forecastRecord })}
          multiline
          rows={8}
          hint="One forecast per line, for example “0.7 1”: a 70% forecast for something that happened. Replace this example record with your own."
          monospace
        />
        <NumberField label="Reliability-diagram bins" value={config.calibrationBins} onChange={(calibrationBins) => set({ calibrationBins })} min={2} max={20} integer />
      </Card>

      <Card title="Brier score and its Murphy decomposition" actions={<ExactnessBadge exactness={brier.exactness} />}>
        <div className="oc-result-hero">
          <span className="oc-result-hero__label">Brier score over {n} forecasts (lower is better)</span>
          <span className="oc-result-hero__value">{formatValue(brier.brierScore, 6)}</span>
          <span className="oc-result-hero__detail">Base rate {formatPercent(brier.baseRate, 3)}</span>
        </div>
        <KeyValueList
          items={[
            { label: 'Reliability (calibration error; 0 is perfect)', value: formatValue(brier.reliability, 6) },
            { label: 'Resolution (larger is better)', value: formatValue(brier.resolution, 6) },
            { label: 'Uncertainty ō(1−ō) (not under your control)', value: formatValue(brier.uncertainty, 6) },
            { label: 'Within-bin term', value: formatValue(brier.withinBinTerm, 6) },
            { label: 'Grouping', value: brier.binning === 'distinct-values' ? 'by distinct forecast value, so the identity is exact' : 'fixed bins' },
          ]}
        />
        <CheckRow
          label="reliability − resolution + uncertainty + within-bin = Brier score"
          holds={brier.decompositionExact}
          detail={`${formatValue(brier.reliability, 8)} − ${formatValue(brier.resolution, 8)} + ${formatValue(brier.uncertainty, 8)} + ${formatValue(
            brier.withinBinTerm,
            8,
          )} = ${formatValue(brier.decompositionTotal, 8)} against the score ${formatValue(brier.brierScore, 8)}; residual ${brier.decompositionResidual.toExponential(2)}`}
        />
        <ExplanationPanel explanation={brier.explanation} />
      </Card>

      <Card title="Skill against the base rate" actions={<ExactnessBadge exactness={skill.exactness} />}>
        <KeyValueList
          items={[
            { label: 'Brier score', value: formatValue(skill.score, 6) },
            { label: `Brier score of the constant forecast p = ${formatValue(climatology.baseRate, 4)}`, value: formatValue(skill.referenceScore, 6) },
            { label: 'Skill score', value: formatValue(skill.skill, 6) },
            { label: 'Reference', value: skill.reference },
          ]}
        />
        <Notice tone="info">
          A raw Brier score means nothing on its own: 0.2 is excellent for a coin flip and terrible for a near-certain event. Skill is 1 for a
          perfect forecast, 0 for one no better than always predicting the base rate, and negative for one worse than that. Skill scores are not
          themselves proper, so they can be gamed where the underlying score cannot.
        </Notice>
        <ExplanationPanel explanation={skill.explanation} />
      </Card>

      <Card title="Logarithmic score" actions={<ExactnessBadge exactness={log.exactness} />}>
        {log.finite ? (
          <KeyValueList
            items={[
              { label: 'Mean negative log score (lower is better)', value: `${formatValue(log.value, 6)} ${unit}` },
              { label: 'Forecasts scored', value: String(log.n) },
            ]}
          />
        ) : (
          <Notice tone="warning" title="The logarithmic score is infinite">
            {log.offendingIndices.length} forecast(s) assigned probability 0 to what then happened (line
            {log.offendingIndices.length === 1 ? ' ' : 's '}
            {log.offendingIndices.map((i) => i + 1).join(', ')}). That is the correct answer, and it is not replaced by a large finite number: the log
            score exists precisely to make an impossible-but-observed outcome unaffordable.
          </Notice>
        )}
        <ExplanationPanel explanation={log.explanation} />
      </Card>

      <Card title="Calibration and sharpness, reported separately" actions={<Badge variant="empirical">empirical</Badge>}>
        <div style={{ overflowX: 'auto' }}>
          <CalibrationChart
            title="Reliability diagram"
            description="Each point compares the mean forecast in a bin with the frequency that was observed. The diagonal is perfect calibration; the marker area scales with the number of forecasts in the bin, so a sparsely populated bin looks small."
            bins={cal.bins
              .filter((b) => b.count > 0)
              .map((b) => ({ predicted: b.meanForecast, observed: b.observedFrequency, n: b.count, lower: b.interval.low, upper: b.interval.high }))}
            baseRate={climatology.baseRate}
            note="The intervals are Wilson intervals for the observed frequency in each bin — the uncertainty of the point, not a range of outcomes."
          />
        </div>
        <KeyValueList
          items={[
            { label: 'Expected calibration error (ECE)', value: formatValue(cal.ece, 6) },
            { label: 'Maximum calibration error (MCE)', value: `${formatValue(cal.mce, 6)}${cal.mceBin >= 0 ? ` in bin ${cal.mceBin + 1}` : ''}` },
            { label: 'Sharpness: variance of the forecasts', value: formatValue(cal.sharpness.forecastVariance, 6) },
            { label: 'Sharpness: mean p(1−p)', value: formatValue(cal.sharpness.meanPredictiveVariance, 6) },
            { label: 'Sharpness: share outside 0.4–0.6', value: formatPercent(cal.sharpness.fractionDecisive, 3) },
          ]}
        />
        <Notice tone="info" title="Maximum sharpness subject to calibration">
          {cal.sharpness.note}
        </Notice>
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            caption="Reliability bins"
            columns={
              [
                { key: 'r', header: 'Forecast range', render: (b) => `${formatValue(b.lower, 3)} – ${formatValue(b.upper, 3)}` },
                { key: 'n', header: 'Forecasts', numeric: true, render: (b) => String(b.count) },
                { key: 'p', header: 'Mean forecast', numeric: true, render: (b) => (b.count ? formatValue(b.meanForecast, 4) : '—') },
                { key: 'o', header: 'Observed frequency', numeric: true, render: (b) => (b.count ? formatValue(b.observedFrequency, 4) : '—') },
                {
                  key: 'i',
                  header: '95% interval for the frequency',
                  render: (b) => (b.count ? `${formatValue(b.interval.low, 3)} – ${formatValue(b.interval.high, 3)}` : b.interval.method),
                },
                { key: 'g', header: 'Gap (observed − forecast)', numeric: true, render: (b) => (b.count ? formatValue(b.gap, 4) : '—') },
              ] as ColumnDef<(typeof cal.bins)[number]>[]
            }
            rows={cal.bins}
          />
        </div>
        <ExplanationPanel explanation={cal.explanation} />
      </Card>

      <Card title="Continuous forecasts: CRPS and the PIT" actions={<Badge variant="empirical">empirical</Badge>}>
        <TextField
          label="Normal predictive forecasts: mean, standard deviation, observed value"
          value={config.continuousRecord}
          onChange={(continuousRecord) => set({ continuousRecord })}
          multiline
          rows={6}
          hint="One forecast per line, for example “0 1 1.4”: a N(0,1) forecast and the value 1.4 that occurred."
          monospace
        />
        <NumberField label="PIT histogram bins" value={config.pitBins} onChange={(pitBins) => set({ pitBins })} min={2} max={20} integer />
        <KeyValueList
          items={[
            { label: `Mean CRPS over ${contN} forecasts`, value: `${formatValue(crpsMean, 6)} (in the units of the observation)` },
            { label: 'PIT mean (½ under calibration)', value: formatValue(pit.mean, 6) },
            { label: 'PIT variance (1/12 ≈ 0.0833 under calibration)', value: formatValue(pit.variance, 6) },
            { label: `χ² against uniformity, ${pit.degreesOfFreedom} degrees of freedom`, value: formatValue(pit.chiSquared, 6) },
            { label: 'Expected count per bin', value: formatValue(pit.expected, 4) },
          ]}
        />
        <div style={{ overflowX: 'auto' }}>
          <BarChart
            title="PIT histogram"
            description="The predictive CDF evaluated at the value that occurred. Uniform if and only if the forecasts are calibrated; the shape of any departure diagnoses the failure."
            data={pit.counts.map((c, i) => ({ x: (i + 0.5) / pit.bins, y: c, compare: pit.expected, label: `${formatValue(i / pit.bins, 2)}–${formatValue((i + 1) / pit.bins, 2)}` }))}
            xLabel="PIT value"
            yLabel="Forecasts"
            seriesLabel="Observed"
            compareLabel="Expected under calibration"
          />
        </div>
        <Notice tone="info" title="Diagnosis">
          {pit.diagnosis}
        </Notice>
        <Notice tone="info">
          CRPS has the units of the observation, so it cannot be compared across variables measured differently, and it reduces to the absolute error
          for a point forecast. It is proper but less sensitive to the tails than the log score.
        </Notice>
        <ExplanationPanel explanation={pit.explanation} />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Propriety                                                       */
/* ------------------------------------------------------------------ */

function ProprietySection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computePropriety> }) {
  const { checks } = data;
  const p = config.trueProbability;
  return (
    <>
      <Card title="Is a scoring rule proper?">
        <NumberField
          label="True probability of the event"
          symbol="p"
          value={config.trueProbability}
          onChange={(trueProbability) => set({ trueProbability })}
          min={0}
          max={1}
          step={0.05}
          hint="The expected score E_p[S(r, O)] = p·S(r,1) + (1−p)·S(r,0) is computed over a grid of reported probabilities r, and the minimum is located."
        />
        <Notice tone="info">
          A rule is proper when reporting the truth minimises your expected penalty, so that honesty is optimal. An improper rule pays you to
          misreport. This panel demonstrates the difference by computation rather than asserting it.
        </Notice>
      </Card>

      <Card title="Expected score against the reported probability" actions={<Badge variant="numerical">numerical</Badge>}>
        <div style={{ overflowX: 'auto' }}>
          <LineChart
            title={`Expected score when the true probability is ${formatValue(p, 4)}`}
            description="Each curve is one scoring rule's expected penalty as a function of what you report. A proper rule bottoms out at the truth."
            series={checks.map((c) => ({ label: `${c.rule} score`, points: c.grid.map((r, i) => ({ x: r, y: c.expectedScores[i] })) }))}
            xLabel="Reported probability r"
            yLabel="Expected score (lower is better)"
            referenceLines={[{ value: p, label: `the truth, p = ${formatValue(p, 4)}`, axis: 'x' }]}
            markers={checks.map((c) => ({ x: c.optimalReport, y: c.optimalScore, label: `${c.rule}: optimum at r = ${formatValue(c.optimalReport, 4)}` }))}
            note="The log score curve runs to infinity at both ends; the grid is trimmed slightly away from 0 and 1 so that it stays finite and plottable."
          />
        </div>
      </Card>

      {checks.map((c) => (
        <Card key={c.rule} title={`The ${c.rule} score`} actions={<Badge variant="numerical">numerical</Badge>}>
          <CheckRow
            label={`Minimised at the true probability p = ${formatValue(p, 4)}`}
            holds={c.optimisedAtTruth}
            detail={`optimum at r = ${formatValue(c.optimalReport, 6)}, expected score ${formatValue(c.optimalScore, 6)}; expected score at the truth ${formatValue(
              c.scoreAtTruth,
              6,
            )}`}
          />
          <p style={{ fontSize: 12.5, margin: 0 }}>{c.verdict}</p>
          <ExplanationPanel explanation={c.explanation} />
        </Card>
      ))}

      <Card title="Why this matters" variant="inset">
        <p style={{ fontSize: 12.5, margin: 0 }}>
          The absolute score is the one shown failing. Its expected value is minimised by reporting 0 or 1 — whichever is more likely — so it rewards
          pretending to be certain, and any forecaster scored on it should exaggerate. Checking one value of p demonstrates the behaviour at that p
          rather than proving propriety for all p; move p and the pattern holds for the proper rules and breaks for the absolute score.
        </p>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 8. Channel capacity and experimental design                        */
/* ------------------------------------------------------------------ */

function ChannelSection({ config, set, data }: { config: InformationConfig; set: Setter; data: ReturnType<typeof computeChannel> }) {
  const { bsc, fisher, fisherResult, prior, design, bscNumerical, general } = data;
  const unit = config.base;
  const thetaLabels = config.prior.map((_, i) => `θ${i + 1}`);
  const bscGap = bscNumerical ? Math.abs(bscNumerical.capacity - bsc.capacity) : null;
  return (
    <>
      <Card title="Binary symmetric channel">
        <NumberField
          label="Crossover probability"
          symbol="p"
          value={config.crossover}
          onChange={(crossover) => set({ crossover })}
          min={0}
          max={1}
          step={0.01}
          hint="The probability that a transmitted bit arrives flipped."
        />
        <KeyValueList
          items={[
            { label: 'Exact capacity', value: `${formatValue(bsc.capacity, 6)} ${unit}` },
            { label: 'Formula', value: bsc.formula },
          ]}
        />
        <Badge variant="exact">exact</Badge>
        <Notice tone="info">
          Capacity is zero at p = ½ — a channel that flips half the bits carries nothing — and maximal at both p = 0 and p = 1, because a channel
          that always flips is just a relabelling.
        </Notice>
      </Card>

      <Card title="Capacity of a general channel by Blahut–Arimoto">
        <TableEditor
          title="Channel matrix P(Y = y | X = x)"
          hint="Row x gives the distribution of the output when x is sent, so every row must sum to 1. A row that does not is refused with its actual sum."
          rowNames={config.channel.map((_, i) => `Input ${i + 1}`)}
          colNames={(config.channel[0] ?? []).map((_, j) => `Output ${j + 1}`)}
          table={config.channel}
          onChange={(channel) => set({ channel })}
          rowStochastic
        />
        {!general ? (
          <>
            <Notice tone="info" title="Blahut–Arimoto is not run automatically">
              <p style={{ marginTop: 0 }}>
                The algorithm alternates between the reverse channel and the input distribution until its own upper and lower bounds on the capacity
                close to within 1e-12, which can take many thousands of iterations. On a larger channel that is seconds of synchronous work, so it
                runs on request.
              </p>
              <p style={{ marginBottom: 0 }}>
                It is run here on both the matrix above and the binary symmetric channel, so the numerical answer can be checked against the exact
                1 − H(p).
              </p>
            </Notice>
            <div className="oc-btn-row">
              <Button icon="play" variant="primary" onClick={() => set({ runCapacity: true })}>
                Run Blahut–Arimoto
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="oc-btn-row">
              <Button icon="reset" size="sm" onClick={() => set({ runCapacity: false })}>
                Clear the capacity results
              </Button>
            </div>
            <KeyValueList
              items={[
                { label: 'Capacity of the matrix above', value: `${formatValue(general.capacity, 6)} ${unit}` },
                { label: 'Capacity-achieving input distribution', value: general.optimalInput.map((v) => formatValue(v, 4)).join(', ') },
                { label: 'Iterations', value: `${general.iterations}${general.converged ? ' (converged)' : ''}` },
                { label: 'Bound gap at the final iterate', value: `${general.boundGap.toExponential(3)} nats` },
              ]}
            />
            {bscNumerical && bscGap !== null && (
              <CheckRow
                label="Blahut–Arimoto on the binary symmetric channel reproduces 1 − H(p)"
                holds={bscGap <= 1e-9}
                detail={`numerical ${formatValue(bscNumerical.capacity, 10)} against exact ${formatValue(bsc.capacity, 10)} ${unit}; difference ${bscGap.toExponential(2)}`}
              />
            )}
            <Badge variant="numerical">numerical</Badge>
            <ExplanationPanel explanation={general.explanation} />
          </>
        )}
      </Card>

      <Card title="Fisher information and the Cramér–Rao bound" actions={<ExactnessBadge exactness={fisherResult.exactness} />}>
        <SelectField
          label="Model and parameter"
          value={config.fisherCase}
          onChange={(fisherCase) => set({ fisherCase: fisherCase as InformationConfig['fisherCase'] })}
          options={[
            { value: 'bernoulli-p', label: FISHER_CASES['bernoulli-p'].label },
            { value: 'poisson-lambda', label: FISHER_CASES['poisson-lambda'].label },
            { value: 'normal-mu', label: FISHER_CASES['normal-mu'].label },
          ]}
        />
        <NumberField label="Parameter value" symbol="θ" value={config.fisherValue} onChange={(fisherValue) => set({ fisherValue })} step={0.05} />
        <NumberField label="Observations" symbol="n" value={config.fisherSamples} onChange={(fisherSamples) => set({ fisherSamples })} min={1} max={100_000} integer />
        <KeyValueList
          items={[
            { label: 'Fisher information for one observation', value: formatValue(fisherResult.fisherInformation, 6) },
            { label: 'Formula', value: fisherResult.formula },
            ...(fisherResult.numerical !== undefined ? [{ label: 'Numerical cross-check', value: formatValue(fisherResult.numerical, 6) }] : []),
            {
              label: `Cramér–Rao bound on the variance from ${config.fisherSamples} observations`,
              value: formatValue(fisherResult.cramerRaoBound(config.fisherSamples), 8),
            },
            { label: 'Standard-error floor √(CRB)', value: formatValue(Math.sqrt(fisherResult.cramerRaoBound(config.fisherSamples)), 8) },
            { label: 'Jeffreys density √I(θ) at this θ', value: formatValue(fisherResult.jeffreysDensity, 6) },
          ]}
        />
        <Notice tone="info">
          The Cramér–Rao bound is a floor on the variance of any <em>unbiased</em> estimator. A biased estimator can sit below it, and no estimator is
          promised to reach it. It says what the data can possibly tell you about θ, not what any particular method will.
        </Notice>
        <ExplanationPanel explanation={fisherResult.explanation} />
      </Card>

      <Card title="The Jeffreys prior" actions={<Badge variant="numerical">numerical</Badge>}>
        <div style={{ overflowX: 'auto' }}>
          <LineChart
            title={`Jeffreys prior for ${fisher.label}`}
            description="π(θ) ∝ √I(θ), normalised over the plotted range."
            series={[{ label: 'π(θ)', points: prior.theta.map((t, i) => ({ x: t, y: prior.density[i] })), area: true }]}
            xLabel="θ"
            yLabel="Density"
          />
        </div>
        <KeyValueList
          items={[
            { label: 'Normalised over', value: `[${formatValue(prior.range.lower, 4)}, ${formatValue(prior.range.upper, 4)}]` },
            { label: 'Normalising integral ∫√I(θ) dθ', value: formatValue(prior.normalisingConstant, 6) },
            { label: 'Proper over this range?', value: prior.proper ? 'Yes' : 'No — the integral does not converge here, so the prior is improper and the range must be stated' },
          ]}
        />
        <Notice tone="info">
          The Jeffreys prior is the unique prior invariant under reparameterisation, which is what makes it the principled default when an
          uninformative one is wanted. On an unbounded parameter it is usually improper, so the range it was normalised over is part of the answer.
        </Notice>
        <ExplanationPanel explanation={prior.explanation} />
      </Card>

      <Card title="Which experiment should you run?" actions={<ExactnessBadge exactness={design.exactness} />}>
        <VectorEditor title="Prior over θ" hint="One probability per possible value of θ. It must sum to 1." names={null} values={config.prior} onChange={(_n, p) => set({ prior: p })} />
        <TableEditor
          title="Design A: P(outcome | θ)"
          hint="One row per value of θ, one column per possible outcome of the experiment. Each row must sum to 1."
          rowNames={thetaLabels}
          colNames={(config.designA[0] ?? []).map((_, j) => `Outcome ${j + 1}`)}
          table={config.designA}
          onChange={(designA) => set({ designA })}
          rowStochastic
        />
        <TableEditor
          title="Design B: P(outcome | θ)"
          hint="The competing experiment, on the same prior."
          rowNames={thetaLabels}
          colNames={(config.designB[0] ?? []).map((_, j) => `Outcome ${j + 1}`)}
          table={config.designB}
          onChange={(designB) => set({ designB })}
          rowStochastic
        />
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            caption="Expected information gain of each design"
            columns={
              [
                { key: 'n', header: 'Design', render: (d) => d.name },
                { key: 'e', header: `Expected gain (${unit})`, numeric: true, render: (d) => formatValue(d.expectedInformationGain, 6) },
                { key: 'f', header: 'Share of prior uncertainty removed', numeric: true, render: (d) => formatPercent(d.fractionOfPriorEntropy, 3) },
                { key: 'p', header: `Expected uncertainty left (${unit})`, numeric: true, render: (d) => formatValue(d.expectedPosteriorEntropy, 6) },
              ] as ColumnDef<(typeof design.evaluations)[number]>[]
            }
            rows={design.evaluations}
          />
        </div>
        <KeyValueList
          items={[
            { label: 'Prior entropy H(θ)', value: `${formatValue(design.priorEntropy, 6)} ${unit}` },
            { label: 'Best design', value: design.best },
          ]}
        />
        <Notice tone="info">
          The expectation runs over the outcomes the design could produce, weighted by the prior predictive, so the gain is computable before the
          experiment is run — which is the point. It is the same quantity as I(θ; Y), and it ignores cost: gain per unit cost may order the designs
          differently.
        </Notice>
        <ExplanationPanel explanation={design.explanation} />
      </Card>
    </>
  );
}
