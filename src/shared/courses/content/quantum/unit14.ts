import type { Module } from '../../types.ts'

/**
 * Unit 14 — Error correction.
 *
 * Built on two impossibilities the learner already knows: you cannot copy a qubit, and you cannot look at one
 * without destroying it. Error correction is the answer to both, and presenting it that way is what makes the
 * syndrome idea land rather than seeming like a trick.
 *
 * The three-qubit codes are run in the laboratory, including their failures — the bit-flip code is blind to a
 * phase error, and the learner should watch it fail rather than be told it would.
 */
export const Q_UNIT_14: Module = {
  id: 'q14',
  title: 'Quantum Error Correction',
  summary:
    'Why correction is hard here at all, the three-qubit codes, measuring a syndrome without destroying the data, logical against physical qubits, stabilisers, the surface code and the threshold.',
  concepts: [
    'why-correction-is-hard',
    'repetition-code',
    'syndrome',
    'logical-physical',
    'stabilisers',
    'surface-code',
    'fault-tolerance'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q14l1',
      title: 'Why this is hard, and the three-qubit code',
      intro:
        'Classical error correction copies the data. Neither of the two obvious approaches is available here — and the way round both is the cleverest idea in the course.',
      objectives: [
        'State the two obstacles to copying classical error correction',
        'Describe the three-qubit bit-flip code',
        'Explain how a syndrome reveals the error without revealing the state'
      ],
      concepts: ['why-correction-is-hard', 'repetition-code', 'syndrome'],
      requires: ['no-cloning', 'measurement', 'cnot'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Classically, protecting a bit is easy: store it three times and take a majority vote. Two obstacles make that unavailable for a qubit.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**You cannot copy it.** The no-cloning theorem forbids making three copies of an unknown state.',
            '**You cannot look at it.** Reading the three to compare them would collapse the superposition you were protecting.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Both obstacles are dodged by the same move: **encode** rather than copy, and measure a **relationship** rather than a value. The encoding spreads one logical qubit across three physical ones without copying it, and the measurement asks "do these two agree?" rather than "what are they?". The answer to the first question says where an error is; the answer to the second would destroy everything.'
        },
        { kind: 'heading', text: 'Encoding' },
        {
          kind: 'example',
          title: 'One logical qubit, three physical',
          text: 'Start with α|0⟩ + β|1⟩ on qubit 0, and |0⟩ on qubits 1 and 2.\nApply CNOT from 0 to 1, and CNOT from 0 to 2.\n\nResult:  α|000⟩ + β|111⟩\n\nNote what this is NOT: it is not three copies of the qubit. It is a single entangled state in which all three agree. Nothing anywhere holds α|0⟩ + β|1⟩ by itself, which is exactly how the no-cloning theorem is respected.'
        },
        { kind: 'heading', text: 'The syndrome' },
        {
          kind: 'text',
          text: 'Suppose an X error hits qubit 1, giving `α|010⟩ + β|101⟩`. Now measure two **parities** using ancilla qubits: does qubit 0 agree with qubit 1, and does qubit 1 agree with qubit 2?'
        },
        {
          kind: 'table',
          headers: ['Syndrome (0↔1, 1↔2)', 'Meaning'],
          rows: [
            ['agree, agree', 'No single error'],
            ['disagree, agree', 'Qubit 0 is the odd one'],
            ['disagree, disagree', 'Qubit 1 is the odd one'],
            ['agree, disagree', 'Qubit 2 is the odd one']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The crucial property: the syndrome depends on **where** the error is and not at all on α and β. It tells you which qubit to fix and nothing about the logical state, so measuring it leaves the protected information untouched. That is the whole trick, and it is worth sitting with for a moment.'
        },
        {
          kind: 'text',
          text: 'Apply an X to the qubit the syndrome blames, decode, and the logical state is back — superposition intact, with α and β never having been observed.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Encode, break, correct',
          does:
            'In the error-correction bench, run the bit-flip code with an X error on each of the three qubits in turn. Check the syndrome against the table each time, and check that the logical fidelity comes back to 1. Then run it with no error and confirm the syndrome is 00 and nothing is "corrected".'
        },
        { kind: 'check', questionId: 'q14l1q1' },
        { kind: 'check', questionId: 'q14l1q2' },
        { kind: 'check', questionId: 'q14l1q3' }
      ],
      questions: [
        {
          id: 'q14l1q1',
          kind: 'choice',
          concept: 'why-correction-is-hard',
          prompt: 'Why can classical majority-vote error correction not simply be copied across?',
          difficulty: 'advanced',
          options: [
            'Qubits are too noisy',
            'You cannot copy an unknown quantum state, and you cannot compare the copies without destroying the superposition',
            'There are not enough qubits',
            'Majority voting does not work on three items'
          ],
          answer: 1,
          explanation:
            'Two obstacles, both fundamental: no-cloning blocks the copying and measurement blocks the comparison. Encoding and syndrome measurement get round both.',
          hints: ['Two theorems you already know are in the way.']
        },
        {
          id: 'q14l1q2',
          kind: 'choice',
          concept: 'repetition-code',
          prompt: 'The encoded state is α|000⟩ + β|111⟩. Is that three copies of the qubit?',
          difficulty: 'advanced',
          options: [
            'Yes, that is what encoding means',
            'No — it is one entangled state in which the three agree; no individual qubit holds the logical state, which is how no-cloning is respected',
            'Yes, but only for basis states',
            'It is three measurements of the qubit'
          ],
          answer: 1,
          explanation:
            'Three copies would be (α|0⟩+β|1⟩)⊗(α|0⟩+β|1⟩)⊗(α|0⟩+β|1⟩), which is a different and unobtainable state. The encoded state is entangled, and each qubit alone is mixed.',
          hints: ['Write out what three genuine copies would look like and compare.']
        },
        {
          id: 'q14l1q3',
          kind: 'choice',
          concept: 'syndrome',
          prompt: 'Why does measuring the syndrome not destroy the protected state?',
          difficulty: 'advanced',
          options: [
            'Because the measurement is weak',
            'Because the syndrome depends only on where the error is, not on α and β — it asks whether qubits agree, not what they are',
            'Because the ancillas are discarded',
            'It does destroy it, and the state is re-prepared'
          ],
          answer: 1,
          explanation:
            'The parity checks are independent of the logical amplitudes. You learn which qubit disagrees and nothing about the superposition, which is what makes correction possible at all.',
          hints: ['What question does the parity measurement actually ask?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q14l2',
      title: 'What a code cannot see, and stabilisers',
      intro:
        'The bit-flip code is completely blind to a phase error. Watching it fail is the best possible motivation for everything that comes after it.',
      objectives: [
        'Show that the bit-flip code misses a Z error',
        'Explain the phase-flip code as the same code in another basis',
        'Define a stabiliser and use it to predict what a code can detect'
      ],
      concepts: ['stabilisers', 'logical-physical'],
      requires: ['syndrome', 'observables', 'circuit-identities'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Apply a Z error to one qubit of the encoded state `α|000⟩ + β|111⟩`. The parity checks ask whether the qubits agree in the computational basis — and a phase flip changes no qubit value at all. Every check reports agreement. The syndrome is 00: nothing wrong.'
        },
        {
          kind: 'text',
          text: 'And yet the logical state is damaged: the relative phase between α and β has been flipped, which Unit 02 established is a real difference. The code reports success and has protected nothing.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is the honest failure to watch rather than read about. A code protects against the errors it was designed for **and nothing else**, and it does not announce when it is out of its depth. The syndrome 00 means "no error of the kind I can see".'
        },
        { kind: 'heading', text: 'The phase-flip code' },
        {
          kind: 'text',
          text: 'The fix uses the identity from Unit 04: HZH = X. A phase flip, viewed through Hadamards, **is** a bit flip. So the phase-flip code is the bit-flip code with Hadamards on both sides: encode, apply Hadamards, let the error happen, apply Hadamards again, and run the same parity checks.'
        },
        {
          kind: 'text',
          text: 'It now catches Z errors and is blind to X errors, for the mirror-image reason. Protecting against both at once needs the two codes nested — the nine-qubit Shor code — or a cleverer construction like the surface code.'
        },
        { kind: 'heading', text: 'Stabilisers' },
        {
          kind: 'text',
          text: 'A **stabiliser** is an operator the encoded state is a +1 eigenstate of. Measuring one therefore disturbs nothing when all is well, and reports −1 when the state has been pushed out of the code space. The parity checks above are exactly this.'
        },
        {
          kind: 'table',
          headers: ['Code', 'Stabilisers', 'What each detects'],
          rows: [
            ['Bit flip', 'ZZI, IZZ', 'Whether neighbouring qubits agree in the Z basis'],
            ['Phase flip', 'XXI, IXX', 'The same, in the X basis']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'And now the blindness becomes a calculation rather than an observation. A stabiliser detects an error exactly when the two **anticommute**. Z commutes with ZZ, so the bit-flip code cannot see Z — which is the same fact as before, derived rather than discovered. The Quantum Studio computes this both ways and they agree, which is a small but genuine check on the engine.'
        },
        { kind: 'heading', text: 'Logical and physical' },
        {
          kind: 'table',
          headers: ['', 'Physical qubit', 'Logical qubit'],
          rows: [
            ['What it is', 'A real, noisy device', 'A protected state spread across many physical ones'],
            ['Error rate', 'What the hardware gives you', 'Much lower, if the physical rate is below threshold'],
            ['How many', 'What you have', 'What your algorithm counts'],
            ['Ratio', '—', 'Hundreds to thousands of physical per logical, for a useful code']
          ]
        },
        {
          kind: 'text',
          text: 'That last row is the one that matters for reading claims about hardware, and it is the figure behind the Shor resource estimate in Unit 12. An algorithm needing a few thousand logical qubits needs of the order of a million physical ones.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Watch a code fail',
          does:
            'Run the bit-flip code with a Z error and read the syndrome: 00, nothing detected, and the logical fidelity below 1. Then use "try every single error" to see the whole table — three X errors caught, three Z errors missed, every one with the syndrome that explains why.'
        },
        { kind: 'check', questionId: 'q14l2q1' },
        { kind: 'check', questionId: 'q14l2q2' },
        { kind: 'check', questionId: 'q14l2q3' }
      ],
      questions: [
        {
          id: 'q14l2q1',
          kind: 'choice',
          concept: 'stabilisers',
          prompt: 'A Z error hits the three-qubit bit-flip code. What does the syndrome report?',
          difficulty: 'advanced',
          options: [
            'Which qubit the error hit',
            '00 — nothing wrong, because Z commutes with both parity checks and the logical state is damaged anyway',
            'An invalid syndrome',
            'Both checks disagree'
          ],
          answer: 1,
          explanation:
            'Z commutes with ZZ, so neither check anticommutes with the error and neither reports anything. The code is blind to it, and the state is corrupted silently.',
          hints: ['Does Z change whether two qubits agree in the computational basis?']
        },
        {
          id: 'q14l2q2',
          kind: 'choice',
          concept: 'stabilisers',
          prompt: 'How does the phase-flip code work?',
          difficulty: 'advanced',
          options: [
            'It uses nine qubits',
            'It is the bit-flip code conjugated by Hadamards — since HZH = X, a phase flip becomes a bit flip in that basis',
            'It measures the logical state directly',
            'It corrects both X and Z errors'
          ],
          answer: 1,
          explanation:
            'The identity HZH = X does the work. The same parity checks, in the rotated basis, now catch phase errors — and are blind to bit flips for the mirror reason.',
          hints: ['Which identity from Unit 04 relates X and Z?']
        },
        {
          id: 'q14l2q3',
          kind: 'choice',
          concept: 'logical-physical',
          prompt: 'An algorithm needs 2,000 logical qubits. Roughly how many physical qubits does that imply?',
          difficulty: 'advanced',
          options: ['2,000', 'About 10,000', 'Of the order of a million', 'It cannot be estimated'],
          answer: 2,
          explanation:
            'At hundreds to thousands of physical qubits per logical one, 2,000 logical means hundreds of thousands to millions of physical. That ratio is the single most important number when reading hardware claims.',
          hints: ['Multiply by the overhead in the last row of the table.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q14l3',
      title: 'The surface code and fault tolerance',
      intro:
        'The code the field has largely settled on, and the threshold theorem that says error correction can work at all even though the correction itself is faulty.',
      objectives: [
        'Describe the surface code at the level of its structure',
        'Say what code distance buys',
        'State the threshold theorem and say why it is not obvious'
      ],
      concepts: ['surface-code', 'fault-tolerance'],
      requires: ['stabilisers', 'logical-physical'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The **surface code** lays physical qubits out on a two-dimensional grid. Data qubits sit on the vertices; measurement qubits sit between them and repeatedly measure local stabilisers — one kind checking Z parities, another checking X parities, in a chequerboard pattern.'
        },
        {
          kind: 'list',
          items: [
            '**Every check is local.** A stabiliser involves only four neighbouring qubits, which suits hardware with nearest-neighbour connectivity — and that practicality is why this code won.',
            '**The syndrome is measured continuously.** Rounds of measurement produce a stream of data, and a classical **decoder** works out from the pattern what errors most likely occurred.',
            '**Errors form chains.** A single error flips two neighbouring checks; a chain of errors flips only the checks at its ends. The decoder has to infer the chain from its endpoints.',
            '**Code distance** is the length of the shortest chain that would cause an undetected logical error. A larger grid means a larger distance, and the logical error rate falls exponentially with it.'
          ]
        },
        {
          kind: 'table',
          headers: ['Code distance', 'Physical qubits per logical qubit, approximately', 'Errors corrected per round'],
          rows: [
            ['3', '~17', '1'],
            ['5', '~49', '2'],
            ['7', '~97', '3'],
            ['11', '~241', '5'],
            ['21', '~881', '10']
          ]
        },
        {
          kind: 'text',
          text: 'The relationship is the point: physical cost grows roughly as the square of the distance, while the logical error rate falls exponentially in it. That trade is what makes large-scale quantum computing conceivable — and it is also where the million-qubit estimates come from.'
        },
        { kind: 'heading', text: 'Fault tolerance' },
        {
          kind: 'text',
          text: 'Here is the obvious objection. Error correction is itself a circuit, made of faulty gates and faulty measurements. Correcting errors with faulty operations introduces errors. Why does the whole thing not collapse?'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The **threshold theorem** answers it. If the physical error rate is below a certain threshold — around 1% for the surface code, depending on the noise model — then adding more layers of correction reduces the logical error rate faster than it introduces new errors, and arbitrarily long computations become possible. Above the threshold, correction makes things worse. There is a real cliff, and which side you are on decides everything.'
        },
        {
          kind: 'text',
          text: 'Current hardware is around or slightly below that threshold for the best gates, which is why the field talks about "approaching fault tolerance" rather than having achieved it. Being below threshold is necessary and not sufficient: you then need enough physical qubits to build the distance you want, and the ability to keep them all working together.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'A fair summary of where things stand: the theory is settled, small codes have been demonstrated, the error rates are near the threshold, and the qubit counts are three or four orders of magnitude short of what a useful corrected computation needs. That is a hard engineering problem rather than an unknown one — and the honest answer about the timeline remains that nobody knows.'
        },
        { kind: 'check', questionId: 'q14l3q1' },
        { kind: 'check', questionId: 'q14l3q2' },
        { kind: 'check', questionId: 'q14l3q3' }
      ],
      questions: [
        {
          id: 'q14l3q1',
          kind: 'choice',
          concept: 'surface-code',
          prompt: 'Why is the surface code the preferred candidate for real hardware?',
          difficulty: 'advanced',
          options: [
            'It needs the fewest qubits of any code',
            'Its checks are local — four neighbouring qubits — which suits hardware with nearest-neighbour connectivity, and its logical error rate falls exponentially with grid size',
            'It corrects every possible error exactly',
            'It needs no measurement'
          ],
          answer: 1,
          explanation:
            'Locality and a favourable scaling. It is not the most qubit-efficient code known; it is the one whose requirements match what hardware can actually provide.',
          hints: ['What does the hardware find easy, and what does the code ask for?']
        },
        {
          id: 'q14l3q2',
          kind: 'choice',
          concept: 'fault-tolerance',
          prompt: 'What does the threshold theorem say?',
          difficulty: 'advanced',
          options: [
            'Error correction always helps',
            'If the physical error rate is below a threshold, more layers of correction reduce the logical error rate faster than they add errors — and above it, correction makes things worse',
            'Errors can be eliminated entirely',
            'Quantum computers need no error correction'
          ],
          answer: 1,
          explanation:
            'A genuine cliff. Below threshold, scaling up works; above it, the correction machinery adds more errors than it removes. Which side of it the hardware sits on decides whether the whole approach is viable.',
          hints: ['Is the conclusion unconditional?']
        },
        {
          id: 'q14l3q3',
          kind: 'choice',
          concept: 'surface-code',
          prompt: 'Code distance is increased from 5 to 11. What happens to the cost and the logical error rate?',
          difficulty: 'advanced',
          options: [
            'Both roughly double',
            'The physical qubit count rises roughly with the square of the distance — about fivefold here — while the logical error rate falls exponentially',
            'The cost falls',
            'Neither changes'
          ],
          answer: 1,
          explanation:
            'Quadratic cost against exponential benefit: 49 qubits to about 241, with the logical error rate dropping far faster. That asymmetry is the reason error correction is worth its overhead.',
          hints: ['Compare the two columns in the table.']
        }
      ]
    }
  ]
}
