import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanTrigger,
  considerTrigger,
  describeTrigger,
  MIN_TRIGGER_COOLDOWN,
  type MarketTrigger
} from './triggers.ts'

const ID = 'binance:crypto:binance:btcusdt'

const trigger = (patch: Partial<MarketTrigger> = {}): MarketTrigger => ({
  id: 't1',
  workflowId: 'w1',
  kind: 'market',
  instrumentId: ID,
  subject: { kind: 'price' },
  comparison: 'above',
  value: 100,
  enabled: true,
  cooldownMs: 0,
  dailyLimit: 0,
  createdAt: 0,
  ...patch
})

// ---------------------------------------------------------------- the edge, not the state

test('a condition that becomes true fires once, not every time it is looked at', () => {
  // The rule the whole file exists for. A workflow running on every evaluation would write a journal entry a second.
  let held = trigger()
  const first = considerTrigger(held, { value: 101 }, 1000)
  assert.equal(first.fired, true)

  held = first.next
  for (const at of [2000, 3000, 4000]) {
    const again = considerTrigger(held, { value: 105 }, at)
    assert.equal(again.fired, false, `fired again at ${at}`)
    assert.match(again.reason, /already true/)
    held = again.next
  }
})

test('it fires again once the condition has gone false and come back', () => {
  let held = considerTrigger(trigger(), { value: 101 }, 1000).next
  held = considerTrigger(held, { value: 99 }, 2000).next
  assert.equal(considerTrigger(held, { value: 101 }, 3000).fired, true)
})

test('a condition that was never true does not fire', () => {
  assert.equal(considerTrigger(trigger(), { value: 99 }, 1000).fired, false)
})

test('a value that cannot be measured leaves the memory exactly as it was', () => {
  // So that data coming back after a gap does not read as a fresh crossing.
  const held = trigger({ wasTrue: true })
  const outcome = considerTrigger(held, { value: null }, 1000)
  assert.equal(outcome.fired, false)
  assert.equal(outcome.next.wasTrue, true)
  assert.equal(outcome.next, held)
})

// ---------------------------------------------------------------- rate limits

test('a cooldown keeps a workflow from running again too soon', () => {
  const held = trigger({ cooldownMs: 60_000 })
  const first = considerTrigger(held, { value: 101 }, 1000)
  assert.equal(first.fired, true)
  // False, then true again inside the cooldown.
  const down = considerTrigger(first.next, { value: 99 }, 2000)
  const second = considerTrigger(down.next, { value: 101 }, 3000)
  assert.equal(second.fired, false)
  assert.match(second.reason, /ran recently/)
  // And after it, it runs.
  const later = considerTrigger(second.next, { value: 99 }, 70_000)
  assert.equal(considerTrigger(later.next, { value: 101 }, 80_000).fired, true)
})

test('a daily cap is a cap', () => {
  let held: MarketTrigger = trigger({ dailyLimit: 2 })
  let fired = 0
  for (let i = 0; i < 10; i++) {
    const up = considerTrigger(held, { value: 101 }, 1000 + i * 2000)
    if (up.fired) fired += 1
    held = considerTrigger(up.next, { value: 99 }, 2000 + i * 2000).next
  }
  assert.equal(fired, 2)
})

test('a switched-off trigger never fires but still remembers where things were', () => {
  const outcome = considerTrigger(trigger({ enabled: false }), { value: 101 }, 1000)
  assert.equal(outcome.fired, false)
  assert.equal(outcome.next.wasTrue, true)
})

// ---------------------------------------------------------------- the other kinds

test('an alert trigger fires when its alert does', () => {
  const held = trigger({ kind: 'alert', alertId: 'a1' })
  assert.equal(considerTrigger(held, { alertFired: true }, 1000).fired, true)
  assert.equal(considerTrigger(held, { alertFired: false }, 1000).fired, false)
})

test('a screen trigger fires when the screen returns enough markets', () => {
  const held = trigger({ kind: 'screen', minimumResults: 3 })
  assert.equal(considerTrigger(held, { results: 2 }, 1000).fired, false)
  assert.equal(considerTrigger(held, { results: 3 }, 1000).fired, true)
})

test('a connection trigger fires on the state it was set for', () => {
  const held = trigger({ kind: 'connection', connection: 'disconnected' })
  assert.equal(considerTrigger(held, { connection: 'connected' }, 1000).fired, false)
  assert.equal(considerTrigger(held, { connection: 'disconnected' }, 1000).fired, true)
})

test('every comparison a market trigger offers is judged', () => {
  const at = 1000
  const of = (comparison: MarketTrigger['comparison'], value: number, threshold = 100, high?: number): boolean =>
    considerTrigger(trigger({ comparison, value: threshold, value2: high }), { value }, at).fired
  assert.equal(of('above', 101), true)
  assert.equal(of('below', 99), true)
  assert.equal(of('at-or-above', 100), true)
  assert.equal(of('at-or-below', 100), true)
  assert.equal(of('equals', 100), true)
  assert.equal(of('enters-range', 105, 100, 110), true)
  assert.equal(of('leaves-range', 120, 100, 110), true)
  assert.equal(of('changes-by', -12, 10), true)
})

