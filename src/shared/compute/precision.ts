/**
 * Significant figures, rounding and notation — how many digits a number has earned the right to show.
 *
 * The shared precision engine for Orbis Pages. It is about *notation*, and that is a different subject from
 * uncertainty. `measurement.ts` answers "how far out might this be", with a ± and a distribution behind it.
 * This file answers "how many digits should be written down", which is a weaker and much older discipline — it
 * carries roughly one digit of information about the uncertainty, and it carries it through arithmetic.
 *
 * Both are worth having. Neither substitutes for the other, and a Page that writes 3 significant figures has not
 * thereby stated an uncertainty.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * written form   vs   value           -- "1200" and "1.200e3" are the same value and different claims
 * ambiguous      vs   3 figures       -- trailing zeros in plain notation do not say how many are meant
 * add/subtract   vs   multiply/divide -- one rule counts decimal places, the other counts significant figures
 * round at end   vs   round each step -- rounding twice loses digits that were never wrong
 * half-up        vs   half-even       -- one of them biases a long column of sums upward
 * exact          vs   representable   -- 0.1 is exact in decimal and not in binary, and that shows up eventually
 * precision      vs   accuracy        -- digits written down say nothing about being right
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

import { PREFIXES } from './units.ts'

// ---------------------------------------------------------------- failure

export interface PrecisionError {
  error: 'invalid-argument' | 'not-finite' | 'unparsable' | 'too-many-figures' | 'ambiguous' | 'mismatched-length' | 'empty'
  message: string
}

export const isPrecisionError = (value: unknown): value is PrecisionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: PrecisionError['error'], message: string): PrecisionError => ({ error, message })

/**
 * A double carries between 15 and 17 decimal digits, depending on the value. Asking for more is asking for digits
 * the arithmetic never had, and they would be an artefact of the binary representation rather than of the data.
 */
export const MAXIMUM_FIGURES = 17

/** Below this many digits a double is exact for every value, so a figure count here is always honest. */
export const ALWAYS_EXACT_FIGURES = 15

// ---------------------------------------------------------------- reading a written number

export interface Measured {
  value: number
  /** How many digits the written form claims. Null when the written form does not say. */
  significantFigures: number | null
  /** How many digits after the decimal point the written form claims. Null for scientific notation without one. */
  decimalPlaces: number | null
  /** The text as given. */
  text: string
  /**
   * True when trailing zeros before the decimal point leave the figure count unstated.
   *
   * "1200" might be 2, 3 or 4 significant figures and the notation does not say. This is not a defect in the parser;
   * it is a defect in plain decimal notation, and the fix is to write 1.2e3, 1.20e3 or 1.200e3.
   */
  ambiguous: boolean
  why: string
}

const NUMBER_PATTERN = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/

/**
 * Reads a written number and works out how many digits it claims.
 *
 * The rules, in the order they apply: digits between the first and last non-zero digit always count; leading zeros
 * never count, because they only place the decimal point; trailing zeros after a decimal point always count, because
 * there is no reason to write them otherwise; and trailing zeros before the decimal point, with no decimal point
 * written, count for nothing definite — that is the ambiguous case.
 */
