import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

/**
 * A screen must follow the theme, and this is what notices when one stops.
 *
 * ## What went wrong
 *
 * Somebody turned the window to its light theme and the screen stayed black. The switch was working -- the element
 * really did carry `data-theme="light"` -- and the token layer was complete: 61 names for dark, the same 61 for
 * light, with light values that really are light. Nothing was missing and nothing was mis-spelled.
 *
 * The fault was that much of the window never asks. A stylesheet that writes `background: #0b0c0f` paints the same
 * colour in both themes and no amount of correctness in `tokens.json` can reach it. The welcome and lock screen was
 * the worst of it: it painted its own colours from top to bottom, so the first thing anybody saw of the light theme
 * was a black screen. Across the window's stylesheets there were a few hundred more.
 *
 * That is a quiet fault. Nothing fails, nothing logs, and in the theme it was written for it looks perfect. So it
 * will come back the moment somebody writes one more hex colour, unless something counts them.
 *
 * ## The three things this checks
 *
 * 1. **A literal colour painting a background, a text colour or a border.** Those three are what makes a screen
 *    light or dark. A literal in one of them is a colour that cannot change with the theme.
 * 2. **A `var(--x)` that names a token nothing defines, with no fallback.** CSS does not complain about that: it
 *    draws nothing at all -- no background, no border -- which looks like a design choice rather than a mistake.
 * 3. **A token defined for one theme and not the other**, in the generated token layer. That is the fault the
 *    original report assumed and it is worth keeping an eye on even though it is currently clean.
 *
 * ## What is allowed, and how the list behaves
 *
 * `DELIBERATE` below is the exceptions: artwork, the chequerboard behind a transparent image, the colours of a
 * chess board, the purple and green of a timing screen. Each entry says which stylesheet, narrowed by the
 * selector or by the exact colour, and each carries a reason -- an entry with no reason fails.
 *
 * **The list may only shrink.** An entry that no longer matches anything fails too, so a colour that has been moved
 * to a token takes its excuse with it, and nobody inherits a blanket exemption for a file they are editing.
 *
 * Shadows are not checked. They matter to a light theme -- a deep black shadow is what makes a converted light
 * theme look muddy -- but a shadow is `box-shadow`, not a background, and one guard holding one rule is easier to
 * act on than one guard holding two.
 *
 * ## Running it
 *
 *   node --test src/shared/themeCoverage.test.ts
 *   ORBIS_THEME_FULL=1 node --test src/shared/themeCoverage.test.ts   (every line, not the first few per file)
 */

const REPO = resolve(import.meta.dirname, '..', '..')
const WINDOW_CSS = join(REPO, 'src/renderer/src')
const TOKEN_LAYER = 'src/renderer/src/styles/tokens.generated.css'

/** The declarations that decide whether a screen reads as light or dark. */
const PAINTS = new Set([
  'background',
  'background-color',
  'background-image',
  'color',
  'border',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block',
  'border-block-color',
  'border-inline',
  'border-inline-color',
  'outline',
  'outline-color',
  'caret-color',
  'accent-color',
  'column-rule',
  'column-rule-color',
  'text-decoration-color',
  '-webkit-text-fill-color'
])

type Exception = {
  /** The stylesheet, written exactly as a failure names it. */
  file: string
  /** Only inside a rule whose selector mentions one of these. Left out: anywhere in the file. */
  selectors?: string[]
  /** Only these colours, written as they are in the file. Left out: any colour. */
  colours?: string[]
  /** Why this is not a fault. One line. An entry without one fails. */
  why: string
}

/**
 * The colours that are meant to be the same in both themes.
 *
 * Everything here is a thing being *drawn*, not a surface the window is made of. A star map is black because space
 * is black. A chess board's light and dark squares are the board, not the theme. The chequerboard behind an image
 * has to read as "there are no pixels here" whatever the window looks like.
 */
