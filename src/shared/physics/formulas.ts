import { fail, type SimulationError } from './simulation.ts'

/**
 * The Formula Vault: physics formulas that can be rearranged and worked out, not just looked at.
 *
 * ## A formula you cannot solve is a picture of a formula
 *
 * Every entry here carries the algebra for each quantity it can be rearranged for, so you can give any set of
 * values but one and get the missing one back — with its unit, and with the rearrangement shown so the answer is
 * checkable rather than taken on trust.
 *
 * ## It refuses more often than it answers, on purpose
 *
 * A formula is rearranged only where the rearrangement is actually written down. Where it is not — because the
 * algebra has no closed form, or because two answers are equally right — asking for that quantity gets a refusal
 * naming which ones *are* available. The alternative is a number that looks like physics and is not.
 *
 * Every formula also states the conditions under which it holds. Those are not decoration: `v = u + at` is simply
 * false under non-constant acceleration, and a vault that let you use it anyway would be teaching the wrong thing.
 *
 * Pure. No state, no clock, no randomness.
 */

export interface Quantity {
  /** The symbol as it is written in the formula. */
  symbol: string
  name: string
  /** SI unit, written the way a physicist writes it. Empty for a pure number. */
  unit: string
  /** Set when a value outside this makes no physical sense. */
  least?: number
  most?: number
}

export interface Formula {
  id: string
  name: string
  section: string
  /** The formula as written, in plain characters a terminal can show. */
  written: string
  /** Each symbol in it. */
  quantities: readonly Quantity[]
  /** What it is, and when you reach for it. */
  about: string
  /** The conditions it holds under. Using it outside them gives a wrong answer, not an approximate one. */
  holds: readonly string[]
  /**
   * The rearrangements. A symbol present here can be solved for; one absent cannot, and asking says so.
   * Each takes the other values by symbol and returns the one asked for.
   */
  solve: Readonly<Partial<Record<string, (values: Readonly<Record<string, number>>) => number>>>
  /** Other formulas worth seeing beside it. */
  near?: readonly string[]
}

export interface Section {
  id: string
  name: string
  about: string
}

export const FORMULA_SECTIONS: readonly Section[] = Object.freeze([
  { id: 'kinematics', name: 'Motion', about: 'Where something is, how fast, and how that changes.' },
  { id: 'dynamics', name: 'Forces and Energy', about: 'What makes things move, and what it costs.' },
  { id: 'rotation', name: 'Rotation', about: 'The same laws again, written for things that spin.' },
  { id: 'gravity', name: 'Gravity and Orbits', about: 'The force that holds everything large together.' },
  { id: 'oscillation', name: 'Oscillations and Waves', about: 'Anything that goes back and forth, and what it carries.' },
  { id: 'fluids', name: 'Fluids', about: 'Pressure, buoyancy and flow.' },
  { id: 'thermo', name: 'Heat and Thermodynamics', about: 'Energy spread among many particles.' },
  { id: 'electric', name: 'Electricity', about: 'Charges, fields, and circuits.' },
  { id: 'magnetic', name: 'Magnetism', about: 'What moving charge does, and what a changing field does back.' },
  { id: 'optics', name: 'Light and Optics', about: 'Reflection, refraction, lenses and interference.' },
  { id: 'quantum', name: 'Quantum', about: 'Where energy comes in lumps.' },
  { id: 'relativity', name: 'Relativity', about: 'What changes when you go fast, or sit near a large mass.' },
  { id: 'nuclear', name: 'Nuclear', about: 'Binding, decay and what comes out.' },
  { id: 'astro', name: 'Astrophysics', about: 'Stars, distances and the expanding universe.' }
])

const q = (symbol: string, name: string, unit: string, least?: number, most?: number): Quantity => ({ symbol, name, unit, least, most })

/**
 * Inverse trig and square roots that refuse instead of clamping.
 *
 * Clamping `asin` to 1 is the single easiest way for a formula vault to lie: it turns "these values describe
 * something that cannot happen" into a confident 90.000°. These return NaN, which `solve` reports as a refusal.
 */
const asinOf = (value: number): number => (value < -1 || value > 1 ? Number.NaN : Math.asin(value))
const acosOf = (value: number): number => (value < -1 || value > 1 ? Number.NaN : Math.acos(value))
const rootOf = (value: number): number => (value < 0 ? Number.NaN : Math.sqrt(value))
const degrees = (radians: number): number => (radians * 180) / Math.PI
const radians = (deg: number): number => (deg * Math.PI) / 180

const C_LIGHT = 299_792_458
const G_GRAV = 6.6743e-11
const HBAR = 1.054571817e-34
const H_PLANCK = 6.62607015e-34
const K_B = 1.380649e-23
const E_CHARGE = 1.602176634e-19
const EPS0 = 8.8541878128e-12
const MU0 = 1.25663706212e-6
const K_COULOMB = 1 / (4 * Math.PI * EPS0)
const STEFAN = 5.670374419e-8
const R_GAS = 8.31446261815324
const N_A = 6.02214076e23

