import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  analysedFromStudy, analysedGameFrom, cardsForAttempts, gatherEvidence, lineThroughStudy, mergeTraining,
  namesYouPlayUnder, sideYouPlayed, trainingFromAcademy, trainingFromPuzzles
} from './evidence.ts'
import { EVIDENCE, weaknessProfile, type TrainingRecord } from './coach.ts'
import { START_FEN } from './rules.ts'
import { addMove, openSession, promote, recordEvaluation, type NodeEvaluation } from './analysis.ts'
import { studyFromSession, type StoredStudy } from './study.ts'
import { buildMoves, fingerprintOf, type GameMeta, type GameSource, type StoredGame } from './model.ts'
import { emptyStore, type Puzzle, type PuzzleRecord, type PuzzleStore } from './puzzles.ts'
import { newExercise } from './exercise.ts'
import type { Performance } from './attempt.ts'
import type { AcademyProgress } from './academyPath.ts'
import type { ReviewCard } from './spaced.ts'

/**
 * The coach's evidence comes from records that exist, or it does not come.
 *
 * Most of what is checked here is the second half of that: a game nobody analysed must not count as a clean one, an
 * analysis of a game whose moves have since changed must be refused rather than read onto the new moves, and a person
 * one attempt short of the threshold must get a refusal naming the shortfall rather than a conclusion. The two cases
 * either side of a threshold are the ones worth having, because a gatherer that is too generous reads exactly like
 * one that works.
 */

// ---------------------------------------------------------------- games, analyses and the records around them

const SAN = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'
]

function makeGame(o: { id: string; source?: GameSource; meta?: Partial<GameMeta>; san?: readonly string[]; clocks?: boolean } ): StoredGame {
  const san = o.san ?? SAN
  const built = buildMoves(START_FEN, san.map((one, i) => ({ san: one, ...(o.clocks ? { clock: 300 - i * 10 } : {}) })))
  assert.ok(built.ok, `the test game ${o.id} has to be playable`)
  return {
    id: o.id,
    profileId: 'default',
    source: o.source ?? { kind: 'local-engine', engine: 'Stockfish 16' },
    startFen: START_FEN,
    moves: built.moves,
    meta: { white: {}, black: {}, result: '*', ...o.meta },
    variant: 'standard',
    createdAt: 1_000,
    updatedAt: 1_000,
    fingerprint: fingerprintOf(START_FEN, built.moves)
  }
}

const evaluation = (fen: string, cp: number, depth: number): NodeEvaluation =>
  ({ fen, score: { kind: 'cp', cp }, depth, bestmove: null })

/**
 * A saved analysis of a game, built the way the real one is: a session is opened on the game and the engine's answers
 * are recorded onto its nodes, then `studyFromSession` writes it down. Nothing here hand-writes a stored record.
 *
 * `swings` says which ply's answer drops, which is how a blunder is produced: the score before a move and the score
 * after it are what name it, and this file never asserts a class it did not make the engine report.
 */
function makeStudy(game: StoredGame, o: { depth?: number; swings?: readonly number[]; at?: number } = {}): StoredStudy {
  const depth = o.depth ?? 20
  const swings = new Set(o.swings ?? [])
  let session = openSession(game)
  let cp = 20
  for (const [ply, nodeId] of session.original.entries()) {
    if (swings.has(ply)) cp -= 600
    session = recordEvaluation(session, nodeId, evaluation(session.tree.nodes[nodeId].fen, cp, depth))
  }
  return studyFromSession(session, o.at ?? 5_000)
}

// ---------------------------------------------------------------- which side was yours

