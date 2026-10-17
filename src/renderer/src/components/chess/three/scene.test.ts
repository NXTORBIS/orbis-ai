import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardSquares, START_FEN, applyMove } from '../../../../../shared/chess/rules.ts'
import { createBoardScene, noMarks, type BoardScene, type SceneDeps } from './scene.ts'
import { ALL_SQUARES, squareToWorld } from './boardGeometry.ts'
import { defaultView, overheadView } from './camera.ts'
import { DEFAULT_PALETTE } from './palette.ts'
import { LIFT_HEIGHT } from './support.ts'

/**
 * The scene, built for real, with no graphics card anywhere near it.
 *
 * three.js builds geometry on the processor -- a `WebGLRenderer` needs a browser but a `BufferGeometry` does not --
 * so the whole scene can be put together here and measured. That is where the mesh and triangle counts in the
 * report come from: they are counted, not estimated.
 *
 * What this cannot prove is anything about drawing. There is no context, so nothing is rendered and no frame rate
 * is measured. Those are stated as unverified rather than guessed at.
 */
async function build(): Promise<{ scene: BoardScene; deps: SceneDeps }> {
  const T = await import('three')
  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js')
  const deps: SceneDeps = { T, mergeGeometries }
  return { scene: createBoardScene(deps, DEFAULT_PALETTE), deps }
}

test('the board is built out of two meshes and not sixty-four', () => {
  // The board with nothing on it: the slab, the light squares and the dark squares.
  return build().then(({ scene }) => {
    const bare = scene.stats()
    assert.equal(bare.meshes, 3, `an empty board is ${bare.meshes} meshes`)
    assert.ok(bare.triangles > 0)
    scene.dispose()
  })
})

test('the whole starting position costs what it says it costs', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  scene.setMarks(noMarks(), 'w')
  const counted = scene.stats()
  /*
   * Thirty-two pieces, each one mesh for its body and one for the band at its foot, the four bishops one more each
   * for the slot in the mitre, and three for the board itself. Written out rather than asserted loosely, so a
   * change that quietly doubled the cost of a piece would fail here and say by how much.
   */
  assert.equal(counted.meshes, 3 + 32 * 2 + 4, `the starting position came to ${counted.meshes} meshes`)
  // No coordinates in this test: those are sprites and they need a browser to draw their letters on.
  assert.equal(counted.sprites, 0)
  // Shapes are shared, so there are far fewer of them than there are things on the board.
  assert.ok(counted.geometries <= 20, `${counted.geometries} distinct shapes is more sharing than there should be`)
  assert.ok(counted.materials <= 12, `${counted.materials} distinct materials`)
  // The real numbers, for the record. These are the measurement, not a target.
  assert.ok(counted.triangles > 10000, `only ${counted.triangles} triangles, which is suspiciously few`)
  assert.ok(counted.triangles < 120000, `${counted.triangles} triangles is more than a chessboard should need`)
  scene.dispose()
})

test('showing a different position moves the pieces that are there rather than building more', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  const first = scene.stats()
  // Walk a few moves through and back again; the cost must not creep.
  let fen = START_FEN
  for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6']) {
    const made = applyMove(fen, move)
    assert.ok(made, `${move} could not be played`)
    fen = made.after
    scene.setPosition(boardSquares(fen), 'w')
  }
  const after = scene.stats()
  /*
   * Two pieces fewer -- a knight and a bishop -- so two bodies, two bands and the bishop's slot fewer. Worked out
   * from the position rather than written as a number, because the cost of a piece depends on which piece it is.
   */
  const left = boardSquares(fen)
  assert.equal(left.length, 30)
  assert.equal(after.meshes, 3 + left.length * 2 + left.filter((one) => one.type === 'b').length,
    `${first.meshes} became ${after.meshes}`)
  /*
   * Shapes are shared, so losing pieces loses none of them: three bishops still want the mitre slot and twenty-nine
   * other pieces still want their own shapes. This is the number that would creep if a position built new geometry.
   */
  assert.equal(after.geometries, first.geometries, 'the set of shapes changed when the position did')
  scene.setPosition(boardSquares(START_FEN), 'w')
  assert.deepEqual(scene.stats(), first, 'coming back to the starting position did not come back to the same cost')
  scene.dispose()
})

