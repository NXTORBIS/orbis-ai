/**
 * Survival / time-to-event analysis.
 *
 * The point of this screen is censoring. A subject followed for 20 months
 * without the event is neither an event at 20 months nor a missing row, and
 * every panel here is arranged so that the censoring picture — how much of it
 * there is, where it sits, and what it does to each estimate — stays visible
 * next to the estimate it undermines. Two things in particular are presented
 * as refusals rather than numbers: a median that the curve never reaches, and
 * 1 − Kaplan–Meier used where competing causes exist.
 */
import { useMemo } from 'react';
import {
  EVENTS_DRIVE_POWER,
  INDEPENDENT_CENSORING,
  ONE_MINUS_KM_WARNING,
  PH_CHECK_REQUIRED,
  PROPORTIONAL_HAZARDS_CAVEAT,
  WEIGHT_DESCRIPTION,
  buildRiskTable,
  censoringNote,
  coxRegression,
  cumulativeIncidence,
  detectCrossingCurves,
  heavyCensoringWarnings,
  kaplanMeier,
  logRankTest,
  requiredEvents,
  restrictedMeanSurvival,
  schoenfeldTest,
  summarizeFollowUp,
  type CoxFit,
  type CrossingResult,
  type CumulativeIncidenceResult,
  type FollowUpSummary,
  type KaplanMeierResult,
  type LogRankResult,
  type LogRankWeight,
  type RMSTResult,
  type RequiredEventsResult,
  type RiskRow,
  type SchoenfeldResult,
  type TimeTransform,
} from '../../engine/survival';
import { EXACTNESS_LABEL, type Exactness, type Issue } from '../../engine/core/result';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  SelectField,
  SliderField,
  TextField,
} from '../../ui/primitives';
import { StepChart, type StepSeries } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

/* --------------------------------------------------------------- config */

export type WeightKind = LogRankWeight['kind'];

export interface SurvivalConfig {
  /** Observations as "time, status[, group]" per line; status 1 = event, 0 = censored. */
  data: string;
  /** Competing-risks data as "time, cause" per line; cause 0 = censored. */
  competingData: string;
  /** Confidence level used for every interval on the screen. */
  level: number;
  /** Which member of the weighted log-rank family to use. */
  weight: WeightKind;
  /** Fleming–Harrington exponents, used only when that weight is selected. */
  flemingP: number;
  flemingQ: number;
  /** τ for the restricted mean survival time. */
  rmstHorizon: number;
  showBand: boolean;
  /** Time transform for the Schoenfeld proportional-hazards test. */
  phTransform: TimeTransform;
  /** Cause whose cumulative incidence is shown in the competing-risks panel. */
  competingCause: number;
  designHazardRatio: number;
  designAlpha: number;
  designPower: number;
  designAllocationRatio: number;
}

/**
 * A small two-arm dataset with real censoring, chosen so the screen opens on
 * the interesting case: the control arm has an estimable median, the treated
 * arm's curve never falls to 0.5, so its median is reported as not estimable
 * rather than as the largest observed time.
 */
const EXAMPLE_DATA = [
  '# time, status, group   (status 1 = event, 0 = censored)',
  '4, 1, Control',
  '5, 1, Control',
  '6, 1, Control',
  '8, 1, Control',
  '9, 0, Control',
  '11, 1, Control',
  '12, 1, Control',
  '14, 1, Control',
  '16, 0, Control',
  '18, 1, Control',
  '20, 1, Control',
  '24, 0, Control',
  '7, 1, Treated',
  '10, 0, Treated',
  '13, 1, Treated',
  '15, 0, Treated',
  '19, 1, Treated',
  '22, 0, Treated',
  '25, 0, Treated',
  '26, 1, Treated',
  '28, 0, Treated',
  '30, 0, Treated',
  '32, 0, Treated',
  '34, 0, Treated',
].join('\n');

/** Cause 2 removes subjects from risk of cause 1, which is what makes 1 − KM wrong. */
const EXAMPLE_COMPETING = [
  '# time, cause   (1 = cause of interest, 2 = competing cause, 0 = censored)',
  '2, 2',
  '3, 1',
  '4, 2',
  '5, 1',
  '6, 2',
  '7, 0',
  '8, 1',
  '9, 2',
  '10, 1',
  '11, 2',
  '12, 0',
  '13, 1',
  '14, 2',
  '15, 1',
  '16, 2',
  '18, 0',
  '20, 1',
  '22, 2',
  '24, 1',
  '26, 0',
].join('\n');

export const SURVIVAL_DEFAULT: SurvivalConfig = {
  data: EXAMPLE_DATA,
  competingData: EXAMPLE_COMPETING,
  level: 0.95,
  weight: 'log-rank',
  flemingP: 1,
  flemingQ: 0,
  rmstHorizon: 20,
  showBand: true,
  phTransform: 'km',
  competingCause: 1,
  designHazardRatio: 0.7,
  designAlpha: 0.05,
  designPower: 0.8,
  designAllocationRatio: 1,
};

/* ---------------------------------------------------------------- parsing */

interface SurvivalRow {
  time: number;
  status: 0 | 1;
  group: string;
}

interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

interface ParsedSurvival {
  rows: SurvivalRow[];
  skipped: SkippedLine[];
  groups: string[];
}

const MAX_ROWS = 5000;

/** Fields are comma-, semicolon- or tab-separated; whitespace alone also works. */
function splitFields(line: string): string[] {
  const parts = /[,;\t]/.test(line) ? line.split(/[,;\t]/) : line.split(/\s+/);
  return parts.map((p) => p.trim());
}

function isDataLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && !t.startsWith('#');
}

