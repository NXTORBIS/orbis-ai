/**
 * Hold the Line: the path, the three kinds of tower, the four kinds of enemy, and the whole fight.
 *
 * The fight itself lives here rather than in the game file, and that is the point: a tower defence is a balance
 * question -- can the waves be held with the money the waves pay? -- and a balance question can only be answered by
 * playing it out. The test beside this file plays twelve waves with a plain, sensible defence and insists the line
 * holds, and plays the same twelve with no towers at all and insists it does not. Numbers tuned by eye would pass
 * neither.
 *
 * The one deliberate break with the rest of `src/shared`: `stepGame` changes the state it is given instead of
 * returning a new one. It runs sixty times a second with a hundred things moving, and copying all of it that often
 * would cost more than the whole game.
 */

import { range, seeded } from './random.ts'

export const GRID_COLS = 18
export const GRID_ROWS = 11

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface Cell {
  x: number
  y: number
}

// ---------------------------------------------------------------- the path

/**
 * A path from the left edge to the right edge: straight runs to the right, joined by climbs of at least two rows, so
 * no two parts of it ever lie against each other. `pathValid` is what decides whether a generated one is used.
 */
export function makePath(seed: number): Cell[] {
  for (let attempt = 0; attempt < 24; attempt++) {
    const rng = seeded((seed + attempt * 7919) >>> 0)
    const cells: Cell[] = []
    let x = 0
    let y = range(rng, 2, GRID_ROWS - 3)
    cells.push({ x, y })
    const turns = range(rng, 2, 4)
    for (let turn = 0; turn < turns; turn++) {
      const run = range(rng, 2, Math.max(2, Math.floor((GRID_COLS - 2 - x) / (turns - turn))))
      for (let i = 0; i < run && x < GRID_COLS - 1; i++) cells.push({ x: ++x, y })
      const climb = range(rng, 2, 4)
      // Climb towards whichever side has the room. Picking blind and giving up when it does not fit is what made
      // seed 3 a straight line across the middle.
      const wanted = rng() < 0.5 ? -1 : 1
      const up = y + wanted * climb >= 1 && y + wanted * climb <= GRID_ROWS - 2 ? wanted : -wanted
      if (y + up * climb < 1 || y + up * climb > GRID_ROWS - 2) continue
      for (let i = 0; i < climb; i++) cells.push({ x, y: (y += up) })
    }
    while (x < GRID_COLS - 1) cells.push({ x: ++x, y })
    if (pathValid(cells) && corners(cells) >= 2) return cells
  }
  // The straight line across the middle: dull, but it is a path, and it is never reached in a thousand seeds.
  return Array.from({ length: GRID_COLS }, (_, x) => ({ x, y: Math.floor(GRID_ROWS / 2) }))
}

/** How many times the path turns. A path with no turns is a straight line, which is no fun to defend. */
export function corners(cells: Cell[]): number {
  let count = 0
  for (let i = 2; i < cells.length; i++) {
    const before = { x: cells[i - 1].x - cells[i - 2].x, y: cells[i - 1].y - cells[i - 2].y }
    const after = { x: cells[i].x - cells[i - 1].x, y: cells[i].y - cells[i - 1].y }
    if (before.x !== after.x || before.y !== after.y) count++
  }
  return count
}

/** A path has to start at the left edge, end at the right, step one square at a time, and never come back on itself. */
export function pathValid(cells: Cell[]): boolean {
  if (cells.length < GRID_COLS || cells[0].x !== 0 || cells.at(-1)!.x !== GRID_COLS - 1) return false
  const seen = new Set<number>()
  for (const cell of cells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= GRID_COLS || cell.y >= GRID_ROWS) return false
    const key = cell.y * GRID_COLS + cell.x
    if (seen.has(key)) return false
    seen.add(key)
  }
  for (let i = 1; i < cells.length; i++) {
    const step = Math.abs(cells[i].x - cells[i - 1].x) + Math.abs(cells[i].y - cells[i - 1].y)
    if (step !== 1) return false
  }
  // Two squares of path next to each other that are not next to each other along the path: the path has doubled back.
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 2; j < cells.length; j++)
      if (Math.abs(cells[i].x - cells[j].x) + Math.abs(cells[i].y - cells[j].y) === 1) return false
  return true
}

