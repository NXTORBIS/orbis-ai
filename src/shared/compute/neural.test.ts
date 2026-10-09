import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTIVATIONS,
  backward,
  build,
  checkGradients,
  describeNetwork,
  forward,
  isNeuralError,
  PROBLEMS,
  problem,
  scoreNetwork,
  trainNetwork,
  type Network,
  type TrainingData,
  type NeuralError
} from './neural.ts'

/**
 * What the neural engine is held to.
 *
 * The central test is the gradient check: every weight nudged, the loss measured, and the result compared with what
 * backpropagation computed. Nothing else can tell a correct implementation from a convincing one, because a wrong
 * gradient still produces a loss curve that falls for a while.
 *
 * After that, the properties that matter are the ones that are famously true: a network with no hidden layer cannot
 * learn exclusive-or however long it trains, and one with a hidden layer can.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, NeuralError> => {
  assert.ok(!isNeuralError(value), isNeuralError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, NeuralError>
}

const task = (which: Parameters<typeof problem>[0], rows = 200): TrainingData & { inputs: number; outputs: number; task: Network['task'] } =>
  ok(problem(which, { rows, seed: 3 }))

describe('building a network', () => {
  it('counts its own weights and biases', () => {
    const made = ok(build(2, [{ neurons: 4, activation: 'relu' }, { neurons: 1, activation: 'sigmoid' }]))
    const facts = describeNetwork(made)
    // 2×4 + 4 bias, then 4×1 + 1 bias.
    assert.equal(facts.parameters, 8 + 4 + 4 + 1)
    assert.deepEqual([...facts.hidden], [4])
    assert.equal(facts.outputs, 1)
  })

  it('does not start every weight at zero, which would make the layer one neuron wide', () => {
    /*
     * The symmetry problem. Identical weights give identical gradients, so the neurons stay identical for ever and a
     * layer of 20 behaves as a layer of 1. Random starting weights are the whole fix.
     */
    const made = ok(build(3, [{ neurons: 8, activation: 'relu' }, { neurons: 2, activation: 'sigmoid' }]))
    const firstLayer = made.weights[0]
    const rows = new Set(firstLayer.map((row) => row.join(',')))
    assert.equal(rows.size, firstLayer.length, 'two neurons started with identical weights')
    assert.ok(firstLayer.flat().some((one) => one !== 0), 'every weight started at zero')
  })

  it('the same seed builds the same network', () => {
    const a = ok(build(2, [{ neurons: 4, activation: 'relu' }, { neurons: 1, activation: 'sigmoid' }], { seed: 9 }))
    const b = ok(build(2, [{ neurons: 4, activation: 'relu' }, { neurons: 1, activation: 'sigmoid' }], { seed: 9 }))
    assert.deepEqual(a.weights, b.weights)
  })

  it('says when a network of only linear layers is pointless', () => {
    const made = ok(build(2, [{ neurons: 8, activation: 'linear' }, { neurons: 1, activation: 'linear' }]))
    const facts = describeNetwork(made)
    assert.ok(facts.notes.some((one) => /collapses to one linear layer/.test(one)))
  })

  it('says when a network has no hidden layer at all', () => {
    const facts = describeNetwork(ok(build(2, [{ neurons: 1, activation: 'sigmoid' }])))
    assert.ok(facts.notes.some((one) => /single linear boundary/.test(one)))
  })

  it('warns about stacking several sigmoid layers', () => {
    const facts = describeNetwork(
      ok(
        build(2, [
          { neurons: 4, activation: 'sigmoid' },
          { neurons: 4, activation: 'sigmoid' },
          { neurons: 4, activation: 'sigmoid' },
          { neurons: 1, activation: 'sigmoid' }
        ])
      )
    )
    assert.ok(facts.notes.some((one) => /shrink the gradient/.test(one)))
  })

  it('refuses a network it cannot build', () => {
    assert.ok(isNeuralError(build(0, [{ neurons: 1, activation: 'relu' }])))
    assert.ok(isNeuralError(build(2, [])))
    assert.ok(isNeuralError(build(2, [{ neurons: 0, activation: 'relu' }])))
    assert.ok(isNeuralError(build(2, [{ neurons: 9999, activation: 'relu' }])))
    assert.ok(isNeuralError(build(2, [{ neurons: 4, activation: 'nonsense' as never }])))
  })

  it('refuses a network with more weights than it will train', () => {
    const deep = Array.from({ length: 8 }, () => ({ neurons: 128, activation: 'relu' as const }))
    // A wide input layer is what pushes it over: 1,000 inputs into 128 neurons is 128,000 weights in the first
    // layer alone.
    assert.ok(isNeuralError(build(1_000, deep)))
  })
})

