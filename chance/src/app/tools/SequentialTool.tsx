/**
 * Decisions made repeatedly over time.
 *
 * `DecisionTool` answers "given what I believe now, what is the single best
 * choice?". This screen answers the harder question: what to do REPEATEDLY,
 * when each choice changes both what I will face next and what I will know
 * next. That is the Markov decision process, its partially observable cousin,
 * optimal stopping, bandits and learning without a model.
 *
 * Two conventions in the configuration are deliberate:
 *
 *  - Transitions and rewards are stored indexed by ACTION first
 *    (`[action][state][next]`), not by state first as the engine's `MDP` wants.
 *    That is the shape `MatrixEditor` edits — one row-stochastic matrix per
 *    action, with its own per-row sum feedback — so the editor is reused rather
 *    than reimplemented, and `buildMDP` transposes once inside a memo.
 *  - The POMDP is described by a handful of numbers (observation accuracy, the
 *    penalty, the reward, the cost of looking) rather than by three full
 *    tensors. A hidden-state model large enough to need a tensor editor is also
 *    too large for exact alpha-vector value iteration, so the editor would
 *    promise something the exact solver cannot deliver.
 *
 * Everything heavy is behind a button: bandit replications, the Gittins index
 * table and the learning runs. Solving the small chain exactly is milliseconds
 * and runs on open, so the screen says something true the moment it is opened.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  alphaSpendingBoundaries,
  alphaVectorValue,
  averageRewardMDP,
  banditSteps,
  beliefUpdate,
  discountSensitivity,
  evaluatePolicy,
  exactPOMDPValueIteration,
  fastInformedBound,
  finiteHorizonMDP,
  finiteHorizonSearch,
  gittinsIndexTable,
  jobSearch,
  laiRobbinsBound,
  lpSolveMDP,
  policyIteration,
  qLearning,
  qmdpBound,
  sarsa,
  secretaryProblem,
  sprt,
  underlyingMDP,
  validateMDP,
  valueIteration,
  valueOfInformation,
  type BanditAlgorithmConfig,
  type BanditAlgorithmId,
  type BanditExperimentResult,
  type MDP,
  type POMDP,
  type Provenance,
  type SpendingFunction,
} from '../../engine/sequential';
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
  RawNumberInput,
  RunningState,
  Segmented,
  SelectField,
  SliderField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { BarChart, HeatmapChart, LineChart, type CurveSeries } from '../../ui/charts/charts';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';
import { MatrixEditor } from './shared/MatrixEditor';

/* ------------------------------------------------------------------ config */

export type SequentialMode = 'mdp' | 'discounting' | 'pomdp' | 'stopping' | 'bandits' | 'learning';

export interface SequentialConfig {
  mode: SequentialMode;

  /* The Markov decision process. */
  stateLabels: string[];
  actionLabels: string[];
  /** transitionsByAction[action][state][next]. One matrix per action. */
  transitionsByAction: number[][][];
  /** rewardsByAction[action][state] = R(s, a), the expected immediate reward. */
  rewardsByAction: number[][];
  discount: number;
  /** Stages for the finite-horizon backward induction. */
  horizon: number;
  /** A policy of the user's own, evaluated against the optimum. */
  userPolicy: number[];

  /* How the answer depends on the discount factor. */
  scanLo: number;
  scanHi: number;
  scanPoints: number;

  /* The hidden-state problem. */
  pomdpAccuracy: number;
  pomdpListenCost: number;
  pomdpPenalty: number;
  pomdpReward: number;
  /** P(the hazard is behind the left door) — the prior belief. */
  pomdpBelief: number;
  pomdpHorizon: number;
  pomdpDiscount: number;
  pomdpObservation: number;

  /* Optimal stopping. */
  secretaryN: number;
  offerLow: number;
  offerHigh: number;
  searchCost: number;
  searchDiscount: number;
  searchOffers: number;
  sprtP0: number;
  sprtP1: number;
  sprtAlpha: number;
  sprtBeta: number;
  sprtMaxSteps: number;
  looks: number;
  spending: SpendingFunction;
  spendingAlpha: number;
  spendingPower: number;

  /* Bandits. All of this is behind a button. */
  runBandits: boolean;
  armMeans: number[];
  banditHorizon: number;
  replications: number;
  algorithms: BanditAlgorithmId[];
  epsilon: number;
  banditSeed: string;
  runGittins: boolean;
  gittinsDiscount: number;
  gittinsMaxPulls: number;

  /* Learning without a model. Also behind a button. */
  runLearning: boolean;
  episodes: number;
  stepsPerEpisode: number;
  explorationEpsilon: number;
  minVisitsPerPair: number;
  learningSeed: string;
}

/**
 * A three-state maintenance chain. It is chosen because every claim this screen
 * makes is visible in it immediately: the three solvers agree, the optimal
 * policy switches at γ ≈ 0.518, the finite-horizon policy is time-dependent in
 * its last stage, and ε-greedy learning fails to visit the broken-and-operating
 * pair often enough to converge — which the engine reports rather than hides.
 */
export const SEQUENTIAL_DEFAULT: SequentialConfig = {
  mode: 'mdp',

  stateLabels: ['Good', 'Worn', 'Broken'],
  actionLabels: ['Operate', 'Service'],
  transitionsByAction: [
    // Operate: the machine degrades.
    [
      [0.8, 0.2, 0],
      [0, 0.6, 0.4],
      [0, 0, 1],
    ],
    // Service: it is restored, usually.
    [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0.7, 0.3, 0],
    ],
  ],
  rewardsByAction: [
    [10, 6, -8],
    [6, 1, -3],
  ],
  discount: 0.9,
  horizon: 5,
  userPolicy: [0, 0, 1],

  scanLo: 0,
  scanHi: 0.99,
  scanPoints: 41,

  pomdpAccuracy: 0.85,
  pomdpListenCost: 1,
  pomdpPenalty: 100,
  pomdpReward: 10,
  pomdpBelief: 0.5,
  pomdpHorizon: 3,
  pomdpDiscount: 0.95,
  pomdpObservation: 0,

  secretaryN: 50,
  offerLow: 0,
  offerHigh: 100,
  searchCost: 2,
  searchDiscount: 0.95,
  searchOffers: 10,
  sprtP0: 0.2,
  sprtP1: 0.4,
  sprtAlpha: 0.05,
  sprtBeta: 0.1,
  sprtMaxSteps: 400,
  looks: 4,
  spending: 'obrien-fleming',
  spendingAlpha: 0.05,
  spendingPower: 0.9,

  runBandits: false,
  armMeans: [0.5, 0.45, 0.4],
  banditHorizon: 2000,
  replications: 40,
  algorithms: ['thompson-beta', 'ucb1', 'kl-ucb', 'epsilon-greedy'],
  epsilon: 0.1,
  banditSeed: 'orbis-bandit',
  runGittins: false,
  gittinsDiscount: 0.9,
  gittinsMaxPulls: 20,

  runLearning: false,
  episodes: 300,
  stepsPerEpisode: 60,
  explorationEpsilon: 0.2,
  minVisitsPerPair: 100,
  learningSeed: 'orbis-learn',
};

/* ----------------------------------------------------------------- helpers */

const MODE_OPTIONS: { value: SequentialMode; label: string }[] = [
  { value: 'mdp', label: 'Markov decision process' },
  { value: 'discounting', label: 'Discounting' },
  { value: 'pomdp', label: 'Hidden state' },
  { value: 'stopping', label: 'When to stop' },
  { value: 'bandits', label: 'Explore or exploit' },
  { value: 'learning', label: 'Learning without a model' },
];

const MODE_HINT: Record<SequentialMode, string> = {
  mdp: 'Solve the process exactly by three independent routes and check that they agree, then compare a policy of your own against the optimum.',
  discounting: 'How much the future counts changes what you should do now, and there is an exact discount factor at which the advice flips.',
  pomdp: 'You cannot see which state you are in, which is the realistic case. Belief updating, the exact value function, and bounds that are honest about being optimistic.',
  stopping: 'One irrevocable decision about when to stop looking — and the boundaries that make stopping early legitimate rather than cheating.',
  bandits: 'Repeated choices where the only way to learn about an option is to use it. Regret is random, so it is reported as a distribution over replications.',
  learning: 'Learning a policy from samples alone, with the convergence diagnostics that say whether the learned values mean anything yet.',
};

const ALGORITHM_OPTIONS: { id: BanditAlgorithmId; label: string }[] = [
  { id: 'thompson-beta', label: 'Thompson sampling (Beta–Bernoulli)' },
  { id: 'ucb1', label: 'UCB1' },
  { id: 'ucb-tuned', label: 'UCB-tuned' },
  { id: 'kl-ucb', label: 'KL-UCB' },
  { id: 'epsilon-greedy', label: 'ε-greedy (decaying)' },
  { id: 'exp3', label: 'EXP3 (adversarial)' },
  { id: 'successive-elimination', label: 'Successive elimination' },
];

/** The engine's MDP, transposed out of the per-action editing shape. */
function buildMDP(config: SequentialConfig): MDP {
  const n = config.stateLabels.length;
  return {
    nStates: n,
    stateLabels: config.stateLabels,
    actions: config.stateLabels.map(() => config.actionLabels),
    transitions: Array.from({ length: n }, (_, s) => config.transitionsByAction.map((m) => (m[s] ?? []).slice())),
    rewards: Array.from({ length: n }, (_, s) => config.rewardsByAction.map((r) => r[s] ?? 0)),
  };
}

/**
 * The hidden-state problem: two doors, a hazard behind one of them, and the
 * option of paying to listen before choosing. Built from the four numbers in
 * the configuration so that the model stays serialisable and small enough for
 * the exact solver.
 */
