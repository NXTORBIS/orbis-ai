import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, positionKey } from './rules.ts'
import { buildMoves, fingerprintOf, type StoredGame } from './model.ts'
import type { Score } from './evaluation.ts'
import {
  addMove, annotate, jump, mainLine, next, openSession, promote, recordEvaluation, removeLine, sessionProblems,
  type AnalysisSession, type NodeEvaluation
} from './analysis.ts'
import {
  STUDY_VERSION, branchList, describeRun, describeSave, dropStudy, labelBranch, labelOf, putStudy, readStudy,
  restoreStudy, runOutdated, sortBranches, studyDigest, studyFromSession, worthKeeping, writeStudyPgn,
  type StoredStudy, type StudyRun
} from './study.ts'
import { compareEnds, describeGap } from './compare.ts'

/**
 * Keeping an analysis, tested on values.
 *
 * Every test here is one of the ways keeping work can be worse than not keeping it. A note that comes back on the
 * wrong move, a score that comes back without the depth behind it, a damaged analysis that takes the game with it,
 * a save sent for every keystroke -- each of those is a real failure that looks like success from the inside, so
 * each of them is below.
 *
 * The lines are played through the rules before they are used, so a typo in the notation fails the test rather than
 * quietly producing a game nobody could play. No disk and no engine: every evaluation is one this file wrote, which
 * is the only way to test what happens to a score with no depth on it.
 */

const cp = (n: number): Score => ({ kind: 'cp', cp: n })

function gameOf(sans: string[], startFen = START_FEN, id = 'g1'): StoredGame {
  const built = buildMoves(startFen, sans.map((san) => ({ san })))
  assert.ok(built.ok, `the test line is not playable: ${JSON.stringify(built.failedAt)}`)
  return {
    id,
    profileId: 'p1',
    source: { kind: 'study' },
    startFen,
    moves: built.moves,
    meta: { white: { name: 'Ada' }, black: {}, result: '*' },
    variant: 'standard',
    createdAt: 1,
    updatedAt: 1,
    fingerprint: fingerprintOf(startFen, built.moves)
  }
}

const SHORT = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']

/** Out to the disk and back: what a save and a reopen really do to a record. */
function roundTrip(s: AnalysisSession, now = 1000, runs: readonly StudyRun[] = []): { study: StoredStudy; notes: string[] } {
  const written = JSON.parse(JSON.stringify(studyFromSession(s, now, runs))) as unknown
  const read = readStudy(written)
  assert.ok(read.study, 'a study this version wrote must be readable by it')
  return { study: read.study, notes: read.notes }
}

/** A session with something in it worth keeping: a line, a note on it, and an engine answer with its depth. */
function worked(game: StoredGame): { session: AnalysisSession; branchId: string } {
  let s = openSession(game)
  s = next(next(s))
  const added = addMove(s, 'Nf3')
  assert.ok(added)
  s = added.session
  s = annotate(s, added.nodeId, { text: 'the quiet way', nags: ['!?'] }, 500)
  s = labelBranch(s, added.nodeId, 'The quiet way')
  const evaluation: NodeEvaluation = {
    fen: s.tree.nodes[added.nodeId].fen,
    score: cp(35),
    depth: 22,
    bestmove: 'b8c6',
    pvUci: ['b8c6', 'f1c4'],
    engine: 'Stockfish 17',
    at: 400
  }
  s = recordEvaluation(s, added.nodeId, evaluation)
  return { session: s, branchId: added.nodeId }
}

// ---------------------------------------------------------------- out and back