const DELIBERATE: Exception[] = [
  {
    file: 'src/renderer/src/components/welcome.css',
    selectors: [
      '.welcome-face::after',
      '.welcome-face-skin',
      '.welcome-face-air',
      '.welcome-face-cap',
      '.welcome-face-fresnel',
      '.welcome-face-rim',
      '.welcome-face-grid'
    ],
    why: 'the twelve account worlds -- their glint, air, cap, rim and night side -- drawn in the four colours shared/avatars.ts sets per orb; a theme colour here would be a thirteenth world'
  },
  {
    file: 'src/renderer/src/styles/parts/03-sidebar.css',
    selectors: ['.sb-avatar'],
    colours: ['#000'],
    why: 'the same account world, drawn small in the sidebar: black is the unlit side of a sphere, not a surface colour'
  },
  {
    file: 'src/renderer/src/styles/parts/10-toasts-modals.css',
    selectors: ['.setting-face'],
    colours: ['#000'],
    why: 'the same account world again, in Settings: black is the unlit side of a sphere, not a surface colour'
  },
  {
    file: 'src/renderer/src/styles/parts/08-image-editor.css',
    colours: ['rgba(128, 128, 128, 0.22)', 'rgba(127, 127, 127, 0.45)'],
    why: 'the chequerboard and surround behind the picture being edited: it says "no pixels here", which has to read the same in both themes'
  },
  {
    file: 'src/renderer/src/styles/parts/04-images-library-drawers.css',
    colours: ['rgba(128, 128, 128, 0.18)'],
    why: 'the same chequerboard, behind a picture in the library, and mid-grey is the one tone that reads against both a pale image and a dark one'
  },
  {
    file: 'src/renderer/src/features/jarvis/jarvis.css',
    selectors: ['.tk-print-area'],
    why: 'inside @media print: paper is white and ink is black whatever the window is set to, and none of it is ever on screen'
  },
  {
    file: 'src/renderer/src/components/chess/board.css',
    selectors: ['.cw-sq', '.cw-pc-', '.cw-arrow', '.cw-drawn-sq', '.cw-coord'],
    why: 'the board itself: squares, pieces and the four annotation inks, which a player picks in Chess World rather than inheriting from the window'
  },
  /*
   * ---- The screens behind the shell ----
   *
   * Four kinds of thing, and nothing else. Everything in these files that was a surface, a type colour or a
   * hairline is a token now; what is left below is in one of these four groups, which is why each group is
   * written out rather than the files being excused wholesale.
   *
   *   1. A drawing of a real object, where the colour IS the object: a chequered flag, a football.
   *   2. Ink drawn ON something the theme does not decide -- a photograph, a tyre compound's colour from the data.
   *   3. Paper: an image made in dark ink on transparency, which needs a white plate under it in either theme.
   *   4. A key: a colour scale whose stops are the chart's legend, so they cannot differ between two themes.
   */
  {
    file: 'src/renderer/src/components/arena/arena.css',
    selectors: ['.arena-flag'],
    why: 'a chequered flag is black and white -- that is the flag, and it reads against either theme; everything else on this screen, including the track it sits on, is a token now'
  },
  {
    file: 'src/renderer/src/components/football/football.css',
    selectors: ['.fb-ball'],
    why: 'a football is white with grey shading in any theme: a drawing of an object, not a surface'
  },
  {
    file: 'src/renderer/src/components/f1/f1.css',
    selectors: ['.f1-stint', '.f1-pitmark'],
    why: 'the bar behind these is a tyre compound’s own colour, set per stint from the data, so the ink and the pit mark are drawn on the compound rather than on anything the theme decides'
  },
  {
    file: 'src/renderer/src/components/native/phase6.css',
    selectors: ['.p6-scale-bar'],
    why: 'a colour scale: the seven stops are the key to a measurement, and a themed spectrum would mean one chart with two different keys'
  },
  {
    file: 'src/renderer/src/components/artifactCard.css',
    selectors: ['.artifact-card-drawing'],
    why: 'a chart arrives as dark ink on transparency, so it is mounted on white paper in both themes; without the plate it was ink on near-black and invisible'
  },
  {
    file: 'src/renderer/src/components/create.css',
    selectors: ['.create-drawing'],
    why: 'the same drawing mounted on the same white paper, in the Create panel rather than in a message'
  },
  {
    file: 'src/renderer/src/styles/parts/07-thinking-orb-brand-markdown.css',
    selectors: ['.table-chart img'],
    why: 'the same drawing again, mounted on white paper inside a table: the ink is dark whatever the window is set to'
  },
  /*
   * ---- Three places that are dark in both themes, on purpose ----
   *
   * These are not screens the window's theme reaches into. Two of them are a stage: a board game and a ported
   * toolkit, each with its own palette written down inside it, which stays as it is when the window turns light.
   * The third is a shim that answers to colour names, where the name IS the colour being asked for.
   */
  {
    file: 'src/renderer/src/games/games.css',
    why: 'the games draw on their own dark stage in both themes, and every one of these colours is a piece on it -- a mine, a tile at 2048, the eight numbers of a minesweeper square; the page around the stage, its chrome and its type are tokens'
  },
  {
    file: 'src/renderer/src/features/jarvis/jarvis.css',
    selectors: ['.btn-cyber', '.tk-aurora', '.tk-frame::after'],
    why: 'the Toolkit came across with its own dark palette, declared at the top of this sheet and used nowhere else; these three are its aurora and its one lit button, drawn on that palette rather than on the window'
  },
  {
    file: 'src/renderer/src/physics/physics.css',
    selectors: [
      'amber',
      'yellow',
      'emerald',
      'green-',
      'red-',
      'rose',
      'fuchsia',
      'violet',
      'purple',
      'blue-',
      'zinc',
      'destructive',
      'text-white',
      'text-black'
    ],
    why: 'the utility layer the 230 ported simulations are written in: a page asks for `text-amber-400` and what it must get is amber-400, so a token here would mean the shim no longer answers the name it was asked'
  }
]

