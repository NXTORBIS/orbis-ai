import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ENEMIES, GRID_COLS, readSaved, savable, GRID_ROWS, MAX_LEVEL, SLOW_FLOOR, TOWERS, buildableCells, chooseTarget, corners, damageDealt, makePath, newGame, placeTower, placementError, pathValid, pointAt, sellTower, sellValue, startWave, stepGame, strongerSlow, towerRange, upgradeCost, upgradeTower, waveBounty, waveComposition, waveReward } from './towerDefence.ts'
import type { Cell, Difficulty, Game, TowerKind } from './towerDefence.ts'

/**
 * A tower defence is a balance question, and a balance question can only be answered by playing it out. The last two
 * tests here do exactly that: twelve waves with a plain, sensible defence, which has to hold; and twelve waves with no
 * towers at all, which must not.
 */

const near = (cell: Cell, x: number, y: number, reach: number): boolean => (cell.x - x) ** 2 + (cell.y - y) ** 2 <= reach * reach

/** Where a person would put the next tower: over the longest stretch of path it can reach. */
function bestCell(game: Game, reach: number): Cell | null {
  let best: Cell | null = null
  let score = -1
  for (const cell of buildableCells(game)) {
    const covered = game.path.filter((p) => near(p, cell.x, cell.y, reach)).length
    if (covered > score) {
      score = covered
      best = cell
    }
  }
  return best
}

const buy = (game: Game, kind: TowerKind): boolean => {
  const cell = bestCell(game, TOWERS[kind].range[0])
  return cell ? !!placeTower(game, kind, cell.x, cell.y) : false
}

/** Spend what the last wave paid: cover the path, then a frost, then cannons for the brutes, then improve what is there. */
function spend(game: Game): void {
  for (let guard = 0; guard < 60; guard++) {
    if (game.towers.length < 5 && game.money >= TOWERS.spark.cost[0] && buy(game, 'spark')) continue
    if (game.wave >= 5 && !game.towers.some((t) => t.kind === 'frost') && game.money >= TOWERS.frost.cost[0] && buy(game, 'frost')) continue
    if (game.wave >= 6 && game.towers.filter((t) => t.kind === 'cannon').length < 2 && game.money >= TOWERS.cannon.cost[0] && buy(game, 'cannon')) continue
    const cheapest = game.towers
      .map((tower) => ({ tower, cost: upgradeCost(tower.kind, tower.level) }))
      .filter((one): one is { tower: Game['towers'][number]; cost: number } => one.cost !== null && one.cost <= game.money)
      .sort((a, b) => a.cost - b.cost)[0]
    if (cheapest && upgradeTower(game, cheapest.tower.id)) continue
    if (game.money >= TOWERS.spark.cost[0] && buy(game, 'spark')) continue
    break
  }
}

function play(seed: number, difficulty: Difficulty, waves: number, build: boolean): { game: Game; lostAt: number | null } {
  const game = newGame(seed, difficulty)
  for (let wave = 1; wave <= waves; wave++) {
    if (build) spend(game)
    startWave(game)
    let guard = 0
    while (game.phase === 'wave' && guard++ < 100000) stepGame(game, 16)
    assert.ok(guard < 100000, 'a wave that never ends')
    if (game.phase === 'lost') return { game, lostAt: wave }
  }
  return { game, lostAt: null }
}

test('every generated path runs edge to edge, one square at a time, and never doubles back', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const path = makePath(seed)
    assert.equal(pathValid(path), true, `seed ${seed} made a path that is not one`)
    assert.ok(corners(path) >= 2, `seed ${seed} made a straight line, which is no fun to defend`)
    assert.equal(path[0].x, 0)
    assert.equal(path.at(-1)!.x, GRID_COLS - 1)
    assert.ok(path.length >= GRID_COLS)
  }
})

