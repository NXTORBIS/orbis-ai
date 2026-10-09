import { useEffect, useMemo } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import Plot, { tidy } from './Plot'
import { useEngineering } from './useEngineering'
import './phase2.css'
import './phase3.css'
import './phase4.css'

/**
 * The Robot Arm Laboratory.
 *
 * ## The arm is drawn from the real transforms
 *
 * Every joint position on screen is a point out of the forward-kinematics report, which multiplies the actual
 * Denavit-Hartenberg matrices. So the arm cannot be drawn in a pose it could not hold, and a joint past its limit is
 * drawn where it would actually be with the limit named rather than silently clamped.
 *
 * ## An unreachable target is shown as unreached
 *
 * Inverse kinematics is damped least squares, and it reports whether it converged and how far short it fell. When a
 * target is outside the workspace the arm is drawn reaching as far as it got, with the shortfall stated. Snapping to
 * the nearest reachable point and calling it solved would hide the single most useful thing about a workspace.
 *
 * ## Singularity is reported, because that is where a real arm stops working
 *
 * The manipulability figure comes from the Jacobian. Near zero means the arm has lost the ability to move in some
 * direction however fast its joints turn — and that is a real effect somebody needs to meet, so it is named rather
 * than smoothed over.
 */

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Pose {
  position: Vec3
  roll: number
  pitch: number
  yaw: number
  gimbalLock: boolean
}

interface ForwardReport {
  pose: Pose
  frames: readonly { label: string; position: Vec3 }[]
  reach: number
  outsideLimits: readonly { label: string; value: number; minimum: number | null; maximum: number | null }[]
  notes: readonly string[]
  warnings: readonly string[]
}

interface InverseReport {
  values: readonly number[]
  pose: Pose
  positionError: number
  orientationError: number
  iterations: number
  converged: boolean
  limitedJoints: readonly string[]
  manipulability: number
  notes: readonly string[]
  warnings: readonly string[]
  refused?: { says: string; fix: string }
}

interface JacobianReport {
  matrix: readonly (readonly number[])[]
  manipulability: number
  conditionNumber: number | null
  singular: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

interface TrajectoryReport {
  profile: string
  samples: readonly { time: number; position: number; velocity: number; acceleration: number }[]
  duration: number
  peakVelocity: number
  peakAcceleration: number
  phases: { accelerate: number; cruise: number; decelerate: number } | null
  triangular: boolean
  notes: readonly string[]
  warnings: readonly string[]
  refused?: { says: string; fix: string }
}

const DEGREES = 180 / Math.PI

const readNumbers = (text: string, fallback: readonly number[]): readonly number[] => {
  const out = String(text)
    .split(/[\s,;]+/)
    .map((one) => Number(one))
    .filter((one) => Number.isFinite(one))
  return out.length > 0 ? out : fallback
}

export default function RobotLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engineering = useEngineering()
  const values = instance?.values ?? {}

  const lengths = readNumbers(String(values.lengths ?? '0.4 0.35 0.2'), [0.4, 0.35, 0.2])
  const angles = readNumbers(String(values.angles ?? '30 40 -20'), [30, 40, -20])
  const limit = Number(values.limit ?? 170)
  const targetX = Number(values.targetX ?? 0.5)
  const targetY = Number(values.targetY ?? 0.3)
  const targetZ = Number(values.targetZ ?? 0)
  const reachFor = values.reachFor !== false
  const respectLimits = values.respectLimits !== false
  const payload = Number(values.payload ?? 0)
  const profile = String(values.profile ?? 'trapezoidal') as 'trapezoidal' | 'cubic' | 'quintic'
  const moveJoint = Number(values.moveJoint ?? 1)
  const moveTo = Number(values.moveTo ?? 90)
  const moveOver = Number(values.moveOver ?? 2)

  /*
   * A planar arm, built as Denavit-Hartenberg links.
   *
   * All the twists are zero and all the offsets are zero, which is what makes it planar — the arm lies in one plane
   * and every joint turns about an axis perpendicular to it. That is the arm worth starting with, because its
   * workspace is a disc somebody can see, and the engine handles the general case regardless.
   */
  const links = useMemo(
    () =>
      lengths.map((length, index) => ({
        label: `joint ${index + 1}`,
        d: 0,
        theta: 0,
        a: length,
        alpha: 0,
        type: 'revolute' as const,
        minimum: (-limit * Math.PI) / 180,
        maximum: (limit * Math.PI) / 180
      })),
    [String(lengths), limit]
  )

