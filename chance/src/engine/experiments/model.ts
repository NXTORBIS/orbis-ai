/**
 * Random experiment laboratory: coins, dice, cards, urns and fully custom
 * outcome sets, with exact theoretical probabilities to compare against the
 * observed frequencies.
 *
 * An experiment consists of a *source* (what is being drawn from) and a
 * *procedure* (how many times, with or without replacement, and when to stop).
 * A trial is one complete run of the procedure; "repetitions" are how many
 * trials are simulated.
 */
import type { Issue } from '../core/result';
import { EngineError } from '../core/result';
import { compile, parseExpression, referencedVariables } from '../expression/expression';
import type { Random } from '../random/rng';
import type { PreparedModel, SimulationModelDef, OutputSpec } from '../simulation/types';
import { exactSumDistribution, type DiscreteDistributionTable } from './exact';
import { hypergeometric } from '../distributions/discrete';

export interface OutcomeFace {
  label: string;
  /** Numeric value used in success conditions and totals. */
  value: number;
  /** Relative weight; probabilities are weight / total. */
  weight: number;
}

export type ExperimentSourceKind = 'coin' | 'dice' | 'deck' | 'urn' | 'custom';

export interface CoinSource {
  kind: 'coin';
  count: number;
  /** Probability of heads (0.5 for a fair coin). */
  headsProbability: number;
}

export interface DiceSource {
  kind: 'dice';
  count: number;
  faces: number;
  /** Optional custom face weights (length = faces); omitted means fair. */
  weights?: number[];
}

export interface DeckSource {
  kind: 'deck';
  /** Number of standard 52-card decks combined. */
  decks: number;
  /** Cards drawn per trial. */
  draws: number;
  withReplacement: boolean;
  /** Ranks counted as a success, e.g. ['A'] or ['J','Q','K']. */
  successRanks: string[];
  /** Suits counted as a success. Empty means any suit. */
  successSuits: string[];
  /** A card is a success if it matches the rank filter AND the suit filter. */
}

export interface UrnSource {
  kind: 'urn';
  /** Objects in the collection, each with a count. */
  items: { label: string; count: number; value: number; success: boolean }[];
  draws: number;
  withReplacement: boolean;
}

export interface CustomSource {
  kind: 'custom';
  faces: OutcomeFace[];
  /** Draws per trial. */
  draws: number;
  withReplacement: boolean;
  /** Treat weights as counts of distinct objects when drawing without replacement. */
}

export type ExperimentSource = CoinSource | DiceSource | DeckSource | UrnSource | CustomSource;

export interface ExperimentConfig {
  source: ExperimentSource;
  /**
   * Optional success condition over the per-trial summary variables:
   *   total      — sum of drawn values
   *   successes  — count of outcomes flagged as successes
   *   draws      — number of draws made in the trial
   *   distinct   — number of distinct outcome values drawn
   *   maxRun     — longest run of identical consecutive outcomes
   * Example: "successes >= 2 and total < 20".
   */
  successCondition?: string;
  /** Record the individual outcome of the first draw (for frequency tables). */
  trackFirstDraw?: boolean;
}

export const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const CARD_SUITS = ['♠', '♥', '♦', '♣'] as const;

const SUMMARY_VARS = ['total', 'successes', 'draws', 'distinct', 'maxRun'];

