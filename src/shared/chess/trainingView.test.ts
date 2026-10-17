import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addAttempt, appendMove, attemptId, blindLevel, BLIND_LEVELS, blindPositions, buildRound, calculationReport,
  canPlayFrom, candidateMoves, draftFen, draftFromText, dropLast, emptyStore, EXHAUSTIVE_ROOT_IDS, groupCandidates,
  gymExercise, gymPool, GYM_CATALOGUE, hintWorth, ladder, lineRows, lineText, markMoves, markRound, markTrack,
  newDraft, playable, promptWhileHidden, readTraining, reconstructionFaults, reviewCandidates, safeWhileHidden,
  sayPosition, solutionLines, standingOf, submitLine, summarise, TRAINING_VERSION, trackQuestions, viewRules,
  appendSolverMove, gymView, nextFen, shownLine, writeLine, writeTraining,
  type BlindMode, type GymContext, type GymMode, type Phase, type TrainingAttempt
} from './trainingView.ts'
import { forcedMateTree, verifyExercise, type Exercise } from './exercise.ts'
import { applyMove, boardSquares, destinationsFrom, legalMoves, outcome, START_FEN } from './rules.ts'
import { enterLine } from './calculation.ts'
import { trackPieces, trackingAgrees, pieceFrom, scoreRecall } from './blindfold.ts'

/**
 * What this file is for.
 *
 * Three things could be wrong here in a way nobody would notice on screen, and each has its own section below.
 *
 *   1. **A stored solution that is not the real one.** Every mate tree in `GYM_CATALOGUE` is searched again, from
 *      the position, with the same exhaustive search that produced it. If a tree were edited, shortened, or pasted
 *      against the wrong position, the exercise would still look perfectly normal and would mark a correct line
 *      wrong. So the file is compared with the rules on every test run, and that includes checking that no shorter
 *      mate exists -- a "mate in two" that is a mate in one is a wrong exercise that nothing else would catch.
 *   2. **A board that is hidden and still readable.** The leak tests walk every level, every phase and both modes
 *      and look at everything the view rules hand back for a square name, a piece name, a FEN or notation. That is
 *      the whole blindfold feature: if the position is reachable, there is nothing left to train.
 *   3. **A store that writes its defaults over somebody's history.** Reading is tested against every kind of
 *      rubbish, and the two cases that must leave the saved text alone -- it is not JSON, and it came from a newer
 *      Orbis -- are tested for the flag that stops the screen writing.
 */

const SQUARE = /\b[a-h][1-8]\b/
const NOTATION = /\b[KQRBN]?[a-h]?x?[a-h][1-8]\b|\bO-O(-O)?\b/
const PIECE_WORDS = /\b(pawn|knight|bishop|rook|queen|king)s?\b/i
const FENISH = /[1-8]\/[1-8rnbqkpRNBQKP]|\b[rnbqkpRNBQKP]{3,}\b/

// ---------------------------------------------------------------- the catalogue is what it says it is

test('every catalogue position can be played from', () => {
  for (const entry of GYM_CATALOGUE) {
    const guard = canPlayFrom(entry.fen)
    assert.equal(guard.ok, true, `${entry.id}: ${guard.says ?? ''}`)
    assert.equal(boardSquares(entry.fen).length, entry.pieces, `${entry.id} says ${entry.pieces} pieces`)
  }
})

test('every catalogue id is unique', () => {
  const ids = GYM_CATALOGUE.map((one) => one.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every stored mate tree is what an exhaustive search produces now', () => {
  for (const entry of GYM_CATALOGUE) {
    const found = forcedMateTree(entry.fen, entry.mateIn, 600_000)
    assert.equal(found.exceeded, false, `${entry.id}: the search ran out of budget`)
    assert.notEqual(found.solution, null, `${entry.id}: no forced mate in ${entry.mateIn}`)
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(entry.lines)),
      JSON.parse(JSON.stringify(found.solution?.lines ?? [])),
      `${entry.id}: the stored tree is not the one the search finds`
    )
  }
})

test('no catalogue position has a shorter mate than it claims', () => {
  for (const entry of GYM_CATALOGUE) {
    for (let shorter = 1; shorter < entry.mateIn; shorter += 1) {
      const found = forcedMateTree(entry.fen, shorter, 400_000)
      assert.equal(found.solution, null, `${entry.id} claims mate in ${entry.mateIn} and there is one in ${shorter}`)
    }
  }
})

test('every catalogue position has exactly one key move, so its hints are facts', () => {
  for (const entry of GYM_CATALOGUE) {
    assert.equal(entry.lines.length, 1, `${entry.id} has ${entry.lines.length} first moves`)
  }
})

test('every catalogue exercise comes out verified, against every defence', () => {
  for (const entry of GYM_CATALOGUE) {
    const built = gymExercise(entry)
    assert.equal(built.ok, true, `${entry.id}: ${built.problems.join(' / ')}`)
    assert.equal(built.exercise.verification.status, 'verified')
    assert.equal(built.exercise.verification.coverage, 'complete')
    assert.equal(built.exercise.movesToMate, entry.mateIn)
    assert.equal(built.exercise.sideToMove, 'w')
  }
})

test('every way of giving mate at the end of a line is accepted', () => {
  /*
   * The search keeps one answer per defence, which would mark a different mate wrong. The exercise builder adds
   * every mating move beside it. Both directions are checked here: nothing accepted is anything but a mate, and no
   * mate is missing from what is accepted.
   */
  for (const entry of GYM_CATALOGUE) {
    const { exercise } = gymExercise(entry)
    const walk = (nodes: readonly { move: string; children?: readonly unknown[] }[], fen: string, depth: number): void => {
      const mates = legalMoves(fen).filter((move) => move.checkmate).map((move) => move.uci).sort()
      const terminal = nodes.filter((node) => (node.children ?? []).length === 0)
      if (depth % 2 === 0 && terminal.length > 0) {
        const accepted = terminal.map((node) => applyMove(fen, node.move)?.uci ?? '').sort()
        assert.deepEqual(accepted, mates, `${entry.id}: the finishes accepted are not the mates there are`)
      }
      for (const node of nodes) {
        const made = applyMove(fen, node.move)
        assert.notEqual(made, null, `${entry.id}: ${node.move} cannot be played`)
        const kids = (node.children ?? []) as readonly { move: string; children?: readonly unknown[] }[]
        if (kids.length === 0) {
          assert.equal(made?.checkmate, true, `${entry.id}: ${made?.san} ends a line without mate`)
          continue
        }
        walk(kids, made?.after ?? '', depth + 1)
      }
    }
    walk(exercise.solution.lines, entry.fen, 0)
  }
})

