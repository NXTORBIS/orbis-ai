/**
 * Robotics: rigid transforms, forward and inverse kinematics, Jacobians, singularities and trajectories.
 *
 * The shared robotics engine for Orbis Pages. Transforms are composed as real 4x4 matrices, inverse kinematics
 * is solved numerically with a damped least-squares step that behaves near singularities, and a pose that the
 * arm cannot reach is reported as unreachable rather than as the nearest thing it could manage.
 *
 * ## Why unreachable is an answer and not an approximation
 *
 * An iterative solver always has a current guess, so it can always return something. Returning the last guess
 * for a target outside the workspace produces a pose that looks like a solution and is not — and a Page showing
 * it would be showing an arm apparently pointing somewhere it cannot point. This engine reports the residual and
 * says plainly when it did not converge.
 *
 * ## Why singularities get their own answer
 *
 * At a singularity the Jacobian loses rank: some direction of end-effector motion needs infinite joint speed. A
 * plain pseudo-inverse blows up there. Damped least squares trades a little accuracy for a bounded step, which is
 * what makes the solver usable across a singularity instead of exploding at it — and the manipulability measure
 * says how close to one the arm currently is.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * forward      vs  inverse        -- joints to pose is one answer; pose to joints is none, one, or many
 * position     vs  orientation    -- metres and radians do not share units, and mixing them weights one silently
 * joint space  vs  Cartesian      -- a straight line in one is a curve in the other
 * reachable    vs  converged      -- inside the workspace against the solver having actually found it
 * DH           vs  modified DH    -- two conventions, different frames, silently wrong if swapped
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface RoboticsError {
  error: 'invalid-argument' | 'not-finite' | 'too-many' | 'unreachable' | 'not-converged' | 'singular' | 'degenerate'
  message: string
}

export const isRoboticsError = (value: unknown): value is RoboticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: RoboticsError['error'], message: string): RoboticsError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const ROBOT_LIMITS = Object.freeze({
  joints: 12,
  iterations: 500,
  waypoints: 200,
  samples: 4000
})

// ---------------------------------------------------------------- transforms

/** Row-major 4x4. */
export type Matrix4 = readonly number[]

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const IDENTITY_4: Matrix4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

export function multiply4(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0)
  for (let r = 0; r < 4; r += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) sum += a[r * 4 + k] * b[k * 4 + col]
      out[r * 4 + col] = sum
    }
  }
  return out
}

export const translationOf = (m: Matrix4): Vec3 => ({ x: m[3], y: m[7], z: m[11] })

/**
 * Roll-pitch-yaw from a rotation matrix, with the gimbal-lock case handled explicitly.
 *
 * At pitch of plus or minus 90 degrees roll and yaw describe the same rotation and only their sum is defined.
 * Returning arbitrary values for each would look like an answer; this splits the whole rotation into yaw and
 * reports that it did so.
 */
export function rpyOf(m: Matrix4): { roll: number; pitch: number; yaw: number; gimbalLock: boolean } {
  const sy = -m[8]
  if (Math.abs(sy) > 0.999999) {
    const pitch = (Math.sign(sy) * Math.PI) / 2
    return { roll: 0, pitch, yaw: Math.atan2(-m[1], m[5]) * Math.sign(sy), gimbalLock: true }
  }
  return {
    roll: Math.atan2(m[9], m[10]),
    pitch: Math.asin(sy),
    yaw: Math.atan2(m[4], m[0]),
    gimbalLock: false
  }
}

export function fromRpy(position: Vec3, roll: number, pitch: number, yaw: number): Matrix4 {
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)]
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)]
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)]
  return Object.freeze([
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, position.x,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, position.y,
    -sp, cp * sr, cp * cr, position.z,
    0, 0, 0, 1
  ])
}

// ---------------------------------------------------------------- Denavit-Hartenberg

export type DhConvention = 'standard' | 'modified'

export interface DhLink {
  label?: string
  /** Metres along the previous z, or the joint variable when this joint is prismatic. */
  d: number
  /** Radians about the previous z, or the joint variable when this joint is revolute. */
  theta: number
  /** Metres along the new x. */
  a: number
  /** Radians about the new x. */
  alpha: number
  type?: 'revolute' | 'prismatic'
  /** Radians for a revolute joint, metres for a prismatic one. */
  minimum?: number
  maximum?: number
}

