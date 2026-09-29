/**
 * Optics: rays that bend, images that form, and light that interferes with itself.
 *
 * The shared optics engine for Orbis Pages. Geometric optics here is paraxial — the small-angle approximation —
 * and says so on every result, because that is the assumption that makes lens equations simple and the one that
 * quietly stops being true at the edge of a real lens. Wave optics is exact for the idealised apertures it models.
 *
 * ## The sign convention, stated rather than assumed
 *
 * Every optics textbook uses a different one and every one of them is self-consistent. This engine uses the
 * **real-is-positive Cartesian convention**: distances are measured from the optic, light travels left to right,
 * and
 *
 * ```
 * u  object distance   positive when the object is real (on the incoming side)
 * v  image distance    positive when the image is real (on the outgoing side)
 * f  focal length      positive for converging (convex lens, concave mirror)
 * 1/f = 1/v - 1/u      for a thin lens
 * m  = v/u             negative m means inverted
 * ```
 *
 * A Page that shows a result without the convention is showing a number that means the opposite thing in half the
 * world's classrooms, so `convention` is part of every result here rather than a footnote.
 *
 * ## Why total internal reflection is a separate answer and not a small refraction angle
 *
 * Past the critical angle Snell's law asks for `sin θ > 1`, which has no real solution. That is not a numerical
 * edge case to clamp — it is the physics saying no light gets through at all. Clamping to 90° would report a
 * grazing refracted ray that does not exist.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * real image   vs  virtual image   -- one lands on a screen, the other only in your eye
 * reflection   vs  scattering      -- one obeys an angle law, the other does not
 * interference vs  diffraction     -- discrete sources against one aperture's own spread
 * polarisation vs  intensity       -- the direction of the field against how much of it there is
 * phase velocity vs group velocity -- the crests against the pulse, different in a dispersive medium
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { SPEED_OF_LIGHT } from './emConstants.ts'

export interface OpticsError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'total-internal-reflection'
    | 'at-focus'
    | 'no-solution'
    | 'too-many'
    | 'outside-model'
  message: string
}

export const isOpticsError = (value: unknown): value is OpticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: OpticsError['error'], message: string): OpticsError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const OPTICS_LIMITS = Object.freeze({
  elements: 32,
  screenPoints: 4000,
  wavelengths: 64,
  orders: 64
})

/** The one convention everything here uses, carried on every result so it never has to be guessed. */
export const SIGN_CONVENTION = Object.freeze({
  name: 'Cartesian, real-is-positive',
  describe:
    'Light travels left to right. Object distance u is positive for a real object, image distance v is positive for a real image, and focal length f is positive for a converging element.',
  lensEquation: '1/f = 1/v - 1/u',
  magnification: 'm = v/u, negative when inverted'
})

// ---------------------------------------------------------------- refractive index

export interface Medium {
  name: string
  /** At the reference wavelength. */
  refractiveIndex: number
  /** Where the value came from. */
  source: string
  /** Nanometres. The wavelength the index was measured at. */
  referenceWavelength: number
  /** Sellmeier coefficients, when dispersion is modelled for this material. */
  sellmeier: Readonly<{ b: readonly number[]; c: readonly number[] }> | null
}

const medium = (one: Medium): Medium => Object.freeze(one)

/**
 * The materials this engine knows, with provenance.
 *
 * Refractive index depends on wavelength, and a single number is the value at one wavelength — which is why each
 * entry says which. Materials with Sellmeier coefficients can be asked for an index at any wavelength; the rest
 * answer only at their reference and say so.
 */
export const MEDIA: readonly Medium[] = Object.freeze([
  medium({ name: 'Vacuum', refractiveIndex: 1, source: 'Exact by definition', referenceWavelength: 589.3, sellmeier: null }),
  medium({ name: 'Air', refractiveIndex: 1.000293, source: 'At 0 C and 1 atm', referenceWavelength: 589.3, sellmeier: null }),
  medium({ name: 'Water', refractiveIndex: 1.333, source: 'At 20 C', referenceWavelength: 589.3, sellmeier: null }),
  medium({
    name: 'Crown glass (BK7)',
    refractiveIndex: 1.5168,
    source: 'Schott BK7 datasheet',
    referenceWavelength: 587.6,
    sellmeier: Object.freeze({
      b: Object.freeze([1.03961212, 0.231792344, 1.01046945]),
      c: Object.freeze([0.00600069867, 0.0200179144, 103.560653])
    })
  }),
  medium({
    name: 'Fused silica',
    refractiveIndex: 1.4585,
    source: 'Malitson 1965',
    referenceWavelength: 587.6,
    sellmeier: Object.freeze({
      b: Object.freeze([0.6961663, 0.4079426, 0.8974794]),
      c: Object.freeze([0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2])
    })
  }),
  medium({ name: 'Flint glass (SF11)', refractiveIndex: 1.7847, source: 'Schott SF11 datasheet', referenceWavelength: 587.6, sellmeier: null }),
  medium({ name: 'Diamond', refractiveIndex: 2.417, source: 'At 589 nm', referenceWavelength: 589.3, sellmeier: null }),
  medium({ name: 'Ice', refractiveIndex: 1.309, source: 'At 0 C', referenceWavelength: 589.3, sellmeier: null }),
  medium({ name: 'Ethanol', refractiveIndex: 1.361, source: 'At 20 C', referenceWavelength: 589.3, sellmeier: null }),
  medium({ name: 'Polycarbonate', refractiveIndex: 1.585, source: 'Typical optical grade', referenceWavelength: 589.3, sellmeier: null })
])

export function mediumByName(name: string): Medium | OpticsError {
  const wanted = name.trim().toLowerCase()
  const found = MEDIA.find((one) => one.name.toLowerCase() === wanted)
  if (found) return found
  const near = MEDIA.find((one) => one.name.toLowerCase().includes(wanted))
  if (near) return near
  return fail('invalid-argument', `There is no material called "${name}" in the library. Give a refractive index instead, or pick one of: ${MEDIA.map((one) => one.name).join(', ')}.`)
}

export interface DispersionReport {
  material: string
  /** Nanometres. */
  wavelength: number
  refractiveIndex: number
  /** m/s in this medium. */
  speed: number
  model: 'sellmeier' | 'single-value'
  notes: readonly string[]
}

