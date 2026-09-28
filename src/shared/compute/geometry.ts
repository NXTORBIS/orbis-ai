/**
 * Geometry: construction, measurement, transformation and the relationships between them.
 *
 * Everything is computed from coordinates. Nothing is decided by how a figure looks -- a triangle is right-angled
 * because the dot product of two of its sides is zero, not because it appears to be, and three points are collinear
 * because the cross product of their differences is zero within a tolerance that is stated.
 *
 * ## Why there is a tolerance at all
 *
 * Exact geometry needs exact arithmetic, and the moment a construction involves a circle it involves a square root.
 * So the predicates here are numerical, and each takes its tolerance relative to the size of the figure: absolute
 * tolerance is wrong for a drawing measured in microns and equally wrong for one measured in kilometres.
 *
 * ## Degenerate cases
 *
 * Three collinear points do not have a circumcircle; two parallel lines do not meet; a polygon that crosses itself
 * has no well-defined interior. Each of these is answered as itself rather than as a very large number or a
 * silently wrong result -- which is what a formula applied without the check produces.
 */

export interface GeometryError {
  error: string
  message: string
}

export const isGeometryError = (value: unknown): value is GeometryError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): GeometryError => ({ error, message })

export const GEOMETRY_LIMITS: Readonly<Record<'points' | 'vertices' | 'iterations' | 'objects', number>> = Object.freeze({
  points: 200_000,
  vertices: 10_000,
  iterations: 10_000,
  objects: 5_000
})

// ---------------------------------------------------------------- points and vectors

export interface Point2 {
  x: number
  y: number
}

export interface Point3 {
  x: number
  y: number
  z: number
}

export const point = (x: number, y: number): Point2 => ({ x, y })
export const point3 = (x: number, y: number, z: number): Point3 => ({ x, y, z })

export const subtract2 = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y })
export const add2 = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y })
export const scale2 = (a: Point2, factor: number): Point2 => ({ x: a.x * factor, y: a.y * factor })
export const dot2 = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y
/** The scalar cross product in two dimensions: the signed area of the parallelogram, which is what orientation uses. */
export const cross2 = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x
export const length2 = (a: Point2): number => Math.hypot(a.x, a.y)

export const subtract3 = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const add3 = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const scale3 = (a: Point3, factor: number): Point3 => ({ x: a.x * factor, y: a.y * factor, z: a.z * factor })
export const dot3 = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross3 = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})
export const length3 = (a: Point3): number => Math.hypot(a.x, a.y, a.z)

/** The scalar triple product: the signed volume of the parallelepiped, and zero exactly when the three are coplanar. */
export const tripleProduct = (a: Point3, b: Point3, c: Point3): number => dot3(a, cross3(b, c))

export const distance2 = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const distance3 = (a: Point3, b: Point3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export const midpoint2 = (a: Point2, b: Point2): Point2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * The point dividing a segment in a given ratio.
 *
 * `t = 0` is `a` and `t = 1` is `b`; outside that the point is on the extended line, which is often what was wanted
 * and is allowed rather than clamped.
 */
export const divideSegment = (a: Point2, b: Point2, t: number): Point2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
})

/** A tolerance scaled to the figure. Absolute tolerance is wrong for microns and equally wrong for kilometres. */
export const toleranceFor = (...values: number[]): number => {
  let scale = 1
  for (const value of values) scale = Math.max(scale, Math.abs(value))
  return scale * 1e-12
}

// ---------------------------------------------------------------- lines

/** A line as a point and a direction. Handles vertical lines, which a slope-intercept form cannot. */
export interface Line2 {
  through: Point2
  direction: Point2
}

export interface LineError {
  error: string
  message: string
}

export function lineThrough(a: Point2, b: Point2): Line2 | GeometryError {
  const direction = subtract2(b, a)
  if (length2(direction) <= toleranceFor(a.x, a.y, b.x, b.y)) {
    return fail('degenerate', 'Those two points are the same, so they do not determine a line. Any line through one of them passes through the other.')
  }
  return { through: a, direction }
}

/** The general form `ax + by + c = 0`, normalised so that `a^2 + b^2 = 1` and distances come out directly. */
export function generalForm(line: Line2): { a: number; b: number; c: number } {
  const norm = length2(line.direction)
  const a = -line.direction.y / norm
  const b = line.direction.x / norm
  return { a, b, c: -(a * line.through.x + b * line.through.y) }
}

/** The slope, or `null` for a vertical line -- which is a real answer rather than an infinity to work around. */
export function slopeOf(line: Line2): number | null {
  if (Math.abs(line.direction.x) <= toleranceFor(line.direction.x, line.direction.y)) return null
  return line.direction.y / line.direction.x
}

export type LineRelation = 'parallel' | 'perpendicular' | 'intersecting' | 'coincident'

export interface LineRelationship {
  relation: LineRelation
  /** Where they meet, for two lines that do. */
  at: Point2 | null
  angle: number
  describe: string
}

/**
 * How two lines relate.
 *
 * Coincident is distinguished from parallel, because they are different: parallel lines never meet and coincident
 * lines meet everywhere. Reporting "parallel, no intersection" for two copies of the same line is wrong in the way
 * that matters.
 */
export function relateLines(a: Line2, b: Line2): LineRelationship {
  const determinant = cross2(a.direction, b.direction)
  const tolerance = toleranceFor(a.direction.x, a.direction.y, b.direction.x, b.direction.y) * Math.max(length2(a.direction), length2(b.direction))

  const cosine = Math.abs(dot2(a.direction, b.direction)) / (length2(a.direction) * length2(b.direction))
  const angle = Math.acos(Math.min(1, Math.max(0, cosine)))

  if (Math.abs(determinant) <= tolerance) {
    // Parallel. Coincident when a point of one lies on the other.
    const offset = subtract2(b.through, a.through)
    const across = Math.abs(cross2(a.direction, offset)) / length2(a.direction)
    if (across <= toleranceFor(offset.x, offset.y, a.through.x, a.through.y) * 1e3) {
      return { relation: 'coincident', at: null, angle: 0, describe: 'The two lines are the same line. They meet at every point, not at none.' }
    }
    return { relation: 'parallel', at: null, angle: 0, describe: `The lines are parallel and ${Number(across.toPrecision(6))} apart, so they never meet.` }
  }

  const offset = subtract2(b.through, a.through)
  const t = cross2(offset, b.direction) / determinant
  const at = add2(a.through, scale2(a.direction, t))

  const perpendicular = Math.abs(dot2(a.direction, b.direction)) <= tolerance
  return {
    relation: perpendicular ? 'perpendicular' : 'intersecting',
    at,
    angle,
    describe: perpendicular
      ? `The lines are perpendicular: the dot product of their directions is zero. They meet at (${Number(at.x.toPrecision(6))}, ${Number(at.y.toPrecision(6))}).`
      : `The lines meet at (${Number(at.x.toPrecision(6))}, ${Number(at.y.toPrecision(6))}) at an angle of ${Number(((angle * 180) / Math.PI).toPrecision(6))} degrees.`
  }
}

/** The perpendicular distance from a point to a line. */
export function distanceToLine(from: Point2, line: Line2): number {
  const offset = subtract2(from, line.through)
  return Math.abs(cross2(line.direction, offset)) / length2(line.direction)
}

/** The closest point on a line, and on a segment where the closest point may be an endpoint. */
export function closestOnLine(from: Point2, line: Line2, asSegment = false): Point2 {
  const offset = subtract2(from, line.through)
  let t = dot2(offset, line.direction) / dot2(line.direction, line.direction)
  // On a segment the nearest point can be an endpoint, which is the whole difference between the two cases.
  if (asSegment) t = Math.max(0, Math.min(1, t))
  return add2(line.through, scale2(line.direction, t))
}

