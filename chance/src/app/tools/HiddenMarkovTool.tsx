/**
 * Hidden Markov models and deep chain analysis.
 *
 * Every number on this screen comes from `src/engine/hmm`: the filter and the
 * smoothed posteriors from `forward`/`backward`/`posteriors`, the decoded path
 * from `viterbi`, the contrast between the two decodings from
 * `compareDecodings`, the forecast from `predict`, the chain diagnostics from
 * `chain.ts` and the fit from `baumWelch`. Nothing is computed here and
 * nothing is substituted when a computation fails: an `EngineError` is shown
 * with its own message and the section stays empty.
 *
 * The two expensive computations — Baum-Welch fitting and chain-order
 * selection — are behind an explicit opt-in, the way `TimeSeriesTool` gates
 * its backtest, so opening the screen never blocks the tab.
 */
import { useEffect, useMemo } from 'react';
import {
  compareDecodings,
  convergenceRate,
  emissionOps,
  forward,
  freeParameterCount,
  fundamentalMatrix,
  hittingProbabilities,
  markovPropertyTest,
  meanFirstPassageTimes,
  periodicity,
  posteriors,
  predict,
  qrEigenvalues,
  reversibility,
  selectChainOrder,
  sequenceLogLikelihood,
  slemByPowerMethod,
  tvDistanceToStationary,
  validateHmm,
  validateObservations,
  viterbi,
  type HmmModel,
} from '../../engine/hmm/index';
import { attempt, type Exactness, type Explanation, type ExplanationStep } from '../../engine/core/result';
import { Badge, Button, Card, Checkbox, DataTable, KeyValueList, Notice, NumberField, RawNumberInput, TextField } from '../../ui/primitives';
import { BarChart, HeatmapChart, LineChart } from '../../ui/charts/charts';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { AssumptionsPanel, ExplanationPanel } from '../shared/ExplanationPanel';
import { useEngineJob } from '../shared/useEngineJob';
import { EngineJobPanel } from '../shared/EngineJobPanel';
import { useApp } from '../store';
import { MatrixEditor } from './shared/MatrixEditor';
import { downloadText, toCsv } from '../../persistence/store';

export interface HiddenMarkovConfig {
  /** Names of the hidden states; also fixes the size of π and A. */
  stateNames: string[];
  /** Initial distribution π over hidden states. */
  initial: number[];
  /** Transition matrix A[i][j] = P(next = j | now = i). */
  transition: number[][];
  /** Observation alphabet for the discrete emission model. */
  symbols: string[];
  /** Emission matrix B[state][symbol]. */
  emissionMatrix: number[][];
  /** The observed sequence, as symbol names or 0-based indices, space or comma separated. */
  observationText: string;
  /** Forecast horizon, in steps beyond the last observation. */
  horizon: number;
  /** Total-variation threshold defining the mixing time. */
  mixingThreshold: number;
  /** Hidden states forming the target set for the hitting-probability analysis. */
  hittingTargets: number[];
  /** Significance level for the likelihood-ratio test of the Markov property. */
  orderAlpha: number;
  /** Largest order scored by `selectChainOrder`. */
  maxOrder: number;
  /** Hidden state count for the Baum-Welch fit; EM cannot learn this. */
  fitStates: number;
  fitRestarts: number;
  fitMaxIterations: number;
  fitSeed: string;
  /** Opt-in: Baum-Welch runs only when asked. It is the slow computation here. */
  runFit: boolean;
  /** Opt-in: order selection refits every order and is slow for long sequences. */
  runOrderSelection: boolean;
}

export const HIDDEN_MARKOV_DEFAULT: HiddenMarkovConfig = {
  stateNames: ['Calm', 'Stressed', 'Crisis'],
  initial: [0.7, 0.25, 0.05],
  transition: [
    [0.9, 0.09, 0.01],
    [0.2, 0.7, 0.1],
    [0.05, 0.35, 0.6],
  ],
  symbols: ['Up', 'Flat', 'Down'],
  emissionMatrix: [
    [0.5, 0.4, 0.1],
    [0.25, 0.4, 0.35],
    [0.1, 0.25, 0.65],
  ],
  observationText:
    'Up Flat Up Up Flat Down Flat Up Up Flat Up Flat Down Down Flat Down Down Down Flat Down Down Flat Flat Up Flat Up Up Flat Up Up Flat Flat Down Flat Down Down Down Down Flat Up Flat Up Up Flat Flat Up Flat Up',
  horizon: 8,
  mixingThreshold: 0.25,
  hittingTargets: [2],
  orderAlpha: 0.05,
  maxOrder: 2,
  fitStates: 3,
  fitRestarts: 4,
  fitMaxIterations: 200,
  fitSeed: 'hmm-fit-1',
  runFit: false,
  runOrderSelection: false,
};

/**
 * Parses the observation text into symbol indices. A token that is neither a
 * symbol name nor a valid index is reported by name; nothing is dropped and no
 * index is guessed, because a silently discarded observation would change
 * every result below.
 */
function parseObservations(text: string, symbols: string[]): { ok: true; indices: number[] } | { ok: false; message: string } {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (!tokens.length) return { ok: false, message: 'The observation sequence is empty, so there is nothing to infer from. Enter the observed symbols, separated by spaces or commas.' };
  const lower = symbols.map((s) => s.toLowerCase());
  const indices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const byName = lower.indexOf(tokens[i].toLowerCase());
    if (byName >= 0) {
      indices.push(byName);
      continue;
    }
    const asIndex = Number(tokens[i]);
    if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < symbols.length) {
      indices.push(asIndex);
      continue;
    }
    return {
      ok: false,
      message: `Observation ${i + 1} is "${tokens[i]}", which is neither one of the symbols (${symbols.join(', ')}) nor an index between 0 and ${symbols.length - 1}.`,
    };
  }
  return { ok: true, indices };
}

/** An Explanation assembled from the engine's own method, exactness and caveats. */
function explanationOf(
  method: string,
  exactness: Exactness,
  steps: ExplanationStep[],
  assumptions: string[],
  limitations: string[],
  formula?: string,
): Explanation {
  return { method, formula, steps, assumptions, limitations, exactness };
}

const EMPTY_OBSERVATIONS: number[] = [];

const HMM_ASSUMPTIONS = [
  'The hidden state moves as a first-order Markov chain: where it goes next depends only on where it is now.',
  'Observations are conditionally independent given the hidden state: all the dependence between observations runs through the state path.',
  'The transition and emission probabilities are constant over the sequence, and the observation alphabet is complete.',
];

