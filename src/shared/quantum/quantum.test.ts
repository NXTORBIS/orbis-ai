import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { INV_SQRT2, abs, add, conj, mul, near, norm2, phase, complex } from './complex.ts'
import {
  MAX_QUBITS,
  blochOf,
  capacityFor,
  fromAmplitudes,
  fromBloch,
  ket,
  minusState,
  normCheck,
  plusState,
  probabilities,
  qubitProbability,
  totalProbability,
  zeroState
} from './state.ts'
import {
  GATES,
  MATRIX_H,
  MATRIX_I,
  MATRIX_S,
  MATRIX_SX,
  MATRIX_T,
  MATRIX_X,
  MATRIX_Y,
  MATRIX_Z,
  apply1,
  matrixFor,
  rx,
  ry,
  rz,
  type Matrix2
} from './gates.ts'
import {
  barrier,
  cnot,
  cphase,
  emptyCircuit,
  faultsIn,
  gate,
  inverse,
  measure,
  resources,
  run,
  sample,
  seeded,
  swap
} from './circuit.ts'
import {
  bernsteinVazirani,
  continuedFraction,
  deutsch,
  deutschJozsa,
  gcd,
  grover,
  inverseQft,
  modPow,
  periodOf,
  phaseEstimate,
  qft,
  shor,
  superdense,
  teleport
} from './algorithms.ts'

/**
 * Correctness tests for the quantum engine.
 *
 * ## Why these and not others
 *
 * Every gate is checked for unitarity, because a non-unitary gate produces states whose probabilities do not
 * sum to one and every later result is then meaningless. Every identity the course teaches is checked — H² = I,
 * S² = Z, T² = S, XZ ≠ ZX — because the course asks learners to predict them and would be teaching nonsense if
 * the engine disagreed. And every algorithm is run and its answer compared with the truth, because the one thing
 * a teaching simulator must never do is print the textbook answer without computing it.
 *
 * The tolerances are explicit and loose (1e-9 against a floating-point error around 1e-15), because declaring
 * two mathematically identical results different over the fifteenth decimal place is the commonest way a
 * quantum test lies.
 */

const TOL = 1e-9

/** U†U, as a 2×2 matrix. Should be the identity for every gate. */
function daggerTimes(matrix: Matrix2): Matrix2 {
  const { a, b, c, d } = matrix
  // U† = [[conj(a), conj(c)], [conj(b), conj(d)]]
  const aa = add(mul(conj(a), a), mul(conj(c), c))
  const ab = add(mul(conj(a), b), mul(conj(c), d))
  const ba = add(mul(conj(b), a), mul(conj(d), c))
  const bb = add(mul(conj(b), b), mul(conj(d), d))
  return { a: aa, b: ab, c: ba, d: bb }
}

const isIdentity = (matrix: Matrix2): boolean =>
  near(matrix.a, complex(1), TOL) && near(matrix.b, complex(0), TOL) && near(matrix.c, complex(0), TOL) && near(matrix.d, complex(1), TOL)

describe('complex arithmetic', () => {
  it('multiplies correctly', () => {
    assert.ok(near(mul(complex(1, 2), complex(3, 4)), complex(-5, 10)))
  })

  it('i squared is −1', () => {
    assert.ok(near(mul(complex(0, 1), complex(0, 1)), complex(-1, 0)))
  })

  it('|z|² is the probability of an amplitude', () => {
    // 1/√2 squared is 0.49999999999999994 in floating point, which is why every comparison here takes a tolerance.
    assert.ok(Math.abs(norm2(complex(INV_SQRT2, 0)) - 0.5) < TOL)
    assert.ok(Math.abs(norm2(complex(0.6, 0.8)) - 1) < TOL)
  })

  it('phase and magnitude come out as expected', () => {
    assert.ok(Math.abs(abs(complex(3, 4)) - 5) < TOL)
    assert.ok(Math.abs(phase(complex(0, 1)) - Math.PI / 2) < TOL)
    assert.equal(phase(complex(0, 0)), 0)
  })
})