test('a path with a jump in it, a repeat in it, or a kink back on itself is refused', () => {
  const straight = Array.from({ length: GRID_COLS }, (_, x) => ({ x, y: 5 }))
  assert.equal(pathValid(straight), true)
  assert.equal(pathValid(straight.filter((_, i) => i !== 4)), false, 'a square missing out of the middle')
  assert.equal(pathValid([...straight.slice(0, 5), { x: 4, y: 5 }, ...straight.slice(5)]), false, 'the same square twice')
  // Out and back one row up: the two runs lie against each other.
  const doubled = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 4 }, { x: 1, y: 4 }, { x: 1, y: 3 }]
  assert.equal(pathValid(doubled), false)
  assert.equal(pathValid(straight.map((c) => ({ ...c, y: GRID_ROWS + 1 }))), false, 'off the board')
})

test('every square of every path can be covered by something built beside it', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const game = newGame(seed, 'normal')
    const free = buildableCells(game)
    for (const cell of game.path) assert.ok(free.some((spot) => near(cell, spot.x, spot.y, TOWERS.spark.range[0])), `seed ${seed}: nothing can reach ${cell.x},${cell.y}`)
  }
})

test('something halfway between two squares is drawn halfway between them', () => {
  const path = [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 3 }]
  assert.deepEqual(pointAt(path, 0), { x: 0, y: 2 })
  assert.deepEqual(pointAt(path, 0.5), { x: 0.5, y: 2 })
  assert.deepEqual(pointAt(path, 1.25), { x: 1, y: 2.25 })
  assert.deepEqual(pointAt(path, 99), { x: 1, y: 3 }, 'past the end stays at the end')
  assert.deepEqual(pointAt(path, -5), { x: 0, y: 2 })
})

test('a tower shoots whatever is furthest along the path that it can reach', () => {
  const game = newGame(3, 'normal')
  const tower = placeTower(game, 'spark', ...pickBeside(game))!
  const reach = towerRange(tower)
  // Three enemies: one out of reach ahead, one in reach, one in reach but further back.
  const inReach = game.path.findIndex((cell) => near(cell, tower.x, tower.y, reach))
  const alsoInReach = game.path.findIndex((cell, i) => i > inReach && near(cell, tower.x, tower.y, reach))
  assert.ok(alsoInReach > inReach, 'this tower should see two squares of path')
  game.enemies = [
    { id: 1, kind: 'walker', hp: 10, maxHp: 10, progress: inReach, slowFactor: 1, slowLeftMs: 0 },
    { id: 2, kind: 'walker', hp: 10, maxHp: 10, progress: alsoInReach, slowFactor: 1, slowLeftMs: 0 },
    { id: 3, kind: 'walker', hp: 10, maxHp: 10, progress: game.path.length - 1, slowFactor: 1, slowLeftMs: 0 }
  ]
  assert.equal(chooseTarget(game, tower)?.id, 2, 'the one about to get through, of the ones it can reach')
  game.enemies = game.enemies.filter((e) => e.id === 3)
  assert.equal(chooseTarget(game, tower), null, 'nothing in reach is nothing to shoot')
})

function pickBeside(game: Game): [number, number] {
  const cell = bestCell(game, TOWERS.spark.range[0])!
  return [cell.x, cell.y]
}

test('armour comes off every hit, but a hit always does something', () => {
  assert.equal(damageDealt(5, 0), 5)
  assert.equal(damageDealt(5, 1), 4)
  assert.equal(damageDealt(5, 4), 1, 'a spark against a brute: one point a shot')
  assert.equal(damageDealt(5, 99), 1, 'never nothing, never a heal')
  assert.equal(damageDealt(22, 4), 18, 'a cannon against the same brute')
  // Which is the whole reason there is more than one kind of tower.
  const brute = ENEMIES.brute.armour
  assert.ok(damageDealt(TOWERS.cannon.damage[0], brute) > damageDealt(TOWERS.spark.damage[0], brute) * 10)
})

test('a second slow does not stack on the first, and nothing is ever stopped dead', () => {
  assert.equal(strongerSlow(1, 0.55), 0.55)
  assert.equal(strongerSlow(0.55, 0.55), 0.55, 'two frost towers are not twice as cold')
  assert.equal(strongerSlow(0.45, 0.55), 0.45, 'the stronger one wins')
  assert.equal(strongerSlow(0.35, 0.1), SLOW_FLOOR)
  assert.ok(SLOW_FLOOR > 0)
})

