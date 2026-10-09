import type { Module } from '../../types.ts'

/**
 * Unit 08 — Teleportation, no-cloning and superdense coding.
 *
 * Placed after entanglement and interference, and before the algorithms, because these three protocols are where
 * the ideas so far become a thing you can do. No-cloning is taught before teleportation deliberately: the reason
 * teleportation destroys the original is the reason it cannot copy it, and understanding the theorem first makes
 * the protocol stop looking like science fiction.
 */
export const Q_UNIT_8: Module = {
  id: 'q8',
  title: 'Teleportation, No-Cloning and Superdense Coding',
  summary:
    'Why an unknown quantum state cannot be copied, how a state can be moved with entanglement and two classical bits, how close the arrival is, and the complementary protocol that sends two bits in one qubit.',
  concepts: ['no-cloning', 'teleportation', 'fidelity', 'superdense'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q8l1',
      title: 'No-cloning',
      intro:
        'An unknown quantum state cannot be copied. Not "is difficult to copy" — cannot, and the proof is three lines of linearity.',
      objectives: [
        'State the no-cloning theorem precisely',
        'Follow the proof',
        'Say what it does and does not forbid'
      ],
      concepts: ['no-cloning'],
      requires: ['unitary', 'superposition'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Suppose there were a gate C that copied any state: `C(|ψ⟩ ⊗ |0⟩) = |ψ⟩ ⊗ |ψ⟩` for every |ψ⟩. Watch what linearity does to it.'
        },
        {
          kind: 'example',
          title: 'The proof',
          text: 'It must work on |0⟩:   C(|0⟩|0⟩) = |0⟩|0⟩\nAnd on |1⟩:            C(|1⟩|0⟩) = |1⟩|1⟩\n\nNow try it on |+⟩ = (|0⟩ + |1⟩)/√2, two ways.\n\nBy linearity, since C is a linear operator:\n  C(|+⟩|0⟩) = (C(|0⟩|0⟩) + C(|1⟩|0⟩))/√2\n            = (|00⟩ + |11⟩)/√2            ← an entangled state\n\nBut copying should give:\n  |+⟩ ⊗ |+⟩ = (|00⟩ + |01⟩ + |10⟩ + |11⟩)/2   ← a product state\n\nThese are different states. So no linear C can do both, and every quantum operation is linear. No such gate exists.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Notice what the proof turns on: it is linearity, nothing more. Any operation that copies the basis states correctly necessarily *entangles* a superposition instead of copying it. The impossibility is structural rather than technological, which is why no future device changes it.'
        },
        { kind: 'heading', text: 'What it does not forbid' },
        {
          kind: 'table',
          headers: ['Allowed', 'Why'],
          rows: [
            ['Copying a **known** state', 'If you know it is |+⟩, prepare another |+⟩ — you are not copying, you are constructing'],
            ['Copying basis states', 'CNOT from |0⟩ or |1⟩ onto a fresh |0⟩ does exactly that'],
            ['Moving a state', 'Teleportation, with the original destroyed — the next lesson'],
            ['Making an approximate copy', 'Possible, with a provable ceiling on the fidelity'],
            ['Measuring and re-preparing', 'You get one outcome and lose the rest; the result is not the state you had']
          ]
        },
        {
          kind: 'text',
          text: 'The second row deserves emphasis because it is how CNOT behaves and it looks like a counter-example. CNOT applied to |0⟩ or |1⟩ does duplicate the value. Applied to a superposition it produces a Bell state, which is correlated rather than copied — the very thing the proof predicted.'
        },
        { kind: 'heading', text: 'Where the theorem does real work' },
        {
          kind: 'list',
          items: [
            '**Quantum key distribution** — an eavesdropper cannot copy the qubits in transit and pass the originals along, which is what BB84 in Unit 16 depends on.',
            '**Error correction** — you cannot back up a qubit, so protecting one needs the completely different approach in Unit 15.',
            '**Teleportation** — the original must be destroyed, which is not a side effect but a consequence of the theorem.'
          ]
        },
        { kind: 'check', questionId: 'q8l1q1' },
        { kind: 'check', questionId: 'q8l1q2' }
      ],
      questions: [
        {
          id: 'q8l1q1',
          kind: 'choice',
          concept: 'no-cloning',
          prompt: 'What property of quantum operations makes cloning impossible?',
          difficulty: 'advanced',
          options: [
            'Measurement disturbs the state',
            'Linearity — an operation that copies the basis states correctly must entangle a superposition rather than copy it',
            'Qubits decohere too quickly',
            'Gates must be reversible'
          ],
          answer: 1,
          explanation:
            'Linearity forces the contradiction. Measurement disturbance and decoherence are true and separate facts; reversibility is not what the proof uses.',
          hints: ['Which property did the proof actually invoke?']
        },
        {
          id: 'q8l1q2',
          kind: 'choice',
          concept: 'no-cloning',
          prompt: 'Which of these is permitted?',
          difficulty: 'intermediate',
          options: [
            'Copying an unknown qubit perfectly',
            'Preparing a second copy of a state you know the description of',
            'Copying an unknown qubit with fidelity 1',
            'Reading a superposition without disturbing it'
          ],
          answer: 1,
          explanation:
            'Knowing the description means you can construct another — that is preparation, not cloning. The theorem is about states you have been handed without being told what they are.',
          hints: ['What is the word "unknown" doing in the theorem?']
        },
        {
          id: 'q8l1q3',
          kind: 'choice',
          concept: 'no-cloning',
          prompt: 'CNOT applied with an unknown superposition as control appears to copy it. What really happens?',
          difficulty: 'advanced',
          options: [
            'It does copy it, so the theorem is wrong',
            'It produces an entangled state — correlated rather than copied, which is exactly what the proof predicts',
            'It measures the control',
            'It fails with an error'
          ],
          answer: 1,
          explanation:
            'The output is (|00⟩ + |11⟩)/√2 rather than |+⟩⊗|+⟩. Neither qubit now has the original state; they share a correlation. This is the proof happening in a circuit.',
          hints: ['Write down the output and ask whether either qubit alone is in the original state.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q8l2',
      title: 'Teleportation',
      intro:
        'Moving an unknown state from one qubit to another using entanglement and two classical bits. Nothing material travels, nothing is copied, and nothing outruns light.',
      objectives: [
        'Build the teleportation circuit and say what each stage does',
        'Explain why the two classical bits are indispensable',
        'Measure the fidelity of the arrived state'
      ],
      concepts: ['teleportation', 'fidelity'],
      requires: ['bell-states', 'classical-control', 'no-cloning'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The problem: Alice has a qubit in an unknown state, Bob is somewhere else, and they cannot send qubits — only classical bits. They do share an entangled pair, distributed earlier.'
        },
        { kind: 'heading', text: 'The protocol' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Earlier: a Bell pair is created and one qubit given to each of them. This is the resource, and it is used up.',
            'Alice applies a CNOT from her unknown qubit onto her half of the pair.',
            'Alice applies a Hadamard to her unknown qubit. Those two gates together measure in the Bell basis.',
            'Alice measures both of her qubits, getting two classical bits.',
            'Alice sends those two bits to Bob, by telephone, email, anything classical.',
            'Bob applies corrections depending on the bits: X if the second is 1, then Z if the first is 1.',
            "Bob's qubit is now in the state Alice's qubit was in. Alice's is not — her measurement destroyed it."
          ]
        },
        {
          kind: 'example',
          title: 'The four cases',
          text: 'Alice measures:    Bob applies:\n  00                 nothing\n  01                 X\n  10                 Z\n  11                 X then Z\n\nEach outcome happens a quarter of the time, and each tells Bob which of four possible transformations his qubit has undergone. Without that information his qubit is in a completely mixed state — useless.'
        },
        { kind: 'heading', text: 'Why nothing travels faster than light' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Before the classical bits arrive, Bob has a qubit whose statistics are exactly fifty-fifty in every basis, regardless of what Alice did. He cannot extract anything from it. The protocol completes only when the two bits arrive, and they travel at ordinary speed. This is the clearest demonstration in the course that entanglement is not a channel.'
        },
        { kind: 'heading', text: 'And nothing is copied' },
        {
          kind: 'text',
          text: "Alice's measurement in step 4 destroys her state. That is required — if it survived there would be two copies of an unknown state, which the previous lesson proved impossible. So the name is apt in an unexpected way: the state is moved, not duplicated, and the original is necessarily gone."
        },
        { kind: 'heading', text: 'Fidelity' },
        {
          kind: 'text',
          text: '**Fidelity** measures how close one state is to another: 1 for identical, 0 for perpendicular. It is how you check a protocol worked without being able to look at the state directly — and in an ideal simulation, teleportation gives fidelity 1 to within floating-point error.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'On real hardware it does not. Every gate and every measurement adds error, so reported fidelities for teleportation on devices are well below 1 — which is a fact about the hardware rather than about the protocol, and Unit 14 is about why.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Teleport a state and check it arrived',
          does:
            'Run teleportation from the Algorithms bench. Read the fidelity and the two classical bits it had to send. Then run it several times and watch the bits change while the fidelity stays at 1 — four different measurement outcomes, four different corrections, the same result.'
        },
        { kind: 'check', questionId: 'q8l2q1' },
        { kind: 'check', questionId: 'q8l2q2' },
        { kind: 'check', questionId: 'q8l2q3' }
      ],
      questions: [
        {
          id: 'q8l2q1',
          kind: 'choice',
          concept: 'teleportation',
          prompt: 'Why must Alice send two classical bits?',
          difficulty: 'advanced',
          options: [
            'To tell Bob when to look at his qubit',
            "Because her measurement had four possible outcomes, and each leaves Bob's qubit needing a different correction",
            'To transmit the quantum state itself',
            'They are not strictly necessary'
          ],
          answer: 1,
          explanation:
            "Four outcomes, four corrections, two bits. Without them Bob's qubit is completely mixed — and this requirement is why teleportation sends nothing faster than light.",
          hints: ['How many outcomes does measuring two qubits have?']
        },
        {
          id: 'q8l2q2',
          kind: 'choice',
          concept: 'teleportation',
          prompt: "What happens to Alice's original qubit?",
          difficulty: 'intermediate',
          options: [
            'It keeps the state, so there are now two copies',
            'Her measurement destroys it — which the no-cloning theorem requires',
            'It becomes entangled with Bob’s permanently',
            'It is physically transported'
          ],
          answer: 1,
          explanation:
            'The measurement collapses it. If it survived, two copies of an unknown state would exist, which is impossible — so the destruction is a consequence of the theorem rather than an inconvenience.',
          hints: ['What would two surviving copies violate?']
        },
        {
          id: 'q8l2q3',
          kind: 'choice',
          concept: 'fidelity',
          prompt: 'A teleportation experiment on real hardware reports fidelity 0.87. What does that mean?',
          difficulty: 'advanced',
          options: [
            'The protocol is wrong',
            'The arrived state is close to but not identical to the one sent — gate and measurement errors on the device, not a flaw in the protocol',
            '87% of the runs succeeded completely',
            'The classical bits were corrupted'
          ],
          answer: 1,
          explanation:
            'Fidelity measures closeness of states. In an ideal simulation it is 1; on hardware every gate and measurement contributes error. The shortfall is a property of the machine.',
          hints: ['What is fidelity measuring, and what would make it fall short?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q8l3',
      title: 'Superdense coding',
      intro:
        'The mirror image of teleportation: two classical bits carried by sending one qubit. Worth doing immediately afterwards, because the comparison is what makes both make sense.',
      objectives: [
        'Build the superdense coding circuit',
        'Say where the second bit of capacity really came from',
        'Compare the resources with teleportation'
      ],
      concepts: ['superdense'],
      requires: ['bell-states', 'teleportation'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Alice wants to send Bob two classical bits, and may send only one qubit. They share an entangled pair in advance.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Earlier: a Bell pair, one qubit each.',
            'Alice encodes her two bits by applying one of four operations to **her** qubit alone: nothing, X, Z, or both.',
            'Alice sends her qubit to Bob.',
            'Bob now has both halves. He applies a CNOT and a Hadamard — the Bell measurement in reverse.',
            'He measures both qubits and reads two bits: exactly the ones Alice encoded.'
          ]
        },
        {
          kind: 'table',
          headers: ['Bits to send', 'Alice applies', 'Resulting pair state'],
          rows: [
            ['00', 'nothing', 'Φ⁺'],
            ['01', 'Z', 'Φ⁻'],
            ['10', 'X', 'Ψ⁺'],
            ['11', 'X and Z', 'Ψ⁻']
          ]
        },
        {
          kind: 'text',
          text: 'The four Bell states are mutually distinguishable by a Bell measurement, and Alice can move between them by acting on her half alone. That is the whole protocol: her local operation selects which of four globally distinguishable states the pair is in.'
        },
        { kind: 'heading', text: 'Where the capacity came from' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'One qubit carrying two bits sounds like free bandwidth and is not. The entangled pair had to be distributed beforehand, which required sending a qubit then. Count both and two qubits were sent for two bits — ordinary. What superdense coding buys is **timing**: the expensive distribution happens in advance, and the message costs one qubit at the moment you need to send it.'
        },
        {
          kind: 'table',
          headers: ['', 'Teleportation', 'Superdense coding'],
          rows: [
            ['Sends', 'One qubit state', 'Two classical bits'],
            ['Uses', 'One Bell pair', 'One Bell pair'],
            ['Transmits', 'Two classical bits', 'One qubit'],
            ['Destroys the original?', 'Yes, necessarily', 'Not applicable'],
            ['The pair afterwards', 'Consumed', 'Consumed']
          ]
        },
        {
          kind: 'text',
          text: 'The symmetry is the point. One converts a qubit into classical bits plus entanglement; the other converts classical bits into a qubit plus entanglement. Entanglement is the currency both of them spend, and each pair is good for exactly one use.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Send all four messages',
          does:
            'Run superdense coding for each of the four two-bit messages and check that what arrives is what was sent. Then look at the state after the encoding step each time — four different Bell states, produced by acting on one qubit only.'
        },
        { kind: 'check', questionId: 'q8l3q1' },
        { kind: 'check', questionId: 'q8l3q2' }
      ],
      questions: [
        {
          id: 'q8l3q1',
          kind: 'choice',
          concept: 'superdense',
          prompt: 'Does superdense coding beat the classical limit on how much one qubit can carry?',
          difficulty: 'advanced',
          options: [
            'Yes — one qubit carries two bits, which is twice the limit',
            'No, once the shared pair is counted: distributing it required sending a qubit earlier, so two qubits were sent for two bits',
            'Yes, because qubits hold more information than bits',
            'Only when the qubits are entangled with a third party'
          ],
          answer: 1,
          explanation:
            'Counting all the transmissions, nothing is beaten. What the protocol does is move the cost earlier: the pair is distributed when convenient and the message itself costs one qubit at the moment of sending.',
          hints: ['Count every qubit that had to travel, including the one in the pair.']
        },
        {
          id: 'q8l3q2',
          kind: 'choice',
          concept: 'superdense',
          prompt: 'How does Alice change which of the four Bell states the pair is in?',
          difficulty: 'advanced',
          options: [
            'By measuring her qubit',
            'By applying X, Z, both or neither to her own qubit — a local operation that moves the pair between globally distinguishable states',
            'By sending a classical message first',
            'By entangling a third qubit'
          ],
          answer: 1,
          explanation:
            'Local operations on one half move the pair among the four Bell states, and those four are distinguishable by a joint measurement. Measuring would destroy the entanglement and the protocol with it.',
          hints: ['Look at the table of what she applies.']
        },
        {
          id: 'q8l3q3',
          kind: 'choice',
          concept: 'superdense',
          prompt: 'What do teleportation and superdense coding have in common?',
          difficulty: 'intermediate',
          options: [
            'Both send information faster than light',
            'Both consume one entangled pair, and both convert between quantum and classical resources',
            'Both copy a quantum state',
            'Neither needs classical communication'
          ],
          answer: 1,
          explanation:
            'Entanglement is the currency, spent once per use, and each protocol trades one kind of resource for another. Neither sends anything faster than light and neither copies anything.',
          hints: ['Look at the "uses" row of the comparison table.']
        }
      ]
    }
  ]
}