describe('every gate is unitary', () => {
  for (const [name, matrix] of Object.entries({ I: MATRIX_I, X: MATRIX_X, Y: MATRIX_Y, Z: MATRIX_Z, H: MATRIX_H, S: MATRIX_S, T: MATRIX_T, SX: MATRIX_SX })) {
    it(`${name}† ${name} is the identity`, () => {
      assert.ok(isIdentity(daggerTimes(matrix)), `${name} is not unitary`)
    })
  }

  for (const angle of [0, 0.3, Math.PI / 4, Math.PI / 2, Math.PI, 2.7]) {
    it(`the rotations are unitary at θ = ${angle.toFixed(3)}`, () => {
      for (const matrix of [rx(angle), ry(angle), rz(angle)]) {
        assert.ok(isIdentity(daggerTimes(matrix)))
      }
    })
  }

  it('every gate in the catalogue has a name, a symbol and a description', () => {
    for (const one of GATES) {
      assert.ok(one.name.length > 0, `${one.id} has no name`)
      assert.ok(one.symbol.length > 0, `${one.id} has no symbol`)
      assert.ok(one.does.length > 20, `${one.id} is not described`)
    }
  })
})

describe('the identities the course teaches', () => {
  const applyTwice = (id: string) => {
    const state = zeroState(1)
    const matrix = matrixFor(id)
    assert.ok(matrix)
    apply1(state, matrix, 0)
    apply1(state, matrix, 0)
    return state
  }

  it('H applied twice is the identity', () => {
    const state = applyTwice('h')
    assert.ok(Math.abs(state.data[0] - 1) < TOL, `H² |0⟩ should be |0⟩, got ${ket(state)}`)
  })

  it('X applied twice is the identity', () => {
    const state = applyTwice('x')
    assert.ok(Math.abs(state.data[0] - 1) < TOL)
  })

  it('S² is Z', () => {
    const viaS = zeroState(1)
    apply1(viaS, MATRIX_X, 0)
    apply1(viaS, MATRIX_S, 0)
    apply1(viaS, MATRIX_S, 0)
    const viaZ = zeroState(1)
    apply1(viaZ, MATRIX_X, 0)
    apply1(viaZ, MATRIX_Z, 0)
    for (let at = 0; at < viaS.data.length; at += 1) assert.ok(Math.abs(viaS.data[at] - viaZ.data[at]) < TOL)
  })

  it('T² is S', () => {
    const viaT = zeroState(1)
    apply1(viaT, MATRIX_X, 0)
    apply1(viaT, MATRIX_T, 0)
    apply1(viaT, MATRIX_T, 0)
    const viaS = zeroState(1)
    apply1(viaS, MATRIX_X, 0)
    apply1(viaS, MATRIX_S, 0)
    for (let at = 0; at < viaT.data.length; at += 1) assert.ok(Math.abs(viaT.data[at] - viaS.data[at]) < TOL)
  })

  it('√X twice is X', () => {
    const state = zeroState(1)
    apply1(state, MATRIX_SX, 0)
    apply1(state, MATRIX_SX, 0)
    // Should be |1⟩ up to a global phase, so the probability is what matters.
    assert.ok(Math.abs(probabilities(state)[1] - 1) < TOL)
  })

  it('X and Z do not commute', () => {
    const xz = zeroState(1)
    apply1(xz, MATRIX_H, 0)
    apply1(xz, MATRIX_Z, 0)
    apply1(xz, MATRIX_X, 0)
    const zx = zeroState(1)
    apply1(zx, MATRIX_H, 0)
    apply1(zx, MATRIX_X, 0)
    apply1(zx, MATRIX_Z, 0)
    const same = xz.data.every((one, at) => Math.abs(one - zx.data[at]) < TOL)
    assert.equal(same, false, 'XZ and ZX gave the same state, which would mean the engine is wrong')
  })
})

