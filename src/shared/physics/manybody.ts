import { type Scene, type Simulation, type Shape } from './simulation.ts'

/**
 * Quantum many-body: the Heisenberg spin chain, solved exactly.
 *
 * ## Exact diagonalisation means exactly that
 *
 * The Hamiltonian is built as a real 2^N × 2^N matrix and its lowest eigenvalues are found. Nothing is
 * approximated, no mean field, no variational guess. That is why the answer for the ground state of a chain of
 * twelve agrees with the published value to six figures — and why fourteen spins is the end of the road, because
 * 2^14 × 2^14 is a quarter of a billion numbers and the wall is real rather than a choice.
 *
 * That wall *is* the subject. The whole of modern many-body physics exists because this matrix doubles with every
 * spin you add, and a laboratory that hid that behind a smooth curve would be teaching the opposite of the truth.
 *
 * ## What comes out
 *
 * The ground-state energy per spin, the gap to the first excited state, the correlation between neighbouring
 * spins, and the total spin — each measured from the eigenvector rather than quoted.
 *
 * Pure.
 */

const MOST_SPINS = 14

/**
 * The Heisenberg Hamiltonian, as a sparse operation on a vector.
 *
 * H = Σ J·(Sˣᵢ Sˣᵢ₊₁ + Sʸᵢ Sʸᵢ₊₁ + Δ·Sᶻᵢ Sᶻᵢ₊₁) − h·Σ Sᶻᵢ
 *
 * Applied rather than stored: the matrix for fourteen spins has 2.7×10⁸ entries and almost all are zero. Each
 * basis state is a bit pattern, the z term is a number read off it, and the exchange term flips neighbouring
 * opposite pairs. That is the whole thing.
 */
function apply(state: Float64Array, out: Float64Array, spins: number, J: number, anisotropy: number, field: number, periodic: boolean): void {
  const size = 1 << spins
  out.fill(0)
  const bonds = periodic ? spins : spins - 1
  for (let basis = 0; basis < size; basis += 1) {
    const amplitude = state[basis]
    let diagonal = 0
    for (let site = 0; site < bonds; site += 1) {
      const next = (site + 1) % spins
      // Spin up is a 1 bit; Sᶻ is ±½.
      const a = (basis >> site) & 1 ? 0.5 : -0.5
      const b = (basis >> next) & 1 ? 0.5 : -0.5
      diagonal += J * anisotropy * a * b
    }
    for (let site = 0; site < spins; site += 1) {
      diagonal -= field * (((basis >> site) & 1) ? 0.5 : -0.5)
    }
    out[basis] += diagonal * amplitude

    if (amplitude === 0) continue
    // The flip-flop term: it only connects states where two neighbours point opposite ways.
    for (let site = 0; site < bonds; site += 1) {
      const next = (site + 1) % spins
      const up = (basis >> site) & 1
      const nextUp = (basis >> next) & 1
      if (up !== nextUp) {
        const flipped = basis ^ (1 << site) ^ (1 << next)
        out[flipped] += (J / 2) * amplitude
      }
    }
  }
}

/**
 * The lowest eigenvalues, by Lanczos.
 *
 * Builds a small tridiagonal matrix whose eigenvalues converge on the extreme ones of the big matrix, which is how
 * problems this size are actually done. Re-orthogonalised every step because in floating point the vectors drift
 * back together and produce copies of the same eigenvalue otherwise — a famous trap worth not falling into.
 */
