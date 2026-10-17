import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove, legalMoves, sideToMove } from './rules.ts'
import {
  ASSISTANCE_LEVELS,
  DIFFICULTIES,
  HINT_MOVETIME,
  MIN_DRAW_DEPTH,
  SKILL_LEVEL_NOTE,
  STANDARD_SETUP,
  STRENGTH_NOTE,
  THINK_SHARE,
  acceptDraw,
  addRemark,
  assistance,
  chooseEngineMove,
  claimFlag,
  clearHint,
  declineDraw,
  describeDifficulty,
  difficulty,
  engineAsked,
  engineOptionsFor,
  engineAnswered,
  engineFailed,
  engineShouldAcceptDraw,
  engineTurn,
  engineTurnRequest,
  hintAsked,
  hintRequest,
  mateImpossibleFor,
  metaFor,
  movesFor,
  offerDraw,
  pause,
  playMove,
  plyOf,
  pointsFor,
  readEngineUpdate,
  resign,
  resume,
  revealHint,
  setupProblems,
  sourceFor,
  startArena,
  summaryOf,
  thinkFor,
  thinkingLine,
  tick,
  turnOf,
  withdrawDraw,
  yourTurn,
  type ArenaSetup,
  type ArenaState,
  type Difficulty
} from './arena.ts'
import { TIME_CONTROLS, UNTIMED, newClock, remainingAt, startClock, timeControl } from './clock.ts'
import { COMMENTARY_STYLES } from './commentary.ts'

/**
 * A whole game against the engine, played out with no engine.
 *
 * That is what being pure buys: the session can be driven move by move from a test, the engine's answers can be
 * scripted -- including the wrong ones, which is where the bugs are -- and the clock is a number this file moves
 * by hand. Nothing here waits for anything.
 */

function fakeClock(start = 1000): { now: () => number; pass: (ms: number) => void } {
  let at = start
  return { now: () => at, pass: (ms: number) => { at += ms } }
}

const setupWith = (patch: Partial<ArenaSetup> = {}): ArenaSetup => ({ ...STANDARD_SETUP, ...patch })

/** Plays the engine's turn with a scripted answer, the way the screen does: ask, record, answer. */
function engineTurnWith(state: ArenaState, uci: string, now: number, roll = 0): ReturnType<typeof engineAnswered> {
  const request = engineTurnRequest(state, `r-${plyOf(state)}`, now)
  assert.ok(request, 'the engine was not asked when it was its turn')
  const asked = engineAsked(state, request, now)
  return engineAnswered(asked, { requestId: request.id, fen: request.fen, bestmove: uci, lines: [{ uci }] }, { now, roll })
}

// ---------------------------------------------------------------- the levels

test('every level maps to real engine settings and claims no rating', () => {
  const ids = new Set(DIFFICULTIES.map((one) => one.id))
  assert.equal(ids.size, DIFFICULTIES.length)
  for (const level of DIFFICULTIES) {
    const limits = level.think
    assert.ok(
      limits.movetime !== undefined || limits.depth !== undefined || limits.nodes !== undefined,
      `${level.id} has no search limit at all, so it is not a real setting`
    )
    if (limits.movetime !== undefined) assert.ok(limits.movetime >= 20 && limits.movetime <= 60_000)
    if (limits.depth !== undefined) assert.ok(limits.depth >= 1 && limits.depth <= 40)
    assert.ok(level.looseness >= 0 && level.looseness <= 1)
    assert.ok(level.spread >= 1)
    assert.ok(level.lines >= 1 && level.lines <= 5)
    // A level that plays loosely needs more than one line to choose from, or the looseness does nothing.
    if (level.looseness > 0) assert.ok(level.lines >= level.spread, `${level.id} plays loosely but asks for too few lines`)
    if (level.skillLevel !== undefined) assert.ok(level.skillLevel >= 0 && level.skillLevel <= 20)
    // No rating is claimed anywhere, because none has been measured.
    assert.ok(!/\belo\b/i.test(level.about), `${level.id} claims an Elo`)
    assert.ok(!/\b[12]\d{3}\b/.test(`${level.name} ${level.about}`), `${level.id} names a rating`)
  }
  assert.match(STRENGTH_NOTE, /approximate/i)
  assert.match(STRENGTH_NOTE, /does not claim a rating/i)
  // The dial is really set now (see EngineTurnRequest.skill), so the note says what happens rather than apologising
  // for what does not -- and it still says what happens on an engine that has no dial.
  assert.match(SKILL_LEVEL_NOTE, /Skill Level/)
  assert.match(SKILL_LEVEL_NOTE, /does not offer a Skill Level is never sent one/i)
})

test('the engine options a level would set are written down, and claim no rating', () => {
  for (const level of DIFFICULTIES) {
    const options = engineOptionsFor(level)
    if (level.skillLevel === undefined) {
      assert.deepEqual(options, [], `${level.id} is full strength and should set nothing`)
      continue
    }
    assert.deepEqual(options, [{ name: 'Skill Level', value: level.skillLevel }])
    // UCI_Elo would put a rating on the level, and none has been measured.
    assert.ok(!options.some((one) => /elo/i.test(one.name)), `${level.id} would set an Elo`)
  }
})

test('a level describes itself out of its own data', () => {
  const gentle = difficulty('gentle')
  const said = describeDifficulty(gentle)
  assert.match(said, new RegExp(String(gentle.think.movetime)))
  assert.match(said, /top \d+ lines/)
  assert.match(describeDifficulty(difficulty('full')), /always plays its first choice/)
  // An unknown level falls back to one that exists rather than to nothing.
  assert.ok(DIFFICULTIES.some((one) => one.id === difficulty('nonsense' as Difficulty).id))

  /*
   * Every handicap the level really applies is in the sentence.
   *
   * The strength dial is sent with every engine turn now (EngineTurnRequest.skill), so a sentence that listed only
   * the thinking time would be describing a weaker opponent than the one about to be played.
   */
  for (const level of DIFFICULTIES) {
    const sentence = describeDifficulty(level)
    if (level.skillLevel === undefined) {
      assert.ok(!/strength dial/.test(sentence), `${level.id} mentions a dial it does not set`)
      continue
    }
    assert.match(sentence, new RegExp(`strength dial to ${level.skillLevel} out of 20`), `${level.id} sets a dial its own description leaves out`)
  }
})

