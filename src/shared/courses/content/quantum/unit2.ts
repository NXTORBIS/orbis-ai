import type { Module } from '../../types.ts'

/**
 * Unit 02 — The qubit, properly.
 *
 * Complex numbers first, because amplitudes are complex and a course that postpones that fact has to come back
 * and re-teach superposition later. Then the state, normalisation, the Born rule, and the distinction between
 * global and relative phase — which is the single most important idea in the unit and the one most often skipped.
 *
 * Every equation here names every symbol. An equation nobody can read teaches that the mathematics is somebody
 * else's business, which is the opposite of what this course is for.
 */
export const Q_UNIT_2: Module = {
  id: 'q2',
  title: 'The Qubit',
  summary:
    'Complex numbers, ket notation, amplitudes and why they are not probabilities, normalisation, the Born rule, and the difference between global and relative phase.',
  concepts: [
    'complex-numbers',
    'qubit',
    'ket-notation',
    'amplitudes',
    'normalisation',
    'born-rule',
    'global-phase',
    'relative-phase'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q2l1',
      title: 'Complex numbers, in the half hour you need them',
      intro:
        'Introduced here because the next lesson needs them, not as a detour. Magnitude, phase, and what multiplying by i does — that is the whole of what this course requires.',
      objectives: [
        'Add and multiply complex numbers',
        'Compute a magnitude and a phase',
        'Say what multiplying by a phase factor does geometrically'
      ],
      concepts: ['complex-numbers'],
      requires: [],
      minutes: 15,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A complex number has two parts: `z = a + bi`, where a is the **real** part, b the **imaginary** part, and i is defined by `i² = −1`. There is nothing mystical in it. It is a pair of numbers with a particular rule for multiplying.'
        },
        {
          kind: 'example',
          title: 'Arithmetic',
          text: 'Adding — add the parts:\n  (3 + 2i) + (1 − 5i) = 4 − 3i\n\nMultiplying — expand, and use i² = −1:\n  (1 + 2i)(3 + 4i) = 3 + 4i + 6i + 8i²\n                    = 3 + 10i − 8\n                    = −5 + 10i\n\nAnd the one to remember:\n  i × i = −1'
        },
        { kind: 'heading', text: 'The picture' },
        {
          kind: 'text',
          text: 'Plot the real part along one axis and the imaginary part along the other, and a complex number is a point — or an arrow from the origin. That arrow has a **length** and a **direction**, and those two are the quantities this course actually uses.'
        },
        { kind: 'formula', latex: '|z| = \\sqrt{a^2 + b^2} \\qquad \\arg(z) = \\operatorname{atan2}(b, a)', caption: 'The magnitude |z| is the length of the arrow, by Pythagoras. The argument arg(z) is its angle from the positive real axis — the phase. For 3 + 4i: magnitude 5, phase about 0.93 radians.' },
        { kind: 'heading', text: 'The conjugate, and why magnitude squared is tidy' },
        {
          kind: 'text',
          text: 'The **conjugate** of `a + bi` is `a − bi`: the sign of the imaginary part flipped. Multiply a number by its own conjugate and the imaginary parts cancel exactly: `(a + bi)(a − bi) = a² + b²`, which is the magnitude squared. A real, non-negative number out of a complex one — which is precisely how a complex amplitude becomes a probability.'
        },
        { kind: 'heading', text: 'Pure phases' },
        {
          kind: 'text',
          text: 'The numbers of magnitude exactly 1 sit on a circle, and they are written `e^{iθ}` — a direction with no length. Multiplying by one **rotates** without stretching.'
        },
        { kind: 'formula', latex: 'e^{i\\theta} = \\cos\\theta + i\\sin\\theta', caption: "Euler's formula. At θ = 0 it is 1; at θ = π/2 it is i; at θ = π it is −1; at θ = 3π/2 it is −i. Four quarter turns and you are back where you started." },
        {
          kind: 'table',
          headers: ['Multiply by', 'Effect on the arrow', 'Example'],
          rows: [
            ['1', 'Nothing', '3 + 2i → 3 + 2i'],
            ['i', 'A quarter turn anticlockwise', '1 → i → −1 → −i → 1'],
            ['−1', 'A half turn', '3 + 2i → −3 − 2i'],
            ['e^{iθ}', 'A turn by θ, length unchanged', 'The general case']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Every phase gate in this course multiplies an amplitude by one of these. The S gate multiplies by i, T by e^{iπ/4}, Z by −1. So "what does this gate do?" has a geometric answer: it turns one amplitude without changing its length — which is why a phase gate cannot change any single measurement probability, and can still change everything that happens afterwards.'
        },
        {
          kind: 'lab',
          appId: 'number-lab',
          title: 'Plot a few, and turn them',
          does:
            'Plot 3 + 2i and read off its length and angle. Then multiply by i and plot again, four times over, and watch it come back to where it started. That cycle is what the S gate does to an amplitude.',
          optional: true
        },
        { kind: 'check', questionId: 'q2l1q1' },
        { kind: 'check', questionId: 'q2l1q2' },
        { kind: 'check', questionId: 'q2l1q3' }
      ],
      questions: [
        {
          id: 'q2l1q1',
          kind: 'choice',
          concept: 'complex-numbers',
          prompt: 'What is (2 + i)(1 − 3i)?',
          difficulty: 'intermediate',
          options: ['2 − 3i', '5 − 5i', '−1 − 5i', '2 + 3i'],
          answer: 1,
          explanation: '2 − 6i + i − 3i² = 2 − 5i + 3 = 5 − 5i. The last term flips sign because i² = −1.',
          hints: ['Expand all four products, then replace i² with −1.']
        },
        {
          id: 'q2l1q2',
          kind: 'number',
          concept: 'complex-numbers',
          prompt: 'What is the magnitude of 3 + 4i?',
          difficulty: 'beginner',
          answer: 5,
          tolerance: 0.01,
          explanation: '√(9 + 16) = √25 = 5. Magnitude is the length of the arrow, by Pythagoras.',
          hints: ['Square both parts, add, take the root.']
        },
        {
          id: 'q2l1q3',
          kind: 'choice',
          concept: 'complex-numbers',
          prompt: 'What does multiplying a complex number by e^{iθ} do to it?',
          difficulty: 'intermediate',
          options: [
            'Scales its length by θ',
            'Rotates it by θ, leaving its length unchanged',
            'Adds θ to its real part',
            'Makes it real'
          ],
          answer: 1,
          explanation:
            'A pure phase has magnitude 1, so multiplying by it turns the arrow without stretching it. That is exactly why a phase gate leaves every single measurement probability untouched.',
          hints: ['What is the magnitude of e^{iθ}?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q2l2',
      title: 'The qubit, its notation and its amplitudes',
      intro:
        'The state of a qubit, written down properly. Two complex numbers, one constraint, and a rule for turning them into probabilities.',
      objectives: [
        'Write a qubit state in ket notation and as a vector',
        'Say what the amplitudes are and what they are not',
        'Apply the normalisation condition and the Born rule'
      ],
      concepts: ['qubit', 'ket-notation', 'amplitudes', 'normalisation', 'born-rule'],
      requires: ['complex-numbers', 'classical-bit'],
      minutes: 17,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **qubit** is a two-dimensional quantum state space. It has two distinguished states, written |0⟩ and |1⟩, which form a **basis** — any state of the qubit is a combination of them.'
        },
        { kind: 'formula', latex: '|0\\rangle = \\begin{bmatrix} 1 \\\\ 0 \\end{bmatrix} \\qquad |1\\rangle = \\begin{bmatrix} 0 \\\\ 1 \\end{bmatrix}', caption: 'The two basis states as column vectors. The angled bracket notation — a ket — is shorthand for "a column vector describing a quantum state". The label inside is just a name.' },
        {
          kind: 'callout',
          tone: 'note',
          text: '|0⟩ and |1⟩ are **basis vectors**, not the numbers 0 and 1. They are two perpendicular directions in a two-dimensional space, and the choice of which directions to call 0 and 1 is a convention — a different choice is a different measurement basis, which Unit 03 uses deliberately.'
        },
        { kind: 'heading', text: 'The general state' },
        { kind: 'formula', latex: '|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle = \\begin{bmatrix} \\alpha \\\\ \\beta \\end{bmatrix}', caption: 'ψ (psi) is the usual name for a state. α (alpha) and β (beta) are complex numbers — the probability amplitudes for the two basis states.' },
        {
          kind: 'text',
          text: 'Two complex numbers, so four real numbers in total. That is the whole description of a qubit, and it is already more than a classical bit has: a bit has one of two values, a qubit has a point in a continuum.'
        },
        { kind: 'heading', text: 'Normalisation' },
        { kind: 'formula', latex: '|\\alpha|^2 + |\\beta|^2 = 1', caption: 'The normalisation condition. |α|² means the magnitude squared — a real, non-negative number. The two have to add to exactly 1, because they are the probabilities of the only two possible outcomes.' },
        {
          kind: 'example',
          title: 'Valid and invalid states',
          text: '|0⟩                        1² + 0² = 1              ✓\n(|0⟩ + |1⟩)/√2             (1/√2)² + (1/√2)² = 1     ✓\n0.6|0⟩ + 0.8|1⟩            0.36 + 0.64 = 1           ✓\n(|0⟩ + i|1⟩)/√2            |1/√2|² + |i/√2|² = 1     ✓  (i has magnitude 1)\n0.6|0⟩ + 0.6|1⟩            0.36 + 0.36 = 0.72        ✗  not a state\n|0⟩ + |1⟩                  1 + 1 = 2                 ✗  not normalised'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The last two are not "nearly" states. They are not states. The Quantum Studio reports an unnormalised state as a fault with the number it found rather than quietly rescaling it — because an engine that silently fixes its own arithmetic hides the mistake that caused it.'
        },
        { kind: 'heading', text: 'From amplitude to probability' },
        { kind: 'formula', latex: 'P(0) = |\\alpha|^2 \\qquad P(1) = |\\beta|^2', caption: 'The Born rule. The probability of an outcome is the magnitude squared of its amplitude — not the amplitude.' },
        {
          kind: 'text',
          text: 'The squaring is where probability enters the subject, and it is why amplitudes can be negative or complex while probabilities cannot. An amplitude of −1/√2 gives a probability of 1/2, exactly as +1/√2 does. The two states are **different** — the next lesson shows how to tell them apart — but no single measurement in this basis can distinguish them.'
        },
        {
          kind: 'table',
          headers: ['State', 'α', 'β', 'P(0)', 'P(1)'],
          rows: [
            ['|0⟩', '1', '0', '100%', '0%'],
            ['|1⟩', '0', '1', '0%', '100%'],
            ['(|0⟩ + |1⟩)/√2', '0.707', '0.707', '50%', '50%'],
            ['(|0⟩ − |1⟩)/√2', '0.707', '−0.707', '50%', '50%'],
            ['(|0⟩ + i|1⟩)/√2', '0.707', '0.707i', '50%', '50%'],
            ['0.6|0⟩ + 0.8|1⟩', '0.6', '0.8', '36%', '64%']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Rows three, four and five are the whole point of this unit. Identical probabilities, three different states. Everything the second half of this course does is built on the difference between them, and no measurement in this basis can see it.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Build each of those states',
          does:
            'In the circuit bench: H on qubit 0 gives row three. H then Z gives row four. H then S gives row five. After each one, look at the state table — the probability column is identical and the amplitude and phase columns are not.'
        },
        { kind: 'check', questionId: 'q2l2q1' },
        { kind: 'check', questionId: 'q2l2q2' },
        { kind: 'check', questionId: 'q2l2q3' },
        { kind: 'check', questionId: 'q2l2q4' }
      ],
      questions: [
        {
          id: 'q2l2q1',
          kind: 'choice',
          concept: 'born-rule',
          prompt: 'A qubit is in the state 0.6|0⟩ + 0.8|1⟩. What is the probability of measuring 1?',
          difficulty: 'beginner',
          options: ['80%', '64%', '40%', '50%'],
          answer: 1,
          explanation: 'P(1) = |0.8|² = 0.64. The amplitude is 0.8; the probability is its square. Confusing the two is the commonest arithmetic slip in this subject.',
          hints: ['The Born rule squares the amplitude.']
        },
        {
          id: 'q2l2q2',
          kind: 'true-false',
          concept: 'normalisation',
          prompt: 'The state 0.5|0⟩ + 0.5|1⟩ is a valid qubit state.',
          difficulty: 'beginner',
          answer: false,
          explanation: '0.25 + 0.25 = 0.5, not 1. The probabilities do not add up, so this is not a state at all. The valid equal superposition has amplitudes 1/√2 ≈ 0.707.',
          hints: ['Square both and add.']
        },
        {
          id: 'q2l2q3',
          kind: 'choice',
          concept: 'amplitudes',
          prompt: 'Why can an amplitude be negative when a probability cannot?',
          difficulty: 'intermediate',
          options: [
            'Amplitudes are not physically meaningful',
            'Because the probability is the magnitude squared, so the sign disappears — and the sign still matters for what happens next',
            'Negative amplitudes are not allowed either',
            'Because probabilities are always rounded up'
          ],
          answer: 1,
          explanation:
            'Squaring removes the sign, so −0.707 and +0.707 give the same probability. The sign survives in the state and decides whether later amplitudes reinforce or cancel, which is the mechanism behind every algorithm in this course.',
          hints: ['What happens to a sign when you square?']
        },
        {
          id: 'q2l2q4',
          kind: 'choice',
          concept: 'ket-notation',
          prompt: 'What are |0⟩ and |1⟩?',
          difficulty: 'beginner',
          options: [
            'The numbers 0 and 1 written in a special way',
            'Two perpendicular basis vectors of the qubit state space, labelled 0 and 1 by convention',
            'The two probabilities of a qubit',
            'The amplitudes of a state'
          ],
          answer: 1,
          explanation:
            'Basis vectors — two perpendicular directions in a two-dimensional space. Which directions get called 0 and 1 is a choice, and choosing differently is choosing a different measurement basis.',
          hints: ['Look at the column vectors in the first formula.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q2l3',
      title: 'Global phase and relative phase',
      intro:
        'The distinction the whole second half of this course depends on. One kind of phase is invisible for ever; the other is invisible now and decisive later.',
      objectives: [
        'Explain why a global phase has no observable consequence',
        'Explain why a relative phase does, with the experiment that shows it',
        'Say which states are physically the same and which only look the same'
      ],
      concepts: ['global-phase', 'relative-phase'],
      requires: ['amplitudes', 'born-rule'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Global phase: genuinely nothing' },
        {
          kind: 'text',
          text: 'Multiply an entire state by a phase factor and nothing observable changes, ever, by any experiment.'
        },
        { kind: 'formula', latex: '|\\psi\\rangle \\quad \\text{and} \\quad e^{i\\theta}|\\psi\\rangle \\quad \\text{are the same physical state}', caption: 'Because every probability is a magnitude squared, and |e^{iθ}|² = 1, every outcome probability is unchanged — and that remains true after any sequence of further gates, because a global factor passes straight through them.' },
        {
          kind: 'example',
          title: 'The same state three times',
          text: '   |0⟩\n  −|0⟩\n  i|0⟩\n\nAll three are the state |0⟩. P(0) = 1 in each case, and no gate applied afterwards can separate them, because the factor multiplies everything equally.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is why a simulator is entitled to report a state up to global phase, and why "the answer came out as −|1⟩" is the right answer. It is also why √X applied twice gives |1⟩ in this course rather than exactly |1⟩ with a factor — the factor is not a difference.'
        },
        { kind: 'heading', text: 'Relative phase: everything' },
        {
          kind: 'text',
          text: 'Now change the phase **between** the components rather than of the whole thing.'
        },
        { kind: 'formula', latex: '|+\\rangle = \\frac{|0\\rangle + |1\\rangle}{\\sqrt2} \\qquad |-\\rangle = \\frac{|0\\rangle - |1\\rangle}{\\sqrt2}', caption: 'The same magnitudes, so the same probabilities: 50% each. The second amplitude differs by a factor of −1 relative to the first, and that is not a global factor — it cannot be pulled out of the whole state.' },
        {
          kind: 'table',
          headers: ['', '|+⟩', '|−⟩'],
          rows: [
            ['P(0)', '50%', '50%'],
            ['P(1)', '50%', '50%'],
            ['Measure now', 'Indistinguishable', 'Indistinguishable'],
            ['Apply H, then measure', 'Always 0', 'Always 1'],
            ['Physically the same?', 'No', 'No']
          ]
        },
        { kind: 'heading', text: 'The experiment that proves it' },
        {
          kind: 'text',
          text: 'Apply a Hadamard to |0⟩. You get |+⟩: fifty-fifty. Now apply a Hadamard again and the state returns to |0⟩ exactly — the outcome is 0 every time. The two halves of the superposition recombined and interfered.'
        },
        {
          kind: 'text',
          text: 'Do it again with a Z gate in the middle. H turns |0⟩ into |+⟩; Z turns |+⟩ into |−⟩, which measures identically; the second H now gives |1⟩ **every single time**. The Z changed nothing you could measure at the time and reversed the final answer completely.'
        },
        {
          kind: 'example',
          title: 'Two circuits, four lines',
          text: 'H then H        on |0⟩  →  |0⟩   measured 0, always\nH then Z then H on |0⟩  →  |1⟩   measured 1, always\n\nBetween the gates, after the Z, the state measures 50/50 either way. The difference is invisible in the middle and total at the end.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That pair of circuits is the smallest complete demonstration of interference, and it is the mechanism every algorithm in this course uses. Phase is not bookkeeping: it is the thing the algorithms manipulate, and measurement probabilities are what you are left with once it has done its work.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Run both circuits, and predict first',
          does:
            'Write down what you expect, then build H-H on one qubit and measure 1,000 times. Then insert a Z between them and measure again. Commit to a prediction before each run — that is what turns this from a demonstration into an experiment.'
        },
        { kind: 'check', questionId: 'q2l3q1' },
        { kind: 'check', questionId: 'q2l3q2' },
        { kind: 'check', questionId: 'q2l3q3' }
      ],
      questions: [
        {
          id: 'q2l3q1',
          kind: 'choice',
          concept: 'global-phase',
          prompt: 'Are |ψ⟩ and −|ψ⟩ different physical states?',
          difficulty: 'intermediate',
          options: [
            'Yes — the sign is a real difference',
            'No — a global phase factor changes no probability, now or after any sequence of gates',
            'Only if the state is in superposition',
            'Only after a measurement'
          ],
          answer: 1,
          explanation:
            'A factor multiplying the whole state cancels out of every probability and passes through every subsequent gate. The two are the same state, which is why results are reported up to global phase.',
          hints: ['Can any experiment distinguish them? Try following them through a gate.']
        },
        {
          id: 'q2l3q2',
          kind: 'choice',
          concept: 'relative-phase',
          prompt: 'You apply H, then Z, then H to |0⟩. What does the measurement give?',
          difficulty: 'intermediate',
          options: ['0 half the time', '0 every time', '1 every time', 'It depends on the shot'],
          answer: 2,
          explanation:
            'H Z H |0⟩ = |1⟩, deterministically. The Z flipped the relative phase, so when the second Hadamard recombined the two halves they cancelled where they would otherwise have reinforced — and the answer reversed completely.',
          hints: ['The Z changed |+⟩ into |−⟩. What does H do to |−⟩?']
        },
        {
          id: 'q2l3q3',
          kind: 'choice',
          concept: 'relative-phase',
          prompt: 'Why can a measurement not distinguish |+⟩ from |−⟩?',
          difficulty: 'intermediate',
          options: [
            'Because they are the same state',
            'Because a computational-basis measurement sees only the magnitudes, and the two differ only in the relative sign',
            'Because measurement is random',
            'Because the phase is a global phase'
          ],
          answer: 1,
          explanation:
            'The Born rule squares the magnitudes, which discards the sign. The states are genuinely different — a Hadamard separates them perfectly — but a measurement in this basis cannot see the difference.',
          hints: ['What information does squaring throw away?']
        }
      ]
    }
  ]
}
