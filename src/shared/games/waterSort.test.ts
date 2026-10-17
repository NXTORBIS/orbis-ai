import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canPour, generateTubes, isSortSave, isSorted, isTubeDone, legalMoves, pour, SORT_LEVELS, solveTubes, sortScore, topRun, TUBE_CAPACITY, tubesKey, type Tubes } from './waterSort.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

describe('pouring', () => {
  it('reads the top run off a tube', () => {
    assert.deepEqual(topRun([]), { colour: 0, length: 0 })
    assert.deepEqual(topRun([1, 2, 2]), { colour: 2, length: 2 })
    assert.deepEqual(topRun([3, 3, 3, 3]), { colour: 3, length: 4 })
  })

  it('allows a pour onto the same colour or into an empty tube, and nothing else', () => {
    const tubes: Tubes = [[1, 1], [1], [2], [], [3, 3, 3, 3]]
    assert.equal(canPour(tubes, 0, 1), true)
    assert.equal(canPour(tubes, 0, 3), true)
    assert.equal(canPour(tubes, 0, 2), false, 'a different colour on top')
    assert.equal(canPour(tubes, 3, 0), false, 'an empty tube has nothing to pour')
    assert.equal(canPour(tubes, 0, 0), false, 'a tube cannot pour into itself')
    assert.equal(canPour(tubes, 4, 3), true)
    assert.equal(canPour(tubes, 0, 4), false, 'a full tube has no room')
  })

  it('moves the whole top run, or as much of it as fits, and loses nothing', () => {
    // Tubes are written bottom layer first, so this one has two layers of colour 2 under one of colour 1.
    const tubes: Tubes = [[1, 1, 1], [2, 2, 1]]
    const after = pour(tubes, 0, 1)!
    assert.deepEqual(after, [[1, 1], [2, 2, 1, 1]], 'only the one layer that fits moved')
    assert.deepEqual(tubes, [[1, 1, 1], [2, 2, 1]], 'the tubes it was given are untouched')
    assert.deepEqual(pour(tubes, 1, 0)!, [[1, 1, 1, 1], [2, 2]], 'and the other way, which fills the first tube')
    assert.equal(pour([[1, 1], [2, 2]], 0, 1), null, 'a different colour on top')
    assert.deepEqual(pour([[2, 2], []], 0, 1)!, [[], [2, 2]])
  })

  it('knows when a tube and a whole puzzle are done', () => {
    assert.equal(isTubeDone([]), true)
    assert.equal(isTubeDone([1, 1, 1, 1]), true)
    assert.equal(isTubeDone([1, 1, 1]), false, 'one colour but not a full tube')
    assert.equal(isTubeDone([1, 1, 1, 2]), false)
    assert.equal(isSorted([[1, 1, 1, 1], [2, 2, 2, 2], []]), true)
    assert.equal(isSorted([[1, 1, 1, 2], [2, 2, 2, 1], []]), false)
  })

  it('leaves out the pour that changes nothing, and treats tubes as a set', () => {
    // Tipping a tube that already holds one colour into an empty one only moves which tube it is in.
    const moves = legalMoves([[1, 1], [], [2, 2, 2, 2]])
    assert.deepEqual(moves, [])
    assert.ok(legalMoves([[1, 1], [1], []]).length > 0)
    assert.equal(tubesKey([[1, 1], [2], []]), tubesKey([[2], [], [1, 1]]))
    assert.notEqual(tubesKey([[1, 1], [2]]), tubesKey([[1], [2, 1]]))
  })
})

