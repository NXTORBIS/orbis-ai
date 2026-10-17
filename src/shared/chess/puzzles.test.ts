import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judge, performanceOf, playMove, newAttempt, advance, type AttemptSession } from './attempt.ts'
import { validateExercise, type Exercise, type Provenance } from './exercise.ts'
import {
  CHECKABLE_THEMES, EMPTY_PUZZLE_FILTER, PUZZLE_STORE_VERSION, PUZZLE_THEMES, UNCHECKABLE_BECAUSE,
  addPuzzles, checkedThemes, counts, dailyFor, dailyStreak, dayKey, daysBetween, describePuzzleFilter,
  emptyStore, everSolved, filterIsEmpty, filterPuzzles, gameTag, hintsFor, isDay, isFact, missedPuzzles,
  newPuzzle, phaseOf, pickDaily, previousDay, provenanceWords, puzzleFacets, puzzleLine, readStore, readTheme,
  recentDays, recordAttempt, removePuzzle, statusOf, themeNames, verifyPuzzle, withoutPart, writeStore,
  type Puzzle, type PuzzleStore, type PuzzleTheme
} from './puzzles.ts'
import { START_RATING, standingOf } from './puzzleRating.ts'

/**
 * What a puzzle is, and the three things a screen cannot check for itself.
 *
 * ## The positions here are real
 *
 * Every position below is a legal position, and every mate claimed in a test is a mate `forcedMateTree` found by
 * searching the real rules. Nothing is a hand-written claim about a board.
 *
 *   - `BACK_RANK` -- `6k1/5ppp/8/8/8/8/5PPP/R5K1 w` -- Ra8 is mate, and it is the only mate.
 *   - `TWO_MATES` -- `6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w` -- Ra8 and Rd8 both mate.
 *   - `SMOTHERED` -- `6rk/6pp/7N/8/8/8/8/1K6 w` -- Nf7 is mate, with the king walled in by its own rook and pawns.
 *   - `FORK` -- `3q1r1k/8/8/2N5/8/8/8/4K3 w` -- Nc5-e6 attacks the queen on d8 and the rook on f8, and is not a check.
 *   - `HANGING` -- `3q3k/1N6/8/8/8/8/8/4K3 w` -- Nxd8 takes the queen and nothing can take back.
 *   - `UNDERPROMOTE` -- `8/5P1k/8/8/8/8/8/1K6 w` -- f8 can be reached as a queen, rook, bishop or knight.
 *
 * ## What is checked
 *
 * That a theme is never claimed as a fact unless it was proved; that a stored collection which cannot be read is
 * never written over; and that the daily challenge survives a restart, more puzzles being made, and a round trip
 * through storage.
 */

const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'
const TWO_MATES = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1'
const SMOTHERED = '6rk/6pp/7N/8/8/8/8/1K6 w - - 0 1'
const FORK = '3q1r1k/8/8/2N5/8/8/8/4K3 w - - 0 1'
const HANGING = '3q3k/1N6/8/8/8/8/8/4K3 w - - 0 1'
const UNDERPROMOTE = '8/5P1k/8/8/8/8/8/1K6 w - - 0 1'

const AUTHORED: Provenance = { kind: 'authored', by: 'the test' }
const NOW = 1_700_000_000_000

/** A mate puzzle, made and then checked the way the generator makes one. */
function mate(o: { id: string; fen: string; moves: number; lines: string[][]; rating?: number; themes?: string[]; source?: Provenance }): Puzzle {
  const nest = (line: string[]): { move: string; children?: { move: string }[] } =>
    line.length === 1 ? { move: line[0] } : { move: line[0], children: [nest(line.slice(1))] }
  const draft = newPuzzle({
    id: o.id,
    kind: 'puzzle',
    startFen: o.fen,
    objective: 'mate-in-n',
    movesToMate: o.moves,
    prompt: `Mate in ${o.moves}.`,
    solution: { lines: o.lines.map(nest) },
    source: o.source ?? AUTHORED,
    addedAt: NOW,
    ...(o.rating !== undefined ? { rating: o.rating } : {}),
    ...(o.themes ? { sourceThemes: o.themes, themesBy: 'the source' } : {})
  })
  return verifyPuzzle(draft, NOW).puzzle
}

function storeWith(puzzles: Puzzle[]): PuzzleStore {
  return addPuzzles(emptyStore(), puzzles).store
}

// ---------------------------------------------------------------- themes are claims with evidence

test('a proved mate earns the mate theme, its pattern and its length, and nothing else is invented', () => {
  const puzzle = mate({ id: 'br', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })
  assert.equal(puzzle.exercise.verification.status, 'verified')
  const names = themeNames(puzzle)
  assert.ok(names.includes('mate'))
  assert.ok(names.includes('back-rank-mate'))
  assert.ok(names.includes('one-move'))
  assert.ok(names.includes('endgame'), 'one rook and some pawns is counted as an endgame')
  // Every one of those is a fact except the two counted by convention.
  for (const claim of puzzle.themes) {
    if (claim.theme === 'endgame' || claim.theme === 'one-move') assert.equal(claim.evidence, 'convention')
    else assert.equal(claim.evidence, 'checked', `${claim.theme} should be checked`)
    assert.ok(claim.says.length > 0)
  }
  // And none of the themes that cannot be checked turned up anyway.
  assert.equal(names.includes('fork'), false)
  assert.equal(names.includes('double-check'), false)
  assert.equal(names.includes('sacrifice'), false)
})

