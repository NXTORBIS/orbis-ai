import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectImageCount, detectImageGenRequest } from './imagegen.ts'

test('a picture is still a picture', () => {
  assert.equal(detectImageGenRequest('draw a dragon'), 'dragon')
  assert.equal(detectImageGenRequest('paint me a lake at dawn'), 'lake at dawn')
  assert.equal(detectImageGenRequest('make a logo for my bakery'), 'my bakery')
  assert.equal(detectImageGenRequest('generate a cat in space'), 'cat in space')
  assert.equal(detectImageGenRequest('/imagine a bar chart made of neon'), 'a bar chart made of neon')
  // The chart is in the picture; it is not the thing asked for.
  assert.ok(detectImageGenRequest('draw a dragon reading a chart'))
  assert.ok(detectImageGenRequest('draw a picture of a chart on a whiteboard'))
  assert.ok(detectImageGenRequest('make an image of a pie chart'))
})

test('a chart, a flowchart, a spreadsheet or a file is not a picture: those are made from the data, not painted', () => {
  for (const asked of [
    'draw a bar chart of sales by month',
    'draw me a nice line graph of revenue',
    'make a flowchart of the login steps',
    'create a flow chart for onboarding',
    'generate a diagram of the approval process',
    'generate a spreadsheet of my expenses',
    'generate a document about climate change',
    'generate a PDF report on the quarter',
    'please draw a histogram of the ages',
    'can you plot the data',
    'generate a presentation about our roadmap'
  ]) {
    assert.equal(detectImageGenRequest(asked), null, asked)
  }
})

test('what was never a picture request still is not', () => {
  assert.equal(detectImageGenRequest('how do I draw a dragon?'), null)
  assert.equal(detectImageGenRequest('generate a summary of this'), null)
  assert.equal(detectImageGenRequest('what makes a good logo?'), null)
})

test('how many pictures were asked for', () => {
  const n = (t: string): number => detectImageCount(t).count
  assert.equal(n('generate 3 images of a dog'), 3)
  assert.equal(n('give me four variations of a logo for a bakery'), 4)
  assert.equal(n('make 2 pictures of a red car'), 2)
  assert.equal(n('draw a dragon'), 1)
  assert.equal(n('3 pictures of cats in a row'), 3)
  // Capped, and the request is still reported.
  assert.deepEqual(detectImageCount('generate 10 images of a cat'), { count: 4, requested: 10 })
  // A number that belongs to the picture, not to the request.
  assert.equal(n('a picture of two images hanging on a wall'), 1)
  assert.equal(n('draw 3 cats'), 1)
  assert.equal(n('generate an image of 5 apples'), 1)
  assert.equal(n('generate 1 image of a cat'), 1)
})
