import { pushTrail, type Scene, type Shape, type Simulation } from './simulation.ts'

/**
 * Waves and optics: strings that ring, waves that add up, and light that bends.
 *
 * ## The wave equation is stepped, not drawn from a formula
 *
 * It would be far easier to draw sin(kx − ωt) and call it a wave. Nothing would be learnt from it: the standing
 * wave would appear whether or not the boundary conditions allowed it, and a pulse would pass through a join
 * without reflecting. These step the actual wave equation on a grid, so the reflections, the standing modes and
 * the inversion at a fixed end all come out of the physics rather than being drawn in.
 *
 * ## Where a closed form is exact, it is used
 *
 * Refraction and thin lenses are geometry, not evolution. Stepping them would add error and teach nothing, so
 * those are solved exactly and the limits say which is which.
 */

// ——— A string, stepped from the wave equation ———————————————————————————————

interface StringState {
  now: Float64Array
  before: Float64Array
  next: Float64Array
  points: number
  t: number
  peak: number
  energy: number
  courant: number
  biggest: number
}

/**
 * The discrete wave equation: u(t+dt) = 2u(t) − u(t−dt) + (c·dt/dx)²·∇²u.
 *
 * The term in brackets is the Courant number. Above one the scheme blows up — not slowly and visibly, but into
 * numbers that stop being numbers within a few steps. The readout shows it so that can be seen coming.
 */
function stepString(state: StringState, dt: number, speed: number, length: number, damping: number): void {
  const dx = length / (state.points - 1)
  const courant = (speed * dt) / dx
  const c2 = courant * courant
  const keep = Math.exp(-damping * dt)

  for (let one = 1; one < state.points - 1; one += 1) {
    const curve = state.now[one + 1] - 2 * state.now[one] + state.now[one - 1]
    state.next[one] = (2 * state.now[one] - state.before[one] + c2 * curve) * keep
  }
  // Both ends held: a fixed end is what makes a reflection come back upside down.
  state.next[0] = 0
  state.next[state.points - 1] = 0

  state.before.set(state.now)
  state.now.set(state.next)
  state.t += dt

  let peak = 0
  let energy = 0
  for (let one = 1; one < state.points - 1; one += 1) {
    const height = Math.abs(state.now[one])
    if (height > peak) peak = height
    const speedHere = (state.now[one] - state.before[one]) / dt
    const slope = (state.now[one + 1] - state.now[one - 1]) / (2 * dx)
    energy += 0.5 * (speedHere * speedHere + speed * speed * slope * slope) * dx
  }
  state.peak = peak
  state.energy = energy
  // Recorded here because only the step knows the time step the runner chose; `read` never sees it.
  state.courant = courant
  if (peak > state.biggest) state.biggest = peak
}

