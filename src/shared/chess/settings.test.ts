import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrast } from '../themes.ts'
import {
  ALL_SHORTCUTS, APP_SHORTCUTS, BOARD_ACCESS_NOTES, BOARD_KEYS, BOARD_STYLE_ATTRIBUTES, BOARD_THEMES,
  CHESS_SHORTCUTS, DEFAULT_CHESS_SETTINGS, ENGINE_RANGES, FIELDS, GROUPS, SESSION_OVERRIDABLE,
  analysisRequestFrom, boardStyleAttributes, boardTheme, chordFace, chordFromEvent, clampTo, conflictsIn,
  describeConflict, describeEngineRequest, describeFallback, drawnAs, effectiveChessSettings, fieldInfo, fieldsIn,
  formatForSettings, matchesChord, normalizeChord, notateSan, readChessSettings, resetGroup, valueAt, withField,
  type ChessSettings, type FieldPath, type GroupId, type Shortcut
} from './settings.ts'

/**
 * What these prove, in order:
 *
 *  - the settings model is internally consistent: every default is a value its own field would accept, every field
 *    says what it does and where it lands, and no field is describable as plumbed in when it is not;
 *  - a stored file is read field by field, so one bad value costs one preference and not the file;
 *  - every fallback is reported, because the failure this exists to stop is a silent one;
 *  - a per-session override wins for its own field and nothing else, and cannot smuggle a value past a range;
 *  - the stylesheet and the colour data agree -- they are the same hexes written twice, and this is the something
 *    that checks it -- and every piece can be seen on both of its squares;
 *  - the keyboard map claims no key twice in one place, and the chords it says the rest of Orbis owns are really
 *    in the files it names.
 */

// ---------------------------------------------------------------- the model

test('every default is a value its own field would accept', () => {
  for (const field of FIELDS) {
    const value = valueAt(DEFAULT_CHESS_SETTINGS, field.path)
    if (field.shape.kind === 'switch') {
      assert.equal(typeof value, 'boolean', `${field.path} defaults to ${String(value)}`)
    } else if (field.shape.kind === 'number') {
      assert.equal(typeof value, 'number', `${field.path} defaults to ${String(value)}`)
      assert.equal(clampTo(value as number, field.shape.range), value, `${field.path} defaults outside its own range`)
    } else {
      assert.ok(
        field.shape.choices.some((one) => one.value === value),
        `${field.path} defaults to "${String(value)}", which is not one of its choices`
      )
    }
  }
})

test('every field is in a real group, and every group has fields', () => {
  for (const field of FIELDS) {
    assert.ok(GROUPS.some((one) => one.id === field.group), `${field.path} is in group "${field.group}", which is not a group`)
  }
  for (const group of GROUPS) assert.ok(fieldsIn(group.id).length > 0, `the "${group.id}" group has no fields`)
  // No duplicate paths: a second entry for one path would make the screen draw it twice and read the first one.
  assert.equal(new Set(FIELDS.map((one) => one.path)).size, FIELDS.length, 'two fields share a path')
})

test('every field says what it does, and nothing is left undescribed', () => {
  for (const field of FIELDS) {
    assert.ok(field.label.length > 2, `${field.path} has no label`)
    assert.ok(field.plain.length > 15, `${field.path} has no plain explanation: "${field.plain}"`)
    // A sentence, so the screen can print it as one.
    assert.match(field.plain, /[.!]$/, `${field.path}'s explanation does not end in a full stop`)
  }
})

/**
 * The rule the whole screen rests on.
 *
 * A field that is only stored has to say what will read it, and a field the engine sizes itself has to say what
 * the engine calls it -- because the screen prints those sentences instead of drawing a control, and a blank one
 * would leave an unexplained gap where a switch looks like it ought to be.
 */
test('a field that goes nowhere yet says so, and says what will read it', () => {
  for (const field of FIELDS) {
    if (field.reach.kind === 'stored') {
      assert.ok(field.reach.waitingFor.length > 20, `${field.path} is stored and does not say what will read it`)
      assert.equal(drawnAs(field.reach), 'statement')
    }
    if (field.reach.kind === 'engine-sized') {
      assert.ok(field.reach.shownAs.length > 0, `${field.path} does not say what the engine calls it`)
      assert.equal(drawnAs(field.reach), 'statement')
    }
  }
  // And the other way round: a reach that does draw a control must be one of the kinds something really reads.
  const live = FIELDS.filter((one) => drawnAs(one.reach) === 'control').map((one) => one.reach.kind)
  for (const kind of live) {
    assert.ok(['board-style', 'engine-request', 'score-display', 'move-display', 'sound'].includes(kind), `${kind} draws a control and reaches nothing`)
  }
  // A sanity floor: if this ever reaches zero the screen has become a list of excuses.
  assert.ok(FIELDS.filter((one) => drawnAs(one.reach) === 'control').length >= 15, 'almost nothing on this screen does anything')
})

