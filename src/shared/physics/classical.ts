import {
  EARTH_G,
  advance,
  pushTrail,
  toRadians,
  type Scene,
  type Simulation
} from './simulation.ts'

/**
 * Classical mechanics: the fourteen things a first course is about.
 *
 * ## Each one answers a question the formula does not
 *
 * The range formula gives a number. What it does not give is what happens when the launch is above the ground, or
 * why forty-five degrees stops being the best angle when it is. The projectile here is integrated rather than
 * solved, so that case comes out right without anybody special-casing it — and the measured range sitting beside
 * the textbook range is the point.
 *
 * ## The pendulum is not a spring, and this says so
 *
 * Almost every treatment quietly replaces sin θ with θ and then calls the result the pendulum. Here the real
 * equation is integrated and the small-angle period is shown beside the measured one, so the error appears as a
 * number that grows with amplitude — about 0.2% at ten degrees and 18% at ninety.
 *
 * ## Chaos is shown, not asserted
 *
 * The double pendulum takes two starting angles a thousandth of a degree apart and runs both. They agree, and then
 * they do not. Nothing else makes sensitive dependence believable.
 *
 * Pure.
 */

// ---------------------------------------------------------------- projectile

interface ProjectileState {
  x: number
  y: number
  vx: number
  vy: number
  t: number
  trail: number[]
  landed: boolean
  highest: number
  range: number
}

export const projectile: Simulation<ProjectileState> = {
  id: 'projectile',
  name: 'Projectile Motion',
  section: 'classical',
  about: 'Launch angle, speed and height, with the trajectory integrated rather than looked up.',
  controls: [
    { key: 'speed', label: 'Launch speed', unit: 'm/s', least: 1, most: 120, step: 1, initial: 30, about: 'How fast it leaves. Range grows with the square of this, so doubling it quadruples the distance.' },
    { key: 'angle', label: 'Launch angle', unit: '°', least: 0, most: 90, step: 1, initial: 45, about: 'Forty-five degrees is furthest from ground level — and is not, once the launch is above the ground.' },
    { key: 'gravity', label: 'Gravity', unit: 'm/s²', least: 0.5, most: 30, step: 0.01, initial: EARTH_G, about: 'Earth is 9.81, the Moon 1.62, Jupiter 24.8. Range is inversely proportional to it.' },
    { key: 'height', label: 'Launch height', unit: 'm', least: 0, most: 200, step: 0.5, initial: 0, about: 'Launching from above the ground is what makes the best angle less than forty-five degrees.' },
    { key: 'drag', label: 'Air resistance', unit: '1/s', least: 0, most: 1, step: 0.005, initial: 0, about: 'Drag proportional to speed. Any at all and the path stops being a parabola and the far side gets steeper.' }
  ],
  readouts: [
    { key: 'x', label: 'Distance', unit: 'm' },
    { key: 'y', label: 'Height', unit: 'm' },
    { key: 'speed', label: 'Speed', unit: 'm/s' },
    { key: 'time', label: 'Time', unit: 's' },
    { key: 'highest', label: 'Highest', unit: 'm' },
    { key: 'range', label: 'Range', unit: 'm' }
  ],
  start(values) {
    const angle = toRadians(values.angle)
    return {
      x: 0,
      y: values.height,
      vx: values.speed * Math.cos(angle),
      vy: values.speed * Math.sin(angle),
      t: 0,
      trail: [0, values.height],
      landed: false,
      highest: values.height,
      range: 0
    }
  },
  step(state, dt, values) {
    if (state.landed) return
    // Drag is taken as proportional to speed, which is right for slow small things and wrong for fast ones —
    // and saying which is in the limits rather than implied by the picture.
    const ax = -values.drag * state.vx
    const ay = -values.gravity - values.drag * state.vy
    state.vx += ax * dt
    state.vy += ay * dt
    state.x += state.vx * dt
    state.y += state.vy * dt
    state.t += dt
    if (state.y > state.highest) state.highest = state.y
    if (state.y <= 0) {
      state.y = 0
      state.landed = true
      state.range = state.x
    }
    pushTrail(state.trail, state.x, state.y)
  },
  read(state) {
    return {
      x: state.x,
      y: state.y,
      speed: Math.hypot(state.vx, state.vy),
      time: state.t,
      highest: state.highest,
      range: state.landed ? state.range : state.x
    }
  },
  paint(state, values): Scene {
    const far = Math.max(20, state.x * 1.2, state.highest * 2)
    return {
      view: [-2, -2, far, Math.max(10, state.highest * 1.4)],
      shapes: [
        { kind: 'grid', spacing: Math.max(5, Math.round(far / 10)) },
        { kind: 'line', from: [-2, 0], to: [far, 0], width: 2 },
        { kind: 'path', points: state.trail, width: 1.6 },
        { kind: 'circle', at: [state.x, state.y], radius: Math.max(0.4, far / 90), fill: true },
        // The velocity, drawn to scale, so the direction turning over at the top is visible.
        { kind: 'arrow', from: [state.x, state.y], to: [state.x + state.vx / 3, state.y + state.vy / 3] }
      ],
      about: state.landed
        ? `Landed ${state.range.toFixed(2)} m away after ${state.t.toFixed(2)} s, having reached ${state.highest.toFixed(2)} m.`
        : `${state.t.toFixed(2)} s — ${state.x.toFixed(1)} m along, ${state.y.toFixed(1)} m up. ${values.drag > 0 ? 'With drag the path is not a parabola.' : 'With no drag the path is exactly a parabola.'}`
    }
  },
  limits: [
    'Drag is taken as proportional to speed, which suits a slow or small object. A fast one is closer to proportional to speed squared, and that is a different curve.',
    'No spin, so there is no Magnus effect and no swing.',
    'Gravity is constant and the ground is flat, both of which stop being true over a long enough range.'
  ]
}