describe('states', () => {
  it('|+⟩ and |−⟩ have the same probabilities and different phase', () => {
    const plus = probabilities(plusState())
    const minus = probabilities(minusState())
    assert.ok(Math.abs(plus[0] - 0.5) < TOL && Math.abs(plus[1] - 0.5) < TOL)
    assert.ok(Math.abs(minus[0] - 0.5) < TOL && Math.abs(minus[1] - 0.5) < TOL)
    // The difference is the sign of the second amplitude, which a measurement cannot see.
    assert.ok(minusState().data[2] < 0 && plusState().data[2] > 0)
  })

  it('a phase flip is invisible immediately and decisive after a Hadamard', () => {
    // H |0⟩, then Z, then H: should be |1⟩ rather than |0⟩.
    const state = zeroState(1)
    apply1(state, MATRIX_H, 0)
    const before = probabilities(state)
    apply1(state, MATRIX_Z, 0)
    const after = probabilities(state)
    assert.ok(Math.abs(before[0] - after[0]) < TOL, 'Z changed the probabilities, which it must not')
    apply1(state, MATRIX_H, 0)
    assert.ok(Math.abs(probabilities(state)[1] - 1) < TOL, 'H Z H |0⟩ should be |1⟩')
  })

  it('the Bloch vector of a pure qubit has length 1', () => {
    for (const [theta, phi] of [[0, 0], [Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [1.1, 2.2]]) {
      const point = blochOf(fromBloch(theta, phi), 0)
      assert.ok(Math.abs(point.radius - 1) < 1e-8, `radius ${point.radius} at θ=${theta}`)
    }
  })

  it('|0⟩ is the north pole and |1⟩ the south', () => {
    assert.ok(Math.abs(blochOf(zeroState(1), 0).z - 1) < TOL)
    const one = zeroState(1)
    apply1(one, MATRIX_X, 0)
    assert.ok(Math.abs(blochOf(one, 0).z + 1) < TOL)
  })

  it('|+⟩ is on the equator at x = 1', () => {
    const point = blochOf(plusState(), 0)
    assert.ok(Math.abs(point.x - 1) < TOL && Math.abs(point.z) < TOL)
  })

  it('refuses a register too large to simulate, rather than trying', () => {
    assert.equal(capacityFor(MAX_QUBITS).ok, true)
    const refused = capacityFor(MAX_QUBITS + 4)
    assert.equal(refused.ok, false)
    assert.match(refused.says, /more than this simulator will attempt/)
  })

  it('reports a state that is not normalised rather than fixing it', () => {
    const bad = fromAmplitudes([complex(1), complex(1)])
    const check = normCheck(bad)
    assert.equal(check.ok, false)
    assert.match(check.says, /fault in the simulation/)
    assert.ok(Math.abs(totalProbability(bad) - 2) < TOL)
  })
})

describe('circuits', () => {
  it('a Bell state comes out of H then CNOT', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    const out = run(circuit)
    const p = out.probabilities
    assert.ok(Math.abs(p[0] - 0.5) < TOL, `|00⟩ should be 0.5, got ${p[0]}`)
    assert.ok(Math.abs(p[3] - 0.5) < TOL, `|11⟩ should be 0.5, got ${p[3]}`)
    assert.ok(p[1] < TOL && p[2] < TOL, 'the mixed outcomes should be impossible')
  })

  it('each half of a Bell pair is maximally mixed, so its Bloch vector has length 0', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    const out = run(circuit)
    for (const qubit of [0, 1]) {
      const point = blochOf(out.state, qubit)
      assert.ok(point.radius < 1e-9, `qubit ${qubit} has radius ${point.radius}; an entangled qubit has no pure state of its own`)
      assert.ok(Math.abs(qubitProbability(out.state, qubit) - 0.5) < TOL)
    }
  })

  it('all four Bell states are produced correctly', () => {
    const cases: { name: string; build: (c: ReturnType<typeof emptyCircuit>) => ReturnType<typeof emptyCircuit>; expect: [number, number] }[] = [
      { name: 'Φ+', build: (c) => cnot(gate(c, 'h', 0), 0, 1), expect: [0, 3] },
      { name: 'Φ−', build: (c) => cnot(gate(gate(c, 'h', 0), 'z', 0), 0, 1), expect: [0, 3] },
      { name: 'Ψ+', build: (c) => gate(cnot(gate(c, 'h', 0), 0, 1), 'x', 1), expect: [1, 2] },
      { name: 'Ψ−', build: (c) => gate(cnot(gate(gate(c, 'h', 0), 'z', 0), 0, 1), 'x', 1), expect: [1, 2] }
    ]
    for (const one of cases) {
      const out = run(one.build(emptyCircuit(2)))
      const p = out.probabilities
      for (const index of one.expect) assert.ok(Math.abs(p[index] - 0.5) < TOL, `${one.name}: index ${index} should be 0.5, got ${p[index]}`)
    }
  })

  it('a GHZ state has only all-zeros and all-ones', () => {
    let circuit = emptyCircuit(3)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    circuit = cnot(circuit, 1, 2)
    const p = run(circuit).probabilities
    assert.ok(Math.abs(p[0] - 0.5) < TOL && Math.abs(p[7] - 0.5) < TOL)
    for (const at of [1, 2, 3, 4, 5, 6]) assert.ok(p[at] < TOL)
  })

  it('every state stays normalised through a long random circuit', () => {
    let circuit = emptyCircuit(4)
    const ids = ['h', 'x', 'y', 'z', 's', 't', 'sx']
    for (let step = 0; step < 60; step += 1) {
      circuit = gate(circuit, ids[step % ids.length], step % 4)
      if (step % 5 === 0) circuit = cnot(circuit, step % 4, (step + 1) % 4)
      if (step % 7 === 0) circuit = cphase(circuit, 0.3 * step, step % 4, (step + 2) % 4)
    }
    const out = run(circuit, { keepEvery: 1000 })
    assert.ok(normCheck(out.state).ok, normCheck(out.state).says)
  })

  it('measurement collapses the state and the outcome is recorded', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    circuit = measure(circuit, 0, 0)
    const out = run(circuit, { chance: seeded(7) })
    const bit = out.bits[0]
    assert.ok(bit === 0 || bit === 1)
    // After measuring one half of a Bell pair, the other is determined.
    const p = out.probabilities
    const certain = p.filter((one) => one > 1 - TOL).length
    assert.equal(certain, 1, 'exactly one basis state should remain after the collapse')
  })

  it('swap exchanges two qubits', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'x', 0)
    circuit = swap(circuit, 0, 1)
    const p = run(circuit).probabilities
    // |01⟩ becomes |10⟩: index 1 becomes index 2.
    assert.ok(Math.abs(p[2] - 1) < TOL, `expected |10⟩, probabilities were ${[...p].join(', ')}`)
  })

  it('a circuit followed by its inverse returns to the start', () => {
    let circuit = emptyCircuit(3)
    circuit = gate(circuit, 'h', 0)
    circuit = gate(circuit, 't', 1)
    circuit = cnot(circuit, 0, 2)
    circuit = gate(circuit, 'ry', 1, 0.7)
    circuit = cphase(circuit, 1.1, 0, 1)
    const back = inverse(circuit)
    assert.equal(back.refused, null)
    const joined = { ...circuit, ops: [...circuit.ops, ...back.circuit.ops] }
    const p = run(joined).probabilities
    assert.ok(Math.abs(p[0] - 1) < 1e-8, `should return to |000⟩, got ${[...p].map((x) => x.toFixed(4)).join(', ')}`)
  })

  it('refuses to invert a circuit containing a measurement, and says why', () => {
    const circuit = measure(gate(emptyCircuit(1), 'h', 0), 0, 0)
    const back = inverse(circuit)
    assert.ok(back.refused)
    assert.match(String(back.refused), /not reversible/)
  })
})