test('a different mate at the end of the line is a solve, not a divergence', () => {
  // The case that made the expansion necessary: 1.Kb6 Kb8 2.d8=Q# where the search answered 2.d8=R#.
  const entry = GYM_CATALOGUE.find((one) => one.id === 'gym-pawn-promote')
  assert.notEqual(entry, undefined)
  const exercise = gymFor('gym-pawn-promote')
  const queen = submitLine(exercise, draftFromText(exercise.startFen, 'Kb6 Kb8 d8=Q'), 'both-sides')
  assert.equal(queen.comparison.verdict, 'solves')
  const rook = submitLine(exercise, draftFromText(exercise.startFen, 'Kb6 Kb8 d8=R'), 'both-sides')
  assert.equal(rook.comparison.verdict, 'solves')
})

test('the hints run in order and only the last one shows the move', () => {
  for (const entry of GYM_CATALOGUE) {
    const { exercise } = gymExercise(entry)
    assert.equal(exercise.hints.length, 4, entry.id)
    assert.deepEqual(exercise.hints.map((one) => one.level), [1, 2, 3, 4])
    assert.deepEqual(exercise.hints.map((one) => one.shows), ['theme', 'piece', 'square', 'move'])
    // The last hint is the move, written for this position.
    const key = applyMove(entry.fen, entry.lines[0].move)
    assert.equal(exercise.hints[3].text, key?.san)
  }
})

test('the first hint says truly whether the key move is a check, a capture or quiet', () => {
  for (const entry of GYM_CATALOGUE) {
    const { exercise } = gymExercise(entry)
    const key = applyMove(entry.fen, entry.lines[0].move)
    assert.notEqual(key, null)
    const says = exercise.hints[0].text
    if (key?.check) assert.match(says, /is a check/)
    else if (key?.captured) assert.match(says, /takes something/)
    else assert.match(says, /neither a check nor a capture/)
  }
})

test('the pool is every exercise that passed its check, and says what was refused', () => {
  const pool = gymPool()
  assert.ok(pool.exercises.length >= GYM_CATALOGUE.length, 'the catalogue should all be in the pool')
  for (const exercise of pool.exercises) {
    assert.equal(exercise.verification.status, 'verified', exercise.id)
  }
  // Nothing may appear twice: the screen keys on the id.
  const ids = pool.exercises.map((one) => one.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const refusal of pool.refused) assert.ok(refusal.says.length > 0)
})

test('the pool only offers lines worth calculating', () => {
  for (const exercise of gymPool().exercises) {
    const multiPly = exercise.objective !== 'mate-in-n' || (exercise.movesToMate ?? 0) >= 2
    assert.equal(multiPly, true, `${exercise.id} is a one-move exercise`)
  }
})

// ---------------------------------------------------------------- the position guard

test('a position where the other side is in check is refused, not crashed on', () => {
  /*
   * The case this guard exists for. King and two same-coloured bishops against a bare king: `outcome` answers
   * "insufficient material" before it answers "in check", `playablePosition` reads that and lets the position
   * through, and the move generator then offers the capture of the black king -- which throws.
   */
  const fen = '8/4K3/8/1B6/8/3k3B/8/8 w - - 0 1'
  const guard = canPlayFrom(fen)
  assert.equal(guard.ok, false)
  assert.match(guard.says ?? '', /cannot be reached in a game/)
  // And the things built on it refuse rather than throw.
  assert.deepEqual(candidateMoves(fen), [])
  const draft = newDraft(fen)
  const tried = appendMove(draft, 'Bxd3')
  assert.equal(tried.added, false)
})

test('a finished position is refused with the reason', () => {
  const mate = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'
  assert.equal(canPlayFrom(mate).ok, true)
  const after = applyMove(mate, 'Ra8')
  assert.notEqual(after, null)
  const guard = canPlayFrom(after?.after ?? '')
  assert.equal(guard.ok, false)
  assert.match(guard.says ?? '', /finished|no moves/)
})

test('a broken position is refused with the part that is wrong', () => {
  const guard = canPlayFrom('not a position')
  assert.equal(guard.ok, false)
  assert.ok((guard.says ?? '').length > 0)
})

// ---------------------------------------------------------------- candidate moves

test('candidates are grouped checks, captures, then everything else', () => {
  const fen = GYM_CATALOGUE[0].fen
  const groups = groupCandidates(fen)
  const order = groups.map((one) => one.forcing)
  assert.deepEqual(order, [...order].sort((a, b) => ['check', 'capture', 'quiet'].indexOf(a) - ['check', 'capture', 'quiet'].indexOf(b)))
  const flat = candidateMoves(fen)
  assert.equal(flat.length, legalMoves(fen).length, 'every legal move is a candidate')
  for (const one of flat) assert.notEqual(applyMove(fen, one.uci), null)
})

test('a candidate list never marks a mate', () => {
  /*
   * A position with a mate in one. Standard notation writes it "Ra8#", and a list of candidates with a hash in it
   * has given the answer away. The mark is written as a check instead, which is true -- a mate is a check -- and
   * tells nobody which one it is.
   */
  const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'
  const mate = legalMoves(fen).find((move) => move.checkmate)
  assert.notEqual(mate, undefined, 'the test position should hold a mate in one')
  const candidates = candidateMoves(fen)
  for (const one of candidates) {
    assert.ok(!one.shown.includes('#'), `${one.shown} marks the mate`)
    assert.ok(!JSON.stringify(one).includes('"checkmate"'))
  }
  const theMate = candidates.find((one) => one.uci === mate?.uci)
  assert.equal(theMate?.shown, `${(mate?.san ?? '').replace('#', '')}+`)
  assert.equal(theMate?.forcing, 'check')
})

test('what a candidate was worth is said no more strongly than it can be', () => {
  const pool = gymPool()
  const mine = pool.exercises.find((one) => EXHAUSTIVE_ROOT_IDS.includes(one.id))
  assert.notEqual(mine, undefined)
  const key = mine ? applyMove(mine.startFen, mine.solution.lines[0].move) : null
  const other = mine ? legalMoves(mine.startFen).find((move) => move.uci !== key?.uci) : null
  const verdicts = reviewCandidates(mine as Exercise, [key?.uci ?? '', other?.uci ?? ''])
  assert.equal(verdicts[0].standing, 'an-answer')
  assert.equal(verdicts[1].standing, 'refuted')
  assert.match(verdicts[1].says, /search over every move/)

  // An Academy task's answers were written down by a person, so a move that is not there is not refuted.
  const authored = pool.exercises.find((one) => !EXHAUSTIVE_ROOT_IDS.includes(one.id))
  if (authored) {
    const notRecorded = legalMoves(authored.startFen)
      .find((move) => !authored.solution.lines.some((line) => applyMove(authored.startFen, line.move)?.uci === move.uci))
    if (notRecorded) {
      const verdict = reviewCandidates(authored, [notRecorded.uci])
      assert.equal(verdict[0].standing, 'not-recorded')
      assert.match(verdict[0].says, /was not checked/)
    }
  }
})

