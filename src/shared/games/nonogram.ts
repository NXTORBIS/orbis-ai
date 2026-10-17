/**
 * Picture Logic (a nonogram): the clues, a solver that counts answers, and a generator that only hands out a picture
 * its own clues can prove.
 *
 * A nonogram whose numbers allow two different pictures is broken in the cruellest way: the player works perfectly,
 * draws the other picture, and is told they are wrong. So the generator draws a picture, works out the clues, and then
 * asks the solver how many pictures those clues allow. While the answer is more than one it adds a square of ink next
 * to ink that is already there and asks again. Ink only ever goes in, never comes out, so the question is asked a
 * bounded number of times and the picture that comes back has been proved to be the only one.
 *
 * Nothing here touches the screen, so all of it is tested.
 */

/** A picture: width*height squares, row by row. True is filled. */
export type Picture = boolean[]

export interface Nonogram {
  width: number
  height: number
  /** For each row, the lengths of the filled runs, left to right. An empty row is an empty list. */
  rows: number[][]
  /** For each column, the lengths of the filled runs, top to bottom. */
  cols: number[][]
}

/** The run lengths in one line. This is what a clue is. */
export function runsOf(line: boolean[]): number[] {
  const out: number[] = []
  let run = 0
  for (const filled of line) {
    if (filled) run++
    else if (run) {
      out.push(run)
      run = 0
    }
  }
  if (run) out.push(run)
  return out
}

export function cluesOf(picture: Picture, width: number, height: number): Nonogram {
  const rows: number[][] = []
  const cols: number[][] = []
  for (let r = 0; r < height; r++) rows.push(runsOf(Array.from({ length: width }, (_, c) => picture[r * width + c])))
  for (let c = 0; c < width; c++) cols.push(runsOf(Array.from({ length: height }, (_, r) => picture[r * width + c])))
  return { width, height, rows, cols }
}

/** Every line of this width whose runs are exactly this clue. */
export function linesFor(clue: number[], width: number): boolean[][] {
  const out: boolean[][] = []
  const line = Array<boolean>(width).fill(false)
  const place = (run: number, from: number): void => {
    if (run === clue.length) {
      out.push(line.slice())
      return
    }
    const length = clue[run]
    // Everything still to come needs its own room, plus one gap between each pair.
    let tail = 0
    for (let i = run + 1; i < clue.length; i++) tail += clue[i] + 1
    for (let start = from; start + length + tail <= width; start++) {
      for (let i = 0; i < length; i++) line[start + i] = true
      place(run + 1, start + length + 1)
      for (let i = 0; i < length; i++) line[start + i] = false
    }
  }
  place(0, 0)
  return out
}

/**
 * Could a column that looks like this so far still end up matching its clue?
 *
 * `done` is how many of its runs are finished, `open` is the run still growing at the bottom edge of what has been
 * placed, and `left` is how many squares of the column have not been decided yet. Getting this wrong in the safe
 * direction only costs speed; getting it wrong in the other direction would throw away real answers, which is why the
 * test drives it against a plain brute-force count.
 */
function couldStillFit(clue: number[], done: number, open: number, left: number): boolean {
  if (done > clue.length) return false
  let needed = 0
  let next = done
  if (open > 0) {
    if (done >= clue.length || open > clue[done]) return false
    needed += clue[done] - open
    next = done + 1
  }
  for (let i = next; i < clue.length; i++) needed += clue[i] + (i > next || open > 0 || i > done ? 1 : 0)
  return needed <= left
}

export interface PictureCount {
  count: number
  pictures: Picture[]
  /** True when the search ran out of room before it finished, so the count cannot be trusted. */
  gaveUp: boolean
}

/**
 * How many pictures these clues allow, up to `limit`.
 *
 * It goes row by row, trying only the lines that match each row's own clue, and after every row it asks each column
 * whether what it now holds could still become its clue. That column check is what keeps this fast enough to run
 * inside the generator.
 */
