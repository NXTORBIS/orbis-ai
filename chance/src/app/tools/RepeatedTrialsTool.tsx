/**
 * Repeated trials: at least one, exactly k, runs, waiting times, and the
 * number of attempts needed to reach a target probability.
 */
import { useMemo } from 'react';
import { analyseRepeated, type RepeatedQuestion } from '../../engine/probability/repeated';
import { Card, Checkbox, Notice, NumberField, ProbabilityField, SelectField } from '../../ui/primitives';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';
import { downloadText, toCsv } from '../../persistence/store';

export interface RepeatedTrialsConfig {
  question: RepeatedQuestion;
  trials: number;
  p: number;
  k: number;
  runLength: number;
  targetProbability: number;
  withoutReplacement: boolean;
  populationSize: number;
  successesInPopulation: number;
}

export const REPEATED_TRIALS_DEFAULT: RepeatedTrialsConfig = {
  question: 'at-least-one',
  trials: 10,
  p: 1 / 6,
  k: 2,
  runLength: 3,
  targetProbability: 0.95,
  withoutReplacement: false,
  populationSize: 52,
  successesInPopulation: 4,
};

const QUESTIONS: { value: RepeatedQuestion; label: string }[] = [
  { value: 'at-least-one', label: 'At least one success' },
  { value: 'exactly-k', label: 'Exactly k successes' },
  { value: 'at-least-k', label: 'At least k successes' },
  { value: 'at-most-k', label: 'At most k successes' },
  { value: 'none', label: 'No successes at all' },
  { value: 'expected', label: 'Expected number of successes' },
  { value: 'first-success-on-trial', label: 'First success occurs on trial k' },
  { value: 'trials-until-success', label: 'Expected wait until the first success' },
  { value: 'failures-before-rth-success', label: 'Failures before the k-th success' },
  { value: 'run-of-length', label: 'A run of consecutive successes' },
  { value: 'trials-for-probability', label: 'Trials needed to reach a target probability' },
];

const NEEDS_TRIALS: RepeatedQuestion[] = ['at-least-one', 'exactly-k', 'at-least-k', 'at-most-k', 'none', 'expected', 'run-of-length'];
const NEEDS_K: RepeatedQuestion[] = ['exactly-k', 'at-least-k', 'at-most-k', 'first-success-on-trial', 'failures-before-rth-success'];
const SUPPORTS_DEPENDENT: RepeatedQuestion[] = ['at-least-one', 'exactly-k', 'at-least-k', 'at-most-k', 'none', 'expected'];