describe('making a puzzle', () => {
  /*
   * Every puzzle is poured backwards from the finished state, and the generator hands back the moves that undo the
   * mess it made. This replays those moves through the ordinary pouring rules -- the same `pour` the player's clicks
   * go through, which refuses anything illegal by returning nothing -- and insists the tubes come out sorted.
   *
   * That is a stronger promise than "a solver found a way": it says the way was there before the puzzle was.
   */
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`can always be finished on ${difficulty}, by the moves it was made from`, () => {
      const level = SORT_LEVELS[difficulty]
      for (let seed = 1; seed <= 12; seed++) {
        const made = generateTubes(difficulty, seeded(seed * 65537))
        assert.equal(made.tubes.length, level.colours + level.spare)
        assert.equal(isSorted(made.tubes), false, `${difficulty} seed ${seed} came out already sorted`)
        // Every colour still has exactly a tube's worth of layers: pouring never makes or loses any.
        for (let colour = 1; colour <= level.colours; colour++) assert.equal(made.tubes.flat().filter((c) => c === colour).length, TUBE_CAPACITY)
        let state = made.tubes
        for (const [from, to] of made.solution) {
          const next = pour(state, from, to)
          assert.ok(next, `${difficulty} seed ${seed}: pouring ${from} into ${to} is not allowed`)
          state = next
        }
        assert.equal(isSorted(state), true, `${difficulty} seed ${seed} is not sorted at the end of its own moves`)
      }
    })
  }

  it('gives a harder puzzle more colours and a longer scramble', () => {
    assert.ok(SORT_LEVELS.hard.colours > SORT_LEVELS.normal.colours)
    assert.ok(SORT_LEVELS.hard.scramble > SORT_LEVELS.easy.scramble)
  })
})

describe('the solver', () => {
  it('finds its own way through a puzzle it was not told how to make', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const made = generateTubes('easy', seeded(seed * 7901))
      const found = solveTubes(made.tubes)
      assert.ok(found.moves, `easy seed ${seed} beat the solver`)
      assert.equal(found.gaveUp, false)
      let state = made.tubes
      for (const [from, to] of found.moves) {
        const next = pour(state, from, to)
        assert.ok(next, 'the solver named a pour that is not allowed')
        state = next
      }
      assert.equal(isSorted(state), true)
    }
  })

  it('says there is no way through when there is none', () => {
    // Two full tubes, no room anywhere, nothing to pour.
    const stuck: Tubes = [[1, 2, 1, 2], [2, 1, 2, 1]]
    const found = solveTubes(stuck)
    assert.equal(found.moves, null)
    assert.equal(found.gaveUp, false)
  })

  it('gives up rather than hanging, and says that is what it did', () => {
    const made = generateTubes('hard', seeded(5))
    // Four arrangements is nowhere near enough for a puzzle this size, and it must say so rather than claim there is
    // no way through -- giving up and proving there is nothing to find are different answers.
    const found = solveTubes(made.tubes, TUBE_CAPACITY, 4)
    assert.equal(found.moves, null)
    assert.equal(found.gaveUp, true)
  })
})

describe('the sums', () => {
  it('pays for the colours sorted and charges for fumbling, time, undoing and hints', () => {
    assert.ok(sortScore(8, 30, 60, 0) > sortScore(5, 30, 60, 0))
    assert.ok(sortScore(8, 30, 60, 0) > sortScore(8, 90, 60, 0))
    assert.ok(sortScore(8, 30, 60, 0) > sortScore(8, 30, 600, 0))
    assert.ok(sortScore(8, 30, 60, 0) > sortScore(8, 30, 60, 5))
    assert.ok(sortScore(8, 30, 60, 0, 0) > sortScore(8, 30, 60, 0, 2))
    assert.equal(sortScore(5, 9999, 9999, 999), 60)
  })
})

describe('a saved puzzle', () => {
  const save = { tubes: [[1, 1, 1, 1], [2, 2, 2], [2], []], capacity: 4, colours: 2, moves: 3, undos: 0, seconds: 20, difficulty: 'easy' as const }

  it('comes back when every colour is still all there', () => {
    assert.ok(isSortSave(save))
  })

  it('is refused when a colour has gone missing or multiplied', () => {
    assert.equal(isSortSave(null), false)
    assert.equal(isSortSave({ ...save, tubes: [[1, 1, 1, 1], [2, 2, 2], []] }), false, 'a layer short')
    assert.equal(isSortSave({ ...save, tubes: [[1, 1, 1, 1], [2, 2, 2, 2], [2], []] }), false, 'a layer too many')
    assert.equal(isSortSave({ ...save, tubes: [[1, 1, 1, 1, 1], [2, 2, 2], [2], []] }), false, 'a tube over its capacity')
    assert.equal(isSortSave({ ...save, difficulty: 'tricky' }), false)
  })
})
