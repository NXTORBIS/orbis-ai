export const SUBSHELL_ORDER = ['1s','2s','2p','3s','3p','4s','3d','4p','5s','4d','5p','6s','4f','5d','6p','7s','5f','6d','7p'];
export const SUBSHELL_CAPACITY = { s: 2, p: 6, d: 10, f: 14 };
export const ORBITAL_SHAPES = [
  { sub: 's', shape: 'Sphere', desc: 'Spherical, no nodal planes; present in every shell.', n: 1 },
  { sub: 'p', shape: 'Dumbbell', desc: 'Two lobes along an axis; three orientations (px, py, pz).', n: 3 },
  { sub: 'd', shape: 'Cloverleaf', desc: 'Four-lobed (most); one is doughnut + lobes. Five orbitals.', n: 5 },
  { sub: 'f', shape: 'Complex', desc: 'Seven complex orbitals; 14 electrons maximum.', n: 7 },
];
export const QUANTUM_NUMBERS = [
  { sym: 'n', name: 'Principal', values: '1, 2, 3, …', meaning: 'Shell / size / energy level' },
  { sym: 'ℓ', name: 'Azimuthal', values: '0 … n−1', meaning: 'Subshell shape (0=s,1=p,2=d,3=f)' },
  { sym: 'mℓ', name: 'Magnetic', values: '−ℓ … +ℓ', meaning: 'Orbital orientation in space' },
  { sym: 'mₛ', name: 'Spin', values: '+½, −½', meaning: 'Electron spin direction' },
];
export const PRINCIPLES = [
  { name: 'Aufbau', text: 'Electrons fill lower-energy subshells before higher ones (1s→2s→2p→3s→3p→4s→3d…).' },
  { name: 'Pauli Exclusion', text: 'No two electrons share all four quantum numbers; an orbital holds max 2 with opposite spins.' },
  { name: "Hund's Rule", text: 'Electrons occupy degenerate orbitals singly before pairing, with parallel spins.' },
];