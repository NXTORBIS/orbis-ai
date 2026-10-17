import { boardSquares, outcome, sideToMove } from './rules.ts'
import type { Side } from './evaluation.ts'
import type { GameResult } from './model.ts'
import {
  DIFFICULTY_LABEL, PROOF_TEXT, THEME_LABEL,
  objectiveLost, objectiveMet, objectiveText, playable as endgamePlayable, proofKind,
  type EndgameEntry, type Progress
} from './endgames.ts'
import { ENDGAMES } from './endgamesData.ts'
import { STANDARD_SETUP, type ArenaSetup, type ArenaState, type Difficulty as EngineLevel } from './arena.ts'
import { canPlayFrom, type TrainingAttempt } from './trainingView.ts'

/**
 * Drills: a position, played out against the engine until you convert it, from either side, as often as you like.
 *
 * ## What this is, and what it is not
 *
 * The Endgame Lab proves a claim about an ending by exhaustive search and makes you play it against a written
 * defence. That is a stronger thing than a drill and it is not one: the defence is a rule ladder, the position is
 * one of twenty-two, and the lab is about whether the claim is true. A drill is about whether *you* can get the
 * win out of the position with somebody real on the other side, today, and again next week.
 *
 * So this file does not play chess and does not judge legality. It
 *
 *   - builds the list of positions worth drilling, from the lab's own entries and from the person's own games;
 *   - turns one into an `ArenaSetup`, so the game is run by `arena.ts` -- the same session, the same clock, the
 *     same once-per-turn engine guard, the same refusal to accept anything after the game is over;
 *   - says after every move whether the objective is met, lost, or still open, by asking `endgames.ts` wherever the
 *     position came from there, so there is one answer to "is this won" rather than two;
 *   - counts how often it was converted, out of the records the training store already keeps.
 *
 * ## Both sides, and the one side that cannot be offered
 *
 * Playing the defending side of a position is a real drill: make them take every move the position allows. It is
 * offered only where the lab has *proved* a forced mate in a stated number -- that number is what "as long as the
 * position allows" means, and without it the defending drill would have no objective at all. Everywhere else the
 * defending side is refused with the reason, rather than offered with an objective nobody can check.
 *
 * ## The honest line
 *
 * A drill from one of the person's own games has **no claim attached to it**. Orbis has no tablebase, and nothing
 * here asks an engine whether a position was winning, so the objective cannot be "win this". What can be measured
 * is whether this attempt came out better than the game did, and that is exactly what is claimed -- no more.
 *
 * Pure: `now` is an argument, there is no storage and no React.
 */

// ---------------------------------------------------------------- what a drill is

export type DrillRole =
  /** You are the side with the job: the mate, the promotion, the draw to hold. */
  | 'convert'
  /** You are the side being beaten, and the job is to make them take every move the position allows. */
  | 'defend'

export const ROLE_LABEL: Readonly<Record<DrillRole, string>> = Object.freeze({
  convert: 'Win it',
  defend: 'Hold out'
})

export type DrillOrigin = 'endgame-lab' | 'your-game'

export interface DrillDefinition {
  /** Unique. `eg:<entry id>:<role>` for the lab's endings, `game:<game id>:<ply>` for the person's own. */
  id: string
  title: string
  /** What it is about, in a few words, for the list. */
  about: string
  fen: string
  /** The side you play. */
  you: Side
  role: DrillRole
  origin: DrillOrigin
  /** What has to happen, in a sentence somebody can act on. */
  objective: string
  /** The idea behind the position, where the source had one. Null where there is none to give. */
  method: string | null
  /** Where the position came from and how far its claim has been checked. Never a claim Orbis has not made. */
  provenance: string
  /** The lab entry this came from, when it did. The judging asks it. */
  entry: EndgameEntry | null
  /** The person's own game this came from, when it did. */
  game: DrillFromGame | null
  /**
   * The number of the attacker's own moves the mate needs, for a defending drill.
   *
   * Set only where a search proved it. It is the whole objective of a defending drill, so a defending drill without
   * it is not built.
   */
  holdMoves: number | null
}

export interface DrillFromGame {
  gameId: string
  /** The half-move the drill starts at. */
  ply: number
  /** What the game came to, as it was recorded. */
  was: GameResult
  /** What that was worth to the side you are playing: 1, 0.5 or 0. */
  wasWorth: number
  /** The game's name, for saying where this came from. */
  title: string
}

