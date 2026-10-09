/**
 * Hydrogenic orbitals, worked out rather than drawn from memory.
 *
 * ## Why this is computed
 *
 * The usual picture of a p orbital is a pair of lobes somebody drew once, and every copy since has been a copy.
 * These are the real solutions to the hydrogen-like Schrödinger equation: the radial part from the associated
 * Laguerre polynomials, the angular part from the real spherical harmonics. So the 3d orbital that has a ring
 * rather than four lobes has it because the mathematics puts it there, and the node that falls at 2a₀ falls
 * where the mathematics puts it.
 *
 * ## What it does not claim
 *
 * Hydrogen-like means one electron. For any real multi-electron atom these are the right *shapes* and the wrong
 * *energies* and *sizes*: electron–electron repulsion is not in here at all, and neither is relativity. Every
 * function that returns an energy says so, and `aboutThis` carries the limits so a screen can show them rather
 * than a manual.
 *
 * Everything is in atomic units — distances in Bohr radii, energies in Hartrees — because that is the unit
 * system the equations are written in, and converting inside each function would hide where the numbers come
 * from. `ENERGY_EV` converts when a screen wants electronvolts.
 */

export interface OrbitalName {
  /** Principal quantum number, 1 and up. */
  n: number
  /** Angular momentum, 0 (s) to n−1. */
  l: number
  /** Magnetic quantum number, −l to +l. Picks which of a set, e.g. which of the three p orbitals. */
  m: number
}

export interface OrbitalProblem {
  problem: string
  /** What to do about it. */
  fix: string
}

export const isOrbitalProblem = (held: unknown): held is OrbitalProblem =>
  typeof held === 'object' && held !== null && 'problem' in held

const no = (problem: string, fix: string): OrbitalProblem => ({ problem, fix })

/** The letter chemists use for each value of l. Past g it is alphabetical from there. */
const LETTERS = ['s', 'p', 'd', 'f', 'g', 'h', 'i']

export const letterFor = (l: number): string => LETTERS[l] ?? `l=${l}`

/** The usual label for one of a set — pz, dxy, and so on — as chemists write them. */
export function labelFor({ n, l, m }: OrbitalName): string {
  const letter = letterFor(l)
  if (l === 0) return `${n}s`
  if (l === 1) return `${n}p${m === 0 ? 'z' : m === 1 ? 'x' : 'y'}`
  if (l === 2) {
    const which = { 0: 'z²', 1: 'xz', [-1]: 'yz', 2: 'x²−y²', [-2]: 'xy' }[m]
    return `${n}d${which ?? m}`
  }
  return `${n}${letter}${m >= 0 ? `+${m}` : m}`
}

/** Whether a set of quantum numbers is one an orbital can actually have. */
export function check({ n, l, m }: OrbitalName): OrbitalProblem | null {
  if (!Number.isInteger(n) || n < 1) return no('n must be a whole number of 1 or more.', 'The lowest shell is n = 1.')
  if (!Number.isInteger(l) || l < 0) return no('l must be a whole number of 0 or more.', 'l = 0 is an s orbital.')
  if (l > n - 1) {
    return no(`With n = ${n}, l can be at most ${n - 1}.`, `There is no ${n}${letterFor(l)} orbital — the shell has no room for it.`)
  }
  if (!Number.isInteger(m) || Math.abs(m) > l) {
    return no(`With l = ${l}, m runs from −${l} to ${l}.`, `An ${letterFor(l)} subshell holds ${2 * l + 1} orbitals.`)
  }
  return null
}

// ---------------------------------------------------------------- the radial part

/** n!, for the small n these functions use. */
function factorial(n: number): number {
  let out = 1
  for (let i = 2; i <= n; i += 1) out *= i
  return out
}

/**
 * The generalised Laguerre polynomial L_k^(α)(x), by its recurrence.
 *
 * The closed form with alternating factorials loses every significant figure by n = 5; the recurrence does not.
 */
