/**
 * Analytic queueing theory: steady-state results for the standard queue
 * families, with the panels practitioners actually need — the utilisation
 * blow-up, the variability contrast, minimum staffing and the economic
 * optimum.
 *
 * Everything here comes from `src/engine/queueing`. The model list is read
 * from the engine's `QUEUE_MODELS` registry rather than restated, so a model
 * added to the engine appears here without a change to this file.
 */
import { useMemo } from 'react';
import {
  QUEUE_MODELS,
  analyseJacksonNetwork,
  analyseMg1,
  getQueueModel,
  optimiseServerCount,
  planCapacity,
  utilisationCurve,
  type CapacityTarget,
  type QueueAnalysis,
} from '../../engine/queueing';
import { EngineError } from '../../engine/core/result';
import {
  Badge,
  Card,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  Segmented,
  SelectField,
  SliderField,
} from '../../ui/primitives';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { Icon } from '../../ui/icons';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

export interface QueueingConfig {
  /** Id from the engine's QUEUE_MODELS registry. */
  modelId: string;
  /** Arrival rate λ (per unit time; per unit for the finite-population model). */
  arrivalRate: number;
  /** Service rate μ per busy server. */
  serviceRate: number;
  servers: number;
  /** System capacity K, used by the finite-capacity models. */
  capacity: number;
  /** Calling population N, used by the finite-population model. */
  population: number;
  /** Squared coefficient of variation of the service time (M/G/1, G/G/c). */
  serviceScv: number;
  /** Squared coefficient of variation of the inter-arrival time (G/G/c). */
  arrivalScv: number;
  /** The t in P(wait > t). */
  waitThreshold: number;
  /** Priority classes, highest priority first. */
  classes: { label: string; arrivalRate: number; serviceRate: number }[];
  /** Capacity-planning target. */
  targetKind: 'meanWait' | 'waitTail' | 'blocking';
  targetValue: number;
  targetTime: number;
  /** Economic optimum inputs. */
  serverCost: number;
  waitingCost: number;
  costBasis: 'inSystem' | 'inQueue';
  /** Jackson network mode. */
  networkEnabled: boolean;
  networkNodes: { id: string; externalArrivalRate: number; serviceRate: number; servers: number }[];
  networkRoutes: { from: string; to: string; probability: number }[];
}

/**
 * M/M/c at ρ = 0.9 with three servers: stable, but deep enough into the
 * saturation region that the utilisation curve and the staffing panels all say
 * something interesting without any input.
 */
export const QUEUEING_DEFAULT: QueueingConfig = {
  modelId: 'mmc',
  arrivalRate: 27,
  serviceRate: 10,
  servers: 3,
  capacity: 10,
  population: 8,
  serviceScv: 1,
  arrivalScv: 1,
  waitThreshold: 0.1,
  classes: [
    { label: 'Urgent', arrivalRate: 4, serviceRate: 10 },
    { label: 'Routine', arrivalRate: 5, serviceRate: 10 },
  ],
  targetKind: 'meanWait',
  targetValue: 0.05,
  targetTime: 0.1,
  serverCost: 40,
  waitingCost: 120,
  costBasis: 'inSystem',
  networkEnabled: false,
  networkNodes: [
    { id: 'Intake', externalArrivalRate: 12, serviceRate: 20, servers: 1 },
    { id: 'Assessment', externalArrivalRate: 0, serviceRate: 18, servers: 1 },
    { id: 'Discharge', externalArrivalRate: 0, serviceRate: 25, servers: 1 },
  ],
  networkRoutes: [
    { from: 'Intake', to: 'Assessment', probability: 1 },
    { from: 'Assessment', to: 'Discharge', probability: 0.8 },
    { from: 'Assessment', to: 'Intake', probability: 0.1 },
  ],
};

/** Models whose steady state exists at any load, because demand is limited. */
const ALWAYS_STABLE = new Set(['mmck', 'mm1k', 'mmcc', 'mminf', 'finitepop']);

