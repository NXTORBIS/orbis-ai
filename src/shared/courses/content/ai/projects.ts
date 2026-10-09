import type { Module } from '../../types.ts'

/**
 * Unit 14 — The projects, and the capstone.
 *
 * Five projects and one capstone, each a lesson holding the brief, the required steps, the quality gate and the
 * questions that check the learner understood what they built rather than that it ran.
 *
 * The scaffolding reduces deliberately across the five. Project 01 lists every step; the capstone states a
 * standard and leaves the work to be designed. The quality gates are written as things a person can check about
 * their own work, because that is the skill being taught: knowing whether what you built is any good.
 */
export const AI_PROJECTS: Module = {
  id: 'u14',
  title: 'Projects and Capstone',
  summary:
    'Five projects — a predictor, an image classifier, a text classifier, a grounded assistant and a safe agent — and a capstone where you choose the problem and defend the choices.',
  concepts: ['ml-workflow', 'error-analysis', 'eval-pipeline', 'rag', 'agent', 'ai-safety', 'reproducibility'],
  lessons: [
    // ------------------------------------------------------------------ project 1
    {
      id: 'p1',
      title: 'Project 01 — Build a machine-learning predictor',
      intro:
        'The whole workflow on one real dataset, with every step named. The deliverable is not a score; it is a model you can explain, including where it fails.',
      objectives: [
        'Carry out a complete supervised-learning project',
        'Report an honest evaluation against a baseline',
        'Explain why the model works and where it does not'
      ],
      concepts: ['ml-workflow', 'error-analysis'],
      requires: ['splits', 'evaluation', 'regression-metrics', 'precision-recall'],
      minutes: 120,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Choose a tabular dataset with a clear thing to predict — house prices, whether a customer left, a measurement from other measurements. Import your own, or take one from the Data Explorer.'
        },
        { kind: 'heading', text: 'The steps' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Write one sentence saying what one row means, and one saying what you are predicting from what.',
            'Inspect every column: type, range, missing values, distribution. Write down what is wrong with each.',
            'Split into training, validation and test **before** cleaning. Respect groups and time if either applies.',
            'Clean and prepare, fitting every transformation on the training set only.',
            'Establish a baseline: predict the mean, or the majority class. Record its score.',
            'Train the simplest sensible model. Record its score on validation.',
            'Train one more capable model. Compare, and compare the spread as well as the mean.',
            'Choose a model and write down why, including what you traded.',
            'Run the test set once. Record the number and the date.',
            'Examine fifty errors by hand and sort them into categories.',
            'Report: what you built, how it was measured, how it compares with the baseline, the biggest error category, and what you would do next.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Is there a baseline, and does your model beat it by more than the noise in the measurement?',
            'Was every transformation fitted on training data only? Name where each one was fitted.',
            'Was the test set used exactly once?',
            'Would every feature be available at prediction time, with that content? Go through them one by one.',
            'Can you name the largest category of error and say whether more data of the current kind would fix it?',
            'Is the metric the right one for the costs of the two mistakes, and did you choose it before seeing results?'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A suspiciously good score is the thing to investigate first. Before reporting anything above what the problem plausibly allows, go looking for a leak: train a deliberately simple model, look at which feature dominates, drop it and retrain.'
        },
        {
          kind: 'lab',
          appId: 'learning-lab',
          title: 'Build it',
          does: 'Train, evaluate and compare your models here. Keep the experiment so the numbers in your report can be traced back to a run.'
        },
        {
          kind: 'lab',
          appId: 'data-explorer',
          title: 'Inspect and clean the data',
          does: 'Work through every column before modelling, and record each decision you make about a fault.'
        },
        { kind: 'check', questionId: 'p1q1' },
        { kind: 'check', questionId: 'p1q2' },
        { kind: 'check', questionId: 'p1q3' }
      ],
      questions: [
        {
          id: 'p1q1',
          kind: 'choice',
          concept: 'ml-workflow',
          prompt: 'Your model scores 0.94 and the baseline scores 0.93. What have you learned?',
          difficulty: 'intermediate',
          options: [
            'The model is excellent',
            'That the problem is nearly solved by the baseline, and your model adds almost nothing — which is a real finding and should be reported as one',
            'That the baseline is broken',
            'Nothing until you run the test set'
          ],
          answer: 1,
          explanation:
            'The baseline is the evidence. A one-point gain over predicting the majority class means the features are carrying very little, which is worth knowing and worth reporting rather than hiding behind the 0.94.',
          hints: ['Compare the two numbers, not just the first one.']
        },
        {
          id: 'p1q2',
          kind: 'choice',
          concept: 'error-analysis',
          prompt: 'Why does the project require examining fifty errors by hand?',
          difficulty: 'intermediate',
          options: [
            'To improve the score',
            'Because the aggregate metric says how much the model is wrong and never how — and how is what decides what to do next',
            'To find bugs in the code',
            'Because the brief says so'
          ],
          answer: 1,
          explanation:
            'A score is one number. Fifty errors sorted into categories tells you whether the problem is label noise, a missing feature, a failing subgroup or a genuinely hard case — four different next steps.',
          hints: ['What question does the metric not answer?']
        },
        {
          id: 'p1q3',
          kind: 'short',
          concept: 'ml-workflow',
          prompt: 'Why must the split happen before cleaning?',
          difficulty: 'intermediate',
          answer: 'so cleaning statistics come from training data only and nothing about the test set leaks in',
          accepts: [
            'to avoid leakage',
            'so test data does not influence the cleaning',
            'cleaning uses training statistics only',
            'otherwise the test set leaks'
          ],
          explanation:
            'Clean first and your means, scalers and encoders are computed over data that includes the test set. The test score is then not an estimate of performance on unseen data.',
          hints: ['Where would the mean you subtracted have come from?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 2
    {
      id: 'p2',
      title: 'Project 02 — Build an image classifier',
      intro:
        'Vision end to end, with transfer learning and augmentation. Less hand-holding: the steps are listed, the decisions are yours.',
      objectives: [
        'Train an image classifier using a pretrained backbone',
        'Use augmentation that preserves the label',
        'Analyse the confusion matrix and the wrong predictions'
      ],
      concepts: ['cnn', 'augmentation', 'error-analysis'],
      requires: ['cnn', 'transfer-learning', 'confusion-matrix'],
      minutes: 120,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Pick a small image dataset with three to ten classes. Keep it small enough to iterate quickly — a few hundred images per class is plenty, and part of the exercise is working at that scale honestly.'
        },
        { kind: 'heading', text: 'What the project must include' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Look at the images. Count them per class. Note anything odd — duplicates, mislabels, wildly different sizes or lighting.',
            'Split into training, validation and test, keeping near-duplicates on one side of the boundary.',
            'Preprocess consistently, and write down the steps so they can be reproduced at inference.',
            'Start from a pretrained backbone, replace the head, freeze the early layers, train.',
            'Record the baseline: what accuracy would guessing the most common class give?',
            'Add augmentation. Justify each transformation by saying why it preserves the label.',
            'Compare: with and without augmentation; frozen against fine-tuned at a low learning rate.',
            'Produce the confusion matrix and read the off-diagonal cells.',
            'Look at twenty wrong predictions as images, and say for each why it was wrong.',
            'Report, including which classes the model confuses and what you would collect to fix it.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Is there a per-class breakdown, not only an overall accuracy?',
            'Does every augmentation preserve the label? Say why, for each.',
            'Are near-duplicates confined to one split?',
            'Are the preprocessing steps written down well enough to reproduce at inference time?',
            'Does the report name the two classes most often confused, with an explanation?',
            'If accuracy is very high, have you checked for a leak — the same image in two splits, or a background cue that identifies the class?'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The classic vision leak is a background cue: all the photographs of one class were taken in one place, so the model learns the wallpaper. Looking at the images is the only way to catch it, which is why step 1 and step 9 are not optional.'
        },
        {
          kind: 'lab',
          appId: 'image-lab',
          title: 'Train and analyse',
          does: 'Build the classifier, read the confusion matrix, and look at the images it got wrong.'
        },
        { kind: 'check', questionId: 'p2q1' },
        { kind: 'check', questionId: 'p2q2' }
      ],
      questions: [
        {
          id: 'p2q1',
          kind: 'choice',
          concept: 'augmentation',
          prompt: 'You are classifying X-rays and want more training data. Which augmentation is unacceptable, and why?',
          difficulty: 'advanced',
          options: [
            'Small rotations — the patient position varies anyway',
            'Horizontal mirroring — it swaps left and right, which in a clinical image can change what the correct answer is',
            'Slight brightness changes',
            'Random small crops'
          ],
          answer: 1,
          explanation:
            'Mirroring a chest X-ray produces an anatomically wrong image and can invert a laterality finding. Note that brightness is also a judgement call in medical imaging, where intensity can be diagnostic — but mirroring is the clear violation of the rule.',
          hints: ['Apply the rule: does the correct answer survive the transformation?']
        },
        {
          id: 'p2q2',
          kind: 'choice',
          concept: 'cnn',
          prompt: 'Your classifier reaches 99.8% on the test set with 400 images per class. What should you do?',
          difficulty: 'advanced',
          options: [
            'Report it and finish',
            'Investigate — at that scale this is more likely a leak or a background cue than genuine performance; look for duplicates across splits and look at what the model is attending to',
            'Add more augmentation',
            'Train for more epochs'
          ],
          answer: 1,
          explanation:
            'An unexpectedly good result is a bug report. With a few hundred images per class, near-perfect test accuracy usually means duplicates straddling the split or a spurious cue the classes happen to share.',
          hints: ['What rule from Unit 02 applies to surprisingly good news?']
        },
        {
          id: 'p2q3',
          kind: 'short',
          concept: 'error-analysis',
          prompt: 'What do the off-diagonal cells of a confusion matrix tell you that the accuracy does not?',
          difficulty: 'intermediate',
          answer: 'which classes the model confuses with which',
          accepts: [
            'which classes get mixed up',
            'what it mistakes for what',
            'the specific confusions',
            'which pairs of classes are confused'
          ],
          explanation:
            'Accuracy counts mistakes; the off-diagonal says which mistakes. Two classes confused in one direction only is a different problem from everything being confused with everything, and they have different fixes.',
          hints: ['The diagonal is what was right. What is everything else?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 3
    {
      id: 'p3',
      title: 'Project 03 — Build a text classifier',
      intro:
        'Two approaches to the same task — counting and embedding — compared honestly, with the ambiguous cases examined rather than averaged away.',
      objectives: [
        'Build a text classifier with two different representations',
        'Compare them on the same split with the same metrics',
        'Investigate the ambiguous and mislabelled cases'
      ],
      concepts: ['nlp', 'bag-of-words', 'embeddings', 'precision-recall'],
      requires: ['tokenisation', 'embeddings', 'precision-recall', 'imbalance'],
      minutes: 120,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Choose a text-classification task: sentiment, topic, spam, whether a support message needs escalation. Two or more classes, and ideally some genuine class imbalance — it makes the metrics lesson concrete.'
        },
        { kind: 'heading', text: 'What the project must include' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Read fifty examples. Write down what you notice: length, register, how clear the labels are.',
            'Record the class balance. Decide which metric matters, and why, before training anything.',
            'Split, keeping duplicates and near-duplicates on one side.',
            'Approach one: TF-IDF features and a simple classifier.',
            'Approach two: embeddings and a classifier on top.',
            'Compare on the same split, with the same metrics, including per class.',
            'Tune the threshold for the metric you chose, and show what it costs on the other.',
            'Examine thirty errors. Sort them: genuinely hard, ambiguous to a person, wrongly labelled, out of scope.',
            'Say what fraction of the remaining errors are label noise, and what that implies about the ceiling.',
            'Report, naming which approach you would ship and what it cost in size and latency.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Was the metric chosen before the results were seen, and justified by the costs of each mistake?',
            'Are both approaches evaluated on the same split with the same preparation?',
            'Is there a per-class breakdown, including the rare class?',
            'Does the report say how many of the errors are label problems?',
            'Is the threshold choice explicit, with the trade shown?',
            'Does the comparison include cost, size and latency, not only the score?'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Expect TF-IDF to do better than you think. On a clean task with enough data it frequently matches an embedding approach at a fraction of the cost, and finding that out is more useful than assuming the more modern method wins.'
        },
        {
          kind: 'lab',
          appId: 'learning-lab',
          title: 'Train both, compare fairly',
          does: 'Build both classifiers and evaluate them on the same split, with the same metrics and the same threshold policy.'
        },
        { kind: 'check', questionId: 'p3q1' },
        { kind: 'check', questionId: 'p3q2' }
      ],
      questions: [
        {
          id: 'p3q1',
          kind: 'choice',
          concept: 'imbalance',
          prompt: '96% of your messages are "no escalation needed". Which headline metric should the report lead with?',
          difficulty: 'intermediate',
          options: [
            'Accuracy, since it is standard',
            'Precision and recall on the escalation class, because accuracy is 96% for a model that never escalates anything',
            'Mean squared error',
            'Training loss'
          ],
          answer: 1,
          explanation:
            'With that imbalance accuracy is dominated by the majority class and a useless model scores 96%. The metrics that matter are precision and recall on the class that needs finding.',
          hints: ['What accuracy does "always answer no" achieve?']
        },
        {
          id: 'p3q2',
          kind: 'choice',
          concept: 'nlp',
          prompt: 'Why does the project require comparing TF-IDF against embeddings rather than only using embeddings?',
          difficulty: 'advanced',
          options: [
            'To demonstrate that older methods are worse',
            'Because the simpler method is often competitive at far lower cost, and you cannot know whether the complex one earns its cost without the comparison',
            'Because embeddings do not work for classification',
            'To use more of the course material'
          ],
          answer: 1,
          explanation:
            'The comparison is how you find out whether the extra cost is buying anything. On many tasks it is not, and that is a result worth having rather than an embarrassment.',
          hints: ['What decision does the comparison let you make?']
        },
        {
          id: 'p3q3',
          kind: 'choice',
          concept: 'error-analysis',
          prompt: 'A third of your remaining errors are cases where two people would disagree about the label. What does that mean?',
          difficulty: 'advanced',
          options: [
            'The model needs more capacity',
            'There is a ceiling below 100% set by the task itself, and the honest report says so rather than pursuing errors nobody can resolve',
            'The labels should be deleted',
            'The split is wrong'
          ],
          answer: 1,
          explanation:
            'If people disagree, the task has irreducible ambiguity and no model can resolve it. The useful responses are to report the ceiling, or to redefine the task so the ambiguous cases have a defined answer.',
          hints: ['Could a perfect model get those cases right?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 4
    {
      id: 'p4',
      title: 'Project 04 — Build a grounded assistant',
      intro:
        'A retrieval-augmented assistant over a bounded set of documents, evaluated as a system: retrieval measured separately, and the adversarial cases included.',
      objectives: [
        'Build a RAG pipeline end to end',
        'Evaluate retrieval and generation separately',
        'Test the refusal, ambiguity and injection cases'
      ],
      concepts: ['rag', 'chunking', 'vector-search', 'grounding', 'eval-pipeline'],
      requires: ['rag', 'retrieval-failure', 'prompt-injection', 'eval-pipeline'],
      minutes: 150,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Choose a bounded knowledge source — a handful of documents you actually have: a manual, a policy set, your own notes. Bounded matters: you need to be able to say what a correct answer is.'
        },
        { kind: 'heading', text: 'What the project must include' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Ingest the documents. Record what you did about structure, tables and anything that did not convert cleanly.',
            'Chunk them. State the size, the overlap, and what you split on. Carry the title and heading into each chunk.',
            'Embed and store, keeping the text with each vector.',
            'Build the retrieval step. Then build an evaluation for it: twenty questions with the passage each one should find, and measure how often it is in the top few.',
            'Build the generation step: the question, the retrieved passages, and an instruction to answer only from them with a quote per claim.',
            'Write the refusal behaviour: what happens when the passages do not cover the question.',
            'Test the ordinary cases.',
            'Test the hard ones: a question the documents do not answer, an ambiguous question, a question whose answer is spread across two documents, a question with a false premise.',
            'Test injection: put an instruction inside one of the documents and see whether the assistant follows it. Record what happened.',
            'Report: retrieval recall, answer quality, what it refuses, what it got wrong, and what the injection test showed.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Is retrieval measured separately, with a number?',
            'Does every answer carry a quote, and have you verified the quotes appear in the source?',
            'Does it refuse when the documents do not cover the question — tested, not assumed?',
            'What happened in the injection test, and what change did you make as a result?',
            'When two documents disagree, does it surface the conflict or silently pick one?',
            'Can you reproduce an answer: the model version, the settings, and the retrieved chunks recorded?'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The failure to watch for is the well-cited answer to the wrong question. If retrieval returns a plausible but incorrect passage, the answer arrives with a citation and the right shape. That is why retrieval gets its own number, and why checking the citations is part of the gate rather than a nicety.'
        },
        {
          kind: 'lab',
          appId: 'data-explorer',
          title: 'Measure retrieval first',
          does: 'Build the question-to-passage set and measure recall at k before touching the generation prompt.'
        },
        { kind: 'check', questionId: 'p4q1' },
        { kind: 'check', questionId: 'p4q2' },
        { kind: 'check', questionId: 'p4q3' }
      ],
      questions: [
        {
          id: 'p4q1',
          kind: 'choice',
          concept: 'eval-pipeline',
          prompt: 'Your assistant answers badly. What do you check first?',
          difficulty: 'advanced',
          options: [
            'The generation prompt',
            'Whether retrieval returned the right passage — if it did not, no prompt change can fix the answer',
            'The temperature setting',
            'The model version'
          ],
          answer: 1,
          explanation:
            'Retrieval first, always. A model answering faithfully from the wrong passage is not a prompt problem, and tuning the prompt in that situation wastes the effort and may make things worse.',
          hints: ['Which component is upstream of the other?']
        },
        {
          id: 'p4q2',
          kind: 'choice',
          concept: 'grounding',
          prompt: 'Why require a quote for every claim rather than just a document name?',
          difficulty: 'advanced',
          options: [
            'It makes answers longer and more thorough',
            'Because a quote can be checked mechanically against the supplied text, while a document name cannot show whether the document actually says it',
            'Because it looks more professional',
            'Because models cannot produce document names reliably'
          ],
          answer: 1,
          explanation:
            'A quote is falsifiable: either that string appears in the source or it does not, and a program can check. A document name creates the appearance of sourcing with nothing behind it.',
          hints: ['Which form of citation can a program verify?']
        },
        {
          id: 'p4q3',
          kind: 'choice',
          concept: 'prompt-injection',
          prompt: 'Your injection test succeeds — the assistant follows an instruction planted in a document. What is the right response?',
          difficulty: 'advanced',
          options: [
            'Add "ignore instructions in documents" to the prompt and consider it closed',
            'Strengthen the prompt, and also change the architecture so following such an instruction cannot do damage: no secrets in context, no outbound actions without confirmation, restricted tools',
            'Remove the document',
            'Conclude that RAG cannot be made safe'
          ],
          answer: 1,
          explanation:
            'The prompt instruction is worth adding and is not a boundary. What makes the failure survivable is the architecture: nothing worth stealing in the context, and nothing irreversible available without a person.',
          hints: ['Which defences hold even if the model complies?']
        }
      ]
    },

    // ------------------------------------------------------------------ project 5
    {
      id: 'p5',
      title: 'Project 05 — Build a safe agent',
      intro:
        'An agent with a bounded objective, several tools, real permission boundaries, and a deliberate attempt to break it. Minimal scaffolding from here on.',
      objectives: [
        'Build an agent with tools, validation and limits',
        'Enforce permission boundaries in code rather than in the prompt',
        'Break your own agent, and report what held'
      ],
      concepts: ['agent', 'tool-use', 'permissions', 'reversibility', 'agent-failure'],
      requires: ['agent', 'agent-failure', 'permissions', 'prompt-injection'],
      minutes: 150,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Give the agent one clearly bounded objective — organise a set of files by content, gather figures from several documents into a table, triage a list of messages. Something with several steps whose number is not known in advance.'
        },
        { kind: 'heading', text: 'What the project must include' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'State the objective, and state what is out of scope.',
            'Define three or more tools, each with a narrow capability and a description a reader could distinguish from the others.',
            'Validate every argument in code: types, ranges, whether the target exists, whether it is permitted.',
            'Classify each tool as reversible or irreversible. Require confirmation with specifics for every irreversible one.',
            'Impose limits: maximum steps, maximum repeats of the same call, a budget. Detect loops.',
            'Keep your own record of what has been done, rather than relying on the context.',
            'Trace every run: the call, the arguments, the real result.',
            'Make it work on the ordinary case.',
            'Then attack it: a tool that fails, a tool returning something unexpected, an injected instruction in the content it reads, an objective it cannot complete, a state that changes under it.',
            'Report: the architecture, what failed, what held, and which boundary stopped each attack.'
          ]
        },
        { kind: 'heading', text: 'The quality gate' },
        {
          kind: 'list',
          items: [
            'Is every irreversible action behind a confirmation that shows the specifics?',
            'Are arguments validated in code — can you point at the validation?',
            'Is there a step limit and loop detection, demonstrated working?',
            'Are tool results in the trace the real ones, with no path by which the model could narrate a result that never happened?',
            'What happened on the injection attempt, and which boundary held?',
            'Does it stop and say so when it cannot complete the objective, rather than inventing completion?'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The report is the deliverable. An agent that worked first time and was never attacked demonstrates nothing; an agent that was attacked five ways, failed twice and was then fixed demonstrates exactly the skill this project is for.'
        },
        { kind: 'check', questionId: 'p5q1' },
        { kind: 'check', questionId: 'p5q2' }
      ],
      questions: [
        {
          id: 'p5q1',
          kind: 'choice',
          concept: 'agent-failure',
          prompt: 'Your agent reports that it deleted three files. How do you know whether it did?',
          difficulty: 'advanced',
          options: [
            'The agent said so in its summary',
            'Only from your own trace of actual tool calls and their real results — the summary is generated text and can describe actions that never happened',
            'By asking the agent again',
            'By the absence of an error message'
          ],
          answer: 1,
          explanation:
            'The summary is model output. The record of what happened has to come from your code, which is why the trace is a requirement and why tool results must never be narrated by the model.',
          hints: ['Which part of the system is generated text?']
        },
        {
          id: 'p5q2',
          kind: 'multi',
          concept: 'permissions',
          prompt: 'Which of these belong in the agent code rather than in its prompt? Choose all that apply.',
          difficulty: 'advanced',
          options: [
            'Validating that a file path is inside the permitted directory',
            'The maximum number of steps in a run',
            'The instruction to be careful with destructive actions',
            'Requiring confirmation before an irreversible action'
          ],
          answer: [0, 1, 3],
          explanation:
            'Path validation, step limits and confirmation are enforceable. The instruction to be careful is worth including and is a preference — it holds only while the model chooses to honour it.',
          hints: ['Which of these still works if the model ignores everything it was told?']
        },
        {
          id: 'p5q3',
          kind: 'short',
          concept: 'reversibility',
          prompt: 'What single question decides whether an action needs confirmation?',
          difficulty: 'intermediate',
          answer: 'can it be undone',
          accepts: ['is it reversible', 'can it be reversed', 'is it irreversible', 'can we take it back'],
          explanation:
            'Reversibility, not importance and not confidence. A reversible mistake costs a correction; an irreversible one cannot be withdrawn, and that is what a person is for.',
          hints: ['It is about what happens afterwards.']
        }
      ]
    },

    // ------------------------------------------------------------------ capstone
    {
      id: 'p6',
      title: 'Capstone — Build a complete AI system',
      intro:
        'You choose the problem. No steps are given, because designing the work is the thing being assessed. The standard is that somebody technical could read your report and rebuild it.',
      objectives: [
        'Define a problem, success criteria and a data strategy',
        'Build, evaluate and analyse a complete system',
        'Defend every significant technical choice, and state the limitations'
      ],
      concepts: ['ai-system', 'eval-pipeline', 'ai-safety', 'reproducibility', 'error-analysis'],
      requires: ['ai-system', 'eval-pipeline', 'ai-safety', 'reproducibility'],
      minutes: 300,
      difficulty: 'expert',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Choose something you would actually want to exist. It must involve real data or real documents, more than a single model call, and a decision somebody would act on.'
        },
        { kind: 'heading', text: 'What the report must contain' },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**The problem** — what it is, who it is for, and what a good outcome is in their terms.',
            '**Success criteria** — stated numerically where possible, before you built anything.',
            '**Data strategy** — where the data came from, what is in it, who could not appear in it, and what you did about every fault.',
            '**Architecture** — the components, what each does, and what happens when each one fails.',
            '**Why these choices** — model, representation, retrieval, thresholds. For each, what you compared it against.',
            '**Evaluation** — your own set, with the conditions for each case, including out-of-scope and adversarial ones. The numbers, and the baseline.',
            '**Error analysis** — the categories, their counts, and what you would do next.',
            '**Safety** — the risks that apply, how you tested for them, what the system does when it is out of its depth, and where a person is required.',
            '**Limitations** — what it does not do, who it will work badly for, and what would have to change.',
            '**Reproducibility** — versions, settings, and enough detail that the numbers can be reproduced.',
            '**A demonstration** — it working on real input, including a case it handles badly.'
          ]
        },
        { kind: 'heading', text: 'The quality gate — and it is not "it runs"' },
        {
          kind: 'table',
          headers: ['Checked', 'What a pass looks like'],
          rows: [
            ['Problem understood', 'The success criteria are in the user terms, not the model metrics'],
            ['Approach appropriate', 'A simpler approach was considered and the comparison is reported'],
            ['Data quality', 'Every fault is named with the decision taken; collection is described'],
            ['Evaluation sound', 'Your own cases, written conditions, a baseline, and the edges included'],
            ['No leakage', 'Feature availability checked one by one; splits respect groups and time'],
            ['Results interpreted', 'What the numbers mean, with their uncertainty, not just what they are'],
            ['Limitations acknowledged', 'Specific and uncomfortable, not a paragraph of hedging'],
            ['Safety considered', 'Risks named, tested, with a defined behaviour when out of depth'],
            ['Reproducible', 'Somebody else could get your numbers'],
            ['Explained', 'Both in ordinary language and technically, and the two agree']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A capstone does not pass because it works. It passes when the report shows you know why it works, where it fails, how you measured it, and what you would not trust it with. A working system with no error analysis and no stated limitations is an incomplete capstone, however impressive the demonstration.'
        },
        {
          kind: 'text',
          text: 'If it comes back for revision, the previous attempt is kept. Improvement between attempts is itself part of the record, and nobody is penalised for a first version that was honest about its faults.'
        },
        {
          kind: 'lab',
          appId: 'problem-workspace',
          title: 'Work it through here',
          does: 'Keep the problem statement, the criteria, the experiments and the evaluation set together, so the report can be written from a record rather than from memory.'
        },
        { kind: 'check', questionId: 'p6q1' },
        { kind: 'check', questionId: 'p6q2' },
        { kind: 'check', questionId: 'p6q3' }
      ],
      questions: [
        {
          id: 'p6q1',
          kind: 'choice',
          concept: 'ai-system',
          prompt: 'Your capstone works well on everything you tried. What does the report still need?',
          difficulty: 'expert',
          options: [
            'Nothing — it works',
            'The cases it fails on, found by deliberately looking: out of scope, adversarial, unusual input, and the groups it serves worst',
            'A longer description of the architecture',
            'More training data'
          ],
          answer: 1,
          explanation:
            'A system with no known failures is a system that has not been tested hard enough. Finding and reporting the failure cases is the work; "it worked on everything I tried" describes the effort put into trying.',
          hints: ['What did you not try?']
        },
        {
          id: 'p6q2',
          kind: 'choice',
          concept: 'eval-pipeline',
          prompt: 'Why must the success criteria be written before building?',
          difficulty: 'expert',
          options: [
            'For documentation',
            'Because criteria written afterwards are chosen to fit the result — the evaluation stops being a test and becomes a description',
            'Because the course requires it',
            'To estimate how long it will take'
          ],
          answer: 1,
          explanation:
            'Criteria chosen after seeing results cannot fail. Writing them first is what makes the evaluation capable of saying no, which is the only thing that makes it worth running.',
          hints: ['What could a criterion written afterwards never do?']
        },
        {
          id: 'p6q3',
          kind: 'short',
          concept: 'ai-safety',
          prompt: 'What must the report say about the system behaviour when it is out of its depth?',
          difficulty: 'expert',
          answer: 'what it does: refuse, hand to a person, fall back, or proceed - stated as a deliberate choice',
          accepts: [
            'what it does when uncertain',
            'how it fails safe',
            'whether it refuses or escalates',
            'the defined behaviour when it cannot answer'
          ],
          explanation:
            'A defined, deliberate behaviour: refuse, escalate, fall back to something simpler, or proceed. Proceeding on a confident guess is a legitimate choice and must be a choice somebody made rather than what happens by default.',
          hints: ['There are four options, and one of them is the default if you do not decide.']
        }
      ]
    }
  ]
}