function laguerre(k: number, alpha: number, x: number): number {
  if (k === 0) return 1
  if (k === 1) return 1 + alpha - x
  let before = 1
  let here = 1 + alpha - x
  for (let i = 2; i <= k; i += 1) {
    const next = ((2 * i - 1 + alpha - x) * here - (i - 1 + alpha) * before) / i
    before = here
    here = next
  }
  return here
}

/**
 * The radial wavefunction R(r), in atomic units, for nuclear charge Z.
 *
 * `r` is in Bohr radii. The result is a probability amplitude, so it can be negative — that sign is what makes a
 * bonding and an antibonding combination different, and squaring it away before returning would lose it.
 */
export function radial(name: OrbitalName, r: number, Z = 1): number {
  const { n, l } = name
  if (r < 0) return NaN
  const rho = (2 * Z * r) / n
  const norm = Math.sqrt(
    (2 * Z / n) ** 3 * (factorial(n - l - 1) / (2 * n * factorial(n + l)))
  )
  return norm * Math.exp(-rho / 2) * rho ** l * laguerre(n - l - 1, 2 * l + 1, rho)
}

/**
 * The radial distribution, r²R², which is what "how far out is the electron" actually means.
 *
 * This is the curve with the peak at one Bohr radius for 1s — not R² itself, which peaks at the nucleus. The
 * difference is the one most often got wrong, because r² grows as fast as R² shrinks.
 *
 * No 4π. `radial` is normalised so that ∫r²R² dr = 1 — the angular part carries its own normalisation and
 * integrates to 1 separately. Including 4π here made every orbital integrate to 4π instead of 1, which the
 * normalisation test caught and nothing else would have: a constant factor leaves the shape and the peak
 * position exactly where they were.
 */
export const radialDistribution = (name: OrbitalName, r: number, Z = 1): number => {
  const R = radial(name, r, Z)
  return r * r * R * R
}

export interface RadialCurve {
  /** Distance from the nucleus, in Bohr radii. */
  r: readonly number[]
  /** The amplitude R(r). Signed. */
  R: readonly number[]
  /** The radial distribution r²R². Never negative, and integrates to 1 over all r. */
  P: readonly number[]
  /** Where R crosses zero, in Bohr radii — the radial nodes. */
  nodes: readonly number[]
  /** Where the electron is most likely to be found, in Bohr radii. */
  mostLikely: number
  /** The mean distance ⟨r⟩, worked out from the curve. */
  mean: number
}

/**
 * The radial curves for one orbital, sampled far enough out to contain it.
 *
 * How far out is computed rather than fixed: a 1s orbital is finished by 10 a₀ and a 6s one is not. Sampling a
 * fixed range would cut the tail off the big ones and waste every point on the small ones.
 */