/** Which configuration fields each model actually consumes. */
function usesField(modelId: string, field: 'servers' | 'capacity' | 'population' | 'serviceScv' | 'arrivalScv' | 'classes'): boolean {
  switch (field) {
    case 'servers':
      return ['mmc', 'mmck', 'mmcc', 'ggc', 'finitepop'].includes(modelId);
    case 'capacity':
      return ['mmck', 'mm1k'].includes(modelId);
    case 'population':
      return modelId === 'finitepop';
    case 'serviceScv':
      return ['mg1', 'ggc'].includes(modelId);
    case 'arrivalScv':
      return modelId === 'ggc';
    case 'classes':
      return modelId === 'priority';
  }
}

/** Assemble the model-specific configuration object the engine expects. */
function engineConfig(config: QueueingConfig): Record<string, unknown> {
  const base: Record<string, unknown> = { arrivalRate: config.arrivalRate, serviceRate: config.serviceRate };
  if (config.modelId === 'priority') return { classes: config.classes };
  if (usesField(config.modelId, 'servers')) base.servers = config.servers;
  if (usesField(config.modelId, 'capacity')) base.capacity = config.capacity;
  if (usesField(config.modelId, 'population')) base.population = config.population;
  if (usesField(config.modelId, 'serviceScv')) base.serviceScv = config.serviceScv;
  if (usesField(config.modelId, 'arrivalScv')) base.arrivalScv = config.arrivalScv;
  return base;
}

/** Messages from a thrown EngineError, or a single message for anything else. */
function errorMessages(e: unknown): string[] {
  if (e instanceof EngineError) return e.issues.map((i) => i.message);
  if (e instanceof Error) return [e.message];
  return ['The computation failed for an unknown reason.'];
}

type Attempt<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function attemptEngine<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, errors: errorMessages(e) };
  }
}

const TARGET_OPTIONS: { value: QueueingConfig['targetKind']; label: string }[] = [
  { value: 'meanWait', label: 'Mean wait Wq at most' },
  { value: 'waitTail', label: 'P(wait > t) at most' },
  { value: 'blocking', label: 'Blocking probability at most (loss system)' },
];