describe('which side of a game was yours', () => {
  test('a game against the engine is read from the engine\'s own name', () => {
    const white = makeGame({ id: 'g1', meta: { white: { name: 'Stockfish 16' }, black: { name: 'Kesh' } } })
    const black = makeGame({ id: 'g2', meta: { white: { name: 'Kesh' }, black: { name: 'Stockfish 16' } } })
    assert.equal(sideYouPlayed(white), 'b')
    assert.equal(sideYouPlayed(black), 'w')
  })

  test('a game against the engine where nobody is named says nothing', () => {
    // This is the ordinary case: the engine's name is only written in after a real handshake, and a person who
    // never typed a name has none. Guessing White here would file the engine's moves under them.
    assert.equal(sideYouPlayed(makeGame({ id: 'g1' })), null)
  })

  test('a broadcast is never yours, whoever is playing in it', () => {
    const watched = makeGame({
      id: 'g1',
      source: { kind: 'broadcast', provider: 'lichess', providerGameId: 'x', retrievedAt: 1 },
      meta: { white: { name: 'Kesh' }, black: { name: 'Somebody' } }
    })
    assert.equal(sideYouPlayed(watched, ['Kesh']), null)
  })

  test('an imported game is read from the names you play under, and matching both sides says nothing', () => {
    const mine = makeGame({
      id: 'g1',
      source: { kind: 'import', importedAt: 1 },
      meta: { white: { name: 'A Stranger' }, black: { name: 'kesh' } }
    })
    assert.equal(sideYouPlayed(mine, ['Kesh']), 'b', 'the name is matched whatever its capitals')
    assert.equal(sideYouPlayed(mine), null, 'and with no names to go on, nothing is claimed')

    const both = makeGame({
      id: 'g2',
      source: { kind: 'import', importedAt: 1 },
      meta: { white: { name: 'Kesh' }, black: { name: 'Kesh' } }
    })
    assert.equal(sideYouPlayed(both, ['Kesh']), null)
  })

  test('the name you play under is learned from your own games against the engine, and never invented', () => {
    const games = [
      makeGame({ id: 'g1', meta: { white: { name: 'Kesh' }, black: { name: 'Stockfish 16' } } }),
      makeGame({ id: 'g2', meta: { white: { name: 'Stockfish 16' }, black: { name: 'Kesh' } } }),
      makeGame({ id: 'g3', source: { kind: 'import', importedAt: 1 }, meta: { white: { name: 'Nobody' }, black: {} } })
    ]
    assert.deepEqual(namesYouPlayUnder(games), ['Kesh'], 'the imported game contributes nothing')
    assert.deepEqual(namesYouPlayUnder([makeGame({ id: 'g1' })]), [], 'and a game with no names gives no name')
  })
})

// ---------------------------------------------------------------- reading a saved analysis

