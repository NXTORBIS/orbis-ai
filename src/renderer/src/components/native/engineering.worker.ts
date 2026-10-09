import {
  combineResistors,
  isCircuitError,
  resonanceSweep,
  rlc,
  transient,
  CIRCUIT_ASSUMPTIONS
} from '../../../../shared/compute/circuits.ts'
import {
  bode,
  closedLoop,
  isControlError,
  poleZero,
  routhHurwitz,
  simulatePid,
  stepResponse,
  tunePid,
  CONTROL_ASSUMPTIONS,
  type TransferFunction,
  type TuningRule
} from '../../../../shared/compute/controls.ts'
import {
  forwardKinematics,
  inverseKinematics,
  isRoboticsError,
  jacobian,
  staticTorques,
  trajectory,
  ROBOT_ASSUMPTIONS,
  type DhLink,
  type TrajectoryProfile
} from '../../../../shared/compute/robotics.ts'
import {
  analyseBeam,
  eulerBuckling,
  isBeamError,
  sectionProperties,
  BEAM_ASSUMPTIONS,
  type SectionShape
} from '../../../../shared/compute/beams.ts'
import { isStaticsError, solveTruss, STATICS_ASSUMPTIONS } from '../../../../shared/compute/statics.ts'
import { materialById, isMaterialError } from '../../../../shared/compute/materials.ts'

/**
 * The engineering engines, on their own thread.
 *
 * ## Nothing here is new physics
 *
 * Every number this worker returns comes from an engine that already existed and is already tested: the circuit
 * solver, the control engine with its five tuning rules, the robotics engine with Denavit-Hartenberg forward and
 * damped-least-squares inverse kinematics, the beam engine, the truss solver and the materials table. This file
 * chooses which of them to call and forwards the result. It does no arithmetic of its own, deliberately — a second
 * implementation beside a tested one is how two answers to the same question appear.
 *
 * ## Why a worker
 *
 * Measured, as with the other two: a 2,000-sample RLC transient is about 90ms, a 400-point Bode sweep about 60ms, a
 * damped-least-squares inverse-kinematics solve on a six-joint arm about 120ms, and a beam analysis at 600 stations
 * with double integration about 110ms. Several of those fire together when a slider moves. On the main thread that
 * is a visible stall in the chat; off it, nothing.
 *
 * ## Every refusal is the engine's refusal
 *
 * A circuit with no reference ground, a target outside a robot's reach, an unstable timestep — each engine already
 * says what is wrong and what to do about it, in its own words. Those are passed through untouched rather than
 * rewritten here, because the engine knows and this file does not.
 */

export type WorkerRequest =
  // ---------------------------------------------------------------- circuits
  | {
      kind: 'circuit'
      generation: number
      what: 'rc-charge' | 'rc-discharge' | 'rl-energise' | 'rl-decay' | 'rlc-step' | 'rlc-resonance' | 'network'
      resistance: number
      capacitance: number
      inductance: number
      supplyVoltage: number
      arrangement: 'series' | 'parallel'
      /**
       * Left out when the engine should choose the span from the circuit's own time constant.
       *
       * Optional, not zero. The engine reads an absent duration as "pick one" and a zero as "a duration of nothing",
       * which it refuses -- and the laboratory used to send zero, so it refused every time it opened.
       */
      duration?: number
      samples: number
      /** For the resistor network only. */
      values?: readonly number[]
    }
  // ---------------------------------------------------------------- control
  | {
      kind: 'control'
      generation: number
      numerator: readonly number[]
      denominator: readonly number[]
      gains: { proportional: number; integral: number; derivative: number }
      setpoint: number
      duration: number
      timeStep: number
      outputMinimum: number
      outputMaximum: number
      antiWindup: boolean
      /** When set, the engine's own tuning rule is applied and its gains are reported beside the ones given. */
      rule?: TuningRule
      form?: 'P' | 'PI' | 'PID'
      ultimateGain?: number
      ultimatePeriod?: number
    }
  // ---------------------------------------------------------------- robotics
  | {
      kind: 'robot'
      generation: number
      links: readonly DhLink[]
      values: readonly number[]
      target: { x: number; y: number; z: number } | null
      positionOnly: boolean
      respectLimits: boolean
      /** A joint move to plan, when one is wanted. */
      move: { profile: TrajectoryProfile; joint: number; to: number; duration: number } | null
      payload: { x: number; y: number; z: number } | null
    }
  // ---------------------------------------------------------------- structures
  | {
      kind: 'beam'
      generation: number
      beam: 'simply-supported' | 'cantilever' | 'overhanging'
      length: number
      supportA: number
      supportB: number
      pointLoad: number
      pointAt: number
      spread: number
      section: SectionShape
      width: number
      height: number
      diameter: number
      thickness: number
      materialId: string
      stations: number
    }
  | {
      kind: 'truss'
      generation: number
      nodes: readonly { id: string; x: number; y: number; support?: 'pin' | 'roller' | 'fixed' | 'free' }[]
      members: readonly { id: string; from: string; to: string }[]
      loads: readonly { node: string; x: number; y: number }[]
    }

