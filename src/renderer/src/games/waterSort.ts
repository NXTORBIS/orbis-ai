import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import type { SortSave, Tubes } from '../../../shared/games/waterSort'
import { canPour, generateTubes, isSortSave, isSorted, isTubeDone, legalMoves, pour, SORT_LEVELS, solveTubes, sortScore, topRun, TUBE_CAPACITY } from '../../../shared/games/waterSort'
import { createLoop, fitCanvas, palette } from './engine'

/**
 * Colour Sort: pour one tube into another until every tube holds a single colour.
 *
 * You can only pour onto the same colour or into an empty tube, and only the run sitting on top moves. Every puzzle
 * was made by pouring a finished set of tubes backwards, so there is always a way to tidy it -- the way it was untidied
 * in the first place.
 *
 * Click a tube to lift it, click another to pour. U undoes, F finds a pour worth making. Keyboard: left and right
 * move between tubes, Space lifts and pours.
 */

const LAYER_COLOURS = ['#3fd8ff', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#4ade80', '#e879f9', '#60a5fa']
const BOLD_COLOURS = ['#00ffff', '#ff66ff', '#00ff66', '#ffcc00', '#9966ff', '#ff3333', '#00cccc', '#ff9900', '#66ff00', '#ff00cc', '#3366ff']

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const layerColours = ctx.prefs.highContrast ? BOLD_COLOURS : LAYER_COLOURS
  const difficulty = ctx.prefs.difficulty
  const level = SORT_LEVELS[difficulty]
  const pace = ctx.prefs.reducedMotion ? 0.001 : 1

  let tubes: Tubes = generateTubes(difficulty).tubes
  let history: Tubes[] = []
  let status: GameStatus = 'ready'
  let picked: number | null = null
  let cursor = 0
  let moves = 0
  let undos = 0
  let hints = 0
  let seconds = 0
  let clock = 0
  let message = 'Click a tube to lift it, then click the one to pour it into.'
  let pouring: { from: number; to: number; colour: number; count: number; t: number } | null = null
  let shown: [number, number] | null = null
  let shownFor = 0
  let lastEmit = 0

  // ------------------------------------------------------------ where the tubes are

  const layout = (): { perRow: number; rowCount: number; tubeW: number; tubeH: number; gapX: number; top: number } => {
    const count = tubes.length
    const rowCount = count > 7 ? 2 : 1
    const perRow = Math.ceil(count / rowCount)
    // Clamped, because a very narrow panel would otherwise work out a negative tube and draw nonsense.
    const tubeW = Math.max(14, Math.min(64, Math.floor((W - 40) / perRow) - 10))
    const tubeH = Math.max(40, Math.min(TUBE_CAPACITY * 34, Math.floor((H - 70) / rowCount) - 18))
    const gapX = Math.max(2, Math.floor((W - perRow * tubeW) / (perRow + 1)))
    const top = Math.floor((H - 26 - rowCount * (tubeH + 18)) / 2) + 22
    return { perRow, rowCount, tubeW, tubeH, gapX, top }
  }

  const tubeBox = (index: number): { x: number; y: number; w: number; h: number } => {
    const { perRow, tubeW, tubeH, gapX, top } = layout()
    const row = Math.floor(index / perRow)
    const col = index % perRow
    return { x: gapX + col * (tubeW + gapX), y: top + row * (tubeH + 18), w: tubeW, h: tubeH }
  }

  const tubeAt = (x: number, y: number): number | null => {
    for (let i = 0; i < tubes.length; i++) {
      const box = tubeBox(i)
      // A generous reach, because a tube is narrow and a tap is not.
      if (x >= box.x - 6 && x <= box.x + box.w + 6 && y >= box.y - 14 && y <= box.y + box.h + 10) return i
    }
    return null
  }

  // ------------------------------------------------------------ what it says about itself

  const sorted = (): number => tubes.filter((t) => t.length && isTubeDone(t)).length
  const score = (): number => sortScore(level.colours, moves, seconds, undos, hints)

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 120) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score: status === 'over' ? score() : 0,
      elapsedMs: seconds * 1000,
      difficulty: 1,
      hud: [
        { label: 'Done', value: `${sorted()}/${level.colours}` },
        { label: 'Pours', value: moves },
        { label: 'Undos', value: undos },
        { label: 'Time', value: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
      ]
    })
  }

  const keep = (): void => {
    if (status === 'running' || status === 'ready') ctx.save?.({ tubes, capacity: TUBE_CAPACITY, colours: level.colours, moves, undos, seconds, difficulty } satisfies SortSave)
  }

  const startClock = (): void => {
    window.clearInterval(clock)
    clock = window.setInterval(() => {
      if (status !== 'running') return
      seconds++
      emit()
      if (seconds % 10 === 0) keep()
    }, 1000)
  }

  const finish = (): void => {
    status = 'over'
    window.clearInterval(clock)
    ctx.save?.(null)
    ctx.audio.blip(680, 140, 'sine')
    ctx.audio.blip(1020, 220, 'sine')
    message = 'Every tube holds one colour.'
    emit(true)
    ctx.over({ score: score(), extra: { difficulty } })
  }

  // ------------------------------------------------------------ playing

  const begin = (): void => {
    if (status !== 'ready') return
    status = 'running'
    startClock()
    emit(true)
  }

  const startPour = (from: number, to: number): void => {
    if (!canPour(tubes, from, to)) {
      message = tubes[to].length >= TUBE_CAPACITY ? 'That tube is full.' : 'Only onto the same colour, or into an empty tube.'
      ctx.audio.blip(200, 70, 'triangle', 0.4)
      picked = null
      return
    }
    const run = topRun(tubes[from])
    const count = Math.min(run.length, TUBE_CAPACITY - tubes[to].length)
    history.push(tubes.map((t) => t.slice()))
    if (history.length > 200) history.shift()
    picked = null
    shown = null
    pouring = { from, to, colour: run.colour, count, t: 0 }
    ctx.audio.blip(420 + count * 60, 90, 'sine', 0.5)
  }

  const endPour = (): void => {
    if (!pouring) return
    const next = pour(tubes, pouring.from, pouring.to)
    pouring = null
    if (!next) return
    tubes = next
    moves++
    message = ''
    if (isSorted(tubes)) return finish()
    if (!legalMoves(tubes).length) message = 'No pour left to make. Undo, or start again.'
    keep()
    emit(true)
  }

  const undo = (): void => {
    if (status === 'over' || pouring) return
    const last = history.pop()
    if (!last) {
      message = 'Nothing to undo yet.'
      return
    }
    tubes = last
    undos++
    moves = Math.max(0, moves - 1)
    picked = null
    shown = null
    message = 'Put back.'
    ctx.audio.blip(260, 70, 'triangle', 0.5)
    keep()
    emit(true)
  }

  const hint = (): void => {
    begin()
    if (status !== 'running' || pouring) return
    // A hint is worked out here and now, in front of the player, so it is kept small enough not to stutter.
    const found = solveTubes(tubes, TUBE_CAPACITY, 30000)
    if (!found.moves?.length) {
      message = found.gaveUp ? 'This one is too tangled to work out quickly. Try undoing.' : 'There is no way on from here. Undo, or start again.'
      return
    }
    hints++
    shown = found.moves[0]
    shownFor = 3
    message = `Try pouring tube ${shown[0] + 1} into tube ${shown[1] + 1}.`
    ctx.audio.blip(880, 90, 'sine', 0.5)
    emit(true)
  }

  const choose = (index: number): void => {
    begin()
    if (status !== 'running' || pouring) return
    if (picked === null) {
      if (!tubes[index].length) {
        message = 'That tube is empty, so there is nothing to lift.'
        return
      }
      picked = index
      message = 'Now click the tube to pour it into.'
      ctx.audio.blip(540, 40, 'square', 0.4)
      return
    }
    if (picked === index) {
      picked = null
      message = 'Put down.'
      return
    }
    startPour(picked, index)
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status === 'over') return input.endStep()
    if (shownFor > 0) {
      shownFor -= dt
      if (shownFor <= 0) shown = null
    }
    if (input.pressed('ArrowLeft', 'KeyA')) cursor = (cursor + tubes.length - 1) % tubes.length
    if (input.pressed('ArrowRight', 'KeyD')) cursor = (cursor + 1) % tubes.length
    if (input.pressed('ArrowDown', 'KeyS')) cursor = (cursor + layout().perRow) % tubes.length
    if (input.pressed('ArrowUp', 'KeyW')) cursor = (cursor + tubes.length - (layout().perRow % tubes.length)) % tubes.length
    if (input.pressed('Space')) choose(cursor)
    if (input.pressed('KeyU')) undo()
    if (input.pressed('KeyF')) hint()
    if (input.taps > 0) {
      const index = tubeAt(input.pointer.x, input.pointer.y)
      if (index !== null) {
        cursor = index
        choose(index)
      }
    }
    if (pouring) {
      pouring.t += dt * pace
      if (pouring.t >= 0.42) endPour()
    }
    emit()
    input.endStep()
  }

  // ------------------------------------------------------------ drawing

  const layerRect = (index: number, position: number): { x: number; y: number; w: number; h: number } => {
    const box = tubeBox(index)
    const layerH = box.h / TUBE_CAPACITY
    return { x: box.x + 3, y: box.y + box.h - (position + 1) * layerH, w: box.w - 6, h: layerH }
  }

  const draw = (): void => {
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    g.textAlign = 'center'

    for (let i = 0; i < tubes.length; i++) {
      const box = tubeBox(i)
      const lifted = picked === i ? 8 : 0
      g.save()
      g.translate(0, -lifted)
      g.fillStyle = colors.bgSoft
      g.beginPath()
      g.roundRect(box.x, box.y, box.w, box.h, [4, 4, box.w * 0.4, box.w * 0.4])
      g.fill()
      const hide = pouring && pouring.from === i ? pouring.count : 0
      for (let position = 0; position < tubes[i].length - hide; position++) {
        const rect = layerRect(i, position)
        g.fillStyle = layerColours[(tubes[i][position] - 1) % layerColours.length]
        g.beginPath()
        g.roundRect(rect.x, rect.y, rect.w, rect.h, position === 0 ? [2, 2, box.w * 0.34, box.w * 0.34] : 2)
        g.fill()
        // The colour's own number, so the tubes can be told apart without relying on colour alone.
        g.fillStyle = 'rgba(5, 7, 12, 0.6)'
        g.font = '600 10px system-ui, sans-serif'
        g.fillText(String(tubes[i][position]), rect.x + rect.w / 2, rect.y + rect.h / 2 + 3)
      }
      g.strokeStyle = shown && (shown[0] === i || shown[1] === i) ? colors.warn : i === cursor ? colors.primary : isTubeDone(tubes[i]) && tubes[i].length ? colors.good : colors.muted
      g.lineWidth = shown && (shown[0] === i || shown[1] === i) ? 3 : i === cursor ? 2.5 : 1.5
      g.beginPath()
      g.roundRect(box.x, box.y, box.w, box.h, [4, 4, box.w * 0.4, box.w * 0.4])
      g.stroke()
      g.fillStyle = colors.muted
      g.font = '500 10px system-ui, sans-serif'
      g.fillText(String(i + 1), box.x + box.w / 2, box.y + box.h + 13)
      g.restore()
    }

    if (pouring) {
      const u = Math.min(1, pouring.t / 0.42)
      const from = layerRect(pouring.from, tubes[pouring.from].length - pouring.count)
      const to = layerRect(pouring.to, tubes[pouring.to].length)
      g.fillStyle = layerColours[(pouring.colour - 1) % layerColours.length]
      for (let n = 0; n < pouring.count; n++) {
        const offset = n * (to.h + 1)
        const x = from.x + (to.x - from.x) * u
        // Up and over: the layers lift out of one tube and drop into the other.
        const lift = ctx.prefs.reducedMotion ? 0 : Math.sin(u * Math.PI) * 42
        const y = from.y - offset + (to.y - offset - (from.y - offset)) * u - lift
        g.beginPath()
        g.roundRect(x, y, to.w, to.h - 1, 2)
        g.fill()
      }
    }

    g.fillStyle = colors.text
    g.font = '600 13px system-ui, sans-serif'
    g.fillText(status === 'ready' ? 'Click a tube to lift it. U undoes, F finds a pour.' : message, W / 2, 16)
  }

  const loop = createLoop(step, draw)

  const fresh = (): void => {
    tubes = generateTubes(difficulty).tubes
    history = []
    status = 'ready'
    picked = null
    cursor = 0
    moves = 0
    undos = 0
    hints = 0
    seconds = 0
    pouring = null
    shown = null
    message = `${level.colours} colours, ${tubes.length} tubes. Click one to lift it.`
    window.clearInterval(clock)
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
      loop.stop()
      ctx.audio.pauseMusic()
      keep()
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
      ctx.save?.(null)
      fresh()
      loop.start()
    },
    restore(saved) {
      if (!isSortSave(saved) || saved.difficulty !== difficulty || saved.colours !== level.colours || saved.capacity !== TUBE_CAPACITY) return false
      tubes = saved.tubes.map((tube) => tube.slice())
      history = []
      moves = Math.max(0, Math.round(saved.moves) || 0)
      undos = Math.max(0, Math.round(saved.undos) || 0)
      seconds = Math.max(0, Math.round(saved.seconds) || 0)
      picked = null
      status = 'running'
      message = 'Carrying on where you left off. Undo starts again from here.'
      startClock()
      emit(true)
      return true
    },
    destroy() {
      keep()
      window.clearInterval(clock)
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

const waterSort: GameModule = { id: 'water-sort', surface: 'canvas', create }
export default waterSort
