import type { Module } from '../../types.ts'

/**
 * Unit 15 — Hardware, and the variational approach.
 *
 * Hardware is taught comparatively rather than as a list, because the useful skill is being able to read a
 * device specification and say what it implies for a circuit. Connectivity gets its own treatment: a SWAP costs
 * three CNOTs, and that single fact explains most of the gap between a circuit as written and a circuit as run.
 *
 * The variational lessons are deliberately honest about status. VQE and QAOA are real methods with real
 * implementations and no established advantage, and barren plateaus are a genuine obstacle rather than a detail.
 */
export const Q_UNIT_15: Module = {
  id: 'q15',
  title: 'Hardware and Variational Algorithms',
  summary:
    'The platforms and their trade-offs, connectivity and native gate sets, calibration — and the hybrid loop: parameterised circuits, cost functions, VQE, QAOA and barren plateaus.',
  concepts: [
    'hardware-platforms',
    'connectivity',
    'native-gates',
    'calibration',
    'parameterised-circuits',
    'hybrid-loop',
    'cost-function',
    'hamiltonian',
    'vqe',
    'qaoa',
    'barren-plateaus'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q15l1',
      title: 'Platforms, connectivity and native gates',
      intro:
        'What the qubits actually are, and the two hardware facts that change a circuit most: which qubits can talk to each other, and which gates the machine really has.',
      objectives: [
        'Compare the main platforms on the dimensions that matter',
        'Explain why connectivity costs gates, and how much',
        'Say what a native gate set is and what compilation to it costs'
      ],
      concepts: ['hardware-platforms', 'connectivity', 'native-gates'],
      requires: ['t1-t2', 'circuit-simplification'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'table',
          headers: ['Platform', 'The qubit is', 'Strengths', 'Difficulties'],
          rows: [
            ['Superconducting', 'A circuit with quantised energy levels, at millikelvin temperatures', 'Fast gates, well-developed fabrication', 'Short coherence, limited connectivity, needs a dilution refrigerator'],
            ['Trapped ion', 'An electronic state of an individual ion held in a trap', 'Long coherence, high fidelity, all-to-all connectivity', 'Slow gates, harder to scale to many ions'],
            ['Neutral atom', 'An atomic state, atoms held in optical traps', 'Many qubits, reconfigurable layout', 'Newer, and gate fidelities still improving'],
            ['Photonic', 'A property of a single photon', 'Room temperature, natural for communication', 'Two-photon interactions are hard; often probabilistic'],
            ['Spin in silicon', 'An electron or nuclear spin', 'Could use existing semiconductor fabrication', 'Early, small numbers of qubits so far']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'No platform leads on every dimension, and the ordering changes with the year. The transferable skill is not knowing which is ahead — it is being able to read "128 qubits, two-qubit fidelity 99.3%, T₂ 90 μs, heavy-hex connectivity" and say what circuit that will and will not run.'
        },
        { kind: 'heading', text: 'Connectivity' },
        {
          kind: 'text',
          text: 'A two-qubit gate needs the two qubits to interact physically. On a trapped-ion machine any pair can; on a superconducting chip only neighbours on the lattice can. A circuit asking for a CNOT between distant qubits has to have them moved together first.'
        },
        {
          kind: 'example',
          title: 'What a SWAP costs',
          text: 'One SWAP = three CNOTs.\n\nA CNOT between qubits four steps apart on a line:\n  3 SWAPs to bring them together  = 9 CNOTs\n  1 CNOT                          = 1\n  3 SWAPs to put them back        = 9 CNOTs\n                                  ──\n                                    19 two-qubit gates for one logical CNOT'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Nineteen two-qubit gates, each with the two-qubit error rate, for one gate in the written circuit. This is why a circuit of ten gates can compile to forty or more, and why "how many qubits" is a much less useful question about a device than "how are they connected".'
        },
        { kind: 'heading', text: 'Native gates' },
        {
          kind: 'text',
          text: 'Hardware implements a small set directly — perhaps Rz, √X and CNOT, or on an ion machine a particular two-qubit entangling gate and arbitrary single-qubit rotations. Everything else is compiled into those.'
        },
        {
          kind: 'table',
          headers: ['Written as', 'Compiled to', 'Cost'],
          rows: [
            ['H', 'Rz, √X, Rz', 'Three native gates for one'],
            ['Toffoli', 'Six CNOTs plus single-qubit gates', 'Expensive — and it is the reversible AND everything classical needs'],
            ['A controlled rotation', 'Two CNOTs plus rotations', 'Moderate'],
            ['T', 'Native on some machines; expensive in a corrected one', 'In a fault-tolerant setting T gates dominate the cost']
          ]
        },
        {
          kind: 'text',
          text: 'The last row connects to Unit 04: circuits of Hadamards, CNOTs and π/2 phases are classically simulable, and T is what breaks that. In a fault-tolerant machine T gates cannot be applied directly and have to be produced by an expensive procedure, so **T count** becomes the standard measure of how costly an algorithm really is.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Count what a circuit would cost',
          does:
            'Build a circuit using CNOTs between non-adjacent qubits and read the resource figures. Then rewrite it so every two-qubit gate is between neighbours and compare. Add three SWAPs by hand to see what routing would have cost.',
          optional: true
        },
        { kind: 'check', questionId: 'q15l1q1' },
        { kind: 'check', questionId: 'q15l1q2' }
      ],
      questions: [
        {
          id: 'q15l1q1',
          kind: 'number',
          concept: 'connectivity',
          prompt: 'How many CNOTs does one SWAP gate require?',
          difficulty: 'intermediate',
          answer: 3,
          tolerance: 0.5,
          explanation: 'Three CNOTs, alternating direction. Which is why routing on a sparsely connected chip is expensive.',
          hints: ['It is a small odd number.']
        },
        {
          id: 'q15l1q2',
          kind: 'choice',
          concept: 'native-gates',
          prompt: 'Why is T count used as a measure of algorithm cost in fault-tolerant settings?',
          difficulty: 'advanced',
          options: [
            'T gates are the slowest to apply',
            'Because circuits without T gates are classically simulable, and in a corrected machine T gates cannot be applied directly and require an expensive procedure',
            'Because T gates cause the most decoherence',
            'Because T gates are not unitary'
          ],
          answer: 1,
          explanation:
            'Two facts together: T is what makes a circuit genuinely quantum, and it is the gate error correction handles worst. So counting T gates measures both the quantum content and the real cost.',
          hints: ['What is special about circuits built only from Cliffords?']
        },
        {
          id: 'q15l1q3',
          kind: 'choice',
          concept: 'hardware-platforms',
          prompt: 'A device specification says "all-to-all connectivity, slow gates, long coherence". Which platform is that?',
          difficulty: 'intermediate',
          options: ['Superconducting', 'Trapped ion', 'Photonic', 'Spin in silicon'],
          answer: 1,
          explanation:
            'Trapped ions: every pair can interact, coherence times are long, and gates are slow — the mirror image of the superconducting trade-off.',
          hints: ['Which row of the table has those three together?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q15l2',
      title: 'Calibration, benchmarking and the honest device',
      intro:
        'A real machine has to be characterised rather than trusted, and the methods for doing it are worth knowing because they are how claims about hardware are substantiated.',
      objectives: [
        'Say why a device needs continual calibration',
        'Describe randomised benchmarking and what it measures',
        'Say what a reported fidelity does and does not cover'
      ],
      concepts: ['calibration'],
      requires: ['hardware-platforms', 'fidelity'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A quantum gate is a physical operation — a microwave pulse of a particular shape, amplitude and duration. The parameters that make it the gate you wanted drift: with temperature, with the state of neighbouring qubits, with time. A device calibrated this morning is slightly wrong by this afternoon.'
        },
        {
          kind: 'list',
          items: [
            '**Gate calibration** — adjust pulse amplitudes and timings so each gate does what it should.',
            '**Readout calibration** — prepare known states, record how often each is misreported, and build the correction matrix from Unit 13.',
            '**Frequency tracking** — qubit frequencies drift and have to be followed.',
            '**Crosstalk characterisation** — operating one qubit disturbs its neighbours, which has to be measured and compensated.'
          ]
        },
        { kind: 'heading', text: 'Randomised benchmarking' },
        {
          kind: 'text',
          text: 'The standard way to measure an average gate error without being fooled. Apply a long random sequence of gates, then the single gate that inverts the whole sequence, then measure: you should get back exactly what you started with. Run many such sequences at many lengths, and the rate at which the success probability decays with length gives the average error per gate.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Why randomise? Because a fixed test sequence can accidentally cancel its own errors, and because a single-basis test is blind to phase errors — Unit 13. Averaging over random sequences removes both effects, and the decay rate is insensitive to readout error, which is measured separately.'
        },
        { kind: 'heading', text: 'Reading a reported fidelity' },
        {
          kind: 'table',
          headers: ['A reported number', 'What it covers', 'What it does not'],
          rows: [
            ['Single-qubit gate fidelity 99.99%', 'The average one-qubit error', 'Two-qubit gates, which are far worse'],
            ['Two-qubit gate fidelity 99.5%', 'The average over the pairs that were tested', 'The worst pair; crosstalk during a real circuit'],
            ['Readout fidelity 98%', 'Measurement accuracy', 'Anything about the gates'],
            ['"Quantum volume"', 'A single figure combining qubit count, connectivity and fidelity', 'Whether your particular circuit will run']
          ]
        },
        {
          kind: 'text',
          text: 'The pattern: every reported figure is an average over something, and the thing it averages over is usually not your circuit. A 99.5% two-qubit fidelity across a hundred-gate circuit gives about a 60% chance of no error anywhere — which is the number that actually matters and is never the number in the headline.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'And a point of honesty about this course: there is no hardware behind the Quantum Studio. Every result in it is simulation, labelled ideal or noisy. Nothing here has been near a device, and a course that implied otherwise would be doing exactly what this lesson warns against.'
        },
        { kind: 'check', questionId: 'q15l2q1' },
        { kind: 'check', questionId: 'q15l2q2' }
      ],
      questions: [
        {
          id: 'q15l2q1',
          kind: 'choice',
          concept: 'calibration',
          prompt: 'Why is randomisation central to benchmarking a quantum device?',
          difficulty: 'advanced',
          options: [
            'It makes the test faster',
            'Because a fixed sequence can cancel its own errors and a single-basis test is blind to phase errors — averaging over random sequences removes both effects',
            'Because quantum mechanics is random',
            'It is not; fixed sequences are preferred'
          ],
          answer: 1,
          explanation:
            'Two specific ways a naive test flatters a device, both removed by averaging over random sequences. The decay rate with sequence length is then a meaningful average error per gate.',
          hints: ['What could go wrong with one carefully chosen test circuit?']
        },
        {
          id: 'q15l2q2',
          kind: 'choice',
          concept: 'calibration',
          prompt: 'A device reports two-qubit gate fidelity of 99.5%. Your circuit uses 100 two-qubit gates. What is the rough chance of no error at all?',
          difficulty: 'advanced',
          options: ['99.5%', 'About 90%', 'About 60%', 'About 5%'],
          answer: 2,
          explanation:
            '0.995^100 ≈ 0.61. Per-gate fidelity compounds, which is why a headline figure near 100% can still mean most runs of a realistic circuit contain an error.',
          hints: ['Raise the per-gate fidelity to the power of the gate count.']
        },
        {
          id: 'q15l2q3',
          kind: 'true-false',
          concept: 'calibration',
          prompt: 'A device calibrated once will stay calibrated.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Parameters drift with temperature, time and the activity of neighbouring qubits, so calibration is continual rather than a one-off setup step.',
          hints: ['What is a gate physically, and what could change about it?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q15l3',
      title: 'Parameterised circuits and the hybrid loop',
      intro:
        'The approach built for machines that cannot run deep circuits: a shallow circuit with adjustable angles, and a classical optimiser turning them.',
      objectives: [
        'Describe the hybrid loop',
        'Say what a cost function is here and how it is measured',
        'Say why this approach suits present hardware'
      ],
      concepts: ['parameterised-circuits', 'hybrid-loop', 'cost-function'],
      requires: ['rotations', 'expectation-values'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Shor and Grover need deep circuits and error correction. Neither is available. The variational approach is what you do instead: a **shallow** circuit with adjustable rotation angles, run many times, with a classical optimiser choosing the angles.'
        },
        {
          kind: 'example',
          title: 'The loop',
          text: 'classical optimiser picks angles θ\n        ↓\nquantum circuit runs with those angles\n        ↓\nmeasure many shots → an expectation value\n        ↓\nthat value is the cost\n        ↓\noptimiser adjusts θ and goes round again'
        },
        {
          kind: 'table',
          headers: ['Does what', 'Where it runs', 'Why there'],
          rows: [
            ['Holds and updates the parameters', 'Classical', 'Optimisation is a solved classical problem'],
            ['Prepares the state', 'Quantum', 'The state space is what classical hardware cannot represent'],
            ['Measures the cost', 'Quantum, many shots', 'Expectation values come from repeated measurement'],
            ['Decides when to stop', 'Classical', 'Ordinary convergence checking']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Why this shape suits present machines: the circuit is shallow, so it finishes before decoherence ruins it; the loop is repeated, so a noisy individual run is averaged over; and the classical half does the part that needs memory and precision. It is engineering around the limitations rather than waiting for them to be solved.'
        },
        { kind: 'heading', text: 'The cost function' },
        {
          kind: 'text',
          text: 'The cost is an **expectation value** — Unit 11 — of some observable. Measured, not computed: run the circuit, measure, average, and the mean is your number. Which means the cost has sampling error in it, and the optimiser is working with noisy function evaluations.'
        },
        {
          kind: 'text',
          text: 'That matters more than it sounds. A classical optimiser expects to be able to evaluate its objective accurately. Here, each evaluation costs hundreds or thousands of shots and still comes with error bars, and gradients estimated by finite differences of noisy values are noisier still. The choice of optimiser is a real decision, and methods robust to noise are preferred.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Sweep a parameter and read the cost',
          does:
            'Build a single Ry with a variable angle and measure ⟨Z⟩ as the angle sweeps — that curve is the simplest possible cost landscape. Note how many shots it takes before the curve looks smooth rather than ragged.'
        },
        {
          kind: 'lab',
          appId: 'optimiser',
          title: 'Optimise a noisy objective',
          does:
            'Minimise a function whose evaluations carry random error, and watch what the noise does to the convergence. This is the classical half of the loop, and the difficulty is real rather than incidental.',
          optional: true
        },
        { kind: 'check', questionId: 'q15l3q1' },
        { kind: 'check', questionId: 'q15l3q2' }
      ],
      questions: [
        {
          id: 'q15l3q1',
          kind: 'choice',
          concept: 'hybrid-loop',
          prompt: 'In the hybrid loop, which part runs on the quantum computer?',
          difficulty: 'intermediate',
          options: [
            'The optimisation',
            'Preparing the state with the given parameters and measuring the expectation value',
            'Both the optimisation and the measurement',
            'The convergence check'
          ],
          answer: 1,
          explanation:
            'State preparation and measurement. The optimiser, the parameter bookkeeping and the stopping decision are all classical — which is why this is called a hybrid algorithm.',
          hints: ['Which step needs a state space classical hardware cannot hold?']
        },
        {
          id: 'q15l3q2',
          kind: 'choice',
          concept: 'cost-function',
          prompt: 'Why is the optimisation in a variational algorithm harder than ordinary numerical optimisation?',
          difficulty: 'advanced',
          options: [
            'The parameters are complex numbers',
            'Each evaluation of the cost is an average over shots, so it carries sampling error — and gradients estimated from noisy values are noisier still',
            'There are too many parameters',
            'The cost function has no minimum'
          ],
          answer: 1,
          explanation:
            'Noisy function evaluations, each expensive. That combination rules out many standard optimisers and makes the choice of method a substantive decision rather than a default.',
          hints: ['Where does the cost value come from, and how exact is it?']
        },
        {
          id: 'q15l3q3',
          kind: 'choice',
          concept: 'parameterised-circuits',
          prompt: 'Why does the variational approach suit current hardware?',
          difficulty: 'intermediate',
          options: [
            'It needs no measurement',
            'The circuits are shallow enough to finish before decoherence, and repetition averages over noise — it works around the limitations rather than requiring them to be fixed',
            'It needs no classical computer',
            'It is provably faster than classical methods'
          ],
          answer: 1,
          explanation:
            'Shallow circuits and repeated runs. The last option is exactly what has **not** been established, which the next lesson addresses.',
          hints: ['What can present machines not do, and how does this avoid needing it?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q15l4',
      title: 'VQE, QAOA and barren plateaus',
      intro:
        'The two best-known variational algorithms, and the obstacle that stands in the way of both. The honest status of this area is part of the lesson.',
      objectives: [
        'Describe VQE and what it estimates',
        'Describe QAOA and the problem shape it suits',
        'Explain barren plateaus and why they matter'
      ],
      concepts: ['hamiltonian', 'vqe', 'qaoa', 'barren-plateaus'],
      requires: ['hybrid-loop', 'cost-function', 'observables'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Hamiltonians' },
        {
          kind: 'text',
          text: 'A **Hamiltonian** is the observable representing a system energy. Its lowest eigenvalue is the **ground-state energy**, and for a molecule that single number determines a great deal of its chemistry. Computing it classically is the problem from Unit 01: the description grows exponentially with the number of particles.'
        },
        { kind: 'heading', text: 'VQE' },
        {
          kind: 'text',
          text: 'The **variational quantum eigensolver** estimates that lowest eigenvalue. It rests on a classical fact: the expectation value of H in **any** state is at least the ground-state energy. So prepare a state with a parameterised circuit, measure ⟨H⟩, and have the optimiser push it down. The lowest value found is an upper bound on the true ground state, and the bound is the answer.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Write the Hamiltonian as a sum of terms you can measure — products of Pauli operators.',
            'Choose an **ansatz**: a parameterised circuit shape capable of representing something close to the ground state.',
            'For each set of parameters, measure every term and add them up to get ⟨H⟩.',
            'Let the optimiser minimise. Stop when it stops improving.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The ansatz is the weak point. If it cannot represent the true ground state, the optimiser converges to the best state it can reach and reports that — a correct upper bound and the wrong energy, with nothing in the output to say so. Choosing an ansatz is where domain knowledge enters, and the honest report of a VQE result includes which one was used.'
        },
        { kind: 'heading', text: 'QAOA' },
        {
          kind: 'text',
          text: 'The **quantum approximate optimisation algorithm** targets combinatorial problems — the usual example being Max-Cut, where you split a graph into two parts cutting as many edges as possible. The problem is encoded as a Hamiltonian whose ground state is the best cut, and the circuit alternates two kinds of layer: a **cost** layer derived from the problem, and a **mixer** layer that moves amplitude between candidate solutions. More layers means a better approximation and a deeper circuit.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The honest status: QAOA is a real algorithm with real implementations, and no established advantage over good classical heuristics for any practical problem. Several early claims have not survived comparison with better classical methods. It is an active research area, and a course presenting it as a solved advantage would be misleading.'
        },
        { kind: 'heading', text: 'Barren plateaus' },
        {
          kind: 'text',
          text: 'The obstacle facing the whole approach. For many choices of ansatz, as the circuit gets wider or deeper the gradient of the cost function becomes **exponentially small** almost everywhere in parameter space. The landscape flattens into a plain with a narrow valley somewhere in it.'
        },
        {
          kind: 'text',
          text: 'The consequence is severe: an optimiser starting at random sees no slope, and estimating a gradient that is exponentially small requires exponentially many shots to distinguish from sampling noise. The variational approach then loses the thing that made it attractive, because the measurement cost grows exponentially with system size.'
        },
        {
          kind: 'table',
          headers: ['Response', 'Idea', 'Status'],
          rows: [
            ['Problem-informed ansatz', 'Use a circuit shape derived from the physics rather than a generic one', 'Helps, and needs domain knowledge'],
            ['Careful initialisation', 'Start somewhere with a usable gradient rather than at random', 'Helps in practice'],
            ['Layer-by-layer training', 'Train a shallow circuit, then extend it', 'Partial relief'],
            ['Shallow circuits', 'Stay in the regime where gradients survive', 'Limits what can be represented']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Worth noticing the parallel with Unit 13 of the AI course, if you took it: a vanishing gradient stops training for exactly the same reason in both subjects, and the responses — better initialisation, structured architectures, shallower models — rhyme. Optimisation difficulties are not specific to quantum computing.'
        },
        { kind: 'check', questionId: 'q15l4q1' },
        { kind: 'check', questionId: 'q15l4q2' },
        { kind: 'check', questionId: 'q15l4q3' }
      ],
      questions: [
        {
          id: 'q15l4q1',
          kind: 'choice',
          concept: 'vqe',
          prompt: 'What does VQE produce, strictly speaking?',
          difficulty: 'advanced',
          options: [
            'The exact ground-state energy',
            'An upper bound on the ground-state energy — the lowest ⟨H⟩ the ansatz and optimiser managed to reach',
            'The full spectrum of the Hamiltonian',
            'The ground state itself, exactly'
          ],
          answer: 1,
          explanation:
            'An upper bound, because ⟨H⟩ in any state is at least the ground-state energy. How close it is depends on whether the ansatz can represent the true ground state, which is why reporting the ansatz is part of reporting the result.',
          hints: ['What does the variational principle guarantee?']
        },
        {
          id: 'q15l4q2',
          kind: 'choice',
          concept: 'barren-plateaus',
          prompt: 'What is a barren plateau, and why is it serious?',
          difficulty: 'advanced',
          options: [
            'A region where the cost is high',
            'A region — most of parameter space, for many ansatz choices — where the gradient is exponentially small, so distinguishing it from sampling noise needs exponentially many shots',
            'A circuit with no parameters',
            'A hardware fault'
          ],
          answer: 1,
          explanation:
            'The gradient vanishes exponentially with system size, and measuring such a gradient against sampling noise costs exponentially many shots. That removes the efficiency the variational approach was meant to provide.',
          hints: ['Think about what it takes to measure a very small number by sampling.']
        },
        {
          id: 'q15l4q3',
          kind: 'choice',
          concept: 'qaoa',
          prompt: 'What is the honest status of QAOA for practical optimisation?',
          difficulty: 'advanced',
          options: [
            'It reliably beats classical methods',
            'It is a real algorithm with no established advantage over good classical heuristics, and several early claims did not survive better classical comparisons',
            'It has been proved not to work',
            'It only works on quantum data'
          ],
          answer: 1,
          explanation:
            'Active research, no settled advantage. Both halves matter: dismissing it would be as wrong as claiming it works, and the pattern of claims being closed by improved classical algorithms is a real feature of this area.',
          hints: ['What did the lesson say about early claims?']
        }
      ]
    }
  ]
}
