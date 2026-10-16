import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN } from './rules.ts'
import { buildMoves, fenAt, fingerprintOf, type StoredGame } from './model.ts'
import type { Score } from './evaluation.ts'
import {
  acceptUpdate, addMove, annotate, annotationOf, branchPoint, branchesAt, buildReport, canPromote, clearAnnotation,
  cursorFen, enterBranch, evaluationFromWatch, first, flattenLine, graphGaps, graphSegments, last, leaveBranch,
  mainLine, next, noWatch, openSession, originalMoves, planCoverage, planDeeper, planQuickPass, plyOf, prev, promote,
  readUpdate, recordEvaluation, removeLine, reportFromSession, sessionProblems, undo, watchFor, writeLine,
  type EngineUpdate, type PositionEval
} from './analysis.ts'

/**
 * Analysis Studio, tested where it can be tested: on values.
 *
 * The lines below are made up for the test and are played through the rules before they are used, so a typo in the
 * notation fails the test rather than quietly producing a game nobody could play. No engine runs here: every
 * evaluation is one this file wrote, which is the only way to test what the report does with a gap.
 */

const cp = (n: number): Score => ({ kind: 'cp', cp: n })
const mate = (n: number): Score => ({ kind: 'mate', moves: n })

/** A game built out of notation, with the rules deciding whether the notation was right. */
function gameOf(sans: string[], startFen = START_FEN): StoredGame {
  const built = buildMoves(startFen, sans.map((san) => ({ san })))
  assert.ok(built.ok, `the test line is not playable: ${JSON.stringify(built.failedAt)}`)
  return {
    id: 'g1',
    profileId: 'p1',
    source: { kind: 'study' },
    startFen,
    moves: built.moves,
    meta: { white: {}, black: {}, result: '*' },
    variant: 'standard',
    createdAt: 1,
    updatedAt: 1,
    fingerprint: fingerprintOf(startFen, built.moves)
  }
}

/** Four moves each, ending in mate: short enough to assert on every ply. */
const SHORT = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']

// ---------------------------------------------------------------- the session

test('a session lays the game out as the main line and starts at the beginning', () => {
  const game = gameOf(SHORT)
  const s = openSession(game)
  assert.equal(s.note, null)
  assert.equal(s.cursor, s.tree.rootId)
  assert.equal(cursorFen(s), START_FEN)
  assert.equal(s.original.length, game.moves.length + 1)
  assert.deepEqual(mainLine(s), s.original)
  assert.deepEqual(originalMoves(s).map((m) => m.san), game.moves.map((m) => m.san))
  assert.deepEqual(sessionProblems(s), [])
})

test('navigation walks the line and jumping lands where it is told', () => {
  const s = openSession(gameOf(SHORT))
  assert.equal(plyOf(next(s), next(s).cursor), 1)
  const end = last(s)
  assert.equal(plyOf(end, end.cursor), SHORT.length)
  assert.equal(prev(end).cursor, s.original[SHORT.length - 1])
  assert.equal(first(end).cursor, s.tree.rootId)
  // Nothing moves past either end.
  assert.equal(prev(first(s)).cursor, s.tree.rootId)
  assert.equal(next(end).cursor, end.cursor)
})

test('the source game survives being explored, promoted, pruned and restored', () => {
  const game = gameOf(SHORT)
  const before = JSON.stringify(game)
  let s = openSession(game)
  s = next(next(s))
  const added = addMove(s, 'Nf3')
  assert.ok(added)
  s = added.session
  s = annotate(s, added.nodeId, { text: 'the quiet way' }, 100)
  s = promote(s, added.nodeId)
  const removal = removeLine(s, added.nodeId)
  s = removal.session
  s = undo(s).session
  s = undo(s).session
  s = undo(s).session

  // The record itself is the same object with the same contents, whatever was done on top of it.
  assert.equal(s.game, game)
  assert.equal(JSON.stringify(game), before)
  assert.deepEqual(originalMoves(s).map((m) => m.uci), game.moves.map((m) => m.uci))
  assert.deepEqual(mainLine(s), s.original)
  assert.deepEqual(sessionProblems(s), [])
})

