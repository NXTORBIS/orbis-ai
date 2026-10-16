import { formatScore, forSide, type Score, type Side } from './evaluation.ts'

/**
 * Chess World's settings, and the keyboard.
 *
 * Three jobs, all of them pure so they can be tested without a window:
 *
 *  1. **What the settings are**, what each one is called in plain words, and -- the part that matters most -- *where
 *     each one actually lands*. That last one is `reach` below, and it exists because a settings screen is the
 *     easiest place in a program to ship a control that does nothing. Somebody turns off the move dots, nothing
 *     changes, and they conclude the whole screen is decoration. So every field says where its value goes, the
 *     screen renders a control only for a field whose value goes somewhere, and the fields that go nowhere yet are
 *     *listed as such* instead of being dressed up as switches.
 *
 *  2. **Reading a stored file.** Per field, never the whole file: a settings file with one bad number in it is a
 *     file with one bad number in it, not a file to be thrown away. Every fallback is reported, because a value
 *     that silently became the default is how somebody loses a preference and never finds out which one.
 *
 *  3. **The keyboard.** The chords Chess World claims, the chords the rest of Orbis already claims, the keys the
 *     board itself claims, and a check that no two of them claim the same key in the same place. The chords are
 *     data rather than a list of `if` statements so that the help sheet and the handler cannot drift apart, and so
 *     the conflict check has something to read.
 *
 * `evaluation.ts` stays the authority on what a score means and how it reads in pawns; this file only decides
 * whether to show it in pawns or in hundredths, and from whose side.
 */

// ---------------------------------------------------------------- the shapes

export type BoardThemeId = 'slate' | 'walnut' | 'forest' | 'ink' | 'contrast'
export type PieceDrawing = 'classic' | 'bold' | 'flat'
export type PieceSize = 'small' | 'normal' | 'large'
export type CoordinateMode = 'off' | 'edge'
export type CursorMark = 'outline' | 'strong'
export type DefaultOrientation = 'white' | 'black' | 'side-to-move'
export type Notation = 'san' | 'figurine' | 'uci'
export type EngineLimitKind = 'time' | 'depth'
export type ScoreUnit = 'pawns' | 'hundredths'
export type ScoreSide = 'white' | 'side-to-move'

export interface ChessBoardSettings {
  theme: BoardThemeId
  pieces: PieceDrawing
  pieceSize: PieceSize
  coordinates: CoordinateMode
  legalDots: boolean
  lastMoveMark: boolean
  checkMark: boolean
  cursor: CursorMark
  highlightFade: boolean
  orientation: DefaultOrientation
}

export interface ChessMovesSettings {
  notation: Notation
  numbers: boolean
}

export interface ChessSoundSettings {
  enabled: boolean
  /** 0 to 100. 0 is silence, which is not the same as off: off stops the sounds being made at all. */
  volume: number
  onMove: boolean
  onCapture: boolean
  onCheck: boolean
  onEnd: boolean
}

export interface ChessEngineSettings {
  limit: EngineLimitKind
  /** Milliseconds. The window's own channel clamps this to 50..600000, and so does this file. */
  thinkMs: number
  depth: number
  lines: number
  threads: number
  hashMb: number
}

export interface ChessAnalysisSettings {
  unit: ScoreUnit
  from: ScoreSide
  mateInWords: boolean
  autoAnalyse: boolean
  evalBar: boolean
  bestMoveArrow: boolean
}

export interface ChessSettings {
  board: ChessBoardSettings
  moves: ChessMovesSettings
  sound: ChessSoundSettings
  engine: ChessEngineSettings
  analysis: ChessAnalysisSettings
}

export type GroupId = keyof ChessSettings

// ---------------------------------------------------------------- the defaults

/**
 * The defaults.
 *
 * Two of them are deliberate departures from how the board looks today and both are said out loud on the screen.
 *
 * `cursor: 'strong'` -- the board's own keyboard cursor is a dashed outline in the accent colour, and the accent
 * colour against a light square is a contrast ratio of about 1.6. A keyboard cursor you cannot see is the same as
 * no keyboard cursor, so the default is the ring that works on both square colours.
 *
 * `sound.enabled: false` -- a program that starts making noises the first time it is opened is a program whose
 * sound gets switched off and never switched on again.
 */
export const DEFAULT_CHESS_SETTINGS: ChessSettings = Object.freeze({
  board: Object.freeze({
    theme: 'slate' as BoardThemeId,
    pieces: 'classic' as PieceDrawing,
    pieceSize: 'normal' as PieceSize,
    coordinates: 'edge' as CoordinateMode,
    legalDots: true,
    lastMoveMark: true,
    checkMark: true,
    cursor: 'strong' as CursorMark,
    highlightFade: true,
    orientation: 'white' as DefaultOrientation
  }),
  moves: Object.freeze({ notation: 'san' as Notation, numbers: true }),
  sound: Object.freeze({ enabled: false, volume: 55, onMove: true, onCapture: true, onCheck: true, onEnd: true }),
  engine: Object.freeze({
    limit: 'time' as EngineLimitKind,
    thinkMs: 2000,
    depth: 18,
    lines: 1,
    threads: 2,
    hashMb: 128
  }),
  analysis: Object.freeze({
    unit: 'pawns' as ScoreUnit,
    from: 'white' as ScoreSide,
    mateInWords: true,
    autoAnalyse: false,
    evalBar: true,
    bestMoveArrow: true
  })
}) as ChessSettings

// ---------------------------------------------------------------- the board's colours

/**
 * A board's colours, and the piece colours that go with them.
 *
 * The piece colours belong to the theme rather than being fixed, because a white piece on a white square is
 * invisible and the only thing that saves it is its outline. So each side has a fill *and* an edge, and the test
 * beside this file checks, for every theme and both square colours, that either the fill or the edge stands far
 * enough away from the square to be seen. That check is the reason these are data here and not hexes buried in a
 * stylesheet -- and the same test reads the stylesheet back to make sure the two have not drifted apart.
 */
export interface BoardTheme {
  id: BoardThemeId
  name: string
  plain: string
  light: string
  dark: string
  whitePiece: string
  whiteEdge: string
  blackPiece: string
  blackEdge: string
  /** The ring on a square a lesson or a puzzle is pointing at. */
  mark: string
  /**
   * The a-h and 1-8 labels, one colour for each square.
   *
   * Two of them rather than one because board.css draws them white on both colours, and white on the pale square
   * of the standard board is a contrast of about 1.8 to 1. A mid-tone board like Forest needs a DARK label on its
   * dark square, which is exactly why this cannot be one value with a rule of thumb behind it.
   */
  coordOnLight: string
  coordOnDark: string
}

