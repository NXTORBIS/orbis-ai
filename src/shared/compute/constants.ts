/**
 * Physical, conventional and mathematical constants, each carrying where its value came from.
 *
 * The shared constant registry for Orbis Pages. Every entry knows its unit, its uncertainty, and — the part that is
 * usually left out — whether it is a measurement at all.
 *
 * ## The distinction that runs through this file
 *
 * Since the SI was redefined in 2019, several constants are **exact by definition**. The speed of light is not
 * 299792458 m/s to within some error bar; it is 299792458 m/s because the metre is defined from it. The same is true
 * of the Planck constant, the elementary charge, the Boltzmann constant and the Avogadro constant. Their uncertainty
 * is not small — it is zero, and it will never be improved upon, because there is nothing left to measure.
 *
 * Other constants remain measurements. The gravitational constant is known to about two parts in a hundred thousand,
 * which is worse than almost anything else here and is a real limit on what a calculation using it can claim. The
 * electron mass is known to three parts in ten billion.
 *
 * ```
 * defining       vs   measured        -- zero uncertainty by definition, or an error bar from an experiment
 * derived-exact  vs   measured        -- a product of defining constants is exact too
 * conventional   vs   measured        -- standard gravity is an agreed number, not the gravity anywhere
 * mathematical   vs   physical        -- π has no unit and no experiment behind it
 * stored value   vs   published value -- a double holds about 16 digits, and some of these are published with more
 * ```
 *
 * Values for the measured constants are CODATA 2018, which is stated on every entry rather than assumed. A Page that
 * shows a constant should show its source with it.
 *
 * Pure. No network, no clock, no storage.
 */

import { MAXIMUM_FIGURES } from './precision.ts'
import { isQuantityError, quantity, type Quantity } from './units.ts'

// ---------------------------------------------------------------- failure

export interface ConstantError {
  error: 'unknown-constant' | 'invalid-argument' | 'not-finite' | 'no-unit'
  message: string
}

export const isConstantError = (value: unknown): value is ConstantError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ConstantError['error'], message: string): ConstantError => ({ error, message })

// ---------------------------------------------------------------- what kind of constant it is

export type ConstantKind = 'defining' | 'derived-exact' | 'measured' | 'conventional' | 'mathematical'

export const CONSTANT_KINDS: readonly ConstantKind[] = Object.freeze([
  'defining',
  'derived-exact',
  'measured',
  'conventional',
  'mathematical'
])

export const KIND_FACTS: Readonly<Record<ConstantKind, { label: string; describe: string; hasUncertainty: boolean }>> =
  Object.freeze({
    defining: {
      label: 'Exact by definition',
      describe: 'One of the seven constants the SI fixes to define its units. The value has no uncertainty and never will — it is not a measurement of anything, it is where a unit comes from.',
      hasUncertainty: false
    },
    'derived-exact': {
      label: 'Exactly derived',
      describe: 'A combination of constants that are themselves exact by definition, so this one is exact too. Its digits run on forever or terminate; either way there is no error bar.',
      hasUncertainty: false
    },
    measured: {
      label: 'Measured',
      describe: 'A quantity established by experiment. It has an uncertainty, it has improved over time, and a calculation using it cannot be more certain than it is.',
      hasUncertainty: true
    },
    conventional: {
      label: 'Agreed value',
      describe: 'A number fixed by agreement for practical use. Standard gravity is not the gravity at any particular place; it is the value everyone agreed to calculate with.',
      hasUncertainty: false
    },
    mathematical: {
      label: 'Mathematical',
      describe: 'A number that follows from definitions rather than from the world. It has no unit and no experiment behind it, and it is exact to as many digits as anyone cares to compute.',
      hasUncertainty: false
    }
  })

export type Category = 'universal' | 'electromagnetic' | 'atomic' | 'thermodynamic' | 'mechanical' | 'mathematical'