test('a move that cannot be played changes nothing, and a move already there is reused', () => {
  const s = openSession(gameOf(SHORT))
  assert.equal(addMove(s, 'Nf6'), null)
  assert.equal(addMove(s, 'e5'), null)
  const again = addMove(s, 'e4')
  assert.ok(again)
  assert.equal(again.existing, true)
  assert.equal(again.nodeId, s.original[1])
  assert.equal(again.session.tree, s.tree)
  const fresh = addMove(s, 'd4')
  assert.ok(fresh)
  assert.equal(fresh.existing, false)
  assert.equal(s.tree.nodes[s.tree.rootId].children.length, 1)
  assert.equal(fresh.session.tree.nodes[s.tree.rootId].children.length, 2)
})

// ---------------------------------------------------------------- branches

test('entering, leaving and promoting a branch, and taking the promotion back', () => {
  let s = openSession(gameOf(SHORT))
  s = next(next(next(next(s))))
  const at = s.cursor
  assert.equal(plyOf(s, at), 4)
  const added = addMove(s, 'd4')
  assert.ok(added)
  s = added.session
  assert.equal(branchPoint(s), at)
  assert.equal(branchPoint(s, at), null)

  // Going down the branch and coming back out lands on the move the branch hangs off.
  const deeper = addMove(s, 'exd4')
  assert.ok(deeper)
  s = deeper.session
  assert.equal(branchPoint(s), at)
  s = leaveBranch(s)
  assert.equal(s.cursor, at)
  assert.deepEqual(branchesAt(s).map((b) => b.san), ['d4'])
  s = enterBranch(s, added.nodeId)
  assert.equal(s.cursor, added.nodeId)

  const wasMain = mainLine(s)
  assert.ok(canPromote(s, added.nodeId))
  const promoted = promote(s, added.nodeId)
  assert.ok(mainLine(promoted).includes(added.nodeId))
  assert.ok(!mainLine(promoted).includes(wasMain[5]))
  assert.equal(canPromote(promoted, added.nodeId), false)
  // The game as played is still there, and the original line still resolves to the game.
  assert.deepEqual(originalMoves(promoted).map((m) => m.san), SHORT)

  const back = undo(promoted)
  assert.match(back.what ?? '', /d4/)
  assert.deepEqual(mainLine(back.session), wasMain)
  assert.deepEqual(sessionProblems(back.session), [])
})

test('promoting pulls every move of the line up, not only its last one', () => {
  let s = openSession(gameOf(SHORT))
  s = next(next(s))
  const one = addMove(s, 'Nf3')
  assert.ok(one)
  const two = addMove(one.session, 'Nc6')
  assert.ok(two)
  const promoted = promote(two.session, two.nodeId)
  const line = mainLine(promoted)
  assert.ok(line.includes(one.nodeId))
  assert.ok(line.includes(two.nodeId))
  assert.deepEqual(mainLine(undo(promoted).session), mainLine(two.session))
})

test('the game as played cannot be pruned out of its own analysis', () => {
  const s = openSession(gameOf(SHORT))
  const refused = removeLine(s, s.original[3])
  assert.deepEqual(refused.removed, [])
  assert.match(refused.refused ?? '', /as it was played/)
  assert.equal(refused.session, s)
  assert.match(removeLine(s, s.tree.rootId).refused ?? '', /starting position/)
  assert.match(removeLine(s, 'nowhere').refused ?? '', /not here/)
})

test('removing a line takes its whole subtree, and undo puts it back where it was', () => {
  let s = openSession(gameOf(SHORT))
  s = next(next(s))
  const head = addMove(s, 'Nf3')
  assert.ok(head)
  const tail = addMove(head.session, 'Nc6')
  assert.ok(tail)
  s = tail.session
  const order = [...s.tree.nodes[head.session.tree.nodes[head.nodeId].parentId ?? ''].children]

  const gone = removeLine(s, head.nodeId)
  assert.deepEqual(gone.removed, [head.nodeId, tail.nodeId])
  assert.equal(gone.session.tree.nodes[tail.nodeId], undefined)
  assert.equal(gone.session.cursor, head.session.tree.nodes[head.nodeId].parentId)

  const back = undo(gone.session)
  assert.ok(back.session.tree.nodes[tail.nodeId])
  assert.deepEqual([...back.session.tree.nodes[head.session.tree.nodes[head.nodeId].parentId ?? ''].children], order)
  assert.deepEqual(sessionProblems(back.session), [])
})

// ---------------------------------------------------------------- notes

