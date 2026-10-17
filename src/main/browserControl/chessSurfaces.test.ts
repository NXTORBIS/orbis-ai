import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResult } from '../../shared/browserControl.ts'
import type { SurfaceDescriptor, SurfaceOutcome } from '../../shared/surfaces.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import {
  CONTROLLABLE_AREAS,
  chessSettingsSurface,
  chessSurface,
  editorSurface,
  enginePanelSurface,
  moveTreeSurface,
  playSurface,
  studySurface
} from '../../renderer/src/components/chess/chessSurfaces.ts'
import { STANDARD_SETUP, pause, resign, startArena, type ArenaSetup, type ArenaState } from '../../shared/chess/arena.ts'
import { timeControlById } from '../../shared/chess/clock.ts'
import { DEFAULT_CHESS_SETTINGS, withField, type ChessSettings, type FieldPath, type GroupId } from '../../shared/chess/settings.ts'
import { START_FEN } from '../../shared/chess/rules.ts'
import { clearBoard, draftToFen, mirrorDraft, placePiece, readFen, startDraft, withCastling, withClocks, withEnPassant, withTurn, type PositionDraft } from '../../shared/chess/variants.ts'
import { inspectPosition } from '../../shared/chess/variants.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * Chess World, driven end to end: the real capabilities in the main process, the real answering code, the real
 * register, and the real declarations the components register.
 *
 * What is missing is the one hop that needs an application -- `control:window-run` between the two processes -- and it
 * is replaced by a function that turns everything into text and back, which is what that hop does to a value. React
 * is not here either, so each screen is stood up the way React stands one up: state in a variable, a setter that
 * changes it and then says the screen has drawn, and a panel that is registered while its tab is open and taken away
 * when it is not.
 *
 * Everything the screens compute, they compute with the module's own code: a game really is started by `startArena`,
 * a position really is read by `readFen`, a setting really is changed by `withField`. So a test that passes here is a
 * test of what the real screens do with what Orbis asks of them, rather than of a mock that agrees with the test.
 */

const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

interface World {
  control: BrowserControl
  shell: { area: string; openGame: string | null; loading: boolean; error: string | null }
  play: { game: ArenaState | null; setup: ArenaSetup; orientation: 'w' | 'b'; engine: string | null }
  study: { panel: string; evaluated: number; sweep: { running: boolean; done: number; total: number; note: string | null }; moveAt: number }
  engine: { limit: 'time' | 'depth'; movetime: number; depth: number; lines: number; running: boolean; asked: { depth?: number; movetime?: number; lines?: number }[] }
  settings: { value: ChessSettings | null; problem: string | null }
  editor: { draft: PositionDraft; tool: string; orientation: 'w' | 'b'; past: PositionDraft[]; stored: { id: string; startFen: string } | null }
  asks: string[]
  approve: boolean
  closeEnginePanel(): void
}

