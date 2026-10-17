/**
 * Klondike solitaire's rules, kept pure: the deal, what may sit on what, every move that is legal right now, and
 * whether there is anything left to do.
 *
 * The last one is the part worth testing. "No moves left" is a claim about the future, and a solitaire that says it
 * while a legal move is sitting on the table has stolen the game. So `stuck` does not guess: it looks at every move
 * that could put a card somewhere new, and when the only thing left is turning the stock over it walks the whole
 * stock round once -- because in threes, a card that is buried now is on top four draws later. Pulling a card back
 * off a finished suit is deliberately not counted, since that puts nothing anywhere new on its own.
 */

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
export const SUIT_SIGNS: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
export const RANK_NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const isRed = (suit: Suit): boolean => suit === 'hearts' || suit === 'diamonds'

export interface Card {
  suit: Suit
  /** 1 is an ace, 13 a king. */
  rank: number
  up: boolean
}

export interface Klondike {
  /** Seven columns, bottom card first. */
  tableau: Card[][]
  /** One pile per suit, in the order of SUITS. */
  foundations: Card[][]
  stock: Card[]
  waste: Card[]
  /** How many cards a draw turns over. */
  drawCount: 1 | 3
  /** How many times the stock may be turned over again; -1 is as often as you like. */
  maxRecycles: number
  recycles: number
  score: number
  moves: number
}

export type Pile = { kind: 'tableau'; index: number } | { kind: 'foundation'; index: number } | { kind: 'waste' }

/** Where a card can be put down. Never the pile beside the stock: cards leave that one and never go back to it. */
export type Target = { kind: 'tableau'; index: number } | { kind: 'foundation'; index: number }

export type Move = { kind: 'draw' } | { kind: 'recycle' } | { kind: 'move'; from: Pile; count: number; to: Target }

const top = <T>(pile: T[]): T | undefined => pile[pile.length - 1]

/** A card may sit on a tableau pile when it is one lower and the other colour; an empty column takes a king. */
export function canSit(card: Card, onto: Card | undefined): boolean {
  if (!onto) return card.rank === 13
  return onto.up && onto.rank === card.rank + 1 && isRed(onto.suit) !== isRed(card.suit)
}

/** A card goes home when its suit's pile is one rank short of it. */
export const canHome = (card: Card, pile: Card[]): boolean => (top(pile)?.rank ?? 0) === card.rank - 1

/** The run of face-up cards at the end of a column that can be picked up together. */
export function movableRun(column: Card[]): number {
  let count = 0
  for (let i = column.length - 1; i >= 0; i--) {
    const card = column[i]
    if (!card.up) break
    const above = column[i + 1]
    if (above && !(card.rank === above.rank + 1 && isRed(card.suit) !== isRed(above.suit))) break
    count++
  }
  return count
}

const clone = (game: Klondike): Klondike => ({
  ...game,
  tableau: game.tableau.map((column) => column.map((card) => ({ ...card }))),
  foundations: game.foundations.map((pile) => pile.map((card) => ({ ...card }))),
  stock: game.stock.map((card) => ({ ...card })),
  waste: game.waste.map((card) => ({ ...card }))
})

/** A shuffled deck, dealt the Klondike way: one column of one up to one of seven, each with its last card face up. */
export function dealKlondike(random: () => number = Math.random, drawCount: 1 | 3 = 3, maxRecycles = -1): Klondike {
  const deck: Card[] = []
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank, up: false })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const tableau: Card[][] = []
  for (let column = 0; column < 7; column++) {
    const cards = deck.splice(0, column + 1)
    cards[cards.length - 1].up = true
    tableau.push(cards)
  }
  return { tableau, foundations: SUITS.map(() => []), stock: deck, waste: [], drawCount, maxRecycles, recycles: 0, score: 0, moves: 0 }
}

const pileCards = (game: Klondike, pile: Pile): Card[] => (pile.kind === 'tableau' ? game.tableau[pile.index] : pile.kind === 'foundation' ? game.foundations[pile.index] : game.waste)

