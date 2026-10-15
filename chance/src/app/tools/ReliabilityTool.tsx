/**
 * Reliability and system failure analysis: "will this system hold?".
 *
 * Four modes over one engine family — system structures, fault trees,
 * time-dependent reliability/availability, and censored-data fitting.
 *
 * Two editorial decisions run through the whole screen:
 *  - Every structure answer assumes components fail independently, which is
 *    almost always false and almost always the largest error in the number.
 *    The independence contrast panel is therefore shown next to the result in
 *    both structure and lifetime modes, not hidden in an appendix.
 *  - Several importance measures divide by a quantity that can be zero and so
 *    come back as the engine's `Moment` shape. An undefined measure is printed
 *    as "not defined" with the engine's own reason listed underneath; it is
 *    never shown as 0, blank or NaN.
 */
import { useMemo } from 'react';
import {
  availability,
  bridgeNetwork,
  classifyWeibullShape,
  cumulativeHazard,
  esaryProschanBounds,
  faultTreeProbability,
  fitExponentialCensored,
  fitWeibullCensored,
  hazardAt,
  importanceMeasures,
  betaFactorCommonCause,
  lifetimeModel,
  minimalCutSets,
  minimalPathSets,
  mttf,
  networkMinimalCuts,
  networkMinimalPaths,
  networkReliability,
  networkReliabilityByFactoring,
  prepareSample,
  rareEventApproximation,
  redundancyReliability,
  reliabilityAt,
  systemReliability,
  weibullProbabilityPlot,
  type ComponentImportance,
  type FaultTree,
  type FaultTreeNode,
  type LifetimeObservation,
  type RareEventResult,
  type Reliabilities,
  type Structure,
} from '../../engine/reliability';
import { EngineError, type Explanation } from '../../engine/core/result';
import type { Moment } from '../../engine/distributions/types';
import {
  Badge,
  Button,
  Card,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  RawNumberInput,
  Segmented,
  SelectField,
  SliderField,
  TextField,
} from '../../ui/primitives';
import { LineChart } from '../../ui/charts/charts';
import { NetworkGraph, QQChart, TreeDiagram, type TreeNode } from '../../ui/charts/advanced';
import { formatPercent, formatProbability, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------------ config */

export type ReliabilityMode = 'structure' | 'fault-tree' | 'lifetime' | 'fit';

/** Structure presets, all over the same five component ids. */
export type StructurePreset = 'series' | 'parallel' | 'kofn' | 'series-parallel' | 'bridge';

export interface ReliabilityConfig {
  mode: ReliabilityMode;
  /**
   * The structure is stored as a preset name plus the per-component numbers,
   * not as the engine's nested `Structure` object: a flat description is
   * smaller in IndexedDB, trivially clonable, and cannot drift out of the
   * shape the engine validates. The nested form is rebuilt in a `useMemo`.
   */
  structure: {
    preset: StructurePreset;
    /** k for the k-of-n preset. */
    k: number;
    reliabilities: Record<string, number>;
  };
  /** Shared by the redundancy comparison and the common-cause contrast. */
  redundancy: {
    units: number;
    failureRate: number;
    time: number;
    /** Common-cause fraction β: the share of the failure rate that hits every unit at once. */
    beta: number;
    switchSuccessProbability: number;
  };
  faultTree: {
    preset: 'cooling' | 'cyclic';
    /** k of the k-of-n gate in the cooling preset. */
    k: number;
    probabilities: Record<string, number>;
  };
  lifetime: {
    family: 'weibull' | 'exponential';
    /** Weibull shape β. */
    shape: number;
    /** Weibull scale (characteristic life) η. */
    scale: number;
    /** Exponential rate λ. */
    rate: number;
    horizon: number;
    mtbf: number;
    mttr: number;
  };
  fit: {
    /** Lifetimes, comma or newline separated; a trailing "+" marks a censored unit. */
    data: string;
    level: number;
  };
}

export const COMPONENT_IDS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;
const FAULT_EVENT_IDS = ['e1', 'e2', 'e3', 'e4', 'e5'] as const;

/**
 * The default is a 5-component series–parallel system at r = 0.9, which gives
 * a correct non-obvious answer, a full set of importance measures and a
 * meaningful independence contrast with no input at all. The bridge network is
 * one click away in the preset list.
 */
export const RELIABILITY_DEFAULT: ReliabilityConfig = {
  mode: 'structure',
  structure: {
    preset: 'series-parallel',
    k: 3,
    reliabilities: { c1: 0.9, c2: 0.9, c3: 0.9, c4: 0.9, c5: 0.9 },
  },
  // λt = 0.1 with three units: the common-cause floor then dominates the
  // independent answer by about 6.6x at β = 0.05, which is the point of the
  // contrast panel and is visible with no input at all.
  redundancy: { units: 3, failureRate: 0.0001, time: 1000, beta: 0.05, switchSuccessProbability: 1 },
  faultTree: {
    preset: 'cooling',
    k: 2,
    probabilities: { e1: 0.02, e2: 0.03, e3: 0.05, e4: 0.05, e5: 0.08 },
  },
  lifetime: { family: 'weibull', shape: 2.2, scale: 1200, rate: 0.001, horizon: 2500, mtbf: 1200, mttr: 8 },
  fit: {
    data: '31, 58, 157, 185, 213+, 213+, 234, 280, 300+, 300+',
    level: 0.95,
  },
};

const MODE_OPTIONS: { value: ReliabilityMode; label: string }[] = [
  { value: 'structure', label: 'System structure' },
  { value: 'fault-tree', label: 'Fault tree' },
  { value: 'lifetime', label: 'Lifetime & availability' },
  { value: 'fit', label: 'Censored data fit' },
];

const PRESET_OPTIONS: { value: StructurePreset; label: string }[] = [
  { value: 'series-parallel', label: 'Series–parallel: c1 then (c2∥c3) then (c4∥c5)' },
  { value: 'series', label: 'Series: all five must work' },
  { value: 'parallel', label: 'Parallel: any one of five is enough' },
  { value: 'kofn', label: 'k-of-5: at least k of the five must work' },
  { value: 'bridge', label: 'Bridge network (5 components, not series–parallel)' },
];

/* ----------------------------------------------------------------- helpers */

/** Builds the engine's nested structure from the flat stored description. */
function buildStructure(preset: StructurePreset, k: number): Structure {
  const comp = (id: string): Structure => ({ kind: 'component', id });
  switch (preset) {
    case 'series':
      return { kind: 'series', children: COMPONENT_IDS.map(comp) };
    case 'parallel':
      return { kind: 'parallel', children: COMPONENT_IDS.map(comp) };
    case 'kofn':
      return { kind: 'kofn', k, children: COMPONENT_IDS.map(comp) };
    case 'series-parallel':
    case 'bridge':
    default:
      // The bridge has no series–parallel form; this is the structure used for
      // the measures that need one, and the panel says so explicitly.
      return {
        kind: 'series',
        children: [
          comp('c1'),
          { kind: 'parallel', children: [comp('c2'), comp('c3')] },
          { kind: 'parallel', children: [comp('c4'), comp('c5')] },
        ],
      };
  }
}

function buildFaultTree(config: ReliabilityConfig['faultTree']): FaultTree {
  const p = config.probabilities;
  if (config.preset === 'cyclic') {
    // Deliberately malformed, to show that a cyclic tree is refused with the
    // cycle named rather than answered.
    const nodes: FaultTreeNode[] = [
      { id: 'top', kind: 'or', children: ['g-power'], label: 'Cooling lost' },
      { id: 'g-power', kind: 'and', children: ['top', 'e1'], label: 'Power lost' },
      { id: 'e1', kind: 'basic', probability: p.e1, label: 'Grid supply fails' },
    ];
    return { topId: 'top', nodes };
  }
  const nodes: FaultTreeNode[] = [
    { id: 'top', kind: 'or', children: ['g-power', 'g-pumps'], label: 'Cooling lost' },
    { id: 'g-power', kind: 'and', children: ['e1', 'e2'], label: 'Both power sources lost' },
    { id: 'g-pumps', kind: 'kofn', k: config.k, children: ['e3', 'e4', 'e5'], label: 'Too few pumps running' },
    { id: 'e1', kind: 'basic', probability: p.e1, label: 'Grid supply fails' },
    { id: 'e2', kind: 'basic', probability: p.e2, label: 'Diesel generator fails' },
    { id: 'e3', kind: 'basic', probability: p.e3, label: 'Pump A fails' },
    { id: 'e4', kind: 'basic', probability: p.e4, label: 'Pump B fails' },
    { id: 'e5', kind: 'basic', probability: p.e5, label: 'Pump C fails' },
  ];
  return { topId: 'top', nodes };
}

/** `+`, `c` or `C` suffix marks a right-censored (still running) unit. */
function parseObservations(text: string): LifetimeObservation[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const censored = /[+cC]$/.test(token);
      const raw = censored ? token.slice(0, -1) : token;
      return { time: Number(raw), failed: !censored };
    });
}

