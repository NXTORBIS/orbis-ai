/**
 * The engineering workshop a Page can reach: materials, statics, beams, fluids, heat, control and robotics.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## What is capped here and what is not
 *
 * The engines integrate a beam over thousands of stations and a PID loop over two hundred thousand time steps.
 * This door caps what comes *back*, not what is computed: the loop is integrated at whatever step it was given
 * and only the sampled trace crosses the boundary, because a hundred thousand samples is megabytes of JSON for a
 * chart a thousand pixels wide. The step decides the answer; the sample count decides what is kept.
 *
 * ## The operations that refuse rather than default
 *
 * `statics.beam` refuses a statically indeterminate beam by name: equilibrium genuinely does not determine its
 * reactions, and a number produced without the beam's stiffness is a number from a different problem.
 *
 * `material.property` refuses a property it does not hold rather than interpolating one. `heat.convection` returns
 * the correlation it used, its valid range and whether the inputs were inside it. `robot.inverse` reports that it
 * did not reach an unreachable target instead of returning its last guess as though it were a solution.
 * `control.tune` names the rule, what it was fitted for, and simulates the closed loop so the overshoot is visible
 * rather than described.
 */

import {
  MATERIALS,
  MATERIAL_ASSUMPTIONS,
  MATERIAL_CLASSES,
  PROPERTY_FACTS,
  PROPERTY_NAMES,
  compareProperty,
  elasticConstants,
  isMaterialError,
  materialById,
  materialsOfClass,
  propertyOf,
  ruleOfMixtures,
  type MaterialClass
} from '../../shared/compute/materials.ts'
import {
  STATICS_ASSUMPTIONS,
  SUPPORT_FACTS,
  SUPPORT_KINDS,
  beamReactions,
  beltFriction,
  blockOnSlope,
  compositeArea,
  isStaticsError,
  resultant,
  solveTruss,
  type AreaPiece,
  type BeamSupport,
  type Couple,
  type DistributedLoad,
  type Force,
  type PointLoad,
  type SupportKind,
  type TrussLoad,
  type TrussMember,
  type TrussNode
} from '../../shared/compute/statics.ts'
import {
  BEAM_ASSUMPTIONS,
  BEAM_CONVENTION,
  BEAM_KINDS,
  END_CONDITIONS,
  END_FACTS,
  FAILURE_CRITERIA,
  FAILURE_FACTS,
  SECTION_FACTS,
  SECTION_SHAPES,
  analyseBeam,
  checkFailure,
  eulerBuckling,
  isBeamError,
  mohrsCircle,
  sectionProperties,
  shaftTorsion,
  type BeamDistributedLoad,
  type BeamKind,
  type BeamMoment,
  type BeamPointLoad,
  type EndCondition,
  type FailureCriterion,
  type StressState
} from '../../shared/compute/beams.ts'
import {
  CHANNEL_SHAPES,
  DIMENSIONLESS_FACTS,
  DIMENSIONLESS_NUMBERS,
  FLUIDS,
  FLUID_ASSUMPTIONS,
  FRICTION_FACTS,
  FRICTION_MODELS,
  buoyancy,
  continuity,
  dimensionless,
  energyEquation,
  fluidById,
  isFluidError,
  openChannel,
  pipeFlow,
  pressureAtDepth,
  pumpPerformance,
  type FrictionModel
} from '../../shared/compute/fluids.ts'
import {
  CONVECTION_CORRELATIONS,
  CONVECTION_FACTS,
  EXCHANGER_ARRANGEMENTS,
  HEAT_ASSUMPTIONS,
  LAYER_GEOMETRIES,
  convection,
  effectivenessNtu,
  isHeatError,
  lmtd,
  lumpedCapacitance,
  radiation,
  resistanceNetwork,
  straightFin,
  type ConductionLayer,
  type ExchangerArrangement,
  type FinTip,
  type LayerGeometry
} from '../../shared/compute/heatTransfer.ts'
import {
  CONTROL_ASSUMPTIONS,
  TUNING_FACTS,
  TUNING_RULES,
  bode,
  closedLoop,
  isControlError,
  poleZero,
  polynomialRoots,
  routhHurwitz,
  series,
  simulatePid,
  stepResponse,
  tunePid,
  type TransferFunction,
  type TuningRule
} from '../../shared/compute/controls.ts'
import {
  ROBOT_ASSUMPTIONS,
  TRAJECTORY_PROFILES,
  forwardKinematics,
  inverseKinematics,
  isRoboticsError,
  jacobian,
  staticTorques,
  trajectory,
  type DhConvention,
  type DhLink,
  type Vec3
} from '../../shared/compute/robotics.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * All of them need the same one. A Page that can size a beam can also size a pipe, and splitting them into seven
 * permissions would ask the user seven questions about the same thing — arithmetic that reaches nothing outside
 * the Page.
 */