/** Blank out comments, keeping every newline, so a line number still means the line it came from. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (hidden) => hidden.replace(/[^\n]/g, ' '))
}

type Declaration = { selector: string; prop: string; value: string; line: number }

/**
 * Every declaration in a stylesheet, with the selector of the rule it sits in and the line it starts on.
 *
 * Written by hand rather than with a parser because the thing that matters is the line number: a failure that says
 * "this file, somewhere" is a failure somebody has to go hunting through 1,200 lines for.
 */
function declarations(source: string): Declaration[] {
  const css = withoutComments(source)
  const found: Declaration[] = []
  const open: string[] = []
  const parts: string[] = []
  let line = 1
  let startedOn = 1
  let blank = true
  const held = (): string => parts.join('')
  const clear = (): void => {
    parts.length = 0
    blank = true
  }
  const take = (): void => {
    const buffer = held()
    const at = buffer.indexOf(':')
    const prop = at > 0 ? buffer.slice(0, at).trim().toLowerCase() : ''
    // A selector has no colon; a declaration's property is one word and may begin with a dash or a vendor prefix.
    if (/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) {
      found.push({ selector: open[open.length - 1] ?? '', prop, value: buffer.slice(at + 1).trim(), line: startedOn })
    }
    clear()
  }
  for (const ch of css) {
    if (ch === '{') {
      open.push(held().trim().replace(/\s+/g, ' '))
      clear()
    } else if (ch === '}') {
      take()
      open.pop()
    } else if (ch === ';') {
      take()
    } else {
      // Where the declaration starts, tracked rather than trimmed: trimming a growing buffer once per character is
      // what turned this guard into a minute of waiting the first time it ran.
      if (blank && ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r' && ch !== '\f') {
        startedOn = line
        blank = false
      }
      parts.push(ch)
    }
    if (ch === '\n') line += 1
  }
  return found
}

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]+[\s,%][^()]*\)/gi

/**
 * The colours a value really paints with.
 *
 * Two things are taken out first, and both matter more than they look:
 *
 *   - **`url(...)`**, because an inline SVG is a drawing, and a `fill` inside one is not the window's background.
 *   - **the fallback in `var(--token, #fff)`**, when something defines that token. The fallback never shows, so
 *     flagging it would be crying fault at a file that is doing exactly the right thing -- and `appearance.css`
 *     alone writes 27 of them. When *nothing* defines the token the fallback is the only colour there is, so it
 *     stays in and gets counted.
 */
