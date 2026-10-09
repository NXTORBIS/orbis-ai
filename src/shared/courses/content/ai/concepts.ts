import type { Concept } from '../../types.ts'

/**
 * Everything Course 02 teaches, and what each thing rests on.
 *
 * ## This list is the spine
 *
 * Mastery is measured per concept, revision is scheduled per concept, and remediation walks backwards along
 * these edges. A lesson teaching something that is not here is a lesson whose learning cannot be measured, which
 * is why `check()` reports it.
 *
 * ## `requires` means genuinely stuck without it
 *
 * Not "comes earlier". Backpropagation requires gradients because it *is* gradients; it does not require
 * convolution, even though both are deep learning. Over-wiring the graph sends people back over everything,
 * which teaches as little as sending them back over nothing.
 *
 * ## Weight is how much of the course rests on it
 *
 * Generalisation and evaluation carry most of this course — almost every later unit depends on being able to
 * tell a model that works from a model that looks like it works. Diffusion does not carry much, interesting as
 * it is.
 */
export const AI_CONCEPTS: Concept[] = [
  // ---------------------------------------------------------------- what AI is
  { id: 'ai-meaning', name: 'What artificial intelligence means', blurb: 'A collection of methods for getting useful behaviour out of a machine, not one technology.', requires: [], weight: 0.7 },
  { id: 'narrow-ai', name: 'Narrow and general AI', blurb: 'Every system that exists does one kind of task; general intelligence is a goal, not a product.', requires: ['ai-meaning'], weight: 0.5 },
  { id: 'ai-vocabulary', name: 'The vocabulary', blurb: 'Model, algorithm, dataset, training, inference, prediction.', requires: ['ai-meaning'], weight: 0.9 },
  { id: 'ai-history', name: 'How AI got here', blurb: 'Symbolic reasoning, expert systems, statistical learning, deep learning, foundation models.', requires: ['ai-meaning'], weight: 0.45 },
  { id: 'symbolic-ai', name: 'Symbolic AI', blurb: 'Rules and search written by people, with no learning from data.', requires: ['ai-history'], weight: 0.5 },
  { id: 'ai-ml-dl', name: 'AI, machine learning and deep learning', blurb: 'Three nested ideas, and which systems belong to which.', requires: ['ai-meaning', 'symbolic-ai'], weight: 0.85 },
  { id: 'capability-vs-understanding', name: 'Capability is not understanding', blurb: 'Impressive output does not establish that a system understands anything.', requires: ['ai-meaning'], weight: 0.6 },

  // ---------------------------------------------------------------- learning from examples
  { id: 'learning-from-examples', name: 'Learning from examples', blurb: 'Finding a rule from cases rather than being given the rule.', requires: ['ai-vocabulary'], weight: 1 },
  { id: 'parameters', name: 'Parameters', blurb: 'The numbers inside a model that training changes.', requires: ['learning-from-examples'], weight: 0.95 },
  { id: 'loss', name: 'Loss', blurb: 'One number saying how wrong the model is on the examples it was shown.', requires: ['parameters'], weight: 1 },
  { id: 'optimisation', name: 'Optimisation', blurb: 'Changing the parameters to make the loss smaller.', requires: ['loss'], weight: 0.95 },
  { id: 'generalisation', name: 'Generalisation', blurb: 'Being right about examples the model has never seen. The whole point.', requires: ['loss'], weight: 1 },

  // ---------------------------------------------------------------- data
  { id: 'dataset', name: 'Datasets', blurb: 'Rows, columns, samples — and what one row has to mean.', requires: ['ai-vocabulary'], weight: 0.95 },
  { id: 'features', name: 'Features', blurb: 'What the model is allowed to look at.', requires: ['dataset'], weight: 1 },
  { id: 'labels', name: 'Labels and targets', blurb: 'The answer, for the examples where somebody knows it.', requires: ['dataset'], weight: 0.95 },
  { id: 'feature-types', name: 'Kinds of feature', blurb: 'Numerical, categorical, ordinal, binary, text, image, audio, time.', requires: ['features'], weight: 0.8 },
  { id: 'splits', name: 'Training, validation and test', blurb: 'Three separate jobs, and why one set cannot do all three.', requires: ['dataset', 'generalisation'], weight: 1 },
  { id: 'data-quality', name: 'Data quality', blurb: 'Missing values, duplicates, wrong types, outliers, noise.', requires: ['dataset'], weight: 0.9 },
  { id: 'imbalance', name: 'Class imbalance', blurb: 'When 99% of the rows are one class, 99% accuracy means nothing.', requires: ['labels', 'data-quality'], weight: 0.85 },
  { id: 'sampling-bias', name: 'Sampling bias', blurb: 'When the data does not represent the thing the model will meet.', requires: ['data-quality'], weight: 0.85 },
  { id: 'leakage', name: 'Data leakage', blurb: 'When the answer gets into the inputs, and the score becomes a lie.', requires: ['splits'], weight: 0.95 },
  { id: 'cleaning', name: 'Cleaning data', blurb: 'Deciding what to do about every fault, and recording the decision.', requires: ['data-quality'], weight: 0.8 },

  // ---------------------------------------------------------------- representation
  { id: 'vectors', name: 'Vectors', blurb: 'A list of numbers, and the only thing a model really reads.', requires: ['features'], weight: 0.95 },
  { id: 'encoding', name: 'Encoding', blurb: 'Turning categories and text into numbers without inventing an order.', requires: ['vectors', 'feature-types'], weight: 0.85 },
  { id: 'scaling', name: 'Scaling and normalisation', blurb: 'Why a feature measured in thousands can drown one measured in units.', requires: ['vectors'], weight: 0.85 },
  { id: 'dimensionality', name: 'Dimensionality', blurb: 'How many numbers describe one example, and what goes wrong when there are too many.', requires: ['vectors'], weight: 0.7 },

  // ---------------------------------------------------------------- machine learning
  { id: 'ml-workflow', name: 'The machine-learning workflow', blurb: 'Collect, prepare, choose, train, validate, test, deploy, watch.', requires: ['splits', 'ml-definition'], weight: 0.95 },
  { id: 'ml-definition', name: 'What machine learning is', blurb: 'Fitting a model to data rather than writing the rule by hand.', requires: ['learning-from-examples', 'ai-ml-dl'], weight: 1 },
  { id: 'training-inference', name: 'Training and inference', blurb: 'Two different activities with different costs and different risks.', requires: ['ml-definition'], weight: 0.9 },
  { id: 'hyperparameters', name: 'Hyperparameters', blurb: 'The settings you choose, as against the parameters training chooses.', requires: ['parameters', 'optimisation'], weight: 0.85 },
  { id: 'supervised', name: 'Supervised learning', blurb: 'Learning a mapping from inputs to known answers.', requires: ['labels', 'ml-definition'], weight: 1 },
  { id: 'regression', name: 'Regression', blurb: 'Predicting a number.', requires: ['supervised'], weight: 0.9 },
  { id: 'linear-regression', name: 'Linear regression', blurb: 'The straight line that fits best, and what "best" means.', requires: ['regression', 'loss'], weight: 0.85 },
  { id: 'residuals', name: 'Residuals', blurb: 'The gap between what the model said and what happened.', requires: ['linear-regression'], weight: 0.8 },
  { id: 'regression-metrics', name: 'Regression metrics', blurb: 'MSE, MAE, and what each one punishes.', requires: ['residuals'], weight: 0.85 },
  { id: 'classification', name: 'Classification', blurb: 'Predicting which class something belongs to.', requires: ['supervised'], weight: 1 },
  { id: 'decision-boundary', name: 'Decision boundaries', blurb: 'The line, curve or surface where the predicted class changes.', requires: ['classification'], weight: 0.8 },
  { id: 'probabilities', name: 'Predicted probabilities', blurb: 'A model that says 0.71 rather than "yes".', requires: ['classification'], weight: 0.9 },
  { id: 'threshold', name: 'Thresholds', blurb: 'Turning a probability into a decision, and choosing where to cut.', requires: ['probabilities'], weight: 0.9 },
  { id: 'confusion-matrix', name: 'The confusion matrix', blurb: 'Four numbers that every classification metric is built from.', requires: ['threshold'], weight: 0.95 },
  { id: 'precision-recall', name: 'Precision and recall', blurb: 'Two different questions, usually in tension.', requires: ['confusion-matrix'], weight: 0.95 },
  { id: 'f1', name: 'F1', blurb: 'One number from precision and recall, and when it hides something.', requires: ['precision-recall'], weight: 0.8 },

  // ---------------------------------------------------------------- evaluation
  { id: 'evaluation', name: 'Model evaluation', blurb: 'Measuring whether a model will be right on work it has not seen.', requires: ['splits', 'generalisation'], weight: 1 },
  { id: 'cross-validation', name: 'Cross-validation', blurb: 'Using every row for validation once, when there is not much data.', requires: ['evaluation'], weight: 0.8 },
  { id: 'roc-auc', name: 'ROC and AUC', blurb: 'What a model looks like across every threshold at once.', requires: ['threshold', 'precision-recall'], weight: 0.75 },
  { id: 'calibration', name: 'Calibration', blurb: 'Whether "70% sure" is right about seventy per cent of the time.', requires: ['probabilities'], weight: 0.7 },
  { id: 'model-selection', name: 'Choosing a model', blurb: 'Comparing candidates honestly, and writing down why.', requires: ['evaluation', 'hyperparameters'], weight: 0.85 },
  { id: 'overfitting', name: 'Overfitting', blurb: 'Learning the training data instead of the pattern in it.', requires: ['generalisation', 'evaluation'], weight: 1 },
  { id: 'underfitting', name: 'Underfitting', blurb: 'A model too simple to represent the pattern at all.', requires: ['generalisation'], weight: 0.85 },
  { id: 'bias-variance', name: 'Bias and variance', blurb: 'Two reasons to be wrong, and the trade between them.', requires: ['overfitting', 'underfitting'], weight: 0.9 },
  { id: 'regularisation', name: 'Regularisation', blurb: 'Making a complicated model behave as if it were simpler.', requires: ['overfitting'], weight: 0.8 },
  { id: 'model-complexity', name: 'Model complexity', blurb: 'How much a model can represent, and why more is not better.', requires: ['bias-variance'], weight: 0.85 },

  // ---------------------------------------------------------------- unsupervised and RL
  { id: 'unsupervised', name: 'Unsupervised learning', blurb: 'Finding structure when nobody has labelled anything.', requires: ['ml-definition', 'features'], weight: 0.8 },
  { id: 'clustering', name: 'Clustering', blurb: 'Grouping examples that are close to one another.', requires: ['unsupervised', 'distance'], weight: 0.8 },
  { id: 'distance', name: 'Distance', blurb: 'What "close" means once an example is a vector.', requires: ['vectors'], weight: 0.85 },
  { id: 'kmeans', name: 'k-means', blurb: 'Centres, assignment, recomputation, and the k you have to choose.', requires: ['clustering'], weight: 0.75 },
  { id: 'dimensionality-reduction', name: 'Dimensionality reduction', blurb: 'Fewer numbers per example, keeping what matters.', requires: ['dimensionality'], weight: 0.75 },
  { id: 'pca', name: 'PCA', blurb: 'The directions the data varies in most.', requires: ['dimensionality-reduction', 'matrices'], weight: 0.7 },
  { id: 'anomaly-detection', name: 'Anomaly detection', blurb: 'Finding the examples that do not belong.', requires: ['unsupervised'], weight: 0.65 },
  { id: 'reinforcement', name: 'Reinforcement learning', blurb: 'Learning from rewards, by acting rather than by being told.', requires: ['ml-definition'], weight: 0.7 },
  { id: 'agent-environment', name: 'Agents, states and actions', blurb: 'The loop every reinforcement problem is written in.', requires: ['reinforcement'], weight: 0.7 },
  { id: 'reward', name: 'Rewards', blurb: 'What you asked for, which is not always what you wanted.', requires: ['agent-environment'], weight: 0.75 },
  { id: 'exploration', name: 'Exploration and exploitation', blurb: 'Trying something new against taking the best you know.', requires: ['reward'], weight: 0.7 },
  { id: 'value-functions', name: 'Value and Q-learning', blurb: 'How good a state is, worked out from what follows it.', requires: ['exploration'], weight: 0.6 },

  // ---------------------------------------------------------------- mathematics
  { id: 'matrices', name: 'Matrices', blurb: 'A grid of numbers, and what multiplying by one does.', requires: ['vectors'], weight: 0.85 },
  { id: 'dot-product', name: 'Dot products', blurb: 'One number from two vectors, and why it measures agreement.', requires: ['vectors'], weight: 0.9 },
  { id: 'probability', name: 'Probability', blurb: 'Chance, conditional chance, and what a model output means.', requires: ['ai-vocabulary'], weight: 0.85 },
  { id: 'expectation', name: 'Expectation and variance', blurb: 'The average outcome, and how much it moves about.', requires: ['probability'], weight: 0.75 },
  { id: 'derivatives', name: 'Derivatives', blurb: 'The slope: how fast something changes as you nudge it.', requires: ['ai-vocabulary'], weight: 0.85 },
  { id: 'gradients', name: 'Gradients', blurb: 'The slope in every direction at once.', requires: ['derivatives', 'vectors'], weight: 0.95 },
  { id: 'gradient-descent', name: 'Gradient descent', blurb: 'Walking downhill on the loss, one step at a time.', requires: ['gradients', 'optimisation'], weight: 1 },
  { id: 'learning-rate', name: 'Learning rate', blurb: 'How big a step to take, and what happens at either extreme.', requires: ['gradient-descent'], weight: 0.9 },

  // ---------------------------------------------------------------- neural networks
  { id: 'neuron', name: 'The artificial neuron', blurb: 'Weights, a bias, a sum and a function. All of it.', requires: ['dot-product', 'parameters'], weight: 1 },
  { id: 'activation', name: 'Activation functions', blurb: 'The part that stops a deep network collapsing into a straight line.', requires: ['neuron'], weight: 0.9 },
  { id: 'layers', name: 'Layers', blurb: 'Input, hidden and output, and what each one is for.', requires: ['neuron'], weight: 0.95 },
  { id: 'forward-pass', name: 'The forward pass', blurb: 'Input to prediction, one layer at a time.', requires: ['layers', 'activation'], weight: 0.95 },
  { id: 'backpropagation', name: 'Backpropagation', blurb: 'Working out how much each weight contributed to the error.', requires: ['forward-pass', 'gradients'], weight: 0.95 },
  { id: 'epochs-batches', name: 'Epochs and batches', blurb: 'How many times through the data, and how much at a time.', requires: ['gradient-descent'], weight: 0.85 },
  { id: 'deep-learning', name: 'Deep learning', blurb: 'Many layers, and the hierarchy of features depth buys.', requires: ['forward-pass', 'backpropagation'], weight: 1 },
  { id: 'representation-learning', name: 'Representation learning', blurb: 'The model working out its own features instead of being handed them.', requires: ['deep-learning'], weight: 0.85 },
  { id: 'dropout', name: 'Dropout and normalisation', blurb: 'Two tricks that make deep training work at all.', requires: ['deep-learning', 'regularisation'], weight: 0.7 },
  { id: 'vanishing-gradients', name: 'Vanishing and exploding gradients', blurb: 'Why depth was impossible before a handful of fixes.', requires: ['backpropagation'], weight: 0.75 },
  { id: 'transfer-learning', name: 'Transfer learning', blurb: 'Starting from a model somebody else trained.', requires: ['deep-learning'], weight: 0.85 },

  // ---------------------------------------------------------------- vision
  { id: 'image-data', name: 'Images as data', blurb: 'Pixels, channels, and the shape of an image tensor.', requires: ['features'], weight: 0.8 },
  { id: 'convolution', name: 'Convolution', blurb: 'A small kernel slid over an image, looking for one thing everywhere.', requires: ['image-data', 'dot-product'], weight: 0.9 },
  { id: 'feature-maps', name: 'Feature maps and pooling', blurb: 'What a convolution produces, and how it gets smaller.', requires: ['convolution'], weight: 0.8 },
  { id: 'cnn', name: 'Convolutional networks', blurb: 'Convolution, pooling and a classifier on top.', requires: ['feature-maps', 'deep-learning'], weight: 0.85 },
  { id: 'image-tasks', name: 'Vision tasks', blurb: 'Classification, detection and segmentation are three different jobs.', requires: ['cnn'], weight: 0.8 },
  { id: 'augmentation', name: 'Augmentation', blurb: 'Making more training data out of the data you have.', requires: ['cnn', 'overfitting'], weight: 0.75 },
  { id: 'image-processing', name: 'Image processing', blurb: 'Filters, thresholds and histograms, before any learning happens.', requires: ['image-data'], weight: 0.7 },

  // ---------------------------------------------------------------- language
  { id: 'nlp', name: 'Natural language processing', blurb: 'Treating language as data without pretending it is numbers already.', requires: ['features'], weight: 0.85 },
  { id: 'tokenisation', name: 'Tokenisation', blurb: 'Cutting text into the pieces a model actually sees.', requires: ['nlp'], weight: 0.95 },
  { id: 'bag-of-words', name: 'Bag of words and TF-IDF', blurb: 'Counting words, and weighting the ones that distinguish.', requires: ['tokenisation', 'vectors'], weight: 0.75 },
  { id: 'embeddings', name: 'Embeddings', blurb: 'Dense vectors where nearness means similar meaning.', requires: ['tokenisation', 'vectors'], weight: 1 },
  { id: 'cosine-similarity', name: 'Cosine similarity', blurb: 'Comparing direction rather than length.', requires: ['embeddings', 'dot-product'], weight: 0.9 },
  { id: 'contextual-embeddings', name: 'Contextual embeddings', blurb: 'The same word with a different vector in a different sentence.', requires: ['embeddings'], weight: 0.85 },
  { id: 'sequences', name: 'Sequence data', blurb: 'Why order carries meaning that a bag of words throws away.', requires: ['nlp'], weight: 0.8 },
  { id: 'rnn', name: 'Recurrent networks', blurb: 'A hidden state carried from one step to the next.', requires: ['sequences', 'deep-learning'], weight: 0.7 },
  { id: 'lstm', name: 'LSTM and GRU', blurb: 'Gates that decide what to keep and what to forget.', requires: ['rnn'], weight: 0.6 },
  { id: 'long-range', name: 'Long-range dependence', blurb: 'The problem that made recurrence run out.', requires: ['rnn'], weight: 0.7 },

  // ---------------------------------------------------------------- attention and transformers
  { id: 'attention', name: 'Attention', blurb: 'Every position looking at every other, and weighting what it finds.', requires: ['embeddings', 'long-range'], weight: 1 },
  { id: 'qkv', name: 'Queries, keys and values', blurb: 'Three projections, and the retrieval they imitate.', requires: ['attention', 'dot-product'], weight: 0.95 },
  { id: 'self-attention', name: 'Self-attention', blurb: 'A sequence attending to itself.', requires: ['qkv'], weight: 0.95 },
  { id: 'masking', name: 'Masking and causal attention', blurb: 'Stopping a position from reading its own future.', requires: ['self-attention'], weight: 0.85 },
  { id: 'multi-head', name: 'Multi-head attention', blurb: 'Several attentions at once, learning different relations.', requires: ['self-attention'], weight: 0.85 },
  { id: 'positional', name: 'Positional information', blurb: 'How order gets back in, once attention has thrown it away.', requires: ['self-attention'], weight: 0.85 },
  { id: 'transformer', name: 'The transformer', blurb: 'Attention, a feed-forward block, residuals and normalisation, stacked.', requires: ['multi-head', 'positional', 'dropout'], weight: 1 },
  { id: 'encoder-decoder', name: 'Encoders and decoders', blurb: 'Three architectures, three jobs.', requires: ['transformer'], weight: 0.75 },

  // ---------------------------------------------------------------- LLMs
  { id: 'llm', name: 'Large language models', blurb: 'A transformer trained to predict the next token, at scale.', requires: ['transformer'], weight: 1 },
  { id: 'next-token', name: 'Next-token prediction', blurb: 'The one objective that everything else comes out of.', requires: ['llm', 'probability'], weight: 0.95 },
  { id: 'context-window', name: 'Context windows', blurb: 'How much the model can see at once, and what falls off the edge.', requires: ['llm', 'tokenisation'], weight: 0.9 },
  { id: 'sampling', name: 'Temperature, top-k and top-p', blurb: 'Choosing how much risk to take when picking the next token.', requires: ['next-token'], weight: 0.9 },
  { id: 'pretraining', name: 'Pretraining', blurb: 'The expensive part: one objective, an enormous corpus.', requires: ['next-token', 'epochs-batches'], weight: 0.85 },
  { id: 'fine-tuning', name: 'Fine-tuning and instruction tuning', blurb: 'Taking a pretrained model and teaching it a job.', requires: ['pretraining', 'transfer-learning'], weight: 0.85 },
  { id: 'alignment', name: 'Preference optimisation and alignment', blurb: 'Training on which answer people preferred.', requires: ['fine-tuning'], weight: 0.75 },
  { id: 'in-context-learning', name: 'In-context learning', blurb: 'Learning from the prompt, without any weights changing.', requires: ['llm', 'context-window'], weight: 0.9 },
  { id: 'hallucination', name: 'Hallucination', blurb: 'Fluent, confident and wrong — and why the objective produces it.', requires: ['next-token', 'in-context-learning'], weight: 1 },
  { id: 'grounding', name: 'Grounding', blurb: 'Making an answer rest on a source you can check.', requires: ['hallucination'], weight: 0.95 },

  // ---------------------------------------------------------------- generative and applied
  { id: 'generative', name: 'Generative models', blurb: 'Models of how the data itself could have come about.', requires: ['probability', 'deep-learning'], weight: 0.8 },
  { id: 'discriminative-vs-generative', name: 'Discriminative and generative', blurb: 'Telling classes apart against being able to produce an example.', requires: ['generative', 'classification'], weight: 0.7 },
  { id: 'latent', name: 'Latent representations', blurb: 'A compact code the model can decode back into data.', requires: ['generative', 'dimensionality-reduction'], weight: 0.75 },
  { id: 'autoencoder', name: 'Autoencoders', blurb: 'Squeeze it down, build it back, and look at what survived.', requires: ['latent'], weight: 0.7 },
  { id: 'gan', name: 'GANs', blurb: 'A forger and a detective, trained against each other.', requires: ['generative'], weight: 0.6 },
  { id: 'diffusion', name: 'Diffusion models', blurb: 'Learn to remove noise, then remove it from pure noise.', requires: ['generative'], weight: 0.65 },
  { id: 'prompting', name: 'Working with a model', blurb: 'Instruction, context, constraints, format, examples, verification.', requires: ['in-context-learning'], weight: 0.9 },
  { id: 'prompt-injection', name: 'Prompt injection', blurb: 'Instructions arriving inside the data a model was asked to read.', requires: ['prompting'], weight: 0.95 },
  { id: 'structured-output', name: 'Structured output and tool calls', blurb: 'Getting something a program can use, not a paragraph.', requires: ['prompting'], weight: 0.85 },
  { id: 'rag', name: 'Retrieval-augmented generation', blurb: 'Find the passage, then answer from it.', requires: ['embeddings', 'grounding'], weight: 0.95 },
  { id: 'chunking', name: 'Chunking', blurb: 'How a document is cut up, and what that costs you later.', requires: ['rag'], weight: 0.8 },
  { id: 'vector-search', name: 'Vector search', blurb: 'Finding the nearest passages by meaning rather than by word.', requires: ['rag', 'cosine-similarity'], weight: 0.85 },
  { id: 'retrieval-failure', name: 'Retrieval failure', blurb: 'The passage was wrong, so the answer was wrong, and it still sounded right.', requires: ['vector-search'], weight: 0.85 },

  // ---------------------------------------------------------------- agents
  { id: 'agent', name: 'AI agents', blurb: 'A model that acts: chooses a tool, reads the result, and goes again.', requires: ['structured-output'], weight: 0.9 },
  { id: 'tool-use', name: 'Tool use', blurb: 'Choosing a tool, filling in its arguments, and reading what comes back.', requires: ['agent'], weight: 0.9 },
  { id: 'agent-memory', name: 'Agent state and memory', blurb: 'What the agent knows now, and how it goes stale.', requires: ['agent'], weight: 0.75 },
  { id: 'agent-failure', name: 'How agents fail', blurb: 'Wrong tool, wrong arguments, loops, invented results, stale state.', requires: ['tool-use'], weight: 0.95 },
  { id: 'permissions', name: 'Permission boundaries', blurb: 'What an agent may do alone, and what must be confirmed.', requires: ['agent-failure'], weight: 0.95 },
  { id: 'reversibility', name: 'Reversible and irreversible actions', blurb: 'The difference that decides whether to ask first.', requires: ['permissions'], weight: 0.9 },

  // ---------------------------------------------------------------- engineering, safety, evaluation
  { id: 'ai-system', name: 'A model is not an application', blurb: 'Everything around the model that makes it useful.', requires: ['training-inference'], weight: 0.9 },
  { id: 'inference-pipeline', name: 'Inference pipelines', blurb: 'Where a request goes, and what happens on the way back.', requires: ['ai-system'], weight: 0.8 },
  { id: 'latency-throughput', name: 'Latency, throughput and cost', blurb: 'The three numbers that decide whether a system can be shipped.', requires: ['ai-system'], weight: 0.8 },
  { id: 'observability', name: 'Observability', blurb: 'Knowing what your system actually did, after it did it.', requires: ['ai-system'], weight: 0.8 },
  { id: 'eval-pipeline', name: 'Evaluation pipelines', blurb: 'A test suite for something that has no single right answer.', requires: ['evaluation', 'ai-system'], weight: 0.95 },
  { id: 'regression-testing', name: 'Regression testing for AI', blurb: 'Noticing when a change breaks what worked before it.', requires: ['eval-pipeline'], weight: 0.85 },
  { id: 'reproducibility', name: 'Reproducibility', blurb: 'Being able to get the same result twice, on purpose.', requires: ['eval-pipeline'], weight: 0.85 },
  { id: 'ai-safety', name: 'AI safety', blurb: 'Making a system that fails in ways you can live with.', requires: ['ai-system'], weight: 0.95 },
  { id: 'fairness', name: 'Fairness and bias', blurb: 'A model is as biased as the data and the choices behind it.', requires: ['sampling-bias', 'ai-safety'], weight: 0.9 },
  { id: 'robustness', name: 'Robustness', blurb: 'Holding up on input nobody anticipated.', requires: ['ai-safety', 'evaluation'], weight: 0.85 },
  { id: 'privacy', name: 'Privacy', blurb: 'What the data was, who agreed to it, and what the model remembers.', requires: ['ai-safety'], weight: 0.85 },
  { id: 'adversarial', name: 'Adversarial examples and poisoning', blurb: 'Deliberate attacks on inputs and on training data.', requires: ['robustness'], weight: 0.75 },
  { id: 'human-oversight', name: 'Human oversight', blurb: 'Where a person has to stay in the loop, and why.', requires: ['ai-safety', 'reversibility'], weight: 0.9 },
  { id: 'benchmarks', name: 'Benchmarks and their limits', blurb: 'A number on a leaderboard is evidence, not proof.', requires: ['evaluation'], weight: 0.8 },
  { id: 'human-eval', name: 'Human evaluation', blurb: 'When there is no metric, somebody has to read the output.', requires: ['eval-pipeline'], weight: 0.8 },
  { id: 'error-analysis', name: 'Error analysis', blurb: 'Reading the mistakes, one by one, until the pattern appears.', requires: ['evaluation'], weight: 0.95 }
]