/** One link's transform. Standard (Denavit-Hartenberg 1955) and modified (Craig) place the frame differently. */
export function dhTransform(link: DhLink, value: number, convention: DhConvention = 'standard'): Matrix4 {
  const revolute = (link.type ?? 'revolute') === 'revolute'
  const theta = revolute ? link.theta + value : link.theta
  const d = revolute ? link.d : link.d + value
  const [ct, st] = [Math.cos(theta), Math.sin(theta)]
  const [ca, sa] = [Math.cos(link.alpha), Math.sin(link.alpha)]

  if (convention === 'standard') {
    return [
      ct, -st * ca, st * sa, link.a * ct,
      st, ct * ca, -ct * sa, link.a * st,
      0, sa, ca, d,
      0, 0, 0, 1
    ]
  }
  return [
    ct, -st, 0, link.a,
    st * ca, ct * ca, -sa, -d * sa,
    st * sa, ct * sa, ca, d * ca,
    0, 0, 0, 1
  ]
}

export interface Pose {
  position: Vec3
  roll: number
  pitch: number
  yaw: number
  matrix: Matrix4
  gimbalLock: boolean
}

export interface ForwardReport {
  pose: Pose
  /** Each joint's frame origin, for drawing the arm. */
  frames: readonly { label: string; position: Vec3; matrix: Matrix4 }[]
  convention: DhConvention
  /** Distance from the base to the end effector. */
  reach: number
  /** Joints outside their declared limits. Empty when there are none or none were declared. */
  outsideLimits: readonly { label: string; value: number; minimum: number | null; maximum: number | null }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Forward kinematics: joints in, pose out. One answer, always.
 *
 * This is the easy direction, and it is what makes the hard one checkable — every inverse solution here is
 * verified by running it forward again and reporting the residual, rather than being trusted.
 */
export function forwardKinematics(
  links: readonly DhLink[],
  values: readonly number[],
  convention: DhConvention = 'standard'
): ForwardReport | RoboticsError {
  if (links.length === 0) return fail('invalid-argument', 'There are no links, so there is no arm.')
  if (links.length > ROBOT_LIMITS.joints) {
    return fail('too-many', `That is ${links.length} joints; this handles up to ${ROBOT_LIMITS.joints}.`)
  }
  if (values.length !== links.length) {
    return fail('invalid-argument', `There are ${links.length} joints but ${values.length} joint values.`)
  }
  for (const [i, v] of values.entries()) {
    if (!finite(v)) return fail('not-finite', `Joint ${i + 1}'s value is not a finite number.`)
  }
  for (const [i, link] of links.entries()) {
    for (const [name, value] of Object.entries({ d: link.d, theta: link.theta, a: link.a, alpha: link.alpha })) {
      if (!finite(value)) return fail('not-finite', `Link ${i + 1}'s "${name}" is not a finite number.`)
    }
  }

  let current: Matrix4 = IDENTITY_4
  const frames: ForwardReport['frames'][number][] = []
  for (const [i, link] of links.entries()) {
    current = multiply4(current, dhTransform(link, values[i], convention))
    frames.push({ label: link.label ?? `joint ${i + 1}`, position: translationOf(current), matrix: Object.freeze([...current]) })
  }

  const outside: ForwardReport['outsideLimits'][number][] = []
  for (const [i, link] of links.entries()) {
    const min = link.minimum ?? null
    const max = link.maximum ?? null
    if ((min !== null && values[i] < min) || (max !== null && values[i] > max)) {
      outside.push({ label: link.label ?? `joint ${i + 1}`, value: values[i], minimum: min, maximum: max })
    }
  }

  const end = translationOf(current)
  const rpy = rpyOf(current)
  const warnings: string[] = []
  if (outside.length > 0) {
    warnings.push(`${outside.length} joint${outside.length === 1 ? ' is' : 's are'} outside the limits declared for them. The pose shown is geometrically correct and the arm cannot actually adopt it.`)
  }
  if (rpy.gimbalLock) {
    warnings.push('The pitch is at 90 degrees, where roll and yaw describe the same rotation and only their sum is defined. The whole rotation has been reported as yaw; the split between roll and yaw is meaningless here.')
  }

  return {
    pose: { position: end, roll: rpy.roll, pitch: rpy.pitch, yaw: rpy.yaw, matrix: Object.freeze([...current]), gimbalLock: rpy.gimbalLock },
    frames: Object.freeze(frames),
    convention,
    reach: Math.hypot(end.x, end.y, end.z),
    outsideLimits: Object.freeze(outside),
    notes: Object.freeze([
      `Using the ${convention} Denavit-Hartenberg convention. The two place the link frame differently, so the same table of numbers gives a different arm under each — check which one your parameters came from.`,
      'Forward kinematics has exactly one answer. That is what makes it the check on the inverse, which has none, one or many.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- Jacobian

export interface JacobianReport {
  /** 6 rows (vx vy vz wx wy wz) by one column per joint. */
  matrix: readonly (readonly number[])[]
  /** sqrt(det(J J^T)). Zero at a singularity. */
  manipulability: number
  /**
   * The same measure over the angular half. On an arm with fewer than six joints this is structurally zero or
   * near it whatever the pose, because such an arm cannot turn about every axis, so it is a diagnostic rather
   * than a singularity test there.
   */
  rotationalManipulability: number
  /** The ratio of largest to smallest singular value. Large means nearly singular. */
  conditionNumber: number | null
  singular: boolean
  /** How near a singularity, as a fraction of the best this arm ever manages. */
  notes: readonly string[]
  warnings: readonly string[]
}

const transpose = (m: readonly (readonly number[])[]): number[][] => {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out: number[][] = []
  for (let col = 0; col < cols; col += 1) {
    const row: number[] = []
    for (let r = 0; r < rows; r += 1) row.push(m[r][col])
    out.push(row)
  }
  return out
}

const matMul = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number[][] => {
  const out: number[][] = []
  for (let r = 0; r < a.length; r += 1) {
    const row: number[] = []
    for (let col = 0; col < (b[0]?.length ?? 0); col += 1) {
      let sum = 0
      for (let k = 0; k < b.length; k += 1) sum += a[r][k] * b[k][col]
      row.push(sum)
    }
    out.push(row)
  }
  return out
}

/** Solve a dense square system by Gaussian elimination with partial pivoting. */
const solveDense = (matrix: readonly (readonly number[])[], vector: readonly number[]): number[] | null => {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < n; col += 1) {
    let best = col
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[best][col])) best = r
    if (Math.abs(a[best][col]) < 1e-14) return null
    ;[a[col], a[best]] = [a[best], a[col]]
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue
      const factor = a[r][col] / a[col][col]
      if (factor === 0) continue
      for (let k = col; k <= n; k += 1) a[r][k] -= factor * a[col][k]
    }
  }
  return a.map((row, i) => row[n] / a[i][i])
}

/** The determinant of a small square matrix, by the same elimination. */
const determinant = (matrix: readonly (readonly number[])[]): number => {
  const n = matrix.length
  if (n === 0) return 1
  const a = matrix.map((row) => [...row])
  let det = 1
  for (let col = 0; col < n; col += 1) {
    let best = col
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[best][col])) best = r
    if (Math.abs(a[best][col]) < 1e-300) return 0
    if (best !== col) {
      ;[a[col], a[best]] = [a[best], a[col]]
      det = -det
    }
    det *= a[col][col]
    for (let r = col + 1; r < n; r += 1) {
      const factor = a[r][col] / a[col][col]
      for (let k = col; k < n; k += 1) a[r][k] -= factor * a[col][k]
    }
  }
  return det
}

