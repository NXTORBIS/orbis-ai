import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyScaling,
  components,
  crossValidate,
  describe as describeDataset,
  fitScaling,
  isLearningError,
  MODEL_KINDS,
  overfitCheck,
  predict,
  SAMPLE_DATASETS,
  sampleDataset,
  scoreClassifier,
  scoreRegression,
  split,
  train,
  type Dataset,
  type LearningError
} from './learning.machine.ts'

/**
 * What the machine-learning engine is held to.
 *
 * The properties here are the ones that distinguish a model that was fitted from one that was not: a regression on a
 * noiseless line must recover the line's actual coefficients, a straight boundary must fail on data that needs a
 * curve, and k-means must find the groups that were put there. A model returning plausible numbers would fail every
 * one of them.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, LearningError> => {
  assert.ok(!isLearningError(value), isLearningError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, LearningError>
}

const data = (which: Parameters<typeof sampleDataset>[0], rows = 200): Dataset => ok(sampleDataset(which, { rows, seed: 7 }))

describe('datasets', () => {
  it('every sample dataset builds and describes itself', () => {
    for (const which of SAMPLE_DATASETS) {
      const made = data(which, 60)
      const facts = ok(describeDataset(made))
      assert.ok(facts.rows > 0, which)
      assert.equal(facts.features, made.featureNames.length, which)
      assert.ok(facts.says.length > 10, which)
    }
  })

  it('the same seed gives the same data every time', () => {
    const a = ok(sampleDataset('two-blobs', { rows: 50, seed: 3 }))
    const b = ok(sampleDataset('two-blobs', { rows: 50, seed: 3 }))
    assert.deepEqual(a.rows, b.rows)
    assert.deepEqual(a.targets, b.targets)
  })

  it('tells a classification set from a regression one', () => {
    assert.equal(ok(describeDataset(data('two-blobs'))).kind, 'classification')
    assert.equal(ok(describeDataset(data('line'))).kind, 'regression')
  })

  it('warns when accuracy alone will not tell you anything', () => {
    const facts = ok(describeDataset(data('unbalanced')))
    assert.ok(facts.classes !== null)
    assert.ok(facts.notes.some((one) => /accuracy alone/.test(one)))
  })

  it('warns when the features are on wildly different scales', () => {
    const made: Dataset = {
      rows: Array.from({ length: 40 }, (_, i) => [i * 1000, i * 0.001]),
      targets: Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'a' : 'b')),
      featureNames: ['big', 'small'],
      targetName: 'group'
    }
    const facts = ok(describeDataset(made))
    assert.ok(facts.notes.some((one) => /scaled first/.test(one)))
  })

  it('refuses what cannot be learned from', () => {
    assert.ok(isLearningError(describeDataset({ rows: [], targets: [], featureNames: [], targetName: 'y' })))
    assert.ok(isLearningError(describeDataset({ rows: [[1]], targets: [], featureNames: ['x'], targetName: 'y' })))
    assert.ok(isLearningError(describeDataset({ rows: [[1], [2]], targets: ['a', 'a'], featureNames: ['x'], targetName: 'y' })))
    assert.ok(isLearningError(describeDataset({ rows: [[1, 2], [3]], targets: ['a', 'b'], featureNames: ['x', 'y'], targetName: 'y' })))
  })

  it('refuses a set where every answer is the same, because there is nothing to tell apart', () => {
    const made = describeDataset({ rows: [[1], [2], [3]], targets: ['same', 'same', 'same'], featureNames: ['x'], targetName: 'y' })
    assert.ok(isLearningError(made))
    assert.match(made.says, /same answer/)
  })
})

describe('splitting', () => {
  it('holds back roughly the fraction asked for', () => {
    const made = ok(split(data('two-blobs', 200), 0.25))
    assert.ok(Math.abs(made.test.rows.length - 50) <= 4, `held back ${made.test.rows.length}`)
    assert.equal(made.train.rows.length + made.test.rows.length, 200)
  })

  it('keeps each class present in both halves, which a plain split can fail to do', () => {
    const made = ok(split(data('unbalanced', 200), 0.25))
    const classesIn = (one: Dataset): Set<string> => new Set(one.targets.map(String))
    assert.ok(classesIn(made.train).has('rare'), 'the rare class must be in the training half')
    assert.ok(classesIn(made.test).has('rare'), 'and in the testing half')
    assert.ok(made.notes.some((one) => /same share/.test(one)))
  })

  it('no row is in both halves', () => {
    const made = ok(split(data('three-blobs', 90), 0.3))
    const seen = new Set(made.train.rows.map((one) => one.join(',')))
    for (const row of made.test.rows) {
      assert.ok(!seen.has(row.join(',')), 'a row appears in both halves')
    }
  })

  it('refuses a fraction that is not one, and one that leaves nothing to learn from', () => {
    assert.ok(isLearningError(split(data('two-blobs', 50), 0)))
    assert.ok(isLearningError(split(data('two-blobs', 50), 1)))
    assert.ok(isLearningError(split({ rows: [[1], [2]], targets: ['a', 'b'], featureNames: ['x'], targetName: 'y' }, 0.9)))
  })

  it('the same seed splits the same way', () => {
    const a = ok(split(data('two-blobs', 100), 0.25, { seed: 11 }))
    const b = ok(split(data('two-blobs', 100), 0.25, { seed: 11 }))
    assert.deepEqual(a.test.rows, b.test.rows)
  })
})

describe('scaling', () => {
  it('standardising gives every feature a mean of about zero and a spread of about one', () => {
    const made = data('flowers', 120)
    const scaling = ok(fitScaling(made, 'standardise'))
    const scaled = applyScaling(made, scaling)
    const facts = ok(describeDataset(scaled))
    for (const one of facts.featureStats) {
      assert.ok(Math.abs(one.mean) < 1e-9, `${one.name} mean was ${one.mean}`)
      assert.ok(Math.abs(one.spread - 1) < 1e-9, `${one.name} spread was ${one.spread}`)
    }
  })

  it('normalising puts everything between nought and one', () => {
    const made = data('flowers', 120)
    const scaled = applyScaling(made, ok(fitScaling(made, 'normalise')))
    for (const row of scaled.rows) {
      for (const value of row) assert.ok(value >= -1e-12 && value <= 1 + 1e-12, `value was ${value}`)
    }
  })

  it('a feature that never varies is left alone rather than divided by zero', () => {
    const made: Dataset = {
      rows: Array.from({ length: 20 }, (_, i) => [i, 5]),
      targets: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'a' : 'b')),
      featureNames: ['varies', 'constant'],
      targetName: 'group'
    }
    const scaled = applyScaling(made, ok(fitScaling(made)))
    for (const row of scaled.rows) assert.ok(Number.isFinite(row[1]), 'a constant feature produced a value that is not a number')
  })

  it('a scaling fitted on the training half applies unchanged to the testing half', () => {
    // The thing that stops information leaking from the held-out data into the model.
    const made = ok(split(data('flowers', 120), 0.25))
    const scaling = ok(fitScaling(made.train))
    const trainScaled = applyScaling(made.train, scaling)
    const testScaled = applyScaling(made.test, scaling)
    const trainFacts = ok(describeDataset(trainScaled))
    const testFacts = ok(describeDataset(testScaled))
    assert.ok(Math.abs(trainFacts.featureStats[0].mean) < 1e-9, 'the training half is centred')
    // The testing half is not exactly centred, and must not be — that would mean its own statistics were used.
    assert.ok(Math.abs(testFacts.featureStats[0].mean) > 1e-12 || made.test.rows.length < 3)
  })
})

describe('the models', () => {
  it('every model in the list trains on something it suits', () => {
    const suits: Readonly<Record<string, Parameters<typeof data>[0]>> = {
      'nearest-neighbours': 'two-blobs',
      'decision-tree': 'two-blobs',
      logistic: 'two-blobs',
      linear: 'line',
      'k-means': 'three-blobs'
    }
    for (const kind of MODEL_KINDS) {
      const made = train(data(suits[kind], 80), kind, { groups: 3 })
      assert.ok(!isLearningError(made), `${kind}: ${isLearningError(made) ? made.says : ''}`)
    }
  })

  it('refuses a classifier on a numeric target, and a regression on classes', () => {
    const wrong = train(data('line', 40), 'logistic')
    assert.ok(isLearningError(wrong))
    assert.match(wrong.says, /classes/)
    const alsoWrong = train(data('two-blobs', 40), 'linear')
    assert.ok(isLearningError(alsoWrong))
    assert.match(alsoWrong.says, /predicts a number/)
  })

  it('nearest neighbours separates two clear blobs nearly perfectly', () => {
    const made = ok(split(data('two-blobs', 200), 0.3))
    const model = ok(train(made.train, 'nearest-neighbours', { neighbours: 5 }))
    const score = ok(scoreClassifier(model, made.test))
    assert.ok(score.accuracy > 0.9, `accuracy was ${score.accuracy}`)
    assert.equal(model.trainedOn, made.train.rows.length)
    assert.match(model.says, /does its work when asked/)
  })

  it('a straight boundary fails on a ring and nearest neighbours does not — which is what linear costs', () => {
    /*
     * The clearest demonstration in the whole subject. A ring around a blob cannot be separated by any straight line,
     * so logistic regression is reduced to guessing while a distance-based method manages easily.
     */
    const made = ok(split(data('rings', 300), 0.3))
    const straight = ok(train(made.train, 'logistic', { iterations: 400 }))
    const neighbours = ok(train(made.train, 'nearest-neighbours', { neighbours: 5 }))
    const straightScore = ok(scoreClassifier(straight, made.test))
    const neighbourScore = ok(scoreClassifier(neighbours, made.test))
    assert.ok(neighbourScore.accuracy > 0.9, `nearest neighbours only managed ${neighbourScore.accuracy}`)
    assert.ok(straightScore.accuracy < 0.7, `a straight boundary managed ${straightScore.accuracy}, which is too good to be true on a ring`)
    assert.ok(straight.notes.some((one) => /straight/.test(one)))
  })

  it('the same is true of opposite corners, which no single line can split', () => {
    const made = ok(split(data('xor', 300), 0.3))
    const straight = ok(scoreClassifier(ok(train(made.train, 'logistic', { iterations: 400 })), made.test))
    const tree = ok(scoreClassifier(ok(train(made.train, 'decision-tree', { depth: 4 })), made.test))
    assert.ok(straight.accuracy < 0.7, `a straight boundary managed ${straight.accuracy}`)
    assert.ok(tree.accuracy > 0.85, `a tree only managed ${tree.accuracy}`)
  })

  it('a decision tree records the questions it chose and why', () => {
    const model = ok(train(data('two-blobs', 100), 'decision-tree', { depth: 3 }))
    assert.match(model.says, /question/)
    assert.match(model.says, /separated the classes/)
    assert.equal(model.settings.depth, 3)
  })

  it('a deeper tree fits the training data better and generalises worse', () => {
    /*
     * Overfitting, demonstrated rather than described — on a ring, where a tree needs many splits to approximate a
     * curved boundary and an unlimited one ends up drawing round the individual training points. On easily separated
     * data there is no gap to find, which is itself worth knowing.
     */
    const made = ok(split(data('rings', 260), 0.35))
    const deep = ok(train(made.train, 'decision-tree', { depth: 20, leastLeaf: 1 }))
    const deepFit = ok(overfitCheck(deep, made.train, made.test))
    assert.ok(deepFit.onTraining > 0.95, `an unlimited tree should nearly memorise its training data, got ${deepFit.onTraining}`)
    assert.ok(deepFit.onTesting < deepFit.onTraining, 'and do worse on data it never saw')
    assert.ok(deep.notes.some((one) => /memoris/.test(one)))
  })

  it('logistic regression records the loss it actually reached, falling', () => {
    const model = ok(train(data('two-blobs', 200), 'logistic', { rate: 0.1, iterations: 300 }))
    assert.ok(model.history.length > 1)
    assert.ok(model.history[model.history.length - 1] < model.history[0], 'the loss must come down')
    assert.equal(model.iterations, model.history.length)
    // Every value recorded, none invented.
    for (const one of model.history) assert.ok(Number.isFinite(one) && one >= 0)
  })

  it('says when the loss was still moving rather than claiming it had settled', () => {
    const model = ok(train(data('two-blobs', 200), 'logistic', { rate: 0.001, iterations: 5 }))
    assert.equal(model.converged, false)
    assert.ok(model.notes.some((one) => /still moving/.test(one)))
  })

  it('says when the learning rate is overshooting', () => {
    const model = ok(train(data('two-blobs', 100), 'logistic', { rate: 500, iterations: 40 }))
    if (model.history[model.history.length - 1] > model.history[0]) {
      assert.ok(model.notes.some((one) => /too large/.test(one)))
    }
  })

  it('refuses logistic regression on more than two classes, and says what to use', () => {
    const made = train(data('three-blobs', 60), 'logistic')
    assert.ok(isLearningError(made))
    assert.match(made.fix, /decision tree|nearest/)
  })

  it('a linear fit recovers the line that was actually there', () => {
    // y = 3x + 7, with no noise. A fitted model must find those numbers; one that did not fit cannot.
    const model = ok(train(data('line', 100), 'linear'))
    const coefficients = (model.model as { coefficients: number[] }).coefficients
    assert.ok(Math.abs(coefficients[0] - 7) < 1e-6, `intercept was ${coefficients[0]}`)
    assert.ok(Math.abs(coefficients[1] - 3) < 1e-6, `slope was ${coefficients[1]}`)
  })

  it('a curve needs a curve: degree 2 beats degree 1 on curved data', () => {
    const made = ok(split(data('curve', 200), 0.3))
    const straight = ok(scoreRegression(ok(train(made.train, 'linear', { degree: 1 })), made.test))
    const curved = ok(scoreRegression(ok(train(made.train, 'linear', { degree: 2 })), made.test))
    assert.ok(curved.r2 > straight.r2 + 0.3, `straight ${straight.r2.toFixed(3)}, curved ${curved.r2.toFixed(3)}`)
  })

  it('refuses a curve over several features, and says why', () => {
    const several: Dataset = {
      rows: Array.from({ length: 40 }, (_, i) => [i, i * 0.5 + 1]),
      targets: Array.from({ length: 40 }, (_, i) => i * 2),
      featureNames: ['a', 'b'],
      targetName: 'y'
    }
    const made = train(several, 'linear', { degree: 3 })
    assert.ok(isLearningError(made))
    assert.match(made.says, /single feature/)
  })

  it('refuses a fit where two features are the same thing', () => {
    const made = train(
      { rows: Array.from({ length: 20 }, (_, i) => [i, i * 2]), targets: Array.from({ length: 20 }, (_, i) => i), featureNames: ['x', 'twice x'], targetName: 'y' },
      'linear'
    )
    assert.ok(isLearningError(made))
    assert.match(made.says, /too alike/)
  })

  it('k-means finds the groups that were put there', () => {
    const made = data('three-blobs', 300)
    const model = ok(train(made, 'k-means', { groups: 3, seed: 5 }))
    const assignment = (model.model as { assignment: number[] }).assignment

    /*
     * The real property: each found group should be almost entirely one of the real ones. k-means does not know the
     * labels, so this checks that the grouping *agrees* with them rather than that it guessed their names.
     */
    for (let group = 0; group < 3; group += 1) {
      const members = made.targets.filter((_, at) => assignment[at] === group).map(String)
      if (members.length === 0) continue
      const counts = new Map<string, number>()
      for (const one of members) counts.set(one, (counts.get(one) ?? 0) + 1)
      const purity = Math.max(...counts.values()) / members.length
      assert.ok(purity > 0.8, `group ${group + 1} is only ${(purity * 100).toFixed(0)}% one real class`)
    }
  })

  it('k-means stops when nothing moves, and records the distance falling', () => {
    const model = ok(train(data('three-blobs', 200), 'k-means', { groups: 3, seed: 5 }))
    assert.equal(model.converged, true)
    assert.ok(model.history.length > 1)
    // The total distance it minimises can only fall.
    for (let i = 1; i < model.history.length; i += 1) {
      assert.ok(model.history[i] <= model.history[i - 1] + 1e-9, 'the total distance went up')
    }
  })

  it('k-means is honest that it cannot tell you how many groups there are', () => {
    const three = ok(train(data('three-blobs', 200), 'k-means', { groups: 3, seed: 5 }))
    const six = ok(train(data('three-blobs', 200), 'k-means', { groups: 6, seed: 5 }))
    const last = (one: typeof three): number => one.history[one.history.length - 1]
    // More groups always means less total distance, which is why it is not a way of choosing.
    assert.ok(last(six) < last(three))
    assert.ok(three.notes.some((one) => /cannot tell you how many/.test(one)))
  })

  it('the same seed gives the same grouping', () => {
    const a = ok(train(data('three-blobs', 150), 'k-means', { groups: 3, seed: 9 }))
    const b = ok(train(data('three-blobs', 150), 'k-means', { groups: 3, seed: 9 }))
    assert.deepEqual((a.model as { assignment: number[] }).assignment, (b.model as { assignment: number[] }).assignment)
  })
})