export const FORMULAS: readonly Formula[] = Object.freeze([
  // ——— Motion ———————————————————————————————————————————————————————————————
  {
    id: 'velocity-average',
    name: 'Average velocity',
    section: 'kinematics',
    written: 'v = Δx / Δt',
    quantities: [q('v', 'Average velocity', 'm/s'), q('x', 'Displacement', 'm'), q('t', 'Time taken', 's', 0)],
    about: 'How far it got, divided by how long it took. Says nothing about what happened in between.',
    holds: ['Nothing — this is the definition of average velocity, so it is always true.', 'It is not the instantaneous velocity, and the two differ whenever the motion is not uniform.'],
    solve: { v: (o) => o.x / o.t, x: (o) => o.v * o.t, t: (o) => o.x / o.v },
    near: ['acceleration-average', 'velocity-final']
  },
  {
    id: 'acceleration-average',
    name: 'Average acceleration',
    section: 'kinematics',
    written: 'a = Δv / Δt',
    quantities: [q('a', 'Acceleration', 'm/s²'), q('v', 'Change in velocity', 'm/s'), q('t', 'Time taken', 's', 0)],
    about: 'How much the velocity changed, divided by how long that took.',
    holds: ['Always true as a definition of the average.'],
    solve: { a: (o) => o.v / o.t, v: (o) => o.a * o.t, t: (o) => o.v / o.a },
    near: ['velocity-average', 'velocity-final', 'newton-second']
  },
  {
    id: 'velocity-final',
    name: 'Velocity after a time',
    section: 'kinematics',
    written: 'v = u + a·t',
    quantities: [q('v', 'Final velocity', 'm/s'), q('u', 'Starting velocity', 'm/s'), q('a', 'Acceleration', 'm/s²'), q('t', 'Time', 's', 0)],
    about: 'The first of the four equations of motion. Velocity grows steadily when acceleration is steady.',
    holds: ['Acceleration must be constant. Under changing acceleration this is simply wrong, not approximate.', 'Straight-line motion, or one component of it at a time.'],
    solve: { v: (o) => o.u + o.a * o.t, u: (o) => o.v - o.a * o.t, a: (o) => (o.v - o.u) / o.t, t: (o) => (o.v - o.u) / o.a },
    near: ['displacement-time', 'velocity-squared', 'acceleration-average']
  },
  {
    id: 'displacement-time',
    name: 'Displacement after a time',
    section: 'kinematics',
    written: 's = u·t + ½·a·t²',
    quantities: [q('s', 'Displacement', 'm'), q('u', 'Starting velocity', 'm/s'), q('a', 'Acceleration', 'm/s²'), q('t', 'Time', 's', 0)],
    about: 'How far it travels: the distance at the starting speed, plus the extra the acceleration adds.',
    holds: ['Constant acceleration.', 'Solving for t has two roots; the vault returns the first non-negative one and says so.'],
    solve: {
      s: (o) => o.u * o.t + 0.5 * o.a * o.t * o.t,
      u: (o) => (o.s - 0.5 * o.a * o.t * o.t) / o.t,
      a: (o) => (2 * (o.s - o.u * o.t)) / (o.t * o.t),
      // Quadratic in t. Two times can give the same displacement — a ball thrown up passes a height twice.
      t: (o) => {
        if (o.a === 0) return o.s / o.u
        const under = o.u * o.u + 2 * o.a * o.s
        if (under < 0) return Number.NaN
        const root = Math.sqrt(under)
        const first = (-o.u + root) / o.a
        const second = (-o.u - root) / o.a
        // The useful root is the first time it gets there *after* setting off. t = 0 is a root whenever the
        // displacement asked for is zero, and answering "immediately" to "when does it land?" is useless.
        const after = [first, second].filter((one) => one > 1e-12).sort((a, b) => a - b)
        if (after.length > 0) return after[0]
        const atAll = [first, second].filter((one) => one >= 0).sort((a, b) => a - b)
        return atAll.length > 0 ? atAll[0] : Number.NaN
      }
    },
    near: ['velocity-final', 'velocity-squared', 'projectile-flight']
  },
  {
    id: 'velocity-squared',
    name: 'Velocity without time',
    section: 'kinematics',
    written: 'v² = u² + 2·a·s',
    quantities: [q('v', 'Final velocity', 'm/s'), q('u', 'Starting velocity', 'm/s'), q('a', 'Acceleration', 'm/s²'), q('s', 'Displacement', 'm')],
    about: 'The equation of motion with the time taken out of it. Reach for it when you know the distance but not the duration.',
    holds: ['Constant acceleration.', 'Solving for v gives a magnitude; the sign is yours to decide from the direction of travel.'],
    solve: {
      v: (o) => rootOf(o.u * o.u + 2 * o.a * o.s),
      u: (o) => rootOf(o.v * o.v - 2 * o.a * o.s),
      a: (o) => (o.v * o.v - o.u * o.u) / (2 * o.s),
      s: (o) => (o.v * o.v - o.u * o.u) / (2 * o.a)
    },
    near: ['velocity-final', 'displacement-time', 'kinetic-energy']
  },
  {
    id: 'projectile-range',
    name: 'Range of a projectile',
    section: 'kinematics',
    written: 'R = u²·sin(2θ) / g',
    quantities: [q('R', 'Range', 'm'), q('u', 'Launch speed', 'm/s', 0), q('theta', 'Launch angle', '°', 0, 90), q('g', 'Gravity', 'm/s²', 0)],
    about: 'How far a thrown object lands away, for level ground. Longest at 45°, and equal for any two angles adding to 90°.',
    holds: ['No air resistance. For a real ball this is the single largest error in the whole calculation.', 'Launch and landing at the same height.', 'Uniform gravity, so not for ranges where the Earth curves away.'],
    solve: {
      R: (o) => (o.u * o.u * Math.sin((2 * o.theta * Math.PI) / 180)) / o.g,
      u: (o) => Math.sqrt((o.R * o.g) / Math.sin((2 * o.theta * Math.PI) / 180)),
      g: (o) => (o.u * o.u * Math.sin((2 * o.theta * Math.PI) / 180)) / o.R,
      theta: (o) => degrees(asinOf((o.R * o.g) / (o.u * o.u)) / 2)
    },
    near: ['projectile-height', 'projectile-flight', 'displacement-time']
  },
  {
    id: 'projectile-height',
    name: 'Peak height of a projectile',
    section: 'kinematics',
    written: 'H = u²·sin²(θ) / (2·g)',
    quantities: [q('H', 'Peak height', 'm'), q('u', 'Launch speed', 'm/s', 0), q('theta', 'Launch angle', '°', 0, 90), q('g', 'Gravity', 'm/s²', 0)],
    about: 'The highest point reached — set by the upward part of the launch speed alone.',
    holds: ['No air resistance.', 'Uniform gravity.'],
    solve: {
      H: (o) => (o.u * o.u * Math.sin((o.theta * Math.PI) / 180) ** 2) / (2 * o.g),
      u: (o) => Math.sqrt((2 * o.g * o.H) / Math.sin((o.theta * Math.PI) / 180) ** 2),
      g: (o) => (o.u * o.u * Math.sin((o.theta * Math.PI) / 180) ** 2) / (2 * o.H),
      theta: (o) => degrees(asinOf(rootOf((2 * o.g * o.H) / (o.u * o.u))))
    },
    near: ['projectile-range', 'projectile-flight', 'displacement-time']
  },
  {
    id: 'projectile-flight',
    name: 'Time in the air',
    section: 'kinematics',
    written: 'T = 2·u·sin(θ) / g',
    quantities: [q('T', 'Time of flight', 's'), q('u', 'Launch speed', 'm/s', 0), q('theta', 'Launch angle', '°', 0, 90), q('g', 'Gravity', 'm/s²', 0)],
    about: 'How long it stays up. Depends only on the upward speed, which is why a flat throw lands quickly however hard you throw it.',
    holds: ['No air resistance.', 'Level ground.'],
    solve: {
      T: (o) => (2 * o.u * Math.sin((o.theta * Math.PI) / 180)) / o.g,
      u: (o) => (o.T * o.g) / (2 * Math.sin((o.theta * Math.PI) / 180)),
      g: (o) => (2 * o.u * Math.sin((o.theta * Math.PI) / 180)) / o.T,
      theta: (o) => degrees(asinOf((o.T * o.g) / (2 * o.u)))
    },
    near: ['projectile-range', 'projectile-height', 'velocity-final']
  },

  // ——— Forces and Energy ————————————————————————————————————————————————————
  {
    id: 'newton-second',
    name: "Newton's second law",
    section: 'dynamics',
    written: 'F = m·a',
    quantities: [q('F', 'Force', 'N'), q('m', 'Mass', 'kg', 0), q('a', 'Acceleration', 'm/s²')],
    about: 'The law the whole of mechanics is built on: force is what changes motion, and mass is how much it resists.',
    holds: ['Mass must be constant. For a rocket burning fuel use F = dp/dt instead.', 'Speeds well below light speed; past that the momentum form is the right one.', 'An inertial frame — in a rotating or accelerating frame there are extra terms.'],
    solve: { F: (o) => o.m * o.a, m: (o) => o.F / o.a, a: (o) => o.F / o.m },
    near: ['momentum', 'impulse', 'weight', 'rotational-newton']
  },
  {
    id: 'weight',
    name: 'Weight',
    section: 'dynamics',
    written: 'W = m·g',
    quantities: [q('W', 'Weight', 'N'), q('m', 'Mass', 'kg', 0), q('g', 'Gravity', 'm/s²', 0)],
    about: 'The force gravity pulls with. Weight is a force and changes with where you are; mass does not.',
    holds: ['Near a surface, where g can be taken as uniform.'],
    solve: { W: (o) => o.m * o.g, m: (o) => o.W / o.g, g: (o) => o.W / o.m },
    near: ['newton-second', 'potential-energy-gravity']
  },
  {
    id: 'momentum',
    name: 'Momentum',
    section: 'dynamics',
    written: 'p = m·v',
    quantities: [q('p', 'Momentum', 'kg·m/s'), q('m', 'Mass', 'kg', 0), q('v', 'Velocity', 'm/s')],
    about: 'How much motion something has. Conserved in every collision, which is what makes it so useful.',
    holds: ['Speeds well below light speed. Relativistically p = γmv, which is a different formula in this vault.'],
    solve: { p: (o) => o.m * o.v, m: (o) => o.p / o.v, v: (o) => o.p / o.m },
    near: ['impulse', 'kinetic-energy', 'momentum-relativistic']
  },
  {
    id: 'impulse',
    name: 'Impulse',
    section: 'dynamics',
    written: 'J = F·Δt = Δp',
    quantities: [q('J', 'Impulse', 'N·s'), q('F', 'Force', 'N'), q('t', 'Time it acts for', 's', 0)],
    about: 'Force multiplied by how long it acts. Equals the change in momentum, which is why a long crumple zone hurts less than a short one.',
    holds: ['Constant force. For a varying force the impulse is the integral, and the result here is the average force times the time.'],
    solve: { J: (o) => o.F * o.t, F: (o) => o.J / o.t, t: (o) => o.J / o.F },
    near: ['momentum', 'newton-second']
  },
  {
    id: 'kinetic-energy',
    name: 'Kinetic energy',
    section: 'dynamics',
    written: 'KE = ½·m·v²',
    quantities: [q('KE', 'Kinetic energy', 'J', 0), q('m', 'Mass', 'kg', 0), q('v', 'Speed', 'm/s')],
    about: 'The energy of motion. Note the square: twice the speed is four times the energy, which is the whole story of road safety.',
    holds: ['Speeds well below light speed.', 'Translation only — a spinning object has rotational kinetic energy on top of this.'],
    solve: { KE: (o) => 0.5 * o.m * o.v * o.v, m: (o) => (2 * o.KE) / (o.v * o.v), v: (o) => Math.sqrt((2 * o.KE) / o.m) },
    near: ['potential-energy-gravity', 'work', 'rotational-energy']
  },
  {
    id: 'potential-energy-gravity',
    name: 'Gravitational potential energy',
    section: 'dynamics',
    written: 'PE = m·g·h',
    quantities: [q('PE', 'Potential energy', 'J'), q('m', 'Mass', 'kg', 0), q('g', 'Gravity', 'm/s²', 0), q('h', 'Height', 'm')],
    about: 'The energy stored by lifting something. Measured from wherever you choose to call zero.',
    holds: ['Uniform gravity, so heights small compared to the planet. For a satellite use −GMm/r.'],
    solve: { PE: (o) => o.m * o.g * o.h, m: (o) => o.PE / (o.g * o.h), g: (o) => o.PE / (o.m * o.h), h: (o) => o.PE / (o.m * o.g) },
    near: ['kinetic-energy', 'work', 'weight']
  },
  {
    id: 'work',
    name: 'Work done',
    section: 'dynamics',
    written: 'W = F·d·cos(θ)',
    quantities: [q('W', 'Work', 'J'), q('F', 'Force', 'N'), q('d', 'Distance', 'm'), q('theta', 'Angle between them', '°', 0, 180)],
    about: 'Energy transferred by a force. A force at right angles to the motion does no work at all, however large it is.',
    holds: ['Constant force along a straight path. Otherwise work is the line integral.'],
    solve: {
      W: (o) => o.F * o.d * Math.cos((o.theta * Math.PI) / 180),
      F: (o) => o.W / (o.d * Math.cos((o.theta * Math.PI) / 180)),
      d: (o) => o.W / (o.F * Math.cos((o.theta * Math.PI) / 180)),
      theta: (o) => degrees(acosOf(o.W / (o.F * o.d)))
    },
    near: ['kinetic-energy', 'power', 'potential-energy-gravity']
  },
  {
    id: 'power',
    name: 'Power',
    section: 'dynamics',
    written: 'P = W / t',
    quantities: [q('P', 'Power', 'W'), q('W', 'Work or energy', 'J'), q('t', 'Time', 's', 0)],
    about: 'How fast energy is transferred. The same job done in half the time needs twice the power.',
    holds: ['This is the average. Instantaneous power is dW/dt, or F·v.'],
    solve: { P: (o) => o.W / o.t, W: (o) => o.P * o.t, t: (o) => o.W / o.P },
    near: ['work', 'electric-power', 'kinetic-energy']
  },
  {
    id: 'spring-force',
    name: "Hooke's law",
    section: 'dynamics',
    written: 'F = −k·x',
    quantities: [q('F', 'Restoring force', 'N'), q('k', 'Spring constant', 'N/m', 0), q('x', 'Extension', 'm')],
    about: 'A spring pulls back in proportion to how far you stretch it. The minus sign is the "back".',
    holds: ['Only up to the elastic limit. Past it the spring deforms and this is badly wrong.', 'The force is reported as a magnitude here; its direction always opposes the stretch.'],
    solve: { F: (o) => -o.k * o.x, k: (o) => -o.F / o.x, x: (o) => -o.F / o.k },
    near: ['spring-energy', 'shm-period-spring']
  },
  {
    id: 'spring-energy',
    name: 'Energy in a spring',
    section: 'dynamics',
    written: 'E = ½·k·x²',
    quantities: [q('E', 'Stored energy', 'J', 0), q('k', 'Spring constant', 'N/m', 0), q('x', 'Extension', 'm')],
    about: 'The work it took to stretch it, stored and ready to come back.',
    holds: ['Within the elastic limit, and for a spring that obeys Hooke.'],
    solve: { E: (o) => 0.5 * o.k * o.x * o.x, k: (o) => (2 * o.E) / (o.x * o.x), x: (o) => Math.sqrt((2 * o.E) / o.k) },
    near: ['spring-force', 'shm-period-spring']
  },
  {
    id: 'friction',
    name: 'Friction',
    section: 'dynamics',
    written: 'f = μ·N',
    quantities: [q('f', 'Friction force', 'N', 0), q('mu', 'Coefficient of friction', '', 0), q('N', 'Normal force', 'N', 0)],
    about: 'Friction scales with how hard the surfaces are pressed together — and not at all with the contact area, which surprises most people.',
    holds: ['An approximation, and a rough one. Real friction depends on speed, temperature and surface history.', 'Static and kinetic friction have different coefficients; use the right one.'],
    solve: { f: (o) => o.mu * o.N, mu: (o) => o.f / o.N, N: (o) => o.f / o.mu },
    near: ['newton-second', 'work']
  },
  {
    id: 'centripetal',
    name: 'Centripetal force',
    section: 'dynamics',
    written: 'F = m·v² / r',
    quantities: [q('F', 'Centripetal force', 'N'), q('m', 'Mass', 'kg', 0), q('v', 'Speed', 'm/s'), q('r', 'Radius', 'm', 0)],
    about: 'The inward force needed to keep something going in a circle. Not a new kind of force — something real has to supply it.',
    holds: ['Uniform circular motion, at constant speed.', 'There is no outward "centrifugal force" in an inertial frame; that appears only in the rotating frame.'],
    solve: { F: (o) => (o.m * o.v * o.v) / o.r, m: (o) => (o.F * o.r) / (o.v * o.v), v: (o) => Math.sqrt((o.F * o.r) / o.m), r: (o) => (o.m * o.v * o.v) / o.F },
    near: ['angular-velocity', 'orbital-velocity', 'newton-second']
  },

  // ——— Rotation —————————————————————————————————————————————————————————————
  {
    id: 'angular-velocity',
    name: 'Angular velocity',
    section: 'rotation',
    written: 'ω = 2π / T = v / r',
    quantities: [q('omega', 'Angular velocity', 'rad/s'), q('T', 'Period', 's', 0)],
    about: 'How fast it turns, in radians a second. One full turn is 2π of them.',
    holds: ['Steady rotation.'],
    solve: { omega: (o) => (2 * Math.PI) / o.T, T: (o) => (2 * Math.PI) / o.omega },
    near: ['centripetal', 'frequency-period', 'angular-momentum']
  },
  {
    id: 'torque',
    name: 'Torque',
    section: 'rotation',
    written: 'τ = r·F·sin(θ)',
    quantities: [q('tau', 'Torque', 'N·m'), q('r', 'Distance from the pivot', 'm', 0), q('F', 'Force', 'N'), q('theta', 'Angle', '°', 0, 180)],
    about: 'The turning effect of a force. Push at the far end of the spanner, and push at right angles.',
    holds: ['Rigid body, fixed axis.'],
    solve: {
      tau: (o) => o.r * o.F * Math.sin((o.theta * Math.PI) / 180),
      r: (o) => o.tau / (o.F * Math.sin((o.theta * Math.PI) / 180)),
      F: (o) => o.tau / (o.r * Math.sin((o.theta * Math.PI) / 180)),
      theta: (o) => degrees(asinOf(o.tau / (o.r * o.F)))
    },
    near: ['rotational-newton', 'angular-momentum', 'rotational-energy']
  },
  {
    id: 'rotational-newton',
    name: "Newton's second law for rotation",
    section: 'rotation',
    written: 'τ = I·α',
    quantities: [q('tau', 'Torque', 'N·m'), q('I', 'Moment of inertia', 'kg·m²', 0), q('alpha', 'Angular acceleration', 'rad/s²')],
    about: 'The same law as F = ma, with torque for force, moment of inertia for mass, and angular acceleration for acceleration.',
    holds: ['Fixed axis, rigid body, constant moment of inertia.'],
    solve: { tau: (o) => o.I * o.alpha, I: (o) => o.tau / o.alpha, alpha: (o) => o.tau / o.I },
    near: ['torque', 'newton-second']
  },
  {
    id: 'angular-momentum',
    name: 'Angular momentum',
    section: 'rotation',
    written: 'L = I·ω',
    quantities: [q('L', 'Angular momentum', 'kg·m²/s'), q('I', 'Moment of inertia', 'kg·m²', 0), q('omega', 'Angular velocity', 'rad/s')],
    about: 'Conserved when nothing twists from outside — which is why a skater pulling their arms in spins faster.',
    holds: ['Fixed axis. In general L is a vector and I a tensor, and the two need not point the same way.'],
    solve: { L: (o) => o.I * o.omega, I: (o) => o.L / o.omega, omega: (o) => o.L / o.I },
    near: ['torque', 'rotational-energy', 'momentum']
  },
  {
    id: 'rotational-energy',
    name: 'Rotational kinetic energy',
    section: 'rotation',
    written: 'KE = ½·I·ω²',
    quantities: [q('KE', 'Rotational energy', 'J', 0), q('I', 'Moment of inertia', 'kg·m²', 0), q('omega', 'Angular velocity', 'rad/s')],
    about: 'The energy of spinning. A rolling ball has this as well as its straight-line kinetic energy, which is why it accelerates down a slope more slowly than a sliding one.',
    holds: ['Fixed axis.'],
    solve: { KE: (o) => 0.5 * o.I * o.omega * o.omega, I: (o) => (2 * o.KE) / (o.omega * o.omega), omega: (o) => Math.sqrt((2 * o.KE) / o.I) },
    near: ['angular-momentum', 'kinetic-energy', 'rotational-newton']
  },

  // ——— Gravity ——————————————————————————————————————————————————————————————
  {
    id: 'newton-gravity',
    name: "Newton's law of gravitation",
    section: 'gravity',
    written: 'F = G·m₁·m₂ / r²',
    quantities: [q('F', 'Force', 'N'), q('m1', 'First mass', 'kg', 0), q('m2', 'Second mass', 'kg', 0), q('r', 'Separation', 'm', 0)],
    about: 'Every mass pulls every other. The inverse square is why gravity reaches so far and yet is so weak nearby.',
    holds: ['Point masses, or spheres measured centre to centre.', 'Weak fields and slow speeds. Near a black hole or for light bending, general relativity is needed.'],
    solve: {
      F: (o) => (G_GRAV * o.m1 * o.m2) / (o.r * o.r),
      m1: (o) => (o.F * o.r * o.r) / (G_GRAV * o.m2),
      m2: (o) => (o.F * o.r * o.r) / (G_GRAV * o.m1),
      r: (o) => Math.sqrt((G_GRAV * o.m1 * o.m2) / o.F)
    },
    near: ['orbital-velocity', 'escape-velocity', 'kepler-third']
  },
  {
    id: 'orbital-velocity',
    name: 'Circular orbit speed',
    section: 'gravity',
    written: 'v = √(G·M / r)',
    quantities: [q('v', 'Orbital speed', 'm/s', 0), q('M', 'Central mass', 'kg', 0), q('r', 'Orbit radius', 'm', 0)],
    about: 'The one speed at which gravity exactly bends the path into a circle. Faster and the orbit stretches into an ellipse; faster still and it leaves.',
    holds: ['Circular orbit only.', 'The orbiting mass must be small compared to the central one.'],
    solve: { v: (o) => Math.sqrt((G_GRAV * o.M) / o.r), M: (o) => (o.v * o.v * o.r) / G_GRAV, r: (o) => (G_GRAV * o.M) / (o.v * o.v) },
    near: ['escape-velocity', 'kepler-third', 'centripetal', 'newton-gravity']
  },
  {
    id: 'escape-velocity',
    name: 'Escape velocity',
    section: 'gravity',
    written: 'v = √(2·G·M / r)',
    quantities: [q('v', 'Escape velocity', 'm/s', 0), q('M', 'Mass', 'kg', 0), q('r', 'Distance from the centre', 'm', 0)],
    about: 'The speed that just barely never comes back. Exactly √2 times the circular orbit speed at the same radius.',
    holds: ['No air resistance and no further thrust — a single push and then coasting.', 'Ignores every other body, so this is escape from one mass, not from a solar system.'],
    solve: { v: (o) => Math.sqrt((2 * G_GRAV * o.M) / o.r), M: (o) => (o.v * o.v * o.r) / (2 * G_GRAV), r: (o) => (2 * G_GRAV * o.M) / (o.v * o.v) },
    near: ['orbital-velocity', 'newton-gravity', 'schwarzschild', 'kepler-third']
  },
  {
    id: 'kepler-third',
    name: "Kepler's third law",
    section: 'gravity',
    written: 'T² = 4π²·a³ / (G·M)',
    quantities: [q('T', 'Orbital period', 's', 0), q('a', 'Semi-major axis', 'm', 0), q('M', 'Central mass', 'kg', 0)],
    about: 'The period squared goes as the radius cubed. Measure a moon and you have weighed the planet.',
    holds: ['The orbiting mass is negligible. Otherwise M becomes the total mass of both.'],
    solve: {
      T: (o) => Math.sqrt((4 * Math.PI * Math.PI * o.a ** 3) / (G_GRAV * o.M)),
      a: (o) => Math.cbrt((G_GRAV * o.M * o.T * o.T) / (4 * Math.PI * Math.PI)),
      M: (o) => (4 * Math.PI * Math.PI * o.a ** 3) / (G_GRAV * o.T * o.T)
    },
    near: ['orbital-velocity', 'newton-gravity', 'escape-velocity']
  },
  {
    id: 'schwarzschild',
    name: 'Schwarzschild radius',
    section: 'gravity',
    written: 'r = 2·G·M / c²',
    quantities: [q('r', 'Event horizon radius', 'm', 0), q('M', 'Mass', 'kg', 0)],
    about: 'Squeeze a mass inside this radius and not even light gets out. For the Sun it is about 3 km.',
    holds: ['A non-rotating, uncharged black hole. A spinning one has a different horizon.'],
    solve: { r: (o) => (2 * G_GRAV * o.M) / (C_LIGHT * C_LIGHT), M: (o) => (o.r * C_LIGHT * C_LIGHT) / (2 * G_GRAV) },
    near: ['newton-gravity', 'escape-velocity', 'mass-energy']
  },

  // ——— Oscillations and Waves ———————————————————————————————————————————————
  {
    id: 'shm-period-spring',
    name: 'Period of a spring',
    section: 'oscillation',
    written: 'T = 2π·√(m / k)',
    quantities: [q('T', 'Period', 's', 0), q('m', 'Mass', 'kg', 0), q('k', 'Spring constant', 'N/m', 0)],
    about: 'How long one bounce takes. Heavier is slower, stiffer is faster, and the amplitude makes no difference at all.',
    holds: ['Hooke\'s law obeyed, so small enough amplitudes.', 'A massless spring; a heavy one adds roughly a third of its own mass.'],
    solve: { T: (o) => 2 * Math.PI * Math.sqrt(o.m / o.k), m: (o) => (o.k * o.T * o.T) / (4 * Math.PI * Math.PI), k: (o) => (4 * Math.PI * Math.PI * o.m) / (o.T * o.T) },
    near: ['spring-force', 'shm-period-pendulum', 'frequency-period']
  },
  {
    id: 'shm-period-pendulum',
    name: 'Period of a pendulum',
    section: 'oscillation',
    written: 'T = 2π·√(L / g)',
    quantities: [q('T', 'Period', 's', 0), q('L', 'Length', 'm', 0), q('g', 'Gravity', 'm/s²', 0)],
    about: 'Depends on the length and on gravity, and not on the mass — which is what made pendulum clocks possible.',
    holds: ['Small swings only. At 30° this is already about 2% fast, and the error grows quickly.', 'A point mass on a massless string.'],
    solve: { T: (o) => 2 * Math.PI * Math.sqrt(o.L / o.g), L: (o) => (o.g * o.T * o.T) / (4 * Math.PI * Math.PI), g: (o) => (4 * Math.PI * Math.PI * o.L) / (o.T * o.T) },
    near: ['shm-period-spring', 'frequency-period']
  },
  {
    id: 'wave-speed',
    name: 'Wave speed',
    section: 'oscillation',
    written: 'v = f·λ',
    quantities: [q('v', 'Speed', 'm/s'), q('f', 'Frequency', 'Hz', 0), q('lambda', 'Wavelength', 'm', 0)],
    about: 'The most used formula in waves. The medium fixes the speed, so raising the frequency shortens the wavelength.',
    holds: ['A non-dispersive medium, where the speed does not depend on frequency. Water waves and light in glass both break this.'],
    solve: { v: (o) => o.f * o.lambda, f: (o) => o.v / o.lambda, lambda: (o) => o.v / o.f },
    near: ['frequency-period', 'doppler', 'standing-wave']
  },
  {
    id: 'frequency-period',
    name: 'Frequency and period',
    section: 'oscillation',
    written: 'f = 1 / T',
    quantities: [q('f', 'Frequency', 'Hz', 0), q('T', 'Period', 's', 0)],
    about: 'Two ways of saying the same thing: how often, and how long each one takes.',
    holds: ['Always true.'],
    solve: { f: (o) => 1 / o.T, T: (o) => 1 / o.f },
    near: ['angular-velocity', 'wave-speed', 'shm-period-spring']
  },
  {
    id: 'doppler',
    name: 'Doppler shift',
    section: 'oscillation',
    written: "f' = f·(v + v_o) / (v − v_s)",
    quantities: [q('fo', 'Heard frequency', 'Hz', 0), q('f', 'Source frequency', 'Hz', 0), q('v', 'Wave speed', 'm/s', 0), q('vo', 'Observer speed toward the source', 'm/s'), q('vs', 'Source speed toward the observer', 'm/s')],
    about: 'Why a siren drops as it passes. Motion toward raises the pitch; motion away lowers it.',
    holds: ['Sound, not light — this is the classical form, and it is wrong for light.', 'Motion along the line joining the two. Sideways motion gives no first-order shift.', 'Source speed below the wave speed. At or past it you get a shock wave, not a shift.'],
    solve: {
      fo: (o) => (o.f * (o.v + o.vo)) / (o.v - o.vs),
      f: (o) => (o.fo * (o.v - o.vs)) / (o.v + o.vo),
      vo: (o) => (o.fo * (o.v - o.vs)) / o.f - o.v,
      vs: (o) => o.v - (o.f * (o.v + o.vo)) / o.fo
    },
    near: ['wave-speed', 'relativistic-doppler', 'frequency-period']
  },
  {
    id: 'standing-wave',
    name: 'Standing wave on a string',
    section: 'oscillation',
    written: 'f = n·v / (2·L)',
    quantities: [q('f', 'Frequency', 'Hz', 0), q('n', 'Harmonic number', '', 1), q('v', 'Wave speed', 'm/s', 0), q('L', 'String length', 'm', 0)],
    about: 'Which notes a string can play. Only whole numbers of half-waves fit, and that is why instruments have notes rather than a smear.',
    holds: ['Both ends fixed. A pipe open at one end has odd harmonics only, which is a different formula.'],
    solve: { f: (o) => (o.n * o.v) / (2 * o.L), v: (o) => (2 * o.L * o.f) / o.n, L: (o) => (o.n * o.v) / (2 * o.f), n: (o) => (2 * o.L * o.f) / o.v },
    near: ['wave-speed', 'string-tension', 'frequency-period']
  },
  {
    id: 'string-tension',
    name: 'Wave speed on a string',
    section: 'oscillation',
    written: 'v = √(T / μ)',
    quantities: [q('v', 'Wave speed', 'm/s', 0), q('T', 'Tension', 'N', 0), q('mu', 'Mass per length', 'kg/m', 0)],
    about: 'Tighter is faster, heavier is slower. This is what tuning a guitar actually changes.',
    holds: ['An ideal flexible string with no stiffness of its own.'],
    solve: { v: (o) => Math.sqrt(o.T / o.mu), T: (o) => o.v * o.v * o.mu, mu: (o) => o.T / (o.v * o.v) },
    near: ['standing-wave', 'wave-speed']
  },
  {
    id: 'intensity-level',
    name: 'Sound intensity level',
    section: 'oscillation',
    written: 'L = 10·log₁₀(I / I₀)',
    quantities: [q('L', 'Level', 'dB'), q('I', 'Intensity', 'W/m²', 0)],
    about: 'Loudness in decibels, against the quietest audible sound. Ten times the intensity is only 10 dB, because hearing is logarithmic.',
    holds: ['Reference intensity 1×10⁻¹² W/m², the standard threshold of hearing.'],
    solve: { L: (o) => 10 * Math.log10(o.I / 1e-12), I: (o) => 1e-12 * 10 ** (o.L / 10) },
    near: ['wave-speed', 'luminosity-distance']
  },

  // ——— Fluids ———————————————————————————————————————————————————————————————
  {
    id: 'pressure',
    name: 'Pressure',
    section: 'fluids',
    written: 'P = F / A',
    quantities: [q('P', 'Pressure', 'Pa'), q('F', 'Force', 'N'), q('A', 'Area', 'm²', 0)],
    about: 'Force spread over an area. The same push through a needle and through a palm are very different things.',
    holds: ['Force perpendicular to the surface and evenly spread.'],
    solve: { P: (o) => o.F / o.A, F: (o) => o.P * o.A, A: (o) => o.F / o.P },
    near: ['hydrostatic', 'ideal-gas', 'density']
  },
  {
    id: 'hydrostatic',
    name: 'Pressure with depth',
    section: 'fluids',
    written: 'P = ρ·g·h',
    quantities: [q('P', 'Pressure', 'Pa'), q('rho', 'Density', 'kg/m³', 0), q('g', 'Gravity', 'm/s²', 0), q('h', 'Depth', 'm', 0)],
    about: 'Pressure in a fluid grows with depth, and depends on nothing about the shape of the container.',
    holds: ['Incompressible fluid at rest.', 'This is the pressure from the fluid alone; add the atmosphere above for the absolute value.'],
    solve: { P: (o) => o.rho * o.g * o.h, rho: (o) => o.P / (o.g * o.h), g: (o) => o.P / (o.rho * o.h), h: (o) => o.P / (o.rho * o.g) },
    near: ['pressure', 'buoyancy', 'density']
  },
  {
    id: 'buoyancy',
    name: "Archimedes' principle",
    section: 'fluids',
    written: 'F = ρ·g·V',
    quantities: [q('F', 'Upthrust', 'N'), q('rho', 'Fluid density', 'kg/m³', 0), q('g', 'Gravity', 'm/s²', 0), q('V', 'Volume displaced', 'm³', 0)],
    about: 'The upward push equals the weight of the fluid pushed aside. It is why steel ships float.',
    holds: ['Fluid at rest, uniform density.'],
    solve: { F: (o) => o.rho * o.g * o.V, rho: (o) => o.F / (o.g * o.V), g: (o) => o.F / (o.rho * o.V), V: (o) => o.F / (o.rho * o.g) },
    near: ['hydrostatic', 'density', 'weight']
  },
  {
    id: 'continuity',
    name: 'Continuity',
    section: 'fluids',
    written: 'A₁·v₁ = A₂·v₂',
    quantities: [q('A1', 'First area', 'm²', 0), q('v1', 'First speed', 'm/s'), q('A2', 'Second area', 'm²', 0), q('v2', 'Second speed', 'm/s')],
    about: 'What goes in must come out, so narrowing a pipe speeds up the flow. This is a thumb over a hose.',
    holds: ['Incompressible fluid, steady flow, no leaks.'],
    solve: { A1: (o) => (o.A2 * o.v2) / o.v1, v1: (o) => (o.A2 * o.v2) / o.A1, A2: (o) => (o.A1 * o.v1) / o.v2, v2: (o) => (o.A1 * o.v1) / o.A2 },
    near: ['reynolds', 'density']
  },
  {
    id: 'reynolds',
    name: 'Reynolds number',
    section: 'fluids',
    written: 'Re = ρ·v·L / μ',
    quantities: [q('Re', 'Reynolds number', '', 0), q('rho', 'Density', 'kg/m³', 0), q('v', 'Speed', 'm/s', 0), q('L', 'Characteristic length', 'm', 0), q('mu', 'Viscosity', 'Pa·s', 0)],
    about: 'Whether flow will be smooth or turbulent. Below about 2,000 in a pipe it is orderly; above about 4,000 it is chaos.',
    holds: ['The threshold depends on the geometry — the pipe figures do not transfer to a wing or a sphere.'],
    solve: {
      Re: (o) => (o.rho * o.v * o.L) / o.mu,
      v: (o) => (o.Re * o.mu) / (o.rho * o.L),
      L: (o) => (o.Re * o.mu) / (o.rho * o.v),
      mu: (o) => (o.rho * o.v * o.L) / o.Re,
      rho: (o) => (o.Re * o.mu) / (o.v * o.L)
    },
    near: ['continuity', 'density']
  },

  // ——— Heat and Thermodynamics ——————————————————————————————————————————————
  {
    id: 'ideal-gas',
    name: 'Ideal gas law',
    section: 'thermo',
    written: 'P·V = n·R·T',
    quantities: [q('P', 'Pressure', 'Pa', 0), q('V', 'Volume', 'm³', 0), q('n', 'Amount', 'mol', 0), q('T', 'Temperature', 'K', 0)],
    about: 'Pressure, volume, amount and temperature, all in one line. The foundation of every gas calculation.',
    holds: ['An ideal gas: point particles that do not attract each other. Real gases break this near condensation and at high pressure.', 'Temperature in kelvin, never celsius.'],
    solve: { P: (o) => (o.n * R_GAS * o.T) / o.V, V: (o) => (o.n * R_GAS * o.T) / o.P, n: (o) => (o.P * o.V) / (R_GAS * o.T), T: (o) => (o.P * o.V) / (o.n * R_GAS) },
    near: ['kinetic-temperature', 'carnot', 'rms-speed']
  },
  {
    id: 'kinetic-temperature',
    name: 'Temperature and particle energy',
    section: 'thermo',
    written: 'KE_avg = (3/2)·k_B·T',
    quantities: [q('KE', 'Average kinetic energy', 'J', 0), q('T', 'Temperature', 'K', 0)],
    about: 'What temperature actually is: the average energy of motion per particle. Nothing more mysterious than that.',
    holds: ['A monatomic ideal gas — three degrees of freedom. A diatomic gas has more and stores energy in rotation too.'],
    solve: { KE: (o) => 1.5 * K_B * o.T, T: (o) => o.KE / (1.5 * K_B) },
    near: ['rms-speed', 'ideal-gas', 'boltzmann-entropy']
  },
  {
    id: 'rms-speed',
    name: 'Root-mean-square speed',
    section: 'thermo',
    written: 'v_rms = √(3·R·T / M)',
    quantities: [q('v', 'RMS speed', 'm/s', 0), q('T', 'Temperature', 'K', 0), q('M', 'Molar mass', 'kg/mol', 0)],
    about: 'How fast gas molecules actually move. Air at room temperature is around 500 m/s, which startles most people.',
    holds: ['Ideal gas.', 'This is the root-mean-square, not the average or the most likely speed — the three differ.'],
    solve: { v: (o) => Math.sqrt((3 * R_GAS * o.T) / o.M), T: (o) => (o.v * o.v * o.M) / (3 * R_GAS), M: (o) => (3 * R_GAS * o.T) / (o.v * o.v) },
    near: ['kinetic-temperature', 'ideal-gas', 'avogadro-count']
  },
  {
    id: 'heat-capacity',
    name: 'Heat needed to warm something',
    section: 'thermo',
    written: 'Q = m·c·ΔT',
    quantities: [q('Q', 'Heat', 'J'), q('m', 'Mass', 'kg', 0), q('c', 'Specific heat capacity', 'J/(kg·K)', 0), q('T', 'Temperature change', 'K')],
    about: 'How much energy a temperature rise costs. Water\'s huge value is why the sea moderates climate.',
    holds: ['No change of state. Melting or boiling takes latent heat instead, at no temperature change at all.', 'Specific heat taken as constant over the range.'],
    solve: { Q: (o) => o.m * o.c * o.T, m: (o) => o.Q / (o.c * o.T), c: (o) => o.Q / (o.m * o.T), T: (o) => o.Q / (o.m * o.c) },
    near: ['latent-heat', 'entropy-change']
  },
  {
    id: 'latent-heat',
    name: 'Heat to change state',
    section: 'thermo',
    written: 'Q = m·L',
    quantities: [q('Q', 'Heat', 'J'), q('m', 'Mass', 'kg', 0), q('L', 'Latent heat', 'J/kg', 0)],
    about: 'The energy to melt or boil something, all of it going into breaking bonds and none into temperature.',
    holds: ['At the transition temperature, which does not move while the change happens.'],
    solve: { Q: (o) => o.m * o.L, m: (o) => o.Q / o.L, L: (o) => o.Q / o.m },
    near: ['heat-capacity']
  },
  {
    id: 'carnot',
    name: 'Carnot efficiency',
    section: 'thermo',
    written: 'η = 1 − T_c / T_h',
    quantities: [q('eta', 'Efficiency', '', 0, 1), q('Tc', 'Cold temperature', 'K', 0), q('Th', 'Hot temperature', 'K', 0)],
    about: 'The best any heat engine can ever do, set by the two temperatures alone. No cleverness beats it.',
    holds: ['A reversible engine. Every real engine does worse, usually much worse.', 'Kelvin, both of them.'],
    solve: { eta: (o) => 1 - o.Tc / o.Th, Tc: (o) => o.Th * (1 - o.eta), Th: (o) => o.Tc / (1 - o.eta) },
    near: ['entropy-change', 'ideal-gas']
  },
  {
    id: 'stefan-boltzmann',
    name: 'Stefan–Boltzmann law',
    section: 'thermo',
    written: 'P = σ·A·ε·T⁴',
    quantities: [q('P', 'Radiated power', 'W', 0), q('A', 'Area', 'm²', 0), q('e', 'Emissivity', '', 0, 1), q('T', 'Temperature', 'K', 0)],
    about: 'Everything warm glows, and the power goes as the fourth power of temperature. Double the temperature, sixteen times the radiation.',
    holds: ['Thermal radiation into cold surroundings. For a warm environment the net rate uses T⁴ − T_surroundings⁴.'],
    solve: {
      P: (o) => STEFAN * o.A * o.e * o.T ** 4,
      A: (o) => o.P / (STEFAN * o.e * o.T ** 4),
      T: (o) => (o.P / (STEFAN * o.A * o.e)) ** 0.25,
      e: (o) => o.P / (STEFAN * o.A * o.T ** 4)
    },
    near: ['wien', 'luminosity-distance', 'kinetic-temperature']
  },
  {
    id: 'wien',
    name: "Wien's displacement law",
    section: 'thermo',
    written: 'λ_max = 2.898×10⁻³ / T',
    quantities: [q('lambda', 'Peak wavelength', 'm', 0), q('T', 'Temperature', 'K', 0)],
    about: 'Hotter things glow bluer. This is how a star\'s colour gives away its temperature.',
    holds: ['A black body. A real object with a colour of its own shifts the peak.'],
    solve: { lambda: (o) => 2.897771955e-3 / o.T, T: (o) => 2.897771955e-3 / o.lambda },
    near: ['stefan-boltzmann', 'photon-energy']
  },
  {
    id: 'entropy-change',
    name: 'Entropy change',
    section: 'thermo',
    written: 'ΔS = Q / T',
    quantities: [q('S', 'Entropy change', 'J/K'), q('Q', 'Heat', 'J'), q('T', 'Temperature', 'K', 0)],
    about: 'How much disorder a heat transfer adds. The same heat at a low temperature adds far more.',
    holds: ['A reversible transfer at constant temperature. Otherwise this is a lower bound on the entropy produced.'],
    solve: { S: (o) => o.Q / o.T, Q: (o) => o.S * o.T, T: (o) => o.Q / o.S },
    near: ['boltzmann-entropy', 'carnot', 'heat-capacity']
  },
  {
    id: 'boltzmann-entropy',
    name: 'Boltzmann entropy',
    section: 'thermo',
    written: 'S = k_B·ln(W)',
    quantities: [q('S', 'Entropy', 'J/K'), q('W', 'Number of arrangements', '', 1)],
    about: 'Entropy counted directly: how many ways the particles could be arranged and still look the same. The formula on Boltzmann\'s gravestone.',
    holds: ['All arrangements equally likely.'],
    solve: { S: (o) => K_B * Math.log(o.W), W: (o) => Math.exp(o.S / K_B) },
    near: ['entropy-change']
  },

  // ——— Electricity ——————————————————————————————————————————————————————————
  {
    id: 'coulomb',
    name: "Coulomb's law",
    section: 'electric',
    written: 'F = k·q₁·q₂ / r²',
    quantities: [q('F', 'Force', 'N'), q('q1', 'First charge', 'C'), q('q2', 'Second charge', 'C'), q('r', 'Separation', 'm', 0)],
    about: 'The electric version of gravity — inverse square again, but about 10³⁶ times stronger, and it can push as well as pull.',
    holds: ['Point charges at rest. Moving charges also produce magnetic forces.', 'In vacuum. A material between them weakens the force by its dielectric constant.'],
    solve: {
      F: (o) => (K_COULOMB * o.q1 * o.q2) / (o.r * o.r),
      q1: (o) => (o.F * o.r * o.r) / (K_COULOMB * o.q2),
      q2: (o) => (o.F * o.r * o.r) / (K_COULOMB * o.q1),
      r: (o) => Math.sqrt(Math.abs((K_COULOMB * o.q1 * o.q2) / o.F))
    },
    near: ['electric-field', 'electric-potential', 'newton-gravity']
  },
  {
    id: 'electric-field',
    name: 'Electric field of a point charge',
    section: 'electric',
    written: 'E = k·q / r²',
    quantities: [q('E', 'Field strength', 'V/m'), q('q', 'Charge', 'C'), q('r', 'Distance', 'm', 0)],
    about: 'What the charge does to the space around it, whether or not anything is there to feel it.',
    holds: ['Point charge, in vacuum, at rest.'],
    solve: { E: (o) => (K_COULOMB * o.q) / (o.r * o.r), q: (o) => (o.E * o.r * o.r) / K_COULOMB, r: (o) => Math.sqrt(Math.abs((K_COULOMB * o.q) / o.E)) },
    near: ['coulomb', 'electric-potential', 'parallel-plate']
  },
  {
    id: 'electric-potential',
    name: 'Electric potential',
    section: 'electric',
    written: 'V = k·q / r',
    quantities: [q('V', 'Potential', 'V'), q('q', 'Charge', 'C'), q('r', 'Distance', 'm', 0)],
    about: 'Energy per unit charge. Note it falls as 1/r, not 1/r² — potential and field are not the same shape.',
    holds: ['Point charge, zero taken at infinity.'],
    solve: { V: (o) => (K_COULOMB * o.q) / o.r, q: (o) => (o.V * o.r) / K_COULOMB, r: (o) => (K_COULOMB * o.q) / o.V },
    near: ['coulomb', 'electric-field', 'capacitance']
  },
  {
    id: 'ohm',
    name: "Ohm's law",
    section: 'electric',
    written: 'V = I·R',
    quantities: [q('V', 'Voltage', 'V'), q('I', 'Current', 'A'), q('R', 'Resistance', 'Ω', 0)],
    about: 'The most used formula in electronics. Push harder and more flows, unless something resists.',
    holds: ['An ohmic conductor at constant temperature. Diodes, lamps and transistors all disobey it.'],
    solve: { V: (o) => o.I * o.R, I: (o) => o.V / o.R, R: (o) => o.V / o.I },
    near: ['electric-power', 'resistance-wire', 'current-charge']
  },
  {
    id: 'electric-power',
    name: 'Electrical power',
    section: 'electric',
    written: 'P = V·I = I²·R',
    quantities: [q('P', 'Power', 'W'), q('V', 'Voltage', 'V'), q('I', 'Current', 'A')],
    about: 'How fast electrical energy turns into something else — heat, light or motion.',
    holds: ['Direct current, or RMS values for alternating current.', 'For AC with a phase shift, multiply by the power factor.'],
    solve: { P: (o) => o.V * o.I, V: (o) => o.P / o.I, I: (o) => o.P / o.V },
    near: ['ohm', 'resistance-wire', 'current-charge']
  },
  {
    id: 'resistance-wire',
    name: 'Resistance of a wire',
    section: 'electric',
    written: 'R = ρ·L / A',
    quantities: [q('R', 'Resistance', 'Ω', 0), q('rho', 'Resistivity', 'Ω·m', 0), q('L', 'Length', 'm', 0), q('A', 'Cross-section area', 'm²', 0)],
    about: 'Long and thin resists; short and fat does not. This is why mains cable is thick.',
    holds: ['Uniform wire at constant temperature. Resistivity rises with temperature for metals.'],
    solve: { R: (o) => (o.rho * o.L) / o.A, rho: (o) => (o.R * o.A) / o.L, L: (o) => (o.R * o.A) / o.rho, A: (o) => (o.rho * o.L) / o.R },
    near: ['ohm', 'electric-power']
  },
  {
    id: 'capacitance',
    name: 'Capacitance',
    section: 'electric',
    written: 'C = Q / V',
    quantities: [q('C', 'Capacitance', 'F', 0), q('Q', 'Charge', 'C'), q('V', 'Voltage', 'V')],
    about: 'How much charge it holds per volt. The definition of a capacitor.',
    holds: ['Linear capacitor. Some ceramics change capacitance with the voltage applied.'],
    solve: { C: (o) => o.Q / o.V, Q: (o) => o.C * o.V, V: (o) => o.Q / o.C },
    near: ['capacitor-energy', 'parallel-plate', 'rc-time']
  },
  {
    id: 'capacitor-energy',
    name: 'Energy in a capacitor',
    section: 'electric',
    written: 'E = ½·C·V²',
    quantities: [q('E', 'Energy', 'J', 0), q('C', 'Capacitance', 'F', 0), q('V', 'Voltage', 'V')],
    about: 'The energy stored in the field between the plates, available all at once — which is how a camera flash works.',
    holds: ['Linear capacitor.'],
    solve: { E: (o) => 0.5 * o.C * o.V * o.V, C: (o) => (2 * o.E) / (o.V * o.V), V: (o) => Math.sqrt((2 * o.E) / o.C) },
    near: ['capacitance', 'parallel-plate']
  },
  {
    id: 'parallel-plate',
    name: 'Parallel plate capacitor',
    section: 'electric',
    written: 'C = ε₀·ε_r·A / d',
    quantities: [q('C', 'Capacitance', 'F', 0), q('er', 'Relative permittivity', '', 1), q('A', 'Plate area', 'm²', 0), q('d', 'Separation', 'm', 0)],
    about: 'Bigger plates closer together store more. The dielectric between them multiplies it further.',
    holds: ['Separation small compared to the plate size, so the field at the edges can be ignored.'],
    solve: {
      C: (o) => (EPS0 * o.er * o.A) / o.d,
      A: (o) => (o.C * o.d) / (EPS0 * o.er),
      d: (o) => (EPS0 * o.er * o.A) / o.C,
      er: (o) => (o.C * o.d) / (EPS0 * o.A)
    },
    near: ['capacitance', 'capacitor-energy', 'rc-time']
  },
  {
    id: 'rc-time',
    name: 'RC time constant',
    section: 'electric',
    written: 'τ = R·C',
    quantities: [q('tau', 'Time constant', 's', 0), q('R', 'Resistance', 'Ω', 0), q('C', 'Capacitance', 'F', 0)],
    about: 'How long a capacitor takes to charge: about 63% in one time constant, and essentially full in five.',
    holds: ['A single resistor and capacitor in series.'],
    solve: { tau: (o) => o.R * o.C, R: (o) => o.tau / o.C, C: (o) => o.tau / o.R },
    near: ['capacitance', 'resistance-wire', 'lc-resonance']
  },

  // ——— Magnetism ————————————————————————————————————————————————————————————
  {
    id: 'lorentz',
    name: 'Force on a moving charge',
    section: 'magnetic',
    written: 'F = q·v·B·sin(θ)',
    quantities: [q('F', 'Force', 'N'), q('q', 'Charge', 'C'), q('v', 'Speed', 'm/s'), q('B', 'Magnetic field', 'T'), q('theta', 'Angle', '°', 0, 180)],
    about: 'A magnetic field pushes a moving charge sideways — at right angles to both the motion and the field, which is why it curves rather than speeds up.',
    holds: ['A charge moving along the field feels nothing at all.', 'The magnetic force does no work, since it is always perpendicular to the motion.'],
    solve: {
      F: (o) => o.q * o.v * o.B * Math.sin((o.theta * Math.PI) / 180),
      q: (o) => o.F / (o.v * o.B * Math.sin((o.theta * Math.PI) / 180)),
      v: (o) => o.F / (o.q * o.B * Math.sin((o.theta * Math.PI) / 180)),
      B: (o) => o.F / (o.q * o.v * Math.sin((o.theta * Math.PI) / 180))
    },
    near: ['cyclotron', 'wire-force', 'solenoid']
  },
  {
    id: 'cyclotron',
    name: 'Cyclotron radius',
    section: 'magnetic',
    written: 'r = m·v / (q·B)',
    quantities: [q('r', 'Radius', 'm', 0), q('m', 'Mass', 'kg', 0), q('v', 'Speed', 'm/s'), q('q', 'Charge', 'C'), q('B', 'Field', 'T')],
    about: 'The circle a charged particle is bent into. Faster is wider, stronger field is tighter — the basis of every particle accelerator.',
    holds: ['Velocity perpendicular to the field. A component along it makes a helix instead.', 'Non-relativistic. Near light speed the mass term becomes γm.'],
    solve: { r: (o) => (o.m * o.v) / (o.q * o.B), v: (o) => (o.r * o.q * o.B) / o.m, B: (o) => (o.m * o.v) / (o.q * o.r), m: (o) => (o.r * o.q * o.B) / o.v },
    near: ['lorentz', 'wire-force', 'momentum']
  },
  {
    id: 'wire-force',
    name: 'Force on a current-carrying wire',
    section: 'magnetic',
    written: 'F = B·I·L·sin(θ)',
    quantities: [q('F', 'Force', 'N'), q('B', 'Field', 'T'), q('I', 'Current', 'A'), q('L', 'Length in the field', 'm', 0), q('theta', 'Angle', '°', 0, 180)],
    about: 'How every electric motor works. Current in a field gets pushed.',
    holds: ['Straight wire, uniform field.'],
    solve: {
      F: (o) => o.B * o.I * o.L * Math.sin((o.theta * Math.PI) / 180),
      B: (o) => o.F / (o.I * o.L * Math.sin((o.theta * Math.PI) / 180)),
      I: (o) => o.F / (o.B * o.L * Math.sin((o.theta * Math.PI) / 180)),
      L: (o) => o.F / (o.B * o.I * Math.sin((o.theta * Math.PI) / 180))
    },
    near: ['lorentz', 'solenoid', 'faraday']
  },
  {
    id: 'solenoid',
    name: 'Field inside a solenoid',
    section: 'magnetic',
    written: 'B = μ₀·n·I',
    quantities: [q('B', 'Field', 'T'), q('n', 'Turns per metre', '1/m', 0), q('I', 'Current', 'A')],
    about: 'A coil makes a nearly uniform field inside it, set by the turns per metre and the current — and not by the coil\'s diameter.',
    holds: ['A long solenoid, measured well away from the ends.', 'No iron core; an iron core multiplies this substantially.'],
    solve: { B: (o) => MU0 * o.n * o.I, n: (o) => o.B / (MU0 * o.I), I: (o) => o.B / (MU0 * o.n) },
    near: ['wire-force', 'inductor-energy', 'faraday']
  },
  {
    id: 'faraday',
    name: "Faraday's law",
    section: 'magnetic',
    written: 'ε = −N·ΔΦ / Δt',
    quantities: [q('emf', 'Induced voltage', 'V'), q('N', 'Number of turns', '', 1), q('phi', 'Change in flux', 'Wb'), q('t', 'Time', 's', 0)],
    about: 'A changing magnetic field makes a voltage. Every generator, transformer and induction hob rests on this one line.',
    holds: ['The minus sign is Lenz\'s law: the induced current opposes the change that made it. The magnitude is reported here.'],
    solve: { emf: (o) => (-o.N * o.phi) / o.t, phi: (o) => (-o.emf * o.t) / o.N, t: (o) => (-o.N * o.phi) / o.emf, N: (o) => (-o.emf * o.t) / o.phi },
    near: ['transformer', 'solenoid', 'inductor-energy']
  },
  {
    id: 'transformer',
    name: 'Transformer',
    section: 'magnetic',
    written: 'V_s / V_p = N_s / N_p',
    quantities: [q('Vs', 'Secondary voltage', 'V'), q('Vp', 'Primary voltage', 'V'), q('Ns', 'Secondary turns', '', 1), q('Np', 'Primary turns', '', 1)],
    about: 'Change the voltage by changing the turns ratio. This is why mains power can travel hundreds of miles.',
    holds: ['Alternating current only — a transformer does nothing with DC.', 'A perfect transformer. Real ones lose a few percent to heat and leakage.'],
    solve: { Vs: (o) => (o.Vp * o.Ns) / o.Np, Vp: (o) => (o.Vs * o.Np) / o.Ns, Ns: (o) => (o.Vs * o.Np) / o.Vp, Np: (o) => (o.Vp * o.Ns) / o.Vs },
    near: ['faraday', 'electric-power']
  },
  {
    id: 'inductor-energy',
    name: 'Energy in an inductor',
    section: 'magnetic',
    written: 'E = ½·L·I²',
    quantities: [q('E', 'Energy', 'J', 0), q('L', 'Inductance', 'H', 0), q('I', 'Current', 'A')],
    about: 'Energy stored in the magnetic field. It is why breaking an inductive circuit makes a spark — the energy has to go somewhere.',
    holds: ['Linear inductor, no core saturation.'],
    solve: { E: (o) => 0.5 * o.L * o.I * o.I, L: (o) => (2 * o.E) / (o.I * o.I), I: (o) => Math.sqrt((2 * o.E) / o.L) },
    near: ['solenoid', 'lc-resonance', 'capacitor-energy']
  },
  {
    id: 'lc-resonance',
    name: 'LC resonance',
    section: 'magnetic',
    written: 'f = 1 / (2π·√(L·C))',
    quantities: [q('f', 'Resonant frequency', 'Hz', 0), q('L', 'Inductance', 'H', 0), q('C', 'Capacitance', 'F', 0)],
    about: 'The frequency a coil and capacitor ring at together. This is how a radio picks one station out of all of them.',
    holds: ['Ideal, lossless components. Real resistance broadens the peak.'],
    solve: {
      f: (o) => 1 / (2 * Math.PI * Math.sqrt(o.L * o.C)),
      L: (o) => 1 / (4 * Math.PI * Math.PI * o.f * o.f * o.C),
      C: (o) => 1 / (4 * Math.PI * Math.PI * o.f * o.f * o.L)
    },
    near: ['inductor-energy', 'capacitance', 'rc-time']
  },

  // ——— Light and Optics —————————————————————————————————————————————————————
  {
    id: 'snell',
    name: "Snell's law",
    section: 'optics',
    written: 'n₁·sin(θ₁) = n₂·sin(θ₂)',
    quantities: [q('n1', 'First index', '', 1), q('theta1', 'Angle in the first', '°', 0, 90), q('n2', 'Second index', '', 1), q('theta2', 'Angle in the second', '°', 0, 90)],
    about: 'Why a straw looks bent in water. Light changes direction when it changes speed.',
    holds: ['Measured from the normal, not the surface.', 'Going into a less dense medium past the critical angle, there is no refracted ray at all — it reflects entirely.'],
    solve: {
      theta2: (o) => degrees(asinOf((o.n1 * Math.sin(radians(o.theta1))) / o.n2)),
      theta1: (o) => degrees(asinOf((o.n2 * Math.sin(radians(o.theta2))) / o.n1)),
      n1: (o) => (o.n2 * Math.sin((o.theta2 * Math.PI) / 180)) / Math.sin((o.theta1 * Math.PI) / 180),
      n2: (o) => (o.n1 * Math.sin((o.theta1 * Math.PI) / 180)) / Math.sin((o.theta2 * Math.PI) / 180)
    },
    near: ['critical-angle', 'refractive-index', 'lens-equation']
  },
  {
    id: 'critical-angle',
    name: 'Critical angle',
    section: 'optics',
    written: 'sin(θ_c) = n₂ / n₁',
    quantities: [q('theta', 'Critical angle', '°', 0, 90), q('n1', 'Denser medium index', '', 1), q('n2', 'Less dense index', '', 1)],
    about: 'Past this angle light cannot get out and reflects completely. This is what makes fibre optics work.',
    holds: ['Only when going from denser to less dense, so n₁ must be the larger.'],
    solve: {
      theta: (o) => degrees(asinOf(o.n2 / o.n1)),
      n1: (o) => o.n2 / Math.sin((o.theta * Math.PI) / 180),
      n2: (o) => o.n1 * Math.sin((o.theta * Math.PI) / 180)
    },
    near: ['snell', 'refractive-index']
  },
  {
    id: 'refractive-index',
    name: 'Refractive index',
    section: 'optics',
    written: 'n = c / v',
    quantities: [q('n', 'Refractive index', '', 1), q('v', 'Speed in the medium', 'm/s', 0)],
    about: 'How much slower light goes in a material. Water is 1.33, glass about 1.5, diamond 2.42.',
    holds: ['Depends on the wavelength — which is exactly why a prism splits white light.'],
    solve: { n: (o) => C_LIGHT / o.v, v: (o) => C_LIGHT / o.n },
    near: ['snell', 'critical-angle', 'wave-speed']
  },
  {
    id: 'lens-equation',
    name: 'Lens equation',
    section: 'optics',
    written: '1/f = 1/u + 1/v',
    quantities: [q('f', 'Focal length', 'm'), q('u', 'Object distance', 'm'), q('v', 'Image distance', 'm')],
    about: 'Where the image forms. The single formula behind cameras, glasses, telescopes and your own eye.',
    holds: ['Thin lens, rays close to the axis.', 'Signs matter: a negative image distance means the image is on the same side as the object, and virtual.'],
    solve: { f: (o) => 1 / (1 / o.u + 1 / o.v), u: (o) => 1 / (1 / o.f - 1 / o.v), v: (o) => 1 / (1 / o.f - 1 / o.u) },
    near: ['magnification', 'lens-power', 'snell']
  },
  {
    id: 'magnification',
    name: 'Magnification',
    section: 'optics',
    written: 'm = −v / u',
    quantities: [q('m', 'Magnification', ''), q('v', 'Image distance', 'm'), q('u', 'Object distance', 'm')],
    about: 'How much bigger the image is. A negative value means it is upside down.',
    holds: ['Thin lens, paraxial rays.'],
    solve: { m: (o) => -o.v / o.u, v: (o) => -o.m * o.u, u: (o) => -o.v / o.m },
    near: ['lens-equation', 'lens-power']
  },
  {
    id: 'lens-power',
    name: 'Lens power',
    section: 'optics',
    written: 'P = 1 / f',
    quantities: [q('P', 'Power', 'D'), q('f', 'Focal length', 'm')],
    about: 'Dioptres, the number on a spectacle prescription. Shorter focal length means stronger lens.',
    holds: ['Focal length in metres.'],
    solve: { P: (o) => 1 / o.f, f: (o) => 1 / o.P },
    near: ['lens-equation', 'magnification']
  },
  {
    id: 'double-slit',
    name: 'Double slit',
    section: 'optics',
    written: 'd·sin(θ) = m·λ',
    quantities: [q('d', 'Slit separation', 'm', 0), q('theta', 'Angle to the bright fringe', '°', 0, 90), q('m', 'Fringe order', ''), q('lambda', 'Wavelength', 'm', 0)],
    about: 'Where the bright fringes land. The experiment that proved light is a wave, and later that electrons are too.',
    holds: ['Slits much narrower than their separation.', 'Light arriving in step at both slits.'],
    solve: {
      theta: (o) => degrees(asinOf((o.m * o.lambda) / o.d)),
      d: (o) => (o.m * o.lambda) / Math.sin((o.theta * Math.PI) / 180),
      lambda: (o) => (o.d * Math.sin((o.theta * Math.PI) / 180)) / o.m,
      m: (o) => (o.d * Math.sin((o.theta * Math.PI) / 180)) / o.lambda
    },
    near: ['wave-speed', 'rayleigh', 'de-broglie']
  },
  {
    id: 'rayleigh',
    name: 'Rayleigh criterion',
    section: 'optics',
    written: 'θ = 1.22·λ / D',
    quantities: [q('theta', 'Smallest resolvable angle', 'rad', 0), q('lambda', 'Wavelength', 'm', 0), q('D', 'Aperture diameter', 'm', 0)],
    about: 'The finest detail any telescope or camera can see, set by diffraction and not by the quality of the glass.',
    holds: ['A circular aperture. The 1.22 comes from the first zero of the Bessel function.', 'Ignores atmospheric blurring, which usually dominates for ground telescopes.'],
    solve: { theta: (o) => (1.22 * o.lambda) / o.D, lambda: (o) => (o.theta * o.D) / 1.22, D: (o) => (1.22 * o.lambda) / o.theta },
    near: ['double-slit', 'wave-speed']
  },

  // ——— Quantum ——————————————————————————————————————————————————————————————
  {
    id: 'photon-energy',
    name: 'Photon energy',
    section: 'quantum',
    written: 'E = h·f = h·c / λ',
    quantities: [q('E', 'Energy', 'J', 0), q('f', 'Frequency', 'Hz', 0)],
    about: 'Light comes in lumps, and each lump\'s energy depends only on the colour. This is where quantum mechanics starts.',
    holds: ['Always true for a photon in vacuum.'],
    solve: { E: (o) => H_PLANCK * o.f, f: (o) => o.E / H_PLANCK },
    near: ['photoelectric', 'de-broglie', 'bohr-energy']
  },
  {
    id: 'photoelectric',
    name: 'Photoelectric effect',
    section: 'quantum',
    written: 'KE_max = h·f − φ',
    quantities: [q('KE', 'Maximum electron energy', 'J'), q('f', 'Light frequency', 'Hz', 0), q('phi', 'Work function', 'J', 0)],
    about: 'Shine light on metal and electrons come out — but only above a threshold frequency, however bright the light. The observation that forced physics to accept photons.',
    holds: ['Below the threshold nothing is emitted at all, and this formula then returns a negative number that has no physical meaning.', 'One photon per electron.'],
    solve: { KE: (o) => H_PLANCK * o.f - o.phi, f: (o) => (o.KE + o.phi) / H_PLANCK, phi: (o) => H_PLANCK * o.f - o.KE },
    near: ['photon-energy', 'de-broglie', 'bohr-energy']
  },
  {
    id: 'de-broglie',
    name: 'de Broglie wavelength',
    section: 'quantum',
    written: 'λ = h / p',
    quantities: [q('lambda', 'Wavelength', 'm', 0), q('p', 'Momentum', 'kg·m/s', 0)],
    about: 'Everything is a wave, including you — just with a wavelength far too small to notice. For an electron it is around the size of an atom, which is why electron microscopes work.',
    holds: ['Non-relativistic momentum. Near light speed use the relativistic p.'],
    solve: { lambda: (o) => H_PLANCK / o.p, p: (o) => H_PLANCK / o.lambda },
    near: ['photon-energy', 'uncertainty', 'particle-in-box']
  },
  {
    id: 'uncertainty',
    name: 'Heisenberg uncertainty',
    section: 'quantum',
    written: 'Δx·Δp ≥ ℏ/2',
    quantities: [q('x', 'Position uncertainty', 'm', 0), q('p', 'Momentum uncertainty', 'kg·m/s', 0)],
    about: 'Not a limit of our instruments — a limit of what "position" and "momentum" can simultaneously mean. Pin one down and the other spreads out.',
    holds: ['This is an inequality, so the vault returns the smallest the other can possibly be, not what it is.'],
    solve: { p: (o) => HBAR / (2 * o.x), x: (o) => HBAR / (2 * o.p) },
    near: ['de-broglie', 'particle-in-box']
  },
  {
    id: 'bohr-energy',
    name: 'Hydrogen energy levels',
    section: 'quantum',
    written: 'E_n = −13.6 eV / n²',
    quantities: [q('E', 'Energy', 'eV'), q('n', 'Level', '', 1)],
    about: 'Why hydrogen emits exactly the colours it does. The negative sign means the electron is bound.',
    holds: ['Hydrogen, or a one-electron ion with the right scaling. Multi-electron atoms are far messier.', 'Ignores fine structure and spin, which split each of these slightly.'],
    solve: { E: (o) => -13.605693122994 / (o.n * o.n), n: (o) => Math.sqrt(-13.605693122994 / o.E) },
    near: ['photon-energy', 'particle-in-box']
  },
  {
    id: 'particle-in-box',
    name: 'Particle in a box',
    section: 'quantum',
    written: 'E_n = n²·h² / (8·m·L²)',
    quantities: [q('E', 'Energy', 'J', 0), q('n', 'Level', '', 1), q('m', 'Mass', 'kg', 0), q('L', 'Box width', 'm', 0)],
    about: 'The simplest quantum problem there is, and the one every other is compared to. Confine something and its energy must come in steps.',
    holds: ['Infinitely high walls. A real well of finite depth has fewer levels and lets the wavefunction leak out.'],
    solve: {
      E: (o) => (o.n * o.n * H_PLANCK * H_PLANCK) / (8 * o.m * o.L * o.L),
      n: (o) => Math.sqrt((8 * o.m * o.L * o.L * o.E) / (H_PLANCK * H_PLANCK)),
      L: (o) => Math.sqrt((o.n * o.n * H_PLANCK * H_PLANCK) / (8 * o.m * o.E)),
      m: (o) => (o.n * o.n * H_PLANCK * H_PLANCK) / (8 * o.E * o.L * o.L)
    },
    near: ['bohr-energy', 'de-broglie', 'uncertainty']
  },
  {
    id: 'compton',
    name: 'Compton wavelength shift',
    section: 'quantum',
    written: 'Δλ = (h / (m·c))·(1 − cos θ)',
    quantities: [q('lambda', 'Wavelength shift', 'm', 0), q('theta', 'Scattering angle', '°', 0, 180)],
    about: 'X-rays bounce off electrons and come back redder. Proof that photons carry momentum like particles.',
    holds: ['A free electron at rest. Bound electrons behave differently.'],
    solve: {
      lambda: (o) => (H_PLANCK / (9.1093837015e-31 * C_LIGHT)) * (1 - Math.cos((o.theta * Math.PI) / 180)),
      theta: (o) => degrees(acosOf(1 - o.lambda / (H_PLANCK / (9.1093837015e-31 * C_LIGHT))))
    },
    near: ['photon-energy', 'momentum-relativistic']
  },

  // ——— Relativity ———————————————————————————————————————————————————————————
  {
    id: 'mass-energy',
    name: 'Mass–energy equivalence',
    section: 'relativity',
    written: 'E = m·c²',
    quantities: [q('E', 'Energy', 'J', 0), q('m', 'Mass', 'kg', 0)],
    about: 'The most famous equation in physics. Mass is a form of energy, and c² is an enormous exchange rate.',
    holds: ['This is the rest energy. A moving object also has kinetic energy, giving E = γmc².'],
    solve: { E: (o) => o.m * C_LIGHT * C_LIGHT, m: (o) => o.E / (C_LIGHT * C_LIGHT) },
    near: ['lorentz-factor', 'binding-energy', 'schwarzschild']
  },
  {
    id: 'lorentz-factor',
    name: 'Lorentz factor',
    section: 'relativity',
    written: 'γ = 1 / √(1 − v²/c²)',
    quantities: [q('gamma', 'Lorentz factor', '', 1), q('v', 'Speed', 'm/s', 0, C_LIGHT)],
    about: 'The number behind every relativistic effect. Barely above 1 at everyday speeds, and climbing without limit as you approach light speed.',
    holds: ['Speed strictly below c. At c exactly this is infinite, which is why massive things cannot get there.'],
    solve: {
      gamma: (o) => 1 / Math.sqrt(1 - (o.v * o.v) / (C_LIGHT * C_LIGHT)),
      v: (o) => C_LIGHT * Math.sqrt(1 - 1 / (o.gamma * o.gamma))
    },
    near: ['time-dilation', 'length-contraction', 'momentum-relativistic']
  },
  {
    id: 'time-dilation',
    name: 'Time dilation',
    section: 'relativity',
    written: "Δt' = γ·Δt",
    quantities: [q('tmoving', 'Time measured by the observer', 's', 0), q('t', 'Time on the moving clock', 's', 0), q('gamma', 'Lorentz factor', '', 1)],
    about: 'A moving clock runs slow. Measured on muons, on GPS satellites and in particle accelerators every day.',
    holds: ['Constant relative velocity, flat spacetime. Gravity dilates time as well, by a different formula.'],
    solve: { tmoving: (o) => o.gamma * o.t, t: (o) => o.tmoving / o.gamma, gamma: (o) => o.tmoving / o.t },
    near: ['lorentz-factor', 'length-contraction', 'momentum-relativistic']
  },
  {
    id: 'length-contraction',
    name: 'Length contraction',
    section: 'relativity',
    written: 'L = L₀ / γ',
    quantities: [q('L', 'Measured length', 'm', 0), q('L0', 'Rest length', 'm', 0), q('gamma', 'Lorentz factor', '', 1)],
    about: 'A moving object is shorter along its direction of travel. Not an illusion — the measurement really gives a smaller number.',
    holds: ['Only along the direction of motion. Sideways dimensions are unchanged.'],
    solve: { L: (o) => o.L0 / o.gamma, L0: (o) => o.L * o.gamma, gamma: (o) => o.L0 / o.L },
    near: ['lorentz-factor', 'time-dilation']
  },
  {
    id: 'momentum-relativistic',
    name: 'Relativistic momentum',
    section: 'relativity',
    written: 'p = γ·m·v',
    quantities: [q('p', 'Momentum', 'kg·m/s'), q('m', 'Rest mass', 'kg', 0), q('v', 'Speed', 'm/s', 0, C_LIGHT), q('gamma', 'Lorentz factor', '', 1)],
    about: 'Momentum grows without limit as you approach light speed, which is the real reason nothing massive reaches it.',
    holds: ['Speed below c.'],
    solve: { p: (o) => o.gamma * o.m * o.v, m: (o) => o.p / (o.gamma * o.v), v: (o) => o.p / (o.gamma * o.m) },
    near: ['lorentz-factor', 'momentum', 'mass-energy']
  },
  {
    id: 'relativistic-doppler',
    name: 'Relativistic Doppler',
    section: 'relativity',
    written: "f' = f·√((1 − β)/(1 + β))",
    quantities: [q('fo', 'Observed frequency', 'Hz', 0), q('f', 'Source frequency', 'Hz', 0), q('beta', 'Speed as a fraction of c', '', -1, 1)],
    about: 'The Doppler shift done properly for light. Positive β is receding, which lowers the frequency — this is cosmological redshift.',
    holds: ['Motion directly along the line of sight.', 'β strictly between −1 and 1.'],
    solve: {
      fo: (o) => o.f * Math.sqrt((1 - o.beta) / (1 + o.beta)),
      f: (o) => o.fo / Math.sqrt((1 - o.beta) / (1 + o.beta)),
      beta: (o) => {
        const ratio = (o.fo / o.f) ** 2
        return (1 - ratio) / (1 + ratio)
      }
    },
    near: ['doppler', 'lorentz-factor', 'hubble']
  },

  // ——— Nuclear ——————————————————————————————————————————————————————————————
  {
    id: 'decay-law',
    name: 'Radioactive decay',
    section: 'nuclear',
    written: 'N = N₀·e^(−λt)',
    quantities: [q('N', 'Nuclei left', '', 0), q('N0', 'Nuclei at the start', '', 0), q('lambda', 'Decay constant', '1/s', 0), q('t', 'Time', 's', 0)],
    about: 'Each nucleus decays at random, and that randomness averages out into an exact exponential.',
    holds: ['Large numbers. With ten nuclei left this is a poor description of what will actually happen.', 'The decay constant never changes — not with temperature, pressure or chemistry.'],
    solve: {
      N: (o) => o.N0 * Math.exp(-o.lambda * o.t),
      N0: (o) => o.N / Math.exp(-o.lambda * o.t),
      lambda: (o) => -Math.log(o.N / o.N0) / o.t,
      t: (o) => -Math.log(o.N / o.N0) / o.lambda
    },
    near: ['half-life', 'activity', 'attenuation']
  },
  {
    id: 'half-life',
    name: 'Half-life',
    section: 'nuclear',
    written: 't½ = ln(2) / λ',
    quantities: [q('t', 'Half-life', 's', 0), q('lambda', 'Decay constant', '1/s', 0)],
    about: 'How long until half of it is gone. Then half of the rest in the same time again, for ever.',
    holds: ['Always true as the relation between the two.'],
    solve: { t: (o) => Math.LN2 / o.lambda, lambda: (o) => Math.LN2 / o.t },
    near: ['decay-law', 'activity']
  },
  {
    id: 'activity',
    name: 'Activity',
    section: 'nuclear',
    written: 'A = λ·N',
    quantities: [q('A', 'Activity', 'Bq', 0), q('lambda', 'Decay constant', '1/s', 0), q('N', 'Nuclei present', '', 0)],
    about: 'Decays per second. A short half-life with few atoms can be more active than a long one with many.',
    holds: ['Large numbers.'],
    solve: { A: (o) => o.lambda * o.N, lambda: (o) => o.A / o.N, N: (o) => o.A / o.lambda },
    near: ['decay-law', 'half-life']
  },
  {
    id: 'binding-energy',
    name: 'Mass defect and binding energy',
    section: 'nuclear',
    written: 'E = Δm·c²',
    quantities: [q('E', 'Binding energy', 'J', 0), q('m', 'Mass defect', 'kg', 0)],
    about: 'A nucleus weighs less than its parts, and the missing mass is what holds it together. This is where fission and fusion energy comes from.',
    holds: ['The mass defect must be the difference between the separated nucleons and the whole nucleus.'],
    solve: { E: (o) => o.m * C_LIGHT * C_LIGHT, m: (o) => o.E / (C_LIGHT * C_LIGHT) },
    near: ['mass-energy', 'decay-law']
  },
  {
    id: 'attenuation',
    name: 'Radiation attenuation',
    section: 'nuclear',
    written: 'I = I₀·e^(−μx)',
    quantities: [q('I', 'Intensity after', 'W/m²', 0), q('I0', 'Intensity before', 'W/m²', 0), q('mu', 'Attenuation coefficient', '1/m', 0), q('x', 'Thickness', 'm', 0)],
    about: 'How much shielding stops. Exponential, so there is no thickness that stops all of it — only thicknesses that stop enough.',
    holds: ['A narrow beam of one energy. A broad beam scatters radiation back in, and this underestimates what gets through.'],
    solve: {
      I: (o) => o.I0 * Math.exp(-o.mu * o.x),
      I0: (o) => o.I / Math.exp(-o.mu * o.x),
      mu: (o) => -Math.log(o.I / o.I0) / o.x,
      x: (o) => -Math.log(o.I / o.I0) / o.mu
    },
    near: ['decay-law']
  },

  // ——— Astrophysics —————————————————————————————————————————————————————————
  {
    id: 'hubble',
    name: "Hubble's law",
    section: 'astro',
    written: 'v = H₀·d',
    quantities: [q('v', 'Recession speed', 'km/s', 0), q('d', 'Distance', 'Mpc', 0), q('H0', 'Hubble constant', 'km/s/Mpc', 0)],
    about: 'Everything distant is moving away, faster the further off it is. The observation that told us the universe is expanding.',
    holds: ['Distant galaxies only. Nearby ones are dominated by their own motion, and Andromeda is coming toward us.', 'Linear only for modest distances; further out the expansion history matters.'],
    solve: { v: (o) => o.H0 * o.d, d: (o) => o.v / o.H0, H0: (o) => o.v / o.d },
    near: ['luminosity-distance', 'parallax', 'relativistic-doppler']
  },
  {
    id: 'luminosity-distance',
    name: 'Apparent brightness',
    section: 'astro',
    written: 'b = L / (4π·d²)',
    quantities: [q('b', 'Apparent brightness', 'W/m²', 0), q('L', 'Luminosity', 'W', 0), q('d', 'Distance', 'm', 0)],
    about: 'Light spreads over a sphere, so brightness falls as the square of distance. Knowing a star\'s true output gives you its distance.',
    holds: ['No dust in between. Interstellar dust dims things and makes them look further away than they are.'],
    solve: { b: (o) => o.L / (4 * Math.PI * o.d * o.d), L: (o) => o.b * 4 * Math.PI * o.d * o.d, d: (o) => Math.sqrt(o.L / (4 * Math.PI * o.b)) },
    near: ['parallax', 'hubble', 'stefan-boltzmann']
  },
  {
    id: 'parallax',
    name: 'Parallax distance',
    section: 'astro',
    written: 'd = 1 / p',
    quantities: [q('d', 'Distance', 'pc', 0), q('p', 'Parallax angle', 'arcsec', 0)],
    about: 'A nearby star shifts against the background as Earth orbits. The only truly direct way to measure a stellar distance.',
    holds: ['The parsec is defined by this, so it is exact by construction.', 'Only works out to a few thousand parsecs before the angle is too small to measure.'],
    solve: { d: (o) => 1 / o.p, p: (o) => 1 / o.d },
    near: ['luminosity-distance', 'hubble']
  },
  {
    id: 'jeans-mass',
    name: 'Jeans mass',
    section: 'astro',
    written: 'M_J ≈ (5kT/(G·m))^(3/2)·(3/(4πρ))^(1/2)',
    quantities: [q('M', 'Jeans mass', 'kg', 0), q('T', 'Temperature', 'K', 0), q('rho', 'Density', 'kg/m³', 0), q('m', 'Particle mass', 'kg', 0)],
    about: 'How much gas must gather before gravity beats pressure and a star begins to form.',
    holds: ['A uniform, isothermal cloud with no rotation, no magnetic field and no turbulence — all four of which matter in real clouds.'],
    solve: {
      M: (o) => ((5 * K_B * o.T) / (G_GRAV * o.m)) ** 1.5 * (3 / (4 * Math.PI * o.rho)) ** 0.5
    },
    near: ['newton-gravity', 'kinetic-temperature', 'density']
  },
  {
    id: 'avogadro-count',
    name: 'Particles in an amount',
    section: 'thermo',
    written: 'N = n·N_A',
    quantities: [q('N', 'Number of particles', '', 0), q('n', 'Amount', 'mol', 0)],
    about: 'A mole is just a count — about 6.022×10²³ of whatever you are counting.',
    holds: ['Always true.'],
    solve: { N: (o) => o.n * N_A, n: (o) => o.N / N_A },
    near: ['ideal-gas', 'rms-speed']
  },
  {
    id: 'charge-electrons',
    name: 'Charge and electrons',
    section: 'electric',
    written: 'Q = n·e',
    quantities: [q('Q', 'Charge', 'C'), q('n', 'Number of electrons', '')],
    about: 'Charge comes in whole multiples of the electron charge. There is no half an electron\'s worth.',
    holds: ['Always true for free particles. Quarks carry thirds, but never appear alone.'],
    solve: { Q: (o) => o.n * E_CHARGE, n: (o) => o.Q / E_CHARGE },
    near: ['current-charge', 'coulomb']
  },
  {
    id: 'current-charge',
    name: 'Current',
    section: 'electric',
    written: 'I = Q / t',
    quantities: [q('I', 'Current', 'A'), q('Q', 'Charge', 'C'), q('t', 'Time', 's', 0)],
    about: 'Current is charge flowing past, per second. One amp is one coulomb a second.',
    holds: ['This is the average over the time.'],
    solve: { I: (o) => o.Q / o.t, Q: (o) => o.I * o.t, t: (o) => o.Q / o.I },
    near: ['ohm', 'charge-electrons', 'electric-power']
  },
  {
    id: 'density',
    name: 'Density',
    section: 'fluids',
    written: 'ρ = m / V',
    quantities: [q('rho', 'Density', 'kg/m³', 0), q('m', 'Mass', 'kg', 0), q('V', 'Volume', 'm³', 0)],
    about: 'Mass packed into a volume. Water is 1,000; air is about 1.2.',
    holds: ['Uniform material. For something layered this gives the average.'],
    solve: { rho: (o) => o.m / o.V, m: (o) => o.rho * o.V, V: (o) => o.m / o.rho },
    near: ['pressure', 'hydrostatic', 'buoyancy']
  },
  {
    id: 'youngs-modulus',
    name: "Young's modulus",
    section: 'dynamics',
    written: 'E = (F/A) / (ΔL/L)',
    quantities: [q('E', "Young's modulus", 'Pa', 0), q('F', 'Force', 'N'), q('A', 'Area', 'm²', 0), q('dL', 'Extension', 'm'), q('L', 'Original length', 'm', 0)],
    about: 'How stiff a material is, independent of its shape. Steel is about 200 GPa; rubber is a millionth of that.',
    holds: ['Within the elastic region. Past the yield point the material deforms permanently and this no longer applies.'],
    solve: {
      E: (o) => (o.F / o.A) / (o.dL / o.L),
      F: (o) => (o.E * o.A * o.dL) / o.L,
      A: (o) => (o.F * o.L) / (o.E * o.dL),
      dL: (o) => (o.F * o.L) / (o.E * o.A),
      L: (o) => (o.E * o.A * o.dL) / o.F
    },
    near: ['spring-force', 'pressure']
  }
])