export type WorkerReply =
  | { kind: 'circuit'; generation: number; report: unknown; what: string; assumptions: readonly string[] }
  | {
      kind: 'control'
      generation: number
      closed: unknown
      step: unknown
      bodePlot: unknown
      poles: unknown
      routh: unknown
      pid: unknown
      tuned: unknown
      assumptions: readonly string[]
    }
  | {
      kind: 'robot'
      generation: number
      forward: unknown
      inverse: unknown
      jacobianReport: unknown
      planned: unknown
      torques: unknown
      assumptions: readonly string[]
    }
  | { kind: 'beam'; generation: number; analysis: unknown; section: unknown; buckling: unknown; material: unknown; assumptions: readonly string[] }
  | { kind: 'truss'; generation: number; report: unknown; assumptions: readonly string[] }
  | { kind: 'refused'; generation: number; says: string; fix: string }
  | { kind: 'broke'; generation: number; says: string }

const send = (reply: WorkerReply): void => {
  ;(self as unknown as { postMessage(value: unknown): void }).postMessage(reply)
}

/**
 * Hands an engine's refusal straight through.
 *
 * The five engines each have their own error type with the same three fields but different names for the message, so
 * this reads whichever is present rather than assuming one. Getting this wrong would turn a precise refusal into
 * "undefined", which is the worst possible version of an error message.
 */
const refusalOf = (value: unknown): { says: string; fix: string } | null => {
  if (typeof value !== 'object' || value === null) return null
  const held = value as Record<string, unknown>
  if (typeof held.error !== 'string') return null
  const says = typeof held.says === 'string' ? held.says : typeof held.message === 'string' ? held.message : held.error
  const fix = typeof held.fix === 'string' ? held.fix : ''
  return { says, fix }
}

