import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gapOf, inversions, isTileSave, isTilesSolvable, isTilesSolved, shuffleTiles, slidable, slideAt, slideByKey, solvedTiles, TILE_SIZES, tileClock, tileDistance, tilesHome, tileTime, type Tiles } from './slidingTiles.ts'

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

describe('the board', () => {
  it('starts in order with the gap in the last corner', () => {
    assert.deepEqual(solvedTiles(3), [1, 2, 3, 4, 5, 6, 7, 8, 0])
    assert.equal(gapOf(solvedTiles(4)), 15)
    assert.equal(isTilesSolved(solvedTiles(4)), true)
    assert.equal(isTilesSolved([1, 2, 3, 4, 5, 6, 7, 0, 8]), false)
    assert.equal(tileDistance(solvedTiles(4), 4), 0)
    assert.equal(tilesHome(solvedTiles(4)), 15)
    assert.equal(tilesHome([0, 2, 3, 4, 5, 6, 7, 8, 1]), 7)
  })

  it('names the tiles that can move', () => {
    assert.deepEqual(slidable(solvedTiles(3), 3).sort((a, b) => a - b), [5, 7])
    assert.deepEqual(slidable([1, 2, 3, 4, 0, 5, 6, 7, 8], 3).sort((a, b) => a - b), [1, 3, 5, 7])
  })
})

describe('sliding', () => {
  it('moves one tile into the gap', () => {
    const after = slideAt(solvedTiles(3), 3, 7)!
    assert.deepEqual(after.tiles, [1, 2, 3, 4, 5, 6, 7, 0, 8])
    assert.deepEqual(after.moved, [7])
  })

  it('moves a whole run when a tile further along the row or column is picked', () => {
    // The gap is bottom right. Picking the first tile of the bottom row slides all three along.
    const row = slideAt(solvedTiles(3), 3, 6)!
    assert.deepEqual(row.tiles, [1, 2, 3, 4, 5, 6, 0, 7, 8])
    assert.deepEqual(row.moved.sort((a, b) => a - b), [6, 7])
    const column = slideAt(solvedTiles(3), 3, 2)!
    assert.deepEqual(column.tiles, [1, 2, 0, 4, 5, 3, 7, 8, 6])
    assert.deepEqual(column.moved.sort((a, b) => a - b), [2, 5])
  })

  it('refuses a tile that cannot reach the gap in a straight line', () => {
    assert.equal(slideAt(solvedTiles(3), 3, 0), null, 'a corner away from the gap')
    assert.equal(slideAt(solvedTiles(3), 3, 8), null, 'the gap itself')
    assert.equal(slideAt(solvedTiles(3), 3, 99), null)
  })

  it('takes an arrow key as the way the tile goes, not the way the gap goes', () => {
    const tiles: Tiles = [1, 2, 3, 4, 0, 5, 6, 7, 8]
    assert.deepEqual(slideByKey(tiles, 3, 'left')!.tiles, [1, 2, 3, 4, 5, 0, 6, 7, 8])
    assert.deepEqual(slideByKey(tiles, 3, 'right')!.tiles, [1, 2, 3, 0, 4, 5, 6, 7, 8])
    assert.deepEqual(slideByKey(tiles, 3, 'up')!.tiles, [1, 2, 3, 4, 7, 5, 6, 0, 8])
    assert.deepEqual(slideByKey(tiles, 3, 'down')!.tiles, [1, 0, 3, 4, 2, 5, 6, 7, 8])
    // With the gap in the corner there is nothing on two of its sides.
    assert.equal(slideByKey(solvedTiles(3), 3, 'left'), null)
    assert.equal(slideByKey(solvedTiles(3), 3, 'up'), null)
    assert.ok(slideByKey(solvedTiles(3), 3, 'right'))
    assert.ok(slideByKey(solvedTiles(3), 3, 'down'))
  })

  it('never loses or duplicates a tile', () => {
    const random = seeded(17)
    let tiles = solvedTiles(4)
    for (let step = 0; step < 400; step++) {
      const options = slidable(tiles, 4)
      tiles = slideAt(tiles, 4, options[Math.floor(random() * options.length)])!.tiles
      assert.deepEqual([...tiles].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i))
    }
  })
})

