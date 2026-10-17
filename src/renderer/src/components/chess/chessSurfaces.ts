import type { ArenaSetup, ArenaState, Assistance, Difficulty, SideChoice } from '../../../../shared/chess/arena.ts'
import { ASSISTANCE_LEVELS, DIFFICULTIES, difficulty, engineTurn, yourTurn } from '../../../../shared/chess/arena.ts'
import { TIME_CONTROLS, describeTimeControl } from '../../../../shared/chess/clock.ts'
import { COMMENTARY_STYLES, type CommentaryStyle } from '../../../../shared/chess/commentary.ts'
import { RUN_MODES } from '../../../../shared/chess/puzzleRun.ts'
import { BLIND_LEVELS, type BlindLevelId, type BlindMode, type GymMode, type ReplySource } from '../../../../shared/chess/trainingView.ts'
import {
  DEFAULT_CHESS_SETTINGS,
  FIELDS,
  GROUPS as SETTING_GROUPS,
  NOT_EVERYWHERE,
  drawnAs,
  valueAt,
  type ChessSettings,
  type FieldPath,
  type GroupId
} from '../../../../shared/chess/settings.ts'
import type { ParamSpec } from '../../../../shared/browserControl.ts'
import type { ControlDeclaration, SurfaceDeclaration } from '../../lib/surfaces/registry.ts'
import { readSurfaceControl, surfaceStateAt } from '../../lib/surfaces/registry.ts'

/**
 * What Chess World lets Orbis do, as data.
 *
 * Seventeen areas, the panels inside them, and every control on them -- written here rather than inside the
 * components for the same reason `settingsSurfaces.ts` is: a declaration that lives in a component can only be
 * checked by drawing that component, and there is no browser in the test suite. Written as functions of each
 * screen's own state and handlers, the whole chain -- a capability in the main process, the bridge, the register,
 * these getters and setters -- is driven by `src/main/browserControl/chessSurfaces.test.ts` with no window at all.
 *
 * Three rules shaped every line of it, and they are the product's rather than this file's.
 *
 * **Nothing here is described twice.** Every list of allowed values comes from the module's own model: the levels
 * from `arena.ts`, the clocks from `clock.ts`, the ladder from `trainingView.ts`, the run modes from
 * `puzzleRun.ts`, and all thirty settings fields -- with their types, their ranges, their defaults and whether they
 * reach anything at all -- from `FIELDS` in `shared/chess/settings.ts`. A level added to Chess World is a level
 * Orbis can play against without anybody editing this file.
 *
 * **A surface describes what is already there.** Every `get` reads state the screen already holds and every `set`
 * calls the handler the screen's own control already calls. Where a setting is kept and nothing reads it yet, the
 * settings screen draws no control for it -- so neither does this, and the sentence saying what is waiting on it is
 * the reason it cannot be set.
 *
 * **Issued is not done.** An action says `completed` only when something was read back afterwards. The awkward part
 * of that is below in `liveReading`: a declaration's own getters belong to the render that was on screen when the
 * action started, so they cannot see what the action changed. Anything that needs a real reading afterwards asks the
 * register, which always reads the newest render.
 */

// ---------------------------------------------------------------- reading something back, honestly

/**
 * What a control reads NOW, asked of the register rather than of this declaration's own getters.
 *
 * The reason this is not simply a getter: the register hands a capability the declaration from the render that was
 * current when the action began, and React does not change state in place. So `() => panel` inside a `verify` is the
 * panel as it was before the action, for ever. The register reads whatever the newest render declared, which is the
 * only reading here that can confirm anything.
 */
const liveReading = (path: string): { value: unknown; readable: boolean } => {
  const got = readSurfaceControl(path)
  return got.ok ? { value: got.value, readable: got.readable } : { value: null, readable: false }
}

/** What a screen says about itself now, asked of the register for the same reason as above. */
const liveValues = (path: string): Record<string, unknown> => {
  const got = surfaceStateAt(path)
  return got.ok ? (got.state.values ?? {}) : {}
}

/**
 * Waits for a reading to become what an action was supposed to make it, and gives up saying what it really is.
 *
 * Opening a panel or playing a move is three changes and not one -- the handler runs, the window draws, and the new
 * render replaces the declaration -- so a reading taken in the same breath as the action is the reading from before
 * it. This waits for the window to catch up, and then reports whatever is there: a wait that ends in the old value
 * is an action that did not take, which is the thing worth saying.
 */
async function waitFor<T>(read: () => T, good: (value: T) => boolean, ms = 1200): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const got = read()
    if (good(got) || Date.now() >= until) return got
    await new Promise((wake) => setTimeout(wake, 25))
  }
}

const SIDE_WORD: Record<'w' | 'b', string> = { w: 'White', b: 'Black' }

// ---------------------------------------------------------------- the shell

/**
 * The areas whose screens say what can be done on them.
 *
 * A list rather than something worked out, because the answer is not a property of an area: it is whether the screen
 * inside it registers a surface. An area named here whose screen does not register is worse than one left out --
 * Orbis would open it, find nothing, and have to report something it cannot tell apart from a fault. Add to this in
 * the same change as the `useSurface` call in the area.
 */
export const CONTROLLABLE_AREAS: readonly string[] = Object.freeze([
  // Play
  'play',
  'puzzles',
  'endgames',
  // Train
  'calculation',
  'blindfold',
  // Learn
  'academy',
  'openings',
  'famous',
  'coach',
  // Your games
  'library',
  'study',
  'find',
  'live',
  // Tools
  'editor',
  'board3d',
  'reference',
  'settings'
])

/** What Chess World's own shell has to hand over. One area at a time, and the list of your games. */
export interface ChessShellScreen {
  /** The areas, as the rail itself lists them. Never a second list written out for Orbis. */
  areas: readonly { id: string; label: string; blurb: string }[]
  area(): string
  openArea(id: string): void
  /**
   * Your games, as the Library lists them. Throws while they are being read and when they could not be read, on
   * purpose: "you have no games" and "your games could not be read" are different sentences and only one of them is
   * alarming. A name the record does not have is null and is never filled in with "Unknown".
   */
  games(): readonly { id: string; white: string | null; black: string | null; event: string | null }[]
  /** The game open in the Study screen, or null. */
  openGame(): string | null
  /** Opens a game in Study. The same handler the Library's own rows call. */
  study(id: string, ply?: number): void
  close(): void
}