// ---------------------------------------------------------------- the lab's endings as drills

/**
 * The fewest moves a mate must take for the defending side to be worth playing.
 *
 * A mate in one offers the defender nothing: there is no move to make before it lands, so "make them take all of
 * it" is already done and the drill would be a button that says well held. It is refused with that reason.
 */
export const LEAST_HOLD = 2

export interface DrillCatalogue {
  drills: readonly DrillDefinition[]
  /** Positions that were not offered, with the reason. Kept so a screen can say rather than quietly show fewer. */
  refused: readonly { id: string; says: string }[]
  says: string
}

/**
 * Every ending in the lab, as a drill you win, plus the defending side where a search settled what holding means.
 *
 * The position is checked again here. `endgamePlayable` is the lab's own guard and `canPlayFrom` is the training
 * layer's -- both are asked because they catch different things, and a position that fails either is refused with
 * the reason rather than handed to a move generator.
 */
export function endgameDrills(entries: readonly EndgameEntry[] = ENDGAMES): DrillCatalogue {
  const drills: DrillDefinition[] = []
  const refused: { id: string; says: string }[] = []

  for (const entry of entries) {
    const lab = endgamePlayable(entry.fen)
    if (!lab.ok) {
      refused.push({ id: entry.id, says: lab.reason ?? 'The position cannot be played from.' })
      continue
    }
    const guard = canPlayFrom(entry.fen)
    if (!guard.ok) {
      refused.push({ id: entry.id, says: guard.says ?? 'The position cannot be played from.' })
      continue
    }
    if (sideToMove(entry.fen) !== entry.sideToMove) {
      refused.push({ id: entry.id, says: 'The entry and the position disagree about whose move it is.' })
      continue
    }
    const proof = proofKind(entry)
    drills.push({
      id: `eg:${entry.id}:convert`,
      title: entry.title,
      about: `${THEME_LABEL[entry.theme]} — ${DIFFICULTY_LABEL[entry.difficulty]}`,
      fen: entry.fen,
      you: entry.sideToMove,
      role: 'convert',
      origin: 'endgame-lab',
      objective: objectiveText(entry),
      method: entry.method,
      provenance: `${entry.provenance} ${PROOF_TEXT[proof]}`,
      entry,
      game: null,
      holdMoves: null
    })

    if (entry.objective.kind === 'mate-in' && proof === 'searched' && entry.objective.moves >= LEAST_HOLD) {
      const moves = entry.objective.moves
      drills.push({
        id: `eg:${entry.id}:defend`,
        title: `${entry.title} — the other side of it`,
        about: `${THEME_LABEL[entry.theme]} — holding out`,
        fen: entry.fen,
        you: entry.sideToMove === 'w' ? 'b' : 'w',
        role: 'defend',
        origin: 'endgame-lab',
        objective: `You are ${entry.sideToMove === 'w' ? 'Black' : 'White'} and this position is lost: mate is forced in ${moves} ${moves === 1 ? 'move' : 'moves'}. Make them take all ${moves}.`,
        method: entry.method,
        provenance: `${entry.provenance} ${PROOF_TEXT.searched} That is what makes "as long as the position allows" a number here rather than an opinion.`,
        entry,
        game: null,
        holdMoves: moves
      })
    } else if (entry.objective.kind === 'mate-in') {
      refused.push({
        id: `${entry.id}:defend`,
        says: `"${entry.title}" is not offered from the other side: the mate is there at once, so there is nothing to hold out against.`
      })
    } else {
      refused.push({
        id: `${entry.id}:defend`,
        says: `"${entry.title}" is not offered from the other side: nothing has been proved about how long that side can hold, so there would be no objective to meet.`
      })
    }
  }

  return {
    drills,
    refused,
    says: `${drills.length} ${drills.length === 1 ? 'drill' : 'drills'} from the Endgame Lab's own endings. Every position is checked against the rules again when this screen opens.`
  }
}

// ---------------------------------------------------------------- the person's own games as drills

export interface DrillGame {
  id: string
  startFen: string
  moves: readonly { san: string; fen: string }[]
  result: GameResult
  /** Which side you were. The caller has to say: a stored game does not record it. */
  you: Side
  /** What to call it in the list. */
  title: string
}

