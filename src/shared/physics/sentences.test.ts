import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * What a plain sentence to the orb is understood to mean.
 *
 * The reading lives in the renderer, beside the code that works the screen, because it ends in a click. These are
 * the same patterns, checked here because they are the part that decides whether a request is carried out at all
 * and they can be checked without a window.
 *
 * It matters that this is checked rather than left to a model. A sentence the patterns understand is carried out
 * directly — no model is asked, nothing can be misread, and it works with no key set at all. Everything the
 * patterns do not understand falls through to Orion, which is the slower and less certain path.
 */

const RESET = /\breset\b|\bstart over\b|\bback to the start\b/i
const STEP = /\bstep\b(?:\s+(?:it|forward|through))?(?:\s+(\d+))?/i
const EXPLAIN = /\b(?:explain|explanation|what does this mean)\b/i
const HIDE_EXPLAIN = /\bhide\b.{0,16}\bexplan/i
const SAVE = /\b(?:save|export|download)\b.{0,20}?\b(csv|json|png|picture|image)\b/i
const PRESS = /\b(?:press|click|hit|tap)\s+(?:the\s+)?["'‘’“”]?([a-zA-Z][a-zA-Z0-9 –—()/.&+-]{1,40}?)["'‘’“”]?\s*(?:button)?\s*$/i
const TIMES = /(\d+(?:\.\d+)?)\s*(?:x|times)\b/i
const PLAY = /\b(?:run|play|start|go)\b/i
const STOP = /\b(?:pause|stop|hold)\b/i

test('starting and stopping are told apart', () => {
  for (const said of ['run it', 'play it', 'start the simulation', 'go']) {
    assert.ok(PLAY.test(said), `"${said}" should start it`)
    assert.ok(!STOP.test(said), `"${said}" should not stop it`)
  }
  for (const said of ['pause it', 'stop', 'hold it there']) {
    assert.ok(STOP.test(said), `"${said}" should stop it`)
  }
})

test('a speed is read as a speed, and not as a control', () => {
  assert.equal(TIMES.exec('run it at 2x')?.[1], '2')
  assert.equal(TIMES.exec('play at 0.5x')?.[1], '0.5')
  assert.equal(TIMES.exec('run it 3 times faster')?.[1], '3')
  // "30" here is a control's value, not a speed, so nothing with an x or "times" must match.
  assert.equal(TIMES.exec('set the launch speed to 30'), null)
})

test('stepping counts how many', () => {
  assert.equal(STEP.exec('step it')?.[1], undefined)
  assert.equal(STEP.exec('step it 5 times')?.[1], '5')
  assert.equal(STEP.exec('step forward 12')?.[1], '12')
  assert.equal(STEP.exec('step through 3')?.[1], '3')
})

test('resetting is recognised however it is put', () => {
  for (const said of ['reset it', 'reset', 'start over', 'put it back to the start']) {
    assert.ok(RESET.test(said), `"${said}" should reset it`)
  }
  assert.ok(!RESET.test('set the mass to 2'))
})

test('showing the explanation and hiding it are opposites, not the same word', () => {
  assert.ok(EXPLAIN.test('show me the explanation'))
  assert.ok(EXPLAIN.test('explain this'))
  assert.ok(EXPLAIN.test('what does this mean'))
  // The hiding case must also match the showing word, which is why the order of the two checks matters in the
  // code: hide wins. If it did not, "hide the explanation" would show it.
  assert.ok(HIDE_EXPLAIN.test('hide the explanation'))
  assert.ok(HIDE_EXPLAIN.test('hide explanation'))
  assert.ok(!HIDE_EXPLAIN.test('show me the explanation'))
})

test('saving names the kind of file', () => {
  assert.equal(SAVE.exec('save it as csv')?.[1]?.toLowerCase(), 'csv')
  assert.equal(SAVE.exec('export the data as JSON')?.[1]?.toLowerCase(), 'json')
  assert.equal(SAVE.exec('download a png')?.[1]?.toLowerCase(), 'png')
  // "picture" and "image" are how people say PNG, so they are understood and turned into png where it is used.
  assert.equal(SAVE.exec('save the picture')?.[1]?.toLowerCase(), 'picture')
  assert.equal(SAVE.exec('save the image')?.[1]?.toLowerCase(), 'image')
  assert.equal(SAVE.exec('save this'), null, 'a kind it cannot name must not be guessed at')
})

test('a button is named by the words on it', () => {
  assert.equal(PRESS.exec('press Build Hamiltonian')?.[1], 'Build Hamiltonian')
  assert.equal(PRESS.exec('click the Run trial button')?.[1], 'Run trial')
  assert.equal(PRESS.exec('hit "Run Simulation"')?.[1], 'Run Simulation')
  assert.equal(PRESS.exec('tap Add measurement')?.[1], 'Add measurement')
})

test('a sentence that is not a command is left for Orion', () => {
  // These must press nothing. Guessing a button from a question is how an assistant changes something unasked.
  for (const said of ['why does the trajectory curve', 'what is the range now', 'how does damping work']) {
    assert.equal(PRESS.exec(said), null, `"${said}" is a question, not a button`)
  }
})
