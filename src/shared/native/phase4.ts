import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { SECTION_SHAPES } from '../compute/beams.ts'
import { MATERIALS } from '../compute/materials.ts'
import { TUNING_RULES } from '../compute/controls.ts'
import { TRAJECTORY_PROFILES } from '../compute/robotics.ts'

/**
 * The Phase 4 Native Apps: engineering.
 *
 * ## Every one of these is a surface over an engine that already existed
 *
 * The circuit solver, the control engine, the robotics engine and the beam and truss solvers were all in Orbis
 * before this phase and all already tested. Phase 4's claim is not that it added engineering to Orbis; it is that
 * the engineering Orbis had could not be reached from a conversation, and now can. That is why there is no new
 * physics in this file and why the option lists below are read from the engines rather than retyped — a choice that
 * offered a material or a tuning rule the engine does not have would be a dead control, and reading the list makes
 * that impossible rather than merely unlikely.
 *
 * ## What is not here
 *
 * No digital logic, no microcontroller, no CAD, no finite-element analysis beyond beams and trusses, no machine
 * learning, no networking, no operating-system or processor simulation. Those engines do not exist in Orbis, so
 * there are no manifests for them: a registered app with nothing behind it is the failure this whole platform is
 * built to prevent, and the brief is explicit that a capability which cannot be delivered must not be advertised.
 *
 * Pure.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Work it out with the current values', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Go back to the starting values', takes: [], idempotent: true, destructive: false }
]

// ---------------------------------------------------------------- circuits

const CIRCUIT: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'circuit',
    name: 'Circuit',
    kind: 'choice',
    initial: 'rc-charge',
    about: 'Which circuit to solve. Each one is solved rather than drawn from a formula.',
    options: [
      { id: 'rc-charge', label: 'a capacitor charging' },
      { id: 'rc-discharge', label: 'a capacitor discharging' },
      { id: 'rl-energise', label: 'current building up in an inductor' },
      { id: 'rl-decay', label: 'current dying away in an inductor' },
      { id: 'rlc-step', label: 'an RLC circuit given a step' },
      { id: 'rlc-resonance', label: 'an RLC circuit across frequency' },
      { id: 'network', label: 'resistors in series or parallel' }
    ],
    group: 'What to solve'
  },
  {
    id: 'resistance',
    name: 'Resistance',
    kind: 'number',
    initial: 1000,
    unit: 'ohm',
    about: 'The resistor. In an RLC circuit this is what decides whether it rings.',
    least: 0.001,
    most: 1e9,
    group: 'Components'
  },
  {
    id: 'capacitance',
    name: 'Capacitance',
    kind: 'number',
    initial: 0.000001,
    unit: 'farad',
    about: 'The capacitor. Larger means a longer time constant.',
    least: 1e-15,
    most: 1,
    // Only means something where there is a capacitor.
    shownWhen: [
      { id: 'circuit', is: 'rc-charge' },
      { id: 'circuit', is: 'rc-discharge' },
      { id: 'circuit', is: 'rlc-step' },
      { id: 'circuit', is: 'rlc-resonance' }
    ],
    group: 'Components'
  },
  {
    id: 'inductance',
    name: 'Inductance',
    kind: 'number',
    initial: 0.1,
    unit: 'henry',
    about: 'The inductor.',
    least: 1e-12,
    most: 1000,
    shownWhen: [
      { id: 'circuit', is: 'rl-energise' },
      { id: 'circuit', is: 'rl-decay' },
      { id: 'circuit', is: 'rlc-step' },
      { id: 'circuit', is: 'rlc-resonance' }
    ],
    group: 'Components'
  },
  {
    id: 'supplyVoltage',
    name: 'Supply',
    kind: 'number',
    initial: 5,
    unit: 'volt',
    about: 'What is driving the circuit.',
    least: -1000,
    most: 1000,
    group: 'Components'
  },
  {
    id: 'arrangement',
    name: 'Arrangement',
    kind: 'choice',
    initial: 'series',
    about: 'Whether the components are in line or side by side.',
    options: [
      { id: 'series', label: 'in series' },
      { id: 'parallel', label: 'in parallel' }
    ],
    shownWhen: [
      { id: 'circuit', is: 'rlc-step' },
      { id: 'circuit', is: 'rlc-resonance' },
      { id: 'circuit', is: 'network' }
    ],
    group: 'Components'
  },
  {
    id: 'resistors',
    name: 'Resistors',
    kind: 'text',
    initial: '100, 220, 330',
    about: 'The resistors to combine, in ohms, separated by commas.',
    shownWhen: [{ id: 'circuit', is: 'network' }],
    group: 'Components'
  }
]

// ---------------------------------------------------------------- control

const CONTROL: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'numerator',
    name: 'Plant, top',
    kind: 'text',
    initial: '1',
    about: 'The numerator of the thing being controlled, highest power of s first.',
    group: 'The plant'
  },
  {
    id: 'denominator',
    name: 'Plant, bottom',
    kind: 'text',
    initial: '1 3 1',
    about: 'The denominator. So 1 3 1 is s² + 3s + 1 — a sluggish second-order thing, which most physical plants are.',
    group: 'The plant'
  },
  { id: 'proportional', name: 'Kp', kind: 'number', initial: 2, about: 'How hard it pushes on the error now.', least: 0, most: 1000, group: 'Gains' },
  {
    id: 'integral',
    name: 'Ki',
    kind: 'number',
    initial: 1,
    about: 'How hard it pushes on error that has built up. This is what removes a steady offset, and what winds up.',
    least: 0,
    most: 1000,
    group: 'Gains'
  },
  {
    id: 'derivative',
    name: 'Kd',
    kind: 'number',
    initial: 0.2,
    about: 'How hard it pushes against the error changing. This is what damps the overshoot.',
    least: 0,
    most: 1000,
    group: 'Gains'
  },
  { id: 'setpoint', name: 'Asked for', kind: 'number', initial: 1, about: 'The value the loop is told to reach.', least: -1000, most: 1000, group: 'The run' },
  { id: 'duration', name: 'For how long', kind: 'number', initial: 20, unit: 'second', about: 'How long to simulate.', least: 0.1, most: 600, group: 'The run' },
  {
    id: 'timeStep',
    name: 'Timestep',
    kind: 'number',
    initial: 0.01,
    unit: 'second',
    about: 'A step too large makes the simulation itself unstable, which looks exactly like an unstable loop. The engine says when it has happened.',
    least: 0.00001,
    most: 1,
    group: 'The run'
  },
  {
    id: 'outputMinimum',
    name: 'Actuator can give at least',
    kind: 'number',
    initial: -10,
    about: 'The least the controller can actually ask for. A real one has limits, and this is what causes wind-up.',
    least: -10000,
    most: 0,
    group: 'Limits'
  },
  {
    id: 'outputMaximum',
    name: 'Actuator can give at most',
    kind: 'number',
    initial: 10,
    about: 'The most it can ask for.',
    least: 0,
    most: 10000,
    group: 'Limits'
  },
  {
    id: 'antiWindup',
    name: 'Stop the integral winding up',
    kind: 'boolean',
    initial: true,
    about: 'Turn this off and watch what happens when the actuator is at its limit and the integral keeps building anyway.',
    group: 'Limits'
  },
  {
    id: 'rule',
    name: 'Show what a tuning rule would set',
    kind: 'choice',
    initial: 'none',
    about: 'The rule is not applied — its gains are shown beside yours so you can see what it changes.',
    options: [{ id: 'none', label: 'do not' }, ...TUNING_RULES.map((one) => ({ id: one, label: one.replace(/-/g, ' ') }))],
    group: 'Tuning'
  }
]

// ---------------------------------------------------------------- robotics

const ROBOT: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'lengths',
    name: 'Link lengths',
    kind: 'text',
    initial: '0.4 0.35 0.2',
    about: 'How long each part of the arm is, in metres, from the base outwards. Two to six of them.',
    group: 'The arm'
  },
  {
    id: 'angles',
    name: 'Joint angles',
    kind: 'text',
    initial: '30 40 -20',
    about: 'Where each joint is now, in degrees. One per link.',
    group: 'The arm'
  },
  {
    id: 'limit',
    name: 'Each joint turns at most',
    kind: 'number',
    initial: 170,
    unit: 'degree',
    about: 'How far a joint can turn either way. A real arm cannot go all the way round.',
    least: 10,
    most: 180,
    group: 'The arm'
  },
  {
    id: 'reachFor',
    name: 'Reach for a point',
    kind: 'boolean',
    initial: true,
    about: 'Work out the joint angles that would put the gripper on a target.',
    group: 'Target'
  },
  { id: 'targetX', name: 'Target x', kind: 'number', initial: 0.5, unit: 'metre', about: 'Where to reach, across.', least: -5, most: 5, shownWhen: [{ id: 'reachFor', is: true }], group: 'Target' },
  { id: 'targetY', name: 'Target y', kind: 'number', initial: 0.3, unit: 'metre', about: 'Where to reach, up.', least: -5, most: 5, shownWhen: [{ id: 'reachFor', is: true }], group: 'Target' },
  { id: 'targetZ', name: 'Target z', kind: 'number', initial: 0, unit: 'metre', about: 'Out of the plane. Zero for a flat arm.', least: -5, most: 5, shownWhen: [{ id: 'reachFor', is: true }], group: 'Target' },
  {
    id: 'respectLimits',
    name: 'Keep inside the joint limits',
    kind: 'boolean',
    initial: true,
    about: 'Turn this off to see what the arm could reach if its joints could turn freely.',
    shownWhen: [{ id: 'reachFor', is: true }],
    group: 'Target'
  },
  {
    id: 'payload',
    name: 'Weight at the gripper',
    kind: 'number',
    initial: 0,
    unit: 'kilogram',
    about: 'What it is holding. Shows what each joint has to hold against gravity.',
    least: 0,
    most: 500,
    group: 'Load'
  },
  {
    id: 'profile',
    name: 'Move shaped like',
    kind: 'choice',
    initial: 'trapezoidal',
    about: 'How the speed is shaped over a move. All three start and stop at rest; they differ in how smoothly.',
    options: TRAJECTORY_PROFILES.map((one) => ({ id: one, label: one })),
    group: 'A move'
  },
  { id: 'moveJoint', name: 'Move which joint', kind: 'integer', initial: 1, about: 'Counting from the base.', least: 1, most: 6, group: 'A move' },
  { id: 'moveTo', name: 'Move it to', kind: 'number', initial: 90, unit: 'degree', about: 'The angle to end at.', least: -180, most: 180, group: 'A move' },
  { id: 'moveOver', name: 'Taking', kind: 'number', initial: 2, unit: 'second', about: 'How long the move should take. Zero plans no move.', least: 0, most: 120, group: 'A move' }
]

// ---------------------------------------------------------------- structures

const STRUCTURE: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'beam',
    name: 'Held how',
    kind: 'choice',
    initial: 'simply-supported',
    about: 'How the beam is supported. This changes the whole shape of the bending.',
    options: [
      { id: 'simply-supported', label: 'resting on a support at each end' },
      { id: 'cantilever', label: 'fixed at one end, free at the other' },
      { id: 'overhanging', label: 'supported inboard, hanging over at the end' }
    ],
    group: 'The beam'
  },
  { id: 'length', name: 'Length', kind: 'number', initial: 4, unit: 'metre', about: 'How long the beam is.', least: 0.1, most: 200, group: 'The beam' },
  {
    id: 'pointLoad',
    name: 'A load of',
    kind: 'number',
    initial: 5000,
    unit: 'newton',
    about: 'A single weight pressing down. Zero for none.',
    least: -1e7,
    most: 1e7,
    group: 'Loads'
  },
  { id: 'pointAt', name: 'Sitting at', kind: 'number', initial: 2, unit: 'metre', about: 'How far along the load sits.', least: 0, most: 200, group: 'Loads' },
  {
    id: 'spread',
    name: 'Spread load of',
    kind: 'number',
    initial: 0,
    unit: 'newton',
    about: 'A load spread evenly along the whole beam, in newtons per metre. Zero for none.',
    least: -1e6,
    most: 1e6,
    group: 'Loads'
  },
  {
    id: 'section',
    name: 'Shape of the section',
    kind: 'choice',
    initial: 'rectangle',
    about: 'What the beam looks like cut through. Depth matters far more than width.',
    options: SECTION_SHAPES.map((one) => ({ id: one, label: one.replace(/-/g, ' ') })),
    group: 'The section'
  },
  { id: 'width', name: 'Width', kind: 'number', initial: 0.1, unit: 'metre', about: 'Across.', least: 0.001, most: 10, group: 'The section' },
  { id: 'height', name: 'Depth', kind: 'number', initial: 0.2, unit: 'metre', about: 'Up and down. This is the one that matters.', least: 0.001, most: 10, group: 'The section' },
  {
    id: 'diameter',
    name: 'Diameter',
    kind: 'number',
    initial: 0.15,
    unit: 'metre',
    about: 'For a round section.',
    least: 0.001,
    most: 10,
    shownWhen: [
      { id: 'section', is: 'circle' },
      { id: 'section', is: 'hollow-circle' }
    ],
    group: 'The section'
  },
  {
    id: 'thickness',
    name: 'Wall thickness',
    kind: 'number',
    initial: 0.008,
    unit: 'metre',
    about: 'For a hollow or built-up section.',
    least: 0.0001,
    most: 1,
    group: 'The section'
  },
  {
    id: 'material',
    name: 'Made of',
    kind: 'choice',
    initial: 'steel-mild',
    about: 'The material decides the stiffness and where it stops springing back. Without one, the sag cannot be worked out.',
    options: MATERIALS.map((one) => ({ id: one.id, label: one.name })),
    group: 'The section'
  },
  { id: 'bays', name: 'Bays', kind: 'integer', initial: 4, about: 'How many sections the truss is divided into.', least: 2, most: 16, group: 'The truss' },
  { id: 'span', name: 'Span', kind: 'number', initial: 12, unit: 'metre', about: 'How far the truss crosses.', least: 1, most: 300, group: 'The truss' },
  { id: 'depth', name: 'Depth', kind: 'number', initial: 2, unit: 'metre', about: 'How deep the truss is. A deeper truss carries far more.', least: 0.1, most: 50, group: 'The truss' },
  {
    id: 'nodeLoad',
    name: 'Load at each joint',
    kind: 'number',
    initial: 20000,
    unit: 'newton',
    about: 'Hung off each joint along the bottom, which is where a deck would hand it over.',
    least: 0,
    most: 1e7,
    group: 'The truss'
  }
]

export const PHASE4_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[]])[] = [
      ['circuit-lab', CIRCUIT],
      ['control-lab', CONTROL],
      ['robot-lab', ROBOT],
      ['structure-load-lab', STRUCTURE]
    ]
    for (const [id, list] of sets) {
      const made = declareAll(list)
      if (Array.isArray(made)) {
        const first = made.find(isParameterProblem)
        throw new Error(`Parameters for "${id}" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
      }
      out[id] = made
    }
    return out
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE4_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'circuit-lab',
    name: 'Circuit Laboratory',
    summary: 'Solve a circuit and watch what the voltage and current actually do over time.',
    domain: 'engineering',
    icon: 'zap',
    aliases: ['circuit', 'rc circuit', 'rl circuit', 'rlc circuit', 'capacitor', 'inductor', 'resonance', 'time constant'],
    tags: [
      'circuit',
      'electronics',
      'resistor',
      'capacitor',
      'inductor',
      'rc',
      'rl',
      'rlc',
      'time constant',
      'transient',
      'charging',
      'discharging',
      'resonance',
      'damping',
      'quality factor',
      'impedance',
      'ohm',
      'voltage',
      'current',
      'series',
      'parallel'
    ],
    capabilities: [
      { id: 'solveCircuit', summary: 'solve a circuit and show the voltage and current over time' },
      { id: 'exploreResonance', summary: 'sweep a circuit across frequency and show where it resonates' },
      { id: 'combineResistors', summary: 'work out what resistors come to in series or parallel, and what each one drops' }
    ],
    surface: { kind: 'native', ref: 'CircuitLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE4_PARAMETERS['circuit-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['series', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'circuits',
    limitations: [
      'Ideal components: no wire resistance, no leakage, and no parasitic capacitance or inductance. A real circuit at high frequency behaves differently because of exactly those.',
      'The arrangements it ships with — first-order RC and RL, series and parallel RLC, and resistor networks. You cannot draw an arbitrary circuit here.',
      'No semiconductors. There is no diode, transistor or operational amplifier, because Orbis has no model for one.',
      'Small-signal and linear throughout. Nothing saturates and nothing breaks down.'
    ]
  }),
  app({
    id: 'control-lab',
    name: 'Control Laboratory',
    summary: 'Tune a PID controller against a real plant and see what each gain actually does.',
    domain: 'engineering',
    icon: 'sliders-horizontal',
    aliases: ['pid', 'pid controller', 'control system', 'control loop', 'feedback', 'bode plot', 'step response', 'tuning'],
    tags: [
      'control',
      'pid',
      'feedback',
      'loop',
      'gain',
      'proportional',
      'integral',
      'derivative',
      'overshoot',
      'settling time',
      'steady state error',
      'stability',
      'bode',
      'phase margin',
      'gain margin',
      'transfer function',
      'pole',
      'zero',
      'routh',
      'step response',
      'tuning',
      'windup',
      'saturation'
    ],
    capabilities: [
      { id: 'simulateControlLoop', summary: 'simulate a PID loop against a plant and show how it responds' },
      { id: 'tuneController', summary: 'show what a standard tuning rule would set the gains to, and why' },
      { id: 'analyseStability', summary: 'show whether a loop is stable, how close to unstable it is, and where its poles are' }
    ],
    surface: { kind: 'native', ref: 'ControlLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE4_PARAMETERS['control-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['series', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'controls',
    limitations: [
      'The plant is a linear transfer function. A real actuator has friction, backlash and a response that changes with where it is, none of which is modelled.',
      'One loop, one controller. No cascaded loops, no feedforward, no gain scheduling.',
      'A tuning rule is shown and never applied, because the point is to see what it would change.',
      'The simulation is in continuous time with a fixed step. A digital controller running at a slow sample rate behaves worse than this suggests.'
    ]
  }),
  app({
    id: 'robot-lab',
    name: 'Robot Arm Laboratory',
    summary: 'Build an arm, move its joints, and have it work out how to reach a point.',
    domain: 'engineering',
    icon: 'bot',
    aliases: ['robot', 'robot arm', 'robotics', 'kinematics', 'inverse kinematics', 'manipulator', 'joint', 'gripper'],
    tags: [
      'robot',
      'robotics',
      'arm',
      'manipulator',
      'kinematics',
      'forward kinematics',
      'inverse kinematics',
      'joint',
      'link',
      'gripper',
      'end effector',
      'workspace',
      'reach',
      'singularity',
      'jacobian',
      'trajectory',
      'torque',
      'payload'
    ],
    capabilities: [
      { id: 'buildRobotArm', summary: 'build an arm from links and joints and show where its gripper ends up' },
      { id: 'reachForPoint', summary: 'work out the joint angles that put the gripper on a target, or show why it cannot' },
      { id: 'planJointMove', summary: 'plan a joint move with a speed profile that starts and stops smoothly' }
    ],
    surface: { kind: 'native', ref: 'RobotLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE4_PARAMETERS['robot-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['series', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'robotics',
    limitations: [
      'Links with no weight of their own, so the holding torques shown are from the payload only.',
      'No collision checking at all. The arm will be drawn passing through itself if the angles say so.',
      'Reaching is done by stepping towards the target, so there is always a small error left and sometimes no solution found even where one exists.',
      'Position only, not orientation: it aims the gripper at a point and does not control which way it faces.',
      'This panel builds a flat arm whose joints all turn in one plane. The engine handles any arm, but the laboratory does not let you describe one.'
    ]
  }),
  app({
    id: 'structure-load-lab',
    name: 'Structures Laboratory',
    summary: 'Load a beam or a truss and see where it bends, what it carries and whether it holds.',
    domain: 'engineering',
    icon: 'frame',
    aliases: ['beam', 'truss', 'structural', 'bending', 'deflection', 'stress', 'shear', 'bending moment', 'buckling'],
    tags: [
      'beam',
      'truss',
      'structure',
      'structural',
      'bending',
      'bending moment',
      'shear',
      'deflection',
      'sag',
      'stress',
      'strain',
      'cantilever',
      'simply supported',
      'support',
      'reaction',
      'load',
      'section',
      'second moment',
      'buckling',
      'tension',
      'compression',
      'material',
      'yield'
    ],
    capabilities: [
      { id: 'analyseBeam', summary: 'load a beam and show its shear, bending and sag along its length' },
      { id: 'analyseTruss', summary: 'load a truss and show which members are pulled, which are squashed and by how much' },
      { id: 'checkStrength', summary: 'compare the worst stress against where the material stops springing back' }
    ],
    surface: { kind: 'native', ref: 'StructureLoadLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE4_PARAMETERS['structure-load-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['series', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'structures-load',
    limitations: [
      'Small deflections and a material that springs back. Past the yield point the numbers stop being right, and the panel says when that has happened.',
      'The beam has no weight of its own unless you add it as a spread load.',
      'Trusses are solved joint by joint, which only works when the arrangement is exactly stiff enough. One with spare members is reported as unsolvable by this method rather than guessed at.',
      'The truss is the standard arrangement this panel builds, of a chosen number of bays. You cannot describe an arbitrary one.',
      'No finite-element analysis, no plates, no shells, no three-dimensional frames, and no dynamics — everything here is a static load.'
    ]
  })
])

export const PHASE4_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE4_CATALOGUE.map((one) => [one.id, one]))
)