function coloursIn(value: string, defined: (name: string) => boolean): string[] {
  const resolve_ = (text: string): string => {
    let out = ''
    let at = 0
    for (;;) {
      const start = text.toLowerCase().indexOf('var(', at)
      if (start < 0) return out + text.slice(at)
      out += text.slice(at, start)
      let depth = 0
      let end = start + 3
      for (; end < text.length; end += 1) {
        if (text[end] === '(') depth += 1
        else if (text[end] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const whole = text.slice(start, end + 1)
      const name = /var\(\s*(--[a-z0-9-]+)/i.exec(whole)?.[1]
      const comma = whole.indexOf(',')
      if (name && defined(name)) out += ' / '
      else if (comma > 0) out += ` ${resolve_(whole.slice(comma + 1, -1))} `
      else out += ' / '
      at = end + 1
    }
  }
  const painted = resolve_(value.replace(/url\([^)]*\)/gi, ' / ').replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, ' / '))
  return [...painted.matchAll(COLOUR)].map((one) => one[0])
}

const sameColour = (one: string): string => one.toLowerCase().replace(/\s+/g, '')

function excuseFor(finding: { file: string; selector: string; colour: string }): Exception | undefined {
  return DELIBERATE.find(
    (one) =>
      one.file === finding.file &&
      (!one.selectors || one.selectors.some((part) => finding.selector.includes(part))) &&
      (!one.colours || one.colours.some((part) => sameColour(part) === sameColour(finding.colour)))
  )
}

/** Every stylesheet the window loads, read once and kept: five tests ask the same questions of the same text. */
let allSheets: Promise<{ file: string; css: string }[]> | undefined
function stylesheets(): Promise<{ file: string; css: string }[]> {
  allSheets ??= (async () => {
    const found: { file: string; css: string }[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name.endsWith('.css')) found.push({ file: full.slice(REPO.length + 1).replace(/\\/g, '/'), css: await readFile(full, 'utf8') })
      }
    }
    await walk(WINDOW_CSS)
    return found
  })()
  return allSheets
}

/**
 * The names the window's own code sets on an element, which no stylesheet therefore declares.
 *
 * These are not mistakes and they are not theme colours. `--av-with` is read 120 times in the account artwork and
 * every one of those reads is correct: the colour arrives on the element from `shared/avatars.ts`, which is what
 * lets one set of rules draw all twelve worlds. Put one of these in `:root` and you have invented a thirteenth
 * colour that nothing ever shows, and hidden the real mistake -- an orb drawn with no style at all.
 *
 * Written out rather than found by reading the window's TypeScript. Reading it is what this guard did first, and
 * 1,500 files came to three quarters of a minute on a machine that scans every file it opens -- for an answer that
 * changes about twice a year. Adding a name here is deliberate, which is the point: a name that nothing sets, read
 * with no fallback, draws nothing at all.
 */
const SET_BY_THE_WINDOW: { names: string[]; by: string }[] = [
  {
    names: ['--av-from', '--av-to', '--av-with', '--av-sky', '--av-rim', '--av-turn', '--av-tilt'],
    by: "shared/avatars.ts: one account orb's four colours, its turn and its tilt, set on the element"
  },
  { names: ['--ui-scale', '--corner-radius', '--blur-scale'], by: 'renderer/lib/experience.ts: the size of everything, the rounding of corners, the strength of the blur' },
  { names: ['--preset-background', '--backdrop-cycle'], by: 'shared/presets.ts: the background a look brings with it' },
  { names: ['--mstrip-reserved', '--mstrip-height'], by: "MarketStrip.tsx: the strip's measured height and the room it reserves" },
  { names: ['--at'], by: 'WelcomeExperience.tsx: which account orb this is, so the grid lands rather than appearing' },
  { names: ['--mk-logo-hue'], by: "AssetLogo.tsx: the colour of a coin's fallback mark, worked out from its ticker" },
  { names: ['--cw-dx', '--cw-dy', '--cw-slide'], by: 'chess/Board.tsx: how far and how fast a piece slides to its new square' },
  {
    names: ['--orbi-glow', '--orbi-loud', '--orbi-p', '--orbi-ring-delay', '--orbi-ring-offset', '--orbi-tilt'],
    by: 'student/Orbi.tsx and OrbiBody.tsx: the twelve parts of the character, animated from the component'
  },
  { names: ['--st-ring-to', '--st-star'], by: 'student/Spotlight.tsx and Constellation.tsx' },
  { names: ['--klon-count', '--klon-fan', '--klon-i'], by: 'games/solitaire.ts: how far a fanned pile spreads' },
  { names: ['--i'], by: 'NeurovaView.tsx: which row this is, for a staggered arrival' },
  { names: ['--held'], by: 'student/FocusRunning.tsx: how far through a press-and-hold somebody is' }
]

const FROM_THE_WINDOW = new Map(SET_BY_THE_WINDOW.flatMap((one) => one.names.map((name) => [name, one.by] as const)))

/**
 * Every `--name` the window gives a value to: a stylesheet declaration, or the window's own code above.
 *
 * A name in neither is the real fault. CSS draws nothing at all for it.
 */
