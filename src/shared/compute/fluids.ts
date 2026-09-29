/**
 * Fluid mechanics: what pressure does with depth, what Bernoulli does and does not say, and where the energy goes.
 *
 * The shared fluid engine for Orbis Pages. Pipe flow here solves the actual implicit friction-factor equation
 * rather than quoting an explicit approximation and calling it Colebrook, and every result says which model it
 * used — because the friction factor is a modelling choice worth about 10%.
 *
 * ## Bernoulli is a statement about one streamline with nothing lost
 *
 * It is conservation of energy for a steady, incompressible, inviscid flow along a streamline. Every one of those
 * words is load-bearing: real pipes lose energy to friction, real flows are viscous, and a Bernoulli calculation
 * applied across a pump or a sudden expansion gives an answer to a question that was not asked. The energy
 * equation with a loss term is the honest version and is what this engine solves; plain Bernoulli is the special
 * case where the losses are zero, and the result says so.
 *
 * ## Why laminar and turbulent are not two ends of a spectrum
 *
 * Below about Re 2300 flow is orderly and friction goes as 1/Re exactly. Above about 4000 it is chaotic and
 * friction barely depends on Re at all. Between them it does neither reliably — the transition region is genuinely
 * unpredictable, and an engine that interpolates smoothly across it is inventing certainty. This one says the
 * flow is transitional and gives the bounds instead.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * pressure     vs  head             -- pascals against metres of fluid; they differ by rho*g
 * gauge        vs  absolute         -- against atmosphere or against vacuum
 * major        vs  minor losses     -- friction along the pipe against fittings; neither is always smaller
 * static       vs  stagnation       -- what a wall tap reads against what a facing tube reads
 * flow rate    vs  velocity         -- m^3/s against m/s; a bigger pipe carries more at the same speed
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { STANDARD_ATMOSPHERE, STANDARD_GRAVITY } from './emConstants.ts'

export interface FluidError {
  error:
    | 'invalid-argument'
    | 'not-finite'
    | 'unknown-fluid'
    | 'no-convergence'
    | 'outside-model'
    | 'too-many'
    | 'cavitation'
  message: string
}

export const isFluidError = (value: unknown): value is FluidError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: FluidError['error'], message: string): FluidError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const FLUID_LIMITS = Object.freeze({
  fittings: 64,
  sweepPoints: 2000,
  iterations: 200
})

// ---------------------------------------------------------------- fluids

export interface Fluid {
  id: string
  name: string
  /** kg/m³. */
  density: number
  /** Pa·s. */
  dynamicViscosity: number
  /** Pa, absolute. Below this it boils at the working temperature — the cavitation limit. */
  vapourPressure: number | null
  /** N/m. */
  surfaceTension: number | null
  referenceTemperature: number
  source: string
}

const fluid = (one: Fluid): Fluid => Object.freeze(one)

export const FLUIDS: readonly Fluid[] = Object.freeze([
  fluid({
    id: 'water',
    name: 'Water',
    density: 998.2,
    dynamicViscosity: 1.002e-3,
    vapourPressure: 2339,
    surfaceTension: 0.0728,
    referenceTemperature: 20,
    source: 'CRC Handbook, 20 C'
  }),
  fluid({
    id: 'air',
    name: 'Air',
    density: 1.204,
    dynamicViscosity: 1.825e-5,
    vapourPressure: null,
    surfaceTension: null,
    referenceTemperature: 20,
    source: 'CRC Handbook, 20 C and 1 atm'
  }),
  fluid({
    id: 'seawater',
    name: 'Seawater',
    density: 1025,
    dynamicViscosity: 1.07e-3,
    vapourPressure: 2300,
    surfaceTension: 0.0734,
    referenceTemperature: 20,
    source: 'Typical, 35 ppt salinity at 20 C'
  }),
  fluid({
    id: 'engine-oil',
    name: 'SAE 30 engine oil',
    density: 891,
    dynamicViscosity: 0.29,
    vapourPressure: null,
    surfaceTension: 0.035,
    referenceTemperature: 20,
    source: 'Typical, 20 C'
  }),
  fluid({
    id: 'glycerine',
    name: 'Glycerine',
    density: 1260,
    dynamicViscosity: 1.49,
    vapourPressure: null,
    surfaceTension: 0.063,
    referenceTemperature: 20,
    source: 'CRC Handbook, 20 C'
  }),
  fluid({
    id: 'mercury',
    name: 'Mercury',
    density: 13546,
    dynamicViscosity: 1.526e-3,
    vapourPressure: 0.17,
    surfaceTension: 0.4855,
    referenceTemperature: 20,
    source: 'CRC Handbook, 20 C'
  }),
  fluid({
    id: 'ethanol',
    name: 'Ethanol',
    density: 789,
    dynamicViscosity: 1.2e-3,
    vapourPressure: 5900,
    surfaceTension: 0.0223,
    referenceTemperature: 20,
    source: 'CRC Handbook, 20 C'
  })
])

export function fluidById(id: string): Fluid | FluidError {
  const wanted = id.trim().toLowerCase()
  const found =
    FLUIDS.find((one) => one.id === wanted) ??
    FLUIDS.find((one) => one.name.toLowerCase() === wanted) ??
    FLUIDS.find((one) => one.name.toLowerCase().includes(wanted))
  if (found) return found
  return fail(
    'unknown-fluid',
    `There is no fluid called "${id}" here. Give a density and viscosity directly, or pick one of: ${FLUIDS.map((one) => one.id).join(', ')}.`
  )
}

// ---------------------------------------------------------------- hydrostatics

export interface HydrostaticReport {
  /** Pa, above whatever the surface pressure is. */
  gaugePressure: number
  /** Pa, against vacuum. */
  absolutePressure: number
  /** Metres of this fluid. */
  head: number
  depth: number
  density: number
  surfacePressure: number
  notes: readonly string[]
}