export const stringWave: Simulation<StringState> = {
  id: 'string-wave',
  name: 'Wave on a string',
  section: 'waves',
  about: 'A pulse or a mode on a stretched string, stepped from the wave equation — so reflections come back inverted on their own.',
  controls: [
    { key: 'speed', label: 'Wave speed', unit: 'm/s', least: 0.5, most: 20, step: 0.5, initial: 5, about: 'Set by the tension and the mass per length. Faster waves cross and reflect sooner.' },
    { key: 'length', label: 'String length', unit: 'm', least: 0.5, most: 10, step: 0.5, initial: 4, about: 'Longer strings have lower modes, which is why a bass string is long.' },
    { key: 'shape', label: 'Start as', unit: '', least: 0, most: 2, step: 1, initial: 0, about: 'A single pulse, a plucked triangle, or a pure mode. A pulse shows reflection; a mode shows a standing wave.' },
    { key: 'mode', label: 'Which mode', unit: '', least: 1, most: 8, step: 1, initial: 3, about: 'Only whole numbers of half-waves fit between fixed ends, and that is why instruments have notes.' },
    { key: 'damping', label: 'Damping', unit: '1/s', least: 0, most: 3, step: 0.05, initial: 0, about: 'Energy lost to the air and the ends. At zero the string rings for ever.' },
    { key: 'points', label: 'Grid points', unit: '', least: 50, most: 600, step: 10, initial: 240, about: 'How finely the string is divided. Too few and short wavelengths travel at the wrong speed.' }
  ],
  readouts: [
    { key: 'peak', label: 'Tallest point', unit: 'm', figures: 4 },
    { key: 'biggest', label: 'Tallest ever', unit: 'm', figures: 4 },
    { key: 'energy', label: 'Energy', unit: 'J/kg', figures: 6 },
    { key: 'courant', label: 'Courant number', unit: '', figures: 4 },
    { key: 'time', label: 'Time', unit: 's' },
    { key: 'crossings', label: 'Lengths travelled', unit: '' },
    { key: 'modeFrequency', label: 'Frequency of this mode', unit: 'Hz' }
  ],
  suggestedStep: 0.0005,
  start(values) {
    const points = Math.max(20, Math.round(values.points))
    const now = new Float64Array(points)
    const before = new Float64Array(points)
    const shape = Math.round(values.shape)
    const mode = Math.max(1, Math.round(values.mode))

    for (let one = 0; one < points; one += 1) {
      const where = one / (points - 1)
      if (shape === 0) {
        // A narrow Gaussian a quarter of the way along, so the reflection is clearly separate from the start.
        const from = where - 0.25
        now[one] = Math.exp(-(from * from) / 0.0015)
      } else if (shape === 1) {
        // Plucked: pulled aside at a third and let go. Rich in harmonics, which is what a pluck sounds like.
        now[one] = where < 0.33 ? where / 0.33 : (1 - where) / 0.67
      } else {
        now[one] = Math.sin(mode * Math.PI * where)
      }
    }
    now[0] = 0
    now[points - 1] = 0
    // Starting from rest: the previous step equals this one, so nothing is moving yet.
    before.set(now)
    return { now, before, next: new Float64Array(points), points, t: 0, peak: 1, energy: 0, courant: 0, biggest: 0 }
  },
  step(state, dt, values) {
    stepString(state, dt, values.speed, values.length, values.damping)
  },
  read(state, values) {
    const mode = Math.max(1, Math.round(values.mode))
    return {
      peak: state.peak,
      // A standing wave passes through flat twice a cycle, so the height right now says nothing about whether the
      // scheme is holding its amplitude. This does: for an undamped mode it must settle and stay there.
      biggest: state.biggest,
      energy: state.energy,
      courant: state.courant,
      time: state.t,
      crossings: (state.t * values.speed) / values.length,
      // f = n·v / 2L. The string can only play these.
      modeFrequency: (mode * values.speed) / (2 * values.length)
    }
  },
  paint(state, values): Scene {
    const points: number[] = []
    for (let one = 0; one < state.points; one += 1) {
      points.push((one / (state.points - 1)) * values.length, state.now[one])
    }
    const shapes: Shape[] = [
      { kind: 'line', from: [0, 0], to: [values.length, 0], width: 1, faint: true },
      { kind: 'path', points, width: 2 },
      { kind: 'circle', at: [0, 0], radius: 0.05, fill: true },
      { kind: 'circle', at: [values.length, 0], radius: 0.05, fill: true }
    ]
    // The nodes of the mode, so a standing wave can be seen standing rather than taken on trust.
    if (Math.round(values.shape) === 2) {
      const mode = Math.max(1, Math.round(values.mode))
      for (let one = 1; one < mode; one += 1) {
        const at = (one / mode) * values.length
        shapes.push({ kind: 'line', from: [at, -1.2], to: [at, 1.2], width: 1, faint: true, tone: 'other' })
      }
    }
    return {
      view: [-0.2, -1.4, values.length + 0.4, 2.8],
      shapes,
      about:
        Math.round(values.shape) === 2
          ? `Mode ${Math.round(values.mode)} at ${((Math.round(values.mode) * values.speed) / (2 * values.length)).toFixed(2)} Hz. The marked lines are nodes, and the string never moves there.`
          : `The pulse reflects at each fixed end and comes back upside down — which is the boundary condition doing it, not anything drawn in.`
    }
  },
  limits: [
    'Small displacements. A real string stretched hard enough changes its own tension, and then the wave speed depends on the amplitude.',
    'A perfectly flexible string. Real wire has stiffness of its own, which makes the high harmonics slightly sharp — the reason pianos are stretch-tuned.',
    'One dimension, moving only sideways. No torsion and no longitudinal wave.',
    'The scheme is stable only while the Courant number stays below one. Above it the numbers blow up within a few steps, so that number is on screen.'
  ]
}

