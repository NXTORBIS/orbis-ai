// Real quantum state-vector simulator: complex linear algebra over C^{2^n}.
// No AI, no fakery — every gate is a genuine unitary applied to the amplitudes.
// (state-vector engine: gates, controlled gates, phase oracles, permutations, measurement)

export class QState {
  constructor(n) { this.n = n; this.N = 2 ** n; this.re = new Float64Array(this.N); this.im = new Float64Array(this.N); this.re[0] = 1; }
  clone() { const s = new QState(this.n); s.re = this.re.slice(); s.im = this.im.slice(); return s; }
}

const s = 1 / Math.sqrt(2);
export const GATES = {
  I: [[[1, 0], [0, 0]], [[0, 0], [1, 0]]],
  X: [[[0, 0], [1, 0]], [[1, 0], [0, 0]]],
  Y: [[[0, 0], [0, -1]], [[0, 1], [0, 0]]],
  Z: [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]],
  H: [[[s, 0], [s, 0]], [[s, 0], [-s, 0]]],
  S: [[[1, 0], [0, 0]], [[0, 0], [0, 1]]],
  T: [[[1, 0], [0, 0]], [[0, 0], [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)]]],
};

export function applySingle(st, target, M) {
  const N = st.N, re = st.re, im = st.im, nre = new Float64Array(N), nim = new Float64Array(N);
  const bit = 1 << target;
  for (let i = 0; i < N; i++) {
    if (i & bit) { nre[i] = re[i]; nim[i] = im[i]; continue; }
    const i0 = i, i1 = i | bit, ar = re[i0], ai = im[i0], br = re[i1], bi = im[i1];
    const m00 = M[0][0], m01 = M[0][1], m10 = M[1][0], m11 = M[1][1];
    nre[i0] = m00[0] * ar - m00[1] * ai + m01[0] * br - m01[1] * bi;
    nim[i0] = m00[0] * ai + m00[1] * ar + m01[0] * bi + m01[1] * br;
    nre[i1] = m10[0] * ar - m10[1] * ai + m11[0] * br - m11[1] * bi;
    nim[i1] = m10[0] * ai + m10[1] * ar + m11[0] * bi + m11[1] * br;
  }
  st.re = nre; st.im = nim;
}
export function applyControlled(st, control, target, M) {
  const N = st.N, re = st.re, im = st.im, nre = new Float64Array(N), nim = new Float64Array(N);
  const cb = 1 << control, tb = 1 << target;
  for (let i = 0; i < N; i++) { nre[i] = re[i]; nim[i] = im[i]; }
  for (let i = 0; i < N; i++) {
    if ((i & cb) && !(i & tb)) {
      const i0 = i, i1 = i | tb, ar = re[i0], ai = im[i0], br = re[i1], bi = im[i1];
      const m00 = M[0][0], m01 = M[0][1], m10 = M[1][0], m11 = M[1][1];
      nre[i0] = m00[0] * ar - m00[1] * ai + m01[0] * br - m01[1] * bi;
      nim[i0] = m00[0] * ai + m00[1] * ar + m01[0] * bi + m01[1] * br;
      nre[i1] = m10[0] * ar - m10[1] * ai + m11[0] * br - m11[1] * bi;
      nim[i1] = m10[0] * ai + m10[1] * ar + m11[0] * bi + m11[1] * br;
    }
  }
  st.re = nre; st.im = nim;
}
export function applyControlledPhase(st, control, target, theta) {
  // R(θ) = diag(1, e^{iθ}) on target, controlled by control
  applyControlled(st, control, target, [[[1, 0], [0, 0]], [[0, 0], [Math.cos(theta), Math.sin(theta)]]]);
}
export function applySwap(st, q1, q2) {
  const b1 = 1 << q1, b2 = 1 << q2;
  for (let i = 0; i < st.N; i++) if ((i & b1) && !(i & b2)) { const j = i ^ b1 ^ b2; [st.re[i], st.re[j]] = [st.re[j], st.re[i]]; [st.im[i], st.im[j]] = [st.im[j], st.im[i]]; }
}
export function applyDiagonal(st, phaseFn) {
  for (let i = 0; i < st.N; i++) { const p = phaseFn(i); const nr = st.re[i] * p[0] - st.im[i] * p[1], ni = st.re[i] * p[1] + st.im[i] * p[0]; st.re[i] = nr; st.im[i] = ni; }
}
export function applyControlledPermutation(st, controls, workBits, perm) {
  const N = st.N, nre = new Float64Array(N), nim = new Float64Array(N);
  const cMask = controls.reduce((m, q) => m | (1 << q), 0);
  const wMask = workBits.reduce((m, q) => m | (1 << q), 0);
  for (let i = 0; i < N; i++) { nre[i] = st.re[i]; nim[i] = st.im[i]; }
  for (let i = 0; i < N; i++) if ((i & cMask) === cMask) { nre[i] = 0; nim[i] = 0; }
  for (let i = 0; i < N; i++) {
    if ((i & cMask) !== cMask) continue;
    let w = 0; for (let b = 0; b < workBits.length; b++) if (i & (1 << workBits[b])) w |= (1 << b);
    const w2 = perm[w];
    let j = i & ~wMask; for (let b = 0; b < workBits.length; b++) if (w2 & (1 << b)) j |= (1 << workBits[b]);
    nre[j] = st.re[i]; nim[j] = st.im[i];
  }
  st.re = nre; st.im = nim;
}
export function measureQubit(st, qubit, rng = Math.random) {
  const bit = 1 << qubit; let p1 = 0;
  for (let i = 0; i < st.N; i++) if (i & bit) p1 += st.re[i] ** 2 + st.im[i] ** 2;
  const result = rng() < p1 ? 1 : 0; let norm = 0;
  for (let i = 0; i < st.N; i++) { if (((i & bit) ? 1 : 0) === result) norm += st.re[i] ** 2 + st.im[i] ** 2; else { st.re[i] = 0; st.im[i] = 0; } }
  const inv = 1 / Math.sqrt(norm || 1); for (let i = 0; i < st.N; i++) { st.re[i] *= inv; st.im[i] *= inv; }
  return result;
}
export function probs(st) { const p = new Array(st.N); for (let i = 0; i < st.N; i++) p[i] = st.re[i] ** 2 + st.im[i] ** 2; return p; }

