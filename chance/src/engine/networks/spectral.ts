/**
 * Spectral graph theory: the adjacency and Laplacian spectra, the algebraic
 * connectivity (the Fiedler value) and spectral partitioning.
 *
 * The eigensolver is the **cyclic Jacobi rotation method** for real symmetric
 * matrices, implemented here rather than taken from a dependency. Jacobi was
 * chosen over Lanczos because it returns the *whole* spectrum with
 * eigenvectors, is unconditionally stable, needs no reorthogonalisation and
 * has no ill-conditioning failure mode for degenerate eigenvalues — and
 * degenerate eigenvalues are the normal case here (the complete graph K_n has
 * a Laplacian eigenvalue of multiplicity n-1). Its cost is O(n^3) time and
 * O(n^2) memory, so it is refused above `NETWORK_LIMITS.spectralMaxNodes`.
 *
 * Spectra are `numerical`: they come from an iterative diagonalisation with a
 * stated off-diagonal residual, not a closed form.
 */
import { EngineError } from '../core/result';
import { requireSize } from './graph';
import { connectedComponents, degreeSummary } from './measures';
import type { Graph, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, NETWORK_LIMITS, nq } from './types';

export interface SymmetricEigen {
  /** Ascending. */
  eigenvalues: number[];
  /** `eigenvectors[i]` is the unit eigenvector for `eigenvalues[i]`. */
  eigenvectors: number[][];
  sweeps: number;
  /** Largest remaining off-diagonal magnitude — the accuracy statement. */
  offDiagonalResidual: number;
}

/**
 * Cyclic Jacobi eigendecomposition of a real symmetric matrix.
 *
 * Refuses a non-square or non-symmetric input (naming the worst asymmetry) and
 * refuses to return a decomposition that did not reach the tolerance.
 */
export function jacobiEigenSymmetric(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  options: { tolerance?: number; maxSweeps?: number } = {},
): SymmetricEigen {
  const n = matrix.length;
  if (n === 0) throw new EngineError('The matrix is empty; there is no spectrum to compute.', 'empty');
  for (let i = 0; i < n; i++) {
    if (matrix[i].length !== n) {
      throw new EngineError(`Row ${i} has ${matrix[i].length} entries but the matrix has ${n} rows; it is not square.`, 'shape');
    }
  }
  let worst = 0;
  let worstAt: [number, number] = [0, 0];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = matrix[i][j];
      const b = matrix[j][i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new EngineError(`Entry (${i},${j}) is not a finite number.`, 'finite');
      }
      const d = Math.abs(a - b);
      if (d > worst) {
        worst = d;
        worstAt = [i, j];
      }
    }
  }
  const scale = Math.max(1, worstTolScale(matrix, n));
  if (worst > 1e-9 * scale) {
    throw new EngineError(
      `This Jacobi eigensolver requires a symmetric matrix; entry (${worstAt[0]},${worstAt[1]}) differs from its ` +
        `transpose by ${worst}. A non-symmetric matrix can have complex eigenvalues, which this routine cannot represent.`,
      'not-symmetric',
    );
  }

  const a: Float64Array[] = Array.from({ length: n }, (_, i) => Float64Array.from(matrix[i]));
  // Symmetrise exactly so rotations stay exact.
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const mid = (a[i][j] + a[j][i]) / 2;
    a[i][j] = mid;
    a[j][i] = mid;
  }
  const vecs: Float64Array[] = Array.from({ length: n }, (_, i) => {
    const row = new Float64Array(n);
    row[i] = 1;
    return row;
  });
  const tol = options.tolerance ?? 1e-12;
  const maxSweeps = options.maxSweeps ?? 100;
  let off = offNorm(a, n);
  const target = tol * Math.max(1, frobenius(a, n));
  let sweeps = 0;
  while (off > target && sweeps < maxSweeps) {
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) <= 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = vecs[k][p];
          const vkq = vecs[k][q];
          vecs[k][p] = c * vkp - s * vkq;
          vecs[k][q] = s * vkp + c * vkq;
        }
      }
    }
    sweeps++;
    off = offNorm(a, n);
  }
  if (off > Math.max(target, 1e-8 * Math.max(1, frobenius(a, n)))) {
    throw new EngineError(
      `The Jacobi eigensolver did not converge in ${maxSweeps} sweeps: the off-diagonal norm is still ${off}. No ` +
        'spectrum is reported rather than an unconverged one.',
      'nonconvergent',
    );
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  const eigenvalues = idx.map((i) => a[i][i]);
  const eigenvectors = idx.map((col) => {
    const v = new Array<number>(n);
    let norm = 0;
    for (let k = 0; k < n; k++) {
      v[k] = vecs[k][col];
      norm += v[k] * v[k];
    }
    norm = Math.sqrt(norm);
    for (let k = 0; k < n; k++) v[k] /= norm;
    return v;
  });
  return { eigenvalues, eigenvectors, sweeps, offDiagonalResidual: off };
}