/** The whole of Chess World as the register sees it, with nothing mocked that the module itself can do. */
function chessWorld(area = 'play'): World {
  forgetSurfaces()
  const drawn = (): void => surfacesDrawn()

  const shell = { area, openGame: null as string | null, loading: false, error: null as string | null }
  const games = [
    { id: 'g1', white: 'Ada', black: 'Tal', event: 'A club night' },
    { id: 'g2', white: null, black: null, event: null }
  ]

  const play = {
    game: null as ArenaState | null,
    setup: { ...STANDARD_SETUP } as ArenaSetup,
    orientation: 'w' as 'w' | 'b',
    engine: null as string | null
  }

  const study = {
    panel: 'moves',
    evaluated: 0,
    sweep: { running: false, done: 0, total: 0, note: null as string | null },
    moveAt: 0
  }

  const engine = {
    limit: 'time' as 'time' | 'depth',
    movetime: 3000,
    depth: 20,
    lines: 3,
    running: false,
    asked: [] as { depth?: number; movetime?: number; lines?: number }[]
  }

  const settings = { value: null as ChessSettings | null, problem: null as string | null }

  const editor = {
    draft: startDraft(),
    tool: 'move',
    orientation: 'w' as 'w' | 'b',
    past: [] as PositionDraft[],
    stored: null as { id: string; startFen: string } | null
  }

  // ---------------------------------------------------------------- the shell

  registerSurface(() =>
    chessSurface({
      areas: [
        { id: 'play', label: 'Play', blurb: 'A game against the engine' },
        { id: 'puzzles', label: 'Puzzles', blurb: 'Solve them' },
        { id: 'study', label: 'Study', blurb: 'One game, the engine, and your notes' },
        { id: 'editor', label: 'Set up a position', blurb: 'Place pieces freely' },
        { id: 'settings', label: 'Settings', blurb: 'The board, the engine, sound and notation' },
        { id: 'live', label: 'Live', blurb: 'Tournaments being broadcast' }
      ],
      area: () => shell.area,
      openArea: (id) => {
        shell.area = id
        showArea(id)
      },
      games: () => {
        if (shell.loading) throw new Error('Your games are still being read.')
        if (shell.error !== null) throw new Error(shell.error)
        return games
      },
      openGame: () => shell.openGame,
      study: (id) => {
        shell.openGame = id
        shell.area = 'study'
        showArea('study')
      },
      close: () => {
        shell.area = 'closed'
        drawn()
      }
    })
  )

  // ---------------------------------------------------------------- Play

  const openPlay = (): (() => void) =>
    registerSurface(() =>
      playSurface({
      game: () => play.game,
      setup: () => play.setup,
      setColour: (value) => {
        play.setup = { ...play.setup, side: value }
        drawn()
      },
      setOpponent: (value) => {
        play.setup = { ...play.setup, difficulty: value }
        drawn()
      },
      setClock: (id) => {
        play.setup = { ...play.setup, control: timeControlById(id) ?? play.setup.control }
        drawn()
      },
      setHelp: (value) => {
        play.setup = { ...play.setup, assistance: value }
        drawn()
      },
      setCommentary: (value) => {
        play.setup = { ...play.setup, commentary: value }
        drawn()
      },
      orientation: () => play.orientation,
      setOrientation: (value) => {
        play.orientation = value
        drawn()
      },
      // The same thing the screen's own start button does: the pickers first, then `startArena`.
      start: (chosen) => {
        const next: ArenaSetup = {
          ...play.setup,
          ...(chosen.colour === undefined ? {} : { side: chosen.colour }),
          ...(chosen.opponent === undefined ? {} : { difficulty: chosen.opponent }),
          ...(chosen.clock === undefined ? {} : { control: timeControlById(chosen.clock) ?? play.setup.control })
        }
        play.setup = next
        play.game = startArena(next, { now: 1_000, roll: 0.1 })
        drawn()
        return { opponent: play.game.level.name, colour: next.side, clock: next.control.label }
      },
      whyNoEngine: () => play.engine,
      pause: (wanted) => {
        if (!play.game) return
        play.game = wanted ? pause(play.game, 2_000) : play.game
        drawn()
      },
      resign: () => {
        if (!play.game) return
        const step = resign(play.game, 'you', 3_000)
        if (step.ok) play.game = step.state
        drawn()
      },
      offerDraw: () => undefined,
      hint: () => undefined,
      changeSetup: () => {
        play.game = null
        drawn()
      }
    })
  )

  // ---------------------------------------------------------------- Study, and the panels in it

  let panelOff: (() => void) | null = null
  const openEnginePanel = (): void => {
    if (panelOff) return
    panelOff = registerSurface(() =>
      enginePanelSurface({
        limit: () => engine.limit,
        thinkMs: () => engine.movetime,
        depth: () => engine.depth,
        lines: () => engine.lines,
        set: (change) => {
          if (change.limit !== undefined) engine.limit = change.limit
          if (change.movetime !== undefined) engine.movetime = change.movetime
          if (change.depth !== undefined) engine.depth = change.depth
          if (change.lines !== undefined) engine.lines = change.lines
          drawn()
        },
        // What the real panel does: put what was asked for on the pickers, then wait for the engine's own answer.
        ask: async (limits) => {
          engine.asked.push(limits)
          if (limits.depth !== undefined) {
            engine.limit = 'depth'
            engine.depth = limits.depth
          }
          if (limits.movetime !== undefined) {
            engine.limit = 'time'
            engine.movetime = limits.movetime
          }
          if (limits.lines !== undefined) engine.lines = limits.lines
          engine.running = true
          drawn()
          await Promise.resolve()
          engine.running = false
          study.evaluated += 1
          drawn()
          return { complete: true, depthReached: limits.depth ?? 22, score: '+0.34', best: 'Nf3', lines: engine.lines, note: null }
        },
        stop: () => {
          engine.running = false
          drawn()
        },
        running: () => engine.running,
        whyNot: () => null,
        status: () => 'Stockfish 17 is ready.',
        answer: () => null
      })
    )
    drawn()
  }
  const closeEnginePanel = (): void => {
    panelOff?.()
    panelOff = null
    drawn()
  }

  const openStudyScreen = (): (() => void) =>
    registerSurface(() =>
      studySurface({
      game: () => ({ id: 'g1', moves: 40, white: 'Ada', black: 'Tal' }),
      panel: () => study.panel,
      setPanel: (value) => {
        study.panel = value
        if (value === 'engine') openEnginePanel()
        else closeEnginePanel()
        drawn()
      },
      orientation: () => 'w',
      setOrientation: () => drawn(),
      evaluated: () => study.evaluated,
      sweep: () => study.sweep,
      whyNoSweep: () => null,
      // A whole-game pass: one engine answer per position, the way the real one records them as it goes.
      review: async () => {
        study.sweep = { running: true, done: 0, total: 3, note: 'A 300ms look at each position first.' }
        drawn()
        for (let at = 1; at <= 3; at++) {
          await Promise.resolve()
          study.evaluated += 1
          study.sweep = { ...study.sweep, done: at }
          drawn()
        }
        study.sweep = { running: false, done: 3, total: 3, note: 'Finished: 3 searches.' }
        drawn()
      },
      stopReview: () => {
        study.sweep = { ...study.sweep, running: false }
        drawn()
      },
      saving: () => 'Your lines and notes are kept as you make them.'
    })
  )

  const openMoveTree = (): (() => void) =>
    registerSurface(() =>
      moveTreeSurface({
      rows: () => [],
      ply: () => study.moveAt,
      moves: () => 40,
      goToPly: (ply) => {
        study.moveAt = Math.max(0, Math.min(40, ply))
        drawn()
      },
      back: () => {
        study.moveAt = Math.max(0, study.moveAt - 1)
        drawn()
      },
      forward: () => {
        study.moveAt = Math.min(40, study.moveAt + 1)
        drawn()
      },
      toStart: () => {
        study.moveAt = 0
        drawn()
      },
      toEnd: () => {
        study.moveAt = 40
        drawn()
      },
      onMainLine: () => true,
      canGoOn: () => study.moveAt < 40,
      leaveBranch: () => drawn(),
      canPromote: () => false,
      promote: () => drawn(),
      removeLine: () => drawn(),
      undoable: () => null,
      undo: () => drawn(),
      copyPgn: () => undefined,
      showing: () => study.panel === 'moves'
    })
  )

  // ---------------------------------------------------------------- the settings

  const openSettings = (): (() => void) =>
    registerSurface(() =>
      chessSettingsSurface({
      settings: () => {
        if (!settings.value) throw new Error('Your chess settings are still being read.')
        return settings.value
      },
      // The real screen's own setter: one field at a time, through the model that knows each field's range.
      setField: (path: FieldPath, value) => {
        if (!settings.value) return
        settings.value = withField(settings.value, path, value)
        drawn()
      },
      resetGroup: (group: GroupId) => {
        if (!settings.value) return
        settings.value = { ...settings.value, [group]: { ...DEFAULT_CHESS_SETTINGS[group] } } as ChessSettings
        drawn()
      },
      problem: () => settings.problem,
      fallbacks: () => []
    })
  )

  // ---------------------------------------------------------------- the position editor

  const edit = (next: PositionDraft): void => {
    editor.past.push(editor.draft)
    editor.draft = next
    drawn()
  }

  const openEditor = (): (() => void) =>
    registerSurface(() =>
      editorSurface({
      fen: () => draftToFen(editor.draft),
      setFen: (text) => {
        const got = readFen(text)
        if (!got.ok) throw new Error(got.reason ?? 'That is not a position.')
        edit(got.draft)
      },
      look: () => {
        const look = inspectPosition(draftToFen(editor.draft))
        return { legal: look.legal, faults: look.faults.map((one) => ({ kind: one.kind, says: one.message })), unreachable: look.unreachable.map((one) => one.message) }
      },
      turn: () => editor.draft.turn,
      setTurn: (side) => edit(withTurn(editor.draft, side)),
      castling: () => editor.draft.castling,
      setCastling: (flags) => {
        let next = editor.draft
        for (const flag of ['K', 'Q', 'k', 'q'] as const) next = withCastling(next, flag, flags.includes(flag))
        edit(next)
      },
      enPassant: () => editor.draft.enPassant,
      setEnPassant: (square) => edit(withEnPassant(editor.draft, square)),
      halfmove: () => editor.draft.halfmove,
      fullmove: () => editor.draft.fullmove,
      setClocks: (halfmove, fullmove) => edit(withClocks(editor.draft, halfmove, fullmove)),
      tool: () => editor.tool,
      setTool: (id) => {
        editor.tool = id
        drawn()
      },
      orientation: () => editor.orientation,
      setOrientation: (value) => {
        editor.orientation = value
        drawn()
      },
      place: (square, piece) => {
        if (piece === null) {
          edit(placePiece(editor.draft, square, null))
          return
        }
        const colour = piece[0] === 'b' ? 'b' : 'w'
        const type = piece.slice(1) as 'k' | 'q' | 'r' | 'b' | 'n' | 'p'
        edit(placePiece(editor.draft, square, { type, color: colour }))
      },
      openingPosition: () => edit(startDraft()),
      clearBoard: () => edit(clearBoard(editor.draft)),
      swapColours: () => edit(mirrorDraft(editor.draft)),
      undo: () => {
        const back = editor.past.pop()
        if (back) editor.draft = back
        drawn()
      },
      canUndo: () => editor.past.length > 0,
      redo: () => drawn(),
      canRedo: () => false,
      openForStudy: async () => {
        const fen = draftToFen(editor.draft)
        editor.stored = { id: 'g3', startFen: fen }
        drawn()
        return editor.stored
      },
      whyNotStore: () => (inspectPosition(draftToFen(editor.draft)).legal ? null : 'This is not a chess position yet, so it cannot be stored.')
    })
  )

  /*
   * The rail, as React works it: one area on screen at a time, registered when it is opened and taken away when it
   * is not. This is the part a test of a declaration cannot skip -- a control that is offered and no longer there is
   * the fault the whole register exists to make impossible, and a walk to a panel has to open the area first.
   */
  const open = new Map<string, () => void>()
  const openers: Record<string, () => () => void> = {
    play: openPlay,
    study: () => {
      const offScreen = openStudyScreen()
      const offTree = openMoveTree()
      return () => {
        closeEnginePanel()
        offTree()
        offScreen()
      }
    },
    settings: openSettings,
    editor: openEditor
  }

  function showArea(id: string): void {
    for (const [area, off] of [...open]) {
      if (area === id) continue
      off()
      open.delete(area)
    }
    const opener = openers[id]
    if (opener && !open.has(id)) open.set(id, opener())
    drawn()
  }

  showArea(shell.area)

  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })

  return {
    control,
    shell,
    play,
    study,
    engine,
    settings,
    editor,
    asks,
    closeEnginePanel,
    get approve() {
      return state.approve
    },
    set approve(value: boolean) {
      state.approve = value
    }
  }
}

