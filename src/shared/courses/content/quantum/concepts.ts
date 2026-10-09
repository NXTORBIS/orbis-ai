import type { Concept } from '../../types.ts'

/**
 * Everything Course 03 teaches, and what each thing rests on.
 *
 * ## The order is forced by the mathematics
 *
 * Complex numbers before amplitudes, amplitudes before interference, interference before every algorithm.
 * Tensor products before entanglement. Eigenstates before phase estimation. The edges here are not a suggestion
 * about pacing — they are what somebody genuinely cannot proceed without, and the course's own test walks them to
 * prove no lesson requires something taught later.
 *
 * ## Weight is how much of the course rests on it
 *
 * Amplitudes, phase, measurement and interference carry nearly everything: every algorithm in the second half is
 * an arrangement of those four. The W state does not carry much, interesting as it is.
 */
export const QUANTUM_CONCEPTS: Concept[] = [
  // ---------------------------------------------------------------- classical ground
  { id: 'classical-bit', name: 'The classical bit', blurb: 'One of two logical states, whatever the hardware underneath.', requires: [], weight: 0.6 },
  { id: 'classical-gates', name: 'Classical logic gates', blurb: 'NOT, AND, OR, XOR — transformations of bits.', requires: ['classical-bit'], weight: 0.6 },
  { id: 'reversibility', name: 'Reversible computation', blurb: 'Whether the inputs can be recovered from the outputs. AND cannot; quantum gates must.', requires: ['classical-gates'], weight: 0.85 },
  { id: 'why-quantum', name: 'Why quantum computing exists', blurb: 'Simulating quantum systems, and a handful of problems with real speedups — not "faster computers".', requires: ['classical-bit'], weight: 0.7 },

  // ---------------------------------------------------------------- the qubit
  { id: 'complex-numbers', name: 'Complex numbers', blurb: 'Real and imaginary parts, magnitude, phase, and what multiplying by i does.', requires: [], weight: 0.9 },
  { id: 'qubit', name: 'The qubit', blurb: 'A two-dimensional quantum state space, with |0⟩ and |1⟩ as a basis.', requires: ['classical-bit'], weight: 1 },
  { id: 'ket-notation', name: 'Ket notation', blurb: '|0⟩ and |1⟩ as column vectors, and what the brackets are for.', requires: ['qubit'], weight: 0.9 },
  { id: 'amplitudes', name: 'Probability amplitudes', blurb: 'The complex numbers α and β, which are not probabilities.', requires: ['ket-notation', 'complex-numbers'], weight: 1 },
  { id: 'normalisation', name: 'Normalisation', blurb: '|α|² + |β|² = 1, because the probabilities have to add up.', requires: ['amplitudes'], weight: 0.95 },
  { id: 'born-rule', name: 'From amplitude to probability', blurb: 'P(0) = |α|², P(1) = |β|². The squaring is where probability enters.', requires: ['normalisation'], weight: 1 },
  { id: 'global-phase', name: 'Global phase', blurb: 'Multiplying the whole state by a phase changes nothing observable.', requires: ['amplitudes'], weight: 0.75 },
  { id: 'relative-phase', name: 'Relative phase', blurb: 'The phase *between* components, which changes everything later.', requires: ['global-phase'], weight: 1 },

  // ---------------------------------------------------------------- superposition and measurement
  { id: 'superposition', name: 'Superposition', blurb: 'A state that is a combination of basis states, with amplitudes — not "both at once".', requires: ['born-rule'], weight: 1 },
  { id: 'hadamard', name: 'The Hadamard gate', blurb: 'Takes |0⟩ to |+⟩ and |1⟩ to |−⟩. Applied twice it does nothing.', requires: ['superposition'], weight: 1 },
  { id: 'plus-minus', name: '|+⟩ and |−⟩', blurb: 'Identical measurement probabilities, opposite relative phase.', requires: ['hadamard', 'relative-phase'], weight: 0.95 },
  { id: 'measurement', name: 'Measurement', blurb: 'One outcome, with a probability, and the state conditioned on it afterwards.', requires: ['born-rule'], weight: 1 },
  { id: 'collapse', name: 'Collapse', blurb: 'What the state becomes once an outcome is recorded.', requires: ['measurement'], weight: 0.9 },
  { id: 'shots', name: 'Shots', blurb: 'One run and one measurement. Statistics come from many.', requires: ['measurement'], weight: 0.9 },
  { id: 'statistical-fluctuation', name: 'Sampling and convergence', blurb: 'Why 100 shots are not 50/50 and 10,000 nearly are.', requires: ['shots'], weight: 0.8 },
  { id: 'measurement-basis', name: 'Measurement bases', blurb: 'Measuring in X or Y rather than Z, and how a gate converts between them.', requires: ['measurement', 'hadamard'], weight: 0.9 },
  { id: 'quantum-vs-classical-random', name: 'Superposition against classical uncertainty', blurb: 'Same probabilities, different state — and the difference is detectable.', requires: ['plus-minus', 'measurement-basis'], weight: 0.95 },

  // ---------------------------------------------------------------- gates
  { id: 'unitary', name: 'Unitary operations', blurb: 'Every quantum gate preserves normalisation, and is therefore reversible.', requires: ['normalisation', 'reversibility'], weight: 0.95 },
  { id: 'pauli-gates', name: 'X, Y and Z', blurb: 'Bit flip, bit-and-phase flip, phase flip.', requires: ['unitary'], weight: 0.95 },
  { id: 'phase-gates', name: 'S and T', blurb: 'Quarter and eighth turns of phase, with S² = Z and T² = S.', requires: ['pauli-gates', 'relative-phase'], weight: 0.85 },
  { id: 'rotations', name: 'Rx, Ry and Rz', blurb: 'Rotation about an axis by any angle.', requires: ['pauli-gates'], weight: 0.85 },
  { id: 'gate-composition', name: 'Composing gates', blurb: 'Circuits are products of matrices, applied right to left.', requires: ['unitary'], weight: 0.9 },
  { id: 'non-commutativity', name: 'Order matters', blurb: 'XZ and ZX are different operations, demonstrably.', requires: ['gate-composition'], weight: 0.9 },
  { id: 'bloch-sphere', name: 'The Bloch sphere', blurb: 'One qubit as a point on a sphere, with gates as rotations.', requires: ['relative-phase', 'pauli-gates'], weight: 0.9 },
  { id: 'circuit-identities', name: 'Circuit identities', blurb: 'H² = I, XX = I, and why two circuits can be the same operation.', requires: ['gate-composition'], weight: 0.8 },

  // ---------------------------------------------------------------- many qubits
  { id: 'tensor-product', name: 'Tensor products', blurb: 'How two quantum systems combine into one state space.', requires: ['ket-notation'], weight: 0.95 },
  { id: 'multi-qubit-states', name: 'Multi-qubit states', blurb: 'Four amplitudes for two qubits, 2ⁿ for n.', requires: ['tensor-product', 'amplitudes'], weight: 1 },
  { id: 'exponential-growth', name: 'Exponential state space', blurb: 'Each added qubit doubles the description — and why simulation runs out.', requires: ['multi-qubit-states'], weight: 0.85 },
  { id: 'product-states', name: 'Product states', blurb: 'States that are two independent qubits side by side.', requires: ['multi-qubit-states'], weight: 0.85 },
  { id: 'cnot', name: 'The CNOT gate', blurb: 'Flips the target in the branches where the control is 1.', requires: ['multi-qubit-states', 'pauli-gates'], weight: 1 },
  { id: 'controlled-gates', name: 'Controlled gates', blurb: 'Any gate, applied conditionally — which is not a classical "if".', requires: ['cnot'], weight: 0.9 },
  { id: 'classical-control', name: 'Classical control', blurb: 'Acting on a measured bit, which is a different thing again.', requires: ['controlled-gates', 'collapse'], weight: 0.75 },

  // ---------------------------------------------------------------- entanglement
  { id: 'entanglement', name: 'Entanglement', blurb: 'A joint state that cannot be written as independent parts.', requires: ['product-states', 'cnot'], weight: 1 },
  { id: 'bell-states', name: 'The Bell states', blurb: 'The four maximally entangled two-qubit states, and how to build each.', requires: ['entanglement'], weight: 0.95 },
  { id: 'correlation-vs-entanglement', name: 'Correlation is not entanglement', blurb: 'Classical correlation reproduces the counts and not the behaviour.', requires: ['bell-states', 'measurement-basis'], weight: 0.9 },
  { id: 'partial-measurement', name: 'Measuring part of a system', blurb: 'What happens to the rest when one qubit is measured.', requires: ['entanglement', 'collapse'], weight: 0.85 },
  { id: 'ghz-w', name: 'GHZ and W states', blurb: 'Two inequivalent ways three qubits can be entangled.', requires: ['bell-states'], weight: 0.55 },
  { id: 'no-faster-than-light', name: 'Why entanglement sends nothing', blurb: 'Correlations without communication, and the classical bits that are still required.', requires: ['partial-measurement'], weight: 0.85 },

  // ---------------------------------------------------------------- mixed states
  { id: 'density-matrix', name: 'Density matrices', blurb: 'A description that covers mixtures as well as pure states.', requires: ['multi-qubit-states'], weight: 0.8 },
  { id: 'mixed-states', name: 'Mixed states', blurb: 'Classical uncertainty about which state you have.', requires: ['density-matrix', 'quantum-vs-classical-random'], weight: 0.85 },
  { id: 'purity', name: 'Purity and coherence', blurb: 'Two numbers that separate a superposition from a mixture.', requires: ['mixed-states'], weight: 0.8 },
  { id: 'partial-trace', name: 'Partial trace', blurb: 'The state of one part of a system — mixed, when the parts are entangled.', requires: ['density-matrix', 'entanglement'], weight: 0.85 },
  { id: 'expectation-values', name: 'Expectation values', blurb: 'The average of an observable, which is what experiments measure.', requires: ['measurement', 'density-matrix'], weight: 0.85 },
  { id: 'observables', name: 'Observables and eigenstates', blurb: 'Hermitian operators, eigenvalues as outcomes, eigenstates as certainty.', requires: ['expectation-values'], weight: 0.85 },

  // ---------------------------------------------------------------- circuits in practice
  { id: 'circuit-model', name: 'The circuit model', blurb: 'Qubits as wires, gates in order, measurement at the end.', requires: ['gate-composition', 'cnot'], weight: 0.9 },
  { id: 'circuit-depth', name: 'Depth and width', blurb: 'The longest chain of operations, and how many qubits — the two costs that matter.', requires: ['circuit-model'], weight: 0.85 },
  { id: 'circuit-simplification', name: 'Simplifying a circuit', blurb: 'Cancelling inverses and fusing rotations without changing what it does.', requires: ['circuit-identities', 'circuit-depth'], weight: 0.75 },
  { id: 'quantum-programming', name: 'Quantum programming', blurb: 'A circuit as code, and the loop from code to circuit to state to result.', requires: ['circuit-model'], weight: 0.8 },
  { id: 'quantum-debugging', name: 'Debugging a circuit', blurb: 'Stepping, inspecting the state, and finding where it went wrong.', requires: ['quantum-programming', 'circuit-model'], weight: 0.85 },
  { id: 'simulation-limits', name: 'What a simulator can and cannot do', blurb: 'Exact, sampled and noisy modes, and the qubit count where it stops.', requires: ['exponential-growth'], weight: 0.85 },

  // ---------------------------------------------------------------- interference
  { id: 'interference', name: 'Interference', blurb: 'Amplitudes adding and cancelling — the engine of every quantum algorithm.', requires: ['relative-phase', 'hadamard'], weight: 1 },
  { id: 'constructive-destructive', name: 'Constructive and destructive', blurb: 'Reinforcement and cancellation, and the phase that decides which.', requires: ['interference'], weight: 0.95 },
  { id: 'phase-kickback', name: 'Phase kickback', blurb: 'An oracle writing a phase onto a control qubit — the trick behind the early algorithms.', requires: ['constructive-destructive', 'controlled-gates'], weight: 0.9 },

  // ---------------------------------------------------------------- protocols
  { id: 'no-cloning', name: 'The no-cloning theorem', blurb: 'An unknown quantum state cannot be copied, and why that follows from linearity.', requires: ['unitary', 'superposition'], weight: 0.85 },
  { id: 'teleportation', name: 'Teleportation', blurb: 'Moving a state with entanglement plus two classical bits. Nothing is copied.', requires: ['bell-states', 'classical-control', 'no-cloning'], weight: 0.9 },
  { id: 'fidelity', name: 'Fidelity', blurb: 'How close one state is to another, as a number.', requires: ['measurement', 'density-matrix'], weight: 0.85 },
  { id: 'superdense', name: 'Superdense coding', blurb: 'Two classical bits in one qubit, given a shared pair in advance.', requires: ['bell-states'], weight: 0.7 },

  // ---------------------------------------------------------------- algorithms
  { id: 'oracle', name: 'Oracles', blurb: 'A problem-specific operation, not a source of answers.', requires: ['controlled-gates', 'reversibility'], weight: 0.95 },
  { id: 'query-complexity', name: 'Query complexity', blurb: 'Counting calls to the oracle, which is what the early speedups are about.', requires: ['oracle'], weight: 0.85 },
  { id: 'deutsch', name: "Deutsch's algorithm", blurb: 'One query to decide whether a one-bit function is constant or balanced.', requires: ['phase-kickback', 'oracle'], weight: 0.85 },
  { id: 'deutsch-jozsa', name: 'Deutsch-Jozsa', blurb: 'The same question for n bits, under a promise.', requires: ['deutsch', 'query-complexity'], weight: 0.8 },
  { id: 'bernstein-vazirani', name: 'Bernstein-Vazirani', blurb: 'A hidden string recovered in one query instead of n.', requires: ['deutsch-jozsa'], weight: 0.8 },
  { id: 'simon', name: "Simon's problem", blurb: 'A hidden XOR mask, found by sampling and linear algebra.', requires: ['bernstein-vazirani'], weight: 0.6 },
  { id: 'grover', name: "Grover's algorithm", blurb: 'Unstructured search in about √N queries.', requires: ['oracle', 'interference'], weight: 1 },
  { id: 'amplitude-amplification', name: 'Amplitude amplification', blurb: 'Marking and inverting about the mean, repeatedly.', requires: ['grover'], weight: 0.95 },
  { id: 'over-rotation', name: 'Over-rotation', blurb: 'Too many Grover iterations make it worse. Not "repeat until certain".', requires: ['amplitude-amplification'], weight: 0.9 },
  { id: 'grover-limits', name: 'What Grover does not give you', blurb: 'A quadratic speedup in queries, against real oracle and hardware costs.', requires: ['amplitude-amplification', 'query-complexity'], weight: 0.85 },

  // ---------------------------------------------------------------- Fourier and Shor
  { id: 'qft', name: 'The quantum Fourier transform', blurb: 'A change of basis that turns periodicity into a measurable position.', requires: ['interference', 'multi-qubit-states'], weight: 0.95 },
  { id: 'qft-circuit', name: 'Building the transform', blurb: 'Hadamards and controlled phase rotations, with the qubit order reversed at the end.', requires: ['qft', 'phase-gates'], weight: 0.85 },
  { id: 'inverse-qft', name: 'The inverse transform', blurb: 'The same operations reversed and conjugated, which undoes it exactly.', requires: ['qft-circuit'], weight: 0.85 },
  { id: 'approximate-qft', name: 'Approximating the transform', blurb: 'Dropping the smallest rotations, and what it costs in fidelity.', requires: ['inverse-qft', 'circuit-depth'], weight: 0.6 },
  { id: 'phase-estimation', name: 'Phase estimation', blurb: 'Reading an eigenvalue phase into a register of counting qubits.', requires: ['inverse-qft', 'observables'], weight: 0.95 },
  { id: 'estimation-precision', name: 'Precision and resources', blurb: 'Each counting qubit halves the smallest difference you can resolve.', requires: ['phase-estimation'], weight: 0.85 },
  { id: 'modular-arithmetic', name: 'Modular arithmetic', blurb: 'Addition, multiplication and exponentiation mod N, and periodicity.', requires: [], weight: 0.7 },
  { id: 'period-finding', name: 'Period finding', blurb: 'The quantum part of factoring: find the period of aˣ mod N.', requires: ['phase-estimation', 'modular-arithmetic'], weight: 0.9 },
  { id: 'continued-fractions', name: 'Continued fractions', blurb: 'The classical step that turns a phase estimate into a period.', requires: ['period-finding'], weight: 0.6 },
  { id: 'shor', name: "Shor's algorithm", blurb: 'Classical setup, quantum period finding, classical finish.', requires: ['period-finding', 'continued-fractions'], weight: 0.9 },
  { id: 'shor-limits', name: 'What Shor actually requires', blurb: 'Qubit counts, depth and error correction, against a textbook demonstration.', requires: ['shor'], weight: 0.85 },

  // ---------------------------------------------------------------- complexity
  { id: 'quantum-complexity', name: 'Quantum complexity', blurb: 'Queries, depth, width, gate count — several costs, not one.', requires: ['query-complexity', 'circuit-depth'], weight: 0.8 },
  { id: 'bqp', name: 'BQP', blurb: 'What a quantum computer can solve efficiently with bounded error.', requires: ['quantum-complexity'], weight: 0.6 },
  { id: 'quantum-advantage', name: 'Speedup, advantage and utility', blurb: 'Three different claims, routinely confused.', requires: ['bqp', 'shor-limits'], weight: 0.85 },

  // ---------------------------------------------------------------- noise
  { id: 'decoherence', name: 'Decoherence', blurb: 'A quantum system interacting with its environment, and losing its phase.', requires: ['relative-phase', 'mixed-states'], weight: 0.9 },
  { id: 'noise-channels', name: 'Noise channels', blurb: 'Bit flip, phase flip, depolarising, damping — each with a different signature.', requires: ['decoherence'], weight: 0.9 },
  { id: 'phase-error-invisibility', name: 'Why a phase error hides', blurb: 'Invisible in the computational basis, obvious after a Hadamard.', requires: ['noise-channels', 'measurement-basis'], weight: 0.9 },
  { id: 'readout-error', name: 'Readout error', blurb: 'A perfect state recorded wrongly, which is a separate fault.', requires: ['noise-channels'], weight: 0.8 },
  { id: 't1-t2', name: 'T₁ and T₂', blurb: 'How long energy and phase survive, and why T₂ ≤ 2T₁.', requires: ['decoherence'], weight: 0.8 },
  { id: 'error-accumulation', name: 'Error accumulation', blurb: 'Why depth, not gate count, is what noise punishes.', requires: ['noise-channels', 'circuit-depth'], weight: 0.9 },
  { id: 'noise-aware-design', name: 'Designing for noise', blurb: 'Fewer two-qubit gates, less depth, less idling — not simply fewer gates.', requires: ['error-accumulation'], weight: 0.85 },

  // ---------------------------------------------------------------- error correction
  { id: 'why-correction-is-hard', name: 'Why correction is hard here', blurb: 'You cannot copy the state and you cannot look at it.', requires: ['no-cloning', 'measurement'], weight: 0.9 },
  { id: 'repetition-code', name: 'The three-qubit codes', blurb: 'One logical qubit across three physical ones, for bit flips or for phase flips.', requires: ['why-correction-is-hard', 'cnot'], weight: 0.9 },
  { id: 'syndrome', name: 'Syndrome measurement', blurb: 'Learning where the error is without learning the state.', requires: ['repetition-code', 'partial-measurement'], weight: 0.95 },
  { id: 'logical-physical', name: 'Logical and physical qubits', blurb: 'The protected information, and the noisy hardware carrying it.', requires: ['repetition-code'], weight: 0.85 },
  { id: 'stabilisers', name: 'Stabilisers', blurb: 'Operators the encoded state is a +1 eigenstate of, and what measuring one reveals.', requires: ['syndrome', 'observables'], weight: 0.8 },
  { id: 'surface-code', name: 'The surface code', blurb: 'A lattice of stabilisers, code distance, and error chains.', requires: ['stabilisers', 'logical-physical'], weight: 0.7 },
  { id: 'fault-tolerance', name: 'Fault tolerance', blurb: 'Correcting with imperfect operations, and the threshold that makes it work.', requires: ['surface-code'], weight: 0.75 },

  // ---------------------------------------------------------------- hardware
  { id: 'hardware-platforms', name: 'Hardware platforms', blurb: 'Superconducting, trapped-ion, neutral-atom, photonic — different trade-offs.', requires: ['t1-t2'], weight: 0.7 },
  { id: 'connectivity', name: 'Connectivity', blurb: 'Which qubits can interact, and the SWAPs needed when they cannot.', requires: ['hardware-platforms', 'circuit-depth'], weight: 0.8 },
  { id: 'native-gates', name: 'Native gate sets', blurb: 'What the hardware really implements, and what compilation costs.', requires: ['connectivity', 'circuit-simplification'], weight: 0.75 },
  { id: 'calibration', name: 'Calibration and benchmarking', blurb: 'Why a real device has to be characterised rather than assumed.', requires: ['hardware-platforms', 'fidelity'], weight: 0.65 },

  // ---------------------------------------------------------------- variational and applications
  { id: 'parameterised-circuits', name: 'Parameterised circuits', blurb: 'Circuits with adjustable angles, trained by a classical optimiser.', requires: ['rotations', 'expectation-values'], weight: 0.85 },
  { id: 'hybrid-loop', name: 'The hybrid loop', blurb: 'Classical parameters in, quantum measurement out, repeat.', requires: ['parameterised-circuits'], weight: 0.85 },
  { id: 'cost-function', name: 'Cost functions', blurb: 'A measurable quantity the optimiser is trying to minimise.', requires: ['hybrid-loop'], weight: 0.8 },
  { id: 'hamiltonian', name: 'Hamiltonians', blurb: 'The energy structure of a system, as an operator.', requires: ['observables'], weight: 0.8 },
  { id: 'vqe', name: 'VQE', blurb: 'Estimating a ground-state energy with a parameterised circuit.', requires: ['hamiltonian', 'cost-function'], weight: 0.8 },
  { id: 'qaoa', name: 'QAOA', blurb: 'Alternating cost and mixer layers for combinatorial optimisation.', requires: ['hybrid-loop', 'hamiltonian'], weight: 0.7 },
  { id: 'barren-plateaus', name: 'Barren plateaus', blurb: 'Gradients that vanish as circuits grow, and what that does to training.', requires: ['parameterised-circuits', 'cost-function'], weight: 0.65 },
  { id: 'quantum-simulation', name: 'Quantum simulation', blurb: 'The application the field was proposed for: simulating quantum systems.', requires: ['hamiltonian', 'why-quantum'], weight: 0.8 },
  { id: 'time-evolution', name: 'Time evolution', blurb: 'A state evolving under a Hamiltonian, and the unitary that does it.', requires: ['quantum-simulation'], weight: 0.7 },
  { id: 'quantum-chemistry', name: 'Quantum chemistry', blurb: 'Molecular energies as an application of simulation and VQE.', requires: ['vqe', 'time-evolution'], weight: 0.6 },
  { id: 'qml', name: 'Quantum machine learning', blurb: 'Hybrid models, data encoding, and honest baselines.', requires: ['parameterised-circuits', 'cost-function'], weight: 0.65 },
  { id: 'data-encoding', name: 'Encoding classical data', blurb: 'Basis, angle and amplitude encoding, and what each costs.', requires: ['qml'], weight: 0.65 },

  // ---------------------------------------------------------------- cryptography and randomness
  { id: 'quantum-cryptography', name: 'Quantum cryptography', blurb: 'Using quantum properties for a security task — not the same as post-quantum cryptography.', requires: ['measurement-basis'], weight: 0.75 },
  { id: 'bb84', name: 'BB84', blurb: 'Key distribution where eavesdropping leaves a detectable trace.', requires: ['quantum-cryptography', 'no-cloning'], weight: 0.8 },
  { id: 'post-quantum', name: 'Post-quantum cryptography', blurb: 'Classical algorithms designed to resist quantum attack. A different subject.', requires: ['shor-limits'], weight: 0.7 },
  { id: 'quantum-randomness', name: 'Quantum randomness', blurb: 'Measurement as a source of randomness, and what a simulator cannot provide.', requires: ['measurement', 'simulation-limits'], weight: 0.7 },

  // ---------------------------------------------------------------- method
  { id: 'prediction-first', name: 'Predicting before running', blurb: 'Committing to an answer first, which is what turns a demonstration into learning.', requires: ['measurement'], weight: 0.85 },
  { id: 'misconceptions', name: 'The standard misconceptions', blurb: '"Both at once", "tries every answer", "instant communication" — and what is true instead.', requires: ['superposition', 'entanglement'], weight: 0.9 },
  { id: 'reproducibility', name: 'Reproducible experiments', blurb: 'Seeds, parameters, modes — enough to get the same result twice.', requires: ['shots', 'simulation-limits'], weight: 0.8 },
  { id: 'experiment-reporting', name: 'Reporting an experiment', blurb: 'Objective, setup, prediction, result, analysis, limitations.', requires: ['reproducibility', 'prediction-first'], weight: 0.85 }
]