test('a note is attached to a node and follows it through promotion', () => {
  let s = openSession(gameOf(SHORT))
  s = next(next(s))
  const added = addMove(s, 'Nf3')
  assert.ok(added)
  s = annotate(added.session, added.nodeId, { text: 'the quiet way', nags: ['!?'] }, 500)
  assert.deepEqual(annotationOf(s, added.nodeId), { text: 'the quiet way', nags: ['!?'], updatedAt: 500 })

  const promoted = promote(s, added.nodeId)
  assert.deepEqual(annotationOf(promoted, added.nodeId), annotationOf(s, added.nodeId))
  const row = flattenLine(promoted).find((r) => r.nodeId === added.nodeId)
  assert.equal(row?.annotation?.text, 'the quiet way')
  assert.equal(row?.main, true)
})

test('a note follows its node through a removal and a restore, and an empty note is no note', () => {
  let s = openSession(gameOf(SHORT))
  s = next(next(s))
  const added = addMove(s, 'Nf3')
  assert.ok(added)
  s = annotate(added.session, added.nodeId, { text: 'worth a look' }, 1)
  const gone = removeLine(s, added.nodeId)
  assert.equal(annotationOf(gone.session, added.nodeId), null)
  const back = undo(gone.session)
  assert.equal(annotationOf(back.session, added.nodeId)?.text, 'worth a look')
  assert.deepEqual(sessionProblems(back.session), [])

  const cleared = clearAnnotation(back.session, added.nodeId, 2)
  assert.equal(annotationOf(cleared, added.nodeId), null)
  const restored = undo(cleared)
  assert.equal(annotationOf(restored.session, added.nodeId)?.text, 'worth a look')
  // Whitespace is not a note either.
  assert.equal(annotationOf(annotate(back.session, added.nodeId, { text: '   ', nags: [] }, 3), added.nodeId), null)
})

test('an evaluation is only recorded against the position it was calculated in', () => {
  const game = gameOf(SHORT)
  const s = openSession(game)
  const nodeId = s.original[2]
  const right = recordEvaluation(s, nodeId, { fen: fenAt(game, 2), score: cp(30), depth: 18 })
  assert.equal(right.evaluations[nodeId]?.depth, 18)
  const wrong = recordEvaluation(s, nodeId, { fen: fenAt(game, 3), score: cp(900), depth: 30 })
  assert.equal(wrong, s)
  // A shallower answer does not push a deeper one out.
  const shallower = recordEvaluation(right, nodeId, { fen: fenAt(game, 2), score: cp(-400), depth: 6 })
  assert.equal(shallower.evaluations[nodeId]?.depth, 18)
  const deeper = recordEvaluation(right, nodeId, { fen: fenAt(game, 2), score: cp(44), depth: 26 })
  assert.equal(deeper.evaluations[nodeId]?.depth, 26)
})

// ---------------------------------------------------------------- the move list

test('the move list tells the main line and the branches apart, and nests them', () => {
  let s = openSession(gameOf(SHORT))
  s = next(next(s))
  const alt = addMove(s, 'Nf3')
  assert.ok(alt)
  const inner = addMove(alt.session, 'Nc6')
  assert.ok(inner)
  const rows = flattenLine(inner.session)
  const main = rows.filter((r) => r.main)
  assert.deepEqual(main.map((r) => r.san), SHORT)
  assert.deepEqual(main.map((r) => r.nesting), SHORT.map(() => 0))
  const branch = rows.filter((r) => !r.main)
  assert.deepEqual(branch.map((r) => r.san), ['Nf3', 'Nc6'])
  assert.equal(branch[0].startsBranch, true)
  assert.equal(branch[0].nesting, 1)
  assert.equal(branch[1].closes, 1)
  // The branch is written where it belongs: straight after the move it is an alternative to.
  assert.equal(rows[2].san, 'Qh5')
  assert.equal(rows[3].san, 'Nf3')
  assert.equal(rows[3].ply, 3)
  assert.equal(rows[3].number, 2)
  assert.equal(rows[3].side, 'w')
})

// ---------------------------------------------------------------- the report

