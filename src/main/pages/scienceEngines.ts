/**
 * The scientific laboratories a Page can reach: signals, interpolation and fitting, precision, constants, coordinate
 * frames and constraints.
 *
 * Same contract as `engines.ts` and `mathEngines.ts`, for the same reasons. A Page sends data, never code. There is no
 * `eval` and no `new Function` on any path reachable from here, and the one place a Page supplies something
 * function-shaped -- a constraint over named values -- it sends arithmetic as text that `expression.ts` parses into an
 * AST, with the comparison carried beside it rather than inside it.
 *
 * ## Why the sample limit here is lower than the engine's own
 *
 * `signal.ts` will transform a million samples. This door stops at 16384, because everything crossing it is JSON over
 * an IPC channel: a spectrum of a million samples is half a million bins, and serialising that costs far more than
 * computing it. A Page wanting more should decimate first and say so, which is what `signal.decimate` is for.
 *
 * ## The conventions that must not be defaulted quietly
 *
 * Two operations refuse to guess. `frames.to-spherical` requires the convention, because physics and
 * mathematics swap the meanings of theta and phi and a silent default would make half the answers wrong under the
 * other reading. `frames.to-euler` requires the order, because the same three angles in a different order are a
 * different rotation. Both are required parameters rather than optional ones with a default.
 */

import {
  agreeTo,
  combine,
  exact as exactNumber,
  isPrecisionError,
  measured,
  quantifyText,
  readMeasured,
  represent,
  ROUNDING_MODES,
  roundDecimals,
  roundSignificant,
  runChain,
  write,
  type Operation as PrecisionOperation,
  type Quantified,
  type RoundingMode,
  type Step
} from '../../shared/compute/precision.ts'
import {
  asQuantity,
  CONSTANT_KINDS,
  CONSTANTS,
  compareToConstant,
  constantById,
  constantsInCategory,
  constantsOfKind,
  isConstantError,
  KIND_FACTS,
  reportOn,
  searchConstants,
  type Category as ConstantCategory,
  type ConstantKind
} from '../../shared/compute/constants.ts'
import {
  axisAngleOf,
  checkTree,
  CONVENTION_FACTS,
  EULER_ORDERS,
  eulerFromRotation,
  frame,
  fromCylindrical,
  fromPolar,
  fromSpherical,
  isFrameError,
  normaliseQuaternion,
  rotateVector,
  rotationAboutAxis,
  rotationFromEuler,
  rotationMatrix,
  SPHERICAL_CONVENTIONS,
  toCylindrical,
  toPolar,
  toSpherical,
  transformDirection,
  transformPoint,
  type AngleUnit,
  type EulerOrder,
  type Frame,
  type Handedness,
  type Quaternion,
  type SphericalConvention,
  type Vector3
} from '../../shared/compute/frames.ts'
import {
  check as checkConstraints,
  COMPARISONS,
  feasible,
  isConstraintError,
  narrow,
  rank,
  valuesFrom,
  type Comparison,
  type Constraint,
  type Value as ConstraintValue,
  type Values
} from '../../shared/compute/constraints.ts'
import {
  checkFit,
  compareFits,
  evaluateInterpolant,
  FAMILIES,
  FAMILY_FACTS,
  fit,
  interpolant,
  interpolationGrid,
  INTERPOLATION_FACTS,
  INTERPOLATION_KINDS,
  isFitError,
  predictFrom,
  type Family,
  type Fit,
  type InterpolationKind
} from '../../shared/compute/interpolate.ts'
import {
  applyFilter,
  autocorrelation,
  bandPower,
  checkUniform,
  convolve,
  crossCorrelation,
  decimate,
  designFilter,
  detrend,
  differenceSeries,
  exponentialSmoothing,
  isSignalError,
  movingAverage,
  movingMedian,
  peaks,
  resample,
  samplingOf,
  signalFacts,
  spectrum,
  transform as fourier,
  welch,
  windowOf,
  WINDOW_FACTS,
  WINDOW_NAMES,
  type ConvolveMode,
  type Filter,
  type WindowName
} from '../../shared/compute/signal.ts'
import { BadInput, Reader } from './engines.ts'