describe('predicting', () => {
  it('refuses a row with the wrong number of features', () => {
    const model = ok(train(data('flowers', 60), 'nearest-neighbours'))
    const made = predict(model, [1, 2])
    assert.ok(isLearningError(made))
    assert.match(made.says, /4/)
  })

  it('refuses a row with a value that is not a number', () => {
    const model = ok(train(data('two-blobs', 60), 'nearest-neighbours'))
    assert.ok(isLearningError(predict(model, [Number.NaN, 1])))
  })

  it('nearest neighbours gives a confidence from the vote', () => {
    const model = ok(train(data('two-blobs', 100), 'nearest-neighbours', { neighbours: 5 }))
    const made = ok(predict(model, [2, 2]))
    assert.equal(made.answer, 'left')
    assert.ok((made.confidence ?? 0) >= 0.6, `confidence was ${made.confidence}`)
  })

  it('logistic regression gives a probability rather than a bare answer', () => {
    const model = ok(train(data('two-blobs', 200), 'logistic', { iterations: 400 }))
    const confident = ok(predict(model, [2, 2]))
    const unsure = ok(predict(model, [4, 4]))
    assert.ok((confident.confidence ?? 0) > (unsure.confidence ?? 1), 'a point near the boundary should be less certain')
  })
})

describe('scoring', () => {
  it('reports the baseline alongside the accuracy, so an unbalanced set cannot hide', () => {
    const made = ok(split(data('unbalanced', 400), 0.3))
    const model = ok(train(made.train, 'decision-tree', { depth: 1 }))
    const score = ok(scoreClassifier(model, made.test))
    assert.ok(score.baseline > 0.9, `the baseline was ${score.baseline}`)
    assert.match(score.says, /against/)
    assert.ok(score.notes.some((one) => /Always guessing/.test(one)))
  })

  it('says plainly when a model has not learned anything useful', () => {
    // A tree of depth 1 on a ring cannot do better than guessing.
    const made = ok(split(data('rings', 200), 0.3))
    const model = ok(train(made.train, 'decision-tree', { depth: 1 }))
    const score = ok(scoreClassifier(model, made.test))
    if (score.accuracy <= score.baseline + 0.02) {
      assert.ok(score.notes.some((one) => /not learned anything useful/.test(one)))
    }
  })

  it('the confusion matrix accounts for every tested row exactly once', () => {
    const made = ok(split(data('three-blobs', 150), 0.3))
    const score = ok(scoreClassifier(ok(train(made.train, 'nearest-neighbours')), made.test))
    assert.equal(score.confusion.reduce((a, b) => a + b.count, 0), score.tested)
    // The diagonal is the right answers.
    const diagonal = score.confusion.filter((one) => one.actual === one.predicted).reduce((a, b) => a + b.count, 0)
    assert.equal(diagonal, Math.round(score.accuracy * score.tested))
  })

  it('reports precision and recall per class, and they agree with the matrix', () => {
    const made = ok(split(data('three-blobs', 180), 0.3))
    const score = ok(scoreClassifier(ok(train(made.train, 'nearest-neighbours')), made.test))
    for (const one of score.perClass) {
      const truePositive = score.confusion.find((c) => c.actual === one.name && c.predicted === one.name)?.count ?? 0
      const predictedAs = score.confusion.filter((c) => c.predicted === one.name).reduce((a, b) => a + b.count, 0)
      const actually = score.confusion.filter((c) => c.actual === one.name).reduce((a, b) => a + b.count, 0)
      if (predictedAs > 0) assert.ok(Math.abs(one.precision - truePositive / predictedAs) < 1e-9, `${one.name} precision`)
      if (actually > 0) assert.ok(Math.abs(one.recall - truePositive / actually) < 1e-9, `${one.name} recall`)
      assert.equal(one.support, actually)
    }
  })

  it('says when a class was never predicted at all', () => {
    const made = ok(split(data('unbalanced', 400), 0.3))
    const score = ok(scoreClassifier(ok(train(made.train, 'decision-tree', { depth: 1 })), made.test))
    if (score.perClass.some((one) => one.support > 0 && one.recall === 0)) {
      assert.ok(score.notes.some((one) => /never predicted/.test(one)))
    }
  })

  it('a regression score on a noiseless line is almost perfect', () => {
    const made = ok(split(data('line', 150), 0.3))
    const score = ok(scoreRegression(ok(train(made.train, 'linear')), made.test))
    assert.ok(score.r2 > 0.999, `R² was ${score.r2}`)
    assert.ok(score.mae < 1e-6)
  })

  it('a regression score on noisy data has a real ceiling', () => {
    const made = ok(split(data('noisy-line', 300), 0.3))
    const score = ok(scoreRegression(ok(train(made.train, 'linear')), made.test))
    assert.ok(score.r2 > 0.8 && score.r2 < 1, `R² was ${score.r2}; noisy data has a limit`)
    assert.ok(score.mae > 0)
  })

  it('a negative R² is called what it is', () => {
    const made = ok(train(data('line', 60), 'linear'))
    // Scored against unrelated answers, the model is worse than predicting the mean.
    const score = ok(
      scoreRegression(made, {
        rows: Array.from({ length: 30 }, (_, i) => [i / 3]),
        // Varying, so there is a variation to account for, and unrelated, so the model does worse than the mean.
        targets: Array.from({ length: 30 }, (_, i) => 500 - i * 20),
        featureNames: ['x'],
        targetName: 'y'
      })
    )
    assert.ok(score.r2 < 0)
    assert.ok(score.notes.some((one) => /worse than simply always predicting/.test(one)))
  })

  it('refuses the wrong kind of score for the data', () => {
    assert.ok(isLearningError(scoreRegression(ok(train(data('two-blobs', 60), 'nearest-neighbours')), data('two-blobs', 30))))
    assert.ok(isLearningError(scoreClassifier(ok(train(data('line', 60), 'linear')), data('line', 30))))
  })
})

