import type { Module } from '../../types.ts'

/**
 * Unit 10 — Grover.
 *
 * The algorithm most often misdescribed, taught through its success curve. Over-rotation gets a lesson to
 * itself because "more iterations is better" is the natural assumption, it is false, and the only convincing
 * refutation is watching the probability come back down.
 *
 * The limits lesson is not a disclaimer. A quadratic query speedup against a real oracle cost is a genuinely
 * different proposition from the headline, and somebody who cannot say why has not understood the algorithm.
 */
export const Q_UNIT_10: Module = {
  id: 'q10',
  title: "Grover's Algorithm",
  summary:
    'Unstructured search in about √N queries: the oracle, inversion about the mean, the iteration count that is best, what happens past it, and what the quadratic speedup is actually worth.',
  concepts: ['grover', 'amplitude-amplification', 'over-rotation', 'grover-limits'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q10l1',
      title: 'Amplitude amplification',
      intro:
        'Search with no structure to exploit. The mechanism is two operations repeated, and it is worth understanding geometrically before algebraically.',
      objectives: [
        'State the search problem and the classical cost',
        'Describe the oracle and the diffusion operator',
        'Say what one Grover iteration does to the amplitudes'
      ],
      concepts: ['grover', 'amplitude-amplification'],
      requires: ['oracle', 'interference'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The problem: there are N possibilities, exactly one of them is the one you want, and the only way to test a possibility is to ask an oracle. No ordering, no structure, nothing to narrow the search with — an unsorted list.'
        },
        {
          kind: 'text',
          text: 'Classically there is nothing clever available. You check possibilities one at a time, and on average you check N/2 before finding it. Grover needs about √N oracle calls: a million possibilities in a thousand queries rather than half a million.'
        },
        { kind: 'heading', text: 'The two operations' },
        {
          kind: 'text',
          text: 'Start with every possibility equally likely: Hadamards on every qubit, so all N amplitudes are 1/√N. Then repeat two steps.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**The oracle** flips the sign of the marked amplitude, and leaves the others alone. One amplitude is now −1/√N and the rest are +1/√N. Note that the *probabilities* are completely unchanged — a sign is invisible to a measurement.',
            '**Inversion about the mean** replaces every amplitude a with (2·mean − a). The marked one, being below the mean, is reflected above it; the others, slightly above, are pulled slightly down.'
          ]
        },
        {
          kind: 'example',
          title: 'One iteration with N = 4, by hand',
          text: 'Start:              all four amplitudes = 0.5\n\nOracle marks |10⟩:  0.5, 0.5, −0.5, 0.5\n\nMean = (0.5 + 0.5 − 0.5 + 0.5)/4 = 0.25\n\nInvert about it: a → 2(0.25) − a = 0.5 − a\n  0.5 → 0.0\n  0.5 → 0.0\n −0.5 → 1.0\n  0.5 → 0.0\n\nResult: amplitude 1 on the marked state, 0 everywhere else. Probability 100%, after exactly one query.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'N = 4 is the case where one iteration is exactly right, which makes it the one to work through by hand. For larger N one iteration is not enough and the amplitude grows gradually — which is where the iteration count comes from.'
        },
        { kind: 'heading', text: 'The geometry' },
        {
          kind: 'text',
          text: 'The two operations together are a **rotation**. In the two-dimensional plane spanned by "the marked state" and "everything else", each iteration turns the state vector by a fixed angle toward the marked state. That is the clearest way to see both why it works and why it eventually stops working.'
        },
        { kind: 'formula', latex: 'k \\approx \\frac{\\pi}{4}\\sqrt{N}', caption: 'The number of iterations that lands closest to the marked state, for one marked item among N. Each iteration turns by about 2/√N radians, and you need to cover about π/2.' },
        {
          kind: 'table',
          headers: ['N', 'Best iterations', 'Classical average', 'Success probability'],
          rows: [
            ['4', '1', '2', '100%'],
            ['8', '2', '4', '94.5%'],
            ['16', '3', '8', '96.1%'],
            ['64', '6', '32', '99.6%'],
            ['1,024', '25', '512', '~100%'],
            ['1,048,576', '804', '524,288', '~100%']
          ]
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Run it, and watch the amplitude grow',
          does:
            'Run Grover from the Algorithms bench with a three-bit marked state and look at the success curve: it starts at 12.5% — one in eight, which is no better than guessing — and climbs with each iteration. Then work the N = 4 case through by hand and check it against the studio.'
        },
        { kind: 'check', questionId: 'q10l1q1' },
        { kind: 'check', questionId: 'q10l1q2' },
        { kind: 'check', questionId: 'q10l1q3' }
      ],
      questions: [
        {
          id: 'q10l1q1',
          kind: 'choice',
          concept: 'amplitude-amplification',
          prompt: 'What does the oracle do in Grover, and what does it not do?',
          difficulty: 'advanced',
          options: [
            'It increases the probability of the marked state',
            'It flips the sign of the marked amplitude, which changes no probability at all — the diffusion step is what converts that into probability',
            'It measures the register',
            'It removes the unmarked states'
          ],
          answer: 1,
          explanation:
            'A sign flip leaves every probability identical. The marking is invisible until inversion about the mean turns the sign difference into an amplitude difference — the mark-then-interfere pattern again.',
          hints: ['What does squaring do to a minus sign?']
        },
        {
          id: 'q10l1q2',
          kind: 'number',
          concept: 'grover',
          prompt: 'About how many Grover iterations are best for searching 10,000 possibilities?',
          difficulty: 'advanced',
          answer: 79,
          tolerance: 3,
          explanation: '(π/4)√10,000 = (π/4)(100) ≈ 78.5, so about 79. Classically you would expect about 5,000 checks.',
          hints: ['π/4 times the square root of N.']
        },
        {
          id: 'q10l1q3',
          kind: 'choice',
          concept: 'amplitude-amplification',
          prompt: 'What does inversion about the mean do to an amplitude that is below the mean?',
          difficulty: 'advanced',
          options: [
            'Sets it to zero',
            'Reflects it to the same distance above the mean, which for the marked state means a large positive amplitude',
            'Leaves it unchanged',
            'Doubles it'
          ],
          answer: 1,
          explanation:
            'a → 2·mean − a reflects every amplitude about the mean. The marked amplitude, pushed negative by the oracle, lands well above it, while the others are nudged down slightly.',
          hints: ['Apply the formula to a = −0.5 with a mean of 0.25.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q10l2',
      title: 'Over-rotation',
      intro:
        'More iterations are not better. Past the peak the success probability falls again, and nothing in the algorithm tells you it has happened.',
      objectives: [
        'Explain why the success probability falls past the optimum',
        'Say what happens if the number of marked items is unknown',
        'Read a success curve and identify the peak'
      ],
      concepts: ['over-rotation'],
      requires: ['amplitude-amplification'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Each iteration rotates the state by a fixed angle toward the marked state. Rotations do not stop when they arrive. Keep going and the vector passes the target and continues away from it.'
        },
        {
          kind: 'example',
          title: 'N = 8, one marked item, measured each iteration',
          text: 'iteration 0:  12.5%   ← the same as guessing\niteration 1:  78.1%\niteration 2:  94.5%   ← the peak\niteration 3:  33.0%\niteration 4:   5.4%\niteration 5:  47.7%\niteration 6:  99.9%   ← back round again\niteration 7:  63.2%\n\nNot a curve that rises to a plateau. A periodic one.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'So Grover is emphatically not "repeat until certain". Run it too long and you can end up with a worse probability than the first iteration gave — and no measurement tells you that is what happened, because you only ever see one outcome. Knowing when to stop is part of the algorithm, not an optimisation.'
        },
        { kind: 'heading', text: 'And if you do not know how many are marked?' },
        {
          kind: 'text',
          text: 'The best iteration count depends on the number of marked items M: it is about (π/4)√(N/M). More marked items means a larger rotation per step and therefore fewer steps. If you do not know M, you do not know when to stop.'
        },
        {
          kind: 'list',
          items: [
            '**Quantum counting** estimates M first, using phase estimation from Unit 12, then runs Grover with the right count.',
            '**Random iteration counts** — pick a count at random from a sensible range, run, check the answer classically, repeat. This loses only a constant factor and needs no knowledge of M.',
            '**Exponential search** — try 1 iteration, then 2, then 4, doubling. Also a constant-factor loss, and simple.'
          ]
        },
        {
          kind: 'text',
          text: 'All three rely on something worth noticing: you can **check** a candidate answer cheaply. Grover finds a needle; verifying that what you pulled out is a needle is one classical oracle call. That asymmetry is what makes the probabilistic strategies safe.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Run past the peak',
          does:
            'Run Grover on a three-bit search with the iteration count set manually to 1, then 2, then 3, then 6, recording the success probability each time. Find the peak, then find the trough after it. The curve is the lesson.'
        },
        { kind: 'check', questionId: 'q10l2q1' },
        { kind: 'check', questionId: 'q10l2q2' }
      ],
      questions: [
        {
          id: 'q10l2q1',
          kind: 'choice',
          concept: 'over-rotation',
          prompt: 'Why does running more Grover iterations than the optimum reduce the success probability?',
          difficulty: 'advanced',
          options: [
            'Noise accumulates',
            'Each iteration is a fixed rotation, and rotations continue past the target — the state turns away from the marked item again',
            'The oracle stops working',
            'The amplitudes stop being normalised'
          ],
          answer: 1,
          explanation:
            'It is geometry, not noise: the state rotates at a constant rate and overshoots. The behaviour is periodic, and an ideal noiseless simulation shows it just as clearly.',
          hints: ['What happens to a rotation that does not stop at the right angle?']
        },
        {
          id: 'q10l2q2',
          kind: 'choice',
          concept: 'over-rotation',
          prompt: 'You do not know how many items are marked. What is a sound approach?',
          difficulty: 'advanced',
          options: [
            'Run as many iterations as possible',
            'Try increasing iteration counts, checking each candidate answer classically — verification is one cheap query, which makes the strategy safe',
            'Guess the count and hope',
            'The algorithm cannot be used'
          ],
          answer: 1,
          explanation:
            'The asymmetry between finding and checking is what rescues it: a candidate can be verified with one classical query, so trying several counts costs only a constant factor.',
          hints: ['What can you do cheaply once you have a candidate?']
        },
        {
          id: 'q10l2q3',
          kind: 'true-false',
          concept: 'over-rotation',
          prompt: 'Grover should be run until the success probability reaches 1.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'The probability generally never reaches exactly 1, and running longer than the optimum makes things worse. You stop at the computed count — and verify the answer classically.',
          hints: ['Look at the iteration table again.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q10l3',
      title: 'What the quadratic speedup is worth',
      intro:
        'A proved quadratic advantage in queries, and the several reasons that does not translate into a quadratic advantage in practice. This lesson is the honest half of the algorithm.',
      objectives: [
        'Distinguish query complexity from running time',
        'Account for the cost of implementing the oracle',
        'Say what Grover is and is not applicable to'
      ],
      concepts: ['grover-limits'],
      requires: ['amplitude-amplification', 'query-complexity'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Grover is optimal: no quantum algorithm can search an unstructured space in fewer than about √N queries, and that has been proved. It is a real result. Here is what stands between it and a practical speedup.'
        },
        { kind: 'heading', text: 'The oracle has to exist' },
        {
          kind: 'text',
          text: 'Grover needs a circuit that recognises the answer — not a list to look up, but a reversible quantum circuit computing "is this the item I want?". For some problems that is natural: checking whether a candidate satisfies a formula, or whether a key decrypts a message. For "search this database" it is not, because loading N records into a quantum circuit costs at least N operations, and you have already spent the speedup before the search begins.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is the point where most popular descriptions of Grover go wrong. It is **not** a database search algorithm. It searches the space of inputs to a function you can compute, and if the function has to be built out of data you must first load, the quadratic gain is consumed by the loading.'
        },
        { kind: 'heading', text: 'Constants and error correction' },
        {
          kind: 'table',
          headers: ['Cost', 'Effect'],
          rows: [
            ['The oracle is a circuit, not one operation', 'Each query is many gates, perhaps thousands'],
            ['Error correction overhead', 'Each logical qubit needs many physical ones, and each logical gate many physical gates'],
            ['Coherence', '√N iterations must all complete before the state decoheres'],
            ['Classical hardware is extremely fast', 'A classical machine checks billions of candidates a second']
          ]
        },
        {
          kind: 'text',
          text: 'Published analyses of this for concrete problems generally find that the crossover — where a fault-tolerant quantum machine running Grover would beat classical hardware — sits at problem sizes and machine sizes well beyond anything that exists. A quadratic speedup multiplied by a large constant factor overhead does not win at small N, and it needs very large N before it does.'
        },
        { kind: 'heading', text: 'Where it genuinely applies' },
        {
          kind: 'table',
          headers: ['Problem', 'Why Grover fits'],
          rows: [
            ['Brute-forcing a symmetric key', 'The oracle is "does this key decrypt to something sensible?" — a circuit, not data'],
            ['Satisfiability and constraint problems', 'The oracle checks an assignment, which is a formula'],
            ['Finding a collision or a pre-image of a hash', 'The oracle computes the hash'],
            ['Speeding up a subroutine inside another algorithm', 'Amplitude amplification generalises beyond search'],
            ['Searching stored records', 'It does **not** — loading the data costs more than the search saves']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The first row has a real consequence: a quadratic speedup on key search means doubling a symmetric key length restores the previous security margin. This is why post-quantum recommendations move symmetric keys from 128 to 256 bits — a modest, well-understood adjustment, and quite unlike the situation with the public-key algorithms Shor attacks.'
        },
        { kind: 'check', questionId: 'q10l3q1' },
        { kind: 'check', questionId: 'q10l3q2' },
        { kind: 'check', questionId: 'q10l3q3' }
      ],
      questions: [
        {
          id: 'q10l3q1',
          kind: 'choice',
          concept: 'grover-limits',
          prompt: 'Why is Grover not a database search algorithm?',
          difficulty: 'advanced',
          options: [
            'Databases are too large',
            'Because the oracle must be a circuit computing a property of a candidate — loading N stored records into a circuit already costs N operations, consuming the speedup',
            'Because databases are classical',
            'Because it only finds one item'
          ],
          answer: 1,
          explanation:
            'The speedup is in queries to a function you can compute. If building that function requires reading all the data, you have spent at least N operations before searching, and √N of them afterwards does not help.',
          hints: ['What would it cost to put the records into the oracle?']
        },
        {
          id: 'q10l3q2',
          kind: 'choice',
          concept: 'grover-limits',
          prompt: 'What is the practical consequence of Grover for symmetric key lengths?',
          difficulty: 'advanced',
          options: [
            'Symmetric cryptography is broken',
            'A quadratic speedup on brute-force search means doubling the key length restores the margin — 128-bit keys become 256-bit',
            'Keys must become four times longer',
            'There is no consequence at all'
          ],
          answer: 1,
          explanation:
            'Quadratic means the effective security halves in bits, so doubling the length restores it. A real and manageable adjustment, quite different from the public-key situation.',
          hints: ['If the search cost goes from N to √N, what happens to the exponent?']
        },
        {
          id: 'q10l3q3',
          kind: 'choice',
          concept: 'grover-limits',
          prompt: 'Grover is proved optimal for unstructured search. What does that mean?',
          difficulty: 'advanced',
          options: [
            'No faster algorithm exists for any search problem',
            'No quantum algorithm can do unstructured search in fewer than about √N queries — though a problem **with** structure may be solvable far faster by other means',
            'Classical algorithms cannot beat it',
            'It always finds the answer with certainty'
          ],
          answer: 1,
          explanation:
            'Optimality is for the unstructured case. A sorted list is searched classically in log N steps, which beats √N comfortably — structure, where it exists, is worth more than amplitude amplification.',
          hints: ['What does the word "unstructured" exclude?']
        }
      ]
    }
  ]
}