// ——— Two waves added ————————————————————————————————————————————————————————

interface BeatState {
  t: number
  samples: number
  trail: number[]
  loudest: number
  quietest: number
}

export const beats: Simulation<BeatState> = {
  id: 'beats',
  name: 'Beats and superposition',
  section: 'waves',
  about: 'Two notes close together, added up — and the slow throb that comes out of nothing but the two of them.',
  controls: [
    { key: 'first', label: 'First frequency', unit: 'Hz', least: 1, most: 60, step: 0.5, initial: 20, about: 'One of the two notes.' },
    { key: 'second', label: 'Second frequency', unit: 'Hz', least: 1, most: 60, step: 0.5, initial: 23, about: 'The other. The beat you hear is the difference between them, and nothing is producing that frequency.' },
    { key: 'firstLoudness', label: 'First amplitude', unit: '', least: 0, most: 2, step: 0.05, initial: 1, about: 'How loud the first one is. When they are unequal the beat never falls to silence.' },
    { key: 'secondLoudness', label: 'Second amplitude', unit: '', least: 0, most: 2, step: 0.05, initial: 1, about: 'How loud the second one is.' },
    { key: 'window', label: 'Seconds shown', unit: 's', least: 0.5, most: 10, step: 0.5, initial: 3, about: 'How much of the trace to keep on screen.' }
  ],
  readouts: [
    { key: 'now', label: 'Height now', unit: '', figures: 4 },
    { key: 'beat', label: 'Beat frequency', unit: 'Hz' },
    { key: 'average', label: 'Average frequency', unit: 'Hz' },
    { key: 'loudest', label: 'Loudest', unit: '', figures: 4 },
    { key: 'quietest', label: 'Quietest', unit: '', figures: 4 },
    { key: 'time', label: 'Time', unit: 's' }
  ],
  suggestedStep: 0.001,
  start() {
    return { t: 0, samples: 0, trail: [], loudest: 0, quietest: Number.POSITIVE_INFINITY }
  },
  step(state, dt, values) {
    state.t += dt
    const height =
      values.firstLoudness * Math.sin(2 * Math.PI * values.first * state.t) +
      values.secondLoudness * Math.sin(2 * Math.PI * values.second * state.t)
    pushTrail(state.trail, state.t, height, 4000)
    state.samples += 1

    // The envelope, tracked over the last beat rather than for ever, so the numbers follow the throb.
    const envelope = Math.abs(height)
    if (envelope > state.loudest) state.loudest = envelope
    if (envelope < state.quietest) state.quietest = envelope
  },
  read(state, values) {
    const last = state.trail.length >= 2 ? state.trail[state.trail.length - 1] : 0
    return {
      now: last,
      beat: Math.abs(values.first - values.second),
      average: (values.first + values.second) / 2,
      loudest: state.loudest,
      quietest: Number.isFinite(state.quietest) ? state.quietest : 0,
      time: state.t
    }
  },
  paint(state, values): Scene {
    const from = Math.max(0, state.t - values.window)
    const points: number[] = []
    for (let one = 0; one < state.trail.length; one += 2) {
      if (state.trail[one] >= from) points.push(state.trail[one], state.trail[one + 1])
    }
    const tall = values.firstLoudness + values.secondLoudness
    const shapes: Shape[] = [
      { kind: 'line', from: [from, 0], to: [from + values.window, 0], width: 1, faint: true },
      { kind: 'path', points, width: 1.5 }
    ]
    // The envelope, drawn over the top: this is the shape you hear as the throb.
    const beat = Math.abs(values.first - values.second)
    if (beat > 0 && Math.abs(values.firstLoudness - values.secondLoudness) < 1e-9) {
      const upper: number[] = []
      const lower: number[] = []
      for (let one = 0; one <= 200; one += 1) {
        const at = from + (one / 200) * values.window
        const envelope = 2 * values.firstLoudness * Math.abs(Math.cos(Math.PI * beat * at))
        upper.push(at, envelope)
        lower.push(at, -envelope)
      }
      shapes.push({ kind: 'path', points: upper, width: 1, tone: 'other', faint: true })
      shapes.push({ kind: 'path', points: lower, width: 1, tone: 'other', faint: true })
    }
    return {
      view: [from, -tall * 1.15, values.window, tall * 2.3],
      shapes,
      about:
        beat === 0
          ? 'The same frequency twice: they simply add, and there is no beat.'
          : `${beat.toFixed(2)} beats a second. Nothing is vibrating at that frequency — it is the two of them going in and out of step.`
    }
  },
  limits: [
    'Two pure tones. Real instruments have harmonics, and beats then happen between every pair of them at once.',
    'Added as numbers, which is what waves do in a linear medium. Loud enough sound in air is not linear and generates new frequencies.',
    'This is the pressure, not the loudness you perceive — hearing is logarithmic and compresses the quiet parts.'
  ]
}

