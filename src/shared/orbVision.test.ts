import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { describeWanted, readChoice, visionQuestion, wantsEyes } from './orbVision.ts'
import type { SeenElement } from './orbVision.ts'

const elements: SeenElement[] = [
  { ref: 1, tag: 'a', label: 'Home', href: 'https://x/home' },
  { ref: 2, tag: 'button', role: 'button', label: 'Subscribe' },
  { ref: 3, tag: 'a', label: 'Interview with the architect', href: 'https://x/v/9', inView: true },
  { ref: 4, tag: 'a', label: 'Cooking in a tiny kitchen', href: 'https://x/v/10', inView: false }
]

// ---------------------------------------------------------------- when looking is warranted

test('looking is for a failure a picture could answer, described in words', () => {
  assert.equal(wantsEyes('not-found', { locator: { text: 'the latest interview' } }), true)
  assert.equal(wantsEyes('not-found', { locator: { role: 'button', name: 'the red one' } }), true)
})

test('a ref that failed is not a looking problem, because a ref is knowledge', () => {
  /*
   * A ref comes from a snapshot the browser produced, so a ref that stopped working means the page moved on -- and a
   * picture says nothing about that.
   */
  assert.equal(wantsEyes('not-found', { locator: { ref: 7 } }, '', 'click the third video'), false)
})

test('a selector or an xpath is a guess, and a failed guess is exactly when to look', () => {
  /*
   * Settled by watching it run. A planner never sees a page's HTML -- it is given roles, names and text -- so every
   * CSS selector and every xpath it writes is invented. `.card:has(.circle)` was a reasonable guess about a page with
   * no such class, and treating it as an address meant the one case eyes exist for, a thing identifiable only by
   * sight, was the case they sat out.
   */
  assert.equal(wantsEyes('not-found', { locator: { selector: '.card:has(.circle)' } }, '', 'click the card with the circle'), true)
  assert.equal(wantsEyes('not-found', { locator: { xpath: "//div[@class='red']" } }, '', 'click the red card'), true)
})

test('what the step is called is the description, when the locator has no words', () => {
  // A plan that reached only for a selector still says in words what the step is for, because a person reads that name.
  assert.equal(describeWanted({ locator: { selector: '.x' } }, '', 'Click the card with the circle'), 'card with the circle')
  assert.equal(describeWanted({ locator: { selector: '.x' } }, '', 'wait for the red button'), 'red button')
  // And a name that says nothing is not a description.
  assert.equal(describeWanted({ locator: { selector: '.x' } }, '', 'do'), null)
})

test('a wait that ran out for a described element is a looking problem too', () => {
  /*
   * Found by running it. Asked to click something described in words, a planner waits for it and then clicks it -- so
   * the failure that arrives is a wait that ran out, and with only not-found on the list the eyes never opened.
   */
  assert.equal(wantsEyes('timeout', { locator: { text: 'the red card' } }), true)
})

test('a waiting capability with no element described is not a looking problem', () => {
  // media.waitFor waits for a video to end. There is nothing described to find, so there is nothing to look for.
  assert.equal(wantsEyes('timeout', { condition: 'ended' }), false)
})

test('a failure of another kind is not answered by looking', () => {
  // Blocked, locked, declined: none of them becomes clearer in a screenshot.
  for (const kind of ['blocked', 'tab-locked', 'unverified', 'stale', 'declined', 'unavailable']) {
    assert.equal(wantsEyes(kind, { locator: { text: 'the latest interview' } }), false, kind)
  }
})

test('a locator with no words has nothing to look for', () => {
  assert.equal(wantsEyes('not-found', { locator: {} }), false)
  assert.equal(wantsEyes('not-found', {}), false)
  assert.equal(wantsEyes('not-found', undefined), false)
})

test('what was wanted reads as somebody would say it', () => {
  assert.equal(describeWanted({ locator: { role: 'button', name: 'Subscribe' } }), 'button Subscribe')
  assert.equal(describeWanted({ locator: { text: 'the latest interview' } }), 'the latest interview')
  // The same words twice are said once.
  assert.equal(describeWanted({ locator: { name: 'Next', text: 'Next' } }), 'Next')
})

// ---------------------------------------------------------------- the question

test('the question offers the page’s own numbered elements and asks for one of them', () => {
  const asked = visionQuestion('the thumbnail of the latest interview', elements, { title: 'Videos', url: 'https://x' })
  assert.match(asked, /1\. a "Home"/)
  assert.match(asked, /3\. a "Interview with the architect"/)
  assert.match(asked, /the thumbnail of the latest interview/)
  // Asking "which number" rather than "where is it": a coordinate would be a guess, a number is a choice between
  // things that exist.
  assert.match(asked, /only the number/)
  assert.match(asked, /answer: none/)
})

test('an element that is off screen says so, since that changes what a picture shows', () => {
  assert.match(visionQuestion('anything', elements), /off screen/)
})

test('the question is bounded, because a page can have hundreds of controls', () => {
  const many: SeenElement[] = Array.from({ length: 200 }, (_, i) => ({ ref: i + 1, tag: 'a', label: `Item ${i + 1}` }))
  const asked = visionQuestion('one of them', many)
  assert.ok(asked.includes('60. a "Item 60"'), 'the first sixty are offered')
  assert.ok(!asked.includes('61. a "Item 61"'), 'and no more than that')
})

// ---------------------------------------------------------------- the answer, grounded

test('a number the page offered is accepted', () => {
  assert.deepEqual(readChoice('3', elements), { ref: 3 })
  assert.deepEqual(readChoice('The answer is 3.', elements), { ref: 3 })
  assert.deepEqual(readChoice('  2  ', elements), { ref: 2 })
})

test('a number the page did not offer is refused, not clicked', () => {
  /*
   * The rule that keeps this safe. A model looking at a picture of a page is perfectly capable of answering with a
   * number that means something to it and nothing to the browser, and acting on that is clicking at random while
   * reporting that it had looked.
   */
  const out = readChoice('9', elements)
  assert.ok('why' in out)
  if ('why' in out) assert.match(out.why, /not one of the things on it/)
})

test('"none" is an answer and is kept as one', () => {
  for (const said of ['none', 'None.', '  none of them']) {
    const out = readChoice(said, elements)
    assert.ok('why' in out, said)
    if ('why' in out) assert.match(out.why, /none of the things on it/)
  }
})

test('an answer with no number in it is refused rather than guessed at', () => {
  for (const said of ['', 'the third one', 'I cannot see the page']) {
    assert.ok('why' in readChoice(said, elements), said)
  }
})

test('a negative number is refused, since no element is numbered below one', () => {
  assert.ok('why' in readChoice('-1', elements))
})

test('nothing in a refusal is a coordinate', () => {
  // The whole point of grounding: there is no path through this file that produces a place on the screen to click.
  for (const said of ['x=723 y=411', 'click at 300, 400', '0']) {
    const out = readChoice(said, elements)
    if ('ref' in out) assert.ok(elements.some((e) => e.ref === out.ref), said)
  }
})

test('a locator carrying both a selector and words is described by the words', () => {
  const params = { locator: { selector: 'button:has-text("triangle")', text: 'card with triangle' } }
  assert.equal(describeWanted(params), 'card with triangle')
  assert.equal(wantsEyes('not-found', params), true)
})
