import type { Module } from '../../types.ts'

/**
 * Unit 11 — Large language models.
 *
 * Everything in this unit follows from one objective: predict the next token. Pretraining, sampling,
 * in-context learning, hallucination and grounding are all consequences of that single training signal, and
 * teaching them as a list of features rather than as consequences is why so many people hold a magical model
 * of what these systems are.
 *
 * The hallucination lesson is the most important in the course for anybody who will actually build with these
 * models, because it explains the behaviour mechanically rather than treating it as a bug awaiting a fix.
 */
export const AI_UNIT_11: Module = {
  id: 'u11',
  title: 'Large Language Models',
  summary:
    'Next-token prediction, context windows, how sampling settings change behaviour, pretraining and fine-tuning, in-context learning, and why fluent confident wrongness is a property of the objective rather than a defect.',
  concepts: [
    'llm',
    'next-token',
    'context-window',
    'sampling',
    'pretraining',
    'fine-tuning',
    'alignment',
    'in-context-learning',
    'hallucination',
    'grounding'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u11l1',
      title: 'Next-token prediction, and what follows from it',
      intro:
        'One objective. Everything these models do well and everything they do badly comes out of it, so it is worth being exact about what it is.',
      objectives: [
        'State the training objective of a language model precisely',
        'Explain how a conversation is actually represented',
        'Derive several observed behaviours from the objective alone'
      ],
      concepts: ['llm', 'next-token', 'context-window'],
      requires: ['transformer', 'probability'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A large language model is a transformer — usually decoder-only, usually very large — trained on one task: **given this sequence of tokens, what token comes next?** Not "answer the question", not "be helpful". Predict the next token, over and over, across an enormous corpus.'
        },
        { kind: 'formula', latex: 'P(t_n \\mid t_1, t_2, \\ldots, t_{n-1})', caption: 'The probability of the next token given everything before it. The loss is cross-entropy: how surprised the model was by the token that actually came next, averaged over billions of positions.' },
        { kind: 'heading', text: 'How a conversation really works' },
        {
          kind: 'text',
          text: 'There is no conversation object. The whole exchange is laid out as one sequence of tokens with markers for who said what, and the model continues it. Each time you send a message, the entire history is re-sent and the model generates a continuation from scratch.'
        },
        {
          kind: 'example',
          title: 'What the model is handed',
          text: '<system>You are a helpful assistant.</system>\n<user>What is the capital of France?</user>\n<assistant>Paris.</assistant>\n<user>And its population?</user>\n<assistant>\n\n        ← and the model continues from here, one token at a time\n\nThe "memory" of the earlier exchange is simply that it is still in the text.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This explains a long list of behaviours at once. Nothing is remembered between conversations, because nothing persists outside the text. Long conversations cost more, because the whole history is reprocessed. Things said early can be forgotten, because they may fall out of the window. And no, it does not learn from your conversation — the parameters are frozen.'
        },
        { kind: 'heading', text: 'The context window' },
        {
          kind: 'text',
          text: 'The **context window** is the maximum number of tokens the model can take at once: system prompt, conversation, documents, and the response being generated, all counted together. It is a hard limit of the architecture, not a setting.'
        },
        {
          kind: 'list',
          items: [
            'Exceed it and something must go — usually the oldest messages, which disappear without announcement.',
            'A long document can consume a window on its own, which is the whole motivation for retrieval in Unit 12.',
            'Attention cost grows with the square of the length, so a long context is disproportionately expensive.',
            'Models are measurably less reliable at using information in the middle of a very long context than at either end — a well-documented effect, and a reason not to assume a bigger window solves a retrieval problem.'
          ]
        },
        { kind: 'heading', text: 'Behaviours that fall out of the objective' },
        {
          kind: 'table',
          headers: ['Observation', 'Why the objective produces it'],
          rows: [
            ['Extremely fluent prose', 'Fluency is exactly what next-token prediction optimises'],
            ['Confident, plausible wrongness', 'The objective rewards likely continuations, and nothing in it rewards being right'],
            ['Good at common patterns, worse at rare ones', 'Frequency in the corpus is the training signal'],
            ['Bad at arithmetic with many digits', 'Digits are tokenised arbitrarily, and prediction is not calculation'],
            ['Follows the style of the prompt', 'A continuation of formal text is formal; of sloppy text, sloppy'],
            ['Can be steered by examples in the prompt', 'The prompt is the conditioning — see in-context learning'],
            ['Repeats itself when settings are too conservative', 'The most likely token after a phrase is often the start of that phrase again']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The second row is the one to hold on to. A language model is not a database that occasionally errs. It is a model of what text plausibly follows other text, and plausibility and truth agree most of the time and are not the same thing. Lesson 4 takes this apart properly.'
        },
        { kind: 'check', questionId: 'u11l1q1' },
        { kind: 'check', questionId: 'u11l1q2' },
        { kind: 'check', questionId: 'u11l1q3' }
      ],
      questions: [
        {
          id: 'u11l1q1',
          kind: 'choice',
          concept: 'next-token',
          prompt: 'What is a language model trained to do?',
          difficulty: 'intermediate',
          options: [
            'Answer questions correctly',
            'Predict the next token given the preceding tokens',
            'Store and retrieve facts',
            'Follow instructions'
          ],
          answer: 1,
          explanation:
            'Next-token prediction, and nothing else during pretraining. Answering questions and following instructions are behaviours that emerge from that objective plus later fine-tuning — they are not what the loss measures.',
          hints: ['What does the loss function actually compare?']
        },
        {
          id: 'u11l1q2',
          kind: 'choice',
          concept: 'context-window',
          prompt: 'In a long conversation, why might the model appear to forget something said at the start?',
          difficulty: 'intermediate',
          options: [
            'Its memory decays over time',
            'The earliest messages have been dropped to fit the context window, or are in the middle of a long context where models are measurably less reliable',
            'It chose to ignore them',
            'The parameters were overwritten by later messages'
          ],
          answer: 1,
          explanation:
            'There is no memory to decay. Either the text is no longer in the window, or it is in a position the model handles less reliably. Parameters never change during a conversation.',
          hints: ['Where does the conversation live?']
        },
        {
          id: 'u11l1q3',
          kind: 'true-false',
          concept: 'llm',
          prompt: 'A language model updates its parameters based on your conversation with it.',
          difficulty: 'beginner',
          answer: false,
          explanation:
            'Inference leaves the parameters untouched. The conversation influences the output because it is part of the input. Separately, a provider may *log* conversations and use them in a future training run, which is a policy question rather than something happening as you type.',
          hints: ['What is the difference between training and inference?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u11l2',
      title: 'Sampling: temperature, top-k and top-p',
      intro:
        'The model outputs a distribution over every possible next token. How one gets chosen is a set of settings, and they change the character of the output more than most people realise.',
      objectives: [
        'Explain what logits are and what softmax does to them',
        'Say what temperature, top-k and top-p each do',
        'Choose settings for a given task and defend the choice'
      ],
      concepts: ['sampling'],
      requires: ['next-token'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'At every step the model produces one score per token in the vocabulary — the **logits**. Softmax turns them into probabilities summing to one. Then something has to pick a token, and that is where the settings come in.'
        },
        {
          kind: 'example',
          title: 'A distribution',
          text: 'Context: "The capital of France is"\n\n  " Paris"     0.89\n  " located"   0.04\n  " a"         0.02\n  " the"       0.01\n  …45,000 more tokens sharing the remaining 0.04\n\nContext: "My favourite colour is"\n\n  " blue"      0.21\n  " green"     0.14\n  " red"       0.12\n  " purple"    0.08\n  …a long flat tail\n\nThe first distribution is sharp because the answer is nearly determined. The second is flat because many answers are equally reasonable — and that shape is itself information.'
        },
        { kind: 'heading', text: 'Temperature' },
        {
          kind: 'text',
          text: 'Temperature divides the logits before softmax. Below 1 it sharpens the distribution toward the most likely token; above 1 it flattens it, giving unlikely tokens more chance.'
        },
        {
          kind: 'table',
          headers: ['Temperature', 'Effect', 'Suits'],
          rows: [
            ['0', 'Always the most likely token — deterministic', 'Extraction, classification, anything checked by a program'],
            ['0.2–0.5', 'Mostly predictable, slight variation', 'Factual answers, summaries, code'],
            ['0.7–1.0', 'Noticeably varied', 'Explanation, conversation, drafting'],
            ['Above 1.2', 'Unlikely tokens appear often', 'Brainstorming — and increasingly incoherent'],
            ['Above 2', 'Largely nonsense', 'Nothing useful']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Temperature 0 is not a truth setting. It makes the model deterministic, so it gives you the *same* answer every time — which may be the same wrong answer every time. It removes variability, not error.'
        },
        { kind: 'heading', text: 'Top-k and top-p' },
        {
          kind: 'list',
          items: [
            '**Top-k** — consider only the k most likely tokens and sample among them. Simple, but a fixed k is too restrictive where the distribution is flat and too permissive where it is sharp.',
            '**Top-p (nucleus)** — take the smallest set of tokens whose probabilities add up to p, then sample from that. The set is small when the model is confident and large when it is not, which adapts to the situation. This is why top-p is usually preferred.'
          ]
        },
        {
          kind: 'example',
          title: 'Top-p adapting',
          text: 'p = 0.9\n\nSharp distribution — Paris 0.89, then a long thin tail:\n  the nucleus is essentially { Paris } plus one or two others.\n\nFlat distribution — blue 0.21, green 0.14, red 0.12, …:\n  the nucleus holds a dozen or more tokens.\n\nSame setting, different behaviour, decided by the model own confidence.'
        },
        { kind: 'heading', text: 'Choosing' },
        {
          kind: 'table',
          headers: ['Task', 'Settings', 'Why'],
          rows: [
            ['Pulling fields out of a document', 'Temperature 0', 'One right answer; you want it reproducibly'],
            ['Classifying text', 'Temperature 0', 'Same'],
            ['Generating code', 'Low, 0.1–0.3', 'Correctness matters; a little variation helps when retrying'],
            ['Summarising', 'Low to moderate, 0.3–0.6', 'Faithful but not stilted'],
            ['Conversation', 'Moderate, 0.7', 'Repetitive at low settings'],
            ['Brainstorming names', 'High, 1.0–1.3', 'Variety is the point'],
            ['Anything a program will parse', 'Temperature 0', 'Reproducibility is worth more than variety']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Varying output is sometimes useful as a signal. Ask the same question five times at moderate temperature: if the answers agree, the model is on firm ground; if they contradict each other, that disagreement is evidence of unreliability and it is cheap to collect.'
        },
        { kind: 'check', questionId: 'u11l2q1' },
        { kind: 'check', questionId: 'u11l2q2' }
      ],
      questions: [
        {
          id: 'u11l2q1',
          kind: 'choice',
          concept: 'sampling',
          prompt: 'Why is top-p usually preferred over top-k?',
          difficulty: 'advanced',
          options: [
            'It is faster to compute',
            'The size of the candidate set adapts to the model confidence — small when the distribution is sharp, large when it is flat',
            'It always produces more creative text',
            'It removes the need for temperature'
          ],
          answer: 1,
          explanation:
            'A fixed k is wrong in both directions: too permissive when one token clearly dominates, too restrictive when many are reasonable. Top-p takes however many tokens are needed to reach the probability mass, which is responsive to the situation.',
          hints: ['Compare the two on a sharp distribution and on a flat one.']
        },
        {
          id: 'u11l2q2',
          kind: 'choice',
          concept: 'sampling',
          prompt: 'You are extracting invoice totals from documents with a language model. What temperature, and why?',
          difficulty: 'intermediate',
          options: [
            '0.8, so the model can think flexibly',
            '0, because there is one right answer and you want the same output every time for the same document',
            '1.2, to consider more possibilities',
            'It makes no difference for extraction'
          ],
          answer: 1,
          explanation:
            'Extraction has one correct answer and the output will be parsed by a program. Determinism makes failures reproducible and debuggable; variation only makes the same input sometimes work and sometimes not.',
          hints: ['Would you want this to give a different answer on a second run?']
        },
        {
          id: 'u11l2q3',
          kind: 'true-false',
          concept: 'sampling',
          prompt: 'Temperature 0 makes a model more likely to be correct.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'It makes the model deterministic — always the highest-probability token. If that token is wrong, it is wrong identically every time. It removes variability, not error.',
          hints: ['What exactly does it change about the choice?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u11l3',
      title: 'Pretraining, fine-tuning and in-context learning',
      intro:
        'Three ways a model comes to behave as it does, at wildly different costs — and the one that happens in your prompt, with no training at all.',
      objectives: [
        'Describe the stages from raw pretraining to a deployed assistant',
        'Explain what instruction tuning and preference optimisation contribute',
        'Explain in-context learning and what it is not'
      ],
      concepts: ['pretraining', 'fine-tuning', 'alignment', 'in-context-learning'],
      requires: ['next-token', 'transfer-learning'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Pretraining' },
        {
          kind: 'text',
          text: 'The expensive stage: next-token prediction over an enormous corpus, for a very long time, on a great deal of hardware. What comes out is a model that can continue text extremely well and is not an assistant at all — ask a purely pretrained model a question and it may continue with more questions, because that is what a list of questions looks like in the wild.'
        },
        {
          kind: 'list',
          items: [
            '**Filtering** matters as much as volume: removing boilerplate, spam and near-duplicate pages measurably improves the result.',
            '**Deduplication** — repeated text gets effectively over-weighted and encourages verbatim memorisation.',
            '**Contamination** — if evaluation benchmarks appear in the training corpus, benchmark scores stop measuring anything. This has happened repeatedly and is hard to rule out at scale.'
          ]
        },
        { kind: 'heading', text: 'Fine-tuning' },
        {
          kind: 'table',
          headers: ['Stage', 'Data', 'What it produces'],
          rows: [
            ['Pretraining', 'An enormous corpus of text', 'A model that continues text'],
            ['Instruction tuning', 'Instruction-and-good-answer pairs', 'A model that responds to requests'],
            ['Preference optimisation', 'Pairs of answers with a judgement of which is better', 'A model whose answers people prefer'],
            ['Task fine-tuning', 'Your own labelled examples', 'A model specialised to one job']
          ]
        },
        {
          kind: 'text',
          text: '**Instruction tuning** is ordinary supervised learning on demonstrations: here is a request, here is a good response. It is what turns a text continuer into something that answers.'
        },
        {
          kind: 'text',
          text: '**Preference optimisation** goes further. Collect pairs of responses, have people say which is better, and train the model toward the preferred one — either by fitting a reward model and optimising against it, or by a direct method that skips the separate reward model. This is where tone, refusals and format conventions largely come from.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Unit 05 applies directly here. "Answers people preferred" is a proxy for "answers that are correct and useful", and the two come apart in predictable directions: toward agreeableness, toward confident phrasing, toward length. A model trained on preferences learns what reads well, and what reads well is not always what is right.'
        },
        {
          kind: 'text',
          text: '**Parameter-efficient fine-tuning** is how this is done without retraining a whole model. Rather than updating billions of weights, train a small number of additional parameters — low-rank adapters inserted beside the existing layers — and leave the original frozen. A fraction of a per cent of the parameters, a fraction of the cost, and the adapters can be swapped per task.'
        },
        { kind: 'heading', text: 'In-context learning' },
        {
          kind: 'text',
          text: 'The remarkable one. Put examples in the prompt and the model does better on that task — with **no parameters changing at all**. The examples condition the generation; nothing is learned in the training sense.'
        },
        {
          kind: 'example',
          title: 'Zero-shot and few-shot',
          text: 'Zero-shot:\n  "Classify the sentiment: \'The battery lasts two days.\'"\n\nFew-shot:\n  "Classify sentiment as positive, negative or neutral.\n\n   \'Screen cracked after a week\' → negative\n   \'Arrived on time\' → neutral\n   \'Best purchase this year\' → positive\n\n   \'The battery lasts two days\' →"\n\nThe examples establish the label set, the format, and the standard. Few-shot regularly beats zero-shot without any training, and it is the cheapest intervention available.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The word "learning" is doing a lot of work here. Nothing persists: start a new conversation and the model has no idea what you taught it. In-context learning is conditioning, and calling it learning has misled a great many people about what these systems retain.'
        },
        {
          kind: 'text',
          text: 'When to use which: in-context examples for almost everything, because they cost nothing and can be changed instantly. Fine-tuning when you have thousands of examples, need a consistent format or style, want to cut prompt length, or need a smaller model to do a narrow job well. Retrieval (Unit 12) when the problem is the model not *knowing* something, because fine-tuning is a poor way to install facts.'
        },
        { kind: 'check', questionId: 'u11l3q1' },
        { kind: 'check', questionId: 'u11l3q2' }
      ],
      questions: [
        {
          id: 'u11l3q1',
          kind: 'choice',
          concept: 'in-context-learning',
          prompt: 'You put three worked examples in a prompt and the model performs better. What has happened to the model?',
          difficulty: 'intermediate',
          options: [
            'It has been fine-tuned on those examples',
            'Nothing — the parameters are unchanged; the examples condition this one generation and are forgotten entirely afterwards',
            'It stored them in long-term memory',
            'It retrained itself briefly'
          ],
          answer: 1,
          explanation:
            'In-context learning changes no weights. The examples are input. A new conversation starts with no trace of them, which is exactly why the name is misleading.',
          hints: ['Which of the six words from Unit 01 is being misapplied?']
        },
        {
          id: 'u11l3q2',
          kind: 'choice',
          concept: 'fine-tuning',
          prompt: 'You need a model to answer questions about your company internal documentation. Fine-tune or retrieve?',
          difficulty: 'advanced',
          options: [
            'Fine-tune, so the facts are inside the model',
            'Retrieve — fine-tuning teaches style and format far better than it installs facts, and retrieved passages can be cited, updated and checked',
            'Neither; use a bigger model',
            'Fine-tune and then also retrieve, always'
          ],
          answer: 1,
          explanation:
            'Facts belong in retrieval. Fine-tuning them in is expensive, leaves no citation, has to be redone when a document changes, and gives no way to tell whether an answer came from the document or from the model priors. Fine-tuning is for how to answer; retrieval is for what to answer from.',
          hints: ['Which approach lets you point at the sentence the answer came from?']
        },
        {
          id: 'u11l3q3',
          kind: 'choice',
          concept: 'alignment',
          prompt: 'Training on which answer people preferred introduces a predictable risk. Which?',
          difficulty: 'advanced',
          options: [
            'The model becomes slower',
            'Preference is a proxy for correctness, and optimising it drifts toward what reads well — agreeable, confident, long — rather than toward what is right',
            'The model forgets how to write',
            'It eliminates hallucination'
          ],
          answer: 1,
          explanation:
            'Exactly the reward-hacking pattern from Unit 05. The measurable signal is "preferred", the thing wanted is "correct and useful", and the gap is consistently filled by confident agreeable prose.',
          hints: ['What is the proxy, and what does it stand in for?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u11l4',
      title: 'Hallucination and grounding',
      intro:
        'Why a model states a fabricated reference with the same confidence as a true one — and what actually reduces it, as opposed to what people hope reduces it.',
      objectives: [
        'Explain hallucination as a consequence of the training objective',
        'Say why confident phrasing carries no information about correctness',
        'Name the interventions that genuinely help, and what each costs'
      ],
      concepts: ['hallucination', 'grounding'],
      requires: ['next-token', 'in-context-learning'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A model produces a fluent, specific, confident statement that is false. A citation with a real-looking author, a plausible journal and a page number, for a paper that does not exist. This is usually called **hallucination**, and the word unhelpfully suggests a malfunction.'
        },
        { kind: 'heading', text: 'Why the objective produces it' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'The model is trained to produce likely continuations. A citation-shaped string after "according to" is extremely likely.',
            'Nothing in the objective rewards truth. The loss compares the predicted token with the actual next token in the corpus — not with the world.',
            'There is no lookup. Facts are patterns distributed across billions of weights, not records with addresses. There is nothing to be absent.',
            'Nothing represents "I do not know". The model always has a distribution over next tokens, and something always has the highest probability.',
            'Preference training rewards confident, complete answers — so hedging has been trained down.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is the important consequence: **fluency and confidence carry no information about correctness.** A human expert hesitates at the edge of their knowledge. A language model produces its most likely continuation with identical smoothness whether it is on firm ground or inventing. The usual cue people rely on for judging reliability is simply absent.'
        },
        { kind: 'heading', text: 'Where it is most likely' },
        {
          kind: 'table',
          headers: ['Higher risk', 'Why'],
          rows: [
            ['Specific numbers, dates, statistics', 'A plausible number is as likely a continuation as the true one'],
            ['Citations and references', 'Highly patterned, and the pattern is easy to produce without the content'],
            ['Anything recent', 'After the training cut-off there is nothing to recall'],
            ['Obscure entities', 'Thin training signal, and the shape of an answer is still available'],
            ['Questions with a false premise', 'The model tends to answer the question as posed rather than challenge it'],
            ['Long chains of reasoning', 'An early error is carried forward confidently']
          ]
        },
        { kind: 'heading', text: 'Grounding, and what each intervention costs' },
        {
          kind: 'table',
          headers: ['Intervention', 'Effect', 'Cost or limit'],
          rows: [
            ['Retrieval, with the passage in the prompt', 'The largest single improvement available', 'Needs the right passage found; wrong retrieval produces grounded nonsense'],
            ['Require citations to supplied text', 'Makes fabrication visible — a quote either is in the source or is not', 'The citation itself can be fabricated unless verified against the text'],
            ['Tools for arithmetic, dates and lookups', 'Removes whole categories of error', 'Engineering work; the model must choose to use them'],
            ['Ask it to say when it does not know', 'Helps somewhat', 'Not reliable, and over-refusal is its own problem'],
            ['Sample several times and compare', 'Disagreement is good evidence of unreliability', 'Several times the cost; agreement is not proof'],
            ['A separate verification pass', 'Catches some errors', 'More cost; the verifier has the same weaknesses'],
            ['A bigger model', 'Fewer errors on average', 'Does not remove the mechanism — and the errors left are harder to spot']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The engineering conclusion for the rest of this course: design systems that do not require the model to be right unaided. Give it the source and have it quote. Give it a calculator. Check its output against something. "Prompt it more carefully" is not a reliability strategy — it is a hope.'
        },
        { kind: 'heading', text: 'Reasoning in the output' },
        {
          kind: 'text',
          text: 'Asking a model to work through a problem in steps before answering measurably improves accuracy on multi-step problems — it has more intermediate tokens to condition on, so each step is a smaller leap. Two honest caveats: the written steps are not a transparent window into how the answer was produced, and a confident wrong chain of reasoning reads exactly like a correct one. Useful technique, not an audit trail.'
        },
        {
          kind: 'lab',
          appId: 'explain-it-yourself',
          title: 'Explain it without the word "hallucination"',
          does:
            'Explain to somebody non-technical why a language model states a false citation confidently — using the training objective, not the word "hallucination". If the explanation needs the word, it has not been understood yet.'
        },
        { kind: 'check', questionId: 'u11l4q1' },
        { kind: 'check', questionId: 'u11l4q2' },
        { kind: 'check', questionId: 'u11l4q3' }
      ],
      questions: [
        {
          id: 'u11l4q1',
          kind: 'choice',
          concept: 'hallucination',
          prompt: 'Why does a language model produce a confident false citation?',
          difficulty: 'advanced',
          options: [
            'A bug in the sampling code',
            'Because it predicts likely continuations and a citation-shaped string is a likely continuation — nothing in its objective rewards truth, and it has no record to look up',
            'Because its training data was all false',
            'Because the temperature was too high'
          ],
          answer: 1,
          explanation:
            'It is the objective working as specified. Plausible text is what the loss rewards; truth is not measured. There is no store of references to consult, so nothing can be found missing.',
          hints: ['What does the loss compare the output against?']
        },
        {
          id: 'u11l4q2',
          kind: 'choice',
          concept: 'grounding',
          prompt: 'Which single intervention most reduces fabricated facts?',
          difficulty: 'advanced',
          options: [
            'Lowering the temperature to 0',
            'Putting the relevant source text in the prompt and requiring the answer to come from it',
            'Adding "do not hallucinate" to the system prompt',
            'Using a larger model'
          ],
          answer: 1,
          explanation:
            'Grounding in supplied text, with a requirement to quote. Temperature 0 only makes the same error repeatable. An instruction not to fabricate has no mechanism behind it. A larger model fabricates less and still fabricates.',
          hints: ['Which option changes what the model has available rather than how it is asked?']
        },
        {
          id: 'u11l4q3',
          kind: 'true-false',
          concept: 'hallucination',
          prompt: 'A confidently worded answer from a language model is more likely to be correct than a hedged one.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Confidence and correctness are unrelated in these models. Preference training actively rewards confident phrasing, so the usual human cue for reliability has been trained to be uninformative here.',
          hints: ['What does the phrasing of the answer depend on?']
        }
      ]
    }
  ]
}
