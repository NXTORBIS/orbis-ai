import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BadInput } from './engines.ts'
import { SCIENCE_CAPABILITY, SCIENCE_LIMITS, runScienceOperation } from './scienceEngines.ts'

/**
 * The science bridge, checked through the door a Page actually uses.
 *
 * `labEngines.test.ts` holds the structural guards that every bridge shares -- that each operation names a real
 * capability and has an implementation. What is here is the behaviour: that the readers refuse what they should,
 * that the limits are the ones advertised, and that results a Page depends on come back with the right shape.
 */

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runScienceOperation(operation, input) as Record<string, unknown>

const refused = (operation: string, input: Record<string, unknown> = {}): string => {
  try {
    runScienceOperation(operation, input)
  } catch (err) {
    assert.ok(err instanceof BadInput, `expected a BadInput, got ${String(err)}`)
    return err.message
  }
  return assert.fail(`${operation} was not refused`)
}

const sine = (count: number, cycles: number, amplitude = 1): number[] =>
  Array.from({ length: count }, (_, i) => amplitude * Math.sin((2 * Math.PI * cycles * i) / count))

const range = (count: number, from = 0, step = 1): number[] => Array.from({ length: count }, (_, i) => from + i * step)

describe('the map', () => {
  it('routes every operation through one capability', () => {
    const capabilities = new Set(Object.values(SCIENCE_CAPABILITY))
    assert.deepEqual([...capabilities], ['computation.science'])
  })

  it('covers all six engines', () => {
    const families = new Set(Object.keys(SCIENCE_CAPABILITY).map((one) => one.split('.')[0]))
    for (const family of ['signal', 'interpolate', 'fit', 'precision', 'constants', 'frames', 'constraints']) {
      assert.ok(families.has(family), `no operations for ${family}`)
    }
  })
})

describe('signals', () => {
  it('finds a tone at its own frequency and amplitude', () => {
    const out = run('signal.peaks', { values: sine(256, 20, 3), rateHz: 256 })
    assert.equal(out.ok, true)
    const found = out.peaks as { frequencyHz: number; amplitude: number }[]
    assert.ok(Math.abs((found[0]?.frequencyHz ?? 0) - 20) < 0.5)
    assert.ok(Math.abs((found[0]?.amplitude ?? 0) - 3) < 0.01)
  })

  it('carries the caveats through rather than dropping them at the door', () => {
    const out = run('signal.spectrum', { values: sine(128, 8), rateHz: 128 })
    assert.ok(Array.isArray(out.caveats))
    assert.ok((out.caveats as string[]).some((one) => /folded down/.test(one)))
  })

  it('reports a gap as a failure rather than filling it', () => {
    // A null in the list is refused by the reader before it reaches the engine at all.
    assert.match(refused('signal.spectrum', { values: [1, null, 3], rateHz: 3 }), /not a finite number/)
  })

  it('refuses more samples than this door carries, whatever the engine would take', () => {
    const tooMany = new Array<number>(SCIENCE_LIMITS.samples + 1).fill(0)
    assert.match(refused('signal.spectrum', { values: tooMany, rateHz: 1000 }), /more than the 16384/)
  })

  it('refuses a rate of zero', () => {
    assert.match(refused('signal.spectrum', { values: [1, 2, 3, 4], rateHz: 0 }), /positive number of samples per second/)
  })

  it('smooths three ways through one operation', () => {
    const mean = run('signal.smooth', { values: [1, 2, 3, 4, 5], method: 'moving-average', window: 3 })
    assert.deepEqual(mean.values, [null, 2, 3, 4, null])
    const median = run('signal.smooth', { values: [1, 1, 100, 1, 1], method: 'moving-median', window: 3 })
    assert.equal((median.values as (number | null)[])[2], 1)
    const exponential = run('signal.smooth', { values: [10, 0, 0], method: 'exponential', alpha: 0.5 })
    assert.deepEqual(exponential.values, [10, 5, 2.5])
  })

  it('reports a period as the first positive peak, not the largest magnitude', () => {
    const out = run('signal.autocorrelation', { values: sine(128, 8), maximumLag: 40 })
    assert.equal((out.repeatAt as { lag: number }).lag, 16)
    assert.equal((out.strongest as { lag: number }).lag, 8)
  })

  it('designs a filter and applies it in one step', () => {
    const low = sine(1024, 10)
    const high = sine(1024, 400)
    const mixed = low.map((one, i) => one + (high[i] as number))
    const out = run('signal.filter', { values: mixed, kind: 'low-pass', cutoffHz: 100, rateHz: 1000, taps: 101 })
    assert.equal(out.ok, true)
    const filtered = out.values as (number | null)[]
    for (let i = 200; i < 800; i += 1) {
      assert.ok(Math.abs((filtered[i] as number) - (low[i] as number)) < 0.05, `sample ${i}`)
    }
  })

  it('needs two cutoffs for a band filter', () => {
    assert.match(refused('signal.design-filter', { kind: 'band-pass', cutoffHz: 100, rateHz: 1000 }), /two cutoff frequencies/)
  })

  it('refuses a kernel longer than the door allows', () => {
    const kernel = new Array<number>(SCIENCE_LIMITS.kernel + 1).fill(1)
    assert.match(refused('signal.convolve', { values: range(4000), kernel }), /more than the 1024/)
  })

  it('warns about folding when decimating without a filter', () => {
    const out = run('signal.decimate', { values: range(100), factor: 2, rateHz: 100, filteredFirst: false })
    assert.ok((out.warnings as string[]).some((one) => /folded down/.test(one)))
  })

  it('refuses to extrapolate when resampling', () => {
    const out = run('signal.resample', { times: [0, 1, 2], values: [0, 10, 20], newTimes: [-1, 1, 5] })
    assert.deepEqual(out.refusedOutside, [-1, 5])
  })
})

