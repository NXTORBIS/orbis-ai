import { START_FEN, applyMove, checkFen, positionKey, sideToMove } from './rules.ts'
import { buildMoves, fenAt, type GameMeta, type GameMove, type StoredGame } from './model.ts'
import { readPgn, writePgn } from './pgn.ts'
import { CLASS_LABEL, classify, type MoveClass, type Score, type Side } from './evaluation.ts'
import { identify, recordFor } from './openings.ts'

/**
 * A personal repertoire: the lines you have decided to play, and a way of finding out whether you remember them.
 *
 * The one rule this file is built around: **the repertoire knows what you intended, and nothing else**. It can say
 * "that is not the move you wrote down". It cannot say "that move is bad", because it has no idea -- a repertoire is
 * a record of decisions, not an evaluation. A move is only ever named a mistake here when an engine score is handed
 * in with it, and then the naming is `classify` in evaluation.ts doing it from real numbers (Sections 139, 140).
 *
 * So the recall trainer has two different answers where a lesser one would have had a single "wrong":
 *
 *   - *off book* -- a perfectly legal move that is not in your repertoire. Said without judgement.
 *   - *a mistake* -- only with an engine score to show for it, and the score is carried in the answer.
 *
 * Everything here is pure. Storing a repertoire is the window's job; `lineToStored` and `lineFromStored` are the
 * shape it uses, so the rules about what a line is stay in one place.
 */

export interface RepertoireLine {
  id: string
  /** Whose book this line belongs to: 'w' for your White repertoire, 'b' for your Black one. */
  side: Side
  /** What you call it. */
  name: string
  startFen: string
  /** The line itself, both sides' moves, already played and checked. */
  moves: GameMove[]
  /** Your own words about the line. */
  note?: string
  /** What the opening dataset calls the end of the line, when it names it. Worked out, never typed in. */
  eco?: string
  opening?: string
  createdAt: number
  updatedAt: number
}

export interface Repertoire {
  lines: RepertoireLine[]
}

export const emptyRepertoire = (): Repertoire => ({ lines: [] })

export const linesFor = (rep: Repertoire, side: Side): RepertoireLine[] =>
  rep.lines.filter((line) => line.side === side)

// ---- making and changing lines

export interface LineInput {
  id: string
  side: Side
  name: string
  /** Moves as written: standard notation or coordinates, both sides, in order. */
  moves: string[]
  startFen?: string
  note?: string
  now: number
}

export type LineProblem = 'no-moves' | 'illegal-move' | 'bad-start-position' | 'no-name' | 'nothing-of-yours'

export type LineResult =
  | { ok: true; line: RepertoireLine }
  | { ok: false; problem: LineProblem; reason: string; /** The moves that were legal before it went wrong. */ kept: GameMove[] }

/**
 * Turning a written line into a line, by playing it.
 *
 * Nothing is stored that cannot be played. A line with a move that will not go is refused with the move named, and
 * the moves before it are handed back so a person does not lose their typing (Sections 139, 407).
 */
export function makeLine(input: LineInput): LineResult {
  const name = input.name.trim()
  if (!name) return { ok: false, problem: 'no-name', reason: 'A line needs a name, or you will not find it again.', kept: [] }
  const startFen = input.startFen ?? START_FEN
  const check = checkFen(startFen)
  if (!check.ok) return { ok: false, problem: 'bad-start-position', reason: check.reason ?? 'That starting position is not valid.', kept: [] }
  const written = input.moves.map((san) => san.trim()).filter(Boolean)
  if (!written.length) return { ok: false, problem: 'no-moves', reason: 'A line with no moves says nothing.', kept: [] }
  const built = buildMoves(startFen, written.map((san) => ({ san })))
  if (!built.ok) {
    const at = built.failedAt
    return {
      ok: false,
      problem: 'illegal-move',
      reason: at
        ? `"${at.move}" cannot be played in the position it reaches, so the line stops at move ${Math.floor(at.index / 2) + 1}. The ${built.moves.length} moves before it are still here.`
        : 'One of those moves cannot be played.',
      kept: built.moves
    }
  }
  const yours = built.moves.filter((_, index) => sideToMove(index === 0 ? startFen : built.moves[index - 1].fen) === input.side)
  if (!yours.length) {
    return {
      ok: false,
      problem: 'nothing-of-yours',
      reason: `This line contains no move of your own, so there would be nothing to remember. A ${input.side === 'w' ? 'White' : 'Black'} line has to include at least one ${input.side === 'w' ? 'White' : 'Black'} move.`,
      kept: built.moves
    }
  }
  const last = built.moves[built.moves.length - 1].fen
  const named = recordFor(last) ?? null
  return {
    ok: true,
    line: {
      id: input.id,
      side: input.side,
      name,
      startFen,
      moves: built.moves,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(named ? { eco: named.eco, opening: named.name } : {}),
      createdAt: input.now,
      updatedAt: input.now
    }
  }
}