export const BOARD_THEMES: readonly BoardTheme[] = Object.freeze([
  Object.freeze({
    id: 'slate' as BoardThemeId,
    name: 'Slate',
    plain: 'The blue-grey board Chess World opens with.',
    light: '#b9c6d4',
    dark: '#4f6076',
    whitePiece: '#ffffff',
    whiteEdge: '#04070b',
    blackPiece: '#101822',
    blackEdge: '#dfe7f0',
    mark: '#e0b341',
    coordOnLight: '#0c121a',
    coordOnDark: '#eef3f8'
  }),
  Object.freeze({
    id: 'walnut' as BoardThemeId,
    name: 'Walnut',
    plain: 'Warm brown, like a wooden set.',
    light: '#e3c89f',
    dark: '#8a5a3b',
    whitePiece: '#fdf7ec',
    whiteEdge: '#150c04',
    blackPiece: '#231408',
    blackEdge: '#f3e2cc',
    mark: '#2f7fd0',
    coordOnLight: '#201206',
    coordOnDark: '#fff6e8'
  }),
  Object.freeze({
    id: 'forest' as BoardThemeId,
    name: 'Forest',
    plain: 'The green and cream board most chess sites use.',
    light: '#e9edcc',
    dark: '#6f8c52',
    whitePiece: '#ffffff',
    whiteEdge: '#0a1004',
    blackPiece: '#16200f',
    blackEdge: '#eef3dd',
    mark: '#c7462f',
    coordOnLight: '#141c08',
    coordOnDark: '#0e1606'
  }),
  Object.freeze({
    id: 'ink' as BoardThemeId,
    name: 'Ink',
    plain: 'Dark and quiet, for a dark room.',
    light: '#9aa6b4',
    dark: '#2b3542',
    whitePiece: '#ffffff',
    whiteEdge: '#000000',
    blackPiece: '#070b10',
    blackEdge: '#c9d4e0',
    mark: '#f0c548',
    coordOnLight: '#080c12',
    coordOnDark: '#e6edf5'
  }),
  Object.freeze({
    id: 'contrast' as BoardThemeId,
    name: 'High contrast',
    plain: 'Black and white, with a heavy outline round every piece.',
    light: '#ffffff',
    dark: '#1a1a1a',
    whitePiece: '#ffffff',
    whiteEdge: '#000000',
    blackPiece: '#000000',
    blackEdge: '#ffffff',
    mark: '#ffd400',
    coordOnLight: '#000000',
    coordOnDark: '#ffffff'
  })
])

export const boardTheme = (id: BoardThemeId): BoardTheme => BOARD_THEMES.find((one) => one.id === id) ?? BOARD_THEMES[0]

// ---------------------------------------------------------------- what a number may be

export interface NumberRange {
  low: number
  high: number
  step: number
  /** What the number is in, for the screen: "ms", "MB", nothing. */
  unit: string
}

/**
 * The ranges, matching what the engine channel really accepts.
 *
 * These are not taste. `src/main/chess/ipc.ts` clamps a think time to 50..600000 ms, a depth to 1..40 and a number
 * of lines to 1..5 before the engine ever sees it, so a settings screen offering 60 lines would be offering
 * something that silently becomes 5. The numbers below are those clamps written down once, on the side of the wall
 * the screen is on.
 *
 * Threads and hash are the engine's own sizing (`defaultThreads`, `defaultHash` in `src/main/chess/engine.ts`) and
 * there is no channel to change them, which is why their fields say so rather than offering a slider.
 */
export const ENGINE_RANGES: Readonly<Record<'thinkMs' | 'depth' | 'lines' | 'threads' | 'hashMb', NumberRange>> = Object.freeze({
  thinkMs: Object.freeze({ low: 50, high: 600_000, step: 50, unit: 'ms' }),
  depth: Object.freeze({ low: 1, high: 40, step: 1, unit: '' }),
  lines: Object.freeze({ low: 1, high: 5, step: 1, unit: '' }),
  threads: Object.freeze({ low: 1, high: 8, step: 1, unit: '' }),
  hashMb: Object.freeze({ low: 16, high: 512, step: 16, unit: 'MB' })
})

export const VOLUME_RANGE: NumberRange = Object.freeze({ low: 0, high: 100, step: 5, unit: '%' })

// ---------------------------------------------------------------- where a setting lands

/**
 * Where a setting's value actually goes.
 *
 * The honest answer for each field, and the thing the screen is driven by. `stored` is a confession, not a kind of
 * plumbing: it means the value is kept and nothing reads it yet, and the screen prints `waitingFor` instead of
 * drawing a control. A field may not be `stored` without saying what will read it.
 */
export type Reach =
  /**
   * Chess World's own stylesheet, through a data attribute on the document element. These take effect on every
   * board on screen the moment they change, including boards this screen does not own.
   */
  | { kind: 'board-style' }
  /** Sent to the engine with every analysis, through `analysisRequestFrom`. */
  | { kind: 'engine-request' }
  /** How a score reads, through `formatForSettings`. */
  | { kind: 'score-display' }
  /** How a move reads in a list, through `notateSan`. */
  | { kind: 'move-display' }
  /** What the move sounds are, through the settings screen's own player. */
  | { kind: 'sound' }
  /** The engine sizes it itself and Orbis has no way to send it one. What it chose is shown instead. */
  | { kind: 'engine-sized'; shownAs: string }
  /** Kept, and nothing reads it yet. */
  | { kind: 'stored'; waitingFor: string }

/** A control is drawn only for a value that goes somewhere. The other two kinds are printed as a statement. */
export function drawnAs(reach: Reach): 'control' | 'statement' {
  return reach.kind === 'engine-sized' || reach.kind === 'stored' ? 'statement' : 'control'
}

// ---------------------------------------------------------------- the fields

export type FieldPath =
  | 'board.theme' | 'board.pieces' | 'board.pieceSize' | 'board.coordinates' | 'board.legalDots'
  | 'board.lastMoveMark' | 'board.checkMark' | 'board.cursor' | 'board.highlightFade' | 'board.orientation'
  | 'moves.notation' | 'moves.numbers'
  | 'sound.enabled' | 'sound.volume' | 'sound.onMove' | 'sound.onCapture' | 'sound.onCheck' | 'sound.onEnd'
  | 'engine.limit' | 'engine.thinkMs' | 'engine.depth' | 'engine.lines' | 'engine.threads' | 'engine.hashMb'
  | 'analysis.unit' | 'analysis.from' | 'analysis.mateInWords' | 'analysis.autoAnalyse' | 'analysis.evalBar'
  | 'analysis.bestMoveArrow'

export interface Choice {
  value: string
  label: string
  /** A sentence, when the words alone do not say what picking this does. */
  plain?: string
}

export type FieldShape =
  | { kind: 'switch' }
  | { kind: 'choice'; choices: readonly Choice[] }
  | { kind: 'number'; range: NumberRange }

export interface FieldInfo {
  path: FieldPath
  group: GroupId
  label: string
  /** What it does, in words somebody who has never read the code would use. */
  plain: string
  shape: FieldShape
  reach: Reach
}

const SWITCH: FieldShape = Object.freeze({ kind: 'switch' as const })

const themeChoices: readonly Choice[] = BOARD_THEMES.map((one) => Object.freeze({ value: one.id, label: one.name, plain: one.plain }))

