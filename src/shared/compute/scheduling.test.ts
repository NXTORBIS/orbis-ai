import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  bankersCheck,
  beladyCheck,
  comparePolicies,
  findDeadlock,
  isSchedulingError,
  paging,
  POLICIES,
  PAGE_REPLACEMENTS,
  race,
  schedule,
  type Process,
  type SchedulingError
} from './scheduling.ts'

/**
 * What the operating-system engine is held to.
 *
 * The schedules here have answers that can be worked out by hand, so a wrong policy fails rather than producing
 * something plausible. Three properties matter most, because each is a thing the subject is actually about:
 * shortest-job-first must give the smallest possible average wait, the optimal page policy must never be beaten, and
 * the Banker's algorithm must call a state safe only when it really found a complete sequence.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, SchedulingError> => {
  assert.ok(!isSchedulingError(value), isSchedulingError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, SchedulingError>
}

/** The textbook set: all arrive at once, so the policy is the only thing that differs. */
const TOGETHER: readonly Process[] = Object.freeze([
  { id: 'A', arrives: 0, needs: 6, priority: 2 },
  { id: 'B', arrives: 0, needs: 8, priority: 1 },
  { id: 'C', arrives: 0, needs: 7, priority: 3 },
  { id: 'D', arrives: 0, needs: 3, priority: 4 }
])