export function countPictures(puzzle: Nonogram, limit = 2, budget = 400000): PictureCount {
  const { width, height, rows, cols } = puzzle
  const options = rows.map((clue) => linesFor(clue, width))
  if (options.some((o) => o.length === 0)) return { count: 0, pictures: [], gaveUp: false }
  const picture: Picture = Array(width * height).fill(false)
  const pictures: Picture[] = []
  let nodes = 0
  let gaveUp = false

  // Per row placed, each column's finished runs and its still-growing run, so backtracking is a pop rather than a rescan.
  const done: number[][] = [Array(width).fill(0)]
  const open: number[][] = [Array(width).fill(0)]

  const place = (row: number): void => {
    if (gaveUp || pictures.length >= limit) return
    if (row === height) {
      pictures.push(picture.slice())
      return
    }
    for (const line of options[row]) {
      if (++nodes > budget) {
        gaveUp = true
        return
      }
      const prevDone = done[row]
      const prevOpen = open[row]
      const nextDone = prevDone.slice()
      const nextOpen = prevOpen.slice()
      let ok = true
      for (let c = 0; c < width && ok; c++) {
        if (line[c]) nextOpen[c]++
        else if (nextOpen[c] > 0) {
          if (nextOpen[c] !== (cols[c][nextDone[c]] ?? -1)) ok = false
          else {
            nextDone[c]++
            nextOpen[c] = 0
          }
        }
        if (!ok) break
        const left = height - row - 1
        if (left === 0) {
          // Last row: the column has to be exactly its clue, with nothing left over.
          const finished = nextOpen[c] > 0 ? nextOpen[c] === (cols[c][nextDone[c]] ?? -1) && nextDone[c] + 1 === cols[c].length : nextDone[c] === cols[c].length
          if (!finished) ok = false
        } else if (!couldStillFit(cols[c], nextDone[c], nextOpen[c], left)) ok = false
      }
      if (!ok) continue
      for (let c = 0; c < width; c++) picture[row * width + c] = line[c]
      done[row + 1] = nextDone
      open[row + 1] = nextOpen
      place(row + 1)
      for (let c = 0; c < width; c++) picture[row * width + c] = false
      if (gaveUp || pictures.length >= limit) return
    }
  }

  place(0)
  return { count: pictures.length, pictures, gaveUp }
}

// ---------------------------------------------------------------- making one

export type NonogramDifficulty = 'easy' | 'normal' | 'hard'

export const NONOGRAM_LEVELS: Record<NonogramDifficulty, { size: number; ink: number }> = {
  easy: { size: 5, ink: 0.5 },
  normal: { size: 8, ink: 0.5 },
  hard: { size: 10, ink: 0.5 }
}

/**
 * A clumpy picture rather than noise.
 *
 * Random squares on their own make a picture nobody can read and clues that are nothing but ones. Turning each square
 * on when most of its neighbours are on pulls the noise into blobs that look like something and give long runs to work
 * with. It also drags the amount of ink away from the middle, so a roll that comes out nearly empty or nearly solid is
 * thrown away and rolled again -- neither of those is a puzzle worth looking at.
 */
function roughPicture(width: number, height: number, ink: number, random: () => number): Picture {
  const roll = (): Picture => {
    const start: Picture = Array.from({ length: width * height }, () => random() < ink)
    const next = start.slice()
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        let around = 0
        let seen = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue
            const nr = r + dr
            const nc = c + dc
            if (nr < 0 || nc < 0 || nr >= height || nc >= width) continue
            seen++
            if (start[nr * width + nc]) around++
          }
        next[r * width + c] = around > seen / 2 ? true : around < seen / 2 ? false : start[r * width + c]
      }
    return next
  }
  let picture = roll()
  for (let attempt = 0; attempt < 10; attempt++) {
    const filled = picture.filter(Boolean).length / (width * height)
    if (filled >= 0.3 && filled <= 0.7) break
    picture = roll()
  }
  // A picture with nothing in it is not a puzzle.
  if (!picture.includes(true)) picture[Math.floor(random() * picture.length)] = true
  return picture
}