test('a smothered mate is recognised, and is not called a back-rank mate', () => {
  const puzzle = mate({ id: 'sm', fen: SMOTHERED, moves: 1, lines: [['h6f7']] })
  assert.equal(puzzle.exercise.verification.status, 'verified')
  const names = themeNames(puzzle)
  assert.ok(names.includes('smothered-mate'))
  assert.equal(names.includes('back-rank-mate'), false)
})

test('a fork is claimed from what the piece really attacks, and only for a move that gives no check', () => {
  const draft = newPuzzle({
    id: 'fk',
    kind: 'puzzle',
    startFen: FORK,
    objective: 'find-best',
    prompt: 'White to play.',
    solution: { lines: [{ move: 'c5e6' }] },
    source: AUTHORED,
    addedAt: NOW
  })
  const { puzzle, check } = verifyPuzzle(draft, NOW)
  assert.equal(check.ok, true)
  const fork = puzzle.themes.find((one) => one.theme === 'fork')
  assert.ok(fork, 'the knight attacks the queen on d8 and the rook on f8')
  assert.equal(fork?.evidence, 'checked')
  assert.match(fork?.says ?? '', /d8/)
  assert.match(fork?.says ?? '', /f8/)
  // find-best is never settled by the rules, so the puzzle stays unverified and says what it needs.
  assert.equal(puzzle.exercise.verification.status, 'unverified')
  assert.equal(puzzle.exercise.verification.needs, 'engine')
})

test('a fork is not claimed when the move is a check, and the reason is written down', () => {
  // Nf7 from the smothered position is a check, so Orbis cannot see what else it attacks and says nothing.
  const draft = newPuzzle({
    id: 'fk2',
    kind: 'puzzle',
    startFen: SMOTHERED,
    objective: 'find-best',
    prompt: 'White to play.',
    solution: { lines: [{ move: 'h6f7' }] },
    source: AUTHORED,
    addedAt: NOW
  })
  const { puzzle } = verifyPuzzle(draft, NOW)
  assert.equal(themeNames(puzzle).includes('fork'), false)
})

test('a capture nothing can take back is called a hanging piece', () => {
  const draft = newPuzzle({
    id: 'hg',
    kind: 'puzzle',
    startFen: HANGING,
    objective: 'win-material',
    materialAtLeast: 900,
    prompt: 'White to play and win material.',
    solution: { lines: [{ move: 'b7d8' }] },
    source: AUTHORED,
    addedAt: NOW
  })
  const { puzzle, check } = verifyPuzzle(draft, NOW)
  assert.equal(check.ok, true)
  assert.equal(puzzle.exercise.verification.status, 'verified')
  const names = themeNames(puzzle)
  assert.ok(names.includes('hanging-piece'))
  assert.ok(names.includes('win-material'))
})

test('an underpromotion is only claimed when a queen was available on the same square', () => {
  const draft = newPuzzle({
    id: 'up',
    kind: 'puzzle',
    startFen: UNDERPROMOTE,
    objective: 'find-best',
    prompt: 'White to play.',
    solution: { lines: [{ move: 'f7f8n' }] },
    source: AUTHORED,
    addedAt: NOW
  })
  const { puzzle } = verifyPuzzle(draft, NOW)
  const names = themeNames(puzzle)
  assert.ok(names.includes('promotion'))
  assert.ok(names.includes('underpromotion'))
  assert.match(puzzle.themes.find((one) => one.theme === 'underpromotion')?.says ?? '', /a queen was available/)

  // Promote to a queen and the underpromotion claim goes away, while promotion stays.
  const queen = verifyPuzzle(newPuzzle({
    id: 'up2', kind: 'puzzle', startFen: UNDERPROMOTE, objective: 'find-best', prompt: 'x',
    solution: { lines: [{ move: 'f7f8q' }] }, source: AUTHORED, addedAt: NOW
  }), NOW).puzzle
  assert.ok(themeNames(queen).includes('promotion'))
  assert.equal(themeNames(queen).includes('underpromotion'), false)
})

test('a broken puzzle gets no themes at all', () => {
  // The position is a mate in one; claiming two is a fault, and a faulty puzzle is not described.
  const puzzle = mate({ id: 'wrong', fen: BACK_RANK, moves: 2, lines: [['a1a8']] })
  assert.equal(puzzle.exercise.verification.status, 'rejected')
  assert.equal(puzzle.themes.length, 0)
  const check = validateExercise(puzzle.exercise, NOW)
  assert.equal(checkedThemes(puzzle.exercise, check).length, 0)
})

test('a theme from a source stays a source claim, and a checked fact beats it', () => {
  const puzzle = mate({ id: 'src', fen: BACK_RANK, moves: 1, lines: [['a1a8']], themes: ['pin', 'Back Rank', 'mate'] })
  const pin = puzzle.themes.find((one) => one.theme === 'pin')
  assert.ok(pin, 'a pin Orbis cannot check is still kept, because the source said it')
  assert.equal(pin?.evidence, 'source')
  assert.equal(isFact(pin as never), false)
  assert.equal(pin?.by, 'the source')
  // The source also said mate and back rank; the check proved both, so those claims are now facts.
  assert.equal(puzzle.themes.find((one) => one.theme === 'mate')?.evidence, 'checked')
  assert.equal(puzzle.themes.find((one) => one.theme === 'back-rank-mate')?.evidence, 'checked')
  // A theme filter asking only for checked themes does not accept the source's word for the pin.
  assert.equal(themeNames(puzzle, true).includes('pin'), false)
  assert.equal(themeNames(puzzle, false).includes('pin'), true)
})