/** Where something that has walked `progress` squares along the path is, between squares included. */
export function pointAt(path: Cell[], progress: number): Cell {
  const clamped = Math.max(0, Math.min(path.length - 1, progress))
  const i = Math.floor(clamped)
  const next = path[Math.min(path.length - 1, i + 1)]
  const t = clamped - i
  return { x: path[i].x + (next.x - path[i].x) * t, y: path[i].y + (next.y - path[i].y) * t }
}

export const onPath = (path: Cell[], x: number, y: number): boolean => path.some((cell) => cell.x === x && cell.y === y)

// ---------------------------------------------------------------- towers

export type TowerKind = 'spark' | 'cannon' | 'frost'

export interface TowerSpec {
  kind: TowerKind
  name: string
  /** What it is for, in the words the player is shown. */
  what: string
  /** The price of building it, then of each improvement. */
  cost: [number, number, number]
  range: [number, number, number]
  damage: [number, number, number]
  reloadMs: [number, number, number]
  /** The cannon's blast, in squares. */
  splash?: [number, number, number]
  /** What the frost tower leaves an enemy moving at, and for how long. */
  slowTo?: [number, number, number]
  slowMs?: [number, number, number]
}

export const TOWERS: Record<TowerKind, TowerSpec> = {
  spark: { kind: 'spark', name: 'Spark', what: 'Shoots fast for very little. Next to useless against armour.', cost: [14, 20, 28], range: [2.2, 2.6, 3], damage: [5, 8, 12], reloadMs: [360, 300, 240] },
  cannon: { kind: 'cannon', name: 'Cannon', what: 'Slow, heavy, and hits everything around what it hits.', cost: [40, 48, 68], range: [2.8, 3.1, 3.5], damage: [22, 36, 58], reloadMs: [1200, 1100, 1000], splash: [1.1, 1.3, 1.6] },
  frost: { kind: 'frost', name: 'Frost', what: 'Barely hurts anything. Everything it touches slows down.', cost: [25, 31, 42], range: [2.4, 2.8, 3.2], damage: [2, 3, 4], reloadMs: [700, 650, 600], slowTo: [0.55, 0.45, 0.35], slowMs: [1200, 1400, 1600] }
}

export const TOWER_KINDS: TowerKind[] = ['spark', 'cannon', 'frost']
export const MAX_LEVEL = 3

export interface Tower {
  id: number
  kind: TowerKind
  level: number
  x: number
  y: number
  /** Everything paid for it so far, which is what a sale is worked out from. */
  spent: number
  reloadLeftMs: number
  kills: number
}

/** What the next improvement costs, or null when there is nothing left to improve. */
export const upgradeCost = (kind: TowerKind, level: number): number | null => (level >= MAX_LEVEL ? null : TOWERS[kind].cost[level])

/**
 * What a sale pays back: three fifths of everything that went into it, rounded down. Never the whole price -- a sale
 * that paid back what it cost would make building and selling in a circle a way of moving towers around for nothing.
 */
export const sellValue = (spent: number): number => Math.floor(spent * 0.6)

const at = <T>(list: [T, T, T], level: number): T => list[Math.max(0, Math.min(2, level - 1))]

export const towerRange = (tower: Tower): number => at(TOWERS[tower.kind].range, tower.level)
export const towerDamage = (tower: Tower): number => at(TOWERS[tower.kind].damage, tower.level)
export const towerReload = (tower: Tower): number => at(TOWERS[tower.kind].reloadMs, tower.level)

// ---------------------------------------------------------------- enemies

export type EnemyKind = 'runner' | 'walker' | 'brute' | 'swarm'

export interface EnemySpec {
  kind: EnemyKind
  name: string
  hp: number
  /** Squares a second. */
  speed: number
  /** Taken off every hit, which is what makes fast weak towers no answer to a brute. */
  armour: number
  bounty: number
}

export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  runner: { kind: 'runner', name: 'Runner', hp: 28, speed: 2.6, armour: 0, bounty: 2 },
  walker: { kind: 'walker', name: 'Walker', hp: 46, speed: 1.5, armour: 1, bounty: 3 },
  brute: { kind: 'brute', name: 'Brute', hp: 190, speed: 0.85, armour: 4, bounty: 8 },
  swarm: { kind: 'swarm', name: 'Swarm', hp: 14, speed: 2, armour: 0, bounty: 1 }
}