export function validateExperiment(config: ExperimentConfig): Issue[] {
  const issues: Issue[] = [];
  const s = config?.source;
  if (!s) return [{ code: 'required', field: 'source', message: 'Configure the experiment source.' }];
  switch (s.kind) {
    case 'coin':
      if (!Number.isInteger(s.count) || s.count < 1 || s.count > 10000) {
        issues.push({ code: 'range', field: 'count', message: 'Number of coins must be a whole number between 1 and 10,000.' });
      }
      if (!(s.headsProbability >= 0 && s.headsProbability <= 1)) {
        issues.push({ code: 'range', field: 'headsProbability', message: 'Probability of heads must be between 0 and 1.' });
      }
      break;
    case 'dice':
      if (!Number.isInteger(s.count) || s.count < 1 || s.count > 1000) {
        issues.push({ code: 'range', field: 'count', message: 'Number of dice must be a whole number between 1 and 1,000.' });
      }
      if (!Number.isInteger(s.faces) || s.faces < 2 || s.faces > 1000) {
        issues.push({ code: 'range', field: 'faces', message: 'Number of faces must be a whole number between 2 and 1,000.' });
      }
      if (s.weights) {
        if (s.weights.length !== s.faces) {
          issues.push({ code: 'shape', field: 'weights', message: `Provide exactly ${s.faces} face weights, or none for a fair die.` });
        } else {
          const total = s.weights.reduce((a, b) => a + (Number.isFinite(b) && b >= 0 ? b : NaN), 0);
          if (!Number.isFinite(total)) issues.push({ code: 'range', field: 'weights', message: 'Face weights must be finite and 0 or greater.' });
          else if (total <= 0) issues.push({ code: 'sum', field: 'weights', message: 'At least one face weight must be greater than 0.' });
        }
      }
      break;
    case 'deck':
      if (!Number.isInteger(s.decks) || s.decks < 1 || s.decks > 20) {
        issues.push({ code: 'range', field: 'decks', message: 'Number of decks must be a whole number between 1 and 20.' });
      }
      if (!Number.isInteger(s.draws) || s.draws < 1) {
        issues.push({ code: 'range', field: 'draws', message: 'Draws must be a whole number of at least 1.' });
      } else if (!s.withReplacement && s.draws > 52 * (s.decks || 1)) {
        issues.push({
          code: 'range',
          field: 'draws',
          message: `You cannot draw ${s.draws} cards without replacement from ${52 * s.decks} cards. Reduce the number of draws or enable replacement.`,
        });
      }
      for (const r of s.successRanks ?? []) {
        if (!CARD_RANKS.includes(r as never)) issues.push({ code: 'unknown', field: 'successRanks', message: `"${r}" is not a card rank.` });
      }
      for (const u of s.successSuits ?? []) {
        if (!CARD_SUITS.includes(u as never)) issues.push({ code: 'unknown', field: 'successSuits', message: `"${u}" is not a card suit.` });
      }
      break;
    case 'urn': {
      if (!Array.isArray(s.items) || s.items.length === 0) {
        issues.push({ code: 'required', field: 'items', message: 'Add at least one kind of object to the collection.' });
        break;
      }
      let total = 0;
      for (const it of s.items) {
        if (!Number.isInteger(it.count) || it.count < 0) {
          issues.push({ code: 'range', field: 'items', message: `"${it.label}": count must be a whole number of 0 or more.` });
        } else total += it.count;
        if (!Number.isFinite(it.value)) issues.push({ code: 'finite', field: 'items', message: `"${it.label}": value must be a number.` });
      }
      if (total === 0) issues.push({ code: 'sum', field: 'items', message: 'The collection is empty. Add at least one object.' });
      if (!Number.isInteger(s.draws) || s.draws < 1) {
        issues.push({ code: 'range', field: 'draws', message: 'Draws must be a whole number of at least 1.' });
      } else if (!s.withReplacement && s.draws > total) {
        issues.push({
          code: 'range',
          field: 'draws',
          message: `You cannot draw ${s.draws} objects without replacement from a collection of ${total}. Reduce the draws or enable replacement.`,
        });
      }
      break;
    }
    case 'custom': {
      if (!Array.isArray(s.faces) || s.faces.length < 1) {
        issues.push({ code: 'required', field: 'faces', message: 'Define at least one outcome.' });
        break;
      }
      if (s.faces.length > 2000) issues.push({ code: 'limit', field: 'faces', message: 'At most 2,000 outcomes are supported.' });
      let total = 0;
      for (const f of s.faces) {
        if (!Number.isFinite(f.weight) || f.weight < 0) {
          issues.push({ code: 'range', field: 'faces', message: `"${f.label}": weight must be finite and 0 or greater.` });
        } else total += f.weight;
        if (!Number.isFinite(f.value)) issues.push({ code: 'finite', field: 'faces', message: `"${f.label}": value must be a number.` });
      }
      if (total <= 0) issues.push({ code: 'sum', field: 'faces', message: 'At least one outcome weight must be greater than 0.' });
      if (!Number.isInteger(s.draws) || s.draws < 1) {
        issues.push({ code: 'range', field: 'draws', message: 'Draws must be a whole number of at least 1.' });
      }
      if (!s.withReplacement) {
        const allInt = s.faces.every((f) => Number.isInteger(f.weight));
        if (!allInt) {
          issues.push({
            code: 'unsupported',
            field: 'withReplacement',
            message: 'Drawing without replacement needs whole-number counts for each outcome, because each draw removes one object. Either enter counts as whole numbers or draw with replacement.',
          });
        } else if (s.draws > total) {
          issues.push({ code: 'range', field: 'draws', message: `You cannot draw ${s.draws} objects without replacement from a collection of ${total}.` });
        }
      }
      break;
    }
    default:
      issues.push({ code: 'unknown', field: 'source', message: 'Unsupported experiment type.' });
  }
  if (config.successCondition?.trim()) {
    try {
      const node = parseExpression(config.successCondition);
      for (const v of referencedVariables(node)) {
        if (!SUMMARY_VARS.includes(v)) {
          issues.push({
            code: 'unknown-variable',
            field: 'successCondition',
            message: `"${v}" is not available in a success condition. Use one of: ${SUMMARY_VARS.join(', ')}.`,
          });
        }
      }
    } catch (e) {
      issues.push({ code: 'syntax', field: 'successCondition', message: (e as Error).message });
    }
  }
  return issues;
}