test('every level of help says exactly what it may reveal', () => {
  assert.equal(ASSISTANCE_LEVELS[0].id, 'none')
  for (const level of ASSISTANCE_LEVELS) {
    assert.ok(level.reveals.length > 0, `${level.id} does not say what it reveals`)
    assert.ok(level.about.length > 0)
  }
  assert.match(assistance('nudge').reveals, /No square/i)
  assert.match(assistance('idea').reveals, /No square/i)
  assert.equal(assistance('bogus' as 'none').id, 'none', 'an unknown level of help must fall back to none')
})

test('the one-click default is a real, playable setup', () => {
  assert.deepEqual(setupProblems(STANDARD_SETUP), [])
  assert.equal(STANDARD_SETUP.startFen, START_FEN)
  assert.ok(TIME_CONTROLS.some((one) => one.id === STANDARD_SETUP.control.id))
  assert.ok(DIFFICULTIES.some((one) => one.id === STANDARD_SETUP.difficulty))
  assert.ok(COMMENTARY_STYLES.some((one) => one.id === STANDARD_SETUP.commentary))
})

test('a setup that cannot be played is refused with the part that is wrong named', () => {
  const broken = setupProblems(setupWith({ startFen: 'not a position' }))
  assert.equal(broken.length, 1)
  assert.equal(broken[0].field, 'startFen')
  // A position that is already over has no game in it.
  const finished = setupProblems(setupWith({ startFen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }))
  assert.ok(finished.some((one) => one.field === 'startFen' && /finished/.test(one.reason)))
  assert.ok(setupProblems(setupWith({ difficulty: 'wrong' as Difficulty })).some((one) => one.field === 'difficulty'))
})

// ---------------------------------------------------------------- starting

