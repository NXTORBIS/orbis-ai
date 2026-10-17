/**
 * Gem Swap: the board, what counts as a match, what falls, and when there is nothing left to do.
 *
 * Two rules here are the difference between a game and an annoyance. A board must never be dealt with a match already
 * on it, because the player's first move is then stolen from them by gems popping on their own. And a board with no
 * possible swap has to be noticed and shuffled, because otherwise the player stares at a dead board and blames
 * themselves. Both are decided here, so both are tested.
 *
 * Nothing here touches the screen.
 */

export interface Gem {
  /** Which gem it is, 1 upwards. 0 is an empty space, which only happens mid-collapse. */
  kind: number
  /** A gem made by lining up four or more. When it is cleared it takes its whole row and column with it. */
  charged: boolean
}

export type Board = Gem[]

export type MatchDifficulty = 'easy' | 'normal' | 'hard'

export interface MatchLevel {
  rows: number
  cols: number
  kinds: number
  /** Swaps you get to start with. */
  moves: number
  /** Swaps handed back for reaching a level's target. */
  reward: number
}

export const MATCH_LEVELS: Record<MatchDifficulty, MatchLevel> = {
  easy: { rows: 8, cols: 8, kinds: 5, moves: 40, reward: 14 },
  normal: { rows: 8, cols: 8, kinds: 6, moves: 30, reward: 10 },
  hard: { rows: 9, cols: 9, kinds: 7, moves: 26, reward: 8 }
}

export const at = (board: Board, cols: number, row: number, col: number): Gem | undefined => board[row * cols + col]

export const areNeighbours = (a: number, b: number, cols: number): boolean => {
  const dr = Math.abs(Math.floor(a / cols) - Math.floor(b / cols))
  const dc = Math.abs((a % cols) - (b % cols))
  return dr + dc === 1
}

/** Both gems in their new places. */
export function swapped(board: Board, a: number, b: number): Board {
  const next = board.slice()
  next[a] = board[b]
  next[b] = board[a]
  return next
}

/**
 * Every run of three or more of the same gem, across and down, as its own group.
 *
 * They are kept as separate groups rather than one lump of squares because the length of the run is what decides
 * whether a charged gem is made, and a cross made of a four and a three should make one.
 */
export function matchGroups(board: Board, rows: number, cols: number): number[][] {
  const groups: number[][] = []
  const scan = (cells: number[]): void => {
    let run: number[] = []
    for (const index of cells) {
      const kind = board[index]?.kind ?? 0
      const last = run.length ? board[run[0]].kind : 0
      if (kind && kind === last) run.push(index)
      else {
        if (run.length >= 3) groups.push(run)
        run = kind ? [index] : []
      }
    }
    if (run.length >= 3) groups.push(run)
  }
  for (let r = 0; r < rows; r++) scan(Array.from({ length: cols }, (_, c) => r * cols + c))
  for (let c = 0; c < cols; c++) scan(Array.from({ length: rows }, (_, r) => r * cols + c))
  return groups
}

export const hasMatch = (board: Board, rows: number, cols: number): boolean => matchGroups(board, rows, cols).length > 0

/** Every swap of two neighbours that would make a match. */
export function movesAvailable(board: Board, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c
      for (const other of [c + 1 < cols ? index + 1 : -1, r + 1 < rows ? index + cols : -1]) {
        if (other < 0) continue
        if (board[index].kind === board[other].kind && !board[index].charged && !board[other].charged) continue
        if (hasMatch(swapped(board, index, other), rows, cols)) out.push([index, other])
      }
    }
  return out
}

export const hasMove = (board: Board, rows: number, cols: number): boolean => movesAvailable(board, rows, cols).length > 0

/**
 * Which squares a clear really takes.
 *
 * A charged gem inside the clear brings its whole row and column, and a charged gem caught by that brings its own,
 * which is where the big chains come from.
 */
export function clearWith(board: Board, rows: number, cols: number, seeds: Iterable<number>): Set<number> {
  const cleared = new Set<number>()
  const queue = [...seeds]
  while (queue.length) {
    const index = queue.pop()!
    if (cleared.has(index) || !board[index]) continue
    cleared.add(index)
    if (!board[index].charged) continue
    const r = Math.floor(index / cols)
    const c = index % cols
    for (let i = 0; i < cols; i++) if (!cleared.has(r * cols + i)) queue.push(r * cols + i)
    for (let i = 0; i < rows; i++) if (!cleared.has(i * cols + c)) queue.push(i * cols + c)
  }
  return cleared
}

export interface Collapse {
  board: Board
  /** For each square, how many rows the gem now sitting there moved down. New gems come in from above the board. */
  fell: number[]
}