export const FIELDS: readonly FieldInfo[] = Object.freeze([
  {
    path: 'board.theme', group: 'board', label: 'Board colours', plain: 'The two square colours, and the colours the pieces are drawn in on them.',
    shape: { kind: 'choice', choices: themeChoices }, reach: { kind: 'board-style' }
  },
  {
    path: 'board.pieces', group: 'board', label: 'How the pieces are drawn',
    plain: 'The pieces are letters from the chess alphabet rather than pictures, so this is how heavily they are outlined.',
    shape: {
      kind: 'choice',
      choices: [
        { value: 'classic', label: 'Classic', plain: 'A thin outline and a soft shadow.' },
        { value: 'bold', label: 'Bold', plain: 'A heavy outline all the way round. Easier to make out on a small board.' },
        { value: 'flat', label: 'Flat', plain: 'No outline and no shadow. Clearest on the high contrast board.' }
      ]
    },
    reach: { kind: 'board-style' }
  },
  {
    path: 'board.pieceSize', group: 'board', label: 'Piece size', plain: 'How much of its square a piece fills.',
    shape: { kind: 'choice', choices: [{ value: 'small', label: 'Small' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }] },
    reach: { kind: 'board-style' }
  },
  {
    path: 'board.coordinates', group: 'board', label: 'Square names',
    plain: 'The a-h and 1-8 labels along the edge of the board. Turning them off does not hide them from a screen reader: every square says its own name either way.',
    shape: { kind: 'choice', choices: [{ value: 'edge', label: 'Along the edge' }, { value: 'off', label: 'Off' }] },
    reach: { kind: 'board-style' }
  },
  {
    path: 'board.legalDots', group: 'board', label: 'Show where a piece can go',
    plain: 'A dot on every empty square the piece you have picked up may move to, and a ring round every piece it may take.',
    shape: SWITCH, reach: { kind: 'board-style' }
  },
  {
    path: 'board.lastMoveMark', group: 'board', label: 'Mark the last move', plain: 'Tints the square a piece came from and the square it went to.',
    shape: SWITCH, reach: { kind: 'board-style' }
  },
  {
    path: 'board.checkMark', group: 'board', label: 'Mark a king in check', plain: 'Turns the square red when that king is being attacked.',
    shape: SWITCH, reach: { kind: 'board-style' }
  },
  {
    path: 'board.cursor', group: 'board', label: 'The keyboard cursor',
    plain: 'The mark showing which square the arrow keys are on. The strong ring is two-tone, so it shows on a light square as well as a dark one.',
    shape: {
      kind: 'choice',
      choices: [
        { value: 'strong', label: 'Strong ring', plain: 'A thick light-and-dark ring. Visible on every square colour.' },
        { value: 'outline', label: 'Thin outline', plain: "The board's original dashed outline. Hard to see on a pale square." }
      ]
    },
    reach: { kind: 'board-style' }
  },
  {
    path: 'board.highlightFade', group: 'board', label: 'Let the marks fade in',
    plain: 'The square marks appear over a tenth of a second instead of at once. Off whenever the computer is set to reduce motion, whatever this says.',
    shape: SWITCH, reach: { kind: 'board-style' }
  },
  {
    path: 'board.orientation', group: 'board', label: 'Which way up a board opens',
    plain: 'Whether a board you open starts with White at the bottom, Black at the bottom, or the side whose turn it is.',
    shape: {
      kind: 'choice',
      choices: [
        { value: 'white', label: 'White at the bottom' },
        { value: 'black', label: 'Black at the bottom' },
        { value: 'side-to-move', label: 'Whoever is to move' }
      ]
    },
    reach: { kind: 'stored', waitingFor: 'The Play and Study screens choose which way up a board opens; neither reads this yet.' }
  },
  {
    path: 'moves.notation', group: 'moves', label: 'How moves are written',
    plain: 'Nf3 is the way moves are written in books. The figurine form replaces the piece letter with its symbol, which reads the same in any language. e2e4 is what the engine says.',
    shape: {
      kind: 'choice',
      choices: [
        { value: 'san', label: 'Nf3' },
        { value: 'figurine', label: '♘f3', plain: 'The same thing with the piece drawn instead of named.' },
        { value: 'uci', label: 'e2e4', plain: 'Where the piece started and where it went.' }
      ]
    },
    reach: { kind: 'move-display' }
  },
  {
    path: 'moves.numbers', group: 'moves', label: 'Number the moves', plain: 'The 1. 2. 3. down the side of the move list.',
    shape: SWITCH, reach: { kind: 'stored', waitingFor: 'The move list on the Study screen always numbers its moves; it does not read this yet.' }
  },
  {
    path: 'sound.enabled', group: 'sound', label: 'Make sounds',
    plain: 'Off means no sound is produced at all. That is not the same as the volume being nothing.',
    shape: SWITCH, reach: { kind: 'sound' }
  },
  {
    path: 'sound.volume', group: 'sound', label: 'How loud',
    plain: 'From nothing to full. The tones are quiet by design, so they can be heard under whatever else is playing.',
    shape: { kind: 'number', range: VOLUME_RANGE }, reach: { kind: 'sound' }
  },
  {
    path: 'sound.onMove', group: 'sound', label: 'A piece being put down',
    plain: 'A short tap when a move is played, including one you step past in a game you are reading through.',
    shape: SWITCH, reach: { kind: 'sound' }
  },
  {
    path: 'sound.onCapture', group: 'sound', label: 'A piece being taken',
    plain: 'A lower, harder knock in place of the tap, so taking a piece sounds different from a quiet move.',
    shape: SWITCH, reach: { kind: 'sound' }
  },
  {
    path: 'sound.onCheck', group: 'sound', label: 'Check',
    plain: 'Two quick high notes after the move, whenever the move has left a king under attack.',
    shape: SWITCH, reach: { kind: 'sound' }
  },
  {
    path: 'sound.onEnd', group: 'sound', label: 'The end of a game',
    plain: 'A falling pair of notes when a game finishes, however it finished.',
    shape: SWITCH, reach: { kind: 'sound' }
  },
  {
    path: 'engine.limit', group: 'engine', label: 'What stops the engine thinking',
    plain: 'A time gives you an answer when you asked for it. A depth gives you the same answer on every computer, but a hard position can take a long time.',
    shape: { kind: 'choice', choices: [{ value: 'time', label: 'A time' }, { value: 'depth', label: 'A depth' }] },
    reach: { kind: 'engine-request' }
  },
  {
    path: 'engine.thinkMs', group: 'engine', label: 'Time to think', plain: 'How long the engine gets, when a time is what stops it.',
    shape: { kind: 'number', range: ENGINE_RANGES.thinkMs }, reach: { kind: 'engine-request' }
  },
  {
    path: 'engine.depth', group: 'engine', label: 'Depth', plain: 'How many moves ahead, when a depth is what stops it. Each extra one roughly doubles the work.',
    shape: { kind: 'number', range: ENGINE_RANGES.depth }, reach: { kind: 'engine-request' }
  },
  {
    path: 'engine.lines', group: 'engine', label: 'How many lines', plain: 'One is the best move it found. More shows the next best as well, and costs time.',
    shape: { kind: 'number', range: ENGINE_RANGES.lines }, reach: { kind: 'engine-request' }
  },
  {
    path: 'engine.threads', group: 'engine', label: 'Processors', plain: 'How much of the computer the search may use.',
    shape: { kind: 'number', range: ENGINE_RANGES.threads },
    reach: { kind: 'engine-sized', shownAs: 'Threads' }
  },
  {
    path: 'engine.hashMb', group: 'engine', label: 'Memory', plain: 'Memory the engine keeps its working notes in.',
    shape: { kind: 'number', range: ENGINE_RANGES.hashMb },
    reach: { kind: 'engine-sized', shownAs: 'Hash' }
  },
  {
    path: 'analysis.unit', group: 'analysis', label: 'How a score reads',
    plain: 'Pawns is how a chess book writes it: +1.24 means a pawn and a quarter. Hundredths is what the engine says: +124.',
    shape: { kind: 'choice', choices: [{ value: 'pawns', label: '+1.24' }, { value: 'hundredths', label: '+124' }] },
    reach: { kind: 'score-display' }
  },
  {
    path: 'analysis.from', group: 'analysis', label: "Whose side the score is from",
    plain: 'From White means a plus is always good for White. From the side to move means a plus is always good for whoever is about to play.',
    shape: { kind: 'choice', choices: [{ value: 'white', label: 'Always White' }, { value: 'side-to-move', label: 'Whoever is to move' }] },
    reach: { kind: 'score-display' }
  },
  {
    path: 'analysis.mateInWords', group: 'analysis', label: 'Spell out a forced mate', plain: '"Mate in 3" rather than "M3".',
    shape: SWITCH, reach: { kind: 'score-display' }
  },
  {
    path: 'analysis.autoAnalyse', group: 'analysis', label: 'Ask the engine as you go', plain: 'Analyse each position as soon as the board reaches it, without being asked.',
    shape: SWITCH, reach: { kind: 'stored', waitingFor: 'The analysis panel decides when the engine is asked; it does not read this yet.' }
  },
  {
    path: 'analysis.evalBar', group: 'analysis', label: 'The bar beside the board', plain: 'The strip showing who stands better.',
    shape: SWITCH, reach: { kind: 'stored', waitingFor: 'Nothing draws the bar yet.' }
  },
  {
    path: 'analysis.bestMoveArrow', group: 'analysis', label: "An arrow on the engine's move", plain: 'Draws the move the engine likes on the board.',
    shape: SWITCH, reach: { kind: 'stored', waitingFor: 'The board draws no arrows yet.' }
  }
]) as readonly FieldInfo[]