const inkNeighbours = (picture: Picture, width: number, height: number): number[] => {
  const out: number[] = []
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      if (picture[i]) continue
      const touching = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([nr, nc]) => nr >= 0 && nc >= 0 && nr < height && nc < width && picture[nr * width + nc])
      if (touching) out.push(i)
    }
  return out
}

export interface NonogramPuzzle {
  puzzle: Nonogram
  picture: Picture
  difficulty: NonogramDifficulty
  /** How many times ink had to be added before the clues allowed only one picture. */
  nudges: number
}

/**
 * A puzzle whose clues allow exactly one picture.
 *
 * Each time the clues turn out to allow more than one, one more square of ink goes in beside ink that is already there
 * and the clues are worked out again. Ink never comes out, so this cannot go round for ever: in the worst case the
 * picture fills up, and a full picture has only one reading.
 */
export function generateNonogram(difficulty: NonogramDifficulty, random: () => number = Math.random): NonogramPuzzle {
  const { size, ink } = NONOGRAM_LEVELS[difficulty]
  const picture = roughPicture(size, size, ink, random)
  for (let nudges = 0; nudges <= size * size; nudges++) {
    const puzzle = cluesOf(picture, size, size)
    const found = countPictures(puzzle, 2)
    if (found.count === 1 && !found.gaveUp) return { puzzle, picture, difficulty, nudges }
    const open = inkNeighbours(picture, size, size)
    const spare = open.length ? open : picture.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0)
    if (!spare.length) break
    picture[spare[Math.floor(random() * spare.length)]] = true
  }
  // Everything is filled in, which has one reading and nothing else.
  const full: Picture = Array(size * size).fill(true)
  return { puzzle: cluesOf(full, size, size), picture: full, difficulty, nudges: size * size }
}

/** How much of the picture is ink: what the board tells you before you start. */
export const inkCount = (picture: Picture): number => picture.filter(Boolean).length

/** True when every filled square of the picture is filled in and nothing else is. */
export const pictureDone = (marks: number[], picture: Picture): boolean => picture.every((filled, i) => (marks[i] === 1) === filled)

/** A line is finished when what is filled in matches its clue, which is how a clue gets dimmed on screen. */
export const lineSolved = (marks: number[], indexes: number[], clue: number[]): boolean => {
  const line = indexes.map((i) => marks[i] === 1)
  const runs = runsOf(line)
  return runs.length === clue.length && runs.every((r, i) => r === clue[i])
}

export function nonogramScore(size: number, seconds: number, wrong: number): number {
  const base = size * size * 14
  return Math.max(50, base - Math.round(Math.max(0, seconds) * 0.7) - Math.max(0, wrong) * 30)
}

// ---------------------------------------------------------------- saving one

export interface NonogramSave {
  width: number
  height: number
  picture: boolean[]
  marks: number[]
  seconds: number
  wrong: number
  difficulty: NonogramDifficulty
}

/** A saved picture is only loaded back when its own size agrees with itself. */
export function isNonogramSave(value: unknown): value is NonogramSave {
  const save = value as NonogramSave
  if (!save || !Number.isInteger(save.width) || !Number.isInteger(save.height)) return false
  if (save.width < 3 || save.height < 3 || save.width > 20 || save.height > 20) return false
  const cells = save.width * save.height
  if (!Array.isArray(save.picture) || save.picture.length !== cells || !save.picture.every((v) => typeof v === 'boolean')) return false
  if (!Array.isArray(save.marks) || save.marks.length !== cells || !save.marks.every((v) => v === 0 || v === 1 || v === 2)) return false
  return ['easy', 'normal', 'hard'].includes(save.difficulty)
}