describe('what a circuit cannot be', () => {
  it('a gate on a qubit that does not exist is refused with a readable reason', () => {
    const faults = faultsIn(gate(emptyCircuit(2), 'h', 5))
    assert.equal(faults.length, 1)
    assert.match(faults[0].says, /qubit 5.*qubits 0 to 1/)
  })

  it('a control that is also the target is refused', () => {
    const circuit = { ...emptyCircuit(2), ops: [{ kind: 'controlled' as const, gate: 'x', controls: [1], target: 1 }] }
    assert.ok(faultsIn(circuit).some((one) => /same qubit/.test(one.says)))
  })

  it('an unknown gate is refused', () => {
    assert.ok(faultsIn(gate(emptyCircuit(1), 'flibble', 0)).some((one) => /not a gate/.test(one.says)))
  })

  it('a parameterised gate with no angle is refused', () => {
    const circuit = { ...emptyCircuit(1), ops: [{ kind: 'gate' as const, gate: 'rx', target: 0 }] }
    assert.ok(faultsIn(circuit).some((one) => /needs an angle/.test(one.says)))
  })

  it('running an invalid circuit throws rather than producing a plausible answer', () => {
    assert.throws(() => run(gate(emptyCircuit(1), 'h', 3)), /cannot run/)
  })
})

