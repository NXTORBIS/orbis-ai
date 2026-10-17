import { boardSquares } from './rules.ts'
import { PIECE_VALUE, type ExerciseKind } from './exercise.ts'
import type { MoveClass, Side } from './evaluation.ts'
import type { Performance } from './attempt.ts'
import { themeStandings, type ReviewCard } from './spaced.ts'

/**
 * What the record shows you are bad at, and nothing more than that (Sections 161-170).
 *
 * ## It is built from evidence or it is not built
 *
 * Every weakness in here comes from something that was recorded: a move an engine judged in one of your own games, an
 * attempt at an exercise, a line you tried to play back from memory. There is no model of a player, no profile that
 * fills itself in, no "players at your level tend to". A claim that cannot be traced back to counted observations is
 * not made, and the thing that would have been said is listed as a **refusal** instead -- with the number of
 * observations there are and the number needed, so it is clear what is missing rather than merely absent.
 *
 * That is why `Weakness` carries `evidence` and `because` as required fields. A weakness that cannot say how many
 * times it was seen, and out of how many chances, has no business being on a screen.
 *
 * ## What this deliberately does not do
 *
 * **No rating estimate.** A rating is a result of games against rated opponents. Orbis has none, and a number derived
 * from puzzle solving dressed up as a rating would be a fabrication with a very convincing look.
 *
 * **No psychology.** Nothing here says you are impatient, or lose concentration, or play better when relaxed. Where a
 * habit can be counted -- answers given inside five seconds that were wrong -- the count is reported as a count, and
 * the word for it stays factual.
 *
 * **No second opinion on chess.** `rules.ts` decides what a position is. `evaluation.ts` decides what a move is
 * called. `spaced.ts` already answers how a training theme is going and is asked rather than reimplemented.
 *
 * ## Pure
 *
 * Records in, conclusions out, with `now` as an argument. Nothing is stored, nothing is fetched, nothing is drawn.
 */

// ---------------------------------------------------------------- the phases of a game

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

/**
 * Where the phase boundaries are, written down because they are a convention and not a fact.
 *
 * Chess has no official moment when the middlegame begins. Any boundary is a choice, so the choice is stated here and
 * shown wherever a per-phase number is shown -- otherwise "your endgame is weak" is a claim about an undefined word.
 */
export const PHASE_RULE =
  'A position counts as an endgame when the pieces other than kings and pawns are worth 1,300 centipawns or less in '
  + 'total, both sides together -- about a queen and a bishop left on the board. Before that, it is the opening up to '
  + 'and including move 12, and the middlegame after. These boundaries are a convention Orbis chose, not a rule of '
  + 'chess, and a move near one of them could reasonably be filed either side.'

export const ENDGAME_MATERIAL = 1300
export const OPENING_LAST_MOVE = 12

/** The phase a position is in, or null when the position cannot be read at all. */
export function phaseOf(fen: string): GamePhase | null {
  const squares = boardSquares(fen)
  if (squares.length === 0) return null
  let heavy = 0
  for (const one of squares) {
    if (one.type === 'p' || one.type === 'k') continue
    heavy += PIECE_VALUE[one.type]
  }
  if (heavy <= ENDGAME_MATERIAL) return 'endgame'
  const move = Number.parseInt(fen.trim().split(/\s+/)[5] ?? '1', 10)
  return Number.isFinite(move) && move <= OPENING_LAST_MOVE ? 'opening' : 'middlegame'
}

export const PHASE_LABEL: Readonly<Record<GamePhase, string>> = Object.freeze({
  opening: 'the opening',
  middlegame: 'the middlegame',
  endgame: 'the endgame'
})

// ---------------------------------------------------------------- the activities a conclusion can point at

/**
 * The things a person can actually do in Chess World.
 *
 * A study plan or a challenge that asks for something this product has not got is a broken promise, so every
 * suggestion and every goal names one of these, and `records` says what leaves the evidence behind afterwards.
 */
export const ACTIVITIES = Object.freeze({
  play: { label: 'Play a game', records: 'the game Chess World saves' },
  'analyse-game': { label: 'Have the engine go through one of your games', records: 'the move-by-move analysis' },
  puzzle: { label: 'Solve puzzles', records: 'the attempt' },
  calculation: { label: 'Calculate a line without moving the pieces', records: 'the attempt' },
  blindfold: { label: 'Work on the board in your head', records: 'the attempt' },
  endgame: { label: 'Practise an endgame', records: 'the attempt' },
  lesson: { label: 'Work through a lesson', records: 'the lesson task attempts' },
  'opening-drill': { label: 'Play back an opening line from memory', records: 'the recall attempt' },
  'import-game': { label: 'Bring in games from a PGN file', records: 'the games' },
  'watch-broadcast': { label: 'Follow a game being broadcast', records: 'the game, once it finishes' }
})

export type ActivityKind = keyof typeof ACTIVITIES

export const ACTIVITY_KINDS: readonly ActivityKind[] = Object.freeze(Object.keys(ACTIVITIES) as ActivityKind[])

/**
 * Which activity an exercise attempt belongs to.
 *
 * `recall` is filed with the blindfold work: both ask you to hold a position in your head, and both are recorded the
 * same way, so counting them as two activities would split one habit into two thin halves.
 */
export const ACTIVITY_OF_EXERCISE: Readonly<Record<ExerciseKind, ActivityKind>> = Object.freeze({
  puzzle: 'puzzle',
  'lesson-task': 'lesson',
  calculation: 'calculation',
  blindfold: 'blindfold',
  endgame: 'endgame',
  recall: 'blindfold'
})