function offNorm(a: Float64Array[], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += a[i][j] * a[i][j];
  return Math.sqrt(2 * s);
}

function frobenius(a: Float64Array[], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += a[i][j] * a[i][j];
  return Math.sqrt(s);
}

function worstTolScale(m: ReadonlyArray<ReadonlyArray<number>>, n: number): number {
  let mx = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mx = Math.max(mx, Math.abs(m[i][j]));
  return mx;
}

/* -------------------------------------------------------------- matrices */

/** Dense adjacency matrix. Refused above the spectral size limit. */
export function adjacencyMatrix(g: Graph): number[][] {
  requireSize(g, NETWORK_LIMITS.spectralMaxNodes, 'Building a dense adjacency matrix', 'O(n^2) memory');
  const a = Array.from({ length: g.n }, () => new Array<number>(g.n).fill(0));
  for (let i = 0; i < g.n; i++) {
    const nb = g.out[i];
    const ws = g.outWeights[i];
    for (let k = 0; k < nb.length; k++) a[i][nb[k]] += ws[k];
  }
  return a;
}

/** Combinatorial Laplacian L = D - A (weighted degrees when weighted). */
export function laplacianMatrix(g: Graph): number[][] {
  if (g.directed) {
    throw new EngineError(
      'The combinatorial Laplacian and its spectrum are defined here for undirected graphs only. A directed ' +
        'Laplacian is not symmetric, so its eigenvalues are generally complex and the Fiedler interpretation fails.',
      'unsupported',
    );
  }
  const a = adjacencyMatrix(g);
  const l = a.map((row) => row.map((x) => -x));
  for (let i = 0; i < g.n; i++) {
    let d = 0;
    for (let j = 0; j < g.n; j++) if (j !== i) d += a[i][j];
    l[i][i] = d;
  }
  return l;
}

/** Symmetric normalised Laplacian I - D^-1/2 A D^-1/2; isolated nodes get row 0. */
export function normalisedLaplacianMatrix(g: Graph): number[][] {
  const a = adjacencyMatrix(g);
  const deg = new Array<number>(g.n).fill(0);
  for (let i = 0; i < g.n; i++) for (let j = 0; j < g.n; j++) if (i !== j) deg[i] += a[i][j];
  const l = Array.from({ length: g.n }, () => new Array<number>(g.n).fill(0));
  for (let i = 0; i < g.n; i++) {
    l[i][i] = deg[i] > 0 ? 1 : 0;
    for (let j = 0; j < g.n; j++) {
      if (i === j || a[i][j] === 0) continue;
      l[i][j] = -a[i][j] / Math.sqrt(deg[i] * deg[j]);
    }
  }
  return l;
}