// ---------------------------------------------------------------- pendulum

interface PendulumState {
  angle: number
  rate: number
  t: number
  trail: number[]
  swings: number
  lastSign: number
  measured: number
}

export const pendulum: Simulation<PendulumState> = {
  id: 'pendulum',
  name: 'Simple Pendulum',
  section: 'classical',
  about: 'The real equation, not the small-angle one — so the period grows with amplitude, as it really does.',
  controls: [
    { key: 'length', label: 'Length', unit: 'm', least: 0.1, most: 10, step: 0.05, initial: 1, about: 'The period goes with the square root of this: four times the length is twice the period.' },
    { key: 'angle', label: 'Starting angle', unit: '°', least: 1, most: 179, step: 1, initial: 30, about: 'The small-angle formula is only good while this is small. At 90° it is out by 18%.' },
    { key: 'gravity', label: 'Gravity', unit: 'm/s²', least: 0.5, most: 30, step: 0.01, initial: EARTH_G, about: 'The period goes with one over its square root.' },
    { key: 'damping', label: 'Damping', unit: '1/s', least: 0, most: 2, step: 0.01, initial: 0, about: 'Friction at the pivot. Any at all and the swing dies away.' }
  ],
  readouts: [
    { key: 'angle', label: 'Angle', unit: '°' },
    { key: 'rate', label: 'Angular speed', unit: 'rad/s' },
    { key: 'energy', label: 'Energy', unit: 'J', figures: 6 },
    { key: 'period', label: 'Measured period', unit: 's' },
    { key: 'small', label: 'Small-angle period', unit: 's' },
    { key: 'error', label: 'Difference', unit: '%' }
  ],
  conserves: { key: 'energy', label: 'Energy' },
  start(values) {
    return { angle: toRadians(values.angle), rate: 0, t: 0, trail: [], swings: 0, lastSign: 0, measured: 0 }
  },
  step(state, dt, values) {
    // The real equation: θ'' = −(g/L)·sin θ − b·θ'. Replacing sin θ with θ is the approximation this exists to show.
    const derivative = (one: readonly number[]): number[] => [
      one[1],
      -(values.gravity / values.length) * Math.sin(one[0]) - values.damping * one[1]
    ]
    const [angle, rate] = advance([state.angle, state.rate], derivative, dt, 'rk4')
    const sign = Math.sign(angle)
    // A full period is two sign changes, so the half-swings are counted and halved.
    if (sign !== 0 && state.lastSign !== 0 && sign !== state.lastSign) {
      state.swings += 1
      if (state.swings > 1) state.measured = (state.t * 2) / (state.swings - 1) / 2
    }
    if (sign !== 0) state.lastSign = sign
    state.angle = angle
    state.rate = rate
    state.t += dt
    pushTrail(state.trail, values.length * Math.sin(angle), -values.length * Math.cos(angle))
  },
  read(state, values) {
    const height = values.length * (1 - Math.cos(state.angle))
    const energy = 0.5 * values.length * values.length * state.rate * state.rate + values.gravity * values.length * (1 - Math.cos(state.angle))
    const small = 2 * Math.PI * Math.sqrt(values.length / values.gravity)
    return {
      angle: (state.angle * 180) / Math.PI,
      rate: state.rate,
      energy,
      period: state.measured,
      small,
      error: state.measured > 0 ? ((state.measured - small) / small) * 100 : 0,
      height
    }
  },
  paint(state, values): Scene {
    const x = values.length * Math.sin(state.angle)
    const y = -values.length * Math.cos(state.angle)
    const reach = values.length * 1.3
    return {
      view: [-reach, -reach, reach, reach * 0.35],
      shapes: [
        { kind: 'line', from: [-reach * 0.3, 0], to: [reach * 0.3, 0], width: 2 },
        { kind: 'path', points: state.trail, width: 1, faint: true },
        { kind: 'line', from: [0, 0], to: [x, y], width: 1.5 },
        { kind: 'circle', at: [x, y], radius: values.length / 12, fill: true },
        { kind: 'circle', at: [0, 0], radius: values.length / 40, fill: true }
      ],
      about: `${((state.angle * 180) / Math.PI).toFixed(1)}° from the bottom. The arc is the path, not a decoration.`
    }
  },
  limits: [
    'A point mass on a massless rod. A real pendulum has its mass spread out, which changes the period.',
    'No air resistance unless damping is turned up, and the damping here is proportional to angular speed rather than to speed squared.',
    'The pivot is frictionless and does not move.'
  ]
}