/** The fewest pieces besides the kings for a position to count as an ending worth drilling. */
export const ENDING_PIECES = 6

/** What a result was worth to one side. Nothing else in here turns a result into a number. */
export function worthTo(result: GameResult, side: Side): number | null {
  if (result === '1/2-1/2') return 0.5
  if (result === '1-0') return side === 'w' ? 1 : 0
  if (result === '0-1') return side === 'b' ? 1 : 0
  return null
}

export const RESULT_WORD: Readonly<Record<GameResult, string>> = Object.freeze({
  '1-0': 'White won',
  '0-1': 'Black won',
  '1/2-1/2': 'it was drawn',
  '*': 'it has no result recorded'
})

/**
 * The person's own games, as drills.
 *
 * One position per game: the first one that is an ending with you to move. A game you won is not offered -- there
 * is nothing to do better -- and nor is one with no result recorded, because the whole claim a drill from your own
 * game makes is "this came out better than the game did", and that needs the game to have come out.
 *
 * What is deliberately absent: any statement that the position was winning, or drawn, or lost. Orbis has no
 * tablebase and nothing here asks an engine. The objective is to beat what happened, which is a fact about your own
 * game and needs nobody's opinion.
 */
export function gameDrills(games: readonly DrillGame[], o: { mostPieces?: number; most?: number } = {}): DrillCatalogue {
  const mostPieces = o.mostPieces ?? ENDING_PIECES
  const most = o.most ?? 12
  const drills: DrillDefinition[] = []
  const refused: { id: string; says: string }[] = []

  for (const game of games) {
    if (drills.length >= most) break
    const wasWorth = worthTo(game.result, game.you)
    if (wasWorth === null) {
      refused.push({ id: game.id, says: `"${game.title}" has no result recorded, so there is nothing for an attempt to beat.` })
      continue
    }
    if (wasWorth === 1) {
      refused.push({ id: game.id, says: `"${game.title}" was a win, so there is nothing to do better.` })
      continue
    }
    const found = endingIn(game, mostPieces)
    if (!found) {
      refused.push({ id: game.id, says: `"${game.title}" never reached an ending of ${mostPieces} pieces or fewer with you to move.` })
      continue
    }
    drills.push({
      id: `game:${game.id}:${found.ply}`,
      title: game.title,
      about: `Your own game — ${RESULT_WORD[game.result]}`,
      fen: found.fen,
      you: game.you,
      role: 'convert',
      origin: 'your-game',
      objective: `You are ${game.you === 'w' ? 'White' : 'Black'}. In the game ${RESULT_WORD[game.result]}. Play it out again and come out better.`,
      method: null,
      provenance:
        'This is a position out of your own game, taken at the first ending with you to move. Nothing here says it was won, drawn or lost: Orbis has no tablebase and no engine was asked. What is measured is whether this attempt came out better than the game did.',
      entry: null,
      game: { gameId: game.id, ply: found.ply, was: game.result, wasWorth, title: game.title },
      holdMoves: null
    })
  }

  return {
    drills,
    refused,
    says: drills.length === 0
      ? 'No positions from your own games are being offered.'
      : `${drills.length} ${drills.length === 1 ? 'position' : 'positions'} from your own games, each taken at the first ending with you to move.`
  }
}

/**
 * The first position in a game that is an ending with `you` to move, and can be played from.
 *
 * The last position is looked at first, and the whole game is skipped if even that one has too much on the board.
 * That is sound rather than a guess: the number of pieces on a board never goes up. A capture takes one off and a
 * promotion swaps a pawn for a piece, so if the final position is still a middlegame then no position before it was
 * an ending. It turns a library of three hundred games from twenty thousand positions read into three hundred.
 */
function endingIn(game: DrillGame, mostPieces: number): { fen: string; ply: number } | null {
  const last = game.moves.length ? game.moves[game.moves.length - 1].fen : game.startFen
  if (boardSquares(last).filter((one) => one.type !== 'k').length > mostPieces) return null
  const walk: { fen: string; ply: number }[] = [{ fen: game.startFen, ply: 0 }]
  for (const [at, move] of game.moves.entries()) walk.push({ fen: move.fen, ply: at + 1 })
  for (const step of walk) {
    if (sideToMove(step.fen) !== game.you) continue
    const pieces = boardSquares(step.fen).filter((one) => one.type !== 'k')
    if (pieces.length > mostPieces) continue
    if (outcome(step.fen).over) continue
    if (!canPlayFrom(step.fen).ok) continue
    return step
  }
  return null
}