export interface Constant {
  id: string
  /** The usual symbol, in plain text. */
  symbol: string
  name: string
  kind: ConstantKind
  category: Category
  value: number
  /** Empty for a dimensionless constant. */
  unit: string
  /**
   * The standard uncertainty, in the same unit. Zero for everything that is not a measurement — and that zero is a
   * statement, not a missing field.
   */
  uncertainty: number
  /** Uncertainty as a fraction of the value. Zero for the exact kinds. */
  relativeUncertainty: number
  /** Where the value comes from. */
  source: string
  /**
   * The value as published, in full, including digits a double cannot hold.
   *
   * Kept as text because that is the only way to keep them. The Faraday constant is exactly 96485.3321233100184 C/mol
   * and a double stores 96485.33212331002 — the difference is real, it is in the seventeenth digit, and a Page that
   * needs it needs to know the number it was given is not the number that was published.
   */
  publishedText: string
  /** What the constant is, in a sentence. */
  describe: string
  /** For the derived ones, how it is built. */
  definedBy: string | null
}

const constant = (one: Constant): Constant => Object.freeze(one)

/**
 * The registry.
 *
 * Measured values are CODATA 2018. The defining constants are the exact values fixed by the SI in its 2019 revision;
 * they are not measurements and are not attributed to a CODATA adjustment.
 */
