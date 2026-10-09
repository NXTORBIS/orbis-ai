import { COULOMB, advance, pushTrail, toRadians, type Scene, type Simulation } from './simulation.ts'

/**
 * Electromagnetism and waves: fields you can see, and waves that really superpose.
 *
 * ## A field line is traced, not drawn
 *
 * The lines here are produced by starting at a charge and stepping along the field direction, over and over. That
 * is why they bend correctly around a second charge, why they never cross, and why the null point between two like
 * charges appears without anybody putting it there. A picture of field lines drawn as nice curves would have none
 * of those properties, and the null point is the thing worth seeing.
 *
 * ## Superposition is addition, and the screen proves it
 *
 * Two waves are added at every point. Beats, standing waves and interference are then not three topics but one
 * fact seen three times — and the laboratory shows the parts alongside the sum so nobody has to take that on
 * trust.
 *
 * Pure.
 */

// ---------------------------------------------------------------- electric field

interface Charge {
  x: number
  y: number
  q: number
}

interface FieldState {
  charges: Charge[]
  lines: number[][]
  t: number
}

/** The field at a point, from every charge. Vector addition, which is the whole of superposition. */
function fieldAt(charges: readonly Charge[], x: number, y: number): [number, number] {
  let ex = 0
  let ey = 0
  for (const one of charges) {
    const dx = x - one.x
    const dy = y - one.y
    const r2 = dx * dx + dy * dy
    // Very close to a charge the field is enormous and the picture is meaningless, so it is left out there.
    if (r2 < 0.01) continue
    const r = Math.sqrt(r2)
    const strength = (COULOMB * one.q * 1e-9) / r2
    ex += (strength * dx) / r
    ey += (strength * dy) / r
  }
  return [ex, ey]
}

/** Follow the field from a starting point, one small step at a time, until it leaves or reaches a charge. */
function traceLine(charges: readonly Charge[], fromX: number, fromY: number, sign: number, extent: number): number[] {
  const points: number[] = []
  let x = fromX
  let y = fromY
  for (let step = 0; step < 900; step += 1) {
    points.push(x, y)
    const [ex, ey] = fieldAt(charges, x, y)
    const size = Math.hypot(ex, ey)
    if (!Number.isFinite(size) || size === 0) break
    // A fixed step along the direction, so the spacing does not change with the strength.
    x += (sign * ex * 0.06) / size
    y += (sign * ey * 0.06) / size
    if (Math.abs(x) > extent || Math.abs(y) > extent) break
    if (charges.some((one) => Math.hypot(x - one.x, y - one.y) < 0.12)) break
  }
  return points
}