export const addLine = (rep: Repertoire, line: RepertoireLine): Repertoire => ({
  ...rep,
  lines: [...rep.lines.filter((one) => one.id !== line.id), line]
})

export const removeLine = (rep: Repertoire, id: string): Repertoire => ({
  ...rep,
  lines: rep.lines.filter((one) => one.id !== id)
})

/** Renaming, re-noting, or moving a line to the other colour. The moves are not touched here. */
export function editLine(rep: Repertoire, id: string, patch: { name?: string; note?: string; side?: Side }, now: number): Repertoire {
  return {
    ...rep,
    lines: rep.lines.map((line) => {
      if (line.id !== id) return line
      const name = patch.name?.trim()
      const note = patch.note?.trim()
      return {
        ...line,
        ...(name ? { name } : {}),
        ...(patch.side ? { side: patch.side } : {}),
        ...(note === undefined ? {} : note ? { note } : { note: undefined }),
        updatedAt: now
      }
    })
  }
}

/** Changing a line's moves. It goes through `makeLine`, so a replacement is checked exactly as a new line is. */
export function replaceMoves(rep: Repertoire, id: string, moves: string[], now: number): { repertoire: Repertoire; result: LineResult } {
  const existing = rep.lines.find((one) => one.id === id)
  if (!existing) {
    return { repertoire: rep, result: { ok: false, problem: 'no-moves', reason: 'That line is not here any more.', kept: [] } }
  }
  const result = makeLine({
    id,
    side: existing.side,
    name: existing.name,
    moves,
    startFen: existing.startFen,
    ...(existing.note ? { note: existing.note } : {}),
    now
  })
  if (!result.ok) return { repertoire: rep, result }
  const line: RepertoireLine = { ...result.line, createdAt: existing.createdAt, updatedAt: now }
  return { repertoire: addLine(rep, line), result: { ok: true, line } }
}

// ---- the book

export interface BookMove {
  san: string
  uci: string
  /** The position this move reaches. */
  fen: string
  /** Which of your lines play it. */
  lineIds: string[]
  /** The shallowest depth at which it appears, in plies from the line's start. */
  ply: number
}

export interface BookEntry {
  key: string
  fen: string
  turn: Side
  /** What you mean to play here. Usually one move. */
  yours: BookMove[]
  /** What your lines expect from the other side here. */
  theirs: BookMove[]
}

export interface BookConflict {
  key: string
  fen: string
  /** Your own two (or more) different answers to one position. */
  moves: string[]
  lineIds: string[]
  reason: string
}

export interface Book {
  side: Side
  /** Every position your lines pass through, by `positionKey`. */
  positions: Map<string, BookEntry>
  /** Positions where you have written down more than one reply. A fact about the book, not an error to hide. */
  conflicts: BookConflict[]
  lineCount: number
  /** How many moves of your own the book holds. */
  yourMoves: number
}

const put = (list: BookMove[], move: GameMove, lineId: string, ply: number): BookMove[] => {
  const found = list.find((one) => one.uci === move.uci)
  if (found) {
    if (!found.lineIds.includes(lineId)) found.lineIds.push(lineId)
    found.ply = Math.min(found.ply, ply)
    return list
  }
  list.push({ san: move.san, uci: move.uci, fen: move.fen, lineIds: [lineId], ply })
  return list
}

/**
 * The repertoire turned inside out: by position rather than by line.
 *
 * This is the shape a recall trainer needs, because what you are asked is always "what do you play *here*", and
 * several lines pass through the same position. Where two of your lines answer one position differently, both are
 * kept and the disagreement is reported: picking one silently would quietly change your repertoire for you.
 */