test('a position that was not analysed is a gap in the graph and an unnamed move in the list', () => {
  const game = gameOf(SHORT)
  const evals: PositionEval[] = [0, 1, 2, 6, 7].map((ply) => ({ ply, fen: fenAt(game, ply), score: cp(ply * 10), depth: 20 }))
  const report = buildReport(game, evals)

  assert.equal(report.graph.length, game.moves.length + 1)
  assert.deepEqual(report.graph.map((p) => p.score === null), [false, false, false, true, true, true, false, false])
  for (const point of report.graph) {
    if (point.score === null) assert.equal(point.fraction, null)
    else assert.ok(point.fraction !== null)
  }
  assert.deepEqual(graphGaps(report.graph), [{ from: 3, to: 5 }])
  assert.deepEqual(report.coverage.notAnalysed, [3, 4, 5])
  assert.equal(report.coverage.analysed, 5)
  assert.equal(report.coverage.total, 8)

  const unjudged = report.moves.filter((m) => !m.analysed)
  assert.deepEqual(unjudged.map((m) => m.ply), [3, 4, 5, 6])
  assert.ok(unjudged.every((m) => m.klass === 'unclear' && m.why.length > 0 && m.loss === null))
  assert.match(report.moves[2].why, /not analysed/)
  assert.match(report.summary, /5 of 8 positions analysed/)
  assert.match(report.summary, /were not analysed at all/)
})

test('nothing is drawn across a gap: the graph comes back as separate runs', () => {
  const game = gameOf(SHORT)
  const evals: PositionEval[] = [0, 1, 2, 6, 7].map((ply) => ({ ply, fen: fenAt(game, ply), score: cp(0), depth: 20 }))
  const segments = graphSegments(buildReport(game, evals).graph, { width: 700, height: 100 })
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[0].points.map((p) => p.ply), [0, 1, 2])
  assert.deepEqual(segments[1].points.map((p) => p.ply), [6, 7])
  assert.equal(segments[0].points[0].x, 0)
  assert.equal(segments[1].points[1].x, 700)
})

test('a shallow search names nothing, and the depth behind a judgement is the shallower of the two', () => {
  const game = gameOf(SHORT)
  const shallow: PositionEval[] = [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: 4 },
    { ply: 1, fen: fenAt(game, 1), score: cp(-260), depth: 4 }
  ]
  const report = buildReport(game, shallow)
  assert.equal(report.moves[0].klass, 'unclear')
  assert.equal(report.moves[0].depth, 4)
  assert.match(report.moves[0].why, /not enough to name this move/)
  assert.deepEqual(report.coverage.shallow, [0, 1])
  assert.equal(report.critical.length, 0)

  const mixed = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: 24 },
    { ply: 1, fen: fenAt(game, 1), score: cp(-260), depth: 9 }
  ])
  assert.equal(mixed.moves[0].depth, 9)
  assert.equal(mixed.moves[0].klass, 'blunder')
  assert.match(mixed.moves[0].why, /9 deep/)

  // No depth recorded is not the same as a deep search.
  const noDepth = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: null },
    { ply: 1, fen: fenAt(game, 1), score: cp(-260), depth: null }
  ])
  assert.equal(noDepth.moves[0].klass, 'unclear')
  assert.match(noDepth.moves[0].why, /depth was not recorded/)

  // A bound is not a settled number either.
  const bounded = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: 24 },
    { ply: 1, fen: fenAt(game, 1), score: cp(-260), depth: 24, provisional: true }
  ])
  assert.equal(bounded.moves[0].klass, 'unclear')
  assert.match(bounded.moves[0].why, /bound/)
})

test('a mate that was there and was not played is reported as that, never as a centipawn loss', () => {
  const game = gameOf(SHORT)
  // Before White's fourth move a forced mate is on the board; the report is told the move played gave it up.
  const evals: PositionEval[] = [
    { ply: 6, fen: fenAt(game, 6), score: mate(1), depth: 22, bestmove: 'h5f7' },
    { ply: 7, fen: fenAt(game, 7), score: cp(320), depth: 22 }
  ]
  const report = buildReport(game, evals)
  const row = report.moves[6]
  assert.equal(row.klass, 'missed-mate')
  assert.equal(row.loss, null, 'missing a mate is not a number of centipawns')
  assert.equal(report.missedMates.length, 1)
  assert.equal(report.missedMates[0].mateIn, 1)
  assert.equal(report.missedMates[0].mateMove?.uci, 'h5f7')
  assert.equal(report.missedMates[0].mateMove?.san, 'Qxf7#')
  assert.equal(report.missedMates[0].depth, 22)
  const moment = report.critical.find((c) => c.ply === 7)
  assert.equal(moment?.reason, 'missed-mate')
  assert.equal(moment?.depth, 22)
  assert.match(moment?.explain ?? '', /forced mate/)
  assert.match(report.summary, /1 forced mate missed/)
})