describe('which arrangements can be finished at all', () => {
  /*
   * The whole reason this file exists.
   *
   * Half of all the ways the tiles could sit cannot be reached from the finished board, so a shuffle that lands on
   * one of them is not a hard puzzle: it is a puzzle with no answer, and the player has no way of knowing. The rule
   * -- count the pairs that are the wrong way round, and on an even-width board count the gap's row too -- is
   * checked here against the only thing that settles it: walking every board a three-across puzzle can actually
   * reach, by making real slides.
   */
  it('matches every board a three-across puzzle can really reach', () => {
    const reachable = new Set<string>()
    const queue: Tiles[] = [solvedTiles(3)]
    reachable.add(solvedTiles(3).join(','))
    while (queue.length) {
      const tiles = queue.pop()!
      for (const index of slidable(tiles, 3)) {
        const next = slideAt(tiles, 3, index)!.tiles
        const key = next.join(',')
        if (reachable.has(key)) continue
        reachable.add(key)
        queue.push(next)
      }
    }
    // Nine tiles can sit 362,880 ways and exactly half of those can be reached.
    assert.equal(reachable.size, 181440)
    // Every reachable board is called solvable, and nothing else is.
    const random = seeded(23)
    for (let trial = 0; trial < 4000; trial++) {
      const tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8]
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
      }
      assert.equal(isTilesSolvable(tiles, 3), reachable.has(tiles.join(',')), `${tiles.join(',')} disagrees`)
    }
  })

  it('knows the fifteen puzzle with two tiles swapped is the half that cannot be finished', () => {
    const tiles = solvedTiles(4)
    assert.equal(isTilesSolvable(tiles, 4), true)
    ;[tiles[0], tiles[1]] = [tiles[1], tiles[0]]
    assert.equal(isTilesSolvable(tiles, 4), false)
    assert.equal(inversions(solvedTiles(4)), 0)
    assert.equal(inversions([3, 2, 1, 0]), 3)
    assert.equal(isTilesSolvable([1, 2, 3], 4), false, 'the wrong number of tiles is nobody\'s puzzle')
  })

  it('shuffles only boards that can be finished, and never hands over a finished one', () => {
    for (const size of [3, 4, 5]) {
      for (let seed = 1; seed <= 120; seed++) {
        const tiles = shuffleTiles(size, seeded(seed * 2246822519))
        assert.equal(tiles.length, size * size)
        assert.deepEqual([...tiles].sort((a, b) => a - b), Array.from({ length: size * size }, (_, i) => i))
        assert.equal(isTilesSolvable(tiles, size), true, `${size} across, seed ${seed} cannot be finished`)
        assert.equal(isTilesSolved(tiles), false, `${size} across, seed ${seed} was handed over already finished`)
        assert.ok(tileDistance(tiles, size) >= size, `${size} across, seed ${seed} is barely shuffled`)
      }
    }
  })

  it('gives a bigger board for a harder game', () => {
    assert.equal(TILE_SIZES.normal, 4)
    assert.ok(TILE_SIZES.hard > TILE_SIZES.normal)
    assert.ok(TILE_SIZES.easy < TILE_SIZES.normal)
  })
})

describe('the clock', () => {
  it('reports the time it really took, and nothing cleverer', () => {
    assert.equal(tileTime(45678), 45678)
    assert.equal(tileTime(0), 1, 'a score of nothing would look like no score at all')
    assert.equal(tileClock(0), '0:00')
    assert.equal(tileClock(65000), '1:05')
    assert.equal(tileClock(600000), '10:00')
  })
})

describe('a saved board', () => {
  const save = { tiles: shuffleTiles(4, seeded(31)), size: 4, moves: 12, ms: 4000, difficulty: 'normal' as const }

  it('comes back when it holds each tile once and can still be finished', () => {
    assert.ok(isTileSave(save))
  })

  it('is refused when it cannot', () => {
    assert.equal(isTileSave(null), false)
    assert.equal(isTileSave({ ...save, tiles: save.tiles.slice(1) }), false)
    const doubled = save.tiles.slice()
    doubled[0] = doubled[1]
    assert.equal(isTileSave({ ...save, tiles: doubled }), false, 'the same tile twice')
    const swapped = save.tiles.slice()
    const a = swapped.findIndex((t) => t !== 0)
    const b = swapped.findIndex((t, i) => t !== 0 && i > a)
    ;[swapped[a], swapped[b]] = [swapped[b], swapped[a]]
    assert.equal(isTileSave({ ...save, tiles: swapped }), false, 'the half that cannot be finished')
    assert.equal(isTileSave({ ...save, moves: -2 }), false)
    assert.equal(isTileSave({ ...save, difficulty: 'tricky' }), false)
  })
})
