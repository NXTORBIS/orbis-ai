/**
 * Elicitation: turning a human judgement into a usable distribution, and
 * measuring whether the judge is any good.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * The engine's `Exactness` has four values and `assumed` — a number supplied
 * as somebody's opinion — was the only one with no tooling behind it. Yet most
 * real inputs to this application are opinions. Every result on this screen
 * therefore carries `assumed`, and the screen says so in as many words: a
 * number derived from an opinion must never be presented with the authority of
 * a measurement.
 *
 * PERFORMANCE
 * -----------
 * Only the active mode computes, and the two genuinely slow things — the
 * fit across the whole distribution registry, and Cooke's method with
 * leave-one-seed-out cross-validation — sit behind explicit buttons with the
 * cost stated. Nothing on the default view scans the registry.
 *
 * Every number comes from `src/engine/elicitation/`. Nothing is recomputed
 * locally, nothing is substituted when the engine refuses: the engine's own
 * message is rendered, per section.
 */
import { useMemo } from 'react';
import {
  checkConjunction,
  checkPartitionCoherence,
  checkSubadditivity,
  cookeClassicalMethod,
  correlatedExpertAggregate,
  crossValidateWeighting,
  detectAnchoring,
  detectPartitionDependence,
  disagreementMeasures,
  elicitImpreciseProbabilities,
  elicitImpreciseQuantiles,
  fitChipAllocation,
  fitElicitedQuantiles,
  FRAMING_NOTES,
  intervalCalibration,
  maximumEntropyCompletion,
  nextBisectionQuestion,
  nextFixedIntervalQuestion,
  POOL_COMPARISON_NOTE,
  comparePools,
  quantilesFromInterval,
  readProbabilityWheel,
  scoreBinaryRecord,
  scoreContinuousRecord,
  UNIVERSAL_ELICITATION_CAVEATS,
  type AdjustmentRule,
  type AnchoredJudgement,
  type ElicitedQuantile,
  type ExpertDistribution,
  type ExpertSeedRecord,
  type Framing,
  type IntervalProbabilityJudgement,
  type IntervalQuantileJudgement,
  type JudgementBasis,
  type PartialJudgement,
  type PartitionAssessment,
  type PredictiveJudgement,
  type StatedInterval,
  type StatedProbability,
} from '../../engine/elicitation';
import { EngineError, type Explanation } from '../../engine/core/result';
import { getDistribution } from '../../engine/distributions/registry';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  ProbabilityField,
  SelectField,
  Segmented,
  TextField,
} from '../../ui/primitives';
import { BarChart, LineChart, ScatterChart } from '../../ui/charts/charts';
import { CalibrationChart } from '../../ui/charts/advanced';
import { formatValue } from '../../ui/charts/scale';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

type ElicitationMode = 'belief' | 'fit' | 'protocol' | 'know' | 'coherence' | 'experts' | 'track';

export interface ElicitationConfig {
  mode: ElicitationMode;

  /* 1 — state a belief */
  beliefForm: 'interval' | 'quantiles' | 'chips';
  median: number;
  intervalLower: number;
  intervalUpper: number;
  credibleLevel: number;
  /** Arbitrary stated quantiles, "level: value" per line. Also the protocol's answer record. */
  quantileText: string;
  chipEdges: string;
  chipCounts: string;

  /* 2 — fit a distribution */
  runFit: boolean;
  tieFactor: number;

  /* 3 — run a protocol */
  protocol: 'bisection' | 'fixed-interval';
  protocolAnswer: number;
  plausibleLower: number;
  plausibleUpper: number;
  wheelFraction: number;

  /* 4 — say only what you know */
  knowForm: 'maxent' | 'imprecise-probabilities' | 'imprecise-quantiles';
  support: 'reals' | 'positive-halfline' | 'bounded';
  statedMean: number;
  useVariance: boolean;
  statedVariance: number;
  supportLower: number;
  supportUpper: number;
  impreciseProbText: string;
  impreciseQuantileText: string;

  /* 5 — coherence and bias */
  coherenceCheck: 'partition' | 'conjunction' | 'subadditivity' | 'partition-dependence' | 'anchoring';
  partitionText: string;
  showAdjustment: boolean;
  adjustRule: AdjustmentRule;
  labelA: string;
  labelB: string;
  probA: number;
  probB: number;
  probAandB: number;
  useProbAorB: boolean;
  probAorB: number;
  wholeLabel: string;
  wholeProbability: number;
  partsText: string;
  coarsePartitionText: string;
  coarseTargets: string;
  finePartitionText: string;
  fineTargets: string;
  anchorText: string;

  /* 6 — combining experts */
  expertForm: 'pools' | 'correlated' | 'cooke';
  /** "Name: mean, sd" per line; read as a normal distribution for that expert. */
  expertText: string;
  poolWeightsText: string;
  expertCorrelation: number;
  seedExpertText: string;
  seedRealisationText: string;
  runExpertWeighting: boolean;

  /* 7 — was the judge any good? */
  trackForm: 'intervals' | 'binary' | 'continuous';
  intervalRecordText: string;
  nominalLevel: number;
  binaryRecordText: string;
  continuousRecordText: string;
  calibrationBins: number;
}

/**
 * The default opens on the coherence check with a partition that is NOT
 * coherent — the sum is 1.15 — because that is the most valuable thing this
 * screen does and it has to be visible without any input. Nothing here scans
 * the distribution registry, so first paint is a handful of milliseconds.
 */
export const ELICITATION_DEFAULT: ElicitationConfig = {
  mode: 'coherence',

  beliefForm: 'interval',
  median: 200,
  intervalLower: 120,
  intervalUpper: 460,
  credibleLevel: 0.9,
  quantileText: '0.05: 120\n0.25: 165\n0.5: 200\n0.75: 275\n0.95: 460',
  chipEdges: '0, 100, 200, 300, 400, 600',
  chipCounts: '1, 5, 7, 4, 3',

  runFit: false,
  tieFactor: 1.5,

  protocol: 'bisection',
  protocolAnswer: 200,
  plausibleLower: 50,
  plausibleUpper: 600,
  wheelFraction: 0.3,

  knowForm: 'maxent',
  support: 'positive-halfline',
  statedMean: 200,
  useVariance: false,
  statedVariance: 10000,
  supportLower: 0,
  supportUpper: 600,
  impreciseProbText: 'On time: 0.5, 0.7\nLate: 0.2, 0.4\nAbandoned: 0.02, 0.1',
  impreciseQuantileText: '0.05: 100, 140\n0.5: 190, 230\n0.95: 400, 520',

  coherenceCheck: 'partition',
  partitionText: 'Delivered on time: 0.55\nDelivered late: 0.4\nCancelled: 0.2',
  showAdjustment: false,
  adjustRule: 'least-squares',
  labelA: 'The supplier is late',
  labelB: 'The supplier blames a shortage',
  probA: 0.3,
  probB: 0.25,
  probAandB: 0.35,
  useProbAorB: false,
  probAorB: 0.45,
  wholeLabel: 'The project slips',
  wholeProbability: 0.3,
  partsText: 'Slips on staffing: 0.2\nSlips on supply: 0.15\nSlips on scope: 0.18\nSlips for another reason: 0.1',
  coarsePartitionText: 'Slips: 0.3\nDoes not slip: 0.7',
  coarseTargets: 'Slips',
  finePartitionText: 'Slips on staffing: 0.2\nSlips on supply: 0.18\nSlips on scope: 0.17\nDoes not slip: 0.45',
  fineTargets: 'Slips on staffing, Slips on supply, Slips on scope',
  anchorText: 'Q1: 100, 140\nQ2: 300, 330\nQ3: 500, 520\nQ4: 700, 690\nQ5: 900, 870',

  expertForm: 'pools',
  expertText: 'Ana: 180, 30\nBen: 260, 35\nCara: 200, 60',
  poolWeightsText: '',
  expertCorrelation: 0.7,
  seedExpertText: 'Ana: 8, 11, 14 ; 90, 120, 150 ; 3, 5, 9 ; 40, 55, 70\nBen: 5, 12, 30 ; 60, 130, 260 ; 2, 6, 18 ; 25, 60, 140\nCara: 11, 12, 13 ; 118, 124, 130 ; 5, 6, 7 ; 54, 57, 60',
  seedRealisationText: '10, 128, 7, 61',
  runExpertWeighting: false,

  trackForm: 'intervals',
  intervalRecordText:
    '80, 120, 131\n150, 200, 190\n40, 60, 72\n300, 420, 455\n18, 25, 21\n900, 1100, 1310\n5, 9, 11\n210, 260, 248\n60, 75, 92\n33, 41, 38\n470, 530, 610\n120, 160, 155',
  nominalLevel: 0.9,
  binaryRecordText:
    '0.9, 1\n0.8, 1\n0.7, 0\n0.6, 1\n0.9, 1\n0.3, 0\n0.2, 0\n0.95, 1\n0.5, 1\n0.4, 0\n0.85, 0\n0.75, 1\n0.1, 0\n0.65, 1\n0.55, 0\n0.25, 0\n0.98, 1\n0.45, 1\n0.35, 0\n0.7, 1',
  continuousRecordText:
    '100, 10, 118\n200, 20, 165\n50, 5, 61\n400, 40, 470\n25, 3, 22\n1000, 100, 1240\n7, 1, 9\n240, 24, 231\n70, 7, 88\n37, 4, 34\n500, 50, 610\n140, 14, 150',
  calibrationBins: 6,
};

/* ------------------------------------------------------------------ */
/* Parsing: the config holds text, the engine takes structures.       */
/* Every parse failure is reported, never defaulted away.             */
/* ------------------------------------------------------------------ */

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function lines(text: string): string[] {
  return text
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function numberList(text: string): Parsed<number[]> {
  const parts = text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v)) return { ok: false, error: `"${p}" is not a number.` };
    out.push(v);
  }
  return { ok: true, value: out };
}

/** "label: a, b, c" → the label and its numbers. */
function labelledNumbers(line: string, expect: number): Parsed<{ label: string; values: number[] }> {
  const idx = line.lastIndexOf(':');
  if (idx < 0) return { ok: false, error: `"${line}" is missing the colon between the label and the numbers.` };
  const label = line.slice(0, idx).trim();
  if (!label) return { ok: false, error: `"${line}" has an empty label.` };
  const nums = numberList(line.slice(idx + 1));
  if (!nums.ok) return { ok: false, error: `In "${line}": ${nums.error}` };
  if (nums.value.length !== expect) {
    return { ok: false, error: `"${line}" gives ${nums.value.length} number(s); ${expect} were expected.` };
  }
  return { ok: true, value: { label, values: nums.value } };
}

function parseQuantileText(text: string): Parsed<ElicitedQuantile[]> {
  const rows = lines(text);
  if (!rows.length) return { ok: false, error: 'No quantiles have been stated yet.' };
  const out: ElicitedQuantile[] = [];
  for (const row of rows) {
    const p = labelledNumbers(row, 1);
    if (!p.ok) return { ok: false, error: `${p.error} Each line is "level: value", for example "0.5: 200".` };
    const level = Number(p.value.label);
    if (!Number.isFinite(level)) return { ok: false, error: `"${p.value.label}" is not a probability level.` };
    out.push({ level, value: p.value.values[0] });
  }
  return { ok: true, value: out };
}

function parseStatedProbabilities(text: string): Parsed<StatedProbability[]> {
  const out: StatedProbability[] = [];
  for (const row of lines(text)) {
    const p = labelledNumbers(row, 1);
    if (!p.ok) return { ok: false, error: `${p.error} Each line is "label: probability".` };
    out.push({ label: p.value.label, probability: p.value.values[0] });
  }
  if (!out.length) return { ok: false, error: 'No stated probabilities were entered.' };
  return { ok: true, value: out };
}

function parseRows(text: string, expect: number, shape: string): Parsed<number[][]> {
  const out: number[][] = [];
  for (const row of lines(text)) {
    const nums = numberList(row);
    if (!nums.ok) return { ok: false, error: `In "${row}": ${nums.error}` };
    if (nums.value.length !== expect) {
      return { ok: false, error: `"${row}" has ${nums.value.length} number(s); each line must be ${shape}.` };
    }
    out.push(nums.value);
  }
  if (!out.length) return { ok: false, error: `No rows were entered. Each line must be ${shape}.` };
  return { ok: true, value: out };
}

/** The judge's experts, read as normal distributions: "Name: mean, sd". */
function parseExperts(text: string): Parsed<ExpertDistribution[]> {
  const out: ExpertDistribution[] = [];
  for (const row of lines(text)) {
    const p = labelledNumbers(row, 2);
    if (!p.ok) return { ok: false, error: `${p.error} Each line is "name: mean, standard deviation".` };
    out.push({ expert: p.value.label, distributionId: 'normal', params: { mu: p.value.values[0], sigma: p.value.values[1] } });
  }
  if (!out.length) return { ok: false, error: 'No experts were entered.' };
  return { ok: true, value: out };
}

