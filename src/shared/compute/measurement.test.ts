import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MEASUREMENT_ASSUMPTIONS,
  NO_UNCERTAINTY,
  addMeasurements,
  agree,
  asStandard,
  boundUncertainty,
  combineProvenance,
  convertMeasurement,
  coverageFactorFor,
  describeMeasurement,
  divideMeasurements,
  expandedUncertainty,
  fromRepeated,
  interval,
  isMeasurementError,
  measurement,
  multiplyMeasurements,
  powerMeasurement,
  propagateByMonteCarlo,
  relativeUncertainty,
  reportMeasurement,
  scaleMeasurement,
  significantFigures,
  standardUncertainty,
  subtractMeasurements,
  toSignificantFigures,
  type Measurement
} from './measurement.ts'

/** A measurement, or a thrown assertion. Keeps the tests about the behaviour rather than about narrowing. */
const make = (value: number, unit: string, options?: Parameters<typeof measurement>[2]): Measurement => {
  const one = measurement(value, unit, options)
  assert.ok(!isMeasurementError(one), `expected a measurement, got ${JSON.stringify(one)}`)
  return one
}

/** Narrows a result-or-error away from the error arm, so the tests read as assertions about the answer. */
const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isMeasurementError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

describe('provenance', () => {
  it('never lets a simulated value be laundered into a measured one', () => {
    assert.equal(combineProvenance('measured', 'simulated'), 'simulated')
    assert.equal(combineProvenance('simulated', 'measured'), 'simulated')
    assert.equal(combineProvenance('simulated', 'assumed'), 'simulated')
  })

  it('reports unknown when either side is unknown', () => {
    assert.equal(combineProvenance('measured', 'unknown'), 'unknown')
  })

  it('calls the combination of two measurements derived, not measured', () => {
    assert.equal(combineProvenance('measured', 'measured'), 'derived')
  })

  it('defaults a new measurement to unknown rather than guessing it was measured', () => {
    assert.equal(make(1, 'm').provenance, 'unknown')
  })

  it('carries provenance through multiplication', () => {
    const a = make(2, 'm', { provenance: 'measured' })
    const b = make(3, 'm', { provenance: 'simulated' })
    assert.equal(ok(multiplyMeasurements(a, b)).provenance, 'simulated')
  })
})

describe('uncertainty kinds', () => {
  it('divides an expanded uncertainty by its coverage factor', () => {
    assert.equal(asStandard(expandedUncertainty(0.4, 2)), 0.2)
  })

  it('treats a bound as rectangular, so the standard uncertainty is smaller than the bound', () => {
    const standard = asStandard(boundUncertainty(0.5))
    assert.ok(Math.abs(standard - 0.5 / Math.sqrt(3)) < 1e-12)
    assert.ok(standard < 0.5)
  })

  it('passes a standard uncertainty through unchanged', () => {
    assert.equal(asStandard(standardUncertainty(0.3)), 0.3)
  })

  it('reports zero for no uncertainty', () => {
    assert.equal(asStandard(NO_UNCERTAINTY), 0)
  })

  it('refuses a negative uncertainty', () => {
    const bad = measurement(1, 'm', { uncertainty: standardUncertainty(-1) })
    // standardUncertainty takes the absolute value, so this is about the raw object path.
    assert.ok(!isMeasurementError(bad))
    const raw = measurement(1, 'm', { uncertainty: { value: -1, kind: 'standard', coverageFactor: 1, source: 'stated' } })
    assert.ok(isMeasurementError(raw))
    assert.equal(raw.error, 'invalid-argument')
  })
})

