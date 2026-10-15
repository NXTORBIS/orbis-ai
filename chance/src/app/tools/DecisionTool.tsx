/**
 * Decision analysis: rollback on a decision tree, the value of information,
 * risk attitude, the no-probability criteria and multi-criteria comparison.
 *
 * The configuration stores a flat node list rather than the engine's nested
 * tree, because the nested form is awkward to edit field by field and awkward
 * to persist: a flat list of nodes referring to each other by id survives
 * structuredClone, has no optional branches that could become `undefined`, and
 * lets a node be edited without rewriting its ancestors. The engine's tree is
 * rebuilt from it inside a memo, where a dangling reference or a cycle becomes
 * an error message rather than a wrong number.
 */
import { useMemo } from 'react';
import {
  decideWithoutProbabilities,
  expectedValueOfPerfectInformation,
  expectedValueOfSampleInformation,
  getWorkedExample,
  oneWaySensitivity,
  paretoFrontier,
  probabilitySweep,
  rollback,
  switchingProbabilityTwoStates,
  testFromSensitivitySpecificity,
  weightedAdditiveValue,
  weightSensitivity,
  type Alternative,
  type ChanceBranch,
  type CriterionResult,
  type DecisionProblem,
  type DecisionTree,
  type MultiCriteriaInput,
  type OneWayResult,
  type PolicyEntry,
  type Provenance,
  type ScoredOption,
  type TreeNode as EngineTreeNode,
  type UtilitySpec,
} from '../../engine/decision';
import { EngineError, type Explanation } from '../../engine/core/result';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  ProbabilityField,
  RawNumberInput,
  Segmented,
  SelectField,
  SliderField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { TreeDiagram, type TreeNode as DiagramNode } from '../../ui/charts/advanced';
import { formatPercent, formatProbability, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------------ config */

export type DecisionMode = 'tree' | 'information' | 'risk' | 'criteria' | 'multicriteria';

export type DecisionNodeKind = 'decision' | 'chance' | 'terminal';

export interface DecisionBranchSpec {
  label: string;
  /** P(branch) at a chance node. Ignored at a decision node. */
  probability: number;
  /** Cash flow on taking this branch, added to the path total. */
  payoff: number;
  /** Id of the node this branch leads to. */
  childId: string;
}

export interface DecisionNodeSpec {
  id: string;
  kind: DecisionNodeKind;
  label: string;
  /** Terminal payoff. Ignored for decision and chance nodes. */
  payoff: number;
  branches: DecisionBranchSpec[];
}

export interface DecisionUtilitySpec {
  kind: 'linear' | 'exponential' | 'power' | 'log';
  /** R of the exponential (CARA) utility. */
  riskTolerance: number;
  /** γ of the power (CRRA) utility. */
  gamma: number;
  /** Shift added before taking a log or a power, so negative payoffs are in the domain. */
  shift: number;
}

export interface DecisionMatrixSpec {
  name: string;
  unit: string;
  actions: string[];
  states: string[];
  /** payoffs[action][state]. */
  payoffs: number[][];
  priors: number[];
}

export interface DecisionConfig {
  mode: DecisionMode;
  treeName: string;
  unit: string;
  rootId: string;
  nodes: DecisionNodeSpec[];
  utility: DecisionUtilitySpec;
  matrix: DecisionMatrixSpec;
  /** The imperfect test, as sensitivity and specificity for one state. */
  test: { sensitivity: number; specificity: number; positiveStateIndex: number; cost: number };
  hurwiczAlpha: number;
  /** Whether the switching point is sought in a probability or in a payoff. */
  sensitivityTarget: 'probability' | 'payoff';
  sensitivityActionA: number;
  sensitivityActionB: number;
  payoffSweep: { action: number; state: number; low: number; high: number };
  criteria: { key: string; label: string; weight: number; direction: 'benefit' | 'cost' }[];
  /** values are aligned with `criteria`, by position. */
  options: { label: string; values: number[] }[];
  normalisation: 'none' | 'max' | 'sum' | 'range';
  /** Show the expected-value policy beside the risk-averse one. */
  compareRiskNeutral: boolean;
}

/** Flatten the engine's nested tree into the editable node list. */
function flattenTree(tree: DecisionTree): DecisionNodeSpec[] {
  const out: DecisionNodeSpec[] = [];
  const stack: EngineTreeNode[] = [tree.root];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    if (node.kind === 'terminal') {
      out.push({ id: node.id, kind: 'terminal', label: node.label ?? node.id, payoff: node.payoff, branches: [] });
      continue;
    }
    const parts: { label: string; probability: number; payoff: number; child: EngineTreeNode }[] =
      node.kind === 'chance'
        ? node.branches.map((b) => ({ label: b.label, probability: b.probability, payoff: b.payoff ?? 0, child: b.child }))
        : node.alternatives.map((a) => ({ label: a.label, probability: 0, payoff: a.payoff ?? 0, child: a.child }));
    out.push({
      id: node.id,
      kind: node.kind,
      label: node.label ?? node.id,
      payoff: 0,
      branches: parts.map((p) => ({ label: p.label, probability: p.probability, payoff: p.payoff, childId: p.child.id })),
    });
    for (const p of parts) stack.push(p.child);
  }
  return out;
}

const WILDCAT = getWorkedExample('wildcat');
const WILDCAT_TREE = WILDCAT.tree as DecisionTree;
const WILDCAT_PROBLEM = WILDCAT.problem as DecisionProblem;

/**
 * The default is the engine's own wildcat drilling example: a tree whose
 * optimal policy is non-trivial, a payoff matrix with a positive EVPI, and a
 * seismic survey whose EVSI is strictly between 0 and EVPI.
 */
export const DECISION_DEFAULT: DecisionConfig = {
  mode: 'tree',
  treeName: WILDCAT_TREE.name,
  unit: WILDCAT_TREE.unit ?? '',
  rootId: WILDCAT_TREE.root.id,
  nodes: flattenTree(WILDCAT_TREE),
  utility: { kind: 'linear', riskTolerance: 150, gamma: 0.5, shift: 100 },
  matrix: {
    name: WILDCAT_PROBLEM.name ?? 'Payoff matrix',
    unit: WILDCAT_PROBLEM.unit ?? '',
    actions: [...WILDCAT_PROBLEM.actions],
    states: [...WILDCAT_PROBLEM.states],
    payoffs: WILDCAT_PROBLEM.payoffs.map((row) => [...row]),
    priors: [...(WILDCAT_PROBLEM.priors ?? [])],
  },
  test: { sensitivity: 0.9, specificity: 0.8, positiveStateIndex: 0, cost: 10 },
  hurwiczAlpha: 0.5,
  sensitivityTarget: 'probability',
  sensitivityActionA: 0,
  sensitivityActionB: 1,
  payoffSweep: { action: 0, state: 1, low: -200, high: 0 },
  // Without probabilities, each state's payoff is an objective in its own
  // right: the Pareto frontier over the states needs no weights at all.
  criteria: WILDCAT_PROBLEM.states.map((state, j) => ({ key: `s${j}`, label: `Payoff if ${state}`, weight: 1, direction: 'benefit' as const })),
  options: WILDCAT_PROBLEM.actions.map((action, i) => ({ label: action, values: [...WILDCAT_PROBLEM.payoffs[i]] })),
  normalisation: 'range',
  compareRiskNeutral: true,
};