function parseSeedRecords(text: string, questions: number): Parsed<ExpertSeedRecord[]> {
  const out: ExpertSeedRecord[] = [];
  for (const row of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const idx = row.indexOf(':');
    if (idx < 0) return { ok: false, error: `"${row}" is missing the colon after the expert's name.` };
    const expert = row.slice(0, idx).trim();
    const groups = row
      .slice(idx + 1)
      .split(';')
      .map((g) => g.trim())
      .filter(Boolean);
    if (groups.length !== questions) {
      return {
        ok: false,
        error: `${expert} answered ${groups.length} seed question(s) but ${questions} realisation(s) were given. Separate each seed question with ";".`,
      };
    }
    const assessments: { question: string; values: number[] }[] = [];
    for (let i = 0; i < groups.length; i++) {
      const nums = numberList(groups[i]);
      if (!nums.ok) return { ok: false, error: `In ${expert}'s seed ${i + 1}: ${nums.error}` };
      assessments.push({ question: `Seed ${i + 1}`, values: nums.value });
    }
    out.push({ expert, assessments });
  }
  if (!out.length) return { ok: false, error: 'No expert seed records were entered.' };
  return { ok: true, value: out };
}

/* ------------------------------------------------------------------ */
/* Engine calls are wrapped so one refusal does not blank the screen. */
/* ------------------------------------------------------------------ */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Resolve whichever belief form is selected into elicited quantiles. */
function beliefQuantiles(config: ElicitationConfig): Parsed<ElicitedQuantile[]> {
  if (config.beliefForm === 'quantiles') return parseQuantileText(config.quantileText);
  if (config.beliefForm === 'interval') {
    const a = attempt(() => quantilesFromInterval(config.median, config.intervalLower, config.intervalUpper, config.credibleLevel));
    return a.ok ? { ok: true, value: a.value } : { ok: false, error: a.error };
  }
  return { ok: false, error: 'The chip allocation states bin probabilities, not quantiles directly.' };
}

function chipBins(config: ElicitationConfig): Parsed<{ lower: number; upper: number; chips: number }[]> {
  const edges = numberList(config.chipEdges);
  if (!edges.ok) return { ok: false, error: `Bin edges: ${edges.error}` };
  const counts = numberList(config.chipCounts);
  if (!counts.ok) return { ok: false, error: `Chip counts: ${counts.error}` };
  if (edges.value.length !== counts.value.length + 1) {
    return {
      ok: false,
      error: `${edges.value.length} edges define ${Math.max(0, edges.value.length - 1)} bins, but ${counts.value.length} chip count(s) were given.`,
    };
  }
  return {
    ok: true,
    value: counts.value.map((chips, i) => ({ lower: edges.value[i], upper: edges.value[i + 1], chips })),
  };
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

function AssumedBadge({ basis }: { basis: JudgementBasis }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 'var(--s2)' }}>
      <Badge variant="assumed">User assumption</Badge>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{basis.method}</span>
    </div>
  );
}

function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (!warnings.length) return null;
  return <Notice tone="warning" title="What the engine wants you to know" items={[...warnings]} />;
}

