import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LADDER_NOTE,
  OPPONENTS,
  RATING_NOTE,
  SKILL_OPTION,
  SKILL_RANGE,
  STYLE_NOTE,
  describeOpponent,
  handicapReach,
  isOpponentId,
  ladder,
  levelForOpponent,
  opponent,
  opponentLines,
  setupForOpponent,
  type AdvertisedOption,
  type Opponent,
  type OpponentId
} from './opponents.ts'
import { ENGINE_RANGES } from './settings.ts'
import {
  STANDARD_SETUP,
  engineAsked,
  engineTurnRequest,
  playMove,
  reviewAsk,
  startArena,
  summaryOf,
  takeBack,
  resign,
  setupProblems,
  hintRequest,
  turnOf
} from './arena.ts'
import { UNTIMED, timeControl } from './clock.ts'

/**
 * The list of opponents, and what a game against one really asks the engine for.
 *
 * The point of most of this file is the second half of the heading. A roster is easy to get right and easy to make
 * meaningless: nine names in front of one engine setting, or nine settings that never reach the engine, both look
 * exactly the same on screen.
 */

/*
 * The ranges the main process really holds an analysis request to.
 *
 * Copied from `src/main/chess/ipc.ts` (the `chess:analyse` handler: movetime 50-600000, depth 1-40, nodes
 * 1000-1e10, multipv 1-5) and from the `skill` clamp added beside them, because a shared test cannot import the
 * main process -- that file reaches for Electron. `src/shared/chess/settings.ts` declares its own copy of three of
 * them for the settings screen, and the test below holds the two copies to each other so a change to one of them
 * cannot pass unnoticed in the other.
 */
const IPC_LIMITS = {
  movetime: { low: 50, high: 600_000 },
  depth: { low: 1, high: 40 },
  nodes: { low: 1000, high: 1e10 },
  multipv: { low: 1, high: 5 },
  skill: { low: 0, high: 20 }
} as const

const stockfishDial: AdvertisedOption = { name: SKILL_OPTION, type: 'spin', min: 0, max: 20 }

// ---------------------------------------------------------------- the list itself

test('the list is well formed: one of each, in order, each saying what it is', () => {
  assert.ok(OPPONENTS.length >= 3, 'a list this short is not a ladder')
  const ids = new Set(OPPONENTS.map((one) => one.id))
  assert.equal(ids.size, OPPONENTS.length, 'two opponents share an id')
  const names = new Set(OPPONENTS.map((one) => one.name))
  assert.equal(names.size, OPPONENTS.length, 'two opponents share a name')

  const rungs = OPPONENTS.map((one) => one.rung)
  assert.deepEqual(rungs, [...rungs].sort((a, b) => a - b), 'the list is not in order')
  assert.deepEqual(rungs, OPPONENTS.map((_one, at) => at + 1), 'the rungs are not 1, 2, 3 ...')
  assert.deepEqual(ladder().map((one) => one.id), OPPONENTS.map((one) => one.id))

  for (const one of OPPONENTS) {
    assert.ok(one.name.trim().length > 0, `${one.id} has no name`)
    assert.ok(one.style.trim().length > 10, `${one.id} does not say how it plays`)
    assert.ok(one.strength.trim().length > 10, `${one.id} does not say how strong it is`)
    assert.ok(['none', 'nudge', 'idea', 'best'].includes(one.help), `${one.id} starts on a help level that does not exist`)
  }
  assert.ok(isOpponentId(OPPONENTS[0].id))
  assert.equal(isOpponentId('martin'), false)
  assert.equal(isOpponentId(7), false)
  // An unknown id lands on something playable rather than on undefined.
  assert.equal(opponent('nobody' as OpponentId).id, OPPONENTS[0].id)
})

test('the ladder really gets harder: the dial goes up and so does the thinking time', () => {
  let lastSkill = -1
  let lastThink = -1
  for (const one of OPPONENTS) {
    const think = one.settings.think.movetime ?? 0
    assert.ok(think > lastThink, `${one.id} does not think longer than the rung below it`)
    lastThink = think
    const skill = one.settings.skill
    if (skill === undefined) {
      // Only the top of the list holds nothing back, and it is the top of the list.
      assert.equal(one.rung, OPPONENTS.length, `${one.id} holds nothing back but is not the hardest`)
      continue
    }
    assert.ok(skill > lastSkill, `${one.id}'s dial is not above the rung below it`)
    lastSkill = skill
  }
  // Exactly one opponent holds nothing back, so "full strength" means one thing.
  assert.equal(OPPONENTS.filter((one) => one.settings.skill === undefined).length, 1)
})

