import type { Module } from '../../types.ts'

/**
 * Unit 07 — Circuits, programming and interference.
 *
 * The practical unit: the circuit model stated properly, depth and width as the costs that matter, simplification,
 * debugging — and then interference, which is placed at the end because it is the bridge into every algorithm
 * that follows.
 *
 * The debugging lesson is deliberately built from broken circuits. Repairing somebody else's wrong circuit is a
 * better test of understanding than building a correct one from a recipe.
 */
export const Q_UNIT_7: Module = {
  id: 'q7',
  title: 'Circuits, Programming and Interference',
  summary:
    'The circuit model, depth against gate count, simplification, debugging broken circuits, what a simulator can and cannot do — and interference, which is what every algorithm from here on exploits.',
  concepts: [
    'circuit-model',
    'circuit-depth',
    'circuit-simplification',
    'quantum-programming',
    'quantum-debugging',
    'simulation-limits',
    'interference',
    'constructive-destructive'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q7l1',
      title: 'The circuit model, depth and width',
      intro:
        'How a quantum computation is written down, and the two numbers that decide whether it can be run on anything real.',
      objectives: [
        'Read a circuit diagram and say what order the operations happen in',
        'Compute depth and distinguish it from gate count',
        'Say why two-qubit gates are counted separately'
      ],
      concepts: ['circuit-model', 'circuit-depth'],
      requires: ['gate-composition', 'cnot'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A quantum circuit is drawn as horizontal wires, one per qubit, with time running left to right. Gates sit on the wires. Measurements go at the end, usually. That is the whole notation.'
        },
        {
          kind: 'example',
          title: 'A Bell state, drawn',
          text: 'q0 ──[H]──●──  M\n            │\nq1 ─────────⊕──  M\n\nThe filled circle is the control, the ⊕ the target of the CNOT. Read left to right: Hadamard on q0, then the CNOT, then measure both.'
        },
        { kind: 'heading', text: 'The two numbers' },
        {
          kind: 'table',
          headers: ['', 'What it is', 'Why it matters'],
          rows: [
            ['Width', 'How many qubits', 'Hardware has a fixed number, and a simulator needs 2ⁿ amplitudes'],
            ['Depth', 'The longest chain of operations sharing a qubit', 'Noise accumulates with depth; a qubit idling is still decohering']
          ]
        },
        {
          kind: 'text',
          text: 'Depth is not gate count, and the difference is the useful part. Four Hadamards on four different qubits all happen at once: four gates, depth 1. Four Hadamards on one qubit must happen in sequence: four gates, depth 4. On real hardware the first circuit takes one gate-time and the second takes four.'
        },
        {
          kind: 'example',
          title: 'Same gates, different depth',
          text: 'q0 ──[H]──[H]──[H]──[H]──    4 gates, depth 4\nq1 ────────────────────────\nq2 ────────────────────────\nq3 ────────────────────────\n\nq0 ──[H]──                   4 gates, depth 1\nq1 ──[H]──\nq2 ──[H]──\nq3 ──[H]──'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'So "fewer gates" is not the goal. Fewer **layers** is, and fewer two-qubit gates especially — those are typically ten times noisier than one-qubit gates on real devices, which is why the Quantum Studio counts them separately and says so.'
        },
        { kind: 'heading', text: 'What a barrier is for' },
        {
          kind: 'text',
          text: 'A barrier has no effect on the state at all. It is a marker: it stops an optimiser from moving gates across it, and it divides a circuit into readable stages. In this course the algorithm circuits use barriers to separate preparation from the oracle from the interference step, which makes a twenty-gate circuit legible.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Build both circuits and compare the cost',
          does:
            'Build four Hadamards on one qubit, and read the depth. Then build four on four separate qubits and read it again. Same gate count, different depth — and on real hardware, a four-fold difference in exposure to noise.'
        },
        { kind: 'check', questionId: 'q7l1q1' },
        { kind: 'check', questionId: 'q7l1q2' }
      ],
      questions: [
        {
          id: 'q7l1q1',
          kind: 'number',
          concept: 'circuit-depth',
          prompt: 'A circuit has H on q0, H on q1, then a CNOT from q0 to q1, then H on q0. What is its depth?',
          difficulty: 'intermediate',
          answer: 3,
          tolerance: 0.5,
          explanation:
            'The two Hadamards happen together — layer 1. The CNOT needs both, so it is layer 2. The final H on q0 is layer 3. Four gates, depth 3.',
          hints: ['Group the gates into layers of operations that can happen simultaneously.']
        },
        {
          id: 'q7l1q2',
          kind: 'choice',
          concept: 'circuit-depth',
          prompt: 'Why are two-qubit gates counted separately from one-qubit gates?',
          difficulty: 'intermediate',
          options: [
            'They take more memory to simulate',
            'They are typically about ten times noisier on real hardware, so they dominate the error budget',
            'They cannot be simulated exactly',
            'They are not reversible'
          ],
          answer: 1,
          explanation:
            'Error rates. A circuit with many two-qubit gates is far more fragile than its total gate count suggests, which is why resource analysis reports them as their own line.',
          hints: ['Think about what a resource report is actually for.']
        },
        {
          id: 'q7l1q3',
          kind: 'true-false',
          concept: 'circuit-model',
          prompt: 'A barrier changes the quantum state.',
          difficulty: 'beginner',
          answer: false,
          explanation: 'It has no effect on the state. It marks a stage for readability and stops an optimiser moving gates across it.',
          hints: ['What is it there for?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q7l2',
      title: 'Programming a circuit, and simplifying it',
      intro:
        'A circuit written as code, and the identities that let you shorten one without changing what it does.',
      objectives: [
        'Read a circuit expressed as a sequence of instructions',
        'Apply gate cancellation and rotation fusion',
        'Say when a shorter circuit is not a better one'
      ],
      concepts: ['quantum-programming', 'circuit-simplification'],
      requires: ['circuit-model', 'circuit-identities', 'circuit-depth'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A circuit is data: a list of operations, each naming a gate, the qubits it acts on, and an angle if it needs one. Written as instructions it looks like this:'
        },
        {
          kind: 'code',
          language: 'text',
          caption: 'A Bell state and a measurement, as a sequence of operations. This is exactly the structure the Quantum Studio stores, imports and exports.',
          code: 'qubits 2\n\nh      q0\ncnot   q0 -> q1\nmeasure q0 -> c0\nmeasure q1 -> c1'
        },
        {
          kind: 'text',
          text: 'The value of writing it as data rather than as a drawing is that it can be checked, compared, saved and transformed before anything is run. The studio reports what is wrong with an invalid circuit — "qubit 5 does not exist in a 3-qubit register", with the step number — rather than failing with a generic error.'
        },
        { kind: 'heading', text: 'Simplification' },
        {
          kind: 'table',
          headers: ['Pattern', 'Becomes', 'Why'],
          rows: [
            ['X X', 'nothing', 'X is its own inverse'],
            ['H H', 'nothing', 'Same'],
            ['S S', 'Z', 'Phase angles add'],
            ['Rz(α) Rz(β)', 'Rz(α+β)', 'Rotations about one axis combine'],
            ['T T T T', 'Z', 'Four eighth-turns make a half turn'],
            ['CNOT CNOT (same qubits)', 'nothing', 'Also its own inverse'],
            ['H Z H', 'X', 'The basis-change identity from Unit 04']
          ]
        },
        {
          kind: 'example',
          title: 'A circuit shortened',
          text: 'Before:  H  X  X  S  S  H  H  T  T\n\n  X X     → nothing\n  S S     → Z\n  H H     → nothing\n  T T     → S\n\nAfter:   H  Z  S\n\nNine gates to three, with exactly the same effect on every input state.'
        },
        { kind: 'heading', text: 'When shorter is not better' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The shortest circuit in abstract gates is often not the best circuit on a real device. Hardware implements a particular **native** set — perhaps Rz, √X and CNOT — and anything else has to be compiled into those. A circuit using four native gates may well beat one using two gates the machine does not have.'
        },
        {
          kind: 'text',
          text: 'And connectivity matters more than gate count. If a circuit needs a CNOT between two qubits that are not physically adjacent, the compiler inserts SWAP gates to move them together — each SWAP being three CNOTs. A circuit of ten gates can compile to forty on a device with limited connectivity, which Unit 16 takes further.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Simplify by hand, then check',
          does:
            'Build the nine-gate circuit above and note the final state. Build the three-gate version and compare — identical. Then read the resource figures for both and see what you saved in depth.'
        },
        { kind: 'check', questionId: 'q7l2q1' },
        { kind: 'check', questionId: 'q7l2q2' }
      ],
      questions: [
        {
          id: 'q7l2q1',
          kind: 'choice',
          concept: 'circuit-simplification',
          prompt: 'What does the sequence T T T T reduce to?',
          difficulty: 'intermediate',
          options: ['I', 'S', 'Z', 'X'],
          answer: 2,
          explanation: 'T is an eighth turn of phase, so four of them make a half turn: Z. Two make S, and eight return to the identity.',
          hints: ['Add the angles: four lots of π/4.']
        },
        {
          id: 'q7l2q2',
          kind: 'choice',
          concept: 'circuit-simplification',
          prompt: 'Why might a circuit with more gates run better on real hardware than one with fewer?',
          difficulty: 'advanced',
          options: [
            'More gates means more redundancy',
            'Because the longer circuit may use the gates the device implements natively, while the shorter one needs compiling into more operations',
            'Because gate count does not affect anything',
            'It never does'
          ],
          answer: 1,
          explanation:
            'Native gate sets and connectivity decide the real cost. A gate the machine does not have must be built from ones it does, and a two-qubit gate between distant qubits needs SWAPs — three CNOTs each.',
          hints: ['What does the hardware actually implement?']
        },
        {
          id: 'q7l2q3',
          kind: 'choice',
          concept: 'quantum-programming',
          prompt: 'What is the advantage of a circuit being data rather than a drawing?',
          difficulty: 'intermediate',
          options: [
            'It takes less space',
            'It can be validated, compared, saved and transformed before anything runs — and an invalid one can be reported precisely',
            'It runs faster',
            'It needs no simulator'
          ],
          answer: 1,
          explanation:
            'Everything the course does with circuits — checking, saving an experiment, handing a learner a broken one to repair, computing resources — depends on the circuit being inspectable data.',
          hints: ['What can you do with a list that you cannot do with a picture?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q7l3',
      title: 'Debugging a circuit',
      intro:
        'Four broken circuits, each wrong in a way that happens constantly. Finding the fault is the exercise.',
      objectives: [
        'Diagnose a circuit from its output distribution',
        'Use the state at an intermediate step to locate a fault',
        'Recognise the four most common quantum circuit mistakes'
      ],
      concepts: ['quantum-debugging', 'simulation-limits'],
      requires: ['quantum-programming', 'circuit-model', 'exponential-growth'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A quantum circuit gives you a distribution rather than an answer, which makes debugging unfamiliar at first. The method is the same as anywhere else: find the first step where the state is not what you expected.'
        },
        { kind: 'heading', text: 'The four faults' },
        {
          kind: 'table',
          headers: ['What you see', 'Likely cause'],
          rows: [
            ['A flat distribution where you expected structure', 'A missing Hadamard, or the interference step omitted'],
            ['Only |00…0⟩, with probability 1', 'Nothing happened — gates on the wrong qubits, or a control that is always 0'],
            ['The right distribution, mirrored or shifted', 'Qubit ordering: control and target swapped, or the register read in the wrong direction'],
            ['Nearly right, with a stubborn few per cent wrong', 'A phase error — often a missing or extra Z, S or T']
          ]
        },
        {
          kind: 'example',
          title: 'A broken Bell state',
          text: 'Intended: (|00⟩ + |11⟩)/√2\n\nCircuit:  CNOT q0 → q1\n          H on q0\n\nResult: |00⟩ and |10⟩, half each. Not entangled at all.\n\nWhy: the CNOT came first, when q0 was still |0⟩, so it did nothing. Then the Hadamard put q0 into superposition with q1 untouched. The two gates are in the wrong order, and the output is a product state.'
        },
        {
          kind: 'example',
          title: 'A broken interference circuit',
          text: 'Intended: H, Z, H on |0⟩ → |1⟩ every time\n\nCircuit:  H, Z, Z, H\n\nResult: 0 every time.\n\nWhy: Z Z = I, so the two phase flips cancelled and the circuit became H H. The answer is the exact opposite of what was wanted, with no error message anywhere.'
        },
        { kind: 'heading', text: 'The method' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Write down what you expect the state to be after each stage, **before** running anything.',
            'Run it and step through, comparing the state at each step against what you wrote.',
            'The first disagreement is where the fault is. Everything after it is a consequence.',
            'If the probabilities look right and the behaviour is wrong, look at the phase column — a phase fault is invisible in the probabilities and decisive later.',
            'If you cannot see it, append the inverse of the circuit: a correct circuit followed by its inverse returns to |00…0⟩, and anything else means the two disagree.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The last trick is worth keeping. "Run it forwards, then backwards, and check you are back at the start" tests a whole circuit against nothing but itself, and it catches ordering and phase faults that a probability histogram hides completely.'
        },
        { kind: 'heading', text: 'What the simulator cannot do' },
        {
          kind: 'table',
          headers: ['Mode', 'What you get', 'When to use it'],
          rows: [
            ['Exact state vector', 'Every amplitude and phase', 'Understanding and debugging — impossible on hardware'],
            ['Sampled measurement', 'Counts, with sampling error', 'Checking what a real device would show'],
            ['Noisy sampled', 'Counts with errors applied, averaged over trajectories', 'Asking whether a circuit would survive a real machine']
          ]
        },
        {
          kind: 'text',
          text: 'And it stops. Past about 24 qubits the state vector cannot be held, and the honest response is a refusal with a size rather than an attempt. Debugging a large circuit therefore means debugging a smaller version of it — which is a real limitation and worth knowing before you need it.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Repair both broken circuits',
          does:
            'Build the broken Bell state exactly as written and confirm the output is a product state. Fix it. Then build H, Z, Z, H, confirm it gives 0, and work out the one-gate change that makes it give 1. Use the timeline to see the state at each step.'
        },
        { kind: 'check', questionId: 'q7l3q1' },
        { kind: 'check', questionId: 'q7l3q2' },
        { kind: 'check', questionId: 'q7l3q3' }
      ],
      questions: [
        {
          id: 'q7l3q1',
          kind: 'choice',
          concept: 'quantum-debugging',
          prompt: 'A circuit meant to build a Bell state produces |00⟩ and |10⟩ half each. What is wrong?',
          difficulty: 'advanced',
          options: [
            'The Hadamard is on the wrong qubit',
            'The CNOT came before the Hadamard, so it acted on |00⟩ and did nothing',
            'A measurement is missing',
            'The register is too small'
          ],
          answer: 1,
          explanation:
            'Those outcomes are q0 in superposition and q1 untouched — a product state. A CNOT applied before the superposition exists has nothing to correlate, so the order is the fault.',
          hints: ['What does a CNOT do when its control is definitely 0?']
        },
        {
          id: 'q7l3q2',
          kind: 'choice',
          concept: 'quantum-debugging',
          prompt: 'Which debugging technique catches a phase fault that the probability histogram hides?',
          difficulty: 'advanced',
          options: [
            'Taking more shots',
            'Appending the inverse of the circuit and checking it returns to |00…0⟩',
            'Adding more qubits',
            'Measuring in the same basis again'
          ],
          answer: 1,
          explanation:
            'A phase fault leaves the probabilities looking right. Running forwards then backwards must return exactly to the start, and any deviation reveals a disagreement the histogram cannot show.',
          hints: ['What test uses the circuit against itself?']
        },
        {
          id: 'q7l3q3',
          kind: 'choice',
          concept: 'simulation-limits',
          prompt: 'What should a simulator do when asked for 40 qubits?',
          difficulty: 'intermediate',
          options: [
            'Approximate the answer',
            'Refuse, saying how much memory the state vector would need and what the limit is',
            'Run slowly',
            'Reduce the circuit automatically'
          ],
          answer: 1,
          explanation:
            'Refuse with the figure. 40 qubits is about 17 terabytes for the state vector, so there is no slow-but-possible path — and a simulator that approximates silently would be reporting numbers nobody could trust.',
          hints: ['Work out the memory and ask whether "slowly" is even an option.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q7l4',
      title: 'Interference',
      intro:
        'The mechanism every quantum algorithm uses. Amplitudes can cancel, and arranging for the wrong answers to cancel is what an algorithm is.',
      objectives: [
        'Explain constructive and destructive interference in terms of amplitudes',
        'Trace the cancellation in a two-path circuit',
        'Say in one sentence what a quantum algorithm has to achieve'
      ],
      concepts: ['interference', 'constructive-destructive'],
      requires: ['relative-phase', 'hadamard'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Probabilities can only add. Amplitudes can add **or cancel**, because they can be negative or complex — and that is the single property that separates quantum computation from classical probability.'
        },
        { kind: 'heading', text: 'The two-path picture' },
        {
          kind: 'example',
          title: 'Reinforcement and cancellation',
          text: 'Two paths both arriving at outcome |0⟩, each with amplitude 1/√2:\n\n  Same sign:      1/√2 + 1/√2 = √2 → after normalising, probability 1\n  Opposite sign:  1/√2 − 1/√2 = 0  → probability 0, exactly\n\nClassically, two routes to the same outcome can only make it more likely. Here one route can cancel another completely.'
        },
        {
          kind: 'text',
          text: 'That is the H-H and H-Z-H pair from Unit 02, now in the language that generalises. The first Hadamard creates two paths; the second brings them back together. Whether they reinforce or cancel at |0⟩ depends entirely on the relative phase between them — and the Z gate in the middle is what sets it.'
        },
        {
          kind: 'table',
          headers: ['Circuit', 'Amplitude at |0⟩', 'Amplitude at |1⟩', 'Result'],
          rows: [
            ['H H', '1/2 + 1/2 = 1', '1/2 − 1/2 = 0', '0 every time'],
            ['H Z H', '1/2 − 1/2 = 0', '1/2 + 1/2 = 1', '1 every time']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Work those four sums through by hand once. They are the smallest complete example of a quantum algorithm: paths created, a phase applied, paths recombined, and an answer that is certain where either path alone would have given fifty-fifty.'
        },
        { kind: 'heading', text: 'What an algorithm has to do' },
        {
          kind: 'text',
          text: 'Here is the sentence the rest of the course elaborates. A quantum algorithm puts the register into a superposition over many possibilities, applies an operation that writes problem-dependent **phases** onto those possibilities, and then arranges an interference step so that the amplitudes of the wrong answers cancel and the amplitude of the right answer survives.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Prepare** — Hadamards, usually, to put every possibility into play with equal amplitude.',
            '**Mark** — an oracle applies a phase that depends on the problem.',
            '**Interfere** — more gates, arranged so the marked amplitude grows and the rest shrink.',
            '**Measure** — once, and read a result that is probably the answer.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Note what is absent from that list: any step where many answers are read. The superposition is never inspected. The whole difficulty of designing a quantum algorithm is that you get one measurement, so the interference has to have done the work beforehand — which is why "tries every answer at once" is not merely imprecise but describes a machine that would not need algorithms at all.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Make interference happen, and then stop it',
          does:
            'Build H, Z, H and confirm the answer is 1 with certainty. Now insert a measurement between the first H and the Z, and run again: the certainty is gone and the answer is fifty-fifty. The measurement destroyed the second path, and with it the interference. That is the whole fragility of the subject in one experiment.'
        },
        { kind: 'check', questionId: 'q7l4q1' },
        { kind: 'check', questionId: 'q7l4q2' },
        { kind: 'check', questionId: 'q7l4q3' }
      ],
      questions: [
        {
          id: 'q7l4q1',
          kind: 'choice',
          concept: 'constructive-destructive',
          prompt: 'Two paths reach an outcome with amplitudes +1/√2 and −1/√2. What is the probability of that outcome?',
          difficulty: 'intermediate',
          options: ['1', '0.5', '0', 'It depends on the measurement'],
          answer: 2,
          explanation:
            'The amplitudes add to exactly zero, so the probability is zero. Two routes to an outcome made it impossible — which classical probability cannot do.',
          hints: ['Add the amplitudes first, then square.']
        },
        {
          id: 'q7l4q2',
          kind: 'choice',
          concept: 'interference',
          prompt: 'A measurement is inserted in the middle of H-Z-H. Why does the final certainty disappear?',
          difficulty: 'advanced',
          options: [
            'Because measurement is noisy',
            'Because the measurement collapses the superposition, so only one path survives and there is nothing left to interfere',
            'Because the Z gate stops working',
            'Because the second Hadamard is now redundant'
          ],
          answer: 1,
          explanation:
            'Interference needs both paths present. Measuring picks one, and a single path cannot cancel anything — so the final Hadamard spreads it evenly instead of recombining two amplitudes.',
          hints: ['How many paths are left after the measurement?']
        },
        {
          id: 'q7l4q3',
          kind: 'short',
          concept: 'interference',
          prompt: 'In one sentence: what does a quantum algorithm have to arrange?',
          difficulty: 'advanced',
          answer: 'that the amplitudes of the wrong answers cancel and the right one survives',
          accepts: [
            'interference so wrong answers cancel',
            'cancellation of the wrong answers',
            'the wrong answers interfere destructively',
            'phases that make the right answer likely'
          ],
          explanation:
            'Prepare, mark with phases, interfere so the wrong amplitudes cancel, measure once. The superposition is never read, which is why cancellation has to do the work.',
          hints: ['You get one measurement. What has to have happened before it?']
        }
      ]
    }
  ]
}
