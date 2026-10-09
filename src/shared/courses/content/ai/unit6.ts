import type { Module } from '../../types.ts'

/**
 * Unit 06 — The mathematics, where it is needed.
 *
 * Not a mathematics unit bolted on. Four lessons, each one introduced because the next unit cannot be understood
 * without it: dot products because a neuron is one, probability because every classifier output is one,
 * derivatives because gradient descent is one, and gradient descent because it is how every model in the rest of
 * the course is trained.
 *
 * Every symbol is named in words. An equation nobody can read is worse than no equation, because it teaches
 * people that the mathematics is somebody else's business.
 */
export const AI_UNIT_6: Module = {
  id: 'u6',
  title: 'The Mathematics You Actually Need',
  summary:
    'Vectors, matrices and the dot product; probability and expectation; derivatives and gradients; and gradient descent, which is how every model from here on is trained.',
  concepts: ['vectors', 'matrices', 'dot-product', 'probability', 'expectation', 'derivatives', 'gradients', 'gradient-descent', 'learning-rate'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u6l1',
      title: 'Vectors, matrices and the dot product',
      intro:
        'Three objects and one operation. The dot product is the single most important piece of arithmetic in this course — a neuron is a dot product, attention is a dot product, similarity is a dot product.',
      objectives: [
        'Read vector and matrix notation and say what the shapes mean',
        'Compute a dot product and say what it measures',
        'Explain matrix multiplication as a batch of dot products'
      ],
      concepts: ['vectors', 'matrices', 'dot-product'],
      requires: ['features'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **vector** is an ordered list of numbers. One example of your data is a vector; so is a set of weights; so is a word embedding. Writing them this way is not decoration — it means one operation can handle all of them at once.'
        },
        { kind: 'formula', latex: '\\mathbf{x} = [x_1, x_2, \\ldots, x_n]', caption: 'A vector with n components. The bold letter is the whole vector; the subscripted plain letters are its individual numbers.' },
        { kind: 'heading', text: 'The dot product' },
        {
          kind: 'text',
          text: 'Multiply the matching components of two vectors and add up the results. One number out.'
        },
        { kind: 'formula', latex: '\\mathbf{a} \\cdot \\mathbf{b} = \\sum_{j=1}^{n} a_j b_j = a_1b_1 + a_2b_2 + \\cdots + a_nb_n', caption: 'The dot product of two vectors of the same length. Each pair of matching numbers is multiplied; the products are added.' },
        {
          kind: 'example',
          title: 'Worked',
          text: 'a = [2, 1, 3]   b = [4, 0, 5]\n\n2×4 = 8\n1×0 = 0\n3×5 = 15\n        ──\n        23'
        },
        { kind: 'heading', text: 'Why this one operation matters so much' },
        {
          kind: 'text',
          text: 'The dot product measures agreement. If two vectors point the same way, their matching components share signs, the products are positive and the total is large. If they point oppositely, the products are negative and the total is very negative. At right angles, it is zero.'
        },
        {
          kind: 'list',
          items: [
            'A **neuron** computes the dot product of its inputs with its weights, adds a bias, and applies a function. That is the whole neuron.',
            '**Similarity** between two embeddings is a dot product, normalised by length — cosine similarity, Unit 09.',
            '**Attention** scores how much one position should attend to another with a dot product, Unit 10.',
            'A **linear model** prediction is the dot product of features and weights.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Four of the most important ideas in this course are the same arithmetic in different clothes. Getting genuinely comfortable with the dot product — to the point of computing one without thinking — makes the second half of the course much easier.'
        },
        { kind: 'heading', text: 'Matrices' },
        {
          kind: 'text',
          text: 'A **matrix** is a grid: rows and columns. Two uses dominate here. A batch of examples is a matrix, one row per example. And the weights of one network layer are a matrix, so the whole layer is computed in a single multiplication.'
        },
        {
          kind: 'text',
          text: 'Matrix multiplication is a collection of dot products: entry (i, j) of the product is the dot product of row i of the first matrix with column j of the second. Which is why the shapes must agree — the row length must match the column height.'
        },
        { kind: 'formula', latex: '(A B)_{ij} = \\sum_k A_{ik} B_{kj} \\qquad (m \\times k)(k \\times n) = (m \\times n)', caption: 'The inner dimensions must match and vanish; the outer ones survive. A shape error is the most common bug in neural-network code, and this line is how you find it.' },
        {
          kind: 'example',
          title: 'A layer, in one multiplication',
          text: '32 examples, 10 features each        →  X is 32 × 10\nA layer with 64 units                 →  W is 10 × 64\n\nX W  is  32 × 64  — every example through every unit, in one operation.\n\nThis is why graphics processors transformed deep learning: this multiplication is exactly what they were built to do.'
        },
        {
          kind: 'lab',
          appId: 'algebra-lab',
          title: 'Dot products and shapes',
          does:
            'Compute a few dot products by hand and check them. Then multiply two matrices and deliberately get the shapes wrong, so you recognise the error message when a network throws it at you later.'
        },
        { kind: 'check', questionId: 'u6l1q1' },
        { kind: 'check', questionId: 'u6l1q2' },
        { kind: 'check', questionId: 'u6l1q3' }
      ],
      questions: [
        {
          id: 'u6l1q1',
          kind: 'number',
          concept: 'dot-product',
          prompt: 'What is the dot product of [1, 2, 3] and [4, 5, 6]?',
          difficulty: 'beginner',
          answer: 32,
          tolerance: 0.01,
          explanation: '1×4 + 2×5 + 3×6 = 4 + 10 + 18 = 32.',
          hints: ['Multiply matching positions, then add the three products.']
        },
        {
          id: 'u6l1q2',
          kind: 'choice',
          concept: 'dot-product',
          prompt: 'Two vectors have a dot product near zero. What does that suggest?',
          difficulty: 'intermediate',
          options: [
            'They are identical',
            'They point in roughly perpendicular directions — they have little in common',
            'They point in opposite directions',
            'One of them is all zeros'
          ],
          answer: 1,
          explanation:
            'Large positive means aligned, large negative means opposed, near zero means close to perpendicular. An all-zero vector also gives zero, but it is not what a near-zero result generally indicates.',
          hints: ['What does the dot product measure, in one word?']
        },
        {
          id: 'u6l1q3',
          kind: 'choice',
          concept: 'matrices',
          prompt: 'A batch of 16 examples with 8 features each goes into a layer of 32 units. What shapes multiply, and what comes out?',
          difficulty: 'intermediate',
          options: [
            '(16 × 8)(8 × 32) → 16 × 32',
            '(16 × 8)(32 × 8) → 16 × 32',
            '(8 × 16)(16 × 32) → 8 × 32',
            '(16 × 32)(32 × 8) → 16 × 8'
          ],
          answer: 0,
          explanation:
            'The data is 16 × 8 and the weights are 8 × 32. The inner 8s match and disappear, leaving 16 × 32 — one row per example, one column per unit.',
          hints: ['The inner dimensions have to match; the outer ones are what you get.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u6l2',
      title: 'Probability, conditional probability and expectation',
      intro:
        'Classifiers output probabilities, losses are built from them, and sampling from a language model is a probabilistic act. Enough probability to read all three.',
      objectives: [
        'Use probability notation and conditional probability correctly',
        'Explain why P(A|B) and P(B|A) are different, with a case where confusing them matters',
        'Compute an expected value'
      ],
      concepts: ['probability', 'expectation'],
      requires: ['ai-vocabulary'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A probability is a number from 0 to 1 saying how likely something is. Over all the mutually exclusive possibilities it sums to 1 — which is why a classifier output over ten classes adds up to one, and why the softmax function in Unit 07 has the shape it does.'
        },
        { kind: 'heading', text: 'Conditional probability' },
        {
          kind: 'text',
          text: '**P(A | B)** is the probability of A *given that* B is true. Read the bar as "given". Almost everything a model produces is conditional: P(spam | these words), P(next token | everything so far).'
        },
        { kind: 'formula', latex: 'P(A \\mid B) = \\frac{P(A \\text{ and } B)}{P(B)}', caption: 'Of the cases where B happens, the share in which A also happens. The denominator restricts attention to the world where B is true.' },
        { kind: 'heading', text: 'The confusion that matters' },
        {
          kind: 'text',
          text: 'P(A | B) and P(B | A) are different numbers, and swapping them is the commonest serious error in reasoning about test results — including model outputs.'
        },
        {
          kind: 'example',
          title: 'Worked, with real arithmetic',
          text: 'A disease affects 1 in 1,000 people. A test catches 99% of cases and has a 5% false-positive rate.\n\nYou test positive. What is the chance you have the disease?\n\nTake 100,000 people:\n  100 have the disease      →  99 test positive\n  99,900 do not            →  4,995 test positive\n\nTotal positives: 5,094. Of those, 99 really have it.\n\nP(disease | positive) = 99 / 5,094 ≈ 1.9%\n\nP(positive | disease) = 99%. The two numbers differ by a factor of fifty.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is why a model flagging a rare event can be right 99% of the time about the cases it knows and still be wrong about nearly every alarm it raises. It is the same arithmetic as the precision lesson in Unit 03 — precision *is* P(really positive | flagged), and the base rate is what makes it small.'
        },
        { kind: 'heading', text: 'Expectation' },
        {
          kind: 'text',
          text: 'The **expected value** is the average outcome, weighting each possibility by its probability. It is the number you use to compare decisions whose outcomes are uncertain.'
        },
        { kind: 'formula', latex: '\\mathbb{E}[X] = \\sum_i p_i x_i', caption: 'Each possible value x multiplied by its probability p, all added together. Note that the expected value need not be a possible outcome: the expectation of a fair die is 3.5.' },
        {
          kind: 'example',
          title: 'Choosing a threshold with expected cost',
          text: 'A false positive costs 10. A false negative costs 500.\n\nThreshold A: 100 FP, 5 FN   →  100×10 + 5×500 = 3,500\nThreshold B: 20 FP, 30 FN    →  20×10 + 30×500 = 15,200\n\nA is better by this measure, despite making five times as many mistakes. This is the arithmetic behind "set the threshold from the cost of each error" in Unit 03 — and writing it down is how that becomes a decision rather than an argument.'
        },
        {
          kind: 'text',
          text: '**Variance** is how much a quantity moves about its mean. It appears in this course in two places: as the variance half of the bias-variance trade, and as the reason a small test set gives an unreliable estimate.'
        },
        { kind: 'check', questionId: 'u6l2q1' },
        { kind: 'check', questionId: 'u6l2q2' }
      ],
      questions: [
        {
          id: 'u6l2q1',
          kind: 'choice',
          concept: 'probability',
          prompt:
            'A test catches 99% of a disease that affects 1 in 1,000, with a 5% false-positive rate. You test positive. What is roughly the chance you have it?',
          difficulty: 'advanced',
          options: ['99%', 'About 95%', 'About 2%', 'About 50%'],
          answer: 2,
          explanation:
            'Per 100,000 people: 99 true positives and 4,995 false positives, so 99 / 5,094 ≈ 1.9%. The disease is so rare that false positives from the vast healthy majority swamp the true ones.',
          hints: ['Count both groups per 100,000 and compare the two sets of positives.']
        },
        {
          id: 'u6l2q2',
          kind: 'number',
          concept: 'expectation',
          prompt: 'An outcome is worth 100 with probability 0.2, and 10 with probability 0.8. What is the expected value?',
          difficulty: 'intermediate',
          answer: 28,
          tolerance: 0.01,
          explanation: '0.2 × 100 + 0.8 × 10 = 20 + 8 = 28. Note that 28 is not a possible outcome — an expectation is an average, not a prediction.',
          hints: ['Multiply each outcome by its probability and add.']
        },
        {
          id: 'u6l2q3',
          kind: 'true-false',
          concept: 'probability',
          prompt: 'P(spam | contains "offer") is the same as P(contains "offer" | spam).',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Completely different. Nearly all spam may contain "offer" while most messages containing "offer" are legitimate business email. The direction of the conditional is the whole content of the sentence.',
          hints: ['Which population does each one restrict attention to?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u6l3',
      title: 'Derivatives, gradients and gradient descent',
      intro:
        'How every model in the rest of this course is trained. No prior calculus assumed — a derivative is a slope, and a gradient is a slope in several directions at once.',
      objectives: [
        'Explain what a derivative is in terms of slope',
        'Explain what a gradient is and why its sign matters',
        'Describe gradient descent as a procedure, and the effect of the learning rate'
      ],
      concepts: ['derivatives', 'gradients', 'gradient-descent', 'learning-rate'],
      requires: ['loss', 'optimisation', 'vectors'],
      minutes: 17,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Unit 01 left training as "nudge the parameters in the direction that reduces the loss". This lesson is what that direction is and how it is found.'
        },
        { kind: 'heading', text: 'A derivative is a slope' },
        {
          kind: 'text',
          text: 'The derivative of a function at a point says how fast its output changes as you nudge the input: the slope of the curve there. Positive slope means increasing the input increases the output; negative means increasing the input decreases it; zero means flat.'
        },
        { kind: 'formula', latex: '\\frac{dL}{dw} = \\text{how much } L \\text{ changes per unit change in } w', caption: 'The derivative of the loss L with respect to a parameter w. If it is +3, raising w slightly raises the loss about three times as fast — so to reduce the loss you lower w.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That last sentence is the whole of training. The derivative tells you which way is uphill, so you go the other way. Everything else is bookkeeping across many parameters.'
        },
        { kind: 'heading', text: 'A gradient is a slope per parameter' },
        {
          kind: 'text',
          text: 'With one parameter there is one slope. With a million, there is a slope for each — how the loss would change if that one parameter moved, holding the rest still. Collect them all into a vector and you have the **gradient**. It points in the direction of steepest increase, so its negative points downhill.'
        },
        { kind: 'heading', text: 'Gradient descent' },
        { kind: 'formula', latex: 'w \\leftarrow w - \\eta \\frac{\\partial L}{\\partial w}', caption: 'The update, applied to every parameter. η (eta) is the learning rate — the step size. The minus sign is the entire idea: move against the slope, which is downhill.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Start with parameters set to small random values.',
            'Run some examples through and compute the loss.',
            'Compute the gradient — the slope for every parameter.',
            'Take a small step against it.',
            'Repeat, thousands or millions of times.'
          ]
        },
        {
          kind: 'text',
          text: 'That is how a linear model, a convolutional network and a model with hundreds of billions of parameters are all trained. The architecture changes; this procedure does not.'
        },
        { kind: 'heading', text: 'The learning rate' },
        {
          kind: 'table',
          headers: ['Learning rate', 'What happens', 'How it looks'],
          rows: [
            ['Far too small', 'Correct direction, tiny steps', 'Loss falls, agonisingly, and may never arrive'],
            ['About right', 'Steady progress, then settling', 'Loss falls quickly and flattens'],
            ['Too large', 'Steps overshoot the bottom', 'Loss bounces up and down without improving'],
            ['Far too large', 'Each step lands worse than the last', 'Loss rises, often to infinity, and training collapses']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The learning rate is the hyperparameter that most often decides whether training works at all. When a network will not train, it is the first thing to change — and the loss curve tells you which direction to change it in.'
        },
        { kind: 'heading', text: 'Three honest complications' },
        {
          kind: 'list',
          items: [
            '**Local minima and flat regions.** The landscape is not a smooth bowl. In very high dimensions genuine local minima turn out to be less of a problem than expected; long flat stretches and saddle points are more of one.',
            '**Stochastic descent.** Computing the gradient over millions of examples for one step is wasteful, so it is computed on a small **batch** instead. The estimate is noisy, which is actually helpful — the noise shakes the parameters out of flat spots.',
            '**Better optimisers.** Momentum carries speed through flat regions; Adam keeps a separate adaptive step size per parameter. They are refinements of this same procedure, not alternatives to it.'
          ]
        },
        {
          kind: 'lab',
          appId: 'calculus-lab',
          title: 'See the slope, then follow it',
          does:
            'Plot a function and look at its slope at several points. Then follow the slope downhill by hand with a big step and a small step, and watch one overshoot and the other crawl.'
        },
        { kind: 'check', questionId: 'u6l3q1' },
        { kind: 'check', questionId: 'u6l3q2' },
        { kind: 'check', questionId: 'u6l3q3' }
      ],
      questions: [
        {
          id: 'u6l3q1',
          kind: 'choice',
          concept: 'gradients',
          prompt: 'The derivative of the loss with respect to a weight is +5. What should happen to the weight?',
          difficulty: 'intermediate',
          options: [
            'Increase it, because the gradient is positive',
            'Decrease it, because a positive gradient means raising it would raise the loss',
            'Leave it, because the gradient is non-zero',
            'Set it to 5'
          ],
          answer: 1,
          explanation:
            'A positive gradient means the loss climbs as the weight rises, so you move the other way. That is the minus sign in the update rule.',
          hints: ['Which way is uphill, and which way do you want to go?']
        },
        {
          id: 'u6l3q2',
          kind: 'choice',
          concept: 'learning-rate',
          prompt: 'The loss bounces up and down and never settles. What is the most likely cause?',
          difficulty: 'intermediate',
          options: [
            'The learning rate is too small',
            'The learning rate is too large, so each step overshoots the minimum',
            'There is too much data',
            'The model has too few parameters'
          ],
          answer: 1,
          explanation:
            'Oscillation without progress is the signature of too large a step: the update jumps past the bottom and lands on the far side, repeatedly. A rate that is too small gives slow but monotone improvement.',
          hints: ['Picture stepping across a valley rather than down into it.']
        },
        {
          id: 'u6l3q3',
          kind: 'short',
          concept: 'gradient-descent',
          prompt: 'In one sentence: what does gradient descent do?',
          difficulty: 'beginner',
          answer: 'it repeatedly moves the parameters against the gradient of the loss, which is downhill',
          accepts: [
            'moves parameters downhill on the loss',
            'steps against the gradient to reduce loss',
            'adjusts parameters to reduce the loss',
            'follows the slope downhill'
          ],
          explanation:
            'Compute the slope, step the other way, repeat. Every model in this course is trained by this procedure, and the differences between them are in what is being differentiated rather than in the procedure.',
          hints: ['Two things: which direction, and what repeats.']
        }
      ]
    }
  ]
}