// ---------------------------------------------------------------- what counts as evidence

/** One of the person's own moves, after an engine has judged it. */
export interface AnalysedMove {
  /** Which move of the game it was, counting both sides. */
  ply: number
  side: Side
  san: string
  /** The position the move was played in. The phase is worked out from this rather than stored as somebody's opinion. */
  before: string
  /** What `evaluation.classify` called it. `unclear` means the analysis could not judge it, and it is counted apart. */
  klass: MoveClass
  /** Centipawns given away, when both scores were ordinary numbers. Null when nothing can be put on one scale. */
  loss: number | null
  /** Seconds left on this player's clock after the move, when the game recorded a clock. Absent otherwise. */
  secondsLeft?: number
}

export interface AnalysedGame {
  gameId: string
  /** Which side the person played. Null when the record does not say -- then the game is not evidence about them. */
  you: Side | null
  analysedAt: number
  /** The depth the search reached. A shallow pass is not evidence about a player. */
  depth: number
  moves: readonly AnalysedMove[]
  /** The opening, as the source named it. Never worked out here. */
  opening?: { eco?: string; name?: string }
}

/** One attempt at one exercise, with what the exercise was for. */
export interface TrainingRecord {
  performance: Performance
  kind: ExerciseKind
  /** What the exercise trains. Empty when the exercise carried no themes, and then it is evidence about nothing in particular. */
  themes: readonly string[]
}

/** One go at playing an opening line back from memory. */
export interface OpeningRecallRecord {
  /** The line's name as the repertoire holds it. Never invented. */
  name: string
  eco?: string
  side: Side
  /** Moves of the line reproduced before the first mistake. */
  correct: number
  /** How long the line is. */
  length: number
  /** True only when the whole line came back. */
  complete: boolean
  at: number
}

export interface CoachEvidence {
  games?: readonly AnalysedGame[]
  training?: readonly TrainingRecord[]
  openings?: readonly OpeningRecallRecord[]
  /**
   * The review cards.
   *
   * `spaced.ts` already works out how a theme is going, from the cards that train it. That question is asked of it
   * rather than answered a second time here, so the coach and the review queue cannot disagree about which theme is
   * going badly.
   */
  cards?: readonly ReviewCard[]
}

/**
 * How much has to be recorded before anything is said.
 *
 * Written as data so a screen can show the threshold beside the refusal, and so these numbers live in one place
 * rather than being scattered as magic numbers through the arithmetic below.
 */
export const EVIDENCE = Object.freeze({
  /** A game analysed shallower than this is not counted at all. A weakness is a bigger claim than one move label. */
  minDepth: 12,
  /** Own moves judged inside one phase, before that phase is talked about. */
  phaseMoves: 30,
  /** Own moves judged altogether, before an overall error rate is given. */
  judgedMoves: 60,
  /** Analysed games, before anything is said about your games at all. */
  games: 3,
  /** Exercise attempts, before a habit in training is reported. */
  trainingAttempts: 15,
  /** Attempts at one theme. This is `spaced.ts`'s own threshold, and it is used rather than a second one. */
  themeAttempts: 5,
  /** Attempts at one opening line. */
  openingAttempts: 3,
  /** Opening lines tried, before anything is said about your openings. */
  openingLines: 2,
  /** Own moves with a clock recorded, in each of the two buckets, before time is mentioned. */
  clockedMoves: 20
})

/**
 * How far something has to be out of line before it is called a weakness.
 *
 * `gap` rules compare you with yourself -- a phase against your other phases -- which needs no outside population and
 * makes no claim about anybody else. The absolute rules exist for the cases where there is nothing to compare with.
 */
export const WEAK_AT = Object.freeze({
  /** A phase is named when its serious-error rate is at least this many times the rate in your other phases. */
  phaseGap: 1.5,
  /** The share of your judged moves that are a mistake or worse, before the overall rate is called a weakness. */
  seriousShare: 0.1,
  /** Forced mates that were on the board and were not played. */
  missedMates: 3,
  /** A theme's solve rate below this is a weakness. `spaced.ts` uses the same figure. */
  themeShare: 0.7,
  /** The share of your solves that needed the move shown. */
  hintShare: 0.25,
  /** The share of your failed attempts that were answered inside `quickSeconds`. */
  quickShare: 0.3,
  /** Lines that did not come back whole, as a share of attempts. */
  openingShare: 0.4,
  /** Rate under this much time left is compared with the rate above it. */
  lowTimeSeconds: 30,
  /** A wrong answer given inside this many seconds is counted as one given quickly. */
  quickSeconds: 5
})

/** The move classes that mean the engine found something seriously better. */
export const SERIOUS: readonly MoveClass[] = Object.freeze(['mistake', 'blunder', 'missed-mate'])

// ---------------------------------------------------------------- the profile

export type ObservationKind = 'analysed-move' | 'analysed-game' | 'training-attempt' | 'opening-attempt' | 'review-attempt'

/** How many times a thing was seen, out of how many chances. Both numbers, always, never just the share. */
export interface Observation {
  kind: ObservationKind
  /** How many went the way the weakness describes. */
  hits: number
  /** How many there were altogether. */
  of: number
  /** Said plainly. */
  says: string
}

export type WeaknessKind =
  | 'phase'
  | 'serious-errors'
  | 'missed-mates'
  | 'low-time'
  | 'theme'
  | 'hint-dependence'
  | 'quick-wrong'
  | 'opening-recall'

