import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MOST_QUESTIONS, SOCRATIC_SYSTEM, advance, evidenceFor, firstPrompt, isBlank, newConversation, readReply, sayEnd, turnsPrompt } from './socratic.ts'
import { CANNOT_READ, PHOTO_SYSTEM, asSyllabusLines, readPhoto, whatNext } from './photo.ts'

/**
 * The tutor that asks, and reading a photograph.
 *
 * Every test here is about a limit: the questioning stops, the student can always leave, a model cannot talk its
 * way past the cap, and nothing in either feature marks the student's work.
 */

const reply = (say: string, asking = true, done = false): { say: string; asking: boolean; done: boolean } => ({ say, asking, done })

describe('the tutor that asks', () => {
  it('starts with nothing said and nothing asked', () => {
    const one = newConversation('c', 'Velocity')
    assert.equal(one.turns.length, 0)
    assert.equal(one.asked, 0)
    assert.equal(one.ended, null)
  })

  it('reads a reply, and refuses an empty one', () => {
    assert.deepEqual(readReply({ say: 'What happens to its speed?', asking: true, done: false }), {
      say: 'What happens to its speed?',
      asking: true,
      done: false
    })
    assert.equal(readReply({ say: '' }), null)
    assert.equal(readReply(null), null)
    assert.equal(readReply('a string'), null)
  })

  it('counts only the questions, not the turns', () => {
    let held = newConversation('c', 'Velocity')
    held = advance(held, 'I think so', reply('Right. And then?', true)).conversation
    held = advance(held, 'Yes', reply('Good — nothing is pushing it.', false)).conversation
    assert.equal(held.asked, 1)
  })

  it('stops after six questions and tells them instead', () => {
    let held = newConversation('c', 'Velocity')
    let stop: string | null = null
    for (let i = 0; i < MOST_QUESTIONS + 2 && !stop; i += 1) {
      const out = advance(held, `answer ${i}`, reply(`question ${i}`, true))
      held = out.conversation
      stop = out.stop
    }
    assert.equal(stop, 'told')
    assert.equal(held.asked, MOST_QUESTIONS)
  })

  it('cannot be talked past the cap by a model that keeps asking', () => {
    // The cap is Orbis's rule, applied to whatever the model sends.
    let held = { ...newConversation('c', 'Velocity'), asked: MOST_QUESTIONS - 1 }
    const out = advance(held, 'maybe', reply('One more question?', true, false))
    assert.equal(out.stop, 'told')
  })

  it('stops after two blanks in a row, and blames the questions', () => {
    let held = newConversation('c', 'Velocity')
    held = advance(held, "I don't know", reply('Think about what is pushing it.')).conversation
    const out = advance(held, 'no idea', reply('Another question'))
    assert.equal(out.stop, 'gave-up')
    assert.match(out.say, /let me just tell you/i)
    assert.match(sayEnd('gave-up'), /not the right way in/i)
  })

  it('does not count two blanks that were not in a row', () => {
    let held = newConversation('c', 'Velocity')
    held = advance(held, 'dunno', reply('Try this instead.')).conversation
    held = advance(held, 'it stays the same', reply('Right. And why?')).conversation
    const out = advance(held, 'not sure', reply('Here is a smaller step.'))
    assert.equal(out.stop, null)
  })

  it('knows a blank from an answer', () => {
    for (const blank of ['', '   ', 'I dont know', "i don't know", 'no idea', 'idk', '?']) assert.equal(isBlank(blank), true, blank)
    for (const answer of ['it stays the same', 'gravity', 'no, because nothing pushes it']) assert.equal(isBlank(answer), false, answer)
  })

  it('finishes when the student has said it themselves', () => {
    const out = advance(newConversation('c', 'Velocity'), 'the sideways speed never changes', reply('That is it.', false, true))
    assert.equal(out.stop, 'got-there')
    assert.equal(out.conversation.ended, 'got-there')
  })

  it('tells them when nothing comes back, rather than leaving them there', () => {
    const out = advance(newConversation('c', 'Velocity'), 'I think so', null)
    assert.equal(out.stop, 'told')
    assert.match(out.say, /tell you/i)
  })

  it('records understanding when they got there, exposure when told, and nothing when they gave up', () => {
    assert.equal(evidenceFor('got-there'), 'explained')
    assert.equal(evidenceFor('told'), 'read')
    // Not a failure: the questions were wrong for them, and that is not evidence about the student.
    assert.equal(evidenceFor('gave-up'), null)
    assert.equal(evidenceFor('left'), null)
    assert.equal(evidenceFor(null), null)
  })

  it('never calls getting there recall', () => {
    // They produced it with scaffolding. Recall means producing it without.
    assert.notEqual(evidenceFor('got-there'), 'recalled')
  })

  it('tells the model to ask one question and never to give the answer', () => {
    assert.match(SOCRATIC_SYSTEM, /exactly one question per reply/i)
    assert.match(SOCRATIC_SYSTEM, /never give the answer/i)
    assert.match(SOCRATIC_SYSTEM, /never say they are wrong/i)
    // It forbids praise rather than asking for it: a tutor that cheers at every answer is one people switch off.
    assert.match(SOCRATIC_SYSTEM, /no praise, no encouragement/i)
  })

  it('builds the first question from what they already know', () => {
    const prompt = firstPrompt({ topic: 'Projectiles', subject: 'Physics', band: 'older-teen', missing: 'cannot use it', knows: ['Velocity', 'Acceleration'] })
    assert.match(prompt, /Velocity/)
    assert.match(prompt, /build from these/i)
  })

  it('shows the model the conversation and nothing else about the student', () => {
    const held = advance(newConversation('c', 'Velocity'), 'it stays the same', reply('Why?')).conversation
    const prompt = turnsPrompt(held)
    assert.match(prompt, /Student: it stays the same/)
    assert.ok(!/xp|streak|level|mastery/i.test(prompt))
  })
})