describe('interpolation and fitting', () => {
  it('builds an interpolant without shipping its coefficients back', () => {
    const out = run('interpolate.build', { x: [0, 1, 2, 3], y: [0, 1, 4, 9], kind: 'cubic-spline' })
    assert.equal(out.ok, true)
    assert.equal(out.xMin, 0)
    assert.equal(out.xMax, 3)
    assert.equal(out.segments, undefined, 'the segments are working, not an answer')
    assert.ok(Array.isArray(out.caveats))
  })

  it('evaluates inside the range and refuses outside it', () => {
    const out = run('interpolate.at', { x: [0, 1, 2], y: [0, 10, 20], kind: 'linear', at: [0.5, 9] })
    assert.deepEqual(out.values, [5])
    assert.deepEqual(out.refusedOutside, [9])
  })

  it('reports the measured overshoot of a spline through a step', () => {
    const out = run('interpolate.build', { x: [0, 1, 2, 3, 4, 5], y: [0, 0, 0, 10, 10, 10], kind: 'cubic-spline' })
    assert.ok((out.overshoot as number) > 0.1)
    const monotone = run('interpolate.build', { x: [0, 1, 2, 3, 4, 5], y: [0, 0, 0, 10, 10, 10], kind: 'monotone-cubic' })
    assert.ok((monotone.overshoot as number) < 1e-9)
  })

  it('fits a curve and reports the equation', () => {
    const x = range(10, 1)
    const out = run('fit.curve', { x, y: x.map((t) => 3 * t ** 1.5), family: 'power' })
    assert.equal(out.ok, true)
    assert.match(String(out.equation), /^y = 3·x\^1\.5$/)
    assert.equal(out.viaTransform, true)
  })

  it('asks for a logistic ceiling rather than inventing one', () => {
    assert.match(
      refused('fit.curve', { x: range(10), y: range(10).map((t) => 50 / (1 + Math.exp(-(t - 5)))), family: 'logistic' }),
      /whatever the curve happens to want/
    )
  })

  it('finds curvature a high R squared hides', () => {
    const x = range(30, 20)
    const out = run('fit.residuals', { x, y: x.map((t) => t * t), family: 'linear' })
    assert.ok((out.rSquared as number) > 0.98)
    assert.ok((out.findings as { kind: string }[]).some((one) => one.kind === 'curvature'))
  })

  it('compares families, names no winner, and reports the ones that would not fit', () => {
    const x = range(12)
    const y = x.map((t) => 2 * t + 1)
    const out = run('fit.compare', {
      x,
      y,
      families: [{ family: 'linear' }, { family: 'polynomial', degree: 2 }, { family: 'power' }]
    })
    assert.equal(out.ok, true)
    assert.equal(out.best, null)
    // x and y both start at zero, so the power law cannot be fitted -- and is reported rather than silently dropped.
    assert.equal((out.refused as { family: string }[]).length, 1)
    assert.equal((out.refused as { family: string }[])[0]?.family, 'power')
    assert.equal((out.entries as unknown[]).length, 2)
  })

  it('refuses a comparison where nothing could be fitted', () => {
    const out = run('fit.compare', { x: [0, 1, 2], y: [0, 1, 2], families: [{ family: 'power' }] })
    assert.equal(out.ok, false)
    assert.equal((out.refused as unknown[]).length, 1)
  })
})