test('walking into a mate is a critical moment of its own, and mate scores read per side', () => {
  const game = gameOf(SHORT)
  // Black to move at ply 5; the move played lets White mate.
  const report = buildReport(game, [
    { ply: 5, fen: fenAt(game, 5), score: cp(150), depth: 20 },
    { ply: 6, fen: fenAt(game, 6), score: mate(1), depth: 20 }
  ])
  const row = report.moves[5]
  assert.equal(row.mover, 'b')
  assert.equal(row.klass, 'blunder')
  const moment = report.critical.find((c) => c.ply === 6)
  assert.equal(moment?.reason, 'walked-into-mate')
  assert.match(moment?.explain ?? '', /walked into a forced mate/)

  // The same mate score, with Black the one mating, is a missed mate for Black and nothing for White.
  const forBlack = buildReport(game, [
    { ply: 5, fen: fenAt(game, 5), score: mate(-2), depth: 20, bestmove: 'c6d4' },
    { ply: 6, fen: fenAt(game, 6), score: cp(-80), depth: 20 }
  ])
  assert.equal(forBlack.moves[5].klass, 'missed-mate')
  assert.equal(forBlack.missedMates[0].mover, 'b')
  assert.equal(forBlack.missedMates[0].mateIn, 2)
})

test('loss and classification are read from the mover s side, not White s', () => {
  const game = gameOf(SHORT)
  // White stands a pawn better; after Black's reply the game is level. That is a loss for Black, not a gain.
  const report = buildReport(game, [
    { ply: 1, fen: fenAt(game, 1), score: cp(-100), depth: 20 },
    { ply: 2, fen: fenAt(game, 2), score: cp(0), depth: 20 }
  ])
  const row = report.moves[1]
  assert.equal(row.mover, 'b')
  assert.equal(row.loss, 100)
  assert.equal(row.klass, 'mistake')
  assert.equal(report.centipawnLoss.black?.average, 100)
  assert.equal(report.centipawnLoss.black?.from, 1)
  assert.equal(report.centipawnLoss.white, null)

  // The same two numbers, read for a White move, are a gain and so cost nothing.
  const forWhite = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(-100), depth: 20 },
    { ply: 1, fen: fenAt(game, 1), score: cp(0), depth: 20 }
  ])
  assert.equal(forWhite.moves[0].mover, 'w')
  assert.equal(forWhite.moves[0].loss, 0)
  assert.equal(forWhite.moves[0].klass, 'best')
})

test('a swing is the game changing hands, not any large number', () => {
  const game = gameOf(SHORT)
  const swung = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(180), depth: 20 },
    { ply: 1, fen: fenAt(game, 1), score: cp(-200), depth: 20 }
  ])
  const moment = swung.critical.find((c) => c.ply === 1)
  assert.ok(moment)
  assert.ok(moment.reason === 'blunder' || moment.reason === 'swing')
  assert.ok(swung.critical.every((c) => c.explain.length > 0))

  // Winning by six pawns instead of eight is not the game changing hands.
  const stillWinning = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(800), depth: 20 },
    { ply: 1, fen: fenAt(game, 1), score: cp(600), depth: 20 }
  ])
  assert.equal(stillWinning.critical.filter((c) => c.reason === 'swing').length, 0)
})

test('an evaluation of another position is not used, and a deeper one replaces a shallower one', () => {
  const game = gameOf(SHORT)
  const report = buildReport(game, [
    { ply: 1, fen: fenAt(game, 4), score: cp(999), depth: 30 },
    { ply: 99, fen: fenAt(game, 1), score: cp(10), depth: 30 },
    { ply: 2, fen: fenAt(game, 2), score: cp(10), depth: 8 },
    { ply: 2, fen: fenAt(game, 2), score: cp(40), depth: 26 }
  ])
  assert.equal(report.graph[1].score, null, 'a number calculated elsewhere is not shown here')
  assert.equal(report.graph[2].depth, 26)
  assert.deepEqual(report.graph[2].score, cp(40))
  assert.equal(report.ignored.length, 3)
  assert.match(report.ignored[0].reason, /does not match this game/)
  assert.match(report.ignored[1].reason, /not in this game/)
  assert.match(report.ignored[2].reason, /deeper search/)
})

