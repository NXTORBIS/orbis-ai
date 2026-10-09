import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cnot, emptyCircuit, gate, run } from './circuit.ts'
import {
  NOISE_DOES,
  NOISE_NAMES,
  coherence,
  densityOf,
  fromTimes,
  mixture,
  populations,
  purity,
  reduced,
  runNoisy,
  timesArePossible,
  trace
} from './noise.ts'
import { minusState, plusState, zeroState } from './state.ts'
import { CODES, STABILISERS, commutes, correctOnce, surveyCode, syndromeOf } from './correction.ts'

/**
 * Tests for noise, density matrices and error correction.
 *
 * The statistical ones are written so they cannot pass by accident and cannot fail by bad luck: a bit-flip
 * channel at p = 0.5 is checked against a wide band, not a point, and the seeds are fixed so a failure is
 * reproducible. The important ones are the asymmetries — a phase flip invisible in one basis and obvious in
 * another, a code that handles X and not Z — because those are the facts the course is built on.
 */

describe('noise channels do what they say', () => {
  it('a bit flip changes the computational-basis distribution', () => {
    const circuit = gate(emptyCircuit(1), 'i', 0)
    const got = runNoisy(circuit, { oneQubit: { kind: 'bit-flip', p: 0.3 } }, 4000, { seed: 5 })
    const flipped = (got.counts['1'] ?? 0) / got.shots
    assert.ok(flipped > 0.2 && flipped < 0.4, `about 30% should flip, saw ${(flipped * 100).toFixed(1)}%`)
  })

  it('a phase flip is invisible in the computational basis', () => {
    const circuit = gate(emptyCircuit(1), 'i', 0)
    const got = runNoisy(circuit, { oneQubit: { kind: 'phase-flip', p: 0.5 } }, 2000, { seed: 7 })
    assert.equal(got.counts['1'] ?? 0, 0, 'a phase flip on |0⟩ must not change what a measurement sees')
  })

  it('and the same phase flip is obvious after a Hadamard', () => {
    // H, then a phase flip, then H: the flip turns |0⟩ into |1⟩ half the time.
    let circuit = emptyCircuit(1)
    circuit = gate(circuit, 'h', 0)
    circuit = gate(circuit, 'h', 0)
    const got = runNoisy(circuit, { oneQubit: { kind: 'phase-flip', p: 0.5 } }, 4000, { seed: 9 })
    const ones = (got.counts['1'] ?? 0) / got.shots
    assert.ok(ones > 0.1, `the phase error should now be visible, saw ${(ones * 100).toFixed(1)}% ones`)
  })

  it('amplitude damping pushes |1⟩ down toward |0⟩ and never the other way', () => {
    const circuit = gate(emptyCircuit(1), 'x', 0)
    const got = runNoisy(circuit, { idle: { kind: 'amplitude-damping', p: 0.4 } }, 3000, { seed: 13 })
    const relaxed = (got.counts['0'] ?? 0) / got.shots
    assert.ok(relaxed > 0.25 && relaxed < 0.55, `about 40% should relax, saw ${(relaxed * 100).toFixed(1)}%`)

    // From |0⟩ there is nothing to lose, so it must stay put.
    const fromZero = runNoisy(gate(emptyCircuit(1), 'i', 0), { idle: { kind: 'amplitude-damping', p: 0.9 } }, 500, { seed: 13 })
    assert.equal(fromZero.counts['1'] ?? 0, 0, 'relaxation cannot excite a qubit that is already in the ground state')
  })

  it('readout error flips the recorded value without touching the state', () => {
    const circuit = gate(emptyCircuit(1), 'i', 0)
    const got = runNoisy(circuit, { readout: 0.2 }, 4000, { seed: 17 })
    const wrong = (got.counts['1'] ?? 0) / got.shots
    assert.ok(wrong > 0.13 && wrong < 0.28, `about 20% of readings should be wrong, saw ${(wrong * 100).toFixed(1)}%`)
  })

  it('more noise means lower fidelity', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    const light = runNoisy(circuit, { oneQubit: { kind: 'depolarising', p: 0.01 } }, 2000, { seed: 21 })
    const heavy = runNoisy(circuit, { oneQubit: { kind: 'depolarising', p: 0.3 } }, 2000, { seed: 21 })
    assert.ok(light.fidelity > heavy.fidelity, `light ${light.fidelity} should beat heavy ${heavy.fidelity}`)
    assert.ok(light.fidelity > 0.9)
  })

  it('a deeper circuit of the same logical function suffers more', () => {
    // Two circuits that both leave |0⟩ alone: one with two gates, one with twenty.
    let shallow = emptyCircuit(1)
    shallow = gate(shallow, 'x', 0)
    shallow = gate(shallow, 'x', 0)
    let deep = emptyCircuit(1)
    for (let at = 0; at < 20; at += 1) deep = gate(deep, 'x', 0)
    const model = { oneQubit: { kind: 'bit-flip' as const, p: 0.05 } }
    const a = runNoisy(shallow, model, 4000, { seed: 23 })
    const b = runNoisy(deep, model, 4000, { seed: 23 })
    assert.ok(a.fidelity > b.fidelity, `the shallow circuit should survive better: ${a.fidelity} against ${b.fidelity}`)
  })

  it('a noisy result never claims to be exact', () => {
    const got = runNoisy(gate(emptyCircuit(1), 'h', 0), { oneQubit: { kind: 'bit-flip', p: 0.1 } }, 100, { seed: 1 })
    assert.equal(got.mode, 'noisy-sampled')
    assert.match(got.says, /average over trajectories/)
    assert.equal(run(gate(emptyCircuit(1), 'h', 0)).mode, 'exact')
  })

  it('the same seed gives the same noisy counts', () => {
    const model = { oneQubit: { kind: 'depolarising' as const, p: 0.2 } }
    const first = runNoisy(gate(emptyCircuit(2), 'h', 0), model, 400, { seed: 99 })
    const second = runNoisy(gate(emptyCircuit(2), 'h', 0), model, 400, { seed: 99 })
    assert.deepEqual(first.counts, second.counts)
  })

  it('every channel is named and described', () => {
    for (const kind of Object.keys(NOISE_NAMES) as (keyof typeof NOISE_NAMES)[]) {
      assert.ok(NOISE_NAMES[kind].length > 0)
      assert.ok(NOISE_DOES[kind].length > 40, `${kind} is not properly described`)
    }
  })
})

