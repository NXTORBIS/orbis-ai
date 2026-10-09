import type { Module } from '../../types.ts'

/**
 * Unit 01 — What artificial intelligence is.
 *
 * The first unit of an AI course usually goes one of two ways: a list of definitions, or a list of products.
 * Neither leaves anybody able to think. This unit does something narrower and more useful — it establishes that
 * "AI" names a *collection of methods*, teaches the six words the rest of the course cannot do without, and
 * draws the line between a system being capable and a system understanding anything.
 *
 * The history lesson is here for one reason: symbolic AI failed in a specific way, and knowing how it failed is
 * what makes machine learning look like an answer to a question rather than a fashion.
 */
export const AI_UNIT_1: Module = {
  id: 'u1',
  title: 'What Artificial Intelligence Is',
  summary:
    'What the words mean, where the field came from, how AI, machine learning and deep learning fit inside one another, and what "learning from examples" actually involves.',
  concepts: [
    'ai-meaning',
    'narrow-ai',
    'ai-vocabulary',
    'ai-history',
    'symbolic-ai',
    'ai-ml-dl',
    'capability-vs-understanding',
    'learning-from-examples',
    'parameters',
    'loss',
    'optimisation',
    'generalisation'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u1l1',
      title: 'What people mean by artificial intelligence',
      intro:
        'Before anything technical: the phrase is used for a dozen different things, and knowing which one is meant is most of understanding any claim about AI.',
      objectives: [
        'Say what artificial intelligence names, and what it does not',
        'Give examples of AI systems that work in completely different ways',
        'Explain why "is this AI?" is usually the wrong question'
      ],
      concepts: ['ai-meaning', 'narrow-ai', 'capability-vs-understanding'],
      requires: [],
      minutes: 11,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Artificial intelligence is not a technology. It is a goal, and a loose collection of methods that have been aimed at that goal over seventy years. Some of those methods have nothing in common with each other beyond the ambition.'
        },
        {
          kind: 'text',
          text: 'That is why the question "is this AI?" rarely gets anywhere. A chess program that searches ahead through millions of positions, a spam filter that counts words, a navigation app finding a route, and a model that writes you a paragraph are all routinely called AI, and no two of them work alike. The useful question is always: what is this system actually doing?'
        },
        { kind: 'heading', text: 'Four systems, four completely different machines' },
        {
          kind: 'table',
          headers: ['System', 'What it really does', 'Does it learn from data?'],
          rows: [
            ['Route finding in a maps app', 'Searches a graph of roads for the shortest path, using travel times', 'No — the algorithm is fixed. Traffic data feeds it, but it does not learn a rule'],
            ['Spam filter', 'Scores a message from word patterns learned from millions of labelled emails', 'Yes'],
            ['Chess engine', 'Searches ahead, evaluating positions; modern ones also use a learned evaluation', 'Partly — search is hand-written, evaluation is often learned'],
            ['A model that writes text', 'Predicts the next piece of text, over and over, from patterns in an enormous corpus', 'Yes, and almost nothing else']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The route finder is the interesting one. It is often called AI, it is genuinely clever, and it contains no learning at all. Decades of AI research produced methods like it — search, logic, planning — and they are still the right tool for many jobs.'
        },
        { kind: 'heading', text: 'Narrow by construction' },
        {
          kind: 'text',
          text: 'Every AI system that exists does one kind of task. The spam filter cannot drive. A model that writes fluent prose cannot be trusted to add up a column of figures without being handed a calculator. This is usually called **narrow AI**, and the name is unhelpful: it sounds like a limitation that will be removed next year, when in fact every one of these systems was built for a task and shaped by the data for that task.'
        },
        {
          kind: 'text',
          text: '**Artificial general intelligence** means a system that could take on an unfamiliar task the way a person does — working out what is being asked, what it needs to know, and how to find out. Nothing of the kind exists. It is a research goal with no agreed definition and no agreed test, and you should treat any claim that a particular product has achieved it as a claim about marketing rather than about capability.'
        },
        { kind: 'heading', text: 'Where you have already met it today' },
        {
          kind: 'list',
          items: [
            '**Recommendation** — what to watch, what to buy, what to read next. Learned from what people like you did next.',
            '**Search ranking** — which ten results out of millions, from relevance signals and what people clicked.',
            '**Speech recognition** — sound into words, from a model trained on recorded speech and transcripts.',
            '**Image recognition** — faces in a photo album, a plant from a photograph, a tumour flagged for a radiologist to look at.',
            '**Fraud detection** — this transaction does not look like the rest of yours, learned from millions of transactions that turned out to be fraudulent.',
            '**Navigation** — mostly classical search, informed by live data.',
            '**Generation** — text, images, speech and code produced rather than retrieved.',
            '**Conversation** — a generative model wrapped in a system that keeps track of what was said.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Notice that medical AI appears in that list as "flagged for a radiologist to look at", not "diagnoses". That wording is not caution for its own sake — it describes how these systems are actually deployed, and the reason is the subject of Unit 13.'
        },
        { kind: 'check', questionId: 'u1l1q1' },
        { kind: 'check', questionId: 'u1l1q2' }
      ],
      questions: [
        {
          id: 'u1l1q1',
          kind: 'choice',
          concept: 'ai-meaning',
          prompt: 'A maps app finds the fastest route across a city. Which description is most accurate?',
          difficulty: 'beginner',
          options: [
            'It is machine learning: it learned the roads from data',
            'It is a classical search algorithm, which is one of the methods the field calls AI, and it does not learn a rule from examples',
            'It is not AI at all, because it does not use a neural network',
            'It is a large language model applied to maps'
          ],
          answer: 1,
          explanation:
            'Route finding searches a graph for a shortest path. It is a classical AI method, it is fed live data, and it learns nothing — the algorithm is written down by a person. "Does it use a neural network?" is not what decides whether something belongs to the field.',
          hints: ['Separate two questions: is the method from the AI tradition, and does it learn from examples?']
        },
        {
          id: 'u1l1q2',
          kind: 'multi',
          concept: 'narrow-ai',
          prompt: 'Which of these statements are accurate as the field stands today? Choose all that apply.',
          difficulty: 'beginner',
          options: [
            'Every deployed AI system is built for a particular kind of task',
            'A system that writes excellent prose can be assumed to reason reliably about arithmetic',
            'Artificial general intelligence has no agreed definition or test',
            'Narrow AI means the system is simple'
          ],
          answer: [0, 2],
          explanation:
            'Systems are built and shaped for tasks — that is the first statement. "General" intelligence has no agreed definition, which is why claims about it are so slippery. The second is false and the whole subject of Unit 11: fluency and reliability are different things. The fourth is false too: a narrow system can be enormous.',
          hints: ['Two of these are about scope, two are about assumptions you should not make.']
        },
        {
          id: 'u1l1q3',
          kind: 'short',
          concept: 'ai-meaning',
          prompt: 'In one sentence: why is "is this AI?" usually a less useful question than "what is this system doing?"',
          difficulty: 'beginner',
          answer: 'because AI names many different methods, so the label says nothing about how the system works',
          accepts: [
            'ai is many methods',
            'the label does not say how it works',
            'because ai is a collection of methods',
            'it tells you nothing about the method'
          ],
          explanation:
            'The label covers search, logic, statistics, neural networks and more. Two systems that both earn it may have nothing in common, so the label tells you almost nothing — what it does and what it learned from tells you everything.',
          hints: ['Think about how little the four systems in the table had in common.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u1l2',
      title: 'The six words the rest of this course needs',
      intro:
        'Model, algorithm, dataset, training, inference, prediction. Six words that get used loosely everywhere, and precisely here.',
      objectives: [
        'Use model, algorithm, dataset, training, inference and prediction correctly',
        'Say what is different about the two activities, training and inference',
        'Spot sentences where these words are being used to hide something'
      ],
      concepts: ['ai-vocabulary'],
      requires: ['ai-meaning'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'These six words carry the whole course. Each one has a precise meaning, and the sentences people get wrong about AI are almost always sentences where two of them have been swapped.' },
        { kind: 'heading', text: 'Algorithm' },
        {
          kind: 'text',
          text: 'A procedure: a sequence of steps. Sorting a list is an algorithm. Gradient descent is an algorithm. An algorithm is written by a person and does not change when you run it on different data.'
        },
        { kind: 'heading', text: 'Model' },
        {
          kind: 'text',
          text: 'A thing with adjustable numbers in it that turns an input into an output. The numbers are the **parameters**, and they are what training sets. Two models with the same structure and different parameters behave completely differently — so when somebody says "the model", they usually mean a specific set of numbers, not a shape.'
        },
        {
          kind: 'example',
          title: 'The smallest possible model',
          text: 'price = a × size + b\n\nThe structure is "a straight line". The parameters are a and b. Training is choosing a and b from examples of houses and what they sold for. Inference is putting a new size in and reading a price out.'
        },
        { kind: 'heading', text: 'Dataset' },
        {
          kind: 'text',
          text: 'A collection of examples. In the simplest case a table, where each row is one example and each column is one thing known about it. What is in the dataset decides everything the model can possibly learn — Unit 02 is entirely about this.'
        },
        { kind: 'heading', text: 'Training and inference' },
        {
          kind: 'text',
          text: '**Training** is the process of setting the parameters from the data. It is done once (or occasionally), it is expensive, and it needs the answers. **Inference** is using the trained model on a new input. It is done constantly, it is comparatively cheap, and it needs no answers — which is the point.'
        },
        {
          kind: 'table',
          headers: ['', 'Training', 'Inference'],
          rows: [
            ['How often', 'Rarely — once, or on a schedule', 'Every time somebody uses the system'],
            ['Needs labels?', 'Yes, for supervised learning', 'No'],
            ['Cost', 'Can be enormous', 'Small per request, large in total'],
            ['What changes', 'The parameters', 'Nothing — the model is fixed'],
            ['What goes wrong', 'It learns the wrong thing', 'It meets an input unlike anything it was trained on']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Nothing changes inside a model while you use it. A chat model that appears to "learn" during a conversation is reading the conversation as input — its parameters are identical before and after. That distinction matters enormously, and Unit 11 comes back to it.'
        },
        { kind: 'heading', text: 'Prediction' },
        {
          kind: 'text',
          text: 'Whatever the model outputs — a number, a class, a probability, a sentence, an image. The word does not imply the future and does not imply correctness. "Prediction" is simply the model answer.'
        },
        { kind: 'heading', text: 'Sentences that hide something' },
        {
          kind: 'list',
          items: [
            '"The algorithm decided to reject the application." — An algorithm does not decide; a model with particular parameters produced an output, and somebody chose to act on it automatically.',
            '"We trained it on your data." — Training sets parameters from the data. Worth asking: which data, with whose agreement, and is it in the parameters now?',
            '"The AI learns from every conversation." — Almost always false as stated. The conversation is input. Learning means training, and training is a deliberate, separate, expensive act.',
            '"It is 95% accurate." — On what dataset? Measured how? Unit 04 exists because this sentence is nearly meaningless on its own.'
          ]
        },
        { kind: 'check', questionId: 'u1l2q1' },
        { kind: 'check', questionId: 'u1l2q2' },
        { kind: 'check', questionId: 'u1l2q3' }
      ],
      questions: [
        {
          id: 'u1l2q1',
          kind: 'order',
          concept: 'ai-vocabulary',
          prompt: 'Put these in the order that describes building and using a model: inference, dataset, training, prediction.',
          difficulty: 'beginner',
          options: ['dataset', 'training', 'inference', 'prediction'],
          answer: [0, 1, 2, 3],
          explanation:
            'You gather a dataset, train on it to set the parameters, then run inference on a new input, which gives you a prediction. Getting this order the wrong way round is how people end up believing a model learns while being used.',
          hints: ['Which of these has to exist before any of the others can happen?']
        },
        {
          id: 'u1l2q2',
          kind: 'true-false',
          concept: 'ai-vocabulary',
          prompt: 'A model parameters change while somebody is using it for inference.',
          difficulty: 'beginner',
          answer: false,
          explanation:
            'The parameters are fixed during inference. The model sees a different input and therefore produces a different output, which can look like learning — but nothing inside it changed. Changing parameters is training, and training is separate.',
          hints: ['What exactly does training change, and when does it happen?']
        },
        {
          id: 'u1l2q3',
          kind: 'choice',
          concept: 'ai-vocabulary',
          prompt: 'Somebody says: "The algorithm learned that applicants from this postcode are higher risk." What is wrong with the sentence?',
          difficulty: 'intermediate',
          options: [
            'Nothing — that is exactly what happens',
            'Algorithms do not learn; a model fitted to a dataset acquired that association, and the association came from the data somebody chose',
            'Models cannot use postcodes',
            'It should say "the AI" rather than "the algorithm"'
          ],
          answer: 1,
          explanation:
            'The algorithm is the fixed training procedure. What acquired the association is the model, from the dataset — so the question is what was in that data and who decided it should be. Saying "the algorithm learned" puts the responsibility somewhere it cannot sit.',
          hints: ['Which of the six words is being used to stand in for another?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u1l3',
      title: 'How the field got here, and why it matters',
      intro:
        'Seventy years in one lesson — not for the dates, but because the first approach failed in a specific way, and that failure is exactly what machine learning answers.',
      objectives: [
        'Describe what symbolic AI was and what it was good at',
        'Explain the specific reason rule-based systems stopped scaling',
        'Say what changed to make deep learning work when it had not before'
      ],
      concepts: ['ai-history', 'symbolic-ai'],
      requires: ['ai-meaning'],
      minutes: 13,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The field began with a confident idea: intelligence is reasoning, reasoning is manipulating symbols according to rules, and a computer manipulates symbols — so write the rules down. The 1956 Dartmouth workshop that named the field was organised on roughly that premise, with an expectation of substantial progress over a summer.'
        },
        { kind: 'heading', text: 'Symbolic AI, and what it really achieved' },
        {
          kind: 'text',
          text: 'The approach was not a failure. It produced search algorithms still in everyday use, automated theorem proving, planners, constraint solvers, and **expert systems** — programs holding hundreds or thousands of hand-written rules elicited from specialists. Some worked well enough to be deployed commercially in medicine, geology and configuration.'
        },
        {
          kind: 'example',
          title: 'An expert-system rule',
          text: 'IF the stain is gram-positive\nAND the morphology is coccus\nAND the growth is in chains\nTHEN the organism may be streptococcus (confidence 0.7)\n\nA person wrote that. And the one after it. And the eight hundred after that.'
        },
        { kind: 'heading', text: 'Where it broke' },
        {
          kind: 'text',
          text: 'It broke on tasks where nobody can write the rule down — not because they are stupid, but because the knowledge is not available to introspection. Describe, in rules over pixel values, how to tell a cat from a dog. You recognise cats instantly and you cannot say how. Every attempt produces rules that are wrong on an enormous number of real photographs.'
        },
        {
          kind: 'list',
          items: [
            '**Knowledge acquisition** — the rules had to come out of experts, slowly, at great expense.',
            '**Brittleness** — one case outside the rules and the system had nothing to say, or said something absurd.',
            '**Exceptions all the way down** — birds fly; penguins do not; a bird with a broken wing does not; a bird in a sealed box does not. The exceptions never stop.',
            '**Perception** — vision and speech resisted every rule anybody wrote.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is the hinge of the whole course. When you cannot write the rule, you can sometimes still collect thousands of examples of the right answer. Machine learning is the trade: give up writing the rule, and get a rule fitted from examples instead.'
        },
        { kind: 'heading', text: 'The statistical turn' },
        {
          kind: 'text',
          text: 'From the late 1980s the centre of gravity moved to methods that fit models to data: decision trees, nearest neighbours, support vector machines, probabilistic models. These worked, they degraded gracefully on unusual input, and they improved as more data arrived. The cost was interpretability — a fitted model does not explain itself the way a rule does.'
        },
        { kind: 'heading', text: 'Why neural networks arrived three times' },
        {
          kind: 'text',
          text: 'Neural networks were proposed in the 1940s, dismissed, revived in the 1980s with backpropagation, and faded again. They were not wrong; they were starved. The third arrival, from around 2012, needed three things to be true at once:'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Data** — millions of labelled examples, which the internet made collectible for the first time.',
            '**Computation** — graphics processors turned out to be extremely good at exactly the matrix arithmetic a neural network needs, at a fraction of the cost of general-purpose hardware.',
            '**A handful of technical fixes** — better activation functions, better initialisation, normalisation and regularisation, which together made networks of many layers actually trainable.'
          ]
        },
        {
          kind: 'text',
          text: 'What depth bought was **representation learning**: instead of a person designing the features, the network works out its own, in layers, each built on the one below. That is the single idea that makes modern AI different in kind, and Unit 07 is about it.'
        },
        { kind: 'heading', text: 'And then scale' },
        {
          kind: 'text',
          text: 'The most recent shift is from task-specific models to very large models pretrained on broad data and then adapted to many tasks — often called foundation models. One model, many jobs. Units 10 and 11 take this apart. The honest summary of the history is that each era solved the previous era problem and acquired a new one, and we are living in the new one: systems that are capable, general-purpose and genuinely difficult to evaluate.'
        },
        {
          kind: 'lab',
          appId: 'explain-it-yourself',
          title: 'Explain the failure in your own words',
          does:
            'Explain why rule-based AI could not solve image recognition, as if to somebody who has never met the idea. The laboratory will press you where the explanation is thin — which is the fastest way to find out whether you actually have it.',
          optional: true
        },
        { kind: 'check', questionId: 'u1l3q1' },
        { kind: 'check', questionId: 'u1l3q2' }
      ],
      questions: [
        {
          id: 'u1l3q1',
          kind: 'choice',
          concept: 'symbolic-ai',
          prompt: 'What is the fundamental reason hand-written rules could not solve image recognition?',
          difficulty: 'beginner',
          options: [
            'Computers of the time were too slow to run the rules',
            'Nobody can state the rule — people recognise objects without having access to how they do it',
            'There was no way to get images into a computer',
            'Rules can only handle numbers, not pictures'
          ],
          answer: 1,
          explanation:
            'The knowledge is not available to introspection. You recognise a cat instantly and cannot say what rule you applied, so you cannot write it down — and every rule anybody did write was wrong on vast numbers of real photographs. Speed was not the obstacle.',
          hints: ['Try to state the rule yourself, over pixel values, and see where you get stuck.']
        },
        {
          id: 'u1l3q2',
          kind: 'multi',
          concept: 'ai-history',
          prompt: 'Which of these had to come together for deep learning to work when earlier attempts had not? Choose all that apply.',
          difficulty: 'intermediate',
          options: [
            'Very large labelled datasets',
            'Hardware that made the required matrix arithmetic cheap',
            'A fundamentally new mathematical theory of intelligence',
            'Technical fixes that made many-layer networks trainable'
          ],
          answer: [0, 1, 3],
          explanation:
            'Data, computation and a set of practical fixes — activation functions, initialisation, normalisation, regularisation. There was no new theory of intelligence; the core idea of a trained multi-layer network dates from the 1980s and was waiting for the other three.',
          hints: ['One of these is the thing that notably did not happen.']
        },
        {
          id: 'u1l3q3',
          kind: 'short',
          concept: 'symbolic-ai',
          prompt: 'In one sentence: what is the trade machine learning makes compared with writing rules?',
          difficulty: 'intermediate',
          answer: 'you give up writing the rule yourself and get one fitted from examples instead',
          accepts: [
            'learn the rule from examples instead of writing it',
            'examples instead of rules',
            'give up writing rules, fit from data',
            'trade explicit rules for learned ones'
          ],
          explanation:
            'You stop needing to state the rule, which is what made perception impossible. You give up a rule anybody can read, which is what makes evaluation and fairness hard. Both halves of the trade matter.',
          hints: ['What do you gain, and what do you hand over?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u1l4',
      title: 'AI, machine learning and deep learning',
      intro:
        'Three terms, three different sizes, used interchangeably by almost everybody. Getting them straight takes ten minutes and saves the rest of the course.',
      objectives: [
        'Place AI, machine learning, deep learning and generative AI inside one another correctly',
        'Classify a described system into the right category and defend it',
        'Explain why plenty of real AI uses no machine learning at all'
      ],
      concepts: ['ai-ml-dl'],
      requires: ['ai-meaning', 'symbolic-ai'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The relationship is nested, and the nesting is the whole lesson.'
        },
        {
          kind: 'example',
          title: 'The nesting',
          text: 'Artificial intelligence\n  └── Machine learning  (the systems that learn from data)\n        └── Deep learning  (machine learning with many-layer neural networks)\n              └── Most of what people now call generative AI\n\nOutside machine learning, still inside AI: search, planning, constraint solving, logical inference, expert systems.'
        },
        { kind: 'heading', text: 'Artificial intelligence' },
        {
          kind: 'text',
          text: 'The whole field: any method aimed at getting a machine to do something that seems to require intelligence. Search algorithms count. Rule systems count. This is the loosest of the three terms and the one that tells you least.'
        },
        { kind: 'heading', text: 'Machine learning' },
        {
          kind: 'text',
          text: 'The subset where the behaviour is **fitted to data** rather than written down. Nobody states the rule; a procedure sets the parameters of a model from examples. A decision tree, a linear regression and a 400-billion-parameter transformer are all machine learning, and the first two are not deep learning.'
        },
        { kind: 'heading', text: 'Deep learning' },
        {
          kind: 'text',
          text: 'Machine learning using neural networks with many layers. The depth is not decoration: each layer builds a representation on top of the one below, so the network learns its own features instead of being handed features somebody designed. That is why deep learning took over perception and language, where designing features by hand had always been the bottleneck.'
        },
        { kind: 'heading', text: 'Generative AI' },
        {
          kind: 'text',
          text: 'Not a layer in the nesting — a description of what the output *is*. A generative model produces new data of the kind it was trained on: text, images, audio, code. Today these are almost always deep learning, but the idea is older and simpler statistical generative models exist. A system that outputs "spam" or "not spam" is not generative no matter how large it is.'
        },
        {
          kind: 'table',
          headers: ['System', 'Category', 'Why'],
          rows: [
            ['Chess engine with hand-written evaluation', 'AI, not ML', 'Search plus a rule somebody wrote'],
            ['Tax rules engine that decides eligibility', 'AI (symbolic), not ML', 'Rules all the way down, no fitting'],
            ['Spam filter counting word frequencies', 'ML, not deep learning', 'Fitted to labelled email; no neural network needed'],
            ['Credit model built from a decision tree', 'ML, not deep learning', 'Fitted to data, shallow by construction'],
            ['Photo app finding faces', 'Deep learning', 'Convolutional network over pixels'],
            ['Speech to text', 'Deep learning', 'Neural network over audio'],
            ['A model that writes a paragraph', 'Deep learning, and generative', 'Produces new text of the kind it was trained on'],
            ['An image generator', 'Deep learning, and generative', 'Produces new images']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Two questions settle almost every case. One: was the behaviour fitted from examples, or written by a person? That decides ML. Two: if it was fitted, is the model a many-layer neural network? That decides deep learning.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Simpler is often correct. A decision tree you can read, that runs in microseconds and can be explained to a regulator, beats a neural network on a tabular problem far more often than the industry admits. "Use deep learning" is not a default; it is a decision with costs.'
        },
        { kind: 'check', questionId: 'u1l4q1' },
        { kind: 'check', questionId: 'u1l4q2' },
        { kind: 'check', questionId: 'u1l4q3' }
      ],
      questions: [
        {
          id: 'u1l4q1',
          kind: 'choice',
          concept: 'ai-ml-dl',
          prompt: 'A company builds an eligibility checker from 2,000 rules written by its policy team. How should it be classified?',
          difficulty: 'beginner',
          options: [
            'Deep learning, because it is complicated',
            'Machine learning, because it processes data',
            'AI but not machine learning — the behaviour was written down, not fitted from examples',
            'Not AI at all, because it uses rules'
          ],
          answer: 2,
          explanation:
            'Rules written by people put it in the symbolic tradition: AI, not machine learning. Processing data is not learning from data — the test is whether examples set the behaviour.',
          hints: ['Ask the first of the two settling questions.']
        },
        {
          id: 'u1l4q2',
          kind: 'multi',
          concept: 'ai-ml-dl',
          prompt: 'Which of these are machine learning but not deep learning? Choose all that apply.',
          difficulty: 'intermediate',
          options: [
            'A decision tree predicting customer churn',
            'A convolutional network classifying X-rays',
            'A linear regression predicting house prices',
            'A word-frequency spam filter fitted to labelled email'
          ],
          answer: [0, 2, 3],
          explanation:
            'All four are fitted from data, so all four are machine learning. Only the convolutional network is a many-layer neural network, so only it is deep learning. Three of the four are perfectly good engineering.',
          hints: ['Everything here is ML. The question is which ones are neural networks with depth.']
        },
        {
          id: 'u1l4q3',
          kind: 'true-false',
          concept: 'ai-ml-dl',
          prompt: 'Every generative AI system is a deep-learning system.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Almost all the ones people use are, but "generative" describes the output, not the method. Simple statistical models that generate text — Markov chains over words, for instance — are generative and are not deep learning.',
          hints: ['Is "generative" a statement about the architecture or about what comes out?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'u1l5',
      title: 'What "learning" actually involves',
      intro:
        'The mechanism, with no neural networks in sight: parameters, a loss, and a procedure for making the loss smaller. Everything in the next twelve units is a variation on this lesson.',
      objectives: [
        'Describe learning as adjusting parameters to reduce a loss',
        'Explain what a loss function is and why one number is needed',
        'Explain why lower training loss does not mean a better model'
      ],
      concepts: ['learning-from-examples', 'parameters', 'loss', 'optimisation', 'generalisation'],
      requires: ['ai-vocabulary'],
      minutes: 15,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Here is the entire mechanism of supervised learning. It is worth reading slowly, because everything else in this course is a variation on it — including the models with hundreds of billions of parameters.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Choose a **shape** of model with adjustable numbers in it.',
            'Show it an example and let it produce an answer.',
            'Compare that answer with the known right answer. The gap is the **error**.',
            'Add the errors over many examples into one number: the **loss**.',
            'Nudge the parameters in the direction that makes the loss smaller.',
            'Repeat, thousands or millions of times.'
          ]
        },
        { kind: 'heading', text: 'Worked through on the smallest possible model' },
        {
          kind: 'text',
          text: 'Predict a house price from its floor area. The shape is a straight line: `price = a × area + b`. Two parameters, a and b. Suppose we start with a = 1 and b = 0 — a guess of one currency unit per square metre, which will be badly wrong.'
        },
        {
          kind: 'table',
          headers: ['Area', 'Real price', 'Model says (a=1, b=0)', 'Error', 'Error squared'],
          rows: [
            ['50', '150', '50', '-100', '10,000'],
            ['80', '240', '80', '-160', '25,600'],
            ['120', '330', '120', '-210', '44,100'],
            ['', '', '', '', 'mean = 26,567']
          ]
        },
        {
          kind: 'text',
          text: 'That last figure is the loss: **mean squared error**. One number for the whole dataset. Now raise a to 2 and recompute — the loss falls. Raise it to 3 and it falls further. Push on to 4 and it starts rising again. Somewhere around 2.8 is the bottom, and finding that bottom is what training does.'
        },
        { kind: 'heading', text: 'Why squared?' },
        {
          kind: 'text',
          text: 'Two reasons, both practical. Squaring removes the sign, so being 100 over and 100 under do not cancel out to zero error. And it punishes large errors disproportionately: one prediction out by 200 contributes more than four out by 50 each. Whether you want that is a real decision — Unit 03 compares it against the alternative.'
        },
        { kind: 'formula', latex: 'L(a, b) = \\frac{1}{n}\\sum_{i=1}^{n}\\big(y_i - (a x_i + b)\\big)^2', caption: 'Mean squared error. x is the input, y the real answer, a and b the parameters, n the number of examples. The sum runs over the dataset; dividing by n keeps the loss comparable between datasets of different sizes.' },
        { kind: 'heading', text: 'Optimisation, without the mathematics yet' },
        {
          kind: 'text',
          text: 'With two parameters you could search by hand. With two hundred million you cannot, and the procedure that scales is to work out, for each parameter, *which direction* reduces the loss and by how steeply — then step that way. That slope is a **gradient**, the procedure is **gradient descent**, and Unit 06 builds it properly. For now: learning is downhill walking on a landscape whose height is the loss.'
        },
        {
          kind: 'lab',
          appId: 'curve-fitter',
          title: 'Fit a line, and watch the loss',
          does:
            'Put a handful of points on the plot, then move the line by hand and watch the error change. Find the smallest error you can by eye, then let the laboratory fit it and compare. Do this before the next section — it makes the point better than the next section does.'
        },
        { kind: 'heading', text: 'The trap at the centre of the whole field' },
        {
          kind: 'text',
          text: 'Training minimises loss **on the training examples**. That is the only thing it can measure. But nobody wants a model that is right about the houses already sold — they want one that is right about the next house.'
        },
        {
          kind: 'text',
          text: 'And those two goals come apart. Give a model enough parameters and it can pass exactly through every training point, reaching a training loss of zero while being wildly wrong everywhere in between. It has learned the examples instead of the pattern in them.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Zero training error is not a triumph. It is the single most common sign that something has gone wrong. This is **overfitting**, and the only defence is to measure on data the model has never seen — which is why the next unit splits every dataset in three before anything else happens.'
        },
        {
          kind: 'text',
          text: 'The real goal is **generalisation**: being right about unseen examples. Hold that distinction firmly, because almost every mistake in applied machine learning is a version of forgetting it.'
        },
        { kind: 'check', questionId: 'u1l5q1' },
        { kind: 'check', questionId: 'u1l5q2' },
        { kind: 'check', questionId: 'u1l5q3' }
      ],
      questions: [
        {
          id: 'u1l5q1',
          kind: 'choice',
          concept: 'loss',
          prompt: 'Why does a loss function have to collapse all the errors into a single number?',
          difficulty: 'beginner',
          options: [
            'To make the result easier for people to read',
            'Because optimisation needs one quantity to make smaller — with two or more, there is no single direction to move in',
            'Because computers cannot store many errors at once',
            'So the errors can be shown on a graph'
          ],
          answer: 1,
          explanation:
            'Optimisation means improving one quantity. Given a list of errors there is no definition of "better", because an adjustment that helps one example may hurt another. One number creates an ordering, and an ordering is what you can walk downhill on.',
          hints: ['What would "make this smaller" mean if you were handed a thousand separate errors?']
        },
        {
          id: 'u1l5q2',
          kind: 'number',
          concept: 'loss',
          prompt:
            'A model predicts 10, 20 and 30. The real values are 12, 18 and 35. What is the mean squared error?',
          difficulty: 'intermediate',
          answer: 11,
          tolerance: 0.01,
          explanation:
            'The errors are -2, +2 and -5. Squared: 4, 4, 25. Their sum is 33, and 33 ÷ 3 = 11. Note that without squaring, -2 and +2 would cancel and a genuinely wrong model would look partly right.',
          hints: ['Three steps: each error, each one squared, then the mean of those.', 'Keep the signs while subtracting; they disappear when you square.']
        },
        {
          id: 'u1l5q3',
          kind: 'choice',
          concept: 'generalisation',
          prompt:
            'Model A has a training loss of 0.001. Model B has a training loss of 0.04. Which is the better model?',
          difficulty: 'intermediate',
          options: [
            'A, because its loss is far lower',
            'B, because higher loss is always safer',
            'There is not enough information — training loss says nothing about unseen examples, and A near-zero loss is a warning sign rather than a recommendation',
            'They are equally good because both losses are small'
          ],
          answer: 2,
          explanation:
            'Training loss measures memory of the training set. A loss that close to zero suggests A may have fitted the examples themselves rather than the pattern. The only way to tell is a measurement on data neither model has seen — which the next unit sets up.',
          hints: ['What question does a training loss actually answer?']
        }
      ]
    }
  ]
}