export interface Enemy {
  id: number
  kind: EnemyKind
  hp: number
  maxHp: number
  progress: number
  /** 1 is full speed. */
  slowFactor: number
  slowLeftMs: number
}

/** Armour comes off every hit, but a hit always does something: one point, however thick the armour. */
export const damageDealt = (damage: number, armour: number): number => Math.max(1, Math.round(damage - armour))

/**
 * A second slow never stacks on the first: whichever is the stronger wins, and nothing goes below a third speed. Slows
 * that multiplied would let three frost towers stop a wave dead, which is not a defence, it is a wall.
 */
export const SLOW_FLOOR = 0.33
export const strongerSlow = (current: number, incoming: number): number => Math.max(SLOW_FLOOR, Math.min(current, incoming))

// ---------------------------------------------------------------- waves

export interface Spawn {
  kind: EnemyKind
  atMs: number
}

const HARDNESS: Record<Difficulty, { hp: number; money: number; lives: number }> = {
  easy: { hp: 0.8, money: 75, lives: 25 },
  normal: { hp: 1, money: 55, lives: 20 },
  hard: { hp: 1.2, money: 55, lives: 14 }
}

export const startMoney = (difficulty: Difficulty): number => HARDNESS[difficulty].money
export const startLives = (difficulty: Difficulty): number => HARDNESS[difficulty].lives

/** How much stronger everything in this wave is. Health only: nothing ever moves faster than its own kind does. */
export const waveHealth = (wave: number, difficulty: Difficulty): number => (1 + 0.13 * (wave - 1)) * HARDNESS[difficulty].hp

/** What surviving a wave pays, on top of the bounties. */
export const waveReward = (wave: number): number => 8 + 2 * wave

/** Who turns up in a wave, and when. Every wave is worth more than the one before it and asks for more. */
export function waveComposition(wave: number): Spawn[] {
  const spawns: Spawn[] = []
  let atMs = 0
  const add = (kind: EnemyKind, count: number, gapMs: number): void => {
    for (let i = 0; i < count; i++) {
      spawns.push({ kind, atMs })
      atMs += gapMs
    }
  }
  add('walker', 2 + Math.floor(wave * 0.8), 700)
  if (wave >= 3) add('runner', 1 + Math.floor(wave * 0.6), 420)
  // The swarm turns up on every third wave from the fifth: a lot of very weak things at once, which a cannon answers
  // and a line of spark towers does not.
  if (wave >= 5 && wave % 3 === 2) add('swarm', 3 + wave, 200)
  if (wave >= 6) add('brute', Math.floor((wave - 4) / 2), 1600)
  return spawns.sort((a, b) => a.atMs - b.atMs)
}

/** What a whole wave is worth in bounties, which is how the test knows the money can never run out. */
export const waveBounty = (wave: number): number => waveComposition(wave).reduce((sum, spawn) => sum + ENEMIES[spawn.kind].bounty, 0)

// ---------------------------------------------------------------- the fight

export interface Shot {
  fromX: number
  fromY: number
  toX: number
  toY: number
  kind: TowerKind
  leftMs: number
}

export interface Game {
  path: Cell[]
  towers: Tower[]
  enemies: Enemy[]
  /** Only for the drawing, but kept here so the game file needs no clock of its own. */
  shots: Shot[]
  queue: Spawn[]
  waveMs: number
  wave: number
  money: number
  lives: number
  score: number
  phase: 'building' | 'wave' | 'lost'
  difficulty: Difficulty
  nextId: number
  killed: number
  leaked: number
}

export function newGame(seed: number, difficulty: Difficulty): Game {
  return { path: makePath(seed), towers: [], enemies: [], shots: [], queue: [], waveMs: 0, wave: 1, money: startMoney(difficulty), lives: startLives(difficulty), score: 0, phase: 'building', difficulty, nextId: 1, killed: 0, leaked: 0 }
}

/** Why a tower cannot go there, in the words the player is shown, or null when it can. */
export function placementError(game: Game, kind: TowerKind, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return 'Off the board'
  if (onPath(game.path, x, y)) return 'The path has to stay clear'
  if (game.towers.some((t) => t.x === x && t.y === y)) return 'Something is already there'
  if (game.money < TOWERS[kind].cost[0]) return `${TOWERS[kind].name} costs ${TOWERS[kind].cost[0]}`
  return null
}

