/**
 * Crate Pusher's rules and its rooms, kept pure.
 *
 * You can push a crate and you can never pull one, which is the whole game: a crate shoved into a corner stays there
 * for good. So two things in here matter more than the rest. `walkPath` is how a click becomes steps, because walking
 * is free and only a push changes anything. And `solveRoom` really searches the room, so the game can say "this room
 * can no longer be finished" only when that has been proved -- and so the test can prove every authored room is
 * finishable in the first place. A room nobody can finish is the worst thing this collection could ship, because a
 * player cannot tell it from their own mistake.
 *
 * The search works in pushes rather than steps, and treats every player position that can be walked between as one
 * position. That is what keeps it small enough to run while somebody is playing.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

export const DIRECTIONS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
}

export interface Room {
  name: string
  width: number
  height: number
  /** One entry per cell, row by row. */
  walls: boolean[]
  goals: number[]
  crates: number[]
  player: number
}

export interface RoomState {
  player: number
  /** Always sorted, so two arrangements that are the same compare as the same. */
  crates: number[]
  moves: number
  pushes: number
}

/**
 * Reads a room drawn as text. `#` is a wall, `.` a mark on the floor, `$` a crate, `*` a crate already on a mark,
 * `@` you, and `+` you standing on a mark.
 */
export function parseRoom(name: string, lines: string[]): Room {
  const width = Math.max(...lines.map((line) => line.length))
  const height = lines.length
  const walls = new Array<boolean>(width * height).fill(true)
  const goals: number[] = []
  const crates: number[] = []
  let player = -1
  lines.forEach((line, y) => {
    for (let x = 0; x < width; x++) {
      const char = line[x] ?? '#'
      const index = y * width + x
      if (char === '#') continue
      walls[index] = false
      if (char === '.' || char === '*' || char === '+') goals.push(index)
      if (char === '$' || char === '*') crates.push(index)
      if (char === '@' || char === '+') player = index
    }
  })
  return { name, width, height, walls, goals, crates: crates.sort((a, b) => a - b), player }
}

export const startState = (room: Room): RoomState => ({ player: room.player, crates: [...room.crates], moves: 0, pushes: 0 })

export const solved = (room: Room, state: RoomState): boolean => state.crates.every((c) => room.goals.includes(c))

const neighbour = (room: Room, index: number, dir: Direction): number => {
  const { dx, dy } = DIRECTIONS[dir]
  const x = (index % room.width) + dx
  const y = Math.floor(index / room.width) + dy
  if (x < 0 || y < 0 || x >= room.width || y >= room.height) return -1
  return y * room.width + x
}

/** One step. Null when a wall, or a crate with something behind it, is in the way. */
export function step(room: Room, state: RoomState, dir: Direction): { state: RoomState; pushed: boolean } | null {
  const ahead = neighbour(room, state.player, dir)
  if (ahead < 0 || room.walls[ahead]) return null
  const crateAhead = state.crates.includes(ahead)
  if (!crateAhead) return { state: { ...state, player: ahead, moves: state.moves + 1 }, pushed: false }
  const beyond = neighbour(room, ahead, dir)
  if (beyond < 0 || room.walls[beyond] || state.crates.includes(beyond)) return null
  const crates = state.crates.filter((c) => c !== ahead).concat(beyond).sort((a, b) => a - b)
  return { state: { ...state, player: ahead, crates, moves: state.moves + 1, pushes: state.pushes + 1 }, pushed: true }
}

