/**
 * Structure learning — the most fragile thing in this module, and labelled as
 * such everywhere it appears.
 *
 * The PC algorithm returns a CPDAG: the Markov equivalence class of DAGs that
 * imply the same conditional independences. An undirected edge in that output
 * is not a weak orientation, it is NO orientation — the data cannot tell the
 * two directions apart, and choosing one is guessing. The significance level
 * of the independence test is a free parameter that changes the graph, so
 * `structureStability` re-runs the search across levels and reports the
 * disagreement rather than hiding it.
 */

import { EngineError } from '../core/result.ts';
import { mean, variance } from '../stats/descriptive.ts';
import { normalCdf } from '../special/gamma.ts';
import { solve, type Matrix } from '../stats/linalg.ts';
import { chiSquareSf, type DiGraph } from './deps.ts';
import { PC_EQUIVALENCE_ONLY, PC_FAITHFULNESS, PC_MARKOV, PC_SUFFICIENCY } from './assumptions.ts';
import type { AssumptionStatement } from './types.ts';

export interface ContinuousDataset {
  kind: 'continuous';
  variables: readonly string[];
  /** Column-major: one array per variable, all the same length. */
  columns: readonly (readonly number[])[];
}

export interface DiscreteDataset {
  kind: 'discrete';
  variables: readonly string[];
  /** Integer category codes 0..cardinality−1 per variable. */
  columns: readonly (readonly number[])[];
  cardinalities: readonly number[];
}

export type Dataset = ContinuousDataset | DiscreteDataset;

export interface CiTestResult {
  statistic: number;
  pValue: number;
  degreesOfFreedom: number;
  /** Partial correlation, for the Fisher z test. */
  partialCorrelation: number | null;
  independent: boolean;
  method: string;
}

function validateDataset(d: Dataset): number {
  if (d.variables.length < 2) {
    throw new EngineError('Structure learning needs at least two variables.', 'size');
  }
  if (d.columns.length !== d.variables.length) {
    throw new EngineError(
      `Structure learning: ${d.variables.length} variable names but ${d.columns.length} data columns.`,
      'length',
    );
  }
  const n = d.columns[0].length;
  if (n < 10) {
    throw new EngineError(
      `Structure learning: ${n} rows. Conditional-independence testing on this little data has essentially no ` +
        'power, so the recovered graph would reflect the test\'s failure to reject rather than the structure. No ' +
        'graph is returned.',
      'size',
    );
  }
  for (let j = 0; j < d.columns.length; j++) {
    if (d.columns[j].length !== n) {
      throw new EngineError(`Structure learning: column "${d.variables[j]}" has a different length.`, 'length');
    }
    for (const v of d.columns[j]) {
      if (!Number.isFinite(v)) {
        throw new EngineError(`Structure learning: variable "${d.variables[j]}" has a non-finite value.`, 'finite');
      }
    }
    if (d.kind === 'continuous' && !(variance(d.columns[j].slice(), 1) > 0)) {
      throw new EngineError(
        `Structure learning: variable "${d.variables[j]}" is constant. A constant is independent of everything by ` +
          'definition and makes the correlation matrix singular; remove it.',
        'zero-variance',
      );
    }
  }
  return n;
}

function correlationMatrix(columns: readonly (readonly number[])[]): Matrix {
  const k = columns.length;
  const m = columns.map((c) => mean(c));
  const s = columns.map((c, j) => Math.sqrt(variance(c.slice(), 1)) || (() => {
    throw new EngineError(`Variable ${j} is constant; the correlation matrix is undefined.`, 'zero-variance');
  })());
  const n = columns[0].length;
  const R: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      let acc = 0;
      for (let i = 0; i < n; i++) acc += (columns[a][i] - m[a]) * (columns[b][i] - m[b]);
      const r = acc / ((n - 1) * s[a] * s[b]);
      R[a][b] = r;
      R[b][a] = r;
    }
  }
  return R;
}