// ---------------------------------------------------------------- playing it

/**
 * The drill as a game to be played.
 *
 * `arena.ts` runs it. The side is not random -- a drill is about one side of a position -- and the position is the
 * drill's own. Everything else is the person's choice, carried in rather than decided here.
 */
export function drillSetup(
  drill: DrillDefinition,
  choices: { level: EngineLevel; control?: ArenaSetup['control']; yourName?: string }
): ArenaSetup {
  return {
    ...STANDARD_SETUP,
    side: drill.you,
    difficulty: choices.level,
    control: choices.control ?? STANDARD_SETUP.control,
    assistance: 'none',
    commentary: 'coach',
    startFen: drill.fen,
    ...(choices.yourName ? { yourName: choices.yourName } : {})
  }
}

/**
 * The lab's `Progress`, worked out from the arena game.
 *
 * It exists so the judging can be the lab's own. `learnerMoves` counts the moves of the side the *entry* calls the
 * learner, which is not always the side the person is playing -- in a defending drill it is the engine's -- and a
 * promotion is counted from what was played rather than guessed from the pieces, because a queen beside a king
 * could have been there all along.
 */
export function progressFrom(entry: EndgameEntry, game: ArenaState): Progress {
  const san = game.history.length ? [...game.history] : game.moves.map((one) => one.san)
  const fens = [game.startFen, ...game.moves.map((one) => one.fen)]
  const first = sideToMove(game.startFen)
  const learnerFirst = first === entry.sideToMove
  let learnerMoves = 0
  let learnerPromoted = false
  let defencePromoted = false
  for (const [at, text] of san.entries()) {
    const byLearner = at % 2 === 0 ? learnerFirst : !learnerFirst
    if (byLearner) learnerMoves += 1
    if (text.includes('=')) {
      if (byLearner) learnerPromoted = true
      else defencePromoted = true
    }
  }
  return { fens, san, learnerMoves, learnerPromoted, defencePromoted }
}

/** How many of one side's own moves have been played. */
export function movesBy(game: ArenaState, side: Side): number {
  const first = sideToMove(game.startFen)
  const total = game.moves.length
  const firstIsSide = first === side
  return Math.floor(total / 2) + (total % 2 === 1 && firstIsSide ? 1 : 0)
}

/**
 * Where a drill has got to.
 *
 * Called a stage rather than a state because `endgames.ts` next door already has a `DrillState`, which is the
 * board and the moves of its own play-it-out. Two things with one name in sibling modules is how somebody imports
 * the wrong one.
 */
export type DrillStage =
  /** Still going. */
  | 'playing'
  /** The objective was achieved. */
  | 'converted'
  /** It was not, and it cannot be from here. */
  | 'missed'
  /**
   * The game ended in a way that does not answer the question.
   *
   * Not a failure and not a success: what happened disagrees with what the position claims, or it ended for a
   * reason that is nothing to do with the drill. Reported as itself, because calling it either would be inventing
   * a result.
   */
  | 'unclear'

export interface DrillVerdict {
  state: DrillStage
  /** What happened, in a sentence. */
  says: string
  /** Your own moves so far. */
  yourMoves: number
  /** The other side's own moves so far. */
  theirMoves: number
  /** How many moves the objective allows, where something was proved. Null where nothing was. */
  allowed: number | null
  /** Everything this attempt does not establish. Said rather than left to be assumed. */
  caveats: readonly string[]
}

/**
 * Whether the drill has been converted, lost, or is still open.
 *
 * Where the position came from the Endgame Lab the question is put to the lab: `objectiveMet` and `objectiveLost`
 * are the only two functions in Chess World that decide whether an ending's objective has been achieved, and a
 * second opinion here would be a second answer that can disagree with the first. The two cases the lab cannot
 * answer -- the defending side, and a position out of somebody's own game -- are judged from facts a screen cannot
 * argue with: how many moves the mate took, and what the game came to.
 */
