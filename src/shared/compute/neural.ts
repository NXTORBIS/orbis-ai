import { randomSource } from './statistics.ts'

/**
 * Neural networks: forward pass, backpropagation, and training that actually trains.
 *
 * ## The gradients are the real gradients
 *
 * Backpropagation here is the chain rule applied layer by layer, and the test suite checks the result against
 * numerically estimated gradients — nudge a weight, see how the loss changes, compare. That check is the only thing
 * that can distinguish a correct implementation from a plausible one, because a wrong gradient still produces a loss
 * curve that goes down for a while.
 *
 * ## Every number shown was recorded
 *
 * The loss at each step, the accuracy at each step, the weights, the activations, the gradient magnitudes: all are
 * read out of the network as it trains. Nothing is a smooth curve drawn to look like training. A network that fails
 * to learn produces a flat loss curve, and that is what will be shown.
 *
 * ## What it is, precisely
 *
 * A fully connected feed-forward network trained by gradient descent. No convolution, no recurrence, no attention, no
 * batch normalisation, no adaptive optimiser beyond momentum. It runs on one thread in a few milliseconds per step,
 * which is enough to watch something learn and nothing like enough to train anything useful.
 *
 * Pure. No Electron, no DOM. Reuses `statistics.ts` for its random source.
 */

export interface NeuralError {
  error: string
  says: string
  fix: string
}

export const isNeuralError = (value: unknown): value is NeuralError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string): NeuralError => ({ error, says, fix })

export const NEURAL_LIMITS = Object.freeze({
  layers: 8,
  neurons: 128,
  /** The most weights a network may hold, which bounds how long a step takes. */
  weights: 200_000,
  rows: 20_000,
  steps: 100_000
})

// ---------------------------------------------------------------- activations

export type Activation = 'relu' | 'sigmoid' | 'tanh' | 'leaky-relu' | 'linear'

export const ACTIVATIONS: readonly Activation[] = Object.freeze(['relu', 'leaky-relu', 'tanh', 'sigmoid', 'linear'])

interface ActivationFacts {
  label: string
  about: string
  /** What goes wrong with it. */
  costs: string
}

export const ACTIVATION_FACTS: Readonly<Record<Activation, ActivationFacts>> = Object.freeze({
  relu: {
    label: 'ReLU',
    about: 'Passes anything positive through and turns anything negative to zero. The default almost everywhere, because it is simple and its gradient does not shrink.',
    costs: 'A neuron whose output is negative for every example has a gradient of exactly zero, so it never changes again — it is dead, and no amount of training brings it back.'
  },
  'leaky-relu': {
    label: 'Leaky ReLU',
    about: 'Like ReLU, but negative values are let through faintly rather than flattened to zero.',
    costs: 'Slightly more to compute, and the leak is one more number to choose. It exists only to stop neurons dying.'
  },
  tanh: {
    label: 'tanh',
    about: 'Squashes everything into the range −1 to 1, centred on zero.',
    costs: 'Far from zero the curve is almost flat, so the gradient nearly vanishes and learning stops. That is why deep networks moved away from it.'
  },
  sigmoid: {
    label: 'Sigmoid',
    about: 'Squashes everything into 0 to 1, which makes it the right choice for the output of a two-class problem.',
    costs: 'Its gradient is at most a quarter, so stacking several of them shrinks the gradient towards nothing — the vanishing gradient, and the reason deep networks were hard to train for years.'
  },
  linear: {
    label: 'None',
    about: 'Passes the value straight through. The right output for predicting a number.',
    costs: 'A network of only linear layers is equivalent to a single linear layer however many you stack. Without a curve somewhere, depth buys nothing at all.'
  }
})

const activate = (kind: Activation, z: number): number => {
  switch (kind) {
    case 'relu':
      return z > 0 ? z : 0
    case 'leaky-relu':
      return z > 0 ? z : 0.01 * z
    case 'tanh':
      return Math.tanh(z)
    case 'sigmoid':
      return 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, z))))
    case 'linear':
      return z
  }
}

/** The slope of the activation, worked out from its output where that is possible. */
const slope = (kind: Activation, z: number, a: number): number => {
  switch (kind) {
    case 'relu':
      return z > 0 ? 1 : 0
    case 'leaky-relu':
      return z > 0 ? 1 : 0.01
    case 'tanh':
      return 1 - a * a
    case 'sigmoid':
      return a * (1 - a)
    case 'linear':
      return 1
  }
}

// ---------------------------------------------------------------- the network

export interface LayerPlan {
  neurons: number
  activation: Activation
}

