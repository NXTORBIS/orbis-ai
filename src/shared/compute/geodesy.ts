/**
 * Geodesy: distances and bearings on the real Earth, map projections, and where the sun is.
 *
 * The shared geodesy engine for Orbis Pages. The Earth is treated as an ellipsoid where that matters and as a
 * sphere only when the engine says so, because the difference is up to 0.5% — twenty kilometres on a long flight.
 *
 * ## Why the ellipsoid, and why the sphere is still here
 *
 * A sphere is easier and wrong by about half a percent. On a five-kilometre walk that is twenty-five metres and
 * nobody cares; on a plan for a pipeline it is a real error. So both are available, each named, and the ellipsoid
 * result says which ellipsoid it used — because WGS84 and GRS80 and Airy 1830 are different Earths, and a
 * coordinate from one placed on another is out by up to two hundred metres.
 *
 * ## Why the coordinate order is stated everywhere
 *
 * Latitude-then-longitude and longitude-then-latitude are both in wide use, they look identical in a pair of
 * numbers, and swapping them puts a place in the wrong hemisphere. Every function here names its arguments, and
 * nothing takes a bare pair.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * geodetic     vs  geocentric latitude  -- measured from the ellipsoid normal against from the centre
 * true north   vs  magnetic north       -- and the declination between them, which moves
 * height above ellipsoid vs above sea level -- differ by up to 100 m, and neither is "altitude"
 * great circle vs  rhumb line           -- shortest against constant-bearing; not the same route
 * solar time   vs  clock time           -- and the equation of time between them
 * ```
 *
 * Pure. No network, no clock, no storage. Every date is passed in; nothing here reads the system time.
 */

export interface GeodesyError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'not-converged' | 'no-solution' | 'too-many'
  message: string
}

export const isGeodesyError = (value: unknown): value is GeodesyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: GeodesyError['error'], message: string): GeodesyError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)
const rad = (degrees: number): number => (degrees * Math.PI) / 180
const deg = (radians: number): number => (radians * 180) / Math.PI

export const GEODESY_LIMITS = Object.freeze({
  points: 2000,
  samples: 2000,
  iterations: 200
})

// ---------------------------------------------------------------- ellipsoids

export interface Ellipsoid {
  id: string
  name: string
  /** Metres. Equatorial radius. */
  semiMajor: number
  /** Metres. Polar radius. */
  semiMinor: number
  flattening: number
  notes: string
}

const ellipsoid = (id: string, name: string, a: number, inverseFlattening: number, notes: string): Ellipsoid => {
  const f = 1 / inverseFlattening
  return { id, name, semiMajor: a, semiMinor: a * (1 - f), flattening: f, notes }
}

export const ELLIPSOIDS: readonly Ellipsoid[] = Object.freeze([
  ellipsoid('wgs84', 'WGS 84', 6378137, 298.257223563, 'What GPS reports. The default almost everywhere, and the one to assume if nobody said.'),
  ellipsoid('grs80', 'GRS 80', 6378137, 298.257222101, 'Used by NAD83 and most national grids. Differs from WGS 84 by under a millimetre in shape.'),
  ellipsoid('airy1830', 'Airy 1830', 6377563.396, 299.3249646, 'The British Ordnance Survey ellipsoid. Placing a WGS 84 coordinate on it without a datum shift is out by about 100 m.'),
  ellipsoid('bessel1841', 'Bessel 1841', 6377397.155, 299.1528128, 'Older European surveys. Same caution as Airy.'),
  ellipsoid('clarke1866', 'Clarke 1866', 6378206.4, 294.9786982, 'NAD27 in North America. Shifts from WGS 84 reach 200 m.')
])

/** The sphere used when a calculation says it is using one. The mean radius, not the equatorial one. */
export const MEAN_EARTH_RADIUS = 6371008.8

export function ellipsoidById(id: string): Ellipsoid | GeodesyError {
  const found = ELLIPSOIDS.find((one) => one.id === id)
  return found ?? fail('invalid-argument', `"${id}" is not an ellipsoid this knows: ${ELLIPSOIDS.map((one) => one.id).join(', ')}.`)
}