describe('scheduling', () => {
  it('first come, first served runs them in arrival order', () => {
    const made = ok(schedule(TOGETHER, 'first-come'))
    const order = made.processes.filter((one) => one.finished !== null).sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0)).map((one) => one.id)
    assert.deepEqual(order, ['A', 'B', 'C', 'D'])
    // Worked out by hand: waits of 0, 6, 14, 21, so 41/4.
    assert.equal(made.averageWaiting, 41 / 4)
  })

  it('shortest job first gives the smallest average wait of any order', () => {
    const made = ok(schedule(TOGETHER, 'shortest-job'))
    // D(3), A(6), C(7), B(8): waits 0, 3, 9, 16 → 28/4 = 7.
    assert.equal(made.averageWaiting, 7)

    /*
     * The real property, not a recorded number: no ordering of these processes can do better. Checked by trying every
     * one of them, which is the only way to make the claim honestly.
     */
    const permutations = (items: readonly Process[]): Process[][] =>
      items.length <= 1 ? [[...items]] : items.flatMap((one, at) => permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [one, ...rest]))
    let best = Infinity
    for (const order of permutations(TOGETHER)) {
      let clock = 0
      let waited = 0
      for (const one of order) {
        waited += clock
        clock += one.needs
      }
      best = Math.min(best, waited / order.length)
    }
    assert.equal(made.averageWaiting, best, 'shortest-job-first must achieve the best possible average wait')
  })

  it('round robin gives everybody the processor sooner, at the cost of finishing later', () => {
    const slow = ok(schedule(TOGETHER, 'first-come'))
    const fair = ok(schedule(TOGETHER, 'round-robin', { quantum: 2 }))
    assert.ok(fair.averageResponse < slow.averageResponse, `round robin response ${fair.averageResponse} should beat ${slow.averageResponse}`)
    assert.ok(fair.contextSwitches > slow.contextSwitches)
  })

  it('a bigger quantum makes round robin behave more like first come', () => {
    const small = ok(schedule(TOGETHER, 'round-robin', { quantum: 1 }))
    const large = ok(schedule(TOGETHER, 'round-robin', { quantum: 100 }))
    const firstCome = ok(schedule(TOGETHER, 'first-come'))
    assert.equal(large.averageWaiting, firstCome.averageWaiting, 'a quantum longer than every burst is first-come')
    assert.ok(small.contextSwitches > large.contextSwitches)
  })

  it('every process gets exactly the processor time it needed, whatever the policy', () => {
    // The property that catches a scheduler losing or double-counting a tick.
    for (const policy of POLICIES) {
      const made = ok(schedule(TOGETHER, policy, { quantum: 3 }))
      const given = new Map<string, number>()
      for (const slice of made.slices) {
        if (slice.process === null) continue
        given.set(slice.process, (given.get(slice.process) ?? 0) + (slice.to - slice.from))
      }
      for (const one of TOGETHER) {
        assert.equal(given.get(one.id) ?? 0, one.needs, `${policy}: ${one.id} got the wrong amount of time`)
      }
    }
  })

  it('shortest remaining time takes the processor away when something shorter arrives', () => {
    const staggered: Process[] = [
      { id: 'long', arrives: 0, needs: 8 },
      { id: 'short', arrives: 1, needs: 2 }
    ]
    const made = ok(schedule(staggered, 'shortest-remaining'))
    const shortOne = made.processes.find((one) => one.id === 'short')
    // The short one arrives at 1 and should run immediately rather than waiting eight ticks.
    assert.equal(shortOne?.response, 0)
    assert.equal(made.processes.find((one) => one.id === 'long')?.preempted, 1)
  })

  it('priority runs the urgent one first and reports that it can starve the rest', () => {
    const made = ok(schedule(TOGETHER, 'priority'))
    const first = made.processes.filter((one) => one.finished !== null).sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0))[0]
    assert.equal(first.id, 'B', 'B has priority 1, the most urgent')
    assert.ok(made.notes.some((one) => /starv/i.test(one)), 'the policy must say that it can starve a process')
  })

  it('strict priority really does starve a low-priority process, and says so', () => {
    // Urgent work keeps arriving, so the one unimportant process never gets a turn until the end.
    const processes: Process[] = [{ id: 'background', arrives: 0, needs: 5, priority: 9 }]
    for (let i = 0; i < 8; i += 1) processes.push({ id: `urgent${i}`, arrives: i * 2, needs: 3, priority: 1 })
    const made = ok(schedule(processes, 'priority-preemptive'))
    const background = made.processes.find((one) => one.id === 'background')
    assert.ok((background?.waiting ?? 0) > 15, `the background job only waited ${background?.waiting}`)
    assert.ok(made.starved.includes('background'))
  })

  it('a multilevel queue drops a long process down and keeps short work responsive', () => {
    const mixed: Process[] = [
      { id: 'hog', arrives: 0, needs: 20 },
      { id: 'quick1', arrives: 3, needs: 2 },
      { id: 'quick2', arrives: 5, needs: 2 }
    ]
    const multilevel = ok(schedule(mixed, 'multilevel', { quantum: 2 }))
    const firstCome = ok(schedule(mixed, 'first-come'))
    const quickResponse = (made: typeof multilevel): number =>
      (made.processes.find((one) => one.id === 'quick1')?.response ?? 0)
    assert.ok(
      quickResponse(multilevel) < quickResponse(firstCome),
      `multilevel got to quick1 after ${quickResponse(multilevel)}, first-come after ${quickResponse(firstCome)}`
    )
    // The long one really did get pushed down a level.
    assert.ok((multilevel.processes.find((one) => one.id === 'hog')?.preempted ?? 0) > 0)
  })

  it('the processor is shown as idle when nothing has arrived', () => {
    const made = ok(schedule([{ id: 'late', arrives: 5, needs: 2 }], 'first-come'))
    assert.equal(made.idleTicks, 5)
    assert.ok(made.slices.some((one) => one.process === null))
    assert.ok(made.notes.some((one) => /idle/.test(one)))
  })

  it('refuses nonsense rather than scheduling it', () => {
    assert.ok(isSchedulingError(schedule([], 'first-come')))
    assert.ok(isSchedulingError(schedule([{ id: 'x', arrives: 0, needs: 0 }], 'first-come')))
    assert.ok(isSchedulingError(schedule([{ id: 'x', arrives: -1, needs: 2 }], 'first-come')))
    assert.ok(isSchedulingError(schedule([{ id: 'x', arrives: 0, needs: 2 }, { id: 'x', arrives: 0, needs: 2 }], 'first-come')))
    assert.ok(isSchedulingError(schedule(TOGETHER, 'nonsense' as never)))
  })

  it('every policy in the list actually runs', () => {
    for (const policy of POLICIES) {
      const made = schedule(TOGETHER, policy, { quantum: 3 })
      assert.ok(!isSchedulingError(made), `${policy}: ${isSchedulingError(made) ? made.says : ''}`)
    }
  })

  it('comparing policies ranks them on identical work', () => {
    const made = ok(comparePolicies(TOGETHER, ['first-come', 'shortest-job', 'round-robin'], { quantum: 2 }))
    assert.equal(made.sides.length, 3)
    assert.equal(made.bestWaiting, 'shortest-job', 'shortest-job-first is optimal for average wait, by definition')
    assert.ok(made.says.length > 20)
  })

  it('refuses to compare fewer than two', () => {
    assert.ok(isSchedulingError(comparePolicies(TOGETHER, ['first-come'])))
  })
})