const run = (world: World, capability: string, params: Record<string, unknown>, source: 'user' | 'orion' = 'user'): Promise<CommandResult> =>
  world.control.execute(
    { capability, params, source },
    {
      confirm: async (request) => {
        world.asks.push(request.action)
        return world.approve
      }
    }
  )

// ---------------------------------------------------------------- what is there

test('Chess World says what is in it, and which of its areas can be opened', async () => {
  const world = chessWorld()
  const got = await run(world, 'screen.tree', { path: 'chess', depth: 0 })
  assert.equal(got.ok, true, got.error?.message)
  const data = got.data as { surfaces: SurfaceDescriptor[] }
  const chess = data.surfaces[0]
  assert.equal(chess.name, 'Chess World')
  assert.equal(chess.kind, 'module')
  /*
   * The areas it offers to open are the ones named in CONTROLLABLE_AREAS, which is the list of areas whose screens
   * really register a surface -- all seventeen of them. This world draws six of the seventeen, so six are offered.
   */
  assert.deepEqual(
    chess.possibleChildren?.map((one) => one.id),
    ['play', 'puzzles', 'study', 'editor', 'settings', 'live']
  )
  assert.equal(CONTROLLABLE_AREAS.length, 17, 'every area of Chess World says what can be done on it')
  assert.ok(chess.possibleChildren?.every((one) => one.reach.kind === 'control'), 'each one is reached by setting the area')
  // Only the one that is really on screen is in the tree. The rail mounts one area at a time.
  assert.deepEqual(data.surfaces.filter((one) => one.parent === 'chess').map((one) => one.id), [])
})