describe('overfitting', () => {
  it('a model that memorised shows a gap, and a model that learned does not', () => {
    const made = ok(split(data('flowers', 240), 0.3))
    const sensible = ok(overfitCheck(ok(train(made.train, 'decision-tree', { depth: 2 })), made.train, made.test))
    assert.ok(sensible.onTraining >= sensible.onTesting - 0.05)
    assert.ok(sensible.gap < 0.3, `a depth-2 tree should not overfit badly, gap was ${sensible.gap}`)
    assert.match(sensible.says, /on what it learned from/)
  })

  it('nearest neighbours with one neighbour is perfect on its own data and not on new data', () => {
    // With k=1 every training row is its own nearest neighbour, so training accuracy is 100% by construction.
    /*
     * Built here rather than taken from a sample, because the point needs data the classes genuinely overlap in.
     * Every sample set is separable enough that one neighbour gets the held-out half right as well, which hides the
     * very thing being shown.
     */
    const overlapping: Dataset = {
      rows: Array.from({ length: 200 }, (_, i) => [(i % 20) * 0.5, Math.floor(i / 20) * 0.5]),
      // The label alternates with no relation to position, so nothing can predict it and memorising is all there is.
      targets: Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 'a' : 'b')),
      featureNames: ['x', 'y'],
      targetName: 'group'
    }
    const made = ok(split(overlapping, 0.3))
    const check = ok(overfitCheck(ok(train(made.train, 'nearest-neighbours', { neighbours: 1 })), made.train, made.test))
    assert.equal(check.onTraining, 1, 'with one neighbour every training row predicts itself')
    assert.ok(check.onTesting < 1, 'and data it never saw is harder')
    assert.ok(check.gap > 0, 'the gap between the two is the whole point')
  })
})