function Caveats({ basis }: { basis: JudgementBasis }) {
  return (
    <Disclosure title={`Why this is an opinion, not a measurement (${basis.caveats.length} caveats)`} icon="alert">
      <p style={{ fontSize: 12.5, marginTop: 0 }}>
        <strong>Rests on:</strong> {basis.restsOn}
      </p>
      <ul style={{ fontSize: 12.5, paddingLeft: '1.1rem', margin: 0 }}>
        {basis.caveats.map((c) => (
          <li key={c} style={{ marginBottom: 4 }}>
            {c}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** Wide tables and charts must not push the page sideways at 390px. */
function Scroller({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: 'auto' }}>{children}</div>;
}

const MODE_OPTIONS: { value: ElicitationMode; label: string }[] = [
  { value: 'belief', label: 'State a belief' },
  { value: 'fit', label: 'Fit a distribution' },
  { value: 'protocol', label: 'Run a protocol' },
  { value: 'know', label: 'Say only what you know' },
  { value: 'coherence', label: 'Coherence and bias' },
  { value: 'experts', label: 'Combining experts' },
  { value: 'track', label: 'Was the judge any good?' },
];

const FRAMING_FOR_MODE: Record<ElicitationConfig['beliefForm'], Framing> = {
  interval: 'fixed-probability',
  quantiles: 'fixed-probability',
  chips: 'trial-roulette',
};

export function ElicitationTool({ config }: { config: ElicitationConfig }) {
  const app = useApp();
  const set = (patch: Partial<ElicitationConfig>) => app.updateConfig({ ...config, ...patch });

  const mode = config.mode;

  /* ---------------------------------------------------------- belief */
  const stated = useMemo(() => beliefQuantiles(config), [config]);

  const chips = useMemo(() => chipBins(config), [config]);

  // The chip fit runs the registry scan, so it is gated with the fit.
  const chipFit = useMemo(() => {
    if (!config.runFit || config.beliefForm !== 'chips' || !chips.ok) return null;
    return attempt(() => fitChipAllocation(chips.value, { tieFactor: config.tieFactor }));
  }, [config.runFit, config.beliefForm, config.tieFactor, chips]);

  /* ------------------------------------------------------------- fit */
  const fit = useMemo(() => {
    if (!config.runFit || (mode !== 'fit' && mode !== 'belief')) return null;
    if (config.beliefForm === 'chips') return chipFit && chipFit.ok ? { ok: true as const, value: chipFit.value.fit } : null;
    if (!stated.ok) return null;
    return attempt(() => fitElicitedQuantiles(stated.value, { tieFactor: config.tieFactor }));
  }, [config.runFit, config.beliefForm, config.tieFactor, mode, stated, chipFit]);

  /** CDFs of the families that fit equally well — the disagreement is the point. */
  const familyCurves = useMemo(() => {
    if (!fit || !fit.ok) return null;
    const result = fit.value;
    const values = result.stated.map((q) => q.value);
    const lo = values[0];
    const hi = values[values.length - 1];
    const span = hi - lo || Math.max(1, Math.abs(hi));
    const from = lo - span;
    const to = hi + 2 * span;
    const ids = result.familySensitivity.nearTiedFamilies.slice(0, 5);
    return ids.map((id) => {
      const f = result.fits.find((c) => c.distributionId === id);
      const def = getDistribution(id);
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i <= 120; i++) {
        const x = from + ((to - from) * i) / 120;
        const y = f ? def.cdf(x, f.params) : NaN;
        if (Number.isFinite(y)) points.push({ x, y });
      }
      return { label: def.name, points };
    });
  }, [fit]);

  /* -------------------------------------------------------- protocol */
  const protocolAnswers = useMemo(() => parseQuantileText(config.quantileText), [config.quantileText]);

  const nextQuestion = useMemo(() => {
    if (mode !== 'protocol') return null;
    const answers = protocolAnswers.ok ? protocolAnswers.value : [];
    if (config.protocol === 'bisection') return attempt(() => nextBisectionQuestion(answers));
    return attempt(() =>
      nextFixedIntervalQuestion(answers, { lower: config.plausibleLower, upper: config.plausibleUpper }),
    );
  }, [mode, config.protocol, config.plausibleLower, config.plausibleUpper, protocolAnswers]);

  const wheel = useMemo(() => (mode === 'protocol' ? attempt(() => readProbabilityWheel(config.wheelFraction)) : null), [mode, config.wheelFraction]);

  /**
   * Whether the answer currently typed can be recorded against the question the
   * protocol is asking. Recording an answer outside the bracket being split —
   * the pre-filled answer is the judge's PREVIOUS one, so this is one click away
   * on a fresh screen — appends a line that makes the whole record non-monotone
   * or zero-width, and the next question then refuses, with no further question
   * to answer. The bracket comes from the engine's own `NextQuestion`; nothing
   * is substituted for the judge, the button is simply held until the answer is
   * one the protocol can use.
   */
  const answerRejection = useMemo<string | null>(() => {
    if (mode !== 'protocol' || !nextQuestion || !nextQuestion.ok || nextQuestion.value.done) return null;
    const q = nextQuestion.value;
    const a = config.protocolAnswer;
    if (!Number.isFinite(a)) return 'Enter a number.';
    if (q.protocol === 'bisection') {
      const b = q.bracket;
      if (!b) return null;
      if (a <= b.lowValue || a >= b.highValue) {
        const lo = Number.isFinite(b.lowValue) ? b.lowValue.toPrecision(6) : 'the lower end';
        const hi = Number.isFinite(b.highValue) ? b.highValue.toPrecision(6) : 'the upper end';
        return `This answer splits the bracket you already stated, so it must lie strictly between ${lo} and ${hi}; ${a} does not. An answer on either edge would claim ${(
          b.highLevel - b.lowLevel
        ).toPrecision(3)} of the probability sits on a single point.`;
      }
      return null;
    }
    if (!(a > 0 && a < 1)) return `A probability answer must lie strictly between 0 and 1; ${a} does not.`;
    const stated = protocolAnswers.ok ? protocolAnswers.value : [];
    if (stated.some((s) => s.level === a)) return `The level ${a} is already in the record. Two different values cannot both be the ${a} quantile.`;
    return null;
  }, [mode, nextQuestion, config.protocolAnswer, protocolAnswers]);

  /* ------------------------------------------------------------ know */
  const maxent = useMemo(() => {
    if (mode !== 'know' || config.knowForm !== 'maxent') return null;
    const judgement: PartialJudgement = {
      support: config.support,
      mean: config.statedMean,
      ...(config.useVariance ? { variance: config.statedVariance } : {}),
      ...(config.support === 'bounded' ? { range: { lower: config.supportLower, upper: config.supportUpper } } : {}),
    };
    // 1,200 grid points rather than the 4,000 default: the closed form is the
    // reported answer and the grid is a cross-check, so this stays well inside
    // the frame budget.
    return attempt(() => maximumEntropyCompletion(judgement, { gridPoints: 1200 }));
  }, [mode, config.knowForm, config.support, config.statedMean, config.useVariance, config.statedVariance, config.supportLower, config.supportUpper]);

  const imprecise = useMemo(() => {
    if (mode !== 'know' || config.knowForm !== 'imprecise-probabilities') return null;
    const rows = lines(config.impreciseProbText);
    const judgements: IntervalProbabilityJudgement[] = [];
    for (const row of rows) {
      const p = labelledNumbers(row, 2);
      if (!p.ok) return { ok: false as const, error: `${p.error} Each line is "label: lowest, highest".` };
      judgements.push({ label: p.value.label, lower: p.value.values[0], upper: p.value.values[1] });
    }
    return attempt(() => elicitImpreciseProbabilities(judgements));
  }, [mode, config.knowForm, config.impreciseProbText]);

  const pbox = useMemo(() => {
    if (mode !== 'know' || config.knowForm !== 'imprecise-quantiles') return null;
    const rows = lines(config.impreciseQuantileText);
    const judgements: IntervalQuantileJudgement[] = [];
    for (const row of rows) {
      const p = labelledNumbers(row, 2);
      if (!p.ok) return { ok: false as const, error: `${p.error} Each line is "level: lowest, highest".` };
      const level = Number(p.value.label);
      if (!Number.isFinite(level)) return { ok: false as const, error: `"${p.value.label}" is not a probability level.` };
      judgements.push({ level, lower: p.value.values[0], upper: p.value.values[1] });
    }
    return attempt(() => elicitImpreciseQuantiles(judgements, { steps: 200 }));
  }, [mode, config.knowForm, config.impreciseQuantileText]);

  /* ------------------------------------------------------- coherence */
  const coherence = useMemo(() => {
    if (mode !== 'coherence' || config.coherenceCheck !== 'partition') return null;
    const parsed = parseStatedProbabilities(config.partitionText);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    return attempt(() =>
      checkPartitionCoherence(parsed.value, config.showAdjustment ? { adjust: config.adjustRule } : {}),
    );
  }, [mode, config.coherenceCheck, config.partitionText, config.showAdjustment, config.adjustRule]);

  const conjunction = useMemo(() => {
    if (mode !== 'coherence' || config.coherenceCheck !== 'conjunction') return null;
    return attempt(() =>
      checkConjunction({
        labelA: config.labelA,
        labelB: config.labelB,
        probabilityA: config.probA,
        probabilityB: config.probB,
        probabilityAandB: config.probAandB,
        ...(config.useProbAorB ? { probabilityAorB: config.probAorB } : {}),
      }),
    );
  }, [mode, config.coherenceCheck, config.labelA, config.labelB, config.probA, config.probB, config.probAandB, config.useProbAorB, config.probAorB]);

  const subadditivity = useMemo(() => {
    if (mode !== 'coherence' || config.coherenceCheck !== 'subadditivity') return null;
    const parts = parseStatedProbabilities(config.partsText);
    if (!parts.ok) return { ok: false as const, error: parts.error };
    return attempt(() => checkSubadditivity(config.wholeLabel, config.wholeProbability, parts.value));
  }, [mode, config.coherenceCheck, config.wholeLabel, config.wholeProbability, config.partsText]);

  const partitionDependence = useMemo(() => {
    if (mode !== 'coherence' || config.coherenceCheck !== 'partition-dependence') return null;
    const coarse = parseStatedProbabilities(config.coarsePartitionText);
    if (!coarse.ok) return { ok: false as const, error: `Coarse partition: ${coarse.error}` };
    const fine = parseStatedProbabilities(config.finePartitionText);
    if (!fine.ok) return { ok: false as const, error: `Fine partition: ${fine.error}` };
    const split = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean);
    const assessments: PartitionAssessment[] = [
      { partitionName: 'Coarse partition', categories: coarse.value, targetCategories: split(config.coarseTargets) },
      { partitionName: 'Fine partition', categories: fine.value, targetCategories: split(config.fineTargets) },
    ];
    return attempt(() => detectPartitionDependence(assessments));
  }, [mode, config.coherenceCheck, config.coarsePartitionText, config.finePartitionText, config.coarseTargets, config.fineTargets]);

  const anchoring = useMemo(() => {
    if (mode !== 'coherence' || config.coherenceCheck !== 'anchoring') return null;
    const sequence: AnchoredJudgement[] = [];
    for (const row of lines(config.anchorText)) {
      const p = labelledNumbers(row, 2);
      if (!p.ok) return { ok: false as const, error: `${p.error} Each line is "label: anchor shown, answer given".` };
      sequence.push({ label: p.value.label, anchor: p.value.values[0], judgement: p.value.values[1] });
    }
    return attempt(() => detectAnchoring(sequence));
  }, [mode, config.coherenceCheck, config.anchorText]);

  /* --------------------------------------------------------- experts */
  const experts = useMemo(() => parseExperts(config.expertText), [config.expertText]);

  const pools = useMemo(() => {
    if (mode !== 'experts' || config.expertForm !== 'pools' || !experts.ok) return null;
    const weights = config.poolWeightsText.trim() ? numberList(config.poolWeightsText) : null;
    if (weights && !weights.ok) return { ok: false as const, error: `Weights: ${weights.error}` };
    // Both pools on the engine's own default grid: a few thousand density
    // evaluations for a handful of experts, well inside one frame.
    return attempt(() => comparePools(experts.value, weights ? { weights: weights.value } : {}));
  }, [mode, config.expertForm, config.poolWeightsText, experts]);

  const disagreement = useMemo(() => {
    if (mode !== 'experts' || config.expertForm !== 'pools' || !experts.ok) return null;
    return attempt(() => disagreementMeasures(experts.value));
  }, [mode, config.expertForm, experts]);

  const correlated = useMemo(() => {
    if (mode !== 'experts' || config.expertForm !== 'correlated' || !experts.ok) return null;
    const estimates = experts.value.map((e) => ({ expert: e.expert, mean: e.params.mu, sd: e.params.sigma }));
    return attempt(() => correlatedExpertAggregate(estimates, config.expertCorrelation));
  }, [mode, config.expertForm, config.expertCorrelation, experts]);

  const cooke = useMemo(() => {
    if (mode !== 'experts' || config.expertForm !== 'cooke' || !config.runExpertWeighting) return null;
    const realisationValues = numberList(config.seedRealisationText);
    if (!realisationValues.ok) return { ok: false as const, error: `Realisations: ${realisationValues.error}` };
    const records = parseSeedRecords(config.seedExpertText, realisationValues.value.length);
    if (!records.ok) return { ok: false as const, error: records.error };
    const realisations = realisationValues.value.map((value, i) => ({ question: `Seed ${i + 1}`, value }));
    return attempt(() => ({
      inSample: cookeClassicalMethod(records.value, realisations),
      crossValidated: crossValidateWeighting(records.value, realisations),
    }));
  }, [mode, config.expertForm, config.runExpertWeighting, config.seedExpertText, config.seedRealisationText]);

  /* ----------------------------------------------------------- track */
  const intervalRecord = useMemo(() => {
    if (mode !== 'track' || config.trackForm !== 'intervals') return null;
    const rows = parseRows(config.intervalRecordText, 3, '"lower, upper, what actually happened"');
    if (!rows.ok) return { ok: false as const, error: rows.error };
    const intervals: StatedInterval[] = rows.value.map((r, i) => ({
      label: `Question ${i + 1}`,
      lower: r[0],
      upper: r[1],
      nominalLevel: config.nominalLevel,
    }));
    const outcomes = rows.value.map((r) => r[2]);
    return attempt(() => intervalCalibration(intervals, outcomes));
  }, [mode, config.trackForm, config.intervalRecordText, config.nominalLevel]);

  const binaryRecord = useMemo(() => {
    if (mode !== 'track' || config.trackForm !== 'binary') return null;
    const rows = parseRows(config.binaryRecordText, 2, '"stated probability, outcome (1 or 0)"');
    if (!rows.ok) return { ok: false as const, error: rows.error };
    return attempt(() =>
      scoreBinaryRecord(
        rows.value.map((r) => r[0]),
        rows.value.map((r) => r[1]),
        { bins: config.calibrationBins },
      ),
    );
  }, [mode, config.trackForm, config.binaryRecordText, config.calibrationBins]);

  const continuousRecord = useMemo(() => {
    if (mode !== 'track' || config.trackForm !== 'continuous') return null;
    const rows = parseRows(config.continuousRecordText, 3, '"stated mean, stated standard deviation, what actually happened"');
    if (!rows.ok) return { ok: false as const, error: rows.error };
    const predictive: PredictiveJudgement[] = rows.value.map((r) => ({ distributionId: 'normal', params: { mu: r[0], sigma: r[1] } }));
    return attempt(() => scoreContinuousRecord(predictive, rows.value.map((r) => r[2]), { bins: config.calibrationBins }));
  }, [mode, config.trackForm, config.continuousRecordText, config.calibrationBins]);

  /** The explanation shown at the bottom belongs to whatever is on screen. */
  const activeExplanation: Explanation | null = useMemo(() => {
    const candidates: (Attempt<{ explanation: Explanation }> | null)[] = [
      fit,
      maxent,
      imprecise,
      pbox,
      coherence,
      conjunction,
      subadditivity,
      partitionDependence,
      anchoring,
      disagreement,
      correlated,
      intervalRecord,
      binaryRecord,
      continuousRecord,
    ];
    for (const c of candidates) if (c && c.ok) return c.value.explanation;
    if (pools && pools.ok) return pools.value.linear.explanation;
    if (cooke && cooke.ok) return cooke.value.inSample.explanation;
    if (wheel && wheel.ok) return wheel.value.explanation;
    return null;
  }, [fit, maxent, imprecise, pbox, coherence, conjunction, subadditivity, partitionDependence, anchoring, disagreement, correlated, intervalRecord, binaryRecord, continuousRecord, pools, cooke, wheel]);

  return (
    <>
      <ToolHeader toolId="elicitation" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What are you doing with the judgement?">
            <Segmented label="Elicitation mode" value={mode} onChange={(m) => set({ mode: m })} options={MODE_OPTIONS} />
            <Notice tone="info" title="Every result on this screen is an assumption">
              <p style={{ margin: 0 }}>
                The engine marks all of it <strong>assumed</strong>: the arithmetic is as accurate as anywhere else in
                this application, but the input is somebody&rsquo;s opinion and the input dominates. A number derived
                from an opinion must never be presented with the authority of a measurement.
              </p>
            </Notice>
          </Card>

          {mode === 'belief' && (
            <Card title="State a belief">
              <Segmented
                label="How the judgement was collected"
                value={config.beliefForm}
                onChange={(beliefForm) => set({ beliefForm })}
                options={[
                  { value: 'interval', label: 'Median and interval' },
                  { value: 'quantiles', label: 'Arbitrary quantiles' },
                  { value: 'chips', label: 'Chips in bins' },
                ]}
              />
              {config.beliefForm === 'interval' && (
                <>
                  <NumberField label="Median (the judge is equally sure above and below)" value={config.median} onChange={(median) => set({ median })} />
                  <NumberField label="Lower end of the stated interval" value={config.intervalLower} onChange={(intervalLower) => set({ intervalLower })} />
                  <NumberField label="Upper end of the stated interval" value={config.intervalUpper} onChange={(intervalUpper) => set({ intervalUpper })} />
                  <ProbabilityField
                    label="Central probability the judge attached to that interval"
                    value={config.credibleLevel}
                    onChange={(credibleLevel) => set({ credibleLevel })}
                    hint="0.9 means a 5th-to-95th-percentile interval. Three terciles are entered as arbitrary quantiles instead."
                  />
                </>
              )}
              {config.beliefForm === 'quantiles' && (
                <TextField
                  label="Stated quantiles"
                  value={config.quantileText}
                  onChange={(quantileText) => set({ quantileText })}
                  multiline
                  rows={6}
                  monospace
                  hint='One per line, "level: value". Terciles are "0.3333: a" and "0.6667: b". Non-monotone pairs are refused by name below.'
                />
              )}
              {config.beliefForm === 'chips' && (
                <>
                  <TextField
                    label="Bin edges"
                    value={config.chipEdges}
                    onChange={(chipEdges) => set({ chipEdges })}
                    monospace
                    hint="Ascending, one more edge than there are bins. Contiguous: each bin ends where the next begins."
                  />
                  <TextField
                    label="Chips in each bin"
                    value={config.chipCounts}
                    onChange={(chipCounts) => set({ chipCounts })}
                    monospace
                    hint="Whole numbers of chips, one per bin. The total chip count sets the finest probability the method can express."
                  />
                </>
              )}
              <p className="oc-chart-note">{FRAMING_NOTES[FRAMING_FOR_MODE[config.beliefForm]].knownEffect}</p>
            </Card>
          )}

          {(mode === 'fit' || mode === 'belief') && (
            <Card title="Fitting">
              <NumberField
                label="Tie band factor"
                value={config.tieFactor}
                onChange={(tieFactor) => set({ tieFactor })}
                min={1}
                max={10}
                step={0.1}
                hint="A family whose rmse is within this factor of the best counts as fitting equally well, and is included in the family-sensitivity spread."
              />
            </Card>
          )}

          {mode === 'protocol' && (
            <Card title="Run a protocol">
              <Segmented
                label="Protocol"
                value={config.protocol}
                onChange={(protocol) => set({ protocol })}
                options={[
                  { value: 'bisection', label: 'Bisection' },
                  { value: 'fixed-interval', label: 'Fixed interval' },
                ]}
              />
              {config.protocol === 'fixed-interval' && (
                <>
                  <NumberField label="Lowest plausible value (sets the question grid)" value={config.plausibleLower} onChange={(plausibleLower) => set({ plausibleLower })} />
                  <NumberField label="Highest plausible value (sets the question grid)" value={config.plausibleUpper} onChange={(plausibleUpper) => set({ plausibleUpper })} />
                </>
              )}
              <TextField
                label="Answers so far"
                value={config.quantileText}
                onChange={(quantileText) => set({ quantileText })}
                multiline
                rows={7}
                monospace
                hint='"level: value" per line. The record is editable: a mis-keyed answer is corrected here, not worked around.'
              />
              <NumberField
                label={config.protocol === 'bisection' ? 'Answer to the question below (a value)' : 'Answer to the question below (a probability)'}
                value={config.protocolAnswer}
                onChange={(protocolAnswer) => set({ protocolAnswer })}
                error={answerRejection ?? undefined}
              />
              <div className="oc-btn-row">
                <Button
                  icon="plus"
                  variant="primary"
                  disabled={!nextQuestion || !nextQuestion.ok || nextQuestion.value.done || answerRejection !== null}
                  onClick={() => {
                    if (!nextQuestion || !nextQuestion.ok) return;
                    const q = nextQuestion.value;
                    // Bisection fixes the level and asks for a value; fixed
                    // interval fixes the value and asks for a probability. The
                    // record is the same object either way.
                    const line =
                      q.protocol === 'bisection'
                        ? `${q.targetLevel ?? 0.5}: ${config.protocolAnswer}`
                        : `${config.protocolAnswer}: ${q.targetValue ?? 0}`;
                    set({ quantileText: `${config.quantileText.trim()}\n${line}`.trim() });
                  }}
                >
                  Record this answer
                </Button>
                <Button icon="trash" onClick={() => set({ quantileText: '' })} disabled={!config.quantileText.trim()}>
                  Start again
                </Button>
              </div>
              <NumberField
                label="Probability wheel: shaded fraction"
                value={config.wheelFraction}
                onChange={(wheelFraction) => set({ wheelFraction })}
                min={0}
                max={1}
                step={0.01}
                hint="A judge who cannot state a number can often point at a wheel. The wheel has its own resolution, and compresses at both extremes."
              />
            </Card>
          )}

          {mode === 'know' && (
            <Card title="Say only what you know">
              <Segmented
                label="What the judge was able to say"
                value={config.knowForm}
                onChange={(knowForm) => set({ knowForm })}
                options={[
                  { value: 'maxent', label: 'A moment or two' },
                  { value: 'imprecise-probabilities', label: 'Ranges for probabilities' },
                  { value: 'imprecise-quantiles', label: 'Ranges for quantiles' },
                ]}
              />
              {config.knowForm === 'maxent' && (
                <>
                  <SelectField
                    label="Where the quantity can live"
                    value={config.support}
                    onChange={(support) => set({ support })}
                    options={[
                      { value: 'positive-halfline', label: 'Zero or more' },
                      { value: 'reals', label: 'Any real number' },
                      { value: 'bounded', label: 'Between two bounds' },
                    ]}
                  />
                  {config.support === 'bounded' && (
                    <>
                      <NumberField label="Lower bound" value={config.supportLower} onChange={(supportLower) => set({ supportLower })} />
                      <NumberField label="Upper bound" value={config.supportUpper} onChange={(supportUpper) => set({ supportUpper })} />
                    </>
                  )}
                  <NumberField label="Stated expected value" value={config.statedMean} onChange={(statedMean) => set({ statedMean })} />
                  <Checkbox
                    checked={config.useVariance}
                    onChange={(useVariance) => set({ useVariance })}
                    label="The judge also stated a variance"
                    description="A mean alone on the half-line gives the exponential; a mean and a variance on the whole line give the normal. Adding a constraint nobody stated would invent information."
                  />
                  {config.useVariance && (
                    <NumberField label="Stated variance" value={config.statedVariance} onChange={(statedVariance) => set({ statedVariance })} min={0} />
                  )}
                </>
              )}
              {config.knowForm === 'imprecise-probabilities' && (
                <TextField
                  label="Interval-valued probabilities over a partition"
                  value={config.impreciseProbText}
                  onChange={(impreciseProbText) => set({ impreciseProbText })}
                  multiline
                  rows={5}
                  monospace
                  hint='"label: lowest, highest" per line. Replacing [0.2, 0.4] with 0.3 throws away the only thing the judge was sure of — that they were not sure.'
                />
              )}
              {config.knowForm === 'imprecise-quantiles' && (
                <TextField
                  label="Interval-valued quantiles"
                  value={config.impreciseQuantileText}
                  onChange={(impreciseQuantileText) => set({ impreciseQuantileText })}
                  multiline
                  rows={5}
                  monospace
                  hint='"level: lowest, highest" per line — "my 90th percentile is somewhere between 400 and 520".'
                />
              )}
            </Card>
          )}

          {mode === 'coherence' && (
            <Card title="Which failure are you looking for?">
              <SelectField
                label="Check"
                value={config.coherenceCheck}
                onChange={(coherenceCheck) => set({ coherenceCheck })}
                options={[
                  { value: 'partition', label: 'The probability axioms over a partition' },
                  { value: 'conjunction', label: 'Conjunction and disjunction' },
                  { value: 'subadditivity', label: 'Subadditivity: parts against the whole' },
                  { value: 'partition-dependence', label: 'Partition dependence' },
                  { value: 'anchoring', label: 'Anchoring across a sequence' },
                ]}
              />
              {config.coherenceCheck === 'partition' && (
                <>
                  <TextField
                    label="Stated probabilities over an exhaustive, mutually exclusive partition"
                    value={config.partitionText}
                    onChange={(partitionText) => set({ partitionText })}
                    multiline
                    rows={5}
                    monospace
                    hint='"label: probability" per line.'
                  />
                  <Checkbox
                    checked={config.showAdjustment}
                    onChange={(showAdjustment) => set({ showAdjustment })}
                    label="Also show the minimum-adjustment coherent set"
                    description="Nothing is renormalised unless you ask. When you do, every change is shown element by element."
                  />
                  {config.showAdjustment && (
                    <SelectField
                      label="Adjustment rule"
                      value={config.adjustRule}
                      onChange={(adjustRule) => set({ adjustRule })}
                      options={[
                        { value: 'least-squares', label: 'Least squares (Euclidean projection onto the simplex)' },
                        { value: 'kl', label: 'Minimum relative entropy (proportional rescaling)' },
                      ]}
                      hint="The two rules give different answers. Choosing between them is a judgement about where the error lies and the arithmetic cannot make it."
                    />
                  )}
                </>
              )}
              {config.coherenceCheck === 'conjunction' && (
                <>
                  <TextField label="Event A" value={config.labelA} onChange={(labelA) => set({ labelA })} />
                  <TextField label="Event B" value={config.labelB} onChange={(labelB) => set({ labelB })} />
                  <ProbabilityField label="Stated P(A)" value={config.probA} onChange={(probA) => set({ probA })} />
                  <ProbabilityField label="Stated P(B)" value={config.probB} onChange={(probB) => set({ probB })} />
                  <ProbabilityField
                    label="Stated P(A and B)"
                    value={config.probAandB}
                    onChange={(probAandB) => set({ probAandB })}
                    hint="A conjunction judged more likely than one of its parts is the classic violation. It is common and it is not a rounding error."
                  />
                  <Checkbox checked={config.useProbAorB} onChange={(useProbAorB) => set({ useProbAorB })} label="The judge also stated P(A or B)" />
                  {config.useProbAorB && <ProbabilityField label="Stated P(A or B)" value={config.probAorB} onChange={(probAorB) => set({ probAorB })} />}
                </>
              )}
              {config.coherenceCheck === 'subadditivity' && (
                <>
                  <TextField label="The event judged as a whole" value={config.wholeLabel} onChange={(wholeLabel) => set({ wholeLabel })} />
                  <ProbabilityField label="Probability given to the whole" value={config.wholeProbability} onChange={(wholeProbability) => set({ wholeProbability })} />
                  <TextField
                    label="The same event unpacked into parts"
                    value={config.partsText}
                    onChange={(partsText) => set({ partsText })}
                    multiline
                    rows={5}
                    monospace
                    hint='"label: probability" per line. Unpacking reliably raises the total; the excess is the size of the effect for this judge.'
                  />
                </>
              )}
              {config.coherenceCheck === 'partition-dependence' && (
                <>
                  <TextField label="Coarse partition" value={config.coarsePartitionText} onChange={(coarsePartitionText) => set({ coarsePartitionText })} multiline rows={3} monospace />
                  <TextField label="Which of those categories make up the target event" value={config.coarseTargets} onChange={(coarseTargets) => set({ coarseTargets })} hint="Comma-separated labels, exactly as written above." />
                  <TextField label="Fine partition of the same uncertainty" value={config.finePartitionText} onChange={(finePartitionText) => set({ finePartitionText })} multiline rows={4} monospace />
                  <TextField label="Which of those make up the same target event" value={config.fineTargets} onChange={(fineTargets) => set({ fineTargets })} />
                </>
              )}
              {config.coherenceCheck === 'anchoring' && (
                <TextField
                  label="A sequence of judgements, each with the number the judge saw first"
                  value={config.anchorText}
                  onChange={(anchorText) => set({ anchorText })}
                  multiline
                  rows={6}
                  monospace
                  hint='"label: anchor shown, answer given" per line. At least three are needed for a slope that is not simply a line through two points.'
                />
              )}
            </Card>
          )}

          {mode === 'experts' && (
            <Card title="Combining experts">
              <Segmented
                label="What to do with several opinions"
                value={config.expertForm}
                onChange={(expertForm) => set({ expertForm })}
                options={[
                  { value: 'pools', label: 'Opinion pools' },
                  { value: 'correlated', label: 'Correlated experts' },
                  { value: 'cooke', label: "Cooke's weighting" },
                ]}
              />
              {config.expertForm !== 'cooke' && (
                <TextField
                  label="Experts"
                  value={config.expertText}
                  onChange={(expertText) => set({ expertText })}
                  multiline
                  rows={5}
                  monospace
                  hint='"name: central estimate, standard deviation" per line, read as a normal distribution for that expert.'
                />
              )}
              {config.expertForm === 'pools' && (
                <TextField
                  label="Weights (optional)"
                  value={config.poolWeightsText}
                  onChange={(poolWeightsText) => set({ poolWeightsText })}
                  monospace
                  hint="One per expert, in order. Leave empty for equal weights, which is the benchmark performance weighting has to beat."
                />
              )}
              {config.expertForm === 'correlated' && (
                <NumberField
                  label="Correlation between the experts' errors"
                  value={config.expertCorrelation}
                  onChange={(expertCorrelation) => set({ expertCorrelation })}
                  min={-0.99}
                  max={0.99}
                  step={0.05}
                  hint="Experts who read the same papers are not independent sources. The aggregate below shows what the independence assumption fabricates."
                />
              )}
              {config.expertForm === 'cooke' && (
                <>
                  <TextField
                    label="Seed answers, one expert per line"
                    value={config.seedExpertText}
                    onChange={(seedExpertText) => set({ seedExpertText })}
                    multiline
                    rows={6}
                    monospace
                    hint='"name: 5%, 50%, 95% ; 5%, 50%, 95% ; …" — one group per seed question, separated by semicolons.'
                  />
                  <TextField
                    label="What the seed questions actually turned out to be"
                    value={config.seedRealisationText}
                    onChange={(seedRealisationText) => set({ seedRealisationText })}
                    monospace
                    hint="One number per seed question, in the same order."
                  />
                </>
              )}
            </Card>
          )}

          {mode === 'track' && (
            <Card title="Was the judge any good?">
              <Segmented
                label="What kind of record"
                value={config.trackForm}
                onChange={(trackForm) => set({ trackForm })}
                options={[
                  { value: 'intervals', label: 'Stated intervals' },
                  { value: 'binary', label: 'Binary probabilities' },
                  { value: 'continuous', label: 'Full distributions' },
                ]}
              />
              {config.trackForm === 'intervals' && (
                <>
                  <ProbabilityField label="Level the judge attached to every interval" value={config.nominalLevel} onChange={(nominalLevel) => set({ nominalLevel })} />
                  <TextField
                    label="The record"
                    value={config.intervalRecordText}
                    onChange={(intervalRecordText) => set({ intervalRecordText })}
                    multiline
                    rows={8}
                    monospace
                    hint='"lower, upper, what actually happened" per line.'
                  />
                </>
              )}
              {config.trackForm === 'binary' && (
                <TextField
                  label="The record"
                  value={config.binaryRecordText}
                  onChange={(binaryRecordText) => set({ binaryRecordText })}
                  multiline
                  rows={9}
                  monospace
                  hint='"stated probability, outcome" per line, with the outcome 1 if it happened and 0 if it did not.'
                />
              )}
              {config.trackForm === 'continuous' && (
                <TextField
                  label="The record"
                  value={config.continuousRecordText}
                  onChange={(continuousRecordText) => set({ continuousRecordText })}
                  multiline
                  rows={8}
                  monospace
                  hint='"stated mean, stated standard deviation, what actually happened" per line, each read as a normal predictive distribution.'
                />
              )}
              <NumberField
                label="Bins for the calibration curve and the quantile-hit histogram"
                value={config.calibrationBins}
                onChange={(calibrationBins) => set({ calibrationBins })}
                min={2}
                max={20}
                integer
                hint="More bins on a short record look alarming and mean nothing: the noise floor rises with the bin count."
              />
            </Card>
          )}

          <AiAssistPanel
            capability="draftAssumptions"
            context="This screen turns stated opinions into distributions. Assistance may help write the judgement down; the numbers are the engine's and every one of them is marked as an assumption."
          />
        </div>

        <div className="oc-stack">
          {/* ------------------------------------------------ 1. belief */}
          {mode === 'belief' && (
            <Card title="What was actually stated">
              {config.beliefForm === 'chips' ? (
                !chips.ok ? (
                  <Notice tone="error">{chips.error}</Notice>
                ) : !config.runFit ? (
                  <>
                    <Notice tone="info" title="The chip allocation is accepted; the fit is not run yet">
                      <p style={{ margin: 0 }}>
                        {chips.value.reduce((a, b) => a + b.chips, 0)} chips over {chips.value.length} bins. Fitting a
                        distribution to them scans the whole registry, so it runs on request — switch to{' '}
                        <strong>Fit a distribution</strong> and ask for it.
                      </p>
                    </Notice>
                    <Scroller>
                      <BarChart
                        title="Stated chip allocation"
                        description="Chips the judge placed in each bin."
                        data={chips.value.map((b) => ({ x: (b.lower + b.upper) / 2, y: b.chips, label: `${formatValue(b.lower, 4)}–${formatValue(b.upper, 4)}` }))}
                        xLabel="Value"
                        yLabel="Chips"
                        seriesLabel="Chips placed"
                        note="The answer depends on the bins. Partition dependence is measured in the coherence mode."
                      />
                    </Scroller>
                  </>
                ) : chipFit && !chipFit.ok ? (
                  <Notice tone="error">{chipFit.error}</Notice>
                ) : chipFit && chipFit.ok ? (
                  <>
                    <AssumedBadge basis={chipFit.value.basis} />
                    <KeyValueList
                      items={[
                        { label: 'Chips placed', value: String(chipFit.value.totalChips) },
                        { label: 'Finest probability the chip count can express', value: formatValue(chipFit.value.granularity, 4) },
                        { label: 'Largest gap between a stated and a fitted bin probability', value: formatValue(chipFit.value.maxBinResidual, 4) },
                      ]}
                    />
                    <Scroller>
                      <BarChart
                        title="Stated against fitted bin probabilities"
                        description="What the chips said, and what the fitted distribution says about the same bins."
                        data={chipFit.value.bins.map((b) => ({ x: (b.lower + b.upper) / 2, y: b.statedProbability, compare: b.fittedProbability, label: `${formatValue(b.lower, 4)}–${formatValue(b.upper, 4)}` }))}
                        xLabel="Value"
                        yLabel="Probability"
                        seriesLabel="Stated by the chips"
                        compareLabel="Fitted distribution"
                        asPercent
                      />
                    </Scroller>
                    <Warnings warnings={chipFit.value.warnings} />
                    <Caveats basis={chipFit.value.basis} />
                  </>
                ) : null
              ) : !stated.ok ? (
                <Notice tone="error" title="The engine refuses these quantiles">
                  {stated.error}
                </Notice>
              ) : (
                <>
                  <Badge variant="assumed">User assumption</Badge>
                  <Scroller>
                    <DataTable
                      caption="Stated quantiles"
                      columns={[
                        { key: 'level', header: 'Level', numeric: true, render: (r) => formatValue(r.level, 4) },
                        { key: 'value', header: 'Value', numeric: true, render: (r) => formatValue(r.value, 6) },
                        { key: 'reading', header: 'Reading', render: (r) => `P(X ≤ ${formatValue(r.value, 6)}) = ${formatValue(r.level, 4)}` },
                      ]}
                      rows={stated.value}
                    />
                  </Scroller>
                  <Scroller>
                    <ScatterChart
                      title="The stated judgement"
                      description="Each point is one thing the judge said: a value and the probability they put below it."
                      points={stated.value.map((q) => ({ x: q.value, y: q.level }))}
                      xLabel="Value"
                      yLabel="Cumulative probability"
                      note="These points are all that was said. Everything between and beyond them comes from a family choice the judge never made."
                    />
                  </Scroller>
                  <Notice tone="info" items={[...UNIVERSAL_ELICITATION_CAVEATS]} title="True of every elicited quantity" />
                </>
              )}
            </Card>
          )}

          {/* --------------------------------------------------- 2. fit */}
          {mode === 'fit' && (
            <>
              <Card title="Fit a distribution to the judgement">
                {!config.runFit ? (
                  <>
                    <Notice tone="warning" title="The fit is not run automatically">
                      <p style={{ marginTop: 0 }}>
                        The fit runs a least-squares search over every compatible continuous family in the registry,
                        with a multi-start simplex for each. That is seconds of synchronous work, which would freeze
                        the tab before the page had drawn, so it runs only when you ask for it.
                      </p>
                      <p style={{ marginBottom: 0 }}>
                        Nothing is shown in its place: a plausible-looking distribution with no fit behind it would be
                        worse than nothing.
                      </p>
                    </Notice>
                    <div className="oc-btn-row">
                      <Button icon="play" variant="primary" onClick={() => set({ runFit: true })}>
                        Fit the families
                      </Button>
                    </div>
                  </>
                ) : !fit ? (
                  <Notice tone="error">
                    {config.beliefForm === 'chips'
                      ? chips.ok
                        ? 'The chip allocation could not be fitted.'
                        : chips.error
                      : stated.ok
                        ? 'There is nothing to fit.'
                        : stated.error}
                  </Notice>
                ) : !fit.ok ? (
                  <Notice tone="error" title="The engine refuses to fit this">
                    {fit.error}
                  </Notice>
                ) : (
                  <>
                    <AssumedBadge basis={fit.value.basis} />
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Reported family — fewest parameters inside the tie band</span>
                      <span className="oc-result-hero__value">{fit.value.best.distributionName}</span>
                      <span className="oc-result-hero__detail">
                        {Object.entries(fit.value.best.params)
                          .map(([k, v]) => `${k} = ${formatValue(v, 6)}`)
                          .join(', ')}{' '}
                        · rmse {formatValue(fit.value.best.rmse, 4)} in the judge&rsquo;s own units
                      </span>
                    </div>
                    <Notice tone="info" title="Why this is not the lowest-residual family">
                      <p style={{ marginTop: 0 }}>
                        The lowest residual belongs to <strong>{fit.value.lowestResidual.distributionName}</strong> (rmse{' '}
                        {formatValue(fit.value.lowestResidual.rmse, 4)}, {fit.value.lowestResidual.parameterCount}{' '}
                        parameters). A family with as many parameters as there are stated quantiles reproduces them
                        exactly by construction, on no evidence, so ranking by residual systematically picks saturated
                        families.
                      </p>
                      <p style={{ marginBottom: 0 }}>
                        The reported winner is instead the simplest family whose rmse falls inside the tie band of{' '}
                        {formatValue(fit.value.tieBand, 4)}, which is anchored to the precision the judge could
                        plausibly have meant.
                      </p>
                    </Notice>
                    <Scroller>
                      <DataTable
                        caption="Per-quantile residuals of the reported fit"
                        columns={[
                          { key: 'level', header: 'Level', numeric: true, render: (r) => formatValue(r.level, 4) },
                          { key: 'stated', header: 'Stated', numeric: true, render: (r) => formatValue(r.stated, 6) },
                          { key: 'fitted', header: 'Fitted', numeric: true, render: (r) => formatValue(r.fitted, 6) },
                          { key: 'residual', header: 'Fitted − stated', numeric: true, render: (r) => formatValue(r.residual, 4) },
                        ]}
                        rows={fit.value.best.residuals}
                      />
                    </Scroller>
                    <Scroller>
                      <ScatterChart
                        title="Residuals against the stated points"
                        description="How far the reported fit puts each quantile from where the judge put it, in the judge's units."
                        points={fit.value.best.residuals.map((r) => ({ x: r.stated, y: r.residual }))}
                        xLabel="Stated value"
                        yLabel="Fitted − stated"
                      />
                    </Scroller>
                    <Warnings warnings={fit.value.warnings} />
                    <Caveats basis={fit.value.basis} />
                  </>
                )}
              </Card>

              {fit && fit.ok && (
                <Card title="Family choice is material" hint="The spread across families that fit equally well — not one confident tail.">
                  <Notice tone={fit.value.familySensitivity.material ? 'error' : 'info'} title={fit.value.familySensitivity.material ? 'The family choice is the dominant uncertainty here' : 'The near-tied families happen to agree over the probed range'}>
                    <p style={{ margin: 0 }}>{fit.value.familySensitivity.note}</p>
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Families fitting equally well', value: `${fit.value.familySensitivity.nearTiedFamilies.length} of ${fit.value.fits.length} fitted` },
                      { label: 'Largest spread in exceedance probability', value: Number.isFinite(fit.value.familySensitivity.maxSpread) ? formatValue(fit.value.familySensitivity.maxSpread, 4) : 'unbounded' },
                      { label: 'Largest ratio between families', value: Number.isFinite(fit.value.familySensitivity.maxRatio) ? `a factor of ${formatValue(fit.value.familySensitivity.maxRatio, 4)}` : 'unbounded' },
                    ]}
                  />
                  <Scroller>
                    <DataTable
                      caption="Exceedance probability at each probe, across the families that fit equally well"
                      columns={[
                        { key: 'where', header: 'Where', render: (r) => r.label },
                        { key: 'lowest', header: 'Lowest', numeric: true, render: (r) => formatValue(r.lowest, 4) },
                        { key: 'highest', header: 'Highest', numeric: true, render: (r) => formatValue(r.highest, 4) },
                        { key: 'ratio', header: 'Ratio', numeric: true, render: (r) => (Number.isFinite(r.ratio) ? `×${formatValue(r.ratio, 4)}` : 'unbounded') },
                      ]}
                      rows={fit.value.familySensitivity.probes}
                    />
                  </Scroller>
                  {familyCurves && familyCurves.length > 0 && (
                    <Scroller>
                      <LineChart
                        title="The near-tied families, drawn out"
                        description="Cumulative distribution of each family that reproduces the stated quantiles about equally well."
                        series={familyCurves}
                        xLabel="Value"
                        yLabel="Cumulative probability"
                        yDomain={[0, 1]}
                        note="They cross near the stated points and diverge away from them. The divergence is the assumption, not the judgement."
                      />
                    </Scroller>
                  )}
                  <Disclosure title={`Every family that was fitted (${fit.value.fits.length}), and the ${fit.value.rejected.length} that were refused`}>
                    <Scroller>
                      <DataTable
                        caption="All fitted families"
                        columns={[
                          { key: 'name', header: 'Family', render: (r) => r.distributionName },
                          { key: 'k', header: 'Parameters', numeric: true, render: (r) => String(r.parameterCount) },
                          { key: 'rmse', header: 'rmse', numeric: true, render: (r) => formatValue(r.rmse, 4) },
                          { key: 'tie', header: 'Inside the tie band', render: (r) => (r.rmse <= fit.value.tieBand ? 'Yes' : 'No') },
                        ]}
                        rows={fit.value.fits}
                        maxHeight={320}
                      />
                    </Scroller>
                    <Scroller>
                      <DataTable
                        caption="Families that could not be fitted, with the reason"
                        columns={[
                          { key: 'id', header: 'Family', render: (r) => r.distributionId },
                          { key: 'reason', header: 'Why not', render: (r) => r.reason },
                        ]}
                        rows={fit.value.rejected}
                        maxHeight={320}
                        emptyMessage="Every candidate family was fitted."
                      />
                    </Scroller>
                  </Disclosure>
                </Card>
              )}
            </>
          )}

          {/* ---------------------------------------------- 3. protocol */}
          {mode === 'protocol' && (
            <>
              <Card title="The next question">
                {!nextQuestion ? null : !nextQuestion.ok ? (
                  <Notice tone="error">{nextQuestion.error}</Notice>
                ) : (
                  <>
                    <AssumedBadge basis={nextQuestion.value.basis} />
                    {nextQuestion.value.done ? (
                      <Notice tone="success" title="The protocol has nothing further to ask">
                        <p style={{ margin: 0 }}>{nextQuestion.value.rationale}</p>
                      </Notice>
                    ) : (
                      <>
                        <div className="oc-result-hero">
                          <span className="oc-result-hero__label">Question {nextQuestion.value.answered + 1}</span>
                          <span className="oc-result-hero__value" style={{ fontSize: 18, lineHeight: 1.35 }}>
                            {nextQuestion.value.prompt}
                          </span>
                          <span className="oc-result-hero__detail">{nextQuestion.value.rationale}</span>
                        </div>
                        {nextQuestion.value.bracket && (
                          <KeyValueList
                            items={[
                              { label: 'Bracket being split (lower end)', value: `level ${formatValue(nextQuestion.value.bracket.lowLevel, 4)} → ${formatValue(nextQuestion.value.bracket.lowValue, 6)}` },
                              { label: 'Bracket being split (upper end)', value: `level ${formatValue(nextQuestion.value.bracket.highLevel, 4)} → ${formatValue(nextQuestion.value.bracket.highValue, 6)}` },
                            ]}
                          />
                        )}
                      </>
                    )}
                    {protocolAnswers.ok ? (
                      <Scroller>
                        <DataTable
                          caption="The answers recorded so far"
                          columns={[
                            { key: 'level', header: 'Level', numeric: true, render: (r) => formatValue(r.level, 4) },
                            { key: 'value', header: 'Value', numeric: true, render: (r) => formatValue(r.value, 6) },
                          ]}
                          rows={protocolAnswers.value}
                          emptyMessage="No answers yet."
                        />
                      </Scroller>
                    ) : (
                      <Notice tone="error">{protocolAnswers.error}</Notice>
                    )}
                    <Caveats basis={nextQuestion.value.basis} />
                  </>
                )}
              </Card>

              <Card title="The framing is part of the answer">
                <p style={{ fontSize: 12.5, marginTop: 0 }}>
                  {FRAMING_NOTES[config.protocol === 'bisection' ? 'fixed-probability' : 'fixed-value'].description}
                </p>
                <Notice tone="warning" title="What this framing is known to do">
                  <p style={{ margin: 0 }}>{FRAMING_NOTES[config.protocol === 'bisection' ? 'fixed-probability' : 'fixed-value'].knownEffect}</p>
                </Notice>
                <Disclosure title="The other framings, and what each of them does">
                  {(Object.keys(FRAMING_NOTES) as Framing[]).map((f) => (
                    <div key={f} style={{ marginBottom: 'var(--s3)' }}>
                      <h3 style={{ fontSize: 13, margin: '0 0 2px' }}>{FRAMING_NOTES[f].question}</h3>
                      <p style={{ fontSize: 12.5, margin: '0 0 2px' }}>{FRAMING_NOTES[f].description}</p>
                      <p style={{ fontSize: 12.5, margin: 0, color: 'var(--text-secondary)' }}>{FRAMING_NOTES[f].knownEffect}</p>
                    </div>
                  ))}
                </Disclosure>
              </Card>

              <Card title="Probability wheel">
                {!wheel ? null : !wheel.ok ? (
                  <Notice tone="error">{wheel.error}</Notice>
                ) : (
                  <>
                    <AssumedBadge basis={wheel.value.basis} />
                    <KeyValueList
                      items={[
                        { label: 'As a percentage', value: wheel.value.asPercentage },
                        { label: 'As a frequency', value: wheel.value.asFrequency },
                        { label: 'As odds', value: wheel.value.asOdds },
                        { label: "The wheel's own resolution", value: formatValue(wheel.value.resolution, 4) },
                        { label: 'In the compression zone', value: wheel.value.inCompressionZone ? 'Yes — a wheel is unreliable here' : 'No' },
                      ]}
                    />
                    <Warnings warnings={wheel.value.warnings} />
                  </>
                )}
              </Card>
            </>
          )}

          {/* -------------------------------------------------- 4. know */}
          {mode === 'know' && config.knowForm === 'maxent' && (
            <Card title="The least-committal distribution consistent with what was said">
              {!maxent ? null : !maxent.ok ? (
                <Notice tone="error">{maxent.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={maxent.value.basis} />
                  {maxent.value.closedForm ? (
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Closed form — this is the answer to report</span>
                      <span className="oc-result-hero__value">{getDistribution(maxent.value.closedForm.distributionId).name}</span>
                      <span className="oc-result-hero__detail">
                        {Object.entries(maxent.value.closedForm.params)
                          .map(([k, v]) => `${k} = ${formatValue(v, 6)}`)
                          .join(', ')}{' '}
                        · {maxent.value.closedForm.reason}
                      </span>
                    </div>
                  ) : (
                    <Notice tone="info" title="No closed form for this set of constraints">
                      <p style={{ margin: 0 }}>The solution below is numerical, on a grid. The constraints it was given are listed under the explanation.</p>
                    </Notice>
                  )}
                  <KeyValueList
                    items={[
                      { label: 'Constraints the judge actually supplied', value: maxent.value.constraints.map((c) => `${c.name} = ${formatValue(c.target, 6)}`).join('; ') },
                      { label: 'Mean of the returned distribution', value: formatValue(maxent.value.gridMean, 6) },
                      { label: 'Variance of the returned distribution', value: formatValue(maxent.value.gridVariance, 6) },
                      ...(maxent.value.closedFormAgreement !== undefined
                        ? [{ label: 'Grid-against-closed-form agreement (cross-check only)', value: formatValue(maxent.value.closedFormAgreement, 4) }]
                        : []),
                    ]}
                  />
                  <Scroller>
                    <LineChart
                      title="Maximum-entropy density"
                      description="The distribution that adds the least information beyond the stated constraints."
                      series={[
                        {
                          label: 'Maximum-entropy density',
                          area: true,
                          points: maxent.value.solution.support
                            .map((x, i) => ({ x, y: maxent.value.solution.density[i] }))
                            .filter((_, i) => i % 4 === 0),
                        },
                      ]}
                      xLabel="Value"
                      yLabel="Density"
                      note="Maximum entropy is not a neutral choice; it is the choice that commits least, which is a different thing."
                    />
                  </Scroller>
                  <Warnings warnings={maxent.value.warnings} />
                  <Caveats basis={maxent.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'know' && config.knowForm === 'imprecise-probabilities' && (
            <Card title="A range stays a range">
              {!imprecise ? null : !imprecise.ok ? (
                <Notice tone="error">{imprecise.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={imprecise.value.basis} />
                  <Notice tone="info" title="Why there is no single distribution here">
                    <p style={{ margin: 0 }}>
                      The judge gave ranges, so the honest object is a credal set — the convex set of every
                      distribution consistent with them. It has {imprecise.value.credal.vertices.length} extreme
                      point(s), and every mixture of those is equally admissible. Collapsing it to a midpoint would
                      report a number the judge never gave.
                    </p>
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Total imprecision (Σ of the interval widths)', value: formatValue(imprecise.value.totalImprecision, 4) },
                      { label: 'Widest single interval', value: `${imprecise.value.widest.label} — width ${formatValue(imprecise.value.widest.width, 4)}` },
                      { label: 'Were the stated bounds already reachable?', value: imprecise.value.reachable.alreadyReachable ? 'Yes' : 'No — they imply tighter bounds than stated' },
                    ]}
                  />
                  <Scroller>
                    <DataTable
                      caption="Stated intervals against the intervals the table actually implies"
                      columns={[
                        { key: 'label', header: 'Element', render: (r) => r.label },
                        { key: 'stated', header: 'Stated', render: (r) => `[${formatValue(r.lower, 4)}, ${formatValue(r.upper, 4)}]` },
                        { key: 'reachable', header: 'Reachable', render: (r) => `[${formatValue(r.rLower, 4)}, ${formatValue(r.rUpper, 4)}]` },
                      ]}
                      rows={imprecise.value.judgements.map((j, i) => ({
                        label: j.label,
                        lower: j.lower,
                        upper: j.upper,
                        rLower: imprecise.value.reachable.lower[i],
                        rUpper: imprecise.value.reachable.upper[i],
                      }))}
                    />
                  </Scroller>
                  <Warnings warnings={imprecise.value.warnings} />
                  <Caveats basis={imprecise.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'know' && config.knowForm === 'imprecise-quantiles' && (
            <Card title="A p-box, not a point distribution">
              {!pbox ? null : !pbox.ok ? (
                <Notice tone="error">{pbox.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={pbox.value.basis} />
                  <Notice tone="info" title="What the box means">
                    <p style={{ margin: 0 }}>
                      Every distribution whose quantile function passes through the stated intervals lies inside these
                      two bounding curves. Outside the stated levels nothing was said, so the box is{' '}
                      {pbox.value.unboundedBelow ? 'unbounded below' : 'bounded below'} and{' '}
                      {pbox.value.unboundedAbove ? 'unbounded above' : 'bounded above'}.
                    </p>
                  </Notice>
                  <Scroller>
                    <DataTable
                      caption="Width of the box at each stated level"
                      columns={[
                        { key: 'level', header: 'Level', numeric: true, render: (r) => formatValue(r.level, 4) },
                        { key: 'width', header: 'Width in value units', numeric: true, render: (r) => formatValue(r.width, 6) },
                      ]}
                      rows={pbox.value.widthAtStatedLevels}
                    />
                  </Scroller>
                  <Scroller>
                    <LineChart
                      title="The p-box"
                      description="Upper and lower bounding cumulative distributions implied by the stated quantile ranges."
                      series={[
                        {
                          label: 'Upper bound on the CDF',
                          points: Array.from(pbox.value.pbox.lo)
                            .map((x, i) => ({ x, y: (i + 1) / pbox.value.pbox.n }))
                            .filter((p) => Number.isFinite(p.x)),
                        },
                        {
                          label: 'Lower bound on the CDF',
                          dashed: true,
                          points: Array.from(pbox.value.pbox.hi)
                            .map((x, i) => ({ x, y: i / pbox.value.pbox.n }))
                            .filter((p) => Number.isFinite(p.x)),
                        },
                      ]}
                      xLabel="Value"
                      yLabel="Cumulative probability"
                      yDomain={[0, 1]}
                      note="The gap between the curves is the judge's own imprecision. Any single curve drawn through it would be a number nobody stated."
                    />
                  </Scroller>
                  <Warnings warnings={pbox.value.warnings} />
                  <Caveats basis={pbox.value.basis} />
                </>
              )}
            </Card>
          )}

          {/* --------------------------------------------- 5. coherence */}
          {mode === 'coherence' && config.coherenceCheck === 'partition' && (
            <Card title="Do the stated probabilities satisfy the axioms?">
              {!coherence ? null : !coherence.ok ? (
                <Notice tone="error">{coherence.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={coherence.value.basis} />
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">{coherence.value.coherent ? 'Coherent' : 'Not coherent'}</span>
                    <span className="oc-result-hero__value">{formatValue(coherence.value.sum, 6)}</span>
                    <span className="oc-result-hero__detail">
                      The stated probabilities sum to this. Excess over 1: {formatValue(coherence.value.excess, 6)}
                      {coherence.value.coherent ? '' : ' — the partition is exhaustive and mutually exclusive, so the sum must be exactly 1.'}
                    </span>
                  </div>
                  {coherence.value.violations.length > 0 && (
                    <Scroller>
                      <DataTable
                        caption="The specific violations"
                        columns={[
                          { key: 'code', header: 'Axiom', render: (r) => r.code },
                          { key: 'amount', header: 'Size', numeric: true, render: (r) => formatValue(r.amount, 6) },
                          { key: 'involves', header: 'Involves', render: (r) => r.involves.join(', ') },
                          { key: 'message', header: 'What is wrong', render: (r) => r.message },
                        ]}
                        rows={coherence.value.violations}
                      />
                    </Scroller>
                  )}
                  {!config.showAdjustment ? (
                    <Notice tone="info" title="Nothing has been renormalised">
                      <p style={{ margin: 0 }}>
                        The stated numbers are shown as stated. Tick the box on the left to see the
                        minimum-adjustment coherent set and exactly what it changes.
                      </p>
                    </Notice>
                  ) : coherence.value.adjustment ? (
                    <>
                      <Notice tone="warning" title="This is a transformation of the judgement, on request">
                        <p style={{ margin: 0 }}>{coherence.value.adjustment.rationale}</p>
                      </Notice>
                      <KeyValueList
                        items={[
                          { label: 'Largest single change', value: formatValue(coherence.value.adjustment.maxAbsChange, 6) },
                          { label: 'Total absolute change', value: formatValue(coherence.value.adjustment.totalAbsChange, 6) },
                          { label: 'Distance from what was stated', value: formatValue(coherence.value.adjustment.distance, 6) },
                          { label: 'Pushed to exactly zero', value: coherence.value.adjustment.clampedToZero.length ? coherence.value.adjustment.clampedToZero.join(', ') : 'None' },
                        ]}
                      />
                      <Scroller>
                        <DataTable
                          caption="Stated, adjusted, and the change"
                          columns={[
                            { key: 'label', header: 'Category', render: (r) => r.label },
                            { key: 'stated', header: 'Stated', numeric: true, render: (r) => formatValue(r.stated, 6) },
                            { key: 'adjusted', header: 'Adjusted', numeric: true, render: (r) => formatValue(r.adjusted, 6) },
                            { key: 'delta', header: 'Change', numeric: true, render: (r) => `${r.delta >= 0 ? '+' : ''}${formatValue(r.delta, 6)}` },
                          ]}
                          rows={coherence.value.stated.map((s, i) => ({
                            label: s.label,
                            stated: s.probability,
                            adjusted: coherence.value.adjustment ? coherence.value.adjustment.adjusted[i] : NaN,
                            delta: coherence.value.adjustment ? coherence.value.adjustment.delta[i] : NaN,
                          }))}
                        />
                      </Scroller>
                    </>
                  ) : (
                    <Notice tone="success">The judgement is already coherent, so there is nothing to adjust.</Notice>
                  )}
                  <Warnings warnings={coherence.value.warnings} />
                  <Caveats basis={coherence.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'coherence' && config.coherenceCheck === 'conjunction' && (
            <Card title="Conjunction and disjunction, with no independence assumed">
              {!conjunction ? null : !conjunction.ok ? (
                <Notice tone="error">{conjunction.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={conjunction.value.basis} />
                  <Notice tone={conjunction.value.coherent ? 'success' : 'error'} title={conjunction.value.coherent ? 'Coherent' : `${conjunction.value.violations.length} violation(s)`}>
                    {conjunction.value.violations.length ? (
                      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                        {conjunction.value.violations.map((v) => (
                          <li key={v.message} style={{ marginBottom: 4 }}>
                            {v.message} (size {formatValue(v.amount, 6)})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0 }}>The stated conjunction and disjunction lie inside their Fréchet bounds.</p>
                    )}
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Fréchet bounds for P(A and B)', value: `[${formatValue(conjunction.value.conjunctionBound.lower, 4)}, ${formatValue(conjunction.value.conjunctionBound.upper, 4)}] — width ${formatValue(conjunction.value.conjunctionBound.width, 4)}` },
                      { label: 'Fréchet bounds for P(A or B)', value: `[${formatValue(conjunction.value.disjunctionBound.lower, 4)}, ${formatValue(conjunction.value.disjunctionBound.upper, 4)}] — width ${formatValue(conjunction.value.disjunctionBound.width, 4)}` },
                      { label: 'What P(A and B) would be under independence', value: `${formatValue(conjunction.value.productIfIndependent, 4)} — shown for contrast only; nobody elicited independence` },
                    ]}
                  />
                  <Warnings warnings={conjunction.value.warnings} />
                  <Caveats basis={conjunction.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'coherence' && config.coherenceCheck === 'subadditivity' && (
            <Card title="The parts against the whole">
              {!subadditivity ? null : !subadditivity.ok ? (
                <Notice tone="error">{subadditivity.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={subadditivity.value.basis} />
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Unpacking excess (parts − whole)</span>
                    <span className="oc-result-hero__value">{formatValue(subadditivity.value.unpackingExcess, 6)}</span>
                    <span className="oc-result-hero__detail">
                      The whole was given {formatValue(subadditivity.value.directProbability, 4)}; the parts sum to{' '}
                      {formatValue(subadditivity.value.partsSum, 4)}. Positive is the usual direction: unpacking inflates.
                    </span>
                  </div>
                  <Scroller>
                    <BarChart
                      title="Probability given to each part"
                      description="The parts as stated, against the probability given to the whole event."
                      data={subadditivity.value.parts.map((p, i) => ({ x: i + 1, y: p.probability, label: p.label }))}
                      xLabel="Part"
                      yLabel="Stated probability"
                      seriesLabel="Stated probability"
                      asPercent
                      note={`The whole event was given ${formatValue(subadditivity.value.directProbability, 4)}.`}
                    />
                  </Scroller>
                  {subadditivity.value.violations.length > 0 && (
                    <Notice tone="error" title="Violations" items={subadditivity.value.violations.map((v) => `${v.message} (size ${formatValue(v.amount, 6)})`)} />
                  )}
                  <Warnings warnings={subadditivity.value.warnings} />
                  <Caveats basis={subadditivity.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'coherence' && config.coherenceCheck === 'partition-dependence' && (
            <Card title="Does the answer depend on how the question was split?">
              {!partitionDependence ? null : !partitionDependence.ok ? (
                <Notice tone="error">{partitionDependence.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={partitionDependence.value.basis} />
                  <Notice tone={partitionDependence.value.detected ? 'error' : 'info'} title={partitionDependence.value.detected ? 'Partition dependence detected' : 'No partition dependence above the threshold'}>
                    <p style={{ margin: 0 }}>{partitionDependence.value.direction}</p>
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Spread in the probability given to the same event', value: formatValue(partitionDependence.value.spread, 6) },
                      { label: 'Correlation between how finely it was split and the probability it got', value: formatValue(partitionDependence.value.splitCorrelation, 4) },
                      { label: 'Detection threshold', value: formatValue(partitionDependence.value.threshold, 4) },
                    ]}
                  />
                  <Scroller>
                    <DataTable
                      caption="The same event under each partition"
                      columns={[
                        { key: 'name', header: 'Partition', render: (r) => r.partitionName },
                        { key: 'cats', header: 'Categories', numeric: true, render: (r) => String(r.categoryCount) },
                        { key: 'target', header: 'Of which target', numeric: true, render: (r) => String(r.targetCategoryCount) },
                        { key: 'p', header: 'Probability given to the target', numeric: true, render: (r) => formatValue(r.targetProbability, 4) },
                        { key: 'sum', header: 'Sum of the partition', numeric: true, render: (r) => formatValue(r.sum, 4) },
                      ]}
                      rows={partitionDependence.value.perPartition}
                    />
                  </Scroller>
                  <Warnings warnings={partitionDependence.value.warnings} />
                  <Caveats basis={partitionDependence.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'coherence' && config.coherenceCheck === 'anchoring' && (
            <Card title="Was the judge pulled by the numbers they saw first?">
              {!anchoring ? null : !anchoring.ok ? (
                <Notice tone="error">{anchoring.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={anchoring.value.basis} />
                  <Notice tone={anchoring.value.detected ? 'error' : 'info'} title={anchoring.value.detected ? 'Anchoring detected' : 'No anchoring above the threshold'}>
                    <p style={{ margin: 0 }}>{anchoring.value.interpretation}</p>
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Slope of the answer on the anchor', value: `${formatValue(anchoring.value.anchorSlope, 4)} — 0 is no pull, 1 means the anchor was the answer` },
                      { label: 'Correlation between anchor and answer', value: formatValue(anchoring.value.anchorCorrelation, 4) },
                      { label: "Correlation with the judge's own previous answer", value: formatValue(anchoring.value.serialCorrelation, 4) },
                      { label: 'Judgements in the sequence', value: String(anchoring.value.n) },
                    ]}
                  />
                  <Scroller>
                    <ScatterChart
                      title="Answer against anchor"
                      description="Each point is one judgement: the number shown first, and the answer given."
                      points={lines(config.anchorText)
                        .map((row) => labelledNumbers(row, 2))
                        .filter((p): p is { ok: true; value: { label: string; values: number[] } } => p.ok)
                        .map((p) => ({ x: p.value.values[0], y: p.value.values[1] }))}
                      xLabel="Anchor shown"
                      yLabel="Answer given"
                      trendLine={{ slope: anchoring.value.anchorSlope, intercept: 0, label: 'Fitted slope through the origin' }}
                    />
                  </Scroller>
                  <Warnings warnings={anchoring.value.warnings} />
                  <Caveats basis={anchoring.value.basis} />
                </>
              )}
            </Card>
          )}

          {/* ----------------------------------------------- 6. experts */}
          {mode === 'experts' && config.expertForm === 'pools' && (
            <>
              <Card title="Linear and logarithmic opinion pools">
                {!experts.ok ? (
                  <Notice tone="error">{experts.error}</Notice>
                ) : !pools ? null : !pools.ok ? (
                  <Notice tone="error">{pools.error}</Notice>
                ) : (
                  <>
                    <AssumedBadge basis={pools.value.basis} />
                    <Notice tone={pools.value.choiceMatters ? 'warning' : 'info'} title={pools.value.choiceMatters ? 'The choice between the two pools matters here' : 'The two pools nearly agree here'}>
                      <p style={{ margin: 0 }}>
                        The <strong>linear pool</strong> is a mixture and preserves disagreement: wider, possibly
                        multimodal. The <strong>logarithmic pool</strong> is a geometric mean and is more decisive — it
                        can be narrower than any single expert, which is badly overconfident unless the experts are
                        independent sources of evidence. Its standard deviation is{' '}
                        {formatValue(pools.value.logarithmic.sd, 4)} against the linear pool&rsquo;s{' '}
                        {formatValue(pools.value.linear.sd, 4)}, a ratio of{' '}
                        {Number.isFinite(pools.value.sdRatio) ? formatValue(pools.value.sdRatio, 4) : 'unbounded'}.
                      </p>
                    </Notice>
                    <Scroller>
                      <DataTable
                        caption="The two pools side by side"
                        columns={[
                          { key: 'what', header: '', render: (r) => r.what },
                          { key: 'linear', header: 'Linear (mixture)', numeric: true, render: (r) => r.linear },
                          { key: 'log', header: 'Logarithmic (geometric mean)', numeric: true, render: (r) => r.log },
                        ]}
                        rows={[
                          { what: 'Mean', linear: formatValue(pools.value.linear.mean, 6), log: formatValue(pools.value.logarithmic.mean, 6) },
                          { what: 'Standard deviation', linear: formatValue(pools.value.linear.sd, 6), log: formatValue(pools.value.logarithmic.sd, 6) },
                          { what: 'Wider than the widest expert?', linear: formatValue(pools.value.linear.spreadRatioToWidestExpert, 4), log: formatValue(pools.value.logarithmic.spreadRatioToWidestExpert, 4) },
                          { what: 'Multimodal', linear: pools.value.linear.multimodal ? 'Yes' : 'No', log: pools.value.logarithmic.multimodal ? 'Yes' : 'No' },
                        ]}
                      />
                    </Scroller>
                    <Scroller>
                      <LineChart
                        title="Both pools of the same experts"
                        description="The linear pool keeps the disagreement; the logarithmic pool concentrates on the overlap."
                        series={[
                          { label: 'Linear pool', area: true, points: pools.value.linear.grid.map((x, i) => ({ x, y: pools.value.linear.density[i] })).filter((_, i) => i % 3 === 0) },
                          { label: 'Logarithmic pool', dashed: true, points: pools.value.logarithmic.grid.map((x, i) => ({ x, y: pools.value.logarithmic.density[i] })).filter((_, i) => i % 3 === 0) },
                        ]}
                        xLabel="Value"
                        yLabel="Density"
                      />
                    </Scroller>
                    <Disclosure title="What each pool is for, and why neither dominates">
                      <ul style={{ fontSize: 12.5, paddingLeft: '1.1rem', margin: 0 }}>
                        {POOL_COMPARISON_NOTE.map((n) => (
                          <li key={n} style={{ marginBottom: 4 }}>
                            {n}
                          </li>
                        ))}
                      </ul>
                    </Disclosure>
                    <Warnings warnings={pools.value.warnings} />
                    <Caveats basis={pools.value.basis} />
                  </>
                )}
              </Card>

              <Card title="How much of the uncertainty is disagreement?">
                {!disagreement ? null : !disagreement.ok ? (
                  <Notice tone="error">{disagreement.error}</Notice>
                ) : (
                  <>
                    <AssumedBadge basis={disagreement.value.basis} />
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Share of the variance that is between experts</span>
                      <span className="oc-result-hero__value">{formatValue(disagreement.value.betweenShare * 100, 4)}%</span>
                      <span className="oc-result-hero__detail">{disagreement.value.interpretation}</span>
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Between-expert variance — uncertainty about who is right', value: formatValue(disagreement.value.betweenExpertVariance, 6) },
                        { label: 'Within-expert variance — the uncertainty each expert reports', value: formatValue(disagreement.value.withinExpertVariance, 6) },
                        { label: 'Range of the experts’ central estimates', value: formatValue(disagreement.value.meanRange, 6) },
                        { label: 'Largest standardised gap', value: `${disagreement.value.largestStandardisedGap.experts.join(' vs ')} — ${formatValue(disagreement.value.largestStandardisedGap.gap, 4)} standard deviations` },
                      ]}
                    />
                    <Warnings warnings={disagreement.value.warnings} />
                  </>
                )}
              </Card>
            </>
          )}

          {mode === 'experts' && config.expertForm === 'correlated' && (
            <Card title="Treating correlated experts as independent fabricates confidence">
              {!experts.ok ? (
                <Notice tone="error">{experts.error}</Notice>
              ) : !correlated ? null : !correlated.ok ? (
                <Notice tone="error">{correlated.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={correlated.value.basis} />
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Confidence the independence assumption would invent</span>
                    <span className="oc-result-hero__value">×{formatValue(correlated.value.inflationFactor, 4)}</span>
                    <span className="oc-result-hero__detail">
                      Aggregate standard deviation {formatValue(correlated.value.sd, 6)} with the stated correlation,
                      against {formatValue(correlated.value.sdIfIndependent, 6)} if the experts were treated as
                      independent.
                    </span>
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Aggregate central estimate', value: formatValue(correlated.value.mean, 6) },
                      { label: 'How many independent experts this set is worth', value: formatValue(correlated.value.effectiveNumberOfExperts, 4) },
                      { label: 'Correlation structure', value: correlated.value.correlationDescription },
                    ]}
                  />
                  <Scroller>
                    <DataTable
                      caption="The weight each expert received"
                      columns={[
                        { key: 'expert', header: 'Expert', render: (r) => r.expert },
                        { key: 'weight', header: 'Implicit weight', numeric: true, render: (r) => formatValue(r.weight, 4) },
                        { key: 'sign', header: 'Note', render: (r) => (r.weight < 0 ? 'Negative — this expert is being used to correct the others' : '') },
                      ]}
                      rows={correlated.value.weights}
                    />
                  </Scroller>
                  <Warnings warnings={correlated.value.warnings} />
                  <Caveats basis={correlated.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'experts' && config.expertForm === 'cooke' && (
            <Card title="Weighting experts by measured calibration">
              {!config.runExpertWeighting ? (
                <>
                  <Notice tone="warning" title="Cooke's method and its cross-validation are not run automatically">
                    <p style={{ marginTop: 0 }}>
                      Scoring every expert on the seed questions, and then refitting the weights once per held-out
                      seed for the leave-one-seed-out comparison, is many times the work of a single scoring pass. It
                      runs only when you ask for it, so the page is never blocked before it has drawn.
                    </p>
                    <p style={{ marginBottom: 0 }}>
                      Both the in-sample and the out-of-sample comparison are reported together, because the
                      in-sample one is favourable to performance weighting by construction.
                    </p>
                  </Notice>
                  <div className="oc-btn-row">
                    <Button icon="play" variant="primary" onClick={() => set({ runExpertWeighting: true })}>
                      Score the experts
                    </Button>
                  </div>
                </>
              ) : !cooke ? null : !cooke.ok ? (
                <Notice tone="error">{cooke.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={cooke.value.inSample.basis} />
                  <Scroller>
                    <DataTable
                      caption="Each expert's calibration, information and weight"
                      columns={[
                        { key: 'expert', header: 'Expert', render: (r) => r.expert },
                        { key: 'cal', header: 'Calibration', numeric: true, render: (r) => formatValue(r.calibration, 4) },
                        { key: 'info', header: 'Information (nats)', numeric: true, render: (r) => formatValue(r.information, 4) },
                        { key: 'perf', header: 'Performance weight', numeric: true, render: (r) => formatValue(r.performanceWeight, 4) },
                        { key: 'equal', header: 'Equal weight', numeric: true, render: (r) => formatValue(r.equalWeight, 4) },
                      ]}
                      rows={cooke.value.inSample.experts}
                    />
                  </Scroller>
                  <Notice tone="warning" title="In sample, performance weighting wins by construction">
                    <p style={{ marginTop: 0 }}>
                      On the seed questions themselves the {cooke.value.inSample.inSampleWinner === 'equal' ? 'equally' : 'performance'}
                      -weighted decision maker scored better (combined score{' '}
                      {formatValue(cooke.value.inSample.performanceWeightedDecisionMaker.combined, 4)} against{' '}
                      {formatValue(cooke.value.inSample.equallyWeightedDecisionMaker.combined, 4)} for equal weights).
                      The weights were fitted to those same seeds, so this comparison favours performance weighting
                      whatever the data.
                    </p>
                    <p style={{ marginBottom: 0 }}>The honest comparison is the held-out one below.</p>
                  </Notice>
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Leave-one-seed-out: which scheme generalised</span>
                    <span className="oc-result-hero__value">
                      {cooke.value.crossValidated.winner === 'equal' ? 'Equal weighting' : cooke.value.crossValidated.winner === 'performance' ? 'Performance weighting' : 'A tie'}
                    </span>
                    <span className="oc-result-hero__detail">{cooke.value.crossValidated.verdict}</span>
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Out-of-sample log score, performance weighted (lower is better)', value: formatValue(cooke.value.crossValidated.performanceWeighted, 4) },
                      { label: 'Out-of-sample log score, equal weights', value: formatValue(cooke.value.crossValidated.equalWeighted, 4) },
                      { label: 'Advantage to performance weighting', value: formatValue(cooke.value.crossValidated.advantage, 4) },
                      { label: 'Folds', value: String(cooke.value.crossValidated.folds) },
                    ]}
                  />
                  <Scroller>
                    <DataTable
                      caption="Each expert alone, out of sample"
                      columns={[
                        { key: 'expert', header: 'Expert', render: (r) => r.expert },
                        { key: 'score', header: 'Mean held-out log score', numeric: true, render: (r) => formatValue(r.meanLogScore, 4) },
                      ]}
                      rows={cooke.value.crossValidated.individualExperts}
                    />
                  </Scroller>
                  <Warnings warnings={[...cooke.value.inSample.warnings, ...cooke.value.crossValidated.warnings]} />
                  <Caveats basis={cooke.value.crossValidated.basis} />
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------------- 7. track */}
          {mode === 'track' && config.trackForm === 'intervals' && (
            <Card title="How often did the stated intervals contain the answer?">
              {!intervalRecord ? null : !intervalRecord.ok ? (
                <Notice tone="error">{intervalRecord.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={intervalRecord.value.basis} />
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">
                      Stated {formatValue(intervalRecord.value.nominalLevel * 100, 4)}% intervals captured
                    </span>
                    <span className="oc-result-hero__value">{formatValue(intervalRecord.value.hitRate * 100, 4)}%</span>
                    <span className="oc-result-hero__detail">
                      {intervalRecord.value.hits} of {intervalRecord.value.n} · diagnosis: {intervalRecord.value.diagnosis}
                    </span>
                  </div>
                  <Notice tone={intervalRecord.value.correctedWidthMultiplier > 1.1 ? 'warning' : 'info'} title="Overconfidence correction">
                    <p style={{ margin: 0 }}>
                      Multiply every stated interval width by{' '}
                      <strong>×{formatValue(intervalRecord.value.correctedWidthMultiplier, 4)}</strong> to reach the
                      nominal coverage. This assumes the judge&rsquo;s real uncertainty is normal in shape, which is
                      the weakest step in the calculation; the raw hit rate above does not depend on it.
                    </p>
                  </Notice>
                  <KeyValueList
                    items={[
                      { label: 'Shortfall (nominal − realised)', value: formatValue(intervalRecord.value.shortfall, 4) },
                      {
                        label: 'Uncertainty in the hit rate itself',
                        value: `[${formatValue(intervalRecord.value.hitRateInterval.low, 4)}, ${formatValue(intervalRecord.value.hitRateInterval.high, 4)}] at level ${formatValue(intervalRecord.value.hitRateInterval.level, 3)} (${intervalRecord.value.hitRateInterval.method})`,
                      },
                      { label: 'Significantly miscalibrated at this record length?', value: intervalRecord.value.significantlyMiscalibrated ? 'Yes' : 'No — the record is consistent with the nominal level' },
                    ]}
                  />
                  <Scroller>
                    <DataTable
                      caption="Stated widths and the corrected widths"
                      columns={[
                        { key: 'label', header: 'Question', render: (r) => r.label ?? '' },
                        { key: 'corrected', header: 'Corrected interval', render: (r) => `[${formatValue(r.lower, 5)}, ${formatValue(r.upper, 5)}]` },
                        { key: 'width', header: 'Corrected width', numeric: true, render: (r) => formatValue(r.width, 5) },
                      ]}
                      rows={intervalRecord.value.correctedIntervals}
                      maxHeight={300}
                    />
                  </Scroller>
                  {intervalRecord.value.misses.length > 0 && (
                    <Scroller>
                      <DataTable
                        caption="The outcomes that fell outside their interval"
                        columns={[
                          { key: 'label', header: 'Question', render: (r) => r.label ?? `#${r.index + 1}` },
                          { key: 'side', header: 'Missed', render: (r) => r.side },
                          { key: 'distance', header: 'By', numeric: true, render: (r) => formatValue(r.distance, 5) },
                        ]}
                        rows={intervalRecord.value.misses}
                        maxHeight={300}
                      />
                    </Scroller>
                  )}
                  <Warnings warnings={intervalRecord.value.warnings} />
                  <Caveats basis={intervalRecord.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'track' && config.trackForm === 'binary' && (
            <Card title="Proper scoring and the Murphy decomposition">
              {!binaryRecord ? null : !binaryRecord.ok ? (
                <Notice tone="error">{binaryRecord.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={binaryRecord.value.basis} />
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Brier score over {binaryRecord.value.n} judgements</span>
                    <span className="oc-result-hero__value">{formatValue(binaryRecord.value.brier.brierScore, 5)}</span>
                    <span className="oc-result-hero__detail">{binaryRecord.value.verdict}</span>
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Reliability (calibration) — 0 is perfect', value: formatValue(binaryRecord.value.calibrationComponent, 5) },
                      { label: 'Resolution — larger is better', value: formatValue(binaryRecord.value.resolutionComponent, 5) },
                      { label: 'Uncertainty — the base rate, not the judge', value: formatValue(binaryRecord.value.brier.uncertainty, 5) },
                      { label: 'Skill against always saying the base rate', value: `${formatValue(binaryRecord.value.brierSkill.skill, 4)} (base rate ${formatValue(binaryRecord.value.climatology.baseRate, 4)})` },
                      { label: 'Mean log score', value: binaryRecord.value.logarithmic.finite ? `${formatValue(binaryRecord.value.logarithmic.value, 5)} ${binaryRecord.value.logarithmic.baseLabel}` : 'Infinite — a judgement of 0 or 1 was wrong' },
                      { label: 'Expected calibration error', value: formatValue(binaryRecord.value.reliability.ece, 5) },
                    ]}
                  />
                  <Notice tone={binaryRecord.value.uncertainty.sufficient ? 'info' : 'warning'} title="How much this record can establish">
                    <p style={{ marginTop: 0 }}>{binaryRecord.value.uncertainty.verdict}</p>
                    <p style={{ marginBottom: 0 }}>
                      A perfectly calibrated judge would show an expected calibration error of about{' '}
                      {formatValue(binaryRecord.value.uncertainty.eceNoiseFloor, 4)} at this record length and bin
                      count, from sampling noise alone. An observed value below that is evidence of nothing.
                    </p>
                  </Notice>
                  <Scroller>
                    <CalibrationChart
                      title="Calibration curve"
                      description="Stated probability against the frequency with which those judgements came true, with the uncertainty of each point."
                      bins={binaryRecord.value.reliability.bins
                        .filter((b) => b.count > 0)
                        .map((b) => ({ predicted: b.meanForecast, observed: b.observedFrequency, n: b.count, lower: b.interval.low, upper: b.interval.high }))}
                      baseRate={binaryRecord.value.climatology.baseRate}
                      note="Each point carries its own interval. Points from few judgements say very little whatever their position."
                    />
                  </Scroller>
                  <Warnings warnings={binaryRecord.value.warnings} />
                  <Caveats basis={binaryRecord.value.basis} />
                </>
              )}
            </Card>
          )}

          {mode === 'track' && config.trackForm === 'continuous' && (
            <Card title="Quantile-hit (PIT) histogram">
              {!continuousRecord ? null : !continuousRecord.ok ? (
                <Notice tone="error">{continuousRecord.error}</Notice>
              ) : (
                <>
                  <AssumedBadge basis={continuousRecord.value.basis} />
                  <div className="oc-result-hero">
                    <span className="oc-result-hero__label">Shape of the histogram</span>
                    <span className="oc-result-hero__value" style={{ fontSize: 24 }}>
                      {continuousRecord.value.diagnosis}
                    </span>
                    <span className="oc-result-hero__detail">{continuousRecord.value.pit.diagnosis}</span>
                  </div>
                  <KeyValueList
                    items={[
                      { label: 'Mean of the quantile hits — ½ under calibration', value: formatValue(continuousRecord.value.meanPit, 5) },
                      { label: 'Variance — 1/12 ≈ 0.08333 under calibration; above means too narrow', value: formatValue(continuousRecord.value.variancePit, 5) },
                      { label: 'Realised coverage of the central 90%', value: `${formatValue(continuousRecord.value.central90Coverage * 100, 4)}% of ${continuousRecord.value.n} outcomes` },
                      { label: 'χ² against uniformity', value: `${formatValue(continuousRecord.value.pit.chiSquared, 5)} on ${continuousRecord.value.pit.degreesOfFreedom} degrees of freedom` },
                    ]}
                  />
                  <Scroller>
                    <BarChart
                      title="Where the outcomes fell inside the stated distributions"
                      description="Counts of the probability-integral-transform values, against the count expected if the judge were calibrated."
                      data={continuousRecord.value.pit.counts.map((c, i) => ({
                        x: (i + 0.5) / continuousRecord.value.pit.bins,
                        y: c,
                        compare: continuousRecord.value.pit.expected,
                        label: `${formatValue(i / continuousRecord.value.pit.bins, 3)}–${formatValue((i + 1) / continuousRecord.value.pit.bins, 3)}`,
                      }))}
                      xLabel="Quantile the outcome landed on"
                      yLabel="Number of outcomes"
                      seriesLabel="Observed"
                      compareLabel="Expected under calibration"
                      note="A U shape means the intervals were too narrow; a hump means too wide; a slope means biased."
                    />
                  </Scroller>
                  <Notice tone={continuousRecord.value.uncertainty.sufficient ? 'info' : 'warning'} title="How much this record can establish">
                    <p style={{ margin: 0 }}>{continuousRecord.value.uncertainty.verdict}</p>
                  </Notice>
                  <Warnings warnings={continuousRecord.value.warnings} />
                  <Caveats basis={continuousRecord.value.basis} />
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------- 8. explanation */}
          <Card title="Explanation">
            {activeExplanation ? (
              <ExplanationPanel explanation={activeExplanation} />
            ) : (
              <Notice tone="info">
                There is no computed result on screen yet, so there is nothing to explain. The panel appears with the
                result it belongs to.
              </Notice>
            )}
            <Notice tone="warning" title="Everything on this screen is an assumption">
              <p style={{ marginTop: 0 }}>
                Each result above is labelled <strong>assumed</strong> by the engine, not by this screen. The
                arithmetic is ordinary numerical mathematics and is as accurate as anywhere else in this application.
                The label is a claim about the <em>input</em>: it was somebody&rsquo;s opinion, and the input dominates
                the answer.
              </p>
              <p style={{ margin: 0 }}>
                A number derived from an opinion must never be presented with the authority of a measurement. If a
                figure from this screen is carried into a decision, the judgement it rests on — and the caveats listed
                with it — travel with it.
              </p>
            </Notice>
            <Disclosure title="What is wrong with elicited numbers, whoever the judge is" defaultOpen>
              <ul style={{ fontSize: 12.5, paddingLeft: '1.1rem', margin: 0 }}>
                {UNIVERSAL_ELICITATION_CAVEATS.map((c) => (
                  <li key={c} style={{ marginBottom: 6 }}>
                    {c}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </Card>
        </div>
      </div>
    </>
  );
}