/** Clears those squares, lets everything above them fall, and brings new gems in at the top. */
export function collapse(board: Board, rows: number, cols: number, cleared: Set<number>, kinds: number, random: () => number = Math.random): Collapse {
  const next: Board = Array.from({ length: rows * cols }, () => ({ kind: 0, charged: false }))
  const fell = Array<number>(rows * cols).fill(0)
  for (let c = 0; c < cols; c++) {
    const survivors: { gem: Gem; row: number }[] = []
    for (let r = 0; r < rows; r++) {
      const index = r * cols + c
      if (!cleared.has(index)) survivors.push({ gem: board[index], row: r })
    }
    const fresh = rows - survivors.length
    for (let r = rows - 1, s = survivors.length - 1; r >= 0; r--, s--) {
      const index = r * cols + c
      if (s >= 0) {
        next[index] = survivors[s].gem
        fell[index] = r - survivors[s].row
      } else {
        next[index] = { kind: 1 + Math.floor(random() * kinds), charged: false }
        fell[index] = fresh
      }
    }
  }
  return { board: next, fell }
}

/**
 * A fresh board with no match already on it and at least one swap worth making.
 *
 * Each gem is picked from the kinds that would not finish a run of three with the two gems to its left or the two
 * above, which is why no match can be there to begin with. If the finished board happens to have no legal swap it is
 * dealt again.
 */
export function dealBoard(rows: number, cols: number, kinds: number, random: () => number = Math.random): Board {
  for (let attempt = 0; attempt < 60; attempt++) {
    const board: Board = Array.from({ length: rows * cols }, () => ({ kind: 0, charged: false }))
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const banned = new Set<number>()
        if (c >= 2 && board[r * cols + c - 1].kind === board[r * cols + c - 2].kind) banned.add(board[r * cols + c - 1].kind)
        if (r >= 2 && board[(r - 1) * cols + c].kind === board[(r - 2) * cols + c].kind) banned.add(board[(r - 1) * cols + c].kind)
        const choices: number[] = []
        for (let kind = 1; kind <= kinds; kind++) if (!banned.has(kind)) choices.push(kind)
        board[r * cols + c] = { kind: choices[Math.floor(random() * choices.length)], charged: false }
      }
    if (hasMove(board, rows, cols)) return board
  }
  // Six dozen deals with no swap on any of them has never happened with five kinds or more; one more honest try.
  return dealBoard(rows, cols, Math.max(3, kinds - 1), random)
}

/**
 * The same gems, moved around until there is something to do again.
 *
 * It keeps the gems the board already had rather than dealing new ones, so a shuffle cannot quietly hand the player a
 * better board than they earned.
 */
export function reshuffle(board: Board, rows: number, cols: number, random: () => number = Math.random): Board {
  for (let attempt = 0; attempt < 200; attempt++) {
    const next = board.slice()
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    if (!hasMatch(next, rows, cols) && hasMove(next, rows, cols)) return next
  }
  return dealBoard(rows, cols, Math.max(...board.map((g) => g.kind)), random)
}

/**
 * What a clear is worth.
 *
 * The chain number is what matters: the gems that fall into a clear and happen to match again pay double, then triple.
 * That is the whole game, so the sums say so.
 */
export function chainPoints(cleared: number, chain: number, charged: number): number {
  const step = Math.max(1, chain)
  return (cleared * 10 + charged * 30 + Math.max(0, cleared - 3) * 15) * step
}

/** The score a level asks for before it hands back more swaps. */
export const levelTarget = (level: number): number => 600 + (level - 1) * 450

// ---------------------------------------------------------------- saving one

export interface MatchSave {
  board: Board
  rows: number
  cols: number
  kinds: number
  score: number
  moves: number
  level: number
  difficulty: MatchDifficulty
}

export function isMatchSave(value: unknown): value is MatchSave {
  const save = value as MatchSave
  if (!save || !Number.isInteger(save.rows) || !Number.isInteger(save.cols) || !Number.isInteger(save.kinds)) return false
  if (save.rows < 5 || save.cols < 5 || save.rows > 12 || save.cols > 12 || save.kinds < 3 || save.kinds > 9) return false
  if (!Array.isArray(save.board) || save.board.length !== save.rows * save.cols) return false
  if (!save.board.every((g) => g && Number.isInteger(g.kind) && g.kind >= 1 && g.kind <= save.kinds && typeof g.charged === 'boolean')) return false
  if (!Number.isFinite(save.score) || !Number.isInteger(save.moves) || save.moves < 0) return false
  return ['easy', 'normal', 'hard'].includes(save.difficulty)
}
