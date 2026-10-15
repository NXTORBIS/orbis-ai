/**
 * Shared numerics for the research engines.
 *
 * A dense linear solver, a Jacobi eigensolver for symmetric matrices and bracketed root
 * finding — the three primitives the microkinetic, separation and network engines all need.
 * Kept in one place so each engine stays about its own science.
 */

export function maxAbs(values) {
  let worst = 0;
  values.forEach((value) => { worst = Math.max(worst, Math.abs(value)); });
  return worst;
}

/** Gaussian elimination with partial pivoting. Returns null when the matrix is singular. */
export function solveLinear(matrix, vector) {
  const size = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-300) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= size; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  const solution = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = a[row][size];
    for (let k = row + 1; k < size; k += 1) sum -= a[row][k] * solution[k];
    solution[row] = sum / a[row][row];
  }
  if (solution.some((value) => !Number.isFinite(value))) return null;
  return solution;
}

/**
 * Cyclic Jacobi eigensolver for a real symmetric matrix. Eigenvalues come back in
 * descending order with their vectors, which is exactly the order the network engine reads
 * a spectrum in.
 */
export function jacobiEigen(input, { sweeps = 100, tolerance = 1e-14 } = {}) {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    if (off < tolerance) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({ value: a[i][i], vector: v.map((row) => row[i]) }));
  pairs.sort((x, y) => y.value - x.value);
  return { values: pairs.map((pair) => pair.value), vectors: pairs.map((pair) => pair.vector) };
}

/** Bisection on a sign change — slow but monotone-safe, and honest when it cannot converge. */
export function bisect(f, lo, hi, { tolerance = 1e-11, iterations = 240 } = {}) {
  let a = lo;
  let b = hi;
  let fa = f(a);
  const fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;
  let mid = (a + b) / 2;
  for (let count = 0; count < iterations; count += 1) {
    mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0 || Math.abs(b - a) < tolerance) return mid;
    if (fa * fm < 0) { b = mid; } else { a = mid; fa = fm; }
  }
  return mid;
}

/** Widens an interval around a guess until the function changes sign. */
export function bracket(f, guess, { span = 5, widen = 1.7, attempts = 70, lower = -1e5, upper = 1e5 } = {}) {
  let width = span;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lo = Math.max(lower, guess - width);
    const hi = Math.min(upper, guess + width);
    const flo = f(lo);
    const fhi = f(hi);
    if (Number.isFinite(flo) && Number.isFinite(fhi) && flo * fhi <= 0) return [lo, hi];
    if (lo <= lower && hi >= upper) return null;
    width *= widen;
  }
  return null;
}

/** Root of a monotone function: widen around a guess, then bisect. */
export function solveMonotone(f, guess, options) {
  const interval = bracket(f, guess, options);
  if (!interval) return null;
  return bisect(f, interval[0], interval[1], options);
}