import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import Plot, { tidy } from './Plot'
import { useEngineering } from './useEngineering'
import './phase2.css'
import './phase3.css'
import './phase4.css'

/**
 * The Control Laboratory.
 *
 * ## The loop is simulated, not illustrated
 *
 * The response curve comes from `simulatePid`, which steps a real PID controller against a real plant transfer
 * function with the output limits and the integral wind-up behaviour that a physical loop has. So raising the
 * integral gain causes wind-up because wind-up happened, and the saturated fraction reported is the fraction of the
 * run during which the controller was asking for more than it could have.
 *
 * ## Overshoot and settling time are measured off the curve
 *
 * The control engine finds them from the samples it produced. Nothing here reads them from a formula, which matters
 * because the formula only holds for a second-order system and the laboratory lets you type any plant you like.
 * Where the engine cannot find one — an unstable loop has no settling time — it reports null and the panel says so
 * instead of showing a number.
 *
 * ## A tuning rule is offered, never applied
 *
 * Asking for Ziegler-Nichols shows what it would set, beside what is set now. A laboratory that retuned itself
 * would make it impossible to see what the rule changed, which is the only reason to look at it.
 */

interface StepReport {
  samples: readonly { time: number; output: number }[]
  finalValue: number | null
  overshoot: number | null
  peakTime: number | null
  settlingTime: number | null
  settlingBand: number
  riseTime: number | null
  steadyStateError: number | null
  stable: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

interface BodeReport {
  points: readonly { frequency: number; magnitudeDb: number; phaseDegrees: number }[]
  gainCrossover: number | null
  phaseMargin: number | null
  phaseCrossover: number | null
  gainMarginDb: number | null
  closedLoopStable: boolean | null
  peakDb: number
  peakFrequency: number
  bandwidth: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

interface PidSimReport {
  samples: readonly { time: number; setpoint: number; output: number; control: number; saturated: boolean }[]
  saturatedFraction: number
  finalError: number
  absoluteErrorIntegral: number
  notes: readonly string[]
  warnings: readonly string[]
}

interface PoleZeroReport {
  poles: readonly {
    value: { re: number; im: number }
    kind: 'real' | 'complex-pair'
    timeConstant: number | null
    naturalFrequency: number | null
    dampingRatio: number | null
  }[]
  zeros: readonly { re: number; im: number }[]
  order: number
  stable: boolean
  marginal: boolean
  dominant: { value: { re: number; im: number }; timeConstant: number | null } | null
  dcGain: number | null
  nonMinimumPhase: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

interface RouthReport {
  rows: readonly (readonly number[])[]
  rightHalfPlanePoles: number
  stable: boolean
  auxiliaryUsed: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

interface TuningReport {
  rule: string
  label: string
  gains: { proportional: number; integral: number; derivative: number; integralTime: number | null; derivativeTime: number | null }
  form: string
  fittedFor: string
  behaviour: string
  notes: readonly string[]
  warnings: readonly string[]
}

const readPolynomial = (text: string): readonly number[] => {
  const out = String(text)
    .split(/[\s,;]+/)
    .map((one) => Number(one))
    .filter((one) => Number.isFinite(one))
  return out.length > 0 ? out : [1]
}

const asFraction = (numerator: readonly number[], denominator: readonly number[]): string => {
  const term = (coefficients: readonly number[]): string => {
    const order = coefficients.length - 1
    const parts: string[] = []
    for (let i = 0; i < coefficients.length; i += 1) {
      const power = order - i
      const value = coefficients[i]
      if (value === 0) continue
      const size = Math.abs(value) === 1 && power > 0 ? '' : String(Math.abs(value))
      const s = power === 0 ? '' : power === 1 ? 's' : `s^${power}`
      parts.push(`${parts.length === 0 ? (value < 0 ? '−' : '') : value < 0 ? ' − ' : ' + '}${size}${s}`)
    }
    return parts.length === 0 ? '0' : parts.join('')
  }
  return `(${term(numerator)}) / (${term(denominator)})`
}

export default function ControlLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engineering = useEngineering()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<'response' | 'frequency' | 'poles'>('response')