// ---------------------------------------------------------------- double pendulum

interface DoubleState {
  a1: number
  a2: number
  p1: number
  p2: number
  t: number
  trail: number[]
  other: { a1: number; a2: number; p1: number; p2: number }
  otherTrail: number[]
  separation: number
}

export const doublePendulum: Simulation<DoubleState> = {
  id: 'double-pendulum',
  name: 'Double Pendulum',
  section: 'classical',
  about: 'Two of them, started a thousandth of a degree apart. They agree, and then they do not.',
  controls: [
    { key: 'length1', label: 'Upper length', unit: 'm', least: 0.2, most: 3, step: 0.05, initial: 1, about: 'The upper rod.' },
    { key: 'length2', label: 'Lower length', unit: 'm', least: 0.2, most: 3, step: 0.05, initial: 1, about: 'The lower rod.' },
    { key: 'mass1', label: 'Upper mass', unit: 'kg', least: 0.1, most: 10, step: 0.1, initial: 1, about: 'The upper bob.' },
    { key: 'mass2', label: 'Lower mass', unit: 'kg', least: 0.1, most: 10, step: 0.1, initial: 1, about: 'The lower bob.' },
    { key: 'angle1', label: 'Upper angle', unit: '°', least: -180, most: 180, step: 1, initial: 120, about: 'Where the upper rod starts. Small angles behave; large ones do not.' },
    { key: 'angle2', label: 'Lower angle', unit: '°', least: -180, most: 180, step: 1, initial: 90, about: 'Where the lower rod starts.' },
    { key: 'gravity', label: 'Gravity', unit: 'm/s²', least: 0.5, most: 30, step: 0.01, initial: EARTH_G, about: 'Stronger gravity makes everything faster, and the chaos arrive sooner.' },
    { key: 'nudge', label: 'How far apart to start', unit: '°', least: 0.000001, most: 1, step: 0.000001, initial: 0.001, about: 'How much the second pendulum differs at the start. Make it smaller and it only delays the moment they part.' }
  ],
  readouts: [
    { key: 'angle1', label: 'Upper angle', unit: '°' },
    { key: 'angle2', label: 'Lower angle', unit: '°' },
    { key: 'energy', label: 'Energy', unit: 'J', figures: 6 },
    { key: 'separation', label: 'How far apart', unit: 'm', figures: 6 },
    { key: 'time', label: 'Time', unit: 's' }
  ],
  conserves: { key: 'energy', label: 'Energy' },
  suggestedStep: 0.002,
  start(values) {
    const a1 = toRadians(values.angle1)
    const a2 = toRadians(values.angle2)
    return {
      a1,
      a2,
      p1: 0,
      p2: 0,
      t: 0,
      trail: [],
      other: { a1: a1 + toRadians(values.nudge), a2, p1: 0, p2: 0 },
      otherTrail: [],
      separation: 0
    }
  },
  step(state, dt, values) {
    /*
     * The Lagrangian equations, in full. There is no small-angle version of this that is worth anything: the
     * interesting behaviour only exists at large angles, and approximating it away removes the subject.
     */
    const derivative = (one: readonly number[]): number[] => {
      const [a1, a2, w1, w2] = one
      const { length1: l1, length2: l2, mass1: m1, mass2: m2, gravity: g } = values
      const delta = a1 - a2
      const denominator = 2 * m1 + m2 - m2 * Math.cos(2 * delta)
      const d1 =
        (-g * (2 * m1 + m2) * Math.sin(a1) -
          m2 * g * Math.sin(a1 - 2 * a2) -
          2 * Math.sin(delta) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(delta))) /
        (l1 * denominator)
      const d2 =
        (2 * Math.sin(delta) * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(a1) + w2 * w2 * l2 * m2 * Math.cos(delta))) /
        (l2 * denominator)
      return [w1, w2, d1, d2]
    }

    const [a1, a2, p1, p2] = advance([state.a1, state.a2, state.p1, state.p2], derivative, dt, 'rk4')
    state.a1 = a1
    state.a2 = a2
    state.p1 = p1
    state.p2 = p2

    const [b1, b2, q1, q2] = advance([state.other.a1, state.other.a2, state.other.p1, state.other.p2], derivative, dt, 'rk4')
    state.other = { a1: b1, a2: b2, p1: q1, p2: q2 }
    state.t += dt

    const tip = (x1: number, x2: number): [number, number] => [
      values.length1 * Math.sin(x1) + values.length2 * Math.sin(x2),
      -values.length1 * Math.cos(x1) - values.length2 * Math.cos(x2)
    ]
    const [tx, ty] = tip(a1, a2)
    const [ox, oy] = tip(b1, b2)
    state.separation = Math.hypot(tx - ox, ty - oy)
    pushTrail(state.trail, tx, ty, 2000)
    pushTrail(state.otherTrail, ox, oy, 2000)
  },
  read(state, values) {
    const { length1: l1, length2: l2, mass1: m1, mass2: m2, gravity: g } = values
    const y1 = -l1 * Math.cos(state.a1)
    const y2 = y1 - l2 * Math.cos(state.a2)
    const v1 = l1 * state.p1
    const v2sq = l1 * l1 * state.p1 * state.p1 + l2 * l2 * state.p2 * state.p2 + 2 * l1 * l2 * state.p1 * state.p2 * Math.cos(state.a1 - state.a2)
    const energy = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2sq + m1 * g * y1 + m2 * g * y2
    return {
      angle1: (state.a1 * 180) / Math.PI,
      angle2: (state.a2 * 180) / Math.PI,
      energy,
      separation: state.separation,
      time: state.t
    }
  },
  paint(state, values): Scene {
    const reach = (values.length1 + values.length2) * 1.2
    const x1 = values.length1 * Math.sin(state.a1)
    const y1 = -values.length1 * Math.cos(state.a1)
    const x2 = x1 + values.length2 * Math.sin(state.a2)
    const y2 = y1 - values.length2 * Math.cos(state.a2)
    const o1x = values.length1 * Math.sin(state.other.a1)
    const o1y = -values.length1 * Math.cos(state.other.a1)
    const o2x = o1x + values.length2 * Math.sin(state.other.a2)
    const o2y = o1y - values.length2 * Math.cos(state.other.a2)
    return {
      view: [-reach, -reach, reach, reach],
      shapes: [
        { kind: 'path', points: state.otherTrail, width: 1, faint: true, tone: 'other' },
        { kind: 'path', points: state.trail, width: 1.2 },
        { kind: 'line', from: [0, 0], to: [o1x, o1y], width: 1, faint: true, tone: 'other' },
        { kind: 'line', from: [o1x, o1y], to: [o2x, o2y], width: 1, faint: true, tone: 'other' },
        { kind: 'line', from: [0, 0], to: [x1, y1], width: 2 },
        { kind: 'line', from: [x1, y1], to: [x2, y2], width: 2 },
        { kind: 'circle', at: [x1, y1], radius: reach / 30, fill: true },
        { kind: 'circle', at: [x2, y2], radius: reach / 26, fill: true }
      ],
      about:
        state.separation < 0.01
          ? `The two are still ${state.separation.toExponential(2)} m apart — they look like one.`
          : `They are now ${state.separation.toFixed(3)} m apart, from a start ${values.nudge}° different.`
    }
  },
  limits: [
    'Point masses on massless rods, with no friction anywhere.',
    'A small time step matters here more than anywhere else: chaos amplifies the solver’s own error exactly as it amplifies everything else.',
    'The second pendulum is shown to make the sensitivity visible. It is not a separate experiment — both are the same equations.'
  ]
}