export function buildBook(lines: RepertoireLine[], side: Side): Book {
  const positions = new Map<string, BookEntry>()
  const mine = lines.filter((line) => line.side === side)
  let yourMoves = 0
  for (const line of mine) {
    let fen = line.startFen
    for (const [index, move] of line.moves.entries()) {
      const key = positionKey(fen)
      const turn = sideToMove(fen)
      const entry = positions.get(key) ?? { key, fen, turn, yours: [], theirs: [] }
      if (turn === side) {
        put(entry.yours, move, line.id, index + 1)
        yourMoves += 1
      } else {
        put(entry.theirs, move, line.id, index + 1)
      }
      positions.set(key, entry)
      fen = move.fen
    }
    // The position the line ends in is part of the book too, even with nothing to play from it: that is how the
    // trainer knows a line has finished rather than gone quiet.
    const endKey = positionKey(fen)
    if (!positions.has(endKey)) positions.set(endKey, { key: endKey, fen, turn: sideToMove(fen), yours: [], theirs: [] })
  }
  const conflicts: BookConflict[] = []
  for (const entry of positions.values()) {
    if (entry.yours.length > 1) {
      conflicts.push({
        key: entry.key,
        fen: entry.fen,
        moves: entry.yours.map((m) => m.san),
        lineIds: [...new Set(entry.yours.flatMap((m) => m.lineIds))],
        reason: `Your lines give ${entry.yours.length} different answers to this position (${entry.yours.map((m) => m.san).join(', ')}). The trainer will accept any of them and will say which line each belongs to.`
      })
    }
  }
  return { side, positions, conflicts, lineCount: mine.length, yourMoves }
}

export interface BookProblem {
  kind: 'conflict' | 'ends-on-their-move' | 'duplicate' | 'no-lines'
  /** Said plainly, for a person. */
  message: string
  lineIds: string[]
}

/**
 * What is worth telling you about your own book.
 *
 * Not errors: a repertoire is allowed to be unfinished. These are the things that make a book behave oddly when you
 * come to use it, and each one names the lines it is about.
 */
export function bookProblems(lines: RepertoireLine[], side: Side): BookProblem[] {
  const mine = lines.filter((line) => line.side === side)
  const out: BookProblem[] = []
  if (!mine.length) {
    return [{ kind: 'no-lines', message: `There is nothing in your ${side === 'w' ? 'White' : 'Black'} repertoire yet.`, lineIds: [] }]
  }
  const book = buildBook(lines, side)
  for (const conflict of book.conflicts) out.push({ kind: 'conflict', message: conflict.reason, lineIds: conflict.lineIds })
  const seen = new Map<string, string[]>()
  for (const line of mine) {
    const last = line.moves[line.moves.length - 1]
    if (last && sideToMove(last.fen) === side) {
      out.push({
        kind: 'ends-on-their-move',
        message: `"${line.name}" stops where it is your move, so it does not say what you play there.`,
        lineIds: [line.id]
      })
    }
    const signature = `${positionKey(line.startFen)}|${line.moves.map((m) => m.uci).join(' ')}`
    seen.set(signature, [...(seen.get(signature) ?? []), line.id])
  }
  for (const [, ids] of seen) {
    if (ids.length > 1) {
      const names = ids.map((id) => mine.find((line) => line.id === id)?.name ?? id)
      out.push({ kind: 'duplicate', message: `These lines are the same moves twice: ${names.join(', ')}.`, lineIds: ids })
    }
  }
  return out
}

export interface RepertoireSummary {
  side: Side
  lines: number
  positions: number
  yourMoves: number
  deepest: { lineId: string; name: string; plies: number } | null
  /** The ECO codes your lines reach, from the opening dataset. Empty when the dataset names none of them. */
  eco: string[]
  conflicts: number
}

/** A count of what you have, every number taken from the lines themselves. */
export function summarise(lines: RepertoireLine[], side: Side): RepertoireSummary {
  const mine = lines.filter((line) => line.side === side)
  const book = buildBook(lines, side)
  let deepest: { lineId: string; name: string; plies: number } | null = null
  const eco = new Set<string>()
  for (const line of mine) {
    if (!deepest || line.moves.length > deepest.plies) deepest = { lineId: line.id, name: line.name, plies: line.moves.length }
    const named = identify({ moves: line.moves.map((m) => m.san), startFen: line.startFen })
    if (named.known) eco.add(named.eco)
  }
  return {
    side,
    lines: mine.length,
    positions: book.positions.size,
    yourMoves: book.yourMoves,
    deepest,
    eco: [...eco].sort(),
    conflicts: book.conflicts.length
  }
}

