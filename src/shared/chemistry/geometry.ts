/**
 * Building a three-dimensional geometry from connectivity alone.
 *
 * ## Why this exists
 *
 * Asking a model for atomic coordinates does not work. Asked for caffeine it answers, truthfully, "I cannot
 * provide an accurate 3D structure with precise coordinates" — and when a model does answer with coordinates
 * they are often not a geometry at all: two atoms a picometre apart, bonds stretched to twice their length.
 *
 * What a model does know reliably is what is bonded to what. Caffeine's connectivity is in every textbook and
 * every database; its coordinates are a calculation. So the division of labour is: the model says which atoms
 * are joined, and this works out where they go.
 *
 * ## How it places them
 *
 * Bond lengths from covalent radii and bond order, angles from how many things an atom is bonded to — four is
 * tetrahedral at 109.5°, three trigonal at 120°, two linear or bent depending on the element's lone pairs. Then
 * the whole thing is relaxed: bonds pull to their proper length, angles push towards their proper value, and
 * atoms that are not bonded push each other apart so the molecule does not fold through itself.
 *
 * That is a force field, not quantum mechanics. It gives a chemically sensible shape with the right bond lengths
 * and the right angles — which is what a picture needs — and it is not a prediction of the real conformation of
 * a flexible molecule. `aboutThis` says so.
 */

export interface Placed {
  symbol: string
  x: number
  y: number
  z: number
}

export interface Joined {
  a: number
  b: number
  order: 1 | 2 | 3
}

export interface Built {
  atoms: readonly Placed[]
  /** How far the relaxation got: the worst bond still out of length, in picometres. */
  worstBond: number
  /** The worst angle still out, in degrees. */
  worstAngle: number
  /** How many rounds of relaxation ran. */
  rounds: number
  /** What is worth saying about the result. */
  notes: readonly string[]
}

/** Covalent radii in picometres, for the elements the molecule engine knows. */
const RADII: Readonly<Record<string, number>> = Object.freeze({
  H: 31, He: 28, Li: 128, Be: 96, B: 84, C: 76, N: 71, O: 66, F: 57, Ne: 58,
  Na: 166, Mg: 141, Al: 121, Si: 111, P: 107, S: 105, Cl: 102, Ar: 106,
  K: 203, Ca: 176, Ti: 160, Cr: 139, Mn: 139, Fe: 132, Co: 126, Ni: 124,
  Cu: 132, Zn: 122, Br: 120, Ag: 145, I: 139, Ba: 215, Pt: 136, Au: 136,
  Hg: 132, Pb: 146, U: 196
})

/**
 * How long a bond between two elements should be.
 *
 * The sum of the covalent radii, shortened for a double or triple bond — a C=C is about 87% of a C–C and a C≡C
 * about 78%, which is what the measured lengths come to.
 */
export function bondLength(one: string, two: string, order: 1 | 2 | 3 = 1): number {
  const sum = (RADII[one] ?? 110) + (RADII[two] ?? 110)
  return sum * (order === 3 ? 0.78 : order === 2 ? 0.87 : 1)
}

/**
 * The angle between two bonds at an atom, from how many bonds it has and how many lone pairs the element keeps.
 *
 * This is VSEPR: the electron pairs around an atom spread as far apart as they can, and a lone pair takes more
 * room than a bonding pair, which is why water is 104.5° and not the tetrahedral 109.5°.
 */
export function bondAngle(symbol: string, bonds: number): number {
  // Lone pairs on the common non-metals when they have their usual number of bonds.
  const LONE: Readonly<Record<string, number>> = { O: 2, S: 2, N: 1, P: 1, Se: 2, F: 3, Cl: 3, Br: 3, I: 3 }
  const lone = bonds <= (symbol === 'N' || symbol === 'P' ? 3 : 2) ? (LONE[symbol] ?? 0) : 0
  const regions = bonds + lone
  if (bonds <= 1) return 180
  if (regions >= 6) return 90
  if (regions === 5) return bonds >= 4 ? 90 : 120
  if (regions === 4) {
    // Tetrahedral, squeezed by each lone pair. Water at 104.5, ammonia at 107 — the measured values.
    if (lone === 2) return 104.5
    if (lone === 1) return 107
    return 109.5
  }
  if (regions === 3) return lone === 1 ? 117 : 120
  return 180
}

