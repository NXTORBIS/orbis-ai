import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVITIES, ACTIVITY_KINDS, ACTIVITY_OF_EXERCISE, CANNOT_SAY, EVIDENCE, KIND_ORDER, PHASE_RULE, WEAK_AT,
  activePlan, addPlanItem, dismissPlanItem, dismissedPlan, mergePlan, movePlanItem, phaseOf, planTitle,
  removePlanItem, renamePlanItem, reorderPlan, resetPlanTitle, restorePlanItem, suggestPlan, weaknessProfile,
  type AnalysedGame, type AnalysedMove, type CoachEvidence, type OpeningRecallRecord, type StudyPlan,
  type PlanItem, type TrainingRecord, type Weakness
} from './coach.ts'
import { START_FEN } from './rules.ts'
import type { MoveClass, Side } from './evaluation.ts'
import type { ReviewCard } from './spaced.ts'

/**
 * The coach says what the record shows, or it says it cannot tell yet.
 *
 * Half of these tests are about the second half of that sentence: the cases where there is some evidence, but not
 * enough, and the right answer is a refusal naming the shortfall rather than a conclusion drawn from four moves. A
 * coach that produces a confident profile from one game is worse than no coach, because it reads exactly the same.
 */

// ---------------------------------------------------------------- positions, and how they are filed

const MIDDLEGAME = 'r1bq1r1k/pp2nppp/2n1p3/3pP3/1b1P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 20'
const ENDGAME = '8/8/4k3/8/8/4K3/8/R6r w - - 0 40'
const OPENING = 'rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq - 0 4'

describe('the phases of a game', () => {
  test('a position is filed by the material left, then by the move number', () => {
    assert.equal(phaseOf(START_FEN), 'opening')
    assert.equal(phaseOf(OPENING), 'opening')
    assert.equal(phaseOf(MIDDLEGAME), 'middlegame')
    assert.equal(phaseOf(ENDGAME), 'endgame')
    // A king-and-pawn position is an endgame on move 40 and on move 2: material decides first.
    assert.equal(phaseOf('8/8/4k3/8/4P3/4K3/8/8 w - - 0 2'), 'endgame')
  })

  test('a position that cannot be read is not filed anywhere', () => {
    assert.equal(phaseOf('nonsense'), null)
    assert.equal(phaseOf(''), null)
  })

  test('the boundaries are written down, including that they are a convention', () => {
    assert.match(PHASE_RULE, /1,300 centipawns/)
    assert.match(PHASE_RULE, /move 12/)
    assert.match(PHASE_RULE, /convention Orbis chose, not a rule of chess/)
  })
})

// ---------------------------------------------------------------- building evidence

function moves(o: { n: number; before: string; side: Side; klass: MoveClass; secondsLeft?: number; from?: number }): AnalysedMove[] {
  const out: AnalysedMove[] = []
  for (let i = 0; i < o.n; i++) {
    out.push({
      ply: (o.from ?? 0) + i,
      side: o.side,
      san: 'Nf3',
      before: o.before,
      klass: o.klass,
      loss: o.klass === 'blunder' ? 400 : o.klass === 'mistake' ? 300 : 0,
      ...(o.secondsLeft === undefined ? {} : { secondsLeft: o.secondsLeft })
    })
  }
  return out
}

const game = (o: { id?: string; you?: Side | null; depth?: number; at?: number; moves: AnalysedMove[] }): AnalysedGame => ({
  gameId: o.id ?? 'g1',
  you: o.you === undefined ? 'w' : o.you,
  analysedAt: o.at ?? 1_000,
  depth: o.depth ?? 20,
  moves: o.moves
})

/** Three games, so the "enough games" threshold is met, carrying the moves handed in. */
function threeGames(all: AnalysedMove[], depth = 20): AnalysedGame[] {
  const third = Math.ceil(all.length / 3)
  return [0, 1, 2].map((i) => game({ id: `g${i}`, depth, moves: all.slice(i * third, (i + 1) * third) }))
}

const card = (o: { id: string; themes: string[]; attempts: number; solved: number; due?: boolean }): ReviewCard => ({
  exerciseId: o.id,
  themes: o.themes,
  scheduler: 'sm2',
  state: { interval: 1 },
  dueAt: o.due ? 0 : 10_000_000_000_000,
  lastAt: 1,
  attempts: o.attempts,
  solved: o.solved,
  reviews: o.solved,
  lapses: o.attempts - o.solved,
  wrongRun: 0,
  fresh: false
})