export const CONSTANTS: readonly Constant[] = Object.freeze([
  // ------------------------------------------------ the seven that define the SI
  constant({
    id: 'caesium-frequency',
    symbol: 'ΔνCs',
    name: 'Caesium hyperfine transition frequency',
    kind: 'defining',
    category: 'atomic',
    value: 9192631770,
    unit: 'Hz',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (2019)',
    publishedText: '9192631770',
    describe: 'The frequency of the caesium-133 hyperfine transition. The second is defined as 9192631770 periods of it, so this number defines time rather than being measured in it.',
    definedBy: null
  }),
  constant({
    id: 'speed-of-light',
    symbol: 'c',
    name: 'Speed of light in vacuum',
    kind: 'defining',
    category: 'universal',
    value: 299792458,
    unit: 'm/s',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (1983, retained 2019)',
    publishedText: '299792458',
    describe: 'The metre is defined as the distance light travels in 1/299792458 of a second. Measuring the speed of light more precisely now measures the apparatus, not the speed.',
    definedBy: null
  }),
  constant({
    id: 'planck',
    symbol: 'h',
    name: 'Planck constant',
    kind: 'defining',
    category: 'universal',
    value: 6.62607015e-34,
    unit: 'J*s',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (2019)',
    publishedText: '6.62607015e-34',
    describe: 'Relates a photon energy to its frequency. Since 2019 it defines the kilogram, so its value is fixed and the mass of the international prototype is now the thing with an uncertainty.',
    definedBy: null
  }),
  constant({
    id: 'elementary-charge',
    symbol: 'e',
    name: 'Elementary charge',
    kind: 'defining',
    category: 'electromagnetic',
    value: 1.602176634e-19,
    unit: 'C',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (2019)',
    publishedText: '1.602176634e-19',
    describe: 'The charge of a proton, and the magnitude of an electron charge. It defines the ampere.',
    definedBy: null
  }),
  constant({
    id: 'boltzmann',
    symbol: 'k',
    name: 'Boltzmann constant',
    kind: 'defining',
    category: 'thermodynamic',
    value: 1.380649e-23,
    unit: 'J/K',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (2019)',
    publishedText: '1.380649e-23',
    describe: 'Relates temperature to energy per degree of freedom. It defines the kelvin.',
    definedBy: null
  }),
  constant({
    id: 'avogadro',
    symbol: 'N_A',
    name: 'Avogadro constant',
    kind: 'defining',
    category: 'atomic',
    value: 6.02214076e23,
    unit: '1/mol',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (2019)',
    publishedText: '6.02214076e23',
    describe: 'The number of entities in a mole. Since 2019 the mole is defined as exactly this many, so the number is fixed and the mass of twelve grams of carbon-12 is what now carries an uncertainty.',
    definedBy: null
  }),
  constant({
    id: 'luminous-efficacy',
    symbol: 'K_cd',
    name: 'Luminous efficacy of 540 THz radiation',
    kind: 'defining',
    category: 'universal',
    value: 683,
    unit: 'lm/W',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'SI defining constant (2019)',
    publishedText: '683',
    describe: 'Fixes the candela by tying luminous flux to radiant power at one particular green frequency.',
    definedBy: null
  }),

  // ------------------------------------------------ exact because they are built from exact ones
  constant({
    id: 'reduced-planck',
    symbol: 'ħ',
    name: 'Reduced Planck constant',
    kind: 'derived-exact',
    category: 'universal',
    value: 6.62607015e-34 / (2 * Math.PI),
    unit: 'J*s',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Exact: h / 2π',
    publishedText: '1.054571817...e-34',
    describe: 'The Planck constant divided by 2π, which is the form that appears whenever an angle is measured in radians.',
    definedBy: 'h / (2π)'
  }),
  constant({
    id: 'gas-constant',
    symbol: 'R',
    name: 'Molar gas constant',
    kind: 'derived-exact',
    category: 'thermodynamic',
    value: 8.31446261815324,
    unit: 'J/(mol*K)',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Exact: N_A × k',
    publishedText: '8.31446261815324',
    describe: 'The Boltzmann constant per mole. Exact since 2019, because both of its factors are.',
    definedBy: 'N_A × k'
  }),
  constant({
    id: 'faraday',
    symbol: 'F',
    name: 'Faraday constant',
    kind: 'derived-exact',
    category: 'electromagnetic',
    value: 96485.33212331002,
    unit: 'C/mol',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Exact: N_A × e',
    publishedText: '96485.3321233100184',
    describe: 'The charge of a mole of electrons. Exact, and published with more digits than a double can hold.',
    definedBy: 'N_A × e'
  }),
  constant({
    id: 'stefan-boltzmann',
    symbol: 'σ',
    name: 'Stefan–Boltzmann constant',
    kind: 'derived-exact',
    category: 'thermodynamic',
    value: 5.670374419e-8,
    unit: 'W/(m^2*K^4)',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Exact: 2π⁵k⁴ / (15h³c²)',
    publishedText: '5.670374419...e-8',
    describe: 'The total power radiated per unit area by a black body, per fourth power of its temperature.',
    definedBy: '2π⁵k⁴ / (15h³c²)'
  }),

  // ------------------------------------------------ still measured
  constant({
    id: 'gravitational',
    symbol: 'G',
    name: 'Newtonian constant of gravitation',
    kind: 'measured',
    category: 'universal',
    value: 6.6743e-11,
    unit: 'm^3/(kg*s^2)',
    uncertainty: 1.5e-15,
    relativeUncertainty: 2.2e-5,
    source: 'CODATA 2018',
    publishedText: '6.67430(15)e-11',
    describe: 'The constant in Newton law of gravitation. By far the least well known constant here — gravity is too weak to measure precisely in a laboratory, and independent experiments have disagreed with each other by more than their stated uncertainties.',
    definedBy: null
  }),
  constant({
    id: 'electron-mass',
    symbol: 'm_e',
    name: 'Electron mass',
    kind: 'measured',
    category: 'atomic',
    value: 9.1093837015e-31,
    unit: 'kg',
    uncertainty: 2.8e-40,
    relativeUncertainty: 3.0e-10,
    source: 'CODATA 2018',
    publishedText: '9.1093837015(28)e-31',
    describe: 'The rest mass of an electron. With the speed of light it sets the electron rest energy of about 511 keV, which is the scale every atomic binding energy is compared against.',
    definedBy: null
  }),
  constant({
    id: 'proton-mass',
    symbol: 'm_p',
    name: 'Proton mass',
    kind: 'measured',
    category: 'atomic',
    value: 1.67262192369e-27,
    unit: 'kg',
    uncertainty: 5.1e-37,
    relativeUncertainty: 3.1e-10,
    source: 'CODATA 2018',
    publishedText: '1.67262192369(51)e-27',
    describe: 'The rest mass of a proton, about 1836 times the electron mass.',
    definedBy: null
  }),
  constant({
    id: 'neutron-mass',
    symbol: 'm_n',
    name: 'Neutron mass',
    kind: 'measured',
    category: 'atomic',
    value: 1.67492749804e-27,
    unit: 'kg',
    uncertainty: 9.5e-37,
    relativeUncertainty: 5.7e-10,
    source: 'CODATA 2018',
    publishedText: '1.67492749804(95)e-27',
    describe: 'The rest mass of a neutron, slightly greater than the proton mass — which is why a free neutron decays and a free proton does not.',
    definedBy: null
  }),
  constant({
    id: 'atomic-mass',
    symbol: 'm_u',
    name: 'Atomic mass constant',
    kind: 'measured',
    category: 'atomic',
    value: 1.6605390666e-27,
    unit: 'kg',
    uncertainty: 5.0e-37,
    relativeUncertainty: 3.0e-10,
    source: 'CODATA 2018',
    publishedText: '1.66053906660(50)e-27',
    describe: 'One twelfth of the mass of a carbon-12 atom. Measured since 2019, because fixing the Avogadro constant moved the uncertainty here.',
    definedBy: null
  }),
  constant({
    id: 'fine-structure',
    symbol: 'α',
    name: 'Fine-structure constant',
    kind: 'measured',
    category: 'electromagnetic',
    value: 7.2973525693e-3,
    unit: '',
    uncertainty: 1.1e-12,
    relativeUncertainty: 1.5e-10,
    source: 'CODATA 2018',
    publishedText: '7.2973525693(11)e-3',
    describe: 'The strength of the electromagnetic interaction, and dimensionless — the same number in every system of units. About 1/137.',
    definedBy: null
  }),
  constant({
    id: 'rydberg',
    symbol: 'R∞',
    name: 'Rydberg constant',
    kind: 'measured',
    category: 'atomic',
    value: 10973731.56816,
    unit: '1/m',
    uncertainty: 2.1e-5,
    relativeUncertainty: 1.9e-12,
    source: 'CODATA 2018',
    publishedText: '10973731.568160(21)',
    describe: 'Sets the wavelengths of the hydrogen spectrum. The most precisely known measured constant here.',
    definedBy: null
  }),
  constant({
    id: 'bohr-radius',
    symbol: 'a₀',
    name: 'Bohr radius',
    kind: 'measured',
    category: 'atomic',
    value: 5.29177210903e-11,
    unit: 'm',
    uncertainty: 8.0e-21,
    relativeUncertainty: 1.5e-10,
    source: 'CODATA 2018',
    publishedText: '5.29177210903(80)e-11',
    describe: 'The most probable distance of the electron from the nucleus in a hydrogen atom in its ground state.',
    definedBy: null
  }),
  constant({
    id: 'bohr-magneton',
    symbol: 'μ_B',
    name: 'Bohr magneton',
    kind: 'measured',
    category: 'electromagnetic',
    value: 9.2740100783e-24,
    unit: 'J/T',
    uncertainty: 2.8e-33,
    relativeUncertainty: 3.0e-10,
    source: 'CODATA 2018',
    publishedText: '9.2740100783(28)e-24',
    describe: 'The natural unit of magnetic moment for an electron.',
    definedBy: null
  }),
  constant({
    id: 'vacuum-permittivity',
    symbol: 'ε₀',
    name: 'Vacuum electric permittivity',
    kind: 'measured',
    category: 'electromagnetic',
    value: 8.8541878128e-12,
    unit: 'F/m',
    uncertainty: 1.3e-21,
    relativeUncertainty: 1.5e-10,
    source: 'CODATA 2018',
    publishedText: '8.8541878128(13)e-12',
    describe: 'Sets the strength of the electric force in vacuum. Exact before 2019; now it inherits the uncertainty of the fine-structure constant.',
    definedBy: null
  }),
  constant({
    id: 'vacuum-permeability',
    symbol: 'μ₀',
    name: 'Vacuum magnetic permeability',
    kind: 'measured',
    category: 'electromagnetic',
    value: 1.25663706212e-6,
    unit: 'N/A^2',
    uncertainty: 1.9e-16,
    relativeUncertainty: 1.5e-10,
    source: 'CODATA 2018',
    publishedText: '1.25663706212(19)e-6',
    describe: 'Sets the strength of the magnetic force in vacuum. It was exactly 4π×10⁻⁷ by definition until 2019, when redefining the ampere turned it back into a measured quantity.',
    definedBy: null
  }),

  // ------------------------------------------------ agreed rather than measured
  constant({
    id: 'standard-gravity',
    symbol: 'g₀',
    name: 'Standard acceleration of gravity',
    kind: 'conventional',
    category: 'mechanical',
    value: 9.80665,
    unit: 'm/s^2',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'CGPM, 3rd meeting (1901)',
    publishedText: '9.80665',
    describe: 'An agreed value, not a measurement. Actual gravity varies from about 9.76 to 9.83 m/s² over the surface of the Earth, so a calculation that needs the local value cannot use this one.',
    definedBy: null
  }),
  constant({
    id: 'standard-atmosphere',
    symbol: 'atm',
    name: 'Standard atmosphere',
    kind: 'conventional',
    category: 'mechanical',
    value: 101325,
    unit: 'Pa',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'CGPM, 10th meeting (1954)',
    publishedText: '101325',
    describe: 'A defined reference pressure. Not the pressure anywhere in particular, and not sea-level pressure today.',
    definedBy: null
  }),
  constant({
    id: 'absolute-zero-celsius',
    symbol: '0 K',
    name: 'Absolute zero in degrees Celsius',
    kind: 'conventional',
    category: 'thermodynamic',
    value: -273.15,
    unit: 'degC',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Definition of the Celsius scale',
    publishedText: '-273.15',
    describe: 'The offset between the Celsius and kelvin scales, exact by the definition of the degree Celsius.',
    definedBy: null
  }),

  // ------------------------------------------------ mathematical
  constant({
    id: 'pi',
    symbol: 'π',
    name: 'Pi',
    kind: 'mathematical',
    category: 'mathematical',
    value: Math.PI,
    unit: '',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Mathematics',
    publishedText: '3.14159265358979323846...',
    describe: 'The ratio of a circle circumference to its diameter. Irrational, so the stored value is the nearest double and not the number.',
    definedBy: null
  }),
  constant({
    id: 'e',
    symbol: 'e',
    name: 'Euler number',
    kind: 'mathematical',
    category: 'mathematical',
    value: Math.E,
    unit: '',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Mathematics',
    publishedText: '2.71828182845904523536...',
    describe: 'The base of the natural logarithm, and the only base at which the exponential is its own derivative.',
    definedBy: null
  }),
  constant({
    id: 'golden-ratio',
    symbol: 'φ',
    name: 'Golden ratio',
    kind: 'mathematical',
    category: 'mathematical',
    value: (1 + Math.sqrt(5)) / 2,
    unit: '',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Mathematics',
    publishedText: '1.61803398874989484820...',
    describe: 'The positive solution of x² = x + 1, and the limit of the ratio of consecutive Fibonacci numbers.',
    definedBy: '(1 + √5) / 2'
  }),
  constant({
    id: 'euler-mascheroni',
    symbol: 'γ',
    name: 'Euler–Mascheroni constant',
    kind: 'mathematical',
    category: 'mathematical',
    value: 0.5772156649015329,
    unit: '',
    uncertainty: 0,
    relativeUncertainty: 0,
    source: 'Mathematics',
    publishedText: '0.57721566490153286060...',
    describe: 'The limiting difference between the harmonic series and the natural logarithm. Whether it is irrational is still an open question.',
    definedBy: null
  })
])