let allNames: Promise<{ inCss: Map<string, string>; defined: Set<string> }> | undefined
function everyNameDefined(): Promise<{ inCss: Map<string, string>; defined: Set<string> }> {
  allNames ??= (async () => {
    const inCss = new Map<string, string>()
    for (const sheet of await stylesheets()) {
      for (const one of withoutComments(sheet.css).matchAll(/(--[a-z][a-z0-9-]*)\s*:/gi)) {
        if (!inCss.has(one[1])) inCss.set(one[1], sheet.file)
      }
    }
    return { inCss, defined: new Set([...inCss.keys(), ...FROM_THE_WINDOW.keys()]) }
  })()
  return allNames
}

type Finding = { file: string; line: number; selector: string; prop: string; colour: string }

/** Every background, text colour and border in the window that is written as a colour rather than asked for. */
let allPainted: Promise<{ findings: Finding[]; excused: Set<Exception> }> | undefined
function painted(): Promise<{ findings: Finding[]; excused: Set<Exception> }> {
  allPainted ??= (async () => {
    const sheets = await stylesheets()
    const { defined } = await everyNameDefined()
    const isDefined = (name: string): boolean => defined.has(name)
    const findings: Finding[] = []
    const excused = new Set<Exception>()
    for (const sheet of sheets) {
      for (const one of declarations(sheet.css)) {
        if (!PAINTS.has(one.prop)) continue
        for (const colour of coloursIn(one.value, isDefined)) {
          const finding = { file: sheet.file, line: one.line, selector: one.selector, prop: one.prop, colour }
          const excuse = excuseFor(finding)
          if (excuse) excused.add(excuse)
          else findings.push(finding)
        }
      }
    }
    return { findings, excused }
  })()
  return allPainted
}