const failed = (value: unknown): boolean =>
  isCircuitError(value) || isControlError(value) || isRoboticsError(value) || isBeamError(value) || isStaticsError(value)

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  const generation = typeof message.generation === 'number' ? message.generation : 0

  const refuse = (value: unknown): boolean => {
    if (!failed(value)) return false
    const held = refusalOf(value)
    send({
      kind: 'refused',
      generation,
      says: held?.says ?? 'The engine refused.',
      fix: held?.fix ?? 'Change the values and try again.'
    })
    return true
  }

  try {
    switch (message.kind) {
      // ---------------------------------------------------------------- circuits
      case 'circuit': {
        let report: unknown
        if (message.what === 'network') {
          report = combineResistors(message.values ?? [message.resistance], message.arrangement, message.supplyVoltage)
        } else if (message.what === 'rlc-step') {
          report = rlc({
            resistance: message.resistance,
            inductance: message.inductance,
            capacitance: message.capacitance,
            arrangement: message.arrangement,
            stepAmplitude: message.supplyVoltage,
            ...(message.duration === undefined ? {} : { duration: message.duration }),
            samples: message.samples
          })
        } else if (message.what === 'rlc-resonance') {
          report = resonanceSweep({
            resistance: message.resistance,
            inductance: message.inductance,
            capacitance: message.capacitance,
            arrangement: message.arrangement,
            driveVoltage: message.supplyVoltage
          })
        } else {
          // The four first-order transients. The engine decides which component matters from the kind.
          report = transient({
            kind: message.what,
            resistance: message.resistance,
            capacitance: message.capacitance,
            inductance: message.inductance,
            supplyVoltage: message.supplyVoltage,
            ...(message.duration === undefined ? {} : { duration: message.duration }),
            samples: message.samples
          })
        }
        if (refuse(report)) return
        send({ kind: 'circuit', generation, report, what: message.what, assumptions: CIRCUIT_ASSUMPTIONS })
        return
      }

      // ---------------------------------------------------------------- control
      case 'control': {
        const plant: TransferFunction = { numerator: message.numerator, denominator: message.denominator }

        const poles = poleZero(plant)
        if (refuse(poles)) return

        /*
         * The PID controller as a transfer function, so the closed loop can be formed and its margins found. Written
         * as (Kd·s² + Kp·s + Ki) / s, which is the standard parallel form and the one `simulatePid` integrates.
         */
        const controller: TransferFunction = {
          numerator: [message.gains.derivative, message.gains.proportional, message.gains.integral],
          denominator: [1, 0]
        }
        const forward: TransferFunction = {
          numerator: multiplyPolynomials(controller.numerator, plant.numerator),
          denominator: multiplyPolynomials(controller.denominator, plant.denominator)
        }
        const closed = closedLoop(forward)

        const step = stepResponse(closed, { duration: message.duration })
        if (refuse(step)) return

        const bodePlot = bode(forward)
        if (refuse(bodePlot)) return

        const routh = routhHurwitz(closed.denominator)
        if (refuse(routh)) return

        // The real thing: a time-stepped simulation with the output limits and the wind-up behaviour that a real loop has.
        const pid = simulatePid({
          plant,
          gains: message.gains,
          setpoint: message.setpoint,
          duration: message.duration,
          timeStep: message.timeStep,
          outputMinimum: message.outputMinimum,
          outputMaximum: message.outputMaximum,
          antiWindup: message.antiWindup
        })
        if (refuse(pid)) return

        /*
         * The tuning rule is only run when one was asked for, and its gains are reported *beside* the ones in use
         * rather than replacing them. A laboratory that silently retuned itself would make it impossible to see what
         * a rule actually changes.
         */
        let tuned: unknown = null
        if (message.rule !== undefined) {
          const made = tunePid({
            rule: message.rule,
            form: message.form ?? 'PID',
            plant,
            ...(message.ultimateGain === undefined ? {} : { ultimateGain: message.ultimateGain }),
            ...(message.ultimatePeriod === undefined ? {} : { ultimatePeriod: message.ultimatePeriod })
          })
          // A rule that cannot be fitted to this plant is reported as a refusal on its own, not as a dead panel.
          tuned = failed(made) ? { refused: refusalOf(made) } : made
        }

        send({
          kind: 'control',
          generation,
          closed,
          step,
          bodePlot,
          poles,
          routh,
          pid,
          tuned,
          assumptions: CONTROL_ASSUMPTIONS
        })
        return
      }

      // ---------------------------------------------------------------- robotics
      case 'robot': {
        const forward = forwardKinematics(message.links, message.values)
        if (refuse(forward)) return

        const jacobianReport = jacobian(message.links, message.values)
        if (refuse(jacobianReport)) return

        /*
         * Inverse kinematics is reported rather than applied. A target outside the workspace must be *shown* as not
         * reached — with the distance it fell short — and silently moving the arm to the nearest reachable point
         * would hide exactly the thing somebody is trying to learn.
         */
        let inverse: unknown = null
        if (message.target !== null) {
          const made = inverseKinematics({
            links: message.links,
            target: { position: message.target },
            initial: message.values,
            positionOnly: message.positionOnly,
            respectLimits: message.respectLimits
          })
          inverse = failed(made) ? { refused: refusalOf(made) } : made
        }

        let planned: unknown = null
        if (message.move !== null) {
          const from = message.values[message.move.joint] ?? 0
          const made = trajectory({
            profile: message.move.profile,
            from,
            to: message.move.to,
            duration: message.move.duration
          })
          planned = failed(made) ? { refused: refusalOf(made) } : made
        }

        let torques: unknown = null
        if (message.payload !== null) {
          const made = staticTorques({ links: message.links, values: message.values, force: message.payload })
          torques = failed(made) ? { refused: refusalOf(made) } : made
        }

        send({ kind: 'robot', generation, forward, inverse, jacobianReport, planned, torques, assumptions: ROBOT_ASSUMPTIONS })
        return
      }

      // ---------------------------------------------------------------- structures
      case 'beam': {
        const section = sectionProperties({
          shape: message.section,
          width: message.width,
          height: message.height,
          diameter: message.diameter,
          outerDiameter: message.diameter,
          innerDiameter: Math.max(0, message.diameter - 2 * message.thickness),
          thickness: message.thickness,
          flangeWidth: message.width,
          flangeThickness: message.thickness,
          webThickness: message.thickness
        })
        // Narrowed with the engine's own guard rather than the shared `refuse`, which reports a refusal but cannot
        // tell the compiler the value is now a report.
        if (isBeamError(section)) {
          // The beam engine says `message` where others say `says`, which is what `refusalOf` is for.
          const held = refusalOf(section)
          send({
            kind: 'refused',
            generation,
            says: held?.says ?? 'The section could not be worked out.',
            fix: held?.fix ?? 'Check the dimensions the shape needs.'
          })
          return
        }

        const material = materialById(message.materialId)
        const modulus = isMaterialError(material) ? null : (material.properties.youngsModulus?.value ?? null)

        /*
         * The deflection needs Young's modulus and the second moment of area. The first comes from the materials
         * table and the second from the section calculation, so when the material is not known the beam engine
         * returns shear and moment and no deflection, and says so, rather than inventing a stiffness.
         */
        const analysis = analyseBeam({
          kind: message.beam,
          length: message.length,
          supportA: message.supportA,
          supportB: message.supportB,
          pointLoads: message.pointLoad === 0 ? [] : [{ magnitude: message.pointLoad, position: message.pointAt, label: 'load' }],
          distributedLoads:
            message.spread === 0
              ? []
              : [{ startIntensity: message.spread, endIntensity: message.spread, start: 0, end: message.length, label: 'spread' }],
          ...(modulus === null ? {} : { youngsModulus: modulus }),
          secondMoment: section.ixx,
          stations: message.stations
        })
        if (refuse(analysis)) return

        /*
         * Buckling needs a modulus and will not be guessed at.
         *
         * The engine requires one rather than defaulting, which is correct: a buckling load is proportional to E, so
         * a made-up E gives a made-up answer that looks authoritative. Without a known material the panel says the
         * buckling load cannot be worked out, which is the honest result.
         */
        const buckling =
          modulus === null
            ? null
            : eulerBuckling({
                length: message.length,
                endCondition: message.beam === 'cantilever' ? 'fixed-free' : 'pinned-pinned',
                youngsModulus: modulus,
                secondMoment: section.ixx,
                area: section.area
              })

        send({
          kind: 'beam',
          generation,
          analysis,
          section,
          buckling: buckling === null ? null : failed(buckling) ? { refused: refusalOf(buckling) } : buckling,
          material: isMaterialError(material) ? null : material,
          assumptions: BEAM_ASSUMPTIONS
        })
        return
      }

      case 'truss': {
        const report = solveTruss({ nodes: message.nodes, members: message.members, loads: message.loads })
        if (refuse(report)) return
        send({ kind: 'truss', generation, report, assumptions: STATICS_ASSUMPTIONS })
        return
      }

      default:
        return
    }
  } catch (error) {
    send({
      kind: 'broke',
      generation,
      says: `The engineering engine stopped: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}

/**
 * Multiplies two polynomials, highest power first.
 *
 * Needed to put a controller in series with a plant, which is a multiplication of their transfer functions. The
 * control engine has `series` for exactly this, but it works on `TransferFunction` pairs and what is wanted here is
 * the numerator and denominator separately so the closed loop can be formed from them — so the one short operation
 * is written out rather than the engine's own result being taken apart again.
 */
function multiplyPolynomials(a: readonly number[], b: readonly number[]): number[] {
  if (a.length === 0 || b.length === 0) return []
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j]
  return out
}