// ---- the recall trainer

export type RecallVerdict = 'right' | 'off-book' | 'illegal' | 'not-in-book' | 'their-move' | 'bad-position'

/** An engine's opinion, when one has been asked for. Without this, no move is ever called bad. */
export interface MoveEvidence {
  best: Score
  played: Score
  depth?: number
  engine?: string
}

export interface MoveQuality {
  verdict: MoveClass
  label: string
  depth?: number
  engine?: string
}

export interface RecallGrade {
  verdict: RecallVerdict
  /** What to say to the person. Never calls a move bad on its own authority. */
  message: string
  /** What your repertoire plays here. Empty when it has nothing to say. */
  expected: BookMove[]
  played?: { san: string; uci: string; fen: string }
  /** Which of your lines the move belongs to, when it is one of yours. */
  lineIds?: string[]
  /** Only ever present when an engine score was handed in with the move. */
  quality?: MoveQuality
}

const sideName = (side: Side): string => (side === 'w' ? 'White' : 'Black')

/**
 * Grading one move against your repertoire.
 *
 * The four answers are deliberately different things:
 *
 *   - **right** -- it is a move you wrote down for this position.
 *   - **off book** -- legal, but not one of yours. This is not a mistake and is not described as one.
 *   - **not in book** -- your repertoire does not cover this position at all, so it has nothing to recall.
 *   - **illegal** -- not a move at all.
 *
 * An engine score, if one is given, is added to any of them as a separate, labelled opinion. That is the only route
 * by which the word "mistake" can appear.
 */
export function gradeRecall(book: Book, fen: string, played: string, evidence?: MoveEvidence): RecallGrade {
  const check = checkFen(fen)
  if (!check.ok) return { verdict: 'bad-position', message: check.reason ?? 'That position is not valid.', expected: [] }
  const turn = sideToMove(fen)
  const entry = book.positions.get(positionKey(fen))
  const expected = entry?.yours ?? []
  if (turn !== book.side) {
    return {
      verdict: 'their-move',
      message: `It is ${sideName(turn)} to move here, and this is your ${sideName(book.side)} repertoire, so there is nothing for you to recall.`,
      expected: []
    }
  }
  const made = applyMove(fen, played)
  if (!made) {
    return {
      verdict: 'illegal',
      message: `"${played}" cannot be played in this position.`,
      expected
    }
  }
  const asPlayed = { san: made.san, uci: made.uci, fen: made.after }
  const quality = evidence
    ? ((): MoveQuality => {
        const verdict = classify(evidence.best, evidence.played, turn, { ...(evidence.depth === undefined ? {} : { depth: evidence.depth }) })
        return {
          verdict,
          label: CLASS_LABEL[verdict],
          ...(evidence.depth === undefined ? {} : { depth: evidence.depth }),
          ...(evidence.engine === undefined ? {} : { engine: evidence.engine })
        }
      })()
    : undefined
  const engineSays = quality
    ? ` The engine${quality.engine ? ` (${quality.engine})` : ''} calls it ${quality.label.toLowerCase()}${quality.depth === undefined ? '' : ` at depth ${quality.depth}`}.`
    : ''

  if (!entry || !expected.length) {
    return {
      verdict: 'not-in-book',
      message: `This position is not in your ${sideName(book.side)} repertoire, so there is nothing to compare ${made.san} against.${engineSays || ' Nothing here says whether it is a good move or a bad one.'}`,
      expected: [],
      played: asPlayed,
      ...(quality ? { quality } : {})
    }
  }
  const match = expected.find((one) => one.uci === made.uci)
  if (match) {
    const others = expected.filter((one) => one.uci !== made.uci)
    return {
      verdict: 'right',
      message: others.length
        ? `${made.san} is yours. Your repertoire also gives ${others.map((o) => o.san).join(' and ')} here.${engineSays}`
        : `${made.san} is the move you wrote down here.${engineSays}`,
      expected,
      played: asPlayed,
      lineIds: match.lineIds,
      ...(quality ? { quality } : {})
    }
  }
  return {
    verdict: 'off-book',
    message: `${made.san} is a legal move, but it is not in your repertoire here: you wrote down ${expected.map((o) => o.san).join(' or ')}.${engineSays || ' That says nothing about whether it is good, only that it is not what you chose.'}`,
    expected,
    played: asPlayed,
    ...(quality ? { quality } : {})
  }
}