/**
 * Fisher z test of zero partial correlation, for continuous (jointly normal)
 * data. The partial correlation is read off the inverse of the sub-correlation
 * matrix, which is numerically safer than recursive elimination.
 */
export function fisherZTest(
  data: ContinuousDataset,
  i: number,
  j: number,
  conditioningSet: readonly number[],
  alpha = 0.05,
  cachedCorrelation?: Matrix,
): CiTestResult {
  const n = data.columns[0].length;
  const R = cachedCorrelation ?? correlationMatrix(data.columns);
  const idx = [i, j, ...conditioningSet];
  if (new Set(idx).size !== idx.length) {
    throw new EngineError('Fisher z test: the conditioning set must not contain the tested variables.', 'invalid');
  }
  const k = idx.length;
  if (n - k - 1 <= 0) {
    throw new EngineError(
      `Fisher z test: conditioning on ${conditioningSet.length} variable(s) with ${n} rows leaves no degrees of ` +
        'freedom. The partial correlation is not estimable, so no test is reported.',
      'size',
    );
  }
  const sub: Matrix = idx.map((a) => idx.map((b) => R[a][b]));
  // Inverse of the sub-correlation matrix: precision entries give the partials.
  const inv: number[][] = [];
  for (let c = 0; c < k; c++) {
    const e = new Array<number>(k).fill(0);
    e[c] = 1;
    const col = solve(
      sub.map((r) => r.slice()),
      e,
    );
    if (col === null) {
      throw new EngineError(
        'Fisher z test: the sub-correlation matrix is singular, which means two of the variables involved are ' +
          'perfectly collinear. The partial correlation is undefined; no test is reported.',
        'singular',
      );
    }
    inv.push(col);
  }
  const p00 = inv[0][0];
  const p11 = inv[1][1];
  const p01 = inv[1][0];
  const denom = Math.sqrt(p00 * p11);
  if (!(denom > 0)) {
    throw new EngineError('Fisher z test: a non-positive precision diagonal; the partial correlation is undefined.', 'singular');
  }
  let r = -p01 / denom;
  r = Math.max(-0.999999999999, Math.min(0.999999999999, r));
  const z = 0.5 * Math.log((1 + r) / (1 - r)) * Math.sqrt(n - conditioningSet.length - 3);
  if (!Number.isFinite(z)) {
    throw new EngineError(
      `Fisher z test: the statistic is non-finite (n = ${n}, |S| = ${conditioningSet.length}). With ` +
        'n − |S| − 3 ≤ 0 the transformation has no scale; no test is reported.',
      'finite',
    );
  }
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    statistic: z,
    pValue: p,
    degreesOfFreedom: n - conditioningSet.length - 3,
    partialCorrelation: r,
    independent: p >= alpha,
    method: 'Fisher z test of zero partial correlation (assumes joint normality and linear relationships)',
  };
}

/**
 * G² likelihood-ratio test of conditional independence for discrete data.
 * Cells with zero expected count are dropped from both the statistic and the
 * degrees of freedom, as in the standard treatment of structural zeros.
 */
