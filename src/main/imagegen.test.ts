import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectImageGenRequest } from './imagegen.ts'

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
