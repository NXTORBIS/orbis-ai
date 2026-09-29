/**
 * The earth-science workbench a Page can reach: maps, weather, water, rock and farming.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## No clock, and that is deliberate
 *
 * Every calculation that involves a date takes the year, month, day and hour as arguments. Nothing here reads the
 * system time, which means a Page asking about last Tuesday gets last Tuesday, a Page asking about a solstice in
 * 1890 gets that, and the results are reproducible. A Page that wants "now" asks the Page Runtime for the time and
 * passes it in, so the reading is visible rather than hidden inside an engine.
 *
 * ## What is capped here and what is not
 *
 * The engines sample infiltration over thousands of steps and integrate degree days over a whole season. This door
 * caps what comes *back*, not what is computed: a curve is calculated at whatever resolution it was given and only
 * the sampled trace crosses the boundary.
 *
 * ## The operations that refuse rather than default
 *
 * `weather.comfort` refuses a heat index on a cold day and wind chill in still air, because both formulas produce
 * numbers outside their range that read like measurements. `farm.nutrients` refuses a fertiliser recommendation
 * without a soil test. `map.distance` refuses a latitude above 90 and says the pair is probably the wrong way
 * round. `quake.magnitude` reports that Richter saturates rather than quietly returning the saturated figure.
 */

import {
  ELLIPSOIDS,
  GEODESY_ASSUMPTIONS,
  MEAN_EARTH_RADIUS,
  PROJECTIONS,
  PROJECTION_FACTS,
  daylightHours,
  destinationFrom,
  distanceBetween,
  ellipsoidById,
  isGeodesyError,
  pathMetrics,
  project,
  solarPosition,
  type Coordinate
} from '../../shared/compute/geodesy.ts'
import {
  AQI_BREAKPOINTS,
  AQI_SOURCE,
  ATMOSPHERE_ASSUMPTIONS,
  COMFORT_FACTS,
  COMFORT_INDICES,
  POLLUTANTS,
  SATURATION_FACTS,
  SATURATION_FORMULAS,
  STANDARD_ATMOSPHERE,
  airQuality,
  altitudeFromPressure,
  comfortIndex,
  humidity,
  isAtmosphereError,
  saturationVapourPressure,
  stability,
  standardAir,
  type Pollutant
} from '../../shared/compute/atmosphere.ts'
import {
  CURVE_NUMBERS,
  CURVE_NUMBER_SOURCE,
  HYDROLOGY_ASSUMPTIONS,
  SOIL_GROUPS,
  SOIL_GROUP_FACTS,
  darcyFlow,
  infiltration,
  isHydrologyError,
  rationalMethod,
  returnPeriod,
  scsRunoff,
  theisDrawdown,
  waterBalance,
  type MoistureCondition,
  type SoilGroup
} from '../../shared/compute/hydrology.ts'
import {
  GEOLOGY_ASSUMPTIONS,
  ISOTOPE_SYSTEMS,
  MAGNITUDE_FACTS,
  MAGNITUDE_SCALES,
  ROCK_TYPES,
  earthquakeEnergy,
  isGeologyError,
  isotopeById,
  overburdenStress,
  plateMotion,
  radiometricAge,
  rockById,
  slopeStability,
  waveArrivals,
  type MagnitudeScale
} from '../../shared/compute/geology.ts'
import {
  AGRONOMY_ASSUMPTIONS,
  ET_FACTS,
  ET_METHODS,
  NUTRIENTS,
  NUTRIENT_FACTS,
  SOIL_TEXTURES,
  SOIL_WATER,
  SOIL_WATER_SOURCE,
  evapotranspiration,
  growingDegreeDays,
  isAgronomyError,
  nutrientBalance,
  soilWater,
  type Nutrient,
  type SoilTexture
} from '../../shared/compute/agronomy.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can measure a distance on a map can also work out a dew point, and
 * splitting them into five permissions would ask the user five questions about the same thing — arithmetic that
 * reaches nothing outside the Page.
 */
