import type { Module } from '../../types.ts'

/**
 * Unit 03 — Superposition, measurement and the shot.
 *
 * The experimental heart of the course. Superposition is introduced through the Hadamard gate rather than
 * through a slogan, measurement through actually measuring, and the sampling lesson exists because a learner who
 * does not understand shots will read every statistical result in the course as a broken simulator.
 *
 * The comparison lesson at the end — a classical random bit, an unknown bit, and a superposition — is the one
 * that replaces "both at once" with something true, by exhibiting an experiment that tells them apart.
 */
export const Q_UNIT_3: Module = {
  id: 'q3',
  title: 'Superposition and Measurement',
  summary:
    'The Hadamard gate, what a measurement does, shots and statistical convergence, measuring in another basis, and the experiment that distinguishes a superposition from ordinary uncertainty.',
  concepts: [
    'superposition',
    'hadamard',
    'plus-minus',
    'measurement',
    'collapse',
    'shots',
    'statistical-fluctuation',
    'measurement-basis',
    'quantum-vs-classical-random',
    'prediction-first'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q3l1',
      title: 'The Hadamard gate, and your first experiment',
      intro:
        'One gate, and the first thing in this course you can actually run. Predict the outcome before you do.',
      objectives: [
        'State what the Hadamard gate does to each basis state',
        'Predict the measurement distribution of H|0⟩ and check it',
        'Explain why H applied twice is the identity'
      ],
      // The first lesson that actually measures something, so it is the one that teaches measurement.
      concepts: ['superposition', 'hadamard', 'measurement', 'prediction-first'],
      requires: ['born-rule', 'relative-phase'],
      minutes: 16,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Before superposition, establish the boring case. Prepare |0⟩, measure it a thousand times: 0 every time. Prepare |1⟩ with an X gate, measure a thousand times: 1 every time. Measurement on a basis state is deterministic, and knowing that is what makes the next result meaningful.'
        },
        { kind: 'heading', text: 'The gate' },
        { kind: 'formula', latex: 'H = \\frac{1}{\\sqrt2}\\begin{bmatrix} 1 & 1 \\\\ 1 & -1 \\end{bmatrix}', caption: 'The Hadamard matrix. The 1/√2 keeps it normalised; the single minus sign in the corner is what makes it useful, and what makes H|0⟩ and H|1⟩ different states rather than the same one.' },
        { kind: 'formula', latex: 'H|0\\rangle = \\frac{|0\\rangle + |1\\rangle}{\\sqrt2} = |+\\rangle \\qquad H|1\\rangle = \\frac{|0\\rangle - |1\\rangle}{\\sqrt2} = |-\\rangle', caption: 'Both results have amplitudes of magnitude 1/√2, so both measure fifty-fifty. They differ in the relative sign, which Unit 02 established is a real difference.' },
        { kind: 'heading', text: 'Predict, then run' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Write down your answers to these before opening the laboratory. (1) H on |0⟩, measured once — what comes out? (2) H on |0⟩, measured 1,000 times — what distribution? (3) H on |0⟩, then H again, measured 1,000 times — what distribution? Committing first is what makes the result teach you something.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Your first superposition',
          does:
            'Apply H to one qubit and measure 1,000 times. Compare the counts with the exact probabilities shown beside them. Then add a second H and measure again — and notice that the second result is not 50/50 but exactly 0 every time.'
        },
        { kind: 'heading', text: 'Why twice is nothing' },
        {
          kind: 'text',
          text: 'H|0⟩ is |+⟩, and H|+⟩ is |0⟩ again. Working it through: the second Hadamard turns |0⟩ into (|0⟩+|1⟩)/√2 and |1⟩ into (|0⟩−|1⟩)/√2, and adding those two with the amplitudes from |+⟩ gives |0⟩ with amplitude 1 and |1⟩ with amplitude exactly 0 — the |1⟩ contributions cancel.'
        },
        { kind: 'formula', latex: 'H^2 = I', caption: 'H is its own inverse. This is a circuit identity, not a coincidence, and the cancellation that produces it is interference.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Notice what this rules out. If a superposition were "the qubit is secretly 0 or 1 and we do not know which", then applying a second Hadamard to that unknown bit would give 50/50 again — because H applied to |0⟩ or to |1⟩ both give an even spread. Instead it gives 0 with certainty. A hidden classical value cannot produce that, and this four-gate experiment is the demonstration.'
        },
        { kind: 'check', questionId: 'q3l1q1' },
        { kind: 'check', questionId: 'q3l1q2' },
        { kind: 'check', questionId: 'q3l1q3' }
      ],
      questions: [
        {
          id: 'q3l1q1',
          kind: 'choice',
          concept: 'hadamard',
          prompt: 'H is applied to |0⟩ and the qubit is measured 1,000 times. What do you expect?',
          difficulty: 'beginner',
          options: [
            'Exactly 500 zeros and 500 ones',
            'Roughly half and half, with the usual sampling variation — perhaps 487 and 513',
            '1,000 zeros',
            'The result is unpredictable in any way'
          ],
          answer: 1,
          explanation:
            'The probability is exactly 0.5 each. The counts are a sample, so they will be near the middle and not exactly on it. Expecting exactly 500 is the mistake the next lesson is about.',
          hints: ['Think about flipping a fair coin a thousand times.']
        },
        {
          id: 'q3l1q2',
          kind: 'choice',
          concept: 'hadamard',
          prompt: 'H, then H again, on |0⟩, measured 1,000 times. What comes out?',
          difficulty: 'intermediate',
          options: ['About 50/50', '0 every time', '1 every time', 'About 25/75'],
          answer: 1,
          explanation:
            'H² = I, so the state is |0⟩ again and the outcome is 0 with certainty. The |1⟩ amplitudes from the two halves of the superposition cancelled exactly.',
          hints: ['What does applying the same gate twice do, for this particular gate?']
        },
        {
          id: 'q3l1q3',
          kind: 'choice',
          concept: 'superposition',
          prompt: 'Why does the H-H result rule out "the qubit was secretly 0 or 1 all along"?',
          difficulty: 'advanced',
          options: [
            'Because the result is random',
            'Because a Hadamard on either |0⟩ or |1⟩ gives an even spread, so a hidden classical value would give 50/50 — and the experiment gives 0 with certainty',
            'Because superposition cannot be measured',
            'It does not rule it out'
          ],
          answer: 1,
          explanation:
            'Trace the hidden-value story through: whichever value it secretly had, the second Hadamard would spread it evenly. Certainty at the end is incompatible with that, so the intermediate state was not a hidden 0 or 1.',
          hints: ['Work out what H does to |0⟩ and to |1⟩ separately, then ask what a mixture of those would give.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q3l2',
      title: 'Shots, sampling and convergence',
      intro:
        'A measurement gives one outcome. Everything you know about a quantum state comes from many of them, and understanding that is what stops every statistical result looking like a bug.',
      objectives: [
        'Define a shot and distinguish observed frequency from theoretical probability',
        'Say roughly how fast a sample converges',
        'Explain what a seed does, and what it is not'
      ],
      concepts: ['shots', 'statistical-fluctuation', 'reproducibility'],
      requires: ['measurement', 'born-rule'],
      minutes: 14,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **shot** is one complete run: prepare the state, apply the circuit, measure, record. One shot of H|0⟩ gives 0 or 1 and tells you almost nothing. The probability is not something you can read off a single run — it is something you estimate from many.'
        },
        {
          kind: 'table',
          headers: ['Shots', 'A typical result for H|0⟩', 'Estimate of P(1)', 'Typical error'],
          rows: [
            ['1', '1', '100%', 'meaningless'],
            ['10', '6 ones', '60%', '±16%'],
            ['100', '47 ones', '47%', '±5%'],
            ['1,000', '508 ones', '50.8%', '±1.6%'],
            ['10,000', '4,973 ones', '49.7%', '±0.5%'],
            ['100,000', '50,061 ones', '50.06%', '±0.16%']
          ]
        },
        {
          kind: 'text',
          text: 'The error shrinks like 1/√(shots) — a hundred times the shots for a tenfold improvement. That is the rule of thumb worth remembering, and it is why estimating a small probability accurately is expensive.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'So a result that is not exactly 50/50 is not a broken simulator. It is a sample. The Quantum Studio prints the exact probabilities beside the counts for precisely this reason: it lets you see how far the sample is from the theory, rather than wondering.'
        },
        { kind: 'heading', text: 'Exact, sampled, and why both exist' },
        {
          kind: 'table',
          headers: ['Mode', 'What it gives', 'What hardware can do'],
          rows: [
            ['Exact state vector', 'Every amplitude, exactly', 'Nothing like it — you cannot read a state'],
            ['Sampled measurement', 'Counts of outcomes', 'This is all a real device gives you'],
            ['Noisy sampled', 'Counts, with errors applied', 'This is what a real device actually gives you']
          ]
        },
        {
          kind: 'text',
          text: 'A simulator can show you the state, which is enormously useful for learning and impossible in reality. Confusing the two is a habit worth not forming — which is why every result in the studio is labelled exact, sampled or noisy average, and never presented without a label.'
        },
        { kind: 'heading', text: 'Seeds' },
        {
          kind: 'text',
          text: 'The studio lets you fix a **seed**, after which the same circuit gives the same counts every time. That makes an experiment reproducible — you can show somebody the exact result you saw — and it is worth being clear about what it is not. The simulator uses a pseudorandom generator: a deterministic sequence that looks random. A real measurement is not that. The seed is an honest convenience and the course says so rather than letting it pass as quantum randomness.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Watch a sample converge',
          does:
            'Measure H|0⟩ with 10 shots, then 100, then 1,000, then 10,000, and write down the estimate each time against the exact 50%. Then set a seed and run twice at the same count — identical results, which is what reproducibility means here.'
        },
        { kind: 'check', questionId: 'q3l2q1' },
        { kind: 'check', questionId: 'q3l2q2' }
      ],
      questions: [
        {
          id: 'q3l2q1',
          kind: 'choice',
          concept: 'statistical-fluctuation',
          prompt: '100 shots of H|0⟩ give 43 ones. What should you conclude?',
          difficulty: 'intermediate',
          options: [
            'The simulator is wrong — it should be 50',
            'Nothing is wrong: 43 is well inside the sampling variation for 100 shots, and more shots would narrow the estimate',
            'The probability really is 43%',
            'The circuit was built incorrectly'
          ],
          answer: 1,
          explanation:
            'The expected deviation at 100 shots is about ±5, so 43 is unremarkable. Reading a sample as the true probability — the third option — is the mistake this lesson exists to prevent.',
          hints: ['How big is the typical error at a hundred shots?']
        },
        {
          id: 'q3l2q2',
          kind: 'choice',
          concept: 'reproducibility',
          prompt: 'What does fixing the seed in the simulator achieve?',
          difficulty: 'intermediate',
          options: [
            'It makes the quantum outcome deterministic in reality',
            'It makes the simulated run repeatable, because the pseudorandom sequence is the same — which is useful and is not physical randomness',
            'It removes sampling error',
            'It speeds up the simulation'
          ],
          answer: 1,
          explanation:
            'Repeatability of a simulation. The sampling error is still there — the same sampling error every time. And it remains a pseudorandom sequence rather than anything a measuring device would produce.',
          hints: ['What stays the same between two seeded runs, and what does not improve?']
        },
        {
          id: 'q3l2q3',
          kind: 'choice',
          concept: 'shots',
          prompt: 'You want to halve the error on an estimated probability. Roughly what must you do?',
          difficulty: 'advanced',
          options: ['Double the shots', 'Quadruple the shots', 'Take ten times the shots', 'Use a different seed'],
          answer: 1,
          explanation: 'Error falls like 1/√n, so halving it needs four times the shots. A tenfold improvement needs a hundredfold increase, which is why precise estimates of small probabilities are expensive.',
          hints: ['The error goes as one over the square root of the count.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q3l3',
      title: 'Measurement, collapse and another basis',
      intro:
        'What a measurement actually does to the state, and the fact that the computational basis is a choice rather than the only option.',
      objectives: [
        'Describe what a projective measurement does to the state',
        'Explain why the computational basis is one choice among many',
        'Build a circuit that measures in the X basis'
      ],
      concepts: ['measurement', 'collapse', 'measurement-basis'],
      requires: ['born-rule', 'hadamard'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'heading', text: 'What a measurement does' },
        {
          kind: 'text',
          text: 'Measuring a qubit in the computational basis does two things. It produces an outcome — 0 with probability |α|², 1 with probability |β|². And it leaves the qubit in the state consistent with that outcome: if you measured 0, the qubit is now |0⟩, and measuring again gives 0 with certainty.'
        },
        {
          kind: 'example',
          title: 'Measuring twice',
          text: 'Start: (|0⟩ + |1⟩)/√2\n\nFirst measurement  → 0 (probability ½). The state is now |0⟩.\nSecond measurement → 0, with certainty. And the third, and the hundredth.\n\nThe superposition is gone. Not hidden — gone. Nothing in the qubit now distinguishes it from one prepared in |0⟩.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is the one irreversible operation in the whole subject. Every gate can be undone; a measurement cannot. It is also why the Quantum Studio refuses to invert a circuit containing one, with that reason given rather than a generic error.'
        },
        { kind: 'heading', text: 'The basis is a choice' },
        {
          kind: 'text',
          text: 'Nothing privileges |0⟩ and |1⟩. They are two perpendicular directions, and any other perpendicular pair would do. The commonest alternative is the X basis:'
        },
        { kind: 'formula', latex: '|+\\rangle = \\frac{|0\\rangle + |1\\rangle}{\\sqrt2} \\qquad |-\\rangle = \\frac{|0\\rangle - |1\\rangle}{\\sqrt2}', caption: 'These two are also perpendicular, and also a complete basis: any qubit state can be written in terms of them instead. Measuring "in the X basis" means asking which of these two the qubit is.' },
        {
          kind: 'table',
          headers: ['State', 'Measured in Z', 'Measured in X'],
          rows: [
            ['|0⟩', '0, always', '+ or −, fifty-fifty'],
            ['|1⟩', '1, always', '+ or −, fifty-fifty'],
            ['|+⟩', '0 or 1, fifty-fifty', '+, always'],
            ['|−⟩', '0 or 1, fifty-fifty', '−, always']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Read that table carefully. Certainty in one basis means complete uncertainty in the other, and the reverse. Which basis you measure in decides which question you are asking, and no basis answers both.'
        },
        { kind: 'heading', text: 'How to do it' },
        {
          kind: 'text',
          text: 'Hardware measures in one basis. To measure in another, you rotate the state first — apply a gate that takes the basis you want onto the basis the device reads.'
        },
        {
          kind: 'table',
          headers: ['To measure in', 'Apply first', 'Then'],
          rows: [
            ['Z — the default', 'nothing', 'measure'],
            ['X', 'H', 'measure: 0 means +, 1 means −'],
            ['Y', 'S† then H', 'measure: 0 means +i, 1 means −i']
          ]
        },
        {
          kind: 'text',
          text: 'H is its own inverse, which is why it serves to convert in both directions: it maps |+⟩ to |0⟩ and |−⟩ to |1⟩, so a Z-basis measurement afterwards is an X-basis measurement of the original state.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Measure the same state in two bases',
          does:
            'Prepare |+⟩ with a Hadamard and measure 1,000 times — fifty-fifty. Now add a second Hadamard before the measurement, which makes it an X-basis measurement, and measure again — one outcome, every time. The same state, two different questions, two different answers.'
        },
        { kind: 'check', questionId: 'q3l3q1' },
        { kind: 'check', questionId: 'q3l3q2' },
        { kind: 'check', questionId: 'q3l3q3' }
      ],
      questions: [
        {
          id: 'q3l3q1',
          kind: 'choice',
          concept: 'collapse',
          prompt: 'A qubit in (|0⟩ + |1⟩)/√2 is measured and gives 0. What does a second measurement give?',
          difficulty: 'beginner',
          options: ['0 or 1, fifty-fifty again', '0, with certainty', '1, with certainty', 'It is undefined'],
          answer: 1,
          explanation:
            'The first measurement left the qubit in |0⟩, so every subsequent measurement in this basis gives 0. The superposition is not recoverable — measurement is the one irreversible operation here.',
          hints: ['What state is the qubit in after the first outcome?']
        },
        {
          id: 'q3l3q2',
          kind: 'choice',
          concept: 'measurement-basis',
          prompt: 'How do you measure a qubit in the X basis on hardware that only measures in Z?',
          difficulty: 'intermediate',
          options: [
            'You cannot',
            'Apply a Hadamard first, then measure — 0 then means |+⟩ and 1 means |−⟩',
            'Measure twice and average',
            'Apply an X gate first'
          ],
          answer: 1,
          explanation:
            'The Hadamard maps the X basis onto the Z basis, so the device reading Z is answering the X question. Rotating the state to suit the measurement is the general technique for every basis.',
          hints: ['Which gate takes |+⟩ to |0⟩?']
        },
        {
          id: 'q3l3q3',
          kind: 'choice',
          concept: 'measurement-basis',
          prompt: '|0⟩ is measured in the X basis. What comes out?',
          difficulty: 'intermediate',
          options: ['+ always', '− always', '+ or −, fifty-fifty', 'It cannot be measured in that basis'],
          answer: 2,
          explanation:
            '|0⟩ is an equal superposition of |+⟩ and |−⟩, so an X-basis measurement is maximally uncertain. Certainty in Z means complete uncertainty in X — the trade in the table.',
          hints: ['Write |0⟩ in terms of |+⟩ and |−⟩.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q3l4',
      title: 'Superposition against ordinary uncertainty',
      intro:
        'Three situations that give identical fifty-fifty counts, and the experiment that tells them apart. This is the lesson that replaces "both at once" with something you can defend.',
      objectives: [
        'Distinguish a classical random bit, an unknown bit and a superposition',
        'Describe an experiment that separates them',
        'Say what a mixed state is, ahead of the formal treatment'
      ],
      concepts: ['quantum-vs-classical-random', 'misconceptions', 'plus-minus'],
      requires: ['hadamard', 'measurement-basis'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Three boxes, each of which produces 0 half the time and 1 half the time when you look.' },
        {
          kind: 'table',
          headers: ['', 'What is inside', 'Measured in Z'],
          rows: [
            ['A — a coin', 'A bit that was set to 0 or 1 by a coin toss. It has a value; nobody looked', '50/50'],
            ['B — an unknown bit', 'A bit somebody set deliberately and did not tell you', '50/50 across many boxes'],
            ['C — a superposition', 'A qubit in |+⟩', '50/50']
          ]
        },
        {
          kind: 'text',
          text: 'A and B are **classical uncertainty**: there is a fact and you do not know it. C is different, and the difference is testable.'
        },
        { kind: 'heading', text: 'The test' },
        {
          kind: 'text',
          text: 'Apply a Hadamard before measuring.'
        },
        {
          kind: 'table',
          headers: ['Box', 'Apply H, then measure in Z', 'Why'],
          rows: [
            ['A — a coin', '50/50', 'H on |0⟩ gives an even spread; H on |1⟩ gives an even spread; either way, 50/50'],
            ['B — an unknown bit', '50/50', 'The same argument'],
            ['C — |+⟩', '0, every time', 'H|+⟩ = |0⟩. The two halves interfere and the |1⟩ amplitude cancels exactly']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'One gate separates them completely. That is as concrete as this distinction gets: a superposition is not a hidden value, because a hidden value cannot produce certainty after a Hadamard. Anybody who says "it is really 0 or 1 and we do not know which" is making a claim this experiment refuses.'
        },
        { kind: 'heading', text: 'What the difference is, in a word' },
        {
          kind: 'text',
          text: 'A superposition has **relative phase**; a classical mixture does not. |+⟩ and |−⟩ both measure fifty-fifty and are told apart by a Hadamard. A coin-toss bit is not |+⟩ or |−⟩ — it is a **mixture**, and a mixture has no relative phase to flip.'
        },
        {
          kind: 'text',
          text: 'Unit 06 gives this a formal description — the density matrix, where a superposition has non-zero off-diagonal terms and a mixture has zeros there. The number is called coherence, and the Quantum Studio prints it. For now the important thing is that the distinction is physical and detectable rather than philosophical.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And this is what decoherence destroys. When a qubit interacts with its environment it turns from a superposition into a mixture — the probabilities survive, the phase does not, and the interference that every algorithm depends on stops working. Unit 14 is about that, and it is the central engineering problem of the field.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Tell them apart yourself',
          does:
            'Build H then measure, and record the counts. Then build H, H, measure and record again. The first is box C measured directly; the second is box C put through the test. Then reason out what boxes A and B would give in each case — and check the state inspector coherence figure for |+⟩ against a measured qubit.'
        },
        { kind: 'check', questionId: 'q3l4q1' },
        { kind: 'check', questionId: 'q3l4q2' },
        { kind: 'check', questionId: 'q3l4q3' }
      ],
      questions: [
        {
          id: 'q3l4q1',
          kind: 'choice',
          concept: 'quantum-vs-classical-random',
          prompt: 'A coin-toss bit, unobserved, has a Hadamard applied and is then measured. What comes out?',
          difficulty: 'intermediate',
          options: [
            '0, every time',
            '50/50 — whichever value it had, a Hadamard spreads it evenly',
            '1, every time',
            'It cannot be put through a Hadamard'
          ],
          answer: 1,
          explanation:
            'H|0⟩ and H|1⟩ both give an even spread, so a mixture of the two is still even afterwards. That is exactly why certainty in this experiment demonstrates a superposition rather than a hidden value.',
          hints: ['Work out each case separately, then combine them with weights of a half.']
        },
        {
          id: 'q3l4q2',
          kind: 'choice',
          concept: 'quantum-vs-classical-random',
          prompt: 'What distinguishes |+⟩ from a classical mixture of |0⟩ and |1⟩?',
          difficulty: 'advanced',
          options: [
            'Nothing — they give the same measurement statistics',
            'The superposition has a relative phase between its components, which produces interference; the mixture has none',
            'The mixture cannot be measured',
            'The superposition has higher probability of 1'
          ],
          answer: 1,
          explanation:
            'Relative phase, and therefore interference. The statistics in one basis are identical, which is why the distinction has to be demonstrated with a gate before the measurement rather than argued about.',
          hints: ['What does the Hadamard experiment reveal?']
        },
        {
          id: 'q3l4q3',
          kind: 'short',
          concept: 'misconceptions',
          prompt: 'Why is "the qubit is secretly 0 or 1 and we do not know which" wrong?',
          difficulty: 'advanced',
          answer: 'because a hidden value would still give 50/50 after a Hadamard, and a superposition gives certainty',
          accepts: [
            'a hidden value cannot produce interference',
            'because of the hadamard experiment',
            'a mixture gives 50/50 after h, a superposition does not',
            'interference rules it out'
          ],
          explanation:
            'The experiment refuses it. A hidden classical value gives an even spread after a Hadamard; the superposition gives one outcome with certainty. The claim is not merely unhelpful — it predicts the wrong result.',
          hints: ['Name the experiment and what each story predicts.']
        }
      ]
    }
  ]
}