describe('the forward pass', () => {
  it('works out a known answer by hand', () => {
    // One neuron, weights 2 and 3, bias 1, no activation: 2×4 + 3×5 + 1 = 24.
    const made: Network = {
      inputs: 2,
      layers: [{ neurons: 1, activation: 'linear' }],
      weights: [[[2, 3]]],
      biases: [[1]],
      task: 'regression',
      classes: [],
      seed: 1
    }
    assert.equal(ok(forward(made, [4, 5])).output[0], 24)
  })

  it('every activation does what it says', () => {
    for (const activation of ACTIVATIONS) {
      const made: Network = {
        inputs: 1,
        layers: [{ neurons: 1, activation }],
        weights: [[[1]]],
        biases: [[0]],
        task: 'regression',
        classes: [],
        seed: 1
      }
      const positive = ok(forward(made, [2])).output[0]
      const negative = ok(forward(made, [-2])).output[0]
      switch (activation) {
        case 'relu':
          assert.equal(positive, 2)
          assert.equal(negative, 0)
          break
        case 'leaky-relu':
          assert.equal(positive, 2)
          assert.ok(negative < 0 && negative > -0.1, `leaky relu of -2 was ${negative}`)
          break
        case 'tanh':
          assert.ok(positive > 0.9 && positive < 1)
          assert.ok(Math.abs(positive + negative) < 1e-12, 'tanh is odd')
          break
        case 'sigmoid':
          assert.ok(positive > 0.5 && positive < 1)
          assert.ok(Math.abs(positive + negative - 1) < 1e-12, 'sigmoid of x and of −x add to one')
          break
        case 'linear':
          assert.equal(positive, 2)
          assert.equal(negative, -2)
          break
      }
    }
  })

  it('keeps the sums and activations of every layer, which backpropagation needs', () => {
    const made = ok(build(3, [{ neurons: 5, activation: 'relu' }, { neurons: 2, activation: 'sigmoid' }]))
    const pass = ok(forward(made, [1, 2, 3]))
    assert.equal(pass.sums.length, 2)
    assert.equal(pass.activations.length, 2)
    assert.equal(pass.activations[0].length, 5)
    assert.equal(pass.activations[1].length, 2)
  })

  it('the probabilities add to one', () => {
    const made = ok(build(2, [{ neurons: 6, activation: 'relu' }, { neurons: 3, activation: 'linear' }], { classes: ['a', 'b', 'c'] }))
    const pass = ok(forward(made, [0.4, -0.7]))
    assert.ok(pass.probabilities !== null)
    assert.ok(Math.abs((pass.probabilities ?? []).reduce((a, b) => a + b, 0) - 1) < 1e-12)
  })

  it('an enormous output does not become not-a-number', () => {
    /*
     * The commonest numerical bug in the subject: an exponent of a few hundred overflows, and every probability
     * becomes not-a-number. Subtracting the largest value first is what prevents it.
     */
    const made: Network = {
      inputs: 1,
      layers: [{ neurons: 3, activation: 'linear' }],
      weights: [[[1000], [0], [-1000]]],
      biases: [[0, 0, 0]],
      task: 'classification',
      classes: ['big', 'middle', 'small'],
      seed: 1
    }
    const pass = ok(forward(made, [1]))
    for (const one of pass.probabilities ?? []) assert.ok(Number.isFinite(one), 'a probability was not a number')
    assert.equal(pass.answer, 'big')
  })

  it('refuses the wrong number of inputs, and says how many it wants', () => {
    const made = ok(build(3, [{ neurons: 1, activation: 'sigmoid' }]))
    const wrong = forward(made, [1, 2])
    assert.ok(isNeuralError(wrong))
    assert.match(wrong.says, /takes 3 inputs/)
    assert.ok(isNeuralError(forward(made, [1, 2, Number.NaN])))
  })
})