/** Which capability each operation needs. An operation is reachable only because it is in here. */
export const SCIENCE_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  'signal.sampling': 'computation.science',
  'signal.uniformity': 'computation.science',
  'signal.window': 'computation.science',
  'signal.transform': 'computation.science',
  'signal.spectrum': 'computation.science',
  'signal.peaks': 'computation.science',
  'signal.welch': 'computation.science',
  'signal.band-power': 'computation.science',
  'signal.smooth': 'computation.science',
  'signal.detrend': 'computation.science',
  'signal.difference': 'computation.science',
  'signal.autocorrelation': 'computation.science',
  'signal.cross-correlation': 'computation.science',
  'signal.convolve': 'computation.science',
  'signal.design-filter': 'computation.science',
  'signal.filter': 'computation.science',
  'signal.resample': 'computation.science',
  'signal.decimate': 'computation.science',
  'signal.facts': 'computation.science',

  'interpolate.kinds': 'computation.science',
  'interpolate.build': 'computation.science',
  'interpolate.at': 'computation.science',
  'interpolate.grid': 'computation.science',

  'fit.families': 'computation.science',
  'fit.curve': 'computation.science',
  'fit.predict': 'computation.science',
  'fit.residuals': 'computation.science',
  'fit.compare': 'computation.science',

  'precision.read': 'computation.science',
  'precision.round': 'computation.science',
  'precision.write': 'computation.science',
  'precision.combine': 'computation.science',
  'precision.chain': 'computation.science',
  'precision.represent': 'computation.science',
  'precision.agree': 'computation.science',

  'constants.list': 'computation.science',
  'constants.search': 'computation.science',
  'constants.get': 'computation.science',
  'constants.compare': 'computation.science',

  'frames.to-polar': 'computation.science',
  'frames.from-polar': 'computation.science',
  'frames.to-cylindrical': 'computation.science',
  'frames.from-cylindrical': 'computation.science',
  'frames.to-spherical': 'computation.science',
  'frames.from-spherical': 'computation.science',
  'frames.rotation': 'computation.science',
  'frames.from-euler': 'computation.science',
  'frames.to-euler': 'computation.science',
  'frames.rotate': 'computation.science',
  'frames.check-tree': 'computation.science',
  'frames.transform': 'computation.science',

  'constraints.check': 'computation.science',
  'constraints.feasible': 'computation.science',
  'constraints.narrow': 'computation.science'
})

/** What this door will carry. Deliberately below what the engines themselves handle -- see the note at the top. */
export const SCIENCE_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  samples: 16_384,
  points: 5_000,
  at: 5_000,
  taps: 2_001,
  kernel: 1_024,
  lags: 4_096,
  steps: 200,
  constraints: 500,
  frames: 200,
  names: 64,
  text: 2_000
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

const ANGLE_UNITS = ['radians', 'degrees'] as const

function samplesOf(read: Reader, key = 'values'): number[] {
  return read.numbers(key, SCIENCE_LIMITS.samples)
}

function rateOf(read: Reader, key = 'rateHz'): number {
  const value = read.number(key)
  if (value <= 0) throw new BadInput(`"${key}" has to be a positive number of samples per second.`)
  return value
}

function windowNameOf(read: Reader, key = 'window', fallback: WindowName = 'hann'): WindowName {
  return read.choice(key, WINDOW_NAMES, fallback)
}

function vectorOf(read: Reader, key: string): Vector3 {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object with x, y and z.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return { x: entry.number('x'), y: entry.number('y'), z: entry.number('z') }
}

/**
 * A rotation, however the Page chose to say it.
 *
 * Either a quaternion, or an axis and an angle. Accepting both here rather than making the Page convert keeps the
 * conversion in one place, where the degenerate cases -- a zero-length axis, a zero-length quaternion -- are already
 * refused with a reason.
 */
function rotationOf(read: Reader, key = 'rotation'): Quaternion {
  if (read.has(key)) {
    const raw = read.raw(key)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadInput(`"${key}" has to be an object with w, x, y and z.`)
    }
    const entry = new Reader(raw as Record<string, unknown>)
    const built = normaliseQuaternion({ w: entry.number('w'), x: entry.number('x'), y: entry.number('y'), z: entry.number('z') })
    if (isFrameError(built)) throw new BadInput(built.message)
    return built
  }
  if (read.has('axis')) {
    const built = rotationAboutAxis(vectorOf(read, 'axis'), read.number('angle'), read.choice('unit', ANGLE_UNITS, 'radians'))
    if (isFrameError(built)) throw new BadInput(built.message)
    return built
  }
  throw new BadInput(`Give a rotation, either as "${key}" with w, x, y and z, or as "axis" with "angle".`)
}