describe('paging', () => {
  // The standard sequence from every textbook, so the fault counts can be checked by hand.
  const REFERENCES = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]

  it('FIFO on the standard sequence gives the known answer', () => {
    assert.equal(ok(paging(REFERENCES, 3, 'fifo')).faults, 15)
  })

  it('least-recently-used does better than FIFO on it', () => {
    const lru = ok(paging(REFERENCES, 3, 'lru'))
    const fifo = ok(paging(REFERENCES, 3, 'fifo'))
    assert.equal(lru.faults, 12)
    assert.ok(lru.faults < fifo.faults)
  })

  it('the optimal policy gives the known answer, and nothing beats it', () => {
    const best = ok(paging(REFERENCES, 3, 'optimal'))
    assert.equal(best.faults, 9)
    for (const policy of PAGE_REPLACEMENTS) {
      const made = ok(paging(REFERENCES, 3, policy))
      assert.ok(made.faults >= best.faults, `${policy} had ${made.faults} faults, fewer than the optimal ${best.faults}`)
    }
  })

  it('a policy says how far it fell short of the best possible', () => {
    const made = ok(paging(REFERENCES, 3, 'fifo'))
    assert.ok(made.notes.some((one) => /optimal policy/.test(one) && /9 faults/.test(one)))
  })

  it('every policy in the list runs, and the frames always hold what was last asked for', () => {
    for (const policy of PAGE_REPLACEMENTS) {
      const made = ok(paging(REFERENCES, 3, policy))
      assert.equal(made.steps.length, REFERENCES.length, policy)
      for (let at = 0; at < made.steps.length; at += 1) {
        assert.ok(made.steps[at].frames.includes(REFERENCES[at]), `${policy}: page ${REFERENCES[at]} not in memory after being referenced`)
      }
      // Frames never hold the same page twice, which would be a bug that inflates the hit rate.
      for (const step of made.steps) {
        const held = step.frames.filter((one) => one !== null)
        assert.equal(new Set(held).size, held.length, `${policy}: a page appears in two frames at once`)
      }
    }
  })

  it('more frames never makes a stack algorithm worse', () => {
    for (const policy of ['lru', 'optimal'] as const) {
      let previous = Infinity
      for (let frames = 1; frames <= 6; frames += 1) {
        const made = ok(paging(REFERENCES, frames, policy))
        assert.ok(made.faults <= previous, `${policy} got worse going to ${frames} frames`)
        previous = made.faults
      }
    }
  })

  it("Belady's anomaly is found on the sequence that has it", () => {
    // The classic demonstration: FIFO does worse with four frames than with three.
    const made = ok(beladyCheck([1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5], 'fifo', 5))
    assert.ok(made.anomalyAt.length > 0, 'FIFO should get worse on this sequence')
    assert.match(made.says, /Belady/)
  })

  it('and is honestly reported as absent when the sequence does not have it', () => {
    const made = ok(beladyCheck(REFERENCES, 'lru', 6))
    assert.equal(made.anomalyAt.length, 0)
    assert.match(made.says, /stack algorithm/)
  })

  it('says plainly when there was enough memory for every fault to be unavoidable', () => {
    const made = ok(paging([1, 2, 3, 1, 2, 3], 5, 'lru'))
    assert.equal(made.faults, 3)
    assert.ok(made.notes.some((one) => /unavoidable/.test(one)))
  })

  it('refuses nonsense', () => {
    assert.ok(isSchedulingError(paging([], 3, 'lru')))
    assert.ok(isSchedulingError(paging([1, 2], 0, 'lru')))
    assert.ok(isSchedulingError(paging([1, 2], 3, 'nonsense' as never)))
  })
})

