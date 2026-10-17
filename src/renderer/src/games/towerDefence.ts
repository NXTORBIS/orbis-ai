import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, fitCanvas, palette } from './engine'
import type { Game, TowerKind } from '../../../shared/games/towerDefence.ts'
import { ENEMIES, GRID_COLS, GRID_ROWS, MAX_LEVEL, TOWERS, TOWER_KINDS, newGame, placeTower, placementError, pointAt, readSaved, savable, sellTower, sellValue, startWave, stepGame, towerRange, upgradeCost, upgradeTower } from '../../../shared/games/towerDefence.ts'

/**
 * Hold the Line: towers along a fixed path, waves that pay for the next tower, and three kinds of tower that answer
 * different problems -- a spark that shoots fast and bounces off armour, a cannon that hits everything around what it
 * hits, and a frost tower that barely scratches anything and slows everything.
 *
 * The fight is all in `src/shared/games/towerDefence.ts`, which is where the test plays twelve waves to prove the line
 * can be held. This file is the board, the bar along the bottom, and the pointer and keyboard that drive them.
 *
 * The wave starts itself when the building time runs out, with the clock on screen. That is deliberate: a game whose
 * only way on is a button somebody has to find is a game that stops for anybody playing with the keyboard.
 */

interface Button {
  x: number
  y: number
  w: number
  h: number
  label: string
  sub: string
  act(): void
  on?: boolean
  off?: boolean
}