function framesOf(read: Reader, key = 'frames'): Frame[] {
  const raw = read.list(key, SCIENCE_LIMITS.frames)
  return raw.map((one) => {
    const entry = new Reader(one)
    const built: Partial<Frame> & { id: string } = { id: entry.text('id', 120) }
    if (entry.has('parent')) {
      const parent = entry.raw('parent')
      built.parent = parent === null ? null : entry.text('parent', 120)
    }
    if (entry.has('translation')) built.translation = vectorOf(entry, 'translation')
    if (entry.has('rotation') || entry.has('axis')) built.rotation = rotationOf(entry)
    if (entry.has('scale')) built.scale = entry.number('scale')
    if (entry.has('handedness')) built.handedness = entry.choice('handedness', ['right', 'left'] as const, 'right') as Handedness
    if (entry.has('describe')) built.describe = entry.text('describe', SCIENCE_LIMITS.text)
    return frame(built)
  })
}

function constraintValueOf(raw: unknown, where: string): ConstraintValue {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput(`${where} has to be a finite number.`)
    return { value: raw, unit: '' }
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const entry = new Reader(raw as Record<string, unknown>)
    return { value: entry.number('value'), unit: entry.optionalText('unit', '', 60) }
  }
  throw new BadInput(`${where} has to be a number, or an object with "value" and "unit".`)
}

