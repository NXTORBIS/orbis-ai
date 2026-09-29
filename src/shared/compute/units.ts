/**
 * Units, dimensions and physical quantities.
 *
 * The shared engine every scientific Orbis Page measures with. A number on its own is not a measurement: `10` could be
 * ten metres, ten seconds or ten kilograms, and the difference is the whole of whether an answer is right. So a quantity
 * here carries what it is as well as how much, and arithmetic that would mix incompatible things is refused rather than
 * quietly producing a number.
 *
 * This is not `convert()` in `calculate.ts`. That one turns a typed sentence into a converted string for the search
 * page, using a flat table of factors -- exactly the right size for what it does. This one knows *dimensions*: that
 * distance over time is a velocity, that a force is a mass times an acceleration, and that adding a length to a duration
 * is not a small mistake to be rounded past but a question with no answer. Pages that compute need the second kind.
 *
 * Pure. No network, no clock, no storage.
 *
 * ## Angle is tracked as a dimension, which SI does not do
 *
 * SI makes the radian dimensionless, so `rad/s` and `1/s` are formally the same. That is correct physics and a poor
 * guard: it lets an angular velocity be added to a frequency without complaint. Orbis tracks angle as its own base
 * dimension `A`, so degrees and radians convert to each other and to nothing else. The cost is that a quantity in
 * `rad/s` will not compare equal to one in `Hz`; that is a trade made deliberately, and it is written down here rather
 * than left for somebody to discover.
 */

/** The base dimensions. Angle is Orbis's addition -- see the note above. */
export type BaseDimension = 'L' | 'M' | 'T' | 'K' | 'I' | 'N' | 'J' | 'A'

export const BASE_DIMENSIONS: BaseDimension[] = ['L', 'M', 'T', 'K', 'I', 'N', 'J', 'A']

export const BASE_DIMENSION_NAMES: Record<BaseDimension, string> = {
  L: 'length',
  M: 'mass',
  T: 'time',
  K: 'temperature',
  I: 'electric current',
  N: 'amount of substance',
  J: 'luminous intensity',
  A: 'angle'
}

/**
 * A dimension, as exponents over the base ones.
 *
 * Absent means zero. `{}` is dimensionless -- a ratio, a count, a plain number -- and is a real dimension rather than a
 * missing one, which is why it is an object and not `null`.
 */
export type Dimension = Partial<Record<BaseDimension, number>>

export const DIMENSIONLESS: Dimension = Object.freeze({})

/** Two dimensions multiplied: exponents add. */
export function multiplyDimensions(a: Dimension, b: Dimension): Dimension {
  const out: Dimension = {}
  for (const base of BASE_DIMENSIONS) {
    const sum = (a[base] ?? 0) + (b[base] ?? 0)
    // Dropped rather than stored as zero, so that two spellings of the same dimension compare equal.
    if (sum !== 0) out[base] = sum
  }
  return out
}

/** A dimension raised to a power: exponents multiply. Fractional powers are allowed -- the square root of an area is a length. */
export function powerDimension(a: Dimension, exponent: number): Dimension {
  const out: Dimension = {}
  for (const base of BASE_DIMENSIONS) {
    const value = (a[base] ?? 0) * exponent
    if (value !== 0) out[base] = value
  }
  return out
}

export const invertDimension = (a: Dimension): Dimension => powerDimension(a, -1)

/** Whether two dimensions are the same thing. The comparison every refusal in this file rests on. */
export function sameDimension(a: Dimension, b: Dimension): boolean {
  for (const base of BASE_DIMENSIONS) {
    const left = a[base] ?? 0
    const right = b[base] ?? 0
    // Exponents can be fractional after a root, so an exact comparison would fail on 0.5 against 0.49999999999999994.
    if (Math.abs(left - right) > 1e-9) return false
  }
  return true
}

export const isDimensionless = (a: Dimension): boolean => sameDimension(a, DIMENSIONLESS)

const trimNumber = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6))))

/** A dimension written out, for an error somebody has to understand. */
export function describeDimension(a: Dimension): string {
  const parts: string[] = []
  for (const base of BASE_DIMENSIONS) {
    const exponent = a[base]
    if (exponent === undefined || exponent === 0) continue
    parts.push(exponent === 1 ? base : `${base}^${trimNumber(exponent)}`)
  }
  return parts.length === 0 ? 'dimensionless' : parts.join('·')
}

// ---------------------------------------------------------------- the dimensions worth naming

const dim = (parts: Dimension): Dimension => Object.freeze({ ...parts }) as Dimension

/**
 * Dimensions with names people use.
 *
 * Only for reading back: nothing here changes how arithmetic works. It exists so that a dimension mismatch can say
 * "length cannot be added to time" instead of printing exponents at somebody.
 */