export function readMeasured(text: string): Measured | PrecisionError {
  if (typeof text !== 'string') return fail('invalid-argument', 'A written number must be given as text.')
  const match = NUMBER_PATTERN.exec(text)
  if (match === null) return fail('unparsable', `"${text}" is not a written number. Expected something like 12.30, 0.004 or 1.20e3.`)
  const whole = match[2] ?? ''
  const fraction = match[3]
  const exponentText = match[4]
  if (whole === '' && (fraction === undefined || fraction === '')) {
    return fail('unparsable', `"${text}" has no digits in it.`)
  }
  const value = Number(text.trim())
  if (!Number.isFinite(value)) return fail('not-finite', `"${text}" is not a finite number.`)

  const digits = whole + (fraction ?? '')
  const firstSignificant = digits.search(/[1-9]/)
  const allZero = firstSignificant === -1

  let significantFigures: number | null
  let ambiguous = false
  let why: string

  if (allZero) {
    // Zero is its own case. "0.00" states two decimal places and no significant figures at all.
    // Zero has no significant digits of its own, whatever precision it was written to. The decimal places still
    // carry a claim about the measurement, and they are reported separately.
    significantFigures = 0
    why = fraction === undefined
      ? 'Zero written with no decimal point states no precision at all.'
      : `Zero written to ${fraction.length} decimal place${fraction.length === 1 ? '' : 's'} states the precision of the measurement. It is still no significant figures — zero has none.`
  } else if (exponentText !== undefined) {
    // Checked before the decimal-point case: 1.20e3 has both, and it is the notation that settles the count.
    significantFigures = digits.length - firstSignificant
    why = `${significantFigures} significant figure${significantFigures === 1 ? '' : 's'}, stated exactly: scientific notation puts every digit it means in the mantissa.`
  } else if (fraction !== undefined) {
    // A decimal point is written, so every digit from the first non-zero one to the end counts.
    significantFigures = digits.length - firstSignificant
    why = `${significantFigures} significant figure${significantFigures === 1 ? '' : 's'}: a decimal point is written, so the trailing zeros count — there would be no reason to write them otherwise.`
  } else {
    const trailingZeros = whole.length - 1 - whole.search(/[1-9](?=0*$)/)
    if (trailingZeros > 0) {
      significantFigures = null
      ambiguous = true
      const least = whole.length - firstSignificant - trailingZeros
      const most = whole.length - firstSignificant
      const exponent = whole.length - firstSignificant - 1
      const mantissa = digits.slice(firstSignificant, firstSignificant + 1)
      why = `"${whole}" claims between ${least} and ${most} significant figures and the notation does not say which. Write ${mantissa}e${exponent} for ${least}, or ${mantissa}.${'0'.repeat(most - 1)}e${exponent} for ${most}.`
    } else {
      significantFigures = whole.length - firstSignificant
      why = `${significantFigures} significant figure${significantFigures === 1 ? '' : 's'}.`
    }
  }

  return {
    value,
    significantFigures,
    decimalPlaces: fraction === undefined ? null : fraction.length,
    text: text.trim(),
    ambiguous,
    why
  }
}

// ---------------------------------------------------------------- rounding

/**
 * How to settle a digit that lands exactly halfway.
 *
 * `half-even` is the default everywhere in this file. Rounding halves consistently upward adds a small positive bias
 * to every value that lands on one, and over a column of numbers that bias accumulates into a real error in the
 * total. Half-even sends half of them up and half down, so it cancels.
 */
export type RoundingMode = 'half-even' | 'half-up' | 'half-away-from-zero' | 'toward-zero' | 'floor' | 'ceiling'

export const ROUNDING_MODES: readonly RoundingMode[] = Object.freeze([
  'half-even',
  'half-up',
  'half-away-from-zero',
  'toward-zero',
  'floor',
  'ceiling'
])

export const ROUNDING_FACTS: Readonly<Record<RoundingMode, { label: string; describe: string }>> = Object.freeze({
  'half-even': {
    label: 'Half to even',
    describe: 'A halfway digit goes to whichever neighbour is even. Half go up and half go down, so a long column of rounded values does not drift.'
  },
  'half-up': {
    label: 'Half up',
    describe: 'A halfway digit goes toward positive infinity. Familiar, and it biases every total containing one upward.'
  },
  'half-away-from-zero': {
    label: 'Half away from zero',
    describe: 'A halfway digit goes away from zero in both directions. What most people are taught; it biases magnitudes upward.'
  },
  'toward-zero': { label: 'Toward zero', describe: 'The digits are cut off. Always reduces the magnitude, never increases it.' },
  floor: { label: 'Down', describe: 'Always toward negative infinity, halfway or not.' },
  ceiling: { label: 'Up', describe: 'Always toward positive infinity, halfway or not.' }
})

/**
 * Multiplies by a power of ten by editing the decimal exponent rather than by arithmetic.
 *
 * Multiplying introduces its own rounding: `1.005 * 100` is `100.49999999999999`, so the naive version rounds 1.005
 * down to 1.00 and insists it followed the rule. Editing the exponent in the decimal string does not touch the digits.
 *
 * The exponent already in the string has to be added to rather than appended after — `${1.5e-9}e10` is the string
 * "1.5e-9e10", which is not a number at all.
 */