  // The engine works in radians; the panel offers degrees, because nobody thinks about a joint in radians.
  const inRadians = useMemo(
    () => links.map((_, index) => ((angles[index] ?? 0) * Math.PI) / 180),
    [String(angles), links.length]
  )

  useEffect(() => {
    if (!engineering.ready) return
    engineering.ask({
      kind: 'robot',
      links,
      values: inRadians,
      target: reachFor ? { x: targetX, y: targetY, z: targetZ } : null,
      positionOnly: true,
      respectLimits,
      move:
        moveOver > 0
          ? { profile, joint: Math.max(0, Math.min(links.length - 1, moveJoint - 1)), to: (moveTo * Math.PI) / 180, duration: moveOver }
          : null,
      payload: payload === 0 ? null : { x: 0, y: 0, z: -payload * 9.80665 }
    })
  }, [
    engineering.ready,
    links,
    inRadians,
    reachFor,
    targetX,
    targetY,
    targetZ,
    respectLimits,
    payload,
    profile,
    moveJoint,
    moveTo,
    moveOver
  ])

  const held = engineering.robot.value
  const forward = (held?.forward ?? null) as ForwardReport | null
  const inverse = (held?.inverse ?? null) as InverseReport | null
  const jacobianReport = (held?.jacobianReport ?? null) as JacobianReport | null
  const planned = (held?.planned ?? null) as TrajectoryReport | null
  const torques = (held?.torques ?? null) as { torques: readonly { label: string; torque: number }[]; warnings: readonly string[] } | null

  const fullReach = lengths.reduce((a, b) => a + b, 0)
  const targetDistance = Math.hypot(targetX, targetY, targetZ)

