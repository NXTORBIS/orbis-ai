import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove, boardSquares, checkFen, positionKey } from './rules.ts'
import { buildMoves, fingerprintOf, type StoredGame } from './model.ts'
import { isLightSquare, materialOf } from './variants.ts'
import { recordFor } from './openings.ts'
import {
  DEFAULT_RULE, MATCH_RULES, MATERIAL_PATTERNS, buildIndex, keyFor, matchRule, matchesMaterial, materialOfFen,
  materialSignature, openingReach, openingSurvey, positionsOf, resultWords, ruleWords, scanGames, scanMaterial,
  searchIndex, searchMaterial, skippedWords, startIndex, startOpeningSurvey, stepIndex, stepOpeningSurvey,
  verifyIndex, walkGame, type MatchRuleId
} from './positionSearch.ts'

/**
 * What these prove.
 *
 * The four things the position search has to get right, and each of them is a thing a real database gets wrong:
 *
 *   1. **Exact means exact.** A board with the same pieces but a castling right missing, or a different en passant
 *      square, or the other side to move, is NOT a match. Those are different positions because different moves are
 *      legal in them.
 *   2. **Structural says what it let through.** Every loose rule carries its own list of what it ignores, applies
 *      exactly that, and can never be read as exact.
 *   3. **The index is not a second opinion.** It is checked against a full replay of every game through rules.ts,
 *      over every position in a fixture library and for every rule.
 *   4. **A record that cannot be read is reported, not searched.**
 *
 * Plus: the cheap material reader agrees with `materialOf` in variants.ts, which is the only thing that makes it
 * safe to count material without loading every position into the rules library.
 */

// ---------------------------------------------------------------------------------------------------------------
// A fixture library

const gameOf = (id: string, sans: string[], startFen: string = START_FEN): StoredGame => {
  const built = buildMoves(startFen, sans.map((san) => ({ san })))
  assert.ok(built.ok, `${id}: "${sans.join(' ')}" should be a legal line (stopped at ${built.failedAt?.move})`)
  return {
    id,
    profileId: 'person',
    source: { kind: 'import', importedAt: 1 },
    startFen,
    moves: built.moves,
    meta: { white: { name: `W-${id}` }, black: { name: `B-${id}` }, result: '*' },
    variant: 'standard',
    createdAt: 1,
    updatedAt: 1,
    fingerprint: fingerprintOf(startFen, built.moves)
  }
}

/** A rook ending, a queen against a bare king, and two bishop positions, as games with no moves yet. */
const ROOK_ENDING = '4k2r/8/8/8/8/8/8/R3K3 w - - 0 1'
const ROOK_AND_PAWN = '4k2r/8/8/8/8/8/4P3/R3K3 w - - 0 1'
const LONE_KING = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1'
const OPPOSITE_BISHOPS = '4k3/8/8/8/8/8/8/1B2K1b1 w - - 0 1'
const SAME_BISHOPS = '2b1k3/8/8/8/8/8/8/1B2K3 w - - 0 1'
const KNIGHT_AND_ROOKS = '4k2r/8/8/8/8/8/8/R3K1N1 w - - 0 1'