test('a new game takes the colour asked for, and the clock starts on the side to move', () => {
  const clock = fakeClock()
  const white = startArena(setupWith({ side: 'w' }), { now: clock.now() })
  assert.equal(white.human, 'w')
  assert.equal(white.engine, 'b')
  assert.equal(white.clock.ticking, 'w')
  assert.equal(yourTurn(white), true)
  assert.equal(engineTurn(white), false)

  const black = startArena(setupWith({ side: 'b' }), { now: clock.now() })
  assert.equal(black.human, 'b')
  assert.equal(engineTurn(black), true, 'playing Black means the engine moves first')

  // A game from a position where Black is to move starts Black's clock, not White's.
  const fromBlack = startArena(setupWith({ startFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' }), { now: clock.now() })
  assert.equal(sideToMove(fromBlack.fen), 'b')
  assert.equal(fromBlack.clock.ticking, 'b')
})

test('a random colour comes from the number it is given, so it can be tested', () => {
  assert.equal(startArena(setupWith({ side: 'random' }), { now: 0, roll: 0.1 }).human, 'w')
  assert.equal(startArena(setupWith({ side: 'random' }), { now: 0, roll: 0.9 }).human, 'b')
})

test('a start position that is not a position falls back to the usual one rather than loading nothing', () => {
  const state = startArena(setupWith({ startFen: 'rubbish' }), { now: 0 })
  assert.equal(state.startFen, START_FEN)
  assert.equal(state.fen, START_FEN)
})

// ---------------------------------------------------------------- moves

test('a move out of turn, an illegal move and a move after the end all change nothing', () => {
  const clock = fakeClock()
  const state = startArena(setupWith(), { now: clock.now() })
  const outOfTurn = playMove(state, 'e5', 'engine', clock.now())
  assert.equal(outOfTurn.ok, false)
  assert.equal(outOfTurn.state, state, 'a refusal must not change the game')

  const illegal = playMove(state, 'e2e5', 'you', clock.now())
  assert.equal(illegal.ok, false)
  assert.equal(illegal.state.moves.length, 0)
  assert.equal(illegal.state.fen, START_FEN)

  const legal = playMove(state, 'e4', 'you', clock.now())
  assert.equal(legal.ok, true)
  assert.ok(legal.ok && legal.move)
  assert.equal(legal.ok && legal.move?.san, 'e4')
  assert.equal(legal.state.moves.length, 1)
  assert.equal(turnOf(legal.state), 'b')
})

test('a move is saved the way the Library stores one, with the seconds really left', () => {
  const clock = fakeClock()
  const state = startArena(setupWith({ control: timeControl(300, 2) }), { now: clock.now() })
  clock.pass(7000)
  const step = playMove(state, 'e4', 'you', clock.now())
  assert.ok(step.ok)
  const move = step.move
  assert.ok(move)
  assert.equal(move.san, 'e4')
  assert.equal(move.uci, 'e2e4')
  assert.equal(move.fen, applyMove(START_FEN, 'e4')?.after)
  // 300 - 7 + 2
  assert.equal(move.clock, 295)
  assert.deepEqual(movesFor(step.state), [move])

  // An untimed game records no clock at all rather than a made-up one.
  const untimed = playMove(startArena(setupWith({ control: UNTIMED }), { now: 0 }), 'e4', 'you', 500)
  assert.ok(untimed.ok)
  assert.equal(untimed.move?.clock, undefined)
})

test('a whole game is played out, ends in mate, and is over for good', () => {
  const clock = fakeClock()
  let state = startArena(setupWith({ side: 'w', control: timeControl(300, 0) }), { now: clock.now() })
  const yours = ['e4', 'Bc4', 'Qh5', 'Qxf7#']
  const theirs = ['e7e5', 'b8c6', 'g8f6']
  for (let i = 0; i < yours.length; i++) {
    clock.pass(2000)
    const mine = playMove(state, yours[i], 'you', clock.now())
    assert.ok(mine.ok, `your move ${yours[i]} was refused`)
    state = mine.state
    if (state.finish) break
    clock.pass(1000)
    const theirMove = engineTurnWith(state, theirs[i], clock.now())
    assert.ok(theirMove.ok, `the engine's move ${theirs[i]} was refused`)
    state = theirMove.state
  }
  assert.ok(state.finish)
  assert.equal(state.finish.reason, 'checkmate')
  assert.equal(state.finish.result, '1-0')
  assert.equal(state.finish.forYou, 'win')
  assert.equal(state.moves.length, 7)
  assert.equal(state.clock.ticking, null, 'the clock must stop when the game does')

  // Nothing is accepted afterwards: not a move, not a resignation, not a draw.
  assert.equal(playMove(state, 'e4', 'you', clock.now()).ok, false)
  assert.equal(resign(state, 'you', clock.now()).ok, false)
  assert.equal(offerDraw(state, 'you', clock.now()).ok, false)
  assert.equal(acceptDraw(state, 'engine', clock.now()).ok, false)
  assert.equal(engineTurnRequest(state, 'x', clock.now()), null)
  assert.equal(hintRequest(state, 'x'), null)
  // And the result cannot be changed by claiming something else happened.
  assert.equal(claimFlag(state, clock.now() + 10_000_000).finish?.reason, 'checkmate')
})

test('a stalemate and a draw by the rules are each named for what they were', () => {
  const stalemate = startArena(setupWith({ startFen: '7k/8/5QK1/8/8/8/8/8 w - - 0 1' }), { now: 0 })
  const step = playMove(stalemate, 'Qf7', 'you', 10)
  assert.ok(step.ok)
  assert.equal(step.state.finish?.reason, 'stalemate')
  assert.equal(step.state.finish?.result, '1/2-1/2')
  assert.equal(step.state.finish?.forYou, 'draw')

  const bare = startArena(setupWith({ side: 'b', startFen: '8/8/4k3/4P3/8/8/5K2/8 b - - 0 1' }), { now: 0 })
  const taken = playMove(bare, 'Kxe5', 'you', 10)
  assert.ok(taken.ok)
  assert.equal(taken.state.finish?.reason, 'insufficient-material')
})

// ---------------------------------------------------------------- the engine's turn

test('the engine is asked exactly once for a position, however often the screen asks', () => {
  const clock = fakeClock()
  const state = playMove(startArena(setupWith(), { now: clock.now() }), 'e4', 'you', clock.now()).state
  assert.equal(engineTurn(state), true)
  const first = engineTurnRequest(state, 'r1', clock.now())
  assert.ok(first)
  assert.equal(first.fen, state.fen)
  const asked = engineAsked(state, first, clock.now())
  // While it is thinking, and after it has been asked about this position, there is nothing more to ask.
  assert.equal(engineTurnRequest(asked, 'r2', clock.now()), null, 'a second search was started for one turn')
  const answered = engineAnswered(asked, { requestId: 'r1', fen: first.fen, bestmove: 'e7e5', lines: [{ uci: 'e7e5' }] }, { now: clock.now() })
  assert.ok(answered.ok)
  // The next turn is the person's, so still nothing.
  assert.equal(engineTurnRequest(answered.state, 'r3', clock.now()), null)
})

test('the engine is asked with the level’s own settings, for the position in front of it', () => {
  const clock = fakeClock()
  for (const level of DIFFICULTIES) {
    const state = playMove(startArena(setupWith({ difficulty: level.id, control: UNTIMED }), { now: clock.now() }), 'e4', 'you', clock.now()).state
    const request = engineTurnRequest(state, 'r', clock.now())
    assert.ok(request)
    assert.equal(request.fen, state.fen)
    assert.equal(request.multipv, level.lines)
    assert.equal(request.movetime, level.think.movetime)
    assert.equal(request.depth, level.think.depth)
  }
})

test('an answer to a different question is never played', () => {
  const clock = fakeClock()
  const state = playMove(startArena(setupWith(), { now: clock.now() }), 'e4', 'you', clock.now()).state
  const request = engineTurnRequest(state, 'r1', clock.now())
  assert.ok(request)
  const asked = engineAsked(state, request, clock.now())
  const legal = { uci: 'e7e5' }

  // A different request id: this is the answer to a search that was abandoned.
  const wrongId = engineAnswered(asked, { requestId: 'r2', fen: request.fen, bestmove: 'e7e5', lines: [legal] }, { now: clock.now() })
  assert.equal(wrongId.ok, false)
  assert.match(wrongId.ok ? '' : wrongId.problem, /different search/)

  // The right id about the wrong position: the board has moved on.
  const wrongFen = engineAnswered(asked, { requestId: 'r1', fen: START_FEN, bestmove: 'e2e4', lines: [{ uci: 'e2e4' }] }, { now: clock.now() })
  assert.equal(wrongFen.ok, false)
  assert.match(wrongFen.ok ? '' : wrongFen.problem, /different position/)

  // An answer when nothing was asked.
  const unasked = engineAnswered(state, { requestId: 'r1', fen: state.fen, bestmove: 'e7e5', lines: [legal] }, { now: clock.now() })
  assert.equal(unasked.ok, false)

  // An answer to the hint search is not a move.
  const hinting = hintAsked(state, { id: 'h1', fen: state.fen, multipv: 1 }, clock.now())
  assert.equal(engineAnswered(hinting, { requestId: 'h1', fen: state.fen, bestmove: 'e7e5' }, { now: clock.now() }).ok, false)
})

test('a move the engine offers is checked against this exact position before it is played', () => {
  const clock = fakeClock()
  const state = playMove(startArena(setupWith(), { now: clock.now() }), 'e4', 'you', clock.now()).state
  const request = engineTurnRequest(state, 'r1', clock.now())
  assert.ok(request)
  const asked = engineAsked(state, request, clock.now())

  // Nothing playable at all: refused, and the engine is let go of so the turn can be tried again.
  const rubbish = engineAnswered(asked, { requestId: 'r1', fen: state.fen, bestmove: 'e2e4', lines: [{ uci: 'a1a8' }, { uci: 'zzzz' }] }, { now: clock.now() })
  assert.equal(rubbish.ok, false)
  assert.equal(rubbish.state.thinking, null)
  assert.equal(rubbish.state.moves.length, 1, 'an unplayable answer must not reach the game')

  // No move offered at all: the note the engine service gave is what is reported.
  const none = engineAnswered(asked, { requestId: 'r1', fen: state.fen, bestmove: null, note: 'The engine reported no move for this position.' }, { now: clock.now() })
  assert.equal(none.ok, false)
  assert.match(none.ok ? '' : none.problem, /no move/)

  // A rotten first line and a sound second one: the sound one is played, because it is still the engine's own.
  const loose = startArena(setupWith({ difficulty: 'gentle' }), { now: clock.now() })
  const after = playMove(loose, 'e4', 'you', clock.now()).state
  const ask2 = engineTurnRequest(after, 'r2', clock.now())
  assert.ok(ask2)
  const mixed = engineAnswered(engineAsked(after, ask2, clock.now()), {
    requestId: 'r2',
    fen: ask2.fen,
    bestmove: 'e7e5',
    lines: [{ uci: 'h8h1' }, { uci: 'e7e5' }]
  }, { now: clock.now(), roll: 0 })
  assert.ok(mixed.ok)
  assert.equal(mixed.move?.san, 'e5')
})

test('a search that failed opens the turn again rather than freezing the game', () => {
  const clock = fakeClock()
  const state = playMove(startArena(setupWith(), { now: clock.now() }), 'e4', 'you', clock.now()).state
  const request = engineTurnRequest(state, 'r1', clock.now())
  assert.ok(request)
  const asked = engineAsked(state, request, clock.now())
  const failed = engineFailed(asked, 'The engine stopped while it was thinking.')
  assert.equal(failed.thinking, null)
  assert.match(failed.problem ?? '', /stopped/)
  const again = engineTurnRequest(failed, 'r2', clock.now())
  assert.ok(again, 'after a failure the engine must be askable again')
  assert.equal(again.fen, state.fen)
})

// ---------------------------------------------------------------- how strong it plays

test('a loose level plays one of the engine’s own lower choices, and never a move of Orbis’s own', () => {
  const candidates = [{ uci: 'e2e4' }, { uci: 'd2d4' }, { uci: 'g1f3' }, { uci: 'c2c4' }]
  const gentle = difficulty('gentle')
  const seen = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const choice = chooseEngineMove(candidates, gentle, i / 100)
    assert.ok(choice)
    assert.ok(candidates.some((one) => one.uci === choice.uci), 'a move that was not one of the engine’s own')
    assert.ok(choice.rank >= 1 && choice.rank <= gentle.spread)
    seen.add(choice.uci)
  }
  assert.ok(seen.size > 1, 'a loose level never varied at all')

  // Full strength is the engine's first choice, whatever the roll.
  const full = difficulty('full')
  for (let i = 0; i < 20; i++) {
    const choice = chooseEngineMove(candidates, full, i / 20)
    assert.equal(choice?.uci, 'e2e4')
    assert.equal(choice?.rank, 1)
    assert.equal(choice?.loose, false)
  }
})

test('junk from the engine is filtered out, and nothing to choose from is nothing', () => {
  const level = difficulty('gentle')
  assert.equal(chooseEngineMove([], level, 0), null)
  assert.equal(chooseEngineMove([{ uci: 'nonsense' }, { uci: '' }], level, 0), null)
  const one = chooseEngineMove([{ uci: 'zz' }, { uci: 'e2e4' }], level, 0.9)
  assert.equal(one?.uci, 'e2e4')
  // A promotion in coordinates is a real move and must survive the filter.
  assert.equal(chooseEngineMove([{ uci: 'a7a8q' }], level, 0)?.uci, 'a7a8q')
  // A roll outside its range is clamped rather than reaching past the list.
  for (const roll of [-5, 0, 0.5, 1, 99, Number.NaN]) {
    const choice = chooseEngineMove([{ uci: 'e2e4' }, { uci: 'd2d4' }], level, roll)
    assert.ok(choice)
    assert.ok(['e2e4', 'd2d4'].includes(choice.uci), String(roll))
  }
})

test('the engine never spends a serious share of a clock it has to finish the game on', () => {
  const clock = fakeClock()
  const level = difficulty('full')
  // Plenty of time: it takes what the level says.
  const roomy = startClock(newClock(timeControl(600, 0), clock.now()), 'b', clock.now())
  assert.equal(thinkFor(level, roomy, 'b', clock.now()).movetime, level.think.movetime)
  // Eight seconds left: three seconds would be a loss nobody chose.
  const tight = startClock(newClock(timeControl(8, 0), clock.now()), 'b', clock.now())
  const limited = thinkFor(level, tight, 'b', clock.now()).movetime
  assert.ok(limited !== undefined && limited < (level.think.movetime ?? 0))
  assert.equal(limited, Math.floor(8000 / THINK_SHARE))
  // An untimed game has no share to take, so the level's own time stands.
  assert.equal(thinkFor(level, newClock(UNTIMED, 0), 'b', 0).movetime, level.think.movetime)
  // There is always something, however little is left.
  const almost = startClock(newClock(timeControl(1, 0), clock.now()), 'b', clock.now())
  assert.ok((thinkFor(level, almost, 'b', clock.now()).movetime ?? 0) >= 50)
})

// ---------------------------------------------------------------- the clock, in a game

test('a clock that runs out ends the game, and who wins depends on what is left on the board', () => {
  const clock = fakeClock()
  // The engine is Black and runs out of time while the person still has a rook.
  let state = startArena(setupWith({ side: 'w', control: timeControl(10, 0) }), { now: clock.now() })
  state = playMove(state, 'e4', 'you', clock.now()).state
  clock.pass(11_000)
  state = tick(state, clock.now())
  assert.ok(state.finish)
  assert.equal(state.finish.reason, 'flag')
  assert.equal(state.finish.result, '1-0')
  assert.equal(state.finish.forYou, 'win')
  assert.match(state.finish.termination ?? '', /ran out of time/)

  /*
   * A flag against somebody who could not have mated anyway is a draw, not a win.
   *
   * The person has a bare king and the engine a queen. The engine's clock runs out, so the person wins on time --
   * except that a bare king cannot mate, which makes it a draw.
   */
  let bare = startArena(setupWith({ side: 'w', startFen: '6qk/8/8/8/8/8/8/K7 w - - 0 1', control: timeControl(10, 0) }), { now: clock.now() })
  assert.equal(mateImpossibleFor(bare.fen, 'w'), true)
  bare = playMove(bare, 'Kb1', 'you', clock.now()).state
  assert.equal(bare.finish, null, 'the test position was already over')
  clock.pass(11_000)
  bare = tick(bare, clock.now())
  assert.equal(bare.finish?.reason, 'flag')
  assert.equal(bare.finish?.result, '1/2-1/2')
})

test('what can still mate is decided from the pieces, and only where it is certain', () => {
  assert.equal(mateImpossibleFor('7k/8/8/8/8/8/8/K7 w - - 0 1', 'w'), true)
  assert.equal(mateImpossibleFor('7k/8/8/8/8/8/8/KN6 w - - 0 1', 'w'), true)
  assert.equal(mateImpossibleFor('7k/8/8/8/8/8/8/KB6 w - - 0 1', 'w'), true)
  // Two knights can mate, so it is a win rather than a draw.
  assert.equal(mateImpossibleFor('7k/8/8/8/8/8/8/KNN5 w - - 0 1', 'w'), false)
  assert.equal(mateImpossibleFor('7k/8/8/8/8/8/P7/K7 w - - 0 1', 'w'), false)
  assert.equal(pointsFor(START_FEN, 'w'), 39)
  assert.equal(pointsFor(START_FEN, 'b'), 39)
})

test('a pause charges nobody, and the clock does not run while the game is paused', () => {
  const clock = fakeClock()
  let state = startArena(setupWith({ control: timeControl(60, 0) }), { now: clock.now() })
  clock.pass(5000)
  state = pause(state, clock.now())
  assert.equal(state.clock.paused, true)
  clock.pass(600_000)
  assert.equal(tick(state, clock.now()).finish, null, 'a paused clock must not flag')
  assert.equal(remainingAt(state.clock, clock.now())?.w, 55_000)
  state = resume(state, clock.now())
  assert.equal(state.clock.ticking, 'w')
})

// ---------------------------------------------------------------- resigning, offering, agreeing

test('resigning hands the game to the other side, and says who resigned', () => {
  const yours = resign(startArena(setupWith({ side: 'w' }), { now: 0 }), 'you', 5)
  assert.ok(yours.ok)
  assert.equal(yours.state.finish?.result, '0-1')
  assert.equal(yours.state.finish?.forYou, 'loss')
  assert.match(yours.state.finish?.termination ?? '', /White resigned/)

  const theirs = resign(startArena(setupWith({ side: 'b' }), { now: 0 }), 'engine', 5)
  assert.ok(theirs.ok)
  assert.equal(theirs.state.finish?.result, '0-1')
  assert.equal(theirs.state.finish?.forYou, 'win')
})

test('a draw offer is an offer: it does not end the game, and a move declines it', () => {
  const clock = fakeClock()
  const state = startArena(setupWith(), { now: clock.now() })
  const offered = offerDraw(state, 'you', clock.now())
  assert.ok(offered.ok)
  assert.equal(offered.state.finish, null, 'an offer must never be a result')
  assert.ok(offered.state.drawOffer)
  assert.equal(offered.state.drawOffer.by, 'you')

  // Offering twice does nothing.
  assert.equal(offerDraw(offered.state, 'you', clock.now()).ok, false)
  // You cannot accept your own offer.
  assert.equal(acceptDraw(offered.state, 'you', clock.now()).ok, false)
  assert.equal(declineDraw(offered.state, 'you').ok, false)
  // Playing on declines it.
  const played = playMove(offered.state, 'e4', 'you', clock.now())
  assert.ok(played.ok)
  assert.equal(played.state.drawOffer, null)
  assert.equal(played.state.finish, null)

  // Accepted by the other side, it is a draw -- and only then.
  const accepted = acceptDraw(offered.state, 'engine', clock.now())
  assert.ok(accepted.ok)
  assert.equal(accepted.state.finish?.result, '1/2-1/2')
  assert.equal(accepted.state.finish?.reason, 'agreed-draw')
  assert.equal(accepted.state.finish?.forYou, 'draw')

  // Declined, the game carries on.
  const declined = declineDraw(offered.state, 'engine')
  assert.ok(declined.ok)
  assert.equal(declined.state.drawOffer, null)
  assert.equal(declined.state.finish, null)

  // Withdrawn by whoever made it, and by nobody else.
  assert.equal(withdrawDraw(offered.state, 'engine').ok, false)
  assert.ok(withdrawDraw(offered.state, 'you').ok)
  assert.equal(acceptDraw(state, 'engine', clock.now()).ok, false, 'there was no offer to accept')
})

test('the engine only takes a draw when something it can check says so', () => {
  const state = startArena(setupWith(), { now: 0 })
  // Nothing to go on: the answer is no, and it says why.
  const blind = engineShouldAcceptDraw(state)
  assert.equal(blind.accept, false)
  assert.match(blind.because, /nothing it can check/)
  // A position the rules already call a draw.
  const drawn = startArena(setupWith({ startFen: '7k/8/8/8/8/8/8/K7 w - - 0 1' }), { now: 0 })
  assert.equal(engineShouldAcceptDraw(drawn).accept, true)
  // Its own search, deep enough, says it is well behind.
  assert.equal(engineShouldAcceptDraw(state, { score: { kind: 'cp', cp: 400 }, depth: 20 }).accept, true)
  // The same number from a search too shallow to trust is not evidence.
  assert.equal(engineShouldAcceptDraw(state, { score: { kind: 'cp', cp: 400 }, depth: MIN_DRAW_DEPTH - 1 }).accept, false)
  // And it does not take a draw from a position its own search likes.
  assert.equal(engineShouldAcceptDraw(state, { score: { kind: 'cp', cp: -400 }, depth: 20 }).accept, false)
})

// ---------------------------------------------------------------- hints

test('no help means no hint, and a hint is only ever about the position in front of you', () => {
  const clock = fakeClock()
  const off = startArena(setupWith({ assistance: 'none' }), { now: clock.now() })
  assert.equal(hintRequest(off, 'h1'), null)
  assert.equal(revealHint(off, { requestId: 'h1', fen: off.fen, bestmove: 'e2e4' }, clock.now()).ok, false)

  const on = startArena(setupWith({ assistance: 'best' }), { now: clock.now() })
  const request = hintRequest(on, 'h1')
  assert.ok(request)
  assert.equal(request.fen, on.fen)
  assert.equal(request.movetime, HINT_MOVETIME)
  assert.equal(request.multipv, 1)

  const asked = hintAsked(on, request, clock.now())
  // An answer about another position cannot be shown here.
  const elsewhere = revealHint(asked, { requestId: 'h1', fen: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1', bestmove: 'e7e5' }, clock.now())
  assert.equal(elsewhere.ok, false)
  assert.match(elsewhere.ok ? '' : elsewhere.problem, /different position/)
  // An answer to another search is not this hint.
  assert.equal(revealHint(hintAsked(on, request, clock.now()), { requestId: 'h2', fen: on.fen, bestmove: 'e2e4' }, clock.now()).ok, false)
  // A move that cannot be played gives no hint rather than a wrong one.
  assert.equal(revealHint(hintAsked(on, request, clock.now()), { requestId: 'h1', fen: on.fen, bestmove: 'e2e5' }, clock.now()).ok, false)
  // And it is not your turn once you have moved.
  const moved = playMove(on, 'e4', 'you', clock.now()).state
  assert.equal(hintRequest(moved, 'h2'), null)
})

test('the level of help asked for bounds what the hint reveals, in its words and in its fields', () => {
  const clock = fakeClock()
  for (const level of ['nudge', 'idea', 'best'] as const) {
    const state = startArena(setupWith({ assistance: level, startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4' }), { now: clock.now() })
    const request = hintRequest(state, 'h1')
    assert.ok(request)
    const got = revealHint(hintAsked(state, request, clock.now()), { requestId: 'h1', fen: state.fen, bestmove: 'f3f7' }, clock.now())
    assert.ok(got.ok, level)
    const hint = got.hint
    assert.equal(hint.level, level)
    assert.equal(hint.fen, state.fen)
    assert.equal(got.state.hintsTaken, 1)
    if (level === 'best') {
      assert.equal(hint.uci, 'f3f7')
      assert.equal(hint.san, 'Qxf7#')
      assert.match(hint.text, /Qxf7/)
    } else {
      // Not in a field, and not in the words: a square anywhere is the move given away.
      assert.equal(hint.uci, undefined, `${level} carried the move in a field`)
      assert.equal(hint.san, undefined, `${level} carried the notation in a field`)
      assert.ok(!/[a-h][1-8]/.test(hint.text), `${level} leaked a square: ${hint.text}`)
      assert.ok(!/[KQRBN][a-h1-8]/.test(hint.text), `${level} leaked notation: ${hint.text}`)
      assert.match(hint.text, /queen/i, `${level} did not even say which piece`)
    }
    if (level === 'nudge') {
      // A nudge says which piece and stops. What the move does is the next rung up.
      assert.ok(!/takes|check/i.test(hint.text), `a nudge said what the move does: ${hint.text}`)
    }
    if (level === 'idea') {
      assert.match(hint.text, /checkmate|takes/i, 'the idea rung must say what the move achieves')
    }
    assert.equal(clearHint(got.state).hint, null)
  }
})

test('a hint describes what the move does out of the rules, for every kind of move', () => {
  const clock = fakeClock()
  const cases: [string, string, RegExp][] = [
    ['r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'f3f7', /checkmate/i],
    ['rnbqkbnr/pppp1ppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4', 'e1g1', /castles short/i],
    ['8/P7/8/8/8/8/5k2/K7 w - - 0 1', 'a7a8q', /becomes a queen/i],
    ['rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4d5', /takes a pawn/i],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3', /nothing is taken/i]
  ]
  for (const [fen, uci, pattern] of cases) {
    const state = startArena(setupWith({ assistance: 'idea', startFen: fen }), { now: clock.now() })
    const request = hintRequest(state, 'h')
    assert.ok(request, fen)
    const got = revealHint(hintAsked(state, request, clock.now()), { requestId: 'h', fen, bestmove: uci }, clock.now())
    assert.ok(got.ok, `${fen} ${uci}`)
    assert.match(got.hint.text, pattern)
    assert.ok(!/[a-h][1-8]/.test(got.hint.text), `leaked a square: ${got.hint.text}`)
  }
})

// ---------------------------------------------------------------- the summary, and saving

test('there is no summary until the game is over, and then it is honest about help taken', () => {
  const clock = fakeClock()
  let state = startArena(setupWith({ side: 'w', assistance: 'best', control: timeControl(300, 0) }), { now: clock.now() })
  assert.equal(summaryOf(state, { now: clock.now() }), null)

  const request = hintRequest(state, 'h1')
  assert.ok(request)
  const got = revealHint(hintAsked(state, request, clock.now()), { requestId: 'h1', fen: state.fen, bestmove: 'e2e4' }, clock.now())
  assert.ok(got.ok)
  state = got.state
  clock.pass(4000)
  state = playMove(state, 'e4', 'you', clock.now()).state
  clock.pass(1000)
  state = resign(state, 'engine', clock.now()).state

  const summary = summaryOf(state, { now: clock.now(), engineName: 'Stockfish 17' })
  assert.ok(summary)
  assert.equal(summary.result, '1-0')
  assert.equal(summary.forYou, 'win')
  assert.equal(summary.headline, 'You won.')
  assert.match(summary.detail, /resigned/)
  assert.equal(summary.plies, 1)
  assert.equal(summary.moves, 1)
  assert.equal(summary.hintsTaken, 1)
  assert.equal(summary.assisted, true, 'a game played with the move shown is not a clean win and must say so')
  assert.equal(summary.engineName, 'Stockfish 17')
  assert.equal(summary.timeControl, '5 + 0')
  assert.ok(summary.spent.w >= 4000)
})

test('the summary leads with how it went for the person, not with the score line', () => {
  const lost = resign(startArena(setupWith({ side: 'w' }), { now: 0 }), 'you', 1).state
  assert.equal(summaryOf(lost)?.headline, 'You lost.')
  const drawn = acceptDraw(offerDraw(startArena(setupWith(), { now: 0 }), 'engine', 1).state, 'you', 2).state
  assert.equal(summaryOf(drawn)?.headline, 'Drawn.')
  assert.equal(summaryOf(drawn)?.assisted, false)
})

test('what is not known is left out of the record, and the engine’s name is never invented', () => {
  const unnamed = startArena(setupWith({ side: 'w' }), { now: 0 })
  const meta = metaFor(unnamed)
  assert.deepEqual(meta.white, {}, 'a person who gave no name has no name')
  assert.deepEqual(meta.black, {}, 'an engine that never said its name has no name')
  assert.equal(meta.result, '*', 'an unfinished game is unfinished')
  assert.equal(meta.timeControl, '600+0')
  assert.equal(meta.event, 'Orbis AI Arena')
  assert.equal(meta.extra?.OrbisLevel, difficulty(STANDARD_SETUP.difficulty).name)
  assert.equal(meta.extra?.OrbisHints, undefined)
  assert.ok(!('rating' in (meta.white as Record<string, unknown>)))

  const named = metaFor({ ...unnamed, setup: { ...unnamed.setup, yourName: '  Kavin  ' } }, { engineName: 'Stockfish 17' })
  assert.equal(named.white.name, 'Kavin')
  assert.equal(named.black.name, 'Stockfish 17')

  // Playing Black puts the engine on White.
  const asBlack = metaFor(startArena(setupWith({ side: 'b', yourName: 'Kavin' }), { now: 0 }), { engineName: 'Stockfish 17' })
  assert.equal(asBlack.white.name, 'Stockfish 17')
  assert.equal(asBlack.black.name, 'Kavin')

  // An untimed game carries no TimeControl tag rather than a made-up one.
  assert.equal(metaFor(startArena(setupWith({ control: UNTIMED }), { now: 0 })).timeControl, undefined)
})

test('a finished game’s record says the result and how it ended', () => {
  const state = resign(startArena(setupWith({ side: 'w' }), { now: 0 }), 'you', 1).state
  const meta = metaFor(state)
  assert.equal(meta.result, '0-1')
  assert.match(meta.termination ?? '', /White resigned/)
})

test('the game’s source names the engine that really played, and the level that was set', () => {
  const state = startArena(setupWith({ difficulty: 'gentle' }), { now: 0 })
  const named = sourceFor(state, 'Stockfish 17')
  assert.equal(named.kind, 'local-engine')
  assert.equal(named.kind === 'local-engine' && named.engine, 'Stockfish 17')
  assert.match(named.kind === 'local-engine' ? (named.level ?? '') : '', /Gentle/)
  // With no handshake there is no name, and it is not guessed.
  const unnamed = sourceFor(state)
  assert.equal(unnamed.kind === 'local-engine' && unnamed.engine, 'a local engine')
})

test('the thinking line says what is happening and for how long', () => {
  const clock = fakeClock()
  const state = playMove(startArena(setupWith({ difficulty: 'club' }), { now: clock.now() }), 'e4', 'you', clock.now()).state
  assert.equal(thinkingLine(state, clock.now()), null)
  const request = engineTurnRequest(state, 'r', clock.now())
  assert.ok(request)
  const asked = engineAsked(state, request, clock.now())
  clock.pass(1500)
  assert.match(thinkingLine(asked, clock.now()) ?? '', /Club: thinking… 1\.5s/)
  const hinting = hintAsked(state, { id: 'h', fen: state.fen, multipv: 1 }, clock.now())
  assert.match(thinkingLine(hinting, clock.now()) ?? '', /Asking the engine/)
})

test('remarks are kept, newest last, and the list does not grow for ever', () => {
  let state = startArena(setupWith(), { now: 0 })
  for (let i = 0; i < 60; i++) state = addRemark(state, { ply: i, text: `remark ${i}`, from: 'board', id: 'quiet-move' })
  assert.equal(state.remarks.length, 40)
  assert.equal(state.remarks.at(-1)?.text, 'remark 59')
  assert.equal(state.remarks[0].text, 'remark 20')
})

test('a long game of real moves stays legal from the first move to the last', () => {
  const clock = fakeClock()
  let state = startArena(setupWith({ side: 'w', control: timeControl(600, 5), difficulty: 'gentle' }), { now: clock.now() })
  let turns = 0
  while (!state.finish && turns < 120) {
    const moves = legalMoves(state.fen)
    assert.ok(moves.length > 0, 'a position with no legal moves should have ended the game')
    clock.pass(200)
    if (yourTurn(state)) {
      const step = playMove(state, moves[turns % moves.length].uci, 'you', clock.now())
      assert.ok(step.ok, step.ok ? '' : step.problem)
      state = step.state
    } else {
      // The engine's own list, in the order a search would give it.
      const lines = moves.slice(0, 4).map((one) => ({ uci: one.uci }))
      const request = engineTurnRequest(state, `r-${turns}`, clock.now())
      assert.ok(request)
      const step = engineAnswered(engineAsked(state, request, clock.now()), { requestId: request.id, fen: request.fen, bestmove: lines[0].uci, lines }, { now: clock.now(), roll: (turns % 7) / 10 })
      assert.ok(step.ok, step.ok ? '' : step.problem)
      state = step.state
    }
    turns += 1
    // Every position in the game is one the rules accept, and the move list matches it.
    assert.equal(state.fen, state.moves.at(-1)?.fen ?? state.startFen)
  }
  assert.ok(state.moves.length > 20)
  // The notation kept beside the moves is the notation of the moves.
  assert.deepEqual(state.history, state.moves.map((one) => one.san))
})

// ---------------------------------------------------------------- reading the engine's updates

test('an update with nothing to attach it to is ignored rather than shown under the wrong position', () => {
  for (const bad of [null, undefined, 42, 'text', {}, { requestId: 'r' }, { fen: START_FEN }, { requestId: '', fen: START_FEN }, { requestId: 'r', fen: 'rubbish' }, { requestId: 'r', fen: '' }]) {
    assert.equal(readEngineUpdate(bad), null, JSON.stringify(bad))
  }
})

test('an update is read into the facts it carries, and a score that is not a score is no score', () => {
  const update = readEngineUpdate({
    requestId: 'r1',
    fen: START_FEN,
    complete: true,
    score: { kind: 'cp', cp: 34 },
    depth: 18,
    bestmove: 'e2e4',
    bestmoveSan: 'e4',
    bound: null,
    note: null,
    lines: [{ pvUci: ['e2e4', 'e7e5'] }, { pvUci: ['d2d4'] }, { pvUci: [] }, { pvUci: ['nonsense'] }, null]
  })
  assert.ok(update)
  assert.equal(update.requestId, 'r1')
  assert.equal(update.complete, true)
  assert.deepEqual(update.score, { kind: 'cp', cp: 34 })
  assert.equal(update.depth, 18)
  assert.equal(update.bestmove, 'e2e4')
  // Only the playable first moves, in the engine's own order, with the junk dropped.
  assert.deepEqual(update.lines, [{ uci: 'e2e4' }, { uci: 'd2d4' }])

  // A score of a shape nothing understands is "none", never zero.
  const vague = readEngineUpdate({ requestId: 'r', fen: START_FEN, score: { kind: 'guess', value: 7 } })
  assert.deepEqual(vague?.score, { kind: 'none' })
  assert.equal(vague?.complete, false)
  assert.equal(vague?.bestmove, null)
  assert.deepEqual(vague?.lines, [])

  // The engine's first choice always leads the list, even when the lines did not mention it.
  const led = readEngineUpdate({ requestId: 'r', fen: START_FEN, bestmove: 'g1f3', lines: [{ pvUci: ['d2d4'] }] })
  assert.deepEqual(led?.lines, [{ uci: 'g1f3' }, { uci: 'd2d4' }])

  // A bound is carried as a bound, so nothing records it as a settled score.
  assert.equal(readEngineUpdate({ requestId: 'r', fen: START_FEN, bound: 'lower' })?.bound, 'lower')
})

test('an update read from the engine drives a real turn, and one from the wrong search does not', () => {
  const clock = fakeClock()
  const state = playMove(startArena(setupWith(), { now: clock.now() }), 'e4', 'you', clock.now()).state
  const request = engineTurnRequest(state, 'r1', clock.now())
  assert.ok(request)
  const asked = engineAsked(state, request, clock.now())
  const update = readEngineUpdate({
    requestId: 'r1',
    fen: request.fen,
    complete: true,
    score: { kind: 'cp', cp: 20 },
    depth: 12,
    bestmove: 'e7e5',
    lines: [{ pvUci: ['e7e5', 'g1f3'] }]
  })
  assert.ok(update)
  const step = engineAnswered(asked, update, { now: clock.now() })
  assert.ok(step.ok)
  assert.equal(step.move?.san, 'e5')

  // The same answer, relabelled with another request: refused.
  const stale = readEngineUpdate({ requestId: 'r9', fen: request.fen, complete: true, bestmove: 'e7e5', lines: [{ pvUci: ['e7e5'] }] })
  assert.ok(stale)
  assert.equal(engineAnswered(asked, stale, { now: clock.now() }).ok, false)
})
