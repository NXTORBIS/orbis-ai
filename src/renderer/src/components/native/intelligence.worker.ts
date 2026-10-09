import {
  adjust,
  convolve,
  edges,
  gaussian,
  histogram,
  isImageError,
  kernel,
  regions,
  testPicture,
  threshold,
  IMAGE_ASSUMPTIONS,
  type Adjustment,
  type Edges,
  type KnownKernel,
  type Picture,
  type TestPicture
} from '../../../../shared/compute/imaging.ts'
import {
  components,
  crossValidate,
  describe as describeDataset,
  isLearningError,
  overfitCheck,
  predict,
  sampleDataset,
  scoreClassifier,
  scoreRegression,
  split,
  train,
  LEARNING_ASSUMPTIONS,
  type ModelKind,
  type SampleDataset
} from '../../../../shared/compute/learning.machine.ts'
import {
  build,
  checkGradients,
  describeNetwork,
  forward,
  isNeuralError,
  problem,
  scoreNetwork,
  trainNetwork,
  NEURAL_ASSUMPTIONS,
  type Activation,
  type Problem
} from '../../../../shared/compute/neural.ts'

/**
 * The intelligence engines — images, machine learning and neural networks — on their own thread.
 *
 * ## Why these three share a worker, and why it is not the systems one
 *
 * These are the three that are expensive. A convolution over a 512-pixel image with a radius-4 kernel is about nine
 * million multiplications; training a neural network for two thousand steps is several hundred forward and backward
 * passes per step; cross-validating a model is five complete fits. Measured, each of those is hundreds of
 * milliseconds to seconds. Keeping them off the thread the chat is drawn on is not optional.
 *
 * ## An image is passed as its bytes, not as a canvas
 *
 * The engines work on plain arrays of bytes, four per pixel, which is exactly what a canvas gives and takes. So an
 * image crosses to this worker and back as a transferable buffer with no conversion at either end and no DOM
 * anywhere in between.
 *
 * ## Training reports what happened
 *
 * The loss at every step, the accuracy at every step, the dead neurons, the gradient magnitudes — all read out of the
 * network as it trains and passed back untouched. Nothing here draws a curve that looks like training.
 */

export type WorkerRequest =
  | {
      kind: 'image'
      generation: number
      /** The picture to work on: either one of the built-in ones, or bytes handed in. */
      source: TestPicture | 'given'
      width: number
      height: number
      data: ArrayBuffer | null
      size: number
      what: 'filter' | 'adjust' | 'threshold' | 'edges' | 'regions'
      filter: KnownKernel | 'gaussian'
      radius: number
      edgeHandling: Edges
      adjustment: Adjustment
      amount: number
      thresholdMethod: 'otsu' | 'mean' | 'given'
      level: number
      connectivity: 4 | 8
      smallest: number
      blurFirst: boolean
      edgeThreshold: number | null
    }
  | {
      kind: 'learning'
      generation: number
      dataset: SampleDataset
      rows: number
      model: ModelKind
      neighbours: number
      depth: number
      groups: number
      degree: number
      rate: number
      iterations: number
      holdBack: number
      seed: number
      scale: boolean
      folds: number
      alsoComponents: boolean
    }
  | {
      kind: 'neural'
      generation: number
      task: Problem
      rows: number
      /** Neurons in each hidden layer. */
      hidden: readonly number[]
      activation: Activation
      outputActivation: Activation
      rate: number
      steps: number
      batch: number
      momentum: number
      seed: number
      checkTheGradients: boolean
    }