describe('cross-validation', () => {
  it('trains and scores several times, and reports the spread', () => {
    const made = ok(crossValidate(data('two-blobs', 200), 'nearest-neighbours', { neighbours: 5 }, 5))
    assert.equal(made.scores.length, 5)
    assert.ok(made.mean > 0.85, `mean was ${made.mean}`)
    assert.ok(made.spread >= 0)
    assert.ok(made.notes.some((one) => /separate models/.test(one)))
    assert.ok(made.notes.some((one) => /spread is the useful part/.test(one)))
  })

  it('a wide spread is reported as unreliable', () => {
    const made = ok(crossValidate(data('rings', 60), 'logistic', { iterations: 100 }, 5))
    if (made.spread > 0.15) assert.ok(made.notes.some((one) => /not enough data/.test(one)))
  })

  it('works for regression too, and scores the variation accounted for', () => {
    const made = ok(crossValidate(data('line', 150), 'linear', {}, 5))
    assert.ok(made.mean > 0.99, `mean R² was ${made.mean}`)
  })

  it('refuses a fold count that is not usable', () => {
    assert.ok(isLearningError(crossValidate(data('two-blobs', 100), 'nearest-neighbours', {}, 1)))
    assert.ok(isLearningError(crossValidate(data('two-blobs', 100), 'nearest-neighbours', {}, 50)))
    assert.ok(isLearningError(crossValidate(data('two-blobs', 10), 'nearest-neighbours', {}, 8)))
  })
})