test('the area that is open is inside Chess World in the tree, and the one that is not is gone', async () => {
  const world = chessWorld()
  const first = await run(world, 'screen.tree', { path: 'chess', depth: 1 })
  assert.deepEqual((first.data as { surfaces: SurfaceDescriptor[] }).surfaces.map((one) => one.id), ['chess', 'play'])

  const moved = await run(world, 'screen.write', { path: 'chess/area', value: 'settings' })
  assert.equal(moved.ok, true, moved.error?.message)
  const now = await run(world, 'screen.tree', { path: 'chess', depth: 1 })
  assert.deepEqual((now.data as { surfaces: SurfaceDescriptor[] }).surfaces.map((one) => one.id), ['chess', 'settings'])

  const gone = await run(world, 'screen.read', { path: 'chess/play/opponent' })
  assert.equal(gone.ok, false)
  assert.match(gone.error?.message ?? '', /Chess World has nothing called “play”/)
})

// ---------------------------------------------------------------- the settings: thirty fields from the model

test('every settings field is offered with its own type, range and default', async () => {
  const world = chessWorld('settings')
  world.settings.value = { ...DEFAULT_CHESS_SETTINGS }
  const got = await run(world, 'screen.tree', { path: 'chess/settings', depth: 0 })
  const page = (got.data as { surfaces: SurfaceDescriptor[] }).surfaces[0]
  assert.equal(page.controls.length, 30, 'all thirty fields, read out of FIELDS rather than written out again')

  const depth = page.controls.find((one) => one.id === 'engine-depth')!
  assert.equal(depth.spec.type, 'integer')
  assert.equal(depth.spec.min, 1)
  assert.equal(depth.spec.max, 40, 'the range the engine channel really accepts')
  assert.equal(depth.default, 18)
  assert.equal(depth.writable, true)

  const theme = page.controls.find((one) => one.id === 'board-theme')!
  assert.deepEqual(theme.spec.enum, ['slate', 'walnut', 'forest', 'ink', 'contrast'])
})

