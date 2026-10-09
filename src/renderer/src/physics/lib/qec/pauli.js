// Binary symplectic Pauli algebra (phase ignored) over GF(2).
// A Pauli on n qubits = { x: Uint8Array(n), z: Uint8Array(n) }.
// I=(0,0) X=(1,0) Z=(0,1) Y=(1,1).  Phase (±1,±i) is irrelevant for
// stabilizer membership / commutation / logical classification, so we omit it.

export function zeroPauli(n) {
  return { x: new Uint8Array(n), z: new Uint8Array(n) };
}

export function clonePauli(p) {
  return { x: new Uint8Array(p.x), z: new Uint8Array(p.z) };
}

export function pauliFromString(str) {
  const n = str.length;
  const p = zeroPauli(n);
  for (let i = 0; i < n; i++) {
    const c = str[i];
    if (c === 'X' || c === 'Y') p.x[i] = 1;
    if (c === 'Z' || c === 'Y') p.z[i] = 1;
  }
  return p;
}

export function pauliToString(p) {
  let s = '';
  for (let i = 0; i < p.x.length; i++) {
    const x = p.x[i], z = p.z[i];
    s += x ? (z ? 'Y' : 'X') : (z ? 'Z' : 'I');
  }
  return s;
}

export function pauliWeight(p) {
  let w = 0;
  for (let i = 0; i < p.x.length; i++) if (p.x[i] || p.z[i]) w++;
  return w;
}

// Symplectic inner product: 1 if a,b anticommute, 0 if commute.
export function anticommutes(a, b) {
  let s = 0;
  const n = a.x.length;
  for (let i = 0; i < n; i++) {
    s += a.x[i] & b.z[i];
    s += a.z[i] & b.x[i];
  }
  return s & 1;
}

// Multiply a·b mod phase (XOR of binary vectors).
export function pauliMul(a, b) {
  const n = a.x.length;
  const r = zeroPauli(n);
  for (let i = 0; i < n; i++) {
    r.x[i] = a.x[i] ^ b.x[i];
    r.z[i] = a.z[i] ^ b.z[i];
  }
  return r;
}

export function pauliEqual(a, b) {
  for (let i = 0; i < a.x.length; i++) if (a.x[i] !== b.x[i] || a.z[i] !== b.z[i]) return false;
  return true;
}

// Convert Pauli to a flat binary vector [x | z] of length 2n.
export function toVector(p) {
  const n = p.x.length;
  const v = new Uint8Array(2 * n);
  for (let i = 0; i < n; i++) {
    v[i] = p.x[i];
    v[n + i] = p.z[i];
  }
  return v;
}

export function fromVector(v, n) {
  const p = zeroPauli(n);
  for (let i = 0; i < n; i++) {
    p.x[i] = v[i];
    p.z[i] = v[n + i];
  }
  return p;
}

// GF(2): is `target` in the row span of `generatorRows`?
export function inSpan(generatorRows, target) {
  const L = target.length;
  const M = generatorRows.map((r) => Array.from(r));
  const rows = M.length;
  const pivotCols = [];
  let pr = 0;
  for (let c = 0; c < L && pr < rows; c++) {
    let piv = -1;
    for (let r = pr; r < rows; r++) if (M[r][c]) { piv = r; break; }
    if (piv === -1) continue;
    const tmp = M[pr]; M[pr] = M[piv]; M[piv] = tmp;
    for (let r = 0; r < rows; r++) {
      if (r !== pr && M[r][c]) for (let cc = 0; cc < L; cc++) M[r][cc] ^= M[pr][cc];
    }
    pivotCols.push(c);
    pr++;
  }
  const t = Array.from(target);
  for (let i = 0; i < pivotCols.length; i++) {
    const c = pivotCols[i];
    if (t[c]) for (let cc = 0; cc < L; cc++) t[cc] ^= M[i][cc];
  }
  for (let cc = 0; cc < L; cc++) if (t[cc]) return false;
  return true;
}