// ---------------------------------------------------------------- entering a line

test('each move is read against the position the line has reached', () => {
  let draft = newDraft(START_FEN)
  const first = appendMove(draft, 'e4')
  assert.equal(first.added, true)
  draft = first.draft
  assert.equal(draftFen(draft).split(' ')[1], 'b', 'it is Black to move after one move')

  // The same text again is now a different question, and the answer is a chess fault, not a notation one.
  const again = appendMove(draft, 'e4')
  assert.equal(again.added, false)
  assert.equal(again.read.ok, false)
  if (!again.read.ok) assert.equal(again.read.fault, 'chess')
  assert.equal(draft.texts.length, 1, 'nothing was kept')
})

test('a notation mistake and a chess mistake never share a message', () => {
  const draft = newDraft(START_FEN)
  const unreadable = appendMove(draft, 'zz9')
  assert.equal(unreadable.read.ok, false)
  if (!unreadable.read.ok) assert.equal(unreadable.read.fault, 'notation')

  const illegal = appendMove(draft, 'e5')
  assert.equal(illegal.read.ok, false)
  if (!illegal.read.ok) assert.equal(illegal.read.fault, 'chess')
})

test('decoration is kept out of the line and reported as the way it is written', () => {
  const draft = newDraft(START_FEN)
  const added = appendMove(draft, 'Nf3!!')
  assert.equal(added.added, true)
  const walk = enterLine(START_FEN, added.draft.texts)
  assert.equal(walk.ok, true)
  assert.equal(walk.moves[0].san, 'Nf3')
})

test('the last move comes off again and the position goes back with it', () => {
  let draft = newDraft(START_FEN)
  draft = appendMove(draft, 'e4').draft
  draft = appendMove(draft, 'e5').draft
  assert.equal(draft.texts.length, 2)
  draft = dropLast(draft)
  assert.equal(draft.texts.length, 1)
  assert.equal(draftFen(draft).split(' ')[1], 'b')
})

test('a line pasted in one go is split the way people write them', () => {
  const draft = draftFromText(START_FEN, '1. e4 e5 2. Nf3 Nc6 3. Bb5')
  assert.deepEqual([...draft.texts], ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  assert.equal(enterLine(draft.startFen, draft.texts).ok, true)
})

test('the line is numbered from the position, not from one', () => {
  // Black to move at move 34.
  const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 4 34'
  const walk = enterLine(fen, ['Kf8', 'Ra8+', 'Ke7'])
  assert.equal(walk.ok, true, JSON.stringify(walk.stopped))
  const laid = lineRows(walk)
  assert.equal(laid.firstNumber, 34)
  assert.equal(laid.blackFirst, true)
  assert.equal(laid.rows[0].number, 34)
  assert.equal(laid.rows[0].white, null)
  assert.equal(laid.rows[0].black?.san, 'Kf8')
  assert.equal(laid.rows[1].number, 35)
  assert.equal(laid.rows[1].white?.san, 'Ra8+')
  assert.equal(lineText(walk), '34...Kf8 35.Ra8+ Ke7')
  assert.equal(writeLine(START_FEN, ['e4', 'e5', 'Nf3']), '1.e4 e5 2.Nf3')
})

// ---------------------------------------------------------------- submitting, and what it established

function gymFor(id: string): Exercise {
  const found = gymPool().exercises.find((one) => one.id === id)
  assert.notEqual(found, undefined, `${id} should be in the pool`)
  return found as Exercise
}

/** The first whole line of an exercise's solution, as notation. */
function answerLine(exercise: Exercise): string[] {
  const lines = solutionLines(exercise)
  assert.ok(lines.length > 0)
  return [...lines[0].san]
}

const plainContext: GymContext = { strict: true, movedOnBoard: false, hintsTaken: 0, replies: 'both-sides', candidates: [] }

test('the right line is reported as right, and says what that settles', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  const submission = submitLine(exercise, draftFromText(exercise.startFen, answerLine(exercise).join(' ')), 'both-sides')
  assert.equal(submission.comparison.verdict, 'solves')
  const report = calculationReport(exercise, submission, plainContext)
  assert.match(report.heading, /right/)
  const settled = report.established.filter((one) => one.settled === 'yes').map((one) => one.says).join(' ')
  assert.match(settled, /one of the exercise's answers/)
  assert.match(settled, /every legal defence is answered/i)
  assert.match(settled, /held in your head/)
  assert.equal(report.worth, 1)
  // And it never claims to know which move is best.
  assert.match(report.established.map((one) => one.says).join(' '), /no engine was asked/)
})

test('a line that stops early is short, not wrong', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  const whole = answerLine(exercise)
  const submission = submitLine(exercise, draftFromText(exercise.startFen, whole.slice(0, 1).join(' ')), 'both-sides')
  assert.equal(submission.comparison.verdict, 'short')
  const report = calculationReport(exercise, submission, plainContext)
  assert.match(report.heading, /as far as it goes/)
  assert.ok(report.established.some((one) => one.settled === 'unknown' && /not known/.test(one.says)))
})

test('a line that leaves the answer says where, and shows that position', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  const wrong = legalMoves(exercise.startFen).find((move) => move.uci !== exercise.solution.lines[0].move)
  assert.notEqual(wrong, undefined)
  const submission = submitLine(exercise, draftFromText(exercise.startFen, wrong?.san ?? ''), 'both-sides')
  assert.equal(submission.comparison.verdict, 'diverges')
  assert.equal(submission.comparison.divergence?.at, 0)
  const report = calculationReport(exercise, submission, plainContext)
  assert.equal(report.showPly, 0)
  assert.equal(report.showFen, exercise.startFen, 'the board goes back to where the lines parted')
})

test('a line that cannot be played is not compared at all', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  const submission = submitLine(exercise, draftFromText(exercise.startFen, 'Qz9'), 'both-sides')
  assert.equal(submission.comparison.verdict, 'unplayable')
  const report = calculationReport(exercise, submission, plainContext)
  assert.ok(report.established.some((one) => /Nothing was compared/.test(one.says)))
})

