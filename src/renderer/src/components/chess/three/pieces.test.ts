import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HEIGHT_ORDER, MAX_SPAN, PIECE_HEIGHT, PIECE_NAME, allShapes, extentOf, pieceYaw, readabilityFaults, shapeFor,
  spanOf, topOf
} from './pieces.ts'
import { SQUARE } from './boardGeometry.ts'

test('every shape is a shape a lathe could turn', () => {
  // Said as one list rather than one assertion each, so a failure names every piece that is wrong at once.
  assert.deepEqual(readabilityFaults(), [])
})

test('the six pieces are six clearly different heights', () => {
  /*
   * This is the readability rule the whole look of the board rests on. From almost overhead the outlines
   * foreshorten into circles, and height is the only thing left that says which piece it is -- so the heights are
   * required to be in a fixed order with a real gap between each.
   */
  const heights = HEIGHT_ORDER.map((type) => PIECE_HEIGHT[type])
  for (let i = 1; i < heights.length; i += 1) {
    assert.ok(heights[i] > heights[i - 1], `${HEIGHT_ORDER[i]} is not taller than ${HEIGHT_ORDER[i - 1]}`)
    assert.ok(
      heights[i] - heights[i - 1] >= 0.055,
      `${HEIGHT_ORDER[i - 1]} and ${HEIGHT_ORDER[i]} are only ${(heights[i] - heights[i - 1]).toFixed(3)} apart`
    )
  }
  assert.equal(new Set(heights).size, 6)
  assert.deepEqual(HEIGHT_ORDER, ['p', 'r', 'n', 'b', 'q', 'k'])
})

test('no piece leaves its own square', () => {
  for (const { type, shape } of allShapes()) {
    const span = spanOf(shape)
    assert.ok(span <= MAX_SPAN, `the ${PIECE_NAME[type]} is ${span.toFixed(3)} across, over the ${MAX_SPAN} allowed`)
    // And there is real space left between two of them standing side by side.
    assert.ok(MAX_SPAN < SQUARE, 'the allowance is wider than a square')
    assert.ok(SQUARE - span > 0.1, `two ${PIECE_NAME[type]}s side by side leave only ${(SQUARE - span).toFixed(3)}`)
  }
})

test('what each piece says it is tall is what it really reaches', () => {
  for (const { type, shape } of allShapes()) {
    const reach = topOf(shape)
    assert.ok(
      Math.abs(reach - shape.height) <= 0.025,
      `the ${PIECE_NAME[type]} says ${shape.height} and reaches ${reach.toFixed(3)}`
    )
    assert.equal(shape.height, PIECE_HEIGHT[type])
  }
})

test('every piece stands on the board rather than in it', () => {
  for (const { type, shape } of allShapes()) {
    assert.equal(shape.profile[0].y, 0, `the ${PIECE_NAME[type]} does not start at the surface`)
    for (const point of shape.profile) {
      assert.ok(point.y >= 0, `the ${PIECE_NAME[type]} dips below the board`)
    }
    for (const part of shape.parts) {
      const low = part.kind === 'sphere' ? part.at[1] - part.r
        : part.kind === 'torus' ? part.at[1] - part.tube
          : part.kind === 'cylinder' ? part.at[1] - part.h / 2
            : part.at[1] - part.size[1]
      assert.ok(low > -0.01, `a part of the ${PIECE_NAME[type]} hangs under the board`)
    }
  }
})

test('the knight is the one piece that is not the same from every side', () => {
  const knight = shapeFor('n')
  const box = extentOf(knight)
  // Its muzzle sticks out forward, so front to back it is not centred on its square.
  assert.ok(Math.abs(box.minZ) > Math.abs(box.maxZ), 'the knight is not facing anywhere')
  assert.ok(box.minZ < -0.21, 'the knight has no muzzle to speak of')
  // Side to side it is symmetrical, as a turned body is.
  assert.ok(Math.abs(box.minX + box.maxX) < 1e-9)
  // And every other piece is symmetrical both ways.
  for (const { type, shape } of allShapes()) {
    if (type === 'n') continue
    const other = extentOf(shape)
    assert.ok(Math.abs(other.minX + other.maxX) < 1e-9, `the ${PIECE_NAME[type]} is lopsided across`)
    assert.ok(Math.abs(other.minZ + other.maxZ) < 1e-9, `the ${PIECE_NAME[type]} is lopsided along`)
  }
})