describe('making a measurement', () => {
  it('needs a unit it understands', () => {
    const bad = measurement(1, 'furlongs per fortnight per banana')
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'invalid-argument')
  })

  it('refuses a value that is not finite', () => {
    const bad = measurement(Number.NaN, 'm')
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('accepts a plain number as a standard uncertainty', () => {
    assert.equal(make(5, 'm', { uncertainty: 0.1 }).uncertainty.kind, 'standard')
  })

  it('keeps resolution separate from uncertainty', () => {
    const one = make(12.3, 'mm', { resolution: 0.1, uncertainty: 0.05 })
    assert.equal(one.resolution, 0.1)
    assert.equal(one.uncertainty.value, 0.05)
  })

  it('drops a resolution of zero, which means nothing', () => {
    assert.equal(make(1, 'm', { resolution: 0 }).resolution, null)
  })

  it('reports a relative uncertainty as a fraction of the value', () => {
    assert.ok(Math.abs((relativeUncertainty(make(200, 'm', { uncertainty: 2 })) ?? 0) - 0.01) < 1e-12)
  })

  it('has no relative uncertainty at zero, where the idea is meaningless', () => {
    assert.equal(relativeUncertainty(make(0, 'm', { uncertainty: 1 })), null)
  })

  it('reports the interval a measurement covers', () => {
    assert.deepEqual(interval(make(10, 'm', { uncertainty: 0.5 })), { low: 9.5, high: 10.5 })
  })
})

describe('addition and subtraction', () => {
  it('refuses to add a length to a mass', () => {
    const bad = addMeasurements(make(1, 'm'), make(1, 'kg'))
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'dimension-mismatch')
  })

  it('combines uncertainties in quadrature, not by adding them', () => {
    const sum = ok(addMeasurements(make(3, 'm', { uncertainty: 0.3 }), make(4, 'm', { uncertainty: 0.4 })))
    assert.equal(sum.value, 7)
    // √(0.09 + 0.16) = 0.5, which is less than 0.7.
    assert.ok(Math.abs(sum.uncertainty.value - 0.5) < 1e-12)
  })

  it('converts the second value and its uncertainty into the first unit', () => {
    const sum = ok(addMeasurements(make(1, 'm', { uncertainty: 0.01 }), make(50, 'cm', { uncertainty: 1 })))
    assert.ok(Math.abs(sum.value - 1.5) < 1e-12)
    // 1 cm is 0.01 m, so the combination is √(0.0001 + 0.0001).
    assert.ok(Math.abs(sum.uncertainty.value - Math.sqrt(0.0002)) < 1e-12)
  })

  it('makes fully correlated uncertainties add rather than combine in quadrature', () => {
    const sum = ok(addMeasurements(make(1, 'm', { uncertainty: 0.1 }), make(1, 'm', { uncertainty: 0.1 }), 1))
    assert.ok(Math.abs(sum.uncertainty.value - 0.2) < 1e-12)
  })

  it('refuses a correlation outside -1 to 1', () => {
    const bad = addMeasurements(make(1, 'm'), make(1, 'm'), 2)
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'invalid-argument')
  })

  it('subtracts, and the uncertainty still grows', () => {
    const difference = ok(subtractMeasurements(make(10, 'm', { uncertainty: 0.3 }), make(9, 'm', { uncertainty: 0.4 })))
    assert.ok(Math.abs(difference.value - 1) < 1e-12)
    assert.ok(Math.abs(difference.uncertainty.value - 0.5) < 1e-12)
  })

  it('subtracts temperatures without letting the Celsius offset land on the wrong side', () => {
    const difference = ok(subtractMeasurements(make(20, 'degC'), make(5, 'degC')))
    assert.ok(Math.abs(difference.value - 15) < 1e-9)
  })

  it('refuses to subtract a mass from a length', () => {
    const bad = subtractMeasurements(make(1, 'm'), make(1, 'kg'))
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'dimension-mismatch')
  })
})

