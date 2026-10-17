import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, fitCanvas, palette, seeded } from './engine'
import type { ChaseSituation, HunterKind, Maze, Spot } from '../../../shared/games/mazeChase'
import { at, buildMaze, clearBonus, DOT_POINTS, dotsLeft, HUNTER_KINDS, HUNTER_NOTES, HUNTER_POINTS, hunterStep, hunterTarget, isWall, levelTuning, MAZE_LEVELS, PILL_POINTS, wrapX } from '../../../shared/games/mazeChase'

interface Mover {
  /** The square it is standing on, or the one it has just left. */
  cell: Spot
  dir: Spot
  /** How far it has gone from that square towards the next, 0 to 1. */
  offset: number
}

interface Hunter extends Mover {
  kind: HunterKind
  state: 'hunt' | 'fright' | 'eaten'
  corner: Spot
  whim: number
  whimLeft: number
}

/**
 * Maze Chase: eat every dot while four hunters come after you. The power pills in the corners turn the tables for a
 * few seconds, and the row through the middle runs out of one side and in at the other.
 *
 * The four hunters are the game. One comes straight at you; one aims at the square you are heading for, so running in
 * a straight line walks you into it; one loses interest as soon as you are close and wanders off to a corner; and one
 * hangs back five squares behind you, which is exactly where you want to run when something else is in front. They
 * all walk the same way — at each square, take the opening that gets closest to what you are aiming at, and never
 * turn back on yourself — so what makes them different is only ever the square they want.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 760
  let H = 520
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const base = MAZE_LEVELS[ctx.prefs.difficulty]

  let status: GameStatus = 'ready'
  let maze: Maze = buildMaze(seeded(1), { attempts: base.attempts })
  let tuned = levelTuning(base, 1)
  let level = 1
  let lives = base.lives
  let points = 0
  let elapsed = 0
  let lastEmit = 0
  let seedBase = Math.floor(Math.random() * 1e9)
  let player: Mover = { cell: { ...maze.start }, dir: { x: 0, y: 0 }, offset: 0 }
  let facing: Spot = { x: 1, y: 0 }
  let want: Spot = { x: 0, y: 0 }
  let hunters: Hunter[] = []
  let frightLeft = 0
  let eatenThisPill = 0
  /** Nothing moves while this is counting down: after a death, and between levels. */
  let freeze = 0
  let message = ''

  const stepCell = (cell: Spot, dir: Spot): Spot => ({ x: wrapX(maze, cell.x + dir.x, cell.y + dir.y), y: cell.y + dir.y })
  const open = (cell: Spot, dir: Spot): boolean => (dir.x || dir.y ? !isWall(maze, cell.x + dir.x, cell.y + dir.y) : false)
  const posOf = (m: Mover): Spot => ({ x: m.cell.x + m.dir.x * m.offset, y: m.cell.y + m.dir.y * m.offset })

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: points,
      level,
      lives,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: Math.round((tuned.hunterSpeed / base.hunterSpeed) * 100) / 100,
      hud: [
        { label: 'Left to eat', value: dotsLeft(maze) },
        { label: 'Pill', value: frightLeft > 0 ? `${frightLeft.toFixed(1)}s` : '—' }
      ]
    })
  }

  const placeHunters = (): void => {
    hunters = HUNTER_KINDS.map((kind, i) => ({
      kind,
      cell: { x: wrapX(maze, maze.home.x + [-2, -1, 1, 2][i], maze.home.y), y: maze.home.y },
      dir: { x: i % 2 ? 1 : -1, y: 0 },
      offset: 0,
      state: 'hunt',
      corner: maze.corners[i] ?? maze.corners[0],
      whim: Math.random(),
      whimLeft: base.whimEvery
    }))
  }

  const placePlayer = (): void => {
    player = { cell: { ...maze.start }, dir: { x: 0, y: 0 }, offset: 0 }
    facing = { x: 1, y: 0 }
    want = { x: 0, y: 0 }
  }

  const newLevel = (): void => {
    maze = buildMaze(seeded(seedBase + level * 7919), { attempts: base.attempts })
    tuned = levelTuning(base, level)
    placePlayer()
    placeHunters()
    frightLeft = 0
    eatenThisPill = 0
  }

  const reset = (): void => {
    status = 'ready'
    level = 1
    lives = base.lives
    points = 0
    elapsed = 0
    freeze = 0
    message = ''
    seedBase = Math.floor(Math.random() * 1e9)
    newLevel()
    emit(true)
  }

  const situationFor = (h: Hunter): ChaseSituation => ({
    player: { x: Math.round(posOf(player).x), y: Math.round(posOf(player).y) },
    facing,
    hunter: h.cell,
    corner: h.corner,
    corners: maze.corners,
    look: base.look,
    whim: h.whim,
    frightened: h.state === 'fright',
    cols: maze.cols,
    rows: maze.rows
  })

  /** Turning back on yourself: the square ahead becomes the square behind, and the rest of the step carries on. */
  const reverse = (m: Mover): void => {
    if (!m.dir.x && !m.dir.y) return
    m.cell = stepCell(m.cell, m.dir)
    m.dir = { x: -m.dir.x, y: -m.dir.y }
    m.offset = 1 - m.offset
  }

  const eatHere = (): void => {
    const i = at(maze, player.cell.x, player.cell.y)
    if (maze.dots[i]) {
      maze.dots[i] = false
      points += DOT_POINTS * level
      ctx.audio.blip(520 + (dotsLeft(maze) % 7) * 20, 28, 'square', 0.35)
    }
    if (maze.pills[i]) {
      maze.pills[i] = false
      points += PILL_POINTS * level
      frightLeft = tuned.fright
      eatenThisPill = 0
      for (const h of hunters) {
        if (h.state !== 'hunt') continue
        h.state = 'fright'
        reverse(h)
      }
      ctx.audio.blip(180, 220, 'sine', 0.9)
    }
    if (!dotsLeft(maze)) {
      points += clearBonus(level)
      level++
      message = `Maze clear. On to maze ${level}.`
      freeze = 2.2
      newLevel()
      ctx.audio.blip(990, 300, 'triangle')
    }
  }

  const movePlayer = (dt: number): void => {
    const speed = base.playerSpeed
    if ((want.x || want.y) && want.x === -player.dir.x && want.y === -player.dir.y) {
      reverse(player)
      facing = { ...player.dir }
    }
    if (!player.dir.x && !player.dir.y) {
      if (open(player.cell, want)) {
        player.dir = { ...want }
        facing = { ...want }
      } else return
    }
    player.offset += speed * dt
    while (player.offset >= 1) {
      player.offset -= 1
      player.cell = stepCell(player.cell, player.dir)
      eatHere()
      if (freeze > 0) {
        player.offset = 0
        return
      }
      if (open(player.cell, want)) {
        player.dir = { ...want }
        facing = { ...want }
      }
      if (!open(player.cell, player.dir)) {
        player.dir = { x: 0, y: 0 }
        player.offset = 0
        return
      }
    }
  }

  const moveHunter = (h: Hunter, dt: number): void => {
    const speed = h.state === 'fright' ? tuned.hunterSpeed * 0.55 : h.state === 'eaten' ? tuned.hunterSpeed * 2.1 : tuned.hunterSpeed
    h.whimLeft -= dt
    if (h.whimLeft <= 0) {
      h.whim = Math.random()
      h.whimLeft = base.whimEvery
    }
    if (!h.dir.x && !h.dir.y) h.dir = hunterStep(maze, h.cell, { x: 0, y: 0 }, h.state === 'eaten' ? maze.home : hunterTarget(h.kind, situationFor(h)))
    h.offset += speed * dt
    while (h.offset >= 1) {
      h.offset -= 1
      h.cell = stepCell(h.cell, h.dir)
      if (h.state === 'eaten' && h.cell.x === maze.home.x && h.cell.y === maze.home.y) {
        h.state = 'hunt'
        ctx.audio.blip(300, 90, 'sine', 0.5)
      }
      const target = h.state === 'eaten' ? maze.home : hunterTarget(h.kind, situationFor(h))
      h.dir = hunterStep(maze, h.cell, h.dir, target)
      if (!h.dir.x && !h.dir.y) {
        h.offset = 0
        return
      }
    }
  }

  const gapTo = (h: Hunter): number => {
    const a = posOf(player)
    const b = posOf(h)
    let dx = a.x - b.x
    if (Math.abs(dx) > maze.cols / 2) dx -= Math.sign(dx) * maze.cols
    return Math.hypot(dx, a.y - b.y)
  }

  const caught = (): void => {
    lives--
    ctx.audio.blip(140, 420, 'sawtooth')
    if (lives <= 0) {
      status = 'over'
      message = ''
      emit(true)
      ctx.over({ score: points, extra: { difficulty: ctx.prefs.difficulty, bestStreak: level } })
      return
    }
    message = `Caught. ${lives} ${lives === 1 ? 'life' : 'lives'} left.`
    freeze = 1.6
    placePlayer()
    placeHunters()
    frightLeft = 0
  }

  const touch = (): void => {
    for (const h of hunters) {
      if (h.state === 'eaten' || gapTo(h) > 0.68) continue
      if (h.state === 'fright') {
        h.state = 'eaten'
        points += HUNTER_POINTS[Math.min(HUNTER_POINTS.length - 1, eatenThisPill)] * level
        eatenThisPill++
        ctx.audio.blip(1100 - eatenThisPill * 120, 160, 'triangle')
      } else {
        caught()
        return
      }
    }
  }

  const steerFromPointer = (): void => {
    const cell = Math.min(W / maze.cols, H / maze.rows)
    const ox = (W - cell * maze.cols) / 2
    const oy = (H - cell * maze.rows) / 2
    const here = posOf(player)
    const dx = ctx.input.pointer.x - (ox + (here.x + 0.5) * cell)
    const dy = ctx.input.pointer.y - (oy + (here.y + 0.5) * cell)
    if (Math.abs(dx) < cell * 0.4 && Math.abs(dy) < cell * 0.4) return
    want = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (input.pressed('ArrowUp', 'KeyW')) want = { x: 0, y: -1 }
    if (input.pressed('ArrowDown', 'KeyS')) want = { x: 0, y: 1 }
    if (input.pressed('ArrowLeft', 'KeyA')) want = { x: -1, y: 0 }
    if (input.pressed('ArrowRight', 'KeyD')) want = { x: 1, y: 0 }
    if (input.taps > 0) steerFromPointer()
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (want.x || want.y)) {
      status = 'running'
      message = ''
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt
    if (freeze > 0) {
      freeze -= dt
      if (freeze <= 0) message = ''
      emit()
      return input.endStep()
    }
    movePlayer(dt)
    if (frightLeft > 0) {
      frightLeft = Math.max(0, frightLeft - dt)
      if (!frightLeft) for (const h of hunters) if (h.state === 'fright') h.state = 'hunt'
    }
    for (const h of hunters) moveHunter(h, dt)
    if (status === 'running' && freeze <= 0) touch()
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const drawGhost = (x: number, y: number, size: number, fill: string, dir: Spot, eyes: string): void => {
    const r = size * 0.42
    g.fillStyle = fill
    g.beginPath()
    g.arc(x, y - r * 0.15, r, Math.PI, 0)
    g.lineTo(x + r, y + r * 0.72)
    // A zigzag along the bottom: up to a peak, back down, three times across.
    for (let i = 0; i < 3; i++) {
      const w = (r * 2) / 3
      g.lineTo(x + r - w * i - w / 2, y + r * 0.34)
      g.lineTo(x + r - w * (i + 1), y + r * 0.72)
    }
    g.closePath()
    g.fill()
    g.fillStyle = eyes
    for (const side of [-1, 1]) {
      g.beginPath()
      g.arc(x + side * r * 0.38, y - r * 0.2, r * 0.26, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = colors.bg
    for (const side of [-1, 1]) {
      g.beginPath()
      g.arc(x + side * r * 0.38 + dir.x * r * 0.12, y - r * 0.2 + dir.y * r * 0.12, r * 0.12, 0, Math.PI * 2)
      g.fill()
    }
  }

  const draw = (): void => {
    const cell = Math.min(W / maze.cols, H / maze.rows)
    const ox = (W - cell * maze.cols) / 2
    const oy = (H - cell * maze.rows) / 2
    const sx = (x: number): number => ox + (x + 0.5) * cell
    const sy = (y: number): number => oy + (y + 0.5) * cell
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)

    for (let y = 0; y < maze.rows; y++)
      for (let x = 0; x < maze.cols; x++) {
        const i = at(maze, x, y)
        if (maze.walls[i]) {
          g.fillStyle = ctx.prefs.highContrast ? colors.primary : colors.bgSoft
          g.beginPath()
          g.roundRect(ox + x * cell + cell * 0.06, oy + y * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.28)
          g.fill()
          if (!ctx.prefs.highContrast) {
            g.strokeStyle = colors.primary
            g.lineWidth = Math.max(1, cell * 0.06)
            g.stroke()
          }
          continue
        }
        if (maze.dots[i]) {
          g.fillStyle = colors.muted
          g.beginPath()
          g.arc(sx(x), sy(y), cell * 0.11, 0, Math.PI * 2)
          g.fill()
        }
        if (maze.pills[i]) {
          const pulse = ctx.prefs.reducedMotion ? 0 : Math.sin(elapsed * 7) * cell * 0.05
          g.fillStyle = colors.warn
          g.beginPath()
          g.arc(sx(x), sy(y), cell * 0.28 + pulse, 0, Math.PI * 2)
          g.fill()
        }
      }

    // The tunnel row is drawn twice near the edges, so you slide out of one side and in at the other.
    const copies = (p: Spot): Spot[] => (p.y === maze.tunnelRow ? [p, { x: p.x + maze.cols, y: p.y }, { x: p.x - maze.cols, y: p.y }] : [p])
    const here = posOf(player)
    const bite = ctx.prefs.reducedMotion ? 0.22 : 0.06 + Math.abs(Math.sin(elapsed * 10)) * 0.26
    for (const p of copies(here)) {
      if (p.x < -1 || p.x > maze.cols) continue
      const angle = Math.atan2(facing.y, facing.x)
      g.fillStyle = frightLeft > 0 ? colors.warn : colors.secondary
      g.beginPath()
      g.moveTo(sx(p.x), sy(p.y))
      g.arc(sx(p.x), sy(p.y), cell * 0.42, angle + bite * Math.PI, angle - bite * Math.PI)
      g.closePath()
      g.fill()
    }

    for (const h of hunters) {
      const hp = posOf(h)
      const fill = h.state === 'eaten' ? colors.bgSoft : h.state === 'fright' ? (frightLeft < 1.6 && !ctx.prefs.reducedMotion && Math.floor(elapsed * 6) % 2 ? colors.text : colors.primary) : { chaser: colors.danger, ambusher: colors.accent, erratic: colors.good, keeper: colors.secondary }[h.kind]
      for (const p of copies(hp)) {
        if (p.x < -1 || p.x > maze.cols) continue
        drawGhost(sx(p.x), sy(p.y), cell, fill, h.dir, h.state === 'fright' ? colors.bg : colors.text)
      }
    }

    g.textAlign = 'center'
    if (status === 'ready') {
      g.fillStyle = colors.bg
      g.globalAlpha = 0.82
      g.fillRect(0, oy + cell * 1.5, W, cell * 7)
      g.globalAlpha = 1
      g.fillStyle = colors.text
      g.font = '600 18px system-ui, sans-serif'
      g.fillText('Arrows or WASD to move. Eat every dot.', W / 2, oy + cell * 2.9)
      g.font = '500 14px system-ui, sans-serif'
      HUNTER_KINDS.forEach((kind, i) => {
        g.fillStyle = { chaser: colors.danger, ambusher: colors.accent, erratic: colors.good, keeper: colors.secondary }[kind]
        g.fillText(`${kind === 'chaser' ? 'Red' : kind === 'ambusher' ? 'Pink' : kind === 'erratic' ? 'Green' : 'Purple'} ${HUNTER_NOTES[kind]}`, W / 2, oy + cell * (4.2 + i * 0.9))
      })
      g.fillStyle = colors.muted
      g.fillText('The corners hold power pills. The middle row goes right through.', W / 2, oy + cell * 8.2)
    } else if (message) {
      g.fillStyle = colors.bg
      g.globalAlpha = 0.8
      g.fillRect(0, H / 2 - cell, W, cell * 2)
      g.globalAlpha = 1
      g.fillStyle = colors.text
      g.font = '600 18px system-ui, sans-serif'
      g.fillText(message, W / 2, H / 2 + 6)
    }
  }

  const loop = createLoop(step, draw)
  const instance: GameInstance = {
    start() {
      reset()
      loop.start()
      ctx.audio.resumeMusic()
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      loop.stop()
      ctx.audio.pauseMusic()
      emit(true)
      draw()
    },
    resume() {
      if (status !== 'paused') return
      status = 'running'
      loop.start()
      ctx.audio.resumeMusic()
      emit(true)
    },
    restart() {
      loop.stop()
      reset()
      loop.start()
    },
    destroy() {
      loop.stop()
    },
    resize(width, height) {
      W = width
      H = height
      g = fitCanvas(canvas, width, height)
      draw()
    }
  }
  return instance
}

const mazeChase: GameModule = { id: 'maze-chase', surface: 'canvas', create }
export default mazeChase