describe('reading a saved analysis', () => {
  test('the game\'s own line is followed through the tree, even when a variation has been promoted', () => {
    const game = makeGame({ id: 'g1' })
    let session = openSession(game)
    // Somebody tries 1. d4 instead and makes it the tree's main line. The game is still 1. e4.
    const added = addMove(session, { from: 'd2', to: 'd4' })
    assert.ok(added, 'd4 has to be a legal first move')
    session = promote(added.session, added.nodeId)
    const study = studyFromSession(session, 5_000)

    const line = lineThroughStudy(game, study)
    assert.equal(line.length, game.moves.length + 1, 'every position of the game is on the line')
    assert.notEqual(line[1], added.nodeId, 'and the promoted variation is not mistaken for a move that was played')
  })

  test('an analysis of a game whose moves have changed since is refused, not read onto the new moves', () => {
    const game = makeGame({ id: 'g1' })
    const study = makeStudy(game)
    const changed: StoredGame = { ...game, fingerprint: 'something-else' }
    const read = analysedFromStudy(changed, study, { you: 'w' })
    assert.equal(read.analysed, null)
    assert.equal(read.kind, 'game-changed')
    assert.match(String(read.why), /no longer reaches/)
  })

  test('an analysis with notes but no answers from the engine has nothing in it to count', () => {
    const game = makeGame({ id: 'g1' })
    const study = studyFromSession(openSession(game), 5_000)
    const read = analysedFromStudy(game, study, { you: 'w' })
    assert.equal(read.analysed, null)
    assert.equal(read.kind, 'no-engine-answers')
    assert.match(String(read.why), /lines and notes in it are kept/)
  })

  test('both sides\' moves are kept, with the clock where the game recorded one', () => {
    const game = makeGame({ id: 'g1', clocks: true })
    const read = analysedFromStudy(game, makeStudy(game), { you: 'w' })
    assert.ok(read.analysed)
    const analysed = read.analysed
    assert.equal(analysed.moves.length, game.moves.length)
    assert.deepEqual([...new Set(analysed.moves.map((one) => one.side))].sort(), ['b', 'w'])
    assert.equal(analysed.moves[0].secondsLeft, 300, 'the clock comes off the game, not out of the air')
    assert.equal(analysed.moves[0].before, START_FEN, 'and the position a move was played in is the position before it')
  })

  test('a move the search cannot carry is not named, and the game\'s depth is its weakest judgement', () => {
    const game = makeGame({ id: 'g1' })
    const shallow = analysedFromStudy(game, makeStudy(game, { depth: EVIDENCE.minDepth - 1 }), { you: 'w' })
    assert.ok(shallow.analysed)
    assert.equal(shallow.analysed.depth, 0, 'nothing in it survived the bar, so it claims no depth at all')
    assert.deepEqual([...new Set(shallow.analysed.moves.map((one) => one.klass))], ['unclear'])
    assert.deepEqual([...new Set(shallow.analysed.moves.map((one) => one.loss))], [null], 'and no centipawn number is carried')

    const deep = analysedFromStudy(game, makeStudy(game, { depth: EVIDENCE.minDepth }), { you: 'w' })
    assert.ok(deep.analysed)
    assert.equal(deep.analysed.depth, EVIDENCE.minDepth)
  })

  test('a move the engine found something much better than comes through as a blunder', () => {
    const game = makeGame({ id: 'g1' })
    const read = analysedFromStudy(game, makeStudy(game, { swings: [3] }), { you: 'w' })
    assert.ok(read.analysed)
    // Ply 3 is White's second move, and White's score is six pawns worse after it than before it. Nothing here
    // asserts a class: the two recorded scores are what `evaluation.ts` named it from.
    const move = read.analysed.moves.find((one) => one.ply === 3)
    assert.equal(move?.side, 'w')
    assert.equal(move?.klass, 'blunder')
    assert.equal(move?.loss, 600)
  })

  test('the name of the opening is carried as the source wrote it, and never worked out here', () => {
    const named = makeGame({ id: 'g1', meta: { white: {}, black: {}, result: '*', eco: 'C70', opening: 'Ruy Lopez' } })
    const read = analysedFromStudy(named, makeStudy(named), { you: 'w' })
    assert.deepEqual(read.analysed?.opening, { eco: 'C70', name: 'Ruy Lopez' })

    const unnamed = analysedFromStudy(makeGame({ id: 'g2' }), makeStudy(makeGame({ id: 'g2' })), { you: 'w' })
    assert.equal(unnamed.analysed?.opening, undefined, 'and a game with no opening named has none')
  })

  test('a report with no depth recorded names nothing', () => {
    const game = makeGame({ id: 'g1' })
    const analysed = analysedGameFrom(
      game,
      { moves: [{ ply: 1, san: 'e4', mover: 'w', klass: 'best', loss: 0, depth: null }] },
      { you: 'w', analysedAt: 7 }
    )
    assert.equal(analysed.moves[0].klass, 'unclear')
    assert.equal(analysed.depth, 0)
  })
})

// ---------------------------------------------------------------- attempts, out of where they are really kept

/** A review card as the schedule holds one, so a test never asserts against a half-built record. */
const card = (o: { id: string; themes: readonly string[]; attempts?: number; solved?: number }): ReviewCard => ({
  exerciseId: o.id,
  themes: [...o.themes],
  scheduler: 'sm2',
  state: { interval: 1 },
  dueAt: 0,
  lastAt: 1,
  attempts: o.attempts ?? 1,
  solved: o.solved ?? 1,
  reviews: 0,
  lapses: 0,
  wrongRun: 0,
  fresh: false
})

const performance = (o: { id: string; at: number; solved: boolean; worth?: number; seconds?: number }): Performance => ({
  exerciseId: o.id,
  solved: o.solved,
  gaveUp: false,
  hintsUsed: 0,
  worth: o.worth ?? (o.solved ? 1 : 0),
  wrongMoves: 0,
  illegalTries: 0,
  seconds: o.seconds ?? 20,
  at: o.at
})

function puzzle(id: string, themes: readonly string[]): Puzzle {
  const exercise = newExercise({
    id,
    kind: 'puzzle',
    startFen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    objective: 'win-material',
    prompt: 'Win material.',
    materialAtLeast: 100,
    source: { kind: 'authored', by: 'a test' },
    tags: [...themes]
  })
  return {
    id,
    exercise,
    themes: themes.map((theme) => ({ theme, evidence: 'source', says: 'A test says so.' })) as Puzzle['themes'],
    rating: null,
    ratingFrom: null,
    addedAt: 1
  }
}

