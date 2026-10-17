import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyMove,
  canFinishItself,
  canHome,
  canSit,
  dealKlondike,
  dealRules,
  finishItself,
  isKlondike,
  isRed,
  legalMoves,
  movableRun,
  sendHome,
  stuck,
  SUITS,
  winBonus,
  won,
  type Card,
  type Klondike,
  type Suit
} from './solitaire.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const card = (suit: Suit, rank: number, up = true): Card => ({ suit, rank, up })

/** A table made up by hand. Not a whole deck -- the rules do not care how many cards exist, only what may move. */
const table = (over: Partial<Klondike>): Klondike => ({
  tableau: [[], [], [], [], [], [], []],
  foundations: [[], [], [], []],
  stock: [],
  waste: [],
  drawCount: 3,
  maxRecycles: -1,
  recycles: 0,
  score: 0,
  moves: 0,
  ...over
})

test('the deal is a whole deck, seven columns, and only the last card of each face up', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = dealKlondike(seeded(seed))
    assert.equal(game.tableau.length, 7)
    game.tableau.forEach((column, index) => {
      assert.equal(column.length, index + 1)
      assert.equal(column[column.length - 1].up, true)
      assert.ok(column.slice(0, -1).every((c) => !c.up))
    })
    assert.equal(game.stock.length, 24)
    assert.equal(game.waste.length, 0)
    assert.ok(game.stock.every((c) => !c.up))
    const all = [...game.tableau.flat(), ...game.stock]
    assert.equal(all.length, 52)
    assert.equal(new Set(all.map((c) => `${c.suit}${c.rank}`)).size, 52, 'every card exactly once')
    assert.equal(isKlondike(game), true)
  }
})

test('what may sit on what', () => {
  assert.equal(canSit(card('hearts', 6), card('spades', 7)), true)
  assert.equal(canSit(card('hearts', 6), card('diamonds', 7)), false, 'red does not go on red')
  assert.equal(canSit(card('hearts', 6), card('spades', 8)), false, 'it has to be one lower')
  assert.equal(canSit(card('hearts', 6), card('spades', 7, false)), false, 'nothing sits on a face-down card')
  assert.equal(canSit(card('spades', 13), undefined), true, 'an empty column takes a king')
  assert.equal(canSit(card('spades', 12), undefined), false)
  assert.equal(canHome(card('hearts', 1), []), true)
  assert.equal(canHome(card('hearts', 2), [card('hearts', 1)]), true)
  assert.equal(canHome(card('hearts', 3), [card('hearts', 1)]), false)
  assert.equal(isRed('hearts'), true)
  assert.equal(isRed('spades'), false)
})

test('a run you can pick up is face up, falling, and two colours', () => {
  assert.equal(movableRun([card('spades', 5, false)]), 0)
  assert.equal(movableRun([card('spades', 5, false), card('hearts', 9)]), 1)
  assert.equal(movableRun([card('clubs', 8), card('diamonds', 7), card('spades', 6)]), 3)
  assert.equal(movableRun([card('clubs', 8), card('spades', 7), card('diamonds', 6)]), 2, 'the black pair breaks the run')
  assert.equal(movableRun([card('clubs', 8), card('diamonds', 4)]), 1)
})