// ——— Interference through slits ———————————————————————————————————————————

interface SlitState {
  screen: Float64Array
  brightest: number
  t: number
}

export const interference: Simulation<SlitState> = {
  id: 'interference',
  name: 'Slits and interference',
  section: 'waves',
  about: 'Light through one slit, two, or many — with every path length added up, not a fringe formula drawn on.',
  controls: [
    { key: 'slits', label: 'How many slits', unit: '', least: 1, most: 40, step: 1, initial: 2, about: 'One gives diffraction alone. Two gives fringes. Many sharpens them into the lines a grating makes.' },
    { key: 'separation', label: 'Slit separation', unit: 'µm', least: 1, most: 200, step: 1, initial: 20, about: 'Further apart means the fringes crowd together — the two are the wrong way round, which surprises people.' },
    { key: 'width', label: 'Slit width', unit: 'µm', least: 0.2, most: 50, step: 0.2, initial: 4, about: 'A wider slit diffracts less, so the pattern is squeezed into a narrower envelope.' },
    { key: 'wavelength', label: 'Wavelength', unit: 'nm', least: 380, most: 750, step: 5, initial: 550, about: 'Red light has longer waves and spreads further than blue, which is why a grating makes a spectrum.' },
    { key: 'distance', label: 'Screen distance', unit: 'm', least: 0.1, most: 5, step: 0.1, initial: 1, about: 'Further away spreads the pattern out, in proportion.' },
    { key: 'screenWidth', label: 'Screen width', unit: 'm', least: 0.01, most: 0.5, step: 0.01, initial: 0.06, about: 'How much of the screen is shown.' }
  ],
  readouts: [
    { key: 'brightest', label: 'Brightest', unit: '', figures: 4 },
    { key: 'fringeSpacing', label: 'Fringe spacing', unit: 'mm', figures: 4 },
    { key: 'firstMinimum', label: 'First diffraction minimum', unit: 'mm', figures: 4 },
    { key: 'fringesVisible', label: 'Fringes inside the envelope', unit: '' },
    { key: 'missingOrder', label: 'Order that goes missing', unit: '' }
  ],
  suggestedStep: 0.01,
  start(values) {
    return { screen: new Float64Array(Math.max(100, Math.round(values.screenWidth * 8000))), brightest: 0, t: 0 }
  },
  step(state, dt, values) {
    state.t += dt
    const n = state.screen.length
    const slits = Math.max(1, Math.round(values.slits))
    const d = values.separation * 1e-6
    const a = values.width * 1e-6
    const lambda = values.wavelength * 1e-9
    const k = (2 * Math.PI) / lambda

    let brightest = 0
    for (let one = 0; one < n; one += 1) {
      const y = ((one / (n - 1)) - 0.5) * values.screenWidth
      const theta = Math.atan2(y, values.distance)
      const sin = Math.sin(theta)

      // One slit of real width: the single-slit envelope.
      const half = (k * a * sin) / 2
      const single = half === 0 ? 1 : Math.sin(half) / half

      // N slits added as a geometric series — exact, not a two-slit cosine stretched.
      const phase = (k * d * sin) / 2
      let many: number
      if (Math.abs(Math.sin(phase)) < 1e-12) many = slits
      else many = Math.sin(slits * phase) / Math.sin(phase)

      const amplitude = single * many
      const intensity = amplitude * amplitude
      state.screen[one] = intensity
      if (intensity > brightest) brightest = intensity
    }
    state.brightest = brightest
  },
  read(state, values) {
    const lambda = values.wavelength * 1e-9
    const d = values.separation * 1e-6
    const a = values.width * 1e-6
    const fringe = (lambda * values.distance) / d
    const envelope = (lambda * values.distance) / a
    return {
      brightest: state.brightest,
      fringeSpacing: fringe * 1000,
      firstMinimum: envelope * 1000,
      fringesVisible: Math.max(0, Math.floor((2 * envelope) / fringe)),
      // Where a bright fringe lands exactly on a dark diffraction minimum it simply is not there.
      missingOrder: Math.abs(d / a - Math.round(d / a)) < 0.02 ? Math.round(d / a) : 0
    }
  },
  paint(state, values): Scene {
    const n = state.screen.length
    const points: number[] = []
    const scale = state.brightest > 0 ? 1 / state.brightest : 1
    for (let one = 0; one < n; one += 1) {
      const y = ((one / (n - 1)) - 0.5) * values.screenWidth * 1000
      points.push(y, state.screen[one] * scale)
    }
    const shapes: Shape[] = [
      { kind: 'line', from: [(-values.screenWidth * 1000) / 2, 0], to: [(values.screenWidth * 1000) / 2, 0], width: 1, faint: true },
      { kind: 'path', points, width: 1.6 }
    ]
    // The single-slit envelope, so it is visible that it is what limits the fringes.
    const lambda = values.wavelength * 1e-9
    const a = values.width * 1e-6
    const k = (2 * Math.PI) / lambda
    const env: number[] = []
    for (let one = 0; one < n; one += 1) {
      const y = ((one / (n - 1)) - 0.5) * values.screenWidth
      const half = (k * a * Math.sin(Math.atan2(y, values.distance))) / 2
      const single = half === 0 ? 1 : Math.sin(half) / half
      env.push(y * 1000, single * single)
    }
    shapes.push({ kind: 'path', points: env, width: 1, faint: true, tone: 'other' })

    return {
      view: [(-values.screenWidth * 1000) / 2, -0.1, values.screenWidth * 1000, 1.25],
      shapes,
      about: `${Math.round(values.slits)} slit${Math.round(values.slits) === 1 ? '' : 's'} · fringes every ${(((values.wavelength * 1e-9) * values.distance) / (values.separation * 1e-6)) * 1000 > 0 ? ((((values.wavelength * 1e-9) * values.distance) / (values.separation * 1e-6)) * 1000).toFixed(3) : '—'} mm. The faint curve is the single-slit envelope, and no fringe can be brighter than it.`
    }
  },
  limits: [
    'Far-field (Fraunhofer) diffraction, where the screen is far enough that the rays can be taken as parallel. Close up the pattern is different and this is wrong.',
    'One wavelength at a time. White light would give every colour at a different spacing, overlapping into the spectrum a grating shows.',
    'Slits of zero height and perfectly sharp edges, all lit in step.',
    'Intensity, not what the eye sees — the eye compresses brightness heavily, so faint fringes look stronger than these numbers.'
  ]
}