// Run a circuit. Instruction types:
//  {t:'g', gate:'H', target}                  single-qubit (from GATES)
//  {t:'c', gate:'X', control, target}          controlled gate (from GATES)
//  {t:'cp', control, target, theta}            controlled-phase R(θ)
//  {t:'swap', q1, q2}
//  {t:'diag', phase: (i)=>[re,im]}             diagonal unitary
//  {t:'cperm', controls:[], workBits:[], perm:[]}  controlled permutation
//  {t:'m', qubit}                              measurement (mutates state)
export function runCircuit(instructions, n, st) {
  if (!st) st = new QState(n);
  for (const ins of instructions) {
    if (ins.t === 'g') applySingle(st, ins.target, GATES[ins.gate]);
    else if (ins.t === 'c') applyControlled(st, ins.control, ins.target, GATES[ins.gate]);
    else if (ins.t === 'cp') applyControlledPhase(st, ins.control, ins.target, ins.theta);
    else if (ins.t === 'swap') applySwap(st, ins.q1, ins.q2);
    else if (ins.t === 'diag') applyDiagonal(st, ins.phase);
    else if (ins.t === 'cperm') applyControlledPermutation(st, ins.controls, ins.workBits, ins.perm);
    else if (ins.t === 'm') measureQubit(st, ins.qubit);
  }
  return st;
}

export function qftCircuit(n, qubits, inverse = false) {
  const ins = [];
  const order = inverse ? [...qubits].reverse() : qubits;
  for (let a = 0; a < n; a++) {
    const i = order[a];
    ins.push({ t: 'g', gate: 'H', target: i });
    for (let b = a + 1; b < n; b++) { const j = order[b]; ins.push({ t: 'cp', control: i, target: j, theta: (inverse ? -1 : 1) * Math.PI / 2 ** (b - a) }); }
  }
  if (!inverse) for (let k = 0; k < Math.floor(n / 2); k++) ins.push({ t: 'swap', q1: qubits[k], q2: qubits[n - 1 - k] });
  return ins;
}