function shiftExponent(value: number, by: number): number {
  const text = String(value)
  const parts = /^([+-]?[\d.]+)[eE]([+-]?\d+)$/.exec(text)
  if (parts === null) return Number(`${text}e${by}`)
  return Number(`${parts[1]}e${Number(parts[2]) + by}`)
}

function applyMode(scaled: number, mode: RoundingMode): number {
  const floor = Math.floor(scaled)
  const remainder = scaled - floor
  switch (mode) {
    case 'floor':
      return floor
    case 'ceiling':
      return Math.ceil(scaled)
    case 'toward-zero':
      return Math.trunc(scaled)
    case 'half-up':
      return remainder === 0.5 ? floor + 1 : Math.round(scaled)
    case 'half-away-from-zero':
      return remainder === 0.5 && scaled < 0 ? floor : Math.sign(scaled) * Math.round(Math.abs(scaled))
    case 'half-even': {
      // Only an exact half is ambiguous; everything else has one nearest integer.
      if (remainder !== 0.5) return Math.round(scaled)
      return floor % 2 === 0 ? floor : floor + 1
    }
  }
}

/**
 * Rounds to a number of decimal places.
 *
 * Done by shifting with a string conversion rather than by multiplying by a power of ten. Multiplying introduces its
 * own rounding — `1.005 * 100` is `100.49999999999999` in binary, so the naive version rounds 1.005 down to 1.00 and
 * insists it was following the rule.
 */
export function roundDecimals(value: number, places: number, mode: RoundingMode = 'half-even'): number | PrecisionError {
  if (!Number.isFinite(value)) return fail('not-finite', 'The value must be a finite number.')
  if (!Number.isInteger(places) || places < 0 || places > 100) {
    return fail('invalid-argument', 'The number of decimal places must be a whole number from 0 to 100.')
  }
  if (!Object.prototype.hasOwnProperty.call(ROUNDING_FACTS, mode)) {
    return fail('invalid-argument', `There is no rounding mode called "${mode}". The ones here are ${ROUNDING_MODES.join(', ')}.`)
  }
  if (value === 0) return 0
  const shifted = shiftExponent(value, places)
  if (!Number.isFinite(shifted)) return fail('not-finite', `Rounding ${value} to ${places} places overflows.`)
  const rounded = applyMode(shifted, mode)
  const back = shiftExponent(rounded, -places)
  return Object.is(back, -0) ? 0 : back
}

/** Rounds to a number of significant figures. */
export function roundSignificant(value: number, figures: number, mode: RoundingMode = 'half-even'): number | PrecisionError {
  if (!Number.isFinite(value)) return fail('not-finite', 'The value must be a finite number.')
  if (!Number.isInteger(figures) || figures < 1) return fail('invalid-argument', 'The number of significant figures must be a whole number of at least 1.')
  if (figures > MAXIMUM_FIGURES) {
    return fail('too-many-figures', `${figures} significant figures is more than a double carries. Past ${MAXIMUM_FIGURES} the extra digits describe the binary representation rather than the number.`)
  }
  if (value === 0) return 0
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const places = figures - 1 - exponent

  const at = (decimalPlaces: number): number | PrecisionError => {
    if (decimalPlaces >= 0) return roundDecimals(value, Math.min(100, decimalPlaces), mode)
    // Fewer figures than the magnitude has digits: the rounding happens to the left of the decimal point, so shift
    // the value down, round it there, and shift it back. Rounding to 0 places would leave 1234 as 1234.
    const scale = 10 ** -decimalPlaces
    return applyMode(value / scale, mode) * scale
  }

  const rounded = at(places)
  if (isPrecisionError(rounded)) return rounded
  if (rounded === 0) return 0
  // Rounding up can carry into a new digit — 9.99 to 2 figures is 10, not 10.0 — and that moves the exponent. One
  // correction settles it: a carry can only happen once, because the corrected result is never larger.
  const newExponent = Math.floor(Math.log10(Math.abs(rounded)))
  if (newExponent === exponent) return rounded
  const corrected = at(figures - 1 - newExponent)
  if (isPrecisionError(corrected)) return corrected
  return corrected
}

// ---------------------------------------------------------------- writing a number down

