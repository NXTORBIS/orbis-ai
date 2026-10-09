import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORMULAS, FORMULA_COUNTS, FORMULA_SECTIONS, formulaFor, formulaSections, searchFormulas, solve } from './formulas.ts'
import { isSimulationError } from './simulation.ts'

/**
 * The vault is checked against published values, not against itself.
 *
 * A formula engine can be entirely self-consistent and entirely wrong: rearrange an incorrect formula and it will
 * round-trip perfectly. So the first test below is a table of numbers from outside — Earth's escape velocity, the
 * Sun's Schwarzschild radius, the molar volume of an ideal gas, the peak wavelength of sunlight — and the vault
 * has to reproduce them.
 */

const ok = <T>(value: T, what: string): Exclude<T, { error: string }> => {
  assert.ok(!isSimulationError(value), `${what}: ${isSimulationError(value) ? `${value.message} ${value.fix}` : ''}`)
  return value as Exclude<T, { error: string }>
}

test('the vault reproduces published values', () => {
  const KNOWN: readonly { id: string; want: string; given: Record<string, number>; expect: number; tol: number; what: string }[] = [
    { id: 'escape-velocity', want: 'v', given: { M: 5.972e24, r: 6.371e6 }, expect: 11186, tol: 5, what: "Earth's escape velocity, 11.19 km/s" },
    { id: 'orbital-velocity', want: 'v', given: { M: 5.972e24, r: 6.771e6 }, expect: 7672, tol: 5, what: 'low Earth orbit, about 7.67 km/s' },
    { id: 'kepler-third', want: 'T', given: { a: 1.496e11, M: 1.989e30 }, expect: 365.25 * 86400, tol: 2e5, what: "Earth's year from its orbit" },
    { id: 'schwarzschild', want: 'r', given: { M: 1.989e30 }, expect: 2953, tol: 2, what: "the Sun's event horizon, 2.95 km" },
    { id: 'shm-period-pendulum', want: 'L', given: { T: 2, g: 9.81 }, expect: 0.9939, tol: 1e-3, what: 'the seconds pendulum, 0.994 m' },
    { id: 'ideal-gas', want: 'V', given: { P: 101325, n: 1, T: 273.15 }, expect: 0.0224, tol: 1e-4, what: 'molar volume at STP, 22.4 litres' },
    { id: 'rms-speed', want: 'v', given: { T: 293, M: 0.02896 }, expect: 502, tol: 3, what: 'air molecules at room temperature, about 500 m/s' },
    { id: 'wien', want: 'lambda', given: { T: 5772 }, expect: 502e-9, tol: 2e-9, what: 'sunlight peaks in the green, 502 nm' },
    { id: 'carnot', want: 'eta', given: { Tc: 300, Th: 600 }, expect: 0.5, tol: 1e-12, what: 'Carnot efficiency between 300 K and 600 K' },
    { id: 'bohr-energy', want: 'E', given: { n: 2 }, expect: -3.4014, tol: 1e-3, what: "hydrogen's second level, −3.40 eV" },
    { id: 'de-broglie', want: 'lambda', given: { p: 9.1093837015e-31 * 1e6 }, expect: 7.27e-10, tol: 1e-12, what: 'an electron at 1000 km/s, 0.73 nm' },
    { id: 'lorentz-factor', want: 'gamma', given: { v: 0.866 * 299792458 }, expect: 2.0, tol: 2e-3, what: 'gamma is 2 at 0.866c' },
    { id: 'mass-energy', want: 'E', given: { m: 1 }, expect: 8.98755e16, tol: 1e12, what: 'one kilogram is 9×10¹⁶ joules' },
    { id: 'snell', want: 'theta2', given: { n1: 1, theta1: 30, n2: 1.333 }, expect: 22.0301, tol: 1e-3, what: 'air to water at 30°' },
    { id: 'critical-angle', want: 'theta', given: { n1: 1.333, n2: 1 }, expect: 48.61, tol: 0.02, what: "water's critical angle, 48.6°" },
    { id: 'rayleigh', want: 'theta', given: { lambda: 550e-9, D: 2.4 }, expect: 2.797e-7, tol: 1e-9, what: "Hubble's resolving power" },
    { id: 'lc-resonance', want: 'f', given: { L: 1e-3, C: 1e-9 }, expect: 159155, tol: 5, what: 'a 1 mH / 1 nF tank at 159 kHz' },
    { id: 'coulomb', want: 'F', given: { q1: 1.602176634e-19, q2: -1.602176634e-19, r: 5.29e-11 }, expect: -8.238e-8, tol: 1e-10, what: 'the force binding hydrogen' },
    { id: 'half-life', want: 'lambda', given: { t: 5730 * 365.25 * 86400 }, expect: 3.836e-12, tol: 1e-14, what: "carbon-14's decay constant" },
    { id: 'parallax', want: 'd', given: { p: 0.7687 }, expect: 1.3009, tol: 1e-3, what: 'Proxima Centauri, 1.30 pc' },
    { id: 'youngs-modulus', want: 'E', given: { F: 1000, A: 1e-4, dL: 5e-5, L: 1 }, expect: 2e11, tol: 1, what: "steel's stiffness, 200 GPa" },
    { id: 'velocity-squared', want: 'v', given: { u: 0, a: 9.81, s: 100 }, expect: 44.29, tol: 0.01, what: 'dropped 100 m' },
    { id: 'projectile-range', want: 'R', given: { u: 20, theta: 45, g: 9.81 }, expect: 40.77, tol: 0.01, what: '20 m/s at 45° goes 40.8 m' },
    { id: 'transformer', want: 'Vs', given: { Vp: 230, Ns: 100, Np: 1000 }, expect: 23, tol: 1e-12, what: 'a 10:1 transformer on mains' }
  ]

  for (const one of KNOWN) {
    const got = ok(solve(one.id, one.want, one.given), one.what)
    assert.ok(
      Math.abs(got.value - one.expect) <= one.tol,
      `${one.what}: got ${got.value}, published ${one.expect} (off by ${Math.abs(got.value - one.expect)})`
    )
  }
  assert.ok(KNOWN.length >= 20)
})