/**
 * The refractive index of a material at a wavelength.
 *
 * Materials with Sellmeier coefficients get a real dispersion curve. Those without get their one measured value
 * back with a note saying so — rather than a made-up curve, which would put a plausible number on a page with
 * nothing behind it.
 */
export function refractiveIndexAt(materialName: string, wavelengthNm: number): DispersionReport | OpticsError {
  const found = mediumByName(materialName)
  if (isOpticsError(found)) return found
  if (!finite(wavelengthNm) || wavelengthNm <= 0) {
    return fail('invalid-argument', 'The wavelength has to be a positive number of nanometres.')
  }
  if (found.sellmeier === null) {
    return {
      material: found.name,
      wavelength: wavelengthNm,
      refractiveIndex: found.refractiveIndex,
      speed: SPEED_OF_LIGHT / found.refractiveIndex,
      model: 'single-value',
      notes: Object.freeze([
        `This is the measured index at ${found.referenceWavelength} nm (${found.source}). No dispersion model is available for this material, so the same number is returned at every wavelength — which is not what the material does.`
      ])
    }
  }
  // Sellmeier takes micrometres.
  const micro = wavelengthNm / 1000
  const squared = micro * micro
  let sum = 1
  for (let i = 0; i < found.sellmeier.b.length; i += 1) {
    const denominator = squared - found.sellmeier.c[i]
    if (denominator === 0) return fail('no-solution', 'That wavelength sits on a resonance of the Sellmeier model and has no value.')
    sum += (found.sellmeier.b[i] * squared) / denominator
  }
  if (sum < 0) return fail('outside-model', 'That wavelength is outside the range the Sellmeier coefficients describe.')
  const n = Math.sqrt(sum)
  return {
    material: found.name,
    wavelength: wavelengthNm,
    refractiveIndex: n,
    speed: SPEED_OF_LIGHT / n,
    model: 'sellmeier',
    notes: Object.freeze([
      `From the Sellmeier equation for ${found.name} (${found.source}). Blue light has a higher index than red, which is why a prism separates them.`
    ])
  }
}

// ---------------------------------------------------------------- refraction

export interface RefractionReport {
  incidentAngle: number
  refractedAngle: number
  /** Degrees, for the Pages that work in them. */
  incidentDegrees: number
  refractedDegrees: number
  fromIndex: number
  toIndex: number
  /** Radians. Null when going into a denser medium, where TIR cannot happen. */
  criticalAngle: number | null
  totallyInternallyReflected: boolean
  /** Fraction of power reflected, from the Fresnel equations, averaged over polarisation. */
  reflectance: number
  transmittance: number
  bending: 'toward normal' | 'away from normal' | 'straight through'
  notes: readonly string[]
}

/**
 * Snell's law, with total internal reflection as a distinct answer rather than a clamped one.
 *
 * Past the critical angle there is no refracted ray. Returning 90° would be reporting a ray that carries no power
 * and does not exist; the flag says what actually happened and the reflectance comes back as 1.
 */
export function refract(input: {
  incidentAngleRadians?: number
  incidentAngleDegrees?: number
  fromIndex: number
  toIndex: number
}): RefractionReport | OpticsError {
  const { fromIndex, toIndex } = input
  if (!finite(fromIndex) || !finite(toIndex)) return fail('not-finite', 'Both refractive indices have to be finite.')
  if (fromIndex < 1 || toIndex < 1) {
    return fail('invalid-argument', 'A refractive index below 1 would mean light travels faster than it does in vacuum. Give 1 or more.')
  }
  const hasRadians = input.incidentAngleRadians !== undefined
  const hasDegrees = input.incidentAngleDegrees !== undefined
  if (hasRadians === hasDegrees) {
    return fail('invalid-argument', 'Give the incident angle in radians or in degrees — one of the two.')
  }
  const theta1 = hasDegrees ? ((input.incidentAngleDegrees as number) * Math.PI) / 180 : (input.incidentAngleRadians as number)
  if (!finite(theta1)) return fail('not-finite', 'The incident angle has to be finite.')
  if (theta1 < 0 || theta1 > Math.PI / 2 + 1e-12) {
    return fail('invalid-argument', 'The incident angle is measured from the normal and runs from 0 to 90 degrees.')
  }

  const critical = toIndex < fromIndex ? Math.asin(toIndex / fromIndex) : null
  const sinTheta2 = (fromIndex * Math.sin(theta1)) / toIndex

  if (sinTheta2 > 1) {
    return {
      incidentAngle: theta1,
      refractedAngle: Number.NaN,
      incidentDegrees: (theta1 * 180) / Math.PI,
      refractedDegrees: Number.NaN,
      fromIndex,
      toIndex,
      criticalAngle: critical,
      totallyInternallyReflected: true,
      reflectance: 1,
      transmittance: 0,
      bending: 'straight through',
      notes: Object.freeze([
        `Past the critical angle of ${(((critical ?? 0) * 180) / Math.PI).toFixed(3)} degrees, so none of the light gets through. Snell's law would need a sine greater than 1, which has no solution — that is the physics saying there is no refracted ray, not a rounding problem.`,
        'All the power goes into the reflected ray. This is what makes optical fibre work.'
      ])
    }
  }

  const theta2 = Math.asin(sinTheta2)
  const cos1 = Math.cos(theta1)
  const cos2 = Math.cos(theta2)
  // Fresnel, both polarisations, averaged for unpolarised light.
  const rs = Math.pow((fromIndex * cos1 - toIndex * cos2) / (fromIndex * cos1 + toIndex * cos2), 2)
  const rp = Math.pow((fromIndex * cos2 - toIndex * cos1) / (fromIndex * cos2 + toIndex * cos1), 2)
  const reflectance = (rs + rp) / 2

  const notes: string[] = []
  if (toIndex > fromIndex) notes.push('Going into the denser medium, so the ray bends toward the normal and slows down.')
  else if (toIndex < fromIndex) notes.push('Going into the less dense medium, so the ray bends away from the normal and speeds up.')
  else notes.push('Both media have the same index, so there is no boundary as far as the light is concerned.')
  const brewster = Math.atan(toIndex / fromIndex)
  if (Math.abs(theta1 - brewster) < 0.02) {
    notes.push(
      `This is close to Brewster's angle (${((brewster * 180) / Math.PI).toFixed(2)} degrees), where the reflected light is completely polarised parallel to the surface.`
    )
  }

  return {
    incidentAngle: theta1,
    refractedAngle: theta2,
    incidentDegrees: (theta1 * 180) / Math.PI,
    refractedDegrees: (theta2 * 180) / Math.PI,
    fromIndex,
    toIndex,
    criticalAngle: critical,
    totallyInternallyReflected: false,
    reflectance,
    transmittance: 1 - reflectance,
    bending: toIndex > fromIndex ? 'toward normal' : toIndex < fromIndex ? 'away from normal' : 'straight through',
    notes: Object.freeze(notes)
  }
}

