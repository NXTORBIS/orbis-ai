import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove, destinationsFrom, legalMoves, outcome, sideToMove } from './rules.ts'
import { fenAt, movePairs } from './model.ts'
import {
  COMMENTARY_IS, EMPTY_FILTER, FAMOUS_COMMENTARY_TAG, FAMOUS_ID_TAG, FAMOUS_SOURCE_TAG, FAMOUS_TAG,
  MATCH_IS_NOT_CORRECT, MODERN_ANALYSIS_IS, MOVES_ARE, PERIODS, THEMES, THEME_LABEL,
  checkCollection, checkFamousGame, describeFamousFilter, famousById, famousFacets, famousLine,
  famousMovesToStore, famousFromStored, famousPositions, famousSearchText, famousTitle, famousToStored,
  fenBefore, filterFamous, filterIsEmpty, guidedFen, guidedPoint, guidedProgress, judgeGuided, matchesFamous,
  guidedSince, periodOf, playersOf, provenanceOf, recordGuided, replayFamous, showGuided, sortFamous,
  startGuided, storedCopyOf, writeMoveList, type FamousGame
} from './famous.ts'
import { FAMOUS_GAMES } from './famousData.ts'

/**
 * The collection, proved.
 *
 * ## What a test can and cannot do here
 *
 * It cannot tell whether these are really the moves Anderssen played in 1851. Nothing in a program can: that is a
 * fact about the world, and the only honest answer is the provenance note on each game.
 *
 * What it can do is prove the data is a real game and that it agrees with itself, which is exactly where typing a
 * hundred-odd moves by hand goes wrong. Every move is replayed through `rules.ts` from the ordinary starting
 * position; every move's notation is compared with the notation the rules write for that same move, so a knight
 * capture that needed a disambiguating letter is caught; and the ending each game claims is checked against the
 * position it actually finishes in, so a move list that is one move short of a mate cannot pass.
 *
 * A game that fails one of these is a typo. It gets fixed or it comes out of the collection.
 *
 * ## The claims in the prose are checked too
 *
 * A few of the notes say something checkable -- that one game contains the only en passant capture in the
 * collection, that castling would also have mated in the Lasker game, that a particular last move forks two pieces.
 * Those are asserted below. A sentence of commentary nobody can check is an opinion and is written as one; a
 * sentence that can be checked is checked, because otherwise it is just a nicer-sounding invention.
 */

const byId = (id: string): FamousGame => {
  const game = famousById(FAMOUS_GAMES, id)
  assert.ok(game, `${id} is not in the collection`)
  return game
}

// ---------------------------------------------------------------- the collection as a whole

test('the collection is small, as the licensing reason for it requires', () => {
  assert.ok(FAMOUS_GAMES.length >= 10, `only ${FAMOUS_GAMES.length} games`)
  assert.ok(FAMOUS_GAMES.length <= 20, `${FAMOUS_GAMES.length} games is more than this can be checked by hand`)
})

test('every game in the collection verifies', () => {
  const report = checkCollection(FAMOUS_GAMES)
  const broken = report.games.filter((one) => !one.ok)
  assert.deepEqual(
    broken.map((one) => `${one.id}: ${one.problems.map((p) => p.message).join(' | ')}`),
    [],
    'a game that does not verify is a typo in famousData.ts, not a game'
  )
  assert.deepEqual(report.problems, [])
  assert.equal(report.verified, report.total)
  assert.equal(report.total, FAMOUS_GAMES.length)
})