describe('multiplication, division and powers', () => {
  it('combines relative uncertainties in quadrature, so 1% by 1% is about 1.4%', () => {
    const product = ok(multiplyMeasurements(make(100, 'm', { uncertainty: 1 }), make(100, 'm', { uncertainty: 1 })))
    assert.equal(product.value, 10_000)
    const relative = relativeUncertainty(product) ?? 0
    assert.ok(Math.abs(relative - Math.sqrt(0.0002)) < 1e-9)
  })

  it('multiplies the dimensions too', () => {
    const product = ok(multiplyMeasurements(make(2, 'm'), make(3, 'm')))
    assert.equal(product.unit.dimension.L, 2)
  })

  it('falls back to the first-order term when a value is zero', () => {
    const product = ok(multiplyMeasurements(make(0, 'm', { uncertainty: 0.1 }), make(5, 'm', { uncertainty: 0.2 })))
    assert.equal(product.value, 0)
    // 5 * 0.1 + 0 * 0.2
    assert.ok(Math.abs(product.uncertainty.value - 0.5) < 1e-12)
  })

  it('divides and inverts the dimension', () => {
    const rate = ok(divideMeasurements(make(100, 'm', { uncertainty: 1 }), make(10, 's', { uncertainty: 0.1 })))
    assert.ok(Math.abs(rate.value - 10) < 1e-12)
    assert.equal(rate.unit.dimension.L, 1)
    assert.equal(rate.unit.dimension.T, -1)
    // Both sides are 1%, so the result is about 1.414%.
    assert.ok(Math.abs((relativeUncertainty(rate) ?? 0) - Math.sqrt(0.0002)) < 1e-9)
  })

  it('refuses to divide by zero', () => {
    const bad = divideMeasurements(make(1, 'm'), make(0, 's'))
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'invalid-argument')
  })

  it('doubles the relative uncertainty when squaring', () => {
    const squared = ok(powerMeasurement(make(10, 'm', { uncertainty: 0.2 }), 2))
    assert.equal(squared.value, 100)
    // 2% becomes 4%.
    assert.ok(Math.abs((relativeUncertainty(squared) ?? 0) - 0.04) < 1e-12)
  })

  it('halves the relative uncertainty when taking a square root', () => {
    const root = ok(powerMeasurement(make(100, 'm', { uncertainty: 2 }), 0.5))
    assert.equal(root.value, 10)
    assert.ok(Math.abs((relativeUncertainty(root) ?? 0) - 0.01) < 1e-12)
  })

  it('refuses a fractional power of a negative measurement', () => {
    const bad = powerMeasurement(make(-4, 'm'), 0.5)
    assert.ok(isMeasurementError(bad))
  })

  it('refuses zero to a negative power', () => {
    assert.ok(isMeasurementError(powerMeasurement(make(0, 'm'), -1)))
  })

  it('leaves the relative uncertainty alone when scaling by an exact factor', () => {
    const scaled = ok(scaleMeasurement(make(10, 'm', { uncertainty: 0.1 }), 3))
    assert.equal(scaled.value, 30)
    assert.ok(Math.abs(scaled.uncertainty.value - 0.3) < 1e-12)
    assert.ok(Math.abs((relativeUncertainty(scaled) ?? 0) - 0.01) < 1e-12)
  })

  it('marks a derived value as derived rather than leaving it measured', () => {
    assert.equal(ok(powerMeasurement(make(2, 'm', { provenance: 'measured' }), 2)).provenance, 'derived')
  })
})

describe('converting', () => {
  it('scales the uncertainty with the value', () => {
    const converted = ok(convertMeasurement(make(1, 'm', { uncertainty: 0.01 }), 'cm'))
    assert.ok(Math.abs(converted.value - 100) < 1e-9)
    assert.ok(Math.abs(converted.uncertainty.value - 1) < 1e-9)
  })

  it('scales the resolution too', () => {
    const converted = ok(convertMeasurement(make(1, 'm', { resolution: 0.001 }), 'mm'))
    assert.ok(Math.abs((converted.resolution ?? 0) - 1) < 1e-9)
  })

  it('does not apply a temperature offset to the uncertainty, because a ± is a difference', () => {
    const converted = ok(convertMeasurement(make(100, 'degC', { uncertainty: 1 }), 'K'))
    assert.ok(Math.abs(converted.value - 373.15) < 1e-9)
    // One degree Celsius of spread is one kelvin of spread. Not 274.15.
    assert.ok(Math.abs(converted.uncertainty.value - 1) < 1e-9)
  })

  it('keeps the kind of uncertainty when converting', () => {
    const converted = ok(convertMeasurement(make(1, 'm', { uncertainty: expandedUncertainty(0.02, 2) }), 'cm'))
    assert.equal(converted.uncertainty.kind, 'expanded')
    assert.equal(converted.uncertainty.coverageFactor, 2)
  })

  it('refuses an incompatible target', () => {
    assert.ok(isMeasurementError(convertMeasurement(make(1, 'm'), 'kg')))
  })
})