/**
 * The geometric Jacobian: how end-effector velocity relates to joint velocity.
 *
 * Built column by column from the joint axes rather than by differencing the forward kinematics, so it is exact
 * rather than approximate. Manipulability is reported because it is the number that says how much room the arm
 * has: it goes to zero at a singularity, and a controller that ignores it will demand joint speeds no motor can
 * produce.
 */
export function jacobian(
  links: readonly DhLink[],
  values: readonly number[],
  convention: DhConvention = 'standard'
): JacobianReport | RoboticsError {
  const forward = forwardKinematics(links, values, convention)
  if (isRoboticsError(forward)) return forward

  const end = forward.pose.position
  const columns: number[][] = []
  let previous: Matrix4 = IDENTITY_4
  for (const [i, link] of links.entries()) {
    const axis = { x: previous[2], y: previous[6], z: previous[10] } // the previous frame's z
    const origin = translationOf(previous)
    const revolute = (link.type ?? 'revolute') === 'revolute'
    if (revolute) {
      const r = { x: end.x - origin.x, y: end.y - origin.y, z: end.z - origin.z }
      columns.push([
        axis.y * r.z - axis.z * r.y,
        axis.z * r.x - axis.x * r.z,
        axis.x * r.y - axis.y * r.x,
        axis.x,
        axis.y,
        axis.z
      ])
    } else {
      columns.push([axis.x, axis.y, axis.z, 0, 0, 0])
    }
    previous = multiply4(previous, dhTransform(link, values[i], convention))
  }

  const matrix: number[][] = []
  for (let r = 0; r < 6; r += 1) matrix.push(columns.map((col) => col[r]))

  // Yoshikawa's measure is sqrt(det(J J^T)), computed here for the linear and the angular half of the Jacobian
  // separately rather than for all six rows at once. The halves have different units — metres per radian against
  // dimensionless — so a determinant over the mixed set has no unit and, worse, the angular rows are almost never
  // degenerate and quietly rescue a determinant that ought to have gone to zero. A fully extended planar arm, the
  // most familiar singularity there is, reads perfectly healthy that way.
  //
  // Of the two Gram products the smaller one is used, since they share their non-zero eigenvalues.
  const measure = (rows: readonly (readonly number[])[]): number => {
    const square = rows.length <= links.length ? matMul(rows, transpose(rows)) : matMul(transpose(rows), rows)
    const det = determinant(square)
    return det <= 0 ? 0 : Math.sqrt(det)
  }
  const manipulability = measure(matrix.slice(0, 3))
  const rotationalManipulability = measure(matrix.slice(3, 6))

  // A condition-number stand-in without a full SVD: the ratio of the largest to smallest non-zero diagonal of
  // J J^T bounds the true one closely enough to flag trouble, and it is honest about being a bound.
  const jjt = matMul(matrix, transpose(matrix))
  const diagonal = jjt.map((row, i) => Math.abs(row[i]))
  const largest = Math.max(...diagonal)
  const nonZero = diagonal.filter((v) => v > 1e-12)
  const smallest = nonZero.length === 0 ? 0 : Math.min(...nonZero)
  const condition = smallest < 1e-14 ? null : Math.sqrt(largest / smallest)

  // Judged on the linear half. An arm with fewer than six joints has an angular block that cannot reach full rank
  // whatever its pose — a planar arm can only ever turn about one axis — so a zero there says nothing about this
  // configuration. With six joints or more it does, and a wrist singularity shows up in exactly that number.
  const singular = manipulability < 1e-9 || (links.length >= 6 && rotationalManipulability < 1e-9)
  const warnings: string[] = []
  if (singular) {
    warnings.push(
      'The arm is at or extremely near a singularity. Some direction of end-effector motion needs infinite joint speed here, and any controller using a plain pseudo-inverse will demand speeds no motor can produce.'
    )
  } else if (condition !== null && condition > 100) {
    warnings.push(`The Jacobian is poorly conditioned (about ${condition.toFixed(0)}). Motion in one direction is far harder than in another, so joint speeds will be very uneven.`)
  }
  if (links.length < 6) {
    warnings.push(`This arm has ${links.length} joints, so it cannot reach an arbitrary position and orientation — a general six-degree-of-freedom pose needs six joints. Some of the Jacobian's rows are unreachable directions.`)
  }

  return {
    matrix: Object.freeze(matrix.map((row) => Object.freeze([...row]))),
    manipulability,
    rotationalManipulability,
    conditionNumber: condition,
    singular,
    notes: Object.freeze([
      'The Jacobian maps joint speeds to end-effector speed, and its transpose maps end-effector force to joint torque. Those two facts are the whole of arm control.',
      `Manipulability is ${manipulability.toExponential(3)}. It goes to zero at a singularity and is largest where the arm has the most freedom — roughly, away from full extension and away from joints lining up.`,
      'This is built from the joint axes directly, not by differencing the forward kinematics, so it is exact.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- inverse kinematics

export interface InverseReport {
  values: readonly number[]
  pose: Pose
  /** Metres between the pose reached and the pose asked for. */
  positionError: number
  /** Radians. */
  orientationError: number
  iterations: number
  converged: boolean
  /** Whether the solver hit a joint limit and stopped there. */
  limitedJoints: readonly string[]
  manipulability: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Inverse kinematics by damped least squares, verified by running the answer forward again.
 *
 * Damped rather than a plain pseudo-inverse because the plain one is unbounded at a singularity: it produces a
 * huge joint step, the arm lurches, and the next iteration is worse. The damping trades a little accuracy for a
 * bounded step, which is what lets the solver pass through a singular configuration instead of exploding at one.
 *
 * When it does not converge it says so and returns the residual. A target outside the workspace has no solution,
 * and the closest the arm can get is a different answer to the one that was asked for.
 */
export function inverseKinematics(input: {
  links: readonly DhLink[]
  target: { position: Vec3; roll?: number; pitch?: number; yaw?: number }
  initial?: readonly number[]
  convention?: DhConvention
  positionOnly?: boolean
  tolerance?: number
  maxIterations?: number
  damping?: number
  respectLimits?: boolean
}): InverseReport | RoboticsError {
  const { links } = input
  const convention = input.convention ?? 'standard'
  if (links.length === 0) return fail('invalid-argument', 'There are no links, so there is no arm.')
  if (links.length > ROBOT_LIMITS.joints) return fail('too-many', `That is ${links.length} joints; this handles up to ${ROBOT_LIMITS.joints}.`)
  const { position } = input.target
  for (const [name, value] of Object.entries(position)) {
    if (!finite(value)) return fail('not-finite', `The target's ${name} is not a finite number.`)
  }
  const positionOnly = input.positionOnly ?? links.length < 6
  const tolerance = input.tolerance ?? 1e-5
  if (!finite(tolerance) || tolerance <= 0) return fail('invalid-argument', 'The tolerance has to be greater than zero.')
  const maxIterations = Math.round(input.maxIterations ?? 200)
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > ROBOT_LIMITS.iterations) {
    return fail('invalid-argument', `The iteration limit has to be between 1 and ${ROBOT_LIMITS.iterations}.`)
  }
  const damping = input.damping ?? 0.05
  if (!finite(damping) || damping <= 0) return fail('invalid-argument', 'The damping has to be greater than zero.')
  const respectLimits = input.respectLimits ?? true

  let values = input.initial ? [...input.initial] : links.map(() => 0.0001)
  if (values.length !== links.length) return fail('invalid-argument', `The starting guess has ${values.length} values for ${links.length} joints.`)
  for (const v of values) if (!finite(v)) return fail('not-finite', 'The starting guess contains a value that is not finite.')

  const targetMatrix = fromRpy(position, input.target.roll ?? 0, input.target.pitch ?? 0, input.target.yaw ?? 0)
  const rows = positionOnly ? 3 : 6
  const limited = new Set<string>()
  let iterations = 0
  let positionError = Infinity
  let orientationError = 0
  let converged = false

  for (; iterations < maxIterations; iterations += 1) {
    const forward = forwardKinematics(links, values, convention)
    if (isRoboticsError(forward)) return forward
    const at = forward.pose.position
    const error: number[] = [position.x - at.x, position.y - at.y, position.z - at.z]
    positionError = Math.hypot(error[0], error[1], error[2])

    if (!positionOnly) {
      // The orientation error as a rotation vector: the axis-angle of R_target * R_current^T, which is the
      // rotation still to be applied. Subtracting Euler angles would be wrong — they do not subtract.
      const r = forward.pose.matrix
      const t = targetMatrix
      const e: number[] = []
      for (let i = 0; i < 3; i += 1) {
        const a = { x: r[i], y: r[4 + i], z: r[8 + i] }
        const b = { x: t[i], y: t[4 + i], z: t[8 + i] }
        e.push(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
      }
      const wx = 0.5 * (e[0] + e[3] + e[6])
      const wy = 0.5 * (e[1] + e[4] + e[7])
      const wz = 0.5 * (e[2] + e[5] + e[8])
      error.push(wx, wy, wz)
      orientationError = Math.hypot(wx, wy, wz)
    }

    if (positionError < tolerance && (positionOnly || orientationError < tolerance)) {
      converged = true
      break
    }

    const jac = jacobian(links, values, convention)
    if (isRoboticsError(jac)) return jac
    const j = jac.matrix.slice(0, rows).map((row) => [...row])

    // Damped least squares: solve (J J^T + lambda^2 I) y = e, then dq = J^T y. Bounded at a singularity,
    // where a plain pseudo-inverse is not.
    const jjt = matMul(j, transpose(j))
    for (let i = 0; i < rows; i += 1) jjt[i][i] += damping * damping
    const y = solveDense(jjt, error.slice(0, rows))
    if (y === null) {
      return fail('singular', 'The damped system could not be solved, which means the arm is at a degenerate configuration the damping cannot rescue. Try a different starting guess.')
    }
    const jt = transpose(j)
    const step = jt.map((row) => row.reduce((sum, v, i) => sum + v * y[i], 0))

    // Cap the step so one bad iteration cannot throw the arm across its workspace.
    const biggest = Math.max(...step.map(Math.abs))
    const scale = biggest > 0.5 ? 0.5 / biggest : 1
    values = values.map((v, i) => {
      let next = v + step[i] * scale
      if (respectLimits) {
        const link = links[i]
        if (link.minimum !== undefined && next < link.minimum) {
          next = link.minimum
          limited.add(link.label ?? `joint ${i + 1}`)
        }
        if (link.maximum !== undefined && next > link.maximum) {
          next = link.maximum
          limited.add(link.label ?? `joint ${i + 1}`)
        }
      }
      return next
    })
    if (!values.every(finite)) return fail('not-converged', 'The solver diverged. The target is probably far outside the workspace.')
  }

  const final = forwardKinematics(links, values, convention)
  if (isRoboticsError(final)) return final
  const jac = jacobian(links, values, convention)
  const manipulability = isRoboticsError(jac) ? 0 : jac.manipulability

  const warnings: string[] = []
  if (!converged) {
    warnings.push(
      `The solver did not reach the target. It got within ${positionError.toFixed(6)} m${positionOnly ? '' : ` and ${orientationError.toFixed(6)} rad`} after ${iterations} passes. That usually means the pose is outside this arm's workspace, and the joint values here are the closest it managed — not a solution.`
    )
  }
  if (limited.size > 0) {
    warnings.push(`The solver ran into the limits on ${[...limited].join(', ')}. With those joints pinned the remaining ones may not be able to reach the target at all.`)
  }
  if (manipulability < 1e-6) {
    warnings.push('The solution sits at a singularity. It is a valid pose, but the arm cannot move smoothly through it and a velocity controller will struggle there.')
  }

  return {
    values: Object.freeze(values),
    pose: final.pose,
    positionError,
    orientationError,
    iterations,
    converged,
    limitedJoints: Object.freeze([...limited]),
    manipulability,
    notes: Object.freeze([
      'Solved by damped least squares and then checked by running the answer forward again — the errors above are measured, not assumed.',
      'Inverse kinematics usually has several solutions. This is the one nearest the starting guess, which is what you want when moving an arm and is not necessarily the one you want when planning from scratch.',
      positionOnly
        ? 'Only the position was matched. With fewer than six joints the orientation cannot be chosen independently.'
        : 'Position and orientation were both matched, weighted equally. Metres and radians do not share units, so that weighting is a choice — change the tolerance if one matters more.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- trajectories

export type TrajectoryProfile = 'trapezoidal' | 'cubic' | 'quintic'

export const TRAJECTORY_PROFILES: readonly TrajectoryProfile[] = Object.freeze(['trapezoidal', 'cubic', 'quintic'])

export interface TrajectoryReport {
  profile: TrajectoryProfile
  samples: readonly { time: number; position: number; velocity: number; acceleration: number }[]
  duration: number
  peakVelocity: number
  peakAcceleration: number
  /** Trapezoidal only: how long each phase lasts. */
  phases: { accelerate: number; cruise: number; decelerate: number } | null
  /** True when the move is too short to reach the cruise speed, so it is triangular instead. */
  triangular: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A single-joint motion profile.
 *
 * The three profiles differ in what they are smooth in, and that is the whole choice. Trapezoidal is fastest for
 * a given speed and acceleration limit but has a step in acceleration at each corner, which a real arm feels as
 * a jolt. Cubic is smooth in velocity and still steps in acceleration at the ends. Quintic is smooth in
 * acceleration too, which is what removes the jolt, and it is slower for the same limits.
 */
export function trajectory(input: {
  profile: TrajectoryProfile
  from: number
  to: number
  duration?: number
  maximumVelocity?: number
  maximumAcceleration?: number
  samples?: number
}): TrajectoryReport | RoboticsError {
  if (!TRAJECTORY_PROFILES.includes(input.profile)) {
    return fail('invalid-argument', `"${input.profile}" is not one of: ${TRAJECTORY_PROFILES.join(', ')}.`)
  }
  const { from, to } = input
  if (!finite(from) || !finite(to)) return fail('not-finite', 'The start and end have to be finite numbers.')
  const distance = to - from
  const count = Math.round(input.samples ?? 200)
  if (!Number.isInteger(count) || count < 2 || count > ROBOT_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${ROBOT_LIMITS.samples}.`)
  }

  const samples: TrajectoryReport['samples'][number][] = []
  const warnings: string[] = []
  let duration: number
  let phases: TrajectoryReport['phases'] = null
  let triangular = false

  if (input.profile === 'trapezoidal') {
    const vMax = input.maximumVelocity
    const aMax = input.maximumAcceleration
    if (vMax === undefined || aMax === undefined) {
      return fail('invalid-argument', 'A trapezoidal profile is defined by its speed and acceleration limits, so both are needed.')
    }
    if (!finite(vMax) || !finite(aMax) || vMax <= 0 || aMax <= 0) {
      return fail('invalid-argument', 'The speed and acceleration limits both have to be greater than zero.')
    }
    const d = Math.abs(distance)
    const sign = Math.sign(distance) || 1
    const rampDistance = (vMax * vMax) / (2 * aMax)
    let tRamp: number
    let tCruise: number
    let peakV: number
    if (d < 2 * rampDistance) {
      // Too short to reach the cruise speed: the profile is a triangle, not a trapezium.
      triangular = true
      peakV = Math.sqrt(aMax * d)
      tRamp = peakV / aMax
      tCruise = 0
      warnings.push(`The move is too short to reach ${vMax} of speed. It accelerates to ${peakV.toFixed(4)} and immediately decelerates — a triangle, not a trapezium.`)
    } else {
      peakV = vMax
      tRamp = vMax / aMax
      tCruise = (d - 2 * rampDistance) / vMax
    }
    duration = 2 * tRamp + tCruise
    phases = { accelerate: tRamp, cruise: tCruise, decelerate: tRamp }

    for (let i = 0; i < count; i += 1) {
      const t = (duration * i) / (count - 1)
      let p: number
      let v: number
      let a: number
      if (t < tRamp) {
        a = aMax
        v = aMax * t
        p = 0.5 * aMax * t * t
      } else if (t < tRamp + tCruise) {
        a = 0
        v = peakV
        p = 0.5 * aMax * tRamp * tRamp + peakV * (t - tRamp)
      } else {
        const td = t - tRamp - tCruise
        a = -aMax
        v = peakV - aMax * td
        p = 0.5 * aMax * tRamp * tRamp + peakV * tCruise + peakV * td - 0.5 * aMax * td * td
      }
      samples.push({ time: t, position: from + sign * p, velocity: sign * v, acceleration: sign * a })
    }
  } else {
    duration = input.duration ?? 1
    if (!finite(duration) || duration <= 0) {
      return fail('invalid-argument', 'A cubic or quintic profile is defined over a chosen duration, so a positive duration is needed.')
    }
    for (let i = 0; i < count; i += 1) {
      const t = (duration * i) / (count - 1)
      const s = t / duration
      let f: number
      let df: number
      let ddf: number
      if (input.profile === 'cubic') {
        f = 3 * s * s - 2 * s * s * s
        df = (6 * s - 6 * s * s) / duration
        ddf = (6 - 12 * s) / (duration * duration)
      } else {
        f = 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5
        df = (30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4) / duration
        ddf = (60 * s - 180 * s ** 2 + 120 * s ** 3) / (duration * duration)
      }
      samples.push({ time: t, position: from + distance * f, velocity: distance * df, acceleration: distance * ddf })
    }
    const peakV = Math.abs(distance) * (input.profile === 'cubic' ? 1.5 : 1.875) / duration
    if (input.maximumVelocity !== undefined && peakV > input.maximumVelocity) {
      warnings.push(`This profile peaks at ${peakV.toFixed(4)} of speed, above the limit of ${input.maximumVelocity}. Lengthen the duration or use a trapezoidal profile, which respects the limit by construction.`)
    }
  }

  const peakVelocity = Math.max(...samples.map((s) => Math.abs(s.velocity)))
  const peakAcceleration = Math.max(...samples.map((s) => Math.abs(s.acceleration)))

  const notes: string[] = [
    input.profile === 'trapezoidal'
      ? 'Trapezoidal is the fastest move within a speed and acceleration limit, and it steps the acceleration at every corner. A real arm feels that step as a jolt and it excites whatever the structure resonates at.'
      : input.profile === 'cubic'
        ? 'Cubic is smooth in velocity and starts and ends at rest, but the acceleration jumps at both ends. Smoother than trapezoidal, not smooth.'
        : 'Quintic is smooth in acceleration as well as velocity, so it starts and ends without a jolt. That smoothness costs a higher peak speed for the same move time.',
    `Peak speed ${peakVelocity.toFixed(4)}, peak acceleration ${peakAcceleration.toFixed(4)}.`
  ]

  return {
    profile: input.profile,
    samples: Object.freeze(samples),
    duration,
    peakVelocity,
    peakAcceleration,
    phases,
    triangular,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

/**
 * Joint torques for a static hold, from the Jacobian transpose.
 *
 * The transpose maps an end-effector force to the joint torques that resist it. This is the static case only —
 * a moving arm also needs the inertial, Coriolis and centrifugal terms, which are not here, and pretending a
 * static answer covers a fast move would understate the torque badly.
 */
export function staticTorques(input: {
  links: readonly DhLink[]
  values: readonly number[]
  force: Vec3
  moment?: Vec3
  convention?: DhConvention
}): { torques: readonly { label: string; torque: number }[]; notes: readonly string[]; warnings: readonly string[] } | RoboticsError {
  const jac = jacobian(input.links, input.values, input.convention ?? 'standard')
  if (isRoboticsError(jac)) return jac
  const m = input.moment ?? { x: 0, y: 0, z: 0 }
  const wrench = [input.force.x, input.force.y, input.force.z, m.x, m.y, m.z]
  for (const v of wrench) if (!finite(v)) return fail('not-finite', 'The force or moment contains a value that is not finite.')

  const torques = input.links.map((link, i) => ({
    label: link.label ?? `joint ${i + 1}`,
    torque: jac.matrix.reduce((sum, row, r) => sum + row[i] * wrench[r], 0)
  }))

  const warnings = [...jac.warnings]
  const biggest = torques.reduce((best, one) => (Math.abs(one.torque) > Math.abs(best.torque) ? one : best))
  return {
    torques: Object.freeze(torques),
    notes: Object.freeze([
      'The Jacobian transpose maps an end-effector force to the joint torques that hold against it. That is the whole calculation.',
      `"${biggest.label}" carries the most, at ${biggest.torque.toFixed(4)} N*m. That is the joint that sizes the motor.`,
      'This is the static case only. A moving arm also needs the inertia, Coriolis and centrifugal terms, which are not included here — a fast move needs considerably more torque than this.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const ROBOT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Links are rigid and joints have no backlash or flexibility. Real arms have both, and both show up as position error at the tool.',
  'Denavit-Hartenberg parameters are read in whichever convention was asked for. Standard and modified place the frames differently and silently give a different arm.',
  'Inverse kinematics is solved numerically, and the answer is checked by running it forward again. A non-converged result is reported as such, never dressed up as a solution.',
  'Inverse solutions are not unique. The one returned is the one nearest the starting guess.',
  'Singularities are detected and reported. Damped least squares keeps the solver stable near them, at the cost of a little accuracy there.',
  'Torques are static only. Inertial, Coriolis, centrifugal and gravity-compensation terms are not included.'
])