export function QueueingTool({ config }: { config: QueueingConfig }) {
  const app = useApp();
  const set = (patch: Partial<QueueingConfig>) => app.updateConfig({ ...config, ...patch });

  // An unknown id (an old saved investigation, or a hand-edited import) falls
  // back to M/M/1 rather than blanking the screen.
  const model = useMemo(() => {
    try {
      return getQueueModel(config.modelId);
    } catch {
      return getQueueModel('mm1');
    }
  }, [config.modelId]);

  const analysis = useMemo<Attempt<QueueAnalysis>>(
    () => attemptEngine(() => model.analyse(engineConfig(config))),
    [model, config],
  );

  // Drawn for the current server count, so the curve describes this system.
  const curve = useMemo(
    () =>
      attemptEngine(() =>
        utilisationCurve({
          serviceRate: config.serviceRate,
          servers: usesField(config.modelId, 'servers') ? config.servers : 1,
        }),
      ),
    [config.serviceRate, config.servers, config.modelId],
  );

  // Same mean service time, different variability: the P–K formula in action.
  const variability = useMemo(
    () =>
      attemptEngine(() =>
        [0, 0.25, 0.5, 1, 2, 4].map((scv) => ({
          scv,
          analysis: analyseMg1({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, serviceScv: scv }),
        })),
      ),
    [config.arrivalRate, config.serviceRate],
  );

  const target = useMemo<CapacityTarget>(() => {
    if (config.targetKind === 'waitTail') return { kind: 'waitTail', t: config.targetTime, value: config.targetValue };
    if (config.targetKind === 'blocking') return { kind: 'blocking', value: config.targetValue };
    return { kind: 'meanWait', value: config.targetValue };
  }, [config.targetKind, config.targetTime, config.targetValue]);

  const plan = useMemo(
    () =>
      attemptEngine(() =>
        planCapacity({
          arrivalRate: config.arrivalRate,
          serviceRate: config.serviceRate,
          target,
          system: config.targetKind === 'blocking' ? 'loss' : 'queue',
          maxServers: 500,
        }),
      ),
    [config.arrivalRate, config.serviceRate, config.targetKind, target],
  );

  const cost = useMemo(
    () =>
      attemptEngine(() =>
        optimiseServerCount({
          arrivalRate: config.arrivalRate,
          serviceRate: config.serviceRate,
          serverCost: config.serverCost,
          waitingCost: config.waitingCost,
          basis: config.costBasis,
          maxServers: 200,
        }),
      ),
    [config.arrivalRate, config.serviceRate, config.serverCost, config.waitingCost, config.costBasis],
  );

  const network = useMemo(
    () =>
      attemptEngine(() =>
        analyseJacksonNetwork({
          nodes: config.networkNodes.map((n) => ({
            id: n.id,
            externalArrivalRate: n.externalArrivalRate,
            serviceRate: n.serviceRate,
            servers: n.servers,
          })),
          routes: config.networkRoutes,
        }),
      ),
    [config.networkNodes, config.networkRoutes],
  );

  const metrics = analysis.ok ? analysis.value.metrics : null;
  const queueWait = analysis.ok ? analysis.value.queueWait : undefined;
  const tailAtT = useMemo(
    () => (queueWait ? attemptEngine(() => queueWait.tail(config.waitThreshold)) : null),
    [queueWait, config.waitThreshold],
  );

  return (
    <>
      <ToolHeader toolId="queueing" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Queueing model" hint="Kendall notation describes arrivals / service / servers / capacity / population.">
            <SelectField
              label="Model"
              value={config.modelId}
              onChange={(modelId) => set({ modelId })}
              options={QUEUE_MODELS.map((m) => ({ value: m.id, label: `${m.kendall} — ${m.name.replace(/^[^—]*—\s*/, '')}` }))}
            />
            <p style={{ fontSize: 12.5, margin: 'var(--s2) 0 0' }}>
              <strong>{model.kendall}</strong> · {model.description}
            </p>
          </Card>

          <Card title="Parameters">
            {usesField(config.modelId, 'classes') ? (
              <>
                <p style={{ fontSize: 12.5, marginTop: 0 }}>
                  One server shared by classes in strict priority order, highest first. Each class has its own arrival and service rate.
                </p>
                {config.classes.map((k, i) => (
                  <div key={`${k.label}-${i}`}>
                    <NumberField
                      label={`${k.label}: arrival rate λ`}
                      value={k.arrivalRate}
                      onChange={(v) =>
                        set({ classes: config.classes.map((c, j) => (j === i ? { ...c, arrivalRate: v } : c)) })
                      }
                      min={0}
                    />
                    <NumberField
                      label={`${k.label}: service rate μ`}
                      value={k.serviceRate}
                      onChange={(v) =>
                        set({ classes: config.classes.map((c, j) => (j === i ? { ...c, serviceRate: v } : c)) })
                      }
                      min={0}
                    />
                  </div>
                ))}
              </>
            ) : (
              <>
                <NumberField
                  label={config.modelId === 'finitepop' ? 'Per-unit arrival rate λ' : 'Arrival rate λ'}
                  symbol="λ"
                  value={config.arrivalRate}
                  onChange={(arrivalRate) => set({ arrivalRate })}
                  min={0}
                  hint={config.modelId === 'finitepop' ? 'Rate at which ONE unit calls on the system while it is outside it.' : 'Customers arriving per unit time.'}
                />
                <NumberField
                  label="Service rate μ"
                  symbol="μ"
                  value={config.serviceRate}
                  onChange={(serviceRate) => set({ serviceRate })}
                  min={0}
                  hint={`One busy server completes μ services per unit time, so the mean service time is 1/μ = ${formatValue(1 / config.serviceRate, 4)}.`}
                />
                {usesField(config.modelId, 'servers') && (
                  <NumberField label="Servers c" symbol="c" value={config.servers} onChange={(servers) => set({ servers })} min={1} integer />
                )}
                {usesField(config.modelId, 'capacity') && (
                  <NumberField
                    label="System capacity K"
                    symbol="K"
                    value={config.capacity}
                    onChange={(capacity) => set({ capacity })}
                    min={1}
                    integer
                    hint="Maximum customers in the system, including those in service. Arrivals beyond K are turned away."
                  />
                )}
                {usesField(config.modelId, 'population') && (
                  <NumberField label="Population N" symbol="N" value={config.population} onChange={(population) => set({ population })} min={1} integer />
                )}
                {usesField(config.modelId, 'serviceScv') && (
                  <SliderField
                    label="Service-time variability C_s²"
                    symbol="C_s²"
                    value={config.serviceScv}
                    onChange={(serviceScv) => set({ serviceScv })}
                    min={0}
                    max={6}
                    step={0.05}
                    hint="Squared coefficient of variation Var[S]/E[S]². 0 is constant service, 1 is exponential, above 1 is more variable than exponential."
                  />
                )}
                {usesField(config.modelId, 'arrivalScv') && (
                  <SliderField
                    label="Inter-arrival variability C_a²"
                    symbol="C_a²"
                    value={config.arrivalScv}
                    onChange={(arrivalScv) => set({ arrivalScv })}
                    min={0}
                    max={6}
                    step={0.05}
                    hint="1 is Poisson arrivals; below 1 is more regular (scheduled), above 1 is burstier."
                  />
                )}
                <NumberField
                  label="Wait threshold t for P(wait > t)"
                  symbol="t"
                  value={config.waitThreshold}
                  onChange={(waitThreshold) => set({ waitThreshold })}
                  min={0}
                />
              </>
            )}

            {metrics ? (
              <div className="oc-result-hero">
                <span className="oc-result-hero__label">Utilisation ρ</span>
                <span className="oc-result-hero__value">{formatPercent(metrics.utilisation)}</span>
                <span className="oc-result-hero__detail">
                  Offered load {formatValue(metrics.offeredLoad, 4)} erlangs across {metrics.servers === Infinity ? 'unlimited' : metrics.servers} server(s).{' '}
                  <Icon name="check" size={13} /> Steady state exists.
                </span>
              </div>
            ) : (
              <Notice tone="error" title="No steady state — this is not a number that can be reported" items={analysis.ok ? [] : analysis.errors}>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  {ALWAYS_STABLE.has(config.modelId)
                    ? 'This model normally has a steady state at any load, so the refusal above is about the inputs rather than saturation.'
                    : 'With unlimited waiting room and ρ ≥ 1, work arrives faster than it can be cleared: the queue grows without bound. The mean wait is infinite, not merely large, so no figure is shown.'}
                </p>
              </Notice>
            )}
            {ALWAYS_STABLE.has(config.modelId) && (
              <Notice tone="info">
                {config.modelId === 'finitepop'
                  ? 'A finite calling population limits demand: arrivals stop while units are already in the system, so this queue is stable at any λ and μ and ρ ≥ 1 is not a failure condition.'
                  : 'A finite capacity makes this queue stable at any load: excess arrivals are turned away (see the blocking probability) rather than queued, so ρ ≥ 1 still has a steady state.'}
              </Notice>
            )}
          </Card>

          <AiAssistPanel
            capability="suggestFollowUps"
            context={`Queueing analysis with ${model.kendall}: λ = ${config.arrivalRate}, μ = ${config.serviceRate}${
              usesField(config.modelId, 'servers') ? `, c = ${config.servers}` : ''
            }${metrics ? `, ρ = ${formatPercent(metrics.utilisation)}` : ' (no steady state)'}.`}
          />
        </div>

        <div className="oc-stack">
          {!analysis.ok && <Notice tone="error" title="This configuration has no result" items={analysis.errors} />}

          {analysis.ok && metrics && (
            <>
              <Card title="Steady-state results" actions={<Badge variant={analysis.value.explanation.exactness}>{analysis.value.explanation.exactness === 'exact' ? 'Exact' : 'Numerical approximation'}</Badge>}>
                <KeyValueList
                  items={[
                    { label: 'L — mean number in system', value: formatValue(metrics.L, 6) },
                    { label: 'Lq — mean number waiting', value: formatValue(metrics.Lq, 6) },
                    { label: 'W — mean time in system', value: formatValue(metrics.W, 6) },
                    { label: 'Wq — mean wait before service', value: formatValue(metrics.Wq, 6) },
                    {
                      label: 'P(an arrival has to wait)',
                      value: metrics.probabilityOfWaiting === null ? 'not available for this model' : formatPercent(metrics.probabilityOfWaiting),
                    },
                    {
                      label: 'Blocking probability',
                      value: metrics.blockingProbability === null ? 'nothing can be blocked' : formatPercent(metrics.blockingProbability),
                    },
                    { label: 'Throughput', value: formatValue(metrics.throughput, 6) },
                    {
                      label: 'Effective arrival rate',
                      value: `${formatValue(metrics.effectiveArrivalRate, 6)}${
                        metrics.effectiveArrivalRate < metrics.arrivalRate ? ' (below the offered rate: some arrivals never enter)' : ''
                      }`,
                    },
                    {
                      label: `P(wait > ${formatValue(config.waitThreshold, 4)})`,
                      value:
                        tailAtT === null
                          ? 'this model has no closed-form waiting-time law'
                          : tailAtT.ok
                            ? formatPercent(tailAtT.value)
                            : tailAtT.errors.join('; '),
                    },
                  ]}
                />
                {analysis.value.explanation.exactness === 'numerical' && (
                  <Notice tone="warning" title="These figures are an approximation, not an exact result">
                    The G/G/c family has no closed-form solution. These values come from the Kingman / Allen–Cunneen approximation: exact only when
                    C_a² = C_s² = 1 (that is, M/M/c), within a few percent at high utilisation, and capable of being wrong by tens of percent at low
                    utilisation or with highly variable arrivals. Do not quote them as exact.
                  </Notice>
                )}
              </Card>

              <Card title="Little's law check (L = λW)" hint="The tool verifies its own output rather than asserting it.">
                <p style={{ fontSize: 12.5, marginTop: 0, display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                  <Icon name={metrics.littlesLaw.holds ? 'check' : 'alert'} size={16} />
                  <strong>{metrics.littlesLaw.holds ? 'Identity holds' : 'Identity does NOT hold — treat these results as unreliable'}</strong>
                </p>
                <KeyValueList
                  items={[
                    { label: 'Arrival rate used', value: formatValue(metrics.littlesLaw.arrivalRate, 6) },
                    { label: 'L vs λW', value: `${formatValue(metrics.littlesLaw.L, 6)} vs ${formatValue(metrics.littlesLaw.lambdaW, 6)}` },
                    { label: '|L − λW|', value: formatValue(metrics.littlesLaw.systemResidual, 3) },
                    { label: 'Lq vs λWq', value: `${formatValue(metrics.littlesLaw.Lq, 6)} vs ${formatValue(metrics.littlesLaw.lambdaWq, 6)}` },
                    { label: '|Lq − λWq|', value: formatValue(metrics.littlesLaw.queueResidual, 3) },
                    { label: 'Tolerance', value: formatValue(metrics.littlesLaw.tolerance, 3) },
                  ]}
                />
                <p className="oc-chart-note">{metrics.littlesLaw.note}</p>
              </Card>

              {metrics.distribution.length > 0 && (
                <Card title="Number in system">
                  <BarChart
                    title="Steady-state probability of n customers in the system"
                    description={`P(n in system) for ${analysis.value.kendall}.`}
                    data={metrics.distribution.map((s) => ({ x: s.n, y: s.p }))}
                    xLabel="Customers in system n"
                    yLabel="Probability"
                    seriesLabel="P(n)"
                    asPercent
                    note={
                      metrics.distributionTruncated
                        ? 'The state space is unbounded; the tail beyond the last bar is omitted from the chart but included in every mean above.'
                        : 'The complete state space is shown.'
                    }
                  />
                </Card>
              )}

              {queueWait && (
                <Card title="Waiting-time distribution" hint={queueWait.description}>
                  <LineChart
                    title="P(wait > t)"
                    description="Probability that an arrival still has not begun service by time t."
                    series={[
                      {
                        label: 'P(wait > t)',
                        points: Array.from({ length: 80 }, (_, i) => {
                          const t = (i * (queueWait.mean > 0 ? queueWait.mean * 6 : 1)) / 79;
                          return { x: t, y: queueWait.tail(t) };
                        }),
                      },
                    ]}
                    xLabel="Time waited t"
                    yLabel="Probability"
                    referenceLines={[{ value: config.waitThreshold, label: `t = ${formatValue(config.waitThreshold, 4)}`, axis: 'x' }]}
                  />
                  <KeyValueList
                    items={[
                      { label: 'Mean wait', value: formatValue(queueWait.mean, 6) },
                      { label: 'P(no wait at all)', value: formatPercent(queueWait.atomAtZero) },
                      { label: '90th percentile of the wait', value: formatValue(queueWait.quantile(0.9), 6) },
                    ]}
                  />
                  <p className="oc-chart-note">
                    These are percentiles of the waiting time of individual customers — a statement about the spread of real waits, not a confidence
                    interval for the mean. The mean itself is exact here, so it has no sampling interval.
                  </p>
                </Card>
              )}
            </>
          )}

          <Card title="The cost of utilisation — why the last 10% is the expensive part">
            {curve.ok ? (
              <>
                <Notice tone="warning" title={`Going from ${formatPercent(curve.value.lastSlice.fromUtilisation)} to ${formatPercent(curve.value.lastSlice.toUtilisation)} busy multiplies the mean wait by ${formatValue(curve.value.lastSlice.ratio, 4)}`}>
                  {curve.value.lastSlice.note}
                </Notice>
                <LineChart
                  title="Mean wait Wq against utilisation ρ"
                  description="Each point is an exact M/M/c steady state at that utilisation, with μ and c held fixed."
                  series={[{ label: 'Wq', points: curve.value.points.map((p) => ({ x: p.utilisation, y: p.Wq })) }]}
                  xLabel="Utilisation ρ"
                  yLabel="Mean wait Wq"
                  markers={[
                    { x: curve.value.lastSlice.fromUtilisation, y: curve.value.lastSlice.wqFrom, label: `ρ = ${formatPercent(curve.value.lastSlice.fromUtilisation)}` },
                    { x: curve.value.lastSlice.toUtilisation, y: curve.value.lastSlice.wqTo, label: `ρ = ${formatPercent(curve.value.lastSlice.toUtilisation)}` },
                  ]}
                  note="The curve is a hyperbola, not a line: Wq carries a factor 1/(1 − ρ). Linear intuition about utilisation is wrong, and it is wrong by an unbounded amount."
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Mean wait at selected utilisations"
                    columns={[
                      { key: 'rho', header: 'ρ', numeric: true, render: (r) => formatPercent(r.utilisation) },
                      { key: 'lam', header: 'λ', numeric: true, render: (r) => formatValue(r.arrivalRate, 4) },
                      { key: 'wq', header: 'Wq', numeric: true, render: (r) => formatValue(r.Wq, 4) },
                      { key: 'rel', header: 'Wq relative to the first row', numeric: true, render: (r) => `${formatValue(r.waitRelativeToStart, 4)}×` },
                    ]}
                    rows={curve.value.points}
                    maxHeight={260}
                  />
                </div>
              </>
            ) : (
              <Notice tone="error" title="The utilisation curve could not be drawn" items={curve.errors} />
            )}
          </Card>

          <Card title="Same mean service time, different variability (Pollaczek–Khinchine)">
            {variability.ok ? (
              <>
                <p style={{ fontSize: 12.5, marginTop: 0 }}>
                  Every row below has the identical mean service time 1/μ = {formatValue(1 / config.serviceRate, 4)} and the identical arrival rate.
                  Only the <em>variability</em> of the service time changes. M/D/1 (C_s² = 0) has exactly half the queue of M/M/1 (C_s² = 1), because
                  Lq in the P–K formula is proportional to (1 + C_s²).
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Queue length and wait against service-time variability"
                    columns={[
                      {
                        key: 'scv',
                        header: 'C_s²',
                        numeric: true,
                        render: (r) => `${formatValue(r.scv, 3)}${r.scv === 0 ? ' (M/D/1)' : r.scv === 1 ? ' (M/M/1)' : ''}`,
                      },
                      { key: 'lq', header: 'Lq', numeric: true, render: (r) => formatValue(r.analysis.metrics.Lq, 5) },
                      { key: 'wq', header: 'Wq', numeric: true, render: (r) => formatValue(r.analysis.metrics.Wq, 5) },
                      { key: 'w', header: 'W', numeric: true, render: (r) => formatValue(r.analysis.metrics.W, 5) },
                    ]}
                    rows={variability.value}
                  />
                </div>
                <BarChart
                  title="Mean wait Wq by service-time variability"
                  description="Identical mean service time throughout; only the variance differs."
                  data={variability.value.map((r) => ({ x: r.scv, y: r.analysis.metrics.Wq, label: `C_s² = ${formatValue(r.scv, 3)}` }))}
                  xLabel="Service-time C_s²"
                  yLabel="Mean wait Wq"
                  seriesLabel="Wq"
                  note="Reducing variability is often cheaper than adding capacity, and it is invisible to any model that uses only the mean."
                />
              </>
            ) : (
              <Notice tone="error" title="The variability contrast needs a stable single-server queue at these rates" items={variability.errors} />
            )}
          </Card>

          <Card title="Capacity planning — the minimum number of servers">
            <SelectField
              label="Target"
              value={config.targetKind}
              onChange={(targetKind) => set({ targetKind })}
              options={TARGET_OPTIONS}
              hint="A blocking target needs a loss system (M/M/c/c); a waiting target needs a queue with a waiting room."
            />
            <NumberField label="Target value" value={config.targetValue} onChange={(targetValue) => set({ targetValue })} min={0} />
            {config.targetKind === 'waitTail' && (
              <NumberField label="Time t in P(wait > t)" symbol="t" value={config.targetTime} onChange={(targetTime) => set({ targetTime })} min={0} />
            )}
            {plan.ok ? (
              <>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">Minimum servers</span>
                  <span className="oc-result-hero__value">{plan.value.servers}</span>
                  <span className="oc-result-hero__detail">Achieved value {formatValue(plan.value.metric, 5)} against a target of {formatValue(config.targetValue, 5)}.</span>
                </div>
                {plan.value.previous && (
                  <Notice tone="info" title={`Why ${plan.value.servers} is a minimum and not merely enough`}>
                    At c = {plan.value.previous.servers}:{' '}
                    {plan.value.previous.metric === null ? plan.value.previous.reason : `the metric is ${formatValue(plan.value.previous.metric, 5)} — ${plan.value.previous.reason}`}
                  </Notice>
                )}
                <Notice tone="info" items={plan.value.notes} />
              </>
            ) : (
              <Notice tone="error" title="No staffing level meets this target" items={plan.errors} />
            )}
          </Card>

          <Card title="Economic optimum — server cost against waiting cost">
            <NumberField label="Cost of one server per unit time" value={config.serverCost} onChange={(serverCost) => set({ serverCost })} min={0} />
            <NumberField label="Cost of one waiting customer per unit time" value={config.waitingCost} onChange={(waitingCost) => set({ waitingCost })} min={0} />
            <Segmented
              label="Charge waiting cost for"
              value={config.costBasis}
              onChange={(costBasis) => set({ costBasis })}
              options={[
                { value: 'inSystem', label: 'Customers in the system' },
                { value: 'inQueue', label: 'Customers queueing only' },
              ]}
            />
            {cost.ok ? (
              <>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">Cost-minimising servers</span>
                  <span className="oc-result-hero__value">{cost.value.servers}</span>
                  <span className="oc-result-hero__detail">Total cost {formatValue(cost.value.totalCost, 6)} per unit time.</span>
                </div>
                <LineChart
                  title="Total cost against the number of servers"
                  description="Server cost rises linearly; waiting cost falls steeply. The sum has a minimum."
                  series={[
                    { label: 'Total cost', points: cost.value.rows.map((r) => ({ x: r.servers, y: r.totalCost })) },
                    { label: 'Server cost', points: cost.value.rows.map((r) => ({ x: r.servers, y: r.serverCost })), dashed: true },
                    { label: 'Waiting cost', points: cost.value.rows.map((r) => ({ x: r.servers, y: r.waitingCost })), dashed: true },
                  ]}
                  xLabel="Servers c"
                  yLabel="Cost per unit time"
                  referenceLines={[{ value: cost.value.servers, label: `optimum c = ${cost.value.servers}`, axis: 'x' }]}
                  note="The total is often nearly flat across two or three staffing levels, so read the curve rather than only the optimum — and remember the waiting cost is usually the least certain input."
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Cost by staffing level"
                    columns={[
                      { key: 'c', header: 'Servers', numeric: true, render: (r) => String(r.servers) },
                      { key: 'rho', header: 'ρ', numeric: true, render: (r) => formatPercent(r.utilisation) },
                      { key: 'sc', header: 'Server cost', numeric: true, render: (r) => formatValue(r.serverCost, 5) },
                      { key: 'wc', header: 'Waiting cost', numeric: true, render: (r) => formatValue(r.waitingCost, 5) },
                      {
                        key: 'tc',
                        header: 'Total',
                        numeric: true,
                        render: (r) => `${formatValue(r.totalCost, 5)}${r.servers === cost.value.servers ? ' ← optimum' : ''}`,
                      },
                    ]}
                    rows={cost.value.rows}
                    maxHeight={260}
                  />
                </div>
                <Disclosure title="Assumptions and limitations of the cost optimum">
                  <Notice tone="info" items={cost.value.assumptions} />
                  <Notice tone="warning" items={cost.value.limitations} />
                </Disclosure>
              </>
            ) : (
              <Notice tone="error" title="No economic optimum could be reported" items={cost.errors} />
            )}
          </Card>

          <Card title="Jackson network of M/M/c nodes" hint="Several stations with probabilistic routing between them, including feedback.">
            <Segmented
              label="Network mode"
              value={config.networkEnabled ? 'on' : 'off'}
              onChange={(v) => set({ networkEnabled: v === 'on' })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'Analyse the network' },
              ]}
            />
            {config.networkEnabled &&
              (network.ok ? (
                <>
                  <KeyValueList
                    items={[
                      { label: 'External arrival rate into the network', value: formatValue(network.value.externalArrivalRate, 6) },
                      { label: 'L — mean customers in the whole network', value: formatValue(network.value.L, 6) },
                      { label: 'W — mean total time in the network', value: formatValue(network.value.W, 6) },
                      { label: 'Lq / Wq', value: `${formatValue(network.value.Lq, 6)} / ${formatValue(network.value.Wq, 6)}` },
                      {
                        label: "Little's law across the network",
                        value: network.value.littlesLaw.holds ? 'holds' : 'does not hold — results unreliable',
                      },
                    ]}
                  />
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Per-node results from the solved traffic equations"
                      columns={[
                        { key: 'id', header: 'Node', render: (r) => r.id },
                        { key: 'lam', header: 'Solved λ', numeric: true, render: (r) => formatValue(r.arrivalRate, 5) },
                        { key: 'rho', header: 'ρ', numeric: true, render: (r) => formatPercent(r.analysis.metrics.utilisation) },
                        { key: 'stable', header: 'Steady state', render: () => 'yes — every node verified stable' },
                        { key: 'lq', header: 'Lq', numeric: true, render: (r) => formatValue(r.analysis.metrics.Lq, 5) },
                        { key: 'wq', header: 'Wq', numeric: true, render: (r) => formatValue(r.analysis.metrics.Wq, 5) },
                        { key: 'leave', header: 'P(leaves network)', numeric: true, render: (r) => formatPercent(r.departureProbability) },
                      ]}
                      rows={network.value.nodes}
                    />
                  </div>
                  <p className="oc-chart-note">
                    Feedback routing can make a node&rsquo;s own arrival rate much larger than the external rate, so stability must be judged on the
                    solved rates above, not on the inputs. A single saturated node removes the steady state of the whole network, and the engine refuses
                    it by name.
                  </p>
                  <Disclosure title="Assumptions and limitations of the network result">
                    <Notice tone="info" items={network.value.assumptions} />
                    <Notice tone="warning" items={network.value.limitations} />
                  </Disclosure>
                </>
              ) : (
                <Notice tone="error" title="This network has no steady state" items={network.errors} />
              ))}
          </Card>

          {analysis.ok && <ExplanationPanel explanation={analysis.value.explanation} />}

          <Card title="What these models assume" variant="inset">
            <Notice tone="info" title={`Assumptions of ${model.kendall}`} items={model.assumptions} />
            <Notice tone="warning" title="Limitations" items={model.limitations} />
            <p style={{ fontSize: 12.5, marginBottom: 0 }}>
              These assumptions are strong and routinely violated in practice: real arrivals are scheduled or bursty rather than Poisson, real service
              times are rarely exponential, queues are jumped and abandoned, and demand varies by time of day so that no steady state is ever reached. A
              queueing result is a useful order-of-magnitude statement about a system in balance, not a forecast of tomorrow afternoon.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
