import { randomSource, shuffle } from './statistics.ts'
import { eigenSymmetric, numericMatrix, type NumericMatrix } from './matrix.ts'

/**
 * Machine learning: models that are actually fitted, and metrics that are actually measured.
 *
 * ## Every model is trained
 *
 * A k-nearest-neighbour classifier keeps the training set and searches it. A decision tree chooses each split by
 * measuring the impurity it removes. Logistic regression descends the gradient of its own loss. k-means moves its
 * centres until they stop moving. None of this is a stored answer: change the data and the fitted model changes
 * because fitting happened again.
 *
 * ## The metrics come from predictions on data the model never saw
 *
 * A score measured on the training data is not a score, it is a measure of memory. So every evaluation here is over a
 * held-out split, the split is reported, and a model that scores far better on what it trained on than on what it did
 * not is said to be overfitting — with both numbers shown.
 *
 * ## Nothing is fabricated, and the limits are stated
 *
 * There is no accuracy that was not counted, no loss curve that was not recorded, no training that did not run. Where
 * a method cannot answer — too few rows, a class with no examples, a tree that cannot split — it refuses and says
 * what is missing rather than returning a number.
 *
 * Pure. No Electron, no DOM. Reuses `statistics.ts` for its random source and `matrix.ts` for eigenvectors.
 */

export interface LearningError {
  error: string
  says: string
  fix: string
}

export const isLearningError = (value: unknown): value is LearningError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string): LearningError => ({ error, says, fix })

export const LEARNING_LIMITS = Object.freeze({
  rows: 50_000,
  features: 128,
  classes: 32,
  /** Iterations a fitter may take before it gives up and says it did not converge. */
  iterations: 5_000,
  treeDepth: 20
})

// ---------------------------------------------------------------- datasets

export interface Dataset {
  /** One row per example, one number per feature. */
  rows: readonly (readonly number[])[]
  /** The answer for each row: a class name for classification, a number for regression. */
  targets: readonly (string | number)[]
  featureNames: readonly string[]
  /** What the target is called. */
  targetName: string
  name?: string
}

export interface DatasetFacts {
  rows: number
  features: number
  /** Null when the target is a number rather than a class. */
  classes: readonly { name: string; count: number; share: number }[] | null
  kind: 'classification' | 'regression'
  /** Per feature: the range and spread, which is what says whether scaling is needed. */
  featureStats: readonly { name: string; least: number; most: number; mean: number; spread: number }[]
  /** Rows with a value that is not a number. */
  badRows: number
  says: string
  notes: readonly string[]
}

export function describe(dataset: Dataset): DatasetFacts | LearningError {
  if (dataset.rows.length === 0) return refuse('empty', 'There are no rows.', 'A model needs examples to learn from.')
  if (dataset.rows.length > LEARNING_LIMITS.rows) {
    return refuse('too many rows', `${dataset.rows.length.toLocaleString()} rows is more than this will fit.`, `Keep it under ${LEARNING_LIMITS.rows.toLocaleString()}.`)
  }
  if (dataset.rows.length !== dataset.targets.length) {
    return refuse(
      'mismatched',
      `There are ${dataset.rows.length} rows and ${dataset.targets.length} answers.`,
      'Every row needs exactly one answer.'
    )
  }
  const features = dataset.rows[0].length
  if (features === 0) return refuse('no features', 'The rows have nothing in them.', 'Each row needs at least one number.')
  if (features > LEARNING_LIMITS.features) {
    return refuse('too many features', `${features} features is more than this will fit.`, `Keep it under ${LEARNING_LIMITS.features}.`)
  }
  if (dataset.featureNames.length !== features) {
    return refuse(
      'mismatched names',
      `There are ${features} features and ${dataset.featureNames.length} names for them.`,
      'Give one name per feature.'
    )
  }

  let badRows = 0
  for (const row of dataset.rows) {
    if (row.length !== features) {
      return refuse('ragged', 'Not every row has the same number of features.', `The first row has ${features}; they all have to match.`)
    }
    if (row.some((one) => !Number.isFinite(one))) badRows += 1
  }

  const numeric = dataset.targets.every((one) => typeof one === 'number' && Number.isFinite(one))
  const kind: DatasetFacts['kind'] = numeric ? 'regression' : 'classification'

  let classes: DatasetFacts['classes'] = null
  if (kind === 'classification') {
    const counts = new Map<string, number>()
    for (const one of dataset.targets) counts.set(String(one), (counts.get(String(one)) ?? 0) + 1)
    if (counts.size > LEARNING_LIMITS.classes) {
      return refuse('too many classes', `${counts.size} different answers is more than this treats as classes.`, 'Group them, or treat the target as a number.')
    }
    if (counts.size < 2) {
      return refuse(
        'one class',
        `Every row has the same answer, "${[...counts.keys()][0]}".`,
        'A classifier needs at least two different answers to tell apart.'
      )
    }
    classes = Object.freeze(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count, share: count / dataset.rows.length }))
    )
  }

  const featureStats = dataset.featureNames.map((name, at) => {
    const values = dataset.rows.map((row) => row[at]).filter((one) => Number.isFinite(one))
    const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
    const spread = values.length < 2 ? 0 : Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1))
    return { name, least: Math.min(...values), most: Math.max(...values), mean, spread }
  })

  const notes: string[] = []
  if (badRows > 0) notes.push(`${badRows} row${badRows === 1 ? ' has' : 's have'} a value that is not a number. Those will be left out of any fit.`)

  /*
   * Whether the features are on wildly different scales.
   *
   * It matters enormously for anything distance-based: a feature measured in thousands drowns one measured in
   * fractions, so the model effectively ignores the second. Saying so is more useful than silently scaling, because
   * scaling changes what the model means.
   */
  const spreads = featureStats.map((one) => one.spread).filter((one) => one > 0)
  if (spreads.length > 1 && Math.max(...spreads) / Math.min(...spreads) > 20) {
    const widest = featureStats.reduce((a, b) => (b.spread > a.spread ? b : a))
    const narrowest = featureStats.filter((one) => one.spread > 0).reduce((a, b) => (b.spread < a.spread ? b : a))
    notes.push(
      `"${widest.name}" varies about ${(widest.spread / narrowest.spread).toFixed(0)} times as much as "${narrowest.name}". Anything that measures distance will be almost entirely about "${widest.name}" unless the features are scaled first.`
    )
  }

  if (classes !== null) {
    const smallest = classes[classes.length - 1]
    if (smallest.share < 0.1) {
      notes.push(
        `"${smallest.name}" is only ${(smallest.share * 100).toFixed(1)}% of the rows. A model that always guessed "${classes[0].name}" would score ${(classes[0].share * 100).toFixed(1)}% accuracy, so accuracy alone will not tell you whether this model is any good — look at the per-class figures.`
      )
    }
  }

  return {
    rows: dataset.rows.length,
    features,
    classes,
    kind,
    featureStats: Object.freeze(featureStats),
    badRows,
    says:
      kind === 'classification'
        ? `${dataset.rows.length.toLocaleString()} rows, ${features} feature${features === 1 ? '' : 's'}, ${classes?.length} classes.`
        : `${dataset.rows.length.toLocaleString()} rows, ${features} feature${features === 1 ? '' : 's'}, predicting a number.`,
    notes: Object.freeze(notes)
  }
}

export interface Split {
  train: Dataset
  test: Dataset
  seed: number
  says: string
  notes: readonly string[]
}