// ---- drilling a line

/** 'revealed' is not a verdict on a move: it is what happened when there was no move to judge. */
export type DrillOutcome = RecallVerdict | 'revealed'

export interface DrillStep {
  lineId: string
  /** The move you gave, or null when you asked to be shown instead. */
  san: string | null
  /** The move this line plays here. */
  expected: string
  outcome: DrillOutcome
}

export interface Drill {
  side: Side
  /** The lines to go through, in order. */
  lineIds: string[]
  /** Which of them you are on. */
  at: number
  /** How far into that line, in plies already played. */
  ply: number
  fen: string
  asked: number
  right: number
  offBook: number
  illegal: number
  /** Positions you were shown the answer to. */
  revealed: number
  done: boolean
  history: DrillStep[]
  last?: RecallGrade
}

const lineOf = (lines: RepertoireLine[], id: string | undefined): RepertoireLine | null =>
  (id ? lines.find((one) => one.id === id) ?? null : null)

/**
 * Walking forward to the next position where it is your move.
 *
 * The other side's moves come from the line itself and are played for you: a drill is about what you play, and
 * making you enter your opponent's moves would be asking you to remember somebody else's decisions.
 */
function advance(drill: Drill, lines: RepertoireLine[]): Drill {
  let at = drill.at
  let ply = drill.ply
  for (;;) {
    const line = lineOf(lines, drill.lineIds[at])
    if (!line) return { ...drill, at, ply, done: true, fen: drill.fen }
    if (ply >= line.moves.length) {
      at += 1
      ply = 0
      if (at >= drill.lineIds.length) {
        const last = lineOf(lines, drill.lineIds[drill.lineIds.length - 1])
        return { ...drill, at, ply: 0, done: true, fen: last ? fenAt(last, last.moves.length) : drill.fen }
      }
      continue
    }
    const fen = fenAt(line, ply)
    if (sideToMove(fen) === drill.side) return { ...drill, at, ply, fen, done: false }
    // Their move: play it and keep going.
    ply += 1
  }
}

export type DrillOrder = 'given' | 'shortest-first'

/** Starting a drill over the lines of one colour. Null when there is nothing of yours to ask about. */
export function startDrill(lines: RepertoireLine[], side: Side, order: DrillOrder = 'given'): Drill | null {
  const mine = lines.filter((line) => line.side === side && line.moves.length)
  if (!mine.length) return null
  const sorted = order === 'shortest-first' ? [...mine].sort((a, b) => a.moves.length - b.moves.length) : mine
  const base: Drill = {
    side,
    lineIds: sorted.map((line) => line.id),
    at: 0,
    ply: 0,
    fen: sorted[0].startFen,
    asked: 0,
    right: 0,
    offBook: 0,
    illegal: 0,
    revealed: 0,
    done: false,
    history: []
  }
  const ready = advance(base, lines)
  // Every line could consist only of the other side's moves; then there is nothing to drill, and the answer is that
  // rather than a drill that is finished before it starts.
  return ready.done ? null : ready
}

export interface DrillAnswer {
  drill: Drill
  grade: RecallGrade
  /** The move this line plays here, which is what the drill is following. */
  expected: string | null
  /** True when the drill moved on. It only moves on when you played this line's own move. */
  advanced: boolean
  /** Said when your answer was one of yours but belongs to a different line. */
  note?: string
}

/**
 * Answering the position in front of you.
 *
 * It moves on only when you play *this line's* move. A move that is in your repertoire but belongs to another line
 * is still yours -- it is graded as right -- but the drill cannot follow it without losing the line it was walking,
 * so it says which line that move belongs to and stays put.
 */