/**
 * The order weaknesses are listed in, and why it is not an order of size.
 *
 * A 15 per cent error rate in your endgames and a 55 per cent solve rate on forks are not two points on one scale, so
 * sorting them against each other would invent a comparison. Instead they come out in the order they are worth
 * looking at: your own games first, because an engine going through a game you actually played is the most direct
 * evidence there is; then training, then openings, then the habits that are only counted and not interpreted.
 */
export const KIND_ORDER: readonly WeaknessKind[] = Object.freeze([
  'serious-errors', 'phase', 'missed-mates', 'low-time', 'theme', 'opening-recall', 'hint-dependence', 'quick-wrong'
])

export interface Weakness {
  id: string
  kind: WeaknessKind
  /** A few words. */
  label: string
  /** Why it is being said, naming the counts it rests on. */
  because: string
  /** What it means and what would work on it, in plain language. */
  explain: string
  /** The observations behind it. Never empty. */
  evidence: readonly Observation[]
  /** 0..1, on the observation this weakness is measured by. Comparable with the same kind and nothing else. */
  rate: number
  /** The activity in this product that works on it. */
  activity: ActivityKind
}

/** Something that cannot be said yet, with what is missing. */
export interface Refusal {
  /** What is not being answered. */
  about: string
  says: string
  have: number
  need: number
}

export interface EvidenceCount {
  games: number
  /** Own moves the analysis was able to judge. */
  judgedMoves: number
  /** Own moves it could not judge. Counted apart, never folded into the others. */
  unjudgedMoves: number
  trainingAttempts: number
  openingAttempts: number
  reviewAttempts: number
}

export interface WeaknessProfile {
  /** In `KIND_ORDER`, then by rate inside a kind. */
  weaknesses: readonly Weakness[]
  refusals: readonly Refusal[]
  /** What this profile is not. Said out loud rather than left to be assumed. */
  cannotSay: readonly string[]
  counted: EvidenceCount
  /** True when there was not enough of anything to say one word. */
  silent: boolean
  /** The whole of it in one sentence, including when that sentence is "not yet". */
  says: string
  /** When it was worked out. */
  at: number
  /** The phase convention, repeated here so a screen showing phases can show the rule beside them. */
  phaseRule: string
}

export const CANNOT_SAY: readonly string[] = Object.freeze([
  'Nothing here is a rating. A rating comes from games against rated opponents and Orbis has not got any, so a number '
  + 'made from puzzles would be a guess wearing a rating\'s clothes.',
  'Nothing here is about how you think. Where a habit can be counted it is reported as a count, and that is all it is.',
  'An engine judged the moves in your games. It is right about the position and says nothing about what was reasonable '
  + 'to see from the board.',
  'Every rate is shown with the number of observations behind it, because a rate over a handful of them moves a long '
  + 'way on one result.',
  'A weakness missing from this list may simply not have been recorded yet. Absence here is not evidence of strength.'
])

const pct = (x: number): number => Math.round(x * 100)
const share = (hits: number, of: number): string => `${hits} of ${of} (${of > 0 ? pct(hits / of) : 0} per cent)`

/** Own moves from the games that are deep enough to count, with the shallow ones left out. */
function ownMoves(games: readonly AnalysedGame[]): { usable: AnalysedGame[]; moves: AnalysedMove[]; tooShallow: number; noSide: number } {
  const usable: AnalysedGame[] = []
  const moves: AnalysedMove[] = []
  let tooShallow = 0
  let noSide = 0
  for (const game of games) {
    if (game.you === null) { noSide += 1; continue }
    if (game.depth < EVIDENCE.minDepth) { tooShallow += 1; continue }
    usable.push(game)
    for (const move of game.moves) if (move.side === game.you) moves.push(move)
  }
  return { usable, moves, tooShallow, noSide }
}

const isSerious = (move: AnalysedMove): boolean => SERIOUS.includes(move.klass)
const isJudged = (move: AnalysedMove): boolean => move.klass !== 'unclear'

