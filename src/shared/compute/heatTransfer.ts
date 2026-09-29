/**
 * Heat transfer: conduction through things, convection off them, radiation between them, and exchangers.
 *
 * The shared heat-transfer engine for Orbis Pages. Thermal resistance networks are assembled and solved rather
 * than quoted, correlations are named on every result, and the two heat-exchanger methods are both available
 * because each answers a different question.
 *
 * ## Why the correlation is named on every convection result
 *
 * There is no equation for a convective heat-transfer coefficient. There are empirical fits, each derived from a
 * particular geometry over a particular range, and they disagree with each other by 20% inside their own range and
 * by much more outside it. A Page showing `h = 25 W/m²K` without saying where it came from has shown a number
 * with no way to check it.
 *
 * ## LMTD against effectiveness-NTU
 *
 * They are the same physics arranged for two different questions. LMTD wants all four terminal temperatures and
 * gives you the area; NTU wants the area and the inlets and gives you the outlets. Using LMTD when two
 * temperatures are unknown means guessing and iterating; using NTU when the area is unknown means the same. The
 * engine offers both and says which suits.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * heat         vs  temperature     -- energy in transit against how hot something is
 * conduction   vs  convection      -- through a solid against carried away by a moving fluid
 * emissivity   vs  absorptivity    -- how well it radiates against how well it takes radiation in
 * resistance   vs  conductance     -- K/W against W/K; series adds one, parallel the other
 * steady       vs  transient       -- settled against still changing, and Biot decides if lumping is allowed
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { STEFAN_BOLTZMANN } from './emConstants.ts'

export interface HeatError {
  error: 'invalid-argument' | 'not-finite' | 'too-many' | 'outside-model' | 'degenerate' | 'no-solution'
  message: string
}

export const isHeatError = (value: unknown): value is HeatError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: HeatError['error'], message: string): HeatError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const HEAT_LIMITS = Object.freeze({
  layers: 32,
  nodes: 500,
  steps: 200_000,
  samples: 4000
})

// ---------------------------------------------------------------- resistance networks

export type LayerGeometry = 'plane' | 'cylindrical' | 'spherical'

export const LAYER_GEOMETRIES: readonly LayerGeometry[] = Object.freeze(['plane', 'cylindrical', 'spherical'])

export interface ConductionLayer {
  label?: string
  /** W/(m·K). */
  conductivity: number
  /** Metres. For a plane wall. */
  thickness?: number
  /** Metres. For cylindrical and spherical, the radius where this layer starts and ends. */
  innerRadius?: number
  outerRadius?: number
}

export interface SurfaceFilm {
  label?: string
  /** W/(m²·K). */
  coefficient: number
}

export interface ResistanceReport {
  geometry: LayerGeometry
  /** K/W for cylindrical and spherical; K·m²/W per unit area for a plane wall unless an area was given. */
  layers: readonly { label: string; resistance: number; kind: 'conduction' | 'convection'; fraction: number }[]
  totalResistance: number
  /** W/(m²·K) for a plane wall with an area, else W/K. */
  overallCoefficient: number
  /** Watts, when a temperature difference was given. */
  heatFlow: number | null
  /** Kelvin at each interface, when a temperature difference was given. */
  interfaceTemperatures: readonly { after: string; temperature: number }[] | null
  /** Which layer resists the most — the one worth improving. */
  dominantLayer: string
  notes: readonly string[]
}

/**
 * A thermal resistance network through layers, with the interface temperatures that follow.
 *
 * Resistances in series add, so the biggest one dominates — and it is almost never the one people expect. The
 * dominant layer is reported because insulating the wrong layer is the most common thermal mistake there is: a
 * wall with a 90% dominant air film gains almost nothing from thicker brick.
 */