const BUILD_SECONDS: Record<string, number> = { easy: 18, normal: 14, hard: 10 }

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 800
  let H = 500
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const reduced = ctx.prefs.reducedMotion

  let status: GameStatus = 'ready'
  let game: Game = newGame(Date.now() & 0xffff, ctx.prefs.difficulty)
  let chosen: TowerKind = 'spark'
  let selected: number | null = null
  let cursor = { x: 0, y: 0 }
  let buildLeft = BUILD_SECONDS[ctx.prefs.difficulty] ?? 14
  let elapsed = 0
  let message = ''
  let messageLeft = 0
  let buttons: Button[] = []
  let lastEmit = 0

  const bar = (): number => Math.min(96, Math.max(72, Math.round(H * 0.18)))
  const cellSize = (): number => Math.max(8, Math.floor(Math.min((W - 16) / GRID_COLS, (H - bar() - 16) / GRID_ROWS)))
  const originX = (): number => Math.floor((W - cellSize() * GRID_COLS) / 2)
  const originY = (): number => 8

  /** Asked rather than read: the fight changes the phase from inside `stepGame`, in the middle of a branch that has
   * already decided what the phase is. */
  const lost = (): boolean => game.phase === 'lost'

  const say = (text: string): void => {
    message = text
    messageLeft = 2.2
  }

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: game.score,
      level: game.wave,
      lives: game.lives,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: game.wave,
      hud: [{ label: 'Money', value: game.money }, { label: 'Towers', value: game.towers.length }, { label: game.phase === 'wave' ? 'Left' : 'Next wave', value: game.phase === 'wave' ? game.enemies.length + game.queue.length : `${Math.ceil(buildLeft)}s` }]
    })
  }

  const save = (): void => {
    if (status === 'over' || game.phase === 'lost') return ctx.save?.(null)
    ctx.save?.(savable(game))
  }

  const fresh = (): void => {
    game = newGame((Date.now() + Math.floor(Math.random() * 1e6)) & 0xffffff, ctx.prefs.difficulty)
    status = 'ready'
    chosen = 'spark'
    selected = null
    cursor = { x: 1, y: 0 }
    buildLeft = BUILD_SECONDS[ctx.prefs.difficulty] ?? 14
    elapsed = 0
    message = ''
    messageLeft = 0
    emit(true)
  }

  const build = (kind: TowerKind, x: number, y: number): void => {
    const problem = placementError(game, kind, x, y)
    if (problem) {
      say(problem)
      ctx.audio.blip(160, 90, 'square', 0.4)
      return
    }
    const tower = placeTower(game, kind, x, y)
    if (tower) {
      selected = tower.id
      ctx.audio.blip(620, 70, 'triangle', 0.6)
      save()
      emit(true)
    }
  }

  const improve = (): void => {
    if (selected === null) return say('Pick a tower first')
    const tower = game.towers.find((t) => t.id === selected)
    if (!tower) return
    const cost = upgradeCost(tower.kind, tower.level)
    if (cost === null) return say('That one is as good as it gets')
    if (!upgradeTower(game, tower.id)) return say(`Improving it costs ${cost}`)
    ctx.audio.blip(880, 90, 'sine')
    save()
    emit(true)
  }

  const sell = (): void => {
    if (selected === null) return say('Pick a tower first')
    const paid = sellTower(game, selected)
    if (paid) {
      say(`Sold for ${paid}`)
      ctx.audio.blip(330, 110, 'triangle', 0.5)
      selected = null
      save()
      emit(true)
    }
  }

  const sendWave = (early: boolean): void => {
    if (game.phase !== 'building') return
    if (early) {
      // Sending them before the clock runs out pays for the time you did not take.
      const bonus = Math.max(0, Math.round(buildLeft))
      game.money += bonus
      if (bonus) say(`Sent early: +${bonus}`)
    }
    startWave(game)
    ctx.audio.blip(220, 220, 'sawtooth', 0.6)
    emit(true)
  }

  // ---------------------------------------------------------------- the bar along the bottom

  /**
   * The six buttons along the bottom, measured as six columns of whatever the window gives. Working from a fixed
   * minimum width instead put the last two buttons off the right-hand edge of a seven-hundred-pixel stage, where
   * nothing could be clicked and nothing said so.
   */
  const layout = (): void => {
    const top = H - bar() + 6
    const height = bar() - 14
    const gap = 6
    const columns = 6
    const width = Math.max(52, Math.floor((W - 20 - gap * (columns - 1)) / columns))
    const left = (column: number): number => 10 + column * (width + gap)
    const tower = selected === null ? null : game.towers.find((t) => t.id === selected)
    const cost = tower ? upgradeCost(tower.kind, tower.level) : null
    buttons = [
      ...TOWER_KINDS.map((kind, i) => {
        const spec = TOWERS[kind]
        return {
          x: left(i),
          y: top,
          w: width,
          h: height,
          label: `${spec.name} ${spec.cost[0]}`,
          sub: spec.what,
          on: chosen === kind,
          off: game.money < spec.cost[0],
          act: () => {
            chosen = kind
            selected = null
            say(spec.what)
          }
        }
      }),
      { x: left(3), y: top, w: width, h: height, label: tower ? (cost === null ? 'Best it gets' : `Improve ${cost}`) : 'Improve (U)', sub: tower ? `${TOWERS[tower.kind].name}, level ${tower.level} of ${MAX_LEVEL}` : 'Pick a tower on the board', off: !tower || cost === null, act: improve },
      { x: left(4), y: top, w: width, h: height, label: tower ? `Sell ${sellValue(tower.spent)}` : 'Sell (F)', sub: tower ? 'Three fifths of what went into it' : 'Pick a tower on the board', off: !tower, act: sell },
      { x: left(5), y: top, w: Math.max(width, W - 10 - left(5)), h: height, label: game.phase === 'wave' ? `Wave ${game.wave}` : `Send wave ${game.wave}`, sub: game.phase === 'wave' ? `${game.enemies.length + game.queue.length} still coming` : `Starts by itself in ${Math.ceil(buildLeft)}s`, off: game.phase === 'wave', act: () => sendWave(true) }
    ]
  }

  const inside = (b: Button, x: number, y: number): boolean => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

  const click = (x: number, y: number): void => {
    for (const button of buttons) {
      if (!inside(button, x, y)) continue
      if (button.off) ctx.audio.blip(160, 80, 'square', 0.35)
      else button.act()
      return
    }
    const cell = cellSize()
    const col = Math.floor((x - originX()) / cell)
    const rowY = Math.floor((y - originY()) / cell)
    if (col < 0 || rowY < 0 || col >= GRID_COLS || rowY >= GRID_ROWS) return
    cursor = { x: col, y: rowY }
    const tower = game.towers.find((t) => t.x === col && t.y === rowY)
    if (tower) {
      // A second click on the tower you have already picked improves it, which is how most people expect this to work.
      if (selected === tower.id) improve()
      else {
        selected = tower.id
        say(`${TOWERS[tower.kind].name}, level ${tower.level}: ${TOWERS[tower.kind].what}`)
      }
      return
    }
    selected = null
    build(chosen, col, rowY)
  }

  /** The keys the shared input does not carry: the three towers by number, and the wave. */
  const onKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey || status !== 'running') return
    const pick: Record<string, TowerKind> = { Digit1: 'spark', Digit2: 'cannon', Digit3: 'frost' }
    if (event.code in pick) {
      chosen = pick[event.code]
      selected = null
      say(TOWERS[chosen].what)
    } else if (event.code === 'Digit0' || event.code === 'KeyG') sendWave(true)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  ctx.root.addEventListener('keydown', onKey)

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'ready' && (input.taps > 0 || input.pressed('Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'))) {
      // The click that gets rid of the opening words does not also build a tower under them.
      status = 'running'
      layout()
      emit(true)
      return input.endStep()
    }
    if (status !== 'running') return input.endStep()

    if (input.pressed('ArrowLeft', 'KeyA')) cursor.x = Math.max(0, cursor.x - 1)
    if (input.pressed('ArrowRight', 'KeyD')) cursor.x = Math.min(GRID_COLS - 1, cursor.x + 1)
    if (input.pressed('ArrowUp', 'KeyW')) cursor.y = Math.max(0, cursor.y - 1)
    if (input.pressed('ArrowDown', 'KeyS')) cursor.y = Math.min(GRID_ROWS - 1, cursor.y + 1)
    if (input.pressed('Space')) {
      const tower = game.towers.find((t) => t.x === cursor.x && t.y === cursor.y)
      if (tower) {
        selected = tower.id
        say(`${TOWERS[tower.kind].name}, level ${tower.level}. U improves it, F sells it`)
      } else {
        selected = null
        build(chosen, cursor.x, cursor.y)
      }
    }
    if (input.pressed('KeyU')) improve()
    if (input.pressed('KeyF')) sell()
    if (input.taps > 0) click(input.pointer.x, input.pointer.y)

    elapsed += dt
    if (messageLeft > 0) messageLeft -= dt
    if (game.phase === 'building') {
      buildLeft -= dt
      if (buildLeft <= 0) sendWave(false)
    } else if (game.phase === 'wave') {
      const before = game.wave
      stepGame(game, dt * 1000)
      if (game.wave !== before) {
        // The wave is over: the money has arrived, and there is time to spend it.
        buildLeft = BUILD_SECONDS[ctx.prefs.difficulty] ?? 14
        ctx.audio.blip(740, 180, 'sine')
        save()
      }
      if (lost()) {
        status = 'over'
        ctx.save?.(null)
        ctx.audio.blip(90, 420, 'sawtooth')
        emit(true)
        ctx.over({ score: game.score, extra: { difficulty: ctx.prefs.difficulty, bestStreak: game.wave - 1 } })
        input.endStep()
        return
      }
    }
    layout()
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const roundRect = (x: number, y: number, w: number, h: number, r: number): void => {
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fill()
  }

  const drawTower = (x: number, y: number, kind: TowerKind, level: number, cell: number): void => {
    const cx = x + cell / 2
    const cy = y + cell / 2
    const size = cell * (0.3 + level * 0.04)
    g.fillStyle = kind === 'spark' ? colors.primary : kind === 'cannon' ? colors.accent : colors.secondary
    if (kind === 'spark') {
      g.beginPath()
      g.moveTo(cx, cy - size)
      g.lineTo(cx + size, cy)
      g.lineTo(cx, cy + size)
      g.lineTo(cx - size, cy)
      g.closePath()
      g.fill()
    } else if (kind === 'cannon') {
      g.beginPath()
      g.arc(cx, cy, size, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = colors.bg
      g.fillRect(cx - size * 0.2, cy - size, size * 0.4, size)
    } else {
      g.beginPath()
      for (let i = 0; i < 6; i++) g.lineTo(cx + Math.cos((i * Math.PI) / 3) * size, cy + Math.sin((i * Math.PI) / 3) * size)
      g.closePath()
      g.fill()
    }
    // One pip per level, so the board says how good a tower is without anybody clicking it.
    g.fillStyle = colors.text
    for (let i = 0; i < level; i++) g.fillRect(cx - cell * 0.18 + i * cell * 0.15, y + cell * 0.82, cell * 0.1, 2)
  }

  const draw = (): void => {
    const cell = cellSize()
    const ox = originX()
    const oy = originY()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)

    // The ground, then the path over it.
    g.fillStyle = ctx.prefs.highContrast ? '#001100' : '#0b1410'
    g.fillRect(ox, oy, cell * GRID_COLS, cell * GRID_ROWS)
    g.strokeStyle = 'rgba(255,255,255,0.05)'
    g.lineWidth = 1
    for (let x = 0; x <= GRID_COLS; x++) {
      g.beginPath()
      g.moveTo(ox + x * cell, oy)
      g.lineTo(ox + x * cell, oy + cell * GRID_ROWS)
      g.stroke()
    }
    for (let y = 0; y <= GRID_ROWS; y++) {
      g.beginPath()
      g.moveTo(ox, oy + y * cell)
      g.lineTo(ox + cell * GRID_COLS, oy + y * cell)
      g.stroke()
    }
    game.path.forEach((p, i) => {
      g.fillStyle = i === 0 ? colors.good : i === game.path.length - 1 ? colors.danger : ctx.prefs.highContrast ? '#444444' : '#2a2f3d'
      g.fillRect(ox + p.x * cell, oy + p.y * cell, cell, cell)
    })

    // What a click would do.
    const hoverTower = game.towers.find((t) => t.x === cursor.x && t.y === cursor.y)
    const show = selected !== null ? game.towers.find((t) => t.id === selected) : hoverTower
    if (show) {
      g.strokeStyle = 'rgba(120, 220, 255, 0.5)'
      g.lineWidth = 2
      g.beginPath()
      g.arc(ox + (show.x + 0.5) * cell, oy + (show.y + 0.5) * cell, towerRange(show) * cell, 0, Math.PI * 2)
      g.stroke()
    }
    if (!hoverTower) {
      const problem = placementError(game, chosen, cursor.x, cursor.y)
      g.strokeStyle = problem ? colors.danger : colors.good
      g.lineWidth = 2
      g.strokeRect(ox + cursor.x * cell + 1, oy + cursor.y * cell + 1, cell - 2, cell - 2)
      if (!problem) {
        g.strokeStyle = 'rgba(80, 220, 150, 0.3)'
        g.beginPath()
        g.arc(ox + (cursor.x + 0.5) * cell, oy + (cursor.y + 0.5) * cell, TOWERS[chosen].range[0] * cell, 0, Math.PI * 2)
        g.stroke()
      }
    }

    for (const tower of game.towers) drawTower(ox + tower.x * cell, oy + tower.y * cell, tower.kind, tower.level, cell)

    // The enemies, each with what is left of it.
    for (const enemy of game.enemies) {
      const spec = ENEMIES[enemy.kind]
      const at = pointAt(game.path, enemy.progress)
      const cx = ox + (at.x + 0.5) * cell
      const cy = oy + (at.y + 0.5) * cell
      const size = cell * (enemy.kind === 'brute' ? 0.38 : enemy.kind === 'swarm' ? 0.18 : 0.26)
      g.fillStyle = enemy.kind === 'brute' ? '#b45309' : enemy.kind === 'runner' ? '#f472b6' : enemy.kind === 'swarm' ? '#a3e635' : colors.warn
      g.beginPath()
      g.arc(cx, cy, size, 0, Math.PI * 2)
      g.fill()
      if (spec.armour > 1) {
        g.strokeStyle = 'rgba(255,255,255,0.65)'
        g.lineWidth = 2
        g.stroke()
      }
      if (enemy.slowLeftMs > 0) {
        g.strokeStyle = colors.secondary
        g.lineWidth = 2
        g.beginPath()
        g.arc(cx, cy, size + 2, 0, Math.PI * 2)
        g.stroke()
      }
      const left = Math.max(0, enemy.hp / enemy.maxHp)
      if (left < 1) {
        g.fillStyle = 'rgba(0,0,0,0.6)'
        g.fillRect(cx - size, cy - size - 5, size * 2, 3)
        g.fillStyle = left > 0.5 ? colors.good : left > 0.25 ? colors.warn : colors.danger
        g.fillRect(cx - size, cy - size - 5, size * 2 * left, 3)
      }
    }

    // The shots, which are the only thing on the board that is pure decoration.
    if (!reduced)
      for (const shot of game.shots) {
        g.strokeStyle = shot.kind === 'cannon' ? colors.accent : shot.kind === 'frost' ? colors.secondary : colors.primary
        g.lineWidth = shot.kind === 'cannon' ? 3 : 1.5
        g.globalAlpha = Math.max(0, shot.leftMs / 110)
        g.beginPath()
        g.moveTo(ox + (shot.fromX + 0.5) * cell, oy + (shot.fromY + 0.5) * cell)
        g.lineTo(ox + (shot.toX + 0.5) * cell, oy + (shot.toY + 0.5) * cell)
        g.stroke()
        g.globalAlpha = 1
      }

    // The bar.
    layout()
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    for (const button of buttons) {
      g.fillStyle = button.on ? 'rgba(63, 216, 255, 0.22)' : colors.bgSoft
      roundRect(button.x, button.y, button.w, button.h, 10)
      g.strokeStyle = button.on ? colors.primary : 'rgba(160, 210, 255, 0.2)'
      g.lineWidth = button.on ? 2 : 1
      g.beginPath()
      g.roundRect(button.x, button.y, button.w, button.h, 10)
      g.stroke()
      g.globalAlpha = button.off ? 0.45 : 1
      g.fillStyle = colors.text
      g.font = '600 13px system-ui, sans-serif'
      g.fillText(button.label, button.x + 10, button.y + button.h * 0.33, button.w - 16)
      g.fillStyle = colors.muted
      g.font = '11px system-ui, sans-serif'
      wrap(button.sub, button.x + 10, button.y + button.h * 0.6, button.w - 16, 12)
      g.globalAlpha = 1
    }

    // The building clock, as a line across the top of the bar.
    if (game.phase === 'building') {
      const total = BUILD_SECONDS[ctx.prefs.difficulty] ?? 14
      g.fillStyle = colors.primary
      g.fillRect(0, H - bar(), W * Math.max(0, buildLeft / total), 3)
    }

    g.textAlign = 'center'
    if (messageLeft > 0 && message) {
      g.fillStyle = 'rgba(0,0,0,0.65)'
      g.fillRect(ox, oy + cell * GRID_ROWS - 26, cell * GRID_COLS, 24)
      g.fillStyle = colors.text
      g.font = '13px system-ui, sans-serif'
      g.fillText(message, ox + (cell * GRID_COLS) / 2, oy + cell * GRID_ROWS - 14)
    }
    if (status === 'ready') {
      g.fillStyle = 'rgba(0,0,0,0.72)'
      g.fillRect(ox, oy + cell * 3, cell * GRID_COLS, cell * 5)
      g.fillStyle = colors.text
      g.font = '600 18px system-ui, sans-serif'
      g.fillText('Build along the path before the wave arrives', ox + (cell * GRID_COLS) / 2, oy + cell * 4.4)
      g.fillStyle = colors.muted
      g.font = '13px system-ui, sans-serif'
      g.fillText('Click a square to build, click a tower to improve or sell it', ox + (cell * GRID_COLS) / 2, oy + cell * 5.5)
      g.fillText('Keyboard: arrows move, Space builds, 1 2 3 pick the tower, U improves, F sells, G sends the wave', ox + (cell * GRID_COLS) / 2, oy + cell * 6.4)
      g.fillStyle = colors.primary
      g.font = '600 14px system-ui, sans-serif'
      g.fillText('Click or press a key to begin', ox + (cell * GRID_COLS) / 2, oy + cell * 7.4)
    }
    g.textBaseline = 'alphabetic'
  }

  /** Two lines at most, because the bar has room for two lines. */
  const wrap = (text: string, x: number, y: number, width: number, lineHeight: number): void => {
    const words = text.split(' ')
    let line = ''
    let row = 0
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (g.measureText(next).width > width && line) {
        g.fillText(line, x, y + row * lineHeight)
        row++
        line = word
        if (row > 1) break
      } else line = next
    }
    if (row <= 1) g.fillText(line, x, y + row * lineHeight)
  }

  const loop = createLoop(step, draw)
  const instance: GameInstance = {
    start() {
      fresh()
      layout()
      loop.start()
      ctx.audio.resumeMusic()
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      loop.stop()
      ctx.audio.pauseMusic()
      save()
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
      fresh()
      ctx.save?.(null)
      loop.start()
    },
    restore(saved) {
      const back = readSaved(saved)
      if (!back || back.difficulty !== ctx.prefs.difficulty) return false
      game = back
      buildLeft = BUILD_SECONDS[ctx.prefs.difficulty] ?? 14
      selected = null
      layout()
      emit(true)
      return true
    },
    destroy() {
      loop.stop()
      save()
      ctx.root.removeEventListener('keydown', onKey)
    },
    resize(width, height) {
      W = width
      H = height
      g = fitCanvas(canvas, width, height)
      layout()
      draw()
    }
  }
  return instance
}

const towerDefence: GameModule = { id: 'tower-defence', surface: 'canvas', create }
export default towerDefence
