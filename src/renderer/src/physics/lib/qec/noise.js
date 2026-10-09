import { zeroPauli } from './pauli';

// Mulberry32 — fast, deterministic, reproducible PRNG.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_MODELS = [
  { id: 'depolarizing', label: 'Depolarizing', desc: 'E(ρ)=(1-p)ρ + p/3 (XρX+YρY+ZρZ)' },
  { id: 'bitflip', label: 'Bit-flip', desc: 'E(ρ)=(1-p)ρ + p XρX' },
  { id: 'phaseflip', label: 'Phase-flip', desc: 'E(ρ)=(1-p)ρ + p ZρZ' },
  { id: 'independent', label: 'Independent X/Z', desc: 'X and Z each applied with prob p' },
  { id: 'custom', label: 'Custom Pauli', desc: 'p_X, p_Y, p_Z (rest = no error)' },
];

// model: { type, p, pX, pY, pZ }. Returns a Pauli error on n qubits.
export function sampleDataError(n, model, rng) {
  const err = zeroPauli(n);
  for (let i = 0; i < n; i++) {
    if (model.type === 'bitflip') {
      if (rng() < model.p) err.x[i] = 1;
    } else if (model.type === 'phaseflip') {
      if (rng() < model.p) err.z[i] = 1;
    } else if (model.type === 'depolarizing') {
      if (rng() < model.p) {
        const r2 = rng();
        if (r2 < 1 / 3) err.x[i] = 1;
        else if (r2 < 2 / 3) { err.x[i] = 1; err.z[i] = 1; }
        else err.z[i] = 1;
      }
    } else if (model.type === 'independent') {
      if (rng() < model.p) err.x[i] = 1;
      if (rng() < model.p) err.z[i] = 1;
    } else if (model.type === 'custom') {
      const r = rng();
      if (r < model.pX) err.x[i] = 1;
      else if (r < model.pX + model.pY) { err.x[i] = 1; err.z[i] = 1; }
      else if (r < model.pX + model.pY + model.pZ) err.z[i] = 1;
    }
  }
  return err;
}

// Returns Uint8Array(numBits): which syndrome bits get flipped by measurement fault.
export function sampleMeasurementError(numBits, pMeas, rng) {
  const bits = new Uint8Array(numBits);
  if (pMeas <= 0) return bits;
  for (let i = 0; i < numBits; i++) if (rng() < pMeas) bits[i] = 1;
  return bits;
}

export function validateModel(model) {
  if (model.type === 'custom') {
    const sum = (model.pX || 0) + (model.pY || 0) + (model.pZ || 0);
    if (sum > 1 + 1e-12) return 'p_X + p_Y + p_Z must be ≤ 1';
  }
  const p = model.p ?? 0;
  if (p < 0 || p > 1) return 'p must be in [0,1]';
  return null;
}