describe('a screen follows the theme', () => {
  test('this guard is looking at the real stylesheets', async () => {
    /*
     * The trap this is here for: a check that cannot find what it is looking for must say so, not quietly agree
     * that everything is fine. A probe in this repo once printed "clean" for a whole screen because it could not
     * find that screen's root element.
     *
     * The floor below counts colours everywhere, including the token layer's own 61 light and 61 dark values, so it
     * cannot be reached by the window's screens being fixed -- only by the matching having broken.
     */
    const sheets = await stylesheets()
    assert.ok(sheets.length >= 30, `only ${sheets.length} stylesheets were read, so this guard is looking in the wrong place`)

    const colours = sheets.reduce((count, sheet) => count + [...withoutComments(sheet.css).matchAll(COLOUR)].length, 0)
    assert.ok(colours >= 50, `only ${colours} colours were found in ${sheets.length} stylesheets, so the matching has stopped working`)

    const paints = sheets.reduce(
      (count, sheet) => count + declarations(sheet.css).filter((one) => PAINTS.has(one.prop)).length,
      0
    )
    assert.ok(paints >= 200, `only ${paints} backgrounds, text colours and borders were found, so the parsing has stopped working`)

    const layer = sheets.find((one) => one.file === TOKEN_LAYER)
    assert.ok(layer, `${TOKEN_LAYER} was not read, and it is the thing both themes come from`)
  })

  test('no background, text colour or border is painted in a literal colour', async () => {
    const { findings } = await painted()
    const byFile = new Map<string, Finding[]>()
    for (const one of findings) byFile.set(one.file, [...(byFile.get(one.file) ?? []), one])
    const everything = process.env.ORBIS_THEME_FULL === '1'
    const shown = everything ? Number.MAX_SAFE_INTEGER : 6
    const report = [...byFile]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([file, mine]) => {
        const lines = mine.slice(0, shown).map((one) => `    ${String(one.line).padStart(5)}  ${one.prop}: ${one.colour}   ${one.selector.slice(0, 60)}`)
        if (mine.length > shown) lines.push(`    … and ${mine.length - shown} more in this file`)
        return `  ${file}  (${mine.length})\n${lines.join('\n')}`
      })
      .join('\n')

    assert.equal(
      findings.length,
      0,
      `${findings.length} literal colours paint a background, a text colour or a border, in ${byFile.size} stylesheets. ` +
        'Every one of them is the same colour in both themes, which is why the light theme came out dark. Replace each ' +
        'with the token for what it means -- --bg, --surface-2, --panel, --text, --faint, --line, --glass-border, ' +
        '--cyan, --red, --green, --amber, --hover -- or, if it is artwork that is meant to be that colour in any ' +
        'theme, add it to DELIBERATE in this file with a reason.' +
        (everything ? '' : ' Set ORBIS_THEME_FULL=1 for every line.') +
        `\n\n${report}\n`
    )
  })

  test('nothing in the exception list has stopped applying', async () => {
    /*
     * The other direction, so the list cannot rot. An exception for a colour that has since become a token is an
     * excuse somebody else inherits without knowing it, and the whole point of this list is that it only shrinks.
     */
    const { excused } = await painted()
    const stale = DELIBERATE.filter((one) => !excused.has(one)).map((one) => `${one.file} ${one.selectors?.join(' ') ?? ''} ${one.colours?.join(' ') ?? ''}`.trim())
    assert.deepEqual(stale, [], 'these exceptions no longer excuse anything. Delete them: the list may only shrink.')

    const unexplained = DELIBERATE.filter((one) => one.why.trim().length < 20).map((one) => one.file)
    assert.deepEqual(unexplained, [], 'every exception needs a reason beside it saying why that colour is the same in both themes')
  })

  test('every var() either names something that has a value, or carries a fallback', async () => {
    const sheets = await stylesheets()
    const { inCss, defined } = await everyNameDefined()

    const draws: { file: string; line: number; name: string }[] = []
    const everRead = new Set<string>()
    let reads = 0
    for (const sheet of sheets) {
      const css = withoutComments(sheet.css)
      for (const here of css.matchAll(/var\(\s*(--[a-z][a-z0-9-]*)\s*([,)])/gi)) {
        reads += 1
        everRead.add(here[1])
        if (here[2] !== ')' || defined.has(here[1])) continue
        draws.push({ file: sheet.file, line: css.slice(0, here.index).split('\n').length, name: here[1] })
      }
    }

    assert.ok(reads >= 500, `only ${reads} var() reads were found in ${sheets.length} stylesheets, so this guard is looking in the wrong place`)
    assert.deepEqual(
      draws.map((one) => `${one.file}:${one.line}  var(${one.name}) -- nothing in the window gives it a value`),
      [],
      'CSS does not complain about a name nothing defines. It draws nothing at all -- no background, no border -- ' +
        'and that looks like a design choice. Either define it in orbis-ui/tokens.json, or give the read a fallback.'
    )

    // And the other direction, so SET_BY_THE_WINDOW cannot quietly excuse names that have moved or gone.
    const moved = [...FROM_THE_WINDOW.keys()]
      .filter((name) => inCss.has(name) || !everRead.has(name))
      .map((name) => (inCss.has(name) ? `${name} is declared in ${inCss.get(name)} now` : `${name} is not read by any stylesheet any more`))
    assert.deepEqual(moved, [], 'take these out of SET_BY_THE_WINDOW: a list of exceptions is only safe while every line of it still earns its place')
  })

  test('every token is defined for both themes', async () => {
    /*
     * The generated layer holds four blocks: the dark values on `:root`, the light ones under the system scheme and
     * again under a forced `data-theme='light'`, and the dark ones again under a forced `data-theme='dark'`. A name
     * in one and not the others is a screen that half-changes when the theme does.
     *
     * `tokens.test.ts` checks the values against `orbis-ui/tokens.json`. This checks the names against each other,
     * which is the shape the original light-theme report assumed the fault was.
     */
    const layer = await readFile(join(REPO, TOKEN_LAYER), 'utf8')
    const block = (selector: string): Set<string> => {
      const start = layer.indexOf(selector)
      assert.ok(start >= 0, `${TOKEN_LAYER} has no ${selector} block, so this guard is looking in the wrong place`)
      const from = layer.indexOf('{', start)
      const body = layer.slice(from, layer.indexOf('}', from))
      return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((one) => one[1]))
    }

    const dark = block(':root {')
    const forcedDark = block(":root[data-theme='dark']")
    const themes = [
      ['the system light scheme', block('@media (prefers-color-scheme: light)')],
      ["a forced data-theme='light'", block(":root[data-theme='light']")]
    ] as const

    assert.ok(dark.size >= 40, `only ${dark.size} tokens were found on :root, so this guard is looking in the wrong place`)

    for (const [what, light] of themes) {
      const onlyDark = [...forcedDark].filter((name) => !light.has(name)).sort()
      const onlyLight = [...light].filter((name) => !forcedDark.has(name)).sort()
      assert.deepEqual(onlyDark, [], `${what} has no value for these, so they keep their dark value when the theme changes`)
      assert.deepEqual(onlyLight, [], `${what} defines these and the dark theme does not`)
    }
  })
})

