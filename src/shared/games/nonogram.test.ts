import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cluesOf, countPictures, generateNonogram, inkCount, isNonogramSave, lineSolved, linesFor, NONOGRAM_LEVELS, nonogramScore, pictureDone, runsOf, type Picture } from './nonogram.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

describe('clues', () => {
  it('reads the runs out of a line', () => {
    assert.deepEqual(runsOf([]), [])
    assert.deepEqual(runsOf([false, false]), [])
    assert.deepEqual(runsOf([true, true, false, true]), [2, 1])
    assert.deepEqual(runsOf([true, false, true, false, true]), [1, 1, 1])
    assert.deepEqual(runsOf([true, true, true]), [3])
  })

  it('takes them off a picture both ways round', () => {
    // A plus sign in a three by three.
    const picture = [false, true, false, true, true, true, false, true, false]
    const puzzle = cluesOf(picture, 3, 3)
    assert.deepEqual(puzzle.rows, [[1], [3], [1]])
    assert.deepEqual(puzzle.cols, [[1], [3], [1]])
    assert.equal(inkCount(picture), 5)
  })

  it('lists every line a clue allows, and nothing else', () => {
    const lines = linesFor([2], 5)
    assert.equal(lines.length, 4)
    for (const line of lines) assert.deepEqual(runsOf(line), [2])
    assert.equal(linesFor([1, 1], 3).length, 1)
    assert.equal(linesFor([3], 3).length, 1)
    assert.deepEqual(linesFor([], 4), [[false, false, false, false]])
    // A clue that cannot fit has no lines at all, which is how an impossible puzzle is spotted at once.
    assert.deepEqual(linesFor([3, 3], 5), [])
  })
})

describe('counting the pictures a set of clues allows', () => {
  /*
   * The solver is checked against the only thing that cannot be wrong: every four by four picture there is.
   *
   * All 65,536 of them are worked out once, and each one's clues are used as a key. That gives the true number of
   * pictures for any set of four by four clues. The solver then has to agree, which is what proves the pruning --
   * the "could this column still fit its clue" test -- never throws away a real answer. That is the one mistake in
   * here that would be invisible: a solver that misses answers calls an ambiguous puzzle unique and the generator
   * cheerfully ships it.
   */
  const truth = new Map<string, number>()
  for (let bits = 0; bits < 65536; bits++) {
    const picture: Picture = Array.from({ length: 16 }, (_, i) => Boolean(bits & (1 << i)))
    const puzzle = cluesOf(picture, 4, 4)
    const key = JSON.stringify([puzzle.rows, puzzle.cols])
    truth.set(key, (truth.get(key) ?? 0) + 1)
  }

  it('agrees with every four by four picture there is', () => {
    const random = seeded(99)
    for (let trial = 0; trial < 60; trial++) {
      const picture: Picture = Array.from({ length: 16 }, () => random() < 0.5)
      const puzzle = cluesOf(picture, 4, 4)
      const real = truth.get(JSON.stringify([puzzle.rows, puzzle.cols]))!
      const found = countPictures(puzzle, 3)
      assert.equal(found.gaveUp, false)
      assert.equal(found.count, Math.min(3, real), `clues ${JSON.stringify(puzzle.rows)} / ${JSON.stringify(puzzle.cols)}`)
      // Every picture it reports really does carry those clues.
      for (const answer of found.pictures) assert.deepEqual(cluesOf(answer, 4, 4), puzzle)
    }
  })

  it('counts one for a picture only its own clues describe, and more for one that is shared', () => {
    const plus = [false, true, false, true, true, true, false, true, false]
    assert.equal(countPictures(cluesOf(plus, 3, 3), 2).count, 1)
    // The ambiguous shape: two single squares crosswise in two rows and two columns. Filling the other diagonal
    // instead gives exactly the same clues, so the numbers cannot tell the player which way round it goes.
    const corners = [true, false, false, false, true, false, false, false, false]
    assert.equal(countPictures(cluesOf(corners, 3, 3), 3).count, 2)
  })

  it('says it gave up rather than claiming a count it did not reach', () => {
    const picture: Picture = Array.from({ length: 100 }, (_, i) => i % 3 === 0)
    const found = countPictures(cluesOf(picture, 10, 10), 2, 5)
    assert.equal(found.gaveUp, true)
  })
})

