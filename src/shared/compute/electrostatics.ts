/**
 * Charges, the fields they make, the potential that goes with it, and what a capacitor does with both.
 *
 * The shared electrostatics engine for Orbis Pages. Everything here is a closed form over point charges and
 * idealised geometry: superposition is a sum, not an integral, and a continuous charge distribution is approximated
 * by the points a Page hands over rather than by pretending to integrate something it was never given.
 *
 * ## Field and potential are not two views of one number
 *
 * The field is a vector and adds as vectors; the potential is a scalar and adds as scalars. Two equal and opposite
 * charges either side of a point give **zero potential and a field that is very much not zero** — the contributions
 * cancel in the sum that has signs and reinforce in the sum that has directions. A Page that computes one and
 * scales it into the other is wrong at exactly the places that are interesting, so both are computed from the
 * charges every time and neither is derived from the other.
 *
 * ## The dielectric question that has two answers
 *
 * Slide a dielectric into a charged capacitor and what happens depends on something the slab cannot see: whether
 * the plates are still wired to the source.
 *
 * ```
 * held at fixed voltage   ->  V constant, C rises, Q rises, energy rises   (the source does work)
 * isolated after charging ->  Q constant, C rises, V falls, energy falls   (the slab is pulled in)
 * ```
 *
 * Both are correct; they are answers to different questions. `withDielectric` requires the condition and refuses to
 * guess, because a Page that picks one silently teaches the wrong half of the experiment.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * field        vs  force        -- the field is there with no test charge; the force needs one
 * potential    vs  potential energy -- joules per coulomb against joules; the charge is the difference
 * potential    vs  field        -- scalar sum against vector sum; they vanish at different places
 * capacitance  vs  charge       -- geometry against what is currently stored on it
 * permittivity vs  dielectric constant -- absolute against the ratio to vacuum
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { COULOMB_CONSTANT, VACUUM_PERMITTIVITY } from './emConstants.ts'

export interface ElectrostaticsError {
  error: 'invalid-argument' | 'not-finite' | 'coincident' | 'too-many' | 'no-charges' | 'needs-condition'
  message: string
}

export const isElectrostaticsError = (value: unknown): value is ElectrostaticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ElectrostaticsError['error'], message: string): ElectrostaticsError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

/** How close two points may be before the inverse-square law stops meaning anything. */
const TOUCHING = 1e-12

// ---------------------------------------------------------------- charges

export interface PointCharge {
  /** Coulombs. Signed: negative is a negative charge, not a smaller one. */
  charge: number
  x: number
  y: number
  /** Optional, so a Page can say which contribution is which. */
  label?: string
}

export interface Point {
  x: number
  y: number
}

export interface FieldVector {
  x: number
  y: number
  /** Newtons per coulomb, which is the same unit as volts per metre. */
  magnitude: number
  /** Radians, measured anticlockwise from the +x axis. Null when the field is exactly zero and has no direction. */
  direction: number | null
}

/** One charge's share of the field at a point, so a Page can show where a total came from. */
export interface Contribution {
  label: string
  charge: number
  distance: number
  field: FieldVector
  potential: number
}

export interface FieldReport {
  at: Point
  field: FieldVector
  /** Volts. The scalar sum, computed from the charges rather than from the field above. */
  potential: number
  contributions: readonly Contribution[]
  notes: readonly string[]
}

const MAX_CHARGES = 200

/**
 * The field and the potential at one point, from any number of point charges.
 *
 * Both are summed independently over the same charges. That is deliberate and is the whole reason this function
 * returns them together: the interesting points are the ones where the two disagree about whether anything is
 * happening, and a Page can only show that if neither was derived from the other.
 */