export interface Network {
  /** How many numbers go in. */
  inputs: number
  layers: readonly LayerPlan[]
  /** Weights per layer: one row per neuron, one column per input to that layer. */
  weights: readonly (readonly (readonly number[])[])[]
  biases: readonly (readonly number[])[]
  /** What the last layer is for. */
  task: 'classification' | 'regression'
  /** Class names, in the order the output neurons stand for them. */
  classes: readonly string[]
  seed: number
}

export interface NetworkFacts {
  inputs: number
  outputs: number
  /** Neurons in each hidden layer. */
  hidden: readonly number[]
  /** Weights and biases, counted. This is what "size" means for a network. */
  parameters: number
  depth: number
  task: Network['task']
  says: string
  notes: readonly string[]
}

export function describeNetwork(network: Network): NetworkFacts {
  let parameters = 0
  for (let at = 0; at < network.weights.length; at += 1) {
    for (const row of network.weights[at]) parameters += row.length
    parameters += network.biases[at].length
  }
  const hidden = network.layers.slice(0, -1).map((one) => one.neurons)
  const outputs = network.layers[network.layers.length - 1]?.neurons ?? 0

  const notes: string[] = []
  if (hidden.length === 0) {
    notes.push('With no hidden layer this is a single linear boundary, whatever the output activation. It cannot learn anything a straight line could not.')
  }
  if (network.layers.every((one) => one.activation === 'linear')) {
    notes.push(
      'Every layer is linear, so the whole network collapses to one linear layer however deep it is. Depth without a curve between the layers buys nothing — this is the single most important fact about activations.'
    )
  }
  if (network.layers.filter((one) => one.activation === 'sigmoid').length > 2) {
    notes.push('Several sigmoid layers stacked will shrink the gradient towards nothing by the time it reaches the first one. ReLU was adopted largely to avoid exactly this.')
  }

  return {
    inputs: network.inputs,
    outputs,
    hidden: Object.freeze(hidden),
    parameters,
    depth: network.layers.length,
    task: network.task,
    says: `${network.inputs} in, ${hidden.length === 0 ? 'no hidden layers' : `hidden ${hidden.join(' then ')}`}, ${outputs} out — ${parameters.toLocaleString()} weights and biases in all.`,
    notes: Object.freeze(notes)
  }
}

/**
 * Builds a network with its weights set to small random values.
 *
 * ## Why not zero
 *
 * Every weight at zero makes every neuron in a layer identical, and backpropagation then gives them all identical
 * gradients, so they stay identical for ever. The network is effectively one neuron wide however many there are. That
 * is the symmetry problem, and random starting weights are the whole solution to it.
 *
 * ## Why this particular scale
 *
 * Weights drawn with a spread of √(2/inputs) — He initialisation. Too large and the activations saturate immediately;
 * too small and the signal dies out as it goes forward. This scale keeps the variance of the activations roughly
 * constant from layer to layer, which is what makes a deep network trainable at all.
 */
export function build(
  inputs: number,
  layers: readonly LayerPlan[],
  options: { task?: Network['task']; classes?: readonly string[]; seed?: number } = {}
): Network | NeuralError {
  if (!Number.isInteger(inputs) || inputs < 1) return refuse('bad input count', `${inputs} is not a number of inputs.`, 'A network needs at least one input.')
  if (layers.length === 0) return refuse('no layers', 'A network needs at least an output layer.', 'Give it one layer with as many neurons as there are answers.')
  if (layers.length > NEURAL_LIMITS.layers) {
    return refuse('too deep', `${layers.length} layers is more than this will train.`, `Keep it to ${NEURAL_LIMITS.layers} or fewer.`)
  }
  for (const one of layers) {
    if (!Number.isInteger(one.neurons) || one.neurons < 1) return refuse('bad layer', `A layer of ${one.neurons} neurons is not usable.`, 'Every layer needs at least one neuron.')
    if (one.neurons > NEURAL_LIMITS.neurons) {
      return refuse('layer too wide', `${one.neurons} neurons is more than this will train.`, `Keep each layer to ${NEURAL_LIMITS.neurons} or fewer.`)
    }
    if (ACTIVATION_FACTS[one.activation] === undefined) {
      return refuse('unknown activation', `There is no activation called "${String(one.activation)}".`, `Try one of: ${ACTIVATIONS.join(', ')}.`)
    }
  }

  let parameters = 0
  let width = inputs
  for (const one of layers) {
    parameters += width * one.neurons + one.neurons
    width = one.neurons
  }
  if (parameters > NEURAL_LIMITS.weights) {
    return refuse(
      'too many weights',
      `That network would have ${parameters.toLocaleString()} weights, which is more than this will train on one thread.`,
      `Keep it under ${NEURAL_LIMITS.weights.toLocaleString()} — fewer or narrower layers.`
    )
  }

  const seed = options.seed ?? 1
  const random = randomSource(seed)
  // A normal-ish value from the sum of several uniform ones, which is enough for starting weights.
  const bell = (): number => random() + random() + random() + random() + random() + random() - 3

  const weights: number[][][] = []
  const biases: number[][] = []
  width = inputs
  for (const one of layers) {
    // He initialisation: a spread of root two over the number of inputs keeps the signal from dying or exploding.
    const spread = Math.sqrt(2 / width)
    weights.push(Array.from({ length: one.neurons }, () => Array.from({ length: width }, () => bell() * spread)))
    biases.push(new Array<number>(one.neurons).fill(0))
    width = one.neurons
  }

  return {
    inputs,
    layers: Object.freeze([...layers]),
    weights: Object.freeze(weights.map((one) => Object.freeze(one.map((two) => Object.freeze(two))))),
    biases: Object.freeze(biases.map((one) => Object.freeze(one))),
    task: options.task ?? 'classification',
    classes: Object.freeze([...(options.classes ?? [])]),
    seed
  }
}