/** Pressure at a depth. Depends on depth and density, and not at all on the shape of the container. */
export function pressureAtDepth(input: {
  depth: number
  fluid?: string
  density?: number
  surfacePressure?: number
  gravity?: number
}): HydrostaticReport | FluidError {
  const { depth } = input
  if (!finite(depth)) return fail('not-finite', 'The depth has to be a finite number.')
  if (depth < 0) return fail('invalid-argument', 'The depth cannot be negative. Measure downward from the surface.')

  let density = input.density
  if (density === undefined) {
    const found = fluidById(input.fluid ?? 'water')
    if (isFluidError(found)) return found
    density = found.density
  }
  if (!finite(density) || density <= 0) return fail('invalid-argument', 'The density has to be greater than zero.')
  const g = input.gravity ?? STANDARD_GRAVITY
  const surface = input.surfacePressure ?? STANDARD_ATMOSPHERE

  const gauge = density * g * depth
  return {
    gaugePressure: gauge,
    absolutePressure: gauge + surface,
    head: depth,
    depth,
    density,
    surfacePressure: surface,
    notes: Object.freeze([
      'Pressure depends only on depth, density and gravity. The shape of the container makes no difference, which is the hydrostatic paradox: a narrow tube and a wide tank at the same depth read the same.',
      'Gauge pressure is measured against the atmosphere; absolute against vacuum. Mixing the two is out by about 101 kPa, which at shallow depths is most of the answer.'
    ])
  }
}

export interface BuoyancyReport {
  /** Newtons. */
  buoyantForce: number
  /** m³ of fluid pushed aside. */
  displacedVolume: number
  /** kg. */
  displacedMass: number
  /** Newtons. Positive means it sinks. */
  netForce: number
  floats: boolean
  /** The fraction submerged when floating. Null when it sinks. */
  submergedFraction: number | null
  notes: readonly string[]
}

/** Archimedes: the buoyant force equals the weight of fluid displaced, whatever the object is made of. */
export function buoyancy(input: {
  objectVolume: number
  objectDensity?: number
  objectMass?: number
  fluid?: string
  fluidDensity?: number
  gravity?: number
}): BuoyancyReport | FluidError {
  const { objectVolume } = input
  if (!finite(objectVolume) || objectVolume <= 0) return fail('invalid-argument', 'The volume has to be greater than zero.')

  let fluidDensity = input.fluidDensity
  if (fluidDensity === undefined) {
    const found = fluidById(input.fluid ?? 'water')
    if (isFluidError(found)) return found
    fluidDensity = found.density
  }
  if (!finite(fluidDensity) || fluidDensity <= 0) return fail('invalid-argument', 'The fluid density has to be greater than zero.')

  const hasDensity = input.objectDensity !== undefined
  const hasMass = input.objectMass !== undefined
  if (hasDensity === hasMass) {
    return fail('invalid-argument', 'Give the object mass or its density, not both — volume fixes one from the other.')
  }
  const mass = hasMass ? (input.objectMass as number) : (input.objectDensity as number) * objectVolume
  if (!finite(mass) || mass <= 0) return fail('invalid-argument', 'The object mass has to be greater than zero.')
  const objectDensity = mass / objectVolume

  const g = input.gravity ?? STANDARD_GRAVITY
  const displacedMass = fluidDensity * objectVolume
  const buoyant = displacedMass * g
  const weight = mass * g
  const floats = objectDensity < fluidDensity

  return {
    buoyantForce: buoyant,
    displacedVolume: objectVolume,
    displacedMass,
    netForce: weight - buoyant,
    floats,
    submergedFraction: floats ? objectDensity / fluidDensity : null,
    notes: Object.freeze([
      floats
        ? `It floats with ${((objectDensity / fluidDensity) * 100).toFixed(1)}% of its volume under water. The fraction submerged is just the density ratio, which is why ice sits about a tenth proud.`
        : 'It sinks: it is denser than the fluid, so the fluid it displaces weighs less than it does.',
      'The buoyant force depends on the volume displaced and the fluid, never on what the object is made of. A tonne of steel and a tonne of feathers displace different volumes and feel different buoyancy.'
    ])
  }
}

// ---------------------------------------------------------------- dimensionless numbers

export type DimensionlessNumber =
  | 'reynolds'
  | 'mach'
  | 'froude'
  | 'weber'
  | 'euler'
  | 'strouhal'
  | 'prandtl'
  | 'nusselt'
  | 'grashof'
  | 'rayleigh'
  | 'peclet'

export const DIMENSIONLESS_NUMBERS: readonly DimensionlessNumber[] = Object.freeze([
  'reynolds',
  'mach',
  'froude',
  'weber',
  'euler',
  'strouhal',
  'prandtl',
  'nusselt',
  'grashof',
  'rayleigh',
  'peclet'
])

export const DIMENSIONLESS_FACTS: Readonly<
  Record<DimensionlessNumber, { label: string; formula: string; compares: string; interpret: string }>