describe('precision', () => {
  it('reports an ambiguous written number as ambiguous', () => {
    const out = run('precision.read', { text: '1200' })
    assert.equal(out.ambiguous, true)
    assert.equal(out.significantFigures, null)
  })

  it('treats a bare number as exact and an object with figures as measured', () => {
    const exact = run('precision.combine', { a: 3.14159, b: 2, operation: 'multiply' })
    assert.equal(exact.significantFigures, null)
    const measured = run('precision.combine', {
      a: { value: 1.2, significantFigures: 2 },
      b: { value: 3.45, significantFigures: 3 },
      operation: 'multiply'
    })
    assert.equal(measured.significantFigures, 2)
    assert.equal(measured.rounded, 4.1)
  })

  it('asks for the figure count rather than assuming one', () => {
    assert.match(refused('precision.combine', { a: { value: 1.2 }, b: 2, operation: 'add' }), /needs "significantFigures"/)
  })

  it('accepts a written number as an operand', () => {
    const out = run('precision.combine', { a: '12.30', b: '1.2', operation: 'add' })
    assert.equal(out.decimalPlaces, 1)
    assert.equal(out.rounded, 13.5)
  })

  it('refuses an ambiguous written operand', () => {
    assert.match(refused('precision.combine', { a: '1200', b: '1.2', operation: 'add' }), /between 2 and 4 significant figures/)
  })

  it('rounds once at the end of a chain and shows the alternative', () => {
    const out = run('precision.chain', {
      start: { value: 10, significantFigures: 2 },
      steps: [
        { operation: 'divide', operand: { value: 3.0, significantFigures: 2 } },
        { operation: 'multiply', operand: { value: 3.0, significantFigures: 2 } }
      ]
    })
    assert.equal(out.rounded, 10)
    assert.equal(out.ifRoundedEachStep, 9.9)
  })

  it('writes in three notations', () => {
    assert.equal(run('precision.write', { value: 1234, figures: 2, notation: 'scientific' }).text, '1.2e3')
    assert.equal(run('precision.write', { value: 12345, figures: 3, notation: 'engineering' }).text, '12.3e3')
    assert.equal(run('precision.write', { value: 3.14159, figures: 3 }).text, '3.14')
  })

  it('knows which decimals have an exact double', () => {
    assert.equal(run('precision.represent', { value: 0.5 }).exactInBinary, true)
    assert.equal(run('precision.represent', { value: 0.1 }).exactInBinary, false)
  })
})

describe('constants', () => {
  it('returns a constant with its report and its quantity', () => {
    const out = run('constants.get', { id: 'speed-of-light' })
    assert.equal(out.ok, true)
    assert.equal((out.constant as { value: number }).value, 299792458)
    assert.equal(out.limitsResultsTo, null)
    assert.equal((out.quantity as { value: number }).value, 299792458)
  })

  it('gives a dimensionless constant no quantity rather than a broken one', () => {
    const out = run('constants.get', { id: 'fine-structure' })
    assert.equal(out.ok, true)
    assert.equal(out.quantity, null)
  })

  it('says what a measured constant limits a result to', () => {
    const out = run('constants.get', { id: 'gravitational' })
    assert.equal(out.limitsResultsTo, 2.2e-5)
  })

  it('filters by kind and by category', () => {
    const defining = run('constants.list', { kind: 'defining' })
    assert.equal((defining.constants as unknown[]).length, 7)
    const maths = run('constants.list', { category: 'mathematical' })
    assert.ok((maths.constants as { id: string }[]).some((one) => one.id === 'pi'))
  })

  it('refuses an unknown id', () => {
    assert.equal(run('constants.get', { id: 'nope' }).ok, false)
  })

  it('compares a measurement in combined standard uncertainties', () => {
    const out = run('constants.compare', { id: 'gravitational', value: 6.6743e-11, uncertainty: 1.5e-15 })
    assert.equal(out.ok, true)
    assert.equal(out.agree, true)
  })
})