export type Notation = 'plain' | 'scientific' | 'engineering'

export interface Written {
  text: string
  value: number
  notation: Notation
  significantFigures: number
  /** For scientific and engineering: the mantissa and the power of ten. */
  mantissa: number | null
  exponent: number | null
  /** For engineering notation: the SI prefix that matches the exponent, when one does. */
  prefix: { symbol: string; name: string } | null
  why: string
}

/** Exponent to SI prefix, built from the unit engine's own table so the two can never disagree. */
const PREFIX_BY_EXPONENT: ReadonlyMap<number, { symbol: string; name: string }> = new Map(
  Object.values(PREFIXES)
    .map((one) => [Math.round(Math.log10(one.scale)), { symbol: one.symbol, name: one.name }] as const)
    .filter(([exponent]) => exponent % 3 === 0)
)

function digitsOf(value: number, figures: number): { mantissa: number; exponent: number } {
  if (value === 0) return { mantissa: 0, exponent: 0 }
  let exponent = Math.floor(Math.log10(Math.abs(value)))
  let mantissa = value / 10 ** exponent
  const rounded = roundDecimals(mantissa, figures - 1)
  if (!isPrecisionError(rounded)) mantissa = rounded
  // A mantissa that rounded up to 10 belongs one exponent higher.
  if (Math.abs(mantissa) >= 10) {
    mantissa /= 10
    exponent += 1
  }
  return { mantissa, exponent }
}

/**
 * Writes a number to a stated number of significant figures.
 *
 * Plain notation cannot always express the figure count — writing 1200 to 2 significant figures produces a string that
 * reads as anything from 2 to 4. When that happens the result says so in `why` rather than quietly producing a
 * misleading string, and scientific notation is suggested.
 */
export function write(value: number, figures: number, notation: Notation = 'plain'): Written | PrecisionError {
  if (!Number.isFinite(value)) return fail('not-finite', 'The value must be a finite number.')
  if (!Number.isInteger(figures) || figures < 1) return fail('invalid-argument', 'The number of significant figures must be a whole number of at least 1.')
  if (figures > MAXIMUM_FIGURES) {
    return fail('too-many-figures', `${figures} significant figures is more than a double carries; past ${MAXIMUM_FIGURES} the digits are an artefact of the binary representation.`)
  }
  if (!['plain', 'scientific', 'engineering'].includes(notation)) {
    return fail('invalid-argument', `There is no notation called "${notation}". The ones here are plain, scientific and engineering.`)
  }

  if (value === 0) {
    const text = notation === 'plain' ? (figures > 1 ? `0.${'0'.repeat(figures - 1)}` : '0') : `0.${'0'.repeat(Math.max(0, figures - 1))}e0`
    return {
      text,
      value: 0,
      notation,
      significantFigures: figures,
      mantissa: notation === 'plain' ? null : 0,
      exponent: notation === 'plain' ? null : 0,
      prefix: null,
      why: 'Zero has no significant figures of its own; the digits written show the precision the measurement was made to.'
    }
  }

  const rounded = roundSignificant(value, figures)
  if (isPrecisionError(rounded)) return rounded
  const { mantissa, exponent } = digitsOf(rounded, figures)

  if (notation === 'scientific') {
    return {
      text: `${mantissa.toFixed(figures - 1)}e${exponent}`,
      value: rounded,
      notation,
      significantFigures: figures,
      mantissa,
      exponent,
      prefix: null,
      why: `Scientific notation states the figure count exactly: every digit in the mantissa is meant.`
    }
  }

  if (notation === 'engineering') {
    const engineeringExponent = Math.floor(exponent / 3) * 3
    const engineeringMantissa = rounded / 10 ** engineeringExponent
    const leadingDigits = Math.floor(Math.log10(Math.abs(engineeringMantissa))) + 1
    const places = Math.max(0, figures - leadingDigits)
    const prefix = PREFIX_BY_EXPONENT.get(engineeringExponent) ?? null
    return {
      text: `${engineeringMantissa.toFixed(places)}e${engineeringExponent}`,
      value: rounded,
      notation,
      significantFigures: figures,
      mantissa: engineeringMantissa,
      exponent: engineeringExponent,
      prefix,
      why: prefix === null
        ? `The exponent is a multiple of three, so the mantissa reads as a plain quantity. There is no SI prefix for 10^${engineeringExponent}.`
        : `The exponent is a multiple of three, matching the SI prefix ${prefix.name} (${prefix.symbol}).`
    }
  }

  const places = Math.max(0, figures - 1 - exponent)
  const text = rounded.toFixed(Math.min(100, places))
  // Trailing zeros to the left of the decimal point cannot be marked as significant in plain notation.
  const unstated = places === 0 && Math.abs(rounded) >= 10 ** figures
  return {
    text,
    value: rounded,
    notation,
    significantFigures: figures,
    mantissa: null,
    exponent: null,
    prefix: null,
    why: unstated
      ? `Written plainly this reads as up to ${text.replace('-', '').length} significant figures, but only ${figures} ${figures === 1 ? 'is' : 'are'} meant. Plain notation cannot say which; write it as ${mantissa.toFixed(figures - 1)}e${exponent} to state ${figures}.`
      : `${figures} significant figure${figures === 1 ? '' : 's'}, and the written form says so.`
  }
}