/** Whether three points lie on a line, by the cross product of their differences. */
export function collinear(a: Point2, b: Point2, c: Point2): boolean {
  const area = cross2(subtract2(b, a), subtract2(c, a))
  const scale = Math.max(distance2(a, b), distance2(b, c), distance2(a, c))
  return Math.abs(area) <= scale * scale * 1e-12
}

/** Which side of the line `ab` the point `c` is on. Zero means on it. */
export const orientation = (a: Point2, b: Point2, c: Point2): number => cross2(subtract2(b, a), subtract2(c, a))

// ---------------------------------------------------------------- angles

export interface AngleResult {
  radians: number
  degrees: number
  /** A recognised exact value where the angle is one, as text. `null` where it is not. */
  exact: string | null
  kind: 'acute' | 'right' | 'obtuse' | 'straight' | 'zero' | 'reflex'
}

const KNOWN_ANGLES: { radians: number; text: string }[] = [
  { radians: 0, text: '0' },
  { radians: Math.PI / 6, text: 'pi/6' },
  { radians: Math.PI / 4, text: 'pi/4' },
  { radians: Math.PI / 3, text: 'pi/3' },
  { radians: Math.PI / 2, text: 'pi/2' },
  { radians: (2 * Math.PI) / 3, text: '2pi/3' },
  { radians: (3 * Math.PI) / 4, text: '3pi/4' },
  { radians: (5 * Math.PI) / 6, text: '5pi/6' },
  { radians: Math.PI, text: 'pi' }
]

/** The angle at `vertex` between the rays to `a` and `b`, recognised as an exact value where it is one. */
export function angleAt(vertex: Point2, a: Point2, b: Point2): AngleResult | GeometryError {
  const first = subtract2(a, vertex)
  const second = subtract2(b, vertex)
  const lengths = length2(first) * length2(second)
  if (lengths <= toleranceFor(vertex.x, vertex.y, a.x, a.y, b.x, b.y)) {
    return fail('degenerate', 'One of the rays has no length, so there is no angle between them.')
  }

  const radians = Math.acos(Math.min(1, Math.max(-1, dot2(first, second) / lengths)))
  return describeAngle(radians)
}

export function describeAngle(radians: number): AngleResult {
  const degrees = (radians * 180) / Math.PI
  const known = KNOWN_ANGLES.find((one) => Math.abs(one.radians - radians) < 1e-9)
  const kind: AngleResult['kind'] =
    Math.abs(radians) < 1e-12
      ? 'zero'
      : Math.abs(radians - Math.PI / 2) < 1e-9
        ? 'right'
        : Math.abs(radians - Math.PI) < 1e-9
          ? 'straight'
          : radians > Math.PI
            ? 'reflex'
            : radians < Math.PI / 2
              ? 'acute'
              : 'obtuse'
  return { radians, degrees, exact: known?.text ?? null, kind }
}

// ---------------------------------------------------------------- triangles

export type TriangleKind = 'equilateral' | 'isosceles' | 'scalene'
export type TriangleAngleKind = 'acute' | 'right' | 'obtuse' | 'degenerate'

export interface Triangle {
  a: Point2
  b: Point2
  c: Point2
}

export interface TriangleFacts {
  sides: { a: number; b: number; c: number }
  angles: { a: AngleResult; b: AngleResult; c: AngleResult }
  perimeter: number
  area: number
  kind: TriangleKind
  angleKind: TriangleAngleKind
  centroid: Point2
  circumcentre: Point2 | null
  incentre: Point2
  orthocentre: Point2 | null
  circumradius: number | null
  inradius: number
  degenerate: boolean
  describe: string
}

/**
 * Everything about a triangle, from its coordinates.
 *
 * The classification comes from measurement and not from appearance. A triangle is right-angled when one angle is a
 * right angle to within a tolerance scaled to the figure, and the area comes from the cross product rather than from
 * Heron's formula -- which subtracts nearly equal numbers for a thin triangle and loses most of the answer.
 */
export function triangleFacts(triangle: Triangle): TriangleFacts | GeometryError {
  const { a, b, c } = triangle
  const sideA = distance2(b, c)
  const sideB = distance2(a, c)
  const sideC = distance2(a, b)
  const scale = Math.max(sideA, sideB, sideC)
  if (scale <= 0) return fail('degenerate', 'All three vertices are the same point, so there is no triangle.')

  // The cross product: exact for a degenerate triangle, and stable for a thin one where Heron's formula is not.
  const twiceArea = cross2(subtract2(b, a), subtract2(c, a))
  const area = Math.abs(twiceArea) / 2
  const degenerate = area <= scale * scale * 1e-12

  const angleA = angleAt(a, b, c)
  const angleB = angleAt(b, a, c)
  const angleC = angleAt(c, a, b)
  if (isGeometryError(angleA) || isGeometryError(angleB) || isGeometryError(angleC)) {
    return fail('degenerate', 'Two of the vertices are the same point, so the triangle has no angles at them.')
  }

  const equal = (x: number, y: number): boolean => Math.abs(x - y) <= scale * 1e-9
  const kind: TriangleKind =
    equal(sideA, sideB) && equal(sideB, sideC) ? 'equilateral' : equal(sideA, sideB) || equal(sideB, sideC) || equal(sideA, sideC) ? 'isosceles' : 'scalene'

  const largest = Math.max(angleA.radians, angleB.radians, angleC.radians)
  const angleKind: TriangleAngleKind = degenerate
    ? 'degenerate'
    : Math.abs(largest - Math.PI / 2) < 1e-9
      ? 'right'
      : largest > Math.PI / 2
        ? 'obtuse'
        : 'acute'

  const centroid = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
  const perimeter = sideA + sideB + sideC
  const incentre = {
    x: (sideA * a.x + sideB * b.x + sideC * c.x) / perimeter,
    y: (sideA * a.y + sideB * b.y + sideC * c.y) / perimeter
  }

  let circumcentre: Point2 | null = null
  let circumradius: number | null = null
  let orthocentre: Point2 | null = null
  if (!degenerate) {
    const d = 2 * twiceArea
    const aa = a.x * a.x + a.y * a.y
    const bb = b.x * b.x + b.y * b.y
    const cc = c.x * c.x + c.y * c.y
    circumcentre = {
      x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
      y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d
    }
    circumradius = distance2(circumcentre, a)
    // On the Euler line: the orthocentre is three times the centroid minus twice the circumcentre.
    orthocentre = {
      x: 3 * centroid.x - 2 * circumcentre.x,
      y: 3 * centroid.y - 2 * circumcentre.y
    }
  }

  return {
    sides: { a: sideA, b: sideB, c: sideC },
    angles: { a: angleA, b: angleB, c: angleC },
    perimeter,
    area,
    kind,
    angleKind,
    centroid,
    circumcentre,
    incentre,
    orthocentre,
    circumradius,
    inradius: perimeter > 0 ? (2 * area) / perimeter : 0,
    degenerate,
    describe: degenerate
      ? 'The three points lie on a line, so this is a degenerate triangle: it has no area, no circumcircle and no orthocentre.'
      : `A ${kind} ${angleKind}-angled triangle with area ${Number(area.toPrecision(6))} and perimeter ${Number(perimeter.toPrecision(6))}. The classification comes from the measured sides and angles, not from how it looks.`
  }
}

export interface Construction {
  triangles: Triangle[]
  count: number
  describe: string
}

/**
 * A triangle from two sides and a non-included angle, which is the ambiguous case.
 *
 * Side-side-angle can give two triangles, one, or none, and which it gives depends on the numbers. Returning one
 * without saying so is how a student gets half the answer and no reason to suspect it. All of them are returned.
 */
