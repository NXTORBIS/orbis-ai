import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { cannotDo, keyFor, modelFor, modelsFor, PROVIDERS, refusalKind } from './providers.ts'
import type { Job } from './providers.ts'

const both = { groq: true, mistral: true }
const groqOnly = { groq: true, mistral: false }
const mistralOnly = { groq: false, mistral: true }
const neither = { groq: false, mistral: false }

const JOBS: Job[] = ['text', 'glance', 'look', 'code']

test('text goes to the largest model Orbis can reach, which is Groq', () => {
  // 120 billion parameters against Mistral's 14 billion on this account. Sending text to Mistral would be a downgrade.
  assert.deepEqual(modelFor('text', both), {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    why: '120 billion parameters, the most capable model Orbis can reach'
  })
})

test('anything involving an image goes to Mistral, because Groq cannot see at all', () => {
  assert.equal(modelFor('glance', both)?.provider, 'mistral')
  assert.equal(modelFor('look', both)?.provider, 'mistral')
})

test('a glance prefers the model that allows more requests a second, not the cleverest', () => {
  /*
   * The question is "which of these numbered things is it", asked while somebody waits. 14b is cleverer and limited to
   * one request every two seconds, which mid-task is worse than a slightly less clever answer now.
   */
  assert.equal(modelFor('glance', both)?.model, 'ministral-8b-2512')
  assert.equal(modelFor('look', both)?.model, 'ministral-14b-2512')
})

test('a Page’s code goes to the model built for code', () => {
  assert.equal(modelFor('code', both)?.model, 'codestral-2508')
})

test('every job falls back, and never to the same model twice', () => {
  for (const job of JOBS) {
    const ladder = modelsFor(job, both)
    assert.ok(ladder.length >= 2, `${job} has no fallback`)
    assert.equal(new Set(ladder.map((c) => c.model)).size, ladder.length, `${job} repeats a model`)
    for (const c of ladder) assert.ok(c.why.length > 20, `${job}/${c.model} does not say why`)
  }
})

test('a service with no keys is not offered at all', () => {
  // A fallback that cannot work is not a fallback: trying it costs a round trip and reports an authentication problem
  // rather than the thing that was actually asked for.
  assert.ok(modelsFor('text', groqOnly).every((c) => c.provider === 'groq'))
  assert.ok(modelsFor('text', mistralOnly).every((c) => c.provider === 'mistral'))
  assert.deepEqual(modelsFor('glance', groqOnly), [])
})

test('text still works with only one service, either one', () => {
  // The point of two providers: one being down is a worse answer, not no answer.
  assert.ok(modelFor('text', groqOnly))
  assert.ok(modelFor('text', mistralOnly))
})

test('with no keys at all, every job says so rather than failing silently', () => {
  for (const job of JOBS) {
    assert.equal(modelFor(job, neither), null, job)
    const why = cannotDo(job, neither)
    assert.ok(why && why.length > 25, `${job}: ${why}`)
  }
})

test('being unable to see says which service is missing and that the other cannot do it', () => {
  const why = cannotDo('glance', groqOnly)
  assert.match(String(why), /Mistral/)
  assert.match(String(why), /can see/)
})

test('a job that can be done has nothing to explain', () => {
  for (const job of JOBS) assert.equal(cannotDo(job, both), null, job)
})

// ---------------------------------------------------------------- keys

test('keys rotate per request, so several accounts multiply the request rate', () => {
  const keys = ['a', 'b', 'c']
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => keyFor(keys, n)), ['a', 'b', 'c', 'a', 'b'])
})

test('one key is used for everything, and no keys is null rather than a crash', () => {
  assert.equal(keyFor(['only'], 7), 'only')
  assert.equal(keyFor([], 0), null)
})

test('a counter that went negative does not index backwards off the array', () => {
  assert.equal(keyFor(['a', 'b', 'c'], -4), 'b')
})

// ---------------------------------------------------------------- refusals

test('busy is told apart from never-allowed', () => {
  /*
   * Mistral says 429 "Rate limit exceeded" both for a quota recovering in a minute and for a model its plan does not
   * really give you. Treated the same, Orbis either hammers a model it will never be allowed to use, or gives up on
   * one that was briefly busy.
   */
  assert.equal(refusalKind(429, '{"message":"Rate limit exceeded"}'), 'busy')
  assert.equal(refusalKind(403, '{"message":"This model is not available in your subscription tier"}'), 'not-allowed')
  assert.equal(refusalKind(403, '{"message":"is a Labs model","type":"labs_not_enabled"}'), 'not-allowed')
  assert.equal(refusalKind(401, '{"message":"Invalid API Key","code":"invalid_api_key"}'), 'bad-key')
  assert.equal(refusalKind(400, '{"message":"Invalid model: mistral-moderation-2603"}'), 'not-allowed')
  assert.equal(refusalKind(500, 'server fell over'), 'other')
})

test('both services are reachable at an OpenAI-shaped address', () => {
  // The same request body goes to either, which is what makes one a fallback for the other.
  for (const p of Object.values(PROVIDERS)) {
    assert.match(p.baseUrl, /^https:\/\//, p.id)
    assert.ok(!p.baseUrl.endsWith('/'), `${p.id} base url should not end in a slash`)
  }
})