test('the report names a better move only when the engine named a different one', () => {
  const game = gameOf(SHORT)
  const report = buildReport(game, [
    { ply: 0, fen: fenAt(game, 0), score: cp(30), depth: 20, bestmove: 'd2d4' },
    { ply: 1, fen: fenAt(game, 1), score: cp(10), depth: 20, bestmove: 'e7e5' }
  ])
  assert.deepEqual(report.moves[0].better, { uci: 'd2d4', san: 'd4' })
  // The second move played is the one the engine wanted, so nothing is suggested.
  assert.equal(report.moves[1].better, undefined)
})

test('a report built from the session uses the evaluations recorded on the game s own nodes', () => {
  const game = gameOf(SHORT)
  let s = openSession(game)
  s = recordEvaluation(s, s.original[0], { fen: fenAt(game, 0), score: cp(25), depth: 20 })
  s = recordEvaluation(s, s.original[1], { fen: fenAt(game, 1), score: cp(20), depth: 20 })
  const report = reportFromSession(s)
  assert.equal(report.coverage.analysed, 2)
  assert.equal(report.moves[0].loss, 5)
  assert.equal(report.moves[0].klass, 'excellent')
  assert.deepEqual(report.coverage.notAnalysed, [2, 3, 4, 5, 6, 7])
})

// ---------------------------------------------------------------- the plan

test('a plan that fits covers every position, in order, and says nothing was skipped', () => {
  const game = gameOf(SHORT)
  const plan = planQuickPass(game, { totalMs: 60_000 })
  assert.equal(plan.steps.length, game.moves.length + 1)
  assert.deepEqual(plan.steps.map((s) => s.ply), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(plan.skipped, [])
  assert.equal(plan.msEach, 200)
  assert.equal(plan.estimatedMs, 1600)
  assert.equal(plan.reservedDeepMs, 30_000)
  assert.ok(plan.steps.every((s) => s.pass === 'quick' && s.limits.movetime === 200))
  assert.equal(plan.steps[3].fen, fenAt(game, 3))
  assert.deepEqual(plan.steps.map((s) => s.requestId), plan.steps.map((s) => `g1:q${s.ply}`))
  assert.ok(plan.steps.every((s) => s.reason.length > 0))
  assert.deepEqual(plan.shallowOnly, plan.steps.map((s) => s.ply))
})

test('a tight budget shortens the time per position before it gives anything up', () => {
  const game = gameOf(SHORT)
  const plan = planQuickPass(game, { totalMs: 1600, quickMs: 200, floorMs: 50 })
  assert.equal(plan.msEach, 100)
  assert.deepEqual(plan.skipped, [])
  assert.ok(plan.notes.some((n) => /not enough time/.test(n)))
})

test('a budget that cannot cover the game keeps a run to the end, and lists what it dropped', () => {
  const game = gameOf(SHORT)
  const plan = planQuickPass(game, { totalMs: 600, quickMs: 200, floorMs: 50, deepShare: 0.5 })
  // 300ms for the quick pass at a 50ms floor is six positions out of eight.
  assert.equal(plan.msEach, 50)
  assert.deepEqual(plan.skipped, [0, 1])
  assert.deepEqual(plan.steps.map((s) => s.ply), [2, 3, 4, 5, 6, 7])
  // Consecutive, because naming a move needs the position before it as well as the one after it.
  for (let i = 1; i < plan.steps.length; i++) assert.equal(plan.steps[i].ply, plan.steps[i - 1].ply + 1)
  assert.ok(plan.notes.some((n) => /the first 2 are not searched/.test(n)))
})

test('a budget that covers nothing says so instead of pretending to a plan', () => {
  const plan = planQuickPass(gameOf(SHORT), { totalMs: 40, quickMs: 200, floorMs: 50 })
  assert.deepEqual(plan.steps, [])
  assert.equal(plan.skipped.length, 8)
  assert.ok(plan.notes.some((n) => /does not cover a single position/.test(n)))
})

test('the deeper pass picks the moves where the numbers moved, and asks for both their positions', () => {
  const game = gameOf(SHORT)
  const quick: PositionEval[] = [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: 6 },
    { ply: 1, fen: fenAt(game, 1), score: cp(10), depth: 6 },
    { ply: 2, fen: fenAt(game, 2), score: cp(5), depth: 6 },
    { ply: 3, fen: fenAt(game, 3), score: cp(-400), depth: 6 },
    { ply: 4, fen: fenAt(game, 4), score: cp(-380), depth: 6 }
  ]
  const plan = planDeeper(game, { totalMs: 60_000, deepMs: 1000 }, quick)
  assert.equal(plan.candidates[0].ply, 3)
  assert.match(plan.candidates[0].why, /moved 4.05 of a pawn|moved 4\.\d\d of a pawn/)
  assert.deepEqual(plan.steps.map((s) => s.ply), [2, 3])
  assert.ok(plan.steps.every((s) => s.pass === 'deep' && s.limits.movetime === 1000 && s.multipv === 3))
  assert.deepEqual(plan.steps.map((s) => s.requestId), ['g1:d2', 'g1:d3'])
  assert.equal(plan.estimatedMs, 2000)
  assert.ok(plan.notes.some((n) => /before it and the position after it/.test(n)))
})

