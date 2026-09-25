import test from 'node:test'
import assert from 'node:assert/strict'
import { PendingApprovals } from './host.ts'
import { createBrowserTaskHandlers } from './tasks.ts'

const ctx = { emit: () => undefined, signal: new AbortController().signal }

const deps = (over: Record<string, unknown> = {}) => ({
  host: () => ({ alive: true, control: {}, agent: {}, bridge: {}, stop: () => undefined }) as never,
  apiKeys: ['k'],
  fetchFn: (async () => new Response('')) as unknown as typeof fetch,
  defaultModel: 'm',
  ...over
})

test('a task is refused when there is no browser, and says why', async () => {
  const handlers = createBrowserTaskHandlers(deps({ host: () => null }))
  await assert.rejects(Promise.resolve().then(() => handlers['browser:task']([{ task: 'open youtube' }], ctx)), /browser is not open/)
})

test('a task is refused when there is no key, rather than silently doing nothing', async () => {
  const handlers = createBrowserTaskHandlers(deps({ apiKeys: [] }))
  await assert.rejects(Promise.resolve().then(() => handlers['browser:task']([{ task: 'open youtube' }], ctx)), /no Groq API key/)
})

test('an empty task is refused', async () => {
  const handlers = createBrowserTaskHandlers(deps())
  await assert.rejects(Promise.resolve().then(() => handlers['browser:task']([{ task: '   ' }], ctx)), /Say what Orbis should do/)
})

test('readiness is reported as it is, not assumed', async () => {
  const withBrowser = createBrowserTaskHandlers(deps())
  assert.deepEqual(await withBrowser['browser:task-ready']([], ctx), { browser: true, key: true, busy: false })
  const without = createBrowserTaskHandlers(deps({ host: () => null, apiKeys: [] }))
  assert.deepEqual(await without['browser:task-ready']([], ctx), { browser: false, key: false, busy: false })
  // A browser that has gone away is not alive, whatever the host object says it once was.
  const closed = createBrowserTaskHandlers(deps({ host: () => ({ alive: false }) as never }))
  assert.equal((await closed['browser:task-ready']([], ctx) as { browser: boolean }).browser, false)
})

test('stopping when nothing runs says so rather than claiming a stop', async () => {
  const handlers = createBrowserTaskHandlers(deps())
  assert.deepEqual(await handlers['browser:task-stop']([], ctx), { stopped: false })
})

test('an approval for nothing is not mistaken for an approval', async () => {
  const handlers = createBrowserTaskHandlers(deps())
  assert.deepEqual(await handlers['browser:task-answer'](['nothing-is-waiting', true], ctx), { answered: false })
  await assert.rejects(Promise.resolve().then(() => handlers['browser:task-answer']([42, true], ctx)), /not an approval/)
})

// ---------------------------------------------------------------- the approval gate

const confirmation = (id: string) => ({ id, action: 'Click "Place order"', reason: 'It spends money.' })

test('an action waits until the person answers, and gets their answer', async () => {
  const approvals = new PendingApprovals()
  const controller = new AbortController()
  const asked = approvals.ask(confirmation('a'), controller.signal)
  assert.equal(approvals.size, 1)
  assert.equal(approvals.answer('a', true), true)
  assert.equal(await asked, true)
  assert.equal(approvals.size, 0)
})

test('no means no', async () => {
  const approvals = new PendingApprovals()
  const asked = approvals.ask(confirmation('b'), new AbortController().signal)
  approvals.answer('b', false)
  assert.equal(await asked, false)
})

test('anything other than a plain yes is a no', async () => {
  const approvals = new PendingApprovals()
  const asked = approvals.ask(confirmation('c'), new AbortController().signal)
  // The wire carries whatever a caller sends; only true is approval.
  approvals.answer('c', 'yes' as unknown as boolean)
  assert.equal(await asked, false)
})

test('stopping the task refuses whatever it was waiting on', async () => {
  const approvals = new PendingApprovals()
  const controller = new AbortController()
  const asked = approvals.ask(confirmation('d'), controller.signal)
  controller.abort()
  assert.equal(await asked, false)
  // And the answer that arrives afterwards changes nothing.
  assert.equal(approvals.answer('d', true), false)
})

test('one answer settles one action, and only once', async () => {
  const approvals = new PendingApprovals()
  const signal = new AbortController().signal
  const first = approvals.ask(confirmation('e'), signal)
  const second = approvals.ask(confirmation('f'), signal)
  approvals.answer('e', true)
  assert.equal(await first, true)
  assert.equal(approvals.answer('e', false), false)
  approvals.answer('f', false)
  assert.equal(await second, false)
})