// ---------------------------------------------------------------- reading one back

test('a trigger that could never fire is refused rather than kept as a dead control', () => {
  // Including one with nothing to start: a trigger with no workflow is the emptiest control there is.
  assert.equal(cleanTrigger({ id: 'a', kind: 'alert', alertId: 'x' }), null)
  assert.equal(cleanTrigger({ id: 'a', workflowId: 'w', kind: 'market' }), null)
  assert.equal(cleanTrigger({ id: 'a', workflowId: 'w', kind: 'market', instrumentId: ID, comparison: 'above' }), null)
  assert.equal(cleanTrigger({ id: 'a', workflowId: 'w', kind: 'alert' }), null)
  assert.equal(cleanTrigger({ id: 'a', workflowId: 'w', kind: 'connection', connection: 'sideways' }), null)
  assert.equal(cleanTrigger({ kind: 'market', workflowId: 'w' }), null)
  assert.equal(cleanTrigger({ id: 'a', workflowId: 'w', kind: 'teleport' }), null)
})

test('a cooldown shorter than a minute is floored, because a workflow is work', () => {
  const cleaned = cleanTrigger({ id: 'a', workflowId: 'w', kind: 'alert', alertId: 'x', cooldownMs: 5000 })
  assert.equal(cleaned?.cooldownMs, MIN_TRIGGER_COOLDOWN)
  assert.equal(cleanTrigger({ id: 'a', workflowId: 'w', kind: 'alert', alertId: 'x', cooldownMs: 999 * 3_600_000 })?.cooldownMs, 24 * 3_600_000)
})

test('a trigger comes back from a file able to fire on what it finds', () => {
  // Deliberately not `wasTrue: true`: reopening Orbis to find the market has moved should run the workflow.
  const cleaned = cleanTrigger({ id: 'a', workflowId: 'w', kind: 'market', instrumentId: ID, comparison: 'above', value: 100 })
  assert.equal(cleaned?.wasTrue, false)
  assert.equal(considerTrigger(cleaned!, { value: 101 }, 1000).fired, true)
})

test('a subject a trigger cannot be given a value for falls back to price', () => {
  const cleaned = cleanTrigger({
    id: 'a',
    workflowId: 'w',
    kind: 'market',
    instrumentId: ID,
    comparison: 'above',
    value: 1,
    subject: { kind: 'indicator', indicator: 'rsi', interval: '1h' }
  })
  assert.equal(cleaned?.subject?.kind, 'price')
  // The ones it can are kept.
  assert.equal(
    cleanTrigger({ id: 'a', workflowId: 'w', kind: 'market', instrumentId: ID, comparison: 'above', value: 1, subject: { kind: 'funding' } })
      ?.subject?.kind,
    'funding'
  )
})

test('every kind can be described in a sentence', () => {
  for (const kind of ['market', 'alert', 'screen', 'connection'] as const) {
    const text = describeTrigger(trigger({ kind, connection: 'disconnected', alertId: 'a' }), 'BTCUSDT')
    assert.ok(text.length > 10, kind)
  }
})

test('a description reads as English rather than as field names', () => {
  // This string is shown as-is in the trigger list, so it has to be a sentence somebody can read. Earlier it produced
  // "price is crosses-above 100000", which is the field values with spaces between them.
  const text = describeTrigger(
    trigger({ kind: 'market', subject: { kind: 'price' }, comparison: 'crosses-above', value: 100_000 }),
    'BTCUSDT'
  )
  assert.equal(text, 'When BTCUSDT price crosses above 100000')
  assert.ok(!text.includes('crosses-above'), 'a raw field value leaked into the sentence')
})

test('every subject and comparison has words of its own', () => {
  const subjects = ['price', 'change-percent', 'volume', 'spread', 'funding', 'open-interest', 'availability'] as const
  const comparisons = ['above', 'below', 'at-or-above', 'at-or-below', 'crosses-above', 'crosses-below', 'changes-by'] as const
  for (const kind of subjects) {
    for (const comparison of comparisons) {
      const text = describeTrigger(trigger({ kind: 'market', subject: { kind }, comparison, value: 1 }), 'BTC')
      // A hyphenated id in the output means the lookup missed and the raw value was used.
      assert.ok(!/[a-z]+-[a-z]+/.test(text.replace('24h', '')), `${kind}/${comparison}: ${text}`)
    }
  }
})

test('an unknown subject falls back rather than reaching the prototype', () => {
  const text = describeTrigger(
    trigger({ kind: 'market', subject: { kind: 'constructor' } as never, comparison: 'above', value: 1 }),
    'BTC'
  )
  assert.ok(!text.includes('function'), text)
  assert.ok(text.startsWith('When BTC '), text)
})