/** The weaknesses and refusals that come out of the person's own analysed games. */
function fromGames(games: readonly AnalysedGame[]): { weaknesses: Weakness[]; refusals: Refusal[]; counted: Pick<EvidenceCount, 'games' | 'judgedMoves' | 'unjudgedMoves'> } {
  const weaknesses: Weakness[] = []
  const refusals: Refusal[] = []
  const { usable, moves, tooShallow, noSide } = ownMoves(games)
  const judged = moves.filter(isJudged)
  const unjudged = moves.length - judged.length
  const counted = { games: usable.length, judgedMoves: judged.length, unjudgedMoves: unjudged }

  if (tooShallow > 0) {
    refusals.push({
      about: `${tooShallow} analysed ${tooShallow === 1 ? 'game' : 'games'} left out`,
      says: `${tooShallow} ${tooShallow === 1 ? 'game was' : 'games were'} analysed shallower than depth ${EVIDENCE.minDepth}, `
        + 'which is not deep enough to judge a player by. Run the analysis deeper and they will count.',
      have: EVIDENCE.minDepth - 1,
      need: EVIDENCE.minDepth
    })
  }
  if (noSide > 0) {
    refusals.push({
      about: `${noSide} ${noSide === 1 ? 'game says' : 'games say'} nothing about you`,
      says: `${noSide} analysed ${noSide === 1 ? 'game does' : 'games do'} not record which side you played, so the moves in `
        + `${noSide === 1 ? 'it' : 'them'} cannot be attributed to anybody.`,
      have: 0,
      need: 1
    })
  }
  if (usable.length < EVIDENCE.games) {
    refusals.push({
      about: 'how your own games go',
      says: usable.length === 0
        ? 'Not enough games yet to tell. Nothing has been analysed deeply enough to say anything about your own play.'
        : `Not enough games yet to tell: ${usable.length} of the ${EVIDENCE.games} needed.`,
      have: usable.length,
      need: EVIDENCE.games
    })
    return { weaknesses, refusals, counted }
  }

  // The overall rate first, because it is the number the per-phase ones are compared against.
  if (judged.length < EVIDENCE.judgedMoves) {
    refusals.push({
      about: 'how often your moves go seriously wrong',
      says: `Not enough judged moves yet: ${judged.length} of the ${EVIDENCE.judgedMoves} needed.`,
      have: judged.length,
      need: EVIDENCE.judgedMoves
    })
  } else {
    const serious = judged.filter(isSerious)
    const rate = serious.length / judged.length
    if (rate >= WEAK_AT.seriousShare) {
      weaknesses.push({
        id: 'serious-errors',
        kind: 'serious-errors',
        label: 'Mistakes and blunders',
        because: `In ${share(serious.length, judged.length)} of your moves the engine had found something at least `
          + 'two and a half pawns better, or a forced mate you did not play.',
        explain: 'This is the plainest thing the analysis can tell you: how often a move gave something real away. It '
          + 'counts only the moves the engine could judge, across '
          + `${usable.length} ${usable.length === 1 ? 'game' : 'games'} analysed to at least depth ${EVIDENCE.minDepth}.`,
        evidence: [{
          kind: 'analysed-move',
          hits: serious.length,
          of: judged.length,
          says: `${share(serious.length, judged.length)} of your judged moves were a mistake, a blunder or a missed mate.`
        }],
        rate,
        activity: 'analyse-game'
      })
    }
  }

  // Per phase, each one against your other phases rather than against anybody else.
  const byPhase = new Map<GamePhase, AnalysedMove[]>()
  let unplaceable = 0
  for (const move of judged) {
    const phase = phaseOf(move.before)
    if (phase === null) { unplaceable += 1; continue }
    const held = byPhase.get(phase) ?? []
    held.push(move)
    byPhase.set(phase, held)
  }
  if (unplaceable > 0) {
    refusals.push({
      about: `${unplaceable} ${unplaceable === 1 ? 'move' : 'moves'} could not be placed in a phase`,
      says: `${unplaceable} ${unplaceable === 1 ? 'move was' : 'moves were'} recorded with a position that cannot be read, `
        + 'so they are left out of the per-phase numbers rather than guessed at.',
      have: 0,
      need: 1
    })
  }
  for (const phase of ['opening', 'middlegame', 'endgame'] as GamePhase[]) {
    const here = byPhase.get(phase) ?? []
    if (here.length < EVIDENCE.phaseMoves) {
      refusals.push({
        about: `how you play ${PHASE_LABEL[phase]}`,
        says: here.length === 0
          ? `Nothing yet about ${PHASE_LABEL[phase]}: none of your analysed moves were played there.`
          : `Not enough moves in ${PHASE_LABEL[phase]} yet to tell: ${here.length} of the ${EVIDENCE.phaseMoves} needed.`,
        have: here.length,
        need: EVIDENCE.phaseMoves
      })
      continue
    }
    const elsewhere = judged.filter((move) => phaseOf(move.before) !== null && phaseOf(move.before) !== phase)
    if (elsewhere.length < EVIDENCE.phaseMoves) {
      refusals.push({
        about: `whether ${PHASE_LABEL[phase]} is worse than the rest of your game`,
        says: `There are enough moves in ${PHASE_LABEL[phase]}, but only ${elsewhere.length} elsewhere to compare them `
          + `with, and ${EVIDENCE.phaseMoves} are needed on both sides of a comparison.`,
        have: elsewhere.length,
        need: EVIDENCE.phaseMoves
      })
      continue
    }
    const hereSerious = here.filter(isSerious).length
    const thereSerious = elsewhere.filter(isSerious).length
    const hereRate = hereSerious / here.length
    const thereRate = thereSerious / elsewhere.length
    // A phase with no errors at all elsewhere to compare against would divide by zero; it is also not a weakness.
    if (thereRate <= 0 ? hereRate <= 0 : hereRate / thereRate < WEAK_AT.phaseGap) continue
    weaknesses.push({
      id: `phase-${phase}`,
      kind: 'phase',
      label: `Mistakes in ${PHASE_LABEL[phase]}`,
      because: `In ${PHASE_LABEL[phase]} the engine found a mistake or worse in ${share(hereSerious, here.length)} of your `
        + `moves. In the rest of your game it was ${share(thereSerious, elsewhere.length)}.`,
      explain: `${PHASE_RULE} The comparison is with your own other moves, not with other players.`,
      evidence: [
        { kind: 'analysed-move', hits: hereSerious, of: here.length, says: `${PHASE_LABEL[phase]}: ${share(hereSerious, here.length)}.` },
        { kind: 'analysed-move', hits: thereSerious, of: elsewhere.length, says: `Everywhere else: ${share(thereSerious, elsewhere.length)}.` }
      ],
      rate: hereRate,
      activity: phase === 'endgame' ? 'endgame' : phase === 'opening' ? 'opening-drill' : 'puzzle'
    })
  }

  // Forced mates that were there and were not played.
  const missed = judged.filter((move) => move.klass === 'missed-mate').length
  if (missed >= WEAK_AT.missedMates) {
    weaknesses.push({
      id: 'missed-mates',
      kind: 'missed-mates',
      label: 'Forced mates gone by',
      because: `${missed} ${missed === 1 ? 'time' : 'times'} the engine had a forced mate in the position and the move `
        + `played was something else. That is ${share(missed, judged.length)} of your judged moves.`,
      explain: 'A missed mate is not scored as a number of pawns, because it is not one: the game was over and the move '
        + 'played let it continue. Mating-pattern puzzles are the direct practice for this.',
      evidence: [{ kind: 'analysed-move', hits: missed, of: judged.length, says: `${share(missed, judged.length)} of your judged moves missed a forced mate.` }],
      rate: missed / Math.max(1, judged.length),
      activity: 'puzzle'
    })
  }

  // Time, but only where a clock was actually recorded.
  const clocked = judged.filter((move) => move.secondsLeft !== undefined)
  const low = clocked.filter((move) => (move.secondsLeft as number) < WEAK_AT.lowTimeSeconds)
  const high = clocked.filter((move) => (move.secondsLeft as number) >= WEAK_AT.lowTimeSeconds)
  if (clocked.length === 0) {
    refusals.push({
      about: 'whether your moves go wrong when you are short of time',
      says: 'None of your games recorded a clock, so there is nothing to work this out from. Games imported from a '
        + 'source that keeps clock times would answer it.',
      have: 0,
      need: EVIDENCE.clockedMoves
    })
  } else if (low.length < EVIDENCE.clockedMoves || high.length < EVIDENCE.clockedMoves) {
    refusals.push({
      about: 'whether your moves go wrong when you are short of time',
      says: `Both sides of the comparison need ${EVIDENCE.clockedMoves} moves with a clock: there are ${low.length} `
        + `played with under ${WEAK_AT.lowTimeSeconds} seconds left and ${high.length} with more.`,
      have: Math.min(low.length, high.length),
      need: EVIDENCE.clockedMoves
    })
  } else {
    const lowSerious = low.filter(isSerious).length
    const highSerious = high.filter(isSerious).length
    const lowRate = lowSerious / low.length
    const highRate = highSerious / high.length
    if (highRate > 0 && lowRate / highRate >= WEAK_AT.phaseGap) {
      weaknesses.push({
        id: 'low-time',
        kind: 'low-time',
        label: 'Moves played short of time',
        because: `With under ${WEAK_AT.lowTimeSeconds} seconds on your clock, ${share(lowSerious, low.length)} of your moves `
          + `were a mistake or worse. With more time it was ${share(highSerious, high.length)}.`,
        explain: `This is a count of moves either side of the ${WEAK_AT.lowTimeSeconds}-second mark on your own clock, in `
          + 'games that recorded one. It says what happened; it does not say why, and nothing here guesses.',
        evidence: [
          { kind: 'analysed-move', hits: lowSerious, of: low.length, says: `Under ${WEAK_AT.lowTimeSeconds} seconds left: ${share(lowSerious, low.length)}.` },
          { kind: 'analysed-move', hits: highSerious, of: high.length, says: `More than that: ${share(highSerious, high.length)}.` }
        ],
        rate: lowRate,
        activity: 'play'
      })
    }
  }

  return { weaknesses, refusals, counted }
}