export function fieldAt(charges: readonly PointCharge[], at: Point): FieldReport | ElectrostaticsError {
  if (charges.length === 0) return fail('no-charges', 'There are no charges, so there is no field to report.')
  if (charges.length > MAX_CHARGES) {
    return fail('too-many', `There are ${charges.length} charges; this works with up to ${MAX_CHARGES}.`)
  }
  if (!finite(at.x) || !finite(at.y)) return fail('not-finite', 'The point has to have finite coordinates.')

  let fx = 0
  let fy = 0
  let potential = 0
  const contributions: Contribution[] = []

  for (const [index, one] of charges.entries()) {
    if (!finite(one.charge) || !finite(one.x) || !finite(one.y)) {
      return fail('not-finite', `Charge ${index + 1} has a value that is not a finite number.`)
    }
    const dx = at.x - one.x
    const dy = at.y - one.y
    const distance = Math.hypot(dx, dy)
    if (distance < TOUCHING) {
      return fail(
        'coincident',
        `The point is on top of ${one.label ?? `charge ${index + 1}`}. The field of a point charge has no value at the charge itself.`
      )
    }
    // E = kq/r², pointing away from a positive charge. The sign of the charge carries the direction.
    const strength = (COULOMB_CONSTANT * one.charge) / (distance * distance)
    const ex = (strength * dx) / distance
    const ey = (strength * dy) / distance
    const v = (COULOMB_CONSTANT * one.charge) / distance
    fx += ex
    fy += ey
    potential += v
    contributions.push({
      label: one.label ?? `charge ${index + 1}`,
      charge: one.charge,
      distance,
      field: vectorOf(ex, ey),
      potential: v
    })
  }

  const field = vectorOf(fx, fy)
  const notes: string[] = []
  if (field.magnitude < 1e-9 && Math.abs(potential) > 1e-9) {
    notes.push(
      'The field cancels here but the potential does not. The vectors point opposite ways and add to nothing; the scalars have the same sign and add up.'
    )
  }
  if (Math.abs(potential) < 1e-9 && field.magnitude > 1e-9) {
    notes.push(
      'The potential is zero here but the field is not. Equal and opposite contributions cancel in the scalar sum while their vectors both push the same way.'
    )
  }
  return { at, field, potential, contributions, notes: Object.freeze(notes) }
}

function vectorOf(x: number, y: number): FieldVector {
  const magnitude = Math.hypot(x, y)
  return { x, y, magnitude, direction: magnitude < 1e-30 ? null : Math.atan2(y, x) }
}

/**
 * The force a test charge feels at a point.
 *
 * Separate from `fieldAt` on purpose. The field exists whether or not anything is there to feel it; the force needs
 * a charge to act on, and a Page that conflates them cannot explain what a field is.
 */
export interface ForceReport {
  field: FieldVector
  testCharge: number
  force: FieldVector
  /** Joules. The work done bringing this charge in from infinitely far away. */
  potentialEnergy: number
  notes: readonly string[]
}