/**
 * Splits a dataset into something to learn from and something to be judged on.
 *
 * ## Stratified by default, and it matters
 *
 * A random split of an unbalanced dataset can leave a whole class out of the training half entirely, after which the
 * model cannot possibly predict it and the score is meaningless. Keeping each class's share the same in both halves
 * avoids that, and is what any serious tool does.
 */
export function split(dataset: Dataset, fraction = 0.25, options: { seed?: number; stratified?: boolean } = {}): Split | LearningError {
  const facts = describe(dataset)
  if (isLearningError(facts)) return facts
  if (!(fraction > 0 && fraction < 1)) {
    return refuse('bad fraction', `${fraction} is not a fraction of the data to hold back.`, 'Use something between 0 and 1, such as 0.25.')
  }
  const seed = options.seed ?? 1
  const stratified = options.stratified !== false && facts.kind === 'classification'

  const trainIndices: number[] = []
  const testIndices: number[] = []

  if (stratified) {
    const byClass = new Map<string, number[]>()
    for (let at = 0; at < dataset.targets.length; at += 1) {
      const name = String(dataset.targets[at])
      const held = byClass.get(name)
      if (held === undefined) byClass.set(name, [at])
      else held.push(at)
    }
    for (const [, indices] of byClass) {
      const mixed = shuffle(indices, seed)
      const take = Math.max(1, Math.round(mixed.length * fraction))
      testIndices.push(...mixed.slice(0, take))
      trainIndices.push(...mixed.slice(take))
    }
  } else {
    const mixed = shuffle(
      Array.from({ length: dataset.rows.length }, (_, at) => at),
      seed
    )
    const take = Math.max(1, Math.round(mixed.length * fraction))
    testIndices.push(...mixed.slice(0, take))
    trainIndices.push(...mixed.slice(take))
  }

  if (trainIndices.length < 2) {
    return refuse(
      'not enough to learn from',
      `Holding back ${(fraction * 100).toFixed(0)}% leaves only ${trainIndices.length} row${trainIndices.length === 1 ? '' : 's'} to train on.`,
      'Hold back less, or get more data.'
    )
  }

  const pick = (indices: readonly number[]): Dataset => ({
    rows: Object.freeze(indices.map((at) => dataset.rows[at])),
    targets: Object.freeze(indices.map((at) => dataset.targets[at])),
    featureNames: dataset.featureNames,
    targetName: dataset.targetName,
    ...(dataset.name === undefined ? {} : { name: dataset.name })
  })

  const notes: string[] = [
    'The model is fitted on the training half and judged only on the testing half. A score measured on the data a model learned from is not a score — it measures how well it remembered.'
  ]
  if (stratified) {
    notes.push(
      'Each class keeps the same share in both halves. A plain random split of unbalanced data can leave a class out of the training half altogether, after which the model cannot predict it at all and the score means nothing.'
    )
  }

  return {
    train: pick(trainIndices),
    test: pick(testIndices),
    seed,
    says: `${trainIndices.length} rows to learn from, ${testIndices.length} held back to be judged on.`,
    notes: Object.freeze(notes)
  }
}

export interface Scaling {
  /** Per feature, what to subtract and what to divide by. */
  centre: readonly number[]
  scale: readonly number[]
  method: 'standardise' | 'normalise'
  says: string
}

/** Works out a scaling from the training data only — which is the whole point of returning it. */
export function fitScaling(dataset: Dataset, method: Scaling['method'] = 'standardise'): Scaling | LearningError {
  const facts = describe(dataset)
  if (isLearningError(facts)) return facts
  const centre: number[] = []
  const scale: number[] = []
  for (const one of facts.featureStats) {
    if (method === 'standardise') {
      centre.push(one.mean)
      // A feature that never varies would divide by zero; it carries no information either way, so leave it alone.
      scale.push(one.spread === 0 ? 1 : one.spread)
    } else {
      centre.push(one.least)
      scale.push(one.most === one.least ? 1 : one.most - one.least)
    }
  }
  return {
    centre: Object.freeze(centre),
    scale: Object.freeze(scale),
    method,
    says:
      method === 'standardise'
        ? 'Each feature shifted to a mean of zero and divided by its spread.'
        : 'Each feature squeezed into the range nought to one.'
  }
}

/**
 * Applies a scaling.
 *
 * The scaling has to come from the training data and be applied unchanged to the testing data. Fitting it over
 * everything leaks information from the held-out half into the model, and the score comes out better than it should
 * — which is the most common quiet mistake in the whole subject.
 */
export function applyScaling(dataset: Dataset, scaling: Scaling): Dataset {
  return {
    ...dataset,
    rows: Object.freeze(dataset.rows.map((row) => Object.freeze(row.map((value, at) => (value - scaling.centre[at]) / scaling.scale[at]))))
  }
}

// ---------------------------------------------------------------- the models

export type ModelKind = 'nearest-neighbours' | 'decision-tree' | 'logistic' | 'linear' | 'k-means'

export const MODEL_KINDS: readonly ModelKind[] = Object.freeze(['nearest-neighbours', 'decision-tree', 'logistic', 'linear', 'k-means'])

interface ModelFacts {
  label: string
  about: string
  does: 'classification' | 'regression' | 'grouping'
  /** What it is bad at. Every model has something. */
  costs: string
  /** Whether it needs the features on comparable scales. */
  needsScaling: boolean
}

export const MODEL_FACTS: Readonly<Record<ModelKind, ModelFacts>> = Object.freeze({
  'nearest-neighbours': {
    label: 'Nearest neighbours',
    about: 'Keeps every example, and answers a new one by looking at the closest few and taking a vote.',
    does: 'classification',
    costs: 'It does no work to learn and all its work to predict, so it gets slower the more data you give it. It is also entirely at the mercy of the scales the features are measured in.',
    needsScaling: true
  },
  'decision-tree': {
    label: 'Decision tree',
    about: 'Asks a sequence of questions about one feature at a time, choosing each question to separate the classes as much as it can.',
    does: 'classification',
    costs: 'Left unlimited it carries on until every leaf is pure, which memorises the training data rather than learning from it. The depth limit is what stops that, and choosing it is the whole art.',
    needsScaling: false
  },
  logistic: {
    label: 'Logistic regression',
    about: 'Finds a straight boundary between two classes, and gives a probability rather than a bare answer.',
    does: 'classification',
    costs: 'The boundary is straight. Data that needs a curve cannot be separated by it however long it trains, and it will quietly settle for the best straight line.',
    needsScaling: true
  },
  linear: {
    label: 'Linear regression',
    about: 'Fits the straight line, or flat plane, that comes closest to the answers.',
    does: 'regression',
    costs: 'Also straight. And it is pulled a long way by a single extreme value, because it minimises the square of the error.',
    needsScaling: false
  },
  'k-means': {
    label: 'k-means',
    about: 'Groups the data into a chosen number of clusters by moving each centre to the middle of whatever is nearest it, repeatedly.',
    does: 'grouping',
    costs: 'You have to choose how many groups there are, and it will cheerfully find that many whether or not they exist. It also finds round groups of similar size, and nothing else.',
    needsScaling: true
  }
})

