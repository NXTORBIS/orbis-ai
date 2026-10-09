/**
 * Energy landscapes: how the energy of a system changes as its geometry does.
 *
 * ## Three things, all computed
 *
 * **A bond**, as a Morse curve — the potential between two atoms as a function of how far apart they are. Unlike
 * a harmonic spring it dissociates, which is the whole point: a real bond breaks, and a parabola never does.
 *
 * **A reaction**, as energy along the reaction coordinate — reactants, a barrier, products. The barrier height
 * and the shape are what decide the rate, and both are read off the curve rather than stated.
 *
 * **A surface**, the energy over two coordinates at once, which is where a saddle point is actually visible as
 * a saddle: downhill in one direction and uphill in the other.
 *
 * ## What it does not claim
 *
 * These are model potentials with parameters you set, not quantum chemistry. Give it a dissociation energy and a
 * bond length and it draws the curve those imply; it cannot tell you what they are for a molecule you name. That
 * is a different and much larger calculation, and pretending otherwise would be the dishonest part.
 */

export interface LandscapeProblem {
  problem: string
  fix: string
}

export const isLandscapeProblem = (held: unknown): held is LandscapeProblem =>
  typeof held === 'object' && held !== null && 'problem' in held

const no = (problem: string, fix: string): LandscapeProblem => ({ problem, fix })

// ---------------------------------------------------------------- a bond

export interface MorseSettings {
  /** Dissociation energy — how much it takes to break the bond, in kJ/mol. */
  depth: number
  /** The bond length at the bottom of the well, in picometres. */
  length: number
  /** Width of the well, in 1/pm. Larger is a stiffer, narrower bond. */
  width: number
  /** How far out to draw, as a multiple of the bond length. */
  outTo?: number
  points?: number
}

export interface BondCurve {
  /** Separation in picometres. */
  r: readonly number[]
  /** Energy in kJ/mol, with zero at the bottom of the well. */
  energy: readonly number[]
  /** The same bond as a harmonic spring, for comparison — it never dissociates. */
  harmonic: readonly number[]
  /** The force constant at the minimum, in kJ/(mol·pm²). */
  forceConstant: number
  /** How far it stretches before the energy reaches half the dissociation energy, in pm. */
  halfWay: number
  /** Where the harmonic approximation is wrong by more than a tenth of the well depth, in pm. */
  harmonicFailsAt: number | null
}

/**
 * The Morse potential for one bond.
 *
 * V(r) = D(1 − e^(−a(r−r₀)))², which is zero at the bottom and D at infinite separation. Written this way round
 * rather than with the usual negative offset, because a screen showing "0 at the bottom, D to break it" is the
 * way a chemist reads a bond energy.
 */
export function bondCurve(settings: MorseSettings): BondCurve | LandscapeProblem {
  const { depth, length, width } = settings
  if (!Number.isFinite(depth) || depth <= 0) {
    return no('The dissociation energy must be more than zero.', 'A bond with no depth is not a bond.')
  }
  if (!Number.isFinite(length) || length <= 0) {
    return no('The bond length must be more than zero.', 'Typical single bonds are 100–160 pm.')
  }
  if (!Number.isFinite(width) || width <= 0) {
    return no('The well width must be more than zero.', 'Around 0.02/pm is typical for a single bond.')
  }

  const outTo = Math.min(12, Math.max(1.5, settings.outTo ?? 4))
  const points = Math.min(3000, Math.max(40, Math.round(settings.points ?? 400)))

  const V = (r: number): number => depth * (1 - Math.exp(-width * (r - length))) ** 2
  // The second derivative at the minimum: 2Da². That is the spring the bond behaves as, for small stretches.
  const k = 2 * depth * width * width
  const H = (r: number): number => 0.5 * k * (r - length) ** 2

  const r: number[] = []
  const energy: number[] = []
  const harmonic: number[] = []
  // Start a little in from zero: the potential climbs very steeply and a point at r = 0 would set the scale.
  const from = length * 0.45
  const to = length * outTo
  for (let i = 0; i < points; i += 1) {
    const at = from + ((to - from) * i) / (points - 1)
    r.push(at)
    energy.push(V(at))
    harmonic.push(H(at))
  }

  // Where it has climbed to half the well depth on the stretching side. r₀ − ln(1 − √½)/a, exactly.
  const halfWay = length - Math.log(1 - Math.SQRT1_2) / width

  let fails: number | null = null
  for (let i = 0; i < r.length; i += 1) {
    if (r[i] <= length) continue
    if (Math.abs(harmonic[i] - energy[i]) > depth * 0.1) {
      fails = r[i]
      break
    }
  }

  return { r, energy, harmonic, forceConstant: k, halfWay, harmonicFailsAt: fails }
}