export function radialCurve(name: OrbitalName, options: { Z?: number; points?: number } = {}): RadialCurve | OrbitalProblem {
  const bad = check(name)
  if (bad) return bad
  const Z = options.Z ?? 1
  if (!Number.isFinite(Z) || Z < 1) return no('The nuclear charge must be 1 or more.', 'Z = 1 is hydrogen.')
  const points = Math.min(4000, Math.max(50, Math.round(options.points ?? 600)))

  // ⟨r⟩ for a hydrogenic orbital is (3n² − l(l+1))/2Z. Four times that holds the whole distribution.
  const mean = (3 * name.n * name.n - name.l * (name.l + 1)) / (2 * Z)
  const far = Math.max(4, mean * 3.2)

  const r: number[] = []
  const R: number[] = []
  const P: number[] = []
  for (let i = 0; i < points; i += 1) {
    const at = (far * i) / (points - 1)
    r.push(at)
    const amp = radial(name, at, Z)
    R.push(amp)
    P.push(at * at * amp * amp)
  }

  // Where the amplitude changes sign, interpolated so a node is not reported at a sample point by luck.
  const nodes: number[] = []
  for (let i = 1; i < R.length; i += 1) {
    if (r[i] === 0) continue
    const before = R[i - 1]
    const here = R[i]
    if (before === 0 || here === 0 || (before < 0) === (here < 0)) continue
    const share = Math.abs(before) / (Math.abs(before) + Math.abs(here))
    nodes.push(r[i - 1] + share * (r[i] - r[i - 1]))
  }

  let atMost = 0
  for (let i = 1; i < P.length; i += 1) if (P[i] > P[atMost]) atMost = i

  // ⟨r⟩ from the curve, as a check on the closed form above. They agree to the sampling error.
  let weighted = 0
  let total = 0
  for (let i = 1; i < r.length; i += 1) {
    const width = r[i] - r[i - 1]
    const height = (P[i] + P[i - 1]) / 2
    const middle = (r[i] + r[i - 1]) / 2
    weighted += middle * height * width
    total += height * width
  }

  return {
    r,
    R,
    P,
    nodes,
    mostLikely: r[atMost],
    mean: total > 0 ? weighted / total : mean
  }
}

// ---------------------------------------------------------------- the angular part

/**
 * The real spherical harmonic for (l, m), as a function of direction.
 *
 * Real rather than complex, because the real combinations are the orbitals chemists use: p_x and p_y instead of
 * m = ±1. The sign is kept, because the sign is the lobe.
 */
export function angular({ l, m }: Pick<OrbitalName, 'l' | 'm'>, theta: number, phi: number): number {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const k = Math.abs(m)

  // Written out to l = 3. Past that the recurrence is needed, and nothing here asks for it.
  const P: Record<string, number> = {
    '0,0': 1,
    '1,0': c,
    '1,1': s,
    '2,0': 0.5 * (3 * c * c - 1),
    '2,1': 3 * s * c,
    '2,2': 3 * s * s,
    '3,0': 0.5 * (5 * c ** 3 - 3 * c),
    '3,1': 1.5 * s * (5 * c * c - 1),
    '3,2': 15 * s * s * c,
    '3,3': 15 * s ** 3
  }
  const legendre = P[`${l},${k}`]
  if (legendre === undefined) return NaN

  const norm = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (factorial(l - k) / factorial(l + k)))
  if (m === 0) return norm * legendre
  const turn = m > 0 ? Math.cos(k * phi) : Math.sin(k * phi)
  return Math.SQRT2 * norm * legendre * turn
}

export interface Lobe {
  /** A point on the surface where |angular| is this value, in Cartesian atomic units. */
  x: number
  y: number
  z: number
  /** The sign of the wavefunction there. The two signs are what make a node a node. */
  sign: 1 | -1
}

/**
 * The shape of an orbital, as points on the surface where the angular part has a fixed magnitude.
 *
 * The radius at each direction is |Y(θ, φ)| scaled by where the radial distribution peaks, so a 3p is drawn
 * larger than a 2p — which it is. Drawing every orbital at the same size is the other thing the textbook
 * pictures get wrong.
 */