export function constructSsa(sideA: number, sideB: number, angleA: number): Construction | GeometryError {
  if (!(sideA > 0) || !(sideB > 0)) return fail('invalid-argument', 'Both sides have to be positive lengths.')
  if (!(angleA > 0) || angleA >= Math.PI) return fail('invalid-argument', 'The angle has to be between 0 and pi.')

  // The law of sines: sin(B) = b sin(A) / a.
  const sineB = (sideB * Math.sin(angleA)) / sideA
  if (sineB > 1 + 1e-12) {
    return {
      triangles: [],
      count: 0,
      describe: `No triangle exists: the side opposite the given angle is too short to reach. The law of sines would need sin(B) = ${Number(sineB.toPrecision(6))}, which is above one.`
    }
  }

  const build = (angleB: number): Triangle | null => {
    const angleC = Math.PI - angleA - angleB
    if (angleC <= 1e-12) return null
    const sideC = (sideA * Math.sin(angleC)) / Math.sin(angleA)
    // Placed with A at the origin and B along the x-axis, which is a choice of position and not of shape.
    return { a: point(0, 0), b: point(sideC, 0), c: point(sideB * Math.cos(angleA), sideB * Math.sin(angleA)) }
  }

  const first = Math.asin(Math.min(1, sineB))
  const triangles: Triangle[] = []
  const one = build(first)
  if (one) triangles.push(one)
  const second = Math.PI - first
  if (Math.abs(second - first) > 1e-9) {
    const other = build(second)
    if (other) triangles.push(other)
  }

  return {
    triangles,
    count: triangles.length,
    describe:
      triangles.length === 2
        ? 'Two different triangles fit these measurements. Side-side-angle does not determine a triangle: the angle opposite the second side can be acute or obtuse, and both give a valid triangle.'
        : triangles.length === 1
          ? 'Exactly one triangle fits these measurements.'
          : 'No triangle fits these measurements.'
  }
}

// ---------------------------------------------------------------- circles

export interface Circle {
  centre: Point2
  radius: number
}

/**
 * The circle through three points, or the reason there is none.
 *
 * Three collinear points have no circumcircle. The formula divides by twice the signed area, so without the check it
 * returns a centre at infinity or, worse, an enormous finite centre from rounding -- which looks like an answer.
 */
export function circleThrough(a: Point2, b: Point2, c: Point2): Circle | GeometryError {
  if (collinear(a, b, c)) {
    return fail(
      'collinear',
      'Those three points lie on a line, so no circle passes through all of them. A line can be thought of as a circle of infinite radius, but there is no centre to give.'
    )
  }
  const facts = triangleFacts({ a, b, c })
  if (isGeometryError(facts)) return facts
  if (facts.circumcentre === null || facts.circumradius === null) {
    return fail('collinear', 'Those three points do not determine a circle.')
  }
  return { centre: facts.circumcentre, radius: facts.circumradius }
}

export type CircleRelation = 'separate' | 'touching-outside' | 'intersecting' | 'touching-inside' | 'contained' | 'identical'

export interface CircleIntersection {
  relation: CircleRelation
  points: Point2[]
  distance: number
  describe: string
}

/** Where two circles meet. All six relationships are distinguished, because they mean different things. */
export function intersectCircles(a: Circle, b: Circle): CircleIntersection | GeometryError {
  if (a.radius < 0 || b.radius < 0) return fail('invalid-argument', 'A radius cannot be negative.')
  const d = distance2(a.centre, b.centre)
  const tolerance = toleranceFor(a.radius, b.radius, d) * 1e4

  if (d <= tolerance && Math.abs(a.radius - b.radius) <= tolerance) {
    return { relation: 'identical', points: [], distance: d, describe: 'The two circles are the same circle; they meet at every point of it rather than at a finite number.' }
  }
  if (d > a.radius + b.radius + tolerance) {
    return { relation: 'separate', points: [], distance: d, describe: `The circles are ${Number((d - a.radius - b.radius).toPrecision(6))} apart and do not meet.` }
  }
  if (Math.abs(d - (a.radius + b.radius)) <= tolerance) {
    const at = add2(a.centre, scale2(subtract2(b.centre, a.centre), a.radius / d))
    return { relation: 'touching-outside', points: [at], distance: d, describe: 'The circles touch at exactly one point, from outside each other.' }
  }
  if (d < Math.abs(a.radius - b.radius) - tolerance) {
    return { relation: 'contained', points: [], distance: d, describe: 'One circle lies entirely inside the other without touching it.' }
  }
  if (Math.abs(d - Math.abs(a.radius - b.radius)) <= tolerance) {
    const direction = d === 0 ? point(1, 0) : scale2(subtract2(b.centre, a.centre), 1 / d)
    const at = add2(a.centre, scale2(direction, a.radius))
    return { relation: 'touching-inside', points: [at], distance: d, describe: 'The circles touch at exactly one point, one inside the other.' }
  }

  // The radical line: the two intersections are symmetric about the line of centres.
  const along = (d * d - b.radius * b.radius + a.radius * a.radius) / (2 * d)
  const across = Math.sqrt(Math.max(0, a.radius * a.radius - along * along))
  const unit = scale2(subtract2(b.centre, a.centre), 1 / d)
  const foot = add2(a.centre, scale2(unit, along))
  const perpendicular = point(-unit.y, unit.x)

  return {
    relation: 'intersecting',
    points: [add2(foot, scale2(perpendicular, across)), add2(foot, scale2(perpendicular, -across))],
    distance: d,
    describe: 'The circles cross at two points.'
  }
}

/** Where a line meets a circle: two points, one (a tangent), or none. */
export function intersectLineCircle(line: Line2, circle: Circle): { points: Point2[]; tangent: boolean; describe: string } {
  const offset = subtract2(line.through, circle.centre)
  const a = dot2(line.direction, line.direction)
  const b = 2 * dot2(offset, line.direction)
  const c = dot2(offset, offset) - circle.radius * circle.radius
  const discriminant = b * b - 4 * a * c
  const tolerance = toleranceFor(circle.radius, a, b, c) * 1e6

  if (discriminant < -tolerance) {
    return { points: [], tangent: false, describe: `The line misses the circle; it passes ${Number((distanceToLine(circle.centre, line) - circle.radius).toPrecision(6))} outside it.` }
  }
  if (Math.abs(discriminant) <= tolerance) {
    const t = -b / (2 * a)
    return { points: [add2(line.through, scale2(line.direction, t))], tangent: true, describe: 'The line is tangent to the circle: it touches at exactly one point.' }
  }
  const root = Math.sqrt(discriminant)
  return {
    points: [
      add2(line.through, scale2(line.direction, (-b + root) / (2 * a))),
      add2(line.through, scale2(line.direction, (-b - root) / (2 * a)))
    ],
    tangent: false,
    describe: 'The line cuts the circle at two points.'
  }
}

/** The tangent lines from a point to a circle. Two from outside, one from on it, none from inside. */
export function tangentsFrom(from: Point2, circle: Circle): { points: Point2[]; describe: string } {
  const d = distance2(from, circle.centre)
  const tolerance = toleranceFor(d, circle.radius) * 1e4

  if (d < circle.radius - tolerance) {
    return { points: [], describe: 'The point is inside the circle, so no tangent from it touches the circle. Every line through it cuts the circle twice.' }
  }
  if (Math.abs(d - circle.radius) <= tolerance) {
    return { points: [from], describe: 'The point is on the circle, so there is exactly one tangent there, touching at the point itself.' }
  }

  // The tangent points lie on a circle of diameter from the centre to the external point.
  const half = midpoint2(from, circle.centre)
  const helper: Circle = { centre: half, radius: d / 2 }
  const found = intersectCircles(circle, helper)
  if (isGeometryError(found)) return { points: [], describe: found.message }
  return { points: found.points, describe: `There are two tangents from that point, touching the circle at the two points returned. Each has length ${Number(Math.sqrt(d * d - circle.radius * circle.radius).toPrecision(6))}.` }
}

