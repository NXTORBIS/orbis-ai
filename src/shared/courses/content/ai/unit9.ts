import type { Module } from '../../types.ts'

/**
 * Unit 09 — Natural language processing.
 *
 * The route from counting words to embeddings to the limits of recurrence, which is the setup for attention. The
 * embeddings lesson is the most important in the unit: cosine similarity and the idea that meaning can live in
 * a direction are what the next three units are built on.
 *
 * The sequence-models lesson exists to make transformers comprehensible rather than magical. Attention answers
 * a specific problem, and that problem has to be felt before the answer means anything.
 */
export const AI_UNIT_9: Module = {
  id: 'u9',
  title: 'Natural Language Processing',
  summary:
    'Text as data, tokenisation, counting-based representations and their limits, embeddings and cosine similarity, and why recurrence ran out of road.',
  concepts: [
    'nlp',
    'tokenisation',
    'bag-of-words',
    'embeddings',
    'cosine-similarity',
    'contextual-embeddings',
    'sequences',
    'rnn',
    'lstm',
    'long-range'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u9l1',
      title: 'Tokenisation: what a model actually reads',
      intro:
        'Text has to become numbers, and the first step is cutting it into pieces. The choice of pieces explains several behaviours of language models that otherwise look inexplicable.',
      objectives: [
        'Explain why tokenisation is harder than splitting on spaces',
        'Describe subword tokenisation and what it solves',
        'Connect tokenisation to things language models are visibly bad at'
      ],
      concepts: ['nlp', 'tokenisation'],
      requires: ['features'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Tokenisation** is cutting text into the units a model will work with. It sounds mechanical. It is a design decision with consequences you can observe in any language model.'
        },
        { kind: 'heading', text: 'Why not just split on spaces?' },
        {
          kind: 'list',
          items: [
            'Punctuation. Is "don\'t" one token or two? Is the full stop part of the word?',
            'Vocabulary size. Every word form is separate: run, runs, running, ran. English alone needs hundreds of thousands of entries.',
            'Unknown words. A word that never appeared in training has no entry at all, and the model cannot represent it.',
            'Languages without spaces. Chinese and Japanese do not separate words this way, so the method does not even start.',
            'Rare words. Most words are rare, so most entries get almost no training signal.'
          ]
        },
        { kind: 'heading', text: 'Subword tokenisation' },
        {
          kind: 'text',
          text: 'The approach modern models use: build a vocabulary of common pieces, from single characters up to whole frequent words, and represent any text as a sequence of those pieces. Common words stay whole; rare ones break up.'
        },
        {
          kind: 'example',
          title: 'Roughly how it looks',
          text: '"the cat sat"           →  ["the", " cat", " sat"]              3 tokens\n"unbelievable"          →  ["un", "bel", "iev", "able"]         4 tokens\n"Orbis"                 →  ["Or", "bis"]                        2 tokens\n"1234567"               →  ["123", "45", "67"]                  arbitrary splits\n\nNote the leading spaces. In most schemes " cat" and "cat" are different tokens, which is one more thing the model has to learn.'
        },
        {
          kind: 'text',
          text: 'The vocabulary is built from data, usually by starting with characters and repeatedly merging the commonest adjacent pair until the vocabulary reaches a target size — 30,000 to 100,000 pieces is typical. Nothing is ever unrepresentable, because the worst case is a sequence of single characters.'
        },
        { kind: 'heading', text: 'Consequences you can observe' },
        {
          kind: 'table',
          headers: ['Behaviour', 'Why tokenisation causes it'],
          rows: [
            ['Bad at counting letters in a word', 'The model sees ["straw", "berry"], not individual letters — it never had the letters'],
            ['Bad at reversing strings', 'Same reason: the pieces are not characters'],
            ['Inconsistent arithmetic', 'Numbers split arbitrarily; "1234" may be one token or three, and the digits do not line up by place value'],
            ['Some languages cost more', 'A language under-represented in the vocabulary needs more tokens per sentence, so it uses more of the context window and costs more'],
            ['Rhyming and wordplay are uneven', 'Phonetic structure is not what tokens encode']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This is genuinely useful knowledge. When a language model miscounts the letters in a word, it is not being stupid about spelling — it never saw the spelling. Knowing that tells you to hand the task to code instead of arguing with the model about it.'
        },
        { kind: 'heading', text: 'The older preprocessing steps' },
        {
          kind: 'text',
          text: 'Before subwords, pipelines did more: **stemming** chopped endings off ("running" → "run", crudely), **lemmatisation** mapped words to dictionary forms properly, and **stop-word removal** deleted common words like "the" and "of". These are still useful for counting-based methods, and they are nearly always wrong for a modern language model — "not" is a stop word on most lists, and removing it reverses the meaning of a sentence.'
        },
        { kind: 'check', questionId: 'u9l1q1' },
        { kind: 'check', questionId: 'u9l1q2' }
      ],
      questions: [
        {
          id: 'u9l1q1',
          kind: 'choice',
          concept: 'tokenisation',
          prompt: 'Why do language models struggle to count the letters in a word?',
          difficulty: 'intermediate',
          options: [
            'They cannot count at all',
            'They see subword tokens rather than individual characters, so the letters were never in the input',
            'Counting requires a special module',
            'They were not trained on spelling'
          ],
          answer: 1,
          explanation:
            'The model receives token ids. A word arriving as two pieces carries no information about its individual letters, so the question is being asked about something the model cannot see.',
          hints: ['What exactly reaches the model when you type a word?']
        },
        {
          id: 'u9l1q2',
          kind: 'choice',
          concept: 'tokenisation',
          prompt: 'What problem does subword tokenisation solve that word-level tokenisation does not?',
          difficulty: 'intermediate',
          options: [
            'It makes text shorter',
            'Nothing is unrepresentable — unknown and rare words break into known pieces instead of falling outside the vocabulary',
            'It removes the need for embeddings',
            'It makes all languages cost the same'
          ],
          answer: 1,
          explanation:
            'No out-of-vocabulary words, with a vocabulary of manageable size. It does not make text shorter — it often makes it longer in tokens — and languages still cost very different amounts.',
          hints: ['What happens to a word the model has never seen under each scheme?']
        },
        {
          id: 'u9l1q3',
          kind: 'true-false',
          concept: 'nlp',
          prompt: 'Removing stop words is good practice before feeding text to a language model.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Stop-word removal belongs to counting-based methods. For a language model the small words carry grammar and negation — "not" is on most stop lists, and deleting it inverts the meaning.',
          hints: ['What does "not" do to a sentence, and is it on the list?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u9l2',
      title: 'Counting words, and why it is not enough',
      intro:
        'Bag of words and TF-IDF: genuinely useful, often the right tool, and a clear demonstration of the thing representation has to fix.',
      objectives: [
        'Build a bag-of-words vector and say what it discards',
        'Explain what TF-IDF weights and why',
        'Say precisely what these representations cannot express'
      ],
      concepts: ['bag-of-words'],
      requires: ['tokenisation', 'vectors'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Bag of words**: one column per vocabulary word, each holding how often that word appears in this document. The name is honest — the words go in a bag and the order is lost.'
        },
        {
          kind: 'example',
          title: 'Two documents, one vocabulary',
          text: 'Vocabulary: [the, cat, dog, sat, chased]\n\n"the cat sat"        →  [1, 1, 0, 1, 0]\n"the dog chased the cat"  →  [2, 1, 1, 0, 1]\n\nAnd now the problem:\n\n"the dog chased the cat"  →  [2, 1, 1, 0, 1]\n"the cat chased the dog"  →  [2, 1, 1, 0, 1]\n\nIdentical vectors. Opposite meanings.'
        },
        { kind: 'heading', text: 'TF-IDF' },
        {
          kind: 'text',
          text: 'Raw counts over-weight common words: "the" appears everywhere and distinguishes nothing. **TF-IDF** multiplies how often a word appears in this document by how rare it is across the collection, so words that are frequent here and rare elsewhere score highest — which is a reasonable definition of "what this document is about".'
        },
        { kind: 'formula', latex: '\\text{tf-idf}(t, d) = \\text{tf}(t, d) \\times \\log\\frac{N}{\\text{df}(t)}', caption: 'tf is the count of term t in document d; N is the number of documents; df is how many documents contain t. A term in every document has df = N, so the logarithm is zero and the term contributes nothing.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'TF-IDF is thirty years old, takes milliseconds, needs no training and is still a strong baseline for document search and topic classification. Reaching for a language model before trying it is a common and expensive habit.'
        },
        { kind: 'heading', text: 'What these representations cannot do' },
        {
          kind: 'list',
          items: [
            '**Word order.** The two sentences above are indistinguishable.',
            '**Synonyms.** "car" and "automobile" are different columns with nothing connecting them, so a search for one misses the other.',
            '**Negation.** "good" and "not good" share the word "good" and are close together.',
            '**Context.** "bank" by a river and "bank" with a cashpoint are the same column.',
            '**Sparsity.** A 50,000-word vocabulary gives a 50,000-long vector with perhaps forty non-zero entries.'
          ]
        },
        {
          kind: 'text',
          text: 'Every one of those is a statement that the representation has no notion of *meaning* — only of which strings occurred. Fixing it is what the next lesson is about, and it is one of the genuinely beautiful ideas in the field.'
        },
        {
          kind: 'lab',
          appId: 'data-explorer',
          title: 'Count words, and look at the top of the list',
          does:
            'Build word counts for a set of documents and look at the most frequent terms. Then weight them by rarity and look again — the second list is about the documents, and the first is about English.',
          optional: true
        },
        { kind: 'check', questionId: 'u9l2q1' },
        { kind: 'check', questionId: 'u9l2q2' }
      ],
      questions: [
        {
          id: 'u9l2q1',
          kind: 'choice',
          concept: 'bag-of-words',
          prompt: 'Why do "the dog chased the cat" and "the cat chased the dog" get identical bag-of-words vectors?',
          difficulty: 'beginner',
          options: [
            'Because the sentences mean the same thing',
            'Because the representation records which words occurred and how often, and discards their order entirely',
            'Because the vocabulary is too small',
            'Because "chased" is a stop word'
          ],
          answer: 1,
          explanation:
            'Same words, same counts, no order. The two sentences have opposite meanings and the representation cannot tell them apart — which is the clearest possible demonstration of what is missing.',
          hints: ['What is in the bag, and what is not?']
        },
        {
          id: 'u9l2q2',
          kind: 'choice',
          concept: 'bag-of-words',
          prompt: 'What does the IDF part of TF-IDF accomplish?',
          difficulty: 'intermediate',
          options: [
            'It counts how often a word appears in the document',
            'It down-weights words that appear in many documents, so words that distinguish this document score highest',
            'It removes punctuation',
            'It normalises document length'
          ],
          answer: 1,
          explanation:
            'Inverse document frequency weights by rarity across the collection. A word in every document contributes nothing; a word frequent here and rare elsewhere contributes most.',
          hints: ['Which half of the name refers to the collection rather than the document?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u9l3',
      title: 'Embeddings and cosine similarity',
      intro:
        'The idea that meaning can live in a direction. This is the lesson the rest of the course leans on hardest — embeddings are how retrieval, search and every modern language model represent text.',
      objectives: [
        'Explain what an embedding is and where its structure comes from',
        'Compute cosine similarity and say why it is preferred over distance',
        'Explain contextual embeddings and what they fixed'
      ],
      concepts: ['embeddings', 'cosine-similarity', 'contextual-embeddings'],
      requires: ['tokenisation', 'vectors', 'dot-product'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'An **embedding** is a dense vector of a few hundred numbers representing a token, a sentence or a document — learned from data, with the property that similar meanings end up near each other.'
        },
        {
          kind: 'table',
          headers: ['', 'One-hot', 'Embedding'],
          rows: [
            ['Length', '50,000', '300–1,500'],
            ['Contents', 'A single 1, the rest zeros', 'Hundreds of real numbers'],
            ['Where it comes from', 'The vocabulary order', 'Learned from how words are used'],
            ['"cat" and "dog"', 'Exactly as far apart as any two words', 'Close together'],
            ['Interpretable dimensions', 'Yes — one per word', 'No — the dimensions mean nothing on their own']
          ]
        },
        { kind: 'heading', text: 'Where the structure comes from' },
        {
          kind: 'text',
          text: 'From one observation: words used in similar contexts tend to mean similar things. Train a model to predict a word from its neighbours (or neighbours from a word) and the vectors it needs in order to do that well end up grouping by meaning. Nobody labels "cat" as an animal; the arrangement falls out of the prediction task.'
        },
        {
          kind: 'example',
          title: 'The structure that emerges',
          text: 'Nearest neighbours of "king":  queen, prince, monarch, emperor, throne\n\nAnd the famous arithmetic:\n\n  king − man + woman  ≈  queen\n  Paris − France + Italy  ≈  Rome\n\nDirections in the space correspond to relationships — one direction is roughly "royal", another roughly "capital city of". Nobody designed those directions. They are a consequence of how the words are used.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The same mechanism absorbs the biases in the text. Analogies of the form "man is to doctor as woman is to nurse" have been reproduced in published embedding models, because the training text used the words that way. The embedding is a faithful summary of its corpus, including the parts nobody would endorse — which is why Unit 13 treats this as a measurable property rather than an accident.'
        },
        { kind: 'heading', text: 'Cosine similarity' },
        {
          kind: 'text',
          text: 'To compare two embeddings, compare their **direction** rather than their distance. Cosine similarity is the dot product divided by both lengths, which is the cosine of the angle between them.'
        },
        { kind: 'formula', latex: '\\cos(\\mathbf{a}, \\mathbf{b}) = \\frac{\\mathbf{a} \\cdot \\mathbf{b}}{\\|\\mathbf{a}\\| \\, \\|\\mathbf{b}\\|}', caption: '1 means the same direction, 0 means perpendicular (unrelated), −1 means opposite. The division by lengths is what makes it insensitive to magnitude.' },
        {
          kind: 'text',
          text: 'Why direction rather than distance: a long document and a short one about the same subject have embeddings pointing the same way with different magnitudes. Euclidean distance would call them dissimilar because one vector is longer; cosine similarity correctly says they are about the same thing.'
        },
        {
          kind: 'example',
          title: 'Computed',
          text: 'a = [1, 2]   b = [2, 4]\n\ndot product:  1(2) + 2(4) = 10\nlengths:      √5 ≈ 2.236,  √20 ≈ 4.472\n\ncosine = 10 / (2.236 × 4.472) = 10 / 10 = 1.0\n\nIdentical direction, different lengths — cosine says identical, Euclidean distance says 2.236 apart.'
        },
        { kind: 'heading', text: 'Contextual embeddings' },
        {
          kind: 'text',
          text: 'Early embeddings gave each word one fixed vector, which cannot work: "bank" has two unrelated meanings and one vector has to be a compromise between them. **Contextual** embeddings compute the vector *from the sentence*, so "bank" by the river and "bank" with the cashpoint get different vectors. This is what attention makes possible, and it is the direct bridge to Unit 10.'
        },
        { kind: 'heading', text: 'What embeddings are used for' },
        {
          kind: 'list',
          items: [
            '**Semantic search** — embed the query and the documents, return the nearest. Finds "car repair" when the document says "automobile servicing".',
            '**Retrieval for grounding** — the first half of RAG in Unit 12.',
            '**Clustering and deduplication** — near-identical texts have near-identical vectors.',
            '**Classification** — embed the text and fit a simple classifier on top, which often beats far more elaborate approaches.',
            '**Recommendation** — items described by embeddings, nearness as similarity.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Two limitations worth carrying forward. Nearness is similarity of *usage*, which is not always similarity of meaning — antonyms appear in the same contexts and so embed close together. And embeddings from different models are not comparable at all: you cannot search a store built with one model using vectors from another.'
        },
        {
          kind: 'lab',
          appId: 'algebra-lab',
          title: 'Cosine similarity by hand',
          does:
            'Compute the cosine similarity of a few pairs of vectors, including one pair that differ only in length. Then compute the Euclidean distance for the same pairs and see where the two measures disagree.'
        },
        { kind: 'check', questionId: 'u9l3q1' },
        { kind: 'check', questionId: 'u9l3q2' },
        { kind: 'check', questionId: 'u9l3q3' }
      ],
      questions: [
        {
          id: 'u9l3q1',
          kind: 'choice',
          concept: 'cosine-similarity',
          prompt: 'Two embeddings have cosine similarity 0.95. What does that mean?',
          difficulty: 'intermediate',
          options: [
            'They are 95% identical as vectors',
            'They point in almost the same direction, so the texts are used in very similar ways',
            'They are 0.95 units apart',
            'One is 95% the length of the other'
          ],
          answer: 1,
          explanation:
            'Cosine similarity measures the angle. 0.95 is a small angle: nearly the same direction, which for embeddings means used in very similar contexts. Length is deliberately ignored.',
          hints: ['What does the cosine of an angle tell you?']
        },
        {
          id: 'u9l3q2',
          kind: 'choice',
          concept: 'embeddings',
          prompt: 'Where does the structure in an embedding space come from?',
          difficulty: 'advanced',
          options: [
            'From a dictionary of word meanings',
            'From training on a prediction task over real text — words used in similar contexts end up with similar vectors',
            'From manual annotation by linguists',
            'From the alphabetical order of the vocabulary'
          ],
          answer: 1,
          explanation:
            'It emerges from the prediction objective. The model needs vectors that make neighbouring words predictable, and the arrangement that achieves this groups words by how they are used — with no dictionary and no annotation involved.',
          hints: ['Nobody labelled any of it. So what produced the arrangement?']
        },
        {
          id: 'u9l3q3',
          kind: 'choice',
          concept: 'contextual-embeddings',
          prompt: 'What problem do contextual embeddings solve?',
          difficulty: 'advanced',
          options: [
            'They make vectors shorter',
            'A word with several meanings no longer needs one compromise vector — its vector is computed from the sentence it appears in',
            'They remove the need for tokenisation',
            'They eliminate bias'
          ],
          answer: 1,
          explanation:
            'One vector per word cannot serve "bank" in both senses. Contextual embeddings compute the representation from the surrounding text, so the two senses get different vectors. They do nothing about bias.',
          hints: ['Think of a word with two unrelated meanings.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u9l4',
      title: 'Sequences, recurrence, and why it ran out',
      intro:
        'Word order carries meaning, so something has to read in order. Recurrent networks did it, worked well, and hit two walls — which is exactly the setup attention was built for.',
      objectives: [
        'Explain how a recurrent network processes a sequence',
        'Explain the two problems that limited recurrence',
        'Say what LSTM gates fixed and what they did not'
      ],
      concepts: ['sequences', 'rnn', 'lstm', 'long-range'],
      requires: ['nlp', 'deep-learning'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **recurrent neural network** reads a sequence one element at a time, carrying a **hidden state** — a vector that is its memory of everything so far. At each step it combines the new input with the current state to produce a new state.'
        },
        {
          kind: 'example',
          title: 'Reading a sentence',
          text: 'h₀ = zeros\nh₁ = f(h₀, "the")\nh₂ = f(h₁, "cat")\nh₃ = f(h₂, "sat")\n\nThe same function f, with the same weights, at every step. h₃ is meant to be a summary of the whole sentence — and notice that "the" has to survive two passes through f to still be present in it.'
        },
        {
          kind: 'text',
          text: 'The weight sharing across time is the elegant part: one set of parameters handles a sequence of any length. Recurrent networks were the standard approach to language for years and worked genuinely well on translation, speech and tagging.'
        },
        { kind: 'heading', text: 'The first wall: long-range dependence' },
        {
          kind: 'example',
          title: 'The information is forty words away',
          text: '"The keys that I left on the kitchen table next to the pile of unopened post from last week **are** missing."\n\nThe verb must agree with "keys", not with "week" or "post". A recurrent network has to carry the plurality of "keys" through sixteen steps, each one mixing in new input, before it is needed.'
        },
        {
          kind: 'text',
          text: 'The hidden state is a fixed-size vector being overwritten at every step. Early information fades, and gradients travelling back through many steps vanish for exactly the reason in Unit 07 — repeated multiplication. **LSTM** and **GRU** cells were the answer: gates that learn what to keep, what to discard and what to let through, so a piece of information can survive many steps if the network decides it should.'
        },
        {
          kind: 'table',
          headers: ['Cell', 'Idea', 'Trade'],
          rows: [
            ['Simple RNN', 'One state, overwritten each step', 'Forgets fast; gradients vanish'],
            ['LSTM', 'A separate cell state plus input, forget and output gates', 'Carries information much further; three times the parameters'],
            ['GRU', 'Two gates, no separate cell state', 'Almost as capable, cheaper, simpler']
          ]
        },
        { kind: 'heading', text: 'The second wall, and the one that actually mattered' },
        {
          kind: 'text',
          text: 'Gates helped with memory. They did nothing about the other problem: a recurrent network is **sequential by construction**. Step 400 cannot be computed until step 399 is done. On hardware built to do thousands of things at once, that is close to the worst possible property — you cannot parallelise over the length of the sequence, so you cannot train on enormous corpora in reasonable time.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This is the sentence to remember going into Unit 10. Attention was not adopted only because it reads long-range relationships better — it was adopted because **every position can be computed at the same time**, which is what made training on internet-scale text feasible. The architectural change and the scaling that followed are the same story.'
        },
        {
          kind: 'text',
          text: 'Recurrence has not disappeared. It is still sensible for small models, for streaming data arriving one element at a time, and on hardware where memory is the constraint. But for large-scale language work it was replaced, and the next unit is the replacement.'
        },
        { kind: 'check', questionId: 'u9l4q1' },
        { kind: 'check', questionId: 'u9l4q2' }
      ],
      questions: [
        {
          id: 'u9l4q1',
          kind: 'choice',
          concept: 'long-range',
          prompt: 'What is the main reason transformers displaced recurrent networks for large-scale language work?',
          difficulty: 'advanced',
          options: [
            'Transformers have fewer parameters',
            'Attention lets every position be computed in parallel, while recurrence must go one step at a time — so transformers can be trained on far more data',
            'Recurrent networks cannot handle text',
            'Transformers need no training data'
          ],
          answer: 1,
          explanation:
            'Parallelism. LSTMs had largely addressed memory; what they could not address was being sequential by construction, which caps how much data you can train on. The long-range handling is a genuine benefit too, but the scaling is what changed the field.',
          hints: ['Which limitation could not be fixed by a better cell?']
        },
        {
          id: 'u9l4q2',
          kind: 'choice',
          concept: 'lstm',
          prompt: 'What do the gates in an LSTM do?',
          difficulty: 'advanced',
          options: [
            'Speed up training by skipping steps',
            'Learn what to keep, what to discard and what to pass on, so information can survive many steps instead of being overwritten each time',
            'Remove the need for a hidden state',
            'Allow parallel processing of the sequence'
          ],
          answer: 1,
          explanation:
            'Gates give the network control over its own memory, which is what lets a fact from twenty steps ago still be present. They do not make the computation parallel — the sequence is still processed in order.',
          hints: ['Which of the two walls do gates address?']
        },
        {
          id: 'u9l4q3',
          kind: 'short',
          concept: 'rnn',
          prompt: 'What is the hidden state of a recurrent network?',
          difficulty: 'intermediate',
          answer: 'a vector carrying what the network has read so far',
          accepts: ['its memory of the sequence so far', 'a summary of previous steps', 'the running state', 'memory of what came before'],
          explanation:
            'A fixed-size vector updated at every step: the network memory. Fixed size is the crux — a long sequence has to be compressed into the same number of values as a short one.',
          hints: ['It is what gets passed from one step to the next.']
        }
      ]
    }
  ]
}