/**
 * Pasted text is untrusted: every line is validated and anything unusable is
 * reported by line number. Silently dropping a row would change n, the event
 * count and the censoring fraction without saying so.
 */
function parseSurvivalData(text: string): ParsedSurvival {
  const rows: SurvivalRow[] = [];
  const skipped: SkippedLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!isDataLine(raw)) continue;
    if (rows.length >= MAX_ROWS) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `Beyond the limit of ${MAX_ROWS} observations.` });
      continue;
    }
    const fields = splitFields(raw).filter((f) => f.length > 0);
    if (fields.length < 2) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: 'Needs at least a time and a status, separated by a comma.' });
      continue;
    }
    const time = Number(fields[0]);
    if (!Number.isFinite(time)) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `"${fields[0]}" is not a number, so the follow-up time could not be read.` });
      continue;
    }
    if (time < 0) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `Follow-up time ${time} is negative; times must be 0 or more.` });
      continue;
    }
    const statusText = fields[1];
    if (statusText !== '0' && statusText !== '1') {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `Status "${statusText}" is not 0 or 1. Use 1 for the event and 0 for right-censored.` });
      continue;
    }
    const group = fields.length >= 3 ? fields.slice(2).join(' ').slice(0, 60) : 'All subjects';
    rows.push({ time, status: statusText === '1' ? 1 : 0, group });
  }
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b));
  return { rows, skipped, groups };
}

interface ParsedCompeting {
  times: number[];
  causes: number[];
  skipped: SkippedLine[];
}

function parseCompetingData(text: string): ParsedCompeting {
  const times: number[] = [];
  const causes: number[] = [];
  const skipped: SkippedLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!isDataLine(raw)) continue;
    if (times.length >= MAX_ROWS) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `Beyond the limit of ${MAX_ROWS} observations.` });
      continue;
    }
    const fields = splitFields(raw).filter((f) => f.length > 0);
    if (fields.length < 2) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: 'Needs a time and a cause code, separated by a comma.' });
      continue;
    }
    const time = Number(fields[0]);
    const cause = Number(fields[1]);
    if (!Number.isFinite(time) || time < 0) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `"${fields[0]}" is not a usable follow-up time.` });
      continue;
    }
    if (!Number.isInteger(cause) || cause < 0) {
      skipped.push({ line: i + 1, text: raw.trim(), reason: `Cause "${fields[1]}" must be a whole number: 0 for censored, 1, 2, … for the causes.` });
      continue;
    }
    times.push(time);
    causes.push(cause);
  }
  return { times, causes, skipped };
}

/* -------------------------------------------------------------- analysis */

interface GroupAnalysis {
  group: string;
  times: number[];
  statuses: number[];
  summary: FollowUpSummary;
  warnings: string[];
  km: KaplanMeierResult | null;
  kmErrors: Issue[];
  rmst: RMSTResult | null;
  rmstErrors: Issue[];
}

interface Analysis {
  groups: GroupAnalysis[];
  overall: FollowUpSummary | null;
  overallWarnings: string[];
  riskTable: RiskRow[];
  logRank: LogRankResult | null;
  logRankErrors: Issue[];
  crossing: CrossingResult | null;
  crossingErrors: Issue[];
  cox: CoxFit | null;
  coxErrors: Issue[];
  coxWarnings: string[];
  schoenfeld: SchoenfeldResult | null;
  schoenfeldErrors: Issue[];
  /** Set when the whole analysis could not be attempted at all. */
  fatal: string | null;
}

function weightFromConfig(config: SurvivalConfig): LogRankWeight {
  if (config.weight === 'fleming-harrington') return { kind: 'fleming-harrington', p: config.flemingP, q: config.flemingQ };
  return { kind: config.weight };
}

const EMPTY_ANALYSIS: Analysis = {
  groups: [],
  overall: null,
  overallWarnings: [],
  riskTable: [],
  logRank: null,
  logRankErrors: [],
  crossing: null,
  crossingErrors: [],
  cox: null,
  coxErrors: [],
  coxWarnings: [],
  schoenfeld: null,
  schoenfeldErrors: [],
  fatal: null,
};