// ---------------------------------------------------------------- conics

export type ConicKind = 'circle' | 'ellipse' | 'parabola' | 'hyperbola' | 'degenerate'

export interface ConicFacts {
  kind: ConicKind
  centre: Point2 | null
  /** Semi-major and semi-minor, for an ellipse; semi-transverse and semi-conjugate for a hyperbola. */
  axes: { major: number; minor: number } | null
  eccentricity: number | null
  foci: Point2[]
  directrices: number[]
  vertices: Point2[]
  asymptotes: { slope: number; intercept: number }[]
  describe: string
}

/**
 * What a general conic `Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0` is.
 *
 * The discriminant `B^2 - 4AC` decides the type, which is the point of writing it in general form. Degenerate cases
 * -- a pair of lines, a single point, nothing at all -- come out of the same test and are named rather than being
 * forced into one of the three real kinds.
 */
export function classifyConic(A: number, B: number, C: number, D: number, E: number, F: number): ConicFacts {
  const discriminant = B * B - 4 * A * C
  const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C), 1)
  const tolerance = scale * scale * 1e-12

  // The determinant of the full matrix: zero means the conic degenerates into lines or a point.
  const determinant =
    A * (C * F - (E / 2) * (E / 2)) - (B / 2) * ((B / 2) * F - (E / 2) * (D / 2)) + (D / 2) * ((B / 2) * (E / 2) - C * (D / 2))

  if (Math.abs(determinant) <= tolerance * Math.max(1, Math.abs(F))) {
    return {
      kind: 'degenerate',
      centre: null,
      axes: null,
      eccentricity: null,
      foci: [],
      directrices: [],
      vertices: [],
      asymptotes: [],
      describe: 'This is a degenerate conic: a pair of lines, a single point, or nothing at all, rather than a curve. The determinant of its matrix is zero.'
    }
  }

  if (Math.abs(discriminant) <= tolerance) {
    // A parabola has no centre; its vertex is found from the axis.
    return {
      kind: 'parabola',
      centre: null,
      axes: null,
      eccentricity: 1,
      foci: [],
      directrices: [],
      vertices: [],
      asymptotes: [],
      describe: 'The discriminant B^2 - 4AC is zero, so this is a parabola. Its eccentricity is exactly one, which is what distinguishes it from an ellipse or a hyperbola.'
    }
  }

  // Centre from the partial derivatives being zero.
  const centre = {
    x: (2 * C * D - B * E) / discriminant,
    y: (2 * A * E - B * D) / discriminant
  }

  if (discriminant > 0) {
    const asymptotes: { slope: number; intercept: number }[] = []
    // The asymptotes have the slopes of the quadratic's own factorisation.
    if (Math.abs(C) > tolerance) {
      const root = Math.sqrt(discriminant)
      for (const sign of [1, -1]) {
        const slope = (-B + sign * root) / (2 * C)
        asymptotes.push({ slope, intercept: centre.y - slope * centre.x })
      }
    }
    return {
      kind: 'hyperbola',
      centre,
      axes: null,
      eccentricity: null,
      foci: [],
      directrices: [],
      vertices: [],
      asymptotes,
      describe: 'The discriminant B^2 - 4AC is positive, so this is a hyperbola. It has two branches and two asymptotes the branches approach without reaching.'
    }
  }

  // An ellipse. Axes from the eigenvalues of the quadratic part, after translating to the centre.
  const shifted = A * centre.x * centre.x + B * centre.x * centre.y + C * centre.y * centre.y + D * centre.x + E * centre.y + F
  const trace = A + C
  const gap = Math.sqrt((A - C) * (A - C) + B * B)
  const first = (trace + gap) / 2
  const second = (trace - gap) / 2
  if (first === 0 || second === 0 || shifted === 0) {
    return { kind: 'degenerate', centre, axes: null, eccentricity: null, foci: [], directrices: [], vertices: [], asymptotes: [], describe: 'The conic degenerates to a point.' }
  }

  const semiA = Math.sqrt(Math.abs(shifted / second))
  const semiB = Math.sqrt(Math.abs(shifted / first))
  const major = Math.max(semiA, semiB)
  const minor = Math.min(semiA, semiB)
  const circle = Math.abs(major - minor) <= major * 1e-9
  const focal = Math.sqrt(Math.max(0, major * major - minor * minor))
  const eccentricity = major > 0 ? focal / major : 0

  return {
    kind: circle ? 'circle' : 'ellipse',
    centre,
    axes: { major, minor },
    eccentricity,
    // Placed along the axis the semi-major belongs to; for an unrotated conic that is the x-axis when A < C.
    foci:
      circle || focal === 0
        ? []
        : semiA >= semiB
          ? [point(centre.x - focal, centre.y), point(centre.x + focal, centre.y)]
          : [point(centre.x, centre.y - focal), point(centre.x, centre.y + focal)],
    directrices: circle || eccentricity === 0 ? [] : [centre.x - major / eccentricity, centre.x + major / eccentricity],
    vertices:
      semiA >= semiB
        ? [point(centre.x - major, centre.y), point(centre.x + major, centre.y)]
        : [point(centre.x, centre.y - major), point(centre.x, centre.y + major)],
    asymptotes: [],
    describe: circle
      ? `The discriminant is negative and the axes are equal, so this is a circle of radius ${Number(major.toPrecision(6))}.`
      : `The discriminant B^2 - 4AC is negative, so this is an ellipse with semi-axes ${Number(major.toPrecision(6))} and ${Number(minor.toPrecision(6))}, and eccentricity ${Number(eccentricity.toPrecision(6))}.`
  }
}

// ---------------------------------------------------------------- polygons

export interface PolygonFacts {
  area: number
  /** Positive when the vertices run anticlockwise. The sign is information, not something to discard. */
  signedArea: number
  perimeter: number
  centroid: Point2
  convex: boolean
  selfIntersecting: boolean
  orientation: 'clockwise' | 'anticlockwise' | 'degenerate'
  interiorAngles: number[]
  describe: string
}

/**
 * Everything about a polygon, by the shoelace formula.
 *
 * Self-intersection is checked first, because a polygon that crosses itself has no well-defined interior: the
 * shoelace formula still returns a number, and that number is the difference of the signed regions rather than an
 * area. Returning it without the warning would be returning something that is not what was asked for.
 */
export function polygonFacts(vertices: readonly Point2[]): PolygonFacts | GeometryError {
  if (vertices.length < 3) return fail('degenerate', 'A polygon needs at least three vertices.')
  if (vertices.length > GEOMETRY_LIMITS.vertices) return fail('too-large', `A polygon is limited to ${GEOMETRY_LIMITS.vertices.toLocaleString('en')} vertices.`)

  const n = vertices.length
  let twiceSigned = 0
  let perimeter = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % n]
    const cross = a.x * b.y - b.x * a.y
    twiceSigned += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
    perimeter += distance2(a, b)
  }

  const signedArea = twiceSigned / 2
  const area = Math.abs(signedArea)
  const scale = perimeter / n

  const selfIntersecting = hasSelfIntersection(vertices)

  // Convexity: every turn has the same sign.
  let positive = 0
  let negative = 0
  const interiorAngles: number[] = []
  for (let i = 0; i < n; i++) {
    const previous = vertices[(i + n - 1) % n]
    const current = vertices[i]
    const next = vertices[(i + 1) % n]
    const turn = orientation(previous, current, next)
    if (turn > scale * scale * 1e-12) positive += 1
    else if (turn < -scale * scale * 1e-12) negative += 1
    const angle = angleAt(current, previous, next)
    interiorAngles.push(isGeometryError(angle) ? Number.NaN : angle.radians)
  }
  const convex = !selfIntersecting && (positive === 0 || negative === 0)

  const centroid =
    Math.abs(twiceSigned) > 0
      ? { x: cx / (3 * twiceSigned), y: cy / (3 * twiceSigned) }
      : { x: vertices.reduce((sum, one) => sum + one.x, 0) / n, y: vertices.reduce((sum, one) => sum + one.y, 0) / n }

  return {
    area,
    signedArea,
    perimeter,
    centroid,
    convex,
    selfIntersecting,
    orientation: Math.abs(signedArea) <= scale * scale * 1e-12 ? 'degenerate' : signedArea > 0 ? 'anticlockwise' : 'clockwise',
    interiorAngles,
    describe: selfIntersecting
      ? 'This polygon crosses itself, so it has no well-defined interior. The area reported is what the shoelace formula gives, which for a crossing polygon is the difference of the signed regions rather than an area.'
      : `A ${convex ? 'convex' : 'concave'} polygon with ${n} vertices, area ${Number(area.toPrecision(6))} and perimeter ${Number(perimeter.toPrecision(6))}. The vertices run ${signedArea > 0 ? 'anticlockwise' : 'clockwise'}.`
  }
}