export function judgeDrill(drill: DrillDefinition, game: ArenaState): DrillVerdict {
  const yourMoves = movesBy(game, drill.you)
  const theirMoves = movesBy(game, drill.you === 'w' ? 'b' : 'w')
  const caveats = caveatsFor(drill, game)
  const base = { yourMoves, theirMoves, caveats }

  if (drill.role === 'defend') {
    const need = drill.holdMoves
    if (need === null) {
      return { ...base, state: 'unclear', allowed: null, says: 'This drill has no number of moves to hold out for, so nothing can be judged.' }
    }
    if (theirMoves >= need) {
      return {
        ...base,
        state: 'converted',
        allowed: need,
        says: `They have taken all ${need} of their moves. That is everything this position allows, so the defence held as well as it can be held.`
      }
    }
    const finish = game.finish
    if (!finish) {
      return {
        ...base,
        state: 'playing',
        allowed: need,
        says: `${theirMoves} of their ${need} moves gone.`
      }
    }
    if (finish.reason === 'checkmate') {
      const mated = sideToMove(game.fen)
      return mated === drill.you
        ? {
            ...base,
            state: 'missed',
            allowed: need,
            says: `Mate came after ${theirMoves} of their moves, and the position allowed ${need}. Somewhere in there a quicker mate was handed over.`
          }
        : { ...base, state: 'unclear', allowed: need, says: 'The other side has been checkmated, which is not what this drill was about.' }
    }
    if (finish.result === '1/2-1/2') {
      return {
        ...base,
        state: 'unclear',
        allowed: need,
        says: `The game is drawn after ${theirMoves} of their moves, and this position was proved to be a forced mate in ${need}. So the mate was let slip rather than held off, and this does not show the defence holding.`
      }
    }
    return { ...base, state: 'unclear', allowed: need, says: `The game ended for another reason: ${finish.termination ?? finish.reason}.` }
  }

  if (drill.entry) {
    const entry = drill.entry
    const progress = progressFrom(entry, game)
    if (objectiveMet(entry, game.fen, progress)) {
      return { ...base, state: 'converted', allowed: allowedFor(entry), says: 'That is the objective met.' }
    }
    const lost = objectiveLost(entry, game.fen, progress)
    if (lost.lost) return { ...base, state: 'missed', allowed: allowedFor(entry), says: lost.because }
    if (game.finish) {
      return {
        ...base,
        state: 'missed',
        allowed: allowedFor(entry),
        says: `The game ended before the objective was met: ${game.finish.termination ?? game.finish.reason}.`
      }
    }
    return { ...base, state: 'playing', allowed: allowedFor(entry), says: objectiveText(entry) }
  }

  const from = drill.game
  if (!from) {
    return { ...base, state: 'unclear', allowed: null, says: 'This drill came with nothing to judge it against.' }
  }
  if (!game.finish) {
    return { ...base, state: 'playing', allowed: null, says: `In the game ${RESULT_WORD[from.was]}. This one is still going.` }
  }
  const now = worthTo(game.finish.result, drill.you)
  if (now === null) {
    return { ...base, state: 'unclear', allowed: null, says: 'This game has no result, so there is nothing to compare.' }
  }
  if (now > from.wasWorth) {
    return {
      ...base,
      state: 'converted',
      allowed: null,
      says: now === 1
        ? `You won it this time. In the game ${from.was === '1/2-1/2' ? 'it was drawn' : 'you lost'}.`
        : `A draw this time. In the game you lost.`
    }
  }
  return {
    ...base,
    state: 'missed',
    allowed: null,
    says: now === from.wasWorth
      ? `The same as the game: ${RESULT_WORD[game.finish.result]}. Worth another go.`
      : `Worse than the game this time: ${RESULT_WORD[game.finish.result]}.`
  }
}

/** The number of the learner's own moves the entry allows, where it states one. */
function allowedFor(entry: EndgameEntry): number | null {
  const o = entry.objective
  if (o.kind === 'mate-in') return o.moves
  if (o.kind === 'promote') return o.moves ?? null
  if (o.kind === 'draw') return o.forcedIn ?? o.holdMoves
  if (o.kind === 'technique') return o.within ?? null
  return null
}

