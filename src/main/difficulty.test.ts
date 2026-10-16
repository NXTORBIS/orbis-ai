import { test } from 'node:test'
import assert from 'node:assert/strict'
import { difficulty, HARD_FROM, routeModel } from '../shared/modelRoute.ts'
import { CHAT_MODELS, modelInfo } from '../shared/models.ts'

/** How hard a message looks decides whether a question with no keyword still gets a careful model. */

test('small talk is never hard', () => {
  for (const text of ['hi', 'hello there', 'thanks!', 'ok', 'Great', 'yes']) {
    assert.equal(difficulty(text), 0, text)
  }
  assert.equal(difficulty(''), 0)
})

test('an ordinary short question is not hard', () => {
  for (const text of ['What is the capital of Japan?', 'How tall is Everest?', 'Who wrote Dune?']) {
    assert.ok(difficulty(text) < HARD_FROM, text)
  }
})

test('a why-and-how question with several parts is hard', () => {
  const text = 'Why does my sourdough collapse in the oven, and how should I change the proof time and the hydration on the next bake?'
  assert.ok(difficulty(text) >= HARD_FROM, `scored ${difficulty(text)}`)
})

test('two questions in one message count towards hard', () => {
  assert.ok(difficulty('What is the difference between TCP and UDP? Which should I use for a game?') >= HARD_FROM)
})

test('a long message is hard without any keyword', () => {
  const text = `${'word '.repeat(130)}`
  assert.ok(difficulty(text) >= HARD_FROM)
})

test('stacked constraints count', () => {
  const text = 'Rewrite this paragraph under 100 words, without jargon, and it must keep the original meaning.'
  assert.ok(difficulty(text) >= 1)
})

test('a long conversation nudges a borderline message over', () => {
  const text = 'And what about the second one? Does that change the answer?'
  assert.ok(difficulty(text, 0) < HARD_FROM)
  assert.ok(difficulty(text, 12) >= HARD_FROM)
})

test('a hard message with no keyword in it is still routed to a model that claims reasoning', () => {
  // Nothing here matches the keyword lists: no "why does", no code, no maths, no writing verb.
  const text =
    'My bread keeps collapsing in the oven and the crumb stays dense. I give it four hours at room temperature, use 75% water, and bake at 230 degrees. ' +
    'I want a taller loaf with an open crumb next time, so tell me what to change, in what order, and which flour I should use.'
  const route = routeModel({ text })
  assert.match(route.reason, /hard, multi-part/)
  assert.ok(modelInfo(route.model).strengths?.includes('reasoning'), `${route.model} should claim reasoning`)
})

test('a message the keyword lists already catch keeps its own reason, and still gets a reasoning model', () => {
  const route = routeModel({ text: 'Why does my sourdough collapse in the oven, and how should I change the timing on the next bake?' })
  assert.equal(route.reason, 'needs careful reasoning')
  assert.ok(modelInfo(route.model).strengths?.includes('reasoning'))
})

test('small talk still goes to the everyday model', () => {
  const route = routeModel({ text: 'hey' })
  assert.equal(route.reason, 'everyday question')
})

test('a keyword need still wins over the score', () => {
  const route = routeModel({ text: 'Why does this function return undefined? ```js\nfunction f() { return }\n```' })
  assert.equal(route.reason, 'code')
})

test('every model the router can pick really exists in the table', () => {
  for (const text of ['hey', 'Why does this fail and how do I fix it and what should I read?', 'write me a poem']) {
    const route = routeModel({ text })
    assert.ok(CHAT_MODELS.some((m) => m.id === route.model), route.model)
  }
})
