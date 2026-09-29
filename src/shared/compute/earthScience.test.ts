/**
 * Geodesy, atmosphere, hydrology, geology and agronomy, checked against published values and closed forms.
 *
 * The interesting cases are the ones where an engine could return a plausible number and be wrong: a Vincenty
 * distance that is really a haversine, a heat index evaluated on a winter day, a return period treated as a
 * schedule, a soil that reads 25% wet and has nothing a plant can use. Each of those has a test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ELLIPSOIDS,
  MEAN_EARTH_RADIUS,
  daylightHours,
  destinationFrom,
  distanceBetween,
  ellipsoidById,
  isGeodesyError,
  pathMetrics,
  project,
  solarPosition
} from './geodesy.ts'
import {
  airQuality,
  altitudeFromPressure,
  comfortIndex,
  humidity,
  isAtmosphereError,
  saturationVapourPressure,
  stability,
  standardAir,
  STANDARD_ATMOSPHERE
} from './atmosphere.ts'
import {
  darcyFlow,
  infiltration,
  isHydrologyError,
  rationalMethod,
  returnPeriod,
  scsRunoff,
  theisDrawdown,
  waterBalance
} from './hydrology.ts'
import {
  earthquakeEnergy,
  isGeologyError,
  overburdenStress,
  plateMotion,
  radiometricAge,
  rockById,
  slopeStability,
  waveArrivals
} from './geology.ts'
import {
  evapotranspiration,
  growingDegreeDays,
  isAgronomyError,
  nutrientBalance,
  soilWater
} from './agronomy.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

// ---------------------------------------------------------------- geodesy

test('every ellipsoid is internally consistent', () => {
  for (const one of ELLIPSOIDS) {
    near(one.semiMinor, one.semiMajor * (1 - one.flattening), 1e-6, `${one.id} polar radius`)
    assert.ok(one.semiMinor < one.semiMajor, `${one.id} should be flattened, not stretched`)
    assert.ok(one.notes.length > 0, `${one.id} has no note`)
  }
  assert.ok(isGeodesyError(ellipsoidById('flat-earth')))
})

test('a coordinate pair the wrong way round is caught rather than accepted', () => {
  const swapped = distanceBetween({
    from: { latitudeDegrees: 139.69, longitudeDegrees: 35.68 },
    to: { latitudeDegrees: 0, longitudeDegrees: 0 }
  })
  assert.ok(isGeodesyError(swapped))
  assert.ok(swapped.message.includes('wrong way round'), 'and it says what probably happened')
})

test('London to Tokyo matches the published geodesic distance', () => {
  const report = distanceBetween({
    from: { latitudeDegrees: 51.5074, longitudeDegrees: -0.1278 },
    to: { latitudeDegrees: 35.6762, longitudeDegrees: 139.6503 }
  })
  assert.ok(!isGeodesyError(report), isGeodesyError(report) ? report.message : '')
  // The WGS84 geodesic is about 9560 km.
  near(report.distance / 1000, 9560, 25, 'London to Tokyo')
  assert.ok(report.iterations !== null && report.iterations > 0, 'Vincenty is iterative and must have iterated')
  assert.ok(report.initialBearing > 0 && report.initialBearing < 90, 'it leaves London heading north-east')
  assert.ok(report.finalBearing > 90 && report.finalBearing < 180, 'and arrives in Tokyo heading south-east')
})

test('the spherical and ellipsoidal answers differ, and the difference is reported', () => {
  const report = distanceBetween({
    from: { latitudeDegrees: 0, longitudeDegrees: 0 },
    to: { latitudeDegrees: 80, longitudeDegrees: 0 }
  })
  assert.ok(!isGeodesyError(report))
  assert.notEqual(report.distance, report.sphereDistance, 'a real ellipsoid calculation cannot equal the sphere one')
  near(report.sphereError, Math.abs(report.sphereDistance - report.distance) / report.distance, 1e-12, 'the reported error')
  assert.ok(report.sphereError > 0.001, 'and over this span it is more than a tenth of a percent')
})

test('a quarter of the way round the equator is a quarter of the circumference', () => {
  const report = distanceBetween({
    from: { latitudeDegrees: 0, longitudeDegrees: 0 },
    to: { latitudeDegrees: 0, longitudeDegrees: 90 },
    model: 'sphere'
  })
  assert.ok(!isGeodesyError(report))
  near(report.distance, (2 * Math.PI * MEAN_EARTH_RADIUS) / 4, 1, 'a quarter circumference')
})

test('the same place twice is zero distance with no bearing, not an error', () => {
  const here = { latitudeDegrees: 12.34, longitudeDegrees: 56.78 }
  const report = distanceBetween({ from: here, to: here })
  assert.ok(!isGeodesyError(report))
  assert.equal(report.distance, 0)
})

test('going out on a bearing and coming back lands where it started', () => {
  const from = { latitudeDegrees: 40, longitudeDegrees: -74 }
  const out = destinationFrom({ from, bearingDegrees: 62, distance: 500000 })
  assert.ok(!isGeodesyError(out), isGeodesyError(out) ? out.message : '')
  const back = destinationFrom({ from: out.arrival, bearingDegrees: out.finalBearing + 180, distance: 500000 })
  assert.ok(!isGeodesyError(back))
  near(back.arrival.latitudeDegrees, from.latitudeDegrees, 0.01, 'back to the starting latitude')
  near(back.arrival.longitudeDegrees, from.longitudeDegrees, 0.02, 'and longitude')
})

test('a closed square on the ground has about the area its sides imply', () => {
  // One tenth of a degree of latitude is about 11.1 km; at the equator so is a tenth of longitude.
  const report = pathMetrics({
    points: [
      { latitudeDegrees: 0, longitudeDegrees: 0 },
      { latitudeDegrees: 0, longitudeDegrees: 0.1 },
      { latitudeDegrees: 0.1, longitudeDegrees: 0.1 },
      { latitudeDegrees: 0.1, longitudeDegrees: 0 }
    ],
    closed: true
  })
  assert.ok(!isGeodesyError(report), isGeodesyError(report) ? report.message : '')
  const side = (0.1 * Math.PI * MEAN_EARTH_RADIUS) / 180
  near((report.enclosedArea as number) / 1e6, (side * side) / 1e6, 2, 'area in square km')
  near(report.length / 1000, (4 * side) / 1000, 0.5, 'perimeter in km')
})

test('an open path has no area rather than a made-up one', () => {
  const report = pathMetrics({
    points: [
      { latitudeDegrees: 0, longitudeDegrees: 0 },
      { latitudeDegrees: 1, longitudeDegrees: 1 }
    ]
  })
  assert.ok(!isGeodesyError(report))
  assert.equal(report.enclosedArea, null)
})

test('Mercator reports the area exaggeration that makes Greenland look wrong', () => {
  const equator = project({ at: { latitudeDegrees: 0, longitudeDegrees: 0 }, projection: 'web-mercator' })
  const greenland = project({ at: { latitudeDegrees: 72, longitudeDegrees: -40 }, projection: 'web-mercator' })
  assert.ok(!isGeodesyError(equator) && !isGeodesyError(greenland))
  near(equator.areaFactor, 1, 1e-9, 'no distortion at the equator')
  assert.ok(greenland.areaFactor > 10, 'and a tenfold exaggeration at Greenland')
  assert.ok(greenland.warnings.length > 0, 'which is warned about')
})

test('Mercator refuses the pole rather than returning infinity', () => {
  const report = project({ at: { latitudeDegrees: 89.9, longitudeDegrees: 0 }, projection: 'web-mercator' })
  assert.ok(isGeodesyError(report))
  assert.equal(report.error, 'out-of-range')
})

test('UTM picks its own zone and puts the central meridian at 500000 east', () => {
  const report = project({ at: { latitudeDegrees: 45, longitudeDegrees: -123 }, projection: 'utm' })
  assert.ok(!isGeodesyError(report), isGeodesyError(report) ? report.message : '')
  assert.equal(report.zone, 10)
  assert.equal(report.hemisphere, 'north')
  const onMeridian = project({ at: { latitudeDegrees: 45, longitudeDegrees: -123 }, projection: 'utm', zone: 10 })
  assert.ok(!isGeodesyError(onMeridian))
  // Zone 10's central meridian is -123, so the easting should be exactly the false easting.
  near(onMeridian.x, 500000, 1, 'on the central meridian')
})

test('the sun is high at noon in summer and low in winter at the same place', () => {
  const at = { latitudeDegrees: 51.5, longitudeDegrees: 0 }
  const june = solarPosition({ at, year: 2024, month: 6, day: 21, utcHour: 12 })
  const december = solarPosition({ at, year: 2024, month: 12, day: 21, utcHour: 12 })
  assert.ok(!isGeodesyError(june) && !isGeodesyError(december))
  near(june.declination, 23.4, 0.3, 'the June solstice declination')
  near(december.declination, -23.4, 0.3, 'the December solstice declination')
  near(june.elevation, 62, 1.5, 'London midsummer noon')
  near(december.elevation, 15, 1.5, 'London midwinter noon')
  assert.ok(june.relativeIntensity > december.relativeIntensity * 2, 'which is why winter is cold')
})

test('the sun is below the horizon at midnight', () => {
  const report = solarPosition({ at: { latitudeDegrees: 51.5, longitudeDegrees: 0 }, year: 2024, month: 6, day: 21, utcHour: 0 })
  assert.ok(!isGeodesyError(report))
  assert.equal(report.daylight, false)
  assert.equal(report.airMass, null, 'and there is no air mass to report')
})

test('polar day and polar night are answers, not failures', () => {
  const summer = daylightHours({ at: { latitudeDegrees: 78, longitudeDegrees: 15 }, year: 2024, month: 6, day: 21 })
  assert.ok(!isGeodesyError(summer), isGeodesyError(summer) ? summer.message : '')
  assert.equal(summer.condition, 'polar-day')
  assert.equal(summer.sunrise, null, 'there is no sunrise to give')
  assert.equal(summer.dayLength, 24)

  const winter = daylightHours({ at: { latitudeDegrees: 78, longitudeDegrees: 15 }, year: 2024, month: 12, day: 21 })
  assert.ok(!isGeodesyError(winter))
  assert.equal(winter.condition, 'polar-night')
  assert.equal(winter.dayLength, 0)
})

test('the equator has about twelve hours of daylight all year', () => {
  for (const month of [3, 6, 9, 12]) {
    const report = daylightHours({ at: { latitudeDegrees: 0, longitudeDegrees: 0 }, year: 2024, month, day: 21 })
    assert.ok(!isGeodesyError(report))
    near(report.dayLength, 12.1, 0.2, `month ${month}`)
  }
})

// ---------------------------------------------------------------- atmosphere

test('the standard atmosphere reproduces its own sea-level values', () => {
  const sea = standardAir({ altitude: 0 })
  assert.ok(!isAtmosphereError(sea), isAtmosphereError(sea) ? sea.message : '')
  near(sea.pressure, STANDARD_ATMOSPHERE.seaLevelPressure, 1, 'sea level pressure')
  near(sea.temperature, STANDARD_ATMOSPHERE.seaLevelTemperature, 0.01, 'sea level temperature')
  near(sea.density, STANDARD_ATMOSPHERE.seaLevelDensity, 0.002, 'sea level density')
  near(sea.speedOfSound, 340.3, 0.5, 'sea level speed of sound')
})

test('pressure at 11 km matches the published tropopause value', () => {
  const report = standardAir({ altitude: 11000 })
  assert.ok(!isAtmosphereError(report))
  near(report.pressure, 22632, 20, 'tropopause pressure')
  near(report.temperature, 216.65, 0.1, 'tropopause temperature')
  assert.equal(report.layer, 'troposphere')
})

test('above the tropopause the model goes isothermal', () => {
  const report = standardAir({ altitude: 20000 })
  assert.ok(!isAtmosphereError(report))
  assert.equal(report.layer, 'lower-stratosphere')
  near(report.temperature, 216.65, 0.1, 'still the tropopause temperature')
  near(report.pressure, 5475, 30, 'the published 20 km pressure')
})

test('pressure altitude inverts the standard atmosphere', () => {
  const air = standardAir({ altitude: 3000 })
  assert.ok(!isAtmosphereError(air))
  const back = altitudeFromPressure({ pressure: air.pressure })
  assert.ok(!isAtmosphereError(back))
  near(back.pressureAltitude, 3000, 1, 'back to the altitude it came from')
})

test('a hot day at altitude gives a density altitude well above the pressure one', () => {
  const air = standardAir({ altitude: 1500 })
  assert.ok(!isAtmosphereError(air))
  const report = altitudeFromPressure({ pressure: air.pressure, temperature: 308 })
  assert.ok(!isAtmosphereError(report), isAtmosphereError(report) ? report.message : '')
  assert.ok((report.densityAltitude as number) > report.pressureAltitude + 500, 'thin hot air performs like a higher airfield')
  assert.ok(report.warnings.length > 0, 'and that gap is warned about')
})

test('saturation vapour pressure matches the published value at 20 C', () => {
  const at20 = saturationVapourPressure(20, 'buck')
  assert.ok(!isAtmosphereError(at20))
  near(at20, 2339, 10, 'saturation pressure at 20 C')
  const at100 = saturationVapourPressure(100, 'goff-gratch')
  assert.ok(!isAtmosphereError(at100))
  near(at100, 101325, 500, 'water boils at one atmosphere at 100 C')
})

test('the over-ice formula gives a lower pressure than over water', () => {
  const water = saturationVapourPressure(-20, 'buck', false)
  const ice = saturationVapourPressure(-20, 'buck', true)
  assert.ok(!isAtmosphereError(water) && !isAtmosphereError(ice))
  assert.ok(ice < water, 'ice holds water more tightly than supercooled liquid does')
  assert.ok((water - ice) / water > 0.01, 'and the difference is more than a percent')
})

test('a formula asked for outside its range refuses', () => {
  const report = saturationVapourPressure(-60, 'magnus-tetens')
  assert.ok(isAtmosphereError(report))
  assert.equal(report.error, 'outside-model')
})

test('dew point and relative humidity are consistent both ways round', () => {
  const fromRh = humidity({ temperature: 25, relativeHumidity: 60 })
  assert.ok(!isAtmosphereError(fromRh), isAtmosphereError(fromRh) ? fromRh.message : '')
  near(fromRh.dewPoint, 16.7, 0.4, 'dew point at 25 C and 60%')
  const fromDew = humidity({ temperature: 25, dewPoint: fromRh.dewPoint })
  assert.ok(!isAtmosphereError(fromDew))
  near(fromDew.relativeHumidity, 60, 1, 'and back again')
})

test('the wet bulb sits between the dew point and the air temperature', () => {
  const report = humidity({ temperature: 30, relativeHumidity: 40 })
  assert.ok(!isAtmosphereError(report), isAtmosphereError(report) ? report.message : '')
  assert.ok(report.wetBulb > report.dewPoint, 'above the dew point')
  assert.ok(report.wetBulb < report.temperature, 'and below the dry bulb')
  near(report.wetBulb, 20.0, 1.0, 'the psychrometric wet bulb at 30 C and 40%')
})

test('a dew point above the air temperature is refused as impossible air', () => {
  const report = humidity({ temperature: 20, dewPoint: 25 })
  assert.ok(isAtmosphereError(report))
  assert.equal(report.error, 'no-solution')
})

test('two humidity measures at once are refused rather than one being preferred', () => {
  const report = humidity({ temperature: 20, relativeHumidity: 50, dewPoint: 10 })
  assert.ok(isAtmosphereError(report))
  assert.ok(report.message.includes('pick one'))
})

test('the mixing ratio does not change when the air merely warms', () => {
  const cool = humidity({ temperature: 15, dewPoint: 10 })
  const warm = humidity({ temperature: 25, dewPoint: 10 })
  assert.ok(!isAtmosphereError(cool) && !isAtmosphereError(warm))
  near(warm.mixingRatio, cool.mixingRatio, 0.01, 'the same water, so the same mixing ratio')
  assert.ok(warm.relativeHumidity < cool.relativeHumidity - 20, 'while relative humidity falls a long way')
})

test('cloud base follows the 125 metres per degree of spread rule', () => {
  const report = humidity({ temperature: 20, dewPoint: 12 })
  assert.ok(!isAtmosphereError(report))
  // The dew point is recomputed from the vapour pressure, so it comes back a hundredth of a degree off what was
  // given — the spread, and the cloud base with it, moves by the same fraction.
  near(report.cloudBase as number, 8 * 125, 5, 'eight degrees of spread')
})

test('the heat index refuses a cold day instead of inventing one', () => {
  const winter = comfortIndex({ index: 'heat-index', temperature: 5, relativeHumidity: 80 })
  assert.ok(isAtmosphereError(winter))
  assert.equal(winter.error, 'outside-model')
  assert.ok(winter.message.includes('apparent-temperature'), 'and says what does apply')
})

test('the heat index matches its published table where it applies', () => {
  const report = comfortIndex({ index: 'heat-index', temperature: 35, relativeHumidity: 70 })
  assert.ok(!isAtmosphereError(report), isAtmosphereError(report) ? report.message : '')
  // 35 C / 70% is about 50 C on the NWS table.
  near(report.apparent, 50, 2, 'heat index at 35 C and 70%')
  assert.ok(report.apparent > report.actual, 'humid heat feels hotter')
})

test('wind chill refuses a warm day and refuses still air', () => {
  const warm = comfortIndex({ index: 'wind-chill', temperature: 20, windSpeed: 30 })
  assert.ok(isAtmosphereError(warm))
  const calm = comfortIndex({ index: 'wind-chill', temperature: -5, windSpeed: 1 })
  assert.ok(isAtmosphereError(calm))
  assert.ok(calm.message.includes('still air'))
})

test('wind chill matches the published value where it applies', () => {
  const report = comfortIndex({ index: 'wind-chill', temperature: -10, windSpeed: 30 })
  assert.ok(!isAtmosphereError(report), isAtmosphereError(report) ? report.message : '')
  near(report.apparent, -20, 1, 'wind chill at -10 C and 30 km/h')
  assert.ok(report.warnings.some((w) => w.includes('bare face')), 'and it says what it actually describes')
})

test('apparent temperature works across the whole range where the others do not', () => {
  for (const temperature of [-10, 5, 20, 35]) {
    const report = comfortIndex({ index: 'apparent-temperature', temperature, relativeHumidity: 60, windSpeed: 10 })
    assert.ok(!isAtmosphereError(report), `${temperature} C: ${isAtmosphereError(report) ? report.message : ''}`)
  }
})

test('an inversion and conditional instability are told apart', () => {
  const inversion = stability({ lowerTemperature: 5, upperTemperature: 8, heightDifference: 300 })
  assert.ok(!isAtmosphereError(inversion))
  assert.equal(inversion.stability, 'inversion')

  const conditional = stability({ lowerTemperature: 25, upperTemperature: 23, heightDifference: 300 })
  assert.ok(!isAtmosphereError(conditional))
  assert.equal(conditional.stability, 'conditionally-unstable')
  assert.ok(conditional.warnings.length > 0, 'the storm-making case is flagged')

  const unstable = stability({ lowerTemperature: 30, upperTemperature: 26.5, heightDifference: 300 })
  assert.ok(!isAtmosphereError(unstable))
  assert.equal(unstable.stability, 'absolutely-unstable')
})

test('the air quality index takes the worst pollutant, not the average', () => {
  const report = airQuality({ concentrations: { pm25: 5, pm10: 20, ozone: 90 } })
  assert.ok(!isAtmosphereError(report), isAtmosphereError(report) ? report.message : '')
  assert.equal(report.driver, 'ozone', 'the one pollutant that is bad sets the index')
  assert.ok(report.index > 150, 'and it is not diluted by the two that are fine')
  assert.equal(report.each.length, 3, 'all three are still reported')
})

test('a concentration above the published scale has no index rather than an invented one', () => {
  const report = airQuality({ concentrations: { pm25: 900 } })
  assert.ok(isAtmosphereError(report), 'with nothing else to score, there is no index at all')
  assert.equal(report.error, 'no-solution')
})

test('an index of 50 lands exactly on the good-moderate boundary', () => {
  const report = airQuality({ concentrations: { pm10: 54 } })
  assert.ok(!isAtmosphereError(report))
  near(report.index, 50, 0.01, 'the top of the good band')
  assert.equal(report.band, 'good')
})

// ---------------------------------------------------------------- hydrology

test('runoff rises faster than the rain that caused it', () => {
  const small = scsRunoff({ rainfall: 25, curveNumber: 75 })
  const large = scsRunoff({ rainfall: 100, curveNumber: 75 })
  assert.ok(!isHydrologyError(small) && !isHydrologyError(large))
  assert.ok(large.runoffCoefficient > small.runoffCoefficient * 1.5, 'the runoff fraction is not a constant')
  assert.ok(large.runoff > small.runoff * 4, 'four times the rain is far more than four times the runoff')
})

test('light rain on a curve number that absorbs it produces no runoff at all', () => {
  const report = scsRunoff({ rainfall: 5, curveNumber: 55 })
  assert.ok(!isHydrologyError(report), isHydrologyError(report) ? report.message : '')
  assert.equal(report.runoff, 0)
  assert.ok(report.warnings.length > 0, 'and the threshold is explained')
})

test('a wet catchment sheds far more than an average one', () => {
  const average = scsRunoff({ rainfall: 50, curveNumber: 70, moisture: 'average' })
  const wet = scsRunoff({ rainfall: 50, curveNumber: 70, moisture: 'wet' })
  const dry = scsRunoff({ rainfall: 50, curveNumber: 70, moisture: 'dry' })
  assert.ok(!isHydrologyError(average) && !isHydrologyError(wet) && !isHydrologyError(dry))
  assert.ok(wet.runoff > average.runoff * 1.5, 'saturated ground roughly doubles the runoff')
  assert.ok(dry.runoff < average.runoff, 'and dry ground absorbs more')
})

test('a land cover and soil group look up a real curve number', () => {
  const paved = scsRunoff({ rainfall: 50, landCover: 'paved', soilGroup: 'A' })
  const wood = scsRunoff({ rainfall: 50, landCover: 'woodland-good', soilGroup: 'A' })
  assert.ok(!isHydrologyError(paved) && !isHydrologyError(wood))
  assert.ok(paved.runoff > wood.runoff * 5, 'tarmac over sand sheds vastly more than woodland over sand')
  const unknown = scsRunoff({ rainfall: 50, landCover: 'moon-dust', soilGroup: 'A' })
  assert.ok(isHydrologyError(unknown))
})

test('the rational method gives Q = CiA and warns above its size limit', () => {
  const small = rationalMethod({ runoffCoefficient: 0.9, intensity: 50, area: 2 })
  assert.ok(!isHydrologyError(small), isHydrologyError(small) ? small.message : '')
  near(small.peakFlow, (0.9 * 50 * 2) / 360, 1e-9, 'CiA over 360')
  assert.equal(small.warnings.length, 0)

  const big = rationalMethod({ runoffCoefficient: 0.5, intensity: 50, area: 500 })
  assert.ok(!isHydrologyError(big))
  assert.ok(big.warnings.length > 0, 'a 500 hectare catchment is outside what it suits')
})

test('a hundred-year event is 26% likely in thirty years, not 30%', () => {
  const report = returnPeriod({ returnPeriod: 100, spans: [1, 30] })
  assert.ok(!isHydrologyError(report), isHydrologyError(report) ? report.message : '')
  near(report.annualProbability, 0.01, 1e-12, 'one percent a year')
  const thirty = report.chanceWithin.find((one) => one.years === 30)
  assert.ok(thirty)
  near(thirty.probability, 0.2603, 0.001, 'the compounded chance over thirty years')
  assert.ok(report.notes.some((n) => n.includes('not a schedule')))
})

test('an extrapolated return period is flagged', () => {
  const report = returnPeriod({ returnPeriod: 1000 })
  assert.ok(!isHydrologyError(report))
  assert.ok(report.warnings.length > 0, 'a thousand-year estimate comes from a century of records')
})

test('Horton infiltration decays from its initial rate toward its final one', () => {
  const report = infiltration({ model: 'horton', initialRate: 50, finalRate: 5, decayConstant: 2, duration: 180, samples: 181 })
  assert.ok(!isHydrologyError(report), isHydrologyError(report) ? report.message : '')
  near(report.samples[0].rate, 50, 1e-9, 'starts at the initial rate')
  assert.ok(report.finalRate < 6 && report.finalRate > 5, 'and approaches the final rate without reaching it')
  // The cumulative figure is the integral, so it must exceed the final rate times the time and be below the initial.
  assert.ok(report.totalInfiltrated > 5 * 3 && report.totalInfiltrated < 50 * 3, 'the total is between the two bounds')
})

test('Horton with rain finds the ponding time, and gentle rain never ponds', () => {
  const heavy = infiltration({ model: 'horton', initialRate: 50, finalRate: 5, decayConstant: 2, duration: 180, rainfallIntensity: 20 })
  assert.ok(!isHydrologyError(heavy))
  assert.ok(heavy.pondingTime !== null && heavy.pondingTime > 0, 'heavy rain outpaces the soil eventually')

  const gentle = infiltration({ model: 'horton', initialRate: 50, finalRate: 5, decayConstant: 2, duration: 180, rainfallIntensity: 3 })
  assert.ok(!isHydrologyError(gentle))
  assert.equal(gentle.pondingTime, null, 'rain below the final rate never ponds')
})

test('Green-Ampt is iterated and its rate falls toward the saturated conductivity', () => {
  const report = infiltration({
    model: 'green-ampt',
    conductivity: 10,
    suctionHead: 100,
    moistureDeficit: 0.3,
    duration: 600,
    samples: 121
  })
  assert.ok(!isHydrologyError(report), isHydrologyError(report) ? report.message : '')
  assert.ok(report.finalRate > 10 && report.finalRate < 20, 'approaching the saturated conductivity from above')
  assert.ok(report.totalInfiltrated > 0)
})

test('the Darcy and seepage velocities differ by the porosity', () => {
  const report = darcyFlow({ conductivity: 10, hydraulicGradient: 0.01, porosity: 0.25, travelDistance: 100 })
  assert.ok(!isHydrologyError(report), isHydrologyError(report) ? report.message : '')
  near(report.darcyVelocity, 0.1, 1e-12, 'K times i')
  near(report.seepageVelocity as number, 0.4, 1e-12, 'divided by the porosity')
  near(report.travelTime as number, 250, 1e-9, 'and the travel time uses the faster one')
})

test('omitting the porosity withholds the seepage velocity rather than guessing one', () => {
  const report = darcyFlow({ conductivity: 10, hydraulicGradient: 0.01 })
  assert.ok(!isHydrologyError(report))
  assert.equal(report.seepageVelocity, null)
  assert.ok(report.warnings.length > 0)
})

test('Theis drawdown falls with distance and grows with time', () => {
  const near1 = theisDrawdown({ pumpingRate: 1000, transmissivity: 250, storativity: 0.0002, distance: 50, time: 1 })
  const far = theisDrawdown({ pumpingRate: 1000, transmissivity: 250, storativity: 0.0002, distance: 500, time: 1 })
  const later = theisDrawdown({ pumpingRate: 1000, transmissivity: 250, storativity: 0.0002, distance: 50, time: 10 })
  assert.ok(!isHydrologyError(near1) && !isHydrologyError(far) && !isHydrologyError(later))
  assert.ok(near1.drawdown > far.drawdown, 'more drawdown close to the well')
  assert.ok(later.drawdown > near1.drawdown, 'and more as pumping continues')
  assert.ok(near1.reliable, 'and this is inside the range the series is trustworthy in')
})

test('a water balance reports its residual rather than closing itself', () => {
  const report = waterBalance({
    inflows: [{ label: 'rain', amount: 100 }],
    outflows: [{ label: 'evaporation', amount: 60 }],
    measuredStorageChange: 20
  })
  assert.ok(!isHydrologyError(report), isHydrologyError(report) ? report.message : '')
  near(report.storageChange, 40, 1e-12, 'the terms imply 40')
  assert.equal(report.closes, false, 'against a measured 20, it does not close')
  near(report.closureError as number, 0.2, 1e-12, 'and the gap is 20% of the inflow')
  assert.ok(report.warnings.length > 0)
})

test('a negative inflow is refused rather than quietly balancing the books', () => {
  const report = waterBalance({ inflows: [{ amount: -10 }], outflows: [{ amount: 5 }] })
  assert.ok(isHydrologyError(report))
  assert.ok(report.message.includes('outflows'))
})

// ---------------------------------------------------------------- geology

test('a magnitude step is ten times the shaking and 32 times the energy', () => {
  const report = earthquakeEnergy({ magnitude: 7, compareWith: 6 })
  assert.ok(!isGeologyError(report), isGeologyError(report) ? report.message : '')
  near(report.comparedWith?.amplitudeRatio ?? 0, 10, 1e-9, 'ground motion')
  near(report.comparedWith?.energyRatio ?? 0, 31.62, 0.01, 'energy')
})

test('Richter magnitude saturates and says so; moment magnitude does not', () => {
  const richter = earthquakeEnergy({ magnitude: 8.5, scale: 'local' })
  assert.ok(!isGeologyError(richter))
  assert.equal(richter.withinScaleRange, false)
  assert.ok(richter.warnings.length > 0, 'and it explains why moment magnitude replaced it')

  const moment = earthquakeEnergy({ magnitude: 8.5, scale: 'moment' })
  assert.ok(!isGeologyError(moment))
  assert.equal(moment.withinScaleRange, true)
  assert.ok(moment.seismicMoment !== null, 'and it has a physical moment behind it')
})

test('a magnitude nobody has recorded is refused', () => {
  const report = earthquakeEnergy({ magnitude: 15 })
  assert.ok(isGeologyError(report))
  assert.equal(report.error, 'out-of-range')
})

test('the S-minus-P gap grows with distance and is the warning time', () => {
  const close = waveArrivals({ distance: 20 })
  const far = waveArrivals({ distance: 300 })
  assert.ok(!isGeologyError(close) && !isGeologyError(far))
  assert.ok(far.separation > close.separation * 10, 'the gap is proportional to distance')
  assert.equal(close.warningTime, close.separation)
  assert.ok(close.warnings.length > 0, 'and close in there is no useful warning')
})

test('an S wave faster than a P wave is refused', () => {
  const report = waveArrivals({ distance: 100, pVelocity: 3, sVelocity: 6 })
  assert.ok(isGeologyError(report))
  assert.ok(report.message.includes('primary'))
})

test('one half-life leaves half the parent, and the mean life is longer', () => {
  const report = radiometricAge({ system: 'carbon-14', parentFraction: 0.5 })
  assert.ok(!isGeologyError(report), isGeologyError(report) ? report.message : '')
  near(report.age, 5730, 1, 'one half-life of carbon-14')
  near(report.halfLivesElapsed, 1, 1e-9, 'one half-life elapsed')
  near(report.meanLife, 5730 / Math.LN2, 1, 'the mean life is the half-life over ln 2')
  assert.ok(report.assumptions.length >= 4, 'and the assumptions come with it')
})

test('a daughter-to-parent ratio of 1 is also one half-life', () => {
  const report = radiometricAge({ system: 'uranium-238', daughterToParent: 1 })
  assert.ok(!isGeologyError(report))
  near(report.age, 4.468e9, 1e6, 'one half-life of uranium-238')
})

test('carbon dating past its useful range is flagged as a detection limit', () => {
  const report = radiometricAge({ system: 'carbon-14', age: 200000 })
  assert.ok(!isGeologyError(report))
  assert.equal(report.withinUsefulRange, false)
  assert.ok(report.warnings.some((w) => w.includes('detection limit')))
})

test('two dating measures at once are refused', () => {
  const report = radiometricAge({ system: 'carbon-14', parentFraction: 0.5, age: 1000 })
  assert.ok(isGeologyError(report))
})

test('plate motion accumulates the way continents actually moved', () => {
  const report = plateMotion({ rate: 40, years: 1e8 })
  assert.ok(!isGeologyError(report), isGeologyError(report) ? report.message : '')
  near(report.displacementKm, 4000, 1, 'forty mm a year for a hundred million years')
})

test('a slope holds dry and fails wet, with both reported', () => {
  const dry = slopeStability({ slopeAngle: 25, frictionAngle: 30, depth: 2, unitWeight: 19 })
  assert.ok(!isGeologyError(dry), isGeologyError(dry) ? dry.message : '')
  assert.ok(dry.factorOfSafety > 1, 'dry, this slope stands')
  near(dry.factorOfSafety, Math.tan((30 * Math.PI) / 180) / Math.tan((25 * Math.PI) / 180), 1e-9, 'tan phi over tan beta')
  assert.equal(dry.criticalAngle, 30, 'and dry granular soil stands at its friction angle')

  const wet = slopeStability({ slopeAngle: 25, frictionAngle: 30, depth: 2, unitWeight: 19, waterTableHeight: 2 })
  assert.ok(!isGeologyError(wet), isGeologyError(wet) ? wet.message : '')
  assert.ok(wet.factorOfSafety < dry.factorOfSafety, 'water pressure takes the friction away')
  assert.ok(wet.warnings.some((w) => w.includes('rain')), 'and the report says why landslides happen in the rain')
})

test('a water table above the ground is refused', () => {
  const report = slopeStability({ slopeAngle: 25, frictionAngle: 30, depth: 2, unitWeight: 19, waterTableHeight: 5 })
  assert.ok(isGeologyError(report))
})

test('rocks carry a density and a source, and an unknown one is refused', () => {
  const granite = rockById('granite')
  assert.ok(!isGeologyError(granite))
  assert.ok(granite.density > 2000 && granite.source.length > 0)
  assert.ok(isGeologyError(rockById('kryptonite')))
})

test('overburden stress splits into total and effective', () => {
  const report = overburdenStress({ depth: 1000, rock: 'sandstone', waterTableDepth: 0 })
  assert.ok(!isGeologyError(report), isGeologyError(report) ? report.message : '')
  near(report.totalStress / 1e6, (2200 * 9.80665 * 1000) / 1e6, 0.01, 'rho g h')
  near(report.porePressure / 1e6, (1000 * 9.80665 * 1000) / 1e6, 0.01, 'a full water column')
  near(report.effectiveStress, report.totalStress - report.porePressure, 1e-6, 'the difference')
  assert.ok(report.effectiveStress < report.totalStress, 'water carries part of the load')
})

// ---------------------------------------------------------------- agronomy

test('Penman-Monteith gives a sane reference ET and splits its two terms', () => {
  const report = evapotranspiration({
    maximumTemperature: 30,
    minimumTemperature: 18,
    relativeHumidity: 55,
    windSpeed: 2,
    solarRadiation: 22,
    altitude: 100,
    latitudeDegrees: 40,
    dayOfYear: 180
  })
  assert.ok(!isAgronomyError(report), isAgronomyError(report) ? report.message : '')
  assert.ok(report.referenceEt > 3 && report.referenceEt < 9, 'a summer day is a few millimetres')
  assert.ok(report.radiationTerm !== null && report.aerodynamicTerm !== null)
  near(report.referenceEt, (report.radiationTerm as number) + (report.aerodynamicTerm as number), 1e-9, 'the two terms are the whole of it')
})

test('a crop coefficient scales reference ET and is not folded in silently', () => {
  const base = evapotranspiration({
    maximumTemperature: 30,
    minimumTemperature: 18,
    relativeHumidity: 55,
    windSpeed: 2,
    solarRadiation: 22,
    latitudeDegrees: 40,
    dayOfYear: 180
  })
  const crop = evapotranspiration({
    maximumTemperature: 30,
    minimumTemperature: 18,
    relativeHumidity: 55,
    windSpeed: 2,
    solarRadiation: 22,
    latitudeDegrees: 40,
    dayOfYear: 180,
    cropCoefficient: 1.15
  })
  assert.ok(!isAgronomyError(base) && !isAgronomyError(crop))
  assert.equal(base.cropEt, null, 'without a coefficient there is no crop ET to give')
  near(crop.cropEt as number, base.referenceEt * 1.15, 1e-9, 'and with one it is a simple product')
})

test('Penman-Monteith without its data refuses and points at the alternatives', () => {
  const report = evapotranspiration({ maximumTemperature: 30, minimumTemperature: 18 })
  assert.ok(isAgronomyError(report))
  assert.ok(report.message.includes('simpler method'))
})

test('Hargreaves works on temperature alone and states its bias', () => {
  const report = evapotranspiration({
    method: 'hargreaves',
    maximumTemperature: 30,
    minimumTemperature: 18,
    latitudeDegrees: 40,
    dayOfYear: 180
  })
  assert.ok(!isAgronomyError(report), isAgronomyError(report) ? report.message : '')
  assert.ok(report.referenceEt > 2 && report.referenceEt < 10)
  assert.equal(report.radiationTerm, null, 'it cannot separate the terms because it cannot see wind')
  assert.ok(report.warnings.length > 0, 'and its bias is on the result')
})

test('degree days accumulate heat rather than days, and a cold day adds nothing', () => {
  const report = growingDegreeDays({
    days: [
      { maximum: 20, minimum: 10 },
      { maximum: 5, minimum: 0 },
      { maximum: 25, minimum: 15 }
    ],
    baseTemperature: 10
  })
  assert.ok(!isAgronomyError(report), isAgronomyError(report) ? report.message : '')
  near(report.daily[0].degreeDays, 5, 1e-12, 'mean 15 above a base of 10')
  near(report.daily[1].degreeDays, 0, 1e-12, 'a cold day contributes nothing, and does not subtract')
  near(report.accumulated, 15, 1e-12, 'five plus nothing plus ten')
  assert.ok(report.warnings.length > 0, 'and running without a cap is warned about')
})

test('an upper cap stops hot days being counted as extra progress', () => {
  const days = [{ maximum: 40, minimum: 25 }]
  const uncapped = growingDegreeDays({ days, baseTemperature: 10 })
  const capped = growingDegreeDays({ days, baseTemperature: 10, upperThreshold: 30 })
  assert.ok(!isAgronomyError(uncapped) && !isAgronomyError(capped))
  near(uncapped.accumulated, 22.5, 1e-12, 'mean 32.5 above 10')
  near(capped.accumulated, 17.5, 1e-12, 'with the maximum held at 30, mean 27.5')
  assert.equal(capped.method, 'capped-average')
})

test('the day a degree-day target is reached is found', () => {
  const report = growingDegreeDays({
    days: Array.from({ length: 20 }, () => ({ maximum: 25, minimum: 15 })),
    baseTemperature: 10,
    target: 50
  })
  assert.ok(!isAgronomyError(report))
  assert.equal(report.dayTargetReached, 5, 'ten a day reaches fifty on the fifth')
})

test('available water is not water content, and clay proves it', () => {
  const clay = soilWater({ texture: 'clay', rootDepth: 1, currentWaterContent: 0.25 })
  assert.ok(!isAgronomyError(clay), isAgronomyError(clay) ? clay.message : '')
  assert.equal(clay.currentlyAvailable, 0, 'at 25% a clay soil is below its wilting point')
  assert.ok(clay.warnings.some((w) => w.includes('cannot get')), 'and the report says so plainly')

  const sandyLoam = soilWater({ texture: 'sandy-loam', rootDepth: 1, currentWaterContent: 0.25 })
  assert.ok(!isAgronomyError(sandyLoam))
  assert.ok((sandyLoam.currentlyAvailable as number) > 0, 'the same reading in sandy loam is above field capacity')
})

test('total available water follows from the two soil constants and the root depth', () => {
  const report = soilWater({ texture: 'loam', rootDepth: 0.8 })
  assert.ok(!isAgronomyError(report), isAgronomyError(report) ? report.message : '')
  near(report.totalAvailableWater, (0.28 - 0.14) * 0.8 * 1000, 1e-9, 'available fraction over the root zone')
  near(report.readilyAvailable, report.totalAvailableWater * 0.5, 1e-9, 'half of it before irrigation is due')
})

test('irrigation is due at the depletion threshold and the amount is the deficit to field capacity', () => {
  const report = soilWater({ texture: 'loam', rootDepth: 1, currentWaterContent: 0.2, allowableDepletion: 0.5 })
  assert.ok(!isAgronomyError(report), isAgronomyError(report) ? report.message : '')
  near(report.depletion as number, (0.28 - 0.2) / (0.28 - 0.14), 1e-9, 'the fraction used')
  assert.equal(report.irrigationDue, true)
  near(report.irrigationRequired as number, (0.28 - 0.2) * 1000, 1e-9, 'back to field capacity')
})

test('a wilting point above field capacity is refused', () => {
  const report = soilWater({ fieldCapacity: 0.1, wiltingPoint: 0.3, rootDepth: 1 })
  assert.ok(isAgronomyError(report))
  assert.ok(report.message.includes('which is which'))
})

test('a fertiliser recommendation is refused without a soil test', () => {
  const report = nutrientBalance({ requirements: [{ nutrient: 'nitrogen', cropRemoval: 180 }] })
  assert.ok(isAgronomyError(report))
  assert.equal(report.error, 'needs-soil-test')
  assert.ok(report.message.includes('specific to your field'))
})

test('use efficiency is applied, and phosphorus needs far more than it removes', () => {
  const report = nutrientBalance({
    requirements: [
      { nutrient: 'nitrogen', cropRemoval: 180, soilSupply: 60 },
      { nutrient: 'phosphorus', cropRemoval: 30, soilSupply: 10 }
    ]
  })
  assert.ok(!isAgronomyError(report), isAgronomyError(report) ? report.message : '')
  const n = report.each.find((one) => one.nutrient === 'nitrogen')
  const p = report.each.find((one) => one.nutrient === 'phosphorus')
  assert.ok(n && p)
  near(n.deficit, 120, 1e-9, 'the shortfall')
  near(n.applicationRate, 120 / 0.6, 1e-9, 'divided by 60% efficiency')
  near(p.applicationRate, 20 / 0.2, 1e-9, 'and phosphorus by 20%')
  assert.ok(p.applicationRate > p.deficit * 4, 'so phosphorus needs several times what the crop takes')
  assert.equal(p.mobile, false, 'because it binds to the soil rather than leaching')
})

test('a soil already supplying more than the crop removes gets no recommendation', () => {
  const report = nutrientBalance({ requirements: [{ nutrient: 'potassium', cropRemoval: 50, soilSupply: 200 }] })
  assert.ok(!isAgronomyError(report))
  assert.equal(report.each[0].applicationRate, 0)
  assert.ok(report.warnings.length > 0, 'and the surplus is flagged')
})