test('the engine ranges are the ones the engine channel really enforces', () => {
  // Read out of the handler rather than remembered: these clamps are the reason the ranges exist.
  const ipc = readFileSync(fileURLToPath(new URL('../../main/chess/ipc.ts', import.meta.url)), 'utf8')
  assert.match(ipc, /movetime: Math\.max\(50, Math\.min\(600_000/, 'the think-time clamp has moved')
  assert.match(ipc, /depth: Math\.max\(1, Math\.min\(40/, 'the depth clamp has moved')
  assert.match(ipc, /multipv: Math\.max\(1, Math\.min\(5/, 'the lines clamp has moved')
  assert.equal(ENGINE_RANGES.thinkMs.low, 50)
  assert.equal(ENGINE_RANGES.thinkMs.high, 600_000)
  assert.equal(ENGINE_RANGES.depth.high, 40)
  assert.equal(ENGINE_RANGES.lines.high, 5)
})

test('a number is held inside its range and on one of its steps', () => {
  assert.equal(clampTo(-5, ENGINE_RANGES.depth), 1)
  assert.equal(clampTo(400, ENGINE_RANGES.depth), 40)
  assert.equal(clampTo(18.4, ENGINE_RANGES.depth), 18)
  assert.equal(clampTo(70, ENGINE_RANGES.hashMb), 64)
  assert.equal(clampTo(2025, ENGINE_RANGES.thinkMs), 2050)
  // The top of a range is reachable even when it is not on a step from the bottom.
  assert.equal(clampTo(600_000, ENGINE_RANGES.thinkMs), 600_000)
})

test('one field changes and nothing else does, and a value the field cannot take is refused', () => {
  const next = withField(DEFAULT_CHESS_SETTINGS, 'board.theme', 'walnut')
  assert.equal(next.board.theme, 'walnut')
  assert.equal(next.board.pieces, DEFAULT_CHESS_SETTINGS.board.pieces)
  assert.deepEqual(next.engine, DEFAULT_CHESS_SETTINGS.engine)
  assert.equal(DEFAULT_CHESS_SETTINGS.board.theme, 'slate', 'the original was changed')

  assert.equal(withField(DEFAULT_CHESS_SETTINGS, 'board.theme', 'tartan').board.theme, 'slate')
  assert.equal(withField(DEFAULT_CHESS_SETTINGS, 'board.legalDots', 'yes').board.legalDots, DEFAULT_CHESS_SETTINGS.board.legalDots)
  assert.equal(withField(DEFAULT_CHESS_SETTINGS, 'engine.depth', 999).engine.depth, 40)
})

test('resetting a group touches nothing outside it', () => {
  let settings = withField(DEFAULT_CHESS_SETTINGS, 'board.theme', 'ink')
  settings = withField(settings, 'engine.depth', 30)
  settings = withField(settings, 'sound.volume', 10)

  const reset = resetGroup(settings, 'board')
  assert.equal(reset.board.theme, DEFAULT_CHESS_SETTINGS.board.theme)
  assert.equal(reset.engine.depth, 30, 'resetting the board changed the engine')
  assert.equal(reset.sound.volume, 10, 'resetting the board changed the sound')

  for (const group of GROUPS) {
    const one = resetGroup(settings, group.id)
    assert.deepEqual(one[group.id], DEFAULT_CHESS_SETTINGS[group.id], `${group.id} did not go back to its defaults`)
    for (const other of GROUPS) {
      if (other.id === group.id) continue
      assert.deepEqual(one[other.id], settings[other.id], `resetting ${group.id} changed ${other.id}`)
    }
  }
})

// ---------------------------------------------------------------- reading a stored file

test('nothing stored means the defaults, and nothing to report', () => {
  const loaded = readChessSettings(undefined)
  assert.deepEqual(loaded.settings, DEFAULT_CHESS_SETTINGS)
  assert.deepEqual(loaded.fallbacks, [])
  assert.equal(loaded.wholeFileUnreadable, false)
})

test('a file written before a field existed keeps what it has and reports nothing', () => {
  // The case that happens on every release: keys are missing, not wrong.
  const loaded = readChessSettings({ board: { theme: 'forest' } })
  assert.equal(loaded.settings.board.theme, 'forest')
  assert.equal(loaded.settings.board.pieces, DEFAULT_CHESS_SETTINGS.board.pieces)
  assert.deepEqual(loaded.fallbacks, [], 'a missing key was reported as a problem')
})

test('one bad value costs one preference, never the file', () => {
  const loaded = readChessSettings({
    board: { theme: 'walnut', pieces: 42, legalDots: false },
    engine: { thinkMs: 5000, depth: 'deep', lines: 3 },
    sound: { enabled: true, volume: 80 }
  })
  // Everything good survived.
  assert.equal(loaded.settings.board.theme, 'walnut')
  assert.equal(loaded.settings.board.legalDots, false)
  assert.equal(loaded.settings.engine.thinkMs, 5000)
  assert.equal(loaded.settings.engine.lines, 3)
  assert.equal(loaded.settings.sound.enabled, true)
  assert.equal(loaded.settings.sound.volume, 80)
  // The two bad ones fell back, and only those two.
  assert.equal(loaded.settings.board.pieces, DEFAULT_CHESS_SETTINGS.board.pieces)
  assert.equal(loaded.settings.engine.depth, DEFAULT_CHESS_SETTINGS.engine.depth)
  assert.deepEqual(loaded.fallbacks.map((one) => one.path).sort(), ['board.pieces', 'engine.depth'])
})

test('a number outside its range is held to it and the holding is reported', () => {
  const loaded = readChessSettings({ engine: { thinkMs: 9_000_000, lines: 0 }, sound: { volume: -40 } })
  assert.equal(loaded.settings.engine.thinkMs, ENGINE_RANGES.thinkMs.high)
  assert.equal(loaded.settings.engine.lines, ENGINE_RANGES.lines.low)
  assert.equal(loaded.settings.sound.volume, 0)
  assert.equal(loaded.fallbacks.length, 3)
  const think = loaded.fallbacks.find((one) => one.path === 'engine.thinkMs')
  assert.ok(think)
  assert.match(think.found, /9000000ms/)
  assert.match(think.because, /between 50ms and 600000ms/)
  assert.match(describeFallback(think), /Using 600000ms\.$/)
})

test('a number between steps is rounded to one and the rounding is reported', () => {
  const loaded = readChessSettings({ engine: { hashMb: 100 } })
  assert.equal(loaded.settings.engine.hashMb, 96)
  const one = loaded.fallbacks.find((item) => item.path === 'engine.hashMb')
  assert.ok(one)
  assert.match(one.because, /steps of 16MB/)
})

test('a choice that is not one of the choices falls back and the choices are named', () => {
  const loaded = readChessSettings({ board: { theme: 'tartan' }, moves: { notation: 'descriptive' } })
  assert.equal(loaded.settings.board.theme, DEFAULT_CHESS_SETTINGS.board.theme)
  assert.equal(loaded.settings.moves.notation, DEFAULT_CHESS_SETTINGS.moves.notation)
  const theme = loaded.fallbacks.find((one) => one.path === 'board.theme')
  assert.ok(theme)
  for (const one of BOARD_THEMES) assert.match(theme.because, new RegExp(one.id))
})

test('a group that is not a group is reported once, and the other groups still read', () => {
  const loaded = readChessSettings({ board: 'slate', engine: { depth: 22 } })
  assert.deepEqual(loaded.settings.board, DEFAULT_CHESS_SETTINGS.board)
  assert.equal(loaded.settings.engine.depth, 22, 'a bad board group lost the engine group as well')
  assert.equal(loaded.fallbacks.length, 1, 'a bad group was reported once per field')
  assert.match(loaded.fallbacks[0].because, /"board" part/)
  assert.match(loaded.fallbacks[0].because, new RegExp(`${fieldsIn('board').length} values`))
})

test('settings that are not settings at all fall back wholesale, and say so', () => {
  for (const raw of ['nonsense', 42, [], null, true]) {
    const loaded = readChessSettings(raw)
    assert.deepEqual(loaded.settings, DEFAULT_CHESS_SETTINGS, `${JSON.stringify(raw)} did not fall back cleanly`)
    assert.equal(loaded.wholeFileUnreadable, true, `${JSON.stringify(raw)} was not reported as unreadable`)
    assert.equal(loaded.fallbacks.length, 1)
  }
})

test('a reading can be written back and read again unchanged', () => {
  const once = readChessSettings({ board: { theme: 'ink', pieceSize: 'large' }, engine: { thinkMs: 3000, limit: 'depth' } })
  const twice = readChessSettings(JSON.parse(JSON.stringify(once.settings)))
  assert.deepEqual(twice.settings, once.settings)
  assert.deepEqual(twice.fallbacks, [], 'reading back what was just written produced complaints')
})

// ---------------------------------------------------------------- precedence

test("a game's override wins for its own field and for nothing else", () => {
  const global = withField(DEFAULT_CHESS_SETTINGS, 'board.orientation', 'white')
  const { settings, overridden, ignored } = effectiveChessSettings(global, { board: { orientation: 'black' } })
  assert.equal(settings.board.orientation, 'black')
  assert.deepEqual(overridden, ['board.orientation'])
  assert.deepEqual(ignored, [])
  // The rest of the group is the preference, not the default and not the override.
  assert.equal(settings.board.theme, global.board.theme)
  assert.equal(settings.board.legalDots, global.board.legalDots)
  assert.equal(global.board.orientation, 'white', 'the preference itself was changed')
})

test('no override means the preference exactly', () => {
  const global = withField(DEFAULT_CHESS_SETTINGS, 'engine.thinkMs', 7000)
  for (const nothing of [undefined, null, {}]) {
    const { settings, overridden } = effectiveChessSettings(global, nothing)
    assert.deepEqual(settings, global)
    assert.deepEqual(overridden, [])
  }
})

test('a field that belongs to the person cannot be overridden by one game', () => {
  const { settings, overridden, ignored } = effectiveChessSettings(DEFAULT_CHESS_SETTINGS, {
    board: { theme: 'contrast' },
    sound: { enabled: true },
    engine: { threads: 8 }
  })
  assert.equal(settings.board.theme, DEFAULT_CHESS_SETTINGS.board.theme)
  assert.equal(settings.sound.enabled, DEFAULT_CHESS_SETTINGS.sound.enabled)
  assert.equal(settings.engine.threads, DEFAULT_CHESS_SETTINGS.engine.threads)
  assert.deepEqual(overridden, [])
  assert.deepEqual(ignored.map((one) => one.path).sort(), ['board.theme', 'engine.threads', 'sound.enabled'])
  for (const one of ignored) assert.ok(one.because.length > 10, `${one.path} was ignored without a reason`)
})

test('an override of something that is not a setting is ignored and named', () => {
  const { ignored } = effectiveChessSettings(DEFAULT_CHESS_SETTINGS, { board: { colour: 'purple' } } as never)
  assert.deepEqual(ignored.map((one) => one.path), ['board.colour'])
  assert.match(ignored[0].because, /no such setting/i)
})

test('an override is held to the same range the preference would have been', () => {
  const { settings, overridden } = effectiveChessSettings(DEFAULT_CHESS_SETTINGS, { engine: { depth: 9999, lines: 3 } })
  assert.equal(settings.engine.depth, ENGINE_RANGES.depth.high, 'an override got past the range')
  assert.equal(settings.engine.lines, 3)
  assert.deepEqual([...overridden].sort(), ['engine.depth', 'engine.lines'])
})

test('an override of the wrong kind is refused rather than coerced', () => {
  const { settings, ignored } = effectiveChessSettings(DEFAULT_CHESS_SETTINGS, { engine: { depth: 'deeper' } } as never)
  assert.equal(settings.engine.depth, DEFAULT_CHESS_SETTINGS.engine.depth)
  assert.deepEqual(ignored.map((one) => one.path), ['engine.depth'])
})

test('an override that agrees with the preference is not called an override', () => {
  const { overridden, ignored } = effectiveChessSettings(DEFAULT_CHESS_SETTINGS, {
    board: { legalDots: DEFAULT_CHESS_SETTINGS.board.legalDots }
  })
  assert.deepEqual(overridden, [], 'a game that changed nothing was reported as changing something')
  assert.deepEqual(ignored, [])
})

test('every overridable field exists, and the ones held back are held back for a stated reason', () => {
  for (const path of SESSION_OVERRIDABLE) assert.ok(fieldInfo(path), `${path} is overridable and is not a field`)
  // Nothing in the look of the board or the sound belongs to one game.
  for (const path of ['board.theme', 'board.pieces', 'board.pieceSize', 'board.cursor', 'sound.enabled', 'sound.volume'] as FieldPath[]) {
    assert.ok(!SESSION_OVERRIDABLE.includes(path), `${path} is something a single game can change`)
  }
})

// ---------------------------------------------------------------- what the stylesheet gets

const CSS = readFileSync(fileURLToPath(new URL('../../renderer/src/components/chess/settings/chessSettings.css', import.meta.url)), 'utf8')
const BOARD_CSS = readFileSync(fileURLToPath(new URL('../../renderer/src/components/chess/board.css', import.meta.url)), 'utf8')

test('every board attribute the component sets is one the stylesheet acts on', () => {
  for (const name of BOARD_STYLE_ATTRIBUTES) {
    assert.ok(CSS.includes(`[${name}`), `nothing in the stylesheet reads ${name}, so that setting does nothing`)
  }
})

test('every attribute value the component can set has a rule, and there are no rules for values it cannot', () => {
  const settings = DEFAULT_CHESS_SETTINGS
  const everyValue: Record<string, string[]> = {}
  for (const field of FIELDS) {
    if (field.reach.kind !== 'board-style') continue
    const values = field.shape.kind === 'switch'
      ? [true, false]
      : field.shape.kind === 'choice' ? field.shape.choices.map((one) => one.value) : []
    for (const value of values) {
      const attrs = boardStyleAttributes(withField(settings, field.path, value))
      for (const [name, text] of Object.entries(attrs)) {
        if (Object.values(boardStyleAttributes(settings)).includes(text) && text !== attrs[name]) continue
        everyValue[name] = [...new Set([...(everyValue[name] ?? []), text])]
      }
    }
  }
  // Each attribute's values: one of them must be acted on. An 'on' value whose only job is to leave the board as
  // it was does not need a rule, which is why this asks for at least one rather than all of them.
  for (const [name, values] of Object.entries(everyValue)) {
    const acted = values.filter((value) => CSS.includes(`[${name}='${value}']`) || CSS.includes(`[${name}]`))
    assert.ok(acted.length > 0, `${name} can be ${values.join(', ')} and the stylesheet acts on none of them`)
  }
})

test('every board setting that claims to go nowhere else really has no other route', () => {
  // A board-style setting is only honest if Board.tsx has no prop for it: otherwise the board should be told
  // directly and this stylesheet is a workaround nobody can find.
  const board = readFileSync(fileURLToPath(new URL('../../renderer/src/components/chess/Board.tsx', import.meta.url)), 'utf8')
  assert.match(board, /showCoordinates\?: boolean/, 'the board has stopped taking a coordinates prop')
  assert.match(board, /showLegal\?: boolean/, 'the board has stopped taking a legal-moves prop')
  // The ones there is genuinely no prop for.
  for (const name of ['theme', 'pieceStyle', 'pieceSize', 'animation', 'cursorStyle']) {
    assert.ok(!board.includes(`${name}?:`), `the board now takes a ${name} prop; the stylesheet route is no longer the only one`)
  }
})

test('the stylesheet and the colour data are the same colours', () => {
  for (const theme of BOARD_THEMES) {
    const block = new RegExp(`:root\\[data-cw-board='${theme.id}'\\]\\s*\\{([^}]*)\\}`).exec(CSS)
    assert.ok(block, `the stylesheet has no block for the ${theme.name} board`)
    const declared = new Map<string, string>()
    for (const match of block[1].matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) declared.set(match[1], match[2].trim())
    const expected: [string, string][] = [
      ['--cw-light', theme.light], ['--cw-dark', theme.dark],
      ['--cw-wp', theme.whitePiece], ['--cw-we', theme.whiteEdge],
      ['--cw-bp', theme.blackPiece], ['--cw-be', theme.blackEdge],
      ['--cw-mark', theme.mark],
      ['--cw-coord-light', theme.coordOnLight], ['--cw-coord-dark', theme.coordOnDark]
    ]
    for (const [name, value] of expected) {
      assert.equal(declared.get(name), value, `${theme.name}'s ${name} is ${String(declared.get(name))} in the stylesheet and ${value} in the data`)
    }
  }
})

test('every theme has a visible difference between its two squares', () => {
  for (const theme of BOARD_THEMES) {
    const ratio = contrast(theme.light, theme.dark)
    assert.ok(ratio !== null, `${theme.name}'s squares are not colours this can read`)
    assert.ok(ratio >= 2, `${theme.name}'s two squares are only ${ratio.toFixed(2)}:1 apart, so the pattern is hard to see`)
  }
})

/**
 * The check that makes the themes safe to add to.
 *
 * A white piece on a white square is invisible and the only thing that saves it is its outline, so the test is
 * not "the piece stands out" -- it is "the piece or its outline stands out", on both squares, for both sides.
 */
test('every piece can be seen on both of its squares, by its colour or by its outline', () => {
  const worst: string[] = []
  for (const theme of BOARD_THEMES) {
    for (const square of [theme.light, theme.dark]) {
      for (const [side, fill, edge] of [['White', theme.whitePiece, theme.whiteEdge], ['Black', theme.blackPiece, theme.blackEdge]] as const) {
        const best = Math.max(contrast(fill, square) ?? 0, contrast(edge, square) ?? 0)
        if (best < 3) worst.push(`${theme.name}: the ${side.toLowerCase()} pieces on ${square} are only ${best.toFixed(2)}:1 away, outline included`)
      }
    }
  }
  assert.deepEqual(worst, [], 'these pieces cannot be made out on their own board')
})

test('the square names can be read on the square they sit on', () => {
  // board.css draws them white on both colours, which is the fault these two colours exist to fix.
  assert.match(BOARD_CSS, /\.cw-coord\s*\{[^}]*rgba\(255, 255, 255, 0\.75\)/, "board.css no longer draws the square names in one colour; this override may be stale")
  const bad: string[] = []
  for (const theme of BOARD_THEMES) {
    // Solid colours on purpose: a colour with an alpha measures better than it looks, and a check that flatters
    // what it is checking is worse than no check. 4.5 is the mark for ordinary text, which is what these are.
    for (const [colour, square, which] of [[theme.coordOnLight, theme.light, 'light'], [theme.coordOnDark, theme.dark, 'dark']] as const) {
      assert.match(colour, /^#[0-9a-f]{6}$/, `${theme.name}'s ${which}-square label carries an alpha, so its real contrast is worse than this measures`)
      const ratio = contrast(colour, square)
      assert.ok(ratio !== null, `${theme.name}'s ${which}-square label colour cannot be read: ${colour}`)
      if (ratio < 4.5) bad.push(`${theme.name}: the ${which}-square label is ${ratio.toFixed(2)}:1`)
    }
  }
  assert.deepEqual(bad, [], 'these square names are too faint to read')
})

/**
 * The panel's own colours.
 *
 * Only the colours this file writes out itself are checked. The token colours it borrows -- `--text`, `--faint`,
 * `--cyan` -- are the window's and are measured by `tokens.test.ts`; measuring them again here would be this area
 * claiming to have fixed something that is not its to fix. What is checked is that the panel introduces no colour
 * of its own that cannot be read on the panel's own background.
 */
test('the colours this panel introduces can be read on its own background', () => {
  // The panel sits on --bg-mid, which is #060708 in the dark palette and #f1f4f8 in the light one.
  const backgrounds = ['#060708', '#f1f4f8']
  const own = [...CSS.matchAll(/(?:^|[\s:,])(#[0-9a-f]{6})\b/gi)].map((one) => one[1].toLowerCase())
  const themeColours = new Set(
    BOARD_THEMES.flatMap((one) => [one.light, one.dark, one.whitePiece, one.whiteEdge, one.blackPiece, one.blackEdge, one.mark, one.coordOnLight, one.coordOnDark])
  )
  // Pure black and pure white are the cursor's two bands, which are drawn on a square and not on the panel.
  const onThePanel = [...new Set(own)].filter((one) => !themeColours.has(one) && one !== '#000000' && one !== '#ffffff')
  assert.ok(onThePanel.length > 0, 'the panel introduces no colours at all; this test is checking nothing')
  const bad: string[] = []
  for (const colour of onThePanel) {
    for (const background of backgrounds) {
      const ratio = contrast(colour, background)
      assert.ok(ratio !== null, `${colour} is not a colour this can read`)
      // These are all borders and edge marks rather than text, so 3:1 is the mark that applies to them.
      if (ratio < 3) bad.push(`${colour} is ${ratio.toFixed(2)}:1 on ${background}`)
    }
  }
  assert.deepEqual(bad, [], 'these marks are too faint to see against the panel')
})

test('every class this panel defines starts with its own prefix', () => {
  const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const foreign: string[] = []
  for (const match of withoutComments.matchAll(/(^|\})([^{}@]+)\{/g)) {
    for (const selector of match[2].split(',')) {
      const first = selector.trim().split(/[\s>+~]+/)[0] ?? ''
      const classes = [...first.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((one) => one[1])
      if (classes.length !== 1) continue
      const rest = first.replace(/\.[a-zA-Z][\w-]*/, '').replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
      if (rest.trim() !== '') continue
      if (!classes[0].startsWith('cw-cfg')) foreign.push(classes[0])
    }
  }
  assert.deepEqual([...new Set(foreign)], [], 'these classes are claimed outright and could land on another screen')
})

// ---------------------------------------------------------------- what the engine is asked

test('the engine is asked with exactly one limit, and it is the one that was chosen', () => {
  const byTime = analysisRequestFrom(withField(DEFAULT_CHESS_SETTINGS, 'engine.limit', 'time'), 'fen')
  assert.equal(byTime.movetime, DEFAULT_CHESS_SETTINGS.engine.thinkMs)
  assert.ok(!('depth' in byTime), 'a time limit also sent a depth; the engine would stop at whichever came first')

  const byDepth = analysisRequestFrom(withField(DEFAULT_CHESS_SETTINGS, 'engine.limit', 'depth'), 'fen')
  assert.equal(byDepth.depth, DEFAULT_CHESS_SETTINGS.engine.depth)
  assert.ok(!('movetime' in byDepth))
})

test('a request is clamped even when the stored value was not', () => {
  const wild = { ...DEFAULT_CHESS_SETTINGS, engine: { ...DEFAULT_CHESS_SETTINGS.engine, thinkMs: 9e9, lines: 50 } }
  const request = analysisRequestFrom(wild, 'fen', 'abc')
  assert.equal(request.movetime, ENGINE_RANGES.thinkMs.high)
  assert.equal(request.multipv, ENGINE_RANGES.lines.high)
  assert.equal(request.id, 'abc')
  assert.equal(request.fen, 'fen')
})

test('what the engine will be asked is said in words before anybody presses anything', () => {
  assert.equal(describeEngineRequest(DEFAULT_CHESS_SETTINGS), 'The best line, stopping at 2 seconds.')
  const three = withField(withField(DEFAULT_CHESS_SETTINGS, 'engine.lines', 3), 'engine.thinkMs', 500)
  assert.equal(describeEngineRequest(three), 'The best 3 lines, stopping at 500 milliseconds.')
  const deep = withField(DEFAULT_CHESS_SETTINGS, 'engine.limit', 'depth')
  assert.match(describeEngineRequest(deep), /depth 18\.$/)
})

// ---------------------------------------------------------------- how a score and a move read

test('a score reads the way it was asked for, and the evaluation module stays the authority on pawns', () => {
  const settings = DEFAULT_CHESS_SETTINGS
  assert.equal(formatForSettings({ kind: 'cp', cp: 124 }, settings, 'w'), '+1.24')
  assert.equal(formatForSettings({ kind: 'cp', cp: -124 }, settings, 'w'), '−1.24')
  assert.equal(formatForSettings({ kind: 'none' }, settings, 'w'), '—', 'a missing score was shown as a number')

  const hundredths = withField(settings, 'analysis.unit', 'hundredths')
  assert.equal(formatForSettings({ kind: 'cp', cp: 124 }, hundredths, 'w'), '+124')
  assert.equal(formatForSettings({ kind: 'cp', cp: 0 }, hundredths, 'w'), '0')
})

test("a score from the mover's side is the same score turned round, not a different one", () => {
  const fromMover = withField(DEFAULT_CHESS_SETTINGS, 'analysis.from', 'side-to-move')
  // Stored White-positive: White is a pawn up. Black to move sees that as a pawn down.
  assert.equal(formatForSettings({ kind: 'cp', cp: 100 }, DEFAULT_CHESS_SETTINGS, 'b'), '+1.00')
  assert.equal(formatForSettings({ kind: 'cp', cp: 100 }, fromMover, 'b'), '−1.00')
  assert.equal(formatForSettings({ kind: 'cp', cp: 100 }, fromMover, 'w'), '+1.00')
})

test('a forced mate is spelt out or abbreviated, and is never turned into a number of pawns', () => {
  const settings = DEFAULT_CHESS_SETTINGS
  assert.equal(formatForSettings({ kind: 'mate', moves: 3 }, settings, 'w'), 'mate in 3')
  assert.equal(formatForSettings({ kind: 'mate', moves: -2 }, settings, 'w'), 'mated in 2')
  assert.equal(formatForSettings({ kind: 'mate', moves: 0 }, settings, 'w'), 'mate')
  const short = withField(settings, 'analysis.mateInWords', false)
  assert.equal(formatForSettings({ kind: 'mate', moves: 3 }, short, 'w'), 'M3')
  // The unit has no say over a mate: hundredths of a pawn do not describe one.
  const hundredths = withField(settings, 'analysis.unit', 'hundredths')
  assert.equal(formatForSettings({ kind: 'mate', moves: 3 }, hundredths, 'w'), 'mate in 3')
})

test('a move reads the way it was asked for, and nothing is invented when it cannot', () => {
  const san = DEFAULT_CHESS_SETTINGS
  const figurine = withField(san, 'moves.notation', 'figurine')
  const uci = withField(san, 'moves.notation', 'uci')

  assert.equal(notateSan('Nf3', san, 'g1f3'), 'Nf3')
  assert.equal(notateSan('Nf3', figurine, 'g1f3'), '♘f3')
  assert.equal(notateSan('Nf3', uci, 'g1f3'), 'g1f3')
  // Without the coordinates there is no way to produce them, so the readable form is given back unchanged.
  assert.equal(notateSan('Nf3', uci), 'Nf3')

  // A pawn move has no piece letter, and the b of bxc6 is a file rather than a bishop.
  assert.equal(notateSan('e4', figurine, 'e2e4'), 'e4')
  assert.equal(notateSan('bxc6', figurine, 'b5c6'), 'bxc6')
  assert.equal(notateSan('Bxb5', figurine, 'f1b5'), '♗xb5')
  // Castling is not a piece letter either.
  assert.equal(notateSan('O-O', figurine, 'e1g1'), 'O-O')
  assert.equal(notateSan('Qh5#', figurine, 'd1h5'), '♕h5#')
})

// ---------------------------------------------------------------- the keyboard

test('a key press and a written chord end up as the same thing', () => {
  assert.equal(chordFromEvent({ key: 'a' }), 'A')
  assert.equal(chordFromEvent({ key: 'A', shiftKey: true }), 'Shift+A')
  assert.equal(chordFromEvent({ key: 'ArrowLeft' }), 'ArrowLeft')
  assert.equal(chordFromEvent({ key: ' ' }), 'Space')
  assert.equal(chordFromEvent({ key: 'k', ctrlKey: true }), 'Ctrl+K')
  // Cmd and Ctrl are one chord because the window's own handler treats them as one.
  assert.equal(chordFromEvent({ key: 'k', metaKey: true }), 'Ctrl+K')
  assert.equal(chordFromEvent({ key: 'F', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+F')
  // A punctuation mark carries no Shift: ? is Shift and a slash on some keyboards and not on others.
  assert.equal(chordFromEvent({ key: '?', shiftKey: true }), '?')
  assert.equal(normalizeChord('shift+?'), '?')
  assert.equal(normalizeChord('cmd+shift+o'), 'Ctrl+Shift+O')
  assert.equal(normalizeChord('Shift+Ctrl+o'), 'Ctrl+Shift+O')
  assert.equal(normalizeChord('left'), 'ArrowLeft')
})

test('every chord in the map survives being written down and read back', () => {
  for (const one of ALL_SHORTCUTS) {
    assert.equal(normalizeChord(one.chord), normalizeChord(normalizeChord(one.chord)), `${one.id}'s chord is not stable`)
    assert.equal(one.chord, normalizeChord(one.chord), `${one.id} writes its chord as "${one.chord}" rather than "${normalizeChord(one.chord)}"`)
  }
})

test('a chord matches the press it is meant to match, and not a neighbour', () => {
  assert.ok(matchesChord('Shift+A', { key: 'A', shiftKey: true }))
  assert.ok(!matchesChord('Shift+A', { key: 'a' }))
  assert.ok(matchesChord('A', { key: 'a' }))
  assert.ok(!matchesChord('A', { key: 'a', ctrlKey: true }), 'a bare letter matched a Ctrl chord')
  assert.ok(matchesChord('?', { key: '?', shiftKey: true }))
  assert.ok(matchesChord('ArrowLeft', { key: 'ArrowLeft' }))
  assert.ok(!matchesChord('ArrowLeft', { key: 'ArrowLeft', shiftKey: true }))
})

test('a chord reads as something somebody can follow', () => {
  assert.equal(chordFace('ArrowLeft'), '←')
  assert.equal(chordFace('Ctrl+Shift+O'), 'Ctrl+Shift+O')
  assert.equal(chordFace('Escape'), 'Esc')
})

/**
 * The one that matters.
 *
 * A key claimed twice in the same place is a key where one of the two handlers never runs, and nothing on screen
 * says which. There is no way to find that by using Orbis -- the shortcut simply does the other thing.
 */
test('no key is claimed twice in the same place', () => {
  const clashes = conflictsIn(ALL_SHORTCUTS).filter((one) => one.kind === 'same-place')
  assert.deepEqual(clashes.map(describeConflict), [], 'one of each of these pairs will never happen')
})

test('a key that means two things in two places says which is which', () => {
  const nested = conflictsIn(ALL_SHORTCUTS).filter((one) => one.kind === 'nested-place')
  // There really are some: the arrows and Escape. If this ever reaches zero the check has stopped looking.
  assert.ok(nested.length >= 3, `only ${nested.length} nested keys were found; the scopes may have collapsed`)
  for (const conflict of nested) {
    const inner = conflict.entries.find((one) => one.scope !== 'window')
    assert.ok(inner, `${conflict.chord} has no inner claim`)
    assert.ok(
      (inner.when ?? '').length > 10 || (inner.description ?? '').length > 10,
      `${inner.id} shares ${conflict.chord} with something else and does not say when it applies`
    )
    assert.ok(describeConflict(conflict).length > 40)
  }
  // And the two that must be in there, because they are the ones somebody will actually hit.
  const chords = nested.map((one) => one.chord)
  for (const chord of ['ArrowLeft', 'ArrowRight', 'Escape']) {
    assert.ok(chords.includes(chord), `${chord} is claimed in more than one place and is not reported`)
  }
})

test('two keys in places the keyboard cannot be in at once are not called a conflict', () => {
  const made: Shortcut[] = [
    { id: 'a', chord: 'ArrowUp', scope: 'chess-board', action: 'one', description: '', owner: 'x' },
    { id: 'b', chord: 'ArrowUp', scope: 'chess-move-list', action: 'two', description: '', owner: 'y' }
  ]
  assert.deepEqual(conflictsIn(made), [])
})

test("Chess World claims no chord the rest of Orbis already has", () => {
  const taken = new Set(APP_SHORTCUTS.map((one) => normalizeChord(one.chord)))
  const trouble = CHESS_SHORTCUTS.filter((one) => one.scope === 'chess-screen' && taken.has(normalizeChord(one.chord)))
  assert.deepEqual(trouble.map((one) => `${one.chord} (${one.action})`), [], 'these would never reach Chess World')
})

/**
 * The chords this map says the rest of Orbis owns have to really be there.
 *
 * A written-down list of somebody else's shortcuts goes stale the first time they move one, and a stale list makes
 * the conflict check above pass by checking the wrong thing. So each one is looked for in the file it names.
 */
test('the app chords in this map are really in the files it says they are', () => {
  const app = readFileSync(fileURLToPath(new URL('../../renderer/src/App.tsx', import.meta.url)), 'utf8')
  const main = readFileSync(fileURLToPath(new URL('../../main/index.ts', import.meta.url)), 'utf8')
  const missing: string[] = []
  for (const one of APP_SHORTCUTS) {
    if (one.owner.includes('native menu')) {
      // The accelerator as Electron writes it: CmdOrCtrl+Shift+Z for Ctrl+Shift+Z.
      const accel = normalizeChord(one.chord).replace(/^Ctrl/, 'CmdOrCtrl')
      if (!main.includes(`accelerator: '${accel}'`)) missing.push(`${one.id}: ${accel} is not an accelerator in src/main/index.ts`)
      continue
    }
    const key = normalizeChord(one.chord).split('+').slice(-1)[0]
    if (key === 'Escape') {
      if (!/event\.key !== 'Escape'/.test(app)) missing.push('app.escape: App.tsx no longer has an Escape handler')
      continue
    }
    const letter = key.toLowerCase()
    /*
     * Two shapes, both in that file: the shortcut table compares `key === 'b'`, and push-to-talk is written the
     * other way round -- `e.key.toLowerCase() !== 'm'` -- because it is a guard rather than a branch.
     */
    const looked = new RegExp(`key(?:\\.toLowerCase\\(\\))? [!=]== '${letter === ',' ? ',' : letter}'`)
    if (!looked.test(app)) missing.push(`${one.id}: nothing in App.tsx looks for "${letter}"`)
  }
  assert.deepEqual(missing, [], 'this map describes shortcuts that have moved or gone')
})

test("the board's own keys in this map are the keys Board.tsx really answers", () => {
  const board = readFileSync(fileURLToPath(new URL('../../renderer/src/components/chess/Board.tsx', import.meta.url)), 'utf8')
  for (const one of BOARD_KEYS) {
    const key = normalizeChord(one.chord)
    const looked = key === 'Space' ? /e\.key === ' '/ : new RegExp(`e\\.key === '${key}'`)
    assert.ok(looked.test(board), `${one.id}: Board.tsx does not answer ${key}`)
  }
  // And nothing it answers is missing from the map, which is what would make the sheet lie by omission.
  const answered = [...board.matchAll(/e\.key === '([^']+)'/g)].map((one) => (one[1] === ' ' ? 'Space' : one[1]))
  for (const key of new Set(answered)) {
    assert.ok(BOARD_KEYS.some((one) => normalizeChord(one.chord) === key), `Board.tsx answers ${key} and the keys sheet does not mention it`)
  }
})

test('every shortcut says what it does and where it is handled', () => {
  for (const one of ALL_SHORTCUTS) {
    assert.ok(one.action.length > 3, `${one.id} does not say what it does`)
    assert.ok(one.owner.length > 3, `${one.id} does not say where it is handled`)
    assert.ok(one.chord.length > 0, `${one.id} has no chord`)
  }
  assert.equal(new Set(ALL_SHORTCUTS.map((one) => one.id)).size, ALL_SHORTCUTS.length, 'two shortcuts share an id')
})

// ---------------------------------------------------------------- the board, as it really is

test('every note about the board says what was found, and every gap says what would fix it', () => {
  assert.ok(BOARD_ACCESS_NOTES.length >= 6, 'the audit has shrunk to a handful of notes')
  for (const note of BOARD_ACCESS_NOTES) {
    assert.ok(note.what.length > 8, `a note has no subject: ${note.what}`)
    assert.ok(note.detail.length > 60, `"${note.what}" is asserted rather than explained`)
    if (note.state !== 'works') assert.ok((note.needs ?? '').length > 20, `"${note.what}" is a gap and does not say what would close it`)
  }
  // Both answers have to be in there. All green is a report nobody checked; all red is a product nobody can use.
  assert.ok(BOARD_ACCESS_NOTES.some((one) => one.state === 'works'), 'the audit found nothing that works')
  assert.ok(BOARD_ACCESS_NOTES.some((one) => one.state !== 'works'), 'the audit found nothing wrong at all')
})

/**
 * The two gaps that are worth asserting against the file itself, because both are one edit away from being fixed
 * and the note would then be wrong. A note that describes a bug somebody has already fixed is as misleading as one
 * that misses a bug.
 */
test('the two gaps the notes make the most of are still really there', () => {
  const board = readFileSync(fileURLToPath(new URL('../../renderer/src/components/chess/Board.tsx', import.meta.url)), 'utf8')
  assert.ok(!board.includes('aria-activedescendant'), 'the board now says where its cursor is; that note is stale')
  assert.ok(!board.includes('aria-live'), 'the board now announces its moves; that note is stale')
  assert.match(board, /disabled=\{!interactive\}/, 'the board no longer disables its squares; that note is stale')
  assert.ok(!board.includes('useFocusTrap'), 'the promotion chooser now holds the keyboard; that note is stale')
})

// ---------------------------------------------------------------- the whole thing, once

test('a settings file can be stored, read, overridden, and asked of the engine without losing anything', () => {
  let stored: ChessSettings = DEFAULT_CHESS_SETTINGS
  for (const [path, value] of [
    ['board.theme', 'walnut'], ['board.pieceSize', 'large'], ['board.coordinates', 'off'],
    ['moves.notation', 'figurine'], ['engine.limit', 'depth'], ['engine.depth', 24], ['sound.enabled', true]
  ] as [FieldPath, string | number | boolean][]) {
    stored = withField(stored, path, value)
  }

  const read = readChessSettings(JSON.parse(JSON.stringify(stored)))
  assert.deepEqual(read.fallbacks, [])
  assert.deepEqual(read.settings, stored)

  const live = effectiveChessSettings(read.settings, { engine: { depth: 12 }, board: { coordinates: 'edge' } })
  assert.deepEqual([...live.overridden].sort(), ['board.coordinates', 'engine.depth'])
  assert.equal(live.settings.board.theme, 'walnut', 'an override of one field moved another')
  assert.equal(live.settings.engine.limit, 'depth')

  const request = analysisRequestFrom(live.settings, 'a-fen')
  assert.deepEqual(request, { fen: 'a-fen', depth: 12, multipv: 1 })

  const attrs = boardStyleAttributes(live.settings)
  assert.equal(attrs['data-cw-board'], 'walnut')
  assert.equal(attrs['data-cw-coords'], 'edge', 'the override did not reach the stylesheet')
  assert.equal(boardTheme('walnut').name, 'Walnut')
  assert.equal(Object.keys(attrs).length, BOARD_STYLE_ATTRIBUTES.length)
})

test('a group id is a key of the settings, so nothing can name a group that does not exist', () => {
  const groups: GroupId[] = ['board', 'moves', 'sound', 'engine', 'analysis']
  assert.deepEqual(GROUPS.map((one) => one.id), groups)
  for (const id of groups) assert.ok(id in DEFAULT_CHESS_SETTINGS)
})
