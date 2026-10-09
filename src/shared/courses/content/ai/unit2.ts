import type { Module } from '../../types.ts'

/**
 * Unit 02 — Data.
 *
 * The unit most courses rush. It is placed second, before any modelling, because every later failure in this
 * course traces back to something in it: a leak, an imbalance, a feature scaled wrong, a split that was not
 * really a split. A learner who can model but cannot inspect data produces confident nonsense.
 *
 * The three splits are taught here rather than in the modelling unit on purpose. Splitting is not a modelling
 * decision; it is the first thing you do to a dataset, before you have looked at it closely enough to cheat.
 */
export const AI_UNIT_2: Module = {
  id: 'u2',
  title: 'Data: The Foundation',
  summary:
    'What a dataset is, what a feature is, the three splits and why they exist, every way data is dirty, and how a table of anything becomes the vectors a model actually reads.',
  concepts: [
    'dataset',
    'features',
    'labels',
    'feature-types',
    'splits',
    'data-quality',
    'imbalance',
    'sampling-bias',
    'leakage',
    'cleaning',
    'vectors',
    'encoding',
    'scaling',
    'dimensionality'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u2l1',
      title: 'Datasets, features and labels',
      intro:
        'A table, and three words about it that have to be exact: sample, feature, label. The first real decision in any project is what one row means.',
      objectives: [
        'Identify samples, features and labels in a dataset',
        'Say what one row has to mean for a dataset to be usable',
        'Name the kinds of feature and what each needs doing to it'
      ],
      concepts: ['dataset', 'features', 'labels', 'feature-types'],
      requires: ['ai-vocabulary'],
      minutes: 13,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'The simplest dataset is a table. Each row is one **sample** — one of the things you are learning about. Each column is one **feature** — one thing known about that sample. If the dataset is for supervised learning, one column is special: the **label**, the answer you want the model to produce.'
        },
        {
          kind: 'table',
          headers: ['area', 'bedrooms', 'postcode', 'has_garden', 'price (label)'],
          rows: [
            ['50', '1', 'SW1', 'no', '150,000'],
            ['80', '2', 'SW1', 'yes', '240,000'],
            ['120', '3', 'E14', 'yes', '330,000'],
            ['65', '2', 'E14', 'no', '195,000']
          ]
        },
        {
          kind: 'text',
          text: 'Four samples, four features, one label. The model will be given the four features and asked for the label. At inference time the label column does not exist — that is the entire point of training.'
        },
        { kind: 'heading', text: 'What one row has to mean' },
        {
          kind: 'text',
          text: 'This sounds trivial and is the most common place a project goes wrong. One row must be one instance of the thing you are predicting about, and the rows must be independent enough that moving one into the test set tells you something.'
        },
        {
          kind: 'example',
          title: 'A row that means the wrong thing',
          text: 'You want to predict whether a patient will be readmitted.\n\nOne row per *visit* — then a patient with twelve visits appears twelve times, nine of them in training and three in test. The model recognises the patient, not the pattern, and your test score is nonsense.\n\nOne row per *patient* — now the question is well posed, and the split actually separates people.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Write down what one row means before anything else, in words, and check that your splits respect it. This single sentence prevents a whole class of silent failure, and the lesson on leakage comes back to it.'
        },
        { kind: 'heading', text: 'Kinds of feature' },
        {
          kind: 'table',
          headers: ['Kind', 'Example', 'What it needs'],
          rows: [
            ['Numerical (continuous)', 'area 83.5, temperature 21.4', 'Usually scaling; watch for units'],
            ['Numerical (count)', 'bedrooms 3, visits 12', 'Often fine as-is'],
            ['Categorical (no order)', 'postcode, colour, country', 'Encoding that invents no order — see lesson 5'],
            ['Ordinal (ordered)', 'small/medium/large, pain 1–10', 'Encoding that keeps the order'],
            ['Binary', 'has_garden yes/no', '0 and 1'],
            ['Text', 'a review, a message', 'Tokenisation and embedding — Unit 09'],
            ['Image', 'a photograph', 'Pixels as numbers — Unit 08'],
            ['Audio', 'a recording', 'Usually a spectrogram, then treated like an image'],
            ['Time series', 'daily sales for two years', 'Splits must respect time — never shuffle']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The ordinal row is where people lose marks. "Small, medium, large" has an order, so 1, 2, 3 is reasonable. "London, Manchester, Leeds" has no order, and encoding it 1, 2, 3 tells the model that Manchester is between the other two — which is meaningless and which the model will nonetheless use.'
        },
        { kind: 'heading', text: 'Structured and unstructured' },
        {
          kind: 'text',
          text: '**Structured** data already has rows and columns: a spreadsheet, a database table. **Unstructured** data does not: free text, images, audio, video. The distinction matters because unstructured data needs a representation step before any model can touch it, and that step is where most of the engineering lives.'
        },
        {
          kind: 'text',
          text: '**Metadata** is data about the data: where it came from, when it was collected, how it was labelled, what was excluded. It is not a feature, and losing it is how a dataset becomes unusable two years later. "Which version of the labelling guidelines was this annotated under?" is a question somebody will eventually need answered.'
        },
        {
          kind: 'lab',
          appId: 'data-explorer',
          title: 'Look at a dataset before modelling it',
          does:
            'Open a dataset and work out, from the data alone, what one row means, which column is a label, and which features are categorical. Then look at the distribution of each one. Ten minutes here saves days later.'
        },
        { kind: 'check', questionId: 'u2l1q1' },
        { kind: 'check', questionId: 'u2l1q2' }
      ],
      questions: [
        {
          id: 'u2l1q1',
          kind: 'choice',
          concept: 'dataset',
          prompt:
            'You are predicting whether a customer will cancel their subscription. Your table has one row per monthly invoice. What is wrong?',
          difficulty: 'intermediate',
          options: [
            'Nothing — more rows is more data',
            'One row should be one customer; with one row per invoice the same customer appears in training and test, so the score measures recognition rather than prediction',
            'Invoices cannot be used as features',
            'The label will be missing'
          ],
          answer: 1,
          explanation:
            'A customer with 30 invoices is 30 rows, spread across your splits. The model learns that customer and your test score flatters it. One row per customer, with the invoice history summarised into features, poses the question you actually asked.',
          hints: ['Ask what one row means, then ask whether a split separates anything.']
        },
        {
          id: 'u2l1q2',
          kind: 'choice',
          concept: 'feature-types',
          prompt: 'Which encoding of a "city" column is defensible?',
          difficulty: 'beginner',
          options: [
            'London = 1, Manchester = 2, Leeds = 3, because it is compact',
            'One column per city, holding 0 or 1, because city has no natural order',
            'Alphabetical position, because that is a well-defined ordering',
            'Population, because it is a number'
          ],
          answer: 1,
          explanation:
            'City is categorical with no order. Numbering the cities tells a model that Manchester sits between London and Leeds, and a model that can use distance will use it. One column per city carries no false ordering. Population might be a useful *extra* feature, but it is not an encoding of identity.',
          hints: ['What would the model be entitled to conclude from 1, 2 and 3?']
        },
        {
          id: 'u2l1q3',
          kind: 'short',
          concept: 'dataset',
          prompt: 'What is the first thing to write down about a new dataset, before any modelling?',
          difficulty: 'beginner',
          answer: 'what one row means',
          accepts: ['what a row represents', 'what one sample is', 'the meaning of a row', 'what one example is'],
          explanation:
            'One sentence saying what one row is an instance of. Everything downstream — the splits, the label, whether the question is even well posed — depends on it, and it is almost never written down.',
          hints: ['It is a sentence about rows.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u2l2',
      title: 'Training, validation and test',
      intro:
        'Three sets, three different jobs, and the rule that the third one is touched once. This is the most important procedural lesson in the course.',
      objectives: [
        'Say what each of the three splits is for',
        'Explain why validation and test cannot be the same set',
        'Split a dataset correctly when rows are grouped or ordered in time'
      ],
      concepts: ['splits', 'generalisation'],
      requires: ['dataset', 'generalisation'],
      minutes: 14,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Unit 01 ended on the trap: training minimises loss on the training examples, and that number says nothing about unseen data. The fix is procedural, and it is the first thing done to any dataset.'
        },
        {
          kind: 'table',
          headers: ['Set', 'Typical share', 'What it is for', 'How often you look'],
          rows: [
            ['Training', '60–80%', 'Setting the parameters', 'Constantly — this is what training reads'],
            ['Validation', '10–20%', 'Choosing between models and settings', 'Often, as you work'],
            ['Test', '10–20%', 'One honest estimate of real performance', 'Once, at the end']
          ]
        },
        { kind: 'heading', text: 'Why validation and test have to be different' },
        {
          kind: 'text',
          text: 'Suppose you have only two sets. You try thirty models and keep whichever scored best on the held-out set. That score is now optimistic, and not by a small amount: with enough attempts, you will find a model that happens to suit that particular held-out set. You did not train *parameters* on it, but you selected on it — and selection is a form of fitting.'
        },
        {
          kind: 'text',
          text: 'The validation set absorbs that. It exists to be selected on, and its score is expected to be flattering. The test set is kept untouched so that one number at the end means what it says.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Look at the test set, change something, and look again, and it has quietly become a validation set. There is no way to undo this — the only repair is a fresh test set. Treat the test score as a thing you are allowed to compute once, and write down the date you computed it.'
        },
        { kind: 'heading', text: 'Random splitting is not always right' },
        {
          kind: 'list',
          items: [
            '**Grouped data** — several rows belonging to one patient, customer or document. Split by *group*, so all of one group lands in one set. Otherwise the model recognises the group.',
            '**Time series** — train on the past, test on the future, always. A random split lets the model see Thursday while predicting Wednesday, which it will never be able to do in production.',
            '**Rare classes** — stratify, so each split contains a proportionate share of the rare class. A random split can put every positive case in training.',
            '**Near-duplicates** — the same photograph twice, the same article syndicated. Deduplicate before splitting, or the "unseen" test data was seen.'
          ]
        },
        {
          kind: 'example',
          title: 'Time-series splitting, done properly',
          text: 'Two years of daily sales, predicting tomorrow.\n\nWrong: shuffle all 730 days, take 20% at random for test.\nRight: train on months 1–20, validate on 21–22, test on 23–24.\n\nThe wrong version will score beautifully and fail in production, because at test time it was allowed to interpolate between days it had already seen.'
        },
        { kind: 'heading', text: 'How big should the splits be?' },
        {
          kind: 'text',
          text: 'Large enough that the score means something. A test set of 50 rows gives an estimate so noisy that two models differing by five percentage points cannot be distinguished. With very little data, cross-validation (Unit 04) uses every row for validation in turn — but even then, keep a final test set aside if you possibly can.'
        },
        { kind: 'check', questionId: 'u2l2q1' },
        { kind: 'check', questionId: 'u2l2q2' },
        { kind: 'check', questionId: 'u2l2q3' }
      ],
      questions: [
        {
          id: 'u2l2q1',
          kind: 'choice',
          concept: 'splits',
          prompt: 'Why is a test score unreliable if you used the same set to choose between models?',
          difficulty: 'intermediate',
          options: [
            'Because the model trained on it',
            'Because choosing the best of many attempts on one set finds a model that suits that set — selection is a form of fitting, even without touching parameters',
            'Because test sets are smaller than training sets',
            'It is not unreliable; selecting on it is normal'
          ],
          answer: 1,
          explanation:
            'Try enough candidates and one of them will fit the quirks of that particular set. No parameters were trained on it, but your choice was — so the score reflects the choice as much as the model. That is what a separate validation set is for.',
          hints: ['What did you use the scores for, and how many times?']
        },
        {
          id: 'u2l2q2',
          kind: 'choice',
          concept: 'splits',
          prompt:
            'A dataset holds 10,000 X-rays from 1,200 patients, several images each. How should it be split?',
          difficulty: 'intermediate',
          options: [
            'Randomly by image, since every image is a separate example',
            'By patient, so no patient has images in two different sets',
            'By date the image was taken',
            'It does not matter with this many images'
          ],
          answer: 1,
          explanation:
            'Split by patient. Two X-rays of the same person are not independent — a model can recognise the individual, and with images of one patient on both sides of the split the test score measures that recognition. This exact mistake has reached published papers.',
          hints: ['Which rows are not independent of one another?']
        },
        {
          id: 'u2l2q3',
          kind: 'true-false',
          concept: 'splits',
          prompt: 'For a model predicting tomorrow demand, a random split of historical days is acceptable.',
          difficulty: 'beginner',
          answer: false,
          explanation:
            'Never for time series. A random split lets the model train on days after the ones it is tested on, so it interpolates rather than forecasts. Train on earlier periods, test on later ones — the shape of the real task.',
          hints: ['At prediction time, which days does the model genuinely have access to?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u2l3',
      title: 'Every way data is dirty',
      intro:
        'Missing values, duplicates, wrong types, outliers, noise, imbalance, bias. Each one has a specific consequence, and knowing which consequence is how you decide what to do.',
      objectives: [
        'Recognise the common data faults and say what each one does to a model',
        'Explain why class imbalance makes accuracy meaningless',
        'Explain how sampling bias produces a model that works in testing and fails in use'
      ],
      concepts: ['data-quality', 'imbalance', 'sampling-bias', 'cleaning'],
      requires: ['dataset'],
      minutes: 15,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Real data is never clean. The job is not to reach perfection; it is to know what is wrong, decide what to do about each thing, and write the decision down.'
        },
        { kind: 'heading', text: 'Missing values' },
        {
          kind: 'text',
          text: 'A blank cell. The question that decides what to do is **why** it is blank, and the answer is often the most informative thing in the dataset.'
        },
        {
          kind: 'list',
          items: [
            '**Missing at random** — a sensor dropped a reading. Filling it with the column mean or median is usually acceptable.',
            '**Missing for a reason** — income is blank because the applicant declined to say. That blankness is a signal. Fill it and you destroy information; a flag column saying "was missing" keeps it.',
            '**Missing because it does not apply** — "date of last claim" for somebody who has never claimed. Not missing at all; the data model is wrong.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Never fill missing values using statistics computed over the whole dataset before splitting. The mean of the training set is fine; the mean of everything includes the test set, and that is a leak. The next lesson is about exactly this.'
        },
        { kind: 'heading', text: 'Duplicates' },
        {
          kind: 'text',
          text: 'The same sample twice. It weights that example double in training, and if the copies land on either side of a split, the "unseen" test data was seen. Near-duplicates are worse because they survive a simple deduplication: the same article with a different headline, the same photograph resized.'
        },
        { kind: 'heading', text: 'Wrong types and inconsistent values' },
        {
          kind: 'example',
          title: 'One column, five problems',
          text: 'country: "UK", "U.K.", "uk", "United Kingdom", "GB", "", "Unitd Kingdom"\n\nSeven values, one country. A model treats them as seven unrelated categories, each with a fraction of the data, and learns almost nothing from any of them.'
        },
        { kind: 'heading', text: 'Outliers' },
        {
          kind: 'text',
          text: 'A value far from the rest. The important distinction: is it an **error** or is it **real**? A house priced at 1 is probably a data-entry fault. A house priced at fifty million is probably a real mansion. Deleting the first is cleaning; deleting the second is deciding your model does not have to work on expensive houses — a legitimate decision, but a decision, and one to record.'
        },
        { kind: 'heading', text: 'Class imbalance' },
        {
          kind: 'text',
          text: 'In fraud detection, perhaps 0.2% of transactions are fraudulent. A model that answers "not fraud" to everything is **99.8% accurate** and completely useless. It will never flag a single fraud.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is why accuracy is nearly worthless as a headline number, and why Unit 03 spends a whole lesson on precision and recall. When you are told "99% accurate", the first question is what the base rate is.'
        },
        {
          kind: 'text',
          text: 'What helps: measuring with precision, recall and the confusion matrix instead of accuracy; stratified splits so the rare class is present everywhere; and sometimes resampling — though resampling must happen *inside* the training fold, never before the split.'
        },
        { kind: 'heading', text: 'Sampling bias' },
        {
          kind: 'text',
          text: 'The most expensive fault, because nothing in the data reveals it. Your dataset does not represent the population the model will meet. Every split is drawn from the same biased sample, so training, validation and test all agree — and all three are wrong together.'
        },
        {
          kind: 'list',
          items: [
            'A hiring model trained on people the company hired, which excludes everybody it rejected and everybody who never applied.',
            'A skin-condition classifier trained mostly on light skin, deployed everywhere.',
            'A speech model trained on recordings from a quiet studio, used on a phone in a street.',
            'A demand forecast trained on two years that happened to contain no recession.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The only defence is to describe, in writing, how the data was collected and who or what could not appear in it. No metric will tell you. Unit 13 returns to this as a fairness question, which is what it becomes once the system is in use.'
        },
        {
          kind: 'lab',
          appId: 'statistics-lab',
          title: 'Find the faults yourself',
          does:
            'Load a column and look at its distribution, its extremes and its gaps. Decide for each oddity whether it is an error or a real value — and notice how often the data alone cannot tell you.'
        },
        { kind: 'check', questionId: 'u2l3q1' },
        { kind: 'check', questionId: 'u2l3q2' },
        { kind: 'check', questionId: 'u2l3q3' }
      ],
      questions: [
        {
          id: 'u2l3q1',
          kind: 'choice',
          concept: 'imbalance',
          prompt: 'A disease affects 1 in 500 people. A model always answers "healthy". What is its accuracy, and what is it worth?',
          difficulty: 'beginner',
          options: [
            '50% accurate, and useless',
            '99.8% accurate, and useless — it never identifies a single case',
            '0% accurate, because it never finds the disease',
            'Accuracy cannot be computed for this model'
          ],
          answer: 1,
          explanation:
            '499 of every 500 answers are right, so accuracy is 99.8%. Recall on the class anybody cares about is zero. This is the standard demonstration that accuracy on imbalanced data is not a measure of usefulness.',
          hints: ['Count how many of its answers are correct, then ask which answers mattered.']
        },
        {
          id: 'u2l3q2',
          kind: 'choice',
          concept: 'sampling-bias',
          prompt:
            'A hiring model is trained on ten years of hires and scores 94% on its held-out test set. Why might it still be unfit?',
          difficulty: 'intermediate',
          options: [
            '94% is simply not high enough',
            'The test set comes from the same biased sample as the training set, so both share the bias and agree with each other — and the data contains nobody the company rejected or who never applied',
            'Ten years is too much data',
            'Hiring decisions cannot be modelled'
          ],
          answer: 1,
          explanation:
            'Sampling bias is invisible to every internal metric, because every split inherits it. The data records who was hired, which encodes past decisions and excludes everybody else. The only way to find this is to describe how the data came about.',
          hints: ['Where did the test set come from, and who is missing from it?']
        },
        {
          id: 'u2l3q3',
          kind: 'multi',
          concept: 'data-quality',
          prompt: 'Which of these are faults that deduplication alone will not fix? Choose all that apply.',
          difficulty: 'intermediate',
          options: [
            'The same article appearing with two different headlines',
            'A country column with "UK", "U.K." and "United Kingdom"',
            'Two byte-identical rows',
            'Income missing for applicants who declined to answer'
          ],
          answer: [0, 1, 3],
          explanation:
            'Byte-identical rows are exactly what deduplication removes. Near-duplicates survive it, inconsistent categories are a different kind of fault entirely, and informative missingness needs a decision rather than a removal.',
          hints: ['Which one of these is the easy case?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u2l4',
      title: 'Leakage: the fault that makes everything look brilliant',
      intro:
        'When information from the answer gets into the inputs, every score becomes a lie — a flattering one, which is why leakage survives review.',
      objectives: [
        'Define leakage and name its common forms',
        'Spot leakage in a described setup',
        'Explain why a suspiciously good score deserves investigation rather than celebration'
      ],
      concepts: ['leakage'],
      requires: ['splits'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Leakage** is when a model has access, at training time, to information it will not have in production — usually information about the answer. The symptom is a score that is too good, and the reason it survives so often is that nobody investigates good news.'
        },
        { kind: 'heading', text: 'The classic form: a feature that contains the answer' },
        {
          kind: 'example',
          title: 'Predicting whether a customer will cancel',
          text: 'Features include `cancellation_reason_code`, blank for customers who have not cancelled.\n\nThe model learns: if that column is filled in, they cancelled. Accuracy 99.9%. In production the column is always blank at prediction time, because it is filled in *after* the thing you are predicting. The model is worthless, and the test set agreed it was perfect.'
        },
        {
          kind: 'text',
          text: 'The general version: any feature recorded at or after the moment the label became known. Ask of every feature: **would this value be available, with this content, at the moment I need the prediction?** If the honest answer is no, it cannot be a feature.'
        },
        { kind: 'heading', text: 'The subtle form: preprocessing before splitting' },
        {
          kind: 'text',
          text: 'You scale every feature to mean zero using the mean of the whole dataset, then split. The training rows have now been adjusted using statistics that include the test rows. Nothing looks wrong, and a little information about the test set has entered the model.'
        },
        {
          kind: 'list',
          items: [
            'Compute the mean, standard deviation, minimum and maximum **on the training set only**, then apply those same numbers to validation and test.',
            'Fit the encoder for categorical features on the training set only. A category that appears only in test should be handled as unseen, which is what happens in production.',
            'Choose features — and select which features matter — using training data only.',
            'Resample or balance classes inside the training fold, never before the split.'
          ]
        },
        { kind: 'heading', text: 'Group leakage and time leakage' },
        {
          kind: 'text',
          text: 'Covered in the splits lesson and worth stating as leakage: the same patient on both sides of a split leaks identity, and training on later data than you test on leaks the future. Both produce excellent scores and useless models.'
        },
        { kind: 'heading', text: 'Duplicate leakage' },
        {
          kind: 'text',
          text: 'If the same example exists twice and the copies straddle the split, the model has literally seen the test item. With scraped text and images this is the norm rather than the exception, and it is why deduplication happens before splitting.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The rule to carry out of this lesson: **an unexpectedly good result is a bug report**. 99% on a hard problem means find the leak. Treat it with the suspicion you would give an unexpectedly bad one, and you will catch most leakage before it reaches anybody else.'
        },
        { kind: 'heading', text: 'How to find a leak you suspect' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Train a deliberately simple model. If it also scores 99%, the signal is not subtle — something is giving the answer away.',
            'Look at which features the model relies on most. A leak usually dominates.',
            'Drop the suspect feature and retrain. A collapse from 99% to 70% identifies the leak.',
            'Re-read when every feature is recorded, against when the prediction is needed.',
            'Check for duplicates across the split boundary.'
          ]
        },
        { kind: 'check', questionId: 'u2l4q1' },
        { kind: 'check', questionId: 'u2l4q2' },
        { kind: 'check', questionId: 'u2l4q3' }
      ],
      questions: [
        {
          id: 'u2l4q1',
          kind: 'choice',
          concept: 'leakage',
          prompt:
            'Predicting which patients will be readmitted, the dataset includes `discharge_summary_length`. Is this leakage?',
          difficulty: 'advanced',
          options: [
            'No — it is just a number about a document',
            'Possibly: it depends entirely on whether that summary was written before or after the readmission decision, and on whether it describes the outcome',
            'Yes, always, because it mentions discharge',
            'No, because text length carries no information'
          ],
          answer: 1,
          explanation:
            'The right answer is "it depends, and here is what on". A summary written at discharge is legitimate. One amended after a readmission describes the outcome. The test is always timing relative to the label, not whether the name sounds suspicious.',
          hints: ['Apply the availability question: when is this value recorded, with this content?']
        },
        {
          id: 'u2l4q2',
          kind: 'choice',
          concept: 'leakage',
          prompt: 'You scale all features to mean zero and unit variance, then split into train and test. What is wrong?',
          difficulty: 'intermediate',
          options: [
            'Nothing — scaling is standard practice',
            'The scaling used statistics from the test rows, so information about the test set has entered the training data; fit the scaler on training only and apply it to the rest',
            'Scaling should never be used',
            'The test set should be scaled separately using its own statistics'
          ],
          answer: 1,
          explanation:
            'Order matters: split first, fit the scaler on training, then apply those fixed numbers to validation and test. The last option is also wrong — scaling test data by its own statistics makes it inconsistent with what the model was trained on.',
          hints: ['Which rows contributed to the mean you subtracted?']
        },
        {
          id: 'u2l4q3',
          kind: 'short',
          concept: 'leakage',
          prompt: 'What is the one question to ask about every candidate feature?',
          difficulty: 'intermediate',
          answer: 'would this value be available, with this content, at the moment the prediction is needed',
          accepts: [
            'is it available at prediction time',
            'would i have it when predicting',
            'is this known before the label',
            'available at inference time'
          ],
          explanation:
            'Availability at prediction time, with the same content. It catches the cancellation-reason case, the amended-document case, and most of the rest — and it is a question about the process that produced the data, not about the data itself.',
          hints: ['It is about timing.']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'u2l5',
      title: 'Representation: turning anything into vectors',
      intro:
        'A model does arithmetic. Everything it reads is numbers — so the step where your table of words, categories and measurements becomes a list of numbers is a design decision, not a formality.',
      objectives: [
        'Explain why every input ends up as a vector',
        'Choose between one-hot and ordinal encoding, and say why',
        'Explain what scaling fixes, and which models need it',
        'Say what the curse of dimensionality actually is'
      ],
      concepts: ['vectors', 'encoding', 'scaling', 'dimensionality'],
      requires: ['features', 'feature-types'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Underneath every model is arithmetic on numbers. So one sample — a house, a patient, a sentence, a photograph — has to become a list of numbers. That list is a **feature vector**, and the choices you make in building it limit everything the model can learn.'
        },
        {
          kind: 'example',
          title: 'One house as a vector',
          text: 'area 80, bedrooms 2, postcode SW1, garden yes\n\n       ↓\n\n[80, 2, 1, 0, 1]\n  │   │  └──┘  └── garden: yes = 1\n  │   │    └───── postcode, one column per area: SW1 = [1, 0], E14 = [0, 1]\n  │   └────────── bedrooms\n  └────────────── area'
        },
        { kind: 'heading', text: 'Encoding categories' },
        {
          kind: 'table',
          headers: ['Method', 'How', 'Use when', 'Cost'],
          rows: [
            ['One-hot', 'One column per category, a single 1', 'No natural order, not too many categories', 'Columns explode with many categories'],
            ['Ordinal', 'One column, 1, 2, 3 in order', 'There is a genuine order', 'Wrong if there is not'],
            ['Target/frequency', 'Replace with a statistic of the category', 'Very many categories', 'Leaks easily — must be computed inside the training fold'],
            ['Embedding', 'A learned dense vector per category', 'Very many categories, enough data', 'Needs training; Unit 09']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'One-hot encoding a column with 30,000 categories — product ids, postcodes at full precision — produces 30,000 columns, almost all zero. That is where embeddings or frequency encoding earn their place.'
        },
        { kind: 'heading', text: 'Scaling, and why it is not cosmetic' },
        {
          kind: 'text',
          text: 'Consider two features: area in square metres (50–200) and number of bedrooms (1–5). To any method that measures distance, a difference of 40 square metres swamps a difference of 2 bedrooms — not because area matters more, but because its numbers are bigger. The units are making the modelling decision.'
        },
        {
          kind: 'list',
          items: [
            '**Normalisation (min–max)** — squash to the 0–1 range. Keeps the shape of the distribution; sensitive to outliers, since one extreme value compresses everything else.',
            '**Standardisation (z-score)** — subtract the mean, divide by the standard deviation. Centred on zero, spread of one; more robust to outliers than min–max.'
          ]
        },
        { kind: 'formula', latex: 'z = \\frac{x - \\mu}{\\sigma}', caption: 'Standardisation. x is the value, μ the mean and σ the standard deviation of that feature — both computed on the training set only, then applied unchanged to validation and test.' },
        {
          kind: 'table',
          headers: ['Model', 'Needs scaling?', 'Why'],
          rows: [
            ['k-nearest neighbours, k-means', 'Yes, essential', 'They are entirely about distance'],
            ['Neural networks', 'Yes', 'Unscaled inputs make gradients lopsided and training slow or unstable'],
            ['Linear/logistic regression with regularisation', 'Yes', 'The penalty treats all coefficients alike, so the scales must be alike'],
            ['Decision trees, random forests, gradient boosting', 'No', 'They split on thresholds one feature at a time; the units are irrelevant']
          ]
        },
        { kind: 'heading', text: 'Embeddings, in one paragraph' },
        {
          kind: 'text',
          text: 'One-hot vectors are long, sparse and say that every category is equally unlike every other — SW1 is exactly as far from SW2 as from a different continent. An **embedding** is a short dense vector *learned from data*, where nearness means similarity. The idea underlies modern language models and gets a full unit later; for now, the point is that representation can itself be learned rather than chosen.'
        },
        { kind: 'heading', text: 'Dimensionality, and its curse' },
        {
          kind: 'text',
          text: 'The **dimensionality** of your data is how many numbers describe one example. A table with 20 columns is 20-dimensional; a 100×100 colour image is 30,000-dimensional. High dimensionality causes a specific, counter-intuitive problem.'
        },
        {
          kind: 'text',
          text: 'In high dimensions, everything is far from everything else, and almost equally far. Distances concentrate: the nearest neighbour and the farthest neighbour end up at nearly the same distance, so "nearest" stops being meaningful. The volume to be covered grows exponentially with each added dimension, so the data you have becomes sparse in it — which is the real reason adding features eventually makes a model worse rather than better.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is why dimensionality reduction (Unit 05) and learned representations matter. They are not compression for its own sake; they are attempts to describe each example with fewer, more meaningful numbers so that distance means something again.'
        },
        {
          kind: 'lab',
          appId: 'algebra-lab',
          title: 'Vectors, distance and scale',
          does:
            'Build two vectors differing mainly in one large-scale feature and compute the distance. Then rescale and compute again. Watch which feature was deciding the answer before you rescaled.'
        },
        { kind: 'check', questionId: 'u2l5q1' },
        { kind: 'check', questionId: 'u2l5q2' },
        { kind: 'check', questionId: 'u2l5q3' }
      ],
      questions: [
        {
          id: 'u2l5q1',
          kind: 'multi',
          concept: 'scaling',
          prompt: 'Which models are materially affected by unscaled features? Choose all that apply.',
          difficulty: 'intermediate',
          options: ['k-nearest neighbours', 'Decision tree', 'Neural network', 'k-means clustering'],
          answer: [0, 2, 3],
          explanation:
            'Anything built on distance — k-NN and k-means — and neural networks, whose gradients become lopsided with mismatched scales. A decision tree splits one feature at a time on a threshold, so the units make no difference to it.',
          hints: ['Which of these never compares two features against each other?']
        },
        {
          id: 'u2l5q2',
          kind: 'choice',
          concept: 'encoding',
          prompt: 'A column holds 30,000 distinct product ids. Why is one-hot encoding a poor choice?',
          difficulty: 'intermediate',
          options: [
            'One-hot cannot represent more than 100 categories',
            'It produces 30,000 almost-entirely-zero columns, which is wasteful and gives the model nothing about how products relate',
            'It would impose a false ordering on the products',
            'It only works for binary features'
          ],
          answer: 1,
          explanation:
            'One-hot imposes no false ordering — that is its virtue — but at this scale it is enormous, sparse, and treats every product as equally unlike every other. An embedding or a frequency-based encoding carries relationships in far fewer numbers.',
          hints: ['Count the columns, then ask what any one of them tells the model.']
        },
        {
          id: 'u2l5q3',
          kind: 'choice',
          concept: 'dimensionality',
          prompt: 'What is the core problem with very high-dimensional data?',
          difficulty: 'advanced',
          options: [
            'Computers run out of memory',
            'Distances concentrate — everything becomes nearly equally far from everything else, so "nearest" loses meaning, and the data becomes sparse in a space growing exponentially',
            'Models cannot have more parameters than features',
            'High-dimensional data cannot be visualised'
          ],
          answer: 1,
          explanation:
            'Memory is an engineering cost, and difficulty of visualisation is an inconvenience. The real problem is geometric: in high dimensions distances concentrate and your data covers almost none of the space, so methods that rely on nearness stop working.',
          hints: ['Think about what happens to the gap between the nearest and farthest points.']
        }
      ]
    }
  ]
}
