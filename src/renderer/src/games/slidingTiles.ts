import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import type { TileDirection, TileSave, Tiles } from '../../../shared/games/slidingTiles'
import { gapOf, isTilesSolved, isTileSave, shuffleTiles, slideAt, slideByKey, TILE_SIZES, tileClock, tileDistance, tilesHome, tileTime } from '../../../shared/games/slidingTiles'
import { createLoop, fitCanvas, palette } from './engine'

/**
 * Sliding Tiles: one gap, and the tiles slid back into order around it.
 *
 * The shuffle is made of real slides away from the finished board, so it can always be slid back. Half of all the ways
 * these tiles could sit cannot be solved at all, and a board that cannot be solved is not a hard puzzle -- it is a
 * puzzle with no answer, which the player would spend an evening blaming themselves for.
 *
 * Clicking a tile that is in the gap's row or column but not next to it slides the whole run along, which is what makes
 * the five-across board bearable. The clock starts on the first move and the score is the time it took, so lower is
 * better.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const size = TILE_SIZES[ctx.prefs.difficulty]
  const slide = ctx.prefs.reducedMotion ? 0.001 : 0.09

  let status: GameStatus = 'ready'
  let tiles: Tiles = shuffleTiles(size)
  let moves = 0
  let ms = 0
  let started = 0
  let anim: { cells: number[]; dx: number; dy: number; t: number } | null = null
  let message = 'Click a tile beside the gap, or use the arrow keys.'
  let lastEmit = 0

  const cellSize = (): number => Math.max(16, Math.floor(Math.min((W - 32) / size, (H - 54) / size)))
  const originX = (): number => Math.floor((W - cellSize() * size) / 2)
  const originY = (): number => Math.floor((H - cellSize() * size) / 2) + 12

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: status === 'over' ? tileTime(ms) : 0,
      elapsedMs: Math.round(ms),
      difficulty: 1,
      hud: [
        { label: 'Time', value: tileClock(ms) },
        { label: 'Moves', value: moves },
        { label: 'Home', value: `${tilesHome(tiles)}/${size * size - 1}` },
        { label: 'Board', value: `${size} across` }
      ]
    })
  }

  const keep = (): void => {
    if (status === 'running') ctx.save?.({ tiles, size, moves, ms, difficulty: ctx.prefs.difficulty } satisfies TileSave)
  }

  const finish = (): void => {
    status = 'over'
    ctx.save?.(null)
    ctx.audio.blip(780, 130, 'sine')
    ctx.audio.blip(1170, 220, 'sine')
    message = `Solved in ${moves} moves and ${tileClock(ms)}.`
    emit(true)
    ctx.over({ score: tileTime(ms), extra: { difficulty: ctx.prefs.difficulty } })
  }

  const apply = (result: { tiles: Tiles; moved: number[] } | null, towards: number): void => {
    if (!result) {
      message = 'That tile cannot reach the gap in a straight line.'
      ctx.audio.blip(200, 50, 'triangle', 0.35)
      return
    }
    const gap = gapOf(tiles)
    const dx = towards % size === gap % size ? 0 : Math.sign((gap % size) - (towards % size))
    const dy = Math.floor(towards / size) === Math.floor(gap / size) ? 0 : Math.sign(Math.floor(gap / size) - Math.floor(towards / size))
    // The model moves at once, so a fast run of clicks is never swallowed by an animation still playing.
    tiles = result.tiles
    moves += result.moved.length
    anim = { cells: result.moved.map((index) => index + dy * size + dx), dx, dy, t: 0 }
    if (status === 'ready') {
      status = 'running'
      started = performance.now()
    }
    message = ''
    ctx.audio.blip(360 + result.moved.length * 40, 30, 'square', 0.35)
    if (isTilesSolved(tiles)) finish()
    else {
      keep()
      emit(true)
    }
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'over') return input.endStep()
    if (status === 'running') ms = performance.now() - started
    if (anim) {
      anim.t += dt
      if (anim.t >= slide) anim = null
    }
    const keys: [string[], TileDirection][] = [
      [['ArrowLeft', 'KeyA'], 'left'],
      [['ArrowRight', 'KeyD'], 'right'],
      [['ArrowUp', 'KeyW'], 'up'],
      [['ArrowDown', 'KeyS'], 'down']
    ]
    for (const [codes, direction] of keys) {
      if (!input.pressed(...codes)) continue
      const gap = gapOf(tiles)
      const towards = direction === 'left' ? gap + 1 : direction === 'right' ? gap - 1 : direction === 'up' ? gap + size : gap - size
      const result = slideByKey(tiles, size, direction)
      if (result) apply(result, towards)
      else message = 'Nothing on that side of the gap.'
    }
    if (input.taps > 0) {
      const cell = cellSize()
      const col = Math.floor((input.pointer.x - originX()) / cell)
      const row = Math.floor((input.pointer.y - originY()) / cell)
      if (col >= 0 && row >= 0 && col < size && row < size) apply(slideAt(tiles, size, row * size + col), row * size + col)
    }
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const cell = cellSize()
    const ox = originX()
    const oy = originY()
    const u = anim ? Math.min(1, anim.t / slide) : 1
    const moving = anim ? new Set(anim.cells) : null
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.fillStyle = colors.bgSoft
    g.beginPath()
    g.roundRect(ox - 5, oy - 5, cell * size + 10, cell * size + 10, 10)
    g.fill()
    g.textAlign = 'center'
    g.textBaseline = 'middle'

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]
      if (!tile) continue
      let x = ox + (i % size) * cell
      let y = oy + Math.floor(i / size) * cell
      if (moving?.has(i) && anim) {
        x -= anim.dx * cell * (1 - u)
        y -= anim.dy * cell * (1 - u)
      }
      const home = tile === i + 1
      g.fillStyle = home ? colors.good : colors.primary
      g.globalAlpha = home ? 0.95 : 0.55 + (0.45 * tile) / tiles.length
      g.beginPath()
      g.roundRect(x + 2, y + 2, cell - 4, cell - 4, Math.max(4, cell * 0.12))
      g.fill()
      g.globalAlpha = 1
      g.fillStyle = colors.bg
      g.font = `700 ${Math.max(12, Math.round(cell * 0.36))}px system-ui, sans-serif`
      g.fillText(String(tile), x + cell / 2, y + cell / 2 + 1)
    }

    g.textBaseline = 'alphabetic'
    g.fillStyle = colors.muted
    g.font = '600 13px system-ui, sans-serif'
    g.fillText(status === 'ready' ? `${size} across. Click a tile beside the gap, or use the arrow keys.` : message || `${tileClock(ms)} · ${moves} moves`, W / 2, oy - 12)
  }

  const loop = createLoop(step, draw)

  const fresh = (): void => {
    tiles = shuffleTiles(size)
    status = 'ready'
    moves = 0
    ms = 0
    started = 0
    anim = null
    message = `${size * size - 1} tiles, ${tileDistance(tiles, size)} slides out of place at the very least.`
    emit(true)
  }

  const instance: GameInstance = {
    start() {
      fresh()
      loop.start()
      ctx.audio.resumeMusic()
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      ms = performance.now() - started
      loop.stop()
      ctx.audio.pauseMusic()
      keep()
      emit(true)
      draw()
    },
    resume() {
      if (status !== 'paused') return
      status = 'running'
      // The clock is kept honest across a pause: it carries on from the time already spent, not from zero.
      started = performance.now() - ms
      loop.start()
      ctx.audio.resumeMusic()
      emit(true)
    },
    restart() {
      loop.stop()
      ctx.save?.(null)
      fresh()
      loop.start()
    },
    restore(saved) {
      if (!isTileSave(saved) || saved.size !== size || saved.difficulty !== ctx.prefs.difficulty) return false
      tiles = saved.tiles.slice()
      moves = Math.max(0, Math.round(saved.moves) || 0)
      ms = Math.max(0, saved.ms) || 0
      status = 'running'
      started = performance.now() - ms
      anim = null
      message = 'Carrying on where you left off.'
      emit(true)
      return true
    },
    destroy() {
      keep()
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

const slidingTiles: GameModule = { id: 'sliding-tiles', surface: 'canvas', create }
export default slidingTiles