export function gSquareTest(
  data: DiscreteDataset,
  i: number,
  j: number,
  conditioningSet: readonly number[],
  alpha = 0.05,
): CiTestResult {
  const n = data.columns[0].length;
  const ri = data.cardinalities[i];
  const rj = data.cardinalities[j];
  if (!(ri >= 2) || !(rj >= 2)) {
    throw new EngineError(
      `G² test: variable "${data.variables[ri >= 2 ? j : i]}" has fewer than two categories, so it is constant ` +
        'and independent of everything by definition.',
      'zero-variance',
    );
  }
  let condLevels = 1;
  for (const s of conditioningSet) condLevels *= data.cardinalities[s];
  if (condLevels * ri * rj > 20 * n) {
    throw new EngineError(
      `G² test: conditioning on ${conditioningSet.length} variable(s) gives ${condLevels * ri * rj} contingency ` +
        `cells for ${n} rows — about ${(n / (condLevels * ri * rj)).toFixed(2)} observations per cell. The ` +
        'chi-square approximation is invalid at this sparsity and the test would reject or fail to reject at ' +
        'random. No test is reported; reduce the conditioning-set size or collapse categories.',
      'sparse',
    );
  }
  const counts = new Map<string, number[]>();
  for (let r = 0; r < n; r++) {
    const key = conditioningSet.map((s) => data.columns[s][r]).join(',');
    let tab = counts.get(key);
    if (!tab) {
      tab = new Array<number>(ri * rj).fill(0);
      counts.set(key, tab);
    }
    tab[data.columns[i][r] * rj + data.columns[j][r]]++;
  }
  let g = 0;
  let df = 0;
  for (const tab of counts.values()) {
    const rowSums = new Array<number>(ri).fill(0);
    const colSums = new Array<number>(rj).fill(0);
    let total = 0;
    for (let a = 0; a < ri; a++)
      for (let b = 0; b < rj; b++) {
        rowSums[a] += tab[a * rj + b];
        colSums[b] += tab[a * rj + b];
        total += tab[a * rj + b];
      }
    if (total === 0) continue;
    const nzRows = rowSums.filter((v) => v > 0).length;
    const nzCols = colSums.filter((v) => v > 0).length;
    if (nzRows < 2 || nzCols < 2) continue;
    for (let a = 0; a < ri; a++)
      for (let b = 0; b < rj; b++) {
        const o = tab[a * rj + b];
        if (o === 0) continue;
        const e = (rowSums[a] * colSums[b]) / total;
        if (!(e > 0)) continue;
        g += 2 * o * Math.log(o / e);
      }
    df += (nzRows - 1) * (nzCols - 1);
  }
  if (df === 0) {
    // No stratum has variation in both variables: independence cannot be
    // rejected, and that is reported rather than treated as evidence of it.
    return {
      statistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      partialCorrelation: null,
      independent: true,
      method:
        'G² likelihood-ratio test — NO STRATUM had variation in both variables, so the test has zero degrees of ' +
        'freedom and cannot reject. The edge is removed for lack of evidence, not because independence was shown.',
    };
  }
  const p = chiSquareSf(g, df);
  return {
    statistic: g,
    pValue: p,
    degreesOfFreedom: df,
    partialCorrelation: null,
    independent: p >= alpha,
    method: `G² likelihood-ratio test of conditional independence (${df} df over ${counts.size} stratum/strata)`,
  };
}

export interface Cpdag {
  variables: string[];
  /** Edges the equivalence class orients. */
  directed: { from: string; to: string }[];
  /** Edges present but NOT orientable from these data. */
  undirected: { a: string; b: string }[];
  /** The separating set that removed each absent adjacency. */
  separationSets: { a: string; b: string; given: string[] }[];
  /** Number of independence tests performed. */
  testsPerformed: number;
  alpha: number;
  /** Colliders found by orientation rule 0. */
  colliders: { a: string; collider: string; b: string }[];
  assumptions: AssumptionStatement[];
  untestability: string;
  warnings: string[];
  notes: string[];
  /** The directed part only, in the engine's shared DiGraph shape. */
  directedPart: DiGraph;
}

function* subsetsOfSize(items: readonly number[], size: number): Generator<number[]> {
  const n = items.length;
  if (size > n) return;
  const idx = Array.from({ length: size }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => items[i]);
    let k = size - 1;
    while (k >= 0 && idx[k] === n - size + k) k--;
    if (k < 0) return;
    idx[k]++;
    for (let m = k + 1; m < size; m++) idx[m] = idx[m - 1] + 1;
  }
}

/**
 * The PC algorithm (Spirtes–Glymour). Adjacency search by conditional
 * independence, then collider orientation and Meek's rules.
 */
