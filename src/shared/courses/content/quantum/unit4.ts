import type { Module } from '../../types.ts'

/**
 * Unit 04 — Single-qubit gates and the Bloch sphere.
 *
 * The gates taught as what they do to a state rather than as matrices to memorise, with the Z-gate experiment
 * from Unit 02 revisited now that there is vocabulary for it. Non-commutativity is given a lesson of its own,
 * because "order matters" is usually asserted and almost never demonstrated.
 *
 * The Bloch sphere is taught with its honest limitation stated: it describes one qubit, and the moment a qubit
 * is entangled the arrow shortens because there is no pure state to draw. A course that shows the sphere and
 * hides that is teaching a picture that will mislead in Unit 06.
 */
export const Q_UNIT_4: Module = {
  id: 'q4',
  title: 'Gates and the Bloch Sphere',
  summary:
    'Unitarity, the Pauli gates, phase gates, continuous rotations, composing circuits, the fact that order matters — and one qubit drawn as a point on a sphere.',
  concepts: [
    'unitary',
    'pauli-gates',
    'phase-gates',
    'rotations',
    'gate-composition',
    'non-commutativity',
    'bloch-sphere',
    'circuit-identities'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q4l1',
      title: 'Unitarity, and the Pauli gates',
      intro:
        'What makes an operation a legal quantum gate, and the three that generate everything else.',
      objectives: [
        'State the unitarity condition and say what it guarantees',
        'Say what X, Y and Z do to a state',
        'Explain why Z appears to do nothing and does not'
      ],
      concepts: ['unitary', 'pauli-gates'],
      requires: ['normalisation', 'reversibility'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A quantum gate is a matrix, and not any matrix will do. It has to keep states as states: the probabilities must still add to 1 after it has acted, whatever state it acted on. The condition that guarantees this is called **unitarity**.'
        },
        { kind: 'formula', latex: 'U^{\\dagger}U = I', caption: 'U† (U-dagger) is the conjugate transpose: transpose the matrix and take the complex conjugate of every entry. A matrix whose dagger is its inverse is unitary. The condition is exactly what preserves total probability — and it means every gate has an inverse, which is why Unit 01 spent a lesson on reversibility.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Every gate in the Quantum Studio is tested for this. If a gate were not unitary it would produce states whose probabilities did not add to one, and everything downstream — probabilities, the Bloch sphere, the histogram — would be describing something that is not a quantum state at all.'
        },
        { kind: 'heading', text: 'X — the bit flip' },
        { kind: 'formula', latex: 'X = \\begin{bmatrix} 0 & 1 \\\\ 1 & 0 \\end{bmatrix} \\qquad X|0\\rangle = |1\\rangle, \\quad X|1\\rangle = |0\\rangle', caption: 'X swaps the two amplitudes. On a basis state that looks exactly like a classical NOT — and on a superposition it does something a NOT cannot: it exchanges α and β, whatever they are.' },
        {
          kind: 'example',
          title: 'X is not simply NOT',
          text: 'X(0.6|0⟩ + 0.8|1⟩) = 0.8|0⟩ + 0.6|1⟩\n\nThe probabilities swap: 36%/64% becomes 64%/36%. A classical NOT has nothing to say about this state, because the state does not exist classically.'
        },
        { kind: 'heading', text: 'Z — the phase flip' },
        { kind: 'formula', latex: 'Z = \\begin{bmatrix} 1 & 0 \\\\ 0 & -1 \\end{bmatrix} \\qquad Z|0\\rangle = |0\\rangle, \\quad Z|1\\rangle = -|1\\rangle', caption: 'Z leaves |0⟩ alone and multiplies |1⟩ by −1. On a basis state the result differs only by a global phase, which is to say not at all.' },
        {
          kind: 'text',
          text: 'So Z applied to |0⟩ or |1⟩ changes nothing observable. Applied to a **superposition** it flips the relative phase, which is the difference between |+⟩ and |−⟩ — invisible to an immediate measurement and decisive after the next Hadamard. That is the H-Z-H experiment from Unit 02, and now the gate has a name.'
        },
        { kind: 'heading', text: 'Y — both at once' },
        { kind: 'formula', latex: 'Y = \\begin{bmatrix} 0 & -i \\\\ i & 0 \\end{bmatrix} = iXZ', caption: 'Y is a bit flip and a phase flip together, up to a factor of i. The imaginary entries are why it is the one Pauli gate that cannot be written with real numbers.' },
        {
          kind: 'table',
          headers: ['Gate', 'On |0⟩', 'On |1⟩', 'On a superposition', 'Twice over'],
          rows: [
            ['X', '|1⟩', '|0⟩', 'Swaps the amplitudes', 'Identity'],
            ['Y', 'i|1⟩', '−i|0⟩', 'Swaps and changes phase', 'Identity'],
            ['Z', '|0⟩', '−|1⟩', 'Flips the relative phase', 'Identity'],
            ['H', '|+⟩', '|−⟩', 'Mixes the amplitudes', 'Identity']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Every one of those four is its own inverse, which is unusual and useful. It is also the first family of circuit identities: XX = I, ZZ = I, HH = I. A circuit containing two adjacent X gates can have both removed without changing what it does, which is where circuit simplification begins.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Apply Z, and then apply it where it matters',
          does:
            'Apply Z to |0⟩ and look at the state and the probabilities — nothing has changed in any observable way. Now build H, Z, H and measure: the answer is 1 every time. The same gate, nothing and everything.'
        },
        { kind: 'check', questionId: 'q4l1q1' },
        { kind: 'check', questionId: 'q4l1q2' },
        { kind: 'check', questionId: 'q4l1q3' }
      ],
      questions: [
        {
          id: 'q4l1q1',
          kind: 'choice',
          concept: 'unitary',
          prompt: 'What does unitarity guarantee about a gate?',
          difficulty: 'intermediate',
          options: [
            'That it is fast to apply',
            'That it preserves total probability, and therefore has an inverse',
            'That its entries are real',
            'That it acts on only one qubit'
          ],
          answer: 1,
          explanation:
            'U†U = I preserves the norm, so states stay states. It also means the gate is invertible, which is why there is no quantum gate that discards information the way AND does.',
          hints: ['What has to stay true of the probabilities after the gate?']
        },
        {
          id: 'q4l1q2',
          kind: 'choice',
          concept: 'pauli-gates',
          prompt: 'Z is applied to |0⟩ and the qubit is measured. What changes?',
          difficulty: 'intermediate',
          options: [
            'The outcome becomes 1',
            'Nothing — Z|0⟩ is |0⟩, and the measurement is unaffected',
            'The outcome becomes random',
            'The state becomes invalid'
          ],
          answer: 1,
          explanation:
            'Z leaves |0⟩ exactly as it was. Its effect appears only on a superposition, where it flips the relative phase — which is why the H-Z-H circuit reverses the answer and this one does not.',
          hints: ['Read the matrix: what does Z do to the first amplitude?']
        },
        {
          id: 'q4l1q3',
          kind: 'choice',
          concept: 'pauli-gates',
          prompt: 'X is applied to 0.6|0⟩ + 0.8|1⟩. What is the resulting probability of measuring 0?',
          difficulty: 'intermediate',
          options: ['36%', '64%', '50%', '80%'],
          answer: 1,
          explanation: 'X swaps the amplitudes, giving 0.8|0⟩ + 0.6|1⟩, so P(0) = 0.64. The probabilities have swapped with the amplitudes.',
          hints: ['Swap α and β, then square.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q4l2',
      title: 'Phase gates and continuous rotations',
      intro:
        'S, T and the rotation gates: smaller and finer turns than the Paulis, and the ones every variational algorithm is built from.',
      objectives: [
        'Say what S and T do, and relate them to Z',
        'Use Rx, Ry and Rz, and say which of them changes a measurement probability',
        'Explain why phase gates matter despite being invisible to a measurement'
      ],
      concepts: ['phase-gates', 'rotations'],
      requires: ['pauli-gates', 'relative-phase'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Z multiplies |1⟩ by −1, which is a half turn of phase. Smaller turns are useful, and they have names.'
        },
        { kind: 'formula', latex: 'P(\\theta) = \\begin{bmatrix} 1 & 0 \\\\ 0 & e^{i\\theta} \\end{bmatrix}', caption: 'The general phase gate: |0⟩ untouched, |1⟩ multiplied by e^{iθ}. Z is θ = π, S is θ = π/2, T is θ = π/4.' },
        {
          kind: 'table',
          headers: ['Gate', 'θ', 'Multiplies |1⟩ by', 'Relations'],
          rows: [
            ['Z', 'π', '−1', 'Z² = I'],
            ['S', 'π/2', 'i', 'S² = Z'],
            ['T', 'π/4', 'e^{iπ/4}', 'T² = S, T⁴ = Z'],
            ['S†', '−π/2', '−i', 'S S† = I'],
            ['T†', '−π/4', 'e^{−iπ/4}', 'T T† = I']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'T has an importance out of proportion to its size. Circuits built only from Hadamards, CNOTs and phase gates of π/2 can be simulated efficiently on a classical computer — the Gottesman-Knill result. Adding T is what breaks that, so the number of T gates in a circuit is a standard measure of how genuinely quantum it is. Unit 15 returns to this.'
        },
        { kind: 'heading', text: 'Continuous rotations' },
        {
          kind: 'text',
          text: 'The Paulis are half turns about fixed axes. Rx, Ry and Rz turn by any angle about those axes, which is what a variational circuit needs — a parameter an optimiser can move continuously.'
        },
        { kind: 'formula', latex: 'R_y(\\theta) = \\begin{bmatrix} \\cos(\\theta/2) & -\\sin(\\theta/2) \\\\ \\sin(\\theta/2) & \\cos(\\theta/2) \\end{bmatrix}', caption: 'Rotation about y. The halved angle is not a typo: a rotation of 2π about an axis returns the state to itself up to a sign, and a rotation of 4π returns it exactly. Ry has real entries, which makes it the usual choice for preparing a state with given probabilities.' },
        {
          kind: 'example',
          title: 'Preparing any probability you like',
          text: 'Ry(θ)|0⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩\n\nSo P(1) = sin²(θ/2):\n\n  θ = 0       → P(1) = 0        |0⟩\n  θ = π/2     → P(1) = 0.5      an equal superposition\n  θ = π       → P(1) = 1        |1⟩\n  θ = 0.927   → P(1) = 0.2      a 20% qubit\n\nThis is how you prepare a qubit with any chosen bias — and the control an optimiser turns in Unit 16.'
        },
        { kind: 'heading', text: 'Which rotations change a probability' },
        {
          kind: 'table',
          headers: ['Gate', 'Changes P(0) and P(1)?', 'Why'],
          rows: [
            ['Rx(θ)', 'Yes', 'It moves amplitude between |0⟩ and |1⟩'],
            ['Ry(θ)', 'Yes', 'The same'],
            ['Rz(θ)', 'No', 'It only adjusts phase, and probability is a magnitude'],
            ['P(θ), S, T, Z', 'No', 'The same reason']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That table is worth internalising. Half the gates in this course cannot change what a measurement gives you now, and they are not decoration — they set up what the next Hadamard or the next controlled operation will produce. Phase is the subject manipulating itself out of sight.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Sweep an angle, watch the probability',
          does:
            'Apply Ry with the angle slider and watch P(1) trace out sin²(θ/2). Then do the same with Rz and watch the probabilities refuse to move at all — while the phase column changes the whole time.'
        },
        { kind: 'check', questionId: 'q4l2q1' },
        { kind: 'check', questionId: 'q4l2q2' }
      ],
      questions: [
        {
          id: 'q4l2q1',
          kind: 'choice',
          concept: 'phase-gates',
          prompt: 'S is applied twice. What is the equivalent single gate?',
          difficulty: 'intermediate',
          options: ['I', 'Z', 'X', 'T'],
          answer: 1,
          explanation: 'S is a quarter turn of phase and two of them make a half turn, which is Z. So S² = Z, and T² = S, and T⁴ = Z.',
          hints: ['Add the angles: π/2 and π/2.']
        },
        {
          id: 'q4l2q2',
          kind: 'choice',
          concept: 'rotations',
          prompt: 'Which gate changes the probability of measuring 1 on a qubit in |0⟩?',
          difficulty: 'intermediate',
          options: ['Rz(π/3)', 'S', 'Ry(π/3)', 'T'],
          answer: 2,
          explanation:
            'Only Ry moves amplitude between the basis states. Rz, S and T all adjust phase, and probability is a magnitude squared, so none of them changes it.',
          hints: ['Which gates move amplitude, and which only turn it?']
        },
        {
          id: 'q4l2q3',
          kind: 'number',
          concept: 'rotations',
          prompt: 'Ry(θ) is applied to |0⟩ with θ = π. What is P(1), as a percentage?',
          difficulty: 'intermediate',
          answer: 100,
          tolerance: 0.5,
          explanation: 'P(1) = sin²(π/2) = 1. A rotation of π about y takes |0⟩ all the way to |1⟩ — Ry(π) is X up to a phase.',
          hints: ['P(1) = sin²(θ/2), and θ/2 is π/2.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q4l3',
      title: 'Composing gates, and why order matters',
      intro:
        'A circuit is a product of matrices, and matrices do not commute. Demonstrated rather than asserted.',
      objectives: [
        'Write a circuit as a product of matrices, in the right order',
        'Show by computation that XZ and ZX differ',
        'Recognise and use circuit identities'
      ],
      concepts: ['gate-composition', 'non-commutativity', 'circuit-identities'],
      requires: ['unitary', 'pauli-gates'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Apply U then V to a state and the combined operation is **VU** — the second gate on the left. This is the opposite of the reading order of a circuit diagram, which draws time left to right, and it catches everybody once.'
        },
        { kind: 'formula', latex: "|\\psi''\\rangle = V\\big(U|\\psi\\rangle\\big) = (VU)|\\psi\\rangle", caption: 'The gate applied first sits nearest the state. A circuit drawn H then Z then H is the matrix product H·Z·H — which here happens to read the same both ways, and in general does not.' },
        { kind: 'heading', text: 'Order changes the result' },
        {
          kind: 'example',
          title: 'XZ against ZX, computed',
          text: 'Start from |+⟩ = (|0⟩ + |1⟩)/√2.\n\nZ first, then X:\n  Z|+⟩ = (|0⟩ − |1⟩)/√2 = |−⟩\n  X|−⟩ = (|1⟩ − |0⟩)/√2 = −|−⟩\n\nX first, then Z:\n  X|+⟩ = (|1⟩ + |0⟩)/√2 = |+⟩\n  Z|+⟩ = (|0⟩ − |1⟩)/√2 = |−⟩\n\nOne gives −|−⟩, the other |−⟩. Those differ by a global phase, so on this state the two orders happen to be physically the same.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And that is why the demonstration has to be done carefully. XZ = −ZX as matrices, which is a real difference — but a global sign is unobservable on its own. The order shows up as a genuine difference the moment the gate is **controlled** by another qubit, because then the sign applies to only part of the state and stops being global. Unit 05 is where this becomes visible.'
        },
        { kind: 'heading', text: 'A case you can see immediately' },
        {
          kind: 'example',
          title: 'H then X, against X then H',
          text: 'Start from |0⟩.\n\nH then X:   H|0⟩ = |+⟩,  X|+⟩ = |+⟩        → measures 50/50\nX then H:   X|0⟩ = |1⟩,  H|1⟩ = |−⟩        → measures 50/50\n\nSame probabilities. Now put another Hadamard on the end of each:\n\nH, X, H  on |0⟩  →  H|+⟩ = |0⟩           → 0 every time\nX, H, H  on |0⟩  →  H|−⟩ = |1⟩           → 1 every time\n\nSame three gates, different order, opposite answers with certainty.'
        },
        { kind: 'heading', text: 'Identities worth knowing' },
        {
          kind: 'table',
          headers: ['Identity', 'What it means in a circuit'],
          rows: [
            ['XX = I', 'Two adjacent X gates can both be deleted'],
            ['HH = I', 'The same for Hadamards'],
            ['ZZ = I', 'And for Z'],
            ['HXH = Z', 'A bit flip conjugated by Hadamards is a phase flip'],
            ['HZH = X', 'And the reverse — this is the basis change of Unit 03 in matrix form'],
            ['S² = Z, T² = S', 'Phase angles add'],
            ['Rz(α)Rz(β) = Rz(α+β)', 'Rotations about the same axis combine']
          ]
        },
        {
          kind: 'text',
          text: 'The fifth row is the one to keep. HZH = X says that a phase flip, viewed in the other basis, *is* a bit flip — which is exactly why the phase-flip error-correcting code in Unit 15 is the bit-flip code with Hadamards around it.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Prove HZH = X to yourself',
          does:
            'Build H, Z, H on one qubit and look at the final state. Then build a single X and compare. Then build H, X, H and compare with a single Z. Two identities, four circuits, and no trust required.'
        },
        { kind: 'check', questionId: 'q4l3q1' },
        { kind: 'check', questionId: 'q4l3q2' },
        { kind: 'check', questionId: 'q4l3q3' }
      ],
      questions: [
        {
          id: 'q4l3q1',
          kind: 'choice',
          concept: 'gate-composition',
          prompt: 'A circuit applies U first, then V. What is the matrix of the whole circuit?',
          difficulty: 'intermediate',
          options: ['UV', 'VU', 'U + V', 'It depends on the state'],
          answer: 1,
          explanation:
            'VU — the gate applied first sits nearest the state, so it is on the right of the product. The diagram reads left to right in time and the algebra reads right to left, which is a standing source of sign errors.',
          hints: ['Which gate touches the state vector first?']
        },
        {
          id: 'q4l3q2',
          kind: 'choice',
          concept: 'circuit-identities',
          prompt: 'What does HZH equal?',
          difficulty: 'advanced',
          options: ['I', 'Z', 'X', 'Y'],
          answer: 2,
          explanation:
            'HZH = X. A phase flip in the X basis is a bit flip in the Z basis — the same statement as "a Hadamard converts between the bases", written as matrices. It is also why the phase-flip code is the bit-flip code conjugated by Hadamards.',
          hints: ['Think about what H does to the bases, then what Z does in the other one.']
        },
        {
          id: 'q4l3q3',
          kind: 'choice',
          concept: 'non-commutativity',
          prompt: 'Why does the XZ against ZX comparison need care as a demonstration that order matters?',
          difficulty: 'advanced',
          options: [
            'Because the two orders give the same matrix',
            'Because XZ = −ZX, and a global sign is unobservable — so on a single qubit the two orders can be physically identical, while a controlled version makes the difference real',
            'Because X and Z commute',
            'Because the state has to be |0⟩'
          ],
          answer: 1,
          explanation:
            'The matrices differ by a sign, which is a global phase on a single qubit and therefore invisible. Once the operation is controlled by another qubit the sign applies to part of the state only, and the difference becomes measurable.',
          hints: ['What kind of difference is a factor of −1 on the whole state?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q4l4',
      title: 'The Bloch sphere',
      intro:
        'One qubit as a point on a sphere, gates as rotations — and the limitation that makes the picture honest.',
      objectives: [
        'Place the standard states on the sphere',
        'Read the parameterisation and relate θ and φ to amplitudes',
        'Say what a short Bloch vector means, and why it is not a drawing fault'
      ],
      concepts: ['bloch-sphere'],
      requires: ['relative-phase', 'pauli-gates', 'rotations'],
      minutes: 17,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A qubit state has four real numbers in it — two complex amplitudes — but normalisation removes one and global phase removes another. Two real numbers are left, which is exactly what it takes to specify a point on a sphere.'
        },
        { kind: 'formula', latex: '|\\psi\\rangle = \\cos\\frac{\\theta}{2}|0\\rangle + e^{i\\phi}\\sin\\frac{\\theta}{2}|1\\rangle', caption: 'θ (theta) is the polar angle, measured from the north pole: 0 at |0⟩, π at |1⟩. φ (phi) is the angle round the equator and carries the relative phase. The halved θ makes θ = π reach the south pole rather than going round twice.' },
        {
          kind: 'table',
          headers: ['State', 'θ', 'φ', 'Where'],
          rows: [
            ['|0⟩', '0', '—', 'North pole'],
            ['|1⟩', 'π', '—', 'South pole'],
            ['|+⟩', 'π/2', '0', 'Equator, towards +x'],
            ['|−⟩', 'π/2', 'π', 'Equator, towards −x'],
            ['|+i⟩', 'π/2', 'π/2', 'Equator, towards +y'],
            ['|−i⟩', 'π/2', '3π/2', 'Equator, towards −y']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Two things the picture makes obvious that the algebra does not. |0⟩ and |1⟩ are **opposite** points, not adjacent ones — perpendicular states are antipodal on this sphere. And the whole equator is equal superpositions differing only in phase, which is why there are infinitely many "fifty-fifty" states rather than one.'
        },
        { kind: 'heading', text: 'Gates as rotations' },
        {
          kind: 'table',
          headers: ['Gate', 'Rotation'],
          rows: [
            ['X', 'Half turn about the x axis'],
            ['Y', 'Half turn about the y axis'],
            ['Z', 'Half turn about the z axis'],
            ['H', 'Half turn about the axis halfway between x and z'],
            ['S', 'Quarter turn about z'],
            ['T', 'Eighth turn about z'],
            ['Rx, Ry, Rz(θ)', 'A turn of θ about that axis']
          ]
        },
        {
          kind: 'text',
          text: 'This explains several earlier facts at a glance. A rotation about z moves a point round the vertical axis, which changes its longitude and not its height — and height is what sets the measurement probability, so phase gates cannot change it. A half turn twice is a full turn, which is why X, Y, Z and H are all their own inverses.'
        },
        { kind: 'heading', text: 'The limitation, stated' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The Bloch sphere describes **one** qubit in a pure state. There is no Bloch sphere for two qubits — the state space of two qubits is not a sphere and cannot be drawn this way. And a qubit that is entangled with another has no pure state of its own, so it has no point on the surface.'
        },
        {
          kind: 'text',
          text: 'What the studio shows in that case is a **short arrow**: the vector shrinks toward the centre, and reaches length zero for half of a Bell pair. That is not a rendering compromise. The length of the vector is a real quantity — it tells you how pure the qubit own state is — and a picture that put an entangled qubit on the surface would be drawing something untrue. Unit 06 makes this precise with the reduced density matrix.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Move a point around the sphere',
          does:
            'Apply Ry with increasing angles and watch the point travel from the north pole toward the south. Then apply Rz and watch it circle the vertical axis at constant height — the height is the probability, and Rz leaves it alone. Finally load the Bell state and look at the Bloch sphere of qubit 0: length zero, at the centre.'
        },
        { kind: 'check', questionId: 'q4l4q1' },
        { kind: 'check', questionId: 'q4l4q2' },
        { kind: 'check', questionId: 'q4l4q3' }
      ],
      questions: [
        {
          id: 'q4l4q1',
          kind: 'choice',
          concept: 'bloch-sphere',
          prompt: 'Where do |0⟩ and |1⟩ sit on the Bloch sphere relative to one another?',
          difficulty: 'beginner',
          options: ['Adjacent on the equator', 'At opposite poles', 'At the same point', 'At right angles on the surface'],
          answer: 1,
          explanation:
            'Opposite poles. Perpendicular quantum states are antipodal on this sphere, which is one of the two things the picture makes clear and the algebra hides.',
          hints: ['Look at θ = 0 and θ = π.']
        },
        {
          id: 'q4l4q2',
          kind: 'choice',
          concept: 'bloch-sphere',
          prompt: 'Why does a rotation about the z axis leave the measurement probabilities unchanged?',
          difficulty: 'intermediate',
          options: [
            'Because z rotations do nothing at all',
            'Because the probability depends on the height on the sphere, and a z rotation changes only the longitude',
            'Because probabilities are always 50/50 on the equator',
            'It does change them'
          ],
          answer: 1,
          explanation:
            'The height — the z component — sets P(0) and P(1). A z rotation moves a point around the vertical axis at constant height, so it changes the phase and nothing measurable now.',
          hints: ['What does the height of the point correspond to?']
        },
        {
          id: 'q4l4q3',
          kind: 'choice',
          concept: 'bloch-sphere',
          prompt: 'The Bloch vector of one qubit has length 0. What does that tell you?',
          difficulty: 'advanced',
          options: [
            'The simulation has failed',
            'The qubit has no pure state of its own — it is maximally entangled with something else, or completely mixed',
            'The qubit is in |0⟩',
            'The qubit has been measured'
          ],
          answer: 1,
          explanation:
            'Length 1 means a pure single-qubit state; shorter means mixed; zero means completely mixed, which is what each half of a Bell pair is. The short arrow is the honest picture, not a fault.',
          hints: ['What is true of half of a Bell pair considered on its own?']
        }
      ]
    }
  ]
}
