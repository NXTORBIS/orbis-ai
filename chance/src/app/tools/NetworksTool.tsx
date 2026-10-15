/**
 * Networks: random graphs, percolation and spreading.
 *
 * Every other risk screen in this application treats exposures as a list — a
 * vector of probabilities combined under some assumed dependence. On a network
 * the useful question is different: does a giant connected component exist?
 * That is a *phase transition*, so an intuition calibrated on independent
 * exposures is not merely imprecise near the threshold, it is wrong about the
 * kind of thing that happens. The phase-transition panel is therefore the
 * spine of this screen and everything else is read against it.
 *
 * Performance note, because this is the most expensive module in the engine:
 * nothing on this screen sweeps, percolates or simulates on open. The default
 * graph is deliberately small (a few dozen nodes) so that the structure,
 * centrality and spectral panels are all cheap, and every Monte Carlo panel is
 * behind a button, driven as a cancellable generator that yields between
 * chunks (`setTimeout` between `next()` calls, so the tab keeps painting and a
 * cancel flag can actually be observed).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EngineError } from '../../engine/core/result';
import { Random } from '../../engine/random/rng';
import {
  GREEDY_APPROXIMATION_RATIO,
  NETWORK_LIMITS,
  barabasiAlbert,
  betweennessCentrality,
  buildGraph,
  closenessCentrality,
  clustering,
  compareInterventions,
  configurationModel,
  connectedComponents,
  degreeAssortativity,
  degreeCentrality,
  degreeSummary,
  eigenvectorCentrality,
  erdosGallaiCheck,
  erdosRenyiGiantFraction,
  erdosRenyiGnm,
  erdosRenyiGnp,
  friendshipParadox,
  influenceMaximisationSteps,
  kCoreDecomposition,
  katzCentrality,
  massActionODE,
  molloyReed,
  outbreakProbability,
  pageRank,
  pathLengths,
  percolationCurveSteps,
  powerLawDegreeSequence,
  randomGeometricGraph,
  reproductionNumbers,
  robustnessSteps,
  simulateSpreadRun,
  spreadEnsembleSteps,
  stochasticBlockModel,
  wattsStrogatz,
  type EdgeInput,
  type Graph,
  type InfluenceMaximisationResult,
  type InterventionComparison,
  type NetworkQuantity,
  type PercolationCurve,
  type RobustnessComparison,
  type SpreadEnsembleResult,
  type SpreadModel,
  type SpreadParameters,
} from '../../engine/networks';
import { NetworkGraph, type GraphEdge, type GraphNode } from '../../ui/charts/advanced';
import { HistogramChart, LineChart } from '../../ui/charts/charts';
import { formatValue } from '../../ui/charts/scale';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  RunningState,
  SelectField,
  SliderField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

/* ------------------------------------------------------------------ config */

type GeneratorId =
  | 'erdos-renyi'
  | 'configuration'
  | 'barabasi-albert'
  | 'watts-strogatz'
  | 'block-model'
  | 'geometric'
  | 'edge-list';

/**
 * Only the generator's parameters and a seed are stored — never the generated
 * graph. The config is persisted to IndexedDB and validated on import, so it
 * holds nothing but numbers, strings and booleans.
 */
export interface NetworksConfig {
  generator: GeneratorId;
  /** Node count for every generated model. */
  nodes: number;
  seed: string;

  /** Erdős–Rényi: the target mean degree, converted to p = c/(n-1). */
  meanDegree: number;
  /** Barabási–Albert: edges added per arriving node. */
  baEdgesPerNode: number;
  /** Watts–Strogatz: ring degree k (must be even) and rewiring probability. */
  wsNeighbours: number;
  wsRewiring: number;
  /** Configuration model: power-law degree sequence parameters. */
  plExponent: number;
  plMinDegree: number;
  /** Stochastic block model: equal blocks, within- and between-block probabilities. */
  sbmBlocks: number;
  sbmWithin: number;
  sbmBetween: number;
  /** Random geometric graph: connection radius in the unit square. */
  geoRadius: number;
  /** Pasted edge list, one "a b" pair per line. */
  edgeList: string;

  /** Katz attenuation as a fraction of the admissible bound 1/lambda_max. */
  katzAlphaFraction: number;
  pageRankDamping: number;
  /** Forces betweenness above the screen's own size guard. */
  runBetweenness: boolean;

  runPhaseTransition: boolean;
  percolationKind: 'site' | 'bond';
  phaseGridPoints: number;
  phaseReplicates: number;

  runRobustness: boolean;
  robustnessReplicates: number;

  runSpreading: boolean;
  spreadModel: SpreadModel;
  beta: number;
  gamma: number;
  sigma: number;
  spreadRuns: number;

  runInterventions: boolean;
  doseFraction: number;
  interventionRuns: number;

  runInfluence: boolean;
  influenceSeeds: number;
  influenceP: number;
  influenceReplicates: number;
}

/**
 * A 36-node Barabási–Albert graph: small enough to draw, to decompose
 * spectrally and to run betweenness on instantly, and heavy-tailed enough that
 * the hub asymmetry in the robustness and intervention panels is real rather
 * than decorative. Every Monte Carlo panel starts switched off.
 */
export const NETWORKS_DEFAULT: NetworksConfig = {
  generator: 'barabasi-albert',
  nodes: 36,
  seed: 'orbis-networks-1',

  meanDegree: 4,
  baEdgesPerNode: 2,
  wsNeighbours: 4,
  wsRewiring: 0.1,
  plExponent: 2.5,
  plMinDegree: 2,
  sbmBlocks: 3,
  sbmWithin: 0.3,
  sbmBetween: 0.02,
  geoRadius: 0.25,
  edgeList: 'a b\nb c\nc a\nc d\nd e',

  katzAlphaFraction: 0.5,
  pageRankDamping: 0.85,
  runBetweenness: false,

  runPhaseTransition: false,
  percolationKind: 'bond',
  phaseGridPoints: 41,
  phaseReplicates: 20,

  runRobustness: false,
  robustnessReplicates: 10,

  runSpreading: false,
  spreadModel: 'SIR',
  beta: 0.4,
  gamma: 1,
  sigma: 0.5,
  spreadRuns: 120,

  runInterventions: false,
  doseFraction: 0.2,
  interventionRuns: 60,

  runInfluence: false,
  influenceSeeds: 3,
  influenceP: 0.12,
  influenceReplicates: 60,
};

/* --------------------------------------------------------- generator driver */

interface JobState<T> {
  status: 'idle' | 'running';
  done: number;
  total: number;
  result: T | null;
  error: string | null;
}

const IDLE_JOB = { status: 'idle' as const, done: 0, total: 0, result: null, error: null };

function messageOf(e: unknown): string {
  if (e instanceof EngineError) return e.issues.map((i) => i.message).join(' ');
  return e instanceof Error ? e.message : String(e);
}

/**
 * Drives one of the engine's generators on the main thread, one `next()` per
 * macrotask. The generators yield between chunks precisely so this is
 * possible: a synchronous loop could never observe the cancel flag, and the
 * tab would stop painting for the whole run.
 */
function useGeneratorJob<T>() {
  const [state, setState] = useState<JobState<T>>(IDLE_JOB);
  const cancelled = useRef(false);
  const generation = useRef(0);

  // Abandon anything in flight when the screen is left, so a run nothing will
  // display is not left consuming the main thread.
  useEffect(
    () => () => {
      cancelled.current = true;
      generation.current += 1;
    },
    [],
  );

  const start = useCallback((make: (isCancelled: () => boolean) => Generator<number, T, void>, total: number) => {
    cancelled.current = false;
    generation.current += 1;
    const mine = generation.current;
    setState({ status: 'running', done: 0, total, result: null, error: null });
    let gen: Generator<number, T, void>;
    try {
      gen = make(() => cancelled.current);
    } catch (e) {
      setState({ ...IDLE_JOB, error: messageOf(e) });
      return;
    }
    const pump = () => {
      if (generation.current !== mine) return;
      try {
        const next = gen.next();
        if (next.done) {
          setState({ status: 'idle', done: total, total, result: next.value, error: null });
          return;
        }
        const done = next.value;
        setState((prev) => ({ ...prev, done }));
        setTimeout(pump, 0);
      } catch (e) {
        setState({ ...IDLE_JOB, error: messageOf(e) });
      }
    };
    setTimeout(pump, 0);
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelled.current = true;
    generation.current += 1;
    setState(IDLE_JOB);
  }, []);

  return { ...state, start, cancel, reset };
}