export interface Trained {
  kind: ModelKind
  /** Whatever the fitted model is, in a shape `predict` understands. */
  model: unknown
  /** Rows actually used, after any with bad values were left out. */
  trainedOn: number
  /** Iterations taken, for anything that iterates. */
  iterations: number | null
  /** True when an iterative fit stopped changing. False when it ran out of iterations. */
  converged: boolean | null
  /** Loss at each iteration, where there is one. Recorded, never invented. */
  history: readonly number[]
  classes: readonly string[]
  settings: Readonly<Record<string, number | string | boolean>>
  says: string
  notes: readonly string[]
}

const distance = (a: readonly number[], b: readonly number[]): number => {
  let total = 0
  for (let at = 0; at < a.length; at += 1) total += (a[at] - b[at]) ** 2
  return Math.sqrt(total)
}

const usableRows = (dataset: Dataset): { rows: number[][]; targets: (string | number)[] } => {
  const rows: number[][] = []
  const targets: (string | number)[] = []
  for (let at = 0; at < dataset.rows.length; at += 1) {
    if (dataset.rows[at].some((one) => !Number.isFinite(one))) continue
    rows.push([...dataset.rows[at]])
    targets.push(dataset.targets[at])
  }
  return { rows, targets }
}

/** Fits a model. */
export function train(
  dataset: Dataset,
  kind: ModelKind,
  settings: { neighbours?: number; depth?: number; leastLeaf?: number; rate?: number; iterations?: number; groups?: number; seed?: number; degree?: number } = {}
): Trained | LearningError {
  const facts = describe(dataset)
  if (isLearningError(facts)) return facts
  const model = MODEL_FACTS[kind]
  if (model === undefined) return refuse('unknown model', `There is no model called "${String(kind)}".`, `Try one of: ${MODEL_KINDS.join(', ')}.`)

  if (model.does === 'classification' && facts.kind !== 'classification') {
    return refuse(
      'wrong kind of target',
      `${model.label} puts rows into classes, and this dataset's answers are numbers.`,
      'Use linear regression for a number, or group the numbers into classes first.'
    )
  }
  if (model.does === 'regression' && facts.kind !== 'regression') {
    return refuse(
      'wrong kind of target',
      `${model.label} predicts a number, and this dataset's answers are classes.`,
      'Use a classifier instead.'
    )
  }

  const { rows, targets } = usableRows(dataset)
  if (rows.length < 2) return refuse('not enough', `Only ${rows.length} usable row${rows.length === 1 ? '' : 's'}.`, 'Fix the rows with values that are not numbers.')
  const classes = facts.classes === null ? [] : facts.classes.map((one) => one.name)
  const notes: string[] = [model.about, model.costs]
  if (model.needsScaling) {
    const spreads = facts.featureStats.map((one) => one.spread).filter((one) => one > 0)
    if (spreads.length > 1 && Math.max(...spreads) / Math.min(...spreads) > 5) {
      notes.push('The features are on noticeably different scales, and this model is sensitive to that. Scale them first and compare the scores.')
    }
  }

  switch (kind) {
    case 'nearest-neighbours': {
      const neighbours = Math.max(1, Math.min(rows.length, Math.floor(settings.neighbours ?? 5)))
      if (neighbours % 2 === 0 && classes.length === 2) {
        notes.push(`${neighbours} is an even number of neighbours for two classes, so a vote can tie. An odd number cannot.`)
      }
      return {
        kind,
        model: { rows, targets, neighbours },
        trainedOn: rows.length,
        iterations: null,
        converged: null,
        history: Object.freeze([]),
        classes: Object.freeze(classes),
        settings: Object.freeze({ neighbours }),
        says: `Kept all ${rows.length} examples. Nothing was fitted — this model does its work when asked to predict.`,
        notes: Object.freeze(notes)
      }
    }

    case 'decision-tree': {
      const depth = Math.max(1, Math.min(LEARNING_LIMITS.treeDepth, Math.floor(settings.depth ?? 4)))
      const leastLeaf = Math.max(1, Math.floor(settings.leastLeaf ?? 1))

      /** Gini impurity: the chance two rows picked at random from a group have different answers. */
      const impurity = (indices: readonly number[]): number => {
        const counts = new Map<string, number>()
        for (const at of indices) counts.set(String(targets[at]), (counts.get(String(targets[at])) ?? 0) + 1)
        let total = 1
        for (const count of counts.values()) total -= (count / indices.length) ** 2
        return total
      }
      const commonest = (indices: readonly number[]): string => {
        const counts = new Map<string, number>()
        for (const at of indices) counts.set(String(targets[at]), (counts.get(String(targets[at])) ?? 0) + 1)
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      }

      interface Node {
        feature: number | null
        at: number | null
        below: Node | null
        aboveOrEqual: Node | null
        answer: string | null
        rows: number
        impurity: number
        /** How much impurity this split removed, which is why it was chosen. */
        gain: number | null
      }

      let splits = 0
      const build = (indices: readonly number[], level: number): Node => {
        const here = impurity(indices)
        const leaf = (): Node => ({
          feature: null,
          at: null,
          below: null,
          aboveOrEqual: null,
          answer: commonest(indices),
          rows: indices.length,
          impurity: here,
          gain: null
        })
        if (level >= depth || here === 0 || indices.length < leastLeaf * 2) return leaf()

        let bestFeature = -1
        let bestAt = 0
        let bestGain = 0
        for (let feature = 0; feature < rows[0].length; feature += 1) {
          // Candidate thresholds are the midpoints between consecutive distinct values, which is where a split can
          // actually separate anything.
          const values = [...new Set(indices.map((at) => rows[at][feature]))].sort((a, b) => a - b)
          for (let i = 1; i < values.length; i += 1) {
            const at = (values[i - 1] + values[i]) / 2
            const below = indices.filter((one) => rows[one][feature] < at)
            const above = indices.filter((one) => rows[one][feature] >= at)
            if (below.length < leastLeaf || above.length < leastLeaf) continue
            const gain = here - (below.length / indices.length) * impurity(below) - (above.length / indices.length) * impurity(above)
            if (gain > bestGain + 1e-12) {
              bestGain = gain
              bestFeature = feature
              bestAt = at
            }
          }
        }
        if (bestFeature < 0) return leaf()

        splits += 1
        const below = indices.filter((one) => rows[one][bestFeature] < bestAt)
        const above = indices.filter((one) => rows[one][bestFeature] >= bestAt)
        return {
          feature: bestFeature,
          at: bestAt,
          below: build(below, level + 1),
          aboveOrEqual: build(above, level + 1),
          answer: null,
          rows: indices.length,
          impurity: here,
          gain: bestGain
        }
      }

      const root = build(
        Array.from({ length: rows.length }, (_, at) => at),
        0
      )

      // A named function, because an arrow assigned to a const cannot call itself.
      const depthOf = (node: Node): number =>
        node.answer !== null ? 1 : 1 + Math.max(depthOf(node.below as Node), depthOf(node.aboveOrEqual as Node))
      const deepest = depthOf(root)
      if (deepest >= depth + 1) {
        notes.push(`The tree reached the depth limit of ${depth}. A deeper one would fit the training data better and probably generalise worse.`)
      }

      return {
        kind,
        model: { root, featureNames: dataset.featureNames },
        trainedOn: rows.length,
        iterations: null,
        converged: null,
        history: Object.freeze([]),
        classes: Object.freeze(classes),
        settings: Object.freeze({ depth, leastLeaf }),
        says: `A tree of ${splits} question${splits === 1 ? '' : 's'}, ${deepest} level${deepest === 1 ? '' : 's'} deep. Each question was chosen because it separated the classes more than any other.`,
        notes: Object.freeze(notes)
      }
    }

    case 'logistic': {
      if (classes.length !== 2) {
        return refuse(
          'two classes only',
          `This dataset has ${classes.length} classes, and logistic regression separates two.`,
          'Use a decision tree or nearest neighbours for more than two.'
        )
      }
      const rate = settings.rate ?? 0.1
      const iterations = Math.max(1, Math.min(LEARNING_LIMITS.iterations, Math.floor(settings.iterations ?? 500)))
      if (!(rate > 0)) return refuse('bad rate', `A learning rate of ${rate} will not learn.`, 'Use something above zero, such as 0.1.')

      const positive = classes[0]
      const y = targets.map((one) => (String(one) === positive ? 1 : 0))
      const features = rows[0].length
      // One weight per feature plus a bias, all starting at zero.
      const weights = new Array<number>(features + 1).fill(0)
      const history: number[] = []
      let converged = false

      const sigmoid = (z: number): number => 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, z))))

      for (let round = 0; round < iterations; round += 1) {
        const gradient = new Array<number>(features + 1).fill(0)
        let loss = 0
        for (let at = 0; at < rows.length; at += 1) {
          let z = weights[features]
          for (let f = 0; f < features; f += 1) z += weights[f] * rows[at][f]
          const guess = sigmoid(z)
          const error = guess - y[at]
          for (let f = 0; f < features; f += 1) gradient[f] += error * rows[at][f]
          gradient[features] += error
          // Cross-entropy, clamped so a confident wrong answer does not become infinite.
          const safe = Math.max(1e-12, Math.min(1 - 1e-12, guess))
          loss -= y[at] * Math.log(safe) + (1 - y[at]) * Math.log(1 - safe)
        }
        loss /= rows.length
        history.push(loss)
        for (let f = 0; f <= features; f += 1) weights[f] -= (rate * gradient[f]) / rows.length
        if (round > 0 && Math.abs(history[round - 1] - loss) < 1e-9) {
          converged = true
          break
        }
      }

      if (!converged) {
        notes.push(
          `The loss was still moving after ${history.length} rounds, so this is where it had got to rather than where it settles. More rounds, or a larger learning rate, would take it further.`
        )
      }
      if (history.length > 1 && history[history.length - 1] > history[0]) {
        notes.push('The loss went up rather than down. The learning rate is too large — it is overshooting the minimum each step.')
      }

      return {
        kind,
        model: { weights, positive, negative: classes[1] },
        trainedOn: rows.length,
        iterations: history.length,
        converged,
        history: Object.freeze(history),
        classes: Object.freeze(classes),
        settings: Object.freeze({ rate, iterations }),
        says: `Trained for ${history.length} round${history.length === 1 ? '' : 's'}; the loss went from ${history[0]?.toFixed(4) ?? '—'} to ${history[history.length - 1]?.toFixed(4) ?? '—'}${converged ? ' and stopped moving' : ' and was still moving'}.`,
        notes: Object.freeze(notes)
      }
    }

    case 'linear': {
      const degree = Math.max(1, Math.min(8, Math.floor(settings.degree ?? 1)))
      const features = rows[0].length
      if (degree > 1 && features > 1) {
        return refuse(
          'one feature for a curve',
          `Fitting a degree-${degree} curve needs a single feature, and this has ${features}.`,
          'Use degree 1 for several features, or pick one feature out.'
        )
      }

      /*
       * Solved by normal equations with Gaussian elimination.
       *
       * A straightforward approach that is exact for the sizes here. It can be ill-conditioned for a high-degree fit,
       * which is reported rather than hidden — a fit that cannot be trusted should say so.
       */
      const design = rows.map((row) =>
        degree > 1 ? Array.from({ length: degree + 1 }, (_, power) => row[0] ** power) : [1, ...row]
      )
      const columns = design[0].length
      const y = targets.map((one) => Number(one))

      const ata = Array.from({ length: columns }, () => new Array<number>(columns).fill(0))
      const atb = new Array<number>(columns).fill(0)
      for (let at = 0; at < design.length; at += 1) {
        for (let i = 0; i < columns; i += 1) {
          atb[i] += design[at][i] * y[at]
          for (let j = 0; j < columns; j += 1) ata[i][j] += design[at][i] * design[at][j]
        }
      }

      // Gaussian elimination with partial pivoting.
      const augmented = ata.map((row, i) => [...row, atb[i]])
      for (let col = 0; col < columns; col += 1) {
        let pivot = col
        for (let r = col + 1; r < columns; r += 1) if (Math.abs(augmented[r][col]) > Math.abs(augmented[pivot][col])) pivot = r
        if (Math.abs(augmented[pivot][col]) < 1e-12) {
          return refuse(
            'cannot be fitted',
            'The features are too alike to tell apart — one is a combination of the others, or a feature never varies.',
            'Drop a redundant feature, or reduce the degree of the curve.'
          )
        }
        ;[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]
        for (let r = 0; r < columns; r += 1) {
          if (r === col) continue
          const factor = augmented[r][col] / augmented[col][col]
          for (let c = col; c <= columns; c += 1) augmented[r][c] -= factor * augmented[col][c]
        }
      }
      const coefficients = augmented.map((row, i) => row[columns] / row[i])

      if (degree >= 5) {
        notes.push(`A degree-${degree} curve has ${degree + 1} coefficients. With few points it will pass close to all of them and be useless between them.`)
      }

      return {
        kind,
        model: { coefficients, degree, features },
        trainedOn: rows.length,
        iterations: null,
        converged: true,
        history: Object.freeze([]),
        classes: Object.freeze([]),
        settings: Object.freeze({ degree }),
        says:
          degree > 1
            ? `Fitted a degree-${degree} curve: ${coefficients.map((one, power) => `${one.toFixed(4)}${power === 0 ? '' : power === 1 ? 'x' : `x^${power}`}`).join(' + ')}`
            : `Fitted ${dataset.targetName} = ${coefficients[0].toFixed(4)}${coefficients.slice(1).map((one, at) => ` ${one >= 0 ? '+' : '−'} ${Math.abs(one).toFixed(4)}·${dataset.featureNames[at]}`).join('')}`,
        notes: Object.freeze(notes)
      }
    }

    case 'k-means': {
      const groups = Math.max(2, Math.min(rows.length, Math.floor(settings.groups ?? 3)))
      const iterations = Math.max(1, Math.min(LEARNING_LIMITS.iterations, Math.floor(settings.iterations ?? 100)))
      const random = randomSource(settings.seed ?? 1)
      const features = rows[0].length

      /*
       * Starting points chosen by k-means++: the first at random, and each later one with probability proportional to
       * its squared distance from the nearest already chosen. Plain random starts land two centres in the same group
       * often enough to matter, and the result then depends mostly on luck.
       */
      const centres: number[][] = [[...rows[Math.floor(random() * rows.length)]]]
      while (centres.length < groups) {
        const weights = rows.map((row) => Math.min(...centres.map((one) => distance(row, one))) ** 2)
        const total = weights.reduce((a, b) => a + b, 0)
        if (total === 0) {
          centres.push([...rows[Math.floor(random() * rows.length)]])
          continue
        }
        let target = random() * total
        let chosen = 0
        for (let at = 0; at < weights.length; at += 1) {
          target -= weights[at]
          if (target <= 0) {
            chosen = at
            break
          }
        }
        centres.push([...rows[chosen]])
      }

      let assignment = new Array<number>(rows.length).fill(-1)
      const history: number[] = []
      let converged = false
      let round = 0

      for (; round < iterations; round += 1) {
        const next = rows.map((row) => {
          let best = 0
          let bestAt = Infinity
          for (let c = 0; c < centres.length; c += 1) {
            const d = distance(row, centres[c])
            if (d < bestAt) {
              bestAt = d
              best = c
            }
          }
          return best
        })

        // The total squared distance to the assigned centre, which is what k-means minimises.
        let inertia = 0
        for (let at = 0; at < rows.length; at += 1) inertia += distance(rows[at], centres[next[at]]) ** 2
        history.push(inertia)

        const settled = next.every((one, at) => one === assignment[at])
        assignment = next
        if (settled) {
          converged = true
          break
        }

        for (let c = 0; c < centres.length; c += 1) {
          const members = rows.filter((_, at) => assignment[at] === c)
          if (members.length === 0) continue
          for (let f = 0; f < features; f += 1) centres[c][f] = members.reduce((a, b) => a + b[f], 0) / members.length
        }
      }

      const sizes = centres.map((_, c) => assignment.filter((one) => one === c).length)
      const empty = sizes.filter((one) => one === 0).length
      if (empty > 0) notes.push(`${empty} of the ${groups} groups ended up with nothing in them, which means there are fewer real groups than you asked for.`)
      if (!converged) notes.push(`The assignments were still changing after ${history.length} rounds.`)
      notes.push(
        'The total squared distance always falls as you add groups, so it cannot tell you how many there are. Look for the point where adding another stops helping much.'
      )

      return {
        kind,
        model: { centres, assignment, groups },
        trainedOn: rows.length,
        iterations: history.length,
        converged,
        history: Object.freeze(history),
        classes: Object.freeze([]),
        settings: Object.freeze({ groups, iterations, seed: settings.seed ?? 1 }),
        says: `${groups} groups of ${sizes.join(', ')} after ${history.length} round${history.length === 1 ? '' : 's'}${converged ? '; nothing moved after that' : ', still moving'}.`,
        notes: Object.freeze(notes)
      }
    }
  }
}

