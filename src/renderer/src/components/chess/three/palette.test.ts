import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DARK_SQUARE, DEFAULT_PALETTE, LIGHT_SQUARE, contrastBetween, luminanceOf, normaliseColour, pieceSeparation,
  readPalette
} from './palette.ts'

test('the squares are the flat board\'s own two colours', () => {
  // So switching between the two boards looks like one board rather than two.
  assert.equal(LIGHT_SQUARE, '#b9c6d4')
  assert.equal(DARK_SQUARE, '#4f6076')
  assert.equal(DEFAULT_PALETTE.light, LIGHT_SQUARE)
  assert.equal(DEFAULT_PALETTE.dark, DARK_SQUARE)
})

test('a colour three.js can read is kept as it is', () => {
  for (const value of [
    '#fff', '#ffffff', '#3fd8ff', '#3fd8ffcc', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)',
    'hsl(200, 50%, 40%)', 'hsla(200, 50%, 40%, 0.5)', 'rebeccapurple', 'white'
  ]) {
    assert.equal(normaliseColour(value, '#000'), value, `${value} was refused`)
  }
  // Whitespace round a token read off the page is normal and must not change the answer.
  assert.equal(normaliseColour('  #3fd8ff  ', '#000'), '#3fd8ff')
})

test('a colour three.js cannot read falls back rather than coming out black', () => {
  /*
   * The reason this is a test of its own: handing three.js a colour it does not understand does not fail. It warns
   * to the console and leaves the material black -- and a chessboard whose accent marks have all gone black looks
   * like a bug in the chess rather than a bug in a colour.
   */
  for (const value of [
    'oklch(0.7 0.2 200)', 'oklab(0.7 0.1 0.1)', 'lch(70% 40 200)', 'lab(70% 20 -30)',
    'color(display-p3 0.5 0.5 0.5)', 'color-mix(in srgb, red 50%, blue)', 'light-dark(#fff, #000)',
    'hwb(200 20% 30%)', 'currentcolor', 'inherit', 'transparent', 'none', 'unset', '', '   ',
    '#ff', '#ffffffff0', 'var(--something)', '42'
  ]) {
    assert.equal(normaliseColour(value, '#abcdef'), '#abcdef', `${JSON.stringify(value)} was let through`)
  }
  assert.equal(normaliseColour(null, '#abcdef'), '#abcdef')
  assert.equal(normaliseColour(undefined, '#abcdef'), '#abcdef')
})

test('only the accent and the frame are taken from the theme', () => {
  const theme = readPalette((token) => ({
    '--cyan': '#ff00ff',
    '--bg-mid': '#102030',
    '--text': '#fefefe'
  }[token] ?? ''))
  assert.equal(theme.mark, '#ff00ff')
  assert.equal(theme.frame, '#102030')
  assert.equal(theme.frameText, '#fefefe')
  /*
   * The squares, the pieces and the check colour are fixed on purpose. They have to hold their contrast against
   * each other whatever a theme does, and a theme that turned the light squares dark would make the board
   * unreadable without anything reporting a fault.
   */
  assert.equal(theme.light, LIGHT_SQUARE)
  assert.equal(theme.dark, DARK_SQUARE)
  assert.equal(theme.whitePiece, DEFAULT_PALETTE.whitePiece)
  assert.equal(theme.blackPiece, DEFAULT_PALETTE.blackPiece)
  assert.equal(theme.danger, DEFAULT_PALETTE.danger)
})

test('a theme that says nothing leaves every colour as it was', () => {
  assert.deepEqual(readPalette(() => ''), DEFAULT_PALETTE)
  assert.deepEqual(readPalette(() => 'oklch(0.7 0.2 200)'), DEFAULT_PALETTE)
})

test('the real Orbis accent is one three.js can read', () => {
  // Both themes, taken from src/renderer/src/styles/tokens.generated.css.
  for (const accent of ['#3fd8ff', '#0a7fb3']) {
    assert.equal(normaliseColour(accent, '#000'), accent)
    assert.equal(readPalette((token) => (token === '--cyan' ? accent : '')).mark, accent)
  }
})

test('every piece stands at least three to one against every square', () => {
  /*
   * The one readability check that can be done with arithmetic rather than eyes, and the one that found a real
   * fault: the first version of this board had white pieces at 1.6 to 1 against the light squares, which is under
   * anything meant to be seen. No shade of white fixes it, so the pieces grew a band at the foot instead, dark
   * under white and light under black, and this is what holds it.
   */
  for (const pair of pieceSeparation()) {
    assert.ok(pair.best !== null, `${pair.piece} on ${pair.square} could not be measured at all`)
    assert.ok(
      pair.best >= 3,
      `a ${pair.piece} piece on a ${pair.square} square is only ${pair.best.toFixed(2)} to 1`
      + ` (body ${pair.body?.toFixed(2)}, collar ${pair.rim?.toFixed(2)})`
    )
  }
})

test('the two hard pairings are the ones the collar carries, and the other two do not need it', () => {
  // Said explicitly, so that if somebody changes a colour the test says which mechanism they broke.
  const by = (piece: string, square: string): ReturnType<typeof pieceSeparation>[number] => {
    const found = pieceSeparation().find((one) => one.piece === piece && one.square === square)
    assert.ok(found)
    return found
  }
  const whiteOnLight = by('white', 'light')
  assert.ok(whiteOnLight.body !== null && whiteOnLight.body < 2, 'a white piece on a light square is no longer the hard case')
  assert.ok(whiteOnLight.rim !== null && whiteOnLight.rim >= 3, 'the collar no longer carries a white piece on a light square')
  const blackOnDark = by('black', 'dark')
  assert.ok(blackOnDark.body !== null && blackOnDark.body < 3, 'a black piece on a dark square is no longer the hard case')
  assert.ok(blackOnDark.rim !== null && blackOnDark.rim >= 3, 'the collar no longer carries a black piece on a dark square')
  // The easy two pass on the body alone, so the collar there is only tidiness.
  assert.ok((by('white', 'dark').body ?? 0) >= 3)
  assert.ok((by('black', 'light').body ?? 0) >= 3)
  // And the two sides are nothing like each other, which is the easiest check of all.
  const pieces = contrastBetween(DEFAULT_PALETTE.whitePiece, DEFAULT_PALETTE.blackPiece)
  assert.ok(pieces !== null && pieces > 12, 'the two sides are too close in colour')
  const collars = contrastBetween(DEFAULT_PALETTE.rimOnWhite, DEFAULT_PALETTE.rimOnBlack)
  assert.ok(collars !== null && collars > 5, 'the two collars are too close in colour')
})

test('the two square colours are clearly different from each other', () => {
  const squares = contrastBetween(LIGHT_SQUARE, DARK_SQUARE)
  assert.ok(squares !== null && squares > 2.5, `the squares are only ${squares?.toFixed(2)} apart`)
})

test('brightness is worked out for hex and refused for anything else', () => {
  assert.equal(luminanceOf('#000000'), 0)
  assert.equal(luminanceOf('#ffffff'), 1)
  const grey = luminanceOf('#808080')
  assert.ok(grey !== null && grey > 0.2 && grey < 0.3)
  assert.equal(luminanceOf('#fff'), 1)
  // Not every colour can be measured, and saying so beats guessing.
  assert.equal(luminanceOf('rgb(0,0,0)'), null)
  assert.equal(luminanceOf('white'), null)
  assert.equal(luminanceOf('#ffff'), null)
  assert.equal(contrastBetween('#000', 'white'), null)
})