describe('frames', () => {
  it('refuses a spherical conversion with no convention, and says why', () => {
    const message = refused('frames.to-spherical', { point: { x: 1, y: 1, z: 1 } })
    assert.match(message, /no safe default/)
    assert.match(message, /swap the meanings/)
  })

  it('converts once the convention is given, and carries both readings back', () => {
    const out = run('frames.to-spherical', { point: { x: 0, y: 0, z: 5 }, convention: 'physics' })
    assert.equal(out.ok, true)
    assert.equal(out.polarSymbol, 'θ')
    assert.equal(out.azimuthDefined, false)
    assert.equal((out.conventions as unknown[]).length, 2)
  })

  it('refuses an Euler extraction with no order', () => {
    assert.match(refused('frames.to-euler', { axis: { x: 0, y: 0, z: 1 }, angle: 1 }), /no safe default/)
  })

  it('takes a rotation as a quaternion or as an axis and angle', () => {
    const byAxis = run('frames.rotate', { axis: { x: 0, y: 0, z: 1 }, angle: 90, unit: 'degrees', point: { x: 1, y: 0, z: 0 } })
    assert.ok(Math.abs((byAxis.y as number) - 1) < 1e-9)
    const q = run('frames.rotation', { axis: { x: 0, y: 0, z: 1 }, angle: 90, unit: 'degrees' })
    const byQuaternion = run('frames.rotate', { rotation: q.rotation, point: { x: 1, y: 0, z: 0 } })
    assert.ok(Math.abs((byQuaternion.y as number) - 1) < 1e-9)
  })

  it('refuses a rotation given neither way', () => {
    assert.match(refused('frames.rotate', { point: { x: 1, y: 0, z: 0 } }), /Give a rotation/)
  })

  it('refuses an axis of zero length', () => {
    assert.match(refused('frames.rotate', { axis: { x: 0, y: 0, z: 0 }, angle: 1, point: { x: 1, y: 0, z: 0 } }), /zero length/)
  })

  it('keeps the tree check own verdict out of the envelope', () => {
    // `usable` must survive beside `ok`: if it were spread over the envelope the reply would say the opposite.
    const broken = run('frames.check-tree', { frames: [{ id: 'a', parent: 'b' }] })
    assert.equal(broken.ok, true, 'the call succeeded')
    assert.equal(broken.usable, false, 'and found the tree unusable')
    const fine = run('frames.check-tree', { frames: [{ id: 'a' }, { id: 'b', parent: 'a' }] })
    assert.equal(fine.usable, true)
  })

  it('transforms a point through a chain of frames', () => {
    const frames = [{ id: 'world' }, { id: 'shifted', parent: 'world', translation: { x: 10, y: 0, z: 0 } }]
    const out = run('frames.transform', { frames, point: { x: 1, y: 2, z: 3 }, from: 'shifted', to: 'world' })
    assert.equal(out.ok, true)
    assert.deepEqual(out.point, { x: 11, y: 2, z: 3 })
  })

  it('treats a direction differently from a point', () => {
    const frames = [{ id: 'world' }, { id: 'shifted', parent: 'world', translation: { x: 10, y: 20, z: 30 } }]
    const asPoint = run('frames.transform', { frames, point: { x: 1, y: 0, z: 0 }, from: 'shifted', to: 'world' })
    const asDirection = run('frames.transform', { frames, point: { x: 1, y: 0, z: 0 }, from: 'shifted', to: 'world', what: 'direction' })
    assert.deepEqual(asPoint.point, { x: 11, y: 20, z: 30 })
    assert.deepEqual(asDirection.point, { x: 1, y: 0, z: 0 })
  })

  it('refuses a transform across handedness', () => {
    const frames = [{ id: 'world' }, { id: 'mirror', parent: 'world', handedness: 'left' }]
    const out = run('frames.transform', { frames, point: { x: 1, y: 1, z: 1 }, from: 'world', to: 'mirror' })
    assert.equal(out.ok, false)
    assert.match(String(out.message), /no rotation produces a reflection/)
  })

  it('accepts a null parent for a root frame', () => {
    const out = run('frames.check-tree', { frames: [{ id: 'world', parent: null }] })
    assert.equal(out.usable, true)
    assert.deepEqual(out.roots, ['world'])
  })
})

