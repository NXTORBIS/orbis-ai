/**
 * The earth-science bridge, tested through the door a Page actually knocks on.
 *
 * The engines have their own tests. What is checked here is the boundary: that every advertised operation has an
 * implementation, that a coordinate cannot arrive as an ambiguous pair, that no operation reads the system clock,
 * and that a refusal arrives as a value with a reason on it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EARTH_CAPABILITY, EARTH_LIMITS, runEarthOperation } from './earthEngines.ts'
import { BadInput } from './engines.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runEarthOperation(operation, input) as Record<string, unknown>

const ok = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const result = run(operation, input)
  assert.equal(result.ok, true, `${operation} failed: ${String(result.message ?? '')}`)
  return result
}

const near = (actual: unknown, expected: number, tolerance: number, what: string): void => {
  assert.equal(typeof actual, 'number', `${what} is not a number`)
  assert.ok(Math.abs((actual as number) - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

test('every advertised operation has an implementation', () => {
  for (const operation of Object.keys(EARTH_CAPABILITY)) {
    try {
      runEarthOperation(operation, {})
    } catch (error) {
      assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput: ${String(error)}`)
      assert.ok(
        !/is not an earth-science operation/.test(error.message),
        `${operation} is advertised but has no implementation`
      )
    }
  }
})

test('every operation asks for the same capability, and it is the earth one', () => {
  for (const [operation, capability] of Object.entries(EARTH_CAPABILITY)) {
    assert.equal(capability, 'computation.earth', `${operation} asks for something else`)
  }
})

test('an operation nobody advertises is refused', () => {
  assert.throws(() => runEarthOperation('earth.summon-rain', {}), BadInput)
})

test('nothing in this bridge or its engines reads the system clock', () => {
  // The whole point of taking a date as an argument is that results are reproducible and a Page can ask about any
  // day. A Date.now() anywhere in this stack would quietly break that, so it is checked rather than trusted.
  const here = dirname(fileURLToPath(import.meta.url))
  const files = [
    join(here, 'earthEngines.ts'),
    join(here, '..', '..', 'shared', 'compute', 'geodesy.ts'),
    join(here, '..', '..', 'shared', 'compute', 'atmosphere.ts'),
    join(here, '..', '..', 'shared', 'compute', 'hydrology.ts'),
    join(here, '..', '..', 'shared', 'compute', 'geology.ts'),
    join(here, '..', '..', 'shared', 'compute', 'agronomy.ts')
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const forbidden of ['Date.now(', 'new Date(', 'performance.now(']) {
      assert.ok(!source.includes(forbidden), `${file} uses ${forbidden}`)
    }
  }
})

// ---------------------------------------------------------------- maps

test('a coordinate has to arrive as named fields, not a bare pair', () => {
  assert.throws(() => runEarthOperation('map.distance', { from: [51.5, 0], to: [35.7, 139.7] }), BadInput)
  assert.throws(() => runEarthOperation('map.distance', { from: { latitudeDegrees: 51.5 }, to: {} }), BadInput)
})

test('a distance comes back with both the ellipsoid and sphere answers', () => {
  const result = ok('map.distance', {
    from: { latitudeDegrees: 51.5074, longitudeDegrees: -0.1278 },
    to: { latitudeDegrees: 48.8566, longitudeDegrees: 2.3522 }
  })
  near((result.distance as number) / 1000, 344, 3, 'London to Paris')
  assert.ok((result.iterations as number) > 0, 'Vincenty iterated')
  assert.notEqual(result.distance, result.sphereDistance)
})

test('a latitude off the Earth is refused with an explanation', () => {
  const result = run('map.distance', {
    from: { latitudeDegrees: 139.7, longitudeDegrees: 35.7 },
    to: { latitudeDegrees: 0, longitudeDegrees: 0 }
  })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('wrong way round'))
})

test('a projection reports its own distortion', () => {
  const result = ok('map.project', { at: { latitudeDegrees: 72, longitudeDegrees: -40 }, projection: 'web-mercator' })
  assert.ok((result.areaFactor as number) > 10, 'Mercator exaggerates area enormously up there')
  assert.ok(typeof result.distorts === 'string' && (result.distorts as string).length > 0)
})

test('a path is thinned on the way out without moving its totals', () => {
  const points = Array.from({ length: 200 }, (_, i) => ({ latitudeDegrees: i * 0.01, longitudeDegrees: 0 }))
  const full = ok('map.path', { points, legs: 500 })
  const thinned = ok('map.path', { points, legs: 20 })
  assert.equal((full.legs as unknown[]).length, 199)
  assert.equal((thinned.legs as unknown[]).length, 20)
  assert.equal(thinned.length, full.length, 'the total comes from the calculation, not the trace')
})

// ---------------------------------------------------------------- the sun

test('the sun position takes a date rather than assuming today', () => {
  const at = { latitudeDegrees: 51.5, longitudeDegrees: 0 }
  const summer = ok('sun.position', { at, year: 2024, month: 6, day: 21, utcHour: 12 })
  const winter = ok('sun.position', { at, year: 2024, month: 12, day: 21, utcHour: 12 })
  assert.ok((summer.elevation as number) > (winter.elevation as number) + 40, 'and the two dates differ as they should')
})

test('an hour outside the day is refused', () => {
  const result = run('sun.position', {
    at: { latitudeDegrees: 0, longitudeDegrees: 0 },
    year: 2024,
    month: 1,
    day: 1,
    utcHour: 25
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'out-of-range')
})

test('polar day comes back as a condition with no sunrise, not as a failure', () => {
  const result = ok('sun.daylight', { at: { latitudeDegrees: 78, longitudeDegrees: 15 }, year: 2024, month: 6, day: 21 })
  assert.equal(result.condition, 'polar-day')
  assert.equal(result.sunrise, null)
})

// ---------------------------------------------------------------- the atmosphere

test('the standard atmosphere and pressure altitude agree with each other', () => {
  const air = ok('air.standard', { altitude: 5000 })
  const back = ok('air.altitude', { pressure: air.pressure })
  near(back.pressureAltitude, 5000, 1, 'round trip')
})

test('humidity refuses a temperature with no measure of wetness, and refuses two', () => {
  const none = run('weather.humidity', { temperature: 20 })
  assert.equal(none.ok, false)
  const both = run('weather.humidity', { temperature: 20, relativeHumidity: 50, dewPoint: 10 })
  assert.equal(both.ok, false)
  assert.ok((both.message as string).includes('pick one'))
})

test('humidity gives the dew point, wet bulb and mixing ratio together', () => {
  const result = ok('weather.humidity', { temperature: 30, relativeHumidity: 50 })
  assert.ok((result.dewPoint as number) < 30 && (result.wetBulb as number) < 30)
  assert.ok((result.wetBulb as number) > (result.dewPoint as number))
  assert.ok((result.mixingRatio as number) > 0)
  assert.ok((result.cloudBase as number) > 0)
})

test('the heat index refuses a cold day through the door too', () => {
  const result = run('weather.comfort', { index: 'heat-index', temperature: 2, relativeHumidity: 90 })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'outside-model')
})

test('apparent temperature answers where the narrower indices will not', () => {
  const result = ok('weather.comfort', { index: 'apparent-temperature', temperature: 2, relativeHumidity: 90, windSpeed: 20 })
  assert.ok(typeof result.band === 'string')
})

test('an index nobody defined is refused', () => {
  assert.throws(() => runEarthOperation('weather.comfort', { index: 'feels-nice', temperature: 20 }), BadInput)
})

test('air quality names the pollutant that set the index', () => {
  const result = ok('air.quality', { concentrations: { pm25: 5, ozone: 95 } })
  assert.equal(result.driver, 'ozone')
  assert.equal((result.each as unknown[]).length, 2, 'both are still listed')
})

test('air quality with nothing given is refused', () => {
  assert.throws(() => runEarthOperation('air.quality', { concentrations: {} }), BadInput)
})

// ---------------------------------------------------------------- water

test('runoff can be worked out from a land cover and soil group', () => {
  const paved = ok('water.runoff', { rainfall: 60, landCover: 'paved', soilGroup: 'C' })
  const wood = ok('water.runoff', { rainfall: 60, landCover: 'woodland-good', soilGroup: 'C' })
  assert.ok((paved.runoff as number) > (wood.runoff as number))
})

test('a land cover nobody tabulated is refused with the list', () => {
  const result = run('water.runoff', { rainfall: 60, landCover: 'astroturf', soilGroup: 'C' })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('paved'), 'and it says what is available')
})

test('a return period comes back as probabilities', () => {
  const result = ok('water.return-period', { returnPeriod: 100, spans: [30] })
  near(result.annualProbability, 0.01, 1e-12, 'one percent a year')
  const spans = result.chanceWithin as { years: number; probability: number }[]
  near(spans[0].probability, 0.2603, 0.001, 'and 26% over thirty years')
})

test('an infiltration trace is thinned without moving the total', () => {
  const base = { model: 'horton', initialRate: 50, finalRate: 5, decayConstant: 2, duration: 180, samples: 601 }
  const full = ok('water.infiltration', { ...base, trace: 601 })
  const thinned = ok('water.infiltration', { ...base, trace: 30 })
  assert.equal((full.samples as unknown[]).length, 601)
  assert.equal((thinned.samples as unknown[]).length, 30)
  assert.equal(thinned.totalInfiltrated, full.totalInfiltrated)
})

test('a trace cannot be asked for more samples than the door allows', () => {
  const result = ok('water.infiltration', {
    model: 'horton',
    initialRate: 50,
    finalRate: 5,
    decayConstant: 2,
    duration: 60,
    trace: 1_000_000
  })
  assert.ok((result.samples as unknown[]).length <= EARTH_LIMITS.samples)
})

test('Darcy withholds the seepage velocity when no porosity was given', () => {
  const without = ok('water.darcy', { conductivity: 10, hydraulicGradient: 0.01 })
  assert.equal(without.seepageVelocity, null)
  const with_ = ok('water.darcy', { conductivity: 10, hydraulicGradient: 0.01, porosity: 0.25 })
  near(with_.seepageVelocity, 0.4, 1e-12, 'four times the Darcy velocity')
})

test('a water balance reports its residual through the door', () => {
  const result = ok('water.balance', {
    inflows: [{ label: 'rain', amount: 100 }],
    outflows: [{ label: 'evaporation', amount: 60 }],
    measuredStorageChange: 20
  })
  assert.equal(result.closes, false)
  near(result.closureError, 0.2, 1e-12, 'the gap as a fraction of the inflow')
})

// ---------------------------------------------------------------- rock

test('Richter saturation is reported rather than hidden', () => {
  const richter = ok('quake.magnitude', { magnitude: 8.5, scale: 'local' })
  assert.equal(richter.withinScaleRange, false)
  assert.ok((richter.warnings as string[]).length > 0)
  const moment = ok('quake.magnitude', { magnitude: 8.5, scale: 'moment' })
  assert.equal(moment.withinScaleRange, true)
})

test('wave arrivals use crustal defaults and can be overridden', () => {
  const standard = ok('quake.arrivals', { distance: 100 })
  near(standard.pVelocity, 6, 1e-12, 'the default P velocity')
  const custom = ok('quake.arrivals', { distance: 100, pVelocity: 8, sVelocity: 4.5 })
  assert.ok((custom.separation as number) < (standard.separation as number))
})

test('a radiometric age arrives with its assumptions listed', () => {
  const result = ok('rock.dating', { system: 'carbon-14', parentFraction: 0.5 })
  near(result.age, 5730, 1, 'one half-life')
  assert.ok((result.assumptions as string[]).length >= 4)
})

test('two dating measures at once are refused', () => {
  const result = run('rock.dating', { system: 'carbon-14', parentFraction: 0.5, age: 1000 })
  assert.equal(result.ok, false)
})

test('a slope is dry by default and wetting it is visible', () => {
  const dry = ok('rock.slope', { slopeAngle: 25, frictionAngle: 30, depth: 2, unitWeight: 19 })
  const wet = ok('rock.slope', { slopeAngle: 25, frictionAngle: 30, depth: 2, unitWeight: 19, waterTableHeight: 2 })
  assert.equal(dry.saturated, false)
  assert.equal(wet.saturated, true)
  assert.ok((wet.factorOfSafety as number) < (dry.factorOfSafety as number))
})

// ---------------------------------------------------------------- farming

test('Penman-Monteith refuses without its readings and points at the alternatives', () => {
  const result = run('farm.evapotranspiration', { maximumTemperature: 30, minimumTemperature: 18 })
  assert.equal(result.ok, false)
  assert.ok((result.message as string).includes('simpler method'))
})

test('Hargreaves works on temperature and date alone, with its bias attached', () => {
  const result = ok('farm.evapotranspiration', {
    method: 'hargreaves',
    maximumTemperature: 30,
    minimumTemperature: 18,
    latitudeDegrees: 40,
    dayOfYear: 180
  })
  assert.ok((result.referenceEt as number) > 0)
  assert.ok(typeof result.bias === 'string' && (result.bias as string).length > 0)
  assert.ok((result.warnings as string[]).length > 0)
})

test('degree days are thinned on the way out without moving the total', () => {
  const days = Array.from({ length: 300 }, () => ({ maximum: 25, minimum: 15 }))
  const full = ok('farm.degree-days', { days, baseTemperature: 10, trace: 400 })
  const thinned = ok('farm.degree-days', { days, baseTemperature: 10, trace: 25 })
  assert.equal((full.daily as unknown[]).length, 300)
  assert.equal((thinned.daily as unknown[]).length, 25)
  assert.equal(thinned.accumulated, full.accumulated)
})

test('soil water reports available water, not just content', () => {
  const result = ok('farm.soil-water', { texture: 'clay', rootDepth: 1, currentWaterContent: 0.25 })
  assert.equal(result.currentlyAvailable, 0, 'a clay soil at 25% is below its wilting point')
  assert.ok((result.warnings as string[]).length > 0)
})

test('a fertiliser recommendation is refused without a soil test', () => {
  const result = run('farm.nutrients', { requirements: [{ nutrient: 'nitrogen', cropRemoval: 180 }] })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'needs-soil-test')
})

test('a soil supply of zero is a test result and is accepted', () => {
  // Zero is a measurement, not a missing value — which is why the reader does not default it.
  const result = ok('farm.nutrients', { requirements: [{ nutrient: 'nitrogen', cropRemoval: 180, soilSupply: 0 }] })
  const each = result.each as { applicationRate: number }[]
  near(each[0].applicationRate, 180 / 0.6, 1e-9, 'the whole requirement, divided by use efficiency')
})

test('a nutrient nobody defined is refused', () => {
  assert.throws(
    () => runEarthOperation('farm.nutrients', { requirements: [{ nutrient: 'unobtainium', cropRemoval: 1, soilSupply: 0 }] }),
    BadInput
  )
})

// ---------------------------------------------------------------- provenance

test('the assumptions cover every domain this bridge answers for', () => {
  const result = ok('earth.assumptions')
  for (const domain of ['geodesy', 'atmosphere', 'hydrology', 'geology', 'agronomy']) {
    assert.ok(
      Array.isArray(result[domain]) && (result[domain] as unknown[]).length > 0,
      `${domain} has no assumptions listed`
    )
  }
})

test('the reference tables come back with their sources', () => {
  assert.ok((ok('water.land-covers').source as string).length > 0)
  assert.ok((ok('farm.soil-textures').source as string).length > 0)
  assert.ok((ok('air.pollutants').source as string).length > 0)
})
