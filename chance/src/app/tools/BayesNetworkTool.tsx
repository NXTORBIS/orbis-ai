/**
 * Discrete Bayesian networks and causal reasoning.
 *
 * Everything on this screen is produced by `src/engine/bayesnet/`: marginals
 * and posteriors by variable elimination / junction tree, independence by
 * d-separation, and interventions by graph surgery. The screen's job is to put
 * the two quantities that are usually conflated side by side — P(Y | X = x)
 * and P(Y | do(X = x)) — and to show the trail or the adjustment set that
 * explains the difference, because the explanation is the useful part and the
 * boolean is not.
 *
 * The configuration stores an example id plus (only once the user edits a CPT)
 * a plain node list, so it stays small, survives `structuredClone` and is
 * re-validated by the engine on every render rather than trusted.
 */
import { useMemo } from 'react';
import {
  BayesNet,
  DEFAULT_MAX_FACTOR_ENTRIES,
  EXAMPLE_NETWORK_SPECS,
  allMarginals,
  causalRoles,
  dSeparated,
  evidenceProbability,
  exampleSpec,
  findBackdoorAdjustmentSets,
  interventionDistribution,
  mostProbableExplanation,
  query,
  type Evidence,
  type NetworkSpec,
  type NodeSpec,
} from '../../engine/bayesnet';
import { EXACTNESS_LABEL, EngineError, type Explanation, type Issue } from '../../engine/core/result';
import {
  Badge,
  Button,
  Card,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  RawNumberInput,
  SelectField,
  type ColumnDef,
} from '../../ui/primitives';
import { BarChart } from '../../ui/charts/charts';
import { NetworkGraph, type GraphEdge, type GraphNode } from '../../ui/charts/advanced';
import { formatPercent, formatProbability, formatValue } from '../../ui/charts/scale';
import { Icon } from '../../ui/icons';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

/** A node of the network as stored in the configuration: plain JSON only. */
export interface BayesNetworkNodeConfig {
  id: string;
  states: string[];
  parents: string[];
  /** One row per parent configuration (last parent varies fastest). */
  cpt: number[][];
  /** Always a string; '' means no description, so no `undefined` is stored. */
  description: string;
}

export interface BayesNetworkConfig {
  /** Which built-in example the network starts from. */
  exampleId: string;
  /** Empty until a CPT is edited; non-empty replaces the example's nodes. */
  customNodes: BayesNetworkNodeConfig[];
  /** node id -> state name. '' means "no evidence on this node". */
  evidence: Record<string, string>;
  queryNode: string;
  /** Node whose CPT the editor is showing. */
  editNode: string;
  /** d-separation question: is X independent of Y given Z? */
  xSet: string[];
  ySet: string[];
  zSet: string[];
  treatment: string;
  treatmentState: string;
  outcome: string;
  /** Ceiling on a single intermediate factor; the engine refuses above it. */
  maxFactorEntries: number;
}

/**
 * The confounded treatment network: P(recovery | do(treated)) and
 * P(recovery | treated) genuinely differ here, so the central point of the
 * tool is on screen with no input at all.
 */
export const BAYES_NETWORK_DEFAULT: BayesNetworkConfig = {
  exampleId: 'confounded-treatment',
  customNodes: [],
  evidence: {},
  queryNode: 'recovery',
  editNode: 'recovery',
  xSet: ['sideEffect'],
  ySet: ['recovery'],
  zSet: [],
  treatment: 'treatment',
  treatmentState: 'treated',
  outcome: 'recovery',
  maxFactorEntries: DEFAULT_MAX_FACTOR_ENTRIES,
};

type Role = 'none' | 'x' | 'y' | 'z';

const NO_EVIDENCE = '';

function errorText(e: unknown): string {
  if (e instanceof EngineError) return e.issues.map((i) => i.message).join(' ');
  if (e instanceof Error) return e.message;
  return 'The calculation failed for an unknown reason.';
}

function errorIssues(e: unknown): Issue[] {
  if (e instanceof EngineError) return e.issues;
  return [{ code: 'invalid', message: errorText(e) }];
}

function toNodeConfig(n: NodeSpec): BayesNetworkNodeConfig {
  return {
    id: n.id,
    states: [...n.states],
    parents: [...(n.parents ?? [])],
    cpt: n.cpt.map((r) => [...r]),
    description: n.description ?? '',
  };
}

function toNodeSpec(n: BayesNetworkNodeConfig): NodeSpec {
  const spec: NodeSpec = { id: n.id, states: [...n.states], parents: [...n.parents], cpt: n.cpt.map((r) => [...r]) };
  if (n.description) spec.description = n.description;
  return spec;
}

