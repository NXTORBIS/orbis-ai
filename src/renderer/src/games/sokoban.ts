import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, fitCanvas, palette } from './engine'
import type { Direction, Room, RoomState } from '../../../shared/games/sokoban'
import { isRoomState, roomScore, roomsFor, solved, startState, step as walkStep, stuckCrates, walkPath } from '../../../shared/games/sokoban'

interface Saved {
  room: number
  state: RoomState
  score: number
  undos: number
}

/**
 * Crate Pusher: get every crate onto a mark. You can push a crate and you can never pull one, so a crate shoved into
 * a corner stays there -- which is why undo is a first-class part of the game rather than a mercy. When a crate really
 * cannot be moved again the game says so straight away, in those words, instead of leaving somebody to work out that
 * the room is already lost.
 *
 * Walk with the arrows or WASD. Clicking a square you could walk to walks there, around the crates; it never pushes
 * anything, because every push should be something you meant.
 */
function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 450
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const difficulty = ctx.prefs.difficulty
  const rooms = roomsFor(difficulty)

  let status: GameStatus = 'ready'
  let index = 0
  let room: Room = rooms[0]
  let state: RoomState = startState(room)
  let history: RoomState[] = []
  let undos = 0
  let score = 0
  let elapsed = 0
  let queued: Direction[] = []
  let walkLeft = 0
  let stuck: number[] = []
  let note = { text: '', left: 0 }
  let lastEmit = 0

  const say = (text: string, seconds = 2.4): void => {
    note = { text, left: seconds }
  }

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score,
      level: index + 1,
      elapsedMs: Math.round(elapsed * 1000),
      difficulty: 1 + index * 0.25,
      hud: [
        { label: 'Room', value: `${index + 1} of ${rooms.length}` },
        { label: 'Crates home', value: `${state.crates.filter((c) => room.goals.includes(c)).length} of ${room.crates.length}` },
        { label: 'Steps', value: state.moves }
      ]
    })
  }

  const saveNow = (): void => {
    if (status === 'running' || status === 'paused') ctx.save?.({ room: index, state, score, undos } satisfies Saved)
  }

  const openRoom = (at: number): void => {
    index = at
    room = rooms[at]
    state = startState(room)
    history = []
    queued = []
    walkLeft = 0
    stuck = []
    say(room.name, 2.8)
    emit(true)
  }

  const reset = (): void => {
    status = 'ready'
    score = 0
    undos = 0
    elapsed = 0
    openRoom(0)
  }

  const finish = (): void => {
    status = 'over'
    ctx.save?.(null)
    ctx.audio.blip(880, 260, 'sine')
    emit(true)
    ctx.over({ score, extra: { difficulty } })
  }

  const roomDone = (): void => {
    const gained = roomScore(room.crates.length, state.moves, undos, difficulty)
    score += gained
    ctx.audio.blip(760, 180, 'sine')
    if (index + 1 >= rooms.length) {
      say(`Every room done. ${gained} for that one.`)
      emit(true)
      finish()
      return
    }
    say(`Room done: ${gained} points`)
    openRoom(index + 1)
    saveNow()
  }

  const take = (dir: Direction): void => {
    if (status !== 'running') return
    const next = walkStep(room, state, dir)
    if (!next) {
      ctx.audio.blip(150, 40, 'square', 0.3)
      return
    }
    history.push(state)
    if (history.length > 400) history.shift()
    state = next.state
    if (next.pushed) {
      ctx.audio.blip(300, 55, 'triangle', 0.5)
      stuck = stuckCrates(room, state)
      if (stuck.length) {
        say('That crate cannot be moved again. Press U to undo.', 4)
        ctx.audio.blip(170, 220, 'sawtooth', 0.6)
      }
    } else ctx.audio.blip(520, 16, 'sine', 0.22)
    if (solved(room, state)) {
      queued = []
      roomDone()
    }
  }

  /** A step taken by hand drops whatever walk a click had worked out. */
  const byHand = (dir: Direction): void => {
    queued = []
    take(dir)
  }

  const undo = (): void => {
    const previous = history.pop()
    if (!previous) {
      say('Nothing to undo yet')
      return
    }
    state = previous
    undos++
    queued = []
    stuck = stuckCrates(room, state)
    // The warning about a wedged crate goes with the step that caused it.
    say(stuck.length ? 'That crate still cannot be moved. Undo again.' : 'Step undone', stuck.length ? 3 : 1.2)
    ctx.audio.blip(420, 40, 'sine', 0.35)
    emit(true)
  }

  const again = (): void => {
    state = startState(room)
    history = []
    queued = []
    stuck = []
    undos++
    say('Room started again')
    emit(true)
  }

  const geometry = (): { cell: number; ox: number; oy: number } => {
    const cell = Math.max(10, Math.floor(Math.min((W - 24) / room.width, (H - 48) / room.height)))
    return { cell, ox: Math.floor((W - cell * room.width) / 2), oy: Math.floor((H - cell * room.height) / 2) + 8 }
  }

  /** A click walks there if you could walk there. It never pushes: a push should always be something you meant. */
  const clicked = (x: number, y: number): void => {
    const { cell, ox, oy } = geometry()
    const cx = Math.floor((x - ox) / cell)
    const cy = Math.floor((y - oy) / cell)
    if (cx < 0 || cy < 0 || cx >= room.width || cy >= room.height) return
    const target = cy * room.width + cx
    const beside: Direction | undefined = (['up', 'down', 'left', 'right'] as Direction[]).find((dir) => {
      const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
      const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0
      return state.player + dy * room.width + dx === target
    })
    if (beside) return take(beside)
    const path = walkPath(room, state, target)
    if (!path || !path.length) {
      if (!path) say('No way to walk there without pushing something')
      return
    }
    queued = path
    walkLeft = 0
  }

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'ready' && (input.taps > 0 || input.pressed('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'))) {
      status = 'running'
      emit(true)
    }
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (status !== 'running') return input.endStep()
    elapsed += dt
    if (note.left > 0) note.left -= dt

    if (input.pressed('ArrowUp', 'KeyW')) byHand('up')
    if (input.pressed('ArrowDown', 'KeyS')) byHand('down')
    if (input.pressed('ArrowLeft', 'KeyA')) byHand('left')
    if (input.pressed('ArrowRight', 'KeyD')) byHand('right')
    if (input.pressed('KeyU')) undo()
    if (input.taps > 0) clicked(input.pointer.x, input.pointer.y)

    // A walk worked out from a click is played out a step at a time, so you can see the route taken.
    if (queued.length) {
      walkLeft -= dt
      while (queued.length && walkLeft <= 0) {
        take(queued.shift()!)
        walkLeft += ctx.prefs.reducedMotion ? 0 : 0.055
      }
    }
    emit()
    input.endStep()
  }

  const draw = (): void => {
    const { cell, ox, oy } = geometry()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)
    const crates = new Set(state.crates)
    const goals = new Set(room.goals)
    const stuckSet = new Set(stuck)

    for (let i = 0; i < room.width * room.height; i++) {
      const x = ox + (i % room.width) * cell
      const y = oy + Math.floor(i / room.width) * cell
      if (room.walls[i]) {
        // Only the walls touching the floor are drawn, so the room reads as a room rather than a block of colour.
        const touching = [i - 1, i + 1, i - room.width, i + room.width].some((n) => n >= 0 && n < room.walls.length && !room.walls[n])
        if (!touching) continue
        g.fillStyle = ctx.prefs.highContrast ? colors.text : '#223352'
        g.beginPath()
        g.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3)
        g.fill()
        continue
      }
      g.fillStyle = colors.bgSoft
      g.fillRect(x, y, cell, cell)
      if (goals.has(i)) {
        g.strokeStyle = colors.warn
        g.lineWidth = 2
        g.beginPath()
        g.arc(x + cell / 2, y + cell / 2, cell * 0.22, 0, Math.PI * 2)
        g.stroke()
      }
    }

    for (const crate of crates) {
      const x = ox + (crate % room.width) * cell
      const y = oy + Math.floor(crate / room.width) * cell
      const home = goals.has(crate)
      g.fillStyle = stuckSet.has(crate) ? colors.danger : home ? colors.good : colors.secondary
      g.beginPath()
      g.roundRect(x + cell * 0.1, y + cell * 0.1, cell * 0.8, cell * 0.8, Math.max(2, cell * 0.14))
      g.fill()
      g.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      g.lineWidth = Math.max(1, cell * 0.06)
      g.beginPath()
      g.moveTo(x + cell * 0.2, y + cell * 0.2)
      g.lineTo(x + cell * 0.8, y + cell * 0.8)
      g.moveTo(x + cell * 0.8, y + cell * 0.2)
      g.lineTo(x + cell * 0.2, y + cell * 0.8)
      g.stroke()
    }

    const px = ox + (state.player % room.width) * cell + cell / 2
    const py = oy + Math.floor(state.player / room.width) * cell + cell / 2
    g.fillStyle = colors.primary
    g.beginPath()
    g.arc(px, py, cell * 0.32, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = colors.text
    g.lineWidth = 2
    g.beginPath()
    g.arc(px, py, cell * 0.32, 0, Math.PI * 2)
    g.stroke()

    g.textAlign = 'center'
    g.fillStyle = colors.muted
    g.font = '600 12px system-ui, sans-serif'
    g.fillText(`${room.name} · room ${index + 1} of ${rooms.length}`, W / 2, Math.max(14, oy - 10))
    if (status === 'ready') {
      g.fillStyle = colors.text
      g.font = '600 15px system-ui, sans-serif'
      g.fillText('Arrow keys or click a square to start', W / 2, oy + cell * room.height + 24)
    } else if (note.left > 0) {
      g.fillStyle = stuck.length ? colors.danger : colors.warn
      g.font = '600 13px system-ui, sans-serif'
      g.fillText(note.text, W / 2, oy + cell * room.height + 24)
    } else {
      g.fillStyle = colors.muted
      g.font = '12px system-ui, sans-serif'
      g.fillText('U undoes · R starts the room again', W / 2, oy + cell * room.height + 24)
    }
  }

  // R starts the room again, and it is not a key the shared input takes.
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.code !== 'KeyR') return
    e.preventDefault()
    e.stopPropagation()
    if (status === 'running') again()
  }
  ctx.root.addEventListener('keydown', onKey)

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
      saveNow()
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
      reset()
      loop.start()
    },
    restore(saved) {
      const s = saved as Saved
      if (!s || !Number.isInteger(s.room) || s.room < 0 || s.room >= rooms.length || !isRoomState(s.state)) return false
      const target = rooms[s.room]
      // The rooms a run is made of depend on the difficulty, so a saved room has to fit the room it claims to be.
      if (s.state.crates.length !== target.crates.length || s.state.crates.some((c) => target.walls[c]) || target.walls[s.state.player]) return false
      loop.stop()
      index = s.room
      room = target
      state = s.state
      score = Number(s.score) || 0
      undos = Number(s.undos) || 0
      history = []
      queued = []
      stuck = stuckCrates(room, state)
      status = 'paused'
      emit(true)
      draw()
      return true
    },
    destroy() {
      loop.stop()
      saveNow()
      ctx.root.removeEventListener('keydown', onKey)
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

const sokoban: GameModule = { id: 'sokoban', surface: 'canvas', create }
export default sokoban