  return (
    <section className="p2 p4" aria-label="Robot Arm Laboratory">
      <header className="p2-bar">
        <strong>
          {links.length}-joint arm, {tidy(fullReach)} m fully extended
        </strong>
        {forward !== null && (
          <span className="p2-faint">
            Gripper at ({tidy(forward.pose.position.x)}, {tidy(forward.pose.position.y)}, {tidy(forward.pose.position.z)}) m
          </span>
        )}
      </header>

      {engineering.robot.refused && (
        <p className="p2-refused" role="status">
          <strong>{engineering.robot.refused.says}</strong> {engineering.robot.refused.fix}
        </p>
      )}
      {engineering.robot.broke && (
        <p className="p2-refused" role="status">
          {engineering.robot.broke}
        </p>
      )}

      {reachFor && targetDistance > fullReach && (
        <p className="p2-refused" role="status">
          <strong>That target is outside the arm's reach.</strong> It is {tidy(targetDistance)} m away and the arm
          reaches {tidy(fullReach)} m fully extended. The arm below is drawn reaching as far as it got, which is what
          a real one would do.
        </p>
      )}

      {forward !== null && forward.outsideLimits.length > 0 && (
        <p className="p2-refused" role="status">
          <strong>
            {forward.outsideLimits.map((one) => one.label).join(', ')}{' '}
            {forward.outsideLimits.length === 1 ? 'is' : 'are'} past the limit.
          </strong>{' '}
          Drawn where that angle would actually put it, rather than quietly pulled back to the limit.
        </p>
      )}

      <div className="p3-split">
        <div>
          {forward === null && <p className="p2-faint">{engineering.robot.busy ? 'Working it out…' : 'Nothing worked out yet.'}</p>}
          {forward !== null && (
            <ArmView
              frames={forward.frames}
              reach={fullReach}
              target={reachFor ? { x: targetX, y: targetY } : null}
              solved={inverse !== null && inverse.refused === undefined && inverse.converged}
            />
          )}

          {planned !== null && planned.refused === undefined && planned.samples.length > 0 && (
            <>
              <h4 className="p4-heading">Moving joint {moveJoint} to {moveTo}°</h4>
              <Plot
                series={[
                  {
                    id: 'pos',
                    label: 'Angle (degrees)',
                    points: planned.samples.map((one) => ({ x: one.time, y: one.position * DEGREES }))
                  }
                ]}
                xLabel="seconds"
                yLabel="degrees"
                height={150}
                about={
                  planned.phases === null
                    ? `A ${planned.profile} profile: the speed is shaped so it starts and stops smoothly.`
                    : planned.triangular
                      ? 'The move is too short to reach full speed, so it accelerates and then immediately decelerates — a triangular profile.'
                      : `It accelerates for ${tidy(planned.phases.accelerate)} s, holds speed for ${tidy(planned.phases.cruise)} s, then decelerates for ${tidy(planned.phases.decelerate)} s.`
                }
              />
              <Plot
                series={[
                  {
                    id: 'vel',
                    label: 'Speed (degrees per second)',
                    points: planned.samples.map((one) => ({ x: one.time, y: one.velocity * DEGREES })),
                    colour: '#37d67a'
                  },
                  {
                    id: 'acc',
                    label: 'Acceleration (degrees per second²)',
                    points: planned.samples.map((one) => ({ x: one.time, y: one.acceleration * DEGREES })),
                    colour: '#f0a33a'
                  }
                ]}
                xLabel="seconds"
                yLabel="rate"
                zero={0}
                height={150}
                about="Speed and acceleration both reach zero at each end, which is what stops the arm jolting."
              />
            </>
          )}
          {planned?.refused !== undefined && (
            <p className="p2-refused" role="status">
              <strong>{planned.refused.says}</strong> {planned.refused.fix}
            </p>
          )}
        </div>

        <div className="p3-side">
          {forward !== null && (
            <div className="p3-panel">
              <h4>Where the gripper is</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>x</dt>
                  <dd>{tidy(forward.pose.position.x)} m</dd>
                </div>
                <div className="p4-fact">
                  <dt>y</dt>
                  <dd>{tidy(forward.pose.position.y)} m</dd>
                </div>
                <div className="p4-fact">
                  <dt>z</dt>
                  <dd>{tidy(forward.pose.position.z)} m</dd>
                </div>
                <div className="p4-fact">
                  <dt>Distance out</dt>
                  <dd>
                    {tidy(Math.hypot(forward.pose.position.x, forward.pose.position.y, forward.pose.position.z))} m of{' '}
                    {tidy(fullReach)}
                  </dd>
                </div>
              </dl>
              <p className="p2-faint">
                Worked out by multiplying the joint transforms together, which is what forward kinematics is.
              </p>
            </div>
          )}

          {inverse !== null && (
            <div className="p3-panel">
              <h4>Reaching the target</h4>
              {inverse.refused !== undefined ? (
                <p className="p2-faint">
                  <strong>{inverse.refused.says}</strong> {inverse.refused.fix}
                </p>
              ) : (
                <>
                  <dl className="p3-facts">
                    <div className="p4-fact">
                      <dt>Got there</dt>
                      <dd>{inverse.converged ? 'yes' : 'no'}</dd>
                    </div>
                    <div className="p4-fact">
                      <dt>Short by</dt>
                      <dd>{tidy(inverse.positionError)} m</dd>
                    </div>
                    <div className="p4-fact">
                      <dt>Took</dt>
                      <dd>
                        {inverse.iterations} {inverse.iterations === 1 ? 'try' : 'tries'}
                      </dd>
                    </div>
                  </dl>
                  <h5 className="p4-heading">The angles it found</h5>
                  <div className="p4-row">
                    {inverse.values.map((one, index) => (
                      <div key={index} className="p4-box">
                        <span className="p4-box-value">{(one * DEGREES).toFixed(1)}°</span>
                        <small>joint {index + 1}</small>
                      </div>
                    ))}
                  </div>
                  {inverse.limitedJoints.length > 0 && (
                    <p className="p2-faint">
                      {inverse.limitedJoints.join(', ')} ran into {inverse.limitedJoints.length === 1 ? 'its' : 'their'}{' '}
                      limit, which is why it could not get closer.
                    </p>
                  )}
                  <p className="p2-faint">
                    Found by stepping towards the target rather than solved in one go, which is why there is a number
                    of tries and a small error left over. That is how most real arms do it.
                  </p>
                </>
              )}
            </div>
          )}

          {jacobianReport !== null && (
            <div className="p3-panel">
              <h4>How freely it can move from here</h4>
              <dl className="p3-facts">
                <div className="p4-fact">
                  <dt>Freedom of movement</dt>
                  <dd>{tidy(jacobianReport.manipulability)}</dd>
                </div>
                <div className="p4-fact">
                  <dt>Awkwardness</dt>
                  <dd>{jacobianReport.conditionNumber === null ? 'immeasurable' : tidy(jacobianReport.conditionNumber)}</dd>
                </div>
              </dl>
              <p className="p2-faint">
                {jacobianReport.singular
                  ? 'This pose is singular: there is a direction the gripper cannot move in at all, however fast the joints turn. A fully straightened arm is the usual way to find one.'
                  : 'The nearer the freedom figure is to zero, the closer the arm is to a pose where some direction becomes impossible. Straighten it out and watch the number fall.'}
              </p>
            </div>
          )}

          {torques !== null && torques.torques.length > 0 && (
            <div className="p3-panel">
              <h4>What each joint has to hold</h4>
              <dl className="p3-facts">
                {torques.torques.map((one) => (
                  <div key={one.label} className="p4-fact">
                    <dt>{one.label}</dt>
                    <dd>{tidy(one.torque)} N·m</dd>
                  </div>
                ))}
              </dl>
              <p className="p2-faint">
                Holding {tidy(payload)} kg at the gripper. The joint nearest the base carries the most, because it has
                the longest lever against it.
              </p>
            </div>
          )}

          <div className="p3-panel">
            <h4>What this does not model</h4>
            <ul className="p3-assumptions">
              {(held?.assumptions ?? []).map((one, index) => (
                <li key={index}>{one}</li>
              ))}
              <li>Links with no weight of their own, so the holding torques are from the payload only.</li>
              <li>No collision checking. The arm will happily be drawn passing through itself.</li>
              <li>A planar arm: every joint turns in the same plane. The engine handles any arm; this panel builds that one.</li>
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
            busy={engineering.robot.busy}
          />
        </details>
      )}
    </section>
  )
}

