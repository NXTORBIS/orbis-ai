import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { EXAMPLES, understand } from './speech.ts'

/**
 * Spoken commands.
 *
 * The tests that matter: nothing destructive is reachable by voice, "stop" always means stop, and a sentence
 * outside the list comes back as not understood rather than as a guess.
 */

describe('what Orbis does with a spoken sentence', () => {
  it('understands nothing from nothing', () => {
    assert.equal(understand(''), null)
    assert.equal(understand('   '), null)
  })

  it('refuses to guess at a sentence it does not know', () => {
    for (const said of ['the mitochondria is the powerhouse of the cell', 'hello', 'what is the capital of France', 'delete everything']) {
      assert.equal(understand(said), null, said)
    }
  })

  it('has no command that destroys anything', () => {
    for (const said of ['delete my cards', 'remove that board', 'clear my goals', 'wipe everything', 'reset my progress']) {
      const out = understand(said)
      assert.ok(out === null || !/delete|remove|clear|reset/.test(out.command.kind), said)
    }
  })

  it('hears stop, however it is said', () => {
    for (const said of ['stop', 'end the session', 'finish', "that's it", 'I am done']) {
      assert.equal(understand(said)?.command.kind, 'end-focus', said)
    }
  })

  it('does not hear stop in "take a break"', () => {
    assert.equal(understand('take a break')?.command.kind, 'break')
  })

  it('hears a length, in digits or in words', () => {
    assert.deepEqual(understand('start 25 minutes')?.command, { kind: 'start-focus', minutes: 25, subject: null })
    assert.deepEqual(understand('start twenty five minutes')?.command, { kind: 'start-focus', minutes: 25, subject: null })
    assert.deepEqual(understand('focus for half an hour')?.command, { kind: 'start-focus', minutes: 30, subject: null })
  })

  it('treats no length as no length rather than inventing one', () => {
    const out = understand('start a session')
    assert.equal(out?.command.kind, 'start-focus')
    assert.equal(out?.command.kind === 'start-focus' ? out.command.minutes : 'x', null)
  })

  it('hears a subject only when the sentence names one', () => {
    const named = understand('start 25 minutes on chemistry')
    assert.equal(named?.command.kind === 'start-focus' ? named.command.subject : null, 'Chemistry')
    const bare = understand('start 25 minutes')
    assert.equal(bare?.command.kind === 'start-focus' ? bare.command.subject : 'x', null)
  })

  it('ignores a silly length rather than acting on it', () => {
    const out = understand('start 9999 minutes')
    assert.equal(out?.command.kind === 'start-focus' ? out.command.minutes : 'x', null)
  })

  it('opens screens, with or without the word open', () => {
    assert.equal(understand('open my cards')?.command.kind, 'go')
    assert.equal(understand('cards')?.command.kind, 'go')
    assert.deepEqual(understand('show my plan')?.command, { kind: 'go', where: 'plan' })
    assert.deepEqual(understand('take me to whiteboard')?.command, { kind: 'go', where: 'board' })
  })

  it('answers the two questions people actually ask', () => {
    assert.equal(understand('what should I do now')?.command.kind, 'what-next')
    assert.equal(understand('how long is left')?.command.kind, 'how-long')
  })

  it('tells the screen what it is about to do, every time', () => {
    for (const said of ['stop', 'pause', 'start 25 minutes', 'open my cards', 'make today a rest day']) {
      const out = understand(said)
      assert.ok(out && out.says.length > 5, said)
    }
  })

  it('every example it advertises is one it actually understands', () => {
    for (const example of EXAMPLES) assert.ok(understand(example), example)
  })

  it('is not thrown by punctuation or capitals', () => {
    assert.equal(understand('Start 25 minutes, please!')?.command.kind, 'start-focus')
  })
})