// ——— Rays through lenses and mirrors ——————————————————————————————————————

interface RayState {
  t: number
  imageAt: number
  magnification: number
  real: boolean
}

export const lensRays: Simulation<RayState> = {
  id: 'lens-rays',
  name: 'Lenses and mirrors',
  section: 'waves',
  about: 'The three rays that find an image, traced properly — including when the image turns out to be virtual.',
  controls: [
    { key: 'kind', label: 'Converging or diverging', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'A converging lens brings rays together; a diverging one spreads them, and can only make a virtual image.' },
    { key: 'focal', label: 'Focal length', unit: 'cm', least: 2, most: 30, step: 0.5, initial: 10, about: 'How strongly it bends light. Shorter is stronger.' },
    { key: 'objectAt', label: 'Object distance', unit: 'cm', least: 1, most: 60, step: 0.5, initial: 25, about: 'Inside the focal length the image goes virtual, upright and magnified — which is what a magnifying glass does.' },
    { key: 'objectHeight', label: 'Object height', unit: 'cm', least: 0.5, most: 10, step: 0.5, initial: 3, about: 'How tall the thing being looked at is.' }
  ],
  readouts: [
    { key: 'imageAt', label: 'Image distance', unit: 'cm', figures: 4 },
    { key: 'magnification', label: 'Magnification', unit: '', figures: 4 },
    { key: 'imageHeight', label: 'Image height', unit: 'cm', figures: 4 },
    { key: 'real', label: 'Real image', unit: '' },
    { key: 'upright', label: 'The right way up', unit: '' },
    { key: 'power', label: 'Lens power', unit: 'D', figures: 3 }
  ],
  suggestedStep: 0.01,
  start() {
    return { t: 0, imageAt: 0, magnification: 0, real: false }
  },
  step(state, dt, values) {
    state.t += dt
    // 1/f = 1/u + 1/v, solved exactly. Stepping geometry would add error and teach nothing.
    const f = Math.round(values.kind) === 0 ? values.focal : -values.focal
    const u = values.objectAt
    const v = u === f ? Number.POSITIVE_INFINITY : 1 / (1 / f - 1 / u)
    state.imageAt = v
    state.magnification = Number.isFinite(v) ? -v / u : Number.POSITIVE_INFINITY
    state.real = Number.isFinite(v) && v > 0
  },
  read(state, values) {
    const f = Math.round(values.kind) === 0 ? values.focal : -values.focal
    const big = Number.isFinite(state.magnification) ? state.magnification : 0
    return {
      imageAt: Number.isFinite(state.imageAt) ? state.imageAt : 0,
      magnification: big,
      imageHeight: big * values.objectHeight,
      real: state.real ? 1 : 0,
      upright: big > 0 ? 1 : 0,
      power: 100 / f
    }
  },
  paint(state, values): Scene {
    const f = Math.round(values.kind) === 0 ? values.focal : -values.focal
    const u = values.objectAt
    const h = values.objectHeight
    const v = state.imageAt
    const tall = Math.max(h, Math.abs(state.magnification * h), Math.abs(f) / 2) * 1.6
    const wide = Math.max(u, Math.abs(Number.isFinite(v) ? v : 0), Math.abs(f)) * 1.5

    const shapes: Shape[] = [
      { kind: 'line', from: [-wide, 0], to: [wide, 0], width: 1, faint: true },
      // The lens itself.
      { kind: 'line', from: [0, -tall * 0.8], to: [0, tall * 0.8], width: 2 },
      // The focal points, both sides.
      { kind: 'circle', at: [Math.abs(f), 0], radius: tall * 0.035, fill: true, tone: 'other' },
      { kind: 'circle', at: [-Math.abs(f), 0], radius: tall * 0.035, fill: true, tone: 'other' },
      { kind: 'text', at: [Math.abs(f), -tall * 0.12], text: 'F', size: 11, anchor: 'middle', tone: 'other' },
      { kind: 'text', at: [-Math.abs(f), -tall * 0.12], text: 'F', size: 11, anchor: 'middle', tone: 'other' },
      // The object.
      { kind: 'arrow', from: [-u, 0], to: [-u, h], head: tall * 0.05 }
    ]

    // Ray one: parallel in, through the focus on the way out.
    shapes.push({ kind: 'line', from: [-u, h], to: [0, h], width: 1.4 })
    if (Math.round(values.kind) === 0) {
      const slope = -h / f
      shapes.push({ kind: 'line', from: [0, h], to: [wide, h + slope * wide], width: 1.4 })
    } else {
      // Diverging: it leaves as though it came from the near focus, so the backward part is dashed in faintly.
      const slope = h / Math.abs(f)
      shapes.push({ kind: 'line', from: [0, h], to: [wide, h + slope * wide], width: 1.4 })
      shapes.push({ kind: 'line', from: [0, h], to: [-Math.abs(f), 0], width: 1, faint: true, tone: 'other' })
    }
    // Ray two: straight through the middle, undeviated.
    const middle = h / u
    shapes.push({ kind: 'line', from: [-u, h], to: [wide, -middle * wide], width: 1.4 })

    // The image, where the rays actually meet — or appear to.
    if (Number.isFinite(v) && Math.abs(v) < wide) {
      const imageHeight = state.magnification * h
      shapes.push({
        kind: 'arrow',
        from: [v, 0],
        to: [v, imageHeight],
        head: tall * 0.05,
        tone: 'other'
      })
      shapes.push({
        kind: 'text',
        at: [v, imageHeight + Math.sign(imageHeight || 1) * tall * 0.1],
        text: state.real ? 'real image' : 'virtual image',
        size: 10,
        anchor: 'middle',
        tone: 'other'
      })
    }

    return {
      view: [-wide, -tall, 2 * wide, 2 * tall],
      shapes,
      about: !Number.isFinite(v)
        ? 'The object is exactly at the focus, so the rays leave parallel and never meet. There is no image at any distance.'
        : state.real
          ? `A real image ${v.toFixed(1)} cm beyond, ${Math.abs(state.magnification).toFixed(2)}× and upside down. Light actually goes there, so a screen would catch it.`
          : `A virtual image ${Math.abs(v).toFixed(1)} cm back on the near side, ${Math.abs(state.magnification).toFixed(2)}× and upright. No light goes there — a screen would catch nothing.`
    }
  },
  limits: [
    'A thin lens, and rays close to the axis. A real lens of any thickness focuses edge rays differently — spherical aberration.',
    'One wavelength. Glass bends blue more than red, so a real lens has a different focal length for every colour.',
    'Only the three construction rays are drawn. Light goes everywhere, and these are the three whose paths are known without calculation.'
  ]
}