/**
 * The arm, from the frame positions the engine reported.
 *
 * The reach circle is drawn because the workspace is the thing that makes an unreachable target make sense, and a
 * target outside it is drawn outside it rather than being moved onto the edge.
 */
function ArmView({
  frames,
  reach,
  target,
  solved
}: {
  frames: readonly { label: string; position: Vec3 }[]
  reach: number
  target: { x: number; y: number } | null
  solved: boolean
}): React.JSX.Element {
  const widest = Math.max(reach * 1.15, target === null ? 0 : Math.hypot(target.x, target.y) * 1.15, 0.1)
  const at = (value: number): number => 50 + (value / (widest * 2)) * 100

  const points = [{ x: 0, y: 0 }, ...frames.map((one) => ({ x: one.position.x, y: one.position.y }))]

  return (
    <div className="p4-arm">
      <svg viewBox="0 0 100 100" role="img" aria-label="The arm, drawn from its joint positions">
        {/* How far it can reach, and how far it must reach to fold back on itself. */}
        <circle cx="50" cy="50" r={(reach / (widest * 2)) * 100} className="p4-reach" />
        <line x1="0" y1="50" x2="100" y2="50" className="p4-plot-zero" vectorEffect="non-scaling-stroke" />
        <line x1="50" y1="0" x2="50" y2="100" className="p4-plot-zero" vectorEffect="non-scaling-stroke" />
        {points.slice(0, -1).map((one, index) => (
          <line
            key={index}
            x1={at(one.x)}
            y1={at(-one.y)}
            x2={at(points[index + 1].x)}
            y2={at(-points[index + 1].y)}
            className="p4-limb"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points.map((one, index) => (
          <circle
            key={index}
            cx={at(one.x)}
            cy={at(-one.y)}
            r={index === 0 ? 3 : index === points.length - 1 ? 2.6 : 2.2}
            className={index === 0 ? 'p4-base' : index === points.length - 1 ? 'p4-gripper' : 'p4-joint'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {target !== null && (
          <g>
            <circle cx={at(target.x)} cy={at(-target.y)} r="3" className={`p4-target${solved ? ' reached' : ''}`} vectorEffect="non-scaling-stroke" />
            <line x1={at(target.x) - 4} y1={at(-target.y)} x2={at(target.x) + 4} y2={at(-target.y)} className="p4-target-cross" vectorEffect="non-scaling-stroke" />
            <line x1={at(target.x)} y1={at(-target.y) - 4} x2={at(target.x)} y2={at(-target.y) + 4} className="p4-target-cross" vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
      <ul className="p4-legend">
        <li>
          <span className="p4-swatch" style={{ background: 'var(--cyan)' }} aria-hidden="true" />
          the arm
        </li>
        <li className="p4-legend-mark">the circle is as far as it reaches, {tidy(reach)} m</li>
        {target !== null && (
          <li className="p4-legend-mark">{solved ? 'the target was reached' : 'the target was not reached'}</li>
        )}
      </ul>
    </div>
  )
}