// ---------------------------------------------------------------- arithmetic that carries precision

export type Operation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power'

export interface Quantified {
  value: number
  /** Significant figures claimed. Null for an exact number — a count, a defined constant, an integer factor. */
  significantFigures: number | null
  /** Decimal places claimed. Needed for addition, where the rule counts places rather than figures. */
  decimalPlaces: number | null
  /** True for a number with no measurement error at all: 12 eggs, the 2 in πr², a defined conversion factor. */
  exact: boolean
}

/** An exact number: a count, a defined factor, an integer. It never limits the precision of a result. */
export const exact = (value: number): Quantified => ({ value, significantFigures: null, decimalPlaces: null, exact: true })

/** A measured number, to a stated number of significant figures. */
export function measured(value: number, significantFigures: number, decimalPlaces?: number): Quantified | PrecisionError {
  if (!Number.isFinite(value)) return fail('not-finite', 'The value must be a finite number.')
  if (!Number.isInteger(significantFigures) || significantFigures < 1) {
    return fail('invalid-argument', 'The number of significant figures must be a whole number of at least 1.')
  }
  if (significantFigures > MAXIMUM_FIGURES) {
    return fail('too-many-figures', `${significantFigures} significant figures is more than a double carries.`)
  }
  let places = decimalPlaces
  if (places === undefined) {
    places = value === 0 ? significantFigures - 1 : significantFigures - 1 - Math.floor(Math.log10(Math.abs(value)))
  }
  if (!Number.isInteger(places)) return fail('invalid-argument', 'The number of decimal places must be a whole number.')
  return { value, significantFigures, decimalPlaces: places, exact: false }
}

/** Turns a written number into a quantity, carrying whatever its notation stated. */
export function quantifyText(text: string): Quantified | PrecisionError {
  const read = readMeasured(text)
  if (isPrecisionError(read)) return read
  if (read.ambiguous) {
    return fail('ambiguous', read.why)
  }
  return {
    value: read.value,
    significantFigures: read.significantFigures,
    decimalPlaces: read.decimalPlaces ?? (read.significantFigures === null || read.value === 0 ? 0 : read.significantFigures - 1 - Math.floor(Math.log10(Math.abs(read.value)))),
    exact: false
  }
}

export interface Combined {
  /** The unrounded result. Keep this for further arithmetic; round only when writing the answer down. */
  value: number
  /** The result rounded to the precision the rule allows. This is the number to display. */
  rounded: number
  significantFigures: number | null
  decimalPlaces: number | null
  /** Which rule applied, and why it gave this answer. */
  why: string
  caveats: readonly string[]
}

/**
 * Combines two quantities, carrying the precision by the rule that fits the operation.
 *
 * The two rules are genuinely different and are the thing people get wrong:
 *
 * - **Adding and subtracting** keeps the *decimal places* of the least precise input. 1.2 + 3.45 is 4.65 before
 *   rounding and 4.7 after, because the 1.2 says nothing about hundredths and so neither can the sum.
 * - **Multiplying and dividing** keeps the *significant figures* of the least precise input. 1.2 × 3.45 is 4.14
 *   before rounding and 4.1 after.
 *
 * Applying the figures rule to a sum is how 1.2 + 3.45 becomes 4.7 by accident rather than by reasoning, and applying
 * the places rule to a product gives nonsense whenever the magnitudes differ.
 *
 * Subtraction gets one extra warning, because subtracting two close numbers destroys significant figures outright:
 * 1.00000 − 0.99999 has six figures on each side and one in the answer.
 */