> = Object.freeze({
  reynolds: {
    label: 'Reynolds number',
    formula: 'Re = rho*v*L / mu',
    compares: 'Inertia against viscosity.',
    interpret: 'Below about 2300 in a pipe the flow is laminar; above about 4000 it is turbulent. Between them it is neither reliably.'
  },
  mach: {
    label: 'Mach number',
    formula: 'Ma = v / a',
    compares: 'Speed against the speed of sound.',
    interpret: 'Below about 0.3 a gas can be treated as incompressible. Above 1 shock waves appear and the equations change character.'
  },
  froude: {
    label: 'Froude number',
    formula: 'Fr = v / sqrt(g*L)',
    compares: 'Inertia against gravity.',
    interpret: 'Below 1 an open channel is subcritical and disturbances travel upstream; above 1 it is supercritical and they cannot.'
  },
  weber: {
    label: 'Weber number',
    formula: 'We = rho*v^2*L / sigma',
    compares: 'Inertia against surface tension.',
    interpret: 'Large means surface tension is irrelevant; small means it dominates, which is why small droplets are spherical.'
  },
  euler: {
    label: 'Euler number',
    formula: 'Eu = dp / (rho*v^2)',
    compares: 'Pressure forces against inertia.',
    interpret: 'Used for pressure-loss scaling in pumps and flow through fittings.'
  },
  strouhal: {
    label: 'Strouhal number',
    formula: 'St = f*L / v',
    compares: 'Oscillation frequency against flow speed.',
    interpret: 'Around 0.2 for vortex shedding behind a cylinder, which is what makes wires sing in the wind.'
  },
  prandtl: {
    label: 'Prandtl number',
    formula: 'Pr = cp*mu / k',
    compares: 'Momentum diffusion against heat diffusion.',
    interpret: 'About 0.7 for air and about 7 for water. Liquid metals are far below 1, which is why they cool so well.'
  },
  nusselt: {
    label: 'Nusselt number',
    formula: 'Nu = h*L / k',
    compares: 'Convective heat transfer against conduction alone.',
    interpret: 'Nu of 1 means the fluid is doing nothing that still fluid would not. Larger means the motion is carrying heat.'
  },
  grashof: {
    label: 'Grashof number',
    formula: 'Gr = g*beta*dT*L^3 / nu^2',
    compares: 'Buoyancy against viscosity.',
    interpret: 'The natural-convection equivalent of Reynolds. It decides whether warm fluid rises fast enough to matter.'
  },
  rayleigh: {
    label: 'Rayleigh number',
    formula: 'Ra = Gr * Pr',
    compares: 'Buoyancy-driven transport against diffusion.',
    interpret: 'Above about 10^9 natural convection turns turbulent.'
  },
  peclet: {
    label: 'Peclet number',
    formula: 'Pe = Re * Pr',
    compares: 'Advection against diffusion.',
    interpret: 'Large means heat is carried by the flow rather than conducted through it.'
  }
})

export interface DimensionlessReport {
  number: DimensionlessNumber
  label: string
  value: number
  formula: string
  compares: string
  interpret: string
  /** Where this value sits in the regimes that matter. */
  regime: string | null
  notes: readonly string[]
}

/** Compute a named dimensionless number from its defining quantities. */
export function dimensionless(input: {
  number: DimensionlessNumber
  velocity?: number
  length?: number
  density?: number
  dynamicViscosity?: number
  kinematicViscosity?: number
  speedOfSound?: number
  gravity?: number
  surfaceTension?: number
  pressureDrop?: number
  frequency?: number
  specificHeat?: number
  thermalConductivity?: number
  heatTransferCoefficient?: number
  expansionCoefficient?: number
  temperatureDifference?: number
  prandtl?: number
  reynolds?: number
  grashof?: number
}): DimensionlessReport | FluidError {
  const facts = DIMENSIONLESS_FACTS[input.number]
  if (!facts) return fail('invalid-argument', `"${input.number}" is not one of: ${DIMENSIONLESS_NUMBERS.join(', ')}.`)

  const need = (name: keyof typeof input, positive = true): number | FluidError => {
    const value = input[name]
    if (value === undefined || typeof value !== 'number') {
      return fail('invalid-argument', `${facts.label} needs "${String(name)}". Its formula is ${facts.formula}.`)
    }
    if (!finite(value)) return fail('not-finite', `"${String(name)}" has to be a finite number.`)
    if (positive && value <= 0) return fail('invalid-argument', `"${String(name)}" has to be greater than zero.`)
    return value
  }

  let value: number
  let regime: string | null = null

  switch (input.number) {
    case 'reynolds': {
      const v = need('velocity', false)
      if (isFluidError(v)) return v
      const l = need('length')
      if (isFluidError(l)) return l
      if (input.kinematicViscosity !== undefined) {
        const nu = need('kinematicViscosity')
        if (isFluidError(nu)) return nu
        value = (Math.abs(v) * l) / nu
      } else {
        const rho = need('density')
        if (isFluidError(rho)) return rho
        const mu = need('dynamicViscosity')
        if (isFluidError(mu)) return mu
        value = (rho * Math.abs(v) * l) / mu
      }
      regime = value < 2300 ? 'laminar' : value > 4000 ? 'turbulent' : 'transitional'
      break
    }
    case 'mach': {
      const v = need('velocity', false)
      if (isFluidError(v)) return v
      const a = need('speedOfSound')
      if (isFluidError(a)) return a
      value = Math.abs(v) / a
      regime = value < 0.3 ? 'effectively incompressible' : value < 0.8 ? 'subsonic' : value < 1.2 ? 'transonic' : value < 5 ? 'supersonic' : 'hypersonic'
      break
    }
    case 'froude': {
      const v = need('velocity', false)
      if (isFluidError(v)) return v
      const l = need('length')
      if (isFluidError(l)) return l
      const g = input.gravity ?? STANDARD_GRAVITY
      value = Math.abs(v) / Math.sqrt(g * l)
      regime = value < 1 ? 'subcritical' : value > 1 ? 'supercritical' : 'critical'
      break
    }
    case 'weber': {
      const v = need('velocity', false)
      if (isFluidError(v)) return v
      const l = need('length')
      if (isFluidError(l)) return l
      const rho = need('density')
      if (isFluidError(rho)) return rho
      const sigma = need('surfaceTension')
      if (isFluidError(sigma)) return sigma
      value = (rho * v * v * l) / sigma
      break
    }
    case 'euler': {
      const dp = need('pressureDrop', false)
      if (isFluidError(dp)) return dp
      const rho = need('density')
      if (isFluidError(rho)) return rho
      const v = need('velocity')
      if (isFluidError(v)) return v
      value = dp / (rho * v * v)
      break
    }
    case 'strouhal': {
      const f = need('frequency')
      if (isFluidError(f)) return f
      const l = need('length')
      if (isFluidError(l)) return l
      const v = need('velocity')
      if (isFluidError(v)) return v
      value = (f * l) / v
      break
    }
    case 'prandtl': {
      const cp = need('specificHeat')
      if (isFluidError(cp)) return cp
      const mu = need('dynamicViscosity')
      if (isFluidError(mu)) return mu
      const k = need('thermalConductivity')
      if (isFluidError(k)) return k
      value = (cp * mu) / k
      break
    }
    case 'nusselt': {
      const h = need('heatTransferCoefficient')
      if (isFluidError(h)) return h
      const l = need('length')
      if (isFluidError(l)) return l
      const k = need('thermalConductivity')
      if (isFluidError(k)) return k
      value = (h * l) / k
      break
    }
    case 'grashof': {
      const beta = need('expansionCoefficient')
      if (isFluidError(beta)) return beta
      const dt = need('temperatureDifference', false)
      if (isFluidError(dt)) return dt
      const l = need('length')
      if (isFluidError(l)) return l
      const nu = need('kinematicViscosity')
      if (isFluidError(nu)) return nu
      const g = input.gravity ?? STANDARD_GRAVITY
      value = (g * beta * Math.abs(dt) * Math.pow(l, 3)) / (nu * nu)
      break
    }
    case 'rayleigh': {
      const gr = need('grashof')
      if (isFluidError(gr)) return gr
      const pr = need('prandtl')
      if (isFluidError(pr)) return pr
      value = gr * pr
      regime = value < 1e9 ? 'laminar natural convection' : 'turbulent natural convection'
      break
    }
    default: {
      const re = need('reynolds')
      if (isFluidError(re)) return re
      const pr = need('prandtl')
      if (isFluidError(pr)) return pr
      value = re * pr
      break
    }
  }

  return {
    number: input.number,
    label: facts.label,
    value,
    formula: facts.formula,
    compares: facts.compares,
    interpret: facts.interpret,
    regime,
    notes: Object.freeze([
      'A dimensionless number is a ratio of two effects. Its value says which one is winning, and nothing else.',
      ...(regime === 'transitional'
        ? [
            'This is in the transition region. Flow there genuinely cannot be predicted reliably — it depends on inlet disturbances, roughness and history, and a single friction factor for it would be invented certainty.'
          ]
        : [])
    ])
  }
}

