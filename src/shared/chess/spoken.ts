import { readMove } from './calculation.ts'
import { isSquare } from './blindfold.ts'

/**
 * Words somebody said, turned into something they could have typed -- or refused (Section 224).
 *
 * The blindfold trainer is the one screen in Chess World where speaking is the natural way to answer: somebody
 * holding a position in their head and looking at nothing has no reason to be looking at a keyboard either. Orbis
 * already has a microphone and transcribes on this machine (`src/renderer/src/lib/voiceInput.ts`), so what is
 * missing is only this: the step between "ee four" and `e4`.
 *
 * ## Why it refuses rather than guesses
 *
 * The letters of the board and the letters of the pieces overlap, and a transcript has no capital letters to tell
 * them apart. "bee six" is `b6` if the b was a file and `Bb6` if it was a bishop, and in a position where both are
 * legal there is no way to know which was meant. Picking one would be worse than not hearing at all: a trainer that
 * marks somebody wrong for a move they did not make teaches them to distrust the marking.
 *
 * So every reading the words could have is kept, and when more than one of them is a real move here the answer is a
 * question -- the readings, for the person to pick from -- and never one of them chosen quietly. The same words in a
 * position where only one reading is legal come back as that move, because then there is nothing to choose between.
 *
 * ## What this never does
 *
 * It does not decide legality. `readMove` does, which asks `rules.ts`, which is the only module in Chess World
 * allowed an opinion about what is legal. This file turns words into text and asks.
 *
 * It does not record, transcribe, or reach the network. It is handed words that already exist.
 *
 * Typing always works. Nothing here is ever the only way to answer, which is why a transcript this file cannot make
 * sense of is a small inconvenience rather than a dead end: the words are handed back as they were heard, in the box,
 * for somebody to correct.
 */

// ---------------------------------------------------------------- the words

/**
 * How the files get said.
 *
 * Three families, all of them heard in real life: the letter on its own ("b"), the letter as a word a transcriber
 * writes ("bee", "see"), and the spelling alphabets people fall back on when a letter will not carry -- the NATO one
 * and the older chess one ("anna, bella, cesar, david, eva, felix, gustav, hector"), which is still what players use
 * when they are calling moves across a room.
 */
const FILE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  a: 'a', ay: 'a', eh: 'a', alpha: 'a', anna: 'a',
  b: 'b', be: 'b', bee: 'b', bravo: 'b', bella: 'b',
  c: 'c', cee: 'c', see: 'c', sea: 'c', charlie: 'c', cesar: 'c', caesar: 'c',
  d: 'd', dee: 'd', delta: 'd', david: 'd',
  e: 'e', ee: 'e', echo: 'e', eva: 'e',
  f: 'f', ef: 'f', eff: 'f', foxtrot: 'f', felix: 'f',
  g: 'g', gee: 'g', golf: 'g', gustav: 'g',
  h: 'h', aitch: 'h', haitch: 'h', hotel: 'h', hector: 'h'
})

/** How the ranks get said, including what a transcriber hears instead. "to" for 2 and "ate" for 8 are the common two. */
const RANK_WORDS: Readonly<Record<string, string>> = Object.freeze({
  '1': '1', one: '1', won: '1',
  '2': '2', two: '2', to: '2', too: '2',
  '3': '3', three: '3', tree: '3',
  '4': '4', four: '4', for: '4', fore: '4',
  '5': '5', five: '5',
  '6': '6', six: '6', sicks: '6',
  '7': '7', seven: '7',
  '8': '8', eight: '8', ate: '8'
})

/**
 * The pieces, as the letter notation writes them.
 *
 * "night" and "horse" are what people say and what a transcriber writes. The entries that matter most are `b`, `be`
 * and `bee`: they are **also** file words, and that overlap is the whole reason `hearMove` refuses rather than
 * guesses. A pawn move carries no letter, so "pawn" maps to nothing and is dropped.
 *
 * "castle" is not here. It is caught earlier as castling, which is what the word means when somebody says it.
 */
const PIECE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  king: 'K', k: 'K',
  queen: 'Q', q: 'Q',
  rook: 'R', rooke: 'R', tower: 'R', r: 'R',
  bishop: 'B', b: 'B', be: 'B', bee: 'B',
  knight: 'N', night: 'N', horse: 'N', n: 'N',
  pawn: '', pond: ''
})

const TAKES: readonly string[] = Object.freeze(['takes', 'take', 'captures', 'capture', 'x', 'times', 'by'])
const SHORT_CASTLE: readonly string[] = Object.freeze(['short', 'kingside', 'kings', 'king-side'])
const LONG_CASTLE: readonly string[] = Object.freeze(['long', 'queenside', 'queens', 'queen-side'])
const PROMOTES: readonly string[] = Object.freeze(['promotes', 'promote', 'promoting', 'equals', 'becomes', 'into'])
const GONE_WORDS: readonly string[] = Object.freeze(['taken', 'gone', 'captured', 'off', 'nowhere', 'none', 'dead'])

