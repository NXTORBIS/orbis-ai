/**
 * Colour Sort: tubes of coloured layers, poured one into another until each tube holds one colour.
 *
 * The puzzle is built backwards from the finished state. Starting from tubes that are already sorted, it takes layers
 * off the top of one tube and lays them on another — but only in ways that are exactly the undoing of a legal pour. So
 * the list of moves that made the mess, read backwards, is a run of legal pours that tidies it, and the generator hands
 * that list back with the puzzle. That is why a Colour Sort here can always be finished: not because a solver found a
 * way, but because the way was there before the puzzle was.
 *
 * Nothing here touches the screen.
 */

/** Each tube, bottom layer first. The numbers are colours, 1 upwards. */
export type Tubes = number[][]

export const TUBE_CAPACITY = 4

export type SortDifficulty = 'easy' | 'normal' | 'hard'

export interface SortLevel {
  colours: number
  /** Empty tubes to work with. */
  spare: number
  /**
   * How many backwards pours to try before handing the puzzle over.
   *
   * It is a limit rather than a promise. The mixing stops on its own once every tube has a different colour on top
   * and none of them is all one colour, because at that point there is no backwards pour left to make -- so easy is
   * easy by stopping early, while hard is simply allowed to mix until it cannot mix any more.
   */
  scramble: number
}

export const SORT_LEVELS: Record<SortDifficulty, SortLevel> = {
  easy: { colours: 5, spare: 2, scramble: 9 },
  normal: { colours: 8, spare: 2, scramble: 28 },
  hard: { colours: 11, spare: 2, scramble: 240 }
}

/** The colour on top and how many layers of it there are. A length of 0 means the tube is empty. */
export function topRun(tube: number[]): { colour: number; length: number } {
  if (!tube.length) return { colour: 0, length: 0 }
  const colour = tube[tube.length - 1]
  let length = 0
  for (let i = tube.length - 1; i >= 0 && tube[i] === colour; i--) length++
  return { colour, length }
}

export const isTubeDone = (tube: number[], capacity = TUBE_CAPACITY): boolean => tube.length === 0 || (tube.length === capacity && tube.every((c) => c === tube[0]))

export const isSorted = (tubes: Tubes, capacity = TUBE_CAPACITY): boolean => tubes.every((t) => isTubeDone(t, capacity))

/** You can pour when the tube you are pouring into is empty, or its top colour is the one coming out, and it has room. */
export function canPour(tubes: Tubes, from: number, to: number, capacity = TUBE_CAPACITY): boolean {
  if (from === to || !tubes[from] || !tubes[to]) return false
  const source = topRun(tubes[from])
  if (!source.length) return false
  if (tubes[to].length >= capacity) return false
  const target = topRun(tubes[to])
  return target.length === 0 || target.colour === source.colour
}

/** The pour: the whole top run moves across, or as much of it as fits. Null when that pour is not allowed. */
export function pour(tubes: Tubes, from: number, to: number, capacity = TUBE_CAPACITY): Tubes | null {
  if (!canPour(tubes, from, to, capacity)) return null
  const source = topRun(tubes[from])
  const moved = Math.min(source.length, capacity - tubes[to].length)
  const next = tubes.map((t) => t.slice())
  next[from].length -= moved
  for (let i = 0; i < moved; i++) next[to].push(source.colour)
  return next
}

export function legalMoves(tubes: Tubes, capacity = TUBE_CAPACITY): [number, number][] {
  const out: [number, number][] = []
  for (let from = 0; from < tubes.length; from++)
    for (let to = 0; to < tubes.length; to++) {
      if (!canPour(tubes, from, to, capacity)) continue
      // Tipping a tube that already holds one colour into an empty one changes nothing but the tube it is in.
      if (!tubes[to].length && topRun(tubes[from]).length === tubes[from].length) continue
      out.push([from, to])
    }
  return out
}

/** Two arrangements are the same puzzle when the same tubes hold the same layers; which tube is which does not matter. */
export const tubesKey = (tubes: Tubes): string => tubes.map((t) => t.join('.')).sort().join('|')

// ---------------------------------------------------------------- making one

export interface SortPuzzle {
  tubes: Tubes
  /** A run of pours that finishes it, which is the scramble read backwards. */
  solution: [number, number][]
  colours: number
  capacity: number
  difficulty: SortDifficulty
}

/**
 * Pours the finished state backwards.
 *
 * A backwards pour takes some of the top run of colour c off one tube and lays it on another whose top is not c (or is
 * empty). Read forwards that is one legal pour of exactly those layers, because the tube it came from now has the room
 * and the tube it went to now has that run and nothing else on top of it.
 *
 * One condition is easy to miss and breaks everything: it may only take *part* of the run, or else empty the tube
 * outright. Take a whole run off a tube that has another colour underneath and the way back is blocked -- those layers
 * would have to be poured onto a colour they do not match, which is exactly what the rules refuse.
 */