/** A puzzle collection with attempts in it, which is where a person's training evidence really lives today. */
function collection(o: { attempts: number; themes?: readonly string[]; solved?: boolean; worth?: number }): PuzzleStore {
  const one = puzzle('p1', o.themes ?? ['fork'])
  const records: Record<string, PuzzleRecord> = {
    p1: {
      puzzleId: 'p1',
      attempts: Array.from({ length: o.attempts }, (_, i) => ({
        ...performance({ id: 'p1', at: 1_000 + i, solved: o.solved ?? true, worth: o.worth }),
        // Every fourth solve was reached with the move already on screen, which is what `worth: 0` means.
        ...(i % 4 === 0 ? { worth: 0 } : {})
      }))
    }
  }
  return { ...emptyStore(), puzzles: [one], records }
}

describe('attempts, out of where they are really kept', () => {
  test('the puzzle collection\'s own attempts become evidence, carrying what the puzzle trains', () => {
    const records = trainingFromPuzzles(collection({ attempts: 3, themes: ['fork', 'pin'] }))
    assert.equal(records.length, 3)
    assert.deepEqual(records[0].themes, ['fork', 'pin'])
    assert.equal(records[0].kind, 'puzzle')
    assert.deepEqual(records.map((one) => one.performance.at), [1_000, 1_001, 1_002], 'oldest first')
  })

  test('an attempt at a puzzle that is no longer in the collection is kept, as evidence about nothing in particular', () => {
    const store = collection({ attempts: 2 })
    const records = trainingFromPuzzles({ ...store, puzzles: [] })
    assert.equal(records.length, 2, 'the attempt happened and is not thrown away')
    assert.deepEqual(records[0].themes, [], 'but nothing is claimed about what it was practising')
  })

  test('the Academy\'s attempts take their themes from the card the content put them on', () => {
    const progress = {
      records: [performance({ id: 't1', at: 10, solved: false }), performance({ id: 't2', at: 20, solved: true })],
      cards: [card({ id: 't1', themes: ['back-rank'] })]
    }
    const records = trainingFromAcademy(progress)
    assert.deepEqual(records.map((one) => one.kind), ['lesson-task', 'lesson-task'])
    assert.deepEqual(records[0].themes, ['back-rank'])
    assert.deepEqual(records[1].themes, [], 'and a task with no card is not given themes from somewhere else')
  })

  test('one attempt found in two places is counted once', () => {
    const same: TrainingRecord = { performance: performance({ id: 'p1', at: 1_000, solved: true }), kind: 'puzzle', themes: ['fork'] }
    const other: TrainingRecord = { performance: performance({ id: 'p1', at: 2_000, solved: true }), kind: 'puzzle', themes: ['fork'] }
    assert.equal(mergeTraining([[same], [same, other]]).length, 2)
  })

  test('a review schedule is rebuilt only where none was saved, and the saved one is left alone', () => {
    const records = trainingFromPuzzles(collection({ attempts: 5 }))
    const fresh = cardsForAttempts(records, [])
    assert.equal(fresh.rebuilt, 1)
    assert.equal(fresh.cards[0].attempts, 5, 'every attempt went through the scheduler')
    assert.deepEqual(fresh.cards[0].themes, ['fork'])
    assert.equal(fresh.cards[0].fresh, false)

    const held = card({ id: 'p1', themes: ['fork'], attempts: 99 })
    const kept = cardsForAttempts(records, [held])
    assert.equal(kept.rebuilt, 0)
    assert.deepEqual(kept.cards, [held])
  })

  test('attempts at an exercise with no themes make no card, because a themeless card answers nothing', () => {
    const records = trainingFromPuzzles(collection({ attempts: 5, themes: [] }))
    assert.equal(cardsForAttempts(records, []).rebuilt, 0)
  })
})

// ---------------------------------------------------------------- the whole gathering, against the coach

const academy = (o: Partial<AcademyProgress> = {}): AcademyProgress => ({
  version: 1,
  curriculumId: 'c',
  curriculumVersion: 1,
  records: [],
  reading: [],
  cards: [],
  skipped: [],
  place: null,
  savedAt: null,
  ...o
})