export type WorkerReply =
  | {
      kind: 'image'
      generation: number
      before: { width: number; height: number; data: ArrayBuffer }
      after: { width: number; height: number; data: ArrayBuffer } | null
      histogram: unknown
      report: unknown
      assumptions: readonly string[]
    }
  | {
      kind: 'learning'
      generation: number
      facts: unknown
      trained: unknown
      score: unknown
      overfit: unknown
      folds: unknown
      components: unknown
      /** The data itself, for the picture. Empty when there are not exactly two features to plot. */
      dots: readonly { x: number; y: number; group: number }[]
      /** What the model answers for every point of a grid covering the same area. Null when it cannot be asked. */
      field: { size: number; values: readonly number[]; least: number; most: number } | null
      assumptions: readonly string[]
    }
  | {
      kind: 'neural'
      generation: number
      facts: unknown
      trained: unknown
      score: unknown
      gradientCheck: unknown
      /** The network's answer across a grid, so the boundary it learned can be drawn. */
      boundary: { size: number; values: readonly number[]; least: number; most: number } | null
      points: readonly { x: number; y: number; group: number }[]
      assumptions: readonly string[]
    }
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }

const send = (reply: WorkerReply, transfer: Transferable[] = []): void => {
  ;(self as unknown as { postMessage(value: unknown, transfer: Transferable[]): void }).postMessage(reply, transfer)
}

const refusalOf = (value: unknown): { says: string; fix: string } | null => {
  if (typeof value !== 'object' || value === null) return null
  const held = value as Record<string, unknown>
  if (typeof held.error !== 'string') return null
  return {
    says: typeof held.says === 'string' ? held.says : typeof held.message === 'string' ? held.message : held.error,
    fix: typeof held.fix === 'string' ? held.fix : ''
  }
}