export const NAMED_DIMENSIONS: Record<string, Dimension> = {
  length: dim({ L: 1 }),
  mass: dim({ M: 1 }),
  time: dim({ T: 1 }),
  temperature: dim({ K: 1 }),
  current: dim({ I: 1 }),
  'amount of substance': dim({ N: 1 }),
  'luminous intensity': dim({ J: 1 }),
  angle: dim({ A: 1 }),
  area: dim({ L: 2 }),
  volume: dim({ L: 3 }),
  frequency: dim({ T: -1 }),
  velocity: dim({ L: 1, T: -1 }),
  acceleration: dim({ L: 1, T: -2 }),
  'angular velocity': dim({ A: 1, T: -1 }),
  momentum: dim({ M: 1, L: 1, T: -1 }),
  force: dim({ M: 1, L: 1, T: -2 }),
  pressure: dim({ M: 1, L: -1, T: -2 }),
  energy: dim({ M: 1, L: 2, T: -2 }),
  power: dim({ M: 1, L: 2, T: -3 }),
  charge: dim({ I: 1, T: 1 }),
  voltage: dim({ M: 1, L: 2, T: -3, I: -1 }),
  resistance: dim({ M: 1, L: 2, T: -3, I: -2 }),
  capacitance: dim({ M: -1, L: -2, T: 4, I: 2 }),
  inductance: dim({ M: 1, L: 2, T: -2, I: -2 }),
  'magnetic flux': dim({ M: 1, L: 2, T: -2, I: -1 }),
  'magnetic flux density': dim({ M: 1, T: -2, I: -1 }),
  density: dim({ M: 1, L: -3 }),
  concentration: dim({ N: 1, L: -3 }),
  'molar mass': dim({ M: 1, N: -1 }),
  'specific heat capacity': dim({ L: 2, T: -2, K: -1 }),
  'heat capacity': dim({ M: 1, L: 2, T: -2, K: -1 }),
  'mass flow': dim({ M: 1, T: -1 }),
  'volumetric flow': dim({ L: 3, T: -1 }),
  viscosity: dim({ M: 1, L: -1, T: -1 }),
  illuminance: dim({ J: 1, L: -2 })
}

/** The familiar name of a dimension when it has one, so a message can say "velocity" rather than "L·T^-1". */
export function nameDimension(a: Dimension): string | null {
  for (const [name, dimension] of Object.entries(NAMED_DIMENSIONS)) {
    if (sameDimension(a, dimension)) return name
  }
  return null
}

/** A dimension named if possible, spelled out otherwise. What every error message should use. */
export const readDimension = (a: Dimension): string => nameDimension(a) ?? describeDimension(a)

// ---------------------------------------------------------------- units

/** Where a unit comes from. Metadata only -- it never changes a conversion. */
export type UnitSystem = 'SI' | 'metric' | 'imperial' | 'US' | 'CGS' | 'astronomical' | 'other'

export interface UnitDefinition {
  /** The canonical identifier. Stable: saved measurements refer to it. */
  id: string
  /** How it is written. */
  symbol: string
  name: string
  plural?: string
  dimension: Dimension
  /**
   * How many base units one of these is.
   *
   * Base means the SI base combination of the unit's own dimension: metres for length, kilograms for mass, seconds for
   * time, kelvin for temperature. So a kilometre's scale is 1000 and a gram's is 0.001.
   */
  scale: number
  /**
   * Added *after* scaling, on the way to base.
   *
   * Only temperature needs it, and it is what makes temperature the awkward case: 0 °C is 273.15 K, so a temperature
   * cannot be converted by multiplying alone. A unit with an offset may not appear inside a compound -- see `parseUnit`.
   */
  offset?: number
  system: UnitSystem
  /** Other spellings that mean this unit. */
  aliases?: string[]
  /** Whether SI prefixes may be attached. The metre yes, the inch no, the minute no. */
  prefixable?: boolean
  /** An exact definition rather than a measured one, worth knowing when precision matters. */
  exact?: boolean
}

/** The SI prefixes, as exact powers of ten. */
export const PREFIXES: Record<string, { symbol: string; scale: number; name: string }> = {
  quetta: { symbol: 'Q', scale: 1e30, name: 'quetta' },
  ronna: { symbol: 'R', scale: 1e27, name: 'ronna' },
  yotta: { symbol: 'Y', scale: 1e24, name: 'yotta' },
  zetta: { symbol: 'Z', scale: 1e21, name: 'zetta' },
  exa: { symbol: 'E', scale: 1e18, name: 'exa' },
  peta: { symbol: 'P', scale: 1e15, name: 'peta' },
  tera: { symbol: 'T', scale: 1e12, name: 'tera' },
  giga: { symbol: 'G', scale: 1e9, name: 'giga' },
  mega: { symbol: 'M', scale: 1e6, name: 'mega' },
  kilo: { symbol: 'k', scale: 1e3, name: 'kilo' },
  hecto: { symbol: 'h', scale: 1e2, name: 'hecto' },
  deca: { symbol: 'da', scale: 1e1, name: 'deca' },
  deci: { symbol: 'd', scale: 1e-1, name: 'deci' },
  centi: { symbol: 'c', scale: 1e-2, name: 'centi' },
  milli: { symbol: 'm', scale: 1e-3, name: 'milli' },
  micro: { symbol: 'µ', scale: 1e-6, name: 'micro' },
  nano: { symbol: 'n', scale: 1e-9, name: 'nano' },
  pico: { symbol: 'p', scale: 1e-12, name: 'pico' },
  femto: { symbol: 'f', scale: 1e-15, name: 'femto' },
  atto: { symbol: 'a', scale: 1e-18, name: 'atto' },
  zepto: { symbol: 'z', scale: 1e-21, name: 'zepto' },
  yocto: { symbol: 'y', scale: 1e-24, name: 'yocto' },
  ronto: { symbol: 'r', scale: 1e-27, name: 'ronto' },
  quecto: { symbol: 'q', scale: 1e-30, name: 'quecto' }
}