/** Lookup by id, built once. A Map rather than an object, so a Page cannot reach a prototype property through it. */
const BY_ID: ReadonlyMap<string, Constant> = new Map(CONSTANTS.map((one) => [one.id, one]))

export function constantById(id: string): Constant | ConstantError {
  const found = BY_ID.get(id)
  if (found === undefined) {
    return fail('unknown-constant', `There is no constant with the id "${id}". ${CONSTANTS.length} constants are registered; search by name or symbol to find one.`)
  }
  return found
}

/** Finds constants whose id, symbol, name or description mentions the text. Case-insensitive. */
export function searchConstants(text: string): readonly Constant[] {
  if (typeof text !== 'string') return []
  const needle = text.trim().toLowerCase()
  if (needle === '') return CONSTANTS
  const scored: { one: Constant; score: number }[] = []
  for (const one of CONSTANTS) {
    let score = 0
    if (one.id === needle || one.symbol.toLowerCase() === needle) score = 100
    else if (one.name.toLowerCase() === needle) score = 90
    else if (one.id.includes(needle) || one.symbol.toLowerCase().includes(needle)) score = 50
    else if (one.name.toLowerCase().includes(needle)) score = 40
    else if (one.describe.toLowerCase().includes(needle)) score = 10
    if (score > 0) scored.push({ one, score })
  }
  scored.sort((a, b) => b.score - a.score || a.one.name.localeCompare(b.one.name))
  return scored.map((entry) => entry.one)
}