interface NormalisedSource {
  /** One entry per distinct outcome. */
  faces: OutcomeFace[];
  /** Counts for sampling without replacement (integers), or null when weights are continuous. */
  counts: number[] | null;
  successFlags: boolean[];
  draws: number;
  withReplacement: boolean;
  /** Human description of the source. */
  describe: string;
  /** Labels for display. */
  labels: string[];
}

export function normaliseSource(s: ExperimentSource): NormalisedSource {
  switch (s.kind) {
    case 'coin': {
      const faces: OutcomeFace[] = [
        { label: 'Heads', value: 1, weight: s.headsProbability },
        { label: 'Tails', value: 0, weight: 1 - s.headsProbability },
      ];
      return {
        faces,
        counts: null,
        successFlags: [true, false],
        draws: s.count,
        withReplacement: true,
        describe:
          s.headsProbability === 0.5
            ? `${s.count} fair coin${s.count > 1 ? 's' : ''} (heads probability 0.5)`
            : `${s.count} biased coin${s.count > 1 ? 's' : ''} with heads probability ${s.headsProbability}`,
        labels: ['Heads', 'Tails'],
      };
    }
    case 'dice': {
      const w = s.weights ?? new Array<number>(s.faces).fill(1);
      const faces: OutcomeFace[] = Array.from({ length: s.faces }, (_, i) => ({ label: String(i + 1), value: i + 1, weight: w[i] }));
      return {
        faces,
        counts: null,
        successFlags: faces.map(() => false),
        draws: s.count,
        withReplacement: true,
        describe: `${s.count} ${s.weights ? 'weighted' : 'fair'} ${s.faces}-sided di${s.count > 1 ? 'ce' : 'e'}`,
        labels: faces.map((f) => f.label),
      };
    }
    case 'deck': {
      const ranks = new Set(s.successRanks ?? []);
      const suits = new Set(s.successSuits ?? []);
      const faces: OutcomeFace[] = [];
      const flags: boolean[] = [];
      for (const r of CARD_RANKS) {
        for (const u of CARD_SUITS) {
          const rankOk = ranks.size === 0 ? false : ranks.has(r);
          const suitOk = suits.size === 0 ? true : suits.has(u);
          const success = ranks.size === 0 && suits.size > 0 ? suitOk : rankOk && suitOk;
          const value = CARD_RANKS.indexOf(r) + 1;
          faces.push({ label: `${r}${u}`, value, weight: s.decks });
          flags.push(success);
        }
      }
      return {
        faces,
        counts: faces.map(() => s.decks),
        successFlags: flags,
        draws: s.draws,
        withReplacement: s.withReplacement,
        describe: `${s.draws} card${s.draws > 1 ? 's' : ''} drawn ${s.withReplacement ? 'with' : 'without'} replacement from ${s.decks === 1 ? 'a standard 52-card deck' : `${s.decks} combined decks (${52 * s.decks} cards)`}`,
        labels: faces.map((f) => f.label),
      };
    }
    case 'urn': {
      const items = s.items.filter((it) => it.count > 0);
      return {
        faces: items.map((it) => ({ label: it.label, value: it.value, weight: it.count })),
        counts: items.map((it) => it.count),
        successFlags: items.map((it) => it.success),
        draws: s.draws,
        withReplacement: s.withReplacement,
        describe: `${s.draws} object${s.draws > 1 ? 's' : ''} drawn ${s.withReplacement ? 'with' : 'without'} replacement from ${items.reduce((a, it) => a + it.count, 0)} objects (${items.map((it) => `${it.count} × ${it.label}`).join(', ')})`,
        labels: items.map((it) => it.label),
      };
    }
    case 'custom': {
      const faces = s.faces.filter((f) => f.weight > 0);
      const allInt = faces.every((f) => Number.isInteger(f.weight));
      const total = faces.reduce((a, f) => a + f.weight, 0);
      return {
        faces,
        counts: allInt ? faces.map((f) => f.weight) : null,
        successFlags: faces.map(() => false),
        draws: s.draws,
        withReplacement: s.withReplacement,
        describe: `${s.draws} draw${s.draws > 1 ? 's' : ''} ${s.withReplacement ? 'with' : 'without'} replacement from ${faces.length} outcome(s) with total weight ${total}`,
        labels: faces.map((f) => f.label),
      };
    }
  }
}