export interface Pass {
  /** What went in. */
  input: readonly number[]
  /** Each layer's weighted sums, before the activation. */
  sums: readonly (readonly number[])[]
  /** Each layer's outputs, after the activation. */
  activations: readonly (readonly number[])[]
  /** The last layer's output. */
  output: readonly number[]
  /** For classification, the output turned into probabilities that add to one. */
  probabilities: readonly number[] | null
  /** What it says, where there are class names. */
  answer: string | number
  confidence: number | null
}

/**
 * Softmax, computed stably.
 *
 * Subtracting the largest value first changes nothing mathematically and everything numerically: without it, an
 * exponent of a few hundred overflows to infinity and every probability comes out as not-a-number. That is the
 * commonest numerical bug in the whole subject.
 */
const softmax = (values: readonly number[]): number[] => {
  const most = Math.max(...values)
  const raised = values.map((one) => Math.exp(one - most))
  const total = raised.reduce((a, b) => a + b, 0)
  return raised.map((one) => one / total)
}

/** Runs one example forward through the network, keeping everything backpropagation will need. */
export function forward(network: Network, input: readonly number[]): Pass | NeuralError {
  if (input.length !== network.inputs) {
    return refuse('wrong width', `This network takes ${network.inputs} input${network.inputs === 1 ? '' : 's'} and was given ${input.length}.`, 'Give the same features in the same order.')
  }
  if (input.some((one) => !Number.isFinite(one))) return refuse('bad input', 'One of the inputs is not a number.', 'Every input needs a number.')

  const sums: number[][] = []
  const activations: number[][] = []
  let current = [...input]

  for (let at = 0; at < network.layers.length; at += 1) {
    const layer = network.layers[at]
    const z: number[] = []
    const a: number[] = []
    for (let n = 0; n < layer.neurons; n += 1) {
      let total = network.biases[at][n]
      const row = network.weights[at][n]
      for (let i = 0; i < current.length; i += 1) total += row[i] * current[i]
      z.push(total)
      a.push(activate(layer.activation, total))
    }
    sums.push(z)
    activations.push(a)
    current = a
  }

  const output = activations[activations.length - 1]
  const probabilities = network.task === 'classification' && output.length > 1 ? softmax(output) : null

  let answer: string | number
  let confidence: number | null = null
  if (network.task === 'regression') {
    answer = output[0]
  } else if (output.length === 1) {
    // One output neuron means two classes, with the value read as the chance of the first.
    const chance = output[0]
    answer = network.classes[chance >= 0.5 ? 0 : 1] ?? String(chance >= 0.5)
    confidence = Math.max(chance, 1 - chance)
  } else {
    const best = (probabilities ?? output).reduce((bestAt, one, at, all) => (one > all[bestAt] ? at : bestAt), 0)
    answer = network.classes[best] ?? `output ${best}`
    confidence = probabilities?.[best] ?? null
  }

  return {
    input: Object.freeze([...input]),
    sums: Object.freeze(sums.map((one) => Object.freeze(one))),
    activations: Object.freeze(activations.map((one) => Object.freeze(one))),
    output: Object.freeze([...output]),
    probabilities: probabilities === null ? null : Object.freeze(probabilities),
    answer,
    confidence
  }
}

export interface Gradients {
  /** One per layer, the same shape as the weights. */
  weights: readonly (readonly (readonly number[])[])[]
  biases: readonly (readonly number[])[]
  loss: number
}

/**
 * Backpropagation: the gradient of the loss with respect to every weight.
 *
 * ## It is the chain rule, applied backwards
 *
 * The error at the output is known directly. For each earlier layer the error is the next layer's error carried back
 * through the weights and multiplied by the slope of this layer's activation. That is all backpropagation is, and
 * writing it out makes the vanishing-gradient problem obvious: every layer multiplies by a slope, and if those slopes
 * are small the product heads to nothing.
 *
 * ## Checked against numerical gradients
 *
 * The test suite nudges each weight and measures how the loss moves, and compares that with what this returns. A
 * wrong gradient produces a loss that falls for a while before going wrong, so nothing short of that check
 * distinguishes a correct implementation from a convincing one.
 */