describe('principal components', () => {
  it('the components account for all of the variation between them', () => {
    const made = ok(components(data('flowers', 200)))
    assert.ok(Math.abs(made.cumulative[made.cumulative.length - 1] - 1) < 1e-6, `they add to ${made.cumulative[made.cumulative.length - 1]}`)
  })

  it('each one accounts for less than the one before', () => {
    const made = ok(components(data('flowers', 200)))
    for (let i = 1; i < made.explained.length; i += 1) {
      assert.ok(made.explained[i] <= made.explained[i - 1] + 1e-9, 'the components must be in order')
    }
  })

  it('data that really lies on a line needs only one component', () => {
    // Two features that are the same thing scaled: all the variation is in one direction.
    const made = ok(
      components({
        rows: Array.from({ length: 50 }, (_, i) => [i, i * 2 + 1]),
        targets: Array.from({ length: 50 }, (_, i) => i),
        featureNames: ['x', 'twice x plus one'],
        targetName: 'y'
      })
    )
    assert.ok(made.explained[0] > 0.999, `the first component carried ${made.explained[0]}`)
    assert.equal(made.needFor95, 1)
  })

  it('the projection has one value per component', () => {
    const made = ok(components(data('flowers', 80), 2))
    assert.equal(made.directions.length, 2)
    assert.equal(made.projected.length, 80)
    for (const row of made.projected) assert.equal(row.length, 2)
  })

  it('says that a component has no meaning of its own', () => {
    const made = ok(components(data('flowers', 80)))
    assert.ok(made.notes.some((one) => /no natural meaning/.test(one)))
    assert.ok(made.notes.some((one) => /centred/.test(one)))
  })

  it('refuses data with too few rows to measure variation', () => {
    assert.ok(isLearningError(components({ rows: [[1, 2]], targets: [1], featureNames: ['a', 'b'], targetName: 'y' })))
  })
})
