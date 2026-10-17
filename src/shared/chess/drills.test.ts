import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ENDING_PIECES, RESULT_WORD,
  drillItem, drillStanding, drillSetup, drillSummary, drillVerdictText, endgameDrills, gameDrills, judgeDrill,
  movesBy, progressFrom, readDrillItem, worthTo,
  type DrillDefinition, type DrillGame
} from './drills.ts'
import { ENDGAMES } from './endgamesData.ts'
import { acceptDraw, offerDraw, playMove, resign, startArena, type ArenaState } from './arena.ts'
import { canPlayFrom, type TrainingAttempt } from './trainingView.ts'
import { START_FEN, applyMove, legalMoves, sideToMove } from './rules.ts'
import { objectiveText } from './endgames.ts'

/**
 * Drills: a position played out against the engine until it is converted.
 *
 * The judging is the point of this file. Four things it has to get right, each of which would be an invisible lie
 * on screen if it did not:
 *
 *   - a position that was converted is converted, and one where the objective has gone is reported as gone, by the
 *     Endgame Lab's own judge rather than by a second opinion that can drift away from it;
 *   - the defending side is only offered where a search settled how long holding out means, and a game that ends
 *     some other way is reported as an answer to no question rather than as a win;
 *   - a drill from somebody's own game claims nothing about the position, only that this attempt came out better
 *     or did not;
 *   - the engine's level is part of what an attempt is filed under, because converting against the gentlest
 *     setting and converting against the strongest are not the same achievement.
 */

const NOW = 1_000_000

const play = (state: ArenaState, moves: readonly string[]): ArenaState => {
  let game = state
  for (const move of moves) {
    const by = sideToMove(game.fen) === game.human ? 'you' : 'engine'
    const step = playMove(game, move, by, NOW)
    assert.ok(step.ok, `${move} was refused: ${step.ok ? '' : step.problem}`)
    game = step.state
  }
  return game
}

const started = (drill: DrillDefinition): ArenaState =>
  startArena(drillSetup(drill, { level: 'club' }), { now: NOW })

const drillNamed = (id: string): DrillDefinition => {
  const found = endgameDrills().drills.find((one) => one.id === id)
  assert.ok(found, `there is no drill called ${id}`)
  return found
}

// ---------------------------------------------------------------- the list of positions

describe('the Endgame Lab as drills', () => {
  const built = endgameDrills()

  test('every ending in the lab is offered, and nothing is offered twice', () => {
    assert.ok(built.drills.length >= ENDGAMES.length, `${built.drills.length} drills from ${ENDGAMES.length} endings`)
    const ids = built.drills.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length, 'two drills share an id')
  })

  test('every position can be played from, and the side to move is the side it says', () => {
    for (const drill of built.drills) {
      const guard = canPlayFrom(drill.fen)
      assert.ok(guard.ok, `${drill.id}: ${guard.says ?? ''}`)
      const turn = sideToMove(drill.fen)
      if (drill.role === 'convert') assert.equal(turn, drill.you, `${drill.id} does not start with you to move`)
      else assert.notEqual(turn, drill.you, `${drill.id} is a defending drill that starts with you to move`)
    }
  })

  test('every drill says what has to happen and where the position came from', () => {
    for (const drill of built.drills) {
      assert.ok(drill.objective.length > 20, `${drill.id} has no objective worth reading`)
      assert.ok(drill.provenance.length > 40, `${drill.id} does not say where it came from`)
    }
  })

  test('a winning drill asks exactly what the lab asks, so there are not two objectives', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    assert.ok(drill.entry)
    assert.equal(drill.objective, objectiveText(drill.entry))
  })

  test('the defending side is only offered where a search settled how long holding out means', () => {
    for (const drill of built.drills.filter((one) => one.role === 'defend')) {
      assert.ok(drill.entry)
      assert.equal(drill.entry.objective.kind, 'mate-in')
      assert.ok((drill.holdMoves ?? 0) >= 2, `${drill.id} offers holding out for ${String(drill.holdMoves)} moves`)
    }
  })

  test('and everywhere else the refusal says why rather than quietly showing fewer', () => {
    const refusedIds = built.refused.map((one) => one.id)
    const technique = ENDGAMES.find((one) => one.objective.kind === 'technique')
    assert.ok(technique)
    assert.ok(refusedIds.includes(`${technique.id}:defend`), 'a technique ending should refuse the defending side')
    for (const one of built.refused) assert.ok(one.says.length > 20, `${one.id} was refused without a reason`)
  })

  test('a mate in one has no defending drill: there is nothing to hold out against', () => {
    const quick = ENDGAMES.find((one) => one.objective.kind === 'mate-in' && one.objective.moves === 1)
    assert.ok(quick)
    assert.equal(built.drills.find((one) => one.id === `eg:${quick.id}:defend`), undefined)
    const refusal = built.refused.find((one) => one.id === `${quick.id}:defend`)
    assert.ok(refusal, 'the mate in one should refuse the defending side out loud')
    assert.match(refusal.says, /nothing to hold out against/)
  })
})

