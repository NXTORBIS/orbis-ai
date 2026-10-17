import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * The two palettes, measured rather than looked at.
 *
 * ## Why this exists
 *
 * The light theme was rebuilt once already and still read as wrong, and the reason was that every judgement about
 * it had been made by eye. By eye, a mid blue on a pale grey page looks like a link. Measured, it was 3.88:1 --
 * under the 4.5:1 that ordinary text needs -- and so were the dim label colour and the green that says a number
 * went up. Three colours, all of them fine in the dark theme, all of them used as text on hundreds of screens.
 *
 * Nothing in the window notices a contrast that is too low. The page renders, the colour is a real colour, and the
 * only symptom is that people stop reading the small print. So it is counted here, against the numbers in
 * WCAG 2.1: 4.5:1 for ordinary text, 3:1 for large text and for the edges of controls.
 *
 * ## What it checks
 *
 * 1. **Every ink the window writes words in, on every surface it writes them on.** Both palettes, because a value
 *    that is comfortable on near-black is usually far too pale on near-white and the mistake is never caught by
 *    changing one of the two.
 * 2. **The colour that goes ON the accent**, which is the one pairing where the background is the accent itself.
 * 3. **The ladder of surfaces.** Dark steps up from the page towards the viewer and light steps up towards white.
 *    The light palette used to go lighter, then darker, then darker again, inside a twenty-point band with no
 *    white in it, so nothing drawn on it could look raised. A ladder that is not in order is what that looks
 *    like as a number.
 *
 * Running it:
 *
 *   node --test src/shared/themeContrast.test.ts
 */

const REPO = resolve(import.meta.dirname, '..', '..')
const TOKENS = join(REPO, 'orbis-ui/tokens.json')

/** One channel of an sRGB colour, undone back to light. */
function channel(value: number): number {
  const part = value / 255
  return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4)
}

/** How much light a colour sends back, 0 for black and 1 for white. */
function brightness(colour: [number, number, number]): number {
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2])
}

/** A `#rgb` or `#rrggbb` written in the tokens, as three numbers. */
function parse(written: string): [number, number, number] {
  const body = written.trim().replace('#', '')
  const full = body.length === 3 ? body.split('').map((one) => one + one).join('') : body
  assert.equal(full.length, 6, `${written} is not a plain hex colour`)
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [number, number, number]
}