/**
 * Ranges for the knobs that drive a loop count, a forecast length or a
 * context count. A `NumberField` reports whatever was typed and shows its own
 * out-of-range message beside the field, but it does not clamp, so a typed
 * "1e9" would otherwise reach the engine: a forecast of a billion steps froze
 * the tab permanently, and an order of a billion printed "Infinity contexts"
 * and then tried to count them. Each such knob is read through `withinRange`,
 * the fields declare the same limits, and a value outside them is reported.
 */
const KNOB_LIMITS = {
  horizon: { min: 1, max: 200, label: 'Forecast horizon (steps)' },
  maxOrder: { min: 1, max: 4, label: 'Largest order to score' },
  fitStates: { min: 1, max: 8, label: 'Hidden states to fit' },
  fitRestarts: { min: 1, max: 20, label: 'Random restarts' },
  fitMaxIterations: { min: 10, max: 2000, label: 'Maximum iterations per restart' },
} as const;

type KnobName = keyof typeof KNOB_LIMITS;

function withinRange(name: KnobName, value: number): number {
  const { min, max } = KNOB_LIMITS[name];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function HiddenMarkovTool({ config }: { config: HiddenMarkovConfig }) {
  const app = useApp();
  const set = (patch: Partial<HiddenMarkovConfig>) => app.updateConfig({ ...config, ...patch });

  // Loop- and length-driving knobs, read through their declared range. The
  // fields show the out-of-range message; this keeps the engine from being
  // handed the typed value, and `outOfRange` says what was used instead.
  const horizon = withinRange('horizon', config.horizon);
  const maxOrder = withinRange('maxOrder', config.maxOrder);
  const fitStates = withinRange('fitStates', config.fitStates);
  const fitRestarts = withinRange('fitRestarts', config.fitRestarts);
  const fitMaxIterations = withinRange('fitMaxIterations', config.fitMaxIterations);
  const outOfRange = (Object.keys(KNOB_LIMITS) as KnobName[]).flatMap((name) => {
    const typed = config[name];
    const used = withinRange(name, typed);
    if (used === typed) return [];
    const { min, max, label } = KNOB_LIMITS[name];
    return [
      `“${label}” is ${Number.isFinite(typed) ? typed.toLocaleString('en-US') : String(typed)}, outside its range ${min}–${max}. Everything below used ${used.toLocaleString('en-US')}.`,
    ];
  });

  const model = useMemo<HmmModel>(
    () => ({
      stateNames: config.stateNames,
      initial: config.initial,
      transition: config.transition,
      emission: { kind: 'discrete', symbols: config.symbols, matrix: config.emissionMatrix },
    }),
    [config.stateNames, config.initial, config.transition, config.symbols, config.emissionMatrix],
  );

  const modelCheck = useMemo(() => attempt(() => {
    validateHmm(model);
    return emissionOps(model.emission).describe();
  }), [model]);

  const parsed = useMemo(() => parseObservations(config.observationText, config.symbols), [config.observationText, config.symbols]);
  // Memoised so a failed parse does not hand every downstream hook a fresh
  // empty array on each render.
  const observations = useMemo(() => (parsed.ok ? parsed.indices : EMPTY_OBSERVATIONS), [parsed]);

  const observationCheck = useMemo(
    () => (modelCheck.ok && parsed.ok ? attempt(() => { validateObservations(model, observations); return true; }) : null),
    [modelCheck.ok, parsed.ok, model, observations],
  );

  const ready = modelCheck.ok && parsed.ok && observationCheck !== null && observationCheck.ok;

  /* ---------------------------------------------------------- sequence algorithms */

  const filter = useMemo(() => (ready ? attempt(() => forward(model, observations)) : null), [ready, model, observations]);
  const smoothed = useMemo(() => (ready ? attempt(() => posteriors(model, observations)) : null), [ready, model, observations]);
  const decoded = useMemo(() => (ready ? attempt(() => viterbi(model, observations)) : null), [ready, model, observations]);
  const comparison = useMemo(() => (ready ? attempt(() => compareDecodings(model, observations)) : null), [ready, model, observations]);
  const forecast = useMemo(() => (ready ? attempt(() => predict(model, observations, horizon)) : null), [ready, model, observations, horizon]);

  /* -------------------------------------------------------------- chain analysis */

  const period = useMemo(() => (modelCheck.ok ? attempt(() => periodicity(config.transition)) : null), [modelCheck.ok, config.transition]);
  const passage = useMemo(() => (modelCheck.ok ? attempt(() => meanFirstPassageTimes(config.transition)) : null), [modelCheck.ok, config.transition]);
  const hitting = useMemo(
    () => (modelCheck.ok ? attempt(() => hittingProbabilities(config.transition, config.hittingTargets)) : null),
    [modelCheck.ok, config.transition, config.hittingTargets],
  );
  const absorption = useMemo(() => (modelCheck.ok ? attempt(() => fundamentalMatrix(config.transition)) : null), [modelCheck.ok, config.transition]);
  const mixing = useMemo(
    () => (modelCheck.ok ? attempt(() => convergenceRate(config.transition, { threshold: config.mixingThreshold })) : null),
    [modelCheck.ok, config.transition, config.mixingThreshold],
  );
  const eigen = useMemo(() => (modelCheck.ok ? attempt(() => qrEigenvalues(config.transition)) : null), [modelCheck.ok, config.transition]);
  const balance = useMemo(() => (modelCheck.ok ? attempt(() => reversibility(config.transition)) : null), [modelCheck.ok, config.transition]);
  // The second-largest eigenvalue modulus and the total-variation curve from
  // the two entry points that take the stationary distribution explicitly, so
  // the independent cross-check inside `convergenceRate` can be seen beside
  // the quantities it compares.
  const stationary = mixing && mixing.ok ? mixing.value.stationary : null;
  const slemDirect = useMemo(
    // Capped at 2000 iterations: the default of 100,000 costs over a tenth of
    // a second for a gain far below the printed precision, and `ratioSpread`
    // reports whether the cap was enough rather than leaving it assumed.
    () => (stationary ? attempt(() => slemByPowerMethod(config.transition, stationary, 2000)) : null),
    [stationary, config.transition],
  );
  const tvCurve = useMemo(
    () => (stationary ? attempt(() => tvDistanceToStationary(config.transition, stationary, 60)) : null),
    [stationary, config.transition],
  );

  /* ------------------------------------- order diagnostics on the decoded path */

  const decodedPath = decoded && decoded.ok ? decoded.value.path : null;
  const orderTest = useMemo(
    () => (decodedPath ? attempt(() => markovPropertyTest(decodedPath, config.stateNames.length, config.orderAlpha)) : null),
    [decodedPath, config.stateNames.length, config.orderAlpha],
  );
  const orderSelection = useMemo(
    () => (decodedPath && config.runOrderSelection ? attempt(() => selectChainOrder(decodedPath, config.stateNames.length, maxOrder)) : null),
    [decodedPath, config.stateNames.length, maxOrder, config.runOrderSelection],
  );

  /* --------------------------------------------------------------- Baum-Welch */

  /**
   * Baum-Welch runs in the engine-job worker. Every EM iteration is a full
   * forward-backward pass over the whole sequence, repeated for every restart,
   * so this is seconds of computation; off the main thread the screen stays
   * usable, the progress bar counts real iterations, and Cancel stops the fit
   * at the next iteration boundary.
   */
  const fitJob = useEngineJob('hmm.baum-welch');
  const fitStart = fitJob.start;
  const fitReset = fitJob.reset;
  useEffect(() => {
    if (!config.runFit) {
      fitReset();
      return;
    }
    if (!parsed.ok) return;
    fitStart({
      sequences: [observations],
      states: fitStates,
      template: { kind: 'discrete', symbols: config.symbols, matrix: config.emissionMatrix },
      options: { restarts: fitRestarts, maxIterations: fitMaxIterations, seed: config.fitSeed },
    });
  }, [
    parsed.ok,
    config.runFit,
    observations,
    fitStates,
    config.symbols,
    config.emissionMatrix,
    fitRestarts,
    fitMaxIterations,
    config.fitSeed,
    fitStart,
    fitReset,
  ]);
  const fit = fitJob.state.result;
  const suppliedLogLikelihood = useMemo(
    () => (ready ? attempt(() => sequenceLogLikelihood(model, [observations])) : null),
    [ready, model, observations],
  );
  const suppliedParameters = useMemo(() => (modelCheck.ok ? attempt(() => freeParameterCount(model)) : null), [modelCheck.ok, model]);

  /* ------------------------------------------------------------- explanations */

  const decodingExplanation = useMemo<Explanation | null>(() => {
    if (!filter || !filter.ok || !decoded || !decoded.ok || !smoothed || !smoothed.ok) return null;
    const v = decoded.value;
    return explanationOf(
      `${filter.value.method} ${v.method}`,
      v.exactness,
      [
        { label: 'Sequence likelihood', expression: 'log P(o₁..o_T)', value: formatValue(filter.value.logLikelihood, 8) },
        { label: 'Joint probability of the decoded path', expression: 'log P(path, observations)', value: formatValue(v.logProbability, 8) },
        { label: 'Posterior probability of the decoded path', expression: 'log P(path | observations)', value: formatValue(v.logPosterior, 8) },
        { label: 'Mean posterior entropy per step', expression: 'mean over t of H(q_t | observations), in bits', value: `${formatValue(smoothed.value.entropy.reduce((a, b) => a + b, 0) / smoothed.value.entropy.length, 4)} of ${formatValue(smoothed.value.maxEntropy, 4)} bits` },
      ],
      HMM_ASSUMPTIONS,
      smoothed.value.notes,
      'δ_t(j) = max_i δ_{t−1}(i)·A_ij·B_j(o_t), maximised in log space',
    );
  }, [filter, decoded, smoothed]);

  const mixingExplanation = useMemo<Explanation | null>(() => {
    if (!mixing || !mixing.ok) return null;
    const m = mixing.value;
    return explanationOf(
      `${m.eigenMethod} Cross-checked against: ${m.crossCheckMethod}`,
      m.exactness,
      [
        { label: 'Second-largest eigenvalue modulus', expression: 'SLEM', value: formatValue(m.slem, 8) },
        { label: 'Independent second estimate', expression: 'power method on P − 1π', value: `${formatValue(m.slemCrossCheck, 8)} (agreement ${formatValue(m.slemAgreement, 4)})` },
        { label: 'Relaxation time', expression: '1 / (1 − SLEM)', value: `${formatValue(m.relaxationTime, 6)} steps` },
        { label: 'Mixing time', expression: `smallest n with max_i TV(Pⁿ_i, π) ≤ ${formatValue(m.mixingThreshold, 3)}`, value: `${m.mixingTime} steps` },
      ],
      ['The transition matrix is exactly as entered; its uncertainty, if it was estimated from data, is not propagated here.'],
      m.notes,
    );
  }, [mixing]);

  const exactnessBadge = (exactness: Exactness) => <Badge variant={exactness}>{exactness === 'exact' ? 'Exact' : exactness === 'numerical' ? 'Numerical approximation' : exactness === 'empirical' ? 'Empirical estimate' : 'User assumption'}</Badge>;

  const n = config.stateNames.length;
  const T = observations.length;

  return (
    <>
      <ToolHeader toolId="hidden-markov" />
      <div className="oc-workspace">
        <div className="oc-stack">
          {outOfRange.length > 0 && <Notice tone="warning" title="A setting is outside the range its field allows" items={outOfRange} />}
          <Card title="Hidden states and transitions" hint="The state is never observed directly; only the symbols it emits are.">
            <MatrixEditor
              states={config.stateNames}
              matrix={config.transition}
              onChange={(stateNames, transition) => {
                const size = stateNames.length;
                const initial = Array.from({ length: size }, (_, i) => config.initial[i] ?? 0);
                const emissionMatrix = Array.from({ length: size }, (_, i) =>
                  config.emissionMatrix[i] ? [...config.emissionMatrix[i]] : config.symbols.map(() => 1 / Math.max(1, config.symbols.length)),
                );
                set({
                  stateNames,
                  transition,
                  initial,
                  emissionMatrix,
                  hittingTargets: config.hittingTargets.filter((t) => t < size),
                  fitStates: Math.min(config.fitStates, size),
                });
              }}
              issues={modelCheck.ok ? [] : modelCheck.errors}
            />
            <div className="oc-field">
              <span className="oc-field__label">Initial distribution π</span>
              <p className="oc-field__hint" style={{ marginTop: 0 }}>
                The probability of starting in each hidden state. Must sum to 1; it is an assumption, not a result.
              </p>
              <table className="oc-matrix">
                <tbody>
                  {config.stateNames.map((s, i) => (
                    <tr key={s}>
                      <th scope="row">{s}</th>
                      <td>
                        <RawNumberInput
                          value={config.initial[i] ?? 0}
                          onChange={(v) => set({ initial: config.initial.map((p, j) => (j === i ? v : p)) })}
                          ariaLabel={`Initial probability of ${s}`}
                          min={0}
                          max={1}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Emission model" hint={modelCheck.ok ? modelCheck.value : 'Row per hidden state, column per observable symbol; each row sums to 1.'}>
            <TextField
              label="Observation symbols"
              value={config.symbols.join(', ')}
              onChange={(v) => {
                const symbols = v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
                if (!symbols.length) return;
                const emissionMatrix = config.emissionMatrix.map((row) => Array.from({ length: symbols.length }, (_, s) => row[s] ?? 0));
                set({ symbols, emissionMatrix });
              }}
              hint="Comma separated. Renaming a symbol does not change the observed sequence; removing one invalidates any observation of it."
            />
            <div className="oc-field">
              <span className="oc-field__label">Emission probabilities B</span>
              <table className="oc-matrix">
                <thead>
                  <tr>
                    <th />
                    {config.symbols.map((s) => (
                      <th key={s} scope="col">{s}</th>
                    ))}
                    <th scope="col">Row sum</th>
                  </tr>
                </thead>
                <tbody>
                  {config.stateNames.map((state, i) => {
                    const row = config.emissionMatrix[i] ?? [];
                    const sum = row.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
                    return (
                      <tr key={state}>
                        <th scope="row">{state}</th>
                        {config.symbols.map((sym, s) => (
                          <td key={sym}>
                            <RawNumberInput
                              value={row[s] ?? 0}
                              onChange={(v) =>
                                set({
                                  emissionMatrix: config.emissionMatrix.map((r, ri) => (ri === i ? r.map((x, ci) => (ci === s ? v : x)) : [...r])),
                                })
                              }
                              ariaLabel={`Probability that ${state} emits ${sym}`}
                              min={0}
                              max={1}
                            />
                          </td>
                        ))}
                        <td className="tnum">{formatValue(sum, 6)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Observed sequence">
            <TextField
              label="Observations"
              value={config.observationText}
              onChange={(observationText) => set({ observationText })}
              multiline
              rows={6}
              monospace
              hint="Symbol names or 0-based indices, separated by spaces or commas. These are the only things you see; the states are inferred from them."
            />
            {parsed.ok && <p className="oc-chart-note">{T} observation(s) read.</p>}
            <NumberField label="Forecast horizon (steps)" value={config.horizon} onChange={(horizon) => set({ horizon })} min={1} max={200} integer hint="Forecasts are percentiles of where the process may go, not a confidence interval for an estimated parameter." />
          </Card>

          <Card title="Chain analysis settings">
            <NumberField label="Mixing-time threshold (total variation)" value={config.mixingThreshold} onChange={(mixingThreshold) => set({ mixingThreshold })} min={0.001} max={0.999} step={0.01} hint="The distance to stationarity at which the starting state is deemed to have stopped mattering." />
            <div className="oc-field">
              <span className="oc-field__label">Target set for hitting probabilities</span>
              <div className="oc-stack--tight">
                {config.stateNames.map((s, i) => (
                  <Checkbox
                    key={s}
                    checked={config.hittingTargets.includes(i)}
                    onChange={(on) => set({ hittingTargets: on ? [...config.hittingTargets, i].sort((a, b) => a - b) : config.hittingTargets.filter((t) => t !== i) })}
                    label={s}
                  />
                ))}
              </div>
            </div>
            <NumberField label="Significance level for the Markov-property test" value={config.orderAlpha} onChange={(orderAlpha) => set({ orderAlpha })} min={0.001} max={0.5} step={0.01} />
          </Card>

          <AiAssistPanel
            capability="interpretQuestion"
            context="Describe what the hidden states and the observable symbols are in your situation. Everything on this screen then follows from the transition matrix, the emission matrix and the observed sequence by exact dynamic programming."
          />
        </div>

        <div className="oc-stack">
          {!modelCheck.ok && <Notice tone="error" title="The model must be corrected first" items={modelCheck.errors.map((e) => e.message)} />}
          {modelCheck.ok && !parsed.ok && <Notice tone="error" title="The observed sequence cannot be read">{parsed.message}</Notice>}
          {observationCheck && !observationCheck.ok && <Notice tone="error" title="An observation is outside the model's support" items={observationCheck.errors.map((e) => e.message)} />}

          {filter && !filter.ok && <Notice tone="error" title="The forward algorithm could not be run" items={filter.errors.map((e) => e.message)} />}

          {filter && filter.ok && (
            <Card title="Likelihood of the observed sequence" actions={exactnessBadge(filter.value.exactness)}>
              <KeyValueList
                items={[
                  { label: 'log P(observations | model)', value: <span className="tnum">{formatValue(filter.value.logLikelihood, 8)}</span> },
                  { label: 'Per-observation average log-likelihood', value: <span className="tnum">{formatValue(filter.value.logLikelihood / T, 6)}</span> },
                  { label: 'Free parameters of the supplied model', value: suppliedParameters && suppliedParameters.ok ? String(suppliedParameters.value) : '—' },
                ]}
              />
              <p className="oc-chart-note">{filter.value.method}</p>
              {suppliedLogLikelihood && !suppliedLogLikelihood.ok && <Notice tone="error" items={suppliedLogLikelihood.errors.map((e) => e.message)} />}
            </Card>
          )}

          {smoothed && !smoothed.ok && <Notice tone="error" title="The smoothed posteriors could not be computed" items={smoothed.errors.map((e) => e.message)} />}

          {smoothed && smoothed.ok && filter && filter.ok && (
            <Card title="Where was the system? Filtered and smoothed state probabilities" actions={exactnessBadge(smoothed.value.exactness)}>
              <LineChart
                title="Posterior probability of each hidden state, step by step"
                description="The smoothed marginal P(state at t | all observations), from the forward-backward recursions."
                series={config.stateNames.slice(0, 8).map((s, i) => ({ label: s, points: smoothed.value.gamma.map((row, t) => ({ x: t + 1, y: row[i] })) }))}
                xLabel="Observation index"
                yLabel="Posterior probability of this state"
                yDomain={[0, 1]}
                valueFormatter={(v) => formatPercent(v)}
                note="These are per-step marginals. Each one is a statement about a single timestep on its own, not about the sequence of states as a whole."
                onExport={() => downloadText('hmm-smoothed-posteriors.csv', toCsv(['t', ...config.stateNames], smoothed.value.gamma.map((row, t) => [t + 1, ...row])))}
              />
              <LineChart
                title="How certain the inference was at each step"
                description="Shannon entropy of the state posterior, in bits, against the entropy of complete ignorance."
                series={[
                  { label: 'Posterior entropy', points: smoothed.value.entropy.map((h, t) => ({ x: t + 1, y: h })) },
                  { label: 'Complete ignorance', points: smoothed.value.entropy.map((_, t) => ({ x: t + 1, y: smoothed.value.maxEntropy })), dashed: true },
                ]}
                xLabel="Observation index"
                yLabel="Entropy (bits)"
                yDomain={[0, Math.max(smoothed.value.maxEntropy, ...smoothed.value.entropy) * 1.05]}
                note="A decoded path looks equally confident everywhere. This curve shows where the data actually decided the state and where it was close to a coin flip."
              />
              <Notice tone="info" title="Filtered against smoothed" >
                <p style={{ margin: 0 }}>
                  The filter P(state at t | observations up to t) uses only the past; the smoothed posterior above also uses everything that came afterwards.
                  At the final observation they coincide: the filtered probability of {config.stateNames[0]} there is{' '}
                  {formatPercent(filter.value.filtered[T - 1][0], 4)}.
                </p>
              </Notice>
            </Card>
          )}

          {decoded && !decoded.ok && <Notice tone="error" title="Viterbi decoding could not be run" items={decoded.errors.map((e) => e.message)} />}

          {decoded && decoded.ok && comparison && comparison.ok && (
            <Card title="The most likely state path" actions={exactnessBadge(decoded.value.exactness)}>
              <KeyValueList
                items={[
                  { label: 'log P(path, observations)', value: <span className="tnum">{formatValue(decoded.value.logProbability, 8)}</span> },
                  { label: 'log P(path | observations)', value: <span className="tnum">{formatValue(decoded.value.logPosterior, 8)}</span> },
                  { label: 'Probability the whole path is right', value: <span className="tnum">{formatPercent(Math.exp(decoded.value.logPosterior), 4)}</span> },
                  { label: 'Steps where the two decodings disagree', value: `${comparison.value.disagreements.length} of ${T}` },
                ]}
              />
              <Notice tone="warning" title="Two different questions, two different answers">
                {comparison.value.notes.map((note, i) => (
                  <p key={i} style={{ marginTop: i === 0 ? 0 : 'var(--s2)', marginBottom: 0 }}>{note}</p>
                ))}
                {comparison.value.posteriorModePathImpossible ? (
                  <p style={{ marginBottom: 0 }}>
                    Here the per-step argmax path has probability exactly zero under the model, so it is not merely a different answer — it is not a path the
                    model allows at all.
                  </p>
                ) : (
                  <p style={{ marginBottom: 0 }}>
                    The per-step argmax path is possible here, with log P(path, observations) ={' '}
                    {formatValue(comparison.value.posteriorModePathLogProbability, 8)}, against {formatValue(decoded.value.logProbability, 8)} for the Viterbi
                    path. Do not read the per-step marginals above as if their peaks traced out the Viterbi path.
                  </p>
                )}
              </Notice>
              <DataTable
                caption="Observation, Viterbi state and the individually most likely state at each step"
                maxHeight={360}
                columns={[
                  { key: 't', header: 'Step', numeric: true, render: (r: PathRow) => String(r.t) },
                  { key: 'o', header: 'Observed', render: (r: PathRow) => r.observation },
                  { key: 'v', header: 'Viterbi path (whole sequence)', render: (r: PathRow) => r.viterbi },
                  { key: 'm', header: 'Per-step argmax (this step alone)', render: (r: PathRow) => (r.agrees ? r.mode : `${r.mode} ✕`) },
                  { key: 'p', header: 'Posterior of the per-step choice', numeric: true, render: (r: PathRow) => formatPercent(r.modeProbability, 4) },
                  { key: 'h', header: 'Entropy (bits)', numeric: true, render: (r: PathRow) => formatValue(r.entropy, 4) },
                ]}
                rows={observations.map((o, t): PathRow => {
                  const mode = comparison.value.posterior.posteriorModePath[t];
                  return {
                    t: t + 1,
                    observation: config.symbols[o],
                    viterbi: config.stateNames[decoded.value.path[t]],
                    mode: config.stateNames[mode],
                    modeProbability: comparison.value.posterior.gamma[t][mode],
                    entropy: comparison.value.posterior.entropy[t],
                    agrees: decoded.value.path[t] === mode,
                  };
                })}
              />
              <p className="oc-chart-note">{decoded.value.method}</p>
              {decodingExplanation && <ExplanationPanel explanation={decodingExplanation} />}
            </Card>
          )}

          {forecast && !forecast.ok && <Notice tone="error" title="The forecast could not be computed" items={forecast.errors.map((e) => e.message)} />}

          {forecast && forecast.ok && (
            <Card title={`Forecast for the next ${horizon} step(s)`} actions={exactnessBadge(forecast.value.exactness)}>
              <LineChart
                title="Where the hidden state is heading"
                description="P(state at T+h | observations), propagated forward from the filtered state by the transition matrix."
                series={config.stateNames.slice(0, 8).map((s, i) => ({ label: s, points: forecast.value.stateDistribution.map((d, h) => ({ x: h + 1, y: d[i] })) }))}
                xLabel="Steps beyond the last observation"
                yLabel="Probability of being in this state"
                yDomain={[0, 1]}
                valueFormatter={(v) => formatPercent(v)}
              />
              {forecast.value.symbolProbability && (
                <BarChart
                  title={`Next observation, ${horizon} step(s) ahead`}
                  description="The predictive distribution over symbols, mixing over the forecast state distribution."
                  data={config.symbols.map((s, i) => ({ x: i, label: s, y: forecast.value.symbolProbability![horizon - 1][i], compare: forecast.value.symbolProbability![0][i] }))}
                  xLabel="Symbol"
                  yLabel="Probability"
                  seriesLabel={`At T+${horizon}`}
                  compareLabel="At T+1"
                  asPercent
                />
              )}
              <Notice tone="info" title="What these numbers are">
                {forecast.value.notes.map((note, i) => (
                  <p key={i} style={{ marginTop: i === 0 ? 0 : 'var(--s2)', marginBottom: 0 }}>{note}</p>
                ))}
              </Notice>
            </Card>
          )}

          {/* ------------------------------------------------- chain diagnostics */}

          {period && period.ok && (
            <Card title="Structure of the hidden chain" actions={exactnessBadge(period.value.exactness)}>
              <KeyValueList
                items={[
                  { label: 'Irreducible', value: period.value.irreducible ? 'Yes — every state can eventually reach every other' : 'No — some states cannot be reached from some others' },
                  { label: 'Aperiodic', value: period.value.aperiodic ? 'Yes' : 'No' },
                  { label: 'Period', value: period.value.period === null ? '—' : String(period.value.period) },
                ]}
              />
              {period.value.notes.map((note, i) => (
                <p className="oc-chart-note" key={i}>{note}</p>
              ))}
              <p className="oc-chart-note">{period.value.method}</p>
            </Card>
          )}

          {balance && balance.ok && (
            <Card title="Reversibility (detailed balance)" actions={exactnessBadge(balance.value.exactness)}>
              <Notice tone={balance.value.reversible ? 'success' : 'info'} items={balance.value.notes} />
              <KeyValueList
                items={[
                  { label: 'Largest imbalance |π_i P_ij − π_j P_ji|', value: <span className="tnum">{formatValue(balance.value.maxViolation, 6)}</span> },
                  { label: 'Tolerance', value: <span className="tnum">{formatValue(balance.value.tolerance, 4)}</span> },
                ]}
              />
              <p className="oc-chart-note">{balance.value.method}</p>
            </Card>
          )}
          {balance && !balance.ok && <Notice tone="info" title="Reversibility was not computed" items={balance.errors.map((e) => e.message)} />}

          {passage && passage.ok && (
            <Card title="Mean first passage times" actions={exactnessBadge(passage.value.exactness)}>
              <HeatmapChart
                title="Expected steps to first reach each state"
                description="Row: starting state. Column: target state. The diagonal is the expected return time."
                rows={config.stateNames}
                columns={config.stateNames}
                values={passage.value.mfpt}
                valueLabel="Expected steps"
              />
              <DataTable
                caption="Long-run share, expected return time and the Kemeny constant from each start"
                columns={[
                  { key: 's', header: 'State', render: (r: PassageRow) => r.state },
                  { key: 'p', header: 'Long-run share', numeric: true, render: (r: PassageRow) => formatPercent(r.stationary, 5) },
                  { key: 'r', header: 'Expected return time (steps)', numeric: true, render: (r: PassageRow) => formatValue(r.returnTime, 6) },
                  { key: 'k', header: 'Kemeny constant from this start', numeric: true, render: (r: PassageRow) => formatValue(r.kemeny, 6) },
                ]}
                rows={config.stateNames.map((state, i) => ({
                  state,
                  stationary: passage.value.stationary[i],
                  returnTime: passage.value.returnTimes[i],
                  kemeny: passage.value.kemenyByStart[i],
                }))}
              />
              <p className="oc-chart-note">
                {passage.value.method} The Kemeny constant is {formatValue(passage.value.kemeny, 6)}; the spread across starting states is{' '}
                {formatValue(passage.value.kemenyInvariance, 4)}, which is the numerical evidence for the invariance rather than an assumption of it.
              </p>
              {passage.value.notes.map((note, i) => (
                <p className="oc-chart-note" key={i}>{note}</p>
              ))}
            </Card>
          )}
          {passage && !passage.ok && <Notice tone="info" title="Mean first passage times were not computed" items={passage.errors.map((e) => e.message)} />}

          {hitting && hitting.ok && (
            <Card title="Probability of ever reaching the target set" actions={exactnessBadge(hitting.value.exactness)}>
              <DataTable
                caption="Probability of ever hitting the target set, from each starting state"
                columns={[
                  { key: 's', header: 'Starting from', render: (r: HittingRow) => r.state },
                  { key: 'p', header: 'Ever reaches the target', numeric: true, render: (r: HittingRow) => formatPercent(r.probability, 5) },
                ]}
                rows={config.stateNames.map((state, i) => ({ state, probability: hitting.value.probability[i] }))}
              />
              {hitting.value.unreachableFrom.length > 0 && (
                <p className="oc-chart-note">
                  The target set cannot be reached at all from: {hitting.value.unreachableFrom.map((i) => config.stateNames[i]).join(', ')}. Those
                  probabilities are exactly 0, not small.
                </p>
              )}
              <p className="oc-chart-note">{hitting.value.method}</p>
              {hitting.value.notes.map((note, i) => (
                <p className="oc-chart-note" key={i}>{note}</p>
              ))}
            </Card>
          )}
          {hitting && !hitting.ok && <Notice tone="info" title="Hitting probabilities were not computed" items={hitting.errors.map((e) => e.message)} />}

          {absorption && absorption.ok && absorption.value.transientStates.length > 0 && (
            <Card title="Absorption: the fundamental matrix" actions={exactnessBadge(absorption.value.exactness)}>
              <DataTable
                caption="Expected steps to absorption, with its standard deviation"
                columns={[
                  { key: 's', header: 'Starting from', render: (r: AbsorptionRow) => r.state },
                  { key: 'e', header: 'Expected steps to absorption', numeric: true, render: (r: AbsorptionRow) => formatValue(r.expected, 6) },
                  { key: 'd', header: 'Standard deviation of that time', numeric: true, render: (r: AbsorptionRow) => formatValue(r.sd, 6) },
                ]}
                rows={absorption.value.transientStates.map((s, i) => ({
                  state: config.stateNames[s],
                  expected: absorption.value.expectedSteps[i],
                  sd: absorption.value.sdSteps[i],
                }))}
              />
              <p className="oc-chart-note">{absorption.value.method}</p>
              {absorption.value.notes.map((note, i) => (
                <p className="oc-chart-note" key={i}>{note}</p>
              ))}
            </Card>
          )}
          {absorption && !absorption.ok && <Notice tone="info" title="Absorption analysis does not apply to this chain" items={absorption.errors.map((e) => e.message)} />}

          {mixing && mixing.ok && (
            <Card title="How long until the starting state stops mattering" actions={exactnessBadge(mixing.value.exactness)}>
              <KeyValueList
                items={[
                  { label: 'Mixing time', value: `${mixing.value.mixingTime} step(s) to within ${formatValue(mixing.value.mixingThreshold, 3)} total variation` },
                  { label: 'Second-largest eigenvalue modulus', value: <span className="tnum">{formatValue(mixing.value.slem, 8)}</span> },
                  { label: 'Independent cross-check of the SLEM', value: <span className="tnum">{formatValue(mixing.value.slemCrossCheck, 8)}</span> },
                  { label: 'Agreement between the two methods', value: <span className="tnum">{formatValue(mixing.value.slemAgreement, 4)}</span> },
                  { label: 'Relaxation time', value: <span className="tnum">{formatValue(mixing.value.relaxationTime, 6)} steps</span> },
                  { label: 'Power method, run directly', value: slemDirect && slemDirect.ok ? <span className="tnum">{`${formatValue(slemDirect.value.slem, 8)} after ${slemDirect.value.iterations} iterations${slemDirect.value.converged ? '' : ` (not converged; growth-ratio spread ${formatValue(slemDirect.value.ratioSpread, 3)})`}`}</span> : '—' },
                ]}
              />
              <LineChart
                title="Distance to the long-run distribution"
                description="Total-variation distance after n steps, worst case over starting states, against the geometric decay the SLEM predicts."
                series={[
                  { label: 'Total-variation distance', points: (tvCurve && tvCurve.ok ? tvCurve.value : mixing.value.tvDistance).map((d, i) => ({ x: i + 1, y: d })) },
                  { label: 'Predicted geometric decay', points: mixing.value.predictedDecay.map((d, i) => ({ x: i + 1, y: d })), dashed: true },
                ]}
                xLabel="Steps"
                yLabel="Total-variation distance"
                yDomain={[0, 1]}
                note="The dashed curve is what the eigenvalue predicts; the solid one is the actual distance. They differ at small n, where the eigenvalue alone is not the honest answer."
                onExport={() =>
                  downloadText(
                    'hmm-mixing.csv',
                    toCsv(['step', 'tv_distance', 'predicted_decay'], mixing.value.tvDistance.map((d, i) => [i + 1, d, mixing.value.predictedDecay[i]])),
                  )
                }
              />
              {eigen && eigen.ok && (
                <DataTable
                  caption="Eigenvalues of the transition matrix"
                  columns={[
                    { key: 'i', header: '#', numeric: true, render: (r: EigenRow) => String(r.index) },
                    { key: 'v', header: 'Eigenvalue', render: (r: EigenRow) => (Math.abs(r.im) < 1e-12 ? formatValue(r.re, 8) : `${formatValue(r.re, 6)} ${r.im >= 0 ? '+' : '−'} ${formatValue(Math.abs(r.im), 6)}i`) },
                    { key: 'm', header: 'Modulus', numeric: true, render: (r: EigenRow) => formatValue(r.modulus, 8) },
                  ]}
                  rows={eigen.value.values.map((v, i) => ({ index: i + 1, re: v.re, im: v.im, modulus: eigen.value.moduli[i] }))}
                />
              )}
              {eigen && eigen.ok && (
                <p className="oc-chart-note">
                  {eigen.value.method} Trace residual |Σλ − trace(P)| = {formatValue(eigen.value.traceResidual, 4)} after {eigen.value.iterations} iterations
                  {eigen.value.converged ? '' : ' — the iteration did not converge, so treat these eigenvalues with suspicion'}.
                </p>
              )}
              {mixingExplanation && <ExplanationPanel explanation={mixingExplanation} />}
            </Card>
          )}
          {mixing && !mixing.ok && <Notice tone="info" title="There is no mixing time for this chain" items={mixing.errors.map((e) => e.message)} />}

          {/* ------------------------------------------- order of the decoded path */}

          {orderTest && orderTest.ok && (
            <Card title="Is the decoded path even Markov?" actions={exactnessBadge(orderTest.value.exactness)}>
              <Notice tone={orderTest.value.reject ? 'warning' : 'info'} title={orderTest.value.reject ? 'First-order dependence is rejected' : 'First-order dependence is not rejected'}>
                <p style={{ margin: 0 }}>
                  G² = {formatValue(orderTest.value.statistic, 6)} on {orderTest.value.effectiveDegreesOfFreedom} effective degrees of freedom (nominal{' '}
                  {orderTest.value.degreesOfFreedom}), p = {formatValue(orderTest.value.pValue, 5)} at α = {formatValue(orderTest.value.alpha, 3)}, from{' '}
                  {orderTest.value.tripleCount} consecutive triples.
                </p>
              </Notice>
              <Notice tone="warning" title="What this test was run on">
                <p style={{ margin: 0 }}>
                  The hidden states are never observed, so the test is run on the Viterbi-decoded path, not on observed states. A decoded path is an estimate
                  produced by a first-order model, which biases the test towards accepting first-order dependence. Read the result as a diagnostic of the
                  decoding, not as evidence about the real process.
                </p>
              </Notice>
              {orderTest.value.notes.map((note, i) => (
                <p className="oc-chart-note" key={i}>{note}</p>
              ))}
              <p className="oc-chart-note">{orderTest.value.method}</p>
            </Card>
          )}
          {orderTest && !orderTest.ok && <Notice tone="info" title="The Markov-property test could not be run" items={orderTest.errors.map((e) => e.message)} />}

          <Card title="Order selection on the decoded path" hint="Scores every order from 0 to the maximum on exactly the same set of transitions.">
            <NumberField label="Largest order to score" value={config.maxOrder} onChange={(maxOrder) => set({ maxOrder })} min={1} max={4} integer />
            {!config.runOrderSelection ? (
              <>
                <Notice tone="info" title="Order selection is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    Scoring orders 0 to {maxOrder} counts contexts of up to {config.stateNames.length ** maxOrder} combinations over the whole
                    decoded path, which takes long enough to make the page unresponsive while it runs. It is run only when you ask for it.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    The log-likelihood always improves with order, so AIC and BIC are what carry the comparison — and they disagree systematically.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runOrderSelection: true })} disabled={!decodedPath}>
                    Score the chain orders
                  </Button>
                </div>
                {!decodedPath && <p className="oc-muted">There is no decoded path yet, so there is nothing to score.</p>}
              </>
            ) : !orderSelection ? (
              <Notice tone="info">There is no decoded path, so there is nothing to score.</Notice>
            ) : !orderSelection.ok ? (
              <Notice tone="error" items={orderSelection.errors.map((e) => e.message)} />
            ) : (
              <>
                <DataTable
                  caption="Log-likelihood, AIC and BIC by chain order"
                  columns={[
                    { key: 'o', header: 'Order', numeric: true, render: (r: OrderRow) => String(r.order) },
                    { key: 'l', header: 'Log-likelihood', numeric: true, render: (r: OrderRow) => formatValue(r.logLikelihood, 6) },
                    { key: 'p', header: 'Free parameters', numeric: true, render: (r: OrderRow) => String(r.freeParameters) },
                    { key: 'a', header: 'AIC', numeric: true, render: (r: OrderRow) => formatValue(r.aic, 6) },
                    { key: 'b', header: 'BIC', numeric: true, render: (r: OrderRow) => formatValue(r.bic, 6) },
                  ]}
                  rows={orderSelection.value.rows}
                />
                <KeyValueList
                  items={[
                    { label: 'Best by AIC', value: `Order ${orderSelection.value.bestByAic}` },
                    { label: 'Best by BIC', value: `Order ${orderSelection.value.bestByBic}` },
                    { label: 'Transitions scored', value: String(orderSelection.value.sampleSize) },
                  ]}
                />
                <Notice tone="warning" title="Caveats the engine attaches to this table" items={orderSelection.value.notes} />
                <p className="oc-chart-note">{orderSelection.value.method}</p>
                <div className="oc-btn-row">
                  <Button icon="x" onClick={() => set({ runOrderSelection: false })}>
                    Clear
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* ------------------------------------------------------- Baum-Welch */}

          <Card title="Learn the model from the sequence (Baum-Welch)" hint="EM on the observed sequence. The number of hidden states is not learned; it is your choice.">
            <NumberField label="Hidden states to fit" value={config.fitStates} onChange={(fitStates) => set({ fitStates })} min={1} max={8} integer />
            <NumberField label="Random restarts" value={config.fitRestarts} onChange={(fitRestarts) => set({ fitRestarts })} min={1} max={20} integer hint="Each restart is a full EM run from a different random start. More restarts reduce, but never remove, the chance of reporting a poor local optimum." />
            <NumberField label="Maximum iterations per restart" value={config.fitMaxIterations} onChange={(fitMaxIterations) => set({ fitMaxIterations })} min={10} max={2000} integer />
            <TextField label="Seed" value={config.fitSeed} onChange={(fitSeed) => set({ fitSeed })} hint="The random starts are seeded, so the fit is reproducible." />
            {!config.runFit ? (
              <>
                <Notice tone="info" title="The fit is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    Baum-Welch runs up to {fitMaxIterations} iterations for each of {fitRestarts} restart(s), and every iteration is a full
                    forward-backward pass over all {T} observation(s). That is seconds of computation, so it runs in a background worker and only when you
                    ask for it: the page stays usable while it runs, the progress counts completed iterations, and the fit can be cancelled.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    EM finds a local optimum of the likelihood, not the maximum likelihood estimate. The restarts are there because that distinction matters.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runFit: true })} disabled={!parsed.ok}>
                    Fit the model
                  </Button>
                </div>
                {!parsed.ok && <p className="oc-muted">The observed sequence cannot be read, so there is nothing to fit.</p>}
              </>
            ) : !parsed.ok ? (
              <Notice tone="info">The observed sequence cannot be read, so there is nothing to fit.</Notice>
            ) : (
              <EngineJobPanel
                job={fitJob}
                onClear={() => set({ runFit: false })}
                clearLabel="Clear the fit"
                unitLabel="EM iterations"
                errorTitle="The fit failed"
                testId="hmm-fit"
              >
                {fit && (
              <>
                <Notice tone={fit.converged ? 'info' : 'warning'} title={fit.converged ? 'A local optimum was reached' : 'The best restart did not converge'}>
                  <p style={{ margin: 0 }}>
                    Baum-Welch maximises the likelihood by hill climbing, so what it returns is a local optimum, not the maximum likelihood estimate. The
                    reported model is the best of {fit.runs.length} restart(s) — restart {fit.bestRestart + 1} — which is the best one found, not
                    the global optimum.
                  </p>
                </Notice>
                <KeyValueList
                  items={[
                    { label: 'Log-likelihood of the fitted model', value: <span className="tnum">{formatValue(fit.logLikelihood, 8)}</span> },
                    {
                      label: 'Log-likelihood of the model you supplied',
                      value: suppliedLogLikelihood && suppliedLogLikelihood.ok ? <span className="tnum">{formatValue(suppliedLogLikelihood.value, 8)}</span> : '—',
                    },
                    { label: 'Iterations of the best restart', value: String(fit.iterations) },
                    { label: 'Largest log-likelihood decrease seen (must be ~0)', value: <span className="tnum">{formatValue(fit.worstMonotonicityViolation, 4)}</span> },
                    { label: 'Exactness', value: exactnessBadge(fit.exactness) },
                  ]}
                />
                <LineChart
                  title="Log-likelihood by iteration"
                  description="One curve per restart. EM increases the likelihood monotonically, so a decrease would be a bug rather than noise."
                  series={fit.runs.slice(0, 8).map((r, i) => ({ label: `Restart ${i + 1}${i === fit.bestRestart ? ' (best)' : ''}`, points: r.history.map((v, it) => ({ x: it + 1, y: v })) }))}
                  xLabel="Iteration"
                  yLabel="Log-likelihood"
                  note="Restarts ending at different likelihoods are direct evidence of multiple local optima on this surface."
                />
                <DataTable
                  caption="Fitted transition matrix"
                  columns={[
                    { key: 'f', header: 'From', render: (r: FittedRow) => r.from },
                    ...fit.model.stateNames.map((s, j) => ({
                      key: `t${j}`,
                      header: `To ${s}`,
                      numeric: true,
                      render: (r: FittedRow) => formatValue(r.row[j], 5),
                    })),
                  ]}
                  rows={fit.model.stateNames.map((from, i) => ({ from, row: fit.model.transition[i] }))}
                />
                {fit.model.emission.kind === 'discrete' && (
                  <DataTable
                    caption="Fitted emission matrix"
                    columns={[
                      { key: 'f', header: 'State', render: (r: FittedRow) => r.from },
                      ...fit.model.emission.symbols.map((s, j) => ({
                        key: `e${j}`,
                        header: s,
                        numeric: true,
                        render: (r: FittedRow) => formatValue(r.row[j], 5),
                      })),
                    ]}
                    rows={fit.model.stateNames.map((from, i) => ({
                      from,
                      row: fit.model.emission.kind === 'discrete' ? fit.model.emission.matrix[i] : [],
                    }))}
                  />
                )}
                {fit.warnings.length > 0 && <Notice tone="warning" title="Warnings from the fit" items={fit.warnings} />}
                <p className="oc-chart-note">{fit.method}</p>
                <AssumptionsPanel assumptions={HMM_ASSUMPTIONS} limitations={fit.limitations} title="What a fitted hidden Markov model does and does not tell you" />
                <div className="oc-btn-row">
                  <Button icon="x" onClick={() => set({ runFit: false })}>
                    Clear the fit
                  </Button>
                </div>
              </>
                )}
              </EngineJobPanel>
            )}
          </Card>

          <AssumptionsPanel
            assumptions={HMM_ASSUMPTIONS}
            limitations={[
              `The model has ${n} hidden states because you said so. Nothing in the data fixes that number, and the likelihood can always be raised by adding states.`,
              'The transition and emission probabilities are inputs. If they were estimated from data they carry uncertainty, and none of the exact figures above propagate it.',
              'The hidden states have no inherent identity: any consistent permutation of them gives exactly the same likelihood, so a state label is a name you chose, not a finding.',
              'A per-step posterior and a decoded path answer different questions. Neither is a summary of the other, and this screen keeps them separate for that reason.',
            ]}
            title="What this analysis assumes"
          />
        </div>
      </div>
    </>
  );
}

interface PathRow {
  t: number;
  observation: string;
  viterbi: string;
  mode: string;
  modeProbability: number;
  entropy: number;
  agrees: boolean;
}
interface PassageRow {
  state: string;
  stationary: number;
  returnTime: number;
  kemeny: number;
}
interface HittingRow {
  state: string;
  probability: number;
}
interface AbsorptionRow {
  state: string;
  expected: number;
  sd: number;
}
interface EigenRow {
  index: number;
  re: number;
  im: number;
  modulus: number;
}
interface OrderRow {
  order: number;
  logLikelihood: number;
  freeParameters: number;
  aic: number;
  bic: number;
}
interface FittedRow {
  from: string;
  row: number[];
}