test('a setting nothing reads yet is a reading that cannot be set, with the sentence saying what is waiting on it', async () => {
  const world = chessWorld('settings')
  world.settings.value = { ...DEFAULT_CHESS_SETTINGS }

  const numbers = await run(world, 'screen.read', { path: 'chess/settings/moves-numbers' })
  assert.equal(numbers.ok, true)
  const reading = numbers.data as { value: unknown; readable: boolean; writable: boolean; note?: string }
  assert.equal(reading.readable, true, 'the value is really kept, so it is really read')
  assert.equal(reading.writable, false)
  assert.match(reading.note ?? '', /does not read this yet/)

  const tried = await run(world, 'screen.write', { path: 'chess/settings/moves-numbers', value: false })
  assert.equal(tried.ok, false)
  assert.equal(tried.error?.code, 'invalid-params')
  assert.match(tried.error?.message ?? '', /Nothing reads this yet/)
})

test('a setting the engine sizes itself is not reported as a number nobody set', async () => {
  const world = chessWorld('settings')
  world.settings.value = { ...DEFAULT_CHESS_SETTINGS }
  const got = await run(world, 'screen.read', { path: 'chess/settings/engine-threads' })
  assert.equal(got.ok, true)
  const reading = got.data as { value: unknown; readable: boolean; note?: string }
  assert.equal(reading.readable, false, 'nothing can ask the engine what it chose')
  assert.equal(reading.value, null, 'never the 2 that is in the file and reaches nothing')
  assert.match(reading.note ?? '', /Stockfish sizes it itself/)
})

test('a setting is changed through the screen’s own model, and confirmed by reading it back', async () => {
  const world = chessWorld('settings')
  world.settings.value = { ...DEFAULT_CHESS_SETTINGS }

  const got = await run(world, 'screen.write', { path: 'chess/settings/board-theme', value: 'walnut' })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal(world.settings.value?.board.theme, 'walnut', 'the screen’s own setter ran')
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.match(got.verification?.detail ?? '', /Board colours is now “walnut”/)

  // Said the way it is written on screen rather than the way it is written in the code.
  const byLabel = await run(world, 'screen.write', { path: 'chess/settings/board colours', value: 'Forest' })
  assert.equal(byLabel.ok, true, byLabel.error?.message)
  assert.equal(world.settings.value?.board.theme, 'forest')
})

test('a number outside a setting’s range is refused with the range, and nothing is touched', async () => {
  const world = chessWorld('settings')
  world.settings.value = { ...DEFAULT_CHESS_SETTINGS }
  const got = await run(world, 'screen.write', { path: 'chess/settings/engine-depth', value: 99 })
  assert.equal(got.ok, false)
  assert.equal(got.error?.code, 'invalid-params')
  assert.match(got.error?.message ?? '', /at most 40/)
  assert.equal(world.settings.value?.engine.depth, 18, 'nothing was clamped and nothing was set')
})

