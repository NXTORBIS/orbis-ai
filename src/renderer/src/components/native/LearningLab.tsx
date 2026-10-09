import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes, Refused, didRefuse } from './LabShell'
import { useSystems } from './useSystems'
import { Scatter } from './Draw'

/**
 * The Machine Learning Laboratory.
 *
 * ## The baseline sits next to the accuracy, always
 *
 * 94% is excellent on balanced data and worthless on data that is 94% one class. Putting what always guessing the
 * commonest class would score beside the model's score makes that impossible to miss, and it is the single most
 * useful number on the panel.
 *
 * ## Trained on one half, judged on the other, and both shown
 *
 * A model at 99% on what it learned from and 61% on what it did not has memorised rather than learned. Only seeing
 * the two together says so, so the gap is reported rather than the better of the two.
 */

interface DatasetFacts {
  rows: number
  features: number
  classes: readonly { name: string; count: number; share: number }[] | null
  kind: string
  says: string
  notes: readonly string[]
}

interface Trained {
  kind: string
  trainedOn: number
  iterations: number | null
  converged: boolean | null
  history: readonly number[]
  says: string
  notes: readonly string[]
  model: unknown
}

interface ClassificationScore {
  accuracy: number
  confusion: readonly { actual: string; predicted: string; count: number }[]
  perClass: readonly { name: string; precision: number; recall: number; f1: number; support: number }[]
  macroF1: number
  baseline: number
  tested: number
  says: string
  notes: readonly string[]
}

interface RegressionScore {
  mae: number
  rmse: number
  r2: number
  worst: { row: number; actual: number; predicted: number; off: number }
  tested: number
  says: string
  notes: readonly string[]
}

interface Overfit {
  onTraining: number
  onTesting: number
  gap: number
  overfitting: boolean
  says: string
}

interface Folds {
  folds: number
  scores: readonly number[]
  mean: number
  spread: number
  says: string
  notes: readonly string[]
}

interface Components {
  explained: readonly number[]
  cumulative: readonly number[]
  needFor95: number
  says: string
  notes: readonly string[]
}