test('a theme name Orbis does not know is left out rather than guessed at', () => {
  assert.equal(readTheme('Back Rank'), 'back-rank-mate')
  assert.equal(readTheme('mateIn2'), 'mate')
  assert.equal(readTheme('en passant'), 'en-passant')
  assert.equal(readTheme('kingsideAttack'), null)
  assert.equal(readTheme(''), null)
  const puzzle = mate({ id: 'odd', fen: BACK_RANK, moves: 1, lines: [['a1a8']], themes: ['kingsideAttack', 'fork'] })
  assert.equal(themeNames(puzzle).includes('fork'), true)
  assert.equal(puzzle.themes.length, themeNames(puzzle).length)
})

test('every theme has a label and a meaning, and the ones that cannot be checked say why', () => {
  for (const theme of PUZZLE_THEMES) {
    assert.equal(typeof readTheme(theme), 'string', `${theme} should read back as itself`)
  }
  for (const theme of Object.keys(UNCHECKABLE_BECAUSE) as PuzzleTheme[]) {
    assert.equal(CHECKABLE_THEMES.includes(theme), false, `${theme} is listed as uncheckable and as checkable`)
    assert.ok((UNCHECKABLE_BECAUSE[theme] ?? '').length > 20)
  }
})

test('the phase convention says what it counted', () => {
  const endgame = phaseOf(BACK_RANK)
  assert.equal(endgame.theme, 'endgame')
  assert.match(endgame.says, /500 centipawns/)
  const opening = phaseOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  assert.equal(opening.theme, 'opening')
  assert.match(opening.says, /6200/)
})

// ---------------------------------------------------------------- hints

test('hints run 1, 2, 3 and the move comes last', () => {
  const puzzle = mate({ id: 'h1', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })
  const hints = hintsFor(puzzle.exercise, puzzle.themes)
  assert.deepEqual(hints.map((one) => one.level), hints.map((_one, i) => i + 1))
  assert.equal(hints[hints.length - 1].shows, 'move')
  assert.match(hints[0].text, /forced mate/)
  assert.ok(hints.some((one) => one.shows === 'target' && /check/.test(one.text)))
  assert.ok(hints.some((one) => one.shows === 'piece' && /rook on a1/.test(one.text)))
  assert.ok(hints.some((one) => one.shows === 'square' && /a8/.test(one.text)))
  assert.match(hints[hints.length - 1].text, /Ra8/)
  // The hints make a valid exercise: validateExercise refuses out-of-order levels and an early reveal.
  const withHints: Exercise = { ...puzzle.exercise, hints }
  assert.equal(validateExercise(withHints, NOW).ok, true)
})

test('a rung is left out when the answers do not agree about it, and the levels still run from one', () => {
  const puzzle = mate({ id: 'h2', fen: TWO_MATES, moves: 1, lines: [['a1a8'], ['d1d8']] })
  assert.equal(puzzle.exercise.verification.status, 'verified')
  const hints = hintsFor(puzzle.exercise, puzzle.themes)
  assert.deepEqual(hints.map((one) => one.level), hints.map((_one, i) => i + 1))
  // Both answers are rook moves, so the piece rung survives but without a square...
  assert.ok(hints.some((one) => one.shows === 'piece' && /Move a rook/.test(one.text)))
  // ...and the square rung is gone, because a8 and d8 are different squares.
  assert.equal(hints.some((one) => one.shows === 'square'), false)
  // The last rung names both answers rather than one of them.
  assert.match(hints[hints.length - 1].text, /Ra8/)
  assert.match(hints[hints.length - 1].text, /Rd8/)
  assert.equal(validateExercise({ ...puzzle.exercise, hints }, NOW).ok, true)
})

// ---------------------------------------------------------------- a correct alternative is correct

test('both recorded answers are accepted, in either order', () => {
  const puzzle = mate({ id: 'alt1', fen: TWO_MATES, moves: 1, lines: [['a1a8'], ['d1d8']] })
  for (const move of ['a1a8', 'd1d8']) {
    const verdict = judge(puzzle.exercise, [move])
    assert.equal(verdict.kind, 'solved', `${move} should be accepted`)
    if (verdict.kind === 'solved') assert.equal(verdict.viaRecordedLine, true)
  }
})

test('a mate the author never wrote down is still a solve, and is told so', () => {
  // Only Ra8 is recorded; Rd8 is just as much a mate.
  const puzzle = mate({ id: 'alt2', fen: TWO_MATES, moves: 1, lines: [['a1a8']] })
  assert.equal(puzzle.exercise.verification.status, 'verified')
  const verdict = judge(puzzle.exercise, ['d1d8'])
  assert.equal(verdict.kind, 'solved')
  if (verdict.kind === 'solved') {
    assert.equal(verdict.viaRecordedLine, false)
    assert.match(verdict.says, /not the line that was written down/)
  }
})

