import { useEffect, useMemo, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes, Refused, didRefuse } from './LabShell'
import { useSystems } from './useSystems'
import { Diagram } from './Draw'
import Plot from './Plot'

/**
 * The Neural Network Laboratory.
 *
 * ## The boundary is sampled from the trained network
 *
 * Every point on the shaded field is the network's own answer for that position, worked out by running it. So the
 * boundary bends where the network learned to bend it, and a network that failed to learn shows a flat field — which
 * is the honest picture of failing to learn.
 *
 * ## The loss curve is recorded, not drawn
 *
 * Every value came out of training. A network that does not learn produces a flat line here, and that is what will
 * be shown.
 *
 * ## Exclusive-or is the one to try first
 *
 * Set the hidden layers to nothing and train it: it cannot get all four right, however long it runs, because no
 * straight line separates them. Put one hidden layer back and it does. That is the whole reason hidden layers exist,
 * and it is a thing to watch rather than be told.
 */

interface NetworkFacts {
  inputs: number
  outputs: number
  hidden: readonly number[]
  parameters: number
  depth: number
  says: string
  notes: readonly string[]
}

interface Step {
  step: number
  loss: number
  accuracy: number | null
  largestGradient: number
  firstLayerGradient: number
}

interface Training {
  history: readonly Step[]
  steps: number
  settled: boolean
  deadNeurons: readonly { layer: number; neuron: number }[]
  finalLoss: number
  finalAccuracy: number | null
  says: string
  notes: readonly string[]
}

interface NetworkScore {
  accuracy: number | null
  loss: number
  tested: number
  says: string
}

interface GradientCheck {
  worstRelative: number
  checked: number
  passed: boolean
  says: string
  notes: readonly string[]
}

interface Boundary {
  size: number
  values: readonly number[]
  least: number
  most: number
}