const attempt = (o: { id?: string; solved: boolean; worth?: number; seconds?: number; wrong?: number; hints?: number }): TrainingRecord => ({
  kind: 'puzzle',
  themes: [],
  performance: {
    exerciseId: o.id ?? 'e1',
    solved: o.solved,
    gaveUp: false,
    hintsUsed: o.hints ?? 0,
    worth: o.worth ?? 1,
    wrongMoves: o.wrong ?? 0,
    illegalTries: 0,
    seconds: o.seconds ?? 30,
    at: 1_000
  }
})

const byId = (profile: { weaknesses: readonly Weakness[] }, id: string): Weakness | undefined =>
  profile.weaknesses.find((one) => one.id === id)

const refusalAbout = (profile: { refusals: readonly { about: string; says: string; have: number; need: number }[] }, text: string) =>
  profile.refusals.find((one) => one.about.includes(text) || one.says.includes(text))

const NOW = 2_000_000

// ---------------------------------------------------------------- nothing to go on

describe('with nothing recorded', () => {
  test('it says so, names nothing, and does not fill the silence with a weakness', () => {
    const profile = weaknessProfile({}, NOW)
    assert.deepEqual(profile.weaknesses, [])
    assert.ok(profile.silent)
    assert.match(profile.says, /Nothing has been recorded yet/)
    assert.equal(profile.counted.games, 0)
    assert.equal(profile.counted.judgedMoves, 0)
  })

  test('each thing it cannot answer is listed with what is missing', () => {
    const profile = weaknessProfile({}, NOW)
    assert.ok(profile.refusals.length >= 4, `only ${profile.refusals.length} refusals`)
    for (const refusal of profile.refusals) {
      assert.ok(refusal.says.length > 20, refusal.about)
      assert.ok(refusal.need > 0, `${refusal.about} needs nothing, so it is not a threshold`)
      assert.ok(refusal.have <= refusal.need, refusal.about)
    }
    assert.ok(refusalAbout(profile, 'how your own games go'))
    assert.ok(refusalAbout(profile, 'how well you know your openings'))
  })

  test('it says out loud that it is not a rating and not about how you think', () => {
    const profile = weaknessProfile({}, NOW)
    assert.deepEqual(profile.cannotSay, CANNOT_SAY)
    assert.ok(profile.cannotSay.some((one) => /rating/.test(one)))
    assert.ok(profile.cannotSay.some((one) => /how you think/.test(one)))
    assert.ok(profile.cannotSay.some((one) => /Absence here is not evidence of strength/.test(one)))
  })
})

describe('not enough games yet to tell', () => {
  test('two deep games is not three, and the refusal counts them', () => {
    const played = moves({ n: 40, before: MIDDLEGAME, side: 'w', klass: 'blunder' })
    const profile = weaknessProfile({ games: [game({ id: 'a', moves: played }), game({ id: 'b', moves: played })] }, NOW)
    assert.deepEqual(profile.weaknesses, [])
    const refusal = refusalAbout(profile, 'how your own games go')
    assert.ok(refusal)
    assert.match(refusal.says, /Not enough games yet to tell: 2 of the 3 needed/)
    assert.equal(refusal.have, 2)
    assert.equal(refusal.need, EVIDENCE.games)
  })

  test('a shallow analysis is not evidence about a player, however many games there are', () => {
    const played = moves({ n: 60, before: MIDDLEGAME, side: 'w', klass: 'blunder' })
    const games = [0, 1, 2, 3, 4].map((i) => game({ id: `s${i}`, depth: 6, moves: played }))
    const profile = weaknessProfile({ games }, NOW)
    assert.deepEqual(profile.weaknesses, [])
    assert.equal(profile.counted.games, 0)
    const refusal = refusalAbout(profile, 'analysed')
    assert.ok(refusal)
    assert.match(refusal.says, new RegExp(`shallower than depth ${EVIDENCE.minDepth}`))
  })

  test('a game that does not say which side you played is attributed to nobody', () => {
    const played = moves({ n: 60, before: MIDDLEGAME, side: 'w', klass: 'blunder' })
    const games = [0, 1, 2, 3].map((i) => game({ id: `n${i}`, you: null, moves: played }))
    const profile = weaknessProfile({ games }, NOW)
    assert.deepEqual(profile.weaknesses, [])
    assert.equal(profile.counted.judgedMoves, 0)
    assert.ok(refusalAbout(profile, 'say nothing about you'))
  })

  test('enough games but too few judged moves is still a refusal, not a rate', () => {
    const played = moves({ n: 5, before: MIDDLEGAME, side: 'w', klass: 'blunder' })
    const games = [0, 1, 2].map((i) => game({ id: `f${i}`, moves: played }))
    const profile = weaknessProfile({ games }, NOW)
    assert.equal(byId(profile, 'serious-errors'), undefined)
    const refusal = refusalAbout(profile, 'how often your moves go seriously wrong')
    assert.ok(refusal)
    assert.equal(refusal.have, 15)
    assert.equal(refusal.need, EVIDENCE.judgedMoves)
  })

  test('moves the engine could not judge are counted apart and never treated as mistakes', () => {
    const judged = moves({ n: 70, before: MIDDLEGAME, side: 'w', klass: 'good' })
    const unclear = moves({ n: 40, before: MIDDLEGAME, side: 'w', klass: 'unclear', from: 100 })
    const profile = weaknessProfile({ games: threeGames([...judged, ...unclear]) }, NOW)
    assert.equal(profile.counted.judgedMoves, 70)
    assert.equal(profile.counted.unjudgedMoves, 40)
    assert.equal(byId(profile, 'serious-errors'), undefined)
  })
})