test('selling never pays back what was spent, so there is no money in building and selling', () => {
  for (const spent of [14, 34, 62, 156, 1000]) assert.ok(sellValue(spent) < spent, `${spent} sold for ${sellValue(spent)}`)
  const game = newGame(5, 'normal')
  const before = game.money
  const tower = placeTower(game, 'spark', ...pickBeside(game))!
  assert.equal(game.money, before - TOWERS.spark.cost[0])
  const back = sellTower(game, tower.id)
  assert.ok(game.money < before, 'the money went down over a build and a sale')
  assert.equal(game.money, before - TOWERS.spark.cost[0] + back)
  assert.equal(game.towers.length, 0)
  assert.equal(sellTower(game, 999), 0, 'selling something that is not there pays nothing')
})

test('a tower cannot stand on the path, on another tower, or on money that is not there', () => {
  const game = newGame(9, 'normal')
  const path = game.path[4]
  assert.equal(placementError(game, 'spark', path.x, path.y), 'The path has to stay clear')
  assert.equal(placementError(game, 'spark', -1, 3), 'Off the board')
  const spot = bestCell(game, TOWERS.spark.range[0])!
  assert.equal(placementError(game, 'spark', spot.x, spot.y), null)
  placeTower(game, 'spark', spot.x, spot.y)
  assert.equal(placementError(game, 'spark', spot.x, spot.y), 'Something is already there')
  game.money = 0
  const other = bestCell(game, TOWERS.spark.range[0])!
  assert.match(placementError(game, 'cannon', other.x, other.y)!, /costs/)
  assert.equal(placeTower(game, 'cannon', other.x, other.y), null)
})

test('a tower improves three times and no more, and each improvement costs more than the last', () => {
  const game = newGame(11, 'normal')
  game.money = 1000
  const tower = placeTower(game, 'spark', ...pickBeside(game))!
  let last = TOWERS.spark.cost[0]
  for (let level = 1; level < MAX_LEVEL; level++) {
    const cost = upgradeCost('spark', level)!
    assert.ok(cost > last, 'each improvement costs more')
    last = cost
    assert.equal(upgradeTower(game, tower.id), true)
    assert.ok(towerRange(tower) >= TOWERS.spark.range[0])
  }
  assert.equal(tower.level, MAX_LEVEL)
  assert.equal(upgradeCost('spark', MAX_LEVEL), null)
  assert.equal(upgradeTower(game, tower.id), false)
})

test('every wave asks for more and pays more, and the brutes keep to themselves until the sixth', () => {
  const worth = (wave: number): number => waveBounty(wave) + waveReward(wave)
  for (let wave = 1; wave <= 20; wave++) {
    const spawns = waveComposition(wave)
    assert.ok(spawns.length > 0)
    for (let i = 1; i < spawns.length; i++) assert.ok(spawns[i].atMs >= spawns[i - 1].atMs, 'the arrivals are in order')
    if (wave < 6) assert.equal(spawns.some((s) => s.kind === 'brute'), false, `a brute in wave ${wave}`)
    // Three waves at a time, because a swarm wave is worth a lot of very small bounties and the wave after it is not.
    assert.ok(worth(wave + 3) > worth(wave), `wave ${wave + 3} pays no more than wave ${wave}`)
    assert.ok(waveComposition(wave + 3).length > spawns.length, `wave ${wave + 3} asks no more than wave ${wave}`)
  }
  assert.equal(waveComposition(1).every((s) => s.kind === 'walker'), true, 'the first wave is one kind of thing')
  assert.ok(waveComposition(12).length > waveComposition(2).length * 2)
})