test('a line, a note and an engine answer all come back, and the answer keeps what it was', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const { study } = roundTrip(session)
  const put = restoreStudy(game, study)

  assert.equal(put.restored, true)
  assert.deepEqual(put.notes, [], 'a sound record comes back with nothing to report')
  assert.equal(put.counts.branches, 1)
  assert.equal(put.counts.notes, 1)
  assert.equal(put.counts.evaluations, 1)
  assert.deepEqual(sessionProblems(put.session), [])

  // The branch is there, under the same id, with its name on it.
  assert.equal(put.session.tree.nodes[branchId]?.move?.san, 'Nf3')
  assert.equal(labelOf(put.session, branchId), 'The quiet way')
  assert.deepEqual(put.session.annotations[branchId], { text: 'the quiet way', nags: ['!?'], updatedAt: 500 })

  // And the score is still a judgement rather than a number: the depth, the engine and the line it came from.
  const back = put.session.evaluations[branchId]
  assert.equal(back.depth, 22, 'a score without its depth is a number pretending to be a judgement')
  assert.equal(back.engine, 'Stockfish 17')
  assert.equal(back.bestmove, 'b8c6')
  assert.deepEqual(back.pvUci, ['b8c6', 'f1c4'])
  assert.equal(positionKey(back.fen), positionKey(put.session.tree.nodes[branchId].fen))
})

test('a depth that was never recorded comes back as not recorded, never as zero', () => {
  const game = gameOf(SHORT)
  let s = openSession(game)
  s = next(s)
  s = recordEvaluation(s, s.cursor, { fen: s.tree.nodes[s.cursor].fen, score: cp(20), depth: null })
  const put = restoreStudy(game, roundTrip(s).study)
  const back = put.session.evaluations[s.cursor]
  assert.equal(back.depth, null, 'nothing in this chain may turn an unknown depth into a number')
})

test('a bound stays a bound, so nothing reads it as a settled score', () => {
  const game = gameOf(SHORT)
  let s = openSession(game)
  s = next(s)
  s = recordEvaluation(s, s.cursor, { fen: s.tree.nodes[s.cursor].fen, score: cp(300), depth: 14, provisional: true })
  const put = restoreStudy(game, roundTrip(s).study)
  assert.equal(put.session.evaluations[s.cursor].provisional, true)
})

test('a promoted main line comes back promoted, with the game as played still in the tree', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const promoted = promote(session, branchId)
  const put = restoreStudy(game, roundTrip(promoted).study)

  assert.ok(mainLine(put.session).includes(branchId), 'the line somebody promoted is the main line again')
  assert.deepEqual(
    put.session.original.map((id) => put.session.tree.nodes[id]?.move?.san ?? 'start'),
    ['start', ...game.moves.map((m) => m.san)],
    'and the game as it was played is all still there'
  )
  assert.deepEqual(sessionProblems(put.session), [])
})

test('the place somebody was looking at comes back, and a place that is gone does not', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const looking = jump(session, branchId)
  assert.equal(restoreStudy(game, roundTrip(looking).study).session.cursor, branchId)

  const study = roundTrip(looking).study
  const broken: StoredStudy = { ...study, cursor: 'a node that was never here' }
  const put = restoreStudy(game, broken)
  assert.equal(put.session.cursor, put.session.tree.rootId, 'it opens at the start rather than at a guess')
})

// ---------------------------------------------------------------- the refusals

test('a game whose moves have changed does not get its old lines put back', () => {
  /*
   * The refusal that matters most. Every node of a saved tree hangs off a position the game reaches; if the game's
   * moves have moved, the notes would come back attached to different moves -- which is worse than coming back
   * empty, because a note on the wrong move is a note nobody can tell is wrong.
   */
  const game = gameOf(SHORT)
  const { session } = worked(game)
  const study = roundTrip(session).study
  const changed = gameOf(['d4', 'd5', 'c4'])

  const put = restoreStudy({ ...changed, id: game.id }, study)
  assert.equal(put.restored, false)
  assert.match(put.notes.join(' '), /moves have changed/)
  assert.match(put.notes.join(' '), /still on the disk and untouched/)
  // And the game itself opened in full.
  assert.equal(put.session.original.length, changed.moves.length + 1)
  assert.deepEqual(sessionProblems(put.session), [])
})

test('a saved analysis about another game is not opened on this one', () => {
  const game = gameOf(SHORT)
  const other = roundTrip(worked(gameOf(SHORT, START_FEN, 'g2')).session).study
  const put = restoreStudy(game, other)
  assert.equal(put.restored, false)
  assert.match(put.notes.join(' '), /about a different game/)
})