// ---------------------------------------------------------------- what it does say

describe('what the analysed games show', () => {
  test('an overall error rate above the threshold is named, with both of its numbers in the words', () => {
    const bad = moves({ n: 12, before: MIDDLEGAME, side: 'w', klass: 'blunder' })
    const fine = moves({ n: 68, before: MIDDLEGAME, side: 'w', klass: 'good', from: 100 })
    const profile = weaknessProfile({ games: threeGames([...bad, ...fine]) }, NOW)
    const weakness = byId(profile, 'serious-errors')
    assert.ok(weakness)
    assert.equal(weakness.evidence[0].hits, 12)
    assert.equal(weakness.evidence[0].of, 80)
    assert.match(weakness.because, /12 of 80 \(15 per cent\)/)
    assert.ok(weakness.rate >= WEAK_AT.seriousShare)
    assert.equal(weakness.activity, 'analyse-game')
  })

  test('a rate under the threshold is not named at all', () => {
    const bad = moves({ n: 4, before: MIDDLEGAME, side: 'w', klass: 'mistake' })
    const fine = moves({ n: 76, before: MIDDLEGAME, side: 'w', klass: 'best', from: 100 })
    const profile = weaknessProfile({ games: threeGames([...bad, ...fine]) }, NOW)
    assert.equal(byId(profile, 'serious-errors'), undefined)
  })

  test('a phase is named only against your own other phases, and the words give both rates', () => {
    const endBad = moves({ n: 8, before: ENDGAME, side: 'w', klass: 'blunder' })
    const endFine = moves({ n: 32, before: ENDGAME, side: 'w', klass: 'good', from: 50 })
    const midBad = moves({ n: 1, before: MIDDLEGAME, side: 'w', klass: 'mistake', from: 200 })
    const midFine = moves({ n: 59, before: MIDDLEGAME, side: 'w', klass: 'best', from: 300 })
    const profile = weaknessProfile({ games: threeGames([...endBad, ...endFine, ...midBad, ...midFine]) }, NOW)
    const weakness = byId(profile, 'phase-endgame')
    assert.ok(weakness)
    assert.match(weakness.because, /8 of 40 \(20 per cent\)/)
    assert.match(weakness.because, /1 of 60 \(2 per cent\)/)
    assert.equal(weakness.evidence.length, 2)
    assert.equal(weakness.activity, 'endgame')
    // The quiet phase is not reported as a weakness just because the other one is.
    assert.equal(byId(profile, 'phase-middlegame'), undefined)
    // And nine per cent overall is under the absolute threshold, so that is not claimed either.
    assert.equal(byId(profile, 'serious-errors'), undefined)
  })

  test('a phase with enough moves and nothing to compare it with is refused, not reported', () => {
    const only = moves({ n: 70, before: ENDGAME, side: 'w', klass: 'blunder' })
    const profile = weaknessProfile({ games: threeGames(only) }, NOW)
    assert.equal(byId(profile, 'phase-endgame'), undefined)
    const refusal = refusalAbout(profile, 'whether the endgame is worse than the rest of your game')
    assert.ok(refusal)
    assert.equal(refusal.have, 0)
    assert.equal(refusal.need, EVIDENCE.phaseMoves)
    // And the phases with nothing in them say they have nothing, with the shortfall.
    const opening = refusalAbout(profile, 'how you play the opening')
    assert.ok(opening)
    assert.match(opening.says, /none of your analysed moves were played there/)
  })

  test('only your own moves are counted, never the opponent\'s', () => {
    const mine = moves({ n: 70, before: MIDDLEGAME, side: 'w', klass: 'best' })
    const theirs = moves({ n: 70, before: MIDDLEGAME, side: 'b', klass: 'blunder', from: 500 })
    const profile = weaknessProfile({ games: threeGames([...mine, ...theirs]) }, NOW)
    assert.equal(profile.counted.judgedMoves, 70)
    assert.equal(byId(profile, 'serious-errors'), undefined)
  })

  test('forced mates that went by are counted as that, not as a number of pawns', () => {
    const missed = moves({ n: 4, before: MIDDLEGAME, side: 'w', klass: 'missed-mate' })
    const fine = moves({ n: 76, before: MIDDLEGAME, side: 'w', klass: 'good', from: 100 })
    const profile = weaknessProfile({ games: threeGames([...missed, ...fine]) }, NOW)
    const weakness = byId(profile, 'missed-mates')
    assert.ok(weakness)
    assert.match(weakness.because, /4 times the engine had a forced mate/)
    assert.match(weakness.explain, /not scored as a number of pawns/)
    assert.equal(weakness.activity, 'puzzle')
  })

  test('two missed mates is under the threshold and nothing is said', () => {
    const missed = moves({ n: 2, before: MIDDLEGAME, side: 'w', klass: 'missed-mate' })
    const fine = moves({ n: 78, before: MIDDLEGAME, side: 'w', klass: 'good', from: 100 })
    const profile = weaknessProfile({ games: threeGames([...missed, ...fine]) }, NOW)
    assert.equal(byId(profile, 'missed-mates'), undefined)
  })
})