/** Every move that is legal right now, including turning the stock over. */
export function legalMoves(game: Klondike): Move[] {
  const moves: Move[] = []
  if (game.stock.length) moves.push({ kind: 'draw' })
  else if (game.waste.length && (game.maxRecycles < 0 || game.recycles < game.maxRecycles)) moves.push({ kind: 'recycle' })

  const sources: { pile: Pile; card: Card; count: number }[] = []
  const wasteTop = top(game.waste)
  if (wasteTop) sources.push({ pile: { kind: 'waste' }, card: wasteTop, count: 1 })
  game.tableau.forEach((column, index) => {
    const run = movableRun(column)
    for (let n = 1; n <= run; n++) sources.push({ pile: { kind: 'tableau', index }, card: column[column.length - n], count: n })
  })
  game.foundations.forEach((pile, index) => {
    const card = top(pile)
    if (card) sources.push({ pile: { kind: 'foundation', index }, card, count: 1 })
  })

  for (const source of sources) {
    if (source.count === 1 && source.pile.kind !== 'foundation') {
      const home = SUITS.indexOf(source.card.suit)
      if (canHome(source.card, game.foundations[home])) moves.push({ kind: 'move', from: source.pile, count: 1, to: { kind: 'foundation', index: home } })
    }
    game.tableau.forEach((column, index) => {
      if (source.pile.kind === 'tableau' && source.pile.index === index) return
      if (!canSit(source.card, top(column))) return
      // Shifting a whole column onto an empty one swaps two empty spaces for each other and does nothing.
      if (!column.length && source.pile.kind === 'tableau' && source.count === game.tableau[source.pile.index].length) return
      moves.push({ kind: 'move', from: source.pile, count: source.count, to: { kind: 'tableau', index } })
    })
  }
  return moves
}

/** Standard Klondike scoring, floored at nothing: you can play badly, but you cannot owe the game points. */
const addScore = (game: Klondike, delta: number): void => {
  game.score = Math.max(0, game.score + delta)
}

/** Plays a move, or returns null when it is not legal -- so a wrong drag changes nothing at all. */
export function applyMove(game: Klondike, move: Move): Klondike | null {
  if (move.kind === 'draw') {
    if (!game.stock.length) return null
    const next = clone(game)
    for (let n = 0; n < game.drawCount && next.stock.length; n++) {
      const card = next.stock.pop()!
      card.up = true
      next.waste.push(card)
    }
    next.moves++
    return next
  }
  if (move.kind === 'recycle') {
    if (game.stock.length || !game.waste.length) return null
    if (game.maxRecycles >= 0 && game.recycles >= game.maxRecycles) return null
    const next = clone(game)
    next.stock = next.waste.reverse().map((card) => ({ ...card, up: false }))
    next.waste = []
    next.recycles++
    next.moves++
    addScore(next, -20)
    return next
  }

  const from = pileCards(game, move.from)
  if (move.count < 1 || move.count > from.length) return null
  const taken = from.slice(from.length - move.count)
  if (taken.some((card) => !card.up)) return null
  if (move.from.kind === 'tableau' && move.count > movableRun(from)) return null
  if (move.from.kind !== 'tableau' && move.count !== 1) return null

  if (move.to.kind === 'foundation') {
    if (move.count !== 1 || move.from.kind === 'foundation') return null
    if (SUITS[move.to.index] !== taken[0].suit || !canHome(taken[0], game.foundations[move.to.index])) return null
  } else {
    if (move.from.kind === 'tableau' && move.from.index === move.to.index) return null
    const onto = top(game.tableau[move.to.index])
    if (!canSit(taken[0], onto)) return null
    if (!onto && move.from.kind === 'tableau' && move.count === from.length) return null
  }

  const next = clone(game)
  const source = pileCards(next, move.from)
  const cards = source.splice(source.length - move.count, move.count)
  if (move.to.kind === 'foundation') {
    next.foundations[move.to.index].push(...cards)
    addScore(next, 10)
  } else {
    next.tableau[move.to.index].push(...cards)
    if (move.from.kind === 'waste') addScore(next, 5)
    if (move.from.kind === 'foundation') addScore(next, -15)
  }
  if (move.from.kind === 'tableau') {
    const column = next.tableau[move.from.index]
    const exposed = top(column)
    if (exposed && !exposed.up) {
      exposed.up = true
      addScore(next, 5)
    }
  }
  next.moves++
  return next
}