export const electricField: Simulation<FieldState> = {
  id: 'electric-field',
  name: 'Electric Field',
  section: 'em',
  about: 'Field lines traced by following the field itself, so they bend and meet where they really do.',
  controls: [
    { key: 'charge1', label: 'Left charge', unit: 'nC', least: -10, most: 10, step: 0.5, initial: 5, about: 'Positive pushes lines away, negative draws them in.' },
    { key: 'charge2', label: 'Right charge', unit: 'nC', least: -10, most: 10, step: 0.5, initial: -5, about: 'Make both the same sign and a null point appears between them, where the field cancels exactly.' },
    { key: 'separation', label: 'Distance apart', unit: 'm', least: 0.5, most: 8, step: 0.1, initial: 3, about: 'Far apart they look like two separate charges; close together like one dipole.' },
    { key: 'lines', label: 'Lines per charge', unit: '', least: 4, most: 32, step: 1, initial: 16, about: 'How many to trace. More lines, same field — the density is what means something, not the count.' }
  ],
  readouts: [
    { key: 'centre', label: 'Field at the centre', unit: 'N/C' },
    { key: 'total', label: 'Total charge', unit: 'nC' },
    { key: 'dipole', label: 'Dipole moment', unit: 'nC m' }
  ],
  start(values) {
    const charges: Charge[] = [
      { x: -values.separation / 2, y: 0, q: values.charge1 },
      { x: values.separation / 2, y: 0, q: values.charge2 }
    ]
    const extent = values.separation * 2.5
    const lines: number[][] = []
    for (const one of charges) {
      if (one.q === 0) continue
      const count = Math.round(values.lines)
      for (let at = 0; at < count; at += 1) {
        const angle = (at / count) * Math.PI * 2
        lines.push(
          traceLine(charges, one.x + 0.18 * Math.cos(angle), one.y + 0.18 * Math.sin(angle), Math.sign(one.q), extent)
        )
      }
    }
    return { charges, lines, t: 0 }
  },
  step(state, dt) {
    // The field is static; stepping only advances the clock so the laboratory's transport works the same way.
    state.t += dt
  },
  read(state, values) {
    const [ex, ey] = fieldAt(state.charges, 0, 0)
    return {
      centre: Math.hypot(ex, ey),
      total: values.charge1 + values.charge2,
      dipole: Math.abs(values.charge1) * values.separation
    }
  },
  paint(state, values): Scene {
    const extent = values.separation * 2
    return {
      view: [-extent, -extent, extent, extent],
      shapes: [
        ...state.lines.map((points) => ({ kind: 'path' as const, points, width: 1, faint: true })),
        ...state.charges.map((one) => ({
          kind: 'circle' as const,
          at: [one.x, one.y] as readonly [number, number],
          radius: 0.1 + Math.abs(one.q) / 40,
          fill: true,
          tone: one.q >= 0 ? undefined : 'other'
        })),
        ...state.charges.map((one) => ({
          kind: 'text' as const,
          at: [one.x, one.y - 0.45] as readonly [number, number],
          text: `${one.q > 0 ? '+' : ''}${one.q} nC`,
          anchor: 'middle' as const,
          size: 11
        }))
      ],
      about:
        Math.sign(values.charge1) === Math.sign(values.charge2) && values.charge1 !== 0
          ? 'Two like charges: the lines push apart and there is a point between them where the field is exactly zero.'
          : 'Opposite charges: every line that leaves the positive one ends on the negative one.'
    }
  },
  limits: [
    'Two dimensions. Real field lines go out in three, and the density on a flat picture is therefore not proportional to the strength in the way it looks.',
    'The field very close to a charge is left out, because it goes to infinity there and would swamp the picture.',
    'Static charges only. A moving charge radiates, and none of that is here.'
  ]
}

// ---------------------------------------------------------------- waves

interface WaveState {
  t: number
  samples: number[]
}

