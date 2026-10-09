import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CLUE_WORDS, asSyllabus, topicsIn } from './material.ts'
import { readSyllabus } from './graph.ts'

/**
 * Finding topics in a student's own material.
 *
 * The tests worth having are the ones that prove it does not invent: prose stays prose, a sentence is not a topic,
 * and an empty answer is an answer.
 */

describe('finding topics in material', () => {
  it('says there is nothing to read rather than returning an empty list', () => {
    const out = topicsIn('')
    assert.equal(out.candidates.length, 0)
    assert.equal(out.lines, 0)
    assert.match(out.note, /nothing to read/i)
  })

  it('finds numbered lines, and strips the numbering', () => {
    const out = topicsIn(['3.1 Projectile motion', '3.2 Relative velocity'].join('\n'))
    assert.deepEqual(
      out.candidates.map((one) => one.name),
      ['Projectile motion', 'Relative velocity']
    )
    assert.ok(out.candidates.every((one) => one.clue === 'numbered'))
  })

  it('finds headings, including a line in capitals', () => {
    const out = topicsIn(['## Kinematics', 'FORCES AND FRICTION'].join('\n'))
    assert.deepEqual(
      out.candidates.map((one) => one.name),
      ['Kinematics', 'FORCES AND FRICTION']
    )
    assert.ok(out.candidates.every((one) => one.clue === 'headed'))
  })

  it('leaves prose alone', () => {
    const prose = [
      'When an object is thrown it follows a curved path, because the horizontal and vertical parts of its motion are',
      'independent of each other. This is the single most useful idea in the whole chapter and it comes up in every',
      'question about projectiles.'
    ].join('\n')
    const out = topicsIn(prose)
    assert.equal(out.candidates.length, 0)
    assert.match(out.note, /looked like a topic heading/i)
  })

  it('does not take a whole sentence as a topic, even a bulleted one', () => {
    const out = topicsIn('- The vertical and horizontal parts of the motion are completely independent of each other.')
    assert.equal(out.candidates.length, 0)
  })

  it('takes a short bullet as a topic', () => {
    const out = topicsIn(['- Projectile motion', '- Relative velocity'].join('\n'))
    assert.equal(out.candidates.length, 2)
    assert.ok(out.candidates.every((one) => one.clue === 'bulleted'))
  })

  it('takes the words before a colon', () => {
    const out = topicsIn('Projectile motion: the curved path of something thrown')
    assert.equal(out.candidates[0].name, 'Projectile motion')
    assert.equal(out.candidates[0].clue, 'colon')
  })

  it('treats a short line between long ones as the weakest clue', () => {
    const out = topicsIn(
      [
        'This paragraph is deliberately long enough to count as prose, going well past seventy characters so that it does.',
        'Friction',
        'And here is another long paragraph, also comfortably past seventy characters, so the short line sits between two.'
      ].join('\n')
    )
    const found = out.candidates.find((one) => one.name === 'Friction')
    assert.ok(found)
    assert.equal(found?.clue, 'short-line')
    // Weakest of all the clues, and ordered last among them.
    assert.ok((found?.confidence ?? 1) < 0.5)
  })

  it('does not call a short line a topic when everything is short', () => {
    const out = topicsIn(['one', 'two', 'three'].join('\n'))
    assert.equal(out.candidates.filter((one) => one.clue === 'short-line').length, 0)
  })

  it('says which line each one came from, so it can be checked against the notes', () => {
    const out = topicsIn(['intro text here', '## Kinematics', 'more text'].join('\n'))
    assert.equal(out.candidates[0].line, 2)
  })

  it('never lists the same topic twice', () => {
    const out = topicsIn(['## Kinematics', '1. Kinematics', '- kinematics'].join('\n'))
    assert.equal(out.candidates.length, 1)
  })

  it('orders the strongest clues first', () => {
    const out = topicsIn(['- Friction', '## Kinematics'].join('\n'))
    assert.equal(out.candidates[0].name, 'Kinematics')
  })

  it('has a plain word for every clue it can report', () => {
    const out = topicsIn(['## A', '1. B', '- C', 'D: something'].join('\n'))
    assert.ok(out.candidates.every((one) => typeof CLUE_WORDS[one.clue] === 'string'))
  })

  it('ignores page numbers and stray symbols', () => {
    const out = topicsIn(['12', '---', '***'].join('\n'))
    assert.equal(out.candidates.length, 0)
  })
})

describe('adding what was ticked', () => {
  it('writes the ticked topics as a syllabus the importer understands', () => {
    const text = asSyllabus('Physics', 'Kinematics', ['Velocity', 'Acceleration'])
    const read = readSyllabus(text)
    assert.equal(read.graph.chapters.length, 1)
    assert.deepEqual(
      read.graph.concepts.map((one) => one.name),
      ['Velocity', 'Acceleration']
    )
    assert.equal(read.graph.chapters[0].subject, 'Physics')
  })

  it('falls back to plain names rather than losing the topics', () => {
    const read = readSyllabus(asSyllabus('', '', ['Velocity']))
    assert.equal(read.graph.concepts.length, 1)
    assert.equal(read.graph.chapters[0].subject, 'General')
  })

  it('drops an empty tick rather than adding a nameless topic', () => {
    const read = readSyllabus(asSyllabus('Physics', 'Kinematics', ['Velocity', '   ', '']))
    assert.equal(read.graph.concepts.length, 1)
  })
})