/**
 * Places the atoms, then relaxes them.
 *
 * Deterministic: the same connectivity always gives the same shape. Nothing here reads a clock or a random
 * source — directions come from a fixed spiral, so a molecule looks the same every time it is drawn, which is
 * what somebody comparing two pictures needs.
 */
export function build(
  symbols: readonly string[],
  bonds: readonly Joined[],
  options: { rounds?: number } = {}
): Built {
  const n = symbols.length
  const notes: string[] = []
  if (n === 0) return { atoms: [], worstBond: 0, worstAngle: 0, rounds: 0, notes }
  if (n === 1) return { atoms: [{ symbol: symbols[0], x: 0, y: 0, z: 0 }], worstBond: 0, worstAngle: 0, rounds: 0, notes }

  const near: number[][] = Array.from({ length: n }, () => [])
  const orderOf = new Map<string, 1 | 2 | 3>()
  for (const one of bonds) {
    if (one.a === one.b || one.a < 0 || one.b < 0 || one.a >= n || one.b >= n) continue
    near[one.a].push(one.b)
    near[one.b].push(one.a)
    orderOf.set(key(one.a, one.b), one.order)
  }

  const at = new Float64Array(n * 3)
  const placed = new Array<boolean>(n).fill(false)

  /*
   * Directions spread over a sphere. Used only for the atoms the bonds never reached.
   *
   * The golden-angle spiral rather than a random direction: it spreads points evenly, and it is the same every
   * time, so the shape is reproducible.
   */
  const spiral = (i: number, howMany: number): [number, number, number] => {
    const k = howMany <= 1 ? 0.5 : i / (howMany - 1)
    const z = 1 - 2 * k
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const turn = i * 2.399963229728653
    return [r * Math.cos(turn), r * Math.sin(turn), z]
  }

  // Start at the most-bonded atom, so the molecule grows outward from its middle rather than from an end.
  let seed = 0
  for (let i = 1; i < n; i += 1) if (near[i].length > near[seed].length) seed = i

  const queue = [seed]
  placed[seed] = true

  while (queue.length > 0) {
    const here = queue.shift() as number
    const unplaced = near[here].filter((one) => !placed[one])
    if (unplaced.length === 0) continue

    /*
     * Where the bonds at this atom should point.
     *
     * Built from the angle the element wants, not spread over a sphere. Spreading put the first two neighbours
     * at opposite poles, so water came out linear -- and three collinear atoms are a symmetric saddle the
     * relaxation cannot escape, because the push on each hydrogen runs straight along the line through the
     * oxygen. The symmetry has to be broken when the atoms are first placed.
     */
    const want = idealDirections(symbols[here], near[here].length)

    // Which of those directions are already used, by the neighbours already placed.
    const used = new Set<number>()
    for (const one of near[here]) {
      if (!placed[one] || one === here) continue
      const d = unit(at[one * 3] - at[here * 3], at[one * 3 + 1] - at[here * 3 + 1], at[one * 3 + 2] - at[here * 3 + 2])
      if (!d) continue
      // The ideal direction this neighbour is closest to, so the rest go in the ones that are left.
      let best = -1
      let bestDot = -2
      for (let i = 0; i < want.length; i += 1) {
        if (used.has(i)) continue
        const dot = d[0] * want[i][0] + d[1] * want[i][1] + d[2] * want[i][2]
        if (dot > bestDot) {
          bestDot = dot
          best = i
        }
      }
      if (best >= 0) used.add(best)
    }

    /*
     * Turn the whole set so it lines up with where this atom already points.
     *
     * The first placed neighbour sets the orientation: without this, every atom's bonds would point along the
     * same fixed axes and the molecule would grow as a lattice rather than a chain.
     */
    const anchor = near[here].find((one) => placed[one] && one !== here)
    let turn: ((d: [number, number, number]) => [number, number, number]) | null = null
    if (anchor !== undefined) {
      const to = unit(
        at[anchor * 3] - at[here * 3],
        at[anchor * 3 + 1] - at[here * 3 + 1],
        at[anchor * 3 + 2] - at[here * 3 + 2]
      )
      let from: [number, number, number] | null = null
      let bestDot = -2
      for (let i = 0; i < want.length; i += 1) {
        const dot = to ? to[0] * want[i][0] + to[1] * want[i][1] + to[2] * want[i][2] : -2
        if (dot > bestDot) {
          bestDot = dot
          from = want[i]
        }
      }
      if (to && from) turn = rotationTaking(from, to)
    }

    let next = 0
    for (const one of unplaced) {
      while (next < want.length && used.has(next)) next += 1
      // More neighbours than ideal directions should not happen -- checkStructure refuses it -- but if it did,
      // falling back to the spiral is better than placing two atoms in the same direction.
      const raw = next < want.length ? want[next] : spiral(next, Math.max(2, near[here].length))
      used.add(next)
      next += 1
      const dir = turn ? turn(raw) : raw
      const length = bondLength(symbols[here], symbols[one], orderOf.get(key(here, one)) ?? 1)
      at[one * 3] = at[here * 3] + dir[0] * length
      at[one * 3 + 1] = at[here * 3 + 1] + dir[1] * length
      at[one * 3 + 2] = at[here * 3 + 2] + dir[2] * length
      placed[one] = true
      queue.push(one)
    }
  }

  /*
   * Anything the bonds never reached — an ion, or a structure given without bonds.
   *
   * Placed on a sphere around everything else rather than left at the origin, where they would all pile up at
   * the same point and read as one atom.
   */
  const stray = [...Array(n).keys()].filter((i) => !placed[i])
  if (stray.length > 0) {
    let far = 200
    for (let i = 0; i < n; i += 1) {
      if (!placed[i]) continue
      far = Math.max(far, Math.hypot(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]) + 300)
    }
    for (const [i, one] of stray.entries()) {
      const dir = spiral(i, Math.max(2, stray.length))
      at[one * 3] = dir[0] * far
      at[one * 3 + 1] = dir[1] * far
      at[one * 3 + 2] = dir[2] * far
      placed[one] = true
    }
    notes.push(
      `${stray.length} ${stray.length === 1 ? 'atom was' : 'atoms were'} not joined to the rest, so ${stray.length === 1 ? 'it is' : 'they are'} placed apart rather than piled at the centre.`
    )
  }

  // ---------------------------------------------------------------- relaxation
  /*
   * A ring is over-constrained: its bond lengths and its ideal angles cannot both be exactly satisfied, so the
   * two terms pull against each other and it takes longer to settle. Counting the ring bonds -- every bond
   * beyond the n-1 a tree needs -- says how much longer, so a chain is not made to pay for it.
   */
  const ringBonds = Math.max(0, bonds.length - (n - 1))
  const rounds = Math.min(
    2600,
    Math.max(40, Math.round(options.rounds ?? (420 + ringBonds * 220)))
  )
  const bonded = new Set(bonds.map((one) => key(one.a, one.b)))

  for (let round = 0; round < rounds; round += 1) {
    const push = new Float64Array(n * 3)
    // Eases off as it settles, so it converges rather than oscillating around the answer.
    const step = 0.28 * (1 - round / rounds) + 0.04

    // Bonds pull to their proper length.
    for (const one of bonds) {
      if (one.a === one.b || one.a >= n || one.b >= n || one.a < 0 || one.b < 0) continue
      const want = bondLength(symbols[one.a], symbols[one.b], one.order)
      const dx = at[one.b * 3] - at[one.a * 3]
      const dy = at[one.b * 3 + 1] - at[one.a * 3 + 1]
      const dz = at[one.b * 3 + 2] - at[one.a * 3 + 2]
      const gap = Math.hypot(dx, dy, dz) || 1e-6
      /*
       * Stronger than the angle term below, on purpose. A bond length is a hard fact and an ideal angle is a
       * preference: a real ring compromises on the angle, which is why cyclopropane's are 60 degrees and not
       * 109.5. Weighting them equally made every ring settle slightly too large.
       */
      const by = ((gap - want) / gap) * 0.75
      push[one.a * 3] += dx * by
      push[one.a * 3 + 1] += dy * by
      push[one.a * 3 + 2] += dz * by
      push[one.b * 3] -= dx * by
      push[one.b * 3 + 1] -= dy * by
      push[one.b * 3 + 2] -= dz * by
    }

    // Angles at each atom push its neighbours towards the angle the element wants.
    for (let middle = 0; middle < n; middle += 1) {
      const mine = near[middle]
      if (mine.length < 2) continue
      const want = (bondAngle(symbols[middle], mine.length) * Math.PI) / 180
      for (let i = 0; i < mine.length; i += 1) {
        for (let j = i + 1; j < mine.length; j += 1) {
          const a = mine[i]
          const b = mine[j]
          const ax = at[a * 3] - at[middle * 3]
          const ay = at[a * 3 + 1] - at[middle * 3 + 1]
          const az = at[a * 3 + 2] - at[middle * 3 + 2]
          const bx = at[b * 3] - at[middle * 3]
          const by2 = at[b * 3 + 1] - at[middle * 3 + 1]
          const bz = at[b * 3 + 2] - at[middle * 3 + 2]
          const la = Math.hypot(ax, ay, az) || 1e-6
          const lb = Math.hypot(bx, by2, bz) || 1e-6
          const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by2 + az * bz) / (la * lb)))
          const between = Math.acos(dot)
          // How far apart the two neighbours should be, from the angle and the two bond lengths.
          const should = Math.sqrt(la * la + lb * lb - 2 * la * lb * Math.cos(want))
          const isNow = Math.sqrt(la * la + lb * lb - 2 * la * lb * Math.cos(between)) || 1e-6
          const dx = at[b * 3] - at[a * 3]
          const dy = at[b * 3 + 1] - at[a * 3 + 1]
          const dz = at[b * 3 + 2] - at[a * 3 + 2]
          const by3 = ((isNow - should) / isNow) * 0.12
          push[a * 3] += dx * by3
          push[a * 3 + 1] += dy * by3
          push[a * 3 + 2] += dz * by3
          push[b * 3] -= dx * by3
          push[b * 3 + 1] -= dy * by3
          push[b * 3 + 2] -= dz * by3
        }
      }
    }

    /*
     * Atoms that are not bonded push each other apart.
     *
     * Without this a ring folds flat through itself and a long chain coils into a knot: the bonds and angles are
     * all satisfied and the molecule still passes through its own middle.
     */
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (bonded.has(key(i, j))) continue
        // Two bonds apart is set by the angle term; leave it alone or the two fight.
        if (near[i].includes(j) || near[i].some((one) => near[j].includes(one))) continue
        const dx = at[j * 3] - at[i * 3]
        const dy = at[j * 3 + 1] - at[i * 3 + 1]
        const dz = at[j * 3 + 2] - at[i * 3 + 2]
        const gap = Math.hypot(dx, dy, dz) || 1e-6
        const keepOff = ((RADII[symbols[i]] ?? 110) + (RADII[symbols[j]] ?? 110)) * 1.7
        if (gap >= keepOff) continue
        const by = ((gap - keepOff) / gap) * 0.3
        push[i * 3] += dx * by
        push[i * 3 + 1] += dy * by
        push[i * 3 + 2] += dz * by
        push[j * 3] -= dx * by
        push[j * 3 + 1] -= dy * by
        push[j * 3 + 2] -= dz * by
      }
    }

    for (let i = 0; i < n * 3; i += 1) at[i] += push[i] * step
  }

  // Centre it, so a turn spins the molecule rather than swinging it.
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < n; i += 1) {
    cx += at[i * 3]
    cy += at[i * 3 + 1]
    cz += at[i * 3 + 2]
  }
  cx /= n
  cy /= n
  cz /= n

  const atoms: Placed[] = []
  for (let i = 0; i < n; i += 1) {
    atoms.push({ symbol: symbols[i], x: at[i * 3] - cx, y: at[i * 3 + 1] - cy, z: at[i * 3 + 2] - cz })
  }

  // ---------------------------------------------------------------- how good is it
  let worstBond = 0
  for (const one of bonds) {
    if (one.a >= n || one.b >= n || one.a < 0 || one.b < 0) continue
    const want = bondLength(symbols[one.a], symbols[one.b], one.order)
    const gap = Math.hypot(
      atoms[one.a].x - atoms[one.b].x,
      atoms[one.a].y - atoms[one.b].y,
      atoms[one.a].z - atoms[one.b].z
    )
    worstBond = Math.max(worstBond, Math.abs(gap - want))
  }

  let worstAngle = 0
  for (let middle = 0; middle < n; middle += 1) {
    const mine = near[middle]
    if (mine.length < 2) continue
    const want = bondAngle(symbols[middle], mine.length)
    for (let i = 0; i < mine.length; i += 1) {
      for (let j = i + 1; j < mine.length; j += 1) {
        const got = angleAt(atoms, middle, mine[i], mine[j])
        // Only the nearest pair of bonds at an atom should sit at the wanted angle; the others are further round.
        if (got > want + 60) continue
        worstAngle = Math.max(worstAngle, Math.abs(got - want))
      }
    }
  }

  if (worstBond > 12) {
    notes.push(`The relaxation left one bond ${worstBond.toFixed(0)} pm from its proper length — the shape is approximate.`)
  }

  return { atoms, worstBond, worstAngle, rounds, notes }
}