describe('agreement', () => {
  it('finds two overlapping measurements consistent', () => {
    const result = ok(agree(make(9.81, 'm/s^2', { uncertainty: 0.02 }), make(9.79, 'm/s^2', { uncertainty: 0.03 })))
    assert.equal(result.agree, true)
    assert.match(result.describe, /consistent/)
  })

  it('finds two far-apart measurements inconsistent', () => {
    const result = ok(agree(make(9.81, 'm/s^2', { uncertainty: 0.01 }), make(9.2, 'm/s^2', { uncertainty: 0.01 })))
    assert.equal(result.agree, false)
    assert.match(result.describe, /not consistent/)
  })

  it('compares across units', () => {
    const result = ok(agree(make(1, 'm', { uncertainty: 0.01 }), make(100.5, 'cm', { uncertainty: 1 })))
    assert.equal(result.agree, true)
  })

  it('refuses to compare different kinds of thing', () => {
    assert.ok(isMeasurementError(agree(make(1, 'm'), make(1, 's'))))
  })

  it('reports an infinite separation for two exact values that differ', () => {
    const result = ok(agree(make(1, 'm'), make(2, 'm')))
    assert.equal(result.agree, false)
    assert.equal(result.separation, Number.POSITIVE_INFINITY)
  })

  it('reports zero separation for two identical exact values', () => {
    assert.equal(ok(agree(make(1, 'm'), make(1, 'm'))).separation, 0)
  })
})

describe('repeated readings', () => {
  it('uses the standard error of the mean, not the spread', () => {
    const result = ok(fromRepeated([10, 12, 11, 13, 9], 'm'))
    assert.equal(result.readings, 5)
    assert.ok(Math.abs(result.measurement.value - 11) < 1e-12)
    // Sample standard deviation of these five is √2.5.
    assert.ok(Math.abs(result.spread - Math.sqrt(2.5)) < 1e-12)
    assert.ok(Math.abs(result.measurement.uncertainty.value - Math.sqrt(2.5) / Math.sqrt(5)) < 1e-12)
    assert.ok(result.measurement.uncertainty.value < result.spread)
  })

  it('says outright that a systematic error does not show up', () => {
    const result = ok(fromRepeated([1, 2, 3], 'm'))
    assert.ok(result.notes.some((note) => /systematic/.test(note)))
  })

  it('refuses to claim zero uncertainty from a single reading', () => {
    const result = ok(fromRepeated([5], 'm'))
    assert.equal(result.measurement.uncertainty.source, 'none')
    assert.ok(result.notes.some((note) => /One reading only/.test(note)))
  })

  it('reports how many non-numbers were left out', () => {
    const result = ok(fromRepeated([1, 2, Number.NaN, 3], 'm'))
    assert.equal(result.readings, 3)
    assert.ok(result.notes.some((note) => /were not numbers/.test(note)))
  })

  it('refuses an empty set of readings', () => {
    const bad = fromRepeated([], 'm')
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'no-values')
  })

  it('marks the result as measured by default, because that is what repeated readings are', () => {
    assert.equal(ok(fromRepeated([1, 2], 'm')).measurement.provenance, 'measured')
  })
})

