import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { areNeighbours, chainPoints, clearWith, collapse, dealBoard, hasMatch, hasMove, isMatchSave, MATCH_LEVELS, matchGroups, levelTarget, movesAvailable, reshuffle, swapped, type Board } from './matchThree.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

/** A board written out as digits, one row per line, so a test can say what it means. */
const read = (text: string): { board: Board; rows: number; cols: number } => {
  const lines = text.trim().split('\n').map((line) => line.trim())
  const board: Board = []
  for (const line of lines) for (const ch of line) board.push({ kind: Number(ch), charged: false })
  return { board, rows: lines.length, cols: lines[0].length }
}

describe('what counts as a match', () => {
  it('finds runs of three and more, across and down, and leaves pairs alone', () => {
    const { board, rows, cols } = read(`
      112
      234
      123
    `)
    assert.equal(hasMatch(board, rows, cols), false)
    const across = read(`
      111
      234
      123
    `)
    assert.deepEqual(matchGroups(across.board, across.rows, across.cols), [[0, 1, 2]])
    const down = read(`
      123
      453
      673
    `)
    assert.deepEqual(matchGroups(down.board, down.rows, down.cols), [[2, 5, 8]])
  })

  it('counts a cross as both of its runs, so the longer one still makes a charged gem', () => {
    const { board, rows, cols } = read(`
      2122
      1111
      2122
    `)
    const groups = matchGroups(board, rows, cols)
    assert.equal(groups.length, 2)
    assert.deepEqual(groups.find((g) => g.length === 4), [4, 5, 6, 7])
    assert.deepEqual(groups.find((g) => g.length === 3), [1, 5, 9])
  })

  it('knows which swaps are worth making, and which squares are neighbours at all', () => {
    const { board, rows, cols } = read(`
      121
      211
      331
    `)
    assert.equal(areNeighbours(0, 1, cols), true)
    assert.equal(areNeighbours(0, 3, cols), true)
    assert.equal(areNeighbours(0, 4, cols), false)
    assert.equal(areNeighbours(2, 3, cols), false)
    const moves = movesAvailable(board, rows, cols)
    assert.ok(moves.length > 0)
    for (const [a, b] of moves) {
      assert.equal(areNeighbours(a, b, cols), true)
      assert.equal(hasMatch(swapped(board, a, b), rows, cols), true)
    }
    /*
     * A board with nothing to do says so.
     *
     * Every row and every column of this one holds each gem exactly once, and no single swap can put three of
     * anything in a line -- a swap along a row only reorders four different gems, and a swap down a column can at
     * best make a pair. A checkerboard looks dead and is not: swapping two neighbours of a checkerboard lines up
     * three straight away.
     */
    const dead = read(`
      1234
      2341
      3412
      4123
    `)
    assert.equal(hasMatch(dead.board, dead.rows, dead.cols), false)
    assert.equal(hasMove(dead.board, dead.rows, dead.cols), false)
  })
})

describe('dealing a board', () => {
  /*
   * Two promises, and they are the two that decide whether this is a game or an annoyance. A board dealt with a match
   * already on it steals the player's first move -- gems pop before they touch anything. A board with no possible
   * swap leaves them staring at it, trying swaps that do nothing, blaming themselves.
   */
  it('never deals a match, and never deals a board with nothing to do', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const level = MATCH_LEVELS[difficulty]
      for (let seed = 1; seed <= 40; seed++) {
        const board = dealBoard(level.rows, level.cols, level.kinds, seeded(seed * 2654435))
        assert.equal(board.length, level.rows * level.cols)
        assert.ok(board.every((g) => g.kind >= 1 && g.kind <= level.kinds && !g.charged))
        assert.equal(hasMatch(board, level.rows, level.cols), false, `${difficulty} seed ${seed} was dealt with a match on it`)
        assert.equal(hasMove(board, level.rows, level.cols), true, `${difficulty} seed ${seed} was dealt with no swap to make`)
      }
    }
  })

  it('shuffles the gems it already has rather than dealing better ones', () => {
    const dead = read(`
      1234
      2341
      3412
      4123
    `)
    const next = reshuffle(dead.board, dead.rows, dead.cols, seeded(4))
    const count = (board: Board): string => board.map((g) => g.kind).sort().join('')
    assert.equal(count(next), count(dead.board))
    assert.equal(hasMatch(next, dead.rows, dead.cols), false)
    assert.equal(hasMove(next, dead.rows, dead.cols), true)
  })

  it('gives a harder game more kinds of gem and fewer swaps', () => {
    assert.ok(MATCH_LEVELS.hard.kinds > MATCH_LEVELS.easy.kinds)
    assert.ok(MATCH_LEVELS.hard.moves < MATCH_LEVELS.easy.moves)
  })
})

describe('charged gems', () => {
  it('take their whole row and column, and set off any charged gem they reach', () => {
    const { board, rows, cols } = read(`
      1111
      2222
      3333
      4444
    `)
    board[5] = { kind: 2, charged: true }
    const cleared = clearWith(board, rows, cols, [5])
    // Its own row and its own column, and nothing else.
    assert.deepEqual([...cleared].sort((a, b) => a - b), [1, 4, 5, 6, 7, 9, 13])
    // A second charged gem caught in that sweep brings its own row and column too.
    board[13] = { kind: 4, charged: true }
    const chain = clearWith(board, rows, cols, [5])
    assert.deepEqual([...chain].sort((a, b) => a - b), [1, 4, 5, 6, 7, 9, 12, 13, 14, 15])
  })
})