export function placeTower(game: Game, kind: TowerKind, x: number, y: number): Tower | null {
  if (placementError(game, kind, x, y)) return null
  const cost = TOWERS[kind].cost[0]
  game.money -= cost
  const tower: Tower = { id: game.nextId++, kind, level: 1, x, y, spent: cost, reloadLeftMs: 0, kills: 0 }
  game.towers.push(tower)
  return tower
}

export function upgradeTower(game: Game, id: number): boolean {
  const tower = game.towers.find((t) => t.id === id)
  if (!tower) return false
  const cost = upgradeCost(tower.kind, tower.level)
  if (cost === null || game.money < cost) return false
  game.money -= cost
  tower.spent += cost
  tower.level++
  return true
}

export function sellTower(game: Game, id: number): number {
  const index = game.towers.findIndex((t) => t.id === id)
  if (index < 0) return 0
  const paid = sellValue(game.towers[index].spent)
  game.money += paid
  game.towers.splice(index, 1)
  return paid
}

export function startWave(game: Game): boolean {
  if (game.phase !== 'building') return false
  game.queue = waveComposition(game.wave)
  game.waveMs = 0
  game.phase = 'wave'
  return true
}

/** Which enemy a tower shoots: the one furthest along the path that it can reach. The one about to get through. */
export function chooseTarget(game: Game, tower: Tower): Enemy | null {
  const reach = towerRange(tower)
  let best: Enemy | null = null
  for (const enemy of game.enemies) {
    if (enemy.hp <= 0) continue
    const where = pointAt(game.path, enemy.progress)
    if ((where.x - tower.x) ** 2 + (where.y - tower.y) ** 2 > reach * reach) continue
    if (!best || enemy.progress > best.progress) best = enemy
  }
  return best
}

const hurt = (game: Game, enemy: Enemy, damage: number, tower: Tower): void => {
  // Already dead and not yet cleared away: shooting it again must not pay the bounty twice.
  if (enemy.hp <= 0) return
  enemy.hp -= damageDealt(damage, ENEMIES[enemy.kind].armour)
  if (enemy.hp > 0) return
  game.money += ENEMIES[enemy.kind].bounty
  game.score += ENEMIES[enemy.kind].bounty * 2
  game.killed++
  tower.kills++
}

/**
 * The fight, moved on by `dtMs`: who has turned up, who has moved, who has been shot, who got through. Called with a
 * small step (the game uses a fixed one), so nothing here has to cope with an enemy crossing the whole board at once.
 */
export function stepGame(game: Game, dtMs: number): void {
  if (game.phase !== 'wave') {
    for (const shot of game.shots) shot.leftMs -= dtMs
    game.shots = game.shots.filter((s) => s.leftMs > 0)
    return
  }
  game.waveMs += dtMs
  while (game.queue.length && game.queue[0].atMs <= game.waveMs) {
    const spawn = game.queue.shift()!
    const spec = ENEMIES[spawn.kind]
    const hp = Math.round(spec.hp * waveHealth(game.wave, game.difficulty))
    game.enemies.push({ id: game.nextId++, kind: spawn.kind, hp, maxHp: hp, progress: 0, slowFactor: 1, slowLeftMs: 0 })
  }

  // Move, and count out whoever got through.
  const end = game.path.length - 1
  for (const enemy of game.enemies) {
    if (enemy.slowLeftMs > 0) {
      enemy.slowLeftMs -= dtMs
      if (enemy.slowLeftMs <= 0) enemy.slowFactor = 1
    }
    enemy.progress += (ENEMIES[enemy.kind].speed * enemy.slowFactor * dtMs) / 1000
  }
  const through = game.enemies.filter((e) => e.progress >= end)
  if (through.length) {
    game.lives -= through.length
    game.leaked += through.length
    game.enemies = game.enemies.filter((e) => e.progress < end)
    if (game.lives <= 0) {
      game.lives = 0
      game.phase = 'lost'
      return
    }
  }

  // Shoot.
  for (const tower of game.towers) {
    tower.reloadLeftMs -= dtMs
    if (tower.reloadLeftMs > 0) continue
    const target = chooseTarget(game, tower)
    if (!target) {
      tower.reloadLeftMs = 0
      continue
    }
    tower.reloadLeftMs = towerReload(tower)
    const spec = TOWERS[tower.kind]
    const where = pointAt(game.path, target.progress)
    game.shots.push({ fromX: tower.x, fromY: tower.y, toX: where.x, toY: where.y, kind: tower.kind, leftMs: 110 })
    hurt(game, target, towerDamage(tower), tower)
    if (spec.splash) {
      const blast = at(spec.splash, tower.level)
      for (const other of game.enemies) {
        if (other === target || other.hp <= 0) continue
        const point = pointAt(game.path, other.progress)
        if ((point.x - where.x) ** 2 + (point.y - where.y) ** 2 <= blast * blast) hurt(game, other, towerDamage(tower) / 2, tower)
      }
    }
    if (spec.slowTo && spec.slowMs) {
      target.slowFactor = strongerSlow(target.slowFactor, at(spec.slowTo, tower.level))
      target.slowLeftMs = Math.max(target.slowLeftMs, at(spec.slowMs, tower.level))
    }
  }
  game.enemies = game.enemies.filter((e) => e.hp > 0)
  for (const shot of game.shots) shot.leftMs -= dtMs
  game.shots = game.shots.filter((s) => s.leftMs > 0)

  // The wave is over when nobody is left to turn up and nobody is left standing.
  if (!game.queue.length && !game.enemies.length) {
    game.score += waveReward(game.wave) * 3
    game.money += waveReward(game.wave)
    game.wave++
    game.phase = 'building'
    game.waveMs = 0
  }
}