function hasSelfIntersection(vertices: readonly Point2[]): boolean {
  const n = vertices.length
  // Quadratic, which is fine up to the vertex limit and avoids a sweep-line's own edge cases.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share an endpoint and are not a crossing.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue
      if (segmentsCross(vertices[i], vertices[(i + 1) % n], vertices[j], vertices[(j + 1) % n])) return true
    }
  }
  return false
}

/** Whether two closed segments cross, including the touching cases. */
export function segmentsCross(a1: Point2, a2: Point2, b1: Point2, b2: Point2): boolean {
  const d1 = orientation(b1, b2, a1)
  const d2 = orientation(b1, b2, a2)
  const d3 = orientation(a1, a2, b1)
  const d4 = orientation(a1, a2, b2)
  const scale = Math.max(distance2(a1, a2), distance2(b1, b2))
  const tolerance = scale * scale * 1e-12

  if (
    ((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance)) &&
    ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance))
  ) {
    return true
  }
  // Collinear overlap: the endpoints of one lie inside the other.
  const onSegment = (p: Point2, q: Point2, r: Point2): boolean =>
    Math.abs(orientation(p, q, r)) <= tolerance &&
    r.x >= Math.min(p.x, q.x) - tolerance &&
    r.x <= Math.max(p.x, q.x) + tolerance &&
    r.y >= Math.min(p.y, q.y) - tolerance &&
    r.y <= Math.max(p.y, q.y) + tolerance

  return onSegment(b1, b2, a1) || onSegment(b1, b2, a2) || onSegment(a1, a2, b1) || onSegment(a1, a2, b2)
}

export type Containment = 'inside' | 'outside' | 'on-boundary'

/**
 * Whether a point is inside a polygon, by the ray-crossing rule.
 *
 * The boundary is checked first and answered separately. A point exactly on an edge is neither inside nor outside in
 * any useful sense, and the crossing count for it depends on rounding -- so answering it as one or the other would be
 * answering it differently on different runs.
 */
export function containsPoint(vertices: readonly Point2[], at: Point2): Containment {
  const n = vertices.length
  const scale = Math.max(...vertices.map((one) => Math.max(Math.abs(one.x), Math.abs(one.y))), 1)
  const tolerance = scale * 1e-12

  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % n]
    const closest = closestOnLine(at, { through: a, direction: subtract2(b, a) }, true)
    if (distance2(closest, at) <= tolerance * 1e3) return 'on-boundary'
  }

  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = vertices[i]
    const b = vertices[j]
    // The half-open comparison is what makes a ray passing exactly through a vertex count once rather than twice.
    if (a.y > at.y !== b.y > at.y && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside ? 'inside' : 'outside'
}

/** A regular polygon's measurements, from its side count and circumradius. */
export function regularPolygon(sides: number, circumradius: number): { vertices: Point2[]; area: number; perimeter: number; interiorAngle: AngleResult; apothem: number } | GeometryError {
  if (!Number.isInteger(sides) || sides < 3) return fail('invalid-argument', 'A regular polygon needs at least three sides.')
  if (sides > GEOMETRY_LIMITS.vertices) return fail('too-large', 'That is more sides than a polygon can hold.')
  if (!(circumradius > 0)) return fail('invalid-argument', 'The circumradius has to be positive.')

  const vertices = Array.from({ length: sides }, (_, i) => {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2
    return point(circumradius * Math.cos(angle), circumradius * Math.sin(angle))
  })
  const side = 2 * circumradius * Math.sin(Math.PI / sides)
  const apothem = circumradius * Math.cos(Math.PI / sides)

  return {
    vertices,
    area: (sides * side * apothem) / 2,
    perimeter: sides * side,
    interiorAngle: describeAngle(((sides - 2) * Math.PI) / sides),
    apothem
  }
}

// ---------------------------------------------------------------- transformations

/** A 2D affine transformation as a 3x3 matrix in row-major order. */
export interface Transform2 {
  m: [number, number, number, number, number, number, number, number, number]
  describe: string
}

export const identityTransform = (): Transform2 => ({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], describe: 'identity' })

export const translation = (dx: number, dy: number): Transform2 => ({
  m: [1, 0, dx, 0, 1, dy, 0, 0, 1],
  describe: `translation by (${dx}, ${dy})`
})

export const rotation = (radians: number, about: Point2 = point(0, 0)): Transform2 => {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  // Translate to the origin, rotate, translate back -- composed into one matrix.
  return {
    m: [c, -s, about.x - c * about.x + s * about.y, s, c, about.y - s * about.x - c * about.y, 0, 0, 1],
    describe: `rotation by ${Number(((radians * 180) / Math.PI).toPrecision(6))} degrees about (${about.x}, ${about.y})`
  }
}

export const scaling = (sx: number, sy: number, about: Point2 = point(0, 0)): Transform2 => ({
  m: [sx, 0, about.x * (1 - sx), 0, sy, about.y * (1 - sy), 0, 0, 1],
  describe: `scaling by (${sx}, ${sy}) about (${about.x}, ${about.y})`
})

/** Reflection in a line through the origin at the given angle. */
export const reflection = (radians: number): Transform2 => {
  const c = Math.cos(2 * radians)
  const s = Math.sin(2 * radians)
  return { m: [c, s, 0, s, -c, 0, 0, 0, 1], describe: `reflection in the line at ${Number(((radians * 180) / Math.PI).toPrecision(6))} degrees` }
}

export const shear = (kx: number, ky: number): Transform2 => ({
  m: [1, kx, 0, ky, 1, 0, 0, 0, 1],
  describe: `shear by (${kx}, ${ky})`
})

/** `first` then `second`, which is `second * first` as matrices. The order matters and is named in the description. */
export function compose(first: Transform2, second: Transform2): Transform2 {
  const a = second.m
  const b = first.m
  const m: number[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += a[r * 3 + k] * b[k * 3 + c]
      m.push(sum)
    }
  }
  return { m: m as Transform2['m'], describe: `${first.describe}, then ${second.describe}` }
}

export const applyTransform = (t: Transform2, p: Point2): Point2 => ({
  x: t.m[0] * p.x + t.m[1] * p.y + t.m[2],
  y: t.m[3] * p.x + t.m[4] * p.y + t.m[5]
})

export interface TransformFacts {
  determinant: number
  /** Whether it preserves distance. Rotations and reflections do; scaling and shear do not. */
  isometry: boolean
  /** Whether it preserves orientation. A reflection does not, which is what a negative determinant means. */
  preservesOrientation: boolean
  areaScale: number
  describe: string
}