/**
 * What this attempt does not establish.
 *
 * Each one takes something away from the claim and each is named, rather than folded into a figure that cannot be
 * read back out afterwards. The engine's level is the big one: converting against the gentlest setting is a
 * different thing from converting against the strongest, and a conversion count that mixed them would be useless.
 */
function caveatsFor(drill: DrillDefinition, game: ArenaState): string[] {
  const out: string[] = []
  out.push(`The engine was on ${game.level.name}: ${game.level.about}`)
  if (game.hintsTaken > 0) {
    out.push(`${game.hintsTaken} ${game.hintsTaken === 1 ? 'hint was' : 'hints were'} taken, so this was not unaided.`)
  }
  if (drill.role === 'defend') {
    out.push(
      'A gentler engine may simply not find the mate, and then holding out says nothing about your defence. The stronger the level, the more this is worth.'
    )
  }
  if (drill.origin === 'your-game') {
    out.push('Nothing here says the position was winning. No engine and no tablebase was asked about it.')
  }
  if (drill.entry && proofKind(drill.entry) === 'checked') {
    out.push('That this ending is won is standard theory rather than something Orbis has proved. What was checked is that the objective is a fact about the position.')
  }
  return out
}

// ---------------------------------------------------------------- the record of how often it was converted

/**
 * What a drill attempt is filed under.
 *
 * The engine's level is part of it on purpose. Converting an ending against the gentlest setting and converting it
 * against the strongest are two different achievements, and one record covering both would say neither.
 */
export function drillItem(drill: DrillDefinition, level: EngineLevel): string {
  return `${drill.id}|${level}`
}

export function readDrillItem(item: string): { id: string; level: string } | null {
  const cut = item.lastIndexOf('|')
  if (cut <= 0 || cut === item.length - 1) return null
  return { id: item.slice(0, cut), level: item.slice(cut + 1) }
}

export interface DrillStanding {
  tries: number
  converted: number
  /** Whether the very first go was converted. Null when there has been no go. */
  firstConverted: boolean | null
  /** The most recent go, or null. */
  lastAt: number | null
  says: string
}

/**
 * How often this drill was converted.
 *
 * Out of the attempts the training store already keeps, which are append-only and keep the first go -- so the
 * first-time answer here is the real one rather than "solved eventually". Attempts that came out `unclear` are
 * counted as tries and not as conversions, because that is what they were.
 */
export function drillStanding(attempts: readonly TrainingAttempt[]): DrillStanding {
  const ordered = [...attempts].sort((a, b) => a.at - b.at)
  const converted = ordered.filter((one) => one.passed).length
  return {
    tries: ordered.length,
    converted,
    firstConverted: ordered.length ? ordered[0].passed : null,
    lastAt: ordered.length ? ordered[ordered.length - 1].at : null,
    says: ordered.length === 0
      ? 'Not tried yet.'
      : `Converted ${converted} of ${ordered.length} ${ordered.length === 1 ? 'try' : 'tries'}${ordered[0].passed ? ', including the first' : ', not counting the first'}.`
  }
}

/** The one line a record of an attempt reads as. */
export function drillVerdictText(drill: DrillDefinition, verdict: DrillVerdict, level: EngineLevel): string {
  const role = drill.role === 'defend' ? 'held out' : 'played out'
  const state =
    verdict.state === 'converted' ? 'converted' : verdict.state === 'missed' ? 'not converted' : verdict.state === 'unclear' ? 'no answer either way' : 'left unfinished'
  return `${drill.title}, ${role} against ${level}: ${state}. ${verdict.says}`
}

export interface DrillSummary {
  tries: number
  converted: number
  drills: number
  says: string
}

/** Every drill attempt in the store, counted. Nothing here is a rating. */
export function drillSummary(attempts: readonly TrainingAttempt[]): DrillSummary {
  const mine = attempts.filter((one) => one.area === 'drill')
  const converted = mine.filter((one) => one.passed).length
  const drills = new Set(mine.map((one) => one.item)).size
  return {
    tries: mine.length,
    converted,
    drills,
    says: mine.length === 0
      ? 'No drills played yet.'
      : `${mine.length} ${mine.length === 1 ? 'go' : 'goes'} at ${drills} ${drills === 1 ? 'drill' : 'drills'}, converted ${converted} of them.`
  }
}
