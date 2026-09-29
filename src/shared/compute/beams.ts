/**
 * Beams and the sections they are cut from: what they carry, how far they sag, and when they give up.
 *
 * The shared strength-of-materials engine for Orbis Pages. Shear and moment diagrams are integrated from the
 * actual loads, deflection from the actual moment, and stress from the actual section — nothing here is a
 * remembered formula for a named textbook case.
 *
 * ## The sign convention, stated rather than assumed
 *
 * Engineering beam sign conventions disagree between countries and between textbooks, and each is internally
 * consistent. This engine uses:
 *
 * ```
 * Loads          positive downward
 * Shear V(x)     positive when the left-hand part pushes the right-hand part up
 * Moment M(x)    positive sagging -- the beam curves like a smile and the top is in compression
 * Deflection     positive downward, so a loaded beam has positive deflection
 * ```
 *
 * A Page that shows a moment diagram without the convention has shown a curve that is upside down in half the
 * world's classrooms, so `convention` travels on every result.
 *
 * ## Why the second moment of area is not a measure of size
 *
 * Doubling a beam's depth multiplies its second moment by eight and its deflection resistance with it, while
 * doubling its width only doubles them. That is why joists are deep and thin rather than square, and it is why the
 * section calculator reports `I` about both axes rather than one: a beam laid the wrong way round is a different
 * beam.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * stress       vs  strain         -- force per area against fractional stretch
 * strength     vs  stiffness      -- when it breaks against how much it bends
 * yield        vs  fracture       -- where it stops springing back against where it parts
 * I            vs  Z              -- second moment against section modulus; one is I/c
 * buckling     vs  crushing       -- a stability failure against a strength one, and slenderness decides which
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface BeamError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'too-many'
    | 'unsupported-case'
    | 'degenerate'
    | 'outside-range'
    | 'no-data'
  message: string
}

export const isBeamError = (value: unknown): value is BeamError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: BeamError['error'], message: string): BeamError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const BEAM_LIMITS = Object.freeze({
  loads: 200,
  stations: 4000,
  sweepPoints: 2000
})

/** The one convention everything here uses, carried on every result so it never has to be guessed. */
export const BEAM_CONVENTION = Object.freeze({
  name: 'Sagging-positive, downward loads',
  loads: 'Positive loads act downward.',
  shear: 'V(x) is positive when the part to the left of the cut pushes the part to the right upward.',
  moment: 'M(x) is positive sagging: the beam curves like a smile, the top fibre is compressed and the bottom stretched.',
  deflection: 'Positive deflection is downward, so an ordinary loaded beam deflects positively.'
})

// ---------------------------------------------------------------- section properties

export type SectionShape =
  | 'rectangle'
  | 'circle'
  | 'hollow-circle'
  | 'hollow-rectangle'
  | 'i-section'
  | 't-section'
  | 'channel'

export const SECTION_SHAPES: readonly SectionShape[] = Object.freeze([
  'rectangle',
  'circle',
  'hollow-circle',
  'hollow-rectangle',
  'i-section',
  't-section',
  'channel'
])

export const SECTION_FACTS: Readonly<Record<SectionShape, { label: string; needs: readonly string[]; describe: string }>> =
  Object.freeze({
    rectangle: {
      label: 'Rectangle',
      needs: Object.freeze(['width', 'height']),
      describe: 'The simplest section. I about the strong axis is bh^3/12, which is why depth matters so much more than width.'
    },
    circle: {
      label: 'Solid circle',
      needs: Object.freeze(['diameter']),
      describe: 'Equally stiff in every direction, which is why shafts are round.'
    },
    'hollow-circle': {
      label: 'Hollow circle',
      needs: Object.freeze(['outerDiameter', 'innerDiameter']),
      describe: 'Nearly as stiff as solid for a fraction of the material, because the middle carries almost no bending stress.'
    },
    'hollow-rectangle': {
      label: 'Hollow rectangle',
      needs: Object.freeze(['width', 'height', 'thickness']),
      describe: 'A box section. Good in bending and far better in torsion than an open section of the same weight.'
    },
    'i-section': {
      label: 'I-section',
      needs: Object.freeze(['height', 'flangeWidth', 'flangeThickness', 'webThickness']),
      describe: 'Material moved to where the bending stress is highest. Very efficient about the strong axis and weak about the other.'
    },
    't-section': {
      label: 'T-section',
      needs: Object.freeze(['height', 'flangeWidth', 'flangeThickness', 'webThickness']),
      describe: 'Unsymmetric, so the centroid is not at mid-depth and the top and bottom stresses differ.'
    },
    channel: {
      label: 'Channel',
      needs: Object.freeze(['height', 'flangeWidth', 'flangeThickness', 'webThickness']),
      describe: 'Unsymmetric about the vertical axis. Loading it through the centroid twists it; it has to be loaded through the shear centre.'
    }
  })

export interface SectionReport {
  shape: SectionShape
  /** m². */
  area: number
  /** Metres, from the bottom of the section. */
  centroidY: number
  /** Second moment about the horizontal centroidal axis. The one that resists ordinary bending. */
  ixx: number
  /** Second moment about the vertical centroidal axis. What resists bending the other way. */
  iyy: number
  /** Metres. Distance from the centroid to the extreme fibre, top and bottom. */
  topDistance: number
  bottomDistance: number
  /** m³. I/c for each face. The unsymmetric sections have two different values, and that is the point. */
  sectionModulusTop: number
  sectionModulusBottom: number
  /** Metres. sqrt(I/A), which is what slenderness is measured in. */
  radiusOfGyrationX: number
  radiusOfGyrationY: number
  /** m⁴. Only for shapes where a closed form exists; null for open sections where it needs a different model. */
  polarMoment: number | null
  symmetric: boolean
  notes: readonly string[]
}