/** Sending the top card of a pile home, which is what a double-click asks for. Null when it cannot go yet. */
export function sendHome(game: Klondike, from: Pile): Klondike | null {
  const card = top(pileCards(game, from))
  if (!card || !card.up || from.kind === 'foundation') return null
  const index = SUITS.indexOf(card.suit)
  if (!canHome(card, game.foundations[index])) return null
  return applyMove(game, { kind: 'move', from, count: 1, to: { kind: 'foundation', index } })
}

export const won = (game: Klondike): boolean => game.foundations.every((pile) => pile.length === 13)

/** Nothing is face down and nothing is left in hand: the rest is just tidying up, so the game offers to do it. */
export const canFinishItself = (game: Klondike): boolean => !won(game) && !game.stock.length && !game.waste.length && game.tableau.every((column) => column.every((card) => card.up))

/** Sends home everything that can go, over and over, until nothing more will. */
export function finishItself(game: Klondike): Klondike {
  let current = game
  for (let guard = 0; guard < 60; guard++) {
    let moved = false
    for (let index = 0; index < current.tableau.length; index++) {
      const next = sendHome(current, { kind: 'tableau', index })
      if (next) {
        current = next
        moved = true
      }
    }
    if (!moved) return current
  }
  return current
}

/** A move that puts a card somewhere new. Turning the stock over and taking a card back off a suit are not that. */
const productive = (move: Move): boolean => move.kind === 'move' && move.from.kind !== 'foundation'

/**
 * Whether the game is really over.
 *
 * If something can be played now, it is not. If the only thing left is the stock, the stock is walked all the way
 * round -- drawing, and turning it over when that is allowed -- and every card that reaches the top of the pile is
 * checked. Only when none of them can go anywhere is the game stuck.
 */
export function stuck(game: Klondike): boolean {
  if (won(game)) return false
  if (legalMoves(game).some(productive)) return false
  let current = game
  const cards = game.stock.length + game.waste.length
  for (let guard = 0; guard <= cards + 2; guard++) {
    const moves = legalMoves(current)
    if (moves.some(productive)) return false
    const draw = moves.find((move) => move.kind === 'draw') ?? moves.find((move) => move.kind === 'recycle')
    if (!draw) return true
    const next = applyMove(current, draw)
    if (!next) return true
    current = next
  }
  return true
}

/** How a run is set up. Easy turns one card at a time; hard turns three and lets you go round only twice. */
export const dealRules = (difficulty: 'easy' | 'normal' | 'hard'): { drawCount: 1 | 3; maxRecycles: number } =>
  difficulty === 'easy' ? { drawCount: 1, maxRecycles: -1 } : difficulty === 'hard' ? { drawCount: 3, maxRecycles: 2 } : { drawCount: 3, maxRecycles: -1 }

/** Finishing quickly is worth something, but finishing at all is worth more. */
export const winBonus = (seconds: number): number => 400 + Math.max(0, Math.round(600 - seconds * 2))

const DECK_SIZE = 52

export function isKlondike(value: unknown): value is Klondike {
  const g = value as Klondike
  if (!g || typeof g !== 'object') return false
  if (!Array.isArray(g.tableau) || g.tableau.length !== 7) return false
  if (!Array.isArray(g.foundations) || g.foundations.length !== 4) return false
  if (!Array.isArray(g.stock) || !Array.isArray(g.waste)) return false
  const all = [...g.tableau.flat(), ...g.foundations.flat(), ...g.stock, ...g.waste]
  if (all.length !== DECK_SIZE) return false
  const seen = new Set<string>()
  for (const card of all) {
    if (!card || !SUITS.includes(card.suit) || !Number.isInteger(card.rank) || card.rank < 1 || card.rank > 13 || typeof card.up !== 'boolean') return false
    seen.add(`${card.suit}${card.rank}`)
  }
  if (seen.size !== DECK_SIZE) return false
  if (g.foundations.some((pile, index) => pile.some((card, rank) => card.suit !== SUITS[index] || card.rank !== rank + 1))) return false
  return (g.drawCount === 1 || g.drawCount === 3) && Number.isFinite(g.score) && Number.isFinite(g.moves)
}