export function combine(a: Quantified, b: Quantified, operation: Operation): Combined | PrecisionError {
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return fail('not-finite', 'Both values must be finite numbers.')
  if (!['add', 'subtract', 'multiply', 'divide', 'power'].includes(operation)) {
    return fail('invalid-argument', `There is no operation called "${operation}".`)
  }
  if (operation === 'divide' && b.value === 0) return fail('invalid-argument', 'Division by zero has no value.')

  let value: number
  switch (operation) {
    case 'add': value = a.value + b.value; break
    case 'subtract': value = a.value - b.value; break
    case 'multiply': value = a.value * b.value; break
    case 'divide': value = a.value / b.value; break
    case 'power': value = a.value ** b.value; break
  }
  if (!Number.isFinite(value)) return fail('not-finite', 'The result is not a finite number.')

  const caveats: string[] = []

  if (a.exact && b.exact) {
    return {
      value,
      rounded: value,
      significantFigures: null,
      decimalPlaces: null,
      why: 'Both numbers are exact, so the result is exact and no rounding applies.',
      caveats: []
    }
  }

  if (operation === 'add' || operation === 'subtract') {
    const places: number[] = []
    if (!a.exact && a.decimalPlaces !== null) places.push(a.decimalPlaces)
    if (!b.exact && b.decimalPlaces !== null) places.push(b.decimalPlaces)
    if (places.length === 0) {
      return { value, rounded: value, significantFigures: null, decimalPlaces: null, why: 'Neither number states its decimal places, so no rounding rule applies.', caveats }
    }
    const keep = Math.min(...places)
    const rounded = roundDecimals(value, Math.max(0, Math.min(100, keep)))
    if (isPrecisionError(rounded)) return rounded
    const figures = value === 0 ? null : Math.max(1, Math.floor(Math.log10(Math.abs(rounded))) + 1 + keep)
    if (operation === 'subtract' && a.value !== 0 && Math.abs(value) < Math.abs(a.value) / 100) {
      const lostFrom = a.significantFigures
      caveats.push(
        `Subtracting two numbers this close together cancels the leading digits: the result is smaller than the inputs by a factor of ${Math.round(Math.abs(a.value) / Math.max(Math.abs(value), Number.MIN_VALUE))}, and the figures that cancelled are gone. ${lostFrom === null ? '' : `The inputs carried ${lostFrom} significant figures; the answer carries about ${figures ?? 1}.`} This is the one operation that can destroy precision rather than merely limit it.`
      )
    }
    return {
      value,
      rounded,
      significantFigures: figures,
      decimalPlaces: keep,
      why: `Adding and subtracting keeps decimal places, not significant figures: the least precise input states ${keep} decimal place${keep === 1 ? '' : 's'}, so the answer can state ${keep} too and no more.`,
      caveats
    }
  }

  const figureCounts: number[] = []
  if (!a.exact && a.significantFigures !== null) figureCounts.push(a.significantFigures)
  if (!b.exact && b.significantFigures !== null) figureCounts.push(b.significantFigures)
  if (operation === 'power' && !b.exact) {
    caveats.push('Raising to a measured power is not covered by the simple rules; the uncertainty in the exponent affects the result in a way a figure count cannot carry. Treat the figure count below as a rough guide and use an uncertainty calculation if the exponent really is uncertain.')
  }
  if (figureCounts.length === 0) {
    return { value, rounded: value, significantFigures: null, decimalPlaces: null, why: 'Neither number states its significant figures, so no rounding rule applies.', caveats }
  }
  const keep = Math.min(...figureCounts)
  const rounded = roundSignificant(value, keep)
  if (isPrecisionError(rounded)) return rounded
  const places = rounded === 0 ? keep - 1 : keep - 1 - Math.floor(Math.log10(Math.abs(rounded)))
  if (a.exact || b.exact) {
    caveats.push('An exact number — a count, a defined factor — places no limit on the precision of a result. Only the measured number does.')
  }
  return {
    value,
    rounded,
    significantFigures: keep,
    decimalPlaces: places,
    why: `${operation === 'power' ? 'Raising to a power' : operation === 'multiply' ? 'Multiplying' : 'Dividing'} keeps significant figures, not decimal places: the least precise input has ${keep}, so the answer has ${keep}.`,
    caveats
  }
}