export interface Coordinate {
  latitudeDegrees: number
  longitudeDegrees: number
}

const checkCoordinate = (at: Coordinate, which: string): GeodesyError | null => {
  if (!finite(at.latitudeDegrees) || !finite(at.longitudeDegrees)) {
    return fail('not-finite', `The ${which} coordinate has a value that is not a finite number.`)
  }
  if (at.latitudeDegrees < -90 || at.latitudeDegrees > 90) {
    return fail(
      'out-of-range',
      `The ${which} latitude is ${at.latitudeDegrees}, which is off the Earth. Latitude runs from -90 to 90 — if this number is above 90 it is probably a longitude, and the pair is the wrong way round.`
    )
  }
  if (at.longitudeDegrees < -180 || at.longitudeDegrees > 180) {
    return fail('out-of-range', `The ${which} longitude is ${at.longitudeDegrees}; it runs from -180 to 180.`)
  }
  return null
}

// ---------------------------------------------------------------- distance and bearing

export interface DistanceReport {
  model: 'ellipsoid' | 'sphere'
  ellipsoid: string | null
  /** Metres along the surface. */
  distance: number
  /** Degrees from true north, at the start and at the end. They differ on a long line. */
  initialBearing: number
  finalBearing: number
  /** Metres. The same journey on a sphere, for comparison. */
  sphereDistance: number
  /** How far the sphere answer is out, as a fraction. */
  sphereError: number
  iterations: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The distance and bearing between two places, on the ellipsoid by Vincenty's method.
 *
 * Vincenty is iterated and can fail to converge for nearly antipodal points — and when it does, this says so
 * rather than returning whatever the last iteration held. The spherical answer is reported alongside so the size
 * of the approximation is visible instead of assumed small.
 *
 * The initial and final bearings differ, sometimes by a lot. A great circle from London to Tokyo leaves heading
 * north-east and arrives heading south-east, which is why the flight path on a flat map looks like a detour over
 * the Arctic when it is in fact the short way.
 */
export function distanceBetween(input: {
  from: Coordinate
  to: Coordinate
  model?: 'ellipsoid' | 'sphere'
  ellipsoid?: string
}): DistanceReport | GeodesyError {
  for (const [which, at] of [
    ['first', input.from],
    ['second', input.to]
  ] as const) {
    const bad = checkCoordinate(at, which)
    if (bad) return bad
  }
  const model = input.model ?? 'ellipsoid'
  const shape = ellipsoidById(input.ellipsoid ?? 'wgs84')
  if (isGeodesyError(shape)) return shape

  const phi1 = rad(input.from.latitudeDegrees)
  const phi2 = rad(input.to.latitudeDegrees)
  const dLambda = rad(input.to.longitudeDegrees - input.from.longitudeDegrees)

  // The spherical answer first, by haversine, which is stable for short distances where the cosine formula is not.
  const dPhi = phi2 - phi1
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  const sphereDistance = 2 * MEAN_EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))

  const warnings: string[] = []
  let distance = sphereDistance
  let iterations: number | null = null
  let initialBearing: number
  let finalBearing: number

  if (model === 'sphere') {
    const y = Math.sin(dLambda) * Math.cos(phi2)
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
    initialBearing = (deg(Math.atan2(y, x)) + 360) % 360
    const ry = Math.sin(-dLambda) * Math.cos(phi1)
    const rx = Math.cos(phi2) * Math.sin(phi1) - Math.sin(phi2) * Math.cos(phi1) * Math.cos(dLambda)
    finalBearing = (deg(Math.atan2(ry, rx)) + 180) % 360
  } else {
    const { semiMajor: a, semiMinor: b, flattening: f } = shape
    const U1 = Math.atan((1 - f) * Math.tan(phi1))
    const U2 = Math.atan((1 - f) * Math.tan(phi2))
    const sinU1 = Math.sin(U1)
    const cosU1 = Math.cos(U1)
    const sinU2 = Math.sin(U2)
    const cosU2 = Math.cos(U2)

    let lambda = dLambda
    let converged = false
    let sinSigma = 0
    let cosSigma = 0
    let sigma = 0
    let cos2Alpha = 0
    let cos2SigmaM = 0
    let sinAlpha = 0
    let step = 0

    for (; step < GEODESY_LIMITS.iterations; step += 1) {
      const sinLambda = Math.sin(lambda)
      const cosLambda = Math.cos(lambda)
      sinSigma = Math.sqrt((cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2)
      if (sinSigma === 0) {
        // Coincident points. The distance is zero and the bearing is undefined, which is a real answer.
        return {
          model: 'ellipsoid',
          ellipsoid: shape.id,
          distance: 0,
          initialBearing: 0,
          finalBearing: 0,
          sphereDistance: 0,
          sphereError: 0,
          iterations: step,
          notes: Object.freeze(['The two places are the same point, so the distance is zero and there is no bearing between them.']),
          warnings: Object.freeze([])
        }
      }
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda
      sigma = Math.atan2(sinSigma, cosSigma)
      sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma
      cos2Alpha = 1 - sinAlpha * sinAlpha
      cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha
      const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha))
      const previous = lambda
      lambda =
        dLambda +
        (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
      if (Math.abs(lambda - previous) < 1e-12) {
        converged = true
        break
      }
    }
    iterations = step

    if (!converged) {
      return fail(
        'not-converged',
        'Vincenty did not settle. That happens for places almost exactly on opposite sides of the Earth, where the shortest route is genuinely ambiguous. Use the spherical model for these, and treat the answer as approximate.'
      )
    }

    const u2 = cos2Alpha * ((a * a - b * b) / (b * b))
    const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    const deltaSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)))
    distance = b * A * (sigma - deltaSigma)

    const sinLambda = Math.sin(lambda)
    const cosLambda = Math.cos(lambda)
    initialBearing = (deg(Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)) + 360) % 360
    finalBearing = (deg(Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda)) + 360) % 360
  }

  const sphereError = distance === 0 ? 0 : Math.abs(sphereDistance - distance) / distance
  const notes: string[] = [
    model === 'ellipsoid'
      ? `On the ${shape.name} ellipsoid, by Vincenty, converged in ${iterations} passes. ${shape.notes}`
      : `On a sphere of mean radius ${MEAN_EARTH_RADIUS.toFixed(0)} m, by haversine. Simpler, and out by up to about half a percent.`,
    `The spherical answer differs from the ellipsoidal one by ${(sphereError * 100).toFixed(3)}%, which is ${Math.abs(sphereDistance - distance).toFixed(1)} m here.`,
    `The bearing leaving is ${initialBearing.toFixed(2)} degrees and arriving is ${finalBearing.toFixed(2)}. They differ because a great circle is not a constant-bearing line — following a fixed compass heading is a longer route.`,
    'All bearings here are from true north. Magnetic north is somewhere else, it moves, and the difference reaches 20 degrees in populated places.'
  ]
  if (distance > 1e7) {
    warnings.push('This is more than a quarter of the way round the Earth. Flat-map intuition fails badly at this range — the shortest route will look like a detour.')
  }

  return {
    model,
    ellipsoid: model === 'ellipsoid' ? shape.id : null,
    distance,
    initialBearing,
    finalBearing,
    sphereDistance,
    sphereError,
    iterations,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

export interface DestinationReport {
  arrival: Coordinate
  /** Degrees. The bearing on arrival, which is not the bearing set out on. */
  finalBearing: number
  distance: number
  startBearing: number
  notes: readonly string[]
}

/** Where you end up setting out on a bearing and going a distance along a great circle. */
export function destinationFrom(input: {
  from: Coordinate
  bearingDegrees: number
  distance: number
}): DestinationReport | GeodesyError {
  const bad = checkCoordinate(input.from, 'starting')
  if (bad) return bad
  if (!finite(input.bearingDegrees) || !finite(input.distance)) return fail('not-finite', 'The bearing and distance have to be finite numbers.')
  if (input.distance < 0) return fail('invalid-argument', 'The distance cannot be negative. Turn the bearing round instead.')

  const phi1 = rad(input.from.latitudeDegrees)
  const lambda1 = rad(input.from.longitudeDegrees)
  const theta = rad(input.bearingDegrees)
  const delta = input.distance / MEAN_EARTH_RADIUS

  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta))
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2))

  const arrival = {
    latitudeDegrees: deg(phi2),
    longitudeDegrees: (((deg(lambda2) + 540) % 360) - 180)
  }
  const back = distanceBetween({ from: arrival, to: input.from, model: 'sphere' })
  const finalBearing = isGeodesyError(back) ? 0 : (back.initialBearing + 180) % 360

  return {
    arrival,
    finalBearing,
    distance: input.distance,
    startBearing: input.bearingDegrees,
    notes: Object.freeze([
      'On a sphere, not the ellipsoid. For this direction the difference is under a tenth of a percent over any distance a person walks or drives.',
      'The bearing on arrival is not the bearing set out on. A great circle turns as you follow it, which is why long flights change heading continuously.'
    ])
  }
}