  const numerator = readPolynomial(String(values.numerator ?? '1'))
  const denominator = readPolynomial(String(values.denominator ?? '1 3 1'))
  const proportional = Number(values.proportional ?? 2)
  const integral = Number(values.integral ?? 1)
  const derivative = Number(values.derivative ?? 0.2)
  const setpoint = Number(values.setpoint ?? 1)
  const duration = Number(values.duration ?? 20)
  const timeStep = Number(values.timeStep ?? 0.01)
  const outputMinimum = Number(values.outputMinimum ?? -10)
  const outputMaximum = Number(values.outputMaximum ?? 10)
  const antiWindup = values.antiWindup !== false
  const rule = String(values.rule ?? 'none')

  useEffect(() => {
    if (!engineering.ready) return
    engineering.ask({
      kind: 'control',
      numerator,
      denominator,
      gains: { proportional, integral, derivative },
      setpoint,
      duration,
      timeStep,
      outputMinimum,
      outputMaximum,
      antiWindup,
      ...(rule === 'none' ? {} : { rule: rule as never, form: 'PID' })
    })
  }, [
    engineering.ready,
    String(numerator),
    String(denominator),
    proportional,
    integral,
    derivative,
    setpoint,
    duration,
    timeStep,
    outputMinimum,
    outputMaximum,
    antiWindup,
    rule
  ])

  const held = engineering.control.value
  const step = (held?.step ?? null) as StepReport | null
  const bodePlot = (held?.bodePlot ?? null) as BodeReport | null
  const pid = (held?.pid ?? null) as PidSimReport | null
  const poles = (held?.poles ?? null) as PoleZeroReport | null
  const routh = (held?.routh ?? null) as RouthReport | null
  /*
   * `?? null`, because the cast was a promise the value did not keep.
   *
   * `held?.tuned` is undefined when the report has no tuning in it, and `as ... | null` only changed what the type
   * checker believed. Everything below asks `tuned !== null`, which undefined passes, and the next line read a field
   * off it -- which threw, took the whole window down with it, and left a blank app behind.
   */
  const tuned = (held?.tuned ?? null) as (TuningReport & { refused?: { says: string; fix: string } }) | null

  const unstable = step !== null && !step.stable

  return (
    <section className="p2 p4" aria-label="Control Laboratory">
      <header className="p2-bar">
        <strong>Control loop</strong>
        <span className="p2-faint">Plant {asFraction(numerator, denominator)}</span>
      </header>

      {engineering.control.refused && (
        <p className="p2-refused" role="status">
          <strong>{engineering.control.refused.says}</strong> {engineering.control.refused.fix}
        </p>
      )}
      {engineering.control.broke && (
        <p className="p2-refused" role="status">
          {engineering.control.broke}
        </p>
      )}
      {unstable && (
        <p className="p2-refused" role="status">
          <strong>This loop is unstable.</strong> The response grows instead of settling, so overshoot and settling
          time have no meaning here and are not shown. {routh !== null && routh.rightHalfPlanePoles > 0
            ? `${routh.rightHalfPlanePoles} of its poles are in the right half plane.`
            : ''}{' '}
          Lower the gains, or add more derivative action.
        </p>
      )}

      <div className="p2-tabs" role="tablist">
        {(['response', 'frequency', 'poles'] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            className="p2-tab"
            aria-selected={showing === one}
            onClick={() => setShowing(one)}
          >
            {one === 'response' ? 'How it responds' : one === 'frequency' ? 'Across frequency' : 'Why it behaves that way'}
          </button>
        ))}
      </div>

      <div className="p3-split">
        <div>
          {held === null && <p className="p2-faint">{engineering.control.busy ? 'Simulating…' : 'Nothing simulated yet.'}</p>}