test('supplied defences, hints and a loose board each take something away, by name', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  const mine = answerLine(exercise).filter((_, at) => at % 2 === 0)
  const submission = submitLine(exercise, draftFromText(exercise.startFen, mine.join(' ')), 'from-the-exercise')
  assert.equal(submission.comparison.verdict, 'solves', 'the replies should have been filled in')
  assert.ok(submission.compared.length > mine.length)

  const report = calculationReport(exercise, submission, {
    strict: false, movedOnBoard: true, hintsTaken: 4, replies: 'from-the-exercise', candidates: []
  })
  const all = report.established.map((one) => one.says).join(' ')
  assert.match(all, /supplied the other side's moves/)
  assert.match(all, /hints were taken/)
  assert.match(all, /moved the pieces on the board first/)
  assert.equal(report.worth, 0, 'the move itself was shown, so the solve is worth nothing')
})

test('strict mode off with nothing moved is reported as unknown, not as strict', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  const submission = submitLine(exercise, draftFromText(exercise.startFen, answerLine(exercise).join(' ')), 'both-sides')
  const report = calculationReport(exercise, submission, { ...plainContext, strict: false })
  const loose = report.established.find((one) => /Strict mode was off/.test(one.says))
  assert.notEqual(loose, undefined)
  assert.equal(loose?.settled, 'unknown')
})

test('what a solve is worth after hints follows the exercise ladder', () => {
  const exercise = gymFor(GYM_CATALOGUE[0].id)
  assert.equal(hintWorth(exercise, 0), 1)
  assert.equal(hintWorth(exercise, 1), 0.85)
  assert.equal(hintWorth(exercise, 3), 0.3)
  assert.equal(hintWorth(exercise, 4), 0)
  assert.equal(hintWorth(exercise, 9), 0, 'asking for more hints than there are does not undo the last one')
})

test('every branch of the answer is written out, not just one', () => {
  const branching = GYM_CATALOGUE.find((entry) => (entry.lines[0].children ?? []).length > 1)
  assert.notEqual(branching, undefined)
  const exercise = gymFor((branching ?? GYM_CATALOGUE[0]).id)
  const lines = solutionLines(exercise)
  // One line per defence at least, and more where one defence can be answered by more than one mate.
  assert.ok(lines.length >= (branching?.lines[0].children ?? []).length, `${lines.length} lines`)
  for (const line of lines) {
    assert.equal(playable(exercise.startFen, line.san), true)
    const last = line.fens[line.fens.length - 1]
    const state = outcome(last)
    assert.equal(state.over && state.reason === 'checkmate', true, `${line.text} should end in mate`)
  }
})

// ---------------------------------------------------------------- hiding the board really hides it

const PHASES: readonly Phase[] = ['ready', 'studying', 'answering', 'done']
const MODES: readonly BlindMode[] = ['strict', 'read-out']

test('while answering, nothing hands back a board', () => {
  for (const level of BLIND_LEVELS) {
    for (const mode of MODES) {
      const rules = viewRules({ level: level.id, phase: 'answering', mode, fen: GYM_CATALOGUE[0].fen })
      assert.equal(rules.boardFen, null, `${level.id} / ${mode}`)
    }
  }
})

test('while answering in strict mode, nothing names a square, a piece or a position', () => {
  for (const level of BLIND_LEVELS) {
    const rules = viewRules({ level: level.id, phase: 'answering', mode: 'strict', fen: GYM_CATALOGUE[3].fen })
    const everything = `${rules.label} ${rules.because ?? ''} ${rules.readOut}`
    assert.equal(rules.boardFen, null, level.id)
    assert.equal(rules.readOut, '', `${level.id}: nothing is read out in strict mode`)
    assert.ok(!SQUARE.test(everything), `${level.id} names a square: ${everything}`)
    assert.ok(!NOTATION.test(everything), `${level.id} names a move: ${everything}`)
    assert.ok(!PIECE_WORDS.test(everything), `${level.id} names a piece: ${everything}`)
    assert.ok(!FENISH.test(everything), `${level.id} contains a position: ${everything}`)
    assert.equal(rules.hintsAllowed, false, `${level.id}: a hint names a square`)
  }
})

test('the position is on screen while it is being studied, and again at the end', () => {
  const fen = GYM_CATALOGUE[2].fen
  for (const level of BLIND_LEVELS) {
    assert.equal(viewRules({ level: level.id, phase: 'studying', mode: 'strict', fen }).boardFen, fen)
    assert.equal(viewRules({ level: level.id, phase: 'done', mode: 'strict', fen }).boardFen, fen)
  }
  // After a tracked line it is the position the line reached that comes back, not the one it started from.
  const done = viewRules({ level: 'track', phase: 'done', mode: 'strict', fen: START_FEN, doneFen: GYM_CATALOGUE[0].fen })
  assert.equal(done.boardFen, GYM_CATALOGUE[0].fen)
})

test('nothing is on screen before a round starts', () => {
  for (const level of BLIND_LEVELS) {
    for (const mode of MODES) {
      const rules = viewRules({ level: level.id, phase: 'ready', mode, fen: GYM_CATALOGUE[0].fen })
      assert.equal(rules.boardFen, null)
      assert.equal(rules.readOut, '')
    }
  }
})

test('the read-out mode gives the position in words and is not scored', () => {
  const fen = GYM_CATALOGUE[0].fen
  const rules = viewRules({ level: 'locate', phase: 'answering', mode: 'read-out', fen })
  assert.equal(rules.boardFen, null, 'read-out is not a visible board either')
  assert.equal(rules.scored, false)
  assert.match(rules.readOut, SQUARE)
  assert.match(rules.because ?? '', /not scored as blindfold work/)
  // Every piece on the board is in the words, and nothing else is.
  for (const piece of boardSquares(fen)) assert.ok(rules.readOut.includes(piece.square), `${piece.square} is missing`)
})

test('strict mode is scored and read-out mode is not, in every phase', () => {
  for (const phase of PHASES) {
    assert.equal(viewRules({ level: 'solve', phase, mode: 'strict', fen: START_FEN }).scored, true)
    assert.equal(viewRules({ level: 'solve', phase, mode: 'read-out', fen: START_FEN }).scored, false)
  }
})

test('a prompt that names a square is not shown while the board is hidden', () => {
  assert.equal(safeWhileHidden('Mate in two.'), true)
  assert.equal(safeWhileHidden('The knight on c3 is pinned.'), false)
  assert.equal(safeWhileHidden('Play Nf3 and see.'), false)
  assert.equal(safeWhileHidden('White can castle: O-O.'), false)
  for (const exercise of gymPool().exercises) {
    const prompt = promptWhileHidden(exercise)
    assert.equal(safeWhileHidden(prompt), true, `${exercise.id}: ${prompt}`)
    assert.ok(prompt.trim().length > 0)
  }
})

test('the position in words holds every piece and whose move it is', () => {
  const said = sayPosition(GYM_CATALOGUE[0].fen)
  assert.match(said, /White:/)
  assert.match(said, /Black:/)
  assert.match(said, /to move/)
  assert.equal(sayPosition('nonsense'), 'There is no position here.')
})