test('an illegal move changes nothing at all', () => {
  const game = table({ tableau: [[card('spades', 7)], [card('diamonds', 6)], [card('hearts', 6)], [], [], [], []] })
  assert.equal(applyMove(game, { kind: 'move', from: { kind: 'tableau', index: 2 }, count: 1, to: { kind: 'tableau', index: 1 } }), null)
  assert.equal(applyMove(game, { kind: 'move', from: { kind: 'tableau', index: 0 }, count: 1, to: { kind: 'foundation', index: SUITS.indexOf('spades') } }), null, 'a seven is not an ace')
  assert.equal(applyMove(game, { kind: 'move', from: { kind: 'tableau', index: 1 }, count: 1, to: { kind: 'foundation', index: SUITS.indexOf('spades') } }), null, 'a diamond does not go on the spades')
  assert.equal(applyMove(game, { kind: 'move', from: { kind: 'tableau', index: 0 }, count: 2, to: { kind: 'tableau', index: 3 } }), null, 'you cannot take more cards than are there')
  assert.equal(applyMove(game, { kind: 'move', from: { kind: 'tableau', index: 0 }, count: 1, to: { kind: 'tableau', index: 0 } }), null)
  assert.equal(applyMove(game, { kind: 'draw' }), null, 'nothing to draw')
  assert.equal(applyMove(game, { kind: 'recycle' }), null, 'nothing to turn over')
  const moved = applyMove(game, { kind: 'move', from: { kind: 'tableau', index: 1 }, count: 1, to: { kind: 'tableau', index: 0 } })
  assert.ok(moved)
  assert.equal(moved!.tableau[0].length, 2)
  assert.equal(moved!.tableau[1].length, 0)
  // The original is untouched, which is what makes undo a list of these.
  assert.equal(game.tableau[0].length, 1)
  assert.equal(game.tableau[1].length, 1)
})

test('taking the last face-up card off a column turns the next one over, and pays for it', () => {
  const game = table({ tableau: [[card('clubs', 2, false), card('hearts', 1)], [], [], [], [], [], []] })
  const home = sendHome(game, { kind: 'tableau', index: 0 })
  assert.ok(home)
  assert.equal(home!.foundations[SUITS.indexOf('hearts')].length, 1)
  assert.equal(home!.tableau[0][0].up, true, 'the card underneath is turned over')
  assert.equal(home!.score, 15, 'ten for the card home and five for turning one over')
  assert.equal(sendHome(home!, { kind: 'tableau', index: 1 }), null, 'nothing to send from an empty column')
  assert.equal(sendHome(game, { kind: 'foundation', index: 0 }), null, 'a card already home does not go home again')
})

test('drawing turns over as many as the rules say, and turning the stock back is the other way round', () => {
  const stock = [card('spades', 1, false), card('spades', 2, false), card('spades', 3, false), card('spades', 4, false)]
  const threes = table({ stock: [...stock] })
  const drawn = applyMove(threes, { kind: 'draw' })!
  assert.equal(drawn.waste.length, 3)
  assert.equal(drawn.stock.length, 1)
  assert.ok(drawn.waste.every((c) => c.up))
  assert.equal(drawn.waste[drawn.waste.length - 1].rank, 2, 'the cards come off the top of the stock')
  const last = applyMove(drawn, { kind: 'draw' })!
  assert.equal(last.waste.length, 4)
  assert.equal(last.stock.length, 0)
  const over = applyMove(last, { kind: 'recycle' })!
  assert.equal(over.stock.length, 4)
  assert.equal(over.waste.length, 0)
  assert.ok(over.stock.every((c) => !c.up))
  assert.equal(over.recycles, 1)
  // One card at a time, for anybody who would rather see them all.
  const ones = applyMove(table({ stock: [...stock], drawCount: 1 }), { kind: 'draw' })!
  assert.equal(ones.waste.length, 1)
  // Hard lets you go round twice and no more.
  let limited = table({ stock: [...stock], maxRecycles: 1 })
  limited = applyMove(limited, { kind: 'draw' })!
  limited = applyMove(limited, { kind: 'draw' })!
  limited = applyMove(limited, { kind: 'recycle' })!
  limited = applyMove(limited, { kind: 'draw' })!
  limited = applyMove(limited, { kind: 'draw' })!
  assert.equal(applyMove(limited, { kind: 'recycle' }), null)
  assert.equal(legalMoves(limited).some((move) => move.kind === 'recycle'), false)
})