export function constantsOfKind(kind: ConstantKind): readonly Constant[] {
  return CONSTANTS.filter((one) => one.kind === kind)
}

export function constantsInCategory(category: Category): readonly Constant[] {
  return CONSTANTS.filter((one) => one.category === category)
}

/** Turns a constant into a quantity the unit engine understands. Dimensionless constants have no quantity. */
export function asQuantity(one: Constant): Quantity | ConstantError {
  if (one.unit === '') {
    return fail('no-unit', `${one.name} is dimensionless, so it has no quantity — its value is the same number in every system of units.`)
  }
  const built = quantity(one.value, one.unit)
  if (isQuantityError(built)) return fail('invalid-argument', built.message)
  return built
}

// ---------------------------------------------------------------- using one honestly

export interface ConstantReport {
  constant: Constant
  /** True when the double this engine hands out is not the published value. */
  truncated: boolean
  /** How many significant figures the published form states. */
  publishedFigures: number
  /** What a result using this constant cannot be more certain than. Null for the exact kinds. */
  limitsResultsTo: number | null
  caveats: readonly string[]
}

const countPublishedFigures = (text: string): number => {
  const digits = text.replace(/[^0-9]/g, '').replace(/^0+/, '')
  return digits.length
}

/**
 * What using a constant commits a calculation to.
 *
 * The number worth having is `limitsResultsTo`: a calculation involving the gravitational constant cannot claim
 * better than about two parts in a hundred thousand however precisely everything else in it is known, and a Page
 * reporting six figures of such a result is reporting four figures of arithmetic noise.
 */