// ---------------------------------------------------------------- a reaction

export interface ReactionSettings {
  /** How much higher the barrier is than the reactants, in kJ/mol. */
  barrier: number
  /** Products minus reactants, in kJ/mol. Negative is exothermic. */
  change: number
  /** Where along the path the barrier sits, 0 to 1. Early for exothermic, late for endothermic. */
  barrierAt?: number
  /** A second barrier and intermediate, for a two-step reaction. */
  secondBarrier?: number
  points?: number
}

export interface ReactionPath {
  /** Reaction coordinate, 0 at reactants and 1 at products. */
  x: readonly number[]
  /** Energy in kJ/mol, with reactants at zero. */
  energy: readonly number[]
  /** The barrier the reaction has to climb, forwards, in kJ/mol. */
  forward: number
  /** And backwards, from products. */
  backward: number
  /** Where the highest point is along the path. */
  peakAt: number
  /** Is it exothermic? */
  exothermic: boolean
  /** The intermediate's energy, for a two-step reaction. */
  intermediate: number | null
  /** Which step is the slow one, for a two-step reaction. */
  slowStep: 1 | 2 | null
}

/**
 * The energy along a reaction path.
 *
 * Built from Gaussian humps on a sloping line rather than from a polynomial fit, because a polynomial through
 * four points oscillates — it dips below the reactants before the barrier and reports a forward barrier lower
 * than the one asked for. The hump is monotonic on each side by construction.
 */