/** What a transformation does to lengths, areas and orientation, from its matrix. */
export function transformFacts(t: Transform2): TransformFacts {
  const determinant = t.m[0] * t.m[4] - t.m[1] * t.m[3]
  // An isometry has orthonormal columns: the linear part times its transpose is the identity.
  const col1 = Math.hypot(t.m[0], t.m[3])
  const col2 = Math.hypot(t.m[1], t.m[4])
  const dot = t.m[0] * t.m[1] + t.m[3] * t.m[4]
  const isometry = Math.abs(col1 - 1) < 1e-9 && Math.abs(col2 - 1) < 1e-9 && Math.abs(dot) < 1e-9

  return {
    determinant,
    isometry,
    preservesOrientation: determinant > 0,
    areaScale: Math.abs(determinant),
    describe: `${isometry ? 'Distances are preserved' : `Areas are multiplied by ${Number(Math.abs(determinant).toPrecision(6))}`}. Orientation is ${determinant > 0 ? 'preserved' : 'reversed, which is what a negative determinant means'}.`
  }
}

// ---------------------------------------------------------------- computational geometry

/**
 * The convex hull, by Andrew's monotone chain.
 *
 * Points are sorted and then the lower and upper chains are built, each dropping any point that would make a
 * non-left turn. Collinear points on the hull's edge are excluded: they are on the boundary but are not vertices, and
 * including them makes two hulls of the same shape compare as different.
 */
export function convexHull(points: readonly Point2[]): Point2[] | GeometryError {
  if (points.length > GEOMETRY_LIMITS.points) return fail('too-large', `A hull is limited to ${GEOMETRY_LIMITS.points.toLocaleString('en')} points.`)
  if (points.length < 3) return [...points]

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const scale = Math.max(...sorted.map((one) => Math.max(Math.abs(one.x), Math.abs(one.y))), 1)
  const tolerance = scale * scale * 1e-12

  const build = (input: readonly Point2[]): Point2[] => {
    const chain: Point2[] = []
    for (const one of input) {
      while (chain.length >= 2 && orientation(chain[chain.length - 2], chain[chain.length - 1], one) <= tolerance) chain.pop()
      chain.push(one)
    }
    return chain
  }

  const lower = build(sorted)
  const upper = build([...sorted].reverse())
  // The last point of each chain is the first of the other, so both are dropped.
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return hull.length === 0 ? [sorted[0]] : hull
}

export interface ClosestPair {
  a: Point2
  b: Point2
  distance: number
  comparisons: number
}

/**
 * The closest pair of points, by divide and conquer.
 *
 * The strip step is what makes it work: after recursing on each half, only points within the current best distance of
 * the dividing line can improve on it, and within that strip only the next seven points in y-order need checking --
 * a bound that comes from how many points can fit in a rectangle without being closer than the best distance.
 */
export function closestPair(points: readonly Point2[]): ClosestPair | GeometryError {
  if (points.length < 2) return fail('invalid-argument', 'A closest pair needs at least two points.')
  if (points.length > GEOMETRY_LIMITS.points) return fail('too-large', 'That is more points than Orbis handles at once.')

  const byX = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  let comparisons = 0

  const recurse = (from: number, to: number): { a: Point2; b: Point2; distance: number } => {
    const count = to - from
    if (count <= 3) {
      let best = { a: byX[from], b: byX[from + 1] ?? byX[from], distance: Number.POSITIVE_INFINITY }
      for (let i = from; i < to; i++) {
        for (let j = i + 1; j < to; j++) {
          comparisons += 1
          const d = distance2(byX[i], byX[j])
          if (d < best.distance) best = { a: byX[i], b: byX[j], distance: d }
        }
      }
      return best
    }

    const middle = Math.floor((from + to) / 2)
    const line = byX[middle].x
    const left = recurse(from, middle)
    const right = recurse(middle, to)
    let best = left.distance <= right.distance ? left : right

    const strip = byX.slice(from, to).filter((one) => Math.abs(one.x - line) < best.distance).sort((a, b) => a.y - b.y)
    for (let i = 0; i < strip.length; i++) {
      // Seven is the bound from the packing argument; beyond it no point can be closer than the current best.
      for (let j = i + 1; j < strip.length && j <= i + 7; j++) {
        comparisons += 1
        const d = distance2(strip[i], strip[j])
        if (d < best.distance) best = { a: strip[i], b: strip[j], distance: d }
      }
    }
    return best
  }

  const found = recurse(0, byX.length)
  return { ...found, comparisons }
}

export interface Triangulation {
  triangles: [number, number, number][]
  /** The indices of the points that ended up on the hull. */
  hull: number[]
  describe: string
}

/**
 * A Delaunay triangulation, by the incremental Bowyer-Watson method.
 *
 * The defining property is that no point lies inside the circumcircle of any triangle, which is what makes Delaunay
 * triangles as close to equilateral as the points allow. That property is what the algorithm maintains, and it is
 * checked rather than assumed by `verifyDelaunay`.
 */