describe('sampling', () => {
  it('counts converge on the exact probabilities as shots rise', () => {
    let circuit = emptyCircuit(1)
    circuit = gate(circuit, 'h', 0)
    const few = sample(circuit, 50, { seed: 11 })
    const many = sample(circuit, 20000, { seed: 11 })
    const errorOf = (got: typeof few): number => Math.abs((got.counts['1'] ?? 0) / got.shots - 0.5)
    assert.ok(errorOf(many) <= errorOf(few) + 0.02, `many shots should not be worse: few ${errorOf(few)}, many ${errorOf(many)}`)
    assert.ok(errorOf(many) < 0.03, `20,000 shots should be within a few per cent, was ${errorOf(many)}`)
  })

  it('the same seed gives the same counts', () => {
    const circuit = gate(emptyCircuit(2), 'h', 0)
    const first = sample(circuit, 500, { seed: 42 })
    const second = sample(circuit, 500, { seed: 42 })
    assert.deepEqual(first.counts, second.counts)
  })

  it('a sampled result says it is sampled, and carries the exact probabilities beside it', () => {
    const got = sample(gate(emptyCircuit(1), 'h', 0), 100, { seed: 3 })
    assert.equal(got.mode, 'sampled')
    assert.ok(Math.abs((got.exact['1'] ?? 0) - 0.5) < TOL)
    assert.equal(run(gate(emptyCircuit(1), 'h', 0)).mode, 'exact')
  })
})

describe('resources', () => {
  it('depth counts the longest chain, not the gate count', () => {
    // Four gates on four different qubits: depth 1.
    let wide = emptyCircuit(4)
    for (let at = 0; at < 4; at += 1) wide = gate(wide, 'h', at)
    assert.equal(resources(wide).depth, 1)
    assert.equal(resources(wide).gates, 4)

    // Four gates on one qubit: depth 4.
    let deep = emptyCircuit(4)
    for (let at = 0; at < 4; at += 1) deep = gate(deep, 'h', 0)
    assert.equal(resources(deep).depth, 4)
  })

  it('counts two-qubit gates separately, because that is where the error is', () => {
    let circuit = emptyCircuit(3)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    circuit = cnot(circuit, 1, 2)
    const got = resources(circuit)
    assert.equal(got.oneQubit, 1)
    assert.equal(got.twoQubit, 2)
    assert.match(got.says, /act on more than one qubit/)
  })

  it('a barrier aligns the qubits and is not counted as a gate', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = barrier(circuit)
    circuit = gate(circuit, 'h', 1)
    const got = resources(circuit)
    assert.equal(got.gates, 2)
    assert.equal(got.depth, 3, 'the barrier should force the second gate after the first')
  })
})

describe('the Fourier transform', () => {
  it('the inverse transform undoes the transform', () => {
    const qubits = [0, 1, 2]
    let circuit = emptyCircuit(3)
    circuit = gate(circuit, 'x', 0)
    circuit = gate(circuit, 'h', 2)
    const before = run(circuit).probabilities
    circuit = qft(circuit, qubits)
    circuit = inverseQft(circuit, qubits)
    const after = run(circuit).probabilities
    for (let at = 0; at < before.length; at += 1) {
      assert.ok(Math.abs(before[at] - after[at]) < 1e-8, `index ${at}: ${before[at]} became ${after[at]}`)
    }
  })

  it('the transform of |0…0⟩ is a flat superposition', () => {
    let circuit = emptyCircuit(3)
    circuit = qft(circuit, [0, 1, 2])
    const p = run(circuit).probabilities
    for (const one of p) assert.ok(Math.abs(one - 1 / 8) < 1e-9, `expected 1/8 everywhere, saw ${one}`)
  })

  it('the approximate transform uses fewer gates and stays close', () => {
    const exact = qft(emptyCircuit(5), [0, 1, 2, 3, 4])
    const rough = qft(emptyCircuit(5), [0, 1, 2, 3, 4], { approximate: 2 })
    assert.ok(resources(rough).gates < resources(exact).gates, 'the approximation should be cheaper')
    // On this input both give the flat distribution, so the comparison is about cost rather than output.
    const a = run(exact).probabilities
    const b = run(rough).probabilities
    for (let at = 0; at < a.length; at += 1) assert.ok(Math.abs(a[at] - b[at]) < 1e-6)
  })
})