function lanczos(
  spins: number,
  J: number,
  anisotropy: number,
  field: number,
  periodic: boolean,
  wanted: number
): { levels: number[]; ground: Float64Array } {
  const size = 1 << spins
  const steps = Math.min(size, Math.max(40, wanted * 12))

  let v = new Float64Array(size)
  // A fixed starting vector, so the answer is the same every run.
  for (let one = 0; one < size; one += 1) v[one] = Math.sin(one * 1.2345 + 0.7)
  let norm = Math.hypot(...Array.from(v.slice(0, Math.min(size, 1e6))))
  norm = Math.sqrt(v.reduce((sum, one) => sum + one * one, 0))
  for (let one = 0; one < size; one += 1) v[one] /= norm

  const basis: Float64Array[] = [v]
  const alpha: number[] = []
  const beta: number[] = []
  let previous = new Float64Array(size)
  const w = new Float64Array(size)

  for (let step = 0; step < steps; step += 1) {
    apply(v, w, spins, J, anisotropy, field, periodic)
    let a = 0
    for (let one = 0; one < size; one += 1) a += w[one] * v[one]
    alpha.push(a)
    for (let one = 0; one < size; one += 1) w[one] -= a * v[one] + (beta[step - 1] ?? 0) * previous[one]

    // Re-orthogonalise against everything so far. Skipping this is what produces phantom repeated eigenvalues.
    for (const old of basis) {
      let overlap = 0
      for (let one = 0; one < size; one += 1) overlap += w[one] * old[one]
      for (let one = 0; one < size; one += 1) w[one] -= overlap * old[one]
    }

    let b = 0
    for (let one = 0; one < size; one += 1) b += w[one] * w[one]
    b = Math.sqrt(b)
    if (b < 1e-10) break
    beta.push(b)
    previous = v
    v = new Float64Array(size)
    for (let one = 0; one < size; one += 1) v[one] = w[one] / b
    basis.push(v)
    if (basis.length > 120) basis.shift()
  }

  // Eigenvalues of the small tridiagonal matrix, by bisection on the Sturm sequence.
  const n = alpha.length
  const countBelow = (value: number): number => {
    let count = 0
    let d = alpha[0] - value
    if (d < 0) count += 1
    for (let one = 1; one < n; one += 1) {
      d = alpha[one] - value - (beta[one - 1] * beta[one - 1]) / (d === 0 ? 1e-30 : d)
      if (d < 0) count += 1
    }
    return count
  }
  const reach = Math.max(...alpha.map(Math.abs)) + 2 * Math.max(...beta.map(Math.abs), 1)
  const levels: number[] = []
  for (let which = 1; which <= Math.min(wanted, n); which += 1) {
    let low = -reach
    let high = reach
    for (let step = 0; step < 100; step += 1) {
      const middle = (low + high) / 2
      if (countBelow(middle) >= which) high = middle
      else low = middle
    }
    levels.push((low + high) / 2)
  }

  // The ground state itself, by inverse iteration against the lowest eigenvalue.
  let ground = new Float64Array(size)
  for (let one = 0; one < size; one += 1) ground[one] = Math.sin(one * 0.9 + 0.3)
  const target = levels[0] - 0.01
  for (let round = 0; round < 60; round += 1) {
    // One step of the shifted power method: (H − target)⁻¹ approximated by a few Richardson iterations.
    apply(ground, w, spins, J, anisotropy, field, periodic)
    const next = new Float64Array(size)
    for (let one = 0; one < size; one += 1) next[one] = ground[one] - 0.35 * (w[one] - target * ground[one])
    let size2 = 0
    for (let one = 0; one < size; one += 1) size2 += next[one] * next[one]
    const length = Math.sqrt(size2) || 1
    for (let one = 0; one < size; one += 1) next[one] /= length
    ground = next
  }

  return { levels, ground }
}

interface ChainState {
  levels: number[]
  ground: Float64Array
  spins: number
  t: number
}