export function drillAnswer(drill: Drill, lines: RepertoireLine[], played: string, evidence?: MoveEvidence): DrillAnswer {
  if (drill.done) {
    return { drill, grade: { verdict: 'not-in-book', message: 'This drill has finished.', expected: [] }, expected: null, advanced: false }
  }
  const line = lineOf(lines, drill.lineIds[drill.at])
  const book = buildBook(lines, drill.side)
  const grade = gradeRecall(book, drill.fen, played, evidence)
  const expectedMove = line?.moves[drill.ply]?.san ?? null
  const counted: Drill = {
    ...drill,
    asked: drill.asked + 1,
    right: drill.right + (grade.verdict === 'right' ? 1 : 0),
    offBook: drill.offBook + (grade.verdict === 'off-book' ? 1 : 0),
    illegal: drill.illegal + (grade.verdict === 'illegal' ? 1 : 0),
    last: grade,
    ...(expectedMove && grade.played
      ? { history: [...drill.history, { lineId: line?.id ?? '', san: grade.played.san, expected: expectedMove, outcome: grade.verdict }] }
      : {})
  }
  const followsThisLine = grade.verdict === 'right' && grade.played?.san === expectedMove
  if (!followsThisLine) {
    const note = grade.verdict === 'right' && expectedMove
      ? `That move is in your repertoire, but this drill is following "${line?.name ?? 'this line'}", which plays ${expectedMove} here.`
      : undefined
    return { drill: counted, grade, expected: expectedMove, advanced: false, ...(note ? { note } : {}) }
  }
  const moved = advance({ ...counted, ply: counted.ply + 1 }, lines)
  return { drill: moved, grade, expected: expectedMove, advanced: true }
}

/** Giving up on a position: the answer is shown, it counts as one you did not have, and the drill moves on. */
export function drillReveal(drill: Drill, lines: RepertoireLine[]): { drill: Drill; answer: string | null } {
  if (drill.done) return { drill, answer: null }
  const line = lineOf(lines, drill.lineIds[drill.at])
  const answer = line?.moves[drill.ply]?.san ?? null
  if (!answer) return { drill, answer: null }
  const counted: Drill = {
    ...drill,
    asked: drill.asked + 1,
    revealed: drill.revealed + 1,
    history: [...drill.history, { lineId: line?.id ?? '', san: null, expected: answer, outcome: 'revealed' }],
    last: {
      verdict: 'not-in-book',
      message: `You asked to be shown: your line plays ${answer} here. Nothing was graded.`,
      expected: []
    }
  }
  return { drill: advance({ ...counted, ply: counted.ply + 1 }, lines), answer }
}

/** Skipping the rest of a line. */
export function drillSkipLine(drill: Drill, lines: RepertoireLine[]): Drill {
  if (drill.done) return drill
  const line = lineOf(lines, drill.lineIds[drill.at])
  return advance({ ...drill, ply: line ? line.moves.length : 0 }, lines)
}

// ---- files, through pgn.ts

export const REPERTOIRE_EVENT = 'Orbis repertoire'
export const SIDE_TAG = 'OrbisRepertoireSide'
export const NAME_TAG = 'OrbisLineName'
export const REPERTOIRE_TAG = 'repertoire'

export const sideTag = (side: Side): string => `repertoire:${side === 'w' ? 'white' : 'black'}`

const metaFor = (line: RepertoireLine): GameMeta => ({
  event: REPERTOIRE_EVENT,
  white: {},
  black: {},
  result: '*',
  ...(line.eco ? { eco: line.eco } : {}),
  ...(line.opening ? { opening: line.opening } : {}),
  extra: {
    [SIDE_TAG]: line.side === 'w' ? 'white' : 'black',
    [NAME_TAG]: line.name,
    ...(line.note ? { OrbisLineNote: line.note } : {})
  }
})

/**
 * Writing a repertoire out as a file, through the PGN writer everything else uses.
 *
 * The side and the line's name go in tags of their own because PGN has no field for either, and inventing player
 * names to carry them ("White: me") would be writing down something that is not true. A repertoire line has no
 * players, no date and no result, and the file says so.
 */
export function linesToPgn(lines: RepertoireLine[]): string {
  return lines.map((line) => writePgn({ meta: metaFor(line), startFen: line.startFen, moves: line.moves })).join('\n')
}

