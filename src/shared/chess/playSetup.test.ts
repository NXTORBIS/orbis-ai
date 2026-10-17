import { strict as assert } from 'node:assert'
import test from 'node:test'
import { timeControl, timeControlById, UNTIMED } from './clock.ts'
import {
  barFor,
  browsing,
  browsingWords,
  clockFamilies,
  colourName,
  colourWords,
  FAMILY_ORDER,
  setupChips,
  sideFor
} from './playSetup.ts'
import type { Score } from './evaluation.ts'

const cp = (value: number): Score => ({ kind: 'cp', cp: value })
const nothing: Score = { kind: 'none' }

test('the clocks are grouped fastest first, with no clock at all last', () => {
  const families = clockFamilies()
  const kinds = families.map((one) => one.kind)
  assert.deepEqual(kinds, FAMILY_ORDER.filter((kind) => kinds.includes(kind)))
  assert.equal(kinds.at(-1), 'untimed')
  // Every clock Orbis offers lands in exactly one family.
  const counted = families.reduce((total, one) => total + one.controls.length, 0)
  assert.equal(counted, 13)
})

test('a family with nothing in it is left out rather than drawn empty', () => {
  const families = clockFamilies([UNTIMED, timeControl(180, 2)])
  assert.deepEqual(families.map((one) => one.kind), ['blitz', 'untimed'])
  assert.equal(families[0].name, 'Blitz')
})

test('a chosen colour is given back unchanged, whatever the roll', () => {
  assert.equal(sideFor('w', 0.99), 'w')
  assert.equal(sideFor('b', 0.01), 'b')
})

test('Either picks a colour from the roll, the same way a game really starts', () => {
  assert.equal(sideFor('random', 0), 'w')
  assert.equal(sideFor('random', 0.49), 'w')
  assert.equal(sideFor('random', 0.5), 'b')
  assert.equal(sideFor('random', 1), 'b')
  // A roll that is not a number is not allowed to decide anything by accident.
  assert.equal(sideFor('random', Number.NaN), 'w')
})

test('the colour is said out loud, and Either says it was chosen for you', () => {
  assert.equal(colourWords('b', 'b'), 'You are playing Black.')
  assert.equal(colourWords('random', 'b'), 'You asked Orbis to choose, and it gave you Black.')
  assert.equal(colourName('w'), 'White')
})

test('the setup is four chips, and Either keeps its explanation as a tooltip', () => {
  const chips = setupChips({
    opponent: 'Pebble',
    opponentAbout: 'Turned down a long way.',
    colour: 'random',
    clock: timeControlById('180+2') ?? timeControl(180, 2),
    help: 'No help'
  })
  assert.deepEqual(chips.map((one) => one.label), ['Opponent', 'You play', 'Clock', 'Help'])
  assert.equal(chips[1].value, 'Either')
  assert.equal(typeof chips[1].title, 'string')
  assert.equal(chips[2].value, '3 + 2')
  // Nothing is invented for a fact nobody gave a longer version of.
  assert.equal(chips[3].title, undefined)
})

test('a chosen colour chip carries no tooltip, because there is nothing more to say', () => {
  const chips = setupChips({ opponent: 'Flint', colour: 'w', clock: UNTIMED, help: 'A nudge' })
  assert.equal(chips[1].value, 'White')
  assert.equal(chips[1].title, undefined)
  assert.equal(chips[2].value, 'Untimed')
})

test('the bar is drawn only when it is switched on and a real score for this position exists', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  assert.equal(barFor({ wanted: false, score: { score: cp(30), fen }, fen }), null)
  assert.equal(barFor({ wanted: true, score: null, fen }), null)
  // A score about a different position is never shown under this one.
  assert.equal(barFor({ wanted: true, score: { score: cp(30), fen: 'other' }, fen }), null)
  // Nothing has been calculated, so there is nothing to draw.
  assert.equal(barFor({ wanted: true, score: { score: nothing, fen }, fen }), null)
  assert.deepEqual(barFor({ wanted: true, score: { score: cp(30), fen, text: '+0.30' }, fen }), {
    score: cp(30),
    text: '+0.30'
  })
})

test('looking back at an earlier move is not the same as playing', () => {
  assert.equal(browsing(30, 30), false)
  assert.equal(browsing(4, 30), true)
  assert.equal(browsingWords(30, 30), null)
  assert.equal(browsingWords(4, 30), 'You are looking back at move 4 of 30. Go to the last move to play on.')
})