test('an analysis that cannot be read at all does not cost the game', () => {
  /*
   * The whole reason a study is its own record. Whatever is wrong with it, the moves, the main line and the report
   * are the game's own and come back in full.
   */
  const game = gameOf(SHORT)
  for (const damaged of [null, { studies: 'nonsense' }, { nodes: 'not a list' }, { gameId: 'g1', nodes: [] }]) {
    const read = readStudy(damaged)
    const put = restoreStudy(game, read.study)
    assert.deepEqual(
      put.session.original.map((id) => put.session.tree.nodes[id]?.move?.san ?? 'start'),
      ['start', ...game.moves.map((m) => m.san)],
      `the game survived ${JSON.stringify(damaged)}`
    )
    assert.deepEqual(sessionProblems(put.session), [])
  }
})

test('a branch whose move cannot be played is named and left out, and everything beside it comes back', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const study = roundTrip(session).study
  // A second branch off the same move, carrying a move that cannot be played from there.
  const parentId = study.nodes.find((one) => one.id === branchId)?.parentId as string
  const parent = study.nodes.find((one) => one.id === parentId)
  assert.ok(parent)
  const nodes = study.nodes.map((one) =>
    one.id === parentId ? { ...one, children: [...one.children, 'rot'] } : one
  )
  nodes.push({
    id: 'rot',
    parentId,
    move: { san: 'Qxf7#', uci: 'd1f7', fen: START_FEN },
    fen: START_FEN,
    children: []
  })

  const put = restoreStudy(game, { ...study, nodes })
  assert.equal(put.restored, true)
  assert.match(put.notes.join(' '), /cannot be played in the position it was saved against/)
  assert.equal(put.session.tree.nodes.rot, undefined, 'the bad branch is not in the tree')
  assert.equal(labelOf(put.session, branchId), 'The quiet way', 'and the sound branch beside it came back whole')
  assert.deepEqual(sessionProblems(put.session), [])
})

test('two saved branches that play the same move become one branch, not a tree that loops', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const study = roundTrip(session).study
  const parentId = study.nodes.find((one) => one.id === branchId)?.parentId as string
  // The same move again, under another id: a file a damaged write or a merge could produce.
  const nodes = study.nodes.map((one) => (one.id === parentId ? { ...one, children: [...one.children, 'twin'] } : one))
  const twin = study.nodes.find((one) => one.id === branchId)
  assert.ok(twin)
  nodes.push({ ...twin, id: 'twin' })

  const put = restoreStudy(game, { ...study, nodes })
  const parent = put.session.tree.nodes[parentId]
  assert.equal(parent.children.filter((id) => put.session.tree.nodes[id]?.move?.san === 'Nf3').length, 1)
  assert.deepEqual(new Set(parent.children).size, parent.children.length, 'no child is listed twice')
  assert.deepEqual(sessionProblems(put.session), [])
})

test('a note on a move that is no longer there is left out rather than moved onto another move', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const study = roundTrip(session).study
  const put = restoreStudy(game, {
    ...study,
    annotations: { ...study.annotations, 'a node nobody has': { text: 'about something else', updatedAt: 1 } }
  })
  assert.equal(Object.keys(put.session.annotations).length, 1)
  assert.equal(put.session.annotations[branchId]?.text, 'the quiet way')
  assert.match(put.notes.join(' '), /rather than moved onto another move/)
})

test('an engine answer calculated in another position is left out, not re-pointed', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const study = roundTrip(session).study
  const drifted: StoredStudy = {
    ...study,
    evaluations: { ...study.evaluations, [branchId]: { ...study.evaluations[branchId], fen: START_FEN } }
  }
  const put = restoreStudy(game, drifted)
  assert.equal(put.session.evaluations[branchId], undefined)
  assert.equal(put.counts.evaluations, 0)
  assert.match(put.notes.join(' '), /calculated in a different position/)
})