test('a setting read before the profile has answered says it could not be read, not that it is off', async () => {
  const world = chessWorld('settings')
  const got = await run(world, 'screen.read', { path: 'chess/settings/sound-enabled' })
  assert.equal(got.ok, true)
  const reading = got.data as { readable: boolean; value: unknown; note?: string }
  assert.equal(reading.readable, false)
  assert.equal(reading.value, null)
  assert.match(reading.note ?? '', /still being read/)
})

test('a group of settings is put back to the way it came, and the answer rests on reading every one of them', async () => {
  const world = chessWorld('settings')
  world.settings.value = { ...DEFAULT_CHESS_SETTINGS, sound: { ...DEFAULT_CHESS_SETTINGS.sound, enabled: true, volume: 5 } }
  const got = await run(world, 'screen.do', { path: 'chess/settings/reset', params: { group: 'sound' } })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal(world.settings.value?.sound.volume, 55)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.match(got.verification?.detail ?? '', /Sound is back to the way it came: 6 settings/)
})

// ---------------------------------------------------------------- Play

test('a game against a named opponent is started and confirmed from the game itself', async () => {
  const world = chessWorld()
  const got = await run(world, 'screen.do', { path: 'chess/play/start', params: { opponent: 'gentle', colour: 'b', clock: '180+2' } })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal(world.play.game?.level.id, 'gentle')
  assert.equal(world.play.game?.human, 'b')
  assert.equal(world.play.setup.control.id, '180+2', 'the pickers say what is being played, not something else')
  assert.match(got.verification?.detail ?? '', /A game against Gentle has started\. You are Black, 3 \+ 2/)
})

test('while a game is on, the pickers say why they cannot be set', async () => {
  const world = chessWorld()
  await run(world, 'screen.do', { path: 'chess/play/start', params: {} })
  const got = await run(world, 'screen.write', { path: 'chess/play/opponent', value: 'full' })
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /A game is going on.*changeSetup first/)
  assert.equal(world.play.setup.difficulty, 'club', 'nothing changed')

  // And the way out of it is the one the sentence names.
  const back = await run(world, 'screen.do', { path: 'chess/play/changeSetup' })
  assert.equal(back.ok, true, back.error?.message)
  assert.equal(world.play.game, null)
  assert.equal((await run(world, 'screen.write', { path: 'chess/play/opponent', value: 'full' })).ok, true)
})

test('resigning asks the person first, and is confirmed by the game being over', async () => {
  const world = chessWorld()
  await run(world, 'screen.do', { path: 'chess/play/start', params: {} })

  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'chess/play/resign' }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  // Read it out first: asserting it is null here would narrow the field for the rest of the test.
  const stillGoing = world.play.game?.finish
  assert.equal(stillGoing, null, 'the game is still going')
  assert.deepEqual(world.asks, ['Do chess/play/resign in Orbis'])

  world.approve = true
  const done = await run(world, 'screen.do', { path: 'chess/play/resign' }, 'orion')
  assert.equal(done.ok, true, done.error?.message)
  assert.equal(world.play.game?.finish?.forYou, 'loss')
  assert.match(done.verification?.detail ?? '', /The game is over/)
})

test('an action that cannot be done right now is blocked with the reason, before anything is tried', async () => {
  const world = chessWorld()
  const got = await run(world, 'screen.do', { path: 'chess/play/hint' }, 'orion')
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /No game is on\. Start one first\./)

  world.play.engine = 'The chess engine has not been set up on this computer yet, so there is no opponent.'
  const noEngine = await run(world, 'screen.do', { path: 'chess/play/start', params: {} }, 'orion')
  assert.equal(noEngine.ok, false)
  assert.match(noEngine.error?.message ?? '', /has not been set up/)
  assert.equal(world.play.game, null)
})

// ---------------------------------------------------------------- Study and the engine panel