/* ------------------------------------------------------------------ helpers */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.message };
    return { ok: false, error: (e as Error).message };
  }
}

const MAX_BUILD_NODES = 2000;

/** Rebuild the engine's nested tree from the flat node list. */
function buildTree(config: DecisionConfig): DecisionTree {
  const byId = new Map(config.nodes.map((n) => [n.id, n]));
  if (!byId.has(config.rootId)) {
    throw new EngineError(`The root node "${config.rootId}" is not in the node list. Choose a root that exists.`, 'missing');
  }
  let built = 0;
  const onPath = new Set<string>();
  const build = (id: string): EngineTreeNode => {
    built += 1;
    if (built > MAX_BUILD_NODES) {
      throw new EngineError(`The tree expands to more than ${MAX_BUILD_NODES} nodes, which is beyond what this editor will build.`, 'size');
    }
    if (onPath.has(id)) {
      throw new EngineError(`Node "${id}" is reachable from itself: a decision tree cannot contain a cycle.`, 'cycle');
    }
    const spec = byId.get(id);
    if (!spec) throw new EngineError(`A branch leads to node "${id}", which does not exist.`, 'missing');
    if (spec.kind === 'terminal') return { kind: 'terminal', id: spec.id, label: spec.label, payoff: spec.payoff };
    if (!spec.branches.length) {
      throw new EngineError(`Node "${spec.label}" is a ${spec.kind} node with no branches. Add a branch, or make it a terminal outcome.`, 'empty');
    }
    onPath.add(id);
    try {
      if (spec.kind === 'chance') {
        const branches: ChanceBranch[] = spec.branches.map((b) => ({
          label: b.label,
          probability: b.probability,
          payoff: b.payoff,
          child: build(b.childId),
        }));
        return { kind: 'chance', id: spec.id, label: spec.label, branches };
      }
      const alternatives: Alternative[] = spec.branches.map((b) => ({ label: b.label, payoff: b.payoff, child: build(b.childId) }));
      return { kind: 'decision', id: spec.id, label: spec.label, alternatives };
    } finally {
      onPath.delete(id);
    }
  };
  return { id: 'edited-tree', name: config.treeName, unit: config.unit || undefined, root: build(config.rootId) };
}

function utilitySpecOf(u: DecisionUtilitySpec): UtilitySpec {
  switch (u.kind) {
    case 'linear':
      return { kind: 'linear' };
    case 'exponential':
      return { kind: 'exponential', riskTolerance: u.riskTolerance };
    case 'power':
      return { kind: 'power', gamma: u.gamma, shift: u.shift };
    case 'log':
      return { kind: 'log', shift: u.shift };
  }
}

function problemOf(m: DecisionMatrixSpec, withPriors: boolean): DecisionProblem {
  return {
    name: m.name,
    unit: m.unit,
    actions: m.actions,
    states: m.states,
    payoffs: m.payoffs,
    ...(withPriors ? { priors: m.priors } : {}),
  };
}

function multiCriteriaInput(config: DecisionConfig): MultiCriteriaInput {
  return {
    criteria: config.criteria.map((c) => ({ key: c.key, label: c.label, weight: c.weight, direction: c.direction })),
    options: config.options.map((o) => ({
      label: o.label,
      values: Object.fromEntries(config.criteria.map((c, j) => [c.key, o.values[j] ?? 0])),
    })),
    normalisation: config.normalisation,
  };
}

/** An Explanation built from what the engine actually reported. */
function explanationOf(provenance: Provenance, notes: string[], formula?: string): Explanation {
  const [method, ...rest] = notes.length ? notes : ['The engine reported no method note.'];
  return {
    method,
    ...(formula ? { formula } : {}),
    steps: [],
    assumptions: provenance.assumedInputs,
    limitations: rest,
    exactness: provenance.exactness,
  };
}

function fmt(x: number, unit: string): string {
  return unit ? `${formatValue(x, 6)} ${unit}` : formatValue(x, 6);
}

const NEW_ID_PREFIX = 'n';

function freshId(nodes: DecisionNodeSpec[]): string {
  let i = nodes.length + 1;
  const taken = new Set(nodes.map((n) => n.id));
  while (taken.has(`${NEW_ID_PREFIX}${i}`)) i += 1;
  return `${NEW_ID_PREFIX}${i}`;
}

/* -------------------------------------------------------------------- tool */

