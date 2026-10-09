import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { GATES } from '../quantum/gates.ts'
import { NOISE_NAMES } from '../quantum/noise.ts'
import { MAX_QUBITS } from '../quantum/state.ts'

/**
 * Phase 12: the Quantum Studio.
 *
 * ## One studio, because a quantum experiment is one bench
 *
 * Circuit, state, Bloch sphere, histogram, noise and algorithms are not six laboratories — they are six views of
 * the same experiment, and separating them would mean the state on one screen could disagree with the picture on
 * another. One app, one state, every view reading it.
 *
 * ## Every number it shows is computed
 *
 * The engine is `src/shared/quantum`, which is pure and tested: 94 tests covering unitarity of every gate, the
 * identities the course teaches, the algorithms against their known answers, and the noise channels against
 * their expected statistics. Nothing in this studio prints a textbook figure. If the engine were wrong the
 * studio would be visibly wrong, which is the only arrangement worth having.
 *
 * ## It refuses rather than freezing
 *
 * A state vector doubles with every qubit. The limit is stated in the parameter itself and the engine refuses
 * beyond it with a reason and a size — because a simulator that accepts thirty qubits and then exhausts memory
 * has taught the learner nothing except that the application cannot be trusted.
 */

const ACTIONS: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Run the circuit exactly and show the resulting state', takes: [], idempotent: true, destructive: false },
  { id: 'step', summary: 'Advance one operation and show the state at that point', takes: [], idempotent: false, destructive: false },
  { id: 'sample', summary: 'Draw measurement shots from the final state', takes: [], idempotent: false, destructive: false },
  { id: 'reset', summary: 'Clear the circuit and return every qubit to |0⟩', takes: [], idempotent: true, destructive: false },
  { id: 'inverse', summary: 'Append the inverse of the circuit, which should return it to the start', takes: [], idempotent: false, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

const STUDIO: readonly Declared[] = [
  {
    id: 'section',
    name: 'Section',
    kind: 'choice',
    initial: 'circuit',
    about: 'Which bench to open: build a circuit, inspect the state, look at the Bloch sphere, run an algorithm, add noise, or try error correction.',
    options: [
      { id: 'circuit', label: 'Circuit designer' },
      { id: 'state', label: 'State inspector' },
      { id: 'bloch', label: 'Bloch sphere' },
      { id: 'measure', label: 'Measurement' },
      { id: 'algorithms', label: 'Algorithms' },
      { id: 'noise', label: 'Noise' },
      { id: 'correction', label: 'Error correction' }
    ],
    group: 'What to open'
  },
  {
    id: 'qubits',
    name: 'Qubits',
    kind: 'number',
    initial: 2,
    least: 1,
    most: MAX_QUBITS,
    step: 1,
    about: `How many qubits. Each one doubles the state vector, so ${MAX_QUBITS} is the honest limit here — beyond it the simulator refuses with a size rather than freezing.`,
    group: 'The register'
  },
  {
    id: 'preset',
    name: 'Start from',
    kind: 'choice',
    initial: '',
    about: 'A circuit to begin with, rather than an empty one.',
    options: [
      { id: '', label: 'Empty' },
      { id: 'bell', label: 'Bell state — H then CNOT' },
      { id: 'ghz', label: 'GHZ state — three qubits entangled' },
      { id: 'superposition', label: 'Hadamard on every qubit' },
      { id: 'teleport', label: 'Teleportation' },
      { id: 'superdense', label: 'Superdense coding' },
      { id: 'qft', label: 'Fourier transform' },
      { id: 'grover', label: 'Grover search' },
      { id: 'phase', label: 'Phase estimation' },
      { id: 'deutsch', label: 'Deutsch' },
      { id: 'bernstein', label: 'Bernstein-Vazirani' }
    ],
    group: 'The register'
  },
  {
    id: 'gate',
    name: 'Gate to add',
    kind: 'choice',
    initial: '',
    about: 'Append a gate to the circuit. The target, controls and angle are the parameters below.',
    options: [{ id: '', label: 'None' }, ...GATES.map((one) => ({ id: one.id, label: `${one.name} — ${one.does.slice(0, 60)}` }))],
    group: 'Build'
  },
  { id: 'target', name: 'Target qubit', kind: 'number', initial: 0, least: 0, most: MAX_QUBITS - 1, step: 1, about: 'Which qubit the gate acts on.', group: 'Build' },
  { id: 'control', name: 'Control qubit', kind: 'number', initial: -1, least: -1, most: MAX_QUBITS - 1, step: 1, about: 'For a controlled gate. −1 means no control.', group: 'Build' },
  {
    id: 'angle',
    name: 'Angle',
    kind: 'number',
    initial: 0,
    least: -6.2832,
    most: 6.2832,
    step: 0.0628,
    unit: 'rad',
    about: 'For a rotation or a phase gate. In radians: π/2 is 1.571, π is 3.142.',
    group: 'Build'
  },
  {
    id: 'shots',
    name: 'Shots',
    kind: 'number',
    initial: 1000,
    least: 1,
    most: 100000,
    step: 1,
    about: 'How many times to run and measure. A small number will not match the exact probabilities, which is the point of having the setting.',
    group: 'Measurement'
  },
  {
    id: 'seed',
    name: 'Seed',
    kind: 'number',
    initial: 0,
    least: 0,
    most: 1000000,
    step: 1,
    about: 'Fix the pseudorandomness so a run can be repeated exactly. 0 means unseeded. This is a simulator, so the randomness is pseudorandom — which is not the same thing as the randomness of a real measurement.',
    group: 'Measurement'
  },
  {
    id: 'basis',
    name: 'Measurement basis',
    kind: 'choice',
    initial: 'z',
    about: 'Which basis to measure in. Changing it is done with gates before the measurement, and the studio shows which.',
    options: [
      { id: 'z', label: 'Computational (Z)' },
      { id: 'x', label: 'X — a Hadamard first' },
      { id: 'y', label: 'Y — S† then a Hadamard' }
    ],
    group: 'Measurement'
  },
  {
    id: 'noise',
    name: 'Noise channel',
    kind: 'choice',
    initial: '',
    about: 'Apply a noise channel after every gate. A noisy result is an average over many runs and the studio labels it as one.',
    options: [{ id: '', label: 'None — ideal simulation' }, ...Object.entries(NOISE_NAMES).map(([id, label]) => ({ id, label }))],
    group: 'Noise'
  },
  {
    id: 'errorRate',
    name: 'Error rate',
    kind: 'number',
    initial: 0.01,
    least: 0,
    most: 0.5,
    step: 0.005,
    about: 'The probability of an error per gate. Real hardware is around 0.001 for one-qubit gates and ten times worse for two-qubit ones.',
    group: 'Noise'
  },
  {
    id: 'algorithm',
    name: 'Algorithm',
    kind: 'choice',
    initial: '',
    about: 'Run one of the algorithms, built from gates and with its answer computed rather than quoted.',
    options: [
      { id: '', label: 'None' },
      { id: 'deutsch', label: 'Deutsch — one query for a one-bit function' },
      { id: 'deutsch-jozsa', label: 'Deutsch-Jozsa — constant or balanced' },
      { id: 'bernstein-vazirani', label: 'Bernstein-Vazirani — recover a hidden string' },
      { id: 'grover', label: 'Grover — search, with the whole success curve' },
      { id: 'qft', label: 'Fourier transform' },
      { id: 'phase-estimation', label: 'Phase estimation' },
      { id: 'shor', label: "Shor — factor a small number" },
      { id: 'teleport', label: 'Teleportation' },
      { id: 'superdense', label: 'Superdense coding' }
    ],
    group: 'Algorithms'
  },
  {
    id: 'marked',
    name: 'Marked state',
    kind: 'text',
    initial: '101',
    about: 'For Grover: the bit string to search for. Its length sets the number of qubits.',
    group: 'Algorithms'
  },
  {
    id: 'iterations',
    name: 'Grover iterations',
    kind: 'number',
    initial: 0,
    least: 0,
    most: 40,
    step: 1,
    about: 'How many times to amplify. 0 uses the count theory suggests. More is not better — past the peak the amplitude rotates away again, which the curve shows.',
    group: 'Algorithms'
  },
  {
    id: 'secret',
    name: 'Hidden string',
    kind: 'text',
    initial: '1011',
    about: 'For Bernstein-Vazirani: the string the oracle hides, recovered in one query.',
    group: 'Algorithms'
  },
  {
    id: 'number',
    name: 'Number to factor',
    kind: 'number',
    initial: 15,
    least: 3,
    most: 143,
    step: 2,
    about: 'For Shor. Small, because this is an educational construction — the gap between these numbers and cryptographic ones is a lesson in its own right.',
    group: 'Algorithms'
  },
  {
    id: 'phase',
    name: 'Phase to estimate',
    kind: 'number',
    initial: 0.25,
    least: 0,
    most: 0.999,
    step: 0.001,
    about: 'For phase estimation: the phase the circuit is given, as a fraction of 2π, so the estimate can be compared with the truth.',
    group: 'Algorithms'
  },
  {
    id: 'countingQubits',
    name: 'Counting qubits',
    kind: 'number',
    initial: 4,
    least: 1,
    most: 10,
    step: 1,
    about: 'How many qubits read the phase. Each one halves the smallest difference the register can resolve.',
    group: 'Algorithms'
  },
  {
    id: 'code',
    name: 'Error-correcting code',
    kind: 'choice',
    initial: 'bit-flip',
    about: 'Which code to run. Each protects against one kind of error and is blind to the other, which the studio demonstrates rather than asserting.',
    options: [
      { id: 'bit-flip', label: 'Three-qubit bit-flip code' },
      { id: 'phase-flip', label: 'Three-qubit phase-flip code' }
    ],
    group: 'Error correction'
  },
  {
    id: 'injectedError',
    name: 'Error to inject',
    kind: 'choice',
    initial: 'x',
    about: 'The error to put in deliberately, so the syndrome and the correction can be watched.',
    options: [
      { id: 'none', label: 'None' },
      { id: 'x', label: 'X — a bit flip' },
      { id: 'z', label: 'Z — a phase flip' },
      { id: 'y', label: 'Y — both at once' }
    ],
    group: 'Error correction'
  },
  {
    id: 'errorQubit',
    name: 'Error on qubit',
    kind: 'number',
    initial: 0,
    least: 0,
    most: 2,
    step: 1,
    about: 'Which of the three physical qubits the error lands on.',
    group: 'Error correction'
  }
]

export const PHASE12_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const made = declareAll(STUDIO)
    if (Array.isArray(made)) {
      const first = made.find(isParameterProblem)
      throw new Error(`Parameters for "quantum-studio" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
    }
    return { 'quantum-studio': made }
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE12_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'quantum-studio',
    name: 'Quantum Studio',
    summary:
      'Build quantum circuits and run them: state vector, Bloch sphere, measurement histograms, the algorithms from Deutsch to Shor, noise channels and error correction — every number computed by a tested simulator rather than quoted.',
    domain: 'physics',
    icon: 'atom',
    aliases: [
      'quantum',
      'quantum computing',
      'qubit',
      'quantum circuit',
      'circuit designer',
      'bloch sphere',
      'grover',
      'shor',
      'qft',
      'quantum fourier transform',
      'teleportation',
      'entanglement',
      'quantum error correction',
      'bell state'
    ],
    tags: [
      'quantum',
      'quantum computing',
      'qubit',
      'superposition',
      'entanglement',
      'bell state',
      'ghz',
      'hadamard',
      'cnot',
      'pauli',
      'phase gate',
      'bloch sphere',
      'measurement',
      'shots',
      'interference',
      'teleportation',
      'superdense coding',
      'no-cloning',
      'oracle',
      'deutsch',
      'deutsch-jozsa',
      'bernstein-vazirani',
      'grover',
      'amplitude amplification',
      'quantum fourier transform',
      'qft',
      'phase estimation',
      'shor',
      'period finding',
      'factoring',
      'noise',
      'decoherence',
      'depolarising',
      'amplitude damping',
      'dephasing',
      't1',
      't2',
      'fidelity',
      'error correction',
      'syndrome',
      'stabiliser',
      'surface code',
      'density matrix',
      'purity',
      'partial trace',
      'variational',
      'vqe',
      'qaoa',
      'quantum machine learning'
    ],
    capabilities: [
      { id: 'buildQuantumCircuit', summary: 'build a quantum circuit gate by gate, with validation that says what is wrong and why' },
      { id: 'runQuantumCircuit', summary: 'run a circuit exactly and show the state after every step' },
      { id: 'inspectQuantumState', summary: 'show every amplitude, its magnitude, its phase and its probability' },
      { id: 'showBlochSphere', summary: 'place a qubit on the Bloch sphere, with a short arrow when it is entangled rather than a false one on the surface' },
      { id: 'sampleMeasurements', summary: 'draw shots from the final state and compare the counts with the exact probabilities' },
      { id: 'changeMeasurementBasis', summary: 'measure in the X, Y or Z basis, showing the gates that convert between them' },
      { id: 'runQuantumAlgorithm', summary: 'run Deutsch, Deutsch-Jozsa, Bernstein-Vazirani, Grover, the Fourier transform, phase estimation or Shor, with the answer computed' },
      { id: 'teleportQubit', summary: 'run the teleportation protocol and measure the fidelity of what arrived' },
      { id: 'simulateQuantumNoise', summary: 'apply a noise channel and compare the noisy distribution with the ideal one' },
      { id: 'correctQuantumError', summary: 'encode a logical qubit, inject an error, measure the syndrome and correct it' },
      { id: 'analyseQuantumResources', summary: 'count qubits, gates, depth, two-qubit gates and the memory a state vector needs' },
      { id: 'invertQuantumCircuit', summary: 'build the inverse of a circuit, and refuse when it contains a measurement' },
      { id: 'showDensityMatrix', summary: 'show a density matrix, its purity and its coherence, and the reduced state of one qubit' }
    ],
    limitations: [
      `A state vector doubles with every qubit, so the simulation stops at ${MAX_QUBITS} qubits and says so with a size rather than attempting it.`,
      'Noise is simulated by sampling trajectories rather than by evolving a density matrix, so every noisy figure is an average over shots with sampling error, and the studio labels it as one.',
      'Shor factors small numbers with the modular arithmetic applied as a permutation rather than built from elementary gates. The quantum part is genuinely computed; the construction is educational and not scalable.',
      'There is no real quantum hardware behind this. Every result is simulation, labelled ideal or noisy, and nothing here is presented as having come from a device.',
      'The randomness is a seeded pseudorandom generator, so a run can be repeated exactly. That is useful and it is not the physical randomness of a measurement.'
    ],
    engine: 'quantum',
    surface: { kind: 'native', ref: 'QuantumStudio' },
    // A circuit, a state table and a histogram side by side. At the chat's text width the circuit is unreadable.
    opensAt: 'workspace',
    largest: 'workspace',
    whenHidden: 'pause',
    accepts: ['text', 'numbers'],
    produces: ['series', 'table', 'text'],
    permissions: ['compute'],
    persists: true,
    actions: ACTIONS,
    parameters: Object.keys(PHASE12_PARAMETERS['quantum-studio'])
  })
])
