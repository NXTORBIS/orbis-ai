import type { Module } from '../../types.ts'

/**
 * Unit 13 — Noise.
 *
 * The unit that explains why none of the previous nine works on real hardware yet. Noise is taught channel by
 * channel because the channels fail differently, and the phase-error lesson is the one that matters most: an
 * error invisible in the computational basis and fatal to interference is the hardest thing to teach and the
 * easiest to meet.
 *
 * Every noisy figure in this unit is an average over trajectories with sampling error, and the lessons say so
 * each time rather than letting a noisy number pass as an exact one.
 */
export const Q_UNIT_13: Module = {
  id: 'q13',
  title: 'Noise and Decoherence',
  summary:
    'Decoherence, the standard noise channels, why a phase error hides, readout error as a separate fault, T₁ and T₂, and why depth rather than gate count is what noise punishes.',
  concepts: [
    'decoherence',
    'noise-channels',
    'phase-error-invisibility',
    'readout-error',
    't1-t2',
    'error-accumulation',
    'noise-aware-design',
    'fidelity'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q13l1',
      title: 'Decoherence, and the channels',
      intro:
        'What goes wrong physically, and the four standard models of it. Each one fails in its own way, which is why they are taught separately.',
      objectives: [
        'Say what decoherence is in terms of the density matrix',
        'Describe the four standard noise channels',
        'Say which of them a computational-basis measurement can see'
      ],
      concepts: ['decoherence', 'noise-channels', 'fidelity'],
      requires: ['relative-phase', 'mixed-states', 'purity'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Everything so far assumed a closed system: a qubit, some gates, nothing else. Real qubits sit in a world of stray fields, thermal vibration, control pulses that are slightly the wrong shape, and neighbouring qubits. The result is **decoherence**.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Unit 06 gives the precise statement. A superposition has non-zero off-diagonal terms in its density matrix; a classical mixture has zeros there. Decoherence is those terms decaying toward zero. The populations survive — the probabilities still look reasonable — and the coherence that interference depends on is gone. That is why a decohered circuit produces plausible nonsense rather than an obvious failure.'
        },
        { kind: 'heading', text: 'The four channels' },
        {
          kind: 'table',
          headers: ['Channel', 'With probability p', 'Visible in a Z measurement?', 'Models'],
          rows: [
            ['Bit flip', 'An X is applied', 'Yes, immediately', 'A control pulse that over- or under-rotates'],
            ['Phase flip', 'A Z is applied', '**No**', 'Stray fields shifting the energy levels'],
            ['Depolarising', 'One of X, Y, Z at random', 'Partly', 'The general case — a catch-all model'],
            ['Amplitude damping', '|1⟩ relaxes to |0⟩', 'Yes', 'Energy leaking to the environment'],
            ['Phase damping', 'The phase is randomised', 'No', 'Coherence lost with no energy loss']
          ]
        },
        {
          kind: 'text',
          text: 'Amplitude damping is worth noting as the asymmetric one: it pushes qubits toward |0⟩ and never the other way, because |0⟩ is the low-energy state and the environment is cold. A qubit left idle drifts to |0⟩ — which is sometimes convenient and always a loss of whatever it was holding.'
        },
        { kind: 'heading', text: 'Fidelity' },
        {
          kind: 'text',
          text: 'The usual summary number: how close the noisy result is to the ideal one, from 0 to 1. For distributions, a simple and honest version is the overlap — the sum over outcomes of the smaller of the two probabilities, which is the share of results the two agree about.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Every noisy figure in this course is an **average over trajectories**: the simulator applies random errors and runs many times, so the result carries sampling error as well as noise. The Quantum Studio labels it "noisy average" for that reason, and never alongside the word exact. A noisy number quoted without a shot count is not a measurement.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Break a Bell state four ways',
          does:
            'Build a Bell state, then run it with each channel in turn at the same error rate and compare the distributions and the fidelity. The bit flip and the damping show up immediately; the phase flip does not. That asymmetry is the next lesson.'
        },
        { kind: 'check', questionId: 'q13l1q1' },
        { kind: 'check', questionId: 'q13l1q2' }
      ],
      questions: [
        {
          id: 'q13l1q1',
          kind: 'choice',
          concept: 'decoherence',
          prompt: 'In terms of the density matrix, what is decoherence?',
          difficulty: 'advanced',
          options: [
            'The populations drifting toward equality',
            'The off-diagonal terms decaying toward zero — a superposition turning into a classical mixture',
            'The trace falling below 1',
            'The state becoming unnormalised'
          ],
          answer: 1,
          explanation:
            'Coherence is the off-diagonal term, and decoherence is its decay. The populations can look unchanged while the interference the algorithm needed has quietly disappeared.',
          hints: ['Which part of the matrix separated a superposition from a mixture?']
        },
        {
          id: 'q13l1q2',
          kind: 'choice',
          concept: 'noise-channels',
          prompt: 'A qubit is left idle for a long time. Which channel describes it drifting toward |0⟩?',
          difficulty: 'intermediate',
          options: ['Bit flip', 'Phase flip', 'Amplitude damping', 'Readout error'],
          answer: 2,
          explanation:
            'Amplitude damping: energy leaks to a cold environment, so |1⟩ relaxes to |0⟩ and never the reverse. It is the asymmetric channel, and T₁ is the time constant for it.',
          hints: ['Which one is about energy?']
        },
        {
          id: 'q13l1q3',
          kind: 'choice',
          concept: 'fidelity',
          prompt: 'A noisy simulation reports fidelity 0.82 from 1,000 shots. What is that number?',
          difficulty: 'advanced',
          options: [
            'An exact property of the noisy circuit',
            'An estimate, averaged over trajectories, with sampling error on top of the noise — more shots would tighten it',
            'The probability of the correct answer',
            'A measure of the gate count'
          ],
          answer: 1,
          explanation:
            'Trajectory simulation gives an average with sampling error, which is why the shot count belongs with the figure. It is not an exact quantity, and it is not the probability of any single outcome.',
          hints: ['How was the number produced?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q13l2',
      title: 'Why a phase error hides',
      intro:
        'The most instructive failure in the subject: an error that changes no measurement result and destroys the algorithm anyway.',
      objectives: [
        'Show that a phase flip is invisible in the computational basis',
        'Show that it is obvious after a Hadamard',
        'Say what this means for testing a quantum system'
      ],
      concepts: ['phase-error-invisibility', 'readout-error'],
      requires: ['noise-channels', 'measurement-basis'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'example',
          title: 'The experiment, twice',
          text: 'Prepare |0⟩. Apply a phase-flip channel with p = 0.5. Measure.\n  → 0 every time. The channel applied Z half the time, and Z|0⟩ = |0⟩.\n  The error rate measured in this basis: zero. The channel is doing nothing visible.\n\nNow prepare |0⟩, apply H, apply the same channel, apply H, measure.\n  → about 50/50 instead of 0 every time.\n  The same channel has destroyed a circuit that should be deterministic.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Read those two results together. A test that prepares basis states and measures them reports a perfect device. The same device cannot run a circuit whose answer depends on interference — which is every circuit worth running. A phase error is invisible to the obvious test and fatal to the actual workload.'
        },
        { kind: 'heading', text: 'What follows for testing' },
        {
          kind: 'list',
          items: [
            'Characterise a device in **several bases**, not just the computational one.',
            'Use circuits whose correct answer is deterministic and depends on interference — H-H and H-Z-H are the smallest such pair.',
            'Measure T₂ as well as T₁. The next lesson explains why both are needed.',
            'Randomised benchmarking, in Unit 15, exists precisely because single-basis tests flatter a device.'
          ]
        },
        { kind: 'heading', text: 'Readout error, which is different again' },
        {
          kind: 'text',
          text: 'A separate fault, and worth separating: the state is perfect, the measurement apparatus reports the wrong value. A qubit genuinely in |0⟩ recorded as 1, with some probability, independent of everything else.'
        },
        {
          kind: 'table',
          headers: ['', 'Gate noise', 'Readout error'],
          rows: [
            ['Where', 'During the circuit', 'At the measurement'],
            ['Affects the state?', 'Yes', 'No — the state was fine'],
            ['Accumulates with depth?', 'Yes', 'No — it happens once'],
            ['Correctable?', 'By error correction', 'By calibration: measure known states and invert the error matrix']
          ]
        },
        {
          kind: 'text',
          text: 'Readout error is often the largest single error on current hardware, and it is also the most tractable: prepare known states, record how often each is misreported, build the matrix, and correct the statistics afterwards. That is **mitigation** rather than correction — it fixes the aggregate numbers and does nothing for an individual shot.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Hide an error, then reveal it',
          does:
            'Run a single qubit with the phase-flip channel at a high rate and measure: no errors at all. Then put the same channel inside an H-H circuit and measure again. Then switch to readout error and watch the opposite pattern — errors on a bare qubit, no extra damage from depth.'
        },
        { kind: 'check', questionId: 'q13l2q1' },
        { kind: 'check', questionId: 'q13l2q2' },
        { kind: 'check', questionId: 'q13l2q3' }
      ],
      questions: [
        {
          id: 'q13l2q1',
          kind: 'choice',
          concept: 'phase-error-invisibility',
          prompt: 'A device is tested by preparing |0⟩ and |1⟩ and measuring. It reports no errors. What has the test missed?',
          difficulty: 'advanced',
          options: [
            'Nothing — the device is perfect',
            'Phase errors, which do nothing to basis states and destroy any circuit relying on interference',
            'Readout errors',
            'The qubit count'
          ],
          answer: 1,
          explanation:
            'Z leaves |0⟩ and |1⟩ alone, so a phase-flip channel is invisible to that test. The device could fail completely on H-Z-H while reporting a perfect score — which is why characterisation uses several bases.',
          hints: ['What does Z do to a basis state?']
        },
        {
          id: 'q13l2q2',
          kind: 'choice',
          concept: 'readout-error',
          prompt: 'How does readout error differ from gate noise?',
          difficulty: 'intermediate',
          options: [
            'It is larger',
            'It happens once, at the measurement, and does not touch the state — so it does not accumulate with circuit depth',
            'It cannot be corrected',
            'It only affects |1⟩'
          ],
          answer: 1,
          explanation:
            'A single misreporting at the end, independent of the circuit. It is often the largest error on current devices and also the most tractable, since a calibration matrix can correct the statistics.',
          hints: ['When does it happen, and does the length of the circuit matter?']
        },
        {
          id: 'q13l2q3',
          kind: 'choice',
          concept: 'readout-error',
          prompt: 'Readout error is corrected with a calibration matrix. What does that achieve?',
          difficulty: 'advanced',
          options: [
            'Each individual shot becomes correct',
            'The aggregate statistics are corrected — mitigation, which does nothing for any single shot',
            'The state is protected during the circuit',
            'The error is eliminated at the source'
          ],
          answer: 1,
          explanation:
            'Mitigation works on distributions. You cannot know whether a particular shot was misreported; you can correct the counts. That distinction matters whenever a single run has to be trusted.',
          hints: ['Is the correction applied to one result or to many?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q13l3',
      title: 'T₁, T₂ and designing for noise',
      intro:
        'How hardware noise is actually specified, and what follows for circuit design: depth, two-qubit gates and idling are what cost you.',
      objectives: [
        'Say what T₁ and T₂ measure and why T₂ ≤ 2T₁',
        'Convert coherence times into a per-gate error probability',
        'Say what makes one circuit more noise-tolerant than an equivalent one'
      ],
      concepts: ['t1-t2', 'error-accumulation', 'noise-aware-design'],
      requires: ['decoherence', 'circuit-depth'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'table',
          headers: ['', 'What it measures', 'What destroys it'],
          rows: [
            ['T₁', 'How long a qubit stays in |1⟩ before relaxing to |0⟩', 'Energy loss to the environment'],
            ['T₂', 'How long a superposition keeps its phase', 'Energy loss **and** pure dephasing']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Because energy loss also destroys phase, T₂ can never exceed 2T₁ — a theorem, not a convention. A device specification claiming T₂ three times T₁ is wrong, and the Quantum Studio refuses such a pair with that reason given rather than simulating something impossible.'
        },
        { kind: 'heading', text: 'From times to error rates' },
        { kind: 'formula', latex: 'p_{\\text{error}} = 1 - e^{-t / T}', caption: 'The chance of an error during an operation lasting t, with time constant T. For t much smaller than T this is approximately t/T — so a gate taking a thousandth of T carries about a 0.1% error.' },
        {
          kind: 'example',
          title: 'A realistic sum',
          text: 'T₁ = 100 μs, T₂ = 80 μs, a one-qubit gate takes 20 ns, a two-qubit gate 200 ns.\n\nOne-qubit gate:   20 ns / 80 μs   = 0.025%\nTwo-qubit gate:  200 ns / 80 μs   = 0.25%\n\nA circuit of depth 100, mostly two-qubit gates:\n  Probability of surviving: (1 − 0.0025)^100 ≈ 78%\n\nDepth 1,000: about 8%. Depth 2,000: under 1%.\n\nThat is the wall. It is why depth, not gate count, is the number that decides whether a circuit can run.'
        },
        { kind: 'heading', text: 'Designing for it' },
        {
          kind: 'list',
          items: [
            '**Reduce depth** before reducing gate count. Operations on different qubits in the same layer cost one layer, not several.',
            '**Reduce two-qubit gates** especially — ten times the error rate, by the sum above.',
            '**Avoid idling.** A qubit doing nothing is still decohering. Scheduling matters.',
            '**Respect connectivity.** A CNOT between distant qubits becomes SWAPs, each three CNOTs, each with the two-qubit error rate.',
            '**Put the fragile part early**, where the state is still coherent, when the algorithm allows a choice.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'And the general lesson: two circuits that are mathematically identical can behave completely differently on hardware. "Equivalent" is a statement about the ideal case. Under noise, the shallower circuit with fewer two-qubit gates wins, and no amount of algebraic equivalence changes that.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Two identical circuits, two outcomes',
          does:
            'Build X then X on one qubit — the identity. Then build twenty X gates on one qubit — also the identity. Run both with a bit-flip channel at the same rate and compare the fidelity. Same function, very different survival.'
        },
        { kind: 'check', questionId: 'q13l3q1' },
        { kind: 'check', questionId: 'q13l3q2' },
        { kind: 'check', questionId: 'q13l3q3' }
      ],
      questions: [
        {
          id: 'q13l3q1',
          kind: 'choice',
          concept: 't1-t2',
          prompt: 'Why can T₂ never be more than twice T₁?',
          difficulty: 'advanced',
          options: [
            'By engineering convention',
            'Because energy loss also destroys phase, so the processes that limit T₁ necessarily limit T₂ as well',
            'Because T₂ is measured differently',
            'It can be, in some devices'
          ],
          answer: 1,
          explanation:
            'Relaxation destroys coherence as a side effect, so dephasing cannot outlast energy loss by more than a factor of two. It is a theorem, which is why a simulator should refuse an impossible pair.',
          hints: ['Does losing the energy also lose the phase?']
        },
        {
          id: 'q13l3q2',
          kind: 'choice',
          concept: 'error-accumulation',
          prompt: 'Two mathematically equivalent circuits: one of depth 10, one of depth 200. What differs on hardware?',
          difficulty: 'intermediate',
          options: [
            'Nothing — they compute the same thing',
            'The deep one is far more likely to fail, because every layer is another opportunity for error and the qubits decohere throughout',
            'The deep one is more accurate',
            'Only the runtime'
          ],
          answer: 1,
          explanation:
            'Equivalence is an ideal-case statement. Error probability compounds with depth, so the shallow circuit is the one that can actually be run — which is why noise-aware compilation exists.',
          hints: ['Work out the survival probability for each depth.']
        },
        {
          id: 'q13l3q3',
          kind: 'multi',
          concept: 'noise-aware-design',
          prompt: 'Which changes make a circuit more likely to survive on real hardware? Choose all that apply.',
          difficulty: 'advanced',
          options: [
            'Reducing the depth',
            'Replacing two-qubit gates with one-qubit gates where possible',
            'Adding more qubits to spread the work out',
            'Avoiding long idle periods'
          ],
          answer: [0, 1, 3],
          explanation:
            'Depth, two-qubit count and idling are the three that matter. More qubits is not in itself a help — it means more things decohering, and on a device with limited connectivity it can mean more SWAPs.',
          hints: ['One of these might make the connectivity problem worse.']
        }
      ]
    }
  ]
}