/**
 * Section properties from geometry, computed rather than looked up.
 *
 * Unsymmetric sections get two section moduli, top and bottom, because their extreme fibres are different
 * distances from the neutral axis and therefore see different stresses under the same moment. Reporting one
 * number for a T-section describes the less-stressed face and calls it the section.
 */
export function sectionProperties(input: {
  shape: SectionShape
  width?: number
  height?: number
  diameter?: number
  outerDiameter?: number
  innerDiameter?: number
  thickness?: number
  flangeWidth?: number
  flangeThickness?: number
  webThickness?: number
}): SectionReport | BeamError {
  const { shape } = input
  const need = (name: string): number | BeamError => {
    const value = (input as unknown as Record<string, number | undefined>)[name]
    if (value === undefined) {
      return fail('invalid-argument', `A ${SECTION_FACTS[shape].label.toLowerCase()} needs ${SECTION_FACTS[shape].needs.join(', ')}. "${name}" is missing.`)
    }
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
    return value
  }

  let area: number
  let ixx: number
  let iyy: number
  let centroidY: number
  let height: number
  let polar: number | null = null
  let symmetric = true

  switch (shape) {
    case 'rectangle': {
      const b = need('width')
      if (isBeamError(b)) return b
      const h = need('height')
      if (isBeamError(h)) return h
      area = b * h
      ixx = (b * h * h * h) / 12
      iyy = (h * b * b * b) / 12
      centroidY = h / 2
      height = h
      break
    }
    case 'circle': {
      const d = need('diameter')
      if (isBeamError(d)) return d
      const r = d / 2
      area = Math.PI * r * r
      ixx = (Math.PI * Math.pow(d, 4)) / 64
      iyy = ixx
      centroidY = r
      height = d
      polar = (Math.PI * Math.pow(d, 4)) / 32
      break
    }
    case 'hollow-circle': {
      const outer = need('outerDiameter')
      if (isBeamError(outer)) return outer
      const inner = need('innerDiameter')
      if (isBeamError(inner)) return inner
      if (inner >= outer) return fail('invalid-argument', 'The inner diameter has to be smaller than the outer one.')
      area = (Math.PI / 4) * (outer * outer - inner * inner)
      ixx = (Math.PI * (Math.pow(outer, 4) - Math.pow(inner, 4))) / 64
      iyy = ixx
      centroidY = outer / 2
      height = outer
      polar = (Math.PI * (Math.pow(outer, 4) - Math.pow(inner, 4))) / 32
      break
    }
    case 'hollow-rectangle': {
      const b = need('width')
      if (isBeamError(b)) return b
      const h = need('height')
      if (isBeamError(h)) return h
      const t = need('thickness')
      if (isBeamError(t)) return t
      if (2 * t >= Math.min(b, h)) {
        return fail('invalid-argument', 'The wall thickness is more than half the smaller dimension, so there is no hole left.')
      }
      const bi = b - 2 * t
      const hi = h - 2 * t
      area = b * h - bi * hi
      ixx = (b * h * h * h - bi * hi * hi * hi) / 12
      iyy = (h * b * b * b - hi * bi * bi * bi) / 12
      centroidY = h / 2
      height = h
      break
    }
    case 'i-section': {
      const h = need('height')
      if (isBeamError(h)) return h
      const bf = need('flangeWidth')
      if (isBeamError(bf)) return bf
      const tf = need('flangeThickness')
      if (isBeamError(tf)) return tf
      const tw = need('webThickness')
      if (isBeamError(tw)) return tw
      if (2 * tf >= h) return fail('invalid-argument', 'The two flanges are thicker than the section is deep, so there is no web.')
      if (tw >= bf) return fail('invalid-argument', 'The web is wider than the flange, which describes no I-section.')
      const hw = h - 2 * tf
      area = 2 * bf * tf + tw * hw
      // Both flanges by parallel axis, plus the web about its own centroid.
      ixx = (tw * hw * hw * hw) / 12 + 2 * ((bf * tf * tf * tf) / 12 + bf * tf * Math.pow((h - tf) / 2, 2))
      iyy = (2 * tf * bf * bf * bf) / 12 + (hw * tw * tw * tw) / 12
      centroidY = h / 2
      height = h
      break
    }
    case 't-section': {
      const h = need('height')
      if (isBeamError(h)) return h
      const bf = need('flangeWidth')
      if (isBeamError(bf)) return bf
      const tf = need('flangeThickness')
      if (isBeamError(tf)) return tf
      const tw = need('webThickness')
      if (isBeamError(tw)) return tw
      if (tf >= h) return fail('invalid-argument', 'The flange is thicker than the section is deep.')
      const hw = h - tf
      const aFlange = bf * tf
      const aWeb = tw * hw
      area = aFlange + aWeb
      // Measured from the bottom of the web; the flange sits on top.
      const yFlange = hw + tf / 2
      const yWeb = hw / 2
      centroidY = (aFlange * yFlange + aWeb * yWeb) / area
      ixx =
        (bf * tf * tf * tf) / 12 +
        aFlange * Math.pow(yFlange - centroidY, 2) +
        (tw * hw * hw * hw) / 12 +
        aWeb * Math.pow(yWeb - centroidY, 2)
      iyy = (tf * bf * bf * bf) / 12 + (hw * tw * tw * tw) / 12
      height = h
      symmetric = false
      break
    }
    default: {
      // channel
      const h = need('height')
      if (isBeamError(h)) return h
      const bf = need('flangeWidth')
      if (isBeamError(bf)) return bf
      const tf = need('flangeThickness')
      if (isBeamError(tf)) return tf
      const tw = need('webThickness')
      if (isBeamError(tw)) return tw
      if (2 * tf >= h) return fail('invalid-argument', 'The two flanges are thicker than the section is deep.')
      const hw = h - 2 * tf
      area = 2 * bf * tf + tw * hw
      ixx = (tw * hw * hw * hw) / 12 + 2 * ((bf * tf * tf * tf) / 12 + bf * tf * Math.pow((h - tf) / 2, 2))
      // Horizontal centroid measured from the back of the web, then parallel axis for Iyy.
      const aFlange = bf * tf
      const aWeb = tw * hw
      const xWeb = tw / 2
      const xFlange = bf / 2
      const cx = (2 * aFlange * xFlange + aWeb * xWeb) / area
      iyy =
        2 * ((tf * bf * bf * bf) / 12 + aFlange * Math.pow(xFlange - cx, 2)) +
        (hw * tw * tw * tw) / 12 +
        aWeb * Math.pow(xWeb - cx, 2)
      centroidY = h / 2
      height = h
      symmetric = false
      break
    }
  }

  const top = height - centroidY
  const bottom = centroidY
  const notes: string[] = [SECTION_FACTS[shape].describe]
  if (!symmetric) {
    notes.push(
      `The centroid is ${centroidY.toExponential(3)} m from the bottom rather than at mid-depth, so the top and bottom fibres are different distances away and see different stresses under the same moment. That is why there are two section moduli here and not one.`
    )
  }
  if (ixx / iyy > 4) {
    notes.push(
      `It is ${(ixx / iyy).toFixed(1)} times stiffer about the strong axis than the weak one. Laid the wrong way round it is a different beam.`
    )
  }
  if (shape === 'channel') {
    notes.push('A channel loaded through its centroid twists, because the shear centre is outside the section. Bending it cleanly needs the load applied there instead.')
  }
  if (polar === null && (shape === 'i-section' || shape === 't-section' || shape === 'channel')) {
    notes.push('No polar moment is given: open sections resist torsion by warping rather than by simple twisting, and J for them is not I_xx + I_yy.')
  }

  return {
    shape,
    area,
    centroidY,
    ixx,
    iyy,
    topDistance: top,
    bottomDistance: bottom,
    sectionModulusTop: top === 0 ? Number.POSITIVE_INFINITY : ixx / top,
    sectionModulusBottom: bottom === 0 ? Number.POSITIVE_INFINITY : ixx / bottom,
    radiusOfGyrationX: Math.sqrt(ixx / area),
    radiusOfGyrationY: Math.sqrt(iyy / area),
    polarMoment: polar,
    symmetric,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- beam analysis

export type BeamKind = 'simply-supported' | 'cantilever' | 'overhanging'

export const BEAM_KINDS: readonly BeamKind[] = Object.freeze(['simply-supported', 'cantilever', 'overhanging'])

export interface BeamPointLoad {
  magnitude: number
  position: number
  label?: string
}

export interface BeamDistributedLoad {
  startIntensity: number
  endIntensity: number
  start: number
  end: number
  label?: string
}

export interface BeamMoment {
  magnitude: number
  position: number
  label?: string
}

export interface Station {
  x: number
  /** Newtons. */
  shear: number
  /** Newton-metres. */
  moment: number
  /** Radians, when E and I were given. */
  slope: number | null
  /** Metres downward, when E and I were given. */
  deflection: number | null
}

export interface BeamAnalysis {
  kind: BeamKind
  length: number
  /** Where the supports ended up and what they carry. */
  reactions: readonly { label: string; position: number; force: number }[]
  stations: readonly Station[]
  maxShear: { value: number; at: number }
  maxMoment: { value: number; at: number }
  minMoment: { value: number; at: number }
  maxDeflection: { value: number; at: number } | null
  /** Where the moment crosses zero. The beam changes from sagging to hogging here. */
  inflectionPoints: readonly number[]
  convention: typeof BEAM_CONVENTION
  /** How far the integrated shear misses the total load by, as a check on the integration. */
  integrationResidual: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Analyse a beam: reactions, shear, moment, and deflection if the stiffness is known.
 *
 * Shear and moment are integrated from the loads rather than looked up, so any combination of point loads,
 * trapezoidal distributed loads and applied moments works — not only the handful of cases a textbook tabulates.
 * Deflection comes from integrating the moment twice and fitting the boundary conditions, which is why it needs
 * both E and I and returns null without them rather than guessing a stiffness.
 */
export function analyseBeam(input: {
  kind: BeamKind
  length: number
  /** For a simply supported or overhanging beam. A cantilever is fixed at x = 0 and needs neither. */
  supportA?: number
  supportB?: number
  pointLoads?: readonly BeamPointLoad[]
  distributedLoads?: readonly BeamDistributedLoad[]
  moments?: readonly BeamMoment[]
  youngsModulus?: number
  secondMoment?: number
  stations?: number
}): BeamAnalysis | BeamError {
  const { kind, length } = input
  if (!finite(length) || length <= 0) return fail('invalid-argument', 'The beam length has to be greater than zero.')

  const pointLoads = input.pointLoads ?? []
  const distributed = input.distributedLoads ?? []
  const moments = input.moments ?? []
  if (pointLoads.length + distributed.length + moments.length > BEAM_LIMITS.loads) {
    return fail('too-many', `That is more than the ${BEAM_LIMITS.loads} loads this handles.`)
  }
  for (const [i, one] of pointLoads.entries()) {
    if (!finite(one.magnitude) || !finite(one.position)) return fail('not-finite', `Point load ${i + 1} is not finite.`)
    if (one.position < 0 || one.position > length) return fail('invalid-argument', `Point load ${i + 1} is off the beam.`)
  }
  for (const [i, one] of distributed.entries()) {
    if (!finite(one.startIntensity) || !finite(one.endIntensity) || !finite(one.start) || !finite(one.end)) {
      return fail('not-finite', `Distributed load ${i + 1} is not finite.`)
    }
    if (one.end <= one.start) return fail('invalid-argument', `Distributed load ${i + 1} ends before it starts.`)
    if (one.start < 0 || one.end > length) return fail('invalid-argument', `Distributed load ${i + 1} runs off the beam.`)
  }
  for (const [i, one] of moments.entries()) {
    if (!finite(one.magnitude) || !finite(one.position)) return fail('not-finite', `Applied moment ${i + 1} is not finite.`)
    if (one.position < 0 || one.position > length) return fail('invalid-argument', `Applied moment ${i + 1} is off the beam.`)
  }

  // Resolve supports.
  let a: number
  let b: number | null
  if (kind === 'cantilever') {
    a = 0
    b = null
  } else {
    a = input.supportA ?? 0
    b = input.supportB ?? length
    if (!finite(a) || !finite(b)) return fail('not-finite', 'The support positions have to be finite.')
    if (a < 0 || b > length) return fail('invalid-argument', 'The supports have to sit on the beam.')
    if (Math.abs(b - a) < length * 1e-9) {
      return fail('degenerate', 'The two supports are at the same place, so the beam can spin about them. Move one.')
    }
    if (kind === 'simply-supported' && (Math.abs(a) > length * 1e-9 || Math.abs(b - length) > length * 1e-9)) {
      // Supports inboard of the ends make it an overhanging beam; say so rather than silently reclassifying.
      return fail(
        'invalid-argument',
        'A simply supported beam has its supports at the two ends. With the supports inboard it is an overhanging beam — use kind "overhanging".'
      )
    }
  }

  // Total load and its moment about x = 0, treating each distributed load exactly.
  const equivalents: { magnitude: number; position: number }[] = distributed.map((one) => {
    const span = one.end - one.start
    const total = ((one.startIntensity + one.endIntensity) / 2) * span
    const sum = one.startIntensity + one.endIntensity
    const offset = sum === 0 ? span / 2 : (span * (one.startIntensity + 2 * one.endIntensity)) / (3 * sum)
    return { magnitude: total, position: one.start + offset }
  })
  const allPoint = [...pointLoads.map((one) => ({ magnitude: one.magnitude, position: one.position })), ...equivalents]
  const totalLoad = allPoint.reduce((sum, one) => sum + one.magnitude, 0)
  const loadMoment = allPoint.reduce((sum, one) => sum + one.magnitude * one.position, 0)
  const appliedMoment = moments.reduce((sum, one) => sum + one.magnitude, 0)

  const reactions: { label: string; position: number; force: number }[] = []
  let fixedEndMoment = 0
  if (kind === 'cantilever') {
    reactions.push({ label: 'fixed end', position: 0, force: totalLoad })
    // The wall also supplies a moment: everything the loads apply about the root.
    fixedEndMoment = loadMoment - appliedMoment
  } else {
    // Moments about A: Rb*(b-a) = sum(W*(x-a)) - sum(applied moments)
    const rb = (loadMoment - totalLoad * a - appliedMoment) / ((b as number) - a)
    const ra = totalLoad - rb
    reactions.push({ label: 'support A', position: a, force: ra }, { label: 'support B', position: b as number, force: rb })
  }

  const count = Math.round(input.stations ?? 400)
  if (!Number.isInteger(count) || count < 3 || count > BEAM_LIMITS.stations) {
    return fail('invalid-argument', `The station count has to be a whole number between 3 and ${BEAM_LIMITS.stations}.`)
  }

  // Shear and moment at a cut, from everything to the left of it.
  const shearAt = (x: number): number => {
    let v = 0
    for (const one of reactions) if (one.position <= x + 1e-12) v += one.force
    for (const one of pointLoads) if (one.position <= x - 1e-12) v -= one.magnitude
    for (const one of distributed) {
      if (x <= one.start) continue
      const to = Math.min(x, one.end)
      const span = to - one.start
      const full = one.end - one.start
      const intensityAtTo = one.startIntensity + ((one.endIntensity - one.startIntensity) * span) / full
      v -= ((one.startIntensity + intensityAtTo) / 2) * span
    }
    return v
  }

  const momentAt = (x: number): number => {
    let m = 0
    for (const one of reactions) if (one.position <= x + 1e-12) m += one.force * (x - one.position)
    for (const one of pointLoads) if (one.position <= x - 1e-12) m -= one.magnitude * (x - one.position)
    for (const one of moments) if (one.position <= x - 1e-12) m -= one.magnitude
    if (kind === 'cantilever') m -= fixedEndMoment
    for (const one of distributed) {
      if (x <= one.start) continue
      const to = Math.min(x, one.end)
      const span = to - one.start
      const full = one.end - one.start
      const intensityAtTo = one.startIntensity + ((one.endIntensity - one.startIntensity) * span) / full
      const resultant = ((one.startIntensity + intensityAtTo) / 2) * span
      const sum = one.startIntensity + intensityAtTo
      const arm = sum === 0 ? span / 2 : (span * (one.startIntensity + 2 * intensityAtTo)) / (3 * sum)
      m -= resultant * (x - (one.start + arm))
    }
    return m
  }

  // Sample, including a point either side of every discontinuity so a jump is visible rather than averaged away.
  const breaks = new Set<number>([0, length])
  for (const one of pointLoads) breaks.add(one.position)
  for (const one of moments) breaks.add(one.position)
  for (const one of distributed) {
    breaks.add(one.start)
    breaks.add(one.end)
  }
  for (const one of reactions) breaks.add(one.position)

  const xs: number[] = []
  for (let i = 0; i < count; i += 1) xs.push((length * i) / (count - 1))
  for (const at of breaks) {
    const epsilon = length * 1e-9
    if (at > epsilon) xs.push(at - epsilon)
    if (at < length - epsilon) xs.push(at + epsilon)
    xs.push(at)
  }
  xs.sort((p, q) => p - q)
  const unique = xs.filter((one, i) => i === 0 || one - xs[i - 1] > length * 1e-12)

  const stations: Station[] = unique.map((x) => ({ x, shear: shearAt(x), moment: momentAt(x), slope: null, deflection: null }))

  // Deflection: integrate M/(EI) twice by the trapezium rule, then fit the boundary conditions.
  const e = input.youngsModulus
  const i2 = input.secondMoment
  let maxDeflection: BeamAnalysis['maxDeflection'] = null
  if (e !== undefined && i2 !== undefined) {
    if (!finite(e) || e <= 0) return fail('invalid-argument', "Young's modulus has to be greater than zero.")
    if (!finite(i2) || i2 <= 0) return fail('invalid-argument', 'The second moment of area has to be greater than zero.')
    const ei = e * i2
    const theta: number[] = new Array(stations.length).fill(0)
    const y: number[] = new Array(stations.length).fill(0)
    for (let k = 1; k < stations.length; k += 1) {
      const dx = stations[k].x - stations[k - 1].x
      theta[k] = theta[k - 1] + ((stations[k].moment + stations[k - 1].moment) / 2 / ei) * dx
    }
    for (let k = 1; k < stations.length; k += 1) {
      const dx = stations[k].x - stations[k - 1].x
      y[k] = y[k - 1] + ((theta[k] + theta[k - 1]) / 2) * dx
    }

    // Fit y = y_particular + c1*x + c0 to the supports.
    const valueAt = (target: number, series: number[]): number => {
      let best = 0
      let bestGap = Number.POSITIVE_INFINITY
      for (let k = 0; k < stations.length; k += 1) {
        const gap = Math.abs(stations[k].x - target)
        if (gap < bestGap) {
          bestGap = gap
          best = series[k]
        }
      }
      return best
    }

    let c1 = 0
    let c0 = 0
    if (kind === 'cantilever') {
      // Fixed at x = 0: zero deflection and zero slope there.
      c1 = -theta[0]
      c0 = -(y[0] + c1 * stations[0].x)
    } else {
      const ya = valueAt(a, y)
      const yb = valueAt(b as number, y)
      c1 = -(yb - ya) / ((b as number) - a)
      c0 = -(ya + c1 * a)
    }

    let worst = { value: 0, at: 0 }
    for (let k = 0; k < stations.length; k += 1) {
      // The sign flip turns the mathematical curvature into downward-positive deflection.
      const deflection = -(y[k] + c1 * stations[k].x + c0)
      stations[k].slope = -(theta[k] + c1)
      stations[k].deflection = deflection
      if (Math.abs(deflection) > Math.abs(worst.value)) worst = { value: deflection, at: stations[k].x }
    }
    maxDeflection = worst
  }

  let maxShear = { value: 0, at: 0 }
  let maxMoment = { value: Number.NEGATIVE_INFINITY, at: 0 }
  let minMoment = { value: Number.POSITIVE_INFINITY, at: 0 }
  for (const one of stations) {
    if (Math.abs(one.shear) > Math.abs(maxShear.value)) maxShear = { value: one.shear, at: one.x }
    if (one.moment > maxMoment.value) maxMoment = { value: one.moment, at: one.x }
    if (one.moment < minMoment.value) minMoment = { value: one.moment, at: one.x }
  }

  const inflections: number[] = []
  for (let k = 1; k < stations.length; k += 1) {
    const before = stations[k - 1].moment
    const after = stations[k].moment
    if (before === 0 || (before < 0) !== (after < 0)) {
      if (Math.abs(after - before) > 1e-12) {
        inflections.push(stations[k - 1].x + ((stations[k].x - stations[k - 1].x) * -before) / (after - before))
      }
    }
  }

  const endShear = shearAt(length + length * 1e-9)
  const residual = Math.abs(endShear)
  const warnings: string[] = []
  if (residual > Math.max(Math.abs(totalLoad), 1) * 1e-6) {
    warnings.push(`The shear does not return to zero at the far end; it is out by ${residual.toExponential(2)} N. That means the reactions and the loads do not balance.`)
  }
  if (e === undefined || i2 === undefined) {
    warnings.push("No deflection was calculated: that needs Young's modulus and the second moment of area, and guessing a stiffness would answer a different question.")
  }

  const notes: string[] = [
    'Shear and moment are integrated from the actual loads, so any combination of point, distributed and applied-moment loading works rather than only the tabulated textbook cases.'
  ]
  if (inflections.length > 0) {
    notes.push(
      `The moment changes sign ${inflections.length === 1 ? 'once' : `${inflections.length} times`}. At those points the beam stops sagging and starts hogging, and the fibre that was in tension goes into compression.`
    )
  }
  if (kind === 'cantilever') {
    notes.push('A cantilever carries its largest moment at the wall, which is why that is where it breaks.')
  }

  return {
    kind,
    length,
    reactions: Object.freeze(reactions),
    stations: Object.freeze(stations),
    maxShear,
    maxMoment,
    minMoment,
    maxDeflection,
    inflectionPoints: Object.freeze(inflections),
    convention: BEAM_CONVENTION,
    integrationResidual: residual,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- stress

export interface StressState {
  /** Pa. Normal stress along x. */
  sigmaX: number
  /** Pa. Normal stress along y. */
  sigmaY: number
  /** Pa. Shear stress on the xy face. */
  tauXY: number
}

export interface MohrReport {
  state: StressState
  /** Pa. The larger and smaller principal stresses. */
  principal1: number
  principal2: number
  /** Degrees. The angle to rotate the element by to reach the principal directions. */
  principalAngleDegrees: number
  /** Pa. */
  maximumShear: number
  /** Degrees. */
  maximumShearAngleDegrees: number
  /** Pa. The centre of Mohr's circle: the average normal stress, and it does not change with rotation. */
  centre: number
  radius: number
  /** Pa. The third principal stress, which is zero in plane stress and is not ignorable. */
  principal3: number
  /** Pa. The largest shear in three dimensions, which can exceed the in-plane one. */
  absoluteMaximumShear: number
  notes: readonly string[]
}

/**
 * Mohr's circle: principal stresses and maximum shear from a plane stress state.
 *
 * The third principal stress is reported even though plane stress makes it zero, because the *absolute* maximum
 * shear is half the difference between the largest and smallest of all three — and when both in-plane principals
 * have the same sign, the governing shear involves that zero. A Page reporting only the in-plane maximum shear is
 * under-reporting exactly the cases where it matters.
 */
export function mohrsCircle(state: StressState): MohrReport | BeamError {
  const { sigmaX, sigmaY, tauXY } = state
  for (const [name, value] of Object.entries(state)) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }

  const centre = (sigmaX + sigmaY) / 2
  const radius = Math.hypot((sigmaX - sigmaY) / 2, tauXY)
  const p1 = centre + radius
  const p2 = centre - radius
  const angle = 0.5 * Math.atan2(2 * tauXY, sigmaX - sigmaY)

  const p3 = 0
  const all = [p1, p2, p3].sort((a, b) => b - a)
  const absoluteMax = (all[0] - all[2]) / 2

  const notes: string[] = [
    'The centre of the circle is the average normal stress. Rotating the element moves a point round the circle; it never moves the centre.'
  ]
  if (Math.abs(absoluteMax - radius) > radius * 1e-9) {
    notes.push(
      `Both in-plane principal stresses have the same sign, so the largest shear in the material is not the in-plane one. It is ${absoluteMax.toExponential(3)} Pa against the in-plane ${radius.toExponential(3)} Pa, and it acts on a plane out of the page — which is the one that would actually yield.`
    )
  }
  if (Math.abs(tauXY) < Math.abs(centre) * 1e-12 && Math.abs(sigmaX - sigmaY) < Math.abs(centre) * 1e-12) {
    notes.push('The stress is the same in every direction, so the circle is a point and there are no preferred planes.')
  }

  return {
    state,
    principal1: p1,
    principal2: p2,
    principalAngleDegrees: (angle * 180) / Math.PI,
    maximumShear: radius,
    maximumShearAngleDegrees: ((angle + Math.PI / 4) * 180) / Math.PI,
    centre,
    radius,
    principal3: p3,
    absoluteMaximumShear: absoluteMax,
    notes: Object.freeze(notes)
  }
}

export type FailureCriterion = 'max-normal-stress' | 'max-shear-stress' | 'distortion-energy'

export const FAILURE_CRITERIA: readonly FailureCriterion[] = Object.freeze([
  'max-normal-stress',
  'max-shear-stress',
  'distortion-energy'
])

export const FAILURE_FACTS: Readonly<
  Record<FailureCriterion, { label: string; suitsFor: string; describe: string }>
> = Object.freeze({
  'max-normal-stress': {
    label: 'Maximum normal stress (Rankine)',
    suitsFor: 'Brittle materials: cast iron, ceramics, concrete.',
    describe: 'Fails when the largest principal stress reaches the strength. Brittle materials part along a plane rather than yielding.'
  },
  'max-shear-stress': {
    label: 'Maximum shear stress (Tresca)',
    suitsFor: 'Ductile materials. Conservative.',
    describe: 'Yields when the largest shear reaches half the tensile yield. Always predicts failure at or before the distortion-energy criterion.'
  },
  'distortion-energy': {
    label: 'Distortion energy (von Mises)',
    suitsFor: 'Ductile materials. Matches test data best.',
    describe: 'Yields when the distortion energy reaches what a tensile test at yield would store. The standard ductile criterion.'
  }
})

export interface FailureReport {
  criterion: FailureCriterion
  label: string
  /** Pa. The single number the criterion compares against the strength. */
  effectiveStress: number
  strength: number
  factorOfSafety: number
  safe: boolean
  /** All three criteria, so the choice is visible rather than hidden. */
  comparison: readonly { criterion: FailureCriterion; label: string; effectiveStress: number; factorOfSafety: number }[]
  suitsFor: string
  notes: readonly string[]
}

/**
 * Check a stress state against a failure criterion, and show what the other criteria would have said.
 *
 * The criterion is a modelling choice and it changes the answer by up to 15% between Tresca and von Mises. Showing
 * only the selected one hides that the choice was made; showing all three makes it a decision rather than a
 * default.
 */
export function checkFailure(input: {
  state: StressState
  strength: number
  criterion?: FailureCriterion
}): FailureReport | BeamError {
  const { strength } = input
  if (!finite(strength) || strength <= 0) return fail('invalid-argument', 'The strength has to be greater than zero.')
  const circle = mohrsCircle(input.state)
  if (isBeamError(circle)) return circle
  const criterion = input.criterion ?? 'distortion-energy'
  if (!FAILURE_CRITERIA.includes(criterion)) {
    return fail('invalid-argument', `"${criterion}" is not one of the criteria this knows: ${FAILURE_CRITERIA.join(', ')}.`)
  }

  const { principal1: p1, principal2: p2, principal3: p3 } = circle
  const effective = (which: FailureCriterion): number => {
    switch (which) {
      case 'max-normal-stress':
        return Math.max(Math.abs(p1), Math.abs(p2), Math.abs(p3))
      case 'max-shear-stress':
        // Tresca: the full range between largest and smallest principal.
        return Math.max(p1, p2, p3) - Math.min(p1, p2, p3)
      default:
        // von Mises, from the three principals.
        return Math.sqrt(((p1 - p2) ** 2 + (p2 - p3) ** 2 + (p3 - p1) ** 2) / 2)
    }
  }

  const comparison = FAILURE_CRITERIA.map((one) => {
    const value = effective(one)
    return {
      criterion: one,
      label: FAILURE_FACTS[one].label,
      effectiveStress: value,
      factorOfSafety: value === 0 ? Number.POSITIVE_INFINITY : strength / value
    }
  })
  const chosen = comparison.find((one) => one.criterion === criterion) as (typeof comparison)[number]

  const tresca = comparison.find((one) => one.criterion === 'max-shear-stress') as (typeof comparison)[number]
  const mises = comparison.find((one) => one.criterion === 'distortion-energy') as (typeof comparison)[number]
  const notes: string[] = [
    FAILURE_FACTS[criterion].describe,
    `Suits: ${FAILURE_FACTS[criterion].suitsFor}`
  ]
  if (mises.effectiveStress > 0) {
    notes.push(
      `Tresca and von Mises differ by ${(((tresca.effectiveStress - mises.effectiveStress) / mises.effectiveStress) * 100).toFixed(1)}% here. Tresca is the conservative one and never predicts failure later.`
    )
  }
  notes.push('Yield strength and ultimate strength are different numbers. Which one belongs here depends on whether the part must not deform or must not break.')

  return {
    criterion,
    label: FAILURE_FACTS[criterion].label,
    effectiveStress: chosen.effectiveStress,
    strength,
    factorOfSafety: chosen.factorOfSafety,
    safe: chosen.factorOfSafety >= 1,
    comparison: Object.freeze(comparison),
    suitsFor: FAILURE_FACTS[criterion].suitsFor,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- buckling

export type EndCondition = 'pinned-pinned' | 'fixed-free' | 'fixed-fixed' | 'fixed-pinned'

export const END_CONDITIONS: readonly EndCondition[] = Object.freeze([
  'pinned-pinned',
  'fixed-free',
  'fixed-fixed',
  'fixed-pinned'
])

export const END_FACTS: Readonly<Record<EndCondition, { label: string; factor: number; describe: string }>> =
  Object.freeze({
    'pinned-pinned': { label: 'Pinned both ends', factor: 1, describe: 'The reference case. Effective length equals the real length.' },
    'fixed-free': {
      label: 'Fixed one end, free the other',
      factor: 2,
      describe: 'A flagpole. Effective length is twice the real one, so it takes a quarter of the load.'
    },
    'fixed-fixed': {
      label: 'Fixed both ends',
      factor: 0.5,
      describe: 'Effective length is half, so it takes four times the pinned load — if the fixity is real.'
    },
    'fixed-pinned': { label: 'Fixed one end, pinned the other', factor: 0.699, describe: 'Between the two, and the factor is not a round number.' }
  })

export interface BucklingReport {
  /** Newtons. The Euler critical load. */
  criticalLoad: number
  /** Pa. */
  criticalStress: number
  effectiveLength: number
  effectiveLengthFactor: number
  endCondition: EndCondition
  slendernessRatio: number
  /** The slenderness below which Euler over-predicts because the column yields first. Null without a yield strength. */
  transitionSlenderness: number | null
  governs: 'buckling' | 'crushing' | 'unknown'
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Euler buckling, with the check that says when Euler does not apply.
 *
 * Euler's formula assumes the column is still elastic when it buckles. A short, stocky column yields before it
 * gets anywhere near the Euler load, and quoting the Euler number there over-predicts the capacity — sometimes by
 * a large factor. Giving a yield strength lets the engine say which failure actually governs instead of assuming.
 */
export function eulerBuckling(input: {
  youngsModulus: number
  secondMoment: number
  length: number
  endCondition?: EndCondition
  area?: number
  yieldStrength?: number
}): BucklingReport | BeamError {
  const { youngsModulus, secondMoment, length } = input
  for (const [name, value] of Object.entries({ youngsModulus, secondMoment, length })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const endCondition = input.endCondition ?? 'pinned-pinned'
  if (!END_CONDITIONS.includes(endCondition)) {
    return fail('invalid-argument', `"${endCondition}" is not an end condition this knows: ${END_CONDITIONS.join(', ')}.`)
  }
  const k = END_FACTS[endCondition].factor
  const effectiveLength = k * length
  const criticalLoad = (Math.PI * Math.PI * youngsModulus * secondMoment) / (effectiveLength * effectiveLength)

  const area = input.area
  let slenderness = Number.NaN
  let criticalStress = Number.NaN
  if (area !== undefined) {
    if (!finite(area) || area <= 0) return fail('invalid-argument', 'The area has to be greater than zero.')
    const radiusOfGyration = Math.sqrt(secondMoment / area)
    slenderness = effectiveLength / radiusOfGyration
    criticalStress = criticalLoad / area
  }

  let transition: number | null = null
  let governs: BucklingReport['governs'] = 'unknown'
  const warnings: string[] = []
  if (input.yieldStrength !== undefined && area !== undefined) {
    if (!finite(input.yieldStrength) || input.yieldStrength <= 0) {
      return fail('invalid-argument', 'The yield strength has to be greater than zero.')
    }
    // Where the Euler stress equals half the yield: the usual boundary for the elastic formula.
    transition = Math.PI * Math.sqrt((2 * youngsModulus) / input.yieldStrength)
    governs = slenderness >= transition ? 'buckling' : 'crushing'
    if (governs === 'crushing') {
      warnings.push(
        `The slenderness is ${slenderness.toFixed(1)}, below the transition at ${transition.toFixed(1)}. The column yields before it buckles, so the Euler load of ${criticalLoad.toExponential(3)} N over-predicts what it carries — the squash load of ${(input.yieldStrength * area).toExponential(3)} N is the real limit.`
      )
    }
  }

  const notes: string[] = [
    END_FACTS[endCondition].describe,
    'The load goes as one over the length squared. Doubling a column’s length quarters what it carries, which is why long thin things fail so suddenly.',
    'Buckling uses the *smaller* second moment of the section. A column buckles about its weak axis, whatever axis the bending was calculated for.'
  ]
  if (input.yieldStrength === undefined || area === undefined) {
    notes.push('Without a yield strength and an area this cannot say whether the column buckles or simply crushes. Euler assumes it is still elastic when it goes.')
  }

  return {
    criticalLoad,
    criticalStress,
    effectiveLength,
    effectiveLengthFactor: k,
    endCondition,
    slendernessRatio: slenderness,
    transitionSlenderness: transition,
    governs,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- torsion

export interface TorsionReport {
  /** Pa. Shear stress at the outside surface, where it is highest. */
  maximumShearStress: number
  /** Radians. */
  angleOfTwist: number
  angleOfTwistDegrees: number
  /** m⁴. */
  polarMoment: number
  /** Pa·m⁴/rad per metre — the torsional stiffness. */
  torsionalRigidity: number
  notes: readonly string[]
}

/** Torsion of a circular shaft. Only circular: other sections warp and this formula does not describe them. */
export function shaftTorsion(input: {
  torque: number
  outerDiameter: number
  innerDiameter?: number
  length?: number
  shearModulus?: number
}): TorsionReport | BeamError {
  const { torque, outerDiameter } = input
  const inner = input.innerDiameter ?? 0
  if (!finite(torque)) return fail('not-finite', 'The torque has to be a finite number.')
  if (!finite(outerDiameter) || outerDiameter <= 0) return fail('invalid-argument', 'The outer diameter has to be greater than zero.')
  if (!finite(inner) || inner < 0) return fail('invalid-argument', 'The inner diameter cannot be negative.')
  if (inner >= outerDiameter) return fail('invalid-argument', 'The inner diameter has to be smaller than the outer one.')

  const j = (Math.PI * (Math.pow(outerDiameter, 4) - Math.pow(inner, 4))) / 32
  const maxShear = (Math.abs(torque) * (outerDiameter / 2)) / j

  let twist = 0
  let rigidity = 0
  if (input.length !== undefined && input.shearModulus !== undefined) {
    if (!finite(input.length) || input.length <= 0) return fail('invalid-argument', 'The length has to be greater than zero.')
    if (!finite(input.shearModulus) || input.shearModulus <= 0) return fail('invalid-argument', 'The shear modulus has to be greater than zero.')
    rigidity = input.shearModulus * j
    twist = (torque * input.length) / rigidity
  }

  const notes: string[] = [
    'Shear stress is zero at the centre and highest at the surface, which is why a hollow shaft is nearly as strong as a solid one of the same outside diameter.',
    'This applies to circular sections only. A square or open section warps out of plane when twisted, and its stress distribution is nothing like this.'
  ]
  if (inner > 0) {
    const solidJ = (Math.PI * Math.pow(outerDiameter, 4)) / 32
    notes.push(
      `Hollowing it out removed ${((1 - (outerDiameter ** 2 - inner ** 2) / outerDiameter ** 2) * 100).toFixed(1)}% of the material and only ${((1 - j / solidJ) * 100).toFixed(1)}% of the torsional stiffness.`
    )
  }

  return {
    maximumShearStress: maxShear,
    angleOfTwist: twist,
    angleOfTwistDegrees: (twist * 180) / Math.PI,
    polarMoment: j,
    torsionalRigidity: rigidity,
    notes: Object.freeze(notes)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const BEAM_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Linear elastic material: stress is proportional to strain and everything springs back. Past yield none of this applies.',
  'Small deflections. The geometry used for the moment is the undeformed geometry, which stops being true for very flexible beams.',
  'Plane sections stay plane. Good for slender beams, poor for short deep ones where shear deflection matters.',
  'Bending is about a principal axis of the section. Loading a channel or angle off-axis twists it as well as bending it.',
  'Euler buckling assumes the column is perfectly straight, centrally loaded and still elastic. Real columns are none of those and carry less.',
  'Sign convention is sagging-positive with downward loads, and it travels on every result rather than being assumed.'
])
