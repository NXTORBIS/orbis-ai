import { pauliFromString, toVector, anticommutes } from './pauli';

// Stabilizer code definitions. Each code lists stabilizer generators and logical
// operators as Pauli strings; everything else (syndrome table, decoding, logical
// classification) is derived from these by the engine — never hand-fabricated.
//
// [[n,k,d]]: n physical, k logical, distance d, corrects t = floor((d-1)/2) arbitrary
// errors (for codes that correct arbitrary Pauli errors).

const RAW = {
  bitFlip3: {
    id: 'bitFlip3',
    name: '3-Qubit Bit-Flip',
    tag: '[[3,1,1]]',
    n: 3, k: 1, d: 1,
    corrects: 'X',
    description:
      'Repetition code protecting against bit-flip (X) errors. Stabilizers Z₁Z₂ and Z₂Z₃ identify the flipped qubit. Distance 1: a single Z is an undetectable logical error, so it only corrects X-type noise.',
    stabilizers: ['ZZI', 'IZZ'],
    logicalX: 'XXX',
    logicalZ: 'ZII',
    encoding: [
      { gate: 'CNOT', ctrl: 0, tgt: 1 },
      { gate: 'CNOT', ctrl: 0, tgt: 2 },
    ],
  },
  phaseFlip3: {
    id: 'phaseFlip3',
    name: '3-Qubit Phase-Flip',
    tag: '[[3,1,1]]',
    n: 3, k: 1, d: 1,
    corrects: 'Z',
    description:
      'Hadamard-conjugate of the bit-flip code. Protects against phase-flip (Z) errors using X-type stabilizers X₁X₂ and X₂X₃. Encodes |0_L⟩=|+++⟩, |1_L⟩=|---⟩.',
    stabilizers: ['XXI', 'IXX'],
    logicalX: 'XII',
    logicalZ: 'ZZZ',
    encoding: [
      { gate: 'CNOT', ctrl: 0, tgt: 1 },
      { gate: 'CNOT', ctrl: 0, tgt: 2 },
      { gate: 'H', q: 0 },
      { gate: 'H', q: 1 },
      { gate: 'H', q: 2 },
    ],
  },
  fiveQubit: {
    id: 'fiveQubit',
    name: '5-Qubit Perfect',
    tag: '[[5,1,3]]',
    n: 5, k: 1, d: 3,
    corrects: 'XYZ',
    description:
      'The unique [[5,1,3]] stabilizer code — the smallest code correcting any single-qubit error (t=1). Non-CSS; cyclic stabilizer generators XZZXI.',
    stabilizers: ['XZZXI', 'IXZZX', 'XIXZZ', 'ZXIXZ'],
    logicalX: 'XXXXX',
    logicalZ: 'ZZZZZ',
    encoding: [], // prepared via stabilizer eigenstate projection (Clifford); no compact gate list shown
    encodingNote: 'Prepared as the simultaneous +1 eigenstate of all stabilizers and logical Z (Clifford circuit; stabilizer-form preparation).',
  },
  steane: {
    id: 'steane',
    name: '7-Qubit Steane',
    tag: '[[7,1,3]]',
    n: 7, k: 1, d: 3,
    corrects: 'XYZ',
    description:
      'CSS code built from the [7,4,3] Hamming code. Corrects any single-qubit error (t=1). X- and Z-stabilizers share the Hamming parity-check structure.',
    stabilizers: ['XIXIXIX', 'IXXIXXI', 'IIIXXXX', 'ZIZIZIZ', 'IZZIZZI', 'IIIZZZZ'],
    logicalX: 'XXXXXXX',
    logicalZ: 'ZZZZZZZ',
    encoding: [],
    encodingNote: 'Prepared as the +1 eigenstate of all stabilizers and logical Z (CSS Clifford circuit from the Hamming generator matrix).',
  },
};

function buildCode(raw) {
  const stabilizerPaulis = raw.stabilizers.map(pauliFromString);
  const stabVectors = stabilizerPaulis.map(toVector);
  const logicalXPauli = pauliFromString(raw.logicalX);
  const logicalZPauli = pauliFromString(raw.logicalZ);
  // sanity: logicals commute with all stabilizers
  for (const s of stabilizerPaulis) {
    if (anticommutes(logicalXPauli, s) || anticommutes(logicalZPauli, s)) {
      throw new Error(`${raw.id}: logical does not commute with stabilizer (bad definition)`);
    }
  }
  // sanity: logical X and Z anticommute with each other
  if (!anticommutes(logicalXPauli, logicalZPauli)) {
    throw new Error(`${raw.id}: logical X and Z must anticommute`);
  }
  return {
    ...raw,
    t: Math.floor((raw.d - 1) / 2),
    stabilizerPaulis,
    stabVectors,
    logicalXPauli,
    logicalZPauli,
    numSyndromeBits: stabilizerPaulis.length,
  };
}

export const CODES = Object.fromEntries(
  Object.values(RAW).map((r) => [r.id, buildCode(r)])
);

export const CODE_LIST = Object.values(CODES);

export function getCode(id) {
  return CODES[id];
}