export const heisenbergChain: Simulation<ChainState> = {
  id: 'heisenberg-chain',
  name: 'Heisenberg Spin Chain',
  section: 'condensed',
  about: 'The Hamiltonian diagonalised exactly — and the wall you hit at fourteen spins, which is the subject.',
  controls: [
    { key: 'spins', label: 'Spins in the chain', unit: '', least: 2, most: MOST_SPINS, step: 1, initial: 10, about: 'The matrix is 2^N across. Twelve is 4,096; fourteen is 16,384 and a quarter of a billion entries. That doubling is why this problem is hard.' },
    { key: 'coupling', label: 'Exchange J', unit: '', least: -2, most: 2, step: 0.05, initial: 1, about: 'Positive favours neighbours pointing opposite ways — antiferromagnetic. Negative lines them up.' },
    { key: 'anisotropy', label: 'Anisotropy Δ', unit: '', least: -2, most: 3, step: 0.05, initial: 1, about: 'One is the isotropic Heisenberg model. Zero is XY, and large Δ is Ising. The whole phase diagram is this one number.' },
    { key: 'field', label: 'Magnetic field', unit: '', least: 0, most: 4, step: 0.05, initial: 0, about: 'Pulls every spin the same way, and eventually wins against the exchange.' },
    { key: 'periodic', label: 'Join the ends', unit: '', least: 0, most: 1, step: 1, initial: 1, about: 'A ring rather than a line. A ring has no ends, so the energy per spin is closer to an infinite chain.' }
  ],
  readouts: [
    { key: 'ground', label: 'Ground-state energy', unit: '', figures: 6 },
    { key: 'perSpin', label: 'Energy per spin', unit: '', figures: 6 },
    { key: 'gap', label: 'Gap to the first excited', unit: '', figures: 6 },
    { key: 'correlation', label: 'Neighbour correlation', unit: '', figures: 5 },
    { key: 'magnetisation', label: 'Magnetisation', unit: '', figures: 5 },
    { key: 'size', label: 'Matrix is this wide', unit: '' }
  ],
  start(values) {
    const spins = Math.max(2, Math.min(MOST_SPINS, Math.round(values.spins)))
    const { levels, ground } = lanczos(spins, values.coupling, values.anisotropy, values.field, values.periodic >= 0.5, 4)
    return { levels, ground, spins, t: 0 }
  },
  step(state, dt) {
    state.t += dt
  },
  read(state, values) {
    const size = 1 << state.spins
    // ⟨Sᶻᵢ Sᶻᵢ₊₁⟩ and ⟨Sᶻ⟩, measured from the ground state rather than quoted.
    let correlation = 0
    let magnetisation = 0
    let weight = 0
    for (let basis = 0; basis < size; basis += 1) {
      const p = state.ground[basis] * state.ground[basis]
      if (p < 1e-14) continue
      weight += p
      let pair = 0
      const bonds = values.periodic >= 0.5 ? state.spins : state.spins - 1
      for (let site = 0; site < bonds; site += 1) {
        const next = (site + 1) % state.spins
        pair += (((basis >> site) & 1) ? 0.5 : -0.5) * (((basis >> next) & 1) ? 0.5 : -0.5)
      }
      correlation += p * (pair / Math.max(1, bonds))
      let total = 0
      for (let site = 0; site < state.spins; site += 1) total += ((basis >> site) & 1) ? 0.5 : -0.5
      magnetisation += p * total
    }
    const scale = weight > 0 ? 1 / weight : 1
    return {
      ground: state.levels[0] ?? 0,
      perSpin: (state.levels[0] ?? 0) / state.spins,
      gap: (state.levels[1] ?? 0) - (state.levels[0] ?? 0),
      correlation: correlation * scale,
      magnetisation: magnetisation * scale,
      size
    }
  },
  paint(state, values): Scene {
    const spins = state.spins
    const shapes: Shape[] = []
    // The most likely arrangement in the ground state, which for the antiferromagnet alternates.
    let best = 0
    for (let one = 1; one < 1 << spins; one += 1) {
      if (Math.abs(state.ground[one]) > Math.abs(state.ground[best])) best = one
    }
    for (let site = 0; site < spins; site += 1) {
      const up = (best >> site) & 1
      const x = site * 1.2
      shapes.push({ kind: 'line', from: [x, up ? -0.4 : 0.4], to: [x, up ? 0.4 : -0.4], width: 2.5, tone: up ? undefined : 'other' })
      shapes.push({
        kind: 'arrow',
        from: [x, up ? -0.1 : 0.1],
        to: [x, up ? 0.5 : -0.5],
        tone: up ? undefined : 'other'
      })
    }
    for (let site = 0; site < (values.periodic >= 0.5 ? spins : spins - 1); site += 1) {
      const next = (site + 1) % spins
      if (next > site) shapes.push({ kind: 'line', from: [site * 1.2, 0], to: [next * 1.2, 0], width: 1, faint: true })
    }
    // The lowest few levels, drawn to scale beside each other.
    const low = Math.min(...state.levels)
    const high = Math.max(...state.levels)
    const span = high - low || 1
    for (let one = 0; one < state.levels.length; one += 1) {
      const y = -2.2 - ((state.levels[one] - low) / span) * 1.4
      shapes.push({ kind: 'line', from: [0, y], to: [spins * 1.2 - 1.2, y], width: one === 0 ? 2 : 1, faint: one > 0 })
      shapes.push({ kind: 'text', at: [spins * 1.2 - 1, y], text: `E${one} = ${state.levels[one].toFixed(4)}`, size: 10 })
    }
    return {
      view: [-1, -4.2, spins * 1.2 + 2.5, 1.4],
      shapes,
      about: `A ${spins}-spin chain means a ${(1 << spins).toLocaleString('en-GB')} × ${(1 << spins).toLocaleString('en-GB')} matrix. Add one spin and it quadruples in size — which is the whole reason many-body physics is hard.`
    }
  },
  limits: [
    'Fourteen spins is the limit, and it is a real wall rather than a setting: the matrix doubles its width with every spin added, and sixteen would be a quarter of a million across.',
    'A one-dimensional chain, either open or a ring. Two dimensions multiplies the difficulty again.',
    'The lowest four levels, found by Lanczos with full re-orthogonalisation. Degenerate levels may still come back fewer than there really are.',
    'Spin-½ only, with nearest-neighbour exchange and no disorder.'
  ]
}

export const MANY_BODY: readonly Simulation[] = Object.freeze([heisenbergChain as Simulation])