// ---------------------------------------------------------------- pipe flow

export type FrictionModel = 'laminar' | 'blasius' | 'colebrook' | 'haaland' | 'swamee-jain'

export const FRICTION_MODELS: readonly FrictionModel[] = Object.freeze([
  'laminar',
  'blasius',
  'colebrook',
  'haaland',
  'swamee-jain'
])

export const FRICTION_FACTS: Readonly<
  Record<FrictionModel, { label: string; formula: string; validFor: string; implicit: boolean }>
> = Object.freeze({
  laminar: { label: 'Laminar', formula: 'f = 64/Re', validFor: 'Re below about 2300. Exact, not a correlation.', implicit: false },
  blasius: {
    label: 'Blasius',
    formula: 'f = 0.316 * Re^-0.25',
    validFor: 'Smooth pipes, Re between 4000 and 100000.',
    implicit: false
  },
  colebrook: {
    label: 'Colebrook-White',
    formula: '1/sqrt(f) = -2*log10(e/(3.7*D) + 2.51/(Re*sqrt(f)))',
    validFor: 'Turbulent flow, any roughness. The reference equation, solved iteratively.',
    implicit: true
  },
  haaland: {
    label: 'Haaland',
    formula: '1/sqrt(f) = -1.8*log10((e/(3.7*D))^1.11 + 6.9/Re)',
    validFor: 'Explicit approximation to Colebrook, within about 2%.',
    implicit: false
  },
  'swamee-jain': {
    label: 'Swamee-Jain',
    formula: 'f = 0.25 / [log10(e/(3.7*D) + 5.74/Re^0.9)]^2',
    validFor: 'Explicit approximation to Colebrook, within about 1% for 5000 < Re < 10^8.',
    implicit: false
  }
})