// ---------------------------------------------------------------- spring

interface SpringState {
  x: number
  v: number
  t: number
  history: number[]
}

export const springMass: Simulation<SpringState> = {
  id: 'spring-mass',
  name: 'Spring–Mass System',
  section: 'classical',
  about: "Hooke's law integrated, with the energy moving back and forth between the spring and the motion.",
  controls: [
    { key: 'mass', label: 'Mass', unit: 'kg', least: 0.1, most: 20, step: 0.1, initial: 1, about: 'Heavier is slower: the period goes with its square root.' },
    { key: 'stiffness', label: 'Spring constant', unit: 'N/m', least: 0.5, most: 200, step: 0.5, initial: 20, about: 'Stiffer is faster. The period goes with one over its square root.' },
    { key: 'amplitude', label: 'Pulled to', unit: 'm', least: 0.05, most: 3, step: 0.05, initial: 1, about: 'How far it starts from rest. For an ideal spring the period does not depend on this at all.' },
    { key: 'damping', label: 'Damping', unit: 'kg/s', least: 0, most: 20, step: 0.1, initial: 0, about: 'Past the critical value it stops oscillating altogether and just creeps back.' }
  ],
  readouts: [
    { key: 'x', label: 'Displacement', unit: 'm' },
    { key: 'v', label: 'Velocity', unit: 'm/s' },
    { key: 'kinetic', label: 'Kinetic energy', unit: 'J' },
    { key: 'potential', label: 'Spring energy', unit: 'J' },
    { key: 'energy', label: 'Total energy', unit: 'J', figures: 6 },
    { key: 'period', label: 'Period', unit: 's' }
  ],
  conserves: { key: 'energy', label: 'Energy' },
  start(values) {
    return { x: values.amplitude, v: 0, t: 0, history: [] }
  },
  step(state, dt, values) {
    const derivative = (one: readonly number[]): number[] => [
      one[1],
      (-values.stiffness * one[0] - values.damping * one[1]) / values.mass
    ]
    const [x, v] = advance([state.x, state.v], derivative, dt, 'rk4')
    state.x = x
    state.v = v
    state.t += dt
    pushTrail(state.history, state.t, x, 3000)
  },
  read(state, values) {
    const critical = 2 * Math.sqrt(values.stiffness * values.mass)
    return {
      x: state.x,
      v: state.v,
      kinetic: 0.5 * values.mass * state.v * state.v,
      potential: 0.5 * values.stiffness * state.x * state.x,
      energy: 0.5 * values.mass * state.v * state.v + 0.5 * values.stiffness * state.x * state.x,
      period: 2 * Math.PI * Math.sqrt(values.mass / values.stiffness),
      critical,
      damping: values.damping / critical
    }
  },
  paint(state, values): Scene {
    const reach = values.amplitude * 1.6
    // The spring drawn as a zigzag whose length really is the displacement, rather than a picture of a spring.
    const coils = 14
    const points: number[] = [-reach, 0]
    for (let one = 0; one <= coils; one += 1) {
      const along = -reach + ((state.x + reach) * one) / coils
      points.push(along, one % 2 === 0 ? 0.12 : -0.12)
    }
    points.push(state.x, 0)
    return {
      view: [-reach * 1.2, -reach * 0.5, reach * 1.2, reach * 0.5],
      shapes: [
        { kind: 'line', from: [-reach, -0.3], to: [-reach, 0.3], width: 3 },
        { kind: 'path', points, width: 1.4 },
        { kind: 'rect', at: [state.x, -0.18], width: 0.36, height: 0.36, fill: true },
        { kind: 'line', from: [0, -0.4], to: [0, 0.4], width: 1, faint: true },
        { kind: 'arrow', from: [state.x, 0.5], to: [state.x + state.v / 5, 0.5] }
      ],
      about: `${state.x >= 0 ? state.x.toFixed(3) : state.x.toFixed(3)} m from rest. The line down the middle is where the spring is unstretched.`
    }
  },
  limits: [
    'An ideal spring: the force is exactly proportional to the stretch, however far it is stretched. A real spring stops obeying that and eventually stays bent.',
    'The mass of the spring itself is ignored, which lowers the real period slightly.',
    'Damping is proportional to speed, which models a dashpot rather than dry friction.'
  ]
}