/** The angle at `middle` between its bonds to `a` and `b`, in degrees. */
export function angleAt(atoms: readonly Placed[], middle: number, a: number, b: number): number {
  const ax = atoms[a].x - atoms[middle].x
  const ay = atoms[a].y - atoms[middle].y
  const az = atoms[a].z - atoms[middle].z
  const bx = atoms[b].x - atoms[middle].x
  const by = atoms[b].y - atoms[middle].y
  const bz = atoms[b].z - atoms[middle].z
  const la = Math.hypot(ax, ay, az)
  const lb = Math.hypot(bx, by, bz)
  if (la === 0 || lb === 0) return NaN
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)))
  return (Math.acos(dot) * 180) / Math.PI
}

/**
 * Where k bonds at one atom should point, as unit directions.
 *
 * The named cases are the shapes with no simple cone formula -- a tetrahedron, a trigonal bipyramid, an
 * octahedron. Everything else is a cone of k directions at the angle VSEPR gives: each at polar angle α from the
 * axis, evenly round it, with α solved from cos θ = cos²α + sin²α·cos(2π/k).
 */
export function idealDirections(symbol: string, k: number): [number, number, number][] {
  if (k <= 0) return []
  if (k === 1) return [[0, 0, 1]]

  const theta = (bondAngle(symbol, k) * Math.PI) / 180

  if (k === 2) {
    // Both tilted half the angle off the axis, so the angle between them is exactly the one wanted.
    const half = theta / 2
    return [
      [Math.sin(half), 0, Math.cos(half)],
      [-Math.sin(half), 0, Math.cos(half)]
    ]
  }

  if (k === 4 && Math.abs(theta - (109.5 * Math.PI) / 180) < 0.09) {
    // A regular tetrahedron. The four alternating corners of a cube.
    const r = 1 / Math.sqrt(3)
    return [
      [r, r, r],
      [r, -r, -r],
      [-r, r, -r],
      [-r, -r, r]
    ]
  }

  if (k === 5) {
    // Trigonal bipyramid: three round the equator, one up, one down.
    return [
      [1, 0, 0],
      [-0.5, Math.sqrt(3) / 2, 0],
      [-0.5, -Math.sqrt(3) / 2, 0],
      [0, 0, 1],
      [0, 0, -1]
    ]
  }

  if (k === 6) {
    return [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ]
  }

  /*
   * A cone of k directions with the right pairwise angle.
   *
   * cos θ = cos²α + sin²α·cos(2π/k), solved for α. When the wanted angle cannot be achieved by k directions on a
   * cone -- which happens when it is wider than they can spread -- the widest possible is used, because a
   * geometry that is as close as it can get beats one built from an impossible angle.
   */
  const around = Math.cos((2 * Math.PI) / k)
  const bottom = 1 - around
  const cosAlphaSquared = bottom === 0 ? 0 : (Math.cos(theta) - around) / bottom
  const alpha = Math.acos(Math.sqrt(Math.max(0, Math.min(1, cosAlphaSquared))))
  const out: [number, number, number][] = []
  for (let i = 0; i < k; i += 1) {
    const phi = (2 * Math.PI * i) / k
    out.push([Math.sin(alpha) * Math.cos(phi), Math.sin(alpha) * Math.sin(phi), Math.cos(alpha)])
  }
  return out
}