/**
 * A saved game read back, or null when it cannot be trusted.
 *
 * Everything is checked rather than assumed: a path that is not a path, a tower standing on it, a level that does not
 * exist. A saved game that half loads is worse than one that does not load at all, because the player keeps the score
 * and loses the board.
 */
export function readSaved(raw: unknown): Game | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<Game>
  if (!Array.isArray(data.path) || !data.path.every((cell) => cell && Number.isInteger(cell.x) && Number.isInteger(cell.y)) || !pathValid(data.path)) return null
  if (!Array.isArray(data.towers) || !['easy', 'normal', 'hard'].includes(data.difficulty as string)) return null
  const whole = (value: unknown, min: number, max: number): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null)
  const wave = whole(data.wave, 1, 999)
  const money = whole(data.money, 0, 1e6)
  const lives = whole(data.lives, 1, 999)
  const score = whole(data.score, 0, 1e9)
  if (wave === null || money === null || lives === null || score === null) return null
  const towers: Tower[] = []
  for (const one of data.towers) {
    const tower = one as Partial<Tower>
    const level = whole(tower.level, 1, MAX_LEVEL)
    const x = whole(tower.x, 0, GRID_COLS - 1)
    const y = whole(tower.y, 0, GRID_ROWS - 1)
    const spent = whole(tower.spent, 0, 1e6)
    if (level === null || x === null || y === null || spent === null) return null
    if (!TOWER_KINDS.includes(tower.kind as TowerKind)) return null
    if (onPath(data.path, x, y) || towers.some((other) => other.x === x && other.y === y)) return null
    towers.push({ id: towers.length + 1, kind: tower.kind as TowerKind, level, x, y, spent, reloadLeftMs: 0, kills: 0 })
  }
  return { path: data.path, towers, enemies: [], shots: [], queue: [], waveMs: 0, wave, money, lives, score, phase: 'building', difficulty: data.difficulty as Difficulty, nextId: towers.length + 1, killed: whole(data.killed, 0, 1e9) ?? 0, leaked: whole(data.leaked, 0, 1e9) ?? 0 }
}

/** What is worth keeping of a game in progress: the board, not the fight. A wave in flight is never saved mid-flight. */
export const savable = (game: Game): unknown => ({ path: game.path, towers: game.towers.map(({ kind, level, x, y, spent }) => ({ kind, level, x, y, spent })), wave: game.wave, money: game.money, lives: game.lives, score: game.score, difficulty: game.difficulty, killed: game.killed, leaked: game.leaked })

/** The squares a tower could go on: not the path, not already taken. */
export function buildableCells(game: Game): Cell[] {
  const out: Cell[] = []
  for (let y = 0; y < GRID_ROWS; y++) for (let x = 0; x < GRID_COLS; x++) if (!placementError({ ...game, money: Infinity }, 'spark', x, y)) out.push({ x, y })
  return out
}