export function reactionPath(settings: ReactionSettings): ReactionPath | LandscapeProblem {
  const { barrier, change } = settings
  if (!Number.isFinite(barrier) || barrier < 0) {
    return no('The barrier cannot be negative.', 'A reaction with no barrier needs no activation energy; use 0.')
  }
  if (!Number.isFinite(change)) return no('The energy change must be a number.', 'Negative is exothermic.')
  if (barrier < Math.max(0, change)) {
    return no(
      `A barrier of ${barrier} kJ/mol is below the products at ${change} kJ/mol.`,
      'The barrier is measured from the reactants, so it can never be lower than an endothermic product.'
    )
  }

  const at = Math.min(0.9, Math.max(0.1, settings.barrierAt ?? (change < 0 ? 0.4 : 0.6)))
  const points = Math.min(2000, Math.max(40, Math.round(settings.points ?? 300)))
  const second = Number.isFinite(settings.secondBarrier ?? NaN) ? (settings.secondBarrier as number) : null

  const hump = (t: number, centre: number, height: number, width: number): number =>
    height * Math.exp(-((t - centre) ** 2) / (2 * width * width))

  const x: number[] = []
  /*
   * The baseline and the hump are kept apart on purpose.
   *
   * Adding a hump of height H does not raise the peak by H: the baseline is already sloping away underneath it,
   * so an 80 kJ/mol barrier on a reaction that drops 40 came out as 65. Keeping them separate means the scale
   * that makes the peak exactly right can be solved for, in one division, rather than guessed at.
   */
  const baseline: number[] = []
  const bump: number[] = []

  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1)
    // The sloping line from reactants to products, smooth at both ends.
    baseline.push(change * (0.5 - 0.5 * Math.cos(Math.PI * t)))
    bump.push(
      second === null
        ? hump(t, at, 1, 0.16)
        : hump(t, at * 0.6, 1, 0.1) + hump(t, 1 - (1 - at) * 0.4, second / Math.max(1e-9, barrier), 0.1)
    )
    x.push(t)
  }

  /*
   * The scale that puts the peak exactly at the barrier.
   *
   * Found by looking at where the peak is with an unscaled hump, then solving for the height that lands it on
   * the asked-for number. Twice, because scaling can move which point is highest — after the second pass it has
   * settled, and the test holds it to within a few kJ/mol.
   */
  let scale = barrier
  for (let pass = 0; pass < 2; pass += 1) {
    let top = 0
    for (let i = 1; i < points; i += 1) {
      if (baseline[i] + scale * bump[i] > baseline[top] + scale * bump[top]) top = i
    }
    if (bump[top] <= 1e-9) break
    scale = (barrier - baseline[top]) / bump[top]
  }

  const energy: number[] = []
  for (let i = 0; i < points; i += 1) energy.push(baseline[i] + scale * bump[i])

  /*
   * Pin both ends to the values that were asked for.
   *
   * A Gaussian has tails, and the barrier's tail reaches the reactant end -- it was sitting 3.5 kJ/mol above
   * zero. So the reactants read as already part-way up their own barrier. The correction is the straight line
   * through what the two ends came out as, subtracted: it leaves the shape alone and makes both ends exact.
   */
  const liftAtStart = energy[0]
  const liftAtEnd = energy[energy.length - 1] - change
  for (let i = 0; i < energy.length; i += 1) {
    energy[i] -= liftAtStart + (liftAtEnd - liftAtStart) * x[i]
  }

  let top = 0
  for (let i = 1; i < energy.length; i += 1) if (energy[i] > energy[top]) top = i

  let middle: number | null = null
  if (second !== null) {
    // The lowest point between the two peaks is the intermediate.
    let firstPeak = 0
    for (let i = 1; i < energy.length / 2; i += 1) if (energy[i] > energy[firstPeak]) firstPeak = i
    let secondPeak = Math.floor(energy.length / 2)
    for (let i = secondPeak; i < energy.length; i += 1) if (energy[i] > energy[secondPeak]) secondPeak = i
    let low = firstPeak
    for (let i = firstPeak; i <= secondPeak; i += 1) if (energy[i] < energy[low]) low = i
    middle = energy[low]
  }

  return {
    x,
    energy,
    forward: energy[top],
    backward: energy[top] - change,
    peakAt: x[top],
    exothermic: change < 0,
    intermediate: middle,
    // The taller barrier is the slow step, because the rate goes as e^(−Ea/RT).
    slowStep: second === null ? null : barrier >= second ? 1 : 2
  }
}

// ---------------------------------------------------------------- a surface

export interface SurfaceSettings {
  /** How much of the two coordinates to cover, in arbitrary units from −span to +span. */
  span?: number
  /** How many points along each side. */
  grid?: number
  /** Depth of the two wells, in kJ/mol. */
  depth?: number
  /** How high the pass between them is above the lower well, in kJ/mol. */
  pass?: number
}

export interface Surface {
  /** The coordinate values along each side. */
  axis: readonly number[]
  /** Energy at each point, `z[row][column]`, in kJ/mol. */
  z: readonly (readonly number[])[]
  /** The two minima, as [row, column] and their energy. */
  wells: readonly { row: number; column: number; energy: number }[]
  /** The saddle: the lowest point on the highest ridge between them. */
  saddle: { row: number; column: number; energy: number } | null
  /** The barrier from the deeper well over the saddle, in kJ/mol. */
  barrier: number | null
}