export default function NeuralLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState('boundary')

  const task = String(values.task ?? 'xor')
  const rows = Number(values.rows ?? 200)
  const hiddenText = String(values.hidden ?? '6')
  const activation = String(values.activation ?? 'tanh')
  const outputActivation = String(values.outputActivation ?? 'sigmoid')
  const rate = Number(values.rate ?? 0.1)
  const steps = Number(values.steps ?? 1000)
  const batch = Number(values.batch ?? 32)
  const momentum = Number(values.momentum ?? 0.9)
  const checkTheGradients = values.checkTheGradients === true
  const seed = Number(values.seed ?? 3)

  const hidden = useMemo(
    () =>
      hiddenText
        .split(/[\s,]+/)
        .map(Number)
        .filter((one) => Number.isFinite(one) && one > 0),
    [hiddenText]
  )

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({
      kind: 'neural',
      task: task as never,
      rows,
      hidden,
      activation: activation as never,
      outputActivation: outputActivation as never,
      rate,
      steps,
      batch,
      momentum,
      seed,
      checkTheGradients
    })
  }, [engines.ready, task, rows, hidden, activation, outputActivation, rate, steps, batch, momentum, seed, checkTheGradients])

  const held = engines.neural.value
  const facts = (held?.facts ?? null) as NetworkFacts | null
  const trained = (held?.trained ?? null) as Training | null
  const score = didRefuse(held?.score) ? null : ((held?.score ?? null) as NetworkScore | null)
  const gradients = didRefuse(held?.gradientCheck) ? null : ((held?.gradientCheck ?? null) as GradientCheck | null)
  const boundary = (held?.boundary ?? null) as Boundary | null
  const points = (held?.points ?? []) as readonly { x: number; y: number; group: number }[]

  const mostLoss = trained === null ? 1 : Math.max(...trained.history.map((one) => one.loss), 1e-12)

  return (
    <LabShell
      title="Neural network"
      summary={facts?.says}
      refused={engines.neural.refused}
      broke={engines.neural.broke}
      busy={engines.neural.busy}
      waitingFor="Training…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        ...(boundary !== null ? [{ id: 'boundary', label: 'What it learned' }] : []),
        { id: 'loss', label: 'While it trained' },
        { id: 'network', label: 'The network' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          <Refused held={held?.score} />
          <Refused held={held?.gradientCheck} />

          {facts !== null && (
            <Facts
              title="The network"
              rows={[
                ['In', facts.inputs],
                ['Hidden', facts.hidden.length === 0 ? 'none at all' : facts.hidden.join(' then ')],
                ['Out', facts.outputs],
                ['Weights and biases', facts.parameters]
              ]}
            />
          )}

          {trained !== null && (
            <Facts
              title="Training"
              rows={[
                ['Steps taken', trained.steps],
                ['Loss at the start', trained.history[0]?.loss.toFixed(5) ?? '—'],
                ['Loss at the end', trained.finalLoss.toFixed(5)],
                ['Settled', trained.settled ? 'yes' : 'no, it was still moving'],
                ['Dead neurons', trained.deadNeurons.length]
              ]}
            />
          )}

          {score !== null && (
            <Facts
              title="How well it does"
              rows={[
                ...(score.accuracy === null ? [] : ([['Right', `${(score.accuracy * 100).toFixed(1)}%`]] as const)),
                ['Loss', score.loss.toFixed(5)],
                ['Examples', score.tested]
              ]}
              about={score.says}
            />
          )}

          {gradients !== null && (
            <div className={`p3-panel${gradients.passed ? '' : ' p5-warn'}`}>
              <h4>Are the gradients right?</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>Weights checked</dt>
                  <dd>{gradients.checked}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Worst disagreement</dt>
                  <dd>{(gradients.worstRelative * 100).toExponential(1)}%</dd>
                </div>
              </dl>
              <p className="p2-faint">{gradients.says}</p>
              <Notes title="" notes={gradients.notes} />
            </div>
          )}

          {trained !== null && trained.deadNeurons.length > 0 && (
            <div className="p3-panel p5-warn">
              <h4>Neurons that stopped working</h4>
              <p className="p2-faint">
                {trained.deadNeurons.length} never produced a positive value for any example. Their gradient is exactly
                zero, so they will never change again.
              </p>
            </div>
          )}

          <Notes title="Worth knowing" notes={trained?.notes} />
          <Notes title="About the network" notes={facts?.notes} />
        </>
      }
    >
      {showing === 'boundary' && boundary !== null && (
        <>
          <h4 className="p4-heading">The boundary it learned</h4>
          <div className="p5-boundary">
            <svg viewBox="0 0 100 100" role="img" aria-label="The boundary the network learned, with the training points on it">
              {/* Each cell is the network's own answer at that position. */}
              {boundary.values.map((one, index) => {
                const x = index % boundary.size
                const y = Math.floor(index / boundary.size)
                const step = 100 / boundary.size
                return (
                  <rect
                    key={index}
                    x={x * step}
                    y={y * step}
                    width={step + 0.2}
                    height={step + 0.2}
                    fill={one >= 0.5 ? 'var(--cyan)' : '#f0a33a'}
                    // How sure it is, so an undecided region reads as undecided rather than as a hard edge.
                    opacity={Math.min(0.45, Math.abs(one - 0.5) * 0.8)}
                  />
                )
              })}
              {points.map((one, index) => (
                <circle
                  key={index}
                  cx={((one.x - boundary.least) / (boundary.most - boundary.least)) * 100}
                  cy={100 - ((one.y - boundary.least) / (boundary.most - boundary.least)) * 100}
                  r="1.1"
                  className={`p5-point group${one.group}`}
                />
              ))}
            </svg>
          </div>
          <ul className="p4-legend">
            <li>
              <span className="p4-swatch" style={{ background: 'var(--cyan)' }} aria-hidden="true" />
              where it says one class
            </li>
            <li>
              <span className="p4-swatch" style={{ background: '#f0a33a' }} aria-hidden="true" />
              where it says the other
            </li>
            <li className="p4-legend-mark">the dots are the examples it was given; paler shading means it is less sure</li>
          </ul>
          {facts !== null && facts.hidden.length === 0 && (
            <p className="p4-says">
              With no hidden layer the boundary can only ever be a straight line. On exclusive-or or a ring that is
              not enough, however long it trains — add a hidden layer and watch the boundary bend.
            </p>
          )}
        </>
      )}

      {showing === 'loss' && trained !== null && (
        <>
          <h4 className="p4-heading">The loss, every step</h4>
          {/*
            * A curve, because the shape of it is the whole diagnosis.
            *
            * A learning rate too high is a line that jumps about; too low is one that barely moves; one that falls and
            * then flattens has stopped learning. Bars of varying height say the same numbers and hide every one of
            * those shapes.
            */}
          <Plot
            series={[
              { id: 'loss', label: 'Loss', points: trained.history.map((one) => ({ x: one.step, y: one.loss })) },
              ...(trained.history.some((one) => one.accuracy !== null)
                ? [
                    {
                      id: 'accuracy',
                      label: 'How much it got right',
                      points: trained.history.map((one) => ({ x: one.step, y: (one.accuracy ?? 0) * mostLoss })),
                      colour: '#37d67a',
                      dashed: true
                    }
                  ]
                : [])
            ]}
            xLabel="step"
            yLabel="loss"
            height={180}
            about={
              trained.history.some((one) => one.accuracy !== null)
                ? 'The dashed line is how much it was getting right, drawn on the same scale as the loss so the two can be compared at a glance rather than by number.'
                : undefined
            }
          />
          <p className="p4-says">{trained.says}</p>

          {trained.history.some((one) => one.accuracy !== null) && (
            <>
              <h4 className="p4-heading">And how much it was getting right</h4>
              <div className="p5-loss accuracy">
                {trained.history.map((one) => (
                  <span key={one.step} style={{ height: `${Math.max(1, (one.accuracy ?? 0) * 100)}%` }} title={`step ${one.step}: ${((one.accuracy ?? 0) * 100).toFixed(0)}%`} />
                ))}
              </div>
            </>
          )}

          <h4 className="p4-heading">The gradient reaching the first layer</h4>
          <div className="p5-loss gradient">
            {trained.history.map((one) => {
              const most = Math.max(...trained.history.map((x) => x.firstLayerGradient), 1e-18)
              return (
                <span
                  key={one.step}
                  style={{ height: `${Math.max(1, (one.firstLayerGradient / most) * 100)}%` }}
                  title={`step ${one.step}: ${one.firstLayerGradient.toExponential(2)}`}
                />
              )
            })}
          </div>
          <p className="p2-faint">
            Each layer multiplies the gradient by the slope of its activation on the way back. Through several
            squashing activations that product heads towards nothing, and the early layers stop learning — which is
            what this shows when it does.
          </p>
        </>
      )}

      {showing === 'network' && facts !== null && (
        <>
          <h4 className="p4-heading">The network</h4>
          {/*
            * Every neuron and every connection, up to a size worth drawing.
            *
            * A row of boxes saying "4" tells you the shape; this tells you what the shape means -- that each neuron in
            * a layer is joined to every neuron in the next, and that the parameter count on the right is exactly the
            * number of lines in the picture plus one bias each.
            */}
          {facts.inputs + facts.hidden.reduce((total, one) => total + one, 0) + facts.outputs <= 40 ? (
            <Diagram
              height={Math.max(180, Math.max(facts.inputs, facts.outputs, ...facts.hidden) * 40)}
              nodes={[
                ...Array.from({ length: facts.inputs }, (_, i) => ({ id: `in${i}`, label: `x${i + 1}`, depth: 0, group: 5 })),
                ...facts.hidden.flatMap((neurons, layer) =>
                  Array.from({ length: neurons }, (_, i) => ({ id: `h${layer}-${i}`, label: '', depth: layer + 1, group: 0, note: activation }))
                ),
                ...Array.from({ length: facts.outputs }, (_, i) => ({
                  id: `out${i}`,
                  label: facts.outputs === 1 ? 'y' : `y${i + 1}`,
                  depth: facts.hidden.length + 1,
                  group: 2
                }))
              ]}
              edges={[
                ...Array.from({ length: facts.inputs }, (_, i) =>
                  Array.from({ length: facts.hidden[0] ?? facts.outputs }, (_, j) => ({
                    from: `in${i}`,
                    to: facts.hidden.length > 0 ? `h0-${j}` : `out${j}`
                  }))
                ).flat(),
                ...facts.hidden.flatMap((neurons, layer) =>
                  Array.from({ length: neurons }, (_, i) =>
                    Array.from({ length: layer + 1 < facts.hidden.length ? facts.hidden[layer + 1] : facts.outputs }, (_, j) => ({
                      from: `h${layer}-${i}`,
                      to: layer + 1 < facts.hidden.length ? `h${layer + 1}-${j}` : `out${j}`
                    }))
                  ).flat()
                )
              ]}
              about={`${facts.parameters} weights and biases in all — one line here for each weight, and one bias for each neuron that is not an input.`}
            />
          ) : (
            <p className="p2-faint">
              This network has too many neurons to draw one by one — {facts.parameters} weights would be that many
              lines. The shape is below.
            </p>
          )}

          <h4 className="p4-heading">The layers</h4>
          <div className="p5-layers">
            <div className="p5-layer">
              <strong>{facts.inputs}</strong>
              <small>in</small>
            </div>
            {facts.hidden.map((neurons, index) => (
              <div key={index} className="p5-layer hidden">
                <strong>{neurons}</strong>
                <small>{activation}</small>
              </div>
            ))}
            <div className="p5-layer out">
              <strong>{facts.outputs}</strong>
              <small>{outputActivation}</small>
            </div>
          </div>
          <p className="p4-says">{facts.says}</p>
        </>
      )}
    </LabShell>
  )
}