/** The words, lower case, with punctuation taken off. Hyphens are kept, because "king-side" is one word. */
export function words(spoken: string): string[] {
  return (spoken ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9'-]+/g, ' ')
    .split(/\s+/)
    .map((one) => one.replace(/^-+|-+$/g, ''))
    .filter((one) => one.length > 0)
}

// ---------------------------------------------------------------- what came back

export type HeardFault =
  /** Nothing was said, or nothing in it was a word. */
  | 'nothing-heard'
  /** The words were heard and none of them is a square, a piece or a move. */
  | 'not-understood'
  /** Several readings, and more than one of them is real. Never chosen between. */
  | 'ambiguous'

export interface Heard {
  ok: boolean
  /** What to put in the box. Empty when nothing could be made of the words. */
  text: string
  /** Every reading the words could have, when more than one is real. Empty otherwise. */
  choices: readonly string[]
  /** The words as they were heard, always, so a person can correct them by hand. */
  heard: string
  fault?: HeardFault
  /** Said to the person, as it stands. */
  says: string
}

const heardOk = (text: string, heard: string, says: string): Heard => ({ ok: true, text, choices: [], heard, says })

const heardNo = (fault: HeardFault, heard: string, says: string, choices: readonly string[] = []): Heard =>
  ({ ok: false, text: '', choices, heard, fault, says })

// ---------------------------------------------------------------- squares

/**
 * Squares out of spoken words.
 *
 * A square is a file word followed by a rank word, and that is the whole grammar. It is deliberately strict about
 * the pair and loose about everything around it, so "um, e four and then d five" gives `e4 d5` -- the filler between
 * two squares cannot make a third one.
 *
 * Squares do not go ambiguous the way moves do: "bee six" is the square b6 whichever family the "bee" came from,
 * because a square has no piece letter in it. So this answers with the squares it found and refuses only when it
 * found none.
 */
export function hearSquares(spoken: string): Heard {
  const heard = (spoken ?? '').trim()
  const list = words(spoken)
  if (list.length === 0) return heardNo('nothing-heard', heard, 'Nothing was heard. Say the squares, or type them.')

  // "It has been taken" is a real answer to "where is this piece now", so it is recognised here rather than
  // becoming "not understood" and sending somebody looking for a square they were right not to give.
  if (list.some((one) => GONE_WORDS.includes(one)) && !list.some((one) => FILE_WORDS[one] !== undefined)) {
    return heardOk('taken', heard, 'Heard: it has been taken.')
  }

  const squares: string[] = []
  for (let at = 0; at < list.length; at += 1) {
    const plain = list[at]
    // Already a square, because a transcriber sometimes writes one: "e4".
    if (isSquare(plain)) { squares.push(plain); continue }
    const file = FILE_WORDS[plain]
    if (file === undefined) continue
    const rank = RANK_WORDS[list[at + 1] ?? '']
    if (rank === undefined) continue
    squares.push(`${file}${rank}`)
    at += 1
  }

  if (squares.length === 0) {
    return heardNo('not-understood', heard, `"${heard}" has no square in it. A square is a letter and a number -- "e four".`)
  }
  const unique = [...new Set(squares)]
  return heardOk(unique.join(' '), heard, `Heard: ${unique.join(', ')}.`)
}

// ---------------------------------------------------------------- a move

/**
 * Every way the words could be written as a move.
 *
 * Built rather than matched, because the overlap between the file letters and the piece letters means one spoken
 * word often belongs to two readings and both have to survive to the position, which is the only thing that can
 * tell them apart.
 */
export function moveReadings(spoken: string): string[] {
  const list = words(spoken)
  if (list.length === 0) return []

  if (list.some((one) => LONG_CASTLE.includes(one)) && list.some((one) => /^castl/.test(one) || one === 'o' || one === 'oh')) {
    return ['O-O-O']
  }
  if (list.some((one) => SHORT_CASTLE.includes(one)) && list.some((one) => /^castl/.test(one) || one === 'o' || one === 'oh')) {
    return ['O-O']
  }
  // "castles" on its own is short castling, which is what the word means when nobody says which side.
  if (list.some((one) => /^castl(e|es|ing)$/.test(one))) return ['O-O']

  const takes = list.some((one) => TAKES.includes(one))
  const promoteAt = list.findIndex((one) => PROMOTES.includes(one))

  // The promotion piece is whatever piece word comes after "promotes"/"equals". Taken out of the list first so it
  // cannot also be read as the piece that is moving.
  let promotion = ''
  let body = list
  if (promoteAt >= 0) {
    const after = list.slice(promoteAt + 1).map((one) => PIECE_WORDS[one]).filter((one) => one !== undefined && one !== '')
    promotion = after[0] ?? ''
    body = list.slice(0, promoteAt)
  }

  // Already written as a move, because a transcriber sometimes writes one: "Nf3", "e4", "exd5".
  const written = body.filter((one) => /^[kqrbn]?[a-h]?[1-8]?x?[a-h][1-8](=[qrbn])?$/.test(one))

  const squares = hearSquares(body.join(' '))
  const found = squares.ok && squares.text !== 'taken' ? squares.text.split(' ') : []
  const to = found[found.length - 1] ?? ''
  const from = found.length > 1 ? found[found.length - 2] : ''

  // Piece words, in the order they were said. A word that is both a piece and a file ("b", "bee" -> bishop or file
  // b) is in both maps on purpose; the position decides which it was.
  const pieces = body.map((one) => PIECE_WORDS[one]).filter((one): one is string => one !== undefined && one !== '')

  /**
   * Whether a word was said that can only be a piece.
   *
   * This is what decides whether the bare square stays a reading. "knight f three" means the knight and nothing
   * else, so offering `f3` alongside `Nf3` would make every such phrase look ambiguous in any position where the
   * pawn can move too -- which is most of them. But "bee four" is a file word and a piece word at once, so both
   * readings have to reach the position, because only the position can tell them apart.
   */
  const pieceOnly = body.some((one) => {
    const piece = PIECE_WORDS[one]
    return piece !== undefined && piece !== '' && FILE_WORDS[one] === undefined
  })

  /** A pawn capture names its own file and no rank: "e takes d five" is `exd5`. */
  const takesAt = body.findIndex((one) => TAKES.includes(one))
  const fromFile = takesAt > 0 ? FILE_WORDS[body[takesAt - 1]] ?? '' : ''

  const out: string[] = []
  const add = (text: string): void => {
    const full = promotion ? `${text}=${promotion}` : text
    if (full && !out.includes(full)) out.push(full)
  }

  for (const one of written) add(one.replace(/^([kqrbn])/, (m) => m.toUpperCase()))
  if (to) {
    // Longest reading first: from-square and to-square together is the least ambiguous thing somebody can say.
    if (from) {
      add(`${from}${to}`)
      for (const piece of pieces) add(`${piece}${from[0]}${takes ? 'x' : ''}${to}`)
    }
    for (const piece of pieces) add(`${piece}${takes ? 'x' : ''}${to}`)
    if (takes && fromFile) add(`${fromFile}x${to}`)
    if (takes && from) add(`${from[0]}x${to}`)
    if (!pieceOnly) add(to)
  }
  return out
}

/**
 * One move out of spoken words, against the position it would be played in.
 *
 * Each reading is offered to `readMove`, which asks the rules. The readings that are real moves here are collected,
 * and then:
 *
 *   - one move: that is the move, and it comes back written properly.
 *   - several: a question. The readings are handed back for somebody to pick from, and nothing is played.
 *   - none: the words were heard and are not a move here, which is said with the rules' own reason where there is
 *     exactly one reading to be refused about.
 */
export function hearMove(fen: string, spoken: string): Heard {
  const heard = (spoken ?? '').trim()
  const readings = moveReadings(spoken)
  if (words(spoken).length === 0) return heardNo('nothing-heard', heard, 'Nothing was heard. Say the move, or type it.')
  if (readings.length === 0) {
    return heardNo('not-understood', heard, `"${heard}" is not a move Orbis can make out. Try "knight f three", or type it.`)
  }

  // Collected by the move itself, not by the text: "e two e four", "e four" and "e2e4" are three readings of one
  // move, and counting them as three answers would make every clearly spoken move look ambiguous.
  const byMove = new Map<string, string>()
  for (const reading of readings) {
    const read = readMove(fen, reading)
    if (!read.ok) continue
    if (!byMove.has(read.move.uci)) byMove.set(read.move.uci, read.move.san)
  }
  const real = [...byMove.values()]

  if (real.length === 1) return heardOk(real[0], heard, `Heard: ${real[0]}.`)
  if (real.length > 1) {
    return heardNo(
      'ambiguous',
      heard,
      `"${heard}" could be ${real.join(' or ')}, and both are legal here. Which did you mean?`,
      real
    )
  }

  // Nothing legal. Where there was one reading the rules have a reason worth passing on.
  if (readings.length === 1) {
    const read = readMove(fen, readings[0])
    if (!read.ok) return heardNo('not-understood', heard, `Heard ${readings[0]}. ${read.says}`)
  }
  return heardNo(
    'not-understood',
    heard,
    `"${heard}" came out as ${readings.join(' or ')}, and none of those can be played here.`,
    readings
  )
}