export function generateTubes(difficulty: SortDifficulty, random: () => number = Math.random, capacity = TUBE_CAPACITY): SortPuzzle {
  const { colours, spare, scramble } = SORT_LEVELS[difficulty]
  let tubes: Tubes = Array.from({ length: colours }, (_, i) => Array<number>(capacity).fill(i + 1))
  for (let i = 0; i < spare; i++) tubes.push([])
  const backwards: [number, number][] = []

  for (let step = 0; step < scramble; step++) {
    const options: { from: number; to: number; take: number }[] = []
    for (let from = 0; from < tubes.length; from++) {
      const run = topRun(tubes[from])
      if (!run.length) continue
      for (let to = 0; to < tubes.length; to++) {
        if (to === from || tubes[to].length >= capacity) continue
        const target = topRun(tubes[to])
        if (target.length && target.colour === run.colour) continue
        const room = capacity - tubes[to].length
        for (let take = 1; take <= Math.min(run.length, room); take++) {
          // Part of the run leaves its colour on top; all of it is only allowed when the tube empties completely.
          if (take < run.length || take === tubes[from].length) options.push({ from, to, take })
        }
      }
    }
    if (!options.length) break
    const pick = options[Math.floor(random() * options.length)]
    const next = tubes.map((t) => t.slice())
    for (let i = 0; i < pick.take; i++) next[pick.to].push(next[pick.from].pop()!)
    tubes = next
    // Read forwards, this move is a pour out of the tube we just filled and back into the one we took from.
    backwards.push([pick.to, pick.from])
  }

  const solution = backwards.slice().reverse()
  // A scramble that happened to land back on a sorted board is not a puzzle; one more go, from a different roll.
  if (isSorted(tubes, capacity)) return generateTubes(difficulty, random, capacity)
  return { tubes, solution, colours, capacity, difficulty }
}

/**
 * A run of pours that finishes it, found rather than remembered.
 *
 * This is what the test uses to check the generator honestly, and what the Hint button uses to name a move worth
 * making. It gives up after `maxNodes` arrangements rather than hanging; giving up is not the same as proving there is
 * no way through, and the caller is told which it was.
 */
export function solveTubes(tubes: Tubes, capacity = TUBE_CAPACITY, maxNodes = 200000): { moves: [number, number][] | null; gaveUp: boolean } {
  const seen = new Set<string>()
  const path: [number, number][] = []
  let nodes = 0
  let gaveUp = false

  const walk = (state: Tubes): boolean => {
    if (isSorted(state, capacity)) return true
    if (++nodes > maxNodes) {
      gaveUp = true
      return false
    }
    const key = tubesKey(state)
    if (seen.has(key)) return false
    seen.add(key)
    const moves = legalMoves(state, capacity)
    // Pours that finish a tube, or that empty one, come first: they are the moves that actually get anywhere.
    moves.sort((a, b) => score(state, b, capacity) - score(state, a, capacity))
    for (const [from, to] of moves) {
      const next = pour(state, from, to, capacity)
      if (!next) continue
      path.push([from, to])
      if (walk(next)) return true
      path.pop()
      if (gaveUp) return false
    }
    return false
  }

  const ok = walk(tubes.map((t) => t.slice()))
  return ok ? { moves: path.slice(), gaveUp } : { moves: null, gaveUp }
}

const score = (tubes: Tubes, move: [number, number], capacity: number): number => {
  const [from, to] = move
  const run = topRun(tubes[from])
  const moved = Math.min(run.length, capacity - tubes[to].length)
  let value = moved
  if (moved === run.length && run.length === tubes[from].length) value += 6
  if (tubes[to].length + moved === capacity && tubes[to].every((c) => c === run.colour)) value += 8
  return value
}

/**
 * Points for a finished puzzle: how many colours it had, less what the tidying cost.
 *
 * Undoing and asking for a hint are both free to use and neither is free of charge, which is the honest way round:
 * they are help, not cheating, and a score that ignored them would be telling the player something untrue about how
 * they did.
 */
export function sortScore(colours: number, moves: number, seconds: number, undos: number, hints = 0): number {
  const base = colours * 140
  const extra = Math.max(0, moves - colours * 3)
  return Math.max(60, base - extra * 6 - Math.round(Math.max(0, seconds) * 0.5) - Math.max(0, undos) * 12 - Math.max(0, hints) * 30)
}

// ---------------------------------------------------------------- saving one

export interface SortSave {
  tubes: Tubes
  capacity: number
  colours: number
  moves: number
  undos: number
  seconds: number
  difficulty: SortDifficulty
}

/** A saved puzzle is only loaded back when every colour still has exactly a tube's worth of layers in it. */
export function isSortSave(value: unknown): value is SortSave {
  const save = value as SortSave
  if (!save || !Number.isInteger(save.capacity) || save.capacity < 2 || save.capacity > 8) return false
  if (!Number.isInteger(save.colours) || save.colours < 2 || save.colours > 14) return false
  if (!Array.isArray(save.tubes) || save.tubes.length < save.colours) return false
  if (!save.tubes.every((t) => Array.isArray(t) && t.length <= save.capacity && t.every((c) => Number.isInteger(c) && c >= 1 && c <= save.colours))) return false
  const counts = new Map<number, number>()
  for (const tube of save.tubes) for (const colour of tube) counts.set(colour, (counts.get(colour) ?? 0) + 1)
  for (let colour = 1; colour <= save.colours; colour++) if (counts.get(colour) !== save.capacity) return false
  return ['easy', 'normal', 'hard'].includes(save.difficulty)
}
