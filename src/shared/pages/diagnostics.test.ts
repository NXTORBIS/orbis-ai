import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DIAGNOSTIC_ASSUMPTIONS,
  FAULT_SOURCE_LABEL,
  RECURRING_AT,
  RESTARTS_ALLOWED,
  RESTART_WINDOW_MS,
  adviseFor,
  classify,
  healthOf,
  mayRestart,
  mayRunUnattended,
  noRestarts,
  recordRestart,
  type Fault,
  type FaultKind
} from './diagnostics.ts'

const fault = (kind: FaultKind, over: Partial<Fault> = {}): Fault => ({
  kind,
  detail: `something ${kind}`,
  at: 1000,
  pageId: 'page_abc',
  ...over
})

describe('working out whose fault it is', () => {
  it('blames the Page for its own script error', () => {
    assert.equal(classify({ fault: fault('script-error') }).source, 'page')
  })

  it('blames Orbis when Orbis failed, and says so', () => {
    const diagnosis = classify({ fault: fault('engine-failure') })
    assert.equal(diagnosis.source, 'orbis')
    assert.match(diagnosis.consequence, /not something you did/)
  })

  it('blames the machine when it ran out of memory or disk', () => {
    assert.equal(classify({ fault: fault('out-of-memory') }).source, 'machine')
    assert.equal(classify({ fault: fault('storage-full') }).source, 'machine')
  })

  it('blames the data when the input was wrong', () => {
    assert.equal(classify({ fault: fault('bad-input') }).source, 'data')
    assert.equal(classify({ fault: fault('storage-unreadable') }).source, 'data')
  })

  it('says it could not tell rather than guessing', () => {
    const diagnosis = classify({ fault: fault('nonsense' as FaultKind) })
    assert.equal(diagnosis.source, 'unknown')
    assert.match(diagnosis.summary, /could not work out what/)
  })

  it('has a readable label for every source', () => {
    for (const source of ['page', 'orbis', 'machine', 'data', 'unknown'] as const) {
      assert.ok(FAULT_SOURCE_LABEL[source].length > 0)
    }
  })
})

describe('telling somebody what it cost them', () => {
  it('says nothing was lost when a Page never started', () => {
    const diagnosis = classify({ fault: fault('startup-failure'), everStarted: false })
    assert.match(diagnosis.consequence, /never got as far as doing anything/)
  })

  it('says what is at risk when there is unsaved work', () => {
    const diagnosis = classify({ fault: fault('crashed'), hasUnsavedWork: true })
    assert.match(diagnosis.consequence, /not saved/)
  })

  it('says nothing was lost when everything was saved', () => {
    const diagnosis = classify({ fault: fault('crashed'), hasUnsavedWork: false })
    assert.match(diagnosis.consequence, /nothing was lost/i)
  })

  it('never reports a save that did not happen', () => {
    // The one that matters most: a full disk must not look like a successful save.
    const diagnosis = classify({ fault: fault('storage-full') })
    assert.match(diagnosis.consequence, /has NOT been saved/)
  })

  it('says a timed-out request changed nothing', () => {
    assert.match(classify({ fault: fault('timed-out') }).consequence, /Nothing was changed/)
  })
})