export function DecisionTool({ config }: { config: DecisionConfig }) {
  const app = useApp();
  const set = (patch: Partial<DecisionConfig>) => app.updateConfig({ ...config, ...patch });

  const tree = useMemo(() => attempt(() => buildTree(config)), [config]);
  const utility = useMemo(() => utilitySpecOf(config.utility), [config.utility]);

  const rolled = useMemo(
    () => (tree.ok ? attempt(() => rollback(tree.value, utility)) : { ok: false as const, error: tree.error }),
    [tree, utility],
  );
  // The risk-neutral rollback of the same tree, so the policy flip caused by
  // risk aversion is visible rather than asserted.
  const neutral = useMemo(
    () => (tree.ok ? attempt(() => rollback(tree.value, { kind: 'linear' })) : { ok: false as const, error: tree.error }),
    [tree],
  );

  const evpi = useMemo(() => attempt(() => expectedValueOfPerfectInformation(problemOf(config.matrix, true))), [config.matrix]);

  const evsi = useMemo(
    () =>
      attempt(() => {
        const test = testFromSensitivitySpecificity({
          sensitivity: config.test.sensitivity,
          specificity: config.test.specificity,
          positiveStateIndex: config.test.positiveStateIndex,
          stateCount: config.matrix.states.length,
          label: `Test for "${config.matrix.states[config.test.positiveStateIndex] ?? '?'}"`,
        });
        return expectedValueOfSampleInformation(problemOf(config.matrix, true), test);
      }),
    [config.matrix, config.test],
  );

  const noProbability = useMemo(
    () => attempt(() => decideWithoutProbabilities(problemOf(config.matrix, false), { hurwiczAlpha: config.hurwiczAlpha })),
    [config.matrix, config.hurwiczAlpha],
  );

  const switching = useMemo(
    () =>
      attempt(() =>
        switchingProbabilityTwoStates(problemOf(config.matrix, false), config.sensitivityActionA, config.sensitivityActionB),
      ),
    [config.matrix, config.sensitivityActionA, config.sensitivityActionB],
  );

  const sweep = useMemo<Attempt<OneWayResult>>(
    () =>
      attempt(() => {
        if (config.sensitivityTarget === 'probability') {
          return probabilitySweep(problemOf(config.matrix, true), { baseline: config.matrix.priors[0] ?? 0.5 });
        }
        const { action, state, low, high } = config.payoffSweep;
        const m = config.matrix;
        if (!m.payoffs[action] || m.payoffs[action][state] === undefined) {
          throw new EngineError('Choose an action and a state that exist in the payoff matrix.', 'range');
        }
        if (!m.priors.length) {
          throw new EngineError('A payoff sweep compares expected values, which needs a probability for every state.', 'required');
        }
        return oneWaySensitivity({
          parameterLabel: `Payoff of "${m.actions[action]}" in state "${m.states[state]}"`,
          alternatives: m.actions,
          range: [low, high],
          baseline: m.payoffs[action][state],
          evaluate: (x) => ({
            values: m.payoffs.map((row, i) =>
              row.reduce((acc, v, j) => acc + (m.priors[j] ?? 0) * (i === action && j === state ? x : v), 0),
            ),
          }),
        });
      }),
    [config.matrix, config.sensitivityTarget, config.payoffSweep],
  );

  const mcInput = useMemo(() => multiCriteriaInput(config), [config]);
  const weighted = useMemo(() => attempt(() => weightedAdditiveValue(mcInput)), [mcInput]);
  const pareto = useMemo(() => attempt(() => paretoFrontier(mcInput)), [mcInput]);
  const weightSens = useMemo(
    () => attempt(() => weightSensitivity(mcInput, config.criteria[0]?.key ?? '')),
    [mcInput, config.criteria],
  );

  const diagramRoot = useMemo<DiagramNode | null>(() => {
    if (!tree.ok || !rolled.ok) return null;
    const valuation = rolled.value.nodes;
    const build = (node: EngineTreeNode, label: string, probability: number | null, chosen: boolean): DiagramNode => {
      const v = valuation[node.id];
      const base: DiagramNode = {
        id: node.id,
        kind: node.kind,
        label,
        ...(v ? { value: v.certaintyEquivalent } : {}),
        ...(probability === null ? {} : { probability }),
        chosen,
      };
      if (node.kind === 'terminal') return base;
      if (node.kind === 'chance') {
        return { ...base, children: node.branches.map((b) => build(b.child, b.label, b.probability, chosen)) };
      }
      const picked = v?.chosenAlternative?.index;
      return {
        ...base,
        children: node.alternatives.map((a, i) => build(a.child, a.label, null, chosen && picked === i)),
      };
    };
    return build(tree.value.root, tree.value.root.label ?? tree.value.root.id, 1, true);
  }, [tree, rolled]);

  const unit = config.unit;
  const matrixUnit = config.matrix.unit;
  const mode = config.mode;

  const updateNode = (id: string, patch: Partial<DecisionNodeSpec>) =>
    set({ nodes: config.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const updateBranch = (nodeId: string, index: number, patch: Partial<DecisionBranchSpec>) =>
    set({
      nodes: config.nodes.map((n) =>
        n.id === nodeId ? { ...n, branches: n.branches.map((b, i) => (i === index ? { ...b, ...patch } : b)) } : n,
      ),
    });

  const addNode = (kind: DecisionNodeKind) => {
    const id = freshId(config.nodes);
    const node: DecisionNodeSpec = {
      id,
      kind,
      label: kind === 'terminal' ? 'New outcome' : kind === 'chance' ? 'New uncertainty' : 'New decision',
      payoff: 0,
      branches: [],
    };
    set({ nodes: [...config.nodes, node] });
  };

  const removeNode = (id: string) => {
    if (id === config.rootId) return;
    set({
      nodes: config.nodes.filter((n) => n.id !== id).map((n) => ({ ...n, branches: n.branches.filter((b) => b.childId !== id) })),
    });
  };

  const addBranch = (nodeId: string) => {
    const node = config.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // A new branch needs somewhere to go, so a terminal outcome is created with
    // it: a branch pointing nowhere would only be an error message.
    const leafId = freshId(config.nodes);
    const leaf: DecisionNodeSpec = { id: leafId, kind: 'terminal', label: 'New outcome', payoff: 0, branches: [] };
    const branch: DecisionBranchSpec = { label: `Branch ${node.branches.length + 1}`, probability: 0, payoff: 0, childId: leafId };
    set({
      nodes: [...config.nodes.map((n) => (n.id === nodeId ? { ...n, branches: [...n.branches, branch] } : n)), leaf],
    });
  };

  const removeBranch = (nodeId: string, index: number) =>
    set({ nodes: config.nodes.map((n) => (n.id === nodeId ? { ...n, branches: n.branches.filter((_b, i) => i !== index) } : n)) });

  const setPayoff = (action: number, state: number, value: number) =>
    set({
      matrix: {
        ...config.matrix,
        payoffs: config.matrix.payoffs.map((row, i) => (i === action ? row.map((x, j) => (j === state ? value : x)) : row)),
      },
    });

  const setPrior = (state: number, value: number) =>
    set({ matrix: { ...config.matrix, priors: config.matrix.priors.map((p, j) => (j === state ? value : p)) } });

  const nodeOptions = config.nodes.map((n) => ({ value: n.id, label: `${n.label} (${n.kind})` }));
  const actionOptions = config.matrix.actions.map((a, i) => ({ value: String(i), label: a }));
  const stateOptions = config.matrix.states.map((s, j) => ({ value: String(j), label: s }));

  return (
    <>
      <ToolHeader toolId="decision" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What kind of decision question?">
            <Segmented
              label="Analysis"
              value={mode}
              onChange={(m) => set({ mode: m })}
              options={[
                { value: 'tree', label: 'Decision tree' },
                { value: 'information', label: 'Value of information' },
                { value: 'risk', label: 'Risk attitude' },
                { value: 'criteria', label: 'No probabilities' },
                { value: 'multicriteria', label: 'Multi-criteria' },
              ]}
            />
            <p className="oc-chart-note">{MODE_HINT[mode]}</p>
          </Card>

          {mode === 'tree' && (
            <Card title="The tree" hint="Nodes refer to each other by name; the root is where the decision starts.">
              <TextField label="Name of the decision" value={config.treeName} onChange={(treeName) => set({ treeName })} />
              <TextField label="Unit of the payoffs" value={config.unit} onChange={(u) => set({ unit: u })} hint="Display only, e.g. $000." />
              <SelectField label="Root node" value={config.rootId} onChange={(rootId) => set({ rootId })} options={nodeOptions} />
              <div className="oc-btn-row" style={{ marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
                <Button icon="plus" size="sm" onClick={() => addNode('decision')}>
                  Decision node
                </Button>
                <Button icon="plus" size="sm" onClick={() => addNode('chance')}>
                  Chance node
                </Button>
                <Button icon="plus" size="sm" onClick={() => addNode('terminal')}>
                  Terminal outcome
                </Button>
              </div>
              {config.nodes.map((node) => (
                <div key={node.id} className="oc-field" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--s3)' }}>
                  <TextField label={`Label of node ${node.id}`} value={node.label} onChange={(label) => updateNode(node.id, { label })} />
                  <SelectField
                    label={`Kind of node ${node.id}`}
                    value={node.kind}
                    onChange={(kind) => updateNode(node.id, { kind: kind as DecisionNodeKind })}
                    options={[
                      { value: 'decision', label: 'Decision (you choose)' },
                      { value: 'chance', label: 'Chance (the world chooses)' },
                      { value: 'terminal', label: 'Terminal outcome' },
                    ]}
                  />
                  {node.kind === 'terminal' ? (
                    <NumberField
                      label={`Payoff at ${node.label}`}
                      value={node.payoff}
                      onChange={(payoff) => updateNode(node.id, { payoff })}
                      unit={unit || undefined}
                    />
                  ) : (
                    <>
                      {node.branches.map((b, i) => (
                        <div key={`${node.id}-${i}`} style={{ display: 'grid', gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
                          <TextField label={`Branch ${i + 1} label`} value={b.label} onChange={(label) => updateBranch(node.id, i, { label })} />
                          {node.kind === 'chance' && (
                            <ProbabilityField
                              label={`P(${b.label || `branch ${i + 1}`})`}
                              value={b.probability}
                              onChange={(probability) => updateBranch(node.id, i, { probability })}
                            />
                          )}
                          <NumberField
                            label={`Cash flow on taking "${b.label || `branch ${i + 1}`}"`}
                            value={b.payoff}
                            onChange={(payoff) => updateBranch(node.id, i, { payoff })}
                            unit={unit || undefined}
                          />
                          <SelectField
                            label={`Branch ${i + 1} leads to`}
                            value={b.childId}
                            onChange={(childId) => updateBranch(node.id, i, { childId })}
                            options={nodeOptions}
                          />
                          <Button icon="trash" size="sm" onClick={() => removeBranch(node.id, i)}>
                            Remove branch {i + 1}
                          </Button>
                        </div>
                      ))}
                      <Button icon="plus" size="sm" onClick={() => addBranch(node.id)}>
                        Add a branch to {node.label}
                      </Button>
                    </>
                  )}
                  {node.id !== config.rootId && (
                    <Button icon="trash" size="sm" variant="danger" onClick={() => removeNode(node.id)}>
                      Remove node {node.label}
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          )}

          {(mode === 'information' || mode === 'criteria' || mode === 'multicriteria') && (
            <Card title="Payoff matrix" hint="One payoff per action and state. Higher is better.">
              <div style={{ overflowX: 'auto' }}>
                <table className="oc-table">
                  <caption className="sr-only">Payoffs by action and state</caption>
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      {config.matrix.states.map((s, j) => (
                        <th scope="col" key={j}>
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {config.matrix.actions.map((a, i) => (
                      <tr key={i}>
                        <th scope="row">{a}</th>
                        {config.matrix.states.map((s, j) => (
                          <td key={j}>
                            <RawNumberInput
                              value={config.matrix.payoffs[i]?.[j] ?? 0}
                              onChange={(v) => setPayoff(i, j, v)}
                              ariaLabel={`Payoff of ${a} in state ${s}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mode !== 'criteria' &&
                config.matrix.states.map((s, j) => (
                  <ProbabilityField key={j} label={`P(${s})`} value={config.matrix.priors[j] ?? 0} onChange={(v) => setPrior(j, v)} />
                ))}
              {mode === 'criteria' && (
                <p className="oc-chart-note">
                  The criteria below use no probabilities at all, so the P(state) values are ignored in this mode. The Laplace criterion is the one exception
                  and says so.
                </p>
              )}
            </Card>
          )}

          {mode === 'information' && (
            <Card title="The imperfect test">
              <SelectField
                label="The test is positive for"
                value={String(config.test.positiveStateIndex)}
                onChange={(v) => set({ test: { ...config.test, positiveStateIndex: Number(v) } })}
                options={stateOptions}
              />
              <SliderField
                label="Sensitivity: P(positive | that state holds)"
                value={config.test.sensitivity}
                onChange={(sensitivity) => set({ test: { ...config.test, sensitivity } })}
                min={0}
                max={1}
                step={0.01}
              />
              <SliderField
                label="Specificity: P(negative | that state does not hold)"
                value={config.test.specificity}
                onChange={(specificity) => set({ test: { ...config.test, specificity } })}
                min={0}
                max={1}
                step={0.01}
              />
              <NumberField
                label="Price asked for the test"
                value={config.test.cost}
                onChange={(cost) => set({ test: { ...config.test, cost } })}
                unit={matrixUnit || undefined}
                hint="Compared against EVSI below. The price is not used in the EVSI calculation itself."
              />
            </Card>
          )}

          {mode === 'risk' && (
            <Card title="Risk attitude">
              <SelectField
                label="Utility function"
                value={config.utility.kind}
                onChange={(kind) => set({ utility: { ...config.utility, kind: kind as DecisionUtilitySpec['kind'] } })}
                options={[
                  { value: 'linear', label: 'Linear — risk-neutral (maximise expected value)' },
                  { value: 'exponential', label: 'Exponential (CARA) — constant absolute risk aversion' },
                  { value: 'power', label: 'Power (CRRA) — risk aversion relative to the payoff level' },
                  { value: 'log', label: 'Logarithmic — CRRA with γ = 1' },
                ]}
              />
              {config.utility.kind === 'exponential' && (
                <SliderField
                  label="Risk tolerance R"
                  value={config.utility.riskTolerance}
                  onChange={(riskTolerance) => set({ utility: { ...config.utility, riskTolerance } })}
                  min={1}
                  max={1000}
                  step={1}
                  hint="The payoff scale at which risk starts to matter. A small R is strongly risk-averse; drag it down and watch the recommendation change."
                />
              )}
              {config.utility.kind === 'power' && (
                <SliderField
                  label="Relative risk aversion γ"
                  value={config.utility.gamma}
                  onChange={(gamma) => set({ utility: { ...config.utility, gamma } })}
                  min={-2}
                  max={5}
                  step={0.1}
                />
              )}
              {(config.utility.kind === 'power' || config.utility.kind === 'log') && (
                <NumberField
                  label="Payoff shift"
                  value={config.utility.shift}
                  onChange={(shift) => set({ utility: { ...config.utility, shift } })}
                  hint="Added to every payoff before the log or power is taken, because those are undefined at and below zero."
                />
              )}
              <Checkbox
                checked={config.compareRiskNeutral}
                onChange={(compareRiskNeutral) => set({ compareRiskNeutral })}
                label="Show the risk-neutral policy beside it"
                description="The two policies side by side are what makes a flip visible."
              />
            </Card>
          )}

          {mode === 'criteria' && (
            <Card title="Declared optimism">
              <SliderField
                label="Hurwicz α"
                value={config.hurwiczAlpha}
                onChange={(hurwiczAlpha) => set({ hurwiczAlpha })}
                min={0}
                max={1}
                step={0.01}
                hint="α = 0 is maximin, α = 1 is maximax. It is a stated attitude, not a probability of anything."
              />
            </Card>
          )}

          {mode === 'multicriteria' && (
            <Card title="Criteria and weights" hint="Weights are normalised to sum to 1.">
              {config.criteria.map((c, j) => (
                <div key={c.key} style={{ display: 'grid', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
                  <TextField
                    label={`Criterion ${j + 1} label`}
                    value={c.label}
                    onChange={(label) => set({ criteria: config.criteria.map((x, k) => (k === j ? { ...x, label } : x)) })}
                  />
                  <NumberField
                    label={`Weight of ${c.label}`}
                    value={c.weight}
                    onChange={(weight) => set({ criteria: config.criteria.map((x, k) => (k === j ? { ...x, weight } : x)) })}
                    min={0}
                  />
                  <SelectField
                    label={`Direction of ${c.label}`}
                    value={c.direction}
                    onChange={(direction) =>
                      set({
                        criteria: config.criteria.map((x, k) => (k === j ? { ...x, direction: direction as 'benefit' | 'cost' } : x)),
                      })
                    }
                    options={[
                      { value: 'benefit', label: 'Benefit (higher is better)' },
                      { value: 'cost', label: 'Cost (lower is better)' },
                    ]}
                  />
                </div>
              ))}
              <SelectField
                label="Normalisation"
                value={config.normalisation}
                onChange={(normalisation) => set({ normalisation: normalisation as DecisionConfig['normalisation'] })}
                options={[
                  { value: 'range', label: 'Range (min to max becomes 0 to 1)' },
                  { value: 'max', label: 'Divide by the maximum' },
                  { value: 'sum', label: 'Divide by the sum' },
                  { value: 'none', label: 'None (raw values)' },
                ]}
              />
              <div style={{ overflowX: 'auto' }}>
                <table className="oc-table">
                  <caption className="sr-only">Option values by criterion</caption>
                  <thead>
                    <tr>
                      <th scope="col">Option</th>
                      {config.criteria.map((c) => (
                        <th scope="col" key={c.key}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {config.options.map((o, i) => (
                      <tr key={i}>
                        <th scope="row">{o.label}</th>
                        {config.criteria.map((c, j) => (
                          <td key={c.key}>
                            <RawNumberInput
                              value={o.values[j] ?? 0}
                              onChange={(v) =>
                                set({
                                  options: config.options.map((x, k) =>
                                    k === i ? { ...x, values: config.criteria.map((_c, m) => (m === j ? v : x.values[m] ?? 0)) } : x,
                                  ),
                                })
                              }
                              ariaLabel={`${o.label} on ${c.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <AiAssistPanel
            capability="suggestFollowUps"
            context={`Decision analysis of "${config.treeName}" in ${mode} mode: ${config.matrix.actions.length} actions over ${config.matrix.states.length} states, ${config.nodes.length} tree nodes, utility ${config.utility.kind}. Useful follow-ups would name which probability or payoff the recommendation is most sensitive to, and which assumption to try to resolve before committing.`}
          />
        </div>

        <div className="oc-stack">
          {mode === 'tree' && (
            <>
              {!rolled.ok && <Notice tone="error">{rolled.error}</Notice>}
              {rolled.ok && (
                <>
                  <Card title="The rolled-back decision">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Certainty equivalent of the whole decision</span>
                      <span className="oc-result-hero__value">{fmt(rolled.value.certaintyEquivalent, unit)}</span>
                      <span className="oc-result-hero__detail">{rolled.value.utilityLabel}</span>
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Expected value of the optimal policy', value: fmt(rolled.value.expectedValue, unit) },
                        { label: 'Certainty equivalent', value: fmt(rolled.value.certaintyEquivalent, unit) },
                        { label: 'Risk premium (expected value − certainty equivalent)', value: fmt(rolled.value.riskPremium, unit) },
                        { label: 'Exactness of the rollback', value: <Badge variant={rolled.value.provenance.exactness}>{rolled.value.provenance.exactness}</Badge> },
                      ]}
                    />
                  </Card>

                  <Card title="The optimal policy" hint="What to choose at every decision node that can be reached.">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable<PolicyEntry>
                        caption="Optimal choice at each decision node"
                        columns={POLICY_COLUMNS(unit)}
                        rows={rolled.value.policy}
                      />
                    </div>
                  </Card>

                  <Card title="The tree">
                    <div style={{ overflowX: 'auto' }}>
                      <TreeDiagram
                        title={rolled.value.treeName}
                        description="Each node is labelled with the certainty equivalent of continuing optimally from it. The chosen branch at each decision carries a heavier stroke and a marker."
                        root={diagramRoot}
                        valueLabel={unit ? `Certainty equivalent (${unit})` : 'Certainty equivalent'}
                      />
                    </div>
                  </Card>

                  <Card title="Risk profile of the optimal strategy" hint="The full outcome distribution, not only its mean.">
                    <div style={{ overflowX: 'auto' }}>
                      <BarChart
                        title="Outcome distribution"
                        description="Probability of each distinct total payoff under the optimal strategy."
                        data={rolled.value.riskProfile.outcomes.map((o) => ({ x: o.payoff, y: o.probability, label: formatValue(o.payoff, 4) }))}
                        xLabel={unit ? `Total payoff (${unit})` : 'Total payoff'}
                        yLabel="Probability"
                        seriesLabel="Probability of this outcome"
                        asPercent
                      />
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Expected value', value: fmt(rolled.value.riskProfile.expectedValue, unit) },
                        { label: 'Standard deviation', value: fmt(rolled.value.riskProfile.standardDeviation, unit) },
                        { label: 'Worst outcome', value: fmt(rolled.value.riskProfile.min, unit) },
                        { label: 'Best outcome', value: fmt(rolled.value.riskProfile.max, unit) },
                      ]}
                    />
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Percentiles of the outcome distribution"
                        columns={[
                          { key: 'l', header: 'Percentile of outcomes', render: (r) => formatPercent((r as { level: number }).level, 2) },
                          { key: 'v', header: `Payoff (${unit || 'units'})`, numeric: true, render: (r) => formatValue((r as { payoff: number }).payoff, 6) },
                        ]}
                        rows={rolled.value.riskProfile.percentiles}
                      />
                    </div>
                    <Notice tone="info" title="These are percentiles, not a confidence interval">
                      <p>
                        Each row says how likely an outcome at or below that payoff is if this strategy is followed. It is a statement about what can happen,
                        not an interval around an estimated quantity.
                      </p>
                    </Notice>
                  </Card>

                  <Card title="How this was calculated">
                    <ExplanationPanel explanation={explanationOf(rolled.value.provenance, rolled.value.notes)} defaultOpen />
                  </Card>
                </>
              )}
            </>
          )}

          {mode === 'information' && (
            <>
              {!evpi.ok && <Notice tone="error">{evpi.error}</Notice>}
              {!evsi.ok && evpi.ok && <Notice tone="error">{evsi.error}</Notice>}
              {evpi.ok && evsi.ok && (
                <>
                  <Card title="What information is worth">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">EVPI — the most any information could be worth</span>
                      <span className="oc-result-hero__value">{fmt(evpi.value.evpi, matrixUnit)}</span>
                      <span className="oc-result-hero__detail">
                        EVSI of this test: {fmt(evsi.value.evsi, matrixUnit)}
                        {evsi.value.efficiency === null ? '' : ` · ${formatPercent(evsi.value.efficiency, 3)} of EVPI`}
                      </span>
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Best action without any information', value: `${evpi.value.bestActionWithoutInformation.label} — ${fmt(evpi.value.expectedValueBestAction, matrixUnit)}` },
                        { label: 'Expected value with perfect information', value: fmt(evpi.value.expectedValueWithPerfectInformation, matrixUnit) },
                        { label: 'EVPI', value: fmt(evpi.value.evpi, matrixUnit) },
                        { label: 'EVSI of this test', value: fmt(evsi.value.evsi, matrixUnit) },
                        { label: 'Price asked for the test', value: fmt(config.test.cost, matrixUnit) },
                        {
                          label: 'EVSI minus the price',
                          value: fmt(evsi.value.evsi - config.test.cost, matrixUnit),
                        },
                        { label: 'Exactness', value: <Badge variant={evsi.value.provenance.exactness}>{evsi.value.provenance.exactness}</Badge> },
                      ]}
                    />
                    <Notice tone="info" title={`EVPI ≥ EVSI ≥ 0: ${formatValue(evpi.value.evpi, 6)} ≥ ${formatValue(evsi.value.evsi, 6)} ≥ 0`}>
                      <p>
                        Both numbers are upper bounds on what information is worth. They assume the result arrives before the decision is made and is then
                        acted on perfectly. A real study also costs money and takes time, so what it can be worth in practice is less than this, never more.
                      </p>
                      <p>
                        {evsi.value.changesDecision
                          ? 'This test does change the action for at least one of its possible signals, which is why its value is above zero.'
                          : 'This test never changes the action, whatever it says, so its value is exactly zero: there is no price at which it is worth buying.'}
                      </p>
                    </Notice>
                    {evsi.value.evsi < config.test.cost && (
                      <Notice tone="warning">
                        The test is priced above its expected value of information, so on these numbers it should be declined even though its information is
                        genuinely worth something.
                      </Notice>
                    )}
                  </Card>

                  <Card title="What each signal would imply">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Posterior and best action after each signal"
                        columns={[
                          { key: 's', header: 'Signal', render: (r) => (r as SignalRow).signal },
                          { key: 'p', header: 'P(signal)', numeric: true, render: (r) => formatProbability((r as SignalRow).probability) },
                          {
                            key: 'post',
                            header: 'Posterior over states',
                            render: (r) =>
                              (r as SignalRow).posterior.map((p, j) => `${config.matrix.states[j]} ${formatProbability(p)}`).join(' · '),
                          },
                          { key: 'a', header: 'Best action then', render: (r) => (r as SignalRow).bestAction },
                          { key: 'v', header: `Value (${matrixUnit || 'units'})`, numeric: true, render: (r) => formatValue((r as SignalRow).value, 6) },
                        ]}
                        rows={evsi.value.signals}
                      />
                    </div>
                  </Card>

                  <Card title="What perfect information would choose in each state">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Best action in each state under perfect information"
                        columns={[
                          { key: 's', header: 'State', render: (r) => (r as BestByState).state },
                          { key: 'p', header: 'P(state)', numeric: true, render: (r) => formatProbability((r as BestByState).probability) },
                          { key: 'a', header: 'Action', render: (r) => (r as BestByState).action },
                          { key: 'v', header: `Payoff (${matrixUnit || 'units'})`, numeric: true, render: (r) => formatValue((r as BestByState).payoff, 6) },
                        ]}
                        rows={evpi.value.bestActionByState}
                      />
                    </div>
                  </Card>

                  <Card title="How this was calculated">
                    <ExplanationPanel
                      explanation={explanationOf(evsi.value.provenance, [...evsi.value.notes, ...evpi.value.notes])}
                      defaultOpen
                    />
                  </Card>
                </>
              )}
            </>
          )}

          {mode === 'risk' && (
            <>
              {!rolled.ok && <Notice tone="error">{rolled.error}</Notice>}
              {rolled.ok && (
                <>
                  <Card title="The price of risk">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Price of risk (expected value − certainty equivalent)</span>
                      <span className="oc-result-hero__value">{fmt(rolled.value.riskPremium, unit)}</span>
                      <span className="oc-result-hero__detail">{rolled.value.utilityLabel}</span>
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Expected value of the chosen policy', value: fmt(rolled.value.expectedValue, unit) },
                        { label: 'Certainty equivalent — the sure amount you would take instead', value: fmt(rolled.value.certaintyEquivalent, unit) },
                        { label: 'Price of risk: the gap between them', value: fmt(rolled.value.riskPremium, unit) },
                        { label: 'Exactness', value: <Badge variant={rolled.value.provenance.exactness}>{rolled.value.provenance.exactness}</Badge> },
                      ]}
                    />
                    <p className="oc-chart-note">
                      The certainty equivalent is below the expected value by exactly the amount the remaining risk costs this decision maker. Under the linear
                      utility that gap is zero by construction.
                    </p>
                  </Card>

                  {config.compareRiskNeutral && (
                    <Card title="Does the recommendation flip?">
                      {!neutral.ok && <Notice tone="error">{neutral.error}</Notice>}
                      {neutral.ok && (
                        <>
                          <KeyValueList
                            items={[
                              { label: 'Risk-neutral choice at the root', value: neutral.value.policy[0]?.alternativeLabel ?? 'no decision node' },
                              { label: 'Choice under this utility', value: rolled.value.policy[0]?.alternativeLabel ?? 'no decision node' },
                              { label: 'Expected value, risk-neutral policy', value: fmt(neutral.value.expectedValue, unit) },
                              { label: 'Expected value, this policy', value: fmt(rolled.value.expectedValue, unit) },
                            ]}
                          />
                          {rolled.value.policy[0] && neutral.value.policy[0] && (
                            <Notice
                              tone={rolled.value.policy[0].alternativeLabel === neutral.value.policy[0].alternativeLabel ? 'info' : 'warning'}
                              title={
                                rolled.value.policy[0].alternativeLabel === neutral.value.policy[0].alternativeLabel
                                  ? 'Same recommendation'
                                  : 'The recommendation has flipped'
                              }
                            >
                              <p>
                                {rolled.value.policy[0].alternativeLabel === neutral.value.policy[0].alternativeLabel
                                  ? `Both risk neutrality and this risk attitude choose "${rolled.value.policy[0].alternativeLabel}" at the root. Increasing risk aversion further may still change that.`
                                  : `Maximising expected value chooses "${neutral.value.policy[0].alternativeLabel}", while this risk attitude chooses "${rolled.value.policy[0].alternativeLabel}". Neither is a mistake: they are answers to two different questions.`}
                              </p>
                            </Notice>
                          )}
                          <div style={{ overflowX: 'auto' }}>
                            <DataTable<PolicyEntry>
                              caption="Value of each alternative under this utility"
                              columns={POLICY_COLUMNS(unit)}
                              rows={rolled.value.policy}
                            />
                          </div>
                        </>
                      )}
                    </Card>
                  )}

                  <Card title="Risk profile under this policy">
                    <div style={{ overflowX: 'auto' }}>
                      <BarChart
                        title="Outcome distribution"
                        description="Probability of each distinct total payoff under the policy this risk attitude chooses."
                        data={rolled.value.riskProfile.outcomes.map((o) => ({ x: o.payoff, y: o.probability, label: formatValue(o.payoff, 4) }))}
                        xLabel={unit ? `Total payoff (${unit})` : 'Total payoff'}
                        yLabel="Probability"
                        seriesLabel="Probability of this outcome"
                        asPercent
                      />
                    </div>
                  </Card>

                  <Card title="How this was calculated">
                    <ExplanationPanel explanation={explanationOf(rolled.value.provenance, rolled.value.notes)} defaultOpen />
                  </Card>
                </>
              )}
            </>
          )}

          {mode === 'criteria' && (
            <>
              {!noProbability.ok && <Notice tone="error">{noProbability.error}</Notice>}
              {noProbability.ok && (
                <>
                  <Notice
                    tone={noProbability.value.criteriaAgree ? 'info' : 'warning'}
                    title={noProbability.value.criteriaAgree ? 'The criteria agree here' : 'These criteria disagree, and no computation resolves that'}
                  >
                    <p>{noProbability.value.statement}</p>
                  </Notice>

                  <Card title="The five criteria side by side">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable<CriterionResult>
                        caption="Criterion, what it encodes, and what it chooses"
                        columns={[
                          { key: 'n', header: 'Criterion', render: (r) => r.name },
                          { key: 'a', header: 'Attitude it encodes', render: (r) => r.attitude },
                          { key: 'o', header: 'Objective', render: (r) => (r.objective === 'maximise' ? 'maximise the score' : 'minimise the score') },
                          {
                            key: 's',
                            header: 'Scores by action',
                            render: (r) => r.scores.map((s, i) => `${noProbability.value.actions[i]} ${formatValue(s, 5)}`).join(' · '),
                          },
                          {
                            key: 'c',
                            header: 'Chooses',
                            render: (r) => (
                              <>
                                {r.chosenAction}
                                {r.tiedWith.length > 1 ? ` (tied with ${r.tiedWith.map((i) => noProbability.value.actions[i]).join(', ')})` : ''}
                              </>
                            ),
                          },
                        ]}
                        rows={noProbability.value.results}
                      />
                    </div>
                    <p className="oc-chart-note">
                      Distinct actions chosen across the five criteria: {noProbability.value.chosenActions.join(', ')}. Each criterion names the attitude it
                      encodes in the table, so the choice between them is visible as a value judgement rather than hidden in a score.
                    </p>
                  </Card>

                  <Card title="Regret matrix" hint="Hindsight loss against the best action in that state.">
                    <div style={{ overflowX: 'auto' }}>
                      <table className="oc-table">
                        <caption className="sr-only">Regret of each action in each state</caption>
                        <thead>
                          <tr>
                            <th scope="col">Action</th>
                            {noProbability.value.states.map((s) => (
                              <th scope="col" key={s}>
                                {s}
                              </th>
                            ))}
                            <th scope="col">Largest regret</th>
                          </tr>
                        </thead>
                        <tbody>
                          {noProbability.value.actions.map((a, i) => (
                            <tr key={a}>
                              <th scope="row">{a}</th>
                              {noProbability.value.regret.regret[i].map((x, j) => (
                                <td key={j}>{formatValue(x, 5)}</td>
                              ))}
                              <td>{formatValue(noProbability.value.regret.maxRegret[i], 5)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Notice tone="info" items={noProbability.value.regret.notes} />
                  </Card>

                  <Card title="How this was calculated">
                    <ExplanationPanel
                      explanation={explanationOf(noProbability.value.provenance, [
                        ...noProbability.value.notes,
                        ...noProbability.value.results.flatMap((r) => r.notes),
                      ])}
                      defaultOpen
                    />
                  </Card>
                </>
              )}
            </>
          )}

          {mode === 'multicriteria' && (
            <>
              {!weighted.ok && <Notice tone="error">{weighted.error}</Notice>}
              {weighted.ok && (
                <>
                  <Card title="Weighted value model">
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Highest weighted score</span>
                      <span className="oc-result-hero__value">{weighted.value.recommended}</span>
                      <span className="oc-result-hero__detail">{weighted.value.normalisationLabel}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable<ScoredOption>
                        caption="Weighted score and rank of each option"
                        columns={[
                          { key: 'o', header: 'Option', render: (r) => r.label },
                          { key: 'r', header: 'Rank', numeric: true, render: (r) => String(r.rank) },
                          { key: 's', header: 'Score', numeric: true, render: (r) => formatValue(r.score, 5) },
                          { key: 'p', header: 'On the Pareto frontier', render: (r) => (r.onParetoFrontier ? 'yes' : 'no — something dominates it') },
                          {
                            key: 'c',
                            header: 'Contributions',
                            render: (r) => r.contributions.map((c) => `${c.label} ${formatValue(c.contribution, 4)}`).join(' · '),
                          },
                        ]}
                        rows={weighted.value.options}
                      />
                    </div>
                    <Notice tone="warning" title="A weighted score needs weights, and weights are a judgement">
                      <p>
                        The Pareto frontier below needs no weights at all:{' '}
                        {pareto.ok ? pareto.value.frontier.join(', ') : 'it could not be computed for these values'}. Everything beyond the frontier is a
                        statement about how much one objective is worth in units of another, which is yours to make, not the engine's.
                      </p>
                    </Notice>
                    <KeyValueList
                      items={[
                        { label: 'Exactness', value: <Badge variant={weighted.value.provenance.exactness}>{weighted.value.provenance.exactness}</Badge> },
                        ...(weightSens.ok
                          ? [
                              {
                                label: `Weight range of "${weightSens.value.criterionLabel}" that keeps the same winner`,
                                value: `${formatValue(weightSens.value.stableRange.lower, 4)} to ${formatValue(weightSens.value.stableRange.upper, 4)} (now ${formatValue(weightSens.value.currentWeight, 4)})`,
                              },
                            ]
                          : []),
                      ]}
                    />
                    {weighted.value.warnings.length > 0 && <Notice tone="warning" items={weighted.value.warnings} />}
                  </Card>

                  {pareto.ok && pareto.value.dominated.length > 0 && (
                    <Card title="Dominated options">
                      <div style={{ overflowX: 'auto' }}>
                        <DataTable
                          caption="Options something else beats on every criterion"
                          columns={[
                            { key: 'o', header: 'Option', render: (r) => (r as DominatedRow).option },
                            { key: 'b', header: 'Dominated by', render: (r) => (r as DominatedRow).dominatedBy.join(', ') },
                          ]}
                          rows={pareto.value.dominated}
                        />
                      </div>
                    </Card>
                  )}

                  <Card title="How this was calculated">
                    <ExplanationPanel
                      explanation={explanationOf(weighted.value.provenance, [...weighted.value.notes, ...(pareto.ok ? pareto.value.notes : [])])}
                      defaultOpen
                    />
                  </Card>
                </>
              )}
            </>
          )}

          <Card title="Switching point" hint="The input value at which the optimal decision changes.">
            <Segmented
              label="Vary"
              value={config.sensitivityTarget}
              onChange={(sensitivityTarget) => set({ sensitivityTarget })}
              options={[
                { value: 'probability', label: `P(${config.matrix.states[0] ?? 'first state'})` },
                { value: 'payoff', label: 'A payoff' },
              ]}
            />
            {config.sensitivityTarget === 'probability' ? (
              <>
                <SelectField
                  label="First action"
                  value={String(config.sensitivityActionA)}
                  onChange={(v) => set({ sensitivityActionA: Number(v) })}
                  options={actionOptions}
                />
                <SelectField
                  label="Second action"
                  value={String(config.sensitivityActionB)}
                  onChange={(v) => set({ sensitivityActionB: Number(v) })}
                  options={actionOptions}
                />
                {!switching.ok && <Notice tone="error">{switching.error}</Notice>}
                {switching.ok && (
                  <>
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">
                        Switching probability P({config.matrix.states[0] ?? 'first state'})
                      </span>
                      <span className="oc-result-hero__value">{formatProbability(switching.value.probability)}</span>
                      <span className="oc-result-hero__detail">
                        {switching.value.attainable
                          ? `"${switching.value.betterBelow}" below it, "${switching.value.betterAbove}" above it`
                          : 'outside [0, 1], so one action is always better'}
                      </span>
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Value of both actions at the switch', value: fmt(switching.value.valueAtSwitch, matrixUnit) },
                        { label: 'Current P(state)', value: formatProbability(config.matrix.priors[0] ?? 0) },
                        { label: 'Exactness', value: <Badge variant={switching.value.provenance.exactness}>{switching.value.provenance.exactness}</Badge> },
                      ]}
                    />
                    <Notice tone="info" items={switching.value.notes} />
                  </>
                )}
              </>
            ) : (
              <>
                <SelectField
                  label="Payoff of which action"
                  value={String(config.payoffSweep.action)}
                  onChange={(v) => set({ payoffSweep: { ...config.payoffSweep, action: Number(v) } })}
                  options={actionOptions}
                />
                <SelectField
                  label="In which state"
                  value={String(config.payoffSweep.state)}
                  onChange={(v) => set({ payoffSweep: { ...config.payoffSweep, state: Number(v) } })}
                  options={stateOptions}
                />
                <NumberField
                  label="Sweep from"
                  value={config.payoffSweep.low}
                  onChange={(low) => set({ payoffSweep: { ...config.payoffSweep, low } })}
                  unit={matrixUnit || undefined}
                />
                <NumberField
                  label="Sweep to"
                  value={config.payoffSweep.high}
                  onChange={(high) => set({ payoffSweep: { ...config.payoffSweep, high } })}
                  unit={matrixUnit || undefined}
                />
              </>
            )}
            {!sweep.ok && <Notice tone="error">{sweep.error}</Notice>}
            {sweep.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <LineChart
                    title={`Value of each action against ${sweep.value.parameterLabel}`}
                    description="Where two lines cross, the optimal decision changes."
                    series={config.matrix.actions.map((a, i) => ({
                      label: a,
                      points: sweep.value.points.map((p) => ({ x: p.parameterValue, y: p.values[i] })),
                    }))}
                    xLabel={sweep.value.parameterLabel}
                    yLabel={matrixUnit ? `Expected value (${matrixUnit})` : 'Expected value'}
                    referenceLines={sweep.value.switchingPoints.map((s) => ({
                      value: s.parameterValue,
                      label: `switch: ${s.below} → ${s.above}`,
                      axis: 'x' as const,
                    }))}
                  />
                </div>
                <KeyValueList
                  items={[
                    { label: 'Best at the current value', value: sweep.value.baselineBest },
                    {
                      label: 'Distance to the nearest switching point',
                      value:
                        sweep.value.distanceToNearestSwitch === null
                          ? 'no switching point in the range swept'
                          : formatValue(sweep.value.distanceToNearestSwitch, 5),
                    },
                    { label: 'Decision stable over the range', value: sweep.value.decisionIsStable ? 'yes' : 'no' },
                    { label: 'Exactness', value: <Badge variant={sweep.value.provenance.exactness}>{sweep.value.provenance.exactness}</Badge> },
                  ]}
                />
                {sweep.value.switchingPoints.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Switching points found in the range"
                      columns={[
                        { key: 'x', header: sweep.value.parameterLabel, numeric: true, render: (r) => formatValue((r as SwitchRow).parameterValue, 6) },
                        { key: 'b', header: 'Best below', render: (r) => (r as SwitchRow).below },
                        { key: 'a', header: 'Best above', render: (r) => (r as SwitchRow).above },
                        { key: 'v', header: 'Common value', numeric: true, render: (r) => formatValue((r as SwitchRow).valueAtSwitch, 6) },
                        { key: 'e', header: 'Exactness', render: (r) => <Badge variant={(r as SwitchRow).exactness}>{(r as SwitchRow).exactness}</Badge> },
                      ]}
                      rows={sweep.value.switchingPoints}
                    />
                  </div>
                )}
                <ExplanationPanel explanation={explanationOf(sweep.value.provenance, sweep.value.notes)} />
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ small pieces */

interface SignalRow {
  signal: string;
  probability: number;
  posterior: number[];
  bestAction: string;
  value: number;
}

interface BestByState {
  state: string;
  probability: number;
  action: string;
  payoff: number;
}

interface DominatedRow {
  option: string;
  dominatedBy: string[];
}

interface SwitchRow {
  parameterValue: number;
  below: string;
  above: string;
  valueAtSwitch: number;
  exactness: 'exact' | 'numerical';
}

const MODE_HINT: Record<DecisionMode, string> = {
  tree: 'Rollback on a sequence of decisions and uncertainties: the optimal policy, its certainty equivalent and the full distribution of outcomes it leads to.',
  information: 'What it would be worth to know more before deciding — the ceiling (EVPI) and what one imperfect test captures of it (EVSI).',
  risk: 'How the recommendation depends on attitude to risk, and what the remaining risk costs in payoff units.',
  criteria: 'When probabilities genuinely cannot be stated: five criteria, each encoding a different attitude, which need not agree.',
  multicriteria: 'Several objectives at once: the Pareto frontier, which needs no weights, and a weighted score, which does.',
};

function POLICY_COLUMNS(unit: string): ColumnDef<PolicyEntry>[] {
  return [
    { key: 'n', header: 'At this decision', render: (r) => r.nodeLabel },
    { key: 'c', header: 'Choose', render: (r) => r.alternativeLabel },
    {
      key: 'v',
      header: unit ? `Certainty equivalent of each alternative (${unit})` : 'Certainty equivalent of each alternative',
      render: (r) => r.alternativeValues.map((a) => `${a.label} ${formatValue(a.certaintyEquivalent, 5)}`).join(' · '),
    },
    { key: 'p', header: 'Probability of reaching it', numeric: true, render: (r) => formatProbability(r.reachProbability) },
  ];
}
