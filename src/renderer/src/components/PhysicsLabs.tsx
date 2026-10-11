import { useMemo, useState } from 'react'
import { Activity, Clock, GitCompare, Move, Orbit, RotateCw, Target, Waves, Zap } from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import { Choice, Field, Notes, Problem, Stats, readNumbers, useEngine } from './PageTools'

/**
 * The nine Physics Pages.
 *
 * Fifth file of this kind, and the rule is the same as the four before it: **nothing on this screen computes
 * anything**. Every trajectory, every period, every orbital element and every energy figure came back from the main
 * process through `pagesCompute`. A screen that worked out an orbit locally would be a second implementation
 * nobody tests, and it would disagree with the first one eventually.
 *
 * ## What these screens spend their space on
 *
 * The thing each model is not. That a projectile formula stops being true when the air is switched on; that
 * resonance is not at the natural frequency; that a pendulum's period depends on amplitude and the familiar formula
 * threw that away; that a double pendulum is deterministic rather than random; that a hoop loses a rolling race
 * whatever it weighs. In every case that sentence is the difference between a number and an understanding, so it is
 * rendered beside the number rather than behind a disclosure.
 */

/*
 * `initial` is how a laboratory opened from a sentence starts with the values that sentence gave.
 *
 * Text, because every field here is text somebody types, so wiring one costs a default rather than a rewrite. A lab
 * that ignores it is simply not configurable from a sentence, which its manifest says plainly.
 */
type Props = { pageId: string; onNotify(m: string, k?: NoticeKind): void; initial?: Readonly<Record<string, string>> }

/** A starting value from the runtime, or the lab's own default. */
const start = (initial: Props['initial'], id: string, fallback: string): string => initial?.[id] ?? fallback

const round = (value: number, digits = 5): string =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '—'

