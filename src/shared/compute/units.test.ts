import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addQuantities,
  compatibleUnits,
  convertQuantity,
  describeDimension,
  divideQuantities,
  formatQuantity,
  isQuantityError,
  isUnitError,
  multiplyQuantities,
  nameDimension,
  parseUnit,
  powerQuantity,
  quantity,
  resolveUnitWord,
  sameDimension,
  simplifyUnit,
  subtractQuantities,
  toBase,
  UNITS,
  type Quantity
} from './units.ts'

/** A quantity or a thrown assertion. Every test here wants the quantity, so the error case is a test failure. */
const q = (value: number, unit: string): Quantity => {
  const made = quantity(value, unit)
  assert.equal(isQuantityError(made), false, `could not make ${value} ${unit}: ${JSON.stringify(made)}`)
  return made as Quantity
}

const near = (actual: number, expected: number, tolerance = 1e-9, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected || 1) * tolerance, `${what} expected ${expected}, got ${actual}`)
}

// ---------------------------------------------------------------- the registry itself

test('every unit has a distinct id and a dimension', () => {
  const ids = new Set<string>()
  for (const u of UNITS) {
    assert.equal(ids.has(u.id), false, `two units share the id ${u.id}`)
    ids.add(u.id)
    assert.ok(Number.isFinite(u.scale) && u.scale > 0, `${u.id} has no usable scale`)
    assert.ok(u.name.length > 0, `${u.id} has no name`)
  }
})

test('every unit can be parsed back from its own symbol', () => {
  // The registry describing itself. A unit whose symbol does not resolve is a unit nobody can type.
  for (const u of UNITS) {
    if (u.symbol === '') continue
    const parsed = parseUnit(u.symbol)
    assert.equal(isUnitError(parsed), false, `${u.id} cannot be parsed from "${u.symbol}"`)
    assert.ok(sameDimension((parsed as { dimension: object }).dimension, u.dimension), `${u.id} parsed to the wrong dimension`)
  }
})

// ---------------------------------------------------------------- prefixes

test('a prefix multiplies the unit it is attached to', () => {
  near(resolveUnitWord('km')!.scale, 1000)
  near(resolveUnitWord('cm')!.scale, 0.01)
  near(resolveUnitWord('mm')!.scale, 0.001)
  near(resolveUnitWord('µs')!.scale, 1e-6)
  near(resolveUnitWord('MHz')!.scale, 1e6)
  // The kilogram is a prefixed gram, which is why the gram's own scale is a thousandth.
  near(resolveUnitWord('kg')!.scale, 1)
  near(resolveUnitWord('kilometre')!.scale, 1000)
  near(resolveUnitWord('millisecond')!.scale, 0.001)
})

test('a prefix is not allowed on a unit that does not take one', () => {
  // `min` is a minute, not a milli-inch, and nothing should turn it into one.
  assert.equal(resolveUnitWord('min')!.unit.id, 'minute')
  assert.equal(resolveUnitWord('mmin'), null)
  assert.equal(resolveUnitWord('kft'), null)
})

test('a prefix is never attached to a temperature measured from a different zero', () => {
  // A thousandth of a degree Celsius measured from absolute zero is not what anybody typing this means.
  assert.equal(resolveUnitWord('m°C'), null)
  assert.equal(resolveUnitWord('k°F'), null)
  // Kelvin has no offset, so it may be prefixed.
  near(resolveUnitWord('mK')!.scale, 0.001)
})

test('a bare prefix letter is not a unit', () => {
  // `c` is centi. Resolving it as a coulomb would silently turn a hundredth into a charge.
  assert.equal(resolveUnitWord('c'), null)
  assert.equal(resolveUnitWord('C')!.unit.id, 'coulomb')
  assert.equal(resolveUnitWord('k'), null)
})

test('tesla and the tera prefix do not collide', () => {
  // Both are written `T`. A bare `T` is the unit; `T` followed by another unit is the prefix.
  assert.equal(resolveUnitWord('T')!.unit.id, 'tesla')
  near(resolveUnitWord('Tm')!.scale, 1e12)
})

// ---------------------------------------------------------------- conversion

test('a length converts to another length', () => {
  near((convertQuantity(q(5, 'km'), 'm') as Quantity).value, 5000)
  near((convertQuantity(q(1, 'mi'), 'km') as Quantity).value, 1.609344)
  near((convertQuantity(q(12, 'in') as Quantity, 'ft') as Quantity).value, 1)
  near((convertQuantity(q(1, 'ly'), 'km') as Quantity).value, 9460730472580.8, 1e-12)
})

test('temperature converts through its offset, not by multiplying', () => {
  // The case a table of factors gets wrong. 0 °C is not 0 K.
  near(toBase(q(0, '°C')), 273.15)
  near((convertQuantity(q(100, '°C'), '°F') as Quantity).value, 212)
  near((convertQuantity(q(32, '°F'), '°C') as Quantity).value, 0, 1e-9)
  near((convertQuantity(q(-40, '°C'), '°F') as Quantity).value, -40, 1e-9)
  near((convertQuantity(q(0, 'K'), '°C') as Quantity).value, -273.15)
  near((convertQuantity(q(491.67, '°R'), 'K') as Quantity).value, 273.15, 1e-9)
})