// ---------------------------------------------------------------- collision

interface CollisionState {
  x1: number
  v1: number
  x2: number
  v2: number
  t: number
  hit: boolean
  before: { p: number; e: number }
  after: { p: number; e: number } | null
}

export const collision: Simulation<CollisionState> = {
  id: 'collision',
  name: 'Collision',
  section: 'classical',
  about: 'Two bodies meeting, with momentum and energy counted before and after.',
  controls: [
    { key: 'mass1', label: 'Left mass', unit: 'kg', least: 0.1, most: 20, step: 0.1, initial: 2, about: 'The body coming from the left.' },
    { key: 'speed1', label: 'Left speed', unit: 'm/s', least: -20, most: 20, step: 0.1, initial: 4, about: 'Positive is to the right.' },
    { key: 'mass2', label: 'Right mass', unit: 'kg', least: 0.1, most: 20, step: 0.1, initial: 1, about: 'The body on the right.' },
    { key: 'speed2', label: 'Right speed', unit: 'm/s', least: -20, most: 20, step: 0.1, initial: -2, about: 'Negative is to the left.' },
    { key: 'restitution', label: 'Bounciness', unit: '', least: 0, most: 1, step: 0.01, initial: 1, about: '1 is perfectly elastic and keeps all the energy. 0 means they stick together. Momentum is conserved either way, and that is the point.' }
  ],
  readouts: [
    { key: 'v1', label: 'Left velocity', unit: 'm/s' },
    { key: 'v2', label: 'Right velocity', unit: 'm/s' },
    { key: 'momentum', label: 'Total momentum', unit: 'kg m/s', figures: 6 },
    { key: 'energy', label: 'Total energy', unit: 'J' },
    { key: 'lost', label: 'Energy lost', unit: '%' }
  ],
  conserves: { key: 'momentum', label: 'Momentum' },
  start(values) {
    const p = values.mass1 * values.speed1 + values.mass2 * values.speed2
    const e = 0.5 * values.mass1 * values.speed1 ** 2 + 0.5 * values.mass2 * values.speed2 ** 2
    return { x1: -5, v1: values.speed1, x2: 5, v2: values.speed2, t: 0, hit: false, before: { p, e }, after: null }
  },
  step(state, dt, values) {
    state.x1 += state.v1 * dt
    state.x2 += state.v2 * dt
    state.t += dt

    // They meet when the gap closes. Resolved once, with the coefficient of restitution.
    if (!state.hit && state.x2 - state.x1 <= 1 && state.v1 > state.v2) {
      const { mass1: m1, mass2: m2, restitution: e } = values
      const u1 = state.v1
      const u2 = state.v2
      // From conservation of momentum together with the restitution rule, which defines the separation speed.
      state.v1 = (m1 * u1 + m2 * u2 + m2 * e * (u2 - u1)) / (m1 + m2)
      state.v2 = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / (m1 + m2)
      state.hit = true
      state.after = {
        p: m1 * state.v1 + m2 * state.v2,
        e: 0.5 * m1 * state.v1 ** 2 + 0.5 * m2 * state.v2 ** 2
      }
    }
  },
  read(state, values) {
    const p = values.mass1 * state.v1 + values.mass2 * state.v2
    const e = 0.5 * values.mass1 * state.v1 ** 2 + 0.5 * values.mass2 * state.v2 ** 2
    return {
      v1: state.v1,
      v2: state.v2,
      momentum: p,
      energy: e,
      lost: state.before.e > 0 ? ((state.before.e - e) / state.before.e) * 100 : 0
    }
  },
  paint(state, values): Scene {
    const size1 = 0.3 + values.mass1 / 12
    const size2 = 0.3 + values.mass2 / 12
    return {
      view: [-14, -3, 14, 3],
      shapes: [
        { kind: 'line', from: [-14, -1], to: [14, -1], width: 2 },
        { kind: 'rect', at: [state.x1 - size1 / 2, -1], width: size1, height: size1, fill: true },
        { kind: 'rect', at: [state.x2 - size2 / 2, -1], width: size2, height: size2, fill: true },
        { kind: 'arrow', from: [state.x1, size1 - 0.4], to: [state.x1 + state.v1 / 2, size1 - 0.4] },
        { kind: 'arrow', from: [state.x2, size2 - 0.4], to: [state.x2 + state.v2 / 2, size2 - 0.4] },
        { kind: 'text', at: [state.x1, -1.6], text: `${values.mass1} kg`, anchor: 'middle', size: 11 },
        { kind: 'text', at: [state.x2, -1.6], text: `${values.mass2} kg`, anchor: 'middle', size: 11 }
      ],
      about: state.hit
        ? `They have met. Momentum ${state.before.p.toFixed(3)} before and ${(values.mass1 * state.v1 + values.mass2 * state.v2).toFixed(3)} after — the same, whatever the bounciness.`
        : 'Closing. Watch the momentum before and after: it does not change even when the energy does.'
    }
  },
  limits: [
    'One dimension. Two bodies meeting off-centre in two dimensions is a different and harder problem.',
    'The collision happens in an instant. Real contact takes time and the force during it is what actually breaks things.',
    'The bodies are drawn with a size but treated as points when they meet.'
  ]
}

