import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextBlock, needsPageContext } from './orb.js'

test('a question about the page in front of the person asks for the page', () => {
  for (const q of ['Summarize this page', 'explain this', 'translate this', 'what does this article say', 'tl;dr', 'what is on this tab']) {
    assert.equal(needsPageContext(q), true, q)
  }
})

test('a question about the world does not drag the page into it', () => {
  for (const q of ['what is a quasar', 'who wrote Dune', 'convert 30C to F', '']) {
    assert.equal(needsPageContext(q), false, q)
  }
})

test('nothing read is no context at all, never a placeholder', () => {
  assert.equal(contextBlock(null), '')
  assert.equal(contextBlock({}), '')
  // A page that gave back an address but no words still says the address rather than pretending to have the text.
  assert.match(contextBlock({ url: 'https://a.test/' }), /Address: https:\/\/a\.test\//)
})

test('a selection is preferred over the whole page, because "this" means what was selected', () => {
  const block = contextBlock({ url: 'https://a.test/', title: 'A', text: 'the whole page', selection: 'the chosen words' })
  assert.match(block, /selected this text/)
  assert.match(block, /the chosen words/)
  assert.doesNotMatch(block, /the whole page/)
})

test('the page text is used when nothing is selected', () => {
  const block = contextBlock({ url: 'https://a.test/', title: 'A', text: 'the whole page', selection: '   ' })
  assert.match(block, /The page reads:/)
  assert.match(block, /the whole page/)
})

test('what is handed to Orion is bounded, so one enormous page cannot become the whole request', () => {
  const block = contextBlock({ url: 'https://a.test/', title: 'A', text: 'x'.repeat(50_000) })
  assert.ok(block.length < 13_000, `context was ${block.length} characters`)
})

test('the block names the page, so an answer can never be about a page Orion was not given', () => {
  const block = contextBlock({ url: 'https://a.test/x', title: 'Title here', text: 'words' })
  assert.match(block, /This is the page the person is looking at/)
  assert.match(block, /Title: Title here/)
})