describe('the clock', () => {
  test('with no clock recorded anywhere, nothing is said about being short of time', () => {
    const played = moves({ n: 70, before: MIDDLEGAME, side: 'w', klass: 'blunder' })
    const profile = weaknessProfile({ games: threeGames(played) }, NOW)
    assert.equal(byId(profile, 'low-time'), undefined)
    const refusal = refusalAbout(profile, 'short of time')
    assert.ok(refusal)
    assert.match(refusal.says, /None of your games recorded a clock/)
  })

  test('a clock on only one side of the comparison is refused with both counts', () => {
    const low = moves({ n: 40, before: MIDDLEGAME, side: 'w', klass: 'blunder', secondsLeft: 5 })
    const high = moves({ n: 5, before: MIDDLEGAME, side: 'w', klass: 'good', secondsLeft: 300, from: 100 })
    const profile = weaknessProfile({ games: threeGames([...low, ...high]) }, NOW)
    assert.equal(byId(profile, 'low-time'), undefined)
    const refusal = refusalAbout(profile, 'short of time')
    assert.ok(refusal)
    assert.match(refusal.says, /40 played with under 30 seconds left and 5 with more/)
  })

  test('with a clock on both sides and a real gap, it says what happened and does not say why', () => {
    const lowBad = moves({ n: 10, before: MIDDLEGAME, side: 'w', klass: 'blunder', secondsLeft: 5 })
    const lowFine = moves({ n: 15, before: MIDDLEGAME, side: 'w', klass: 'good', secondsLeft: 9, from: 100 })
    const highBad = moves({ n: 2, before: MIDDLEGAME, side: 'w', klass: 'mistake', secondsLeft: 300, from: 200 })
    const highFine = moves({ n: 23, before: MIDDLEGAME, side: 'w', klass: 'best', secondsLeft: 400, from: 300 })
    const profile = weaknessProfile({ games: threeGames([...lowBad, ...lowFine, ...highBad, ...highFine]) }, NOW)
    const weakness = byId(profile, 'low-time')
    assert.ok(weakness)
    assert.match(weakness.because, /10 of 25 \(40 per cent\)/)
    assert.match(weakness.because, /2 of 25 \(8 per cent\)/)
    assert.match(weakness.explain, /it does not say why/)
    assert.equal(weakness.activity, 'play')
  })
})

describe('themes, which are asked of the review cards rather than worked out again', () => {
  test('a theme going badly over enough attempts is named with its counts', () => {
    const cards = [card({ id: 'x1', themes: ['fork'], attempts: 10, solved: 3, due: true })]
    const profile = weaknessProfile({ cards }, NOW)
    const weakness = byId(profile, 'theme-fork')
    assert.ok(weakness)
    assert.match(weakness.because, /3 of 10 \(30 per cent\)/)
    assert.match(weakness.because, /1 card is due now/)
    assert.equal(weakness.evidence[0].kind, 'review-attempt')
    assert.equal(weakness.evidence[0].hits, 7)
    assert.equal(profile.counted.reviewAttempts, 10)
  })

  test('a theme with too few attempts is refused by name, either way', () => {
    const cards = [card({ id: 'x1', themes: ['pin'], attempts: 3, solved: 0 })]
    const profile = weaknessProfile({ cards }, NOW)
    assert.equal(byId(profile, 'theme-pin'), undefined)
    const refusal = refusalAbout(profile, 'pin')
    assert.ok(refusal)
    assert.equal(refusal.need, EVIDENCE.themeAttempts)
  })

  test('a theme going well is not named', () => {
    const cards = [card({ id: 'x1', themes: ['back-rank'], attempts: 20, solved: 19 })]
    const profile = weaknessProfile({ cards }, NOW)
    assert.equal(byId(profile, 'theme-back-rank'), undefined)
  })
})