export function backward(network: Network, input: readonly number[], target: readonly number[]): Gradients | NeuralError {
  const pass = forward(network, input)
  if (isNeuralError(pass)) return pass
  const outputLayer = network.layers.length - 1
  if (target.length !== network.layers[outputLayer].neurons) {
    return refuse(
      'wrong target width',
      `The output layer has ${network.layers[outputLayer].neurons} neuron${network.layers[outputLayer].neurons === 1 ? '' : 's'} and the target has ${target.length} value${target.length === 1 ? '' : 's'}.`,
      'Give one target value per output neuron.'
    )
  }

  const weightGradients: number[][][] = network.weights.map((layer) => layer.map((row) => new Array<number>(row.length).fill(0)))
  const biasGradients: number[][] = network.biases.map((one) => new Array<number>(one.length).fill(0))

  /*
   * The error at the output.
   *
   * The loss is the *mean* squared difference, so differentiating it brings a factor of two over the number of
   * outputs. Leaving that out gives a gradient that points the right way and is the wrong size — which trains
   * perfectly well at a different effective learning rate, and is exactly the kind of wrongness only a numerical
   * gradient check catches. It did: the gradients were out by a factor of two except where there happened to be two
   * outputs, in which case the factor cancelled and everything looked correct.
   */
  let delta: number[] = []
  let loss = 0
  const output = pass.activations[outputLayer]
  const scale = 2 / output.length
  for (let n = 0; n < output.length; n += 1) {
    const difference = output[n] - target[n]
    loss += difference * difference
    delta.push(scale * difference * slope(network.layers[outputLayer].activation, pass.sums[outputLayer][n], output[n]))
  }
  loss /= output.length

  // Backwards through the layers.
  for (let at = outputLayer; at >= 0; at -= 1) {
    const inputsToLayer = at === 0 ? input : pass.activations[at - 1]
    for (let n = 0; n < delta.length; n += 1) {
      biasGradients[at][n] += delta[n]
      for (let i = 0; i < inputsToLayer.length; i += 1) weightGradients[at][n][i] += delta[n] * inputsToLayer[i]
    }
    if (at === 0) break

    // The next error back: this layer's error through the weights, times the slope of the earlier activation.
    const earlier = new Array<number>(network.layers[at - 1].neurons).fill(0)
    for (let n = 0; n < delta.length; n += 1) {
      const row = network.weights[at][n]
      for (let i = 0; i < earlier.length; i += 1) earlier[i] += delta[n] * row[i]
    }
    for (let i = 0; i < earlier.length; i += 1) {
      earlier[i] *= slope(network.layers[at - 1].activation, pass.sums[at - 1][i], pass.activations[at - 1][i])
    }
    delta = earlier
  }

  return {
    weights: Object.freeze(weightGradients.map((one) => Object.freeze(one.map((two) => Object.freeze(two))))),
    biases: Object.freeze(biasGradients.map((one) => Object.freeze(one))),
    loss
  }
}

// ---------------------------------------------------------------- training

export interface TrainingData {
  rows: readonly (readonly number[])[]
  /** One target vector per row. */
  targets: readonly (readonly number[])[]
  /** Class names, for a classifier. */
  classes?: readonly string[]
}

export interface Step {
  step: number
  loss: number
  /** Only for classification. */
  accuracy: number | null
  /** The largest absolute gradient this step, which is how a gradient exploding or vanishing shows up. */
  largestGradient: number
  /** The mean absolute gradient in the first layer, which is where a vanishing gradient shows first. */
  firstLayerGradient: number
}

export interface Training {
  network: Network
  history: readonly Step[]
  steps: number
  /** True when the loss stopped improving. */
  settled: boolean
  /** Neurons whose output was zero for every example, which for ReLU means dead. */
  deadNeurons: readonly { layer: number; neuron: number }[]
  finalLoss: number
  finalAccuracy: number | null
  settings: Readonly<Record<string, number | string>>
  says: string
  notes: readonly string[]
}

/**
 * Trains the network by gradient descent.
 *
 * ## Mini-batches, because that is what is actually done
 *
 * Averaging the gradient over a handful of examples rather than one is both less noisy than one and far cheaper than
 * all of them. The batch size is a real setting with a real effect, which the loss curve shows: a small batch gives a
 * noisy curve that often ends up lower, a large one a smooth curve that can stall.
 *
 * ## Dead neurons are counted, not hidden
 *
 * A ReLU neuron that outputs zero for every example has a gradient of zero and will never change again. Counting
 * them is the difference between "the network is not learning" and "a third of it is switched off permanently".
 */