export interface Step {
  operation: Operation
  operand: Quantified
}

export interface ChainResult {
  /** The unrounded running value, carried through every step at full precision. */
  value: number
  /** The final value rounded once, at the end. */
  rounded: number
  significantFigures: number | null
  decimalPlaces: number | null
  /** What each step did, with the precision it would have had if it had been rounded there. */
  steps: readonly { operation: Operation; value: number; wouldRoundTo: number | null; significantFigures: number | null }[]
  /** The result if it had been rounded after every step, for comparison. */
  ifRoundedEachStep: number
  why: string
  caveats: readonly string[]
}

/**
 * Runs a chain of operations, rounding once at the end.
 *
 * This is the rule that matters most and is followed least. Rounding after every step throws away digits that were
 * never wrong, and the errors compound: each rounding can move the value by half a unit in the last place, and ten
 * roundings can move it by five. The figure count is a statement about the *answer*, not an instruction to truncate
 * the working.
 *
 * The result reports both numbers, so the difference is visible rather than asserted.
 */
export function runChain(start: Quantified, steps: readonly Step[]): ChainResult | PrecisionError {
  if (steps.length === 0) return fail('empty', 'A chain needs at least one step.')
  if (steps.length > 1000) return fail('invalid-argument', 'A chain of more than 1000 steps is refused.')

  let carried: Quantified = start
  let roundedCarried: Quantified = start
  const caveats: string[] = []
  const out: { operation: Operation; value: number; wouldRoundTo: number | null; significantFigures: number | null }[] = []

  for (const step of steps) {
    const result = combine(carried, step.operand, step.operation)
    if (isPrecisionError(result)) return result
    for (const caveat of result.caveats) if (!caveats.includes(caveat)) caveats.push(caveat)
    out.push({
      operation: step.operation,
      value: result.value,
      wouldRoundTo: result.rounded,
      significantFigures: result.significantFigures
    })
    carried = {
      value: result.value,
      significantFigures: result.significantFigures,
      decimalPlaces: result.decimalPlaces,
      exact: false
    }
    // The same chain again, rounding at every step, purely so the two can be compared.
    const alternative = combine(roundedCarried, step.operand, step.operation)
    if (isPrecisionError(alternative)) return alternative
    roundedCarried = {
      value: alternative.rounded,
      significantFigures: alternative.significantFigures,
      decimalPlaces: alternative.decimalPlaces,
      exact: false
    }
  }
  const final = carried
  let rounded = final.value
  if (final.significantFigures !== null) {
    const attempt = roundSignificant(final.value, final.significantFigures)
    if (!isPrecisionError(attempt)) rounded = attempt
  }
  const differs = rounded !== roundedCarried.value
  return {
    value: final.value,
    rounded,
    significantFigures: final.significantFigures,
    decimalPlaces: final.decimalPlaces,
    steps: out,
    ifRoundedEachStep: roundedCarried.value,
    why: differs
      ? `Rounded once at the end: ${rounded}. Rounding after every step instead would have given ${roundedCarried.value}. The difference is digits thrown away in the working that were never wrong — the figure count describes the answer, not the arithmetic that reached it.`
      : `Rounded once at the end. On this chain that happens to give the same answer as rounding at every step; it often does not, which is why the working is carried at full precision either way.`,
    caveats
  }
}

// ---------------------------------------------------------------- what a double can and cannot hold

/**
 * Whether a written decimal has an exact double.
 *
 * Asked properly. Every finite double *is* a sum of halves — that is what a binary float is — so "is the stored value
 * dyadic" is true of everything and answers nothing. The question worth asking is whether the decimal a person wrote
 * is the number that got stored, and a decimal `n / 10^k` is stored exactly only when the factors of five in the
 * denominator cancel, which is to say when `n` is divisible by `5^k`.
 *
 * Done in bigint, because the numerators involved run past what a double can compare exactly — which would be a
 * fitting way for this particular function to be wrong.
 */
