import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CHESS_SETTINGS, formatForSettings, withField } from './settings.ts'
import { barReading, hasFill, topShare } from './evalBar.ts'

/**
 * The one that matters.
 *
 * A bar drawn half full for a position nothing has looked at is a program telling somebody the engine judged it
 * level. It is the single most believable lie a chess screen can tell, because it looks exactly like the truth.
 */
test('a score that was never produced is not a bar at the middle', () => {
  const reading = barReading({ kind: 'none' })
  assert.equal(reading.kind, 'unknown')
  assert.equal(hasFill(reading), false, 'there is a fill to draw for a score nobody worked out')
  assert.equal(topShare(reading, 'w'), 0, 'the strip has a filled part')
  assert.match(reading.say, /No score has been worked out/)
  assert.match(reading.say, /rather than level/)
  // And the number it shows is a dash, never a zero.
  assert.equal(reading.shown, '—')
  assert.ok(!reading.shown.includes('0'), `"${reading.shown}" reads as a score of nothing`)
})

test('a level position is not the same thing as an unknown one', () => {
  const level = barReading({ kind: 'cp', cp: 0 })
  assert.equal(level.kind, 'score')
  assert.equal(hasFill(level), true)
  assert.equal(level.shown, '0.00')
  assert.match(level.say, /level/)
})

test('a forced mate fills the bar for the side that has it and is never turned into pawns', () => {
  const white = barReading({ kind: 'mate', moves: 3 })
  assert.equal(white.kind, 'mate')
  assert.equal(hasFill(white) && white.whiteShare, 1)
  assert.match(white.say, /White has a forced mate in 3 moves/)
  assert.ok(!/\d\.\d\d/.test(white.say), `a mate was described in pawns: ${white.say}`)

  const black = barReading({ kind: 'mate', moves: -1 })
  assert.equal(hasFill(black) && black.whiteShare, 0)
  assert.match(black.say, /Black has a forced mate in 1 move\./, 'one move was described as "1 moves"')
})

test('the words a person chose for a mate are the words the bar shows', () => {
  // The settings decide how a score reads; the bar is handed the result rather than inventing its own form.
  const spelt = formatForSettings({ kind: 'mate', moves: 3 }, DEFAULT_CHESS_SETTINGS, 'w')
  assert.equal(barReading({ kind: 'mate', moves: 3 }, { text: spelt }).shown, 'mate in 3')
  const short = formatForSettings({ kind: 'mate', moves: 3 }, withField(DEFAULT_CHESS_SETTINGS, 'analysis.mateInWords', false), 'w')
  assert.equal(barReading({ kind: 'mate', moves: 3 }, { text: short }).shown, 'M3')
  const hundredths = withField(DEFAULT_CHESS_SETTINGS, 'analysis.unit', 'hundredths')
  assert.equal(barReading({ kind: 'cp', cp: 124 }, { text: formatForSettings({ kind: 'cp', cp: 124 }, hundredths, 'w') }).shown, '+124')
})

test('mate already on the board says the game is over rather than drawing an advantage', () => {
  const unknownSide = barReading({ kind: 'mate', moves: 0 })
  assert.equal(unknownSide.kind, 'over')
  assert.equal(hasFill(unknownSide), false, 'a score of mate in 0 was given a side it does not name')
  assert.match(unknownSide.say, /This position is mate/)

  // Told whose turn it is, the winner is whoever does not have to move, and that much can be drawn.
  const told = barReading({ kind: 'mate', moves: 0 }, { toMove: 'w' })
  assert.equal(told.kind, 'mate')
  assert.equal(hasFill(told) && told.whiteShare, 0, 'the side that has to move is the side that was mated')
  assert.match(told.say, /Black has mated/)
})

test('a bigger advantage is a longer bar, and nothing but a mate reaches the end', () => {
  const share = (cp: number): number => {
    const reading = barReading({ kind: 'cp', cp })
    assert.ok(hasFill(reading))
    return reading.whiteShare
  }
  const steps = [-2000, -800, -300, -100, 0, 100, 300, 800, 2000]
  for (let index = 1; index < steps.length; index++) {
    assert.ok(share(steps[index]) > share(steps[index - 1]), `${steps[index]} did not read as better than ${steps[index - 1]}`)
  }
  assert.equal(share(0), 0.5, 'a level position is the middle of the bar')
  assert.ok(share(2000) < 1, 'an ordinary advantage reached the end of the bar, where only a mate belongs')
  assert.ok(share(-2000) > 0)
  assert.equal(share(100_000), share(2000), 'a huge number is clamped rather than overflowing the bar')
})

test('the bar turns round with the board, so nobody reads it upside down', () => {
  const white = barReading({ kind: 'cp', cp: 400 })
  // White a long way ahead: from White's side most of the strip is at the bottom, so little of it is at the top.
  const fromWhite = topShare(white, 'w')
  const fromBlack = topShare(white, 'b')
  assert.ok(fromWhite < 30, `${fromWhite}% of the strip was given to Black at the top`)
  assert.equal(Math.round(fromWhite + fromBlack), 100, 'the two sides of the board do not agree about one score')
})

test('every reading says something a person can read, whatever kind it is', () => {
  const readings = [
    barReading({ kind: 'none' }),
    barReading({ kind: 'cp', cp: -250 }),
    barReading({ kind: 'mate', moves: 2 }),
    barReading({ kind: 'mate', moves: 0 })
  ]
  for (const reading of readings) {
    assert.ok(reading.say.length > 20, `a reading has nothing to say: ${reading.say}`)
    assert.match(reading.say, /[.!]$/, `"${reading.say}" is not a sentence`)
    assert.ok(reading.shown.length > 0, 'a reading has no number to show beside the bar')
  }
})
