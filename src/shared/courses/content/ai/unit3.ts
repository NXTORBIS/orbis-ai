import type { Module } from '../../types.ts'

/**
 * Unit 03 — Machine learning fundamentals.
 *
 * The workflow, then supervised learning done properly: regression with residuals and the two metrics, then
 * classification with the confusion matrix and the threshold. The threshold lesson is the one that changes how
 * people think — a classifier is a probability and a decision, and almost every argument about model quality is
 * really an argument about where the cut should be.
 */
export const AI_UNIT_3: Module = {
  id: 'u3',
  title: 'Machine Learning Fundamentals',
  summary:
    'The whole workflow end to end, then supervised learning in detail: regression, residuals, metrics, classification, decision boundaries, probabilities, thresholds and the confusion matrix.',
  concepts: [
    'ml-definition',
    'ml-workflow',
    'training-inference',
    'hyperparameters',
    'supervised',
    'regression',
    'linear-regression',
    'residuals',
    'regression-metrics',
    'classification',
    'decision-boundary',
    'probabilities',
    'threshold',
    'confusion-matrix',
    'precision-recall',
    'f1'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u3l1',
      title: 'The workflow, end to end',
      intro:
        'Nine stages, in order, with the honest note that modelling is the small one. Knowing the shape of the whole job is what stops somebody spending three weeks tuning a model built on a broken split.',
      objectives: [
        'List the stages of a machine-learning project in order',
        'Say which stages take the most effort in practice',
        'Explain what deployment and monitoring are for'
      ],
      concepts: ['ml-definition', 'ml-workflow', 'training-inference', 'hyperparameters'],
      requires: ['splits', 'learning-from-examples'],
      minutes: 13,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Machine learning** is fitting a model to data instead of writing the rule by hand. A project doing it has a shape, and the shape is worth knowing before any of the parts.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Frame the problem** — what is being predicted, from what, and what a good answer is worth. Skipped constantly; the most expensive omission on the list.',
            '**Collect data** — and record how. This is where sampling bias is decided.',
            '**Split** — training, validation, test, before looking closely. Unit 02.',
            '**Prepare** — clean, handle missing values, encode, scale. Fitted on training only.',
            '**Feature engineering** — build the features that make the pattern visible.',
            '**Choose a model** — start simple, so you have something to beat.',
            '**Train** — set the parameters on the training set.',
            '**Validate and tune** — compare candidates and settings on the validation set.',
            '**Test** — once.',
            '**Deploy** — put it where it will be used, with the same preparation steps.',
            '**Monitor** — watch what it actually does, and notice when the world moves.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Training is one line of code and a fraction of the effort. Framing, collecting, cleaning and evaluating are the job. Any course that spends its time on model choice is teaching the easy part.'
        },
        { kind: 'heading', text: 'Parameters and hyperparameters' },
        {
          kind: 'table',
          headers: ['', 'Parameters', 'Hyperparameters'],
          rows: [
            ['Who sets them', 'Training', 'You'],
            ['When', 'During training', 'Before training'],
            ['Examples', 'The slope and intercept of a line; every weight in a network', 'Learning rate, tree depth, number of layers, k in k-means'],
            ['Chosen using', 'The training set', 'The validation set'],
            ['How many', 'From two to hundreds of billions', 'Typically a handful']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Hyperparameters are chosen on the **validation** set. Tune them against the test set and the test score stops being an estimate of anything.'
        },
        { kind: 'heading', text: 'Why start simple' },
        {
          kind: 'text',
          text: 'A model you can explain, that trains in a second, gives you a number to beat and a sanity check. If a linear model reaches 0.82 and your neural network reaches 0.83, you have learned that the problem is mostly linear and the network is not worth its cost. If the simple model reaches 0.99, look for a leak.'
        },
        { kind: 'heading', text: 'Deployment and monitoring' },
        {
          kind: 'text',
          text: 'Deployment is where the preparation steps have to be reproduced exactly: the same encoding, the same scaling numbers, the same column order. A mismatch between training-time and serving-time preparation is one of the most common production faults, and it fails silently — the model still returns a number, just the wrong one.'
        },
        {
          kind: 'text',
          text: 'Monitoring exists because the world moves. Prices change, behaviour changes, a competitor arrives, a form field is renamed upstream. The model is frozen; its inputs are not. Watch the distribution of incoming features and the distribution of predictions, and compare them with training. Unit 12 builds this properly.'
        },
        { kind: 'check', questionId: 'u3l1q1' },
        { kind: 'check', questionId: 'u3l1q2' }
      ],
      questions: [
        {
          id: 'u3l1q1',
          kind: 'choice',
          concept: 'hyperparameters',
          prompt: 'Which of these is a hyperparameter?',
          difficulty: 'beginner',
          options: [
            'The weight connecting two neurons',
            'The learning rate',
            'The intercept of a fitted line',
            'The predicted probability for a given input'
          ],
          answer: 1,
          explanation:
            'The learning rate is a setting you choose before training. Weights and intercepts are parameters, set by training. A predicted probability is an output, not a setting at all.',
          hints: ['Which one do you have to pick before training can start?']
        },
        {
          id: 'u3l1q2',
          kind: 'choice',
          concept: 'ml-workflow',
          prompt: 'A model scores well in testing and badly in production, with no change in the data itself. What is the most likely cause?',
          difficulty: 'intermediate',
          options: [
            'The model was not trained long enough',
            'The preparation applied at serving time differs from the preparation used in training — a different encoding, different scaling numbers or a different column order',
            'Production hardware is slower',
            'The test set was too large'
          ],
          answer: 1,
          explanation:
            'Training-serving mismatch. The same raw input has to become the same vector in both places, which means the same encoder and the same scaling numbers. It fails quietly, because the model still returns a confident answer.',
          hints: ['What happens between the raw input and the model, in each of the two places?']
        },
        {
          id: 'u3l1q3',
          kind: 'short',
          concept: 'ml-workflow',
          prompt: 'Why start a project with a model simpler than the one you intend to use?',
          difficulty: 'beginner',
          answer: 'to get a baseline to beat, and a check that the setup is sound',
          accepts: ['baseline', 'to have something to compare against', 'a number to beat', 'to check the pipeline'],
          explanation:
            'It gives you a baseline, and it tests the whole pipeline cheaply. A simple model scoring suspiciously well is also the fastest leak detector you have.',
          hints: ['What do you not have until you have measured something?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u3l2',
      title: 'Supervised learning and regression',
      intro:
        'The most common setup in applied machine learning: inputs, known answers, and a model fitted to the mapping. Starting with the case where the answer is a number.',
      objectives: [
        'Define supervised learning and distinguish regression from classification',
        'Explain what linear regression fits and what "best fit" means',
        'Read residuals, and say what a pattern in them indicates'
      ],
      concepts: ['supervised', 'regression', 'linear-regression', 'residuals'],
      requires: ['labels', 'ml-definition'],
      minutes: 15,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Supervised learning**: you have examples where the answer is known, and you fit a model to the mapping from input to answer. The supervision is the labels — somebody, at some point, wrote down the right answer for these examples.'
        },
        {
          kind: 'table',
          headers: ['The label is', 'The task is', 'Examples'],
          rows: [
            ['A number', 'Regression', 'Price, temperature, time remaining, demand'],
            ['One of two classes', 'Binary classification', 'Spam or not, fraud or not, will cancel or not'],
            ['One of several classes', 'Multiclass classification', 'Which of ten digits, which of 200 species'],
            ['Several labels at once', 'Multilabel classification', 'Tags on an article; several conditions on one X-ray']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Multiclass and multilabel are often confused. Multiclass: exactly one answer, chosen from many. Multilabel: any number of answers, each independently true or false. An article is about politics *and* economics; a photograph is of exactly one digit.'
        },
        { kind: 'heading', text: 'Linear regression' },
        {
          kind: 'text',
          text: 'Fit a straight line (or a flat plane, with several features) through the data. With one input it is the model from Unit 01: `prediction = a × x + b`. With several, each feature gets its own coefficient.'
        },
        { kind: 'formula', latex: '\\hat{y} = w_1 x_1 + w_2 x_2 + \\cdots + w_n x_n + b', caption: 'ŷ (y-hat) is the prediction, x the features, w the weights and b the bias. Each weight says how much the prediction moves when that feature goes up by one — holding the others fixed.' },
        {
          kind: 'text',
          text: '"Best fit" means the line minimising the chosen loss, and for linear regression that is almost always mean squared error. For a straight line there is a formula that gives the exact answer in one step, which is why linear regression is instant and deterministic — a rare and pleasant property.'
        },
        { kind: 'heading', text: 'Interpreting coefficients, carefully' },
        {
          kind: 'text',
          text: 'A weight of 3,000 on `area` means: each additional square metre is associated with 3,000 more in price, holding the other features constant. Three warnings come with that sentence. The weight depends on the units. Association is not causation — adding a square metre of floor space does not cause the price to rise by 3,000. And if two features move together, the model can split the credit between them almost arbitrarily.'
        },
        { kind: 'heading', text: 'Residuals' },
        {
          kind: 'text',
          text: 'A **residual** is the gap for one example: what actually happened minus what the model said. Residuals are more informative than any single score, because a *pattern* in them tells you what the model is missing.'
        },
        {
          kind: 'table',
          headers: ['Residuals look like', 'What it means', 'What to do'],
          rows: [
            ['Random scatter about zero', 'The model has captured the pattern available in these features', 'Nothing — this is the good case'],
            ['A curve', 'The relationship is not straight', 'Add a non-linear term, or use a model that can bend'],
            ['Fanning out as predictions grow', 'Error grows with size', 'Consider predicting the logarithm instead'],
            ['One group always under-predicted', 'A missing feature identifies that group', 'Find and add the feature'],
            ['A few enormous residuals', 'Outliers, or a different regime', 'Investigate those rows individually']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Plot residuals against the prediction, every time. It takes one line and finds things no summary metric reveals. A model with an excellent score and a clear curve in its residuals is telling you exactly how to improve it.'
        },
        {
          kind: 'lab',
          appId: 'curve-fitter',
          title: 'Fit, then look at the residuals',
          does:
            'Fit a line to points that genuinely curve. The fit will look reasonable; the residuals will not. Then fit something that can bend and compare both the error and the residual pattern.'
        },
        { kind: 'check', questionId: 'u3l2q1' },
        { kind: 'check', questionId: 'u3l2q2' },
        { kind: 'check', questionId: 'u3l2q3' }
      ],
      questions: [
        {
          id: 'u3l2q1',
          kind: 'choice',
          concept: 'residuals',
          prompt: 'Your residuals form a clear U shape when plotted against the prediction. What does that tell you?',
          difficulty: 'intermediate',
          options: [
            'The model is overfitting',
            'The true relationship is curved and a straight line cannot represent it — the model is systematically wrong at both ends and in the middle',
            'There is too little data',
            'The labels are wrong'
          ],
          answer: 1,
          explanation:
            'A pattern in residuals means systematic error, which is underfitting rather than overfitting: the model cannot bend where the data bends. Add a non-linear term or change model family.',
          hints: ['Systematic means the same direction of error in the same places, every time.']
        },
        {
          id: 'u3l2q2',
          kind: 'choice',
          concept: 'supervised',
          prompt: 'An article can be tagged with any of politics, sport, economics and culture, possibly several. What task is this?',
          difficulty: 'beginner',
          options: ['Regression', 'Binary classification', 'Multiclass classification', 'Multilabel classification'],
          answer: 3,
          explanation:
            'Several labels can be true at once, so it is multilabel: four independent yes/no decisions rather than one choice among four.',
          hints: ['Can two of the answers be right simultaneously?']
        },
        {
          id: 'u3l2q3',
          kind: 'choice',
          concept: 'linear-regression',
          prompt: 'A fitted model has a weight of 3,000 on floor area. Which reading is correct?',
          difficulty: 'intermediate',
          options: [
            'Adding a square metre causes the price to rise by 3,000',
            'Each extra square metre is associated with 3,000 more in predicted price, holding the other features fixed — in these units, on this data',
            'Floor area is the most important feature',
            'The model is 3,000 units accurate'
          ],
          answer: 1,
          explanation:
            'Association, holding the rest fixed, in those units, on that data. It is not a causal claim, and it is not a statement of importance — a feature measured in smaller units gets a bigger coefficient for the same effect.',
          hints: ['Three qualifications belong in the sentence. Which option has them?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u3l3',
      title: 'Regression metrics: MSE and MAE',
      intro: 'Two ways to summarise how wrong a regression is, and they do not agree. Which you choose is a statement about what kind of mistake you can tolerate.',
      objectives: [
        'Compute MSE, RMSE and MAE',
        'Say what each metric punishes',
        'Choose a metric from the properties of the problem'
      ],
      concepts: ['regression-metrics'],
      requires: ['residuals'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Both metrics turn a list of residuals into one number. They disagree about what a bad mistake is, and the disagreement is the whole lesson.' },
        { kind: 'formula', latex: '\\text{MSE} = \\frac{1}{n}\\sum (y_i - \\hat{y}_i)^2 \\qquad \\text{MAE} = \\frac{1}{n}\\sum |y_i - \\hat{y}_i|', caption: 'Mean squared error squares each residual; mean absolute error takes its size without the sign. Both average over n examples.' },
        {
          kind: 'text',
          text: '**RMSE** is the square root of MSE, which puts the number back into the units of the thing you are predicting — pounds rather than pounds squared. It is the usual thing to report.'
        },
        { kind: 'heading', text: 'The disagreement, in numbers' },
        {
          kind: 'table',
          headers: ['Model', 'Residuals', 'MAE', 'MSE'],
          rows: [
            ['A', '10, 10, 10, 10', '10', '100'],
            ['B', '0, 0, 0, 40', '10', '400']
          ]
        },
        {
          kind: 'text',
          text: 'Identical MAE. MSE says A is four times better. Both are legitimate readings — they answer different questions. MAE asks "how far out is a typical prediction?". MSE asks "how bad is this, if large errors are disproportionately costly?".'
        },
        { kind: 'heading', text: 'Choosing' },
        {
          kind: 'table',
          headers: ['Use', 'When', 'Because'],
          rows: [
            ['MSE / RMSE', 'A large error is much worse than several small ones', 'Squaring punishes the large one heavily'],
            ['MSE / RMSE', 'You want the smooth mathematics', 'Differentiable everywhere, which optimisation likes'],
            ['MAE', 'All errors cost in proportion to their size', 'No extra weight on the extremes'],
            ['MAE', 'The data has outliers you do not want to chase', 'A single wild value will not dominate the fit'],
            ['Percentage error', 'Being out by 10 matters differently at 50 than at 50,000', 'Relative rather than absolute — but it explodes near zero']
          ]
        },
        {
          kind: 'example',
          title: 'A case where it decides the model',
          text: 'Predicting delivery time. Being 5 minutes late, often, is an annoyance. Being 3 hours late, once, loses the customer.\n\nMSE. The occasional disaster is what you are trying to avoid, and squaring is how you tell the optimiser that.\n\nNow predicting the number of items in a warehouse photograph, where a handful of images are corrupted and labelled nonsense. MAE — otherwise those few impossible rows dominate the fit and the model ends up wrong everywhere to be slightly less wrong on them.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A metric with no context is not a result. "RMSE 4,200" means nothing until somebody says what is being predicted and what the spread of the data is: 4,200 on house prices is good, on shoe sizes it is absurd. Always report alongside a baseline — the RMSE of simply predicting the mean every time.'
        },
        { kind: 'heading', text: 'R-squared, and its trap' },
        {
          kind: 'text',
          text: 'R² says what share of the variation in the label the model accounts for: 0 means no better than predicting the mean, 1 means perfect. It is useful because it is unitless and comparable. Its trap is that it never falls when you add a feature, even a random one — so a high R² on training data with many features is not evidence of anything.'
        },
        { kind: 'check', questionId: 'u3l3q1' },
        { kind: 'check', questionId: 'u3l3q2' }
      ],
      questions: [
        {
          id: 'u3l3q1',
          kind: 'number',
          concept: 'regression-metrics',
          prompt: 'Residuals are 3, -1, 0 and 4. What is the MAE?',
          difficulty: 'beginner',
          answer: 2,
          tolerance: 0.01,
          explanation: 'Sizes without sign: 3, 1, 0, 4. Sum 8, divided by 4 gives 2.',
          hints: ['Drop the signs, then take the mean.']
        },
        {
          id: 'u3l3q2',
          kind: 'choice',
          concept: 'regression-metrics',
          prompt:
            'Predicting ambulance arrival times. Five minutes late is unfortunate; forty minutes late is a catastrophe. Which metric should the model be trained against?',
          difficulty: 'intermediate',
          options: [
            'MAE, because it treats all errors in proportion',
            'MSE, because squaring makes the rare catastrophic error dominate, which is what you want the optimiser to avoid',
            'R², because it is unitless',
            'Accuracy, because the stakes are high'
          ],
          answer: 1,
          explanation:
            'The costs are not proportional to the error, so neither should the loss be. MSE makes a forty-minute error sixty-four times worse than a five-minute one, which is roughly the shape of the real cost. Accuracy is not a regression metric at all.',
          hints: ['Does the cost of an error grow in proportion to its size, or faster?']
        },
        {
          id: 'u3l3q3',
          kind: 'true-false',
          concept: 'regression-metrics',
          prompt: 'A higher R² on the training set always means a better model.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'R² on training data never falls when a feature is added, even a column of random numbers. It can be driven arbitrarily high by adding features, which is why it has to be read on held-out data and alongside a baseline.',
          hints: ['What happens to training R² when you add a useless feature?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u3l4',
      title: 'Classification, probabilities and thresholds',
      intro:
        'The lesson that changes how people argue about models. A classifier does not output a class; it outputs a probability, and somebody chose where to cut.',
      objectives: [
        'Explain what a decision boundary is',
        'Explain what a predicted probability is and what it is not',
        'Explain how moving the threshold changes which mistakes the system makes'
      ],
      concepts: ['classification', 'decision-boundary', 'probabilities', 'threshold'],
      requires: ['supervised'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Classification** predicts which class something belongs to. The model divides the space of possible inputs into regions, and the surface where the answer changes is the **decision boundary**.'
        },
        {
          kind: 'list',
          items: [
            'Logistic regression draws a straight boundary — a line in two dimensions, a plane in three.',
            'A decision tree draws boundaries parallel to the axes, in steps.',
            'A neural network can draw almost any shape, which is its strength and its risk.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'A boundary that wanders elaborately to collect every training point is the picture of overfitting. A boundary that is a straight line through plainly curved data is underfitting. Unit 04 makes this precise.'
        },
        { kind: 'heading', text: 'The output is a probability' },
        {
          kind: 'text',
          text: 'Most classifiers output a number between 0 and 1 for each class. Logistic regression computes a weighted sum like linear regression, then squashes it into that range with the logistic function.'
        },
        { kind: 'formula', latex: 'p = \\frac{1}{1 + e^{-(w \\cdot x + b)}}', caption: 'The logistic (sigmoid) function. w·x + b is the same weighted sum as linear regression; the function maps any real number into (0, 1), so the output can be read as a probability.' },
        {
          kind: 'text',
          text: 'That number is a *model estimate*, not a fact about the world. Whether 0.7 means "right about seventy per cent of such cases" is a separate property called calibration, and plenty of models — particularly deep networks — are systematically overconfident. Unit 04 covers it.'
        },
        { kind: 'heading', text: 'Then somebody chooses a threshold' },
        {
          kind: 'text',
          text: 'To act, the probability has to become a decision, and that needs a cut. 0.5 is a default, not a law, and it is very often the wrong one.'
        },
        {
          kind: 'table',
          headers: ['Threshold', 'Behaviour', 'Suits'],
          rows: [
            ['Low — 0.1', 'Flags almost anything suspicious: catches nearly every real case, with many false alarms', 'Screening for a serious disease, where a miss is far worse than a further test'],
            ['0.5', 'The default balance', 'When both mistakes cost roughly the same'],
            ['High — 0.9', 'Flags only near-certainties: few false alarms, more missed cases', 'Automatically blocking an account, where a wrong block is a serious harm']
          ]
        },
        {
          kind: 'example',
          title: 'One model, two systems',
          text: 'The same trained fraud model, two deployments.\n\nThreshold 0.05 → send to a human reviewer. Catches 95% of fraud; 90% of what it flags is innocent; a team reads them.\n\nThreshold 0.95 → block the transaction automatically. Blocks almost no innocent customers; misses most fraud.\n\nIdentical parameters. Completely different products — and the choice is a policy decision, not a modelling one.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'So "which model is better?" is usually the wrong question, and "which threshold, for which cost of each mistake?" is the right one. Models should be compared across all thresholds — which is what ROC and AUC in Unit 04 are for.'
        },
        {
          kind: 'lab',
          appId: 'learning-lab',
          title: 'Train a classifier and move the threshold',
          does:
            'Fit a classifier, then move the decision threshold and watch which examples change side. Find the threshold that catches almost every positive case, and look at the price you paid in false alarms.'
        },
        { kind: 'check', questionId: 'u3l4q1' },
        { kind: 'check', questionId: 'u3l4q2' }
      ],
      questions: [
        {
          id: 'u3l4q1',
          kind: 'choice',
          concept: 'threshold',
          prompt: 'Screening for an aggressive cancer, where a missed case may be fatal and a false alarm means one further test. Which threshold?',
          difficulty: 'intermediate',
          options: [
            'High, around 0.9, to avoid alarming people unnecessarily',
            'Low, around 0.1, because missing a real case is far more costly than an extra test',
            '0.5, because it is standard',
            'The threshold makes no difference to a screening system'
          ],
          answer: 1,
          explanation:
            'Set the threshold from the relative cost of the two mistakes. Here a miss is catastrophic and a false alarm is an inconvenience, so flag generously and let the follow-up test resolve it. That is exactly how real screening programmes are designed.',
          hints: ['Which of the two mistakes would you rather make?']
        },
        {
          id: 'u3l4q2',
          kind: 'true-false',
          concept: 'probabilities',
          prompt: 'If a classifier outputs 0.8, then 80% of inputs like that one are genuinely positive.',
          difficulty: 'advanced',
          answer: false,
          explanation:
            'Only if the model is calibrated, and many are not — deep networks are often badly overconfident. 0.8 is the model internal score mapped into a 0–1 range; whether it corresponds to a real frequency has to be measured.',
          hints: ['Is the number a measurement or an estimate from a model?']
        },
        {
          id: 'u3l4q3',
          kind: 'short',
          concept: 'decision-boundary',
          prompt: 'What is a decision boundary?',
          difficulty: 'beginner',
          answer: 'the surface in input space where the predicted class changes',
          accepts: [
            'where the prediction changes class',
            'the line separating classes',
            'the surface separating predicted classes',
            'where the model switches class'
          ],
          explanation:
            'The line, curve or surface where the model answer flips from one class to another. Its shape is what distinguishes model families, and its wobbliness is the visible signature of overfitting.',
          hints: ['It is where the answer changes.']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'u3l5',
      title: 'The confusion matrix, precision and recall',
      intro:
        'Four numbers, and every classification metric built out of them. This is the lesson to be fluent in — more arguments about AI quality turn on it than on anything else in the course.',
      objectives: [
        'Read a confusion matrix and name all four cells',
        'Compute precision, recall and F1 by hand',
        'Say which metric a given situation demands, and why'
      ],
      concepts: ['confusion-matrix', 'precision-recall', 'f1'],
      requires: ['threshold'],
      minutes: 17,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'For binary classification there are exactly four outcomes. Every metric worth knowing is arithmetic on these four counts.'
        },
        {
          kind: 'table',
          headers: ['', 'Model says yes', 'Model says no'],
          rows: [
            ['Really yes', 'True positive (TP)', 'False negative (FN) — a miss'],
            ['Really no', 'False positive (FP) — a false alarm', 'True negative (TN)']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The names decode mechanically: the second word is what the model said, the first is whether it was right. "False negative" = the model said no, and that was false. If you re-derive them that way you will never mix them up.'
        },
        { kind: 'heading', text: 'Precision and recall' },
        { kind: 'formula', latex: '\\text{precision} = \\frac{TP}{TP + FP} \\qquad \\text{recall} = \\frac{TP}{TP + FN}', caption: 'Precision: of everything flagged, how much was real. Recall: of everything real, how much was flagged. Note the denominators — one counts what the model said, the other counts what was true.' },
        {
          kind: 'list',
          items: [
            '**Precision** answers: when it raises the alarm, how often should I believe it?',
            '**Recall** answers: of everything I needed it to catch, how much did it catch?'
          ]
        },
        {
          kind: 'example',
          title: 'Worked through',
          text: '1,000 emails. 100 are spam.\n\nThe filter flags 90 messages. 80 of them really are spam.\n\nTP = 80   FP = 10   FN = 20   TN = 890\n\nprecision = 80 / 90 = 89%   — when it says spam, it is usually right\nrecall    = 80 / 100 = 80%  — it let 20 spam messages through\naccuracy  = 970 / 1000 = 97% — true, and the least informative of the three'
        },
        { kind: 'heading', text: 'They trade against each other' },
        {
          kind: 'text',
          text: 'Lower the threshold and you flag more: recall rises, precision falls. Raise it and the reverse. You cannot usually improve both by moving the threshold — improving both requires a better model.'
        },
        {
          kind: 'table',
          headers: ['Situation', 'Which matters more', 'Why'],
          rows: [
            ['Spam filter', 'Precision', 'A real email in the spam folder is worse than a spam email in the inbox'],
            ['Cancer screening', 'Recall', 'A missed case can be fatal; a false alarm means another test'],
            ['Automatically blocking payments', 'Precision', 'Blocking a legitimate customer is a serious harm'],
            ['Finding documents for a legal case', 'Recall', 'Missing a relevant document can lose the case'],
            ['Recommending a film', 'Precision', 'Nobody minds a film not being recommended; a bad recommendation costs trust']
          ]
        },
        { kind: 'heading', text: 'F1' },
        { kind: 'formula', latex: 'F_1 = 2 \\cdot \\frac{\\text{precision} \\cdot \\text{recall}}{\\text{precision} + \\text{recall}}', caption: 'The harmonic mean of precision and recall. Unlike an ordinary average it stays low when either one is low: precision 1.0 with recall 0.02 gives F1 ≈ 0.04, not 0.51.' },
        {
          kind: 'text',
          text: 'F1 is useful for comparing models when you have no strong view about which mistake is worse. It hides something important, though: two models with identical F1 can behave completely differently, one cautious and one generous. Report precision and recall alongside it.'
        },
        { kind: 'heading', text: 'Beyond two classes' },
        {
          kind: 'text',
          text: 'With several classes the matrix becomes a grid: rows for the truth, columns for the prediction, and the diagonal is what was right. The off-diagonal cells are the valuable part — they say *which* classes the model confuses, and that usually points straight at the fix. A digit classifier confusing 4 with 9 and nothing else is a different problem from one confusing everything with everything.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Precision and recall are computed per class, for the class you care about. "The model has 90% recall" on a multiclass problem is an incomplete sentence until you say recall of what — and averaging across classes can hide a class the model never gets right at all.'
        },
        { kind: 'check', questionId: 'u3l5q1' },
        { kind: 'check', questionId: 'u3l5q2' },
        { kind: 'check', questionId: 'u3l5q3' },
        { kind: 'check', questionId: 'u3l5q4' }
      ],
      questions: [
        {
          id: 'u3l5q1',
          kind: 'number',
          concept: 'precision-recall',
          prompt: 'TP = 30, FP = 10, FN = 20. What is the precision, as a percentage?',
          difficulty: 'intermediate',
          answer: 75,
          tolerance: 0.5,
          explanation: 'Precision = TP / (TP + FP) = 30 / 40 = 75%. The 20 false negatives do not appear — they belong to recall.',
          hints: ['Of everything the model flagged, how much was real?', 'Which of the three numbers is not part of precision?']
        },
        {
          id: 'u3l5q2',
          kind: 'number',
          concept: 'precision-recall',
          prompt: 'With the same counts — TP = 30, FP = 10, FN = 20 — what is the recall, as a percentage?',
          difficulty: 'intermediate',
          answer: 60,
          tolerance: 0.5,
          explanation: 'Recall = TP / (TP + FN) = 30 / 50 = 60%. There were 50 real positives and it found 30.',
          hints: ['Of everything that was really positive, how much did it catch?']
        },
        {
          id: 'u3l5q3',
          kind: 'choice',
          concept: 'precision-recall',
          prompt:
            'A system automatically suspends accounts it believes are fraudulent, with no human review. Which metric should be held highest?',
          difficulty: 'intermediate',
          options: [
            'Recall — catching every fraudster matters most',
            'Precision — a wrongly suspended legitimate customer is a serious harm, and nothing catches the mistake',
            'Accuracy — it balances both',
            'F1 — it is the standard choice'
          ],
          answer: 1,
          explanation:
            'The action is automatic and harmful when wrong, so false positives are the expensive mistake: precision. Note that the answer would flip if the system merely flagged accounts for a human to review — the same model, a different threshold, a different metric.',
          hints: ['Which mistake has a victim who cannot appeal to anybody?']
        },
        {
          id: 'u3l5q4',
          kind: 'choice',
          concept: 'f1',
          prompt: 'A model has precision 1.0 and recall 0.02. What is roughly its F1, and what does that say?',
          difficulty: 'advanced',
          options: [
            'About 0.51 — reasonable, since one number is perfect',
            'About 0.04 — poor, because the harmonic mean stays low when either part is low, and this model almost never flags anything',
            'About 1.0 — precision dominates',
            'F1 cannot be computed when recall is this low'
          ],
          answer: 1,
          explanation:
            '2 × (1 × 0.02) / 1.02 ≈ 0.039. That is exactly why F1 uses the harmonic mean: a model that flags two per cent of real cases with perfect precision is nearly useless, and an ordinary average would have called it middling.',
          hints: ['Work it out: 2 × (p × r) / (p + r).']
        }
      ]
    }
  ]
}