describe('constraints', () => {
  const constraints = [
    { kind: 'range', id: 'width', label: 'Width fits', variable: 'w', maximum: { value: 1, unit: 'm' } },
    { kind: 'sum', id: 'total', label: 'Parts add up', variables: ['a', 'b'], total: 100 }
  ]

  it('does not count an unevaluable rule as satisfied', () => {
    const out = run('constraints.check', { constraints, values: { w: { value: 50, unit: 'cm' } } })
    assert.equal(out.ok, true)
    assert.equal(out.satisfied, 1)
    assert.equal(out.unevaluable, 1)
    assert.equal(out.violated, 0)
    assert.equal(out.allSatisfied, false)
  })

  it('is satisfied when everything was checked and held', () => {
    const out = run('constraints.check', { constraints, values: { w: { value: 50, unit: 'cm' }, a: 60, b: 40 } })
    assert.equal(out.allSatisfied, true)
    assert.ok(Array.isArray(out.ranked))
  })

  it('converts units before comparing', () => {
    const over = run('constraints.check', { constraints, values: { w: { value: 150, unit: 'cm' }, a: 60, b: 40 } })
    assert.equal(over.violated, 1)
  })

  it('keeps feasibility own verdict out of the envelope', () => {
    const out = run('constraints.feasible', {
      constraints: [
        { kind: 'range', id: 'a', label: 'a', variable: 'x', minimum: 10 },
        { kind: 'range', id: 'b', label: 'b', variable: 'x', maximum: 5 }
      ]
    })
    assert.equal(out.ok, true, 'the call succeeded')
    assert.equal(out.possible, false, 'and found the rules impossible')
    assert.match(String(out.why), /looking for a better value will not help/)
  })

  it('narrows a range from a sum', () => {
    const out = run('constraints.narrow', {
      constraints: [
        { kind: 'range', id: 'rx', label: 'x', variable: 'x', minimum: 0, maximum: 100 },
        { kind: 'range', id: 'ry', label: 'y', variable: 'y', minimum: 0, maximum: 100 },
        { kind: 'sum', id: 's', label: 'total', variables: ['x', 'y'], total: 50 }
      ]
    })
    const x = (out.intervals as { variable: string; maximum: number }[]).find((one) => one.variable === 'x')
    assert.equal(x?.maximum, 50)
  })

  it('carries an expression comparison without letting a Page send code', () => {
    const out = run('constraints.check', {
      constraints: [{ kind: 'comparison', id: 'c', label: 'stress', left: 'force / area', comparison: 'less', right: 'limit' }],
      values: { force: 100, area: 10, limit: 20 }
    })
    assert.equal(out.satisfied, 1)
  })

  it('refuses more constraints than the door carries', () => {
    const many = Array.from({ length: SCIENCE_LIMITS.constraints + 1 }, (_, i) => ({
      kind: 'range',
      id: `c${i}`,
      label: 'c',
      variable: 'x',
      maximum: 1
    }))
    assert.match(refused('constraints.check', { constraints: many }), /more than the 500/)
  })

  it('refuses more named values than the door carries', () => {
    const values: Record<string, number> = {}
    for (let i = 0; i <= SCIENCE_LIMITS.names; i += 1) values[`v${i}`] = i
    assert.match(refused('constraints.check', { constraints, values }), /more than the 64/)
  })
})