function decimalIsDyadic(text: string): boolean {
  const parts = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (parts === null) return false
  const whole = parts[2] ?? ''
  const fraction = parts[3] ?? ''
  const exponent = parts[4] === undefined ? 0 : Number(parts[4])
  const digits = `${whole}${fraction}`
  if (digits === '') return false
  // value = digits / 10^k, once the written exponent is folded in.
  const k = fraction.length - exponent
  if (k <= 0) return true // A whole number times a power of ten has no fives left in a denominator.
  let numerator = BigInt(digits)
  if (numerator === 0n) return true
  let five = 1n
  for (let i = 0; i < k; i += 1) five *= 5n
  if (numerator % five !== 0n) return false
  numerator /= five
  // And the surviving numerator has to fit in the 53 bits a double keeps.
  if (numerator < 0n) numerator = -numerator
  return numerator < 1n << 53n
}

export interface Representation {
  value: number
  /** True when this decimal value has an exact binary double. 0.5 does; 0.1 does not. */
  exactInBinary: boolean
  /** The value a double actually holds, written out to enough digits to show the difference. */
  actual: string
  /** The gap to the next representable double at this magnitude. */
  unitInLastPlace: number
  /** How many decimal digits are trustworthy at this magnitude. */
  trustworthyDigits: number
  why: string
}

/**
 * Says what a double actually holds for a given value.
 *
 * Worth surfacing in a Page whenever a result looks wrong in the last digit. 0.1 + 0.2 is not 0.3 in binary
 * arithmetic, and no amount of rounding rules explains that — it is the representation, not the rule.
 */
export function represent(value: number): Representation | PrecisionError {
  if (!Number.isFinite(value)) return fail('not-finite', 'The value must be a finite number.')
  const actual = value.toPrecision(MAXIMUM_FIGURES)
  const shortest = String(value)
  const magnitude = Math.abs(value)
  const unitInLastPlace = magnitude === 0 ? Number.MIN_VALUE : 2 ** (Math.floor(Math.log2(magnitude)) - 52)
  const trustworthyDigits = ALWAYS_EXACT_FIGURES
  // A decimal fraction is exact in binary only when its fractional part is a sum of halves.
  const reallyExact = decimalIsDyadic(shortest)
  return {
    value,
    exactInBinary: reallyExact,
    actual,
    unitInLastPlace,
    trustworthyDigits,
    why: reallyExact
      ? `${shortest} has an exact double: its fractional part is a sum of halves, so nothing is lost storing it.`
      : `${shortest} has no exact double — its fractional part is not a sum of halves, so what is stored is ${actual}. Every arithmetic result involving it inherits that difference, which is why a sum can end in a string of nines.`
  }
}

/** Whether two values agree once both are rounded to the stated precision. */
export interface Agreement {
  agree: boolean
  a: number
  b: number
  significantFigures: number
  roundedA: number
  roundedB: number
  why: string
}

/**
 * Compares two values at a stated precision.
 *
 * The honest way to ask whether two results match: not whether the doubles are equal, which they almost never are
 * after any arithmetic, but whether they agree to as many digits as either of them claims.
 */
export function agreeTo(a: number, b: number, significantFigures: number): Agreement | PrecisionError {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fail('not-finite', 'Both values must be finite numbers.')
  const roundedA = roundSignificant(a, significantFigures)
  if (isPrecisionError(roundedA)) return roundedA
  const roundedB = roundSignificant(b, significantFigures)
  if (isPrecisionError(roundedB)) return roundedB
  const agree = roundedA === roundedB
  return {
    agree,
    a,
    b,
    significantFigures,
    roundedA,
    roundedB,
    why: agree
      ? `Both round to ${roundedA} at ${significantFigures} significant figure${significantFigures === 1 ? '' : 's'}. They agree as far as that precision goes, which is a statement about these digits and not about the ones below them.`
      : `They round to ${roundedA} and ${roundedB} at ${significantFigures} significant figure${significantFigures === 1 ? '' : 's'}, so they disagree within the precision claimed.`
  }
}
