import type { Module } from '../../types.ts'

/**
 * Unit 06 — Entanglement, and the formal tools for it.
 *
 * The unit the course exists to make possible. Entanglement is defined mathematically — a state that cannot be
 * factored — rather than described as particles being connected, and the correlation lesson exists because
 * "correlated outcomes" is exactly what a classical mixture also produces. The distinguishing experiment, in
 * different bases, is what makes the definition mean something.
 *
 * Density matrices arrive here rather than earlier because this is where they are needed: a pure whole with
 * mixed parts is what entanglement *is*, and the partial trace is how you see it.
 */
export const Q_UNIT_6: Module = {
  id: 'q6',
  title: 'Entanglement',
  summary:
    'The Bell states, why correlation is not enough, what measuring part of a system does, GHZ and W states, and the density-matrix tools that show a pure whole with mixed parts.',
  concepts: [
    'entanglement',
    'bell-states',
    'correlation-vs-entanglement',
    'partial-measurement',
    'ghz-w',
    'no-faster-than-light',
    'density-matrix',
    'mixed-states',
    'purity',
    'partial-trace'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q6l1',
      title: 'The Bell states',
      intro:
        'Entanglement defined by what it is rather than by what it is like: a joint state that cannot be written as two separate states. Four of them, built with two gates each.',
      objectives: [
        'Define entanglement mathematically',
        'Build all four Bell states',
        'Show that a Bell state cannot be factored'
      ],
      concepts: ['entanglement', 'bell-states'],
      requires: ['product-states', 'cnot'],
      minutes: 17,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A two-qubit state is **entangled** if it cannot be written as a tensor product of two single-qubit states. That is the definition — a statement about the mathematics of the state, with no mention of distance, particles or communication.'
        },
        { kind: 'heading', text: 'Showing that one cannot be factored' },
        {
          kind: 'example',
          title: 'The proof, in four lines',
          text: 'Suppose (|00⟩ + |11⟩)/√2 = (a|0⟩ + b|1⟩) ⊗ (c|0⟩ + d|1⟩).\n\nExpanding the right side: ac|00⟩ + ad|01⟩ + bc|10⟩ + bd|11⟩.\n\nMatching coefficients:\n  ac = 1/√2   →  a ≠ 0 and c ≠ 0\n  bd = 1/√2   →  b ≠ 0 and d ≠ 0\n  ad = 0      →  a = 0 or d = 0\n\nThe third line contradicts the first two. No such a, b, c, d exist, so the state is not a product. It is entangled.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That argument is worth being able to reproduce. It is the whole content of "entangled" for two qubits, and it shows the property is about the state, not about where the qubits are. Two entangled qubits sitting in the same box are just as entangled as two on opposite sides of a galaxy.'
        },
        { kind: 'heading', text: 'The four Bell states' },
        {
          kind: 'table',
          headers: ['Name', 'State', 'Circuit from |00⟩'],
          rows: [
            ['Φ⁺', '(|00⟩ + |11⟩)/√2', 'H on q0, then CNOT q0→q1'],
            ['Φ⁻', '(|00⟩ − |11⟩)/√2', 'H on q0, Z on q0, then CNOT'],
            ['Ψ⁺', '(|01⟩ + |10⟩)/√2', 'H on q0, CNOT, then X on q1'],
            ['Ψ⁻', '(|01⟩ − |10⟩)/√2', 'H on q0, Z on q0, CNOT, then X on q1']
          ]
        },
        {
          kind: 'text',
          text: 'These four are a basis for the two-qubit space, which means any two-qubit state can be written in terms of them. They are all **maximally** entangled: measuring either qubit tells you the other with certainty, and neither has any state of its own.'
        },
        {
          kind: 'table',
          headers: ['State', 'Measure both in Z', 'The correlation'],
          rows: [
            ['Φ⁺', '|00⟩ or |11⟩, half each', 'The outcomes agree'],
            ['Φ⁻', '|00⟩ or |11⟩, half each', 'The outcomes agree — the sign is invisible here'],
            ['Ψ⁺', '|01⟩ or |10⟩, half each', 'The outcomes disagree'],
            ['Ψ⁻', '|01⟩ or |10⟩, half each', 'The outcomes disagree']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Φ⁺ and Φ⁻ are indistinguishable by a Z-basis measurement, exactly as |+⟩ and |−⟩ were in Unit 02. The relative sign is a real difference and needs a different measurement to see. This is the pattern of the whole course: phase is invisible until you arrange for it not to be.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Build all four, and identify one',
          does:
            'Build each of the four Bell states from the circuits above and check the state table against the list. Then have somebody build one without telling you which, and work out from measurements which it was — measuring in Z narrows it to a pair, and you will need a different basis to finish.'
        },
        { kind: 'check', questionId: 'q6l1q1' },
        { kind: 'check', questionId: 'q6l1q2' },
        { kind: 'check', questionId: 'q6l1q3' }
      ],
      questions: [
        {
          id: 'q6l1q1',
          kind: 'choice',
          concept: 'entanglement',
          prompt: 'What makes a state entangled?',
          difficulty: 'intermediate',
          options: [
            'The two qubits are physically close together',
            'It cannot be written as a tensor product of individual qubit states',
            'Measuring one changes the other',
            'The qubits were created at the same time'
          ],
          answer: 1,
          explanation:
            'Non-factorisability — a property of the state, with nothing to do with distance or history. The second option is the definition; the others are consequences or irrelevancies.',
          hints: ['The definition is mathematical.']
        },
        {
          id: 'q6l1q2',
          kind: 'choice',
          concept: 'bell-states',
          prompt: 'Which pair of Bell states gives identical results when both qubits are measured in Z?',
          difficulty: 'advanced',
          options: ['Φ⁺ and Ψ⁺', 'Φ⁺ and Φ⁻', 'Ψ⁺ and Φ⁻', 'All four are distinguishable'],
          answer: 1,
          explanation:
            'Φ⁺ and Φ⁻ differ only in the relative sign, which a Z-basis measurement cannot see: both give |00⟩ or |11⟩ half the time. Telling them apart needs a measurement in another basis.',
          hints: ['Which difference does squaring the amplitudes discard?']
        },
        {
          id: 'q6l1q3',
          kind: 'order',
          concept: 'bell-states',
          prompt: 'Put the steps in order to build Φ⁺ from |00⟩: CNOT with q0 as control, H on q0, start in |00⟩.',
          difficulty: 'beginner',
          options: ['start in |00⟩', 'H on q0', 'CNOT with q0 as control'],
          answer: [0, 1, 2],
          explanation:
            'Superposition first, then the controlled gate that correlates them. CNOT before the Hadamard would do nothing at all, because |00⟩ has its control at 0.',
          hints: ['Which gate needs a superposition to have any effect?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q6l2',
      title: 'Correlation is not entanglement',
      intro:
        'A classical mixture produces correlated outcomes too. The experiment that separates them is the real content of entanglement, and the reason it is not just "the two agree".',
      objectives: [
        'Construct a classical setup with the same correlations as a Bell state in one basis',
        'Describe the measurement that distinguishes them',
        'Say why no operation on one qubit can signal to the other'
      ],
      concepts: ['correlation-vs-entanglement', 'no-faster-than-light'],
      requires: ['bell-states', 'measurement-basis'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'The classical imitation' },
        {
          kind: 'example',
          title: 'Two envelopes',
          text: 'Toss a coin. If heads, put a card reading 0 in both envelopes; if tails, put a card reading 1 in both. Seal them and send one to each side of the world.\n\nOpen yours: 0 or 1, half the time each.\nOpen mine: the same value as yours, always.\n\nPerfect correlation, at any distance, instantly. And nothing quantum about it whatsoever.'
        },
        {
          kind: 'text',
          text: 'Measured in the computational basis, Φ⁺ gives exactly this: agreement, half the time 00 and half the time 11. So the correlation alone does not demonstrate anything — which is why "entanglement means the outcomes agree" is not a definition and why popular accounts that stop there have not said anything yet.'
        },
        { kind: 'heading', text: 'Where they come apart' },
        {
          kind: 'text',
          text: 'Change the basis. Measure both qubits of Φ⁺ in the X basis instead — a Hadamard on each before measuring — and the outcomes **still agree**. Do the same to the envelopes and you get nothing of the kind: a card reading 0 put through a Hadamard-equivalent gives an even spread, and the two sides agree only half the time.'
        },
        {
          kind: 'table',
          headers: ['Measured in', 'Bell state Φ⁺', 'The envelopes'],
          rows: [
            ['Z on both', 'Agree, always', 'Agree, always'],
            ['X on both', 'Agree, always', 'Agree half the time'],
            ['Z on one, X on the other', 'Agree half the time', 'Agree half the time']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The second row is the whole demonstration. Entanglement produces correlations in **every** basis, which no pre-arranged classical pairing can reproduce. Making this precise and testable is what Bell inequalities do, and experiments have measured violations of them — which is why entanglement is an established physical fact rather than an interpretation.'
        },
        { kind: 'heading', text: 'And still nothing can be sent' },
        {
          kind: 'text',
          text: 'Here is the fact that closes off the "instant communication" story. Whatever you do to your qubit — measure it in any basis, apply any gate, destroy it — the statistics of my measurements are completely unchanged. My outcomes are fifty-fifty before and after, in every basis.'
        },
        {
          kind: 'text',
          text: 'The correlation is only visible when the two sets of results are brought together and compared, and bringing them together requires classical communication at ordinary speed. So entanglement is a resource for things like teleportation and key distribution, and it is not a channel.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Unit 06 of this course has a specific test, stated in Unit 01: can you explain a Bell state to somebody without saying "both at once", "communicates instantly" or "connected"? The materials for doing so are now all here — non-factorisable state, correlations in every basis, no change to local statistics.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Measure a Bell pair in two bases',
          does:
            'Build Φ⁺ and measure 2,000 times: only |00⟩ and |11⟩. Now add a Hadamard to **both** qubits before measuring and run again — still only |00⟩ and |11⟩. Then Hadamard just one of them and run a third time, and watch all four outcomes appear.'
        },
        { kind: 'check', questionId: 'q6l2q1' },
        { kind: 'check', questionId: 'q6l2q2' },
        { kind: 'check', questionId: 'q6l2q3' }
      ],
      questions: [
        {
          id: 'q6l2q1',
          kind: 'choice',
          concept: 'correlation-vs-entanglement',
          prompt: 'Why is perfect correlation in the Z basis insufficient to demonstrate entanglement?',
          difficulty: 'advanced',
          options: [
            'Because correlation is never evidence of anything',
            'Because two sealed envelopes with matching cards reproduce it exactly, with nothing quantum involved',
            'Because the Z basis is the wrong basis to use',
            'Because measurement destroys the correlation'
          ],
          answer: 1,
          explanation:
            'A pre-arranged classical pairing gives the same correlation at any distance. What it cannot give is correlation in every basis, which is where the quantum case separates.',
          hints: ['What classical arrangement produces the same table row?']
        },
        {
          id: 'q6l2q2',
          kind: 'choice',
          concept: 'no-faster-than-light',
          prompt: 'You hold one qubit of a Bell pair and measure it. What changes for the person holding the other?',
          difficulty: 'advanced',
          options: [
            'Their qubit instantly takes the matching value, and they can detect this',
            'Nothing they can detect — their statistics are identical whether or not you measured, in every basis',
            'Their qubit becomes unmeasurable',
            'Their measurement becomes deterministic'
          ],
          answer: 1,
          explanation:
            'Their local statistics do not change at all. The correlation only appears when the two sets of results are compared, which needs classical communication — so nothing is signalled.',
          hints: ['Could they tell, from their side alone, that you had done anything?']
        },
        {
          id: 'q6l2q3',
          kind: 'choice',
          concept: 'correlation-vs-entanglement',
          prompt: 'Φ⁺ is measured with a Hadamard applied to both qubits first. What is the result?',
          difficulty: 'advanced',
          options: [
            'All four outcomes equally',
            'Still only |00⟩ and |11⟩ — the correlation survives the change of basis',
            'Only |01⟩ and |10⟩',
            'The state is destroyed'
          ],
          answer: 1,
          explanation:
            'Φ⁺ is invariant under a Hadamard on both qubits, so the agreement holds in the X basis too. That is precisely what the envelope arrangement cannot reproduce.',
          hints: ['Work out H⊗H applied to (|00⟩ + |11⟩)/√2.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q6l3',
      title: 'Measuring part of a system, and three-qubit entanglement',
      intro:
        'What happens to the rest when you measure one qubit — and the fact that three qubits can be entangled in two genuinely different ways.',
      objectives: [
        'Work out the state of the remainder after a partial measurement',
        'Compare GHZ and W states',
        'Say what "maximally entangled" means and does not'
      ],
      concepts: ['partial-measurement', 'ghz-w'],
      requires: ['entanglement', 'collapse'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Measuring one qubit of a pair' },
        {
          kind: 'example',
          title: 'Worked through',
          text: 'State: (|00⟩ + |11⟩)/√2\n\nMeasure qubit 0. Two outcomes, each with probability ½:\n\n  Got 0 → the surviving terms are those with qubit 0 at 0, which is just |00⟩.\n          The state is now |00⟩. Qubit 1 is definitely 0.\n\n  Got 1 → the state is |11⟩. Qubit 1 is definitely 1.\n\nEither way the second qubit is now determined, and the entanglement is gone — the state afterwards is a product state.'
        },
        {
          kind: 'text',
          text: 'The general rule: keep the terms consistent with the outcome, discard the rest, and rescale what remains so the probabilities add to 1 again. That rescaling is the one place in this course where renormalising is correct, because the conditioned state genuinely is the new state.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Measurement destroys entanglement. A Bell pair is a resource that gets consumed: you can use it once. This matters for teleportation, where each state transmitted uses up one entangled pair, and it is why distributing pairs is a cost in any real protocol.'
        },
        { kind: 'heading', text: 'Three qubits: GHZ' },
        { kind: 'formula', latex: '|GHZ\\rangle = \\frac{|000\\rangle + |111\\rangle}{\\sqrt2}', caption: 'Built with H on the first qubit then two CNOTs, in a chain. All three agree, always, in the computational basis.' },
        {
          kind: 'text',
          text: 'GHZ is fragile in a specific way: measure any one qubit and the other two are immediately determined, with no entanglement left between them. One measurement collapses the whole thing.'
        },
        { kind: 'heading', text: 'Three qubits: W' },
        { kind: 'formula', latex: '|W\\rangle = \\frac{|001\\rangle + |010\\rangle + |100\\rangle}{\\sqrt3}', caption: 'Exactly one qubit is 1, and which one is in superposition. Note the √3 — three terms, so each amplitude is 1/√3 and each outcome has probability one third.' },
        {
          kind: 'text',
          text: 'W behaves quite differently. Measure one qubit and get 1, and you know the other two are both 0 — the state collapses. But measure one and get 0, which happens two thirds of the time, and the remaining two qubits are left in a Bell state: still entangled. W is robust to losing a qubit in a way GHZ is not.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'These two cannot be converted into one another by operations on individual qubits. For three qubits there are genuinely two inequivalent kinds of entanglement, and the classification problem gets rapidly harder with more qubits — which is one reason entanglement is still an active research subject rather than a settled topic.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Build GHZ, then break it',
          does:
            'Load the GHZ preset and look at the state — two amplitudes. Add a measurement on qubit 0 and run several times, looking at what remains each time. Then build the W state with rotations and CNOTs and do the same, and notice that a 0 outcome leaves two qubits still entangled.',
          optional: true
        },
        { kind: 'check', questionId: 'q6l3q1' },
        { kind: 'check', questionId: 'q6l3q2' }
      ],
      questions: [
        {
          id: 'q6l3q1',
          kind: 'choice',
          concept: 'partial-measurement',
          prompt: 'You measure one qubit of a Bell pair and get 1. What is the state of the pair afterwards?',
          difficulty: 'intermediate',
          options: ['Still entangled', '|11⟩ — a product state, with the entanglement gone', '|00⟩', 'Undefined'],
          answer: 1,
          explanation:
            'Only the terms consistent with the outcome survive, which leaves |11⟩. The pair is now a product state: the measurement consumed the entanglement.',
          hints: ['Which terms of (|00⟩ + |11⟩)/√2 are consistent with measuring 1?']
        },
        {
          id: 'q6l3q2',
          kind: 'choice',
          concept: 'ghz-w',
          prompt: 'One qubit of a W state is measured and gives 0. What is left?',
          difficulty: 'advanced',
          options: [
            'Two qubits in a product state',
            'Two qubits still entangled, in a Bell state',
            'Both remaining qubits are 1',
            'The state is destroyed'
          ],
          answer: 1,
          explanation:
            'The terms with that qubit at 0 are the two where one of the others is 1, which leaves a Bell state. This robustness to losing a qubit is exactly what distinguishes W from GHZ, where any measurement collapses everything.',
          hints: ['Write down the terms of |W⟩ with that qubit at 0.']
        },
        {
          id: 'q6l3q3',
          kind: 'number',
          concept: 'ghz-w',
          prompt: 'In the W state, what is the probability of measuring the first qubit as 1? Give it as a percentage.',
          difficulty: 'intermediate',
          answer: 33.33,
          tolerance: 0.5,
          explanation: 'One of the three terms has the first qubit at 1, with amplitude 1/√3, so the probability is 1/3 ≈ 33.3%.',
          hints: ['Square 1/√3.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q6l4',
      title: 'Density matrices, purity and the partial trace',
      intro:
        'The formal tool that makes the earlier intuitions exact: a superposition and a mixture are different objects, and an entangled part is a mixed state.',
      objectives: [
        'Write a density matrix and read its diagonal and off-diagonal terms',
        'Use purity to distinguish a pure state from a mixture',
        'Take a partial trace, and say what a mixed part means about the whole'
      ],
      concepts: ['density-matrix', 'mixed-states', 'purity', 'partial-trace'],
      requires: ['multi-qubit-states', 'quantum-vs-classical-random', 'entanglement'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A state vector cannot describe classical uncertainty. "Either |0⟩ or |1⟩, half each, and I do not know which" is not a vector — and Unit 03 showed it is a physically different situation from |+⟩. The **density matrix** describes both cases.'
        },
        { kind: 'formula', latex: '\\rho = |\\psi\\rangle\\langle\\psi| \\quad \\text{for a pure state} \\qquad \\rho = \\sum_i p_i |\\psi_i\\rangle\\langle\\psi_i| \\quad \\text{for a mixture}', caption: 'ρ (rho) is the density matrix. ⟨ψ| is a bra: the conjugate transpose of the ket, a row rather than a column. Multiplying a column by a row gives a matrix — the outer product. A mixture is a weighted sum of those, with the weights pᵢ being ordinary probabilities.' },
        { kind: 'heading', text: 'Reading one' },
        {
          kind: 'example',
          title: 'Three cases, side by side',
          text: '|0⟩          ρ = [1 0]      diagonal: 1, 0        off-diagonal: 0\n                 [0 0]\n\n|+⟩          ρ = [½ ½]      diagonal: ½, ½        off-diagonal: ½\n                 [½ ½]\n\nmixture of  ρ = [½ 0]      diagonal: ½, ½        off-diagonal: 0\n|0⟩ and |1⟩      [0 ½]\n\nThe last two have identical diagonals — identical measurement probabilities — and differ entirely in the off-diagonal terms.'
        },
        {
          kind: 'table',
          headers: ['Part of ρ', 'What it holds', 'What it means'],
          rows: [
            ['Diagonal', 'Populations', 'The probability of each basis outcome'],
            ['Off-diagonal', 'Coherence', 'The phase relationship between components — zero for a mixture']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'There it is, as a number. "A superposition has a relative phase and a mixture does not" was the informal statement in Unit 03; the off-diagonal term is that statement made measurable. The Quantum Studio prints it as coherence, and decoherence in Unit 14 is precisely those terms decaying to zero.'
        },
        { kind: 'heading', text: 'Purity' },
        { kind: 'formula', latex: '\\text{purity} = \\operatorname{tr}(\\rho^2)', caption: 'The trace of ρ² — add the diagonal of the matrix times itself. It is 1 for a pure state and 1/d for a completely mixed one, where d is the dimension: ½ for one qubit, ¼ for two.' },
        {
          kind: 'table',
          headers: ['State', 'Purity', 'What it is'],
          rows: [
            ['|0⟩ or |+⟩ or any single state vector', '1', 'Pure'],
            ['Equal mixture of |0⟩ and |1⟩', '0.5', 'Completely mixed, one qubit'],
            ['Half of a Bell pair', '0.5', 'Completely mixed — and this is the interesting one'],
            ['A Bell pair as a whole', '1', 'Pure']
          ]
        },
        { kind: 'heading', text: 'The partial trace, and what entanglement is' },
        {
          kind: 'text',
          text: 'Given a two-qubit state, the **partial trace** gives the density matrix of one qubit alone: everything you could learn by experimenting on that qubit and ignoring the other. For a product state it comes out pure. For an entangled state it comes out mixed.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'And that is the deepest characterisation of entanglement in this course: **a pure whole with mixed parts.** The pair is in a perfectly definite state — purity 1 — and each half is completely mixed, purity ½. The information is in the relationship and nowhere else. That is also why the Bloch vector of an entangled qubit has length zero: there is no point on the surface because there is no pure state to put there.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Purity, before and after entangling',
          does:
            'In the state inspector, build H on q0 only and read the purity of each qubit — both pure. Then add the CNOT and read them again: the whole state is still purity 1, and each qubit is now 0.5 with zero coherence. That table is entanglement, in numbers.'
        },
        { kind: 'check', questionId: 'q6l4q1' },
        { kind: 'check', questionId: 'q6l4q2' },
        { kind: 'check', questionId: 'q6l4q3' }
      ],
      questions: [
        {
          id: 'q6l4q1',
          kind: 'choice',
          concept: 'purity',
          prompt: 'A density matrix has purity 1. What does that tell you?',
          difficulty: 'advanced',
          options: [
            'The state is completely mixed',
            'The state is pure — describable by a single state vector',
            'The state is entangled',
            'The state has been measured'
          ],
          answer: 1,
          explanation:
            'Purity 1 means pure: a single state vector describes it. Lower purity means a mixture, and 1/d is completely mixed.',
          hints: ['What is tr(ρ²) for ρ = |ψ⟩⟨ψ|?']
        },
        {
          id: 'q6l4q2',
          kind: 'choice',
          concept: 'partial-trace',
          prompt: 'A two-qubit state is pure, and the partial trace of each qubit is completely mixed. What is the state?',
          difficulty: 'advanced',
          options: [
            'A product state',
            'Maximally entangled — a pure whole with mixed parts is exactly what entanglement is',
            'A classical mixture',
            'Impossible'
          ],
          answer: 1,
          explanation:
            'Pure as a whole, maximally mixed in each part. The information lives in the correlation rather than in either qubit, which is the formal content of maximal entanglement.',
          hints: ['Where is the information, if neither part has any?']
        },
        {
          id: 'q6l4q3',
          kind: 'choice',
          concept: 'mixed-states',
          prompt: 'Two density matrices have the same diagonal and different off-diagonal terms. What differs physically?',
          difficulty: 'advanced',
          options: [
            'Nothing — the diagonal is all that matters',
            'The measurement probabilities in this basis are identical, and the coherence differs — so they behave differently under any further gate',
            'One of them is invalid',
            'Their purities must be equal'
          ],
          answer: 1,
          explanation:
            'Same populations, different coherence. A measurement now cannot tell them apart; a Hadamard first can. This is the |+⟩-against-mixture distinction from Unit 03 in matrix form.',
          hints: ['Which part of the matrix does a measurement in this basis read?']
        }
      ]
    }
  ]
}
