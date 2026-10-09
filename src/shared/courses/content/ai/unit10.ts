import type { Module } from '../../types.ts'

/**
 * Unit 10 — Attention and transformers.
 *
 * The hardest unit to teach honestly. Attention is usually either waved at ("the model attends to what matters")
 * or dumped as an equation. This unit builds it from the retrieval analogy, then computes a small example by
 * hand, then assembles the block — and finishes by asking the learner to trace one token from input to output
 * probability, which is the only test that distinguishes understanding from recognition.
 */
export const AI_UNIT_10: Module = {
  id: 'u10',
  title: 'Attention and Transformers',
  summary:
    'Queries, keys and values; attention computed by hand; masking and causality; multiple heads; positional information; and the transformer block that every modern language model is built from.',
  concepts: ['attention', 'qkv', 'self-attention', 'masking', 'multi-head', 'positional', 'transformer', 'encoder-decoder'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u10l1',
      title: 'Attention: queries, keys and values',
      intro:
        'One mechanism, borrowed from the idea of looking something up. Every position asks a question, every position advertises what it has, and the answers are mixed in proportion to how well they match.',
      objectives: [
        'Explain attention as a soft lookup',
        'Say what the query, key and value vectors are for',
        'Compute a small attention step by hand'
      ],
      concepts: ['attention', 'qkv'],
      requires: ['embeddings', 'dot-product', 'long-range'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Start with an ordinary lookup. You have a dictionary: each entry has a **key** and a **value**. You arrive with a **query**, find the key that matches, and take its value. Exactly one entry matches, and you get exactly one value.'
        },
        {
          kind: 'text',
          text: 'Attention is that, made soft. Your query is compared with *every* key, each comparison gives a score, the scores become weights, and the answer is a weighted mixture of *all* the values. Nothing is chosen; everything contributes in proportion to how well it matched.'
        },
        { kind: 'heading', text: 'Where the three vectors come from' },
        {
          kind: 'text',
          text: 'Each position starts with one embedding. Three learned weight matrices turn that one vector into three: a query, a key and a value. Same input, three different projections, three different jobs.'
        },
        {
          kind: 'table',
          headers: ['Vector', 'Role', 'Loosely'],
          rows: [
            ['Query (Q)', 'What this position is looking for', '"I am a verb and I need my subject"'],
            ['Key (K)', 'What this position offers', '"I am a plural noun"'],
            ['Value (V)', 'What this position contributes if attended to', 'The content actually passed along']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The quoted phrases are an analogy, not a claim about the vectors. Nobody labels a position as a verb; the projections are learned from the prediction objective, and what they end up encoding is whatever helped. Interpretability research finds recognisable patterns in some heads and nothing legible in many others.'
        },
        { kind: 'heading', text: 'The computation' },
        { kind: 'formula', latex: '\\text{Attention}(Q, K, V) = \\text{softmax}\\!\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right) V', caption: 'QKᵀ is every query against every key — a grid of scores. Dividing by the square root of the key dimension keeps the scores from growing with dimension. Softmax turns each row into weights summing to 1. Multiplying by V mixes the values.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Score every query against every key with a dot product. Large score = good match.',
            'Divide by √d_k. Without it, long vectors produce huge dot products, softmax saturates, and the gradient dies.',
            'Softmax each row, so the weights for one position sum to 1.',
            'Multiply the weights by the values and add. That mixture is the output for that position.'
          ]
        },
        {
          kind: 'example',
          title: 'Three positions, computed by hand',
          text: 'Position 3 has query q = [1, 0].\nKeys:   k₁ = [1, 0]   k₂ = [0, 1]   k₃ = [0.7, 0.7]\nValues: v₁ = [10, 0]  v₂ = [0, 10]  v₃ = [5, 5]\n\nscores (dot with q):  1.0,  0.0,  0.7\nsoftmax (d_k = 2, so divide by 1.41 first: 0.71, 0, 0.50):\n   e^0.71 = 2.03,  e^0 = 1.00,  e^0.50 = 1.65   total 4.68\n   weights ≈ 0.43, 0.21, 0.35\n\noutput = 0.43(10,0) + 0.21(0,10) + 0.35(5,5)\n       = (4.3, 0) + (0, 2.1) + (1.8, 1.8)\n       = (6.1, 3.9)\n\nPosition 1 matched best, so its value dominates — but positions 2 and 3 both contributed.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Everything about attention is in that arithmetic. One dot product per pair, a softmax, and a weighted sum. The sophistication of a transformer comes from doing this many times in parallel and stacking the result, not from the operation being complicated.'
        },
        { kind: 'heading', text: 'The cost' },
        {
          kind: 'text',
          text: 'Every position attends to every position, so the number of scores is the sequence length squared. Double the context and the attention cost quadruples. That single fact explains why context windows were small for years, why extending them is a research problem in itself, and why longer prompts cost more than proportionally more.'
        },
        { kind: 'check', questionId: 'u10l1q1' },
        { kind: 'check', questionId: 'u10l1q2' },
        { kind: 'check', questionId: 'u10l1q3' }
      ],
      questions: [
        {
          id: 'u10l1q1',
          kind: 'choice',
          concept: 'qkv',
          prompt: 'In attention, what does the query vector represent?',
          difficulty: 'advanced',
          options: [
            'The output of the layer',
            'What this position is looking for, which gets compared against every key',
            'The content this position passes on',
            'The position index in the sequence'
          ],
          answer: 1,
          explanation:
            'The query is the question. Keys advertise what each position offers, values are what gets mixed. All three are learned projections of the same input embedding.',
          hints: ['In a dictionary lookup, which of the three do you arrive with?']
        },
        {
          id: 'u10l1q2',
          kind: 'choice',
          concept: 'attention',
          prompt: 'Why are the attention scores divided by the square root of the key dimension?',
          difficulty: 'advanced',
          options: [
            'To make them sum to 1',
            'Because dot products grow with dimension, and without the division softmax saturates and the gradient nearly vanishes',
            'To speed up the computation',
            'To make the output the right shape'
          ],
          answer: 1,
          explanation:
            'With large d_k the dot products become large, softmax goes nearly one-hot, and the gradient flattens. The scaling keeps the scores in a workable range. Softmax, not the division, is what makes the weights sum to 1.',
          hints: ['What happens to softmax when its inputs are very large?']
        },
        {
          id: 'u10l1q3',
          kind: 'choice',
          concept: 'attention',
          prompt: 'Why does doubling the context length roughly quadruple the attention cost?',
          difficulty: 'advanced',
          options: [
            'Because the model has twice as many parameters',
            'Because every position attends to every position, so the number of scores grows with the square of the length',
            'Because softmax is quadratic',
            'Because the embeddings double in size'
          ],
          answer: 1,
          explanation:
            'n positions each attending to n positions is n² scores. Parameters do not change with sequence length; the attention grid does, and quadratically.',
          hints: ['Count the pairs.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u10l2',
      title: 'Self-attention, masking and multiple heads',
      intro:
        'Three refinements that turn the mechanism into something you can build a language model from — including the one that makes generation possible at all.',
      objectives: [
        'Explain self-attention',
        'Explain causal masking and why a generative model needs it',
        'Say what multiple heads buy'
      ],
      concepts: ['self-attention', 'masking', 'multi-head'],
      requires: ['qkv'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Self-attention' },
        {
          kind: 'text',
          text: '**Self-attention** is attention where the queries, keys and values all come from the same sequence. Every position looks at every position of the same text, including itself. This is how a representation becomes contextual: the vector for "bank" is built partly from the vectors of the words around it, so "river bank" and "savings bank" end up different.'
        },
        {
          kind: 'example',
          title: 'What it resolves',
          text: '"The trophy would not fit in the suitcase because it was too large."\n\nWhat does "it" refer to? Change one word:\n\n"The trophy would not fit in the suitcase because it was too small."\n\nNow "it" refers to the suitcase. Self-attention gives the position holding "it" a direct connection to both candidate nouns and to "large"/"small", in one step — no matter how many words apart they are. A recurrent network would have to carry that through every intervening step.'
        },
        { kind: 'heading', text: 'Masking' },
        {
          kind: 'text',
          text: 'A model trained to predict the next token must not be allowed to see it. But self-attention naturally lets every position see every other, including later ones — so during training, where the whole sentence is present at once, the model could read the answer straight off.'
        },
        {
          kind: 'text',
          text: '**Causal masking** prevents it: before the softmax, every score for a later position is set to minus infinity, so its weight after softmax is exactly zero. Position 5 can attend to 1 through 5 and nothing beyond.'
        },
        {
          kind: 'example',
          title: 'The mask',
          text: 'Allowed (✓) and blocked (·), rows attending to columns:\n\n          to:  1  2  3  4\n   from 1:      ✓  ·  ·  ·\n   from 2:      ✓  ✓  ·  ·\n   from 3:      ✓  ✓  ✓  ·\n   from 4:      ✓  ✓  ✓  ✓\n\nThis triangle is why a generative model can be trained on a whole document in one pass: every position predicts its successor, and none of them can cheat.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Not every model is masked. A model built to *understand* rather than generate — classification, retrieval, filling in a blank — lets every position see everything, which is strictly more information. Masking is required only when the task is predicting what comes next.'
        },
        { kind: 'heading', text: 'Multiple heads' },
        {
          kind: 'text',
          text: 'One attention operation produces one set of weights per position: one way of relating the sequence to itself. But there are many relationships worth tracking at once — grammatical agreement, what a pronoun refers to, which adjective modifies which noun.'
        },
        {
          kind: 'text',
          text: '**Multi-head attention** runs several attentions in parallel, each with its own learned Q, K and V projections, each on a slice of the dimensions. Their outputs are concatenated and mixed by one more learned matrix. Twelve heads over 768 dimensions means each head works in 64 — the cost is roughly the same as one full-width attention, and you get twelve different views instead of one.'
        },
        {
          kind: 'list',
          items: [
            'Interpretability work has found heads that look like specialists: one tracking the previous token, one tracking syntactic dependency, one copying from earlier in the text.',
            'Many heads have no legible function at all, and some can be removed with little loss.',
            'So "each head learns a different relationship" is a useful intuition and an overstatement — the honest version is that heads can specialise and some demonstrably do.'
          ]
        },
        { kind: 'check', questionId: 'u10l2q1' },
        { kind: 'check', questionId: 'u10l2q2' }
      ],
      questions: [
        {
          id: 'u10l2q1',
          kind: 'choice',
          concept: 'masking',
          prompt: 'Why does a next-token model need causal masking during training?',
          difficulty: 'advanced',
          options: [
            'To save computation',
            'Because the whole sequence is present during training, so without the mask a position could attend to the token it is supposed to predict',
            'To keep the attention weights summing to 1',
            'To handle sequences of different lengths'
          ],
          answer: 1,
          explanation:
            'The answer is in the input. Masking sets later positions to minus infinity before softmax, so their weight is zero and each position can only use what precedes it — which is what makes training on a whole document in one pass legitimate.',
          hints: ['What is sitting right next to position 5 during training?']
        },
        {
          id: 'u10l2q2',
          kind: 'choice',
          concept: 'multi-head',
          prompt: 'Twelve heads over a 768-dimensional model. What is the cost compared with one full-width attention?',
          difficulty: 'advanced',
          options: [
            'Twelve times as much',
            'About the same — each head works in 64 dimensions, so the total width is unchanged',
            'A twelfth as much',
            'It depends on the sequence length only'
          ],
          answer: 1,
          explanation:
            'The dimensions are divided among the heads rather than duplicated: 12 × 64 = 768. Roughly the same arithmetic, twelve different views of the sequence instead of one.',
          hints: ['Multiply the number of heads by the dimension each one works in.']
        },
        {
          id: 'u10l2q3',
          kind: 'short',
          concept: 'self-attention',
          prompt: 'What makes self-attention "self"?',
          difficulty: 'intermediate',
          answer: 'the queries, keys and values all come from the same sequence',
          accepts: [
            'it attends to the same sequence',
            'q k and v come from one sequence',
            'the sequence attends to itself',
            'all three come from the same input'
          ],
          explanation:
            'All three projections come from the same input, so the sequence relates to itself. Cross-attention is the other case, where the queries come from one sequence and the keys and values from another.',
          hints: ['Where do the three vectors come from?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u10l3',
      title: 'The transformer block, and the whole forward path',
      intro:
        'Assembling the pieces into the architecture, then following one token from text all the way to a probability over the vocabulary. If you can do that trace, you understand this unit.',
      objectives: [
        'Name the components of a transformer block and say what each does',
        'Explain how positional information is restored',
        'Trace an input from text to next-token probabilities'
      ],
      concepts: ['positional', 'transformer', 'encoder-decoder'],
      requires: ['multi-head', 'dropout', 'forward-pass'],
      minutes: 19,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'The problem attention created' },
        {
          kind: 'text',
          text: 'Attention is a weighted sum over positions, and a sum does not care about order. Shuffle the input and the attention output for each position is unchanged. So the architecture that solved long-range dependence began by throwing away word order entirely — which, for language, is fatal.'
        },
        {
          kind: 'text',
          text: '**Positional encoding** puts it back: a vector depending only on the position is added to each token embedding before the first block. Now "dog bites man" and "man bites dog" produce different inputs. Schemes vary — fixed sine waves of different frequencies, learned vectors, or rotations applied inside the attention computation — and all do the same job.'
        },
        { kind: 'heading', text: 'The block' },
        {
          kind: 'example',
          title: 'One transformer block',
          text: 'x ──┬──────────────────────────────────┐\n    │                                  │\n    ▼                                  │\n  layer norm                           │\n    ▼                                  │\n  multi-head self-attention            │\n    ▼                                  │\n    └──────────── + ◄──────────────────┘   residual\n                  │\n    ┌─────────────┴────────────────────┐\n    ▼                                  │\n  layer norm                           │\n    ▼                                  │\n  feed-forward: expand ×4, activate,   │\n                contract back          │\n    ▼                                  │\n    └──────────── + ◄──────────────────┘   residual\n                  │\n                  ▼  to the next block'
        },
        {
          kind: 'table',
          headers: ['Component', 'What it does', 'Why it is there'],
          rows: [
            ['Layer normalisation', 'Standardises each position vector', 'Keeps activations in a workable range; makes deep stacks trainable'],
            ['Multi-head attention', 'Mixes information across positions', 'The only part that moves information between positions'],
            ['Residual connection', 'Adds the input to the output', 'Gives the gradient a clear path back through hundreds of blocks'],
            ['Feed-forward network', 'Two dense layers per position, with a wider middle', 'Where most of the parameters and most of the per-position processing live'],
            ['Dropout', 'Randomly drops activations in training', 'Regularisation']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Worth noticing: attention is the only component that communicates between positions. The feed-forward network, the normalisation and the residuals all act on each position independently. A transformer is "mix across positions, then think hard about each one", repeated.'
        },
        { kind: 'heading', text: 'The whole forward path' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Text is tokenised into ids: "the cat sat" → [464, 3797, 3332].',
            'Each id looks up a row of the embedding matrix — a vector of, say, 768 numbers.',
            'Positional information is added.',
            'The sequence passes through N transformer blocks — 12, 32, 96. Every block mixes across positions, then processes each position.',
            'A final layer normalisation.',
            'The output vector for the last position is multiplied by the vocabulary matrix, giving one score per possible token. These scores are the **logits**.',
            'Softmax turns the logits into a probability distribution over the whole vocabulary.',
            'A token is chosen from that distribution, appended to the input, and the whole thing runs again.'
          ]
        },
        {
          kind: 'text',
          text: 'That last step is worth sitting with. Generating a hundred tokens means a hundred forward passes, each one slightly longer than the last. It is why generation is slower than it feels like it should be, and why the cost grows with the length of what you asked for.'
        },
        { kind: 'heading', text: 'Three architectures' },
        {
          kind: 'table',
          headers: ['Shape', 'Masking', 'Good at', 'Example use'],
          rows: [
            ['Encoder only', 'None — every position sees everything', 'Understanding a whole input', 'Classification, retrieval embeddings'],
            ['Decoder only', 'Causal', 'Generating text', 'Essentially every modern chat model'],
            ['Encoder-decoder', 'Encoder unmasked, decoder causal with cross-attention', 'Transforming one sequence into another', 'Translation, summarisation']
          ]
        },
        {
          kind: 'text',
          text: '**Cross-attention** is the mechanism in the third row: the decoder queries come from the text being generated, while the keys and values come from the encoder output. The decoder is asking questions of the source sequence while writing the target one.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Decoder-only architectures dominate now, which was not obvious in advance. It turned out that a model trained only to predict the next token, at sufficient scale, handles understanding tasks well enough that the extra machinery was not worth its cost — which is the subject of Unit 11.'
        },
        {
          kind: 'lab',
          appId: 'explain-it-yourself',
          title: 'Trace one token, out loud',
          does:
            'Explain the path from the word "cat" in a sentence to a probability over the vocabulary, naming every step. This is the one assessment in the unit that cannot be passed by recognising the right answer.'
        },
        { kind: 'check', questionId: 'u10l3q1' },
        { kind: 'check', questionId: 'u10l3q2' },
        { kind: 'check', questionId: 'u10l3q3' }
      ],
      questions: [
        {
          id: 'u10l3q1',
          kind: 'choice',
          concept: 'positional',
          prompt: 'Why does a transformer need positional information added explicitly?',
          difficulty: 'advanced',
          options: [
            'To tell the model how long the sequence is',
            'Because attention is a weighted sum over positions, which is order-insensitive — without it, a shuffled sentence gives the same representation',
            'To speed up attention',
            'To let the model handle batches'
          ],
          answer: 1,
          explanation:
            'A sum does not know the order of what it summed. Adding a position-dependent vector to each embedding is what makes "dog bites man" and "man bites dog" different inputs.',
          hints: ['What would happen to the attention output if you shuffled the input?']
        },
        {
          id: 'u10l3q2',
          kind: 'choice',
          concept: 'transformer',
          prompt: 'Which component of a transformer block moves information between positions?',
          difficulty: 'advanced',
          options: [
            'The feed-forward network',
            'Layer normalisation',
            'Self-attention — it is the only one; everything else acts on each position independently',
            'The residual connection'
          ],
          answer: 2,
          explanation:
            'Attention alone communicates across positions. The feed-forward network, normalisation and residuals all operate position by position, which is why the block reads as "mix, then process".',
          hints: ['Which part takes inputs from more than one position?']
        },
        {
          id: 'u10l3q3',
          kind: 'choice',
          concept: 'encoder-decoder',
          prompt: 'A model is built only to produce embeddings for semantic search. Which architecture fits, and why?',
          difficulty: 'advanced',
          options: [
            'Decoder only with causal masking, because that is standard',
            'Encoder only with no masking — the whole input is available, and there is nothing to generate, so every position should see everything',
            'Encoder-decoder, because search involves two sequences',
            'It makes no difference'
          ],
          answer: 1,
          explanation:
            'Masking exists to stop a generative model seeing its own answer. Nothing is being generated here, so masking only removes information. Encoder-only, unmasked, is the right shape for producing a representation of a complete input.',
          hints: ['What is masking for, and does that reason apply here?']
        }
      ]
    }
  ]
}