export const formulaFor = (id: string): Formula | null => FORMULAS.find((one) => one.id === id) ?? null

/** The sections that actually have formulas in them. */
export function formulaSections(): readonly { section: Section; formulas: readonly Formula[] }[] {
  return FORMULA_SECTIONS.map((section) => ({
    section,
    formulas: FORMULAS.filter((one) => one.section === section.id)
  })).filter((one) => one.formulas.length > 0)
}

/** Search by name, by what it is about, by the symbols in it, or by the formula as written. */
export function searchFormulas(query: string): readonly Formula[] {
  const asked = query.trim().toLowerCase()
  if (asked === '') return FORMULAS
  const words = asked.split(/\s+/)
  return FORMULAS.filter((one) => {
    const haystack = `${one.name} ${one.about} ${one.written} ${one.section} ${one.id} ${one.quantities
      .map((two) => `${two.symbol} ${two.name} ${two.unit}`)
      .join(' ')}`.toLowerCase()
    return words.every((two) => haystack.includes(two))
  })
}

export interface Solved {
  formula: Formula
  /** What was asked for. */
  symbol: string
  value: number
  unit: string
  name: string
  /** The values used, so the working can be checked. */
  given: Readonly<Record<string, number>>
  /** Said in words, with units. */
  working: string
  /** Set when the answer is mathematically right and physically doubtful. */
  warning?: string
}

