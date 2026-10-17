import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_SQUARES, FILES, HALF, OUTER, RANKS, fileIndexOf, fileLabelSpot, isDarkSquare, isSquare, rankLabelSpot,
  rankOf, squareAtWorld, squareFromRay, squareName, squareToWorld
} from './boardGeometry.ts'
import { cameraPosition, defaultView, overheadView, sideView, TARGET } from './camera.ts'

test('there are sixty-four squares and they are all squares', () => {
  assert.equal(ALL_SQUARES.length, 64)
  assert.equal(new Set(ALL_SQUARES).size, 64)
  for (const square of ALL_SQUARES) assert.ok(isSquare(square), `${square} is not a square`)
})

test('what is not a square is refused rather than guessed at', () => {
  for (const bad of ['', 'a', 'a9', 'i4', 'A4', 'a0', '4a', 'e44', ' e4', 'e4 ']) {
    assert.equal(isSquare(bad), false, `${JSON.stringify(bad)} was accepted`)
    assert.equal(fileIndexOf(bad), -1)
    assert.equal(rankOf(bad), -1)
    assert.equal(squareToWorld(bad), null)
  }
  assert.equal(squareName(-1, 4), null)
  assert.equal(squareName(8, 4), null)
  assert.equal(squareName(0, 0), null)
  assert.equal(squareName(0, 9), null)
  assert.equal(squareName(1.5, 4), null)
})

test('a1 is dark and the colours alternate from there', () => {
  assert.equal(isDarkSquare('a1'), true, 'a1 must be dark; it is the one thing a chessboard cannot get wrong')
  assert.equal(isDarkSquare('b1'), false)
  assert.equal(isDarkSquare('a2'), false)
  assert.equal(isDarkSquare('h1'), false)
  assert.equal(isDarkSquare('h8'), true)
  assert.equal(isDarkSquare('a8'), false)
  // Thirty-two of each, and every neighbour the other colour.
  assert.equal(ALL_SQUARES.filter(isDarkSquare).length, 32)
  for (const file of FILES) {
    for (const rank of RANKS) {
      if (rank === 8) continue
      assert.notEqual(
        isDarkSquare(`${file}${rank}`), isDarkSquare(`${file}${rank + 1}`),
        `${file}${rank} and ${file}${rank + 1} are the same colour`
      )
    }
  }
})

test('turning the board round leaves the colours where they were', () => {
  /*
   * This is why the checkerboard is built once and never rebuilt. Flipping the board sends every square to the one
   * diagonally opposite, which is the same colour, so the pattern in space does not change at all.
   */
  for (const square of ALL_SQUARES) {
    const white = squareToWorld(square, 'w')
    const black = squareToWorld(square, 'b')
    assert.ok(white && black)
    const atWhiteSpot = squareAtWorld(white.x, white.z, 'w')
    const atSameSpotFlipped = squareAtWorld(white.x, white.z, 'b')
    assert.equal(atWhiteSpot, square)
    assert.ok(atSameSpotFlipped)
    assert.equal(
      isDarkSquare(atSameSpotFlipped), isDarkSquare(square),
      `${square} and ${atSameSpotFlipped} sit in the same place and are different colours`
    )
  }
})

test('every square has a place, and the place gives the square back', () => {
  for (const orientation of ['w', 'b'] as const) {
    for (const square of ALL_SQUARES) {
      const spot = squareToWorld(square, orientation)
      assert.ok(spot, `${square} has no place`)
      assert.equal(squareAtWorld(spot.x, spot.z, orientation), square, `${square} did not come back`)
      // And from anywhere inside the square, not only its middle.
      for (const [dx, dz] of [[0.45, 0.45], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45]]) {
        assert.equal(
          squareAtWorld(spot.x + dx, spot.z + dz, orientation), square,
          `a corner of ${square} landed somewhere else`
        )
      }
    }
  }
})

test('White at the bottom puts a1 near and on the left', () => {
  const a1 = squareToWorld('a1', 'w')
  const h8 = squareToWorld('h8', 'w')
  assert.ok(a1 && h8)
  assert.equal(a1.x, -3.5)
  assert.equal(a1.z, 3.5)
  assert.equal(h8.x, 3.5)
  assert.equal(h8.z, -3.5)
  // Turned round, the two swap places exactly.
  const a1Flipped = squareToWorld('a1', 'b')
  const h8Flipped = squareToWorld('h8', 'b')
  assert.deepEqual(a1Flipped, h8)
  assert.deepEqual(h8Flipped, a1)
})