test('a legal move that is not the answer is told apart from one that cannot be played', () => {
  const puzzle = mate({ id: 'alt3', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })
  const wrong = judge(puzzle.exercise, ['a1a7'])
  assert.equal(wrong.kind, 'not-the-idea')
  if (wrong.kind === 'not-the-idea') assert.match(wrong.says, /legal move/)
  const impossible = judge(puzzle.exercise, ['a1h8'])
  assert.equal(impossible.kind, 'illegal')
  if (impossible.kind === 'illegal') assert.match(impossible.says, /cannot be played/)
})

// ---------------------------------------------------------------- the stored collection

test('nothing stored is not the same as something unreadable', () => {
  for (const nothing of [null, undefined, '', '   ']) {
    const read = readStore(nothing)
    assert.equal(read.kind, 'empty')
    if (read.kind === 'empty') assert.equal(read.store.puzzles.length, 0)
  }
})

test('a collection that cannot be read comes back as unreadable and is never written over', () => {
  for (const broken of ['{not json', '[1,2,3]', '"a string"', '42']) {
    const read = readStore(broken)
    assert.equal(read.kind, 'unreadable', `${broken} should be unreadable`)
    // There is deliberately no `store` on this answer: a caller cannot accidentally save defaults over it.
    assert.equal('store' in read, false)
  }
  const newer = readStore(JSON.stringify({ version: PUZZLE_STORE_VERSION + 1, puzzles: [] }))
  assert.equal(newer.kind, 'unreadable')
  if (newer.kind === 'unreadable') assert.match(newer.says, /newer version/)
  const noList = readStore(JSON.stringify({ version: 1, records: {} }))
  assert.equal(noList.kind, 'unreadable')
})

test('a collection with one bad entry in it is read, and says what it could not read', () => {
  const good = mate({ id: 'g1', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })
  const raw = JSON.stringify({
    version: 1,
    puzzles: [good, { id: 'b1', exercise: { startFen: 'rubbish' } }, { exercise: {} }, 7],
    records: { g1: { attempts: [{ at: 1, solved: true, worth: 1 }] }, nope: { attempts: 'no' } },
    daily: { '2026-03-01': 'g1', 'not-a-day': 'g1' },
    person: { rating: 1310, attempts: 4, finished: 4, unmeasured: 0, lastAt: 9, history: [] }
  })
  const read = readStore(raw)
  assert.equal(read.kind, 'ok')
  if (read.kind !== 'ok') return
  assert.equal(read.store.puzzles.length, 1)
  assert.equal(read.store.puzzles[0].id, 'g1')
  assert.ok(read.dropped.length >= 4, read.dropped.join(' | '))
  assert.ok(read.dropped.some((one) => /b1/.test(one) && /cannot be used/.test(one)))
  assert.ok(read.dropped.some((one) => /nope/.test(one)))
  assert.ok(read.dropped.some((one) => /not-a-day/.test(one)))
  assert.equal(read.store.daily['2026-03-01'], 'g1')
  assert.equal(read.store.daily['not-a-day'], undefined)
  assert.equal(read.store.person.rating, 1310)
  assert.equal(read.store.records.g1.attempts.length, 1)
  assert.match(read.says, /could not be/)
})

test('a history for a puzzle that has gone is kept rather than thrown away', () => {
  const raw = JSON.stringify({ version: 1, puzzles: [], records: { ghost: { attempts: [{ at: 1, solved: true, worth: 1 }] } } })
  const read = readStore(raw)
  assert.equal(read.kind, 'ok')
  if (read.kind !== 'ok') return
  assert.equal(read.store.records.ghost.attempts.length, 1)
  assert.ok(read.dropped.some((one) => /It has been kept/.test(one)))
})

test('a collection survives a round trip through storage', () => {
  const store = storeWith([mate({ id: 'r1', fen: BACK_RANK, moves: 1, lines: [['a1a8']], rating: 1450 })])
  const back = readStore(JSON.stringify(writeStore(store)))
  assert.equal(back.kind, 'ok')
  if (back.kind !== 'ok') return
  assert.equal(back.store.puzzles[0].rating, 1450)
  assert.equal(back.store.puzzles[0].ratingFrom, 'source')
  assert.equal(back.store.puzzles[0].exercise.verification.status, 'verified')
  assert.deepEqual(themeNames(back.store.puzzles[0]).sort(), themeNames(store.puzzles[0]).sort())
})

test('the same puzzle is not added twice', () => {
  const one = mate({ id: 'dup', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })
  const first = addPuzzles(emptyStore(), [one])
  assert.equal(first.added, 1)
  const second = addPuzzles(first.store, [one, mate({ id: 'other', fen: SMOTHERED, moves: 1, lines: [['h6f7']] })])
  assert.equal(second.added, 1)
  assert.equal(second.alreadyHere, 1)
  assert.equal(second.store.puzzles.length, 2)
})

test('removing a puzzle takes its history with it and leaves the day it was chosen for alone', () => {
  let store = storeWith([mate({ id: 'rm', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })])
  const day = dailyFor(store, '2026-03-01')
  store = day.store
  assert.equal(day.puzzleId, 'rm')
  store = recordAttempt(store, { exerciseId: 'rm', solved: true, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 5, at: NOW }, NOW, '2026-03-01').store
  assert.ok(store.records.rm)
  store = removePuzzle(store, 'rm')
  assert.equal(store.puzzles.length, 0)
  assert.equal(store.records.rm, undefined)
  const after = dailyFor(store, '2026-03-01')
  assert.equal(after.puzzleId, 'rm')
  assert.equal(after.gone, true)
  assert.match(after.says, /no longer in your collection/)
})