describe('significant figures', () => {
  it('counts a trailing zero after a decimal point', () => {
    assert.equal(significantFigures('1.50').figures, 3)
    assert.equal(significantFigures('1.5').figures, 2)
  })

  it('calls a whole number with trailing zeros ambiguous', () => {
    const result = significantFigures('1500')
    assert.equal(result.ambiguous, true)
    assert.equal(result.figures, 2)
  })

  it('is not ambiguous when scientific notation says how many', () => {
    assert.equal(significantFigures('1.500e3').ambiguous, false)
    assert.equal(significantFigures('1.500e3').figures, 4)
  })

  it('ignores leading zeros', () => {
    assert.equal(significantFigures('0.00340').figures, 3)
  })

  it('reports nothing for text that is not a number', () => {
    assert.equal(significantFigures('about nine').figures, 0)
  })

  it('rounds to a number of significant figures', () => {
    assert.equal(toSignificantFigures(1234.5, 3), 1230)
    assert.equal(toSignificantFigures(0.0012345, 2), 0.0012)
    assert.equal(toSignificantFigures(0, 3), 0)
  })
})

describe('reporting', () => {
  it('rounds the value to the uncertainty rather than showing digits nobody knows', () => {
    const report = reportMeasurement(make(9.8123456, 'm/s^2', { uncertainty: 0.02 }))
    assert.equal(report, '9.812 ± 0.020 m/s^2')
  })

  it('uses one figure on the uncertainty when its leading digit is large', () => {
    const report = reportMeasurement(make(123.456, 'm', { uncertainty: 7 }))
    assert.equal(report, '123 ± 7 m')
  })

  it('marks an expanded uncertainty with its coverage factor', () => {
    assert.match(reportMeasurement(make(10, 'm', { uncertainty: expandedUncertainty(0.2, 2) })), /k=2/)
  })

  it('marks a bound as a bound', () => {
    assert.match(reportMeasurement(make(10, 'm', { uncertainty: boundUncertainty(0.5) })), /bound/)
  })

  it('says that a missing uncertainty does not mean exact', () => {
    const lines = describeMeasurement(make(10, 'm'))
    assert.ok(lines.some((line) => /does not mean the value is exact/.test(line)))
  })

  it('states where the value came from', () => {
    assert.ok(describeMeasurement(make(1, 'm', { provenance: 'simulated' })).some((line) => /simulated/.test(line)))
  })

  it('says that resolution is not uncertainty', () => {
    const lines = describeMeasurement(make(1, 'mm', { resolution: 0.1, uncertainty: 0.05 }))
    assert.ok(lines.some((line) => /Resolution is not uncertainty/.test(line)))
  })

  it('includes the note when there is one', () => {
    assert.ok(describeMeasurement(make(1, 'm', { note: 'vernier caliper' })).includes('vernier caliper'))
  })
})

