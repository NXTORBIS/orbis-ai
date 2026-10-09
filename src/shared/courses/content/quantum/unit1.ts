import type { Module } from '../../types.ts'

/**
 * Unit 01 — From classical bits to the question quantum computing answers.
 *
 * Starting with classical computation is not a warm-up. The central question of the field — what would
 * computation look like if information followed quantum rules? — cannot be asked until somebody knows what
 * computation *is*: physical states being manipulated, not abstract answers being retrieved.
 *
 * Reversibility is taught here, before any quantum gate, because "every quantum gate is reversible" is a
 * constraint that only means something to somebody who has seen a classical gate throw information away.
 */
export const Q_UNIT_1: Module = {
  id: 'q1',
  title: 'From Bits to the Quantum Question',
  summary:
    'What a classical computer actually does, why AND loses information and that matters, and the real reasons quantum computing was proposed — along with the four sentences about it that are not true.',
  concepts: ['classical-bit', 'classical-gates', 'reversibility', 'why-quantum', 'misconceptions'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q1l1',
      title: 'What a computer is really doing',
      intro:
        'Before any qubit: a computer does not manipulate answers, it manipulates physical states that stand for information. That sentence is the whole foundation of this course.',
      objectives: [
        'Say what a bit is, and what it is not',
        'Explain why the logical state is separate from the physical implementation',
        'State the question quantum computing is an answer to'
      ],
      concepts: ['classical-bit'],
      requires: [],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **bit** is the smallest unit of information: one of two possible states, written 0 and 1. That is the logical story. The physical story is that something — a voltage, a magnetic domain, a charge trapped in a transistor — is in one of two distinguishable conditions, and the machine moves between those conditions according to rules.'
        },
        {
          kind: 'text',
          text: 'The separation matters. A bit does not care whether it is a voltage or a hole in a punched card; the computation is the same. This is why computer science can be a subject at all rather than a branch of electrical engineering.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'And it is where the central question of this course comes from. If the logical model is separate from the physics, you can ask: what if the physical states obeyed quantum rules instead of classical ones? What would the logical model look like, and what could it do? That is quantum computing — not a faster chip, a different model of information.'
        },
        { kind: 'heading', text: 'Bits in groups' },
        {
          kind: 'text',
          text: 'n bits have 2ⁿ possible combinations, and at any moment they are in exactly one of them. Eight bits is 256 possible states and one actual state. Hold onto that phrasing — "2ⁿ possible, one actual" — because the quantum case differs in a precise way, and the usual sloppy description of the difference is where most confusion about this subject begins.'
        },
        {
          kind: 'table',
          headers: ['Bits', 'Possible combinations', 'How many are the case at once'],
          rows: [
            ['1', '2', '1'],
            ['2', '4', '1'],
            ['8', '256', '1'],
            ['n', '2ⁿ', '1']
          ]
        },
        { kind: 'heading', text: 'Computation as transformation' },
        {
          kind: 'text',
          text: 'A program is a sequence of operations, each turning one state of the machine into another. Every piece of software is that, however elaborate: a deterministic walk from an input state to an output state through a series of transformations.'
        },
        {
          kind: 'text',
          text: 'A quantum computer is the same shape of thing. A state, a sequence of transformations, a result read out at the end. What changes is what a state can be, what transformations are allowed, and — crucially — what happens when you look.'
        },
        { kind: 'check', questionId: 'q1l1q1' },
        { kind: 'check', questionId: 'q1l1q2' }
      ],
      questions: [
        {
          id: 'q1l1q1',
          kind: 'choice',
          concept: 'classical-bit',
          prompt: 'Why does it matter that a bit logical state is separate from how it is physically stored?',
          difficulty: 'beginner',
          options: [
            'Because it makes computers cheaper',
            'Because the computation is the same whatever the physics is — which is exactly what lets us ask what computation would look like if the physics were quantum',
            'Because bits can then be copied',
            'Because it allows more than two states'
          ],
          answer: 1,
          explanation:
            'The separation is what makes the question askable. If the logical model is independent of the hardware, you can swap the hardware for something that obeys different rules and ask what the new logical model permits.',
          hints: ['What does the separation allow you to change?']
        },
        {
          id: 'q1l1q2',
          kind: 'choice',
          concept: 'classical-bit',
          prompt: 'Eight classical bits. How many combinations are possible, and how many are the case at once?',
          difficulty: 'beginner',
          options: ['256 possible, 256 at once', '8 possible, 1 at once', '256 possible, exactly 1 at once', '256 possible, 8 at once'],
          answer: 2,
          explanation:
            '2⁸ = 256 possible combinations, and at any instant the register is in exactly one of them. Remembering that phrase precisely is what will stop you accepting "a qubit is 0 and 1 at the same time" later.',
          hints: ['Possible and actual are different counts.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q1l2',
      title: 'Classical gates, and the information they destroy',
      intro:
        'AND throws information away. That sounds like an observation about logic and it is the reason every quantum gate has the shape it does.',
      objectives: [
        'Read the truth tables of the common gates',
        'Say which gates are reversible and which are not',
        'Explain why reversibility is a constraint on quantum gates rather than a design choice'
      ],
      concepts: ['classical-gates', 'reversibility'],
      requires: ['classical-bit'],
      minutes: 14,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Gates transform bits. Four, with their tables:' },
        {
          kind: 'table',
          headers: ['a', 'b', 'NOT a', 'a AND b', 'a OR b', 'a XOR b'],
          rows: [
            ['0', '0', '1', '0', '0', '0'],
            ['0', '1', '1', '0', '1', '1'],
            ['1', '0', '0', '0', '1', '1'],
            ['1', '1', '0', '1', '1', '0']
          ]
        },
        { kind: 'heading', text: 'Now run one backwards' },
        {
          kind: 'text',
          text: 'An AND gate outputs 0. What were its inputs? They were 00, or 01, or 10 — three possibilities, and nothing in the output distinguishes them. The gate has destroyed information: two bits went in, one came out, and the missing bit is gone.'
        },
        {
          kind: 'text',
          text: 'NOT is different. Output 1 means the input was 0, always. One bit in, one bit out, and the input is recoverable. NOT is **reversible**; AND is not. XOR is interesting: it loses information as written, but XOR *while keeping one input* — that is, (a, b) → (a, a ⊕ b) — is perfectly reversible, and that operation is the direct classical ancestor of the CNOT gate you will meet in Unit 05.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'A reversible gate must have as many outputs as inputs, and must map distinct inputs to distinct outputs. If two different inputs produce the same output, the operation cannot be undone — which is exactly what AND does.'
        },
        { kind: 'heading', text: 'Why this becomes a rule' },
        {
          kind: 'text',
          text: 'Quantum mechanics permits only transformations of a particular kind: they must preserve the total probability, which forces them to be invertible. There is no quantum AND gate taking two qubits to one. Every quantum gate has as many qubits out as in, and every one of them can be undone.'
        },
        {
          kind: 'text',
          text: 'This is a constraint rather than a feature, and it has consequences: classical arithmetic has to be rebuilt in reversible form before it can be done on a quantum computer, which usually costs extra qubits to hold what would otherwise have been thrown away. The Toffoli gate — flip the target if both controls are 1 — is a reversible version of AND with three qubits, and it is enough on its own for all of classical logic.'
        },
        {
          kind: 'example',
          title: 'Toffoli, as reversible AND',
          text: '(a, b, c) → (a, b, c ⊕ (a AND b))\n\nSet c = 0 and the third output is a AND b — and a and b are still there, so nothing was lost.\n\n  a b c   →   a b c\xa0\xa0\n  0 0 0       0 0 0\n  0 1 0       0 1 0\n  1 0 0       1 0 0\n  1 1 0       1 1 1   ← the AND\n\nThree bits in, three out, every row distinct. Reversible.'
        },
        {
          kind: 'lab',
          appId: 'logic-lab',
          title: 'Run a gate backwards',
          does:
            'Build an AND gate and a NOT gate, then try to work out the inputs from the output of each. Then build the three-input Toffoli pattern and check that every row has a distinct output.',
          optional: true
        },
        { kind: 'check', questionId: 'q1l2q1' },
        { kind: 'check', questionId: 'q1l2q2' },
        { kind: 'check', questionId: 'q1l2q3' }
      ],
      questions: [
        {
          id: 'q1l2q1',
          kind: 'choice',
          concept: 'reversibility',
          prompt: 'An AND gate outputs 0. What can you say about its inputs?',
          difficulty: 'beginner',
          options: [
            'Both were 0',
            'They were 00, 01 or 10 — the output does not distinguish them, so information has been lost',
            'At least one was 1',
            'Nothing at all'
          ],
          answer: 1,
          explanation:
            'Three input pairs give 0 and the output cannot tell you which. That is what "destroys information" means, and it is why there is no quantum AND gate of this shape.',
          hints: ['Read the truth table backwards from the 0 rows.']
        },
        {
          id: 'q1l2q2',
          kind: 'multi',
          concept: 'reversibility',
          prompt: 'Which of these operations are reversible? Choose all that apply.',
          difficulty: 'intermediate',
          options: ['NOT', 'AND', '(a, b) → (a, a ⊕ b)', 'Toffoli'],
          answer: [0, 2, 3],
          explanation:
            'NOT is its own inverse. Keeping a alongside a ⊕ b makes XOR reversible — and that is the classical CNOT. Toffoli has three distinct outputs for three distinct inputs throughout. AND is the one that loses a bit.',
          hints: ['Count inputs against outputs, then look for two inputs sharing an output.']
        },
        {
          id: 'q1l2q3',
          kind: 'short',
          concept: 'reversibility',
          prompt: 'Why must every quantum gate be reversible?',
          difficulty: 'intermediate',
          answer: 'because quantum operations must preserve total probability, which forces them to be invertible',
          accepts: [
            'they must be unitary',
            'quantum evolution is unitary',
            'to preserve probability',
            'unitary operations are invertible'
          ],
          explanation:
            'The allowed transformations preserve the total probability, and that condition forces invertibility. It is a constraint from the physics, not a design preference — which is why reversible arithmetic has to be built before a quantum computer can do ordinary sums.',
          hints: ['What has to stay true of the probabilities?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q1l3',
      title: 'Why quantum computing was proposed',
      intro:
        'Not because computers needed to be faster. Because simulating quantum systems on classical hardware is hopeless, and somebody noticed that a quantum system could do it naturally.',
      objectives: [
        'Explain the simulation argument that motivated the field',
        'Name the problem areas where a real advantage is expected, and the honest status of each',
        'Say why a quantum computer is not a faster classical computer'
      ],
      concepts: ['why-quantum'],
      requires: ['classical-bit'],
      minutes: 15,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'heading', text: 'The original argument' },
        {
          kind: 'text',
          text: 'Describing a quantum system of n particles, each with two states, needs 2ⁿ complex numbers. Not n numbers — 2ⁿ. Fifty particles needs about a thousand trillion numbers, and every step of the evolution has to touch all of them.'
        },
        {
          kind: 'table',
          headers: ['Two-state systems', 'Numbers needed', 'Memory, at 16 bytes each'],
          rows: [
            ['10', '1,024', '16 KB'],
            ['20', '1,048,576', '16 MB'],
            ['30', '~1.07 billion', '17 GB'],
            ['40', '~1.1 trillion', '17.6 TB'],
            ['50', '~1.1 quadrillion', '18,000 TB'],
            ['300', '2³⁰⁰', 'More particles than there are atoms in the observable universe']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'That table is the whole motivation. Chemistry, materials and nuclear physics are full of systems with dozens of interacting quantum particles, and we cannot compute what they will do. Not "it takes a while" — the memory required exceeds the universe at a few hundred particles.'
        },
        {
          kind: 'text',
          text: 'The observation that started the field is simple: those 2ⁿ numbers are exactly what a quantum system of n parts naturally holds. So build a controllable quantum system, set it up to behave like the one you want to study, and read off the answer. Simulation by analogy rather than by arithmetic.'
        },
        { kind: 'heading', text: 'And then the other applications' },
        {
          kind: 'table',
          headers: ['Area', 'What is claimed', 'Honest status'],
          rows: [
            ['Simulating quantum systems', 'Exponential advantage', 'The strongest case, and the original motivation'],
            ['Factoring large integers', 'Exponential advantage over the best known classical method', 'Proved as an algorithm; needs hardware far beyond anything that exists'],
            ['Unstructured search', 'Quadratic — √N instead of N queries', 'Proved, and the quadratic gain is often eaten by constant factors and oracle cost'],
            ['Optimisation', 'Hoped-for improvements on some problems', 'Genuinely unsettled; much of the published enthusiasm has not held up'],
            ['Machine learning', 'Various proposals', 'Active research, no established practical advantage'],
            ['Linear algebra', 'Exponential for certain structured problems', 'Real, with severe conditions on input and output that are easy to overlook']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The bottom half of that table is where most overstatement lives. Factoring has a proved algorithm and no machine capable of running it at a useful size. Optimisation and machine learning have proposals and, so far, no settled advantage. A course that presents all six rows as equally established is misleading, and so is a course that dismisses the top two.'
        },
        { kind: 'heading', text: 'Not a faster computer' },
        {
          kind: 'text',
          text: 'A quantum computer is slower than a classical one at nearly everything. Arithmetic, sorting, text, graphics, running an operating system — all of it is better done classically, and most of it cannot sensibly be done quantumly at all. The expected advantage is on a short list of specific problems with the right mathematical structure.'
        },
        {
          kind: 'text',
          text: 'The realistic picture is a quantum processor as an accelerator beside a classical machine, called for the one part of a problem it is good at, the way a graphics card is. Not a replacement for anything.'
        },
        { kind: 'check', questionId: 'q1l3q1' },
        { kind: 'check', questionId: 'q1l3q2' }
      ],
      questions: [
        {
          id: 'q1l3q1',
          kind: 'choice',
          concept: 'why-quantum',
          prompt: 'What was the original motivation for quantum computing?',
          difficulty: 'beginner',
          options: [
            'Classical computers were becoming too slow',
            'Simulating quantum systems needs 2ⁿ numbers, which becomes impossible classically — and a quantum system of n parts naturally holds exactly that many',
            'Breaking encryption',
            'Reducing power consumption'
          ],
          answer: 1,
          explanation:
            'The simulation argument. Factoring came later and is the application that attracted the attention; the founding observation was that quantum systems are the natural hardware for simulating quantum systems.',
          hints: ['Look at the memory table and ask what it makes impossible.']
        },
        {
          id: 'q1l3q2',
          kind: 'multi',
          concept: 'why-quantum',
          prompt: 'Which statements are accurate about quantum computers as they stand? Choose all that apply.',
          difficulty: 'intermediate',
          options: [
            'They are slower than classical computers at most tasks',
            'The advantage is expected on a short list of problems with particular structure',
            'They will replace classical computers for general computing',
            'Some claimed advantages, particularly in optimisation, are not settled'
          ],
          answer: [0, 1, 3],
          explanation:
            'Slower at nearly everything, advantage on a specific list, and genuine uncertainty in several of the application areas. Replacement is not on the table — the realistic shape is an accelerator beside a classical machine.',
          hints: ['One of these is the claim the lesson exists to refuse.']
        },
        {
          id: 'q1l3q3',
          kind: 'number',
          concept: 'why-quantum',
          prompt: 'How many complex numbers describe the state of 20 two-state quantum systems?',
          difficulty: 'intermediate',
          answer: 1048576,
          tolerance: 1,
          explanation: '2²⁰ = 1,048,576 — about a million, for twenty particles. At 16 bytes each that is 16 MB, and it doubles with every additional particle.',
          hints: ['2 to the power of the number of systems.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q1l4',
      title: 'Four sentences that are not true',
      intro:
        'Every popular account of this subject rests on a handful of phrases that are wrong. Naming them now — before any of the mathematics — stops them taking root.',
      objectives: [
        'State the four standard misconceptions and what is wrong with each',
        'Say what is true instead, in terms the rest of the course will make precise',
        'Recognise the phrasing when you meet it elsewhere'
      ],
      concepts: ['misconceptions', 'why-quantum'],
      requires: ['why-quantum'],
      minutes: 13,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'These are not nitpicks. Each one leads to a specific wrong prediction, and somebody holding it cannot understand why Grover needs √N queries instead of one.'
        },
        { kind: 'heading', text: '"A qubit is 0 and 1 at the same time"' },
        {
          kind: 'text',
          text: 'A qubit in superposition has an **amplitude** for 0 and an amplitude for 1 — two complex numbers. It is not in both states; it is in a state that is neither, described by those numbers. The amplitudes can be negative, or complex, and that is the part the phrase cannot express — and the part every algorithm depends on. Unit 02 makes this exact.'
        },
        { kind: 'heading', text: '"A quantum computer tries every answer at once"' },
        {
          kind: 'text',
          text: 'Nothing is tried. A circuit can be applied to a superposition, which produces a superposition of results — and you cannot read them. One measurement gives one outcome. If the parallel-search story were right, Grover would need one query rather than √N, and factoring would be instant. The art of a quantum algorithm is arranging for the wrong answers to **cancel** so that what remains is likely to be the right one, and cancellation is what the phrase leaves out entirely.'
        },
        { kind: 'heading', text: '"Entangled particles communicate instantly"' },
        {
          kind: 'text',
          text: 'Entangled particles have **correlated** measurement outcomes. Nobody can use that to send anything: whatever you do to your half, the statistics of my half are unchanged. Teleportation in Unit 09 looks like a counter-example and is not — it needs two classical bits sent by ordinary means, and without them the receiver has nothing.'
        },
        { kind: 'heading', text: '"Quantum computers are simply faster"' },
        {
          kind: 'text',
          text: 'They are slower at almost everything. Different model, specific problems, as the previous lesson set out.'
        },
        {
          kind: 'table',
          headers: ['Instead of', 'Say'],
          rows: [
            ['"both 0 and 1 at once"', '"an amplitude for 0 and an amplitude for 1"'],
            ['"tries every answer"', '"applies the operation to a superposition, then interferes the results so the wrong ones cancel"'],
            ['"instant communication"', '"correlated outcomes, with no way to send a message"'],
            ['"faster computer"', '"a different model, with an advantage on particular problems"'],
            ['"collapses because we looked"', '"the outcome is recorded, and afterwards the state is the one consistent with it"']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The right-hand column is harder to say and it is what this course will let you say. The test, at the end of Unit 06, is whether you can explain a Bell state to somebody without using any phrase from the left-hand column.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Look at a state before you can read one',
          does:
            'Open the Quantum Studio, load the Bell state preset, and look at the state table. You will not understand the columns yet. Notice two things you will come back to: there are exactly two non-zero amplitudes, and each qubit on its own has a Bloch vector of length zero. Both are facts about what entanglement is.',
          optional: true
        },
        { kind: 'check', questionId: 'q1l4q1' },
        { kind: 'check', questionId: 'q1l4q2' },
        { kind: 'check', questionId: 'q1l4q3' }
      ],
      questions: [
        {
          id: 'q1l4q1',
          kind: 'choice',
          concept: 'misconceptions',
          prompt: 'If "a quantum computer tries every answer at once" were accurate, what would follow?',
          difficulty: 'intermediate',
          options: [
            'Quantum computers would need more qubits',
            'Unstructured search would take one query rather than about √N — so the phrase contradicts a proved result',
            'Measurement would be deterministic',
            'Entanglement would be unnecessary'
          ],
          answer: 1,
          explanation:
            'The parallel-search story predicts one query. The proved answer is about √N, and the gap between them is the whole content of what a quantum algorithm has to do: arrange cancellation rather than read off a parallel result.',
          hints: ['What would you do with the answers, if they were all there?']
        },
        {
          id: 'q1l4q2',
          kind: 'choice',
          concept: 'misconceptions',
          prompt: 'What is the accurate statement about entangled particles?',
          difficulty: 'intermediate',
          options: [
            'Measuring one instantly changes the other, which can be used to send information',
            'Their measurement outcomes are correlated, and no operation on one changes the statistics of the other',
            'They are physically connected',
            'They always give the same outcome in every basis'
          ],
          answer: 1,
          explanation:
            'Correlated outcomes, no signalling. The last option is also wrong: which correlations appear depends on the basis each side measures in, which is exactly what makes entanglement distinguishable from classical correlation.',
          hints: ['Could you detect, on your side alone, that somebody had measured theirs?']
        },
        {
          id: 'q1l4q3',
          kind: 'short',
          concept: 'misconceptions',
          prompt: 'Replace "a qubit is 0 and 1 at the same time" with something accurate.',
          difficulty: 'intermediate',
          answer: 'it has an amplitude for 0 and an amplitude for 1',
          accepts: [
            'it has amplitudes for each',
            'a complex amplitude for 0 and for 1',
            'it is in a superposition described by two amplitudes',
            'amplitudes for both outcomes'
          ],
          explanation:
            'Two complex amplitudes. The word amplitude is doing the work the phrase cannot: amplitudes can be negative and complex, and that is what makes interference — and therefore every algorithm in this course — possible.',
          hints: ['One word is missing from the usual phrase, and the whole course rests on it.']
        }
      ]
    }
  ]
}