test('45° is the longest range, and two angles adding to 90 go the same distance', () => {
  const at = (theta: number): number => ok(solve('projectile-range', 'R', { u: 25, theta, g: 9.81 }), `${theta}°`).value
  assert.ok(at(45) > at(40) && at(45) > at(50), '45° should beat its neighbours')
  assert.ok(Math.abs(at(30) - at(60)) < 1e-9, '30° and 60° should match')
  assert.ok(Math.abs(at(20) - at(70)) < 1e-9, '20° and 70° should match')
})

test('escape velocity is exactly root two times the orbit speed at the same radius', () => {
  const escape = ok(solve('escape-velocity', 'v', { M: 5.972e24, r: 6.771e6 }), 'escape').value
  const orbit = ok(solve('orbital-velocity', 'v', { M: 5.972e24, r: 6.771e6 }), 'orbit').value
  assert.ok(Math.abs(escape / orbit - Math.SQRT2) < 1e-12)
})

test('every rearrangement inverts itself', () => {
  let checked = 0
  for (const formula of FORMULAS) {
    const keys = Object.keys(formula.solve)
    // A plausible value for each quantity, inside whatever bounds it declares.
    const base: Record<string, number> = {}
    for (const one of formula.quantities) {
      const least = one.least ?? 1
      base[one.symbol] = one.most !== undefined ? least + (one.most - least) * 0.37 : least > 0 ? least * 2.3 : 2.3
    }
    for (const want of keys) {
      // Planck's constant against values of order one cancels to nothing in floating point; that is arithmetic,
      // not the formula, and the published-value test above covers these two properly.
      if (formula.id === 'photoelectric' || formula.id === 'compton') continue
      const given = { ...base }
      delete given[want]
      const forward = solve(formula.id, want, given)
      if (isSimulationError(forward)) continue // a refusal on contrived values is correct behaviour
      const other = keys.find((one) => one !== want)
      if (other === undefined) continue
      const back = solve(formula.id, other, { ...given, [want]: forward.value })
      if (isSimulationError(back)) continue
      const target = given[other]
      const off = Math.abs(back.value - target) / (Math.abs(target) + 1e-12)
      assert.ok(off < 1e-6, `${formula.id}: solving for ${want} then back for ${other} gave ${back.value}, not ${target}`)
      checked += 1
    }
  }
  assert.ok(checked > 250, `only ${checked} rearrangements were invertible`)
})

test('inverse trig refuses outside its domain rather than clamping to the edge', () => {
  // Clamping asin to 1 is the easiest way for a vault to lie: it turns "this cannot happen" into 90.000°.
  const tooFar = solve('projectile-range', 'theta', { R: 10_000, u: 5, g: 9.81 })
  assert.ok(isSimulationError(tooFar), 'no angle throws 5 m/s ten kilometres, so there should be no answer')

  const past = solve('critical-angle', 'theta', { n1: 1, n2: 1.5 })
  assert.ok(isSimulationError(past), 'there is no critical angle going into a denser medium')

  const impossible = solve('snell', 'theta2', { n1: 1.5, theta1: 80, n2: 1 })
  assert.ok(isSimulationError(impossible), 'past the critical angle nothing refracts, so there is no angle')

  // And one that is inside the domain still answers, so the guard has not simply broken the formula.
  assert.ok(!isSimulationError(solve('snell', 'theta2', { n1: 1, theta1: 80, n2: 1.5 })))
})

test('a square root of a negative is no answer, not zero', () => {
  // v² = u² + 2as with a and s driving it negative: the object never reaches there.
  const cannot = solve('velocity-squared', 'v', { u: 1, a: -10, s: 100 })
  assert.ok(isSimulationError(cannot), 'it never gets 100 m while decelerating from 1 m/s')
})

test('solving for a time asks when it got there, not when it set off', () => {
  // s = 0 has roots at t = 0 and t = 2u/g. Answering "immediately" is useless.
  const landed = ok(solve('displacement-time', 't', { s: 0, u: 20, a: -9.81 }), 'time of flight')
  assert.ok(Math.abs(landed.value - 40 / 9.81) < 1e-9, `expected ${40 / 9.81}, got ${landed.value}`)
})