describe('what falls', () => {
  it('drops the gems above a clear and brings new ones in at the top', () => {
    const { board, rows, cols } = read(`
      123
      456
      789
    `)
    const { board: next, fell } = collapse(board, rows, cols, new Set([6, 7, 8]), 5, seeded(9))
    // The bottom row is what used to be the middle row, and it moved one place down.
    assert.deepEqual([next[6].kind, next[7].kind, next[8].kind], [4, 5, 6])
    assert.deepEqual([fell[6], fell[7], fell[8]], [1, 1, 1])
    assert.deepEqual([next[3].kind, next[4].kind, next[5].kind], [1, 2, 3])
    // The top row is new, and came in from above the board.
    assert.ok([next[0], next[1], next[2]].every((g) => g.kind >= 1 && g.kind <= 5 && !g.charged))
    assert.deepEqual([fell[0], fell[1], fell[2]], [1, 1, 1])
  })

  it('keeps every gem that was not cleared, wherever the gaps were', () => {
    const { board, rows, cols } = read(`
      1234
      5678
      9123
      4567
    `)
    const cleared = new Set([0, 9, 10, 15])
    const { board: next } = collapse(board, rows, cols, cleared, 9, seeded(3))
    assert.equal(next.length, board.length)
    for (let c = 0; c < cols; c++) {
      const before: number[] = []
      for (let r = 0; r < rows; r++) if (!cleared.has(r * cols + c)) before.push(board[r * cols + c].kind)
      const after: number[] = []
      for (let r = 0; r < rows; r++) after.push(next[r * cols + c].kind)
      // The survivors are still in the same order, sitting at the bottom of their column.
      assert.deepEqual(after.slice(rows - before.length), before)
    }
  })
})

describe('a whole game played out', () => {
  /*
   * The pieces above, put together the way the game puts them together: swap, clear what matches, let it fall, and
   * look again -- over and over until nothing matches.
   *
   * What this is really watching for is a chain that never settles, and a board that comes to rest with a match
   * still sitting on it. Either one would be a board that pops on its own while the player is looking at it, and
   * neither can be seen by testing the parts one at a time.
   */
  it('always comes to rest, with no match left on the board and every square filled', () => {
    const rows = 8
    const cols = 8
    const kinds = 6
    for (let seed = 1; seed <= 15; seed++) {
      const random = seeded(seed * 7)
      let board = dealBoard(rows, cols, kinds, random)
      for (let move = 0; move < 30; move++) {
        const options = movesAvailable(board, rows, cols)
        if (!options.length) {
          board = reshuffle(board, rows, cols, random)
          continue
        }
        const [a, b] = options[Math.floor(random() * options.length)]
        board = swapped(board, a, b)
        for (let chain = 1; ; chain++) {
          const groups = matchGroups(board, rows, cols)
          if (!groups.length) break
          assert.ok(chain < 80, `seed ${seed} move ${move}: a chain that will not settle`)
          const seeds = new Set<number>()
          for (const group of groups) for (const index of group) seeds.add(index)
          const cleared = clearWith(board, rows, cols, seeds)
          for (const group of groups) {
            if (group.length < 4) continue
            const spot = group[Math.floor(group.length / 2)]
            cleared.delete(spot)
            board[spot] = { kind: board[spot].kind, charged: true }
          }
          assert.ok(cleared.size > 0, 'something matched but nothing was cleared')
          board = collapse(board, rows, cols, cleared, kinds, random).board
        }
        assert.equal(hasMatch(board, rows, cols), false, `seed ${seed} move ${move} came to rest with a match on it`)
        assert.equal(board.length, rows * cols)
        assert.ok(board.every((gem) => gem.kind >= 1 && gem.kind <= kinds), 'an empty square was left behind')
      }
    }
  })
})

describe('the sums', () => {
  it('pays far more for a chain than for the same gems cleared one at a time', () => {
    assert.equal(chainPoints(3, 1, 0), 30)
    assert.ok(chainPoints(3, 3, 0) > chainPoints(3, 1, 0) * 2)
    assert.ok(chainPoints(5, 1, 0) > chainPoints(3, 1, 0) + 20)
    assert.ok(chainPoints(3, 1, 1) > chainPoints(3, 1, 0))
    // A chain number below one is still one clear, not nothing.
    assert.equal(chainPoints(3, 0, 0), 30)
  })

  it('asks more of each level than the last', () => {
    assert.ok(levelTarget(2) > levelTarget(1))
    assert.ok(levelTarget(5) - levelTarget(4) > 0)
  })
})

describe('a saved board', () => {
  const level = MATCH_LEVELS.normal
  const save = { board: dealBoard(level.rows, level.cols, level.kinds, seeded(8)), rows: level.rows, cols: level.cols, kinds: level.kinds, score: 120, moves: 9, level: 2, difficulty: 'normal' as const }

  it('comes back when it is whole', () => {
    assert.ok(isMatchSave(save))
  })

  it('is refused when it is not', () => {
    assert.equal(isMatchSave(null), false)
    assert.equal(isMatchSave({ ...save, board: save.board.slice(1) }), false)
    assert.equal(isMatchSave({ ...save, kinds: 3 }), false)
    assert.equal(isMatchSave({ ...save, moves: -1 }), false)
    assert.equal(isMatchSave({ ...save, difficulty: 'medium' }), false)
  })
})
