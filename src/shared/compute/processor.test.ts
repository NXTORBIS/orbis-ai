import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  alu,
  assemble,
  Cache,
  isProcessorError,
  OP_KINDS,
  pipeline,
  run,
  sample,
  SAMPLES,
  type Program,
  type ProcessorError
} from './processor.ts'

/**
 * What the processor is held to.
 *
 * The programs here have answers that can be worked out on paper — a factorial, a sum, a maximum — so a wrong
 * arithmetic unit or a wrong branch fails rather than merely producing something. The pipeline assertions are the
 * ones that matter most: with forwarding and without must give the *same answer* in a *different number of cycles*,
 * and if either half of that is wrong the whole laboratory is decoration.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, ProcessorError> => {
  assert.ok(!isProcessorError(value), isProcessorError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, ProcessorError>
}

const build = (which: Parameters<typeof sample>[0]): { program: Program; memory: Readonly<Record<number, number>> } => {
  const made = ok(sample(which))
  return { program: ok(assemble(made.source)), memory: made.memory }
}

describe('the arithmetic unit', () => {
  it('does the arithmetic', () => {
    assert.equal(ok(alu('add', 7, 5)).value, 12)
    assert.equal(ok(alu('sub', 7, 5)).value, 2)
    assert.equal(ok(alu('mul', 7, 5)).value, 35)
    assert.equal(ok(alu('and', 0b1100, 0b1010)).value, 0b1000)
    assert.equal(ok(alu('or', 0b1100, 0b1010)).value, 0b1110)
    assert.equal(ok(alu('xor', 0b1100, 0b1010)).value, 0b0110)
    assert.equal(ok(alu('sll', 1, 4)).value, 16)
    assert.equal(ok(alu('srl', 16, 4)).value, 1)
    assert.equal(ok(alu('slt', 3, 9)).value, 1)
    assert.equal(ok(alu('slt', 9, 3)).value, 0)
  })

  it('sets zero and negative the way a real unit would', () => {
    const zero = ok(alu('sub', 5, 5))
    assert.equal(zero.zero, true)
    assert.equal(zero.negative, false)
    const negative = ok(alu('sub', 3, 9))
    assert.equal(negative.negative, true)
    assert.equal(negative.value, -6)
  })

  it('wraps at 32 bits and says that it did, rather than returning a number no register could hold', () => {
    const made = ok(alu('add', 0x7fffffff, 1))
    assert.equal(made.overflow, true)
    assert.equal(made.value, -0x80000000)
    assert.match(made.says, /wrapped round/)
  })

  it('only the low five bits of a shift amount matter, as on a real machine', () => {
    // Shifting by 33 is shifting by 1, not by 33.
    assert.equal(ok(alu('sll', 1, 33)).value, 2)
  })

  it('refuses something that is not arithmetic', () => {
    assert.ok(isProcessorError(alu('beq', 1, 1)))
  })
})

describe('assembling', () => {
  it('reads a simple program', () => {
    const made = ok(assemble('li r1, 5\naddi r2, r1, 3\nhalt'))
    assert.equal(made.instructions.length, 3)
    assert.equal(made.instructions[0].kind, 'li')
    assert.equal(made.instructions[0].rd, 1)
    assert.equal(made.instructions[0].value, 5)
    assert.equal(made.instructions[1].ra, 1)
  })

  it('resolves a label used before it is defined, and one used after', () => {
    const made = ok(assemble('j ahead\nnop\nahead:\nli r1, 1\nblt r0, r1, ahead\nhalt'))
    assert.equal(made.labels.ahead, 2)
    assert.equal(made.instructions[0].value, 2)
    // The backwards branch resolves to the same place.
    assert.equal(made.instructions[3].value, 2)
  })

  it('reads memory addressing written as an offset from a register', () => {
    const made = ok(assemble('lw r1, 8(r2)\nsw r3, -4(r2)\nhalt'))
    assert.equal(made.instructions[0].value, 8)
    assert.equal(made.instructions[0].ra, 2)
    assert.equal(made.instructions[0].rd, 1)
    assert.equal(made.instructions[1].value, -4)
    assert.equal(made.instructions[1].rb, 3)
  })

  it('ignores comments and blank lines', () => {
    const made = ok(assemble('; a comment\n\nli r1, 1   # another\n\nhalt'))
    assert.equal(made.instructions.length, 2)
  })

  it('refuses an instruction it does not have, and says what it does have', () => {
    const made = assemble('frobnicate r1, r2')
    assert.ok(isProcessorError(made))
    assert.match(made.says, /not an instruction/)
    assert.match(made.fix, /add/)
    assert.equal(made.line, 1)
  })

  it('refuses a register that does not exist', () => {
    const made = assemble('li r99, 1')
    assert.ok(isProcessorError(made))
    assert.match(made.says, /not one/)
  })

  it('refuses a branch to nowhere, and names the line', () => {
    const made = assemble('li r1, 1\nbeq r1, r1, nowhere')
    assert.ok(isProcessorError(made))
    assert.match(made.says, /nowhere/)
    assert.equal(made.line, 2)
  })

  it('refuses a duplicate label', () => {
    assert.ok(isProcessorError(assemble('top:\nnop\ntop:\nnop')))
  })

  it('refuses an empty program', () => {
    assert.ok(isProcessorError(assemble('   \n; nothing\n')))
  })

  it('says when there is no halt, rather than failing', () => {
    const made = ok(assemble('li r1, 1'))
    assert.ok(made.notes.some((one) => /no halt/.test(one)))
  })

  it('says when something writes to r0, which is always zero', () => {
    const made = ok(assemble('li r0, 5\nhalt'))
    assert.ok(made.notes.some((one) => /r0/.test(one)))
  })

  it('every instruction in the list can be assembled', () => {
    // A fault this catches: an instruction listed in OPS with no case in the reader, which would be a dead entry.
    const written: Readonly<Record<string, string>> = {
      add: 'add r1, r2, r3', sub: 'sub r1, r2, r3', mul: 'mul r1, r2, r3', and: 'and r1, r2, r3',
      or: 'or r1, r2, r3', xor: 'xor r1, r2, r3', sll: 'sll r1, r2, r3', srl: 'srl r1, r2, r3',
      slt: 'slt r1, r2, r3', addi: 'addi r1, r2, 4', andi: 'andi r1, r2, 4', ori: 'ori r1, r2, 4',
      slti: 'slti r1, r2, 4', li: 'li r1, 4', mov: 'mov r1, r2', lw: 'lw r1, 0(r2)', sw: 'sw r1, 0(r2)',
      beq: 'here: beq r1, r2, here', bne: 'here: bne r1, r2, here', blt: 'here: blt r1, r2, here',
      j: 'here: j here', jal: 'here: jal here', jr: 'jr r1', nop: 'nop', halt: 'halt'
    }
    for (const kind of OP_KINDS) {
      const text = written[kind]
      assert.ok(text !== undefined, `${kind} has no example written for it in this test`)
      assert.ok(!isProcessorError(assemble(text)), `${kind} could not be assembled from "${text}"`)
    }
  })
})

describe('running', () => {
  it('counts to ten', () => {
    const { program } = build('count')
    const made = run(program)
    assert.equal(made.problem, null)
    assert.equal(made.registers[1], 10)
    assert.equal(made.halted, true)
  })

  it('adds up an array, and the answer is the sum', () => {
    const { program, memory } = build('sum-array')
    const made = run(program, { memory })
    assert.equal(made.problem, null)
    const wanted = Object.values(memory).reduce((a, b) => a + b, 0)
    assert.equal(made.registers[1], wanted)
    assert.equal(made.memory[100], wanted)
  })

  it('finds the largest in an array', () => {
    const { program, memory } = build('max-of-array')
    const made = run(program, { memory })
    assert.equal(made.problem, null)
    assert.equal(made.memory[100], Math.max(...Object.values(memory)))
  })

  it('works out a factorial', () => {
    const { program } = build('factorial')
    const made = run(program)
    assert.equal(made.problem, null)
    assert.equal(made.memory[100], 5040, '7! is 5040')
  })

  it('writes the Fibonacci numbers into memory', () => {
    const { program } = build('fibonacci')
    const made = run(program)
    assert.equal(made.problem, null)
    const got = Array.from({ length: 12 }, (_, i) => made.memory[i])
    assert.deepEqual(got, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89])
  })

  it('r0 stays zero however hard a program tries', () => {
    const made = run(ok(assemble('li r0, 99\naddi r0, r0, 5\nhalt')))
    assert.equal(made.registers[0], 0)
  })

  it('a jump and link comes back to where it left', () => {
    const made = run(
      ok(assemble(`li r1, 0
jal double
addi r1, r1, 100
halt
double:
addi r1, r1, 7
jr r15`))
    )
    assert.equal(made.problem, null)
    // 7 from the function, then 100 after returning.
    assert.equal(made.registers[1], 107)
  })

  it('reading past the end of memory stops the program and says why', () => {
    const made = run(ok(assemble('li r1, 99999\nlw r2, 0(r1)\nhalt')))
    assert.ok(made.problem !== null)
    assert.match(made.problem.says, /memory runs from/)
    assert.match(made.problem.fix, /base register/)
  })

  it('a loop with no way out is stopped rather than hanging', () => {
    const made = run(ok(assemble('top:\nj top')), { cycles: 500 })
    assert.equal(made.ranAway, true)
    assert.ok(made.notes.some((one) => /never becomes false/.test(one)))
  })

  it('every step records what it did', () => {
    const made = run(ok(assemble('li r1, 3\naddi r2, r1, 4\nhalt')))
    assert.equal(made.steps.length, 3)
    assert.match(made.steps[1].says, /r2 = 7/)
    assert.equal(made.steps[1].alu?.value, 7)
  })

  it('every sample program runs without a problem', () => {
    for (const which of SAMPLES) {
      const { program, memory } = build(which)
      const made = run(program, { memory })
      assert.equal(made.problem, null, `${which}: ${made.problem?.says ?? ''}`)
      assert.equal(made.ranAway, false, `${which} did not finish`)
    }
  })
})

describe('the cache', () => {
  it('a second read of the same address hits', () => {
    const cache = new Cache({ size: 64, lineSize: 4, ways: 1, replacement: 'lru' })
    assert.equal(cache.access(0, false), false)
    assert.equal(cache.access(0, false), true)
    const made = cache.report()
    assert.equal(made.hits, 1)
    assert.equal(made.misses, 1)
    assert.equal(made.coldMisses, 1)
  })

  it('reading along a line hits for the rest of it', () => {
    const cache = new Cache({ size: 64, lineSize: 4, ways: 1, replacement: 'lru' })
    for (let i = 0; i < 4; i += 1) cache.access(i, false)
    const made = cache.report()
    // One miss to bring the line in, then three hits from it.
    assert.equal(made.misses, 1)
    assert.equal(made.hits, 3)
  })

  it('a stride larger than the line size misses every time', () => {
    const cache = new Cache({ size: 64, lineSize: 4, ways: 1, replacement: 'lru' })
    for (let i = 0; i < 16; i += 1) cache.access(i * 16, false)
    const made = cache.report()
    assert.equal(made.hits, 0, 'nothing should hit when every access is a new line')
    assert.equal(made.hitRate, 0)
  })

  it('tells a conflict miss from a cold one, because they need different fixes', () => {
    // Two addresses that land in the same set of a direct-mapped cache, read alternately.
    const cache = new Cache({ size: 16, lineSize: 4, ways: 1, replacement: 'lru' })
    const sets = cache.setCount
    const strideToSameSet = sets * 4
    for (let round = 0; round < 4; round += 1) {
      cache.access(0, false)
      cache.access(strideToSameSet, false)
    }
    const made = cache.report()
    assert.ok(made.conflictMisses > 0, 'alternating between two addresses in one set must produce conflict misses')
    assert.ok(made.notes.some((one) => /conflict/.test(one)))
  })

  it('more ways removes the conflict that a direct-mapped cache had', () => {
    const settings = { size: 16, lineSize: 4, replacement: 'lru' as const }
    const direct = new Cache({ ...settings, ways: 1 })
    const twoWay = new Cache({ ...settings, ways: 2 })
    const sets = direct.setCount
    const stride = sets * 4
    for (let round = 0; round < 6; round += 1) {
      for (const cache of [direct, twoWay]) {
        cache.access(0, false)
        cache.access(stride, false)
      }
    }
    // The whole reason associativity exists.
    assert.ok(
      twoWay.report().hits > direct.report().hits,
      `two-way got ${twoWay.report().hits} hits, direct-mapped got ${direct.report().hits}`
    )
  })

  it('counts a write-back when a changed line is evicted', () => {
    const cache = new Cache({ size: 8, lineSize: 4, ways: 1, replacement: 'lru' })
    cache.access(0, true)
    const sets = cache.setCount
    cache.access(sets * 4, false)
    assert.ok(cache.report().writeBacks > 0)
  })

  it('says plainly when the program never touched memory', () => {
    const made = new Cache({ size: 64, lineSize: 4, ways: 1, replacement: 'lru' }).report()
    assert.match(made.says, /No memory accesses/)
    assert.ok(made.notes.some((one) => /never used/.test(one)))
  })

  it('the stride-walk program really does miss almost everything', () => {
    const { program, memory } = build('stride-walk')
    const made = run(program, { memory, cache: { size: 64, lineSize: 4, ways: 1, replacement: 'lru' } })
    assert.equal(made.problem, null)
    assert.ok(made.cache.hitRate < 0.2, `hit rate was ${(made.cache.hitRate * 100).toFixed(0)}%`)
  })

  it('a bigger line helps a program that reads in order', () => {
    const { program, memory } = build('sum-array')
    const small = run(program, { memory, cache: { size: 64, lineSize: 1, ways: 1, replacement: 'lru' } })
    const big = run(program, { memory, cache: { size: 64, lineSize: 8, ways: 1, replacement: 'lru' } })
    assert.ok(big.cache.hitRate > small.cache.hitRate, `big ${big.cache.hitRate} should beat small ${small.cache.hitRate}`)
  })

  it('the same program twice gives the same cache answer, even with the random policy', () => {
    const { program, memory } = build('sum-array')
    const settings = { size: 32, lineSize: 4, ways: 2, replacement: 'random' as const }
    const first = run(program, { memory, cache: settings })
    const second = run(program, { memory, cache: settings })
    assert.equal(first.cache.hits, second.cache.hits)
  })
})

describe('the pipeline', () => {
  it('a program with nothing in its way approaches one cycle per instruction', () => {
    const made = pipeline(run(ok(assemble('li r1, 1\nli r2, 2\nli r3, 3\nli r4, 4\nli r5, 5\nhalt'))))
    assert.equal(made.hazards.length, 0)
    // Six instructions, five stages: 6 + 4 = 10 cycles, so well under 2 per instruction.
    assert.ok(made.cpi < 2, `cpi was ${made.cpi}`)
    assert.ok(made.cycles < made.withoutPipeline, 'a pipeline must beat no pipeline')
    assert.ok(made.notes.some((one) => /best a five-stage/.test(one)))
  })

  it('forwarding removes the stalls that not forwarding has', () => {
    // Each instruction needs the register the one before it wrote: the worst case for forwarding.
    const chain = run(ok(assemble('li r1, 1\naddi r2, r1, 1\naddi r3, r2, 1\naddi r4, r3, 1\nhalt')))
    const withForwarding = pipeline(chain, { forwarding: true })
    const without = pipeline(chain, { forwarding: false })

    assert.ok(
      without.cycles > withForwarding.cycles,
      `without forwarding took ${without.cycles}, with took ${withForwarding.cycles}`
    )
    assert.ok(without.stallCycles > withForwarding.stallCycles)
    // And the explanation is there, because the number alone teaches nothing.
    assert.ok(without.notes.some((one) => /forwarding would remove/.test(one)))
  })

  it('a load followed by a use of it stalls even with forwarding, and says why', () => {
    const { program, memory } = build('load-use')
    const made = pipeline(run(program, { memory }), { forwarding: true })
    const loadUse = made.hazards.filter((one) => one.kind === 'load-use')
    assert.ok(loadUse.length > 0, 'the load-use program should produce load-use stalls')
    assert.match(loadUse[0].says, /cannot send a value back in time/)
    assert.ok(made.notes.some((one) => /load-use stall/.test(one)))
  })

  it('reordering to put something between the load and its use removes the stall', () => {
    const stalling = run(ok(assemble('li r2, 0\nlw r1, 0(r2)\naddi r3, r1, 1\nli r6, 9\nhalt')), { memory: { 0: 5 } })
    const reordered = run(ok(assemble('li r2, 0\nlw r1, 0(r2)\nli r6, 9\naddi r3, r1, 1\nhalt')), { memory: { 0: 5 } })
    const before = pipeline(stalling, { forwarding: true })
    const after = pipeline(reordered, { forwarding: true })
    // The same work, the same answer, fewer cycles — purely from the order.
    assert.equal(stalling.registers[3], reordered.registers[3])
    assert.ok(after.cycles < before.cycles, `reordered took ${after.cycles}, original ${before.cycles}`)
  })

  it('a taken branch throws away the two instructions behind it', () => {
    const { program } = build('count')
    const made = pipeline(run(program))
    const control = made.hazards.filter((one) => one.kind === 'control')
    assert.ok(control.length > 0)
    assert.equal(control[0].cyclesLost, 2)
    assert.match(control[0].says, /thrown away/)
    assert.ok(made.notes.some((one) => /branch predictor/.test(one)))
  })

  it('guessing the branch right recovers what it cost', () => {
    const { program } = build('branch-heavy')
    const trace = run(program)
    const guessing = pipeline(trace, { forwarding: true, predictTaken: true })
    const notGuessing = pipeline(trace, { forwarding: true, predictTaken: false })
    assert.ok(guessing.cycles < notGuessing.cycles, `guessing took ${guessing.cycles}, not guessing ${notGuessing.cycles}`)
  })

  it('r0 is never a hazard, because nothing ever really writes it', () => {
    const made = pipeline(run(ok(assemble('li r0, 5\naddi r1, r0, 1\nhalt'))))
    assert.equal(made.hazards.length, 0, 'r0 should never cause a stall')
  })

  it('every stage of every instruction is scheduled, and in order', () => {
    const made = pipeline(run(ok(assemble('li r1, 1\naddi r2, r1, 1\nhalt'))))
    for (const slot of made.slots) {
      const { fetch, decode, execute, memory, writeback } = slot.stages
      assert.ok(fetch !== null && decode !== null && execute !== null && memory !== null && writeback !== null)
      assert.ok(
        (fetch as number) < (decode as number) &&
          (decode as number) < (execute as number) &&
          (execute as number) < (memory as number) &&
          (memory as number) < (writeback as number),
        `stages out of order for ${slot.instruction.text}`
      )
    }
  })

  it('the pipeline never changes the answer, only how long it took', () => {
    // The real safety property: scheduling is a reading of the trace and must not be able to affect the result.
    for (const which of SAMPLES) {
      const { program, memory } = build(which)
      const trace = run(program, { memory })
      const a = pipeline(trace, { forwarding: true })
      const b = pipeline(trace, { forwarding: false })
      assert.equal(a.instructions, b.instructions, which)
      assert.ok(b.cycles >= a.cycles, `${which}: no forwarding should never be faster`)
    }
  })

  it('says nothing ran when nothing ran', () => {
    const made = pipeline({ ...run(ok(assemble('halt'))), steps: [] })
    assert.equal(made.cycles, 0)
    assert.match(made.says, /Nothing ran/)
  })
})