describe('coherence times', () => {
  it('converts times into per-gate error probabilities', () => {
    const got = fromTimes(100, 80, 1)
    assert.ok(got.amplitude > 0 && got.amplitude < 0.02)
    assert.ok(got.phase > got.amplitude, 'a shorter T₂ should mean more dephasing per gate')
    assert.match(got.says, /T₂ ≤ 2T₁/)
  })

  it('refuses a physically impossible pair of times, and says why', () => {
    assert.equal(timesArePossible(100, 150).ok, true)
    const bad = timesArePossible(100, 250)
    assert.equal(bad.ok, false)
    assert.match(bad.says, /T₂ ≤ 2T₁ always/)
  })

  it('a longer gate means more error', () => {
    const quick = fromTimes(100, 100, 1)
    const slow = fromTimes(100, 100, 10)
    assert.ok(slow.amplitude > quick.amplitude)
  })
})

describe('density matrices', () => {
  it('a pure state has trace 1 and purity 1', () => {
    const rho = densityOf(plusState())
    assert.ok(Math.abs(trace(rho) - 1) < 1e-9)
    assert.ok(Math.abs(purity(rho) - 1) < 1e-9)
  })

  it('a mixture of |0⟩ and |1⟩ has the same populations as |+⟩ and no coherence', () => {
    const mixed = mixture([
      { state: zeroState(1), weight: 1 },
      { state: (() => { const one = zeroState(1); one.data[0] = 0; one.data[2] = 1; return one })(), weight: 1 }
    ])
    const pure = densityOf(plusState())
    const mixedPops = populations(mixed)
    const purePops = populations(pure)
    for (let at = 0; at < 2; at += 1) assert.ok(Math.abs(mixedPops[at] - purePops[at]) < 1e-9, 'the populations should match')
    // And here is the difference the course is built on.
    assert.ok(coherence(mixed) < 1e-9, 'a classical mixture has no coherence')
    assert.ok(coherence(pure) > 0.4, 'a superposition does')
    assert.ok(Math.abs(purity(mixed) - 0.5) < 1e-9, 'a completely mixed single qubit has purity 1/2')
  })

  it('|+⟩ and |−⟩ have different density matrices despite identical populations', () => {
    const plus = densityOf(plusState())
    const minus = densityOf(minusState())
    assert.deepEqual(populations(plus).map((one) => Number(one.toFixed(9))), populations(minus).map((one) => Number(one.toFixed(9))))
    // The off-diagonal terms differ in sign.
    assert.ok(plus.data[2] * minus.data[2] < 0, 'the coherences should have opposite signs')
  })

  it('half of a Bell pair is completely mixed, which is what entanglement means', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = cnot(circuit, 0, 1)
    const state = run(circuit).state
    for (const qubit of [0, 1]) {
      const part = reduced(state, qubit)
      assert.ok(Math.abs(trace(part) - 1) < 1e-9)
      assert.ok(Math.abs(purity(part) - 0.5) < 1e-9, `qubit ${qubit} should have purity 1/2, had ${purity(part)}`)
      assert.ok(coherence(part) < 1e-9, 'and no coherence of its own')
    }
    // While the whole is pure.
    assert.ok(Math.abs(purity(densityOf(state)) - 1) < 1e-9, 'the pair as a whole is a pure state')
  })

  it('a product state has pure parts', () => {
    let circuit = emptyCircuit(2)
    circuit = gate(circuit, 'h', 0)
    circuit = gate(circuit, 'x', 1)
    const state = run(circuit).state
    for (const qubit of [0, 1]) {
      assert.ok(Math.abs(purity(reduced(state, qubit)) - 1) < 1e-9, `qubit ${qubit} should still be pure`)
    }
  })
})