test('there is always enough money for the next tower', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const game = newGame(1, difficulty)
    assert.ok(game.money >= TOWERS.spark.cost[0] * 3, 'three towers to start with, at least')
    assert.ok(game.lives >= 10)
  }
  // Surviving a wave always pays for something, so a game can never get stuck with towers it cannot add to.
  for (let wave = 1; wave <= 12; wave++) assert.ok(waveBounty(wave) + waveReward(wave) >= TOWERS.spark.cost[0], `wave ${wave} pays less than a tower costs`)
})

test('a plain defence holds twelve waves on easy and on normal, and gets past the eighth on hard', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const difficulty of ['easy', 'normal'] as const) {
      const { game, lostAt } = play(seed, difficulty, 12, true)
      assert.equal(lostAt, null, `${difficulty} seed ${seed} fell at wave ${lostAt}`)
      assert.equal(game.wave, 13)
      assert.ok(game.score > 0)
      assert.ok(game.killed > 50, 'it held by shooting things, not by the enemies not turning up')
    }
    // Hard is meant to hurt. What it may not be is impossible.
    const hard = play(seed, 'hard', 12, true)
    assert.ok(hard.lostAt === null || hard.lostAt >= 8, `hard seed ${seed} fell at wave ${hard.lostAt}`)
  }
})

test('a wave with nothing in its way gets through, on every difficulty', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    const { game, lostAt } = play(1, difficulty, 12, false)
    assert.ok(lostAt !== null, `${difficulty} survived twelve waves with no towers at all`)
    assert.equal(game.phase, 'lost')
    assert.equal(game.lives, 0)
    assert.ok(game.leaked >= game.lives)
  }
})

test('a saved game comes back whole, and a damaged one is refused rather than half loaded', () => {
  const game = newGame(6, 'normal')
  game.money = 300
  for (let i = 0; i < 4; i++) {
    const cell = bestCell(game, TOWERS.spark.range[0])
    if (cell) placeTower(game, 'spark', cell.x, cell.y)
  }
  upgradeTower(game, game.towers[0].id)
  game.wave = 5
  game.score = 1234
  const saved = savable(game) as Record<string, unknown>
  const back = readSaved(saved)!
  assert.ok(back)
  assert.equal(back.towers.length, 4)
  assert.equal(back.towers[0].level, 2)
  assert.equal(back.wave, 5)
  assert.equal(back.score, 1234)
  assert.equal(back.phase, 'building', 'a game comes back between waves, never mid-fight')
  assert.deepEqual(back.enemies, [])
  assert.equal(readSaved(null), null)
  assert.equal(readSaved({}), null)
  assert.equal(readSaved({ ...saved, path: [{ x: 0, y: 0 }] }), null, 'a path that is not a path')
  assert.equal(readSaved({ ...saved, difficulty: 'brutal' }), null)
  assert.equal(readSaved({ ...saved, lives: 0 }), null)
  assert.equal(readSaved({ ...saved, money: 'lots' }), null)
  assert.equal(readSaved({ ...saved, towers: [{ kind: 'laser', level: 1, x: 2, y: 2, spent: 10 }] }), null, 'a tower this version has never heard of')
  const onThePath = { ...saved, towers: [{ kind: 'spark', level: 1, x: game.path[3].x, y: game.path[3].y, spent: 14 }] }
  assert.equal(readSaved(onThePath), null, 'a tower standing in the road')
})

test('the wave ends when the last one is dead, and the money arrives with it', () => {
  const game = newGame(4, 'easy')
  game.money = 500
  for (let i = 0; i < 5; i++) {
    const cell = bestCell(game, TOWERS.cannon.range[0])
    if (cell) placeTower(game, 'cannon', cell.x, cell.y)
  }
  const before = game.money
  startWave(game)
  assert.equal(game.phase, 'wave')
  assert.equal(startWave(game), false, 'a wave cannot be started twice')
  let guard = 0
  while (game.phase === 'wave' && guard++ < 100000) stepGame(game, 16)
  assert.equal(game.phase, 'building')
  assert.equal(game.enemies.length, 0)
  assert.equal(game.wave, 2)
  assert.ok(game.money > before, 'the bounties and the reward arrived')
  assert.equal(game.lives, 25, 'nothing got through five cannons in wave one')
})