test('a record written by a newer Orbis is refused rather than read into a worse copy of itself', () => {
  const read = readStudy({ gameId: 'g1', version: STUDY_VERSION + 3, nodes: [] })
  assert.equal(read.study, null)
  assert.match(read.notes.join(' '), /written by a newer Orbis/)
  assert.match(read.notes.join(' '), /Nothing was deleted/)
})

test('a note that is empty is no note, rather than a stored blank somebody wrote nothing in', () => {
  const read = readStudy({ gameId: 'g1', rootId: 'root', nodes: [], annotations: { n1: { text: '   ', nags: [], updatedAt: 2 } } })
  assert.ok(read.study)
  assert.deepEqual(read.study.annotations, {})
})

// ---------------------------------------------------------------- deciding whether to write

test('nothing is written when nothing has changed, and a note changes it', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const first = studyFromSession(session, 1000)
  const again = studyFromSession(session, 9999)
  assert.equal(studyDigest(first), studyDigest(again), 'the time of a save is not part of what was saved')

  const written = annotate(session, branchId, { text: 'the quiet way, but slowly' }, 600)
  assert.notEqual(studyDigest(studyFromSession(written, 1000)), studyDigest(first))

  // And the record that comes back from the disk names the same thing as the session it was made from.
  const put = restoreStudy(game, roundTrip(session).study)
  assert.equal(studyDigest(studyFromSession(put.session, 1000)), studyDigest(first))
})

test('a session nobody has done anything in is not worth keeping, and one with anything in it is', () => {
  const game = gameOf(SHORT)
  const fresh = openSession(game)
  assert.equal(worthKeeping(fresh), false)
  assert.equal(worthKeeping(annotate(fresh, fresh.original[2], { text: 'hm' }, 1)), true)
  assert.equal(worthKeeping(labelBranch(fresh, fresh.original[2], 'the point')), true)
  const { session } = worked(game)
  assert.equal(worthKeeping(session), true)
  assert.equal(worthKeeping(promote(openSession(game), openSession(game).original[1])), false)
})

test('the saving state says what happened, and a refusal never reads as saved', () => {
  assert.match(describeSave({ kind: 'saved', at: Date.UTC(2026, 0, 2, 9, 5) }), /saved/)
  assert.match(describeSave({ kind: 'pending' }), /Not saved yet/)
  assert.equal(describeSave({ kind: 'refused', why: 'Orbis could not read what is already saved here.' }), 'Orbis could not read what is already saved here.')
  assert.doesNotMatch(describeSave({ kind: 'refused', why: 'Orbis could not read what is already saved here.' }), /saved, as at/)
})

// ---------------------------------------------------------------- the file

test('one game\'s analysis is put in without touching the others, and taking one out leaves the rest', () => {
  const a = roundTrip(worked(gameOf(SHORT)).session).study
  const b = roundTrip(worked(gameOf(SHORT, START_FEN, 'g2')).session).study
  const one = putStudy({ studies: {} }, a)
  const two = putStudy(one.value, b)
  assert.deepEqual(Object.keys(two.value.studies).sort(), ['g1', 'g2'])
  assert.deepEqual(two.notes, [])
  const gone = dropStudy(two.value, 'g1')
  assert.equal(gone.removed, true)
  assert.deepEqual(Object.keys(gone.value.studies), ['g2'])
  assert.equal(dropStudy(gone.value, 'g1').removed, false, 'nothing to remove is not a removal')
})

test('the cap drops the analysis saved longest ago, and says which game it was', () => {
  let held = { studies: {} as Record<string, StoredStudy> }
  const base = roundTrip(worked(gameOf(SHORT)).session).study
  for (let i = 0; i < 402; i++) {
    held = putStudy(held, { ...base, id: `g${i}`, gameId: `g${i}`, savedAt: i }).value
  }
  const last = putStudy(held, { ...base, id: 'newest', gameId: 'newest', savedAt: 100_000 })
  assert.equal(Object.keys(last.value.studies).length, 400)
  assert.ok(last.value.studies.newest, 'the one just saved is kept')
  assert.ok(last.value.studies.g401, 'and so is the one saved just before it')
  assert.equal(last.value.studies.g2, undefined, 'the oldest one still held is the one that goes')
  // Which one went is named. A cap that quietly deletes the oldest half of somebody's work is the same bug as a
  // reader that quietly drops a field.
  assert.match(last.notes.join(' '), /saved longest ago/)
  assert.match(last.notes.join(' '), /g2/)
})