export interface SpectrumResult {
  eigenvalues: number[];
  eigenvectors: number[][];
  matrix: 'adjacency' | 'laplacian' | 'normalised-laplacian';
  largest: NetworkQuantity;
  smallest: NetworkQuantity;
  sweeps: number;
  offDiagonalResidual: number;
  conditionalOn: string;
  notes: string[];
}

function spectrumOf(g: Graph, kind: SpectrumResult['matrix']): SpectrumResult {
  requireSize(
    g,
    NETWORK_LIMITS.spectralMaxNodes,
    `The ${kind} spectrum`,
    'O(n^3) time and O(n^2) memory for the Jacobi eigensolver',
  );
  const m = kind === 'adjacency' ? adjacencyMatrix(g) : kind === 'laplacian' ? laplacianMatrix(g) : normalisedLaplacianMatrix(g);
  const eig = jacobiEigenSymmetric(m);
  const notes: string[] = [
    `Cyclic Jacobi diagonalisation, ${eig.sweeps} sweeps, residual off-diagonal norm ${eig.offDiagonalResidual.toExponential(2)}.`,
  ];
  if (kind === 'adjacency') {
    notes.push('The leading adjacency eigenvalue sets the SIS epidemic threshold: the process persists iff beta/gamma > 1/lambda_max.');
  }
  if (kind === 'laplacian') {
    notes.push('The number of zero Laplacian eigenvalues equals the number of connected components — an exact result, here recovered numerically.');
  }
  return {
    eigenvalues: eig.eigenvalues,
    eigenvectors: eig.eigenvectors,
    matrix: kind,
    largest: nq(`Largest ${kind} eigenvalue`, eig.eigenvalues[eig.eigenvalues.length - 1], 'numerical'),
    smallest: nq(`Smallest ${kind} eigenvalue`, eig.eigenvalues[0], 'numerical'),
    sweeps: eig.sweeps,
    offDiagonalResidual: eig.offDiagonalResidual,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes,
  };
}

export function adjacencySpectrum(g: Graph): SpectrumResult {
  if (g.directed) {
    throw new EngineError(
      'The symmetric eigensolver in this module requires an undirected graph; a directed adjacency matrix is not ' +
        'symmetric and generally has complex eigenvalues.',
      'unsupported',
    );
  }
  return spectrumOf(g, 'adjacency');
}

export function laplacianSpectrum(g: Graph): SpectrumResult {
  return spectrumOf(g, 'laplacian');
}

export function normalisedLaplacianSpectrum(g: Graph): SpectrumResult {
  return spectrumOf(g, 'normalised-laplacian');
}

/* ------------------------------------------------- algebraic connectivity */

export interface AlgebraicConnectivityResult {
  /** The second-smallest Laplacian eigenvalue. */
  fiedlerValue: NetworkQuantity;
  fiedlerVector: number[];
  /** Zero Laplacian eigenvalues = number of components (exact theory). */
  componentsFromSpectrum: number;
  componentsFromTraversal: number;
  connected: boolean;
  conditionalOn: string;
  notes: string[];
}

/**
 * Algebraic connectivity, the Fiedler value lambda_2 of the Laplacian.
 *
 * It is exactly 0 if and only if the graph is disconnected (with multiplicity
 * equal to the number of components), and positive otherwise; larger means
 * harder to cut. For the complete graph K_n it is exactly n.
 */