const unit = (u: UnitDefinition): UnitDefinition => u

/**
 * The units Orbis knows.
 *
 * Every scale is the accepted definition, and the ones exact by definition rather than by measurement say so. A unit
 * missing from here is a unit Orbis refuses rather than guesses at.
 */
export const UNITS: UnitDefinition[] = [
  // ---- length
  unit({ id: 'metre', symbol: 'm', name: 'metre', plural: 'metres', dimension: { L: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['meter', 'meters', 'metres'] }),
  unit({ id: 'inch', symbol: 'in', name: 'inch', plural: 'inches', dimension: { L: 1 }, scale: 0.0254, system: 'imperial', exact: true, aliases: ['inches', '"'] }),
  unit({ id: 'foot', symbol: 'ft', name: 'foot', plural: 'feet', dimension: { L: 1 }, scale: 0.3048, system: 'imperial', exact: true, aliases: ['feet'] }),
  unit({ id: 'yard', symbol: 'yd', name: 'yard', plural: 'yards', dimension: { L: 1 }, scale: 0.9144, system: 'imperial', exact: true }),
  unit({ id: 'mile', symbol: 'mi', name: 'mile', plural: 'miles', dimension: { L: 1 }, scale: 1609.344, system: 'imperial', exact: true }),
  unit({ id: 'nautical-mile', symbol: 'nmi', name: 'nautical mile', dimension: { L: 1 }, scale: 1852, system: 'other', exact: true }),
  unit({ id: 'angstrom', symbol: 'Å', name: 'angstrom', dimension: { L: 1 }, scale: 1e-10, system: 'other', exact: true, aliases: ['angstroms'] }),
  unit({ id: 'astronomical-unit', symbol: 'au', name: 'astronomical unit', dimension: { L: 1 }, scale: 149597870700, system: 'astronomical', exact: true }),
  unit({ id: 'light-year', symbol: 'ly', name: 'light-year', dimension: { L: 1 }, scale: 9460730472580800, system: 'astronomical', exact: true, aliases: ['lightyear', 'lightyears'] }),
  unit({ id: 'parsec', symbol: 'pc', name: 'parsec', dimension: { L: 1 }, scale: 3.0856775814913673e16, system: 'astronomical', prefixable: true, aliases: ['parsecs'] }),

  // ---- mass
  // The kilogram is the SI base unit, but the gram is what takes prefixes -- so the gram is defined here and `kg` is a
  // prefixed gram. That is why this scale is 0.001 rather than 1.
  unit({ id: 'gram', symbol: 'g', name: 'gram', plural: 'grams', dimension: { M: 1 }, scale: 0.001, system: 'SI', prefixable: true, exact: true, aliases: ['gramme', 'grammes'] }),
  unit({ id: 'tonne', symbol: 't', name: 'tonne', plural: 'tonnes', dimension: { M: 1 }, scale: 1000, system: 'metric', exact: true }),
  unit({ id: 'pound', symbol: 'lb', name: 'pound', plural: 'pounds', dimension: { M: 1 }, scale: 0.45359237, system: 'imperial', exact: true, aliases: ['lbs'] }),
  unit({ id: 'ounce', symbol: 'oz', name: 'ounce', plural: 'ounces', dimension: { M: 1 }, scale: 0.028349523125, system: 'imperial', exact: true }),
  unit({ id: 'stone', symbol: 'st', name: 'stone', dimension: { M: 1 }, scale: 6.35029318, system: 'imperial', exact: true, aliases: ['stones'] }),
  unit({ id: 'atomic-mass-unit', symbol: 'u', name: 'unified atomic mass unit', dimension: { M: 1 }, scale: 1.66053906892e-27, system: 'other', aliases: ['amu', 'Da', 'dalton', 'daltons'] }),

  // ---- time
  unit({ id: 'second', symbol: 's', name: 'second', plural: 'seconds', dimension: { T: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['sec', 'secs'] }),
  unit({ id: 'minute', symbol: 'min', name: 'minute', plural: 'minutes', dimension: { T: 1 }, scale: 60, system: 'other', exact: true }),
  unit({ id: 'hour', symbol: 'h', name: 'hour', plural: 'hours', dimension: { T: 1 }, scale: 3600, system: 'other', exact: true, aliases: ['hr', 'hrs'] }),
  unit({ id: 'day', symbol: 'd', name: 'day', plural: 'days', dimension: { T: 1 }, scale: 86400, system: 'other', exact: true }),
  unit({ id: 'week', symbol: 'wk', name: 'week', plural: 'weeks', dimension: { T: 1 }, scale: 604800, system: 'other', exact: true }),
  // A Julian year, which is the one with a definition. Calendar years vary, and that is a date problem rather than a
  // unit problem.
  unit({ id: 'year', symbol: 'yr', name: 'Julian year', plural: 'years', dimension: { T: 1 }, scale: 31557600, system: 'astronomical', exact: true }),

  // ---- temperature
  unit({ id: 'kelvin', symbol: 'K', name: 'kelvin', dimension: { K: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['kelvins'] }),
  unit({ id: 'celsius', symbol: '°C', name: 'degree Celsius', dimension: { K: 1 }, scale: 1, offset: 273.15, system: 'metric', exact: true, aliases: ['degC', 'celsius', 'centigrade'] }),
  unit({ id: 'fahrenheit', symbol: '°F', name: 'degree Fahrenheit', dimension: { K: 1 }, scale: 5 / 9, offset: 459.67 * (5 / 9), system: 'US', exact: true, aliases: ['degF', 'fahrenheit'] }),
  unit({ id: 'rankine', symbol: '°R', name: 'degree Rankine', dimension: { K: 1 }, scale: 5 / 9, system: 'other', exact: true, aliases: ['degR', 'rankine'] }),

  // ---- current, amount, luminous intensity
  unit({ id: 'ampere', symbol: 'A', name: 'ampere', plural: 'amperes', dimension: { I: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['amp', 'amps', 'ampere', 'amperes'] }),
  unit({ id: 'mole', symbol: 'mol', name: 'mole', plural: 'moles', dimension: { N: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'candela', symbol: 'cd', name: 'candela', dimension: { J: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['candelas'] }),
  // A lumen is a candela steradian. The steradian is dimensionless, so a lumen has the dimension of luminous
  // intensity -- which is why lm and cd cannot be told apart by dimensional analysis and must not be confused by it.
  unit({ id: 'lumen', symbol: 'lm', name: 'lumen', plural: 'lumens', dimension: { J: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true }),

  // ---- angle
  unit({ id: 'radian', symbol: 'rad', name: 'radian', plural: 'radians', dimension: { A: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'degree', symbol: '°', name: 'degree', plural: 'degrees', dimension: { A: 1 }, scale: Math.PI / 180, system: 'other', exact: true, aliases: ['deg', 'degrees'] }),
  unit({ id: 'gradian', symbol: 'grad', name: 'gradian', dimension: { A: 1 }, scale: Math.PI / 200, system: 'other', exact: true, aliases: ['gon', 'gradians'] }),
  unit({ id: 'arcminute', symbol: 'arcmin', name: 'arcminute', dimension: { A: 1 }, scale: Math.PI / 10800, system: 'other', exact: true, aliases: ['arcminutes'] }),
  unit({ id: 'arcsecond', symbol: 'arcsec', name: 'arcsecond', dimension: { A: 1 }, scale: Math.PI / 648000, system: 'other', exact: true, aliases: ['arcseconds'] }),
  unit({ id: 'turn', symbol: 'turn', name: 'turn', dimension: { A: 1 }, scale: 2 * Math.PI, system: 'other', exact: true, aliases: ['revolution', 'revolutions'] }),

  // ---- derived SI, named
  unit({ id: 'hertz', symbol: 'Hz', name: 'hertz', dimension: { T: -1 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'newton', symbol: 'N', name: 'newton', plural: 'newtons', dimension: { M: 1, L: 1, T: -2 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'pascal', symbol: 'Pa', name: 'pascal', plural: 'pascals', dimension: { M: 1, L: -1, T: -2 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'joule', symbol: 'J', name: 'joule', plural: 'joules', dimension: { M: 1, L: 2, T: -2 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'watt', symbol: 'W', name: 'watt', plural: 'watts', dimension: { M: 1, L: 2, T: -3 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'coulomb', symbol: 'C', name: 'coulomb', dimension: { I: 1, T: 1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['coulombs'] }),
  unit({ id: 'volt', symbol: 'V', name: 'volt', plural: 'volts', dimension: { M: 1, L: 2, T: -3, I: -1 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'ohm', symbol: 'Ω', name: 'ohm', plural: 'ohms', dimension: { M: 1, L: 2, T: -3, I: -2 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['ohms'] }),
  unit({ id: 'farad', symbol: 'F', name: 'farad', dimension: { M: -1, L: -2, T: 4, I: 2 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['farads'] }),
  unit({ id: 'henry', symbol: 'H', name: 'henry', dimension: { M: 1, L: 2, T: -2, I: -2 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['henries'] }),
  unit({ id: 'weber', symbol: 'Wb', name: 'weber', dimension: { M: 1, L: 2, T: -2, I: -1 }, scale: 1, system: 'SI', prefixable: true, exact: true, aliases: ['webers'] }),
  unit({ id: 'tesla', symbol: 'T', name: 'tesla', dimension: { M: 1, T: -2, I: -1 }, scale: 1, system: 'SI', exact: true, aliases: ['teslas'] }),
  unit({ id: 'siemens', symbol: 'S', name: 'siemens', dimension: { M: -1, L: -2, T: 3, I: 2 }, scale: 1, system: 'SI', prefixable: true, exact: true }),
  unit({ id: 'lux', symbol: 'lx', name: 'lux', dimension: { J: 1, L: -2 }, scale: 1, system: 'SI', prefixable: true, exact: true }),

  // ---- area and volume
  unit({ id: 'hectare', symbol: 'ha', name: 'hectare', dimension: { L: 2 }, scale: 10000, system: 'metric', exact: true, aliases: ['hectares'] }),
  unit({ id: 'acre', symbol: 'ac', name: 'acre', dimension: { L: 2 }, scale: 4046.8564224, system: 'imperial', exact: true, aliases: ['acres'] }),
  unit({ id: 'litre', symbol: 'L', name: 'litre', plural: 'litres', dimension: { L: 3 }, scale: 0.001, system: 'metric', prefixable: true, exact: true, aliases: ['l', 'liter', 'liters', 'litres'] }),
  unit({ id: 'gallon-us', symbol: 'gal', name: 'US gallon', dimension: { L: 3 }, scale: 0.003785411784, system: 'US', exact: true, aliases: ['gallons'] }),
  unit({ id: 'gallon-imperial', symbol: 'impgal', name: 'imperial gallon', dimension: { L: 3 }, scale: 0.00454609, system: 'imperial', exact: true }),

  // ---- pressure, energy, power in the units people use
  unit({ id: 'bar', symbol: 'bar', name: 'bar', dimension: { M: 1, L: -1, T: -2 }, scale: 100000, system: 'metric', prefixable: true, exact: true, aliases: ['bars'] }),
  unit({ id: 'atmosphere', symbol: 'atm', name: 'standard atmosphere', dimension: { M: 1, L: -1, T: -2 }, scale: 101325, system: 'other', exact: true, aliases: ['atmospheres'] }),
  unit({ id: 'torr', symbol: 'Torr', name: 'torr', dimension: { M: 1, L: -1, T: -2 }, scale: 101325 / 760, system: 'other', exact: true, aliases: ['mmHg'] }),
  unit({ id: 'psi', symbol: 'psi', name: 'pound per square inch', dimension: { M: 1, L: -1, T: -2 }, scale: 6894.757293168361, system: 'imperial' }),
  unit({ id: 'calorie', symbol: 'cal', name: 'thermochemical calorie', dimension: { M: 1, L: 2, T: -2 }, scale: 4.184, system: 'other', prefixable: true, exact: true, aliases: ['calories'] }),
  unit({ id: 'electronvolt', symbol: 'eV', name: 'electronvolt', dimension: { M: 1, L: 2, T: -2 }, scale: 1.602176634e-19, system: 'other', prefixable: true, exact: true, aliases: ['electronvolts'] }),
  unit({ id: 'watt-hour', symbol: 'Wh', name: 'watt-hour', dimension: { M: 1, L: 2, T: -2 }, scale: 3600, system: 'other', prefixable: true, exact: true }),
  unit({ id: 'horsepower', symbol: 'hp', name: 'mechanical horsepower', dimension: { M: 1, L: 2, T: -3 }, scale: 745.6998715822702, system: 'imperial' }),

  // ---- dimensionless
  unit({ id: 'one', symbol: '', name: 'dimensionless', dimension: {}, scale: 1, system: 'SI', exact: true }),
  unit({ id: 'percent', symbol: '%', name: 'percent', dimension: {}, scale: 0.01, system: 'other', exact: true, aliases: ['percent'] }),
  unit({ id: 'per-mille', symbol: '‰', name: 'per mille', dimension: {}, scale: 0.001, system: 'other', exact: true, aliases: ['permille'] })
]

// ---------------------------------------------------------------- lookup

const BY_ID = new Map<string, UnitDefinition>()
/** Exact spellings, case-sensitive: `m` is a metre and `M` is not. */
const EXACT = new Map<string, UnitDefinition>()
/** Lower-cased spellings, for words rather than symbols: `Metres` and `metres` are the same word. */
const LOOSE = new Map<string, UnitDefinition>()

for (const u of UNITS) {
  BY_ID.set(u.id, u)
  if (u.symbol !== '' && !EXACT.has(u.symbol)) EXACT.set(u.symbol, u)
  for (const word of [u.id, u.name, u.plural]) {
    if (word && !LOOSE.has(word.toLowerCase())) LOOSE.set(word.toLowerCase(), u)
  }
  for (const alias of u.aliases ?? []) {
    // A symbol-shaped alias keeps its case; a word-shaped one does not. `C` must not be reachable by typing `c`,
    // because `c` is the centi prefix, and quietly turning a coulomb into a centi-something is the kind of error that
    // survives review.
    if (!EXACT.has(alias)) EXACT.set(alias, u)
    if (/^[a-z]{3,}$/i.test(alias) && !LOOSE.has(alias.toLowerCase())) LOOSE.set(alias.toLowerCase(), u)
  }
}

export const unitById = (id: string): UnitDefinition | null => BY_ID.get(id) ?? null

/** Prefix symbols longest-first, so `da` is tried before `d`. */
const PREFIX_LIST = Object.values(PREFIXES).sort((a, b) => b.symbol.length - a.symbol.length)

/**
 * A single unit word, with any SI prefix resolved.
 *
 * Returns the factor relative to base rather than a `UnitDefinition`, because `km` is not a definition -- it is a
 * definition times a thousand.
 */
export function resolveUnitWord(word: string): { unit: UnitDefinition; scale: number; offset: number; display: string } | null {
  const text = word.trim()
  if (text === '') return null

  const direct = EXACT.get(text) ?? LOOSE.get(text.toLowerCase())
  if (direct) return { unit: direct, scale: direct.scale, offset: direct.offset ?? 0, display: direct.symbol }

  for (const prefix of PREFIX_LIST) {
    if (!text.startsWith(prefix.symbol) || text.length === prefix.symbol.length) continue
    const rest = text.slice(prefix.symbol.length)
    const base = EXACT.get(rest) ?? LOOSE.get(rest.toLowerCase())
    if (!base || base.prefixable !== true) continue
    // A prefixed offset unit would mean "a thousandth of a degree Celsius measured from absolute zero", which is not
    // what anybody typing `m°C` means. Refused rather than guessed at.
    if (base.offset !== undefined) continue
    return { unit: base, scale: base.scale * prefix.scale, offset: 0, display: `${prefix.symbol}${base.symbol}` }
  }

  // And spelled-out prefixes: `kilometre`, `millisecond`.
  const lower = text.toLowerCase()
  for (const prefix of PREFIX_LIST) {
    if (!lower.startsWith(prefix.name) || lower.length === prefix.name.length) continue
    const base = LOOSE.get(lower.slice(prefix.name.length))
    if (!base || base.prefixable !== true || base.offset !== undefined) continue
    return { unit: base, scale: base.scale * prefix.scale, offset: 0, display: `${prefix.symbol}${base.symbol}` }
  }

  return null
}

// ---------------------------------------------------------------- compound units

/**
 * A unit expression: what a quantity is measured in, after parsing.
 *
 * `factor` and `offset` say how to reach base units, as `base = value * factor + offset`. An offset is only ever present
 * on a bare temperature, never on a compound.
 */
export interface ResolvedUnit {
  /** As written, tidied. What a result should display. */
  display: string
  dimension: Dimension
  factor: number
  offset: number
  /** The definition when the expression was a single unit, for metadata. Null for a compound. */
  single: UnitDefinition | null
}

export const DIMENSIONLESS_UNIT: ResolvedUnit = Object.freeze({
  display: '',
  dimension: DIMENSIONLESS,
  factor: 1,
  offset: 0,
  single: null
})

export interface UnitParseError {
  error: 'unknown-unit' | 'syntax' | 'offset-in-compound'
  message: string
  /** The word that could not be resolved, when there was one. */
  word?: string
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/** The characters people type, made into the ones the parser knows. */
function tidyUnitText(input: string): string {
  let text = String(input ?? '').trim()
  // A negative superscript first, so `m⁻¹` becomes `m^-1` rather than `m^-^1`.
  text = text.replace(/⁻([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_all, run: string) => `^-${[...run].map((c) => SUPERSCRIPT.indexOf(c)).join('')}`)
  text = text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^${[...run].map((c) => SUPERSCRIPT.indexOf(c)).join('')}`)
  text = text.replace(/[·⋅×✕✖]/g, '*')
  text = text.replace(/÷/g, '/')
  text = text.replace(/\s+per\s+/gi, '/')
  return text
}

/**
 * A unit as written, resolved.
 *
 * Understands products, quotients and integer or fractional powers: `m`, `km/h`, `kg*m/s^2`, `m^3`, `J/(kg*K)`.
 *
 * A quotient's right-hand side binds to the whole of the rest unless brackets say otherwise, because `J/kg*K` written by
 * a person almost always means `J/(kg*K)`. That is a judgement, and it is the reason brackets are supported: somebody who
 * means the other thing can write `(J/kg)*K`.
 */
export function parseUnit(input: string): ResolvedUnit | UnitParseError {
  const text = tidyUnitText(input)
  if (text === '') return DIMENSIONLESS_UNIT

  let at = 0
  let sawOffset = false
  let words = 0

  interface Term {
    dimension: Dimension
    factor: number
  }

  const skip = (): void => {
    while (at < text.length && /\s/.test(text[at])) at += 1
  }

  /** A number for an exponent. Accepts `-3`, `2`, `1/2` and `0.5`. */
  const readExponent = (): number | null => {
    skip()
    const match = /^-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?/.exec(text.slice(at))
    if (!match) return null
    at += match[0].length
    if (match[0].includes('/')) {
      const [a, b] = match[0].split('/')
      const bottom = Number(b)
      if (!Number.isFinite(bottom) || bottom === 0) return null
      return Number(a) / bottom
    }
    return Number(match[0])
  }

  const readAtom = (): Term | UnitParseError => {
    skip()
    if (at >= text.length) return { error: 'syntax', message: 'The unit ends where something was expected.' }
    if (text[at] === '(') {
      at += 1
      const inner = readProduct()
      if ('error' in inner) return inner
      skip()
      if (text[at] !== ')') return { error: 'syntax', message: 'A bracket was opened and not closed.' }
      at += 1
      return inner
    }
    // A bare `1`, as in `1/s`.
    if (/^1(?![\d.])/.test(text.slice(at))) {
      at += 1
      return { dimension: DIMENSIONLESS, factor: 1 }
    }
    const match = /^[A-Za-zΩµ°%‰'"Å]+/.exec(text.slice(at))
    if (!match) return { error: 'syntax', message: `"${text[at]}" is not part of a unit.` }
    at += match[0].length
    const resolved = resolveUnitWord(match[0])
    if (!resolved) return { error: 'unknown-unit', message: `Orbis does not know the unit "${match[0]}".`, word: match[0] }
    // Recorded here and checked once at the end: a temperature is fine on its own and never fine multiplied by
    // something else, and telling those apart needs the whole expression.
    if (resolved.offset !== 0) sawOffset = true
    words += 1
    return { dimension: resolved.unit.dimension, factor: resolved.scale }
  }

  const readPower = (): Term | UnitParseError => {
    const base = readAtom()
    if ('error' in base) return base
    skip()
    if (text[at] === '^') {
      at += 1
      const exponent = readExponent()
      if (exponent === null) return { error: 'syntax', message: 'A power needs a number after it.' }
      return { dimension: powerDimension(base.dimension, exponent), factor: Math.pow(base.factor, exponent) }
    }
    return base
  }

  function readProduct(): Term | UnitParseError {
    let left = readPower()
    if ('error' in left) return left
    for (;;) {
      skip()
      const op = text[at]
      if (op === '*') {
        at += 1
        const right = readPower()
        if ('error' in right) return right
        left = { dimension: multiplyDimensions(left.dimension, right.dimension), factor: left.factor * right.factor }
        continue
      }
      if (op === '/') {
        at += 1
        // Everything to the right of the slash is the denominator -- see the note on the function.
        const right = readProduct()
        if ('error' in right) return right
        if (right.factor === 0) return { error: 'syntax', message: 'A unit cannot be divided by nothing.' }
        left = { dimension: multiplyDimensions(left.dimension, invertDimension(right.dimension)), factor: left.factor / right.factor }
        continue
      }
      return left
    }
  }

  const result = readProduct()
  if ('error' in result) return result
  skip()
  if (at < text.length) return { error: 'syntax', message: `"${text.slice(at)}" is left over at the end of the unit.` }

  if (sawOffset && words > 1) {
    return {
      error: 'offset-in-compound',
      // The honest reason, because this looks arbitrary otherwise.
      message:
        'Degrees Celsius and Fahrenheit cannot appear inside a compound unit: they are measured from a different zero, so ' +
        'multiplying them is not meaningful. Use kelvin for a temperature difference.'
    }
  }

  const bare = words === 1 && !/[*/^()]/.test(text) ? resolveUnitWord(text.trim()) : null

  return {
    display: text.trim(),
    dimension: result.dimension,
    factor: result.factor,
    offset: bare?.offset ?? 0,
    single: bare?.unit ?? null
  }
}

export const isUnitError = (value: ResolvedUnit | UnitParseError): value is UnitParseError => 'error' in value

// ---------------------------------------------------------------- quantities

/** A number that knows what it is. */
export interface Quantity {
  value: number
  unit: ResolvedUnit
}

export interface QuantityError {
  error: 'unknown-unit' | 'syntax' | 'offset-in-compound' | 'dimension-mismatch' | 'not-a-number'
  message: string
}

export const isQuantityError = (value: unknown): value is QuantityError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/** A quantity from a number and a unit as written. */
export function quantity(value: number, unitText: string): Quantity | QuantityError {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { error: 'not-a-number', message: 'A quantity needs a finite number.' }
  const unit = parseUnit(unitText)
  if (isUnitError(unit)) return { error: unit.error, message: unit.message }
  return { value, unit }
}

/** The same amount expressed in base SI units. The common ground every conversion and comparison goes through. */
export const toBase = (q: Quantity): number => q.value * q.unit.factor + q.unit.offset

/** A quantity built from a base-unit amount and the unit it should be shown in. */
export const fromBase = (base: number, unit: ResolvedUnit): Quantity => ({ value: (base - unit.offset) / unit.factor, unit })

const mismatch = (a: Dimension, b: Dimension, verb: string): QuantityError => ({
  error: 'dimension-mismatch',
  message: `${readDimension(a)} cannot be ${verb} ${readDimension(b)}.`
})

/**
 * The same quantity in another unit.
 *
 * Refused when the dimensions differ, with a message naming both -- because "cannot convert" without saying what to what
 * is the least useful error a converter can give.
 */
export function convertQuantity(q: Quantity, target: string | ResolvedUnit): Quantity | QuantityError {
  const to = typeof target === 'string' ? parseUnit(target) : target
  if (isUnitError(to)) return { error: to.error, message: to.message }
  if (!sameDimension(q.unit.dimension, to.dimension)) {
    return {
      error: 'dimension-mismatch',
      message: `${q.unit.display || 'a plain number'} is ${readDimension(q.unit.dimension)} and ${
        to.display || 'a plain number'
      } is ${readDimension(to.dimension)}, so one cannot become the other.`
    }
  }
  return fromBase(toBase(q), to)
}

/** Two quantities added. Same dimension only, and the answer is in the left one's unit. */
export function addQuantities(a: Quantity, b: Quantity): Quantity | QuantityError {
  if (!sameDimension(a.unit.dimension, b.unit.dimension)) return mismatch(a.unit.dimension, b.unit.dimension, 'added to')
  return fromBase(toBase(a) + toBase(b), a.unit)
}

/**
 * One quantity taken from another.
 *
 * The answer is an absolute value in the left unit, which for temperature reads oddly: 30 °C minus 10 °C gives 20 °C
 * rather than 20 K. Both are 20 degrees of difference, and a caller who wants the difference as a temperature interval
 * should convert the answer to kelvin. Written down because it is the kind of thing somebody will otherwise report as a
 * bug.
 */
export function subtractQuantities(a: Quantity, b: Quantity): Quantity | QuantityError {
  if (!sameDimension(a.unit.dimension, b.unit.dimension)) return mismatch(b.unit.dimension, a.unit.dimension, 'subtracted from')
  return fromBase(toBase(a) - toBase(b), a.unit)
}

function composeDisplay(left: string, right: string, op: '*' | '/'): string {
  if (left === '' && right === '') return ''
  if (right === '') return left
  if (left === '') return op === '*' ? right : `1/${right}`
  const wrap = (text: string): string => (/[*/^\s]/.test(text) ? `(${text})` : text)
  return `${wrap(left)}${op}${wrap(right)}`
}

/** A quantity in kelvin when it carries an offset, unchanged otherwise. Multiplying an offset unit is meaningless. */
const withoutOffset = (q: Quantity): Quantity => (q.unit.offset === 0 ? q : (convertQuantity(q, 'K') as Quantity))

/**
 * Two quantities multiplied.
 *
 * The result's unit is a compound built from both, so metres times metres is `m^2` and not a bare number.
 */
export function multiplyQuantities(a: Quantity, b: Quantity): Quantity {
  const left = withoutOffset(a)
  const right = withoutOffset(b)
  return {
    value: left.value * right.value,
    unit: {
      display: composeDisplay(left.unit.display, right.unit.display, '*'),
      dimension: multiplyDimensions(left.unit.dimension, right.unit.dimension),
      factor: left.unit.factor * right.unit.factor,
      offset: 0,
      single: null
    }
  }
}

export function divideQuantities(a: Quantity, b: Quantity): Quantity | QuantityError {
  if (b.value === 0) return { error: 'not-a-number', message: 'A quantity cannot be divided by zero.' }
  const left = withoutOffset(a)
  const right = withoutOffset(b)
  return {
    value: left.value / right.value,
    unit: {
      display: composeDisplay(left.unit.display, right.unit.display, '/'),
      dimension: multiplyDimensions(left.unit.dimension, invertDimension(right.unit.dimension)),
      factor: left.unit.factor / right.unit.factor,
      offset: 0,
      single: null
    }
  }
}

/** A quantity raised to a power. */
export function powerQuantity(a: Quantity, exponent: number): Quantity {
  const base = withoutOffset(a)
  return {
    value: Math.pow(base.value, exponent),
    unit: {
      display: exponent === 1 || base.unit.display === '' ? base.unit.display : `(${base.unit.display})^${trimNumber(exponent)}`,
      dimension: powerDimension(base.unit.dimension, exponent),
      factor: Math.pow(base.unit.factor, exponent),
      offset: 0,
      single: null
    }
  }
}

/**
 * A compound unit written as a single named one where that is exactly true.
 *
 * `kg*m/s^2` becomes `N`, so a computed force reads like a force. Only when both the dimension and the scale match: a
 * unit that is merely the same dimension is a different unit, and swapping one for the other would change the number.
 */
export function simplifyUnit(u: ResolvedUnit): ResolvedUnit {
  if (u.single) return u
  for (const candidate of UNITS) {
    if (candidate.offset !== undefined || candidate.id === 'one') continue
    if (!sameDimension(candidate.dimension, u.dimension)) continue
    if (Math.abs(candidate.scale - u.factor) > Math.abs(u.factor || 1) * 1e-12) continue
    return { display: candidate.symbol, dimension: candidate.dimension, factor: candidate.scale, offset: 0, single: candidate }
  }
  return u
}

/** A quantity written out: `12.5 m/s`, and `12.5` when it has no unit. */
export function formatQuantity(q: Quantity, digits = 6): string {
  const value = Number(q.value.toPrecision(Math.min(21, Math.max(1, Math.round(digits)))))
  return q.unit.display === '' ? String(value) : `${value} ${q.unit.display}`
}

/**
 * Every unit a given one could be converted to.
 *
 * For a picker. Offering somebody the chance to convert a length into a pressure is offering them an error.
 */
export const compatibleUnits = (u: ResolvedUnit): UnitDefinition[] =>
  UNITS.filter((candidate) => candidate.id !== 'one' && sameDimension(candidate.dimension, u.dimension))