export const EARTH_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- maps and the sun
  'map.ellipsoids': 'computation.earth',
  'map.distance': 'computation.earth',
  'map.destination': 'computation.earth',
  'map.path': 'computation.earth',
  'map.project': 'computation.earth',
  'map.projections': 'computation.earth',
  'sun.position': 'computation.earth',
  'sun.daylight': 'computation.earth',

  // ---- the atmosphere
  'air.standard': 'computation.earth',
  'air.altitude': 'computation.earth',
  'air.saturation': 'computation.earth',
  'air.formulas': 'computation.earth',
  'weather.humidity': 'computation.earth',
  'weather.comfort': 'computation.earth',
  'weather.indices': 'computation.earth',
  'weather.stability': 'computation.earth',
  'air.quality': 'computation.earth',
  'air.pollutants': 'computation.earth',

  // ---- water
  'water.runoff': 'computation.earth',
  'water.land-covers': 'computation.earth',
  'water.peak-flow': 'computation.earth',
  'water.return-period': 'computation.earth',
  'water.infiltration': 'computation.earth',
  'water.darcy': 'computation.earth',
  'water.well': 'computation.earth',
  'water.balance': 'computation.earth',

  // ---- rock
  'quake.magnitude': 'computation.earth',
  'quake.scales': 'computation.earth',
  'quake.arrivals': 'computation.earth',
  'rock.dating': 'computation.earth',
  'rock.isotopes': 'computation.earth',
  'rock.plate-motion': 'computation.earth',
  'rock.slope': 'computation.earth',
  'rock.types': 'computation.earth',
  'rock.get': 'computation.earth',
  'rock.overburden': 'computation.earth',

  // ---- farming
  'farm.evapotranspiration': 'computation.earth',
  'farm.et-methods': 'computation.earth',
  'farm.degree-days': 'computation.earth',
  'farm.soil-water': 'computation.earth',
  'farm.soil-textures': 'computation.earth',
  'farm.nutrients': 'computation.earth',
  'farm.nutrient-facts': 'computation.earth',

  // ---- provenance
  'earth.assumptions': 'computation.earth'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const EARTH_LIMITS = Object.freeze({
  points: 2000,
  samples: 2000,
  days: 400,
  spans: 64,
  terms: 128,
  nutrients: 12
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

function objectAt(read: Reader, key: string): Reader {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object.`)
  }
  return new Reader(raw as Record<string, unknown>)
}

/**
 * A latitude and longitude, read as named fields.
 *
 * Never as a bare pair: latitude-then-longitude and longitude-then-latitude are both in wide use, they look
 * identical as two numbers, and swapping them puts a place in the wrong hemisphere. The engine catches an
 * out-of-range latitude, and this makes the intent explicit before it gets there.
 */
function coordinateAt(read: Reader, key: string): Coordinate {
  const entry = objectAt(read, key)
  return {
    latitudeDegrees: entry.number('latitudeDegrees'),
    longitudeDegrees: entry.number('longitudeDegrees')
  }
}

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

/**
 * Reads a group of arguments where the engine requires some of them but no single one of them.
 *
 * Passing the reader in is what makes the operation invisible to the generation catalogue, and that is the point:
 * humidity needs a relative humidity or a dew point or a wet bulb, a soil needs a texture or a pair of measured
 * constants. None of those can be written as "this argument is required", so an operation offered with only the
 * arguments a static reader can see would pass the argument check and then be refused by the engine.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

function coordinatesOf(read: Reader): Coordinate[] {
  return read.list('points', EARTH_LIMITS.points).map((one) => {
    const entry = new Reader(one)
    return {
      latitudeDegrees: entry.number('latitudeDegrees'),
      longitudeDegrees: entry.number('longitudeDegrees')
    }
  })
}

/** Cut a long sample trace down to what a chart can use, keeping both ends. */
function thin<T>(samples: readonly T[], wanted: number): readonly T[] {
  if (samples.length <= wanted) return samples
  const step = (samples.length - 1) / (wanted - 1)
  const out: T[] = []
  for (let i = 0; i < wanted; i += 1) out.push(samples[Math.round(i * step)])
  return out
}

// ---------------------------------------------------------------- dispatch

export function runEarthOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- maps
    case 'map.ellipsoids':
      return { ok: true, ellipsoids: ELLIPSOIDS, meanRadius: MEAN_EARTH_RADIUS }

    case 'map.distance': {
      const model = read.optionalText('model', 'ellipsoid', 16)
      if (model !== 'ellipsoid' && model !== 'sphere') {
        throw new BadInput(`"${model}" is not a model; use "ellipsoid" or "sphere".`)
      }
      return settle(
        distanceBetween({
          from: coordinateAt(read, 'from'),
          to: coordinateAt(read, 'to'),
          model,
          ellipsoid: read.optionalText('ellipsoid', '', 32) || undefined
        }),
        isGeodesyError
      )
    }

    case 'map.destination':
      return settle(
        destinationFrom({
          from: coordinateAt(read, 'from'),
          bearingDegrees: read.number('bearingDegrees'),
          distance: read.number('distance')
        }),
        isGeodesyError
      )

    case 'map.path': {
      const built = pathMetrics({ points: coordinatesOf(read), closed: read.boolean('closed', false) })
      if (isGeodesyError(built)) return { ok: false, ...built }
      const wanted = Math.max(1, Math.min(Math.round(read.optionalNumber('legs', 500)), EARTH_LIMITS.points))
      return { ok: true, ...built, legs: thin(built.legs, wanted) }
    }

    case 'map.project':
      return settle(
        project({
          at: coordinateAt(read, 'at'),
          projection: choice(read, 'projection', PROJECTIONS, 'web-mercator'),
          zone: read.has('zone') ? Math.round(read.number('zone')) : undefined
        }),
        isGeodesyError
      )

    case 'map.projections':
      return { ok: true, projections: PROJECTIONS, facts: PROJECTION_FACTS }

    // ---------------------------------------------------------------- the sun
    case 'sun.position':
      // The date is an argument, never the system clock: a Page asking about a solstice in 1890 gets 1890, and
      // every answer here is reproducible.
      return settle(
        solarPosition({
          at: coordinateAt(read, 'at'),
          year: Math.round(read.number('year')),
          month: Math.round(read.number('month')),
          day: Math.round(read.number('day')),
          utcHour: read.number('utcHour')
        }),
        isGeodesyError
      )

    case 'sun.daylight':
      return settle(
        daylightHours({
          at: coordinateAt(read, 'at'),
          year: Math.round(read.number('year')),
          month: Math.round(read.number('month')),
          day: Math.round(read.number('day'))
        }),
        isGeodesyError
      )

    // ---------------------------------------------------------------- the atmosphere
    case 'air.standard':
      return settle(standardAir({ altitude: read.number('altitude') }), isAtmosphereError)

    case 'air.altitude': {
      const temperature = optionalGroup(read, ['temperature'])
      return settle(altitudeFromPressure({ pressure: read.number('pressure'), ...temperature }), isAtmosphereError)
    }

    case 'air.saturation': {
      const built = saturationVapourPressure(
        read.number('celsius'),
        read.choice('formula', SATURATION_FORMULAS, 'buck'),
        read.boolean('overIce', false)
      )
      return isAtmosphereError(built) ? { ok: false, ...built } : { ok: true, pressure: built }
    }

    case 'air.formulas':
      return { ok: true, formulas: SATURATION_FORMULAS, facts: SATURATION_FACTS, standardAtmosphere: STANDARD_ATMOSPHERE }

    case 'weather.humidity': {
      // One of relativeHumidity, dewPoint or wetBulb is needed and none of them alone is required, so they are
      // read as a group.
      const wetness = optionalGroup(read, ['relativeHumidity', 'dewPoint', 'wetBulb', 'pressure'])
      return settle(
        humidity({
          temperature: read.number('temperature'),
          formula: choice(read, 'formula', SATURATION_FORMULAS, 'buck'),
          ...wetness
        }),
        isAtmosphereError
      )
    }

    case 'weather.comfort': {
      // Which of these an index needs depends on the index, so they are read as a group.
      const conditions = optionalGroup(read, ['relativeHumidity', 'windSpeed', 'dewPoint'])
      return settle(
        comfortIndex({
          index: choice(read, 'index', COMFORT_INDICES, 'apparent-temperature'),
          temperature: read.number('temperature'),
          ...conditions
        }),
        isAtmosphereError
      )
    }

    case 'weather.indices':
      return { ok: true, indices: COMFORT_INDICES, facts: COMFORT_FACTS }

    case 'weather.stability':
      return settle(
        stability({
          lowerTemperature: read.number('lowerTemperature'),
          upperTemperature: read.number('upperTemperature'),
          heightDifference: read.number('heightDifference'),
          // 0.005 K/m is the usual saturated rate. A real default, so it is read directly and stays visible.
          saturatedRate: read.optionalNumber('saturatedRate', 0.005)
        }),
        isAtmosphereError
      )

    case 'air.quality': {
      const concentrations: Partial<Record<Pollutant, number>> = {}
      const given = objectAt(read, 'concentrations')
      for (const pollutant of POLLUTANTS) {
        if (given.has(pollutant)) concentrations[pollutant] = given.number(pollutant)
      }
      if (Object.keys(concentrations).length === 0) {
        throw new BadInput(`Give at least one of: ${POLLUTANTS.join(', ')}.`)
      }
      return settle(airQuality({ concentrations }), isAtmosphereError)
    }

    case 'air.pollutants':
      return { ok: true, pollutants: POLLUTANTS, breakpoints: AQI_BREAKPOINTS, source: AQI_SOURCE }

    // ---------------------------------------------------------------- water
    case 'water.runoff': {
      // A curve number, or a land cover and a soil group to look one up. Neither route is required on its own.
      const direct = optionalGroup(read, ['curveNumber', 'area', 'initialAbstractionRatio'])
      return settle(
        scsRunoff({
          rainfall: read.number('rainfall'),
          landCover: read.optionalText('landCover', '', 64) || undefined,
          soilGroup: read.has('soilGroup') ? choice<SoilGroup>(read, 'soilGroup', SOIL_GROUPS) : undefined,
          moisture: read.has('moisture')
            ? choice<MoistureCondition>(read, 'moisture', ['dry', 'average', 'wet'] as const)
            : undefined,
          ...direct
        }),
        isHydrologyError
      )
    }

    case 'water.land-covers':
      return {
        ok: true,
        landCovers: Object.entries(CURVE_NUMBERS).map(([id, one]) => ({ id, ...one })),
        soilGroups: SOIL_GROUPS,
        soilGroupFacts: SOIL_GROUP_FACTS,
        source: CURVE_NUMBER_SOURCE
      }

    case 'water.peak-flow': {
      const timing = optionalGroup(read, ['timeOfConcentration', 'stormDuration'])
      return settle(
        rationalMethod({
          runoffCoefficient: read.number('runoffCoefficient'),
          intensity: read.number('intensity'),
          area: read.number('area'),
          ...timing
        }),
        isHydrologyError
      )
    }

    case 'water.return-period':
      return settle(
        returnPeriod({
          returnPeriod: read.number('returnPeriod'),
          spans: read.has('spans') ? read.numbers('spans', EARTH_LIMITS.spans) : undefined
        }),
        isHydrologyError
      )

    case 'water.infiltration': {
      // Horton needs three parameters and Green-Ampt needs three different ones, so all six are read as a group.
      const parameters = optionalGroup(read, [
        'initialRate',
        'finalRate',
        'decayConstant',
        'conductivity',
        'suctionHead',
        'moistureDeficit',
        'rainfallIntensity'
      ])
      const model = read.optionalText('model', 'horton', 16)
      if (model !== 'horton' && model !== 'green-ampt') {
        throw new BadInput(`"${model}" is not an infiltration model; use "horton" or "green-ampt".`)
      }
      const built = infiltration({
        model,
        duration: read.number('duration'),
        samples: Math.round(read.optionalNumber('samples', 120)),
        ...parameters
      })
      if (isHydrologyError(built)) return { ok: false, ...built }
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('trace', 400)), EARTH_LIMITS.samples))
      return { ok: true, ...built, samples: thin(built.samples, wanted) }
    }

    case 'water.darcy': {
      // A gradient, or a head difference over a length. Either route works and neither alone is required.
      const route = optionalGroup(read, [
        'hydraulicGradient',
        'headDifference',
        'flowLength',
        'crossSectionArea',
        'porosity',
        'travelDistance'
      ])
      return settle(darcyFlow({ conductivity: read.number('conductivity'), ...route }), isHydrologyError)
    }

    case 'water.well':
      return settle(
        theisDrawdown({
          pumpingRate: read.number('pumpingRate'),
          transmissivity: read.number('transmissivity'),
          storativity: read.number('storativity'),
          distance: read.number('distance'),
          time: read.number('time')
        }),
        isHydrologyError
      )

    case 'water.balance': {
      const term = (key: string): { label?: string; amount: number }[] =>
        read.has(key)
          ? read.list(key, EARTH_LIMITS.terms).map((one) => {
              const entry = new Reader(one)
              return { label: entry.optionalText('label', '', 64) || undefined, amount: entry.number('amount') }
            })
          : []
      const measured = optionalGroup(read, ['measuredStorageChange', 'tolerance'])
      return settle(
        waterBalance({ inflows: term('inflows'), outflows: term('outflows'), ...measured }),
        isHydrologyError
      )
    }

    // ---------------------------------------------------------------- rock
    case 'quake.magnitude': {
      const compare = optionalGroup(read, ['compareWith'])
      return settle(
        earthquakeEnergy({
          magnitude: read.number('magnitude'),
          scale: choice<MagnitudeScale>(read, 'scale', MAGNITUDE_SCALES, 'moment'),
          ...compare
        }),
        isGeologyError
      )
    }

    case 'quake.scales':
      return { ok: true, scales: MAGNITUDE_SCALES, facts: MAGNITUDE_FACTS }

    case 'quake.arrivals':
      // Both velocities have real crustal defaults, so they are read directly and stay visible.
      return settle(
        waveArrivals({
          distance: read.number('distance'),
          pVelocity: read.optionalNumber('pVelocity', 6.0),
          sVelocity: read.optionalNumber('sVelocity', 3.5)
        }),
        isGeologyError
      )

    case 'rock.dating': {
      // A parent fraction, a daughter ratio or an age. Exactly one is needed and none alone is required.
      const measured = optionalGroup(read, ['parentFraction', 'daughterToParent', 'age'])
      return settle(radiometricAge({ system: read.text('system', 64), ...measured }), isGeologyError)
    }

    case 'rock.isotopes':
      return { ok: true, systems: ISOTOPE_SYSTEMS }

    case 'rock.plate-motion': {
      const span = optionalGroup(read, ['years', 'distance'])
      return settle(plateMotion({ rate: read.number('rate'), ...span }), isGeologyError)
    }

    case 'rock.slope':
      // Zero cohesion is clean sand and zero water table height is the dry case — both real defaults, so they
      // are read directly and the operation stays visible to the catalogue.
      return settle(
        slopeStability({
          slopeAngle: read.number('slopeAngle'),
          frictionAngle: read.number('frictionAngle'),
          depth: read.number('depth'),
          unitWeight: read.number('unitWeight'),
          cohesion: read.optionalNumber('cohesion', 0),
          waterTableHeight: read.optionalNumber('waterTableHeight', 0),
          waterUnitWeight: read.optionalNumber('waterUnitWeight', 9.81)
        }),
        isGeologyError
      )

    case 'rock.types':
      return { ok: true, rocks: ROCK_TYPES }

    case 'rock.get':
      return settle(rockById(read.text('rock', 64)), isGeologyError)

    case 'rock.overburden': {
      const conditions = optionalGroup(read, [
        'density',
        'waterTableDepth',
        'geothermalGradient',
        'surfaceTemperature'
      ])
      return settle(
        overburdenStress({
          depth: read.number('depth'),
          rock: read.optionalText('rock', '', 64) || undefined,
          ...conditions
        }),
        isGeologyError
      )
    }

    // ---------------------------------------------------------------- farming
    case 'farm.evapotranspiration': {
      // Penman-Monteith needs five readings and the temperature-only methods need a latitude and day instead,
      // so the whole set is read as a group.
      const conditions = optionalGroup(read, [
        'relativeHumidity',
        'windSpeed',
        'solarRadiation',
        'altitude',
        'latitudeDegrees',
        'dayOfYear',
        'cropCoefficient'
      ])
      const method = choice(read, 'method', ET_METHODS, 'penman-monteith')
      return settle(
        evapotranspiration({
          method,
          maximumTemperature: read.number('maximumTemperature'),
          minimumTemperature: read.number('minimumTemperature'),
          ...conditions,
          dayOfYear: conditions.dayOfYear === undefined ? undefined : Math.round(conditions.dayOfYear)
        }),
        isAgronomyError
      )
    }

    case 'farm.et-methods':
      return { ok: true, methods: ET_METHODS, facts: ET_FACTS }

    case 'farm.degree-days': {
      const days = read.list('days', EARTH_LIMITS.days).map((one) => {
        const entry = new Reader(one)
        return { maximum: entry.number('maximum'), minimum: entry.number('minimum') }
      })
      const limits = optionalGroup(read, ['upperThreshold', 'target'])
      const built = growingDegreeDays({ days, baseTemperature: read.number('baseTemperature'), ...limits })
      if (isAgronomyError(built)) return { ok: false, ...built }
      const wanted = Math.max(1, Math.min(Math.round(read.optionalNumber('trace', 400)), EARTH_LIMITS.days))
      return { ok: true, ...built, daily: thin(built.daily, wanted) }
    }

    case 'farm.soil-water': {
      // A texture, or a measured field capacity and wilting point. Neither route is required on its own.
      const measured = optionalGroup(read, ['fieldCapacity', 'wiltingPoint', 'currentWaterContent', 'allowableDepletion'])
      return settle(
        soilWater({
          texture: read.has('texture') ? choice<SoilTexture>(read, 'texture', SOIL_TEXTURES) : undefined,
          rootDepth: read.number('rootDepth'),
          ...measured
        }),
        isAgronomyError
      )
    }

    case 'farm.soil-textures':
      return { ok: true, textures: SOIL_TEXTURES, facts: SOIL_WATER, source: SOIL_WATER_SOURCE }

    case 'farm.nutrients': {
      const requirements = read.list('requirements', EARTH_LIMITS.nutrients).map((one) => {
        const entry = new Reader(one)
        const nutrient = entry.text('nutrient', 32)
        if (!(NUTRIENTS as readonly string[]).includes(nutrient)) {
          throw new BadInput(`"${nutrient}" is not one of: ${NUTRIENTS.join(', ')}.`)
        }
        return {
          nutrient: nutrient as Nutrient,
          cropRemoval: entry.number('cropRemoval'),
          // Left as undefined when absent rather than defaulted to zero: a missing soil test is what makes the
          // engine refuse, and defaulting it would produce a recommendation from no information at all.
          soilSupply: entry.has('soilSupply') ? entry.number('soilSupply') : undefined,
          useEfficiency: entry.has('useEfficiency') ? entry.number('useEfficiency') : undefined
        }
      })
      return settle(nutrientBalance({ requirements }), isAgronomyError)
    }

    case 'farm.nutrient-facts':
      return { ok: true, nutrients: NUTRIENTS, facts: NUTRIENT_FACTS }

    // ---------------------------------------------------------------- provenance
    case 'earth.assumptions':
      return {
        ok: true,
        geodesy: GEODESY_ASSUMPTIONS,
        atmosphere: ATMOSPHERE_ASSUMPTIONS,
        hydrology: HYDROLOGY_ASSUMPTIONS,
        geology: GEOLOGY_ASSUMPTIONS,
        agronomy: AGRONOMY_ASSUMPTIONS
      }

    default:
      throw new BadInput(`"${operation}" is not an earth-science operation.`)
  }
}

/** Kept exported so a Page can list the isotope systems by id without a lookup round trip. */
export const EARTH_LOOKUPS = Object.freeze({
  ellipsoidById,
  isotopeById
})