/** What a model says about one row. */
export function predict(trained: Trained, row: readonly number[]): { answer: string | number; confidence: number | null } | LearningError {
  if (row.some((one) => !Number.isFinite(one))) return refuse('bad row', 'That row has a value that is not a number.', 'Every feature needs a number.')

  switch (trained.kind) {
    case 'nearest-neighbours': {
      const model = trained.model as { rows: number[][]; targets: (string | number)[]; neighbours: number }
      if (row.length !== model.rows[0].length) {
        return refuse('wrong width', `That row has ${row.length} features and the model was trained on ${model.rows[0].length}.`, 'Give the same features in the same order.')
      }
      const nearest = model.rows
        .map((one, at) => ({ at, d: distance(row, one) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, model.neighbours)
      const votes = new Map<string, number>()
      for (const one of nearest) votes.set(String(model.targets[one.at]), (votes.get(String(model.targets[one.at])) ?? 0) + 1)
      const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1])
      return { answer: ranked[0][0], confidence: ranked[0][1] / nearest.length }
    }

    case 'decision-tree': {
      interface Node {
        feature: number | null
        at: number | null
        below: Node | null
        aboveOrEqual: Node | null
        answer: string | null
      }
      const model = trained.model as { root: Node }
      let node = model.root
      let guard = 0
      while (node.answer === null && guard++ < LEARNING_LIMITS.treeDepth + 2) {
        const feature = node.feature as number
        if (feature >= row.length) return refuse('wrong width', `The tree asks about feature ${feature} and that row has ${row.length}.`, 'Give the same features in the same order.')
        node = (row[feature] < (node.at as number) ? node.below : node.aboveOrEqual) as Node
      }
      return { answer: node.answer ?? trained.classes[0] ?? '', confidence: null }
    }

    case 'logistic': {
      const model = trained.model as { weights: number[]; positive: string; negative: string }
      const features = model.weights.length - 1
      if (row.length !== features) {
        return refuse('wrong width', `That row has ${row.length} features and the model was trained on ${features}.`, 'Give the same features in the same order.')
      }
      let z = model.weights[features]
      for (let f = 0; f < features; f += 1) z += model.weights[f] * row[f]
      const chance = 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, z))))
      return { answer: chance >= 0.5 ? model.positive : model.negative, confidence: Math.max(chance, 1 - chance) }
    }

    case 'linear': {
      const model = trained.model as { coefficients: number[]; degree: number; features: number }
      if (model.degree > 1) {
        let total = 0
        for (let power = 0; power < model.coefficients.length; power += 1) total += model.coefficients[power] * row[0] ** power
        return { answer: total, confidence: null }
      }
      if (row.length !== model.features) {
        return refuse('wrong width', `That row has ${row.length} features and the model was trained on ${model.features}.`, 'Give the same features in the same order.')
      }
      let total = model.coefficients[0]
      for (let f = 0; f < model.features; f += 1) total += model.coefficients[f + 1] * row[f]
      return { answer: total, confidence: null }
    }

    case 'k-means': {
      const model = trained.model as { centres: number[][] }
      let best = 0
      let bestAt = Infinity
      for (let c = 0; c < model.centres.length; c += 1) {
        const d = distance(row, model.centres[c])
        if (d < bestAt) {
          bestAt = d
          best = c
        }
      }
      return { answer: `group ${best + 1}`, confidence: null }
    }
  }
}