// ——— Polarisation ————————————————————————————————————————————————————————

interface PolarState {
  t: number
  through: number[]
  out: number
}

export const polarisation: Simulation<PolarState> = {
  id: 'polarisation',
  name: 'Polarising filters',
  section: 'waves',
  about: "Malus's law through a stack of filters — including the three that let light through where two let none.",
  controls: [
    { key: 'filters', label: 'How many filters', unit: '', least: 1, most: 8, step: 1, initial: 3, about: 'Two crossed filters pass nothing. Put a third between them at an angle and light comes through, which looks impossible and is not.' },
    { key: 'lastAngle', label: 'Angle of the last one', unit: '°', least: 0, most: 180, step: 1, initial: 90, about: 'The first is always at zero. The rest are spread evenly up to this.' },
    { key: 'startPolarised', label: 'Light starts polarised', unit: '', least: 0, most: 1, step: 1, initial: 0, about: 'Unpolarised light loses exactly half at the first filter, whatever its angle. Already-polarised light may lose none or all.' }
  ],
  readouts: [
    { key: 'out', label: 'Fraction through', unit: '', figures: 5 },
    { key: 'afterFirst', label: 'After the first', unit: '', figures: 5 },
    { key: 'stepAngle', label: 'Angle between filters', unit: '°', figures: 3 },
    { key: 'lost', label: 'Fraction absorbed', unit: '', figures: 5 }
  ],
  suggestedStep: 0.02,
  start() {
    return { t: 0, through: [], out: 0 }
  },
  step(state, dt, values) {
    state.t += dt
    const count = Math.max(1, Math.round(values.filters))
    const angles: number[] = []
    for (let one = 0; one < count; one += 1) {
      angles.push(count === 1 ? 0 : (one / (count - 1)) * values.lastAngle)
    }

    // Unpolarised light loses half at the first filter whatever its angle — it is an average over all directions.
    let intensity = Math.round(values.startPolarised) === 1 ? Math.cos((angles[0] * Math.PI) / 180) ** 2 : 0.5
    const through = [intensity]
    for (let one = 1; one < count; one += 1) {
      const between = ((angles[one] - angles[one - 1]) * Math.PI) / 180
      intensity *= Math.cos(between) ** 2
      through.push(intensity)
    }
    state.through = through
    state.out = intensity
  },
  read(state, values) {
    const count = Math.max(1, Math.round(values.filters))
    return {
      out: state.out,
      afterFirst: state.through[0] ?? 0,
      stepAngle: count > 1 ? values.lastAngle / (count - 1) : 0,
      lost: 1 - state.out
    }
  },
  paint(state, values): Scene {
    const count = Math.max(1, Math.round(values.filters))
    const shapes: Shape[] = []
    const gap = 1.4

    for (let one = 0; one < count; one += 1) {
      const x = one * gap
      const angle = count === 1 ? 0 : (one / (count - 1)) * values.lastAngle
      const radians = (angle * Math.PI) / 180
      // The filter, with its pass direction drawn across it.
      shapes.push({ kind: 'rect', at: [x, 0], width: 0.22, height: 1.6, tone: 'faint' })
      shapes.push({
        kind: 'line',
        from: [x - 0.7 * Math.sin(radians) * 0, x - 0.7 * Math.cos(radians + Math.PI / 2) * 0],
        to: [x, 0],
        width: 1,
        faint: true
      })
      shapes.push({
        kind: 'line',
        from: [x - 0.1 * Math.cos(radians), -0.7 * Math.sin(radians + Math.PI / 2) * 0 - 0.7 * Math.cos(radians)],
        to: [x + 0.1 * Math.cos(radians), 0.7 * Math.cos(radians)],
        width: 2,
        tone: 'other'
      })
      shapes.push({ kind: 'text', at: [x, -1.05], text: `${angle.toFixed(0)}°`, size: 10, anchor: 'middle' })

      // How much is left after this one, as a bar.
      const left = state.through[one] ?? 0
      shapes.push({ kind: 'rect', at: [x + gap / 2, 0], width: gap * 0.5, height: Math.max(0.002, left * 1.4), fill: true })
      shapes.push({ kind: 'text', at: [x + gap / 2, -1.05], text: left.toFixed(3), size: 9, anchor: 'middle', tone: 'faint' })
    }

    return {
      view: [-0.8, -1.4, count * gap + 1.2, 2.8],
      shapes,
      about:
        state.out < 1e-9
          ? 'Nothing gets through: somewhere in the stack two neighbours are at right angles.'
          : `${(state.out * 100).toFixed(3)}% gets through. Each filter passes cos²θ of what reached it, with θ measured from the one before — not from the start.`
    }
  },
  limits: [
    'Ideal filters: they pass everything along their axis and nothing across it. Real polarisers leak a little and absorb some of what they should pass.',
    'Linear polarisation only. Circular and elliptical light need the phase tracked as well, which this does not do.',
    "Malus's law, which is about intensity. It says nothing about the phase the light comes out with."
  ]
}

export const WAVES: readonly Simulation[] = Object.freeze([
  stringWave as Simulation,
  beats as Simulation,
  interference as Simulation,
  lensRays as Simulation,
  polarisation as Simulation
])
