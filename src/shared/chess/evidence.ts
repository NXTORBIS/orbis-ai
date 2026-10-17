import { EVIDENCE, type AnalysedGame, type AnalysedMove, type CoachEvidence, type OpeningRecallRecord, type TrainingRecord } from './coach.ts'
import { afterAttempt, newCard, type ReviewCard } from './spaced.ts'
import { themeNames, type PuzzleStore } from './puzzles.ts'
import { fenAt, type StoredGame } from './model.ts'
import { buildReport, type PositionEval } from './analysis.ts'
import type { StoredNode, StoredStudy } from './study.ts'
import type { CompletionRecord } from './progress.ts'
import type { AcademyProgress } from './academyPath.ts'
import type { StoredOpenings, StoredTraining } from './kept.ts'
import type { Side } from './evaluation.ts'

/**
 * Where the coach's evidence comes from (Sections 001, 161, 164, 166).
 *
 * `coach.ts` reads a `CoachEvidence` and nothing in Orbis built one, so the coach panel sat at zero on every machine
 * however much chess somebody had played. This is the part that was missing. It takes what Orbis really keeps -- the
 * games, the puzzle collection and the attempts in it, the Academy's attempts and the review cards over them, the
 * opening drills, and the engine's own answers in the analyses that have been saved -- and puts them in the shape the
 * coach reads.
 *
 * ## It only gathers; it never concludes
 *
 * There is not one threshold, rate or judgement in here. `coach.ts` decides what counts as a weakness and what has to
 * be refused, `spaced.ts` decides how a theme stands, `analysis.ts` decides what a move is called and `rules.ts`
 * decides what a position is. This file moves records from where they are stored into one shape and counts what it
 * had to leave out. Keeping it to that is why a mistake here can only ever be a missing observation, never an
 * invented one.
 *
 * ## A game nobody analysed is not a clean game
 *
 * The rule that shapes everything below. An error rate needs an engine to have been over the moves, so a game that
 * has never been analysed contributes **nothing** -- not a zero, not a clean sheet. Counting it either way would mean
 * somebody's figures improving every time they played a game and never looked at it. `AnalysisCoverage` therefore
 * carries both numbers, how many of a person's games have been through the engine and how many have not, and the
 * screen shows them side by side.
 *
 * ## One thing is worked out rather than read, and why that is not inventing it
 *
 * The review schedule over puzzle attempts. The attempts themselves are stored -- one per go, in the puzzle
 * collection -- but the cards over them are not saved yet, and `themeStandings` in `spaced.ts` reads cards. So rather
 * than answer "how is this theme going" a second way, the attempts are put back through `spaced.ts`'s own `newCard`
 * and `afterAttempt`, in the order they happened, each at the moment it happened. Every number on the card then comes
 * out of the same arithmetic the review queue would have used, over attempts that really took place. It is reported
 * in `notes`, so nobody has to guess that it happened.
 *
 * ## Pure
 *
 * Records in, records out, with `now` as an argument. No files, no window, no clock of its own.
 */

// ---------------------------------------------------------------- which side was yours

const sameName = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Which side of a game the person played, or null when the record does not say.
 *
 * Null is a perfectly good answer and happens often: a game from a tournament book names two other people, and a
 * game played here against the engine carries the person's own name only if they typed one. `coach.ts` already has a
 * refusal for it -- "this game says nothing about you" -- which is far better than assuming White and filing
 * somebody else's blunders under their name.
 *
 * `names` is what the person is called in a game record. It is handed in, never guessed.
 */
export function sideYouPlayed(game: Pick<StoredGame, 'source' | 'meta'>, names: readonly string[] = []): Side | null {
  // A broadcast is somebody else's game, whoever is in it. Watching a game is not playing one.
  if (game.source.kind === 'broadcast') return null

  if (game.source.kind === 'local-engine') {
    const engine = game.source.engine
    const whiteIsEngine = sameName(game.meta.white.name, engine)
    const blackIsEngine = sameName(game.meta.black.name, engine)
    if (whiteIsEngine !== blackIsEngine) return whiteIsEngine ? 'b' : 'w'
    // Neither side carries the engine's name, which is what happens when the handshake never gave one. Fall through
    // to the person's own names rather than picking a side.
  }

  const white = names.some((one) => sameName(game.meta.white.name, one))
  const black = names.some((one) => sameName(game.meta.black.name, one))
  // Both sides matching means a game against yourself, or two people who share a name. Neither tells us anything.
  if (white === black) return null
  return white ? 'w' : 'b'
}

