import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cornered, isRoomState, parseRoom, reachable, roomScore, roomsFor, ROOMS, solved, solveRoom, startState, step, stuckCrates, walkPath, type Direction, type Room, type RoomState } from './sokoban.ts'

const walk = (room: Room, state: RoomState, dirs: Direction[]): RoomState => {
  let current = state
  for (const dir of dirs) {
    const next = step(room, current, dir)
    assert.ok(next, `step ${dir} was refused`)
    current = next.state
  }
  return current
}

test('a room drawn as text becomes a room, and its crates and marks match', () => {
  const room = parseRoom('tiny', ['#####', '#@$.#', '#####'])
  assert.equal(room.width, 5)
  assert.equal(room.height, 3)
  assert.equal(room.player, 1 * 5 + 1)
  assert.deepEqual(room.crates, [1 * 5 + 2])
  assert.deepEqual(room.goals, [1 * 5 + 3])
  assert.equal(room.walls[0], true)
  assert.equal(room.walls[room.player], false)
  // A crate already on a mark, and you standing on one. Drawn like this the room is finished before it starts, which
  // is why the test below checks that none of the real ones are.
  const started = parseRoom('started', ['#####', '#+*.#', '#####'])
  assert.equal(started.goals.length, 3)
  assert.equal(started.crates.length, 1)
  assert.equal(solved(started, startState(started)), true)
})

test('every room in the collection can be finished, and its crates and marks match', () => {
  assert.ok(ROOMS.length >= 10)
  for (const room of ROOMS) {
    assert.equal(room.crates.length, room.goals.length, `${room.name}: as many crates as marks`)
    assert.ok(room.player >= 0, `${room.name}: somebody has to stand somewhere`)
    assert.equal(solved(room, startState(room)), false, `${room.name} starts finished`)
    const answer = solveRoom(room, startState(room))
    assert.notEqual(answer, 'too-big', `${room.name} is too large to prove -- shrink it rather than ship it unproved`)
    assert.notEqual(answer, 'unsolvable', `${room.name} cannot be finished at all`)
    if (typeof answer === 'object') assert.ok(answer.pushes >= room.crates.length, `${room.name}: every crate has to be pushed at least once`)
  }
})

test('you push, and you never pull', () => {
  const room = parseRoom('push', ['#######', '#@$ $.#', '#######'])
  const state = startState(room)
  assert.equal(step(room, state, 'left'), null, 'a wall is a wall')
  assert.equal(step(room, state, 'up'), null)
  const pushed = step(room, state, 'right')
  assert.ok(pushed?.pushed)
  assert.deepEqual(pushed!.state.crates, [room.width + 3, room.width + 4], 'the crate moved on by one and the other one stayed put')
  assert.equal(pushed!.state.pushes, 1)
  assert.equal(pushed!.state.player, room.width + 2)
  // Two crates in a row cannot be pushed at once, and a crate cannot go through a wall.
  const together = parseRoom('together', ['#######', '#@$$  #', '#######'])
  assert.equal(step(together, startState(together), 'right'), null)
  const atWall = parseRoom('at the wall', ['#####', '#@$ #', '#####'])
  const once = step(atWall, startState(atWall), 'right')!
  assert.equal(step(atWall, once.state, 'right'), null)
})

test('a crate pushed where it cannot come back from makes the room impossible, and undo is the way out', () => {
  const room = ROOMS[0]
  const before = startState(room)
  assert.ok(typeof solveRoom(room, before) === 'object')
  // Walking under the crate and shoving it up puts it against the top wall, where nothing can ever push it down.
  const ruined = walk(room, before, ['down', 'right', 'up'])
  assert.equal(ruined.pushes, 1)
  assert.equal(solveRoom(room, ruined), 'unsolvable')
  // Which is why the game keeps every step: the state before the push is still finishable.
  assert.ok(typeof solveRoom(room, before) === 'object')
  // Pushed on into the corner, it is not only unsolvable but visibly stuck.
  const corner = walk(room, ruined, ['right', 'up', 'left', 'left', 'left'])
  assert.deepEqual(cornered(room, corner), [1 * room.width + 1])
  assert.deepEqual(cornered(room, before), [], 'nothing is stuck at the start')
})

test('a crate standing on its mark is never called stuck, even in a corner', () => {
  const room = parseRoom('corner mark', ['####', '#*@#', '####'])
  assert.deepEqual(cornered(room, startState(room)), [])
  assert.deepEqual(stuckCrates(room, startState(room)), [])
  assert.equal(solved(room, startState(room)), true)
})

