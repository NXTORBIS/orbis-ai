/**
 * The electromagnetism, circuits, optics and acoustics laboratories a Page can reach.
 *
 * Same contract as the bridges before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## What is capped here and what is not
 *
 * The engines will integrate a particle for two hundred thousand steps and sample a field over ten thousand
 * points. This door caps what comes *back*, not what is computed: a trajectory is integrated at whatever step it
 * was given and only the sampled trace crosses the boundary, because a hundred thousand snapshots is megabytes of
 * JSON for a chart a thousand pixels wide. The step decides the answer; the sample count decides what is kept.
 *
 * ## The operations that refuse rather than default
 *
 * `capacitor.dielectric` requires the wiring condition. Sliding a dielectric into a capacitor still connected to
 * its source and into one isolated after charging give opposite answers on voltage, charge and energy, and
 * picking one silently teaches the wrong half of the experiment — so the argument is required and the refusal
 * explains what the two cases are.
 *
 * `circuit.solve` refuses a shorted ideal source by name rather than returning the enormous number the singular
 * matrix would produce. `optics.refract` reports total internal reflection as its own answer rather than clamping
 * a refracted ray to ninety degrees. `acoustics.decibels` refuses a ratio with nothing to compare against.
 */

import {
  ELECTROSTATICS_ASSUMPTIONS,
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
  CAPACITOR_FACTS,
  CAPACITOR_SHAPES,
  DIELECTRIC_CONDITIONS,
  type Capacitor,
  type DielectricCondition,
  type PointCharge
} from '../../shared/compute/electrostatics.ts'
import {
  CIRCUIT_ASSUMPTIONS,
  COMPONENT_FACTS,
  COMPONENT_KINDS,
  TRANSIENT_KINDS,
  acPower,
  checkCircuit,
  combineResistors,
  isCircuitError,
  resonanceSweep,
  rlc,
  solve,
  transformer,
  transient,
  type Circuit,
  type Component,
  type ComponentKind,
  type TransientKind
} from '../../shared/compute/circuits.ts'
import {
  MAGNETISM_ASSUMPTIONS,
  PARTICLE_FACTS,
  PARTICLE_KINDS,
  SOURCE_FACTS,
  circularLoop,
  flux,
  inductance,
  induction,
  isMagnetismError,
  lorentzForce,
  motionalEmf,
  segmentField,
  solenoid,
  straightWire,
  trajectory,
  vec3,
  type ParticleKind,
  type Vec3,
  type WireSegment
} from '../../shared/compute/magnetism.ts'
import {
  MEDIA,
  OPTICS_ASSUMPTIONS,
  OPTIC_KINDS,
  SIGN_CONVENTION,
  criticalAngle,
  doubleSlit,
  fibre,
  grating,
  imageFrom,
  isOpticsError,
  lensMaker,
  malus,
  opticalSystem,
  prism,
  refract,
  refractiveIndexAt,
  singleSlit,
  thinFilm,
  type OpticKind
} from '../../shared/compute/optics.ts'
import {
  ACOUSTICS_ASSUMPTIONS,
  ACOUSTIC_MEDIA,
  DECIBEL_FACTS,
  DECIBEL_REFERENCES,
  PIPE_KINDS,
  acousticImpedance,
  beats,
  combineLevels,
  doppler,
  interval,
  isAcousticsError,
  levelAtDistance,
  noteFor,
  pipeHarmonics,
  roomAcoustics,
  soundWave,
  speedOfSound,
  stringHarmonics,
  toDecibels,
  type DecibelReference,
  type PipeKind
} from '../../shared/compute/acoustics.ts'
import { EM_CONSTANT_PROVENANCE } from '../../shared/compute/emConstants.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same capability. That is deliberate: a Page that can solve a circuit can also trace a ray,
 * and splitting them into four permissions would ask the user four questions about the same thing — arithmetic
 * that reaches nothing outside the Page.
 */