test('the deeper pass puts mate scores first and says which candidates did not fit', () => {
  const game = gameOf(SHORT)
  const quick: PositionEval[] = [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: 6 },
    { ply: 1, fen: fenAt(game, 1), score: cp(-900), depth: 6 },
    { ply: 2, fen: fenAt(game, 2), score: cp(-880), depth: 6 },
    { ply: 3, fen: fenAt(game, 3), score: mate(3), depth: 6 }
  ]
  const plan = planDeeper(game, { totalMs: 4000, deepMs: 1000, deepShare: 0.5 }, quick)
  // Two searches fit; the mate takes them.
  assert.equal(plan.candidates[0].ply, 3)
  assert.equal(plan.candidates[0].magnitude, null)
  assert.deepEqual(plan.steps.map((s) => s.ply), [2, 3])
  assert.equal(plan.notDeepened.length, 1)
  assert.equal(plan.notDeepened[0].ply, 1)
  assert.match(plan.notDeepened[0].why, /no time left/)
  assert.ok(plan.notes.some((n) => /do not fit in the budget/.test(n)))
})

test('coverage compares what was asked with what came back', () => {
  const game = gameOf(SHORT)
  const plan = planQuickPass(game, { totalMs: 60_000 })
  const got: PositionEval[] = [
    { ply: 0, fen: fenAt(game, 0), score: cp(20), depth: 10 },
    { ply: 1, fen: fenAt(game, 1), score: cp(20), depth: 10 },
    // Calculated in the wrong position: it does not count as an answer for ply 2.
    { ply: 2, fen: fenAt(game, 5), score: cp(20), depth: 10 }
  ]
  const coverage = planCoverage(game, plan, got)
  assert.deepEqual(coverage.answered, [0, 1])
  assert.deepEqual(coverage.missing, [2, 3, 4, 5, 6, 7])
  assert.deepEqual(coverage.unasked, [])

  const tight = planQuickPass(game, { totalMs: 600, quickMs: 200, floorMs: 50 })
  assert.deepEqual(planCoverage(game, tight, []).unasked, [0, 1])
})

// ---------------------------------------------------------------- the engine's answers

const update = (over: Partial<EngineUpdate>): EngineUpdate => ({
  requestId: 'r1',
  fen: START_FEN,
  score: cp(25),
  depth: 18,
  nodes: 1000,
  nps: 500,
  timeMs: 200,
  pvSan: null,
  pvUci: ['e2e4'],
  multipv: 1,
  bound: null,
  complete: false,
  ...over
})

test('an answer is taken only when both the request and the position match', () => {
  const game = gameOf(SHORT)
  let watch = watchFor('r1', START_FEN)
  watch = acceptUpdate(watch, update({ requestId: 'r2' }))
  assert.equal(watch.ignored, 1)
  assert.deepEqual(watch.lines, [])

  watch = acceptUpdate(watch, update({ fen: fenAt(game, 4) }))
  assert.equal(watch.ignored, 2)
  assert.deepEqual(watch.lines, [])

  watch = acceptUpdate(watch, update({}))
  assert.equal(watch.ignored, 2)
  assert.equal(watch.lines.length, 1)
  assert.deepEqual(watch.lines[0].score, cp(25))

  // Nothing is waited for, so nothing is accepted.
  assert.equal(acceptUpdate(noWatch(), update({})).ignored, 1)
  assert.deepEqual(acceptUpdate(noWatch(), update({})).lines, [])
})

