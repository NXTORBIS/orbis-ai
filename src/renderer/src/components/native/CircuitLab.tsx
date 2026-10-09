import { useEffect } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import Plot, { tidy } from './Plot'
import { useEngineering } from './useEngineering'
import './phase2.css'
import './phase3.css'
import './phase4.css'

/**
 * The Circuit Laboratory.
 *
 * ## The curves are solved, not drawn
 *
 * Every point on every chart here comes from `shared/compute/circuits.ts`, which solves the circuit rather than
 * plotting the textbook formula for what it ought to look like. So changing the resistance changes the time constant
 * because the solver worked it out, and an RLC circuit crosses from underdamped to overdamped at the damping ratio
 * the solver found rather than at a value this file decided.
 *
 * ## The milestones are the point of a transient
 *
 * "One time constant" is 63.2% of the way there, and the engine reports where that happened rather than this file
 * computing 0.632 of the final value. The same for the 95% and 99% marks. A learner needs to see that those land at
 * fixed multiples of RC whatever R and C are, and marks derived from the solved curve are what shows it.
 *
 * ## What it does not model is stated, from the engine
 *
 * Ideal components, no wire resistance, no parasitics. Those come out of the engine's own assumptions list, so the
 * laboratory cannot drift from what the solver actually assumed.
 */

interface TransientSample {
  time: number
  voltage: number
  current: number
  stored: number
  energy: number
}

interface TransientReport {
  kind: string
  timeConstant: number
  finalValue: number
  initialValue: number
  samples: readonly TransientSample[]
  milestones: readonly { fraction: number; time: number; label: string }[]
  notes: readonly string[]
}

interface RlcReport {
  arrangement: string
  resistance: number
  inductance: number
  capacitance: number
  naturalFrequency: number
  dampingRatio: number
  damping: 'underdamped' | 'critically-damped' | 'overdamped'
  dampedAngular: number | null
  qualityFactor: number
  bandwidth: number
  samples: readonly { time: number; value: number; envelope: number }[]
  notes: readonly string[]
}

interface ResonanceReport {
  arrangement: string
  resonantFrequency: number
  qualityFactor: number
  bandwidth: number
  lowerCutoff: number
  upperCutoff: number
  impedanceAtResonance: number
  points: readonly { frequency: number; impedanceMagnitude: number; impedancePhase: number; current: number; gainDb: number }[]
  notes: readonly string[]
}

interface NetworkReport {
  arrangement: string
  values: readonly number[]
  total: number
  shares: readonly number[]
  notes: readonly string[]
}

const DAMPING_MEANS: Readonly<Record<string, string>> = {
  underdamped: 'It overshoots and rings before settling. There is not enough resistance to stop it swinging past.',
  'critically-damped':
    'It reaches the final value as fast as it can without overshooting at all. This is the boundary between the other two.',
  overdamped: 'It creeps up to the final value without overshooting, and takes longer about it than it needs to.'
}

/** Reads the resistor list somebody typed. Kept here because it is this laboratory's input, not the engine's. */
function readValues(text: string): readonly number[] {
  return String(text)
    .split(/[\s,;]+/)
    .map((one) => Number(one))
    .filter((one) => Number.isFinite(one) && one > 0)
}