test('a position with nine queens is drawn, not refused', async () => {
  const { scene } = await build()
  // Eight promoted queens and the original, which is more than any set of pieces contains.
  const crowded = 'QQQQQQQk/QQ6/8/8/8/8/8/K7 b - - 0 40'
  const pieces = boardSquares(crowded)
  assert.equal(pieces.filter((one) => one.type === 'q').length, 9)
  scene.setPosition(pieces, 'w')
  const counted = scene.stats()
  // Nine queens, two kings: eleven pieces, two meshes each, plus the board.
  assert.equal(counted.meshes, 3 + 11 * 2)
  scene.dispose()
})

test('nothing on the board is left standing on a square it has left', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  const after = applyMove(START_FEN, 'e4')
  assert.ok(after)
  scene.setPosition(boardSquares(after.after), 'w')
  // e2 is empty now, so nothing visible may be standing there.
  const e2 = squareToWorld('e2', 'w')
  const e4 = squareToWorld('e4', 'w')
  assert.ok(e2 && e4)
  const standing = (x: number, z: number): boolean => {
    let found = false
    scene.scene.traverseVisible((object) => {
      if (object.type !== 'Group') return
      if (Math.abs(object.position.x - x) < 1e-6 && Math.abs(object.position.z - z) < 1e-6) found = true
    })
    return found
  }
  assert.equal(standing(e2.x, e2.z), false, 'a pawn is still standing on e2')
  assert.equal(standing(e4.x, e4.z), true, 'nothing is standing on e4')
  scene.dispose()
})

test('every piece in the position is somewhere a square is', async () => {
  const { scene } = await build()
  for (const orientation of ['w', 'b'] as const) {
    scene.setPosition(boardSquares(START_FEN), orientation)
    const squares = new Set(ALL_SQUARES.map((one) => {
      const spot = squareToWorld(one, orientation)
      return `${spot?.x},${spot?.z}`
    }))
    let seen = 0
    scene.scene.traverseVisible((object) => {
      if (object.type !== 'Group' || object.children.length === 0) return
      if (!object.children.some((child) => (child as { isMesh?: boolean }).isMesh)) return
      seen += 1
      assert.ok(
        squares.has(`${object.position.x},${object.position.z}`),
        `a piece is at ${object.position.x},${object.position.z}, which is not a square`
      )
    })
    assert.equal(seen, 32, `${seen} pieces were placed rather than 32`)
  }
  scene.dispose()
})

test('a held piece rises off its square and letting go puts it back', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  const heightAt = (square: string): number | null => {
    const spot = squareToWorld(square, 'w')
    if (!spot) return null
    let height: number | null = null
    scene.scene.traverseVisible((object) => {
      if (object.type !== 'Group') return
      if (Math.abs(object.position.x - spot.x) < 1e-6 && Math.abs(object.position.z - spot.z) < 1e-6) {
        height = object.position.y
      }
    })
    return height
  }
  assert.equal(heightAt('e2'), 0)
  scene.setLift('e2', 1, 'w')
  assert.equal(heightAt('e2'), LIFT_HEIGHT)
  // Half way up, for the easing.
  scene.setLift('e2', 0.5, 'w')
  assert.equal(heightAt('e2'), LIFT_HEIGHT / 2)
  // And everything else stays on the board.
  assert.equal(heightAt('d2'), 0)
  scene.setLift(null, 0, 'w')
  assert.equal(heightAt('e2'), 0)
  // Nonsense is treated as nothing rather than throwing the piece into orbit.
  scene.setLift('e2', Number.NaN, 'w')
  assert.equal(heightAt('e2'), 0)
  scene.setLift('e2', 99, 'w')
  assert.equal(heightAt('e2'), LIFT_HEIGHT)
  scene.dispose()
})

test('a lift survives the position changing under it', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  scene.setLift('e2', 1, 'w')
  // The piece that was held has moved away, so nothing should be left hovering over e2.
  const after = applyMove(START_FEN, 'e4')
  assert.ok(after)
  scene.setPosition(boardSquares(after.after), 'w')
  let hovering = 0
  scene.scene.traverseVisible((object) => {
    if (object.type === 'Group' && object.position.y > 0.001) hovering += 1
  })
  assert.equal(hovering, 0, 'something is still hovering over a square it has left')
  scene.dispose()
})