const library = (): StoredGame[] => [
  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 -- the Ruy Lopez, so the opening lookups have something real to find.
  gameOf('ruy', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']),
  // The Najdorf, which is a named position deep in a line.
  gameOf('najdorf', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']),
  // Knights out and back: the starting position occurs again at ply 4, which is what a repeat has to look like.
  gameOf('repeat', ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6']),
  // A different route to the same position as the Najdorf game at ply 4, so a transposition is in the library.
  gameOf('transposed', ['Nf3', 'd6', 'e4', 'c5', 'd4']),
  gameOf('rook-ending', [], ROOK_ENDING),
  gameOf('rook-and-pawn', [], ROOK_AND_PAWN),
  gameOf('lone-king', [], LONE_KING),
  gameOf('opposite-bishops', [], OPPOSITE_BISHOPS),
  gameOf('same-bishops', [], SAME_BISHOPS),
  gameOf('knight-and-rooks', [], KNIGHT_AND_ROOKS),
  gameOf('empty', [])
]

const after = (sans: string[], startFen: string = START_FEN): string => {
  let fen = startFen
  for (const san of sans) {
    const made = applyMove(fen, san)
    assert.ok(made, `${san} should be legal`)
    fen = made.after
  }
  return fen
}

/** The same board, with one field written differently. Used to prove the exact rule is not fooled. */
function withField(fen: string, which: 1 | 2 | 3, value: string): string {
  const f = fen.trim().split(/\s+/)
  f[which] = value
  return f.join(' ')
}

// ---------------------------------------------------------------------------------------------------------------
// The rules themselves

test('exactly one rule is exact, and every other one says what it ignores', () => {
  const exact = MATCH_RULES.filter((one) => one.exact)
  assert.equal(exact.length, 1, 'there must be one and only one exact rule')
  assert.equal(exact[0].id, 'exact')
  assert.equal(DEFAULT_RULE, 'exact', 'the default must be the honest one')
  for (const rule of MATCH_RULES) {
    assert.ok(rule.ignores.length > 0, `${rule.id} must say what it leaves out`)
    assert.ok(rule.counts.length > 0, `${rule.id} must say what it matches on`)
    assert.ok(rule.caution.length > 20, `${rule.id} must carry a sentence a screen can show`)
    if (!rule.exact) {
      assert.match(rule.caution, /not an exact match/i, `${rule.id} must say in words that it is not exact`)
    }
    assert.match(ruleWords(rule), rule.exact ? /^Exact: / : /^Structural: /)
  }
})

test('the exact rule is positionKey from rules.ts, not a second idea of the same position', () => {
  const fens = [
    START_FEN, ROOK_ENDING, LONE_KING, OPPOSITE_BISHOPS,
    after(['e4']), after(['e4', 'c5']), after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']),
    after(['Nf3', 'Nf6', 'Ng1', 'Ng8']), after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'])
  ]
  for (const fen of fens) {
    assert.equal(keyFor('exact', fen), positionKey(fen), fen)
  }
})

test('a position that cannot be read has no key, under every rule', () => {
  const broken = ['', '   ', 'not a fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq -', '9/8/8/8/8/8/8/8 w - -',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq -']
  for (const rule of MATCH_RULES) {
    for (const fen of broken) assert.equal(rule.keyOf(fen), null, `${rule.id} should refuse "${fen}"`)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// Exact matching

test('an exact search does NOT match a position with different castling rights', () => {
  const games = library()
  const index = buildIndex(games, 'exact')
  // After 1.Nf3, with every castling right intact.
  const real = after(['Nf3'])
  assert.equal(positionKey(real).split(' ')[2], 'KQkq')
  const found = searchIndex(index, real)
  assert.ok(found.hits.some((one) => one.gameId === 'repeat'), 'the real position must be found')

  // The same board, same side to move, same en passant square -- one castling right gone.
  const lost = withField(real, 2, 'Qkq')
  assert.equal(lost.split(' ')[0], real.split(' ')[0], 'the pieces must be identical for this test to mean anything')
  const exact = searchIndex(index, lost)
  assert.deepEqual(exact.hits, [], 'different castling rights is a different position')
  assert.equal(exact.exact, true)

  // And the structural rules do find it, which is exactly the difference being tested.
  const loose = searchIndex(buildIndex(games, 'placement-and-turn'), lost)
  assert.ok(loose.hits.some((one) => one.gameId === 'repeat'), 'ignoring castling rights must find it')
  assert.equal(loose.exact, false)
  assert.ok(loose.ignores.includes('the castling rights'))
})

test('an exact search does NOT match a different en passant square or a different side to move', () => {
  // 1.e4 d5 2.e5 f5 leaves a real en passant square: White's pawn on e5 can take on f6. A FEN only carries one
  // when the capture is actually available, which is why the line has to be this specific.
  const games = [gameOf('en-passant', ['e4', 'd5', 'e5', 'f5'])]
  const index = buildIndex(games, 'exact')
  const real = after(['e4', 'd5', 'e5', 'f5'])
  assert.equal(real.split(' ')[3], 'f6', 'this test needs a position with an en passant square')
  assert.ok(searchIndex(index, real).hits.length > 0)

  const noEp = withField(real, 3, '-')
  assert.deepEqual(searchIndex(index, noEp).hits, [], 'a different en passant square is a different position')
  assert.ok(
    searchIndex(buildIndex(games, 'placement-and-turn'), noEp).hits.length > 0,
    'the rule that ignores en passant must find it'
  )

  const otherTurn = withField(real, 1, 'b')
  assert.equal(real.split(' ')[1], 'w')
  assert.deepEqual(searchIndex(index, otherTurn).hits, [], 'the other side to move is a different position')
  assert.ok(
    searchIndex(buildIndex(games, 'placement'), otherTurn).hits.length > 0,
    'the rule that ignores whose turn it is must find it'
  )
})

test('a repeated position is one result naming every move it happened at', () => {
  const index = buildIndex(library(), 'exact')
  const found = searchIndex(index, START_FEN)
  const repeat = found.hits.find((one) => one.gameId === 'repeat')
  assert.ok(repeat, 'the knights-out-and-back game reaches the start again')
  assert.deepEqual(repeat.plies, [0, 4], 'before anything was played, and after the knights came back')
  assert.equal(repeat.ply, 0, 'the first occurrence is the one a screen opens at')
  // Every game that starts from the usual position is a hit at ply 0.
  const fromStart = library().filter((one) => one.startFen === START_FEN).map((one) => one.id).sort()
  assert.deepEqual(found.hits.map((one) => one.gameId).sort(), fromStart)
})

test('a transposition is found because the position is the same, not because the moves are', () => {
  const index = buildIndex(library(), 'exact')
  // 1.e4 c5 2.Nf3 d6 3.d4 and 1.Nf3 d6 2.e4 c5 3.d4 reach the same position by different move orders.
  const meeting = after(['e4', 'c5', 'Nf3', 'd6', 'd4'])
  assert.equal(meeting, after(['Nf3', 'd6', 'e4', 'c5', 'd4']), 'the two move orders must really meet')
  const found = searchIndex(index, meeting)
  assert.deepEqual(found.hits.map((one) => one.gameId).sort(), ['najdorf', 'transposed'])
  assert.deepEqual(found.hits.find((one) => one.gameId === 'najdorf')?.plies, [5])
  assert.deepEqual(found.hits.find((one) => one.gameId === 'transposed')?.plies, [5])
})

// ---------------------------------------------------------------------------------------------------------------
// Structural matching does what it says and no more

test('the pawn-structure rule compares the pawns and nothing else', () => {
  const rule = matchRule('pawns')
  assert.equal(rule.exact, false)
  assert.ok(rule.ignores.includes('every piece that is not a pawn'))
  // Two endings with identical pawns and completely different pieces.
  const withRooks = '4k2r/pp6/8/8/8/8/PP6/R3K3 w - - 0 1'
  const withQueens = '3qk3/pp6/8/8/8/8/PP6/3QK3 w - - 0 1'
  assert.ok(checkFen(withRooks).ok && checkFen(withQueens).ok)
  assert.equal(rule.keyOf(withRooks), rule.keyOf(withQueens), 'the same pawns is the same structure')
  assert.notEqual(keyFor('exact', withRooks), keyFor('exact', withQueens), 'and they are not the same position')
  // A pawn moved is a different structure.
  const moved = '4k2r/p1p5/8/8/8/8/PP6/R3K3 w - - 0 1'
  assert.notEqual(rule.keyOf(withRooks), rule.keyOf(moved))
})

test('the placement rule ignores the turn, the castling rights and the en passant square -- and only those', () => {
  const rule = matchRule('placement')
  const base = after(['e4'])
  assert.equal(rule.keyOf(base), rule.keyOf(withField(base, 1, 'w')))
  assert.equal(rule.keyOf(base), rule.keyOf(withField(base, 2, '-')))
  assert.equal(rule.keyOf(base), rule.keyOf(withField(base, 3, '-')))
  // It does not ignore where the pieces are.
  assert.notEqual(rule.keyOf(base), rule.keyOf(after(['d4'])))
})

test('a structural result carries its own warning, so it cannot be shown as exact', () => {
  const index = buildIndex(library(), 'pawns')
  const found = searchIndex(index, START_FEN)
  assert.equal(found.exact, false)
  assert.ok(found.ignores.length > 0)
  assert.match(found.caution, /not an exact match/i)
  assert.match(resultWords(found), /not an exact match/i)
  const exactResult = searchIndex(buildIndex(library(), 'exact'), START_FEN)
  assert.doesNotMatch(resultWords(exactResult), /not an exact match/i)
})

// ---------------------------------------------------------------------------------------------------------------
// The index against a full replay

const RULES: MatchRuleId[] = ['exact', 'placement', 'placement-and-turn', 'pawns']

test('the index gives the same answer as a full replay, for every position in the library and every rule', () => {
  const games = library()
  // Every position any game in the library reaches, plus a handful that nothing reaches.
  const probes = new Set<string>()
  for (const game of games) for (const { fen } of positionsOf(game)) probes.add(fen)
  for (const fen of [KNIGHT_AND_ROOKS, after(['d4', 'd5', 'c4']), withField(after(['Nf3']), 2, 'Qkq'), '8/8/8/8/8/8/8/K6k w - - 0 1']) {
    probes.add(fen)
  }
  assert.ok(probes.size > 30, `the fixture library should cover a useful number of positions, got ${probes.size}`)

  for (const rule of RULES) {
    const index = buildIndex(games, rule)
    for (const fen of probes) {
      const fast = searchIndex(index, fen)
      const slow = scanGames(games, fen, rule)
      assert.deepEqual(
        fast.hits.map((one) => ({ id: one.gameId, plies: one.plies })),
        slow.hits.map((one) => ({ id: one.gameId, plies: one.plies })),
        `${rule} disagreed about ${fen}`
      )
      assert.equal(fast.searched.positions, slow.searched.positions, `${rule} counted a different number of positions`)
      const check = verifyIndex(index, games, fen)
      assert.equal(check.agree, true, `${rule}: ${check.says}`)
      assert.match(check.says, /give the same/)
    }
  }
})

test('stepping the index in small chunks builds exactly what building it in one go builds', () => {
  const games = library()
  for (const rule of RULES) {
    const whole = buildIndex(games, rule)
    let build = startIndex(games, rule)
    let steps = 0
    while (!build.progress.done) {
      build = stepIndex(build, 2)
      steps += 1
      assert.ok(steps < 100, 'stepping must finish')
    }
    assert.equal(build.index.games, whole.games)
    assert.equal(build.index.positions, whole.positions)
    assert.equal(build.index.byKey.size, whole.byKey.size)
    for (const [key, places] of whole.byKey) {
      assert.deepEqual(build.index.byKey.get(key), places, `${rule}: ${key}`)
    }
    assert.ok(steps > 1, 'a chunk of two should have taken several steps')
  }
})

test('progress ends at done and reports the work it really did', () => {
  const games = library()
  const seen: { games: number; fraction: number | null; done: boolean }[] = []
  const index = buildIndex(games, 'exact', {
    chunk: 3,
    onProgress: (p) => seen.push({ games: p.games, fraction: p.fraction, done: p.done })
  })
  assert.equal(seen[0].games, 0)
  assert.equal(seen[seen.length - 1].done, true)
  assert.equal(seen[seen.length - 1].games, games.length)
  assert.equal(seen[seen.length - 1].fraction, 1)
  assert.equal(index.games, games.length)
  const expected = games.reduce((sum, one) => sum + one.moves.length + 1, 0)
  assert.equal(index.positions, expected, 'every position, counting each game’s starting position')
  // Nothing to read is not a fraction of nothing.
  assert.equal(startIndex([], 'exact').progress.fraction, null)
})

// ---------------------------------------------------------------------------------------------------------------
// A record that cannot be read

test('a damaged record is left out and listed, never indexed as if it were a position', () => {
  const games = library()
  const broken = gameOf('damaged', ['e4', 'e5', 'Nf3'])
  // The stored position after the second move is wrecked, the way a bad import could leave it.
  broken.moves = broken.moves.map((move, at) => (at === 1 ? { ...move, fen: 'this is not a board' } : move))
  const index = buildIndex([...games, broken], 'exact')
  assert.equal(index.skipped.length, 1)
  assert.equal(index.skipped[0].gameId, 'damaged')
  assert.equal(index.skipped[0].ply, 2)
  assert.match(index.skipped[0].why, /not a readable board/)
  assert.match(skippedWords(index.skipped) ?? '', /1 position in 1 game could not be read/)
  assert.equal(skippedWords([]), null)

  // The rest of that game is still searchable, and the skipped list travels with the answer.
  const found = searchIndex(index, after(['e4']))
  assert.ok(found.hits.some((one) => one.gameId === 'damaged'), 'the readable part of the game still answers')
  assert.equal(found.skipped.length, 1, 'a result says what it could not look at')
  // And the position it could not read is not claimed to be anywhere.
  assert.deepEqual(searchIndex(index, 'this is not a board').hits, [])
  assert.match(searchIndex(index, 'this is not a board').problem ?? '', /not a readable board/)
})

test('a game whose starting position cannot be read is reported and contributes nothing', () => {
  const broken = gameOf('bad-start', [])
  broken.startFen = '9/9/9 w - -'
  const index = buildIndex([broken], 'exact')
  assert.equal(index.positions, 0)
  assert.equal(index.skipped.length, 1)
  assert.match(index.skipped[0].why, /none of it could be searched/)
})

test('a replay stops at a move that will not play, and says so', () => {
  const game = gameOf('tampered', ['e4', 'e5', 'Nf3'])
  game.moves = game.moves.map((move, at) => (at === 1 ? { ...move, uci: 'a1a8', san: 'Ra8' } : move))
  const walked = walkGame(game, 'replay')
  assert.equal(walked.length, 3, 'the start, the first move, and the refusal')
  assert.equal(walked[2].fen, undefined)
  assert.match(walked[2].skip ?? '', /cannot be played in the position before it/)
  // Reading the stored positions instead keeps going, which is the difference between the two walks.
  assert.equal(walkGame(game, 'stored').filter((one) => one.fen !== undefined).length, 4)
})

// ---------------------------------------------------------------------------------------------------------------
// Counting material the cheap way, and agreeing with variants.ts

test('the cheap material reader agrees with materialOf over every position in the library', () => {
  const games = library()
  let checked = 0
  for (const game of games) {
    for (const { fen } of positionsOf(game)) {
      const mine = materialOfFen(fen)
      assert.ok(mine, fen)
      assert.deepEqual(mine, materialOf(boardSquares(fen)), fen)
      checked += 1
    }
  }
  for (const fen of [ROOK_ENDING, ROOK_AND_PAWN, LONE_KING, OPPOSITE_BISHOPS, SAME_BISHOPS, KNIGHT_AND_ROOKS,
    '3qk1b1/p1p5/8/8/8/8/PPP5/1B1QK2R w K - 0 1']) {
    assert.deepEqual(materialOfFen(fen), materialOf(boardSquares(fen)), fen)
    checked += 1
  }
  assert.ok(checked > 40, `should have compared a useful number of positions, got ${checked}`)
  assert.equal(materialOfFen('nonsense'), null)
})

/** A board with one bishop on it and nothing else, so the square it stands on is the only thing being measured. */
function oneBishopOn(square: string): string {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1])
  const rows: string[] = []
  for (let r = 8; r >= 1; r--) {
    if (r !== rank) { rows.push('8'); continue }
    const before = file
    const afterSquares = 7 - file
    rows.push(`${before > 0 ? before : ''}B${afterSquares > 0 ? afterSquares : ''}`)
  }
  return `${rows.join('/')} w - - 0 1`
}

test('a bishop is bucketed by its square the same way variants.ts buckets it, on all sixty-four squares', () => {
  // This is the one place the two files have to agree exactly, because a bishop in the wrong bucket turns an
  // opposite-coloured-bishop ending into a same-coloured one.
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const square = `${file}${rank}`
      const material = materialOfFen(oneBishopOn(square))
      assert.ok(material, square)
      assert.equal(material.w.lightBishops, isLightSquare(square) ? 1 : 0, square)
      assert.equal(material.w.darkBishops, isLightSquare(square) ? 0 : 1, square)
    }
  }
})

test('two bishops are in the same bucket or different ones, as the board says', () => {
  const opposite = materialOfFen(OPPOSITE_BISHOPS)
  assert.ok(opposite)
  assert.equal(opposite.w.lightBishops + opposite.w.darkBishops, 1)
  assert.equal(opposite.b.lightBishops + opposite.b.darkBishops, 1)
  assert.notEqual(opposite.w.lightBishops, opposite.b.lightBishops, 'they must be in different buckets')
  const same = materialOfFen(SAME_BISHOPS)
  assert.ok(same)
  assert.equal(same.w.lightBishops, same.b.lightBishops, 'these two must be in the same bucket')
})

test('two positions with the same men share a material signature', () => {
  const a = materialOfFen(ROOK_ENDING)
  const b = materialOfFen('R3k3/8/8/8/8/8/8/4K2r w - - 0 1')
  assert.ok(a && b)
  assert.equal(materialSignature(a), materialSignature(b), 'the men are the same even though the board is not')
  const c = materialOfFen(ROOK_AND_PAWN)
  assert.ok(c)
  assert.notEqual(materialSignature(a), materialSignature(c), 'a pawn changes the men')
})

// ---------------------------------------------------------------------------------------------------------------
// Material patterns

test('every offered pattern says what it asks for', () => {
  const ids = new Set<string>()
  for (const pattern of MATERIAL_PATTERNS) {
    assert.ok(!ids.has(pattern.id), `${pattern.id} is offered twice`)
    ids.add(pattern.id)
    assert.ok(pattern.label.length > 3)
    assert.ok(pattern.says.length > 20, `${pattern.id} must say what it means`)
  }
})

test('rook endings means rook endings: no queens, no knights, no bishops', () => {
  const rooks = MATERIAL_PATTERNS.find((one) => one.id === 'rook-endings')
  assert.ok(rooks)
  const yes = materialOfFen(ROOK_ENDING)
  const alsoYes = materialOfFen(ROOK_AND_PAWN)
  const no = materialOfFen(KNIGHT_AND_ROOKS)
  const oneRook = materialOfFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')
  assert.ok(yes && alsoYes && no && oneRook)
  assert.equal(matchesMaterial(yes, rooks), true)
  assert.equal(matchesMaterial(alsoYes, rooks), true, 'pawns are not counted')
  assert.equal(matchesMaterial(no, rooks), false, 'a knight on the board is not a rook ending')
  assert.equal(matchesMaterial(oneRook, rooks), false, 'both sides need a rook')
})

test('the either-side patterns do not care which colour is which', () => {
  const pattern = MATERIAL_PATTERNS.find((one) => one.id === 'rook-and-pawn-vs-rook')
  assert.ok(pattern)
  const whiteHasThePawn = materialOfFen(ROOK_AND_PAWN)
  const blackHasThePawn = materialOfFen('4k2r/4p3/8/8/8/8/8/R3K3 w - - 0 1')
  assert.ok(whiteHasThePawn && blackHasThePawn)
  assert.equal(matchesMaterial(whiteHasThePawn, pattern), true)
  assert.equal(matchesMaterial(blackHasThePawn, pattern), true)
  assert.equal(matchesMaterial(materialOfFen(ROOK_ENDING) as never, pattern), false, 'neither side has a pawn')
})

test('bishops on opposite colours is not the same question as a bishop each', () => {
  const opposite = MATERIAL_PATTERNS.find((one) => one.id === 'opposite-coloured-bishops')
  assert.ok(opposite)
  assert.equal(matchesMaterial(materialOfFen(OPPOSITE_BISHOPS) as never, opposite), true)
  assert.equal(matchesMaterial(materialOfFen(SAME_BISHOPS) as never, opposite), false)
  assert.equal(matchesMaterial(materialOfFen(ROOK_ENDING) as never, opposite), false, 'no bishops at all is not a bishop ending')
})

test('one side with nothing but a king, and seven men or fewer', () => {
  const lone = MATERIAL_PATTERNS.find((one) => one.id === 'lone-king')
  const few = MATERIAL_PATTERNS.find((one) => one.id === 'seven-men-or-fewer')
  assert.ok(lone && few)
  assert.equal(matchesMaterial(materialOfFen(LONE_KING) as never, lone), true)
  assert.equal(matchesMaterial(materialOfFen(ROOK_ENDING) as never, lone), false)
  assert.equal(matchesMaterial(materialOfFen(LONE_KING) as never, few), true, 'three men is seven or fewer')
  assert.equal(matchesMaterial(materialOfFen(START_FEN) as never, few), false, 'thirty-two is not')
})

test('the material index gives the same answer as a full replay', () => {
  const games = library()
  const index = buildIndex(games, 'exact')
  for (const pattern of MATERIAL_PATTERNS) {
    const fast = searchMaterial(index, pattern)
    const slow = scanMaterial(games, pattern)
    assert.deepEqual(
      fast.hits.map((one) => ({ id: one.gameId, plies: one.plies })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      slow.hits.map((one) => ({ id: one.gameId, plies: one.plies })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      `${pattern.id} disagreed`
    )
    assert.equal(fast.exact, false, 'a material search is never an exact position match')
    assert.ok(fast.tested <= index.positions, 'the point is that fewer sets of men are tested than positions')
  }
  // And the saving is real: far fewer sets of men than positions.
  assert.ok(index.byMaterial.size < index.positions, `${index.byMaterial.size} sets of men for ${index.positions} positions`)
})

test('a material search that finds nothing says so, with what was looked at', () => {
  const index = buildIndex([gameOf('only', ['e4', 'e5'])], 'exact')
  const queens = MATERIAL_PATTERNS.find((one) => one.id === 'queen-endings')
  assert.ok(queens)
  const found = searchMaterial(index, queens)
  assert.deepEqual(found.hits, [])
  assert.equal(found.matched, 0)
  assert.equal(found.searched.games, 1)
})

// ---------------------------------------------------------------------------------------------------------------
// Games that reached an opening

test('games that reached an opening are found by the opening’s own position', () => {
  const games = library()
  const index = buildIndex(games, 'exact')
  const najdorf = recordFor(after(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']))
  assert.ok(najdorf, 'the fixture line must really be a named opening')
  assert.equal(najdorf.eco, 'B90')
  const found = openingReach(index, najdorf)
  assert.deepEqual(found.hits.map((one) => one.gameId), ['najdorf'])
  assert.equal(found.exact, true)
  assert.equal(found.key, najdorf.key)

  const ruy = recordFor(after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']))
  assert.ok(ruy)
  assert.deepEqual(openingReach(index, ruy).hits.map((one) => one.gameId), ['ruy'])
})

test('an opening cannot be asked of a structural index, and says why instead of answering loosely', () => {
  const ruy = recordFor(after(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']))
  assert.ok(ruy)
  const loose = openingReach(buildIndex(library(), 'placement'), ruy)
  assert.deepEqual(loose.hits, [])
  assert.match(loose.problem ?? '', /exact position/)
  assert.match(loose.problem ?? '', /Build an index with the exact rule/)
})

test('the survey counts the deepest named opening of each game, and counts the unnamed as unnamed', () => {
  const survey = openingSurvey(library())
  assert.equal(survey.games, library().length)
  assert.ok(survey.source.licence.length > 0, 'the naming must be traceable to the dataset')
  const names = new Map(survey.counts.map((one) => [one.name, one.games]))
  // The two Sicilian games meet at the same position but the Najdorf game goes deeper, so they are named apart.
  assert.ok([...names.keys()].some((name) => name.includes('Najdorf')), `expected a Najdorf, got ${[...names.keys()].join(', ')}`)
  assert.ok([...names.keys()].some((name) => name.includes('Ruy Lopez')))
  // The games set up from an endgame position and the game with no moves have no opening at all.
  assert.ok(survey.unnamed >= 6, `expected the endgame fixtures to be unnamed, got ${survey.unnamed}`)
  assert.equal(survey.counts.reduce((sum, one) => sum + one.games, 0) + survey.unnamed, survey.games)
  // Ordered by how many games, so a list is useful without being sorted again.
  for (let i = 1; i < survey.counts.length; i++) {
    assert.ok(survey.counts[i - 1].games >= survey.counts[i].games)
  }
})

test('stepping the survey gives the same counts as running it in one go', () => {
  const games = library()
  const whole = openingSurvey(games)
  let build = startOpeningSurvey(games)
  while (!build.progress.done) build = stepOpeningSurvey(build, 1)
  assert.equal(build.survey.unnamed, whole.unnamed)
  assert.deepEqual(build.survey.counts, whole.counts)
  assert.equal(build.survey.games, whole.games)
})

test('the survey says how deep it looked rather than implying it looked everywhere', () => {
  const survey = openingSurvey(library(), { maxPly: 2 })
  assert.equal(survey.maxPly, 2)
  const deep = openingSurvey(library(), { maxPly: 60 })
  assert.equal(deep.maxPly, 60)
  // Looking two moves in cannot find a name that only appears at move five.
  assert.ok(!survey.counts.some((one) => one.name.includes('Najdorf')))
  assert.ok(deep.counts.some((one) => one.name.includes('Najdorf')))
})

// ---------------------------------------------------------------------------------------------------------------
// Words

test('a result says what it found, how much it looked at, and whether it was exact', () => {
  const index = buildIndex(library(), 'exact')
  const nothing = searchIndex(index, '8/8/8/8/8/8/8/K6k w - - 0 1')
  assert.match(resultWords(nothing), /No game of yours reached this, out of 11 searched/)
  const something = searchIndex(index, START_FEN)
  assert.match(resultWords(something), /games, \d+ times in all, out of 11 searched/)
  const broken = searchIndex(index, 'rubbish')
  assert.match(resultWords(broken), /not a readable board/)
})