describe('the gradients', () => {
  it('agree with numerically measured ones, on every activation', () => {
    /*
     * The test the whole engine rests on. Each weight is nudged up and down, the loss measured both times, and the
     * slope that gives compared with what backpropagation computed. A wrong gradient still makes a loss curve fall
     * for a while, so there is no substitute for this.
     */
    for (const activation of ACTIVATIONS) {
      const made = ok(
        build(3, [
          { neurons: 4, activation },
          { neurons: 2, activation: 'sigmoid' }
        ], { seed: 5 })
      )
      const check = ok(checkGradients(made, [0.5, -0.3, 0.8], [1, 0]))
      assert.equal(check.passed, true, `${activation}: ${check.says}`)
      assert.ok(check.checked > 0)
    }
  })

  it('agree on a deeper network too', () => {
    const made = ok(
      build(2, [
        { neurons: 5, activation: 'tanh' },
        { neurons: 4, activation: 'relu' },
        { neurons: 3, activation: 'tanh' },
        { neurons: 1, activation: 'sigmoid' }
      ], { seed: 11 })
    )
    const check = ok(checkGradients(made, [0.6, -0.2], [0.3]))
    assert.equal(check.passed, true, check.says)
  })

  it('agree for a regression output', () => {
    const made = ok(build(2, [{ neurons: 4, activation: 'tanh' }, { neurons: 1, activation: 'linear' }], { task: 'regression', seed: 2 }))
    assert.equal(ok(checkGradients(made, [0.7, 0.1], [2.5])).passed, true)
  })

  it('the gradient is zero where the loss is already nothing', () => {
    const made: Network = {
      inputs: 1,
      layers: [{ neurons: 1, activation: 'linear' }],
      weights: [[[2]]],
      biases: [[0]],
      task: 'regression',
      classes: [],
      seed: 1
    }
    // The network outputs exactly 4 for an input of 2, so asking for 4 leaves nothing to fix.
    const made2 = ok(backward(made, [2], [4]))
    assert.equal(made2.loss, 0)
    assert.equal(made2.weights[0][0][0], 0)
  })

  it('refuses a target of the wrong width', () => {
    const made = ok(build(2, [{ neurons: 3, activation: 'sigmoid' }]))
    const wrong = backward(made, [1, 2], [1])
    assert.ok(isNeuralError(wrong))
    assert.match(wrong.says, /3 neurons/)
  })

  it('a dead ReLU neuron really has a gradient of exactly zero', () => {
    // A neuron whose weighted sum is negative outputs zero and its gradient is zero, which is why it never recovers.
    const made: Network = {
      inputs: 1,
      layers: [{ neurons: 1, activation: 'relu' }, { neurons: 1, activation: 'linear' }],
      weights: [[[-5]], [[1]]],
      biases: [[-10], [0]],
      task: 'regression',
      classes: [],
      seed: 1
    }
    const gradients = ok(backward(made, [1], [1]))
    assert.equal(gradients.weights[0][0][0], 0, 'a dead neuron must have no gradient at all')
  })
})

