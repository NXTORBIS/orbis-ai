import { COULOMB, MU0, pushTrail, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Electromagnetism: circuits that charge and ring, fields drawn from the law rather than sketched, and the
 * machines that come out of a force at right angles to the motion.
 *
 * ## The circuits are integrated, not plotted
 *
 * An exponential charging curve is one line of arithmetic. Stepping the differential equation instead is what
 * makes the RLC circuit able to overshoot, ring and settle without being told to, and what makes it possible to
 * watch a circuit cross from ringing into creeping as one resistance is turned up.
 *
 * ## The fields are summed over the sources
 *
 * Every arrow is the vector sum over every wire or charge present. Nothing is drawn from a picture of what a
 * field "looks like", which is why adding a second wire changes the shape correctly instead of drawing two
 * separate pictures on top of each other.
 */

// ——— RLC: the circuit that can ring ————————————————————————————————————————

interface RlcState {
  charge: number
  current: number
  t: number
  trail: number[]
  currentTrail: number[]
  peak: number
  crossings: number
  wasPositive: boolean
}

export const rlcCircuit: Simulation<RlcState> = {
  id: 'rlc-circuit',
  name: 'RLC circuit',
  section: 'em',
  about: 'A resistor, coil and capacitor together — stepped, so it rings or creeps on its own depending on the damping.',
  controls: [
    { key: 'resistance', label: 'Resistance', unit: 'Ω', least: 0, most: 400, step: 1, initial: 20, about: 'What drains the energy. Below the critical value it rings; above it, it creeps back without ever crossing zero.' },
    { key: 'inductance', label: 'Inductance', unit: 'mH', least: 0.1, most: 500, step: 0.1, initial: 100, about: 'The coil resists change in current, which is what lets the circuit overshoot rather than stopping.' },
    { key: 'capacitance', label: 'Capacitance', unit: 'µF', least: 0.1, most: 500, step: 0.1, initial: 10, about: 'What stores the charge. With the inductance it sets the frequency it rings at.' },
    { key: 'voltage', label: 'Supply voltage', unit: 'V', least: 0, most: 50, step: 0.5, initial: 10, about: 'Switched on at the start. At zero the circuit simply discharges what it was given.' },
    { key: 'startCharge', label: 'Charge to start with', unit: 'µC', least: 0, most: 500, step: 1, initial: 0, about: 'Put charge on the capacitor before the switch closes, to watch it discharge rather than charge.' },
    { key: 'window', label: 'Seconds shown', unit: 's', least: 0.002, most: 2, step: 0.002, initial: 0.05, about: 'How much of the trace to keep on screen.' }
  ],
  readouts: [
    { key: 'voltageNow', label: 'Capacitor voltage', unit: 'V', figures: 4 },
    { key: 'currentNow', label: 'Current', unit: 'mA', figures: 4 },
    { key: 'energy', label: 'Energy stored', unit: 'µJ', figures: 5 },
    { key: 'naturalFrequency', label: 'Rings at', unit: 'Hz' },
    { key: 'criticalResistance', label: 'Critical resistance', unit: 'Ω' },
    { key: 'quality', label: 'Q factor', unit: '', figures: 4 },
    { key: 'swings', label: 'Swings so far', unit: '' }
  ],
  suggestedStep: 0.00001,
  start(values) {
    return {
      charge: values.startCharge * 1e-6,
      current: 0,
      t: 0,
      trail: [],
      currentTrail: [],
      peak: 0,
      crossings: 0,
      wasPositive: true
    }
  },
  step(state, dt, values) {
    const L = values.inductance * 1e-3
    const C = values.capacitance * 1e-6
    const R = values.resistance

    // L·q'' + R·q' + q/C = V, stepped as two first-order equations by midpoint, which stays stable where a
    // plain Euler step would gain energy and ring for ever on its own.
    const rate = (charge: number, current: number): number => (values.voltage - (charge / C) - R * current) / L

    const k1v = rate(state.charge, state.current)
    const k1q = state.current
    const k2v = rate(state.charge + (dt / 2) * k1q, state.current + (dt / 2) * k1v)
    const k2q = state.current + (dt / 2) * k1v
    const k3v = rate(state.charge + (dt / 2) * k2q, state.current + (dt / 2) * k2v)
    const k3q = state.current + (dt / 2) * k2v
    const k4v = rate(state.charge + dt * k3q, state.current + dt * k3v)
    const k4q = state.current + dt * k3v

    state.charge += (dt / 6) * (k1q + 2 * k2q + 2 * k3q + k4q)
    state.current += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
    state.t += dt

    const across = state.charge / C
    pushTrail(state.trail, state.t, across, 4000)
    pushTrail(state.currentTrail, state.t, state.current, 4000)
    if (Math.abs(across) > state.peak) state.peak = Math.abs(across)

    // A swing is counted when the current changes sign — that is what "ringing" means, not merely wobbling.
    const positive = state.current >= 0
    if (positive !== state.wasPositive) {
      state.crossings += 1
      state.wasPositive = positive
    }
  },
  read(state, values) {
    const L = values.inductance * 1e-3
    const C = values.capacitance * 1e-6
    const across = state.charge / C
    const natural = 1 / (2 * Math.PI * Math.sqrt(L * C))
    const critical = 2 * Math.sqrt(L / C)
    return {
      voltageNow: across,
      currentNow: state.current * 1000,
      energy: (0.5 * C * across * across + 0.5 * L * state.current * state.current) * 1e6,
      naturalFrequency: natural,
      criticalResistance: critical,
      // Q below a half means it cannot ring at all, however long you wait.
      quality: values.resistance > 0 ? (1 / values.resistance) * Math.sqrt(L / C) : Number.MAX_SAFE_INTEGER / 2,
      swings: state.crossings
    }
  },
  paint(state, values): Scene {
    const from = Math.max(0, state.t - values.window)
    const volts: number[] = []
    for (let one = 0; one < state.trail.length; one += 2) {
      if (state.trail[one] >= from) volts.push(state.trail[one], state.trail[one + 1])
    }
    const tall = Math.max(state.peak, values.voltage, 1) * 1.25
    const critical = 2 * Math.sqrt((values.inductance * 1e-3) / (values.capacitance * 1e-6))

    const shapes: Shape[] = [
      { kind: 'line', from: [from, 0], to: [from + values.window, 0], width: 1, faint: true },
      { kind: 'path', points: volts, width: 1.8 }
    ]
    if (values.voltage > 0) {
      shapes.push({ kind: 'line', from: [from, values.voltage], to: [from + values.window, values.voltage], width: 1, faint: true, tone: 'other' })
      shapes.push({ kind: 'text', at: [from + values.window, values.voltage + tall * 0.04], text: 'supply', size: 10, anchor: 'end', tone: 'other' })
    }
    return {
      view: [from, -tall, values.window, 2 * tall],
      shapes,
      about:
        values.resistance < critical
          ? `Underdamped: ${values.resistance.toFixed(0)} Ω is below the ${critical.toFixed(0)} Ω that would stop it, so it overshoots and rings at ${(1 / (2 * Math.PI * Math.sqrt(values.inductance * 1e-3 * values.capacitance * 1e-6))).toFixed(0)} Hz.`
          : values.resistance > critical
            ? `Overdamped: ${values.resistance.toFixed(0)} Ω is above the critical ${critical.toFixed(0)} Ω, so it creeps to its value and never crosses it.`
            : 'Critically damped: the fastest it can settle without overshooting at all.'
    }
  },
  limits: [
    'Ideal components. A real coil has resistance of its own and a real capacitor leaks, so a real circuit always damps more than this.',
    'Lumped elements: everything happens everywhere at once. Above a few hundred MHz the wires themselves become part of the circuit.',
    'Linear and unsaturated. An iron-cored inductor pushed hard loses its inductance, and this would not show that.'
  ]
}

// ——— Charging a capacitor ———————————————————————————————————————————————————

interface RcState {
  charge: number
  t: number
  trail: number[]
  reached63: number
  reached99: number
}

export const rcCharging: Simulation<RcState> = {
  id: 'rc-charging',
  name: 'Charging a capacitor',
  section: 'em',
  about: 'The exponential everything electronic is timed by, stepped out and marked at the time constant.',
  controls: [
    { key: 'resistance', label: 'Resistance', unit: 'kΩ', least: 0.1, most: 1000, step: 0.1, initial: 10, about: 'What limits the current. Bigger means slower.' },
    { key: 'capacitance', label: 'Capacitance', unit: 'µF', least: 0.1, most: 1000, step: 0.1, initial: 100, about: 'How much charge it holds per volt. Bigger means slower.' },
    { key: 'voltage', label: 'Supply', unit: 'V', least: 0.5, most: 24, step: 0.5, initial: 5, about: 'What it charges towards. It never quite gets there.' },
    { key: 'discharging', label: 'Discharging instead', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Start full and let it empty, which falls through the same curve upside down.' }
  ],
  readouts: [
    { key: 'voltageNow', label: 'Voltage', unit: 'V', figures: 5 },
    { key: 'currentNow', label: 'Current', unit: 'µA', figures: 4 },
    { key: 'fraction', label: 'Fraction of the way', unit: '', figures: 5 },
    { key: 'timeConstant', label: 'Time constant', unit: 's', figures: 5 },
    { key: 'constantsElapsed', label: 'Time constants gone by', unit: '', figures: 3 },
    { key: 'energy', label: 'Energy stored', unit: 'mJ', figures: 5 }
  ],
  suggestedStep: 0.0005,
  start(values) {
    const C = values.capacitance * 1e-6
    return {
      charge: Math.round(values.discharging) === 1 ? values.voltage * C : 0,
      t: 0,
      trail: [],
      reached63: 0,
      reached99: 0
    }
  },
  step(state, dt, values) {
    const R = values.resistance * 1e3
    const C = values.capacitance * 1e-6
    const target = Math.round(values.discharging) === 1 ? 0 : values.voltage
    // dq/dt = (V − q/C) / R, by midpoint.
    const rate = (q: number): number => (target - q / C) / R
    const k1 = rate(state.charge)
    const k2 = rate(state.charge + (dt / 2) * k1)
    const k3 = rate(state.charge + (dt / 2) * k2)
    const k4 = rate(state.charge + dt * k3)
    state.charge += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
    state.t += dt
    pushTrail(state.trail, state.t, state.charge / C, 4000)
  },
  read(state, values) {
    const R = values.resistance * 1e3
    const C = values.capacitance * 1e-6
    const across = state.charge / C
    const tau = R * C
    const target = Math.round(values.discharging) === 1 ? 0 : values.voltage
    const start = Math.round(values.discharging) === 1 ? values.voltage : 0
    const span = target - start
    return {
      voltageNow: across,
      currentNow: ((target - across) / R) * 1e6,
      fraction: span === 0 ? 1 : (across - start) / span,
      timeConstant: tau,
      constantsElapsed: state.t / tau,
      energy: 0.5 * C * across * across * 1000
    }
  },
  paint(state, values): Scene {
    const tau = values.resistance * 1e3 * values.capacitance * 1e-6
    const window = tau * 5.5
    const points: number[] = []
    for (let one = 0; one < state.trail.length; one += 2) points.push(state.trail[one], state.trail[one + 1])
    const shapes: Shape[] = [
      { kind: 'line', from: [0, 0], to: [window, 0], width: 1, faint: true },
      { kind: 'line', from: [0, values.voltage], to: [window, values.voltage], width: 1, faint: true, tone: 'other' },
      { kind: 'path', points, width: 1.8 }
    ]
    // The time constants marked, because "63% in one of them" is the fact worth taking away.
    for (let one = 1; one <= 5; one += 1) {
      shapes.push({ kind: 'line', from: [one * tau, 0], to: [one * tau, values.voltage], width: 1, faint: true })
      shapes.push({ kind: 'text', at: [one * tau, -values.voltage * 0.06], text: `${one}τ`, size: 10, anchor: 'middle', tone: 'faint' })
    }
    const charging = Math.round(values.discharging) !== 1
    const at63 = charging ? values.voltage * 0.632 : values.voltage * 0.368
    shapes.push({ kind: 'circle', at: [tau, at63], radius: values.voltage * 0.02, fill: true, tone: 'other' })

    return {
      view: [-tau * 0.1, -values.voltage * 0.15, window + tau * 0.2, values.voltage * 1.3],
      shapes,
      about: charging
        ? `One time constant (${tau.toFixed(4)} s) gets it 63.2% of the way. Five gets it to 99.3%, and it never actually arrives.`
        : `One time constant (${tau.toFixed(4)} s) leaves 36.8% behind. The same curve, falling.`
    }
  },
  limits: [
    'Ideal components, and a supply that can deliver whatever current is asked of it.',
    'A real capacitor leaks, so left alone for long enough it discharges itself whatever the circuit does.',
    'The curve is exponential for ever in theory. In practice it reaches the noise floor after five or six time constants and nothing more can be measured.'
  ]
}

// ——— The field around current-carrying wires ————————————————————————————————

interface WireState {
  t: number
  biggest: number
}

export const magneticField: Simulation<WireState> = {
  id: 'magnetic-field',
  name: 'Field around wires',
  section: 'em',
  about: 'The magnetic field of one, two or many wires, summed at every point — so two wires give the right shape, not two pictures.',
  controls: [
    { key: 'wires', label: 'How many wires', unit: '', least: 1, most: 12, step: 1, initial: 2, about: 'One gives circles. Two the same way give a field that cancels between them; two opposed crowd it between them.' },
    { key: 'current', label: 'Current in each', unit: 'A', least: 0.1, most: 100, step: 0.1, initial: 10, about: 'The field is proportional to it, and falls as one over the distance — not one over the distance squared.' },
    { key: 'separation', label: 'Separation', unit: 'cm', least: 1, most: 20, step: 0.5, initial: 6, about: 'How far apart the wires sit.' },
    { key: 'opposed', label: 'Opposite directions', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Same way and the wires attract, which is how the amp used to be defined. Opposite and they push apart.' },
    { key: 'grid', label: 'Arrows across', unit: '', least: 6, most: 30, step: 1, initial: 17, about: 'How finely the field is sampled.' }
  ],
  readouts: [
    { key: 'biggest', label: 'Strongest sampled', unit: 'µT', figures: 4 },
    { key: 'atMiddle', label: 'Field at the middle', unit: 'µT', figures: 5 },
    { key: 'forcePerMetre', label: 'Force between', unit: 'µN/m', figures: 4 },
    { key: 'attracting', label: 'Attracting', unit: '' },
    { key: 'atOneCm', label: 'One cm from a wire', unit: 'µT', figures: 4 }
  ],
  suggestedStep: 0.02,
  start() {
    return { t: 0, biggest: 0 }
  },
  step(state, dt) {
    state.t += dt
  },
  read(state, values) {
    const count = Math.max(1, Math.round(values.wires))
    const d = values.separation / 100
    const I = values.current
    // Two parallel wires: F/L = µ₀I₁I₂ / 2πd.
    const force = count >= 2 ? (MU0 * I * I) / (2 * Math.PI * d) : 0

    // At the midpoint of two wires carrying the same way, the two fields are opposite and cancel exactly.
    let middle = 0
    if (count === 2) middle = Math.round(values.opposed) === 1 ? (2 * MU0 * I) / (2 * Math.PI * (d / 2)) : 0

    return {
      biggest: state.biggest * 1e6,
      atMiddle: middle * 1e6,
      forcePerMetre: force * 1e6,
      attracting: Math.round(values.opposed) === 1 ? 0 : 1,
      atOneCm: ((MU0 * I) / (2 * Math.PI * 0.01)) * 1e6
    }
  },
  paint(state, values): Scene {
    const count = Math.max(1, Math.round(values.wires))
    const d = values.separation / 100
    const span = Math.max(d * (count + 1), 0.08)
    const across = Math.max(6, Math.round(values.grid))
    const shapes: Shape[] = []

    const wires: { x: number; y: number; sign: number }[] = []
    for (let one = 0; one < count; one += 1) {
      const x = count === 1 ? 0 : (one - (count - 1) / 2) * d
      const sign = Math.round(values.opposed) === 1 && one % 2 === 1 ? -1 : 1
      wires.push({ x, y: 0, sign })
    }

    // The field at every sample point, summed over every wire. B = µ₀I/2πr, perpendicular to the radius.
    let biggest = 0
    const samples: { x: number; y: number; bx: number; by: number; size: number }[] = []
    for (let row = 0; row < across; row += 1) {
      for (let col = 0; col < across; col += 1) {
        const x = (col / (across - 1) - 0.5) * span * 2
        const y = (row / (across - 1) - 0.5) * span * 2
        let bx = 0
        let by = 0
        let tooClose = false
        for (const wire of wires) {
          const dx = x - wire.x
          const dy = y - wire.y
          const r2 = dx * dx + dy * dy
          const r = Math.sqrt(r2)
          if (r < span * 0.06) { tooClose = true; break }
          const b = (MU0 * values.current * wire.sign) / (2 * Math.PI * r)
          // Perpendicular to the radius: the field curls round the wire.
          bx += (-dy / r) * b
          by += (dx / r) * b
        }
        if (tooClose) continue
        const size = Math.hypot(bx, by)
        if (size > biggest) biggest = size
        samples.push({ x, y, bx, by, size })
      }
    }
    state.biggest = biggest

    for (const one of samples) {
      if (one.size <= 0) continue
      // Length by the logarithm of the strength: linear and the near arrows swamp everything else.
      const scale = (Math.log10(1 + one.size / (biggest || 1) * 999) / 3) * span * 0.16
      shapes.push({
        kind: 'arrow',
        from: [one.x, one.y],
        to: [one.x + (one.bx / one.size) * scale, one.y + (one.by / one.size) * scale],
        head: span * 0.03,
        tone: 'faint'
      })
    }

    for (const wire of wires) {
      shapes.push({ kind: 'circle', at: [wire.x, wire.y], radius: span * 0.05, fill: true })
      // A dot is current coming out at you; a cross is going in.
      shapes.push({
        kind: 'text',
        at: [wire.x, wire.y - span * 0.12],
        text: wire.sign > 0 ? '⊙' : '⊗',
        size: 13,
        anchor: 'middle',
        tone: 'other'
      })
    }

    return {
      view: [-span, -span, 2 * span, 2 * span],
      shapes,
      about:
        count === 1
          ? 'One wire: the field is circles round it, falling as one over the distance.'
          : Math.round(values.opposed) === 1
            ? 'Opposite directions: the field piles up between the wires, and they push apart.'
            : 'The same direction: the field cancels on the line between them, and the wires pull together.'
    }
  },
  limits: [
    'Infinitely long straight wires. A real coil or a wire of any finite length has end effects this cannot show.',
    'Steady currents. A changing current radiates, and none of that appears here.',
    'The wires are drawn with width but treated as having none, so arrows very close to one are left out rather than drawn wrong.',
    'No material anywhere. Iron nearby would multiply the field by hundreds and change the shape entirely.'
  ]
}

// ——— A charge in crossed fields: the machines ————————————————————————————————

interface SelectorState {
  x: number
  y: number
  vx: number
  vy: number
  t: number
  trail: number[]
  gone: boolean
}

export const massSpectrometer: Simulation<SelectorState> = {
  id: 'mass-spectrometer',
  name: 'Velocity selector and mass spectrometer',
  section: 'em',
  about: 'Electric and magnetic fields at right angles — the arrangement that picks one speed out and then sorts by mass.',
  controls: [
    { key: 'speed', label: 'Entry speed', unit: 'km/s', least: 1, most: 2000, step: 1, initial: 300, about: 'Only one speed goes straight through: the one where the two forces cancel exactly.' },
    { key: 'electric', label: 'Electric field', unit: 'kV/m', least: 0, most: 500, step: 1, initial: 100, about: 'Pushes the charge one way, whatever its speed.' },
    { key: 'magnetic', label: 'Magnetic field', unit: 'mT', least: 1, most: 500, step: 1, initial: 300, about: 'Pushes it the other way, in proportion to its speed. That is why only one speed survives.' },
    { key: 'mass', label: 'Mass', unit: 'u', least: 1, most: 250, step: 1, initial: 20, about: 'Once past the selector, the radius of the curve depends on this — which is how isotopes are told apart.' },
    { key: 'charge', label: 'Charge', unit: 'e', least: 1, most: 5, step: 1, initial: 1, about: 'More charge means a tighter curve, and the instrument really measures mass over charge.' },
    { key: 'selectorLength', label: 'Selector length', unit: 'cm', least: 1, most: 30, step: 1, initial: 10, about: 'How far the two fields overlap. Past it only the magnetic field acts.' },
    { key: 'slowdown', label: 'Slowed down by', unit: '×', least: 1e4, most: 1e9, step: 1e4, initial: 2e6, about: 'The whole flight takes under a microsecond, which is not something anybody can watch. One second here is one second divided by this much of real time. Nothing else is changed.' }
  ],
  readouts: [
    { key: 'selectedSpeed', label: 'Speed that goes straight', unit: 'km/s' },
    { key: 'drift', label: 'Sideways drift in the selector', unit: 'mm', figures: 4 },
    { key: 'radius', label: 'Radius after it', unit: 'cm', figures: 4 },
    { key: 'landsAt', label: 'Lands at', unit: 'cm', figures: 4 },
    { key: 'massOverCharge', label: 'Mass over charge', unit: 'u/e', figures: 4 },
    { key: 'cyclotronFrequency', label: 'Cyclotron frequency', unit: 'MHz', figures: 4 },
    { key: 'nanoseconds', label: 'Real time gone by', unit: 'ns', figures: 4 }
  ],
  suggestedStep: 0.0005,
  start(values) {
    return { x: 0, y: 0, vx: values.speed * 1000, vy: 0, t: 0, trail: [0, 0], gone: false }
  },
  step(state, watched, values) {
    if (state.gone) return
    // Watch seconds in, real seconds out. Everything below is in real seconds, so the physics is untouched.
    const dt = watched / Math.max(1, values.slowdown)
    const q = values.charge * 1.602176634e-19
    const m = values.mass * 1.66053906660e-27
    const E = values.electric * 1000
    const B = values.magnetic * 1e-3
    const inside = state.x < values.selectorLength / 100

    // F = q(E + v × B). In two dimensions with B out of the page, v × B is (vy·B, −vx·B).
    const force = (vx: number, vy: number, within: boolean): [number, number] => [
      (q * (vy * B)) / m,
      (q * ((within ? E : 0) - vx * B)) / m
    ]

    const [ax1, ay1] = force(state.vx, state.vy, inside)
    const vx2 = state.vx + (dt / 2) * ax1
    const vy2 = state.vy + (dt / 2) * ay1
    const [ax2, ay2] = force(vx2, vy2, inside)

    state.x += dt * vx2
    state.y += dt * vy2
    state.vx += dt * ax2
    state.vy += dt * ay2
    state.t += dt

    pushTrail(state.trail, state.x, state.y, 4000)
    if (Math.abs(state.y) > 1 || state.x > 1 || state.x < -1) state.gone = true
  },
  read(state, values) {
    const q = values.charge * 1.602176634e-19
    const m = values.mass * 1.66053906660e-27
    const E = values.electric * 1000
    const B = values.magnetic * 1e-3
    // qE = qvB, so v = E/B. The charge cancels out entirely, which is the elegance of it.
    const selected = B > 0 ? E / B : 0
    const speed = Math.hypot(state.vx, state.vy)
    const radius = B > 0 ? (m * speed) / (q * B) : 0
    return {
      selectedSpeed: selected / 1000,
      drift: state.y * 1000,
      radius: radius * 100,
      landsAt: radius * 2 * 100,
      massOverCharge: values.mass / values.charge,
      cyclotronFrequency: (q * B) / (2 * Math.PI * m) / 1e6,
      nanoseconds: state.t * 1e9
    }
  },
  paint(state, values): Scene {
    const selector = values.selectorLength / 100
    const q = values.charge * 1.602176634e-19
    const m = values.mass * 1.66053906660e-27
    const B = values.magnetic * 1e-3
    const radius = B > 0 ? (m * (values.speed * 1000)) / (q * B) : 0.1
    const span = Math.max(selector * 2, radius * 2.6, 0.02)

    const shapes: Shape[] = [
      { kind: 'rect', at: [selector / 2, 0], width: selector, height: span * 0.5, tone: 'faint' },
      { kind: 'text', at: [selector / 2, span * 0.28], text: 'E and B', size: 10, anchor: 'middle', tone: 'faint' },
      { kind: 'line', from: [-span * 0.05, 0], to: [span, 0], width: 1, faint: true },
      { kind: 'path', points: [...state.trail], width: 1.8 },
      { kind: 'circle', at: [state.x, state.y], radius: span * 0.015, fill: true, tone: 'other' }
    ]
    const selected = B > 0 ? (values.electric * 1000) / B : 0
    return {
      view: [-span * 0.08, -span * 0.55, span * 1.1, span * 1.1],
      shapes,
      about: `Only ${(selected / 1000).toFixed(0)} km/s goes straight through the selector — the charge cancels, so it is the same for every ion. Past it, the radius is ${(radius * 100).toFixed(2)} cm, and that does depend on the mass.`
    }
  },
  limits: [
    'One ion at a time, with nothing between them. A real beam spreads under its own charge.',
    'Uniform fields with sharp edges. Real fields fringe at the ends, which blurs the focus.',
    'Non-relativistic. Above a few per cent of light speed the mass term needs the Lorentz factor.',
    'No collisions, so this assumes a vacuum good enough that the ion reaches the detector.'
  ]
}

// ——— Gauss's law ———————————————————————————————————————————————————————————

interface GaussState {
  t: number
  flux: number
  enclosed: number
}

export const gaussLaw: Simulation<GaussState> = {
  id: 'gauss-law',
  name: "Gauss's law",
  section: 'em',
  about: 'The flux counted through a surface, numerically — and the shape of the surface turning out not to matter.',
  controls: [
    { key: 'charge', label: 'Charge at the centre', unit: 'nC', least: -20, most: 20, step: 0.5, initial: 5, about: 'What is inside. The flux depends only on this.' },
    { key: 'outside', label: 'Charge outside', unit: 'nC', least: -20, most: 20, step: 0.5, initial: 0, about: 'A charge outside changes the field everywhere on the surface — and contributes exactly nothing to the total flux.' },
    { key: 'outsideAt', label: 'How far outside', unit: 'cm', least: 2, most: 30, step: 0.5, initial: 8, about: 'Where that outside charge sits.' },
    { key: 'radius', label: 'Surface radius', unit: 'cm', least: 0.5, most: 15, step: 0.5, initial: 3, about: 'Make it bigger and the field falls as the square while the area grows as the square, so the flux does not move.' },
    { key: 'samples', label: 'Patches on the surface', unit: '', least: 50, most: 2000, step: 50, initial: 600, about: 'How finely the surface is divided for the sum. More patches, closer to the exact answer.' }
  ],
  readouts: [
    { key: 'flux', label: 'Flux counted', unit: 'N·m²/C', figures: 6 },
    { key: 'predicted', label: "Gauss's law says", unit: 'N·m²/C', figures: 6 },
    { key: 'off', label: 'Off by', unit: '%', figures: 5 },
    { key: 'fieldAtSurface', label: 'Field at the surface', unit: 'kV/m', figures: 4 },
    { key: 'area', label: 'Area', unit: 'cm²', figures: 4 }
  ],
  suggestedStep: 0.05,
  start() {
    return { t: 0, flux: 0, enclosed: 0 }
  },
  step(state, dt, values) {
    state.t += dt
    const R = values.radius / 100
    const inside = values.charge * 1e-9
    const out = values.outside * 1e-9
    const outAt = values.outsideAt / 100
    const n = Math.max(50, Math.round(values.samples))

    // Points spread evenly over the sphere by the Fibonacci spiral — no clustering at the poles, which a naive
    // latitude-longitude grid gives and which quietly biases the sum.
    const golden = Math.PI * (3 - Math.sqrt(5))
    let total = 0
    for (let one = 0; one < n; one += 1) {
      const z = 1 - (2 * (one + 0.5)) / n
      const ring = Math.sqrt(Math.max(0, 1 - z * z))
      const angle = golden * one
      const nx = Math.cos(angle) * ring
      const ny = Math.sin(angle) * ring
      const nz = z
      const px = nx * R
      const py = ny * R
      const pz = nz * R

      // The field from the charge at the centre, plus the one outside, at this patch.
      let ex = (COULOMB * inside * nx) / (R * R)
      let ey = (COULOMB * inside * ny) / (R * R)
      let ez = (COULOMB * inside * nz) / (R * R)

      const dx = px - outAt
      const dy = py
      const dz = pz
      const r = Math.hypot(dx, dy, dz)
      if (r > 1e-6) {
        const strength = (COULOMB * out) / (r * r * r)
        ex += strength * dx
        ey += strength * dy
        ez += strength * dz
      }

      // Flux through this patch: the field along the outward normal, times the patch's share of the area.
      total += (ex * nx + ey * ny + ez * nz) * ((4 * Math.PI * R * R) / n)
    }
    state.flux = total
    state.enclosed = inside
  },
  read(state, values) {
    const R = values.radius / 100
    const predicted = (values.charge * 1e-9) / 8.8541878128e-12
    return {
      flux: state.flux,
      predicted,
      off: predicted === 0 ? Math.abs(state.flux) : Math.abs((state.flux - predicted) / predicted) * 100,
      fieldAtSurface: ((COULOMB * values.charge * 1e-9) / (R * R)) / 1000,
      area: 4 * Math.PI * R * R * 1e4
    }
  },
  paint(state, values): Scene {
    const R = values.radius / 100
    const outAt = values.outsideAt / 100
    const span = Math.max(R * 1.6, outAt * 1.3)
    const shapes: Shape[] = [
      { kind: 'circle', at: [0, 0], radius: R, tone: 'other' },
      { kind: 'circle', at: [0, 0], radius: span * 0.03, fill: true },
      { kind: 'text', at: [0, -span * 0.09], text: `${values.charge} nC`, size: 10, anchor: 'middle' }
    ]
    if (values.outside !== 0) {
      shapes.push({ kind: 'circle', at: [outAt, 0], radius: span * 0.03, fill: true, tone: 'other' })
      shapes.push({ kind: 'text', at: [outAt, -span * 0.09], text: `${values.outside} nC`, size: 10, anchor: 'middle', tone: 'other' })
    }
    // Arrows round the surface showing the field really does vary when a charge sits outside.
    for (let one = 0; one < 20; one += 1) {
      const angle = (one / 20) * 2 * Math.PI
      const px = Math.cos(angle) * R
      const py = Math.sin(angle) * R
      let ex = (COULOMB * values.charge * 1e-9 * Math.cos(angle)) / (R * R)
      let ey = (COULOMB * values.charge * 1e-9 * Math.sin(angle)) / (R * R)
      const dx = px - outAt
      const dy = py
      const r = Math.hypot(dx, dy)
      if (r > 1e-9 && values.outside !== 0) {
        const strength = (COULOMB * values.outside * 1e-9) / (r * r * r)
        ex += strength * dx
        ey += strength * dy
      }
      const size = Math.hypot(ex, ey)
      if (size === 0) continue
      const len = span * 0.1
      shapes.push({
        kind: 'arrow',
        from: [px, py],
        to: [px + (ex / size) * len, py + (ey / size) * len],
        head: span * 0.02,
        tone: 'faint'
      })
    }
    return {
      view: [-span, -span, 2 * span, 2 * span],
      shapes,
      about:
        values.outside === 0
          ? `Flux ${state.flux.toPrecision(6)}, against ${((values.charge * 1e-9) / 8.8541878128e-12).toPrecision(6)} from the law. Change the radius and watch it not move.`
          : `The outside charge changes the field at every patch — the arrows show it — and adds exactly nothing to the total. Whatever goes in comes out.`
    }
  },
  limits: [
    'A numerical sum over patches, so it is close rather than exact. More patches gets closer, and the error is shown.',
    'Point charges in vacuum. A material would be polarised and the law would need the permittivity of that material.',
    'A spherical surface. The law holds for any closed shape at all — this uses a sphere because the patches are easy to spread evenly over one.',
    'The drawing is a slice through the middle; the sum is over the whole sphere.'
  ]
}

export const CIRCUITS: readonly Simulation[] = Object.freeze([
  rlcCircuit as Simulation,
  rcCharging as Simulation,
  magneticField as Simulation,
  massSpectrometer as Simulation,
  gaussLaw as Simulation
])