test('"no moves left" is only said when there are none', () => {
  // Two cards that cannot be played on each other, nothing to draw: that is the end.
  const dead = table({ tableau: [[card('spades', 4)], [card('hearts', 6)], [], [], [], [], []] })
  assert.equal(stuck(dead), true)
  assert.equal(legalMoves(dead).length, 0)
  // An ace on the table is a move, so it is not the end.
  const alive = table({ tableau: [[card('spades', 4)], [card('hearts', 1)], [], [], [], [], []] })
  assert.equal(stuck(alive), false)
  // A king and an empty column is a move too.
  assert.equal(stuck(table({ tableau: [[card('spades', 3, false), card('hearts', 13)], [], [], [], [], [], []] })), false)
  // Buried where three draws will not reach it, two will: the stock is walked all the way round before giving up.
  const buried = table({
    tableau: [[card('spades', 4)], [card('hearts', 6)], [], [], [], [], []],
    stock: [card('diamonds', 1, false), card('clubs', 7, false), card('clubs', 8, false), card('clubs', 9, false), card('clubs', 10, false), card('clubs', 11, false)]
  })
  assert.equal(applyMove(buried, { kind: 'draw' })!.waste[2].rank, 9, 'the first draw does not reach the ace')
  assert.equal(stuck(buried), false)
  // The same stock with nothing playable in it is the end, however many times you turn it over.
  const hopeless = table({
    tableau: [[card('spades', 4)], [card('hearts', 6)], [], [], [], [], []],
    stock: [card('clubs', 6, false), card('clubs', 7, false), card('clubs', 8, false), card('clubs', 9, false), card('clubs', 10, false), card('clubs', 11, false)]
  })
  assert.equal(stuck(hopeless), true)
  // And a game already won is finished, not stuck.
  const complete = table({ foundations: SUITS.map((suit) => Array.from({ length: 13 }, (_, i) => card(suit, i + 1))) })
  assert.equal(won(complete), true)
  assert.equal(stuck(complete), false)
})

test('a fresh deal always has something to do, and the first thing is never a lie', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const game = dealKlondike(seeded(seed * 2654435761))
    assert.equal(stuck(game), false)
    assert.equal(won(game), false)
    const moves = legalMoves(game)
    assert.ok(moves.length > 0)
    for (const move of moves) assert.ok(applyMove(game, move), `${JSON.stringify(move)} was offered and then refused`)
  }
})

test('"no moves left" is checked by hand over hundreds of real deals', () => {
  /**
   * A second opinion, worked out from the table rather than from the rules under test: every card that can reach the
   * top of the pile beside the stock as it is turned over, and every place a card could legally go. If this finds a
   * move in a game the rules called finished, the rules are wrong -- and a solitaire that says "no moves left" while
   * a move is sitting there has stolen the game.
   */
  const reachableTops = (game: Klondike): Set<string> => {
    let stock = game.stock.map((c) => ({ ...c }))
    let waste = game.waste.map((c) => ({ ...c }))
    const tops = new Set<string>()
    const name = (c: Card): string => `${c.suit}${c.rank}`
    if (waste.length) tops.add(name(waste[waste.length - 1]))
    let recycles = game.recycles
    for (let guard = 0; guard < 120; guard++) {
      if (!stock.length) {
        if (!waste.length) break
        if (game.maxRecycles >= 0 && recycles >= game.maxRecycles) break
        recycles++
        stock = waste.reverse().map((c) => ({ ...c, up: false }))
        waste = []
        continue
      }
      for (let n = 0; n < game.drawCount && stock.length; n++) waste.push(stock.pop()!)
      tops.add(name(waste[waste.length - 1]))
    }
    return tops
  }
  const anythingLeft = (game: Klondike): string[] => {
    const found: string[] = []
    const tops = game.tableau.map((column) => column[column.length - 1])
    const where = (card: Card, mayGoHome: boolean): string | null => {
      if (mayGoHome && (game.foundations[SUITS.indexOf(card.suit)].at(-1)?.rank ?? 0) === card.rank - 1) return 'home'
      for (const onto of tops) {
        if (!onto && card.rank === 13) return 'an empty column'
        if (onto?.up && onto.rank === card.rank + 1 && isRed(onto.suit) !== isRed(card.suit)) return `on the ${onto.rank}`
      }
      return null
    }
    const reachable = reachableTops(game)
    for (const card of [...game.stock, ...game.waste]) {
      if (!reachable.has(`${card.suit}${card.rank}`)) continue
      const place = where(card, true)
      if (place) found.push(`${card.rank} of ${card.suit} from the stock could go ${place}`)
    }
    game.tableau.forEach((column, index) => {
      for (let i = column.length - 1; i >= 0; i--) {
        const card = column[i]
        if (!card.up) break
        const above = column[i + 1]
        if (above && !(card.rank === above.rank + 1 && isRed(card.suit) !== isRed(above.suit))) break
        const place = where(card, i === column.length - 1)
        // Shifting a whole column onto an empty one is not a move anybody would call one.
        if (place && !(place === 'an empty column' && i === 0)) found.push(`${card.rank} of ${card.suit} in column ${index + 1} could go ${place}`)
      }
    })
    return found
  }

  let ended = 0
  for (let seed = 1; seed <= 120; seed++) {
    const random = seeded(seed * 7919)
    let game = dealKlondike(random)
    // Played the way most people play: everything that can go home goes home, and otherwise the stock is turned.
    for (let move = 0; move < 400; move++) {
      if (won(game)) break
      if (stuck(game)) {
        ended++
        assert.deepEqual(anythingLeft(game), [], `seed ${seed}: the game was called finished with moves still on the table`)
        break
      }
      const moves = legalMoves(game)
      const home = moves.find((one) => one.kind === 'move' && one.to.kind === 'foundation' && one.from.kind !== 'foundation')
      const onto = moves.find((one) => one.kind === 'move' && one.to.kind === 'tableau' && one.from.kind !== 'foundation')
      const turn = moves.find((one) => one.kind === 'draw') ?? moves.find((one) => one.kind === 'recycle')
      const chosen = home ?? (move % 3 === 0 ? onto : undefined) ?? turn ?? onto
      if (!chosen) break
      game = applyMove(game, chosen)!
      if (canFinishItself(game)) game = finishItself(game)
      assert.equal(isKlondike(game), true, `seed ${seed}: the deck stopped being a deck after ${move} moves`)
    }
  }
  assert.ok(ended > 5, `only ${ended} deals ran out of moves, which is not enough to have checked anything`)
})