// ---------------------------------------------------------------- naming and organising (Section 126)

test('a name goes on a branch and comes off again, and the moves are untouched either way', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const before = JSON.stringify(session.tree.nodes[branchId].move)
  const named = labelBranch(session, branchId, '  King-side attack  ')
  assert.equal(labelOf(named, branchId), 'King-side attack')
  const cleared = labelBranch(named, branchId, '   ')
  assert.equal(labelOf(cleared, branchId), null, 'an empty name is no name')
  assert.equal(JSON.stringify(cleared.tree.nodes[branchId].move), before)
  assert.equal(labelBranch(session, 'not a node', 'x'), session)
})

test('the branches are listed with what is in each, and sorted three ways', () => {
  const game = gameOf(SHORT)
  let s = openSession(game)
  // Two alternatives to the second move, one of them with a line and a note inside it.
  s = next(s)
  const one = addMove(s, 'c5')
  assert.ok(one)
  s = jump(one.session, s.cursor)
  const two = addMove(s, 'e6')
  assert.ok(two)
  s = two.session
  const deeper = addMove(s, 'Nf3')
  assert.ok(deeper)
  s = annotate(deeper.session, deeper.nodeId, { text: 'this is the point' }, 10)
  s = labelBranch(s, two.nodeId, 'The French')

  const list = branchList(s)
  assert.deepEqual(list.map((b) => b.startsWith), ['1…c5', '1…e6'])
  assert.deepEqual(list.map((b) => b.label), [null, 'The French'])
  assert.equal(list[1].length, 2, 'the French line is two moves long')
  assert.equal(list[1].notes, 1)
  assert.equal(list[0].depth, 0)

  assert.deepEqual(sortBranches(list, 'name').map((b) => b.label), ['The French', null], 'a branch with no name goes last')
  assert.deepEqual(sortBranches(list, 'length').map((b) => b.startsWith), ['1…e6', '1…c5'])
  assert.deepEqual(sortBranches(list, 'where').map((b) => b.startsWith), ['1…c5', '1…e6'])
})

test('a branch that is the game as it was played says so', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const promoted = promote(session, branchId)
  const played = branchList(promoted).filter((b) => b.played)
  assert.equal(played.length, 1, 'the game as played is now a branch, and is marked as one')
})

// ---------------------------------------------------------------- comparing two ends (Section 128)

/** Two orders of the same four moves, and a third line that only looks like one of them. */
function transposing(): { session: AnalysisSession; a: string; b: string } {
  const game = gameOf(['Nf3', 'Nf6', 'c4', 'Nc6'])
  let s = openSession(game)
  // The same position by another order: 1.c4 Nf6 2.Nf3 Nc6.
  const first = addMove(s, 'c4')
  assert.ok(first)
  s = first.session
  for (const san of ['Nf6', 'Nf3', 'Nc6']) {
    const made = addMove(s, san)
    assert.ok(made, `${san} should be playable`)
    s = made.session
  }
  return { session: s, a: s.original[1], b: first.nodeId }
}

test('two orders of the same moves are reported as the same position, and why', () => {
  const { session, a, b } = transposing()
  const compared = compareEnds(session, a, b)
  assert.ok(compared)
  assert.equal(compared.ok, true)
  assert.equal(compared.same, true)
  assert.match(compared.reason, /same position reached in a different order|arrive at the same position/)
  assert.deepEqual(compared.differences, [])
  assert.equal(compared.a.ply, 4, 'the end of the line is what is compared, not the move that starts it')
  assert.equal(compared.b.ply, 4)
})