describe('habits in training, counted and not interpreted', () => {
  test('fourteen attempts is not fifteen', () => {
    const records = Array.from({ length: 14 }, (_, i) => attempt({ id: `e${i}`, solved: false, seconds: 1 }))
    const profile = weaknessProfile({ training: records }, NOW)
    assert.equal(byId(profile, 'quick-wrong'), undefined)
    const refusal = refusalAbout(profile, 'how you go about training')
    assert.ok(refusal)
    assert.equal(refusal.have, 14)
    assert.equal(refusal.need, EVIDENCE.trainingAttempts)
  })

  test('solves that needed the move shown are reported as that, with the hint ladder\'s own rule', () => {
    const shown = Array.from({ length: 8 }, (_, i) => attempt({ id: `s${i}`, solved: true, worth: 0 }))
    const clean = Array.from({ length: 12 }, (_, i) => attempt({ id: `c${i}`, solved: true, worth: 1 }))
    const profile = weaknessProfile({ training: [...shown, ...clean] }, NOW)
    const weakness = byId(profile, 'hint-dependence')
    assert.ok(weakness)
    assert.match(weakness.because, /8 of 20 \(40 per cent\)/)
    assert.match(weakness.explain, /practice, not recall/)
  })

  test('wrong answers given inside five seconds are a count and carry no reason', () => {
    const quick = Array.from({ length: 10 }, (_, i) => attempt({ id: `q${i}`, solved: false, seconds: 2 }))
    const slow = Array.from({ length: 10 }, (_, i) => attempt({ id: `w${i}`, solved: false, seconds: 90 }))
    const profile = weaknessProfile({ training: [...quick, ...slow] }, NOW)
    const weakness = byId(profile, 'quick-wrong')
    assert.ok(weakness)
    assert.match(weakness.label, /inside 5 seconds/)
    assert.match(weakness.because, /10 of 20 \(50 per cent\)/)
    assert.match(weakness.explain, /no reason is attached to it here/)
  })
})

describe('openings', () => {
  const line = (o: { name: string; complete: boolean; correct?: number; at?: number }): OpeningRecallRecord => ({
    name: o.name,
    side: 'w',
    correct: o.correct ?? (o.complete ? 10 : 4),
    length: 10,
    complete: o.complete,
    at: o.at ?? 1_000
  })

  test('one line drilled is not enough to say anything about your openings', () => {
    const profile = weaknessProfile({ openings: [line({ name: 'Catalan', complete: false })] }, NOW)
    assert.deepEqual(profile.weaknesses.filter((one) => one.kind === 'opening-recall'), [])
    const refusal = refusalAbout(profile, 'how well you know your openings')
    assert.ok(refusal)
    assert.equal(refusal.have, 1)
    assert.equal(refusal.need, EVIDENCE.openingLines)
  })

  test('a line that keeps breaking is named, with how far it got', () => {
    const records = [
      line({ name: 'Catalan', complete: false, correct: 4 }),
      line({ name: 'Catalan', complete: false, correct: 6 }),
      line({ name: 'Catalan', complete: true }),
      line({ name: 'London', complete: true }),
      line({ name: 'London', complete: true }),
      line({ name: 'London', complete: true })
    ]
    const profile = weaknessProfile({ openings: records }, NOW)
    const weakness = byId(profile, 'opening-Catalan')
    assert.ok(weakness)
    assert.match(weakness.because, /2 of 3 \(67 per cent\)/)
    assert.match(weakness.because, /between 4 and 6 moves/)
    assert.equal(weakness.activity, 'opening-drill')
    assert.equal(byId(profile, 'opening-London'), undefined)
    assert.equal(profile.counted.openingAttempts, 6)
  })

  test('a line with two attempts is refused by name even when both broke', () => {
    const records = [
      line({ name: 'Grunfeld', complete: false }),
      line({ name: 'Grunfeld', complete: false }),
      line({ name: 'Slav', complete: true }),
      line({ name: 'Slav', complete: true }),
      line({ name: 'Slav', complete: true })
    ]
    const profile = weaknessProfile({ openings: records }, NOW)
    assert.equal(byId(profile, 'opening-Grunfeld'), undefined)
    assert.ok(refusalAbout(profile, 'how well you know Grunfeld'))
  })
})