describe('what a person has, gathered', () => {
  test('somebody with nothing at all gets nothing, and the screen is told so', () => {
    const got = gatherEvidence({ games: [], studies: [], training: undefined, openings: undefined })
    assert.equal(got.empty, true)
    assert.equal(got.coverage.yours, 0)
    assert.equal(got.coverage.analysed, 0)
    assert.match(got.coverage.says, /No games of your own are saved yet/)

    const profile = weaknessProfile(got.evidence, 10_000)
    assert.equal(profile.weaknesses.length, 0)
    assert.equal(profile.silent, true)
    assert.match(profile.says, /Nothing has been recorded yet/)
  })

  test('games nobody has analysed are counted as not analysed, never as clean', () => {
    const games = [makeGame({ id: 'g1' }), makeGame({ id: 'g2' }), makeGame({ id: 'g3' })]
    const got = gatherEvidence({ games, studies: [] })
    assert.equal(got.coverage.yours, 3)
    assert.equal(got.coverage.analysed, 0)
    assert.equal(got.coverage.notAnalysed, 3, 'the three are missing from the evidence, not clean in it')
    assert.match(got.coverage.says, /none of them has been through the engine/)
    assert.match(got.coverage.says, /not as good and not as bad/)
    assert.equal(got.evidence.games?.length, 0)

    const profile = weaknessProfile(got.evidence, 10_000)
    assert.equal(profile.counted.games, 0)
    assert.equal(profile.counted.judgedMoves, 0)
    assert.ok(profile.refusals.some((one) => /Nothing has been analysed deeply enough/.test(one.says)))
  })

  test('a game somebody else played is not one of yours, and is not counted either way', () => {
    const watched = makeGame({
      id: 'g1',
      source: { kind: 'broadcast', provider: 'lichess', providerGameId: 'x', retrievedAt: 1 }
    })
    const got = gatherEvidence({ games: [watched, makeGame({ id: 'g2' })], studies: [] })
    assert.equal(got.coverage.yours, 1)
    assert.equal(got.coverage.others, 1)
    assert.equal(got.coverage.notAnalysed, 1)
  })

  test('analysed games reach the coach with their moves, and the counts are the ones that were observed', () => {
    const games = [1, 2, 3].map((n) => makeGame({ id: `g${n}`, meta: { white: { name: 'Kesh' }, black: { name: 'Stockfish 16' } } }))
    const studies = games.map((game) => makeStudy(game, { swings: [3] }))
    const got = gatherEvidence({ games, studies })

    assert.equal(got.coverage.analysed, 3)
    assert.equal(got.coverage.deepEnough, 3)
    assert.equal(got.coverage.notAnalysed, 0)
    assert.equal(got.coverage.sideUnknown, 0, 'the engine\'s own name says which side was theirs')
    assert.match(got.coverage.says, /3 of your 3 games have been through the engine/)

    const profile = weaknessProfile(got.evidence, 10_000)
    assert.equal(profile.counted.games, 3, 'all three are deep enough to count')
    assert.equal(profile.counted.judgedMoves, 24, 'eight of their own moves in each of three games')
    // Three short games are not enough moves to put a rate on, and that refusal names the shortfall rather than
    // reporting a clean record.
    const refusal = profile.refusals.find((one) => one.about === 'how often your moves go seriously wrong')
    assert.equal(refusal?.have, 24)
    assert.equal(refusal?.need, EVIDENCE.judgedMoves)
  })

  test('an analysis of a game that is gone, and one of a game that has changed, are both reported', () => {
    const game = makeGame({ id: 'g1' })
    const moved: StoredGame = { ...game, id: 'g2', fingerprint: 'changed-since' }
    const got = gatherEvidence({ games: [moved], studies: [makeStudy(game), { ...makeStudy(game), gameId: 'g2', id: 'g2' }] })
    assert.equal(got.coverage.withoutAGame, 1)
    assert.equal(got.coverage.staleGame, 1)
    assert.equal(got.coverage.analysed, 0)
    assert.ok(got.notes.some((one) => /not one of your own/.test(one)))
    assert.ok(got.notes.some((one) => /moves have changed since/.test(one)))
  })

  test('a file that could not be read is said out loud, and is not the same as there being nothing in it', () => {
    const got = gatherEvidence({ games: [], studies: null, training: null, openings: null, academy: null })
    assert.ok(got.notes.some((one) => /saved analyses could not be read/.test(one)))
    assert.ok(got.notes.some((one) => /puzzles and training records could not be read/.test(one)))
    assert.ok(got.notes.some((one) => /opening repertoire could not be read/.test(one)))
    assert.ok(got.notes.some((one) => /Academy record could not be read/.test(one)))
    for (const note of got.notes.filter((one) => /could not be read/.test(one))) {
      assert.match(note, /not been written over/, 'and nothing is written over what could not be read')
    }
  })

  test('one attempt short of the threshold, the coach refuses and says what is missing', () => {
    const training = { puzzles: collection({ attempts: EVIDENCE.trainingAttempts - 1 }), exercises: [], cards: [], attempts: [], ratings: [], runs: [] }
    const got = gatherEvidence({ games: [], studies: [], training })
    assert.equal(got.evidence.training?.length, EVIDENCE.trainingAttempts - 1)
    assert.equal(got.empty, false, 'there is evidence; there is simply not enough of it')

    const profile = weaknessProfile(got.evidence, 10_000)
    assert.equal(profile.counted.trainingAttempts, EVIDENCE.trainingAttempts - 1)
    assert.equal(profile.weaknesses.some((one) => one.kind === 'hint-dependence'), false)
    const refusal = profile.refusals.find((one) => one.about === 'how you go about training')
    assert.ok(refusal, 'the shortfall is named rather than left blank')
    assert.equal(refusal.have, EVIDENCE.trainingAttempts - 1)
    assert.equal(refusal.need, EVIDENCE.trainingAttempts)
  })

  test('one attempt over it, the coach reports, and the count it rests on is in the words', () => {
    const training = { puzzles: collection({ attempts: EVIDENCE.trainingAttempts }), exercises: [], cards: [], attempts: [], ratings: [], runs: [] }
    const got = gatherEvidence({ games: [], studies: [], training })
    const profile = weaknessProfile(got.evidence, 10_000)

    assert.equal(profile.counted.trainingAttempts, EVIDENCE.trainingAttempts)
    const found = profile.weaknesses.find((one) => one.kind === 'hint-dependence')
    assert.ok(found, 'with enough attempts the habit is reported')
    assert.match(found.because, /4 of 15/, 'and it says how many times, out of how many chances')
    assert.deepEqual(found.evidence.map((one) => [one.hits, one.of]), [[4, 15]])
  })

  test('the themes a person gets wrong come out of the schedule rebuilt from their own attempts', () => {
    // Five attempts at one theme is `spaced.ts`'s own threshold, and four of these five were not solved.
    const store = collection({ attempts: 5, themes: ['fork'], solved: false, worth: 0 })
    const training = { puzzles: store, exercises: [], cards: [], attempts: [], ratings: [], runs: [] }
    const got = gatherEvidence({ games: [], studies: [], training })
    assert.ok(got.notes.some((one) => /review schedule over 1 exercise is not saved yet/.test(one)))

    const profile = weaknessProfile(got.evidence, 10_000)
    const theme = profile.weaknesses.find((one) => one.kind === 'theme')
    assert.ok(theme, 'the theme is named')
    assert.equal(theme.label, 'fork')
    assert.match(theme.because, /0 of 5/)
  })

  test('the Academy\'s own attempts and cards count too, and an attempt is never counted twice', () => {
    const shared = performance({ id: 't1', at: 500, solved: true })
    const training = { puzzles: emptyStore(), exercises: [], cards: [], attempts: [{ performance: shared, kind: 'lesson-task' as const, themes: ['pin'] }], ratings: [], runs: [] }
    const got = gatherEvidence({
      games: [],
      studies: [],
      training,
      academy: academy({ records: [shared], cards: [card({ id: 't1', themes: ['pin'] })] })
    })
    assert.equal(got.evidence.training?.length, 1, 'the same attempt in two files is one attempt')
    assert.equal(got.evidence.cards?.length, 1, 'and the saved card is used rather than a rebuilt one')
  })

  test('the finishing rate has nothing to count, and says so instead of showing nought per cent', () => {
    const got = gatherEvidence({ games: [], studies: [] })
    assert.deepEqual(got.completions, [])
    assert.ok(got.notes.some((one) => /reading is not finishing/.test(one)))
  })

  test('with the Library unread, nothing about your own play is claimed', () => {
    const game = makeGame({ id: 'g1' })
    const got = gatherEvidence({ studies: [makeStudy(game)] })
    assert.equal(got.coverage.gamesKnown, false)
    assert.equal(got.coverage.analysed, 0)
    assert.match(got.coverage.says, /Your saved games were not read/)
  })

  test('opening drills come through as they are stored', () => {
    const recall = [{ name: 'Catalan', side: 'w' as const, correct: 3, length: 8, complete: false, at: 100 }]
    const got = gatherEvidence({ games: [], studies: [], openings: { repertoire: { lines: [] }, recall } })
    assert.deepEqual(got.evidence.openings, recall)
    assert.equal(got.empty, false)
  })
})