describe('making one', () => {
  /*
   * A puzzle whose clues allow two pictures is the worst thing this game can do: the player draws the other one, is
   * told they are wrong, and cannot tell that from their own mistake. So every generated puzzle is counted, at every
   * size, over many rolls of the dice.
   */
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`only ever has one answer on ${difficulty}`, () => {
      const size = NONOGRAM_LEVELS[difficulty].size
      let totalInk = 0
      for (let seed = 1; seed <= 12; seed++) {
        const made = generateNonogram(difficulty, seeded(seed * 7919))
        assert.equal(made.puzzle.width, size)
        assert.equal(made.puzzle.height, size)
        assert.deepEqual(cluesOf(made.picture, size, size), made.puzzle, 'the clues are not the picture\'s own')
        const found = countPictures(made.puzzle, 2)
        assert.equal(found.gaveUp, false)
        assert.equal(found.count, 1, `seed ${seed} on ${difficulty} allows more than one picture`)
        assert.deepEqual(found.pictures[0], made.picture)
        totalInk += inkCount(made.picture) / (size * size)
      }
      // The pictures are pictures, not solid blocks: adding ink to settle ambiguity must not swallow the board.
      assert.ok(totalInk / 12 < 0.9, `the average picture is ${Math.round((totalInk / 12) * 100)}% ink`)
    })
  }

  it('gives a bigger board for a harder puzzle', () => {
    assert.ok(NONOGRAM_LEVELS.hard.size > NONOGRAM_LEVELS.normal.size)
    assert.ok(NONOGRAM_LEVELS.normal.size > NONOGRAM_LEVELS.easy.size)
  })
})

describe('playing and scoring', () => {
  const picture = [false, true, false, true, true, true, false, true, false]

  it('is finished when the filled squares are the picture, crossings and all', () => {
    const marks = picture.map((filled) => (filled ? 1 : 0))
    assert.equal(pictureDone(marks, picture), true)
    // Crossing out an empty square is not filling it in, so it still counts as finished.
    assert.equal(pictureDone(picture.map((filled) => (filled ? 1 : 2)), picture), true)
    marks[0] = 1
    assert.equal(pictureDone(marks, picture), false)
  })

  it('dims a clue when its own line is right', () => {
    const marks = picture.map((filled) => (filled ? 1 : 0))
    assert.equal(lineSolved(marks, [0, 1, 2], [1]), true)
    assert.equal(lineSolved(marks, [3, 4, 5], [3]), true)
    assert.equal(lineSolved([0, 0, 0], [0, 1, 2], [1]), false)
  })

  it('pays for the size of the board and takes off time and wrong squares', () => {
    assert.ok(nonogramScore(10, 60, 0) > nonogramScore(5, 60, 0))
    assert.ok(nonogramScore(10, 60, 0) > nonogramScore(10, 600, 0))
    assert.ok(nonogramScore(10, 60, 0) > nonogramScore(10, 60, 5))
    assert.equal(nonogramScore(5, 99999, 99), 50)
  })
})

describe('a saved picture', () => {
  const save = { width: 5, height: 5, picture: Array(25).fill(false), marks: Array(25).fill(0), seconds: 3, wrong: 0, difficulty: 'easy' as const }

  it('comes back when its size agrees with itself', () => {
    assert.ok(isNonogramSave(save))
  })

  it('is refused when it does not', () => {
    assert.equal(isNonogramSave(null), false)
    assert.equal(isNonogramSave({ ...save, marks: Array(25).fill(9) }), false)
    assert.equal(isNonogramSave({ ...save, picture: Array(24).fill(false) }), false)
    assert.equal(isNonogramSave({ ...save, width: 40 }), false)
    assert.equal(isNonogramSave({ ...save, difficulty: 'wild' }), false)
  })
})