test('converting between different things is refused, and the refusal says which two', () => {
  const failed = convertQuantity(q(5, 'm'), 's')
  assert.equal(isQuantityError(failed), true)
  assert.equal((failed as { error: string }).error, 'dimension-mismatch')
  // Naming both sides, because "cannot convert" on its own tells nobody anything.
  assert.match((failed as { message: string }).message, /length/)
  assert.match((failed as { message: string }).message, /time/)
})

test('a unit Orbis does not know is refused rather than guessed at', () => {
  const parsed = parseUnit('smoots')
  assert.equal(isUnitError(parsed), true)
  assert.equal((parsed as { error: string }).error, 'unknown-unit')
  assert.equal((parsed as { word?: string }).word, 'smoots')
})

// ---------------------------------------------------------------- compound units

test('a compound unit parses into the dimension it actually is', () => {
  assert.equal(nameDimension((parseUnit('km/h') as { dimension: object }).dimension), 'velocity')
  assert.equal(nameDimension((parseUnit('m/s^2') as { dimension: object }).dimension), 'acceleration')
  assert.equal(nameDimension((parseUnit('kg*m/s^2') as { dimension: object }).dimension), 'force')
  assert.equal(nameDimension((parseUnit('1/s') as { dimension: object }).dimension), 'frequency')
  assert.equal(nameDimension((parseUnit('kg/m^3') as { dimension: object }).dimension), 'density')
  assert.equal(nameDimension((parseUnit('J/(kg*K)') as { dimension: object }).dimension), 'specific heat capacity')
})

test('superscripts and the characters people actually type are understood', () => {
  assert.ok(sameDimension((parseUnit('m/s²') as { dimension: object }).dimension, (parseUnit('m/s^2') as { dimension: object }).dimension))
  assert.ok(sameDimension((parseUnit('s⁻¹') as { dimension: object }).dimension, (parseUnit('1/s') as { dimension: object }).dimension))
  assert.ok(sameDimension((parseUnit('kg·m/s²') as { dimension: object }).dimension, (parseUnit('kg*m/s^2') as { dimension: object }).dimension))
  assert.ok(sameDimension((parseUnit('metres per second') as { dimension: object }).dimension, (parseUnit('m/s') as { dimension: object }).dimension))
})

test('everything after a slash is the denominator unless brackets say otherwise', () => {
  // `J/kg*K` written by a person means J/(kg·K). Somebody who means the other thing writes (J/kg)*K.
  assert.ok(sameDimension((parseUnit('J/kg*K') as { dimension: object }).dimension, (parseUnit('J/(kg*K)') as { dimension: object }).dimension))
  assert.ok(sameDimension((parseUnit('(J/kg)*K') as { dimension: object }).dimension, { L: 2, T: -2, K: 1 }))
})

test('a temperature with an offset cannot appear inside a compound', () => {
  const failed = parseUnit('°C/h')
  assert.equal(isUnitError(failed), true)
  assert.equal((failed as { error: string }).error, 'offset-in-compound')
  // And the message says why rather than only that.
  assert.match((failed as { message: string }).message, /different zero/)
  // Kelvin is fine, because it has no offset.
  assert.equal(isUnitError(parseUnit('K/h')), false)
})

test('36 km/h is 10 m/s', () => {
  near((convertQuantity(q(36, 'km/h'), 'm/s') as Quantity).value, 10)
  near((convertQuantity(q(1, 'atm'), 'Pa') as Quantity).value, 101325)
  near((convertQuantity(q(1, 'kWh'), 'J') as Quantity).value, 3.6e6)
})

test('a fractional power is allowed, because the square root of an area is a length', () => {
  const root = parseUnit('m^1/2')
  assert.equal(isUnitError(root), false)
  assert.ok(sameDimension((root as { dimension: object }).dimension, { L: 0.5 }))
  const squared = powerQuantity({ value: 4, unit: root as never }, 2)
  assert.ok(sameDimension(squared.unit.dimension, { L: 1 }))
  near(squared.value, 16)
})

test('a malformed unit is a syntax error, not a silent dimensionless one', () => {
  for (const bad of ['m/', 'm^', '(m', 'm)', 'm**s', '/s']) {
    const parsed = parseUnit(bad)
    assert.equal(isUnitError(parsed), true, `"${bad}" should not parse`)
  }
  // An empty unit is legitimately dimensionless -- a ratio has no unit.
  assert.equal(isUnitError(parseUnit('')), false)
  assert.equal(describeDimension((parseUnit('') as { dimension: object }).dimension), 'dimensionless')
})

// ---------------------------------------------------------------- arithmetic