/**
 * Work out one quantity from the others.
 *
 * Refuses rather than guesses: a missing rearrangement, a missing value, or a value outside what makes sense each
 * gives a refusal that names the problem and what to do instead.
 */
export function solve(id: string, want: string, given: Readonly<Record<string, number>>): Solved | SimulationError {
  const formula = formulaFor(id)
  if (!formula) {
    return fail('unknown', `There is no formula called "${id}".`, `Search the vault — it has ${FORMULAS.length} formulas across ${formulaSections().length} sections.`)
  }

  const wanted = formula.quantities.find((one) => one.symbol === want)
  if (!wanted) {
    return fail(
      'unknown',
      `"${want}" is not in ${formula.written}.`,
      `Its quantities are ${formula.quantities.map((one) => one.symbol).join(', ')}.`
    )
  }

  const rearrangement = formula.solve[want]
  if (!rearrangement) {
    const can = Object.keys(formula.solve)
    return fail(
      'input',
      `This vault cannot rearrange ${formula.written} for ${want}.`,
      can.length > 0
        ? `It can solve for ${can.join(', ')}. Rearranging for ${want} either has no closed form or has more than one answer, so it is not offered rather than guessed at.`
        : 'No rearrangement of this formula is written down.'
    )
  }

  // Every other quantity must be given, and must be a real number.
  const needed = formula.quantities.filter((one) => one.symbol !== want)
  const missing = needed.filter((one) => !Number.isFinite(given[one.symbol]))
  if (missing.length > 0) {
    return fail(
      'input',
      `Missing ${missing.length === 1 ? 'a value' : 'values'}: ${missing.map((one) => `${one.symbol} (${one.name}${one.unit ? `, in ${one.unit}` : ''})`).join('; ')}.`,
      `To find ${want} from ${formula.written}, every other quantity has to be given.`
    )
  }

  // Values outside what is physically meaningful are refused, not silently used.
  for (const one of needed) {
    const value = given[one.symbol]
    if (one.least !== undefined && value < one.least) {
      return fail('input', `${one.name} cannot be less than ${one.least}${one.unit ? ` ${one.unit}` : ''}, and ${value} was given.`, `Check the value and the units — this formula wants ${one.unit || 'a plain number'}.`)
    }
    if (one.most !== undefined && value > one.most) {
      return fail('input', `${one.name} cannot be more than ${one.most}${one.unit ? ` ${one.unit}` : ''}, and ${value} was given.`, `Check the value and the units — this formula wants ${one.unit || 'a plain number'}.`)
    }
  }

  const answer = rearrangement(given)
  if (!Number.isFinite(answer)) {
    // Saying "a division by zero, or a square root of a negative" when neither happened sends somebody looking in
    // the wrong place. An angle that came back as no number means the sine or cosine needed was above one, and
    // that has a physical meaning worth stating.
    const angle = wanted.unit === '°' || wanted.unit === 'rad'
    if (Number.isNaN(answer) && angle) {
      return fail(
        'input',
        `There is no angle that satisfies ${formula.written} with these values.`,
        'Working back from an angle needs a sine or cosine no greater than one, and these values ask for more than that — so the situation described cannot physically happen, rather than having an answer this cannot find.'
      )
    }
    if (Number.isNaN(answer)) {
      return fail(
        'input',
        `${formula.written} has no real answer for ${want} with these values.`,
        'Something underneath turned negative where it cannot be — usually a square root, which means the values describe something that never happens.'
      )
    }
    return fail(
      'unstable',
      `${formula.written} gave an infinite answer for ${want}.`,
      'A quantity that should have been divided by is zero. Check the value you gave for each one.'
    )
  }

  const used = needed.map((one) => `${one.symbol} = ${given[one.symbol]}${one.unit ? ` ${one.unit}` : ''}`).join(', ')
  const working = `${formula.written} rearranged for ${want}, with ${used}, gives ${want} = ${answer}${wanted.unit ? ` ${wanted.unit}` : ''}.`

  // Right arithmetic, doubtful physics: say so rather than letting it pass as an answer.
  let warning: string | undefined
  if (wanted.least !== undefined && answer < wanted.least) {
    warning = `The arithmetic is right but the answer is below what ${wanted.name} can physically be (${wanted.least}${wanted.unit ? ` ${wanted.unit}` : ''}). Something about the inputs does not describe a real situation.`
  } else if (wanted.most !== undefined && answer > wanted.most) {
    warning = `The arithmetic is right but the answer is above what ${wanted.name} can physically be (${wanted.most}${wanted.unit ? ` ${wanted.unit}` : ''}).`
  }

  return { formula, symbol: want, value: answer, unit: wanted.unit, name: wanted.name, given, working, warning }
}

export const FORMULA_COUNTS = Object.freeze({
  formulas: FORMULAS.length,
  sections: formulaSections().length,
  rearrangements: FORMULAS.reduce((count, one) => count + Object.keys(one.solve).length, 0)
})