test('two boards that look alike are not the same position when the castling rights differ', () => {
  /*
   * The case this whole comparison exists for. The rook goes to g1 and comes back: the pieces end where they
   * started and White can no longer castle. Calling the two the same would be wrong in the one way that matters.
   */
  const game = gameOf(['Nf3', 'Nf6', 'Rg1', 'Ng8', 'Rh1', 'Nf6'])
  let s = openSession(game)
  s = jump(s, s.original[2])
  const knight = addMove(s, 'Ng1')
  assert.ok(knight)
  s = knight.session
  for (const san of ['Ng8', 'Nf3', 'Nf6']) {
    const made = addMove(s, san)
    assert.ok(made, `${san} should be playable`)
    s = made.session
  }

  const compared = compareEnds(s, s.original[3], knight.nodeId)
  assert.ok(compared)
  assert.equal(compared.same, false)
  assert.deepEqual(compared.differences, ['castling'])
  assert.match(compared.reason, /castling rights differ/)
  assert.doesNotMatch(compared.reason, /the pieces stand differently/)
})

test('two ends with nothing searched are not reported as level', () => {
  const { session, a, b } = transposing()
  const compared = compareEnds(session, a, b)
  assert.ok(compared)
  assert.equal(compared.canCompare, false)
  assert.equal(compared.gapCp, null)
  assert.equal(describeGap(compared), null)
  assert.match(compared.cautions.join(' '), /not analysed is not a level one/)
})

test('two scores searched to different depths are compared, and said to be different evidence', () => {
  const { session, a, b } = transposing()
  let s = session
  const endA = mainLine(s)[mainLine(s).length - 1]
  let endB = b
  for (;;) {
    const child = s.tree.nodes[endB]?.children[0]
    if (!child) break
    endB = child
  }
  s = recordEvaluation(s, endA, { fen: s.tree.nodes[endA].fen, score: cp(40), depth: 24, engine: 'Stockfish 17' })
  s = recordEvaluation(s, endB, { fen: s.tree.nodes[endB].fen, score: cp(10), depth: 12, engine: 'Stockfish 17' })

  const compared = compareEnds(s, a, b)
  assert.ok(compared)
  assert.equal(compared.canCompare, true)
  assert.equal(compared.gapCp, 30)
  assert.match(String(describeGap(compared)), /0\.30 of a pawn better for White/)
  assert.match(compared.cautions.join(' '), /searched 24 deep and the other 12/)
})

test('a forced mate and a count of pawns are not subtracted from each other', () => {
  const { session, a, b } = transposing()
  let s = session
  const endA = mainLine(s)[mainLine(s).length - 1]
  s = recordEvaluation(s, endA, { fen: s.tree.nodes[endA].fen, score: { kind: 'mate', moves: 4 }, depth: 20 })
  let endB = b
  for (;;) {
    const child = s.tree.nodes[endB]?.children[0]
    if (!child) break
    endB = child
  }
  s = recordEvaluation(s, endB, { fen: s.tree.nodes[endB].fen, score: cp(10), depth: 20 })
  const compared = compareEnds(s, a, b)
  assert.ok(compared)
  assert.equal(compared.canCompare, false)
  assert.equal(compared.gapCp, null)
  assert.match(compared.cautions.join(' '), /no single scale that holds both/)
})

test('comparing a line that is not there answers nothing rather than something', () => {
  const { session, a } = transposing()
  assert.equal(compareEnds(session, a, 'a line nobody has'), null)
})

// ---------------------------------------------------------------- writing it out (Section 129)