// ---------------------------------------------------------------- the blindfold rounds

test('every level builds a round from a seed, and the same seed gives the same round', () => {
  for (const level of BLIND_LEVELS) {
    for (const seed of [1, 2, 7, 31, 404]) {
      const round = buildRound(level.id, { seed, questions: 5 })
      assert.notEqual(round, null, `${level.id} seed ${seed}`)
      const again = buildRound(level.id, { seed, questions: 5 })
      assert.deepEqual(JSON.parse(JSON.stringify(round)), JSON.parse(JSON.stringify(again)), `${level.id} seed ${seed} is not reproducible`)
    }
  }
})

test('a locate round asks only questions that have an answer in the position', () => {
  const round = buildRound('locate', { seed: 5, questions: 6 })
  assert.equal(round?.kind, 'locate')
  if (round?.kind !== 'locate') return
  assert.ok(round.questions.length > 0)
  for (const question of round.questions) {
    assert.equal(question.fen, round.fen)
    assert.ok(question.ask.length > 0)
    assert.notEqual(question.answer, undefined)
  }
  const ids = round.questions.map((one) => one.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a moves-from round asks about a real piece and the squares are the rules\' own', () => {
  for (const seed of [1, 3, 9, 44]) {
    const round = buildRound('moves-from', { seed })
    assert.equal(round?.kind, 'moves-from')
    if (round?.kind !== 'moves-from') continue
    const piece = boardSquares(round.fen).find((one) => one.square === round.from)
    assert.notEqual(piece, undefined, 'the square it asks about should hold a piece')
    assert.equal(piece?.type, round.piece)
    assert.equal(piece?.color, round.side)
    assert.notEqual(piece?.type, 'k', 'the king is not worth asking about')
    const real = [...new Set(destinationsFrom(round.fen, round.from).map((move) => move.to))].sort()
    assert.deepEqual([...round.squares], real)
    assert.ok(round.squares.length >= 2)
  }
})

test('naming the squares is marked on both halves separately', () => {
  const round = buildRound('moves-from', { seed: 3 })
  assert.equal(round?.kind, 'moves-from')
  if (round?.kind !== 'moves-from') return
  const all = [...round.squares]
  assert.equal(markMoves(round, all.join(' ')).right, true)
  assert.equal(markMoves(round, all.join(', ').toUpperCase()).right, true, 'case and commas do not matter')

  const missed = markMoves(round, all.slice(1).join(' '))
  assert.equal(missed.right, false)
  assert.deepEqual([...missed.missing], [all[0]].sort())
  assert.deepEqual([...missed.extra], [])

  const invented = markMoves(round, [...all, 'a1', 'h8'].join(' '))
  assert.equal(invented.right, false)
  assert.ok(invented.extra.length >= 1)
  assert.deepEqual([...invented.missing], [])

  assert.equal(markMoves(round, '').right, false)
})

test('a track round is a line the rules can play, and the tracker agrees with them', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 11]) {
    const round = buildRound('track', { seed, questions: 4 })
    assert.equal(round?.kind, 'track')
    if (round?.kind !== 'track') continue
    assert.equal(round.tracking.ok, true)
    assert.equal(trackingAgrees(round.tracking), true, round.id)
    const replay = enterLine(round.startFen, round.san)
    assert.equal(replay.ok, true)
    assert.equal(replay.fens[replay.fens.length - 1], round.finalFen)
    assert.ok(round.questions.length > 0)
    for (const question of round.questions) {
      if (question.square === null) continue
      assert.ok(boardSquares(round.finalFen).some((one) => one.square === question.square), `${question.ask}: ${question.square}`)
    }
  }
})

test('a pawn taken en passant is gone, and the tracker says where from', () => {
  // 1.e4 d5 2.e5 f5 3.exf6 -- the pawn that goes is the one on f5, not the one on the landing square.
  const tracking = trackPieces(START_FEN, ['e4', 'd5', 'e5', 'f5', 'exf6'])
  assert.equal(tracking.ok, true)
  assert.equal(trackingAgrees(tracking), true)
  const taken = pieceFrom(tracking, 'f7')
  assert.equal(taken?.square, null, 'the pawn that started on f7 has been taken')
  const questions = trackQuestions(tracking, 1, 20)
  const about = questions.find((one) => one.ask.includes('started on f7'))
  assert.notEqual(about, undefined)
  assert.equal(about?.square, null)
  assert.equal(markTrack(about as never, 'taken').right, true)
  assert.equal(markTrack(about as never, 'f6').right, false)
  assert.equal(markTrack(about as never, '').right, false)
})