test('the last few cards tidy themselves up, and that finishes the game', () => {
  // Every suit up to the queen, the kings face up on the table, nothing in hand.
  const foundations = SUITS.map((suit) => Array.from({ length: 12 }, (_, i) => card(suit, i + 1)))
  const game = table({ foundations, tableau: [[card('spades', 13)], [card('hearts', 13)], [card('diamonds', 13)], [card('clubs', 13)], [], [], []] })
  assert.equal(canFinishItself(game), true)
  const finished = finishItself(game)
  assert.equal(won(finished), true)
  assert.equal(finished.score, 40, 'ten a card')
  assert.equal(canFinishItself(finished), false, 'a finished game has nothing left to tidy')
  // Not while there are cards in hand or face down.
  assert.equal(canFinishItself({ ...game, stock: [card('spades', 1, false)] }), false)
  assert.equal(canFinishItself(table({ tableau: [[card('spades', 2, false), card('hearts', 3)], [], [], [], [], [], []] })), false)
  assert.ok(winBonus(10) > winBonus(300), 'finishing quickly is worth more')
  assert.ok(winBonus(100000) > 0, 'finishing at all is always worth something')
})

test('how a run is set up, and a saved game is only loaded when it is a real deck', () => {
  assert.equal(dealRules('easy').drawCount, 1)
  assert.equal(dealRules('normal').drawCount, 3)
  assert.equal(dealRules('normal').maxRecycles, -1)
  assert.equal(dealRules('hard').maxRecycles, 2)
  const game = dealKlondike(seeded(4), dealRules('hard').drawCount, dealRules('hard').maxRecycles)
  assert.equal(isKlondike(game), true)
  assert.equal(isKlondike(JSON.parse(JSON.stringify(game))), true)
  assert.equal(isKlondike({ ...game, stock: game.stock.slice(1) }), false, 'a card has gone missing')
  assert.equal(isKlondike({ ...game, tableau: game.tableau.slice(1) }), false)
  // A suit pile out of order is not a solitaire anybody was playing.
  const muddled = structuredClone(game)
  muddled.foundations[0] = [card('spades', 5)]
  muddled.stock = muddled.stock.filter((c) => !(c.suit === 'spades' && c.rank === 5))
  assert.equal(isKlondike(muddled), false)
  assert.equal(isKlondike(null), false)
})