export interface LineImport {
  lines: RepertoireLine[]
  /** Games in the file that could not be played, with the reason the reader gave. */
  failed: { index: number; reason: string }[]
  /** Lines whose colour the file did not say, and which were therefore not brought in. */
  needSide: { index: number; name: string }[]
  /** Lines whose colour came from what you chose rather than from the file. */
  assumed: string[]
  warnings: string[]
}

const sideFromTag = (value: string | undefined): Side | null => {
  const text = (value ?? '').trim().toLowerCase()
  if (text === 'white' || text === 'w') return 'w'
  if (text === 'black' || text === 'b') return 'b'
  return null
}

/**
 * Reading a repertoire back in.
 *
 * A file written by Orbis says which colour each line is for. A file from anywhere else does not, and that is not
 * something to guess: those lines are listed as needing a colour rather than filed under one. If you tell it which
 * colour you are reading, they are taken at your word and the answer says which ones that applied to.
 */
export function linesFromPgn(text: string, o: { now: number; makeId: (index: number) => string; side?: Side }): LineImport {
  const read = readPgn(text)
  const out: LineImport = { lines: [], failed: [], needSide: [], assumed: [], warnings: read.warnings.map((w) => w.message) }
  for (const game of read.games) {
    if (!game.ok) {
      out.failed.push({ index: game.index, reason: game.reason ?? 'This game could not be read.' })
      continue
    }
    const tagged = sideFromTag(game.meta.extra?.[SIDE_TAG])
    const side = tagged ?? o.side ?? null
    const name = game.meta.extra?.[NAME_TAG]?.trim() || game.meta.opening?.trim() || game.meta.event?.trim() || `Line ${game.index + 1}`
    if (!side) {
      out.needSide.push({ index: game.index, name })
      continue
    }
    const made = makeLine({
      id: o.makeId(game.index),
      side,
      name,
      moves: game.moves.map((m) => m.san),
      startFen: game.startFen,
      ...(game.meta.extra?.OrbisLineNote ? { note: game.meta.extra.OrbisLineNote } : {}),
      now: o.now
    })
    if (!made.ok) {
      out.failed.push({ index: game.index, reason: made.reason })
      continue
    }
    out.lines.push(made.line)
    if (!tagged) out.assumed.push(made.line.id)
    for (const warning of game.warnings) out.warnings.push(`Line ${game.index + 1}: ${warning.message}`)
  }
  return out
}

// ---- the shape the window stores a line in

export interface StoredLinePayload {
  source: { kind: 'study' }
  startFen: string
  meta: GameMeta
  tags: string[]
}

/**
 * A repertoire line as the games store holds it.
 *
 * It is a game with `source.kind: 'study'` and two tags, so it cannot be mistaken for a game that was played. The
 * name and the colour live in extra tags, which the store keeps and the PGN writer gives back, so a line that is
 * exported and brought in again is the same line.
 */
export function lineToStored(line: RepertoireLine): StoredLinePayload {
  return {
    source: { kind: 'study' },
    startFen: line.startFen,
    meta: metaFor(line),
    tags: [REPERTOIRE_TAG, sideTag(line.side)]
  }
}

/** Reading one back. Null when the game is not a repertoire line, so nothing else in the library is mistaken for one. */
export function lineFromStored(game: StoredGame): RepertoireLine | null {
  const tags = game.tags ?? []
  if (!tags.includes(REPERTOIRE_TAG)) return null
  const side = sideFromTag(game.meta.extra?.[SIDE_TAG]) ?? (tags.includes(sideTag('b')) ? 'b' : tags.includes(sideTag('w')) ? 'w' : null)
  if (!side) return null
  const name = game.meta.extra?.[NAME_TAG]?.trim() || game.meta.opening?.trim() || 'Untitled line'
  const named = game.moves.length ? recordFor(game.moves[game.moves.length - 1].fen) : null
  return {
    id: game.id,
    side,
    name,
    startFen: game.startFen,
    moves: game.moves,
    ...(game.meta.extra?.OrbisLineNote ? { note: game.meta.extra.OrbisLineNote } : {}),
    ...(named ? { eco: named.eco, opening: named.name } : game.meta.eco ? { eco: game.meta.eco } : {}),
    createdAt: game.createdAt,
    updatedAt: game.updatedAt
  }
}