export interface GroupInfo {
  id: GroupId
  title: string
  plain: string
}

export const GROUPS: readonly GroupInfo[] = Object.freeze([
  Object.freeze({ id: 'board' as GroupId, title: 'The board', plain: 'Everything here changes every board in Orbis as soon as you touch it.' }),
  Object.freeze({ id: 'moves' as GroupId, title: 'Moves', plain: 'How a move is written down.' }),
  Object.freeze({ id: 'sound' as GroupId, title: 'Sound', plain: 'Short tones made by Orbis itself. There are no sound files and nothing is downloaded.' }),
  Object.freeze({ id: 'engine' as GroupId, title: 'The engine', plain: 'How long Stockfish gets and how much it is asked for.' }),
  Object.freeze({ id: 'analysis' as GroupId, title: 'Analysis', plain: "How the engine's answer is shown." })
])

export const fieldsIn = (group: GroupId): readonly FieldInfo[] => FIELDS.filter((one) => one.group === group)
export const fieldInfo = (path: FieldPath): FieldInfo | undefined => FIELDS.find((one) => one.path === path)

// ---------------------------------------------------------------- reading and writing one field

/** The value at a path, as the screen needs it. */
export function valueAt(settings: ChessSettings, path: FieldPath): string | number | boolean {
  const [group, key] = path.split('.') as [GroupId, string]
  return (settings[group] as unknown as Record<string, string | number | boolean>)[key]
}

/**
 * The same settings with one field changed, and nothing else touched.
 *
 * A number is clamped to its range and a choice that is not one of the choices is refused, because the only other
 * thing to do with a bad value is store it and let the engine or the stylesheet deal with it later.
 */
export function withField(settings: ChessSettings, path: FieldPath, value: string | number | boolean): ChessSettings {
  const info = fieldInfo(path)
  if (!info) return settings
  const [group, key] = path.split('.') as [GroupId, string]
  let next: string | number | boolean
  if (info.shape.kind === 'switch') {
    if (typeof value !== 'boolean') return settings
    next = value
  } else if (info.shape.kind === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return settings
    next = clampTo(n, info.shape.range)
  } else {
    if (typeof value !== 'string' || !info.shape.choices.some((one) => one.value === value)) return settings
    next = value
  }
  return { ...settings, [group]: { ...(settings[group] as object), [key]: next } } as ChessSettings
}

/** Inside the range, and on one of its steps, so a slider never produces a value the range does not contain. */
export function clampTo(value: number, range: NumberRange): number {
  const held = Math.min(range.high, Math.max(range.low, value))
  const steps = Math.round((held - range.low) / range.step)
  return Math.min(range.high, Math.max(range.low, range.low + steps * range.step))
}

/** One group back to its defaults. Every other group is the object it already was. */
export function resetGroup(settings: ChessSettings, group: GroupId): ChessSettings {
  return { ...settings, [group]: { ...DEFAULT_CHESS_SETTINGS[group] } } as ChessSettings
}

// ---------------------------------------------------------------- reading a stored file

/**
 * A value that could not be used, and what was used instead.
 *
 * The point of reporting these is that the alternative is silence. Somebody sets the engine to think for ten
 * seconds, a later version narrows the range, the value quietly becomes two seconds, and they spend an afternoon
 * wondering why the engine got worse. `because` is written so it can be shown to them as it is.
 */
export interface SettingFallback {
  path: FieldPath
  /** What was in the file. Kept as text so a report can show it without anybody having to format `unknown`. */
  found: string
  used: string
  because: string
}

export interface LoadedChessSettings {
  settings: ChessSettings
  fallbacks: readonly SettingFallback[]
  /** True when the file was not an object at all: every field fell back, and that is worth saying once. */
  wholeFileUnreadable: boolean
}

const show = (value: unknown): string => {
  if (value === undefined) return 'nothing'
  if (typeof value === 'string') return `"${value.slice(0, 60)}"`
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  return Array.isArray(value) ? 'a list' : typeof value
}

/**
 * Settings read back from wherever they were kept.
 *
 * Field by field. A file with one impossible number in it keeps every other value in it, which is the whole
 * difference between this and `JSON.parse(...) ?? defaults`: the second one throws away nine good preferences
 * because the tenth was written by an older version.
 *
 * A missing key is not a fallback and is not reported. A file written before a field existed has none of it, and
 * calling that a problem would fill the screen with notices on the first launch after every release. A key that is
 * *present* and cannot be used is a different thing, and that is what is collected.
 */
export function readChessSettings(raw: unknown): LoadedChessSettings {
  const fallbacks: SettingFallback[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      settings: cloneDefaults(),
      fallbacks: raw === undefined ? [] : [{
        path: 'board.theme',
        found: show(raw),
        used: 'every default',
        because: 'The saved settings were not a set of settings at all, so there was nothing in them to keep.'
      }],
      wholeFileUnreadable: raw !== undefined
    }
  }

  const file = raw as Record<string, unknown>
  const out = cloneDefaults()

  for (const info of FIELDS) {
    const [group, key] = info.path.split('.') as [GroupId, string]
    const bag = file[group]
    if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) {
      // A whole group that is not a group. Reported once, against the group's first field, rather than once per field.
      if (bag !== undefined && fieldsIn(group)[0]?.path === info.path) {
        fallbacks.push({
          path: info.path,
          found: show(bag),
          used: `the defaults for ${group}`,
          because: `The "${group}" part of the saved settings was not a set of settings, so the ${fieldsIn(group).length} values in it could not be read.`
        })
      }
      continue
    }
    const value = (bag as Record<string, unknown>)[key]
    if (value === undefined) continue

    const fallback = DEFAULT_CHESS_SETTINGS[group] as unknown as Record<string, string | number | boolean>
    const def = fallback[key]

    if (info.shape.kind === 'switch') {
      if (typeof value === 'boolean') { set(out, group, key, value); continue }
      fallbacks.push({ path: info.path, found: show(value), used: String(def), because: `${info.label} is either on or off, and that is neither.` })
      continue
    }

    if (info.shape.kind === 'number') {
      const range = info.shape.range
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fallbacks.push({ path: info.path, found: show(value), used: `${String(def)}${range.unit}`, because: `${info.label} has to be a number.` })
        continue
      }
      const held = clampTo(value, range)
      if (held !== value) {
        fallbacks.push({
          path: info.path,
          found: `${value}${range.unit}`,
          used: `${held}${range.unit}`,
          because: value < range.low || value > range.high
            ? `${info.label} can only be between ${range.low}${range.unit} and ${range.high}${range.unit}.`
            : `${info.label} moves in steps of ${range.step}${range.unit}.`
        })
      }
      set(out, group, key, held)
      continue
    }

    const choices = info.shape.choices
    if (typeof value === 'string' && choices.some((one) => one.value === value)) { set(out, group, key, value); continue }
    fallbacks.push({
      path: info.path,
      found: show(value),
      used: String(def),
      because: `${info.label} has to be one of: ${choices.map((one) => one.value).join(', ')}.`
    })
  }

  return { settings: out, fallbacks, wholeFileUnreadable: false }
}