export const EM_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- electrostatics
  'charge.field': 'computation.electromagnetism',
  'charge.force': 'computation.electromagnetism',
  'charge.grid': 'computation.electromagnetism',
  'charge.lines': 'computation.electromagnetism',
  'charge.work': 'computation.electromagnetism',
  'charge.dipole': 'computation.electromagnetism',

  // ---- capacitors
  'capacitor.build': 'computation.electromagnetism',
  'capacitor.state': 'computation.electromagnetism',
  'capacitor.dielectric': 'computation.electromagnetism',
  'capacitor.combine': 'computation.electromagnetism',
  'capacitor.shapes': 'computation.electromagnetism',

  // ---- circuits
  'circuit.check': 'computation.electromagnetism',
  'circuit.solve': 'computation.electromagnetism',
  'circuit.components': 'computation.electromagnetism',
  'circuit.resistors': 'computation.electromagnetism',
  'circuit.transient': 'computation.electromagnetism',
  'circuit.rlc': 'computation.electromagnetism',
  'circuit.resonance': 'computation.electromagnetism',
  'circuit.ac-power': 'computation.electromagnetism',
  'circuit.transformer': 'computation.electromagnetism',

  // ---- magnetism
  'magnet.wire': 'computation.electromagnetism',
  'magnet.loop': 'computation.electromagnetism',
  'magnet.solenoid': 'computation.electromagnetism',
  'magnet.segments': 'computation.electromagnetism',
  'magnet.shapes': 'computation.electromagnetism',
  'magnet.lorentz': 'computation.electromagnetism',
  'magnet.trajectory': 'computation.electromagnetism',
  'magnet.particles': 'computation.electromagnetism',
  'magnet.flux': 'computation.electromagnetism',
  'magnet.induction': 'computation.electromagnetism',
  'magnet.motional': 'computation.electromagnetism',
  'magnet.inductance': 'computation.electromagnetism',

  // ---- optics
  'optics.materials': 'computation.electromagnetism',
  'optics.index': 'computation.electromagnetism',
  'optics.refract': 'computation.electromagnetism',
  'optics.critical-angle': 'computation.electromagnetism',
  'optics.image': 'computation.electromagnetism',
  'optics.lens-maker': 'computation.electromagnetism',
  'optics.system': 'computation.electromagnetism',
  'optics.prism': 'computation.electromagnetism',
  'optics.double-slit': 'computation.electromagnetism',
  'optics.single-slit': 'computation.electromagnetism',
  'optics.grating': 'computation.electromagnetism',
  'optics.polarise': 'computation.electromagnetism',
  'optics.thin-film': 'computation.electromagnetism',
  'optics.fibre': 'computation.electromagnetism',

  // ---- acoustics
  'sound.speed': 'computation.electromagnetism',
  'sound.wave': 'computation.electromagnetism',
  'sound.media': 'computation.electromagnetism',
  'sound.decibels': 'computation.electromagnetism',
  'sound.combine-levels': 'computation.electromagnetism',
  'sound.distance': 'computation.electromagnetism',
  'sound.doppler': 'computation.electromagnetism',
  'sound.pipe': 'computation.electromagnetism',
  'sound.string': 'computation.electromagnetism',
  'sound.beats': 'computation.electromagnetism',
  'sound.note': 'computation.electromagnetism',
  'sound.interval': 'computation.electromagnetism',
  'sound.room': 'computation.electromagnetism',
  'sound.impedance': 'computation.electromagnetism',

  // ---- provenance
  'em.constants': 'computation.electromagnetism',
  'em.assumptions': 'computation.electromagnetism'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const EM_LIMITS = Object.freeze({
  charges: 200,
  gridPoints: 10_000,
  components: 400,
  segments: 100,
  elements: 32,
  surfaces: 64,
  samples: 4000,
  levels: 32
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

function pointOf(read: Reader, key: string): { x: number; y: number } {
  const entry = objectAt(read, key)
  return { x: entry.number('x'), y: entry.number('y') }
}

function vectorOf(read: Reader, key: string, fallback?: Vec3): Vec3 {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be an object with x, y and z.`)
  }
  const entry = objectAt(read, key)
  return vec3(entry.optionalNumber('x', 0), entry.optionalNumber('y', 0), entry.optionalNumber('z', 0))
}

function chargesOf(read: Reader): PointCharge[] {
  return read.list('charges', EM_LIMITS.charges).map((one, index) => {
    const entry = new Reader(one)
    return {
      charge: entry.number('charge'),
      x: entry.number('x'),
      y: entry.number('y'),
      label: entry.has('label') ? entry.text('label', 120) : `charge ${index + 1}`
    }
  })
}

function capacitorOf(read: Reader): Capacitor {
  const shape = read.choice('shape', CAPACITOR_SHAPES, 'parallel-plate')
  const dielectricConstant = read.optionalNumber('dielectricConstant', 1)
  const built =
    shape === 'parallel-plate'
      ? parallelPlate({ area: read.number('area'), separation: read.number('separation'), dielectricConstant })
      : shape === 'cylindrical'
        ? cylindricalCapacitor({
            innerRadius: read.number('innerRadius'),
            outerRadius: read.number('outerRadius'),
            length: read.number('length'),
            dielectricConstant
          })
        : sphericalCapacitor({
            innerRadius: read.number('innerRadius'),
            outerRadius: read.number('outerRadius'),
            dielectricConstant
          })
  if (isElectrostaticsError(built)) throw new BadInput(built.message)
  return built
}

function circuitOf(read: Reader): Circuit {
  const components: Component[] = read.list('components', EM_LIMITS.components).map((one, index) => {
    const entry = new Reader(one)
    const kind = entry.choice('kind', COMPONENT_KINDS, 'resistor') as ComponentKind
    const component: Component = {
      id: entry.has('id') ? entry.text('id', 120) : `C${index + 1}`,
      kind,
      value: kind === 'wire' ? 0 : entry.optionalNumber('value', 0),
      from: entry.text('from', 120),
      to: entry.text('to', 120)
    }
    if (entry.has('closed')) component.closed = entry.boolean('closed', true)
    if (entry.has('label')) component.label = entry.text('label', 120)
    return component
  })
  return { components, ground: read.optionalText('ground', 'gnd', 120) }
}

function segmentsOf(read: Reader): WireSegment[] {
  return read.list('segments', EM_LIMITS.segments).map((one, index) => {
    const entry = new Reader(one)
    return {
      from: vectorOf(entry, 'from'),
      to: vectorOf(entry, 'to'),
      current: entry.number('current'),
      label: entry.has('label') ? entry.text('label', 120) : `segment ${index + 1}`
    }
  })
}


/**
 * Run one operation.
 *
 * Reached only from `service.ts`, and only after the capability check has passed. Everything it throws is a
 * `BadInput`, which the caller turns into a refusal the Page can read.
 */
export function runEmOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- electrostatics
    case 'charge.field':
      return settle(fieldAt(chargesOf(read), pointOf(read, 'at')), isElectrostaticsError)

    case 'charge.force':
      return settle(forceOn(chargesOf(read), pointOf(read, 'at'), read.number('testCharge')), isElectrostaticsError)

    case 'charge.grid':
      return settle(
        fieldGrid(chargesOf(read), {
          minX: read.number('minX'),
          maxX: read.number('maxX'),
          minY: read.number('minY'),
          maxY: read.number('maxY'),
          columns: Math.round(read.optionalNumber('columns', 20)),
          rows: Math.round(read.optionalNumber('rows', 20))
        }),
        isElectrostaticsError
      )

    case 'charge.lines': {
      const built = fieldLines(chargesOf(read), {
        linesPerCharge: Math.round(read.optionalNumber('linesPerCharge', 12)),
        step: read.has('step') ? read.number('step') : undefined
      })
      if (isElectrostaticsError(built)) return { ok: false, ...built }
      return { ok: true, lines: built }
    }

    case 'charge.work':
      return settle(
        workBetween(chargesOf(read), pointOf(read, 'from'), pointOf(read, 'to'), read.number('charge')),
        isElectrostaticsError
      )

    case 'charge.dipole':
      return settle(dipole(read.number('charge'), read.number('separation')), isElectrostaticsError)

    // ---------------------------------------------------------------- capacitors
    case 'capacitor.build':
      return { ok: true, ...capacitorOf(read) }

    case 'capacitor.state':
      return settle(
        capacitorState(capacitorOf(read), {
          voltage: read.has('voltage') ? read.number('voltage') : undefined,
          charge: read.has('charge') ? read.number('charge') : undefined
        }),
        isElectrostaticsError
      )

    case 'capacitor.dielectric': {
      // Required rather than defaulted: the two conditions disagree on voltage, charge and energy, and guessing
      // teaches the wrong half of the experiment.
      if (!read.has('condition')) {
        throw new BadInput(
          'Say whether the capacitor is still "connected" to its source or was "isolated" after charging. The slab does the same thing either way; the circuit does not, and the answers differ on voltage, charge and energy.'
        )
      }
      return settle(
        withDielectric(
          capacitorOf(read),
          {
            voltage: read.has('voltage') ? read.number('voltage') : undefined,
            charge: read.has('charge') ? read.number('charge') : undefined
          },
          read.number('dielectricConstant'),
          read.choice('condition', DIELECTRIC_CONDITIONS, 'connected') as DielectricCondition
        ),
        isElectrostaticsError
      )
    }

    case 'capacitor.combine':
      return settle(
        combine(
          read.numbers('capacitances', 64),
          read.choice('arrangement', ['series', 'parallel'] as const, 'series'),
          read.optionalNumber('supplyVoltage', 0)
        ),
        isElectrostaticsError
      )

    case 'capacitor.shapes':
      return {
        ok: true,
        shapes: CAPACITOR_SHAPES.map((shape) => ({ shape, ...CAPACITOR_FACTS[shape] }))
      }

    // ---------------------------------------------------------------- circuits
    case 'circuit.check':
      return settle(checkCircuit(circuitOf(read)), isCircuitError)

    case 'circuit.solve':
      return settle(solve(circuitOf(read), read.optionalNumber('frequency', 0)), isCircuitError)

    case 'circuit.components':
      return {
        ok: true,
        kinds: COMPONENT_KINDS.map((kind) => ({ kind, ...COMPONENT_FACTS[kind] }))
      }

    case 'circuit.resistors':
      return settle(
        combineResistors(
          read.numbers('resistances', 128),
          read.choice('arrangement', ['series', 'parallel'] as const, 'series'),
          read.optionalNumber('supplyVoltage', 0)
        ),
        isCircuitError
      )

    case 'circuit.transient':
      return settle(
        transient({
          kind: read.choice('kind', TRANSIENT_KINDS, 'rc-charge') as TransientKind,
          resistance: read.number('resistance'),
          // Zero rather than undefined, so both are visible to the catalogue. An RC run given only an inductance
          // gets the engine's own refusal naming what it needed, which is a better failure than a Page generated
          // without the argument at all.
          capacitance: read.optionalNumber('capacitance', 0),
          inductance: read.optionalNumber('inductance', 0),
          supplyVoltage: read.optionalNumber('supplyVoltage', 0),
          initialVoltage: read.has('initialVoltage') ? read.number('initialVoltage') : undefined,
          initialCurrent: read.has('initialCurrent') ? read.number('initialCurrent') : undefined,
          duration: read.has('duration') ? read.number('duration') : undefined,
          samples: Math.min(Math.max(2, Math.round(read.optionalNumber('samples', 400))), EM_LIMITS.samples)
        }),
        isCircuitError
      )

    case 'circuit.rlc':
      return settle(
        rlc({
          resistance: read.number('resistance'),
          inductance: read.number('inductance'),
          capacitance: read.number('capacitance'),
          arrangement: read.choice('arrangement', ['series', 'parallel'] as const, 'series'),
          stepAmplitude: read.optionalNumber('stepAmplitude', 1),
          duration: read.has('duration') ? read.number('duration') : undefined,
          samples: Math.min(Math.max(2, Math.round(read.optionalNumber('samples', 500))), EM_LIMITS.samples)
        }),
        isCircuitError
      )

    case 'circuit.resonance':
      return settle(
        resonanceSweep({
          resistance: read.number('resistance'),
          inductance: read.number('inductance'),
          capacitance: read.number('capacitance'),
          arrangement: read.choice('arrangement', ['series', 'parallel'] as const, 'series'),
          driveVoltage: read.optionalNumber('driveVoltage', 1),
          fromFrequency: read.has('fromFrequency') ? read.number('fromFrequency') : undefined,
          toFrequency: read.has('toFrequency') ? read.number('toFrequency') : undefined,
          points: Math.min(Math.max(2, Math.round(read.optionalNumber('samples', 600))), EM_LIMITS.samples)
        }),
        isCircuitError
      )

    case 'circuit.ac-power':
      return settle(
        acPower({
          voltageRms: read.number('voltageRms'),
          currentRms: read.number('currentRms'),
          // Defaults to zero, which is a purely resistive load. Visible rather than guarded, so the catalogue can
          // tell Orion it exists.
          phaseDegrees: read.optionalNumber('phaseDegrees', 0)
        }),
        isCircuitError
      )

    case 'circuit.transformer':
      return settle(
        transformer({
          primaryTurns: read.number('primaryTurns'),
          secondaryTurns: read.number('secondaryTurns'),
          primaryVoltage: read.number('primaryVoltage'),
          loadResistance: read.number('loadResistance'),
          windingResistancePrimary: read.has('windingResistancePrimary')
            ? read.number('windingResistancePrimary')
            : undefined,
          windingResistanceSecondary: read.has('windingResistanceSecondary')
            ? read.number('windingResistanceSecondary')
            : undefined,
          coreLossWatts: read.has('coreLossWatts') ? read.number('coreLossWatts') : undefined
        }),
        isCircuitError
      )

    // ---------------------------------------------------------------- magnetism
    case 'magnet.wire':
      return settle(
        straightWire({
          current: read.number('current'),
          distance: read.number('distance'),
          at: read.has('at') ? pointOf(read, 'at') : undefined
        }),
        isMagnetismError
      )

    case 'magnet.loop':
      return settle(
        circularLoop({
          current: read.number('current'),
          radius: read.number('radius'),
          axialDistance: read.optionalNumber('axialDistance', 0),
          turns: Math.round(read.optionalNumber('turns', 1))
        }),
        isMagnetismError
      )

    case 'magnet.solenoid':
      return settle(
        solenoid({
          current: read.number('current'),
          turns: Math.round(read.number('turns')),
          length: read.number('length'),
          radius: read.has('radius') ? read.number('radius') : undefined,
          coreRelativePermeability: read.optionalNumber('coreRelativePermeability', 1)
        }),
        isMagnetismError
      )

    case 'magnet.segments':
      return settle(
        segmentField(segmentsOf(read), vectorOf(read, 'at'), Math.round(read.optionalNumber('pieces', 200))),
        isMagnetismError
      )

    case 'magnet.shapes':
      return {
        ok: true,
        shapes: Object.entries(SOURCE_FACTS).map(([shape, facts]) => ({ shape, ...facts }))
      }

    case 'magnet.lorentz':
      return settle(
        lorentzForce({
          charge: read.number('charge'),
          velocity: vectorOf(read, 'velocity'),
          electricField: vectorOf(read, 'electricField', vec3()),
          magneticField: vectorOf(read, 'magneticField', vec3())
        }),
        isMagnetismError
      )

    case 'magnet.trajectory':
      return settle(
        trajectory({
          particle: read.choice('particle', PARTICLE_KINDS, 'custom') as ParticleKind,
          charge: read.has('charge') ? read.number('charge') : undefined,
          mass: read.has('mass') ? read.number('mass') : undefined,
          initialPosition: vectorOf(read, 'initialPosition', vec3()),
          initialVelocity: vectorOf(read, 'initialVelocity'),
          electricField: vectorOf(read, 'electricField', vec3()),
          magneticField: vectorOf(read, 'magneticField', vec3()),
          duration: read.number('duration'),
          steps: read.has('steps') ? Math.round(read.number('steps')) : undefined,
          samples: Math.min(Math.max(2, Math.round(read.optionalNumber('samples', 1000))), EM_LIMITS.samples)
        }),
        isMagnetismError
      )

    case 'magnet.particles':
      return {
        ok: true,
        particles: Object.entries(PARTICLE_FACTS).map(([particle, facts]) => ({ particle, ...facts }))
      }

    case 'magnet.flux':
      return settle(
        flux({
          fieldStrength: read.number('fieldStrength'),
          area: read.number('area'),
          angleRadians: read.has('angleRadians') ? read.number('angleRadians') : undefined,
          angleDegrees: read.has('angleDegrees') ? read.number('angleDegrees') : undefined,
          turns: Math.round(read.optionalNumber('turns', 1))
        }),
        isMagnetismError
      )

    case 'magnet.induction':
      return settle(
        induction({
          fluxChange: read.number('fluxChange'),
          timeInterval: read.number('timeInterval'),
          turns: Math.round(read.optionalNumber('turns', 1)),
          circuitResistance: read.has('circuitResistance') ? read.number('circuitResistance') : undefined
        }),
        isMagnetismError
      )

    case 'magnet.motional':
      return settle(
        motionalEmf({
          fieldStrength: read.number('fieldStrength'),
          rodLength: read.number('rodLength'),
          speed: read.number('speed'),
          circuitResistance: read.has('circuitResistance') ? read.number('circuitResistance') : undefined
        }),
        isMagnetismError
      )

    case 'magnet.inductance':
      return settle(
        inductance({
          selfInductance: read.has('selfInductance') ? read.number('selfInductance') : undefined,
          secondInductance: read.has('secondInductance') ? read.number('secondInductance') : undefined,
          couplingCoefficient: read.has('couplingCoefficient') ? read.number('couplingCoefficient') : undefined,
          currentRate: read.has('currentRate') ? read.number('currentRate') : undefined,
          current: read.has('current') ? read.number('current') : undefined
        }),
        isMagnetismError
      )

    // ---------------------------------------------------------------- optics
    case 'optics.materials':
      return { ok: true, materials: MEDIA, convention: SIGN_CONVENTION, kinds: OPTIC_KINDS }

    case 'optics.index':
      return settle(refractiveIndexAt(read.text('material', 120), read.number('wavelength')), isOpticsError)

    case 'optics.refract':
      return settle(
        refract({
          // Degrees only at this boundary. The engine takes either, but an argument read behind a `has` guard is
          // invisible to the catalogue that tells Orion what an operation needs -- and an angle it cannot see is an
          // angle a generated Page omits, which the engine then refuses. Every angle here is in degrees.
          incidentAngleDegrees: read.number('incidentAngleDegrees'),
          fromIndex: read.number('fromIndex'),
          toIndex: read.number('toIndex')
        }),
        isOpticsError
      )

    case 'optics.critical-angle':
      return settle(criticalAngle(read.number('fromIndex'), read.number('toIndex')), isOpticsError)

    case 'optics.image':
      return settle(
        imageFrom({
          optic: read.choice('optic', OPTIC_KINDS, 'converging-lens') as OpticKind,
          objectDistance: read.number('objectDistance'),
          // Required and visible. The engine also accepts a radius of curvature, but an argument behind a `has`
          // guard cannot be catalogued, and an operation catalogued without the one number it cannot work without
          // is worse than one not catalogued at all. A mirror specified by its radius halves it first.
          focalLength: read.number('focalLength'),
          objectHeight: read.optionalNumber('objectHeight', 0)
        }),
        isOpticsError
      )

    case 'optics.lens-maker':
      return settle(
        lensMaker({
          refractiveIndex: read.number('refractiveIndex'),
          radius1: read.number('radius1'),
          radius2: read.number('radius2'),
          surroundingIndex: read.optionalNumber('surroundingIndex', 1)
        }),
        isOpticsError
      )

    case 'optics.system': {
      const elements = read.list('elements', EM_LIMITS.elements).map((one, index) => {
        const entry = new Reader(one)
        return {
          element: entry.choice('element', OPTIC_KINDS, 'converging-lens') as OpticKind,
          focalLength: entry.number('focalLength'),
          separation: entry.optionalNumber('separation', 0),
          label: entry.has('label') ? entry.text('label', 120) : `element ${index + 1}`
        }
      })
      return settle(opticalSystem(read.number('objectDistance'), elements), isOpticsError)
    }

    case 'optics.prism':
      return settle(
        prism({
          apexAngleDegrees: read.number('apexAngleDegrees'),
          refractiveIndex: read.number('refractiveIndex'),
          incidentAngleDegrees: read.number('incidentAngleDegrees'),
          surroundingIndex: read.optionalNumber('surroundingIndex', 1)
        }),
        isOpticsError
      )

    case 'optics.double-slit':
      return settle(
        doubleSlit({
          wavelength: read.number('wavelength'),
          slitSeparation: read.number('slitSeparation'),
          screenDistance: read.number('screenDistance'),
          slitWidth: read.has('slitWidth') ? read.number('slitWidth') : undefined,
          screenWidth: read.has('screenWidth') ? read.number('screenWidth') : undefined,
          points: Math.min(Math.max(2, Math.round(read.optionalNumber('samples', 800))), EM_LIMITS.samples),
          maxOrder: Math.round(read.optionalNumber('maxOrder', 10))
        }),
        isOpticsError
      )

    case 'optics.single-slit':
      return settle(
        singleSlit({
          wavelength: read.number('wavelength'),
          slitWidth: read.number('slitWidth'),
          screenDistance: read.number('screenDistance'),
          screenWidth: read.has('screenWidth') ? read.number('screenWidth') : undefined,
          points: Math.min(Math.max(2, Math.round(read.optionalNumber('samples', 800))), EM_LIMITS.samples),
          maxOrder: Math.round(read.optionalNumber('maxOrder', 8))
        }),
        isOpticsError
      )

    case 'optics.grating':
      return settle(
        grating({
          wavelength: read.number('wavelength'),
          linesPerMillimetre: read.has('linesPerMillimetre') ? read.number('linesPerMillimetre') : undefined,
          spacing: read.has('spacing') ? read.number('spacing') : undefined,
          incidentAngleDegrees: read.optionalNumber('incidentAngleDegrees', 0),
          illuminatedLines: read.has('illuminatedLines') ? read.number('illuminatedLines') : undefined
        }),
        isOpticsError
      )

    case 'optics.polarise':
      return settle(
        malus({
          incidentIntensity: read.number('incidentIntensity'),
          angleDegrees: read.number('angleDegrees'),
          incidentPolarised: read.boolean('incidentPolarised', true)
        }),
        isOpticsError
      )

    case 'optics.thin-film':
      return settle(
        thinFilm({
          thickness: read.number('thickness'),
          filmIndex: read.number('filmIndex'),
          aboveIndex: read.optionalNumber('aboveIndex', 1),
          belowIndex: read.optionalNumber('belowIndex', 1),
          wavelength: read.number('wavelength'),
          incidentAngleDegrees: read.optionalNumber('incidentAngleDegrees', 0),
          maxOrders: Math.round(read.optionalNumber('maxOrders', 5))
        }),
        isOpticsError
      )

    case 'optics.fibre':
      return settle(
        fibre({
          coreIndex: read.number('coreIndex'),
          claddingIndex: read.number('claddingIndex'),
          coreRadius: read.has('coreRadius') ? read.number('coreRadius') : undefined,
          wavelength: read.has('wavelength') ? read.number('wavelength') : undefined,
          lengthKm: read.has('lengthKm') ? read.number('lengthKm') : undefined,
          attenuationDbPerKm: read.has('attenuationDbPerKm') ? read.number('attenuationDbPerKm') : undefined,
          surroundingIndex: read.optionalNumber('surroundingIndex', 1)
        }),
        isOpticsError
      )

    // ---------------------------------------------------------------- acoustics
    case 'sound.speed':
      return settle(
        speedOfSound({
          medium: read.has('medium') ? read.text('medium', 120) : undefined,
          temperatureCelsius: read.has('temperatureCelsius') ? read.number('temperatureCelsius') : undefined,
          speed: read.has('speed') ? read.number('speed') : undefined
        }),
        isAcousticsError
      )

    case 'sound.wave':
      return settle(
        soundWave({
          frequency: read.has('frequency') ? read.number('frequency') : undefined,
          wavelength: read.has('wavelength') ? read.number('wavelength') : undefined,
          speed: read.has('speed') ? read.number('speed') : undefined,
          medium: read.has('medium') ? read.text('medium', 120) : undefined,
          temperatureCelsius: read.has('temperatureCelsius') ? read.number('temperatureCelsius') : undefined,
          pressureAmplitude: read.has('pressureAmplitude') ? read.number('pressureAmplitude') : undefined,
          density: read.has('density') ? read.number('density') : undefined,
          sampleCount: read.has('sampleCount') ? Math.min(Math.max(2, Math.round(read.number('sampleCount'))), EM_LIMITS.samples) : undefined
        }),
        isAcousticsError
      )

    case 'sound.media':
      return {
        ok: true,
        media: ACOUSTIC_MEDIA,
        // `id` rather than `reference`: the facts object already has a `reference` field, and it means the thing
        // being compared against rather than the name of the scale. Two different meanings, so two different keys.
        references: DECIBEL_REFERENCES.map((one) => ({ id: one, ...DECIBEL_FACTS[one] }))
      }

    case 'sound.decibels':
      return settle(
        toDecibels({
          value: read.number('value'),
          reference: read.choice('reference', DECIBEL_REFERENCES, 'spl') as DecibelReference,
          referenceValue: read.has('referenceValue') ? read.number('referenceValue') : undefined
        }),
        isAcousticsError
      )

    case 'sound.combine-levels':
      return settle(combineLevels(read.numbers('levels', EM_LIMITS.levels)), isAcousticsError)

    case 'sound.distance':
      return settle(
        levelAtDistance({
          referenceLevel: read.number('referenceLevel'),
          referenceDistance: read.number('referenceDistance'),
          distance: read.number('distance'),
          spreading: read.choice('spreading', ['spherical', 'cylindrical'] as const, 'spherical')
        }),
        isAcousticsError
      )

    case 'sound.doppler':
      return settle(
        doppler({
          sourceFrequency: read.number('sourceFrequency'),
          sourceSpeed: read.optionalNumber('sourceSpeed', 0),
          observerSpeed: read.optionalNumber('observerSpeed', 0),
          speedOfSound: read.has('speedOfSound') ? read.number('speedOfSound') : undefined,
          medium: read.has('medium') ? read.text('medium', 120) : undefined,
          temperatureCelsius: read.has('temperatureCelsius') ? read.number('temperatureCelsius') : undefined,
          windSpeed: read.optionalNumber('windSpeed', 0)
        }),
        isAcousticsError
      )

    case 'sound.pipe':
      return settle(
        pipeHarmonics({
          kind: read.choice('kind', PIPE_KINDS, 'open-open') as PipeKind,
          length: read.number('length'),
          speed: read.has('speed') ? read.number('speed') : undefined,
          medium: read.has('medium') ? read.text('medium', 120) : undefined,
          temperatureCelsius: read.has('temperatureCelsius') ? read.number('temperatureCelsius') : undefined,
          count: Math.round(read.optionalNumber('count', 8)),
          radius: read.has('radius') ? read.number('radius') : undefined
        }),
        isAcousticsError
      )

    case 'sound.string':
      return settle(
        stringHarmonics({
          length: read.number('length'),
          tension: read.number('tension'),
          linearDensity: read.has('linearDensity') ? read.number('linearDensity') : undefined,
          mass: read.has('mass') ? read.number('mass') : undefined,
          count: Math.round(read.optionalNumber('count', 8))
        }),
        isAcousticsError
      )

    case 'sound.beats':
      return settle(
        beats({
          frequency1: read.number('frequency1'),
          frequency2: read.number('frequency2'),
          duration: read.has('duration') ? read.number('duration') : undefined,
          sampleCount: read.has('sampleCount') ? Math.min(Math.max(2, Math.round(read.number('sampleCount'))), EM_LIMITS.samples) : undefined
        }),
        isAcousticsError
      )

    case 'sound.note':
      return settle(noteFor(read.number('frequency'), read.optionalNumber('referenceA4', 440)), isAcousticsError)

    case 'sound.interval':
      return settle(interval(read.number('lower'), read.number('upper')), isAcousticsError)

    case 'sound.room': {
      const surfaces = read.list('surfaces', EM_LIMITS.surfaces).map((one, index) => {
        const entry = new Reader(one)
        return {
          name: entry.has('name') ? entry.text('name', 120) : `surface ${index + 1}`,
          area: entry.number('area'),
          absorptionCoefficient: entry.number('absorptionCoefficient')
        }
      })
      const dimensions = read.has('dimensions')
        ? (() => {
            const entry = objectAt(read, 'dimensions')
            return { length: entry.number('length'), width: entry.number('width'), height: entry.number('height') }
          })()
        : undefined
      return settle(
        roomAcoustics({
          volume: read.has('volume') ? read.number('volume') : undefined,
          dimensions,
          surfaces,
          speed: read.has('speed') ? read.number('speed') : undefined,
          temperatureCelsius: read.has('temperatureCelsius') ? read.number('temperatureCelsius') : undefined
        }),
        isAcousticsError
      )
    }

    case 'sound.impedance':
      return settle(
        acousticImpedance({
          density: read.has('density') ? read.number('density') : undefined,
          speed: read.has('speed') ? read.number('speed') : undefined,
          medium: read.has('medium') ? read.text('medium', 120) : undefined,
          secondMedium: read.has('secondMedium') ? read.text('secondMedium', 120) : undefined,
          secondDensity: read.has('secondDensity') ? read.number('secondDensity') : undefined,
          secondSpeed: read.has('secondSpeed') ? read.number('secondSpeed') : undefined
        }),
        isAcousticsError
      )

    // ---------------------------------------------------------------- provenance
    case 'em.constants':
      return { ok: true, constants: EM_CONSTANT_PROVENANCE }

    case 'em.assumptions':
      return {
        ok: true,
        electrostatics: ELECTROSTATICS_ASSUMPTIONS,
        circuits: CIRCUIT_ASSUMPTIONS,
        magnetism: MAGNETISM_ASSUMPTIONS,
        optics: OPTICS_ASSUMPTIONS,
        acoustics: ACOUSTICS_ASSUMPTIONS,
        convention: SIGN_CONVENTION
      }

    default:
      // Reached only when an operation has a capability above and no case here, which the caller could not have
      // caused: the capability check ran before this and let it through.
      throw new BadInput(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
  }
}

/** Everything an electromagnetism Page should be able to show about what it is standing on. */
export const EM_ASSUMPTIONS: readonly string[] = Object.freeze([
  ...ELECTROSTATICS_ASSUMPTIONS,
  ...CIRCUIT_ASSUMPTIONS,
  ...MAGNETISM_ASSUMPTIONS,
  ...OPTICS_ASSUMPTIONS,
  ...ACOUSTICS_ASSUMPTIONS
])