// ---------------------------------------------------------------- the daily challenge

test('the day is picked by the date, so the same day always gives the same puzzle', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => mate({ id, fen: BACK_RANK, moves: 1, lines: [['a1a8']] }))
  const first = pickDaily(pool, '2026-03-01')
  assert.equal(pickDaily(pool, '2026-03-01'), first)
  assert.equal(pickDaily([...pool].reverse(), '2026-03-01'), first, 'the order it was handed in does not matter')
  // Different days generally give different puzzles. Across a fortnight at least two must differ, or it is not a pick.
  const fortnight = new Set(Array.from({ length: 14 }, (_one, i) => pickDaily(pool, `2026-03-${String(i + 1).padStart(2, '0')}`)))
  assert.ok(fortnight.size > 1)
  assert.equal(pickDaily([], '2026-03-01'), null)
})

test('today cannot be rerolled by reopening the app or by making more puzzles', () => {
  const start = storeWith(['a', 'b', 'c'].map((id) => mate({ id, fen: BACK_RANK, moves: 1, lines: [['a1a8']] })))
  const today = '2026-03-04'

  const first = dailyFor(start, today)
  assert.equal(first.wasFixed, false)
  assert.ok(first.puzzleId)
  assert.match(first.says, /now fixed/)
  const fixed = first.store
  assert.equal(fixed.daily[today], first.puzzleId)

  // Asking again, as reopening the screen would.
  const again = dailyFor(fixed, today)
  assert.equal(again.puzzleId, first.puzzleId)
  assert.equal(again.wasFixed, true)

  // Twelve more puzzles are made, which changes the pool the hash would pick from.
  const grown = addPuzzles(fixed, Array.from({ length: 12 }, (_one, i) => mate({ id: `grown-${i}`, fen: SMOTHERED, moves: 1, lines: [['h6f7']] }))).store
  assert.notEqual(pickDaily(grown.puzzles, today), first.puzzleId, 'the hash alone would have moved')
  assert.equal(dailyFor(grown, today).puzzleId, first.puzzleId, 'the recorded choice does not move')

  // And a restart: everything through storage and back.
  const restarted = readStore(JSON.stringify(writeStore(grown)))
  assert.equal(restarted.kind, 'ok')
  if (restarted.kind !== 'ok') return
  const afterRestart = dailyFor(restarted.store, today)
  assert.equal(afterRestart.puzzleId, first.puzzleId)
  assert.equal(afterRestart.wasFixed, true)

  // Tomorrow is a different question and is allowed a different answer.
  assert.equal(dailyFor(restarted.store, '2026-03-05').wasFixed, false)
})

test('the day prefers a checked puzzle, and says when there is nothing checked to offer', () => {
  const unverified = verifyPuzzle(newPuzzle({
    id: 'u1', kind: 'puzzle', startFen: FORK, objective: 'find-best', prompt: 'x',
    solution: { lines: [{ move: 'c5e6' }] }, source: AUTHORED, addedAt: NOW
  }), NOW).puzzle
  assert.equal(unverified.exercise.verification.status, 'unverified')

  const onlyUnverified = dailyFor(storeWith([unverified]), '2026-04-01')
  assert.equal(onlyUnverified.puzzleId, 'u1')
  assert.equal(onlyUnverified.fromVerified, false)
  assert.match(onlyUnverified.says, /needs an engine/)

  const mixed = dailyFor(storeWith([unverified, mate({ id: 'v1', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })]), '2026-04-01')
  assert.equal(mixed.puzzleId, 'v1')
  assert.equal(mixed.fromVerified, true)

  const nothing = dailyFor(emptyStore(), '2026-04-01')
  assert.equal(nothing.puzzleId, null)
  assert.match(nothing.says, /nothing to choose from/)
})

test('a rejected puzzle is never the day s challenge', () => {
  const broken = mate({ id: 'x1', fen: BACK_RANK, moves: 2, lines: [['a1a8']] })
  assert.equal(broken.exercise.verification.status, 'rejected')
  assert.equal(dailyFor(storeWith([broken]), '2026-04-02').puzzleId, null)
})

// ---------------------------------------------------------------- the local day

test('days are read, written and counted without a clock', () => {
  assert.equal(isDay('2026-03-01'), true)
  assert.equal(isDay('2026-02-30'), false)
  assert.equal(isDay('2026-13-01'), false)
  assert.equal(isDay('26-03-01'), false)
  assert.equal(previousDay('2026-03-01'), '2026-02-28')
  assert.equal(previousDay('2024-03-01'), '2024-02-29')
  assert.equal(previousDay('2026-01-01'), '2025-12-31')
  assert.equal(daysBetween('2026-03-01', '2026-03-04'), 3)
  assert.equal(daysBetween('2026-03-04', '2026-03-01'), -3)
  assert.equal(daysBetween('x', '2026-03-01'), null)
  // Midnight local is a new day even when UTC has not got there. The offset is the one the browser reports.
  const justAfterMidnightInIndia = Date.UTC(2026, 2, 3, 19, 0, 0)
  assert.equal(dayKey(justAfterMidnightInIndia, -330), '2026-03-04')
  assert.equal(dayKey(justAfterMidnightInIndia, 0), '2026-03-03')
})