/** The WCAG ratio between two colours, from 1 (the same colour) to 21 (black on white). */
function ratio(one: string, two: string): number {
  const first = brightness(parse(one))
  const second = brightness(parse(two))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** Rounded the way this file reports a ratio, so a message and a threshold agree. */
const shown = (value: number): string => `${Math.round(value * 100) / 100}:1`

type Palette = Record<string, string>

/** The inks the window writes words in, and the floor each one has to clear. */
const INKS: { token: string; floor: number; what: string }[] = [
  { token: 'text', floor: 4.5, what: 'everything the window says' },
  { token: 'muted', floor: 4.5, what: 'second-line text, which is most of the small print' },
  { token: 'faint', floor: 3, what: 'a dim label beside a value: large-text size, and never the only copy of anything' },
  { token: 'accent', floor: 4.5, what: 'a link, a chosen tab, a number that is being pointed at' },
  { token: 'green', floor: 4.5, what: 'a price that went up' },
  { token: 'red', floor: 4.5, what: 'a price that went down' },
  { token: 'amber', floor: 4.5, what: 'a warning' },
  { token: 'danger', floor: 4.5, what: 'something that failed' },
  { token: 'muted-strong', floor: 4.5, what: 'a heading over a list' },
  { token: 'greeting', floor: 4.5, what: 'the name at the top of an empty chat' },
  { token: 'accent-strong', floor: 4.5, what: 'the accent when it has to carry a hairline as well' },
  { token: 'violet', floor: 4.5, what: 'the second accent' },
  { token: 'code-keyword', floor: 4.5, what: 'a keyword in the code editor' },
  { token: 'code-string', floor: 4.5, what: 'a string in the code editor' },
  { token: 'code-number', floor: 4.5, what: 'a number in the code editor' },
  { token: 'code-function', floor: 4.5, what: 'a function name in the code editor' },
  { token: 'code-type', floor: 4.5, what: 'a type name in the code editor' },
  { token: 'code-attr', floor: 4.5, what: 'a variable in the code editor' },
  { token: 'code-builtin', floor: 4.5, what: 'a built-in name in the code editor' },
  { token: 'code-meta', floor: 4.5, what: 'a pragma in the code editor' },
  { token: 'code-deletion', floor: 4.5, what: 'a deleted line in the code editor' }
]

/** The surfaces words are written on. Each one is a plain colour, so a ratio against it is exact. */
const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3', 'code-bg', 'option-bg']

/** Lightest to darkest in the dark theme, and the same four the other way up in the light one. */
const LADDER = ['bg', 'surface', 'surface-2', 'surface-3']

describe('the palettes are measured, not guessed at', () => {
  test('every ink reads on every surface, in both themes', async () => {
    const tokens = JSON.parse(await readFile(TOKENS, 'utf8')) as { dark: Palette; light: Palette }
    const tooFaint: string[] = []
    for (const theme of ['dark', 'light'] as const) {
      const palette = tokens[theme]
      for (const ink of INKS) {
        const colour = palette[ink.token]
        assert.ok(colour, `the ${theme} palette has no --${ink.token}`)
        for (const surface of SURFACES) {
          const under = palette[surface]
          assert.ok(under, `the ${theme} palette has no --${surface}`)
          const measured = ratio(colour, under)
          if (measured < ink.floor) {
            tooFaint.push(
              `${theme}: --${ink.token} (${colour}) on --${surface} (${under}) is ${shown(measured)}, ` +
                `under the ${ink.floor}:1 it needs -- it is ${ink.what}`
            )
          }
        }
      }
    }
    assert.deepEqual(tooFaint, [], `these colours are too faint to read:\n  ${tooFaint.join('\n  ')}`)
  })

  test('the colour that goes on the accent reads on the accent', async () => {
    const tokens = JSON.parse(await readFile(TOKENS, 'utf8')) as { dark: Palette; light: Palette }
    for (const theme of ['dark', 'light'] as const) {
      const palette = tokens[theme]
      for (const accent of ['accent', 'accent-strong', 'accent-press']) {
        const measured = ratio(palette['on-accent'], palette[accent])
        assert.ok(
          measured >= 4.5,
          `${theme}: --on-accent (${palette['on-accent']}) on --${accent} (${palette[accent]}) is ` +
            `${shown(measured)}; a button's own label needs 4.5:1`
        )
      }
    }
  })

  test('the surfaces are a ladder, and each theme reaches its own extreme', async () => {
    const tokens = JSON.parse(await readFile(TOKENS, 'utf8')) as { dark: Palette; light: Palette }
    const dark = LADDER.map((name) => brightness(parse(tokens.dark[name])))
    const light = LADDER.map((name) => brightness(parse(tokens.light[name])))
    for (let step = 1; step < LADDER.length; step += 1) {
      assert.ok(
        dark[step] > dark[step - 1],
        `dark --${LADDER[step]} is no lighter than --${LADDER[step - 1]}, so nothing drawn on it can look raised`
      )
      assert.ok(
        light[step] > light[step - 1],
        `light --${LADDER[step]} is no lighter than --${LADDER[step - 1]}, so nothing drawn on it can look raised`
      )
    }
    // The most raised thing there is, in each theme: a popup. Light needs real white there, dark needs real dark.
    assert.equal(tokens.light['surface-3'].toLowerCase(), '#ffffff', 'the light theme has no true white to raise to')
    assert.equal(tokens.light.popover.toLowerCase(), '#ffffff', 'a popup in the light theme is not white')
    assert.ok(brightness(parse(tokens.dark.bg)) < 0.01, 'the dark theme no longer has a near-black page')
  })
})