export const ENGINEERING_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- materials
  'material.list': 'computation.engineering',
  'material.get': 'computation.engineering',
  'material.property': 'computation.engineering',
  'material.compare': 'computation.engineering',
  'material.properties': 'computation.engineering',
  'material.elastic': 'computation.engineering',
  'material.mixture': 'computation.engineering',

  // ---- statics
  'statics.resultant': 'computation.engineering',
  'statics.beam': 'computation.engineering',
  'statics.supports': 'computation.engineering',
  'statics.truss': 'computation.engineering',
  'statics.slope': 'computation.engineering',
  'statics.belt': 'computation.engineering',
  'statics.centroid': 'computation.engineering',

  // ---- sections, beams and stress
  'section.properties': 'computation.engineering',
  'section.shapes': 'computation.engineering',
  'beam.analyse': 'computation.engineering',
  'beam.convention': 'computation.engineering',
  'stress.mohr': 'computation.engineering',
  'stress.failure': 'computation.engineering',
  'stress.criteria': 'computation.engineering',
  'column.buckling': 'computation.engineering',
  'column.ends': 'computation.engineering',
  'shaft.torsion': 'computation.engineering',

  // ---- fluids
  'fluid.list': 'computation.engineering',
  'fluid.get': 'computation.engineering',
  'fluid.pressure': 'computation.engineering',
  'fluid.buoyancy': 'computation.engineering',
  'fluid.dimensionless': 'computation.engineering',
  'fluid.numbers': 'computation.engineering',
  'fluid.pipe': 'computation.engineering',
  'fluid.friction-models': 'computation.engineering',
  'fluid.energy': 'computation.engineering',
  'fluid.continuity': 'computation.engineering',
  'fluid.pump': 'computation.engineering',
  'fluid.channel': 'computation.engineering',

  // ---- heat transfer
  'heat.resistance': 'computation.engineering',
  'heat.convection': 'computation.engineering',
  'heat.correlations': 'computation.engineering',
  'heat.radiation': 'computation.engineering',
  'heat.fin': 'computation.engineering',
  'heat.lmtd': 'computation.engineering',
  'heat.ntu': 'computation.engineering',
  'heat.transient': 'computation.engineering',

  // ---- control systems
  'control.roots': 'computation.engineering',
  'control.poles': 'computation.engineering',
  'control.closed-loop': 'computation.engineering',
  'control.series': 'computation.engineering',
  'control.step': 'computation.engineering',
  'control.bode': 'computation.engineering',
  'control.routh': 'computation.engineering',
  'control.tune': 'computation.engineering',
  'control.rules': 'computation.engineering',
  'control.simulate': 'computation.engineering',

  // ---- robotics
  'robot.forward': 'computation.engineering',
  'robot.jacobian': 'computation.engineering',
  'robot.inverse': 'computation.engineering',
  'robot.trajectory': 'computation.engineering',
  'robot.profiles': 'computation.engineering',
  'robot.torques': 'computation.engineering',

  // ---- provenance
  'engineering.assumptions': 'computation.engineering'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const ENGINEERING_LIMITS = Object.freeze({
  forces: 200,
  supports: 16,
  loads: 64,
  nodes: 200,
  members: 400,
  pieces: 128,
  layers: 32,
  joints: 12,
  coefficients: 32,
  stations: 64,
  samples: 4000
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

function vec3Of(read: Reader, key: string): Vec3 {
  const entry = objectAt(read, key)
  return { x: entry.optionalNumber('x', 0), y: entry.optionalNumber('y', 0), z: entry.optionalNumber('z', 0) }
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
 * Reads a group of arguments where the engine requires *some* of them but no single one of them.
 *
 * Passing the reader in is what makes the operation invisible to the generation catalogue, and that is the point:
 * a pipe needs a velocity or a flow rate, a floating body needs a density or a mass, and a section needs whichever
 * dimensions its shape uses. None of those can be written as "this argument is required", so an operation offered
 * with the arguments a static reader *can* see would pass the argument check and then be refused by the engine.
 * Better not offered than offered wrong.
 */
function optionalGroup(read: Reader, names: readonly string[]): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = Object.create(null)
  for (const name of names) out[name] = read.has(name) ? read.number(name) : undefined
  return out
}

function materialsOf(read: Reader): string[] {
  return read.strings('materials')
}

function forcesOf(read: Reader): Force[] {
  return read.list('forces', ENGINEERING_LIMITS.forces).map((one) => {
    const entry = new Reader(one)
    return {
      magnitude: entry.number('magnitude'),
      angleDegrees: entry.number('angleDegrees'),
      x: entry.optionalNumber('x', 0),
      y: entry.optionalNumber('y', 0),
      label: entry.optionalText('label', '', 64) || undefined
    }
  })
}

function couplesOf(read: Reader): Couple[] {
  if (!read.has('couples')) return []
  return read.list('couples', ENGINEERING_LIMITS.forces).map((one) => {
    const entry = new Reader(one)
    return { moment: entry.number('moment'), label: entry.optionalText('label', '', 64) || undefined }
  })
}

function supportsOf(read: Reader): BeamSupport[] {
  return read.list('supports', ENGINEERING_LIMITS.supports).map((one) => {
    const entry = new Reader(one)
    return {
      kind: choice<SupportKind>(entry, 'kind', SUPPORT_KINDS),
      position: entry.number('position'),
      label: entry.optionalText('label', '', 64) || undefined
    }
  })
}

function pointLoadsOf(read: Reader, key = 'pointLoads'): PointLoad[] {
  if (!read.has(key)) return []
  return read.list(key, ENGINEERING_LIMITS.loads).map((one) => {
    const entry = new Reader(one)
    return {
      magnitude: entry.number('magnitude'),
      position: entry.number('position'),
      label: entry.optionalText('label', '', 64) || undefined
    }
  })
}

function distributedLoadsOf(read: Reader): DistributedLoad[] {
  if (!read.has('distributedLoads')) return []
  return read.list('distributedLoads', ENGINEERING_LIMITS.loads).map((one) => {
    const entry = new Reader(one)
    // A uniform load is the common case, so an end intensity that is left out repeats the start rather than
    // silently tapering to zero — which would be a triangular load and a different problem.
    const start = entry.number('startIntensity')
    return {
      startIntensity: start,
      endIntensity: entry.optionalNumber('endIntensity', start),
      start: entry.number('start'),
      end: entry.number('end'),
      label: entry.optionalText('label', '', 64) || undefined
    }
  })
}

function momentsOf(read: Reader): BeamMoment[] {
  if (!read.has('moments')) return []
  return read.list('moments', ENGINEERING_LIMITS.loads).map((one) => {
    const entry = new Reader(one)
    return {
      magnitude: entry.number('magnitude'),
      position: entry.number('position'),
      label: entry.optionalText('label', '', 64) || undefined
    }
  })
}

function stressOf(read: Reader): StressState {
  return {
    sigmaX: read.optionalNumber('sigmaX', 0),
    sigmaY: read.optionalNumber('sigmaY', 0),
    tauXY: read.optionalNumber('tauXY', 0)
  }
}

function transferOf(read: Reader, key: string): TransferFunction {
  const entry = objectAt(read, key)
  return { numerator: entry.numbers('numerator'), denominator: entry.numbers('denominator') }
}

function linksOf(read: Reader): DhLink[] {
  return read.list('links', ENGINEERING_LIMITS.joints).map((one) => {
    const entry = new Reader(one)
    const type = entry.optionalText('type', 'revolute', 16)
    if (type !== 'revolute' && type !== 'prismatic') {
      throw new BadInput(`"${type}" is not a joint type; use "revolute" or "prismatic".`)
    }
    return {
      label: entry.optionalText('label', '', 64) || undefined,
      d: entry.optionalNumber('d', 0),
      theta: entry.optionalNumber('theta', 0),
      a: entry.optionalNumber('a', 0),
      alpha: entry.optionalNumber('alpha', 0),
      type,
      minimum: entry.has('minimum') ? entry.number('minimum') : undefined,
      maximum: entry.has('maximum') ? entry.number('maximum') : undefined
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

export function runEngineeringOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- materials
    case 'material.list': {
      const wanted = read.optionalText('materialClass', '', 32)
      const list = wanted
        ? materialsOfClass(choice<MaterialClass>(read, 'materialClass', MATERIAL_CLASSES))
        : MATERIALS
      return {
        ok: true,
        classes: MATERIAL_CLASSES,
        materials: list.map((one) => ({
          id: one.id,
          name: one.name,
          materialClass: one.materialClass,
          describe: one.describe,
          has: Object.keys(one.properties)
        }))
      }
    }

    case 'material.get':
      return settle(materialById(read.text('material', 64)), isMaterialError)

    case 'material.property':
      return settle(propertyOf(read.text('material', 64), read.text('property', 64)), isMaterialError)

    case 'material.compare':
      // Read through a helper on purpose. A static reader cannot see a list of names, and an operation offered to
      // Orion without the argument it actually requires would pass the argument check and then be refused by the
      // engine — worse than not being offered.
      return settle(compareProperty(materialsOf(read), read.text('property', 64)), isMaterialError)

    case 'material.properties':
      return { ok: true, names: PROPERTY_NAMES, facts: PROPERTY_FACTS }

    case 'material.elastic':
      return settle(
        elasticConstants({
          youngsModulus: read.has('youngsModulus') ? read.number('youngsModulus') : undefined,
          shearModulus: read.has('shearModulus') ? read.number('shearModulus') : undefined,
          bulkModulus: read.has('bulkModulus') ? read.number('bulkModulus') : undefined,
          poissonRatio: read.has('poissonRatio') ? read.number('poissonRatio') : undefined
        }),
        isMaterialError
      )

    case 'material.mixture':
      return settle(
        ruleOfMixtures({
          fibreModulus: read.number('fibreModulus'),
          matrixModulus: read.number('matrixModulus'),
          fibreVolumeFraction: read.number('fibreVolumeFraction')
        }),
        isMaterialError
      )

    // ---------------------------------------------------------------- statics
    case 'statics.resultant':
      return settle(
        resultant(forcesOf(read), couplesOf(read), {
          x: read.optionalNumber('aboutX', 0),
          y: read.optionalNumber('aboutY', 0)
        }),
        isStaticsError
      )

    case 'statics.beam':
      return settle(
        beamReactions({
          length: read.number('length'),
          supports: supportsOf(read),
          pointLoads: pointLoadsOf(read),
          distributedLoads: distributedLoadsOf(read),
          moments: momentsOf(read)
        }),
        isStaticsError
      )

    case 'statics.supports':
      return { ok: true, kinds: SUPPORT_KINDS, facts: SUPPORT_FACTS }

    case 'statics.truss': {
      const nodes: TrussNode[] = read.list('nodes', ENGINEERING_LIMITS.nodes).map((one) => {
        const entry = new Reader(one)
        return {
          id: entry.text('id', 64),
          x: entry.number('x'),
          y: entry.number('y'),
          support: entry.has('support') ? choice<SupportKind>(entry, 'support', SUPPORT_KINDS) : undefined
        }
      })
      const members: TrussMember[] = read.list('members', ENGINEERING_LIMITS.members).map((one) => {
        const entry = new Reader(one)
        return { id: entry.text('id', 64), from: entry.text('from', 64), to: entry.text('to', 64) }
      })
      const loads: TrussLoad[] = read.has('loads')
        ? read.list('loads', ENGINEERING_LIMITS.loads).map((one) => {
            const entry = new Reader(one)
            return { node: entry.text('node', 64), x: entry.optionalNumber('x', 0), y: entry.optionalNumber('y', 0) }
          })
        : []
      return settle(solveTruss({ nodes, members, loads }), isStaticsError)
    }

    case 'statics.slope':
      return settle(
        blockOnSlope({
          mass: read.number('mass'),
          slopeDegrees: read.number('slopeDegrees'),
          staticCoefficient: read.number('staticCoefficient'),
          kineticCoefficient: read.has('kineticCoefficient') ? read.number('kineticCoefficient') : undefined,
          appliedForce: read.has('appliedForce') ? read.number('appliedForce') : undefined,
          appliedAngleDegrees: read.has('appliedAngleDegrees') ? read.number('appliedAngleDegrees') : undefined
        }),
        isStaticsError
      )

    case 'statics.belt': {
      // The wrap is given as an angle or as a number of turns. Exactly one is needed and neither on its own is
      // required, so they are read as a group.
      const wrap = optionalGroup(read, ['wrapAngleDegrees', 'wrapTurns'])
      return settle(
        beltFriction({
          slackTension: read.number('slackTension'),
          coefficient: read.number('coefficient'),
          ...wrap
        }),
        isStaticsError
      )
    }

    case 'statics.centroid': {
      const pieces: AreaPiece[] = read.list('pieces', ENGINEERING_LIMITS.pieces).map((one) => {
        const entry = new Reader(one)
        return {
          area: entry.number('area'),
          x: entry.number('x'),
          y: entry.number('y'),
          ixx: entry.has('ixx') ? entry.number('ixx') : undefined,
          iyy: entry.has('iyy') ? entry.number('iyy') : undefined,
          hole: entry.boolean('hole', false),
          label: entry.optionalText('label', '', 64) || undefined
        }
      })
      return settle(compositeArea(pieces), isStaticsError)
    }

    // ---------------------------------------------------------------- sections and beams
    case 'section.properties': {
      const size = optionalGroup(read, [
        'width',
        'height',
        'diameter',
        'outerDiameter',
        'innerDiameter',
        'thickness',
        'flangeWidth',
        'flangeThickness',
        'webThickness'
      ])
      return settle(
        sectionProperties({ shape: read.choice('shape', SECTION_SHAPES, 'rectangle'), ...size }),
        isBeamError
      )
    }

    case 'section.shapes':
      return { ok: true, shapes: SECTION_SHAPES, facts: SECTION_FACTS }

    case 'beam.analyse': {
      const built = analyseBeam({
        kind: choice<BeamKind>(read, 'kind', BEAM_KINDS, 'simply-supported'),
        length: read.number('length'),
        supportA: read.has('supportA') ? read.number('supportA') : undefined,
        supportB: read.has('supportB') ? read.number('supportB') : undefined,
        pointLoads: pointLoadsOf(read) as readonly BeamPointLoad[],
        distributedLoads: distributedLoadsOf(read) as readonly BeamDistributedLoad[],
        moments: momentsOf(read),
        youngsModulus: read.has('youngsModulus') ? read.number('youngsModulus') : undefined,
        secondMoment: read.has('secondMoment') ? read.number('secondMoment') : undefined,
        stations: Math.round(read.optionalNumber('stations', 401))
      })
      if (isBeamError(built)) return { ok: false, ...built }
      // The beam was integrated at every station it was given; only the trace is thinned for the chart.
      const wanted = Math.round(read.optionalNumber('samples', 400))
      return { ok: true, ...built, stations: thin(built.stations, Math.max(2, Math.min(wanted, ENGINEERING_LIMITS.samples))) }
    }

    case 'beam.convention':
      return { ok: true, convention: BEAM_CONVENTION, kinds: BEAM_KINDS }

    case 'stress.mohr':
      return settle(mohrsCircle(stressOf(read)), isBeamError)

    case 'stress.failure':
      return settle(
        checkFailure({
          state: stressOf(read),
          strength: read.number('strength'),
          criterion: choice<FailureCriterion>(read, 'criterion', FAILURE_CRITERIA, 'distortion-energy')
        }),
        isBeamError
      )

    case 'stress.criteria':
      return { ok: true, criteria: FAILURE_CRITERIA, facts: FAILURE_FACTS }

    case 'column.buckling':
      return settle(
        eulerBuckling({
          youngsModulus: read.number('youngsModulus'),
          secondMoment: read.number('secondMoment'),
          length: read.number('length'),
          endCondition: choice<EndCondition>(read, 'endCondition', END_CONDITIONS, 'pinned-pinned'),
          area: read.has('area') ? read.number('area') : undefined,
          yieldStrength: read.has('yieldStrength') ? read.number('yieldStrength') : undefined
        }),
        isBeamError
      )

    case 'column.ends':
      return { ok: true, conditions: END_CONDITIONS, facts: END_FACTS }

    case 'shaft.torsion':
      return settle(
        shaftTorsion({
          torque: read.number('torque'),
          outerDiameter: read.number('outerDiameter'),
          innerDiameter: read.optionalNumber('innerDiameter', 0),
          length: read.has('length') ? read.number('length') : undefined,
          shearModulus: read.has('shearModulus') ? read.number('shearModulus') : undefined
        }),
        isBeamError
      )

    // ---------------------------------------------------------------- fluids
    case 'fluid.list':
      return {
        ok: true,
        fluids: FLUIDS.map((one) => ({
          id: one.id,
          name: one.name,
          density: one.density,
          referenceTemperature: one.referenceTemperature,
          source: one.source
        }))
      }

    case 'fluid.get':
      return settle(fluidById(read.text('fluid', 64)), isFluidError)

    case 'fluid.pressure':
      return settle(
        pressureAtDepth({
          depth: read.number('depth'),
          fluid: read.optionalText('fluid', '', 64) || undefined,
          density: read.has('density') ? read.number('density') : undefined,
          surfacePressure: read.has('surfacePressure') ? read.number('surfacePressure') : undefined
        }),
        isFluidError
      )

    case 'fluid.buoyancy': {
      // The body can be described by its density or by its mass. One of the two is needed and neither on its own
      // is required, so they are read as a group.
      const body = optionalGroup(read, ['objectDensity', 'objectMass', 'fluidDensity'])
      return settle(
        buoyancy({
          objectVolume: read.number('objectVolume'),
          fluid: read.optionalText('fluid', '', 64) || undefined,
          ...body
        }),
        isFluidError
      )
    }

    case 'fluid.dimensionless':
      return settle(
        dimensionless({
          number: read.choice('number', DIMENSIONLESS_NUMBERS, 'reynolds'),
          velocity: read.has('velocity') ? read.number('velocity') : undefined,
          length: read.has('length') ? read.number('length') : undefined,
          density: read.has('density') ? read.number('density') : undefined,
          dynamicViscosity: read.has('dynamicViscosity') ? read.number('dynamicViscosity') : undefined,
          kinematicViscosity: read.has('kinematicViscosity') ? read.number('kinematicViscosity') : undefined,
          speedOfSound: read.has('speedOfSound') ? read.number('speedOfSound') : undefined,
          surfaceTension: read.has('surfaceTension') ? read.number('surfaceTension') : undefined,
          pressureDrop: read.has('pressureDrop') ? read.number('pressureDrop') : undefined,
          frequency: read.has('frequency') ? read.number('frequency') : undefined,
          specificHeat: read.has('specificHeat') ? read.number('specificHeat') : undefined,
          thermalConductivity: read.has('thermalConductivity') ? read.number('thermalConductivity') : undefined,
          heatTransferCoefficient: read.has('heatTransferCoefficient') ? read.number('heatTransferCoefficient') : undefined,
          expansionCoefficient: read.has('expansionCoefficient') ? read.number('expansionCoefficient') : undefined,
          temperatureDifference: read.has('temperatureDifference') ? read.number('temperatureDifference') : undefined,
          prandtl: read.has('prandtl') ? read.number('prandtl') : undefined,
          reynolds: read.has('reynolds') ? read.number('reynolds') : undefined,
          grashof: read.has('grashof') ? read.number('grashof') : undefined
        }),
        isFluidError
      )

    case 'fluid.numbers':
      return { ok: true, numbers: DIMENSIONLESS_NUMBERS, facts: DIMENSIONLESS_FACTS }

    case 'fluid.pipe': {
      // A pipe needs a velocity or a flow rate. Either will do and neither alone is required, so they are read
      // as a group.
      const driving = optionalGroup(read, ['velocity', 'flowRate', 'density', 'dynamicViscosity', 'roughness'])
      return settle(
        pipeFlow({
          diameter: read.number('diameter'),
          length: read.number('length'),
          fluid: read.optionalText('fluid', '', 64) || undefined,
          ...driving,
          // Left out rather than defaulted: the engine picks the laminar law below the transition and Colebrook
          // above it, and forcing Colebrook here would iterate it over a regime it was never fitted for.
          frictionModel: read.has('frictionModel')
            ? choice<FrictionModel>(read, 'frictionModel', FRICTION_MODELS)
            : undefined,
          minorLossCoefficients: read.has('minorLossCoefficients')
            ? read.numbers('minorLossCoefficients', ENGINEERING_LIMITS.coefficients)
            : undefined
        }),
        isFluidError
      )
    }

    case 'fluid.friction-models':
      return { ok: true, models: FRICTION_MODELS, facts: FRICTION_FACTS }

    case 'fluid.energy': {
      const from = objectAt(read, 'from')
      const to = objectAt(read, 'to')
      return settle(
        energyEquation({
          from: {
            pressure: from.optionalNumber('pressure', 0),
            velocity: from.optionalNumber('velocity', 0),
            elevation: from.optionalNumber('elevation', 0),
            label: from.optionalText('label', '', 64) || undefined
          },
          to: {
            pressure: to.optionalNumber('pressure', 0),
            velocity: to.optionalNumber('velocity', 0),
            elevation: to.optionalNumber('elevation', 0),
            label: to.optionalText('label', '', 64) || undefined
          },
          fluid: read.optionalText('fluid', '', 64) || undefined,
          density: read.has('density') ? read.number('density') : undefined,
          headLoss: read.has('headLoss') ? read.number('headLoss') : undefined,
          pumpHead: read.has('pumpHead') ? read.number('pumpHead') : undefined
        }),
        isFluidError
      )
    }

    case 'fluid.continuity': {
      const stations = read.list('stations', ENGINEERING_LIMITS.stations).map((one) => {
        const entry = new Reader(one)
        return {
          area: entry.number('area'),
          velocity: entry.has('velocity') ? entry.number('velocity') : undefined,
          density: entry.has('density') ? entry.number('density') : undefined,
          label: entry.optionalText('label', '', 64) || undefined
        }
      })
      return settle(
        continuity({
          stations,
          massFlowRate: read.has('massFlowRate') ? read.number('massFlowRate') : undefined,
          fluid: read.optionalText('fluid', '', 64) || undefined,
          density: read.has('density') ? read.number('density') : undefined
        }),
        isFluidError
      )
    }

    case 'fluid.pump':
      return settle(
        pumpPerformance({
          head: read.number('head'),
          flowRate: read.number('flowRate'),
          efficiency: read.optionalNumber('efficiency', 0.7),
          fluid: read.optionalText('fluid', '', 64) || undefined,
          density: read.has('density') ? read.number('density') : undefined,
          vapourPressure: read.has('vapourPressure') ? read.number('vapourPressure') : undefined,
          suctionPressure: read.has('suctionPressure') ? read.number('suctionPressure') : undefined,
          suctionLift: read.has('suctionLift') ? read.number('suctionLift') : undefined,
          suctionLosses: read.has('suctionLosses') ? read.number('suctionLosses') : undefined,
          requiredNpsh: read.has('requiredNpsh') ? read.number('requiredNpsh') : undefined
        }),
        isFluidError
      )

    case 'fluid.channel': {
      // Which dimensions a channel needs depends on its shape: a width for rectangular, a side slope as well for
      // trapezoidal, a diameter for circular. Read as a group for that reason.
      const size = optionalGroup(read, ['width', 'sideSlope', 'diameter'])
      return settle(
        openChannel({
          shape: read.choice('shape', CHANNEL_SHAPES, 'rectangular'),
          depth: read.number('depth'),
          slope: read.number('slope'),
          manningN: read.number('manningN'),
          ...size
        }),
        isFluidError
      )
    }

    // ---------------------------------------------------------------- heat transfer
    case 'heat.resistance': {
      const layers: ConductionLayer[] = read.list('layers', ENGINEERING_LIMITS.layers).map((one) => {
        const entry = new Reader(one)
        return {
          label: entry.optionalText('label', '', 64) || undefined,
          conductivity: entry.number('conductivity'),
          thickness: entry.has('thickness') ? entry.number('thickness') : undefined,
          innerRadius: entry.has('innerRadius') ? entry.number('innerRadius') : undefined,
          outerRadius: entry.has('outerRadius') ? entry.number('outerRadius') : undefined
        }
      })
      return settle(
        resistanceNetwork({
          geometry: choice<LayerGeometry>(read, 'geometry', LAYER_GEOMETRIES, 'plane'),
          layers,
          insideFilm: read.has('insideCoefficient') ? { coefficient: read.number('insideCoefficient') } : undefined,
          outsideFilm: read.has('outsideCoefficient') ? { coefficient: read.number('outsideCoefficient') } : undefined,
          area: read.has('area') ? read.number('area') : undefined,
          length: read.has('length') ? read.number('length') : undefined,
          insideTemperature: read.has('insideTemperature') ? read.number('insideTemperature') : undefined,
          outsideTemperature: read.has('outsideTemperature') ? read.number('outsideTemperature') : undefined
        }),
        isHeatError
      )
    }

    case 'heat.convection': {
      // A forced correlation needs a velocity and a viscosity; a natural one needs a Rayleigh number, or the
      // ingredients to work one out. Which are required depends on the correlation, so they are read as a group.
      const conditions = optionalGroup(read, [
        'velocity',
        'kinematicViscosity',
        'rayleigh',
        'expansionCoefficient',
        'temperatureDifference',
        'area'
      ])
      return settle(
        convection({
          correlation: read.choice('correlation', CONVECTION_CORRELATIONS, 'dittus-boelter'),
          characteristicLength: read.number('characteristicLength'),
          thermalConductivity: read.number('thermalConductivity'),
          prandtl: read.number('prandtl'),
          heating: read.boolean('heating', true),
          ...conditions
        }),
        isHeatError
      )
    }

    case 'heat.correlations':
      return { ok: true, correlations: CONVECTION_CORRELATIONS, facts: CONVECTION_FACTS }

    case 'heat.radiation':
      return settle(
        radiation({
          surfaceTemperature: read.number('surfaceTemperature'),
          surroundingTemperature: read.number('surroundingTemperature'),
          emissivity: read.number('emissivity'),
          area: read.optionalNumber('area', 1),
          viewFactor: read.optionalNumber('viewFactor', 1)
        }),
        isHeatError
      )

    case 'heat.fin': {
      const tip = read.optionalText('tip', 'adiabatic', 16)
      if (tip !== 'adiabatic' && tip !== 'convecting' && tip !== 'infinite') {
        throw new BadInput(`"${tip}" is not a fin tip condition; use adiabatic, convecting or infinite.`)
      }
      return settle(
        straightFin({
          length: read.number('length'),
          crossSectionArea: read.number('crossSectionArea'),
          perimeter: read.number('perimeter'),
          conductivity: read.number('conductivity'),
          coefficient: read.number('coefficient'),
          baseTemperature: read.number('baseTemperature'),
          ambientTemperature: read.number('ambientTemperature'),
          tip: tip as FinTip
        }),
        isHeatError
      )
    }

    case 'heat.lmtd':
      return settle(
        lmtd({
          arrangement: choice<ExchangerArrangement>(read, 'arrangement', EXCHANGER_ARRANGEMENTS, 'counter-flow'),
          hotInlet: read.number('hotInlet'),
          hotOutlet: read.number('hotOutlet'),
          coldInlet: read.number('coldInlet'),
          coldOutlet: read.number('coldOutlet'),
          overallCoefficient: read.has('overallCoefficient') ? read.number('overallCoefficient') : undefined,
          heatDuty: read.has('heatDuty') ? read.number('heatDuty') : undefined
        }),
        isHeatError
      )

    case 'heat.ntu':
      return settle(
        effectivenessNtu({
          arrangement: choice<ExchangerArrangement>(read, 'arrangement', EXCHANGER_ARRANGEMENTS, 'counter-flow'),
          overallCoefficient: read.number('overallCoefficient'),
          area: read.number('area'),
          hotCapacityRate: read.number('hotCapacityRate'),
          coldCapacityRate: read.number('coldCapacityRate'),
          hotInlet: read.number('hotInlet'),
          coldInlet: read.number('coldInlet')
        }),
        isHeatError
      )

    case 'heat.transient': {
      const built = lumpedCapacitance({
        volume: read.number('volume'),
        surfaceArea: read.number('surfaceArea'),
        density: read.number('density'),
        specificHeat: read.number('specificHeat'),
        coefficient: read.number('coefficient'),
        conductivity: read.number('conductivity'),
        initialTemperature: read.number('initialTemperature'),
        ambientTemperature: read.number('ambientTemperature'),
        duration: read.has('duration') ? read.number('duration') : undefined,
        samples: Math.round(read.optionalNumber('samples', 200)),
        targetTemperature: read.has('targetTemperature') ? read.number('targetTemperature') : undefined
      })
      return isHeatError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    // ---------------------------------------------------------------- control systems
    case 'control.roots': {
      const roots = polynomialRoots(read.numbers('coefficients'))
      if (isControlError(roots)) return { ok: false, ...roots }
      return { ok: true, roots }
    }

    case 'control.poles':
      return settle(poleZero(transferOf(read, 'system')), isControlError)

    case 'control.closed-loop': {
      const built = closedLoop(
        transferOf(read, 'forward'),
        read.has('feedback') ? transferOf(read, 'feedback') : undefined
      )
      return { ok: true, system: built }
    }

    case 'control.series':
      return { ok: true, system: series(transferOf(read, 'first'), transferOf(read, 'second')) }

    case 'control.step': {
      const built = stepResponse(transferOf(read, 'system'), {
        duration: read.has('duration') ? read.number('duration') : undefined,
        samples: Math.round(read.optionalNumber('samples', 600)),
        settlingBand: read.optionalNumber('settlingBand', 0.02)
      })
      return isControlError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'control.bode': {
      const built = bode(transferOf(read, 'system'), {
        from: read.optionalNumber('from', 0.01),
        to: read.optionalNumber('to', 1000),
        points: Math.round(read.optionalNumber('points', 400))
      })
      return isControlError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'control.routh':
      return settle(routhHurwitz(read.numbers('coefficients')), isControlError)

    case 'control.tune': {
      const form = read.optionalText('form', 'PID', 8)
      if (form !== 'P' && form !== 'PI' && form !== 'PID') {
        throw new BadInput(`"${form}" is not a controller form; use P, PI or PID.`)
      }
      const built = tunePid({
        rule: choice<TuningRule>(read, 'rule', TUNING_RULES),
        form,
        ultimateGain: read.has('ultimateGain') ? read.number('ultimateGain') : undefined,
        ultimatePeriod: read.has('ultimatePeriod') ? read.number('ultimatePeriod') : undefined,
        processGain: read.has('processGain') ? read.number('processGain') : undefined,
        timeConstant: read.has('timeConstant') ? read.number('timeConstant') : undefined,
        deadTime: read.has('deadTime') ? read.number('deadTime') : undefined,
        closedLoopTimeConstant: read.has('closedLoopTimeConstant') ? read.number('closedLoopTimeConstant') : undefined,
        plant: read.has('plant') ? transferOf(read, 'plant') : undefined
      })
      if (isControlError(built)) return { ok: false, ...built }
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('samples', 400)), ENGINEERING_LIMITS.samples))
      return {
        ok: true,
        ...built,
        response: built.response ? { ...built.response, samples: thin(built.response.samples, wanted) } : null
      }
    }

    case 'control.rules':
      return { ok: true, rules: TUNING_RULES, facts: TUNING_FACTS }

    case 'control.simulate': {
      const gains = objectAt(read, 'gains')
      const built = simulatePid({
        plant: transferOf(read, 'plant'),
        gains: {
          proportional: gains.optionalNumber('proportional', 0),
          integral: gains.optionalNumber('integral', 0),
          derivative: gains.optionalNumber('derivative', 0)
        },
        setpoint: read.optionalNumber('setpoint', 1),
        duration: read.number('duration'),
        timeStep: read.has('timeStep') ? read.number('timeStep') : undefined,
        outputMinimum: read.has('outputMinimum') ? read.number('outputMinimum') : undefined,
        outputMaximum: read.has('outputMaximum') ? read.number('outputMaximum') : undefined,
        antiWindup: read.boolean('antiWindup', true),
        derivativeFilter: read.optionalNumber('derivativeFilter', 0)
      })
      if (isControlError(built)) return { ok: false, ...built }
      // The loop was integrated at its own time step; only the trace is thinned on the way out.
      const wanted = Math.max(2, Math.min(Math.round(read.optionalNumber('samples', 600)), ENGINEERING_LIMITS.samples))
      return { ok: true, ...built, samples: thin(built.samples, wanted) }
    }

    // ---------------------------------------------------------------- robotics
    case 'robot.forward':
      return settle(
        forwardKinematics(
          linksOf(read),
          read.numbers('values', ENGINEERING_LIMITS.joints),
          read.optionalText('convention', 'standard', 16) === 'modified' ? 'modified' : 'standard'
        ),
        isRoboticsError
      )

    case 'robot.jacobian':
      return settle(
        jacobian(
          linksOf(read),
          read.numbers('values', ENGINEERING_LIMITS.joints),
          read.optionalText('convention', 'standard', 16) === 'modified' ? 'modified' : 'standard'
        ),
        isRoboticsError
      )

    case 'robot.inverse':
      return settle(
        inverseKinematics({
          links: linksOf(read),
          target: {
            position: vec3Of(read, 'target'),
            roll: read.optionalNumber('roll', 0),
            pitch: read.optionalNumber('pitch', 0),
            yaw: read.optionalNumber('yaw', 0)
          },
          initial: read.has('initial') ? read.numbers('initial', ENGINEERING_LIMITS.joints) : undefined,
          convention: (read.optionalText('convention', 'standard', 16) === 'modified'
            ? 'modified'
            : 'standard') as DhConvention,
          positionOnly: read.boolean('positionOnly', true),
          tolerance: read.optionalNumber('tolerance', 1e-5),
          maxIterations: Math.round(read.optionalNumber('maxIterations', 200)),
          damping: read.optionalNumber('damping', 0.05),
          respectLimits: read.boolean('respectLimits', true)
        }),
        isRoboticsError
      )

    case 'robot.trajectory': {
      // A trapezoidal profile is defined by its speed and acceleration limits; a cubic or quintic one by its
      // duration. Which are required depends on the profile, so they are read as a group.
      const shape = optionalGroup(read, ['duration', 'maximumVelocity', 'maximumAcceleration'])
      const built = trajectory({
        profile: read.choice('profile', TRAJECTORY_PROFILES, 'trapezoidal'),
        from: read.number('from'),
        to: read.number('to'),
        samples: Math.round(read.optionalNumber('samples', 200)),
        ...shape
      })
      return isRoboticsError(built) ? { ok: false, ...built } : { ok: true, ...built }
    }

    case 'robot.profiles':
      return { ok: true, profiles: TRAJECTORY_PROFILES }

    case 'robot.torques':
      return settle(
        staticTorques({
          links: linksOf(read),
          values: read.numbers('values', ENGINEERING_LIMITS.joints),
          force: vec3Of(read, 'force'),
          moment: read.has('moment') ? vec3Of(read, 'moment') : undefined,
          convention: (read.optionalText('convention', 'standard', 16) === 'modified'
            ? 'modified'
            : 'standard') as DhConvention
        }),
        isRoboticsError
      )

    // ---------------------------------------------------------------- provenance
    case 'engineering.assumptions':
      return {
        ok: true,
        materials: MATERIAL_ASSUMPTIONS,
        statics: STATICS_ASSUMPTIONS,
        beams: BEAM_ASSUMPTIONS,
        fluids: FLUID_ASSUMPTIONS,
        heat: HEAT_ASSUMPTIONS,
        control: CONTROL_ASSUMPTIONS,
        robotics: ROBOT_ASSUMPTIONS
      }

    default:
      throw new BadInput(`"${operation}" is not an engineering operation.`)
  }
}
