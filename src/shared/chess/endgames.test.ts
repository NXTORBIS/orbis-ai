import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFENCE_RULES, PROOF_TEXT, defenceReply, drillMove, forcedAfter, forcedIn, freeCapture, hintFor, mateIn,
  objectiveLost, objectiveMet, objectiveText, playable, proofKind, progressOf, startDrill, verifyCatalogue,
  verifyEntry, walkLine, type EndgameEntry
} from './endgames.ts'

/**
 * The machine under the Endgame Lab.
 *
 * Two things are being tested and they matter for different reasons. The search has to be right about forced lines,
 * because every "in n" in the catalogue rests on it. The checker has to be right about bad data, because an author
 * who mistypes a mate in two needs to be told -- so there are deliberately broken entries below, and the test fails
 * if the checker lets one through.
 */

const SMALL = { budget: 40_000 }

// ---------------------------------------------------------------- the search

test('a mate in one, two and three are each found at the right distance', () => {
  // Rook arriving on an empty back rank, with the pawns shutting the king in.
  assert.equal(mateIn('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 3, SMALL).moves, 1)
  // Two rooks, the ladder.
  assert.equal(mateIn('7k/8/8/8/8/8/5RR1/6K1 w - - 0 1', 3, SMALL).moves, 2)
  // Queen and king, with the kings not yet facing: the king has to move first.
  assert.equal(mateIn('6k1/8/4K3/8/8/8/8/3Q4 w - - 0 1', 4, SMALL).moves, 3)
})

test('the search says no when there is no forced mate, and says so completely', () => {
  // King and pawn against a king: nothing is mated in two whatever happens.
  const none = mateIn('8/8/8/8/8/5k2/5P2/5K2 w - - 0 1', 2, SMALL)
  assert.equal(none.moves, null)
  assert.equal(none.complete, true)
})

test('a budget that runs out is reported as unproved, never as a no', () => {
  // One position looked at is not enough to settle anything about an open board.
  const starved = mateIn('8/8/8/4k3/8/8/8/4K2Q w - - 0 1', 4, { budget: 2 })
  assert.equal(starved.moves, null)
  assert.equal(starved.complete, false)
  assert.ok(starved.nodes > 0)
})

test('a promotion and a draw can be forced too, and the distance is the shortest one', () => {
  // Pawn on the sixth with its king beside it: two moves and it is through.
  assert.equal(forcedIn('8/8/1PK5/8/8/8/8/7k w - - 0 1', 'promote', 4, SMALL).moves, 2)
  // Connected pawns do it without their king, and not a move sooner than three.
  assert.equal(forcedIn('8/8/4k3/1PP5/8/8/8/K7 w - - 0 1', 'promote', 4, SMALL).moves, 3)
  // Taking the last pawn ends the game: a draw forced in one.
  assert.equal(forcedIn('8/8/4kP2/8/8/8/K7/8 b - - 0 1', 'draw', 3, SMALL).moves, 1)
  // The same idea three moves away: walk at the pawn and it cannot get past.
  assert.equal(forcedIn('8/8/8/3k4/8/5P2/8/K7 b - - 0 1', 'draw', 4, SMALL).moves, 3)
})

test('after a move has been played, what is left of the mate is measured from the other side', () => {
  const start = '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1'
  assert.equal(mateIn(start, 3, SMALL).moves, 2)
  // Rg5 keeps the mate: Black has only Kh7, and one move finishes it.
  const keeps = forcedAfter('7k/8/8/6R1/8/8/5R2/6K1 b - - 1 1', 'mate', 2, SMALL)
  assert.equal(keeps.moves, 1)
  // A mate already delivered is nought moves away, not one.
  const done = forcedAfter('8/7k/8/6R1/8/8/7R/6K1 b - - 2 2', 'mate', 2, SMALL)
  assert.equal(done.moves, 0)
})

test('a position no game could reach is refused rather than searched', () => {
  // Black is in check from the c5 pawn and it is White to move: no game reaches this.
  const impossible = '8/8/3k4/1PP5/8/8/8/K7 w - - 0 1'
  const check = playable(impossible)
  assert.equal(check.ok, false)
  assert.match(check.reason ?? '', /not to move is in check/)
  assert.equal(mateIn(impossible, 2, SMALL).moves, null)
  assert.equal(playable('8/8/8/4k3/8/8/8/4K2Q w - - 0 1').ok, true)
  assert.equal(playable('nonsense').ok, false)
})

// ---------------------------------------------------------------- facts the feedback is built on

test('a piece that can be taken for nothing is spotted, and a defended one is not', () => {
  // The rook on g7 is next to the black king on h8 and nothing defends it.
  const loose = freeCapture('7k/6R1/8/8/8/8/8/K7 b - - 0 1')
  assert.ok(loose)
  assert.equal(loose.move.to, 'g7')
  assert.equal(loose.worth, 5)
  // The same rook, defended by the other one: taking it is not free.
  assert.equal(freeCapture('7k/6R1/6R1/8/8/8/8/K7 b - - 0 1'), null)
})

// ---------------------------------------------------------------- the defence

test('the defence takes a mate, takes a free piece, and otherwise follows its rule', () => {
  const entry = (fen: string, side: 'w' | 'b'): EndgameEntry => ({
    id: 'test-defence', theme: 'basic-mate', title: 'Test', fen, sideToMove: side,
    objective: { kind: 'win' }, method: 'A position used only to test the defence rule.', difficulty: 1,
    provenance: 'Written for this test.'
  })

  // It mates when it can: Black's rook on h2 with the white king shut in on g1.
  const mates = defenceReply(entry('6k1/8/8/8/8/8/7r/r5K1 w - - 0 1', 'w'), '6k1/8/8/8/8/8/7r/r5K1 b - - 0 1')
  assert.ok(mates)
  assert.equal(mates.move.checkmate, true)

  // It takes a loose rook rather than wander. (With a pawn still on, the capture does not end the game, so this
  // tests the free-capture rule rather than the draw rule above it.)
  const takes = defenceReply(entry('7k/6R1/8/8/8/8/P7/K7 w - - 0 1', 'w'), '7k/6R1/8/8/8/8/P7/K7 b - - 0 1')
  assert.ok(takes)
  assert.equal(takes.move.captured, 'r')

  // With a pawn of its own and nothing better, it pushes it.
  const pushes = defenceReply(entry('8/4k3/8/8/P7/8/8/K7 b - - 0 1', 'b'), '8/8/3k4/8/P7/8/8/K7 w - - 0 1')
  assert.ok(pushes)
  assert.equal(pushes.move.piece, 'p')

  // Twice over, the same answer: a drill has to replay identically.
  const first = defenceReply(entry('8/8/8/4k3/8/8/8/4K2Q w - - 0 1', 'w'), '8/8/8/4k3/8/4K3/8/7Q b - - 1 1')
  const again = defenceReply(entry('8/8/8/4k3/8/8/8/4K2Q w - - 0 1', 'w'), '8/8/8/4k3/8/4K3/8/7Q b - - 1 1')
  assert.ok(first && again)
  assert.equal(first.move.uci, again.move.uci)
  assert.equal(first.source, 'rule')
  assert.ok(first.why.length > 10)
  assert.ok(DEFENCE_RULES.length >= 5)
})

test('an authored reply is used where it is written, and the rule takes over elsewhere', () => {
  const fen = '8/8/8/4k3/8/4K3/8/7Q b - - 1 1'
  const entry: EndgameEntry = {
    id: 'test-authored', theme: 'basic-mate', title: 'Test', fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', sideToMove: 'w',
    objective: { kind: 'win' }, method: 'A position used only to test the authored defence.', difficulty: 1,
    provenance: 'Written for this test.',
    defence: [{ fen, play: 'Kf6', why: 'The defending king goes where the author said.' }]
  }
  const written = defenceReply(entry, fen)
  assert.ok(written)
  assert.equal(written.source, 'authored')
  assert.equal(written.move.san, 'Kf6')
  // A position the author said nothing about still gets an answer.
  const elsewhere = defenceReply(entry, '8/8/8/3k4/8/4K3/8/7Q b - - 1 1')
  assert.ok(elsewhere)
  assert.equal(elsewhere.source, 'rule')
})

// ---------------------------------------------------------------- the drill

const mateDrill: EndgameEntry = {
  id: 'test-mate-two',
  theme: 'basic-mate',
  title: 'Two rooks',
  fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1',
  sideToMove: 'w',
  objective: { kind: 'mate-in', moves: 2 },
  method: 'A drill used to test the runner.',
  difficulty: 1,
  provenance: 'Written for this test.'
}

test('an illegal move changes nothing and says so', () => {
  const start = startDrill(mateDrill)
  const out = drillMove(mateDrill, start, 'Qd8')
  assert.equal(out.accepted, false)
  assert.equal(out.state, start)
  assert.match(out.feedback, /cannot be played/)
})

test('a drill is finished by mating, and the count is the learner own moves', () => {
  let state = startDrill(mateDrill)
  const first = drillMove(mateDrill, state, 'Rg5')
  assert.equal(first.accepted, true)
  state = first.state
  assert.equal(state.status, 'playing')
  assert.equal(state.moves.length, 2, 'the learner move and the defence answer')
  assert.equal(state.moves[1].by, 'defence')
  assert.equal(state.moves[1].san, 'Kh7', 'the defence has only one move')
  const second = drillMove(mateDrill, state, 'Rh2')
  state = second.state
  assert.equal(state.status, 'achieved')
  assert.match(state.message, /Checkmate, in 2 moves/)
  // A finished drill takes no more moves.
  const after = drillMove(mateDrill, state, 'Rh5')
  assert.equal(after.accepted, false)
  assert.match(after.feedback, /over/)
})

test('a win thrown away is named for what was thrown away', () => {
  const stalemate: EndgameEntry = {
    id: 'test-stalemate', theme: 'basic-mate', title: 'Careful', fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
    sideToMove: 'w', objective: { kind: 'win' }, method: 'A drill used to test what happens when a win slips.',
    difficulty: 1, provenance: 'Written for this test.'
  }
  const out = drillMove(stalemate, startDrill(stalemate), 'Qf7')
  assert.equal(out.accepted, true)
  assert.equal(out.state.status, 'lost')
  assert.match(out.state.slip ?? '', /stalemate/)
  assert.match(out.state.slip ?? '', /drawn/)
})

test('a drill where the mate runs out of moves says the mate was there and has gone', () => {
  // A mate in one, not taken: after one of the learner's moves the claim cannot be met any more.
  const inOne: EndgameEntry = {
    id: 'test-mate-one', theme: 'basic-mate', title: 'One move', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    sideToMove: 'w', objective: { kind: 'mate-in', moves: 1 }, method: 'A drill used to test a missed mate.',
    difficulty: 1, provenance: 'Written for this test.'
  }
  const out = drillMove(inOne, startDrill(inOne), 'Ra7')
  assert.equal(out.state.status, 'lost')
  assert.match(out.state.slip ?? '', /mate was there in 1/)
})

test('a promotion drill is finished by promoting, not by playing a particular move', () => {
  const promote: EndgameEntry = {
    id: 'test-promote', theme: 'conversion', title: 'Through', fen: '8/1P6/1K6/8/8/8/8/7k w - - 0 1',
    sideToMove: 'w', objective: { kind: 'promote', moves: 1 }, method: 'A drill used to test promotion.',
    difficulty: 1, provenance: 'Written for this test.'
  }
  // A rook, not a queen, and by coordinates rather than notation: still a promotion.
  const out = drillMove(promote, startDrill(promote), 'b7b8r')
  assert.equal(out.state.status, 'achieved')
  assert.match(out.state.message, /pawn is through/)
})

test('a draw drill is held by the position, and giving the pawn a free run loses it', () => {
  const hold: EndgameEntry = {
    id: 'test-hold', theme: 'king-and-pawn', title: 'Hold', fen: '8/8/8/3k4/8/5P2/8/K7 b - - 0 1',
    sideToMove: 'b', objective: { kind: 'draw', holdMoves: 2, lostIf: 'opponent-promotes' },
    method: 'A drill used to test holding a draw.', difficulty: 1, provenance: 'Written for this test.'
  }
  let state = startDrill(hold)
  state = drillMove(hold, state, 'Ke5').state
  assert.equal(state.status, 'playing')
  state = drillMove(hold, state, 'Kf5').state
  // Two of the learner's own moves, nothing broken: that is what was asked for.
  assert.equal(state.status, 'achieved')
  assert.match(state.message, /held|Drawn/)
})

test('a technique drill ends when the job is done, and when the moves run out', () => {
  const place: EndgameEntry = {
    id: 'test-place', theme: 'rook', title: 'Cut it off', fen: '8/8/8/3k4/8/8/8/4K2R w - - 0 1', sideToMove: 'w',
    objective: { kind: 'technique', goal: { kind: 'piece-on', piece: 'r', squares: ['h4'] }, within: 1 },
    method: 'A drill used to test a placing job.', difficulty: 1, provenance: 'Written for this test.'
  }
  const done = drillMove(place, startDrill(place), 'Rh4')
  assert.equal(done.state.status, 'achieved')
  assert.match(done.state.message, /where it needed to be/)
  // Anything else uses up the one move the drill allows.
  const missed = drillMove(place, startDrill(place), 'Rh3')
  assert.equal(missed.state.status, 'lost')
  assert.match(missed.state.slip ?? '', /1 moves|all this one allows/)
})

test('the objective is judged from the position, not from following the line', () => {
  const entry: EndgameEntry = {
    id: 'test-judge', theme: 'basic-mate', title: 'Judge', fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1', sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 2 }, method: 'A drill used to test the judging.', difficulty: 1,
    provenance: 'Written for this test.', line: ['Rg5', 'Kh7', 'Rh2#']
  }
  // The other rook first: a different line to the written one, and the same mate.
  let state = startDrill(entry)
  state = drillMove(entry, state, 'Rf5').state
  state = drillMove(entry, state, 'Rh5').state
  assert.equal(state.status, 'achieved')
  const progress = progressOf(entry, state)
  assert.equal(objectiveMet(entry, state.fen, progress), true)
  assert.equal(objectiveLost(entry, state.fen, progress).lost, false)
})

test('a hint comes from the written line only while the drill is on it', () => {
  const entry: EndgameEntry = {
    id: 'test-hint', theme: 'basic-mate', title: 'Hint', fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1', sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 2 }, method: 'A drill used to test hints.', difficulty: 1,
    provenance: 'Written for this test.', line: ['Rg5', 'Kh7', 'Rh2#']
  }
  const start = startDrill(entry)
  assert.equal(hintFor(entry, start).san, 'Rg5')
  const onLine = drillMove(entry, start, 'Rg5').state
  assert.equal(hintFor(entry, onLine).san, 'Rh2#')
  const offLine = drillMove(entry, start, 'Rf5').state
  const hint = hintFor(entry, offLine)
  assert.equal(hint.san, undefined)
  assert.match(hint.text, /away from the written line/)
  // An ending with no line says that, rather than inventing one.
  assert.match(hintFor(mateDrill, startDrill(mateDrill)).text, /no written line/)
})

test('a written line is walked move by move and says where it stops', () => {
  const entry: EndgameEntry = {
    id: 'test-walk', theme: 'basic-mate', title: 'Walk', fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1', sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 2 }, method: 'A drill used to test walking a line.', difficulty: 1,
    provenance: 'Written for this test.', line: ['Rg5', 'Kh7', 'Rh2#']
  }
  const good = walkLine(entry, entry.line ?? [])
  assert.equal(good.failedAt, undefined)
  assert.equal(good.met, true)
  assert.equal(good.learnerMoves, 2)
  const bad = walkLine(entry, ['Rg5', 'Kh7', 'Rh9'])
  assert.equal(bad.failedAt, 2)
  assert.equal(bad.met, false)
})

// ---------------------------------------------------------------- the checker, on data that is wrong

const base: EndgameEntry = {
  id: 'test-base', theme: 'basic-mate', title: 'Base', fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1', sideToMove: 'w',
  objective: { kind: 'mate-in', moves: 2 }, method: 'A sound entry, used as the thing the broken ones differ from.',
  difficulty: 1, provenance: 'Written for this test, from the standard two-rook mate.'
}

test('a sound entry passes, and says what was proved', () => {
  const check = verifyEntry(base, SMALL)
  assert.equal(check.ok, true, check.problems.join(' '))
  assert.ok(check.proved.some((p) => /forced in exactly 2/.test(p)), check.proved.join(' | '))
  assert.equal(proofKind(base), 'searched')
  assert.match(PROOF_TEXT.searched, /every defence/)
})

test('a mate claim that is wrong is caught, in both directions', () => {
  const tooSlow = verifyEntry({ ...base, objective: { kind: 'mate-in', moves: 3 } }, SMALL)
  assert.equal(tooSlow.ok, false)
  assert.ok(tooSlow.problems.some((p) => /forced mate is in 2, not 3/.test(p)), tooSlow.problems.join(' '))
  const tooFast = verifyEntry({ ...base, objective: { kind: 'mate-in', moves: 1 } }, SMALL)
  assert.equal(tooFast.ok, false)
  assert.ok(tooFast.problems.some((p) => /forced mate is in 2, not 1/.test(p)), tooFast.problems.join(' '))
  // A position with no mate at all in the number claimed.
  const noMate = verifyEntry({ ...base, fen: '8/8/8/8/8/5k2/5P2/5K2 w - - 0 1', objective: { kind: 'mate-in', moves: 2 } }, SMALL)
  assert.equal(noMate.ok, false)
  assert.ok(noMate.problems.some((p) => /No forced mate/.test(p)), noMate.problems.join(' '))
})

test('a position that is not legal, or not reachable, is refused with the reason', () => {
  const broken = verifyEntry({ ...base, fen: 'this is not a position' }, SMALL)
  assert.equal(broken.ok, false)
  assert.match(broken.problems.join(' '), /not one a game could reach/)
  const unreachable = verifyEntry({ ...base, fen: '8/8/3k4/1PP5/8/8/8/K7 w - - 0 1', objective: { kind: 'win' } }, SMALL)
  assert.equal(unreachable.ok, false)
  assert.match(unreachable.problems.join(' '), /not to move is in check/)
})

test('an entry whose side to move disagrees with its position is refused', () => {
  const wrongSide = verifyEntry({ ...base, sideToMove: 'b' }, SMALL)
  assert.equal(wrongSide.ok, false)
  assert.ok(wrongSide.problems.some((p) => /to move/.test(p)), wrongSide.problems.join(' '))
})

test('an objective that is already met, or already gone, is refused', () => {
  const already = verifyEntry({
    ...base,
    objective: { kind: 'technique', goal: { kind: 'piece-on', piece: 'r', squares: ['f2'] } }
  }, SMALL)
  assert.equal(already.ok, false)
  assert.ok(already.problems.some((p) => /already met/.test(p)), already.problems.join(' '))
  // Nothing to promote, and nothing to catch.
  const noPawn = verifyEntry({ ...base, objective: { kind: 'promote' } }, SMALL)
  assert.ok(noPawn.problems.some((p) => /no pawn to promote/.test(p)), noPawn.problems.join(' '))
  const noRunner = verifyEntry({ ...base, objective: { kind: 'technique', goal: { kind: 'no-pawns' } } }, SMALL)
  assert.ok(noRunner.problems.some((p) => /no pawn to catch/.test(p)), noRunner.problems.join(' '))
})

test('a method that rambles, an empty provenance and a silly difficulty are all refused', () => {
  const rambling = verifyEntry({ ...base, method: 'One. Two. Three. Four.' }, SMALL)
  assert.ok(rambling.problems.some((p) => /sentences/.test(p)), rambling.problems.join(' '))
  const unfinished = verifyEntry({ ...base, method: 'A sentence that never finishes properly' }, SMALL)
  assert.ok(unfinished.problems.some((p) => /finish its sentence/.test(p)), unfinished.problems.join(' '))
  const anonymous = verifyEntry({ ...base, provenance: '  ' }, SMALL)
  assert.ok(anonymous.problems.some((p) => /provenance/.test(p)), anonymous.problems.join(' '))
  const silly = verifyEntry({ ...base, difficulty: 9 as never }, SMALL)
  assert.ok(silly.problems.some((p) => /difficulty/.test(p)), silly.problems.join(' '))
  const badId = verifyEntry({ ...base, id: 'Not An Id' }, SMALL)
  assert.ok(badId.problems.some((p) => /lower-case/.test(p)), badId.problems.join(' '))
})

test('a defensive reply that cannot be played where it is written is caught', () => {
  const wrong = verifyEntry({
    ...base,
    defence: [{ fen: '7k/8/8/6R1/8/8/5R2/6K1 b - - 1 1', play: 'Qa1', why: 'A move Black does not have.' }]
  }, SMALL)
  assert.equal(wrong.ok, false)
  assert.ok(wrong.problems.some((p) => /cannot be played/.test(p)), wrong.problems.join(' '))
  // A reply written for a position where it is the learner's turn is a different mistake, and named differently.
  const mixedUp = verifyEntry({
    ...base,
    defence: [{ fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1', play: 'Rg7', why: 'The wrong side entirely.' }]
  }, SMALL)
  assert.ok(mixedUp.problems.some((p) => /learner/.test(p)), mixedUp.problems.join(' '))
})

test('a line that does not reach the objective is not a line', () => {
  const short = verifyEntry({ ...base, line: ['Rg5'] }, SMALL)
  assert.equal(short.ok, false)
  assert.ok(short.problems.some((p) => /does not reach the objective/.test(p)), short.problems.join(' '))
  const illegal = verifyEntry({ ...base, line: ['Rg5', 'Kh7', 'Rh9'] }, SMALL)
  assert.ok(illegal.problems.some((p) => /stops being legal/.test(p)), illegal.problems.join(' '))
})

test('two entries that are the same id or the same position are caught between them', () => {
  const twice = verifyCatalogue([base, { ...base, title: 'Again' }], SMALL)
  assert.ok(twice.problems.some((p) => /used more than once/.test(p)), twice.problems.join(' '))
  assert.ok(twice.problems.some((p) => /same position/.test(p)), twice.problems.join(' '))
  assert.equal(twice.authored, 2)
})

test('what an ending asks for is said in words that name the side and the job', () => {
  assert.match(objectiveText(base), /^You are White\. Force checkmate in 2 moves\.$/)
  assert.match(objectiveText({ ...base, objective: { kind: 'win' } }), /Checkmate the defending king/)
  assert.match(objectiveText({ ...base, objective: { kind: 'draw', holdMoves: 4 } }), /Hold the draw for 4/)
  assert.match(objectiveText({ ...base, objective: { kind: 'draw', holdMoves: 1, forcedIn: 1 } }), /Force a drawn position in 1 move/)
  assert.match(objectiveText({ ...base, objective: { kind: 'promote' } }), /end of the board/)
  assert.match(
    objectiveText({ ...base, objective: { kind: 'technique', goal: { kind: 'king-on', squares: ['d6', 'e6', 'f6'] }, within: 3 } }),
    /d6, e6 or f6.*within 3 moves/
  )
})