export function delaunay(points: readonly Point2[]): Triangulation | GeometryError {
  if (points.length < 3) return fail('invalid-argument', 'A triangulation needs at least three points.')
  if (points.length > 5_000) return fail('too-large', 'Orbis triangulates up to 5,000 points at once.')
  const distinct = new Map(points.map((one, i) => [`${one.x},${one.y}`, i]))
  if (distinct.size < 3) return fail('degenerate', 'There are fewer than three distinct points.')

  // A super-triangle large enough to contain everything, removed at the end.
  const minX = Math.min(...points.map((one) => one.x))
  const maxX = Math.max(...points.map((one) => one.x))
  const minY = Math.min(...points.map((one) => one.y))
  const maxY = Math.max(...points.map((one) => one.y))
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  const all: Point2[] = [
    ...points,
    point(midX - 20 * span, midY - span),
    point(midX, midY + 20 * span),
    point(midX + 20 * span, midY - span)
  ]
  const superIndices = [points.length, points.length + 1, points.length + 2]

  let triangles: [number, number, number][] = [[superIndices[0], superIndices[1], superIndices[2]]]

  for (let p = 0; p < points.length; p++) {
    const bad: [number, number, number][] = []
    for (const triangle of triangles) {
      if (inCircumcircle(all[triangle[0]], all[triangle[1]], all[triangle[2]], all[p])) bad.push(triangle)
    }

    // The boundary of the hole: edges belonging to exactly one bad triangle.
    const edges = new Map<string, [number, number]>()
    for (const triangle of bad) {
      for (const [i, j] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as [number, number][]) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`
        if (edges.has(key)) edges.delete(key)
        else edges.set(key, [i, j])
      }
    }

    triangles = triangles.filter((one) => !bad.includes(one))
    for (const [i, j] of edges.values()) triangles.push([i, j, p])
  }

  const kept = triangles.filter((one) => one.every((index) => !superIndices.includes(index)))
  const onHull = convexHull(points)
  const hullIndices = isGeometryError(onHull) ? [] : onHull.map((one) => points.findIndex((p) => p.x === one.x && p.y === one.y))

  return {
    triangles: kept,
    hull: hullIndices,
    describe: `${kept.length} triangles over ${points.length} points. The defining property is that no point lies inside the circumcircle of any triangle, which is what makes these triangles as close to equilateral as the points allow.`
  }
}

/** Whether `d` lies strictly inside the circumcircle of `a`, `b`, `c`. The determinant test, not a distance check. */
export function inCircumcircle(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const ax = a.x - d.x
  const ay = a.y - d.y
  const bx = b.x - d.x
  const by = b.y - d.y
  const cx = c.x - d.x
  const cy = c.y - d.y

  const determinant =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay)

  // The sign depends on the winding of a, b, c, so it is normalised by their own orientation.
  const winding = orientation(a, b, c)
  if (winding === 0) return false
  return winding > 0 ? determinant > 0 : determinant < 0
}

/** Whether a triangulation really has the Delaunay property. The check, not a claim. */
export function verifyDelaunay(points: readonly Point2[], triangles: readonly [number, number, number][]): { holds: boolean; violations: number; describe: string } {
  let violations = 0
  for (const triangle of triangles) {
    for (let p = 0; p < points.length; p++) {
      if (triangle.includes(p)) continue
      if (inCircumcircle(points[triangle[0]], points[triangle[1]], points[triangle[2]], points[p])) violations += 1
    }
  }
  return {
    holds: violations === 0,
    violations,
    describe:
      violations === 0
        ? 'No point lies inside the circumcircle of any triangle, so the Delaunay property holds.'
        : `${violations} point-triangle pairs break the empty-circumcircle property, so this is a triangulation but not a Delaunay one.`
  }
}

// ---------------------------------------------------------------- three dimensions

/** A plane as `normal . x = offset`, with the normal a unit vector so distances come out directly. */
export interface Plane {
  normal: Point3
  offset: number
}

export function planeThrough(a: Point3, b: Point3, c: Point3): Plane | GeometryError {
  const normal = cross3(subtract3(b, a), subtract3(c, a))
  const magnitude = length3(normal)
  const scale = Math.max(length3(subtract3(b, a)), length3(subtract3(c, a)), 1)
  if (magnitude <= scale * scale * 1e-12) {
    return fail('collinear', 'Those three points lie on a line, so they do not determine a plane. Infinitely many planes contain a line.')
  }
  const unit = scale3(normal, 1 / magnitude)
  return { normal: unit, offset: dot3(unit, a) }
}

export const distanceToPlane = (from: Point3, plane: Plane): number => Math.abs(dot3(plane.normal, from) - plane.offset)

/** Where a line meets a plane: a point, nothing, or the whole line. */
export function intersectLinePlane(through: Point3, direction: Point3, plane: Plane): { at: Point3 | null; relation: 'point' | 'parallel' | 'contained'; describe: string } {
  const along = dot3(plane.normal, direction)
  const scale = Math.max(length3(direction), 1)
  if (Math.abs(along) <= scale * 1e-12) {
    const gap = dot3(plane.normal, through) - plane.offset
    if (Math.abs(gap) <= Math.max(1, Math.abs(plane.offset)) * 1e-12) {
      return { at: null, relation: 'contained', describe: 'The line lies in the plane, so they meet at every point of the line rather than at one.' }
    }
    return { at: null, relation: 'parallel', describe: `The line is parallel to the plane and ${Number(Math.abs(gap).toPrecision(6))} away from it, so they never meet.` }
  }
  const t = (plane.offset - dot3(plane.normal, through)) / along
  return { at: add3(through, scale3(direction, t)), relation: 'point', describe: 'The line crosses the plane at one point.' }
}

/** Where two planes meet: a line, or nothing, or everywhere. */
export function intersectPlanes(a: Plane, b: Plane): { direction: Point3 | null; through: Point3 | null; relation: 'line' | 'parallel' | 'coincident'; describe: string } {
  const direction = cross3(a.normal, b.normal)
  const magnitude = length3(direction)
  if (magnitude <= 1e-12) {
    const same = Math.abs(a.offset - b.offset) <= Math.max(1, Math.abs(a.offset)) * 1e-12 && dot3(a.normal, b.normal) > 0
    return same
      ? { direction: null, through: null, relation: 'coincident', describe: 'The two planes are the same plane.' }
      : { direction: null, through: null, relation: 'parallel', describe: 'The planes are parallel and never meet.' }
  }

  // A point on the line: solve the two plane equations plus the constraint of lying along the cross product.
  const d = dot3(direction, direction)
  const through = scale3(
    add3(scale3(cross3(direction, b.normal), a.offset), scale3(cross3(a.normal, direction), b.offset)),
    1 / d
  )
  return { direction, through, relation: 'line', describe: 'The planes meet in a line.' }
}

export interface SolidFacts {
  volume: number
  surfaceArea: number
  lateralArea: number | null
  describe: string
}

/** The standard solids, computed rather than looked up. */
export function solidFacts(
  kind: 'cube' | 'cuboid' | 'sphere' | 'cylinder' | 'cone' | 'pyramid' | 'prism',
  dimensions: { a?: number; b?: number; c?: number; radius?: number; height?: number; baseArea?: number; basePerimeter?: number }
): SolidFacts | GeometryError {
  const positive = (value: number | undefined, name: string): number | GeometryError =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fail('invalid-argument', `${name} has to be a positive number.`)

  switch (kind) {
    case 'cube': {
      const a = positive(dimensions.a, 'The edge length')
      if (isGeometryError(a)) return a
      return { volume: a ** 3, surfaceArea: 6 * a * a, lateralArea: 4 * a * a, describe: `A cube of edge ${a}.` }
    }
    case 'cuboid': {
      const a = positive(dimensions.a, 'The length')
      const b = positive(dimensions.b, 'The width')
      const c = positive(dimensions.c, 'The height')
      if (isGeometryError(a)) return a
      if (isGeometryError(b)) return b
      if (isGeometryError(c)) return c
      return { volume: a * b * c, surfaceArea: 2 * (a * b + b * c + a * c), lateralArea: 2 * c * (a + b), describe: `A cuboid ${a} by ${b} by ${c}.` }
    }
    case 'sphere': {
      const r = positive(dimensions.radius, 'The radius')
      if (isGeometryError(r)) return r
      return { volume: (4 / 3) * Math.PI * r ** 3, surfaceArea: 4 * Math.PI * r * r, lateralArea: null, describe: `A sphere of radius ${r}. It has no lateral surface distinct from its total one.` }
    }
    case 'cylinder': {
      const r = positive(dimensions.radius, 'The radius')
      const h = positive(dimensions.height, 'The height')
      if (isGeometryError(r)) return r
      if (isGeometryError(h)) return h
      return { volume: Math.PI * r * r * h, surfaceArea: 2 * Math.PI * r * (r + h), lateralArea: 2 * Math.PI * r * h, describe: `A cylinder of radius ${r} and height ${h}.` }
    }
    case 'cone': {
      const r = positive(dimensions.radius, 'The radius')
      const h = positive(dimensions.height, 'The height')
      if (isGeometryError(r)) return r
      if (isGeometryError(h)) return h
      // The slant height, which the lateral area needs and the vertical height is not.
      const slant = Math.hypot(r, h)
      return { volume: (Math.PI * r * r * h) / 3, surfaceArea: Math.PI * r * (r + slant), lateralArea: Math.PI * r * slant, describe: `A cone of radius ${r} and height ${h}, with slant height ${Number(slant.toPrecision(6))}.` }
    }
    case 'pyramid': {
      const base = positive(dimensions.baseArea, 'The base area')
      const h = positive(dimensions.height, 'The height')
      if (isGeometryError(base)) return base
      if (isGeometryError(h)) return h
      return {
        volume: (base * h) / 3,
        surfaceArea: base,
        lateralArea: null,
        // The lateral area of a pyramid needs the shape of the base, not just its area.
        describe: `A pyramid with base area ${base} and height ${h}. The volume is a third of the prism on the same base. The lateral area cannot be found from the base area alone -- it needs the base's shape.`
      }
    }
    case 'prism': {
      const base = positive(dimensions.baseArea, 'The base area')
      const h = positive(dimensions.height, 'The height')
      if (isGeometryError(base)) return base
      if (isGeometryError(h)) return h
      const perimeter = dimensions.basePerimeter
      const lateral = perimeter !== undefined && perimeter > 0 ? perimeter * h : null
      return {
        volume: base * h,
        surfaceArea: lateral === null ? 2 * base : 2 * base + lateral,
        lateralArea: lateral,
        describe: lateral === null ? `A prism with base area ${base} and height ${h}. Without the base perimeter the lateral area cannot be found, so the surface area shown is only the two ends.` : `A prism with base area ${base}, perimeter ${perimeter}, height ${h}.`
      }
    }
  }
}