test('each line keeps its own slot, the latest answer replacing the one before it', () => {
  let watch = watchFor('r1', START_FEN)
  watch = acceptUpdate(watch, update({ multipv: 2, score: cp(10), pvUci: ['d2d4'] }))
  watch = acceptUpdate(watch, update({ multipv: 1, score: cp(25), depth: 12 }))
  watch = acceptUpdate(watch, update({ multipv: 1, score: cp(31), depth: 20 }))
  assert.deepEqual(watch.lines.map((l) => l.multipv), [1, 2])
  assert.equal(watch.lines[0].depth, 20)
  assert.deepEqual(watch.lines[0].score, cp(31))
  assert.deepEqual(watch.lines[1].pvUci, ['d2d4'])

  const done = acceptUpdate(watch, update({ complete: true, bestmove: 'e2e4', bestmoveSan: 'e4', note: null }))
  assert.equal(done.complete, true)
  assert.equal(done.bestmove, 'e2e4')
})

test('what is recorded from an answer carries the position, and a bound is marked as unsettled', () => {
  const settled = evaluationFromWatch(acceptUpdate(watchFor('r1', START_FEN), update({ complete: true, bestmove: 'e2e4' })), 'Stockfish 17', 99)
  assert.ok(settled)
  assert.equal(settled.fen, START_FEN)
  assert.equal(settled.depth, 18)
  assert.equal(settled.bestmove, 'e2e4')
  assert.equal(settled.engine, 'Stockfish 17')
  assert.equal(settled.at, 99)
  assert.equal(settled.provisional, undefined)

  const bounded = evaluationFromWatch(acceptUpdate(watchFor('r1', START_FEN), update({ bound: 'lower' })))
  assert.equal(bounded?.provisional, true)

  // Nothing to record from a watch with no score.
  assert.equal(evaluationFromWatch(watchFor('r1', START_FEN)), null)
  assert.equal(evaluationFromWatch(acceptUpdate(watchFor('r1', START_FEN), update({ score: { kind: 'none' } }))), null)
})

test('an update from the other process is checked, not trusted', () => {
  assert.equal(readUpdate(null), null)
  assert.equal(readUpdate('info depth 20'), null)
  assert.equal(readUpdate({ fen: START_FEN, score: { kind: 'cp', cp: 10 } }), null, 'no request means no answer')
  assert.equal(readUpdate({ requestId: 'r1', score: { kind: 'cp', cp: 10 } }), null, 'no position means no answer')
  assert.equal(readUpdate({ requestId: 'r1', fen: START_FEN }), null, 'no score means no answer')
  assert.equal(readUpdate({ requestId: 'r1', fen: START_FEN, score: { kind: 'cp' } }), null)

  const read = readUpdate({
    requestId: 'r1', fen: START_FEN, score: { kind: 'mate', moves: 3 }, depth: 'deep', nodes: 50,
    pvUci: ['e2e4', 7, 'e7e5'], pvSan: null, multipv: 2, bound: 'nonsense', complete: true, bestmove: 'e2e4'
  })
  assert.ok(read)
  assert.deepEqual(read.score, { kind: 'mate', moves: 3 })
  assert.equal(read.depth, null, 'a depth that is not a number is not a depth')
  assert.equal(read.nodes, 50)
  assert.deepEqual(read.pvUci, ['e2e4', 'e7e5'])
  assert.equal(read.pvSan, null)
  assert.equal(read.multipv, 2)
  assert.equal(read.bound, null)
  assert.equal(read.complete, true)
  assert.equal(read.bestmove, 'e2e4')
  assert.equal(read.note, undefined)
})

test('a line is written out against the position it was calculated in', () => {
  const written = writeLine(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6'])
  assert.equal(written.text, '1.e4 e5 2.Nf3 Nc6')
  assert.equal(written.legal, true)
  assert.equal(written.shown, 4)

  const game = gameOf(['e4'])
  const fromBlack = writeLine(fenAt(game, 1), ['e7e5', 'g1f3'])
  assert.equal(fromBlack.text, '1...e5 2.Nf3')

  // A line that cannot be played stops where it stops and says so.
  const broken = writeLine(START_FEN, ['e2e4', 'e2e4'])
  assert.equal(broken.legal, false)
  assert.equal(broken.shown, 1)
  assert.equal(broken.text, '1.e4')
})
