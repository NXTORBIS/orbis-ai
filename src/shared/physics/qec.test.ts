import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODES, codeFor, errorFrom, inStabiliserGroup, KIND_SETS, oneRound, prepare, errorCorrection, type Pauli } from './qec.ts'
import { isSimulationError, run, startingValues } from './simulation.ts'

/**
 * These tests exist because three separate things were wrong here before they did, and none of the three looked
 * wrong on screen. Each had a plausible failure rate and a lab that drew itself properly.
 *
 *   1. Success was tested as "the residual Pauli is the identity". A correction differing from the error by a
 *      stabiliser is a *success*, so Shor reported about twice its true logical error rate.
 *   2. The five-qubit code's generators were stored as "an X check over these qubits", which cannot express
 *      XZZXI at all. What shipped under that name was not the five-qubit code.
 *   3. The three-qubit codes were scored against phase errors they never claimed to correct, so a working code
 *      read as worse than no code.
 */

const KINDS: readonly Pauli[] = ['X', 'Y', 'Z']

const stringFor = (qubits: number, at: Record<number, Pauli>): string =>
  Array.from({ length: qubits }, (_, one) => at[one] ?? 'I').join('')

test('every code is a valid stabiliser code: the generators commute and are independent', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    assert.equal(prepared.basis.length, code.stabilisers.length, `${code.id}: a generator is dependent on the others`)

    for (let a = 0; a < code.stabilisers.length; a += 1) {
      for (let b = 0; b < code.stabilisers.length; b += 1) {
        const round = oneRound(prepared, errorFrom(code.stabilisers[b]), 0)
        assert.equal(round.syndrome[a], 0, `${code.id}: generators ${a} and ${b} do not commute`)
      }
    }

    // n − k = number of generators, with k = 1 logical qubit.
    assert.equal(code.qubits - 1, code.stabilisers.length, `${code.id}: generator count does not match one logical qubit`)
    // Every generator is the right length, or it is not an operator on this many qubits.
    for (const one of code.stabilisers) {
      assert.equal(one.length, code.qubits, `${code.id}: generator ${one} is the wrong length`)
    }
  }
})

test('applying a stabiliser does nothing and is not detected', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    for (const one of code.stabilisers) {
      const round = oneRound(prepared, errorFrom(one), 0)
      assert.ok(round.survived, `${code.id}: stabiliser ${one} corrupted the state`)
      assert.ok(round.syndrome.every((bit) => bit === 0), `${code.id}: stabiliser ${one} set off a syndrome`)
    }
  }
})

test('a logical operator is undetectable yet changes the data — which is what makes it logical', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    for (const one of code.logical) {
      const operator = errorFrom(one.on)
      const round = oneRound(prepared, operator, 0)
      assert.ok(
        round.syndrome.every((bit) => bit === 0),
        `${code.id}: logical ${one.label} is visible to a stabiliser, so it is not a logical operator`
      )
      assert.ok(
        !inStabiliserGroup(prepared, operator),
        `${code.id}: logical ${one.label} is in the stabiliser group, so it does nothing and is not logical`
      )
    }
  }
})

test('every single-qubit error the code claims to correct is corrected — all of them, not most', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    let checked = 0
    for (const kind of KINDS) {
      if (!code.corrects.includes(kind)) continue
      for (let at = 0; at < code.qubits; at += 1) {
        const text = stringFor(code.qubits, { [at]: kind })
        const round = oneRound(prepared, errorFrom(text), 0)
        assert.ok(
          round.survived,
          `${code.id}: did not correct ${text} — syndrome ${round.syndrome.join('')}, guessed ${round.guess}`
        )
        checked += 1
      }
    }
    assert.equal(checked, code.qubits * code.corrects.length, `${code.id}: did not check every single error`)
  }
})