export function shape(name: OrbitalName, options: { rings?: number; Z?: number } = {}): readonly Lobe[] | OrbitalProblem {
  const bad = check(name)
  if (bad) return bad
  const rings = Math.min(96, Math.max(8, Math.round(options.rings ?? 40)))
  const curve = radialCurve(name, { Z: options.Z })
  if (isOrbitalProblem(curve)) return curve
  const size = Math.max(0.6, curve.mostLikely)

  const out: Lobe[] = []
  for (let i = 0; i <= rings; i += 1) {
    const theta = (Math.PI * i) / rings
    // Fewer points near the poles, where the circles of latitude are short -- otherwise they crowd.
    const around = Math.max(4, Math.round(2 * rings * Math.sin(theta)) || 4)
    for (let j = 0; j < around; j += 1) {
      const phi = (2 * Math.PI * j) / around
      const amp = angular(name, theta, phi)
      if (!Number.isFinite(amp)) continue
      const radius = Math.abs(amp) * size * 2.2
      if (radius < 1e-4) continue
      out.push({
        x: radius * Math.sin(theta) * Math.cos(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(theta),
        sign: amp >= 0 ? 1 : -1
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- energies and counts

/** One Hartree in electronvolts, for a screen that wants the unit people quote. */
export const ENERGY_EV = 27.211386245988

/**
 * The energy of a hydrogenic orbital, in Hartrees.
 *
 * −Z²/2n². It depends on n alone, which is why 2s and 2p are the same energy here and are not in any real atom
 * with more than one electron. That is the single biggest thing this model leaves out.
 */
export const energy = (n: number, Z = 1): number => (-(Z * Z) / (2 * n * n))

export interface OrbitalFacts {
  label: string
  /** Radial nodes: n − l − 1. Spheres where the electron is never found. */
  radialNodes: number
  /** Angular nodes: l. Planes or cones through the nucleus. */
  angularNodes: number
  /** Both together: n − 1, always. */
  totalNodes: number
  /** How many orbitals share this n and l. */
  inSubshell: number
  /** Energy in Hartrees, and in electronvolts. */
  energyHartree: number
  energyEv: number
  /** ⟨r⟩ in Bohr radii. */
  meanRadius: number
  /** Where the radial distribution peaks, in Bohr radii. */
  mostLikelyRadius: number
}

/** Everything worth stating about one orbital, each number worked out rather than looked up. */
export function facts(name: OrbitalName, Z = 1): OrbitalFacts | OrbitalProblem {
  const bad = check(name)
  if (bad) return bad
  const curve = radialCurve(name, { Z })
  if (isOrbitalProblem(curve)) return curve
  const e = energy(name.n, Z)
  return {
    label: labelFor(name),
    radialNodes: name.n - name.l - 1,
    angularNodes: name.l,
    totalNodes: name.n - 1,
    inSubshell: 2 * name.l + 1,
    energyHartree: e,
    energyEv: e * ENERGY_EV,
    meanRadius: (3 * name.n * name.n - name.l * (name.l + 1)) / (2 * Z),
    mostLikelyRadius: curve.mostLikely
  }
}

/** Every orbital up to a shell, in the order they fill — the Madelung order, n + l then n. */
export function fillingOrder(upTo: number): readonly OrbitalName[] {
  const out: OrbitalName[] = []
  for (let sum = 1; sum <= 2 * upTo; sum += 1) {
    /*
     * Within one n + l group, the LOWER n fills first — which means the higher l, counted down.
     *
     * Counting l up put 3s before 2p, and 4s before 3p. The whole reason the Madelung order is worth stating is
     * that 4s fills before 3d, and an order that gets the tie-break backwards gets that wrong too.
     */
    for (let l = upTo - 1; l >= 0; l -= 1) {
      const n = sum - l
      if (n < 1 || n > upTo || l > n - 1) continue
      for (let m = -l; m <= l; m += 1) out.push({ n, l, m })
    }
  }
  return out
}

/** What this model is and is not, for a screen to show beside the picture rather than in a manual. */
export const aboutThis: readonly string[] = Object.freeze([
  'These are hydrogen-like orbitals: one electron around a nucleus of charge Z. The shapes are exact.',
  'The energies are not right for any atom with more than one electron — electron–electron repulsion is not in this model, which is why 2s and 2p come out at the same energy here and are not in reality.',
  'The sizes scale as 1/Z, so a higher Z draws the same shape smaller. A real atom shields its outer electrons, so the real contraction is weaker than this.',
  'Nothing relativistic. For heavy elements the inner s orbitals really are contracted and this does not show it.',
  'The surface drawn is where the angular part has a fixed value, scaled by where the radial distribution peaks. It is not a boundary the electron stays inside.'
])