export function resistanceNetwork(input: {
  geometry?: LayerGeometry
  layers: readonly ConductionLayer[]
  insideFilm?: SurfaceFilm
  outsideFilm?: SurfaceFilm
  /** m² for a plane wall; metres of length for a cylinder. Leave out for per-unit values. */
  area?: number
  length?: number
  insideTemperature?: number
  outsideTemperature?: number
}): ResistanceReport | HeatError {
  const geometry = input.geometry ?? 'plane'
  if (!LAYER_GEOMETRIES.includes(geometry)) {
    return fail('invalid-argument', `"${geometry}" is not a geometry this knows: ${LAYER_GEOMETRIES.join(', ')}.`)
  }
  if (input.layers.length === 0) return fail('invalid-argument', 'There are no layers.')
  if (input.layers.length > HEAT_LIMITS.layers) {
    return fail('too-many', `That is ${input.layers.length} layers; this handles up to ${HEAT_LIMITS.layers}.`)
  }

  const entries: { label: string; resistance: number; kind: 'conduction' | 'convection' }[] = []

  const filmArea = (radius?: number): number | HeatError => {
    if (geometry === 'plane') return input.area ?? 1
    if (radius === undefined) return fail('invalid-argument', 'A curved geometry needs radii on its layers to size the surface films.')
    if (geometry === 'cylindrical') {
      const length = input.length ?? 1
      return 2 * Math.PI * radius * length
    }
    return 4 * Math.PI * radius * radius
  }

  const first = input.layers[0]
  const last = input.layers[input.layers.length - 1]

  if (input.insideFilm) {
    if (!finite(input.insideFilm.coefficient) || input.insideFilm.coefficient <= 0) {
      return fail('invalid-argument', 'The inside film coefficient has to be greater than zero.')
    }
    const a = filmArea(first.innerRadius)
    if (isHeatError(a)) return a
    entries.push({
      label: input.insideFilm.label ?? 'inside film',
      resistance: 1 / (input.insideFilm.coefficient * a),
      kind: 'convection'
    })
  }

  for (const [i, layer] of input.layers.entries()) {
    const label = layer.label ?? `layer ${i + 1}`
    if (!finite(layer.conductivity) || layer.conductivity <= 0) {
      return fail('invalid-argument', `"${label}" has a conductivity that is not greater than zero.`)
    }
    let resistance: number
    if (geometry === 'plane') {
      if (layer.thickness === undefined || !finite(layer.thickness) || layer.thickness <= 0) {
        return fail('invalid-argument', `"${label}" needs a thickness greater than zero.`)
      }
      resistance = layer.thickness / (layer.conductivity * (input.area ?? 1))
    } else {
      const { innerRadius: r1, outerRadius: r2 } = layer
      if (r1 === undefined || r2 === undefined || !finite(r1) || !finite(r2)) {
        return fail('invalid-argument', `"${label}" needs an inner and outer radius.`)
      }
      if (r2 <= r1 || r1 <= 0) return fail('invalid-argument', `"${label}" has radii that do not increase outward.`)
      if (geometry === 'cylindrical') {
        const length = input.length ?? 1
        resistance = Math.log(r2 / r1) / (2 * Math.PI * layer.conductivity * length)
      } else {
        resistance = (1 / r1 - 1 / r2) / (4 * Math.PI * layer.conductivity)
      }
    }
    entries.push({ label, resistance, kind: 'conduction' })
  }

  if (input.outsideFilm) {
    if (!finite(input.outsideFilm.coefficient) || input.outsideFilm.coefficient <= 0) {
      return fail('invalid-argument', 'The outside film coefficient has to be greater than zero.')
    }
    const a = filmArea(last.outerRadius)
    if (isHeatError(a)) return a
    entries.push({
      label: input.outsideFilm.label ?? 'outside film',
      resistance: 1 / (input.outsideFilm.coefficient * a),
      kind: 'convection'
    })
  }

  const total = entries.reduce((sum, one) => sum + one.resistance, 0)
  if (total <= 0) return fail('degenerate', 'The total thermal resistance came out as zero, which describes no wall.')

  const withFractions = entries.map((one) => ({ ...one, fraction: one.resistance / total }))
  const dominant = withFractions.reduce((best, one) => (one.resistance > best.resistance ? one : best))

  let heatFlow: number | null = null
  let interfaces: ResistanceReport['interfaceTemperatures'] = null
  if (input.insideTemperature !== undefined && input.outsideTemperature !== undefined) {
    if (!finite(input.insideTemperature) || !finite(input.outsideTemperature)) {
      return fail('not-finite', 'The temperatures have to be finite.')
    }
    heatFlow = (input.insideTemperature - input.outsideTemperature) / total
    let running = input.insideTemperature
    const list: { after: string; temperature: number }[] = []
    for (const one of entries) {
      running -= heatFlow * one.resistance
      list.push({ after: one.label, temperature: running })
    }
    interfaces = Object.freeze(list)
  }

  const notes: string[] = [
    'Resistances in series add, so the total is dominated by the biggest one. Improving any other layer barely moves the answer.',
    `"${dominant.label}" is ${(dominant.fraction * 100).toFixed(1)}% of the total resistance. That is the one worth changing.`
  ]
  if (geometry === 'cylindrical') {
    notes.push(
      'A cylinder’s conduction resistance goes as the log of the radius ratio, and its outside surface grows with radius. Adding insulation to a thin pipe can therefore increase the heat loss until a critical radius is passed.'
    )
  }
  if (dominant.kind === 'convection') {
    notes.push('The dominant resistance is a surface film, not the wall. Thicker insulation will do very little here; moving air over the surface will do a lot.')
  }

  return {
    geometry,
    layers: Object.freeze(withFractions),
    totalResistance: total,
    overallCoefficient: 1 / total,
    heatFlow,
    interfaceTemperatures: interfaces,
    dominantLayer: dominant.label,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- convection

export type ConvectionCorrelation =
  | 'flat-plate-laminar'
  | 'flat-plate-turbulent'
  | 'pipe-laminar'
  | 'dittus-boelter'
  | 'vertical-plate-natural'
  | 'horizontal-cylinder-natural'

export const CONVECTION_CORRELATIONS: readonly ConvectionCorrelation[] = Object.freeze([
  'flat-plate-laminar',
  'flat-plate-turbulent',
  'pipe-laminar',
  'dittus-boelter',
  'vertical-plate-natural',
  'horizontal-cylinder-natural'
])

export const CONVECTION_FACTS: Readonly<
  Record<ConvectionCorrelation, { label: string; formula: string; validFor: string; mode: 'forced' | 'natural' }>
> = Object.freeze({
  'flat-plate-laminar': {
    label: 'Flat plate, laminar',
    formula: 'Nu = 0.664 * Re^0.5 * Pr^(1/3)',
    validFor: 'Re below 5x10^5, Pr above 0.6. Average over the plate.',
    mode: 'forced'
  },
  'flat-plate-turbulent': {
    label: 'Flat plate, turbulent',
    formula: 'Nu = 0.037 * Re^0.8 * Pr^(1/3)',
    validFor: 'Re between 5x10^5 and 10^7, 0.6 < Pr < 60.',
    mode: 'forced'
  },
  'pipe-laminar': {
    label: 'Pipe, laminar, constant wall temperature',
    formula: 'Nu = 3.66',
    validFor: 'Re below 2300, fully developed. A constant, not a correlation.',
    mode: 'forced'
  },
  'dittus-boelter': {
    label: 'Dittus-Boelter, turbulent pipe',
    formula: 'Nu = 0.023 * Re^0.8 * Pr^n  (n = 0.4 heating, 0.3 cooling)',
    validFor: 'Re above 10000, 0.6 < Pr < 160, L/D above 10, small temperature difference.',
    mode: 'forced'
  },
  'vertical-plate-natural': {
    label: 'Vertical plate, natural convection',
    formula: 'Nu = 0.59 * Ra^0.25  (laminar)  or  0.1 * Ra^(1/3)  (turbulent)',
    validFor: 'Ra between 10^4 and 10^13.',
    mode: 'natural'
  },
  'horizontal-cylinder-natural': {
    label: 'Horizontal cylinder, natural convection',
    formula: 'Churchill-Chu',
    validFor: 'Ra below 10^12.',
    mode: 'natural'
  }
})

export interface ConvectionReport {
  correlation: ConvectionCorrelation
  label: string
  formula: string
  nusselt: number
  /** W/(m²·K). */
  coefficient: number
  reynolds: number | null
  rayleigh: number | null
  prandtl: number
  /** Watts, when an area and temperature difference were given. */
  heatFlow: number | null
  mode: 'forced' | 'natural'
  withinValidRange: boolean
  validFor: string
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A convective heat-transfer coefficient, from a named correlation with its range checked.
 *
 * The correlation is the answer's largest source of uncertainty and it is reported, along with whether the inputs
 * were inside the range it was fitted over. Outside that range the number is still returned — extrapolation is
 * sometimes all there is — but it is flagged, because a silently extrapolated correlation is a guess wearing the
 * clothes of a measurement.
 */
export function convection(input: {
  correlation: ConvectionCorrelation
  characteristicLength: number
  thermalConductivity: number
  prandtl: number
  velocity?: number
  kinematicViscosity?: number
  rayleigh?: number
  expansionCoefficient?: number
  temperatureDifference?: number
  area?: number
  heating?: boolean
  gravity?: number
}): ConvectionReport | HeatError {
  const facts = CONVECTION_FACTS[input.correlation]
  if (!facts) {
    return fail('invalid-argument', `"${input.correlation}" is not one of: ${CONVECTION_CORRELATIONS.join(', ')}.`)
  }
  const { characteristicLength: l, thermalConductivity: k, prandtl: pr } = input
  for (const [name, value] of Object.entries({ characteristicLength: l, thermalConductivity: k, prandtl: pr })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }

  let nusselt: number
  let reynolds: number | null = null
  let rayleigh: number | null = null
  let withinRange = true
  const warnings: string[] = []

  if (facts.mode === 'forced') {
    if (input.velocity === undefined || input.kinematicViscosity === undefined) {
      return fail('invalid-argument', `${facts.label} is a forced-convection correlation and needs a velocity and a kinematic viscosity.`)
    }
    if (!finite(input.velocity) || !finite(input.kinematicViscosity) || input.kinematicViscosity <= 0) {
      return fail('invalid-argument', 'The velocity has to be finite and the kinematic viscosity greater than zero.')
    }
    reynolds = (Math.abs(input.velocity) * l) / input.kinematicViscosity

    switch (input.correlation) {
      case 'flat-plate-laminar':
        nusselt = 0.664 * Math.sqrt(reynolds) * Math.cbrt(pr)
        if (reynolds > 5e5) {
          withinRange = false
          warnings.push(`Reynolds is ${reynolds.toExponential(2)}, above the 5x10^5 where a flat-plate boundary layer turns turbulent. The laminar correlation will read low.`)
        }
        if (pr < 0.6) withinRange = false
        break
      case 'flat-plate-turbulent':
        nusselt = 0.037 * Math.pow(reynolds, 0.8) * Math.cbrt(pr)
        if (reynolds < 5e5 || reynolds > 1e7) {
          withinRange = false
          warnings.push(`Reynolds is ${reynolds.toExponential(2)}, outside the 5x10^5 to 10^7 this was fitted over.`)
        }
        break
      case 'pipe-laminar':
        nusselt = 3.66
        if (reynolds > 2300) {
          withinRange = false
          warnings.push(`Reynolds is ${reynolds.toFixed(0)}, above 2300, so the flow is not laminar and Nu = 3.66 does not apply.`)
        }
        break
      default: {
        const n = input.heating === false ? 0.3 : 0.4
        nusselt = 0.023 * Math.pow(reynolds, 0.8) * Math.pow(pr, n)
        if (reynolds < 10000) {
          withinRange = false
          warnings.push(`Dittus-Boelter needs Re above 10000; this is ${reynolds.toFixed(0)}.`)
        }
        if (pr < 0.6 || pr > 160) {
          withinRange = false
          warnings.push(`Dittus-Boelter needs Prandtl between 0.6 and 160; this is ${pr.toFixed(3)}.`)
        }
        break
      }
    }
  } else {
    if (input.rayleigh !== undefined) {
      rayleigh = input.rayleigh
    } else {
      if (
        input.expansionCoefficient === undefined ||
        input.temperatureDifference === undefined ||
        input.kinematicViscosity === undefined
      ) {
        return fail(
          'invalid-argument',
          `${facts.label} is a natural-convection correlation. Give a Rayleigh number, or the expansion coefficient, temperature difference and kinematic viscosity to work one out.`
        )
      }
      const g = input.gravity ?? 9.80665
      const grashof =
        (g * input.expansionCoefficient * Math.abs(input.temperatureDifference) * Math.pow(l, 3)) /
        Math.pow(input.kinematicViscosity, 2)
      rayleigh = grashof * pr
    }
    if (!finite(rayleigh) || rayleigh <= 0) return fail('invalid-argument', 'The Rayleigh number has to be greater than zero.')

    if (input.correlation === 'vertical-plate-natural') {
      nusselt = rayleigh < 1e9 ? 0.59 * Math.pow(rayleigh, 0.25) : 0.1 * Math.cbrt(rayleigh)
      if (rayleigh < 1e4 || rayleigh > 1e13) {
        withinRange = false
        warnings.push(`Rayleigh is ${rayleigh.toExponential(2)}, outside the 10^4 to 10^13 this covers.`)
      }
    } else {
      // Churchill-Chu for a horizontal cylinder.
      const inner = 1 + Math.pow(0.559 / pr, 9 / 16)
      nusselt = Math.pow(0.6 + (0.387 * Math.pow(rayleigh, 1 / 6)) / Math.pow(inner, 8 / 27), 2)
      if (rayleigh > 1e12) {
        withinRange = false
        warnings.push(`Rayleigh is ${rayleigh.toExponential(2)}, above the 10^12 Churchill-Chu covers.`)
      }
    }
  }

  const coefficient = (nusselt * k) / l
  let heatFlow: number | null = null
  if (input.area !== undefined && input.temperatureDifference !== undefined) {
    if (!finite(input.area) || input.area <= 0) return fail('invalid-argument', 'The area has to be greater than zero.')
    if (!finite(input.temperatureDifference)) return fail('not-finite', 'The temperature difference has to be finite.')
    heatFlow = coefficient * input.area * input.temperatureDifference
  }

  const notes: string[] = [
    `${facts.label}: ${facts.formula}. Valid for ${facts.validFor}`,
    'There is no equation for a convective coefficient. This is an empirical fit, and fits from different sources disagree by 20% or more inside their own range.'
  ]
  if (facts.mode === 'natural') {
    notes.push('Natural convection is driven by the temperature difference itself, so the coefficient depends on the answer. That is why it is weaker and harder to predict than forced convection.')
  }

  return {
    correlation: input.correlation,
    label: facts.label,
    formula: facts.formula,
    nusselt,
    coefficient,
    reynolds,
    rayleigh,
    prandtl: pr,
    heatFlow,
    mode: facts.mode,
    withinValidRange: withinRange,
    validFor: facts.validFor,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- radiation

export interface RadiationReport {
  /** Watts emitted by the surface. */
  emitted: number
  /** Watts absorbed from the surroundings. */
  absorbed: number
  /** Watts net. Positive means it is losing heat. */
  net: number
  /** W/(m²·K). The coefficient an equivalent convection calculation would use, for comparison. */
  equivalentCoefficient: number
  emissivity: number
  surfaceTemperature: number
  surroundingTemperature: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Net radiation between a surface and its surroundings.
 *
 * The fourth power is why radiation is negligible at room temperature and dominant in a furnace. The net exchange
 * is what matters — a surface at 300 K in a room at 293 K radiates enormously and absorbs almost as much, and the
 * difference is small. Reporting only the emitted term overstates the loss by a factor of ten or more.
 */
export function radiation(input: {
  surfaceTemperature: number
  surroundingTemperature: number
  emissivity: number
  area?: number
  viewFactor?: number
}): RadiationReport | HeatError {
  const { surfaceTemperature: ts, surroundingTemperature: tsur, emissivity } = input
  for (const [name, value] of Object.entries({ surfaceTemperature: ts, surroundingTemperature: tsur })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" is in kelvin, so it has to be greater than zero.`)
  }
  if (!finite(emissivity) || emissivity < 0 || emissivity > 1) {
    return fail('invalid-argument', 'Emissivity is a fraction between 0 and 1.')
  }
  const area = input.area ?? 1
  if (!finite(area) || area <= 0) return fail('invalid-argument', 'The area has to be greater than zero.')
  const view = input.viewFactor ?? 1
  if (!finite(view) || view < 0 || view > 1) return fail('invalid-argument', 'The view factor is a fraction between 0 and 1.')

  const emitted = emissivity * STEFAN_BOLTZMANN * area * Math.pow(ts, 4)
  const absorbed = emissivity * STEFAN_BOLTZMANN * area * view * Math.pow(tsur, 4)
  const net = emitted - absorbed
  // The equivalent coefficient: 4*eps*sigma*Tm^3 at the mean temperature, for comparing against convection.
  const mean = (ts + tsur) / 2
  const equivalent = 4 * emissivity * STEFAN_BOLTZMANN * Math.pow(mean, 3)

  const notes: string[] = [
    `The surface radiates ${emitted.toFixed(1)} W and absorbs ${absorbed.toFixed(1)} W, so the net is ${net.toFixed(1)} W. Quoting the emitted figure alone overstates the loss by a factor of ${absorbed === 0 ? 'infinity' : (emitted / Math.max(net, 1e-12)).toFixed(1)}.`,
    `As an equivalent convection coefficient this is about ${equivalent.toFixed(2)} W/(m^2*K), which is how to tell whether radiation matters beside the air movement.`,
    'The fourth power means a small temperature rise is a large radiation rise. Doubling the absolute temperature multiplies the emission by sixteen.'
  ]
  const warnings: string[] = []
  if (ts < 200 || tsur < 200) {
    warnings.push('One of these temperatures is below 200 K. Check they are in kelvin rather than Celsius — this equation has no meaning with Celsius values.')
  }

  return {
    emitted,
    absorbed,
    net,
    equivalentCoefficient: equivalent,
    emissivity,
    surfaceTemperature: ts,
    surroundingTemperature: tsur,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- fins

export type FinTip = 'adiabatic' | 'convecting' | 'infinite'

export interface FinReport {
  /** Watts. */
  heatFlow: number
  /** How well the fin does against an ideal one at base temperature throughout. */
  efficiency: number
  /** How much more the fin moves than the bare base area would. Below 2 it is not worth fitting. */
  effectiveness: number
  /** 1/m. */
  finParameter: number
  tip: FinTip
  /** Kelvin at the tip. */
  tipTemperature: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * A straight fin of constant cross-section.
 *
 * Effectiveness is the number that decides whether the fin is worth fitting, and below about 2 it is not: the fin
 * adds conduction resistance of its own, and a short fat one on a good convecting surface can move *less* heat
 * than the bare base it covered. Efficiency, which is the one usually quoted, says nothing about that.
 */
export function straightFin(input: {
  length: number
  crossSectionArea: number
  perimeter: number
  conductivity: number
  coefficient: number
  baseTemperature: number
  ambientTemperature: number
  tip?: FinTip
}): FinReport | HeatError {
  const { length, crossSectionArea: ac, perimeter: p, conductivity: k, coefficient: h } = input
  for (const [name, value] of Object.entries({ length, crossSectionArea: ac, perimeter: p, conductivity: k, coefficient: h })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const { baseTemperature: tb, ambientTemperature: ta } = input
  if (!finite(tb) || !finite(ta)) return fail('not-finite', 'The temperatures have to be finite.')
  const tip = input.tip ?? 'adiabatic'

  const m = Math.sqrt((h * p) / (k * ac))
  const theta = tb - ta
  const ml = m * length

  let heatFlow: number
  let tipTheta: number
  if (tip === 'infinite') {
    heatFlow = Math.sqrt(h * p * k * ac) * theta
    tipTheta = 0
  } else if (tip === 'adiabatic') {
    heatFlow = Math.sqrt(h * p * k * ac) * theta * Math.tanh(ml)
    tipTheta = theta / Math.cosh(ml)
  } else {
    const hmk = h / (m * k)
    const numerator = Math.sinh(ml) + hmk * Math.cosh(ml)
    const denominator = Math.cosh(ml) + hmk * Math.sinh(ml)
    heatFlow = Math.sqrt(h * p * k * ac) * theta * (numerator / denominator)
    tipTheta = theta / denominator
  }

  const idealHeat = h * p * length * theta
  const efficiency = idealHeat === 0 ? 0 : heatFlow / idealHeat
  const bareHeat = h * ac * theta
  const effectiveness = bareHeat === 0 ? Number.POSITIVE_INFINITY : heatFlow / bareHeat

  const warnings: string[] = []
  if (effectiveness < 2) {
    warnings.push(
      `The effectiveness is ${effectiveness.toFixed(2)}. Below about 2 a fin is not worth fitting: it adds its own conduction resistance, and this one barely beats the bare surface it covers.`
    )
  }
  if (effectiveness < 1) {
    warnings.push('The effectiveness is below 1, so this fin moves less heat than the bare base area would. Fitting it makes things worse.')
  }
  if (ml > 5 && tip !== 'infinite') {
    warnings.push(`mL is ${ml.toFixed(2)}. Past about 3 the extra length does almost nothing — the tip is already at ambient, and material past that point is wasted.`)
  }

  return {
    heatFlow,
    efficiency,
    effectiveness,
    finParameter: m,
    tip,
    tipTemperature: ta + tipTheta,
    notes: Object.freeze([
      'Efficiency compares the fin against an impossible one held at base temperature all the way along. Effectiveness compares it against no fin at all, and that is the one that decides whether to fit it.',
      'A good fin is long and thin in a poorly convecting fluid. In a well convecting one there is little to gain, which is why air-cooled things have fins and water-cooled things mostly do not.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- heat exchangers

export type ExchangerArrangement = 'parallel-flow' | 'counter-flow'

export const EXCHANGER_ARRANGEMENTS: readonly ExchangerArrangement[] = Object.freeze(['parallel-flow', 'counter-flow'])

export interface LmtdReport {
  arrangement: ExchangerArrangement
  /** Kelvin. */
  lmtd: number
  deltaT1: number
  deltaT2: number
  /** Watts. */
  heatDuty: number
  /** m², when a U was given. */
  requiredArea: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Log mean temperature difference, for sizing an exchanger whose four terminal temperatures are known.
 *
 * Counter-flow beats parallel-flow for the same duty, always, and by a lot when the streams approach closely. It
 * is also the only arrangement that can cool one stream below the other's outlet — parallel flow cannot, however
 * long you make it, because both streams tend toward the same temperature.
 */
export function lmtd(input: {
  arrangement?: ExchangerArrangement
  hotInlet: number
  hotOutlet: number
  coldInlet: number
  coldOutlet: number
  overallCoefficient?: number
  heatDuty?: number
}): LmtdReport | HeatError {
  const arrangement = input.arrangement ?? 'counter-flow'
  const { hotInlet: thi, hotOutlet: tho, coldInlet: tci, coldOutlet: tco } = input
  for (const [name, value] of Object.entries({ hotInlet: thi, hotOutlet: tho, coldInlet: tci, coldOutlet: tco })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
  }
  if (tho > thi) return fail('invalid-argument', 'The hot stream leaves hotter than it arrived, which means it gained heat rather than losing it.')
  if (tco < tci) return fail('invalid-argument', 'The cold stream leaves colder than it arrived, which means it lost heat rather than gaining it.')

  const warnings: string[] = []
  const d1 = arrangement === 'counter-flow' ? thi - tco : thi - tci
  const d2 = arrangement === 'counter-flow' ? tho - tci : tho - tco

  if (d1 <= 0 || d2 <= 0) {
    return fail(
      'no-solution',
      arrangement === 'parallel-flow'
        ? 'The cold outlet is above the hot outlet, which parallel flow cannot do however long the exchanger is — both streams approach the same temperature and neither crosses. Counter-flow can.'
        : 'One end has the cold stream hotter than the hot stream, which would need heat to flow uphill.'
    )
  }

  const mean = Math.abs(d1 - d2) < Math.max(d1, d2) * 1e-9 ? d1 : (d1 - d2) / Math.log(d1 / d2)

  let duty = input.heatDuty ?? null
  let area: number | null = null
  if (input.overallCoefficient !== undefined) {
    if (!finite(input.overallCoefficient) || input.overallCoefficient <= 0) {
      return fail('invalid-argument', 'The overall coefficient has to be greater than zero.')
    }
    if (duty !== null) area = duty / (input.overallCoefficient * mean)
  }
  if (duty === null) duty = 0

  const notes: string[] = [
    'The LMTD is the log mean of the two end differences, not their average. Using the arithmetic mean overstates the driving force whenever the two ends differ much.',
    arrangement === 'counter-flow'
      ? 'Counter-flow keeps the temperature difference roughly constant along the exchanger, which is why it needs less area than parallel flow for the same duty.'
      : 'Parallel flow starts with a big difference and ends with a small one. It can never bring the cold outlet above the hot outlet, whatever the area.'
  ]
  if (arrangement === 'parallel-flow' && tco > tho * 0.98) {
    warnings.push('The cold outlet is very close to the hot outlet. Parallel flow is approaching its hard limit here and the required area will grow very fast.')
  }
  if (Math.min(d1, d2) < Math.max(d1, d2) * 0.05) {
    warnings.push(`One end has a temperature difference of only ${Math.min(d1, d2).toFixed(2)} K. A close approach costs area disproportionately, because the driving force there is nearly zero.`)
  }

  return {
    arrangement,
    lmtd: mean,
    deltaT1: d1,
    deltaT2: d2,
    heatDuty: duty,
    requiredArea: area,
    notes: Object.freeze(notes),
    warnings: Object.freeze(warnings)
  }
}

export interface NtuReport {
  arrangement: ExchangerArrangement
  /** Dimensionless. UA over the smaller heat capacity rate. */
  ntu: number
  /** The ratio of the smaller heat capacity rate to the larger. */
  capacityRatio: number
  /** How much of the maximum possible heat transfer this exchanger achieves. */
  effectiveness: number
  /** Watts. */
  heatDuty: number
  maximumDuty: number
  hotOutlet: number
  coldOutlet: number
  notes: readonly string[]
}

/**
 * Effectiveness-NTU, for finding the outlets of an exchanger whose area is known.
 *
 * The complement to LMTD. LMTD needs all four terminal temperatures and gives the area; NTU needs the area and
 * the two inlets and gives the outlets. Using LMTD when two temperatures are unknown means guessing and
 * iterating, which is exactly the work NTU was invented to avoid.
 */
export function effectivenessNtu(input: {
  arrangement?: ExchangerArrangement
  overallCoefficient: number
  area: number
  hotCapacityRate: number
  coldCapacityRate: number
  hotInlet: number
  coldInlet: number
}): NtuReport | HeatError {
  const arrangement = input.arrangement ?? 'counter-flow'
  const { overallCoefficient: u, area, hotCapacityRate: ch, coldCapacityRate: cc, hotInlet: thi, coldInlet: tci } = input
  for (const [name, value] of Object.entries({ overallCoefficient: u, area, hotCapacityRate: ch, coldCapacityRate: cc })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (!finite(thi) || !finite(tci)) return fail('not-finite', 'The inlet temperatures have to be finite.')
  if (thi <= tci) return fail('invalid-argument', 'The hot inlet has to be above the cold inlet, or no heat will flow the way you expect.')

  const cMin = Math.min(ch, cc)
  const cMax = Math.max(ch, cc)
  const cr = cMin / cMax
  const ntu = (u * area) / cMin

  let effectiveness: number
  if (arrangement === 'counter-flow') {
    effectiveness =
      Math.abs(cr - 1) < 1e-9
        ? ntu / (1 + ntu)
        : (1 - Math.exp(-ntu * (1 - cr))) / (1 - cr * Math.exp(-ntu * (1 - cr)))
  } else {
    effectiveness = (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr)
  }

  const maximum = cMin * (thi - tci)
  const duty = effectiveness * maximum

  const notes: string[] = [
    `NTU is ${ntu.toFixed(3)} and the effectiveness is ${(effectiveness * 100).toFixed(1)}%. Effectiveness is how much of the thermodynamically possible transfer this exchanger actually achieves.`,
    'The maximum possible duty uses the *smaller* heat capacity rate, because that stream reaches the other inlet temperature first and then nothing more can happen.',
    arrangement === 'counter-flow'
      ? 'Counter-flow effectiveness keeps climbing with NTU and approaches 1. Doubling the area past NTU of about 3 buys very little.'
      : `Parallel flow saturates at ${(1 / (1 + cr)).toFixed(3)} however large the exchanger is. Counter-flow has no such ceiling, which is the reason to prefer it.`
  ]

  return {
    arrangement,
    ntu,
    capacityRatio: cr,
    effectiveness,
    heatDuty: duty,
    maximumDuty: maximum,
    hotOutlet: thi - duty / ch,
    coldOutlet: tci + duty / cc,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- transient

export interface LumpedReport {
  /** Dimensionless. Internal conduction resistance against surface convection resistance. */
  biot: number
  /** Whether lumping is legitimate. Below 0.1 the body is nearly uniform inside. */
  lumpedValid: boolean
  /** Seconds. */
  timeConstant: number
  samples: readonly { time: number; temperature: number }[]
  /** Seconds to reach the requested temperature, when one was given. */
  timeToReach: number | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Transient cooling of a body treated as one lump, with the Biot check that says whether that is allowed.
 *
 * The lumped model assumes the whole body is at one temperature, which is only true when heat moves through the
 * inside far faster than it leaves the surface. Biot below about 0.1 is the usual threshold. Above it the middle
 * lags the surface badly and the lumped answer is wrong in the direction that matters — so the check runs and
 * warns rather than being left to the user to remember.
 */
export function lumpedCapacitance(input: {
  volume: number
  surfaceArea: number
  density: number
  specificHeat: number
  coefficient: number
  conductivity: number
  initialTemperature: number
  ambientTemperature: number
  duration?: number
  samples?: number
  targetTemperature?: number
}): LumpedReport | HeatError {
  const { volume, surfaceArea, density, specificHeat, coefficient, conductivity } = input
  for (const [name, value] of Object.entries({ volume, surfaceArea, density, specificHeat, coefficient, conductivity })) {
    if (!finite(value)) return fail('not-finite', `"${name}" has to be a finite number.`)
    if (value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  const { initialTemperature: t0, ambientTemperature: ta } = input
  if (!finite(t0) || !finite(ta)) return fail('not-finite', 'The temperatures have to be finite.')

  const characteristic = volume / surfaceArea
  const biot = (coefficient * characteristic) / conductivity
  const tau = (density * volume * specificHeat) / (coefficient * surfaceArea)

  const duration = input.duration ?? tau * 5
  if (!finite(duration) || duration <= 0) return fail('invalid-argument', 'The duration has to be a positive time.')
  const count = Math.round(input.samples ?? 200)
  if (!Number.isInteger(count) || count < 2 || count > HEAT_LIMITS.samples) {
    return fail('invalid-argument', `The sample count has to be between 2 and ${HEAT_LIMITS.samples}.`)
  }

  const samples: { time: number; temperature: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const t = (duration * i) / (count - 1)
    samples.push({ time: t, temperature: ta + (t0 - ta) * Math.exp(-t / tau) })
  }

  let timeToReach: number | null = null
  if (input.targetTemperature !== undefined) {
    if (!finite(input.targetTemperature)) return fail('not-finite', 'The target temperature has to be finite.')
    const ratio = (input.targetTemperature - ta) / (t0 - ta)
    if (ratio <= 0) {
      return fail(
        'no-solution',
        `The body approaches ${ta} K and never passes it, so it never reaches ${input.targetTemperature} K. Exponential decay gets arbitrarily close and never arrives.`
      )
    }
    if (ratio >= 1) {
      return fail('invalid-argument', 'The target is at or beyond where the body started, so it is already past it.')
    }
    timeToReach = -tau * Math.log(ratio)
  }

  const warnings: string[] = []
  if (biot >= 0.1) {
    warnings.push(
      `The Biot number is ${biot.toFixed(3)}, at or above the 0.1 where lumping stops being legitimate. The inside of this body lags its surface, so the single-temperature model understates how long the centre takes — which is usually exactly what the question was about.`
    )
  }

  return {
    biot,
    lumpedValid: biot < 0.1,
    timeConstant: tau,
    samples: Object.freeze(samples),
    timeToReach,
    notes: Object.freeze([
      `The time constant is ${tau.toFixed(3)} s. After one of them the gap to ambient has closed by 63%, and after five by more than 99%.`,
      'Biot compares the resistance to heat moving through the body against the resistance to it leaving the surface. Small Biot means the inside keeps up, which is what makes one temperature enough.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const HEAT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Steady state unless a calculation says otherwise. Start-up and shut-down are different problems.',
  'Properties are constant with temperature. Conductivity and viscosity both change with it, and over a large range that matters.',
  'Convection coefficients come from empirical correlations, not from theory. Each one names its range and says when it is being extrapolated.',
  'Radiation assumes grey diffuse surfaces. Real surfaces vary with wavelength and angle, and polished metals vary a lot.',
  'Heat-exchanger results assume no fouling and no losses to the surroundings. Both make a real exchanger perform worse than these numbers.',
  'The lumped transient model needs a Biot number below about 0.1, and says so when it is not.'
])
