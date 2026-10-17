import { test } from 'node:test'
import assert from 'node:assert/strict'
import { at, buildMaze, clearBonus, dotsLeft, gapTo, HUNTER_KINDS, HUNTER_POINTS, hunterStep, hunterTarget, isWall, MAZE_LEVELS, levelTuning, reachable, wrapX } from './mazeChase.ts'
import type { ChaseSituation, Maze, Spot } from './mazeChase.ts'

const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

const mazes = (count: number, attempts?: number): Maze[] => Array.from({ length: count }, (_, i) => buildMaze(rng(i * 2654435761 + 7), attempts === undefined ? {} : { attempts }))

test('every dot in every maze can be walked to — there is no unreachable corner', () => {
  for (const attempts of [40, 70, 120, 200]) {
    const built = mazes(40, attempts)
    for (const [n, maze] of built.entries()) {
      const seen = reachable(maze)
      const open = maze.walls.filter((w) => !w).length
      assert.equal(
        seen.filter(Boolean).length,
        open,
        `maze ${n} with ${attempts} walls left ${open - seen.filter(Boolean).length} squares stranded`
      )
      maze.dots.forEach((dot, i) => assert.ok(!dot || seen[i], `maze ${n} has a dot nobody can reach at ${i}`))
      maze.pills.forEach((pill, i) => assert.ok(!pill || seen[i], `maze ${n} has a pill nobody can reach at ${i}`))
      assert.equal(maze.pills.filter(Boolean).length, 4, `maze ${n} should have four power pills`)
      assert.ok(dotsLeft(maze) > 40, `maze ${n} has only ${dotsLeft(maze)} things to eat`)
      assert.equal(maze.walls[at(maze, maze.start.x, maze.start.y)], false, 'the player starts on floor')
      assert.equal(maze.walls[at(maze, maze.home.x, maze.home.y)], false, 'the hunters start on floor')
      assert.equal(maze.dots[at(maze, maze.start.x, maze.start.y)], false, 'no dot under the player')
      for (const corner of maze.corners) assert.equal(maze.walls[at(maze, corner.x, corner.y)], false, 'the corners are floor')
    }
  }
})

test('the tunnel goes right through, and the wall holds everywhere else', () => {
  for (const maze of mazes(12)) {
    const row = maze.tunnelRow
    for (let x = 0; x < maze.cols; x++) assert.equal(maze.walls[at(maze, x, row)], false, `the tunnel row should be clear at ${x}`)
    assert.equal(wrapX(maze, -1, row), maze.cols - 1, 'walking out of the left side brings you in at the right')
    assert.equal(wrapX(maze, maze.cols, row), 0)
    assert.equal(wrapX(maze, -1, row - 1), -1, 'no other row wraps')
    assert.equal(isWall(maze, -1, row), false, 'the tunnel mouth is open')
    assert.equal(isWall(maze, -1, row - 1), true, 'the side wall is not')
    for (let x = 0; x < maze.cols; x++) {
      assert.equal(maze.walls[at(maze, x, 0)], true, 'the top wall holds')
      assert.equal(maze.walls[at(maze, x, maze.rows - 1)], true, 'the bottom wall holds')
    }
    for (let y = 0; y < maze.rows; y++) {
      if (y === row) continue
      assert.equal(maze.walls[at(maze, 0, y)], true, 'the left wall holds')
      assert.equal(maze.walls[at(maze, maze.cols - 1, y)], true, 'the right wall holds')
    }
  }
})

const situation = (over: Partial<ChaseSituation> = {}): ChaseSituation => ({
  player: { x: 10, y: 10 },
  facing: { x: 1, y: 0 },
  hunter: { x: 8, y: 10 },
  corner: { x: 1, y: 1 },
  corners: [
    { x: 1, y: 1 },
    { x: 21, y: 1 },
    { x: 1, y: 13 },
    { x: 21, y: 13 }
  ],
  look: 4,
  whim: 0.9,
  frightened: false,
  cols: 23,
  rows: 15,
  ...over
})