export function RepeatedTrialsTool({ config }: { config: RepeatedTrialsConfig }) {
  const app = useApp();
  const set = (patch: Partial<RepeatedTrialsConfig>) => app.updateConfig({ ...config, ...patch });

  const dependentActive = config.withoutReplacement && SUPPORTS_DEPENDENT.includes(config.question);

  const result = useMemo(() => {
    try {
      return {
        ok: true as const,
        value: analyseRepeated({
          question: config.question,
          trials: config.trials,
          p: dependentActive ? config.successesInPopulation / config.populationSize : config.p,
          k: NEEDS_K.includes(config.question) ? config.k : undefined,
          runLength: config.runLength,
          targetProbability: config.targetProbability,
          withoutReplacement: dependentActive ? { populationSize: config.populationSize, successesInPopulation: config.successesInPopulation } : undefined,
        }),
      };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config, dependentActive]);

  // A curve of "at least one" against the number of trials, which makes the
  // relationship between attempts and probability concrete.
  const attemptsCurve = useMemo(() => {
    if (!['at-least-one', 'none', 'trials-for-probability'].includes(config.question)) return null;
    const p = dependentActive ? config.successesInPopulation / config.populationSize : config.p;
    if (!(p > 0 && p < 1)) return null;
    const maxN = Math.max(20, Math.min(400, config.question === 'trials-for-probability' ? Math.ceil((result.ok && result.value.requiredTrials ? result.value.requiredTrials : 20) * 1.8) : config.trials * 2));
    const points = [];
    for (let n = 1; n <= maxN; n++) points.push({ x: n, y: -Math.expm1(n * Math.log1p(-p)) });
    return points;
  }, [config, dependentActive, result]);

  return (
    <>
      <ToolHeader toolId="repeated-trials" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="The question">
            <SelectField label="What do you want to know?" value={config.question} onChange={(question) => set({ question })} options={QUESTIONS} />
            {!dependentActive && (
              <ProbabilityField
                label="Probability of success on one trial"
                symbol="p"
                value={config.p}
                onChange={(p) => set({ p })}
                hint="The same on every trial. If it changes between trials, these formulas do not apply."
              />
            )}
            {NEEDS_TRIALS.includes(config.question) && (
              <NumberField label="Number of trials" symbol="n" value={config.trials} onChange={(trials) => set({ trials })} min={1} max={config.question === 'run-of-length' ? 200000 : 5000000} integer />
            )}
            {NEEDS_K.includes(config.question) && (
              <NumberField
                label={config.question === 'first-success-on-trial' ? 'Trial number' : config.question === 'failures-before-rth-success' ? 'Target number of successes' : 'Number of successes'}
                symbol="k"
                value={config.k}
                onChange={(k) => set({ k })}
                min={config.question === 'first-success-on-trial' || config.question === 'failures-before-rth-success' ? 1 : 0}
                max={1e6}
                integer
              />
            )}
            {config.question === 'run-of-length' && (
              <NumberField label="Length of the run" value={config.runLength} onChange={(runLength) => set({ runLength })} min={1} max={10000} integer hint="How many successes in a row." />
            )}
            {config.question === 'trials-for-probability' && (
              <ProbabilityField label="Target probability of at least one success" value={config.targetProbability} onChange={(targetProbability) => set({ targetProbability })} hint="Must be below 1: no finite number of trials reaches certainty." />
            )}
          </Card>

          {SUPPORTS_DEPENDENT.includes(config.question) && (
            <Card title="Are the trials independent?">
              <Checkbox
                checked={config.withoutReplacement}
                onChange={(withoutReplacement) => set({ withoutReplacement })}
                label="Drawing without replacement from a finite collection"
                description="Each draw changes what remains, so the trials are dependent. The hypergeometric distribution is used instead of the binomial."
              />
              {config.withoutReplacement && (
                <>
                  <NumberField label="Size of the collection" symbol="N" value={config.populationSize} onChange={(populationSize) => set({ populationSize })} min={1} max={1e6} integer />
                  <NumberField label="Successes in the collection" symbol="K" value={config.successesInPopulation} onChange={(successesInPopulation) => set({ successesInPopulation })} min={0} max={config.populationSize} integer />
                  <p className="oc-field__hint">
                    The success probability on the first draw is {formatValue(config.successesInPopulation / config.populationSize, 5)}, but it changes after
                    each draw.
                  </p>
                </>
              )}
            </Card>
          )}

          <AiAssistPanel capability="identifyMissingInputs" context="Each question above states exactly which values it needs, and invalid combinations are reported in full." />
        </div>

        <div className="oc-stack">
          {!result.ok && <Notice tone="error" title="This question cannot be answered as entered">{result.error}</Notice>}

          {result.ok && (
            <>
              <Card title="Answer">
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">{answerLabel(config)}</span>
                  <span className="oc-result-hero__value">
                    {result.value.probability !== undefined
                      ? formatPercent(result.value.probability, 5)
                      : result.value.expectedValue !== undefined
                        ? formatValue(result.value.expectedValue, 6)
                        : result.value.requiredTrials !== undefined
                          ? `${result.value.requiredTrials.toLocaleString('en-US')} trials`
                          : '—'}
                  </span>
                  {result.value.probability !== undefined && (
                    <span className="oc-result-hero__detail">
                      {formatValue(result.value.probability, 8)}
                      {result.value.probability > 0 ? ` · about 1 in ${Number((1 / result.value.probability).toPrecision(3)).toLocaleString('en-US')}` : ''}
                    </span>
                  )}
                </div>
                {result.value.warnings.length > 0 && <Notice tone="info" items={result.value.warnings} />}
              </Card>

              {attemptsCurve && (
                <Card>
                  <LineChart
                    title="Probability of at least one success as trials increase"
                    description="Curve showing how the probability of at least one success grows with the number of trials, approaching but never reaching 1."
                    series={[{ label: 'At least one success', points: attemptsCurve, area: true }]}
                    xLabel="Number of trials"
                    yLabel="Probability of at least one success"
                    yDomain={[0, 1]}
                    valueFormatter={(v) => formatPercent(v)}
                    referenceLines={[{ value: 0.5, label: '50%', axis: 'y' }, { value: 0.95, label: '95%', axis: 'y' }]}
                    markers={
                      config.question === 'trials-for-probability' && result.value.requiredTrials
                        ? [{ x: result.value.requiredTrials, y: -Math.expm1(result.value.requiredTrials * Math.log1p(-(dependentActive ? config.successesInPopulation / config.populationSize : config.p))), label: `${result.value.requiredTrials} trials` }]
                        : NEEDS_TRIALS.includes(config.question)
                          ? [{ x: config.trials, y: -Math.expm1(config.trials * Math.log1p(-(dependentActive ? config.successesInPopulation / config.populationSize : config.p))), label: `${config.trials} trials` }]
                          : undefined
                    }
                    note="The curve flattens as trials increase: each additional attempt adds less than the one before, and the probability never reaches 100%."
                    onExport={() => downloadText('at-least-one-curve.csv', toCsv(['trials', 'probability_at_least_one'], attemptsCurve.map((p) => [p.x, p.y])))}
                  />
                </Card>
              )}

              {result.value.distribution && result.value.distribution.length > 1 && result.value.distribution.length <= 200 && (
                <Card>
                  <BarChart
                    title="Distribution of the number of successes"
                    description={`Probability of each possible number of successes${dependentActive ? ' under the hypergeometric model' : ' under the binomial model'}.`}
                    data={result.value.distribution.map((d) => ({ x: d.value, y: d.probability }))}
                    xLabel="Number of successes"
                    yLabel="Probability"
                    seriesLabel="Probability"
                    asPercent
                    highlight={
                      config.question === 'exactly-k'
                        ? { from: config.k, to: config.k }
                        : config.question === 'at-least-k'
                          ? { from: config.k, to: Infinity }
                          : config.question === 'at-most-k'
                            ? { from: -Infinity, to: config.k }
                            : config.question === 'at-least-one'
                              ? { from: 1, to: Infinity }
                              : config.question === 'none'
                                ? { from: 0, to: 0 }
                                : null
                    }
                    note={`Exact probabilities from the ${dependentActive ? 'hypergeometric' : 'binomial'} distribution — not a simulation. Shaded bars are the outcomes your question counts.`}
                    onExport={() => downloadText('distribution.csv', toCsv(['successes', 'probability', 'cumulative'], result.value.distribution!.map((d) => [d.value, d.probability, d.cumulative])))}
                  />
                </Card>
              )}

              <ExplanationPanel explanation={result.value.explanation} defaultOpen />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function answerLabel(config: RepeatedTrialsConfig): string {
  switch (config.question) {
    case 'at-least-one':
      return `Probability of at least one success in ${config.trials} trials`;
    case 'exactly-k':
      return `Probability of exactly ${config.k} successes in ${config.trials} trials`;
    case 'at-least-k':
      return `Probability of at least ${config.k} successes in ${config.trials} trials`;
    case 'at-most-k':
      return `Probability of at most ${config.k} successes in ${config.trials} trials`;
    case 'none':
      return `Probability of no successes in ${config.trials} trials`;
    case 'expected':
      return `Expected number of successes in ${config.trials} trials`;
    case 'first-success-on-trial':
      return `Probability the first success occurs on trial ${config.k}`;
    case 'trials-until-success':
      return 'Expected number of trials until the first success';
    case 'failures-before-rth-success':
      return `Expected failures before the ${config.k}th success`;
    case 'run-of-length':
      return `Probability of a run of ${config.runLength} consecutive successes in ${config.trials} trials`;
    case 'trials-for-probability':
      return `Trials needed for a ${formatPercent(config.targetProbability)} chance of at least one success`;
  }
}
