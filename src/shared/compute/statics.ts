/**
 * Statics: things that are not moving, and the forces that arrange for that.
 *
 * The shared statics engine for Orbis Pages. Equilibrium here is a linear system that is actually assembled and
 * actually solved, and every answer comes back with the residual it left behind — because "equilibrium verified"
 * is a claim, and a claim needs a number underneath it.
 *
 * ## Why the residual is part of the answer
 *
 * Three equations, three unknowns, and a solver that returns numbers is not the same as a structure in
 * equilibrium. Summing the forces back up is what tells the difference, and it costs almost nothing. A Page that
 * prints a green tick without that sum is printing a decoration.
 *
 * ## Determinacy is a property of the structure, not of the solver
 *
 * A truss with too few members is a mechanism: it moves, and no set of member forces holds it still. One with too
 * many is statically indeterminate: equilibrium alone does not fix the forces, and you need the stiffnesses as
 * well. Both are real structures and neither can be solved by equilibrium alone — so both are detected and named
 * rather than being handed to a solver that will return something.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * force        vs  moment          -- newtons against newton-metres; a moment needs a point to be about
 * pin          vs  roller          -- two reaction components against one, which decides determinacy
 * tension      vs  compression     -- the sign, and compression is what buckles
 * static       vs  kinetic friction -- the limit before it slips against the drag once it does
 * determinate  vs  stable          -- solvable by equilibrium against not falling over; neither implies the other
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { STANDARD_GRAVITY } from './emConstants.ts'

export interface StaticsError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'too-many'
    | 'not-in-equilibrium'
    | 'mechanism'
    | 'indeterminate'
    | 'singular'
    | 'unknown-node'
    | 'no-members'
    | 'degenerate'
  message: string
  involves?: readonly string[]
}

export const isStaticsError = (value: unknown): value is StaticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: StaticsError['error'], message: string, involves?: readonly string[]): StaticsError =>
  involves ? { error, message, involves } : { error, message }

const finite = (value: number): boolean => Number.isFinite(value)

export const STATICS_LIMITS = Object.freeze({
  forces: 200,
  nodes: 200,
  members: 400,
  sweepPoints: 2000
})

/** How small a residual has to be, relative to the largest load, before equilibrium counts as satisfied. */
const EQUILIBRIUM_TOLERANCE = 1e-9

// ---------------------------------------------------------------- a dense float solver

/**
 * Solve a dense linear system by Gaussian elimination with partial pivoting.
 *
 * Partial pivoting is not an optimisation. Without it a structure whose first equation happens to have a tiny
 * coefficient divides by that tiny number, and the rounding error swamps the answer while still looking like an
 * answer — which is the dangerous kind of wrong.
 */
function solveDense(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] | StaticsError {
  const n = vector.length
  const a = matrix.map((row) => row.slice())
  const b = vector.slice()

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column
    let best = Math.abs(a[column][column])
    for (let row = column + 1; row < n; row += 1) {
      const candidate = Math.abs(a[row][column])
      if (candidate > best) {
        best = candidate
        pivotRow = row
      }
    }
    if (best < 1e-12) {
      return fail(
        'singular',
        'The equilibrium equations have no single answer. Usually that means the supports cannot hold the structure still, or two of them do the same job.'
      )
    }
    if (pivotRow !== column) {
      ;[a[column], a[pivotRow]] = [a[pivotRow], a[column]]
      ;[b[column], b[pivotRow]] = [b[pivotRow], b[column]]
    }
    for (let row = column + 1; row < n; row += 1) {
      const factor = a[row][column] / a[column][column]
      for (let k = column; k < n; k += 1) a[row][k] -= factor * a[column][k]
      b[row] -= factor * b[column]
    }
  }

  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row]
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * x[k]
    x[row] = sum / a[row][row]
    if (!finite(x[row])) return fail('singular', 'The equilibrium equations gave a value that is not finite.')
  }
  return x
}

// ---------------------------------------------------------------- forces and moments

export interface Force {
  /** Newtons. */
  magnitude: number
  /** Degrees anticlockwise from the +x axis. */
  angleDegrees: number
  /** Where it acts, for the moment sum. */
  x: number
  y: number
  label?: string
}

export interface Couple {
  /** Newton-metres, positive anticlockwise. */
  moment: number
  label?: string
}

export interface ResultantReport {
  /** Newtons. */
  x: number
  y: number
  magnitude: number
  /** Degrees. Null when the resultant is zero and has no direction. */
  angleDegrees: number | null
  /** Newton-metres about the chosen point, positive anticlockwise. */
  moment: number
  aboutPoint: { x: number; y: number }
  /** Where a single force equal to the resultant would have to act to give the same moment. Null when there is no resultant. */
  lineOfAction: { x: number; y: number } | null
  inEquilibrium: boolean
  notes: readonly string[]
}