export function reportOn(id: string): ConstantReport | ConstantError {
  const one = constantById(id)
  if (isConstantError(one)) return one
  const caveats: string[] = [KIND_FACTS[one.kind].describe]

  const publishedFigures = countPublishedFigures(one.publishedText.replace(/\(\d+\)/, '').split(/[eE]/)[0] ?? '')
  const truncated = publishedFigures > MAXIMUM_FIGURES || one.publishedText.includes('...')
  if (truncated) {
    caveats.push(
      `The published value is ${one.publishedText}${one.publishedText.includes('...') ? '' : ''} and the number handed out here is ${one.value}. A double holds about ${MAXIMUM_FIGURES} digits; the rest are gone. For anything needing more than that, the published text is on this record.`
    )
  }

  let limitsResultsTo: number | null = null
  if (KIND_FACTS[one.kind].hasUncertainty && one.relativeUncertainty > 0) {
    limitsResultsTo = one.relativeUncertainty
    const figures = Math.max(1, Math.floor(-Math.log10(one.relativeUncertainty)))
    caveats.push(
      `Known to ${one.relativeUncertainty.toExponential(1)} of its own value. A result that depends on it cannot be quoted to more than about ${figures} significant figures, whatever else in the calculation is known better.`
    )
  } else {
    caveats.push('No uncertainty enters a calculation from this constant. Any uncertainty in a result using it came from somewhere else.')
  }

  if (one.kind === 'conventional') {
    caveats.push('This is an agreed number rather than a measurement of anything, so it does not describe any particular place, time or sample. Using it where the real local value matters is an error no uncertainty figure will catch.')
  }
  if (one.kind === 'mathematical') {
    caveats.push('Irrational numbers have no exact double. The value here is the nearest one, which differs from the true value in roughly the seventeenth digit.')
  }

  return { constant: one, truncated, publishedFigures, limitsResultsTo, caveats }
}

