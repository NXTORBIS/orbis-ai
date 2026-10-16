import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_FEN, applyMove, outcome } from './rules.ts'
import { classify, lossFrom, type Score, type Side } from './evaluation.ts'
import {
  CLAIM_EVIDENCE,
  COMMENTARY_STYLES,
  FORBIDDEN_WORDS,
  MIN_JUDGEMENT_DEPTH,
  PIECE_POINTS,
  allPhrasings,
  concrete,
  engineFactsOf,
  factsOf,
  materialOf,
  notable,
  remarkOn,
  speaksAbout,
  styleInfo,
  type CommentaryInput,
  type CommentaryStyle,
  type Judgement,
  type MoveContext
} from './commentary.ts'

/**
 * The guard on the commentary.
 *
 * What is being proved is not that the words read well. It is that a remark cannot say something its inputs do not
 * support. Three separate checks do that, and together they are the reason the phrasing table can be trusted:
 *
 *   1. No remark, in any style, about any move, contains a word from the forbidden list -- the words that name a
 *      tactic nothing in the module can see.
 *   2. Every claim a remark's words do make has the fact that establishes it in `remark.facts`.
 *   3. Every fact in `remark.facts` is independently true, re-derived here from `rules.ts` rather than taken from
 *      the module that produced it.
 */

/** Replays notation from a position, giving each move the context the commentary takes. */
function walk(sans: readonly string[], from = START_FEN): MoveContext[] {
  const out: MoveContext[] = []
  const history: string[] = []
  let fen = from
  for (const san of sans) {
    const played = applyMove(fen, san)
    assert.ok(played, `the test's own line is wrong at ${san}`)
    history.push(played.san)
    out.push({ before: fen, uci: played.uci, history: [...history], ply: out.length + 1 })
    fen = played.after
  }
  return out
}