function buildAnalysis(parsed: ParsedSurvival, config: SurvivalConfig): Analysis {
  if (parsed.rows.length === 0) {
    return { ...EMPTY_ANALYSIS, fatal: 'No usable observations were read. Enter at least one line as "time, status[, group]".' };
  }
  const allTimes = parsed.rows.map((r) => r.time);
  const allStatus = parsed.rows.map((r) => r.status);
  const groupLabels = parsed.rows.map((r) => r.group);

  const groups: GroupAnalysis[] = parsed.groups.map((g) => {
    const rows = parsed.rows.filter((r) => r.group === g);
    const times = rows.map((r) => r.time);
    const statuses = rows.map((r) => r.status);
    const summary = summarizeFollowUp(times, statuses);
    const km = kaplanMeier(times, statuses, { level: config.level });
    const rmst = restrictedMeanSurvival(times, statuses, config.rmstHorizon, config.level);
    return {
      group: g,
      times,
      statuses,
      summary,
      warnings: heavyCensoringWarnings(summary),
      km: km.ok ? km.value : null,
      kmErrors: km.ok ? [] : km.errors,
      rmst: rmst.ok ? rmst.value : null,
      rmstErrors: rmst.ok ? [] : rmst.errors,
    };
  });

  let logRank: LogRankResult | null = null;
  let logRankErrors: Issue[] = [];
  let crossing: CrossingResult | null = null;
  let crossingErrors: Issue[] = [];
  if (parsed.groups.length >= 2) {
    const lr = logRankTest(allTimes, allStatus, groupLabels, { weight: weightFromConfig(config) });
    if (lr.ok) logRank = lr.value;
    else logRankErrors = lr.errors;
    if (parsed.groups.length === 2) {
      const cr = detectCrossingCurves(allTimes, allStatus, groupLabels);
      if (cr.ok) crossing = cr.value;
      else crossingErrors = cr.errors;
    }
  }

  // Cox needs at least one covariate, so it runs only with two or more groups:
  // indicator covariates against the first group alphabetically as reference.
  let cox: CoxFit | null = null;
  let coxErrors: Issue[] = [];
  let coxWarnings: string[] = [];
  let schoenfeld: SchoenfeldResult | null = null;
  let schoenfeldErrors: Issue[] = [];
  if (parsed.groups.length >= 2) {
    const reference = parsed.groups[0];
    const others = parsed.groups.slice(1);
    const covariates = parsed.rows.map((r) => others.map((g) => (r.group === g ? 1 : 0)));
    const names = others.map((g) => `${g} vs ${reference}`);
    const fit = coxRegression(allTimes, allStatus, covariates, { names, level: config.level });
    if (fit.ok) {
      cox = fit.value;
      coxWarnings = fit.warnings;
      const sch = schoenfeldTest(fit.value, { transform: config.phTransform, alpha: 1 - config.level });
      if (sch.ok) schoenfeld = sch.value;
      else schoenfeldErrors = sch.errors;
    } else {
      coxErrors = fit.errors;
    }
  }

  const overall = summarizeFollowUp(allTimes, allStatus);
  return {
    groups,
    overall,
    overallWarnings: heavyCensoringWarnings(overall),
    riskTable: buildRiskTable(allTimes, allStatus),
    logRank,
    logRankErrors,
    crossing,
    crossingErrors,
    cox,
    coxErrors,
    coxWarnings,
    schoenfeld,
    schoenfeldErrors,
    fatal: null,
  };
}

/* ----------------------------------------------------------- small parts */

function IssueNotice({ issues, title }: { issues: Issue[]; title: string }) {
  if (issues.length === 0) return null;
  return <Notice tone="error" title={title} items={issues.map((i) => i.message)} />;
}

/**
 * Exactness plus the one assumption that no estimator in this module can
 * check. Both are repeated on every result on purpose.
 */
function ResultFooter({ exactness, extra }: { exactness: Exactness; extra?: string }) {
  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <Badge variant={exactness}>{EXACTNESS_LABEL[exactness]}</Badge>
      <p className="oc-chart-note" style={{ marginTop: 'var(--s2)' }}>
        {INDEPENDENT_CENSORING}
        {extra ? ` ${extra}` : ''}
      </p>
    </div>
  );
}

function pValueText(p: number): string {
  return p < 1e-4 ? '< 0.0001' : p.toFixed(4);
}

function intervalText(lower: number | null, upper: number | null, level: number): string {
  if (lower === null && upper === null) return `${formatPercent(level)} interval not estimable`;
  const lo = lower === null ? 'not estimable' : formatValue(lower, 4);
  const hi = upper === null ? 'not estimable' : formatValue(upper, 4);
  return `${lo} to ${hi}`;
}

/* ------------------------------------------------------------------ tool */