/**
 * A two-well surface with a pass between them — the simplest landscape that has a real saddle point.
 *
 * The saddle is found rather than placed: every interior point is tested for being a maximum along one direction
 * and a minimum along the other, which is what a saddle is. A point merely labelled "the saddle" would be a
 * drawing, and the useful thing about a surface is that the saddle is somewhere you can look for.
 */
export function surface(settings: SurfaceSettings = {}): Surface | LandscapeProblem {
  const span = Math.min(6, Math.max(1, settings.span ?? 2.2))
  const grid = Math.min(120, Math.max(9, Math.round(settings.grid ?? 48)))
  const depth = Math.max(1, settings.depth ?? 100)
  const pass = Math.max(1, settings.pass ?? 40)

  const axis: number[] = []
  for (let i = 0; i < grid; i += 1) axis.push(-span + (2 * span * i) / (grid - 1))

  /*
   * Two Gaussian wells at (±1, 0), on a gently rising bowl so the edges go up rather than flat. The pass height
   * between them comes out of how much the two wells overlap at the origin, which is set by their width.
   */
  const width = 0.52
  const at = (x: number, y: number): number => {
    const left = -depth * Math.exp(-((x + 1) ** 2 + y * y) / (2 * width * width))
    const right = -(depth - 12) * Math.exp(-((x - 1) ** 2 + y * y) / (2 * width * width))
    const bowl = pass * 0.3 * (x * x * 0.25 + y * y)
    return left + right + bowl
  }

  const z: number[][] = axis.map((y) => axis.map((x) => at(x, y)))

  // Every local minimum, by comparison with its eight neighbours.
  const wells: { row: number; column: number; energy: number }[] = []
  for (let r = 1; r < grid - 1; r += 1) {
    for (let c = 1; c < grid - 1; c += 1) {
      const here = z[r][c]
      let lowest = true
      for (let dr = -1; dr <= 1 && lowest; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue
          if (z[r + dr][c + dc] < here) {
            lowest = false
            break
          }
        }
      }
      if (lowest) wells.push({ row: r, column: c, energy: here })
    }
  }
  wells.sort((a, b) => a.energy - b.energy)

  /*
   * The saddle: a maximum along one axis and a minimum along the other.
   *
   * Tested rather than assumed. Where several qualify, the lowest is the one the reaction actually goes over —
   * a molecule takes the lowest pass, not the first one found.
   */
  let saddle: { row: number; column: number; energy: number } | null = null
  for (let r = 1; r < grid - 1; r += 1) {
    for (let c = 1; c < grid - 1; c += 1) {
      const here = z[r][c]
      const alongX = here > z[r][c - 1] && here > z[r][c + 1]
      const alongY = here < z[r - 1][c] && here < z[r + 1][c]
      const otherWay = here < z[r][c - 1] && here < z[r][c + 1] && here > z[r - 1][c] && here > z[r + 1][c]
      if (!((alongX && alongY) || otherWay)) continue
      if (saddle === null || here < saddle.energy) saddle = { row: r, column: c, energy: here }
    }
  }

  return {
    axis,
    z,
    wells: wells.slice(0, 4),
    saddle,
    barrier: saddle !== null && wells.length > 0 ? saddle.energy - wells[0].energy : null
  }
}

/** What these models are and are not, for a screen to show beside the picture. */
export const aboutThis: readonly string[] = Object.freeze([
  'These are model potentials with parameters you set, not a quantum chemistry calculation. Give it a bond energy and a bond length and it draws the curve those imply; it cannot work out what they are for a molecule you name.',
  'The Morse curve dissociates and a harmonic spring does not. Both are drawn, so the point where treating a bond as a spring stops working is visible rather than asserted.',
  'A reaction path is a sketch of the energy along one coordinate. A real reaction moves through many coordinates at once, and the single line is a projection of that.',
  'The surface has two wells and a pass by construction. The saddle is found by testing every point, so it is where the mathematics puts it — but the surface itself is a model, not a measured one.',
  'Energies are in kJ/mol and lengths in picometres throughout. Nothing here is per-molecule.'
])