test('the rook that castled is followed to the square it really went to', () => {
  const tracking = trackPieces(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
  const rook = pieceFrom(tracking, 'h1')
  assert.equal(rook?.square, 'f1')
  const questions = trackQuestions(tracking, 2, 30)
  const about = questions.find((one) => one.ask.includes('started on h1'))
  assert.notEqual(about, undefined)
  assert.equal(about?.square, 'f1')
  assert.equal(markTrack(about as never, 'f1').right, true)
  assert.equal(markTrack(about as never, 'F1 I think').right, true)
  assert.equal(markTrack(about as never, 'h1').right, false)
  assert.match(markTrack(about as never, 'h1').says, /f1/)
})

test('a promoted pawn is still the piece that started on its square', () => {
  const tracking = trackPieces(START_FEN, ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nf6', 'cxb7', 'Bg4', 'bxa8=Q'])
  assert.equal(tracking.ok, true)
  const promoted = pieceFrom(tracking, 'e2')
  assert.equal(promoted?.square, 'a8')
  assert.equal(promoted?.type, 'q')
  assert.equal(promoted?.startedAs, 'p')
  const questions = trackQuestions(tracking, 3, 40)
  const about = questions.find((one) => one.ask.includes('started on e2'))
  assert.notEqual(about, undefined)
  assert.match(about?.because ?? '', /same piece/)
})

test('a reconstruct round offers a position small enough to hold', () => {
  const round = buildRound('reconstruct', { seed: 8 })
  assert.equal(round?.kind, 'reconstruct')
  if (round?.kind !== 'reconstruct') return
  assert.equal(round.pieces, boardSquares(round.fen).length)
  assert.ok(round.pieces <= 10, 'a first reconstruction of a full middlegame is not practice, it is a wall')
})

test('a solve round is a verified exercise with a prompt that gives nothing away', () => {
  for (const seed of [1, 4, 12]) {
    const round = buildRound('solve', { seed })
    assert.equal(round?.kind, 'solve')
    if (round?.kind !== 'solve') continue
    assert.equal(round.exercise.verification.status, 'verified')
    assert.equal(safeWhileHidden(round.prompt), true, round.prompt)
    assert.equal(round.fen, round.exercise.startFen)
  }
})

// ---------------------------------------------------------------- marking a round

test('a locate round passes only when every answer is right', () => {
  const round = buildRound('locate', { seed: 5, questions: 4 })
  assert.equal(round?.kind, 'locate')
  if (round?.kind !== 'locate') return
  const right: Record<string, string> = {}
  for (const question of round.questions) {
    const answer = question.answer
    right[question.id] = answer.kind === 'piece'
      ? answer.piece === null ? 'empty' : `${answer.side === 'w' ? 'white' : 'black'} ${{ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[answer.piece]}`
      : answer.kind === 'colour' ? answer.colour
        : answer.kind === 'count' ? String(answer.value)
          : answer.kind === 'side' ? (answer.side === 'w' ? 'white' : 'black')
            : answer.squares.join(' ')
  }
  const all = markRound(round, { answers: right })
  assert.equal(all.passed, true, JSON.stringify(all.questions.filter((one) => !one.right)))
  assert.equal(all.right, all.outOf)
  assert.equal(all.rule, blindLevel('locate').passes)

  const broken = { ...right, [round.questions[0].id]: 'nonsense' }
  const some = markRound(round, { answers: broken })
  assert.equal(some.passed, false)
  assert.equal(some.right, some.outOf - 1)
  // The answer comes back whether or not they got it, so the feedback can show it.
  assert.ok(some.questions.every((one) => one.answer.length > 0))
})

test('an empty set of answers does not pass', () => {
  const round = buildRound('locate', { seed: 2, questions: 3 })
  assert.equal(round?.kind, 'locate')
  if (round?.kind !== 'locate') return
  assert.equal(markRound(round, { answers: {} }).passed, false)
  assert.equal(markRound(round, {}).passed, false)
})

test('a reconstruction passes only when the whole board is right, and says where it went wrong', () => {
  const round = buildRound('reconstruct', { seed: 8 })
  assert.equal(round?.kind, 'reconstruct')
  if (round?.kind !== 'reconstruct') return
  const real = boardSquares(round.fen).map((one) => ({ square: one.square, side: one.color, type: one.type }))
  const exact = markRound(round, { placements: real })
  assert.equal(exact.passed, true)
  assert.equal(exact.recall?.exact, true)
  assert.equal(reconstructionFaults(exact.recall as never).length, 0)

  const missing = markRound(round, { placements: real.slice(1) })
  assert.equal(missing.passed, false)
  assert.equal(missing.recall?.missed, 1)
  const faults = reconstructionFaults(missing.recall as never)
  assert.equal(faults.length, 1)
  assert.equal(faults[0].square, real[0].square)
  assert.match(faults[0].says, /did not mention it/)

  const invented = markRound(round, { placements: [...real, { square: 'd4', side: 'w', type: 'q' }] })
  if (!real.some((one) => one.square === 'd4')) {
    assert.equal(invented.passed, false)
    assert.equal(invented.recall?.invented, 1)
    assert.match(reconstructionFaults(invented.recall as never)[0].says, /empty/)
  }

  // The rule the number came from always comes with it.
  assert.match(exact.recall?.rule ?? '', /pieces, kept between 0 and 1/)
})

test('a solve round is marked by the line, with the first divergence kept', () => {
  const round = buildRound('solve', { seed: 4 })
  assert.equal(round?.kind, 'solve')
  if (round?.kind !== 'solve') return
  const answer = answerLine(round.exercise)
  const solved = markRound(round, { line: answer })
  assert.equal(solved.passed, true)
  const wrong = markRound(round, { line: [legalMoves(round.fen).find((move) => move.uci !== round.exercise.solution.lines[0].move)?.san ?? ''] })
  assert.equal(wrong.passed, false)
  assert.equal(wrong.comparison?.verdict, 'diverges')
  assert.equal(wrong.comparison?.divergence?.at, 0)
})

// ---------------------------------------------------------------- what is kept

test('an empty store reads as empty and is safe to write', () => {
  for (const raw of [null, undefined, '', '   ']) {
    const read = readTraining(raw)
    assert.equal(read.store.attempts.length, 0)
    assert.equal(read.store.version, TRAINING_VERSION)
    assert.equal(read.note, null)
    assert.equal(read.safeToWrite, true)
  }
})

test('a store written out reads back the same', () => {
  let store = emptyStore()
  store = { ...store, settings: { ...store.settings, strict: false, mode: 'read-out', studySeconds: 45, questions: 7, replies: 'from-the-exercise' } }
  store = addAttempt(store, {
    id: 'a1', at: 1000, area: 'calculation', item: 'gym-pawn-promote', strict: true,
    verdict: 'The line is right.', passed: true, hints: 1, line: ['Kb6', 'Kb8', 'd8=Q'], ms: 42_000
  })
  const read = readTraining(writeTraining(store))
  assert.equal(read.safeToWrite, true)
  assert.deepEqual(read.store.settings, store.settings)
  assert.deepEqual(read.store.attempts, store.attempts)
})

test('text that is not JSON is left exactly where it is', () => {
  const read = readTraining('{ this is not json')
  assert.equal(read.store.attempts.length, 0)
  assert.equal(read.safeToWrite, false, 'the screen must not write over something it merely could not read')
  assert.match(read.note ?? '', /could not be read/)
})

test('a store from a newer Orbis is left alone', () => {
  const read = readTraining(JSON.stringify({ version: TRAINING_VERSION + 5, attempts: [], settings: {} }))
  assert.equal(read.safeToWrite, false)
  assert.match(read.note ?? '', /newer version/)
})

test('a store of the wrong shape is left alone', () => {
  for (const raw of ['[]', '"hello"', '42', 'null']) {
    const read = readTraining(raw)
    assert.equal(read.safeToWrite, false, raw)
  }
})

test('missing and broken fields take their defaults instead of breaking the store', () => {
  const read = readTraining(JSON.stringify({
    version: 1,
    settings: { strict: 'yes', mode: 'invented', studySeconds: -4, questions: 900, replies: 'telepathy' },
    attempts: [
      { id: 'good', at: 5, area: 'blindfold', item: 'locate', passed: true, strict: true, verdict: 'ok' },
      { id: 'no-area', at: 6, item: 'locate' },
      'not an object',
      null,
      { at: 7, area: 'blindfold', item: 'locate' }
    ]
  }))
  assert.equal(read.safeToWrite, true)
  assert.equal(read.store.settings.strict, true, 'a string is not a boolean, so the default stands')
  assert.equal(read.store.settings.mode, 'strict')
  assert.equal(read.store.settings.replies, 'both-sides')
  assert.equal(read.store.settings.studySeconds, 5)
  assert.equal(read.store.settings.questions, 12)
  assert.equal(read.store.attempts.length, 1)
  assert.equal(read.store.attempts[0].id, 'good')
  assert.match(read.note ?? '', /could not be read and/)
})

test('attempts come back in the order they happened', () => {
  const read = readTraining(JSON.stringify({
    version: 1,
    attempts: [
      { id: 'b', at: 200, area: 'calculation', item: 'x', passed: false, strict: true, verdict: '' },
      { id: 'a', at: 100, area: 'calculation', item: 'x', passed: true, strict: true, verdict: '' }
    ]
  }))
  assert.deepEqual(read.store.attempts.map((one) => one.id), ['a', 'b'])
})

test('a retry never overwrites the first attempt', () => {
  let store = emptyStore()
  for (let i = 0; i < 15; i += 1) {
    store = addAttempt(store, {
      id: `try-${i}`, at: 1000 + i, area: 'calculation', item: 'gym-pawn-promote',
      strict: true, verdict: i === 0 ? 'first go, wrong' : 'later go', passed: i > 0
    })
  }
  const mine = standingOf(store, 'calculation', 'gym-pawn-promote')
  assert.equal(mine.first?.id, 'try-0', 'the first attempt must survive every retry')
  assert.equal(mine.first?.passed, false)
  assert.equal(mine.latest?.id, 'try-14')
  assert.equal(mine.attempts, 10, 'ten are kept: the first and the last nine')
  assert.equal(store.attempts.some((one) => one.id === 'try-14'), true)
  assert.equal(store.attempts.some((one) => one.id === 'try-1'), false, 'the middle is what goes')
})

test('attempts on different items do not crowd each other out', () => {
  let store = emptyStore()
  for (let i = 0; i < 12; i += 1) {
    store = addAttempt(store, { id: `one-${i}`, at: 10 + i, area: 'calculation', item: 'first', strict: true, verdict: '', passed: true })
    store = addAttempt(store, { id: `two-${i}`, at: 100 + i, area: 'blindfold', item: 'locate', strict: true, verdict: '', passed: true })
  }
  assert.equal(standingOf(store, 'calculation', 'first').attempts, 10)
  assert.equal(standingOf(store, 'blindfold', 'locate').attempts, 10)
})

test('two attempts in the same millisecond get different ids', () => {
  const a = attemptId(1700000000000)
  const b = attemptId(1700000000000)
  assert.notEqual(a, b)
})

test('the ladder opens a level only when the one before was passed with the board away', () => {
  let store = emptyStore()
  const first = ladder(store)
  assert.equal(first[0].open, true)
  assert.equal(first[1].open, false)
  assert.match(first[1].says, /Opens when you pass/)
  assert.match(first[1].says, /still start it now/, 'nothing is locked shut')

  // Passing with the position read out does not open the next level, and says so.
  store = addAttempt(store, { id: 'r1', at: 1, area: 'blindfold', item: 'locate', strict: false, verdict: '', passed: true })
  const after = ladder(store)
  assert.equal(after[1].open, false)
  assert.match(after[1].says, /has not been passed with the board away/)

  store = addAttempt(store, { id: 'r2', at: 2, area: 'blindfold', item: 'locate', strict: true, verdict: '', passed: true })
  const opened = ladder(store)
  assert.equal(opened[1].open, true)
  assert.match(opened[1].says, /with the board away/)
  assert.equal(opened[2].open, false)
})

test('the summary counts what happened and nothing else', () => {
  let store = emptyStore()
  assert.match(summarise(store).says, /Nothing has been recorded/)
  const attempts: TrainingAttempt[] = [
    { id: 'c1', at: 1, area: 'calculation', item: 'gym-pawn-promote', strict: true, verdict: '', passed: true },
    { id: 'c2', at: 2, area: 'calculation', item: 'gym-queen-and-rook', strict: false, verdict: '', passed: false },
    { id: 'b1', at: 3, area: 'blindfold', item: 'locate', strict: true, verdict: '', passed: true }
  ]
  for (const one of attempts) store = addAttempt(store, one)
  const summary = summarise(store)
  assert.equal(summary.attempts, 3)
  assert.equal(summary.strictAttempts, 2)
  assert.equal(summary.calculation.attempts, 2)
  assert.equal(summary.calculation.solved, 1)
  assert.equal(summary.calculation.items, 2)
  assert.equal(summary.blindfold.passed, 1)
  assert.equal(summary.reached?.id, 'locate')
})

// ---------------------------------------------------------------- the positions the blindfold draws from

test('every blindfold position is a position the rules will play from', () => {
  const positions = blindPositions()
  assert.ok(positions.length >= GYM_CATALOGUE.length)
  for (const one of positions) {
    assert.equal(canPlayFrom(one.fen).ok, true, one.id)
    assert.equal(boardSquares(one.fen).length, one.pieces)
    assert.ok(one.says.length > 0)
  }
  // Sparse first, so the first thing somebody is asked to hold is holdable.
  const counts = positions.map((one) => one.pieces)
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b))
})

