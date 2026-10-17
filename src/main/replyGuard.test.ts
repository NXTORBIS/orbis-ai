import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReplyGuard, type ReplyGuardDeps } from './replyGuard.ts'
import type { Research, StreamEvent } from '../shared/types'

const GOOD = 'A hash map stores values under keys by hashing each key to pick a bucket, so a lookup goes straight to the right place.'

function run(opts: {
  streamed: string
  research?: Research
  again?: string | null
  revision?: string | null
  question?: string
  hasImages?: boolean
  abortSignal?: AbortSignal
  startModel?: string
}) {
  const out: StreamEvent[] = []
  const calls = { again: [] as string[], revise: [] as string[] }
  const deps: ReplyGuardDeps = {
    emit: (e) => out.push(e),
    signal: opts.abortSignal ?? new AbortController().signal,
    model: 'openai/gpt-oss-20b',
    question: opts.question ?? 'Explain how a hash map works.',
    hasAttachments: false,
    hasPageContext: false,
    hasImages: opts.hasImages ?? false,
    roomNeeded: 100,
    generateAgain: async (m) => {
      calls.again.push(m)
      return opts.again === undefined ? GOOD : opts.again
    },
    revise: async (m) => {
      calls.revise.push(m)
      return opts.revision === undefined ? null : opts.revision
    }
  }
  const guard = createReplyGuard(deps)
  const model = opts.startModel ?? 'openai/gpt-oss-20b'
  guard.emit({ type: 'start', model })
  if (opts.research) guard.emit({ type: 'research', research: opts.research })
  for (const piece of opts.streamed.match(/[\s\S]{1,13}/g) ?? []) guard.emit({ type: 'delta', content: piece })
  guard.emit({ type: 'done', model, truncated: false })
  return { out, calls, settle: () => guard.settle() }
}

const types = (events: StreamEvent[]): string[] => events.map((e) => e.type)

test('a good reply passes through untouched: no model call, one done, no replace', async () => {
  const r = run({ streamed: GOOD })
  assert.equal(types(r.out).includes('done'), false, 'done is held until the checks have run')
  await r.settle()
  assert.deepEqual(r.calls, { again: [], revise: [] })
  assert.equal(types(r.out).filter((t) => t === 'done').length, 1)
  assert.equal(types(r.out).includes('replace'), false)
  assert.equal(types(r.out).at(-1), 'done')
  assert.equal(types(r.out).filter((t) => t === 'delta').length > 3, true, 'it streamed as it went')
})

test('a short correct answer is never retried', async () => {
  const r = run({ streamed: '4', question: 'What is 2+2?' })
  await r.settle()
  assert.deepEqual(r.calls.again, [])
  assert.equal(types(r.out).includes('replace'), false)
})

test('a weak reply is generated again once by a different model and replaced when the retry is good', async () => {
  const r = run({ streamed: 'Here is the function:\n\n```ts\nfunction add(a, b) {\n  return a +' })
  await r.settle()
  assert.equal(r.calls.again.length, 1)
  assert.notEqual(r.calls.again[0], 'openai/gpt-oss-20b')
  const status = r.out.find((e) => e.type === 'status')
  assert.ok(status && status.type === 'status' && /trying it again/.test(status.message))
  const replace = r.out.find((e) => e.type === 'replace')
  assert.ok(replace && replace.type === 'replace')
  assert.equal(replace.content, GOOD)
  assert.equal(replace.retried, true)
  assert.equal(replace.model, r.calls.again[0])
  const done = r.out.at(-1)
  assert.ok(done && done.type === 'done')
  assert.equal(done.model, r.calls.again[0])
  assert.ok(r.out.indexOf(replace) < r.out.length - 1, 'replace comes before done')
})

test('the original is kept when the retry is weak too, and there is still only one retry', async () => {
  const r = run({ streamed: '', again: '' })
  await r.settle()
  assert.equal(r.calls.again.length, 1)
  assert.equal(types(r.out).includes('replace'), false)
  assert.equal(types(r.out).filter((t) => t === 'done').length, 1)
})

test('the original is kept when the retry fails outright', async () => {
  const r = run({ streamed: '   ', again: null })
  await r.settle()
  assert.equal(types(r.out).includes('replace'), false)
  assert.equal(types(r.out).at(-1), 'done')
})

test('a thrown retry never loses the reply or the done', async () => {
  const out: StreamEvent[] = []
  const guard = createReplyGuard({
    emit: (e) => out.push(e),
    signal: new AbortController().signal,
    model: 'openai/gpt-oss-20b',
    question: 'Explain recursion',
    hasAttachments: false,
    hasPageContext: false,
    hasImages: false,
    roomNeeded: 10,
    generateAgain: async () => {
      throw new Error('network down')
    },
    revise: async () => null
  })
  guard.emit({ type: 'start', model: 'openai/gpt-oss-20b' })
  guard.emit({ type: 'done', model: 'openai/gpt-oss-20b', truncated: false })
  await guard.settle()
  assert.equal(types(out).at(-1), 'done')
  assert.equal(types(out).includes('replace'), false)
})

