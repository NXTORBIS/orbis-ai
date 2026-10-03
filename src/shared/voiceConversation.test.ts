import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { endingNote, next, OFF, QUIET_TURNS_BEFORE_STOPPING, saidStop, shouldListen, shouldSpeak, statusOf, type Conversation, type ConversationEvent } from './voiceConversation.ts'

/**
 * Voice was push-to-talk and nothing else: hold, speak, let go, read. That is dictation. A conversation is the loop --
 * you speak, it answers out loud, it listens again -- and the loop did not exist.
 */

const after = (events: ConversationEvent[], from: Conversation = OFF): Conversation => events.reduce(next, from)

test('a whole turn goes round and comes back to listening', () => {
  const end = after([{ type: 'start' }, { type: 'heard', text: 'what is the weather' }, { type: 'answering' }, { type: 'answered', text: 'It is raining.' }, { type: 'spoke-to-the-end' }])
  assert.equal(end.state, 'listening', 'it listens again without being asked; that is the whole feature')
  assert.equal(end.ended, null)
})

test('it never listens while it is speaking', () => {
  const speaking = after([{ type: 'start' }, { type: 'heard', text: 'hello' }, { type: 'answering' }, { type: 'answered', text: 'Hello.' }])
  assert.equal(speaking.state, 'speaking')
  assert.equal(shouldListen(speaking), false, 'a machine that hears its own voice answers itself')
  assert.equal(shouldSpeak(speaking), true)
})

test('interrupting is somebody wanting to speak, not an error, and the conversation goes on', () => {
  const after2 = after([{ type: 'start' }, { type: 'heard', text: 'hello' }, { type: 'answering' }, { type: 'answered', text: 'Hello.' }, { type: 'interrupted' }])
  assert.equal(after2.state, 'listening')
  assert.equal(after2.ended, null)
})

test('saying stop stops it, rather than being answered', () => {
  for (const word of ['stop', 'that’s all', 'goodbye', 'never mind', 'Cancel.']) {
    const end = after([{ type: 'start' }, { type: 'heard', text: word }])
    assert.equal(end.state, 'off', word)
    assert.equal(end.ended, 'asked', word)
  }
})

test('something that merely contains the word stop is a question, not a command', () => {
  assert.equal(saidStop('what time does the bus stop running'), false)
  assert.equal(saidStop('stop'), true)
})

test('silence twice over means nobody is there, and it stops', () => {
  let one = after([{ type: 'start' }])
  for (let i = 0; i < QUIET_TURNS_BEFORE_STOPPING; i++) one = next(one, { type: 'nothing-heard' })
  assert.equal(one.state, 'off')
  assert.equal(one.ended, 'nobody-there')
  assert.ok(endingNote(one)?.includes('stopped listening'))
})

test('one quiet moment is not somebody leaving', () => {
  const one = after([{ type: 'start' }, { type: 'nothing-heard' }])
  assert.equal(one.state, 'listening')
  assert.equal(one.quietTurns, 1)
  assert.equal(statusOf(one), 'Still listening')
})

test('stop works from every state there is, so there is no way to be stuck in one', () => {
  const states: Conversation[] = [
    OFF,
    after([{ type: 'start' }]),
    after([{ type: 'start' }, { type: 'heard', text: 'hello' }]),
    after([{ type: 'start' }, { type: 'heard', text: 'hello' }, { type: 'answering' }]),
    after([{ type: 'start' }, { type: 'heard', text: 'hello' }, { type: 'answering' }, { type: 'answered', text: 'Hi.' }])
  ]
  for (const one of states) {
    const stopped = next(one, { type: 'stop' })
    assert.equal(stopped.state, 'off', one.state)
    assert.equal(stopped.ended, 'asked', one.state)
  }
})

test('a microphone failure ends it and says so, rather than leaving it listening to nothing', () => {
  const one = next(after([{ type: 'start' }]), { type: 'failed' })
  assert.equal(one.state, 'off')
  assert.ok(endingNote(one)?.includes('went wrong'))
})

test('an answer with nothing in it is not read out', () => {
  const one = after([{ type: 'start' }, { type: 'heard', text: 'hello' }, { type: 'answering' }, { type: 'answered', text: '   ' }])
  assert.equal(one.state, 'listening')
})

test('what is on screen says which half of the turn it is in, including that you may interrupt', () => {
  const speaking = after([{ type: 'start' }, { type: 'heard', text: 'hi' }, { type: 'answering' }, { type: 'answered', text: 'Hello.' }])
  assert.ok(statusOf(speaking)?.includes('interrupt'))
  assert.equal(statusOf(OFF), null)
})

test('an event that does not belong to the state it arrives in changes nothing', () => {
  const listening = after([{ type: 'start' }])
  assert.deepEqual(next(listening, { type: 'spoke-to-the-end' }), listening)
  assert.deepEqual(next(OFF, { type: 'heard', text: 'hello' }), OFF)
})