// ---------------------------------------------------------------- areas and paths

export interface PathReport {
  /** Metres. */
  length: number
  legs: readonly { from: number; to: number; distance: number; bearing: number }[]
  /** m². Null for a path that does not close. */
  enclosedArea: number | null
  closed: boolean
  /** The box that holds it: south, west, north, east. */
  bounds: { south: number; west: number; north: number; east: number }
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The length of a path, and the area it encloses if it closes.
 *
 * The area uses the spherical excess rather than projecting to a flat plane and using the shoelace formula. The
 * flat version is out by a percent over a field and by a great deal over a county, and worse, it is out in a
 * direction that depends on latitude — so two identical fields measured at different latitudes disagree.
 */
export function pathMetrics(input: {
  points: readonly Coordinate[]
  closed?: boolean
}): PathReport | GeodesyError {
  const { points } = input
  if (points.length < 2) return fail('invalid-argument', 'A path needs at least two points.')
  if (points.length > GEODESY_LIMITS.points) {
    return fail('too-many', `That is ${points.length} points; this handles up to ${GEODESY_LIMITS.points}.`)
  }
  for (const [i, one] of points.entries()) {
    const bad = checkCoordinate(one, `point ${i + 1}`)
    if (bad) return bad
  }

  const closed = input.closed ?? false
  const order = closed ? [...points, points[0]] : points
  const legs: PathReport['legs'][number][] = []
  let length = 0
  for (let i = 1; i < order.length; i += 1) {
    const leg = distanceBetween({ from: order[i - 1], to: order[i], model: 'ellipsoid' })
    if (isGeodesyError(leg)) return leg
    legs.push({ from: i - 1, to: i % points.length, distance: leg.distance, bearing: leg.initialBearing })
    length += leg.distance
  }

  let area: number | null = null
  if (closed && points.length >= 3) {
    // Spherical excess. Sums the signed contribution of each edge, so a polygon wound either way gives the same
    // magnitude and self-intersecting ones give something meaningless, which is the caller's problem to avoid.
    let total = 0
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      total +=
        rad(b.longitudeDegrees - a.longitudeDegrees) *
        (2 + Math.sin(rad(a.latitudeDegrees)) + Math.sin(rad(b.latitudeDegrees)))
    }
    area = Math.abs((total * MEAN_EARTH_RADIUS * MEAN_EARTH_RADIUS) / 2)
  }

