import type { Module } from '../../types.ts'

/**
 * Unit 04 — Evaluation, overfitting and choosing a model.
 *
 * The unit that decides whether somebody can be trusted with a model. Everything before it was about building
 * one; this is about telling a model that works from a model that looks like it works. Error analysis is placed
 * at the end deliberately — it is the habit that separates practitioners from people who read dashboards.
 */
export const AI_UNIT_4: Module = {
  id: 'u4',
  title: 'Evaluation, Overfitting and Model Choice',
  summary:
    'Why training accuracy is no evidence, cross-validation, ROC and AUC, calibration, the bias-variance trade, regularisation, and reading your model mistakes one at a time.',
  concepts: [
    'evaluation',
    'cross-validation',
    'roc-auc',
    'calibration',
    'model-selection',
    'overfitting',
    'underfitting',
    'bias-variance',
    'regularisation',
    'model-complexity',
    'error-analysis'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u4l1',
      title: 'Overfitting and underfitting',
      intro:
        'The two ways to be wrong, how to tell them apart from two curves, and why the fix for one makes the other worse.',
      objectives: [
        'Define overfitting and underfitting precisely',
        'Diagnose which one is happening from training and validation error',
        'Name the remedies for each, and say why they are opposites'
      ],
      concepts: ['evaluation', 'overfitting', 'underfitting', 'model-complexity'],
      requires: ['generalisation', 'splits'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Underfitting**: the model is too simple to represent the pattern. It is wrong on the training data and wrong on everything else, in the same systematic way.'
        },
        {
          kind: 'text',
          text: '**Overfitting**: the model has enough capacity to learn the training examples themselves, including their noise. It is right on the training data and wrong on anything new.'
        },
        {
          kind: 'example',
          title: 'The same twelve points, three models',
          text: 'Twelve noisy points that genuinely follow a gentle curve.\n\nA straight line        — misses the curve everywhere. Training error high, validation error high. Underfitting.\nA quadratic            — follows the curve, ignores the noise. Both errors low. Right.\nAn 11th-degree polynomial — passes exactly through all twelve points. Training error zero, validation error enormous. Overfitting.'
        },
        { kind: 'heading', text: 'Diagnosis from two numbers' },
        {
          kind: 'table',
          headers: ['Training error', 'Validation error', 'Diagnosis', 'What to do'],
          rows: [
            ['High', 'High, similar', 'Underfitting', 'More capacity, better features, train longer'],
            ['Low', 'Much higher', 'Overfitting', 'Less capacity, regularisation, more data, early stopping'],
            ['Low', 'Low, similar', 'Working', 'Stop, and test once'],
            ['High', 'Lower than training', 'Something is wrong with the setup', 'Suspect a leak, a bad split, or regularisation applied only during training']
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The last row surprises people. Validation error below training error usually means the validation set is easier, the split is broken, or a technique like dropout is inflating the training number. It is a signal to investigate the plumbing, not a triumph.'
        },
        { kind: 'heading', text: 'The training curve' },
        {
          kind: 'text',
          text: 'Plot both errors against training time (or model complexity). Both fall at first. Then validation error flattens and starts to rise while training error keeps falling. That turning point is where the model stops learning the pattern and starts learning the data, and stopping there is the technique called **early stopping**.'
        },
        { kind: 'heading', text: 'Why "more powerful model" is not a default' },
        {
          kind: 'text',
          text: 'Capacity is the ability to represent complicated functions. More capacity reduces underfitting and increases the risk of overfitting. The right amount depends on how much data you have and how much noise is in it — which is why the same model can be the right choice on a million rows and the wrong one on two hundred.'
        },
        {
          kind: 'lab',
          appId: 'learning-lab',
          title: 'Make both failures happen on purpose',
          does:
            'Fit a deliberately too-simple model and look at the error. Then increase the complexity until training error reaches nearly zero and validation error climbs. Find the complexity where validation error is lowest — that is the number the whole lesson is about.'
        },
        { kind: 'check', questionId: 'u4l1q1' },
        { kind: 'check', questionId: 'u4l1q2' }
      ],
      questions: [
        {
          id: 'u4l1q1',
          kind: 'choice',
          concept: 'overfitting',
          prompt: 'Training error 0.02, validation error 0.31. What is happening and what helps?',
          difficulty: 'intermediate',
          options: [
            'Underfitting — add capacity',
            'Overfitting — reduce capacity, add regularisation, get more data, or stop earlier',
            'The model is working well',
            'The validation set is too small to say anything'
          ],
          answer: 1,
          explanation:
            'A large gap with low training error is the signature of overfitting: the model has learned these examples rather than the pattern. All four remedies attack the same thing — the model freedom to fit noise.',
          hints: ['Look at the size of the gap, and which side is low.']
        },
        {
          id: 'u4l1q2',
          kind: 'choice',
          concept: 'underfitting',
          prompt: 'Training error 0.34, validation error 0.36. What should you do?',
          difficulty: 'intermediate',
          options: [
            'Add regularisation',
            'Collect more data',
            'Increase capacity or improve the features — the model cannot even fit what it has seen',
            'Reduce the number of features'
          ],
          answer: 2,
          explanation:
            'Both errors high and close together is underfitting. More data will not help a model that cannot fit the data it already has, and regularisation makes an underfitting model worse by restricting it further.',
          hints: ['Can the model fit even the training set?']
        },
        {
          id: 'u4l1q3',
          kind: 'true-false',
          concept: 'overfitting',
          prompt: 'A model with zero training error is the best model you have found.',
          difficulty: 'beginner',
          answer: false,
          explanation:
            'Zero training error usually means the model has memorised the training set, noise included. It says nothing about unseen data, and it is the standard warning sign of overfitting.',
          hints: ['What does training error measure, and what does nobody care about?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u4l2',
      title: 'Bias, variance and regularisation',
      intro:
        'Two names for the two failures, one trade between them, and the family of techniques that lets a big model behave like a smaller one.',
      objectives: [
        'Define bias and variance as sources of error',
        'Explain the trade-off and where total error is lowest',
        'Explain what L1 and L2 penalties do, and what dropout and early stopping do'
      ],
      concepts: ['bias-variance', 'regularisation'],
      requires: ['overfitting', 'underfitting'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Error has two components worth separating. **Bias** is error from a model too rigid to represent the truth — it would be wrong even with unlimited data. **Variance** is error from sensitivity to the particular sample you trained on: train on a different draw of data and you would get a noticeably different model.'
        },
        {
          kind: 'table',
          headers: ['', 'High bias', 'High variance'],
          rows: [
            ['Looks like', 'Both errors high', 'Training low, validation high'],
            ['Another way to say it', 'Underfitting', 'Overfitting'],
            ['Retrain on a different sample', 'Nearly the same wrong model', 'A noticeably different model'],
            ['Typical cause', 'Model too simple', 'Model too flexible for the amount of data'],
            ['More data helps?', 'No', 'Yes, usually a lot']
          ]
        },
        {
          kind: 'text',
          text: 'As complexity rises, bias falls and variance rises. Total error is the sum, so it falls, reaches a minimum, and rises again. That minimum is the model you want, and it is found on the validation set — there is no formula for it.'
        },
        { kind: 'heading', text: 'Regularisation' },
        {
          kind: 'text',
          text: 'Regularisation means deliberately restricting a model so that it cannot use all its capacity to chase noise. The commonest form adds a penalty on the size of the weights to the loss, so the optimiser has to trade fitting the data against keeping the weights small.'
        },
        { kind: 'formula', latex: 'L_{\\text{total}} = L_{\\text{data}} + \\lambda \\sum_j w_j^2', caption: 'L2 regularisation (ridge). The second term grows with the square of each weight, so large weights have to earn their size. λ sets the strength and is a hyperparameter — chosen on the validation set.' },
        {
          kind: 'table',
          headers: ['Technique', 'What it does', 'Side effect worth knowing'],
          rows: [
            ['L2 (ridge)', 'Penalises squared weights; shrinks them all toward zero', 'Keeps every feature, none exactly zero'],
            ['L1 (lasso)', 'Penalises absolute weights', 'Drives some weights to exactly zero — it selects features'],
            ['Early stopping', 'Stop training when validation error turns upward', 'Free, and effective; needs a validation set'],
            ['Dropout', 'Randomly switches off units during training', 'Training error looks worse than it is'],
            ['Data augmentation', 'Makes more training examples by transforming existing ones', 'Only valid if the transformation preserves the label'],
            ['More data', 'Not regularisation, but the best cure for variance', 'Expensive, and cannot fix bias']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'L1 against L2 in one line: L1 when you suspect most features are useless and want them removed; L2 when you think most features matter a little. L1 gives a model you can read, because the surviving features are the ones it kept.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Regularising an underfitting model makes it worse. Diagnose first — the gap between training and validation error tells you which problem you have, and the two problems have opposite remedies.'
        },
        { kind: 'check', questionId: 'u4l2q1' },
        { kind: 'check', questionId: 'u4l2q2' }
      ],
      questions: [
        {
          id: 'u4l2q1',
          kind: 'choice',
          concept: 'bias-variance',
          prompt: 'You retrain the same model on three different samples of the data and get three very different models. What does that indicate?',
          difficulty: 'intermediate',
          options: [
            'High bias',
            'High variance — the model is following the particular sample rather than the underlying pattern',
            'A data leak',
            'That the samples were too large'
          ],
          answer: 1,
          explanation:
            'Sensitivity to which sample you happened to draw is the definition of variance. A high-bias model would be consistently and similarly wrong across all three.',
          hints: ['Which of the two sources of error is about sensitivity to the sample?']
        },
        {
          id: 'u4l2q2',
          kind: 'choice',
          concept: 'regularisation',
          prompt: 'You have 400 features, suspect most are irrelevant, and want a model you can explain. Which penalty?',
          difficulty: 'advanced',
          options: [
            'L2, because it shrinks all weights smoothly',
            'L1, because it drives some weights to exactly zero and so selects features',
            'Neither — remove features by hand',
            'Both at full strength'
          ],
          answer: 1,
          explanation:
            'L1 produces exact zeros, which is feature selection as a side effect of fitting: the features with non-zero weights are the ones the model kept. L2 would shrink everything and keep all 400.',
          hints: ['Which penalty can set a weight to exactly zero?']
        },
        {
          id: 'u4l2q3',
          kind: 'true-false',
          concept: 'regularisation',
          prompt: 'Collecting more training data is a reliable cure for high bias.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'More data reduces variance, not bias. A model too simple to represent the pattern will be equally wrong with ten times the data — it needs more capacity or better features.',
          hints: ['Which of the two errors would remain with unlimited data?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u4l3',
      title: 'Cross-validation, ROC and AUC',
      intro:
        'Three tools for measuring honestly: using every row for validation in turn, and looking at a classifier across every threshold at once.',
      objectives: [
        'Explain k-fold cross-validation and when it is worth the cost',
        'Read an ROC curve',
        'Say what AUC measures and what it conceals'
      ],
      concepts: ['cross-validation', 'roc-auc'],
      requires: ['evaluation', 'threshold'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'k-fold cross-validation' },
        {
          kind: 'text',
          text: 'With a small dataset, a single validation set is both small and arbitrary: the score depends on which rows happened to land in it. Cross-validation uses every row for validation exactly once.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Split the training data into k equal parts — five is common.',
            'Train on four, validate on the fifth. Record the score.',
            'Repeat, holding out a different part each time.',
            'Average the k scores, and look at their spread as well as their mean.'
          ]
        },
        {
          kind: 'text',
          text: 'The spread is the part people ignore and should not. Five fold scores of 0.81, 0.82, 0.80, 0.81, 0.82 mean something quite different from 0.62, 0.95, 0.71, 0.88, 0.90 with the same average — the second says the result depends heavily on the split, which is itself a finding.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Everything about splitting still applies. Group folds by group, respect time order for time series, stratify for rare classes, and fit scalers and encoders inside each fold rather than before the loop. Cross-validation with a leak just reports the leak five times.'
        },
        { kind: 'heading', text: 'ROC: a classifier at every threshold' },
        {
          kind: 'text',
          text: 'Unit 03 established that a classifier is a probability plus a chosen cut. The **ROC curve** removes the choice: sweep the threshold from 1 down to 0 and plot, at each point, the true positive rate against the false positive rate.'
        },
        { kind: 'formula', latex: '\\text{TPR} = \\frac{TP}{TP + FN} \\qquad \\text{FPR} = \\frac{FP}{FP + TN}', caption: 'True positive rate is recall. False positive rate is the share of real negatives wrongly flagged. The curve runs from (0,0) — flag nothing — to (1,1) — flag everything.' },
        {
          kind: 'list',
          items: [
            'A curve hugging the top-left corner is good: high catch rate at a low false-alarm rate.',
            'The diagonal is a model with no information — flagging at random.',
            'Below the diagonal means the model is worse than chance, and inverting its output would help.'
          ]
        },
        { kind: 'heading', text: 'AUC' },
        {
          kind: 'text',
          text: 'The area under that curve, between 0 and 1. It has an exact and useful interpretation: **AUC is the probability that the model gives a randomly chosen positive example a higher score than a randomly chosen negative one.** 0.5 is chance; 1.0 is perfect separation.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Because AUC only cares about ranking, it is insensitive to the threshold and to calibration. It answers "can this model tell the classes apart at all?" — a different question from "does it make good decisions at the threshold we deployed?"'
        },
        {
          kind: 'text',
          text: 'And it conceals something on imbalanced data. With 0.1% positives, the false positive rate stays tiny even when almost everything flagged is a false alarm — so AUC can look excellent while the system is unusable. For rare positives, the **precision-recall curve** is the honest picture.'
        },
        {
          kind: 'table',
          headers: ['Want to know', 'Look at'],
          rows: [
            ['Can the model separate the classes at all?', 'AUC'],
            ['How will it behave at the threshold we will actually use?', 'Precision and recall at that threshold'],
            ['How does it do when positives are rare?', 'Precision-recall curve, and its area'],
            ['Is 0.8 really 80%?', 'A calibration plot — the next lesson']
          ]
        },
        { kind: 'check', questionId: 'u4l3q1' },
        { kind: 'check', questionId: 'u4l3q2' }
      ],
      questions: [
        {
          id: 'u4l3q1',
          kind: 'choice',
          concept: 'roc-auc',
          prompt: 'What does an AUC of 0.85 mean exactly?',
          difficulty: 'advanced',
          options: [
            'The model is right 85% of the time',
            '85% of its positive predictions are correct',
            'Given one random positive and one random negative example, the model scores the positive higher 85% of the time',
            'It achieves 85% recall'
          ],
          answer: 2,
          explanation:
            'AUC is exactly that ranking probability. It is not accuracy, not precision and not recall — and it holds no matter what threshold you later choose, which is both its strength and its limitation.',
          hints: ['AUC is about ordering two examples, not about any single decision.']
        },
        {
          id: 'u4l3q2',
          kind: 'choice',
          concept: 'cross-validation',
          prompt: 'Five-fold cross-validation gives 0.62, 0.95, 0.71, 0.88 and 0.90. What should you conclude?',
          difficulty: 'advanced',
          options: [
            'The model scores about 0.81 and is fine',
            'The result depends heavily on which rows are held out — probably too little data, or a few influential rows, and the average alone would have hidden it',
            'The worst fold should be discarded',
            'Cross-validation has failed and should not be used'
          ],
          answer: 1,
          explanation:
            'The mean is 0.81 and nearly meaningless on its own. That spread says the estimate is unstable: the dataset is likely too small, or a handful of rows dominate. Always report the spread with the mean.',
          hints: ['What is the information in the five numbers that the average throws away?']
        },
        {
          id: 'u4l3q3',
          kind: 'true-false',
          concept: 'roc-auc',
          prompt: 'A high AUC means the model will perform well at the threshold you deploy.',
          difficulty: 'advanced',
          answer: false,
          explanation:
            'AUC says the model can rank the classes apart. Performance at a particular threshold is precision and recall at that threshold — and on imbalanced data a high AUC can coexist with precision so low the system is unusable.',
          hints: ['Does AUC know which threshold you chose?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u4l4',
      title: 'Calibration, confidence and choosing a model',
      intro:
        'Whether "70% sure" is right 70% of the time, and how to compare candidate models without fooling yourself.',
      objectives: [
        'Explain calibration and read a calibration plot',
        'Say why modern networks are often overconfident',
        'Compare candidate models honestly and write down the decision'
      ],
      concepts: ['calibration', 'model-selection'],
      requires: ['probabilities', 'evaluation', 'hyperparameters'],
      minutes: 13,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A model is **calibrated** if its stated confidence matches reality: of all the cases where it said 0.7, about 70% really were positive. This matters whenever the number itself is used — for triage, for pricing, for deciding whether a person should look.'
        },
        { kind: 'heading', text: 'Reading a calibration plot' },
        {
          kind: 'text',
          text: 'Bucket the predictions — 0.0–0.1, 0.1–0.2, and so on. For each bucket, plot the average predicted probability against the actual fraction that turned out positive. Perfect calibration is the diagonal.'
        },
        {
          kind: 'list',
          items: [
            'Points below the diagonal: the model is **overconfident** — it says 0.9 and is right 70% of the time.',
            'Points above: **underconfident** — it says 0.6 and is right 85% of the time.',
            'An S shape: confident in the middle, wrong at the extremes. Common.'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Deep networks trained with cross-entropy are routinely overconfident, and the problem gets worse as they get larger. A network saying 0.99 may be right 85% of the time. This is a measured, well-documented property — not a slur on the model — and it is why confidence has to be checked rather than assumed.'
        },
        {
          kind: 'text',
          text: 'Fixes exist and are cheap. **Temperature scaling** divides the pre-sigmoid scores by a single number fitted on validation data, which often repairs most of the miscalibration without changing any decision ordering — so AUC is untouched and the probabilities become usable.'
        },
        { kind: 'heading', text: 'Choosing between models' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Decide the metric **before** looking at results, from the cost of each kind of mistake.',
            'Establish a baseline: the simplest sensible model, or the current system.',
            'Measure every candidate on the same validation data, with the same preparation.',
            'Compare the spread as well as the mean — a 0.01 difference between two models with 0.03 fold-to-fold variation is not a difference.',
            'Count the other costs: training time, inference latency, memory, explainability, maintenance.',
            'Choose, then test once, then write down what you chose and why.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The written explanation is not paperwork. In three months somebody — possibly you — will ask why this model rather than the simpler one, and "it scored 0.02 better on a validation set we no longer have" is not an answer. Record the metric, the baseline, the margin and the trade-offs.'
        },
        { kind: 'heading', text: 'Uncertainty, briefly' },
        {
          kind: 'text',
          text: 'There are two kinds, and they call for different responses. **Aleatoric** uncertainty is noise inherent in the problem — two identical houses sell for different prices, and no model can fix that. **Epistemic** uncertainty is the model not knowing, usually because the input is unlike its training data. The second is the one worth detecting: a model asked about something outside its experience should say so, and most models instead answer confidently.'
        },
        {
          kind: 'lab',
          appId: 'uncertainty-lab',
          title: 'Confidence against reality',
          does:
            'Compare stated uncertainty against observed outcomes and see where the two diverge. Pay attention to the extremes: that is where a confident model is most often wrong.',
          optional: true
        },
        { kind: 'check', questionId: 'u4l4q1' },
        { kind: 'check', questionId: 'u4l4q2' }
      ],
      questions: [
        {
          id: 'u4l4q1',
          kind: 'choice',
          concept: 'calibration',
          prompt:
            'Of the cases where a model said 0.9, 70% turned out positive. What is wrong, and does it affect AUC?',
          difficulty: 'advanced',
          options: [
            'The model is underconfident, and AUC falls',
            'The model is overconfident; AUC can be unaffected, because AUC depends only on the ranking and not on the values',
            'The model is broken and must be retrained from scratch',
            'Nothing is wrong — 70% is close enough to 0.9'
          ],
          answer: 1,
          explanation:
            'Stated confidence exceeds reality: overconfident. Since AUC only cares about whether positives are ranked above negatives, a monotonic distortion of the probabilities leaves it untouched — which is why a model can have an excellent AUC and unusable probabilities.',
          hints: ['What exactly does AUC depend on?']
        },
        {
          id: 'u4l4q2',
          kind: 'choice',
          concept: 'model-selection',
          prompt:
            'Model A scores 0.864 and model B scores 0.858 on validation, with fold-to-fold variation of about 0.02. B is a tenth of the size and can be explained to a regulator. Which do you choose?',
          difficulty: 'advanced',
          options: [
            'A, because it scored higher',
            'B — the difference is well inside the noise, so the scores are not distinguishable, and B wins on every other count',
            'Neither; train a third model',
            'A, because larger models generalise better'
          ],
          answer: 1,
          explanation:
            'A 0.006 difference against 0.02 variation is not a difference. With the scores tied, size, latency and explainability decide — and those are real engineering costs, not consolation prizes.',
          hints: ['Compare the gap between the models with the noise in the measurement.']
        },
        {
          id: 'u4l4q3',
          kind: 'short',
          concept: 'calibration',
          prompt: 'What does it mean for a model to be calibrated?',
          difficulty: 'intermediate',
          answer: 'its stated probabilities match the real frequencies',
          accepts: [
            'confidence matches reality',
            '70% means right 70% of the time',
            'predicted probability equals observed frequency',
            'its probabilities are accurate'
          ],
          explanation:
            'Of everything it called 0.7, about seventy per cent are positive. It is a separate property from accuracy and from ranking quality, and it has to be measured on its own.',
          hints: ['It is about the numbers meaning what they say.']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'u4l5',
      title: 'Error analysis: reading the mistakes',
      intro:
        'The highest-value hour in applied machine learning, and the one almost nobody spends: sitting down with a hundred wrong predictions and sorting them into piles.',
      objectives: [
        'Carry out error analysis on a set of wrong predictions',
        'Turn a pile of errors into a ranked list of actions',
        'Explain why this finds things no aggregate metric can'
      ],
      concepts: ['error-analysis'],
      requires: ['evaluation'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A single score tells you how much the model is wrong. It never tells you **how** it is wrong, and how it is wrong is what decides what to do next. The procedure is unglamorous and works better than almost anything else available.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Take a hundred validation examples the model got wrong. Random, not cherry-picked.',
            'Look at each one. Actually look — read the text, see the image, check the row.',
            'Write down why it was wrong, in your own words.',
            'Sort the reasons into categories as they emerge. Do not decide the categories in advance.',
            'Count each category.',
            'Attack the largest one first.'
          ]
        },
        {
          kind: 'example',
          title: 'A real-shaped result',
          text: 'Sentiment classifier, 100 errors examined:\n\n  31  sarcasm  — "oh brilliant, broken again"\n  22  negation over distance — "not the worst I have used"\n  18  mixed sentiment — praise for one feature, complaint about another\n  14  the label was wrong\n   9  another language\n   6  genuinely ambiguous to a person too\n\nWhat this changes: 14% of the "errors" are not errors at all, and the ceiling on this dataset is lower than the metric suggests. The biggest real category is sarcasm, which no amount of extra training data of the current kind will fix. And the next sprint is now obvious — which it was not from the F1 score.'
        },
        { kind: 'heading', text: 'What this finds that metrics cannot' },
        {
          kind: 'list',
          items: [
            '**Label noise.** If a tenth of your labels are wrong, you are measuring against partly wrong answers and no model can score above that ceiling.',
            '**Subgroups that fail.** Overall 92%, and 61% on one accent, one dialect, one camera model. The average hid it completely.',
            '**Errors with a cheap fix.** Half the failures are inputs in a language you never intended to support — one filter, done.',
            '**Problems where the task is wrong.** If people cannot agree on the label either, the model is being asked an unanswerable question and the task needs redefining.'
          ]
        },
        { kind: 'heading', text: 'Slice your metrics' },
        {
          kind: 'text',
          text: 'Alongside the examination, report the metric separately for every group you can define: by region, by device, by text length, by class, by time period. A model with 92% overall and 61% on an identifiable group is not a 92% model for the people in that group, and the aggregate will never say so. This is also where fairness work begins, and Unit 13 continues it.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Make it a habit with a fixed place in the project: after the first model, after every significant change, and before anything is deployed. An hour reading errors routinely beats a week of tuning, and it is the single clearest difference between somebody who builds models and somebody who reads dashboards.'
        },
        {
          kind: 'lab',
          appId: 'problem-workspace',
          title: 'Sort a hundred errors',
          does:
            'Work through a set of wrong predictions, write the reason for each, and group them. Then say which single change would remove the most errors — and whether the largest category is even fixable with more data.'
        },
        { kind: 'check', questionId: 'u4l5q1' },
        { kind: 'check', questionId: 'u4l5q2' }
      ],
      questions: [
        {
          id: 'u4l5q1',
          kind: 'choice',
          concept: 'error-analysis',
          prompt: 'Error analysis shows 14% of the examined errors are cases where the label itself is wrong. What follows?',
          difficulty: 'advanced',
          options: [
            'Nothing — 14% is small',
            'The measured ceiling is lower than it appears, some apparent errors are correct predictions against wrong answers, and the labelling process needs attention before more modelling',
            'The model should be made more complex to fit those cases',
            'Delete those rows and continue'
          ],
          answer: 1,
          explanation:
            'Label noise caps the achievable score and corrupts the measurement — the model may be right where you recorded it wrong. Fitting them harder teaches the model the mistakes. Deleting the ones you happened to notice leaves the rest, so the labelling process is the thing to fix.',
          hints: ['If the answer key is wrong, what is the score measuring?']
        },
        {
          id: 'u4l5q2',
          kind: 'choice',
          concept: 'error-analysis',
          prompt: 'A model scores 92% overall and 61% on one identifiable subgroup. What is the correct description?',
          difficulty: 'intermediate',
          options: [
            'A 92% model with some natural variation',
            'A model that works for most users and does not work for that subgroup — and the aggregate number conceals it, which is both an engineering fault and a fairness problem',
            'Fine, as long as the subgroup is small',
            'Evidence that the subgroup data is wrong'
          ],
          answer: 1,
          explanation:
            'For the people in that group the model is a 61% model. Reporting only the average hides the failure, which is why metrics are sliced by group — and why this is where fairness work starts rather than ends.',
          hints: ['Whose experience does the 92% describe?']
        },
        {
          id: 'u4l5q3',
          kind: 'short',
          concept: 'error-analysis',
          prompt: 'Why examine a random sample of errors rather than the ones that look most interesting?',
          difficulty: 'intermediate',
          answer: 'so the counts reflect how common each kind of error really is',
          accepts: [
            'to get representative counts',
            'cherry-picking distorts the proportions',
            'so you fix the biggest category',
            'to see which errors are most frequent'
          ],
          explanation:
            'The point of the exercise is the counts — which category is biggest decides what you work on. Picking interesting examples produces a list of interesting problems rather than the common ones.',
          hints: ['What is the number you are trying to get out of the exercise?']
        }
      ]
    }
  ]
}