// ---------------------------------------------------------------- circular motion

interface CircularState {
  angle: number
  t: number
  trail: number[]
}

export const circularMotion: Simulation<CircularState> = {
  id: 'circular-motion',
  name: 'Circular Motion',
  section: 'classical',
  about: 'Going round at a steady speed is accelerating, and the arrows show why.',
  controls: [
    { key: 'radius', label: 'Radius', unit: 'm', least: 0.2, most: 10, step: 0.1, initial: 2, about: 'A wider circle at the same speed needs less force.' },
    { key: 'speed', label: 'Speed', unit: 'm/s', least: 0.1, most: 30, step: 0.1, initial: 4, about: 'The force needed goes with the square of this.' },
    { key: 'mass', label: 'Mass', unit: 'kg', least: 0.1, most: 20, step: 0.1, initial: 1, about: 'The force needed is proportional to it.' }
  ],
  readouts: [
    { key: 'angle', label: 'Angle', unit: '°' },
    { key: 'omega', label: 'Angular speed', unit: 'rad/s' },
    { key: 'acceleration', label: 'Acceleration', unit: 'm/s²' },
    { key: 'force', label: 'Centripetal force', unit: 'N' },
    { key: 'period', label: 'Period', unit: 's' }
  ],
  start() {
    return { angle: 0, t: 0, trail: [] }
  },
  step(state, dt, values) {
    state.angle += (values.speed / values.radius) * dt
    state.t += dt
    pushTrail(state.trail, values.radius * Math.cos(state.angle), values.radius * Math.sin(state.angle), 400)
  },
  read(state, values) {
    const omega = values.speed / values.radius
    return {
      angle: ((state.angle * 180) / Math.PI) % 360,
      omega,
      acceleration: (values.speed * values.speed) / values.radius,
      force: (values.mass * values.speed * values.speed) / values.radius,
      period: (2 * Math.PI * values.radius) / values.speed
    }
  },
  paint(state, values): Scene {
    const r = values.radius
    const x = r * Math.cos(state.angle)
    const y = r * Math.sin(state.angle)
    // Velocity is along the tangent; acceleration points at the centre. Drawn to scale against each other.
    const vx = -values.speed * Math.sin(state.angle)
    const vy = values.speed * Math.cos(state.angle)
    const a = (values.speed * values.speed) / r
    return {
      view: [-r * 1.6, -r * 1.6, r * 1.6, r * 1.6],
      shapes: [
        { kind: 'circle', at: [0, 0], radius: r, fill: false, tone: 'faint' },
        { kind: 'line', from: [0, 0], to: [x, y], width: 1, faint: true },
        { kind: 'circle', at: [x, y], radius: r / 14, fill: true },
        { kind: 'arrow', from: [x, y], to: [x + vx / 4, y + vy / 4] },
        { kind: 'arrow', from: [x, y], to: [x - (x / r) * (a / 8), y - (y / r) * (a / 8)], tone: 'other' },
        { kind: 'text', at: [x + vx / 4, y + vy / 4], text: 'v', size: 12 },
        { kind: 'text', at: [x - (x / r) * (a / 8), y - (y / r) * (a / 8)], text: 'a', size: 12, tone: 'other' }
      ],
      about: 'The speed never changes and the velocity always does — that is why there is an acceleration, and it points at the centre.'
    }
  },
  limits: [
    'The speed is held constant rather than being the result of a force, so this shows what circular motion requires rather than what produces it.',
    'No gravity and no friction.'
  ]
}

export const CLASSICAL: readonly Simulation[] = Object.freeze([
  projectile as Simulation,
  pendulum as Simulation,
  doublePendulum as Simulation,
  springMass as Simulation,
  collision as Simulation,
  circularMotion as Simulation
])