// ---------------------------------------------------------------- streaks

test('a streak counts days that were really finished, not days the app was opened', () => {
  let store = storeWith(['a', 'b', 'c'].map((id) => mate({ id, fen: BACK_RANK, moves: 1, lines: [['a1a8']] })))
  const days = ['2026-03-01', '2026-03-02', '2026-03-03']
  // The day is fixed on each of the three days, as opening the screen would.
  for (const day of days) store = dailyFor(store, day).store
  assert.equal(dailyStreak(store, '2026-03-03').current, 0, 'opening it is not finishing it')

  const finish = (day: string, over: Partial<{ solved: boolean; worth: number }> = {}): void => {
    const id = store.daily[day]
    store = recordAttempt(store, {
      exerciseId: id, solved: true, gaveUp: false, hintsUsed: 0, worth: 1,
      wrongMoves: 0, illegalTries: 0, seconds: 5, at: NOW, ...over
    }, NOW, day).store
  }

  finish('2026-03-01')
  finish('2026-03-02')
  const two = dailyStreak(store, '2026-03-02')
  assert.equal(two.current, 2)
  assert.equal(two.todayDone, true)

  // Not yet done today, but the run up to yesterday is alive and is counted as two days.
  const alive = dailyStreak(store, '2026-03-03')
  assert.equal(alive.current, 2, 'the first and second both count; today is still to do')
  assert.equal(alive.todayDone, false)
  assert.equal(alive.aliveButUndone, true)
  assert.match(alive.says, /still to do/)

  // A solve with the move shown is not a solve, so it does not extend the run.
  finish('2026-03-03', { worth: 0 })
  assert.equal(dailyStreak(store, '2026-03-03').todayDone, false)
  assert.equal(dailyStreak(store, '2026-03-03').current, 2)

  // Two days later, with nothing done in between, the run is over but the longest is remembered.
  const broken = dailyStreak(store, '2026-03-05')
  assert.equal(broken.current, 0)
  assert.equal(broken.longest, 2)
  assert.deepEqual([...broken.days], ['2026-03-02', '2026-03-01'])
})

test('a day nothing was chosen on is not drawn as a day somebody missed', () => {
  let store = storeWith(['a', 'b'].map((id) => mate({ id, fen: BACK_RANK, moves: 1, lines: [['a1a8']] })))
  // Opened on the first and the third. The second is a day Orbis was never opened.
  for (const day of ['2026-03-01', '2026-03-03']) store = dailyFor(store, day).store
  const id = store.daily['2026-03-01']
  store = recordAttempt(store, {
    exerciseId: id, solved: true, gaveUp: false, hintsUsed: 0, worth: 1,
    wrongMoves: 0, illegalTries: 0, seconds: 5, at: NOW
  }, NOW, '2026-03-01').store

  const marks = recentDays(store, '2026-03-03', 4)
  assert.deepEqual(marks.map((one) => one.day), ['2026-03-03', '2026-03-02', '2026-03-01', '2026-02-28'])
  assert.deepEqual(marks.map((one) => one.state), ['missed', 'nothing', 'done', 'nothing'])
  assert.match(marks[1].says, /was not opened/, 'the gap says what it is, rather than looking like a failure')
  assert.match(marks[2].says, /solved/)
  for (const mark of marks) assert.ok(mark.says.startsWith(mark.day))
})

// ---------------------------------------------------------------- status, filters and facets

test('a solve with the move shown counts as missed, everywhere', () => {
  const shown = { exerciseId: 'p', solved: true, gaveUp: false, hintsUsed: 4, worth: 0, wrongMoves: 0, illegalTries: 0, seconds: 9, at: 1 }
  assert.equal(counts(shown), false)
  assert.equal(statusOf({ puzzleId: 'p', attempts: [shown] }), 'missed')
  assert.equal(statusOf(undefined), 'unseen')
  assert.equal(statusOf({ puzzleId: 'p', attempts: [] }), 'unseen')
  const clean = { ...shown, worth: 1, hintsUsed: 0 }
  assert.equal(statusOf({ puzzleId: 'p', attempts: [clean] }), 'solved')
  assert.equal(everSolved({ puzzleId: 'p', attempts: [clean, shown] }), true)
  assert.equal(statusOf({ puzzleId: 'p', attempts: [clean, shown] }), 'missed', 'the most recent attempt decides the status')
})

test('facets count what is really there and nothing else', () => {
  const store = storeWith([
    mate({ id: 'f1', fen: BACK_RANK, moves: 1, lines: [['a1a8']], rating: 1500 }),
    mate({ id: 'f2', fen: SMOTHERED, moves: 1, lines: [['h6f7']] })
  ])
  const facets = puzzleFacets(store)
  assert.equal(facets.total, 2)
  assert.equal(facets.unrated, 1)
  const names = facets.themes.map((one) => one.value)
  assert.ok(names.includes('mate'))
  assert.ok(names.includes('back-rank-mate'))
  assert.ok(names.includes('smothered-mate'))
  // Not one theme with a count of zero, and nothing from the vocabulary that does not occur.
  assert.equal(facets.themes.every((one) => one.count > 0), true)
  assert.equal(names.includes('fork'), false)
  assert.equal(names.includes('zugzwang'), false)
  assert.equal(facets.themes.find((one) => one.value === 'mate')?.count, 2)
  assert.equal(facets.themes.find((one) => one.value === 'back-rank-mate')?.count, 1)
  assert.deepEqual(facets.statuses.map((one) => one.value), ['unseen'])
  assert.deepEqual(facets.ratings.map((one) => one.label), ['1400–1799'])
  assert.deepEqual(facets.verification.map((one) => one.value), ['verified'])
})