export function pcAlgorithm(
  data: Dataset,
  options: { alpha?: number; maxConditioningSize?: number } = {},
): Cpdag {
  const n = validateDataset(data);
  const alpha = options.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) throw new EngineError(`PC: alpha must lie in (0,1); got ${alpha}.`, 'range');
  const k = data.variables.length;
  const maxDepth = options.maxConditioningSize ?? k - 2;
  const adj: Set<number>[] = Array.from({ length: k }, (_, a) => new Set(Array.from({ length: k }, (_, b) => b).filter((b) => b !== a)));
  const sepset = new Map<string, number[]>();
  const key = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let tests = 0;
  const cachedR = data.kind === 'continuous' ? correlationMatrix(data.columns) : undefined;
  const test = (a: number, b: number, S: readonly number[]): CiTestResult => {
    tests++;
    return data.kind === 'continuous'
      ? fisherZTest(data, a, b, S, alpha, cachedR)
      : gSquareTest(data, a, b, S, alpha);
  };

  for (let depth = 0; depth <= maxDepth; depth++) {
    let anyCandidate = false;
    const pairs: [number, number][] = [];
    for (let a = 0; a < k; a++) for (const b of adj[a]) if (a < b) pairs.push([a, b]);
    for (const [a, b] of pairs) {
      if (!adj[a].has(b)) continue;
      for (const source of [a, b]) {
        const others = [...adj[source]].filter((x) => x !== (source === a ? b : a));
        if (others.length < depth) continue;
        anyCandidate = true;
        let removed = false;
        for (const S of subsetsOfSize(others, depth)) {
          const res = test(a, b, S);
          if (res.independent) {
            adj[a].delete(b);
            adj[b].delete(a);
            sepset.set(key(a, b), S.slice());
            removed = true;
            break;
          }
        }
        if (removed) break;
      }
    }
    if (!anyCandidate) break;
  }

  // Orientation. `dir[a][b] = true` means a → b.
  const dir: boolean[][] = Array.from({ length: k }, () => new Array<boolean>(k).fill(false));
  const colliders: Cpdag['colliders'] = [];
  for (let b = 0; b < k; b++) {
    const nb = [...adj[b]];
    for (let x = 0; x < nb.length; x++)
      for (let y = x + 1; y < nb.length; y++) {
        const a = nb[x];
        const c = nb[y];
        if (adj[a].has(c)) continue; // a and c adjacent: not an unshielded triple.
        const S = sepset.get(key(a, c));
        if (S === undefined) continue;
        if (!S.includes(b)) {
          dir[a][b] = true;
          dir[c][b] = true;
          colliders.push({ a: data.variables[a], collider: data.variables[b], b: data.variables[c] });
        }
      }
  }
  // Meek's rules, applied to a fixed point.
  const isUndirected = (a: number, b: number): boolean => adj[a].has(b) && !dir[a][b] && !dir[b][a];
  for (let pass = 0; pass < 10 * k * k; pass++) {
    let changed = false;
    for (let a = 0; a < k; a++)
      for (let b = 0; b < k; b++) {
        if (a === b) continue;
        // R1: a → b and b — c with a, c non-adjacent ⟹ b → c.
        if (dir[a][b]) {
          for (const c of adj[b]) {
            if (c === a || !isUndirected(b, c) || adj[a].has(c)) continue;
            dir[b][c] = true;
            changed = true;
          }
        }
        // R2: a → c → b and a — b ⟹ a → b.
        if (isUndirected(a, b)) {
          for (const c of adj[a]) {
            if (c === b) continue;
            if (dir[a][c] && dir[c][b]) {
              dir[a][b] = true;
              changed = true;
              break;
            }
          }
        }
        // R3: a — c, a — d, c → b, d → b, a — b, c and d non-adjacent ⟹ a → b.
        if (isUndirected(a, b)) {
          const cand = [...adj[a]].filter((c) => c !== b && isUndirected(a, c) && dir[c][b]);
          let done = false;
          for (let x = 0; x < cand.length && !done; x++)
            for (let y = x + 1; y < cand.length && !done; y++) {
              if (!adj[cand[x]].has(cand[y])) {
                dir[a][b] = true;
                changed = true;
                done = true;
              }
            }
        }
      }
    if (!changed) break;
  }

  const directed: Cpdag['directed'] = [];
  const undirected: Cpdag['undirected'] = [];
  for (let a = 0; a < k; a++)
    for (const b of adj[a]) {
      if (a >= b && !dir[a][b]) continue;
      if (dir[a][b] && !dir[b][a]) directed.push({ from: data.variables[a], to: data.variables[b] });
      else if (!dir[a][b] && !dir[b][a] && a < b) undirected.push({ a: data.variables[a], b: data.variables[b] });
    }
  const parents = new Map<string, string[]>();
  for (const v of data.variables) parents.set(v, []);
  for (const e of directed) (parents.get(e.to) as string[]).push(e.from);

  const warnings: string[] = [
    'STRUCTURE LEARNING IS THE LEAST RELIABLE OUTPUT IN THIS MODULE. It assumes causal sufficiency (no ' +
      'unmeasured common cause of any two variables) and faithfulness, neither of which can be checked, and it ' +
      'recovers only an equivalence class even when both hold.',
    `${undirected.length} of ${directed.length + undirected.length} edge(s) could not be oriented. Those edges ` +
      'point in a direction the data CANNOT determine. Any arrow drawn on them is an assumption, not a finding.',
    `The significance level α = ${alpha} is a free parameter and the graph depends on it. Re-run with ` +
      '`structureStability` and treat only the edges that survive across levels as worth discussing.',
  ];
  if (data.kind === 'continuous') {
    warnings.push(
      'The Fisher z test assumes joint normality and strictly linear relationships. A non-linear dependence ' +
        'with zero correlation is read as independence, so the edge is deleted and every orientation downstream ' +
        'of it changes.',
    );
  }
  if (tests > 0 && k >= 4) {
    warnings.push(
      `${tests} independence tests were performed at α = ${alpha} with no multiplicity correction, which is how ` +
        'the PC algorithm is defined. Expect of the order of ' +
        `${(tests * alpha).toFixed(1)} false rejections by chance alone; some edges are present or absent for ` +
        'that reason.',
    );
  }
  const isolated = data.variables.filter((_, a) => adj[a].size === 0);
  if (isolated.length > 0) {
    warnings.push(
      `${isolated.join(', ')} ended with no adjacencies at all. Either genuinely unrelated to everything else, ` +
        'or the test lacked the power to detect its relationships at this sample size.',
    );
  }
  return {
    variables: data.variables.slice(),
    directed,
    undirected,
    separationSets: [...sepset.entries()].map(([kk, S]) => {
      const [a, b] = kk.split('|').map(Number);
      return { a: data.variables[a], b: data.variables[b], given: S.map((s) => data.variables[s]) };
    }),
    testsPerformed: tests,
    alpha,
    colliders,
    assumptions: [PC_SUFFICIENCY, PC_FAITHFULNESS, PC_MARKOV, PC_EQUIVALENCE_ONLY],
    untestability:
      'Causal sufficiency and faithfulness cannot be tested from the data — they are what makes the test results ' +
      'interpretable as structure in the first place, so they cannot themselves be checked by more tests. The ' +
      'output is a Markov equivalence class, not a causal diagram, and it is not a licence to compute an effect ' +
      'from an orientation the search invented.',
    warnings,
    notes: [
      `${n} rows, ${k} variables, ${tests} conditional-independence tests, α = ${alpha}.`,
      `${colliders.length} unshielded collider(s) found; these are the only orientations the data genuinely ` +
        'support, and everything else is propagated from them by Meek\'s rules.',
      'An undirected edge means BOTH directions are consistent with the data. Reporting one of them as the ' +
        'answer would be the single most misleading thing this module could do.',
    ],
    directedPart: { nodes: data.variables.slice(), parents },
  };
}