// ---------------------------------------------------------------- counting moves

describe('counting the moves', () => {
  test('whose moves are whose, from either side of the board', () => {
    const drill = drillNamed('eg:mate-rook-the-box:convert')
    let game = started(drill)
    assert.equal(movesBy(game, 'w'), 0)
    assert.equal(movesBy(game, 'b'), 0)
    const first = sideToMove(game.fen)
    const other = first === 'w' ? 'b' : 'w'
    game = play(game, [legalFirst(game.fen)])
    assert.equal(movesBy(game, first), 1)
    assert.equal(movesBy(game, other), 0)
    game = play(game, [legalFirst(game.fen)])
    assert.equal(movesBy(game, first), 1)
    assert.equal(movesBy(game, other), 1)
  })

  test('a promotion is counted from what was played, not from the pieces on the board', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    assert.ok(drill.entry)
    const game = started(drill)
    const quiet = progressFrom(drill.entry, game)
    assert.equal(quiet.learnerMoves, 0)
    assert.equal(quiet.learnerPromoted, false)
    const pretend = { ...game, history: ['Ra8+', 'Kh7', 'g8=Q+'], moves: game.moves }
    const counted = progressFrom(drill.entry, pretend)
    assert.equal(counted.learnerMoves, 2)
    assert.equal(counted.learnerPromoted, true)
    assert.equal(counted.defencePromoted, false)
  })
})

// ---------------------------------------------------------------- winning it

describe('playing a winning drill out', () => {
  test('the mate is reported as the objective met', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    const game = play(started(drill), ['Ra8#'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'converted')
    assert.equal(verdict.yourMoves, 1)
    assert.equal(verdict.allowed, 1)
  })

  test('before anything happens it is still open, and it says what is being asked', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    const verdict = judgeDrill(drill, started(drill))
    assert.equal(verdict.state, 'playing')
    assert.equal(verdict.says, drill.objective)
  })

  test('a mate in one that took two moves is reported as missed, in the lab\'s own words', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    // Ra1-a7 does not mate, Black steps out, and the move the mate was there in has gone.
    const game = play(started(drill), ['Ra7', 'Kf8'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'missed')
    assert.match(verdict.says, /mate was there in 1/)
  })

  test('stalemate is a loss of the win, not a win', () => {
    const drill = thrownAway()
    const game = play(started(drill), ['Qg6'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'missed')
    assert.match(verdict.says, /stalemate/)
    assert.match(verdict.says, /the win is gone/)
  })

  test('the level the engine was on is always named, so a conversion is never read as more than it is', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    const verdict = judgeDrill(drill, started(drill))
    assert.ok(verdict.caveats.some((one) => /The engine was on/.test(one)))
  })

  test('an ending whose claim is standard theory rather than proved says so', () => {
    const checked = endgameDrills().drills.find(
      (one) => one.role === 'convert' && one.entry !== null && one.entry.objective.kind === 'technique'
    )
    assert.ok(checked)
    const verdict = judgeDrill(checked, started(checked))
    assert.ok(verdict.caveats.some((one) => /standard theory/.test(one)))
  })
})

// ---------------------------------------------------------------- holding out

