import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fillIn, judge, MAX_AT_ONCE, ready, runnable, settleConditions, stuck, valueAt } from './orbTask.ts'
import type { OrbCondition, OrbStep } from './orbTask.ts'
import type { CapabilityDescriptor } from './browserControl.ts'

const step = (over: Partial<OrbStep> & { id: string }): OrbStep => ({
  name: over.id,
  capability: 'page.read',
  params: {},
  needs: [],
  status: 'planned',
  tries: 0,
  ...over
})

const caps = (ids: Record<string, boolean>): CapabilityDescriptor[] =>
  Object.entries(ids).map(([id, mutates]) => ({
    id,
    domain: 'page',
    name: id,
    description: id,
    params: {},
    mutates,
    confirmation: 'none',
    requires: [],
    provider: 'main',
    available: true
  })) as CapabilityDescriptor[]

// ---------------------------------------------------------------- reading a value out of what was saved

test('a dotted path reaches into a saved result, and a missing one is undefined not a throw', () => {
  const saved = { page: { title: 'Pricing', tags: ['a', 'b'] }, tabs: [{ url: 'https://x' }], count: 0 }
  assert.equal(valueAt(saved, 'page.title'), 'Pricing')
  assert.equal(valueAt(saved, 'tabs.0.url'), 'https://x')
  assert.equal(valueAt(saved, 'page.tags.1'), 'b')
  assert.equal(valueAt(saved, 'count'), 0)
  assert.equal(valueAt(saved, 'page.nothing.deeper'), undefined)
  assert.equal(valueAt(saved, 'tabs.9.url'), undefined)
})

// ---------------------------------------------------------------- the three answers

test('a condition about something nothing has saved cannot be answered', () => {
  // Not false. Read as false it would silently skip the branch that was supposed to happen.
  assert.equal(judge({ of: 'download', is: 'present' }, {}), 'unknown')
  assert.equal(judge({ of: 'download.state', equals: 'complete' }, {}), 'unknown')
})

test('no condition at all is true', () => {
  assert.equal(judge(undefined, {}), true)
})

test('each comparison answers what it says', () => {
  const v = { state: 'ended', tabs: [1, 2, 3], title: 'Rotational motion', off: false, count: 7 }
  const yes = (c: OrbCondition): void => assert.equal(judge(c, v), true, JSON.stringify(c))
  const no = (c: OrbCondition): void => assert.equal(judge(c, v), false, JSON.stringify(c))

  yes({ of: 'state', equals: 'ended' })
  no({ of: 'state', equals: 'playing' })
  yes({ of: 'title', contains: 'rotational' })
  no({ of: 'title', contains: 'thermodynamics' })
  yes({ of: 'tabs', contains: '2' })
  yes({ of: 'tabs', atLeast: 3 })
  no({ of: 'tabs', atLeast: 4 })
  yes({ of: 'count', atMost: 7 })
  yes({ of: 'state', is: 'present' })
  yes({ of: 'off', is: 'false' })
  no({ of: 'off', is: 'true' })
  // The browser answering 7 and a plan writing "7" mean the same number.
  yes({ of: 'count', equals: '7' })
})

test('not flips the answer, which is how "otherwise" is said', () => {
  const v = { state: 'playing' }
  assert.equal(judge({ of: 'state', equals: 'ended' }, v), false)
  assert.equal(judge({ of: 'state', equals: 'ended', not: true }, v), true)
})

test('a number asked of something that is not one cannot be answered', () => {
  assert.equal(judge({ of: 'state', atLeast: 2 }, { state: { a: 1 } }), 'unknown')
})

// ---------------------------------------------------------------- if, else, and the cascade

test('a false condition becomes a visible skip', () => {
  const steps = [
    step({ id: 'look', saveAs: 'state' }),
    step({ id: 'join', when: { of: 'state', equals: 'started' } }),
    step({ id: 'wait', when: { of: 'state', equals: 'started', not: true } })
  ]
  const out = settleConditions(steps, { state: 'not started' })
  assert.equal(out.find((s) => s.id === 'join')?.status, 'skipped')
  assert.equal(out.find((s) => s.id === 'wait')?.status, 'planned')
})

test('a step that reads a skipped step’s result is skipped with it', () => {
  const steps = [
    step({ id: 'look', saveAs: 'duplicate' }),
    step({ id: 'close', saveAs: 'closed', when: { of: 'duplicate', is: 'true' } }),
    step({ id: 'report', params: { text: 'Closed {{closed}}' } })
  ]
  const out = settleConditions(steps, { duplicate: false })
  assert.equal(out.find((s) => s.id === 'close')?.status, 'skipped')
  assert.equal(out.find((s) => s.id === 'report')?.status, 'skipped', 'it would have reported on nothing')
})