export interface PipeFlowReport {
  /** m/s. */
  velocity: number
  /** m³/s. */
  flowRate: number
  reynolds: number
  regime: 'laminar' | 'transitional' | 'turbulent'
  frictionFactor: number
  frictionModel: FrictionModel
  /** Whether the implicit equation was actually iterated to convergence. */
  iterations: number | null
  /** Pa. Friction along the pipe. */
  majorLoss: number
  /** Pa. Fittings, bends, valves. */
  minorLoss: number
  totalLoss: number
  /** Metres of fluid. */
  headLoss: number
  /** W. What a pump would have to supply to overcome it. */
  pumpingPower: number
  /** The relative roughness, which is what actually decides turbulent friction. */
  relativeRoughness: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Pressure loss along a pipe, with the friction factor solved rather than approximated.
 *
 * Colebrook is implicit — `f` appears on both sides — so it is iterated to convergence and the iteration count is
 * reported. The explicit approximations are offered too, and they are labelled as approximations rather than
 * presented as the equation they approximate.
 */
export function pipeFlow(input: {
  diameter: number
  length: number
  velocity?: number
  flowRate?: number
  fluid?: string
  density?: number
  dynamicViscosity?: number
  roughness?: number
  frictionModel?: FrictionModel
  minorLossCoefficients?: readonly number[]
  gravity?: number
}): PipeFlowReport | FluidError {
  const { diameter, length } = input
  for (const [name, value] of Object.entries({ diameter, length })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  let density = input.density
  let viscosity = input.dynamicViscosity
  if (density === undefined || viscosity === undefined) {
    const found = fluidById(input.fluid ?? 'water')
    if (isFluidError(found)) return found
    density = density ?? found.density
    viscosity = viscosity ?? found.dynamicViscosity
  }
  if (!finite(density) || density <= 0) return fail('invalid-argument', 'The density has to be greater than zero.')
  if (!finite(viscosity) || viscosity <= 0) return fail('invalid-argument', 'The viscosity has to be greater than zero.')

  const area = (Math.PI * diameter * diameter) / 4
  const hasVelocity = input.velocity !== undefined
  const hasFlow = input.flowRate !== undefined
  if (hasVelocity === hasFlow) {
    return fail('invalid-argument', 'Give a velocity or a flow rate, not both — the pipe diameter fixes one from the other.')
  }
  const velocity = hasVelocity ? (input.velocity as number) : (input.flowRate as number) / area
  if (!finite(velocity)) return fail('not-finite', 'The velocity came out as a value that is not finite.')
  const flowRate = velocity * area

  const roughness = input.roughness ?? 0
  if (!finite(roughness) || roughness < 0) return fail('invalid-argument', 'The roughness cannot be negative.')
  if (roughness >= diameter) return fail('invalid-argument', 'The roughness is larger than the pipe, which describes no pipe.')
  const relativeRoughness = roughness / diameter

  const reynolds = (density * Math.abs(velocity) * diameter) / viscosity
  const regime: PipeFlowReport['regime'] = reynolds < 2300 ? 'laminar' : reynolds > 4000 ? 'turbulent' : 'transitional'

  // Pick a model if none was given, and be honest about the transition region.
  const requested = input.frictionModel
  const model: FrictionModel = requested ?? (regime === 'laminar' ? 'laminar' : 'colebrook')
  const warnings: string[] = []
  if (regime === 'transitional' && requested === undefined) {
    warnings.push(
      `Reynolds is ${reynolds.toFixed(0)}, in the transition region between 2300 and 4000. Flow there is genuinely unpredictable and no correlation covers it; the turbulent model was used, and the real friction could be anywhere between the laminar 64/Re and this.`
    )
  }
  if (model === 'laminar' && regime === 'turbulent') {
    warnings.push('The laminar model was asked for but the flow is turbulent. f = 64/Re will read far too low.')
  }
  if (model === 'blasius' && (reynolds < 4000 || reynolds > 1e5)) {
    warnings.push(`Blasius is valid between Re 4000 and 100000; this is ${reynolds.toExponential(2)}.`)
  }
  if ((model === 'blasius' || model === 'haaland' || model === 'swamee-jain' || model === 'colebrook') && reynolds < 2300) {
    warnings.push('A turbulent friction model was used on laminar flow. Below Re 2300 the answer is exactly 64/Re and no correlation is needed.')
  }

  let f: number
  let iterations: number | null = null
  if (reynolds === 0) {
    f = 0
  } else if (model === 'laminar') {
    f = 64 / reynolds
  } else if (model === 'blasius') {
    f = 0.316 * Math.pow(reynolds, -0.25)
  } else if (model === 'haaland') {
    const inner = Math.pow(relativeRoughness / 3.7, 1.11) + 6.9 / reynolds
    f = Math.pow(-1.8 * Math.log10(inner), -2)
  } else if (model === 'swamee-jain') {
    const inner = relativeRoughness / 3.7 + 5.74 / Math.pow(reynolds, 0.9)
    f = 0.25 / Math.pow(Math.log10(inner), 2)
  } else {
    // Colebrook, iterated. Start from Swamee-Jain, which is close enough that this converges in a handful of steps.
    const start = relativeRoughness / 3.7 + 5.74 / Math.pow(reynolds, 0.9)
    let guess = 0.25 / Math.pow(Math.log10(start), 2)
    let converged = false
    let step = 0
    for (; step < FLUID_LIMITS.iterations; step += 1) {
      const next = Math.pow(-2 * Math.log10(relativeRoughness / 3.7 + 2.51 / (reynolds * Math.sqrt(guess))), -2)
      if (!finite(next) || next <= 0) {
        return fail('no-convergence', 'The Colebrook iteration produced a value that is not physical. Check the Reynolds number and roughness.')
      }
      if (Math.abs(next - guess) < guess * 1e-12) {
        guess = next
        converged = true
        step += 1
        break
      }
      guess = next
    }
    if (!converged) {
      return fail('no-convergence', `The Colebrook equation did not converge in ${FLUID_LIMITS.iterations} iterations.`)
    }
    f = guess
    iterations = step
  }

  const dynamicPressure = 0.5 * density * velocity * velocity
  const major = f * (length / diameter) * dynamicPressure
  const minorK = (input.minorLossCoefficients ?? []).reduce((sum, one) => sum + one, 0)
  if ((input.minorLossCoefficients ?? []).length > FLUID_LIMITS.fittings) {
    return fail('too-many', `That is more than the ${FLUID_LIMITS.fittings} fittings this handles.`)
  }
  const minor = minorK * dynamicPressure
  const total = major + minor
  const g = input.gravity ?? STANDARD_GRAVITY

  const notes: string[] = [
    `${FRICTION_FACTS[model].label}: ${FRICTION_FACTS[model].formula}. ${FRICTION_FACTS[model].validFor}`
  ]
  if (model === 'colebrook') {
    notes.push(`Colebrook is implicit, so it was iterated; it converged in ${iterations} steps rather than being approximated.`)
  } else if (model !== 'laminar') {
    notes.push('This is an explicit approximation to Colebrook, not Colebrook itself. It is close but it is not the same equation.')
  }
  if (regime === 'laminar') {
    notes.push('In laminar flow roughness makes no difference at all — the fluid near the wall is not moving, so it never feels the bumps.')
  } else {
    notes.push('In fully turbulent flow the friction factor stops depending on Reynolds and depends only on relative roughness. Pumping faster then costs strictly more.')
  }
  if (minorK > 0 && minor > major) {
    notes.push('The fittings lose more than the pipe does. In short runs with many bends that is normal, and calling them "minor" losses is a historical name rather than a description.')
  }

  return {
    velocity,
    flowRate,
    reynolds,
    regime,
    frictionFactor: f,
    frictionModel: model,
    iterations,
    majorLoss: major,
    minorLoss: minor,
    totalLoss: total,
    headLoss: total / (density * g),
    pumpingPower: total * Math.abs(flowRate),
    relativeRoughness,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- energy equation

export interface StationState {
  /** Pa, gauge. */
  pressure: number
  /** m/s. */
  velocity: number
  /** Metres above the datum. */
  elevation: number
  label?: string
}

export interface EnergyReport {
  from: StationState
  to: StationState
  /** Every term in metres of fluid, so they can be compared directly. */
  heads: {
    fromPressure: number
    fromVelocity: number
    fromElevation: number
    fromTotal: number
    toPressure: number
    toVelocity: number
    toElevation: number
    toTotal: number
  }
  /** Metres. Positive means energy was lost between the two points. */
  headLoss: number
  /** Metres. What a pump would have to add to make the two ends balance. Negative means a turbine takes it out. */
  pumpHead: number
  /** True only when the losses are zero, which is the condition plain Bernoulli assumes. */
  bernoulliApplies: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The energy equation between two points, with the loss term kept.
 *
 * Plain Bernoulli is the special case where the loss is zero. This reports the loss rather than assuming it away,
 * because applying Bernoulli across a pipe run, a valve or a sudden expansion gives an answer to a question that
 * was not asked — and the difference is exactly the number an engineer wants.
 */
export function energyEquation(input: {
  from: StationState
  to: StationState
  fluid?: string
  density?: number
  headLoss?: number
  pumpHead?: number
  gravity?: number
}): EnergyReport | FluidError {
  const { from, to } = input
  for (const [name, station] of Object.entries({ from, to })) {
    for (const [field, value] of Object.entries({ pressure: station.pressure, velocity: station.velocity, elevation: station.elevation })) {
      if (!finite(value)) return fail('not-finite', `The ${name} station has a ${field} that is not finite.`)
    }
  }

  let density = input.density
  if (density === undefined) {
    const found = fluidById(input.fluid ?? 'water')
    if (isFluidError(found)) return found
    density = found.density
  }
  if (!finite(density) || density <= 0) return fail('invalid-argument', 'The density has to be greater than zero.')
  const g = input.gravity ?? STANDARD_GRAVITY

  const head = (one: StationState): { pressure: number; velocity: number; elevation: number; total: number } => {
    const p = one.pressure / ((density as number) * g)
    const v = (one.velocity * one.velocity) / (2 * g)
    return { pressure: p, velocity: v, elevation: one.elevation, total: p + v + one.elevation }
  }
  const a = head(from)
  const b = head(to)

  // If neither loss nor pump was given, the imbalance is whatever is unaccounted for.
  const givenLoss = input.headLoss
  const givenPump = input.pumpHead
  const imbalance = a.total - b.total
  const loss = givenLoss ?? (givenPump !== undefined ? imbalance + givenPump : imbalance)
  const pump = givenPump ?? (givenLoss !== undefined ? givenLoss - imbalance : 0)

  const warnings: string[] = []
  const scale = Math.max(Math.abs(a.total), Math.abs(b.total), 1)
  const bernoulli = Math.abs(loss) < scale * 1e-9 && Math.abs(pump) < scale * 1e-9

  const notes: string[] = []
  if (bernoulli) {
    notes.push(
      'The two ends balance with no loss and no pump, which is exactly the condition plain Bernoulli assumes. That is the special case, not the general one.'
    )
  } else if (givenLoss === undefined && givenPump === undefined) {
    notes.push(
      `The two ends do not balance by ${Math.abs(imbalance).toFixed(4)} m of fluid. That gap is the energy lost between them — friction, fittings, turbulence — and Bernoulli applied here would be out by exactly that.`
    )
  }
  if (loss < -scale * 1e-9 && givenLoss === undefined) {
    warnings.push(
      'The downstream station has more energy than the upstream one with no pump given. Either something is adding energy or one of the readings is wrong; energy does not appear on its own.'
    )
  }
  notes.push(
    'Every term is in metres of fluid so they can be compared side by side: pressure head, velocity head and elevation head are the same quantity measured three ways.'
  )

  return {
    from,
    to,
    heads: {
      fromPressure: a.pressure,
      fromVelocity: a.velocity,
      fromElevation: a.elevation,
      fromTotal: a.total,
      toPressure: b.pressure,
      toVelocity: b.velocity,
      toElevation: b.elevation,
      toTotal: b.total
    },
    headLoss: loss,
    pumpHead: pump,
    bernoulliApplies: bernoulli,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

export interface ContinuityReport {
  /** kg/s. Constant through the system, which is the whole content of continuity. */
  massFlowRate: number
  stations: readonly { label: string; area: number; velocity: number; volumeFlow: number; density: number }[]
  incompressible: boolean
  notes: readonly string[]
}

/** Continuity: mass in equals mass out. Volume flow is only constant when the density is. */
export function continuity(input: {
  stations: readonly { area: number; velocity?: number; density?: number; label?: string }[]
  massFlowRate?: number
  fluid?: string
  density?: number
}): ContinuityReport | FluidError {
  const { stations } = input
  if (stations.length === 0) return fail('invalid-argument', 'There are no stations.')
  if (stations.length > 32) return fail('too-many', 'That is more than the 32 stations this handles.')

  let baseDensity = input.density
  if (baseDensity === undefined) {
    const found = fluidById(input.fluid ?? 'water')
    if (isFluidError(found)) return found
    baseDensity = found.density
  }

  // Find the mass flow from whichever station has both an area and a velocity.
  let mass = input.massFlowRate
  if (mass === undefined) {
    for (const one of stations) {
      if (one.velocity === undefined) continue
      if (!finite(one.area) || one.area <= 0) return fail('invalid-argument', 'Every area has to be greater than zero.')
      if (!finite(one.velocity)) return fail('not-finite', 'A station velocity is not finite.')
      mass = (one.density ?? baseDensity) * one.area * one.velocity
      break
    }
  }
  if (mass === undefined) {
    return fail('invalid-argument', 'Give a mass flow rate, or a velocity at one of the stations, so the rest can be worked out.')
  }
  if (!finite(mass)) return fail('not-finite', 'The mass flow rate is not finite.')

  const densities = new Set<number>()
  const resolved: ContinuityReport['stations'][number][] = []
  for (const [i, one] of stations.entries()) {
    // Returned rather than thrown: every failure in this engine is a value the caller can read, and a throw from
    // inside a map would escape that contract entirely.
    if (!finite(one.area) || one.area <= 0) {
      return fail('invalid-argument', `Station ${i + 1} has an area of ${one.area}; it has to be greater than zero.`)
    }
    const density = one.density ?? (baseDensity as number)
    if (!finite(density) || density <= 0) {
      return fail('invalid-argument', `Station ${i + 1} has a density that is not greater than zero.`)
    }
    densities.add(density)
    const velocity = (mass as number) / (density * one.area)
    resolved.push({
      label: one.label ?? `station ${i + 1}`,
      area: one.area,
      velocity,
      volumeFlow: velocity * one.area,
      density
    })
  }

  const incompressible = densities.size === 1
  const notes: string[] = ['Mass flow is the same at every station. That is what continuity says, and it holds whether or not the density changes.']
  if (incompressible) {
    notes.push('The density is the same everywhere, so volume flow is constant too and a narrower pipe simply means a faster flow.')
  } else {
    notes.push(
      'The density differs between stations, so volume flow is not constant even though mass flow is. Treating them as the same is the usual compressible-flow mistake.'
    )
  }

  return {
    massFlowRate: mass,
    stations: Object.freeze(resolved),
    incompressible,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- pumps

export interface PumpReport {
  /** Metres. */
  head: number
  /** m³/s. */
  flowRate: number
  /** W. The useful power delivered to the fluid. */
  hydraulicPower: number
  /** W. What the shaft has to supply. */
  shaftPower: number
  efficiency: number
  /** Metres. Net positive suction head available, when the suction conditions were given. */
  npshAvailable: number | null
  cavitationRisk: boolean | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Pump power, and the cavitation check that decides whether it works at all.
 *
 * A pump that is asked to lift from too far below, or to handle a liquid near its boiling point, will cavitate:
 * the pressure at the impeller eye drops below the vapour pressure, bubbles form and collapse, and the pump loses
 * head and eats itself. It is not a power problem and no amount of motor fixes it — so NPSH is computed whenever
 * the suction conditions are known.
 */
export function pumpPerformance(input: {
  head: number
  flowRate: number
  efficiency?: number
  fluid?: string
  density?: number
  vapourPressure?: number
  suctionPressure?: number
  suctionLift?: number
  suctionLosses?: number
  requiredNpsh?: number
  gravity?: number
}): PumpReport | FluidError {
  const { head, flowRate } = input
  for (const [name, value] of Object.entries({ head, flowRate })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (flowRate < 0) return fail('invalid-argument', 'The flow rate cannot be negative.')
  const efficiency = input.efficiency ?? 1
  if (!finite(efficiency) || efficiency <= 0 || efficiency > 1) {
    return fail('invalid-argument', 'The efficiency is a fraction between 0 and 1.')
  }

  let density = input.density
  let vapour = input.vapourPressure
  if (density === undefined || vapour === undefined) {
    const found = fluidById(input.fluid ?? 'water')
    if (isFluidError(found)) return found
    density = density ?? found.density
    vapour = vapour ?? found.vapourPressure ?? undefined
  }
  if (!finite(density as number) || (density as number) <= 0) return fail('invalid-argument', 'The density has to be greater than zero.')
  const g = input.gravity ?? STANDARD_GRAVITY

  const hydraulic = (density as number) * g * head * flowRate
  const shaft = hydraulic / efficiency

  let npsh: number | null = null
  let risk: boolean | null = null
  const warnings: string[] = []
  if (vapour !== undefined && (input.suctionPressure !== undefined || input.suctionLift !== undefined)) {
    const suctionPressure = input.suctionPressure ?? STANDARD_ATMOSPHERE
    const lift = input.suctionLift ?? 0
    const losses = input.suctionLosses ?? 0
    for (const [name, value] of Object.entries({ suctionPressure, lift, losses })) {
      if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    }
    npsh = (suctionPressure - vapour) / ((density as number) * g) - lift - losses
    if (input.requiredNpsh !== undefined) {
      if (!finite(input.requiredNpsh) || input.requiredNpsh < 0) {
        return fail('invalid-argument', 'The required NPSH cannot be negative.')
      }
      risk = npsh < input.requiredNpsh
      if (risk) {
        warnings.push(
          `Available NPSH is ${npsh.toFixed(3)} m against the ${input.requiredNpsh.toFixed(3)} m the pump needs. It will cavitate: bubbles form at the impeller eye and collapse against the blades. That is a suction problem, and a bigger motor does not fix it.`
        )
      }
    } else if (npsh <= 0) {
      risk = true
      warnings.push(
        'Available NPSH is zero or negative, so the liquid boils before it reaches the impeller. The pump cannot draw from here whatever its rating.'
      )
    }
  }

  const notes: string[] = [
    'Hydraulic power is what reaches the fluid. Shaft power is what the motor supplies, and the difference is the efficiency.'
  ]
  if (npsh === null) {
    notes.push('No cavitation check was made: that needs the suction conditions and the fluid vapour pressure. A pump can be perfectly powerful and still not work because of them.')
  } else {
    notes.push('NPSH available is how much the pressure at the impeller eye exceeds the vapour pressure, in metres. It depends on the installation, not on the pump.')
  }
  if (efficiency === 1) {
    notes.push('No efficiency was given, so this assumes a perfect pump. Real centrifugal pumps run somewhere between 0.5 and 0.85 at their best point and worse away from it.')
  }

  return {
    head,
    flowRate,
    hydraulicPower: hydraulic,
    shaftPower: shaft,
    efficiency,
    npshAvailable: npsh,
    cavitationRisk: risk,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- open channel

export type ChannelShape = 'rectangular' | 'trapezoidal' | 'triangular' | 'circular'

export const CHANNEL_SHAPES: readonly ChannelShape[] = Object.freeze([
  'rectangular',
  'trapezoidal',
  'triangular',
  'circular'
])

export interface ChannelReport {
  shape: ChannelShape
  /** m². */
  area: number
  /** Metres. The wetted part of the boundary. */
  wettedPerimeter: number
  /** Metres. Area over wetted perimeter — the length scale that decides open-channel friction. */
  hydraulicRadius: number
  /** m/s. */
  velocity: number
  /** m³/s. */
  discharge: number
  froude: number
  regime: 'subcritical' | 'critical' | 'supercritical'
  /** Metres. The depth at which the flow would be critical. */
  criticalDepth: number | null
  manningN: number
  notes: readonly string[]
}

/** Open-channel flow by Manning's equation. Empirical, and the roughness coefficient carries the uncertainty. */
export function openChannel(input: {
  shape: ChannelShape
  depth: number
  width?: number
  sideSlope?: number
  diameter?: number
  slope: number
  manningN: number
  gravity?: number
}): ChannelReport | FluidError {
  const { shape, depth, slope, manningN } = input
  for (const [name, value] of Object.entries({ depth, slope, manningN })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const g = input.gravity ?? STANDARD_GRAVITY

  let area: number
  let perimeter: number
  let topWidth: number

  switch (shape) {
    case 'rectangular': {
      const b = input.width
      if (b === undefined || !finite(b) || b <= 0) return fail('invalid-argument', 'A rectangular channel needs a width greater than zero.')
      area = b * depth
      perimeter = b + 2 * depth
      topWidth = b
      break
    }
    case 'trapezoidal': {
      const b = input.width
      const z = input.sideSlope ?? 1
      if (b === undefined || !finite(b) || b <= 0) return fail('invalid-argument', 'A trapezoidal channel needs a bed width greater than zero.')
      if (!finite(z) || z < 0) return fail('invalid-argument', 'The side slope cannot be negative. It is the horizontal run per unit rise.')
      area = (b + z * depth) * depth
      perimeter = b + 2 * depth * Math.sqrt(1 + z * z)
      topWidth = b + 2 * z * depth
      break
    }
    case 'triangular': {
      const z = input.sideSlope ?? 1
      if (!finite(z) || z <= 0) return fail('invalid-argument', 'A triangular channel needs a side slope greater than zero.')
      area = z * depth * depth
      perimeter = 2 * depth * Math.sqrt(1 + z * z)
      topWidth = 2 * z * depth
      break
    }
    default: {
      const d = input.diameter
      if (d === undefined || !finite(d) || d <= 0) return fail('invalid-argument', 'A circular channel needs a diameter greater than zero.')
      if (depth > d) return fail('invalid-argument', 'The depth is greater than the pipe diameter, so the pipe is full and this is not open-channel flow.')
      const theta = 2 * Math.acos(1 - (2 * depth) / d)
      area = ((d * d) / 8) * (theta - Math.sin(theta))
      perimeter = (d * theta) / 2
      topWidth = d * Math.sin(theta / 2)
      break
    }
  }

  const hydraulicRadius = area / perimeter
  // Manning: v = (1/n) * R^(2/3) * S^(1/2)
  const velocity = (1 / manningN) * Math.pow(hydraulicRadius, 2 / 3) * Math.sqrt(slope)
  const discharge = velocity * area
  const hydraulicDepth = area / topWidth
  const froude = velocity / Math.sqrt(g * hydraulicDepth)

  // Critical depth for a rectangular channel has a closed form; the others need iteration and are left null.
  const criticalDepth =
    shape === 'rectangular' && input.width !== undefined
      ? Math.cbrt((discharge / input.width) ** 2 / g)
      : null

  const regime: ChannelReport['regime'] = froude < 0.99 ? 'subcritical' : froude > 1.01 ? 'supercritical' : 'critical'
  const notes: string[] = [
    "Manning's equation is empirical. The roughness coefficient n carries most of the uncertainty, and a 10% error in n is a 10% error in the answer.",
    regime === 'subcritical'
      ? 'Subcritical: the flow is slower than a surface wave, so a disturbance downstream travels back upstream. Control is from downstream.'
      : regime === 'supercritical'
        ? 'Supercritical: the flow outruns its own surface waves, so nothing downstream can influence it. Control is from upstream, and a hydraulic jump is how it slows down.'
        : 'Critical: exactly at the boundary, where the specific energy is a minimum for this discharge.'
  ]
  if (criticalDepth === null) {
    notes.push('Critical depth is only given for a rectangular channel here, where it has a closed form. The other shapes need iteration.')
  }

  return {
    shape,
    area,
    wettedPerimeter: perimeter,
    hydraulicRadius,
    velocity,
    discharge,
    froude,
    regime,
    criticalDepth,
    manningN,
    notes: Object.freeze(notes)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const FLUID_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Flow is steady: nothing changes with time. Start-up, shut-down and water hammer are different problems entirely.',
  'Liquids are treated as incompressible. For gases that holds below about Mach 0.3 and not above it.',
  'Fluid properties are at one temperature. Viscosity in particular changes fast with temperature — oil more than water, water more than air.',
  'Pipe flow assumes fully developed flow in a straight round pipe. Entry lengths, bends and non-circular sections all differ.',
  "Manning's equation and the turbulent friction correlations are empirical fits, not derivations. Their roughness coefficients carry the uncertainty.",
  'Plain Bernoulli assumes no losses. Every result here reports the loss rather than assuming it away.'
])