test('only the bishop needs a contrasting part, and it has exactly one', () => {
  /*
   * Shape carries everything except one case: from nearly overhead a bishop and a tall pawn are both circles, and
   * the slot in the mitre is what tells them apart. Everywhere else a second colour would be decoration, so
   * nowhere else has one.
   */
  for (const { type, shape } of allShapes()) {
    const accents = shape.parts.filter((part) => part.tone === 'accent')
    assert.equal(accents.length, type === 'b' ? 1 : 0, `the ${PIECE_NAME[type]} has ${accents.length} accents`)
  }
})

test('the king is the only piece with a cross and the queen the only one with a ring of beads', () => {
  // The band at the foot is on every piece, so it is not what tells them apart and is set aside here.
  const shapeOf = (type: Parameters<typeof shapeFor>[0]): ReturnType<typeof shapeFor>['parts'] =>
    shapeFor(type).parts.filter((part) => part.tone !== 'rim')

  const crossBars = shapeOf('k').filter((part) => part.kind === 'box')
  assert.equal(crossBars.length, 2, 'the king has no cross')
  const beads = shapeOf('q').filter((part) => part.kind === 'sphere')
  assert.ok(beads.length >= 8, 'the queen has no coronet')
  assert.equal(shapeOf('q').some((part) => part.kind === 'box'), false, 'the queen has a cross, which is the king')
  // The rook is the only one with a square top, which is what makes it a tower.
  const battlements = shapeOf('r')
  assert.ok(
    battlements.length >= 4 && battlements.every((part) => part.kind === 'box'),
    'the rook has no battlements'
  )
  // And nothing except the king has two bars crossing.
  for (const type of ['p', 'r', 'n', 'b', 'q'] as const) {
    assert.ok(shapeOf(type).filter((part) => part.kind === 'box').length !== 2 || type === 'r')
  }
})

test('a piece faces the far end of the board from its own side', () => {
  // With White at the bottom, White faces away from the viewer and Black faces towards them.
  assert.equal(pieceYaw('w', 'w'), 0)
  assert.equal(pieceYaw('b', 'w'), Math.PI)
  // Turn the board round and both turn with it.
  assert.equal(pieceYaw('w', 'b'), Math.PI)
  assert.equal(pieceYaw('b', 'b'), 0)
  // The two sides never face the same way, whichever way up the board is.
  for (const orientation of ['w', 'b'] as const) {
    assert.notEqual(pieceYaw('w', orientation), pieceYaw('b', orientation))
  }
})

test('a tilted part is measured as tilted, not as if it were square on', () => {
  // The measurement is what keeps the pieces inside their squares, so it has to account for the turn.
  // A bare profile, so what is measured is the one part and nothing else.
  const flat = [{ r: 0, y: 0 }, { r: 0, y: 0 }]
  const upright = extentOf({
    height: 1, name: 'test', profile: flat,
    parts: [{ kind: 'box', size: [0.1, 1, 0.1], at: [0, 0.5, 0] }]
  })
  const tipped = extentOf({
    height: 1, name: 'test', profile: flat,
    parts: [{ kind: 'box', size: [0.1, 1, 0.1], at: [0, 0.5, 0], pitch: Math.PI / 2 }]
  })
  // Tipped on its side, a long thin bar is wide front to back and no longer tall.
  assert.ok(tipped.maxZ - tipped.minZ > upright.maxZ - upright.minZ)
  assert.ok(tipped.top < upright.top)
  const turned = extentOf({
    height: 1, name: 'test', profile: flat,
    parts: [{ kind: 'box', size: [0.4, 0.1, 0.1], at: [0, 0.5, 0], yaw: Math.PI / 4 }]
  })
  // Turned forty-five degrees, a flat bar reaches further on both axes than its own width.
  assert.ok(turned.maxZ > 0.1, 'a turned bar was measured as if it were square on')
})