/** Theme weaknesses, asked of `spaced.ts` rather than worked out again. */
function fromCards(cards: readonly ReviewCard[], now: number): { weaknesses: Weakness[]; refusals: Refusal[]; attempts: number } {
  const weaknesses: Weakness[] = []
  const refusals: Refusal[] = []
  const standings = themeStandings(cards, now)
  const attempts = cards.reduce((sum, card) => sum + card.attempts, 0)
  if (standings.length === 0) {
    refusals.push({
      about: 'which kinds of position you get wrong in training',
      says: 'Nothing has been attempted in training yet, so there are no themes to compare.',
      have: 0,
      need: EVIDENCE.themeAttempts
    })
    return { weaknesses, refusals, attempts }
  }
  const thin = standings.filter((one) => one.attempts < EVIDENCE.themeAttempts)
  if (thin.length > 0) {
    refusals.push({
      about: `${thin.length} ${thin.length === 1 ? 'theme' : 'themes'} with too few attempts`,
      says: `${thin.map((one) => one.theme).slice(0, 6).join(', ')}${thin.length > 6 ? ' and others' : ''}: fewer than `
        + `${EVIDENCE.themeAttempts} attempts each, which is not enough to call one a weakness either way.`,
      have: Math.max(...thin.map((one) => one.attempts)),
      need: EVIDENCE.themeAttempts
    })
  }
  for (const one of standings) {
    if (one.attempts < EVIDENCE.themeAttempts || one.share === null || one.share >= WEAK_AT.themeShare) continue
    const failed = one.attempts - one.solved
    weaknesses.push({
      id: `theme-${one.theme}`,
      kind: 'theme',
      label: one.theme,
      because: `${share(one.solved, one.attempts)} of your attempts at this theme were solved.`
        + (one.dueNow > 0 ? ` ${one.dueNow} ${one.dueNow === 1 ? 'card is' : 'cards are'} due now.` : ''),
      explain: 'This comes from the review cards that train the theme, which is the same place the review queue reads, '
        + 'so the coach and the queue cannot disagree about it.',
      evidence: [{ kind: 'review-attempt', hits: failed, of: one.attempts, says: `${share(failed, one.attempts)} of your attempts at ${one.theme} were not solved.` }],
      rate: 1 - one.share,
      activity: 'puzzle'
    })
  }
  return { weaknesses, refusals, attempts }
}