export interface Agreement {
  /** Whether the measurement and the constant overlap once both uncertainties are allowed for. */
  agree: boolean
  /** How far apart they are, counted in combined standard uncertainties. */
  sigma: number | null
  difference: number
  relativeDifference: number
  why: string
}

/**
 * Compares a measured value against a registered constant.
 *
 * Reported in combined standard uncertainties, which is the honest currency: a value two of them away from the
 * accepted one is unremarkable, and one five away needs an explanation. Note what this does *not* say — agreement is
 * not confirmation, and disagreement is not disproof. Both are statements about consistency.
 */
export function compareToConstant(id: string, value: number, uncertainty = 0): Agreement | ConstantError {
  const one = constantById(id)
  if (isConstantError(one)) return one
  if (!Number.isFinite(value)) return fail('not-finite', 'The measured value must be a finite number.')
  if (!Number.isFinite(uncertainty) || uncertainty < 0) return fail('invalid-argument', 'The uncertainty must be a non-negative finite number.')
  const difference = value - one.value
  const combined = Math.hypot(uncertainty, one.uncertainty)
  const relativeDifference = one.value === 0 ? Number.POSITIVE_INFINITY : difference / one.value
  if (combined === 0) {
    const agree = difference === 0
    return {
      agree,
      sigma: null,
      difference,
      relativeDifference,
      why: agree
        ? `The value matches ${one.symbol} exactly. Neither side states an uncertainty, so there is nothing to compare beyond equality.`
        : `The value differs from ${one.symbol} by ${difference.toExponential(3)} and neither side states an uncertainty, so there is no scale to judge that difference against. ${one.kind === 'defining' ? `${one.symbol} is exact by definition, so any difference is in the measurement.` : 'Give an uncertainty for the measurement to get a meaningful comparison.'}`
    }
  }
  const sigma = Math.abs(difference) / combined
  const agree = sigma <= 2
  return {
    agree,
    sigma,
    difference,
    relativeDifference,
    why: agree
      ? `${sigma.toFixed(2)} combined standard uncertainties from the accepted value of ${one.symbol}. That is consistent with it — which means the measurement does not contradict the accepted value, not that it confirms it.`
      : `${sigma.toFixed(2)} combined standard uncertainties from the accepted value of ${one.symbol}. That is further than scatter usually reaches, so either something in the measurement is unaccounted for or its uncertainty is understated. It is not, on its own, evidence against the accepted value.`
  }
}