test('the four hunters want four different squares — that is the whole game', () => {
  const close = situation()
  const targets = HUNTER_KINDS.map((kind) => hunterTarget(kind, close))
  const unique = new Set(targets.map((t) => `${t.x},${t.y}`))
  assert.equal(unique.size, 4, `the hunters agreed on a square: ${JSON.stringify(targets)}`)

  assert.deepEqual(hunterTarget('chaser', close), { x: 10, y: 10 }, 'the chaser comes straight at you')
  assert.deepEqual(hunterTarget('ambusher', close), { x: 14, y: 10 }, 'the ambusher aims four squares ahead')
  assert.deepEqual(hunterTarget('erratic', close), { x: 21, y: 13 }, 'the erratic one is distracted up close')
  assert.deepEqual(hunterTarget('keeper', close), { x: 1, y: 1 }, 'the keeper backs off when it is nearly on you')

  // Far away, the erratic one takes an interest and the keeper lurks behind the player.
  const far = situation({ hunter: { x: 1, y: 1 } })
  assert.deepEqual(hunterTarget('erratic', far), { x: 10, y: 10 })
  assert.deepEqual(hunterTarget('keeper', situation({ hunter: { x: 2, y: 10 } })), { x: 5, y: 10 })

  // Facing the other way turns the ambush round.
  assert.deepEqual(hunterTarget('ambusher', situation({ facing: { x: 0, y: -1 } })), { x: 10, y: 6 })
  // The whim moves the erratic one from corner to corner.
  const whims = new Set([0, 0.3, 0.6, 0.95].map((whim) => JSON.stringify(hunterTarget('erratic', situation({ whim })))))
  assert.equal(whims.size, 4, 'each whim picks a different corner')
  // A square is never aimed at outside the maze.
  for (const kind of HUNTER_KINDS) {
    const edge = hunterTarget(kind, situation({ player: { x: 21, y: 13 }, hunter: { x: 20, y: 13 }, facing: { x: 1, y: 0 } }))
    assert.ok(edge.x >= 0 && edge.x < 23 && edge.y >= 0 && edge.y < 15, `${kind} aimed off the board`)
  }
})

test('frightened hunters run the other way', () => {
  const s = situation({ frightened: true, hunter: { x: 8, y: 10 } })
  for (const kind of HUNTER_KINDS) {
    const target = hunterTarget(kind, s)
    assert.ok(target.x < s.hunter.x, `${kind} should be heading away from the player`)
  }
})

test('a hunter walks only into openings, never turns back on itself, and closes in', () => {
  const maze = buildMaze(rng(99))
  let checked = 0
  for (const start of [maze.start, maze.home, ...maze.corners]) {
    let pos: Spot = { ...start }
    let dir: Spot = { x: 1, y: 0 }
    const target = { ...maze.start }
    for (let step = 0; step < 400; step++) {
      const next = hunterStep(maze, pos, dir, target)
      assert.ok(next.x !== 0 || next.y !== 0, 'a hunter always has somewhere to go')
      const y = pos.y + next.y
      const x = wrapX(maze, pos.x + next.x, y)
      assert.equal(maze.walls[at(maze, x, y)], false, 'a hunter never walks into a wall')
      const reversed = next.x === -dir.x && next.y === -dir.y
      const openings = [
        { x: 0, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 }
      ].filter((d) => !isWall(maze, pos.x + d.x, pos.y + d.y))
      if (reversed) assert.equal(openings.length, 1, 'it only turns back at a dead end')
      pos = { x, y }
      dir = next
      checked++
      if (pos.x === target.x && pos.y === target.y) break
    }
    assert.ok(pos.x === target.x && pos.y === target.y, `a hunter starting at ${start.x},${start.y} never arrived`)
  }
  assert.ok(checked > 50, 'the walk was too short to prove anything')
})

test('the tunnel is the short way round, and the levels stay fair', () => {
  const maze = buildMaze(rng(5))
  const row = maze.tunnelRow
  assert.equal(gapTo(maze, { x: 1, y: row }, { x: maze.cols - 2, y: row }), 3, 'through the tunnel is three steps')
  assert.equal(gapTo(maze, { x: 1, y: row - 1 }, { x: maze.cols - 2, y: row - 1 }), maze.cols - 3, 'any other row is the long way')

  for (const level of Object.values(MAZE_LEVELS)) {
    assert.ok(level.hunterSpeed < level.playerSpeed, 'you can out-walk them to begin with')
    for (const n of [1, 2, 5, 12, 30]) {
      const tuned = levelTuning(level, n)
      assert.ok(tuned.hunterSpeed <= level.playerSpeed + 0.3, 'the hunters never run away with it')
      assert.ok(tuned.fright >= 2, 'a power pill always lasts long enough to use')
    }
    assert.ok(levelTuning(level, 4).hunterSpeed > levelTuning(level, 1).hunterSpeed, 'later levels are harder')
    assert.ok(levelTuning(level, 4).fright < levelTuning(level, 1).fright)
  }
  assert.ok(MAZE_LEVELS.easy.lives > MAZE_LEVELS.hard.lives)
  assert.ok(MAZE_LEVELS.hard.look > MAZE_LEVELS.easy.look, 'the ambusher aims further ahead on hard')
  assert.ok(HUNTER_POINTS[3] > HUNTER_POINTS[0] && clearBonus(2) > clearBonus(1))
})
