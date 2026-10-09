import type { Module } from '../../types.ts'

/**
 * Unit 07 — Neural networks and deep learning.
 *
 * Built from one neuron upward, because a neuron is small enough to compute by hand and a network is not. The
 * activation-function lesson carries more weight than its length suggests: without non-linearity a hundred
 * layers collapse into one, and that fact explains the whole architecture.
 *
 * The practical lesson at the end — dropout, normalisation, initialisation, vanishing gradients, transfer
 * learning — is what separates somebody who understands the diagram from somebody who can get a network to
 * train.
 */
export const AI_UNIT_7: Module = {
  id: 'u7',
  title: 'Neural Networks and Deep Learning',
  summary:
    'One neuron, then layers, then the forward pass, then backpropagation — and finally the handful of techniques that make deep networks trainable at all.',
  concepts: [
    'neuron',
    'activation',
    'layers',
    'forward-pass',
    'backpropagation',
    'epochs-batches',
    'deep-learning',
    'representation-learning',
    'dropout',
    'vanishing-gradients',
    'transfer-learning'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u7l1',
      title: 'One neuron',
      intro:
        'The whole unit rests on this: a weighted sum, a bias, and a function. Small enough to compute with a pencil, and everything else is copies of it.',
      objectives: [
        'Compute the output of a single neuron by hand',
        'Say what the weights and the bias each do',
        'Explain why the activation function is not optional'
      ],
      concepts: ['neuron', 'activation'],
      requires: ['dot-product', 'parameters'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'An artificial neuron does three things, in order.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Multiply each input by its weight and add the results — a dot product.',
            'Add the bias.',
            'Pass the total through an activation function.'
          ]
        },
        { kind: 'formula', latex: 'y = f(w_1x_1 + w_2x_2 + \\cdots + w_nx_n + b) = f(\\mathbf{w} \\cdot \\mathbf{x} + b)', caption: 'x are the inputs, w the weights, b the bias and f the activation function. The weights and the bias are parameters — training sets them. Everything else is fixed.' },
        {
          kind: 'example',
          title: 'Computed by hand',
          text: 'inputs  x = [2, 3]\nweights w = [0.5, -1]\nbias    b = 1\n\nweighted sum: 2(0.5) + 3(-1) = 1 - 3 = -2\nplus bias:    -2 + 1 = -1\n\nwith ReLU:    max(0, -1) = 0          — the neuron stays silent\nwith sigmoid: 1/(1+e^1) ≈ 0.27        — the neuron is weakly on'
        },
        { kind: 'heading', text: 'What the weights and the bias do' },
        {
          kind: 'text',
          text: 'A **weight** is how much that input matters, and its sign says in which direction. A large positive weight means the input pushes the neuron on; a negative weight means it pushes it off; near zero means the neuron ignores it. The **bias** shifts the whole threshold — how much total input is needed before the neuron responds at all. Without a bias, every neuron is forced to pass through zero, which is a severe and arbitrary restriction.'
        },
        { kind: 'heading', text: 'Why the activation function is the whole trick' },
        {
          kind: 'text',
          text: 'Suppose f does nothing — the neuron outputs the weighted sum directly. Then a layer is a linear function of its inputs, and a layer of linear functions fed into another layer of linear functions is *still a linear function*. A hundred layers would collapse into a single equivalent layer, and the network could represent nothing more than a straight line.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Without a non-linear activation, depth buys nothing at all. Not "less", but exactly nothing — the composition is provably equivalent to one linear layer. That is why this unassuming function is the reason deep learning exists.'
        },
        {
          kind: 'table',
          headers: ['Function', 'Shape', 'Range', 'Used for', 'Problem'],
          rows: [
            ['Step', 'Hard on/off', '0 or 1', 'Historical interest', 'No useful gradient — cannot be trained'],
            ['Sigmoid', 'Smooth S', '0 to 1', 'Output of a binary classifier', 'Saturates: gradient vanishes at the extremes'],
            ['tanh', 'Smooth S, centred', '−1 to 1', 'Older hidden layers, recurrent nets', 'Also saturates'],
            ['ReLU', 'Flat then straight', '0 upward', 'The default for hidden layers', 'Units can die — stuck at zero forever'],
            ['Leaky ReLU', 'Slight slope below zero', 'Negative to positive', 'When ReLU units die', 'One more thing to choose'],
            ['Softmax', 'Normalises a whole layer', 'Sums to 1', 'Output of a multiclass classifier', 'Only for the output layer']
          ]
        },
        {
          kind: 'text',
          text: '**ReLU** — `max(0, x)` — dominates hidden layers for a simple reason: its gradient is exactly 1 for any positive input, so it does not squash the gradient as it passes back through many layers. Sigmoid and tanh flatten at both ends, and a flat function has almost no gradient, which is the vanishing-gradient problem that kept deep networks untrainable for years.'
        },
        {
          kind: 'lab',
          appId: 'neural-lab',
          title: 'One neuron, by hand',
          does:
            'Set the weights and bias of a single unit and watch its output. Make it ignore one input entirely. Then make it respond only when both inputs are large, and notice what the bias had to do.'
        },
        { kind: 'check', questionId: 'u7l1q1' },
        { kind: 'check', questionId: 'u7l1q2' },
        { kind: 'check', questionId: 'u7l1q3' }
      ],
      questions: [
        {
          id: 'u7l1q1',
          kind: 'number',
          concept: 'neuron',
          prompt: 'Inputs [1, 2], weights [3, -1], bias 2, ReLU activation. What does the neuron output?',
          difficulty: 'intermediate',
          answer: 3,
          tolerance: 0.01,
          explanation: '1×3 + 2×(−1) = 1, plus the bias 2 gives 3. ReLU leaves a positive value unchanged, so the output is 3.',
          hints: ['Dot product first, then bias, then the function.']
        },
        {
          id: 'u7l1q2',
          kind: 'choice',
          concept: 'activation',
          prompt: 'What happens to a twenty-layer network whose activation functions are all removed?',
          difficulty: 'advanced',
          options: [
            'It trains more slowly but still works',
            'It becomes mathematically equivalent to a single linear layer, so the depth contributes nothing',
            'It overfits more easily',
            'The gradients explode'
          ],
          answer: 1,
          explanation:
            'A composition of linear maps is a linear map. Twenty layers collapse into one equivalent layer, and the network can only represent what a linear model could. The non-linearity is what makes depth meaningful.',
          hints: ['What do you get when you feed a linear function into another linear function?']
        },
        {
          id: 'u7l1q3',
          kind: 'choice',
          concept: 'activation',
          prompt: 'Why is ReLU usually preferred over sigmoid for hidden layers?',
          difficulty: 'advanced',
          options: [
            'Because its output range is larger',
            'Because its gradient is 1 for positive inputs, so it does not shrink the gradient as it passes back through many layers',
            'Because it is non-linear and sigmoid is not',
            'Because it never outputs zero'
          ],
          answer: 1,
          explanation:
            'Sigmoid flattens at both ends, so its gradient approaches zero and repeated multiplication through layers destroys the signal. ReLU passes the gradient through unchanged where it is active. Both are non-linear, and ReLU does output zero — frequently, which is the "dying unit" problem.',
          hints: ['Think about what happens to the gradient as it travels back through twenty layers.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u7l2',
      title: 'Layers and the forward pass',
      intro:
        'Many neurons side by side make a layer; layers stacked make a network. Following one input all the way through is how the whole structure becomes concrete.',
      objectives: [
        'Describe the role of input, hidden and output layers',
        'Trace an input through a network to a prediction',
        'Choose the right output layer and loss for a given task'
      ],
      concepts: ['layers', 'forward-pass'],
      requires: ['neuron', 'activation', 'matrices'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Put several neurons side by side, each with its own weights, all reading the same inputs: that is a **layer**. Feed its outputs into another layer and you have a network.'
        },
        {
          kind: 'example',
          title: 'A small network',
          text: 'input layer     4 values (the features)\nhidden layer 1  8 neurons, ReLU\nhidden layer 2  8 neurons, ReLU\noutput layer    1 neuron, sigmoid\n\nParameters: (4×8 + 8) + (8×8 + 8) + (8×1 + 1) = 40 + 72 + 9 = 121\n\nEach count is weights plus biases. A hundred and twenty-one numbers, all set by training.'
        },
        { kind: 'heading', text: 'What each kind of layer is for' },
        {
          kind: 'list',
          items: [
            '**Input layer** — not really a layer, just the shape of the data. Four features means four inputs.',
            '**Hidden layers** — where representation happens. Each one builds features out of the layer below. This is where the capacity lives.',
            '**Output layer** — shaped by the task. One neuron for regression or binary classification; one per class for multiclass.'
          ]
        },
        { kind: 'heading', text: 'Choosing the output and the loss together' },
        {
          kind: 'table',
          headers: ['Task', 'Output layer', 'Activation', 'Loss'],
          rows: [
            ['Regression', '1 neuron', 'None', 'Mean squared error'],
            ['Binary classification', '1 neuron', 'Sigmoid', 'Binary cross-entropy'],
            ['Multiclass (one answer)', 'One per class', 'Softmax', 'Cross-entropy'],
            ['Multilabel (several answers)', 'One per label', 'Sigmoid on each', 'Binary cross-entropy on each']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Softmax for a multilabel problem is a real and common bug. Softmax forces the outputs to sum to 1, which asserts that exactly one label is true — so a photograph with two tags can never be represented. Sigmoid on each output lets several be true at once.'
        },
        { kind: 'heading', text: 'The forward pass, in order' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'The input vector arrives.',
            'Multiply by the first layer weight matrix, add the biases.',
            'Apply the activation function to each result.',
            'Those outputs become the input to the next layer. Repeat.',
            'At the output layer, apply the output activation. That is the prediction.',
            'Compare with the label. That is the loss.'
          ]
        },
        {
          kind: 'text',
          text: 'Done in batches — 32 or 64 examples at a time — the whole thing is a few matrix multiplications, which is exactly what a GPU does fastest. That is the link between the mathematics in Unit 06 and why this works at scale.'
        },
        { kind: 'heading', text: 'What hidden layers actually learn' },
        {
          kind: 'text',
          text: 'In a vision network trained on photographs, the pattern is consistent and visible: early layers respond to edges and simple colour gradients; middle layers to textures, corners and small parts; later layers to object parts and whole objects. Nobody designed that hierarchy. It emerged because that is an efficient way to build the features the task needed — which is what **representation learning** means.'
        },
        {
          kind: 'lab',
          appId: 'neural-lab',
          title: 'Trace a network',
          does:
            'Build a small network, feed one example through it, and read the values at each layer. Then change one weight in the first hidden layer and watch how far the change propagates by the output.'
        },
        { kind: 'check', questionId: 'u7l2q1' },
        { kind: 'check', questionId: 'u7l2q2' }
      ],
      questions: [
        {
          id: 'u7l2q1',
          kind: 'number',
          concept: 'layers',
          prompt: 'A layer takes 10 inputs and has 5 neurons. How many parameters does it have, including biases?',
          difficulty: 'intermediate',
          answer: 55,
          tolerance: 0.01,
          explanation: '10 × 5 = 50 weights, plus one bias per neuron, so 55.',
          hints: ['Every neuron has one weight per input, and one bias of its own.']
        },
        {
          id: 'u7l2q2',
          kind: 'choice',
          concept: 'layers',
          prompt:
            'You are tagging articles, and an article may have several tags at once. What output layer and loss?',
          difficulty: 'advanced',
          options: [
            'One neuron per tag with softmax, and cross-entropy',
            'One neuron per tag with sigmoid on each, and binary cross-entropy on each',
            'A single neuron with sigmoid',
            'A single neuron with no activation, and mean squared error'
          ],
          answer: 1,
          explanation:
            'This is multilabel: each tag is an independent yes/no. Sigmoid on each output allows several to be high simultaneously. Softmax would force them to sum to 1 and make multiple tags impossible to express.',
          hints: ['Can two outputs both be near 1 at the same time under softmax?']
        },
        {
          id: 'u7l2q3',
          kind: 'order',
          concept: 'forward-pass',
          prompt: 'Put the steps of a forward pass in order: apply activation, compute the loss, multiply by weights and add bias, read the input.',
          difficulty: 'beginner',
          options: ['read the input', 'multiply by weights and add bias', 'apply activation', 'compute the loss'],
          answer: [0, 1, 2, 3],
          explanation:
            'Input, weighted sum plus bias, activation — repeated per layer — then the loss once the prediction exists. The loss is last because it needs the prediction.',
          hints: ['Which step needs the output of all the others?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u7l3',
      title: 'Backpropagation, epochs and batches',
      intro:
        'How a network works out which of its millions of weights to blame, and the three numbers that govern training in practice.',
      objectives: [
        'Explain what backpropagation computes and why it is efficient',
        'Define epoch, batch and iteration, and compute how they relate',
        'Say what batch size trades against what'
      ],
      concepts: ['backpropagation', 'epochs-batches'],
      requires: ['forward-pass', 'gradients', 'gradient-descent'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Gradient descent needs the gradient: how the loss changes with respect to every parameter. With a million parameters, computing each one separately by nudging it and re-running the network would require a million forward passes per step. Training would be impossible.'
        },
        {
          kind: 'text',
          text: '**Backpropagation** gets all of them in roughly the cost of one extra pass, by working backwards from the loss and reusing what it has already computed. That is its entire contribution — not a different idea about learning, but the arithmetic that makes the obvious idea affordable.'
        },
        { kind: 'heading', text: 'How it works, in words' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Run the forward pass and keep the intermediate values at each layer.',
            'At the output, compute how the loss changes with the prediction. That is immediate.',
            'Step back one layer: the chain rule says the gradient for this layer is the gradient from above multiplied by how this layer transformed its input.',
            'Keep stepping back. Each layer passes a gradient to the one below.',
            'At each layer you now have the gradient for its own weights as well. Collect them.'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The chain rule is the whole mechanism: if the loss depends on this layer output, and that output depends on this weight, multiply the two rates of change. Backpropagation is that rule applied systematically from the end to the beginning, reusing each result on the way.'
        },
        { kind: 'heading', text: 'Epoch, batch, iteration' },
        {
          kind: 'table',
          headers: ['Term', 'Meaning'],
          rows: [
            ['Batch', 'The examples used for one parameter update'],
            ['Iteration (step)', 'One update: forward, backward, adjust'],
            ['Epoch', 'One complete pass over the whole training set'],
            ['Batch size', 'How many examples in a batch']
          ]
        },
        {
          kind: 'example',
          title: 'The arithmetic',
          text: '50,000 training examples, batch size 100.\n\n500 iterations make one epoch.\nTrain for 20 epochs → 10,000 parameter updates.\n\nEach update sees 100 examples; each example is seen 20 times in total.'
        },
        { kind: 'heading', text: 'What batch size trades' },
        {
          kind: 'table',
          headers: ['Batch size', 'Gradient', 'Speed', 'Other effects'],
          rows: [
            ['1 (fully stochastic)', 'Very noisy', 'Poor hardware use', 'Noise can escape flat regions'],
            ['32–256 (typical)', 'Reasonably accurate', 'Good hardware use', 'The usual choice'],
            ['Very large', 'Accurate', 'Excellent hardware use', 'Fewer updates per epoch; often generalises slightly worse'],
            ['Whole dataset', 'Exact', 'May not fit in memory', 'One update per epoch — far too slow']
          ]
        },
        {
          kind: 'text',
          text: 'The noise in a small-batch gradient is not purely a cost. An exact gradient follows the loss surface precisely, including into narrow crevices; a noisy one jiggles out of them, and the parameters it settles on tend to generalise a little better. This is a well-observed effect rather than a tidy theorem.'
        },
        { kind: 'heading', text: 'Reading a training run' },
        {
          kind: 'list',
          items: [
            'Training loss falling, validation loss falling — working. Continue.',
            'Training loss falling, validation loss rising — overfitting from here. Stop at the turn.',
            'Both flat and high — underfitting, or the learning rate is too small.',
            'Loss is NaN — almost always too large a learning rate, or a numerical fault such as a logarithm of zero.',
            'Loss falls, then jumps violently — the learning rate is too high for this stage; schedules exist to reduce it as training proceeds.'
          ]
        },
        {
          kind: 'lab',
          appId: 'neural-lab',
          title: 'Train one, and read the curves',
          does:
            'Train a small network and watch both losses. Then raise the learning rate until the loss diverges, and lower it until progress almost stops. Those two edges are what a sensible rate sits between.'
        },
        { kind: 'check', questionId: 'u7l3q1' },
        { kind: 'check', questionId: 'u7l3q2' },
        { kind: 'check', questionId: 'u7l3q3' }
      ],
      questions: [
        {
          id: 'u7l3q1',
          kind: 'number',
          concept: 'epochs-batches',
          prompt: '10,000 training examples and a batch size of 50. How many iterations make one epoch?',
          difficulty: 'beginner',
          answer: 200,
          tolerance: 0.01,
          explanation: '10,000 ÷ 50 = 200 updates to see every example once.',
          hints: ['How many batches does the training set divide into?']
        },
        {
          id: 'u7l3q2',
          kind: 'choice',
          concept: 'backpropagation',
          prompt: 'What makes backpropagation important?',
          difficulty: 'advanced',
          options: [
            'It finds the global minimum of the loss',
            'It computes the gradient for every parameter in about the cost of one extra pass, rather than one pass per parameter',
            'It removes the need for a learning rate',
            'It prevents overfitting'
          ],
          answer: 1,
          explanation:
            'Efficiency. The naive approach needs a forward pass per parameter; backpropagation gets them all in roughly one backward pass by reusing intermediate results. It makes no promise about global minima and does nothing about overfitting.',
          hints: ['What would the obvious alternative cost?']
        },
        {
          id: 'u7l3q3',
          kind: 'choice',
          concept: 'epochs-batches',
          prompt: 'Training loss falls steadily; validation loss falls, reaches a minimum at epoch 12, then rises. What should you do?',
          difficulty: 'intermediate',
          options: [
            'Train for longer — training loss is still improving',
            'Keep the model from around epoch 12 and stop there; everything after it is fitting noise',
            'Increase the learning rate',
            'Add more layers'
          ],
          answer: 1,
          explanation:
            'That turn is the boundary between learning the pattern and learning the data. Early stopping takes the model at the minimum of validation loss, which is the best model this run produced regardless of what training loss does afterwards.',
          hints: ['Which of the two curves is about unseen data?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u7l4',
      title: 'Making deep networks actually train',
      intro:
        'Depth was a good idea for thirty years before it worked. This is the handful of techniques that closed the gap — and transfer learning, which is how almost everybody uses deep learning in practice.',
      objectives: [
        'Explain vanishing and exploding gradients, and what fixes each',
        'Say what dropout, batch normalisation and sensible initialisation do',
        'Explain transfer learning and when to freeze layers'
      ],
      concepts: ['deep-learning', 'representation-learning', 'dropout', 'vanishing-gradients', 'transfer-learning'],
      requires: ['backpropagation', 'regularisation'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'Backpropagation multiplies gradients together as it travels back through layers. Multiplication is unforgiving: a chain of numbers slightly below one shrinks toward nothing, and a chain slightly above one grows without limit.'
        },
        {
          kind: 'example',
          title: 'The arithmetic that stopped depth working',
          text: '20 layers, each passing back a factor of 0.5:\n  0.5^20 ≈ 0.000001\n  → the first layers receive essentially no gradient. They never learn. Vanishing.\n\n20 layers, each passing back a factor of 1.5:\n  1.5^20 ≈ 3,325\n  → enormous updates, parameters fly off, loss becomes NaN. Exploding.'
        },
        {
          kind: 'table',
          headers: ['Problem', 'Symptom', 'What helps'],
          rows: [
            ['Vanishing gradients', 'Early layers barely change; training stalls', 'ReLU, careful initialisation, normalisation, residual connections'],
            ['Exploding gradients', 'Loss jumps or becomes NaN', 'Gradient clipping, lower learning rate, better initialisation'],
            ['Dead ReLU units', 'A unit outputs zero for every input, forever', 'Leaky ReLU, lower learning rate']
          ]
        },
        { kind: 'heading', text: 'Initialisation' },
        {
          kind: 'text',
          text: 'Start every weight at zero and every neuron in a layer computes the same thing and receives the same gradient — they stay identical forever, so the layer has the capacity of one neuron. Start them too large and activations saturate or explode. The usual schemes set the initial scale from the number of inputs to the layer, so the signal passing through keeps roughly the same size. It is one line of code and the difference between training and not.'
        },
        { kind: 'heading', text: 'Normalisation' },
        {
          kind: 'text',
          text: '**Batch normalisation** standardises the activations inside the network, using the statistics of the current batch, then lets the network rescale them with two learned parameters. The effect is that each layer receives inputs of a predictable size, which allows higher learning rates and makes training far less sensitive to initialisation. **Layer normalisation** does the same per example rather than per batch, which is why transformers use it.'
        },
        { kind: 'heading', text: 'Dropout' },
        {
          kind: 'text',
          text: 'During training, randomly set a fraction of the units in a layer to zero — a different random set each time. No unit can rely on any particular other unit being present, so the network cannot build a fragile chain of dependencies. At inference, dropout is switched off and all units participate.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Dropout makes training loss look worse than the model really is, because the model being measured during training is deliberately handicapped. A validation loss below training loss is the ordinary consequence, and not a fault.'
        },
        { kind: 'heading', text: 'Residual connections' },
        {
          kind: 'text',
          text: 'Add a layer input to its output: `output = f(x) + x`. The gradient now has a direct path backwards that is not multiplied by this layer transformation, so it reaches the early layers intact. This one change is what made networks of hundreds of layers trainable, and it is in essentially every modern architecture, transformers included.'
        },
        { kind: 'heading', text: 'Transfer learning' },
        {
          kind: 'text',
          text: 'Training a large network from scratch needs enormous data and compute. Almost nobody does it. Instead: take a network already trained on a vast dataset, keep what it learned, and adapt it to your much smaller task.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Start from pretrained weights.',
            'Replace the output layer with one shaped for your task.',
            '**Freeze** the early layers — keep their weights fixed — and train only the new head. Early layers hold general features like edges and textures, which your task also needs.',
            'If you have enough data, unfreeze the later layers and fine-tune them at a low learning rate.'
          ]
        },
        {
          kind: 'text',
          text: 'Why it works is representation learning: the early layers of a vision network have learned general-purpose visual features, and those are useful for nearly any visual task. A classifier that would need a million labelled images from scratch can be fine-tuned on a few thousand. This is the single most practically important technique in the unit.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Fine-tune at a much lower learning rate than you would use for training from scratch. Full-size steps on pretrained weights destroy what they learned in the first few batches — a failure that looks like the pretrained model having been useless.'
        },
        {
          kind: 'lab',
          appId: 'neural-lab',
          title: 'Depth, and what stops it working',
          does:
            'Train a shallow network, then a much deeper one with no normalisation, and compare how the early layers move. Then add normalisation and compare again.',
          optional: true
        },
        { kind: 'check', questionId: 'u7l4q1' },
        { kind: 'check', questionId: 'u7l4q2' },
        { kind: 'check', questionId: 'u7l4q3' }
      ],
      questions: [
        {
          id: 'u7l4q1',
          kind: 'choice',
          concept: 'vanishing-gradients',
          prompt: 'In a 30-layer network, the first layers barely change during training. What is happening?',
          difficulty: 'advanced',
          options: [
            'The learning rate is too high',
            'Vanishing gradients — the gradient is multiplied down through each layer and arrives at the early layers almost zero',
            'The network has too few parameters',
            'The data is not shuffled'
          ],
          answer: 1,
          explanation:
            'Gradients multiply as they travel back. Factors below one compound into near-nothing, so the early layers receive no useful signal. ReLU, careful initialisation, normalisation and residual connections all attack this.',
          hints: ['Follow the gradient backwards through thirty multiplications.']
        },
        {
          id: 'u7l4q2',
          kind: 'choice',
          concept: 'transfer-learning',
          prompt: 'You have 2,000 labelled images and need a classifier. What is the sensible approach?',
          difficulty: 'intermediate',
          options: [
            'Train a large network from scratch',
            'Start from a pretrained network, replace the output layer, freeze the early layers and train the head — then fine-tune at a low learning rate if it helps',
            'Use a linear model on raw pixels',
            'Collect a million more images first'
          ],
          answer: 1,
          explanation:
            'Two thousand images is far too few to learn general visual features from nothing. A pretrained network already has them; you are only learning how to combine them for your classes.',
          hints: ['What would the early layers have to learn, and do you have enough data to teach them?']
        },
        {
          id: 'u7l4q3',
          kind: 'choice',
          concept: 'dropout',
          prompt: 'Why is dropout switched off at inference time?',
          difficulty: 'advanced',
          options: [
            'Because it would be too slow',
            'Because it is a training-time regulariser — at inference you want the full network and a deterministic answer',
            'Because the weights have changed',
            'It is not; dropout stays on'
          ],
          answer: 1,
          explanation:
            'Dropout exists to stop the network relying on particular units while it is learning. At inference you want all the capacity you trained and the same answer every time, so it is disabled.',
          hints: ['What is dropout for, and does that purpose still apply once training is over?']
        }
      ]
    }
  ]
}