/** Games that could be evidence about this person at all. A broadcast of two other players never can be. */
export const isYourGame = (game: Pick<StoredGame, 'source'>): boolean => game.source.kind !== 'broadcast'

/**
 * The names this person plays under, learned from the games played here.
 *
 * A game against the engine says which side the engine was, so the other side's name -- when one was typed -- is
 * this person's. That one name is then what identifies them in a game brought in from a file, where nothing else
 * could. It is read off records that exist and never made up: somebody who has never typed a name gets an empty
 * list, and their imported games stay "does not say which side you played".
 */
export function namesYouPlayUnder(games: readonly Pick<StoredGame, 'source' | 'meta'>[]): string[] {
  const found = new Map<string, string>()
  for (const game of games) {
    if (game.source.kind !== 'local-engine') continue
    const side = sideYouPlayed(game)
    if (side === null) continue
    const name = (side === 'w' ? game.meta.white.name : game.meta.black.name)?.trim()
    if (name) found.set(name.toLowerCase(), name)
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------- an analysis, in the shape the coach reads

/**
 * One analysed game, built from a real report.
 *
 * Two things are enforced here rather than trusted, because a report is built to whatever depth the caller asked for
 * and the coach's bar is higher than the report's own default:
 *
 *   - **A move the search cannot carry is not named.** Anything judged on a search shallower than
 *     `EVIDENCE.minDepth`, or with no depth recorded at all, comes through as `unclear` with no centipawn number.
 *     `coach.ts` counts those apart and never folds them into a rate, which is the honest place for them.
 *   - **The game's depth is its weakest judgement.** `depth` is the shallowest search behind any move that kept a
 *     name, so "analysed to depth 16" means every judgement in the game rests on at least 16 -- not that one
 *     position somewhere happened to reach 16. A game where nothing survived the bar gets 0, and the coach leaves it
 *     out and says how many it left out.
 *
 * Both sides' moves are kept. `AnalysedMove.side` is what the coach picks by, and keeping one side only would mean
 * analysing the game again if which side was played were ever worked out later.
 */
export function analysedGameFrom(
  game: Pick<StoredGame, 'id' | 'startFen' | 'moves' | 'meta'>,
  report: { moves: readonly { ply: number; san: string; mover: Side; klass: AnalysedMove['klass']; loss: number | null; depth: number | null }[] },
  o: { you: Side | null; analysedAt: number }
): AnalysedGame {
  const moves: AnalysedMove[] = []
  const depths: number[] = []
  for (const row of report.moves) {
    const tooShallow = row.depth === null || row.depth < EVIDENCE.minDepth
    const clock = game.moves[row.ply - 1]?.clock
    if (!tooShallow && row.klass !== 'unclear') depths.push(row.depth as number)
    moves.push({
      ply: row.ply,
      side: row.mover,
      san: row.san,
      before: fenAt(game, row.ply - 1),
      klass: tooShallow ? 'unclear' : row.klass,
      // The difference between two searches too shallow to name the move is not a measurement of what was given
      // away, so it is dropped rather than carried as though it were one.
      loss: tooShallow ? null : row.loss,
      ...(typeof clock === 'number' ? { secondsLeft: clock } : {})
    })
  }
  const opening = {
    ...(game.meta.eco ? { eco: game.meta.eco } : {}),
    ...(game.meta.opening ? { name: game.meta.opening } : {})
  }
  return {
    gameId: game.id,
    you: o.you,
    analysedAt: o.analysedAt,
    depth: depths.length === 0 ? 0 : Math.min(...depths),
    moves,
    ...(Object.keys(opening).length > 0 ? { opening } : {})
  }
}

/**
 * The game's own line through a saved analysis: the node that each position sits on, the starting position first.
 *
 * It is walked move by move rather than taken as the tree's first children, because promoting a branch makes
 * somebody's own idea the tree's main line. The game is the game; the line followed here is the one whose moves match
 * the game's moves, so a person who promoted a variation does not have their suggestion counted as something they
 * played. The walk stops where the tree stops following the game, and the plies after that have no node.
 */
export function lineThroughStudy(game: Pick<StoredGame, 'moves'>, study: Pick<StoredStudy, 'rootId' | 'nodes'>): string[] {
  const byId = new Map<string, StoredNode>(study.nodes.map((one) => [one.id, one]))
  const out: string[] = []
  let here: StoredNode | undefined = byId.get(study.rootId)
  if (here === undefined) return out
  out.push(here.id)
  for (const move of game.moves) {
    const children: StoredNode[] = here.children.flatMap((id) => {
      const child = byId.get(id)
      return child === undefined ? [] : [child]
    })
    const next: StoredNode | undefined = children.find((child) => child.move?.uci === move.uci)
    if (next === undefined) break
    out.push(next.id)
    here = next
  }
  return out
}

export interface StudyReading {
  /** What the coach can read out of this analysis, or null when there is nothing in it for the coach. */
  analysed: AnalysedGame | null
  /** Which of the answers this is, so a caller counts the two kinds of nothing apart rather than by their wording. */
  kind: 'read' | 'game-changed' | 'no-engine-answers'
  /** Why there is nothing, in words to show. Null when there is something. */
  why: string | null
}

/**
 * What the coach can read out of one saved analysis.
 *
 * The report is worked out here rather than stored, the same way the Analysis Studio works it out every time it
 * draws: the engine's answers are what was saved, with the depth behind each one, and a stored report would be a
 * second answer that could only ever be the staler of the two.
 *
 * A game whose moves have changed since it was analysed is **refused**, not patched up. Every answer in the analysis
 * is about a position reached by the old moves, so reading them onto the new ones would attribute the engine's
 * opinion of one position to another -- which is the single worst thing this pipeline could do.
 */
export function analysedFromStudy(
  game: Pick<StoredGame, 'id' | 'startFen' | 'moves' | 'meta' | 'fingerprint'>,
  study: StoredStudy,
  o: { you: Side | null }
): StudyReading {
  if (study.fingerprint !== game.fingerprint) {
    return {
      analysed: null,
      kind: 'game-changed',
      why: 'The game\'s moves have changed since it was analysed, so the engine\'s answers are about positions this '
        + 'game no longer reaches. They are kept, and not counted.'
    }
  }
  const line = lineThroughStudy(game, study)
  const evaluations: PositionEval[] = []
  for (const [ply, nodeId] of line.entries()) {
    const found = study.evaluations[nodeId]
    if (!found) continue
    evaluations.push({
      ply,
      fen: found.fen,
      score: found.score,
      depth: found.depth,
      ...(found.bestmove !== undefined ? { bestmove: found.bestmove } : {}),
      ...(found.pvUci ? { pvUci: found.pvUci } : {}),
      ...(found.engine ? { engine: found.engine } : {}),
      ...(found.at !== undefined ? { at: found.at } : {}),
      ...(found.provisional !== undefined ? { provisional: found.provisional } : {})
    })
  }
  if (evaluations.length === 0) {
    return {
      analysed: null,
      kind: 'no-engine-answers',
      why: 'The engine has not answered anything in this game. The lines and notes in it are kept; there is nothing '
        + 'for the coach to count.'
    }
  }
  // Built to the coach's own bar, so a move it would not trust comes back unnamed rather than named and then thrown
  // away further down.
  const report = buildReport(game, evaluations, { minDepth: EVIDENCE.minDepth })
  return { analysed: analysedGameFrom(game, report, { you: o.you, analysedAt: study.savedAt }), kind: 'read', why: null }
}

// ---------------------------------------------------------------- training attempts

const byTime = (a: TrainingRecord, b: TrainingRecord): number => a.performance.at - b.performance.at

/**
 * The attempts the puzzle collection has recorded.
 *
 * This is where a person's training evidence actually is today: `recordAttempt` in `puzzles.ts` files one of these
 * whenever somebody finishes a puzzle, and the collection is saved to the profile. What the puzzle trains comes from
 * the puzzle's own theme claims through `themeNames`, so the coach and the puzzle screen cannot disagree about what a
 * puzzle was about.
 *
 * An attempt whose puzzle has since been taken out of the collection is kept, with no themes. It happened; it is
 * simply evidence about nothing in particular now, which is exactly how `coach.ts` reads an attempt with no themes.
 */
export function trainingFromPuzzles(store: PuzzleStore): TrainingRecord[] {
  const puzzles = new Map(store.puzzles.map((one) => [one.id, one]))
  const out: TrainingRecord[] = []
  for (const record of Object.values(store.records)) {
    const puzzle = puzzles.get(record.puzzleId)
    for (const attempt of record.attempts) {
      out.push({
        performance: attempt,
        kind: puzzle ? puzzle.exercise.kind : 'puzzle',
        themes: puzzle ? themeNames(puzzle) : []
      })
    }
  }
  return out.sort(byTime)
}

/**
 * The attempts the Academy has recorded.
 *
 * The Academy keeps one record per go at a lesson task, and one review card per task carrying that task's tags. So
 * the themes are looked up from the card rather than left blank -- the card is where the content put them, and
 * nothing here invents one.
 */
export function trainingFromAcademy(progress: Pick<AcademyProgress, 'records' | 'cards'>): TrainingRecord[] {
  const themes = new Map(progress.cards.map((card) => [card.exerciseId, card.themes]))
  return progress.records
    .map((performance) => ({
      performance,
      kind: 'lesson-task' as const,
      themes: themes.get(performance.exerciseId) ?? []
    }))
    .sort(byTime)
}

/** One attempt counted once, however many of the places it was found in. */
export function mergeTraining(lists: readonly (readonly TrainingRecord[])[]): TrainingRecord[] {
  const seen = new Set<string>()
  const out: TrainingRecord[] = []
  for (const list of lists) {
    for (const one of list) {
      const key = `${one.performance.exerciseId}:${one.performance.at}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(one)
    }
  }
  return out.sort(byTime)
}

/**
 * The review schedule over attempts that have none saved.
 *
 * The cards are what `spaced.ts` answers "how is this theme going" from, and the puzzle screen does not save them
 * yet. Rather than answer that question a second way, the attempts go back through the scheduler's own functions, in
 * order, each at the moment it happened -- so the card that comes out is the card the review queue would be holding.
 * An exercise that already has a saved card is left completely alone: the saved one is the real one.
 *
 * Attempts at an exercise with no themes are skipped. A card with no themes tells `themeStandings` nothing, so
 * building one would be work that changes no answer.
 */
export function cardsForAttempts(
  records: readonly TrainingRecord[],
  have: readonly ReviewCard[]
): { cards: ReviewCard[]; rebuilt: number } {
  const already = new Set(have.map((one) => one.exerciseId))
  const grouped = new Map<string, TrainingRecord[]>()
  for (const one of records) {
    const id = one.performance.exerciseId
    if (already.has(id) || one.themes.length === 0) continue
    const held = grouped.get(id) ?? []
    held.push(one)
    grouped.set(id, held)
  }
  const built: ReviewCard[] = []
  for (const [id, attempts] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const first = attempts[0]
    let card = newCard({ exerciseId: id, themes: first.themes, now: first.performance.at })
    for (const attempt of attempts) card = afterAttempt(card, attempt.performance, attempt.performance.at).card
    built.push(card)
  }
  return { cards: [...have, ...built], rebuilt: built.length }
}

// ---------------------------------------------------------------- what was gathered, and what was not

export interface EvidenceSources {
  /**
   * The person's saved games.
   *
   * The denominator of "how many of your games have been analysed", and where which side they played is read from.
   * Left out means the Library was not read, which the coverage says rather than reporting nought games.
   */
  games?: readonly StoredGame[]
  /**
   * The analyses that have been saved, one per game.
   *
   * `null` means the file is there and could not be read, which is not the same as there being none, and the notes
   * say which. Nothing is ever written back from here.
   */
  studies?: readonly StoredStudy[] | null
  /** `chess-training.json`: the puzzle collection with its attempts, the exercises and the review cards. */
  training?: StoredTraining | null
  /** `chess-openings.json`: the repertoire and the goes at playing a line back from memory. */
  openings?: StoredOpenings | null
  /** `chess-academy.json`: the lesson-task attempts and the cards over them. */
  academy?: AcademyProgress | null
  /** Names this person plays under, on top of the ones their own games already show. Nothing here guesses one. */
  names?: readonly string[]
}

export interface AnalysisCoverage {
  /** True when the Library was read at all. False means every number below is about the analyses alone. */
  gamesKnown: boolean
  /** Games of your own that are saved. A broadcast of two other players is not one of yours. */
  yours: number
  /** Games you saved that were somebody else's. Not counted either way. */
  others: number
  /** Of your own games, how many have an analysis with the engine's answers in it. */
  analysed: number
  /** Of your own games, how many have not. Never counted as clean. */
  notAnalysed: number
  /** Analyses deep enough for the coach to read, at `EVIDENCE.minDepth` or more. */
  deepEnough: number
  /** Analyses that exist but were searched too shallowly to judge a player by. */
  tooShallow: number
  /** Analyses of a game whose record does not say which side you played. */
  sideUnknown: number
  /** Saved analyses of a game that is not one of your own: removed from the Library, or somebody else's broadcast. */
  withoutAGame: number
  /** Saved analyses the engine never answered anything in: somebody's own lines and notes, and nothing to count. */
  withoutEngineAnswers: number
  /** Saved analyses of a game whose moves have changed since, which cannot be read back onto it. */
  staleGame: number
  /** The whole of it in a sentence, including when the sentence is "none yet". */
  says: string
}

export interface GatheredEvidence {
  evidence: CoachEvidence
  /** Things started and finished, for the finishing rate. Empty until something records a finish. */
  completions: readonly CompletionRecord[]
  coverage: AnalysisCoverage
  /** Where each kind of observation came from and what was left out, in sentences meant to be shown as they are. */
  notes: readonly string[]
  /** True when not one observation of any kind was found. */
  empty: boolean
}

/** Said once, because it is the reason the finishing rate is empty rather than nought per cent. */
export const NO_COMPLETIONS_NOTE =
  'Nothing in Chess World records the moment a lesson or a course was finished, so the finishing rate has nothing to '
  + 'count. How far you have read through a lesson is kept, and reading is not finishing, so it is not counted as one.'

/**
 * Everything the coach can read, out of everything Orbis keeps.
 *
 * Each source is optional, and a source left out is simply not evidence -- which is a different thing from a source
 * that could not be read. The caller knows about the second kind, because the store tells it in a sentence written to
 * be shown, and passes `null`; the notes then say this screen is working without that file rather than implying there
 * was nothing in it.
 *
 * There is deliberately no `now` here. Moving records from where they are stored into one shape does not depend on
 * what time it is -- every date used is the one on the record itself -- and `weaknessProfile` and `progressReport`
 * are the ones that take the clock, because they are the ones that measure a stretch of it.
 */
export function gatherEvidence(sources: EvidenceSources): GatheredEvidence {
  const notes: string[] = []

  // ---- the games, and which of them the engine has been over
  const gamesKnown = sources.games !== undefined
  const games = sources.games ?? []
  const yours = games.filter(isYourGame)
  const others = games.length - yours.length
  const names = [...new Set([...namesYouPlayUnder(games), ...(sources.names ?? [])])]
  const byId = new Map(yours.map((one) => [one.id, one]))

  const analyses: AnalysedGame[] = []
  let withoutAGame = 0
  let withoutEngineAnswers = 0
  let staleGame = 0
  for (const study of sources.studies ?? []) {
    // An analysis can only be read against the game it is about: the moves decide which position each answer
    // belongs to. So a game that has been deleted, or a broadcast of two other players, leaves its analysis
    // uncounted -- and that is counted rather than passed over in silence.
    const game = byId.get(study.gameId)
    if (!game) { withoutAGame += 1; continue }
    const read = analysedFromStudy(game, study, { you: sideYouPlayed(game, names) })
    if (read.analysed === null) {
      if (read.kind === 'game-changed') staleGame += 1
      else withoutEngineAnswers += 1
      continue
    }
    analyses.push(read.analysed)
  }
  const deepEnough = analyses.filter((one) => one.depth >= EVIDENCE.minDepth).length
  const sideUnknown = analyses.filter((one) => one.you === null).length
  const coverage: AnalysisCoverage = {
    gamesKnown,
    yours: yours.length,
    others,
    analysed: analyses.length,
    notAnalysed: Math.max(0, yours.length - analyses.length),
    deepEnough,
    tooShallow: analyses.length - deepEnough,
    sideUnknown,
    withoutAGame,
    withoutEngineAnswers,
    staleGame,
    says: coverageWords({ known: gamesKnown, yours: yours.length, analysed: analyses.length, deepEnough })
  }

  if (sources.studies === null) {
    notes.push('Your saved analyses could not be read, so nothing from your own games is counted here. They have not '
      + 'been written over.')
  }
  if (staleGame > 0) {
    notes.push(`${staleGame} saved ${staleGame === 1 ? 'analysis is' : 'analyses are'} of a game whose moves have `
      + `changed since, so ${staleGame === 1 ? 'it is' : 'they are'} not counted: every answer in ${staleGame === 1 ? 'it' : 'them'} `
      + 'is about a position the game no longer reaches.')
  }
  if (withoutEngineAnswers > 0) {
    notes.push(`${withoutEngineAnswers} saved ${withoutEngineAnswers === 1 ? 'analysis has' : 'analyses have'} lines or `
      + 'notes in but no answers from the engine, so there is nothing in them to count.')
  }
  if (withoutAGame > 0) {
    notes.push(`${withoutAGame} saved ${withoutAGame === 1 ? 'analysis is' : 'analyses are'} of a game that is not one `
      + `of your own -- removed from the Library, or a broadcast of somebody else's -- so ${withoutAGame === 1 ? 'it is' : 'they are'} `
      + 'left out.')
  }
  if (sideUnknown > 0) {
    notes.push(`${sideUnknown} analysed ${sideUnknown === 1 ? 'game does' : 'games do'} not say which side you played, `
      + `so the moves in ${sideUnknown === 1 ? 'it are' : 'them are'} not counted as anybody's. Putting your name on `
      + 'the game in the Library is what fixes that.')
  }

  // ---- the training attempts
  const training = sources.training ?? null
  const academy = sources.academy ?? null
  const fromPuzzles = training === null ? [] : trainingFromPuzzles(training.puzzles)
  const fromAcademy = academy === null ? [] : trainingFromAcademy(academy)
  const attempts = mergeTraining([training === null ? [] : training.attempts, fromPuzzles, fromAcademy])
  if (sources.training === null) {
    notes.push('Your puzzles and training records could not be read, so nothing from them is counted here. They have '
      + 'not been written over.')
  }
  if (sources.academy === null) {
    notes.push('Your Academy record could not be read, so nothing from it is counted here. It has not been written over.')
  }
  if (fromPuzzles.length > 0) {
    notes.push(`${fromPuzzles.length} ${fromPuzzles.length === 1 ? 'attempt' : 'attempts'} at puzzles, from your own collection.`)
  }
  if (fromAcademy.length > 0) {
    notes.push(`${fromAcademy.length} ${fromAcademy.length === 1 ? 'attempt' : 'attempts'} at lesson tasks, from your Academy record.`)
  }

  // ---- the review schedule over them
  const held = [...(training?.cards ?? []), ...(academy?.cards ?? [])]
  const { cards, rebuilt } = cardsForAttempts(attempts, held)
  if (rebuilt > 0) {
    notes.push(`The review schedule over ${rebuilt} ${rebuilt === 1 ? 'exercise' : 'exercises'} is not saved yet, so it `
      + 'was worked out again from your own attempts, in the order they happened, by the same scheduler that would '
      + 'have kept it.')
  }

  // ---- the opening drills
  const openings: readonly OpeningRecallRecord[] = sources.openings?.recall ?? []
  if (sources.openings === null) {
    notes.push('Your opening repertoire could not be read, so no opening drills are counted here. It has not been '
      + 'written over.')
  }

  notes.push(NO_COMPLETIONS_NOTE)

  const evidence: CoachEvidence = { games: analyses, training: attempts, openings, cards }
  const empty = analyses.length === 0 && attempts.length === 0 && openings.length === 0 && cards.length === 0

  return { evidence, completions: [], coverage, notes, empty }
}

function coverageWords(o: { known: boolean; yours: number; analysed: number; deepEnough: number }): string {
  const { yours, analysed, deepEnough } = o
  if (!o.known) {
    return 'Your saved games were not read. An analysis can only be read against the game it is about, so nothing '
      + 'about your own play is counted here at all.'
  }
  if (yours === 0) return 'No games of your own are saved yet, so there is nothing for the engine to go through.'
  if (analysed === 0) {
    return `${yours} of your own ${yours === 1 ? 'game is' : 'games are'} saved and none of them has been through the `
      + 'engine. A game nobody has analysed says nothing about how it was played, so none of them is counted here -- '
      + 'not as good and not as bad.'
  }
  const rest = yours - analysed
  const shallow = analysed - deepEnough
  const deep = shallow === 0
    ? ''
    : ` ${shallow} of those ${shallow === 1 ? 'was' : 'were'} searched too shallowly to judge a player by, so `
      + `${deepEnough} ${deepEnough === 1 ? 'game counts' : 'games count'}.`
  const left = rest === 0
    ? ''
    : ` The other ${rest} ${rest === 1 ? 'is' : 'are'} not counted either way, because a game nobody has analysed says `
      + 'nothing about how it was played.'
  return `${analysed} of your ${yours} games ${analysed === 1 ? 'has' : 'have'} been through the engine.${deep}${left}`
}