/** Every floor cell you could walk to from here without touching a crate. */
export function reachable(room: Room, crates: readonly number[], from: number): Set<number> {
  const blocked = new Set(crates)
  const seen = new Set<number>([from])
  const queue = [from]
  while (queue.length) {
    const at = queue.pop()!
    for (const dir of Object.keys(DIRECTIONS) as Direction[]) {
      const next = neighbour(room, at, dir)
      if (next < 0 || room.walls[next] || blocked.has(next) || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

/** The shortest walk to a cell, as steps, or null when you cannot get there without pushing something. */
export function walkPath(room: Room, state: RoomState, to: number): Direction[] | null {
  if (to === state.player) return []
  const blocked = new Set(state.crates)
  if (room.walls[to] || blocked.has(to)) return null
  const came = new Map<number, { from: number; dir: Direction }>()
  const queue = [state.player]
  let head = 0
  while (head < queue.length) {
    const at = queue[head++]
    for (const dir of Object.keys(DIRECTIONS) as Direction[]) {
      const next = neighbour(room, at, dir)
      if (next < 0 || room.walls[next] || blocked.has(next) || came.has(next) || next === state.player) continue
      came.set(next, { from: at, dir })
      if (next === to) {
        const path: Direction[] = []
        let cursor = to
        while (cursor !== state.player) {
          const back = came.get(cursor)!
          path.unshift(back.dir)
          cursor = back.from
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}

/** A crate wedged into a corner off its mark: it can never be moved again. */
export function cornered(room: Room, state: RoomState): number[] {
  return state.crates.filter((c) => {
    if (room.goals.includes(c)) return false
    const up = neighbour(room, c, 'up')
    const down = neighbour(room, c, 'down')
    const left = neighbour(room, c, 'left')
    const right = neighbour(room, c, 'right')
    const solid = (i: number): boolean => i < 0 || room.walls[i]
    return (solid(up) || solid(down)) && (solid(left) || solid(right))
  })
}

export type Solution = { pushes: number } | 'unsolvable' | 'too-big'

/**
 * The room worked out once as plain numbers, because the search below asks the same questions about it millions of
 * times: where each neighbour is, which cells are floor, and which are marks.
 */
interface Prepared {
  cells: number
  /** Four entries per cell, in the order up, down, left, right; -1 off the edge. */
  nbr: Int32Array
  floor: Uint8Array
  goal: Uint8Array
  /**
   * Cells no crate may ever be pushed onto: a corner that is not a mark. A crate there can never be moved again, so
   * every arrangement with one in it is a dead end. Skipping them is what keeps the larger rooms searchable.
   */
  dead: Uint8Array
  /**
   * How far each cell is from the nearest mark across the floor. Nothing can reach a mark in fewer pushes than that,
   * which is what lets the search look at the promising arrangements first instead of all of them.
   */
  toGoal: Int32Array
}

const prepared = new WeakMap<Room, Prepared>()

function prepare(room: Room): Prepared {
  const already = prepared.get(room)
  if (already) return already
  const cells = room.width * room.height
  const nbr = new Int32Array(cells * 4)
  const floor = new Uint8Array(cells)
  const goal = new Uint8Array(cells)
  const order: Direction[] = ['up', 'down', 'left', 'right']
  for (let index = 0; index < cells; index++) {
    floor[index] = room.walls[index] ? 0 : 1
    order.forEach((dir, d) => (nbr[index * 4 + d] = neighbour(room, index, dir)))
  }
  for (const g of room.goals) goal[g] = 1
  const dead = new Uint8Array(cells)
  for (let index = 0; index < cells; index++) {
    if (!floor[index] || goal[index]) continue
    const solid = (d: number): boolean => nbr[index * 4 + d] < 0 || !floor[nbr[index * 4 + d]]
    if ((solid(0) || solid(1)) && (solid(2) || solid(3))) dead[index] = 1
  }
  const toGoal = new Int32Array(cells).fill(Number.MAX_SAFE_INTEGER)
  const queue = [...room.goals]
  for (const g of room.goals) toGoal[g] = 0
  let head = 0
  while (head < queue.length) {
    const at = queue[head++]
    for (let d = 0; d < 4; d++) {
      const next = nbr[at * 4 + d]
      if (next < 0 || !floor[next] || toGoal[next] !== Number.MAX_SAFE_INTEGER) continue
      toGoal[next] = toGoal[at] + 1
      queue.push(next)
    }
  }
  const made = { cells, nbr, floor, goal, dead, toGoal }
  prepared.set(room, made)
  return made
}

/**
 * Searches the room for the shortest way to finish it, counting pushes rather than steps.
 *
 * Three things keep it small enough to be worth running. Two arrangements count as the same when the crates are in
 * the same places and you could walk between the two positions you are standing in, so the lowest cell you can reach
 * stands in for where you are. Pushes onto a square a crate could never leave again are not even tried. And the
 * arrangements are looked at in the order of pushes made plus the distance every crate still has to travel -- which
 * is never more than the pushes it really needs, so the first finish found is a shortest one.
 *
 * `too-big` means the search ran out of room, not that the puzzle is impossible. The difference is the point: the
 * game only tells a player a room can no longer be finished when it has been proved.
 */
export function solveRoom(room: Room, state: RoomState, maxStates = 200000): Solution {
  if (solved(room, state)) return { pushes: 0 }
  const { cells, nbr, floor, goal, dead, toGoal } = prepare(room)
  const occupied = new Uint8Array(cells)
  const stack = new Int32Array(cells)
  const visited = new Int32Array(cells)
  const standing = new Uint8Array(cells)
  let stamp = 0

  /** Walks out from a cell, and gives back the lowest cell reached -- the one that stands for the whole region. */
  const region = (from: number, into?: Uint8Array): number => {
    stamp++
    let lowest = from
    let top = 0
    stack[top++] = from
    visited[from] = stamp
    if (into) into[from] = 1
    while (top) {
      const at = stack[--top]
      for (let d = 0; d < 4; d++) {
        const next = nbr[at * 4 + d]
        if (next < 0 || !floor[next] || occupied[next] || visited[next] === stamp) continue
        visited[next] = stamp
        if (into) into[next] = 1
        if (next < lowest) lowest = next
        stack[top++] = next
      }
    }
    return lowest
  }

  const key = (crates: readonly number[], where: number): string => String.fromCharCode(where, ...crates)
  const left = (crates: readonly number[]): number => {
    let sum = 0
    for (const c of crates) {
      if (toGoal[c] === Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
      sum += toGoal[c]
    }
    return sum
  }

  // A heap, so the most promising arrangement is always the next one looked at.
  interface Node { f: number; pushes: number; crates: number[]; player: number }
  const heap: Node[] = []
  const add = (node: Node): void => {
    heap.push(node)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent].f <= heap[i].f) break
      ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
      i = parent
    }
  }
  const takeBest = (): Node => {
    const best = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let small = i
        if (l < heap.length && heap[l].f < heap[small].f) small = l
        if (r < heap.length && heap[r].f < heap[small].f) small = r
        if (small === i) break
        ;[heap[small], heap[i]] = [heap[i], heap[small]]
        i = small
      }
    }
    return best
  }

  for (const c of state.crates) occupied[c] = 1
  const start = left(state.crates)
  if (start === Number.MAX_SAFE_INTEGER) return 'unsolvable'
  const seen = new Set<string>([key(state.crates, region(state.player))])
  add({ f: start * 1024, pushes: 0, crates: [...state.crates], player: state.player })
  let counted = 1
  while (heap.length) {
    const node = takeBest()
    occupied.fill(0)
    for (const c of node.crates) occupied[c] = 1
    standing.fill(0)
    region(node.player, standing)
    for (const crate of node.crates) {
      for (let d = 0; d < 4; d++) {
        // Pushing this way means standing on the far side of the crate and the cell beyond it being free.
        const behind = nbr[crate * 4 + (d ^ 1)]
        const ahead = nbr[crate * 4 + d]
        if (behind < 0 || ahead < 0 || !standing[behind] || !floor[ahead] || occupied[ahead] || dead[ahead]) continue
        const crates = node.crates.filter((c) => c !== crate).concat(ahead).sort((a, b) => a - b)
        const pushes = node.pushes + 1
        if (crates.every((c) => goal[c])) return { pushes }
        const still = left(crates)
        if (still === Number.MAX_SAFE_INTEGER) continue
        // You end up standing where the crate was, so the region is measured from there.
        occupied[crate] = 0
        occupied[ahead] = 1
        const where = region(crate)
        occupied[crate] = 1
        occupied[ahead] = 0
        const id = key(crates, where)
        if (seen.has(id)) continue
        seen.add(id)
        counted++
        if (counted > maxStates) return 'too-big'
        add({ f: (pushes + still) * 1024 - pushes, pushes, crates, player: crate })
      }
    }
  }
  return 'unsolvable'
}

/**
 * The crates that can never reach a mark again, whatever anybody does next.
 *
 * This is what the game says out loud, and it has to be right in one direction: a crate named here really is beyond
 * saving, so the only honest answer is to undo. A crate not named here might still be in trouble -- proving that
 * needs the whole search above, which is too slow to run between keystrokes -- so the game says nothing about it.
 *
 * Three proofs, all cheap. A crate in a corner off its mark can never be pushed again at all. A crate in a block of
 * four, where the other three are crates or walls, cannot be pushed in any direction either, and nor can any of the
 * others. And a crate with a wall above or below can only ever slide along that row -- so if the row it is pinned to
 * holds no mark between the walls at its ends, it will never stand on one.
 */
export function stuckCrates(room: Room, state: RoomState): number[] {
  const solid = (index: number): boolean => index < 0 || room.walls[index]
  const crates = new Set(state.crates)
  const blocked = (index: number): boolean => solid(index) || crates.has(index)
  const pinnedToRow = (index: number): boolean => solid(neighbour(room, index, 'up')) || solid(neighbour(room, index, 'down'))
  const pinnedToColumn = (index: number): boolean => solid(neighbour(room, index, 'left')) || solid(neighbour(room, index, 'right'))

  /** A crate pinned to one line, with no mark anywhere it could slide to. */
  const pinnedAway = (index: number, pinned: (cell: number) => boolean, ways: [Direction, Direction]): boolean => {
    if (!pinned(index)) return false
    for (const dir of ways) {
      let at = index
      for (;;) {
        if (room.goals.includes(at)) return false
        const next = neighbour(room, at, dir)
        // Only walls are taken as the end of the line: another crate may yet move out of the way.
        if (solid(next)) break
        if (!pinned(next)) return false
        at = next
      }
    }
    return true
  }

  /** Four cells in a square, all crates or walls: nothing in it can ever be pushed out. */
  const frozenGroup = (index: number): boolean => {
    const x = index % room.width
    const y = Math.floor(index / room.width)
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as [number, number][]) {
      const corner = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([ox, oy]) => {
        const cx = x + dx + ox
        const cy = y + dy + oy
        return cx < 0 || cy < 0 || cx >= room.width || cy >= room.height ? -1 : cy * room.width + cx
      })
      if (corner.every(blocked)) return true
    }
    return false
  }

  return state.crates.filter((c) => {
    if (room.goals.includes(c)) return false
    if (pinnedToRow(c) && pinnedToColumn(c)) return true
    if (frozenGroup(c)) return true
    return pinnedAway(c, pinnedToRow, ['left', 'right']) || pinnedAway(c, pinnedToColumn, ['up', 'down'])
  })
}

// ---------------------------------------------------------------- rooms

/**
 * The rooms, gentlest first. Every one of them is searched from scratch by the test beside this file, so a room that
 * cannot be finished cannot be shipped -- and neither can one whose crates and marks do not match.
 */
const PLANS: { name: string; lines: string[] }[] = [
  { name: 'First push', lines: [
    '#########',
    '#       #',
    '#  @$  .#',
    '#       #',
    '#########'
  ] },
  { name: 'Round the corner', lines: [
    '#######',
    '#.    #',
    '#     #',
    '#  $  #',
    '#  @  #',
    '#######'
  ] },
  { name: 'Both ways', lines: [
    '########',
    '#      #',
    '# .$@$.#',
    '#      #',
    '########'
  ] },
  { name: 'Either side', lines: [
    '########',
    '#      #',
    '# #### #',
    '# $..$ #',
    '# #### #',
    '#  @   #',
    '########'
  ] },
  { name: 'Three ways out', lines: [
    '#########',
    '#   .   #',
    '# $ $ $ #',
    '#   @   #',
    '#  . .  #',
    '#########'
  ] },
  { name: 'In order', lines: [
    '##########',
    '#        #',
    '# $$$    #',
    '# @   ...#',
    '#        #',
    '##########'
  ] },
  { name: 'Four corners', lines: [
    '##########',
    '#.      .#',
    '#  $$$$  #',
    '#   @    #',
    '#.      .#',
    '##########'
  ] },
  { name: 'The alcove', lines: [
    '#########',
    '#   .   #',
    '# $   $ #',
    '#  ###  #',
    '#  #.#  #',
    '#   $   #',
    '#  @ .  #',
    '#########'
  ] },
  { name: 'Over the ledge', lines: [
    '##########',
    '#   ..   #',
    '#  $  $  #',
    '#  ####  #',
    '#     $  #',
    '#@   . ###',
    '##########'
  ] },
  { name: 'Tight turns', lines: [
    '#########',
    '#   #   #',
    '# $ # . #',
    '#   #   #',
    '## ### ##',
    '#       #',
    '#  $ .  #',
    '#  @    #',
    '#########'
  ] }
]

export const ROOMS: Room[] = PLANS.map((plan) => parseRoom(plan.name, plan.lines))

/**
 * Which rooms a run is made of. Easy stops before the longest two, hard skips the three that are there to teach you
 * how pushing works. The order never changes, so "room 4" means the same room to everybody.
 */
export function roomsFor(difficulty: 'easy' | 'normal' | 'hard'): Room[] {
  if (difficulty === 'easy') return ROOMS.slice(0, 8)
  if (difficulty === 'hard') return ROOMS.slice(3)
  return ROOMS
}

/** What finishing a room is worth: more for more crates, less for every step and every undo. */
export function roomScore(crates: number, moves: number, undos: number, difficulty: 'easy' | 'normal' | 'hard'): number {
  const perMove = difficulty === 'hard' ? 4 : difficulty === 'easy' ? 1 : 2
  return Math.max(40, Math.round(120 + 60 * crates - moves * perMove - undos * 10))
}

/** Whether a saved run can be used. */
export function isRoomState(value: unknown): value is RoomState {
  const s = value as RoomState
  return Boolean(s && typeof s === 'object' && Number.isInteger(s.player) && Array.isArray(s.crates) && s.crates.every((c) => Number.isInteger(c)) && Number.isFinite(s.moves) && Number.isFinite(s.pushes))
}