function cloneDefaults(): ChessSettings {
  return {
    board: { ...DEFAULT_CHESS_SETTINGS.board },
    moves: { ...DEFAULT_CHESS_SETTINGS.moves },
    sound: { ...DEFAULT_CHESS_SETTINGS.sound },
    engine: { ...DEFAULT_CHESS_SETTINGS.engine },
    analysis: { ...DEFAULT_CHESS_SETTINGS.analysis }
  }
}

function set(settings: ChessSettings, group: GroupId, key: string, value: string | number | boolean): void {
  ;(settings[group] as unknown as Record<string, string | number | boolean>)[key] = value
}

/** One fallback as a sentence somebody can read on the screen. */
export const describeFallback = (one: SettingFallback): string =>
  `${one.because} ${one.found === 'nothing' ? '' : `It said ${one.found}. `}Using ${one.used}.`.replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- a session's own overrides

/**
 * Which fields a single game may disagree with you about.
 *
 * The rule, and the reason for it: an override belongs to **this game**, not to you. Which way up a board is and
 * how long the engine gets on this position are properties of what you are looking at -- a correspondence game you
 * play from Black's side, a hard position you want thirty seconds on. What colour the board is and whether the
 * computer makes noises are properties of *you*, and a game that could change them would be a game that redecorates
 * Orbis.
 *
 * So: a per-session override wins over the global preference, field by field -- but only for a field in this list.
 * An override of anything else is ignored and said out loud rather than quietly dropped, because an override that
 * is accepted and then disregarded is the worst of the three possible behaviours.
 */
export const SESSION_OVERRIDABLE: readonly FieldPath[] = Object.freeze([
  'board.coordinates',
  'board.legalDots',
  'board.lastMoveMark',
  'board.checkMark',
  'board.orientation',
  'moves.notation',
  'moves.numbers',
  'engine.limit',
  'engine.thinkMs',
  'engine.depth',
  'engine.lines',
  'analysis.unit',
  'analysis.from',
  'analysis.mateInWords',
  'analysis.autoAnalyse',
  'analysis.evalBar',
  'analysis.bestMoveArrow'
])

export const overridable = (path: FieldPath): boolean => SESSION_OVERRIDABLE.includes(path)

/** What one game wants differently. Partial twice over: a group may be missing, and so may any field in it. */
export type ChessSessionOverride = {
  [K in GroupId]?: Partial<ChessSettings[K]>
}

export interface IgnoredOverride {
  path: FieldPath
  found: string
  because: string
}

export interface EffectiveChessSettings {
  settings: ChessSettings
  /** Which fields this game is actually disagreeing with the preference about. */
  overridden: readonly FieldPath[]
  ignored: readonly IgnoredOverride[]
}

/**
 * The settings in force: the preference, with this game's overrides laid on top.
 *
 * Precedence, in one sentence: **a per-session override beats the global preference for its own field and for
 * nothing else.** Not for its group, not for the file -- for the field. Everything about reading a stored value
 * applies again here, so an override cannot smuggle a number past a range that the preference would have been
 * clamped to.
 */
export function effectiveChessSettings(global: ChessSettings, override?: ChessSessionOverride | null): EffectiveChessSettings {
  const settings = {
    board: { ...global.board },
    moves: { ...global.moves },
    sound: { ...global.sound },
    engine: { ...global.engine },
    analysis: { ...global.analysis }
  }
  const overridden: FieldPath[] = []
  const ignored: IgnoredOverride[] = []
  if (!override || typeof override !== 'object') return { settings, overridden, ignored }

  for (const [group, bag] of Object.entries(override)) {
    if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) continue
    for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
      const path = `${group}.${key}` as FieldPath
      const info = fieldInfo(path)
      if (!info) {
        ignored.push({ path, found: show(value), because: 'There is no such setting.' })
        continue
      }
      if (!overridable(path)) {
        ignored.push({ path, found: show(value), because: `${info.label} belongs to you rather than to one game, so a game cannot change it.` })
        continue
      }
      if (value === undefined) continue
      const before = valueAt(settings as ChessSettings, path)
      const after = withField(settings as ChessSettings, path, value as string | number | boolean)
      const taken = valueAt(after, path)
      if (taken === before && !sameShape(info, value)) {
        ignored.push({ path, found: show(value), because: `${info.label} cannot be set to that.` })
        continue
      }
      ;(settings[group as GroupId] as unknown as Record<string, string | number | boolean>)[key] = taken
      if (taken !== before) overridden.push(path)
    }
  }
  return { settings: settings as ChessSettings, overridden, ignored }
}

/** Whether a value is even the right kind of thing for a field, used to tell "refused" from "already that". */
function sameShape(info: FieldInfo, value: unknown): boolean {
  if (info.shape.kind === 'switch') return typeof value === 'boolean'
  if (info.shape.kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === 'string' && info.shape.choices.some((one) => one.value === value)
}

// ---------------------------------------------------------------- what the stylesheet reads

/**
 * The data attributes Chess World's stylesheet keys on, set on the document element.
 *
 * This is how a setting reaches a board this screen does not own. `board.css` paints a square with a fixed colour
 * and takes no prop for it, and `Board.tsx` is not this area's file to change -- but a rule written as
 * `:root[data-cw-board='walnut'] .cw-sq.light` is more specific than `.cw-sq.light`, so it wins on every board in
 * the window without a line of anybody else's code moving. The same trick the window's own theme uses.
 *
 * Only `board-style` fields appear here, and the test beside this file checks that -- an attribute for a field that
 * the stylesheet does not act on would be a setting that looks plumbed in and is not.
 */
export function boardStyleAttributes(settings: ChessSettings): Record<string, string> {
  const b = settings.board
  return {
    'data-cw-board': b.theme,
    'data-cw-pieces': b.pieces,
    'data-cw-piece-size': b.pieceSize,
    'data-cw-coords': b.coordinates,
    'data-cw-dots': b.legalDots ? 'on' : 'off',
    'data-cw-lastmove': b.lastMoveMark ? 'on' : 'off',
    'data-cw-checkmark': b.checkMark ? 'on' : 'off',
    'data-cw-cursor': b.cursor,
    'data-cw-fade': b.highlightFade ? 'on' : 'off'
  }
}

/** Every attribute name the stylesheet may be keyed on, so they can all be removed again. */
export const BOARD_STYLE_ATTRIBUTES: readonly string[] = Object.freeze(Object.keys(boardStyleAttributes(DEFAULT_CHESS_SETTINGS)))

// ---------------------------------------------------------------- what the engine is asked

/**
 * The exact object `window.api.chessAnalyse` is handed.
 *
 * One place, so the clamps in `src/main/chess/ipc.ts` are matched here rather than discovered by watching a
 * 600-second search come back in two seconds. Only the limit that was chosen is sent: sending both a time and a
 * depth means whichever the engine reaches first, which is not a setting anybody chose.
 */
export function analysisRequestFrom(settings: ChessSettings, fen: string, id?: string): {
  fen: string
  id?: string
  movetime?: number
  depth?: number
  multipv: number
} {
  const e = settings.engine
  return {
    fen,
    ...(id ? { id } : {}),
    ...(e.limit === 'time' ? { movetime: clampTo(e.thinkMs, ENGINE_RANGES.thinkMs) } : { depth: clampTo(e.depth, ENGINE_RANGES.depth) }),
    multipv: clampTo(e.lines, ENGINE_RANGES.lines)
  }
}

/** What the engine will be asked, as a sentence, so the screen can say it before anybody presses anything. */
export function describeEngineRequest(settings: ChessSettings): string {
  const e = settings.engine
  const stop = e.limit === 'time'
    ? e.thinkMs >= 1000 ? `${(e.thinkMs / 1000).toFixed(e.thinkMs % 1000 === 0 ? 0 : 1)} seconds` : `${e.thinkMs} milliseconds`
    : `depth ${e.depth}`
  return `${e.lines === 1 ? 'The best line' : `The best ${e.lines} lines`}, stopping at ${stop}.`
}

// ---------------------------------------------------------------- how a score and a move read

/**
 * A score, the way this person asked for it.
 *
 * `evaluation.ts` stays the authority: pawns go through `formatScore` exactly as before, and the side is turned
 * round by `forSide`, which is the function that exists for it. This only chooses between them.
 */
export function formatForSettings(score: Score, settings: ChessSettings, toMove: Side): string {
  const side: Side = settings.analysis.from === 'white' ? 'w' : toMove
  const seen = forSide(score, side)
  if (seen.kind === 'none') return '—'
  if (seen.kind === 'mate') {
    if (!settings.analysis.mateInWords) return formatScore(score, side)
    if (seen.moves === 0) return 'mate'
    return seen.moves > 0 ? `mate in ${seen.moves}` : `mated in ${Math.abs(seen.moves)}`
  }
  if (settings.analysis.unit === 'pawns') return formatScore(score, side)
  const sign = seen.cp > 0 ? '+' : seen.cp < 0 ? '−' : ''
  return `${sign}${Math.abs(seen.cp)}`
}

/** The chess alphabet, for the figurine form. Always the white symbols: a figurine says the piece, not its colour. */
const FIGURE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }

/**
 * One move written the way this person asked for it.
 *
 * `uci` needs the engine's own coordinates, which a stored move carries beside its SAN -- there is no way to turn
 * "Nf3" into "g1f3" without the position, and guessing one would be inventing a move. So when the coordinates are
 * not to hand, the readable form is given back unchanged rather than a wrong answer.
 */
export function notateSan(san: string, settings: ChessSettings, uci?: string): string {
  const how = settings.moves.notation
  if (how === 'uci') return uci && uci.length >= 4 ? uci : san
  if (how === 'san') return san
  // Only a leading piece letter is a piece. The B in "Bxb5" is a bishop; the b in "bxc6" is a pawn's file.
  const first = san[0]
  return first !== undefined && FIGURE[first] !== undefined ? FIGURE[first] + san.slice(1) : san
}

// ---------------------------------------------------------------- the keyboard

/**
 * Where a key press is listened for.
 *
 * Nested, outermost first: the window hears everything, the screen hears what the window has not taken, and the
 * board, the move list and the shortcut sheet hear what the screen has not. Two shortcuts on the same key in the
 * *same* place is a bug -- one of them will never fire. Two on the same key in places on one line of descent is a
 * design decision, and the only honest thing to do is to say which is which, which is what `conflictsIn` does.
 */
export type ShortcutScope = 'window' | 'chess-screen' | 'chess-board' | 'chess-move-list' | 'chess-shortcut-sheet'

/** Each scope's parent. The window has none; the board, the list and the sheet all sit inside the screen. */
const SCOPE_PARENT: Readonly<Record<ShortcutScope, ShortcutScope | null>> = Object.freeze({
  window: null,
  'chess-screen': 'window',
  'chess-board': 'chess-screen',
  'chess-move-list': 'chess-screen',
  'chess-shortcut-sheet': 'chess-screen'
})

export const SCOPE_NAME: Readonly<Record<ShortcutScope, string>> = Object.freeze({
  window: 'Anywhere in Orbis',
  'chess-screen': 'On the Chess World screen',
  'chess-board': 'When the keyboard is on the board',
  'chess-move-list': 'When the keyboard is in the move list',
  'chess-shortcut-sheet': 'While this sheet is open'
})

const scopeChain = (scope: ShortcutScope): ShortcutScope[] => {
  const chain: ShortcutScope[] = [scope]
  let at = SCOPE_PARENT[scope]
  while (at) { chain.push(at); at = SCOPE_PARENT[at] }
  return chain
}

/** One scope contains the other, so a key in both is decided by where the keyboard is. */
const relatedScopes = (a: ShortcutScope, b: ShortcutScope): boolean => scopeChain(a).includes(b) || scopeChain(b).includes(a)

export interface Shortcut {
  id: string
  /** Normalised: modifiers in the order Ctrl, Alt, Shift, then the key. */
  chord: string
  scope: ShortcutScope
  action: string
  description: string
  /** The condition beyond the scope, when there is one: "not while typing", "only once a game is open". */
  when?: string
  /** Where it is handled. Named so a conflict report says which file to look in. */
  owner: string
}

/**
 * A key press as a chord, so the sheet and the handler agree on what a chord is.
 *
 * Meta counts as Ctrl because the window's own handler treats them the same (`!e.ctrlKey && !e.metaKey` is its one
 * guard), so writing them as two chords would claim a difference Orbis does not make.
 *
 * Shift is recorded for a letter and for a named key, and not for a punctuation mark: `?` *is* Shift and a slash on
 * most keyboards, and on some it is not Shift at all, so `Shift+?` would be a chord that never matches on half the
 * machines Orbis runs on. `?` matches whenever the key that arrived was a question mark, which is the question.
 */
export function chordFromEvent(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string {
  const raw = event.key
  const key = raw === ' ' ? 'Space' : raw.length === 1 ? raw.toUpperCase() : raw
  const named = key.length > 1
  const letter = /^[A-Z]$/.test(key)
  const bits: string[] = []
  if (event.ctrlKey || event.metaKey) bits.push('Ctrl')
  if (event.altKey) bits.push('Alt')
  if (event.shiftKey && (named || letter)) bits.push('Shift')
  bits.push(key)
  return bits.join('+')
}

const KEY_SPELLING: Record<string, string> = {
  ctrl: 'Ctrl', control: 'Ctrl', cmd: 'Ctrl', meta: 'Ctrl', alt: 'Alt', shift: 'Shift',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  home: 'Home', end: 'End', enter: 'Enter', escape: 'Escape', esc: 'Escape', space: 'Space', tab: 'Tab',
  pageup: 'PageUp', pagedown: 'PageDown', comma: ',', f1: 'F1', f6: 'F6'
}

/** A chord written by hand into the same shape `chordFromEvent` produces, so the two can be compared at all. */
export function normalizeChord(chord: string): string {
  const parts = chord.split('+').map((one) => one.trim()).filter((one) => one.length > 0)
  const mods: string[] = []
  let key = ''
  for (const part of parts) {
    const spelt = KEY_SPELLING[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part)
    if (spelt === 'Ctrl' || spelt === 'Alt' || spelt === 'Shift') {
      if (!mods.includes(spelt)) mods.push(spelt)
    } else key = spelt
  }
  const order = ['Ctrl', 'Alt', 'Shift'].filter((one) => mods.includes(one))
  // Shift is dropped from a punctuation chord for the reason given on chordFromEvent.
  const keep = key.length === 1 && !/^[A-Z0-9]$/.test(key) ? order.filter((one) => one !== 'Shift') : order
  return [...keep, key].filter((one) => one.length > 0).join('+')
}

export const matchesChord = (chord: string, event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): boolean =>
  normalizeChord(chord) === chordFromEvent(event)

/** A chord for reading: the arrow keys as arrows, Space as a word. */
const CHORD_FACE: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Escape: 'Esc'
}
export const chordFace = (chord: string): string =>
  normalizeChord(chord).split('+').map((one) => CHORD_FACE[one] ?? one).join('+')