test('getting to the engine panel opens the panel nobody mentioned, and then it can be asked', async () => {
  const world = chessWorld()
  const there = await run(world, 'screen.goTo', { path: 'chess/study/engine' })
  assert.equal(there.ok, true, there.error?.message)
  const where = there.data as { opened: string[]; alreadyThere: boolean }
  assert.deepEqual(where.opened, ['chess/study', 'chess/study/engine'], 'the area and then the panel')
  assert.equal(world.shell.area, 'study')
  assert.equal(world.study.panel, 'engine')

  // Analysing to a depth: what was asked for is put on the panel, and the answer is the engine's own.
  const asked = await run(world, 'screen.do', { path: 'chess/study/engine/analyse', params: { depth: 24 } })
  assert.equal(asked.ok, true, asked.error?.message)
  assert.equal((asked.data as SurfaceOutcome).status, 'completed')
  assert.deepEqual(world.engine.asked, [{ depth: 24 }])
  assert.equal(world.engine.limit, 'depth')
  assert.equal(world.engine.depth, 24, 'the panel shows what really ran')
  assert.match(asked.verification?.detail ?? '', /The engine makes it \+0\.34 at depth 24, best move Nf3, over 3 lines/)
})

test('a depth outside what the engine channel takes is refused, and the engine is never asked', async () => {
  const world = chessWorld()
  await run(world, 'screen.goTo', { path: 'chess/study/engine' })
  const got = await run(world, 'screen.do', { path: 'chess/study/engine/analyse', params: { depth: 99 } })
  assert.equal(got.ok, false)
  assert.equal(got.error?.code, 'invalid-params')
  assert.match(got.error?.message ?? '', /at most 40/)
  assert.deepEqual(world.engine.asked, [], 'nothing was asked of the engine')
})

test('a control that only matters under one setting says what would make it settable', async () => {
  const world = chessWorld()
  await run(world, 'screen.goTo', { path: 'chess/study/engine' })

  const tooSoon = await run(world, 'screen.write', { path: 'chess/study/engine/depth', value: 30 })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /Set limit to "depth" first/)

  assert.equal((await run(world, 'screen.write', { path: 'chess/study/engine/limit', value: 'depth' })).ok, true)
  const now = await run(world, 'screen.write', { path: 'chess/study/engine/depth', value: 30 })
  assert.equal(now.ok, true, now.error?.message)
  assert.equal(world.engine.depth, 30)
})

test('the panel stops being offered the moment it is not on screen', async () => {
  const world = chessWorld()
  await run(world, 'screen.goTo', { path: 'chess/study/engine' })
  assert.equal((await run(world, 'screen.read', { path: 'chess/study/engine/depth' })).ok, true)

  world.closeEnginePanel()
  const gone = await run(world, 'screen.read', { path: 'chess/study/engine/depth' })
  assert.equal(gone.ok, false)
  assert.equal(gone.error?.code, 'not-found')
})

test('setting which panel is on screen is confirmed as the control it was, not as the panel it opened', async () => {
  const world = chessWorld()
  await run(world, 'screen.goTo', { path: 'chess/study' })

  /*
   * The regression this is here for.
   *
   * While the engine panel's own id was `engine-panel`, writing `chess/study/panel` set the control, the panel
   * appeared, and then reading the same path back found the new *panel* -- because a surface wins over a control and
   * "panel" is one of the words in `engine-panel`. The write had worked and was reported as unconfirmed, after a
   * second and a half of waiting for a reading that could never come.
   */
  const started = Date.now()
  const got = await run(world, 'screen.write', { path: 'chess/study/panel', value: 'engine' })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal(world.study.panel, 'engine')
  assert.ok(Date.now() - started < 500, `a write that worked must not wait for a reading that cannot come (took ${Date.now() - started}ms)`)
  assert.equal((await run(world, 'screen.read', { path: 'chess/study/panel' })).ok, true, 'and the control is still the thing that path finds')
})

test('a game review says how many more positions have an engine answer than before', async () => {
  const world = chessWorld()
  await run(world, 'screen.goTo', { path: 'chess/study' })
  const got = await run(world, 'screen.do', { path: 'chess/study/review' })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal(world.study.evaluated, 3)
  assert.match(got.verification?.detail ?? '', /3 more positions now have an engine answer: 3 of them in all\. Finished: 3 searches\./)
})

test('stepping through a game is confirmed by the move number afterwards, and the end of the line says so', async () => {
  const world = chessWorld()
  await run(world, 'screen.goTo', { path: 'chess/study' })

  const forward = await run(world, 'screen.do', { path: 'chess/study/move-tree/forward' })
  assert.equal(forward.ok, true, forward.error?.message)
  assert.equal(world.study.moveAt, 1)
  assert.equal(forward.verification?.detail, 'The board is at move 1.')

  /*
   * The same place, set outright rather than stepped to.
   *
   * By its own path: `chess/study/move` resolves to the move-tree panel itself, because a surface wins over a
   * control when a name could be either -- `move-tree` starts with `move`. The answer says which it found, which is
   * what makes that forgiveness safe rather than a quiet mis-set.
   */
  const panel = await run(world, 'screen.write', { path: 'chess/study/move', value: 40 })
  assert.equal(panel.ok, false)
  assert.match(panel.error?.message ?? '', /is a screen, not something that holds a value/)

  const jumped = await run(world, 'screen.write', { path: 'chess/study/move-tree/move', value: 40 })
  assert.equal(jumped.ok, true, jumped.error?.message)
  assert.equal(world.study.moveAt, 40)

  const again = await run(world, 'screen.do', { path: 'chess/study/move-tree/forward' }, 'orion')
  assert.equal(again.ok, false)
  assert.match(again.error?.message ?? '', /The board is at the end of this line/)
})

