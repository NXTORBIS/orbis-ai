import type { Module } from '../../types.ts'

/**
 * Unit 11 — The Fourier transform and phase estimation.
 *
 * The hardest mathematics in the course, and the place where a careless treatment does the most damage. The QFT
 * is introduced as a change of basis that makes periodicity visible, with every symbol in the formula named;
 * the circuit is built from gates the learner already has; and phase estimation is presented as the thing the
 * QFT is actually *for*, which is how the next unit becomes comprehensible.
 */
export const Q_UNIT_11: Module = {
  id: 'q11',
  title: 'The Fourier Transform and Phase Estimation',
  summary:
    'What the quantum Fourier transform does, how it is built from Hadamards and controlled phases, how to invert it, and how phase estimation reads an eigenvalue into a register of counting qubits.',
  concepts: ['qft', 'qft-circuit', 'inverse-qft', 'approximate-qft', 'phase-estimation', 'estimation-precision', 'observables', 'expectation-values'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q11l1',
      title: 'Observables, eigenstates and expectation values',
      intro:
        'Three pieces of vocabulary needed before phase estimation makes sense, taught through measurements already familiar.',
      objectives: [
        'Say what an observable is and what its eigenvalues mean',
        'Recognise an eigenstate as a state with a certain outcome',
        'Compute an expectation value and say what it is for'
      ],
      concepts: ['observables', 'expectation-values'],
      requires: ['measurement', 'density-matrix'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'An **observable** is something you can measure, represented by a matrix. Its **eigenvalues** are the possible outcomes, and its **eigenstates** are the states for which the outcome is certain.'
        },
        {
          kind: 'example',
          title: 'Z as an observable',
          text: 'Z|0⟩ = +1·|0⟩     eigenvalue +1, eigenstate |0⟩\nZ|1⟩ = −1·|1⟩     eigenvalue −1, eigenstate |1⟩\n\nSo "measuring Z" means asking a question whose answers are +1 and −1, and whose certain cases are |0⟩ and |1⟩. A computational-basis measurement *is* a Z measurement, relabelled from ±1 to 0 and 1.'
        },
        {
          kind: 'table',
          headers: ['Observable', 'Eigenstates', 'Eigenvalues', 'Measured by'],
          rows: [
            ['Z', '|0⟩, |1⟩', '+1, −1', 'Measuring directly'],
            ['X', '|+⟩, |−⟩', '+1, −1', 'H, then measure'],
            ['Y', '|+i⟩, |−i⟩', '+1, −1', 'S†, H, then measure']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The pattern is worth stating: measuring an observable means measuring in its eigenbasis, which means applying the gate that rotates its eigenstates onto |0⟩ and |1⟩. The three bases of Unit 03 were three observables all along.'
        },
        { kind: 'heading', text: 'Expectation values' },
        {
          kind: 'text',
          text: 'An **expectation value** is the average outcome over many measurements. It is what an experiment reports, and it is the quantity every variational algorithm minimises.'
        },
        { kind: 'formula', latex: '\\langle Z \\rangle = \\langle\\psi|Z|\\psi\\rangle = P(0) \\cdot (+1) + P(1) \\cdot (-1)', caption: 'The bra-ket ⟨ψ|Z|ψ⟩ is the expectation of Z in the state ψ. For a qubit it works out as the probability-weighted average of the two eigenvalues, which is the same quantity the Bloch sphere calls the z coordinate.' },
        {
          kind: 'table',
          headers: ['State', '⟨Z⟩', '⟨X⟩', 'Where on the Bloch sphere'],
          rows: [
            ['|0⟩', '+1', '0', 'North pole'],
            ['|1⟩', '−1', '0', 'South pole'],
            ['|+⟩', '0', '+1', 'Equator, +x'],
            ['|−⟩', '0', '−1', 'Equator, −x'],
            ['Half a Bell pair', '0', '0', 'The centre — no pure state of its own']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That last row ties the unit to Unit 06. The Bloch coordinates **are** the expectation values of X, Y and Z, which is why an entangled qubit sits at the centre: all three averages are zero. The picture and the algebra are the same thing.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Read expectation values off the sphere',
          does:
            'Prepare |0⟩, |+⟩ and a Ry-rotated state, and read ⟨X⟩, ⟨Y⟩ and ⟨Z⟩ from the Bloch bench each time. Check them against the probabilities in the state table — the z value is P(0) − P(1), exactly.'
        },
        { kind: 'check', questionId: 'q11l1q1' },
        { kind: 'check', questionId: 'q11l1q2' }
      ],
      questions: [
        {
          id: 'q11l1q1',
          kind: 'choice',
          concept: 'observables',
          prompt: 'What is an eigenstate of an observable?',
          difficulty: 'advanced',
          options: [
            'A state that cannot be measured',
            'A state for which the measurement outcome is certain, and equal to the corresponding eigenvalue',
            'A state with equal probabilities',
            'The ground state of the system'
          ],
          answer: 1,
          explanation:
            'Certainty. |0⟩ is an eigenstate of Z with eigenvalue +1, so a Z measurement on it always gives +1. States that are not eigenstates give a distribution over the eigenvalues.',
          hints: ['Which states give the same answer every time?']
        },
        {
          id: 'q11l1q2',
          kind: 'number',
          concept: 'expectation-values',
          prompt: 'A qubit has P(0) = 0.75 and P(1) = 0.25. What is ⟨Z⟩?',
          difficulty: 'advanced',
          answer: 0.5,
          tolerance: 0.01,
          explanation: '0.75(+1) + 0.25(−1) = 0.5. And that is also the z coordinate of the state on the Bloch sphere.',
          hints: ['Weight the eigenvalues +1 and −1 by their probabilities.']
        },
        {
          id: 'q11l1q3',
          kind: 'choice',
          concept: 'expectation-values',
          prompt: 'Why does half of a Bell pair have ⟨X⟩ = ⟨Y⟩ = ⟨Z⟩ = 0?',
          difficulty: 'advanced',
          options: [
            'Because it has been measured',
            'Because it is completely mixed — every measurement on it alone is fifty-fifty, so every average is zero',
            'Because it is in |0⟩',
            'Because expectation values are always zero for entangled states'
          ],
          answer: 1,
          explanation:
            'Completely mixed means fifty-fifty in every basis, so every average of ±1 outcomes is zero. That is the same fact as the Bloch vector having length zero.',
          hints: ['What did the partial trace give for that qubit?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q11l2',
      title: 'The quantum Fourier transform',
      intro:
        'A change of basis that turns periodicity into position. Every symbol in the formula is named, and the circuit is built from gates you already have.',
      objectives: [
        'Say what the QFT does, in terms of what it makes visible',
        'Read the transform formula with every symbol understood',
        'Build the circuit and say what each gate contributes'
      ],
      concepts: ['qft', 'qft-circuit', 'inverse-qft', 'approximate-qft'],
      requires: ['interference', 'multi-qubit-states', 'phase-gates'],
      minutes: 19,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A Fourier transform re-describes something in terms of frequencies rather than positions. A signal that repeats every 7 steps looks like noise in a list of values and like a single clear spike in its transform. Periodicity that was hidden becomes a position you can read off.'
        },
        {
          kind: 'text',
          text: 'The quantum Fourier transform does the same thing to the amplitudes of a quantum state. A state whose amplitudes repeat with some period transforms into a state whose amplitude is concentrated at positions related to that period — and concentration is exactly what makes something measurable.'
        },
        { kind: 'heading', text: 'The formula, symbol by symbol' },
        { kind: 'formula', latex: '|x\\rangle \\;\\longrightarrow\\; \\frac{1}{\\sqrt{N}}\\sum_{y=0}^{N-1} e^{2\\pi i x y / N}\\,|y\\rangle', caption: 'N = 2ⁿ is the number of basis states for n qubits. x is the basis state going in, and y runs over every basis state coming out. The 1/√N keeps it normalised. The exponential is a pure phase — a point on the unit circle — and the angle depends on the product of x and y, which is what makes the transform pick out periodic structure.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The one thing to take from that formula: the transform of a single basis state is a spread over **all** of them, with a particular pattern of phases. The pattern is the information. Which is why a QFT applied to |0⟩ gives a flat superposition with every phase equal — the least interesting pattern there is.'
        },
        { kind: 'heading', text: 'The circuit' },
        {
          kind: 'text',
          text: 'Built from two kinds of gate, both already familiar.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'For each qubit, from the most significant down: apply a **Hadamard**.',
            'Then apply **controlled phase** rotations from each less significant qubit onto it, with angle π/2, π/4, π/8 and so on — halving with distance.',
            'At the end, **reverse the order of the qubits** with SWAP gates.'
          ]
        },
        {
          kind: 'example',
          title: 'Three qubits, written out',
          text: 'H on q2\nCP(π/2) between q1 and q2\nCP(π/4) between q0 and q2\n\nH on q1\nCP(π/2) between q0 and q1\n\nH on q0\n\nSWAP q0 and q2\n\nSix gates and a swap. For n qubits it is about n²/2 gates — which is itself remarkable: the classical fast Fourier transform on 2ⁿ numbers takes about n·2ⁿ operations.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And here is the catch that must be said. The QFT is exponentially faster than the classical FFT at transforming **amplitudes**, and you cannot read the amplitudes. One measurement gives one outcome. So the QFT is never used to "transform data quickly" — it is used inside an algorithm where the only thing needed is a single measurement of the transformed state. Phase estimation is the canonical example, and it is the next lesson.'
        },
        { kind: 'heading', text: 'The inverse' },
        {
          kind: 'text',
          text: 'Reverse the order of the operations and negate every phase angle, and you have the inverse transform. Applying the transform and then its inverse returns the state exactly — which is the standard way to check an implementation, and one the Quantum Studio can do in two clicks.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Transform, then undo it',
          does:
            'Load the Fourier transform preset on three qubits and look at the state: a flat spread with equal phases. Then load the transform-then-inverse preset and confirm you are back at |000⟩ exactly. Finally prepare a non-trivial input first and repeat.'
        },
        { kind: 'check', questionId: 'q11l2q1' },
        { kind: 'check', questionId: 'q11l2q2' },
        { kind: 'check', questionId: 'q11l2q3' }
      ],
      questions: [
        {
          id: 'q11l2q1',
          kind: 'choice',
          concept: 'qft',
          prompt: 'What does the quantum Fourier transform make visible?',
          difficulty: 'advanced',
          options: [
            'The value of every amplitude at once',
            'Periodic structure — a state whose amplitudes repeat transforms into one with amplitude concentrated at positions related to the period',
            'The phase of the whole state',
            'Which qubits are entangled'
          ],
          answer: 1,
          explanation:
            'Periodicity becomes position, and position is measurable. That is the entire reason it appears in Shor: factoring is turned into period finding, and the QFT is what makes a period readable.',
          hints: ['What does a Fourier transform do to a repeating signal?']
        },
        {
          id: 'q11l2q2',
          kind: 'choice',
          concept: 'qft',
          prompt: 'The QFT is exponentially faster than the classical FFT. Why does that not give a practical way to transform data?',
          difficulty: 'advanced',
          options: [
            'It is not actually faster',
            'Because the result is in the amplitudes, which cannot be read — one measurement gives one outcome, so only algorithms needing a single measurement of the transformed state benefit',
            'Because the transform is approximate',
            'Because it needs too many qubits'
          ],
          answer: 1,
          explanation:
            'The output is a quantum state. Extracting all of it would need exponentially many measurements, which destroys the advantage — so the QFT is a component inside algorithms, never a data-processing service.',
          hints: ['Where does the answer live, and how much of it can you read?']
        },
        {
          id: 'q11l2q3',
          kind: 'choice',
          concept: 'qft-circuit',
          prompt: 'Which gates is the QFT circuit built from?',
          difficulty: 'advanced',
          options: [
            'Only Hadamards',
            'Hadamards and controlled phase rotations, with the qubit order reversed at the end',
            'CNOTs and measurements',
            'Toffoli gates'
          ],
          answer: 1,
          explanation:
            'A Hadamard per qubit, controlled phases with angles halving by distance, then swaps to put the qubits back in order. Nothing in it is new — both gate types were introduced in Units 03 and 05.',
          hints: ['Look at the three-qubit circuit written out.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q11l3',
      title: 'Phase estimation',
      intro:
        'What the Fourier transform is for. Given an operation and one of its eigenstates, read off the phase — to as many digits as you are willing to pay for.',
      objectives: [
        'Describe the phase-estimation circuit',
        'Explain what the counting register is and how precision scales',
        'Say why this is the most reused subroutine in quantum computing'
      ],
      concepts: ['phase-estimation', 'estimation-precision'],
      requires: ['inverse-qft', 'observables'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The setup. There is a unitary operation U and a state |ψ⟩ which is an eigenstate of it, so applying U multiplies the state by a phase: `U|ψ⟩ = e^{2πiφ}|ψ⟩`. You want φ.'
        },
        {
          kind: 'text',
          text: 'A single application tells you nothing: a global phase is unobservable. The trick is to apply U **conditionally**, so that the phase lands on a control qubit rather than on the whole state — which makes it relative rather than global, and therefore measurable.'
        },
        { kind: 'heading', text: 'The circuit' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Prepare a **counting register** of t qubits, all in superposition with Hadamards.',
            'Prepare the eigenstate |ψ⟩ in a separate register.',
            'For each counting qubit k, apply U **2ᵏ times**, controlled on that qubit. The phase accumulated on qubit k is 2ᵏ times φ.',
            'Apply the **inverse** Fourier transform to the counting register.',
            'Measure it. The result, read as a binary fraction, is an estimate of φ.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Step 3 is the clever part and step 4 is the reason the previous lesson existed. The controlled applications write the phase across the counting register as a pattern of relative phases; the inverse transform is exactly the operation that turns such a pattern into a single number. The QFT is here because reading a phase pattern is what it does.'
        },
        { kind: 'heading', text: 'Precision' },
        { kind: 'formula', latex: '\\text{resolution} = \\frac{1}{2^t}', caption: 't is the number of counting qubits. Each one added halves the smallest difference the register can distinguish — so precision is exponential in qubits and linear in the number of controlled operations you can afford.' },
        {
          kind: 'table',
          headers: ['Counting qubits', 'Resolution', 'U applications needed'],
          rows: [
            ['3', '1/8 = 0.125', '7'],
            ['4', '1/16 = 0.0625', '15'],
            ['8', '1/256 ≈ 0.0039', '255'],
            ['16', '≈ 0.0000153', '65,535'],
            ['t', '1/2ᵗ', '2ᵗ − 1']
          ]
        },
        {
          kind: 'text',
          text: 'The right-hand column is the cost, and it is where this becomes expensive. Doubling the precision in bits squares the number of applications of U — which is why phase estimation at useful precision needs deep circuits, and why Shor is so demanding.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'When φ happens to be exactly representable in t bits — 0.25 with four counting qubits, say — the measurement gives it exactly, every time. Otherwise the result is a distribution peaked at the nearest representable value, with some spread. Both behaviours are worth seeing, and the studio shows the whole distribution rather than only the peak.'
        },
        { kind: 'heading', text: 'Why it matters so much' },
        {
          kind: 'table',
          headers: ['Used in', 'What the phase is'],
          rows: [
            ["Shor's algorithm", 'The period of modular exponentiation — Unit 12'],
            ['Quantum counting', 'How many items an oracle marks, which fixes Grover iteration count'],
            ['Energy estimation', 'An eigenvalue of a Hamiltonian — the energy of a quantum system'],
            ['Amplitude estimation', 'How large an amplitude is, generalising Grover'],
            ['Linear systems algorithms', 'Eigenvalues of the matrix being inverted']
          ]
        },
        {
          kind: 'text',
          text: 'That list is why phase estimation, rather than any particular algorithm, is the thing to understand from this half of the course. Most of the exponential-speedup results are phase estimation wearing a different hat.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Estimate a phase, then add precision',
          does:
            'Run phase estimation with a phase of 0.25 and 3 counting qubits — exact, because 0.25 is representable. Then try 0.3 with 3, 5 and 8 qubits, watching the error fall and the distribution narrow. Note the number of controlled operations each one needed.'
        },
        { kind: 'check', questionId: 'q11l3q1' },
        { kind: 'check', questionId: 'q11l3q2' },
        { kind: 'check', questionId: 'q11l3q3' }
      ],
      questions: [
        {
          id: 'q11l3q1',
          kind: 'choice',
          concept: 'phase-estimation',
          prompt: 'Why must U be applied conditionally rather than directly?',
          difficulty: 'advanced',
          options: [
            'To save gates',
            'Because applied directly it would contribute only a global phase, which is unobservable — controlling it makes the phase relative to the control qubit',
            'Because U is not unitary',
            'To avoid measuring the eigenstate'
          ],
          answer: 1,
          explanation:
            'A global phase cannot be measured. Controlling the operation puts the phase on one branch of the control qubit and not the other, which is a relative phase and therefore detectable — the same distinction as Unit 02.',
          hints: ['What kind of phase is unobservable?']
        },
        {
          id: 'q11l3q2',
          kind: 'choice',
          concept: 'estimation-precision',
          prompt: 'You add four counting qubits. What happens to the resolution and to the cost?',
          difficulty: 'advanced',
          options: [
            'Resolution improves fourfold, cost rises fourfold',
            'Resolution improves sixteenfold, and the number of applications of U rises roughly sixteenfold too',
            'Resolution improves sixteenfold at no extra cost',
            'Neither changes'
          ],
          answer: 1,
          explanation:
            'Resolution is 1/2ᵗ, so four more qubits is sixteen times finer. The cost is 2ᵗ − 1 applications, so it grows by the same factor — the precision is bought, not free.',
          hints: ['Both columns of the table are powers of two.']
        },
        {
          id: 'q11l3q3',
          kind: 'choice',
          concept: 'phase-estimation',
          prompt: 'Why is phase estimation more important than any single algorithm built on it?',
          difficulty: 'advanced',
          options: [
            'It is simpler than the algorithms',
            'Because most of the exponential-speedup results — factoring, energy estimation, amplitude estimation, linear systems — are phase estimation applied to a different operator',
            'Because it needs no qubits',
            'Because it is exact'
          ],
          answer: 1,
          explanation:
            'It is the common subroutine. Recognising an algorithm as phase estimation on a particular U is usually the fastest way to understand it, and it is why this lesson matters more than the Shor circuit itself.',
          hints: ['Look at the table of what the phase stands for in each case.']
        }
      ]
    }
  ]
}