/**
 * The chords the rest of Orbis already claims.
 *
 * Read out of the window's own handlers and its native menu rather than imagined, so the conflict check below is
 * checking something real:
 *
 *  - `src/renderer/src/App.tsx`, the window's keydown handler, which fires only with Ctrl or Cmd held;
 *  - the same file's Escape handler, which steps aside while a dialog is on screen;
 *  - its push-to-talk, which is a key held rather than pressed;
 *  - the native menu in `src/main/index.ts`, whose accelerators the operating system claims before the window sees
 *    them at all -- those are the ones a chess shortcut can never win.
 *
 * It is a list of what was found, not a registry anybody writes to; if a chord moves in App.tsx this goes stale,
 * which is why the test asserts that each one is still in the file it says it is.
 */
export const APP_SHORTCUTS: readonly Shortcut[] = Object.freeze([
  { id: 'app.new-chat', chord: 'Ctrl+Shift+O', scope: 'window', action: 'Start a new chat', description: 'Leaves whatever screen you are on.', owner: 'App.tsx' },
  { id: 'app.incognito', chord: 'Ctrl+Shift+N', scope: 'window', action: 'Incognito chat', description: 'Turns the private chat on or off.', owner: 'App.tsx' },
  { id: 'app.settings', chord: 'Ctrl+,', scope: 'window', action: 'Open Settings', description: 'Opens at Account.', owner: 'App.tsx' },
  { id: 'app.browser', chord: 'Ctrl+Shift+B', scope: 'window', action: 'Open the browser', description: '', owner: 'App.tsx' },
  { id: 'app.sidebar', chord: 'Ctrl+B', scope: 'window', action: 'Show or hide the sidebar', description: '', owner: 'App.tsx' },
  { id: 'app.address-bar', chord: 'Ctrl+E', scope: 'window', action: 'Go to the address bar', description: '', owner: 'App.tsx' },
  { id: 'app.palette', chord: 'Ctrl+K', scope: 'window', action: 'Everything Orbis can do', description: 'The command palette.', owner: 'App.tsx' },
  { id: 'app.find-in-chat', chord: 'Ctrl+Shift+F', scope: 'window', action: 'Search this conversation', description: '', owner: 'App.tsx' },
  { id: 'app.student', chord: 'Ctrl+Shift+U', scope: 'window', action: 'Open Student', description: '', owner: 'App.tsx' },
  {
    id: 'app.push-to-talk', chord: 'Ctrl+Shift+M', scope: 'window', action: 'Hold to talk',
    description: 'Held rather than pressed: it records while the keys are down.', owner: 'App.tsx'
  },
  {
    id: 'app.escape', chord: 'Escape', scope: 'window', action: 'Out of this screen',
    description: 'Closes the screen you are on.',
    when: 'Not while a dialog, menu or popover is open, and not while there is text in the box you are typing in.',
    owner: 'App.tsx'
  },
  { id: 'menu.new-chat', chord: 'Ctrl+N', scope: 'window', action: 'New chat', description: 'From the File menu.', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.quit', chord: 'Ctrl+Q', scope: 'window', action: 'Quit Orbis', description: 'From the File menu.', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.undo', chord: 'Ctrl+Z', scope: 'window', action: 'Undo the last edit', description: 'The operating system handles this one.', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.redo', chord: 'Ctrl+Shift+Z', scope: 'window', action: 'Redo the last edit', description: '', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.cut', chord: 'Ctrl+X', scope: 'window', action: 'Cut the selection', description: '', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.copy', chord: 'Ctrl+C', scope: 'window', action: 'Copy the selection', description: '', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.paste', chord: 'Ctrl+V', scope: 'window', action: 'Paste the clipboard', description: '', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.reload', chord: 'Ctrl+R', scope: 'window', action: 'Reload the window', description: '', owner: 'src/main/index.ts (native menu)' },
  { id: 'menu.devtools', chord: 'Ctrl+Shift+I', scope: 'window', action: 'Developer tools', description: '', owner: 'src/main/index.ts (native menu)' }
]) as readonly Shortcut[]

/**
 * The keys the board itself answers.
 *
 * Not this area's to change -- they are written in `Board.tsx` -- but they have to be in the map, because a chess
 * shortcut on an arrow key and the board's own arrow keys are the same key, and the sheet is the only place anybody
 * will find out which one they are about to get.
 */
export const BOARD_KEYS: readonly Shortcut[] = Object.freeze([
  { id: 'board.left', chord: 'ArrowLeft', scope: 'chess-board', action: 'Move the cursor one square left', description: '', owner: 'Board.tsx' },
  { id: 'board.right', chord: 'ArrowRight', scope: 'chess-board', action: 'Move the cursor one square right', description: '', owner: 'Board.tsx' },
  { id: 'board.up', chord: 'ArrowUp', scope: 'chess-board', action: 'Move the cursor one square up', description: '', owner: 'Board.tsx' },
  { id: 'board.down', chord: 'ArrowDown', scope: 'chess-board', action: 'Move the cursor one square down', description: '', owner: 'Board.tsx' },
  {
    id: 'board.take', chord: 'Enter', scope: 'chess-board', action: 'Pick the piece up, or put it down',
    description: 'On your own piece it picks it up. On a square it may go to it plays the move.', owner: 'Board.tsx'
  },
  { id: 'board.take-space', chord: 'Space', scope: 'chess-board', action: 'The same as Enter', description: '', owner: 'Board.tsx' },
  { id: 'board.drop', chord: 'Escape', scope: 'chess-board', action: 'Let go of the piece', description: 'Only while a piece is picked up.', when: 'Only while a piece is picked up.', owner: 'Board.tsx' }
]) as readonly Shortcut[]

/**
 * Chess World's own chords.
 *
 * Every one of them is a bare key or a Shift key, and that is the design rather than an accident: the window's own
 * handler does nothing at all unless Ctrl or Cmd is held, so a bare key cannot collide with it, and the native menu
 * owns a dozen Ctrl chords that a screen could never win anyway. The price is that a bare key is a letter somebody
 * might be typing, so every one of them carries the same condition and the handler has to honour it.
 */
export const CHESS_SHORTCUTS: readonly Shortcut[] = Object.freeze([
  {
    id: 'chess.previous', chord: 'ArrowLeft', scope: 'chess-screen', action: 'Back one move',
    description: 'Steps back through the game.', when: 'Not while the keyboard is on the board, where the arrows move the cursor instead.',
    owner: 'ChessSettings.tsx'
  },
  {
    id: 'chess.next', chord: 'ArrowRight', scope: 'chess-screen', action: 'Forward one move',
    description: 'Steps forward through the game.', when: 'Not while the keyboard is on the board.', owner: 'ChessSettings.tsx'
  },
  { id: 'chess.first', chord: 'Home', scope: 'chess-screen', action: 'The starting position', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.last', chord: 'End', scope: 'chess-screen', action: 'The last move played', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.flip', chord: 'F', scope: 'chess-screen', action: 'Turn the board round', description: 'Swaps which side is at the bottom.', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.ask', chord: 'A', scope: 'chess-screen', action: 'Ask the engine about this position', description: 'Uses the engine settings as they stand.', when: 'Not while typing, and only once the engine is set up.', owner: 'ChessSettings.tsx' },
  { id: 'chess.stop', chord: 'Shift+A', scope: 'chess-screen', action: 'Stop the engine', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.new', chord: 'N', scope: 'chess-screen', action: 'A new board', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.save', chord: 'S', scope: 'chess-screen', action: 'Save this game as a PGN file', description: '', when: 'Not while typing, and only with a game open.', owner: 'ChessSettings.tsx' },
  { id: 'chess.play', chord: '1', scope: 'chess-screen', action: 'The Play tab', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.study', chord: '2', scope: 'chess-screen', action: 'The Study tab', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.library', chord: '3', scope: 'chess-screen', action: 'The Library tab', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.live', chord: '4', scope: 'chess-screen', action: 'The Live tab', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.settings', chord: 'Shift+S', scope: 'chess-screen', action: 'Chess World settings', description: '', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  { id: 'chess.help', chord: '?', scope: 'chess-screen', action: 'This list of keys', description: 'Opens the sheet you are reading.', when: 'Not while typing.', owner: 'ChessSettings.tsx' },
  {
    id: 'chess.help-close', chord: 'Escape', scope: 'chess-shortcut-sheet', action: 'Close this sheet',
    description: "Orbis's own Escape steps aside while a dialog is open, so this one closes the sheet and leaves Chess World where it is.",
    owner: 'ui/Modal.tsx'
  }
]) as readonly Shortcut[]

/** Every key in the map, in the order the sheet shows them. */
export const ALL_SHORTCUTS: readonly Shortcut[] = Object.freeze([...CHESS_SHORTCUTS, ...BOARD_KEYS, ...APP_SHORTCUTS])

export interface ShortcutConflict {
  chord: string
  /**
   * `same-place` is a bug: two handlers in one place, and one of them never runs.
   * `nested-place` is a decision: the inner one wins while the keyboard is there, and the sheet has to say so.
   */
  kind: 'same-place' | 'nested-place'
  entries: readonly Shortcut[]
}

/**
 * Every chord claimed more than once, and whether that is a clash or a choice.
 *
 * Two entries in unrelated places -- the board and the move list -- are not a conflict at all: the keyboard can
 * only be in one of them.
 */
export function conflictsIn(shortcuts: readonly Shortcut[]): ShortcutConflict[] {
  const byChord = new Map<string, Shortcut[]>()
  for (const one of shortcuts) {
    const chord = normalizeChord(one.chord)
    byChord.set(chord, [...(byChord.get(chord) ?? []), one])
  }
  const out: ShortcutConflict[] = []
  for (const [chord, entries] of byChord) {
    if (entries.length < 2) continue
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]
        const b = entries[j]
        if (a.scope === b.scope) { out.push({ chord, kind: 'same-place', entries: [a, b] }); continue }
        if (relatedScopes(a.scope, b.scope)) out.push({ chord, kind: 'nested-place', entries: [a, b] })
      }
    }
  }
  return out
}