test('a study written as PGN has its lines in brackets and its notes in braces, and says what it left out', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const written = writeStudyPgn(session)

  assert.match(written.text, /\[White "Ada"\]/)
  assert.match(written.text, /\(/, 'a variation is written in brackets')
  assert.match(written.text, /Nf3/)
  assert.match(written.text, /\{Line: The quiet way — the quiet way\}/)
  assert.match(written.text, /\!\?/, 'the mark somebody put on the move goes with it')

  const said = written.omitted.join(' ')
  assert.match(said, /recorded engine answer/, 'an export that silently dropped the scores would be claiming too much')
  assert.match(said, /branch name/)
  assert.doesNotMatch(said, /lossless/)
  assert.ok(written.omitted.length >= 2)

  // A promoted line changes what the file's main line means, and that is said too.
  const promoted = writeStudyPgn(promote(session, branchId))
  assert.match(promoted.omitted.join(' '), /written as a variation/)
})

test('a game that starts with a Black move writes that move with its number', () => {
  // A set-up position where Black is to move. Without the number, "e5" reads as White's first move to any reader.
  const game = gameOf(['e5'], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
  const written = writeStudyPgn(openSession(game))
  // The number and the move are separate tokens, as `writePgn` writes them, so the line wraps where PGN wraps.
  assert.match(written.text, /1\.\.\.\s*e5/)
  assert.match(written.text, /\[SetUp "1"\]/)
})

test('the written study holds the whole tree, and the game as played is still in it', () => {
  const game = gameOf(SHORT)
  const { session } = worked(game)
  const written = writeStudyPgn(session)
  for (const move of game.moves) assert.match(written.text, new RegExp(move.san.replace(/[+#]/g, '\\$&')))
})

// ---------------------------------------------------------------- where a report came from (Section 158)

test('a pass over the game is described with what it was asked to do, and an old one is labelled as old', () => {
  const run: StudyRun = {
    id: 'sweep-1',
    startedAt: Date.UTC(2026, 9, 14, 11, 0),
    finishedAt: Date.UTC(2026, 9, 14, 11, 9),
    engine: 'Stockfish 17',
    asked: { positions: 61, quickMs: 300, deepMs: 2000, lines: 3 },
    answered: 61,
    complete: true,
    notes: ['Everything in this pass is a quick look.']
  }
  const said = describeRun(run)
  assert.match(said, /14 October/)
  assert.match(said, /Stockfish 17/)
  assert.match(said, /300ms a position/)
  assert.match(said, /covered all 61 positions/)

  assert.equal(runOutdated(run, { engine: 'Stockfish 17', evaluations: 61 }), null, 'nothing has changed, so nothing is claimed')
  assert.match(String(runOutdated(run, { engine: 'Stockfish 18', evaluations: 61 })), /engine on this computer is now Stockfish 18/)
  assert.match(String(runOutdated(run, { engine: 'Stockfish 17', evaluations: 70 })), /9 more positions have been searched since/)
  assert.match(String(runOutdated({ ...run, complete: false, answered: 20 }, { engine: 'Stockfish 17', evaluations: 20 })), /stopped before it covered/)
})

test('the passes are kept with the analysis and come back with it', () => {
  const game = gameOf(SHORT)
  const { session } = worked(game)
  const run: StudyRun = {
    id: 'sweep-1',
    startedAt: 10,
    finishedAt: 20,
    engine: 'Stockfish 17',
    asked: { positions: 8, quickMs: 300, deepMs: 2000, lines: 1 },
    answered: 8,
    complete: true,
    notes: ['A first look at each position.']
  }
  const { study } = roundTrip(session, 1000, [run])
  assert.equal(study.runs.length, 1)
  assert.equal(study.runs[0].engine, 'Stockfish 17')
  assert.equal(study.runs[0].complete, true)
  assert.deepEqual(study.runs[0].notes, ['A first look at each position.'])
})

// ---------------------------------------------------------------- the thing it was all for

test('a line removed and put back by undo is kept as it then stands, not as it was', () => {
  const game = gameOf(SHORT)
  const { session, branchId } = worked(game)
  const removal = removeLine(session, branchId)
  assert.equal(removal.refused, null)
  const put = restoreStudy(game, roundTrip(removal.session).study)
  assert.equal(put.session.tree.nodes[branchId], undefined, 'what was removed stays removed')
  assert.equal(Object.keys(put.session.annotations).length, 0)
  assert.deepEqual(sessionProblems(put.session), [])
})