test('filters work on real stored data', () => {
  const store = storeWith([
    mate({ id: 'q1', fen: BACK_RANK, moves: 1, lines: [['a1a8']], rating: 1500, themes: ['fork'] }),
    mate({ id: 'q2', fen: SMOTHERED, moves: 1, lines: [['h6f7']] }),
    mate({ id: 'q3', fen: TWO_MATES, moves: 1, lines: [['a1a8'], ['d1d8']], rating: 2400 })
  ])
  assert.equal(filterIsEmpty(EMPTY_PUZZLE_FILTER), true)
  assert.equal(filterPuzzles(store, EMPTY_PUZZLE_FILTER).length, 3)

  assert.deepEqual(filterPuzzles(store, { themes: ['smothered-mate'] }).map((one) => one.id), ['q2'])
  assert.deepEqual(filterPuzzles(store, { themes: ['back-rank-mate'] }).map((one) => one.id).sort(), ['q1', 'q3'])
  // A source's word for a fork satisfies a plain theme filter but not one asking for checked themes.
  assert.deepEqual(filterPuzzles(store, { themes: ['fork'] }).map((one) => one.id), ['q1'])
  assert.deepEqual(filterPuzzles(store, { themes: ['fork'], onlyCheckedThemes: true }).map((one) => one.id), [])

  // A rating band leaves out the unrated one, unless it is asked for by name.
  assert.deepEqual(filterPuzzles(store, { ratingFrom: 1400, ratingTo: 1799 }).map((one) => one.id), ['q1'])
  assert.deepEqual(filterPuzzles(store, { ratingFrom: 1400, ratingTo: 1799, includeUnrated: true }).map((one) => one.id).sort(), ['q1', 'q2'])
  assert.deepEqual(filterPuzzles(store, { includeUnrated: false }).map((one) => one.id).sort(), ['q1', 'q3'])

  // Status, on real history.
  const tried = recordAttempt(store, { exerciseId: 'q2', solved: false, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 3, illegalTries: 0, seconds: 40, at: NOW }, NOW).store
  assert.deepEqual(filterPuzzles(tried, { status: ['missed'] }).map((one) => one.id), ['q2'])
  assert.equal(filterPuzzles(tried, { status: ['unseen'] }).length, 2)
  assert.equal(filterPuzzles(tried, { status: ['solved'] }).length, 0)

  // Text, and the game a puzzle came from.
  assert.deepEqual(filterPuzzles(store, { text: 'smothered' }).map((one) => one.id), ['q2'])
  assert.equal(filterPuzzles(store, { text: 'nothing like this' }).length, 0)
  const fromGame = addPuzzles(store, [mate({
    id: 'q4', fen: BACK_RANK, moves: 1, lines: [['a1a8']],
    source: { kind: 'from-game', by: 'Orbis puzzle maker', game: { white: 'Me', black: 'You', ply: 40 } }
  })]).store
  // The tag is what a from-game filter reads, and this one has none, so it finds nothing rather than guessing.
  assert.equal(filterPuzzles(fromGame, { fromGameId: 'g9' }).length, 0)
  const tagged = addPuzzles(emptyStore(), [{ ...fromGame.puzzles[3], exercise: { ...fromGame.puzzles[3].exercise, tags: [gameTag('g9')] } }]).store
  assert.deepEqual(filterPuzzles(tagged, { fromGameId: 'g9' }).map((one) => one.id), ['q4'])
})

test('a filter can say what it is asking and give a part of it back', () => {
  const filter = { themes: ['mate' as PuzzleTheme], ratingFrom: 1200, ratingTo: 1600, status: ['missed' as const], text: 'rook' }
  const words = describePuzzleFilter(filter)
  assert.ok(words.some((one) => one.key === 'themes' && one.words === 'Mate'))
  assert.ok(words.some((one) => one.key === 'ratingFrom' && /1200 to 1600/.test(one.words)))
  assert.ok(words.some((one) => one.key === 'status' && one.words === 'Missed'))
  const narrower = withoutPart(filter, 'ratingFrom')
  assert.equal(narrower.ratingFrom, undefined)
  assert.equal(narrower.ratingTo, undefined, 'taking the band off takes both ends off')
})

// ---------------------------------------------------------------- the review list

test('the review list is what went wrong last time, newest first, and never new material', () => {
  let store = storeWith(['m1', 'm2', 'm3'].map((id) => mate({ id, fen: BACK_RANK, moves: 1, lines: [['a1a8']] })))
  const record = (id: string, at: number, over: Partial<{ solved: boolean; gaveUp: boolean; worth: number }> = {}): void => {
    store = recordAttempt(store, {
      exerciseId: id, solved: false, gaveUp: false, hintsUsed: 0, worth: 1,
      wrongMoves: 1, illegalTries: 0, seconds: 30, at, ...over
    }, at).store
  }
  record('m1', 1000)
  record('m2', 3000, { gaveUp: true })
  record('m3', 2000, { solved: true, worth: 1 })

  const missed = missedPuzzles(store)
  assert.deepEqual(missed.map((one) => one.puzzle.id), ['m2', 'm1'])
  assert.match(missed[0].says, /answer was asked for/)
  assert.match(missed[1].says, /Not solved last time/)
  assert.equal(missed[0].solvedBefore, false)

  // Solving m1 takes it off the list; getting m3 wrong puts it on.
  record('m1', 4000, { solved: true, worth: 1 })
  record('m3', 5000)
  assert.deepEqual(missedPuzzles(store).map((one) => one.puzzle.id), ['m3', 'm2'])
  assert.equal(missedPuzzles(store)[0].solvedBefore, true)
})