/** Habits that can be counted from training attempts, reported as counts and not interpreted. */
function fromTraining(records: readonly TrainingRecord[]): { weaknesses: Weakness[]; refusals: Refusal[] } {
  const weaknesses: Weakness[] = []
  const refusals: Refusal[] = []
  if (records.length < EVIDENCE.trainingAttempts) {
    refusals.push({
      about: 'how you go about training',
      says: records.length === 0
        ? 'Nothing has been attempted in training yet.'
        : `Not enough attempts yet to tell: ${records.length} of the ${EVIDENCE.trainingAttempts} needed.`,
      have: records.length,
      need: EVIDENCE.trainingAttempts
    })
    return { weaknesses, refusals }
  }

  const solved = records.filter((one) => one.performance.solved)
  const shown = solved.filter((one) => one.performance.worth <= 0)
  if (solved.length >= EVIDENCE.trainingAttempts && shown.length / solved.length >= WEAK_AT.hintShare) {
    weaknesses.push({
      id: 'hint-dependence',
      kind: 'hint-dependence',
      label: 'Solves that needed the answer shown',
      because: `${share(shown.length, solved.length)} of the exercises you solved were solved after a hint had shown you `
        + 'the move.',
      explain: 'An answer reached with the answer on screen is practice, not recall, and the review schedule already '
        + 'treats it that way. It is worth noticing because it changes what the solve count means.',
      evidence: [{ kind: 'training-attempt', hits: shown.length, of: solved.length, says: `${share(shown.length, solved.length)} of your solves had the move shown first.` }],
      rate: shown.length / solved.length,
      activity: 'puzzle'
    })
  } else if (solved.length < EVIDENCE.trainingAttempts) {
    refusals.push({
      about: 'how much of your solving leans on hints',
      says: `Not enough solved attempts yet: ${solved.length} of the ${EVIDENCE.trainingAttempts} needed.`,
      have: solved.length,
      need: EVIDENCE.trainingAttempts
    })
  }

  const failed = records.filter((one) => !one.performance.solved)
  const quick = failed.filter((one) => one.performance.seconds <= WEAK_AT.quickSeconds)
  if (failed.length >= EVIDENCE.trainingAttempts && quick.length / failed.length >= WEAK_AT.quickShare) {
    weaknesses.push({
      id: 'quick-wrong',
      kind: 'quick-wrong',
      label: `Wrong answers inside ${WEAK_AT.quickSeconds} seconds`,
      because: `${share(quick.length, failed.length)} of the attempts you did not solve were answered within `
        + `${WEAK_AT.quickSeconds} seconds.`,
      explain: 'A count of recorded times on attempts that did not work out. It is the count and nothing else: no '
        + 'reason is attached to it here, because the record does not hold one.',
      evidence: [{ kind: 'training-attempt', hits: quick.length, of: failed.length, says: `${share(quick.length, failed.length)} of your unsolved attempts were answered in ${WEAK_AT.quickSeconds} seconds or less.` }],
      rate: quick.length / failed.length,
      activity: 'calculation'
    })
  }
  return { weaknesses, refusals }
}

/** Opening lines, from recall attempts only. Nothing is said about an opening nobody has drilled. */
function fromOpenings(records: readonly OpeningRecallRecord[]): { weaknesses: Weakness[]; refusals: Refusal[] } {
  const weaknesses: Weakness[] = []
  const refusals: Refusal[] = []
  const byLine = new Map<string, OpeningRecallRecord[]>()
  for (const one of records) {
    const held = byLine.get(one.name) ?? []
    held.push(one)
    byLine.set(one.name, held)
  }
  if (byLine.size < EVIDENCE.openingLines) {
    refusals.push({
      about: 'how well you know your openings',
      says: byLine.size === 0
        ? 'No opening lines have been played back from memory yet, so there is nothing to tell.'
        : `Only ${byLine.size} ${byLine.size === 1 ? 'line has' : 'lines have'} been drilled, and `
          + `${EVIDENCE.openingLines} are needed before anything is said about your openings.`,
      have: byLine.size,
      need: EVIDENCE.openingLines
    })
    return { weaknesses, refusals }
  }
  for (const [name, attempts] of [...byLine.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (attempts.length < EVIDENCE.openingAttempts) {
      refusals.push({
        about: `how well you know ${name}`,
        says: `Only ${attempts.length} ${attempts.length === 1 ? 'attempt' : 'attempts'} at this line, and `
          + `${EVIDENCE.openingAttempts} are needed.`,
        have: attempts.length,
        need: EVIDENCE.openingAttempts
      })
      continue
    }
    const broke = attempts.filter((one) => !one.complete)
    const rate = broke.length / attempts.length
    if (rate < WEAK_AT.openingShare) continue
    const deepest = Math.max(...broke.map((one) => one.correct))
    const shortest = Math.min(...broke.map((one) => one.correct))
    weaknesses.push({
      id: `opening-${name}`,
      kind: 'opening-recall',
      label: name,
      because: `${share(broke.length, attempts.length)} of your attempts at this line did not come back whole. The ones `
        + `that broke got ${shortest === deepest ? `${shortest} moves` : `between ${shortest} and ${deepest} moves`} in.`,
      explain: 'This counts whole lines reproduced from memory, not whether the opening suits you. A line that keeps '
        + 'breaking at the same move is usually one move that was never learned, not a whole opening.',
      evidence: [{ kind: 'opening-attempt', hits: broke.length, of: attempts.length, says: `${share(broke.length, attempts.length)} of your attempts at ${name} broke off early.` }],
      rate,
      activity: 'opening-drill'
    })
  }
  return { weaknesses, refusals }
}

/**
 * The weakness profile.
 *
 * Nothing is computed twice and nothing is inferred: each section counts what it was given, and anything it has too
 * little of comes back as a refusal naming the shortfall.
 */
export function weaknessProfile(evidence: CoachEvidence, now: number): WeaknessProfile {
  const games = fromGames(evidence.games ?? [])
  const cards = fromCards(evidence.cards ?? [], now)
  const training = fromTraining(evidence.training ?? [])
  const openings = fromOpenings(evidence.openings ?? [])

  const weaknesses = [...games.weaknesses, ...cards.weaknesses, ...training.weaknesses, ...openings.weaknesses]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.rate - a.rate || a.id.localeCompare(b.id))
  const refusals = [...games.refusals, ...cards.refusals, ...training.refusals, ...openings.refusals]

  const counted: EvidenceCount = {
    games: games.counted.games,
    judgedMoves: games.counted.judgedMoves,
    unjudgedMoves: games.counted.unjudgedMoves,
    trainingAttempts: (evidence.training ?? []).length,
    openingAttempts: (evidence.openings ?? []).length,
    reviewAttempts: cards.attempts
  }
  const anything = counted.games > 0 || counted.trainingAttempts > 0 || counted.openingAttempts > 0 || counted.reviewAttempts > 0
  const silent = weaknesses.length === 0

  return {
    weaknesses,
    refusals,
    cannotSay: CANNOT_SAY,
    counted,
    silent,
    says: !anything
      ? 'Nothing has been recorded yet, so there is nothing to tell you. Play a game and have the engine go through it, '
        + 'or try some puzzles, and this fills itself in from what happens.'
      : silent
        ? 'Nothing here is out of line with the rest of your play, on what has been recorded so far. What is missing is '
          + 'listed below rather than left blank.'
        : `${weaknesses.length} ${weaknesses.length === 1 ? 'thing' : 'things'} the record shows, from `
          + `${counted.judgedMoves} judged moves, ${counted.trainingAttempts} training attempts and `
          + `${counted.reviewAttempts} review attempts.`,
    at: now,
    phaseRule: PHASE_RULE
  }
}