function buildPOMDP(config: SequentialConfig): POMDP {
  const acc = config.pomdpAccuracy;
  const cost = -config.pomdpListenCost;
  return {
    nStates: 2,
    nObservations: 2,
    actions: ['Listen', 'Open the left door', 'Open the right door'],
    stateLabels: ['Hazard on the left', 'Hazard on the right'],
    observationLabels: ['Heard it on the left', 'Heard it on the right'],
    transitions: [
      // Listening does not move the hazard; opening a door ends the episode and
      // the next one starts with the hazard placed afresh.
      [
        [1, 0],
        [0, 1],
      ],
      [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
      [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
    ],
    observations: [
      [
        [acc, 1 - acc],
        [1 - acc, acc],
      ],
      [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
      [
        [0.5, 0.5],
        [0.5, 0.5],
      ],
    ],
    rewards: [
      [cost, cost],
      [-config.pomdpPenalty, config.pomdpReward],
      [config.pomdpReward, -config.pomdpPenalty],
    ],
  };
}

/** An Explanation built from what the engine actually reported. */
function explanationOf(provenance: Provenance, formula?: string): Explanation {
  return {
    method: provenance.method,
    ...(formula ? { formula } : {}),
    steps: [],
    assumptions: provenance.assumedInputs,
    limitations: provenance.limitations,
    exactness: provenance.exactness,
  };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run an engine call, turning an EngineError into a message to display. */
function attempt<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.issues.map((i) => i.message).join(' ') };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function ErrorNotice({ outcome }: { outcome: Outcome<unknown> }) {
  if (outcome.ok) return null;
  return <Notice tone="error">{outcome.error}</Notice>;
}

/**
 * Drive a cancellable generator from the main thread.
 *
 * The timeout between `next()` calls is the whole point: it returns control to
 * the event loop so the Cancel button can be clicked, for the same reason the
 * engine's runners yield between chunks instead of looping synchronously.
 */
function useGeneratorRun<R>() {
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'cancelled' | 'error'; progress: number; result: R | null; error: string | null }>({
    status: 'idle',
    progress: 0,
    result: null,
    error: null,
  });
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  // Abandon a run when the user leaves the screen: nothing would display the
  // result, and the pump would keep the tab busy.
  useEffect(
    () => () => {
      cancelled.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const start = useCallback((make: () => Generator<number, R, void>) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    cancelled.current = false;
    setState({ status: 'running', progress: 0, result: null, error: null });
    let gen: Generator<number, R, void>;
    try {
      gen = make();
    } catch (e) {
      setState({ status: 'error', progress: 0, result: null, error: e instanceof EngineError ? e.issues.map((i) => i.message).join(' ') : String(e) });
      return;
    }
    const pump = () => {
      if (cancelled.current) return;
      let latest = 0;
      try {
        // A couple of chunks per tick: one timeout per yield would make a long
        // run crawl, while a handful keeps each tick short enough to stay
        // responsive.
        for (let i = 0; i < 2; i++) {
          const next = gen.next();
          if (next.done) {
            setState({ status: 'done', progress: 1, result: next.value, error: null });
            return;
          }
          latest = next.value;
        }
      } catch (e) {
        setState({ status: 'error', progress: 0, result: null, error: e instanceof EngineError ? e.issues.map((i) => i.message).join(' ') : String(e) });
        return;
      }
      setState((s) => ({ ...s, progress: latest }));
      timer.current = window.setTimeout(pump, 0);
    };
    pump();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setState((s) => (s.status === 'running' ? { ...s, status: 'cancelled' } : s));
  }, []);

  return { ...state, start, cancel };
}

/* -------------------------------------------------------------- the screen */

export function SequentialTool({ config }: { config: SequentialConfig }) {
  const app = useApp();
  const set = (patch: Partial<SequentialConfig>) => app.updateConfig({ ...config, ...patch });

  const mode = config.mode;
  const mdp = useMemo(() => buildMDP(config), [config]);
  const mdpIssues = useMemo(() => validateMDP(mdp, config.discount), [mdp, config.discount]);
  const valid = mdpIssues.length === 0;

  /* ------------------------------------------------- section 1: the MDP */

  // Three independent routes to the same optimum. Solving a three-state chain
  // three times is well under a millisecond, so this runs on open.
  const solved = useMemo(() => {
    if (!valid) return null;
    return attempt(() => {
      const vi = valueIteration(mdp, config.discount, { tolerance: 1e-10 });
      const pi = policyIteration(mdp, config.discount);
      const lp = lpSolveMDP(mdp, config.discount);
      const average = averageRewardMDP(mdp);
      const finite = finiteHorizonMDP(mdp, config.horizon, config.discount);
      return { vi, pi, lp, average, finite };
    });
  }, [mdp, valid, config.discount, config.horizon]);

  const policyEvaluation = useMemo(() => {
    if (!valid) return null;
    return attempt(() => evaluatePolicy(mdp, config.userPolicy, config.discount));
  }, [mdp, valid, config.userPolicy, config.discount]);

  /** Do the three solvers pick the same action everywhere, and agree on value? */
  const agreement = useMemo(() => {
    if (!solved?.ok) return null;
    const { vi, pi, lp } = solved.value;
    const policiesAgree = pi.policy.every((a, s) => a === vi.policy[s] && a === lp.policy[s]);
    const maxValueGap = Math.max(...pi.values.map((v, s) => Math.max(Math.abs(v - vi.values[s]), Math.abs(v - lp.values[s]))));
    return { policiesAgree, maxValueGap };
  }, [solved]);

  /* --------------------------------------- section 2: discount sensitivity */

  const sensitivity = useMemo(() => {
    if (!valid || mode !== 'discounting') return null;
    return attempt(() => discountSensitivity(mdp, config.scanLo, config.scanHi, { gridPoints: config.scanPoints }));
  }, [mdp, valid, mode, config.scanLo, config.scanHi, config.scanPoints]);

  // The optimal value of each state as γ moves, by exact policy iteration at
  // each point. 21 solves of a three-state chain; the chart shows only numbers
  // the engine returned.
  const discountCurves = useMemo(() => {
    if (!valid || mode !== 'discounting') return null;
    return attempt(() => {
      const points = 21;
      const rows: { gamma: number; values: number[] }[] = [];
      for (let i = 0; i < points; i++) {
        const gamma = config.scanLo + ((config.scanHi - config.scanLo) * i) / (points - 1);
        rows.push({ gamma, values: policyIteration(mdp, gamma).values });
      }
      return rows;
    });
  }, [mdp, valid, mode, config.scanLo, config.scanHi]);

  /* ------------------------------------------------- section 3: the POMDP */

  const pomdp = useMemo(() => buildPOMDP(config), [config]);
  const belief = useMemo(() => [config.pomdpBelief, 1 - config.pomdpBelief], [config.pomdpBelief]);

  const pomdpResult = useMemo(() => {
    if (mode !== 'pomdp') return null;
    return attempt(() => {
      const exact = exactPOMDPValueIteration(pomdp, config.pomdpHorizon, config.pomdpDiscount);
      const atBelief = alphaVectorValue(exact, belief);
      const qmdp = qmdpBound(pomdp, belief, config.pomdpDiscount);
      const fib = fastInformedBound(pomdp, belief, config.pomdpDiscount);
      const voi = valueOfInformation(pomdp, belief, config.pomdpDiscount, config.pomdpHorizon);
      const updated = beliefUpdate(pomdp, belief, 0, config.pomdpObservation);
      // The exact value function across the whole belief line, which is what
      // makes the piecewise-linear convex shape visible.
      const curve: { b: number; value: number; action: number }[] = [];
      for (let i = 0; i <= 50; i++) {
        const b = i / 50;
        const v = alphaVectorValue(exact, [b, 1 - b]);
        curve.push({ b, value: v.value, action: v.action });
      }
      return { exact, atBelief, qmdp, fib, voi, updated, curve, observable: underlyingMDP(pomdp) };
    });
  }, [pomdp, mode, belief, config.pomdpHorizon, config.pomdpDiscount, config.pomdpObservation]);

  /* ----------------------------------------------- section 4: stopping */

  const stopping = useMemo(() => {
    if (mode !== 'stopping') return null;
    const quantile = (p: number) => config.offerLow + p * (config.offerHigh - config.offerLow);
    return {
      secretary: attempt(() => secretaryProblem(config.secretaryN)),
      house: attempt(() => jobSearch(quantile, { searchCost: config.searchCost, discount: config.searchDiscount })),
      deadline: attempt(() => finiteHorizonSearch(config.searchOffers, quantile, { searchCost: config.searchCost, discount: config.searchDiscount })),
      test: attempt(() => sprt(config.sprtP0, config.sprtP1, config.sprtAlpha, config.sprtBeta, { maxSteps: config.sprtMaxSteps })),
      group: attempt(() => alphaSpendingBoundaries(config.looks, config.spendingAlpha, config.spending, { power: config.spendingPower })),
    };
  }, [
    mode,
    config.secretaryN,
    config.offerLow,
    config.offerHigh,
    config.searchCost,
    config.searchDiscount,
    config.searchOffers,
    config.sprtP0,
    config.sprtP1,
    config.sprtAlpha,
    config.sprtBeta,
    config.sprtMaxSteps,
    config.looks,
    config.spending,
    config.spendingAlpha,
    config.spendingPower,
  ]);

  /* ------------------------------------------------ section 5: bandits */

  const banditRun = useGeneratorRun<BanditExperimentResult>();
  const armLabels = useMemo(() => config.armMeans.map((_, i) => `Arm ${String.fromCharCode(65 + i)}`), [config.armMeans]);

  const banditRequest = useMemo(() => {
    const algorithms: BanditAlgorithmConfig[] = config.algorithms.map((id) =>
      id === 'epsilon-greedy' ? { id, epsilon: config.epsilon, decay: true } : id === 'successive-elimination' ? { id, delta: 0.05 } : { id },
    );
    return {
      spec: { family: 'bernoulli' as const, means: config.armMeans, armLabels },
      horizon: config.banditHorizon,
      replications: config.replications,
      algorithms,
      seed: config.banditSeed,
    };
  }, [config.algorithms, config.epsilon, config.armMeans, armLabels, config.banditHorizon, config.replications, config.banditSeed]);

  const startBandits = useCallback(() => {
    banditRun.start(() => banditSteps(banditRequest));
  }, [banditRun, banditRequest]);

  // A persisted configuration that already asked for the study starts it once,
  // asynchronously, so first paint is never blocked by it.
  const banditStatus = banditRun.status;
  useEffect(() => {
    if (mode === 'bandits' && config.runBandits && banditStatus === 'idle') startBandits();
  }, [mode, config.runBandits, banditStatus, startBandits]);

  const laiRobbins = useMemo(() => {
    if (mode !== 'bandits') return null;
    return attempt(() => laiRobbinsBound({ family: 'bernoulli', means: config.armMeans, armLabels }, config.banditHorizon));
  }, [mode, config.armMeans, armLabels, config.banditHorizon]);

  // The Gittins table is the one genuinely slow exact computation here (several
  // hundred milliseconds), so it only runs once asked for.
  const gittins = useMemo(() => {
    if (mode !== 'bandits' || !config.runGittins) return null;
    return attempt(() => gittinsIndexTable(config.gittinsDiscount, config.gittinsMaxPulls));
  }, [mode, config.runGittins, config.gittinsDiscount, config.gittinsMaxPulls]);

  /* ----------------------------------------------- section 6: learning */

  const learning = useMemo(() => {
    if (mode !== 'learning' || !config.runLearning || !valid) return null;
    const request = {
      mdp,
      discount: config.discount,
      episodes: config.episodes,
      stepsPerEpisode: config.stepsPerEpisode,
      exploration: { kind: 'epsilon-greedy' as const, epsilon: config.explorationEpsilon },
      stepSize: { kind: 'inverse-count' as const, initial: 1 },
      minVisitsPerPair: config.minVisitsPerPair,
      compareWithOptimum: true,
      seed: config.learningSeed,
    };
    return {
      q: attempt(() => qLearning(request)),
      sarsa: attempt(() => sarsa({ ...request, seed: `${config.learningSeed}-sarsa` })),
    };
  }, [
    mode,
    config.runLearning,
    valid,
    mdp,
    config.discount,
    config.episodes,
    config.stepsPerEpisode,
    config.explorationEpsilon,
    config.minVisitsPerPair,
    config.learningSeed,
  ]);

  /* ------------------------------------------------------------- editing */

  const setActionMatrix = (action: number, states: string[], matrix: number[][]) => {
    const n = states.length;
    const previous = config.stateLabels.length;
    if (n === previous) {
      set({
        stateLabels: states,
        transitionsByAction: config.transitionsByAction.map((m, a) => (a === action ? matrix : m)),
      });
      return;
    }
    // A state was added or removed in one editor, and every other action's
    // matrix, every reward row and the user's policy have to follow or the MDP
    // is malformed. Which state went is recovered positionally: the editor
    // appends on an add, and on a remove the labels agree up to the index that
    // disappeared. Dropping the LAST row and column instead would silently
    // misalign the other actions when the state removed was not the last one.
    const removedAt = n < previous ? config.stateLabels.findIndex((label, i) => states[i] !== label) : -1;
    const oldIndex = (s: number): number => (removedAt >= 0 && s >= removedAt ? s + 1 : s);
    const resize = (m: number[][], a: number): number[][] => {
      if (a === action) return matrix.map((row) => row.slice(0, n));
      return Array.from({ length: n }, (_, s) =>
        Array.from({ length: n }, (_, j) => {
          // An added state is unreachable until the user says otherwise, and a
          // row of zeros is not a probability distribution — so it stays put.
          if (removedAt < 0 && s >= previous) return s === j ? 1 : 0;
          return m[oldIndex(s)]?.[oldIndex(j)] ?? 0;
        }),
      );
    };
    set({
      stateLabels: states,
      transitionsByAction: config.transitionsByAction.map(resize),
      rewardsByAction: config.rewardsByAction.map((r) => Array.from({ length: n }, (_, s) => r[oldIndex(s)] ?? 0)),
      userPolicy: Array.from({ length: n }, (_, s) => config.userPolicy[oldIndex(s)] ?? 0),
    });
  };

  const setReward = (action: number, state: number, value: number) => {
    set({ rewardsByAction: config.rewardsByAction.map((r, a) => (a === action ? r.map((v, s) => (s === state ? value : v)) : r)) });
  };

  const setArmMean = (arm: number, value: number) => {
    set({ armMeans: config.armMeans.map((m, i) => (i === arm ? value : m)) });
  };

  const toggleAlgorithm = (id: BanditAlgorithmId, on: boolean) => {
    set({ algorithms: on ? [...config.algorithms, id] : config.algorithms.filter((a) => a !== id) });
  };

  return (
    <>
      <ToolHeader toolId="sequential" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What kind of repeated decision?">
            <Segmented label="Topic" value={mode} onChange={(m) => set({ mode: m })} options={MODE_OPTIONS} />
            <p className="oc-chart-note">{MODE_HINT[mode]}</p>
          </Card>

          {(mode === 'mdp' || mode === 'discounting' || mode === 'learning') && (
            <>
              <Card title="States, actions and transitions" hint="One transition matrix per action. Each row must sum to 1; the engine names the state and action of any row that does not.">
                <TextField
                  label="Action names"
                  value={config.actionLabels.join(', ')}
                  onChange={(text) => {
                    const labels = text.split(',').map((s) => s.trim());
                    if (labels.length !== config.actionLabels.length) return; // Adding an action needs a matrix; use the button below.
                    set({ actionLabels: labels });
                  }}
                  hint="Rename the actions here. Use the button below to add one."
                />
                {config.actionLabels.map((action, a) => (
                  <div key={a} style={{ marginBottom: 'var(--s4)' }}>
                    <p style={{ fontSize: 12.5, fontWeight: 600, margin: '0 0 var(--s2)' }}>Action: {action}</p>
                    <MatrixEditor
                      states={config.stateLabels}
                      matrix={config.transitionsByAction[a] ?? []}
                      onChange={(states, matrix) => setActionMatrix(a, states, matrix)}
                      issues={mdpIssues.filter((i) => transitionActionOf(i.field) === a)}
                      maxStates={8}
                      context={`the action ${action}`}
                      title={`Transition probabilities under ${action}`}
                    />
                    <div className="oc-field">
                      <span className="oc-field__label">Immediate reward R(state, {action})</span>
                      <div style={{ overflowX: 'auto' }}>
                        <div className="oc-matrix-grid" style={{ gridTemplateColumns: `repeat(${config.stateLabels.length}, minmax(72px, 1fr))`, minWidth: 'max-content' }}>
                          {config.stateLabels.map((s, i) => (
                            <div key={`rl-${i}`} className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                              {s}
                            </div>
                          ))}
                          {config.stateLabels.map((s, i) => (
                            <RawNumberInput
                              key={`rv-${i}`}
                              value={config.rewardsByAction[a]?.[i] ?? 0}
                              ariaLabel={`Reward for action ${action} in state ${s}`}
                              onChange={(v) => setReward(a, i, v)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    {config.actionLabels.length > 1 && (
                      <Button
                        icon="trash"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          set({
                            actionLabels: config.actionLabels.filter((_, i) => i !== a),
                            transitionsByAction: config.transitionsByAction.filter((_, i) => i !== a),
                            rewardsByAction: config.rewardsByAction.filter((_, i) => i !== a),
                            userPolicy: config.userPolicy.map((p) => (p >= config.actionLabels.length - 1 ? 0 : p)),
                          })
                        }
                      >
                        Remove the action &ldquo;{action}&rdquo;
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  icon="plus"
                  size="sm"
                  disabled={config.actionLabels.length >= 5}
                  onClick={() => {
                    const n = config.stateLabels.length;
                    set({
                      actionLabels: [...config.actionLabels, `Action ${config.actionLabels.length + 1}`],
                      // A new action starts as "stay put", which is a valid row.
                      transitionsByAction: [...config.transitionsByAction, Array.from({ length: n }, (_, s) => Array.from({ length: n }, (_, j) => (s === j ? 1 : 0)))],
                      rewardsByAction: [...config.rewardsByAction, new Array<number>(n).fill(0)],
                    });
                  }}
                >
                  Add an action
                </Button>
                <SliderField
                  label="Discount factor"
                  symbol="γ"
                  value={config.discount}
                  onChange={(discount) => set({ discount })}
                  min={0}
                  max={0.999}
                  step={0.001}
                  hint="The weight on next period's value. γ must be strictly below 1 for the discounted infinite-horizon problem; γ = 1 is the average-reward criterion instead."
                />
              </Card>

              {mode === 'mdp' && (
                <Card title="A policy of your own" hint="Evaluated exactly, then compared with the optimum. This is the comparison that is practically useful.">
                  {config.stateLabels.map((s, i) => (
                    <SelectField
                      key={i}
                      label={`In ${s}, do`}
                      value={String(config.userPolicy[i] ?? 0)}
                      onChange={(v) => set({ userPolicy: config.userPolicy.map((p, j) => (j === i ? Number(v) : p)) })}
                      options={config.actionLabels.map((a, j) => ({ value: String(j), label: a }))}
                    />
                  ))}
                  <NumberField
                    label="Stages for the finite-horizon solution"
                    symbol="T"
                    value={config.horizon}
                    onChange={(horizon) => set({ horizon })}
                    min={1}
                    max={200}
                    integer
                    hint="Backward induction over T stages. Its optimal policy is time-dependent, which surprises people."
                  />
                </Card>
              )}
            </>
          )}

          {mode === 'discounting' && (
            <Card title="The range of discount factors to scan">
              <NumberField label="Lowest γ" value={config.scanLo} onChange={(scanLo) => set({ scanLo })} min={0} max={0.998} step={0.01} />
              <NumberField label="Highest γ" value={config.scanHi} onChange={(scanHi) => set({ scanHi })} min={0.001} max={0.999} step={0.01} />
              <NumberField
                label="Grid points"
                value={config.scanPoints}
                onChange={(scanPoints) => set({ scanPoints })}
                min={3}
                max={201}
                integer
                hint="Each switching point found on this grid is then located exactly by a root search. A policy region narrower than the grid spacing can be missed entirely."
              />
            </Card>
          )}

          {mode === 'pomdp' && (
            <Card title="The hidden state" hint="Two doors, a hazard behind one, and the option of paying to listen before choosing.">
              <SliderField
                label="Accuracy of listening"
                value={config.pomdpAccuracy}
                onChange={(pomdpAccuracy) => set({ pomdpAccuracy })}
                min={0.5}
                max={0.999}
                step={0.005}
                hint="P(hearing the hazard on the side it is actually on). At 0.5 listening tells you nothing and is pure cost."
              />
              <NumberField label="Cost of listening once" value={config.pomdpListenCost} onChange={(pomdpListenCost) => set({ pomdpListenCost })} min={0} max={1000} />
              <NumberField label="Penalty for opening the wrong door" value={config.pomdpPenalty} onChange={(pomdpPenalty) => set({ pomdpPenalty })} min={0} max={100000} />
              <NumberField label="Reward for opening the right door" value={config.pomdpReward} onChange={(pomdpReward) => set({ pomdpReward })} min={0} max={100000} />
              <SliderField
                label="Prior belief the hazard is on the left"
                symbol="b"
                value={config.pomdpBelief}
                onChange={(pomdpBelief) => set({ pomdpBelief })}
                min={0}
                max={1}
                step={0.01}
              />
              <SliderField label="Discount factor" symbol="γ" value={config.pomdpDiscount} onChange={(pomdpDiscount) => set({ pomdpDiscount })} min={0} max={0.999} step={0.001} />
              <NumberField
                label="Stages for the exact solution"
                symbol="T"
                value={config.pomdpHorizon}
                onChange={(pomdpHorizon) => set({ pomdpHorizon })}
                min={1}
                max={6}
                integer
                hint="Exact alpha-vector value iteration. The vector count can multiply by |Γ|^|O| per stage before pruning, so this is capped low on purpose."
              />
              <SelectField
                label="Observation to condition the belief on"
                value={String(config.pomdpObservation)}
                onChange={(v) => set({ pomdpObservation: Number(v) })}
                options={[
                  { value: '0', label: 'Heard it on the left' },
                  { value: '1', label: 'Heard it on the right' },
                ]}
                hint="The belief update shown below is after listening once and hearing this."
              />
            </Card>
          )}

          {mode === 'stopping' && (
            <>
              <Card title="Choosing one candidate from a sequence">
                <NumberField
                  label="Number of candidates"
                  symbol="n"
                  value={config.secretaryN}
                  onChange={(secretaryN) => set({ secretaryN })}
                  min={1}
                  max={5000}
                  integer
                  hint="Candidates arrive in random order, only relative ranks are seen, and the choice is irrevocable."
                />
              </Card>
              <Card title="Selling something: offers arrive one at a time">
                <NumberField label="Lowest possible offer" value={config.offerLow} onChange={(offerLow) => set({ offerLow })} min={-1e6} max={1e6} />
                <NumberField
                  label="Highest possible offer"
                  value={config.offerHigh}
                  onChange={(offerHigh) => set({ offerHigh })}
                  min={-1e6}
                  max={1e6}
                  hint="Offers are independent and uniform between these two values."
                />
                <NumberField label="Cost of examining each offer" value={config.searchCost} onChange={(searchCost) => set({ searchCost })} min={0} max={1e6} />
                <SliderField label="Discount per offer" symbol="δ" value={config.searchDiscount} onChange={(searchDiscount) => set({ searchDiscount })} min={0.01} max={1} step={0.01} />
                <NumberField
                  label="Offers before the deadline"
                  value={config.searchOffers}
                  onChange={(searchOffers) => set({ searchOffers })}
                  min={1}
                  max={60}
                  integer
                  hint="With a deadline the reservation values decline as it approaches. Without one they are constant."
                />
              </Card>
              <Card title="Stopping a trial early, legitimately">
                <NumberField label="Rate under the null" symbol="p₀" value={config.sprtP0} onChange={(sprtP0) => set({ sprtP0 })} min={0.001} max={0.999} step={0.01} />
                <NumberField label="Rate under the alternative" symbol="p₁" value={config.sprtP1} onChange={(sprtP1) => set({ sprtP1 })} min={0.001} max={0.999} step={0.01} />
                <NumberField label="Type I error target" symbol="α" value={config.sprtAlpha} onChange={(sprtAlpha) => set({ sprtAlpha })} min={0.001} max={0.4} step={0.005} />
                <NumberField label="Type II error target" symbol="β" value={config.sprtBeta} onChange={(sprtBeta) => set({ sprtBeta })} min={0.001} max={0.4} step={0.005} />
                <NumberField
                  label="Truncation of the exact enumeration"
                  value={config.sprtMaxSteps}
                  onChange={(sprtMaxSteps) => set({ sprtMaxSteps })}
                  min={10}
                  max={1200}
                  integer
                  hint="The operating characteristic is enumerated exactly up to this many observations; any probability still undecided there is reported rather than ignored."
                />
                <NumberField label="Number of interim looks" value={config.looks} onChange={(looks) => set({ looks })} min={1} max={20} integer />
                <SelectField
                  label="Alpha-spending function"
                  value={config.spending}
                  onChange={(v) => set({ spending: v as SpendingFunction })}
                  options={[
                    { value: 'obrien-fleming', label: "O'Brien–Fleming (strict early, cheap)" },
                    { value: 'pocock', label: 'Pocock (constant, expensive)' },
                  ]}
                />
                <NumberField label="Two-sided α" value={config.spendingAlpha} onChange={(spendingAlpha) => set({ spendingAlpha })} min={0.001} max={0.49} step={0.005} />
                <NumberField label="Target power" value={config.spendingPower} onChange={(spendingPower) => set({ spendingPower })} min={0.5} max={0.999} step={0.01} />
              </Card>
            </>
          )}

          {mode === 'bandits' && (
            <>
              <Card title="The arms" hint="The true means are the study's assumption. The algorithms never see them; every regret figure is measured against them.">
                {config.armMeans.map((m, i) => (
                  <SliderField
                    key={i}
                    label={`True success rate of ${armLabels[i]}`}
                    value={m}
                    onChange={(v) => setArmMean(i, v)}
                    min={0}
                    max={1}
                    step={0.01}
                  />
                ))}
                <div className="oc-btn-row">
                  <Button icon="plus" size="sm" disabled={config.armMeans.length >= 8} onClick={() => set({ armMeans: [...config.armMeans, 0.3] })}>
                    Add an arm
                  </Button>
                  <Button icon="trash" size="sm" disabled={config.armMeans.length <= 2} onClick={() => set({ armMeans: config.armMeans.slice(0, -1) })}>
                    Remove the last arm
                  </Button>
                </div>
              </Card>
              <Card title="The study">
                <NumberField label="Horizon (pulls per run)" symbol="T" value={config.banditHorizon} onChange={(banditHorizon) => set({ banditHorizon })} min={10} max={100000} integer />
                <NumberField
                  label="Replications"
                  value={config.replications}
                  onChange={(replications) => set({ replications })}
                  min={2}
                  max={2000}
                  integer
                  hint="Regret is a random quantity. At least two runs are required, and the Monte Carlo error below says how far the means can be trusted."
                />
                <NumberField label="ε for ε-greedy" value={config.epsilon} onChange={(epsilon) => set({ epsilon })} min={0.001} max={1} step={0.01} />
                <TextField label="Seed" value={config.banditSeed} onChange={(banditSeed) => set({ banditSeed })} hint="The same seed reproduces the study exactly." monospace />
                <div className="oc-field">
                  <span className="oc-field__label">Algorithms</span>
                  {ALGORITHM_OPTIONS.map((o) => (
                    <Checkbox key={o.id} label={o.label} checked={config.algorithms.includes(o.id)} onChange={(on) => toggleAlgorithm(o.id, on)} />
                  ))}
                </div>
              </Card>
              <Card title="The Gittins index">
                <NumberField label="Discount factor the index is calibrated for" value={config.gittinsDiscount} onChange={(gittinsDiscount) => set({ gittinsDiscount })} min={0.01} max={0.99} step={0.01} />
                <NumberField label="Pulls covered by the table" value={config.gittinsMaxPulls} onChange={(gittinsMaxPulls) => set({ gittinsMaxPulls })} min={1} max={60} integer />
              </Card>
            </>
          )}

          {mode === 'learning' && (
            <Card title="The learning run" hint="The learner sees sampled transitions and rewards only. The model above is used to generate them, and to compute the optimum it is checked against.">
              <NumberField label="Episodes" value={config.episodes} onChange={(episodes) => set({ episodes })} min={1} max={20000} integer />
              <NumberField label="Steps per episode" value={config.stepsPerEpisode} onChange={(stepsPerEpisode) => set({ stepsPerEpisode })} min={1} max={2000} integer />
              <SliderField label="Exploration rate" symbol="ε" value={config.explorationEpsilon} onChange={(explorationEpsilon) => set({ explorationEpsilon })} min={0.01} max={1} step={0.01} />
              <NumberField
                label="Visits required per state-action pair"
                value={config.minVisitsPerPair}
                onChange={(minVisitsPerPair) => set({ minVisitsPerPair })}
                min={1}
                max={100000}
                integer
                hint="Below this the engine refuses to call the pair's value converged, and says which pair fell short."
              />
              <TextField label="Seed" value={config.learningSeed} onChange={(learningSeed) => set({ learningSeed })} monospace />
            </Card>
          )}

          <AiAssistPanel
            capability="suggestMethod"
            context="Six ways of posing a repeated decision are offered above. The hint under the picker says when each applies; every number in the results comes from the engine."
          />
        </div>

        <div className="oc-stack">
          {!valid && (
            <Notice tone="error" title="The process is not a valid Markov decision process" items={mdpIssues.map((i) => i.message)} />
          )}

          {/* ------------------------------------------------- 1. the MDP */}
          {mode === 'mdp' && solved && (
            <>
              <ErrorNotice outcome={solved} />
              {solved.ok && agreement && (
                <>
                  <Card title="The optimal policy and what it is worth" hint={`Discounted total reward at γ = ${formatValue(config.discount, 3)}.`}>
                    <DataTable
                      caption="Optimal value and action in each state, by three independent solvers"
                      columns={
                        [
                          { key: 's', header: 'State', render: (r) => r.state },
                          { key: 'v', header: 'Optimal value', numeric: true, render: (r) => formatValue(r.pi, 6) },
                          { key: 'a', header: 'Best action', render: (r) => r.action },
                          { key: 'vi', header: 'Value iteration', numeric: true, render: (r) => formatValue(r.vi, 6) },
                          { key: 'lp', header: 'Linear programme', numeric: true, render: (r) => formatValue(r.lp, 6) },
                        ] as ColumnDef<{ state: string; action: string; pi: number; vi: number; lp: number }>[]
                      }
                      rows={config.stateLabels.map((s, i) => ({
                        state: s,
                        action: solved.value.pi.policyLabels[i],
                        pi: solved.value.pi.values[i],
                        vi: solved.value.vi.values[i],
                        lp: solved.value.lp.values[i],
                      }))}
                    />
                    <Notice
                      tone={agreement.policiesAgree ? 'success' : 'error'}
                      title={agreement.policiesAgree ? 'All three solvers agree — the cross-check passes' : 'The three solvers DISAGREE'}
                    >
                      <p>
                        Policy iteration, value iteration and the dual occupancy linear programme share no code. They{' '}
                        {agreement.policiesAgree ? 'select the same action in every state' : 'do not select the same action in every state'}, and their value
                        functions differ by at most {agreement.maxValueGap.toExponential(2)}. That is a genuine check on the arithmetic rather than a restatement
                        of one answer: an error in any single route would show up here.
                      </p>
                    </Notice>
                    <KeyValueList
                      items={[
                        {
                          label: 'Bellman error at the final value-iteration sweep',
                          value: solved.value.vi.bellmanError.toExponential(3),
                        },
                        {
                          label: 'Guaranteed distance to optimal, ‖v − v*‖∞',
                          value: (
                            <>
                              ≤ {solved.value.vi.errorBound.toExponential(3)} <Badge variant="numerical">Numerical</Badge>
                            </>
                          ),
                        },
                        { label: 'Value-iteration sweeps', value: solved.value.vi.iterations.toLocaleString('en-US') },
                        { label: 'Policy improvements needed', value: solved.value.pi.iterations.toLocaleString('en-US') },
                        { label: 'Simplex iterations', value: solved.value.lp.lpIterations.toLocaleString('en-US') },
                        {
                          label: 'Average reward per step (γ = 1 criterion)',
                          value: `${formatValue(solved.value.average.gain, 6)} — policy ${solved.value.average.policyLabels.join(', ')}`,
                        },
                      ]}
                    />
                    {!solved.value.vi.converged && (
                      <Notice tone="error" title="Value iteration did not converge">
                        The iteration cap was reached with a Bellman error of {solved.value.vi.bellmanError.toExponential(3)}. These values are not a solution
                        and must not be read as one.
                      </Notice>
                    )}
                    <Notice tone="info" title="Why the error bound is reported, not optional">
                      Value iteration stops at a tolerance, so its answer is close to optimal rather than optimal. The Bellman operator is a γ-contraction, so a
                      final sweep that moved the values by at most ε puts them within ε·γ/(1−γ) of v*. A value function given without that distance is an
                      unverified claim. Policy iteration and the linear programme solve exactly instead, which is why they carry no bound.
                    </Notice>
                    {!solved.value.average.policyLabels.every((a, i) => a === solved.value.pi.policyLabels[i]) && (
                      <Notice tone="warning" title="The discounted and average-reward optima differ here">
                        Maximising discounted total reward and maximising reward per step are different objectives, and on this process they recommend different
                        actions. Neither is wrong; they answer different questions, and the discount factor is the choice between them.
                      </Notice>
                    )}
                    <ExplanationPanel explanation={explanationOf(solved.value.pi.provenance)} />
                    <ExplanationPanel explanation={explanationOf(solved.value.vi.provenance, '‖v − v*‖∞ ≤ ε · γ / (1 − γ)')} />
                    <ExplanationPanel explanation={explanationOf(solved.value.lp.provenance)} />
                  </Card>

                  <Card title="Action values and advantages" hint="Q(s,a) is the value of taking that action once and acting optimally afterwards; the advantage is what it costs to depart from the best action.">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Action values and advantages by state and action"
                        columns={
                          [
                            { key: 's', header: 'State', render: (r) => r.state },
                            { key: 'a', header: 'Action', render: (r) => r.action },
                            { key: 'q', header: 'Q(s,a)', numeric: true, render: (r) => formatValue(r.q, 6) },
                            { key: 'adv', header: 'Advantage', numeric: true, render: (r) => formatValue(r.advantage, 6) },
                          ] as ColumnDef<{ state: string; action: string; q: number; advantage: number }>[]
                        }
                        rows={config.stateLabels.flatMap((s, i) =>
                          config.actionLabels.map((a, j) => ({
                            state: s,
                            action: a,
                            q: solved.value.pi.qValues[i][j],
                            advantage: solved.value.pi.advantages[i][j],
                          })),
                        )}
                      />
                    </div>
                  </Card>

                  {policyEvaluation && (
                    <Card title="Your policy against the optimum">
                      <ErrorNotice outcome={policyEvaluation} />
                      {policyEvaluation.ok && (
                        <>
                          <DataTable
                            caption="Value of the supplied policy compared with the optimal value"
                            columns={
                              [
                                { key: 's', header: 'State', render: (r) => r.state },
                                { key: 'a', header: 'Your action', render: (r) => r.action },
                                { key: 'v', header: 'Your value', numeric: true, render: (r) => formatValue(r.yours, 6) },
                                { key: 'o', header: 'Optimal value', numeric: true, render: (r) => formatValue(r.best, 6) },
                                { key: 'g', header: 'Shortfall', numeric: true, render: (r) => formatValue(r.best - r.yours, 6) },
                              ] as ColumnDef<{ state: string; action: string; yours: number; best: number }>[]
                            }
                            rows={config.stateLabels.map((s, i) => ({
                              state: s,
                              action: config.actionLabels[config.userPolicy[i] ?? 0] ?? '—',
                              yours: policyEvaluation.value.values[i],
                              best: solved.value.pi.values[i],
                            }))}
                          />
                          {policyEvaluation.value.improvements.length === 0 ? (
                            <Notice tone="success" title="Your policy is optimal">
                              No single-action change improves on it in any state, which for a stationary policy in a discounted MDP means it is optimal.
                            </Notice>
                          ) : (
                            <Notice
                              tone="warning"
                              title={`${policyEvaluation.value.improvements.length} state${policyEvaluation.value.improvements.length === 1 ? '' : 's'} could be improved`}
                              items={policyEvaluation.value.improvements.map(
                                (im) =>
                                  `In ${config.stateLabels[im.state]}, switching from "${im.from}" to "${im.to}" gains ${formatValue(im.gain, 4)} in discounted value.`,
                              )}
                            />
                          )}
                          <ExplanationPanel explanation={explanationOf(policyEvaluation.value.provenance)} />
                        </>
                      )}
                    </Card>
                  )}

                  <Card title={`The same process over ${config.horizon} stage${config.horizon === 1 ? '' : 's'}`} hint="Backward induction. Exact, and the policy depends on the stage.">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Optimal action at each stage and state over a finite horizon"
                        columns={
                          [
                            { key: 's', header: 'Stage', render: (r) => r.stage },
                            ...config.stateLabels.map((label, i) => ({
                              key: `st${i}`,
                              header: label,
                              render: (r: { stage: string; actions: string[]; values: number[] }) => `${r.actions[i]} (${formatValue(r.values[i], 4)})`,
                            })),
                          ] as ColumnDef<{ stage: string; actions: string[]; values: number[] }>[]
                        }
                        rows={solved.value.finite.policyLabels.map((actions, t) => ({
                          stage: `${t + 1} of ${config.horizon}`,
                          actions,
                          values: solved.value.finite.values[t],
                        }))}
                      />
                    </div>
                    <Notice tone={solved.value.finite.policyIsTimeDependent ? 'info' : 'warning'} title={solved.value.finite.policyIsTimeDependent ? 'The optimal policy is time-dependent' : 'The optimal policy happens to be the same at every stage here'}>
                      {solved.value.finite.policyIsTimeDependent
                        ? 'The best action in a state depends on how many stages remain, so there is no single table of advice. An investment that pays back over several periods is not worth making in the last one, and backward induction finds exactly where the change falls. The infinite-horizon policy above is stationary because there is always the same amount of future left.'
                        : 'With this horizon the optimal action in each state does not change between stages. That is a property of these numbers rather than a general rule: lengthen or shorten the horizon and the last stages typically diverge.'}
                    </Notice>
                    <ExplanationPanel explanation={explanationOf(solved.value.finite.provenance)} />
                  </Card>
                </>
              )}
            </>
          )}

          {/* ------------------------------- 2. discounting changes the answer */}
          {mode === 'discounting' && (
            <>
              {sensitivity && <ErrorNotice outcome={sensitivity} />}
              {sensitivity?.ok && (
                <Card title="Where the advice changes" hint={`γ scanned over [${formatValue(config.scanLo, 3)}, ${formatValue(config.scanHi, 3)}].`}>
                  {sensitivity.value.stable ? (
                    <Notice tone="info" title="One policy is optimal across the whole range">
                      Over this range of discount factors the recommendation never changes, which makes it a robust one. Widen the range to find out whether that
                      holds further out.
                    </Notice>
                  ) : (
                    <Notice tone="warning" title={`${sensitivity.value.switchPoints.length} switching point${sensitivity.value.switchPoints.length === 1 ? '' : 's'}`}>
                      <p>
                        The optimal policy changes within this range, so how much the future counts is not a detail of the model — it decides the advice. Each
                        switching point below is the exact γ at which the two policies have equal value, located by a root search rather than read off the grid.
                      </p>
                    </Notice>
                  )}
                  <DataTable
                    caption="Discount-factor regions and the policy optimal in each"
                    columns={
                      [
                        { key: 'r', header: 'γ from', numeric: true, render: (r) => formatValue(r.from, 6) },
                        { key: 't', header: 'γ to', numeric: true, render: (r) => formatValue(r.to, 6) },
                        { key: 'p', header: 'Optimal policy', render: (r) => r.labels.map((l, i) => `${config.stateLabels[i]}: ${l}`).join(' · ') },
                      ] as ColumnDef<{ from: number; to: number; labels: string[] }>[]
                    }
                    rows={sensitivity.value.regions.map((r) => ({ from: r.from, to: r.to, labels: r.policyLabels }))}
                  />
                  {sensitivity.value.switchPoints.length > 0 && (
                    <DataTable
                      caption="Exact switching points and what changes at each"
                      columns={
                        [
                          { key: 'at', header: 'Switches at γ', numeric: true, render: (r) => formatValue(r.at, 8) },
                          {
                            key: 'c',
                            header: 'What changes',
                            render: (r) => r.changes.map((c) => `In ${c.stateLabel}: ${c.before} → ${c.after}`).join('; '),
                          },
                        ] as ColumnDef<{ at: number; changes: { stateLabel: string; before: string; after: string }[] }>[]
                      }
                      rows={sensitivity.value.switchPoints.map((s) => ({ at: s.at, changes: s.changedStates }))}
                    />
                  )}
                  <p className="oc-chart-note">
                    Your current γ is {formatValue(config.discount, 4)}.{' '}
                    {sensitivity.value.switchPoints.length > 0
                      ? `The nearest switching point is at γ = ${formatValue(
                          sensitivity.value.switchPoints.reduce((best, s) => (Math.abs(s.at - config.discount) < Math.abs(best.at - config.discount) ? s : best)).at,
                          6,
                        )}. A recommendation that holds over a wide range of γ is robust; one that sits close to a switch is not.`
                      : ''}
                  </p>
                  <ExplanationPanel explanation={explanationOf(sensitivity.value.provenance)} />
                </Card>
              )}

              {discountCurves && <ErrorNotice outcome={discountCurves} />}
              {discountCurves?.ok && (
                <Card title="What each state is worth as the future matters more">
                  <div style={{ overflowX: 'auto' }}>
                    <LineChart
                      title="Optimal value against the discount factor"
                      description="The optimal discounted value of each state, computed by exact policy iteration at each of 21 discount factors."
                      series={config.stateLabels.map(
                        (label, i): CurveSeries => ({
                          label,
                          points: discountCurves.value.map((r) => ({ x: r.gamma, y: r.values[i] })),
                        }),
                      )}
                      xLabel="Discount factor γ"
                      yLabel="Optimal discounted value"
                      referenceLines={
                        sensitivity?.ok
                          ? sensitivity.value.switchPoints.map((s) => ({ value: s.at, label: `switch at γ = ${formatValue(s.at, 4)}`, axis: 'x' as const }))
                          : undefined
                      }
                      note="Values rise steeply as γ approaches 1 because the sum of discounted rewards has more terms, not because the process has improved. The kinks are where the optimal policy changes."
                    />
                  </div>
                </Card>
              )}

              <Card title="Two things about discounting that catch people out">
                <Notice tone="info" title="A finite-horizon optimal policy is time-dependent">
                  Over a finite horizon the best action in a state depends on how many stages are left, so there is no single table of advice — the
                  Markov-decision-process section shows the stage-by-stage policy for this same process. Only the infinite-horizon problem has a stationary
                  optimal policy, and it has one because there is always the same amount of future remaining.
                </Notice>
                <Notice tone="info" title="Discounted and average-reward optima can differ">
                  Maximising Σ γᵗ r and maximising long-run reward per step are different criteria. As γ → 1 the discounted optimum generally approaches an
                  average-reward optimal policy, but at any γ below 1 the two can disagree, and γ = 1 is not a discounted problem at all: the sum is usually
                  infinite, which is why the engine refuses γ = 1 and offers the average-reward routine instead.
                </Notice>
              </Card>
            </>
          )}

          {/* ------------------------------------------------ 3. hidden state */}
          {mode === 'pomdp' && pomdpResult && (
            <>
              <ErrorNotice outcome={pomdpResult} />
              {pomdpResult.ok && (
                <>
                  <Card title="Updating what you believe" hint="Exact Bayes update of the belief after listening once.">
                    <KeyValueList
                      items={[
                        { label: 'Belief before listening, P(hazard on the left)', value: formatProbabilityPair(config.pomdpBelief) },
                        {
                          label: `Belief after hearing it on the ${config.pomdpObservation === 0 ? 'left' : 'right'}`,
                          value: formatProbabilityPair(pomdpResult.value.updated.belief[0]),
                        },
                        { label: 'Probability of that observation', value: formatPercent(pomdpResult.value.updated.observationProbability, 4) },
                      ]}
                    />
                    <p className="oc-chart-note">
                      One imperfect observation moves the belief but does not resolve it, which is why listening repeatedly can be worth its cost. The update is
                      exact given the model; a wrong observation model produces a confident wrong belief and nothing in the arithmetic reveals it.
                    </p>
                    <ExplanationPanel explanation={explanationOf(pomdpResult.value.updated.provenance, "b'(s') ∝ O(o | s', a) · Σ_s T(s' | s, a) · b(s)")} />
                  </Card>

                  <Card title={`The exact value function over ${config.pomdpHorizon} stage${config.pomdpHorizon === 1 ? '' : 's'}`} hint={`${pomdpResult.value.exact.alphaVectors.length} alpha-vectors after exact witness-LP pruning.`}>
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title="Value against belief"
                        description="The exact finite-horizon POMDP value function, evaluated from the engine's pruned alpha-vector set at 51 beliefs."
                        series={[
                          {
                            label: 'Exact POMDP value',
                            points: pomdpResult.value.curve.map((p) => ({ x: p.b, y: p.value })),
                          },
                        ]}
                        xLabel="P(hazard on the left)"
                        yLabel="Expected total reward"
                        referenceLines={[{ value: config.pomdpBelief, label: 'your belief', axis: 'x' as const }]}
                        note="The function is piecewise linear and convex: each straight segment belongs to one alpha-vector, and the kinks are beliefs at which the best first action changes. Convexity is the formal statement that information has value — being uncertain is worth less than a mixture of being sure."
                      />
                    </div>
                    <KeyValueList
                      items={[
                        {
                          label: 'Value at your belief',
                          value: (
                            <>
                              {formatValue(pomdpResult.value.atBelief.value, 6)} <Badge variant="exact">Exact</Badge>
                            </>
                          ),
                        },
                        { label: 'Best first action', value: pomdp.actions[pomdpResult.value.atBelief.action] },
                      ]}
                    />
                    <ExplanationPanel explanation={explanationOf(pomdpResult.value.exact.provenance, 'V(b) = max_α b·α')} />
                  </Card>

                  <Card title="Two bounds, both optimistic">
                    <DataTable
                      caption="QMDP and fast-informed bounds at the current belief"
                      columns={
                        [
                          { key: 'b', header: 'Bound', render: (r) => r.name },
                          { key: 'v', header: 'Value at your belief', numeric: true, render: (r) => formatValue(r.value, 6) },
                          { key: 'a', header: 'Action it recommends', render: (r) => r.action },
                          { key: 'd', header: 'Direction of the bias', render: () => 'Upper bound (optimistic)' },
                        ] as ColumnDef<{ name: string; value: number; action: string }>[]
                      }
                      rows={[
                        { name: 'Fast informed bound', value: pomdpResult.value.fib.value, action: pomdpResult.value.fib.actionLabel },
                        { name: 'QMDP', value: pomdpResult.value.qmdp.value, action: pomdpResult.value.qmdp.actionLabel },
                      ]}
                    />
                    <Notice tone="warning" title="Both bounds OVERSTATE what is achievable">
                      <p>
                        QMDP computes Q(b,a) = Σ_s b(s)·Q<sub>MDP</sub>(s,a), which assumes the hidden state becomes fully observable immediately after the
                        current action. In that world information arrives free next step, so QMDP never pays to gather any — its characteristic failure is
                        refusing a cheap look before an expensive commitment. The fast informed bound assumes the state is revealed only after the next
                        observation, a weaker assumption, so V* ≤ FIB ≤ QMDP. Both are upper bounds, and the gap to the exact value above is the measure of how
                        optimistic they are.
                      </p>
                      <p>
                        These two bounds are infinite-horizon at γ = {formatValue(config.pomdpDiscount, 3)}, while the exact value function above covers{' '}
                        {config.pomdpHorizon} stage{config.pomdpHorizon === 1 ? '' : 's'}. They are not like-for-like, and the value of information below is
                        reported over matched horizons precisely so that it is.
                      </p>
                    </Notice>
                    <ExplanationPanel explanation={explanationOf(pomdpResult.value.qmdp.provenance)} />
                    <ExplanationPanel explanation={explanationOf(pomdpResult.value.fib.provenance)} />
                  </Card>

                  <Card title="What it would be worth to see the state">
                    <KeyValueList
                      items={[
                        { label: 'If the state were observable', value: formatValue(pomdpResult.value.voi.observableValue, 6) },
                        { label: 'Best achievable without seeing it', value: formatValue(pomdpResult.value.voi.pomdpValue, 6) },
                        { label: 'Value of perfect state information', value: formatValue(pomdpResult.value.voi.valueOfInformation, 6) },
                        {
                          label: 'Basis of the POMDP side',
                          value:
                            pomdpResult.value.voi.pomdpValueKind === 'exact-finite-horizon'
                              ? 'Exact finite-horizon optimum over the same number of stages'
                              : 'QMDP upper bound, so the gap shown is a LOWER bound on the true value of information',
                        },
                      ]}
                    />
                    <p className="oc-chart-note">
                      Both sides are computed over the same {config.pomdpHorizon}-stage horizon, so the difference is attributable to the hidden state and not to
                      the comparison. It is the most you should ever pay for a perfect sensor.
                    </p>
                    <ExplanationPanel explanation={explanationOf(pomdpResult.value.voi.provenance)} />
                  </Card>
                </>
              )}
            </>
          )}

          {/* --------------------------------------------- 4. optimal stopping */}
          {mode === 'stopping' && stopping && (
            <>
              <Card title="Choosing one candidate, with no going back">
                <ErrorNotice outcome={stopping.secretary} />
                {stopping.secretary.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Observe and reject this many first', value: `${stopping.secretary.value.skip} of ${stopping.secretary.value.n}` },
                        {
                          label: 'Then take the next candidate better than all of them',
                          value: (
                            <>
                              succeeds {formatPercent(stopping.secretary.value.successProbability, 4)} of the time <Badge variant="exact">Exact</Badge>
                            </>
                          ),
                        },
                        { label: 'The 1/e asymptotic limit', value: formatPercent(stopping.secretary.value.asymptoticProbability, 4) },
                        {
                          label: 'Fraction of the sequence skipped',
                          value: formatPercent(stopping.secretary.value.skip / stopping.secretary.value.n, 3),
                        },
                      ]}
                    />
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title="Success probability against how many candidates you skip"
                        description="Exact probability of selecting the single best candidate for every skip threshold."
                        series={[{ label: 'P(choosing the best)', points: stopping.secretary.value.byThreshold.map((t) => ({ x: t.skip, y: t.probability })) }]}
                        xLabel="Candidates observed and rejected"
                        yLabel="Probability of choosing the best"
                        referenceLines={[
                          { value: stopping.secretary.value.skip, label: 'optimal threshold', axis: 'x' as const },
                          { value: stopping.secretary.value.asymptoticProbability, label: '1/e', axis: 'y' as const },
                        ]}
                        note="The peak is flat: being a few candidates away from the optimal threshold costs very little. The exact optimum is computed over every threshold rather than taken from the n/e rule of thumb."
                      />
                    </div>
                    <ExplanationPanel explanation={explanationOf(stopping.secretary.value.provenance, 'P(r) = (r/n) · Σ_{i=r+1}^{n} 1/(i−1)')} />
                  </>
                )}
              </Card>

              <Card title="Selling: the reservation value">
                <ErrorNotice outcome={stopping.house} />
                {stopping.house.ok && (
                  <KeyValueList
                    items={[
                      { label: 'Accept any offer at or above', value: formatValue(stopping.house.value.reservationValue, 6) },
                      { label: 'Probability an arriving offer is acceptable', value: formatPercent(stopping.house.value.acceptanceProbability, 4) },
                      { label: 'Expected number of offers examined', value: formatValue(stopping.house.value.expectedOffers, 4) },
                    ]}
                  />
                )}
                <ErrorNotice outcome={stopping.deadline} />
                {stopping.deadline.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title="Reservation values as the deadline approaches"
                        description="The least offer worth accepting at each step, computed backwards from the final offer, which must be taken."
                        series={[
                          {
                            label: 'Least acceptable offer',
                            // The final threshold is −∞ — the last offer must be
                            // taken — which has no place on an axis. It is
                            // omitted from the line and stated in the note.
                            points: stopping.deadline.value.reservationValues
                              .map((v, i) => ({ x: i + 1, y: v }))
                              .filter((p) => Number.isFinite(p.y)),
                          },
                        ]}
                        xLabel="Offer number"
                        yLabel="Reservation value"
                        referenceLines={
                          stopping.house.ok ? [{ value: stopping.house.value.reservationValue, label: 'no deadline', axis: 'y' as const }] : undefined
                        }
                        note={`The thresholds decline towards the deadline: being choosy is only affordable while there is time left. The threshold for offer ${config.searchOffers} is −∞ and is not plotted, because the last offer must be taken whatever it is. With no deadline the threshold never falls, which is the flat reference line.`}
                      />
                    </div>
                    <KeyValueList
                      items={[{ label: 'Expected value of following the deadline rule', value: formatValue(stopping.deadline.value.expectedValue, 6) }]}
                    />
                    <ExplanationPanel explanation={explanationOf(stopping.deadline.value.provenance, 'v_i = −c + δ·E[max(X, v_{i+1})]')} />
                  </>
                )}
              </Card>

              <Card title="Stopping a trial as soon as the evidence is in">
                <ErrorNotice outcome={stopping.test} />
                {stopping.test.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Reject the null when the log-likelihood ratio exceeds', value: formatValue(stopping.test.value.upperBoundary, 6) },
                        { label: 'Accept the null when it falls below', value: formatValue(stopping.test.value.lowerBoundary, 6) },
                        {
                          label: 'Each success moves the ratio by',
                          value: `${formatValue(stopping.test.value.increments.success, 5)}; each failure by ${formatValue(stopping.test.value.increments.failure, 5)}`,
                        },
                        { label: 'Expected observations under the null', value: formatValue(stopping.test.value.expectedSampleSize.underH0, 4) },
                        { label: 'Expected observations under the alternative', value: formatValue(stopping.test.value.expectedSampleSize.underH1, 4) },
                        { label: 'Fixed-sample test for the same error rates', value: `${formatValue(stopping.test.value.fixedSampleSize, 4)} observations` },
                        {
                          label: 'Saving against the fixed-sample test',
                          value: formatPercent(
                            1 - Math.max(stopping.test.value.expectedSampleSize.underH0, stopping.test.value.expectedSampleSize.underH1) / stopping.test.value.fixedSampleSize,
                            3,
                          ),
                        },
                      ]}
                    />
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Exact operating characteristic of the sequential test"
                        columns={
                          [
                            { key: 'p', header: 'True rate', numeric: true, render: (r) => formatValue(r.p, 4) },
                            { key: 'a', header: 'P(accept the null)', numeric: true, render: (r) => formatPercent(r.acceptH0, 4) },
                            { key: 'r', header: 'P(reject the null)', numeric: true, render: (r) => formatPercent(r.rejectH0, 4) },
                            { key: 'n', header: 'Expected observations', numeric: true, render: (r) => formatValue(r.expectedN, 4) },
                            { key: 'u', header: 'Still undecided at truncation', numeric: true, render: (r) => r.unresolved.toExponential(2) },
                          ] as ColumnDef<{ p: number; acceptH0: number; rejectH0: number; expectedN: number; unresolved: number }>[]
                        }
                        rows={stopping.test.value.operatingCharacteristic}
                      />
                    </div>
                    <Notice tone="error" title="The error rates hold ONLY for these pre-declared boundaries">
                      <p>
                        Optional stopping is legitimate here for one reason: the rule was fixed before any data arrived. Stop for any other reason — a deadline,
                        an encouraging interim look, running out of budget, a boundary adjusted after seeing the data — and the quoted α and β no longer describe
                        the procedure at all. This is the single most abused idea in applied statistics: &ldquo;we kept collecting until it was significant&rdquo;
                        is not a sequential test, it is a guarantee of eventual significance.
                      </p>
                      <p>
                        A second limitation: the test has no fixed maximum sample size. The enumeration above truncates at {config.sprtMaxSteps} observations and
                        reports the probability still undecided there rather than ignoring it.
                      </p>
                    </Notice>
                    <ExplanationPanel explanation={explanationOf(stopping.test.value.provenance, 'Reject when Λ_n ≥ log((1−β)/α); accept when Λ_n ≤ log(β/(1−α))')} />
                  </>
                )}
              </Card>

              <Card title="Interim looks with a fixed maximum: group-sequential boundaries">
                <ErrorNotice outcome={stopping.group} />
                {stopping.group.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <BarChart
                        title="Critical value at each interim look"
                        description="Two-sided critical values on the standardised statistic, chosen so the cumulative null crossing probability matches the spending function."
                        data={stopping.group.value.boundaries.map((b, i) => ({
                          x: i + 1,
                          y: b,
                          label: `Look ${i + 1} (t = ${formatValue(stopping.group.ok ? stopping.group.value.informationFractions[i] : 0, 2)})`,
                        }))}
                        xLabel="Interim look"
                        yLabel="Critical value of Z"
                        seriesLabel="Critical value"
                        note="O'Brien–Fleming spends almost no α early, so its first boundary is extreme and its last is close to the fixed-sample 1.96. Pocock spends evenly, which makes early stopping easier and the final boundary stricter."
                      />
                    </div>
                    <DataTable
                      caption="Alpha spent and the boundary at each look"
                      columns={
                        [
                          { key: 'k', header: 'Look', numeric: true, render: (r) => String(r.k) },
                          { key: 't', header: 'Information fraction', numeric: true, render: (r) => formatValue(r.t, 4) },
                          { key: 'z', header: 'Critical value', numeric: true, render: (r) => formatValue(r.z, 5) },
                          { key: 'c', header: 'Cumulative α spent', numeric: true, render: (r) => formatValue(r.cumulative, 5) },
                          { key: 'i', header: 'α spent at this look', numeric: true, render: (r) => formatValue(r.incremental, 5) },
                        ] as ColumnDef<{ k: number; t: number; z: number; cumulative: number; incremental: number }>[]
                      }
                      rows={stopping.group.value.boundaries.map((z, i) => ({
                        k: i + 1,
                        t: stopping.group.ok ? stopping.group.value.informationFractions[i] : 0,
                        z,
                        cumulative: stopping.group.ok ? stopping.group.value.cumulativeAlpha[i] : 0,
                        incremental: stopping.group.ok ? stopping.group.value.incrementalAlpha[i] : 0,
                      }))}
                    />
                    <Notice tone="warning" title="What the interim looks cost">
                      Keeping the same power while allowing {config.looks} look{config.looks === 1 ? '' : 's'} inflates the maximum sample size by{' '}
                      {formatPercent(stopping.group.value.maximumSampleSizeInflation - 1, 3)} — a maximum of{' '}
                      {formatValue(stopping.group.value.maximumSampleSizeInflation, 4)} times the fixed-sample size. That price is routinely left out of
                      sample-size calculations, which quietly turns a {formatPercent(stopping.group.value.power, 3)}-power design into an underpowered one.
                    </Notice>
                    <ExplanationPanel explanation={explanationOf(stopping.group.value.provenance)} />
                  </>
                )}
              </Card>
            </>
          )}

          {/* ---------------------------------------------------- 5. bandits */}
          {mode === 'bandits' && (
            <>
              <Card title="Running the study" hint="Replications across several algorithms are the one genuinely expensive computation here, so nothing runs until asked.">
                <Notice tone="info" title="What this will cost">
                  {config.algorithms.length} algorithm{config.algorithms.length === 1 ? '' : 's'} × {config.replications.toLocaleString('en-US')} replications ×{' '}
                  {config.banditHorizon.toLocaleString('en-US')} pulls ={' '}
                  {(config.algorithms.length * config.replications * config.banditHorizon).toLocaleString('en-US')} simulated pulls. The run is driven in chunks
                  so it can be cancelled; the default settings take roughly a second.
                </Notice>
                <div className="oc-btn-row">
                  <Button
                    icon="play"
                    variant="primary"
                    disabled={banditRun.status === 'running' || config.algorithms.length === 0}
                    onClick={() => {
                      if (!config.runBandits) set({ runBandits: true });
                      startBandits();
                    }}
                  >
                    {banditRun.result ? 'Run the study again' : 'Run the study'}
                  </Button>
                </div>
                {config.algorithms.length === 0 && <Notice tone="warning">Select at least one algorithm.</Notice>}
                {banditRun.status === 'running' && (
                  <RunningState completed={Math.round(banditRun.progress * 100)} total={100} unitLabel="per cent of replications" onCancel={banditRun.cancel} />
                )}
                {banditRun.status === 'cancelled' && <Notice tone="warning">The study was cancelled, so there is no result to report.</Notice>}
                {banditRun.status === 'error' && banditRun.error && <Notice tone="error">{banditRun.error}</Notice>}
              </Card>

              {laiRobbins?.ok && (
                <Card title="The lower bound no algorithm can beat">
                  <KeyValueList
                    items={[
                      { label: 'Lai–Robbins constant C', value: formatValue(laiRobbins.value.constant, 5) },
                      { label: `C · log T at T = ${config.banditHorizon.toLocaleString('en-US')}`, value: formatValue(laiRobbins.value.bound, 4) },
                    ]}
                  />
                  <DataTable
                    caption="Contribution of each suboptimal arm to the lower bound"
                    columns={
                      [
                        { key: 'a', header: 'Arm', render: (r) => armLabels[r.arm] ?? String(r.arm) },
                        { key: 'g', header: 'Gap Δ', numeric: true, render: (r) => formatValue(r.gap, 5) },
                        { key: 'k', header: 'KL divergence', numeric: true, render: (r) => formatValue(r.divergence, 5) },
                        { key: 'c', header: 'Δ / KL', numeric: true, render: (r) => formatValue(r.contribution, 5) },
                      ] as ColumnDef<{ arm: number; gap: number; divergence: number; contribution: number }>[]
                    }
                    rows={laiRobbins.value.perArm}
                  />
                  <Notice tone="info" title="What the bound actually says">
                    The statement is about the limit inferior: liminf R_T / log T ≥ Σ Δ_a / KL(θ_a, θ*). It is asymptotic and ignores lower-order terms, so an
                    asymptotically optimal rule approaches the constant from below and can sit comfortably under C·log T at a finite horizon. Regret below the
                    line is therefore not a contradiction; regret growing faster than log T is the real failure.
                  </Notice>
                  <ExplanationPanel explanation={explanationOf(laiRobbins.value.provenance, 'liminf_{T→∞} R_T / log T ≥ Σ_{a : Δ_a > 0} Δ_a / KL(θ_a, θ*)')} />
                </Card>
              )}
              {laiRobbins && <ErrorNotice outcome={laiRobbins} />}

              {banditRun.result && (
                <>
                  <Card title="Cumulative regret against the lower bound" hint={`${banditRun.result.replications} replications over a horizon of ${banditRun.result.horizon.toLocaleString('en-US')}.`}>
                    <div style={{ overflowX: 'auto' }}>
                      <LineChart
                        title="Mean cumulative regret"
                        description="Mean cumulative pseudo-regret across replications for each algorithm, with the Lai–Robbins asymptotic lower bound."
                        series={[
                          ...banditRun.result.algorithms.map(
                            (a): CurveSeries => ({ label: a.label, points: a.regretCurve.map((p) => ({ x: p.t, y: p.meanRegret })) }),
                          ),
                          {
                            label: 'Lai–Robbins C·log t',
                            dashed: true,
                            points: banditRun.result.algorithms[0].regretCurve.map((p) => ({
                              x: p.t,
                              y: (banditRun.result as BanditExperimentResult).laiRobbins.constant * Math.log(p.t),
                            })),
                          },
                        ]}
                        xLabel="Pulls"
                        yLabel="Cumulative regret"
                        note="Each solid line is a mean over replications, not a run. The dashed line is the asymptotic lower bound; sitting below it at a finite horizon is expected rather than suspicious."
                      />
                    </div>
                  </Card>

                  <Card title="Regret is random: its distribution across replications">
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Final regret per algorithm with Monte Carlo error and spread across replications"
                        columns={
                          [
                            { key: 'a', header: 'Algorithm', render: (r) => r.label },
                            { key: 'm', header: 'Mean regret', numeric: true, render: (r) => `${formatValue(r.mean, 4)} ± ${formatValue(r.se, 3)}` },
                            { key: 'p5', header: '5th percentile', numeric: true, render: (r) => formatValue(r.p05, 4) },
                            { key: 'p50', header: 'Median', numeric: true, render: (r) => formatValue(r.p50, 4) },
                            { key: 'p95', header: '95th percentile', numeric: true, render: (r) => formatValue(r.p95, 4) },
                            { key: 's', header: 'log-log slope', numeric: true, render: (r) => formatValue(r.slope, 3) },
                            { key: 'sr', header: 'Simple regret', numeric: true, render: (r) => `${formatValue(r.simple, 4)} ± ${formatValue(r.simpleSe, 3)}` },
                          ] as ColumnDef<{
                            label: string;
                            mean: number;
                            se: number;
                            p05: number;
                            p50: number;
                            p95: number;
                            slope: number;
                            simple: number;
                            simpleSe: number;
                          }>[]
                        }
                        rows={banditRun.result.algorithms.map((a) => ({
                          label: a.label,
                          mean: a.finalRegret.meanRegret,
                          se: a.finalRegret.standardError,
                          p05: a.finalRegret.p05,
                          p50: a.finalRegret.p50,
                          p95: a.finalRegret.p95,
                          slope: a.regretLogLogSlope,
                          simple: a.simpleRegret.mean,
                          simpleSe: a.simpleRegret.standardError,
                        }))}
                      />
                    </div>
                    <Notice tone="warning" title="Read the error bars before ranking anything">
                      The ± figure is the Monte Carlo standard error of the mean; the percentiles describe the spread across runs, which is much wider. Two
                      algorithms whose means differ by less than a couple of standard errors have not been distinguished by this study, and a single run
                      distinguishes nothing at all. The log-log slope near 1 indicates regret growing linearly — an algorithm that never stops paying for
                      exploration — while a slope well below 1 is consistent with logarithmic growth.
                    </Notice>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Mean pulls of each arm, by algorithm"
                        columns={
                          [
                            { key: 'a', header: 'Algorithm', render: (r) => r.label },
                            ...armLabels.map((label, i) => ({
                              key: `arm${i}`,
                              header: `${label} (p = ${formatValue(config.armMeans[i], 3)})`,
                              numeric: true,
                              render: (r: { label: string; pulls: { meanPulls: number; standardError: number }[] }) =>
                                r.pulls[i] ? `${formatValue(r.pulls[i].meanPulls, 1)} ± ${formatValue(r.pulls[i].standardError, 1)}` : '—',
                            })),
                          ] as ColumnDef<{ label: string; pulls: { meanPulls: number; standardError: number }[] }>[]
                        }
                        rows={banditRun.result.algorithms.map((a) => ({ label: a.label, pulls: a.armPulls }))}
                      />
                    </div>
                    <ExplanationPanel explanation={explanationOf(banditRun.result.provenance)} />
                  </Card>
                </>
              )}

              <Card title="The Gittins index: exactly optimal, for a different objective">
                <Notice tone="info" title="What this will cost">
                  Building the index table for {config.gittinsMaxPulls} pulls at γ = {formatValue(config.gittinsDiscount, 3)} means backward induction over the
                  belief lattice for every candidate retirement value — a few hundred milliseconds. It runs only when asked.
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant={config.runGittins ? 'ghost' : 'primary'} onClick={() => set({ runGittins: !config.runGittins })}>
                    {config.runGittins ? 'Hide the index table' : 'Build the index table'}
                  </Button>
                </div>
                {gittins && <ErrorNotice outcome={gittins} />}
                {gittins?.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <HeatmapChart
                        title="Gittins index by successes and failures observed"
                        description="The retirement reward at which pulling this arm once more and retiring for that reward per period are exactly indifferent."
                        rows={gittins.value.map((_, s) => `${s} successes`)}
                        columns={gittins.value[0].map((_, f) => `${f} failures`)}
                        // The table is triangular — s successes and f failures
                        // cannot exceed the pulls it was built for — so the
                        // cells outside it are padded with NaN, which the chart
                        // draws as neutral and reports as undefined rather than
                        // inventing a value or crashing on a short row.
                        values={gittins.value.map((row) => Array.from({ length: config.gittinsMaxPulls + 1 }, (_, f) => row[f] ?? Number.NaN))}
                        valueLabel="Gittins index"
                      />
                    </div>
                    <p className="oc-chart-note">
                      Every index exceeds the arm&apos;s posterior mean, and the excess is the exploration bonus: an arm with 1 success and 0 failures has
                      posterior mean 2/3 but index {formatValue(gittins.value[1]?.[0] ?? Number.NaN, 4)}, because finding out about it has value beyond the
                      reward it returns. For the DISCOUNTED Bayesian bandit, pulling the arm of highest index is exactly optimal — Gittins&apos; theorem — so no
                      algorithm can beat it on that objective.
                    </p>
                    <Notice tone="info" title="Why it is not in the regret race above">
                      The index policy is optimal for discounted total reward, not for regret at a fixed horizon, and the two objectives genuinely differ. The
                      table also covers at most a few hundred pulls per arm, far short of the horizons used above. Comparing it on cumulative regret would be
                      scoring it against a criterion it does not optimise.
                    </Notice>
                  </>
                )}
              </Card>
            </>
          )}

          {/* ----------------------------------- 6. learning without a model */}
          {mode === 'learning' && (
            <>
              <Card title="Running the learner" hint="The transition probabilities above generate the samples; the learner never reads them.">
                <Notice tone="info" title="What this will cost">
                  {config.episodes.toLocaleString('en-US')} episodes × {config.stepsPerEpisode.toLocaleString('en-US')} steps ={' '}
                  {(config.episodes * config.stepsPerEpisode).toLocaleString('en-US')} sampled transitions, for each of Q-learning and SARSA. It runs only when
                  asked.
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant={config.runLearning ? 'ghost' : 'primary'} disabled={!valid} onClick={() => set({ runLearning: !config.runLearning })}>
                    {config.runLearning ? 'Clear the learning run' : 'Run Q-learning and SARSA'}
                  </Button>
                </div>
              </Card>

              {learning && (
                <>
                  {(['q', 'sarsa'] as const).map((which) => {
                    const outcome = learning[which];
                    const name = which === 'q' ? 'Q-learning (off-policy)' : 'SARSA (on-policy)';
                    return (
                      <Card key={which} title={name}>
                        <ErrorNotice outcome={outcome} />
                        {outcome.ok && (
                          <>
                            {outcome.value.diagnostics.converged ? (
                              <Notice tone="success" title="The convergence diagnostics are satisfied">
                                Every state-action pair met the visit requirement and the tail temporal-difference error is within tolerance. That is as much as
                                a finite run can show.
                              </Notice>
                            ) : (
                              <Notice tone="error" title="NOT CONVERGED — these values are not an answer">
                                {outcome.value.diagnostics.notConvergedReason ?? 'The run did not meet the convergence criteria.'}
                              </Notice>
                            )}
                            <div style={{ overflowX: 'auto' }}>
                              <DataTable
                                caption={`Learned values and policy from ${name}, against the exactly computed optimum`}
                                columns={
                                  [
                                    { key: 's', header: 'State', render: (r) => r.state },
                                    { key: 'l', header: 'Learned value', numeric: true, render: (r) => formatValue(r.learned, 5) },
                                    { key: 'o', header: 'Exact optimal value', numeric: true, render: (r) => (r.optimal === null ? 'not available' : formatValue(r.optimal, 5)) },
                                    { key: 'e', header: 'Error', numeric: true, render: (r) => (r.optimal === null ? '—' : formatValue(Math.abs(r.learned - r.optimal), 5)) },
                                    { key: 'a', header: 'Learned action', render: (r) => r.action },
                                    { key: 'oa', header: 'Optimal action', render: (r) => r.optimalAction },
                                  ] as ColumnDef<{ state: string; learned: number; optimal: number | null; action: string; optimalAction: string }>[]
                                }
                                rows={config.stateLabels.map((s, i) => {
                                  const cmp = outcome.value.diagnostics.comparison;
                                  return {
                                    state: s,
                                    learned: outcome.value.values[i],
                                    optimal: cmp ? cmp.optimalValues[i] : null,
                                    action: outcome.value.policyLabels[i],
                                    optimalAction: cmp ? (config.actionLabels[cmp.optimalPolicy[i]] ?? '—') : 'not available',
                                  };
                                })}
                              />
                            </div>
                            <KeyValueList
                              items={[
                                { label: 'Episodes completed', value: outcome.value.episodes.toLocaleString('en-US') },
                                { label: 'Sampled transitions', value: outcome.value.steps.toLocaleString('en-US') },
                                {
                                  label: 'Least visited state-action pair',
                                  value: `${config.stateLabels[outcome.value.diagnostics.leastVisitedPair.state] ?? '?'} / ${
                                    config.actionLabels[outcome.value.diagnostics.leastVisitedPair.action] ?? '?'
                                  } — ${outcome.value.diagnostics.leastVisitedPair.visits.toLocaleString('en-US')} visits`,
                                },
                                { label: 'Largest |ΔQ| in the final tenth of the run', value: formatValue(outcome.value.diagnostics.recentMaxChange, 5) },
                                { label: 'Largest mean temporal-difference error in the tail', value: formatValue(outcome.value.diagnostics.tailMeanBellmanResidual, 5) },
                                {
                                  label: 'Largest value error against the optimum',
                                  value: outcome.value.diagnostics.comparison
                                    ? `${formatValue(outcome.value.diagnostics.comparison.maxAbsValueError, 5)} (policy ${
                                        outcome.value.diagnostics.comparison.policyMatchesOptimum ? 'matches' : 'does NOT match'
                                      } the optimum)`
                                    : 'not available',
                                },
                                {
                                  label: 'How to read these numbers',
                                  value: <Badge variant="empirical">Empirical estimate from one seeded run</Badge>,
                                },
                              ]}
                            />
                            <ExplanationPanel explanation={explanationOf(outcome.value.provenance)} />
                          </>
                        )}
                      </Card>
                    );
                  })}

                  <Card title="What the convergence guarantees actually require">
                    <Notice tone="warning" title="A finite run does not meet the conditions">
                      <p>
                        Tabular Q-learning converges to the optimal action values with probability 1 under conditions no finite run satisfies: every
                        state-action pair visited infinitely often, and step sizes α_n with Σα_n = ∞ and Σα_n² &lt; ∞. A fixed number of episodes gives finite
                        visitation, and a constant step size fails the second condition outright — it tracks a moving target and never settles.
                      </p>
                      <p>
                        Stability of the iterates is not evidence of convergence either: a small step size makes the updates small whether or not the estimates
                        are right. The diagnostic that matters is the mean temporal-difference error in the tail, which is systematically non-zero when Q is
                        away from the fixed point however still it looks. When the engine reports a run as not converged, the learned values are shown as what
                        they are — an unfinished estimate — and not as the answer.
                      </p>
                    </Notice>
                    <Notice tone="info" title="Q-learning and SARSA are answering different questions">
                      Q-learning is off-policy: it estimates the value of acting optimally, not of the ε-greedy behaviour it actually followed. SARSA is
                      on-policy and estimates the value of the policy being followed, exploration included. Where exploring is costly the two differ
                      substantially, and SARSA&apos;s answer is the one that describes what the agent will actually experience.
                    </Notice>
                  </Card>
                </>
              )}
            </>
          )}

          {/* ------------------------------------------------ 7. explanation */}
          <Card title="How to read every number on this screen">
            <DataTable
              caption="Exactness label of each method used on this screen"
              columns={
                [
                  { key: 'm', header: 'Method', render: (r) => r.method },
                  { key: 'l', header: 'Label', render: (r) => <Badge variant={r.label}>{r.labelText}</Badge> },
                  { key: 'w', header: 'What that means here', render: (r) => r.meaning },
                ] as ColumnDef<{ method: string; label: 'exact' | 'numerical' | 'empirical'; labelText: string; meaning: string }>[]
              }
              rows={[
                {
                  method: 'Policy iteration',
                  label: 'exact',
                  labelText: 'Exact',
                  meaning: 'Terminates in finitely many improvements, and the value function is the exact solution of a linear system.',
                },
                {
                  method: 'The dual occupancy linear programme',
                  label: 'exact',
                  labelText: 'Exact',
                  meaning: 'A third route to the same optimum, sharing no code with the other two. Its agreement with them is the real cross-check.',
                },
                {
                  method: 'Backward induction over a finite horizon',
                  label: 'exact',
                  labelText: 'Exact',
                  meaning: 'Exact stage by stage. Its optimal policy is time-dependent.',
                },
                {
                  method: 'Value iteration',
                  label: 'numerical',
                  labelText: 'Numerical approximation',
                  meaning: 'Stops at a tolerance, and is reported only with its guaranteed distance to the optimum, ‖v − v*‖∞ ≤ ε·γ/(1−γ).',
                },
                {
                  method: 'QMDP and the fast informed bound',
                  label: 'numerical',
                  labelText: 'Numerical approximation',
                  meaning: 'Upper bounds on the POMDP optimum, optimistic by construction, and labelled as bounds rather than values.',
                },
                {
                  method: 'Exact alpha-vector POMDP value iteration',
                  label: 'exact',
                  labelText: 'Exact',
                  meaning: 'Exact for the stated horizon, with witness-LP pruning that discards no vector that is optimal anywhere.',
                },
                {
                  method: 'The secretary threshold and reservation values',
                  label: 'exact',
                  labelText: 'Exact',
                  meaning: 'Computed over every threshold rather than from an asymptotic rule of thumb; the reservation values use quadrature and say so.',
                },
                {
                  method: 'Bandit replications',
                  label: 'empirical',
                  labelText: 'Empirical estimate',
                  meaning: 'Means over replications with Monte Carlo standard errors and percentiles. A single run is not a result.',
                },
                {
                  method: 'Q-learning and SARSA',
                  label: 'empirical',
                  labelText: 'Empirical estimate',
                  meaning: 'One seeded run each, reported with visitation and residual diagnostics, and refused as converged when those diagnostics fail.',
                },
              ]}
            />
            <p className="oc-chart-note">
              Every one of these is exact or approximate <em>given the model</em>. The transition probabilities, rewards and arm means are assumptions you
              supplied; no arithmetic here can tell you whether the process is really Markov, whether the rewards are really those numbers, or whether the
              world will keep behaving as it did.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * The action index an engine issue refers to, or null.
 *
 * Issue fields look like `transitions[2][1]` for a row and `transitions[2][1][0]`
 * for a single cell, so the action is the SECOND bracketed index — matching on
 * the text alone would attribute a cell's successor index to the wrong action.
 */
function transitionActionOf(field: string | undefined): number | null {
  if (!field) return null;
  const m = /^transitions\[(\d+)\]\[(\d+)\]/.exec(field);
  return m ? Number(m[2]) : null;
}

/** Both components of a two-state belief, because one alone invites misreading. */
function formatProbabilityPair(left: number): string {
  return `${formatPercent(left, 4)} left / ${formatPercent(1 - left, 4)} right`;
}