// ---------------------------------------------------------------- the position editor

test('a position is set up from a FEN and read back off the board', async () => {
  const world = chessWorld('editor')
  const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
  const got = await run(world, 'screen.write', { path: 'chess/editor/position', value: fen })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal(draftToFen(world.editor.draft), fen)

  // And a line that is not a position is refused, with the board left exactly as it was.
  const refused = await run(world, 'screen.write', { path: 'chess/editor/position', value: 'not a position at all' })
  assert.equal(refused.ok, false)
  assert.equal(draftToFen(world.editor.draft), fen, 'half a position is worse than none')
})

test('a piece is put on a square and the board is read to prove it', async () => {
  const world = chessWorld('editor')
  await run(world, 'screen.write', { path: 'chess/editor/position', value: '4k3/8/8/8/8/8/8/4K3 w - - 0 1' })
  const got = await run(world, 'screen.do', { path: 'chess/editor/place', params: { square: 'd4', piece: 'wq' } })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.match(got.verification?.detail ?? '', /There is a white queen on d4/)
  assert.equal(draftToFen(world.editor.draft).startsWith('4k3/8/8/8/3Q4/8/8/4K3'), true)

  const off = await run(world, 'screen.do', { path: 'chess/editor/place', params: { square: 'd4' } })
  assert.equal(off.ok, true, off.error?.message)
  assert.equal(off.verification?.detail, 'd4 is empty.')
})

test('a position that is not a chess position cannot be opened for study, and says what is wrong', async () => {
  const world = chessWorld('editor')
  await run(world, 'screen.do', { path: 'chess/editor/clearBoard' })
  const got = await run(world, 'screen.do', { path: 'chess/editor/openForStudy' }, 'orion')
  assert.equal(got.ok, false)
  assert.match(got.error?.message ?? '', /not a chess position yet/)
  // Same reason: keep the null check off the field itself.
  const beforeStore = world.editor.stored
  assert.equal(beforeStore, null)

  await run(world, 'screen.do', { path: 'chess/editor/openingPosition' })
  const stored = await run(world, 'screen.do', { path: 'chess/editor/openForStudy' })
  assert.equal(stored.ok, true, stored.error?.message)
  assert.equal(world.editor.stored?.startFen, START_FEN)
  assert.match(stored.verification?.detail ?? '', /Stored as the game g3, starting at/)
})

// ---------------------------------------------------------------- the shell's own job

test('a game of yours is opened in the Study screen, and the game that is open is read back', async () => {
  const world = chessWorld()
  const got = await run(world, 'screen.do', { path: 'chess/openGame', params: { game: 'g1', move: 12 } })
  assert.equal(got.ok, true, got.error?.message)
  assert.equal((got.data as SurfaceOutcome).status, 'completed')
  assert.equal(world.shell.area, 'study')
  assert.equal(world.shell.openGame, 'g1')

  const missing = await run(world, 'screen.do', { path: 'chess/openGame', params: { game: 'nope' } })
  assert.equal(missing.ok, false)
  assert.equal(missing.error?.code, 'failed')
  assert.match(missing.error?.message ?? '', /no game of yours with the id “nope”/)
})

test('what is on screen is in the state Orion is given, and a Library that could not be read says so', async () => {
  const world = chessWorld()
  const got = await run(world, 'screen.state', { path: 'chess' })
  const values = (got.data as { state: { values: Record<string, unknown> } }).state.values
  assert.equal(values.games, 2)
  assert.equal(values.area, 'play')

  world.shell.error = 'Your games could not be read (the file is locked).'
  const broken = await run(world, 'screen.state', { path: 'chess' })
  const state = (broken.data as { state: { unavailableReason?: string } }).state
  assert.match(state.unavailableReason ?? '', /could not be read \(the file is locked\)/)
})