// ---------------------------------------------------------------- the settings are ones the engine will really take

test('every opponent’s settings are inside the ranges the main process really enforces', () => {
  // The settings screen's own copy of three of these has to agree with the handler, or one of them is wrong.
  assert.equal(ENGINE_RANGES.thinkMs.low, IPC_LIMITS.movetime.low)
  assert.equal(ENGINE_RANGES.thinkMs.high, IPC_LIMITS.movetime.high)
  assert.equal(ENGINE_RANGES.depth.low, IPC_LIMITS.depth.low)
  assert.equal(ENGINE_RANGES.depth.high, IPC_LIMITS.depth.high)
  assert.equal(ENGINE_RANGES.lines.low, IPC_LIMITS.multipv.low)
  assert.equal(ENGINE_RANGES.lines.high, IPC_LIMITS.multipv.high)
  assert.deepEqual({ low: SKILL_RANGE.low, high: SKILL_RANGE.high }, { low: IPC_LIMITS.skill.low, high: IPC_LIMITS.skill.high })

  for (const one of OPPONENTS) {
    const think = one.settings.think
    assert.ok(
      think.movetime !== undefined || think.depth !== undefined || think.nodes !== undefined,
      `${one.id} has no search limit at all, so a search for it would run until something stopped it`
    )
    if (think.movetime !== undefined) {
      assert.ok(think.movetime >= IPC_LIMITS.movetime.low, `${one.id}'s thinking time would be raised by the handler`)
      assert.ok(think.movetime <= IPC_LIMITS.movetime.high, `${one.id}'s thinking time would be cut by the handler`)
      assert.equal(Math.round(think.movetime), think.movetime, `${one.id}'s thinking time would be rounded by the handler`)
    }
    if (think.depth !== undefined) {
      assert.ok(think.depth >= IPC_LIMITS.depth.low && think.depth <= IPC_LIMITS.depth.high, `${one.id}'s depth is outside what the handler allows`)
    }
    if (think.nodes !== undefined) {
      assert.ok(think.nodes >= IPC_LIMITS.nodes.low && think.nodes <= IPC_LIMITS.nodes.high, `${one.id}'s node limit is outside what the handler allows`)
    }
    assert.ok(one.settings.lines >= IPC_LIMITS.multipv.low && one.settings.lines <= IPC_LIMITS.multipv.high, `${one.id} asks for a number of lines the handler would change`)
    if (one.settings.skill !== undefined) {
      assert.ok(one.settings.skill >= IPC_LIMITS.skill.low, `${one.id}'s dial is below what the handler allows`)
      assert.ok(one.settings.skill <= IPC_LIMITS.skill.high, `${one.id}'s dial is above what the handler allows`)
      assert.equal(Math.round(one.settings.skill), one.settings.skill, `${one.id}'s dial would be rounded by the handler`)
    }
    assert.equal(one.settings.looseness, 0, `${one.id} is weakened twice over: see the note at the top of opponents.ts`)
    assert.equal(one.settings.spread, 1, `${one.id} would choose among the engine's lines, which this list does not do`)
  }
})

test('two different opponents really are two different settings', () => {
  const seen = new Map<string, OpponentId>()
  for (const one of OPPONENTS) {
    const fingerprint = JSON.stringify([one.settings.skill ?? 'full', one.settings.think, one.settings.lines])
    const already = seen.get(fingerprint)
    assert.equal(already, undefined, `${one.id} and ${already} are the same settings under two names`)
    seen.set(fingerprint, one.id)
  }
  // Named outright, because "the list has nine entries" is the easy half and "the engine is asked nine different
  // things" is the half that goes wrong.
  const gentlest = opponent(OPPONENTS[0].id)
  const hardest = opponent(OPPONENTS[OPPONENTS.length - 1].id)
  assert.notDeepEqual(gentlest.settings, hardest.settings)
  assert.notEqual(levelForOpponent(gentlest).skillLevel, levelForOpponent(hardest).skillLevel)
  assert.notEqual(levelForOpponent(gentlest).think.movetime, levelForOpponent(hardest).think.movetime)
})

// ---------------------------------------------------------------- no rating is claimed anywhere