describe('error correction', () => {
  it('the bit-flip code corrects an X on any qubit', () => {
    for (const qubit of [0, 1, 2]) {
      const got = correctOnce('bit-flip', { kind: 'x', qubit }, { theta: 0.9 })
      assert.equal(got.recovered, true, `qubit ${qubit}: ${got.says}`)
      assert.equal(got.blamed, qubit, `the syndrome should point at qubit ${qubit}, it said ${got.blamed}`)
    }
  })

  it('and leaves an uncorrupted state alone', () => {
    const got = correctOnce('bit-flip', { kind: 'none', qubit: 0 }, { theta: 0.9 })
    assert.equal(got.recovered, true, got.says)
    assert.equal(got.blamed, null)
    assert.deepEqual(got.syndrome, [0, 0])
  })

  it('the bit-flip code is blind to a phase error, and says so', () => {
    const survey = surveyCode('bit-flip', { theta: 0.9 })
    const phaseErrors = survey.results.filter((one) => one.kind === 'z')
    assert.ok(phaseErrors.length === 3)
    // Every Z error reports a clean syndrome: the checks see nothing.
    for (const one of phaseErrors) assert.equal(one.syndrome, '00', `a Z error on qubit ${one.qubit} should produce syndrome 00`)
    assert.match(survey.says, /Z error passes through/)
  })

  it('the stabiliser calculation agrees with the running of the circuit', () => {
    // Z commutes with both ZZ checks, which is exactly why the code cannot see it.
    const blind = syndromeOf('bit-flip', 'ZII')
    assert.equal(blind.visible, false)
    assert.match(blind.says, /invisible to this code/)

    // X anticommutes with the first check, so it is detected.
    const seen = syndromeOf('bit-flip', 'XII')
    assert.equal(seen.visible, true)
    assert.equal(seen.bits, '10')
  })

  it('commuting is computed correctly', () => {
    assert.equal(commutes('XII', 'ZZI'), false)
    assert.equal(commutes('ZII', 'ZZI'), true)
    assert.equal(commutes('XXI', 'ZZI'), true, 'two anticommuting pairs commute overall')
    assert.equal(commutes('III', 'ZZI'), true)
  })

  it('every code says what it does not protect against', () => {
    for (const one of CODES) {
      assert.ok(one.protects.length > 30, `${one.id} does not say what it protects`)
      assert.ok(one.misses.length > 30, `${one.id} does not say what it misses — which is the more important half`)
    }
    for (const kind of ['bit-flip', 'phase-flip'] as const) {
      assert.equal(STABILISERS[kind].length, 2)
      for (const one of STABILISERS[kind]) assert.ok(one.detects.length > 20)
    }
  })
})