test('a distance-3 code must fail on some weight-two error, or it is not distance 3', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    let failed = 0
    let total = 0
    for (let a = 0; a < code.qubits; a += 1) {
      for (let b = a + 1; b < code.qubits; b += 1) {
        for (const first of KINDS) {
          for (const second of KINDS) {
            if (!code.corrects.includes(first) || !code.corrects.includes(second)) continue
            const round = oneRound(prepared, errorFrom(stringFor(code.qubits, { [a]: first, [b]: second })), 0)
            total += 1
            if (!round.survived) failed += 1
          }
        }
      }
    }
    assert.ok(total > 0, `${code.id}: no weight-two errors were testable`)
    assert.ok(failed > 0, `${code.id}: corrected every weight-two error, so it cannot be distance ${code.distance}`)
  }
})

test('the five-qubit code is perfect: every weight-two error defeats it, with no syndrome to spare', () => {
  const code = codeFor('five-qubit')
  assert.ok(code)
  const prepared = prepare(code)
  // Four generators give sixteen syndromes; fifteen single errors plus "nothing wrong" fills every one exactly.
  assert.equal(prepared.table.size, 2 ** code.stabilisers.length)
  assert.equal(2 ** code.stabilisers.length, 3 * code.qubits + 1)

  let survived = 0
  for (let a = 0; a < code.qubits; a += 1) {
    for (let b = a + 1; b < code.qubits; b += 1) {
      for (const first of KINDS) {
        for (const second of KINDS) {
          const round = oneRound(prepared, errorFrom(stringFor(code.qubits, { [a]: first, [b]: second })), 0)
          if (round.survived) survived += 1
        }
      }
    }
  }
  assert.equal(survived, 0, 'a perfect code has no spare syndromes, so no weight-two error can be absorbed')
})

test('the three-qubit codes are blind to the other kind of error, and say so', () => {
  const bit = codeFor('bit-flip')
  const phase = codeFor('phase-flip')
  assert.ok(bit && phase)

  // A phase error on the bit-flip code sets off nothing at all — there is no Z stabiliser that can see it.
  const blind = oneRound(prepare(bit), errorFrom('ZII'), 0)
  assert.ok(blind.syndrome.every((one) => one === 0), 'a Z error should be invisible to Z stabilisers')
  // And it genuinely damages the data, rather than being harmless.
  assert.ok(!blind.survived, 'an undetected phase error should corrupt the encoded state')

  // The mirror image on the phase-flip code.
  const other = oneRound(prepare(phase), errorFrom('XII'), 0)
  assert.ok(other.syndrome.every((one) => one === 0))
  assert.ok(!other.survived)

  assert.deepEqual([...bit.corrects], ['X'])
  assert.deepEqual([...phase.corrects], ['Z'])
})

test('a correction that differs from the error by a stabiliser is a success, not a failure', () => {
  // The heart of it. Within Shor's first block, Z on qubit 1 and Z on qubit 2 differ by the stabiliser ZZI...,
  // so correcting one with the other leaves the encoded state untouched. Demanding an exact cancellation here is
  // what made Shor report roughly double its true logical error rate.
  const shor = codeFor('shor')
  assert.ok(shor)
  const prepared = prepare(shor)

  const first = errorFrom('ZIIIIIIII')
  const second = errorFrom('IZIIIIIII')
  const firstRound = oneRound(prepared, first, 0)
  const secondRound = oneRound(prepared, second, 0)

  // They are indistinguishable: the same syndrome, so the decoder must give the same correction to both.
  assert.deepEqual(firstRound.syndrome, secondRound.syndrome)
  assert.equal(firstRound.guess, secondRound.guess)
  // And both survive, even though at least one of them was corrected with a different operator than it suffered.
  assert.ok(firstRound.survived && secondRound.survived, 'both must survive; they differ only by a stabiliser')
  assert.ok(firstRound.guess !== 'IIIIIIIII', 'the decoder should have corrected something')
})