/** A small line chart. Plain SVG, because a chart of a few hundred points needs nothing more. */
function Plot({
  series,
  label,
  height = 150
}: {
  series: readonly { name: string; points: readonly { x: number; y: number }[]; dashed?: boolean }[]
  label: string
  height?: number
}): React.JSX.Element | null {
  const geometry = useMemo(() => {
    const all = series.flatMap((one) => one.points)
    if (all.length < 2) return null
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const one of all) {
      if (!Number.isFinite(one.x) || !Number.isFinite(one.y)) continue
      if (one.x < minX) minX = one.x
      if (one.x > maxX) maxX = one.x
      if (one.y < minY) minY = one.y
      if (one.y > maxY) maxY = one.y
    }
    if (!Number.isFinite(minX) || maxX === minX) return null
    // A flat series would otherwise divide by zero and vanish; give it a band to sit in.
    if (maxY === minY) {
      maxY += 1
      minY -= 1
    }
    const width = 600
    const pad = 8
    const toX = (x: number): number => pad + ((x - minX) / (maxX - minX)) * (width - 2 * pad)
    const toY = (y: number): number => height - pad - ((y - minY) / (maxY - minY)) * (height - 2 * pad)
    return {
      width,
      minX,
      maxX,
      minY,
      maxY,
      zeroY: minY <= 0 && maxY >= 0 ? toY(0) : null,
      paths: series.map((one) => ({
        name: one.name,
        dashed: one.dashed === true,
        d: one.points
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          .map((point, i) => `${i === 0 ? 'M' : 'L'}${toX(point.x).toFixed(2)},${toY(point.y).toFixed(2)}`)
          .join(' ')
      }))
    }
  }, [series, height])

  if (geometry === null) return null
  const colours = ['var(--cyan)', 'var(--amber)', 'var(--green)', 'var(--red)']

  return (
    <div className="page-result">
      <h4>{label}</h4>
      <svg className="page-plot" viewBox={`0 0 ${geometry.width} ${height}`} role="img" aria-label={label}>
        {geometry.zeroY !== null && (
          <line className="page-plot-axis" x1={0} y1={geometry.zeroY} x2={geometry.width} y2={geometry.zeroY} />
        )}
        {geometry.paths.map((one, i) => (
          <path
            key={one.name}
            d={one.d}
            fill="none"
            stroke={colours[i % colours.length]}
            strokeWidth={1.6}
            strokeDasharray={one.dashed ? '4 3' : undefined}
          />
        ))}
        <text className="page-plot-label" x={4} y={12}>
          {round(geometry.maxY, 4)}
        </text>
        <text className="page-plot-label" x={4} y={height - 4}>
          {round(geometry.minY, 4)}
        </text>
        <text className="page-plot-label" x={geometry.width - 60} y={height - 4}>
          {round(geometry.maxX, 4)}
        </text>
      </svg>
      {series.length > 1 && (
        <p className="page-note">
          {series.map((one, i) => (
            <span key={one.name} className="page-legend" style={{ color: colours[i % colours.length] }}>
              {one.name}
              {i < series.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

const number = (text: string, fallback: number): number => {
  const value = Number(text)
  return Number.isFinite(value) ? value : fallback
}

// ---------------------------------------------------------------- Motion Lab

export function MotionLabPage({ pageId, initial }: Props): React.JSX.Element {
  const [durations, setDurations] = useState(() => start(initial, 'durations', '5, 5, 10'))
  const [accelerations, setAccelerations] = useState(() => start(initial, 'accelerations', '2, 0, -1'))
  const [velocity, setVelocity] = useState(() => start(initial, 'velocity', '0'))
  const [position, setPosition] = useState(() => start(initial, 'position', '0'))

  const phases = useMemo(() => {
    const d = readNumbers(durations)
    const a = readNumbers(accelerations)
    return d.slice(0, Math.min(d.length, a.length)).map((duration, i) => ({
      duration,
      acceleration: a[i] ?? 0,
      label: `Phase ${i + 1}`
    }))
  }, [durations, accelerations])

  const motion = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      phases.length === 0
        ? null
        : call('motion.phases', { phases, velocity: number(velocity, 0), position: number(position, 0) }),
    [durations, accelerations, velocity, position]
  )

  const samples = (motion.result?.samples ?? []) as { time: number; position: number; velocity: number; acceleration: number }[]
  const rows = (motion.result?.phases ?? []) as {
    label: string
    acceleration: number
    endTime: number
    endPosition: number
    endVelocity: number
    displacement: number
    distance: number
    turnedAt: number | null
  }[]

  return (
    <section className="page-pane" aria-label="Motion Lab">
      <div className="page-row">
        <Move size={16} className="page-arrow" aria-hidden />
        <Field label="Phase durations (s)" value={durations} onChange={setDurations} placeholder="5, 5, 10" />
        <Field label="Acceleration in each (m/s²)" value={accelerations} onChange={setAccelerations} placeholder="2, 0, -1" />
      </div>
      <div className="page-row">
        <Field label="Starting position (m)" value={position} onChange={setPosition} />
        <Field label="Starting velocity (m/s)" value={velocity} onChange={setVelocity} />
      </div>
      {readNumbers(durations).length !== readNumbers(accelerations).length && (
        <p className="page-note">
          There are {readNumbers(durations).length} durations and {readNumbers(accelerations).length} accelerations. Only
          the pairs that match are used.
        </p>
      )}
      <Problem text={motion.problem} />

      {motion.result !== null && (
        <>
          <Stats
            items={[
              ['Total time', `${round(motion.result.totalTime as number)} s`],
              ['Ends at', `${round(motion.result.finalPosition as number)} m`],
              ['Displacement', `${round(motion.result.displacement as number)} m`],
              ['Distance travelled', `${round(motion.result.distance as number)} m`]
            ]}
          />
          <Plot
            label="Position against time"
            series={[{ name: 'x (m)', points: samples.map((one) => ({ x: one.time, y: one.position })) }]}
          />
          <Plot
            label="Velocity and acceleration against time"
            series={[
              { name: 'v (m/s)', points: samples.map((one) => ({ x: one.time, y: one.velocity })) },
              { name: 'a (m/s²)', points: samples.map((one) => ({ x: one.time, y: one.acceleration })), dashed: true }
            ]}
          />
          <div className="page-result">
            <h4>Phase by phase</h4>
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th scope="col">Phase</th>
                    <th scope="col">a</th>
                    <th scope="col">Ends at</th>
                    <th scope="col">v then</th>
                    <th scope="col">Moved</th>
                    <th scope="col">Travelled</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((one) => (
                    <tr key={one.label}>
                      <td>
                        {one.label}
                        {one.turnedAt !== null && <em> turned at {round(one.turnedAt, 4)} s</em>}
                      </td>
                      <td>{round(one.acceleration, 4)}</td>
                      <td>{round(one.endPosition, 4)}</td>
                      <td>{round(one.endVelocity, 4)}</td>
                      <td>{round(one.displacement, 4)}</td>
                      <td>{round(one.distance, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Notes notes={(motion.result.notes ?? []) as string[]} label="What this says" />
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Projectile Lab

export function ProjectileLabPage({ pageId, initial }: Props): React.JSX.Element {
  const [speed, setSpeed] = useState(() => start(initial, 'speed', '40'))
  const [angle, setAngle] = useState(() => start(initial, 'angle', '45'))
  const [height, setHeight] = useState(() => start(initial, 'height', '0'))
  const [gravity, setGravity] = useState(() => start(initial, 'gravity', '9.81'))
  const [drag, setDrag] = useState(() => start(initial, 'drag', 'quadratic'))
  const [coefficient, setCoefficient] = useState(() => start(initial, 'coefficient', '0.01'))
  const [mass, setMass] = useState(() => start(initial, 'mass', '1'))

  const setup = {
    speed: number(speed, 0),
    angle: number(angle, 0),
    height: number(height, 0),
    gravity: number(gravity, 9.81)
  }

  const compared = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      setup.speed <= 0
        ? null
        : call('motion.compare-projectile', {
            ...setup,
            drag,
            coefficient: number(coefficient, 0),
            mass: number(mass, 1)
          }),
    [speed, angle, height, gravity, drag, coefficient, mass]
  )

  const exact = compared.result?.analytical as
    | { range: number; maximumHeight: number; timeOfFlight: number; impactSpeed: number; bestAngle: number; assumptions: string[] }
    | undefined
  const numerical = compared.result?.numerical as
    | { range: number; maximumHeight: number; timeOfFlight: number; impactSpeed: number; impactAngle: number; path: { position: { x: number; y: number } }[]; notes: string[] }
    | undefined

  return (
    <section className="page-pane" aria-label="Projectile Lab">
      <div className="page-row">
        <Target size={16} className="page-arrow" aria-hidden />
        <Field label="Launch speed (m/s)" value={speed} onChange={setSpeed} />
        <Field label="Angle above horizontal (°)" value={angle} onChange={setAngle} />
        <Field label="Launch height (m)" value={height} onChange={setHeight} />
      </div>
      <div className="page-row">
        <Field label="Gravity (m/s²)" value={gravity} onChange={setGravity} />
        <Choice
          label="Air resistance"
          value={drag}
          options={[
            { value: 'none', label: 'none — the ideal case' },
            { value: 'quadratic', label: 'quadratic — the usual regime for air' },
            { value: 'linear', label: 'linear — slow, viscous' }
          ]}
          onChange={setDrag}
        />
        {drag !== 'none' && (
          <>
            <Field label="Drag coefficient" value={coefficient} onChange={setCoefficient} />
            <Field label="Mass (kg)" value={mass} onChange={setMass} />
          </>
        )}
      </div>
      <Problem text={compared.problem} />

      {exact !== undefined && numerical !== undefined && (
        <>
          <div className="page-result">
            <h4>Side by side</h4>
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">No air resistance</th>
                    <th scope="col">{drag === 'none' ? 'Integrated' : `With ${drag} drag`}</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Range (m)', exact.range, numerical.range],
                    ['Maximum height (m)', exact.maximumHeight, numerical.maximumHeight],
                    ['Time of flight (s)', exact.timeOfFlight, numerical.timeOfFlight],
                    ['Impact speed (m/s)', exact.impactSpeed, numerical.impactSpeed]
                  ].map(([label, a, b]) => (
                    <tr key={String(label)}>
                      <td>{String(label)}</td>
                      <td>{round(a as number)}</td>
                      <td>{round(b as number)}</td>
                      <td>{round((b as number) - (a as number))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={compared.result?.because === 'drag' ? undefined : 'page-note'}>{String(compared.result?.why)}</p>
          </div>

          <Plot
            label="Trajectory"
            series={[{ name: 'path', points: numerical.path.map((one) => ({ x: one.position.x, y: one.position.y })) }]}
            height={200}
          />

          <div className="page-result">
            <h4>The best angle from this height is {round(exact.bestAngle, 4)}°</h4>
            <p className="page-note">
              45° is the best angle only from level ground. Launched from a height, a flatter shot spends its extra
              fall time moving forward, and the page computes where that balance sits rather than assuming.
            </p>
            <Notes notes={exact.assumptions} label="What the exact solution assumes" />
            <Notes notes={numerical.notes} label="What the integrated one did" />
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Oscillator Lab

export function OscillatorLabPage({ pageId }: Props): React.JSX.Element {
  const [mass, setMass] = useState('1')
  const [stiffness, setStiffness] = useState('100')
  const [damping, setDamping] = useState('1')
  const [force, setForce] = useState('10')

  const values = { mass: number(mass, 1), stiffness: number(stiffness, 1), damping: number(damping, 0) }

  const damped = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (values.mass <= 0 || values.stiffness <= 0 ? null : call('oscillator.damped-trace', { ...values, duration: 10, samples: 400 })),
    [mass, stiffness, damping]
  )
  const curve = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      values.mass <= 0 || values.stiffness <= 0
        ? null
        : call('oscillator.resonance', { ...values, forceAmplitude: number(force, 1), from: 0.1, to: Math.sqrt(values.stiffness / values.mass) * 3, samples: 400 }),
    [mass, stiffness, damping, force]
  )

  const trace = (damped.result?.trace ?? []) as { time: number; position: number }[]
  const points = (curve.result?.points ?? []) as { frequency: number; amplitude: number }[]

  return (
    <section className="page-pane" aria-label="Oscillator Lab">
      <div className="page-row">
        <Activity size={16} className="page-arrow" aria-hidden />
        <Field label="Mass (kg)" value={mass} onChange={setMass} />
        <Field label="Stiffness (N/m)" value={stiffness} onChange={setStiffness} />
        <Field label="Damping (N·s/m)" value={damping} onChange={setDamping} />
        <Field label="Driving force (N)" value={force} onChange={setForce} />
      </div>
      <Problem text={damped.problem} />

      {damped.result !== null && (
        <>
          <Stats
            items={[
              ['Regime', String(damped.result.regime)],
              ['Natural frequency', `${round(damped.result.naturalFrequency as number)} rad/s`],
              [
                'Oscillates at',
                damped.result.dampedFrequency === null ? 'it does not' : `${round(damped.result.dampedFrequency as number)} rad/s`
              ],
              ['Damping ratio', round(damped.result.dampingRatio as number, 4)]
            ]}
          />
          <Plot label="Displacement against time" series={[{ name: 'x (m)', points: trace.map((one) => ({ x: one.time, y: one.position })) }]} />
          <div className="page-result">
            <h4>{String(damped.result.describe)}</h4>
            <Notes notes={(damped.result.notes ?? []) as string[]} label="What that means" />
          </div>
        </>
      )}

      <Problem text={curve.problem} />
      {curve.result !== null && (
        <>
          <Plot label="Response against driving frequency" series={[{ name: 'amplitude (m)', points: points.map((one) => ({ x: one.frequency, y: one.amplitude })) }]} />
          <div className="page-result">
            <h4>Resonance</h4>
            <Stats
              items={[
                [
                  'Peak at',
                  curve.result.resonantFrequency === null ? 'there is no peak' : `${round(curve.result.resonantFrequency as number)} rad/s`
                ],
                ['Natural frequency', `${round(curve.result.naturalFrequency as number)} rad/s`],
                ['Quality factor', round(curve.result.qualityFactor as number, 4)],
                ['Bandwidth', curve.result.bandwidth === null ? '—' : round(curve.result.bandwidth as number, 4)]
              ]}
            />
            <Notes notes={(curve.result.notes ?? []) as string[]} label="Where resonance actually is" />
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Pendulum Lab

export function PendulumLabPage({ pageId }: Props): React.JSX.Element {
  const [length, setLength] = useState('1')
  const [gravity, setGravity] = useState('9.81')
  const [amplitude, setAmplitude] = useState('60')
  const [perturbation, setPerturbation] = useState('0.001')

  const period = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      number(length, 0) <= 0
        ? null
        : call('oscillator.pendulum-period', { length: number(length, 1), gravity: number(gravity, 9.81), amplitudeDegrees: number(amplitude, 0) }),
    [length, gravity, amplitude]
  )
  const swing = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      number(length, 0) <= 0
        ? null
        : call('oscillator.pendulum-swing', {
            length: number(length, 1),
            gravity: number(gravity, 9.81),
            initialAngleDegrees: number(amplitude, 0),
            duration: 10,
            samples: 600
          }),
    [length, gravity, amplitude]
  )
  const divergence = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      call('oscillator.double-compare', {
        angle1Degrees: 120,
        angle2Degrees: 60,
        gravity: number(gravity, 9.81),
        perturbation: number(perturbation, 0.001),
        duration: 40,
        step: 0.001,
        samples: 600
      }),
    [gravity, perturbation]
  )

  const trace = (swing.result?.trace ?? []) as { time: number; angle: number }[]
  const separation = (divergence.result?.separation ?? []) as { time: number; distance: number }[]

  return (
    <section className="page-pane" aria-label="Pendulum Lab">
      <div className="page-row">
        <Clock size={16} className="page-arrow" aria-hidden />
        <Field label="Length (m)" value={length} onChange={setLength} />
        <Field label="Gravity (m/s²)" value={gravity} onChange={setGravity} />
        <Field label="Released from (°)" value={amplitude} onChange={setAmplitude} />
      </div>
      <Problem text={period.problem} />

      {period.result !== null && (
        <div className="page-result">
          <h4>How long it really takes</h4>
          <Stats
            items={[
              ['Exact period', `${round(period.result.exact as number)} s`],
              ['2π√(L/g)', `${round(period.result.smallAngle as number)} s`],
              ['The approximation is out by', `${round((period.result.relativeDifference as number) * 100, 4)}%`],
              ['At an amplitude of', `${round(period.result.amplitudeDegrees as number, 4)}°`]
            ]}
          />
          <Notes notes={(period.result.notes ?? []) as string[]} label="Why they differ" />
        </div>
      )}

      <Problem text={swing.problem} />
      {swing.result !== null && (
        <Plot label="Angle against time, from the nonlinear equation" series={[{ name: 'θ (rad)', points: trace.map((one) => ({ x: one.time, y: one.angle })) }]} />
      )}

      <div className="page-row">
        <Field label="Start two double pendulums this far apart (°)" value={perturbation} onChange={setPerturbation} wide />
      </div>
      <Problem text={divergence.problem} />
      {divergence.result !== null && (
        <>
          <Plot
            label="How far apart the two get"
            series={[{ name: 'separation (rad)', points: separation.map((one) => ({ x: one.time, y: one.distance })) }]}
          />
          <div className="page-result">
            <h4>
              {divergence.result.separatedAt === null
                ? 'They stayed close for this run'
                : `A radian apart by ${round(divergence.result.separatedAt as number, 4)} s`}
            </h4>
            <Notes notes={(divergence.result.notes ?? []) as string[]} label="Deterministic, and sensitive" />
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Collision Lab

export function CollisionLabPage({ pageId }: Props): React.JSX.Element {
  const [mass1, setMass1] = useState('2')
  const [velocity1, setVelocity1] = useState('6')
  const [mass2, setMass2] = useState('5')
  const [velocity2, setVelocity2] = useState('-2')
  const [restitution, setRestitution] = useState('1')

  const collision = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      call('collision.head-on', {
        mass1: number(mass1, 1),
        velocity1: number(velocity1, 0),
        mass2: number(mass2, 1),
        velocity2: number(velocity2, 0),
        restitution: number(restitution, 1)
      }),
    [mass1, velocity1, mass2, velocity2, restitution]
  )

  const after = collision.result?.after as { velocity1: number; velocity2: number } | undefined
  const audit = collision.result?.audit as
    | { momentumBefore: { x: number }; momentumAfter: { x: number }; momentumChange: number; kineticEnergyBefore: number; kineticEnergyAfter: number; kineticEnergyLost: number; fractionLost: number; elastic: boolean; why: string }
    | undefined

  return (
    <section className="page-pane" aria-label="Collision Lab">
      <div className="page-row">
        <Zap size={16} className="page-arrow" aria-hidden />
        <Field label="Mass 1 (kg)" value={mass1} onChange={setMass1} />
        <Field label="Velocity 1 (m/s)" value={velocity1} onChange={setVelocity1} />
        <Field label="Mass 2 (kg)" value={mass2} onChange={setMass2} />
        <Field label="Velocity 2 (m/s)" value={velocity2} onChange={setVelocity2} />
      </div>
      <div className="page-row">
        <Choice
          label="How bouncy"
          value={restitution}
          options={[
            { value: '1', label: '1 — perfectly elastic' },
            { value: '0.8', label: '0.8 — a good ball' },
            { value: '0.5', label: '0.5 — half the speed back' },
            { value: '0', label: '0 — they stick together' }
          ]}
          onChange={setRestitution}
        />
      </div>
      <Problem text={collision.problem} />

      {after !== undefined && audit !== undefined && (
        <>
          <Stats
            items={[
              ['Velocity 1 after', `${round(after.velocity1)} m/s`],
              ['Velocity 2 after', `${round(after.velocity2)} m/s`],
              ['They approached at', `${round(collision.result?.approachSpeed as number)} m/s`],
              ['They separated at', `${round(collision.result?.separationSpeed as number)} m/s`]
            ]}
          />
          <div className="page-result">
            <h4>What survived</h4>
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Momentum (kg·m/s)</td>
                    <td>{round(audit.momentumBefore.x)}</td>
                    <td>{round(audit.momentumAfter.x)}</td>
                    <td>{round(audit.momentumChange, 3)}</td>
                  </tr>
                  <tr>
                    <td>Kinetic energy (J)</td>
                    <td>{round(audit.kineticEnergyBefore)}</td>
                    <td>{round(audit.kineticEnergyAfter)}</td>
                    <td>
                      −{round(audit.kineticEnergyLost)} ({round(audit.fractionLost * 100, 3)}%)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={audit.elastic ? undefined : 'page-note'}>{audit.why}</p>
            <Notes notes={(collision.result?.notes ?? []) as string[]} label="Worth knowing" />
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Orbit Lab

export function OrbitLabPage({ pageId }: Props): React.JSX.Element {
  const [centralMass, setCentralMass] = useState('1')
  const [constant, setConstant] = useState('1')
  const [x, setX] = useState('1')
  const [speed, setSpeed] = useState('0.9')

  const orbit = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      call('gravity.orbit', {
        centralMass: number(centralMass, 1),
        constant: number(constant, 1),
        position: { x: number(x, 1), y: 0 },
        velocity: { x: 0, y: number(speed, 1) }
      }),
    [centralMass, constant, x, speed]
  )
  const path = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      call('gravity.orbit-path', {
        centralMass: number(centralMass, 1),
        constant: number(constant, 1),
        position: { x: number(x, 1), y: 0 },
        velocity: { x: 0, y: number(speed, 1) },
        points: 360
      }),
    [centralMass, constant, x, speed]
  )

  const points = (path.result?.points ?? []) as { position: { x: number; y: number } }[]

  return (
    <section className="page-pane" aria-label="Orbit Lab">
      <div className="page-row">
        <Orbit size={16} className="page-arrow" aria-hidden />
        <Field label="Central mass" value={centralMass} onChange={setCentralMass} />
        <Field label="Gravitational constant" value={constant} onChange={setConstant} />
        <Field label="Starting distance" value={x} onChange={setX} />
        <Field label="Sideways speed" value={speed} onChange={setSpeed} />
      </div>
      <Problem text={orbit.problem} />

      {orbit.result !== null && (
        <>
          <Stats
            items={[
              ['Shape', String(orbit.result.shape)],
              ['Eccentricity', round(orbit.result.eccentricity as number, 5)],
              ['Specific energy', round(orbit.result.specificEnergy as number, 5)],
              ['Period', orbit.result.period === null ? 'it never returns' : round(orbit.result.period as number)]
            ]}
          />
          <Stats
            items={[
              ['Closest approach', round(orbit.result.periapsis as number)],
              ['Furthest', orbit.result.apoapsis === null ? '—' : round(orbit.result.apoapsis as number)],
              ['Circular speed here', round(orbit.result.circularSpeedHere as number)],
              ['Escape speed here', round(orbit.result.escapeSpeedHere as number)]
            ]}
          />
          {points.length > 2 && (
            <Plot label="The orbit" series={[{ name: 'path', points: points.map((one) => ({ x: one.position.x, y: one.position.y })) }]} height={240} />
          )}
          <div className="page-result">
            <h4>Classified from the numbers</h4>
            <Notes notes={(orbit.result.notes ?? []) as string[]} label="What decided it" />
          </div>
        </>
      )}
      <Problem text={path.problem} />
    </section>
  )
}

// ---------------------------------------------------------------- Rotation Lab

const ROLLING_SHAPES = ['solid-sphere', 'solid-disc', 'hollow-sphere', 'ring']

export function RotationLabPage({ pageId }: Props): React.JSX.Element {
  const [shape, setShape] = useState('solid-disc')
  const [mass, setMass] = useState('2')
  const [size, setSize] = useState('0.5')
  const [slope, setSlope] = useState('25')
  const [friction, setFriction] = useState('0.3')

  const inertia = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('rotation.inertia', { shape, mass: number(mass, 1), size: number(size, 1), secondSize: number(size, 1) }),
    [shape, mass, size]
  )
  const race = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      call('rotation.race', { shapes: ROLLING_SHAPES, slopeDegrees: number(slope, 25), gravity: 9.81, distance: 5 }),
    [slope]
  )
  const rolling = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      !ROLLING_SHAPES.includes(shape)
        ? null
        : call('rotation.rolling', {
            shape,
            slopeDegrees: number(slope, 25),
            gravity: 9.81,
            frictionCoefficient: number(friction, 0)
          }),
    [shape, slope, friction]
  )

  const order = (race.result?.order ?? []) as { shape: string; label: string; inertiaFactor: number; timeToBottom: number }[]

  return (
    <section className="page-pane" aria-label="Rotation Lab">
      <div className="page-row">
        <RotateCw size={16} className="page-arrow" aria-hidden />
        <Choice
          label="Shape"
          value={shape}
          options={[
            { value: 'solid-disc', label: 'Solid disc' },
            { value: 'ring', label: 'Ring or hoop' },
            { value: 'solid-sphere', label: 'Solid sphere' },
            { value: 'hollow-sphere', label: 'Hollow sphere' },
            { value: 'rod-centre', label: 'Rod, about its centre' },
            { value: 'rod-end', label: 'Rod, about its end' }
          ]}
          onChange={setShape}
        />
        <Field label="Mass (kg)" value={mass} onChange={setMass} />
        <Field label="Radius or length (m)" value={size} onChange={setSize} />
      </div>
      <Problem text={inertia.problem} />

      {inertia.result !== null && (
        <div className="page-result">
          <h4>Moment of inertia</h4>
          <p className="page-answer">
            {round(inertia.result.value as number)} kg·m² — {String(inertia.result.formula)}
          </p>
          <p>
            About {String(inertia.result.axis)}. Radius of gyration {round(inertia.result.radiusOfGyration as number)} m.
          </p>
          <Notes notes={(inertia.result.notes ?? []) as string[]} label="Why the axis matters" />
        </div>
      )}

      <div className="page-row">
        <Field label="Slope (°)" value={slope} onChange={setSlope} />
        <Field label="Friction coefficient" value={friction} onChange={setFriction} />
      </div>
      <Problem text={rolling.problem} />
      {rolling.result !== null && (
        <div className="page-result">
          <h4>Rolling down it</h4>
          <Stats
            items={[
              ['Acceleration', `${round(rolling.result.acceleration as number)} m/s²`],
              ['Energy going down', `${round(((rolling.result.energySplit as { translational: number }).translational) * 100, 3)}%`],
              ['Energy spinning', `${round(((rolling.result.energySplit as { rotational: number }).rotational) * 100, 3)}%`],
              ['Friction needed', round(rolling.result.frictionNeeded as number, 4)]
            ]}
          />
          <Notes notes={(rolling.result.notes ?? []) as string[]} label="What decides this" />
        </div>
      )}

      <Problem text={race.problem} />
      {race.result !== null && (
        <div className="page-result">
          <h4>The race down a {round(number(slope, 25), 4)}° slope</h4>
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th scope="col">Shape</th>
                  <th scope="col">I / mR²</th>
                  <th scope="col">Time over 5 m</th>
                </tr>
              </thead>
              <tbody>
                {order.map((one) => (
                  <tr key={one.shape}>
                    <td>{one.label}</td>
                    <td>{round(one.inertiaFactor, 4)}</td>
                    <td>{round(one.timeToBottom, 5)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notes notes={(race.result.notes ?? []) as string[]} label="Why the order never changes" />
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Wave Lab

export function WaveLabPage({ pageId }: Props): React.JSX.Element {
  const [speed, setSpeed] = useState('340')
  const [frequency, setFrequency] = useState('170')
  const [length, setLength] = useState('2')
  const [harmonic, setHarmonic] = useState('3')
  const [boundary, setBoundary] = useState('both-fixed')
  const [f1, setF1] = useState('440')
  const [f2, setF2] = useState('444')

  const wave = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      number(speed, 0) <= 0 || number(frequency, 0) <= 0
        ? null
        : call('wave.sample', {
            amplitude: 1,
            speed: number(speed, 340),
            frequency: number(frequency, 170),
            span: { from: 0, to: 8, points: 500 }
          }),
    [speed, frequency]
  )
  const standing = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      call('wave.standing-sample', {
        length: number(length, 2),
        speed: number(speed, 340),
        harmonic: Math.max(1, Math.round(number(harmonic, 1))),
        boundary,
        amplitude: 1,
        time: 0,
        samples: 400
      }),
    [length, speed, harmonic, boundary]
  )
  const beating = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      number(f1, 0) === number(f2, 0)
        ? null
        : call('wave.beats', { frequency1: number(f1, 440), frequency2: number(f2, 444), duration: 1, samples: 3000 }),
    [f1, f2]
  )

  const shape = (wave.result?.points ?? []) as { x: number; y: number }[]
  const standingPoints = (standing.result?.points ?? []) as { x: number; y: number; envelope: number }[]
  const beatPoints = (beating.result?.points ?? []) as { time: number; total: number; envelope: number }[]

  return (
    <section className="page-pane" aria-label="Wave Lab">
      <div className="page-row">
        <Waves size={16} className="page-arrow" aria-hidden />
        <Field label="Wave speed (m/s)" value={speed} onChange={setSpeed} />
        <Field label="Frequency (Hz)" value={frequency} onChange={setFrequency} />
      </div>
      <Problem text={wave.problem} />
      {wave.result !== null && (
        <>
          <Plot label="A snapshot of the wave" series={[{ name: 'y', points: shape }]} />
          <Notes notes={(wave.result.notes ?? []) as string[]} label="About this snapshot" />
        </>
      )}

      <div className="page-row">
        <Field label="String or pipe length (m)" value={length} onChange={setLength} />
        <Field label="Harmonic" value={harmonic} onChange={setHarmonic} />
        <Choice
          label="Ends"
          value={boundary}
          options={[
            { value: 'both-fixed', label: 'Fixed at both — a guitar string' },
            { value: 'both-free', label: 'Open at both — an open pipe' },
            { value: 'one-fixed-one-free', label: 'One closed — odd harmonics only' }
          ]}
          onChange={setBoundary}
        />
      </div>
      <Problem text={standing.problem} />
      {standing.result !== null && standing.result.ok !== false && (
        <>
          <Plot
            label="The standing wave and the envelope it never leaves"
            series={[
              { name: 'displacement', points: standingPoints.map((one) => ({ x: one.x, y: one.y })) },
              { name: 'envelope', points: standingPoints.map((one) => ({ x: one.x, y: one.envelope })), dashed: true }
            ]}
          />
          <div className="page-result">
            <h4>
              Harmonic {String(standing.result.harmonic)} at {round(standing.result.frequency as number)} Hz
            </h4>
            <Stats
              items={[
                ['Wavelength', `${round(standing.result.wavelength as number)} m`],
                ['Fundamental', `${round(standing.result.fundamental as number)} Hz`],
                ['Nodes', String((standing.result.nodes as number[]).length)],
                ['Antinodes', String((standing.result.antinodes as number[]).length)]
              ]}
            />
            <Notes notes={(standing.result.notes ?? []) as string[]} label="What the ends decide" />
          </div>
        </>
      )}

      <div className="page-row">
        <Field label="First frequency (Hz)" value={f1} onChange={setF1} />
        <Field label="Second frequency (Hz)" value={f2} onChange={setF2} />
      </div>
      <Problem text={beating.problem} />
      {beating.result !== null && (
        <>
          <Plot
            label="Two notes added"
            series={[
              { name: 'total', points: beatPoints.map((one) => ({ x: one.time, y: one.total })) },
              { name: 'envelope', points: beatPoints.map((one) => ({ x: one.time, y: one.envelope })), dashed: true }
            ]}
          />
          <div className="page-result">
            <h4>Beating {round(beating.result.beatFrequency as number)} times a second</h4>
            <Notes notes={(beating.result.notes ?? []) as string[]} label="Why that is the difference and not half of it" />
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Integrator Lab

export function IntegratorLabPage({ pageId }: Props): React.JSX.Element {
  const [step, setStep] = useState('0.02')
  const [until, setUntil] = useState('200')

  const spring = {
    bodies: [{ id: 'm', mass: 1, position: { x: 1, y: 0 } }],
    forces: [{ kind: 'spring', bodyId: 'm', otherId: null, anchor: { x: 0, y: 0 }, stiffness: 1, restLength: 0 }]
  }

  const comparison = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      number(step, 0) <= 0 || number(until, 0) <= 0
        ? null
        : call('mechanics.compare-integrators', { ...spring, step: number(step, 0.02), until: number(until, 200) }),
    [step, until]
  )
  const euler = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('mechanics.run', { ...spring, integrator: 'euler', step: number(step, 0.02), until: number(until, 200), samples: 400 }),
    [step, until]
  )
  const verlet = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('mechanics.run', { ...spring, integrator: 'velocity-verlet', step: number(step, 0.02), until: number(until, 200), samples: 400 }),
    [step, until]
  )
  const limit = useEngine<Record<string, unknown>>(pageId, async (call) => call('mechanics.stable-step', spring), [])

  const entries = (comparison.result?.entries ?? []) as {
    integrator: string
    symplectic: boolean
    order: number
    relativeDrift: number
    positionDifference: number | null
  }[]
  const traceOf = (result: Record<string, unknown> | null): { x: number; y: number }[] =>
    ((result?.trace ?? []) as { time: number; positions: { x: number }[] }[]).map((one) => ({
      x: one.time,
      y: one.positions[0]?.x ?? 0
    }))

  return (
    <section className="page-pane" aria-label="Integrator Lab">
      <div className="page-row">
        <GitCompare size={16} className="page-arrow" aria-hidden />
        <Field label="Timestep (s)" value={step} onChange={setStep} />
        <Field label="Run for (s)" value={until} onChange={setUntil} />
      </div>
      <p className="page-note">
        The same system every time: a 1 kg mass on a 1 N/m spring, released from 1 m at rest. The exact answer is
        cos(t), for ever, with the energy never changing. Anything else below is the method rather than the physics.
      </p>
      <Problem text={comparison.problem} />

      {limit.result !== null && <p className="page-note">{String(limit.result.from)}</p>}

      {comparison.result !== null && (
        <div className="page-result">
          <h4>Four ways to step forward</h4>
          <div className="page-table-wrap">
            <table className="page-table">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Order</th>
                  <th scope="col">Symplectic</th>
                  <th scope="col">Energy drift</th>
                  <th scope="col">Distance from RK4</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((one) => (
                  <tr key={one.integrator}>
                    <td>{one.integrator}</td>
                    <td>{one.order}</td>
                    <td>{one.symplectic ? 'yes' : 'no'}</td>
                    <td>{round(one.relativeDrift * 100, 4)}%</td>
                    <td>{one.positionDifference === null ? '—' : round(one.positionDifference, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notes notes={(comparison.result.caveats ?? []) as string[]} label="What the table does and does not settle" />
        </div>
      )}

      {euler.result !== null && verlet.result !== null && (
        <Plot
          label="Explicit Euler against velocity Verlet, on the same spring"
          series={[
            { name: 'Euler', points: traceOf(euler.result) },
            { name: 'velocity Verlet', points: traceOf(verlet.result) }
          ]}
          height={200}
        />
      )}
      {euler.result !== null && (
        <div className="page-result">
          <h4>What each method did to the energy</h4>
          <Stats
            items={[
              ['Euler drift', `${round(((euler.result.energy as { relativeDrift: number }).relativeDrift) * 100, 4)}%`],
              ['Verlet drift', `${round((((verlet.result?.energy ?? { relativeDrift: 0 }) as { relativeDrift: number }).relativeDrift) * 100, 4)}%`],
              ['Steps taken', String(euler.result.steps)],
              ['Euler ended at', round((euler.result.energy as { final: number }).final, 5)]
            ]}
          />
          <Notes notes={(euler.result.notes ?? []) as string[]} label="Explicit Euler" />
          <Notes notes={(verlet.result?.notes ?? []) as string[]} label="Velocity Verlet" />
        </div>
      )}
    </section>
  )
}