export function trainNetwork(
  start: Network,
  data: TrainingData,
  settings: { rate?: number; steps?: number; batch?: number; momentum?: number; seed?: number } = {}
): Training | NeuralError {
  if (data.rows.length === 0) return refuse('no data', 'There is nothing to train on.', 'Give it some examples.')
  if (data.rows.length !== data.targets.length) {
    return refuse('mismatched', `There are ${data.rows.length} rows and ${data.targets.length} targets.`, 'Every row needs one target.')
  }
  if (data.rows.length > NEURAL_LIMITS.rows) {
    return refuse('too much data', `${data.rows.length.toLocaleString()} rows is more than this will train on.`, `Keep it under ${NEURAL_LIMITS.rows.toLocaleString()}.`)
  }

  const rate = settings.rate ?? 0.05
  const steps = Math.max(1, Math.min(NEURAL_LIMITS.steps, Math.floor(settings.steps ?? 200)))
  const batch = Math.max(1, Math.min(data.rows.length, Math.floor(settings.batch ?? Math.min(32, data.rows.length))))
  const momentum = Math.max(0, Math.min(0.99, settings.momentum ?? 0.9))
  if (!(rate > 0)) return refuse('bad rate', `A learning rate of ${rate} will not learn.`, 'Use something above zero, such as 0.05.')

  // Mutable copies, because training is the act of changing them.
  const weights = start.weights.map((layer) => layer.map((row) => [...row]))
  const biases = start.biases.map((one) => [...one])
  const weightVelocity = weights.map((layer) => layer.map((row) => new Array<number>(row.length).fill(0)))
  const biasVelocity = biases.map((one) => new Array<number>(one.length).fill(0))

  const random = randomSource(settings.seed ?? start.seed)
  const history: Step[] = []
  const everPositive = start.layers.map((one) => new Array<boolean>(one.neurons).fill(false))

  let settled = false
  for (let step = 0; step < steps; step += 1) {
    const network: Network = { ...start, weights, biases }

    // One mini-batch, drawn at random. With a batch as large as the data this is the whole set each time.
    const chosen: number[] = []
    if (batch >= data.rows.length) for (let i = 0; i < data.rows.length; i += 1) chosen.push(i)
    else for (let i = 0; i < batch; i += 1) chosen.push(Math.floor(random() * data.rows.length))

    const weightSum = weights.map((layer) => layer.map((row) => new Array<number>(row.length).fill(0)))
    const biasSum = biases.map((one) => new Array<number>(one.length).fill(0))
    let loss = 0
    let right = 0

    for (const at of chosen) {
      const made = backward(network, data.rows[at], data.targets[at])
      if (isNeuralError(made)) return made
      loss += made.loss
      for (let layer = 0; layer < weightSum.length; layer += 1) {
        for (let n = 0; n < weightSum[layer].length; n += 1) {
          biasSum[layer][n] += made.biases[layer][n]
          for (let i = 0; i < weightSum[layer][n].length; i += 1) weightSum[layer][n][i] += made.weights[layer][n][i]
        }
      }

      const pass = forward(network, data.rows[at])
      if (isNeuralError(pass)) return pass
      // Any neuron that was ever positive is not dead, which is what has to be tracked over the whole run.
      for (let layer = 0; layer < pass.activations.length; layer += 1) {
        for (let n = 0; n < pass.activations[layer].length; n += 1) {
          if (pass.activations[layer][n] > 0) everPositive[layer][n] = true
        }
      }
      if (start.task === 'classification') {
        const wanted = data.targets[at].reduce((bestAt, one, i, all) => (one > all[bestAt] ? i : bestAt), 0)
        const got = pass.output.reduce((bestAt, one, i, all) => (one > all[bestAt] ? i : bestAt), 0)
        if (wanted === got) right += 1
      }
    }

    loss /= chosen.length
    let largest = 0
    let firstLayerTotal = 0
    let firstLayerCount = 0

    for (let layer = 0; layer < weights.length; layer += 1) {
      for (let n = 0; n < weights[layer].length; n += 1) {
        const biasGradient = biasSum[layer][n] / chosen.length
        biasVelocity[layer][n] = momentum * biasVelocity[layer][n] - rate * biasGradient
        biases[layer][n] += biasVelocity[layer][n]
        if (Math.abs(biasGradient) > largest) largest = Math.abs(biasGradient)
        for (let i = 0; i < weights[layer][n].length; i += 1) {
          const gradient = weightSum[layer][n][i] / chosen.length
          weightVelocity[layer][n][i] = momentum * weightVelocity[layer][n][i] - rate * gradient
          weights[layer][n][i] += weightVelocity[layer][n][i]
          if (Math.abs(gradient) > largest) largest = Math.abs(gradient)
          if (layer === 0) {
            firstLayerTotal += Math.abs(gradient)
            firstLayerCount += 1
          }
        }
      }
    }

    history.push({
      step,
      loss,
      accuracy: start.task === 'classification' ? right / chosen.length : null,
      largestGradient: largest,
      firstLayerGradient: firstLayerCount === 0 ? 0 : firstLayerTotal / firstLayerCount
    })

    // Settled when the loss has stopped moving over the last stretch.
    if (step > 20) {
      const recent = history.slice(-10).map((one) => one.loss)
      const before = history.slice(-20, -10).map((one) => one.loss)
      const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length
      if (Math.abs(mean(recent) - mean(before)) < 1e-9) {
        settled = true
        break
      }
    }
  }

  const trained: Network = { ...start, weights, biases }
  const deadNeurons: { layer: number; neuron: number }[] = []
  for (let layer = 0; layer < everPositive.length; layer += 1) {
    // Only meaningful where a negative value is flattened to nothing.
    if (start.layers[layer].activation !== 'relu') continue
    for (let n = 0; n < everPositive[layer].length; n += 1) {
      if (!everPositive[layer][n]) deadNeurons.push({ layer, neuron: n })
    }
  }

  const first = history[0]
  const last = history[history.length - 1]
  const notes: string[] = []

  if (last.loss >= first.loss) {
    notes.push(
      `The loss did not come down: it started at ${first.loss.toFixed(4)} and ended at ${last.loss.toFixed(4)}. Either the learning rate is too large and it is overshooting, or there is nothing in the inputs that predicts the answer.`
    )
  } else {
    notes.push(`The loss came down from ${first.loss.toFixed(4)} to ${last.loss.toFixed(4)} over ${history.length} steps.`)
  }
  if (deadNeurons.length > 0) {
    const byLayer = new Map<number, number>()
    for (const one of deadNeurons) byLayer.set(one.layer, (byLayer.get(one.layer) ?? 0) + 1)
    notes.push(
      `${deadNeurons.length} ReLU neuron${deadNeurons.length === 1 ? '' : 's'} never produced a positive value for any example (${[...byLayer].map(([layer, count]) => `${count} in layer ${layer + 1}`).join(', ')}). Their gradient is exactly zero, so they will never change again — that part of the network is switched off permanently. A smaller learning rate, or leaky ReLU, avoids it.`
    )
  }
  if (last.largestGradient > 1e3) {
    notes.push(`The gradients reached ${last.largestGradient.toExponential(1)}, which is far too large. The weights are being thrown about rather than adjusted; lower the learning rate.`)
  }
  if (last.firstLayerGradient > 0 && last.firstLayerGradient < 1e-7 && start.layers.length > 2) {
    notes.push(
      `The gradient reaching the first layer is ${last.firstLayerGradient.toExponential(1)} — effectively nothing. Each layer multiplies it by the slope of its activation, and through several squashing activations the product heads to zero. That is the vanishing gradient, and it is why the early layers of a deep sigmoid network barely learn.`
    )
  }
  if (!settled && history.length === steps) {
    notes.push('The loss was still moving when the steps ran out, so this is where it had reached rather than where it settles.')
  }

  return {
    network: trained,
    history: Object.freeze(history),
    steps: history.length,
    settled,
    deadNeurons: Object.freeze(deadNeurons),
    finalLoss: last.loss,
    finalAccuracy: last.accuracy,
    settings: Object.freeze({ rate, steps, batch, momentum, seed: settings.seed ?? start.seed }),
    says:
      start.task === 'classification'
        ? `${history.length} steps; loss ${first.loss.toFixed(4)} → ${last.loss.toFixed(4)}, getting ${((last.accuracy ?? 0) * 100).toFixed(0)}% of the last batch right.`
        : `${history.length} steps; loss ${first.loss.toFixed(4)} → ${last.loss.toFixed(4)}.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- checking the gradients

export interface GradientCheck {
  /** The largest difference found between the computed and the measured gradient. */
  worstDifference: number
  /** Relative to the size of the gradient, which is the figure that matters. */
  worstRelative: number
  checked: number
  passed: boolean
  says: string
  notes: readonly string[]
}

/**
 * Compares the computed gradients against numerically measured ones.
 *
 * ## Why this exists in the engine rather than only in the tests
 *
 * It is the only way to know a gradient is right. A wrong gradient still produces a loss curve that falls for a while,
 * so a network that appears to be learning proves nothing. Nudging a weight by a tiny amount and measuring how the
 * loss actually moves is slow — it needs two forward passes per weight — but it is ground truth, and having it
 * available means a doubt can be settled rather than argued about.
 */
export function checkGradients(network: Network, input: readonly number[], target: readonly number[], nudge = 1e-5): GradientCheck | NeuralError {
  const computed = backward(network, input, target)
  if (isNeuralError(computed)) return computed

  const lossAt = (weights: readonly (readonly (readonly number[])[])[], biases: readonly (readonly number[])[]): number | NeuralError => {
    const pass = forward({ ...network, weights, biases }, input)
    if (isNeuralError(pass)) return pass
    let total = 0
    for (let n = 0; n < pass.output.length; n += 1) total += (pass.output[n] - target[n]) ** 2
    return total / pass.output.length
  }

  let worstDifference = 0
  let worstRelative = 0
  let checked = 0

  for (let layer = 0; layer < network.weights.length; layer += 1) {
    for (let n = 0; n < network.weights[layer].length; n += 1) {
      for (let i = 0; i < network.weights[layer][n].length; i += 1) {
        const nudged = (by: number): (readonly (readonly number[])[])[] =>
          network.weights.map((one, l) =>
            l !== layer ? one : one.map((row, r) => (r !== n ? row : row.map((value, c) => (c === i ? value + by : value))))
          )
        const up = lossAt(nudged(nudge), network.biases)
        if (isNeuralError(up)) return up
        const down = lossAt(nudged(-nudge), network.biases)
        if (isNeuralError(down)) return down

        // The central difference, which is accurate to the square of the nudge rather than to the nudge itself.
        const measured = (up - down) / (2 * nudge)
        const difference = Math.abs(measured - computed.weights[layer][n][i])
        const size = Math.max(Math.abs(measured), Math.abs(computed.weights[layer][n][i]), 1e-8)
        if (difference > worstDifference) worstDifference = difference
        if (difference / size > worstRelative) worstRelative = difference / size
        checked += 1
      }
    }
  }

  // A relative difference under a thousandth is what a correct implementation gives with a nudge this size.
  const passed = worstRelative < 1e-3

  return {
    worstDifference,
    worstRelative,
    checked,
    passed,
    says: passed
      ? `All ${checked} gradients agree with the measured ones to within ${(worstRelative * 100).toExponential(1)}%.`
      : `A gradient is wrong: the worst disagrees with the measured value by ${(worstRelative * 100).toFixed(2)}%.`,
    notes: Object.freeze([
      'Each weight is nudged up and down by a tiny amount and the loss measured both times. The slope that gives is compared with what backpropagation computed.',
      'This needs two forward passes per weight, so it is far too slow to do while training. It is how an implementation is proved correct once.',
      ...(passed ? [] : ['A wrong gradient still makes the loss fall for a while, which is why this check exists at all rather than watching the loss.'])
    ])
  }
}

// ---------------------------------------------------------------- problems to learn

export type Problem = 'and' | 'or' | 'xor' | 'two-blobs' | 'rings' | 'spiral' | 'sine'

export const PROBLEMS: readonly Problem[] = Object.freeze(['and', 'or', 'xor', 'two-blobs', 'rings', 'spiral', 'sine'])

export const PROBLEM_ABOUT: Readonly<Record<Problem, string>> = Object.freeze({
  and: 'Both inputs on. Separable by one straight line, so a network with no hidden layer learns it.',
  or: 'Either input on. Also separable by one line.',
  xor: 'One input on but not both. **Not** separable by any straight line — a network with no hidden layer cannot learn it at all, however long it trains. This is the problem that showed hidden layers were necessary.',
  'two-blobs': 'Two separated groups of points. Easy, and the right first thing to try.',
  rings: 'One group inside a ring of another. Needs a curved boundary, so it needs a hidden layer.',
  spiral: 'Two interleaved spirals. Needs a considerably more elaborate boundary than a ring, so it shows what width and depth buy.',
  sine: 'Predicting a sine wave from its input. A regression rather than a classification, and it needs enough neurons to bend the line that many times.'
})

export function problem(which: Problem, options: { rows?: number; seed?: number } = {}): TrainingData & { inputs: number; outputs: number; task: Network['task'] } | NeuralError {
  const count = Math.max(4, Math.min(NEURAL_LIMITS.rows, Math.floor(options.rows ?? 200)))
  const random = randomSource(options.seed ?? 3)

  switch (which) {
    case 'and':
    case 'or':
    case 'xor': {
      const rows = [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1]
      ]
      const answer = (a: number, b: number): number => (which === 'and' ? (a && b ? 1 : 0) : which === 'or' ? (a || b ? 1 : 0) : a !== b ? 1 : 0)
      return {
        rows,
        targets: rows.map(([a, b]) => [answer(a, b)]),
        classes: ['on', 'off'],
        inputs: 2,
        outputs: 1,
        task: 'classification'
      }
    }
    case 'two-blobs': {
      const rows: number[][] = []
      const targets: number[][] = []
      for (let i = 0; i < count; i += 1) {
        const first = i % 2 === 0
        rows.push([(first ? -1 : 1) + (random() - 0.5) * 0.8, (first ? -1 : 1) + (random() - 0.5) * 0.8])
        targets.push(first ? [1, 0] : [0, 1])
      }
      return { rows, targets, classes: ['left', 'right'], inputs: 2, outputs: 2, task: 'classification' }
    }
    case 'rings': {
      const rows: number[][] = []
      const targets: number[][] = []
      for (let i = 0; i < count; i += 1) {
        const inner = i % 2 === 0
        const angle = random() * Math.PI * 2
        const radius = inner ? random() * 0.5 : 1.2 + random() * 0.4
        rows.push([radius * Math.cos(angle), radius * Math.sin(angle)])
        targets.push(inner ? [1, 0] : [0, 1])
      }
      return { rows, targets, classes: ['inside', 'outside'], inputs: 2, outputs: 2, task: 'classification' }
    }
    case 'spiral': {
      const rows: number[][] = []
      const targets: number[][] = []
      for (let i = 0; i < count; i += 1) {
        const arm = i % 2
        const t = (i / count) * 3.2
        const angle = t * 2 + arm * Math.PI
        const radius = 0.15 + t * 0.4
        rows.push([radius * Math.cos(angle) + (random() - 0.5) * 0.08, radius * Math.sin(angle) + (random() - 0.5) * 0.08])
        targets.push(arm === 0 ? [1, 0] : [0, 1])
      }
      return { rows, targets, classes: ['one arm', 'the other'], inputs: 2, outputs: 2, task: 'classification' }
    }
    case 'sine': {
      const rows: number[][] = []
      const targets: number[][] = []
      for (let i = 0; i < count; i += 1) {
        const x = (i / (count - 1)) * 2 - 1
        rows.push([x])
        targets.push([Math.sin(x * Math.PI * 1.5)])
      }
      return { rows, targets, inputs: 1, outputs: 1, task: 'regression' }
    }
    default:
      return refuse('unknown problem', `There is no problem called "${String(which)}".`, `Try one of: ${PROBLEMS.join(', ')}.`)
  }
}

/** How well a trained network does on data, counted. */
export interface NetworkScore {
  accuracy: number | null
  loss: number
  tested: number
  says: string
}

export function scoreNetwork(network: Network, data: TrainingData): NetworkScore | NeuralError {
  if (data.rows.length === 0) return refuse('nothing to score', 'There is no data.', 'Give it some examples.')
  let loss = 0
  let right = 0
  for (let at = 0; at < data.rows.length; at += 1) {
    const pass = forward(network, data.rows[at])
    if (isNeuralError(pass)) return pass
    for (let n = 0; n < pass.output.length; n += 1) loss += (pass.output[n] - data.targets[at][n]) ** 2
    if (network.task === 'classification') {
      const wanted = data.targets[at].reduce((bestAt, one, i, all) => (one > all[bestAt] ? i : bestAt), 0)
      const got = pass.output.reduce((bestAt, one, i, all) => (one > all[bestAt] ? i : bestAt), 0)
      // One output neuron means two classes read off a threshold rather than an argmax.
      if (pass.output.length === 1) {
        if ((pass.output[0] >= 0.5 ? 1 : 0) === (data.targets[at][0] >= 0.5 ? 1 : 0)) right += 1
      } else if (wanted === got) right += 1
    }
  }
  const tested = data.rows.length
  const accuracy = network.task === 'classification' ? right / tested : null
  return {
    accuracy,
    loss: loss / (tested * (data.targets[0]?.length ?? 1)),
    tested,
    says:
      accuracy === null
        ? `Loss ${(loss / tested).toFixed(5)} over ${tested} examples.`
        : `${right} of ${tested} right — ${(accuracy * 100).toFixed(1)}%.`
  }
}

export const NEURAL_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A fully connected feed-forward network and nothing else. No convolution, no recurrence, no attention, no normalisation layers, no dropout.',
  'Trained by gradient descent with momentum. There is no adaptive optimiser, no learning-rate schedule and no weight decay.',
  'The loss is squared error throughout, including for classification, where cross-entropy would train faster. Squared error keeps the gradient derivation short enough to read.',
  'Everything runs on one thread in this process. The sizes allowed are enough to watch something learn and nowhere near enough to train anything useful.',
  'Nothing is pre-trained and nothing is downloaded. Every weight in every network here started as a small random number in this session.',
  'Every figure reported — the loss, the accuracy, the gradients, the dead neurons — is read out of the network as it runs. None of it is estimated or drawn to look right.'
])