test('quantities of the same kind add, in the left one\'s unit', () => {
  const sum = addQuantities(q(1, 'km'), q(500, 'm')) as Quantity
  near(sum.value, 1.5)
  assert.equal(sum.unit.display, 'km')
})

test('adding two different kinds of thing is refused', () => {
  const failed = addQuantities(q(5, 'm'), q(2, 's'))
  assert.equal(isQuantityError(failed), true)
  assert.match((failed as { message: string }).message, /length cannot be added to time/)
})

test('subtracting names the two sides the right way round', () => {
  const failed = subtractQuantities(q(5, 'm'), q(2, 'kg'))
  assert.match((failed as { message: string }).message, /mass cannot be subtracted from length/)
})

test('multiplying builds the compound unit rather than dropping it', () => {
  const area = multiplyQuantities(q(3, 'm'), q(4, 'm'))
  near(area.value, 12)
  assert.ok(sameDimension(area.unit.dimension, { L: 2 }))
  // Not a bare number: 12 of something, and the something is m^2.
  assert.notEqual(area.unit.display, '')
})

test('dividing a distance by a time gives a velocity', () => {
  const speed = divideQuantities(q(100, 'm'), q(4, 's')) as Quantity
  near(speed.value, 25)
  assert.equal(nameDimension(speed.unit.dimension), 'velocity')
  near((convertQuantity(speed, 'km/h') as Quantity).value, 90)
})

test('dividing by zero is refused rather than returning infinity', () => {
  const failed = divideQuantities(q(1, 'm'), q(0, 's'))
  assert.equal(isQuantityError(failed), true)
  assert.equal((failed as { error: string }).error, 'not-a-number')
})

test('a force worked out from a mass and an acceleration reads as newtons', () => {
  // The whole point of tracking dimensions: the answer knows what it is.
  const mass = q(2, 'kg')
  const acceleration = q(9.81, 'm/s^2')
  const force = multiplyQuantities(mass, acceleration)
  near(force.value, 19.62)
  assert.equal(nameDimension(force.unit.dimension), 'force')
  const tidy = simplifyUnit(force.unit)
  assert.equal(tidy.display, 'N')
  assert.equal(tidy.single?.id, 'newton')
})

test('a compound is only renamed when the scale matches too', () => {
  // g*m/s^2 is a millinewton, so it must not be called N -- that would change the number.
  const force = multiplyQuantities(q(1, 'g'), q(1, 'm/s^2'))
  assert.notEqual(simplifyUnit(force.unit).display, 'N')
})

test('multiplying a Celsius temperature goes through kelvin first', () => {
  // 20 °C times 2 is not 40 °C: a scale with an arbitrary zero cannot be multiplied. The engine converts to the
  // absolute scale rather than producing a number that looks fine and is wrong.
  const doubled = multiplyQuantities(q(20, '°C'), { value: 2, unit: parseUnit('') as never })
  near(doubled.value, 293.15 * 2)
  assert.ok(sameDimension(doubled.unit.dimension, { K: 1 }))
})

// ---------------------------------------------------------------- reading back

test('a quantity formats with its unit, and a plain number without one', () => {
  assert.equal(formatQuantity(q(12.5, 'm/s')), '12.5 m/s')
  assert.equal(formatQuantity(q(0.5, '')), '0.5')
  assert.equal(formatQuantity(q(1 / 3, 'm'), 3), '0.333 m')
})

test('the units offered for a conversion are only the ones that could work', () => {
  const lengths = compatibleUnits(parseUnit('m') as never)
  assert.ok(lengths.some((u) => u.id === 'mile'))
  assert.ok(lengths.some((u) => u.id === 'light-year'))
  // Offering a pressure here would be offering an error.
  assert.equal(lengths.some((u) => u.id === 'pascal'), false)
  assert.equal(lengths.some((u) => u.id === 'one'), false)
})

test('a dimension with no familiar name still describes itself', () => {
  assert.equal(nameDimension({ L: 7 }), null)
  assert.equal(describeDimension({ L: 7 }), 'L^7')
  assert.equal(describeDimension({ M: 1, L: -1, T: -2 }), 'L^-1·M·T^-2')
})

test('a quantity needs a finite number', () => {
  assert.equal((quantity(Number.NaN, 'm') as { error: string }).error, 'not-a-number')
  assert.equal((quantity(Number.POSITIVE_INFINITY, 'm') as { error: string }).error, 'not-a-number')
})

test('angle is its own dimension, so an angular velocity is not a frequency', () => {
  // A deliberate departure from SI, which makes the radian dimensionless. The note at the top of the module explains it.
  assert.equal(sameDimension((parseUnit('rad/s') as { dimension: object }).dimension, (parseUnit('Hz') as { dimension: object }).dimension), false)
  near((convertQuantity(q(180, '°'), 'rad') as Quantity).value, Math.PI)
  near((convertQuantity(q(1, 'turn'), '°') as Quantity).value, 360)
  const failed = convertQuantity(q(1, 'rad'), '')
  assert.equal(isQuantityError(failed), true)
})