const failed = (value: unknown): boolean => isImageError(value) || isLearningError(value) || isNeuralError(value)

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  const refuse = (value: unknown): boolean => {
    if (!failed(value)) return false
    const held = refusalOf(value)
    send({ kind: 'refused', generation, says: held?.says ?? 'The engine refused.', fix: held?.fix ?? 'Change the values and try again.' })
    return true
  }
  const optional = (value: unknown): unknown => (failed(value) ? { refused: refusalOf(value) } : value)

  try {
    switch (message.kind) {
      // ---------------------------------------------------------------- images
      case 'image': {
        let before: Picture
        if (message.source === 'given' && message.data !== null) {
          before = { width: message.width, height: message.height, data: new Uint8ClampedArray(message.data) }
        } else {
          const made = testPicture(message.source === 'given' ? 'circles' : message.source, message.size)
          if (refuse(made)) return
          before = made as Picture
        }

        const counted = histogram(before)
        if (refuse(counted)) return

        let after: Picture | null = null
        let report: unknown = null

        switch (message.what) {
          case 'filter': {
            const which = message.filter === 'gaussian' ? gaussian(message.radius) : kernel(message.filter)
            if (refuse(which)) return
            const made = convolve(before, which as never, message.edgeHandling)
            if (refuse(made)) return
            after = (made as { picture: Picture }).picture
            report = made
            break
          }
          case 'adjust': {
            const made = adjust(before, message.adjustment, message.amount)
            if (refuse(made)) return
            after = (made as { picture: Picture }).picture
            report = made
            break
          }
          case 'threshold': {
            const made = threshold(before, message.thresholdMethod, message.level)
            if (refuse(made)) return
            after = (made as { picture: Picture }).picture
            report = made
            break
          }
          case 'edges': {
            const made = edges(before, {
              blurFirst: message.blurFirst,
              ...(message.edgeThreshold === null ? {} : { threshold: message.edgeThreshold })
            })
            if (refuse(made)) return
            after = (made as { picture: Picture }).picture
            report = made
            break
          }
          case 'regions': {
            // Shapes are found in a thresholded image, so one is made first and both steps are reported.
            const cut = threshold(before, message.thresholdMethod, message.level)
            if (refuse(cut)) return
            const found = regions((cut as { picture: Picture }).picture, {
              connectivity: message.connectivity,
              smallest: message.smallest
            })
            if (refuse(found)) return
            after = (cut as { picture: Picture }).picture
            report = { ...(found as object), threshold: cut }
            break
          }
        }

        // The buffers are transferred rather than copied, which is what makes a large image cheap to send back.
        const beforeBuffer = before.data.slice().buffer
        const afterBuffer = after === null ? null : after.data.slice().buffer
        send(
          {
            kind: 'image',
            generation,
            before: { width: before.width, height: before.height, data: beforeBuffer },
            after: afterBuffer === null ? null : { width: (after as Picture).width, height: (after as Picture).height, data: afterBuffer },
            histogram: counted,
            report,
            assumptions: IMAGE_ASSUMPTIONS
          },
          afterBuffer === null ? [beforeBuffer] : [beforeBuffer, afterBuffer]
        )
        return
      }

      // ---------------------------------------------------------------- machine learning
      case 'learning': {
        const made = sampleDataset(message.dataset, { rows: message.rows, seed: message.seed })
        if (refuse(made)) return
        const facts = describeDataset(made as never)
        if (refuse(facts)) return

        const halves = split(made as never, message.holdBack, { seed: message.seed })
        if (isLearningError(halves)) {
          send({ kind: 'refused', generation, says: halves.says, fix: halves.fix })
          return
        }
        const { train: learnFrom, test: judgeOn } = halves

        const trained = train(learnFrom, message.model, {
          neighbours: message.neighbours,
          depth: message.depth,
          groups: message.groups,
          degree: message.degree,
          rate: message.rate,
          iterations: message.iterations,
          seed: message.seed
        })
        if (refuse(trained)) return

        /*
         * Which score applies is decided by what the data's answers are, not by what the model is called. A model
         * that groups rather than predicts has neither score, and saying so is better than inventing one.
         */
        const kind = (facts as { kind: string }).kind
        const score =
          message.model === 'k-means'
            ? null
            : kind === 'classification'
              ? optional(scoreClassifier(trained as never, judgeOn))
              : optional(scoreRegression(trained as never, judgeOn))
        const overfit = message.model === 'k-means' ? null : optional(overfitCheck(trained as never, learnFrom, judgeOn))
        const folds =
          message.model === 'k-means' || message.folds < 2
            ? null
            : optional(
                crossValidate(
                  made as never,
                  message.model,
                  { neighbours: message.neighbours, depth: message.depth, degree: message.degree, rate: message.rate, iterations: message.iterations, seed: message.seed },
                  message.folds
                )
              )
        const made2 = message.alsoComponents ? optional(components(made as never)) : null

        /*
         * The data, and what the model decided about the space around it.
         *
         * Only for two features, because a decision region in more dimensions cannot be drawn, and drawing a slice of
         * one would show a boundary that is not where the picture puts it. Every figure here is the model's own
         * answer for that point -- the grid is predicted, not interpolated from the data.
         *
         * Row-major from the top, matching the neural laboratory and what `Scatter` expects.
         */
        let field: { size: number; values: number[]; least: number; most: number } | null = null
        const dots: { x: number; y: number; group: number }[] = []
        const sample = made as { rows: readonly (readonly number[])[]; targets: readonly (string | number)[] }
        const shapedRows = sample.rows ?? []
        if (shapedRows.length > 0 && shapedRows[0].length === 2) {
          let least = Infinity
          let most = -Infinity
          for (const row of shapedRows) {
            least = Math.min(least, row[0], row[1])
            most = Math.max(most, row[0], row[1])
          }
          const margin = (most - least) * 0.12 || 1
          least -= margin
          most += margin

          const names = (facts as { classes: readonly { name: string }[] | null }).classes?.map((one) => one.name) ?? []
          const groupOf = (answer: unknown): number => {
            if (typeof answer === 'number') return answer
            const at = names.indexOf(String(answer))
            return at === -1 ? 0 : at
          }

          for (let at = 0; at < shapedRows.length; at += 1) {
            dots.push({ x: shapedRows[at][0], y: shapedRows[at][1], group: groupOf(sample.targets[at]) })
          }

          const size = 40
          const values: number[] = []
          let drawable = true
          for (let y = 0; y < size && drawable; y += 1) {
            for (let x = 0; x < size; x += 1) {
              const point = [least + ((most - least) * x) / (size - 1), most - ((most - least) * y) / (size - 1)]
              const said = predict(trained as never, point)
              if (isLearningError(said)) {
                drawable = false
                break
              }
              values.push(groupOf(said.answer))
            }
          }
          if (drawable && values.length === size * size) {
            field = { size, values, least: Math.min(...values), most: Math.max(...values) }
          }
        }

        send({
          kind: 'learning',
          generation,
          facts,
          trained,
          score,
          overfit,
          folds,
          components: made2,
          dots: Object.freeze(dots),
          field,
          assumptions: LEARNING_ASSUMPTIONS
        })
        return
      }

      // ---------------------------------------------------------------- neural networks
      case 'neural': {
        const data = problem(message.task, { rows: message.rows, seed: message.seed })
        if (refuse(data)) return
        const shaped = data as { rows: readonly (readonly number[])[]; targets: readonly (readonly number[])[]; classes?: readonly string[]; inputs: number; outputs: number; task: 'classification' | 'regression' }

        const layers = [
          ...message.hidden.filter((one) => one > 0).map((neurons) => ({ neurons, activation: message.activation })),
          { neurons: shaped.outputs, activation: message.outputActivation }
        ]
        const network = build(shaped.inputs, layers, {
          task: shaped.task,
          ...(shaped.classes === undefined ? {} : { classes: shaped.classes }),
          seed: message.seed
        })
        if (refuse(network)) return

        const facts = describeNetwork(network as never)
        const trained = trainNetwork(network as never, shaped, {
          rate: message.rate,
          steps: message.steps,
          batch: message.batch,
          momentum: message.momentum,
          seed: message.seed
        })
        if (isNeuralError(trained)) {
          send({ kind: 'refused', generation, says: trained.says, fix: trained.fix })
          return
        }
        const fitted = trained.network
        const score = optional(scoreNetwork(fitted, shaped))

        // Proof the gradients are right, on request. Slow — two forward passes per weight — so it is a choice.
        const gradientCheck = message.checkTheGradients ? optional(checkGradients(fitted, shaped.rows[0], shaped.targets[0])) : null

        /*
         * The boundary the network learned, sampled over a grid.
         *
         * Only for a two-input problem, because a boundary in more dimensions cannot be drawn and drawing a slice of
         * one would imply something the picture does not show.
         */
        let boundary: { size: number; values: number[]; least: number; most: number } | null = null
        const points: { x: number; y: number; group: number }[] = []
        if (shaped.inputs === 2) {
          let least = Infinity
          let most = -Infinity
          for (const row of shaped.rows) {
            least = Math.min(least, row[0], row[1])
            most = Math.max(most, row[0], row[1])
          }
          const margin = (most - least) * 0.12
          least -= margin
          most += margin

          const size = 48
          const values: number[] = []
          for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
              const at = [least + ((most - least) * x) / (size - 1), most - ((most - least) * y) / (size - 1)]
              const pass = forward(fitted, at)
              if (isNeuralError(pass)) {
                values.push(0)
                continue
              }
              // One output is read directly; several are read as the first class's share.
              values.push(pass.output.length === 1 ? pass.output[0] : (pass.probabilities ?? pass.output)[0])
            }
          }
          boundary = { size, values, least, most }
          for (let at = 0; at < shaped.rows.length; at += 1) {
            const target = shaped.targets[at]
            points.push({
              x: shaped.rows[at][0],
              y: shaped.rows[at][1],
              group: target.length === 1 ? (target[0] >= 0.5 ? 0 : 1) : target.reduce((bestAt, one, i, all) => (one > all[bestAt] ? i : bestAt), 0)
            })
          }
        }

        send({
          kind: 'neural',
          generation,
          facts,
          trained,
          score,
          gradientCheck,
          boundary,
          points: Object.freeze(points),
          assumptions: NEURAL_ASSUMPTIONS
        })
        return
      }

      default:
        return
    }
  } catch (error) {
    send({
      kind: 'broke',
      generation,
      says: `The ${message.kind} engine stopped: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}
