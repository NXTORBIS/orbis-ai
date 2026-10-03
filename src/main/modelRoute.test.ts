import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_MODEL, bestFor, inputRoomOf, resolveModel, routable, routeModel } from '../shared/modelRoute.ts'
import { CHAT_MODELS, isKnownModel, MODELS } from '../shared/models.ts'
import type { ModelInfo } from '../shared/types.ts'

/**
 * Auto picks from the model table, not from a list of ids written into the router.
 *
 * The tests name needs rather than models for the same reason the router does: a model retired tomorrow should make
 * one line of the table wrong, not leave Auto pointing at something the service no longer serves.
 */

const strengthsOf = (id: string): readonly string[] => CHAT_MODELS.find((m) => m.id === id)?.strengths ?? []

test('quick everyday questions go to a model that claims everyday work', () => {
  for (const text of ['hi', 'What is the capital of France?', 'Recommend a good sci-fi movie', 'what time is it in Tokyo']) {
    const route = routeModel({ text })
    assert.equal(route.reason, 'everyday question', text)
    assert.ok(strengthsOf(route.model).includes('everyday'), `${route.model} for "${text}"`)
  }
})

test('reasoning, maths and code go to a model that claims them', () => {
  const cases: [string, string][] = [
    ['Prove that the square root of 2 is irrational', 'reasoning'],
    ['Compare SQLite and Postgres for a desktop app and explain the trade-offs', 'reasoning'],
    ['Why does my React component render twice?', 'code'],
    ['const x = items.map((i) => i.id); why is x empty?', 'code'],
    ['what is 17 * 23 + 4 =', 'maths'],
    ['Write a python function that reverses a linked list', 'code']
  ]
  for (const [text, need] of cases) {
    const route = routeModel({ text })
    assert.ok(strengthsOf(route.model).includes(need), `"${text}" wanted ${need}, got ${route.model}`)
  }
})

test('writing goes to a model that claims writing', () => {
  for (const text of ['Write a short poem about the monsoon', 'Draft an email to my landlord about the leaking tap', 'Polish this paragraph so it sounds friendlier']) {
    const route = routeModel({ text })
    assert.ok(strengthsOf(route.model).includes('writing'), `${route.model} for "${text}"`)
  }
})

test('long material goes to a model that claims long material, even when the question is simple', () => {
  const route = routeModel({ text: 'what is this about?', attachmentChars: 20_000 })
  assert.equal(route.reason, 'long material')
  assert.ok(strengthsOf(route.model).includes('long'))
})

test('Auto is resolved to a real model, and a model someone chose is never overridden', () => {
  assert.ok(isKnownModel(resolveModel(AUTO_MODEL, { text: 'hi' }).model))
  assert.deepEqual(resolveModel('openai/gpt-oss-120b', { text: 'Prove Fermat' }), { model: 'openai/gpt-oss-120b', reason: 'chosen' })
  for (const route of [routeModel({ text: 'x' }), routeModel({ text: 'prove it' }), routeModel({ text: 'write a poem' })]) {
    assert.ok(isKnownModel(route.model) && route.model !== AUTO_MODEL, `${route.model} is a real model`)
  }
  assert.ok(MODELS.some((m) => m.id === AUTO_MODEL), 'Auto can be picked')
})

test('Auto never routes to itself, and never to a model chosen by job rather than by a person', () => {
  const ids = new Set(routable().map((one) => one.id))
  assert.ok(!ids.has(AUTO_MODEL))
  for (const one of MODELS) if (one.job) assert.ok(!ids.has(one.id), `${one.id} is for ${one.job}, not for conversation`)
})

test('a model the table says nothing about is never chosen, however good it might be', () => {
  const mystery: ModelInfo = { id: 'mystery', label: 'Mystery', description: '', reasoningEffort: false, echoReasoning: false, contextWindow: 9_000_000 }
  assert.ok(!routable([mystery]).length)
  assert.equal(bestFor('everyday', 10, [mystery]), null)
})

test('a retired model cannot be routed to, because routing reads the list it is no longer in', () => {
  const left: ModelInfo[] = CHAT_MODELS.filter((one) => one.id !== 'openai/gpt-oss-120b')
  const route = routeModel({ text: 'Write a python function that reverses a linked list' }, left)
  assert.notEqual(route.model, 'openai/gpt-oss-120b')
  assert.ok(left.some((one) => one.id === route.model), 'and what it did choose is in the list')
})

test('when nothing claims what is needed, something real is still chosen rather than nothing', () => {
  const onlyWriting: ModelInfo[] = [{ id: 'w', label: 'W', description: '', reasoningEffort: false, echoReasoning: false, contextWindow: 1000, strengths: ['writing'] }]
  const route = routeModel({ text: 'hello' }, onlyWriting)
  assert.ok(isKnownModel(route.model) || route.model === 'w', route.model)
})

test('the model with room for the material wins among models that can do the job', () => {
  const small: ModelInfo = { id: 'small', label: 'S', description: '', reasoningEffort: false, echoReasoning: false, contextWindow: 100, strengths: ['everyday'] }
  const big: ModelInfo = { id: 'big', label: 'B', description: '', reasoningEffort: false, echoReasoning: false, contextWindow: 100_000, strengths: ['everyday'] }
  assert.equal(bestFor('everyday', 10_000, [small, big])?.id, 'big')
})

test("a model's room is the stricter of its two limits, not the larger", () => {
  const one: ModelInfo = { id: 'x', label: 'X', description: '', reasoningEffort: false, echoReasoning: false, contextWindow: 131_072, inputTokenLimit: 6000 }
  assert.equal(inputRoomOf(one), 24_000)
})

test('every model Auto can choose says what it is for', () => {
  for (const one of routable()) assert.ok((one.strengths?.length ?? 0) > 0, one.id)
})

test('every kind of work Auto looks for is something at least one model claims', () => {
  for (const need of ['everyday', 'code', 'maths', 'reasoning', 'writing', 'long'] as const) {
    assert.ok(bestFor(need, 0), `nothing in the model table can do "${need}", so Auto would fall through for it`)
  }
})