test('a step that merely comes after an untaken branch still runs', () => {
  const steps = [
    step({ id: 'look', saveAs: 'duplicate', status: 'done' }),
    step({ id: 'close', when: { of: 'duplicate', is: 'true' } }),
    step({ id: 'tell', needs: ['close'] })
  ]
  const out = settleConditions(steps, { duplicate: false })
  assert.equal(out.find((s) => s.id === 'close')?.status, 'skipped')
  assert.equal(out.find((s) => s.id === 'tell')?.status, 'planned')
  // And a skipped need counts as settled, so the telling can actually happen.
  assert.equal(ready(out.find((s) => s.id === 'tell')!, out, { duplicate: false }), true)
})

test('a condition whose answer is never coming is false, not a hang', () => {
  /*
   * The case that would otherwise freeze a run: the step that was going to save the answer was itself skipped, so
   * "unanswered" is permanent. Left unanswered the task waits for ever and reads as frozen.
   */
  const steps = [
    step({ id: 'find', saveAs: 'pdf', when: { of: 'downloads', is: 'present' } }),
    step({ id: 'open', when: { of: 'pdf', is: 'present' } })
  ]
  const out = settleConditions(steps, { downloads: [] })
  assert.equal(out.find((s) => s.id === 'find')?.status, 'skipped')
  assert.equal(out.find((s) => s.id === 'open')?.status, 'skipped')
  assert.equal(stuck(out, { downloads: [] }), false, 'a plan whose branches were all declined is finished, not stuck')
})

test('the chooser will not run a step whose condition is false or unanswered', () => {
  const steps = [
    step({ id: 'a', capability: 'page.read', saveAs: 'state' }),
    step({ id: 'b', capability: 'tabs.close', when: { of: 'state', equals: 'ended' } })
  ]
  const registry = caps({ 'page.read': false, 'tabs.close': true })
  // b has no answer yet, so only the read goes.
  assert.deepEqual(runnable(steps, registry, {}).map((s) => s.id), ['a'], 'b cannot be judged yet')
  // Nor when the answer is no.
  assert.deepEqual(runnable(steps, registry, { state: 'playing' }).map((s) => s.id), ['a'])
})

test('once the condition holds, the step becomes runnable', () => {
  const steps = [
    step({ id: 'a', capability: 'page.read', saveAs: 'state', status: 'done' }),
    step({ id: 'b', capability: 'tabs.close', needs: ['a'], when: { of: 'state', equals: 'ended' } })
  ]
  const registry = caps({ 'page.read': false, 'tabs.close': true })
  assert.deepEqual(runnable(steps, registry, { state: 'playing' }).map((s) => s.id), [])
  assert.deepEqual(runnable(steps, registry, { state: 'ended' }).map((s) => s.id), ['b'])
})

// ---------------------------------------------------------------- using what an earlier step found

test('a whole-string reference keeps the value’s own type', () => {
  const saved = { count: 4, tabs: [{ id: '7' }], flag: false }
  assert.equal(fillIn('{{count}}', saved), 4)
  assert.equal(fillIn('{{flag}}', saved), false)
  assert.deepEqual(fillIn('{{tabs}}', saved), [{ id: '7' }])
  assert.equal(fillIn('{{tabs.0.id}}', saved), '7')
})

test('a reference inside a sentence is substituted as text', () => {
  assert.equal(fillIn('Notes on {{page.title}}', { page: { title: 'Rotation' } }), 'Notes on Rotation')
  assert.equal(fillIn('{{a}} and {{b}}', { a: 1, b: 2 }), '1 and 2')
})

test('a name nothing saved is left as written, not turned into the word undefined', () => {
  // So it shows up in the failure as the unfilled reference it is.
  assert.equal(fillIn('{{missing}}', {}), '{{missing}}')
  assert.equal(fillIn('about {{missing}}', {}), 'about {{missing}}')
})

test('references are filled in through objects and arrays', () => {
  const out = fillIn({ url: '{{page.url}}', ids: ['{{tab}}', 'fixed'], deep: { n: '{{count}}' } }, { page: { url: 'https://x' }, tab: '9', count: 2 })
  assert.deepEqual(out, { url: 'https://x', ids: ['9', 'fixed'], deep: { n: 2 } })
})

test('reads go together, but only so many at once', () => {
  /*
   * "Check these two hundred pages" must not become two hundred simultaneous reads. The rest are still ready and get
   * picked up on the next turn, so nothing is dropped -- it is paced, not truncated.
   */
  const many = Array.from({ length: 30 }, (_, i) => step({ id: `r${i}`, capability: 'page.read' }))
  const registry = caps({ 'page.read': false })
  const go = runnable(many, registry, {})
  assert.equal(go.length, MAX_AT_ONCE)
  assert.ok(MAX_AT_ONCE < 30)
})

test('anything that changes the browser still goes alone', () => {
  const steps = [step({ id: 'a', capability: 'tabs.close' }), step({ id: 'b', capability: 'tabs.close' })]
  assert.deepEqual(runnable(steps, caps({ 'tabs.close': true }), {}).map((s) => s.id), ['a'])
})