describe('every weakness is accountable', () => {
  const everything: CoachEvidence = {
    games: threeGames([
      ...moves({ n: 10, before: ENDGAME, side: 'w', klass: 'blunder', secondsLeft: 4 }),
      ...moves({ n: 20, before: ENDGAME, side: 'w', klass: 'good', secondsLeft: 8, from: 50 }),
      ...moves({ n: 4, before: MIDDLEGAME, side: 'w', klass: 'missed-mate', secondsLeft: 200, from: 100 }),
      ...moves({ n: 46, before: MIDDLEGAME, side: 'w', klass: 'best', secondsLeft: 400, from: 200 })
    ]),
    cards: [card({ id: 'c1', themes: ['fork'], attempts: 12, solved: 4 })],
    training: [
      ...Array.from({ length: 10 }, (_, i) => attempt({ id: `q${i}`, solved: false, seconds: 1 })),
      ...Array.from({ length: 10 }, (_, i) => attempt({ id: `g${i}`, solved: true, worth: 1 }))
    ],
    openings: [
      { name: 'Catalan', side: 'w', correct: 3, length: 9, complete: false, at: 10 },
      { name: 'Catalan', side: 'w', correct: 4, length: 9, complete: false, at: 20 },
      { name: 'Catalan', side: 'w', correct: 9, length: 9, complete: true, at: 30 },
      { name: 'London', side: 'w', correct: 9, length: 9, complete: true, at: 40 },
      { name: 'London', side: 'w', correct: 9, length: 9, complete: true, at: 50 },
      { name: 'London', side: 'w', correct: 9, length: 9, complete: true, at: 60 }
    ]
  }

  test('several kinds come out at once and each one carries its evidence', () => {
    const profile = weaknessProfile(everything, NOW)
    assert.ok(profile.weaknesses.length >= 4, `only ${profile.weaknesses.length}: ${profile.weaknesses.map((one) => one.id).join(', ')}`)
    assert.ok(!profile.silent)
    for (const weakness of profile.weaknesses) {
      assert.ok(weakness.evidence.length > 0, `${weakness.id} rests on nothing`)
      for (const observation of weakness.evidence) {
        assert.ok(observation.of > 0, `${weakness.id} divides by nought`)
        assert.ok(observation.hits <= observation.of, `${weakness.id} counts more hits than chances`)
        assert.ok(observation.says.length > 10, `${weakness.id} cannot explain its own observation`)
      }
      assert.ok(weakness.because.length > 20, `${weakness.id} does not say why`)
      assert.ok(weakness.explain.length > 20, `${weakness.id} does not explain itself`)
      assert.ok(weakness.rate > 0 && weakness.rate <= 1, `${weakness.id} has a rate of ${weakness.rate}`)
      assert.ok(ACTIVITY_KINDS.includes(weakness.activity), `${weakness.id} points at an activity that does not exist`)
    }
  })

  test('they come out in the written order, which is not an order of size', () => {
    const profile = weaknessProfile(everything, NOW)
    const places = profile.weaknesses.map((one) => KIND_ORDER.indexOf(one.kind))
    assert.deepEqual(places, [...places].sort((a, b) => a - b))
    assert.ok(places.every((one) => one >= 0))
  })

  test('the counts it looked at are reported, so the profile can be checked', () => {
    const profile = weaknessProfile(everything, NOW)
    assert.equal(profile.counted.games, 3)
    assert.equal(profile.counted.judgedMoves, 80)
    assert.equal(profile.counted.trainingAttempts, 20)
    assert.equal(profile.counted.openingAttempts, 6)
    assert.equal(profile.counted.reviewAttempts, 12)
    assert.equal(profile.at, NOW)
  })

  test('every exercise kind maps to an activity that exists', () => {
    for (const [kind, activity] of Object.entries(ACTIVITY_OF_EXERCISE)) {
      assert.ok(ACTIVITY_KINDS.includes(activity), `${kind} points at ${activity}`)
      assert.ok(ACTIVITIES[activity].label.length > 0)
      assert.ok(ACTIVITIES[activity].records.length > 0, `${activity} does not say what records it`)
    }
  })
})

// ---------------------------------------------------------------- the study plan

