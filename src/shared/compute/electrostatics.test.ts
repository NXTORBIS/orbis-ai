import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  capacitorState,
  combine,
  cylindricalCapacitor,
  dipole,
  fieldAt,
  fieldGrid,
  fieldLines,
  forceOn,
  isElectrostaticsError,
  parallelPlate,
  sphericalCapacitor,
  withDielectric,
  workBetween,
  type ElectrostaticsError
} from './electrostatics.ts'
import { COULOMB_CONSTANT, VACUUM_PERMITTIVITY } from './emConstants.ts'

const ok = <T>(value: T): Exclude<T, ElectrostaticsError> => {
  assert.ok(!isElectrostaticsError(value), isElectrostaticsError(value) ? value.message : '')
  return value as Exclude<T, ElectrostaticsError>
}

const bad = (value: unknown): ElectrostaticsError => {
  assert.ok(isElectrostaticsError(value), 'expected an error and got a result')
  return value
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

describe('the field of a point charge', () => {
  it('matches kq/r-squared exactly', () => {
    const report = ok(fieldAt([{ charge: 1e-6, x: 0, y: 0 }], { x: 1, y: 0 }))
    closeTo(report.field.magnitude, COULOMB_CONSTANT * 1e-6, 1e-9, 'field at 1 m')
    closeTo(report.field.x, COULOMB_CONSTANT * 1e-6, 1e-9, 'points along +x')
    closeTo(report.field.y, 0, 1e-12)
  })

  it('falls off as the inverse square, not the inverse', () => {
    const near = ok(fieldAt([{ charge: 1, x: 0, y: 0 }], { x: 1, y: 0 }))
    const far = ok(fieldAt([{ charge: 1, x: 0, y: 0 }], { x: 2, y: 0 }))
    closeTo(near.field.magnitude / far.field.magnitude, 4, 1e-9, 'doubling distance quarters the field')
  })

  it('points toward a negative charge and away from a positive one', () => {
    const positive = ok(fieldAt([{ charge: 1, x: 0, y: 0 }], { x: 1, y: 0 }))
    const negative = ok(fieldAt([{ charge: -1, x: 0, y: 0 }], { x: 1, y: 0 }))
    assert.ok(positive.field.x > 0)
    assert.ok(negative.field.x < 0)
  })

  it('refuses the point where the charge itself is', () => {
    const result = bad(fieldAt([{ charge: 1, x: 0, y: 0 }], { x: 0, y: 0 }))
    assert.equal(result.error, 'coincident')
    assert.match(result.message, /no value at the charge/)
  })
})

describe('field and potential are summed independently', () => {
  it('gives zero field and non-zero potential midway between two equal charges', () => {
    const report = ok(
      fieldAt(
        [
          { charge: 1e-9, x: -1, y: 0 },
          { charge: 1e-9, x: 1, y: 0 }
        ],
        { x: 0, y: 0 }
      )
    )
    closeTo(report.field.magnitude, 0, 1e-12, 'vectors cancel')
    assert.ok(report.potential > 0, 'scalars add')
    assert.ok(report.notes.some((one) => /field cancels here but the potential does not/.test(one)))
  })

  it('gives zero potential and non-zero field midway between a dipole', () => {
    const report = ok(
      fieldAt(
        [
          { charge: 1e-9, x: -1, y: 0 },
          { charge: -1e-9, x: 1, y: 0 }
        ],
        { x: 0, y: 0 }
      )
    )
    closeTo(report.potential, 0, 1e-18, 'scalars cancel')
    assert.ok(report.field.magnitude > 0, 'vectors add')
    assert.ok(report.notes.some((one) => /potential is zero here but the field is not/.test(one)))
  })

  it('reports each charge separately so a Page can show where a total came from', () => {
    const report = ok(
      fieldAt(
        [
          { charge: 1e-9, x: -1, y: 0, label: 'left' },
          { charge: -1e-9, x: 1, y: 0, label: 'right' }
        ],
        { x: 0, y: 0 }
      )
    )
    assert.equal(report.contributions.length, 2)
    assert.deepEqual(
      report.contributions.map((one) => one.label),
      ['left', 'right']
    )
  })
})

describe('force on a test charge', () => {
  it('is the field times the charge, and reverses for a negative one', () => {
    const charges = [{ charge: 1e-6, x: 0, y: 0 }]
    const positive = ok(forceOn(charges, { x: 1, y: 0 }, 1e-9))
    const negative = ok(forceOn(charges, { x: 1, y: 0 }, -1e-9))
    closeTo(positive.force.x, positive.field.x * 1e-9, 1e-18)
    assert.ok(negative.force.x < 0, 'negative charge is pulled back')
    assert.ok(negative.notes.some((one) => /against the field/.test(one)))
  })
})

describe('work moving a charge', () => {
  it('depends only on the endpoints', () => {
    const charges = [{ charge: 1e-6, x: 0, y: 0 }]
    const report = ok(workBetween(charges, { x: 1, y: 0 }, { x: 2, y: 0 }, 1e-9))
    // Moving a positive charge away from a positive charge: the field does positive work.
    assert.ok(report.workByField > 0)
    closeTo(report.workAgainstField, -report.workByField, 1e-30)
    assert.ok(report.notes.some((one) => /Only the two endpoints matter/.test(one)))
  })

  it('gives the same answer whichever direction it is asked in, with the sign flipped', () => {
    const charges = [{ charge: 1e-6, x: 0, y: 0 }]
    const out = ok(workBetween(charges, { x: 1, y: 0 }, { x: 2, y: 0 }, 1e-9))
    const back = ok(workBetween(charges, { x: 2, y: 0 }, { x: 1, y: 0 }, 1e-9))
    closeTo(out.workByField, -back.workByField, 1e-30)
  })
})

describe('sampling a region', () => {
  it('returns a grid and reports the points that landed on a charge', () => {
    const report = ok(
      fieldGrid([{ charge: 1, x: 0, y: 0 }], { minX: -1, maxX: 1, minY: -1, maxY: 1, columns: 3, rows: 3 })
    )
    assert.equal(report.samples.length, 9)
    assert.equal(report.skipped, 1, 'the centre point sits on the charge')
    assert.equal(report.samples[4].field, null)
    assert.ok(report.notes.some((one) => /no field at its own position/.test(one)))
  })

  it('refuses a grid larger than it will sample', () => {
    const result = bad(
      fieldGrid([{ charge: 1, x: 0, y: 0 }], { minX: -1, maxX: 1, minY: -1, maxY: 1, columns: 200, rows: 200 })
    )
    assert.equal(result.error, 'too-many')
  })
})

describe('field lines', () => {
  it('leaves a positive charge and ends on a negative one', () => {
    const lines = ok(
      fieldLines(
        [
          { charge: 1e-9, x: -0.5, y: 0, label: 'source' },
          { charge: -1e-9, x: 0.5, y: 0, label: 'sink' }
        ],
        { linesPerCharge: 8 }
      )
    )
    assert.ok(lines.length > 0)
    const fromSource = lines.filter((one) => one.from === 'source')
    assert.ok(fromSource.length === 8)
    assert.ok(fromSource.some((one) => one.ended === 'charge'), 'at least one line lands on the negative charge')
  })
})

describe('the dipole moment', () => {
  it('is charge times separation', () => {
    const report = ok(dipole(2e-9, 0.01))
    closeTo(report.momentMagnitude, 2e-11, 1e-20)
  })
})

describe('capacitance from geometry', () => {
  it('follows epsilon-A-over-d for a parallel plate', () => {
    const c = ok(parallelPlate({ area: 0.01, separation: 0.001 }))
    closeTo(c.capacitance, (VACUUM_PERMITTIVITY * 0.01) / 0.001, 1e-18)
    closeTo(c.dielectricConstant, 1, 0)
  })

  it('warns when the plates are not much wider than the gap', () => {
    const c = ok(parallelPlate({ area: 1e-6, separation: 0.01 }))
    assert.ok(c.notes.some((one) => /fringing/.test(one)))
  })

  it('scales with the dielectric constant', () => {
    const vacuum = ok(parallelPlate({ area: 0.01, separation: 0.001 }))
    const filled = ok(parallelPlate({ area: 0.01, separation: 0.001, dielectricConstant: 4 }))
    closeTo(filled.capacitance / vacuum.capacitance, 4, 1e-12)
  })

  it('refuses a dielectric constant below one', () => {
    const result = bad(parallelPlate({ area: 0.01, separation: 0.001, dielectricConstant: 0.5 }))
    assert.match(result.message, /less than vacuum/)
  })

  it('needs the outer radius to be the larger one', () => {
    assert.equal(bad(cylindricalCapacitor({ innerRadius: 2, outerRadius: 1, length: 1 })).error, 'invalid-argument')
    assert.equal(bad(sphericalCapacitor({ innerRadius: 2, outerRadius: 1 })).error, 'invalid-argument')
  })
})

describe('what is stored on a capacitor', () => {
  it('derives charge from voltage and back again', () => {
    const c = ok(parallelPlate({ area: 0.01, separation: 0.001 }))
    const fromVoltage = ok(capacitorState(c, { voltage: 10 }))
    const fromCharge = ok(capacitorState(c, { charge: fromVoltage.charge }))
    closeTo(fromCharge.voltage, 10, 1e-9)
  })

  it('stores half CV-squared, not QV', () => {
    const c = ok(parallelPlate({ area: 0.01, separation: 0.001 }))
    const state = ok(capacitorState(c, { voltage: 10 }))
    closeTo(state.energy, 0.5 * c.capacitance * 100, 1e-18)
    closeTo(state.energy, (state.charge * state.voltage) / 2, 1e-18)
  })

  it('refuses both voltage and charge together', () => {
    const c = ok(parallelPlate({ area: 0.01, separation: 0.001 }))
    const result = bad(capacitorState(c, { voltage: 10, charge: 1e-9 }))
    assert.match(result.message, /not both/)
  })

  it('refuses neither', () => {
    const c = ok(parallelPlate({ area: 0.01, separation: 0.001 }))
    assert.ok(isElectrostaticsError(capacitorState(c, {})))
  })
})

describe('the dielectric question with two answers', () => {
  const capacitor = ok(parallelPlate({ area: 0.01, separation: 0.001 }))

  it('holds the voltage and raises everything else when still connected', () => {
    const report = ok(withDielectric(capacitor, { voltage: 10 }, 4, 'connected'))
    closeTo(report.changes.voltage, 1, 1e-12, 'voltage held')
    closeTo(report.changes.capacitance, 4, 1e-12)
    closeTo(report.changes.charge, 4, 1e-12)
    closeTo(report.changes.energy, 4, 1e-12)
    assert.equal(report.held, 'voltage')
  })

  it('holds the charge and lowers voltage and energy when isolated', () => {
    const report = ok(withDielectric(capacitor, { voltage: 10 }, 4, 'isolated'))
    closeTo(report.changes.charge, 1, 1e-12, 'charge held')
    closeTo(report.changes.capacitance, 4, 1e-12)
    closeTo(report.changes.voltage, 0.25, 1e-12)
    closeTo(report.changes.energy, 0.25, 1e-12)
    assert.equal(report.held, 'charge')
  })

  it('gives genuinely different answers for the two conditions', () => {
    const connected = ok(withDielectric(capacitor, { voltage: 10 }, 4, 'connected'))
    const isolated = ok(withDielectric(capacitor, { voltage: 10 }, 4, 'isolated'))
    assert.notEqual(connected.after.voltage, isolated.after.voltage)
    assert.notEqual(connected.after.charge, isolated.after.charge)
    assert.notEqual(connected.after.energy, isolated.after.energy)
    closeTo(connected.after.capacitance, isolated.after.capacitance, 1e-18, 'only capacitance agrees')
  })

  it('refuses to guess the condition', () => {
    const result = bad(withDielectric(capacitor, { voltage: 10 }, 4, 'maybe' as never))
    assert.equal(result.error, 'needs-condition')
    assert.match(result.message, /still connected/)
  })
})

describe('capacitors together', () => {
  it('adds in parallel', () => {
    const report = ok(combine([1e-6, 2e-6, 3e-6], 'parallel', 12))
    closeTo(report.total, 6e-6, 1e-18)
    assert.deepEqual(report.voltages, [12, 12, 12])
  })

  it('gives less than the smallest in series', () => {
    const report = ok(combine([1e-6, 2e-6, 3e-6], 'series', 12))
    assert.ok(report.total < 1e-6, 'series total is below the smallest')
    closeTo(report.total, 1 / (1 / 1e-6 + 1 / 2e-6 + 1 / 3e-6), 1e-18)
  })

  it('puts the same charge on every capacitor in series', () => {
    const report = ok(combine([1e-6, 2e-6], 'series', 12))
    closeTo(report.charges[0], report.charges[1], 1e-18)
    closeTo(report.voltages[0] + report.voltages[1], 12, 1e-9, 'voltages add to the supply')
  })
})