// ---------------------------------------------------------------- proof checking

export interface Claim {
  id: string
  /** What is asserted, as a structured statement rather than as prose. */
  kind: 'collinear' | 'concurrent' | 'equal-length' | 'perpendicular' | 'parallel' | 'equal-angle' | 'on-circle' | 'congruent-triangles'
  points: string[]
  describe: string
}

export interface ClaimCheck {
  id: string
  holds: boolean
  /** What was measured, so a verdict can be argued with rather than only accepted. */
  measured: string
  /** Numerical checking on one configuration. Never a proof, and never called one. */
  verdict: 'checked-numerically' | 'counterexample' | 'undecidable'
  describe: string
}

/**
 * Whether a geometric claim holds for a given configuration.
 *
 * This checks; it does not prove. A claim that holds for one arrangement of points may fail for another, and nothing
 * here explores the space of arrangements. What it is genuinely good at is the opposite: a claim that fails on a
 * single configuration is refuted, and that is a real result.
 */
export function checkClaim(claim: Claim, points: ReadonlyMap<string, Point2>): ClaimCheck {
  const resolve = (name: string): Point2 | null => points.get(name) ?? null
  const needed = claim.points.map(resolve)
  if (needed.some((one) => one === null)) {
    const missing = claim.points.filter((name) => !points.has(name))
    return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: `The claim refers to ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not in the configuration.` }
  }
  const p = needed as Point2[]

  const refuted = (measured: string, why: string): ClaimCheck => ({
    id: claim.id,
    holds: false,
    measured,
    verdict: 'counterexample',
    describe: `This configuration refutes the claim: ${why}. One counterexample is enough to settle it.`
  })
  const checked = (measured: string, why: string): ClaimCheck => ({
    id: claim.id,
    holds: true,
    measured,
    verdict: 'checked-numerically',
    describe: `${why} That is checked on this one configuration; it is not a proof that the claim holds in general.`
  })

  switch (claim.kind) {
    case 'collinear': {
      if (p.length < 3) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'Collinearity needs at least three points.' }
      for (let i = 2; i < p.length; i++) {
        if (!collinear(p[0], p[1], p[i])) {
          const off = distanceToLine(p[i], { through: p[0], direction: subtract2(p[1], p[0]) })
          return refuted(`${claim.points[i]} is ${Number(off.toPrecision(6))} off the line`, `${claim.points[i]} is not on the line through ${claim.points[0]} and ${claim.points[1]}`)
        }
      }
      return checked('all within tolerance of the line', 'The points are collinear.')
    }

    case 'equal-length': {
      if (p.length !== 4) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'An equal-length claim compares two segments, so it needs four points.' }
      const first = distance2(p[0], p[1])
      const second = distance2(p[2], p[3])
      const measured = `${Number(first.toPrecision(8))} against ${Number(second.toPrecision(8))}`
      return Math.abs(first - second) <= Math.max(first, second) * 1e-9
        ? checked(measured, 'The two segments have the same length.')
        : refuted(measured, 'the two segments have different lengths')
    }

    case 'perpendicular':
    case 'parallel': {
      if (p.length !== 4) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'This claim compares two lines, so it needs four points.' }
      const first = subtract2(p[1], p[0])
      const second = subtract2(p[3], p[2])
      const norm = length2(first) * length2(second)
      if (norm === 0) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'One of the lines is a single point.' }
      const value = claim.kind === 'perpendicular' ? Math.abs(dot2(first, second)) / norm : Math.abs(cross2(first, second)) / norm
      const measured = `${claim.kind === 'perpendicular' ? 'normalised dot product' : 'normalised cross product'} ${value.toExponential(3)}`
      return value <= 1e-9
        ? checked(measured, `The lines are ${claim.kind}.`)
        : refuted(measured, `the lines are not ${claim.kind}`)
    }

    case 'concurrent': {
      if (p.length !== 6) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'Concurrency of three lines needs six points, two for each line.' }
      const lines = [
        { through: p[0], direction: subtract2(p[1], p[0]) },
        { through: p[2], direction: subtract2(p[3], p[2]) },
        { through: p[4], direction: subtract2(p[5], p[4]) }
      ]
      const first = relateLines(lines[0], lines[1])
      if (first.at === null) return { id: claim.id, holds: false, measured: first.relation, verdict: 'undecidable', describe: 'The first two lines do not meet at a single point, so concurrency is not defined here.' }
      const off = distanceToLine(first.at, lines[2])
      const scale = Math.max(...p.map((one) => Math.max(Math.abs(one.x), Math.abs(one.y))), 1)
      const measured = `the third line passes ${Number(off.toPrecision(6))} from where the first two meet`
      return off <= scale * 1e-9 ? checked(measured, 'The three lines meet at one point.') : refuted(measured, 'the third line misses the meeting point of the other two')
    }

    case 'equal-angle': {
      if (p.length !== 6) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'Comparing two angles needs six points, three for each.' }
      const first = angleAt(p[1], p[0], p[2])
      const second = angleAt(p[4], p[3], p[5])
      if (isGeometryError(first) || isGeometryError(second)) {
        return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'One of the angles is degenerate.' }
      }
      const measured = `${Number(first.degrees.toPrecision(8))} degrees against ${Number(second.degrees.toPrecision(8))}`
      return Math.abs(first.radians - second.radians) < 1e-9 ? checked(measured, 'The two angles are equal.') : refuted(measured, 'the two angles differ')
    }

    case 'on-circle': {
      if (p.length < 4) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'This claim needs three points to determine the circle and at least one more to test.' }
      const circle = circleThrough(p[0], p[1], p[2])
      if (isGeometryError(circle)) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: circle.message }
      for (let i = 3; i < p.length; i++) {
        const off = Math.abs(distance2(p[i], circle.centre) - circle.radius)
        if (off > circle.radius * 1e-9) {
          return refuted(`${claim.points[i]} is ${Number(off.toPrecision(6))} off the circle`, `${claim.points[i]} does not lie on the circle through the first three`)
        }
      }
      return checked('all within tolerance of the circle', 'The points are concyclic.')
    }

    case 'congruent-triangles': {
      if (p.length !== 6) return { id: claim.id, holds: false, measured: '', verdict: 'undecidable', describe: 'Comparing two triangles needs six points.' }
      const first = [distance2(p[0], p[1]), distance2(p[1], p[2]), distance2(p[2], p[0])].sort((a, b) => a - b)
      const second = [distance2(p[3], p[4]), distance2(p[4], p[5]), distance2(p[5], p[3])].sort((a, b) => a - b)
      const scale = Math.max(...first, ...second)
      const same = first.every((one, i) => Math.abs(one - second[i]) <= scale * 1e-9)
      const measured = `sides ${first.map((one) => Number(one.toPrecision(6))).join(', ')} against ${second.map((one) => Number(one.toPrecision(6))).join(', ')}`
      // Sorted sides, so this is congruence up to relabelling -- which is what congruence means.
      return same ? checked(measured, 'The triangles are congruent: all three sides match.') : refuted(measured, 'the side lengths do not match')
    }
  }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const GEOMETRY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Everything is computed from coordinates. Nothing is decided by how a figure looks.',
  'Tolerances are relative to the size of the figure, because an absolute one is wrong for microns and for kilometres alike.',
  'A degenerate case is answered as itself: three collinear points have no circumcircle, and parallel lines do not meet.',
  'Coincident is distinguished from parallel, and touching from crossing, because they mean different things.',
  'A self-intersecting polygon has no well-defined interior, and its shoelace number is not reported as an area without saying so.',
  'Side-side-angle can give two triangles. Both are returned rather than one of them.',
  'A claim checked on one configuration is checked, not proven. A claim that fails on one is refuted, which is a real result.'
])