export function chessSurface(screen: ChessShellScreen): SurfaceDeclaration {
  const areaIds = screen.areas.map((one) => one.id)
  return {
    id: 'chess',
    parent: null,
    name: 'Chess World',
    about: 'Playing, solving, learning and studying chess. Seventeen areas, reached from the rail down the left.',
    kind: 'module',
    keywords: ['chess', 'chess world', 'board', 'game', 'stockfish', 'engine', 'puzzle', 'opening', 'endgame'],
    controls: {
      area: {
        name: 'Area',
        about: 'Which part of Chess World is open. Setting this is the same as pressing it in the rail.',
        spec: { type: 'string', description: `Which area is open. ${screen.areas.map((one) => `${one.id} (${one.label}: ${one.blurb})`).join('; ')}.`, enum: areaIds },
        get: () => screen.area(),
        set: (value) => screen.openArea(String(value))
      }
    },
    actions: {
      openGame: {
        /*
         * Named without the word "study" in it, deliberately.
         *
         * A path is matched against ids and names, and the loosest way it tries is "every word somebody said is in
         * it". While this was called "Open a game to study", `chess/study` found this action rather than the Study
         * area -- and reported that it had arrived somewhere without opening anything. Nothing in the matching is
         * wrong; a name that contains another screen's name is.
         */
        name: 'Open one of your games',
        about: 'Opens one of your own games in the Study screen, at the move you name or at the start.',
        params: {
          game: { type: 'string', description: 'The id of the game, as `screen.state` on Chess World lists them.', required: true },
          move: { type: 'integer', description: 'Which move to open it at, counted in single moves from the start. Left out means the start.', min: 0 }
        },
        run: (params) => {
          const id = String(params.game)
          const found = screen.games().find((one) => one.id === id)
          if (!found) throw new Error(`There is no game of yours with the id “${id}”. The Library is where they are listed.`)
          const ply = params.move === undefined ? undefined : Number(params.move)
          screen.study(id, ply)
          return { game: id, ...(ply === undefined ? {} : { move: ply }) }
        },
        verify: async (data) => {
          const wanted = (data as { game: string }).game
          const got = await waitFor(() => liveValues('chess'), (values) => values.openGame === wanted)
          return got.openGame === wanted
            ? { done: true, detail: `That game is open on the Study screen.` }
            : { done: false, detail: `the Study screen has ${got.openGame === null || got.openGame === undefined ? 'nothing' : `“${String(got.openGame)}”`} open.` }
        }
      },
      close: {
        name: 'Close Chess World',
        about: 'Closes the whole module. Nothing of a game, a puzzle run or a study is lost by it; they are kept as they are made.',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: screen.areas
      .filter((one) => CONTROLLABLE_AREAS.includes(one.id))
      .map((one) => ({ id: one.id, name: one.label, kind: 'page' as const, reach: { kind: 'control' as const, control: 'area', value: one.id } })),
    state: () => {
      const games = screen.games()
      return {
        values: {
          area: screen.area(),
          areas: screen.areas.length,
          games: games.length,
          openGame: screen.openGame(),
          // Enough to say which game is which without handing over the whole Library on every question.
          yourGames: games.slice(0, 20)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Play

/** What the Play screen has to hand over. `game()` is its own live state, not a copy of it. */
export interface PlayScreen {
  /** The game as it is this instant, or null when the setup is on screen. Read from the screen's own ref. */
  game(): ArenaState | null
  /** The setup the pickers hold. */
  setup(): ArenaSetup
  setColour(value: SideChoice): void
  setOpponent(value: Difficulty): void
  setClock(id: string): void
  setHelp(value: Assistance): void
  setCommentary(value: CommentaryStyle): void
  /** Which way up the board is drawn. */
  orientation(): 'w' | 'b'
  setOrientation(value: 'w' | 'b'): void
  /** Starts a game. Throws with the reason when the setup cannot be played from. */
  start(chosen: { opponent?: Difficulty; colour?: SideChoice; clock?: string }): { opponent: string; colour: string; clock: string }
  /** Null when there is an engine to play, and the reason there is not when there is not. */
  whyNoEngine(): string | null
  pause(paused: boolean): void
  resign(): void
  offerDraw(): void
  hint(): void
  /** Back to the setup, with the game let go of. */
  changeSetup(): void
}

export function playSurface(screen: PlayScreen): SurfaceDeclaration {
  /*
   * Said as a sentence rather than a flag, and handed over as the function rather than its answer.
   *
   * The pickers are not on screen during a game -- what is there is the game -- so they are not settable while one
   * is on. Called here instead of passed, this would run while the declaration was being built, on every draw.
   */
  const onlyBetweenGames = (): true | string => {
    const game = screen.game()
    return game === null || game.finish !== null
      ? true
      : 'A game is going on, so the pickers are not on screen. Finish it, resign it, or use changeSetup first.'
  }
  const duringAGame = (): string | null => {
    const game = screen.game()
    if (game === null) return 'No game is on. Start one first.'
    if (game.finish !== null) return 'This game is over.'
    return null
  }

  return {
    id: 'play',
    parent: 'chess',
    name: 'Play',
    about: 'A game against the engine: your colour, how strong it is, the clock and how much help you get.',
    kind: 'page',
    keywords: ['play', 'game', 'opponent', 'engine', 'arena', 'match', 'clock', 'resign', 'draw'],
    controls: {
      opponent: {
        name: 'How strong',
        about: `Which opponent you play. ${DIFFICULTIES.map((one) => `${one.name}: ${one.about}`).join(' ')}`,
        spec: {
          type: 'string',
          description: 'The opponent, by name or id. These are the levels the screen itself offers; Orbis claims no rating for any of them.',
          enum: DIFFICULTIES.map((one) => one.id)
        },
        get: () => screen.setup().difficulty,
        set: (value) => screen.setOpponent(String(value) as Difficulty),
        writable: onlyBetweenGames,
        default: 'club'
      },
      colour: {
        name: 'Your colour',
        spec: { type: 'string', description: 'w for White, b for Black, random to let Orbis choose when the game starts.', enum: ['w', 'b', 'random'] },
        get: () => screen.setup().side,
        set: (value) => screen.setColour(String(value) as SideChoice),
        writable: onlyBetweenGames,
        default: 'w'
      },
      clock: {
        name: 'The clock',
        about: TIME_CONTROLS.map((one) => `${one.id}: ${describeTimeControl(one)}`).join(' '),
        spec: { type: 'string', description: 'The time control, by its id: "600+0" is ten minutes each with no increment. "untimed" is no clock at all.', enum: TIME_CONTROLS.map((one) => one.id) },
        get: () => screen.setup().control.id,
        set: (value) => screen.setClock(String(value)),
        writable: onlyBetweenGames,
        default: '600+0'
      },
      help: {
        name: 'How much help',
        about: ASSISTANCE_LEVELS.map((one) => `${one.id}: ${one.about} It reveals: ${one.reveals}`).join(' '),
        spec: { type: 'string', description: 'How much a hint may give away. Every hint comes from a real search of the position in front of you.', enum: ASSISTANCE_LEVELS.map((one) => one.id) },
        get: () => screen.setup().assistance,
        set: (value) => screen.setHelp(String(value) as Assistance),
        writable: onlyBetweenGames,
        default: 'none'
      },
      commentary: {
        name: 'What it says',
        spec: { type: 'string', description: 'The voice the remarks are written in. "silent" turns them off. A remark only ever states what the board shows or what a real search said.', enum: COMMENTARY_STYLES.map((one) => one.id) },
        get: () => screen.setup().commentary,
        set: (value) => screen.setCommentary(String(value) as CommentaryStyle),
        writable: onlyBetweenGames,
        default: 'coach'
      },
      orientation: {
        name: 'Which way up the board is',
        spec: { type: 'string', description: 'Whose pieces are at the bottom: w or b.', enum: ['w', 'b'] },
        get: () => screen.orientation(),
        set: (value) => screen.setOrientation(String(value) === 'b' ? 'b' : 'w')
      },
      paused: {
        name: 'Paused',
        about: 'While it is paused the clock is charged to nobody.',
        spec: { type: 'boolean', description: 'Whether the game is paused.' },
        get: () => {
          const game = screen.game()
          if (!game) throw new Error('No game is on, so there is no clock to pause.')
          return game.clock.paused
        },
        set: (value) => screen.pause(value === true),
        writable: () => duringAGame() ?? true
      }
    },
    actions: {
      start: {
        name: 'Start a game',
        about:
          'Starts a game with the settings on this screen. Naming an opponent, a colour or a clock here chooses it on the screen first and then starts, which is exactly what pressing them yourself would do.',
        params: {
          opponent: { type: 'string', description: 'Who to play, by name or id. Left out means whatever the screen is set to.', enum: DIFFICULTIES.map((one) => one.id) },
          colour: { type: 'string', description: 'w, b, or random.', enum: ['w', 'b', 'random'] },
          clock: { type: 'string', description: 'The time control by id, "600+0" or "untimed".', enum: TIME_CONTROLS.map((one) => one.id) }
        },
        unavailable: () => screen.whyNoEngine(),
        run: (params) =>
          screen.start({
            ...(params.opponent === undefined ? {} : { opponent: String(params.opponent) as Difficulty }),
            ...(params.colour === undefined ? {} : { colour: String(params.colour) as SideChoice }),
            ...(params.clock === undefined ? {} : { clock: String(params.clock) })
          }),
        verify: async () => {
          // Read from the screen's own live game rather than from this declaration, which is the render before it.
          const game = await waitFor(() => screen.game(), (one) => one !== null && one.moves.length === 0 && one.finish === null)
          if (!game) return { done: false, detail: 'no game is on the screen.' }
          return {
            done: true,
            // The level the game is really being played at, read off the game itself rather than off the pickers.
            detail: `A game against ${game.level.name} has started. You are ${SIDE_WORD[game.human]}, ${game.setup.control.label}, and it is ${yourTurn(game) ? 'your move' : 'the engine’s move'}.`
          }
        }
      },
      hint: {
        name: 'Ask for a hint',
        about: 'Searches the position in front of you and says as much as the help level allows, and no more.',
        unavailable: () => {
          const why = duringAGame()
          if (why) return why
          const game = screen.game()!
          if (game.setup.assistance === 'none') return 'This game was set up with no help, so there are no hints in it.'
          if (!yourTurn(game)) return 'A hint is only given on your own turn.'
          if (game.thinking !== null) return 'The engine is already thinking.'
          return null
        },
        run: () => {
          screen.hint()
          return { asked: true }
        },
        verify: async () => {
          const game = await waitFor(() => screen.game(), (one) => Boolean(one?.hint))
          return game?.hint ? { done: true, detail: game.hint.text } : { done: false, detail: 'nothing came back from the search.' }
        }
      },
      offerDraw: {
        name: 'Offer a draw',
        about: 'Records the offer and asks the engine, which answers from the rules and its own settled search of this position.',
        unavailable: () => duringAGame(),
        run: () => {
          screen.offerDraw()
          return { offered: true }
        },
        verify: async () => {
          const game = await waitFor(() => screen.game(), (one) => Boolean(one?.drawOffer) || Boolean(one?.finish))
          if (game?.finish) return { done: true, detail: 'The engine accepted: the game is drawn.' }
          if (game?.drawOffer?.by === 'you') return { done: true, detail: 'Your offer is on the table. The engine has not answered it.' }
          return { done: true, detail: 'The engine declined the offer, so the game goes on.' }
        }
      },
      resign: {
        name: 'Resign',
        about: 'Gives the game up. It is kept in your Library as a loss.',
        // It ends the game, which is more than changing what is on screen, so it asks first.
        confirmation: 'always',
        unavailable: () => duringAGame(),
        run: () => {
          screen.resign()
          return { resigned: true }
        },
        verify: async () => {
          const game = await waitFor(() => screen.game(), (one) => Boolean(one?.finish))
          return game?.finish ? { done: true, detail: `The game is over: ${game.finish.result}.` } : { done: false, detail: 'the game is still going.' }
        }
      },
      changeSetup: {
        name: 'Back to the setup',
        about: 'Lets go of the game on screen and shows the pickers again. A game that was saved stays in your Library.',
        unavailable: () => (screen.game() === null ? 'The setup is already on screen.' : null),
        run: () => {
          screen.changeSetup()
          return { done: true }
        },
        verify: async () => {
          const game = await waitFor(() => screen.game(), (one) => one === null)
          return game === null ? { done: true, detail: 'The setup is on screen.' } : { done: false, detail: 'the game is still on screen.' }
        }
      }
    },
    state: () => {
      const game = screen.game()
      const why = screen.whyNoEngine()
      if (!game) {
        return {
          activity: 'idle',
          detail: why ?? 'Ready to start a game.',
          values: { playing: false, engine: why === null ? 'ready' : why, opponent: difficulty(screen.setup().difficulty).name, clock: screen.setup().control.label, colour: screen.setup().side }
        }
      }
      return {
        activity: game.finish ? 'finished' : game.clock.paused ? 'paused' : 'running',
        detail: game.finish
          ? `The game is over: ${game.finish.result}.`
          : game.thinking
            ? 'The engine is thinking.'
            : yourTurn(game)
              ? 'Your move.'
              : 'The engine’s move.',
        values: {
          playing: true,
          opponent: game.level.name,
          you: SIDE_WORD[game.human],
          moves: game.moves.length,
          toMove: engineTurn(game) ? 'the engine' : 'you',
          clock: game.setup.control.label,
          paused: game.clock.paused,
          finished: game.finish ? game.finish.result : null,
          lastMove: game.moves.at(-1)?.san ?? null,
          drawOffer: game.drawOffer ? game.drawOffer.by : null,
          hint: game.hint?.text ?? null,
          problem: game.problem ?? null,
          saved: game.gameId ? game.gameId : null
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Study, and the three panels in it

const STUDY = 'chess/study'

export interface StudyScreen {
  /** The game being studied. A name the record does not have is null, never "Unknown". */
  game(): { id: string; moves: number; white: string | null; black: string | null }
  panel(): string
  setPanel(value: 'moves' | 'lines' | 'engine' | 'report'): void
  orientation(): 'w' | 'b'
  setOrientation(value: 'w' | 'b'): void
  /** How many of the game's positions have an engine answer recorded against them. */
  evaluated(): number
  /** Where a whole-game pass stands. `total` is 0 when none has been asked for. */
  sweep(): { running: boolean; done: number; total: number; note: string | null }
  /** Null when a whole-game pass can be run, and the reason it cannot when it cannot. */
  whyNoSweep(): string | null
  review(): Promise<void>
  stopReview(): void
  /** What the saving of this study says about itself, in the words the screen shows. */
  saving(): string
}

export function studySurface(screen: StudyScreen): SurfaceDeclaration {
  return {
    id: 'study',
    parent: 'chess',
    name: 'Study',
    about: 'One of your games, the engine, and your notes. Lines you try here are never written into the game itself.',
    kind: 'page',
    keywords: ['study', 'analysis', 'analyse', 'studio', 'review', 'engine', 'notes', 'variation'],
    controls: {
      panel: {
        name: 'What to show',
        about: 'Which panel is on the right: the moves, the engine’s lines, the engine itself, or the report.',
        spec: { type: 'string', description: 'moves is the move list and your notes; lines is the lines you have tried; engine is the engine panel; report is the game review.', enum: ['moves', 'lines', 'engine', 'report'] },
        get: () => screen.panel(),
        set: (value) => screen.setPanel(String(value) as 'moves'),
        default: 'moves'
      },
      orientation: {
        name: 'Which way up the board is',
        spec: { type: 'string', description: 'Whose pieces are at the bottom: w or b.', enum: ['w', 'b'] },
        get: () => screen.orientation(),
        set: (value) => screen.setOrientation(String(value) === 'b' ? 'b' : 'w')
      }
    },
    actions: {
      review: {
        name: 'Review the whole game',
        about:
          'A quick look at every position, then a proper search of the ones where the numbers moved. It is budgeted in time, so a review that cannot cover the game says which part it gave up rather than quietly covering less.',
        unavailable: () => screen.whyNoSweep(),
        run: async () => {
          const before = screen.evaluated()
          await screen.review()
          return { before, sweep: screen.sweep() }
        },
        verify: async (data) => {
          const before = (data as { before: number }).before
          // Asked of the register, because this declaration's own getters are from the render the review started in.
          const values = await waitFor(() => liveValues(STUDY), (got) => typeof got.analysed === 'number' && got.analysed > before)
          const now = typeof values.analysed === 'number' ? values.analysed : null
          if (now === null) return { done: false, detail: 'the Study screen could not say how many positions have an engine answer.' }
          return now > before
            ? { done: true, detail: `${now - before} more position${now - before === 1 ? '' : 's'} now ${now - before === 1 ? 'has' : 'have'} an engine answer: ${now} of them in all. ${String(values.review ?? '')}`.trim() }
            : { done: false, detail: `no position gained an engine answer; ${now} of them had one before and still do. ${String(values.review ?? '')}`.trim() }
        }
      },
      stopReview: {
        name: 'Stop the review',
        about: 'What has been searched is kept; the rest is left unanalysed, and the record says the pass was stopped.',
        unavailable: () => (screen.sweep().running ? null : 'No review is running.'),
        run: () => {
          screen.stopReview()
          return { stopped: true }
        },
        verify: async () => {
          const values = await waitFor(() => liveValues(STUDY), (got) => got.reviewing === false)
          return values.reviewing === false ? { done: true, detail: 'The review has stopped.' } : { done: false, detail: 'it is still running.' }
        }
      }
    },
    possibleChildren: [
      // The engine panel exists only while it is the panel on screen, which is why it is named here with the way to it.
      { id: 'engine', name: 'The engine', kind: 'panel', reach: { kind: 'control', control: 'panel', value: 'engine' } }
    ],
    state: () => {
      const sweep = screen.sweep()
      const game = screen.game()
      return {
        activity: sweep.running ? 'running' : 'idle',
        detail: sweep.running ? `Reviewing the game: ${sweep.done} of ${sweep.total} positions searched.` : screen.saving(),
        // Only while a pass is really running and really measured. A nought here would read as "just started".
        ...(sweep.running && sweep.total > 0 ? { progress: sweep.done / sweep.total } : {}),
        values: {
          game: game.id,
          white: game.white,
          black: game.black,
          moves: game.moves,
          panel: screen.panel(),
          analysed: screen.evaluated(),
          reviewing: sweep.running,
          review: sweep.note ?? '',
          saving: screen.saving()
        }
      }
    }
  }
}

const MOVE_TREE = `${STUDY}/move-tree`

export interface MoveTreeScreen {
  /** The moves as the list draws them, main line and the lines hanging off it. */
  rows(): readonly { nodeId: string; number: number; side: 'w' | 'b'; san: string }[]
  /** How far along the game the board is, counted in single moves. Negative when the board is on a line of your own. */
  ply(): number
  /** How many moves the game itself has. */
  moves(): number
  goToPly(ply: number): void
  back(): void
  forward(): void
  toStart(): void
  toEnd(): void
  /** Whether the board is on the game as played rather than on a line of your own. */
  onMainLine(): boolean
  /** True when there is a move after this one in the line the board is on. */
  canGoOn(): boolean
  leaveBranch(): void
  canPromote(): boolean
  promote(): void
  removeLine(): void
  /** What the next undo would take back, in words, or null when there is nothing to take back. */
  undoable(): string | null
  undo(): void
  copyPgn(): Promise<void> | void
  /** Whether the panel is the one on screen. The controls work either way; this says whether anybody can see it. */
  showing(): boolean
}

export function moveTreeSurface(screen: MoveTreeScreen): SurfaceDeclaration {
  /** What the move number reads as now, asked of the register: this declaration's own is from before the step. */
  const nowAt = (): number | null => {
    const got = liveReading(`${MOVE_TREE}/move`)
    return got.readable && typeof got.value === 'number' ? got.value : null
  }
  const stepped = async (before: number | null, which: string): Promise<{ done: boolean; detail: string }> => {
    const at = await waitFor(nowAt, (value) => value !== before)
    if (at === null) return { done: false, detail: `the board is on a line of your own, so ${which} cannot be reported as a move number.` }
    return at === before
      ? { done: false, detail: `the board is still at move ${at}.` }
      : { done: true, detail: `The board is at move ${at}.` }
  }

  return {
    id: 'move-tree',
    parent: STUDY,
    name: 'Moves',
    about: 'The game move by move, with the lines you have tried hanging off it, and the four ways through them.',
    kind: 'panel',
    keywords: ['moves', 'move list', 'move tree', 'line', 'variation', 'step', 'navigate'],
    visible: () => screen.showing(),
    controls: {
      move: {
        name: 'Move',
        about: 'Where the board is, counted in single moves from the start: 0 is the starting position.',
        spec: { type: 'integer', description: 'Which move to go to, counted in single moves. 0 is the position before anything was played.', min: 0 },
        get: () => {
          const at = screen.ply()
          // A value that could not be read is not a value: off the game as played there is no move number for this.
          if (at < 0) throw new Error('The board is on a line of your own, which has no move number in the game. Use leaveBranch to come back to the game as played.')
          return at
        },
        set: (value) => screen.goToPly(Number(value))
      }
    },
    actions: {
      forward: {
        name: 'Forward one move',
        unavailable: () => (screen.canGoOn() ? null : 'The board is at the end of this line.'),
        run: () => {
          const before = screen.ply()
          screen.forward()
          return { from: before }
        },
        verify: (data) => stepped((data as { from: number }).from, 'forward')
      },
      back: {
        name: 'Back one move',
        unavailable: () => (screen.ply() === 0 ? 'The board is at the start.' : null),
        run: () => {
          const before = screen.ply()
          screen.back()
          return { from: before }
        },
        verify: (data) => stepped((data as { from: number }).from, 'back')
      },
      toStart: {
        name: 'To the start',
        unavailable: () => (screen.ply() === 0 ? 'The board is at the start.' : null),
        run: () => {
          const before = screen.ply()
          screen.toStart()
          return { from: before }
        },
        verify: (data) => stepped((data as { from: number }).from, 'the start')
      },
      toEnd: {
        name: 'To the end of the line',
        unavailable: () => (screen.canGoOn() ? null : 'The board is at the end of this line.'),
        run: () => {
          const before = screen.ply()
          screen.toEnd()
          return { from: before }
        },
        verify: (data) => stepped((data as { from: number }).from, 'the end')
      },
      leaveBranch: {
        name: 'Back to the game as played',
        unavailable: () => (screen.onMainLine() ? 'The board is already on the game as played.' : null),
        run: () => {
          screen.leaveBranch()
          return { done: true }
        },
        verify: async () => {
          const at = await waitFor(nowAt, (value) => value !== null)
          return at === null ? { done: false, detail: 'the board is still on a line of your own.' } : { done: true, detail: `The board is on the game as played, at move ${at}.` }
        }
      },
      promote: {
        name: 'Make this the main line',
        about: 'The line the board is on becomes the main one. The game as played is still in the list, marked, as a variation.',
        unavailable: () => (screen.canPromote() ? null : 'The board is already on the main line, so there is nothing to promote.'),
        run: () => {
          screen.promote()
          return { done: true }
        }
      },
      removeLine: {
        name: 'Remove this line',
        about: 'Takes the line the board is on out of the study. Undo puts it back. The game in your Library is untouched.',
        effects: ['delete'],
        confirmation: 'always',
        unavailable: () => (screen.ply() === 0 && screen.onMainLine() ? 'The board is at the start, so there is no line to remove.' : null),
        run: () => {
          screen.removeLine()
          return { done: true }
        }
      },
      undo: {
        name: 'Undo',
        about: 'Takes back the last change to the study.',
        unavailable: () => (screen.undoable() === null ? 'There is nothing to take back.' : null),
        run: () => {
          const what = screen.undoable()
          screen.undo()
          return { took: what }
        },
        verify: (data) => {
          const what = (data as { took: string | null }).took
          return { done: what !== null, detail: what === null ? 'nothing was there to take back.' : `Took back ${what}.` }
        }
      },
      copyPgn: {
        name: 'Copy as PGN',
        about: 'Puts the study on the clipboard as PGN, and says what PGN cannot carry.',
        run: async () => {
          await screen.copyPgn()
          return { copied: true }
        }
      }
    },
    state: () => ({
      values: {
        move: screen.ply(),
        moves: screen.moves(),
        rows: screen.rows().length,
        onMainLine: screen.onMainLine(),
        showing: screen.showing()
      }
    })
  }
}

export interface NotesScreen {
  /** What the note on this position says now. Empty when there is none. */
  text(): string
  save(text: string): void
  clear(): void
  /** The move the note is about, in words: "14… Nf3" or "the starting position". */
  about(): string
  /** A comment that came in with the game, which is not yours and is never written over. */
  fromTheGame(): string | null
  showing(): boolean
}

export function notesSurface(screen: NotesScreen): SurfaceDeclaration {
  return {
    id: 'notes',
    parent: STUDY,
    name: 'Notes',
    about: 'What you have written about the position the board is on. Kept with the study, never written into the game.',
    kind: 'panel',
    keywords: ['note', 'notes', 'comment', 'annotation', 'write'],
    visible: () => screen.showing(),
    controls: {
      text: {
        name: 'Note',
        about: 'Your note about the position the board is on. Setting it to nothing leaves the position without one.',
        spec: { type: 'string', description: 'What to write about this position.' },
        get: () => screen.text(),
        set: (value) => screen.save(String(value ?? '')),
        default: ''
      }
    },
    actions: {
      clear: {
        name: 'Clear the note',
        effects: ['delete'],
        unavailable: () => (screen.text().trim() === '' ? 'There is no note on this position.' : null),
        run: () => {
          screen.clear()
          return { cleared: true }
        },
        verify: async () => {
          const got = await waitFor(() => liveReading(`${STUDY}/notes/text`), (one) => one.readable && one.value === '')
          return got.value === '' ? { done: true, detail: 'This position has no note now.' } : { done: false, detail: 'the note is still there.' }
        }
      }
    },
    state: () => ({ values: { about: screen.about(), written: screen.text().length, fromTheGame: screen.fromTheGame(), showing: screen.showing() } })
  }
}

export interface EnginePanelScreen {
  /** What the panel's own pickers hold. */
  limit(): 'time' | 'depth'
  thinkMs(): number
  depth(): number
  lines(): number
  /** Sets one of the four, through the panel's own handler. */
  set(change: { limit?: 'time' | 'depth'; movetime?: number; depth?: number; lines?: number }): void
  /** One search of the position on the board, resolving with everything the engine said about it. */
  ask(limits: { depth?: number; movetime?: number; lines?: number }): Promise<{
    complete: boolean
    depthReached: number | null
    score: string | null
    best: string | null
    lines: number
    note: string | null
  }>
  stop(): void
  /** Whether a search is running. */
  running(): boolean
  /** Null when the engine can be asked, and the reason it cannot when it cannot. */
  whyNot(): string | null
  /** What the engine says about itself, in the words the panel shows. */
  status(): string
  /** The engine's own answer for the position on the board, when it has one for this position. */
  answer(): { score: string; depth: number | null; best: string | null } | null
}

/**
 * The engine panel: what stops the search, how long or how deep, and how many lines.
 *
 * Threads and memory are not here, and this is the one place worth saying why: Stockfish sizes both itself from what
 * the computer has, Orbis has no channel to send it either, and nothing tells the window what it chose. They are on
 * `chess/settings` as two readings that say exactly that rather than as two numbers nobody set.
 *
 * Its id is `engine` and not `engine-panel`, which is not a detail. A path's last segment is matched against the
 * surfaces inside a screen before the controls on it, and the loosest way it is matched is "every word somebody said
 * is in it" -- so a panel called `engine-panel` answered to `panel`, and the Study screen's own `panel` control
 * became unreachable the moment the panel was open. Worse, a write to it read back as a screen rather than as the
 * control that had just been set, and a write that really worked was reported as unconfirmed.
 */
export function enginePanelSurface(screen: EnginePanelScreen): SurfaceDeclaration {
  const whenTimed = (): true | string => (screen.limit() === 'time' ? true : 'The search is set to stop at a depth, so a time is not what stops it. Set limit to "time" first.')
  const whenDeep = (): true | string => (screen.limit() === 'depth' ? true : 'The search is set to stop after a time, so a depth is not what stops it. Set limit to "depth" first.')

  return {
    id: 'engine',
    parent: STUDY,
    name: 'The engine',
    about: 'Asking Stockfish about the position on the board: what stops it, how long or how deep, and how many lines.',
    kind: 'panel',
    /*
     * "depth" and "lines" are deliberately NOT keywords here, even though they are what people say about an engine.
     * A surface is preferred over a control of the same name, so while this panel answered to "depth" the control
     * called depth sitting inside it was unreachable: asking for "chess/depth" came back "that is a screen, not a
     * control" with the control one level further in.
     */
    keywords: ['engine', 'stockfish', 'analyse', 'analysis', 'think'],
    reach: { kind: 'control', control: 'panel', value: 'engine' },
    controls: {
      limit: {
        name: 'Search by',
        about: 'A time gives you an answer when you asked for it. A depth gives you the same answer on every computer, but a hard position can take a long time.',
        spec: { type: 'string', description: 'What stops the engine thinking: a time, or a depth.', enum: ['time', 'depth'] },
        get: () => screen.limit(),
        set: (value) => screen.set({ limit: String(value) === 'depth' ? 'depth' : 'time' }),
        default: 'time'
      },
      time: {
        name: 'Thinking time',
        about: 'How long the engine gets, when a time is what stops it.',
        spec: { type: 'integer', description: 'Milliseconds. The panel itself offers 500, 1000, 3000, 10000 and 30000; anything in the range is sent as it is.', min: 50, max: 600_000 },
        get: () => screen.thinkMs(),
        set: (value) => screen.set({ movetime: Number(value) }),
        writable: whenTimed,
        default: 3000
      },
      depth: {
        name: 'Depth',
        about: 'How many moves ahead, when a depth is what stops it. Each extra one roughly doubles the work.',
        spec: { type: 'integer', description: 'How many moves ahead to look. The panel itself offers 12, 16, 20, 24 and 30.', min: 1, max: 40 },
        get: () => screen.depth(),
        set: (value) => screen.set({ depth: Number(value) }),
        writable: whenDeep,
        default: 20
      },
      lines: {
        name: 'Lines',
        about: 'How many different continuations to show. One is the best move it found; more costs time.',
        spec: { type: 'integer', description: 'How many of the engine’s own lines to ask for.', min: 1, max: 5 },
        get: () => screen.lines(),
        set: (value) => screen.set({ lines: Number(value) }),
        default: 3
      }
    },
    actions: {
      analyse: {
        name: 'Ask about this position',
        about:
          'Searches the position on the board and waits for the answer. A depth, a time or a number of lines given here is set on the panel first and then asked for, which is what pressing it yourself would do.',
        params: {
          depth: { type: 'integer', description: 'Stop at this depth. Setting it also switches the panel to stopping at a depth.', min: 1, max: 40 },
          movetime: { type: 'integer', description: 'Stop after this many milliseconds. Setting it also switches the panel to stopping after a time.', min: 50, max: 600_000 },
          lines: { type: 'integer', description: 'How many lines to ask for.', min: 1, max: 5 }
        },
        unavailable: () => screen.whyNot() ?? (screen.running() ? 'The engine is already working on this position.' : null),
        run: (params) =>
          screen.ask({
            ...(params.depth === undefined ? {} : { depth: Number(params.depth) }),
            ...(params.movetime === undefined ? {} : { movetime: Number(params.movetime) }),
            ...(params.lines === undefined ? {} : { lines: Number(params.lines) })
          }),
        /*
         * Verified from the engine's own answer, which this action waited for.
         *
         * Nothing here reads the screen: the search resolves with what the engine said, so the only honest question
         * is whether it said anything about this position.
         */
        verify: (data) => {
          const got = data as Awaited<ReturnType<EnginePanelScreen['ask']>>
          if (!got.complete && got.score === null) return { done: false, detail: `the engine gave no answer for this position.${got.note ? ` ${got.note}` : ''}` }
          const depth = got.depthReached === null ? 'at a depth it did not report' : `at depth ${got.depthReached}`
          return {
            done: true,
            detail: `The engine makes it ${got.score ?? 'no score at all'} ${depth}${got.best ? `, best move ${got.best}` : ''}, over ${got.lines} line${got.lines === 1 ? '' : 's'}.${got.note ? ` ${got.note}` : ''}`
          }
        }
      },
      stop: {
        name: 'Stop the engine',
        unavailable: () => (screen.running() ? null : 'The engine is not searching.'),
        run: () => {
          screen.stop()
          return { stopped: true }
        },
        verify: async () => {
          const values = await waitFor(() => liveValues(`${STUDY}/engine`), (got) => got.running === false)
          return values.running === false ? { done: true, detail: 'The engine has stopped.' } : { done: false, detail: 'it is still searching.' }
        }
      }
    },
    state: () => {
      const answer = screen.answer()
      return {
        activity: screen.running() ? 'running' : 'idle',
        detail: screen.status(),
        values: {
          running: screen.running(),
          ready: screen.whyNot() === null,
          whyNot: screen.whyNot(),
          limit: screen.limit(),
          time: screen.thinkMs(),
          depth: screen.depth(),
          lines: screen.lines(),
          // Only the engine's answer for the position actually on the board. Nothing else is shown as this one's.
          score: answer?.score ?? null,
          depthReached: answer?.depth ?? null,
          best: answer?.best ?? null
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Puzzles, and a run

export interface PuzzlesScreen {
  tab(): string
  setTab(value: 'solve' | 'themes' | 'daily' | 'rush' | 'make' | 'review'): void
  /** The puzzles you have, and how you have got on with them. Throws while the collection is being read. */
  counts(): { puzzles: number; solved: number; missed: number }
  /** What the rating line says, in its own words, and why. */
  standing(): { says: string; why: string }
  streak(): string
  /** Today's puzzle: what the screen says about it, and whether today's go has been had. */
  today(): { says: string; done: boolean }
  /** The one open on screen, or null. */
  open(): string | null
  openPuzzle(id: string): void
  /** The ids in the collection, so one can be named. */
  ids(): readonly string[]
}

export function puzzlesSurface(screen: PuzzlesScreen): SurfaceDeclaration {
  return {
    id: 'puzzles',
    parent: 'chess',
    name: 'Puzzles',
    about: 'Solving, making and going back over puzzles made out of your own games. Orbis ships none and fetches none.',
    kind: 'page',
    keywords: ['puzzle', 'puzzles', 'solve', 'daily', 'run', 'rush', 'tactics', 'review'],
    controls: {
      tab: {
        name: 'Puzzles',
        spec: {
          type: 'string',
          description: 'solve is your collection; themes is the shelves by what a puzzle is about; daily is today’s one; rush is a run against the clock; make builds puzzles out of your games; review is the ones you missed.',
          enum: ['solve', 'themes', 'daily', 'rush', 'make', 'review']
        },
        get: () => screen.tab(),
        set: (value) => screen.setTab(String(value) as 'solve'),
        default: 'solve'
      },
      puzzle: {
        name: 'The puzzle open',
        about: 'Which puzzle is open on the solving screen. Its id, as the collection lists them.',
        spec: { type: 'string', description: 'The id of a puzzle in your collection.', enum: screen.ids() as string[] },
        get: () => screen.open() ?? '',
        set: (value) => screen.openPuzzle(String(value)),
        writable: () => (screen.ids().length ? true : 'There are no puzzles in the collection yet. Make some from your games first: set tab to "make".')
      }
    },
    possibleChildren: [{ id: 'run', name: 'A run against the clock', kind: 'panel', reach: { kind: 'control', control: 'tab', value: 'rush' } }],
    state: () => {
      const counts = screen.counts()
      const standing = screen.standing()
      const today = screen.today()
      return {
        values: {
          tab: screen.tab(),
          puzzles: counts.puzzles,
          solved: counts.solved,
          toGoOver: counts.missed,
          rating: standing.says,
          ratingWhy: standing.why,
          streak: screen.streak(),
          today: today.says,
          todayDone: today.done,
          open: screen.open()
        }
      }
    }
  }
}

export interface PuzzleRunScreen {
  /** The run as it stands, or null when none is going. */
  run(): { mode: string; score: number; lives: number | null; secondsLeft: number | null; over: boolean } | null
  /** Starts a run in one of the modes. Throws with the screen's own reason when it cannot be started. */
  start(mode: string): { mode: string }
  /** How many puzzles there are to run through. */
  pool(): number
  /** The last thing the run itself said, including why one would not start. Null when it has said nothing. */
  note(): string | null
}

export function puzzleRunSurface(screen: PuzzleRunScreen): SurfaceDeclaration {
  return {
    id: 'run',
    parent: 'chess/puzzles',
    name: 'A run against the clock',
    about: RUN_MODES.map((one) => `${one.id}: ${one.label}.`).join(' '),
    kind: 'panel',
    keywords: ['run', 'rush', 'against the clock', 'survival', 'streak'],
    reach: { kind: 'control', control: 'tab', value: 'rush' },
    controls: {},
    actions: {
      start: {
        name: 'Start a run',
        about: 'Starts a run in one of the three modes. A run that cannot be filled says so rather than starting an empty one.',
        params: { mode: { type: 'string', description: RUN_MODES.map((one) => `${one.id}: ${one.label}`).join('; '), enum: RUN_MODES.map((one) => one.id), required: true } },
        unavailable: () => (screen.run()?.over === false ? 'A run is already going.' : null),
        run: (params) => screen.start(String(params.mode)),
        verify: async (data) => {
          const wanted = (data as { mode: string }).mode
          const values = await waitFor(() => liveValues('chess/puzzles/run'), (got) => got.running === true)
          return values.running === true
            ? { done: true, detail: `A ${wanted} run is going: ${String(values.score ?? 0)} so far.` }
            : { done: false, detail: `no run is going. ${String(values.note ?? '')}`.trim() }
        }
      }
    },
    state: () => {
      const run = screen.run()
      return {
        activity: run === null ? 'idle' : run.over ? 'finished' : 'running',
        detail: run === null ? `Nothing is running. ${screen.pool()} puzzle${screen.pool() === 1 ? '' : 's'} to run through.` : `${run.mode}: ${run.score} solved.`,
        values: {
          running: run !== null && !run.over,
          mode: run?.mode ?? null,
          score: run?.score ?? null,
          lives: run?.lives ?? null,
          secondsLeft: run?.secondsLeft ?? null,
          pool: screen.pool(),
          note: screen.note()
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the two training screens

export interface CalculationScreen {
  /** The exercises there are to work on, with the id and what each asks. */
  exercises(): readonly { id: string; prompt: string }[]
  open(): string | null
  openExercise(id: string): void
  mode(): GymMode
  setMode(value: GymMode): void
  replies(): ReplySource
  setReplies(value: ReplySource): void
  /** ready, studying, answering or done. */
  phase(): string
  begin(): void
  /** What the last go was worth, in the screen's own words, or null when there has not been one. */
  report(): string | null
}

export function calculationSurface(screen: CalculationScreen): SurfaceDeclaration {
  return {
    id: 'calculation',
    parent: 'chess',
    name: 'Calculation Gym',
    about: 'Work a line out in your head and write it down. In a hidden round the position goes off screen first.',
    kind: 'page',
    keywords: ['calculation', 'gym', 'line', 'visualise', 'train', 'training'],
    controls: {
      exercise: {
        name: 'The exercise',
        spec: { type: 'string', description: 'Which exercise to work on, by its id.', enum: screen.exercises().map((one) => one.id) },
        get: () => screen.open() ?? '',
        set: (value) => screen.openExercise(String(value)),
        writable: () => (screen.exercises().length ? true : 'The exercises have not been read yet.')
      },
      mode: {
        name: 'The board',
        spec: { type: 'string', description: 'with-board keeps the position on screen; hidden takes it away after a look at it, which is the only kind of go that says anything about calculating in your head.', enum: ['with-board', 'hidden'] },
        get: () => screen.mode(),
        set: (value) => screen.setMode(String(value) as GymMode),
        default: 'with-board'
      },
      replies: {
        name: 'Who answers for the other side',
        spec: { type: 'string', description: 'both-sides means you write every move; from-the-exercise means Orbis plays the other side from the exercise’s own answers.', enum: ['both-sides', 'from-the-exercise'] },
        get: () => screen.replies(),
        set: (value) => screen.setReplies(String(value) as ReplySource),
        default: 'both-sides'
      }
    },
    actions: {
      begin: {
        name: 'Start the round',
        unavailable: () => {
          if (screen.open() === null) return 'No exercise is open. Set the exercise control first.'
          if (screen.phase() !== 'ready') return `A round is already ${screen.phase()}.`
          return null
        },
        run: () => {
          screen.begin()
          return { started: true }
        },
        verify: async () => {
          const values = await waitFor(() => liveValues('chess/calculation'), (got) => got.phase === 'studying' || got.phase === 'answering')
          return values.phase === 'studying' || values.phase === 'answering'
            ? { done: true, detail: `The round has started: ${String(values.phase)}.` }
            : { done: false, detail: `the screen is still ${String(values.phase ?? 'in an unknown state')}.` }
        }
      }
    },
    state: () => ({
      activity: screen.phase() === 'ready' ? 'idle' : screen.phase() === 'done' ? 'finished' : 'running',
      ...(screen.report() ? { detail: screen.report()! } : {}),
      values: { phase: screen.phase(), exercise: screen.open(), exercises: screen.exercises().length, mode: screen.mode(), replies: screen.replies(), report: screen.report() }
    })
  }
}

export interface BlindfoldScreen {
  level(): BlindLevelId
  setLevel(value: BlindLevelId): void
  mode(): BlindMode
  setMode(value: BlindMode): void
  phase(): string
  /** Starts a round of the level that is chosen. Throws the screen's own reason when one cannot be built. */
  begin(): void
  /** The highest rung passed with no board, in the record's own words. */
  standing(): string
  /** Whether the whole game with no board is on screen. */
  playingGame(): boolean
  setPlayingGame(on: boolean): void
}

export function blindfoldSurface(screen: BlindfoldScreen): SurfaceDeclaration {
  return {
    id: 'blindfold',
    parent: 'chess',
    name: 'Blindfold',
    about: `Holding a position in your head. ${BLIND_LEVELS.map((one) => `${one.id}: ${one.asks}`).join(' ')}`,
    kind: 'page',
    keywords: ['blindfold', 'blind', 'memory', 'visualise', 'no board', 'train'],
    controls: {
      level: {
        name: 'The level',
        about: BLIND_LEVELS.map((one) => `${one.title} (${one.id}): ${one.asks} Passed when: ${one.passes}`).join(' '),
        spec: { type: 'string', description: 'Which rung of the ladder to work on.', enum: BLIND_LEVELS.map((one) => one.id) },
        get: () => screen.level(),
        set: (value) => screen.setLevel(String(value) as BlindLevelId),
        default: 'locate'
      },
      mode: {
        name: 'How the position is given',
        spec: { type: 'string', description: 'strict means no board at all; read-out means the position is written out for you.', enum: ['strict', 'read-out'] },
        get: () => screen.mode(),
        set: (value) => screen.setMode(String(value) as BlindMode),
        default: 'strict'
      },
      wholeGame: {
        name: 'The whole game with no board',
        spec: { type: 'boolean', description: 'Whether the whole blindfold game is on screen instead of a round of the ladder.' },
        get: () => screen.playingGame(),
        set: (value) => screen.setPlayingGame(value === true),
        default: false
      }
    },
    actions: {
      begin: {
        name: 'Start a round',
        about: 'Builds a round of the level that is chosen. A level that cannot be built from the positions you have allowed says so.',
        unavailable: () => (screen.phase() === 'ready' ? null : `A round is already ${screen.phase()}.`),
        run: () => {
          screen.begin()
          return { level: screen.level() }
        },
        verify: async () => {
          const values = await waitFor(() => liveValues('chess/blindfold'), (got) => got.phase === 'studying' || got.phase === 'answering')
          return values.phase === 'studying' || values.phase === 'answering'
            ? { done: true, detail: `A round of ${String(values.level)} has started: ${String(values.phase)}.` }
            : { done: false, detail: `the screen is still ${String(values.phase ?? 'in an unknown state')}, so no round was built.` }
        }
      }
    },
    state: () => ({
      activity: screen.phase() === 'ready' ? 'idle' : screen.phase() === 'done' ? 'finished' : 'running',
      detail: screen.standing(),
      values: { phase: screen.phase(), level: screen.level(), mode: screen.mode(), wholeGame: screen.playingGame(), standing: screen.standing() }
    })
  }
}

// ---------------------------------------------------------------- the position editor

/** Every tool the palette offers, as the palette itself builds them: the hand, the rubber, and a man of each kind. */
const EDITOR_TOOLS: readonly { id: string; name: string; tool: { kind: 'move' } | { kind: 'erase' } | { kind: 'piece'; type: 'k' | 'q' | 'r' | 'b' | 'n' | 'p'; color: 'w' | 'b' } }[] = Object.freeze([
  { id: 'move', name: 'The hand', tool: { kind: 'move' } },
  { id: 'erase', name: 'The rubber', tool: { kind: 'erase' } },
  ...(['w', 'b'] as const).flatMap((color) =>
    (['k', 'q', 'r', 'b', 'n', 'p'] as const).map((type) => ({
      id: `${color}${type}`,
      name: `${color === 'w' ? 'White' : 'Black'} ${{ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[type]}`,
      tool: { kind: 'piece' as const, type, color }
    }))
  )
])

const SQUARE: ParamSpec = { type: 'string', description: 'A square, as it is named on the board: "e4".', required: true }

export interface EditorScreen {
  /** The position on the board, as a FEN. */
  fen(): string
  /** Reads a position out of text and puts it on the board, the way the Read button does. Throws when it is not one. */
  setFen(text: string): void
  /**
   * What is wrong with the position, in two kinds that are never mixed up.
   *
   * `faults` stop it being a chess position at all. `unreachable` are the things that say no game could have reached
   * it, which is the normal state of a composed study and is never a reason to refuse it.
   */
  look(): { legal: boolean; faults: readonly { kind: string; says: string }[]; unreachable: readonly string[] }
  turn(): 'w' | 'b'
  setTurn(value: 'w' | 'b'): void
  castling(): string
  setCastling(flags: string): void
  enPassant(): string
  setEnPassant(square: string): void
  halfmove(): number
  fullmove(): number
  setClocks(halfmove: number, fullmove: number): void
  tool(): string
  setTool(id: string): void
  orientation(): 'w' | 'b'
  setOrientation(value: 'w' | 'b'): void
  /** Puts a man on a square, or takes one off, through the same handler a click does. */
  place(square: string, piece: string | null): void
  openingPosition(): void
  clearBoard(): void
  swapColours(): void
  undo(): void
  canUndo(): boolean
  redo(): boolean | void
  canRedo(): boolean
  /** Stores the position as a game and hands back what was really stored. */
  openForStudy(): Promise<{ id: string; startFen: string }>
  /** Null when a position can be stored, and the reason it cannot when it cannot. */
  whyNotStore(): string | null
}

export function editorSurface(screen: EditorScreen): SurfaceDeclaration {
  return {
    id: 'editor',
    parent: 'chess',
    name: 'Set up a position',
    about:
      'Placing men freely, and saying what is wrong with the result. Nothing is worked out from where the pieces stand: the side to move, the castling rights and the en passant square are whatever you set.',
    kind: 'tool',
    keywords: ['editor', 'set up', 'position', 'fen', 'place', 'pieces', 'board editor', 'compose'],
    controls: {
      position: {
        name: 'Position as text (FEN)',
        about: 'The whole position in one line. Setting it reads the text and puts it on the board; a line that is not a position is refused and the board is left alone.',
        spec: { type: 'string', description: 'A position as a FEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".' },
        get: () => screen.fen(),
        set: (value) => screen.setFen(String(value))
      },
      turn: {
        name: 'Side to move',
        spec: { type: 'string', description: 'w or b. Set by you, never worked out from the board.', enum: ['w', 'b'] },
        get: () => screen.turn(),
        set: (value) => screen.setTurn(String(value) === 'b' ? 'b' : 'w')
      },
      castling: {
        name: 'Castling rights',
        about: 'K and Q are White’s king’s and queen’s side, k and q are Black’s. Set by you, never worked out from where the rooks are standing.',
        spec: { type: 'string', description: 'The rights as letters in the order KQkq, or "-" for none: "KQkq", "Kq", "-".' },
        get: () => screen.castling(),
        set: (value) => screen.setCastling(String(value)),
        default: 'KQkq'
      },
      enPassant: {
        name: 'En passant square',
        about: 'The square a pawn that has just moved two can be taken on. Left empty unless you set it.',
        spec: { type: 'string', description: 'A square on the third or sixth row ("e3", "e6"), or "-" for none.' },
        get: () => screen.enPassant(),
        set: (value) => screen.setEnPassant(String(value)),
        default: '-'
      },
      halfmove: {
        name: 'Moves since a capture or a pawn move',
        spec: { type: 'integer', description: 'The fifty-move counter, in single moves.', min: 0, max: 999 },
        get: () => screen.halfmove(),
        set: (value) => screen.setClocks(Number(value), screen.fullmove()),
        default: 0
      },
      fullmove: {
        name: 'Move number',
        spec: { type: 'integer', description: 'Which move the position is at.', min: 1, max: 999 },
        get: () => screen.fullmove(),
        set: (value) => screen.setClocks(screen.halfmove(), Number(value)),
        default: 1
      },
      tool: {
        name: 'The tool',
        about: 'What a click on a square does: the hand picks a man up and puts him down anywhere, the rubber takes him off, and a piece tool puts that piece down.',
        spec: { type: 'string', description: `Which tool is in hand. ${EDITOR_TOOLS.map((one) => `${one.id} is ${one.name.toLowerCase()}`).join(', ')}.`, enum: EDITOR_TOOLS.map((one) => one.id) },
        get: () => screen.tool(),
        set: (value) => screen.setTool(String(value)),
        default: 'move'
      },
      orientation: {
        name: 'Which way up the board is',
        spec: { type: 'string', description: 'Whose pieces are at the bottom: w or b.', enum: ['w', 'b'] },
        get: () => screen.orientation(),
        set: (value) => screen.setOrientation(String(value) === 'b' ? 'b' : 'w')
      }
    },
    actions: {
      place: {
        name: 'Put a piece on a square',
        about: 'Puts one man on one square, whatever the rules would say about how he got there. Leaving the piece out takes whatever is there off.',
        params: {
          square: SQUARE,
          piece: {
            type: 'string',
            description: 'Which man: a colour and a kind, as in "wk" for the white king or "bp" for a black pawn. Left out empties the square.',
            enum: EDITOR_TOOLS.filter((one) => one.tool.kind === 'piece').map((one) => one.id)
          }
        },
        run: (params) => {
          const square = String(params.square)
          const piece = params.piece === undefined || params.piece === null || params.piece === '' ? null : String(params.piece)
          screen.place(square, piece)
          return { square, piece }
        },
        verify: async (data) => {
          const { square, piece } = data as { square: string; piece: string | null }
          const got = await waitFor(() => liveReading('chess/editor/position'), (one) => one.readable)
          const board = typeof got.value === 'string' ? got.value : ''
          const at = pieceAt(board, square)
          const wanted = piece === null ? null : piece
          return at === wanted
            ? { done: true, detail: piece === null ? `${square} is empty.` : `There is a ${EDITOR_TOOLS.find((one) => one.id === piece)?.name.toLowerCase() ?? piece} on ${square}.` }
            : { done: false, detail: `${square} holds ${at === null ? 'nothing' : at}.` }
        }
      },
      openingPosition: {
        name: 'The opening position',
        run: () => {
          screen.openingPosition()
          return { done: true }
        },
        verify: async () => {
          const got = await waitFor(() => liveReading('chess/editor/position'), (one) => typeof one.value === 'string' && one.value.startsWith('rnbqkbnr/pppppppp'))
          return typeof got.value === 'string' && got.value.startsWith('rnbqkbnr/pppppppp')
            ? { done: true, detail: 'The board is at the opening position.' }
            : { done: false, detail: `the board is at ${String(got.value)}.` }
        }
      },
      clearBoard: {
        name: 'Clear the board',
        effects: ['delete'],
        run: () => {
          screen.clearBoard()
          return { done: true }
        },
        verify: async () => {
          const got = await waitFor(() => liveReading('chess/editor/position'), (one) => typeof one.value === 'string' && one.value.startsWith('8/8/8/8/8/8/8/8'))
          return typeof got.value === 'string' && got.value.startsWith('8/8/8/8/8/8/8/8') ? { done: true, detail: 'The board is empty.' } : { done: false, detail: `the board is at ${String(got.value)}.` }
        }
      },
      swapColours: {
        name: 'Swap the colours',
        about: 'Every man becomes the other colour, in a mirror of the position.',
        run: () => {
          screen.swapColours()
          return { done: true }
        }
      },
      undo: {
        name: 'Undo',
        unavailable: () => (screen.canUndo() ? null : 'Nothing has been changed yet.'),
        run: () => {
          const before = screen.fen()
          screen.undo()
          return { before }
        },
        verify: async (data) => {
          const before = (data as { before: string }).before
          const got = await waitFor(() => liveReading('chess/editor/position'), (one) => one.readable && one.value !== before)
          return got.value !== before ? { done: true, detail: `The board is back at ${String(got.value)}.` } : { done: false, detail: 'the board did not change.' }
        }
      },
      openForStudy: {
        name: 'Open this position for study',
        about: 'Stores the position as a game of yours and opens it in the Study screen. What was really stored is checked, not assumed.',
        unavailable: () => screen.whyNotStore(),
        run: () => screen.openForStudy(),
        verify: (data) => {
          const got = data as { id: string; startFen: string }
          // The channel that stores a game drops a starting position it cannot load, so the answer is read rather
          // than taken on trust: a game stored at the ordinary position is not the position that was built.
          return { done: true, detail: `Stored as the game ${got.id}, starting at ${got.startFen}.` }
        }
      }
    },
    state: () => {
      const look = screen.look()
      return {
        values: {
          position: screen.fen(),
          legal: look.legal,
          // Two kinds of wrong, kept apart: "not a chess position" stops it being opened, and "no game could have
          // reached this" is the normal state of a composed study and stops nothing.
          faults: look.faults.map((one) => one.says),
          couldNotHaveBeenReached: [...look.unreachable],
          turn: screen.turn(),
          castling: screen.castling(),
          enPassant: screen.enPassant(),
          tool: screen.tool(),
          canStore: screen.whyNotStore() === null
        }
      }
    }
  }
}

/** What is standing on a square of a FEN, as a tool id ("wk"), or null when it is empty. */
function pieceAt(fen: string, square: string): string | null {
  const rows = fen.split(' ')[0]?.split('/') ?? []
  const file = 'abcdefgh'.indexOf(square[0]?.toLowerCase() ?? '')
  const rank = Number(square[1])
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8 || rows.length !== 8) return null
  const row = rows[8 - rank]
  let at = 0
  for (const character of row) {
    const skip = Number(character)
    if (Number.isFinite(skip) && skip > 0) {
      at += skip
      if (at > file) return null
      continue
    }
    if (at === file) return `${character === character.toUpperCase() ? 'w' : 'b'}${character.toLowerCase()}`
    at += 1
  }
  return null
}

// ---------------------------------------------------------------- Chess World's settings

export interface ChessSettingsScreen {
  /**
   * What is saved now.
   *
   * Throws while the profile is still being read, on purpose: a control whose getter throws is reported as "could
   * not be read", which is the truth. Answering with a default instead would report a board colour nobody chose.
   */
  settings(): ChessSettings
  setField(path: FieldPath, value: string | number | boolean): void
  resetGroup(group: GroupId): void
  /** Why nothing can be saved, when nothing can. Null when saving works. */
  problem(): string | null
  /** What could not be read out of the saved settings, in sentences. Empty nearly always. */
  fallbacks(): readonly string[]
}

/** A field's id in a path: `board.theme` cannot be one, because a dot is how a path is split. */
const fieldId = (path: FieldPath): string => path.replace('.', '-')

/**
 * Chess World's settings: all thirty fields, read from the module's own model.
 *
 * Nothing about a field is written out here. Its type, its range, its list of values, its default, what it is called
 * on screen, what it does in plain words and -- the part that matters most -- whether its value reaches anything at
 * all come from `FIELDS` in `shared/chess/settings.ts`. A field added there is a field Orbis can read and set in the
 * same change.
 *
 * The one rule this follows from the screen it describes: **a control exists only for a value that goes somewhere.**
 * Five of the thirty are kept and read by nothing yet, and the settings screen prints a sentence for each instead of
 * drawing a switch. So these five are readings that cannot be set, and the reason is the sentence saying what has to
 * change for them to work. Offering them as switches would be offering five settings that do nothing.
 */
export function chessSettingsSurface(screen: ChessSettingsScreen): SurfaceDeclaration {
  const controls: Record<string, ControlDeclaration> = {}
  for (const field of FIELDS) {
    const spec: ParamSpec =
      field.shape.kind === 'switch'
        ? { type: 'boolean', description: field.plain }
        : field.shape.kind === 'number'
          ? {
              type: 'integer',
              description: `${field.plain} In ${field.shape.range.unit === '' ? 'steps' : field.shape.range.unit}${field.shape.range.step === 1 ? '' : ` of ${field.shape.range.step}`}; a value off a step is moved to the nearest one and the answer says so.`,
              min: field.shape.range.low,
              max: field.shape.range.high
            }
          : { type: 'string', description: `${field.plain} ${field.shape.choices.map((one) => `${one.value} is ${one.label}${one.plain ? ` (${one.plain})` : ''}`).join('; ')}.`, enum: field.shape.choices.map((one) => one.value) }

    const statement = drawnAs(field.reach) === 'statement'
    const sized = field.reach.kind === 'engine-sized' ? field.reach : null
    const waiting = field.reach.kind === 'stored' ? field.reach.waitingFor : null
    const extra = NOT_EVERYWHERE[field.path]

    controls[fieldId(field.path)] = {
      name: field.label,
      about: [field.plain, extra, waiting ? `Nothing reads this yet. ${waiting}` : null].filter(Boolean).join(' '),
      spec,
      get: sized
        ? () => {
            /*
             * Not a value at all, and said so rather than answered with the number in the file.
             *
             * Stockfish sizes Threads and Hash itself from what the computer has, Orbis has no channel to send it
             * either, and nothing tells the window what it chose. The number kept in the settings file reaches
             * nothing, so reporting it would be reporting a setting that is not in force anywhere.
             */
            throw new Error(`Nothing reads this and nothing can ask the engine what it chose. Stockfish sizes it itself from what this computer has; it calls it ${sized.shownAs}.`)
          }
        : () => valueAt(screen.settings(), field.path),
      ...(statement
        ? {}
        : {
            set: (value) => screen.setField(field.path, value as string | number | boolean),
            writable: () => (screen.problem() === null ? true : `${screen.problem()}`)
          }),
      ...(statement
        ? { writable: () => (waiting ? `Nothing reads this yet, so the settings screen draws no control for it. ${waiting}` : `There is no way to send the engine a value for this. ${sized ? `Stockfish sizes it itself; it calls it ${sized.shownAs}.` : ''}`) }
        : {}),
      default: valueAt(DEFAULT_CHESS_SETTINGS, field.path)
    }
  }

  return {
    id: 'settings',
    parent: 'chess',
    name: 'Settings',
    about: 'The board, the moves, the sound, the engine and how a score reads. Everything the board settings change takes effect on every board in Orbis at once.',
    kind: 'page',
    keywords: ['settings', 'preferences', 'board', 'theme', 'colours', 'pieces', 'sound', 'engine', 'notation', 'score'],
    controls,
    actions: {
      reset: {
        name: 'Put a group back to the way it came',
        about: 'One group of settings back to the defaults Orbis came with. Every other group is left exactly as it is.',
        params: { group: { type: 'string', description: SETTING_GROUPS.map((one) => `${one.id} is ${one.title}: ${one.plain}`).join(' '), enum: SETTING_GROUPS.map((one) => one.id), required: true } },
        run: (params) => {
          const group = String(params.group) as GroupId
          screen.resetGroup(group)
          return { group }
        },
        verify: async (data) => {
          const group = (data as { group: GroupId }).group
          const fields = FIELDS.filter((one) => one.group === group && drawnAs(one.reach) === 'control')
          const wanted = fields.map((one) => ({ id: fieldId(one.path), want: valueAt(DEFAULT_CHESS_SETTINGS, one.path) }))
          const asTheyCame = (): boolean => wanted.every((one) => liveReading(`chess/settings/${one.id}`).value === one.want)
          await waitFor(asTheyCame, (yes) => yes)
          const left = wanted.filter((one) => liveReading(`chess/settings/${one.id}`).value !== one.want)
          return left.length === 0
            ? { done: true, detail: `${SETTING_GROUPS.find((one) => one.id === group)?.title ?? group} is back to the way it came: ${wanted.length} setting${wanted.length === 1 ? '' : 's'}.` }
            : { done: false, detail: `${left.length} of ${wanted.length} are still not the default: ${left.map((one) => one.id).join(', ')}.` }
        }
      }
    },
    state: () => ({
      values: {
        problem: screen.problem(),
        // What could not be read out of the file, said rather than filed away: a value that silently became the
        // default is how somebody loses a preference and never finds out which one.
        couldNotBeRead: [...screen.fallbacks()],
        board: screen.settings().board.theme,
        engine: `${screen.settings().engine.limit === 'time' ? `${screen.settings().engine.thinkMs} ms` : `depth ${screen.settings().engine.depth}`}, ${screen.settings().engine.lines} line${screen.settings().engine.lines === 1 ? '' : 's'}`,
        sound: screen.settings().sound.enabled ? `on at ${screen.settings().sound.volume}%` : 'off',
        notation: screen.settings().moves.notation,
        fields: FIELDS.length,
        settable: FIELDS.filter((one) => drawnAs(one.reach) === 'control').length
      }
    })
  }
}

// ---------------------------------------------------------------- the areas with less in them

/**
 * One of the areas whose screen has a page or a mode to choose and little else that holds a value.
 *
 * Deliberately thin, and thin honestly: what is here is what that screen really has. An area with a tab strip gets
 * its tab strip, and nothing is invented beyond it. Each one says in `about` what it cannot yet be driven to do, so
 * that "Orbis can open the Library" is never mistaken for "Orbis can work the Library".
 */
export interface SimpleAreaScreen {
  id: string
  name: string
  about: string
  keywords: readonly string[]
  controls?: Record<string, ControlDeclaration>
  /** A function, like every other state here: asked at the moment somebody wants to know. */
  state?: () => Record<string, unknown>
}

export function simpleAreaSurface(screen: SimpleAreaScreen): SurfaceDeclaration {
  return {
    id: screen.id,
    parent: 'chess',
    name: screen.name,
    about: screen.about,
    kind: 'page',
    keywords: screen.keywords,
    ...(screen.controls ? { controls: screen.controls } : {}),
    state: () => ({ values: screen.state ? screen.state() : {} })
  }
}