// ---------------------------------------------------------------- the study plan

export interface PlanItem {
  id: string
  /** Where it came from. A coach item is tied to a weakness; a person's item is their own. */
  from: 'coach' | 'person'
  /** The weakness it answers, for a coach item. */
  weaknessId?: string
  /** The coach's own wording, or the person's for a line they wrote. */
  title: string
  /**
   * What the person renamed it to.
   *
   * Kept apart from `title` rather than written over it, so a coach line can be called whatever the person likes
   * while the sentence that says what the evidence is stays exactly as the evidence says it. Clearing the override
   * brings the coach's wording back.
   */
  titleOverride?: string
  /** What doing it means. For a coach line this is the evidence, and only the coach writes it. */
  what: string
  activity: ActivityKind
  /** Lower first. The person's own ordering, not the coach's. */
  order: number
  /** Put aside. A dismissed coach item is kept so it does not come back when the weakness is seen again. */
  dismissed: boolean
  addedAt: number
}

export interface StudyPlan {
  items: readonly PlanItem[]
  updatedAt: number
}

export const EMPTY_PLAN: StudyPlan = Object.freeze({ items: Object.freeze([]) as readonly PlanItem[], updatedAt: 0 })

/** What a line is called on screen: the person's wording if they gave one, the coach's otherwise. */
export function planTitle(item: PlanItem): string {
  return item.titleOverride ?? item.title
}

const planItemFor = (weakness: Weakness, order: number, now: number): PlanItem => ({
  id: `coach:${weakness.id}`,
  from: 'coach',
  weaknessId: weakness.id,
  // The weakness's own label is used as it stands. Lower-casing it read well for "mistakes in the endgame" and turned
  // the Catalan into "catalan", and a plan that cannot spell an opening's name is not one anybody will trust.
  title: `${ACTIVITIES[weakness.activity].label} -- ${weakness.label}`,
  what: `${weakness.because} ${ACTIVITIES[weakness.activity].label} is what works on it, and ${ACTIVITIES[weakness.activity].records} is what will show whether it helped.`,
  activity: weakness.activity,
  order,
  dismissed: false,
  addedAt: now
})

/** A plan straight from a profile, in the profile's own order. Nothing the person has said is in it yet. */
export function suggestPlan(profile: WeaknessProfile, now: number): StudyPlan {
  return { items: profile.weaknesses.map((weakness, index) => planItemFor(weakness, index, now)), updatedAt: now }
}

/**
 * The plan, brought up to date with a fresh profile without losing what the person did to it.
 *
 * Three rules, and the first is the one that matters:
 *
 *   - **A dismissal sticks.** An item the person put aside is kept in the list, dismissed, even when the weakness
 *     behind it is still there. Dropping it would mean it reappeared as new the next time the profile was built,
 *     which is how a suggestion list becomes something people stop reading.
 *   - The person's own order and their own items are untouched. A new suggestion goes on the end.
 *   - A coach item whose weakness is gone and which was never dismissed is removed: it is no longer suggested, and it
 *     was never theirs to keep.
 */
export function mergePlan(plan: StudyPlan, profile: WeaknessProfile, now: number): StudyPlan {
  const live = new Map(profile.weaknesses.map((one) => [one.id, one]))
  const kept: PlanItem[] = []
  for (const item of plan.items) {
    if (item.from === 'person') { kept.push(item); continue }
    const weakness = item.weaknessId === undefined ? undefined : live.get(item.weaknessId)
    if (weakness === undefined) {
      // Gone. Kept only as the record of a dismissal, so the dismissal still holds if it comes back.
      if (item.dismissed) kept.push(item)
      continue
    }
    // The coach's wording follows the evidence, which has moved on. The person's order, their dismissal and the name
    // they gave the line do not.
    const fresh = planItemFor(weakness, item.order, item.addedAt)
    kept.push({
      ...fresh,
      order: item.order,
      dismissed: item.dismissed,
      addedAt: item.addedAt,
      ...(item.titleOverride === undefined ? {} : { titleOverride: item.titleOverride })
    })
  }
  const have = new Set(kept.map((one) => one.id))
  let order = kept.reduce((top, one) => Math.max(top, one.order), -1)
  for (const weakness of profile.weaknesses) {
    const id = `coach:${weakness.id}`
    if (have.has(id)) continue
    order += 1
    kept.push(planItemFor(weakness, order, now))
  }
  return { items: renumber(kept), updatedAt: now }
}