test('what the game says about a stuck crate is never wrong, over hundreds of muddled rooms', () => {
  // The cheap proofs the game uses are checked against the real search: every crate they name is in a room that
  // cannot be finished. The other way round is not promised, and deliberately not tested -- a crate the game says
  // nothing about may still be in trouble, which is why it says nothing rather than guessing.
  let seed = 20261016
  const random = (): number => (seed = (seed * 48271) % 2147483647) / 2147483647
  const dirs: Direction[] = ['up', 'down', 'left', 'right']
  let named = 0
  for (const room of ROOMS.slice(0, 4)) {
    for (let run = 0; run < 40; run++) {
      let state = startState(room)
      for (let n = 0; n < 12; n++) {
        const taken = step(room, state, dirs[Math.floor(random() * 4)])
        if (!taken) continue
        state = taken.state
        const stuck = stuckCrates(room, state)
        if (!stuck.length) continue
        named++
        assert.ok(stuck.every((c) => state.crates.includes(c)))
        assert.equal(solveRoom(room, state), 'unsolvable', `${room.name}: crates ${stuck.join(',')} were called stuck in a room that can still be finished`)
        break
      }
    }
  }
  assert.ok(named > 20, `only ${named} muddled rooms were found, which is not enough to prove anything`)
})

test('a crate against a wall with no mark along it is stuck, even though it can still slide', () => {
  // It can be shoved left and right all day; there is nowhere along that wall for it to end up.
  const room = parseRoom('top wall', ['######', '# $  #', '#.  @#', '######'])
  const state = startState(room)
  assert.deepEqual(cornered(room, state), [], 'it is not in a corner')
  assert.deepEqual(stuckCrates(room, state), [1 * 6 + 2])
  assert.equal(solveRoom(room, state), 'unsolvable')
  // Put a mark on that wall and the same crate is fine.
  const fixed = parseRoom('top wall with a mark', ['######', '# $ .#', '#   @#', '######'])
  assert.deepEqual(stuckCrates(fixed, startState(fixed)), [])
  assert.ok(typeof solveRoom(fixed, startState(fixed)) === 'object')
})

test('walking is free: a click anywhere you can reach becomes steps, and nowhere else', () => {
  const room = ROOMS[3]
  const state = startState(room)
  const open = reachable(room, state.crates, state.player)
  assert.ok(open.size > 4)
  for (const cell of open) {
    const path = walkPath(room, state, cell)
    assert.ok(path, `no way to walk to ${cell}`)
    const walked = walk(room, state, path!)
    assert.equal(walked.player, cell)
    assert.equal(walked.pushes, 0, 'walking never moves a crate')
    assert.deepEqual(walked.crates, state.crates)
  }
  const wall = room.walls.findIndex((w) => w)
  assert.equal(walkPath(room, state, wall), null)
  assert.equal(walkPath(room, state, state.crates[0]), null, 'you cannot walk onto a crate')
  assert.deepEqual(walkPath(room, state, state.player), [])
})

test('finishing a room pays for the crates and charges for the wandering', () => {
  assert.ok(roomScore(3, 20, 0, 'normal') > roomScore(3, 60, 0, 'normal'))
  assert.ok(roomScore(4, 30, 0, 'normal') > roomScore(2, 30, 0, 'normal'))
  assert.ok(roomScore(3, 30, 0, 'normal') > roomScore(3, 30, 2, 'normal'))
  // Hard charges more for every step, so the same solve is worth less.
  assert.ok(roomScore(3, 40, 0, 'hard') < roomScore(3, 40, 0, 'normal'))
  assert.ok(roomScore(3, 40, 0, 'normal') < roomScore(3, 40, 0, 'easy'))
  assert.equal(roomScore(1, 10000, 50, 'hard'), 40, 'a bad room still pays something')
})

test('which rooms a run is made of, and a saved run is only loaded when it is one', () => {
  assert.ok(roomsFor('easy').length >= 6)
  assert.equal(roomsFor('normal').length, ROOMS.length)
  assert.ok(roomsFor('hard')[0].name !== ROOMS[0].name, 'hard skips the rooms that teach pushing')
  for (const difficulty of ['easy', 'normal', 'hard'] as const) for (const room of roomsFor(difficulty)) assert.ok(ROOMS.includes(room))
  const state = startState(ROOMS[0])
  assert.equal(isRoomState(state), true)
  assert.equal(isRoomState(JSON.parse(JSON.stringify(state))), true)
  assert.equal(isRoomState({ player: 1 }), false)
  assert.equal(isRoomState(null), false)
})