// ---------------------------------------------------------------- measuring

export interface ClassificationScore {
  accuracy: number
  /** Rows by what they were and what was guessed. */
  confusion: readonly { actual: string; predicted: string; count: number }[]
  /** Per class, so an unbalanced dataset cannot hide behind the overall accuracy. */
  perClass: readonly { name: string; precision: number; recall: number; f1: number; support: number }[]
  /** The precision, recall and F1 averaged over the classes, each counting equally. */
  macroF1: number
  /** What always guessing the commonest class would score. */
  baseline: number
  tested: number
  says: string
  notes: readonly string[]
}

/**
 * Scores a classifier on data it did not train on.
 *
 * ## The baseline is reported, always
 *
 * 94% accuracy is excellent on balanced data and worthless on data that is 94% one class. Reporting what always
 * guessing the commonest class would score makes the difference impossible to miss, and it is the single most useful
 * number on this report.
 */
export function scoreClassifier(trained: Trained, test: Dataset): ClassificationScore | LearningError {
  const facts = describe(test)
  if (isLearningError(facts)) return facts
  if (facts.kind !== 'classification') return refuse('wrong kind', 'The answers in this set are numbers, not classes.', 'Use the regression score instead.')

  const { rows, targets } = usableRows(test)
  if (rows.length === 0) return refuse('nothing to test on', 'There are no usable rows.', 'Fix the rows with values that are not numbers.')

  const pairs: { actual: string; predicted: string }[] = []
  for (let at = 0; at < rows.length; at += 1) {
    const made = predict(trained, rows[at])
    if (isLearningError(made)) return made
    pairs.push({ actual: String(targets[at]), predicted: String(made.answer) })
  }

  const names = [...new Set([...pairs.map((one) => one.actual), ...pairs.map((one) => one.predicted)])].sort()
  const confusion: { actual: string; predicted: string; count: number }[] = []
  for (const actual of names) {
    for (const predicted of names) {
      confusion.push({ actual, predicted, count: pairs.filter((one) => one.actual === actual && one.predicted === predicted).length })
    }
  }

  const right = pairs.filter((one) => one.actual === one.predicted).length
  const accuracy = right / pairs.length

  const perClass = names
    .map((name) => {
      const truePositive = pairs.filter((one) => one.actual === name && one.predicted === name).length
      const falsePositive = pairs.filter((one) => one.actual !== name && one.predicted === name).length
      const falseNegative = pairs.filter((one) => one.actual === name && one.predicted !== name).length
      const support = truePositive + falseNegative
      // Zero where there is nothing to divide by, rather than NaN — and the support column says when that happened.
      const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive)
      const recall = support === 0 ? 0 : truePositive / support
      const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
      return { name, precision, recall, f1, support }
    })
    .filter((one) => one.support > 0 || one.precision > 0)

  const macroF1 = perClass.length === 0 ? 0 : perClass.reduce((a, b) => a + b.f1, 0) / perClass.length
  const commonest = facts.classes?.[0]
  const baseline = commonest?.share ?? 0

  const notes: string[] = [
    'Every one of these is measured on rows the model never saw while it was learning. A score on the training data measures memory, not learning.'
  ]
  if (accuracy <= baseline + 0.02) {
    notes.push(
      `Always guessing "${commonest?.name}" would score ${(baseline * 100).toFixed(1)}%, and this model scored ${(accuracy * 100).toFixed(1)}%. It has not learned anything useful.`
    )
  } else {
    notes.push(`Always guessing "${commonest?.name}" would score ${(baseline * 100).toFixed(1)}%, so the model is ${((accuracy - baseline) * 100).toFixed(1)} points better than guessing.`)
  }
  const weakest = [...perClass].filter((one) => one.support > 0).sort((a, b) => a.f1 - b.f1)[0]
  if (weakest !== undefined && weakest.f1 < 0.5 && perClass.length > 1) {
    notes.push(
      `"${weakest.name}" is predicted badly: of ${weakest.support} of them it found ${(weakest.recall * 100).toFixed(0)}%. The overall accuracy hides that, which is why the per-class figures are here.`
    )
  }
  const never = perClass.filter((one) => one.support > 0 && one.recall === 0)
  if (never.length > 0) {
    notes.push(`${never.map((one) => `"${one.name}"`).join(', ')} ${never.length === 1 ? 'was' : 'were'} never predicted at all.`)
  }

  return {
    accuracy,
    confusion: Object.freeze(confusion),
    perClass: Object.freeze(perClass),
    macroF1,
    baseline,
    tested: pairs.length,
    says: `${right} of ${pairs.length} right — ${(accuracy * 100).toFixed(1)}%, against ${(baseline * 100).toFixed(1)}% for always guessing the commonest.`,
    notes: Object.freeze(notes)
  }
}