describe('holding out', () => {
  const defending = (holdMoves: number): DrillDefinition => ({
    ...drillNamed('eg:mate-back-rank:convert'),
    id: 'test:defend',
    role: 'defend',
    you: 'b',
    holdMoves,
    objective: 'Make them take all of it.'
  })

  test('taking every move the position allows is holding out', () => {
    const drill = defending(1)
    const game = play(started(drill), ['Ra8#'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'converted')
    assert.equal(verdict.theirMoves, 1)
  })

  test('being mated sooner than the position allows is not', () => {
    const drill = defending(2)
    const game = play(started(drill), ['Ra8#'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'missed')
    assert.match(verdict.says, /quicker mate/)
  })

  test('while it is going it says how many of their moves have gone', () => {
    const drill = defending(3)
    const game = play(started(drill), ['Ra7', 'Kf8'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'playing')
    assert.match(verdict.says, /1 of their 3 moves/)
  })

  test('a draw is reported as a disagreement with the stored claim, never as a win', () => {
    const drill: DrillDefinition = { ...defending(4), fen: STALEMATE_FEN }
    const game = play(started(drill), ['Qg6'])
    const verdict = judgeDrill(drill, game)
    assert.equal(verdict.state, 'unclear')
    assert.match(verdict.says, /let slip/)
  })

  test('a defending drill always says what a gentle engine would mean', () => {
    const drill = defending(3)
    assert.ok(judgeDrill(drill, started(drill)).caveats.some((one) => /gentler engine/.test(one)))
  })

  test('a defending drill with no number to hold out for judges nothing', () => {
    const drill = { ...defending(3), holdMoves: null }
    assert.equal(judgeDrill(drill, started(drill)).state, 'unclear')
  })
})

// ---------------------------------------------------------------- your own games

describe('your own games', () => {
  const ending: DrillGame = {
    id: 'g1',
    startFen: '8/8/8/8/4k3/8/4P3/4K3 w - - 0 1',
    moves: [],
    result: '0-1',
    you: 'w',
    title: 'Tuesday night'
  }

  test('a lost ending becomes a drill, and the claim it makes is only about the game', () => {
    const built = gameDrills([ending])
    assert.equal(built.drills.length, 1)
    const drill = built.drills[0]
    assert.equal(drill.origin, 'your-game')
    assert.equal(drill.fen, ending.startFen)
    assert.equal(drill.game?.wasWorth, 0)
    assert.match(drill.provenance, /no tablebase/)
    assert.match(drill.objective, /come out better/)
  })

  test('a game you won is not offered, and the refusal says why', () => {
    const built = gameDrills([{ ...ending, result: '1-0' }])
    assert.equal(built.drills.length, 0)
    assert.match(built.refused[0].says, /was a win/)
  })

  test('a game with no result is not offered: there is nothing for an attempt to beat', () => {
    const built = gameDrills([{ ...ending, result: '*' }])
    assert.equal(built.drills.length, 0)
    assert.match(built.refused[0].says, /no result/)
  })

  test('a game that never reached an ending is not offered', () => {
    const built = gameDrills([{ ...ending, startFen: START_FEN, result: '0-1' }])
    assert.equal(built.drills.length, 0)
    assert.match(built.refused[0].says, new RegExp(`${ENDING_PIECES} pieces or fewer`))
  })

  test('the position taken is the first ending with you to move, wherever in the game it falls', () => {
    // Four captures in: the two pawns and both queens. The first White-to-move position with 28 pieces or fewer
    // besides the kings is the one after Black recaptures on d5, which is half-move four.
    const walked = walkGame(START_FEN, ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qe5+', 'Qe2', 'Qxe2+', 'Bxe2', 'Nf6'])
    const built = gameDrills([{ ...ending, startFen: START_FEN, moves: walked, result: '0-1' }], { mostPieces: 28 })
    assert.equal(built.drills.length, 1)
    assert.equal(built.drills[0].game?.ply, 4)
    assert.equal(built.drills[0].id, 'game:g1:4')
  })

  test('doing better than the game did is the whole claim', () => {
    const drill = gameDrills([ending]).drills[0]
    const game = started(drill)
    assert.equal(judgeDrill(drill, game).state, 'playing')
    const verdict = judgeDrill(drill, drawnBy(game))
    assert.equal(verdict.state, 'converted')
    assert.match(verdict.says, /A draw this time/)
  })

  test('the same result as the game is not a conversion', () => {
    const drill = gameDrills([{ ...ending, result: '1/2-1/2' }]).drills[0]
    const verdict = judgeDrill(drill, drawnBy(started(drill)))
    assert.equal(verdict.state, 'missed')
    assert.match(verdict.says, /The same as the game/)
  })

  test('and coming out worse than the game says that too', () => {
    const drill = gameDrills([{ ...ending, result: '1/2-1/2' }]).drills[0]
    const step = resign(started(drill), 'you', NOW)
    assert.ok(step.ok)
    const verdict = judgeDrill(drill, step.state)
    assert.equal(verdict.state, 'missed')
    assert.match(verdict.says, /Worse than the game/)
  })

  test('and a drill from your own game never claims the position was winning', () => {
    const drill = gameDrills([ending]).drills[0]
    assert.ok(judgeDrill(drill, started(drill)).caveats.some((one) => /no tablebase was asked/.test(one)))
  })

  test('what a result was worth is read from the result and nothing else', () => {
    assert.equal(worthTo('1-0', 'w'), 1)
    assert.equal(worthTo('1-0', 'b'), 0)
    assert.equal(worthTo('1/2-1/2', 'w'), 0.5)
    assert.equal(worthTo('*', 'w'), null)
    assert.equal(RESULT_WORD['0-1'], 'Black won')
  })
})

// ---------------------------------------------------------------- the record

describe('the record of how often it was converted', () => {
  const attempt = (over: Partial<TrainingAttempt>): TrainingAttempt => ({
    id: 'a', at: 1, area: 'drill', item: 'eg:x:convert|club', strict: false, verdict: '', passed: false, ...over
  })

  test('the level is part of what an attempt is filed under, and it reads back', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    const item = drillItem(drill, 'full')
    assert.equal(item, 'eg:mate-back-rank:convert|full')
    assert.deepEqual(readDrillItem(item), { id: 'eg:mate-back-rank:convert', level: 'full' })
    assert.equal(readDrillItem('nothing'), null)
    assert.equal(readDrillItem('|club'), null)
  })

  test('the first go is reported separately, because it is the one that says it was unaided', () => {
    const standing = drillStanding([
      attempt({ id: '1', at: 10, passed: false }),
      attempt({ id: '2', at: 20, passed: true }),
      attempt({ id: '3', at: 30, passed: true })
    ])
    assert.equal(standing.tries, 3)
    assert.equal(standing.converted, 2)
    assert.equal(standing.firstConverted, false)
    assert.equal(standing.lastAt, 30)
    assert.match(standing.says, /not counting the first/)
  })

  test('nothing tried says nothing tried, rather than nought out of nought', () => {
    const standing = drillStanding([])
    assert.equal(standing.firstConverted, null)
    assert.equal(standing.says, 'Not tried yet.')
  })

  test('the summary counts only drill attempts', () => {
    const summary = drillSummary([
      attempt({ id: '1', passed: true }),
      attempt({ id: '2', item: 'eg:y:defend|club', passed: false }),
      attempt({ id: '3', area: 'blindfold', item: 'locate', passed: true })
    ])
    assert.equal(summary.tries, 2)
    assert.equal(summary.converted, 1)
    assert.equal(summary.drills, 2)
  })

  test('the verdict kept with an attempt names the drill, the level and how it went', () => {
    const drill = drillNamed('eg:mate-back-rank:convert')
    const text = drillVerdictText(drill, judgeDrill(drill, play(started(drill), ['Ra8#'])), 'club')
    assert.match(text, /The back rank/)
    assert.match(text, /club/)
    assert.match(text, /converted/)
  })
})

// ---------------------------------------------------------------- helpers for the tests themselves

/**
 * Queen and king against a bare king, one move from being thrown away.
 *
 * White's queen on g1 can reach g6, where it takes every square the king on h8 has and gives no check: stalemate,
 * and the win with it. The one move a beginner makes.
 */
const STALEMATE_FEN = '7k/8/8/8/8/8/8/K5Q1 w - - 0 1'

function thrownAway(): DrillDefinition {
  const base = drillNamed('eg:mate-back-rank:convert')
  assert.ok(base.entry)
  return {
    ...base,
    id: 'test:stalemate',
    fen: STALEMATE_FEN,
    you: 'w',
    entry: { ...base.entry, id: 'test-stalemate', fen: STALEMATE_FEN, sideToMove: 'w', objective: { kind: 'win' } }
  }
}

/** A game that ended in an agreed draw. Nothing in the position decides it, which is the point. */
function drawnBy(game: ArenaState): ArenaState {
  const offered = offerDraw(game, 'engine', NOW)
  assert.ok(offered.ok)
  const taken = acceptDraw(offered.state, 'you', NOW)
  assert.ok(taken.ok)
  assert.equal(taken.state.finish?.result, '1/2-1/2')
  return taken.state
}

/** A legal move in a position, in notation, read off the rules. Used where the test only needs *a* move. */
function legalFirst(fen: string): string {
  const moves = legalMoves(fen)
  assert.ok(moves.length > 0, `no move could be found in ${fen}`)
  return moves[0].san
}

/** A line replayed through the rules, as a stored game's moves. */
function walkGame(startFen: string, san: readonly string[]): { san: string; fen: string }[] {
  const out: { san: string; fen: string }[] = []
  let fen = startFen
  for (const move of san) {
    const made = applyMove(fen, move)
    assert.ok(made, `${move} could not be played in ${fen}`)
    fen = made.after
    out.push({ san: made.san, fen })
  }
  return out
}