test('ids are unique, which is what the library copy is looked up by', () => {
  const ids = FAMOUS_GAMES.map((game) => game.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${id} should be a plain slug`)
})

test('every game replays from the starting position and every single move is legal', () => {
  let moves = 0
  for (const game of FAMOUS_GAMES) {
    // Deliberately not through replayFamous: this walks the moves itself, so the test does not depend on the
    // module under test being right about what it replayed.
    let fen = START_FEN
    for (const [index, san] of game.san.entries()) {
      const legal = legalMoves(fen)
      const made = applyMove(fen, san)
      assert.ok(made, `${game.id}: move ${index + 1} "${san}" is not legal in ${fen}`)
      assert.ok(legal.some((one) => one.uci === made.uci), `${game.id}: move ${index + 1} is not in the list of legal moves`)
      assert.equal(made.san, san, `${game.id}: move ${index + 1} is written "${san}" but the rules write it "${made.san}"`)
      fen = made.after
      moves += 1
    }
    assert.ok(game.san.length >= 20, `${game.id} is too short to be one of these games`)
  }
  assert.ok(moves > 700, `only ${moves} moves checked`)
})

test('the ending each game claims is the ending the final position has', () => {
  for (const game of FAMOUS_GAMES) {
    const replay = replayFamous(game)
    assert.ok(replay.ok, game.id)
    const finalFen = replay.moves[replay.moves.length - 1].fen
    const state = outcome(finalFen, replay.moves.map((m) => m.san))
    if (game.ending === 'checkmate') {
      assert.ok(state.over && state.reason === 'checkmate', `${game.id} says checkmate and is not mate`)
      assert.equal(state.over ? state.result : '*', game.result, `${game.id}: the mate and the recorded result disagree`)
      assert.match(game.san[game.san.length - 1], /#$/, `${game.id}: a game that ends in mate should write the mate`)
    } else {
      assert.ok(!(state.over && state.reason === 'checkmate'), `${game.id} says it ended another way and the position is mate`)
      assert.doesNotMatch(game.san[game.san.length - 1], /#$/, `${game.id}: the last move is written as mate`)
    }
    if (game.ending === 'resignation') {
      const loser = game.result === '1-0' ? 'b' : 'w'
      assert.equal(sideToMove(finalFen), loser, `${game.id}: the side that resigned is not the side to move`)
    }
  }
})

test('every game is decisive in this collection, and says which way', () => {
  for (const game of FAMOUS_GAMES) {
    assert.ok(game.result === '1-0' || game.result === '0-1', `${game.id} has result ${game.result}`)
  }
})

// ---------------------------------------------------------------- provenance

test('every game carries the provenance that the whole collection rests on', () => {
  for (const game of FAMOUS_GAMES) {
    const p = provenanceOf(game)
    assert.equal(p.moves, MOVES_ARE)
    assert.equal(p.commentary, COMMENTARY_IS)
    assert.equal(p.modernAnalysis, MODERN_ANALYSIS_IS)
    assert.ok(p.unstated.length >= 1, `${game.id} says nothing about what it does not know`)
    for (const line of p.unstated) assert.ok(line.trim().length > 8, `${game.id} has an empty "unstated" entry`)
  }
})

test('nothing is filled in with a placeholder standing for a fact', () => {
  for (const game of FAMOUS_GAMES) {
    for (const player of [game.white, game.black]) {
      if (player.name !== undefined) {
        assert.ok(player.name.trim().length > 0, `${game.id} has an empty name`)
        assert.doesNotMatch(player.name.trim(), /^(unknown|nn|n\.n\.|anonymous|tbd|\?+|-+)$/i, `${game.id}: "${player.name}" is a placeholder, not a name`)
      }
      // No ratings and no titles anywhere: Orbis has not checked a single one of them.
      assert.equal(player.rating, undefined, `${game.id} carries a rating`)
      assert.equal(player.title, undefined, `${game.id} carries a title`)
    }
    assert.ok(game.note.trim().length > 80, `${game.id} has almost nothing written about it`)
    for (const field of [game.event, game.site, game.round]) {
      if (field !== undefined) assert.ok(field.trim().length > 0, `${game.id} has an empty field`)
    }
  }
})

test('every game has a year inside the range the checker accepts', () => {
  for (const game of FAMOUS_GAMES) {
    assert.ok(game.year !== undefined, `${game.id} has no year`)
    assert.ok((game.year ?? 0) >= 1475 && (game.year ?? 0) <= 2100, `${game.id}: ${game.year}`)
  }
})

test('themes come from the closed list, and every theme has words for it', () => {
  for (const game of FAMOUS_GAMES) {
    assert.ok(game.themes.length >= 1, `${game.id} has no theme`)
    for (const theme of game.themes) {
      assert.ok(THEMES.includes(theme), `${game.id}: ${theme}`)
      assert.ok(THEME_LABEL[theme].length > 0)
    }
    assert.equal(new Set(game.themes).size, game.themes.length, `${game.id} repeats a theme`)
  }
})

// ---------------------------------------------------------------- the checker itself

test('the checker catches an illegal move rather than letting it through', () => {
  const game = { ...byId('opera-1858'), san: ['e4', 'e5', 'Nf3', 'Nf6', 'Qh5'] as string[] }
  const check = checkFamousGame(game)
  assert.equal(check.ok, false)
  assert.ok(check.problems.some((p) => p.code === 'illegal-move'), JSON.stringify(check.problems))
})

test('the checker catches a legal move written the wrong way', () => {
  // "Ng1f3" is the same move as "Nf3" and is not how the rules write it. A file full of these replays fine and is
  // still wrong, and the move list is the one thing in this collection that has to be exactly right.
  const real = byId('opera-1858')
  const check = checkFamousGame({ ...real, san: ['e4', 'e5', 'Ng1f3', ...real.san.slice(3)] })
  assert.ok(check.problems.some((p) => p.code === 'not-canonical'), JSON.stringify(check.problems))
})

test('the checker catches a game that claims a mate it does not have', () => {
  const real = byId('immortal-1851')
  const check = checkFamousGame({ ...real, san: real.san.slice(0, real.san.length - 1) })
  assert.ok(check.problems.some((p) => p.code === 'ending-not-checkmate'), JSON.stringify(check.problems))
})

test('the checker catches a mate recorded with the wrong result', () => {
  const check = checkFamousGame({ ...byId('immortal-1851'), result: '0-1' })
  assert.ok(check.problems.some((p) => p.code === 'result-disagrees'), JSON.stringify(check.problems))
})

test('the checker catches a resignation where the loser was not to move', () => {
  const real = byId('kasparov-topalov-1999')
  const check = checkFamousGame({ ...real, result: '0-1' })
  assert.ok(check.problems.some((p) => p.code === 'loser-not-to-move'), JSON.stringify(check.problems))
})

test('the checker catches a question that gives the move away', () => {
  const real = byId('opera-1858')
  const answer = real.san[18]
  const check = checkFamousGame({ ...real, guided: [{ ply: 19, ask: `Play ${answer} here.`, afterward: 'x' }] })
  assert.ok(check.problems.some((p) => p.code === 'guided-gives-it-away'), JSON.stringify(check.problems))
})

test('the checker catches a guided point that is not in the game', () => {
  const real = byId('opera-1858')
  const check = checkFamousGame({ ...real, guided: [{ ply: 900, ask: 'Find it.', afterward: 'x' }] })
  assert.ok(check.problems.some((p) => p.code === 'guided-out-of-range'), JSON.stringify(check.problems))
})

test('the checker catches a duplicate id across the collection', () => {
  const one = byId('opera-1858')
  const report = checkCollection([one, { ...one }])
  assert.ok(report.problems.some((p) => p.code === 'duplicate-id'), JSON.stringify(report.problems))
})

// ---------------------------------------------------------------- positions

test('the positions of a game line up with the moves, and the last one is the final position', () => {
  for (const game of FAMOUS_GAMES) {
    const positions = famousPositions(game)
    assert.equal(positions.length, game.san.length + 1, game.id)
    assert.equal(positions[0], START_FEN, game.id)
    const replay = replayFamous(game)
    assert.equal(positions[positions.length - 1], replay.moves[replay.moves.length - 1].fen, game.id)
    // The same walk the screen does, through the model's own helper, so the two cannot drift apart.
    assert.equal(fenAt({ startFen: START_FEN, moves: replay.moves }, 0), positions[0], game.id)
    assert.equal(fenAt({ startFen: START_FEN, moves: replay.moves }, game.san.length), positions[positions.length - 1], game.id)
  }
})

test('the position a move was played in is the position before it', () => {
  const game = byId('opera-1858')
  assert.equal(fenBefore(game, 1), START_FEN)
  const positions = famousPositions(game)
  for (let ply = 1; ply <= game.san.length; ply += 1) {
    assert.equal(fenBefore(game, ply), positions[ply - 1])
    assert.ok(applyMove(fenBefore(game, ply), game.san[ply - 1]), `move ${ply} should be legal in the position before it`)
  }
  // Out of range is clamped rather than throwing: a screen that asks for ply 0 or ply 500 gets a real position.
  assert.equal(fenBefore(game, 0), START_FEN)
  assert.equal(fenBefore(game, 9_000), positions[positions.length - 1])
})

test('a move list pairs up into numbered rows the way the move list shows it', () => {
  const game = byId('opera-1858')
  const rows = movePairs({ startFen: START_FEN, moves: famousMovesToStore(game) })
  assert.equal(rows[0].number, 1)
  assert.equal(rows[0].white?.san, 'e4')
  assert.equal(rows[0].black?.san, 'e5')
  assert.equal(rows[rows.length - 1].white?.san, 'Rd8#')
  assert.equal(rows[rows.length - 1].black, undefined)
})

// ---------------------------------------------------------------- the claims the prose makes

test('the one en passant capture the collection claims is the only one in it', () => {
  const found: string[] = []
  for (const game of FAMOUS_GAMES) {
    for (const [index, move] of replayFamous(game).moves.entries()) {
      // `special: 'e'` is how the rules mark an en passant capture; nothing here guesses from the notation.
      const made = applyMove(fenBefore(game, index + 1), move.san)
      if (made?.special === 'e') found.push(`${game.id}:${index + 1}`)
    }
  }
  assert.deepEqual(found, ['zukertort-blackburne-1883:43'], 'the note on that game says it is the only one')
})

test('castling would also have mated in the Lasker game, as the note says', () => {
  const game = byId('lasker-thomas-1912')
  const fen = fenBefore(game, game.san.length)
  const played = applyMove(fen, game.san[game.san.length - 1])
  assert.ok(played?.checkmate, 'the move that was played mates')
  const castled = applyMove(fen, 'O-O-O')
  assert.ok(castled, 'queenside castling is legal in that position')
  assert.ok(castled.checkmate, 'and it mates as well, which is what the note claims')
})

test('the last move of the Reti game forks the two pieces the note names', () => {
  const game = byId('reti-alekhine-1925')
  const fen = fenBefore(game, game.san.length)
  const made = applyMove(fen, game.san[game.san.length - 1])
  assert.ok(made)
  // What the knight attacks from where it landed, asked of the rules rather than worked out here.
  const attacks = destinationsFrom(made.after, made.to)
  assert.equal(attacks.length, 0, 'it is Black who just moved, so the knight has no moves to list yet')
  const after = made.after.replace(/ w /, ' b ')
  const targets = destinationsFrom(after, made.to).map((one) => one.to)
  assert.ok(targets.includes('f3'), 'the bishop on f3')
  assert.ok(targets.includes('e2'), 'the rook on e2')
})

test('the three games the notes call short or long are the lengths they claim', () => {
  // "Seventeen moves" and "nineteen moves" are in the prose, so they are checked.
  assert.equal(Math.ceil(byId('opera-1858').san.length / 2), 17)
  assert.equal(Math.ceil(byId('deepblue-kasparov-1997-g6').san.length / 2), 19)
  assert.equal(Math.ceil(byId('byrne-fischer-1956').san.length / 2), 41)
  assert.equal(Math.ceil(byId('kasparov-topalov-1999').san.length / 2), 44)
})

test('the Immortal Game ends with Black’s rooks untouched, as the note says', () => {
  const game = byId('immortal-1851')
  const replay = replayFamous(game)
  // A `GameMove` carries `san`, `uci` and `fen` and nothing else, so which side moved and what it moved have to be
  // worked out here. This line used to read `move.color` and `move.piece`, which do not exist on a `GameMove`: the
  // comparison was `undefined === 'b'` on every move, so the loop could not fail and proved nothing. Strip-only
  // TypeScript does not typecheck a test as it runs it, which is why it sat here passing.
  replay.moves.forEach((move, ply) => {
    const black = ply % 2 === 1
    // A rook moves under its own name, and also when a side castles.
    const movedARook = move.san.startsWith('R') || move.san.startsWith('O-O')
    assert.ok(!(black && movedARook), `a black rook moved on ply ${ply + 1}: ${move.san}`)
  })
  const final = replay.moves[replay.moves.length - 1].fen
  assert.match(final.split(' ')[0], /^r1bk3r/, 'both black rooks are still on a8 and h8')
})

// ---------------------------------------------------------------- the guided mode

test('every guided point asks about a move that really exists, in a position it is legal in', () => {
  let points = 0
  for (const game of FAMOUS_GAMES) {
    assert.ok(game.guided.length >= 1, `${game.id} has nothing to find`)
    for (const point of game.guided) {
      const fen = guidedFen(game, point)
      const answer = game.san[point.ply - 1]
      const made = applyMove(fen, answer)
      assert.ok(made, `${game.id} ply ${point.ply}: ${answer} is not legal in ${fen}`)
      assert.ok(point.ask.trim().length > 20, `${game.id} ply ${point.ply}: the question is too short to be a question`)
      assert.ok(point.afterward.trim().length > 20, `${game.id} ply ${point.ply}: nothing is said afterwards`)
      // The question must not contain the answer, in notation or as the destination square on its own.
      const bare = answer.replace(/[+#!?]/g, '')
      assert.ok(!point.ask.includes(bare), `${game.id} ply ${point.ply}: the question contains "${bare}"`)
      assert.ok(!point.ask.includes(made.to), `${game.id} ply ${point.ply}: the question names the square "${made.to}"`)
      points += 1
    }
  }
  assert.ok(points >= 40, `only ${points} guided points in the whole collection`)
})

test('the move that was played matches, whether it is typed as notation or as squares', () => {
  const game = byId('opera-1858')
  const point = game.guided[0]
  const answer = game.san[point.ply - 1]
  const made = applyMove(guidedFen(game, point), answer)
  assert.ok(made)
  for (const written of [answer, made.uci, ` ${answer} `]) {
    const verdict = judgeGuided(game, point, written)
    assert.equal(verdict.legal, true, written)
    assert.equal(verdict.matched, true, written)
    assert.equal(verdict.played, answer)
    assert.ok(verdict.says.includes(MATCH_IS_NOT_CORRECT), 'a match must never be called correct without the caveat')
  }
})

test('a different legal move is a different move, not a failure, and is never called wrong', () => {
  const game = byId('opera-1858')
  const point = game.guided[0]
  const fen = guidedFen(game, point)
  const answer = game.san[point.ply - 1]
  const other = legalMoves(fen).find((one) => one.san !== answer)
  assert.ok(other)
  const verdict = judgeGuided(game, point, other.san)
  assert.equal(verdict.legal, true)
  assert.equal(verdict.matched, false)
  assert.equal(verdict.guess, other.san)
  assert.equal(verdict.played, answer)
  assert.ok(verdict.says.includes(answer), 'it should say what was played')
  assert.ok(verdict.says.includes(MATCH_IS_NOT_CORRECT))
  assert.doesNotMatch(verdict.says, /wrong|incorrect|failed/i, 'a legal move that is not the game move is not wrong')
})

test('an illegal guess is told so, and nothing is counted', () => {
  const game = byId('opera-1858')
  const point = game.guided[0]
  const verdict = judgeGuided(game, point, 'Qh8')
  assert.equal(verdict.legal, false)
  assert.equal(verdict.matched, false)
  assert.equal(verdict.guess, undefined)
  assert.ok(verdict.says.includes('cannot be played'))
})

test('nothing in the guided mode ever says a move was correct', () => {
  for (const game of FAMOUS_GAMES) {
    for (const point of game.guided) {
      const answer = game.san[point.ply - 1]
      const verdict = judgeGuided(game, point, answer)
      assert.equal(verdict.matched, true, `${game.id} ply ${point.ply}`)
      assert.doesNotMatch(verdict.says, /\bcorrect\b/i, `${game.id} ply ${point.ply}: "${verdict.says}"`)
      assert.doesNotMatch(point.afterward, /\bcorrect\b/i, `${game.id} ply ${point.ply}`)
    }
  }
})

test('a run walks the marked points in order and stops at the end', () => {
  const game = byId('immortal-1851')
  let run = startGuided(game)
  assert.equal(run.gameId, game.id)
  const seen: number[] = []
  for (let i = 0; i < game.guided.length; i += 1) {
    const point = guidedPoint(game, run)
    assert.ok(point, `point ${i}`)
    seen.push(point.ply)
    const verdict = judgeGuided(game, point, game.san[point.ply - 1])
    run = recordGuided(game, run, { ply: point.ply, guess: game.san[point.ply - 1], matched: verdict.matched, shown: false })
  }
  assert.deepEqual(seen, game.guided.map((one) => one.ply))
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'the points come in the order they happen in the game')
  assert.equal(guidedPoint(game, run), null)
  const progress = guidedProgress(game, run)
  assert.equal(progress.done, true)
  assert.equal(progress.matched, game.guided.length)
  assert.equal(progress.shown, 0)
  assert.ok(progress.says.includes(MATCH_IS_NOT_CORRECT))
})

test('asking to be shown the move counts as shown, not as found', () => {
  const game = byId('immortal-1851')
  let run = startGuided(game)
  run = showGuided(game, run)
  assert.equal(run.answers.length, 1)
  assert.equal(run.answers[0].shown, true)
  assert.equal(run.answers[0].matched, false)
  assert.equal(run.answers[0].guess, null)
  const progress = guidedProgress(game, run)
  assert.equal(progress.matched, 0)
  assert.equal(progress.shown, 1)
  assert.ok(progress.says.includes('shown'))
})

test('showing past the end of a run changes nothing', () => {
  const game = byId('immortal-1851')
  let run = startGuided(game)
  for (let i = 0; i < game.guided.length; i += 1) run = showGuided(game, run)
  const before = run
  run = showGuided(game, run)
  assert.equal(run, before)
})

test('the moves between one question and the next are written out, so nobody is teleported', () => {
  const game = byId('kasparov-topalov-1999')
  let run = startGuided(game)
  const first = guidedSince(game, run)
  assert.equal(first.from, 0)
  assert.equal(first.to, game.guided[0].ply - 1)
  assert.ok(first.written.startsWith('1.e4 d6 2.d4'), first.written)
  assert.ok(first.written.endsWith(game.san[game.guided[0].ply - 2]), first.written)
  // Answering one and asking the next shows only what happened between them.
  run = recordGuided(game, run, { ply: game.guided[0].ply, guess: null, matched: false, shown: true })
  const second = guidedSince(game, run)
  assert.equal(second.from, game.guided[0].ply)
  assert.equal(second.to, game.guided[1].ply - 1)
  assert.ok(!second.written.includes('1.e4'), 'it should not repeat the opening')
  assert.ok(second.written.length > 0)
})

test('a move list starting on Black’s move says so the way notation does', () => {
  const game = byId('opera-1858')
  assert.equal(writeMoveList(game, 0, 4), '1.e4 e5 2.Nf3 d6')
  assert.equal(writeMoveList(game, 1, 4), '1...e5 2.Nf3 d6')
  assert.equal(writeMoveList(game, 2, 4), '2.Nf3 d6')
  assert.equal(writeMoveList(game, 4, 4), '', 'nothing between a ply and itself')
  assert.equal(writeMoveList(game, 10, 2), '', 'backwards is nothing, not a crash')
  assert.equal(writeMoveList(game, 0, 9_000).split(' ').length, Math.ceil(game.san.length / 2) + Math.floor(game.san.length / 2))
})

test('a game with no marked points says so rather than looking finished', () => {
  const game = { ...byId('opera-1858'), guided: [] }
  const progress = guidedProgress(game, startGuided(game))
  assert.equal(progress.points, 0)
  assert.equal(progress.done, false)
  assert.ok(progress.says.includes('no marked points'))
})

// ---------------------------------------------------------------- filters

test('periods are bands with the edges written down, and a missing year is not a period', () => {
  assert.equal(periodOf(1851), 'romantic')
  assert.equal(periodOf(1889), 'romantic')
  assert.equal(periodOf(1890), 'classical')
  assert.equal(periodOf(1945), 'classical')
  assert.equal(periodOf(1946), 'modern')
  assert.equal(periodOf(1990), 'modern')
  assert.equal(periodOf(1991), 'computer')
  assert.equal(periodOf(2026), 'computer')
  assert.equal(periodOf(undefined), null)
  assert.equal(periodOf(Number.NaN), null)
  // The bands must not overlap or leave a gap, or a game would be in two periods or none.
  for (let year = 1700; year <= 2100; year += 1) {
    const hits = PERIODS.filter((band) => (band.from === undefined || year >= band.from) && (band.to === undefined || year <= band.to))
    assert.equal(hits.length, 1, `${year} falls in ${hits.length} periods`)
  }
})

test('an empty filter hides nothing', () => {
  assert.equal(filterIsEmpty(EMPTY_FILTER), true)
  assert.equal(filterFamous(FAMOUS_GAMES, EMPTY_FILTER).length, FAMOUS_GAMES.length)
  assert.equal(describeFamousFilter(EMPTY_FILTER), 'Every game in the collection.')
  assert.equal(filterIsEmpty({ text: '   ' }), true, 'spaces are not a search')
})

test('the player filter finds a player on either colour and nobody else', () => {
  const anderssen = filterFamous(FAMOUS_GAMES, { player: 'Anderssen' })
  assert.equal(anderssen.length, 2)
  for (const game of anderssen) assert.ok(playersOf(game).some((name) => name.includes('Anderssen')))
  const fischer = filterFamous(FAMOUS_GAMES, { player: 'fischer' })
  assert.equal(fischer.length, 2, 'one as Black in 1956 and one as White in 1972')
  assert.deepEqual(fischer.map((g) => g.id).sort(), ['byrne-fischer-1956', 'fischer-spassky-1972-g6'])
  assert.equal(filterFamous(FAMOUS_GAMES, { player: 'Nobody At All' }).length, 0)
})

test('free text has to match every word, over players, nickname, place, year and theme', () => {
  assert.deepEqual(filterFamous(FAMOUS_GAMES, { text: 'opera' }).map((g) => g.id), ['opera-1858'])
  assert.deepEqual(filterFamous(FAMOUS_GAMES, { text: 'morphy paris' }).map((g) => g.id), ['opera-1858'])
  assert.equal(filterFamous(FAMOUS_GAMES, { text: 'morphy reykjavik' }).length, 0, 'both words have to appear')
  assert.ok(filterFamous(FAMOUS_GAMES, { text: '1851' }).length >= 1, 'the year is searchable')
  assert.ok(filterFamous(FAMOUS_GAMES, { text: 'LONDON' }).length >= 2, 'case does not matter')
})

test('a filter never hides a game it was not asked about', () => {
  for (const game of FAMOUS_GAMES) {
    assert.equal(matchesFamous(game, {}), true, game.id)
    assert.equal(matchesFamous(game, { result: game.result }), true, game.id)
    assert.equal(matchesFamous(game, { theme: game.themes[0] }), true, game.id)
    const period = periodOf(game.year)
    if (period) assert.equal(matchesFamous(game, { period }), true, game.id)
    for (const name of playersOf(game)) assert.equal(matchesFamous(game, { player: name }), true, `${game.id} / ${name}`)
    assert.ok(famousSearchText(game).includes((game.white.name ?? '').toLowerCase()))
  }
})

test('parts of a filter add up rather than replacing each other', () => {
  const both = filterFamous(FAMOUS_GAMES, { period: 'romantic', theme: 'queen-sacrifice' })
  for (const game of both) {
    assert.equal(periodOf(game.year), 'romantic')
    assert.ok(game.themes.includes('queen-sacrifice'))
  }
  const onlyPeriod = filterFamous(FAMOUS_GAMES, { period: 'romantic' })
  assert.ok(both.length < onlyPeriod.length, 'adding a theme should narrow it')
})

test('the facets only offer values the collection really has, with honest counts', () => {
  const facets = famousFacets(FAMOUS_GAMES)
  for (const facet of facets.themes) {
    assert.equal(facet.count, filterFamous(FAMOUS_GAMES, { theme: facet.value }).length, facet.value)
    assert.ok(facet.count > 0)
  }
  for (const facet of facets.periods) {
    assert.equal(facet.count, filterFamous(FAMOUS_GAMES, { period: facet.value }).length, facet.value)
  }
  for (const facet of facets.results) {
    assert.equal(facet.count, FAMOUS_GAMES.filter((g) => g.result === facet.value).length, facet.value)
  }
  for (const facet of facets.players) {
    assert.equal(facet.count, filterFamous(FAMOUS_GAMES, { player: facet.value }).length, facet.value)
  }
  assert.equal(facets.withoutYear, 0, 'every game in this collection has a year')
  // A theme no game has must not be offered: a filter button that finds nothing is a control that does nothing.
  const offered = new Set(facets.themes.map((one) => one.value))
  for (const theme of THEMES) {
    const has = FAMOUS_GAMES.some((game) => game.themes.includes(theme))
    assert.equal(offered.has(theme), has, theme)
  }
  assert.equal(facets.periods.map((one) => one.value).join(','), PERIODS.filter((b) => facets.periods.some((p) => p.value === b.id)).map((b) => b.id).join(','), 'periods stay in time order')
})

test('the filter says what it did, in words', () => {
  assert.equal(describeFamousFilter({ player: 'Morphy' }), 'Games played by Morphy.')
  assert.ok(describeFamousFilter({ period: 'romantic', theme: 'king-hunt' }).startsWith('Games from before 1890, about '))
  assert.ok(describeFamousFilter({ text: 'opera' }).includes('opera'))
})

test('sorting puts a game with no year last, whichever way round it is', () => {
  const noYear: FamousGame = { ...byId('opera-1858'), id: 'no-year', year: undefined }
  const games = [...FAMOUS_GAMES, noYear]
  assert.equal(sortFamous(games, 'year')[games.length - 1].id, 'no-year')
  assert.equal(sortFamous(games, 'year', true)[games.length - 1].id, 'no-year')
  const oldestFirst = sortFamous(FAMOUS_GAMES, 'year')
  assert.equal(oldestFirst[0].id, 'immortal-1851')
  assert.equal(sortFamous(FAMOUS_GAMES, 'year', true)[0].id, 'kasparov-topalov-1999')
  const byLength = sortFamous(FAMOUS_GAMES, 'length')
  assert.equal(byLength[0].id, 'opera-1858')
  assert.ok(byLength[0].san.length <= byLength[byLength.length - 1].san.length)
  assert.equal(sortFamous(FAMOUS_GAMES, 'title').length, FAMOUS_GAMES.length)
  // Sorting must not change the collection it was given.
  assert.equal(FAMOUS_GAMES[0].id, 'immortal-1851')
})

// ---------------------------------------------------------------- reading one out

test('a title and a line read correctly, and leave out what is not known', () => {
  const game = byId('opera-1858')
  assert.equal(famousTitle(game), 'Paul Morphy vs Duke of Brunswick and Count Isouard')
  assert.equal(famousLine(game), 'Paris · 1858 · 17 moves · 1-0')
  const bare: FamousGame = { ...game, site: undefined, year: undefined, result: '*' }
  assert.equal(famousLine(bare), '17 moves', 'nothing unknown is written as a dash or a blank')
  assert.equal(famousTitle({ ...game, white: {}, black: {} }), 'White vs Black')
})

// ---------------------------------------------------------------- opening one in the library

test('the library copy carries the whole game, the provenance and a tag that identifies it', () => {
  for (const game of FAMOUS_GAMES) {
    const payload = famousToStored(game)
    assert.equal(payload.source.kind, 'study', 'nobody played this on this computer and no file was imported')
    assert.equal(payload.startFen, START_FEN)
    assert.deepEqual(payload.tags, [FAMOUS_TAG])
    assert.equal(payload.meta.result, game.result)
    assert.equal(payload.meta.white.name, game.white.name)
    assert.equal(payload.meta.black.name, game.black.name)
    assert.equal(payload.meta.extra?.[FAMOUS_ID_TAG], game.id)
    assert.equal(payload.meta.extra?.[FAMOUS_SOURCE_TAG], 'historical record')
    assert.equal(payload.meta.extra?.[FAMOUS_COMMENTARY_TAG], 'Orbis')
    // A year on its own is a partial date, written as one rather than invented as a day.
    assert.equal(payload.meta.date, `${game.year}.??.??`)
    const moves = famousMovesToStore(game)
    assert.equal(moves.length, game.san.length, game.id)
    assert.deepEqual(moves.map((m) => m.san), [...game.san], game.id)
    assert.equal(moves[moves.length - 1].fen, famousPositions(game)[game.san.length], game.id)
  }
})

test('a broken game is never half saved', () => {
  const game = { ...byId('opera-1858'), san: ['e4', 'Qh5'] }
  assert.deepEqual(famousMovesToStore(game), [])
})

test('a library game is recognised as a copy, and nothing else is', () => {
  const game = byId('immortal-1851')
  const payload = famousToStored(game)
  assert.equal(famousFromStored({ tags: payload.tags, meta: payload.meta }), game.id)
  assert.equal(famousFromStored({ tags: [], meta: payload.meta }), null, 'the tag is what says it is one')
  assert.equal(famousFromStored({ tags: payload.tags, meta: { white: {}, black: {}, result: '*' } }), null)
  assert.equal(famousFromStored({ tags: undefined, meta: payload.meta }), null)
})

test('an existing copy is found rather than a second one being made', () => {
  const game = byId('immortal-1851')
  const payload = famousToStored(game)
  const library = [
    { id: 'something-else', tags: ['mine'], meta: { white: {}, black: {}, result: '*' as const } },
    { id: 'the-copy', tags: payload.tags, meta: payload.meta }
  ]
  assert.equal(storedCopyOf(library, game.id), 'the-copy')
  assert.equal(storedCopyOf(library, 'opera-1858'), null)
  assert.equal(storedCopyOf([], game.id), null)
})