describe('the guard itself', () => {
  /*
   * The checks above are only worth anything if the matching works, and the way this goes wrong is silent: a regex
   * that matches nothing reports a clean window. So the matching is driven here against stylesheets written out in
   * full, including the three cases that would otherwise fill the list with things that are perfectly fine.
   */
  const defined = (name: string): boolean => name === '--panel'
  const paintedIn = (css: string): { line: number; selector: string; prop: string; colour: string }[] =>
    declarations(css)
      .filter((one) => PAINTS.has(one.prop))
      .flatMap((one) => coloursIn(one.value, defined).map((colour) => ({ line: one.line, selector: one.selector, prop: one.prop, colour })))

  test('a hard-coded background is found, with its line and its selector', () => {
    const css = ['.a {', '  display: flex;', '}', '', '.b {', '  background: #0b0c0f;', '}'].join('\n')
    assert.deepEqual(paintedIn(css), [{ line: 6, selector: '.b', prop: 'background', colour: '#0b0c0f' }])
  })

  test('a comment holding a brace does not move the line numbers', () => {
    const css = ['/* a note with a { in it', '   over two lines */', '.b { color: #fff; }'].join('\n')
    assert.deepEqual(paintedIn(css), [{ line: 3, selector: '.b', prop: 'color', colour: '#fff' }])
  })

  test('a fallback behind a token that exists is not a fault', () => {
    // The token decides the colour; the fallback never shows. Flagging these would bury the real ones.
    assert.deepEqual(paintedIn('.b { background: color-mix(in srgb, var(--panel, #11161d) 70%, transparent); }'), [])
  })

  test('a fallback behind a token that nothing defines is the colour, so it counts', () => {
    assert.deepEqual(paintedIn('.b { background: var(--nope, #11161d); }'), [
      { line: 1, selector: '.b', prop: 'background', colour: '#11161d' }
    ])
  })

  test('a colour inside a drawing is left alone', () => {
    assert.deepEqual(paintedIn(`.b { background: url("data:image/svg+xml,<svg fill='#ff0000'/>"); }`), [])
  })

  test('a shadow is not a background', () => {
    assert.deepEqual(paintedIn('.b { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6); }'), [])
  })

  test('a colour inside a media query is found, and the selector is the rule it is in', () => {
    const css = ['@container pages-view (max-width: 600px) {', '  .b .c {', '    border-bottom: 1px solid rgba(255, 255, 255, 0.09);', '  }', '}'].join('\n')
    assert.deepEqual(paintedIn(css), [
      { line: 3, selector: '.b .c', prop: 'border-bottom', colour: 'rgba(255, 255, 255, 0.09)' }
    ])
  })

  test('the last declaration in a block counts even without a semicolon', () => {
    assert.deepEqual(paintedIn('.b { color: #123456 }'), [{ line: 1, selector: '.b', prop: 'color', colour: '#123456' }])
  })

  test('a gradient is a background, and every stop in it counts', () => {
    assert.deepEqual(
      paintedIn('.b { background: linear-gradient(180deg, #13243a, rgb(10 18 32 / 0.5)); }').map((one) => one.colour),
      ['#13243a', 'rgb(10 18 32 / 0.5)']
    )
  })

  test('an exception is read as what it says and nothing wider', () => {
    const grey = { file: 'src/renderer/src/styles/parts/08-image-editor.css', selector: '.editor-canvas', colour: 'RGBA(128, 128,128, 0.22)' }
    assert.ok(excuseFor(grey), 'the chequerboard grey is excused however it is spaced or capitalised')
    assert.ok(!excuseFor({ ...grey, colour: '#0b0c0f' }), 'a colour the entry does not name is not excused')
    assert.ok(!excuseFor({ ...grey, file: 'src/renderer/src/components/create.css' }), 'another file does not inherit it')
    const art = { file: 'src/renderer/src/components/welcome.css', selector: '.welcome-face-skin::after', colour: '#fff' }
    assert.ok(excuseFor(art), 'the account orbs are artwork')
    assert.ok(!excuseFor({ ...art, selector: '.welcome-field input' }), 'the screen around them is not')
  })
})