test('nothing claims a rating, because none has been measured', () => {
  const everything: string[] = [RATING_NOTE, STYLE_NOTE, LADDER_NOTE]
  for (const one of OPPONENTS) {
    const said = opponentLines(one)
    everything.push(one.name, one.style, one.strength, one.tier, said.setting, describeOpponent(one), levelForOpponent(one).about)
  }
  for (const text of everything) {
    assert.ok(!/\belo\b/i.test(text), `an Elo is claimed: ${text}`)
    assert.ok(!/\brated\b|\brating\b|\bratings\b/i.test(text) || /no rating|never played a rated|has no rating|not got/i.test(text), `a rating is claimed: ${text}`)
    // A four-digit number beside an opponent reads as a rating whatever the surrounding words say. The only numbers
    // allowed near an opponent are the dial (0-20) and a thinking time in milliseconds, which carries its unit.
    assert.ok(!/\b[1-3]\d{3}\b(?!\s*ms)/.test(text), `a number that reads as a rating: ${text}`)
  }
  // And the data has no field one could be put in.
  for (const one of OPPONENTS) {
    assert.equal(Object.prototype.hasOwnProperty.call(one, 'rating'), false, `${one.id} has a rating field`)
    assert.equal(Object.prototype.hasOwnProperty.call(one, 'elo'), false, `${one.id} has an Elo field`)
  }
  assert.match(RATING_NOTE, /no number/i)
  assert.match(STYLE_NOTE, /same engine/i)
  // The descriptions are of the settings. No run of games has been played to check any of them, and the note says
  // so rather than letting a confident sentence read as a measurement.
  assert.match(STYLE_NOTE, /not as a measurement/i)
  assert.match(LADDER_NOTE, /not a beginner/i)
})

test('an opponent describes itself out of its own settings, not out of a sentence somebody typed', () => {
  for (const one of OPPONENTS) {
    const said = describeOpponent(one)
    if (one.settings.skill === undefined) assert.match(said, /not turned down at all/i)
    else assert.match(said, new RegExp(`set to ${one.settings.skill} out of ${SKILL_RANGE.high}`))
    if (one.settings.think.movetime) assert.match(said, new RegExp(`${one.settings.think.movetime} ms`))
  }
})

// ---------------------------------------------------------------- whether the handicap reaches the engine

test('whether the dial really reaches the engine is answered, not assumed', () => {
  const gentle = OPPONENTS.find((one) => one.settings.skill !== undefined)
  assert.ok(gentle)
  const full = OPPONENTS.find((one) => one.settings.skill === undefined)
  assert.ok(full)

  // Nothing asked at all yet is not the same answer as "the engine has not got one".
  const unknown = handicapReach(gentle, [])
  assert.equal(unknown.kind, 'unknown')
  assert.match(unknown.says, /has not asked the engine/i)

  const applies = handicapReach(gentle, [stockfishDial, { name: 'Hash', type: 'spin', min: 1, max: 1024 }])
  assert.equal(applies.kind, 'applies')
  assert.equal(applies.kind === 'applies' ? applies.value : -1, gentle.settings.skill)

  // An engine with no dial: the opponent is only its thinking time, and that is said rather than hidden.
  const missing = handicapReach(gentle, [{ name: 'Hash', type: 'spin' }])
  assert.equal(missing.kind, 'not-offered')
  assert.match(missing.says, /only be the thinking time/i)
  assert.match(missing.says, /harder than the list says/i)

  // An option by the right name of the wrong kind is not the dial.
  assert.equal(handicapReach(gentle, [{ name: SKILL_OPTION, type: 'string' }]).kind, 'not-offered')

  // A narrower range than the list assumes lands somewhere else, and says where.
  const narrow = handicapReach(gentle, [{ name: SKILL_OPTION, type: 'spin', min: 5, max: 10 }])
  assert.equal(narrow.kind, 'clamped')
  assert.equal(narrow.kind === 'clamped' ? narrow.value : -1, 5)
  assert.equal(narrow.kind === 'clamped' ? narrow.wanted : -1, gentle.settings.skill)
  assert.match(narrow.says, /only goes from 5 to 10/)

  // A range that makes no sense is refused rather than clamped into nonsense.
  assert.equal(handicapReach(gentle, [{ name: SKILL_OPTION, type: 'spin', min: 11, max: 2 }]).kind, 'not-offered')

  // The one that holds nothing back has nothing to set, on any engine.
  assert.equal(handicapReach(full, [stockfishDial]).kind, 'nothing-to-apply')
  assert.equal(handicapReach(full, []).kind, 'nothing-to-apply')
})

// ---------------------------------------------------------------- a game against one of them

