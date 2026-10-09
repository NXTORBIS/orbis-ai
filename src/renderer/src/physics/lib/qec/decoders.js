import { zeroPauli, anticommutes, pauliWeight, pauliToString } from './pauli';

// Enumerate every Pauli operator on n qubits with weight <= maxWeight.
export function* enumerateErrors(n, maxWeight) {
  yield zeroPauli(n);
  for (let w = 1; w <= maxWeight; w++) {
    const idx = Array.from({ length: w }, (_, i) => i);
    while (true) {
      const total = 3 ** w;
      for (let c = 0; c < total; c++) {
        const p = zeroPauli(n);
        let cc = c;
        for (let j = 0; j < w; j++) {
          const pos = idx[j];
          const m = cc % 3; cc = Math.floor(cc / 3);
          if (m === 0) p.x[pos] = 1;
          else if (m === 1) { p.x[pos] = 1; p.z[pos] = 1; }
          else p.z[pos] = 1;
        }
        yield p;
      }
      let i = w - 1;
      while (i >= 0 && idx[i] === n - w + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < w; j++) idx[j] = idx[j - 1] + 1;
    }
  }
}

// Syndrome of an error: bit i = 1 if error anticommutes with stabilizer i.
export function syndromeOf(error, stabilizerPaulis) {
  const s = new Uint8Array(stabilizerPaulis.length);
  for (let i = 0; i < stabilizerPaulis.length; i++) s[i] = anticommutes(error, stabilizerPaulis[i]);
  return s;
}

export function syndromeToKey(s) {
  return Array.from(s).join('');
}

// Build a lookup table mapping each syndrome (binary key) to the minimum-weight
// Pauli correction that produces it. Enumerate errors up to `maxWeight`; for each
// syndrome keep the lowest-weight error found. Generated from the code, not typed.
export function buildLookupTable(code, maxWeight) {
  const table = new Map();
  for (const E of enumerateErrors(code.n, maxWeight)) {
    const s = syndromeOf(E, code.stabilizerPaulis);
    const key = syndromeToKey(s);
    const w = pauliWeight(E);
    const ex = table.get(key);
    if (!ex || w < ex.weight) table.set(key, { correction: E, weight: w, pauli: pauliToString(E) });
  }
  return table;
}

export const DECODERS = [
  { id: 'lookup', label: 'Lookup table', desc: 'Syndrome → precomputed minimum-weight correction.' },
  { id: 'minweight', label: 'Minimum-weight', desc: 'Choose the lowest-weight error matching the syndrome.' },
];

// For these small codes the lookup table IS the minimum-weight decoder (both pick
// the lowest-weight correction per syndrome). We expose both names; they share the
// table. Additional decoders can be added here without touching the engine.
export function getDecoder(code, decoderId) {
  // maxWeight = t+1 guarantees every syndrome gets an entry for distance-3 codes.
  const maxWeight = Math.max(code.t + 1, 2);
  return buildLookupTable(code, maxWeight);
}