/**
 * The resultant of a force system: one force and one moment about a chosen point.
 *
 * The point matters for the moment and not for the force, which is the whole reason it is an argument. Moving the
 * reference point changes the moment by the resultant times the offset — so a system with zero resultant force has
 * the same moment about every point, and one with a resultant does not.
 */
export function resultant(
  forces: readonly Force[],
  couples: readonly Couple[] = [],
  about: { x: number; y: number } = { x: 0, y: 0 }
): ResultantReport | StaticsError {
  if (forces.length + couples.length === 0) {
    return fail('invalid-argument', 'There are no forces or couples to add up.')
  }
  if (forces.length > STATICS_LIMITS.forces) {
    return fail('too-many', `That is ${forces.length} forces; this handles up to ${STATICS_LIMITS.forces}.`)
  }

  let fx = 0
  let fy = 0
  let moment = 0
  for (const [index, one] of forces.entries()) {
    if (!finite(one.magnitude) || !finite(one.angleDegrees) || !finite(one.x) || !finite(one.y)) {
      return fail('not-finite', `Force ${index + 1} has a value that is not a finite number.`)
    }
    const angle = (one.angleDegrees * Math.PI) / 180
    const cx = one.magnitude * Math.cos(angle)
    const cy = one.magnitude * Math.sin(angle)
    fx += cx
    fy += cy
    // Moment about the point: r x F, taken anticlockwise positive.
    moment += (one.x - about.x) * cy - (one.y - about.y) * cx
  }
  for (const [index, one] of couples.entries()) {
    if (!finite(one.moment)) return fail('not-finite', `Couple ${index + 1} has a moment that is not finite.`)
    moment += one.moment
  }

  const magnitude = Math.hypot(fx, fy)
  const largest = Math.max(...forces.map((one) => Math.abs(one.magnitude)), 1)
  const balanced = magnitude < largest * EQUILIBRIUM_TOLERANCE && Math.abs(moment) < largest * EQUILIBRIUM_TOLERANCE

  const notes: string[] = []
  if (magnitude < largest * 1e-12 && Math.abs(moment) > largest * 1e-9) {
    notes.push(
      'The forces cancel but the moment does not. This is a pure couple: it turns the body without pushing it anywhere, and its moment is the same about every point.'
    )
  } else if (magnitude > 0) {
    notes.push(
      'There is a net force, so the moment depends on which point you take it about. Moving the reference point changes it by the resultant times the offset.'
    )
  }

  return {
    x: fx,
    y: fy,
    magnitude,
    angleDegrees: magnitude < 1e-15 ? null : (Math.atan2(fy, fx) * 180) / Math.PI,
    moment,
    aboutPoint: about,
    // Perpendicular offset d = M/F, placed on the line through the reference point.
    lineOfAction:
      magnitude < 1e-12
        ? null
        : {
            x: about.x + (-fy * moment) / (magnitude * magnitude),
            y: about.y + (fx * moment) / (magnitude * magnitude)
          },
    inEquilibrium: balanced,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- supports and beams

export type SupportKind = 'pin' | 'roller' | 'fixed' | 'free'

export const SUPPORT_KINDS: readonly SupportKind[] = Object.freeze(['pin', 'roller', 'fixed', 'free'])

export const SUPPORT_FACTS: Readonly<Record<SupportKind, { label: string; reactions: number; describe: string }>> =
  Object.freeze({
    pin: {
      label: 'Pin',
      reactions: 2,
      describe: 'Holds the point in both directions but lets it rotate. Two unknown reaction components.'
    },
    roller: {
      label: 'Roller',
      reactions: 1,
      describe: 'Holds the point perpendicular to its surface only. One unknown, and the structure can still slide along.'
    },
    fixed: {
      label: 'Fixed',
      reactions: 3,
      describe: 'Holds position and angle. Three unknowns, and the only support that can resist a moment on its own.'
    },
    free: { label: 'Free', reactions: 0, describe: 'Holds nothing. No reaction at all.' }
  })

export interface BeamSupport {
  kind: SupportKind
  /** Distance along the beam from the left end. */
  position: number
  label?: string
}

export interface PointLoad {
  /** Newtons, positive downward. */
  magnitude: number
  position: number
  label?: string
}

export interface DistributedLoad {
  /** N/m at the start. */
  startIntensity: number
  /** N/m at the end. Equal to the start for a uniform load; different for a triangular one. */
  endIntensity: number
  start: number
  end: number
  label?: string
}

export interface AppliedMoment {
  /** Newton-metres, positive anticlockwise. */
  magnitude: number
  position: number
  label?: string
}

export interface Reaction {
  label: string
  kind: SupportKind
  position: number
  /** Newtons, positive upward. Null where the support does not resist vertical load. */
  vertical: number | null
  /** Newtons, positive to the right. Null where it does not resist horizontal load. */
  horizontal: number | null
  /** Newton-metres. Null unless the support is fixed. */
  moment: number | null
}

export interface BeamReport {
  length: number
  reactions: readonly Reaction[]
  /** The total downward load, for checking. */
  totalLoad: number
  residuals: { forceY: number; forceX: number; moment: number }
  equilibriumVerified: boolean
  /** How many reaction unknowns there were against the three equations available. */
  unknowns: number
  equations: number
  determinacy: 'determinate' | 'indeterminate' | 'mechanism'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The support reactions on a beam.
 *
 * Only statically determinate beams are solved. An indeterminate one is refused by name rather than approximated,
 * because equilibrium genuinely does not determine its reactions — you need the beam's stiffness as well, and a
 * number produced without it is a number from a different problem.
 */
export function beamReactions(input: {
  length: number
  supports: readonly BeamSupport[]
  pointLoads?: readonly PointLoad[]
  distributedLoads?: readonly DistributedLoad[]
  moments?: readonly AppliedMoment[]
}): BeamReport | StaticsError {
  const { length } = input
  if (!finite(length) || length <= 0) return fail('invalid-argument', 'The beam length has to be greater than zero.')
  const supports = input.supports.filter((one) => one.kind !== 'free')
  if (supports.length === 0) return fail('mechanism', 'The beam has no supports, so nothing holds it up.')

  const pointLoads = input.pointLoads ?? []
  const distributed = input.distributedLoads ?? []
  const moments = input.moments ?? []

  for (const [i, one] of supports.entries()) {
    if (!finite(one.position)) return fail('not-finite', `Support ${i + 1} has a position that is not finite.`)
    if (one.position < 0 || one.position > length) {
      return fail('invalid-argument', `Support ${i + 1} is at ${one.position} m, which is off a beam ${length} m long.`)
    }
  }
  for (const [i, one] of pointLoads.entries()) {
    if (!finite(one.magnitude) || !finite(one.position)) return fail('not-finite', `Load ${i + 1} has a value that is not finite.`)
    if (one.position < 0 || one.position > length) {
      return fail('invalid-argument', `Load ${i + 1} is at ${one.position} m, which is off a beam ${length} m long.`)
    }
  }
  for (const [i, one] of distributed.entries()) {
    if (!finite(one.startIntensity) || !finite(one.endIntensity) || !finite(one.start) || !finite(one.end)) {
      return fail('not-finite', `Distributed load ${i + 1} has a value that is not finite.`)
    }
    if (one.end <= one.start) return fail('invalid-argument', `Distributed load ${i + 1} ends before it starts.`)
    if (one.start < 0 || one.end > length) {
      return fail('invalid-argument', `Distributed load ${i + 1} runs outside the beam.`)
    }
  }

  // Replace each distributed load with its resultant and centroid, which is exact for a linear intensity.
  const equivalent: { magnitude: number; position: number }[] = distributed.map((one) => {
    const span = one.end - one.start
    const total = ((one.startIntensity + one.endIntensity) / 2) * span
    // Centroid of a trapezium, measured from its start.
    const offset =
      one.startIntensity + one.endIntensity === 0
        ? span / 2
        : (span * (one.startIntensity + 2 * one.endIntensity)) / (3 * (one.startIntensity + one.endIntensity))
    return { magnitude: total, position: one.start + offset }
  })

  const allVertical = [...pointLoads.map((one) => ({ magnitude: one.magnitude, position: one.position })), ...equivalent]
  const totalLoad = allVertical.reduce((sum, one) => sum + one.magnitude, 0)
  const totalMomentAboutOrigin =
    allVertical.reduce((sum, one) => sum + one.magnitude * one.position, 0) -
    moments.reduce((sum, one) => sum + one.magnitude, 0)

  // Count unknowns.
  const unknownList: { support: BeamSupport; component: 'vertical' | 'horizontal' | 'moment' }[] = []
  for (const one of supports) {
    if (one.kind === 'pin') {
      unknownList.push({ support: one, component: 'vertical' }, { support: one, component: 'horizontal' })
    } else if (one.kind === 'roller') {
      unknownList.push({ support: one, component: 'vertical' })
    } else if (one.kind === 'fixed') {
      unknownList.push(
        { support: one, component: 'vertical' },
        { support: one, component: 'horizontal' },
        { support: one, component: 'moment' }
      )
    }
  }

  const unknowns = unknownList.length
  const equations = 3
  const determinacy: BeamReport['determinacy'] =
    unknowns === equations ? 'determinate' : unknowns > equations ? 'indeterminate' : 'mechanism'

  if (determinacy === 'indeterminate') {
    return fail(
      'indeterminate',
      `There are ${unknowns} reaction unknowns and only ${equations} equilibrium equations, so this beam is statically indeterminate by ${unknowns - equations}. Equilibrium alone does not fix the reactions: the beam's stiffness decides how the load shares between the supports, and a number produced without it would be from a different problem.`,
      supports.map((one, i) => one.label ?? `support ${i + 1}`)
    )
  }
  if (determinacy === 'mechanism') {
    return fail(
      'mechanism',
      `There are only ${unknowns} reaction unknowns against ${equations} equilibrium equations, so this beam is a mechanism — it can move, and no set of reactions holds it still.`,
      supports.map((one, i) => one.label ?? `support ${i + 1}`)
    )
  }

  // Assemble the three equilibrium equations over the three unknowns.
  const matrix: number[][] = [
    new Array(unknowns).fill(0), // sum Fy
    new Array(unknowns).fill(0), // sum Fx
    new Array(unknowns).fill(0) // sum M about x = 0
  ]
  for (const [i, one] of unknownList.entries()) {
    if (one.component === 'vertical') {
      matrix[0][i] = 1
      matrix[2][i] = one.support.position
    } else if (one.component === 'horizontal') {
      matrix[1][i] = 1
    } else {
      matrix[2][i] = 1
    }
  }
  const vector = [totalLoad, 0, totalMomentAboutOrigin]

  const solved = solveDense(matrix, vector)
  if (isStaticsError(solved)) {
    return fail(
      'singular',
      'The supports cannot hold this beam. Usually that means two rollers both resist the same direction and nothing resists along the beam, or all the supports sit at one point.',
      supports.map((one, i) => one.label ?? `support ${i + 1}`)
    )
  }

  const reactions: Reaction[] = supports.map((one, i) => {
    const label = one.label ?? `support ${i + 1}`
    const pick = (component: 'vertical' | 'horizontal' | 'moment'): number | null => {
      const at = unknownList.findIndex((u) => u.support === one && u.component === component)
      return at === -1 ? null : solved[at]
    }
    return { label, kind: one.kind, position: one.position, vertical: pick('vertical'), horizontal: pick('horizontal'), moment: pick('moment') }
  })

  // Sum it all back up. This is the proof, and it costs nothing.
  const reactionVertical = reactions.reduce((sum, one) => sum + (one.vertical ?? 0), 0)
  const reactionHorizontal = reactions.reduce((sum, one) => sum + (one.horizontal ?? 0), 0)
  const reactionMoment = reactions.reduce((sum, one) => sum + (one.moment ?? 0) + (one.vertical ?? 0) * one.position, 0)
  const residuals = {
    forceY: reactionVertical - totalLoad,
    forceX: reactionHorizontal,
    moment: reactionMoment - totalMomentAboutOrigin
  }
  const scale = Math.max(Math.abs(totalLoad), 1)
  const verified =
    Math.abs(residuals.forceY) < scale * 1e-6 &&
    Math.abs(residuals.forceX) < scale * 1e-6 &&
    Math.abs(residuals.moment) < scale * Math.max(length, 1) * 1e-6

  const warnings: string[] = []
  if (!verified) {
    warnings.push('The reactions do not sum back to the loads. That is a solver problem, not a structure problem — do not trust these numbers.')
  }
  const rollersOnly = supports.every((one) => one.kind === 'roller')
  if (rollersOnly) {
    warnings.push('Every support is a roller, so nothing resists horizontal load. Any sideways force would slide the beam away.')
  }

  return {
    length,
    reactions: Object.freeze(reactions),
    totalLoad,
    residuals,
    equilibriumVerified: verified,
    unknowns,
    equations,
    determinacy,
    notes: Object.freeze([
      'Statically determinate: three equations and three unknowns, so equilibrium alone fixes the reactions without needing the stiffness.',
      `The residuals are how far the answer misses equilibrium by. They are ${Math.abs(residuals.forceY).toExponential(2)} N and ${Math.abs(residuals.moment).toExponential(2)} N*m, which is rounding rather than error.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- trusses

export interface TrussNode {
  id: string
  x: number
  y: number
  support?: SupportKind
}

export interface TrussMember {
  id: string
  from: string
  to: string
}

export interface TrussLoad {
  node: string
  /** Newtons, positive to the right. */
  x: number
  /** Newtons, positive upward. */
  y: number
}

export interface MemberForce {
  id: string
  from: string
  to: string
  /** Newtons. Positive is tension, negative is compression. */
  force: number
  state: 'tension' | 'compression' | 'zero-force'
  length: number
}

export interface TrussReport {
  members: readonly MemberForce[]
  reactions: readonly { node: string; x: number; y: number }[]
  /** Worst force imbalance at any joint. Small is the proof the answer is an answer. */
  worstJointResidual: number
  equilibriumVerified: boolean
  /** m + r against 2j, the determinacy count for a plane truss. */
  memberCount: number
  reactionCount: number
  jointCount: number
  determinacy: 'determinate' | 'indeterminate' | 'mechanism'
  zeroForceMembers: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Solve a plane truss by the method of joints, assembled as one linear system.
 *
 * Every member is assumed to be a two-force member: pin-jointed at both ends, loaded only at the joints, carrying
 * pure tension or compression. That is what makes a truss a truss, and it is also why a load applied in the middle
 * of a member breaks the model rather than merely straining it.
 *
 * Determinacy is checked first, by `m + r = 2j`. Too few members and it is a mechanism; too many and equilibrium
 * does not determine the forces. Both are refused by name.
 */
export function solveTruss(input: {
  nodes: readonly TrussNode[]
  members: readonly TrussMember[]
  loads?: readonly TrussLoad[]
}): TrussReport | StaticsError {
  const { nodes, members } = input
  const loads = input.loads ?? []
  if (nodes.length === 0) return fail('invalid-argument', 'The truss has no joints.')
  if (members.length === 0) return fail('no-members', 'The truss has no members.')
  if (nodes.length > STATICS_LIMITS.nodes) return fail('too-many', `That is ${nodes.length} joints; this solves up to ${STATICS_LIMITS.nodes}.`)
  if (members.length > STATICS_LIMITS.members) {
    return fail('too-many', `That is ${members.length} members; this solves up to ${STATICS_LIMITS.members}.`)
  }

  const byId = new Map<string, TrussNode>()
  for (const one of nodes) {
    if (!finite(one.x) || !finite(one.y)) return fail('not-finite', `Joint "${one.id}" has coordinates that are not finite.`)
    if (byId.has(one.id)) return fail('invalid-argument', `Two joints are both called "${one.id}".`)
    byId.set(one.id, one)
  }
  for (const one of members) {
    if (!byId.has(one.from)) return fail('unknown-node', `Member "${one.id}" starts at "${one.from}", which is not a joint.`, [one.id])
    if (!byId.has(one.to)) return fail('unknown-node', `Member "${one.id}" ends at "${one.to}", which is not a joint.`, [one.id])
    if (one.from === one.to) return fail('degenerate', `Member "${one.id}" starts and ends at the same joint.`, [one.id])
  }
  for (const one of loads) {
    if (!byId.has(one.node)) return fail('unknown-node', `A load is applied at "${one.node}", which is not a joint.`)
    if (!finite(one.x) || !finite(one.y)) return fail('not-finite', `The load at "${one.node}" is not finite.`)
  }

  // Reaction unknowns, in a stable order.
  const reactionUnknowns: { node: string; direction: 'x' | 'y' }[] = []
  for (const one of nodes) {
    if (one.support === 'pin') reactionUnknowns.push({ node: one.id, direction: 'x' }, { node: one.id, direction: 'y' })
    else if (one.support === 'roller') reactionUnknowns.push({ node: one.id, direction: 'y' })
    else if (one.support === 'fixed') {
      return fail(
        'invalid-argument',
        'A truss joint cannot be a fixed support: truss members carry no moment, so there is nothing for the fixity to resist. Use a pin.'
      )
    }
  }

  const unknowns = members.length + reactionUnknowns.length
  const equations = nodes.length * 2
  const determinacy: TrussReport['determinacy'] =
    unknowns === equations ? 'determinate' : unknowns > equations ? 'indeterminate' : 'mechanism'

  if (determinacy === 'indeterminate') {
    return fail(
      'indeterminate',
      `${members.length} members plus ${reactionUnknowns.length} reactions is ${unknowns} unknowns, against ${equations} joint equations. The truss is statically indeterminate by ${unknowns - equations}: equilibrium alone does not fix the member forces, and how the load shares between the extra members depends on their stiffnesses.`
    )
  }
  if (determinacy === 'mechanism') {
    return fail(
      'mechanism',
      `${members.length} members plus ${reactionUnknowns.length} reactions is only ${unknowns} unknowns against ${equations} joint equations. The truss is a mechanism — it can move, and no set of member forces holds it still.`
    )
  }

  // Two equations per joint: sum of x-components and sum of y-components.
  const index = new Map(nodes.map((one, i) => [one.id, i]))
  const matrix: number[][] = Array.from({ length: equations }, () => new Array(unknowns).fill(0))
  const vector = new Array<number>(equations).fill(0)

  const lengths = new Map<string, number>()
  for (const [m, member] of members.entries()) {
    const a = byId.get(member.from) as TrussNode
    const b = byId.get(member.to) as TrussNode
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length === 0) return fail('degenerate', `Member "${member.id}" has zero length.`, [member.id])
    lengths.set(member.id, length)
    const ux = dx / length
    const uy = dy / length
    const ai = index.get(member.from) as number
    const bi = index.get(member.to) as number
    // A member in tension pulls each joint toward the other end.
    matrix[ai * 2][m] += ux
    matrix[ai * 2 + 1][m] += uy
    matrix[bi * 2][m] -= ux
    matrix[bi * 2 + 1][m] -= uy
  }
  for (const [r, reaction] of reactionUnknowns.entries()) {
    const at = index.get(reaction.node) as number
    matrix[at * 2 + (reaction.direction === 'x' ? 0 : 1)][members.length + r] += 1
  }
  for (const one of loads) {
    const at = index.get(one.node) as number
    vector[at * 2] -= one.x
    vector[at * 2 + 1] -= one.y
  }

  const solved = solveDense(matrix, vector)
  if (isStaticsError(solved)) {
    return fail(
      'singular',
      'The truss counts as determinate but its equations have no single answer. That usually means part of it is a mechanism even though the total member count looks right — a panel with no diagonal, for instance.'
    )
  }

  const scale = Math.max(...loads.map((one) => Math.hypot(one.x, one.y)), 1)
  const memberForces: MemberForce[] = members.map((one, m) => {
    const force = solved[m]
    return {
      id: one.id,
      from: one.from,
      to: one.to,
      force,
      state: Math.abs(force) < scale * 1e-9 ? 'zero-force' : force > 0 ? 'tension' : 'compression',
      length: lengths.get(one.id) as number
    }
  })

  const reactions = reactionUnknowns.reduce<Map<string, { node: string; x: number; y: number }>>((map, one, r) => {
    const running = map.get(one.node) ?? { node: one.node, x: 0, y: 0 }
    if (one.direction === 'x') running.x = solved[members.length + r]
    else running.y = solved[members.length + r]
    map.set(one.node, running)
    return map
  }, new Map())

  // Check every joint closes.
  let worst = 0
  for (const node of nodes) {
    let sx = 0
    let sy = 0
    for (const [m, member] of members.entries()) {
      if (member.from !== node.id && member.to !== node.id) continue
      const a = byId.get(member.from) as TrussNode
      const b = byId.get(member.to) as TrussNode
      const length = lengths.get(member.id) as number
      const ux = (b.x - a.x) / length
      const uy = (b.y - a.y) / length
      const sign = member.from === node.id ? 1 : -1
      sx += sign * solved[m] * ux
      sy += sign * solved[m] * uy
    }
    const reaction = reactions.get(node.id)
    if (reaction) {
      sx += reaction.x
      sy += reaction.y
    }
    for (const one of loads) {
      if (one.node !== node.id) continue
      sx += one.x
      sy += one.y
    }
    worst = Math.max(worst, Math.hypot(sx, sy))
  }

  const zeroForce = memberForces.filter((one) => one.state === 'zero-force').map((one) => one.id)
  const notes: string[] = [
    'Every member is a two-force member: pinned at both ends and loaded only at the joints, so it carries pure tension or compression and no bending.',
    `${members.length} members plus ${reactionUnknowns.length} reactions equals ${nodes.length * 2} joint equations, so the truss is statically determinate.`
  ]
  if (zeroForce.length > 0) {
    notes.push(
      `${zeroForce.length} ${zeroForce.length === 1 ? 'member carries' : 'members carry'} no force under this loading. They are not useless: they brace the compression members against buckling and they carry load under different loadings.`
    )
  }
  const warnings: string[] = []
  if (worst > scale * 1e-6) {
    warnings.push(`The joints do not close to better than ${worst.toExponential(2)} N. That is a solver problem rather than a structure one.`)
  }

  return {
    members: Object.freeze(memberForces),
    reactions: Object.freeze([...reactions.values()]),
    worstJointResidual: worst,
    equilibriumVerified: worst < scale * 1e-6,
    memberCount: members.length,
    reactionCount: reactionUnknowns.length,
    jointCount: nodes.length,
    determinacy,
    zeroForceMembers: Object.freeze(zeroForce),
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- friction

export type FrictionRegime = 'static' | 'impending' | 'sliding'

export interface FrictionReport {
  /**
   * Newtons. What friction actually supplies, which is not the same as what it could. Signed against the driving
   * force — a block held on a slope has a negative friction force, because friction points back up it.
   */
  frictionForce: number
  /** Newtons. The most static friction could supply before it lets go. */
  maximumStatic: number
  /** Newtons. */
  normalForce: number
  regime: FrictionRegime
  /** Degrees. The slope at which it would start to slide, if that is the question. */
  angleOfRepose: number | null
  /** m/s², when it is sliding. Zero otherwise. */
  acceleration: number
  notes: readonly string[]
}

/**
 * A block on a slope: whether it moves, and what friction is doing about it.
 *
 * Static friction is not a force with a value; it is a force with a *limit*. Below the limit it supplies exactly
 * what is needed to hold things still, whatever that happens to be. A Page that computes `μN` and calls it the
 * friction force has answered a question about the limit and presented it as an answer about the force.
 */
export function blockOnSlope(input: {
  mass: number
  slopeDegrees: number
  staticCoefficient: number
  kineticCoefficient?: number
  appliedForce?: number
  appliedAngleDegrees?: number
  gravity?: number
}): FrictionReport | StaticsError {
  const { mass, slopeDegrees, staticCoefficient } = input
  const kinetic = input.kineticCoefficient ?? staticCoefficient
  const g = input.gravity ?? STANDARD_GRAVITY
  for (const [name, value] of Object.entries({ mass, slopeDegrees, staticCoefficient, kinetic, g })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (mass <= 0) return fail('invalid-argument', 'The mass has to be greater than zero.')
  if (staticCoefficient < 0 || kinetic < 0) return fail('invalid-argument', 'Friction coefficients cannot be negative.')
  if (kinetic > staticCoefficient) {
    return fail(
      'invalid-argument',
      'The kinetic coefficient is larger than the static one. That would mean it is harder to keep something sliding than to start it, which is backwards for ordinary surfaces.'
    )
  }
  if (Math.abs(slopeDegrees) >= 90) return fail('invalid-argument', 'The slope angle has to be less than 90 degrees.')

  const theta = (slopeDegrees * Math.PI) / 180
  const applied = input.appliedForce ?? 0
  const appliedAngle = ((input.appliedAngleDegrees ?? 0) * Math.PI) / 180

  // Along-slope and perpendicular components. Positive along-slope is down the slope.
  const weightAlong = mass * g * Math.sin(theta)
  const weightNormal = mass * g * Math.cos(theta)
  const appliedAlong = -applied * Math.cos(appliedAngle)
  const appliedNormal = applied * Math.sin(appliedAngle)

  const normal = weightNormal - appliedNormal
  if (normal <= 0) {
    return fail(
      'invalid-argument',
      'The applied force lifts the block off the surface, so there is no normal force and no friction. This model needs contact.'
    )
  }

  const driving = weightAlong + appliedAlong
  const maximumStatic = staticCoefficient * normal

  let regime: FrictionRegime
  let frictionForce: number
  let acceleration = 0
  if (Math.abs(driving) <= maximumStatic) {
    // Friction supplies exactly what is needed, and no more.
    regime = Math.abs(Math.abs(driving) - maximumStatic) < maximumStatic * 1e-9 ? 'impending' : 'static'
    frictionForce = -driving
  } else {
    regime = 'sliding'
    frictionForce = -Math.sign(driving) * kinetic * normal
    acceleration = (driving + frictionForce) / mass
  }

  const notes: string[] = [
    regime === 'static'
      ? `It stays put. Friction is supplying ${Math.abs(frictionForce).toFixed(3)} N, which is what is needed — not the ${maximumStatic.toFixed(3)} N it could supply. Static friction has a limit, not a value.`
      : regime === 'impending'
        ? 'It is exactly on the point of slipping. Any more and it goes.'
        : `It slides. Once moving, friction drops to the kinetic value, which is why something often lurches the moment it starts.`
  ]
  if (applied === 0) {
    notes.push('The angle of repose is where the slope alone is enough: tan of it equals the static coefficient, and the mass drops out entirely.')
  }

  return {
    frictionForce,
    maximumStatic,
    normalForce: normal,
    regime,
    angleOfRepose: applied === 0 ? (Math.atan(staticCoefficient) * 180) / Math.PI : null,
    acceleration,
    notes: Object.freeze(notes)
  }
}

export interface BeltFrictionReport {
  /** Newtons. The larger tension, on the side being pulled. */
  tightSide: number
  /** Newtons. */
  slackSide: number
  ratio: number
  /** Radians. */
  wrapAngle: number
  coefficient: number
  /** Newtons. The most it can transmit before it slips. */
  maximumTransmitted: number
  notes: readonly string[]
}

/**
 * Belt or rope friction round a drum: the capstan equation.
 *
 * The tension ratio grows exponentially with the wrap angle, which is why a couple of turns round a bollard lets
 * one person hold a ship. Two turns is 4π radians, and with a coefficient of 0.3 that is a ratio of about 43,000.
 */
export function beltFriction(input: {
  slackTension: number
  wrapAngleDegrees?: number
  wrapTurns?: number
  coefficient: number
}): BeltFrictionReport | StaticsError {
  const { slackTension, coefficient } = input
  if (!finite(slackTension) || slackTension <= 0) return fail('invalid-argument', 'The slack tension has to be greater than zero.')
  if (!finite(coefficient) || coefficient < 0) return fail('invalid-argument', 'The friction coefficient cannot be negative.')
  const hasDegrees = input.wrapAngleDegrees !== undefined
  const hasTurns = input.wrapTurns !== undefined
  if (hasDegrees === hasTurns) {
    return fail('invalid-argument', 'Give the wrap as an angle in degrees or as a number of turns — one of the two.')
  }
  const wrap = hasTurns ? (input.wrapTurns as number) * 2 * Math.PI : ((input.wrapAngleDegrees as number) * Math.PI) / 180
  if (!finite(wrap) || wrap < 0) return fail('invalid-argument', 'The wrap angle has to be zero or positive.')

  const ratio = Math.exp(coefficient * wrap)
  const tight = slackTension * ratio
  return {
    tightSide: tight,
    slackSide: slackTension,
    ratio,
    wrapAngle: wrap,
    coefficient,
    maximumTransmitted: tight - slackTension,
    notes: Object.freeze([
      `The tension ratio is ${ratio.toFixed(2)}, and it grows exponentially with the wrap. Adding a turn multiplies it again rather than adding to it.`,
      'The drum radius does not appear anywhere. Only the angle wrapped and the friction coefficient matter, which is why a thin post works as well as a thick one.'
    ])
  }
}

// ---------------------------------------------------------------- centroids

export interface AreaPiece {
  area: number
  /** Centroid of this piece. */
  x: number
  y: number
  /** Second moment about this piece's own centroid, for the parallel-axis step. */
  ixx?: number
  iyy?: number
  label?: string
  /** True for a hole, which subtracts rather than adds. */
  hole?: boolean
}

export interface CentroidReport {
  totalArea: number
  x: number
  y: number
  /** Second moment of area about the composite centroid, when every piece supplied its own. */
  ixx: number | null
  iyy: number | null
  pieces: readonly { label: string; area: number; x: number; y: number; hole: boolean }[]
  notes: readonly string[]
}

/**
 * The centroid of a composite area, and its second moment if every piece brought one.
 *
 * The parallel-axis theorem is where this stops being bookkeeping: a piece's contribution is its own second moment
 * *plus* its area times the square of how far its centroid is from the composite one. Forgetting the second term
 * is the most common mistake in the subject and it always reads low.
 */
export function compositeArea(pieces: readonly AreaPiece[]): CentroidReport | StaticsError {
  if (pieces.length === 0) return fail('invalid-argument', 'There are no pieces to combine.')
  if (pieces.length > 128) return fail('too-many', 'That is more than the 128 pieces this combines.')

  let totalArea = 0
  let momentX = 0
  let momentY = 0
  const listed: { label: string; area: number; x: number; y: number; hole: boolean }[] = []

  for (const [i, one] of pieces.entries()) {
    if (!finite(one.area) || !finite(one.x) || !finite(one.y)) {
      return fail('not-finite', `Piece ${i + 1} has a value that is not finite.`)
    }
    if (one.area <= 0) return fail('invalid-argument', `Piece ${i + 1} has an area of ${one.area}. Use the "hole" flag to subtract, not a negative area.`)
    const sign = one.hole ? -1 : 1
    totalArea += sign * one.area
    momentX += sign * one.area * one.x
    momentY += sign * one.area * one.y
    listed.push({ label: one.label ?? `piece ${i + 1}`, area: one.area, x: one.x, y: one.y, hole: one.hole === true })
  }

  if (Math.abs(totalArea) < 1e-15) {
    return fail('degenerate', 'The holes remove exactly as much area as the solid pieces add, so there is no section left and no centroid to find.')
  }
  if (totalArea < 0) {
    return fail('invalid-argument', 'The holes remove more area than the solid pieces provide, which describes no real section.')
  }

  const cx = momentX / totalArea
  const cy = momentY / totalArea

  // Second moments only if every piece brought its own; otherwise the parallel-axis sum would be missing terms.
  const everyPieceHasI = pieces.every((one) => one.ixx !== undefined && one.iyy !== undefined)
  let ixx: number | null = null
  let iyy: number | null = null
  if (everyPieceHasI) {
    ixx = 0
    iyy = 0
    for (const one of pieces) {
      const sign = one.hole ? -1 : 1
      // Parallel axis: I about the composite centroid = I about its own + A*d^2.
      ixx += sign * ((one.ixx as number) + one.area * Math.pow(one.y - cy, 2))
      iyy += sign * ((one.iyy as number) + one.area * Math.pow(one.x - cx, 2))
    }
  }

  const notes: string[] = [
    'The centroid is the area-weighted average position. Holes subtract, which pulls it away from them.'
  ]
  if (everyPieceHasI) {
    notes.push(
      "Second moments use the parallel-axis theorem: each piece contributes its own plus its area times the square of its distance from the composite centroid. Leaving out that second term is the usual mistake and it always reads low."
    )
  } else {
    notes.push('No second moment was calculated because not every piece supplied its own. A partial parallel-axis sum would be missing terms rather than approximate.')
  }

  return {
    totalArea,
    x: cx,
    y: cy,
    ixx,
    iyy,
    pieces: Object.freeze(listed),
    notes: Object.freeze(notes)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const STATICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Nothing is moving and nothing is accelerating. These are equilibrium equations, and they say nothing about what happens if that stops being true.',
  'Bodies are rigid. Deflection does not change where the loads act, which stops being true for slender things under large loads.',
  'Truss members are pin-jointed two-force members carrying no bending. A load applied along a member breaks the model rather than merely straining it.',
  'Only statically determinate structures are solved. An indeterminate one needs stiffness as well as equilibrium and is refused rather than approximated.',
  'Friction coefficients are constants. Real ones depend on surface finish, contamination, speed and how long the surfaces have been in contact.'
])