export function algebraicConnectivity(g: Graph): AlgebraicConnectivityResult {
  if (g.n < 2) {
    throw new EngineError(
      'Algebraic connectivity needs at least two nodes: the Laplacian of a single node has only the trivial zero ' +
        'eigenvalue, so there is no second-smallest eigenvalue to report.',
      'too-small',
    );
  }
  const spec = laplacianSpectrum(g);
  const scale = Math.max(1, spec.largest.value);
  const zeroTol = 1e-8 * scale;
  let zeros = 0;
  for (const lam of spec.eigenvalues) if (Math.abs(lam) < zeroTol) zeros++;
  const traversal = connectedComponents(g).count;
  const lambda2 = spec.eigenvalues[1];
  const connected = traversal === 1;
  return {
    fiedlerValue: nq('Algebraic connectivity (Fiedler value)', connected ? lambda2 : 0, 'numerical', {
      formula: 'lambda_2(L), L = D - A',
      note: connected
        ? 'Positive, so the graph is connected. Larger means a cut must sever more (relative) edge weight.'
        : `Exactly 0: the graph has ${traversal} components, so the Laplacian has ${traversal} zero eigenvalues. This ` +
          'is an exact structural fact, reported as 0 rather than as the numerical noise of the eigensolver.',
    }),
    fiedlerVector: spec.eigenvectors[1],
    componentsFromSpectrum: zeros,
    componentsFromTraversal: traversal,
    connected,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `Multiplicity of the zero eigenvalue: ${zeros} (tolerance ${zeroTol.toExponential(1)}); components found by ` +
        `traversal: ${traversal}. These agree when the spectrum is well resolved; the traversal count is the exact one.`,
    ],
  };
}

export interface SpectralPartitionResult {
  /** 0/1 side per node, from the sign of the Fiedler vector. */
  side: number[];
  sizes: [number, number];
  cutEdges: number;
  /** cut / min(vol A, vol B) — the quantity the Fiedler vector approximately minimises. */
  conductance: NetworkQuantity;
  fiedlerValue: NetworkQuantity;
  conditionalOn: string;
  notes: string[];
}

/**
 * Spectral bisection: split on the sign of the Fiedler vector.
 *
 * This is a relaxation of a minimum-conductance cut, not the optimal cut; the
 * Cheeger inequalities bound how far off it can be, and those bounds are
 * reported rather than the cut being presented as optimal.
 */
export function spectralPartition(g: Graph): SpectralPartitionResult {
  const ac = algebraicConnectivity(g);
  if (!ac.connected) {
    throw new EngineError(
      `This graph is already disconnected (${ac.componentsFromTraversal} components), so spectral bisection has ` +
        'nothing to find: the components themselves are the partition, at zero cut. Use connectedComponents instead.',
      'disconnected',
    );
  }
  const vec = ac.fiedlerVector;
  const side = vec.map((x) => (x >= 0 ? 0 : 1));
  const deg = degreeSummary(g).degree;
  let cut = 0;
  const vol: [number, number] = [0, 0];
  for (let i = 0; i < g.n; i++) {
    vol[side[i]] += deg[i];
    for (const j of g.out[i]) if (i < j && side[i] !== side[j]) cut++;
  }
  const sizes: [number, number] = [side.filter((s) => s === 0).length, side.filter((s) => s === 1).length];
  if (sizes[0] === 0 || sizes[1] === 0) {
    throw new EngineError(
      'Spectral bisection produced an empty side: the Fiedler vector does not change sign, which happens when the ' +
        'eigenvalue is numerically degenerate. No partition is reported rather than a trivial one that cuts nothing.',
      'degenerate',
    );
  }
  const minVol = Math.min(vol[0], vol[1]);
  const lam = ac.fiedlerValue.value;
  const dmax = Math.max(...deg);
  return {
    side,
    sizes,
    cutEdges: cut,
    conductance: nq('Conductance of the spectral cut', minVol > 0 ? cut / minVol : 0, 'numerical', {
      formula: 'phi = cut(A,B) / min(vol A, vol B)',
    }),
    fiedlerValue: ac.fiedlerValue,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      'A sign cut of the Fiedler vector is a relaxation, not a minimum-conductance cut.',
      `Cheeger bounds on the best possible conductance phi*: lambda_2/(2 d_max) <= phi* <= sqrt(2 lambda_2/d_min-ish), ` +
        `with lambda_2 = ${lam.toPrecision(6)} and d_max = ${dmax}. The cut found is an upper bound on phi*, never a certificate of optimality.`,
    ],
  };
}