test('each kind of mark is drawn once per square and no more', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  const bare = scene.stats().meshes
  scene.setMarks({
    selected: 'e2',
    legal: ['e3', 'e4'],
    captures: [],
    lastFrom: 'g1',
    lastTo: 'f3',
    noted: ['d4', 'd5'],
    check: 'e1',
    cursor: 'e4'
  }, 'w')
  const marked = scene.stats().meshes
  // One for the selection, two for the reachable squares, two for the last move, two noted, one check, one cursor.
  assert.equal(marked - bare, 9, `${marked - bare} marks were drawn rather than 9`)
  // Clearing them puts every one away again rather than leaving ghosts behind.
  scene.setMarks(noMarks(), 'w')
  assert.equal(scene.stats().meshes, bare, 'a mark was left on the board after being cleared')
  scene.dispose()
})

test('a mark asked for on a square that is not a square is simply not drawn', async () => {
  const { scene } = await build()
  const bare = scene.stats().meshes
  scene.setMarks({ ...noMarks(), selected: 'z9', legal: ['', 'q0'], noted: ['e9'], check: 'a0', cursor: 'bad' }, 'w')
  assert.equal(scene.stats().meshes, bare, 'something was drawn for a square that does not exist')
  scene.dispose()
})

test('the marks are reused rather than rebuilt, however many times they change', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  // Measured with the marks already showing, because a mark that is not on the board is not a shape being drawn.
  scene.setMarks({ ...noMarks(), selected: 'a1', legal: ['a2'], cursor: 'a3' }, 'w')
  const withMarks = scene.stats()
  for (let round = 0; round < 40; round += 1) {
    const square = ALL_SQUARES[round % ALL_SQUARES.length]
    scene.setMarks({ ...noMarks(), selected: square, legal: [square], cursor: square }, 'w')
  }
  // Same shapes, same number of things on the board: the marks moved rather than multiplied.
  assert.deepEqual(scene.stats(), withMarks, 'forty rounds of marks changed what the board costs')
  scene.setMarks({ ...noMarks(), selected: 'a1' }, 'w')
  const oneMark = scene.stats().meshes
  scene.setMarks(noMarks(), 'w')
  assert.equal(oneMark - scene.stats().meshes, 1)
  scene.dispose()
})

test('turning the board round moves the pieces and nothing else', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  const white = scene.stats()
  const spotsFor = (orientation: 'w' | 'b'): string[] => {
    scene.setPosition(boardSquares(START_FEN), orientation)
    const spots: string[] = []
    scene.scene.traverseVisible((object) => {
      if (object.type !== 'Group' || !object.children.some((child) => (child as { isMesh?: boolean }).isMesh)) return
      spots.push(`${object.position.x},${object.position.z}`)
    })
    return spots.sort()
  }
  const fromWhite = spotsFor('w')
  const fromBlack = spotsFor('b')
  // The same set of places, because the position is symmetrical at the start -- but not the same piece in each.
  assert.deepEqual(fromWhite, fromBlack)
  const black = scene.stats()
  assert.equal(black.meshes, white.meshes, 'turning the board changed how much there is to draw')
  assert.equal(black.geometries, white.geometries)
  scene.dispose()
})

test('the camera is put exactly where the view says, and looks at the board', async () => {
  const { scene } = await build()
  for (const view of [defaultView(), overheadView()]) {
    scene.applyView(view)
    assert.ok(scene.camera.position.y > 0, 'the camera went under the board')
    // Looking at the middle: the camera's own forward direction points back towards it.
    const forward = { x: -scene.camera.position.x, y: -scene.camera.position.y, z: -scene.camera.position.z }
    const length = Math.hypot(forward.x, forward.y, forward.z)
    assert.ok(length > 1)
    assert.ok(scene.camera.position.y / length < 1)
  }
  scene.dispose()
})

test('the viewport is only taken when it is a real size', async () => {
  const { scene } = await build()
  scene.setViewport(800, 600)
  assert.ok(Math.abs(scene.camera.aspect - 800 / 600) < 1e-9)
  // A pane with no size yet must not leave the camera with a nonsense shape.
  scene.setViewport(0, 600)
  assert.ok(Math.abs(scene.camera.aspect - 800 / 600) < 1e-9)
  scene.setViewport(800, 0)
  assert.ok(Math.abs(scene.camera.aspect - 800 / 600) < 1e-9)
  scene.dispose()
})

