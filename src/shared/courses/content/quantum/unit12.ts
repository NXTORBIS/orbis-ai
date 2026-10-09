import type { Module } from '../../types.ts'

/**
 * Unit 12 — Shor, and what quantum advantage actually means.
 *
 * Shor is taught as three stages — classical, quantum, classical — because that is what it is, and because the
 * learner who thinks the quantum computer factors the number cannot explain why a laptop is still needed. The
 * resource lesson is not a caveat bolted on: the gap between a textbook demonstration and breaking RSA is
 * several orders of magnitude, and the field's credibility depends on saying so.
 */
export const Q_UNIT_12: Module = {
  id: 'q12',
  title: "Shor's Algorithm, and Quantum Advantage",
  summary:
    'Modular arithmetic, period finding, the three stages of Shor, the continued-fraction step, what factoring a real key would actually require, and the difference between speedup, advantage and utility.',
  concepts: [
    'modular-arithmetic',
    'period-finding',
    'continued-fractions',
    'shor',
    'shor-limits',
    'quantum-complexity',
    'bqp',
    'quantum-advantage',
    'post-quantum'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'q12l1',
      title: 'Modular arithmetic and periods',
      intro:
        'The classical mathematics Shor rests on, which is more approachable than its reputation. Clock arithmetic, and the fact that powers repeat.',
      objectives: [
        'Compute modular powers',
        'Find the period of aˣ mod N by hand',
        'Say why the period is connected to the factors of N'
      ],
      concepts: ['modular-arithmetic', 'period-finding'],
      requires: [],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Modular arithmetic** is arithmetic on a clock. `17 mod 12 = 5`, because seventeen hours past noon is five o’clock. Everything wraps round at N.'
        },
        { kind: 'heading', text: 'Powers repeat' },
        {
          kind: 'example',
          title: 'Powers of 7, modulo 15',
          text: '7¹ mod 15 =  7\n7² mod 15 =  49 mod 15 =  4\n7³ mod 15 = 343 mod 15 = 13\n7⁴ mod 15 = 2401 mod 15 =  1   ← back to 1\n7⁵ mod 15 =  7                 ← and it repeats\n7⁶ mod 15 =  4\n\nThe sequence is 7, 4, 13, 1, 7, 4, 13, 1, … with period 4.'
        },
        {
          kind: 'text',
          text: 'The **period** of a modulo N is the smallest r > 0 with `aʳ ≡ 1 mod N`. It always exists when a and N share no common factor, and finding it is easy for small N and hard for large ones — the best known classical methods are essentially as hard as factoring.'
        },
        { kind: 'heading', text: 'Why the period gives factors' },
        {
          kind: 'text',
          text: 'Suppose the period r is even. Then `aʳ ≡ 1`, so `aʳ − 1 ≡ 0 mod N`, which factors as `(a^{r/2} − 1)(a^{r/2} + 1) ≡ 0 mod N`. So N divides that product — and unless one of the brackets is itself a multiple of N, each bracket must share a factor with N. Taking the greatest common divisor finds it.'
        },
        {
          kind: 'example',
          title: 'Factoring 15, by hand',
          text: 'a = 7, and the period is r = 4, which is even.\n\na^{r/2} = 7² = 49, and 49 mod 15 = 4.\n\ngcd(4 − 1, 15) = gcd(3, 15) = 3\ngcd(4 + 1, 15) = gcd(5, 15) = 5\n\n15 = 3 × 5.\n\nNo quantum computer involved. The hard part was finding that the period is 4.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That worked example is the whole of Shor except for one step. Everything in it is school arithmetic; the only thing a quantum computer contributes is finding the period of a large number quickly. Understanding that now makes the next lesson a short one.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Two ways it can fail: the period might be odd, or a^{r/2} might be ≡ −1 mod N, in which case both gcds give trivial answers. Then you try a different a. The algorithm is probabilistic, and a failed attempt is cheap.'
        },
        { kind: 'check', questionId: 'q12l1q1' },
        { kind: 'check', questionId: 'q12l1q2' },
        { kind: 'check', questionId: 'q12l1q3' }
      ],
      questions: [
        {
          id: 'q12l1q1',
          kind: 'number',
          concept: 'modular-arithmetic',
          prompt: 'What is 2⁵ mod 21?',
          difficulty: 'intermediate',
          answer: 11,
          tolerance: 0.5,
          explanation: '2⁵ = 32, and 32 mod 21 = 11.',
          hints: ['Compute the power, then take the remainder.']
        },
        {
          id: 'q12l1q2',
          kind: 'number',
          concept: 'period-finding',
          prompt: 'What is the period of 2ˣ mod 15?',
          difficulty: 'intermediate',
          answer: 4,
          tolerance: 0.5,
          explanation: '2, 4, 8, 1, then it repeats — so the period is 4. Note that 2⁴ = 16 ≡ 1 mod 15.',
          hints: ['List the powers until you return to 1.']
        },
        {
          id: 'q12l1q3',
          kind: 'choice',
          concept: 'period-finding',
          prompt: 'Why does knowing the period help factor N?',
          difficulty: 'advanced',
          options: [
            'The period is one of the factors',
            'Because aʳ − 1 factors as (a^{r/2} − 1)(a^{r/2} + 1) and is divisible by N, so each bracket usually shares a factor with N',
            'Because the period is always even',
            'It does not help; the period is only a check'
          ],
          answer: 1,
          explanation:
            'The factorisation of aʳ − 1 is the link, and the gcds extract the factors. The period is not itself a factor, and it is not always even — which is one of the ways an attempt fails.',
          hints: ['Write aʳ − 1 as a difference of two squares.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'q12l2',
      title: "Shor's algorithm, in three stages",
      intro:
        'Classical setup, quantum period finding, classical finish. Most of the algorithm runs on an ordinary computer, and saying which part does not is the point of the lesson.',
      objectives: [
        'List the stages and say which hardware runs each',
        'Explain what the quantum stage contributes',
        'Describe the continued-fraction step'
      ],
      concepts: ['shor', 'continued-fractions'],
      requires: ['period-finding', 'phase-estimation'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Classical.** Check the easy cases: is N even? a perfect power? Pick a random a < N and compute gcd(a, N) — if it is greater than 1 you have a factor already and need no quantum computer at all.',
            '**Quantum.** Find the period r of aˣ mod N, by phase estimation on the modular multiplication operator.',
            '**Classical.** If r is odd, start again with a different a. Otherwise compute gcd(a^{r/2} ± 1, N) and read off the factors.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Stages 1 and 3 are the arithmetic from the previous lesson, on a laptop, in microseconds. The quantum computer does one thing: finds a period. Anybody who says "a quantum computer factors the number" has merged three stages into one and lost the structure.'
        },
        { kind: 'heading', text: 'What the quantum stage actually does' },
        {
          kind: 'text',
          text: 'The operator is "multiply by a, modulo N". Its eigenvalues are phases of the form k/r — fractions whose denominator is the period. Phase estimation reads one of those phases, so what comes back is an approximation to k/r for some k you do not know.'
        },
        {
          kind: 'text',
          text: 'That is a strange sort of answer: a fraction with the right denominator and an unknown numerator, measured to limited precision. Recovering r from it is the job of the final classical step.'
        },
        { kind: 'heading', text: 'Continued fractions' },
        {
          kind: 'text',
          text: 'Given a decimal approximation to a fraction, the continued-fraction expansion finds the simplest fraction close to it. Phase estimation gives something like 0.3125; the expansion offers 1/3, 5/16 and so on; and the candidate denominators are the candidate periods.'
        },
        {
          kind: 'example',
          title: 'From a measurement to a period',
          text: 'Measured: 4/16 = 0.25\n\nContinued-fraction convergents of 0.25:  1/4\n\nCandidate period: 4. Check it: is 7⁴ ≡ 1 mod 15? 2401 mod 15 = 1. Yes.\n\nSo r = 4, and the classical stage finishes the factoring.'
        },
        {
          kind: 'text',
          text: 'Each candidate is checked by one modular exponentiation, which is cheap. If none works, run the quantum stage again — a different measurement gives a different k and usually a different convergent.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is the sample-then-solve shape from Simon in Unit 09, exactly. The quantum stage produces a structured sample; a classical computation turns samples into the answer; failures are cheap and you retry. Nearly every useful quantum algorithm has this shape, and recognising it is worth more than memorising any one of them.'
        },
        {
          kind: 'lab',
          appId: 'quantum-studio',
          title: 'Factor 15 and 21, and read the stages',
          does:
            'Run Shor on 15 from the Algorithms bench and read what it reports: the base it tried, the period it found, and the classical step that produced the factors. Then run it on 21 and watch an attempt fail and another succeed — the algorithm is probabilistic, and seeing a failure is part of understanding it.'
        },
        { kind: 'check', questionId: 'q12l2q1' },
        { kind: 'check', questionId: 'q12l2q2' },
        { kind: 'check', questionId: 'q12l2q3' }
      ],
      questions: [
        {
          id: 'q12l2q1',
          kind: 'choice',
          concept: 'shor',
          prompt: 'Which part of Shor runs on a quantum computer?',
          difficulty: 'intermediate',
          options: [
            'All of it',
            'Only the period finding — the setup and the final gcd steps are ordinary classical arithmetic',
            'Only the final gcd',
            'None of it'
          ],
          answer: 1,
          explanation:
            'Period finding, and nothing else. The algorithm is mostly classical, and the quantum machine is an accelerator for the one step classical methods cannot do quickly.',
          hints: ['Which of the three stages needs something a laptop cannot do?']
        },
        {
          id: 'q12l2q2',
          kind: 'choice',
          concept: 'continued-fractions',
          prompt: 'What does the continued-fraction step do?',
          difficulty: 'advanced',
          options: [
            'Computes the factors directly',
            'Turns the measured approximation of k/r into candidate denominators — candidate periods — which are then checked cheaply',
            'Improves the precision of the quantum measurement',
            'Chooses the base a'
          ],
          answer: 1,
          explanation:
            'The measurement gives an approximation to a fraction with an unknown numerator. The expansion finds simple fractions near it, and each denominator is a period to test by one modular exponentiation.',
          hints: ['What did the quantum stage actually hand you?']
        },
        {
          id: 'q12l2q3',
          kind: 'choice',
          concept: 'shor',
          prompt: 'What happens if the period found is odd?',
          difficulty: 'advanced',
          options: [
            'The algorithm fails permanently',
            'That attempt is abandoned and a different base a is tried — the algorithm is probabilistic and a failed attempt is cheap',
            'The factors are computed differently',
            'The period is rounded up'
          ],
          answer: 1,
          explanation:
            'The difference-of-squares step needs r/2 to be a whole number. An odd period means try again with another base, which succeeds with good probability.',
          hints: ['What does the factoring step need r to be?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'q12l3',
      title: 'What factoring a real key would require',
      intro:
        'The gap between a textbook demonstration and breaking a 2048-bit key, in numbers. This is the lesson that makes you able to read a news story about quantum computing.',
      objectives: [
        'State roughly what resources a cryptographically relevant run would need',
        'Explain why error correction multiplies the requirement',
        'Say what post-quantum cryptography is and is not'
      ],
      concepts: ['shor-limits', 'post-quantum'],
      requires: ['shor'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Shor factors 15 in a demonstration circuit. Factoring a 2048-bit RSA key is the same algorithm at a scale that changes everything about what it needs.'
        },
        {
          kind: 'table',
          headers: ['', 'Factoring 15', 'Factoring a 2048-bit key'],
          rows: [
            ['Logical qubits', 'A handful', 'A few thousand'],
            ['Physical qubits, with error correction', 'The same handful', 'Of the order of a million, by published estimates'],
            ['Gate operations', 'Tens', 'Of the order of a billion or more'],
            ['Circuit depth', 'Tens', 'Enormous — every operation must complete coherently'],
            ['Error rate needed', 'A demonstration tolerates a lot', 'Below the error-correction threshold, maintained throughout'],
            ['Machines that can do it today', 'Several', 'None']
          ]
        },
        { kind: 'heading', text: 'Why error correction multiplies everything' },
        {
          kind: 'text',
          text: 'A logical qubit protected well enough to survive a billion operations needs many physical qubits — estimates vary with the code and the error rate, and the figures published for surface codes run from hundreds to thousands of physical qubits per logical one. Every logical gate becomes many physical gates. Unit 14 explains the mechanism; the consequence here is a multiplier of three or four orders of magnitude on both qubit count and runtime.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'So "a quantum computer with 100 qubits exists, and Shor needs a few thousand logical qubits, therefore we are nearly there" is wrong by a very large factor. Those 100 are physical, noisy and uncorrected. The distance between present hardware and a cryptographically relevant machine is measured in orders of magnitude, not in a few product generations.'
        },
        {
          kind: 'text',
          text: 'Worth saying as plainly: nobody knows when, or whether, such a machine will be built. The honest position is that the algorithm is proved, the engineering problem is unsolved, and the timeline is genuinely uncertain — which is a different statement from both "it is imminent" and "it is impossible".'
        },
        { kind: 'heading', text: 'Post-quantum cryptography' },
        {
          kind: 'text',
          text: 'Given that uncertainty, the response has been to replace the vulnerable algorithms in advance. **Post-quantum cryptography** means classical algorithms — running on ordinary computers — whose security rests on problems no efficient quantum algorithm is known for. Lattice problems are the main family, and standards have been selected and published.'
        },
        {
          kind: 'table',
          headers: ['', 'Quantum cryptography', 'Post-quantum cryptography'],
          rows: [
            ['Runs on', 'Quantum hardware', 'Ordinary computers'],
            ['Protects by', 'Physical properties of quantum states', 'Mathematical problems believed hard for quantum computers'],
            ['Needs new hardware', 'Yes', 'No'],
            ['Deployed today', 'Narrowly, in specialised links', 'Yes, being rolled out broadly']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'These two are constantly confused and are unrelated. Post-quantum cryptography is a software change you can make this year. Quantum cryptography, which Unit 16 covers, is a hardware protocol using qubits. Mixing them up is one of the clearest signs that somebody is repeating a headline rather than reading the subject.'
        },
        {
          kind: 'text',
          text: 'And one real reason to act now rather than later: data captured today can be stored and decrypted when a machine exists. For anything that must stay secret for decades, the threat is already present even though the machine is not.'
        },
        { kind: 'check', questionId: 'q12l3q1' },
        { kind: 'check', questionId: 'q12l3q2' },
        { kind: 'check', questionId: 'q12l3q3' }
      ],
      questions: [
        {
          id: 'q12l3q1',
          kind: 'choice',
          concept: 'shor-limits',
          prompt: 'A machine with 100 physical qubits exists. Shor needs a few thousand logical qubits. How close is that?',
          difficulty: 'advanced',
          options: [
            'Very close — a factor of a few dozen',
            'Not close: each logical qubit needs hundreds to thousands of physical ones, so the requirement is of the order of a million physical qubits',
            'Already achieved',
            'Impossible in principle'
          ],
          answer: 1,
          explanation:
            'Logical and physical qubits differ by the error-correction overhead, which is three or four orders of magnitude. Comparing the two numbers directly is the commonest way a news story overstates progress.',
          hints: ['What is the difference between a logical and a physical qubit?']
        },
        {
          id: 'q12l3q2',
          kind: 'choice',
          concept: 'post-quantum',
          prompt: 'What is post-quantum cryptography?',
          difficulty: 'intermediate',
          options: [
            'Cryptography using quantum hardware',
            'Classical algorithms, on ordinary computers, based on problems no efficient quantum algorithm is known for',
            'Encryption that cannot be broken',
            'The same thing as quantum key distribution'
          ],
          answer: 1,
          explanation:
            'Classical software, deployable now. It is unrelated to quantum key distribution, which needs quantum hardware — and the two being confused is a reliable sign of second-hand reporting.',
          hints: ['What hardware does it run on?']
        },
        {
          id: 'q12l3q3',
          kind: 'choice',
          concept: 'shor-limits',
          prompt: 'Why act on post-quantum cryptography before a capable machine exists?',
          difficulty: 'advanced',
          options: [
            'Because the machine is certainly imminent',
            'Because encrypted data captured today can be stored and decrypted later, so anything needing long-term secrecy is already exposed',
            'Because classical cryptography is already broken',
            'There is no reason to act yet'
          ],
          answer: 1,
          explanation:
            'Capture now, decrypt later. For data with a multi-decade secrecy requirement the threat is present today, which is why migration is under way despite the timeline being uncertain.',
          hints: ['What can an adversary do with ciphertext they cannot yet read?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'q12l4',
      title: 'Speedup, advantage and utility',
      intro:
        'Four words used interchangeably in headlines and meaning quite different things. Being able to separate them is most of being able to read this field.',
      objectives: [
        'Distinguish speedup, advantage, utility and practical superiority',
        'Say what BQP is at an accessible level',
        'Assess a claim about quantum performance'
      ],
      concepts: ['quantum-complexity', 'bqp', 'quantum-advantage'],
      requires: ['shor-limits', 'query-complexity'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'table',
          headers: ['Term', 'Means', 'Example'],
          rows: [
            ['Quantum speedup', 'A proved asymptotic improvement in some resource', 'Grover: √N queries instead of N'],
            ['Quantum advantage', 'A demonstrated task done faster than the best classical attempt', 'Sampling experiments, contested and revisited as classical methods improve'],
            ['Quantum utility', 'Doing something somebody actually wanted, better', 'Not yet convincingly established for any commercial task'],
            ['Practical superiority', 'Routinely the better choice for a real workload', 'Nothing']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Headlines collapse all four into "quantum computer beats supercomputer". Several such claims have been followed by better classical algorithms that closed the gap — which is science working, and also a reason to read the specific claim rather than the summary. Ask: faster at what, measured how, against which classical method, and does anybody need the answer?'
        },
        { kind: 'heading', text: 'Several costs, not one' },
        {
          kind: 'text',
          text: 'Unit 07 introduced depth and width. A complete account of what a quantum algorithm costs has more entries than that, and an improvement in one can be a regression in another.'
        },
        {
          kind: 'list',
          items: [
            '**Query count** — how many oracle calls. What Grover and Deutsch-Jozsa improve.',
            '**Gate count and depth** — the circuit itself. Depth is what noise punishes.',
            '**Qubit count** — width, and in a corrected machine the physical count that follows from it.',
            '**Shots** — how many repetitions to get a reliable answer. A probabilistic algorithm needs several.',
            '**Classical work** — the pre- and post-processing. In Shor this is most of the algorithm.'
          ]
        },
        {
          kind: 'text',
          text: 'A fair comparison states all of them. "Fewer queries" with a thousand-times-deeper circuit is not obviously a win, and a result quoted as a single number has usually chosen the flattering one.'
        },
        { kind: 'heading', text: 'BQP, briefly' },
        {
          kind: 'text',
          text: '**BQP** is the class of decision problems a quantum computer can solve in polynomial time with bounded error — the quantum analogue of the classical class P. Factoring is in BQP; whether it is in P is unknown. What BQP is **not** known to contain is the hardest problems: the general expectation is that quantum computers do not solve NP-complete problems efficiently, and Grover only gives a quadratic improvement there.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'That last point deserves emphasis, because it contradicts the popular impression. Quantum computers are not believed to make the hardest combinatorial problems easy. The best general result for them is a quadratic improvement — which is real, and is nothing like "solves them instantly".'
        },
        { kind: 'heading', text: 'How to read a claim' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'What exactly was computed? A sampling task, or something somebody wanted?',
            'What was it compared against — the best known classical algorithm, or an obvious one?',
            'Which resource improved, and what happened to the others?',
            'Physical qubits or logical ones? Was error correction involved?',
            'Has a classical algorithm since closed the gap? This has happened more than once.'
          ]
        },
        { kind: 'check', questionId: 'q12l4q1' },
        { kind: 'check', questionId: 'q12l4q2' },
        { kind: 'check', questionId: 'q12l4q3' }
      ],
      questions: [
        {
          id: 'q12l4q1',
          kind: 'choice',
          concept: 'quantum-advantage',
          prompt: 'A machine performs a sampling task faster than the best classical simulation. Which term fits?',
          difficulty: 'advanced',
          options: [
            'Quantum utility',
            'Quantum advantage — a demonstrated task done faster, with no claim that anybody needed the result',
            'Practical superiority',
            'Quantum speedup'
          ],
          answer: 1,
          explanation:
            'Advantage is the demonstration. Utility would require the task to be something useful, and speedup is a proved asymptotic statement rather than a single experiment.',
          hints: ['Which of the four is about a demonstration rather than a proof or a use?']
        },
        {
          id: 'q12l4q2',
          kind: 'choice',
          concept: 'bqp',
          prompt: 'Are quantum computers believed to solve NP-complete problems efficiently?',
          difficulty: 'advanced',
          options: [
            'Yes, that is their main application',
            'No — the general expectation is that they do not, and Grover gives only a quadratic improvement there',
            'Yes, using Shor',
            'The question is meaningless'
          ],
          answer: 1,
          explanation:
            'BQP is not believed to contain NP-complete problems. The best general tool is amplitude amplification, which is quadratic — a real gain and not a solution.',
          hints: ['What is the best general-purpose quantum speedup you have met?']
        },
        {
          id: 'q12l4q3',
          kind: 'multi',
          concept: 'quantum-complexity',
          prompt: 'Which questions belong in a fair assessment of a quantum performance claim? Choose all that apply.',
          difficulty: 'advanced',
          options: [
            'What was it compared against?',
            'Were the qubits physical or logical?',
            'Which resource improved, and what happened to the others?',
            'How impressive did the press release sound?'
          ],
          answer: [0, 1, 2],
          explanation:
            'The comparison baseline, the qubit accounting, and the full resource picture. The fourth is how claims get overstated rather than how they get assessed.',
          hints: ['Three of these are from the reading list at the end of the lesson.']
        }
      ]
    }
  ]
}