test('the opening positions really arise after the moves they are named by', () => {
  const spanish = blindPositions().find((one) => one.says.includes('3.Bb5'))
  assert.notEqual(spanish, undefined)
  const replay = enterLine(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])
  assert.equal(replay.ok, true)
  assert.equal(spanish?.fen, replay.fens[replay.fens.length - 1])
})

test('a reconstruction of a real opening position is scored by the stated rule', () => {
  const position = blindPositions().find((one) => one.pieces > 20)
  assert.notEqual(position, undefined)
  const real = boardSquares(position?.fen ?? '').map((one) => ({ square: one.square, side: one.color, type: one.type }))
  const score = scoreRecall(position?.fen ?? '', real)
  assert.equal(score.exact, true)
  assert.equal(score.score, 1)
  const half = scoreRecall(position?.fen ?? '', real.slice(0, Math.floor(real.length / 2)))
  assert.ok(half.score > 0 && half.score < 1)
  assert.match(half.rule, /right square wrong piece/)
})

// ---------------------------------------------------------------- the Academy's own tasks

test('an Academy calculation task passes its own check before the gym offers it', () => {
  const academy = gymPool().exercises.filter((one) => !EXHAUSTIVE_ROOT_IDS.includes(one.id))
  for (const exercise of academy) {
    const { check } = verifyExercise(exercise)
    assert.equal(check.verification.status, 'verified', `${exercise.id}: ${check.problems.map((one) => one.says).join(' / ')}`)
    assert.equal(canPlayFrom(exercise.startFen).ok, true, exercise.id)
  }
})

// ---------------------------------------------------------------- the gym: whether the board may be on screen

