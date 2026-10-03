import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MAX_SPOKEN, shouldStopSpeaking, speakable, stopNote } from './voiceReply.ts'

/**
 * What an answer sounds like when it is read out, and when reading has to stop.
 *
 * Reading aloud used to live inside one menu on one kind of message, calling the browser's speech directly. So
 * nothing else in Orbis could speak, two messages could be read at once, and speaking carried on while somebody held
 * the microphone down and talked over it.
 */

test('marks that only mean something on a screen are not read out', () => {
  const { text } = speakable('## The result\n\nThis is **important** and _worth_ saying.')
  assert.equal(text, 'The result\n\nThis is important and worth saying.')
})

test('a code block is named rather than read, because reading one is noise nobody can follow', () => {
  const { text } = speakable('Here is how:\n\n```js\nconst x = 1\nif (x) { go() }\n```\n\nThat is all.')
  assert.ok(text.includes('there is a block of code here'), text)
  assert.ok(!text.includes('const'), text)
})

test('a link becomes its words, not its address', () => {
  assert.equal(speakable('See [the guide](https://example.org/a/very/long/path?x=1) for more.').text, 'See the guide for more.')
})

test('an image becomes what it is of, when that was written down', () => {
  assert.ok(speakable('![a bar chart of sales](x.png)').text.includes('an image: a bar chart of sales'))
  assert.ok(speakable('![](x.png)').text.includes('an image'))
})

test('a citation is read the way somebody would say it', () => {
  assert.ok(speakable('Prices rose [2] last year.').text.includes('source 2'))
  assert.ok(speakable('Prices rose [1,3] last year.').text.includes('sources 1, 3'))
})

test('bullets and quotes lose their marks and keep their words', () => {
  const { text } = speakable('- first thing\n- second thing\n\n> a quoted line')
  assert.ok(text.includes('first thing'))
  assert.ok(!text.includes('- '), text)
  assert.ok(!text.includes('>'), text)
})

test('inline code keeps its words', () => {
  assert.equal(speakable('Call `doTheThing()` first.').text, 'Call doTheThing() first.')
})

test('nothing is reworded: the same words come out', () => {
  const said = 'The committee published its findings on Tuesday.'
  assert.equal(speakable(said).text, said)
})

test('something far too long is cut at a sentence and says there is more', () => {
  const long = 'This is a sentence that is quite long. '.repeat(400)
  const { text, shortened } = speakable(long)
  assert.equal(shortened, true)
  assert.ok(text.length < MAX_SPOKEN + 200)
  assert.ok(text.includes('the rest is on the screen'), text.slice(-120))
  assert.ok(text.includes('long. That is as much'), 'it stopped at the end of a sentence')
})

test('something of ordinary length is not cut and does not say it was', () => {
  const { text, shortened } = speakable('A short answer.')
  assert.equal(shortened, false)
  assert.equal(text, 'A short answer.')
})

test('the microphone opening always stops speaking', () => {
  assert.equal(shouldStopSpeaking({ microphoneOpen: true }), 'interrupted')
  // Even alongside everything else: somebody who starts talking has decided they have heard enough.
  assert.equal(shouldStopSpeaking({ microphoneOpen: true, asked: true, leftTheScreen: true }), 'interrupted')
})

test('being asked, or leaving the conversation, stops it too', () => {
  assert.equal(shouldStopSpeaking({ asked: true }), 'asked')
  assert.equal(shouldStopSpeaking({ leftTheScreen: true }), 'asked')
})

test('nothing happening stops nothing', () => {
  assert.equal(shouldStopSpeaking({}), null)
})

test('only a real failure is worth saying out loud; the rest are plainly visible', () => {
  assert.ok(stopNote('failed'))
  assert.equal(stopNote('finished'), null)
  assert.equal(stopNote('asked'), null)
  assert.equal(stopNote('interrupted'), null)
})