function messageOf(error: unknown): string {
  if (error instanceof EngineError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The computation failed for an unknown reason.';
}

/** A Moment is printed as a number or as "not defined"; never as 0 or blank. */
function momentText(m: Moment, digits = 4): string {
  return m.defined ? formatValue(m.value, digits) : 'not defined';
}

/** Collects the engine's own reasons for every undefined measure, deduplicated. */
function undefinedReasons(components: readonly ComponentImportance[]): string[] {
  const reasons = new Set<string>();
  const add = (id: string, label: string, m: Moment): void => {
    if (!m.defined) reasons.add(`${label} for "${id}" is not defined: ${m.reason}.`);
  };
  for (const c of components) {
    add(c.id, 'Criticality', c.criticality);
    add(c.id, 'Fussell–Vesely', c.fussellVesely);
    add(c.id, 'Risk achievement worth', c.riskAchievementWorth);
    add(c.id, 'Risk reduction worth', c.riskReductionWorth);
  }
  return [...reasons];
}

const SET_STYLE = { fontFamily: 'var(--font-mono)', fontSize: 11.5, margin: 0, overflowWrap: 'anywhere' } as const;

function SetList({ sets, empty }: { sets: readonly string[][]; empty: string }) {
  if (!sets.length) return <p className="oc-muted" style={{ fontSize: 12.5, margin: 0 }}>{empty}</p>;
  return (
    <ul style={{ ...SET_STYLE, listStyle: 'none', padding: 0 }}>
      {sets.map((s, i) => (
        <li key={i}>{`{${s.join(', ')}}`}</li>
      ))}
    </ul>
  );
}

/** Fault tree nodes as a diagram tree. Safe to recurse: the tree is validated acyclic first. */
function toTreeNode(nodes: ReadonlyMap<string, FaultTreeNode>, id: string, depth: number): TreeNode {
  const node = nodes.get(id);
  if (!node) return { id, kind: 'terminal', label: id };
  if (node.kind === 'basic') {
    // `value` only, not `probability`: a branch probability here would make the
    // diagram multiply gate inputs together, which is not what a gate means.
    return { id, kind: 'terminal', label: `${node.label ?? id} (p = ${formatProbability(node.probability)})`, value: node.probability };
  }
  const gate = node.kind === 'kofn' ? `${node.k}-of-${node.children.length}` : node.kind.toUpperCase();
  return {
    id,
    kind: 'chance',
    label: `${node.label ?? id} — ${gate} gate`,
    children: depth >= 12 ? [] : node.children.map((child) => toTreeNode(nodes, child, depth + 1)),
  };
}

/* -------------------------------------------------------------------- tool */

export function ReliabilityTool({ config }: { config: ReliabilityConfig }) {
  const app = useApp();
  const set = (patch: Partial<ReliabilityConfig>) => app.updateConfig({ ...config, ...patch });

  const reliabilities: Reliabilities = config.structure.reliabilities;
  const structure = useMemo(() => buildStructure(config.structure.preset, config.structure.k), [config.structure.preset, config.structure.k]);
  const isBridge = config.structure.preset === 'bridge';

  // --- system structure -----------------------------------------------------
  const structureResult = useMemo(() => {
    try {
      if (isBridge) {
        const network = bridgeNetwork([...COMPONENT_IDS]);
        const exact = networkReliability(network, reliabilities);
        return {
          ok: true as const,
          reliability: exact.reliability,
          unreliability: exact.unreliability,
          exactness: exact.exactness,
          independenceAssumed: exact.independenceAssumed,
          independenceNote: exact.independenceNote,
          explanation: exact.explanation,
          paths: networkMinimalPaths(network),
          cuts: networkMinimalCuts(network),
          network,
          // A second, independent route to the same number: pivotal
          // decomposition rather than inclusion–exclusion.
          crossCheck: networkReliabilityByFactoring(network, reliabilities),
        };
      }
      const result = systemReliability(structure, reliabilities);
      return {
        ok: true as const,
        reliability: result.reliability,
        unreliability: result.unreliability,
        exactness: result.exactness,
        independenceAssumed: result.independenceAssumed,
        independenceNote: result.independenceNote,
        explanation: result.explanation,
        paths: minimalPathSets(structure),
        cuts: minimalCutSets(structure),
        network: null,
        crossCheck: null,
      };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [isBridge, structure, reliabilities]);

  const bounds = useMemo(() => {
    // Esary–Proschan bounds are defined by the engine over a series/parallel/
    // k-of-n structure, so the bridge (which has no such form) gets no bounds.
    if (isBridge) return { ok: false as const, error: null };
    try {
      return { ok: true as const, value: esaryProschanBounds(structure, reliabilities) };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [isBridge, structure, reliabilities]);

  const importance = useMemo(() => {
    try {
      return { ok: true as const, value: importanceMeasures(structure, reliabilities) };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [structure, reliabilities]);

  // --- independence contrast ------------------------------------------------
  const commonCause = useMemo(() => {
    try {
      const { units, failureRate, time, beta } = config.redundancy;
      return {
        ok: true as const,
        coupled: betaFactorCommonCause({ units, failureRate, time, beta }),
        // β = 0 is the same model with the independence assumption in force,
        // which is what makes the two columns comparable.
        independent: betaFactorCommonCause({ units, failureRate, time, beta: 0 }),
      };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [config.redundancy]);

  // --- fault tree -----------------------------------------------------------
  const faultTree = useMemo(() => buildFaultTree(config.faultTree), [config.faultTree]);
  const faultTreeResult = useMemo(() => {
    try {
      const exact = faultTreeProbability(faultTree);
      const nodes = new Map(faultTree.nodes.map((n) => [n.id, n]));
      let rare: { value: number; note: string } | null = null;
      let rareError: string | null = null;
      try {
        const approx = rareEventApproximationSafe(faultTree);
        rare = approx.ok ? { value: approx.value.value, note: approx.value.note } : null;
        rareError = approx.ok ? null : approx.error;
      } catch (e) {
        rareError = messageOf(e);
      }
      return { ok: true as const, exact, rare, rareError, root: toTreeNode(nodes, faultTree.topId, 0) };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [faultTree]);

  // --- lifetime & availability ---------------------------------------------
  const lifetime = useMemo(() => {
    const { family, shape, scale, rate, horizon } = config.lifetime;
    try {
      const model = family === 'weibull' ? lifetimeModel('weibull', { k: shape, lambda: scale }) : lifetimeModel('exponential', { lambda: rate });
      const steps = 120;
      const reliabilityPoints: { x: number; y: number }[] = [];
      const hazardPoints: { x: number; y: number }[] = [];
      const cumulativePoints: { x: number; y: number }[] = [];
      for (let i = 0; i <= steps; i += 1) {
        // t = 0 is skipped for the hazard: a Weibull with β < 1 has an
        // infinite hazard there, which is a true value but not a plottable one.
        const t = (horizon * i) / steps;
        reliabilityPoints.push({ x: t, y: reliabilityAt(model, t) });
        cumulativePoints.push({ x: t, y: cumulativeHazard(model, t) });
        if (i > 0) hazardPoints.push({ x: t, y: hazardAt(model, t) });
      }
      // The bathtub reading is a statement about the Weibull shape; the
      // exponential is exactly the β = 1 case, and is labelled as such.
      const bathtub = classifyWeibullShape(family === 'weibull' ? shape : 1);
      return {
        ok: true as const,
        mttf: mttf(model),
        reliabilityPoints,
        hazardPoints,
        cumulativePoints,
        bathtub,
        shapeIsGiven: family === 'weibull',
      };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [config.lifetime]);

  const availabilityResult = useMemo(() => {
    try {
      return { ok: true as const, value: availability(config.lifetime.mtbf, config.lifetime.mttr, config.redundancy.time) };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [config.lifetime.mtbf, config.lifetime.mttr, config.redundancy.time]);

  const redundancy = useMemo(() => {
    const { units, failureRate, time, switchSuccessProbability } = config.redundancy;
    try {
      return {
        ok: true as const,
        active: redundancyReliability({ mode: 'active', units, failureRate, time }),
        cold: redundancyReliability({ mode: 'cold-standby', units, failureRate, time, switchSuccessProbability }),
      };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [config.redundancy]);

  // --- censored fit ---------------------------------------------------------
  const observations = useMemo(() => parseObservations(config.fit.data), [config.fit.data]);
  const fit = useMemo(() => {
    try {
      const sample = prepareSample(observations);
      const exponential = fitExponentialCensored(observations, config.fit.level);
      let weibull: ReturnType<typeof fitWeibullCensored> | null = null;
      let weibullError: string | null = null;
      try {
        weibull = fitWeibullCensored(observations);
      } catch (e) {
        weibullError = messageOf(e);
      }
      let plot: ReturnType<typeof weibullProbabilityPlot> | null = null;
      let plotError: string | null = null;
      try {
        plot = weibullProbabilityPlot(observations);
      } catch (e) {
        plotError = messageOf(e);
      }
      return { ok: true as const, sample, exponential, weibull, weibullError, plot, plotError };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [observations, config.fit.level]);

  /** The explanation shown for the current mode, built from engine output only. */
  const explanation = useMemo<Explanation | null>(() => {
    if (config.mode === 'structure') return structureResult.ok ? structureResult.explanation : null;
    if (config.mode === 'fault-tree') return faultTreeResult.ok ? faultTreeResult.exact.explanation : null;
    if (config.mode === 'lifetime') {
      if (!lifetime.ok) return null;
      return {
        method: 'Closed-form reliability, hazard and cumulative hazard of the chosen lifetime law, with steady-state availability',
        formula: 'R(t) = e^{−H(t)};  h(t) = f(t)/R(t);  A = MTBF/(MTBF+MTTR)',
        steps: [
          { label: 'MTTF', expression: lifetime.mttf.formula, value: formatValue(lifetime.mttf.mttf, 6) },
          { label: 'Bathtub regime from the Weibull shape', value: lifetime.bathtub.headline },
        ],
        assumptions: availabilityResult.ok ? availabilityResult.value.assumptions : ['Availability could not be computed from the MTBF/MTTR given.'],
        limitations: [
          'The hazard, MTTF and availability describe one item, not the system: combining items needs the structure mode.',
          'Availability assumes repair begins immediately, with no logistic delay and no shared repair crew.',
        ],
        exactness: 'exact',
      };
    }
    if (!fit.ok) return null;
    return {
      method: 'Maximum likelihood with right censoring: exponential in closed form, Weibull by profiling the scale and solving for the shape',
      formula: fit.weibull ? fit.weibull.formula : fit.exponential.formula,
      steps: [
        { label: 'Failures observed', value: String(fit.sample.failures) },
        { label: 'Right-censored units', value: String(fit.sample.censored) },
        { label: 'Total time on test', value: formatValue(fit.sample.totalTimeOnTest, 6) },
        { label: 'Exponential rate λ̂', expression: fit.exponential.formula, value: formatValue(fit.exponential.rate, 6) },
      ],
      assumptions: [
        'Censoring is independent of the failure mechanism (a unit still running tells us only that it survived its time on test).',
        'All units come from one population with one lifetime law.',
      ],
      limitations: [
        ...fit.exponential.notes,
        ...(fit.weibull ? fit.weibull.notes : []),
        'The Weibull shape and scale are found by a root search, so they are numerical rather than exact.',
      ],
      exactness: config.mode === 'fit' && fit.weibull ? 'numerical' : 'exact',
    };
  }, [config.mode, structureResult, faultTreeResult, lifetime, availabilityResult, fit]);

  const setStructure = (patch: Partial<ReliabilityConfig['structure']>) => set({ structure: { ...config.structure, ...patch } });
  const setRedundancy = (patch: Partial<ReliabilityConfig['redundancy']>) => set({ redundancy: { ...config.redundancy, ...patch } });

  return (
    <>
      <ToolHeader toolId="reliability" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What are you analysing?">
            <Segmented
              label="Reliability analysis mode"
              value={config.mode}
              onChange={(mode) => set({ mode })}
              options={MODE_OPTIONS}
            />
            <p className="oc-chart-note">
              {config.mode === 'structure' && 'Combine component reliabilities into a system reliability, exactly.'}
              {config.mode === 'fault-tree' && 'Work downwards from an undesired top event through AND / OR / k-of-n gates.'}
              {config.mode === 'lifetime' && 'Reliability, hazard and availability as functions of time for one repairable or non-repairable item.'}
              {config.mode === 'fit' && 'Estimate a lifetime law from test data in which some units had not failed when the test stopped.'}
            </p>
          </Card>

          {config.mode === 'structure' && (
            <Card title="Structure and component reliabilities">
              <SelectField
                label="System structure"
                value={config.structure.preset}
                onChange={(preset) => setStructure({ preset })}
                options={PRESET_OPTIONS}
                hint="The bridge network cannot be written as nested series and parallel blocks; it needs the exact network method."
              />
              {config.structure.preset === 'kofn' && (
                <NumberField
                  label="Components that must work"
                  symbol="k"
                  value={config.structure.k}
                  onChange={(k) => setStructure({ k })}
                  min={1}
                  max={COMPONENT_IDS.length}
                  integer
                />
              )}
              <div style={{ display: 'grid', gap: 'var(--s2)' }}>
                {COMPONENT_IDS.map((id) => (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 12.5 }}>
                    <span style={{ width: 90, flex: '0 0 auto' }}>Reliability of {id}</span>
                    <RawNumberInput
                      value={reliabilities[id] ?? 0}
                      onChange={(value) => setStructure({ reliabilities: { ...config.structure.reliabilities, [id]: value } })}
                      ariaLabel={`Reliability of component ${id}`}
                      min={0}
                      max={1}
                    />
                  </label>
                ))}
              </div>
              <div className="oc-btn-row" style={{ marginTop: 'var(--s3)' }}>
                <Button
                  onClick={() => setStructure({ preset: 'bridge', reliabilities: { c1: 0.9, c2: 0.9, c3: 0.9, c4: 0.9, c5: 0.9 } })}
                >
                  Load the classic bridge at r = 0.9
                </Button>
              </div>
              <p className="oc-chart-note">
                The bridge at r = 0.9 has the textbook exact answer 0.97848, which is a useful check that the exact network
                method is being used rather than a series–parallel shortcut.
              </p>
            </Card>
          )}

          {config.mode === 'fault-tree' && (
            <Card title="Fault tree">
              <SelectField
                label="Tree"
                value={config.faultTree.preset}
                onChange={(preset) => set({ faultTree: { ...config.faultTree, preset } })}
                options={[
                  { value: 'cooling', label: 'Cooling lost: OR of (both power sources) and (k-of-3 pumps)' },
                  { value: 'cyclic', label: 'A cyclic tree (shows how a malformed tree is refused)' },
                ]}
              />
              <NumberField
                label="Pump failures needed to lose cooling"
                symbol="k"
                value={config.faultTree.k}
                onChange={(k) => set({ faultTree: { ...config.faultTree, k } })}
                min={1}
                max={3}
                integer
                hint="k of the 3 pumps failing is enough for the pump branch to be satisfied."
              />
              <div style={{ display: 'grid', gap: 'var(--s2)' }}>
                {FAULT_EVENT_IDS.map((id) => (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 12.5 }}>
                    <span style={{ width: 120, flex: '0 0 auto' }}>P({id})</span>
                    <RawNumberInput
                      value={config.faultTree.probabilities[id] ?? 0}
                      onChange={(value) => set({ faultTree: { ...config.faultTree, probabilities: { ...config.faultTree.probabilities, [id]: value } } })}
                      ariaLabel={`Probability of basic event ${id}`}
                      min={0}
                      max={1}
                    />
                  </label>
                ))}
              </div>
            </Card>
          )}

          {config.mode === 'lifetime' && (
            <Card title="Lifetime law, mission and repair">
              <SelectField
                label="Lifetime distribution"
                value={config.lifetime.family}
                onChange={(family) => set({ lifetime: { ...config.lifetime, family } })}
                options={[
                  { value: 'weibull', label: 'Weibull (shape β, scale η)' },
                  { value: 'exponential', label: 'Exponential (constant rate λ)' },
                ]}
              />
              {config.lifetime.family === 'weibull' ? (
                <>
                  <SliderField
                    label="Weibull shape"
                    symbol="β"
                    value={config.lifetime.shape}
                    onChange={(shape) => set({ lifetime: { ...config.lifetime, shape } })}
                    min={0.2}
                    max={6}
                    step={0.05}
                    hint="Below 1 is infant mortality, 1 is constant random failure, above 1 is wear-out."
                  />
                  <NumberField
                    label="Characteristic life"
                    symbol="η"
                    value={config.lifetime.scale}
                    onChange={(scale) => set({ lifetime: { ...config.lifetime, scale } })}
                    min={0.000001}
                    unit="hours"
                  />
                </>
              ) : (
                <NumberField
                  label="Failure rate"
                  symbol="λ"
                  value={config.lifetime.rate}
                  onChange={(rate) => set({ lifetime: { ...config.lifetime, rate } })}
                  min={0.0000001}
                  unit="per hour"
                />
              )}
              <NumberField
                label="Time horizon for the curves"
                value={config.lifetime.horizon}
                onChange={(horizon) => set({ lifetime: { ...config.lifetime, horizon } })}
                min={0.000001}
                unit="hours"
              />
              <NumberField label="MTBF" value={config.lifetime.mtbf} onChange={(mtbf) => set({ lifetime: { ...config.lifetime, mtbf } })} min={0.000001} unit="hours" />
              <NumberField label="MTTR" value={config.lifetime.mttr} onChange={(mttr) => set({ lifetime: { ...config.lifetime, mttr } })} min={0.000001} unit="hours" />
            </Card>
          )}

          {config.mode === 'fit' && (
            <Card title="Test data">
              <TextField
                label="Lifetimes"
                value={config.fit.data}
                onChange={(data) => set({ fit: { ...config.fit, data } })}
                multiline
                rows={5}
                monospace
                hint='One time per unit, comma or newline separated. Add a trailing "+" for a unit that had not failed when the test stopped, e.g. "213+".'
              />
              <SliderField
                label="Confidence level for the rate interval"
                value={config.fit.level}
                onChange={(level) => set({ fit: { ...config.fit, level } })}
                min={0.5}
                max={0.999}
                step={0.005}
                hint="This interval is for the estimated rate, not a range of future lifetimes."
              />
            </Card>
          )}

          {(config.mode === 'structure' || config.mode === 'lifetime') && (
            <Card title="Redundant units and their coupling" variant="inset">
              <NumberField label="Redundant units" symbol="n" value={config.redundancy.units} onChange={(units) => setRedundancy({ units })} min={1} max={20} integer />
              <NumberField label="Failure rate per unit" symbol="λ" value={config.redundancy.failureRate} onChange={(failureRate) => setRedundancy({ failureRate })} min={0.0000001} unit="per hour" />
              <NumberField label="Mission time" symbol="t" value={config.redundancy.time} onChange={(time) => setRedundancy({ time })} min={0} unit="hours" />
              <SliderField
                label="Common-cause fraction"
                symbol="β"
                value={config.redundancy.beta}
                onChange={(beta) => setRedundancy({ beta })}
                min={0}
                max={0.5}
                step={0.005}
                hint="The share of the failure rate that takes every unit out at once. Engineering judgement, typically 0.01–0.2."
              />
              {config.mode === 'lifetime' && (
                <SliderField
                  label="Standby switch success probability"
                  value={config.redundancy.switchSuccessProbability}
                  onChange={(switchSuccessProbability) => setRedundancy({ switchSuccessProbability })}
                  min={0}
                  max={1}
                  step={0.005}
                />
              )}
            </Card>
          )}

          <AiAssistPanel
            capability="suggestFollowUps"
            context={`Reliability analysis in ${config.mode} mode. Useful follow-ups: raise the common-cause factor β and watch redundancy stop helping; compare the Esary–Proschan bounds with the exact structure value; check whether the rare-event approximation is still close; re-fit the censored data ignoring the censoring flags to see the downward bias.`}
          />
        </div>

        <div className="oc-stack">
          {/* ---------------------------------------------------- structure */}
          {config.mode === 'structure' && (
            <>
              <Card title="System reliability">
                {!structureResult.ok && <Notice tone="error">{structureResult.error}</Notice>}
                {structureResult.ok && (
                  <>
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">Probability the system works</span>
                      <span className="oc-result-hero__value">{formatValue(structureResult.reliability, 6)}</span>
                      <span className="oc-result-hero__detail">
                        Failure probability {formatValue(structureResult.unreliability, 6)} · {formatPercent(structureResult.reliability)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                      <Badge variant={structureResult.exactness}>{structureResult.exactness === 'exact' ? 'Exact' : 'Numerical'}</Badge>
                      <span style={{ fontSize: 12.5 }}>{structureResult.explanation.method}</span>
                    </div>
                    {structureResult.crossCheck !== null && (
                      <KeyValueList
                        items={[
                          { label: 'By inclusion–exclusion over paths', value: formatValue(structureResult.reliability, 10) },
                          { label: 'By pivotal decomposition (independent route)', value: formatValue(structureResult.crossCheck, 10) },
                        ]}
                      />
                    )}
                    {structureResult.network && (
                      <div style={{ overflowX: 'auto' }}>
                        <NetworkGraph
                          title="Bridge network"
                          description="Source s to sink t through five components; the cross-link c3 is what stops this being a series–parallel system."
                          nodes={[
                            { id: 's', label: 'Source s', layer: 0 },
                            { id: 'a', label: 'a', layer: 1 },
                            { id: 'b', label: 'b', layer: 1 },
                            { id: 't', label: 'Sink t', layer: 2 },
                          ]}
                          edges={structureResult.network.edges.map((e) => ({ from: e.from, to: e.to, label: e.id }))}
                          note="Nodes are assumed perfectly reliable; only the lettered edge components can fail."
                        />
                      </div>
                    )}
                    <Notice tone={structureResult.independenceAssumed ? 'warning' : 'info'} title={structureResult.independenceAssumed ? 'Independence was assumed' : 'Dependence was modelled'}>
                      <p style={{ margin: 0 }}>{structureResult.independenceNote}</p>
                    </Notice>
                  </>
                )}
              </Card>

              {structureResult.ok && (
                <Card title="Minimal cut sets and path sets" hint="A cut set is a set of components whose joint failure fails the system; a path set is a set whose joint survival carries it.">
                  <div style={{ display: 'grid', gap: 'var(--s3)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                    <div>
                      <h3 style={{ fontSize: 12.5, margin: '0 0 var(--s2)' }}>Minimal cut sets ({structureResult.cuts.length})</h3>
                      <SetList sets={structureResult.cuts} empty="No cut sets were enumerated." />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 12.5, margin: '0 0 var(--s2)' }}>Minimal path sets ({structureResult.paths.length})</h3>
                      <SetList sets={structureResult.paths} empty="No path sets were enumerated." />
                    </div>
                  </div>
                </Card>
              )}

              <Card title="Esary–Proschan bounds — these are bounds, not the answer">
                {isBridge && (
                  <Notice tone="info">
                    <p style={{ margin: 0 }}>
                      The engine defines these bounds over a series, parallel or k-of-n structure. The bridge has no such
                      form, so no bounds are shown for it — the exact network value above is used instead.
                    </p>
                  </Notice>
                )}
                {!isBridge && !bounds.ok && bounds.error && <Notice tone="error">{bounds.error}</Notice>}
                {bounds.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Lower bound (minimal cut form)', value: formatValue(bounds.value.lower, 8) },
                        { label: 'Exact system reliability', value: structureResult.ok ? formatValue(structureResult.reliability, 8) : 'unavailable' },
                        { label: 'Upper bound (minimal path form)', value: formatValue(bounds.value.upper, 8) },
                        { label: 'Width of the bound', value: formatValue(bounds.value.upper - bounds.value.lower, 4) },
                      ]}
                    />
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--s3) 0' }}>
                      <Badge variant={bounds.value.exactness}>Bounds, not a value</Badge>
                    </div>
                    <p className="oc-chart-note">{bounds.value.note}</p>
                  </>
                )}
              </Card>

              <ImportanceCard importance={importance} isBridge={isBridge} />
              <IndependenceCard commonCause={commonCause} beta={config.redundancy.beta} />
            </>
          )}

          {/* --------------------------------------------------- fault tree */}
          {config.mode === 'fault-tree' && (
            <>
              <Card title="Top event probability">
                {!faultTreeResult.ok && (
                  <Notice tone="error" title="This fault tree was refused">
                    <p style={{ margin: 0 }}>{faultTreeResult.error}</p>
                  </Notice>
                )}
                {faultTreeResult.ok && (
                  <>
                    <div className="oc-result-hero">
                      <span className="oc-result-hero__label">P(top event)</span>
                      <span className="oc-result-hero__value">{formatValue(faultTreeResult.exact.topEventProbability, 6)}</span>
                      <span className="oc-result-hero__detail">{faultTreeResult.exact.method}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                      <Badge variant={faultTreeResult.exact.exactness}>Exact</Badge>
                    </div>
                    {faultTreeResult.rare && (
                      <Notice tone="warning" title="Rare-event approximation — an overestimate, not the answer">
                        <p style={{ margin: '0 0 var(--s2)' }}>
                          Σ over minimal cut sets = {formatValue(faultTreeResult.rare.value, 6)}, against the exact{' '}
                          {formatValue(faultTreeResult.exact.topEventProbability, 6)}. The approximation is higher by{' '}
                          {formatValue(faultTreeResult.rare.value - faultTreeResult.exact.topEventProbability, 4)}.
                        </p>
                        <p style={{ margin: 0 }}>{faultTreeResult.rare.note}</p>
                      </Notice>
                    )}
                    {faultTreeResult.rareError && <Notice tone="info">{faultTreeResult.rareError}</Notice>}
                    <Notice tone="warning" title="Independence was assumed">
                      <p style={{ margin: 0 }}>{faultTreeResult.exact.independenceNote}</p>
                    </Notice>
                  </>
                )}
              </Card>

              {faultTreeResult.ok && (
                <>
                  <Card title="Minimal cut sets">
                    {faultTreeResult.exact.minimalCutSets ? (
                      <SetList sets={faultTreeResult.exact.minimalCutSets} empty="No cut sets." />
                    ) : (
                      <Notice tone="info">
                        <p style={{ margin: 0 }}>
                          This tree was evaluated by exhaustive enumeration of basic-event states, which does not produce
                          minimal cut sets.
                        </p>
                      </Notice>
                    )}
                  </Card>
                  <Card title="The tree">
                    <div style={{ overflowX: 'auto' }}>
                      <TreeDiagram
                        title="Fault tree"
                        description="Gates shown left to right from the top event; the leaves are the basic events with their probabilities."
                        root={faultTreeResult.root}
                        valueLabel="Basic event probability"
                        note="A gate has no branch probability of its own: its probability follows from its inputs and its type."
                      />
                    </div>
                  </Card>
                </>
              )}
            </>
          )}

          {/* ----------------------------------------------------- lifetime */}
          {config.mode === 'lifetime' && (
            <>
              <Card title="Bathtub classification">
                {!lifetime.ok && <Notice tone="error">{lifetime.error}</Notice>}
                {lifetime.ok && (
                  <>
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                      {/* Text carries the regime and the trend arrow carries it again:
                          neither the badge colour nor the shape alone conveys it. */}
                      <Badge variant="exact">
                        {lifetime.bathtub.hazardTrend === 'decreasing' ? '↓ ' : lifetime.bathtub.hazardTrend === 'increasing' ? '↑ ' : '→ '}
                        {lifetime.bathtub.regime === 'infant-mortality' ? 'Infant mortality' : lifetime.bathtub.regime === 'constant-random' ? 'Constant random failure' : 'Wear-out'}
                      </Badge>
                      <span style={{ fontSize: 12.5 }}>hazard {lifetime.bathtub.hazardTrend} with age</span>
                    </div>
                    <p style={{ fontSize: 12.5, margin: '0 0 var(--s2)' }}>{lifetime.bathtub.headline}</p>
                    <p style={{ fontSize: 12.5, margin: '0 0 var(--s2)' }}>{lifetime.bathtub.interpretation}</p>
                    <p style={{ fontSize: 12.5, margin: 0 }}>{lifetime.bathtub.maintenanceImplication}</p>
                    {!lifetime.shapeIsGiven && (
                      <p className="oc-chart-note">
                        The exponential law is exactly the Weibull β = 1 case, so this reading is a consequence of choosing
                        a constant rate, not evidence found in data.
                      </p>
                    )}
                  </>
                )}
              </Card>

              {lifetime.ok && (
                <>
                  <Card title="Reliability, hazard and cumulative hazard">
                    <LineChart
                      title="Reliability R(t)"
                      description="Probability the item is still working at time t."
                      series={[{ label: 'R(t)', points: lifetime.reliabilityPoints }]}
                      xLabel="Time (hours)"
                      yLabel="R(t)"
                      yDomain={[0, 1]}
                    />
                    <LineChart
                      title="Hazard rate h(t)"
                      description="Instantaneous failure rate among the items that have survived to t."
                      series={[{ label: 'h(t)', points: lifetime.hazardPoints }]}
                      xLabel="Time (hours)"
                      yLabel="h(t) per hour"
                      note="t = 0 is omitted: a Weibull with β < 1 has an infinite hazard there."
                    />
                    <LineChart
                      title="Cumulative hazard H(t)"
                      description="H(t) = −ln R(t); the accumulated exposure to failure."
                      series={[{ label: 'H(t)', points: lifetime.cumulativePoints }]}
                      xLabel="Time (hours)"
                      yLabel="H(t)"
                    />
                    <KeyValueList
                      items={[
                        { label: 'MTTF', value: `${formatValue(lifetime.mttf.mttf, 6)} hours` },
                        { label: 'MTTF formula', value: lifetime.mttf.formula },
                        { label: 'R at the mission time', value: formatValue(reliabilityAtSafe(lifetime.reliabilityPoints, config.redundancy.time), 6) },
                      ]}
                    />
                  </Card>

                  <Card title="Availability from MTBF and MTTR">
                    {!availabilityResult.ok && <Notice tone="error">{availabilityResult.error}</Notice>}
                    {availabilityResult.ok && (
                      <>
                        <KeyValueList
                          items={[
                            { label: 'Steady-state availability', value: formatValue(availabilityResult.value.steadyState, 6) },
                            { label: 'Expected downtime per year', value: `${formatValue((1 - availabilityResult.value.steadyState) * 8760, 4)} hours` },
                            { label: 'Availability at the mission time', value: availabilityResult.value.atTime === null ? 'not requested' : formatValue(availabilityResult.value.atTime, 6) },
                            { label: 'Failure rate λ', value: formatValue(availabilityResult.value.failureRate, 6) },
                            { label: 'Repair rate μ', value: formatValue(availabilityResult.value.repairRate, 6) },
                          ]}
                        />
                        <div style={{ marginTop: 'var(--s3)' }}>
                          <Badge variant={availabilityResult.value.exactness}>Exact</Badge>
                        </div>
                        <p className="oc-chart-note">{availabilityResult.value.formula}</p>
                        <Notice tone="info" title="Availability is not reliability">
                          <p style={{ margin: 0 }}>
                            Availability is the long-run fraction of time the item is up, counting repairs. Reliability is the
                            probability of surviving a mission with no failure at all. A highly available item can still be
                            unreliable if it fails often and is repaired quickly.
                          </p>
                        </Notice>
                      </>
                    )}
                  </Card>

                  <Card title="Active versus cold-standby redundancy">
                    {!redundancy.ok && <Notice tone="error">{redundancy.error}</Notice>}
                    {redundancy.ok && (
                      <>
                        <DataTable
                          caption="Redundancy modes compared at the same mission time"
                          columns={[
                            { key: 'mode', header: 'Mode', render: (r) => (r.mode === 'active' ? 'Active (all powered)' : 'Cold standby (spares dormant)') },
                            { key: 'r', header: 'Reliability', numeric: true, render: (r) => formatValue(r.reliability, 8) },
                            { key: 'q', header: 'Failure probability', numeric: true, render: (r) => formatValue(1 - r.reliability, 6) },
                            { key: 'f', header: 'Formula', render: (r) => <code style={{ fontSize: 11 }}>{r.formula}</code> },
                          ]}
                          rows={[redundancy.active, redundancy.cold]}
                        />
                        <KeyValueList items={[{ label: 'A single unit, same mission', value: formatValue(redundancy.active.singleUnit, 8) }]} />
                        <p className="oc-chart-note">
                          Cold standby wins because a dormant unit accumulates no failure exposure while it waits — but only
                          if the switch works. Lower the switch success probability and the advantage disappears.
                        </p>
                      </>
                    )}
                  </Card>

                  <IndependenceCard commonCause={commonCause} beta={config.redundancy.beta} />
                </>
              )}
            </>
          )}

          {/* ---------------------------------------------------------- fit */}
          {config.mode === 'fit' && (
            <>
              <Card title="Censored maximum-likelihood fit">
                {!fit.ok && <Notice tone="error">{fit.error}</Notice>}
                {fit.ok && (
                  <>
                    <Notice tone="warning" title="Censoring is part of the data, not a nuisance">
                      <p style={{ margin: 0 }}>
                        {fit.sample.censored} of {fit.sample.observations.length} units are right-censored
                        ({fit.sample.failures} failures observed; censoring pattern: {fit.sample.censoringType}). Their time
                        on test is included in the likelihood. Dropping censored units, or treating their stop times as
                        failures, removes survival evidence and biases every estimate downward — shorter lives, higher
                        failure rates.
                      </p>
                    </Notice>
                    <DataTable
                      caption="Fitted lifetime laws"
                      columns={[
                        { key: 'm', header: 'Model', render: (r) => r.model },
                        { key: 'p', header: 'Parameter', render: (r) => r.parameter },
                        { key: 'e', header: 'Estimate', numeric: true, render: (r) => formatValue(r.estimate, 6) },
                        { key: 's', header: 'Standard error', numeric: true, render: (r) => (r.standardError === null ? 'not available' : formatValue(r.standardError, 6)) },
                      ]}
                      rows={[
                        { model: 'Exponential', parameter: 'rate λ', estimate: fit.exponential.rate, standardError: fit.exponential.rateStandardError },
                        { model: 'Exponential', parameter: 'MTTF = 1/λ', estimate: fit.exponential.mttf, standardError: null },
                        ...(fit.weibull
                          ? [
                              { model: 'Weibull', parameter: 'shape β', estimate: fit.weibull.shape, standardError: fit.weibull.shapeStandardError },
                              { model: 'Weibull', parameter: 'scale η', estimate: fit.weibull.scale, standardError: fit.weibull.scaleStandardError },
                              { model: 'Weibull', parameter: 'MTTF', estimate: fit.weibull.mttf, standardError: null },
                            ]
                          : []),
                      ]}
                    />
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--s3) 0' }}>
                      <Badge variant={fit.exponential.exactness}>Exponential: closed-form MLE</Badge>
                      {fit.weibull && <Badge variant={fit.weibull.exactness}>Weibull: numerical MLE ({fit.weibull.iterations} iterations)</Badge>}
                    </div>
                    <KeyValueList
                      items={[
                        {
                          label: `${formatPercent(fit.exponential.rateInterval.level, 1)} interval for λ`,
                          value: `${formatValue(fit.exponential.rateInterval.lower, 6)} to ${formatValue(fit.exponential.rateInterval.upper, 6)}`,
                        },
                        { label: 'Total time on test', value: formatValue(fit.sample.totalTimeOnTest, 6) },
                      ]}
                    />
                    <p className="oc-chart-note">
                      That interval is a statement about the estimated rate λ, not a range in which future lifetimes will
                      fall. The spread of individual lifetimes is given by the fitted distribution itself.
                    </p>
                    {fit.weibullError && <Notice tone="warning" title="The Weibull fit was refused">{fit.weibullError}</Notice>}
                    {fit.weibull && (
                      <Notice tone="info" title="What the fitted shape says">
                        <p style={{ margin: 0 }}>{classifyWeibullShape(fit.weibull.shape).headline}</p>
                      </Notice>
                    )}
                  </>
                )}
              </Card>

              {fit.ok && (
                <Card title="Weibull probability plot">
                  {fit.plotError && <Notice tone="warning">{fit.plotError}</Notice>}
                  {fit.plot && (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <QQChart
                          title="Weibull probability plot"
                          description="ln(−ln(1−F)) against ln t. A straight line supports the Weibull law; curvature argues against it."
                          points={fit.plot.points.map((p) => ({ theoretical: p.x, sample: p.y }))}
                          referenceLine={{ slope: fit.plot.shape, intercept: -fit.plot.shape * Math.log(fit.plot.scale), label: 'Median-rank regression line' }}
                          equalAspect={false}
                          xLabel="ln t"
                          yLabel="ln(−ln(1−F))"
                          note="Censored units are kept by Johnson rank adjustment, not discarded."
                        />
                      </div>
                      <KeyValueList
                        items={[
                          { label: 'Shape from the plot slope', value: formatValue(fit.plot.shape, 5) },
                          { label: 'Scale from the plot intercept', value: formatValue(fit.plot.scale, 5) },
                          { label: 'r² of the straight line', value: formatValue(fit.plot.rSquared, 5) },
                          { label: 'Shape from the censored MLE', value: fit.weibull ? formatValue(fit.weibull.shape, 5) : 'not available' },
                        ]}
                      />
                      <div style={{ marginTop: 'var(--s3)' }}>
                        <Badge variant={fit.plot.exactness}>Graphical estimator, not the MLE</Badge>
                      </div>
                      {fit.plot.notes.map((n, i) => (
                        <p className="oc-chart-note" key={i}>{n}</p>
                      ))}
                    </>
                  )}
                </Card>
              )}
            </>
          )}

          {explanation && (
            <Card title="Method, assumptions and exactness">
              <ExplanationPanel explanation={explanation} defaultOpen />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- sub-panels */

type ImportanceState =
  | { ok: true; value: ReturnType<typeof importanceMeasures> }
  | { ok: false; error: string };

function ImportanceCard({ importance, isBridge }: { importance: ImportanceState; isBridge: boolean }) {
  const reasons = importance.ok ? undefinedReasons(importance.value.components) : [];
  return (
    <Card
      title="Importance measures — where attention is worth spending"
      hint="Ranked by Birnbaum importance, the sensitivity of system reliability to each component."
    >
      {isBridge && (
        <Notice tone="info">
          <p style={{ margin: 0 }}>
            The engine computes importance measures over a series/parallel/k-of-n structure. The bridge has no such form,
            so the measures below are for the series–parallel system, not for the bridge. Switch the preset to read
            importance for the system you are actually analysing.
          </p>
        </Notice>
      )}
      {!importance.ok && <Notice tone="error">{importance.error}</Notice>}
      {importance.ok && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <DataTable
              caption="Component importance measures"
              columns={[
                { key: 'id', header: 'Component', render: (r) => r.id },
                { key: 'r', header: 'r', numeric: true, render: (r) => formatValue(r.reliability, 4) },
                { key: 'b', header: 'Birnbaum', numeric: true, title: '∂R/∂rᵢ: how much the system cares at all', render: (r) => formatValue(r.birnbaum, 5) },
                { key: 'c', header: 'Criticality', numeric: true, title: 'P(i critical and failed | system failed)', render: (r) => momentText(r.criticality) },
                { key: 'fv', header: 'Fussell–Vesely', numeric: true, title: 'P(a cut set containing i is failed | system failed)', render: (r) => momentText(r.fussellVesely) },
                { key: 'raw', header: 'RAW', numeric: true, title: 'Risk achievement worth: how bad if i is guaranteed to fail', render: (r) => momentText(r.riskAchievementWorth, 5) },
                { key: 'rrw', header: 'RRW', numeric: true, title: 'Risk reduction worth: how much is gained by perfecting i', render: (r) => momentText(r.riskReductionWorth, 5) },
              ]}
              rows={importance.value.birnbaumRanking
                .map((id) => importance.value.components.find((c) => c.id === id))
                .filter((c): c is ComponentImportance => c !== undefined)}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--s3) 0' }}>
            <Badge variant={importance.value.exactness}>Exact, from the structure function</Badge>
          </div>
          <KeyValueList
            items={[
              { label: 'Birnbaum ranking', value: importance.value.birnbaumRanking.join(' › ') },
              { label: 'Fussell–Vesely ranking', value: importance.value.fussellVeselyRanking.join(' › ') },
            ]}
          />
          {reasons.length > 0 && (
            <Notice tone="info" title="Why some measures read “not defined”" items={reasons} />
          )}
          {importance.value.notes.length > 0 && <Notice tone="info" items={importance.value.notes} />}
          <p className="oc-chart-note">{importance.value.independenceNote}</p>
        </>
      )}
    </Card>
  );
}

type CommonCauseState =
  | { ok: true; coupled: ReturnType<typeof betaFactorCommonCause>; independent: ReturnType<typeof betaFactorCommonCause> }
  | { ok: false; error: string };

/**
 * The independence contrast. This is the panel that changes decisions: the
 * independent answer and the coupled answer side by side, with the ratio
 * between their failure probabilities, so a reader can see redundancy stop
 * paying as soon as a shared cause is admitted.
 */
function IndependenceCard({ commonCause, beta }: { commonCause: CommonCauseState; beta: number }) {
  return (
    <Card
      title="Independence contrast — what the assumption is worth"
      hint="Everything above treats component failures as independent. This panel prices that assumption."
    >
      {!commonCause.ok && <Notice tone="error">{commonCause.error}</Notice>}
      {commonCause.ok && (
        <>
          <DataTable
            caption="Independent versus common-cause coupled reliability"
            columns={[
              { key: 'k', header: 'Quantity', render: (r) => r.label },
              { key: 'i', header: 'Independent (β = 0)', numeric: true, render: (r) => r.independent },
              { key: 'c', header: `Coupled (β = ${formatValue(beta, 3)})`, numeric: true, render: (r) => r.coupled },
            ]}
            rows={[
              {
                label: 'System reliability',
                independent: formatValue(commonCause.independent.independentReliability, 8),
                coupled: formatValue(commonCause.coupled.withCommonCauseReliability, 8),
              },
              {
                label: 'System failure probability',
                independent: formatValue(1 - commonCause.independent.independentReliability, 8),
                coupled: formatValue(1 - commonCause.coupled.withCommonCauseReliability, 8),
              },
            ]}
          />
          <KeyValueList
            items={[
              {
                label: 'Failure probability ratio (coupled ÷ independent)',
                value: Number.isFinite(commonCause.coupled.failureProbabilityRatio)
                  ? `${formatValue(commonCause.coupled.failureProbabilityRatio, 5)}×`
                  : 'unbounded — the independent model gives zero failure probability here',
              },
              { label: 'Reliability lost to coupling', value: formatValue(commonCause.coupled.difference, 6) },
            ]}
          />
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--s3) 0' }}>
            <Badge variant={commonCause.coupled.exactness}>Exact, given β</Badge>
            <Badge variant="assumed">β is an assumption, not an estimate</Badge>
          </div>
          <Notice tone={commonCause.coupled.independenceAssumed ? 'warning' : 'info'} title={commonCause.coupled.independenceAssumed ? 'Independence assumed' : 'Independence not assumed'}>
            <p style={{ margin: '0 0 var(--s2)' }}>{commonCause.coupled.headline}</p>
            <p style={{ margin: 0 }}>{commonCause.coupled.independenceNote}</p>
          </Notice>
          <Notice tone="info" items={commonCause.coupled.assumptions} title="This contrast rests on" />
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ small */

/**
 * The reliability at the mission time, read off the curve the engine already
 * produced rather than recomputed, so the figure and the chart can never
 * disagree. Returns the nearest computed point.
 */
function reliabilityAtSafe(points: readonly { x: number; y: number }[], t: number): number {
  if (!points.length) return Number.NaN;
  let best = points[0];
  for (const p of points) {
    if (Math.abs(p.x - t) < Math.abs(best.x - t)) best = p;
  }
  return best.y;
}

/**
 * The rare-event approximation needs minimal cut sets, which a non-coherent
 * tree does not have. Wrapping it keeps that failure out of the exact result's
 * error path, so a tree with a NOT gate still shows its exact probability.
 */
function rareEventApproximationSafe(tree: FaultTree): { ok: true; value: RareEventResult } | { ok: false; error: string } {
  try {
    return { ok: true, value: rareEventApproximation(tree) };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