describe('what to do about it', () => {
  it('always states the cost alongside the action', () => {
    for (const kind of [
      'script-error',
      'startup-failure',
      'crashed',
      'unresponsive',
      'timed-out',
      'out-of-memory',
      'storage-full',
      'storage-unreadable',
      'permission-denied',
      'policy-violation',
      'bad-input',
      'engine-failure'
    ] as FaultKind[]) {
      for (const suggestion of classify({ fault: fault(kind), hasUnsavedWork: true }).suggestions) {
        assert.equal(typeof suggestion.cost, 'string', `${kind}/${suggestion.action} has no cost`)
        assert.ok(suggestion.label.length > 0, `${kind}/${suggestion.action} has no label`)
      }
    }
  })

  it('never offers an automatic recovery that would lose work', () => {
    for (const kind of ['script-error', 'crashed', 'unresponsive', 'startup-failure'] as FaultKind[]) {
      for (const suggestion of classify({ fault: fault(kind), hasUnsavedWork: true }).suggestions) {
        if (suggestion.automatic) {
          assert.equal(suggestion.cost, '', `${kind}/${suggestion.action} would run unattended and lose something`)
        }
      }
    }
  })

  it('will restart a Page unattended only when there is nothing to lose', () => {
    const nothingToLose = classify({ fault: fault('crashed'), hasUnsavedWork: false })
    const somethingToLose = classify({ fault: fault('crashed'), hasUnsavedWork: true })
    const safe = nothingToLose.suggestions.find((one) => one.action === 'restart')
    const risky = somethingToLose.suggestions.find((one) => one.action === 'restart')
    assert.equal(safe?.automatic, true)
    assert.equal(risky?.automatic, false)
    assert.notEqual(risky?.cost, '')
  })

  it('only lets a genuinely free recovery run unattended', () => {
    assert.equal(mayRunUnattended({ action: 'restart', label: 'x', cost: '', automatic: true }), true)
    assert.equal(mayRunUnattended({ action: 'restart', label: 'x', cost: 'loses work', automatic: true }), false)
    assert.equal(mayRunUnattended({ action: 'reload', label: 'x', cost: '', automatic: false }), false)
  })

  it('offers a checkpoint only when there is one', () => {
    const without = classify({ fault: fault('crashed') })
    const with_ = classify({ fault: fault('crashed'), hasCheckpoint: true })
    assert.ok(!without.suggestions.some((one) => one.action === 'restore-checkpoint'))
    assert.ok(with_.suggestions.some((one) => one.action === 'restore-checkpoint'))
  })

  it('says restoring a checkpoint loses what came after it', () => {
    const diagnosis = classify({ fault: fault('crashed'), hasCheckpoint: true })
    const restore = diagnosis.suggestions.find((one) => one.action === 'restore-checkpoint')
    assert.match(restore?.cost ?? '', /since that checkpoint is lost/)
  })

  it('offers a reset only as a last resort, and says it cannot be undone', () => {
    const diagnosis = classify({ fault: fault('storage-unreadable'), hasCheckpoint: false })
    const reset = diagnosis.suggestions.find((one) => one.action === 'reset')
    assert.ok(reset !== undefined)
    assert.match(reset.cost, /cannot be undone/)
  })

  it('does not offer a reset when a checkpoint would do', () => {
    const diagnosis = classify({ fault: fault('storage-unreadable'), hasCheckpoint: true })
    assert.ok(!diagnosis.suggestions.some((one) => one.action === 'reset'))
  })

  it('says plainly when there is nothing to be done', () => {
    const diagnosis = classify({ fault: fault('engine-failure') })
    assert.equal(diagnosis.actionable, false)
    assert.ok(adviseFor(diagnosis, fault('engine-failure')).some((one) => /nothing you can do/.test(one)))
  })

  it('does not suggest granting permission for something no Page may ever do', () => {
    const diagnosis = classify({ fault: fault('policy-violation') })
    assert.ok(!diagnosis.suggestions.some((one) => one.action === 'grant-permission'))
    assert.match(diagnosis.consequence, /not something that can be turned on/)
  })

  it('does suggest looking at permissions when one could be granted', () => {
    const diagnosis = classify({ fault: fault('permission-denied') })
    assert.ok(diagnosis.suggestions.some((one) => one.action === 'grant-permission'))
  })

  it('suggests less data when the problem is size', () => {
    assert.ok(classify({ fault: fault('timed-out') }).suggestions.some((one) => one.action === 'reduce-input'))
    assert.ok(classify({ fault: fault('out-of-memory') }).suggestions.some((one) => one.action === 'reduce-input'))
  })
})

describe('when it keeps happening', () => {
  it('stops suggesting the same thing after a few times', () => {
    const once = classify({ fault: fault('script-error', { repeats: 1 }) })
    const again = classify({ fault: fault('script-error', { repeats: RECURRING_AT }) })
    assert.equal(once.recurring, false)
    assert.equal(again.recurring, true)
    // Reloading drops down the list once it is clearly not working.
    assert.equal(once.suggestions[0].action, 'reload')
    assert.equal(again.suggestions[0].action, 'report')
  })

  it('says it is going to keep happening rather than suggesting another go', () => {
    const diagnosis = classify({ fault: fault('script-error', { repeats: 5 }) })
    assert.ok(adviseFor(diagnosis, fault('script-error', { repeats: 5 })).some((one) => /keep happening/.test(one)))
  })

  it('writes out the advice with the cost attached', () => {
    const lines = adviseFor(classify({ fault: fault('crashed'), hasUnsavedWork: true }), fault('crashed'))
    assert.ok(lines.some((one) => /—/.test(one)), 'a costed action should show its cost')
  })
})