describe('deadlock', () => {
  it('finds a circular wait between two processes', () => {
    const made = findDeadlock([
      { process: 'P1', resource: 'A', holding: true },
      { process: 'P1', resource: 'B', holding: false },
      { process: 'P2', resource: 'B', holding: true },
      { process: 'P2', resource: 'A', holding: false }
    ])
    assert.equal(made.deadlocked, true)
    assert.ok(made.involved.includes('P1') && made.involved.includes('P2'))
    // And it says what to do about it, which is the useful part.
    assert.ok(made.notes.some((one) => /four things/.test(one)))
  })

  it('says nothing is deadlocked when nothing is', () => {
    const made = findDeadlock([
      { process: 'P1', resource: 'A', holding: true },
      { process: 'P2', resource: 'B', holding: true },
      { process: 'P2', resource: 'C', holding: false }
    ])
    assert.equal(made.deadlocked, false)
    assert.equal(made.cycle.length, 0)
    // And is honest that this is about now, not about later.
    assert.ok(made.notes.some((one) => /later/.test(one)))
  })

  it('a cycle on a resource with several instances is reported as possible, not certain', () => {
    const made = findDeadlock(
      [
        { process: 'P1', resource: 'A', holding: true },
        { process: 'P1', resource: 'B', holding: false },
        { process: 'P2', resource: 'B', holding: true },
        { process: 'P2', resource: 'A', holding: false }
      ],
      { A: 2 }
    )
    assert.equal(made.deadlocked, false, 'with two instances a cycle is not proof')
    assert.match(made.says, /may not be a deadlock/)
    assert.ok(made.notes.some((one) => /Banker/.test(one)))
  })

  it('finds a longer cycle through three processes', () => {
    const made = findDeadlock([
      { process: 'P1', resource: 'A', holding: true },
      { process: 'P1', resource: 'B', holding: false },
      { process: 'P2', resource: 'B', holding: true },
      { process: 'P2', resource: 'C', holding: false },
      { process: 'P3', resource: 'C', holding: true },
      { process: 'P3', resource: 'A', holding: false }
    ])
    assert.equal(made.deadlocked, true)
    assert.equal(made.involved.length, 3)
  })
})

