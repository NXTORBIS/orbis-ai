import type { Module } from '../../types.ts'

/**
 * Unit 05 — More than one qubit.
 *
 * Tensor products before anything else, because every later confusion about entanglement is really a confusion
 * about how two systems combine. Then CNOT — taught as acting on the branches of a superposition rather than as
 * a classical "if", which is the single most important correction in the unit.
 *
 * The exponential-growth lesson is placed here rather than in a complexity unit, because the learner is about to
 * meet the simulator's limit and should understand it as a fact about state space rather than a defect.
 */
export const Q_UNIT_5: Module = {
  id: 'q5',
  title: 'More Than One Qubit',
  summary:
    'Tensor products, the four basis states of two qubits, product states, the CNOT gate, controlled operations that are not classical conditionals, and why the description doubles with every qubit.',
  concepts: [
    'tensor-product',
    'multi-qubit-states',
    'exponential-growth',
    'product-states',
    'cnot',
    'controlled-gates',
    'classical-control',
    'simulation-limits'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q5l1',
      title: 'Tensor products and the two-qubit state space',
      intro:
        'How two quantum systems become one. The mathematics is a rule for combining vectors, and getting it straight now prevents every later muddle about entanglement.',
      objectives: [
        'Compute a tensor product of two single-qubit states',
        'Write a general two-qubit state and say how many amplitudes it has',
        'Read the basis-state labelling convention used throughout the course'
      ],
      concepts: ['tensor-product', 'multi-qubit-states', 'exponential-growth'],
      requires: ['ket-notation', 'amplitudes'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Two qubits side by side have four possible basis states, written |00⟩, |01⟩, |10⟩ and |11⟩. The operation that builds the combined state space from the two single ones is the **tensor product**, written ⊗.'
        },
        { kind: 'formula', latex: '|0\\rangle \\otimes |1\\rangle = |01\\rangle \\qquad \\begin{bmatrix} a \\\\ b \\end{bmatrix} \\otimes \\begin{bmatrix} c \\\\ d \\end{bmatrix} = \\begin{bmatrix} ac \\\\ ad \\\\ bc \\\\ bd \\end{bmatrix}', caption: 'Multiply every component of the first by every component of the second. Two amplitudes and two amplitudes give four — which is why the state space grows multiplicatively rather than additively.' },
        {
          kind: 'example',
          title: 'Computed',
          text: '|+⟩ ⊗ |0⟩  where |+⟩ = (|0⟩ + |1⟩)/√2\n\n  = (1/√2)(|0⟩ + |1⟩) ⊗ |0⟩\n  = (1/√2)(|00⟩ + |10⟩)\n\nAmplitudes: |00⟩ 0.707, |01⟩ 0, |10⟩ 0.707, |11⟩ 0.\n\nRead it as: the first qubit is in superposition, the second is definitely 0.'
        },
        { kind: 'heading', text: 'The general state' },
        { kind: 'formula', latex: '|\\psi\\rangle = \\alpha|00\\rangle + \\beta|01\\rangle + \\gamma|10\\rangle + \\delta|11\\rangle, \\qquad |\\alpha|^2+|\\beta|^2+|\\gamma|^2+|\\delta|^2 = 1', caption: 'Four complex amplitudes, one normalisation condition. Each amplitude belongs to one basis state, and its magnitude squared is the probability of that outcome.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The convention in this course and in the Quantum Studio: in |q₁q₀⟩ the **rightmost** digit is qubit 0. So |10⟩ means qubit 1 is in state 1 and qubit 0 is in state 0. Every convention is defensible and mixing two of them silently produces circuits that are wrong in ways no test catches — so it is written down here and used consistently.'
        },
        { kind: 'heading', text: 'Three qubits, and then n' },
        {
          kind: 'table',
          headers: ['Qubits', 'Basis states', 'Amplitudes', 'Memory at 16 bytes each'],
          rows: [
            ['1', '|0⟩, |1⟩', '2', '32 bytes'],
            ['2', '|00⟩ … |11⟩', '4', '64 bytes'],
            ['3', '|000⟩ … |111⟩', '8', '128 bytes'],
            ['10', '…', '1,024', '16 KB'],
            ['20', '…', '1,048,576', '16 MB'],
            ['24', '…', '16,777,216', '268 MB'],
            ['50', '…', '~10¹⁵', 'About 18 petabytes']
          ]
        },
        {
          kind: 'text',
          text: 'This is the simulation argument from Unit 01, now as a fact about the course itself: the Quantum Studio stops at 24 qubits and refuses beyond it with a size rather than attempting it. That refusal is the honest behaviour, and the limit is the same one that makes quantum simulation hard classically.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Watch the state space grow',
          does:
            'Set the register to 2 qubits and look at the state table — four rows. Then 3, then 5, then 10, noting the amplitude count and the state-vector size each time. Then ask for 30 and read the refusal.'
        },
        { kind: 'check', questionId: 'q5l1q1' },
        { kind: 'check', questionId: 'q5l1q2' },
        { kind: 'check', questionId: 'q5l1q3' }
      ],
      questions: [
        {
          id: 'q5l1q1',
          kind: 'number',
          concept: 'multi-qubit-states',
          prompt: 'How many complex amplitudes describe the state of 6 qubits?',
          difficulty: 'beginner',
          answer: 64,
          tolerance: 0.5,
          explanation: '2⁶ = 64. One amplitude per basis state, and there are 2ⁿ basis states.',
          hints: ['Two to the power of the number of qubits.']
        },
        {
          id: 'q5l1q2',
          kind: 'choice',
          concept: 'tensor-product',
          prompt: 'What is |1⟩ ⊗ |+⟩?',
          difficulty: 'intermediate',
          options: [
            '(|00⟩ + |01⟩)/√2',
            '(|10⟩ + |11⟩)/√2',
            '(|01⟩ + |10⟩)/√2',
            '(|00⟩ + |11⟩)/√2'
          ],
          answer: 1,
          explanation:
            'The first qubit is definitely 1 and the second is an equal superposition, so both basis states have the first digit 1: (|10⟩ + |11⟩)/√2. Options three and four are entangled states, which no tensor product can produce.',
          hints: ['The first qubit is certain. Which basis states are therefore impossible?']
        },
        {
          id: 'q5l1q3',
          kind: 'choice',
          concept: 'exponential-growth',
          prompt: 'Why does a simulator refuse beyond around 24 qubits rather than running slowly?',
          difficulty: 'intermediate',
          options: [
            'Because the mathematics breaks down',
            'Because the state vector needs 2ⁿ amplitudes — 24 qubits is already 268 MB, and 30 would be 17 GB',
            'Because gates become non-unitary',
            'Because measurement becomes impossible'
          ],
          answer: 1,
          explanation:
            'Memory, doubling with each qubit. Nothing about the mathematics changes; the description simply becomes too large to hold, which is the same fact that motivated the field.',
          hints: ['Look at the memory column of the table.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q5l2',
      title: 'Product states, and the CNOT gate',
      intro:
        'Some two-qubit states are just two qubits. The gate that produces the others is CNOT — and it is not an "if" statement.',
      objectives: [
        'Recognise a product state and say what it means',
        'Say what CNOT does on basis states and on superpositions',
        'Explain why "controlled" does not mean a classical conditional'
      ],
      concepts: ['product-states', 'cnot', 'controlled-gates'],
      requires: ['multi-qubit-states', 'pauli-gates'],
      minutes: 17,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **product state** is one that can be written as a tensor product: each qubit has its own state, and the two are simply next to each other. |00⟩, |+⟩⊗|1⟩, |−⟩⊗|+⟩ are all product states. Everything you can say about such a system you can say about the two qubits separately.'
        },
        { kind: 'heading', text: 'CNOT' },
        {
          kind: 'text',
          text: 'The **controlled-NOT** gate takes two qubits: a control and a target. On basis states it flips the target when the control is 1.'
        },
        {
          kind: 'table',
          headers: ['Input |control, target⟩', 'Output'],
          rows: [
            ['|00⟩', '|00⟩'],
            ['|01⟩', '|01⟩'],
            ['|10⟩', '|11⟩'],
            ['|11⟩', '|10⟩']
          ]
        },
        {
          kind: 'text',
          text: 'Note that it is reversible — four distinct inputs, four distinct outputs — and that it is exactly the reversible XOR from Unit 01: `(a, b) → (a, a ⊕ b)`.'
        },
        { kind: 'heading', text: 'And now on a superposition' },
        {
          kind: 'example',
          title: 'The whole point of the gate',
          text: 'Start: |+⟩ ⊗ |0⟩  =  (|00⟩ + |10⟩)/√2\n\nApply CNOT, control 0, target 1. Act on each term:\n\n  |00⟩ → |00⟩      (control is 0, nothing happens)\n  |10⟩ → |11⟩      (control is 1, the target flips)\n\nResult: (|00⟩ + |11⟩)/√2\n\nThat state cannot be written as a product of two single-qubit states. It is entangled — and that is Unit 06.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is where the classical reading fails. "If the control is 1, flip the target" presupposes that the control *is* something. In a superposition it is not: the gate acts on **every branch of the state at once**, flipping the target in the branches where the control is 1 and leaving it alone in the others. The result is a state in which the two qubits are correlated and neither has a value of its own. A classical conditional can never produce that.'
        },
        { kind: 'heading', text: 'Other controlled gates' },
        {
          kind: 'table',
          headers: ['Gate', 'What it does', 'Symmetric in its two qubits?'],
          rows: [
            ['CNOT (CX)', 'Applies X to the target in the branches where the control is 1', 'No'],
            ['CZ', 'Multiplies the |11⟩ amplitude by −1', 'Yes — remarkably'],
            ['CP(θ)', 'Multiplies the |11⟩ amplitude by e^{iθ}', 'Yes'],
            ['SWAP', 'Exchanges the two qubits', 'Yes'],
            ['Toffoli (CCX)', 'Flips the target where both controls are 1', 'In its two controls']
          ]
        },
        {
          kind: 'text',
          text: 'CZ being symmetric is worth a moment: it acts only on the |11⟩ amplitude, and "both are 1" does not distinguish which qubit you call the control. This is why the Fourier transform circuit in Unit 12 can be drawn with its controlled phases either way round.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'CNOT on a basis state, then on a superposition',
          does:
            'Apply CNOT with control 0 and target 1 to |00⟩ — nothing happens. Apply X to qubit 0 first, then CNOT — both flip. Now apply H to qubit 0 instead and then CNOT, and look at the state: two amplitudes, both 0.707, and the state inspector reporting both qubits as entangled.'
        },
        { kind: 'check', questionId: 'q5l2q1' },
        { kind: 'check', questionId: 'q5l2q2' },
        { kind: 'check', questionId: 'q5l2q3' }
      ],
      questions: [
        {
          id: 'q5l2q1',
          kind: 'choice',
          concept: 'cnot',
          prompt: 'CNOT is applied to (|00⟩ + |10⟩)/√2 with qubit 0 as control. What results?',
          difficulty: 'intermediate',
          options: [
            '(|00⟩ + |10⟩)/√2 — unchanged',
            '(|00⟩ + |11⟩)/√2',
            '(|01⟩ + |11⟩)/√2',
            '|00⟩'
          ],
          answer: 1,
          explanation:
            'Act term by term: |00⟩ has control 0 so is unchanged; |10⟩ has control 1 so the target flips to give |11⟩. The result is a Bell state, and it cannot be factored into two single-qubit states.',
          hints: ['Apply the truth table to each basis state in the superposition separately.']
        },
        {
          id: 'q5l2q2',
          kind: 'choice',
          concept: 'cnot',
          prompt: 'Why is "if the control is 1, flip the target" a misleading description of CNOT?',
          difficulty: 'advanced',
          options: [
            'Because CNOT does not involve the control at all',
            'Because in a superposition the control does not have a value — the gate acts on all branches at once, which is how entanglement is produced',
            'Because the control and target are interchangeable',
            'Because CNOT is not reversible'
          ],
          answer: 1,
          explanation:
            'The classical reading assumes the control has a definite value. When it does not, the gate acts on every branch, and the output is a correlated state in which neither qubit has a value — something a conditional cannot produce.',
          hints: ['What does the description assume about the control before the gate?']
        },
        {
          id: 'q5l2q3',
          kind: 'true-false',
          concept: 'product-states',
          prompt: 'Every two-qubit state can be written as a tensor product of two single-qubit states.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'The ones that can are product states. (|00⟩ + |11⟩)/√2 cannot be written that way at all, which is the definition of entangled — and the next unit is about exactly those.',
          hints: ['Try to factor (|00⟩ + |11⟩)/√2 and see where it fails.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q5l3',
      title: 'Classical control, and three kinds of "if"',
      intro:
        'Measurement produces a classical bit, and a circuit can act on it. That is a third thing, distinct from both superposition and a controlled gate.',
      objectives: [
        'Distinguish a controlled quantum gate from a classically controlled operation',
        'Say when each is appropriate',
        'Explain why the distinction matters for teleportation'
      ],
      concepts: ['classical-control'],
      requires: ['controlled-gates', 'collapse'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Three things are easy to confuse, and they behave completely differently.'
        },
        {
          kind: 'table',
          headers: ['', 'What it is', 'Produces entanglement?', 'Reversible?'],
          rows: [
            ['Superposition', 'One qubit in a combination of basis states', 'No, on its own', 'Yes'],
            ['Controlled gate', 'A gate applied in the branches where a control qubit is 1', 'Yes', 'Yes'],
            ['Classical control', 'A gate applied because a measured bit came out 1', 'No', 'No — a measurement happened']
          ]
        },
        { kind: 'heading', text: 'Classical control, concretely' },
        {
          kind: 'example',
          title: 'Two circuits that look alike and are not',
          text: 'A — controlled quantum gate:\n  H on q0\n  CNOT q0 → q1\n  Result: (|00⟩ + |11⟩)/√2, entangled, reversible\n\nB — classical control:\n  H on q0\n  measure q0 into bit c\n  if c == 1, apply X to q1\n  Result: either |00⟩ or |11⟩, one of them, chosen at random\n\nMeasure both qubits in either circuit and the counts are identical: half |00⟩, half |11⟩. In A the state is a superposition; in B it is a classical mixture. The Hadamard test from Unit 03 tells them apart.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That pair is worth remembering as the general lesson: identical measurement statistics do not mean the same state. A circuit and its measure-then-act imitation produce the same histogram and behave differently under any further gate — which is the whole reason a quantum computer can do anything a classical one cannot.'
        },
        { kind: 'heading', text: 'Where classical control is genuinely needed' },
        {
          kind: 'text',
          text: 'Teleportation, in Unit 09: the sender measures and transmits two classical bits, and the receiver applies corrections depending on what those bits were. That cannot be a controlled gate — the two parties are separated, and what travels between them is classical information.'
        },
        {
          kind: 'text',
          text: 'Error correction, in Unit 15: the syndrome is measured, and which correction to apply depends on the result. Again classical: a bit is read, and the circuit branches on it.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'And this is why the Quantum Studio refuses to invert a circuit containing a measurement, with that reason stated. A classically controlled operation cannot be undone, because the measurement that chose it cannot be undone. Gates are reversible; the circuit as a whole stops being so the moment one measurement is in it.'
        },
        { kind: 'check', questionId: 'q5l3q1' },
        { kind: 'check', questionId: 'q5l3q2' }
      ],
      questions: [
        {
          id: 'q5l3q1',
          kind: 'choice',
          concept: 'classical-control',
          prompt: 'Circuit A uses H then CNOT. Circuit B uses H, then measures, then applies X if the result was 1. How do they differ?',
          difficulty: 'advanced',
          options: [
            'They are equivalent',
            'A produces an entangled superposition; B produces a classical mixture of |00⟩ and |11⟩ — the same histogram, different states, distinguishable by a later gate',
            'B is faster',
            'A cannot be built on hardware'
          ],
          answer: 1,
          explanation:
            'The measurement in B destroys the superposition, leaving a mixture. The counts match and the states do not: apply Hadamards to both qubits afterwards and they behave completely differently.',
          hints: ['What did the measurement in B do to the state?']
        },
        {
          id: 'q5l3q2',
          kind: 'choice',
          concept: 'classical-control',
          prompt: 'Why can the corrections in teleportation not be replaced by controlled gates?',
          difficulty: 'advanced',
          options: [
            'Controlled gates are too slow',
            'Because the two parties are separated and what travels between them is a classical measurement result — the correction depends on a bit, not on a qubit',
            'Because teleportation uses no gates',
            'They can be, and usually are'
          ],
          answer: 1,
          explanation:
            'The sender has measured; what they can send is two classical bits. The receiver acts on those bits. That is classical control by construction, and it is why teleportation requires classical communication and sends nothing faster than light.',
          hints: ['What does the receiver actually have in hand?']
        }
      ]
    }
  ]
}