export function prepareExperiment(config: ExperimentConfig): PreparedModel {
  const issues = validateExperiment(config);
  if (issues.length) throw new EngineError(issues);
  const src = normaliseSource(config.source);
  const k = src.faces.length;
  const totalWeight = src.faces.reduce((a, f) => a + f.weight, 0);
  const probs = src.faces.map((f) => f.weight / totalWeight);
  const cum = new Float64Array(k);
  {
    let acc = 0;
    for (let i = 0; i < k; i++) {
      acc += probs[i];
      cum[i] = acc;
    }
    cum[k - 1] = 1;
  }

  const outputs: OutputSpec[] = [
    { key: 'total', label: 'Total of drawn values', kind: 'discrete' },
    { key: 'successes', label: 'Number of successes', kind: 'discrete' },
    { key: 'distinct', label: 'Distinct outcomes drawn', kind: 'discrete' },
    { key: 'maxRun', label: 'Longest run of identical consecutive outcomes', kind: 'discrete' },
  ];
  const condition = config.successCondition?.trim()
    ? compile(parseExpression(config.successCondition), new Map(SUMMARY_VARS.map((v, i) => [v, i])))
    : null;
  if (condition) outputs.push({ key: 'conditionMet', label: `Condition met: ${config.successCondition}`, kind: 'indicator' });
  if (config.trackFirstDraw) outputs.push({ key: 'firstDraw', label: 'Outcome index of the first draw', kind: 'discrete' });

  // Exact theoretical values where a closed form exists.
  const theoretical: PreparedModel['theoretical'] = {};
  const meanValue = src.faces.reduce((a, f, i) => a + f.value * probs[i], 0);
  const meanSquare = src.faces.reduce((a, f, i) => a + f.value * f.value * probs[i], 0);
  const successProb = src.successFlags.reduce((a, flag, i) => a + (flag ? probs[i] : 0), 0);
  if (src.withReplacement) {
    const varValue = meanSquare - meanValue * meanValue;
    theoretical.total = {
      mean: src.draws * meanValue,
      variance: src.draws * varValue,
      source: `Independent draws: E[total] = n·E[value] = ${src.draws} × ${meanValue.toPrecision(6)}`,
    };
    theoretical.successes = {
      mean: src.draws * successProb,
      probability: successProb,
      variance: src.draws * successProb * (1 - successProb),
      source: `Binomial(${src.draws}, ${successProb.toPrecision(6)}) because draws are independent`,
    };
  } else {
    // Without replacement: sampling from a finite population.
    const N = src.counts!.reduce((a, c) => a + c, 0);
    const n = src.draws;
    const popMean = src.faces.reduce((a, f, i) => a + f.value * (src.counts![i] / N), 0);
    const popVar = src.faces.reduce((a, f, i) => a + (f.value - popMean) ** 2 * (src.counts![i] / N), 0);
    const K = src.counts!.reduce((a, c, i) => a + (src.successFlags[i] ? c : 0), 0);
    theoretical.total = {
      mean: n * popMean,
      // Finite-population correction: Var = n·σ²·(N−n)/(N−1) with σ² the population variance.
      variance: N > 1 ? (n * popVar * (N - n)) / (N - 1) : 0,
      source: `Sampling without replacement from ${N} objects: E[total] = n·μ, Var = n·σ²·(N−n)/(N−1)`,
    };
    theoretical.successes = {
      mean: (n * K) / N,
      variance: N > 1 ? (n * (K / N) * (1 - K / N) * (N - n)) / (N - 1) : 0,
      source: `Hypergeometric(N = ${N}, K = ${K}, n = ${n}) because draws are dependent without replacement`,
    };
  }

  const assumptions: string[] = [`Source: ${src.describe}.`];
  if (src.withReplacement) assumptions.push('Each draw is independent of the others because the object is replaced (or the source is unlimited).');
  else assumptions.push('Draws are dependent: each object removed changes the composition of what remains, so later draws have different probabilities.');
  if (config.source.kind === 'custom' && Math.abs(totalWeight - 1) > 1e-9 && config.source.withReplacement) {
    assumptions.push(`The outcome weights total ${totalWeight}, not 1. They have been treated as relative weights, so each probability is weight ÷ ${totalWeight}. No weight was altered.`);
  }

  // Scratch state reused between trials.
  const counts = new Int32Array(k);
  const remaining = new Int32Array(k);
  const summary = new Float64Array(SUMMARY_VARS.length);

  return {
    outputs,
    theoretical,
    assumptions,
    procedure: `Each repetition performs the full procedure: ${src.describe}.`,
    runTrial(rng: Random, out) {
      counts.fill(0);
      let total = 0;
      let successes = 0;
      let distinct = 0;
      let maxRun = 0;
      let runLength = 0;
      let prev = -1;
      let firstDraw = -1;
      if (src.withReplacement) {
        for (let d = 0; d < src.draws; d++) {
          const i = rng.categorical(cum);
          if (d === 0) firstDraw = i;
          if (counts[i]++ === 0) distinct++;
          total += src.faces[i].value;
          if (src.successFlags[i]) successes++;
          if (i === prev) runLength++;
          else {
            runLength = 1;
            prev = i;
          }
          if (runLength > maxRun) maxRun = runLength;
        }
      } else {
        remaining.set(src.counts!);
        let pool = 0;
        for (let i = 0; i < k; i++) pool += remaining[i];
        for (let d = 0; d < src.draws && pool > 0; d++) {
          // Draw uniformly from the remaining objects.
          let r = rng.uniform() * pool;
          let i = 0;
          while (i < k - 1) {
            r -= remaining[i];
            if (r < 0) break;
            i++;
          }
          remaining[i]--;
          pool--;
          if (d === 0) firstDraw = i;
          if (counts[i]++ === 0) distinct++;
          total += src.faces[i].value;
          if (src.successFlags[i]) successes++;
          if (i === prev) runLength++;
          else {
            runLength = 1;
            prev = i;
          }
          if (runLength > maxRun) maxRun = runLength;
        }
      }
      out[0] = total;
      out[1] = successes;
      out[2] = distinct;
      out[3] = maxRun;
      let next = 4;
      if (condition) {
        summary[0] = total;
        summary[1] = successes;
        summary[2] = src.draws;
        summary[3] = distinct;
        summary[4] = maxRun;
        out[next++] = condition(summary) !== 0 ? 1 : 0;
      }
      if (config.trackFirstDraw) out[next++] = firstDraw;
    },
  };
}