describe("the Banker's algorithm", () => {
  // The example from the textbook, whose answer is known.
  const STATE = {
    processes: ['P0', 'P1', 'P2', 'P3', 'P4'],
    resources: ['A', 'B', 'C'],
    total: [10, 5, 7],
    allocated: [
      [0, 1, 0],
      [2, 0, 0],
      [3, 0, 2],
      [2, 1, 1],
      [0, 0, 2]
    ],
    maximum: [
      [7, 5, 3],
      [3, 2, 2],
      [9, 0, 2],
      [2, 2, 2],
      [4, 3, 3]
    ]
  }

  it('calls the textbook state safe and gives a sequence that really works', () => {
    const made = ok(bankersCheck(STATE))
    assert.equal(made.safe, true)
    assert.equal(made.sequence.length, 5)
    assert.deepEqual([...made.available], [3, 3, 2])

    /*
     * The sequence is checked rather than taken on trust: walking it must leave every process able to finish. A
     * safety claim with an unverifiable sequence would be worthless.
     */
    const free = [...made.available]
    for (const name of made.sequence) {
      const at = STATE.processes.indexOf(name)
      const need = STATE.maximum[at].map((most, j) => most - STATE.allocated[at][j])
      assert.ok(need.every((want, j) => want <= free[j]), `${name} could not actually finish in the order given`)
      for (let j = 0; j < free.length; j += 1) free[j] += STATE.allocated[at][j]
    }
  })

  it('works out what each process may still ask for', () => {
    const made = ok(bankersCheck(STATE))
    assert.deepEqual([...made.need[0]], [7, 4, 3])
    assert.deepEqual([...made.need[2]], [6, 0, 0])
  })

  it('calls a state unsafe when it is, and names who is stuck', () => {
    // Everything held, nothing free, and more still needed.
    const made = ok(
      bankersCheck({
        processes: ['P0', 'P1'],
        resources: ['A'],
        total: [2],
        allocated: [[1], [1]],
        maximum: [[2], [2]]
      })
    )
    assert.equal(made.safe, false)
    assert.equal(made.stuckWith.length, 2)
    assert.ok(made.notes.some((one) => /deadlock has happened/.test(one)))
  })

  it('refuses a process holding more than it says it will ever need', () => {
    const made = bankersCheck({
      processes: ['P0'],
      resources: ['A'],
      total: [5],
      allocated: [[3]],
      maximum: [[2]]
    })
    assert.ok(isSchedulingError(made))
    assert.match(made.says, /never need more than/)
  })

  it('refuses a table where more is held than exists', () => {
    const made = bankersCheck({
      processes: ['P0', 'P1'],
      resources: ['A'],
      total: [1],
      allocated: [[1], [1]],
      maximum: [[1], [1]]
    })
    assert.ok(isSchedulingError(made))
    assert.match(made.says, /than exists/)
  })

  it('refuses a table of the wrong shape', () => {
    assert.ok(
      isSchedulingError(
        bankersCheck({ processes: ['P0', 'P1'], resources: ['A'], total: [2], allocated: [[1]], maximum: [[1], [1]] })
      )
    )
  })

  it('says plainly that it needs declared maximums, which is why nothing uses it', () => {
    const made = ok(bankersCheck(STATE))
    assert.ok(made.notes.some((one) => /declare its maximum/.test(one)))
  })
})

describe('races and locks', () => {
  it('without a lock, increments are lost', () => {
    const made = ok(race(10, { locked: false, processes: 2 }))
    assert.equal(made.shouldBe, 20)
    assert.ok(made.counter < made.shouldBe, `the counter came to ${made.counter}, which should be less than ${made.shouldBe}`)
    assert.equal(made.raced, true)
    assert.match(made.says, /lost/)
    assert.ok(made.notes.some((one) => /three steps/.test(one)))
  })

  it('with a lock, nothing is lost', () => {
    const made = ok(race(10, { locked: true, processes: 2 }))
    assert.equal(made.counter, made.shouldBe)
    assert.equal(made.raced, false)
    assert.ok(made.notes.some((one) => /wait/.test(one)))
  })

  it('more processes racing loses more', () => {
    const two = ok(race(10, { locked: false, processes: 2 }))
    const eight = ok(race(10, { locked: false, processes: 8 }))
    assert.ok(eight.shouldBe - eight.counter > two.shouldBe - two.counter)
  })

  it('a lock holds however many processes there are', () => {
    for (const processes of [2, 4, 8]) {
      const made = ok(race(5, { locked: true, processes }))
      assert.equal(made.counter, made.shouldBe, `${processes} processes lost an increment despite the lock`)
    }
  })

  it('shows the interleaving, so the loss can be followed', () => {
    const made = ok(race(2, { locked: false, processes: 2 }))
    assert.ok(made.interleaving.length > 0)
    assert.ok(made.interleaving.some((one) => /reads/.test(one)))
    assert.ok(made.interleaving.some((one) => /writes/.test(one)))
  })

  it('refuses an unreasonable number of rounds', () => {
    assert.ok(isSchedulingError(race(0)))
    assert.ok(isSchedulingError(race(99_999)))
  })
})
