import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILT_IN_THEMES,
  builtInTheme,
  cleanTokens,
  contrast,
  copyOfBuiltIn,
  isThemeToken,
  newTheme,
  readColour,
  readability,
  THEME_TOKENS,
  themeChanges,
  themeExists,
  themeName,
  themeTokens
} from '../shared/themes.ts'

test('every theme Orbis ships with is real, named, and sets only tokens Orbis uses', () => {
  assert.ok(BUILT_IN_THEMES.length >= 4)
  assert.equal(new Set(BUILT_IN_THEMES.map((t) => t.id)).size, BUILT_IN_THEMES.length)
  assert.ok(BUILT_IN_THEMES.some((t) => t.base === 'light'), 'there is a light theme, not only dark ones')
  for (const theme of BUILT_IN_THEMES) {
    assert.ok(theme.name && theme.description, `${theme.id} says what it is`)
    for (const token of Object.keys(theme.tokens)) assert.ok(isThemeToken(token), `${theme.id} only sets tokens Orbis uses (${token})`)
    // A theme is kept exactly as written: nothing is dropped when it is read back.
    assert.deepEqual(cleanTokens(theme.tokens), theme.tokens, `${theme.id} survives being read back`)
  }
})

test('every theme Orbis ships with is readable on its own background', () => {
  for (const theme of BUILT_IN_THEMES) {
    assert.deepEqual(readability(theme.tokens), [], `${theme.name} is readable`)
  }
})

test('a colour is read from the forms Orbis actually uses, and nonsense is refused', () => {
  assert.deepEqual(readColour('#fff'), { r: 255, g: 255, b: 255, a: 1 })
  assert.deepEqual(readColour('#3fd8ff'), { r: 63, g: 216, b: 255, a: 1 })
  assert.deepEqual(readColour('rgba(255, 255, 255, 0.5)'), { r: 255, g: 255, b: 255, a: 0.5 })
  assert.equal(readColour('linear-gradient(red, blue)'), null)
  assert.equal(readColour('rgb(300, 0, 0)'), null, 'a channel beyond 255 is not a colour')

  assert.equal(Math.round(contrast('#ffffff', '#000000')!), 21)
  assert.equal(contrast('#000000', '#000000'), 1)
  assert.equal(contrast('nonsense', '#000000'), null)
})

test('a theme that cannot be read says so, plainly, rather than being refused', () => {
  const bad = readability({ 'bg-center': '#101010', text: '#1a1a1a', muted: '#202020' })
  assert.ok(bad.some((n) => n.token === 'text' && n.severity === 'hard'), 'nearly invisible text is called out as hard')
  assert.ok(bad.every((n) => n.ratio > 0 && n.label))

  // Something merely tight is described differently from something unreadable.
  const tight = readability({ 'bg-center': '#000000', text: '#6a6a6a' })
  assert.equal(tight.length, 1)
  assert.equal(tight[0].severity, 'tight')

  assert.deepEqual(readability({ 'bg-center': '#000000', text: '#ffffff' }), [])
})

test('a theme only ever carries colours: anything that could reach outside Orbis is dropped', () => {
  const tokens = cleanTokens({
    text: '#ffffff',
    'bg-center': "url('https://example.com/tracker.png')",
    grid: 'expression(alert(1))',
    hover: 'javascript:alert(1)',
    'not-a-real-token': '#ff0000',
    muted: 'x'.repeat(500),
    faint: 42
  })
  assert.deepEqual(tokens, { text: '#ffffff' })
})

test('a theme of your own can start from one of Orbis’s, and Orbis’s own are never changed', () => {
  const midnight = builtInTheme('orbis-midnight')!
  const mine = copyOfBuiltIn(midnight, 1000)
  assert.equal(mine.base, midnight.base)
  assert.deepEqual(mine.tokens, midnight.tokens)
  assert.notEqual(mine.id, midnight.id)
  assert.match(mine.name, /Midnight/)

  mine.tokens.text = '#ff0000'
  assert.equal(builtInTheme('orbis-midnight')!.tokens.text, midnight.tokens.text === '#ff0000' ? '#ff0000' : builtInTheme('orbis-midnight')!.tokens.text)
  assert.notEqual(builtInTheme('orbis-midnight')!.tokens.text, '#ff0000', 'changing a copy leaves Orbis’s own alone')

  const blank = newTheme('   ', 'dark', {}, 1000)
  assert.equal(blank.name, 'My theme', 'a theme with no name still has one')
})

test('Orbis knows which theme is in use, whether it is one of its own or one of yours', () => {
  const mine = [newTheme('Mine', 'dark', { text: '#ffffff' }, 1000)]
  assert.deepEqual(themeTokens(null, mine), {}, 'no theme means Orbis’s own colours, with nothing set')
  assert.deepEqual(themeTokens('orbis-ember', mine), builtInTheme('orbis-ember')!.tokens)
  assert.deepEqual(themeTokens(mine[0].id, mine), { text: '#ffffff' })
  assert.deepEqual(themeTokens('a-theme-that-was-deleted', mine), {}, 'a theme that is gone leaves Orbis as it was')

  assert.equal(themeName('orbis-forest', mine), 'Forest')
  assert.equal(themeName(mine[0].id, mine), 'Mine')
  assert.equal(themeName(null, mine), null)
  assert.equal(themeExists('orbis-forest', mine), true)
  assert.equal(themeExists('gone', mine), false)
})

test('a theme says how much it really changes, so “barely anything” is not sold as a new look', () => {
  const orbisText = THEME_TOKENS.find((t) => t.name === 'text')!.orbis
  assert.equal(themeChanges({ text: orbisText }), 0, 'setting a token to what Orbis already uses changes nothing')
  assert.equal(themeChanges({ text: '#ff0000', cyan: '#00ff00' }), 2)
})