export function forceOn(
  charges: readonly PointCharge[],
  at: Point,
  testCharge: number
): ForceReport | ElectrostaticsError {
  if (!finite(testCharge)) return fail('not-finite', 'The test charge has to be a finite number of coulombs.')
  const report = fieldAt(charges, at)
  if (isElectrostaticsError(report)) return report
  const force = vectorOf(report.field.x * testCharge, report.field.y * testCharge)
  const notes: string[] = []
  if (testCharge < 0) {
    notes.push('The charge is negative, so the force points against the field rather than along it.')
  }
  return {
    field: report.field,
    testCharge,
    force,
    potentialEnergy: testCharge * report.potential,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- sampling a region

export interface GridSpec {
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** Points across. */
  columns: number
  /** Points down. */
  rows: number
}

export interface GridSample {
  x: number
  y: number
  /** Null where the sample landed on a charge, which has no field rather than an infinite one. */
  field: FieldVector | null
  potential: number | null
}

export interface GridReport {
  spec: GridSpec
  samples: readonly GridSample[]
  /** The largest finite magnitude found, so a Page can scale arrows without a second pass. */
  maxMagnitude: number
  /** The range of finite potentials, for contour levels. */
  minPotential: number
  maxPotential: number
  skipped: number
  notes: readonly string[]
}

const MAX_GRID = 10_000

/**
 * The field and potential over a rectangle, for arrows, magnitude maps and equipotential contours.
 *
 * Points that land on a charge come back null rather than as a huge number. A grid that reports 10²⁰ V/m at the
 * cell containing the charge makes every other arrow on the page invisible, and the value is not physical anyway —
 * the point-charge model simply has nothing to say there.
 */
export function fieldGrid(charges: readonly PointCharge[], spec: GridSpec): GridReport | ElectrostaticsError {
  if (charges.length === 0) return fail('no-charges', 'There are no charges, so there is no field to sample.')
  const columns = Math.round(spec.columns)
  const rows = Math.round(spec.rows)
  if (!Number.isInteger(columns) || columns < 2 || !Number.isInteger(rows) || rows < 2) {
    return fail('invalid-argument', 'A grid needs at least two points in each direction.')
  }
  if (columns * rows > MAX_GRID) {
    return fail('too-many', `That grid is ${columns * rows} points; this samples up to ${MAX_GRID}.`)
  }
  if (!finite(spec.minX) || !finite(spec.maxX) || !finite(spec.minY) || !finite(spec.maxY)) {
    return fail('not-finite', 'The grid bounds have to be finite.')
  }
  if (spec.maxX <= spec.minX || spec.maxY <= spec.minY) {
    return fail('invalid-argument', 'The grid has to have a positive width and height.')
  }

  const samples: GridSample[] = []
  let maxMagnitude = 0
  let minPotential = Number.POSITIVE_INFINITY
  let maxPotential = Number.NEGATIVE_INFINITY
  let skipped = 0

  for (let row = 0; row < rows; row += 1) {
    const y = spec.minY + ((spec.maxY - spec.minY) * row) / (rows - 1)
    for (let column = 0; column < columns; column += 1) {
      const x = spec.minX + ((spec.maxX - spec.minX) * column) / (columns - 1)
      const report = fieldAt(charges, { x, y })
      if (isElectrostaticsError(report)) {
        skipped += 1
        samples.push({ x, y, field: null, potential: null })
        continue
      }
      maxMagnitude = Math.max(maxMagnitude, report.field.magnitude)
      minPotential = Math.min(minPotential, report.potential)
      maxPotential = Math.max(maxPotential, report.potential)
      samples.push({ x, y, field: report.field, potential: report.potential })
    }
  }

  const notes: string[] = []
  if (skipped > 0) {
    notes.push(
      `${skipped} ${skipped === 1 ? 'point sits' : 'points sit'} on a charge and ${skipped === 1 ? 'has' : 'have'} no value. A point charge has no field at its own position, rather than an enormous one.`
    )
  }
  return {
    spec: { ...spec, columns, rows },
    samples,
    maxMagnitude,
    minPotential: Number.isFinite(minPotential) ? minPotential : 0,
    maxPotential: Number.isFinite(maxPotential) ? maxPotential : 0,
    skipped,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- field lines

export interface FieldLine {
  from: string
  points: readonly Point[]
  /** Why the trace stopped: it reached a charge, left the region, or ran out of steps. */
  ended: 'charge' | 'boundary' | 'steps'
}

const MAX_LINE_STEPS = 4000

/**
 * Field lines, traced by following the field rather than drawn to look like it.
 *
 * Each line starts on a small circle around a charge and steps along the local direction. Lines leave positive
 * charges and enter negative ones, which is why the step direction carries the sign: a line traced the wrong way
 * from a negative charge runs off to infinity and draws a picture of nothing.
 */
export function fieldLines(
  charges: readonly PointCharge[],
  options: { linesPerCharge?: number; step?: number; bounds?: GridSpec } = {}
): readonly FieldLine[] | ElectrostaticsError {
  if (charges.length === 0) return fail('no-charges', 'There are no charges, so there are no field lines.')
  const perCharge = Math.round(options.linesPerCharge ?? 12)
  if (!Number.isInteger(perCharge) || perCharge < 1 || perCharge > 64) {
    return fail('invalid-argument', 'Lines per charge has to be a whole number between 1 and 64.')
  }
  const spread = extentOf(charges)
  const step = options.step ?? spread / 200
  if (!finite(step) || step <= 0) return fail('invalid-argument', 'The step has to be a positive distance.')
  const bounds = options.bounds ?? {
    minX: spread * -1.5,
    maxX: spread * 1.5,
    minY: spread * -1.5,
    maxY: spread * 1.5,
    columns: 2,
    rows: 2
  }

  const lines: FieldLine[] = []
  for (const [index, source] of charges.entries()) {
    if (Math.abs(source.charge) < 1e-30) continue
    const outward = source.charge > 0 ? 1 : -1
    const start = step * 2
    for (let n = 0; n < perCharge; n += 1) {
      const angle = (2 * Math.PI * n) / perCharge
      let x = source.x + start * Math.cos(angle)
      let y = source.y + start * Math.sin(angle)
      const points: Point[] = [{ x, y }]
      let ended: FieldLine['ended'] = 'steps'
      for (let s = 0; s < MAX_LINE_STEPS; s += 1) {
        const report = fieldAt(charges, { x, y })
        if (isElectrostaticsError(report)) {
          ended = 'charge'
          break
        }
        if (report.field.magnitude < 1e-30) {
          ended = 'steps'
          break
        }
        x += (outward * step * report.field.x) / report.field.magnitude
        y += (outward * step * report.field.y) / report.field.magnitude
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
          ended = 'boundary'
          break
        }
        points.push({ x, y })
        if (nearAnyCharge(charges, x, y, step)) {
          ended = 'charge'
          break
        }
      }
      lines.push({ from: source.label ?? `charge ${index + 1}`, points, ended })
    }
  }
  return Object.freeze(lines)
}

function extentOf(charges: readonly PointCharge[]): number {
  let widest = 0
  for (const one of charges) widest = Math.max(widest, Math.abs(one.x), Math.abs(one.y))
  return widest > 0 ? widest * 2 : 1
}

function nearAnyCharge(charges: readonly PointCharge[], x: number, y: number, step: number): boolean {
  for (const one of charges) {
    if (Math.hypot(x - one.x, y - one.y) < step * 1.5) return true
  }
  return false
}

// ---------------------------------------------------------------- work and potential difference

export interface WorkReport {
  fromPotential: number
  toPotential: number
  /** Volts. Conventionally V(to) − V(from). */
  potentialDifference: number
  charge: number
  /** Joules done by the field on the charge as it moves. */
  workByField: number
  /** Joules an outside agent has to supply, which is the negative of the above. */
  workAgainstField: number
  notes: readonly string[]
}

/**
 * The work moving a charge between two points.
 *
 * Path-independent, which is the whole content of calling this field conservative: only the endpoints appear in the
 * calculation, and a Page offering to choose a route is offering a choice that changes nothing.
 */
export function workBetween(
  charges: readonly PointCharge[],
  from: Point,
  to: Point,
  charge: number
): WorkReport | ElectrostaticsError {
  if (!finite(charge)) return fail('not-finite', 'The charge has to be a finite number of coulombs.')
  const start = fieldAt(charges, from)
  if (isElectrostaticsError(start)) return start
  const end = fieldAt(charges, to)
  if (isElectrostaticsError(end)) return end
  const difference = end.potential - start.potential
  const workByField = -charge * difference
  return {
    fromPotential: start.potential,
    toPotential: end.potential,
    potentialDifference: difference,
    charge,
    workByField,
    workAgainstField: -workByField,
    notes: Object.freeze([
      'Only the two endpoints matter. The electrostatic field is conservative, so every route between them takes the same work.'
    ])
  }
}

// ---------------------------------------------------------------- dipole

export interface DipoleReport {
  /** Coulomb-metres, pointing from the negative charge toward the positive one. */
  momentMagnitude: number
  separation: number
  charge: number
  notes: readonly string[]
}

/** A dipole reduced to its moment, which is the only thing about it that matters far away. */
export function dipole(charge: number, separation: number): DipoleReport | ElectrostaticsError {
  if (!finite(charge) || !finite(separation)) return fail('not-finite', 'Charge and separation both have to be finite.')
  if (separation <= 0) return fail('invalid-argument', 'The separation has to be a positive distance.')
  return {
    momentMagnitude: Math.abs(charge) * separation,
    separation,
    charge: Math.abs(charge),
    notes: Object.freeze([
      'Far from the pair the field falls off as 1/r³ rather than 1/r², because the two charges nearly cancel and what is left is the difference between them.'
    ])
  }
}

// ---------------------------------------------------------------- capacitance

export type CapacitorShape = 'parallel-plate' | 'cylindrical' | 'spherical'

export const CAPACITOR_SHAPES: readonly CapacitorShape[] = Object.freeze([
  'parallel-plate',
  'cylindrical',
  'spherical'
])

export const CAPACITOR_FACTS: Readonly<
  Record<CapacitorShape, { label: string; formula: string; assumes: string }>
> = Object.freeze({
  'parallel-plate': {
    label: 'Parallel plate',
    formula: 'C = εA/d',
    assumes:
      'The plates are much wider than they are apart, so the field between them is uniform and the fringing at the edges is small enough to ignore.'
  },
  cylindrical: {
    label: 'Cylindrical',
    formula: 'C = 2πεL / ln(b/a)',
    assumes: 'The cylinder is long compared with its radius, so the ends contribute little.'
  },
  spherical: {
    label: 'Spherical',
    formula: 'C = 4πε·ab/(b−a)',
    assumes: 'Both shells are concentric and the inner one carries the charge.'
  }
})

export interface Capacitor {
  shape: CapacitorShape
  /** Farads. */
  capacitance: number
  /** The relative permittivity of whatever is between the conductors. 1 is vacuum. */
  dielectricConstant: number
  /** F/m. The absolute permittivity, which is what the formula actually uses. */
  permittivity: number
  geometry: Readonly<Record<string, number>>
  formula: string
  assumes: string
  notes: readonly string[]
}

/** A parallel-plate capacitor from its geometry. */
export function parallelPlate(input: {
  area: number
  separation: number
  dielectricConstant?: number
}): Capacitor | ElectrostaticsError {
  const k = input.dielectricConstant ?? 1
  const check = checkGeometry({ area: input.area, separation: input.separation, dielectricConstant: k })
  if (check) return check
  const permittivity = k * VACUUM_PERMITTIVITY
  const capacitance = (permittivity * input.area) / input.separation
  const notes: string[] = []
  const width = Math.sqrt(input.area)
  if (width < input.separation * 10) {
    notes.push(
      'The plates are not much wider than the gap between them, so the fringing field at the edges is a real part of this capacitor and the uniform-field formula will read low.'
    )
  }
  return {
    shape: 'parallel-plate',
    capacitance,
    dielectricConstant: k,
    permittivity,
    geometry: Object.freeze({ area: input.area, separation: input.separation }),
    formula: CAPACITOR_FACTS['parallel-plate'].formula,
    assumes: CAPACITOR_FACTS['parallel-plate'].assumes,
    notes: Object.freeze(notes)
  }
}

/** A cylindrical capacitor: two coaxial conductors. */
export function cylindricalCapacitor(input: {
  innerRadius: number
  outerRadius: number
  length: number
  dielectricConstant?: number
}): Capacitor | ElectrostaticsError {
  const k = input.dielectricConstant ?? 1
  const check = checkGeometry({
    innerRadius: input.innerRadius,
    outerRadius: input.outerRadius,
    length: input.length,
    dielectricConstant: k
  })
  if (check) return check
  if (input.outerRadius <= input.innerRadius) {
    return fail('invalid-argument', 'The outer radius has to be larger than the inner one.')
  }
  const permittivity = k * VACUUM_PERMITTIVITY
  const capacitance = (2 * Math.PI * permittivity * input.length) / Math.log(input.outerRadius / input.innerRadius)
  return {
    shape: 'cylindrical',
    capacitance,
    dielectricConstant: k,
    permittivity,
    geometry: Object.freeze({
      innerRadius: input.innerRadius,
      outerRadius: input.outerRadius,
      length: input.length
    }),
    formula: CAPACITOR_FACTS.cylindrical.formula,
    assumes: CAPACITOR_FACTS.cylindrical.assumes,
    notes: Object.freeze([])
  }
}

/** A spherical capacitor: two concentric shells. */
export function sphericalCapacitor(input: {
  innerRadius: number
  outerRadius: number
  dielectricConstant?: number
}): Capacitor | ElectrostaticsError {
  const k = input.dielectricConstant ?? 1
  const check = checkGeometry({
    innerRadius: input.innerRadius,
    outerRadius: input.outerRadius,
    dielectricConstant: k
  })
  if (check) return check
  if (input.outerRadius <= input.innerRadius) {
    return fail('invalid-argument', 'The outer radius has to be larger than the inner one.')
  }
  const permittivity = k * VACUUM_PERMITTIVITY
  const capacitance =
    (4 * Math.PI * permittivity * input.innerRadius * input.outerRadius) / (input.outerRadius - input.innerRadius)
  return {
    shape: 'spherical',
    capacitance,
    dielectricConstant: k,
    permittivity,
    geometry: Object.freeze({ innerRadius: input.innerRadius, outerRadius: input.outerRadius }),
    formula: CAPACITOR_FACTS.spherical.formula,
    assumes: CAPACITOR_FACTS.spherical.assumes,
    notes: Object.freeze([])
  }
}

function checkGeometry(values: Record<string, number>): ElectrostaticsError | null {
  for (const [name, value] of Object.entries(values)) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (values.dielectricConstant !== undefined && values.dielectricConstant < 1) {
    return fail(
      'invalid-argument',
      'A dielectric constant below 1 would mean the material stores less than vacuum, which no ordinary insulator does.'
    )
  }
  return null
}

// ---------------------------------------------------------------- what is on a capacitor

export interface CapacitorState {
  capacitance: number
  /** Volts across it. */
  voltage: number
  /** Coulombs on each plate, equal and opposite. */
  charge: number
  /** Joules. */
  energy: number
  /** V/m between the plates, for a parallel-plate geometry. Null for the others. */
  fieldStrength: number | null
  notes: readonly string[]
}

/**
 * The charge, energy and field on a capacitor, given any one of voltage or charge.
 *
 * Exactly one: `Q = CV` fixes the other, and taking both would let a Page describe a capacitor that cannot exist.
 */
export function capacitorState(
  capacitor: Capacitor,
  input: { voltage?: number; charge?: number }
): CapacitorState | ElectrostaticsError {
  const hasVoltage = input.voltage !== undefined
  const hasCharge = input.charge !== undefined
  if (hasVoltage === hasCharge) {
    return fail(
      'invalid-argument',
      hasVoltage
        ? 'Give the voltage or the charge, not both. Q = CV fixes one from the other, and a pair that disagrees describes no real capacitor.'
        : 'Give either the voltage across it or the charge on it.'
    )
  }
  const voltage = hasVoltage ? (input.voltage as number) : (input.charge as number) / capacitor.capacitance
  const charge = hasCharge ? (input.charge as number) : (input.voltage as number) * capacitor.capacitance
  if (!finite(voltage) || !finite(charge)) return fail('not-finite', 'That gives a value that is not finite.')
  const energy = 0.5 * capacitor.capacitance * voltage * voltage
  const separation = capacitor.geometry.separation
  return {
    capacitance: capacitor.capacitance,
    voltage,
    charge,
    energy,
    fieldStrength: capacitor.shape === 'parallel-plate' && separation ? voltage / separation : null,
    notes: Object.freeze([
      'The energy is ½CV², not QV. Charging happens a little at a time against a voltage that is rising, so the average voltage the charge crossed was half the final one.'
    ])
  }
}

// ---------------------------------------------------------------- dielectrics

export type DielectricCondition = 'connected' | 'isolated'

export const DIELECTRIC_CONDITIONS: readonly DielectricCondition[] = Object.freeze(['connected', 'isolated'])

export interface DielectricReport {
  condition: DielectricCondition
  dielectricConstant: number
  before: CapacitorState
  after: CapacitorState
  changes: Readonly<Record<'capacitance' | 'voltage' | 'charge' | 'energy', number>>
  held: 'voltage' | 'charge'
  explain: string
  notes: readonly string[]
}

/**
 * Sliding a dielectric in, which does two different things depending on the wiring.
 *
 * The condition is required rather than defaulted. Both answers below are right, they contradict each other on
 * three of the four quantities, and which one a Page shows is decided by something outside the slab entirely.
 *
 * ```
 * connected   V held   C×k   Q×k    U×k      the source pushes more charge on
 * isolated    Q held   C×k   V/k    U/k      nothing can move, so the voltage drops
 * ```
 */
export function withDielectric(
  capacitor: Capacitor,
  start: { voltage?: number; charge?: number },
  dielectricConstant: number,
  condition: DielectricCondition
): DielectricReport | ElectrostaticsError {
  if (!finite(dielectricConstant)) return fail('not-finite', 'The dielectric constant has to be a finite number.')
  if (dielectricConstant < 1) {
    return fail(
      'invalid-argument',
      'A dielectric constant below 1 would store less than vacuum, which no ordinary insulator does.'
    )
  }
  if (condition !== 'connected' && condition !== 'isolated') {
    return fail(
      'needs-condition',
      'Say whether the capacitor is still connected to the source or was isolated after charging. The slab does the same thing either way; the circuit does not, and the answers differ on voltage, charge and energy.'
    )
  }
  const before = capacitorState(capacitor, start)
  if (isElectrostaticsError(before)) return before

  const newCapacitance = capacitor.capacitance * dielectricConstant
  const after =
    condition === 'connected'
      ? capacitorState({ ...capacitor, capacitance: newCapacitance }, { voltage: before.voltage })
      : capacitorState({ ...capacitor, capacitance: newCapacitance }, { charge: before.charge })
  if (isElectrostaticsError(after)) return after

  const explain =
    condition === 'connected'
      ? 'Still wired to the source, so the voltage cannot change. The capacitance rises, the source pushes extra charge on to hold the voltage, and the stored energy rises with it — the source did that work.'
      : 'Isolated after charging, so the charge has nowhere to go. The capacitance rises, the voltage falls to match, and the stored energy falls — the slab was pulled in and the field did that work on it.'

  return {
    condition,
    dielectricConstant,
    before,
    after,
    changes: Object.freeze({
      capacitance: after.capacitance / before.capacitance,
      voltage: before.voltage === 0 ? 1 : after.voltage / before.voltage,
      charge: before.charge === 0 ? 1 : after.charge / before.charge,
      energy: before.energy === 0 ? 1 : after.energy / before.energy
    }),
    held: condition === 'connected' ? 'voltage' : 'charge',
    explain,
    notes: Object.freeze([
      'Only the capacitance changes the same way in both cases. Everything else depends on which quantity the circuit was holding still.'
    ])
  }
}

// ---------------------------------------------------------------- capacitors together

export interface CombinationReport {
  arrangement: 'series' | 'parallel'
  capacitances: readonly number[]
  total: number
  /** How the supply voltage divides, for series; all equal for parallel. */
  voltages: readonly number[]
  charges: readonly number[]
  notes: readonly string[]
}

/**
 * Capacitors in series or parallel.
 *
 * The reciprocal rule for series catches people because it is the opposite way round from resistors. The reason is
 * geometric rather than algebraic: capacitors in series behave like one capacitor with the gaps added up, and a
 * wider gap stores less.
 */
export function combine(
  capacitances: readonly number[],
  arrangement: 'series' | 'parallel',
  supplyVoltage: number
): CombinationReport | ElectrostaticsError {
  if (capacitances.length === 0) return fail('invalid-argument', 'There are no capacitors to combine.')
  if (capacitances.length > 64) return fail('too-many', 'That is more than the 64 capacitors this handles.')
  for (const [index, one] of capacitances.entries()) {
    if (!finite(one)) return fail('not-finite', `Capacitor ${index + 1} is not a finite number of farads.`)
    if (one <= 0) return fail('invalid-argument', `Capacitor ${index + 1} has to be greater than zero farads.`)
  }
  if (!finite(supplyVoltage)) return fail('not-finite', 'The supply voltage has to be finite.')

  if (arrangement === 'parallel') {
    const total = capacitances.reduce((sum, one) => sum + one, 0)
    return {
      arrangement,
      capacitances,
      total,
      voltages: capacitances.map(() => supplyVoltage),
      charges: capacitances.map((one) => one * supplyVoltage),
      notes: Object.freeze([
        'In parallel every capacitor has the whole supply voltage across it, and the plate areas effectively add, so the capacitances add.'
      ])
    }
  }

  const reciprocal = capacitances.reduce((sum, one) => sum + 1 / one, 0)
  const total = 1 / reciprocal
  const charge = total * supplyVoltage
  return {
    arrangement,
    capacitances,
    total,
    // Same charge on every one, so the voltage divides in inverse proportion to capacitance.
    voltages: capacitances.map((one) => charge / one),
    charges: capacitances.map(() => charge),
    notes: Object.freeze([
      'In series every capacitor carries the same charge, and the total is smaller than the smallest one — the opposite of resistors, because adding capacitors in series is like widening the gap.'
    ])
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const ELECTROSTATICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Charges are points and are not moving. Nothing here is valid once they accelerate, which is where radiation starts.',
  'Superposition holds: every field is the sum of the fields each charge would make alone.',
  'The medium is uniform and linear. A dielectric is one number, not a material that saturates or breaks down.',
  'Capacitor formulas assume ideal geometry and ignore fringing at the edges unless the note says otherwise.'
])
