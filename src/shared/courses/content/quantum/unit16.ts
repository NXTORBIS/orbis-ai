import type { Module } from '../../types.ts'

/**
 * Unit 16 — Applications, and how to do this properly.
 *
 * Simulation first, because it is the application the field was proposed for and the one with the strongest
 * case. Then cryptography, where BB84 is genuinely elegant and genuinely narrow. Then quantum machine learning,
 * treated with the scepticism the evidence currently supports.
 *
 * The final lesson is about method rather than content: predicting before running, reporting an experiment, and
 * the misconceptions revisited now that there is enough vocabulary to refuse them precisely.
 */
export const Q_UNIT_16: Module = {
  id: 'q16',
  title: 'Applications, and Doing This Properly',
  summary:
    'Quantum simulation and chemistry, BB84 and quantum randomness, quantum machine learning with honest baselines — and the experimental method the whole course has been building toward.',
  concepts: [
    'quantum-simulation',
    'time-evolution',
    'quantum-chemistry',
    'quantum-cryptography',
    'bb84',
    'quantum-randomness',
    'qml',
    'data-encoding',
    'prediction-first',
    'experiment-reporting',
    'misconceptions'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q16l1',
      title: 'Quantum simulation and chemistry',
      intro:
        'The application the field was invented for, and the one with the clearest case. Simulating quantum systems with quantum systems.',
      objectives: [
        'Say why quantum simulation is the strongest application',
        'Describe time evolution under a Hamiltonian',
        'Say what a molecular energy calculation involves and where it stands'
      ],
      concepts: ['quantum-simulation', 'time-evolution', 'quantum-chemistry'],
      requires: ['hamiltonian', 'why-quantum', 'vqe'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Unit 01 established the argument: describing n interacting quantum particles needs 2ⁿ numbers, which becomes impossible at a few dozen. A quantum computer of n qubits holds exactly that many amplitudes naturally. So set it up to behave like the system you want to study, let it evolve, and measure.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This is the application with the best case, for a specific reason: the problem is already quantum, so no encoding of classical data is needed and no classical answer has to be read out in full. You want one number — an energy, a rate, a spectrum — and that is what a measurement gives you. Several of the other proposed applications founder on exactly the step this one skips.'
        },
        { kind: 'heading', text: 'Time evolution' },
        { kind: 'formula', latex: '|\\psi(t)\\rangle = e^{-iHt}|\\psi(0)\\rangle', caption: 'The state at time t, given the state at time 0. H is the Hamiltonian, the observable representing energy; t is time; and e^{−iHt} is a unitary operator built from it. A quantum computer approximates this operator by a circuit, usually by splitting the time into small steps.' },
        {
          kind: 'text',
          text: 'The practical method — **Trotterisation** — breaks H into terms that are each easy to implement, applies them in sequence for a small time step, and repeats. The terms do not commute, so the ordering introduces an error that shrinks as the steps get smaller and the circuit gets deeper. That trade between accuracy and depth is the central engineering question of simulation, and Unit 13 explains why depth is the thing you cannot afford.'
        },
        { kind: 'heading', text: 'Molecular energies' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Write the molecular Hamiltonian in terms of electron orbitals.',
            'Map it onto qubits — each qubit representing whether an orbital is occupied, under one of several standard transformations.',
            'Prepare a trial state with a parameterised circuit and measure ⟨H⟩.',
            'Minimise, as in VQE. The lowest energy found is an upper bound on the ground state.',
            'Compare with a classical calculation, where one is possible.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The honest status. Small molecules — hydrogen, lithium hydride, a few others — have been run on real hardware, with results close to known classical values. That is a demonstration that the pipeline works, not a demonstration of advantage: those molecules can be computed classically to far better precision in less time. The molecules where a quantum computer would genuinely help need the error-corrected machines of Unit 14.'
        },
        {
          kind: 'text',
          text: 'Which is not a reason to dismiss it. The argument that quantum simulation will eventually matter is the strongest in the field, and the pipeline being demonstrated on small cases is how that eventually arrives. The error is in presenting today demonstrations as today usefulness.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Evolve a two-level system',
          does:
            'Build a circuit applying Rz and Rx rotations repeatedly with small angles — a Trotterised evolution under a simple Hamiltonian — and watch the state move on the Bloch sphere. Then double the step size and halve the number of steps, and see the trajectory degrade.',
          optional: true
        },
        {
          kind: 'lab',
          appId: 'molecule-lab',
          title: 'Look at a molecule classically first',
          does:
            'Examine a small molecule and its structure in the chemistry laboratory. The orbitals the quantum Hamiltonian is written over are these, and seeing them first makes the mapping step comprehensible.',
          optional: true
        },
        { kind: 'check', questionId: 'q16l1q1' },
        { kind: 'check', questionId: 'q16l1q2' }
      ],
      questions: [
        {
          id: 'q16l1q1',
          kind: 'choice',
          concept: 'quantum-simulation',
          prompt: 'Why is quantum simulation the strongest case among the proposed applications?',
          difficulty: 'advanced',
          options: [
            'It needs the fewest qubits',
            'The problem is already quantum, so no classical data has to be encoded and the answer wanted is a single number a measurement can give',
            'It has already been proved to work at scale',
            'It needs no Hamiltonian'
          ],
          answer: 1,
          explanation:
            'Both halves of the usual difficulty are absent: nothing has to be loaded in and nothing exponential has to be read out. Several other applications fail on precisely those steps.',
          hints: ['What do the other applications have to do that this one does not?']
        },
        {
          id: 'q16l1q2',
          kind: 'choice',
          concept: 'quantum-chemistry',
          prompt: 'Small molecules have been run on real hardware with results near the classical values. What does that establish?',
          difficulty: 'advanced',
          options: [
            'That quantum computers now beat classical chemistry',
            'That the pipeline works end to end — and nothing about advantage, since those molecules are computed better and faster classically',
            'That the method does not work',
            'That error correction is unnecessary'
          ],
          answer: 1,
          explanation:
            'A working demonstration, not an advantage. The molecules within reach of present hardware are comfortably within reach of classical methods, and the interesting ones need corrected machines.',
          hints: ['Could a classical computer do those same molecules?']
        },
        {
          id: 'q16l1q3',
          kind: 'choice',
          concept: 'time-evolution',
          prompt: 'Trotterisation splits time into small steps. What does that trade?',
          difficulty: 'advanced',
          options: [
            'Qubit count against accuracy',
            'Accuracy against circuit depth — smaller steps are more accurate and need a deeper circuit, which noise punishes',
            'Nothing; it is exact',
            'Classical work against quantum work'
          ],
          answer: 1,
          explanation:
            'Smaller steps reduce the ordering error and lengthen the circuit. Since depth is the resource noise consumes, this trade is the central engineering question in simulation.',
          hints: ['What gets better with smaller steps, and what gets worse?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q16l2',
      title: 'BB84 and quantum randomness',
      intro:
        'Quantum cryptography: not an algorithm, a protocol, and one whose security rests on the measurement and no-cloning results from earlier in the course.',
      objectives: [
        'Work through BB84 step by step',
        'Explain why eavesdropping leaves a detectable trace',
        'Say what quantum randomness is and what a simulator cannot provide'
      ],
      concepts: ['quantum-cryptography', 'bb84', 'quantum-randomness'],
      requires: ['measurement-basis', 'no-cloning', 'simulation-limits'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'callout',
          tone: 'warning',
          text: 'First, the distinction from Unit 12. **Quantum cryptography** uses quantum hardware to do a security task. **Post-quantum cryptography** is classical software resistant to quantum attack. They share three syllables and nothing else, and confusing them is the single most common error in this area.'
        },
        { kind: 'heading', text: 'BB84, step by step' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Alice picks a random bit and, independently, a random basis — Z or X. She prepares the bit in that basis and sends the qubit.',
            'Bob picks a random basis, independently, and measures. When his basis matches hers he gets her bit; when it does not he gets a random answer.',
            'They announce their **bases** publicly — never the bits.',
            'They discard every position where the bases differed. About half survive.',
            'They compare a sample of the surviving bits publicly and discard those too. If the sample agrees, the rest is a shared secret key.'
          ]
        },
        { kind: 'heading', text: 'Why eavesdropping shows' },
        {
          kind: 'text',
          text: 'An eavesdropper cannot copy the qubit — no-cloning. The best available is to measure it and send on what was found. But she does not know the basis, so half the time she measures in the wrong one, which both randomises her result and **changes the state she forwards**.'
        },
        {
          kind: 'example',
          title: 'The arithmetic of the trace',
          text: 'Alice sends |0⟩ in the Z basis. Bob happens to choose Z, so without interference he gets 0 with certainty.\n\nAn eavesdropper measuring in X gets + or − at random and forwards that. Bob now measures |+⟩ or |−⟩ in Z — and gets a random answer.\n\nSo on positions where the eavesdropper guessed wrong, Bob disagrees with Alice half the time.\n\nShe guesses wrong half the time, and causes an error half of those: about a 25% error rate on the compared sample. On a clean channel the rate is near zero.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That 25% is the whole protocol. Eavesdropping is not prevented — it is made **detectable**, by the measurement disturbance and no-cloning results from Units 03 and 08. Alice and Bob abandon a key whose error rate is too high and try again, so an eavesdropper can deny them a key and cannot steal one.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'And the real limitations, which are substantial. BB84 needs a quantum channel — fibre or free space — with distance limits set by loss, since no-cloning also forbids amplifying the signal. It distributes a key and does nothing else. It requires an authenticated classical channel for the basis comparison. And implementations have been attacked successfully through their hardware rather than their mathematics, which is the usual way real cryptography fails.'
        },
        { kind: 'heading', text: 'Quantum randomness' },
        {
          kind: 'text',
          text: 'Measuring |+⟩ gives 0 or 1 with no cause — not "a cause we cannot see", but no cause, under the standard interpretation of the theory. That makes quantum measurement an attractive source of randomness, and commercial devices exist.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The Quantum Studio cannot give you this. Its randomness is a seeded pseudorandom generator — deterministic, repeatable, and useful precisely because it is repeatable. The course labels it as such every time it appears, because a simulator claiming to produce physical randomness would be making a claim about hardware it does not have.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Generate and test a random sequence',
          does:
            'Measure H|0⟩ a few thousand times and look at the distribution, then test the sequence for bias and for runs. Then run it again with the same seed and get the identical sequence — which is exactly the property real quantum randomness would not have.'
        },
        { kind: 'check', questionId: 'q16l2q1' },
        { kind: 'check', questionId: 'q16l2q2' },
        { kind: 'check', questionId: 'q16l2q3' }
      ],
      questions: [
        {
          id: 'q16l2q1',
          kind: 'choice',
          concept: 'bb84',
          prompt: 'What does BB84 achieve against an eavesdropper?',
          difficulty: 'advanced',
          options: [
            'It prevents eavesdropping entirely',
            'It makes eavesdropping detectable — the disturbance raises the error rate on the compared sample, and a suspect key is abandoned',
            'It encrypts the message itself',
            'It identifies who the eavesdropper is'
          ],
          answer: 1,
          explanation:
            'Detection, not prevention. An eavesdropper can deny Alice and Bob a key by interfering constantly; she cannot obtain one without leaving a trace in the error rate.',
          hints: ['What do Alice and Bob do when the sample disagrees?']
        },
        {
          id: 'q16l2q2',
          kind: 'choice',
          concept: 'quantum-cryptography',
          prompt: 'How does quantum cryptography differ from post-quantum cryptography?',
          difficulty: 'intermediate',
          options: [
            'They are the same thing',
            'Quantum cryptography needs quantum hardware and a quantum channel; post-quantum cryptography is classical software you can deploy today',
            'Post-quantum cryptography needs quantum hardware',
            'Quantum cryptography is unbreakable'
          ],
          answer: 1,
          explanation:
            'Different hardware, different problems, different deployment stories. The confusion between them is the most common error in writing about this area.',
          hints: ['What does each one run on?']
        },
        {
          id: 'q16l2q3',
          kind: 'choice',
          concept: 'quantum-randomness',
          prompt: 'Can the simulator in this course produce genuine quantum randomness?',
          difficulty: 'intermediate',
          options: [
            'Yes, because it simulates measurement',
            'No — it uses a seeded pseudorandom generator, which is deterministic and repeatable, and the course labels it as such',
            'Yes, if the seed is left unset',
            'Only for single qubits'
          ],
          answer: 1,
          explanation:
            'A simulator can only produce pseudorandomness. Repeatability is useful for experiments and is precisely the property physical quantum randomness lacks.',
          hints: ['What happens if you run twice with the same seed?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q16l3',
      title: 'Quantum machine learning, sceptically',
      intro:
        'An active research area with a great deal of enthusiasm and little established advantage. The useful thing to learn is how to assess a claim in it.',
      objectives: [
        'Describe how classical data is encoded into a quantum state',
        'Say what the input and output bottlenecks are',
        'Assess a QML claim against a proper baseline'
      ],
      concepts: ['qml', 'data-encoding'],
      requires: ['parameterised-circuits', 'cost-function'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The shape is the hybrid loop from Unit 15: encode an input into a quantum state, pass it through a parameterised circuit, measure, treat the result as a prediction, and train the parameters with a classical optimiser against a loss. A quantum model, trained classically.'
        },
        { kind: 'heading', text: 'Encoding' },
        {
          kind: 'table',
          headers: ['Method', 'How', 'Cost', 'Problem'],
          rows: [
            ['Basis encoding', 'Each bit of the input to one qubit', 'One qubit per bit', 'Uses a lot of qubits for little data'],
            ['Angle encoding', 'Each feature becomes a rotation angle', 'One qubit per feature', 'Straightforward; limited capacity per qubit'],
            ['Amplitude encoding', 'The data vector becomes the amplitudes', 'log₂ n qubits for n values — exponentially compact', 'Preparing the state generally takes exponentially many gates']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The third row is where a great many claimed speedups quietly die. Amplitude encoding is beautifully compact and expensive to prepare, and an algorithm that counts the compactness as a win while ignoring the preparation cost has not accounted for its input. Reading a quantum speedup claim means asking how the data got in.'
        },
        { kind: 'heading', text: 'The two bottlenecks' },
        {
          kind: 'list',
          items: [
            '**Input.** Classical data has to be loaded, and the loading can cost as much as the computation saves.',
            '**Output.** A quantum state cannot be read in full. If the answer you want is a large vector, extracting it needs exponentially many measurements.'
          ]
        },
        {
          kind: 'text',
          text: 'Those two together mean the natural fit is a problem whose **input is small or already quantum** and whose **output is a single number or a class label**. Which is a narrow target, and it is one reason quantum simulation looks more promising than quantum machine learning on classical data.'
        },
        { kind: 'heading', text: 'Assessing a claim' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'What is the classical baseline? Not "a neural network" — the *best* classical method on this dataset, properly tuned.',
            'How large is the dataset? Many QML demonstrations use a few dozen examples, where almost anything works.',
            'What is the encoding cost, counted honestly?',
            'How many shots per prediction? A model needing a thousand measurements per inference has a cost the accuracy figure does not show.',
            'Was it run on hardware or simulated? And if simulated, at what qubit count — because a simulated quantum model is a classical model with extra steps.',
            'Is the comparison fair on parameter count and training effort?'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That checklist is the deliverable of this lesson. The field changes quickly and specific results date; the ability to ask those six questions does not. Note how closely it matches the benchmark-reading list in the AI course — the discipline is the same, and in both fields the baseline is what claims most often lack.'
        },
        {
          kind: 'lab',
          appId: 'learning-lab',
          title: 'Establish the baseline first',
          does:
            'Take a small classification dataset and fit the simplest classical model that works, recording its accuracy properly. That number is what any quantum approach would have to beat, and in most published comparisons it is the number that was missing.',
          optional: true
        },
        { kind: 'check', questionId: 'q16l3q1' },
        { kind: 'check', questionId: 'q16l3q2' }
      ],
      questions: [
        {
          id: 'q16l3q1',
          kind: 'choice',
          concept: 'data-encoding',
          prompt: 'Amplitude encoding stores n values in log₂ n qubits. Why is that not automatically a win?',
          difficulty: 'advanced',
          options: [
            'Because the qubits are noisy',
            'Because preparing that state generally takes exponentially many gates, so the compactness is paid for at the input',
            'Because amplitudes cannot hold real data',
            'Because log₂ n is not fewer qubits'
          ],
          answer: 1,
          explanation:
            'The state preparation is the hidden cost. An algorithm that counts the compact representation as an advantage without counting the preparation has not accounted for its input.',
          hints: ['How does the data get into those amplitudes?']
        },
        {
          id: 'q16l3q2',
          kind: 'multi',
          concept: 'qml',
          prompt: 'Which questions belong in assessing a QML result? Choose all that apply.',
          difficulty: 'advanced',
          options: [
            'What is the best classical method on this dataset, properly tuned?',
            'How many shots are needed per prediction?',
            'Was it run on hardware or simulated, and at what size?',
            'How novel does the architecture sound?'
          ],
          answer: [0, 1, 2],
          explanation:
            'Baseline, measurement cost and what actually ran. Novelty is not evidence — and the baseline is the item most often missing from published comparisons.',
          hints: ['Three of these are on the checklist.']
        },
        {
          id: 'q16l3q3',
          kind: 'choice',
          concept: 'qml',
          prompt: 'What kind of problem best suits a quantum machine-learning approach, given the bottlenecks?',
          difficulty: 'advanced',
          options: [
            'Large classical datasets with large outputs',
            'Problems whose input is small or already quantum, and whose output is a single number or a label',
            'Image classification at scale',
            'Any problem a classical model can solve'
          ],
          answer: 1,
          explanation:
            'Both bottlenecks are avoided: little or nothing to load, and little to read out. It is a narrow target, which is why simulation looks more promising than learning on classical data.',
          hints: ['Which problems avoid both the input and the output bottleneck?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q16l4',
      title: 'Predicting, reporting, and the misconceptions one last time',
      intro:
        'The method the course has been practising throughout, stated explicitly — and a return to the four sentences from Unit 01, now refusable precisely.',
      objectives: [
        'Explain why predicting before running is part of the method',
        'Write an experiment report that somebody else could reproduce',
        'Refuse each standard misconception with the specific experiment that settles it'
      ],
      concepts: ['prediction-first', 'experiment-reporting', 'misconceptions', 'reproducibility'],
      requires: ['prediction-first', 'reproducibility', 'misconceptions'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Predicting first' },
        {
          kind: 'text',
          text: 'Every laboratory in this course has asked you to write down an expected result before running anything. The reason is specific: a result you did not predict teaches you very little, because you have no way to tell understanding from recognition after the fact. A prediction that turns out wrong locates exactly what you had misunderstood.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The wrong predictions are the valuable ones. "I expected H-Z-H to give fifty-fifty and it gave 1 every time" is a sentence containing a specific repaired misunderstanding. "That was interesting" contains nothing.'
        },
        { kind: 'heading', text: 'Reporting an experiment' },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Objective.** The question, in one sentence.',
            '**Setup.** Circuit, qubit count, parameters, shots, noise model, seed, and which execution mode — exact, sampled or noisy.',
            '**Prediction.** What you expected, written before running.',
            '**Result.** What came out, with the shot count and the uncertainty.',
            '**Analysis.** Whether it matched, and if not, why.',
            '**Limitations.** What this does not show. Simulator scale, sampling error, an idealised noise model, a construction that does not scale.',
            '**Conclusion.** What you now know that you did not before.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The limitations section is not a formality and it is the one most often skipped. "Shor factored 15 in the simulator" without "with the modular arithmetic applied as a permutation rather than built from gates, on 15, which trial division factors instantly" is a sentence that overstates what happened. Every honest quantum result has a limitations paragraph.'
        },
        { kind: 'heading', text: 'The misconceptions, refused' },
        {
          kind: 'table',
          headers: ['The claim', 'The experiment that settles it'],
          rows: [
            ['"A qubit is 0 and 1 at the same time"', 'H then H gives 0 with certainty. A hidden 0-or-1 would give fifty-fifty, because H spreads either basis state evenly. Unit 03.'],
            ['"It tries every answer at once"', 'Grover needs about √N queries and over-rotates past the peak. Parallel evaluation would need one query and would not have a peak. Unit 10.'],
            ['"Entanglement sends information instantly"', 'Local statistics of one half of a Bell pair are unchanged by anything done to the other, in every basis. Teleportation needs two classical bits. Units 06 and 08.'],
            ['"Quantum computers are simply faster"', 'They are slower at nearly everything, and the advantage is a short list of problems with particular structure. Unit 12.'],
            ['"A superposition is just uncertainty"', 'A phase flip changes nothing measurable now and reverses the answer after a Hadamard. A mixture has no phase to flip. Units 02 and 06.']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'That table is the course in one page, and every row names an experiment you have run rather than an argument you have been given. Being able to produce it from memory is a reasonable definition of having understood this subject.'
        },
        { kind: 'heading', text: 'What you can now do' },
        {
          kind: 'list',
          items: [
            'Write a quantum state, read its amplitudes, and say what a measurement would give.',
            'Build a circuit, predict its output, run it, and explain any disagreement.',
            'Say what entanglement is without using a metaphor.',
            'Follow an algorithm from preparation through marking and interference to measurement.',
            'Count what a circuit costs in qubits, depth and two-qubit gates.',
            'Simulate noise, and say why a phase error is the dangerous one.',
            'Encode a logical qubit, detect an error, and explain what the code cannot see.',
            'Read a claim about quantum computing and say what it does and does not establish.'
          ]
        },
        {
          kind: 'lab',
          appId: 'explain-it-yourself',
          title: 'Explain a Bell state, without metaphors',
          does:
            'Explain what a Bell state is to somebody who has not taken this course, using none of the phrases in the left-hand column of the table above. The test set in Unit 01 was exactly this, and it is the last thing the course asks before the projects.'
        },
        { kind: 'check', questionId: 'q16l4q1' },
        { kind: 'check', questionId: 'q16l4q2' },
        { kind: 'check', questionId: 'q16l4q3' }
      ],
      questions: [
        {
          id: 'q16l4q1',
          kind: 'choice',
          concept: 'prediction-first',
          prompt: 'Why does the course ask for a prediction before every experiment?',
          difficulty: 'intermediate',
          options: [
            'To make the experiments take longer',
            'Because a wrong prediction locates exactly what was misunderstood, and a result you did not predict cannot distinguish understanding from recognition',
            'Because the simulator requires it',
            'To practise guessing'
          ],
          answer: 1,
          explanation:
            'Committing first is what makes the result informative. Without it, every outcome looks reasonable in hindsight and nothing is learned about where your model of the subject was wrong.',
          hints: ['What can you conclude from a result you had no expectation about?']
        },
        {
          id: 'q16l4q2',
          kind: 'choice',
          concept: 'experiment-reporting',
          prompt: 'Which section of an experiment report is most often missing, and most needed here?',
          difficulty: 'advanced',
          options: [
            'The objective',
            'The limitations — simulator scale, sampling error, idealised noise, constructions that do not generalise',
            'The result',
            'The setup'
          ],
          answer: 1,
          explanation:
            'Limitations. Nearly every overstated quantum claim is a true result with its qualifications removed, and writing them down is what separates a report from a headline.',
          hints: ['Which one would you be tempted to leave out?']
        },
        {
          id: 'q16l4q3',
          kind: 'choice',
          concept: 'misconceptions',
          prompt: 'Somebody says a quantum computer evaluates every possibility in parallel. Which single experiment refuses it?',
          difficulty: 'advanced',
          options: [
            'A Bell state measurement',
            "Grover's success curve: about √N queries and a peak it rotates past — parallel evaluation would need one query and have no peak",
            'A Hadamard applied twice',
            'A phase estimation run'
          ],
          answer: 1,
          explanation:
            'The curve refuses it twice over: the query count is wrong for parallel evaluation, and the over-rotation makes no sense at all under that story. H-H refuses a different claim — the hidden-value one.',
          hints: ['Which claim does each experiment address? Match them carefully.']
        }
      ]
    }
  ]
}