test('no error means no syndrome and no correction', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    const round = oneRound(prepared, errorFrom('I'.repeat(code.qubits)), 0)
    assert.equal(round.errorWeight, 0)
    assert.ok(round.syndrome.every((one) => one === 0))
    assert.ok(round.survived)
    assert.equal(round.guess, 'I'.repeat(code.qubits))
  }
})

test('the decoder covers every syndrome it could ever be shown', () => {
  for (const code of CODES) {
    const prepared = prepare(code)
    // Independent generators span every syndrome, so a decoder missing one would be shown a syndrome it cannot
    // answer — and would silently correct nothing while the data was corrupted.
    assert.equal(prepared.table.size, 2 ** code.stabilisers.length, `${code.id}: the decoder has gaps`)
  }
})

test('a run reports a logical error rate below the physical one, and a finite improvement', () => {
  for (const code of CODES) {
    const values = {
      ...startingValues(errorCorrection),
      code: CODES.indexOf(code),
      errorKinds: 0,
      errorRate: 0.02,
      roundsPerSecond: 50,
      seed: 11
    }
    const report = run(errorCorrection, values, { seconds: 30, dt: 0.01 })
    assert.ok(!isSimulationError(report), `${code.id}: ${isSimulationError(report) ? report.message : ''}`)

    const rate = report.now.rate as number
    const physical = report.now.physical as number
    assert.ok(Number.isFinite(rate), `${code.id}: the logical rate is not a number`)
    // An infinity here used to make the runner call a perfectly working code diverged.
    assert.ok(Number.isFinite(report.now.improvement as number), `${code.id}: improvement is not finite`)
    assert.ok(Number(report.now.rounds) > 100, `${code.id}: too few rounds to say anything`)
    assert.ok(rate < physical, `${code.id}: logical ${rate} should beat physical ${physical}`)
    assert.equal(Number(report.now.survived) + Number(report.now.corrupted), Number(report.now.rounds))
  }
})

test('above the threshold, correcting stops helping', () => {
  const values = { ...startingValues(errorCorrection), code: 0, errorKinds: 0, errorRate: 0.45, roundsPerSecond: 50, seed: 5 }
  const report = run(errorCorrection, values, { seconds: 30, dt: 0.01 })
  assert.ok(!isSimulationError(report))
  // At this rate the code is not merely imperfect, it is a liability — which is the threshold theorem in one line.
  assert.ok((report.now.rate as number) > (report.now.physical as number) * 0.9, 'past threshold the code should not be winning')
})

test('the same seed gives exactly the same run', () => {
  const values = { ...startingValues(errorCorrection), code: 3, errorKinds: 3, errorRate: 0.08, roundsPerSecond: 20, seed: 42 }
  const first = run(errorCorrection, values, { seconds: 10, dt: 0.01 })
  const second = run(errorCorrection, values, { seconds: 10, dt: 0.01 })
  assert.ok(!isSimulationError(first) && !isSimulationError(second))
  assert.deepEqual(first.now, second.now)
})

test('widening the error kinds makes a one-kind code worse, which is the honest comparison', () => {
  const base = { ...startingValues(errorCorrection), code: 0, errorRate: 0.05, roundsPerSecond: 50, seed: 9 }
  const fair = run(errorCorrection, { ...base, errorKinds: 0 }, { seconds: 30, dt: 0.01 })
  const unfair = run(errorCorrection, { ...base, errorKinds: 3 }, { seconds: 30, dt: 0.01 })
  assert.ok(!isSimulationError(fair) && !isSimulationError(unfair))
  // Scored on the job it claims, the bit-flip code wins. Scored on all three kinds, it loses — and that is a true
  // statement about the code, not a bug. The default is the fair one so the lab does not libel a working code.
  assert.ok((fair.now.rate as number) < (base.errorRate as number))
  assert.ok((unfair.now.rate as number) > (fair.now.rate as number))
  assert.equal(KIND_SETS[0].kinds.length, 0, 'the first setting must defer to the code itself')
})