describe('the algorithms give answers the engine computed', () => {
  it('Deutsch classifies all four one-bit functions correctly', () => {
    for (const which of ['zero', 'one', 'identity', 'not'] as const) {
      const got = deutsch(which)
      assert.equal(got.correct, true, `${which}: ${got.says}`)
      assert.equal(got.queries, 1)
    }
  })

  it('Deutsch-Jozsa separates constant from balanced', () => {
    for (const bits of [2, 3, 4]) {
      for (const kind of ['constant-0', 'constant-1', 'balanced'] as const) {
        const got = deutschJozsa(bits, kind)
        assert.equal(got.correct, true, `${bits} bits, ${kind}: ${got.says}`)
      }
    }
  })

  it('Bernstein-Vazirani recovers the hidden string in one query', () => {
    for (const secret of ['1', '01', '110', '1011', '10110']) {
      const got = bernsteinVazirani(secret)
      assert.equal(got.found, secret, got.says)
      assert.equal(got.queries, 1)
      assert.equal(got.classicalQueries, secret.length)
    }
  })

  it('Grover finds a marked state with high probability', () => {
    const got = grover(3, [5])
    assert.ok(got.success > 0.9, `success was ${got.success}: ${got.says}`)
    assert.equal(got.curve[0].success < 0.2, true, 'before any iteration the marked state should be no more likely than the rest')
  })

  it('too many Grover iterations make it worse, which is the point of the lesson', () => {
    /*
     * The curve rises to a peak and then falls, and because the rotation is periodic it rises again later. So the
     * honest check is that the success probability drops after its maximum -- not that some arbitrary larger
     * number of iterations is worse, which can land back on a rise.
     */
    const long = grover(3, [5], 12)
    const best = Math.max(...long.curve.map((one) => one.success))
    const peakAt = long.curve.findIndex((one) => one.success === best)
    const after = long.curve.slice(peakAt + 1).map((one) => one.success)
    assert.ok(after.length > 0, 'the run should continue past the peak')
    assert.ok(Math.min(...after) < best - 0.1, `success should fall after the peak: peak ${best}, lowest after ${Math.min(...after)}`)
    assert.ok(long.best < 12, 'the suggested count should be well short of twelve')
  })

  it('Grover with two marked states finds either of them', () => {
    const got = grover(4, [3, 11])
    assert.ok(got.success > 0.85, `success was ${got.success}`)
    assert.equal(got.marked.length, 2)
  })

  it('phase estimation gets closer as counting qubits are added', () => {
    const coarse = phaseEstimate(0.3125, 3)
    const fine = phaseEstimate(0.3125, 6)
    assert.ok(fine.error <= coarse.error, `${coarse.error} then ${fine.error}`)
    assert.ok(fine.resolution < coarse.resolution)
  })

  it('phase estimation is exact when the phase fits the register', () => {
    // 0.25 is exactly 1/4, which two counting qubits represent exactly.
    const got = phaseEstimate(0.25, 4)
    assert.ok(got.error < 1e-9, `expected an exact answer, error was ${got.error}: ${got.says}`)
  })

  it('teleportation reproduces the state, and needs its two classical bits', () => {
    for (const [theta, phi] of [[0.6, 0.9], [Math.PI / 2, 0], [2.1, 1.4]]) {
      const got = teleport(theta, phi)
      assert.ok(got.fidelity > 0.999, `fidelity ${got.fidelity}: ${got.says}`)
      assert.equal(got.classicalBits.length, 2)
    }
  })

  it('superdense coding carries both bits', () => {
    for (const bits of ['00', '01', '10', '11']) {
      const got = superdense(bits)
      assert.equal(got.received, bits, got.says)
    }
  })
})

describe('the classical parts of Shor', () => {
  it('modular arithmetic is right', () => {
    assert.equal(modPow(2, 10, 1000), 24)
    assert.equal(modPow(7, 4, 15), 1)
    assert.equal(gcd(48, 18), 6)
    assert.equal(periodOf(7, 15), 4)
    assert.equal(periodOf(2, 15), 4)
  })

  it('continued fractions recover a denominator from an approximation', () => {
    // 5/16 is close to 1/3, and the convergents should offer 3.
    const got = continuedFraction(5, 16, 15)
    assert.ok(got.some((one) => one.denominator === 3), JSON.stringify(got))
  })

  it('factors 15, and the factors multiply back', () => {
    const got = shor(15)
    assert.ok(got.factors, got.says)
    const [a, b] = got.factors ?? [0, 0]
    assert.equal(a * b, 15, `${a} × ${b} is not 15`)
    assert.ok(a > 1 && b > 1, 'the trivial factorisation does not count')
  })

  it('factors 21', () => {
    const got = shor(21)
    assert.ok(got.factors, got.says)
    const [a, b] = got.factors ?? [0, 0]
    assert.equal(a * b, 21)
    assert.ok(a > 1 && b > 1)
  })

  it('says plainly when an even number needs no quantum computer', () => {
    const got = shor(14)
    assert.match(got.says, /even/)
    assert.deepEqual(got.factors, [2, 7])
  })
})