test('a game against a named opponent asks the engine for that opponent’s own settings', () => {
  for (const one of OPPONENTS) {
    const setup = setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, one)
    assert.equal(setup.opponent, one.id)
    assert.equal(setup.assistance, one.help)
    assert.deepEqual(setupProblems(setup), [])

    const state = startArena(setup, { now: 1000 })
    assert.equal(state.opponent?.id, one.id)
    assert.equal(state.level.id, one.id)
    assert.equal(state.level.name, one.name)

    const moved = playMove(state, 'e4', 'you', 1000)
    assert.ok(moved.ok)
    const request = engineTurnRequest(moved.state, 'r', 1000)
    assert.ok(request, `${one.id} was never asked`)
    assert.equal(request.fen, moved.state.fen)
    assert.equal(request.movetime, one.settings.think.movetime)
    assert.equal(request.multipv, one.settings.lines)
    assert.equal(request.skill, one.settings.skill, `${one.id}'s dial did not reach the request`)
  }
})

test('a hint is always the engine at full strength, whoever you are playing', () => {
  const gentle = OPPONENTS[0]
  const setup = setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED, assistance: 'best' }, gentle)
  const state = startArena({ ...setup, assistance: 'best' }, { now: 1000 })
  const request = hintRequest(state, 'h1')
  assert.ok(request)
  // No dial on a hint. A hint from an engine turned down to play you gently is advice you cannot see is bad.
  assert.equal(request.skill, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'skill'), false)
})

test('an unknown opponent is refused rather than quietly becoming a different one', () => {
  const problems = setupProblems({ ...STANDARD_SETUP, opponent: 'nobody' as OpponentId })
  assert.equal(problems.length, 1)
  assert.equal(problems[0].field, 'opponent')
  assert.match(problems[0].reason, /not an opponent/i)
  // The older five-level setting still works on its own, and no opponent means no opponent.
  const plain = startArena(STANDARD_SETUP, { now: 0 })
  assert.equal(plain.opponent, null)
  assert.equal(plain.level.id, STANDARD_SETUP.difficulty)
})

// ---------------------------------------------------------------- taking a move back

test('taking a move back undoes the engine’s reply as well, and leaves it your turn', () => {
  const state = startArena(setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, OPPONENTS[0]), { now: 1000 })
  const yours = playMove(state, 'e4', 'you', 2000)
  assert.ok(yours.ok)
  const theirs = playMove(yours.state, 'e5', 'engine', 3000)
  assert.ok(theirs.ok)
  assert.equal(theirs.state.moves.length, 2)

  const back = takeBack(theirs.state, 4000)
  assert.ok(back.ok)
  assert.equal(back.state.moves.length, 0)
  assert.equal(back.state.history.length, 0)
  assert.equal(back.state.fen, state.startFen)
  assert.equal(turnOf(back.state), back.state.human)
  assert.deepEqual(back.undone.map((one) => one.san), ['e4', 'e5'])
  assert.equal(back.state.takenBack, 2)
  // The engine has to be askable again for the position that is now in front of it.
  assert.equal(back.state.askedAtPly, null)
  assert.ok(engineTurnRequest(back.state, 'r', 4000) === null, 'it is your turn, so the engine must not be asked')
  // Said plainly, including the part people assume is wrong.
  assert.match(back.says, /e4 and e5 are taken back/)
  assert.match(back.says, /clock is not put back/i)
})

test('taking back your own move, before the engine has replied, undoes one move', () => {
  const state = startArena(setupForOpponent({ ...STANDARD_SETUP, control: timeControl(300, 2) }, OPPONENTS[0]), { now: 1000 })
  const yours = playMove(state, 'd4', 'you', 5000)
  assert.ok(yours.ok)
  assert.equal(turnOf(yours.state), yours.state.engine)

  const back = takeBack(yours.state, 6000)
  assert.ok(back.ok)
  assert.equal(back.state.moves.length, 0)
  assert.equal(back.state.takenBack, 1)
  assert.equal(turnOf(back.state), back.state.human)
  // Your clock is the one running again, so a resumed game charges the right person.
  assert.equal(back.state.clock.ticking, back.state.human)
  // And the time really spent is still spent: nothing here hands anybody their seconds back.
  assert.ok(back.state.clock.spent[back.state.human] >= 4000, 'the clock was rewound')
})

test('there is nothing to take back before you have moved, or after the game is over', () => {
  const state = startArena(setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, OPPONENTS[0]), { now: 1000 })
  const nothing = takeBack(state, 2000)
  assert.equal(nothing.ok, false)
  assert.match(nothing.ok ? '' : nothing.problem, /Nothing has been played/i)

  // Playing black: the engine moves first, and that move is not yours to take back.
  const asBlack = startArena({ ...setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, OPPONENTS[0]), side: 'b' }, { now: 1000 })
  const first = playMove(asBlack, 'e4', 'engine', 2000)
  assert.ok(first.ok)
  const theirsOnly = takeBack(first.state, 3000)
  assert.equal(theirsOnly.ok, false)
  assert.match(theirsOnly.ok ? '' : theirsOnly.problem, /not made a move yet/i)

  const played = playMove(state, 'e4', 'you', 2000)
  assert.ok(played.ok)
  const over = resign(played.state, 'you', 3000)
  assert.ok(over.ok)
  const afterwards = takeBack(over.state, 4000)
  assert.equal(afterwards.ok, false)
  assert.match(afterwards.ok ? '' : afterwards.problem, /game is over/i)
})