/** Every real game used below. Between them they cover every fact the module can produce. */
const GAMES: Readonly<Record<string, { from: string; sans: readonly string[] }>> = Object.freeze({
  // Mate in four, with a capture on the last move.
  scholars: { from: START_FEN, sans: Object.freeze(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) },
  // Castling both ways, and a check.
  castles: { from: START_FEN, sans: Object.freeze(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Qf6', 'd3', 'd6', 'Bg5', 'Qg6', 'Nc3', 'Bg4', 'Nd5', 'Bxf3', 'Nxc7+']) },
  // En passant.
  enPassant: { from: START_FEN, sans: Object.freeze(['e4', 'Nf6', 'e5', 'd5', 'exd6']) },
  // The same position three times.
  repeat: { from: START_FEN, sans: Object.freeze(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) },
  // A pawn promoting, and then mate.
  promote: { from: '8/P7/8/8/8/8/5k2/K7 w - - 0 1', sans: Object.freeze(['a8=Q', 'Ke2', 'Qa2+']) },
  // Stalemate in one.
  stalemate: { from: '7k/8/5QK1/8/8/8/8/8 w - - 0 1', sans: Object.freeze(['Qf7']) },
  // Nothing left to mate with.
  bare: { from: '8/8/4k3/8/8/8/4PK2/8 w - - 0 1', sans: Object.freeze(['e4', 'Kd6', 'e5+', 'Kxe5']) }
})

const STYLES: readonly CommentaryStyle[] = Object.freeze(COMMENTARY_STYLES.map((one) => one.id))

/**
 * The rules' own answer about one move, worked out once.
 *
 * Replaying a game through the rules to see whether it ended is the expensive part of this file, and the guard
 * asks about the same move thousands of times.
 */
const BOARD = new Map<MoveContext, { played: NonNullable<ReturnType<typeof applyMove>>; after: ReturnType<typeof outcome> } | null>()
function boardFor(move: MoveContext): { played: NonNullable<ReturnType<typeof applyMove>>; after: ReturnType<typeof outcome> } | null {
  if (BOARD.has(move)) return BOARD.get(move) ?? null
  const played = applyMove(move.before, move.uci)
  const value = played ? { played, after: outcome(played.after, move.history ? [...move.history] : []) } : null
  BOARD.set(move, value)
  return value
}

/** Checks one fact key against the rules, with no help from the module that produced it. */
function factIsTrue(key: string, move: MoveContext, judgement?: Judgement): string | null {
  const board = boardFor(move)
  if (!board) return 'the move cannot be played at all'
  const { played, after } = board
  const [head, ...rest] = key.split(':')
  switch (head) {
    case 'piece':
      return played.piece === rest[0] ? null : `the piece was ${played.piece}, not ${rest[0]}`
    case 'mover':
      return played.color === rest[0] ? null : `the mover was ${played.color}`
    case 'capture':
      return played.captured === rest[0] ? null : `nothing of that kind was taken (took ${played.captured ?? 'nothing'})`
    case 'castle':
      return played.special === rest[0] ? null : 'that was not castling'
    case 'en-passant':
      return played.special === 'e' ? null : 'that was not en passant'
    case 'promotion':
      return played.promotion === rest[0] ? null : 'nothing promoted to that'
    case 'check':
      return played.check && !played.checkmate ? null : 'that move was not a plain check'
    case 'checkmate':
      return played.checkmate ? null : 'that move was not mate'
    case 'ended':
      if (rest.length === 0) return after.over ? null : 'the game did not end'
      return after.over && after.reason === rest[0] ? null : `the game did not end that way (${after.over ? after.reason : 'not over'})`
    case 'result':
      return after.over && after.result === rest.join(':') ? null : 'that was not the result'
    case 'san':
      return played.san === rest.join(':') ? null : 'that was not the notation'
    case 'material': {
      const points = materialOf(played.after)
      // Counted again here from the pieces, not taken from the module.
      let own = 0
      for (const square of [...played.after.split(' ')[0]]) {
        const letter = square.toLowerCase()
        if (!'pnbrqk'.includes(letter)) continue
        const value = PIECE_POINTS[letter as 'p' | 'n' | 'b' | 'r' | 'q' | 'k']
        own += square === letter ? -value : value
      }
      if (own !== points) return 'the module and the test disagree about the material'
      if (rest[0] === 'level') return points === 0 ? null : `material is ${points}, not level`
      const side = rest[0]
      const amount = Number(rest[1])
      if (side === 'w') return points === amount ? null : `White is ${points} ahead, not ${amount}`
      return points === -amount ? null : `Black is ${-points} ahead, not ${amount}`
    }
    case 'engine':
      if (!judgement) return 'there was no engine judgement at all'
      return null
    case 'engine-cp':
      if (!judgement) return 'there was no engine judgement at all'
      return judgement.after.kind === 'cp' ? null : 'the score after the move was not a centipawn score'
    case 'engine-mate':
      if (!judgement) return 'there was no engine judgement at all'
      return judgement.after.kind === 'mate' ? null : 'the score after the move was not a mate score'
    case 'engine-best':
      if (!judgement) return 'there was no engine judgement at all'
      return judgement.bestUci === played.uci ? null : 'that was not the engine’s own first choice'
    case 'class': {
      if (!judgement) return 'there was no engine judgement at all'
      const named = classify(judgement.before, judgement.after, played.color as Side, {
        depth: judgement.depth,
        minDepth: MIN_JUDGEMENT_DEPTH
      })
      return named === rest[0] ? null : `the engine's own numbers make that ${named}`
    }
    case 'loss': {
      if (!judgement) return 'there was no engine judgement at all'
      const loss = lossFrom(judgement.before, judgement.after, played.color as Side)
      return loss !== null && loss === Number(rest[0]) ? null : 'that is not the loss the two scores give'
    }
    case 'depth':
      if (!judgement) return 'there was no engine judgement at all'
      return (judgement.depth ?? 0) === Number(rest[0]) ? null : 'that was not the depth'
    default:
      return `nothing checks a fact called "${head}"`
  }
}

// ---------------------------------------------------------------- the styles themselves

test('every style is sound, and the cadence is odd so it does not comment on one colour for ever', () => {
  const ids = new Set(STYLES)
  assert.equal(ids.size, STYLES.length)
  for (const info of COMMENTARY_STYLES) {
    assert.ok(info.name.length > 0)
    assert.ok(info.about.length > 0)
    if (info.cadence > 1) assert.equal(info.cadence % 2, 1, `${info.id} has an even cadence, so it would only ever speak to one side`)
  }
  assert.equal(styleInfo('silent').cadence, 0)
  assert.equal(styleInfo('nonsense' as CommentaryStyle).id, 'silent', 'an unknown style must fall back to saying nothing')
})

test('the silent style says nothing about anything, ever', () => {
  for (const game of Object.values(GAMES)) {
    for (const move of walk(game.sans, game.from)) {
      for (const human of ['w', 'b'] as Side[]) {
        assert.equal(remarkOn({ move, human }, 'silent'), null)
        const judgement: Judgement = { before: { kind: 'cp', cp: 10 }, after: { kind: 'cp', cp: -900 }, depth: 20 }
        assert.equal(remarkOn({ move, human, judgement }, 'silent'), null)
      }
    }
  }
})

// ---------------------------------------------------------------- the facts

test('a move that cannot be played in the position it claims produces no remark at all', () => {
  const impossible: MoveContext = { before: START_FEN, uci: 'e2e5', ply: 1 }
  assert.equal(factsOf(impossible), null)
  for (const style of STYLES) assert.equal(remarkOn({ move: impossible, human: 'w' }, style), null, style)
})

test('the facts about a move are worked out from the rules, not taken on trust', () => {
  const [e4] = walk(['e4'])
  const facts = factsOf(e4)
  assert.ok(facts)
  assert.equal(facts.san, 'e4')
  assert.equal(facts.piece, 'p')
  assert.equal(facts.captured, null)
  assert.equal(facts.check, false)
  assert.equal(facts.material, 0)
  assert.ok(facts.keys.includes('piece:p'))
  assert.ok(facts.keys.includes('material:level'))

  const mate = walk(GAMES.scholars.sans).at(-1)
  assert.ok(mate)
  const mateFacts = factsOf(mate)
  assert.ok(mateFacts)
  assert.equal(mateFacts.checkmate, true)
  assert.equal(mateFacts.captured, 'p')
  assert.ok(mateFacts.ended)
  assert.equal(mateFacts.ended.reason, 'checkmate')
  assert.equal(mateFacts.ended.result, '1-0')
})

test('material is arithmetic over the pieces and nothing more', () => {
  assert.equal(materialOf(START_FEN), 0)
  assert.equal(materialOf('8/8/8/8/8/8/8/K6k w - - 0 1'), 0)
  assert.equal(materialOf('q7/8/8/8/8/8/8/K6k w - - 0 1'), -9)
  assert.equal(materialOf('8/8/8/8/8/8/8/KR5k w - - 0 1'), 5)
})

// ---------------------------------------------------------------- an engine judgement, and refusing to use a bad one

test('an evaluation that cannot be trusted is not used, and nothing is said about the move', () => {
  const [move] = walk(['e4'])
  const bad: Judgement[] = [
    // No score.
    { before: { kind: 'none' }, after: { kind: 'cp', cp: -400 }, depth: 20 },
    { before: { kind: 'cp', cp: 20 }, after: { kind: 'none' }, depth: 20 },
    // Only a bound, so the number is a limit and not a verdict.
    { before: { kind: 'cp', cp: 20 }, after: { kind: 'cp', cp: -400 }, depth: 20, bounded: true },
    // Too shallow to quote.
    { before: { kind: 'cp', cp: 20 }, after: { kind: 'cp', cp: -400 }, depth: 2 },
    // No depth reported at all.
    { before: { kind: 'cp', cp: 20 }, after: { kind: 'cp', cp: -400 } }
  ]
  for (const judgement of bad) {
    const facts = engineFactsOf(judgement, 'w', 'e2e4')
    assert.ok(facts)
    assert.equal(facts.usable, false)
    assert.equal(facts.moveClass, 'unclear')
    assert.deepEqual([...facts.keys], [])
    for (const style of STYLES) {
      const remark = remarkOn({ move, human: 'w', judgement }, style)
      if (!remark) continue
      assert.equal(remark.from, 'board', `${style} leaned on an evaluation it was told not to trust`)
      assert.ok(!/engine/i.test(remark.text), `${style} mentioned the engine with no usable evaluation: ${remark.text}`)
    }
  }
})

test('with no evaluation at all nothing judges the move, and the tactical style stays quiet on a quiet move', () => {
  const [move] = walk(['Nf3'])
  for (const style of STYLES) {
    const remark = remarkOn({ move, human: 'w' }, style)
    if (!remark) continue
    assert.equal(remark.from, 'board')
    for (const word of ['engine', 'blunder', 'mistake', 'inaccur', 'first choice', 'depth']) {
      assert.ok(!new RegExp(word, 'i').test(remark.text), `${style} said "${word}" with nothing behind it: ${remark.text}`)
    }
  }
  // A quiet developing move has nothing concrete about it, so the concrete-only style has nothing to say.
  assert.equal(remarkOn({ move, human: 'w' }, 'tactical'), null)
  assert.equal(concrete(factsOf(move)?.keys ?? []), false)
})

test('a real evaluation is quoted as what it is, and the arithmetic is the engine’s own', () => {
  const [move] = walk(['e4'])
  const judgement: Judgement = { before: { kind: 'cp', cp: 30 }, after: { kind: 'cp', cp: -620 }, depth: 22 }
  const facts = engineFactsOf(judgement, 'w', 'e2e4')
  assert.ok(facts)
  assert.equal(facts.usable, true)
  assert.equal(facts.moveClass, 'blunder')
  assert.equal(facts.loss, 650)
  const remark = remarkOn({ move, human: 'w', judgement }, 'tactical')
  assert.ok(remark)
  assert.equal(remark.from, 'engine')
  assert.match(remark.text, /6\.50/)
  assert.match(remark.text, /depth 22/)
  assert.ok(remark.facts.includes('class:blunder'))
  assert.ok(remark.facts.includes('loss:650'))
})

test('a forced mate that was missed is said to be exactly that, with no invented number', () => {
  const [move] = walk(['e4'])
  const judgement: Judgement = { before: { kind: 'mate', moves: 3 }, after: { kind: 'cp', cp: 400 }, depth: 30 }
  const facts = engineFactsOf(judgement, 'w', 'e2e4')
  assert.equal(facts?.moveClass, 'missed-mate')
  assert.equal(facts?.loss, null, 'missing a mate is not a number of centipawns')
  const remark = remarkOn({ move, human: 'w', judgement }, 'tactical')
  assert.ok(remark)
  assert.match(remark.text, /forced mate/)
  assert.ok(!/\d+\.\d\d/.test(remark.text), `a missed mate must not be given a centipawn price: ${remark.text}`)
})

// ---------------------------------------------------------------- the guard

/**
 * The judgements the guard tries.
 *
 * Deliberately a handful rather than every combination. Each one is a different kind of input: nothing at all, a
 * settled evaluation that makes the move a blunder, one that makes it the engine's own first choice, a missed
 * forced mate, and two that must not be used at all. Walking every pair of scores instead took three minutes,
 * because judging a move means replaying the game through the rules to see whether it ended -- and a guard nobody
 * runs is not a guard.
 */
const JUDGEMENTS: readonly (Judgement | undefined)[] = Object.freeze([
  undefined,
  Object.freeze({ before: { kind: 'cp', cp: 30 } as Score, after: { kind: 'cp', cp: -620 } as Score, depth: 22 }),
  Object.freeze({ before: { kind: 'cp', cp: -40 } as Score, after: { kind: 'cp', cp: -120 } as Score, depth: 18 }),
  Object.freeze({ before: { kind: 'cp', cp: 310 } as Score, after: { kind: 'cp', cp: 305 } as Score, depth: 24, bestUci: 'e2e4' }),
  Object.freeze({ before: { kind: 'mate', moves: 2 } as Score, after: { kind: 'cp', cp: 500 } as Score, depth: 30 }),
  Object.freeze({ before: { kind: 'cp', cp: 20 } as Score, after: { kind: 'cp', cp: -900 } as Score, depth: 20, bounded: true }),
  Object.freeze({ before: { kind: 'cp', cp: 20 } as Score, after: { kind: 'cp', cp: -900 } as Score, depth: 2 })
])

/** Built once: the guard walks thousands of remarks and each one replays a game through the rules. */
let everything: ReturnType<typeof buildEveryRemark> | null = null
const everyRemark = (): ReturnType<typeof buildEveryRemark> => (everything ??= buildEveryRemark())

/** Every remark the module will produce over the games above, for the guard to walk. */
function buildEveryRemark(): { name: string; style: CommentaryStyle; move: MoveContext; judgement?: Judgement; remark: NonNullable<ReturnType<typeof remarkOn>> }[] {
  const out: { name: string; style: CommentaryStyle; move: MoveContext; judgement?: Judgement; remark: NonNullable<ReturnType<typeof remarkOn>> }[] = []
  for (const [name, game] of Object.entries(GAMES)) {
    for (const move of walk(game.sans, game.from)) {
      for (const human of ['w', 'b'] as Side[]) {
        for (const style of STYLES) {
          for (const judgement of JUDGEMENTS) {
            const remark = remarkOn({ move, human, ...(judgement ? { judgement } : {}) }, style)
            if (remark) out.push({ name: `${name}/${human}`, style, move, ...(judgement ? { judgement } : {}), remark })
          }
        }
      }
    }
  }
  return out
}

test('no remark in any style about any move contains a word that names something it cannot see', () => {
  const all = everyRemark()
  assert.ok(all.length > 400, `the guard only looked at ${all.length} remarks, which is not enough to mean anything`)
  for (const one of all) {
    for (const word of FORBIDDEN_WORDS) {
      assert.ok(
        !new RegExp(`\b${word}\b`, 'i').test(one.remark.text),
        `${one.name} ${one.style}: "${one.remark.text}" uses the forbidden word "${word}"`
      )
    }
  }
})

test('every claim a remark makes has the fact that establishes it, and every fact it cites is true', () => {
  const all = everyRemark()
  for (const one of all) {
    // Every fact the remark leaned on, checked against the rules on its own.
    for (const key of one.remark.facts) {
      const wrong = factIsTrue(key, one.move, one.judgement)
      assert.equal(wrong, null, `${one.name} ${one.style}: cited "${key}" and ${wrong}: "${one.remark.text}"`)
    }
    // Every claim the words make, matched to a fact that establishes it.
    for (const claim of CLAIM_EVIDENCE) {
      if (!new RegExp(`\b${claim.phrase}`, 'i').test(one.remark.text)) continue
      const supported = claim.needs.some((need) =>
        one.remark.facts.some((fact) => (need.endsWith(':') ? fact.startsWith(need) : fact === need))
      )
      assert.ok(
        supported,
        `${one.name} ${one.style}: "${one.remark.text}" claims "${claim.phrase}" and cites only ${JSON.stringify(one.remark.facts)}`
      )
    }
  }
})

test('the same inputs always give the same remark, so a game reads the same way twice', () => {
  const move = walk(GAMES.castles.sans).at(-1) as MoveContext
  for (const style of STYLES) {
    const first = remarkOn({ move, human: 'w' }, style)
    const second = remarkOn({ move, human: 'w' }, style)
    assert.deepEqual(first, second, style)
  }
})

// ---------------------------------------------------------------- what is said about what

test('the end of the game is always spoken about, whatever the cadence says', () => {
  for (const [name, game] of Object.entries(GAMES)) {
    const last = walk(game.sans, game.from).at(-1)
    assert.ok(last)
    const facts = factsOf(last)
    assert.ok(facts, name)
    if (!facts.ended) continue
    assert.equal(notable(facts.keys), true, `${name} ended and was not treated as notable`)
    for (const style of STYLES) {
      if (style === 'silent') continue
      const remark = remarkOn({ move: last, human: 'w' }, style)
      assert.ok(remark, `${style} said nothing about the end of ${name}`)
      assert.ok(remark.facts.some((key) => key.startsWith('ended')), `${style} ended ${name} without citing it`)
    }
  }
})

test('each way a game ends is named for what it was', () => {
  const cases: [string, RegExp][] = [
    ['scholars', /[Cc]heckmate/],
    ['stalemate', /[Ss]talemate/],
    ['repeat', /third time|threefold/i],
    ['bare', /insufficient material|not enough material|nothing left to mate/i]
  ]
  for (const [name, pattern] of cases) {
    const game = GAMES[name]
    const last = walk(game.sans, game.from).at(-1)
    assert.ok(last)
    for (const style of STYLES) {
      if (style === 'silent') continue
      const remark = remarkOn({ move: last, human: 'w' }, style)
      assert.ok(remark, `${style} / ${name}`)
      assert.match(remark.text, pattern, `${style} did not name how ${name} ended`)
      // And it cites the reason, so the words are not the only thing saying it.
      assert.ok(remark.facts.some((key) => key.startsWith('ended:')), `${style} / ${name} did not cite how it ended`)
    }
  }
})

test('the cadence decides when an ordinary move is spoken about', () => {
  const quiet = factsOf(walk(['Nf3'])[0])?.keys ?? []
  assert.equal(notable(quiet), false)
  // The coach speaks every third half-move; the grandmaster much less often.
  assert.equal(speaksAbout('coach', quiet, 3), true)
  assert.equal(speaksAbout('coach', quiet, 4), false)
  assert.equal(speaksAbout('grandmaster', quiet, 3), false)
  assert.equal(speaksAbout('grandmaster', quiet, styleInfo('grandmaster').cadence), true)
  // The concrete-only style never speaks about a move with nothing concrete in it, at any cadence.
  for (let ply = 1; ply < 40; ply++) assert.equal(speaksAbout('tactical', quiet, ply), false)
  assert.equal(speaksAbout('silent', quiet, 3), false)
})

test('a check, a capture and a castle are each described as what they were', () => {
  const castles = walk(GAMES.castles.sans)
  const castle = castles[6]
  const check = castles.at(-1)
  assert.ok(check)
  assert.equal(castle.uci, 'e1g1', 'the test is looking at the wrong move')
  const castleRemark = remarkOn({ move: castle, human: 'w' }, 'tactical')
  assert.ok(castleRemark)
  assert.match(castleRemark.text, /castl/i)
  assert.ok(castleRemark.facts.some((key) => key.startsWith('castle:')))

  const checkRemark = remarkOn({ move: check, human: 'b' }, 'tactical')
  assert.ok(checkRemark)
  assert.match(checkRemark.text, /check/i)
  assert.ok(checkRemark.facts.includes('check'))

  const ep = walk(GAMES.enPassant.sans).at(-1)
  assert.ok(ep)
  const epRemark = remarkOn({ move: ep, human: 'w' }, 'tactical')
  assert.ok(epRemark)
  assert.match(epRemark.text, /en passant/i)
  assert.ok(epRemark.facts.includes('en-passant'))
  assert.ok(epRemark.facts.some((key) => key.startsWith('capture:')), 'en passant is a capture and must cite one')
})

test('a promotion names the piece the pawn really became', () => {
  const promote = walk(GAMES.promote.sans, GAMES.promote.from)[0]
  for (const style of ['coach', 'grandmaster', 'rival', 'tactical'] as CommentaryStyle[]) {
    const remark = remarkOn({ move: promote, human: 'w' }, style)
    assert.ok(remark, style)
    assert.match(remark.text, /queen/i)
    assert.ok(remark.facts.includes('promotion:q'))
  }
})

test('a remark addressed to the person says "you" for their move and "I" for the engine’s', () => {
  const [e4, e5] = walk(['e4', 'e5'])
  // Moved to a half-move the coach speaks at: the cadence decides whether anything is said at all.
  const yours = remarkOn({ move: { ...e4, ply: 3 }, human: 'w' }, 'coach', { phrasing: 0 })
  const theirs = remarkOn({ move: { ...e5, ply: 3 }, human: 'w' }, 'coach', { phrasing: 0 })
  assert.ok(yours)
  assert.ok(theirs)
  assert.match(yours.text, /your/i)
  assert.match(theirs.text, /\bmy\b/i)
})

test('the same line is not said twice in a row', () => {
  const [e4] = walk(['e4'])
  const move = { ...e4, ply: 3 }
  const first = remarkOn({ move, human: 'w' }, 'coach')
  assert.ok(first)
  const second = remarkOn({ move, human: 'w' }, 'coach', { last: first.id })
  // A different line, a different wording of it, or nothing: never the same sentence again.
  if (second) assert.notEqual(second.text, first.text)
  // And with only one wording of the only thing that fits, it says nothing rather than repeating itself.
  const only = remarkOn({ move, human: 'w' }, 'grandmaster', { last: 'quiet-move' })
  assert.equal(only, null)
})

test('every phrasing in the table is reachable and every speaking style has something to say', () => {
  const rows = allPhrasings()
  assert.ok(rows.length > 30)
  for (const style of STYLES) {
    if (style === 'silent') continue
    assert.ok(rows.some((row) => row.style === style), `${style} has no phrasing at all`)
  }
  // Nothing is offered to the silent style, which is what makes its silence structural rather than a check.
  assert.equal(rows.filter((row) => row.style === 'silent').length, 0)
})

test('a style with more than one way of saying something uses them all, and only its own', () => {
  const quiet = { ...walk(['Nf3'])[0], ply: 3 }
  const texts = new Set<string>()
  for (let phrasing = 0; phrasing < 6; phrasing++) {
    const remark = remarkOn({ move: quiet, human: 'w' }, 'coach', { phrasing })
    assert.ok(remark, `phrasing ${phrasing}`)
    texts.add(remark.text)
    // Whichever wording is chosen, the facts it cites are the same ones.
    assert.ok(remark.facts.includes('piece:n'))
  }
  assert.ok(texts.size > 1, 'the coach has two ways of describing a quiet move and used only one')
})