/**
 * Labels for each CPT row, in the engine's own wording. The engine reports a
 * bad row as `... CPT row for parent=state, ... sums to ...`, so generating the
 * label the same way lets the engine's message be attached to the right row
 * instead of being paraphrased.
 */
function parentConfigLabels(node: BayesNetworkNodeConfig, byId: ReadonlyMap<string, BayesNetworkNodeConfig>): string[] {
  if (node.parents.length === 0) return ['the single (no-parent) configuration'];
  const cards = node.parents.map((p) => byId.get(p)?.states.length ?? 1);
  const rows = cards.reduce((a, b) => a * b, 1);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let rest = r;
    const states = new Array<number>(node.parents.length);
    for (let i = node.parents.length - 1; i >= 0; i--) {
      states[i] = rest % cards[i];
      rest = Math.floor(rest / cards[i]);
    }
    out.push(
      node.parents
        .map((p, i) => `${p}=${byId.get(p)?.states[states[i]] ?? String(states[i])}`)
        .join(', '),
    );
  }
  return out;
}

function ExactnessTag({ exactness }: { exactness: Explanation['exactness'] }) {
  return <Badge variant={exactness}>{EXACTNESS_LABEL[exactness]}</Badge>;
}

export function BayesNetworkTool({ config }: { config: BayesNetworkConfig }) {
  const app = useApp();
  const set = (patch: Partial<BayesNetworkConfig>) => app.updateConfig({ ...config, ...patch });

  const options = useMemo(
    () => ({ maxFactorEntries: Math.max(1, Math.round(config.maxFactorEntries)) }),
    [config.maxFactorEntries],
  );

  // The editable node list is kept separate from the validated network so a
  // half-finished CPT edit still renders the editor instead of blanking it.
  const authored = useMemo(() => {
    if (config.customNodes.length > 0) {
      return { nodes: config.customNodes, name: 'Custom network', description: '', error: null as string | null };
    }
    try {
      const spec = exampleSpec(config.exampleId);
      return { nodes: spec.nodes.map(toNodeConfig), name: spec.name, description: spec.description ?? '', error: null };
    } catch (e) {
      return { nodes: [] as BayesNetworkNodeConfig[], name: 'Unknown network', description: '', error: errorText(e) };
    }
  }, [config.customNodes, config.exampleId]);

  const byId = useMemo(() => new Map(authored.nodes.map((n) => [n.id, n])), [authored.nodes]);

  const built = useMemo(() => {
    if (authored.nodes.length === 0) {
      const missing: Issue[] = [{ code: 'required', message: authored.error ?? 'This network has no nodes.' }];
      return { net: null as BayesNet | null, issues: missing };
    }
    const spec: NetworkSpec = { name: authored.name, nodes: authored.nodes.map(toNodeSpec) };
    if (authored.description) spec.description = authored.description;
    try {
      return { net: BayesNet.from(spec), issues: [] as Issue[] };
    } catch (e) {
      return { net: null, issues: errorIssues(e) };
    }
  }, [authored]);

  const net = built.net;

  /** Evidence restricted to nodes and states this network actually has. */
  const evidence = useMemo<Evidence>(() => {
    const out: Record<string, string> = {};
    for (const [id, state] of Object.entries(config.evidence)) {
      if (state === NO_EVIDENCE) continue;
      const node = byId.get(id);
      if (node && node.states.includes(state)) out[id] = state;
    }
    return out;
  }, [config.evidence, byId]);

  const evidenceCount = Object.keys(evidence).length;

  const structure = useMemo(() => {
    if (!net) return null;
    try {
      // Prior marginals come with the clique tree, which also reports the
      // treewidth that decides whether exact inference is affordable at all.
      const r = allMarginals(net, undefined, options);
      return { ok: true as const, result: r };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, options]);

  const posterior = useMemo(() => {
    if (!net) return null;
    try {
      return { ok: true as const, result: allMarginals(net, evidence, options) };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, evidence, options]);

  const evidenceProb = useMemo(() => {
    if (!net || evidenceCount === 0) return null;
    try {
      return { ok: true as const, result: evidenceProbability(net, evidence, options) };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, evidence, evidenceCount, options]);

  const queryResult = useMemo(() => {
    if (!net || !byId.has(config.queryNode)) return null;
    try {
      const post = query(net, [config.queryNode], evidence, options);
      const prior = query(net, [config.queryNode], undefined, options);
      return { ok: true as const, post, prior };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, byId, config.queryNode, evidence, options]);

  const mpe = useMemo(() => {
    if (!net) return null;
    try {
      return { ok: true as const, result: mostProbableExplanation(net, evidence, options) };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, evidence, options]);

  const dsep = useMemo(() => {
    if (!net) return null;
    const x = config.xSet.filter((n) => byId.has(n));
    const y = config.ySet.filter((n) => byId.has(n));
    const z = config.zSet.filter((n) => byId.has(n));
    if (x.length === 0 || y.length === 0) {
      return { ok: false as const, error: 'Choose at least one node for X and at least one for Y below.' };
    }
    try {
      return { ok: true as const, result: dSeparated(net.graph, x, y, z) };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, byId, config.xSet, config.ySet, config.zSet]);

  const causal = useMemo(() => {
    if (!net || !byId.has(config.treatment) || !byId.has(config.outcome)) return null;
    const treatmentNode = byId.get(config.treatment);
    const state = treatmentNode && treatmentNode.states.includes(config.treatmentState)
      ? config.treatmentState
      : treatmentNode?.states[0] ?? '';
    try {
      const comparison = interventionDistribution(net, config.treatment, state, config.outcome, options);
      const roles = causalRoles(net, config.treatment, config.outcome);
      let search: ReturnType<typeof findBackdoorAdjustmentSets> | null = null;
      let searchError: string | null = null;
      try {
        search = findBackdoorAdjustmentSets(net, config.treatment, config.outcome);
      } catch (e) {
        searchError = errorText(e);
      }
      return { ok: true as const, comparison, roles, search, searchError };
    } catch (e) {
      return { ok: false as const, error: errorText(e) };
    }
  }, [net, byId, config.treatment, config.treatmentState, config.outcome, options]);

  const editNode = byId.get(config.editNode) ?? authored.nodes[0] ?? null;
  const rowLabels = useMemo(
    () => (editNode ? parentConfigLabels(editNode, byId) : []),
    [editNode, byId],
  );

  const graph = useMemo(() => {
    const marginals = posterior?.ok ? posterior.result.byNode : null;
    const nodes: GraphNode[] = authored.nodes.map((n) => {
      const p = marginals?.[n.id];
      const observed = evidence[n.id];
      return {
        id: n.id,
        label: n.id,
        group: observed === undefined ? 'Unobserved' : 'Observed',
        // Only the engine's numbers reach the badge; with no result the badge
        // is omitted rather than filled with a placeholder.
        badge: observed !== undefined
          ? `= ${observed}`
          : p
            ? `${n.states[0]} ${formatPercent(p[0], 1)}`
            : undefined,
      };
    });
    const edges: GraphEdge[] = [];
    for (const n of authored.nodes) for (const p of n.parents) edges.push({ from: p, to: n.id });
    return { nodes, edges };
  }, [authored.nodes, posterior, evidence]);

  const explanation = useMemo<Explanation>(() => {
    const diag = queryResult?.ok ? queryResult.post.diagnostics : null;
    const steps: Explanation['steps'] = [];
    if (diag) {
      steps.push({ label: 'Elimination order', expression: diag.eliminationOrder.join(' → ') || '(nothing to eliminate)' });
      steps.push({ label: 'Induced treewidth of that ordering', value: formatValue(diag.inducedTreewidth) });
      steps.push({
        label: 'Largest intermediate table built',
        value: `${formatValue(diag.largestFactorEntries)} entries (limit ${formatValue(diag.maxFactorEntries)})`,
      });
    }
    if (queryResult?.ok) {
      steps.push({
        label: 'P(evidence) used to normalise the posterior',
        value: evidenceCount === 0 ? '1 (no evidence)' : formatProbability(queryResult.post.evidenceProbability),
      });
    }
    return {
      method: diag?.method ?? 'Variable elimination on the discrete Bayesian network',
      formula: 'P(Q | E = e) = Σ_rest Π_i P(X_i | parents(X_i)) restricted to E = e, divided by P(E = e)',
      steps,
      assumptions: [
        'The directed graph you supplied is the causal and dependence structure. Nothing here is learned from data; the only independences claimed are the ones this graph entails.',
        'Each conditional probability table is taken as given, and each of its rows must sum to 1. The engine refuses a table that does not rather than renormalising it.',
        'Evidence is hard evidence: the node is known to be in exactly that state, with no measurement error.',
        'P(Y | do(X)) is computed by removing the arrows into X. That is only the causal effect if no variable outside the graph causes both X and Y.',
      ],
      limitations: [
        'Variables must be discrete with named states; continuous quantities have to be discretised first.',
        'Exact inference costs grow with the treewidth of the graph, not its size. A query whose intermediate table would exceed the entry limit is refused with the clique that caused it, rather than being attempted.',
        'd-separation answers what the graph implies. A pair of variables can be dependent in the graph and numerically almost independent for particular table values, and the reverse can happen too.',
        'A back-door adjustment set is admissible with respect to this graph only. An unmeasured common cause that is not drawn cannot be detected from the numbers.',
      ],
      exactness: 'exact',
    };
  }, [queryResult, evidenceCount]);

  const roleOf = (id: string): Role => {
    if (config.xSet.includes(id)) return 'x';
    if (config.ySet.includes(id)) return 'y';
    if (config.zSet.includes(id)) return 'z';
    return 'none';
  };

  const setRole = (id: string, role: Role) => {
    // A node is in at most one of X, Y, Z: the engine refuses overlapping
    // sets, so the interface cannot offer them.
    const drop = (list: string[]) => list.filter((n) => n !== id);
    const next = { xSet: drop(config.xSet), ySet: drop(config.ySet), zSet: drop(config.zSet) };
    if (role === 'x') next.xSet = [...next.xSet, id];
    if (role === 'y') next.ySet = [...next.ySet, id];
    if (role === 'z') next.zSet = [...next.zSet, id];
    set(next);
  };

  const pickExample = (id: string) => {
    try {
      const spec = exampleSpec(id);
      const ids = spec.nodes.map((n) => n.id);
      const last = ids[ids.length - 1];
      const first = ids[0];
      const treatmentStates = spec.nodes[0].states;
      set({
        exampleId: id,
        customNodes: [],
        evidence: {},
        queryNode: last,
        editNode: first,
        xSet: [first],
        ySet: [last],
        zSet: [],
        treatment: first,
        treatmentState: treatmentStates[0],
        outcome: last,
      });
    } catch {
      set({ exampleId: id });
    }
  };

  const setCell = (row: number, col: number, value: number) => {
    if (!editNode) return;
    const nextNodes = authored.nodes.map((n) =>
      n.id === editNode.id
        ? { ...n, cpt: n.cpt.map((r, ri) => (ri === row ? r.map((v, ci) => (ci === col ? value : v)) : [...r])) }
        : { ...n, cpt: n.cpt.map((r) => [...r]) },
    );
    set({ customNodes: nextNodes });
  };

  const normaliseRow = (row: number) => {
    if (!editNode) return;
    const sum = editNode.cpt[row]?.reduce((a, b) => a + (Number.isFinite(b) ? Math.max(0, b) : 0), 0) ?? 0;
    if (!(sum > 0)) return;
    const nextNodes = authored.nodes.map((n) =>
      n.id === editNode.id
        ? {
            ...n,
            cpt: n.cpt.map((r, ri) =>
              ri === row ? r.map((v) => (Number.isFinite(v) ? Math.max(0, v) / sum : 0)) : [...r],
            ),
          }
        : { ...n, cpt: n.cpt.map((r) => [...r]) },
    );
    set({ customNodes: nextNodes });
  };

  const nodeOptions = authored.nodes.map((n) => ({ value: n.id, label: n.description ? `${n.id} — ${n.description}` : n.id }));
  const cptCount = authored.nodes.reduce((a, n) => a + n.cpt.length, 0);
  const edgeCount = authored.nodes.reduce((a, n) => a + n.parents.length, 0);

  const trailColumns: ColumnDef<{ description: string; reasons: string[] }>[] = [
    { key: 'trail', header: 'Active trail', render: (r) => <span className="oc-mono">{r.description}</span> },
    {
      key: 'why',
      header: 'Why each intermediate node lets it through',
      render: (r) =>
        r.reasons.length === 0 ? (
          <span className="oc-muted">A single edge joins them directly, so no node can block it.</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {r.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <>
      <ToolHeader toolId="bayes-network" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Network" hint={authored.description || undefined}>
            <SelectField
              label="Built-in example network"
              value={config.exampleId}
              onChange={pickExample}
              options={EXAMPLE_NETWORK_SPECS.map((s) => ({ value: s.id ?? s.name, label: s.name }))}
              hint="Each example is a published network with its original parameters, so the results can be checked against the literature."
            />
            {config.customNodes.length > 0 && (
              <Notice tone="info" title="Edited network">
                <p>
                  You have edited a conditional probability table, so this investigation now stores its own copy of the
                  network rather than following the example.
                </p>
                <Button icon="reset" size="sm" onClick={() => set({ customNodes: [] })}>
                  Restore the example&apos;s tables
                </Button>
              </Notice>
            )}
            <KeyValueList
              items={[
                { label: 'Nodes', value: formatValue(authored.nodes.length) },
                { label: 'Directed edges', value: formatValue(edgeCount) },
                { label: 'CPT rows in total', value: formatValue(cptCount) },
                {
                  label: 'Induced treewidth (junction tree)',
                  value: structure?.ok ? formatValue(structure.result.structure.treewidth) : 'not available',
                },
                {
                  label: 'Largest clique table',
                  value: structure?.ok ? `${formatValue(structure.result.structure.largestCliqueEntries)} entries` : 'not available',
                },
                { label: 'Full joint size', value: net ? `${formatValue(net.jointSize())} entries` : 'not available' },
              ]}
            />
            <NumberField
              label="Largest intermediate table allowed"
              value={config.maxFactorEntries}
              onChange={(maxFactorEntries) => set({ maxFactorEntries })}
              min={1}
              max={1 << 26}
              integer
              unit="entries"
              hint="Exact inference is refused rather than attempted when an intermediate factor would exceed this. Raising it trades memory for the ability to query a wider graph."
            />
            {built.issues.length > 0 && (
              <Notice tone="error" title="This network is not valid" items={built.issues.map((i) => i.message)} />
            )}
            {structure && !structure.ok && <Notice tone="error">{structure.error}</Notice>}
          </Card>

          <Card title="Evidence">
            <p className="oc-secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
              Hard evidence: the node is known to be in exactly this state. Observed nodes are drawn with a heavier
              stroke and a hatched fill in the diagram.
            </p>
            {authored.nodes.map((n) => (
              <SelectField
                key={n.id}
                label={n.description ? `${n.id} (${n.description})` : n.id}
                value={config.evidence[n.id] ?? NO_EVIDENCE}
                onChange={(state) => set({ evidence: { ...config.evidence, [n.id]: state } })}
                options={[
                  { value: NO_EVIDENCE, label: 'No evidence — leave unobserved' },
                  ...n.states.map((s) => ({ value: s, label: `observed to be ${s}` })),
                ]}
              />
            ))}
            {evidenceCount === 0 && (
              <Notice tone="info" title="Nothing observed">
                <p>Every probability shown is a prior. Set evidence above to see the posteriors move.</p>
              </Notice>
            )}
            {evidenceProb?.ok && (
              <KeyValueList
                items={[
                  { label: 'P(evidence)', value: formatProbability(evidenceProb.result.probability) },
                  { label: 'As a percentage', value: formatPercent(evidenceProb.result.probability, 4) },
                  { label: 'Exactness', value: <ExactnessTag exactness={evidenceProb.result.exactness} /> },
                ]}
              />
            )}
            {evidenceProb && !evidenceProb.ok && (
              <Notice tone="error" title="This combination of observations cannot happen in this model">
                <p>{evidenceProb.error}</p>
                <p>
                  Nothing is conditioned on an impossible event, so no posterior is shown. Either the observation is
                  wrong or a conditional probability table that is exactly 0 should not be.
                </p>
              </Notice>
            )}
          </Card>

          <Card title="Conditional probability table">
            <SelectField
              label="Node to edit"
              value={editNode?.id ?? ''}
              onChange={(editNodeId) => set({ editNode: editNodeId })}
              options={nodeOptions}
              hint="One row per configuration of the parents; each row is a distribution over this node's states and must sum to 1."
            />
            {editNode && (
              <div style={{ overflowX: 'auto', paddingBottom: 'var(--s2)' }}>
                <div
                  className="oc-matrix-grid"
                  style={{
                    gridTemplateColumns: `minmax(130px, 200px) repeat(${editNode.states.length}, minmax(68px, 1fr)) 72px 28px`,
                    minWidth: 'max-content',
                  }}
                >
                  <div className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    {editNode.parents.length ? editNode.parents.join(' × ') : 'no parents'}
                  </div>
                  {editNode.states.map((s) => (
                    <div key={`h-${s}`} className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }} title={`P(${editNode.id} = ${s})`}>
                      {s}
                    </div>
                  ))}
                  <div className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    Row sum
                  </div>
                  <div />

                  {editNode.cpt.map((row, ri) => {
                    const label = rowLabels[ri] ?? `configuration ${ri + 1}`;
                    const sum = row.reduce((a, b) => a + (Number.isFinite(b) ? b : NaN), 0);
                    const bad = !Number.isFinite(sum) || Math.abs(sum - 1) > 1e-9;
                    // The engine's own message for this row, matched by the
                    // parent configuration it names, so the wording on screen
                    // is the wording the engine produced.
                    const engineMessages = built.issues
                      .filter((i) => i.field === editNode.id && i.message.includes(label))
                      .map((i) => i.message);
                    return (
                      <div key={`r-${ri}`} style={{ display: 'contents' }}>
                        <div className="oc-matrix-cell" style={{ fontSize: 11, justifyContent: 'flex-start', textAlign: 'left' }} title={label}>
                          {label}
                        </div>
                        {row.map((v, ci) => (
                          <RawNumberInput
                            key={`c-${ri}-${ci}`}
                            value={v}
                            min={0}
                            max={1}
                            invalid={bad}
                            ariaLabel={`P(${editNode.id} = ${editNode.states[ci]} | ${label})`}
                            onChange={(next) => setCell(ri, ci, next)}
                          />
                        ))}
                        <div
                          className="oc-matrix-cell"
                          style={{ color: bad ? 'var(--status-warning)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
                          title={bad ? 'This row does not sum to 1' : 'This row is valid'}
                        >
                          {bad && <Icon name="alert" size={11} />}
                          {Number.isFinite(sum) ? sum.toFixed(3) : '—'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          {bad && Number.isFinite(sum) && sum > 0 && (
                            <Button icon="reset" size="sm" variant="ghost" title={`Scale the row for ${label} to sum to 1`} onClick={() => normaliseRow(ri)} />
                          )}
                        </div>
                        {engineMessages.length > 0 && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <Notice tone="error" title={`Row “${label}”`} items={engineMessages} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          <AiAssistPanel
            capability="explainResult"
            context={`Bayesian network "${authored.name}" with ${authored.nodes.length} nodes and ${edgeCount} edges. ${
              evidenceCount === 0 ? 'No evidence is set.' : `Evidence: ${Object.entries(evidence).map(([k, v]) => `${k}=${v}`).join(', ')}.`
            } Query node: ${config.queryNode}. Causal question: the effect of ${config.treatment}=${config.treatmentState} on ${config.outcome}, where P(${config.outcome} | do(${config.treatment})) ${
              causal?.ok ? (causal.comparison.agree ? 'equals' : 'differs from') : 'is compared with'
            } P(${config.outcome} | ${config.treatment}). An explanation would restate what the posteriors, the active trails and the back-door adjustment set mean for this question; every number itself is computed by variable elimination, not by a language model.`}
          />
        </div>

        <div className="oc-stack">
          {!net && built.issues.length > 0 && (
            <Notice tone="error" title="No results until the network is valid" items={built.issues.map((i) => i.message)} />
          )}

          <Card title="Graph">
            <div style={{ overflowX: 'auto' }}>
              <NetworkGraph
                title={authored.name}
                description={
                  evidenceCount === 0
                    ? 'Each node shows its prior probability of its first state. Arrows point from parent to child.'
                    : 'Each unobserved node shows its posterior probability of its first state given the evidence; observed nodes show the observed state.'
                }
                nodes={graph.nodes}
                edges={graph.edges}
                highlight={Object.keys(evidence)}
                highlightLabel="Observed (evidence) nodes"
              />
            </div>
            {posterior?.ok && (
              <KeyValueList
                items={[
                  { label: 'Method', value: posterior.result.diagnostics.method },
                  { label: 'Exactness', value: <ExactnessTag exactness={posterior.result.exactness} /> },
                ]}
              />
            )}
            {posterior && !posterior.ok && <Notice tone="error">{posterior.error}</Notice>}
          </Card>

          <Card title="Query">
            <SelectField
              label="Query node"
              value={config.queryNode}
              onChange={(queryNode) => set({ queryNode })}
              options={nodeOptions}
            />
            {queryResult?.ok && (
              <>
                <BarChart
                  title={`P(${config.queryNode} | evidence) against the prior`}
                  description="The bars are the posterior given the evidence; the overlay is the prior with nothing observed, so the shift caused by the evidence is the gap between them."
                  data={net
                    ? net.node(config.queryNode).states.map((s, i) => ({
                        x: i,
                        y: queryResult.post.joint.values[i],
                        label: s,
                        compare: queryResult.prior.joint.values[i],
                      }))
                    : []}
                  xLabel={config.queryNode}
                  yLabel="Probability"
                  seriesLabel="Posterior given evidence"
                  compareLabel="Prior (nothing observed)"
                  asPercent
                />
                <KeyValueList
                  items={[
                    { label: 'P(evidence)', value: evidenceCount === 0 ? '1 (no evidence)' : formatProbability(queryResult.post.evidenceProbability) },
                    { label: 'Largest intermediate table', value: `${formatValue(queryResult.post.diagnostics.largestFactorEntries)} entries` },
                    { label: 'Exactness', value: <ExactnessTag exactness={queryResult.post.exactness} /> },
                  ]}
                />
              </>
            )}
            {queryResult && !queryResult.ok && <Notice tone="error">{queryResult.error}</Notice>}

            {mpe?.ok && (
              <>
                <h3 style={{ margin: 'var(--s4) 0 var(--s2)' }}>Most probable explanation</h3>
                <p className="oc-secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
                  The single most likely complete assignment to every unobserved node at once. It is not in general the
                  combination of each node&apos;s individually most likely state.
                </p>
                <KeyValueList
                  items={[
                    ...Object.entries(mpe.result.assignment).map(([k, v]) => ({ label: k, value: v })),
                    { label: 'P(this assignment | evidence)', value: formatProbability(mpe.result.conditionalProbability) },
                    { label: 'P(this assignment and the evidence)', value: formatProbability(mpe.result.jointProbability) },
                    { label: 'Exactness', value: <ExactnessTag exactness={mpe.result.exactness} /> },
                  ]}
                />
              </>
            )}
            {mpe && !mpe.ok && <Notice tone="error" title="No most probable explanation">{mpe.error}</Notice>}
          </Card>

          <Card title="Independence (d-separation)">
            <p className="oc-secondary" style={{ fontSize: 12.5, marginTop: 0 }}>
              Assign each node to X, to Y, or to the conditioning set Z, and the engine reports whether the graph
              entails X ⫫ Y | Z. When it does not, the trail along which dependence survives is the answer worth
              reading.
            </p>
            {authored.nodes.map((n) => (
              <SelectField
                key={`role-${n.id}`}
                label={`Role of ${n.id}`}
                value={roleOf(n.id)}
                onChange={(role) => setRole(n.id, role as Role)}
                options={[
                  { value: 'none', label: 'not in the question' },
                  { value: 'x', label: 'in X' },
                  { value: 'y', label: 'in Y' },
                  { value: 'z', label: 'in Z (conditioned on)' },
                ]}
              />
            ))}
            {dsep?.ok && (
              <>
                <Notice tone={dsep.result.separated ? 'success' : 'warning'} title={dsep.result.separated ? 'd-separated: the graph implies independence' : 'Not d-separated: the graph implies dependence'}>
                  <p>{dsep.result.explanation}</p>
                </Notice>
                {!dsep.result.separated && (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      columns={trailColumns}
                      rows={dsep.result.activePaths.map((p) => ({ description: p.description, reasons: p.reasons }))}
                      caption="Trails that stay active, and the role each intermediate node plays"
                    />
                  </div>
                )}
                <KeyValueList
                  items={[
                    { label: 'Nodes reachable from X given Z', value: dsep.result.reachable.length ? dsep.result.reachable.join(', ') : 'none' },
                    { label: 'Exactness', value: <ExactnessTag exactness="exact" /> },
                  ]}
                />
              </>
            )}
            {dsep && !dsep.ok && <Notice tone="info">{dsep.error}</Notice>}
          </Card>

          <Card title="Causal effect: seeing against doing">
            <SelectField label="Treatment (X)" value={config.treatment} onChange={(treatment) => set({ treatment })} options={nodeOptions} />
            <SelectField
              label="Treatment state set by the intervention"
              value={byId.get(config.treatment)?.states.includes(config.treatmentState) ? config.treatmentState : byId.get(config.treatment)?.states[0] ?? ''}
              onChange={(treatmentState) => set({ treatmentState })}
              options={(byId.get(config.treatment)?.states ?? []).map((s) => ({ value: s, label: s }))}
            />
            <SelectField label="Outcome (Y)" value={config.outcome} onChange={(outcome) => set({ outcome })} options={nodeOptions} />

            {causal?.ok && (
              <>
                <BarChart
                  title={`P(${config.outcome} | do(${config.treatment}=${causal.comparison.treatmentState})) against P(${config.outcome} | ${config.treatment}=${causal.comparison.treatmentState})`}
                  description="The bars are the interventional distribution computed by cutting the arrows into the treatment; the overlay is the ordinary conditional distribution. Where they differ, the difference is the confounding."
                  data={causal.comparison.states.map((s, i) => ({
                    x: i,
                    y: causal.comparison.intervention[i],
                    label: s,
                    compare: causal.comparison.conditioning[i],
                  }))}
                  xLabel={config.outcome}
                  yLabel="Probability"
                  seriesLabel={`P(${config.outcome} | do(${config.treatment}))`}
                  compareLabel={`P(${config.outcome} | ${config.treatment}) — observational`}
                  asPercent
                />
                <Notice
                  tone={causal.comparison.agree ? 'success' : 'warning'}
                  title={causal.comparison.agree ? 'Seeing and doing agree here' : 'Seeing and doing disagree: this comparison is confounded'}
                >
                  <p>{causal.comparison.explanation}</p>
                  {!causal.comparison.agree && (
                    <p>
                      The gap is not a rounding artefact and not a second opinion: the units that happen to have{' '}
                      {config.treatment} = {causal.comparison.treatmentState} differ systematically from the population,
                      so the observational rate answers a different question from the one an intervention would answer.
                    </p>
                  )}
                </Notice>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    columns={[
                      { key: 's', header: config.outcome, render: (r: { s: string; d: number; c: number; diff: number }) => r.s },
                      { key: 'do', header: 'do(X)', numeric: true, render: (r) => formatPercent(r.d, 2) },
                      { key: 'cond', header: 'given X', numeric: true, render: (r) => formatPercent(r.c, 2) },
                      { key: 'diff', header: 'difference', numeric: true, render: (r) => formatPercent(r.diff, 2) },
                    ]}
                    rows={causal.comparison.states.map((s, i) => ({
                      s,
                      d: causal.comparison.intervention[i],
                      c: causal.comparison.conditioning[i],
                      diff: causal.comparison.difference[i],
                    }))}
                    caption="Interventional against observational distribution, state by state"
                  />
                </div>

                <h3 style={{ margin: 'var(--s4) 0 var(--s2)' }}>Back-door adjustment</h3>
                {causal.search && (
                  <Notice tone={causal.search.identifiable ? 'info' : 'warning'} title={causal.search.identifiable ? 'The effect is identified by adjustment' : 'Not identified by back-door adjustment'}>
                    <p>{causal.search.explanation}</p>
                  </Notice>
                )}
                {causal.searchError && <Notice tone="error" title="The adjustment-set search was refused">{causal.searchError}</Notice>}
                {causal.search && (
                  <KeyValueList
                    items={[
                      {
                        label: 'Minimal admissible sets',
                        value: causal.search.minimalSets.length
                          ? causal.search.minimalSets.map((s) => `{${s.join(', ') || '∅'}}`).join(' or ')
                          : 'none found',
                      },
                      { label: 'Candidates considered', value: causal.search.candidates.join(', ') || 'none' },
                      { label: 'Confounders (common causes)', value: causal.roles.confounders.join(', ') || 'none' },
                      { label: 'Mediators', value: causal.roles.mediators.join(', ') || 'none' },
                      { label: 'Open back-door trails', value: causal.roles.openBackdoorPaths.join('; ') || 'none' },
                      { label: 'Exactness', value: <ExactnessTag exactness={causal.comparison.exactness} /> },
                    ]}
                  />
                )}

                {causal.roles.colliders.length > 0 && (
                  <Notice tone="warning" title="Collider bias: controlling for more variables can make the estimate worse">
                    <p>
                      {`{${causal.roles.colliders.join(', ')}} ${causal.roles.colliders.length === 1 ? 'is a common effect' : 'are common effects'} of “${config.treatment}” and “${config.outcome}” or a descendant of one.`}
                    </p>
                    <p>
                      Conditioning on a common effect <strong>creates</strong> a dependence between its causes that does
                      not exist in the population. Adding such a variable to an adjustment set turns an unbiased
                      estimate into a biased one — the opposite of the usual intuition that adjusting for more is safer.
                    </p>
                  </Notice>
                )}
                {causal.roles.warnings.length > 0 && (
                  <Notice tone="warning" title="What the graph says about adjusting here" items={causal.roles.warnings} />
                )}
                {causal.roles.notes.length > 0 && <Notice tone="info" title="Notes on this pair" items={causal.roles.notes} />}
              </>
            )}
            {causal && !causal.ok && <Notice tone="error" title="This causal question cannot be answered as asked">{causal.error}</Notice>}
            {!causal && <Notice tone="info">Choose a treatment and an outcome that are both nodes of this network.</Notice>}
          </Card>

          <Card title="Method, assumptions and limitations">
            <ExplanationPanel explanation={explanation} defaultOpen />
          </Card>
        </div>
      </div>
    </>
  );
}
