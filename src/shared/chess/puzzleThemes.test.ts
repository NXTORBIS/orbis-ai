import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Provenance } from './exercise.ts'
import {
  addPuzzles, emptyStore, newPuzzle, recordAttempt, verifyPuzzle,
  type Puzzle, type PuzzleStore
} from './puzzles.ts'
import type { Performance } from './attempt.ts'
import {
  ENOUGH_ATTEMPTS, nextToSolve, nextWords, progressWords, shelfShare, shelfWords, solveProgress, themeShelves,
  themeStrength
} from './puzzleThemes.ts'

/**
 * The shelves and the progress strip.
 *
 * The positions are real, legal positions with real forced mates, taken from the same set `puzzles.test.ts` uses,
 * so every theme claimed here was proved by the rules rather than written down by hand.
 *
 *   - `BACK_RANK` -- `6k1/5ppp/8/8/8/8/5PPP/R5K1 w` -- Ra8 is mate, and it is the only mate.
 *   - `SMOTHERED` -- `6rk/6pp/7N/8/8/8/8/1K6 w` -- Nf7 is mate, the king walled in by its own pieces.
 */

const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'
const SMOTHERED = '6rk/6pp/7N/8/8/8/8/1K6 w - - 0 1'
const AUTHORED: Provenance = { kind: 'authored', by: 'the test' }
const NOW = 1_700_000_000_000

function mate(o: { id: string; fen: string; line: string[]; addedAt?: number }): Puzzle {
  const nest = (line: string[]): { move: string; children?: { move: string }[] } =>
    line.length === 1 ? { move: line[0] } : { move: line[0], children: [nest(line.slice(1))] }
  const draft = newPuzzle({
    id: o.id,
    kind: 'puzzle',
    startFen: o.fen,
    objective: 'mate-in-n',
    movesToMate: Math.ceil(o.line.length / 2),
    prompt: 'Mate in one.',
    solution: { lines: [nest(o.line)] },
    source: AUTHORED,
    addedAt: o.addedAt ?? NOW
  })
  return verifyPuzzle(draft, NOW).puzzle
}

function storeWith(puzzles: Puzzle[]): PuzzleStore {
  return addPuzzles(emptyStore(), puzzles).store
}

/** A finished attempt, the way the solver reports one. */
function attempt(id: string, o: { solved: boolean; hints?: number; wrong?: number; day?: string }): Performance {
  return {
    exerciseId: id,
    solved: o.solved,
    gaveUp: false,
    hintsUsed: o.hints ?? 0,
    worth: o.solved ? 1 : 0,
    wrongMoves: o.wrong ?? 0,
    illegalTries: 0,
    seconds: 12,
    at: NOW
  }
}

function record(store: PuzzleStore, id: string, o: Parameters<typeof attempt>[1], day?: string): PuzzleStore {
  const done = recordAttempt(store, attempt(id, o), NOW, day)
  assert.equal(done.ok, true, done.says)
  return done.store
}

test('a theme with no puzzles in the collection has no shelf', () => {
  const shelves = themeShelves(storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })]))
  assert.ok(shelves.length > 0, 'a mate puzzle should fill at least the mate shelf')
  assert.equal(shelves.some((one) => one.theme === 'fork'), false)
  assert.ok(shelves.every((one) => one.total > 0))
})

test('an empty collection has no shelves at all, rather than every theme at nought', () => {
  assert.deepEqual(themeShelves(emptyStore()), [])
})

test('a shelf counts solved, missed and untried off the real record', () => {
  let store = storeWith([
    mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] }),
    mate({ id: 'b', fen: SMOTHERED, line: ['Nf7#'] })
  ])
  store = record(store, 'a', { solved: true })
  const shelf = themeShelves(store).find((one) => one.theme === 'mate')
  assert.ok(shelf, 'both puzzles are mates, so there is a mate shelf')
  assert.equal(shelf.total, 2)
  assert.equal(shelf.solved, 1)
  assert.equal(shelf.missed, 0)
  assert.equal(shelf.untried, 1)
  assert.equal(shelf.nextId, 'b', 'the untried one is the one to open next')
  assert.equal(shelfShare(shelf), 0.5)
  assert.match(shelfWords(shelf), /1 of 2 solved/)
})

test('a shelf offers the one that went wrong when there is nothing untried', () => {
  let store = storeWith([
    mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] }),
    mate({ id: 'b', fen: SMOTHERED, line: ['Nf7#'] })
  ])
  store = record(store, 'a', { solved: true })
  store = record(store, 'b', { solved: false })
  const shelf = themeShelves(store).find((one) => one.theme === 'mate')
  assert.ok(shelf)
  assert.equal(shelf.untried, 0)
  assert.equal(shelf.missed, 1)
  assert.equal(shelf.nextId, 'b')
})

test('a mate shelf is proved, so nothing on it is merely claimed', () => {
  const shelf = themeShelves(storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })]))
    .find((one) => one.theme === 'mate')
  assert.ok(shelf)
  assert.equal(shelf.proved, 1)
  assert.equal(shelf.byConvention, false)
  assert.equal(shelf.cannotProve, null)
})