  const bounds = {
    south: Math.min(...points.map((one) => one.latitudeDegrees)),
    north: Math.max(...points.map((one) => one.latitudeDegrees)),
    west: Math.min(...points.map((one) => one.longitudeDegrees)),
    east: Math.max(...points.map((one) => one.longitudeDegrees))
  }

  const warnings: string[] = []
  if (bounds.east - bounds.west > 180) {
    warnings.push(
      'This path spans more than half the globe in longitude, which usually means it crosses the date line and the points were written as if it did not. The length and area will both be wrong if so.'
    )
  }

  return {
    length,
    legs: Object.freeze(legs),
    enclosedArea: area,
    closed,
    bounds,
    notes: Object.freeze([
      'Each leg is an ellipsoidal geodesic, so the total is the distance actually walked rather than a flat-map approximation.',
      closed
        ? 'The area comes from the spherical excess, not from projecting to a plane. A flat projection is out by a percent over a field and much more over a county, and by an amount that depends on latitude.'
        : 'The path does not close, so there is no area to report. Pass closed if the last point should join the first.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- projections

export type ProjectionKind = 'web-mercator' | 'utm' | 'equirectangular'

export const PROJECTIONS: readonly ProjectionKind[] = Object.freeze(['web-mercator', 'utm', 'equirectangular'])

export const PROJECTION_FACTS: Readonly<
  Record<ProjectionKind, { label: string; preserves: string; distorts: string; useFor: string }>
> = Object.freeze({
  'web-mercator': {
    label: 'Web Mercator',
    preserves: 'Angles and local shape. A square on the ground is a square on the map.',
    distorts: 'Area, enormously. Greenland appears the size of Africa and is a fourteenth of it. Scale is wrong everywhere except the equator, by a factor of 1/cos(latitude).',
    useFor: 'Screen maps and navigation. Never for comparing areas.'
  },
  utm: {
    label: 'Universal Transverse Mercator',
    preserves: 'Shape and, within a zone, distance to about one part in 2500.',
    distorts: 'Nothing much inside its own six-degree zone. Everything across zone boundaries, which is why coordinates in different zones cannot be compared directly.',
    useFor: 'Surveying and engineering within one zone. The zone number is part of the coordinate, not a footnote.'
  },
  equirectangular: {
    label: 'Equirectangular (plate carrée)',
    preserves: 'Nothing, strictly. Latitude and longitude map straight onto x and y.',
    distorts: 'Shape and area away from the equator. East-west distances are stretched by 1/cos(latitude).',
    useFor: 'Global data grids and quick plots. Not for measuring anything.'
  }
})

export interface ProjectionReport {
  projection: ProjectionKind
  x: number
  y: number
  /** UTM only. */
  zone: number | null
  hemisphere: 'north' | 'south' | null
  /** How much this projection stretches distance at this point. 1 means no distortion. */
  scaleFactor: number
  /** How much it stretches area here. Mercator reaches 14 at Greenland's latitude. */
  areaFactor: number
  preserves: string
  distorts: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Project a coordinate, with the distortion at that point reported.
 *
 * Every flat map is wrong; the question is only how. Reporting the scale and area factor at the point turns that
 * from a fact people know abstractly into a number on the screen — and the area factor is the one that matters,
 * because it is the reason Mercator maps have misled people about the size of countries for four centuries.
 */
export function project(input: {
  at: Coordinate
  projection: ProjectionKind
  zone?: number
}): ProjectionReport | GeodesyError {
  const bad = checkCoordinate(input.at, 'given')
  if (bad) return bad
  const facts = PROJECTION_FACTS[input.projection]
  if (!facts) return fail('invalid-argument', `"${input.projection}" is not one of: ${PROJECTIONS.join(', ')}.`)

  const phi = rad(input.at.latitudeDegrees)
  const lambda = rad(input.at.longitudeDegrees)
  const warnings: string[] = []

  if (input.projection === 'equirectangular') {
    const scale = 1 / Math.max(Math.cos(phi), 1e-12)
    return {
      projection: input.projection,
      x: MEAN_EARTH_RADIUS * lambda,
      y: MEAN_EARTH_RADIUS * phi,
      zone: null,
      hemisphere: null,
      scaleFactor: scale,
      areaFactor: scale,
      preserves: facts.preserves,
      distorts: facts.distorts,
      notes: Object.freeze([`${facts.label}. ${facts.useFor}`, `East-west distances here are stretched by ${scale.toFixed(3)}.`]),
      warnings: Object.freeze(warnings)
    }
  }

  if (input.projection === 'web-mercator') {
    if (Math.abs(input.at.latitudeDegrees) > 85.05112878) {
      return fail(
        'out-of-range',
        `Web Mercator cannot represent latitude ${input.at.latitudeDegrees}. The projection sends the poles to infinity, so it is cut off at 85.05 degrees — which is why online maps simply do not show the poles.`
      )
    }
    const scale = 1 / Math.cos(phi)
    if (scale > 3) {
      warnings.push(
        `At this latitude Web Mercator stretches distance by ${scale.toFixed(2)} and area by ${(scale * scale).toFixed(2)}. Anything measured off such a map is wrong by that factor.`
      )
    }
    return {
      projection: input.projection,
      x: MEAN_EARTH_RADIUS * lambda,
      y: MEAN_EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
      zone: null,
      hemisphere: null,
      scaleFactor: scale,
      areaFactor: scale * scale,
      preserves: facts.preserves,
      distorts: facts.distorts,
      notes: Object.freeze([`${facts.label}. ${facts.useFor}`, `Scale here is ${scale.toFixed(3)} and area is exaggerated ${(scale * scale).toFixed(3)} times.`]),
      warnings: Object.freeze(warnings)
    }
  }

  // UTM, on WGS 84.
  const zone = input.zone ?? Math.floor((input.at.longitudeDegrees + 180) / 6) + 1
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) return fail('invalid-argument', 'A UTM zone is a whole number from 1 to 60.')
  if (Math.abs(input.at.latitudeDegrees) > 84) {
    return fail(
      'out-of-range',
      'UTM covers 80 degrees south to 84 degrees north. Above that the polar stereographic system (UPS) is used instead, and it is a different grid.'
    )
  }
  const naturalZone = Math.floor((input.at.longitudeDegrees + 180) / 6) + 1
  if (zone !== naturalZone) {
    warnings.push(
      `This point sits naturally in zone ${naturalZone} and was projected into zone ${zone}. That is legitimate for keeping a survey in one grid, and the distortion grows quickly outside a zone's own six degrees.`
    )
  }

  const shape = ELLIPSOIDS[0]
  const a = shape.semiMajor
  const f = shape.flattening
  const k0 = 0.9996
  const e2 = f * (2 - f)
  const centralMeridian = rad((zone - 1) * 6 - 180 + 3)
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2)
  const T = Math.tan(phi) ** 2
  const C = (e2 / (1 - e2)) * Math.cos(phi) ** 2
  const A = Math.cos(phi) * (lambda - centralMeridian)
  const e4 = e2 * e2
  const e6 = e4 * e2
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))

  const easting =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5) / 120) +
    500000
  let northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6) / 720))
  const hemisphere = input.at.latitudeDegrees < 0 ? 'south' : 'north'
  if (hemisphere === 'south') northing += 10000000

  const scale = k0 * (1 + ((1 + C) * A * A) / 2)

  return {
    projection: 'utm',
    x: easting,
    y: northing,
    zone,
    hemisphere,
    scaleFactor: scale,
    areaFactor: scale * scale,
    preserves: facts.preserves,
    distorts: facts.distorts,
    notes: Object.freeze([
      `${facts.label}, zone ${zone}${hemisphere === 'south' ? ' south' : ' north'}, on WGS 84. ${facts.useFor}`,
      `Scale here is ${scale.toFixed(6)}, so a kilometre on the ground measures ${(scale * 1000).toFixed(2)} m on the grid.`,
      'The zone and hemisphere are part of the coordinate. An easting and northing without them names sixty different places.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- the sun

export interface SolarReport {
  /** Degrees above the horizon. Negative means below it. */
  elevation: number
  /** Degrees from true north, clockwise. */
  azimuth: number
  /** Degrees. Where the sun is overhead on this day. */
  declination: number
  /** Minutes. How far solar noon is from clock noon, from the Earth's orbit being an ellipse. */
  equationOfTime: number
  /** Hours from midnight, in local solar time. */
  solarNoon: number
  /** Whether the sun is up at all. */
  daylight: boolean
  /** How strong direct sun is here relative to overhead, from the angle alone. */
  relativeIntensity: number
  /** How much atmosphere the light passes through compared with straight up. */
  airMass: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Where the sun is, for a place and a moment.
 *
 * The moment is passed in as a year, month, day and UTC hour — nothing here reads the system clock, because an
 * engine that did could not be tested and could not answer a question about a different day.
 *
 * Refraction is not applied. Near the horizon it lifts the sun by about half a degree, which is why sunrise
 * happens a couple of minutes before the geometric calculation says; that matters for sunrise times and not for
 * anything else, so it is named rather than silently folded in.
 */
export function solarPosition(input: {
  at: Coordinate
  year: number
  month: number
  day: number
  /** Hours UTC, decimal. 13.5 is half past one in the afternoon. */
  utcHour: number
}): SolarReport | GeodesyError {
  const bad = checkCoordinate(input.at, 'given')
  if (bad) return bad
  const { year, month, day, utcHour } = input
  for (const [name, value] of Object.entries({ year, month, day, utcHour })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail('out-of-range', 'The month is a whole number from 1 to 12.')
  if (!Number.isInteger(day) || day < 1 || day > 31) return fail('out-of-range', 'The day is a whole number from 1 to 31.')
  if (utcHour < 0 || utcHour >= 24) return fail('out-of-range', 'The UTC hour runs from 0 up to but not including 24.')

  // Julian day from the calendar date, by the standard civil-calendar formula.
  const y = month <= 2 ? year - 1 : year
  const m = month <= 2 ? month + 12 : month
  const A = Math.floor(y / 100)
  const B = 2 - A + Math.floor(A / 4)
  const jd =
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5 + utcHour / 24

  const n = jd - 2451545.0
  const meanLongitude = (280.46 + 0.9856474 * n) % 360
  const meanAnomaly = rad((357.528 + 0.9856003 * n) % 360)
  const eclipticLongitude = rad(
    meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)
  )
  const obliquity = rad(23.439 - 0.0000004 * n)
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude))

  // The equation of time: the gap between apparent and mean solar time.
  let equationOfTime = 4 * (deg(rightAscension) - meanLongitude)
  while (equationOfTime > 20) equationOfTime -= 1440
  while (equationOfTime < -20) equationOfTime += 1440

  const solarNoonUtc = 12 - input.at.longitudeDegrees / 15 - equationOfTime / 60
  const hourAngle = rad(15 * (utcHour + input.at.longitudeDegrees / 15 + equationOfTime / 60 - 12))

  const phi = rad(input.at.latitudeDegrees)
  const sinElevation =
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)))
  const azimuth =
    (deg(
      Math.atan2(
        -Math.cos(declination) * Math.sin(hourAngle),
        Math.sin(declination) * Math.cos(phi) - Math.cos(declination) * Math.sin(phi) * Math.cos(hourAngle)
      )
    ) +
      360) %
    360

  const elevationDegrees = deg(elevation)
  const daylight = elevationDegrees > 0
  // Kasten and Young, which stays finite at the horizon where the simple 1/sin does not.
  const airMass = daylight
    ? 1 / (Math.sin(elevation) + 0.50572 * Math.pow(elevationDegrees + 6.07995, -1.6364))
    : null

  const warnings: string[] = []
  if (Math.abs(elevationDegrees) < 1) {
    warnings.push(
      'The sun is within a degree of the horizon. Atmospheric refraction lifts it by about half a degree there and is not applied here, so a sunrise or sunset timed from this will be a couple of minutes late.'
    )
  }

  return {
    elevation: elevationDegrees,
    azimuth,
    declination: deg(declination),
    equationOfTime,
    solarNoon: ((solarNoonUtc % 24) + 24) % 24,
    daylight,
    relativeIntensity: Math.max(0, sinElevation),
    airMass,
    notes: Object.freeze([
      `The sun is ${elevationDegrees.toFixed(2)} degrees ${daylight ? 'above' : 'below'} the horizon, bearing ${azimuth.toFixed(1)} degrees from true north.`,
      `Direct sunlight on level ground here is ${(Math.max(0, sinElevation) * 100).toFixed(1)}% of what it would be with the sun overhead. That single factor, not distance from the sun, is what makes winter cold.`,
      `The equation of time today is ${equationOfTime.toFixed(2)} minutes, so solar noon is that far from mean noon. It swings by about half an hour over a year because the Earth's orbit is an ellipse and its axis is tilted.`,
      'Refraction is not applied and no correction is made for altitude.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface DaylightReport {
  /** Hours UTC, decimal. Null when the sun does not cross the horizon that day. */
  sunrise: number | null
  sunset: number | null
  /** Hours. */
  dayLength: number
  /** What the sun does all day, when it never rises or never sets. */
  condition: 'normal' | 'polar-day' | 'polar-night'
  /** Degrees. The highest the sun gets. */
  maximumElevation: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Sunrise, sunset and day length, with polar day and polar night as their own answers.
 *
 * Above the Arctic circle in June the sun does not set and the equation has no solution — which is a fact about
 * the place, not a failure. Returning a made-up time, or a zero, would hide it.
 */
export function daylightHours(input: {
  at: Coordinate
  year: number
  month: number
  day: number
}): DaylightReport | GeodesyError {
  const noon = solarPosition({ ...input, utcHour: 12 })
  if (isGeodesyError(noon)) return noon

  const phi = rad(input.at.latitudeDegrees)
  const declination = rad(noon.declination)
  // The standard zenith for sunrise: 90 degrees plus 50 arcminutes for refraction and the sun's own radius.
  const zenith = rad(90.833)
  const cosHourAngle =
    (Math.cos(zenith) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination))

  const maximumElevation = 90 - Math.abs(deg(phi) - deg(declination))

  if (cosHourAngle > 1) {
    return {
      sunrise: null,
      sunset: null,
      dayLength: 0,
      condition: 'polar-night',
      maximumElevation,
      notes: Object.freeze([
        'The sun does not rise at all on this day at this latitude. That is polar night, not a calculation that failed.',
        `The sun's highest point today is ${maximumElevation.toFixed(2)} degrees, which is below the horizon.`
      ]),
      warnings: Object.freeze([])
    }
  }
  if (cosHourAngle < -1) {
    return {
      sunrise: null,
      sunset: null,
      dayLength: 24,
      condition: 'polar-day',
      maximumElevation,
      notes: Object.freeze([
        'The sun does not set at all on this day at this latitude. That is polar day; there is no sunrise time to give.',
        `It circles the sky, reaching ${maximumElevation.toFixed(2)} degrees at its highest and staying above the horizon at its lowest.`
      ]),
      warnings: Object.freeze([])
    }
  }

  const hourAngle = deg(Math.acos(cosHourAngle)) / 15
  const solarNoonUtc = 12 - input.at.longitudeDegrees / 15 - noon.equationOfTime / 60
  const wrap = (hours: number): number => ((hours % 24) + 24) % 24

  return {
    sunrise: wrap(solarNoonUtc - hourAngle),
    sunset: wrap(solarNoonUtc + hourAngle),
    dayLength: 2 * hourAngle,
    condition: 'normal',
    maximumElevation,
    notes: Object.freeze([
      `The day is ${(2 * hourAngle).toFixed(3)} hours long. Times are UTC — convert for the local clock, and remember a time zone is a political boundary rather than a line of longitude.`,
      'The 50 arcminutes usually allowed for refraction and the sun’s own width are included, which is why the day comes out a few minutes longer than pure geometry gives.',
      `The sun reaches ${maximumElevation.toFixed(2)} degrees at its highest today.`
    ]),
    warnings: Object.freeze([])
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const GEODESY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Coordinates are geodetic latitude and longitude in degrees, and every function names which is which. A bare pair of numbers is ambiguous and is not accepted.',
  'Distances on the ellipsoid use Vincenty, which is iterated and reports how many passes it took — and reports failure for nearly antipodal points rather than guessing.',
  'The spherical answer is given alongside the ellipsoidal one so the size of that approximation is visible.',
  'All bearings are from true north. Magnetic declination is not applied; it varies by place and by year.',
  'Heights are not handled. Height above the ellipsoid and height above sea level differ by up to a hundred metres and neither is simply "altitude".',
  'Solar positions take the date and UTC hour as arguments. Nothing here reads the system clock.',
  'Atmospheric refraction is not applied to solar positions, except for the standard allowance in sunrise and sunset times, where it is named.'
])