export interface CriticalAngleReport {
  criticalAngle: number
  criticalDegrees: number
  fromIndex: number
  toIndex: number
  notes: readonly string[]
}

/** The critical angle, which only exists going from dense to less dense. */
export function criticalAngle(fromIndex: number, toIndex: number): CriticalAngleReport | OpticsError {
  if (!finite(fromIndex) || !finite(toIndex)) return fail('not-finite', 'Both indices have to be finite.')
  if (fromIndex < 1 || toIndex < 1) return fail('invalid-argument', 'Both indices have to be 1 or more.')
  if (toIndex >= fromIndex) {
    return fail(
      'no-solution',
      'There is no critical angle going into a denser medium. Total internal reflection only happens on the way out of the denser one.'
    )
  }
  const angle = Math.asin(toIndex / fromIndex)
  return {
    criticalAngle: angle,
    criticalDegrees: (angle * 180) / Math.PI,
    fromIndex,
    toIndex,
    notes: Object.freeze([
      'At exactly this angle the refracted ray grazes along the surface. Past it there is no refracted ray at all.'
    ])
  }
}

// ---------------------------------------------------------------- mirrors and lenses

export type OpticKind = 'converging-lens' | 'diverging-lens' | 'concave-mirror' | 'convex-mirror' | 'plane-mirror'

export const OPTIC_KINDS: readonly OpticKind[] = Object.freeze([
  'converging-lens',
  'diverging-lens',
  'concave-mirror',
  'convex-mirror',
  'plane-mirror'
])

export interface ImageReport {
  optic: OpticKind
  /** Positive for a real object on the incoming side. */
  objectDistance: number
  /** Positive when the image is real. */
  imageDistance: number
  focalLength: number
  magnification: number
  objectHeight: number | null
  imageHeight: number | null
  real: boolean
  inverted: boolean
  enlarged: boolean
  /** The three rays a textbook draws, as line endpoints, when a height was given. */
  principalRays: readonly { name: string; points: readonly { x: number; y: number }[] }[]
  convention: typeof SIGN_CONVENTION
  notes: readonly string[]
}

/**
 * Where a lens or mirror puts an image, and what kind of image it is.
 *
 * Paraxial. Every ray is assumed to make a small angle with the axis, which is what makes `1/f = 1/v − 1/u` a
 * straight line instead of a surface. Real lenses do not obey it at the edges, and that is spherical aberration —
 * so the result says the approximation is in use rather than letting a Page present it as exact.
 */
export function imageFrom(input: {
  optic: OpticKind
  objectDistance: number
  focalLength?: number
  radiusOfCurvature?: number
  objectHeight?: number
}): ImageReport | OpticsError {
  const { optic, objectDistance } = input
  if (!finite(objectDistance)) return fail('not-finite', 'The object distance has to be finite.')
  if (objectDistance <= 0) {
    return fail('invalid-argument', 'The object distance has to be positive. A virtual object needs a different calculation.')
  }

  if (optic === 'plane-mirror') {
    return {
      optic,
      objectDistance,
      imageDistance: -objectDistance,
      focalLength: Number.POSITIVE_INFINITY,
      magnification: 1,
      objectHeight: input.objectHeight ?? null,
      imageHeight: input.objectHeight ?? null,
      real: false,
      inverted: false,
      enlarged: false,
      principalRays: Object.freeze([]),
      convention: SIGN_CONVENTION,
      notes: Object.freeze([
        'A plane mirror puts the image as far behind it as the object is in front, the same size and the right way up.',
        'The image is virtual: no light actually goes there, which is why it cannot be caught on a screen held behind the mirror.'
      ])
    }
  }

  let f: number
  if (input.focalLength !== undefined) {
    f = input.focalLength
  } else if (input.radiusOfCurvature !== undefined) {
    if (!finite(input.radiusOfCurvature) || input.radiusOfCurvature === 0) {
      return fail('invalid-argument', 'The radius of curvature has to be a non-zero finite number.')
    }
    f = input.radiusOfCurvature / 2
  } else {
    return fail('invalid-argument', 'Give either a focal length or a radius of curvature.')
  }
  if (!finite(f) || f === 0) return fail('invalid-argument', 'The focal length has to be a non-zero finite number.')

  // Normalise the sign to the convention, from the kind. A diverging element has a negative focal length whatever
  // sign the caller typed, because "diverging with f = +10 cm" is a contradiction rather than an input.
  const diverging = optic === 'diverging-lens' || optic === 'convex-mirror'
  f = diverging ? -Math.abs(f) : Math.abs(f)

  if (Math.abs(objectDistance - f) < Math.abs(f) * 1e-9) {
    return fail(
      'at-focus',
      'The object is exactly at the focal point, so the rays come out parallel and the image is infinitely far away. There is no finite image distance to report.'
    )
  }

  // 1/f = 1/v - 1/u  ->  v = uf/(u - f)
  const v = (objectDistance * f) / (objectDistance - f)
  const m = v / objectDistance
  const real = v > 0
  const height = input.objectHeight
  const imageHeight = height !== undefined && finite(height) ? m * height : null

  const notes: string[] = [
    'Paraxial: every ray is assumed to make a small angle with the axis. Real optics stop obeying this at the edges, which is what spherical aberration is.'
  ]
  if (real) notes.push('The image is real — light actually converges there, so a screen placed at that distance shows it.')
  else notes.push('The image is virtual. The rays only appear to come from there; nothing arrives, so no screen will show it.')
  if (m < 0) notes.push('The magnification is negative, which means the image is upside down.')
  if (Math.abs(m) > 1) notes.push('The image is larger than the object.')
  else if (Math.abs(m) < 1) notes.push('The image is smaller than the object.')

  const principalRays =
    height !== undefined && finite(height) && imageHeight !== null
      ? Object.freeze([
          Object.freeze({
            name: 'Parallel to the axis, then through the focus',
            points: Object.freeze([
              { x: -objectDistance, y: height },
              { x: 0, y: height },
              { x: v, y: imageHeight }
            ])
          }),
          Object.freeze({
            name: 'Through the centre, undeviated',
            points: Object.freeze([
              { x: -objectDistance, y: height },
              { x: 0, y: 0 },
              { x: v, y: imageHeight }
            ])
          }),
          Object.freeze({
            name: 'Through the focus, then parallel',
            points: Object.freeze([
              { x: -objectDistance, y: height },
              { x: 0, y: imageHeight },
              { x: v, y: imageHeight }
            ])
          })
        ])
      : Object.freeze([])

  return {
    optic,
    objectDistance,
    imageDistance: v,
    focalLength: f,
    magnification: m,
    objectHeight: height ?? null,
    imageHeight,
    real,
    inverted: m < 0,
    enlarged: Math.abs(m) > 1,
    principalRays,
    convention: SIGN_CONVENTION,
    notes: Object.freeze(notes)
  }
}