describe('training', () => {
  it('learns AND, which one straight line can separate', () => {
    const data = task('and')
    const made = ok(build(data.inputs, [{ neurons: 1, activation: 'sigmoid' }], { classes: data.classes, seed: 4 }))
    const trained = ok(trainNetwork(made, data, { rate: 0.5, steps: 3_000, batch: 4 }))
    const score = ok(scoreNetwork(trained.network, data))
    assert.equal(score.accuracy, 1, `it got ${score.says}`)
  })

  it('learns OR as well', () => {
    const data = task('or')
    const made = ok(build(data.inputs, [{ neurons: 1, activation: 'sigmoid' }], { classes: data.classes, seed: 4 }))
    const trained = ok(trainNetwork(made, data, { rate: 0.5, steps: 3_000, batch: 4 }))
    assert.equal(ok(scoreNetwork(trained.network, data)).accuracy, 1)
  })

  it('cannot learn exclusive-or with no hidden layer, however long it trains', () => {
    /*
     * The result that showed hidden layers were necessary, and the one worth pinning hardest. Exclusive-or is not
     * separable by any straight line, so a network that draws one straight line cannot do better than three out of
     * four whatever happens.
     */
    const data = task('xor')
    const flat = ok(build(data.inputs, [{ neurons: 1, activation: 'sigmoid' }], { classes: data.classes, seed: 4 }))
    const trained = ok(trainNetwork(flat, data, { rate: 0.5, steps: 5_000, batch: 4 }))
    const score = ok(scoreNetwork(trained.network, data))
    assert.ok((score.accuracy ?? 0) < 1, `a single layer got exclusive-or completely right, which is impossible: ${score.says}`)
  })

  it('and learns it with one, which is the whole reason hidden layers exist', () => {
    const data = task('xor')
    const deep = ok(
      build(data.inputs, [{ neurons: 4, activation: 'tanh' }, { neurons: 1, activation: 'sigmoid' }], { classes: data.classes, seed: 6 })
    )
    const trained = ok(trainNetwork(deep, data, { rate: 0.3, steps: 6_000, batch: 4 }))
    const score = ok(scoreNetwork(trained.network, data))
    assert.equal(score.accuracy, 1, `with a hidden layer it should get all four: ${score.says}`)
  })

  it('the loss actually comes down, and every value is a real number', () => {
    const data = task('two-blobs', 200)
    const made = ok(build(data.inputs, [{ neurons: 6, activation: 'relu' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 8 }))
    const trained = ok(trainNetwork(made, data, { rate: 0.1, steps: 300 }))
    assert.ok(trained.history.length > 10)
    assert.ok(trained.finalLoss < trained.history[0].loss, `loss went from ${trained.history[0].loss} to ${trained.finalLoss}`)
    for (const step of trained.history) {
      assert.ok(Number.isFinite(step.loss) && step.loss >= 0, `loss at step ${step.step} was ${step.loss}`)
      assert.ok(Number.isFinite(step.largestGradient))
    }
  })

  it('learns a ring, which needs a curved boundary', () => {
    const data = task('rings', 300)
    const made = ok(build(data.inputs, [{ neurons: 10, activation: 'tanh' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 12 }))
    const trained = ok(trainNetwork(made, data, { rate: 0.15, steps: 1_500, batch: 32 }))
    const score = ok(scoreNetwork(trained.network, data))
    assert.ok((score.accuracy ?? 0) > 0.9, `it managed ${score.says}`)
  })

  it('fits a sine wave, which is a regression', () => {
    const data = task('sine', 120)
    const made = ok(build(1, [{ neurons: 12, activation: 'tanh' }, { neurons: 1, activation: 'linear' }], { task: 'regression', seed: 15 }))
    const trained = ok(trainNetwork(made, data, { rate: 0.05, steps: 3_000, batch: 32 }))
    const score = ok(scoreNetwork(trained.network, data))
    assert.ok(score.loss < 0.05, `the loss was ${score.loss}`)
    assert.equal(score.accuracy, null, 'a regression has no accuracy')
  })

  it('too few neurons cannot fit a sine wave, and more can', () => {
    const data = task('sine', 120)
    const scoreWith = (neurons: number): number => {
      const made = ok(build(1, [{ neurons, activation: 'tanh' }, { neurons: 1, activation: 'linear' }], { task: 'regression', seed: 15 }))
      const trained = ok(trainNetwork(made, data, { rate: 0.05, steps: 2_000, batch: 32 }))
      return ok(scoreNetwork(trained.network, data)).loss
    }
    assert.ok(scoreWith(12) < scoreWith(1), 'twelve neurons should fit a sine far better than one')
  })

  it('counts dead ReLU neurons and explains them', () => {
    // A large learning rate drives ReLU neurons negative and they never come back.
    const data = task('two-blobs', 200)
    const made = ok(build(data.inputs, [{ neurons: 20, activation: 'relu' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 20 }))
    const trained = ok(trainNetwork(made, data, { rate: 5, steps: 200 }))
    if (trained.deadNeurons.length > 0) {
      assert.ok(trained.notes.some((one) => /never produced a positive value/.test(one)))
      assert.ok(trained.notes.some((one) => /leaky ReLU/.test(one)))
    }
  })

  it('says plainly when the loss did not come down', () => {
    const data = task('xor')
    const made = ok(build(data.inputs, [{ neurons: 1, activation: 'sigmoid' }], { classes: data.classes, seed: 4 }))
    const trained = ok(trainNetwork(made, data, { rate: 1e-8, steps: 60, batch: 4 }))
    if (trained.finalLoss >= trained.history[0].loss) {
      assert.ok(trained.notes.some((one) => /did not come down/.test(one)))
    }
  })

  it('says when the gradients exploded', () => {
    const data = task('two-blobs', 100)
    const made = ok(build(data.inputs, [{ neurons: 8, activation: 'linear' }, { neurons: 2, activation: 'linear' }], { classes: data.classes, seed: 2 }))
    const trained = ok(trainNetwork(made, data, { rate: 50, steps: 60 }))
    if (trained.history[trained.history.length - 1].largestGradient > 1e3) {
      assert.ok(trained.notes.some((one) => /far too large/.test(one)))
    }
  })

  it('the same seed trains the same way', () => {
    const data = task('two-blobs', 100)
    const made = ok(build(data.inputs, [{ neurons: 4, activation: 'relu' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 7 }))
    const a = ok(trainNetwork(made, data, { rate: 0.1, steps: 100, seed: 1 }))
    const b = ok(trainNetwork(made, data, { rate: 0.1, steps: 100, seed: 1 }))
    assert.deepEqual(a.history.map((one) => one.loss), b.history.map((one) => one.loss))
  })

  it('training does not change the network it started from', () => {
    // The starting network has to stay untouched, or a comparison between two training runs is meaningless.
    const data = task('two-blobs', 80)
    const made = ok(build(data.inputs, [{ neurons: 4, activation: 'relu' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 7 }))
    const before = JSON.stringify(made.weights)
    ok(trainNetwork(made, data, { rate: 0.2, steps: 200 }))
    assert.equal(JSON.stringify(made.weights), before, 'training changed the starting network')
  })

  it('the gradients are still correct after training', () => {
    const data = task('two-blobs', 100)
    const made = ok(build(data.inputs, [{ neurons: 5, activation: 'tanh' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 9 }))
    const trained = ok(trainNetwork(made, data, { rate: 0.1, steps: 200 }))
    assert.equal(ok(checkGradients(trained.network, data.rows[0], data.targets[0])).passed, true)
  })

  it('refuses what it cannot train on', () => {
    const made = ok(build(2, [{ neurons: 1, activation: 'sigmoid' }]))
    assert.ok(isNeuralError(trainNetwork(made, { rows: [], targets: [] })))
    assert.ok(isNeuralError(trainNetwork(made, { rows: [[1, 2]], targets: [] })))
    assert.ok(isNeuralError(trainNetwork(made, { rows: [[1, 2]], targets: [[1]] }, { rate: 0 })))
  })
})

describe('the problems', () => {
  it('every problem builds with the shape it says', () => {
    for (const which of PROBLEMS) {
      const made = task(which, 40)
      assert.ok(made.rows.length > 0, which)
      assert.equal(made.rows[0].length, made.inputs, which)
      assert.equal(made.targets[0].length, made.outputs, which)
      assert.equal(made.rows.length, made.targets.length, which)
    }
  })

  it('exclusive-or really is the awkward one', () => {
    const made = task('xor')
    // The two classes are the diagonals, which is exactly what no single line separates.
    assert.deepEqual(made.targets.map((one) => one[0]), [0, 1, 1, 0])
  })

  it('a spiral needs more than a ring does', () => {
    const ring = task('rings', 200)
    const spiral = task('spiral', 200)
    const scoreOn = (data: typeof ring, neurons: number): number => {
      const made = ok(build(2, [{ neurons, activation: 'tanh' }, { neurons: 2, activation: 'sigmoid' }], { classes: data.classes, seed: 14 }))
      const trained = ok(trainNetwork(made, data, { rate: 0.15, steps: 1_200, batch: 32 }))
      return ok(scoreNetwork(trained.network, data)).accuracy ?? 0
    }
    // A small network manages a ring and struggles with a spiral, which is what "more elaborate boundary" means.
    assert.ok(scoreOn(ring, 6) > scoreOn(spiral, 6), 'a ring should be easier than a spiral at the same size')
  })

  it('the same seed gives the same problem', () => {
    const a = ok(problem('rings', { rows: 50, seed: 4 }))
    const b = ok(problem('rings', { rows: 50, seed: 4 }))
    assert.deepEqual(a.rows, b.rows)
  })

  it('refuses a problem it does not have', () => {
    assert.ok(isNeuralError(problem('nonsense' as never)))
  })
})