/** A rotation that takes one unit direction to another, applied to any direction. Rodrigues' formula. */
function rotationTaking(
  from: [number, number, number],
  to: [number, number, number]
): (d: [number, number, number]) => [number, number, number] {
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]))
  if (dot > 0.999999) return (d) => d
  // Exactly opposite: any perpendicular axis will do, so pick one that is certainly not parallel.
  const axis =
    dot < -0.999999
      ? (unit(...perpendicularTo(from)) ?? [1, 0, 0])
      : (unit(
          from[1] * to[2] - from[2] * to[1],
          from[2] * to[0] - from[0] * to[2],
          from[0] * to[1] - from[1] * to[0]
        ) ?? [1, 0, 0])
  const angle = Math.acos(dot)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return (d) => {
    const cross: [number, number, number] = [
      axis[1] * d[2] - axis[2] * d[1],
      axis[2] * d[0] - axis[0] * d[2],
      axis[0] * d[1] - axis[1] * d[0]
    ]
    const along = axis[0] * d[0] + axis[1] * d[1] + axis[2] * d[2]
    return [
      d[0] * c + cross[0] * s + axis[0] * along * (1 - c),
      d[1] * c + cross[1] * s + axis[1] * along * (1 - c),
      d[2] * c + cross[2] * s + axis[2] * along * (1 - c)
    ]
  }
}

