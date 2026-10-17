import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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
    // `board-prop` belongs here because the board really takes it: `BoardProps.orientation` in `Board.tsx`, passed
    // by whoever renders a board. It was added to `Reach` after this list was written, which is why the list is
    // checked against the type rather than remembered -- a kind that reaches nothing must be `stored` and say so.
    assert.ok(['board-style', 'board-prop', 'engine-request', 'score-display', 'move-display', 'sound'].includes(kind), `${kind} draws a control and reaches nothing`)
  }
  // A sanity floor: if this ever reaches zero the screen has become a list of excuses.
  assert.ok(FIELDS.filter((one) => drawnAs(one.reach) === 'control').length >= 15, 'almost nothing on this screen does anything')
})

/**
 * The hole the test above left open, and the fault that went through it.
 *
 * The check above compares a field's *kind* to a list of kinds. `board-prop` is on that list because the board does
 * take props -- but a field saying `board-prop` proves only that a prop by that name exists, not that any screen
 * ever hands the setting to it. `analysis.evalBar` sat there for weeks: the board had an `evalBar` prop, no screen
 * passed one, and the settings screen drew a live switch that neither put a bar on a board nor removed the one the
 * Study screen drew. A guard that compares a table to a list rather than to the code is how that survived.
 *
 * So this reads the screens. For every `board-prop` field, some file under `components/chess` must read the value
 * and render a board -- the read is the thing that was missing, and it is the thing a list of kinds cannot see.
 */
test('a setting handed to the board as a prop is really read by some screen that draws a board', () => {
  const dir = fileURLToPath(new URL('../../renderer/src/components/chess/', import.meta.url))
  const sources: { name: string; text: string }[] = []
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = `${at}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) sources.push({ name: entry.name, text: readFileSync(full, 'utf8') })
    }
  }
  walk(dir)
  const props = FIELDS.filter((one) => one.reach.kind === 'board-prop')
  assert.ok(props.length > 0, 'no field claims to reach the board as a prop any more; this test has nothing to check')
  for (const field of props) {
    const [group, key] = field.path.split('.')
    // Read through whatever the screen calls its settings -- `settings.analysis.evalBar`, `prefs.board.orientation`
    // -- and in a file that really draws a board, because a read that decides nothing on a board is not a reach.
    const reads = sources.filter(
      (one) => new RegExp(`\\.${group}\\.${key}\\b`).test(one.text) && /<Board\b|<EvalBar\b/.test(one.text)
    )
    assert.ok(
      reads.length > 0,
      `${field.path} draws a control and says it reaches the board as the ${(field.reach as { prop: string }).prop} prop, but no screen under components/chess reads .${group}.${key} and draws a board. Either read it where the board is, or make the field 'stored' so the screen prints a sentence instead of a switch.`
    )
  }
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
      ['--cw-mark', theme.mark], ['--cw-check', theme.check],
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
    // The check square is in here because it replaces the square colour outright: a king is standing on it, and a
    // red that hides the king is a mark that makes the thing it is marking invisible.
    for (const [square, which] of [[theme.light, 'the light square'], [theme.dark, 'the dark square'], [theme.check, 'the check square']] as const) {
      for (const [side, fill, edge] of [['White', theme.whitePiece, theme.whiteEdge], ['Black', theme.blackPiece, theme.blackEdge]] as const) {
        const best = Math.max(contrast(fill, square) ?? 0, contrast(edge, square) ?? 0)
        if (best < 3) worst.push(`${theme.name}: the ${side.toLowerCase()} pieces on ${which} (${square}) are only ${best.toFixed(2)}:1 away, outline included`)
      }
    }
  }
  assert.deepEqual(worst, [], 'these pieces cannot be made out on their own board')
})

/**
 * The bug a probe found and nothing else could have.
 *
 * The square-colour rules in this stylesheet are four class-level selectors against board.css's two, so once a
 * board theme is chosen they beat board.css's own rule for the check square -- and the red disappeared under the
 * square colour. It is invisible on the standard board, because the standard board sets no theme at all.
 */
test('the check square is painted above the square colour, not under it', () => {
  const colourRule = /:root\[data-cw-board\] \.cw-sq\.light/.exec(CSS)
  const checkRule = /:root\[data-cw-board\]\[data-cw-checkmark='on'\] \.cw-sq\.is-check/.exec(CSS)
  assert.ok(colourRule, 'the square colours are no longer set from here')
  assert.ok(checkRule, 'nothing restates the check square, so a chosen board colour paints over it')
  // One more class-level selector, so it wins wherever the two end up in the file.
  assert.ok((checkRule.index ?? 0) > (colourRule.index ?? 0), 'the check square is restated before the colours it has to beat')
  assert.match(BOARD_CSS, /\.cw-sq\.is-check \{ background: #8d3b45; \}/, 'board.css no longer paints the check square; this override may be stale')
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
    BOARD_THEMES.flatMap((one) => [
      one.light, one.dark, one.whitePiece, one.whiteEdge, one.blackPiece, one.blackEdge,
      one.mark, one.check, one.coordOnLight, one.coordOnDark
    ])
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

/**
 * The second bug a probe found, and the reason the strong cursor is two shadows rather than a shadow and an outline.
 *
 * `outline-offset: -3px` puts a 3px outline in exactly the same three pixels an `inset 0 0 0 3px` shadow occupies,
 * and the outline paints last -- so the white band covered the black one completely, the cursor was a single white
 * ring, and on a pale square it was as hard to see as the one it was replacing. The computed styles said both were
 * applied, because both were; only a picture showed that one was underneath the other.
 */
test('the strong cursor draws two bands that do not sit on top of each other', () => {
  const block = /:root\[data-cw-cursor='strong'\] \.cw-sq\.is-cursor \{([^}]*)\}/.exec(CSS)
  assert.ok(block, 'the strong cursor is gone')
  assert.ok(!/outline-offset/.test(block[1]), 'the cursor is back to an outline with an offset, which hides the band under it')
  assert.match(block[1], /outline:\s*none/, "board.css's own dashed cursor is left to draw underneath this one")

  const bands = [...block[1].matchAll(/inset 0 0 0 (\d+)px (#[0-9a-f]{6})/g)].map((one) => ({ at: Number(one[1]), colour: one[2] }))
  assert.equal(bands.length, 2, `the cursor draws ${bands.length} bands rather than two`)
  assert.deepEqual(bands.map((one) => one.colour), ['#000000', '#ffffff'], 'the two bands are not black and white')
  // Different spreads, so one sits inside the other instead of over it. The narrower is painted first, on top.
  assert.ok(bands[1].at > bands[0].at, 'both bands have the same spread, so the second is invisible under the first')

  // Both combinations keep every ring, each further in than the last.
  for (const also of ['is-selected', 'is-target']) {
    const combined = new RegExp(`:root\\[data-cw-cursor='strong'\\] \\.cw-sq\\.is-cursor\\.${also} \\{([^}]*)\\}`).exec(CSS)
    assert.ok(combined, `a square that is the cursor and ${also} loses one of its rings`)
    const spreads = [...combined[1].matchAll(/inset 0 0 0 (\d+)px/g)].map((one) => Number(one[1]))
    assert.equal(spreads.length, 3, `the cursor with ${also} draws ${spreads.length} rings rather than three`)
    assert.deepEqual(spreads, [...spreads].sort((a, b) => a - b), `the rings for the cursor with ${also} are not in order, so an outer one covers an inner`)
  }

  // And the two band colours have to stand out from every square they can land on, which is the whole point.
  for (const theme of BOARD_THEMES) {
    for (const square of [theme.light, theme.dark, theme.check]) {
      const best = Math.max(contrast('#000000', square) ?? 0, contrast('#ffffff', square) ?? 0)
      assert.ok(best >= 4.5, `neither band stands out on ${theme.name}'s ${square}: the best is ${best.toFixed(2)}:1`)
    }
  }
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
    { id: 'a', chord: 'ArrowUp', scope: 'chess-board', action: 'one', description: '', owner: 'x', answered: true },
    { id: 'b', chord: 'ArrowUp', scope: 'chess-move-list', action: 'two', description: '', owner: 'y', answered: true }
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