test('a theme Orbis cannot prove from a position says why on its shelf', () => {
  // A puzzle whose source said "pin". Nothing checks a pin, so the shelf must carry the reason.
  const draft = newPuzzle({
    id: 'p',
    kind: 'puzzle',
    startFen: BACK_RANK,
    objective: 'mate-in-n',
    movesToMate: 1,
    prompt: 'Mate in one.',
    solution: { lines: [{ move: 'Ra8#' }] },
    source: AUTHORED,
    addedAt: NOW,
    sourceThemes: ['pin'],
    themesBy: 'the source'
  })
  const shelf = themeShelves(storeWith([verifyPuzzle(draft, NOW).puzzle])).find((one) => one.theme === 'pin')
  assert.ok(shelf, 'the source claimed it, so there is a shelf')
  assert.equal(shelf.proved, 0, 'nothing proved it')
  assert.ok(shelf.cannotProve && shelf.cannotProve.length > 0)
})

test('strength says nothing until there are enough goes, and the count it does give is real', () => {
  let store = storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })])
  assert.equal(themeStrength(store, 'mate').kind, 'not-enough')
  assert.match(themeStrength(store, 'mate').says, /No goes/)
  for (let go = 0; go < ENOUGH_ATTEMPTS - 1; go++) store = record(store, 'a', { solved: true })
  const nearly = themeStrength(store, 'mate')
  assert.equal(nearly.kind, 'not-enough')
  assert.equal(nearly.attempts, ENOUGH_ATTEMPTS - 1)
  store = record(store, 'a', { solved: false })
  const measured = themeStrength(store, 'mate')
  assert.equal(measured.kind, 'measured')
  if (measured.kind !== 'measured') return
  assert.equal(measured.attempts, ENOUGH_ATTEMPTS)
  assert.equal(measured.solved, ENOUGH_ATTEMPTS - 1)
  assert.equal(measured.share, (ENOUGH_ATTEMPTS - 1) / ENOUGH_ATTEMPTS)
})

test('strength over a theme nothing carries is nought goes, not a share of nought', () => {
  const held = themeStrength(storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })]), 'fork')
  assert.equal(held.kind, 'not-enough')
  assert.equal(held.attempts, 0)
})

test('progress counts goes and clean solves apart', () => {
  let store = storeWith([
    mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] }),
    mate({ id: 'b', fen: SMOTHERED, line: ['Nf7#'] })
  ])
  store = record(store, 'a', { solved: true })
  store = record(store, 'b', { solved: true, hints: 1 })
  const progress = solveProgress(store)
  assert.equal(progress.puzzles, 2)
  assert.equal(progress.solved, 2)
  assert.equal(progress.untried, 0)
  assert.equal(progress.attempts, 2)
  assert.equal(progress.clean, 1, 'the one solved with a hint is not a clean solve')
  assert.match(progressWords(progress), /2 of 2 solved/)
})

test('progress on an empty collection says so rather than giving nought out of nought', () => {
  assert.match(progressWords(solveProgress(emptyStore())), /no puzzles here yet/)
})

test('progress with puzzles and no goes does not claim a solve rate', () => {
  const words = progressWords(solveProgress(storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })])))
  assert.match(words, /none tried yet/)
})

test('the last day is the latest day any daily attempt carried', () => {
  let store = storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })])
  assert.equal(solveProgress(store).lastDay, null)
  store = record(store, 'a', { solved: true }, '2026-02-01')
  store = record(store, 'a', { solved: false }, '2026-01-20')
  assert.equal(solveProgress(store).lastDay, '2026-02-01')
})

test('the next puzzle is an untried one first, then one that went wrong, oldest first', () => {
  const older = mate({ id: 'old', fen: BACK_RANK, line: ['Ra8#'], addedAt: NOW - 1000 })
  const newer = mate({ id: 'new', fen: SMOTHERED, line: ['Nf7#'], addedAt: NOW })
  let store = storeWith([newer, older])
  const first = nextToSolve(store, store.puzzles)
  assert.ok(first)
  assert.equal(first.puzzle.id, 'old', 'the oldest untried one comes first')
  assert.equal(first.kind, 'untried')
  store = record(store, 'old', { solved: false })
  store = record(store, 'new', { solved: true })
  const second = nextToSolve(store, store.puzzles)
  assert.ok(second)
  assert.equal(second.puzzle.id, 'old')
  assert.equal(second.kind, 'missed')
  assert.match(nextWords(second.kind), /went wrong/)
})

test('everything solved offers one again and says that is what it is doing', () => {
  let store = storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })])
  store = record(store, 'a', { solved: true })
  const again = nextToSolve(store, store.puzzles)
  assert.ok(again)
  assert.equal(again.kind, 'again')
  assert.match(nextWords('again'), /solved everything/)
})

test('the one on screen is never offered as the next one', () => {
  const store = storeWith([mate({ id: 'a', fen: BACK_RANK, line: ['Ra8#'] })])
  assert.equal(nextToSolve(store, store.puzzles, 'a'), null)
})

test('an empty pool has no next puzzle', () => {
  assert.equal(nextToSolve(emptyStore(), []), null)
})
