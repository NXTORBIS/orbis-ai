import type { Module } from '../../types.ts'

/**
 * Unit 09 — Oracles and the early algorithms.
 *
 * The oracle lesson comes first and does real work: an oracle is a circuit, not a source of answers, and phase
 * kickback is the mechanism all four of these algorithms share. Teaching Deutsch without kickback leaves the
 * learner with a recipe; teaching kickback first makes Deutsch-Jozsa and Bernstein-Vazirani obvious.
 *
 * Every speedup here is in **queries**, and the unit says so repeatedly, because "exponentially faster" applied
 * to Deutsch-Jozsa without that qualifier is one of the most common overstatements in the subject.
 */
export const Q_UNIT_9: Module = {
  id: 'q9',
  title: 'Oracles and the Early Algorithms',
  summary:
    'What an oracle actually is, phase kickback, and the four algorithms that established quantum query advantage — Deutsch, Deutsch-Jozsa, Bernstein-Vazirani and Simon.',
  concepts: ['oracle', 'query-complexity', 'phase-kickback', 'deutsch', 'deutsch-jozsa', 'bernstein-vazirani', 'simon'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q9l1',
      title: 'Oracles and phase kickback',
      intro:
        'An oracle is a circuit you are handed, and kickback is the trick that gets information out of it. Both matter more than any individual algorithm in this unit.',
      objectives: [
        'Say what an oracle is and what it is not',
        'Explain why an oracle must be reversible, and how that is arranged',
        'Trace phase kickback through a small example'
      ],
      concepts: ['oracle', 'query-complexity', 'phase-kickback'],
      requires: ['controlled-gates', 'reversibility', 'constructive-destructive'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'An **oracle** is a circuit implementing some function f, handed to you as a black box. You may apply it; you may not look inside. The question an algorithm answers is how many applications — **queries** — it needs to learn something about f.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'An oracle is not a source of answers. It computes f, exactly as a classical subroutine would, and asking it costs a query. The speedups in this unit are about needing fewer queries than any classical algorithm, and that is a narrower and more precise claim than "faster".'
        },
        { kind: 'heading', text: 'Making a function reversible' },
        {
          kind: 'text',
          text: 'f might not be reversible — f(x) = 0 for every x certainly is not. Unit 01 established that every quantum operation must be. The standard fix keeps the input:'
        },
        { kind: 'formula', latex: 'U_f |x\\rangle|y\\rangle = |x\\rangle|y \\oplus f(x)\\rangle', caption: 'x is the input register, y an extra output qubit, and ⊕ is XOR. The input survives, so the operation is reversible: applying it twice returns the original, because y ⊕ f(x) ⊕ f(x) = y.' },
        {
          kind: 'text',
          text: 'That extra qubit is why every circuit in this unit has one more qubit than the problem seems to need. It is sometimes called the ancilla, and it is the cost of reversibility.'
        },
        { kind: 'heading', text: 'Phase kickback' },
        {
          kind: 'text',
          text: 'Here is the trick. Set the output qubit to |−⟩ instead of |0⟩, and watch what the oracle does.'
        },
        {
          kind: 'example',
          title: 'The kickback, computed',
          text: "|−⟩ = (|0⟩ − |1⟩)/√2\n\nApply U_f with input |x⟩:\n\n  U_f |x⟩(|0⟩ − |1⟩)/√2\n    = |x⟩(|0 ⊕ f(x)⟩ − |1 ⊕ f(x)⟩)/√2\n\nIf f(x) = 0:  = |x⟩(|0⟩ − |1⟩)/√2  =  +|x⟩|−⟩\nIf f(x) = 1:  = |x⟩(|1⟩ − |0⟩)/√2  =  −|x⟩|−⟩\n\nSo:  U_f |x⟩|−⟩ = (−1)^{f(x)} |x⟩|−⟩"
        },
        {
          kind: 'text',
          text: 'The output qubit is unchanged. What happened instead is that the value of f(x) appeared as a **phase** on the input register. That is phase kickback, and it is the mechanism of every algorithm in this unit.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Why this is powerful: put the input register into a superposition over all x first, and one query writes a phase onto **every** term at once. You still cannot read them — but phases are exactly what interference acts on, and the interference step afterwards can turn them into a measurable answer. Prepare, kick back a phase, interfere, measure: the four steps from Unit 07, now with the mechanism filled in.'
        },
        { kind: 'check', questionId: 'q9l1q1' },
        { kind: 'check', questionId: 'q9l1q2' },
        { kind: 'check', questionId: 'q9l1q3' }
      ],
      questions: [
        {
          id: 'q9l1q1',
          kind: 'choice',
          concept: 'oracle',
          prompt: 'Why does an oracle circuit keep its input register?',
          difficulty: 'advanced',
          options: [
            'To save memory',
            'Because quantum operations must be reversible, and discarding the input would make the operation irreversible',
            'So the input can be measured later',
            'Because f is always invertible'
          ],
          answer: 1,
          explanation:
            'Keeping x and writing f(x) into a separate register by XOR makes the whole operation invertible — applying it twice undoes it. The extra qubit is the price of reversibility.',
          hints: ['What would be lost if the circuit output only f(x)?']
        },
        {
          id: 'q9l1q2',
          kind: 'choice',
          concept: 'phase-kickback',
          prompt: 'The output qubit is prepared in |−⟩ and the oracle is applied. What happens?',
          difficulty: 'advanced',
          options: [
            'The output qubit flips when f(x) = 1',
            'The output qubit is unchanged and the input register picks up a phase of (−1)^{f(x)}',
            'Nothing happens at all',
            'The input register is measured'
          ],
          answer: 1,
          explanation:
            '|−⟩ is an eigenstate of the XOR operation with eigenvalue (−1)^{f(x)}, so the value of f appears as a phase on the input and the output qubit comes back as it went in.',
          hints: ['Work through the two cases f(x) = 0 and f(x) = 1.']
        },
        {
          id: 'q9l1q3',
          kind: 'choice',
          concept: 'query-complexity',
          prompt: 'An algorithm needs one query where a classical approach needs 2ⁿ⁻¹ + 1. What exactly has been improved?',
          difficulty: 'advanced',
          options: [
            'The running time, by an exponential factor',
            'The number of oracle queries — the circuit itself still has gates, and the oracle may be expensive to build',
            'The memory required',
            'The accuracy of the answer'
          ],
          answer: 1,
          explanation:
            'Query complexity. The algorithm applies the oracle once; it does not follow that the whole computation is exponentially faster, because the oracle has to be implemented and the circuit has its own cost.',
          hints: ['What is being counted?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q9l2',
      title: "Deutsch's algorithm",
      intro:
        'The smallest honest demonstration of quantum advantage: one query where classically you need two. Small enough to compute entirely by hand.',
      objectives: [
        'Build the Deutsch circuit',
        'Trace the amplitudes through it for a constant and a balanced function',
        'Say precisely what the advantage is'
      ],
      concepts: ['deutsch'],
      requires: ['phase-kickback', 'oracle'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The problem. You have a one-bit function f: it takes 0 or 1 and returns 0 or 1. There are exactly four such functions.'
        },
        {
          kind: 'table',
          headers: ['f', 'f(0)', 'f(1)', 'Kind'],
          rows: [
            ['always 0', '0', '0', 'Constant'],
            ['always 1', '1', '1', 'Constant'],
            ['identity', '0', '1', 'Balanced'],
            ['not', '1', '0', 'Balanced']
          ]
        },
        {
          kind: 'text',
          text: 'The question is **not** what f is. It is only whether f is constant or balanced — one bit of information about f. Classically that needs both f(0) and f(1): two queries, and no fewer, because one value alone is consistent with both answers.'
        },
        { kind: 'heading', text: 'The circuit' },
        {
          kind: 'example',
          title: 'Four gates and an oracle',
          text: 'q0 (input):   |0⟩ ──[H]──┬────────┬──[H]── M\n                           │  U_f   │\nq1 (output):  |0⟩ ──[X]──[H]──┴────────┴────────\n\nq1 gets X then H, which puts it in |−⟩ — the kickback state.\nq0 gets H, putting it in |+⟩: both inputs in play.\nThen the oracle, then a final H on q0, then measure q0.'
        },
        { kind: 'heading', text: 'Tracing it' },
        {
          kind: 'example',
          title: 'By hand, both cases',
          text: 'After the Hadamards, q0 is (|0⟩ + |1⟩)/√2 and q1 is |−⟩.\n\nThe oracle applies a phase (−1)^{f(x)} to each term of q0:\n\n  ( (−1)^{f(0)}|0⟩ + (−1)^{f(1)}|1⟩ ) / √2\n\nCONSTANT — f(0) = f(1), so both phases are the same:\n  ±(|0⟩ + |1⟩)/√2 = ±|+⟩\n  Final H:  H|+⟩ = |0⟩     →  measures 0, with certainty\n\nBALANCED — the phases differ:\n  ±(|0⟩ − |1⟩)/√2 = ±|−⟩\n  Final H:  H|−⟩ = |1⟩     →  measures 1, with certainty'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That is the whole algorithm, and notice what did the work. The oracle wrote two phases. If they agreed, the final Hadamard recombined the paths into |0⟩; if they differed, into |1⟩. Interference turned a comparison of two phases into one deterministic bit — and it needed the oracle only once, because both inputs were in superposition when it was applied.'
        },
        { kind: 'heading', text: 'What the advantage is, exactly' },
        {
          kind: 'table',
          headers: ['', 'Classical', 'Quantum'],
          rows: [
            ['Queries needed', '2', '1'],
            ['Certainty', 'Complete', 'Complete'],
            ['Learns what f is?', 'Yes, entirely', 'No — only whether it is constant'],
            ['Useful in practice?', '—', 'No. It is a proof that the advantage exists at all']
          ]
        },
        {
          kind: 'text',
          text: 'Two queries to one is not an achievement anybody needs. Its importance is that it was the first proof that a quantum computer can require strictly fewer queries than any classical algorithm — and the third row is worth noticing too. The algorithm answers a narrower question than the classical approach does, which is a pattern that recurs.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Run Deutsch on all four functions',
          does:
            'Run it for each of the four functions and confirm: 0 for the two constant ones, 1 for the two balanced ones, every time. Then look at the circuit and find the point where the oracle wrote the phases.'
        },
        { kind: 'check', questionId: 'q9l2q1' },
        { kind: 'check', questionId: 'q9l2q2' }
      ],
      questions: [
        {
          id: 'q9l2q1',
          kind: 'choice',
          concept: 'deutsch',
          prompt: 'The Deutsch circuit measures 1. What does that tell you about f?',
          difficulty: 'intermediate',
          options: [
            'f(0) = 1',
            'f is balanced — f(0) and f(1) differ, though not which way round',
            'f is constant',
            'f(1) = 1'
          ],
          answer: 1,
          explanation:
            'Measuring 1 means the two phases differed, which means f is balanced. The algorithm deliberately does not tell you which of the two balanced functions it is — that would be more information and would need another query.',
          hints: ['Which case gave |−⟩ before the final Hadamard?']
        },
        {
          id: 'q9l2q2',
          kind: 'choice',
          concept: 'deutsch',
          prompt: 'Why can a classical algorithm not do this in one query?',
          difficulty: 'intermediate',
          options: [
            'Classical computers are slower',
            'One value of f is consistent with both a constant and a balanced function, so a single classical query cannot settle the question',
            'Classical algorithms cannot evaluate functions',
            'It can, in one query'
          ],
          answer: 1,
          explanation:
            'Learning f(0) = 0 leaves both "always 0" and the identity possible. The quantum circuit avoids this by applying the oracle to both inputs at once and reading a property of the pair of results rather than either value.',
          hints: ['Suppose you learn f(0) = 0. What is still undecided?']
        },
        {
          id: 'q9l2q3',
          kind: 'choice',
          concept: 'deutsch',
          prompt: 'Which gate in the Deutsch circuit turns the phases into a measurable answer?',
          difficulty: 'advanced',
          options: [
            'The X on the output qubit',
            'The final Hadamard on the input qubit',
            'The oracle',
            'The measurement'
          ],
          answer: 1,
          explanation:
            'The oracle writes the phases, and the final Hadamard recombines the two paths so they interfere — into |0⟩ if the phases agreed, |1⟩ if they differed. That gate is the interference step.',
          hints: ['Which gate takes |+⟩ to |0⟩ and |−⟩ to |1⟩?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q9l3',
      title: 'Deutsch-Jozsa and Bernstein-Vazirani',
      intro:
        'The same trick at scale. One of them needs a promise about f and the other does not, which makes the second the better demonstration.',
      objectives: [
        'Describe the Deutsch-Jozsa problem including its promise',
        'Say why the promise matters',
        'Explain how Bernstein-Vazirani recovers n bits in one query'
      ],
      concepts: ['deutsch-jozsa', 'bernstein-vazirani'],
      requires: ['deutsch', 'query-complexity'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Deutsch-Jozsa' },
        {
          kind: 'text',
          text: 'Now f takes n bits and returns one, and you are **promised** that it is either constant or exactly balanced — half the inputs give 0 and half give 1. Decide which.'
        },
        {
          kind: 'text',
          text: 'The circuit is the Deutsch circuit widened: Hadamards on all n input qubits, the output qubit in |−⟩, one oracle call, Hadamards again, measure all n. All zeros means constant; anything else means balanced.'
        },
        {
          kind: 'table',
          headers: ['n', 'Classical worst case, with certainty', 'Quantum'],
          rows: [
            ['3', '5 queries', '1'],
            ['10', '513 queries', '1'],
            ['20', '524,289 queries', '1'],
            ['n', '2ⁿ⁻¹ + 1', '1']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Two qualifications, and both are routinely dropped. **The promise is doing a lot of work** — without it, "constant or balanced" is not the question and the algorithm says nothing about an arbitrary function. And **a classical algorithm willing to be wrong occasionally does extremely well here**: a few random samples find two different values with overwhelming probability. The exponential gap is against classical certainty, not against classical practice.'
        },
        { kind: 'heading', text: 'Bernstein-Vazirani' },
        {
          kind: 'text',
          text: 'A cleaner problem with no promise. There is a hidden n-bit string s, and the oracle computes `f(x) = s · x mod 2` — the parity of the bits where both s and x have a 1. Find s.'
        },
        {
          kind: 'text',
          text: 'Classically each query gives one bit of information about s, and you need n of them: query 100…0 to get the first bit of s, 010…0 for the second, and so on. There is no way to do better.'
        },
        {
          kind: 'example',
          title: 'The quantum version: one query, the whole string',
          text: 'Hadamards on all n inputs, output qubit in |−⟩.\nOne oracle call, which writes the phase (−1)^{s·x} onto every term.\nHadamards again.\nMeasure.\n\nThe result is s itself, every time.\n\nWhy: applying a Hadamard to every qubit turns the pattern of phases (−1)^{s·x} into the single basis state |s⟩. The interference is constructive at exactly one position, and that position is the answer.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This is the clearest of the four. No promise, no probabilistic shortcut for the classical side, n queries against 1, and the answer is the complete string rather than a single bit about it. If you want one example of query advantage that survives scrutiny, this is the one to remember.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Hide a string and recover it',
          does:
            'Run Bernstein-Vazirani with a hidden string of your choosing and check it comes back exactly. Try several lengths and note that the query count stays at 1 while the classical requirement grows with the length.'
        },
        { kind: 'check', questionId: 'q9l3q1' },
        { kind: 'check', questionId: 'q9l3q2' },
        { kind: 'check', questionId: 'q9l3q3' }
      ],
      questions: [
        {
          id: 'q9l3q1',
          kind: 'choice',
          concept: 'deutsch-jozsa',
          prompt: 'Why is the Deutsch-Jozsa speedup less impressive than it first appears?',
          difficulty: 'advanced',
          options: [
            'The algorithm is often wrong',
            'The exponential gap is against classical **certainty**; a classical algorithm allowed a small error probability needs only a handful of random samples',
            'It needs too many qubits',
            'The promise makes it harder'
          ],
          answer: 1,
          explanation:
            'A few samples find two differing values with overwhelming probability, settling the question in practice. The exponential separation holds against deterministic classical algorithms, which is a narrower claim.',
          hints: ['What would a classical algorithm do if it were allowed to be wrong one time in a billion?']
        },
        {
          id: 'q9l3q2',
          kind: 'choice',
          concept: 'bernstein-vazirani',
          prompt: 'Bernstein-Vazirani with a hidden 8-bit string. How many queries does each approach need?',
          difficulty: 'intermediate',
          options: ['8 classical, 8 quantum', '8 classical, 1 quantum', '256 classical, 1 quantum', '1 classical, 1 quantum'],
          answer: 1,
          explanation:
            'Each classical query yields one bit of s, so eight are needed. The quantum circuit recovers all eight with one oracle call — and unlike Deutsch-Jozsa, no promise and no probabilistic shortcut softens the comparison.',
          hints: ['How much does one classical query tell you about s?']
        },
        {
          id: 'q9l3q3',
          kind: 'choice',
          concept: 'bernstein-vazirani',
          prompt: 'What does the final layer of Hadamards do in Bernstein-Vazirani?',
          difficulty: 'advanced',
          options: [
            'It measures the register',
            'It converts the pattern of phases (−1)^{s·x} into the single basis state |s⟩, so one measurement reads the whole string',
            'It resets the qubits',
            'It applies the oracle a second time'
          ],
          answer: 1,
          explanation:
            'The oracle leaves information spread across the phases of every term. The Hadamard layer interferes them so that all the amplitude lands on |s⟩ — the marking and the interference, exactly as in Unit 07.',
          hints: ['Where did the information live before that layer, and where after?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q9l4',
      title: "Simon's problem, and what these algorithms led to",
      intro:
        'The last of the early family, and the one that pointed directly at Shor: a hidden structure found by sampling and then solved classically.',
      objectives: [
        "Describe Simon's problem and the shape of its solution",
        'Explain why the quantum part only gives samples',
        'Say what this family of algorithms established'
      ],
      concepts: ['simon'],
      requires: ['bernstein-vazirani'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The problem. f takes n bits, and you are promised there is a hidden mask s such that `f(x) = f(x ⊕ s)` for every x — the function is two-to-one, with inputs paired by XOR with s. Find s.'
        },
        {
          kind: 'text',
          text: 'Classically this needs roughly 2^(n/2) queries: you are looking for a collision, two inputs giving the same output, and until you find one you learn nothing about s. The quantum algorithm needs about n queries.'
        },
        { kind: 'heading', text: 'The shape of the solution' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Hadamards on the input register, one oracle call, Hadamards again, measure.',
            'The result is **not** s. It is a random string y satisfying `y · s = 0 mod 2` — one linear equation about s.',
            'Repeat. Each run gives another equation, and about n of them pin s down.',
            'Solve the system of linear equations over GF(2) — classically, with ordinary linear algebra.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This is the template that matters. The quantum part does not produce the answer: it produces **samples with structure**, cheaply, which a classical computation then turns into the answer. Shor has exactly this shape — phase estimation yields a number, and continued fractions classically convert it into the period. Recognising the pattern here makes Unit 12 much less mysterious.'
        },
        { kind: 'heading', text: 'What the family established' },
        {
          kind: 'table',
          headers: ['Algorithm', 'Advantage', 'Caveat'],
          rows: [
            ['Deutsch', '2 queries to 1', 'A proof of principle, not a useful task'],
            ['Deutsch-Jozsa', 'Exponential against certainty', 'Needs a promise; classical randomness nearly closes the gap'],
            ['Bernstein-Vazirani', 'n queries to 1', 'No promise, no shortcut — the cleanest of the four'],
            ['Simon', 'Exponential, even against randomised classical algorithms', 'Needs a promise; and it directly inspired Shor']
          ]
        },
        {
          kind: 'text',
          text: 'Simon is the important one historically. It was the first exponential separation that held up against classical algorithms allowed to use randomness, and its structure — find a hidden periodicity by sampling, finish classically — is what Shor generalised from XOR masks to ordinary arithmetic periods.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'All four are **oracle** results. They say: given a black box with this structure, a quantum computer needs fewer queries. They do not say that any naturally occurring problem has that structure, and for three of the four nobody has found one that matters. Shor is the exception, and it is the exception because factoring really does have the periodic structure the method needs.'
        },
        { kind: 'check', questionId: 'q9l4q1' },
        { kind: 'check', questionId: 'q9l4q2' }
      ],
      questions: [
        {
          id: 'q9l4q1',
          kind: 'choice',
          concept: 'simon',
          prompt: "What does a single run of Simon's quantum circuit give you?",
          difficulty: 'advanced',
          options: [
            'The hidden mask s',
            'A random string y satisfying y · s = 0 — one linear equation about s',
            'One bit of s',
            'A collision in f'
          ],
          answer: 1,
          explanation:
            'One equation, not the answer. About n runs give enough equations, and a classical linear solve over GF(2) finishes the job — the sample-then-solve pattern Shor reuses.',
          hints: ['What do you have to do with the results of several runs?']
        },
        {
          id: 'q9l4q2',
          kind: 'choice',
          concept: 'simon',
          prompt: 'What is the general lesson of this family of algorithms?',
          difficulty: 'advanced',
          options: [
            'Quantum computers are exponentially faster at everything',
            'Given an oracle with the right structure, fewer queries are needed — and the quantum part often produces structured samples that a classical step turns into the answer',
            'Oracles can be queried for free',
            'Classical algorithms are never competitive'
          ],
          answer: 1,
          explanation:
            'Structure-dependent query advantage, plus the hybrid shape. Both halves matter: the advantage requires the problem to have the right form, and the quantum stage is usually one component of a mostly classical algorithm.',
          hints: ['Two things: what the advantage depends on, and what shape the algorithms have.']
        },
        {
          id: 'q9l4q3',
          kind: 'choice',
          concept: 'simon',
          prompt: "Why is Simon's problem historically more important than Deutsch-Jozsa?",
          difficulty: 'advanced',
          options: [
            'It is simpler',
            'Its exponential separation holds against randomised classical algorithms, and its structure directly inspired Shor',
            'It needs fewer qubits',
            'It has practical applications'
          ],
          answer: 1,
          explanation:
            'Deutsch-Jozsa falls to classical randomness; Simon does not. And its hidden-periodicity-by-sampling structure is precisely what Shor generalised to the multiplicative order of an integer.',
          hints: ['What survives when the classical side is allowed to be probabilistic?']
        }
      ]
    }
  ]
}
