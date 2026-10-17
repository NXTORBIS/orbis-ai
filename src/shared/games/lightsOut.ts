/**
 * Lights Out, kept pure: pressing a light, whether the board is clear, making a board, and working out the shortest
 * way to clear one.
 *
 * Two things about this puzzle decide how the file is written. Pressing a light twice undoes it, and the order you
 * press in makes no difference -- so a board is really just the set of lights you pressed to make it, and the boards
 * you can clear are exactly the boards that were made by pressing. That is why `generateRound` starts from a clear
 * board and presses: a board scattered at random is unsolvable about three times in four on five by five, and the
 * player has no way to tell that from being stuck.
 *
 * `solveLights` is the second part. Each light is one equation over "flipped an even or an odd number of times", so
 * the whole board is a system of those, solved the ordinary way. Several boards have more than one answer -- a four
 * by four has sixteen -- so every answer is tried and the shortest one wins. That shortest answer is the par the
 * score is measured against, and the hint comes out of it too.
 */

export interface LightsRound {
  size: number
  /** Row by row. True is on. */
  lights: boolean[]
  /** The fewest presses that clear this board. */
  par: number
}

/** Pressing a light flips it and the four beside it. */
export function pressAt(lights: readonly boolean[], size: number, index: number): boolean[] {
  const next = [...lights]
  const x = index % size
  const y = Math.floor(index / size)
  const flip = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return
    next[cy * size + cx] = !next[cy * size + cx]
  }
  flip(x, y)
  flip(x - 1, y)
  flip(x + 1, y)
  flip(x, y - 1)
  flip(x, y + 1)
  return next
}

export const allOff = (lights: readonly boolean[]): boolean => lights.every((on) => !on)

/** Pressing every light in a list, in any order, gives the same board. */
export const pressAll = (lights: readonly boolean[], size: number, indexes: readonly number[]): boolean[] => indexes.reduce<boolean[]>((board, index) => pressAt(board, size, index), [...lights])

/**
 * The shortest set of presses that clears the board, or null when nothing clears it.
 *
 * Null never happens for a board this game made, and the test proves that over hundreds of boards. It can happen for
 * a board somebody hands in from a saved file, which is why the answer is allowed to be null at all.
 */
export function solveLights(lights: readonly boolean[], size: number): number[] | null {
  const n = size * size
  // One row per light: which presses flip it, and whether it starts on.
  const rows: number[][] = []
  for (let light = 0; light < n; light++) {
    const row = new Array<number>(n + 1).fill(0)
    const x = light % size
    const y = Math.floor(light / size)
    for (const [cx, cy] of [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue
      row[cy * size + cx] = 1
    }
    row[n] = lights[light] ? 1 : 0
    rows.push(row)
  }

  // Ordinary elimination, except that adding is "either but not both".
  const pivotOf: number[] = []
  let pivotRow = 0
  for (let column = 0; column < n && pivotRow < n; column++) {
    const found = rows.findIndex((row, i) => i >= pivotRow && row[column] === 1)
    if (found < 0) continue
    ;[rows[pivotRow], rows[found]] = [rows[found], rows[pivotRow]]
    for (let i = 0; i < n; i++) {
      if (i === pivotRow || rows[i][column] === 0) continue
      for (let c = column; c <= n; c++) rows[i][c] ^= rows[pivotRow][c]
    }
    pivotOf[pivotRow] = column
    pivotRow++
  }
  // A row that says "nothing flips this light, and it is on" means the board cannot be cleared.
  for (let i = pivotRow; i < n; i++) if (rows[i][n] === 1) return null

  const pivotColumns = new Set(pivotOf.slice(0, pivotRow))
  const free: number[] = []
  for (let c = 0; c < n; c++) if (!pivotColumns.has(c)) free.push(c)

  const build = (freeValues: number[]): number[] => {
    const x = new Array<number>(n).fill(0)
    free.forEach((column, i) => (x[column] = freeValues[i]))
    for (let i = pivotRow - 1; i >= 0; i--) {
      const column = pivotOf[i]
      let value = rows[i][n]
      for (let c = column + 1; c < n; c++) if (rows[i][c]) value ^= x[c]
      x[column] = value
    }
    return x
  }

  // Every answer is tried when there are few enough of them, so the one that comes back is the shortest.
  const combinations = free.length <= 12 ? 1 << free.length : 1
  let best: number[] | null = null
  for (let mask = 0; mask < combinations; mask++) {
    const presses = build(free.map((_, i) => (mask >> i) & 1))
      .map((on, index) => (on ? index : -1))
      .filter((index) => index >= 0)
    if (!best || presses.length < best.length) best = presses
  }
  return best
}

/**
 * A board made by pressing, which is the only way to make one that is certainly clearable. The presses are chosen
 * from different lights, and a set that happens to leave the board clear is thrown away and drawn again.
 */
export function generateRound(size: number, scramble: number, random: () => number = Math.random): LightsRound {
  const n = size * size
  for (let attempt = 0; attempt < 50; attempt++) {
    const order = Array.from({ length: n }, (_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const lights = pressAll(new Array<boolean>(n).fill(false), size, order.slice(0, Math.min(scramble, n)))
    if (allOff(lights)) continue
    const answer = solveLights(lights, size)
    if (!answer) continue
    return { size, lights, par: answer.length }
  }
  // Pressing one light can never clear a board, so this is a board, not a failure.
  const lights = pressAt(new Array<boolean>(n).fill(false), size, 0)
  return { size, lights, par: solveLights(lights, size)?.length ?? 1 }
}

/** The rounds in a run: the boards grow, and so does how scrambled they are. */
export function roundPlan(difficulty: 'easy' | 'normal' | 'hard'): { size: number; scramble: number }[] {
  if (difficulty === 'easy') return [{ size: 3, scramble: 3 }, { size: 3, scramble: 5 }, { size: 4, scramble: 4 }, { size: 4, scramble: 6 }, { size: 4, scramble: 9 }, { size: 5, scramble: 6 }]
  if (difficulty === 'hard') return [{ size: 5, scramble: 8 }, { size: 5, scramble: 14 }, { size: 6, scramble: 10 }, { size: 6, scramble: 16 }, { size: 6, scramble: 22 }, { size: 7, scramble: 20 }]
  return [{ size: 4, scramble: 5 }, { size: 4, scramble: 8 }, { size: 5, scramble: 7 }, { size: 5, scramble: 11 }, { size: 5, scramble: 16 }, { size: 6, scramble: 14 }]
}

/** What clearing a board is worth: the shortest answer pays most, every extra press costs, and a hint costs more. */
export const roundScore = (par: number, presses: number, hints: number): number => Math.max(20, Math.round(100 + par * 20 - Math.max(0, presses - par) * 8 - hints * 25))

export interface LightsSave {
  round: number
  lights: boolean[]
  size: number
  par: number
  presses: number
  hints: number
  score: number
}

export function isLightsSave(value: unknown): value is LightsSave {
  const s = value as LightsSave
  return Boolean(
    s &&
      typeof s === 'object' &&
      Number.isInteger(s.round) &&
      s.round >= 0 &&
      s.round < 24 &&
      Number.isInteger(s.size) &&
      s.size >= 3 &&
      s.size <= 8 &&
      Array.isArray(s.lights) &&
      s.lights.length === s.size * s.size &&
      s.lights.every((on) => typeof on === 'boolean') &&
      Number.isFinite(s.presses) &&
      Number.isFinite(s.score)
  )
}