export interface StabilityReport {
  /** One CPDAG per significance level. */
  runs: { alpha: number; nEdges: number; nDirected: number; nUndirected: number; cpdag: Cpdag }[];
  /** Adjacencies present at every level tested. */
  stableAdjacencies: { a: string; b: string }[];
  /** Adjacencies present at some levels and absent at others. */
  unstableAdjacencies: { a: string; b: string; presentAt: number[] }[];
  /** Edges whose ORIENTATION differs between levels. */
  orientationDisagreements: { a: string; b: string; orientations: { alpha: number; orientation: string }[] }[];
  changed: boolean;
  note: string;
  warnings: string[];
}

/**
 * Re-run PC across significance levels and report what changes.
 *
 * This is not an optional extra. The recovered graph is a function of α, and a
 * single graph presented without this is a claim of precision the method does
 * not have.
 */
export function structureStability(data: Dataset, alphas: readonly number[] = [0.01, 0.05, 0.1]): StabilityReport {
  if (alphas.length < 2) {
    throw new EngineError(
      'Structure stability needs at least two significance levels to compare; with one there is nothing to ' +
        'report and the fragility of the search would be hidden.',
      'options',
    );
  }
  const runs = alphas.map((alpha) => {
    const cpdag = pcAlgorithm(data, { alpha });
    return {
      alpha,
      nEdges: cpdag.directed.length + cpdag.undirected.length,
      nDirected: cpdag.directed.length,
      nUndirected: cpdag.undirected.length,
      cpdag,
    };
  });
  const pairKey = (a: string, b: string): string => (a < b ? `${a}—${b}` : `${b}—${a}`);
  const presence = new Map<string, number[]>();
  const orientation = new Map<string, { alpha: number; orientation: string }[]>();
  for (const run of runs) {
    for (const e of run.cpdag.directed) {
      const kk = pairKey(e.from, e.to);
      presence.set(kk, [...(presence.get(kk) ?? []), run.alpha]);
      orientation.set(kk, [...(orientation.get(kk) ?? []), { alpha: run.alpha, orientation: `${e.from} → ${e.to}` }]);
    }
    for (const e of run.cpdag.undirected) {
      const kk = pairKey(e.a, e.b);
      presence.set(kk, [...(presence.get(kk) ?? []), run.alpha]);
      orientation.set(kk, [...(orientation.get(kk) ?? []), { alpha: run.alpha, orientation: `${e.a} — ${e.b} (unoriented)` }]);
    }
  }
  const stable: StabilityReport['stableAdjacencies'] = [];
  const unstable: StabilityReport['unstableAdjacencies'] = [];
  for (const [kk, at] of presence) {
    const [a, b] = kk.split('—');
    if (at.length === alphas.length) stable.push({ a, b });
    else unstable.push({ a, b, presentAt: at });
  }
  const disagreements: StabilityReport['orientationDisagreements'] = [];
  for (const [kk, os] of orientation) {
    if (os.length < alphas.length) continue;
    const distinct = new Set(os.map((o) => o.orientation));
    if (distinct.size > 1) {
      const [a, b] = kk.split('—');
      disagreements.push({ a, b, orientations: os });
    }
  }
  const changed = unstable.length > 0 || disagreements.length > 0;
  const warnings: string[] = [];
  if (changed) {
    warnings.push(
      `THE RECOVERED GRAPH CHANGES WITH α. ${unstable.length} adjacency decision(s) and ` +
        `${disagreements.length} orientation(s) differ across the levels ${alphas.join(', ')}. The structure is ` +
        'not a finding; it is a finding conditional on a threshold that nothing in the data fixes. Only the ' +
        `${stable.length} adjacency/adjacencies present at every level are worth discussing, and even those rest ` +
        'on causal sufficiency and faithfulness.',
    );
  } else {
    warnings.push(
      `The adjacency structure is the same at every level tested (${alphas.join(', ')}). That is the best this ` +
        'method can offer, and it is still not evidence of the orientations: sufficiency and faithfulness remain ' +
        'untestable, and undirected edges remain genuinely undetermined.',
    );
  }
  return {
    runs,
    stableAdjacencies: stable,
    unstableAdjacencies: unstable,
    orientationDisagreements: disagreements,
    changed,
    note:
      'Varying the significance level is the cheapest honest check on a structure search. An edge that appears ' +
      'at α = 0.1 and vanishes at α = 0.01 is a borderline test result, not a causal relation.',
    warnings,
  };
}