          {showing === 'response' && pid !== null && (
            <>
              <Plot
                series={[
                  { id: 'out', label: 'What it measured', points: pid.samples.map((one) => ({ x: one.time, y: one.output })) },
                  {
                    id: 'set',
                    label: 'What it was asked for',
                    points: pid.samples.map((one) => ({ x: one.time, y: one.setpoint })),
                    dashed: true,
                    colour: '#f0a33a'
                  }
                ]}
                xLabel="seconds"
                yLabel="value"
                markers={[
                  ...(step?.peakTime != null ? [{ x: step.peakTime, label: 'peak' }] : []),
                  ...(step?.settlingTime != null ? [{ x: step.settlingTime, label: 'settled' }] : [])
                ]}
                about={
                  step === null
                    ? ''
                    : step.stable
                      ? `It overshot by ${step.overshoot === null ? 'nothing measurable' : `${(step.overshoot * 100).toFixed(1)}%`} and settled within ±${(step.settlingBand * 100).toFixed(0)}% after ${step.settlingTime === null ? 'longer than this run' : `${tidy(step.settlingTime)} s`}.`
                      : 'The output is growing rather than settling, so there is nothing to measure off it.'
                }
              />
              <Plot
                series={[
                  { id: 'u', label: 'What the controller asked the actuator for', points: pid.samples.map((one) => ({ x: one.time, y: one.control })), colour: '#37d67a' },
                  {
                    id: 'max',
                    label: 'The most it can give',
                    points: [
                      { x: 0, y: outputMaximum },
                      { x: duration, y: outputMaximum }
                    ],
                    dashed: true,
                    colour: '#e05c5c'
                  },
                  {
                    id: 'min',
                    label: 'The least it can give',
                    points: [
                      { x: 0, y: outputMinimum },
                      { x: duration, y: outputMinimum }
                    ],
                    dashed: true,
                    colour: '#e05c5c'
                  }
                ]}
                xLabel="seconds"
                yLabel="control signal"
                zero={0}
                height={170}
                about={
                  pid.saturatedFraction > 0.01
                    ? `The controller was asking for more than it could have for ${(pid.saturatedFraction * 100).toFixed(0)}% of the run. That is saturation, and it is why a real loop does not behave like the formula.`
                    : 'The controller stayed within what the actuator can give for the whole run.'
                }
              />
            </>
          )}

          {showing === 'frequency' && bodePlot !== null && (
            <>
              <Plot
                series={[
                  { id: 'mag', label: 'Gain (dB)', points: bodePlot.points.map((one) => ({ x: one.frequency, y: one.magnitudeDb })) }
                ]}
                xLabel="radians per second"
                yLabel="decibels"
                zero={0}
                markers={bodePlot.gainCrossover === null ? [] : [{ x: bodePlot.gainCrossover, label: 'gain crosses 0dB' }]}
                about="Where the gain crosses zero decibels is where the loop stops amplifying and starts attenuating. How much phase is left at that point is the phase margin."
              />
              <Plot
                series={[
                  {
                    id: 'phase',
                    label: 'Phase (degrees)',
                    points: bodePlot.points.map((one) => ({ x: one.frequency, y: one.phaseDegrees })),
                    colour: '#c08bf0'
                  },
                  {
                    id: 'limit',
                    label: 'Where it would go unstable (−180°)',
                    points: [
                      { x: bodePlot.points[0]?.frequency ?? 0.01, y: -180 },
                      { x: bodePlot.points[bodePlot.points.length - 1]?.frequency ?? 100, y: -180 }
                    ],
                    dashed: true,
                    colour: '#e05c5c'
                  }
                ]}
                xLabel="radians per second"
                yLabel="degrees"
                height={170}
                about={
                  bodePlot.phaseMargin === null
                    ? 'The gain never crosses zero decibels in this range, so there is no phase margin to report.'
                    : `The phase margin is ${tidy(bodePlot.phaseMargin)}°. Below about 30° a loop is close enough to instability that a small change in the plant can tip it over.`
                }
              />
            </>
          )}