test('the coordinates can be hidden and brought back', async () => {
  const { scene } = await build()
  assert.equal(scene.labels.visible, true)
  scene.setLabelsVisible(false)
  assert.equal(scene.labels.visible, false)
  scene.setLabelsVisible(true)
  assert.equal(scene.labels.visible, true)
  scene.dispose()
})

test('taking the scene down lets go of every shape and every material', async () => {
  const { scene } = await build()
  scene.setPosition(boardSquares(START_FEN), 'w')
  const shapes: import('three').BufferGeometry[] = []
  const materials: import('three').Material[] = []
  scene.scene.traverse((object) => {
    const mesh = object as import('three').Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry) shapes.push(mesh.geometry)
    for (const one of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.push(one)
  })
  assert.ok(shapes.length > 0 && materials.length > 0)
  scene.dispose()
  /*
   * A disposed shape has had its buffers released. three.js does not expose a flag for it, so what is checked is
   * the thing that matters next: nothing is left in the scene holding on to them.
   */
  assert.equal(scene.scene.children.length, 0, 'the scene still has things in it after being taken down')
})

test('a scene that cannot be built does not leave half of one behind', async () => {
  const T = await import('three')
  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js')
  let disposed = 0
  // A joiner that refuses, which is what a shape that cannot be made looks like from here.
  const broken: SceneDeps = {
    T,
    mergeGeometries: (parts, groups) => {
      for (const part of parts) {
        const original = part.dispose.bind(part)
        part.dispose = (): void => { disposed += 1; original() }
      }
      // The sixty-four squares are joined thirty-two at a time, so this is the checkerboard refusing to be built.
      return parts.length === 32 ? null : mergeGeometries(parts, groups)
    }
  }
  assert.throws(() => createBoardScene(broken, DEFAULT_PALETTE), /could not be built/)
  assert.ok(disposed > 0, 'a failed build kept hold of the shapes it had already made')
})

test('the three things that happen while somebody is playing all cost well under a frame', async () => {
  /*
   * Not a frame rate. Nothing is drawn here -- there is no graphics context -- so what this measures is the work
   * this code does on the processor before the card is asked for anything: placing the pieces for a new position,
   * moving the marks, and moving the camera.
   *
   * The bounds are loose on purpose, because a test machine under load is slower than a laptop idling. They are
   * there to catch a change that made one of these cost ten times what it costs, which is the shape of mistake
   * that turns a smooth board into a sticky one.
   */
  const { scene } = await build()
  const positions = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'Nf6']
    .reduce<string[]>((fens, san) => {
      const made = applyMove(fens[fens.length - 1], san)
      return made ? [...fens, made.after] : fens
    }, [START_FEN])
    .map((fen) => boardSquares(fen))
  assert.ok(positions.length > 5, 'the line could not be played, so nothing was measured')

  const timed = (rounds: number, work: (round: number) => void): number => {
    // One run first, so what is measured is the steady cost rather than the first-time cost.
    work(0)
    const started = performance.now()
    for (let round = 0; round < rounds; round += 1) work(round)
    return (performance.now() - started) / rounds
  }

  const perPosition = timed(200, (round) => scene.setPosition(positions[round % positions.length], 'w'))
  const perMarks = timed(200, (round) => scene.setMarks({
    ...noMarks(),
    selected: ALL_SQUARES[round % 64],
    legal: ['e3', 'e4', 'd4'],
    captures: ['d5'],
    lastFrom: 'g1',
    lastTo: 'f3',
    cursor: 'e4'
  }, 'w'))
  const perView = timed(400, (round) => scene.applyView({ azimuth: round * 0.01, polar: 0.9, distance: 12 }))

  assert.ok(perPosition < 8, `placing the pieces takes ${perPosition.toFixed(3)}ms`)
  assert.ok(perMarks < 4, `moving the marks takes ${perMarks.toFixed(3)}ms`)
  assert.ok(perView < 1, `moving the camera takes ${perView.toFixed(3)}ms`)
  // Turning the camera is what happens on every frame of a drag, so it has to be the cheapest of the three.
  assert.ok(perView < perPosition, 'moving the camera costs more than placing every piece, which is the wrong way round')
  scene.dispose()
})