describe('reading a photograph', () => {
  it('is nothing when there is nothing readable', () => {
    assert.equal(readPhoto(null), null)
    assert.equal(readPhoto({ kind: 'notes', words: '', topics: [] }), null)
  })

  it('keeps the words as written, without correcting them', () => {
    const out = readPhoto({ kind: 'notes', words: 'velosity = change in position / time', topics: ['Velocity'] })
    assert.equal(out?.words, 'velosity = change in position / time')
  })

  it('says what could not be read rather than skipping it quietly', () => {
    const out = readPhoto({ kind: 'notes', words: 'Some of it', topics: [], unreadable: 'the bottom third is blurred' })
    assert.match(out?.unreadable ?? '', /blurred/)
  })

  it('falls back to notes for a kind it does not know', () => {
    assert.equal(readPhoto({ kind: 'interpretive-dance', words: 'Some words here', topics: [] })?.kind, 'notes')
  })

  it('never offers to mark the work', () => {
    const out = readPhoto({ kind: 'worked-answer', words: 'x'.repeat(100), topics: ['Velocity'] })
    assert.ok(out)
    const offers = whatNext(out)
    assert.ok(!offers.some((one) => /mark|right|wrong|correct|grade/i.test(one.label)), JSON.stringify(offers))
  })

  it('offers what fits what the picture turned out to be', () => {
    const notes = readPhoto({ kind: 'notes', words: 'x'.repeat(100), topics: ['Velocity'] })
    const offers = whatNext(notes!).map((one) => one.action)
    assert.ok(offers.includes('cards'))
    assert.ok(offers.includes('syllabus'))

    const thin = readPhoto({ kind: 'notes', words: 'short', topics: [] })
    assert.deepEqual(whatNext(thin!), [])
  })

  it('tells the model not to mark anything', () => {
    assert.match(PHOTO_SYSTEM, /never say whether the work is right or wrong/i)
    assert.match(PHOTO_SYSTEM, /do not correct/i)
  })

  it('turns ticked topics into a syllabus the importer understands', () => {
    const lines = asSyllabusLines('Physics', 'From a photo', ['Velocity', 'Acceleration']).split('\n')
    assert.deepEqual(lines, ['Physics', '  From a photo', '    Velocity', '    Acceleration'])
  })

  it('says what to do about a picture it could not read, without blaming anybody', () => {
    assert.match(CANNOT_READ, /closer, flatter photo/i)
    assert.ok(!/you did|your fault|badly/i.test(CANNOT_READ))
  })
})