          {showing === 'poles' && poles !== null && (
            <>
              <h4 className="p4-heading">Where the closed loop's poles are</h4>
              <PoleMap poles={poles} />
              <p className="p2-faint">
                A pole to the left of the vertical line decays; one to the right grows. How far from the horizontal
                line it sits is how much it rings on the way. That is the whole of stability in one picture.
              </p>
              {routh !== null && (
                <div className="p3-panel">
                  <h4>The Routh table</h4>
                  <div className="p2-table-wrap">
                    <table className="p2-table">
                      <tbody>
                        {routh.rows.map((row, index) => (
                          <tr key={index}>
                            {row.map((cell, k) => (
                              <td key={k} className="p4-num">
                                {tidy(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="p2-faint">
                    {routh.stable
                      ? 'Every value in the first column has the same sign, which is what says the loop is stable — without having to find the poles at all.'
                      : `A sign change in the first column means ${routh.rightHalfPlanePoles} pole${routh.rightHalfPlanePoles === 1 ? '' : 's'} on the unstable side.`}
                    {routh.auxiliaryUsed ? ' A row came out all zeros, so the auxiliary polynomial was used — that means poles sitting exactly on the boundary.' : ''}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p3-side">
          {step !== null && (
            <div className="p3-panel">
              <h4>Measured off the curve</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>Stable</dt>
                  <dd>{step.stable ? 'yes' : 'no'}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Overshoot</dt>
                  <dd>{step.overshoot === null ? 'none measurable' : `${(step.overshoot * 100).toFixed(1)}%`}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Rise time</dt>
                  <dd>{step.riseTime === null ? 'not reached' : `${tidy(step.riseTime)} s`}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Settling time</dt>
                  <dd>{step.settlingTime === null ? 'not within this run' : `${tidy(step.settlingTime)} s`}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Steady-state error</dt>
                  <dd>{step.steadyStateError === null ? 'no steady state' : tidy(step.steadyStateError)}</dd>
                </div>
                {pid !== null && (
                  <div className="p4-fact">
                    <dt>Total error</dt>
                    <dd>{tidy(pid.absoluteErrorIntegral)}</dd>
                  </div>
                )}
              </dl>
              <p className="p2-faint">
                These come from the simulated samples, not from a formula — which is why they are still right for a
                plant that is not second order.
              </p>
            </div>
          )}

          {tuned !== null && (
            <div className="p3-panel">
              <h4>What {tuned.refused ? 'the rule' : tuned.label} would set</h4>
              {tuned.refused ? (
                <p className="p2-faint">
                  <strong>{tuned.refused.says}</strong> {tuned.refused.fix}
                </p>
              ) : (
                <>
                  <dl className="p3-facts">
                    <div className="p4-fact">
                      <dt>Kp</dt>
                      <dd>
                        {tidy(tuned.gains.proportional)} <small>now {tidy(proportional)}</small>
                      </dd>
                    </div>
                    <div className="p4-fact">
                      <dt>Ki</dt>
                      <dd>
                        {tidy(tuned.gains.integral)} <small>now {tidy(integral)}</small>
                      </dd>
                    </div>
                    <div className="p4-fact">
                      <dt>Kd</dt>
                      <dd>
                        {tidy(tuned.gains.derivative)} <small>now {tidy(derivative)}</small>
                      </dd>
                    </div>
                  </dl>
                  <p className="p2-faint">
                    {tuned.behaviour} Fitted for {tuned.fittedFor}. These are not applied — type them in to try them,
                    so you can see what the rule changed.
                  </p>
                  {tuned.warnings.length > 0 && (
                    <ul className="p4-notes">
                      {tuned.warnings.map((one, index) => (
                        <li key={index}>{one}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {(step?.warnings.length ?? 0) + (pid?.warnings.length ?? 0) + (bodePlot?.warnings.length ?? 0) > 0 && (
            <div className="p3-panel">
              <h4>Worth knowing</h4>
              <ul className="p4-notes">
                {[...(step?.warnings ?? []), ...(pid?.warnings ?? []), ...(bodePlot?.warnings ?? [])].map((one, index) => (
                  <li key={index}>{one}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="p3-panel">
            <h4>What this does not model</h4>
            <ul className="p3-assumptions">
              {(held?.assumptions ?? []).map((one, index) => (
                <li key={index}>{one}</li>
              ))}
              <li>
                The plant is a linear transfer function. A real actuator has backlash, friction and a response that
                changes with where it is, none of which is here.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings" open>
          <summary>Settings</summary>
          <Parameters
            definitions={instance.definitions}
            shown={instance.shown}
            values={instance.values}
            onSet={onConfigure}
            busy={engineering.control.busy}
          />
        </details>
      )}
    </section>
  )
}

/**
 * The poles on the complex plane.
 *
 * Drawn with its own scale rather than through `Plot`, because this is a scatter on two axes that both go negative
 * and positive, and the vertical line at zero is the thing being looked at rather than a convenience.
 */
function PoleMap({ poles }: { poles: PoleZeroReport }): React.JSX.Element {
  const all = [...poles.poles.map((one) => one.value), ...poles.zeros]
  if (all.length === 0) return <p className="p2-faint">No poles to show.</p>
  const widest = Math.max(1e-6, ...all.map((one) => Math.max(Math.abs(one.re), Math.abs(one.im)))) * 1.25

  const at = (value: number): number => 50 + (value / widest) * 50

  return (
    <div className="p4-poles">
      <svg viewBox="0 0 100 100" role="img" aria-label="Poles and zeros on the complex plane">
        <line x1="50" y1="0" x2="50" y2="100" className="p4-plot-zero" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="50" x2="100" y2="50" className="p4-plot-zero" vectorEffect="non-scaling-stroke" />
        {/* The unstable half, shaded, so "right half plane" stops being a phrase and becomes a place. */}
        <rect x="50" y="0" width="50" height="100" className="p4-unstable" />
        {poles.poles.map((one, index) => (
          <g key={`p${index}`}>
            <line
              x1={at(one.value.re) - 2.5}
              y1={at(-one.value.im) - 2.5}
              x2={at(one.value.re) + 2.5}
              y2={at(-one.value.im) + 2.5}
              className="p4-pole"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={at(one.value.re) - 2.5}
              y1={at(-one.value.im) + 2.5}
              x2={at(one.value.re) + 2.5}
              y2={at(-one.value.im) - 2.5}
              className="p4-pole"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {poles.zeros.map((one, index) => (
          <circle key={`z${index}`} cx={at(one.re)} cy={at(-one.im)} r="2.5" className="p4-zero" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <ul className="p4-legend">
        <li>× a pole</li>
        <li>○ a zero</li>
        <li className="p4-legend-mark">the shaded half is where a pole makes the loop unstable</li>
      </ul>
      <dl className="p3-facts">
        <div className="p4-fact">
          <dt>Order</dt>
          <dd>{poles.order}</dd>
        </div>
        <div className="p4-fact">
          <dt>Stable</dt>
          <dd>{poles.stable ? 'yes' : poles.marginal ? 'on the boundary' : 'no'}</dd>
        </div>
        {poles.dominant !== null && (
          <div className="p4-fact">
            <dt>Slowest pole</dt>
            <dd>{poles.dominant.timeConstant === null ? '—' : `${tidy(poles.dominant.timeConstant)} s`}</dd>
          </div>
        )}
        {poles.nonMinimumPhase && (
          <div className="p4-fact">
            <dt>Note</dt>
            <dd>a zero on the unstable side, so the output moves the wrong way first</dd>
          </div>
        )}
      </dl>
    </div>
  )
}