export default function CircuitLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engineering = useEngineering()
  const values = instance?.values ?? {}

  const what = String(values.circuit ?? 'rc-charge') as
    | 'rc-charge'
    | 'rc-discharge'
    | 'rl-energise'
    | 'rl-decay'
    | 'rlc-step'
    | 'rlc-resonance'
    | 'network'
  const resistance = Number(values.resistance ?? 1_000)
  const capacitance = Number(values.capacitance ?? 1e-6)
  const inductance = Number(values.inductance ?? 0.1)
  const supplyVoltage = Number(values.supplyVoltage ?? 5)
  const arrangement = String(values.arrangement ?? 'series') as 'series' | 'parallel'
  const resistors = String(values.resistors ?? '100, 220, 330')

  useEffect(() => {
    if (!engineering.ready) return
    engineering.ask({
      kind: 'circuit',
      what,
      resistance,
      capacitance,
      inductance,
      supplyVoltage,
      arrangement,
      /*
       * No duration at all, rather than a zero.
       *
       * The engine picks a span from the time constant when the duration is *absent*. Zero is not absent: it is a
       * duration of nothing, which it refuses -- so this laboratory opened on "The duration has to be a positive
       * time. Nothing solved yet." every single time, with every control working and no answer behind any of them.
       */
      samples: 600,
      ...(what === 'network' ? { values: readValues(resistors) } : {})
    })
  }, [engineering.ready, what, resistance, capacitance, inductance, supplyVoltage, arrangement, resistors])

  const held = engineering.circuit.value
  const assumptions = held?.assumptions ?? []

  return (
    <section className="p2 p4" aria-label="Circuit Laboratory">
      <header className="p2-bar">
        <strong>Circuit</strong>
        <span className="p2-faint">{describeWhat(what, arrangement)}</span>
      </header>

      {engineering.circuit.refused && (
        <p className="p2-refused" role="status">
          <strong>{engineering.circuit.refused.says}</strong> {engineering.circuit.refused.fix}
        </p>
      )}
      {engineering.circuit.broke && (
        <p className="p2-refused" role="status">
          {engineering.circuit.broke}
        </p>
      )}

      <div className="p3-split">
        <div>
          {held === null && <p className="p2-faint">{engineering.circuit.busy ? 'Solving it…' : 'Nothing solved yet.'}</p>}

          {held !== null && isTransient(what) && (
            <TransientView report={held.report as TransientReport} supply={supplyVoltage} />
          )}
          {held !== null && what === 'rlc-step' && <RlcView report={held.report as RlcReport} />}
          {held !== null && what === 'rlc-resonance' && <ResonanceView report={held.report as ResonanceReport} />}
          {held !== null && what === 'network' && <NetworkView report={held.report as NetworkReport} supply={supplyVoltage} />}
        </div>

        <div className="p3-side">
          {held !== null && (held.report as { notes?: readonly string[] }).notes !== undefined && (
            <div className="p3-panel">
              <h4>What the solver found</h4>
              <ul className="p4-notes">
                {((held.report as { notes: readonly string[] }).notes ?? []).map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="p3-panel">
            <h4>What this does not model</h4>
            <ul className="p3-assumptions">
              {assumptions.map((one, index) => (
                <li key={index}>{one}</li>
              ))}
              {assumptions.length === 0 && <li>Ideal components with no parasitic resistance, capacitance or inductance.</li>}
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
            busy={engineering.circuit.busy}
          />
        </details>
      )}
    </section>
  )
}

const isTransient = (what: string): boolean =>
  what === 'rc-charge' || what === 'rc-discharge' || what === 'rl-energise' || what === 'rl-decay'

function describeWhat(what: string, arrangement: string): string {
  switch (what) {
    case 'rc-charge':
      return 'A capacitor charging through a resistor'
    case 'rc-discharge':
      return 'A capacitor discharging through a resistor'
    case 'rl-energise':
      return 'Current building up in an inductor'
    case 'rl-decay':
      return 'Current dying away in an inductor'
    case 'rlc-step':
      return `A ${arrangement} RLC circuit given a step`
    case 'rlc-resonance':
      return `A ${arrangement} RLC circuit swept across frequency`
    default:
      return 'Resistors combined'
  }
}

function TransientView({ report, supply }: { report: TransientReport; supply: number }): React.JSX.Element {
  const voltage = report.samples.map((one) => ({ x: one.time, y: one.voltage }))
  const current = report.samples.map((one) => ({ x: one.time, y: one.current }))
  const inductor = report.kind.startsWith('rl')

  return (
    <>
      <Plot
        series={[
          { id: 'v', label: inductor ? 'Voltage across the inductor (V)' : 'Voltage across the capacitor (V)', points: voltage },
          { id: 'target', label: 'Where it ends up', points: [
            { x: report.samples[0]?.time ?? 0, y: report.finalValue },
            { x: report.samples[report.samples.length - 1]?.time ?? 1, y: report.finalValue }
          ], dashed: true, colour: '#f0a33a' }
        ]}
        xLabel="seconds"
        yLabel="volts"
        markers={report.milestones.map((one) => ({ x: one.time, label: one.label }))}
        zero={0}
        about={`The time constant is ${tidy(report.timeConstant)} seconds. Every one of those marks sits at a fixed multiple of it, whatever the resistance and capacitance are — which is what makes the time constant worth knowing.`}
      />
      <Plot
        series={[{ id: 'i', label: 'Current (A)', points: current, colour: '#37d67a' }]}
        xLabel="seconds"
        yLabel="amps"
        zero={0}
        height={160}
        about={
          inductor
            ? 'The current is what changes slowly in an inductor; the voltage across it is what jumps.'
            : 'The current is largest at the start, when the capacitor is empty and does not oppose the flow.'
        }
      />
      <dl className="p3-facts">
        <div className="p4-fact">
          <dt>Time constant</dt>
          <dd>{tidy(report.timeConstant)} s</dd>
        </div>
        <div className="p4-fact">
          <dt>Starts at</dt>
          <dd>{tidy(report.initialValue)} V</dd>
        </div>
        <div className="p4-fact">
          <dt>Ends at</dt>
          <dd>{tidy(report.finalValue)} V</dd>
        </div>
        <div className="p4-fact">
          <dt>Supply</dt>
          <dd>{tidy(supply)} V</dd>
        </div>
      </dl>
    </>
  )
}