describe('restart loops', () => {
  it('allows the first few attempts', () => {
    let record = noRestarts
    for (let i = 0; i < RESTARTS_ALLOWED; i++) {
      assert.equal(mayRestart(record, 1000 + i).allowed, true)
      record = recordRestart(record, 1000 + i)
    }
  })

  it('stops after too many in a short window, and says why', () => {
    let record = noRestarts
    for (let i = 0; i < RESTARTS_ALLOWED; i++) record = recordRestart(record, 1000 + i)
    const decision = mayRestart(record, 1100)
    assert.equal(decision.allowed, false)
    assert.match(decision.because, /would only fail again/)
    assert.ok((decision.waitMs ?? 0) > 0)
  })

  it('allows it again once the window has passed', () => {
    let record = noRestarts
    for (let i = 0; i < RESTARTS_ALLOWED; i++) record = recordRestart(record, 1000 + i)
    assert.equal(mayRestart(record, 1000 + RESTART_WINDOW_MS + 1).allowed, true)
  })

  it('says which attempt this is', () => {
    assert.match(mayRestart(noRestarts, 1000).because, /first attempt/)
    assert.match(mayRestart(recordRestart(noRestarts, 1000), 1100).because, /attempt 2/)
  })

  it('does not grow its record without bound', () => {
    let record = noRestarts
    for (let i = 0; i < 1000; i++) record = recordRestart(record, 1000 + i * 1000)
    assert.ok(record.at.length < 1000, `held ${record.at.length} entries`)
  })
})

describe('health', () => {
  const health = (over: Partial<Parameters<typeof healthOf>[0]> = {}): ReturnType<typeof healthOf> =>
    healthOf({ pageId: 'page_abc', running: true, faults: [], load: 0.1, saved: true, now: 10_000, ...over })

  it('says a quiet Page is working normally', () => {
    const report = health()
    assert.equal(report.state, 'well')
    assert.equal(report.headline, 'Working normally.')
  })

  it('says a Page that is not running is not running', () => {
    assert.equal(health({ running: false }).state, 'unwell')
  })

  it('calls a Page with one recent problem strained rather than unwell', () => {
    assert.equal(health({ faults: [fault('script-error', { at: 9000 })] }).state, 'strained')
  })

  it('calls a Page with several recent problems unwell', () => {
    const faults = Array.from({ length: RECURRING_AT }, (_, i) => fault('script-error', { at: 9000 + i }))
    assert.equal(health({ faults }).state, 'unwell')
  })

  it('notices a Page working near its budget', () => {
    const report = health({ load: 0.9 })
    assert.equal(report.state, 'strained')
    assert.ok(report.details.some((one) => /of the requests it is allowed/.test(one)))
  })

  it('always mentions unsaved changes', () => {
    assert.ok(health({ saved: false }).details.includes('There are unsaved changes.'))
  })

  it('groups identical problems instead of listing them all', () => {
    const faults = Array.from({ length: 200 }, () => fault('script-error', { at: 9000, detail: 'the same thing' }))
    const report = health({ faults })
    assert.equal(report.recent.length, 1)
    assert.equal(report.recent[0].count, 200)
    assert.ok(report.details.some((one) => /200 times/.test(one)))
  })

  it('does not let one loud problem bury a different one', () => {
    const faults = [
      ...Array.from({ length: 100 }, () => fault('script-error', { at: 9000, detail: 'noisy' })),
      fault('storage-full', { at: 9500, detail: 'the disk is full' })
    ]
    const report = health({ faults })
    assert.ok(report.recent.some((one) => one.kind === 'storage-full'), 'the quieter, more serious one must survive')
  })

  it('caps how much it lists, and says how much it left out', () => {
    const faults = [
      fault('script-error', { at: 9000 }),
      fault('storage-full', { at: 9001 }),
      fault('timed-out', { at: 9002 }),
      fault('bad-input', { at: 9003 }),
      fault('crashed', { at: 9004 })
    ]
    const report = health({ faults })
    assert.ok(report.details.some((one) => /other kinds of problem/.test(one)))
  })

  it('ignores problems from long ago', () => {
    assert.equal(health({ faults: [fault('crashed', { at: 0 })], now: 10 * 60_000 }).state, 'well')
  })

  it('keeps the most recent detail for a repeated problem', () => {
    const faults = [
      fault('script-error', { at: 9000, detail: 'older' }),
      fault('script-error', { at: 9500, detail: 'newer' })
    ]
    assert.equal(health({ faults }).recent[0].latest, 'newer')
  })
})

describe('assumptions', () => {
  it('says every problem names whose it is', () => {
    assert.ok(DIAGNOSTIC_ASSUMPTIONS.some((one) => /whose it is/.test(one)))
  })

  it('says a recovery states its cost first', () => {
    assert.ok(DIAGNOSTIC_ASSUMPTIONS.some((one) => /says what it costs before you choose it/.test(one)))
  })

  it('says a failed save is never reported as a save', () => {
    assert.ok(DIAGNOSTIC_ASSUMPTIONS.some((one) => /never reports a save that did not happen/.test(one)))
  })
})