/** Robustness on two graphs in one cancellable pass, by delegation. */
function* robustnessPairSteps(
  main: Graph,
  reference: Graph,
  seed: string,
  options: { replicates: number; isCancelled(): boolean },
): Generator<number, { main: RobustnessComparison; reference: RobustnessComparison }, void> {
  const a = yield* robustnessSteps(main, `${seed}:rob-main`, {
    strategies: ['random', 'recalculated-degree'],
    replicates: options.replicates,
    isCancelled: options.isCancelled,
  });
  const b = yield* robustnessSteps(reference, `${seed}:rob-ref`, {
    strategies: ['random', 'recalculated-degree'],
    replicates: options.replicates,
    isCancelled: options.isCancelled,
  });
  return { main: a, reference: b };
}

/* -------------------------------------------------------------- small bits */

/** The size above which this screen draws the node/edge table only. */
const DRAWABLE_NODES = 40;
/** The screen's own betweenness guard, well below the engine's hard limit. */
const BETWEENNESS_SOFT_LIMIT = 400;

function pct(x: number): string {
  return `${(100 * x).toPrecision(3)}%`;
}

function quantityRow(q: NetworkQuantity): { label: string; value: ReactNode } {
  return {
    label: q.label,
    value: (
      <span style={{ display: 'inline-flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{formatValue(q.value, 5)}</span>
        <Badge variant={q.exactness}>{q.exactness}</Badge>
      </span>
    ),
  };
}

/** Parse a pasted edge list. Node ids are whatever the edges mention. */
function parseEdgeList(text: string): { nodes: string[]; edges: EdgeInput[] } {
  const nodes: string[] = [];
  const seen = new Set<string>();
  const edges: EdgeInput[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 2) {
      throw new EngineError(
        `Line "${trimmed}" has ${parts.length} entry. An edge needs two node ids, separated by a space or a comma.`,
        'invalid',
      );
    }
    for (const id of [parts[0], parts[1]]) {
      if (!seen.has(id)) {
        seen.add(id);
        nodes.push(id);
      }
    }
    edges.push({ source: parts[0], target: parts[1] });
  }
  if (!nodes.length) {
    throw new EngineError('The edge list is empty, so there is no graph to analyse. Enter one edge per line, as two node ids.', 'empty');
  }
  return { nodes, edges };
}

interface BuiltGraph {
  graph: Graph;
  model: string;
  analytic: NetworkQuantity[];
  notes: string[];
}

/** Build the graph the whole screen is computed from. */
function buildFromConfig(config: NetworksConfig): BuiltGraph {
  const { nodes: n, seed } = config;
  switch (config.generator) {
    case 'erdos-renyi': {
      // The control is a mean degree because that is the axis the phase
      // transition lives on; p is derived, not entered.
      const p = n > 1 ? config.meanDegree / (n - 1) : 0;
      if (p > 1) {
        throw new EngineError(
          `A mean degree of ${config.meanDegree} on ${n} nodes needs p = ${p.toPrecision(3)} > 1, which is impossible: ` +
            `the maximum mean degree of a simple graph on ${n} nodes is ${n - 1}.`,
          'range',
        );
      }
      const g = erdosRenyiGnp(n, p, seed);
      return { graph: g.graph, model: g.model, analytic: g.analytic, notes: g.notes };
    }
    case 'barabasi-albert': {
      const g = barabasiAlbert(n, config.baEdgesPerNode, seed);
      return { graph: g.graph, model: g.model, analytic: g.analytic, notes: g.notes };
    }
    case 'watts-strogatz': {
      const g = wattsStrogatz(n, config.wsNeighbours, config.wsRewiring, seed);
      return { graph: g.graph, model: g.model, analytic: g.analytic, notes: g.notes };
    }
    case 'configuration': {
      const sequence = powerLawDegreeSequence(n, config.plExponent, config.plMinDegree, seed);
      // Erdős–Gallai is checked here as well as inside the model so that an
      // unrealisable sequence is reported with its own reason, not only as a
      // generator failure.
      const check = erdosGallaiCheck(sequence.degrees);
      if (!check.realisable) {
        throw new EngineError(`This degree sequence cannot be realised by any simple graph. ${check.reason}`, 'unrealisable');
      }
      const g = configurationModel(sequence.degrees, seed);
      return { graph: g.graph, model: g.model, analytic: g.analytic, notes: [...sequence.notes, ...g.notes] };
    }
    case 'block-model': {
      const b = config.sbmBlocks;
      const size = Math.max(1, Math.floor(n / b));
      const sizes = new Array<number>(b).fill(size);
      sizes[b - 1] += n - size * b;
      const probs = Array.from({ length: b }, (_, i) =>
        Array.from({ length: b }, (_, j) => (i === j ? config.sbmWithin : config.sbmBetween)),
      );
      const g = stochasticBlockModel(sizes, probs, seed);
      return { graph: g.graph, model: g.model, analytic: g.analytic, notes: g.notes };
    }
    case 'geometric': {
      const g = randomGeometricGraph(n, config.geoRadius, seed);
      return { graph: g.graph, model: g.model, analytic: g.analytic, notes: g.notes };
    }
    case 'edge-list': {
      const parsed = parseEdgeList(config.edgeList);
      return {
        graph: buildGraph({ nodes: parsed.nodes, edges: parsed.edges }),
        model: 'supplied edge list',
        analytic: [],
        notes: ['No generative model: the graph is exactly the edge list you supplied, and nothing here is a sample from anything.'],
      };
    }
  }
}

/* ------------------------------------------------------------------ screen */

export function NetworksTool({ config }: { config: NetworksConfig }) {
  const app = useApp();
  const set = (patch: Partial<NetworksConfig>) => app.updateConfig({ ...config, ...patch });

  const phaseJob = useGeneratorJob<PercolationCurve>();
  const robustJob = useGeneratorJob<{ main: RobustnessComparison; reference: RobustnessComparison }>();
  const spreadJob = useGeneratorJob<SpreadEnsembleResult>();
  const influenceJob = useGeneratorJob<InfluenceMaximisationResult>();
  const [interventions, setInterventions] = useState<{ ok: true; value: InterventionComparison } | { ok: false; error: string } | null>(null);

  /* ------------------------------------------------------------- the graph */

  const built = useMemo(() => {
    try {
      return { ok: true as const, value: buildFromConfig(config) };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [config]);

  const graph = built.ok ? built.value.graph : null;

  /**
   * Structure. Every measure here is a deterministic function of the graph, so
   * all of it is cheap on a graph of this size and none of it is gated — but
   * the path-length measures are O(n·m) and the engine refuses them above its
   * own limit, which is caught and shown rather than hung on.
   */
  const structure = useMemo(() => {
    if (!graph) return null;
    try {
      const degrees = degreeSummary(graph);
      const comps = connectedComponents(graph);
      const clus = clustering(graph);
      const cores = kCoreDecomposition(graph);
      const mr = molloyReed(degrees.degree);
      let paths: ReturnType<typeof pathLengths> | null = null;
      let pathsError: string | null = null;
      try {
        paths = pathLengths(graph);
      } catch (e) {
        pathsError = messageOf(e);
      }
      let assortativity: ReturnType<typeof degreeAssortativity> | null = null;
      try {
        assortativity = degreeAssortativity(graph);
      } catch {
        // Undefined on a graph with no edges; that is a fact about the graph,
        // not an error worth a banner of its own.
        assortativity = null;
      }
      return { ok: true as const, value: { degrees, comps, clus, cores, mr, paths, pathsError, assortativity } };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [graph]);

  /* ---------------------------------------------------------- centrality */

  const betweennessAllowed = graph !== null && (graph.n <= BETWEENNESS_SOFT_LIMIT || config.runBetweenness);

  const centrality = useMemo(() => {
    if (!graph || !structure?.ok) return null;
    try {
      const degree = degreeCentrality(graph);
      const eigen = eigenvectorCentrality(graph);
      const rank = pageRank(graph, { damping: config.pageRankDamping });
      const alpha = config.katzAlphaFraction / Math.max(1e-12, eigen.eigenvalue.value);
      let katz: ReturnType<typeof katzCentrality> | null = null;
      let katzError: string | null = null;
      try {
        katz = katzCentrality(graph, alpha);
      } catch (e) {
        katzError = messageOf(e);
      }
      let closeness: ReturnType<typeof closenessCentrality> | null = null;
      let closenessError: string | null = null;
      try {
        closeness = closenessCentrality(graph);
      } catch (e) {
        closenessError = messageOf(e);
      }
      let between: ReturnType<typeof betweennessCentrality> | null = null;
      let betweenError: string | null = null;
      if (betweennessAllowed) {
        try {
          between = betweennessCentrality(graph);
        } catch (e) {
          betweenError = messageOf(e);
        }
      }
      return {
        ok: true as const,
        value: { degree, eigen, rank, katz, katzError, closeness, closenessError, between, betweenError, alpha, lambdaMax: eigen.eigenvalue.value },
      };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [graph, structure, config.pageRankDamping, config.katzAlphaFraction, betweennessAllowed]);

  /* ------------------------------------------------- reproduction numbers */

  const reproduction = useMemo(() => {
    if (!graph) return null;
    try {
      const r = reproductionNumbers(graph, { beta: config.beta, gamma: config.gamma });
      const branching = outbreakProbability(graph, { beta: config.beta, gamma: config.gamma });
      return { ok: true as const, value: { r, branching } };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [graph, config.beta, config.gamma]);

  /** The friendship paradox, which is what makes acquaintance immunisation work. */
  const paradox = useMemo(() => {
    if (!graph) return null;
    try {
      return { ok: true as const, value: friendshipParadox(graph) };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [graph]);

  /* ----------------------------------------------- epidemic curves, post-run */

  /**
   * Trajectories for the epidemic chart. Computed only once an ensemble exists
   * (so never on open), and from a handful of runs rather than the ensemble,
   * because the ensemble keeps final sizes and peaks, not paths.
   */
  const spreadCurves = useMemo(() => {
    if (!graph || !spreadJob.result || !structure?.ok) return null;
    const params: SpreadParameters = {
      model: config.spreadModel,
      beta: config.beta,
      gamma: config.gamma,
      sigma: config.sigma,
    };
    try {
      const rng = new Random(`${config.seed}:curves`);
      // The ensemble's own extinction cutoff decides which of these individual
      // runs counts as having died out, so the labels here and the counts above
      // use one definition rather than two.
      const cutoff = spreadJob.result.distribution.cutoff;
      const runs: { label: string; points: { x: number; y: number }[] }[] = [];
      for (let r = 0; r < 6; r++) {
        const run = simulateSpreadRun(graph, params, rng, { trajectoryPoints: 80 });
        runs.push({
          label: `Run ${r + 1} — ${run.finalSize <= cutoff ? 'died out' : 'took off'} (${run.finalSize} infected)`,
          points: run.trajectory.map((t) => ({ x: t.t, y: (t.i + t.e) / graph.n })),
        });
      }
      const mf = massActionODE({ ...params, meanDegree: structure.value.degrees.meanDegree.value });
      return { ok: true as const, value: { runs, mf } };
    } catch (e) {
      return { ok: false as const, error: messageOf(e) };
    }
  }, [graph, spreadJob.result, structure, config.spreadModel, config.beta, config.gamma, config.sigma, config.seed]);

  /* ---------------------------------------------------------------- runners */

  const startPhase = () => {
    if (!graph) return;
    const points = config.phaseGridPoints;
    const probabilities = Array.from({ length: points }, (_, i) => i / (points - 1));
    phaseJob.start(
      (isCancelled) =>
        percolationCurveSteps(graph, `${config.seed}:perc`, {
          kind: config.percolationKind,
          probabilities,
          replicates: config.phaseReplicates,
          isCancelled,
        }),
      points,
    );
  };

  const startRobustness = () => {
    if (!graph) return;
    // The reference graph is built inside the factory so that a refusal from
    // the generator reaches the job's own error slot rather than escaping.
    robustJob.start((isCancelled) => {
      // An Erdős–Rényi graph with the SAME node and edge count, so the only
      // difference between the two pairs of curves is the degree distribution.
      const reference = erdosRenyiGnm(graph.n, graph.m, `${config.seed}:er-reference`).graph;
      return robustnessPairSteps(graph, reference, config.seed, { replicates: config.robustnessReplicates, isCancelled });
    }, 4);
  };

  const startSpread = () => {
    if (!graph) return;
    const params: SpreadParameters = { model: config.spreadModel, beta: config.beta, gamma: config.gamma, sigma: config.sigma };
    spreadJob.start(
      (isCancelled) => spreadEnsembleSteps(graph, params, `${config.seed}:epi`, { runs: config.spreadRuns, isCancelled }),
      config.spreadRuns,
    );
  };

  const startInfluence = () => {
    if (!graph) return;
    influenceJob.start(
      (isCancelled) =>
        influenceMaximisationSteps(graph, config.influenceSeeds, `${config.seed}:influence`, {
          p: config.influenceP,
          replicates: config.influenceReplicates,
          isCancelled,
        }),
      config.influenceSeeds,
    );
  };

  const runInterventionComparison = () => {
    if (!graph) return;
    const params: SpreadParameters = { model: config.spreadModel, beta: config.beta, gamma: config.gamma, sigma: config.sigma };
    const doses = Math.max(1, Math.round(config.doseFraction * graph.n));
    try {
      setInterventions({
        ok: true,
        value: compareInterventions(graph, params, doses, `${config.seed}:interv`, {
          strategies: ['none', 'random', 'acquaintance', 'degree'],
          runs: config.interventionRuns,
        }),
      });
    } catch (e) {
      setInterventions({ ok: false, error: messageOf(e) });
    }
  };

  /* ----------------------------------------------------- derived chart data */

  const degreeBins = useMemo(() => {
    if (!structure?.ok) return [];
    const total = structure.value.degrees.degree.length;
    return structure.value.degrees.distribution.map((d) => ({
      x0: d.k - 0.5,
      x1: d.k + 0.5,
      count: d.count,
      density: d.p,
      proportion: total > 0 ? d.count / total : 0,
    }));
  }, [structure]);

  const drawn = useMemo(() => {
    if (!graph || graph.n > DRAWABLE_NODES) return null;
    const nodes: GraphNode[] = graph.ids.map((id, i) => ({ id, label: id, badge: `k=${graph.out[i].length}` }));
    const edges: GraphEdge[] = [];
    for (let i = 0; i < graph.n; i++) {
      for (const j of graph.out[i]) if (i <= j) edges.push({ from: graph.ids[i], to: graph.ids[j] });
    }
    return { nodes, edges };
  }, [graph]);

  const meanDegreeValue = structure?.ok ? structure.value.degrees.meanDegree.value : 0;

  /** The headline chart: simulated S(p) against the Poisson analytic curve. */
  const phaseSeries = useMemo(() => {
    const curve = phaseJob.result;
    if (!curve) return [];
    const simulated = { label: 'Simulated giant-component fraction', points: curve.points.map((p) => ({ x: p.p, y: p.giantFraction })) };
    const analytic: { x: number; y: number }[] = [];
    for (const p of curve.points) {
      try {
        analytic.push({ x: p.p, y: erdosRenyiGiantFraction(p.p * meanDegreeValue).value });
      } catch {
        // The root search can refuse a value; a refused point is omitted
        // rather than replaced by a guess.
      }
    }
    return [simulated, { label: 'Erdős–Rényi analytic S at mean degree p·⟨k⟩', points: analytic, dashed: true }];
  }, [phaseJob.result, meanDegreeValue]);

  const robustSeries = useMemo(() => {
    const r = robustJob.result;
    if (!r) return [];
    const series: { label: string; points: { x: number; y: number }[]; dashed?: boolean }[] = [];
    for (const c of r.main.curves) {
      series.push({
        label: `This graph — ${c.strategy === 'random' ? 'random failure' : 'targeted attack on hubs'}`,
        points: c.points.map((p) => ({ x: p.removedFraction, y: p.giantFraction })),
      });
    }
    for (const c of r.reference.curves) {
      series.push({
        label: `Erdős–Rényi, same edge count — ${c.strategy === 'random' ? 'random failure' : 'targeted attack'}`,
        points: c.points.map((p) => ({ x: p.removedFraction, y: p.giantFraction })),
        dashed: true,
      });
    }
    return series;
  }, [robustJob.result]);

  const centralityRows = useMemo(() => {
    if (!graph || !centrality?.ok || !structure?.ok) return [];
    const c = centrality.value;
    const cores = structure.value.cores.coreNumber;
    const rows = graph.ids.map((id, i) => ({
      id,
      degree: c.degree.score[i],
      betweenness: c.between ? c.between.score[i] : null,
      closeness: c.closeness ? c.closeness.score[i] : null,
      eigen: c.eigen.score[i],
      katz: c.katz ? c.katz.score[i] : null,
      pagerank: c.rank.score[i],
      core: cores[i],
    }));
    rows.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
    return rows;
  }, [graph, centrality, structure]);

  type CentralityRow = (typeof centralityRows)[number];

  const centralityColumns: ColumnDef<CentralityRow>[] = useMemo(
    () => [
      { key: 'id', header: 'Node', render: (r) => r.id },
      { key: 'core', header: 'k-core', numeric: true, render: (r) => String(r.core) },
      { key: 'degree', header: 'Degree', numeric: true, render: (r) => formatValue(r.degree, 4) },
      { key: 'between', header: 'Betweenness', numeric: true, render: (r) => (r.betweenness === null ? 'not computed' : formatValue(r.betweenness, 4)) },
      { key: 'close', header: 'Closeness', numeric: true, render: (r) => (r.closeness === null ? 'not computed' : formatValue(r.closeness, 4)) },
      { key: 'eigen', header: 'Eigenvector', numeric: true, render: (r) => formatValue(r.eigen, 4) },
      { key: 'katz', header: 'Katz', numeric: true, render: (r) => (r.katz === null ? 'not computed' : formatValue(r.katz, 4)) },
      { key: 'pr', header: 'PageRank', numeric: true, render: (r) => formatValue(r.pagerank, 4) },
    ],
    [],
  );

  /* ------------------------------------------------------------------ render */

  return (
    <>
      <ToolHeader toolId="networks" />
      <div className="oc-workspace">
        <div className="oc-stack">
          {/* --------------------------------------------- 1. build a graph */}
          <Card title="Build a graph" hint="Only the parameters and the seed are saved, never the generated graph.">
            <SelectField
              label="Generator"
              value={config.generator}
              onChange={(generator) => set({ generator: generator as GeneratorId })}
              options={[
                { value: 'erdos-renyi', label: 'Erdős–Rényi G(n, p) — every pair independent' },
                { value: 'configuration', label: 'Configuration model — a power-law degree sequence' },
                { value: 'barabasi-albert', label: 'Barabási–Albert — preferential attachment' },
                { value: 'watts-strogatz', label: 'Watts–Strogatz — a rewired ring' },
                { value: 'block-model', label: 'Stochastic block model — communities' },
                { value: 'geometric', label: 'Random geometric — points joined within a radius' },
                { value: 'edge-list', label: 'Paste an edge list' },
              ]}
              hint="The generator decides the degree distribution, and the degree distribution decides almost everything else on this screen."
            />

            {config.generator !== 'edge-list' && (
              <NumberField
                label="Number of nodes"
                symbol="n"
                value={config.nodes}
                onChange={(nodes) => set({ nodes })}
                min={2}
                max={NETWORK_LIMITS.maxNodes}
                integer
                hint={`Graphs of ${DRAWABLE_NODES} nodes or fewer are drawn. Betweenness is computed up to ${BETWEENNESS_SOFT_LIMIT} nodes unless you ask for more; the eigen-decomposition is refused above ${NETWORK_LIMITS.spectralMaxNodes}.`}
              />
            )}

            {config.generator === 'erdos-renyi' && (
              <SliderField
                label="Mean degree"
                symbol="⟨k⟩"
                value={config.meanDegree}
                onChange={(meanDegree) => set({ meanDegree })}
                min={0}
                max={12}
                step={0.1}
                hint="p is derived as ⟨k⟩/(n−1). The giant component appears at ⟨k⟩ = 1 exactly."
              />
            )}
            {config.generator === 'barabasi-albert' && (
              <NumberField
                label="Edges added per arriving node"
                symbol="m"
                value={config.baEdgesPerNode}
                onChange={(baEdgesPerNode) => set({ baEdgesPerNode })}
                min={1}
                max={Math.max(1, config.nodes - 1)}
                integer
                hint="Preferential attachment gives a power law with exponent 3 in the large-n limit, whatever m is."
              />
            )}
            {config.generator === 'watts-strogatz' && (
              <>
                <NumberField
                  label="Ring degree (even)"
                  symbol="k"
                  value={config.wsNeighbours}
                  onChange={(wsNeighbours) => set({ wsNeighbours })}
                  min={2}
                  max={Math.max(2, config.nodes - 1)}
                  step={2}
                  integer
                  hint="Each node starts joined to its k nearest neighbours on a ring. An odd k is refused."
                />
                <SliderField
                  label="Rewiring probability"
                  symbol="p"
                  value={config.wsRewiring}
                  onChange={(wsRewiring) => set({ wsRewiring })}
                  min={0}
                  max={1}
                  step={0.01}
                  hint="Between about 0.01 and 0.1 clustering is still near its lattice value while path lengths have already collapsed."
                />
              </>
            )}
            {config.generator === 'configuration' && (
              <>
                <SliderField
                  label="Power-law exponent"
                  symbol="α"
                  value={config.plExponent}
                  onChange={(plExponent) => set({ plExponent })}
                  min={1.6}
                  max={4}
                  step={0.05}
                  hint="Below 3 the second moment ⟨k²⟩ diverges with n, and the epidemic threshold goes to zero."
                />
                <NumberField label="Minimum degree" symbol="k_min" value={config.plMinDegree} onChange={(plMinDegree) => set({ plMinDegree })} min={1} max={20} integer />
              </>
            )}
            {config.generator === 'block-model' && (
              <>
                <NumberField label="Number of blocks" value={config.sbmBlocks} onChange={(sbmBlocks) => set({ sbmBlocks })} min={1} max={12} integer />
                <SliderField label="Within-block edge probability" value={config.sbmWithin} onChange={(sbmWithin) => set({ sbmWithin })} min={0} max={1} step={0.01} />
                <SliderField label="Between-block edge probability" value={config.sbmBetween} onChange={(sbmBetween) => set({ sbmBetween })} min={0} max={1} step={0.005} />
              </>
            )}
            {config.generator === 'geometric' && (
              <SliderField
                label="Connection radius"
                symbol="r"
                value={config.geoRadius}
                onChange={(geoRadius) => set({ geoRadius })}
                min={0.02}
                max={1.4}
                step={0.01}
                hint="Points are uniform in the unit square and joined within r. Clustered by construction, which is where mean-field predictions fail."
              />
            )}
            {config.generator === 'edge-list' && (
              <TextField
                label="Edge list"
                value={config.edgeList}
                onChange={(edgeList) => set({ edgeList })}
                multiline
                rows={6}
                monospace
                hint='One edge per line, two node ids separated by a space or comma. Lines starting with "#" are ignored.'
              />
            )}
            <TextField label="Seed" value={config.seed} onChange={(seed) => set({ seed })} monospace hint="The same seed reproduces the same graph and the same Monte Carlo runs exactly." />

            {!built.ok && <Notice tone="error" title="No graph, so no results">{built.error}</Notice>}
            {built.ok && graph && (
              <KeyValueList
                items={[
                  { label: 'Model', value: built.value.model },
                  { label: 'Nodes', value: graph.n.toLocaleString('en-US') },
                  { label: 'Edges', value: graph.m.toLocaleString('en-US') },
                  { label: 'Directed', value: graph.directed ? 'yes' : 'no (every edge counts both ways)' },
                ]}
              />
            )}
            {built.ok && built.value.notes.length > 0 && <Notice tone="info" title="What this model assumes" items={built.value.notes} />}
          </Card>

          <AiAssistPanel
            capability="interpretQuestion"
            context="Networks: random graph generators, percolation thresholds, robustness to random versus targeted removal, and spreading processes. Describing the exposures and who is connected to whom helps pick a generator; the AI never supplies a number."
          />
        </div>

        <div className="oc-stack">
          {/* ------------------------------------------------- 2. structure */}
          <Card title="Structure">
            {!structure && <Notice tone="info">There is no graph to measure yet.</Notice>}
            {structure && !structure.ok && <Notice tone="error">{structure.error}</Notice>}
            {structure?.ok && graph && (
              <>
                <KeyValueList
                  items={[
                    quantityRow(structure.value.degrees.meanDegree),
                    quantityRow(structure.value.degrees.secondMoment),
                    quantityRow(structure.value.degrees.maxDegree),
                    quantityRow(structure.value.degrees.density),
                    quantityRow(structure.value.clus.averageLocal),
                    quantityRow(structure.value.clus.global),
                    quantityRow(structure.value.comps.giantFraction),
                    { label: 'Components', value: String(structure.value.comps.count) },
                    { label: 'Second-largest component', value: `${structure.value.comps.secondLargestSize} nodes` },
                    { label: 'Isolated nodes', value: String(structure.value.comps.isolatedNodes) },
                    { label: 'Largest k-core', value: `k = ${structure.value.cores.maxCore} (${structure.value.cores.maxCoreNodes.length} nodes)` },
                    quantityRow(structure.value.mr.criterion),
                  ]}
                />
                <Notice tone={structure.value.mr.giantComponentExpected ? 'success' : 'warning'} title="Molloy–Reed">
                  <p style={{ margin: 0 }}>
                    {structure.value.mr.giantComponentExpected
                      ? 'With ⟨k²⟩/⟨k⟩ above 2, a configuration-model graph with this degree sequence has a giant component. Connectivity is a property of the degree distribution, not of any individual edge.'
                      : 'With ⟨k²⟩/⟨k⟩ at or below 2, a configuration-model graph with this degree sequence has no giant component: the largest piece is O(log n), not a constant fraction of n.'}
                  </p>
                </Notice>

                {structure.value.paths ? (
                  <KeyValueList
                    items={[
                      quantityRow(structure.value.paths.meanPathLength),
                      quantityRow(structure.value.paths.globalEfficiency),
                      structure.value.paths.diameter
                        ? quantityRow(structure.value.paths.diameter)
                        : {
                            label: 'Diameter',
                            value: `undefined — the graph is disconnected (${structure.value.paths.componentDiameters.length} components; largest component diameter ${
                              structure.value.paths.componentDiameters[0]?.diameter ?? 0
                            })`,
                          },
                    ]}
                  />
                ) : (
                  <Notice tone="warning" title="Path lengths not computed">{structure.value.pathsError}</Notice>
                )}

                {structure.value.assortativity && (
                  <KeyValueList items={[quantityRow(structure.value.assortativity.coefficient)]} />
                )}

                <div style={{ overflowX: 'auto' }}>
                  <HistogramChart
                    title="Degree distribution"
                    description="How many nodes have each degree. A heavy right tail means a few hubs hold most of the connections, and that single fact drives the robustness, threshold and intervention results below."
                    bins={degreeBins}
                    xLabel="Degree k"
                    note="Bars are the empirical P(k) on this graph, which is exact for this graph and a single sample from the model that generated it."
                  />
                </div>

                {drawn ? (
                  <div style={{ overflowX: 'auto' }}>
                    <NetworkGraph
                      title="The graph"
                      description="Every node with its degree. The drawing is laid out in layers, so for an undirected graph the vertical position carries no meaning; the node and edge table below it is the exact structure."
                      nodes={drawn.nodes}
                      edges={drawn.edges}
                      highlight={structure.value.cores.maxCoreNodes.slice(0, 40).map((i) => graph.ids[i])}
                      highlightLabel={`Nodes in the largest (k = ${structure.value.cores.maxCore}) core`}
                    />
                  </div>
                ) : (
                  <Notice tone="info" title="Too large to draw">
                    <p style={{ margin: 0 }}>
                      This graph has {graph.n.toLocaleString('en-US')} nodes. A node-link drawing stops being legible at around {DRAWABLE_NODES}, so it is not
                      drawn — a hairball is not a visualisation. Every measure above is still exact.
                    </p>
                  </Notice>
                )}
              </>
            )}
          </Card>

          {/* ------------------------------------------------ 3. centrality */}
          <Card title="Centrality" hint="Seven measures of importance, which disagree — and the disagreement is the information.">
            {centrality && !centrality.ok && <Notice tone="error">{centrality.error}</Notice>}
            {centrality?.ok && graph && (
              <>
                <SliderField
                  label="Katz attenuation, as a fraction of the admissible bound"
                  value={config.katzAlphaFraction}
                  onChange={(katzAlphaFraction) => set({ katzAlphaFraction })}
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  hint={`The series converges only for α < 1/λ_max = ${formatValue(1 / Math.max(1e-12, centrality.value.lambdaMax), 5)}; α = ${formatValue(centrality.value.alpha, 5)} here.`}
                />
                <SliderField
                  label="PageRank damping"
                  value={config.pageRankDamping}
                  onChange={(pageRankDamping) => set({ pageRankDamping })}
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  hint="The probability a random surfer follows an edge rather than teleporting."
                />

                {!betweennessAllowed && (
                  <Notice tone="info" title="Betweenness is not computed on a graph this size">
                    <p style={{ marginTop: 0 }}>
                      Brandes betweenness is O(n·m) — a full shortest-path sweep from every one of {graph.n.toLocaleString('en-US')} nodes. This screen computes
                      it up to {BETWEENNESS_SOFT_LIMIT} nodes; the engine refuses it outright above {NETWORK_LIMITS.betweennessMaxNodes.toLocaleString('en-US')}.
                    </p>
                    <div className="oc-btn-row">
                      <Button icon="play" onClick={() => set({ runBetweenness: true })}>
                        Compute betweenness anyway
                      </Button>
                    </div>
                  </Notice>
                )}
                {centrality.value.betweenError && <Notice tone="error" title="Betweenness refused">{centrality.value.betweenError}</Notice>}
                {centrality.value.closenessError && <Notice tone="warning" title="Closeness refused">{centrality.value.closenessError}</Notice>}
                {centrality.value.katzError && <Notice tone="warning" title="Katz refused">{centrality.value.katzError}</Notice>}

                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Centrality measures per node, ranked by degree"
                    columns={centralityColumns}
                    rows={centralityRows}
                    maxHeight={420}
                  />
                </div>
                <p className="oc-chart-note">
                  Degree and k-core are exact; eigenvector, Katz and PageRank are numerical (power iteration to a stated tolerance). A node can be central by
                  degree and peripheral by betweenness, or the reverse: there is no single ranking of importance, and which one matters depends on whether you
                  care about exposure, control of flow, or influence through long walks.
                </p>
              </>
            )}
          </Card>

          {/* --------------------------------------- 4. the phase transition */}
          <Card title="The phase transition" hint="The reason this screen exists.">
            <Notice tone="info" title="Connectivity is not a smooth function of connection">
              <p style={{ marginTop: 0 }}>
                On a network, the question that matters is not what fraction of nodes fail but whether a giant connected component exists. That has a
                threshold: on an Erdős–Rényi graph a mean degree of 0.9 leaves a dust of O(log n) fragments and a mean degree of 1.1 puts a constant fraction of
                the graph into one blob. Nothing about the first number hints at the second, which is why an intuition built on independent exposures is
                qualitatively wrong near the threshold rather than merely imprecise.
              </p>
              <p style={{ marginBottom: 0 }}>
                The sweep below removes edges (bond) or nodes (site) at random with occupation probability p and measures the giant-component fraction, so p·⟨k⟩
                is the effective mean degree.
              </p>
            </Notice>

            <SelectField
              label="Percolation type"
              value={config.percolationKind}
              onChange={(percolationKind) => set({ percolationKind: percolationKind as 'site' | 'bond' })}
              options={[
                { value: 'bond', label: 'Bond — each edge present with probability p' },
                { value: 'site', label: 'Site — each node present with probability p' },
              ]}
            />
            <NumberField label="Occupation probabilities on the grid" value={config.phaseGridPoints} onChange={(phaseGridPoints) => set({ phaseGridPoints })} min={5} max={201} integer />
            <NumberField label="Replicates per probability" value={config.phaseReplicates} onChange={(phaseReplicates) => set({ phaseReplicates })} min={1} max={500} integer />

            {!config.runPhaseTransition ? (
              <>
                <Notice tone="warning" title="This sweep is not run automatically">
                  <p style={{ margin: 0 }}>
                    It is {config.phaseGridPoints} occupation probabilities × {config.phaseReplicates} replicates ={' '}
                    {(config.phaseGridPoints * config.phaseReplicates).toLocaleString('en-US')} cluster decompositions of the whole graph. It runs only when you
                    ask, and it can be cancelled while running.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button
                    icon="play"
                    variant="primary"
                    disabled={!graph}
                    onClick={() => {
                      set({ runPhaseTransition: true });
                      startPhase();
                    }}
                  >
                    Run the percolation sweep
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={!graph || phaseJob.status === 'running'} onClick={startPhase}>
                    {phaseJob.result ? 'Run again' : 'Run the percolation sweep'}
                  </Button>
                  <Button icon="x" onClick={() => { phaseJob.reset(); set({ runPhaseTransition: false }); }}>
                    Put it away
                  </Button>
                </div>
                {phaseJob.status === 'running' && (
                  <RunningState completed={phaseJob.done} total={phaseJob.total} unitLabel="occupation probabilities" onCancel={phaseJob.cancel} />
                )}
                {phaseJob.error && <Notice tone="error">{phaseJob.error}</Notice>}
                {phaseJob.result && (
                  <>
                    {phaseJob.result.meta.partial && (
                      <Notice tone="warning" title="Partial result">
                        The sweep was cancelled after {phaseJob.result.meta.runs} of {phaseJob.result.meta.requestedRuns} probabilities. Everything below covers
                        only those.
                      </Notice>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title="Giant-component fraction against occupation probability"
                        description="The simulated order parameter on this graph, with the Erdős–Rényi analytic curve for comparison. The steeper the rise, the sharper the transition."
                        series={phaseSeries}
                        xLabel="Occupation probability p"
                        yLabel="Giant-component fraction S"
                        yDomain={[0, 1]}
                        referenceLines={[
                          { value: phaseJob.result.threshold.value, label: 'Located threshold p_c', axis: 'x' },
                          ...(meanDegreeValue > 1 ? [{ value: 1 / meanDegreeValue, label: 'p where p·⟨k⟩ = 1', axis: 'x' as const }] : []),
                        ]}
                        note="The dashed curve is the large-n Poisson (Erdős–Rényi) prediction S = 1 − exp(−cS) at c = p·⟨k⟩. It is the right comparison only for a Poisson degree distribution; a heavy-tailed graph departs from it, and that departure is informative."
                      />
                    </div>
                    <KeyValueList
                      items={[
                        quantityRow(phaseJob.result.threshold),
                        quantityRow(phaseJob.result.maxSlope),
                        ...(phaseJob.result.betaExponent ? [quantityRow(phaseJob.result.betaExponent)] : []),
                        ...(phaseJob.result.gammaExponent ? [quantityRow(phaseJob.result.gammaExponent)] : []),
                        { label: 'Replicates per point', value: String(phaseJob.result.points[0]?.replicates ?? 0) },
                      ]}
                    />
                    <Notice tone="info" title="Reading the threshold">
                      <p style={{ margin: 0 }}>
                        The threshold is located numerically from the peak of the susceptibility (the mean cluster size excluding the giant component), not read
                        off the order parameter, because on a finite graph the order parameter rises smoothly. The transition is a limit statement: on a finite
                        graph it is rounded, and the rounding shrinks with n.
                      </p>
                    </Notice>
                    {phaseJob.result.limitations.length > 0 && <Notice tone="warning" title="Limitations" items={phaseJob.result.limitations} />}
                  </>
                )}
              </>
            )}
          </Card>

          {/* -------------------------------------------- 5. robustness */}
          <Card title="Robustness: random failure against targeted attack">
            <Notice tone="info" title="The asymmetry is the most useful fact in network risk">
              <p style={{ margin: 0 }}>
                A heavy-tailed network survives random failure far better than a homogeneous one with the same number of edges, because a randomly chosen node is
                almost certainly not a hub — and it collapses far faster when hubs are removed deliberately. Two curves, one graph: the gap between them is what
                an adversary is worth.
              </p>
            </Notice>
            <NumberField label="Replicates for the random strategy" value={config.robustnessReplicates} onChange={(robustnessReplicates) => set({ robustnessReplicates })} min={1} max={200} integer hint="Targeted removal is deterministic, so it uses one replicate whatever this says." />

            {!config.runRobustness ? (
              <>
                <Notice tone="warning" title="Not run automatically">
                  <p style={{ margin: 0 }}>
                    Each curve re-decomposes the graph at 20 removal levels, the recalculated-degree attack recomputes degrees after every removal, and the
                    comparison runs the same thing again on an Erdős–Rényi graph with the same node and edge count. It runs only when you ask, and it can be
                    cancelled.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button
                    icon="play"
                    variant="primary"
                    disabled={!graph}
                    onClick={() => {
                      set({ runRobustness: true });
                      startRobustness();
                    }}
                  >
                    Run the robustness comparison
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={!graph || robustJob.status === 'running'} onClick={startRobustness}>
                    {robustJob.result ? 'Run again' : 'Run the robustness comparison'}
                  </Button>
                  <Button icon="x" onClick={() => { robustJob.reset(); set({ runRobustness: false }); }}>
                    Put it away
                  </Button>
                </div>
                {robustJob.status === 'running' && (
                  <RunningState completed={robustJob.done} total={robustJob.total} unitLabel="attack strategies" onCancel={robustJob.cancel} />
                )}
                {robustJob.error && <Notice tone="error">{robustJob.error}</Notice>}
                {robustJob.result && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title="Giant-component fraction as nodes are removed"
                        description="Solid curves are this graph; dashed curves are an Erdős–Rényi graph with the same node and edge count. Each series is named in the legend, so the curves are distinguished by label and dash, not by colour alone."
                        series={robustSeries}
                        xLabel="Fraction of nodes removed"
                        yLabel="Giant-component fraction S"
                        yDomain={[0, 1]}
                      />
                    </div>
                    <KeyValueList
                      items={[
                        quantityRow(robustJob.result.main.maxGap),
                        ...robustJob.result.main.curves.flatMap((c) => [
                          { label: `Robustness index — ${c.strategy}`, value: formatValue(c.robustnessIndex.value, 5) },
                          {
                            label: `Collapse point — ${c.strategy}`,
                            value: c.collapseFraction ? pct(c.collapseFraction.value) : 'never reached within the removal range',
                          },
                        ]),
                        quantityRow(robustJob.result.reference.maxGap),
                      ]}
                    />
                    <Notice tone="warning" title="What the gap means">
                      <p style={{ margin: 0 }}>
                        The largest random-minus-targeted gap on this graph is {formatValue(robustJob.result.main.maxGap.value, 4)} of the population, against{' '}
                        {formatValue(robustJob.result.reference.maxGap.value, 4)} on the Erdős–Rényi graph with the same edge count. A larger gap means the
                        network's resilience depends on nobody choosing which nodes to remove.
                      </p>
                    </Notice>
                    {robustJob.result.main.limitations.length > 0 && <Notice tone="info" title="Limitations" items={robustJob.result.main.limitations} />}
                  </>
                )}
              </>
            )}
          </Card>

          {/* ------------------------------------------------- 6. spreading */}
          <Card title="Spreading">
            {reproduction && !reproduction.ok && <Notice tone="error">{reproduction.error}</Notice>}
            {reproduction?.ok && (
              <>
                <KeyValueList
                  items={[
                    quantityRow(reproduction.value.r.massAction),
                    quantityRow(reproduction.value.r.network),
                    quantityRow(reproduction.value.r.transmissibility),
                    quantityRow(reproduction.value.r.sisThresholdBeta),
                    quantityRow(reproduction.value.branching.probability),
                    quantityRow(reproduction.value.branching.extinctionProbability),
                    quantityRow(reproduction.value.branching.expectedOutbreakFraction),
                  ]}
                />
                <Notice tone={reproduction.value.r.thresholdEffectivelyZero ? 'warning' : 'info'} title="Two reproduction numbers, and why they differ">
                  <p style={{ marginTop: 0 }}>
                    The mass-action R₀ uses the mean degree. The network R₀ uses the mean <em>excess</em> degree (⟨k²⟩−⟨k⟩)/⟨k⟩, because an infection arriving
                    along an edge reaches a node with probability proportional to its degree — a size-biased draw, not a uniform one. On a heavy-tailed degree
                    distribution the network value is far larger, and that gap is what makes hub-targeted intervention worth anything.
                  </p>
                  {reproduction.value.r.thresholdEffectivelyZero && (
                    <p style={{ marginBottom: 0 }}>
                      On this graph the second moment is dominated by hubs, so the epidemic threshold is better described as effectively zero than as a number:
                      any positive transmission rate spreads.
                    </p>
                  )}
                </Notice>
                {reproduction.value.r.limitations.length > 0 && <Notice tone="info" title="Limitations" items={reproduction.value.r.limitations} />}
              </>
            )}

            <SelectField
              label="Compartmental model"
              value={config.spreadModel}
              onChange={(spreadModel) => set({ spreadModel: spreadModel as SpreadModel })}
              options={[
                { value: 'SIR', label: 'SIR — infected recover permanently' },
                { value: 'SIS', label: 'SIS — infected return to susceptible' },
                { value: 'SEIR', label: 'SEIR — an exposed, not-yet-infectious stage' },
              ]}
            />
            <NumberField label="Transmission rate per edge" symbol="β" value={config.beta} onChange={(beta) => set({ beta })} min={0.001} max={100} step={0.05} />
            <NumberField label="Recovery rate" symbol="γ" value={config.gamma} onChange={(gamma) => set({ gamma })} min={0.001} max={100} step={0.05} />
            {config.spreadModel === 'SEIR' && (
              <NumberField label="Incubation rate" symbol="σ" value={config.sigma} onChange={(sigma) => set({ sigma })} min={0.001} max={100} step={0.05} />
            )}
            <NumberField label="Simulation runs" value={config.spreadRuns} onChange={(spreadRuns) => set({ spreadRuns })} min={2} max={20_000} integer />

            {!config.runSpreading ? (
              <>
                <Notice tone="warning" title="The epidemic simulation is not run automatically">
                  <p style={{ margin: 0 }}>
                    {config.spreadRuns.toLocaleString('en-US')} exact-rate Gillespie runs on this network, each one a full continuous-time Markov trajectory. It
                    runs only when you ask, in chunks, and it can be cancelled.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button
                    icon="play"
                    variant="primary"
                    disabled={!graph}
                    onClick={() => {
                      set({ runSpreading: true });
                      startSpread();
                    }}
                  >
                    Run the epidemic ensemble
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={!graph || spreadJob.status === 'running'} onClick={startSpread}>
                    {spreadJob.result ? 'Run again' : 'Run the epidemic ensemble'}
                  </Button>
                  <Button icon="x" onClick={() => { spreadJob.reset(); set({ runSpreading: false }); }}>
                    Put it away
                  </Button>
                </div>
                {spreadJob.status === 'running' && (
                  <RunningState completed={spreadJob.done} total={spreadJob.total} unitLabel="simulation runs" onCancel={spreadJob.cancel} />
                )}
                {spreadJob.error && <Notice tone="error">{spreadJob.error}</Notice>}
                {spreadJob.result && (
                  <>
                    {spreadJob.result.meta.partial && (
                      <Notice tone="warning" title="Partial result">
                        Cancelled after {spreadJob.result.meta.runs} of {spreadJob.result.meta.requestedRuns} runs.
                      </Notice>
                    )}
                    <Notice tone="info" title="Runs that died out are reported separately">
                      <p style={{ margin: 0 }}>
                        {spreadJob.result.extinctionRuns} of {spreadJob.result.meta.runs} runs died out and {spreadJob.result.takeoffRuns} took off. Near the
                        threshold the final-size distribution is bimodal — a spike at a handful of cases and a second mode at a constant fraction of the
                        population — so a pooled mean falls in the empty valley between them and describes neither. The pooled figure is shown only to be
                        labelled.
                      </p>
                    </Notice>
                    <KeyValueList
                      items={[
                        quantityRow(spreadJob.result.extinctionProbability),
                        ...(spreadJob.result.meanTakeoffSize ? [quantityRow(spreadJob.result.meanTakeoffSize)] : []),
                        ...(spreadJob.result.meanTakeoffSizeInterval
                          ? [
                              {
                                label: `Confidence interval for the MEAN takeoff size (${pct(spreadJob.result.meanTakeoffSizeInterval.level)})`,
                                value: `${formatValue(spreadJob.result.meanTakeoffSizeInterval.lower, 4)} to ${formatValue(spreadJob.result.meanTakeoffSizeInterval.upper, 4)}`,
                              },
                            ]
                          : []),
                        ...spreadJob.result.takeoffSizeQuantiles.map((q) => ({
                          label: `Spread ACROSS takeoff runs — ${pct(q.p)} percentile of final size`,
                          value: formatValue(q.value, 4),
                        })),
                        quantityRow(spreadJob.result.pooledMeanSize),
                        { label: 'Runs stopped by the event or time guard', value: String(spreadJob.result.truncatedRuns) },
                      ]}
                    />
                    <Notice tone="warning" title="Two different statements">
                      <p style={{ margin: 0 }}>
                        The interval above is a confidence interval for the <em>mean</em> final size among runs that took off: it shrinks as runs are added. The
                        percentiles are the <em>spread of outcomes</em> across runs: they do not shrink, because they describe the variability of the process
                        itself. Reading one as the other is the most common way of under-stating the risk here.
                      </p>
                    </Notice>

                    {spreadJob.result.peakInfected && spreadJob.result.peakTime && (
                      <KeyValueList
                        items={[
                          {
                            label: 'Peak simultaneously infected, takeoff runs (median, 5th–95th)',
                            value: `${formatValue(spreadJob.result.peakInfected.median, 4)} (${formatValue(spreadJob.result.peakInfected.q05, 4)} – ${formatValue(spreadJob.result.peakInfected.q95, 4)})`,
                          },
                          {
                            label: 'Time of peak, takeoff runs (median, 5th–95th)',
                            value: `${formatValue(spreadJob.result.peakTime.median, 4)} (${formatValue(spreadJob.result.peakTime.q05, 4)} – ${formatValue(spreadJob.result.peakTime.q95, 4)})`,
                          },
                        ]}
                      />
                    )}

                    {spreadCurves && !spreadCurves.ok && <Notice tone="error">{spreadCurves.error}</Notice>}
                    {spreadCurves?.ok && (
                      <div style={{ overflowX: 'auto' }}>
                        <LineChart
                          title="Epidemic curves: individual network runs against the mass-action model"
                          description="Each solid curve is one simulated trajectory on this network; the dashed curve is the homogeneous-mixing ODE with the same parameters and the same mean degree. Series are named in the legend and the mean-field curve is dashed, so nothing depends on colour."
                          series={[
                            ...spreadCurves.value.runs.map((r) => ({ label: r.label, points: r.points })),
                            {
                              label: 'Mass-action (homogeneous mixing) ODE',
                              points: spreadCurves.value.mf.trajectory.map((t) => ({ x: t.t, y: t.i + t.e })),
                              dashed: true,
                            },
                          ]}
                          xLabel="Time"
                          yLabel="Fraction currently infected (or exposed)"
                          note="The individual runs are empirical and vary run to run; the ODE curve is a numerical integration of a deterministic model and has no run-to-run variation at all. That difference is the point: a deterministic model cannot produce an extinction."
                        />
                      </div>
                    )}
                    {spreadJob.result.limitations.length > 0 && <Notice tone="info" title="Limitations" items={spreadJob.result.limitations} />}
                  </>
                )}
              </>
            )}
          </Card>

          {/* --------------------------------------------- 7. interventions */}
          <Card title="Interventions">
            {paradox?.ok && (
              <>
                <KeyValueList
                  items={[
                    quantityRow(paradox.value.meanDegree),
                    quantityRow(paradox.value.meanNeighbourDegree),
                    quantityRow(paradox.value.ratio),
                    quantityRow(paradox.value.configurationModelPrediction),
                    quantityRow(paradox.value.nodesWithFewerFriendsThanTheirFriends),
                  ]}
                />
                <Notice tone="info" title="The friendship paradox, and the strategy it buys">
                  <p style={{ margin: 0 }}>
                    A randomly chosen neighbour has higher expected degree than a randomly chosen node, because a high-degree node is reachable along more
                    edges. So immunising <em>a random contact of a random person</em> reaches hubs without anyone knowing the network — which is the whole
                    difficulty with hub-targeted strategies in practice. The acquaintance arm below uses exactly that, and uses no information the random arm
                    could not also have.
                  </p>
                </Notice>
              </>
            )}
            {paradox && !paradox.ok && <Notice tone="warning">{paradox.error}</Notice>}

            <SliderField
              label="Dose budget, as a fraction of the population"
              value={config.doseFraction}
              onChange={(doseFraction) => set({ doseFraction })}
              min={0.01}
              max={0.9}
              step={0.01}
              hint="Every arm gets the same budget, so the comparison is about targeting, not about quantity."
            />
            <NumberField label="Epidemic runs per arm" value={config.interventionRuns} onChange={(interventionRuns) => set({ interventionRuns })} min={2} max={5000} integer />

            {!config.runInterventions ? (
              <>
                <Notice tone="warning" title="Not run automatically">
                  <p style={{ margin: 0 }}>
                    Four arms (no doses, random, acquaintance, hub-targeted) × {config.interventionRuns.toLocaleString('en-US')} Gillespie runs each ={' '}
                    {(4 * config.interventionRuns).toLocaleString('en-US')} simulated epidemics. This comparison runs in one synchronous engine call, so unlike
                    the panels above it cannot be interrupted once started — keep the run count modest.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button
                    icon="play"
                    variant="primary"
                    disabled={!graph}
                    onClick={() => {
                      set({ runInterventions: true });
                      runInterventionComparison();
                    }}
                  >
                    Compare immunisation strategies
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" disabled={!graph} onClick={runInterventionComparison}>
                    {interventions ? 'Run again' : 'Compare immunisation strategies'}
                  </Button>
                  <Button icon="x" onClick={() => { setInterventions(null); set({ runInterventions: false }); }}>
                    Put it away
                  </Button>
                </div>
                {interventions && !interventions.ok && <Notice tone="error">{interventions.error}</Notice>}
                {interventions?.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Immunisation strategies at the same dose budget"
                        columns={[
                          { key: 's', header: 'Strategy', render: (r) => STRATEGY_LABEL[r.strategy] ?? r.strategy },
                          { key: 'e', header: 'Expected infected per 100', numeric: true, render: (r) => formatValue(r.expectedInfectedPer100.value, 4) },
                          { key: 'x', header: 'P(dies out)', numeric: true, render: (r) => formatValue(r.ensemble.extinctionProbability.value, 4) },
                          {
                            key: 't',
                            header: 'Mean size | takeoff',
                            numeric: true,
                            render: (r) => (r.ensemble.meanTakeoffSize ? formatValue(r.ensemble.meanTakeoffSize.value, 4) : 'no run took off'),
                          },
                          {
                            key: 'd',
                            header: 'Mean degree immunised',
                            numeric: true,
                            render: (r) => (r.immunisation ? formatValue(r.immunisation.meanDegreeImmunised.value, 4) : '—'),
                          },
                          {
                            key: 'ee',
                            header: 'Edge endpoints covered',
                            numeric: true,
                            render: (r) => (r.immunisation ? pct(r.immunisation.edgeEndpointShare.value) : '—'),
                          },
                        ]}
                        rows={interventions.value.arms}
                      />
                    </div>
                    <Notice tone="success" title={`Lowest expected infections: ${STRATEGY_LABEL[interventions.value.best] ?? interventions.value.best}`}>
                      <p style={{ margin: 0 }}>
                        {interventions.value.doses} doses ({pct(interventions.value.doseFraction)} of the population). The comparison statistic is the{' '}
                        <em>unconditional</em> expected number infected, because that is what a dose budget buys; each arm's conditional-on-takeoff figures are
                        in the table beside it and are a different statement.
                      </p>
                    </Notice>
                    <Notice tone="info" items={interventions.value.notes} />
                    <Notice tone="warning" title="Limitations" items={interventions.value.limitations} />
                  </>
                )}
              </>
            )}

            <Disclosure title="Greedy influence maximisation">
              <NumberField label="Seeds to choose" symbol="k" value={config.influenceSeeds} onChange={(influenceSeeds) => set({ influenceSeeds })} min={1} max={Math.max(1, graph ? graph.n : 1)} integer />
              <SliderField label="Per-edge transmission probability" value={config.influenceP} onChange={(influenceP) => set({ influenceP })} min={0.01} max={0.9} step={0.01} />
              <NumberField label="Replicates per spread estimate" value={config.influenceReplicates} onChange={(influenceReplicates) => set({ influenceReplicates })} min={5} max={5000} integer />
              {!config.runInfluence ? (
                <>
                  <Notice tone="warning" title="Not run automatically">
                    <p style={{ margin: 0 }}>
                      Greedy selection evaluates the expected spread of every remaining candidate at each of {config.influenceSeeds} steps, each evaluation being{' '}
                      {config.influenceReplicates} independent-cascade simulations. It runs only when you ask, and it can be cancelled.
                    </p>
                  </Notice>
                  <div className="oc-btn-row">
                    <Button icon="play" variant="primary" disabled={!graph} onClick={() => { set({ runInfluence: true }); startInfluence(); }}>
                      Run influence maximisation
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="oc-btn-row">
                    <Button icon="play" variant="primary" disabled={!graph || influenceJob.status === 'running'} onClick={startInfluence}>
                      {influenceJob.result ? 'Run again' : 'Run influence maximisation'}
                    </Button>
                    <Button icon="x" onClick={() => { influenceJob.reset(); set({ runInfluence: false }); }}>
                      Put it away
                    </Button>
                  </div>
                  {influenceJob.status === 'running' && (
                    <RunningState completed={influenceJob.done} total={influenceJob.total} unitLabel="seeds chosen" onCancel={influenceJob.cancel} />
                  )}
                  {influenceJob.error && <Notice tone="error">{influenceJob.error}</Notice>}
                  {influenceJob.result && (
                    <>
                      <KeyValueList
                        items={[
                          { label: 'Chosen seeds', value: influenceJob.result.seedIds.join(', ') },
                          quantityRow(influenceJob.result.expectedSpread),
                          quantityRow(influenceJob.result.approximationGuarantee),
                          {
                            label: 'Implied bounds on the optimum',
                            value: `at least ${formatValue(influenceJob.result.impliedOptimumBounds.lower, 5)}, at most ${formatValue(influenceJob.result.impliedOptimumBounds.upperBound, 5)}`,
                          },
                          { label: 'Marginal gain per step', value: influenceJob.result.marginalGains.map((v) => formatValue(v, 4)).join(' → ') },
                        ]}
                      />
                      <Notice tone="info" title={`The (1 − 1/e) guarantee: ${formatValue(GREEDY_APPROXIMATION_RATIO, 5)}`}>
                        <p style={{ margin: 0 }}>
                          Greedy selection on a submodular spread function is guaranteed to reach at least 1 − 1/e ≈ 63.2% of the best achievable spread for any
                          seed set of this size. The guarantee holds for the <em>exact</em> expected spread; here the spread is estimated by simulation, so it
                          is inherited only up to the Monte Carlo error reported above. Marginal gains should be non-increasing — if they are not, the estimates
                          are too noisy for the guarantee to mean anything.
                        </p>
                      </Notice>
                      {influenceJob.result.limitations.length > 0 && <Notice tone="warning" title="Limitations" items={influenceJob.result.limitations} />}
                    </>
                  )}
                </>
              )}
            </Disclosure>
          </Card>

          {/* -------------------------------------------- 8. explanation */}
          <Card title="How to read all of this">
            <ExplanationPanel
              explanation={{
                method: 'Graph measures, percolation sweeps and Gillespie spreading simulation on a supplied or generated network',
                formula: 'S = 1 − exp(−cS) (Erdős–Rényi giant component) · R₀ = T(⟨k²⟩ − ⟨k⟩)/⟨k⟩ (network) · ⟨k²⟩/⟨k⟩ > 2 (Molloy–Reed)',
                steps: [
                  { label: 'Graph', expression: 'validated node and edge lists', value: graph ? `${graph.n} nodes, ${graph.m} edges` : 'none built' },
                  { label: 'Mean degree', expression: '⟨k⟩ = 2m/n', value: structure?.ok ? formatValue(structure.value.degrees.meanDegree.value, 5) : '—' },
                  {
                    label: 'Giant-component fraction',
                    expression: 'S = |largest component| / n',
                    value: structure?.ok ? formatValue(structure.value.comps.giantFraction.value, 5) : '—',
                  },
                  {
                    label: 'Located percolation threshold',
                    expression: 'peak of the susceptibility',
                    value: phaseJob.result ? formatValue(phaseJob.result.threshold.value, 5) : 'not run',
                  },
                  {
                    label: 'Network R₀',
                    expression: 'T(⟨k²⟩ − ⟨k⟩)/⟨k⟩',
                    value: reproduction?.ok ? formatValue(reproduction.value.r.network.value, 5) : '—',
                  },
                ],
                assumptions: [
                  'Every number on this screen is conditional on the supplied network structure. Contact, dependency and obligation networks are almost never observed directly; if the edge set is wrong, everything here is wrong in ways this screen cannot detect.',
                  'Edges are untimed and undirected unless the graph says otherwise: a contact that happened once and a contact that happens daily look identical.',
                  'Immunisation is treated as perfect and instantaneous, and uptake as total.',
                  'A generated graph is one sample from its model, not the model. A different seed gives a different graph, and near a threshold the difference can be large.',
                ],
                limitations: [
                  'Graph measures are exact for the graph given. Spectra, located thresholds and the ODE integration are numerical. Every simulation result is empirical and carries Monte Carlo error.',
                  'The phase transition is a large-n limit statement. On a finite graph it is rounded off, and the located threshold is an estimate from a finite grid of finite replicates.',
                  'The analytic giant-component curve is the Poisson (Erdős–Rényi) one. It is the right comparison only for a Poisson degree distribution.',
                  'Nothing here assumes independence between nodes; what it does assume is that the edges are the real ones.',
                ],
                exactness: 'numerical',
              }}
              defaultOpen
            />
            <KeyValueList
              items={[
                { label: 'Graph measures', value: <Badge variant="exact">exact for the graph given</Badge> },
                { label: 'Spectra, thresholds and the ODE', value: <Badge variant="numerical">numerical</Badge> },
                { label: 'Percolation, robustness, epidemics, influence', value: <Badge variant="empirical">empirical</Badge> },
                { label: 'The network itself', value: <Badge variant="assumed">assumed</Badge> },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

const STRATEGY_LABEL: Record<string, string> = {
  none: 'No doses (baseline)',
  random: 'Random immunisation',
  acquaintance: 'Acquaintance — a random contact of a random node',
  degree: 'Hub-targeted (highest degree)',
  'recalculated-degree': 'Hub-targeted, degrees recomputed after each removal',
};