describe('Monte Carlo propagation', () => {
  it('agrees with linear propagation for a linear combination', () => {
    const result = ok(
      propagateByMonteCarlo(
        [make(10, 'm', { uncertainty: 0.1 }), make(20, 'm', { uncertainty: 0.2 })],
        ([a, b]) => a + b,
        { samples: 40_000, seed: 7 }
      )
    )
    // √(0.01 + 0.04) ≈ 0.2236
    assert.ok(Math.abs(result.uncertainty.value - Math.sqrt(0.05)) < 0.01)
    assert.ok((result.agreementWithAnalytic ?? 0) > 0.9 && (result.agreementWithAnalytic ?? 0) < 1.1)
  })

  it('is reproducible from the seed', () => {
    const inputs = [make(5, 'm', { uncertainty: 0.5 })]
    const a = ok(propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 5000, seed: 42 }))
    const b = ok(propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 5000, seed: 42 }))
    assert.equal(a.uncertainty.value, b.uncertainty.value)
    assert.equal(a.interval.low, b.interval.low)
  })

  it('gives a different answer for a different seed, because it is sampling', () => {
    const inputs = [make(5, 'm', { uncertainty: 0.5 })]
    const a = ok(propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 5000, seed: 1 }))
    const b = ok(propagateByMonteCarlo(inputs, ([x]) => x * x, { samples: 5000, seed: 2 }))
    assert.notEqual(a.uncertainty.value, b.uncertainty.value)
  })

  it('says when the combination is too curved for linear propagation', () => {
    // 1/x with the uncertainty a large fraction of x: badly non-linear.
    const result = ok(
      propagateByMonteCarlo([make(1, 'm', { uncertainty: 0.35 })], ([x]) => 1 / x, { samples: 60_000, seed: 3 })
    )
    assert.ok(result.notes.some((note) => /not close to straight/.test(note)))
  })

  it('notes when the middle of the samples differs from the nominal value', () => {
    const result = ok(
      propagateByMonteCarlo([make(1, 'm', { uncertainty: 0.3 })], ([x]) => x * x, { samples: 60_000, seed: 5 })
    )
    // E[x²] = 1 + 0.09, not 1.
    assert.ok(result.sampledMean > result.value)
    assert.ok(result.notes.some((note) => /genuinely different/.test(note)))
  })

  it('samples a bound uniformly rather than normally', () => {
    const result = ok(
      propagateByMonteCarlo([make(0, 'm', { uncertainty: boundUncertainty(1) })], ([x]) => x, {
        samples: 60_000,
        seed: 11
      })
    )
    // A rectangular distribution on ±1 has standard deviation 1/√3 ≈ 0.577, not 1.
    assert.ok(Math.abs(result.uncertainty.value - 1 / Math.sqrt(3)) < 0.02)
    assert.ok(result.interval.high < 1.01)
  })

  it('counts the samples it could not evaluate rather than treating them as zero', () => {
    const result = ok(
      propagateByMonteCarlo([make(1, 'm', { uncertainty: 0.5 })], ([x]) => Math.sqrt(x - 0.5), {
        samples: 20_000,
        seed: 9
      })
    )
    assert.ok(result.samples < 20_000)
    assert.ok(result.notes.some((note) => /were left out/.test(note)))
  })

  it('refuses when almost nothing evaluates', () => {
    const bad = propagateByMonteCarlo([make(1, 'm', { uncertainty: 0.1 })], () => Number.NaN, { samples: 500, seed: 1 })
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('refuses when the nominal inputs have no finite value', () => {
    const bad = propagateByMonteCarlo([make(1, 'm')], () => Number.POSITIVE_INFINITY)
    assert.ok(isMeasurementError(bad))
  })

  it('refuses an impossible coverage level', () => {
    const bad = propagateByMonteCarlo([make(1, 'm')], ([x]) => x, { level: 1 })
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'invalid-argument')
  })

  it('refuses with no inputs at all', () => {
    const bad = propagateByMonteCarlo([], () => 1)
    assert.ok(isMeasurementError(bad))
    assert.equal(bad.error, 'no-values')
  })

  it('says that inputs were sampled independently', () => {
    const result = ok(propagateByMonteCarlo([make(1, 'm', { uncertainty: 0.1 })], ([x]) => x, { samples: 1000 }))
    assert.ok(result.notes.some((note) => /independently/.test(note)))
  })
})

describe('coverage factors', () => {
  it('gives about 1.96 for 95%', () => {
    const k = coverageFactorFor(0.95)
    assert.ok(!isMeasurementError(k))
    assert.ok(Math.abs((k as number) - 1.96) < 0.01)
  })

  it('gives about 1 for 68%', () => {
    const k = coverageFactorFor(0.6827)
    assert.ok(Math.abs((k as number) - 1) < 0.01)
  })

  it('refuses a level outside zero to one', () => {
    assert.ok(isMeasurementError(coverageFactorFor(1.5)))
    assert.ok(isMeasurementError(coverageFactorFor(0)))
  })
})

describe('assumptions', () => {
  it('states them, so a Page can show them', () => {
    assert.ok(MEASUREMENT_ASSUMPTIONS.length >= 8)
    assert.ok(MEASUREMENT_ASSUMPTIONS.some((one) => /simulated/.test(one)))
    assert.ok(MEASUREMENT_ASSUMPTIONS.some((one) => /standard error of the mean/.test(one)))
    assert.ok(MEASUREMENT_ASSUMPTIONS.some((one) => /Resolution is not uncertainty/.test(one)))
  })
})