export const waveSuperposition: Simulation<WaveState> = {
  id: 'wave-superposition',
  name: 'Wave Superposition',
  section: 'waves',
  about: 'Two waves added at every point, with the parts shown beside the sum.',
  controls: [
    { key: 'amplitude1', label: 'First amplitude', unit: '', least: 0, most: 2, step: 0.05, initial: 1, about: 'How tall the first wave is.' },
    { key: 'frequency1', label: 'First frequency', unit: 'Hz', least: 0.1, most: 10, step: 0.1, initial: 2, about: 'How many cycles a second.' },
    { key: 'amplitude2', label: 'Second amplitude', unit: '', least: 0, most: 2, step: 0.05, initial: 1, about: 'Equal amplitudes give complete cancellation where they are out of step.' },
    { key: 'frequency2', label: 'Second frequency', unit: 'Hz', least: 0.1, most: 10, step: 0.1, initial: 2.2, about: 'Close to the first and you get beats, at the difference between them.' },
    { key: 'phase', label: 'Phase difference', unit: '°', least: 0, most: 360, step: 1, initial: 0, about: 'At 180° with equal amplitudes they cancel exactly, everywhere.' },
    { key: 'speed', label: 'Wave speed', unit: 'm/s', least: 0.1, most: 20, step: 0.1, initial: 3, about: 'How fast they travel. Set the second to travel backwards for a standing wave.' },
    { key: 'opposite', label: 'Second goes backwards', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Two identical waves travelling opposite ways make a standing wave, with nodes that never move.' }
  ],
  readouts: [
    { key: 'beat', label: 'Beat frequency', unit: 'Hz' },
    { key: 'peak', label: 'Largest the sum gets', unit: '' },
    { key: 'wavelength1', label: 'First wavelength', unit: 'm' },
    { key: 'wavelength2', label: 'Second wavelength', unit: 'm' },
    { key: 'time', label: 'Time', unit: 's' }
  ],
  start() {
    return { t: 0, samples: [] }
  },
  step(state, dt) {
    state.t += dt
  },
  read(state, values) {
    // The largest the sum can be, found by sampling rather than assumed to be the sum of the amplitudes.
    let peak = 0
    for (let at = 0; at <= 400; at += 1) {
      const x = (at / 400) * 20
      peak = Math.max(peak, Math.abs(this.at(x, state.t, values)))
    }
    return {
      beat: Math.abs(values.frequency1 - values.frequency2),
      peak,
      wavelength1: values.speed / values.frequency1,
      wavelength2: values.speed / values.frequency2,
      time: state.t
    }
  },
  paint(state, values): Scene {
    const first: number[] = []
    const second: number[] = []
    const sum: number[] = []
    for (let at = 0; at <= 400; at += 1) {
      const x = (at / 400) * 20
      const k1 = (2 * Math.PI * values.frequency1) / values.speed
      const k2 = (2 * Math.PI * values.frequency2) / values.speed
      const direction = values.opposite >= 0.5 ? 1 : -1
      const y1 = values.amplitude1 * Math.sin(k1 * x - 2 * Math.PI * values.frequency1 * state.t)
      const y2 =
        values.amplitude2 *
        Math.sin(k2 * x + direction * 2 * Math.PI * values.frequency2 * state.t + toRadians(values.phase))
      first.push(x, y1 + 3)
      second.push(x, y2)
      sum.push(x, y1 + y2 - 3.5)
    }
    return {
      view: [0, -6.5, 20, 5],
      shapes: [
        { kind: 'line', from: [0, 3], to: [20, 3], width: 1, faint: true },
        { kind: 'path', points: first, width: 1.2, faint: true },
        { kind: 'text', at: [0.2, 4.4], text: 'first', size: 11 },
        { kind: 'line', from: [0, 0], to: [20, 0], width: 1, faint: true },
        { kind: 'path', points: second, width: 1.2, faint: true, tone: 'other' },
        { kind: 'text', at: [0.2, 1.4], text: 'second', size: 11, tone: 'other' },
        { kind: 'line', from: [0, -3.5], to: [20, -3.5], width: 1, faint: true },
        { kind: 'path', points: sum, width: 1.8 },
        { kind: 'text', at: [0.2, -2], text: 'the two added', size: 11 }
      ],
      about:
        values.opposite >= 0.5
          ? 'Travelling opposite ways: the sum has points that never move at all — nodes — and the pattern does not travel.'
          : Math.abs(values.frequency1 - values.frequency2) > 0.01
            ? `Different frequencies: the sum swells and fades ${Math.abs(values.frequency1 - values.frequency2).toFixed(2)} times a second. That is beats, and it is just addition.`
            : 'Same frequency: the sum is another wave of the same frequency, bigger or smaller depending on the phase.'
    }
  },
  limits: [
    'One dimension, and the medium is taken as perfect — nothing is lost as the waves travel.',
    'Both waves are perfect sine waves of one frequency each. A real sound is a sum of many.',
    'Superposition like this is only true while the medium responds proportionally. Loud enough and it does not.'
  ],
  /** The sum at a point, used by both the readouts and the drawing so they cannot disagree. */
  at(x: number, t: number, values: Readonly<Record<string, number>>): number {
    const k1 = (2 * Math.PI * values.frequency1) / values.speed
    const k2 = (2 * Math.PI * values.frequency2) / values.speed
    const direction = values.opposite >= 0.5 ? 1 : -1
    return (
      values.amplitude1 * Math.sin(k1 * x - 2 * Math.PI * values.frequency1 * t) +
      values.amplitude2 * Math.sin(k2 * x + direction * 2 * Math.PI * values.frequency2 * t + toRadians(values.phase))
    )
  }
} as Simulation<WaveState> & { at(x: number, t: number, values: Readonly<Record<string, number>>): number }

// ---------------------------------------------------------------- charged particle in a field

interface ChargedState {
  x: number
  y: number
  vx: number
  vy: number
  t: number
  trail: number[]
}

export const chargedMotion: Simulation<ChargedState> = {
  id: 'charged-motion',
  name: 'Charged Particle in a Field',
  section: 'em',
  about: 'A charge in crossed electric and magnetic fields — circles, drifts and helices, all from one force law.',
  controls: [
    { key: 'charge', label: 'Charge', unit: 'e', least: -5, most: 5, step: 0.5, initial: 1, about: 'Reverse the sign and it goes round the other way.' },
    { key: 'mass', label: 'Mass', unit: 'm_e', least: 0.1, most: 50, step: 0.1, initial: 1, about: 'In units of the electron mass. Heavier means a wider circle.' },
    { key: 'speed', label: 'Starting speed', unit: 'Mm/s', least: 0.1, most: 20, step: 0.1, initial: 2, about: 'The radius is proportional to this, so faster makes a bigger circle at the same time per turn.' },
    { key: 'magnetic', label: 'Magnetic field', unit: 'mT', least: -50, most: 50, step: 0.5, initial: 10, about: 'Out of the screen. It bends the path without ever changing the speed.' },
    { key: 'electric', label: 'Electric field', unit: 'kV/m', least: -50, most: 50, step: 0.5, initial: 0, about: 'Across the screen. Add it to a magnetic field and the circle turns into a drift.' },
    { key: 'angle', label: 'Starting direction', unit: '°', least: 0, most: 360, step: 1, initial: 0, about: 'Which way it sets off.' }
  ],
  readouts: [
    { key: 'speed', label: 'Speed', unit: 'Mm/s' },
    { key: 'radius', label: 'Radius', unit: 'mm' },
    { key: 'period', label: 'Time per turn', unit: 'ns' },
    { key: 'energy', label: 'Kinetic energy', unit: 'eV' },
    { key: 'time', label: 'Time', unit: 'ns' }
  ],
  conserves: { key: 'speed', label: 'Speed' },
  start(values) {
    const angle = toRadians(values.angle)
    return {
      x: 0,
      y: 0,
      vx: values.speed * Math.cos(angle),
      vy: values.speed * Math.sin(angle),
      t: 0,
      trail: []
    }
  },
  step(state, dt, values) {
    /*
     * F = q(E + v × B), with B out of the screen so the cross product is (vy·B, −vx·B).
     *
     * Units are scaled so the numbers on screen are readable: speed in Mm/s, field in mT, distance in mm. The
     * shape of the motion is what matters here, and the readouts carry the real quantities.
     */
    const ratio = values.charge / values.mass
    const derivative = (one: readonly number[]): number[] => [
      one[2],
      one[3],
      ratio * (values.electric * 0.1 + one[3] * values.magnetic * 0.1),
      ratio * (-one[2] * values.magnetic * 0.1)
    ]
    const [x, y, vx, vy] = advance([state.x, state.y, state.vx, state.vy], derivative, dt, 'rk4')
    state.x = x
    state.y = y
    state.vx = vx
    state.vy = vy
    state.t += dt
    pushTrail(state.trail, x, y, 3000)
  },
  read(state, values) {
    const speed = Math.hypot(state.vx, state.vy)
    const radius = values.magnetic === 0 ? Infinity : Math.abs((values.mass * speed) / (values.charge * values.magnetic * 0.1))
    return {
      speed,
      radius: Number.isFinite(radius) ? radius : 0,
      period: values.magnetic === 0 ? 0 : Math.abs((2 * Math.PI * values.mass) / (values.charge * values.magnetic * 0.1)),
      energy: 0.5 * values.mass * speed * speed,
      time: state.t
    }
  },
  paint(state): Scene {
    const reach = Math.max(5, ...state.trail.map(Math.abs)) * 1.2
    return {
      view: [-reach, -reach, reach, reach],
      shapes: [
        { kind: 'grid', spacing: Math.max(1, Math.round(reach / 6)) },
        { kind: 'path', points: state.trail, width: 1.3 },
        { kind: 'circle', at: [state.x, state.y], radius: reach / 45, fill: true },
        { kind: 'arrow', from: [state.x, state.y], to: [state.x + state.vx / 3, state.y + state.vy / 3] }
      ],
      about: 'A magnetic field changes the direction and never the speed, because the force is always across the motion. Add an electric field and the circle turns into a drift.'
    }
  },
  limits: [
    'Two dimensions, with the magnetic field straight out of the screen. A field at an angle makes a helix, which this cannot draw.',
    'Not relativistic, so it is wrong once the speed approaches that of light.',
    'The particle does not radiate, though a real accelerating charge does — which is what limits a cyclotron.'
  ]
}

export const FIELDS: readonly Simulation[] = Object.freeze([
  electricField as Simulation,
  waveSuperposition as Simulation,
  chargedMotion as Simulation
])
