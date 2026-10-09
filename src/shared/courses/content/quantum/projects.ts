import type { Module } from '../../types.ts'

/**
 * Unit 17 — The projects, and the capstone.
 *
 * Seven projects plus a multi-track capstone. Each is a lesson holding the brief, the steps, the quality gate and
 * questions that check the learner understood what they built rather than that it produced output.
 *
 * Two rules run through all of them, from the course specification:
 *   - Every result is labelled ideal, noisy or hardware. Nothing in the Quantum Studio is hardware.
 *   - A project passes on its report, not on its run. A circuit that executes and a learner who can explain why
 *     the output is what it is are different things, and only the second one is being assessed.
 *
 * Scaffolding reduces across the seven. Project 01 names every step; the capstone states a standard and leaves
 * the work to be designed.
 */
export const Q_PROJECTS: Module = {
  id: 'q17',
  title: 'Projects and Capstone',
  summary:
    'Seven projects — a qubit laboratory, Bell states, teleportation, Grover, phase estimation, a noise study and error correction — and a capstone you choose from ten tracks.',
  concepts: ['experiment-reporting', 'reproducibility', 'simulation-limits'],
  lessons: [
    // ------------------------------------------------------------------ project 1
    {
      id: 'qp1',
      title: 'Project 01 — A qubit laboratory',
      intro:
        'Establish, by experiment, that a qubit is not a hidden bit. Every step is named here; later projects name fewer.',
      objectives: [
        'Measure a qubit in different bases and account for the results',
        'Demonstrate that a superposition is not classical uncertainty',
        'Write a report somebody else could reproduce'
      ],
      concepts: ['amplitudes', 'measurement-basis', 'experiment-reporting'],
      requires: ['born-rule', 'hadamard', 'relative-phase', 'shots'],
      minutes: 90,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Everything here runs in the Quantum Studio on one qubit. Write down a prediction before each run — that is the point of the project, not an extra.' },
        { kind: 'heading', text: 'The steps' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Measure |0⟩ 1,000 times. Record the counts.',
            'Apply H, then measure 1,000 times. Record the counts and the deviation from 500/500.',
            'Repeat the H run at 10, 100, 1,000 and 10,000 shots. Plot how the estimate settles, and relate the spread to 1/√shots.',
            'Apply H then H, and measure. Predict first. This is the experiment that refuses the hidden-bit story — explain why in your report.',
            'Apply H then Z then H, and measure. Predict first.',
            'Apply H, then measure in the X basis instead of Z. Predict first.',
            'Apply Rx(θ) for θ at 0, π/4, π/2, 3π/4 and π. Record the probability of 1 at each and compare with sin²(θ/2).',
            'Fix a seed, run twice, confirm the identical sequence, then change the seed and confirm it differs.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'The H-H result is explained in terms of amplitudes cancelling, not in terms of chance.',
            'The H-Z-H result is explained as a phase that was invisible until a basis change made it visible.',
            'Your sin²(θ/2) figures agree with the formula to within the sampling error you state — and you state it.',
            'The report names the execution mode as **ideal simulation** and says so without being asked.',
            'Each step records what you predicted, including the predictions that were wrong.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'If every prediction was right, you probably predicted after looking. The wrong ones are what the project is for, and a report containing none is less convincing, not more.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Run the qubit laboratory',
          does: 'Build each circuit on the circuit bench, run at the shot counts above, and read the counts and the state off the state and measurement benches.'
        },
        { kind: 'check', questionId: 'qp1q1' },
        { kind: 'check', questionId: 'qp1q2' }
      ],
      questions: [
        {
          id: 'qp1q1',
          kind: 'choice',
          concept: 'amplitudes',
          prompt: 'H then H gives 0 every time. Why does that rule out a hidden 0-or-1 value after the first H?',
          difficulty: 'beginner',
          options: [
            'Because two gates cancel in general',
            'Because H applied to either |0⟩ or |1⟩ gives an even spread, so a hidden value would give fifty-fifty — the certainty requires the two paths to cancel',
            'Because H is its own inverse, which a hidden value would also allow',
            'Because measurement is random'
          ],
          answer: 1,
          explanation:
            'Feed H a definite 0 or a definite 1 and you get 50/50 either way. Getting 0 with certainty needs the amplitude for 1 to cancel, which requires both paths to have been present.',
          hints: ['What would the second H do to a definite 0? To a definite 1?']
        },
        {
          id: 'qp1q2',
          kind: 'choice',
          concept: 'experiment-reporting',
          prompt: 'Your report gives P(1) = 0.52 from 100 shots and calls it disagreement with the predicted 0.5. What is wrong?',
          difficulty: 'beginner',
          options: [
            'Nothing; 0.52 is not 0.5',
            'The sampling error at 100 shots is about 0.05, so 0.52 agrees with 0.5 — a result without its uncertainty cannot support a claim of disagreement',
            'The shot count is too high',
            '0.52 should be rounded'
          ],
          answer: 1,
          explanation:
            'Roughly 1/√100 = 0.1 spread, about 0.05 as a standard error. Any claim about agreement needs the uncertainty stated alongside the number.',
          hints: ['How precise is an estimate from 100 shots?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 2
    {
      id: 'qp2',
      title: 'Project 02 — Bell states and what correlation is not',
      intro:
        'Build all four Bell states, measure them in several bases, and show that the correlation cannot be explained by agreement fixed in advance.',
      objectives: [
        'Prepare and verify all four Bell states',
        'Show that a local measurement reveals nothing about the other qubit',
        'Distinguish entanglement from a classical shared value'
      ],
      concepts: ['bell-states', 'entanglement', 'partial-trace'],
      requires: ['bell-states', 'partial-trace', 'correlation-vs-entanglement'],
      minutes: 100,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Build all four Bell states and verify each from its amplitudes, not from its measurement counts alone.',
            'Measure each 2,000 times in the Z basis and record the correlation pattern.',
            'Measure Φ⁺ in the X basis on both qubits. Predict first. Then do the same for Ψ⁻, where the pattern differs.',
            'Measure one qubit only, 2,000 times, and show the single-qubit statistics are 50/50 — in Z and in X.',
            'Compute the reduced density matrix of one qubit and show it is maximally mixed with purity 1/2.',
            'Build the classical comparison: a state that is half |00⟩ and half |11⟩ as a **mixture**. Show Z measurements are identical to Φ⁺ and X measurements are not.',
            'Explain in writing what experiment distinguishes the two, and why the Z measurement alone cannot.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Step 6 is present. Without the mixture comparison the project has not demonstrated anything about entanglement — only about correlation.',
            'The report states that no measurement on one qubit, in any basis, reveals anything about the other.',
            'Purity 1/2 is connected to the state being entangled, not treated as an unexplained number.',
            'The report does not say the qubits "communicate".'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Bell states and the mixture',
          does: 'Prepare the Bell states on the circuit bench; use the state bench for amplitudes and reduced states, and the noise bench to build the classical mixture for comparison.'
        },
        { kind: 'check', questionId: 'qp2q1' }
      ],
      questions: [
        {
          id: 'qp2q1',
          kind: 'choice',
          concept: 'entanglement',
          prompt: 'Why does the project insist on the mixture comparison in step 6?',
          difficulty: 'intermediate',
          options: [
            'To practise building mixtures',
            'Because a mixture of |00⟩ and |11⟩ gives the identical Z-basis correlation, so Z results alone demonstrate nothing that a pre-agreed classical value could not',
            'Because the mixture is entangled too',
            'Because Z measurements are unreliable'
          ],
          answer: 1,
          explanation:
            'Perfect Z correlation is exactly what two coins painted the same colour in advance would give. The X basis is where the two states separate, and that is the whole demonstration.',
          hints: ['What would two identically prepared classical bits give in Z?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 3
    {
      id: 'qp3',
      title: 'Project 03 — Teleportation, honestly',
      intro:
        'Implement teleportation end to end, verify fidelity across many input states, and account for exactly what was and was not transmitted.',
      objectives: [
        'Implement the full protocol including the classical correction',
        'Verify fidelity over a range of input states',
        'State precisely what no-cloning and no-signalling forbid here'
      ],
      concepts: ['teleportation', 'no-cloning'],
      requires: ['teleportation', 'no-cloning', 'classical-control'],
      minutes: 110,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Prepare an arbitrary state on qubit 0 with two rotations. Record its amplitudes.',
            'Build the Bell pair, run the Bell-basis measurement, and apply the correction indicated by the two bits.',
            'Compare the final state of qubit 2 with the original. Report fidelity.',
            'Repeat for at least eight inputs spread over the Bloch sphere, including states with non-trivial phase.',
            'Deliberately omit the correction and report the fidelity you get instead. Explain the number.',
            'Verify that the original state is gone from qubit 0 — not copied, moved.',
            'Count how many classical bits the protocol needs, and explain why fewer is impossible.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The common implementation fault: measuring, reading the bits, and then **re-running** a corrected circuit. That is a second run with fresh random outcomes, and it gives a fidelity around 0.7 that looks like noise and is a bug. The correction must be applied to the state the measurement left behind, in the same run.'
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Fidelity is above 0.999 for every input in ideal simulation. Anything lower is a bug, and the report must say which.',
            'Step 5 is present and its number explained — without correction you are averaging over four random Paulis.',
            'The report states that two classical bits must travel, so nothing arrives faster than they do.',
            'The report states that the original is destroyed, and connects that to no-cloning.'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Teleport a state',
          does: 'Use the algorithms bench for the protocol and the state bench to compare the input and output amplitudes directly, rather than inferring fidelity from counts.'
        },
        { kind: 'check', questionId: 'qp3q1' }
      ],
      questions: [
        {
          id: 'qp3q1',
          kind: 'choice',
          concept: 'teleportation',
          prompt: 'A teleportation implementation reports fidelity around 0.7 in ideal simulation. What is the most likely cause?',
          difficulty: 'advanced',
          options: [
            'Noise in the simulator',
            'The correction was applied in a second, freshly randomised run instead of to the post-measurement state — so it corrected the wrong outcome most of the time',
            'Too few shots',
            'Teleportation is only approximate'
          ],
          answer: 1,
          explanation:
            'Ideal simulation has no noise, so 0.7 is a bug. Re-running after reading the bits discards the collapsed state the correction was meant for, and averaging over mismatched Paulis lands near that figure.',
          hints: ['What has to be true of the state the correction is applied to?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 4
    {
      id: 'qp4',
      title: "Project 04 — Grover, including the over-rotation",
      intro:
        'Implement Grover for a few sizes, measure the success probability against iteration count, and find the peak by experiment.',
      objectives: [
        'Implement an oracle and the diffusion operator',
        'Plot success probability against iterations and locate the peak',
        'State the speedup correctly and refuse the parallel-evaluation story'
      ],
      concepts: ['grover', 'over-rotation', 'amplitude-amplification'],
      requires: ['grover', 'over-rotation', 'oracle'],
      minutes: 110,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Implement a phase oracle marking one item for 3 qubits, and verify it marks only that item.',
            'Implement diffusion and run one iteration. Record the success probability.',
            'Run 0 through 10 iterations and plot success probability against iteration count.',
            'Identify the peak from your data. Compare with ⌊(π/4)√N⌋.',
            'Run past the peak and report the decline. This is the result the project exists for.',
            'Repeat for 4 and 5 qubits and show the peak moving as √N.',
            'Mark two items instead of one and report what changes.',
            'Compare the query count with classical search: average N/2, worst case N.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'The over-rotation decline is measured, not asserted.',
            'The report explains the decline geometrically — the state rotating past the target in a two-dimensional plane.',
            'The report says the speedup is quadratic and names a problem where that is not enough.',
            'The report states explicitly that the algorithm does not evaluate every input at once, and cites the iteration count and the peak as the evidence.'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Grover and its success curve',
          does: 'Run Grover on the algorithms bench, which reports the success probability per iteration so the curve and its peak come out of measurement rather than from a formula.'
        },
        { kind: 'check', questionId: 'qp4q1' }
      ],
      questions: [
        {
          id: 'qp4q1',
          kind: 'choice',
          concept: 'over-rotation',
          prompt: 'Why is measuring the decline past the peak the point of this project?',
          difficulty: 'advanced',
          options: [
            'It shows the simulator is accurate',
            'It is the result that is impossible under the "tries every answer at once" story, which would predict one query and no peak at all',
            'It shows Grover is broken for large N',
            'It measures noise'
          ],
          answer: 1,
          explanation:
            'A parallel-evaluation device has no reason to get worse with more work. The peak and the decline identify the mechanism as rotation, which is what Grover actually is.',
          hints: ['What would parallel evaluation predict about iteration count?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 5
    {
      id: 'qp5',
      title: 'Project 05 — Phase estimation',
      intro:
        'The subroutine beneath Shor and much of quantum chemistry: measure an eigenvalue by reading a phase out of an interference pattern.',
      objectives: [
        'Implement QFT and verify it against its own inverse',
        'Estimate a known phase and quantify the precision',
        'Relate the number of counting qubits to the bits of precision'
      ],
      concepts: ['qft', 'phase-estimation'],
      requires: ['qft', 'phase-estimation', 'phase-kickback'],
      minutes: 110,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Implement QFT for 3 qubits. Verify that QFT followed by inverse QFT is the identity, on several inputs, not just on |0…0⟩.',
            'Check QFT against a classical discrete Fourier transform of the same amplitude vector.',
            'Build phase estimation for a controlled-phase unitary whose eigenvalue you know.',
            'Estimate φ = 1/4 with 3 counting qubits. Predict the outcome exactly before running — this one is representable.',
            'Estimate φ = 1/3 with 3, then 5, then 7 counting qubits. Report the distribution each time.',
            'Explain why step 5 spreads and step 4 does not.',
            'State the relationship between counting qubits and bits of precision, and the cost in controlled operations.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Step 1 verifies on a general input. Testing identity only on |0…0⟩ passes for several wrong circuits.',
            'The 1/4 case gives a single outcome with certainty, and the report says why: it is exactly representable in 3 bits.',
            'The 1/3 case is reported as a distribution peaked near the right value, never as a single number.',
            'Precision is reported with its cost, not alone.',
            'Results are labelled ideal simulation.'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Estimate a phase',
          does: 'Use the algorithms bench for QFT and phase estimation, and the state bench to check the transform against the classical DFT amplitude by amplitude.'
        },
        { kind: 'check', questionId: 'qp5q1' }
      ],
      questions: [
        {
          id: 'qp5q1',
          kind: 'choice',
          concept: 'phase-estimation',
          prompt: 'Estimating φ = 1/4 with three counting qubits gives one outcome every time; φ = 1/3 gives a spread. Why?',
          difficulty: 'advanced',
          options: [
            'Because 1/3 is harder to compute',
            'Because 1/4 is exactly representable in three bits and 1/3 is not, so the second case distributes over the nearest representable values',
            'Because of sampling noise',
            'Because the QFT fails on 1/3'
          ],
          answer: 1,
          explanation:
            'The register can only hold phases of the form k/8. One quarter is 2/8 exactly; one third is not, so the amplitude peaks near it and spreads over neighbours.',
          hints: ['Which phases can three bits represent exactly?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 6
    {
      id: 'qp6',
      title: 'Project 06 — A noise study',
      intro:
        'Take a working circuit and establish how it degrades: which error hurts most, how depth multiplies it, and what a realistic machine would make of it.',
      objectives: [
        'Measure how a circuit degrades under each noise channel',
        'Show why phase errors are the dangerous ones',
        'Relate coherence times to the depth a circuit can afford'
      ],
      concepts: ['noise-channels', 'phase-error-invisibility', 't1-t2'],
      requires: ['decoherence', 'phase-error-invisibility', 't1-t2'],
      minutes: 100,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Take your Bell-state circuit from Project 02 as the subject.',
            'Run it with bit-flip noise at 0.1%, 1% and 5%. Record the fidelity at each.',
            'Repeat with phase-flip noise at the same rates.',
            'Repeat with depolarising noise.',
            'Measure only in the Z basis and show that phase noise is nearly invisible there. Then measure in X and show it is not.',
            'Add readout error and separate it from gate error in your analysis — they are not the same fault.',
            'Set T₁ and T₂ to realistic values and find the depth at which fidelity falls below 0.9.',
            'Set T₂ greater than 2T₁ and record what the tool does.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Step 5 is present. It is the reason this project exists: a Z-only measurement makes a phase-damaged circuit look healthy.',
            'The report distinguishes gate error from readout error by evidence, not by assertion.',
            'Step 8 reports a **refusal**, because T₂ ≤ 2T₁ is physics, not a preference — and a tool that accepted it would be lying.',
            'Every result is labelled **noisy simulation** with its model and parameters, and the report states that this is not hardware and that the channels are idealised.'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Degrade a working circuit',
          does: 'Use the noise bench: apply each channel at each rate, set coherence times, and watch the fidelity figure as depth grows.'
        },
        { kind: 'check', questionId: 'qp6q1' },
        { kind: 'check', questionId: 'qp6q2' }
      ],
      questions: [
        {
          id: 'qp6q1',
          kind: 'choice',
          concept: 'phase-error-invisibility',
          prompt: 'Why does the project require a measurement in the X basis as well as Z?',
          difficulty: 'advanced',
          options: [
            'To double the data',
            'Because phase errors barely change Z-basis counts, so a Z-only study would report a phase-damaged circuit as healthy',
            'Because Z measurements are less accurate',
            'Because X is the computational basis'
          ],
          answer: 1,
          explanation:
            'A phase flip leaves Z probabilities almost untouched and reverses the interference that a later Hadamard depends on. Measuring in one basis only is the standard way to miss it.',
          hints: ['What does a phase flip do to the probability of 0 in Z?']
        },
        {
          id: 'qp6q2',
          kind: 'choice',
          concept: 't1-t2',
          prompt: 'Setting T₂ above 2T₁ produces a refusal rather than a result. Why is that correct?',
          difficulty: 'intermediate',
          options: [
            'It is a limitation of the simulator',
            'Because T₂ ≤ 2T₁ always holds physically, so accepting the value would produce a number describing no possible device',
            'Because T₂ must equal T₁',
            'Because large times are slow to simulate'
          ],
          answer: 1,
          explanation:
            'The bound is a consequence of how the two kinds of decay relate. A tool that quietly simulated an impossible device would be returning a confident answer about nothing.',
          hints: ['Is the bound a convention or a consequence?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 7
    {
      id: 'qp7',
      title: 'Project 07 — Error correction',
      intro:
        'Encode one logical qubit, inject errors, detect them from syndromes alone, and establish where the code helps and where it makes things worse.',
      objectives: [
        'Implement a code and read syndromes without measuring the data',
        'Find the physical error rate below which the code helps',
        'State what the code cannot detect'
      ],
      concepts: ['repetition-code', 'stabilisers', 'fault-tolerance'],
      requires: ['repetition-code', 'stabilisers', 'syndrome'],
      minutes: 120,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            'Encode |0⟩ and then an arbitrary state in the three-qubit bit-flip code.',
            'Inject a single X error on each qubit in turn and show the syndrome identifies which.',
            'Confirm the syndrome measurement does not reveal the logical state — that is the requirement, not a detail.',
            'Inject two errors and show the correction makes it worse. Explain why.',
            'Inject a Z error and show the bit-flip code cannot see it at all.',
            'Compare logical error rate with physical error rate across a range of rates and find the crossover below which encoding helps.',
            'Count the overhead: qubits, extra gates, and the syndrome rounds.',
            'Write down what a code correcting both X and Z would need, and why the surface code is built the way it is.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Steps 4 and 5 are present. A report showing only successful corrections has not characterised the code.',
            'Step 3 is verified, not assumed — a syndrome that leaked the logical state would have collapsed it.',
            'The crossover is found from data, and the report says that above it the code is a liability.',
            'The overhead is counted honestly and connected to the millions of physical qubits a useful machine would need.'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Encode, break, detect',
          does: 'Use the correction bench to encode, inject specific errors, read syndromes, and survey logical against physical error rate to locate the crossover.'
        },
        { kind: 'check', questionId: 'qp7q1' }
      ],
      questions: [
        {
          id: 'qp7q1',
          kind: 'choice',
          concept: 'repetition-code',
          prompt: 'Why must the project include the two-error case?',
          difficulty: 'advanced',
          options: [
            'To test the simulator',
            'Because the correction then applies the wrong fix and produces a logical error — which is why a code only helps below a physical error rate, not everywhere',
            'Because two errors cancel',
            'Because the syndrome becomes unreadable'
          ],
          answer: 1,
          explanation:
            'Majority voting on three qubits is wrong when two are wrong, and the "correction" completes the logical flip. That failure mode is exactly what the crossover in step 6 measures.',
          hints: ['What does majority vote do when the majority is wrong?']
        }
      ]
    },

    // ------------------------------------------------------------------ capstone
    {
      id: 'qp8',
      title: 'Capstone — ten tracks, one standard',
      intro:
        'One substantial piece of work you design. Ten tracks are offered because the subject has genuinely different directions, and forcing everybody down one of them teaches the least to most people.',
      objectives: [
        'Define a question, carry out the work and defend the choices',
        'Benchmark honestly against a classical baseline',
        'State the limitations without being asked'
      ],
      concepts: ['experiment-reporting', 'reproducibility', 'simulation-limits'],
      requires: ['experiment-reporting', 'misconceptions', 'quantum-advantage'],
      minutes: 300,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'The tracks' },
        {
          kind: 'table',
          headers: ['Track', 'The work'],
          rows: [
            ['Algorithm implementation', 'Implement an algorithm the course did not cover — Simon at larger width, amplitude estimation, a quantum walk — and characterise it as the projects characterise theirs.'],
            ['Circuit optimisation', 'Take a family of circuits and reduce depth and two-qubit count, proving equivalence at each step rather than hoping.'],
            ['Noise characterisation', 'Build a noise model from stated device parameters and predict, then measure, how a chosen circuit degrades.'],
            ['Error correction study', 'Implement a code beyond the three-qubit one, or a decoder, and find its threshold by experiment.'],
            ['Variational algorithm', 'Build a VQE or QAOA instance, report the optimiser trace honestly including failures, and compare with the exact answer at a size where that is possible.'],
            ['Quantum chemistry', 'Map a small molecular Hamiltonian to qubits, estimate a ground-state energy and compare with the classical value.'],
            ['Quantum machine learning', 'Build a parameterised classifier — and establish the classical baseline first, properly tuned. The baseline is the deliverable as much as the model.'],
            ['Cryptography', 'Implement BB84 with an eavesdropper and measure the error rate she causes against the predicted 25%.'],
            ['Hardware analysis', 'Take published device specifications and work out which of the course\'s circuits could run on them, with the mapping and SWAP overhead counted.'],
            ['Teaching', 'Build an explanation, with runnable experiments, of one concept the course treats as hard — and test it on somebody who has not taken the course.']
          ]
        },
        { kind: 'heading', text: 'What every track must deliver' },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**The question.** One sentence, specific enough to be answered.',
            '**The mathematics.** The states, operators and expected results written down before any code.',
            '**The implementation.** With unit tests for the pieces — every gate and every complete circuit, as the course has done throughout.',
            '**The experiment.** Predictions recorded first, seeds fixed, shot counts and modes stated.',
            '**The benchmark.** The classical comparison, done properly. For every track, including the quantum-native ones.',
            '**The limitations.** Simulator scale, idealised noise, constructions that do not generalise, sampling error. This section is required.',
            '**The explanation.** The whole thing explained to somebody who has not done it, without any sentence from the misconception table.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'It running is not it passing. A capstone passes when somebody else could reproduce it from the report, when every number is labelled ideal, noisy or hardware, when the baseline is present and fair, when the limitations are stated without prompting, and when the explanation survives contact with a reader who does not already know the answer. A working program with none of that has not met the standard.'
        },
        {
          kind: 'list',
          items: [
            'No claim of advantage without a benchmark against a properly tuned classical method.',
            'No result presented as hardware. Nothing in the Quantum Studio runs on hardware, and the report says so.',
            'No scale implied beyond what was run. If you simulated 12 qubits, the report says 12.',
            'Every tested piece has a test, and the tests are in the deliverable.',
            'Seeds recorded, so the numbers in the report can be reproduced exactly.'
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Do the work',
          does: 'Whichever track you chose, this is where it runs. Fix a seed, state the mode on every figure, and keep the circuit alongside the result.'
        },
        {
          kind: 'lab',
          appId: 'explain-it-yourself',
          title: 'Deliver the explanation',
          does: 'Present the capstone to a reader who has not taken the course. If they cannot restate the question and the finding, the explanation is not finished — whatever the code does.'
        },
        { kind: 'check', questionId: 'qp8q1' },
        { kind: 'check', questionId: 'qp8q2' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The write-up. Under the seven headings above, at least six hundred words, with every number labelled ideal, noisy or hardware, every seed recorded, and a closing paragraph saying what the work does **not** establish. That last paragraph is the one a reader will trust you for.'
        }
      ],
      questions: [
        {
          id: 'qp8q1',
          kind: 'choice',
          concept: 'simulation-limits',
          prompt: 'A capstone reports "factored a 15-bit number with Shor". What is wrong?',
          difficulty: 'advanced',
          options: [
            'Nothing, if the circuit ran',
            'Almost certainly the scale and the construction: a genuine 15-bit factoring needs far more qubits than can be simulated, and a working demonstration usually shortcuts the modular arithmetic — both of which belong in the report',
            'Shor cannot factor odd numbers',
            '15 bits is too small to report'
          ],
          answer: 1,
          explanation:
            'The sentence implies a capability the run did not have. State the number factored, the qubit count, how the modular arithmetic was built, and that trial division would do it instantly.',
          hints: ['How many qubits would that really take, and what was probably shortcut?']
        },
        {
          id: 'qp8q2',
          kind: 'multi',
          concept: 'experiment-reporting',
          prompt: 'Which are required of every capstone track, including the quantum-native ones? Choose all that apply.',
          difficulty: 'advanced',
          options: [
            'A classical benchmark, done properly',
            'A limitations section',
            'Seeds recorded so the numbers can be reproduced',
            'A claim of quantum advantage'
          ],
          answer: [0, 1, 2],
          explanation:
            'Benchmark, limitations and reproducibility are required of all ten tracks. A claim of advantage is required of none, and is only acceptable where the benchmark actually supports it.',
          hints: ['Three are requirements. One is a claim you must earn.']
        }
      ]
    }
  ]
}