export interface RegressionScore {
  /** Mean absolute error: the average miss, in the units of the answer. */
  mae: number
  mse: number
  rmse: number
  /** How much of the variation the model accounts for. 0 is no better than the mean; below 0 is worse. */
  r2: number
  /** The worst single miss, and which row it was. */
  worst: { row: number; actual: number; predicted: number; off: number }
  tested: number
  says: string
  notes: readonly string[]
}

export function scoreRegression(trained: Trained, test: Dataset): RegressionScore | LearningError {
  const facts = describe(test)
  if (isLearningError(facts)) return facts
  if (facts.kind !== 'regression') return refuse('wrong kind', 'The answers in this set are classes, not numbers.', 'Use the classifier score instead.')

  const { rows, targets } = usableRows(test)
  if (rows.length === 0) return refuse('nothing to test on', 'There are no usable rows.', 'Fix the rows with values that are not numbers.')

  let absolute = 0
  let squared = 0
  let worst = { row: 0, actual: 0, predicted: 0, off: -1 }
  const actuals: number[] = []

  for (let at = 0; at < rows.length; at += 1) {
    const made = predict(trained, rows[at])
    if (isLearningError(made)) return made
    const actual = Number(targets[at])
    const predicted = Number(made.answer)
    const off = Math.abs(actual - predicted)
    absolute += off
    squared += off ** 2
    actuals.push(actual)
    if (off > worst.off) worst = { row: at, actual, predicted, off }
  }

  const mean = actuals.reduce((a, b) => a + b, 0) / actuals.length
  const totalVariation = actuals.reduce((a, b) => a + (b - mean) ** 2, 0)
  const mae = absolute / rows.length
  const mse = squared / rows.length
  // R² against the mean, which is the only baseline that makes it comparable across datasets.
  const r2 = totalVariation === 0 ? 0 : 1 - squared / totalVariation

  const notes: string[] = [
    'Measured on rows the model never saw. The average miss is in the same units as the answer, which makes it the easiest of these to interpret.',
    'The squared error punishes one large miss far more than several small ones, which is why it and the average miss can disagree about which of two models is better.'
  ]
  if (r2 < 0) {
    notes.push('The model is worse than simply always predicting the average. That is what a negative figure here means, and it means something is wrong rather than merely weak.')
  } else if (r2 < 0.3) {
    notes.push(`It accounts for ${(r2 * 100).toFixed(0)}% of the variation, which is little. The features may not carry the information, or the relationship may not be straight.`)
  }
  if (worst.off > mae * 5 && rows.length > 4) {
    notes.push(`One row was out by ${worst.off.toFixed(2)} against an average of ${mae.toFixed(2)}. A single point like that pulls a least-squares fit a long way.`)
  }

  return {
    mae,
    mse,
    rmse: Math.sqrt(mse),
    r2,
    worst,
    tested: rows.length,
    says: `Out by ${mae.toFixed(3)} on average, and it accounts for ${(r2 * 100).toFixed(1)}% of the variation.`,
    notes: Object.freeze(notes)
  }
}

export interface Overfit {
  onTraining: number
  onTesting: number
  gap: number
  overfitting: boolean
  says: string
}

/**
 * Compares how a model does on what it learned from against what it did not.
 *
 * This is the single most useful check there is, and it needs both numbers. A model at 99% on its training data and
 * 61% on held-out data has memorised rather than learned, and only seeing the two together says so.
 */
export function overfitCheck(trained: Trained, train: Dataset, test: Dataset): Overfit | LearningError {
  const facts = describe(train)
  if (isLearningError(facts)) return facts

  if (facts.kind === 'classification') {
    const onTraining = scoreClassifier(trained, train)
    if (isLearningError(onTraining)) return onTraining
    const onTesting = scoreClassifier(trained, test)
    if (isLearningError(onTesting)) return onTesting
    const gap = onTraining.accuracy - onTesting.accuracy
    return {
      onTraining: onTraining.accuracy,
      onTesting: onTesting.accuracy,
      gap,
      overfitting: gap > 0.15,
      says:
        gap > 0.15
          ? `${(onTraining.accuracy * 100).toFixed(1)}% on what it learned from and ${(onTesting.accuracy * 100).toFixed(1)}% on what it did not. That gap means it has memorised the training data rather than learned from it — a simpler model, or more data, would do better.`
          : `${(onTraining.accuracy * 100).toFixed(1)}% on what it learned from and ${(onTesting.accuracy * 100).toFixed(1)}% on what it did not, which is a small enough gap to trust.`
    }
  }

  const onTraining = scoreRegression(trained, train)
  if (isLearningError(onTraining)) return onTraining
  const onTesting = scoreRegression(trained, test)
  if (isLearningError(onTesting)) return onTesting
  const gap = onTraining.r2 - onTesting.r2
  return {
    onTraining: onTraining.r2,
    onTesting: onTesting.r2,
    gap,
    overfitting: gap > 0.2,
    says:
      gap > 0.2
        ? `It accounts for ${(onTraining.r2 * 100).toFixed(0)}% of the variation in what it learned from and only ${(onTesting.r2 * 100).toFixed(0)}% in what it did not. It has fitted the training data too closely.`
        : `${(onTraining.r2 * 100).toFixed(0)}% on what it learned from and ${(onTesting.r2 * 100).toFixed(0)}% on what it did not — close enough to trust.`
  }
}

