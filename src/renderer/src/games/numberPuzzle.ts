import type { GameContext, GameInstance, GameModule } from './engine'
import { gameRandom } from './seed'
import type { Direction, Grid } from '../../../shared/gameLogic'
import { canMove, emptyGrid, isGrid, maxTile, move, spawnTile } from '../../../shared/gameLogic'

interface Saved {
  grid: Grid
  score: number
  undo: { grid: Grid; score: number } | null
  reached2048: boolean
}

const SIZE = 4

/**
 * Fusion 2048: slide every tile; equal numbers fuse into their sum. Reaching 2048 is celebrated and play can go on.
 * One undo is kept. Arrows, WASD or swipes. Progress can be saved and continued.
 */
function create(ctx: GameContext): GameInstance {
  const surface = ctx.root.querySelector('.game-surface')!
  const root = document.createElement('div')
  root.className = 'np'
  surface.appendChild(root)
  const message = document.createElement('div')
  message.className = 'np-message'
  message.setAttribute('aria-live', 'polite')

  let grid: Grid = emptyGrid(SIZE)
  let score = 0
  let undo: Saved['undo'] = null
  let reached2048 = false
  let paused = false
  let over = false
  let started = false
  let touch: { x: number; y: number } | null = null
  /*
   * One random source for the whole run, remade when a run starts.
   *
   * It has to be one source rather than a fresh one per tile: a seeded generator asked once always answers the same
   * thing, so a new generator for every spawn would drop the same tile in the same corner for ever.
   */
  let random = gameRandom(ctx)

  const emit = (): void => ctx.emit({ status: over ? 'over' : paused ? 'paused' : started ? 'running' : 'ready', score, elapsedMs: 0, difficulty: 1, hud: [{ label: 'Best tile', value: maxTile(grid) }, { label: 'Undo', value: undo ? 'U' : '—' }] })

  const save = (): void => {
    if (!over) ctx.save?.({ grid, score, undo, reached2048 } satisfies Saved)
  }

  const render = (): void => {
    root.innerHTML = ''
    for (const row of grid) {
      for (const v of row) {
        const tile = document.createElement('div')
        tile.className = `np-tile${v ? ` v${Math.min(v, 4096)}` : ''}`
        tile.textContent = v ? String(v) : ''
        root.appendChild(tile)
      }
    }
    root.appendChild(message)
    emit()
  }

  const go = (direction: Direction): void => {
    if (paused || over) return
    const result = move(grid, direction)
    if (!result.moved) return
    started = true
    undo = { grid, score }
    grid = spawnTile(result.grid, random)
    score += result.gained
    ctx.audio.blip(result.gained ? 500 + Math.log2(result.gained) * 40 : 300, 40, 'triangle', 0.5)
    if (!reached2048 && maxTile(grid) >= 2048) {
      reached2048 = true
      message.textContent = 'You reached 2048! Keep going.'
      ctx.audio.blip(1200, 300, 'sine')
    } else message.textContent = ''
    if (!canMove(grid)) {
      over = true
      message.textContent = 'No moves left.'
      render()
      ctx.save?.(null)
      ctx.over({ score, extra: { bestStreak: maxTile(grid) } })
      return
    }
    render()
    save()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const map: Record<string, Direction> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' }
    if (map[e.code]) {
      e.preventDefault()
      e.stopPropagation()
      go(map[e.code])
    } else if (e.code === 'KeyU' && undo && !over && !paused) {
      e.preventDefault()
      e.stopPropagation()
      grid = undo.grid
      score = undo.score
      undo = null
      render()
      save()
    }
  }
  const onTouchStart = (e: PointerEvent): void => {
    touch = { x: e.clientX, y: e.clientY }
  }
  const onTouchEnd = (e: PointerEvent): void => {
    if (!touch) return
    const dx = e.clientX - touch.x
    const dy = e.clientY - touch.y
    touch = null
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return
    go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }
  ctx.root.addEventListener('keydown', onKey)
  root.addEventListener('pointerdown', onTouchStart)
  root.addEventListener('pointerup', onTouchEnd)

  const fresh = (): void => {
    // A new run, a new random source: with the day's seed that is the same board and the same tiles all day.
    random = gameRandom(ctx)
    grid = spawnTile(spawnTile(emptyGrid(SIZE), random), random)
    score = 0
    undo = null
    reached2048 = paused = over = started = false
    message.textContent = ''
    render()
  }

  return {
    start: fresh,
    restart() {
      fresh()
      ctx.save?.(null)
    },
    pause() {
      if (over || paused) return
      paused = true
      save()
      emit()
    },
    resume() {
      if (!paused) return
      paused = false
      emit()
    },
    restore(saved) {
      const s = saved as Saved
      if (!s || !isGrid(s.grid) || s.grid.length !== SIZE || !canMove(s.grid)) return false
      grid = s.grid
      score = Number(s.score) || 0
      undo = s.undo && isGrid(s.undo.grid) ? s.undo : null
      reached2048 = Boolean(s.reached2048)
      started = true
      render()
      return true
    },
    destroy() {
      if (started) save()
      ctx.root.removeEventListener('keydown', onKey)
      root.remove()
    },
    resize() {
      // CSS grid.
    }
  }
}

const numberPuzzle: GameModule = { id: 'number-puzzle', surface: 'dom', create }
export default numberPuzzle