export default function LearningLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState('score')

  const dataset = String(values.dataset ?? 'two-blobs')
  const rows = Number(values.rows ?? 200)
  const holdBack = Number(values.holdBack ?? 0.25)
  const model = String(values.model ?? 'nearest-neighbours')
  const neighbours = Number(values.neighbours ?? 5)
  const depth = Number(values.depth ?? 4)
  const groups = Number(values.groups ?? 3)
  const degree = Number(values.degree ?? 1)
  const rate = Number(values.rate ?? 0.1)
  const iterations = Number(values.iterations ?? 500)
  const folds = Number(values.folds ?? 5)
  const alsoComponents = values.alsoComponents === true
  const seed = Number(values.seed ?? 7)

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({
      kind: 'learning',
      dataset: dataset as never,
      rows,
      model: model as never,
      neighbours,
      depth,
      groups,
      degree,
      rate,
      iterations,
      holdBack,
      seed,
      scale: false,
      folds,
      alsoComponents
    })
  }, [engines.ready, dataset, rows, model, neighbours, depth, groups, degree, rate, iterations, holdBack, seed, folds, alsoComponents])

  const held = engines.learning.value
  /*
   * The data, and the region the model would put each part of the plane in.
   *
   * Both come from the worker, which asked the model about every point of a grid. Nothing here interpolates, smooths
   * or guesses between them: a boundary drawn by eye is a boundary the model does not have.
   */
  const dots = (held?.dots ?? []) as readonly { x: number; y: number; group: number }[]
  const field = (held?.field ?? null) as { size: number; values: readonly number[]; least: number; most: number } | null
  const facts = (held?.facts ?? null) as DatasetFacts | null
  const trained = (held?.trained ?? null) as Trained | null
  const score = didRefuse(held?.score) ? null : ((held?.score ?? null) as ClassificationScore | RegressionScore | null)
  const overfit = didRefuse(held?.overfit) ? null : ((held?.overfit ?? null) as Overfit | null)
  const crossed = didRefuse(held?.folds) ? null : ((held?.folds ?? null) as Folds | null)
  const components = didRefuse(held?.components) ? null : ((held?.components ?? null) as Components | null)

  const classifying = score !== null && 'accuracy' in score
  const classScore = classifying ? (score as ClassificationScore) : null
  const numberScore = !classifying && score !== null ? (score as RegressionScore) : null

  const classNames = classScore === null ? [] : [...new Set(classScore.confusion.map((one) => one.actual))].sort()

  return (
    <LabShell
      title="Machine learning"
      summary={trained?.says}
      refused={engines.learning.refused}
      broke={engines.learning.broke}
      busy={engines.learning.busy}
      waitingFor="Fitting the model…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'score', label: 'How well it did' },
        ...(classScore !== null ? [{ id: 'confusion', label: 'What it confused' }] : []),
        ...(trained !== null && trained.history.length > 1 ? [{ id: 'loss', label: 'While it trained' }] : []),
        ...(components !== null ? [{ id: 'components', label: 'Directions of variation' }] : [])
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          <Refused held={held?.score} />
          <Refused held={held?.overfit} />
          <Refused held={held?.folds} />

          {facts !== null && (
            <Facts
              title="The data"
              rows={[
                ['Rows', facts.rows],
                ['Features', facts.features],
                ['Predicting', facts.kind === 'classification' ? `${facts.classes?.length} classes` : 'a number'],
                ['Held back', `${(holdBack * 100).toFixed(0)}%`]
              ]}
              about={facts.says}
            />
          )}

          {classScore !== null && (
            <Facts
              title="On data it never saw"
              rows={[
                ['Right', `${(classScore.accuracy * 100).toFixed(1)}%`],
                ['Always guessing the commonest', `${(classScore.baseline * 100).toFixed(1)}%`],
                ['Better than guessing by', `${((classScore.accuracy - classScore.baseline) * 100).toFixed(1)} points`],
                ['Average F1', classScore.macroF1.toFixed(3)],
                ['Rows tested', classScore.tested]
              ]}
            />
          )}

          {numberScore !== null && (
            <Facts
              title="On data it never saw"
              rows={[
                ['Out by, on average', numberScore.mae.toFixed(4)],
                ['Root mean square error', numberScore.rmse.toFixed(4)],
                ['Variation accounted for', `${(numberScore.r2 * 100).toFixed(1)}%`],
                ['Worst single miss', numberScore.worst.off.toFixed(3)]
              ]}
            />
          )}

          {overfit !== null && (
            <div className={`p3-panel${overfit.overfitting ? ' p5-warn' : ''}`}>
              <h4>Did it learn, or memorise?</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>On what it learned from</dt>
                  <dd>{(overfit.onTraining * 100).toFixed(1)}%</dd>
                </div>
                <div className="p4-fact">
                  <dt>On what it did not</dt>
                  <dd>{(overfit.onTesting * 100).toFixed(1)}%</dd>
                </div>
                <div className="p4-fact">
                  <dt>Gap</dt>
                  <dd>{(overfit.gap * 100).toFixed(1)} points</dd>
                </div>
              </dl>
              <p className="p2-faint">{overfit.says}</p>
            </div>
          )}

          {crossed !== null && (
            <div className="p3-panel">
              <h4>Over {crossed.folds} different splits</h4>
              <div className="p5-folds">
                {crossed.scores.map((one, index) => (
                  <div key={index} className="p5-fold" title={`${(one * 100).toFixed(1)}%`}>
                    <span style={{ height: `${Math.max(2, one * 100)}%` }} />
                  </div>
                ))}
              </div>
              <p className="p2-faint">{crossed.says}</p>
            </div>
          )}

          <Notes title="About the model" notes={trained?.notes} />
          <Notes title="About the score" notes={classScore?.notes ?? numberScore?.notes} />
          <Notes title="About the data" notes={facts?.notes} />
          <Notes title="About the checking" notes={crossed?.notes} />
        </>
      }
    >
      {/*
        * Above the tabs, not behind one.
        *
        * The picture is the subject of the laboratory -- the scores underneath are how well the line in it did. Behind
        * a tab it would be something somebody had to think to look for, which is how the whole of this laboratory came
        * to be a table of numbers in the first place.
        */}
      {dots.length > 0 && (
        <>
          <h4 className="p4-heading">The data, and where it drew the line</h4>
          <Scatter
            dots={dots}
            field={field}
            xLabel={(facts as unknown as { featureNames?: readonly string[] })?.featureNames?.[0] ?? 'first feature'}
            yLabel={(facts as unknown as { featureNames?: readonly string[] })?.featureNames?.[1] ?? 'second feature'}
            about={
              field === null
                ? 'Each point is one row, coloured by the answer it really has. This model cannot be asked about a point it has not seen, so there are no regions behind them.'
                : 'Each point is one row, coloured by the answer it really has. The shading behind them is what the model would answer for every other point — so a point sitting on the wrong shade is a mistake you can see.'
            }
          />
        </>
      )}

      {showing === 'score' && (
        <>
          {classScore !== null && (
            <>
              <h4 className="p4-heading">Per class, because the overall figure can hide a lot</h4>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Of those predicted, right</th>
                      <th>Of those there, found</th>
                      <th>F1</th>
                      <th>How many there were</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classScore.perClass.map((one) => (
                      <tr key={one.name} className={one.recall === 0 && one.support > 0 ? 'p5-starved' : ''}>
                        <td>{one.name}</td>
                        <td className="p4-num">{(one.precision * 100).toFixed(1)}%</td>
                        <td className="p4-num">{(one.recall * 100).toFixed(1)}%</td>
                        <td className="p4-num">{one.f1.toFixed(3)}</td>
                        <td className="p4-num">{one.support}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* The accuracy against the baseline, drawn, because the gap is the whole point. */}
              <h4 className="p4-heading">Against always guessing</h4>
              <div className="p5-versus">
                <div className="p5-versus-bar">
                  <span style={{ width: `${classScore.accuracy * 100}%` }} className="model" />
                  <small>this model — {(classScore.accuracy * 100).toFixed(1)}%</small>
                </div>
                <div className="p5-versus-bar">
                  <span style={{ width: `${classScore.baseline * 100}%` }} className="baseline" />
                  <small>always the commonest — {(classScore.baseline * 100).toFixed(1)}%</small>
                </div>
              </div>
            </>
          )}

          {numberScore !== null && (
            <>
              <h4 className="p4-heading">How close it got</h4>
              <Facts
                title=""
                rows={[
                  ['Average miss', numberScore.mae.toFixed(4)],
                  ['Worst row', `wanted ${numberScore.worst.actual.toFixed(3)}, said ${numberScore.worst.predicted.toFixed(3)}`]
                ]}
              />
              <p className="p4-says">{numberScore.says}</p>
            </>
          )}

          {score === null && trained !== null && (
            <p className="p4-says">
              {trained.says} This model groups rather than predicts, so there is nothing to score it against — the
              groups it found are shown by what went into each.
            </p>
          )}
        </>
      )}

      {showing === 'confusion' && classScore !== null && (
        <>
          <h4 className="p4-heading">What was mistaken for what</h4>
          <div className="p2-table-wrap">
            <table className="p2-table p5-confusion">
              <thead>
                <tr>
                  <th>was ↓ / said →</th>
                  {classNames.map((one) => (
                    <th key={one}>{one}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classNames.map((actual) => (
                  <tr key={actual}>
                    <th scope="row">{actual}</th>
                    {classNames.map((predicted) => {
                      const cell = classScore.confusion.find((one) => one.actual === actual && one.predicted === predicted)
                      const count = cell?.count ?? 0
                      const right = actual === predicted
                      return (
                        <td
                          key={predicted}
                          className={`p4-num${right ? ' p5-right' : count > 0 ? ' p5-wrong' : ''}`}
                          style={count > 0 ? { opacity: 0.35 + Math.min(0.65, count / classScore.tested * 3) } : undefined}
                        >
                          {count}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p2-faint">
            The diagonal is what it got right. Everything off it is a mistake, and which cell it lands in says what
            kind of mistake it was.
          </p>
        </>
      )}

      {showing === 'loss' && trained !== null && trained.history.length > 1 && (
        <>
          <h4 className="p4-heading">The loss while it trained</h4>
          <div className="p5-loss">
            {trained.history.map((one, index) => {
              const most = Math.max(...trained.history)
              return (
                <span
                  key={index}
                  style={{ height: `${Math.max(1, (one / most) * 100)}%` }}
                  title={`round ${index}: ${one.toFixed(5)}`}
                />
              )
            })}
          </div>
          <p className="p4-says">
            From {trained.history[0].toFixed(5)} to {trained.history[trained.history.length - 1].toFixed(5)} over{' '}
            {trained.history.length} rounds
            {trained.converged === true ? ', then it stopped moving.' : ', and it was still moving when the rounds ran out.'}
          </p>
        </>
      )}

      {showing === 'components' && components !== null && (
        <>
          <h4 className="p4-heading">How much variation each direction carries</h4>
          <div className="p5-components">
            {components.explained.map((one, index) => (
              <div key={index} className="p5-component">
                <span style={{ width: `${one * 100}%` }} />
                <small>
                  {index + 1} — {(one * 100).toFixed(1)}% (running total {(components.cumulative[index] * 100).toFixed(1)}%)
                </small>
              </div>
            ))}
          </div>
          <p className="p4-says">{components.says}</p>
          <Notes title="" notes={components.notes} />
        </>
      )}
    </LabShell>
  )
}