function valuesOf(read: Reader, key = 'values'): Values {
  const raw = read.raw(key)
  if (raw === undefined) return valuesFrom({})
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object of named values.`)
  }
  const out = new Map<string, ConstraintValue>()
  const source = raw as Record<string, unknown>
  const names = Object.keys(source)
  if (names.length > SCIENCE_LIMITS.names) throw new BadInput(`"${key}" names more than the ${SCIENCE_LIMITS.names} values allowed.`)
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue
    out.set(name, constraintValueOf(source[name], `"${key}.${name}"`))
  }
  return out
}

function constraintsOf(read: Reader, key = 'constraints'): Constraint[] {
  const raw = read.list(key, SCIENCE_LIMITS.constraints)
  return raw.map((one, i) => {
    const entry = new Reader(one)
    const id = entry.text('id', 120)
    const label = entry.optionalText('label', id, SCIENCE_LIMITS.text)
    const why = entry.has('why') ? entry.text('why', SCIENCE_LIMITS.text) : undefined
    const kind = entry.choice('kind', ['range', 'comparison', 'sum', 'required', 'ordered'] as const, 'range')
    switch (kind) {
      case 'range': {
        const built: Extract<Constraint, { kind: 'range' }> = { kind, id, label, variable: entry.text('variable', 120), why }
        if (entry.has('minimum')) built.minimum = constraintValueOf(entry.raw('minimum'), `constraint ${i + 1} minimum`)
        if (entry.has('maximum')) built.maximum = constraintValueOf(entry.raw('maximum'), `constraint ${i + 1} maximum`)
        if (entry.has('minimumInclusive')) built.minimumInclusive = entry.boolean('minimumInclusive', true)
        if (entry.has('maximumInclusive')) built.maximumInclusive = entry.boolean('maximumInclusive', true)
        return built
      }
      case 'comparison':
        return {
          kind,
          id,
          label,
          why,
          left: entry.text('left', SCIENCE_LIMITS.text),
          comparison: entry.choice('comparison', COMPARISONS, 'less') as Comparison,
          right: entry.text('right', SCIENCE_LIMITS.text),
          tolerance: entry.has('tolerance') ? entry.number('tolerance') : undefined
        }
      case 'sum':
        return {
          kind,
          id,
          label,
          why,
          variables: entry.strings('variables', SCIENCE_LIMITS.names),
          total: constraintValueOf(entry.raw('total'), `constraint ${i + 1} total`),
          tolerance: entry.has('tolerance') ? entry.number('tolerance') : undefined
        }
      case 'required':
        return { kind, id, label, why, variables: entry.strings('variables', SCIENCE_LIMITS.names) }
      case 'ordered':
        return {
          kind,
          id,
          label,
          why,
          variables: entry.strings('variables', SCIENCE_LIMITS.names),
          strict: entry.boolean('strict', false)
        }
    }
  })
}

function quantifiedOf(raw: unknown, where: string): Quantified {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput(`${where} has to be a finite number.`)
    // A bare number with no stated precision is treated as exact, which is what a count or a defined factor is. A
    // measured value has to say how many figures it carries, because nothing else can work that out for it.
    return exactNumber(raw)
  }
  if (typeof raw === 'string') {
    const built = quantifyText(raw)
    if (isPrecisionError(built)) throw new BadInput(built.message)
    return built
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const entry = new Reader(raw as Record<string, unknown>)
    if (entry.has('text')) {
      const built = quantifyText(entry.text('text', 200))
      if (isPrecisionError(built)) throw new BadInput(built.message)
      return built
    }
    const value = entry.number('value')
    if (entry.boolean('exact', false)) return exactNumber(value)
    if (!entry.has('significantFigures')) {
      throw new BadInput(`${where} needs "significantFigures", or "exact": true if it is a count or a defined factor.`)
    }
    const built = measured(
      value,
      Math.round(entry.number('significantFigures')),
      entry.has('decimalPlaces') ? Math.round(entry.number('decimalPlaces')) : undefined
    )
    if (isPrecisionError(built)) throw new BadInput(built.message)
    return built
  }
  throw new BadInput(`${where} has to be a number, a written number as text, or an object with "value".`)
}

/** Builds a fit from the same parameters every fitting operation takes, so they cannot disagree about them. */
function fitFrom(read: Reader): Fit {
  const x = read.numbers('x', SCIENCE_LIMITS.points)
  const y = read.numbers('y', SCIENCE_LIMITS.points)
  const family = read.choice('family', FAMILIES, 'linear') as Family
  const built = fit(x, y, family, {
    degree: read.has('degree') ? Math.round(read.number('degree')) : undefined,
    ceiling: read.has('ceiling') ? read.number('ceiling') : undefined
  })
  if (isFitError(built)) throw new BadInput(built.message)
  return built
}

/** Everything a spectrum operation needs, read once. */
function spectrumFrom(read: Reader): ReturnType<typeof spectrum> {
  return spectrum(samplesOf(read), rateOf(read), {
    window: windowNameOf(read),
    padTo: read.has('padTo') ? Math.round(read.number('padTo')) : undefined,
    removeMean: read.boolean('removeMean', false)
  })
}

function filterFrom(read: Reader): Filter {
  const kind = read.choice('kind', ['low-pass', 'high-pass', 'band-pass', 'band-stop'] as const, 'low-pass')
  const twoEdges = kind === 'band-pass' || kind === 'band-stop'
  const cutoff: number | [number, number] = twoEdges
    ? (() => {
        // Checked before the reader sees it: sending one number here is the ordinary mistake, and "has to be a list"
        // does not say that a band filter takes a low edge and a high one.
        if (!Array.isArray(read.raw('cutoffHz'))) {
          throw new BadInput(`A ${kind} filter needs two cutoff frequencies in "cutoffHz", a low edge and a high one.`)
        }
        const edges = read.numbers('cutoffHz', 2)
        if (edges.length !== 2) throw new BadInput(`A ${kind} filter needs two cutoff frequencies in "cutoffHz", a low edge and a high one.`)
        return [edges[0] as number, edges[1] as number] as [number, number]
      })()
    : read.number('cutoffHz')
  const taps = Math.round(read.optionalNumber('taps', 101))
  if (taps > SCIENCE_LIMITS.taps) throw new BadInput(`"taps" is more than the ${SCIENCE_LIMITS.taps} allowed.`)
  const built = designFilter(kind, cutoff, rateOf(read), taps, windowNameOf(read, 'window', 'hamming'))
  if (isFrameError(built) || isSignalError(built)) throw new BadInput((built as { message: string }).message)
  return built
}

// ---------------------------------------------------------------- dispatch

export function runScienceOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- signals
    case 'signal.sampling':
      return settle(samplingOf(Math.round(read.number('count')), rateOf(read)), isSignalError)

    case 'signal.uniformity':
      return settle(
        checkUniform(read.numbers('times', SCIENCE_LIMITS.samples), read.optionalNumber('tolerance', 0.01)),
        isSignalError
      )

    case 'signal.window': {
      const name = windowNameOf(read, 'name', 'hann')
      const built = windowOf(name, Math.round(read.optionalNumber('length', 64)))
      if (isSignalError(built)) return { ok: false, ...built }
      return { ok: true, ...built, facts: WINDOW_FACTS[name], all: WINDOW_NAMES.map((one) => WINDOW_FACTS[one]) }
    }

    case 'signal.transform': {
      const real = samplesOf(read, 'real')
      const imaginary = read.has('imaginary') ? read.numbers('imaginary', SCIENCE_LIMITS.samples) : new Array<number>(real.length).fill(0)
      return settle(fourier({ re: real, im: imaginary }), isSignalError)
    }

    case 'signal.spectrum':
      return settle(spectrumFrom(read), isSignalError)

    case 'signal.peaks': {
      const built = spectrumFrom(read)
      if (isSignalError(built)) return { ok: false, ...built }
      return {
        ok: true,
        peaks: peaks(built, {
          minimumAboveMedian: read.optionalNumber('minimumAboveMedian', 3),
          limit: Math.round(read.optionalNumber('limit', 10)),
          skipDc: read.boolean('skipDc', true)
        }),
        sampling: built.sampling,
        window: built.window,
        caveats: built.caveats
      }
    }

    case 'signal.welch':
      return settle(
        welch(samplesOf(read), rateOf(read), {
          segmentLength: Math.round(read.number('segmentLength')),
          overlap: read.has('overlap') ? read.number('overlap') : undefined,
          window: windowNameOf(read),
          removeMean: read.boolean('removeMean', true)
        }),
        isSignalError
      )

    case 'signal.band-power': {
      const built = spectrumFrom(read)
      if (isSignalError(built)) return { ok: false, ...built }
      return settle(bandPower(built, read.number('lowHz'), read.number('highHz')), isSignalError)
    }

    case 'signal.smooth': {
      const values = samplesOf(read)
      const method = read.choice('method', ['moving-average', 'moving-median', 'exponential'] as const, 'moving-average')
      if (method === 'exponential') return settle(exponentialSmoothing(values, read.number('alpha')), isSignalError)
      const window = Math.round(read.number('window'))
      return settle(
        method === 'moving-median'
          ? movingMedian(values, window)
          : movingAverage(values, window, { centred: read.boolean('centred', true) }),
        isSignalError
      )
    }

    case 'signal.detrend':
      return settle(detrend(samplesOf(read), read.choice('kind', ['mean', 'linear'] as const, 'linear')), isSignalError)

    case 'signal.difference': {
      const built = differenceSeries(samplesOf(read), Math.round(read.optionalNumber('lag', 1)))
      return isSignalError(built) ? { ok: false, ...built } : { ok: true, values: built }
    }

    case 'signal.autocorrelation':
      return settle(
        autocorrelation(samplesOf(read), read.has('maximumLag') ? Math.round(read.number('maximumLag')) : undefined),
        isSignalError
      )

    case 'signal.cross-correlation':
      return settle(
        crossCorrelation(
          read.numbers('a', SCIENCE_LIMITS.samples),
          read.numbers('b', SCIENCE_LIMITS.samples),
          read.has('maximumLag') ? Math.round(read.number('maximumLag')) : undefined
        ),
        isSignalError
      )

    case 'signal.convolve': {
      const built = convolve(
        samplesOf(read),
        read.numbers('kernel', SCIENCE_LIMITS.kernel),
        read.choice('mode', ['full', 'same', 'valid'] as const, 'full') as ConvolveMode
      )
      return isSignalError(built) ? { ok: false, ...built } : { ok: true, values: built }
    }

    case 'signal.design-filter':
      return { ok: true, ...filterFrom(read) }

    case 'signal.filter':
      return settle(applyFilter(samplesOf(read), filterFrom(read)), isSignalError)

    case 'signal.resample':
      return settle(
        resample(
          read.numbers('times', SCIENCE_LIMITS.samples),
          samplesOf(read),
          read.numbers('newTimes', SCIENCE_LIMITS.at)
        ),
        isSignalError
      )

    case 'signal.decimate':
      return settle(
        decimate(samplesOf(read), Math.round(read.number('factor')), rateOf(read), read.boolean('filteredFirst', false)),
        isSignalError
      )

    case 'signal.facts':
      return settle(signalFacts(samplesOf(read)), isSignalError)

    // ---------------------------------------------------------------- interpolation
    case 'interpolate.kinds':
      return { ok: true, kinds: INTERPOLATION_KINDS.map((one) => ({ kind: one, ...INTERPOLATION_FACTS[one] })) }

    case 'interpolate.build':
    case 'interpolate.at':
    case 'interpolate.grid': {
      const x = read.numbers('x', SCIENCE_LIMITS.points)
      const y = read.numbers('y', SCIENCE_LIMITS.points)
      const kind = read.choice('kind', INTERPOLATION_KINDS, 'linear') as InterpolationKind
      const endSlopes = read.has('endSlopes')
        ? (() => {
            const pair = read.numbers('endSlopes', 2)
            if (pair.length !== 2) throw new BadInput('"endSlopes" has to be two numbers.')
            return [pair[0] as number, pair[1] as number] as [number, number]
          })()
        : undefined
      const built = interpolant(x, y, kind, { endSlopes })
      if (isFitError(built)) return { ok: false, ...built }
      // The segments are working, not an answer -- a Page wants the curve, and shipping the coefficients back with it
      // doubles the payload for something no screen shows.
      const summary = {
        kind: built.kind,
        xMin: built.xMin,
        xMax: built.xMax,
        yMin: built.yMin,
        yMax: built.yMax,
        overshoot: built.overshoot,
        describe: built.describe,
        caveats: built.caveats
      }
      if (operation === 'interpolate.build') return { ok: true, ...summary }
      const evaluated =
        operation === 'interpolate.grid'
          ? interpolationGrid(built, Math.round(read.optionalNumber('count', 200)))
          : evaluateInterpolant(built, read.numbers('at', SCIENCE_LIMITS.at))
      if (isFitError(evaluated)) return { ok: false, ...evaluated }
      return { ok: true, ...summary, ...evaluated }
    }

    // ---------------------------------------------------------------- fitting
    case 'fit.families':
      return { ok: true, families: FAMILIES.map((one) => ({ family: one, ...FAMILY_FACTS[one] })) }

    case 'fit.curve':
      return { ok: true, ...fitFrom(read) }

    case 'fit.predict': {
      const built = fitFrom(read)
      const predicted = predictFrom(built, read.numbers('at', SCIENCE_LIMITS.at))
      if (isFitError(predicted)) return { ok: false, ...predicted }
      return { ok: true, equation: built.equation, family: built.family, ...predicted }
    }

    case 'fit.residuals': {
      const built = fitFrom(read)
      const checked = checkFit(built, read.numbers('x', SCIENCE_LIMITS.points))
      if (isFitError(checked)) return { ok: false, ...checked }
      return { ok: true, equation: built.equation, rSquared: built.rSquared, ...checked }
    }

    case 'fit.compare': {
      const x = read.numbers('x', SCIENCE_LIMITS.points)
      const y = read.numbers('y', SCIENCE_LIMITS.points)
      const wanted = read.list('families', FAMILIES.length * 4)
      if (wanted.length === 0) throw new BadInput('"families" has to name at least one family to compare.')
      const built: Fit[] = []
      const refused: { family: string; message: string }[] = []
      for (const one of wanted) {
        const entry = new Reader(one)
        const family = entry.choice('family', FAMILIES, 'linear') as Family
        const made = fit(x, y, family, {
          degree: entry.has('degree') ? Math.round(entry.number('degree')) : undefined,
          ceiling: entry.has('ceiling') ? entry.number('ceiling') : undefined
        })
        // One family that does not suit the data -- a power law through a zero, say -- should not stop the others
        // being compared. It is reported rather than dropped, so the table is not quietly shorter than it was asked
        // to be.
        if (isFitError(made)) refused.push({ family, message: made.message })
        else built.push(made)
      }
      if (built.length === 0) return { ok: false, error: 'no-fit', message: 'No family could be fitted to these points.', refused }
      const comparison = compareFits(built)
      if (isFitError(comparison)) return { ok: false, ...comparison }
      return { ok: true, ...comparison, refused, fits: built.map((one) => ({ family: one.family, degree: one.degree, equation: one.equation })) }
    }

    // ---------------------------------------------------------------- precision
    case 'precision.read':
      return settle(readMeasured(read.text('text', 200)), isPrecisionError)

    case 'precision.round': {
      const value = read.number('value')
      const mode = read.choice('mode', ROUNDING_MODES, 'half-even') as RoundingMode
      const built = read.has('decimals')
        ? roundDecimals(value, Math.round(read.number('decimals')), mode)
        : roundSignificant(value, Math.round(read.number('figures')), mode)
      return isPrecisionError(built) ? { ok: false, ...built } : { ok: true, value: built, mode }
    }

    case 'precision.write':
      return settle(
        write(
          read.number('value'),
          Math.round(read.number('figures')),
          read.choice('notation', ['plain', 'scientific', 'engineering'] as const, 'plain')
        ),
        isPrecisionError
      )

    case 'precision.combine':
      return settle(
        combine(
          quantifiedOf(read.raw('a'), '"a"'),
          quantifiedOf(read.raw('b'), '"b"'),
          read.choice('operation', ['add', 'subtract', 'multiply', 'divide', 'power'] as const, 'add') as PrecisionOperation
        ),
        isPrecisionError
      )

    case 'precision.chain': {
      const steps: Step[] = read.list('steps', SCIENCE_LIMITS.steps).map((one, i) => {
        const entry = new Reader(one)
        return {
          operation: entry.choice('operation', ['add', 'subtract', 'multiply', 'divide', 'power'] as const, 'add') as PrecisionOperation,
          operand: quantifiedOf(entry.raw('operand'), `step ${i + 1} operand`)
        }
      })
      return settle(runChain(quantifiedOf(read.raw('start'), '"start"'), steps), isPrecisionError)
    }

    case 'precision.represent':
      return settle(represent(read.number('value')), isPrecisionError)

    case 'precision.agree':
      return settle(agreeTo(read.number('a'), read.number('b'), Math.round(read.number('figures'))), isPrecisionError)

    // ---------------------------------------------------------------- constants
    case 'constants.list': {
      const kind = read.has('kind') ? (read.choice('kind', CONSTANT_KINDS, 'measured') as ConstantKind) : null
      const category = read.has('category')
        ? (read.choice(
            'category',
            ['universal', 'electromagnetic', 'atomic', 'thermodynamic', 'mechanical', 'mathematical'] as const,
            'universal'
          ) as ConstantCategory)
        : null
      let found = [...CONSTANTS]
      if (kind !== null) found = found.filter((one) => constantsOfKind(kind).includes(one))
      if (category !== null) found = found.filter((one) => constantsInCategory(category).includes(one))
      return { ok: true, constants: found, kinds: CONSTANT_KINDS.map((one) => ({ kind: one, ...KIND_FACTS[one] })) }
    }

    case 'constants.search':
      return { ok: true, constants: searchConstants(read.optionalText('text', '', 200)) }

    case 'constants.get': {
      const one = constantById(read.text('id', 120))
      if (isConstantError(one)) return { ok: false, ...one }
      const report = reportOn(one.id)
      if (isConstantError(report)) return { ok: false, ...report }
      const asUnit = asQuantity(one)
      return {
        ok: true,
        constant: one,
        truncated: report.truncated,
        publishedFigures: report.publishedFigures,
        limitsResultsTo: report.limitsResultsTo,
        caveats: report.caveats,
        quantity: isConstantError(asUnit) ? null : asUnit
      }
    }

    case 'constants.compare':
      return settle(
        compareToConstant(read.text('id', 120), read.number('value'), read.optionalNumber('uncertainty', 0)),
        isConstantError
      )

    // ---------------------------------------------------------------- frames
    case 'frames.to-polar':
      return settle(toPolar({ x: read.number('x'), y: read.number('y') }, read.choice('unit', ANGLE_UNITS, 'radians')), isFrameError)

    case 'frames.from-polar': {
      const built = fromPolar(read.number('radius'), read.number('angle'), read.choice('unit', ANGLE_UNITS, 'radians'))
      return isFrameError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'frames.to-cylindrical':
      return settle(toCylindrical(vectorOf(read, 'point'), read.choice('unit', ANGLE_UNITS, 'radians')), isFrameError)

    case 'frames.from-cylindrical': {
      const built = fromCylindrical(
        read.number('radius'),
        read.number('azimuth'),
        read.number('height'),
        read.choice('unit', ANGLE_UNITS, 'radians')
      )
      return isFrameError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'frames.to-spherical': {
      // No default: the two conventions swap theta and phi, so guessing makes half the answers wrong silently.
      if (!read.has('convention')) {
        throw new BadInput(
          `"convention" is required: it has to be "physics" (theta is the polar angle, the ISO reading) or "mathematics" (theta is the azimuth). The two swap the meanings of the same two letters, so there is no safe default.`
        )
      }
      const convention = read.choice('convention', SPHERICAL_CONVENTIONS, 'physics') as SphericalConvention
      const built = toSpherical(vectorOf(read, 'point'), convention, read.choice('unit', ANGLE_UNITS, 'radians'))
      if (isFrameError(built)) return { ok: false, ...built }
      return { ok: true, ...built, conventions: SPHERICAL_CONVENTIONS.map((one) => ({ convention: one, ...CONVENTION_FACTS[one] })) }
    }

    case 'frames.from-spherical': {
      const built = fromSpherical(
        read.number('radius'),
        read.number('polar'),
        read.number('azimuth'),
        read.choice('unit', ANGLE_UNITS, 'radians')
      )
      return isFrameError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'frames.rotation': {
      const unit = read.choice('unit', ANGLE_UNITS, 'radians') as AngleUnit
      const rotation = rotationOf(read)
      const axisAngle = axisAngleOf(rotation, unit)
      const matrix = rotationMatrix(rotation)
      if (isFrameError(axisAngle)) return { ok: false, ...axisAngle }
      if (isFrameError(matrix)) return { ok: false, ...matrix }
      return { ok: true, rotation, axisAngle, matrix }
    }

    case 'frames.from-euler': {
      const angles = read.numbers('angles', 3)
      if (angles.length !== 3) throw new BadInput('"angles" has to be exactly three numbers.')
      const built = rotationFromEuler(
        [angles[0] as number, angles[1] as number, angles[2] as number],
        read.choice('order', EULER_ORDERS, 'zyx') as EulerOrder,
        read.choice('unit', ANGLE_UNITS, 'radians')
      )
      if (isFrameError(built)) return { ok: false, ...built }
      const matrix = rotationMatrix(built)
      return { ok: true, rotation: built, matrix: isFrameError(matrix) ? null : matrix }
    }

    case 'frames.to-euler': {
      // No default: the same three angles in a different order are a different rotation.
      if (!read.has('order')) {
        throw new BadInput(`"order" is required: it has to be one of ${EULER_ORDERS.join(' or ')}. The same three angles in a different order describe a different rotation, so there is no safe default.`)
      }
      return settle(
        eulerFromRotation(
          rotationOf(read),
          read.choice('order', EULER_ORDERS, 'zyx') as EulerOrder,
          read.choice('unit', ANGLE_UNITS, 'radians')
        ),
        isFrameError
      )
    }

    case 'frames.rotate': {
      const built = rotateVector(rotationOf(read), vectorOf(read, 'point'))
      return isFrameError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'frames.check-tree': {
      const result = checkTree(framesOf(read))
      // `usable` rather than `ok`: the envelope already has an `ok`, and spreading one over the other would make the
      // reply say the opposite of what the check found.
      const { usable, ...rest } = result
      return { ok: true, usable, ...rest }
    }

    case 'frames.transform': {
      const frames = framesOf(read)
      const point = vectorOf(read, 'point')
      const from = read.text('from', 120)
      const to = read.text('to', 120)
      const built =
        read.choice('what', ['point', 'direction'] as const, 'point') === 'direction'
          ? transformDirection(frames, point, from, to)
          : transformPoint(frames, point, from, to)
      return settle(built, isFrameError)
    }

    // ---------------------------------------------------------------- constraints
    case 'constraints.check': {
      const result = checkConstraints(constraintsOf(read), valuesOf(read))
      if (isConstraintError(result)) return { ok: false, ...result }
      return { ok: true, ...result, ranked: rank(result).map((one) => one.constraintId) }
    }

    case 'constraints.feasible': {
      const result = feasible(constraintsOf(read))
      if (isConstraintError(result)) return { ok: false, ...result }
      // `possible` carries its own meaning and must not be folded into the envelope's `ok`.
      const { possible, ...rest } = result
      return { ok: true, possible, ...rest }
    }

    case 'constraints.narrow':
      return settle(narrow(constraintsOf(read)), isConstraintError)

    default:
      // Reached only when an operation has a capability in the map above and no case here, which the caller could not
      // have caused: the capability check ran before this and let it through.
      throw new BadInput(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
  }
}