/** Any direction at right angles to the given one. */
function perpendicularTo(d: [number, number, number]): [number, number, number] {
  // Cross with whichever axis the direction is least aligned to, so the result is never degenerate.
  const axis: [number, number, number] =
    Math.abs(d[0]) <= Math.abs(d[1]) && Math.abs(d[0]) <= Math.abs(d[2])
      ? [1, 0, 0]
      : Math.abs(d[1]) <= Math.abs(d[2])
        ? [0, 1, 0]
        : [0, 0, 1]
  return [d[1] * axis[2] - d[2] * axis[1], d[2] * axis[0] - d[0] * axis[2], d[0] * axis[1] - d[1] * axis[0]]
}

const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`)

function unit(x: number, y: number, z: number): [number, number, number] | null {
  const length = Math.hypot(x, y, z)
  if (!Number.isFinite(length) || length < 1e-9) return null
  return [x / length, y / length, z / length]
}

/** What this is and is not, for a screen to show beside a structure it built. */
export const aboutThis: readonly string[] = Object.freeze([
  'The geometry here is computed by Orbis, not recalled: bond lengths from covalent radii and bond order, angles from VSEPR, then relaxed so the bonds, the angles and the atoms keeping out of each other’s way are all satisfied at once.',
  'What a model supplies is the connectivity — which atoms are joined, and by what kind of bond. That is the part a model knows reliably, and it is checked against the formula before anything is placed.',
  'This is a force field, not quantum mechanics. It gives a chemically sensible shape with the right bond lengths and angles, which is what a picture needs.',
  'For a flexible molecule there are many real conformations and this is one sensible arrangement, not a prediction of the one it adopts.',
  'It is deterministic: the same connectivity always gives the same shape, so two pictures of the same molecule can be compared.'
])