test('a point off the board belongs to no square', () => {
  for (const [x, z] of [[-4.01, 0], [4, 0], [0, -4.01], [0, 4], [9, 9], [-20, 3]]) {
    assert.equal(squareAtWorld(x, z, 'w'), null, `${x},${z} was given a square`)
  }
  assert.equal(squareAtWorld(Number.NaN, 0, 'w'), null)
  assert.equal(squareAtWorld(0, Number.POSITIVE_INFINITY, 'w'), null)
})

test('a line from the camera finds the square it is pointing at', () => {
  // Straight down onto the middle of e4 from directly above it.
  const e4 = squareToWorld('e4', 'w')
  assert.ok(e4)
  assert.equal(squareFromRay({ x: e4.x, y: 9, z: e4.z }, { x: 0, y: -1, z: 0 }, 'w'), 'e4')
  // And at an angle: from behind the near edge, pointing down and forward.
  const found = squareFromRay({ x: 0, y: 6, z: 6 }, { x: 0, y: -6, z: -6 }, 'w')
  assert.equal(found, squareAtWorld(0, 0, 'w'))
})

test('a line that cannot reach the board says so instead of inventing a square', () => {
  // Pointing up.
  assert.equal(squareFromRay({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, 'w'), null)
  // Dead level with the board, which is the case that would otherwise divide by nearly nothing.
  assert.equal(squareFromRay({ x: 0, y: 2, z: 8 }, { x: 0, y: 0, z: -1 }, 'w'), null)
  // Downward but away from the board.
  assert.equal(squareFromRay({ x: 0, y: 5, z: 0 }, { x: 20, y: -1, z: 0 }, 'w'), null)
  // The camera already under the board: the surface is behind it, so there is nothing in front to hit.
  assert.equal(squareFromRay({ x: 0, y: -2, z: 0 }, { x: 0, y: -1, z: 0 }, 'w'), null)
  assert.equal(squareFromRay({ x: 0, y: 5, z: 0 }, { x: 0, y: Number.NaN, z: 0 }, 'w'), null)
})

test('from every view the board offers, the middle of the board can still be clicked', () => {
  /*
   * The point of this one: picking a square works by following a line down to a flat surface, so a camera that
   * reached the height of the board would stop being able to click before it looked obviously wrong. Checking it
   * from each named view keeps the two facts -- how far the camera may tilt, and whether clicking works -- tied
   * together.
   */
  for (const view of [defaultView(), overheadView(), sideView()]) {
    const eye = cameraPosition(view)
    const direction = { x: TARGET.x - eye.x, y: TARGET.y - eye.y, z: TARGET.z - eye.z }
    const square = squareFromRay(eye, direction, 'w')
    assert.ok(square, `nothing could be clicked from a view at polar ${view.polar}`)
  }
})

test('the coordinates sit outside the squares and follow the board round', () => {
  for (const orientation of ['w', 'b'] as const) {
    for (let file = 0; file < 8; file += 1) {
      const spot = fileLabelSpot(file, orientation)
      assert.ok(spot.z > HALF, 'a file letter is on the squares instead of beside them')
      assert.ok(spot.z < OUTER, 'a file letter is off the edge of the board')
      const column = squareToWorld(`${FILES[file]}1`, orientation)
      assert.ok(column)
      assert.equal(spot.x, column.x, 'a file letter is not under its own column')
    }
    for (const rank of RANKS) {
      const spot = rankLabelSpot(rank, orientation)
      assert.ok(spot.x < -HALF)
      assert.ok(spot.x > -OUTER)
      const row = squareToWorld(`a${rank}`, orientation)
      assert.ok(row)
      assert.equal(spot.z, row.z, 'a rank number is not beside its own row')
    }
  }
  // Turning the board moves the letters, which is the whole reason they are placed rather than painted on.
  assert.notEqual(fileLabelSpot(0, 'w').x, fileLabelSpot(0, 'b').x)
})