// ---------------------------------------------------------------- recording an attempt

test('an attempt is recorded, and an unrated puzzle leaves the rating where it was', () => {
  const store = storeWith([mate({ id: 'a1', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })])
  const done = recordAttempt(store, {
    exerciseId: 'a1', solved: true, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 7, at: NOW
  }, NOW)
  assert.equal(done.ok, true)
  assert.equal(done.store.records.a1.attempts.length, 1)
  assert.equal(done.rating.measured, false)
  assert.equal(done.store.person.rating, START_RATING)
  assert.equal(standingOf(done.store.person).meansAnything, false)
  assert.match(done.says, /no rating/i)
  assert.equal(statusOf(done.store.records.a1), 'solved')

  const unknown = recordAttempt(done.store, {
    exerciseId: 'nope', solved: true, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 7, at: NOW
  }, NOW)
  assert.equal(unknown.ok, false)
  assert.equal(unknown.store, done.store)
  assert.match(unknown.says, /not in this collection/)
})

test('a rated puzzle does move the rating, and one attempt still is not a rating', () => {
  const store = storeWith([mate({ id: 'b1', fen: BACK_RANK, moves: 1, lines: [['a1a8']], rating: 1600 })])
  const done = recordAttempt(store, {
    exerciseId: 'b1', solved: true, gaveUp: false, hintsUsed: 0, worth: 1, wrongMoves: 0, illegalTries: 0, seconds: 7, at: NOW
  }, NOW)
  assert.equal(done.rating.measured, true)
  assert.ok(done.store.person.rating > START_RATING)
  assert.equal(standingOf(done.store.person).meansAnything, false)
  // The puzzle's own rating came from its source, so one person's go at it does not rewrite it.
  assert.equal(done.store.puzzles[0].rating, 1600)
  assert.equal(done.puzzleRating.measured, false)
})

// ---------------------------------------------------------------- solving one, end to end

test('a puzzle can be solved through the attempt machine, and the record is what the rating reads', () => {
  const puzzle = mate({ id: 'solve', fen: BACK_RANK, moves: 1, lines: [['a1a8']] })
  let session: AttemptSession = newAttempt({ id: 's1', exercise: puzzle.exercise, now: 0 })
  session = advance(session, { kind: 'load' }, 1).session
  session = advance(session, { kind: 'loaded' }, 2).session
  assert.equal(session.state, 'active')

  // A wrong but legal move: the attempt goes on, because a puzzle forgives two of them.
  const wrong = playMove(session, { ...puzzle.exercise, failure: [{ kind: 'wrong-moves', allowed: 2 }] }, 'a1a7', 3)
  assert.equal(wrong.verdict.kind, 'not-the-idea')
  assert.equal(wrong.session.wrongMoves, 1)
  session = advance(wrong.session, { kind: 'feedback-done' }, 4).session
  assert.equal(session.state, 'active')

  const right = playMove(session, puzzle.exercise, 'a1a8', 5)
  assert.equal(right.verdict.kind, 'solved')
  session = advance(right.session, { kind: 'feedback-done' }, 6).session
  assert.equal(session.state, 'completed')

  const performance = performanceOf(session, puzzle.exercise, 6)
  assert.equal(performance.solved, true)
  assert.equal(performance.wrongMoves, 1)
  const store = recordAttempt(storeWith([puzzle]), performance, 6)
  assert.equal(store.ok, true)
  assert.equal(statusOf(store.store.records.solve), 'solved')
  assert.match(store.store.records.solve.attempts[0].wrongMoves === 1 ? 'ok' : 'no', /ok/)
})

// ---------------------------------------------------------------- what a list row says

test('a row and a provenance say only what is known', () => {
  const fromGame = mate({
    id: 'p1', fen: BACK_RANK, moves: 1, lines: [['a1a8']],
    source: { kind: 'from-game', by: 'Orbis puzzle maker', game: { white: 'Ada', black: 'Bo', event: 'Club night', date: '2026.02.11', ply: 61 } }
  })
  assert.match(provenanceWords(fromGame), /Ada against Bo/)
  assert.match(provenanceWords(fromGame), /Club night/)
  assert.match(provenanceWords(fromGame), /after 61 moves/)

  const anonymous = mate({ id: 'p2', fen: BACK_RANK, moves: 1, lines: [['a1a8']], source: { kind: 'from-game', game: { ply: 3 } } })
  assert.match(provenanceWords(anonymous), /one of your saved games/)
  assert.equal(/undefined|Unknown/.test(provenanceWords(anonymous)), false)

  const row = puzzleLine(fromGame, undefined)
  assert.match(row, /Mate/)
  assert.match(row, /no rating/)
  assert.match(row, /not tried/i)
})