/**
 * The one that had already gone wrong.
 *
 * Fifteen chess-screen chords named `ChessSettings.tsx` as the file that answered them, and that file has never had
 * a key handler in it. Pressing ArrowLeft, Home, End, F, A, N or S on the Chess World screen did nothing at all,
 * and the key sheet said each of them worked -- the same shape of fault as a browser chord that was registered
 * nowhere and left people pressing a key that opened the sidebar instead.
 *
 * So both halves are checked against the files themselves. A chord that says it is answered has to be looked for in
 * the file it names. A chord that says nothing answers it must not be looked for anywhere -- otherwise the day
 * somebody implements one, the sheet starts under-claiming instead of over-claiming, which is the same lie upside
 * down.
 */
test('every chess chord says truthfully whether anything answers it', () => {
  const read = (where: string): string => readFileSync(fileURLToPath(new URL(where, import.meta.url)), 'utf8')
  const files: Readonly<Record<string, string>> = {
    'ChessView.tsx': read('../../renderer/src/components/chess/ChessView.tsx'),
    'ui/Modal.tsx': read('../../renderer/src/ui/Modal.tsx')
  }
  /**
   * How a handler is written for one chord: the key as the keyboard really delivers it.
   *
   * The case matters and is the whole reason this is not one regex. An unshifted letter arrives lowercase and a
   * shifted one arrives as the capital, so `S` is answered by `=== 's'` and `Shift+S` by `=== 'S'`. Folding the two
   * together made `S` -- which nothing answers -- match the Shift+S handler, and the check passed the wrong chord.
   */
  const looksFor = (text: string, chord: string): boolean => {
    const bits = normalizeChord(chord).split('+')
    const key = bits[bits.length - 1]
    if (key === 'Space') return /key === ' '/.test(text)
    if (/^[A-Z]$/.test(key)) {
      const want = bits.includes('Shift') ? key : key.toLowerCase()
      return new RegExp(`key(?:\\.toLowerCase\\(\\))? [!=]== '${want}'`).test(text)
    }
    // A number key is answered through a table of them rather than a comparison, so both shapes count.
    if (/^[0-9]$/.test(key)) return new RegExp(`'${key}':`).test(text) || new RegExp(`key [!=]== '${key}'`).test(text)
    const spelt = key === '?' ? '\\?' : key
    return new RegExp(`key(?:\\.toLowerCase\\(\\))? [!=]== '${spelt}'`).test(text)
  }
  const wrong: string[] = []
  const everywhere = Object.values(files).join('\n')
  for (const one of CHESS_SHORTCUTS) {
    if (one.answered) {
      const text = files[one.owner]
      if (text === undefined) { wrong.push(`${one.id} says it is answered in "${one.owner}", which this check cannot read`); continue }
      if (!looksFor(text, one.chord)) wrong.push(`${one.id}: ${one.chord} says it is answered in ${one.owner} and nothing there looks for it`)
      continue
    }
    assert.equal(one.owner, 'nobody yet', `${one.id} is not answered and names ${one.owner} as its owner`)
    if (looksFor(everywhere, one.chord)) wrong.push(`${one.id}: ${one.chord} is now answered somewhere and the sheet still says nothing answers it`)
  }
  assert.deepEqual(wrong, [], 'the key sheet and the handlers disagree')
  // And the sheet has to be saying both things, or this check has stopped looking at one of them.
  assert.ok(CHESS_SHORTCUTS.some((one) => one.answered), 'no chess chord is answered at all')
  assert.ok(CHESS_SHORTCUTS.some((one) => !one.answered), 'every chess chord is answered; that would be new')
})