export interface LensMakerReport {
  focalLength: number
  power: number
  refractiveIndex: number
  radius1: number
  radius2: number
  converging: boolean
  notes: readonly string[]
}

/** The lens-maker's equation: focal length from glass and curvature, in air. */
export function lensMaker(input: {
  refractiveIndex: number
  radius1: number
  radius2: number
  surroundingIndex?: number
}): LensMakerReport | OpticsError {
  const { refractiveIndex, radius1, radius2 } = input
  const surrounding = input.surroundingIndex ?? 1
  for (const [name, value] of Object.entries({ refractiveIndex, radius1, radius2, surrounding })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (refractiveIndex <= 0 || surrounding <= 0) return fail('invalid-argument', 'Refractive indices have to be positive.')
  if (radius1 === 0 || radius2 === 0) return fail('invalid-argument', 'A zero radius is a flat surface of zero size, which has no meaning here. Use Infinity for flat.')

  const relative = refractiveIndex / surrounding
  const power = (relative - 1) * (1 / radius1 - 1 / radius2)
  if (power === 0) {
    return fail('no-solution', 'Those surfaces cancel exactly, so the lens has no focusing power and no focal length.')
  }
  return {
    focalLength: 1 / power,
    power,
    refractiveIndex,
    radius1,
    radius2,
    converging: power > 0,
    notes: Object.freeze([
      'Radii are positive when the surface bulges toward the incoming light. Use Infinity for a flat face.',
      'The power is in dioptres when the radii are in metres. Lens powers add when lenses are put together, which is why opticians use them.'
    ])
  }
}

export interface OpticalSystemStep {
  element: OpticKind
  focalLength: number
  /** Distance from the previous element. */
  separation: number
  label?: string
}

export interface SystemReport {
  steps: readonly {
    label: string
    objectDistance: number
    imageDistance: number
    magnification: number
    real: boolean
  }[]
  /** The product of every stage. */
  totalMagnification: number
  finalImageDistance: number
  finalReal: boolean
  finalInverted: boolean
  convention: typeof SIGN_CONVENTION
  notes: readonly string[]
}

/**
 * A train of lenses and mirrors, solved one stage at a time.
 *
 * Each element's image becomes the next element's object, which is the whole method. An image landing beyond the
 * next element becomes a **virtual object** for it, with a negative object distance — that is not an error, and
 * handling it is the difference between a two-lens system that works and one that refuses halfway.
 */
export function opticalSystem(
  objectDistance: number,
  elements: readonly OpticalSystemStep[]
): SystemReport | OpticsError {
  if (elements.length === 0) return fail('invalid-argument', 'There are no optical elements in the system.')
  if (elements.length > OPTICS_LIMITS.elements) {
    return fail('too-many', `That is ${elements.length} elements; this traces up to ${OPTICS_LIMITS.elements}.`)
  }
  if (!finite(objectDistance) || objectDistance <= 0) {
    return fail('invalid-argument', 'The first object distance has to be a positive number.')
  }

  const steps: SystemReport['steps'][number][] = []
  let u = objectDistance
  let totalM = 1
  let lastV = 0

  for (const [index, element] of elements.entries()) {
    if (index > 0) {
      if (!finite(element.separation) || element.separation < 0) {
        return fail('invalid-argument', `Element ${index + 1} has a separation that is not a positive distance.`)
      }
      // The previous image sits `lastV` past the previous element. Distance to this one is the separation minus that.
      u = element.separation - lastV
      if (Math.abs(u) < 1e-12) {
        return fail('at-focus', `The image from element ${index} lands exactly on element ${index + 1}, which the thin-element model cannot handle.`)
      }
    }
    const diverging = element.element === 'diverging-lens' || element.element === 'convex-mirror'
    const f = diverging ? -Math.abs(element.focalLength) : Math.abs(element.focalLength)
    if (!finite(f) || f === 0) return fail('invalid-argument', `Element ${index + 1} has no usable focal length.`)
    if (Math.abs(u - f) < Math.abs(f) * 1e-9) {
      return fail('at-focus', `The object for element ${index + 1} sits exactly at its focal point, so its image is infinitely far away.`)
    }
    const v = (u * f) / (u - f)
    const m = v / u
    totalM *= m
    steps.push({
      label: element.label ?? `element ${index + 1}`,
      objectDistance: u,
      imageDistance: v,
      magnification: m,
      real: v > 0
    })
    lastV = v
  }

  const notes: string[] = [
    'Each element takes the previous image as its object. A negative object distance means the previous image fell behind this element, which makes it a virtual object — that is normal in a multi-element system, not an error.'
  ]
  if (totalM < 0) notes.push('The final image is inverted. Each inverting stage flips it again, so an even number of them comes back upright.')

  return {
    steps: Object.freeze(steps),
    totalMagnification: totalM,
    finalImageDistance: lastV,
    finalReal: lastV > 0,
    finalInverted: totalM < 0,
    convention: SIGN_CONVENTION,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- prisms

export interface PrismReport {
  apexAngle: number
  refractiveIndex: number
  incidentAngle: number
  /** Radians. */
  emergentAngle: number
  deviation: number
  deviationDegrees: number
  minimumDeviation: number
  minimumDeviationDegrees: number
  /** The incident angle that gives minimum deviation. */
  symmetricAngle: number
  totalInternalReflection: boolean
  notes: readonly string[]
}

/** A prism: two refractions, and the deviation that has a minimum in the middle. */
export function prism(input: {
  apexAngleDegrees: number
  refractiveIndex: number
  incidentAngleDegrees: number
  surroundingIndex?: number
}): PrismReport | OpticsError {
  const surrounding = input.surroundingIndex ?? 1
  const apex = (input.apexAngleDegrees * Math.PI) / 180
  const theta1 = (input.incidentAngleDegrees * Math.PI) / 180
  const n = input.refractiveIndex / surrounding
  if (!finite(apex) || !finite(theta1) || !finite(n)) return fail('not-finite', 'Every input has to be a finite number.')
  if (apex <= 0 || apex >= Math.PI) return fail('invalid-argument', 'The apex angle has to be between 0 and 180 degrees.')
  if (n <= 0) return fail('invalid-argument', 'The relative refractive index has to be positive.')

  const sinR1 = Math.sin(theta1) / n
  if (Math.abs(sinR1) > 1) return fail('no-solution', 'That incident angle cannot enter the prism at all.')
  const r1 = Math.asin(sinR1)
  const r2 = apex - r1
  const sinTheta2 = n * Math.sin(r2)
  const minimum = 2 * Math.asin(n * Math.sin(apex / 2)) - apex
  const symmetric = Math.asin(n * Math.sin(apex / 2))

  if (Math.abs(sinTheta2) > 1) {
    return {
      apexAngle: apex,
      refractiveIndex: input.refractiveIndex,
      incidentAngle: theta1,
      emergentAngle: Number.NaN,
      deviation: Number.NaN,
      deviationDegrees: Number.NaN,
      minimumDeviation: minimum,
      minimumDeviationDegrees: (minimum * 180) / Math.PI,
      symmetricAngle: symmetric,
      totalInternalReflection: true,
      notes: Object.freeze([
        'The ray hits the second face past the critical angle and is totally internally reflected instead of emerging. Nothing comes out of that face.'
      ])
    }
  }

  const theta2 = Math.asin(sinTheta2)
  const deviation = theta1 + theta2 - apex
  const notes: string[] = [
    'Deviation has a minimum, and at it the ray passes symmetrically through the prism. That is why the minimum-deviation method measures refractive index so precisely: the derivative is zero there, so small alignment errors barely matter.'
  ]
  if (Math.abs(theta1 - symmetric) < 0.01) notes.push('This is very close to the symmetric passage, so the deviation is at or near its minimum.')

  return {
    apexAngle: apex,
    refractiveIndex: input.refractiveIndex,
    incidentAngle: theta1,
    emergentAngle: theta2,
    deviation,
    deviationDegrees: (deviation * 180) / Math.PI,
    minimumDeviation: minimum,
    minimumDeviationDegrees: (minimum * 180) / Math.PI,
    symmetricAngle: symmetric,
    totalInternalReflection: false,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- interference

export interface FringePattern {
  /** Metres from the centre of the screen. */
  position: number
  /** Relative to the central maximum, which is 1. */
  intensity: number
  /** Radians. */
  phaseDifference: number
}

export interface DoubleSlitReport {
  wavelength: number
  slitSeparation: number
  screenDistance: number
  slitWidth: number | null
  /** Metres between adjacent bright fringes. */
  fringeSpacing: number
  /** Where the bright fringes fall, in metres from centre. */
  maxima: readonly { order: number; position: number; angle: number }[]
  minima: readonly { order: number; position: number }[]
  pattern: readonly FringePattern[]
  /** Present when a slit width was given: the single-slit envelope that modulates the fringes. */
  envelope: readonly number[] | null
  /** Orders swallowed by a zero of the envelope, when a slit width was given. */
  missingOrders: readonly number[]
  notes: readonly string[]
}

/**
 * Young's double slit, with the single-slit envelope included when the slit width is known.
 *
 * Two slits alone give fringes of equal brightness forever, which no real experiment produces. Real slits have
 * width, and that width diffracts — the pattern is the interference fringes multiplied by the single-slit envelope,
 * and where the envelope has a zero the fringe there is missing entirely. A Page showing uniform fringes is
 * showing the idealisation rather than the experiment.
 */
export function doubleSlit(input: {
  wavelength: number
  slitSeparation: number
  screenDistance: number
  slitWidth?: number
  screenWidth?: number
  points?: number
  maxOrder?: number
}): DoubleSlitReport | OpticsError {
  const { wavelength, slitSeparation, screenDistance } = input
  for (const [name, value] of Object.entries({ wavelength, slitSeparation, screenDistance })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (slitSeparation < wavelength) {
    return fail(
      'outside-model',
      'The slits are closer together than one wavelength, so no order beyond the centre can appear and the small-angle geometry breaks down.'
    )
  }

  const spacing = (wavelength * screenDistance) / slitSeparation
  const maxOrder = Math.min(Math.round(input.maxOrder ?? 10), OPTICS_LIMITS.orders)
  const maxima: { order: number; position: number; angle: number }[] = []
  const minima: { order: number; position: number }[] = []
  for (let m = -maxOrder; m <= maxOrder; m += 1) {
    const sinTheta = (m * wavelength) / slitSeparation
    if (Math.abs(sinTheta) > 1) continue
    maxima.push({ order: m, position: m * spacing, angle: Math.asin(sinTheta) })
    minima.push({ order: m, position: (m + 0.5) * spacing })
  }

  const screenWidth = input.screenWidth ?? spacing * (maxOrder * 2 + 1)
  const count = Math.round(input.points ?? 800)
  if (!Number.isInteger(count) || count < 2 || count > OPTICS_LIMITS.screenPoints) {
    return fail('invalid-argument', `The point count has to be a whole number between 2 and ${OPTICS_LIMITS.screenPoints}.`)
  }

  const pattern: FringePattern[] = []
  const envelope: number[] = []
  const width = input.slitWidth
  for (let i = 0; i < count; i += 1) {
    const y = -screenWidth / 2 + (screenWidth * i) / (count - 1)
    const theta = Math.atan(y / screenDistance)
    const delta = (2 * Math.PI * slitSeparation * Math.sin(theta)) / wavelength
    let intensity = Math.pow(Math.cos(delta / 2), 2)
    if (width !== undefined && finite(width) && width > 0) {
      const beta = (Math.PI * width * Math.sin(theta)) / wavelength
      const sinc = beta === 0 ? 1 : Math.sin(beta) / beta
      const e = sinc * sinc
      envelope.push(e)
      intensity *= e
    }
    pattern.push({ position: y, intensity, phaseDifference: delta })
  }

  const missing: number[] = []
  if (width !== undefined && finite(width) && width > 0) {
    const ratio = slitSeparation / width
    if (Math.abs(ratio - Math.round(ratio)) < 1e-9) {
      for (let k = 1; k * Math.round(ratio) <= maxOrder; k += 1) missing.push(k * Math.round(ratio), -k * Math.round(ratio))
    }
  }

  const notes: string[] = [
    `Fringes are ${spacing.toExponential(4)} m apart. Wider spacing means a longer wavelength, closer slits, or a more distant screen — the three trade against each other exactly.`
  ]
  if (width === undefined) {
    notes.push(
      'No slit width was given, so the fringes all come out equally bright. Real slits have width and their diffraction dims the outer fringes; give a slit width to see that.'
    )
  } else if (missing.length > 0) {
    notes.push(
      `Orders ${[...new Set(missing)].sort((a, b) => a - b).join(', ')} are missing: the slit separation is a whole multiple of the slit width, so those interference maxima land exactly on zeros of the diffraction envelope.`
    )
  }

  return {
    wavelength,
    slitSeparation,
    screenDistance,
    slitWidth: width ?? null,
    fringeSpacing: spacing,
    maxima: Object.freeze(maxima),
    minima: Object.freeze(minima),
    pattern: Object.freeze(pattern),
    envelope: envelope.length > 0 ? Object.freeze(envelope) : null,
    missingOrders: Object.freeze([...new Set(missing)].sort((a, b) => a - b)),
    notes: Object.freeze(notes)
  }
}

export interface SingleSlitReport {
  wavelength: number
  slitWidth: number
  screenDistance: number
  /** Metres. Half the width of the central bright band. */
  centralHalfWidth: number
  minima: readonly { order: number; position: number; angle: number }[]
  pattern: readonly FringePattern[]
  notes: readonly string[]
}

/** Single-slit diffraction. The central band is twice as wide as the others, which surprises people. */
export function singleSlit(input: {
  wavelength: number
  slitWidth: number
  screenDistance: number
  screenWidth?: number
  points?: number
  maxOrder?: number
}): SingleSlitReport | OpticsError {
  const { wavelength, slitWidth, screenDistance } = input
  for (const [name, value] of Object.entries({ wavelength, slitWidth, screenDistance })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  const halfWidth = (wavelength * screenDistance) / slitWidth
  const maxOrder = Math.min(Math.round(input.maxOrder ?? 8), OPTICS_LIMITS.orders)
  const minima: { order: number; position: number; angle: number }[] = []
  for (let m = -maxOrder; m <= maxOrder; m += 1) {
    if (m === 0) continue
    const sinTheta = (m * wavelength) / slitWidth
    if (Math.abs(sinTheta) > 1) continue
    minima.push({ order: m, position: m * halfWidth, angle: Math.asin(sinTheta) })
  }

  const screenWidth = input.screenWidth ?? halfWidth * (maxOrder * 2 + 2)
  const count = Math.round(input.points ?? 800)
  if (!Number.isInteger(count) || count < 2 || count > OPTICS_LIMITS.screenPoints) {
    return fail('invalid-argument', `The point count has to be a whole number between 2 and ${OPTICS_LIMITS.screenPoints}.`)
  }
  const pattern: FringePattern[] = []
  for (let i = 0; i < count; i += 1) {
    const y = -screenWidth / 2 + (screenWidth * i) / (count - 1)
    const theta = Math.atan(y / screenDistance)
    const beta = (Math.PI * slitWidth * Math.sin(theta)) / wavelength
    const sinc = beta === 0 ? 1 : Math.sin(beta) / beta
    pattern.push({ position: y, intensity: sinc * sinc, phaseDifference: 2 * beta })
  }

  return {
    wavelength,
    slitWidth,
    screenDistance,
    centralHalfWidth: halfWidth,
    minima: Object.freeze(minima),
    pattern: Object.freeze(pattern),
    notes: Object.freeze([
      'The central band is twice as wide as every other one, because it runs from the first minimum on one side to the first on the other.',
      'A narrower slit spreads the light more, not less. That is the whole content of diffraction and it is the opposite of what a shadow would suggest.'
    ])
  }
}

export interface GratingReport {
  wavelength: number
  /** Metres between adjacent lines. */
  spacing: number
  linesPerMetre: number
  orders: readonly { order: number; angle: number; angleDegrees: number }[]
  /** The highest order that exists at all. */
  maxOrder: number
  /** Dimensionless: how well two close wavelengths can be told apart at each order. */
  resolvingPower: readonly { order: number; power: number }[]
  notes: readonly string[]
}

/** A diffraction grating: sharp orders, and a hard limit on how many of them exist. */
export function grating(input: {
  wavelength: number
  linesPerMillimetre?: number
  spacing?: number
  incidentAngleDegrees?: number
  illuminatedLines?: number
}): GratingReport | OpticsError {
  const { wavelength } = input
  if (!finite(wavelength) || wavelength <= 0) return fail('invalid-argument', 'The wavelength has to be greater than zero.')
  let d: number
  if (input.spacing !== undefined) {
    d = input.spacing
  } else if (input.linesPerMillimetre !== undefined) {
    if (!finite(input.linesPerMillimetre) || input.linesPerMillimetre <= 0) {
      return fail('invalid-argument', 'Lines per millimetre has to be greater than zero.')
    }
    d = 0.001 / input.linesPerMillimetre
  } else {
    return fail('invalid-argument', 'Give either the line spacing or the lines per millimetre.')
  }
  if (!finite(d) || d <= 0) return fail('invalid-argument', 'The line spacing has to be greater than zero.')

  const incident = ((input.incidentAngleDegrees ?? 0) * Math.PI) / 180
  const orders: { order: number; angle: number; angleDegrees: number }[] = []
  const limit = Math.floor((d * (1 + Math.abs(Math.sin(incident)))) / wavelength)
  const capped = Math.min(limit, OPTICS_LIMITS.orders)
  for (let m = -capped; m <= capped; m += 1) {
    const sinTheta = (m * wavelength) / d + Math.sin(incident)
    if (Math.abs(sinTheta) > 1) continue
    const angle = Math.asin(sinTheta)
    orders.push({ order: m, angle, angleDegrees: (angle * 180) / Math.PI })
  }

  const lines = input.illuminatedLines
  const resolving =
    lines !== undefined && finite(lines) && lines > 0
      ? orders.filter((one) => one.order !== 0).map((one) => ({ order: one.order, power: Math.abs(one.order) * lines }))
      : []

  return {
    wavelength,
    spacing: d,
    linesPerMetre: 1 / d,
    orders: Object.freeze(orders),
    maxOrder: capped,
    resolvingPower: Object.freeze(resolving),
    notes: Object.freeze([
      `Only ${orders.length} orders exist at all. Past order ${capped} the equation asks for a sine greater than 1 — there is simply nowhere for that light to go.`,
      'Resolving power is the order times the number of illuminated lines. More lines and higher orders separate close wavelengths better, which is why spectroscopes use wide gratings.'
    ])
  }
}

// ---------------------------------------------------------------- polarisation

export interface MalusReport {
  incidentIntensity: number
  transmittedIntensity: number
  /** Radians between the polariser axes. */
  angle: number
  fraction: number
  /** Whether the incident light was already polarised. */
  startedPolarised: boolean
  notes: readonly string[]
}

/**
 * Malus's law, with the unpolarised case handled separately because it is a different calculation.
 *
 * Unpolarised light through the first polariser loses exactly half, whatever angle it is set to — there is no
 * preferred direction to measure from. Only after that does `cos²θ` apply. A Page applying Malus to unpolarised
 * light gets the first polariser wrong by a factor that depends on an angle that does not exist.
 */
export function malus(input: {
  incidentIntensity: number
  angleDegrees?: number
  angleRadians?: number
  incidentPolarised?: boolean
}): MalusReport | OpticsError {
  const { incidentIntensity } = input
  if (!finite(incidentIntensity) || incidentIntensity < 0) {
    return fail('invalid-argument', 'The incident intensity has to be zero or positive.')
  }
  const polarised = input.incidentPolarised ?? true
  const hasRadians = input.angleRadians !== undefined
  const hasDegrees = input.angleDegrees !== undefined
  if (hasRadians && hasDegrees) return fail('invalid-argument', 'Give the angle in radians or in degrees, not both.')
  const angle = hasDegrees ? ((input.angleDegrees as number) * Math.PI) / 180 : (input.angleRadians ?? 0)
  if (!finite(angle)) return fail('not-finite', 'The angle has to be finite.')

  const fraction = polarised ? Math.pow(Math.cos(angle), 2) : 0.5
  return {
    incidentIntensity,
    transmittedIntensity: incidentIntensity * fraction,
    angle,
    fraction,
    startedPolarised: polarised,
    notes: Object.freeze(
      polarised
        ? [
            'Malus: the transmitted intensity is the incident times cos² of the angle between the polarisation and the axis.',
            'At 90 degrees nothing gets through. Slide a third polariser at 45 degrees between two crossed ones and light reappears, which is the classic demonstration that a polariser changes the light rather than just filtering it.'
          ]
        : [
            'Unpolarised light loses exactly half at the first polariser, whatever angle it is set to. There is no preferred direction in the incoming light to measure an angle from, so cos² does not apply here.',
            'After this the light is polarised along the axis, and Malus applies to everything downstream.'
          ]
    )
  }
}

// ---------------------------------------------------------------- thin films

export interface ThinFilmReport {
  thickness: number
  filmIndex: number
  aboveIndex: number
  belowIndex: number
  wavelength: number
  /** Radians. The total phase difference between the two reflections. */
  phaseDifference: number
  /** Whether the two reflections reinforce or cancel. */
  interference: 'constructive' | 'destructive' | 'partial'
  /** Whether a half-wave phase flip happened at the top, the bottom, both, or neither. */
  phaseFlips: readonly string[]
  /** Thicknesses giving a bright reflection, in metres. */
  constructiveThicknesses: readonly number[]
  destructiveThicknesses: readonly number[]
  notes: readonly string[]
}

/**
 * Thin-film interference, with the reflection phase flips counted rather than assumed.
 *
 * A reflection off a higher index flips the phase by half a wavelength; off a lower one it does not. Whether the
 * film is bright or dark depends on how many of those flips happened — one flip swaps the constructive and
 * destructive conditions entirely. An oil film on water and a soap film in air are opposite cases for this reason,
 * so the indices above and below are both required.
 */
export function thinFilm(input: {
  thickness: number
  filmIndex: number
  aboveIndex?: number
  belowIndex?: number
  wavelength: number
  incidentAngleDegrees?: number
  maxOrders?: number
}): ThinFilmReport | OpticsError {
  const { thickness, filmIndex, wavelength } = input
  const above = input.aboveIndex ?? 1
  const below = input.belowIndex ?? 1
  for (const [name, value] of Object.entries({ thickness, filmIndex, above, below, wavelength })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  const incident = ((input.incidentAngleDegrees ?? 0) * Math.PI) / 180
  const sinInside = (above * Math.sin(incident)) / filmIndex
  if (Math.abs(sinInside) > 1) return fail('no-solution', 'Light at that angle cannot get into the film at all.')
  const cosInside = Math.sqrt(1 - sinInside * sinInside)

  const flipTop = filmIndex > above
  const flipBottom = below > filmIndex
  const flips: string[] = []
  if (flipTop) flips.push('at the top surface, going into the denser film')
  if (flipBottom) flips.push('at the bottom surface, going into a denser medium below')
  const netFlip = (flipTop ? 1 : 0) + (flipBottom ? 1 : 0)
  const halfWave = netFlip % 2 === 1

  // Path difference 2nt cos, plus half a wavelength if exactly one reflection flipped.
  const pathPhase = (2 * Math.PI * 2 * filmIndex * thickness * cosInside) / wavelength
  const total = pathPhase + (halfWave ? Math.PI : 0)
  const normalised = ((total % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const interference: ThinFilmReport['interference'] =
    Math.abs(normalised) < 0.05 || Math.abs(normalised - 2 * Math.PI) < 0.05
      ? 'constructive'
      : Math.abs(normalised - Math.PI) < 0.05
        ? 'destructive'
        : 'partial'

  const orders = Math.min(Math.round(input.maxOrders ?? 5), OPTICS_LIMITS.orders)
  const unit = wavelength / (2 * filmIndex * cosInside)
  const constructive: number[] = []
  const destructive: number[] = []
  for (let m = 0; m < orders; m += 1) {
    // With a net half-wave flip the conditions swap, which is exactly the point of tracking them.
    constructive.push(halfWave ? (m + 0.5) * unit : (m + 1) * unit)
    destructive.push(halfWave ? (m + 1) * unit : (m + 0.5) * unit)
  }

  return {
    thickness,
    filmIndex,
    aboveIndex: above,
    belowIndex: below,
    wavelength,
    phaseDifference: normalised,
    interference,
    phaseFlips: Object.freeze(flips.length > 0 ? flips : ['none: neither reflection is off a denser medium']),
    constructiveThicknesses: Object.freeze(constructive.filter((one) => one > 0)),
    destructiveThicknesses: Object.freeze(destructive.filter((one) => one > 0)),
    notes: Object.freeze([
      halfWave
        ? 'Exactly one of the two reflections flips phase by half a wavelength, so the usual conditions swap: a very thin film looks dark rather than bright. This is why a soap film goes black just before it bursts.'
        : netFlip === 2
          ? 'Both reflections flip, so the flips cancel and the ordinary path-difference conditions apply.'
          : 'Neither reflection flips, so the ordinary path-difference conditions apply.',
      'White light gives colours because each wavelength satisfies the condition at a different thickness. That is the oil slick and the soap bubble.'
    ])
  }
}

// ---------------------------------------------------------------- fibre optics

export interface FibreReport {
  coreIndex: number
  claddingIndex: number
  /** Dimensionless. */
  numericalAperture: number
  /** Radians. Half-angle of the cone light must enter within. */
  acceptanceAngle: number
  acceptanceDegrees: number
  /** Radians, inside the fibre. */
  criticalAngle: number
  /** Dimensionless. Below 2.405 the fibre is single-mode at this wavelength. */
  vNumber: number | null
  singleMode: boolean | null
  /** dB, when a length and attenuation were given. */
  totalLoss: number | null
  /** Fraction of power surviving. */
  survivingFraction: number | null
  notes: readonly string[]
}

/** An optical fibre: how much light it will accept, and whether it carries one mode or many. */
export function fibre(input: {
  coreIndex: number
  claddingIndex: number
  coreRadius?: number
  wavelength?: number
  lengthKm?: number
  attenuationDbPerKm?: number
  surroundingIndex?: number
}): FibreReport | OpticsError {
  const { coreIndex, claddingIndex } = input
  const surrounding = input.surroundingIndex ?? 1
  for (const [name, value] of Object.entries({ coreIndex, claddingIndex, surrounding })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (claddingIndex >= coreIndex) {
    return fail(
      'invalid-argument',
      'The cladding has to have a lower refractive index than the core. Without that there is no total internal reflection and the fibre does not guide light at all.'
    )
  }

  const na = Math.sqrt(coreIndex * coreIndex - claddingIndex * claddingIndex)
  const sinAcceptance = na / surrounding
  if (sinAcceptance > 1) {
    return fail('outside-model', 'The numerical aperture exceeds 1 relative to the surroundings, so the fibre accepts light from every direction and the acceptance angle has no meaning.')
  }
  const acceptance = Math.asin(sinAcceptance)
  const critical = Math.asin(claddingIndex / coreIndex)

  let v: number | null = null
  let single: boolean | null = null
  if (input.coreRadius !== undefined && input.wavelength !== undefined) {
    if (!finite(input.coreRadius) || input.coreRadius <= 0) return fail('invalid-argument', 'The core radius has to be greater than zero.')
    if (!finite(input.wavelength) || input.wavelength <= 0) return fail('invalid-argument', 'The wavelength has to be greater than zero.')
    v = (2 * Math.PI * input.coreRadius * na) / input.wavelength
    single = v < 2.405
  }

  let loss: number | null = null
  let surviving: number | null = null
  if (input.lengthKm !== undefined && input.attenuationDbPerKm !== undefined) {
    if (!finite(input.lengthKm) || input.lengthKm < 0) return fail('invalid-argument', 'The length has to be zero or positive.')
    if (!finite(input.attenuationDbPerKm) || input.attenuationDbPerKm < 0) {
      return fail('invalid-argument', 'The attenuation has to be zero or positive.')
    }
    loss = input.lengthKm * input.attenuationDbPerKm
    surviving = Math.pow(10, -loss / 10)
  }

  const notes: string[] = [
    'Light is guided by total internal reflection at the core-cladding boundary. Anything entering outside the acceptance cone hits that boundary too steeply and leaks straight out.',
    'Numerical aperture is set by the two indices alone. A bigger difference accepts more light but spreads pulses more, which is the trade every fibre design makes.'
  ]
  if (single === true) notes.push(`V = ${(v as number).toFixed(3)}, below 2.405, so only one mode propagates. Single-mode fibre has no modal dispersion, which is why long-haul links use it.`)
  else if (single === false) notes.push(`V = ${(v as number).toFixed(3)}, above 2.405, so several modes propagate. They take different path lengths, which spreads a pulse out over distance.`)

  return {
    coreIndex,
    claddingIndex,
    numericalAperture: na,
    acceptanceAngle: acceptance,
    acceptanceDegrees: (acceptance * 180) / Math.PI,
    criticalAngle: critical,
    vNumber: v,
    singleMode: single,
    totalLoss: loss,
    survivingFraction: surviving,
    notes: Object.freeze(notes)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const OPTICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Geometric optics here is paraxial: small angles, thin elements, no aberration. Real lenses depart from it at the edges.',
  'Sign convention is Cartesian real-is-positive, and is carried on every result rather than assumed.',
  'Interference and diffraction assume monochromatic, coherent light and idealised apertures.',
  'Refractive index depends on wavelength. Materials without a dispersion model return their one measured value and say so.',
  'Fresnel reflectance assumes smooth, non-absorbing surfaces. Metals and rough surfaces need a different model.'
])