test('a hidden-board round in the gym has no board while the line is being written', () => {
  const fen = GYM_CATALOGUE[0].fen
  const rules = gymView({ mode: 'hidden', phase: 'answering', fen })
  assert.equal(rules.boardFen, null)
  assert.equal(rules.mayMovePieces, false)
  assert.equal(rules.scored, true)
})

test('a round with the board on screen may be played with, and is not scored as a hidden one', () => {
  const fen = GYM_CATALOGUE[0].fen
  const rules = gymView({ mode: 'with-board', phase: 'answering', fen })
  assert.equal(rules.boardFen, fen)
  assert.equal(rules.mayMovePieces, true)
  assert.equal(rules.scored, false, 'an attempt with the pieces to hand says nothing about calculating in your head')
})

test('the gym never lets the pieces be moved once the line is submitted', () => {
  // The board comes back on `done`, which is the whole point of the review, and it is not a second go at the
  // exercise. Those are two permissions, so they are two fields.
  for (const mode of ['hidden', 'with-board'] as GymMode[]) {
    const rules = gymView({ mode, phase: 'done', fen: GYM_CATALOGUE[0].fen })
    assert.notEqual(rules.boardFen, null)
    assert.equal(rules.mayMovePieces, false, mode)
  }
})

test('the gym asks the blindfold rule rather than deciding for itself whether to draw a board', () => {
  // Every phase except calculating-with-the-board is the same question, and the two must give the same answer or a
  // change to the hiding rule reaches one screen and not the other.
  const fen = GYM_CATALOGUE[0].fen
  for (const phase of ['ready', 'studying', 'answering', 'done'] as Phase[]) {
    const blind = viewRules({ level: 'solve', phase, mode: 'strict', fen })
    assert.equal(gymView({ mode: 'hidden', phase, fen }).boardFen, blind.boardFen, `hidden/${phase}`)
    if (phase !== 'answering') {
      assert.equal(gymView({ mode: 'with-board', phase, fen }).boardFen, blind.boardFen, `with-board/${phase}`)
    }
  }
})

test('nothing the gym says while the board is hidden names a square, a piece or a position', () => {
  for (const entry of GYM_CATALOGUE) {
    for (const phase of ['ready', 'answering'] as Phase[]) {
      const rules = gymView({ mode: 'hidden', phase, fen: entry.fen })
      assert.equal(rules.boardFen, null, `${entry.id}/${phase}`)
      for (const text of [rules.because ?? '', rules.label, rules.readOut]) {
        assert.ok(!SQUARE.test(text), `${entry.id}/${phase} said a square: ${text}`)
        assert.ok(!NOTATION.test(text), `${entry.id}/${phase} said notation: ${text}`)
        assert.ok(!PIECE_WORDS.test(text), `${entry.id}/${phase} named a piece: ${text}`)
        assert.ok(!FENISH.test(text), `${entry.id}/${phase} leaked a position: ${text}`)
      }
    }
  }
})

test('a hidden round offers no hint while the board is away, because a hint names a square', () => {
  assert.equal(gymView({ mode: 'hidden', phase: 'answering', fen: GYM_CATALOGUE[0].fen }).hintsAllowed, false)
  assert.equal(gymView({ mode: 'hidden', phase: 'done', fen: GYM_CATALOGUE[0].fen }).hintsAllowed, true)
})

// ---------------------------------------------------------------- which position the next move belongs to

test('with Orbis supplying the replies, the line shown is the one with the replies in it', () => {
  const exercise = gymPool().exercises.find((one) => EXHAUSTIVE_ROOT_IDS.includes(one.id))
  assert.notEqual(exercise, undefined)
  if (!exercise) return
  const answer = solutionLines(exercise)[0]
  const draft = { startFen: exercise.startFen, texts: [answer.san[0]] }

  // Both sides: what was typed, and nothing else.
  const both = shownLine(exercise, draft, 'both-sides')
  assert.deepEqual(both.moves.map((one) => one.san), [answer.san[0]])

  // Orbis replying: the reply is in the line, because that is the line being checked.
  const filled = shownLine(exercise, draft, 'from-the-exercise')
  assert.equal(filled.moves.length, 2, 'the reply belongs to the line, not to a footnote about it')
  assert.equal(filled.moves[0].san, answer.san[0])
  assert.equal(filled.moves[1].san, answer.san[1])
})

test('the next move is read against the position after the reply, not after your own last move', () => {
  // The bug this exists to stop: reading every move against the draft's own last position refuses every second
  // move in this mode, because that position has the other side to move. It is invisible until move two.
  const exercise = gymPool().exercises.find((one) => EXHAUSTIVE_ROOT_IDS.includes(one.id) && (one.movesToMate ?? 0) >= 2)
  assert.notEqual(exercise, undefined)
  if (!exercise) return
  const answer = solutionLines(exercise)[0]
  assert.ok(answer.san.length >= 3, 'this needs an answer with a second solver move in it')

  let draft = newDraft(exercise.startFen)
  const first = appendSolverMove(exercise, draft, 'from-the-exercise', answer.san[0])
  assert.equal(first.added, true, answer.san[0])
  draft = first.draft

  // After one of our own moves and one supplied reply, it is our turn again.
  assert.equal(nextFen(exercise, draft, 'from-the-exercise'), answer.fens[1])
  const second = appendSolverMove(exercise, draft, 'from-the-exercise', answer.san[2])
  assert.equal(second.added, true, `${answer.san[2]} is the next solver move and must be accepted`)
  assert.deepEqual(second.draft.texts, [answer.san[0], answer.san[2]], 'only our own moves are kept in the draft')

  // And the draft's own last position is the wrong one, which is exactly why this function exists.
  assert.notEqual(draftFen(draft), nextFen(exercise, draft, 'from-the-exercise'))
})

test('a move that cannot be played is not kept, in either mode', () => {
  const exercise = gymPool().exercises[0]
  for (const replies of ['both-sides', 'from-the-exercise'] as const) {
    const out = appendSolverMove(exercise, newDraft(exercise.startFen), replies, 'Qz9')
    assert.equal(out.added, false, replies)
    assert.deepEqual(out.draft.texts, [], replies)
    assert.equal(out.read.ok, false)
  }
})

test('both sides is the plain case and goes through the plain function', () => {
  const exercise = gymPool().exercises[0]
  const answer = solutionLines(exercise)[0]
  const draft = newDraft(exercise.startFen)
  const viaSolver = appendSolverMove(exercise, draft, 'both-sides', answer.san[0])
  const viaPlain = appendMove(draft, answer.san[0])
  assert.deepEqual(viaSolver.draft.texts, viaPlain.draft.texts)
  assert.equal(nextFen(exercise, viaSolver.draft, 'both-sides'), draftFen(viaPlain.draft))
})