test('a message with a picture is not retried', async () => {
  const r = run({ streamed: '', hasImages: true })
  await r.settle()
  assert.deepEqual(r.calls.again, [])
  assert.equal(types(r.out).at(-1), 'done')
})

test('an error or a stop passes straight through and nothing is retried', async () => {
  const out: StreamEvent[] = []
  const calls: string[] = []
  const guard = createReplyGuard({
    emit: (e) => out.push(e),
    signal: new AbortController().signal,
    model: 'm',
    question: 'q',
    hasAttachments: false,
    hasPageContext: false,
    hasImages: false,
    roomNeeded: 1,
    generateAgain: async (m) => (calls.push(m), GOOD),
    revise: async () => null
  })
  guard.emit({ type: 'start', model: 'm' })
  guard.emit({ type: 'error', message: 'boom' })
  await guard.settle()
  assert.deepEqual(types(out), ['start', 'error'])
  assert.deepEqual(calls, [])
})

test('a stop during the retry keeps the first reply', async () => {
  const controller = new AbortController()
  const out: StreamEvent[] = []
  const guard = createReplyGuard({
    emit: (e) => out.push(e),
    signal: controller.signal,
    model: 'openai/gpt-oss-20b',
    question: 'Explain recursion',
    hasAttachments: false,
    hasPageContext: false,
    hasImages: false,
    roomNeeded: 10,
    generateAgain: async () => {
      controller.abort()
      return GOOD
    },
    revise: async () => null
  })
  guard.emit({ type: 'start', model: 'openai/gpt-oss-20b' })
  guard.emit({ type: 'done', model: 'openai/gpt-oss-20b', truncated: false })
  await guard.settle()
  assert.equal(types(out).includes('replace'), false)
  assert.equal(types(out).at(-1), 'done')
})

test('settle is idempotent: done is announced once', async () => {
  const r = run({ streamed: GOOD })
  await r.settle()
  await r.settle()
  assert.equal(types(r.out).filter((t) => t === 'done').length, 1)
})

// ---------- research verification ----------

const research = (): Research => ({
  id: 'r1',
  question: 'How do heat pumps work?',
  queries: ['heat pumps'],
  recency: 'any',
  retrievedAt: 0,
  sources: [
    {
      n: 1,
      title: 'Heat pump basics',
      url: 'https://energy.example.gov/heat-pumps',
      domain: 'energy.example.gov',
      snippet: '',
      query: 'heat pumps',
      read: true,
      excerpt:
        'A heat pump moves heat from outside air into a building instead of generating heat by burning fuel. Modern air source heat pumps work in outdoor temperatures down to minus 25 degrees.'
    }
  ]
})

const DRAFT =
  'A heat pump moves heat from outside air into a building rather than burning fuel [1]. The government pays half of every installation bill for homeowners in all regions [1].'
const FIXED = 'A heat pump moves heat from outside air into a building rather than burning fuel [1].'

test('an answer whose claims its sources carry is not revised', async () => {
  const r = run({ streamed: FIXED, research: research(), revision: 'should never be asked for' })
  await r.settle()
  assert.deepEqual(r.calls.revise, [])
  assert.equal(types(r.out).includes('replace'), false)
})

test('unsupported claims get one revision from the same model and a better one replaces the draft', async () => {
  const r = run({ streamed: DRAFT, research: research(), revision: FIXED, startModel: 'qwen/qwen3.8-27b' })
  await r.settle()
  assert.deepEqual(r.calls.revise, ['qwen/qwen3.8-27b'])
  assert.deepEqual(r.calls.again, [])
  const replace = r.out.find((e) => e.type === 'replace')
  assert.ok(replace && replace.type === 'replace')
  assert.equal(replace.content, FIXED)
  assert.equal(replace.retried, false)
  assert.equal(types(r.out).at(-1), 'done')
})

test('a revision that is no better, or that cites a source that is not there, is thrown away', async () => {
  const noBetter = run({ streamed: DRAFT, research: research(), revision: DRAFT + ' More text about the topic itself [1].' })
  await noBetter.settle()
  assert.equal(types(noBetter.out).includes('replace'), false)
  assert.equal(noBetter.calls.revise.length, 1)

  const invented = run({ streamed: DRAFT, research: research(), revision: FIXED.replace('[1]', '[9]') })
  await invented.settle()
  assert.equal(types(invented.out).includes('replace'), false)
})

test('a failed revision keeps the draft', async () => {
  const r = run({ streamed: DRAFT, research: research(), revision: null })
  await r.settle()
  assert.equal(types(r.out).includes('replace'), false)
  assert.equal(types(r.out).at(-1), 'done')
})

test('a weak research reply is retried first, and the retry is then checked against the sources', async () => {
  const r = run({ streamed: '', research: research(), again: DRAFT, revision: FIXED })
  await r.settle()
  assert.equal(r.calls.again.length, 1)
  assert.deepEqual(r.calls.revise, [r.calls.again[0]], 'the rewrite goes to the model that wrote the retried text')
  const replaces = r.out.filter((e) => e.type === 'replace')
  assert.equal(replaces.length, 1, 'one replace with the final text')
  assert.equal(replaces[0].type === 'replace' && replaces[0].content, FIXED)
})