describe('the study plan', () => {
  const profileWith = (evidence: CoachEvidence): ReturnType<typeof weaknessProfile> => weaknessProfile(evidence, NOW)

  const twoWeaknesses = profileWith({
    cards: [
      card({ id: 'c1', themes: ['fork'], attempts: 12, solved: 3 }),
      card({ id: 'c2', themes: ['pin'], attempts: 12, solved: 5 })
    ]
  })

  test('a suggested plan has one line per weakness, in the profile\'s order, pointing at a real activity', () => {
    const plan = suggestPlan(twoWeaknesses, NOW)
    assert.equal(plan.items.length, twoWeaknesses.weaknesses.length)
    assert.deepEqual(plan.items.map((one) => one.order), [0, 1])
    for (const item of plan.items) {
      assert.equal(item.from, 'coach')
      assert.ok(ACTIVITY_KINDS.includes(item.activity))
      assert.ok(item.what.includes(ACTIVITIES[item.activity].records), item.what)
      assert.equal(item.dismissed, false)
    }
  })

  test('a dismissal sticks across a merge, even though the weakness is still there', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const put = dismissPlanItem(first, first.items[0].id, NOW + 1)
    assert.equal(activePlan(put).length, 1)
    const again = mergePlan(put, twoWeaknesses, NOW + 2)
    assert.equal(activePlan(again).length, 1, 'the dismissed line came back as a new suggestion')
    assert.equal(dismissedPlan(again).length, 1)
    assert.equal(dismissedPlan(again)[0].id, first.items[0].id)
  })

  test('a dismissal still sticks when the weakness goes away and comes back', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const put = dismissPlanItem(first, 'coach:theme-fork', NOW + 1)
    const gone = mergePlan(put, profileWith({}), NOW + 2)
    assert.equal(activePlan(gone).length, 0)
    assert.equal(dismissedPlan(gone).length, 1, 'the dismissal was forgotten when the evidence went')
    const back = mergePlan(gone, twoWeaknesses, NOW + 3)
    assert.deepEqual(activePlan(back).map((one) => one.id), ['coach:theme-pin'])
  })

  test('a coach line whose weakness is gone and was never dismissed is simply dropped', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const gone = mergePlan(first, profileWith({}), NOW + 1)
    assert.deepEqual(gone.items, [])
  })

  test('a merge keeps the wording up to date with the evidence', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const worse = profileWith({
      cards: [
        card({ id: 'c1', themes: ['fork'], attempts: 20, solved: 2 }),
        card({ id: 'c2', themes: ['pin'], attempts: 12, solved: 5 })
      ]
    })
    const merged = mergePlan(first, worse, NOW + 1)
    const fork = merged.items.find((one) => one.id === 'coach:theme-fork')
    assert.ok(fork)
    assert.match(fork.what, /2 of 20/)
    assert.equal(fork.addedAt, NOW, 'the line was treated as new rather than brought up to date')
  })

  test('the person\'s own lines and their order survive a merge, and a new suggestion goes on the end', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const mine = addPlanItem(first, { id: 'mine', title: 'Read the endgame book', activity: 'endgame' }, NOW + 1)
    const moved = reorderPlan(mine, ['mine', 'coach:theme-pin', 'coach:theme-fork'], NOW + 2)
    assert.deepEqual(activePlan(moved).map((one) => one.id), ['mine', 'coach:theme-pin', 'coach:theme-fork'])
    const bigger = profileWith({
      cards: [
        card({ id: 'c1', themes: ['fork'], attempts: 12, solved: 3 }),
        card({ id: 'c2', themes: ['pin'], attempts: 12, solved: 5 }),
        card({ id: 'c3', themes: ['skewer'], attempts: 12, solved: 2 })
      ]
    })
    const merged = mergePlan(moved, bigger, NOW + 3)
    assert.deepEqual(activePlan(merged).map((one) => one.id), ['mine', 'coach:theme-pin', 'coach:theme-fork', 'coach:theme-skewer'])
  })

  test('moving a line steps over the ones that are put aside rather than losing the press', () => {
    const plan: StudyPlan = {
      items: [
        { id: 'a', from: 'person', title: 'A', what: '', activity: 'puzzle', order: 0, dismissed: false, addedAt: 0 },
        { id: 'b', from: 'person', title: 'B', what: '', activity: 'puzzle', order: 1, dismissed: true, addedAt: 0 },
        { id: 'c', from: 'person', title: 'C', what: '', activity: 'puzzle', order: 2, dismissed: false, addedAt: 0 }
      ],
      updatedAt: 0
    }
    const moved = movePlanItem(plan, 'c', 'up', NOW)
    assert.deepEqual(activePlan(moved).map((one) => one.id), ['c', 'a'])
    assert.deepEqual(activePlan(movePlanItem(moved, 'c', 'up', NOW)).map((one) => one.id), ['c', 'a'], 'the top line moved off the top')
    assert.deepEqual(activePlan(movePlanItem(plan, 'a', 'down', NOW)).map((one) => one.id), ['c', 'a'])
    assert.equal(movePlanItem(plan, 'nope', 'up', NOW), plan)
  })

  test('a line put aside can be brought back where it was', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const put = dismissPlanItem(first, 'coach:theme-fork', NOW + 1)
    const back = restorePlanItem(put, 'coach:theme-fork', NOW + 2)
    assert.deepEqual(activePlan(back).map((one) => one.id), ['coach:theme-fork', 'coach:theme-pin'])
    assert.equal(restorePlanItem(back, 'coach:theme-fork', NOW + 3), back, 'restoring something already showing changed the plan')
  })

  test('any line can be renamed, and the coach\'s own wording and evidence are kept underneath', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const coachWording = first.items.find((one) => one.id === 'coach:theme-fork')?.title
    const coachEvidence = first.items.find((one) => one.id === 'coach:theme-fork')?.what
    const renamed = renamePlanItem(first, 'coach:theme-fork', 'Forks, every morning', NOW)
    const item = renamed.items.find((one) => one.id === 'coach:theme-fork')
    assert.ok(item)
    assert.equal(planTitle(item), 'Forks, every morning')
    assert.equal(item.title, coachWording, 'the coach\'s wording was written over')
    assert.equal(item.what, coachEvidence, 'the sentence giving the evidence was rewritten')
    assert.equal(renamePlanItem(first, 'nope', 'x', NOW), first)
    assert.equal(renamePlanItem(first, 'coach:theme-fork', '  ', NOW), first, 'an empty name was accepted')
  })

  test('the person\'s name for a coach line survives a merge, and can be dropped again', () => {
    const renamed = renamePlanItem(suggestPlan(twoWeaknesses, NOW), 'coach:theme-fork', 'My own words', NOW)
    const merged = mergePlan(renamed, twoWeaknesses, NOW + 1)
    const item = merged.items.find((one) => one.id === 'coach:theme-fork')
    assert.ok(item)
    assert.equal(planTitle(item), 'My own words')
    const back = resetPlanTitle(merged, 'coach:theme-fork', NOW + 2)
    const after = back.items.find((one) => one.id === 'coach:theme-fork')
    assert.ok(after)
    assert.equal(after.titleOverride, undefined)
    assert.equal(planTitle(after), item.title)
    assert.equal(resetPlanTitle(back, 'coach:theme-fork', NOW + 3), back, 'resetting a line with no override changed the plan')
  })

  test('only the person\'s own lines can be taken off; a coach line is put aside instead', () => {
    const first = suggestPlan(twoWeaknesses, NOW)
    const mine = addPlanItem(first, { id: 'mine', title: 'Mine', activity: 'play' }, NOW)
    assert.equal(planTitle(renamePlanItem(mine, 'mine', 'Renamed', NOW).items.find((one) => one.id === 'mine') as PlanItem), 'Renamed')
    const removedMine = removePlanItem(mine, 'mine', NOW)
    assert.equal(removedMine.items.some((one) => one.id === 'mine'), false)
    const removedCoach = removePlanItem(mine, 'coach:theme-fork', NOW)
    assert.equal(removedCoach.items.find((one) => one.id === 'coach:theme-fork')?.dismissed, true)
    assert.equal(resetPlanTitle(mine, 'mine', NOW), mine, 'a person\'s own line was handed back the coach\'s wording')
  })

  test('a line cannot be added twice under one name', () => {
    const plan = addPlanItem({ items: [], updatedAt: 0 }, { id: 'mine', title: 'Mine', activity: 'play' }, NOW)
    assert.equal(addPlanItem(plan, { id: 'mine', title: 'Again', activity: 'play' }, NOW).items.length, 1)
  })

  test('orders stay contiguous, so nothing can drift into a gap', () => {
    let plan: StudyPlan = { items: [], updatedAt: 0 }
    for (const id of ['a', 'b', 'c', 'd']) plan = addPlanItem(plan, { id, title: id, activity: 'puzzle' }, NOW)
    plan = removePlanItem(plan, 'b', NOW)
    assert.deepEqual(plan.items.map((one) => one.order), [0, 1, 2])
    plan = reorderPlan(plan, ['d'], NOW)
    assert.deepEqual(plan.items.map((one) => one.order).sort((x, y) => x - y), [0, 1, 2])
    assert.equal(activePlan(plan)[0].id, 'd')
  })
})