export const experimentModel: SimulationModelDef<ExperimentConfig> = {
  id: 'experiment',
  name: 'Random experiment',
  description: 'Coins, dice, cards, urns or a custom outcome set, repeated many times.',
  validate: validateExperiment,
  prepare: prepareExperiment,
};

/**
 * Exact distribution of the per-trial total, when it is feasible to compute.
 * Used to overlay the theoretical distribution on the observed frequencies.
 */
export function exactTotalDistribution(config: ExperimentConfig): DiscreteDistributionTable | null {
  const issues = validateExperiment(config);
  if (issues.length) return null;
  const src = normaliseSource(config.source);
  if (!src.withReplacement) return null; // dependent draws: no simple convolution
  const totalWeight = src.faces.reduce((a, f) => a + f.weight, 0);
  const single = src.faces.map((f) => ({ value: f.value, probability: f.weight / totalWeight }));
  return exactSumDistribution(single, src.draws);
}

/** Exact distribution of the number of successes. */
export function exactSuccessDistribution(config: ExperimentConfig): DiscreteDistributionTable | null {
  const issues = validateExperiment(config);
  if (issues.length) return null;
  const src = normaliseSource(config.source);
  const totalWeight = src.faces.reduce((a, f) => a + f.weight, 0);
  if (src.withReplacement) {
    const p = src.successFlags.reduce((a, flag, i) => a + (flag ? src.faces[i].weight / totalWeight : 0), 0);
    if (p === 0) return null;
    return exactSumDistribution([{ value: 1, probability: p }, { value: 0, probability: 1 - p }], src.draws);
  }
  const N = src.counts!.reduce((a, c) => a + c, 0);
  const K = src.counts!.reduce((a, c, i) => a + (src.successFlags[i] ? c : 0), 0);
  if (K === 0 || src.draws > N) return null;
  // Hypergeometric pmf over the valid support.
  const lo = Math.max(0, src.draws + K - N);
  const hi = Math.min(src.draws, K);
  const rows: { value: number; probability: number }[] = [];
  for (let x = lo; x <= hi; x++) {
    rows.push({ value: x, probability: hypergeometricPmf(x, N, K, src.draws) });
  }
  return { rows, exact: true, method: `Hypergeometric(N = ${N}, K = ${K}, n = ${src.draws})` };
}

function hypergeometricPmf(k: number, N: number, K: number, n: number): number {
  return hypergeometric.pdf(k, { N, K, n });
}