function RlcView({ report }: { report: RlcReport }): React.JSX.Element {
  return (
    <>
      <Plot
        series={[
          { id: 'v', label: 'Response', points: report.samples.map((one) => ({ x: one.time, y: one.value })) },
          {
            id: 'env',
            label: 'How fast the ringing dies away',
            points: report.samples.map((one) => ({ x: one.time, y: one.envelope })),
            dashed: true,
            colour: '#f0a33a',
            // The envelope can be much larger than the response early on; letting it set the range would flatten the curve.
            ignoreForRange: true
          }
        ]}
        xLabel="seconds"
        yLabel="volts"
        zero={0}
        about={DAMPING_MEANS[report.damping] ?? ''}
      />
      <dl className="p3-facts">
        <div className="p4-fact">
          <dt>Damping</dt>
          <dd>{report.damping.replace('-', ' ')}</dd>
        </div>
        <div className="p4-fact">
          <dt>Damping ratio</dt>
          <dd>{tidy(report.dampingRatio)}</dd>
        </div>
        <div className="p4-fact">
          <dt>Natural frequency</dt>
          <dd>{tidy(report.naturalFrequency)} Hz</dd>
        </div>
        <div className="p4-fact">
          <dt>Rings at</dt>
          <dd>{report.dampedAngular === null ? 'it does not ring' : `${tidy(report.dampedAngular / (2 * Math.PI))} Hz`}</dd>
        </div>
        <div className="p4-fact">
          <dt>Q</dt>
          <dd>{tidy(report.qualityFactor)}</dd>
        </div>
      </dl>
      <p className="p2-faint">
        The damping ratio is what decides the shape: below 1 it rings, at exactly 1 it is as fast as it can be without
        overshooting, above 1 it is slower than it needs to be. Change the resistance and watch it cross over.
      </p>
    </>
  )
}

function ResonanceView({ report }: { report: ResonanceReport }): React.JSX.Element {
  return (
    <>
      <Plot
        series={[{ id: 'gain', label: 'Gain (dB)', points: report.points.map((one) => ({ x: one.frequency, y: one.gainDb })) }]}
        xLabel="hertz"
        yLabel="decibels"
        markers={[
          { x: report.resonantFrequency, label: 'resonance' },
          { x: report.lowerCutoff, label: 'lower −3dB' },
          { x: report.upperCutoff, label: 'upper −3dB' }
        ]}
        about={`The two −3dB marks are ${tidy(report.bandwidth)} Hz apart. That width divided into the resonant frequency is Q, which is ${tidy(report.qualityFactor)} here — a higher Q means a narrower, sharper peak.`}
      />
      <Plot
        series={[
          {
            id: 'phase',
            label: 'Phase (degrees)',
            points: report.points.map((one) => ({ x: one.frequency, y: one.impedancePhase })),
            colour: '#c08bf0'
          }
        ]}
        xLabel="hertz"
        yLabel="degrees"
        zero={0}
        height={150}
        about="At resonance the phase passes through zero: the circuit behaves as pure resistance, with the inductor and capacitor cancelling each other."
      />
      <dl className="p3-facts">
        <div className="p4-fact">
          <dt>Resonates at</dt>
          <dd>{tidy(report.resonantFrequency)} Hz</dd>
        </div>
        <div className="p4-fact">
          <dt>Q</dt>
          <dd>{tidy(report.qualityFactor)}</dd>
        </div>
        <div className="p4-fact">
          <dt>Bandwidth</dt>
          <dd>{tidy(report.bandwidth)} Hz</dd>
        </div>
        <div className="p4-fact">
          <dt>Impedance there</dt>
          <dd>{tidy(report.impedanceAtResonance)} Ω</dd>
        </div>
      </dl>
    </>
  )
}

function NetworkView({ report, supply }: { report: NetworkReport; supply: number }): React.JSX.Element {
  return (
    <>
      <div className="p4-row">
        {report.values.map((one, index) => (
          <div key={index} className="p4-box">
            <span className="p4-box-value">{tidy(one)} Ω</span>
            <small>
              {report.arrangement === 'series' ? 'drops' : 'carries'} {tidy(report.shares[index] ?? 0)}
              {report.arrangement === 'series' ? ' V' : ' A'}
            </small>
          </div>
        ))}
      </div>
      <dl className="p3-facts">
        <div className="p4-fact">
          <dt>Arrangement</dt>
          <dd>{report.arrangement}</dd>
        </div>
        <div className="p4-fact">
          <dt>Together they are</dt>
          <dd>{tidy(report.total)} Ω</dd>
        </div>
        {supply > 0 && (
          <div className="p4-fact">
            <dt>Total current</dt>
            <dd>{tidy(supply / report.total)} A</dd>
          </div>
        )}
      </dl>
      <p className="p2-faint">
        {report.arrangement === 'series'
          ? 'In series the same current goes through every resistor, so the biggest one drops the most voltage. The total is just the sum.'
          : 'In parallel every resistor sees the same voltage, so the smallest one carries the most current. The total is always less than the smallest of them.'}
      </p>
    </>
  )
}
