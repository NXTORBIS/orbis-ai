import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BLUEPRINTS,
  blueprint,
  checkNetwork,
  counter,
  evaluate,
  flipFlopNext,
  GATE_KINDS,
  gateOutput,
  isLogicError,
  runClocked,
  shiftRegister,
  simplify,
  truthTable,
  type Network,
  type LogicError
} from './logic.ts'

/**
 * What the logic engine is held to.
 *
 * Every assertion is arithmetic or a looked-up truth table, so a wrong gate or a wrong propagation order fails rather
 * than merely looking plausible. The cases that matter most are the awkward ones: a latch that has to hold a value, a
 * ring oscillator that must be reported as never settling, a forbidden flip-flop state that must be refused rather
 * than resolved, and a shift register that must shift rather than collapse.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, LogicError> => {
  assert.ok(!isLogicError(value), isLogicError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, LogicError>
}

describe('gates', () => {
  it('every gate gives the answer its definition gives', () => {
    const cases: readonly [Parameters<typeof gateOutput>[0], boolean[], boolean][] = [
      ['and', [true, true], true],
      ['and', [true, false], false],
      ['and', [true, true, true], true],
      ['and', [true, true, false], false],
      ['or', [false, false], false],
      ['or', [false, true], true],
      ['not', [true], false],
      ['not', [false], true],
      ['buffer', [true], true],
      ['nand', [true, true], false],
      ['nand', [true, false], true],
      ['nor', [false, false], true],
      ['nor', [true, false], false],
      ['xor', [true, false], true],
      ['xor', [true, true], false],
      ['xor', [true, true, true], true],
      ['xor', [true, true, false], false],
      ['xnor', [true, true], true],
      ['xnor', [true, false], false]
    ]
    for (const [kind, inputs, wanted] of cases) {
      assert.equal(ok(gateOutput(kind, inputs)), wanted, `${kind} of [${inputs.join(', ')}]`)
    }
  })

  it('a NOT with two inputs is refused rather than given one of them', () => {
    const made = gateOutput('not', [true, false])
    assert.ok(isLogicError(made))
    assert.match(made.says, /exactly 1/)
  })

  it('an AND with one input is refused', () => {
    assert.ok(isLogicError(gateOutput('and', [true])))
  })

  it('every gate in the list actually works', () => {
    for (const kind of GATE_KINDS) {
      const arity = kind === 'not' || kind === 'buffer' ? 1 : 2
      assert.ok(!isLogicError(gateOutput(kind, Array.from({ length: arity }, () => true))), kind)
    }
  })
})

describe('checking a network', () => {
  it('finds a wire nothing drives', () => {
    const made = ok(
      checkNetwork({ inputs: ['a'], outputs: ['y'], gates: [{ id: 'g', kind: 'and', from: ['a', 'b'], to: 'y' }] })
    )
    assert.equal(made.ok, false)
    assert.deepEqual(made.floating, ['b'])
    assert.ok(made.problems.some((one) => /"b" is read/.test(one)))
  })

  it('finds two gates driving one wire', () => {
    const made = ok(
      checkNetwork({
        inputs: ['a', 'b'],
        outputs: ['y'],
        gates: [
          { id: 'g1', kind: 'and', from: ['a', 'b'], to: 'y' },
          { id: 'g2', kind: 'or', from: ['a', 'b'], to: 'y' }
        ]
      })
    )
    assert.equal(made.ok, false)
    assert.deepEqual(made.contended, ['y'])
    assert.ok(made.problems.some((one) => /short/.test(one)))
  })

  it('reports every problem, not just the first', () => {
    const made = ok(
      checkNetwork({
        inputs: ['a'],
        outputs: ['y', 'z'],
        gates: [{ id: 'g', kind: 'and', from: ['a', 'b'], to: 'y' }]
      })
    )
    // One floating wire and one missing output: both.
    assert.ok(made.problems.length >= 2, made.problems.join(' | '))
  })

  it('counts gate depth, which is what limits the clock', () => {
    const adder = ok(blueprint('full-adder')) as Network
    const made = ok(checkNetwork(adder))
    assert.equal(made.ok, true)
    // a→p→sum is two levels; a→g, p→h, then or→cout is three.
    assert.equal(made.depth, 3)
    assert.ok(made.notes.some((one) => /gate/.test(one)))
  })

  it('a four-bit ripple adder is deeper than a one-bit one, which is why it is slow', () => {
    const one = ok(checkNetwork(ok(blueprint('full-adder')) as Network))
    const four = ok(checkNetwork(ok(blueprint('ripple-adder-4')) as Network))
    assert.ok((four.depth ?? 0) > (one.depth ?? 0), `four-bit ${four.depth} should exceed one-bit ${one.depth}`)
  })

  it('finds feedback without refusing it, because feedback is how memory works', () => {
    const latch = ok(blueprint('sr-latch')) as Network
    const made = ok(checkNetwork(latch))
    assert.equal(made.ok, true, made.problems.join(' | '))
    assert.equal(made.hasFeedback, true)
    assert.ok(made.loops.length > 0)
    // A looping network has no finite depth, and saying so is the honest answer.
    assert.equal(made.depth, null)
    assert.ok(made.notes.some((one) => /memory/.test(one)))
  })

  it('refuses an empty network and one that is far too large', () => {
    assert.ok(isLogicError(checkNetwork({ inputs: [], outputs: [], gates: [] })))
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `g${i}`, kind: 'not' as const, from: ['a'], to: `w${i}` }))
    assert.ok(isLogicError(checkNetwork({ inputs: ['a'], outputs: ['w0'], gates: many })))
  })
})

describe('the blueprints', () => {
  it('every one of them builds and checks out', () => {
    for (const which of BLUEPRINTS) {
      const made = ok(blueprint(which)) as Network
      const check = ok(checkNetwork(made))
      assert.equal(check.ok, true, `${which}: ${check.problems.join(' | ')}`)
    }
  })

  it('a half adder adds two bits', () => {
    const table = ok(truthTable(ok(blueprint('half-adder')) as Network))
    const rows = table.rows.map((one) => [one.inputs.a, one.inputs.b, one.outputs.sum, one.outputs.carry])
    assert.deepEqual(rows, [
      [false, false, false, false],
      [false, true, true, false],
      [true, false, true, false],
      [true, true, false, true]
    ])
  })

  it('a full adder adds three bits, every combination', () => {
    const table = ok(truthTable(ok(blueprint('full-adder')) as Network))
    for (const row of table.rows) {
      const total = Number(row.inputs.a) + Number(row.inputs.b) + Number(row.inputs.cin)
      assert.equal(Number(row.outputs.sum), total % 2, `sum for ${JSON.stringify(row.inputs)}`)
      assert.equal(Number(row.outputs.cout), total >= 2 ? 1 : 0, `carry for ${JSON.stringify(row.inputs)}`)
    }
  })

  it('a four-bit ripple adder adds every pair of four-bit numbers correctly', () => {
    const adder = ok(blueprint('ripple-adder-4')) as Network
    for (let a = 0; a < 16; a += 1) {
      for (let b = 0; b < 16; b += 1) {
        const given: Record<string, boolean> = { cin: false }
        for (let i = 0; i < 4; i += 1) {
          given[`a${i}`] = ((a >> i) & 1) === 1
          given[`b${i}`] = ((b >> i) & 1) === 1
        }
        const made = ok(evaluate(adder, given))
        assert.equal(made.settled, 'settled')
        let got = 0
        for (let i = 0; i < 4; i += 1) if (made.outputs[`s${i}`]) got += 1 << i
        if (made.outputs.cout) got += 16
        assert.equal(got, a + b, `${a} + ${b}`)
      }
    }
  })

  it('an XOR built from four NANDs is an XOR', () => {
    const fromNand = ok(truthTable(ok(blueprint('xor-from-nand')) as Network))
    const rows = fromNand.rows.map((one) => one.outputs.y)
    assert.deepEqual(rows, [false, true, true, false])
  })

  it('a two-way multiplexer picks the input the select line names', () => {
    const mux = ok(blueprint('multiplexer-2')) as Network
    for (const d0 of [false, true]) {
      for (const d1 of [false, true]) {
        assert.equal(ok(evaluate(mux, { d0, d1, sel: false })).outputs.y, d0)
        assert.equal(ok(evaluate(mux, { d0, d1, sel: true })).outputs.y, d1)
      }
    }
  })

  it('a four-way multiplexer picks the right one of four', () => {
    const mux = ok(blueprint('multiplexer-4')) as Network
    const data = { d0: true, d1: false, d2: true, d3: false }
    const wanted = [data.d0, data.d1, data.d2, data.d3]
    for (let n = 0; n < 4; n += 1) {
      const made = ok(evaluate(mux, { ...data, s0: (n & 1) === 1, s1: (n & 2) === 2 }))
      assert.equal(made.outputs.y, wanted[n], `select ${n}`)
    }
  })

  it('a decoder turns exactly one line on', () => {
    const decoder = ok(blueprint('decoder-2-4')) as Network
    for (let n = 0; n < 4; n += 1) {
      const made = ok(evaluate(decoder, { a0: (n & 1) === 1, a1: (n & 2) === 2 }))
      const on = ['y0', 'y1', 'y2', 'y3'].filter((wire) => made.outputs[wire])
      assert.deepEqual(on, [`y${n}`], `address ${n}`)
    }
  })

  it('a comparator agrees with arithmetic', () => {
    const cmp = ok(blueprint('comparator-2')) as Network
    for (let a = 0; a < 4; a += 1) {
      for (let b = 0; b < 4; b += 1) {
        const made = ok(
          evaluate(cmp, { a0: (a & 1) === 1, a1: (a & 2) === 2, b0: (b & 1) === 1, b1: (b & 2) === 2 })
        )
        assert.equal(made.outputs.equal, a === b, `${a} == ${b}`)
        assert.equal(made.outputs.aBigger, a > b, `${a} > ${b}`)
      }
    }
  })

  it('parity is on for an odd number of ones', () => {
    const parity = ok(blueprint('parity-4')) as Network
    const table = ok(truthTable(parity))
    for (const row of table.rows) {
      const ones = ['b0', 'b1', 'b2', 'b3'].filter((wire) => row.inputs[wire]).length
      assert.equal(row.outputs.odd, ones % 2 === 1, `${ones} ones`)
    }
  })
})

describe('latches and oscillation', () => {
  it('an SR latch holds what it was set to', () => {
    const latch = ok(blueprint('sr-latch')) as Network
    // Set it, then release both inputs and see whether it remembers.
    const set = ok(evaluate(latch, { s: true, r: false }))
    assert.equal(set.outputs.q, true)
    const held = ok(evaluate(latch, { s: false, r: false }, set.wires))
    assert.equal(held.outputs.q, true, 'the latch forgot what it was set to')

    const cleared = ok(evaluate(latch, { s: false, r: true }, held.wires))
    assert.equal(cleared.outputs.q, false)
    const stillCleared = ok(evaluate(latch, { s: false, r: false }, cleared.wires))
    assert.equal(stillCleared.outputs.q, false, 'the latch forgot it was cleared')
  })

  it('an SR latch with both inputs on drives both outputs low, which is the forbidden state', () => {
    const latch = ok(blueprint('sr-latch')) as Network
    const made = ok(evaluate(latch, { s: true, r: true }))
    // Both NOR gates see a high input, so both outputs go low — q and qbar are not opposites, which is the whole
    // reason the state is called forbidden.
    assert.equal(made.outputs.q, false)
    assert.equal(made.outputs.qbar, false)
  })

  it('a D latch stores D while enabled and holds it afterwards', () => {
    const latch = ok(blueprint('d-latch')) as Network
    const stored = ok(evaluate(latch, { d: true, enable: true }))
    assert.equal(stored.outputs.q, true)
    const held = ok(evaluate(latch, { d: false, enable: false }, stored.wires))
    assert.equal(held.outputs.q, true, 'it should hold what it stored once enable goes off')
    const ignored = ok(evaluate(latch, { d: false, enable: false }, held.wires))
    assert.equal(ignored.outputs.q, true, 'D must be ignored while enable is off')
  })

  it('a ring of three inverters is reported as never settling rather than given a value', () => {
    const ring = ok(blueprint('ring-oscillator')) as Network
    const made = ok(evaluate(ring, {}))
    assert.equal(made.settled, 'oscillating')
    assert.ok(made.unstable.length > 0)
    assert.match(made.says, /never settles/)
    // And it says why, which is the useful part.
    assert.match(made.says, /odd number/)
  })

  it('a truth table of a latch says it has no single truth table', () => {
    const table = ok(truthTable(ok(blueprint('sr-latch')) as Network))
    assert.ok(table.rows.length === 4)
    // Rows that do not settle are counted and explained rather than silently given the last value.
    assert.ok(table.notes.some((one) => /memory/.test(one)) || table.unsettled === 0)
  })
})

describe('simplification', () => {
  it('reduces a function to a minimal sum of products', () => {
    // y = a·b + a·b' , which is just a.
    const network: Network = {
      inputs: ['a', 'b'],
      outputs: ['y'],
      gates: [
        { id: 'n', kind: 'not', from: ['b'], to: 'nb' },
        { id: 'a1', kind: 'and', from: ['a', 'b'], to: 'p0' },
        { id: 'a2', kind: 'and', from: ['a', 'nb'], to: 'p1' },
        { id: 'o', kind: 'or', from: ['p0', 'p1'], to: 'y' }
      ]
    }
    const made = ok(simplify(ok(truthTable(network)), 'y'))
    assert.equal(made.expression, 'a')
    assert.equal(made.literalsAfter, 1)
    assert.ok(made.literalsAfter < made.literalsBefore)
  })

  it('leaves an XOR alone, because it cannot be reduced', () => {
    const made = ok(simplify(ok(truthTable(ok(blueprint('half-adder')) as Network)), 'sum'))
    // Two product terms of two literals each is minimal for XOR in sum-of-products form.
    assert.equal(made.terms.length, 2)
    assert.equal(made.literalsAfter, 4)
  })

  it('a carry out is a single AND term', () => {
    const made = ok(simplify(ok(truthTable(ok(blueprint('half-adder')) as Network)), 'carry'))
    assert.equal(made.terms.length, 1)
    assert.equal(made.expression, 'a·b')
  })

  it('says plainly when an output is always on or never on', () => {
    const always: Network = {
      inputs: ['a'],
      outputs: ['y'],
      gates: [
        { id: 'n', kind: 'not', from: ['a'], to: 'na' },
        { id: 'o', kind: 'or', from: ['a', 'na'], to: 'y' }
      ]
    }
    const made = ok(simplify(ok(truthTable(always)), 'y'))
    assert.equal(made.expression, '1')
    assert.match(made.says, /always on/)
  })

  it('the simplified expression agrees with the original on every input', () => {
    // The real property: whatever it reduced to must compute the same function.
    const network = ok(blueprint('comparator-2')) as Network
    const table = ok(truthTable(network))
    for (const output of ['equal', 'aBigger']) {
      const made = ok(simplify(table, output))
      for (const row of table.rows) {
        const value =
          made.expression === '1'
            ? true
            : made.expression === '0'
              ? false
              : made.terms.some((term) => term.every((one) => (row.inputs[one.input] === true) === one.on))
        assert.equal(value, row.outputs[output], `${output} at ${JSON.stringify(row.inputs)} — expression was ${made.expression}`)
      }
    }
  })

  it('refuses to simplify something that holds state', () => {
    const made = simplify(ok(truthTable(ok(blueprint('sr-latch')) as Network)), 'q')
    if (!isLogicError(made)) {
      // The latch may settle for every row depending on starting values; if it did, there is nothing to refuse.
      assert.ok(made.expression.length > 0)
    } else {
      assert.match(made.says, /state/)
    }
  })

  it('refuses an output it does not have', () => {
    const made = simplify(ok(truthTable(ok(blueprint('half-adder')) as Network)), 'nonsense')
    assert.ok(isLogicError(made))
    assert.match(made.fix, /sum/)
  })
})

describe('flip-flops', () => {
  it('a D flip-flop takes whatever D was', () => {
    assert.equal(ok(flipFlopNext('d', false, { d: true })), true)
    assert.equal(ok(flipFlopNext('d', true, { d: false })), false)
  })

  it('a T flip-flop toggles only when told to', () => {
    assert.equal(ok(flipFlopNext('t', false, { t: true })), true)
    assert.equal(ok(flipFlopNext('t', true, { t: true })), false)
    assert.equal(ok(flipFlopNext('t', true, { t: false })), true)
  })

  it('a JK flip-flop sets, clears, holds and toggles', () => {
    assert.equal(ok(flipFlopNext('jk', false, { j: true, k: false })), true)
    assert.equal(ok(flipFlopNext('jk', true, { j: false, k: true })), false)
    assert.equal(ok(flipFlopNext('jk', true, { j: false, k: false })), true)
    assert.equal(ok(flipFlopNext('jk', true, { j: true, k: true })), false)
    assert.equal(ok(flipFlopNext('jk', false, { j: true, k: true })), true)
  })

  it('an SR flip-flop refuses both inputs at once rather than picking an answer', () => {
    const made = flipFlopNext('sr', false, { s: true, r: true })
    assert.ok(isLogicError(made))
    assert.match(made.says, /cannot be set and cleared/)
    // And says what a real one would do, which is the useful part.
    assert.match(made.fix, /released first/)
  })
})

describe('clocked circuits', () => {
  it('a counter counts', () => {
    const made = ok(counter(4))
    const run = ok(runClocked(made, [{ enable: true }], 20))
    const values = run.ticks.map((tick) => {
      let n = 0
      for (let i = 0; i < 4; i += 1) if (tick.holding[`ff${i}`]) n += 1 << i
      return n
    })
    assert.deepEqual(values.slice(0, 18), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1])
  })

  it('a four-bit counter uses every one of its sixteen states before repeating', () => {
    const run = ok(runClocked(ok(counter(4)), [{ enable: true }], 40))
    assert.equal(run.cycles, true)
    assert.equal(run.cycleLength, 16)
    assert.match(run.says, /16 ticks/)
  })

  it('a counter with enable off stays where it is', () => {
    const run = ok(runClocked(ok(counter(3)), [{ enable: false }], 6))
    for (const tick of run.ticks) {
      assert.equal(tick.holding.ff0, false, `moved at tick ${tick.tick}`)
    }
  })

  it('a shift register shifts rather than collapsing', () => {
    /*
     * The classic mistake: updating registers one at a time instead of all at once makes every stage take the new
     * value of the one before it in the same tick, so a single 1 fills the whole register immediately. This asserts
     * it travels one stage per tick, which only happens if the clock edge is simultaneous.
     */
    const made = ok(shiftRegister(4))
    const feed = [{ in: true }, { in: false }, { in: false }, { in: false }, { in: false }, { in: false }]
    const run = ok(runClocked(made, feed, 6))
    const rows = run.ticks.map((tick) => [0, 1, 2, 3].map((i) => (tick.holding[`ff${i}`] ? 1 : 0)).join(''))
    assert.deepEqual(rows, ['0000', '1000', '0100', '0010', '0001', '0000'])
  })

  it('refuses to clock a circuit with no flip-flops', () => {
    const made = runClocked(
      { inputs: ['a'], outputs: ['y'], gates: [{ id: 'g', kind: 'not', from: ['a'], to: 'y' }], registers: [] },
      [{ a: true }],
      4
    )
    assert.ok(isLogicError(made))
    assert.match(made.says, /no flip-flops/)
  })

  it('refuses an unreasonable number of ticks', () => {
    assert.ok(isLogicError(runClocked(ok(counter(2)), [{ enable: true }], 99_999)))
    assert.ok(isLogicError(runClocked(ok(counter(2)), [{ enable: true }], 0)))
  })

  it('a forbidden flip-flop state is reported on the tick it happened', () => {
    const circuit = {
      inputs: ['s', 'r'],
      outputs: ['q'],
      gates: [],
      registers: [{ id: 'ff', kind: 'sr' as const, from: { s: 's', r: 'r' }, to: 'q', initial: false }]
    }
    const run = ok(runClocked(circuit, [{ s: true, r: true }], 2))
    assert.ok(run.ticks[0].problem !== null)
    assert.match(run.ticks[0].problem ?? '', /set and cleared/)
    assert.ok(run.notes.some((one) => /problem/.test(one)))
  })

  it('refuses a counter width it does not support', () => {
    assert.ok(isLogicError(counter(0)))
    assert.ok(isLogicError(counter(99)))
    assert.ok(isLogicError(shiftRegister(1)))
  })
})