export function SurvivalTool({ config }: { config: SurvivalConfig }) {
  const app = useApp();
  const set = (patch: Partial<SurvivalConfig>) => app.updateConfig({ ...config, ...patch });

  const parsed = useMemo(() => parseSurvivalData(config.data), [config.data]);
  const analysis = useMemo(() => {
    try {
      return buildAnalysis(parsed, config);
    } catch (e) {
      // The engine signals refusals through EngineResult, but a thrown
      // EngineError must never blank the screen either.
      return { ...EMPTY_ANALYSIS, fatal: (e as Error).message };
    }
  }, [parsed, config]);

  const competingParsed = useMemo(() => parseCompetingData(config.competingData), [config.competingData]);
  const competing = useMemo<{ value: CumulativeIncidenceResult | null; errors: Issue[] }>(() => {
    if (competingParsed.times.length === 0) return { value: null, errors: [] };
    try {
      const r = cumulativeIncidence(competingParsed.times, competingParsed.causes, config.competingCause, config.level);
      return r.ok ? { value: r.value, errors: [] } : { value: null, errors: r.errors };
    } catch (e) {
      return { value: null, errors: [{ code: 'failed', message: (e as Error).message }] };
    }
  }, [competingParsed, config.competingCause, config.level]);

  const design = useMemo<{ schoenfeld: RequiredEventsResult | null; freedman: RequiredEventsResult | null; errors: Issue[] }>(() => {
    const common = {
      hazardRatio: config.designHazardRatio,
      alpha: config.designAlpha,
      power: config.designPower,
      allocationRatio: config.designAllocationRatio,
    };
    const a = requiredEvents({ ...common, formula: 'schoenfeld' });
    const b = requiredEvents({ ...common, formula: 'freedman' });
    return {
      schoenfeld: a.ok ? a.value : null,
      freedman: b.ok ? b.value : null,
      errors: a.ok ? (b.ok ? [] : b.errors) : a.errors,
    };
  }, [config.designHazardRatio, config.designAlpha, config.designPower, config.designAllocationRatio]);

  const curveSeries = useMemo<StepSeries[]>(
    () =>
      analysis.groups
        .filter((g): g is GroupAnalysis & { km: KaplanMeierResult } => g.km !== null)
        .map((g, i) => ({
          label: g.group,
          // Every curve starts at survival 1 before the first event time.
          points: [{ x: 0, y: 1 }, ...g.km.curve.map((p) => ({ x: p.time, y: p.survival }))],
          band: config.showBand
            ? [{ x: 0, lower: 1, upper: 1 }, ...g.km.curve.map((p) => ({ x: p.time, lower: p.lower, upper: p.upper }))]
            : undefined,
          // Ticks come from the observations themselves, not the curve, so a
          // censoring after the last event is still drawn.
          censored: g.times.filter((_, j) => g.statuses[j] === 0),
          // Dashes as well as colour: group identity must survive a greyscale print.
          dashed: i % 2 === 1,
        })),
    [analysis.groups, config.showBand],
  );

  const cifSeries = useMemo<StepSeries[]>(() => {
    const cif = competing.value;
    if (!cif) return [];
    return [
      {
        label: `Cumulative incidence, cause ${cif.cause} (Aalen–Johansen)`,
        points: [{ x: 0, y: 0 }, ...cif.curve.map((p) => ({ x: p.time, y: p.cumulativeIncidence }))],
        band: [{ x: 0, lower: 0, upper: 0 }, ...cif.curve.map((p) => ({ x: p.time, lower: p.lower, upper: p.upper }))],
      },
      {
        label: '1 − Kaplan–Meier (overestimates)',
        points: [{ x: 0, y: 0 }, ...cif.curve.map((p) => ({ x: p.time, y: p.oneMinusKaplanMeier }))],
        dashed: true,
      },
    ];
  }, [competing.value]);

  const overall = analysis.overall;
  const phFails = analysis.schoenfeld?.global.rejects ?? false;

  return (
    <>
      <ToolHeader toolId="survival" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Observations" hint="One subject per line. Lines beginning with # are ignored.">
            <TextField
              label="Follow-up data (time, status, group)"
              value={config.data}
              onChange={(data) => set({ data })}
              multiline
              rows={12}
              monospace
              maxLength={200_000}
              hint='Status 1 = the event happened, 0 = right-censored (still event-free when observation stopped). The group field is optional.'
            />
            <div className="oc-btn-row" style={{ marginTop: 'var(--s2)' }}>
              <Button size="sm" onClick={() => set({ data: EXAMPLE_DATA })}>
                Load the built-in two-arm example
              </Button>
            </div>

            {parsed.skipped.length > 0 && (
              <Notice
                tone="warning"
                title={`${parsed.skipped.length} line${parsed.skipped.length === 1 ? '' : 's'} could not be read and ${
                  parsed.skipped.length === 1 ? 'was' : 'were'
                } left out`}
                items={parsed.skipped.map((s) => `Line ${s.line}: ${s.reason} (text: ${s.text.slice(0, 60)})`)}
              />
            )}

            {analysis.fatal && <Notice tone="error">{analysis.fatal}</Notice>}

            {overall && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Subjects (n)', value: overall.n.toLocaleString('en-US') },
                    { label: 'Events observed', value: overall.events.toLocaleString('en-US') },
                    { label: 'Censored', value: overall.censored.toLocaleString('en-US') },
                    { label: 'Censoring percentage', value: formatPercent(overall.censoringFraction, 1) },
                    { label: 'Follow-up range', value: `${formatValue(overall.minTime, 4)} to ${formatValue(overall.maxTime, 4)}` },
                    { label: 'Last observed event', value: overall.lastEventTime === null ? 'none' : formatValue(overall.lastEventTime, 4) },
                    { label: 'Distinct event times', value: overall.distinctEventTimes.toLocaleString('en-US') },
                    { label: 'Groups', value: parsed.groups.join(', ') },
                  ]}
                />
                {analysis.overallWarnings.length > 0 && <Notice tone="warning" title="Censoring picture" items={analysis.overallWarnings} />}
                <p className="oc-chart-note">{censoringNote(overall)}</p>
              </>
            )}
          </Card>

          <Card title="Options">
            <SliderField
              label="Confidence level"
              value={config.level}
              onChange={(level) => set({ level })}
              min={0.5}
              max={0.999}
              step={0.005}
              hint="Used for every interval on this screen."
            />
            <NumberField
              label="RMST horizon τ"
              symbol="τ"
              value={config.rmstHorizon}
              onChange={(rmstHorizon) => set({ rmstHorizon })}
              min={0.0001}
              hint="The restricted mean is the area under the curve up to this time. It must be inside the follow-up to mean anything."
            />
            <SelectField
              label="Log-rank weighting"
              value={config.weight}
              onChange={(weight) => set({ weight: weight as WeightKind })}
              options={[
                { value: 'log-rank', label: 'Log-rank (equal weights)' },
                { value: 'gehan-breslow-wilcoxon', label: 'Gehan–Breslow–Wilcoxon (early)' },
                { value: 'tarone-ware', label: 'Tarone–Ware (compromise)' },
                { value: 'peto-peto', label: 'Peto–Peto (early, robust)' },
                { value: 'fleming-harrington', label: 'Fleming–Harrington (tunable)' },
              ]}
              hint={WEIGHT_DESCRIPTION[config.weight]}
            />
            {config.weight === 'fleming-harrington' && (
              <>
                <NumberField label="Fleming–Harrington p" symbol="p" value={config.flemingP} onChange={(flemingP) => set({ flemingP })} min={0} max={10} />
                <NumberField label="Fleming–Harrington q" symbol="q" value={config.flemingQ} onChange={(flemingQ) => set({ flemingQ })} min={0} max={10} />
              </>
            )}
            <SelectField
              label="Schoenfeld time transform"
              value={config.phTransform}
              onChange={(phTransform) => set({ phTransform: phTransform as TimeTransform })}
              options={[
                { value: 'km', label: 'Kaplan–Meier transform (default)' },
                { value: 'identity', label: 'Identity (time itself)' },
                { value: 'log', label: 'Log time' },
                { value: 'rank', label: 'Rank of event time' },
              ]}
              hint="The proportional-hazards test regresses the scaled residuals on this function of time; the choice can change the verdict."
            />
            <Checkbox
              checked={config.showBand}
              onChange={(showBand) => set({ showBand })}
              label="Show pointwise confidence bands on the curves"
              description="Pointwise intervals, not a simultaneous band: they are valid one time at a time, not for the curve as a whole."
            />
          </Card>

          <AiAssistPanel
            capability="interpretStatistics"
            context={
              overall
                ? `This analysis has n = ${overall.n} with ${overall.events} events and ${formatPercent(
                    overall.censoringFraction,
                    1,
                  )} censored. Read the panels in order: the censoring summary first, then the curve, then the median or RMST, and treat the log-rank test and hazard ratio as meaningful only if the proportional-hazards check passes.`
                : 'Enter follow-up data as "time, status, group" to see the censoring summary, the Kaplan–Meier curve and the group comparison.'
            }
          />
        </div>

        <div className="oc-stack">
          {/* ------------------------------------------------ survival curve */}
          <Card title="Survival curve" hint="Kaplan–Meier product-limit estimate per group, with censoring ticks.">
            {analysis.groups.map((g) => (
              <IssueNotice key={g.group} issues={g.kmErrors} title={`No curve for "${g.group}"`} />
            ))}
            {curveSeries.length > 0 ? (
              <>
                <StepChart
                  title="Estimated survival over time"
                  description={`Kaplan–Meier survival estimate per group with ${formatPercent(config.level)} pointwise intervals. Short vertical ticks mark censored observations.`}
                  series={curveSeries}
                  xLabel="Time"
                  yLabel="Estimated survival S(t)"
                  yDomain={[0, 1]}
                  referenceLines={[{ value: 0.5, label: 'S = 0.5 (median level)', axis: 'y' }]}
                  note="A tick is an observation that left the study event-free; the curve does not step there, it only loses a subject from the risk set."
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Risk table over all observed times, pooled across groups"
                    maxHeight={320}
                    columns={[
                      { key: 'time', header: 'Time', numeric: true, render: (r) => formatValue(r.time, 4) },
                      { key: 'atRisk', header: 'At risk', numeric: true, render: (r) => r.atRisk.toLocaleString('en-US') },
                      { key: 'events', header: 'Events', numeric: true, render: (r) => r.events.toLocaleString('en-US') },
                      { key: 'censored', header: 'Censored', numeric: true, render: (r) => r.censored.toLocaleString('en-US') },
                    ]}
                    rows={analysis.riskTable}
                  />
                </div>
                <ResultFooter
                  exactness="empirical"
                  extra="The estimate at a time rests only on the subjects still at risk then, so the tail of the curve is the least reliable part of it."
                />
              </>
            ) : (
              !analysis.fatal && <Notice tone="info">No curve could be estimated from the observations read so far.</Notice>
            )}
          </Card>

          {/* ----------------------------------------------- median survival */}
          <Card title="Median survival" hint="The time by which half the subjects are estimated to have had the event.">
            {analysis.groups.map((g) => (
              <div key={g.group} style={{ marginBottom: 'var(--s3)' }}>
                <h3 style={{ marginBottom: 'var(--s2)' }}>{g.group}</h3>
                {g.km === null ? (
                  <IssueNotice issues={g.kmErrors} title="Not estimated" />
                ) : g.km.median.estimable ? (
                  <KeyValueList
                    items={[
                      { label: 'Median survival time', value: formatValue(g.km.median.time, 5) },
                      {
                        label: `${formatPercent(config.level)} confidence interval`,
                        value: intervalText(g.km.median.lower, g.km.median.upper, config.level),
                      },
                      { label: 'Based on', value: `${g.summary.events} events in ${g.summary.n} subjects` },
                    ]}
                  />
                ) : (
                  // The engine refuses a number here. Showing the largest
                  // observed time instead would be an estimate of something
                  // the data does not contain.
                  <Notice tone="warning" title="Median not estimable">
                    <p>{g.km.median.reason}</p>
                    <p>
                      The curve never falls to 0.5: its lowest estimated survival is {formatValue(g.km.median.lowestSurvival, 4)}. There is no time in this data
                      by which half the subjects had the event, so no median can be reported — not the largest observed time, not a blank. Use the restricted
                      mean survival time below instead.
                    </p>
                  </Notice>
                )}
                {g.km && g.km.quantiles.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption={`Survival quantiles for ${g.group}`}
                      columns={[
                        { key: 'p', header: 'Quantile', render: (r) => formatPercent(r.p) },
                        { key: 't', header: 'Time', numeric: true, render: (r) => (r.estimable && r.time !== null ? formatValue(r.time, 5) : 'not estimable') },
                        { key: 'why', header: 'Note', render: (r) => r.reason ?? '' },
                      ]}
                      rows={g.km.quantiles}
                    />
                  </div>
                )}
              </div>
            ))}
            <ResultFooter exactness="empirical" extra="The interval for a median is an interval for an estimate, not a range in which half the subjects fail." />
          </Card>

          {/* ------------------------------------------------------- RMST */}
          <Card title={`Restricted mean survival time up to τ = ${formatValue(config.rmstHorizon, 4)}`} hint="Average event-free time within the horizon.">
            {analysis.groups.map((g) => (
              <div key={g.group} style={{ marginBottom: 'var(--s3)' }}>
                <h3 style={{ marginBottom: 'var(--s2)' }}>{g.group}</h3>
                {g.rmst === null ? (
                  <IssueNotice issues={g.rmstErrors} title="Not estimated" />
                ) : (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'RMST', value: `${formatValue(g.rmst.rmst, 5)} time units` },
                        { label: 'Standard error', value: formatValue(g.rmst.stdError, 5) },
                        { label: `${formatPercent(config.level)} confidence interval`, value: `${formatValue(g.rmst.lower, 5)} to ${formatValue(g.rmst.upper, 5)}` },
                        { label: 'Horizon τ', value: formatValue(g.rmst.horizon, 4) },
                      ]}
                    />
                    {g.rmst.horizonBeyondData && (
                      <Notice tone="warning" title="Horizon beyond the observed follow-up">
                        τ = {formatValue(g.rmst.horizon, 4)} is later than the last observation in this group ({formatValue(g.summary.maxTime, 4)}). Beyond the
                        data the curve is simply held flat, which is an extrapolation, not an estimate. Choose a τ inside the follow-up of every group being
                        compared.
                      </Notice>
                    )}
                  </>
                )}
              </div>
            ))}
            <p className="oc-chart-note">
              RMST is a time, not a ratio, and it needs no proportional-hazards assumption. It is the robust summary when the median is not reached — but it is
              defined only relative to the τ you chose, and a different τ is a different quantity.
            </p>
            <ResultFooter exactness="empirical" />
          </Card>

          {/* -------------------------------------------- group comparison */}
          <Card title="Group comparison" hint="The weighted log-rank family. The weighting changes the conclusion, so it is reported with the result.">
            <IssueNotice issues={analysis.logRankErrors} title="No test was performed" />
            {parsed.groups.length < 2 && !analysis.fatal && (
              <Notice tone="info">Add a third field to each line with a group label to compare two or more groups.</Notice>
            )}
            {analysis.crossing?.warning && (
              <Notice tone="warning" title="The curves cross: hazards are not proportional">
                <p>{analysis.crossing.warning}</p>
                <p>
                  Crossing detected at {analysis.crossing.crossingTimes.map((t) => formatValue(t, 4)).join(', ')}. The largest gap between the curves is{' '}
                  {formatValue(analysis.crossing.maxDifference, 4)} at time {formatValue(analysis.crossing.maxDifferenceTime, 4)}.
                </p>
                <p>{PROPORTIONAL_HAZARDS_CAVEAT}</p>
              </Notice>
            )}
            <IssueNotice issues={analysis.crossingErrors} title="Crossing-curve detection did not run" />
            {analysis.logRank && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Weighting used', value: analysis.logRank.weight.kind },
                    { label: 'Test statistic', value: formatValue(analysis.logRank.statistic, 5) },
                    { label: 'Degrees of freedom', value: String(analysis.logRank.degreesOfFreedom) },
                    { label: 'p-value', value: pValueText(analysis.logRank.pValue) },
                    { label: 'Event times used', value: analysis.logRank.eventTimesUsed.toLocaleString('en-US') },
                  ]}
                />
                <p className="oc-chart-note">{analysis.logRank.weightDescription}</p>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Observed and expected events by group"
                    columns={[
                      { key: 'g', header: 'Group', render: (r) => String(r.group) },
                      { key: 'n', header: 'n', numeric: true, render: (r) => r.n.toLocaleString('en-US') },
                      { key: 'o', header: 'Observed', numeric: true, render: (r) => formatValue(r.observed, 4) },
                      { key: 'e', header: 'Expected', numeric: true, render: (r) => formatValue(r.expected, 4) },
                      { key: 'oe', header: 'O / E', numeric: true, render: (r) => (r.observedOverExpected === null ? 'not defined' : formatValue(r.observedOverExpected, 4)) },
                    ]}
                    rows={analysis.logRank.groups}
                  />
                </div>
                {analysis.crossing && !analysis.crossing.warning && (
                  <Notice tone="info" title="No crossing detected">
                    The curves keep their order throughout (largest gap {formatValue(analysis.crossing.maxDifference, 4)} at time{' '}
                    {formatValue(analysis.crossing.maxDifferenceTime, 4)}). That is reassuring but not a proof of proportional hazards; see the Schoenfeld test
                    below.
                  </Notice>
                )}
                <ResultFooter
                  exactness={analysis.logRank.explanation.exactness}
                  extra="The p-value is asymptotic: it is a chi-square approximation that needs a reasonable number of events in every group."
                />
                <ExplanationPanel explanation={analysis.logRank.explanation} />
              </>
            )}
          </Card>

          {/* ------------------------------------------------------- Cox */}
          <Card title="Cox proportional hazards" hint="Coefficients, hazard ratios, the three global tests and the proportional-hazards check.">
            <IssueNotice issues={analysis.coxErrors} title="The model was not fitted" />
            {analysis.coxWarnings.length > 0 && <Notice tone="warning" items={analysis.coxWarnings} />}
            {parsed.groups.length < 2 && !analysis.fatal && (
              <Notice tone="info">A Cox model needs at least one covariate; with a single group there is nothing to regress on.</Notice>
            )}
            {analysis.cox && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Cox coefficients and hazard ratios"
                    columns={[
                      { key: 'name', header: 'Covariate', render: (r) => r.name },
                      { key: 'b', header: 'β', numeric: true, render: (r) => formatValue(r.coefficient, 5) },
                      { key: 'se', header: 'SE(β)', numeric: true, render: (r) => formatValue(r.stdError, 5) },
                      { key: 'hr', header: 'Hazard ratio', numeric: true, render: (r) => formatValue(r.hazardRatio, 5) },
                      {
                        key: 'ci',
                        header: `${formatPercent(config.level)} interval`,
                        render: (r) => `${formatValue(r.hazardRatioLower, 4)} to ${formatValue(r.hazardRatioUpper, 4)}`,
                      },
                      { key: 'z', header: 'z', numeric: true, render: (r) => formatValue(r.z, 4) },
                      { key: 'p', header: 'p', numeric: true, render: (r) => pValueText(r.pValue) },
                    ]}
                    rows={analysis.cox.coefficients}
                  />
                </div>
                <KeyValueList
                  items={[
                    {
                      label: 'Wald test',
                      value: `χ² = ${formatValue(analysis.cox.tests.wald.statistic, 4)}, df ${analysis.cox.tests.wald.df}, p = ${pValueText(analysis.cox.tests.wald.pValue)}`,
                    },
                    {
                      label: 'Score (log-rank) test',
                      value: `χ² = ${formatValue(analysis.cox.tests.score.statistic, 4)}, df ${analysis.cox.tests.score.df}, p = ${pValueText(analysis.cox.tests.score.pValue)}`,
                    },
                    {
                      label: 'Likelihood-ratio test',
                      value: `χ² = ${formatValue(analysis.cox.tests.likelihoodRatio.statistic, 4)}, df ${analysis.cox.tests.likelihoodRatio.df}, p = ${pValueText(
                        analysis.cox.tests.likelihoodRatio.pValue,
                      )}`,
                    },
                    {
                      label: "Harrell's C",
                      value:
                        analysis.cox.concordance === null
                          ? `not defined${analysis.cox.concordanceNote ? ` — ${analysis.cox.concordanceNote}` : ''}`
                          : formatValue(analysis.cox.concordance, 4),
                    },
                    { label: 'Tie handling', value: `${analysis.cox.tieHandling} (${analysis.cox.tiedEventTimes} tied event times)` },
                    { label: 'Iterations to converge', value: String(analysis.cox.iterations) },
                  ]}
                />
                {analysis.cox.concordanceNote && analysis.cox.concordance !== null && <p className="oc-chart-note">{analysis.cox.concordanceNote}</p>}

                <h3 style={{ margin: 'var(--s4) 0 var(--s2)' }}>Proportional-hazards check (Schoenfeld)</h3>
                <p className="oc-chart-note">{PH_CHECK_REQUIRED}</p>
                <IssueNotice issues={analysis.schoenfeldErrors} title="The proportional-hazards test did not run" />
                {analysis.schoenfeld && (
                  <>
                    <Notice tone={phFails ? 'warning' : 'info'} title={phFails ? 'The proportional-hazards assumption fails' : 'No evidence against proportional hazards'}>
                      <p>{analysis.schoenfeld.verdict}</p>
                      {phFails && (
                        <p>
                          With the assumption rejected, the single hazard ratio above is an average over a period in which the effect changed, and it describes
                          no particular time. Report survival at pre-specified times or compare restricted mean survival times instead.
                        </p>
                      )}
                    </Notice>
                    <KeyValueList
                      items={[
                        {
                          label: 'Global test',
                          value: `χ² = ${formatValue(analysis.schoenfeld.global.statistic, 4)}, df ${analysis.schoenfeld.global.df}, p = ${pValueText(
                            analysis.schoenfeld.global.pValue,
                          )}`,
                        },
                        { label: 'Time transform', value: analysis.schoenfeld.transform },
                        { label: 'Significance level used', value: formatValue(analysis.schoenfeld.alpha, 4) },
                      ]}
                    />
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Schoenfeld test per covariate"
                        columns={[
                          { key: 'name', header: 'Covariate', render: (r) => r.name },
                          { key: 'rho', header: 'Correlation with time', numeric: true, render: (r) => formatValue(r.correlation, 4) },
                          { key: 'chi', header: 'χ²', numeric: true, render: (r) => formatValue(r.statistic, 4) },
                          { key: 'p', header: 'p', numeric: true, render: (r) => pValueText(r.pValue) },
                          { key: 'v', header: 'Verdict', render: (r) => (r.rejects ? 'assumption rejected' : 'no evidence against') },
                        ]}
                        rows={analysis.schoenfeld.perCovariate}
                      />
                    </div>
                    <ExplanationPanel explanation={analysis.schoenfeld.explanation} />
                  </>
                )}
                <ResultFooter
                  exactness={analysis.cox.explanation.exactness}
                  extra="Hazard-ratio intervals and all three tests are asymptotic, and they assume proportional hazards — the check above is part of the result, not an optional extra."
                />
                <ExplanationPanel explanation={analysis.cox.explanation} />
              </>
            )}
          </Card>

          {/* -------------------------------------------- competing risks */}
          <Card title="Competing risks" hint="Cumulative incidence of one cause when other causes can intervene.">
            <TextField
              label="Competing-risks data (time, cause)"
              value={config.competingData}
              onChange={(competingData) => set({ competingData })}
              multiline
              rows={6}
              monospace
              maxLength={200_000}
              hint="Cause 0 = censored. Cause 1, 2, … are distinct, mutually exclusive first events."
            />
            <NumberField
              label="Cause of interest"
              value={config.competingCause}
              onChange={(competingCause) => set({ competingCause })}
              min={1}
              max={50}
              integer
              hint="Every other non-zero cause is treated as a competing cause."
            />
            {competingParsed.skipped.length > 0 && (
              <Notice
                tone="warning"
                title={`${competingParsed.skipped.length} competing-risks line${competingParsed.skipped.length === 1 ? '' : 's'} left out`}
                items={competingParsed.skipped.map((s) => `Line ${s.line}: ${s.reason} (text: ${s.text.slice(0, 60)})`)}
              />
            )}
            <IssueNotice issues={competing.errors} title="Cumulative incidence was not estimated" />
            {competing.value && (
              <>
                <Notice tone="warning" title="1 − Kaplan–Meier overestimates this incidence">
                  <p>{ONE_MINUS_KM_WARNING}</p>
                  <p>
                    {competing.value.warning} In this data the largest overestimate is {formatValue(competing.value.maxOverestimate, 4)} in absolute
                    probability — the vertical gap between the two curves below.
                  </p>
                </Notice>
                <StepChart
                  title={`Cumulative incidence of cause ${competing.value.cause}, Aalen–Johansen against 1 − Kaplan–Meier`}
                  description={`Aalen–Johansen cumulative incidence with ${formatPercent(config.level)} pointwise intervals, drawn against the 1 − Kaplan–Meier curve that ignores the competing causes.`}
                  series={cifSeries}
                  xLabel="Time"
                  yLabel="Cumulative incidence"
                  yDomain={[0, 1]}
                  note="The dashed curve is what you get by treating competing events as censoring. It answers a question about a world in which the competing causes do not exist."
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Events by cause"
                    columns={[
                      { key: 'c', header: 'Cause', render: (r) => (r.cause === competing.value?.cause ? `${r.cause} (of interest)` : String(r.cause)) },
                      { key: 'n', header: 'Events', numeric: true, render: (r) => r.events.toLocaleString('en-US') },
                    ]}
                    rows={competing.value.eventsByCause}
                  />
                </div>
                <ResultFooter exactness={competing.value.explanation.exactness} />
                <ExplanationPanel explanation={competing.value.explanation} />
              </>
            )}
          </Card>

          {/* --------------------------------------------- study design */}
          <Card title="Study design: required events" hint="Power comes from events, not subjects.">
            <NumberField
              label="Target hazard ratio"
              value={config.designHazardRatio}
              onChange={(designHazardRatio) => set({ designHazardRatio })}
              min={0.01}
              max={100}
              hint="The effect the study should be able to detect. A ratio of exactly 1 is not a detectable effect and the engine refuses it."
            />
            <SliderField label="Power" value={config.designPower} onChange={(designPower) => set({ designPower })} min={0.5} max={0.99} step={0.01} />
            <SliderField label="Two-sided significance level α" symbol="α" value={config.designAlpha} onChange={(designAlpha) => set({ designAlpha })} min={0.001} max={0.2} step={0.001} />
            <NumberField
              label="Allocation ratio (experimental : control)"
              value={config.designAllocationRatio}
              onChange={(designAllocationRatio) => set({ designAllocationRatio })}
              min={0.05}
              max={20}
              hint="1 is equal allocation."
            />
            <IssueNotice issues={design.errors} title="The event count was not computed" />
            {design.schoenfeld && design.freedman && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Required events — Schoenfeld', value: design.schoenfeld.requiredEvents.toLocaleString('en-US') },
                    { label: 'Required events — Freedman', value: design.freedman.requiredEvents.toLocaleString('en-US') },
                    { label: 'Hazard ratio', value: formatValue(design.schoenfeld.hazardRatio, 4) },
                    { label: 'Power', value: formatPercent(design.schoenfeld.power, 1) },
                    { label: 'α (two-sided)', value: formatValue(design.schoenfeld.alpha, 4) },
                    { label: 'Allocation ratio', value: formatValue(design.schoenfeld.allocationRatio, 4) },
                  ]}
                />
                <Notice tone="info" title="It is the event count that drives power">
                  <p>{EVENTS_DRIVE_POWER}</p>
                  <p>
                    The two formulae differ by {Math.abs(design.schoenfeld.requiredEvents - design.freedman.requiredEvents).toLocaleString('en-US')} events here.
                    Both are shown because the choice between them is a judgement, not a fact, and quoting only one hides that.
                  </p>
                </Notice>
                <ResultFooter
                  exactness={design.schoenfeld.explanation.exactness}
                  extra="This is an event count, not a subject count: translating it into enrolment needs assumptions about the event rate, accrual and follow-up."
                />
                <ExplanationPanel explanation={design.schoenfeld.explanation} />
                <ExplanationPanel explanation={design.freedman.explanation} />
              </>
            )}
          </Card>

          {/* ------------------------------------------------ explanation */}
          <Card title="Method, assumptions and limitations">
            <Notice tone="warning" title="Independent censoring: the assumption behind every number here">
              <p>{INDEPENDENT_CENSORING}</p>
            </Notice>
            <KeyValueList
              items={[
                { label: 'Kaplan–Meier curve, median, RMST', value: `${EXACTNESS_LABEL.empirical} — an estimate from a finite sample` },
                { label: 'Log-rank family p-values', value: `${EXACTNESS_LABEL.numerical} — asymptotic chi-square approximation` },
                { label: 'Cox coefficients, hazard ratios, Schoenfeld test', value: `${EXACTNESS_LABEL.numerical} — iterative fit with asymptotic inference` },
                { label: 'Aalen–Johansen cumulative incidence', value: `${EXACTNESS_LABEL.empirical} — an estimate from a finite sample` },
                { label: 'Required events', value: `${EXACTNESS_LABEL.numerical} — a closed-form normal approximation` },
              ]}
            />
            <p className="oc-chart-note">
              What this screen will not do: estimate a median the curve never reaches, read a hazard ratio as meaningful when the proportional-hazards check
              fails, or present 1 − Kaplan–Meier as the incidence of one cause among competing causes. Each of those is reported as a refusal with its reason
              above.
            </p>
            {/* The Kaplan–Meier explanation carries the median, the quantiles
                and the RMST, all of which are read off the same curve. */}
            {analysis.groups.map((g) => (g.km ? <ExplanationPanel key={g.group} explanation={g.km.explanation} /> : null))}
          </Card>
        </div>
      </div>
    </>
  );
}