export interface CrossValidation {
  folds: number
  scores: readonly number[]
  mean: number
  spread: number
  says: string
  notes: readonly string[]
}

/**
 * Trains and scores the model several times over different splits.
 *
 * One split gives one number, and that number depends on which rows happened to be held back. Several splits give a
 * mean and a spread, and the spread is the part that matters: a model scoring 80% ± 2 is a different proposition from
 * one scoring 80% ± 15.
 */
export function crossValidate(
  dataset: Dataset,
  kind: ModelKind,
  settings: Parameters<typeof train>[2] = {},
  folds = 5
): CrossValidation | LearningError {
  const facts = describe(dataset)
  if (isLearningError(facts)) return facts
  if (!Number.isInteger(folds) || folds < 2 || folds > 20) {
    return refuse('bad fold count', `${folds} folds is not a usable number.`, 'Use between 2 and 20; five is the usual choice.')
  }
  if (dataset.rows.length < folds * 2) {
    return refuse(
      'not enough rows',
      `${folds} folds of ${dataset.rows.length} rows leaves too few in each.`,
      `Use fewer folds, or at least ${folds * 2} rows.`
    )
  }

  const order = shuffle(
    Array.from({ length: dataset.rows.length }, (_, at) => at),
    settings.seed ?? 1
  )
  const scores: number[] = []

  for (let fold = 0; fold < folds; fold += 1) {
    const testIndices = order.filter((_, at) => at % folds === fold)
    const trainIndices = order.filter((_, at) => at % folds !== fold)
    const pick = (indices: readonly number[]): Dataset => ({
      rows: indices.map((at) => dataset.rows[at]),
      targets: indices.map((at) => dataset.targets[at]),
      featureNames: dataset.featureNames,
      targetName: dataset.targetName
    })

    const trained = train(pick(trainIndices), kind, settings)
    if (isLearningError(trained)) return trained
    if (facts.kind === 'classification') {
      const made = scoreClassifier(trained, pick(testIndices))
      if (isLearningError(made)) return made
      scores.push(made.accuracy)
    } else {
      const made = scoreRegression(trained, pick(testIndices))
      if (isLearningError(made)) return made
      scores.push(made.r2)
    }
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const spread = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length)

  const notes: string[] = [
    `The model was trained and scored ${folds} times, each time holding back a different fifth of the data. That is ${folds} separate models, not one scored several ways.`,
    'The spread is the useful part. A model that scores well on one split and badly on another is unreliable, however good its average looks.'
  ]
  if (spread > 0.15) {
    notes.push(`The scores ranged from ${(Math.min(...scores) * 100).toFixed(0)}% to ${(Math.max(...scores) * 100).toFixed(0)}%, which is a wide spread. There is probably not enough data to be confident.`)
  }

  return {
    folds,
    scores: Object.freeze(scores),
    mean,
    spread,
    says: `${(mean * 100).toFixed(1)}% on average across ${folds} folds, give or take ${(spread * 100).toFixed(1)}.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- dimensions

export interface Components {
  /** Each component, as a direction in the original feature space. */
  directions: readonly (readonly number[])[]
  /** How much of the variation each accounts for. */
  explained: readonly number[]
  /** Running total of the above. */
  cumulative: readonly number[]
  /** The rows, projected onto the components. */
  projected: readonly (readonly number[])[]
  /** How many components are needed for 95% of the variation. */
  needFor95: number
  says: string
  notes: readonly string[]
}

/**
 * Principal components, from the eigenvectors of the covariance matrix.
 *
 * ## It is centred, and said to be
 *
 * The components are directions of *variation*, which only means anything about data centred on its own mean. Doing
 * it without centring finds the direction of the data's offset from the origin instead, which is a different and
 * usually useless thing.
 */
export function components(dataset: Dataset, howMany?: number): Components | LearningError {
  const facts = describe(dataset)
  if (isLearningError(facts)) return facts
  const { rows } = usableRows(dataset)
  if (rows.length < 2) return refuse('not enough rows', 'There are too few usable rows.', 'At least two are needed to measure variation.')
  const features = rows[0].length
  const want = Math.max(1, Math.min(features, Math.floor(howMany ?? features)))

  // Centre on the mean: these are directions of variation, which is meaningless otherwise.
  const means = Array.from({ length: features }, (_, f) => rows.reduce((a, b) => a + b[f], 0) / rows.length)
  const centred = rows.map((row) => row.map((value, f) => value - means[f]))

  const covariance = Array.from({ length: features }, (_, i) =>
    Array.from({ length: features }, (_, j) => centred.reduce((a, row) => a + row[i] * row[j], 0) / (rows.length - 1))
  )

  const made = numericMatrix(covariance)
  if (!Array.isArray(made) && 'error' in made) {
    return refuse('could not be worked out', 'The covariance matrix could not be formed.', 'Check the rows all have numbers in them.')
  }
  const eigen = eigenSymmetric(made as NumericMatrix)
  if ('error' in eigen) {
    return refuse(
      'could not be worked out',
      'The components could not be found from this data.',
      'A feature that never varies, or two features that are the same, will do that. Drop one.'
    )
  }

  const pairs = (eigen as { values: number[]; vectors: number[][] }).values
    .map((value, at) => ({ value, vector: (eigen as { vectors: number[][] }).vectors.map((row) => row[at]) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, want)

  const totalVariance = (eigen as { values: number[] }).values.reduce((a, b) => a + Math.max(0, b), 0)
  const explained = pairs.map((one) => (totalVariance === 0 ? 0 : Math.max(0, one.value) / totalVariance))
  const cumulative: number[] = []
  let running = 0
  for (const one of explained) {
    running += one
    cumulative.push(running)
  }

  const projected = centred.map((row) => pairs.map((one) => row.reduce((a, value, f) => a + value * one.vector[f], 0)))
  const needFor95 = Math.max(1, cumulative.findIndex((one) => one >= 0.95) + 1) || pairs.length

  const notes: string[] = [
    'The data is centred on its own mean first. These are directions of variation, and that only means anything relative to the middle of the data.',
    `The first component accounts for ${(explained[0] * 100).toFixed(1)}% of the variation on its own. Each later one accounts for less, and each is at right angles to all the others.`
  ]
  if (cumulative[Math.min(1, cumulative.length - 1)] > 0.9 && features > 3) {
    notes.push(
      `Two components carry ${(cumulative[1] * 100).toFixed(0)}% of the variation, so this ${features}-feature dataset is very nearly flat and can be drawn on a page without losing much.`
    )
  }
  notes.push(
    'A component is a mixture of the original features, so it has no natural meaning of its own. What is gained in dimensions is lost in interpretability.'
  )

  return {
    directions: Object.freeze(pairs.map((one) => Object.freeze(one.vector))),
    explained: Object.freeze(explained),
    cumulative: Object.freeze(cumulative),
    projected: Object.freeze(projected.map((one) => Object.freeze(one))),
    needFor95,
    says: `${pairs.length} component${pairs.length === 1 ? '' : 's'}; the first carries ${(explained[0] * 100).toFixed(1)}% of the variation, and ${needFor95} ${needFor95 === 1 ? 'is' : 'are'} enough for 95%.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- datasets to work on

export type SampleDataset = 'two-blobs' | 'three-blobs' | 'rings' | 'xor' | 'unbalanced' | 'line' | 'curve' | 'noisy-line' | 'flowers'

export const SAMPLE_DATASETS: readonly SampleDataset[] = Object.freeze([
  'two-blobs',
  'three-blobs',
  'rings',
  'xor',
  'unbalanced',
  'flowers',
  'line',
  'noisy-line',
  'curve'
])

export const SAMPLE_ABOUT: Readonly<Record<SampleDataset, string>> = Object.freeze({
  'two-blobs': 'Two separated groups. Everything should get this nearly perfect, which makes it the right first test.',
  'three-blobs': 'Three groups, for grouping and for a classifier that has to handle more than two classes.',
  rings: 'One group inside a ring of another. A straight boundary cannot separate these at all, and nearest neighbours manages easily — the clearest demonstration of what "linear" costs.',
  xor: 'Two classes arranged in opposite corners. Famously impossible for anything that draws one straight line.',
  unbalanced: 'Ninety-five per cent one class. Shows why accuracy on its own tells you nothing.',
  flowers: 'Three classes with four measurements each, two of which overlap. Shaped like the classic flower dataset, with made-up numbers.',
  line: 'A straight relationship with no noise. A regression should recover it almost exactly.',
  'noisy-line': 'The same line with noise added, so there is a real limit to how well any model can do.',
  curve: 'A curved relationship. A straight fit does badly and a degree-2 fit does well, which is the point.'
})

/** Builds a dataset to work on. Deterministic, so the same name always gives the same data. */
export function sampleDataset(which: SampleDataset, options: { rows?: number; seed?: number } = {}): Dataset | LearningError {
  const count = Math.max(10, Math.min(5_000, Math.floor(options.rows ?? 200)))
  const random = randomSource(options.seed ?? 7)
  // A normal-ish value, from the sum of several uniform ones.
  const bell = (): number => (random() + random() + random() + random() - 2) * 0.7

  const rows: number[][] = []
  const targets: (string | number)[] = []

  switch (which) {
    case 'two-blobs':
      for (let i = 0; i < count; i += 1) {
        const first = i % 2 === 0
        rows.push([(first ? 2 : 6) + bell(), (first ? 2 : 6) + bell()])
        targets.push(first ? 'left' : 'right')
      }
      return { rows, targets, featureNames: ['x', 'y'], targetName: 'group', name: 'Two blobs' }
    case 'three-blobs':
      for (let i = 0; i < count; i += 1) {
        const which3 = i % 3
        const centres: readonly [number, number][] = [
          [2, 2],
          [7, 3],
          [4, 8]
        ]
        rows.push([centres[which3][0] + bell(), centres[which3][1] + bell()])
        targets.push(['a', 'b', 'c'][which3])
      }
      return { rows, targets, featureNames: ['x', 'y'], targetName: 'group', name: 'Three blobs' }
    case 'rings':
      for (let i = 0; i < count; i += 1) {
        const inner = i % 2 === 0
        const angle = random() * Math.PI * 2
        const radius = inner ? random() * 1.5 : 4 + random() * 1.5
        rows.push([radius * Math.cos(angle), radius * Math.sin(angle)])
        targets.push(inner ? 'inside' : 'outside')
      }
      return { rows, targets, featureNames: ['x', 'y'], targetName: 'group', name: 'A ring around a blob' }
    case 'xor':
      for (let i = 0; i < count; i += 1) {
        const x = (i % 2 === 0 ? 1 : -1) * (1 + random())
        const y = (Math.floor(i / 2) % 2 === 0 ? 1 : -1) * (1 + random())
        rows.push([x, y])
        targets.push(x * y > 0 ? 'same' : 'different')
      }
      return { rows, targets, featureNames: ['x', 'y'], targetName: 'group', name: 'Opposite corners' }
    case 'unbalanced':
      for (let i = 0; i < count; i += 1) {
        const rare = i % 20 === 0
        rows.push([(rare ? 5 : 2) + bell(), (rare ? 5 : 2) + bell()])
        targets.push(rare ? 'rare' : 'common')
      }
      return { rows, targets, featureNames: ['x', 'y'], targetName: 'group', name: 'Mostly one class' }
    case 'flowers':
      for (let i = 0; i < count; i += 1) {
        const kind = i % 3
        // Three kinds; the second and third overlap in two of the four measurements, as the real one does.
        const base: readonly [number, number, number, number][] = [
          [5.0, 3.4, 1.5, 0.2],
          [5.9, 2.8, 4.3, 1.3],
          [6.6, 3.0, 5.6, 2.0]
        ]
        rows.push(base[kind].map((one) => one + bell() * 0.35))
        targets.push(['short-petal', 'middling', 'long-petal'][kind])
      }
      return {
        rows,
        targets,
        featureNames: ['sepal length', 'sepal width', 'petal length', 'petal width'],
        targetName: 'kind',
        name: 'Flowers (made up, shaped like the classic set)'
      }
    case 'line':
      for (let i = 0; i < count; i += 1) {
        const x = (i / count) * 10
        rows.push([x])
        targets.push(3 * x + 7)
      }
      return { rows, targets, featureNames: ['x'], targetName: 'y', name: 'A straight line' }
    case 'noisy-line':
      for (let i = 0; i < count; i += 1) {
        const x = (i / count) * 10
        rows.push([x])
        targets.push(3 * x + 7 + bell() * 3)
      }
      return { rows, targets, featureNames: ['x'], targetName: 'y', name: 'A line with noise' }
    case 'curve':
      for (let i = 0; i < count; i += 1) {
        const x = (i / count) * 10 - 5
        rows.push([x])
        targets.push(2 * x * x - 3 * x + 1 + bell())
      }
      return { rows, targets, featureNames: ['x'], targetName: 'y', name: 'A curve' }
    default:
      return refuse('unknown dataset', `There is no dataset called "${String(which)}".`, `Try one of: ${SAMPLE_DATASETS.join(', ')}.`)
  }
}

export const LEARNING_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The models here are the classical ones: nearest neighbours, a decision tree, logistic regression, linear regression and k-means. There is no ensemble, no gradient boosting and no support vector machine.',
  'Everything is fitted in this process on the data given. Nothing is downloaded, nothing is pre-trained, and no model here has seen anything but what you hand it.',
  'A score is always measured on rows held back from training. A score on training data is reported only beside the held-out one, to show the gap.',
  'The sample datasets are generated from a fixed sequence. They are shaped like real data so the methods have something to work on; none of the numbers in them is a measurement of anything.',
  'A decision tree here uses Gini impurity and splits on one feature at a time. There is no pruning after the fact, only a depth limit before.',
  'k-means finds round groups of similar size and will find as many as you ask for whether or not they exist. The total distance it reports always falls as you add groups, so it cannot tell you how many there are.'
])