test('a search still running when a move is taken back is named so it can be stopped', () => {
  const state = startArena(setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, OPPONENTS[0]), { now: 1000 })
  const yours = playMove(state, 'e4', 'you', 2000)
  assert.ok(yours.ok)
  const request = engineTurnRequest(yours.state, 'r-7', 2000)
  assert.ok(request)
  const thinking = engineAsked(yours.state, request, 2000)

  const back = takeBack(thinking, 3000)
  assert.ok(back.ok)
  assert.equal(back.stopSearch, 'r-7')
  assert.equal(back.state.thinking, null)
})

// ---------------------------------------------------------------- the end of the game

test('the summary and the record both say what help was used, including moves taken back', () => {
  const state = startArena(setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, OPPONENTS[0]), { now: 1000 })
  const yours = playMove(state, 'e4', 'you', 2000)
  assert.ok(yours.ok)
  const back = takeBack(yours.state, 3000)
  assert.ok(back.ok)
  const again = playMove(back.state, 'd4', 'you', 4000)
  assert.ok(again.ok)
  const over = resign(again.state, 'engine', 5000)
  assert.ok(over.ok)

  const summary = summaryOf(over.state, { now: 5000 })
  assert.ok(summary)
  assert.equal(summary.takenBack, 1)
  assert.equal(summary.assisted, true, 'a game with a move taken back is not a clean win and must say so')
  assert.match(summary.assistanceLine, /1 move taken back/)
  assert.equal(summary.opponent?.id, OPPONENTS[0].id)
  assert.equal(summary.level.id, OPPONENTS[0].id)

  // A game with nothing taken back says that too, rather than saying nothing.
  const clean = resign(playMove(state, 'e4', 'you', 2000).state, 'engine', 3000)
  assert.ok(clean.ok)
  assert.match(summaryOf(clean.state, { now: 3000 })?.assistanceLine ?? '', /No hints, and nothing taken back/i)
  assert.equal(summaryOf(clean.state, { now: 3000 })?.takenBack, 0)
})

test('a review can only be asked for once the game is over, and it carries what help was used', () => {
  const state = startArena(setupForOpponent({ ...STANDARD_SETUP, control: UNTIMED }, OPPONENTS[1]), { now: 1000 })
  assert.equal(reviewAsk(state), null, 'there is nothing to review while the game is still being played')

  const yours = playMove(state, 'e4', 'you', 2000)
  assert.ok(yours.ok)
  const back = takeBack(yours.state, 2500)
  assert.ok(back.ok)
  const again = playMove(back.state, 'e4', 'you', 3000)
  assert.ok(again.ok)
  const over = resign(again.state, 'you', 4000)
  assert.ok(over.ok)

  const ask = reviewAsk(over.state)
  assert.ok(ask)
  assert.equal(ask.startFen, state.startFen)
  assert.deepEqual(ask.moves.map((one) => one.san), ['e4'])
  assert.equal(ask.human, over.state.human)
  assert.equal(ask.engine, over.state.engine)
  assert.equal(ask.result, '0-1')
  assert.equal(ask.reason, 'resignation')
  assert.equal(ask.opponent?.id, OPPONENTS[1].id)
  assert.equal(ask.help.takenBack, 1)
  assert.equal(ask.help.hintsTaken, 0)
  assert.match(ask.help.says, /taken back/)
  // The moves handed over are a copy: a reviewer cannot reach back into the game and change it.
  ask.moves[0].san = 'nonsense'
  assert.equal(over.state.moves[0].san, 'e4')
})

// ---------------------------------------------------------------- the level it becomes

test('an opponent becomes a level the session already knows how to drive', () => {
  for (const one of OPPONENTS) {
    const level = levelForOpponent(one)
    assert.equal(level.id, one.id)
    assert.equal(level.name, one.name)
    assert.deepEqual(level.think, one.settings.think)
    assert.equal(level.lines, one.settings.lines)
    assert.equal(level.looseness, 0)
    assert.equal(level.spread, 1)
    assert.equal(level.skillLevel, one.settings.skill)
    assert.ok(level.about.includes(one.strength))
    // The level is a copy, so a game cannot edit the list everybody else reads.
    const copy: Opponent = one
    assert.notEqual(level.think, copy.settings.think)
  }
})