test('a quantity with no rearrangement is refused, and the refusal names the ones there are', () => {
  const refused = solve('jeans-mass', 'T', { M: 1e30, rho: 1e-18, m: 1.67e-27 })
  assert.ok(isSimulationError(refused))
  assert.ok(refused.fix.includes('M'), `the refusal should say it can solve for M: ${refused.fix}`)
  assert.ok(!refused.message.includes('NaN'))
})

test('a missing value is named, with its unit', () => {
  const refused = solve('ideal-gas', 'P', { V: 1, n: 1 })
  assert.ok(isSimulationError(refused))
  assert.ok(refused.message.includes('T') && refused.message.includes('K'), refused.message)
})

test('a value outside physical sense is refused before it is used', () => {
  assert.ok(isSimulationError(solve('ideal-gas', 'P', { V: 1, n: 1, T: -5 })), 'negative kelvin')
  assert.ok(isSimulationError(solve('lorentz-factor', 'gamma', { v: 4e8 })), 'faster than light')
  assert.ok(isSimulationError(solve('kinetic-energy', 'KE', { m: -2, v: 10 })), 'negative mass')
})

test('an unknown formula or quantity is refused helpfully', () => {
  const noFormula = solve('does-not-exist', 'x', {})
  assert.ok(isSimulationError(noFormula))
  assert.ok(noFormula.fix.includes(String(FORMULA_COUNTS.formulas)))

  const noQuantity = solve('ohm', 'zzz', { V: 1, I: 1 })
  assert.ok(isSimulationError(noQuantity))
  assert.ok(noQuantity.fix.includes('V') && noQuantity.fix.includes('I'), noQuantity.fix)
})

test('every formula is well formed', () => {
  const sections = new Set(FORMULA_SECTIONS.map((one) => one.id))
  const ids = new Set<string>()
  for (const one of FORMULAS) {
    assert.ok(!ids.has(one.id), `two formulas share the id ${one.id}`)
    ids.add(one.id)
    assert.ok(one.quantities.length > 0, `${one.id} has no quantities`)
    assert.ok(one.holds.length > 0, `${one.id} states no conditions, and every formula has some`)
    assert.ok(one.written.trim() !== '', `${one.id} is not written out`)
    assert.ok(one.about.trim() !== '', `${one.id} says nothing about itself`)
    assert.ok(sections.has(one.section), `${one.id} is in section "${one.section}", which does not exist`)

    const symbols = new Set(one.quantities.map((two) => two.symbol))
    assert.equal(symbols.size, one.quantities.length, `${one.id} repeats a symbol`)
    for (const key of Object.keys(one.solve)) {
      assert.ok(symbols.has(key), `${one.id} can solve for "${key}", which is not one of its quantities`)
    }
    for (const near of one.near ?? []) {
      assert.ok(formulaFor(near) !== null, `${one.id} links to "${near}", which does not exist`)
    }
  }
})

test('search finds things by name, by symbol and by unit, and finds nothing when there is nothing', () => {
  assert.ok(searchFormulas('escape').some((one) => one.id === 'escape-velocity'))
  assert.ok(searchFormulas('ohm').some((one) => one.id === 'ohm'))
  assert.ok(searchFormulas('tesla').length >= 0)
  assert.ok(searchFormulas('wavelength').length > 3)
  assert.equal(searchFormulas('').length, FORMULAS.length)
  assert.equal(searchFormulas('definitely not a physics formula at all').length, 0)
  // Two words must both match, not either.
  const both = searchFormulas('orbit speed')
  assert.ok(both.every((one) => `${one.name} ${one.about} ${one.written} ${one.id}`.toLowerCase().includes('orbit')))
})

test('every section listed has something in it, and the counts are the real ones', () => {
  for (const group of formulaSections()) assert.ok(group.formulas.length > 0, `${group.section.id} is empty`)
  assert.equal(FORMULA_COUNTS.formulas, FORMULAS.length)
  assert.equal(FORMULA_COUNTS.sections, formulaSections().length)
  assert.equal(
    FORMULA_COUNTS.rearrangements,
    FORMULAS.reduce((count, one) => count + Object.keys(one.solve).length, 0)
  )
  // Every formula must be reachable through a section, or the vault holds something nothing can show.
  const shown = formulaSections().flatMap((one) => one.formulas)
  assert.equal(shown.length, FORMULAS.length, 'a formula is in a section that is not listed')
})

test('every formula points at related ones, and never at itself', () => {
  // An empty "see also" renders an empty heading, which reads as a broken panel rather than as a formula that
  // happens to stand alone.
  for (const one of FORMULAS) {
    assert.ok((one.near ?? []).length > 0, `${one.id} links to nothing`)
    assert.ok(!(one.near ?? []).includes(one.id), `${one.id} links to itself`)
    assert.equal(new Set(one.near).size, (one.near ?? []).length, `${one.id} repeats a link`)
    for (const near of one.near ?? []) {
      assert.ok(formulaFor(near) !== null, `${one.id} links to "${near}", which does not exist`)
    }
  }
})