/** A conflict as a sentence for the sheet. */
export function describeConflict(conflict: ShortcutConflict): string {
  const [a, b] = conflict.entries
  if (conflict.kind === 'same-place') {
    return `${chordFace(conflict.chord)} is claimed twice in the same place: "${a.action}" (${a.owner}) and "${b.action}" (${b.owner}). One of them will never happen.`
  }
  const inner = scopeChain(a.scope).length > scopeChain(b.scope).length ? a : b
  const outer = inner === a ? b : a
  return `${chordFace(conflict.chord)} does two things depending on where the keyboard is: ${SCOPE_NAME[inner.scope].toLowerCase()} it is "${inner.action}", otherwise ${SCOPE_NAME[outer.scope].toLowerCase()} it is "${outer.action}".`
}

// ---------------------------------------------------------------- what the board can and cannot do

/**
 * The board, read rather than assumed.
 *
 * `Board.tsx` is not this area's file, so these are findings, not fixes. They are in the product rather than only in
 * a report because somebody who uses a screen reader needs to know *now* which of these are true, and being told
 * honestly that a finished game cannot be read square by square is worth more than finding out by trying.
 *
 * Each one names what was read. The fixes belong to whoever owns `Board.tsx`.
 */
export interface AccessNote {
  what: string
  state: 'works' | 'partly' | 'missing'
  detail: string
  /** What would have to change, for the person who owns that file. */
  needs?: string
}

export const BOARD_ACCESS_NOTES: readonly AccessNote[] = Object.freeze([
  {
    what: 'Walking the board with the arrow keys',
    state: 'works',
    detail: 'The board takes the keyboard, the arrows move a cursor one square at a time, and the arrows do not scroll the page while they do it.'
  },
  {
    what: 'Playing a move with the keyboard',
    state: 'works',
    detail: 'Enter or Space on one of your own pieces picks it up; the same key on a square it may go to plays the move. Only squares the rules allow are offered.'
  },
  {
    what: 'Every square says what is on it',
    state: 'works',
    detail: 'Each square carries its own name and what stands on it, so a screen reader reads "e4, white pawn" rather than "button".'
  },
  {
    what: 'Knowing where the cursor is without looking',
    state: 'missing',
    detail: 'The cursor is drawn on the screen but nothing says it. The board holds the keyboard itself and each square is unreachable by it, so a screen reader announces the board once and then nothing at all as the arrows move.',
    needs: 'The board needs aria-activedescendant pointing at the square the cursor is on, with an id on each square -- or the keyboard has to move to the square itself.'
  },
  {
    what: 'Reading a game that has finished, or one you are only watching',
    state: 'missing',
    detail: 'The squares of a board that is not being played are disabled buttons. A disabled button is skipped by most screen readers and cannot take the keyboard, so the position cannot be read square by square at all.',
    needs: 'aria-disabled rather than disabled, and a board that still takes the keyboard when it is not interactive.'
  },
  {
    what: 'Being told a move was played, or that it is check',
    state: 'missing',
    detail: 'Nothing is announced. Whose turn it is sits in the name of the board itself, which readers announce unreliably when it changes under them, and picking a piece up, playing a move, check and checkmate are all silent.',
    needs: 'A polite live region on the board saying the move just played, and check or checkmate when the rules report it.'
  },
  {
    what: 'A marked square in a lesson or a puzzle',
    state: 'missing',
    detail: 'A marked square gets a gold ring on the screen and its description does not mention it. Neither does the square of a king in check. Both are visible and neither is said.',
    needs: "The square's description should name both, beside what it already says."
  },
  {
    what: 'Choosing what a pawn becomes',
    state: 'partly',
    detail: 'The chooser is a named dialog and its four buttons each say which piece they are. But the keyboard is not moved into it, it does not hold the keyboard inside itself, and Escape does not close it -- the board still has the keyboard, and Escape there only lets go of the piece, leaving the chooser on the screen over a board with nothing picked up.',
    needs: "The window's own useFocusTrap, aria-modal, and Escape taken by the chooser; cancelling should let go of the piece too."
  },
  {
    what: 'Seeing the keyboard cursor',
    state: 'partly',
    detail: 'The cursor is a dashed outline in the accent colour. Against the pale square of the standard board that is a contrast of about 1.6 to 1, which is close to invisible. Chess World settings offers a strong two-tone ring instead, and uses it by default.',
    needs: 'Nothing, while the setting is on. The board’s own default is the problem.'
  }
]) as readonly AccessNote[]