/** Orders kept contiguous from 0, so a reorder never has to think about gaps. */
function renumber(items: readonly PlanItem[]): PlanItem[] {
  return [...items]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((one, index) => (one.order === index ? one : { ...one, order: index }))
}

/** The items to show, in order. Dismissed ones are not among them. */
export function activePlan(plan: StudyPlan): PlanItem[] {
  return plan.items.filter((one) => !one.dismissed).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** The items put aside, so they can be brought back. */
export function dismissedPlan(plan: StudyPlan): PlanItem[] {
  return plan.items.filter((one) => one.dismissed).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/**
 * One step up or down among the items that are actually showing.
 *
 * It swaps with the next *visible* neighbour rather than the next order number, because a dismissed item sitting
 * between two others would otherwise swallow a press and the list would appear not to move.
 */
export function movePlanItem(plan: StudyPlan, id: string, direction: 'up' | 'down', now: number): StudyPlan {
  const showing = activePlan(plan)
  const at = showing.findIndex((one) => one.id === id)
  if (at < 0) return plan
  const to = direction === 'up' ? at - 1 : at + 1
  if (to < 0 || to >= showing.length) return plan
  const a = showing[at]
  const b = showing[to]
  const items = plan.items.map((one) => (one.id === a.id ? { ...one, order: b.order } : one.id === b.id ? { ...one, order: a.order } : one))
  return { items: renumber(items), updatedAt: now }
}

/** The whole order at once, for a drag. Ids not named keep their relative places after the ones that were. */
export function reorderPlan(plan: StudyPlan, ids: readonly string[], now: number): StudyPlan {
  const given = new Map(ids.map((id, index) => [id, index]))
  const after = ids.length
  const items = plan.items.map((one) => {
    const place = given.get(one.id)
    return place === undefined ? { ...one, order: after + one.order } : { ...one, order: place }
  })
  return { items: renumber(items), updatedAt: now }
}

export function dismissPlanItem(plan: StudyPlan, id: string, now: number): StudyPlan {
  if (!plan.items.some((one) => one.id === id && !one.dismissed)) return plan
  return { items: plan.items.map((one) => (one.id === id ? { ...one, dismissed: true } : one)), updatedAt: now }
}

export function restorePlanItem(plan: StudyPlan, id: string, now: number): StudyPlan {
  if (!plan.items.some((one) => one.id === id && one.dismissed)) return plan
  return { items: plan.items.map((one) => (one.id === id ? { ...one, dismissed: false } : one)), updatedAt: now }
}

/** A line the person wrote themselves. It goes on the end and the coach never touches it. */
export function addPlanItem(plan: StudyPlan, o: { id: string; title: string; what?: string; activity: ActivityKind }, now: number): StudyPlan {
  if (plan.items.some((one) => one.id === o.id)) return plan
  const order = plan.items.reduce((top, one) => Math.max(top, one.order), -1) + 1
  const item: PlanItem = {
    id: o.id,
    from: 'person',
    title: o.title,
    what: o.what ?? '',
    activity: o.activity,
    order,
    dismissed: false,
    addedAt: now
  }
  return { items: renumber([...plan.items, item]), updatedAt: now }
}

/**
 * Changing the words on a line.
 *
 * Any line can be renamed, the coach's included: the name is a label and the person's plan is theirs. What cannot be
 * rewritten is `what` -- the sentence giving the counts the line rests on -- because a plan line claiming the record
 * says something it does not say would be the one piece of fabrication this whole module exists to avoid.
 */
export function renamePlanItem(plan: StudyPlan, id: string, title: string, now: number): StudyPlan {
  const text = title.trim()
  if (!text) return plan
  const item = plan.items.find((one) => one.id === id)
  if (!item) return plan
  if (item.from === 'person') {
    return { items: plan.items.map((one) => (one.id === id ? { ...one, title: text, titleOverride: text } : one)), updatedAt: now }
  }
  return { items: plan.items.map((one) => (one.id === id ? { ...one, titleOverride: text } : one)), updatedAt: now }
}

/** Dropping the person's own name for a coach line, so it goes back to saying what the coach calls it. */
export function resetPlanTitle(plan: StudyPlan, id: string, now: number): StudyPlan {
  const item = plan.items.find((one) => one.id === id)
  if (!item || item.titleOverride === undefined || item.from === 'person') return plan
  return {
    items: plan.items.map((one) => {
      if (one.id !== id) return one
      const { titleOverride, ...rest } = one
      return rest
    }),
    updatedAt: now
  }
}

/**
 * Taking a line off the plan for good.
 *
 * Only the person's own lines can go. A coach line is dismissed instead, because the dismissal has to be remembered
 * for the merge above to keep its promise.
 */
export function removePlanItem(plan: StudyPlan, id: string, now: number): StudyPlan {
  const item = plan.items.find((one) => one.id === id)
  if (!item) return plan
  if (item.from === 'coach') return dismissPlanItem(plan, id, now)
  return { items: renumber(plan.items.filter((one) => one.id !== id)), updatedAt: now }
}