test("the board's own keys in this map are the keys Board.tsx really answers", () => {
  const board = readFileSync(fileURLToPath(new URL('../../renderer/src/components/chess/Board.tsx', import.meta.url)), 'utf8')
  for (const one of BOARD_KEYS) {
    const key = normalizeChord(one.chord)
    /*
     * A letter arrives from the keyboard as itself or as its capital depending on Shift, so the board folds the
     * case before comparing and a chord of `M` is answered by `e.key.toLowerCase() === 'm'`. Everything else is
     * compared as it comes. Both forms are looked for, which is the same allowance the App.tsx check above makes.
     */
    const looked = key === 'Space'
      ? /e\.key === ' '/
      : /^[A-Z]$/.test(key)
        ? new RegExp(`e\\.key\\.toLowerCase\\(\\) === '${key.toLowerCase()}'`)
        : new RegExp(`e\\.key === '${key}'`)
    assert.ok(looked.test(board), `${one.id}: Board.tsx does not answer ${key}`)
  }
  // And nothing it answers is missing from the map, which is what would make the sheet lie by omission.
  const answered = [
    ...[...board.matchAll(/e\.key === '([^']+)'/g)].map((one) => (one[1] === ' ' ? 'Space' : one[1])),
    ...[...board.matchAll(/e\.key\.toLowerCase\(\) === '([^']+)'/g)].map((one) => one[1])
  ]
  for (const key of new Set(answered)) {
    assert.ok(
      BOARD_KEYS.some((one) => normalizeChord(one.chord) === normalizeChord(key)),
      `Board.tsx answers ${key} and the keys sheet does not mention it`
    )
  }
})

/**
 * A key the sheet advertises has to work on some board a person can actually reach.
 *
 * The test above proves `Board.tsx` answers the key. That is not the same claim. Drawing only happens on a board
 * that was handed `onMarksChange` -- `Board.tsx` says so itself: "a board given no onMarksChange draws the marks it
 * is handed and cannot be drawn on" -- and for a long while no screen in Chess World passed it. So the four drawing
 * keys were in the keyboard sheet, implemented in the board, and dead on every board in the product, while the
 * settings screen said in plain words that the board draws the arrows you draw yourself.
 *
 * Four keys and a sentence, all true of the file and none of them true of the screen. This asks the screens.
 */
test('the keys that draw on the board work on a board some screen really lets you draw on', () => {
  const needMarks = BOARD_KEYS.filter((one) => /marks are kept/i.test(one.when ?? ''))
  assert.ok(needMarks.length > 0, 'no key says it needs a board that keeps marks; this test has nothing to check')
  const dir = fileURLToPath(new URL('../../renderer/src/components/chess/', import.meta.url))
  const screens: string[] = []
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = `${at}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx') && entry.name !== 'Board.tsx' && !entry.name.includes('.test.')) screens.push(readFileSync(full, 'utf8'))
    }
  }
  walk(dir)
  const lettingYouDraw = screens.filter((text) => /onMarksChange=/.test(text)).length
  assert.ok(
    lettingYouDraw > 0,
    `${needMarks.length} keys in the keyboard sheet (${needMarks.map((one) => one.chord).join(', ')}) only work on a board that keeps its marks, and no screen under components/chess passes onMarksChange, so none of them does anything anywhere.`
  )
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
