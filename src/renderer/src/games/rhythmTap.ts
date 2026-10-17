import type { GameContext, GameInstance, GameModule, GameStatus } from './engine'
import { createLoop, fitCanvas, palette } from './engine'
import type { Counts, Grade, Song } from '../../../shared/games/rhythmTap.ts'
import { LANES, WINDOWS, accuracyOf, emptyCounts, judge, makeSong, nearestOpen, notePoints, rank } from '../../../shared/games/rhythmTap.ts'

/**
 * On the Beat: four lanes, notes falling to a line, hit them as they land. Early and late are counted separately and
 * shown, because knowing you are always a little early is the only way anybody gets better at this.
 *
 * The song and the chart come out of one list in `src/shared/games/rhythmTap.ts`, and this file plays a note's sound as
 * the clock passes it and draws the same note arriving at the line at the same moment. There is no second clock to
 * drift: the sound and the target are the same thing.
 *
 * It does not use the shared background music. That loop would play over the top of the beat and fight it; the beat
 * underneath this song is its own, and it only plays when music is switched on.
 */

const KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK']
const KEY_NAMES = ['D', 'F', 'J', 'K']
/** How long a note takes to fall from the top of the lane to the line. */
const FALL_MS = 1500
const LEAD_IN_MS = 2200

interface Pop {
  lane: number
  grade: Grade
  early: boolean
  deltaMs: number
  leftMs: number
}

function create(ctx: GameContext): GameInstance {
  const canvas = ctx.canvas!
  let W = 700
  let H = 500
  let g = fitCanvas(canvas, W, H)
  const colors = palette(ctx.prefs.highContrast)
  const reduced = ctx.prefs.reducedMotion

  let status: GameStatus = 'ready'
  let song: Song = makeSong(Date.now() & 0xffff, ctx.prefs.difficulty)
  let songMs = -LEAD_IN_MS
  let open: boolean[] = []
  let played: boolean[] = []
  let nextBacking = 0
  let counts: Counts = emptyCounts()
  let combo = 0
  let bestCombo = 0
  let score = 0
  let pops: Pop[] = []
  let deltas: number[] = []
  let flash = Array.from({ length: LANES }, () => 0)
  let lastEmit = 0

  const accuracy = (): number => accuracyOf(counts)

  const emit = (force = false): void => {
    if (!force && performance.now() - lastEmit < 100) return
    lastEmit = performance.now()
    ctx.emit({
      status,
      score,
      elapsedMs: Math.max(0, Math.round(songMs)),
      difficulty: Math.round((song.notes.length / (song.lengthMs / 1000)) * 100) / 100,
      hud: [{ label: 'Hit', value: `${accuracy()}%` }, { label: 'Run', value: combo }, { label: 'Missed', value: counts.miss }]
    })
  }

  const reset = (): void => {
    song = makeSong((Date.now() + Math.floor(Math.random() * 1e6)) & 0xffffff, ctx.prefs.difficulty)
    status = 'ready'
    songMs = -LEAD_IN_MS
    open = song.notes.map(() => true)
    played = song.notes.map(() => false)
    nextBacking = 0
    counts = emptyCounts()
    combo = 0
    bestCombo = 0
    score = 0
    pops = []
    deltas = []
    flash = Array.from({ length: LANES }, () => 0)
    emit(true)
  }

  const finish = (): void => {
    status = 'over'
    emit(true)
    ctx.over({ score, extra: { bestAccuracy: accuracy(), bestStreak: bestCombo, attempts: song.notes.length, difficulty: ctx.prefs.difficulty } })
  }

  const tap = (lane: number): void => {
    if (status !== 'running') return
    flash[lane] = 0.12
    const index = nearestOpen(song.notes, open, lane, songMs)
    if (index < 0) {
      // Nothing to hit: a tap into thin air breaks the run but does not count as a missed note.
      combo = 0
      ctx.audio.blip(140, 40, 'square', 0.25)
      pops.push({ lane, grade: 'miss', early: false, deltaMs: 0, leftMs: 500 })
      return
    }
    const note = song.notes[index]
    const delta = songMs - note.ms
    const { grade, early } = judge(delta)
    open[index] = false
    counts[grade]++
    if (grade === 'miss') combo = 0
    else {
      score += notePoints(grade, combo)
      combo++
      bestCombo = Math.max(bestCombo, combo)
    }
    deltas.push(delta)
    if (deltas.length > 24) deltas.shift()
    pops.push({ lane, grade, early, deltaMs: Math.round(delta), leftMs: 700 })
    if (grade !== 'miss') {
      // The note's own sound, so hitting it is what you hear.
      if (!played[index]) {
        played[index] = true
        ctx.audio.blip(note.freq, note.lengthMs, 'triangle', grade === 'perfect' ? 1 : 0.7)
      }
      if (grade === 'perfect') ctx.audio.blip(note.freq * 2, 50, 'sine', 0.3)
    } else ctx.audio.blip(120, 70, 'square', 0.3)
    emit(true)
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return
    const lane = KEYS.indexOf(event.code)
    if (lane < 0) return
    event.preventDefault()
    event.stopPropagation()
    if (status === 'ready') status = 'running'
    else tap(lane)
  }
  ctx.root.addEventListener('keydown', onKey)

  const step = (dt: number): void => {
    const input = ctx.input
    if (status === 'running' && input.pressed('KeyP', 'Enter')) {
      input.endStep()
      return instance.pause()
    }
    if (input.taps > 0) {
      const lane = Math.floor((input.pointer.x - laneLeft()) / laneWidth())
      if (status === 'ready') status = 'running'
      else if (lane >= 0 && lane < LANES) tap(lane)
    }
    if (status === 'ready' && input.pressed('Space')) status = 'running'
    if (status !== 'running') return input.endStep()

    const before = songMs
    songMs += dt * 1000

    // The beat underneath, and the notes nobody hit.
    if (ctx.prefs.music)
      while (nextBacking < song.backing.length && song.backing[nextBacking].ms <= songMs) {
        const hit = song.backing[nextBacking++]
        ctx.audio.blip(hit.freq, hit.lengthMs, hit.kind === 'kick' ? 'sine' : 'square', hit.kind === 'kick' ? 0.8 : 0.18)
      }
    else while (nextBacking < song.backing.length && song.backing[nextBacking].ms <= songMs) nextBacking++

    for (let i = 0; i < song.notes.length; i++) {
      if (!open[i]) continue
      const note = song.notes[i]
      if (note.ms + WINDOWS.ok >= songMs) break
      // It went past the line without being hit. The tune still plays it, so the song does not develop holes.
      open[i] = false
      counts.miss++
      combo = 0
      if (!played[i] && before <= note.ms + WINDOWS.ok) {
        played[i] = true
        ctx.audio.blip(note.freq, note.lengthMs, 'sine', 0.22)
      }
      pops.push({ lane: note.lane, grade: 'miss', early: false, deltaMs: WINDOWS.ok, leftMs: 600 })
    }

    for (const pop of pops) pop.leftMs -= dt * 1000
    pops = pops.filter((pop) => pop.leftMs > 0)
    for (let lane = 0; lane < LANES; lane++) if (flash[lane] > 0) flash[lane] -= dt

    if (songMs > song.lengthMs + 1200) {
      finish()
      return input.endStep()
    }
    emit()
    input.endStep()
  }

  // ---------------------------------------------------------------- drawing

  const boardWidth = (): number => Math.min(W - 24, 460)
  const laneWidth = (): number => boardWidth() / LANES
  const laneLeft = (): number => (W - boardWidth()) / 2
  const lineY = (): number => H - Math.max(70, H * 0.18)

  const gradeColor = (grade: Grade): string => (grade === 'perfect' ? colors.primary : grade === 'good' ? colors.good : grade === 'ok' ? colors.warn : colors.danger)

  const draw = (): void => {
    const left = laneLeft()
    const width = laneWidth()
    const line = lineY()
    g.fillStyle = colors.bg
    g.fillRect(0, 0, W, H)

    // The lanes.
    for (let lane = 0; lane < LANES; lane++) {
      g.fillStyle = lane % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'
      g.fillRect(left + lane * width, 0, width, H)
      if (flash[lane] > 0) {
        g.fillStyle = `rgba(63, 216, 255, ${Math.min(0.3, flash[lane] * 2)})`
        g.fillRect(left + lane * width, 0, width, H)
      }
    }

    // The line, and the keys under it.
    g.fillStyle = colors.muted
    g.fillRect(left, line, boardWidth(), 2)
    g.fillStyle = colors.text
    g.font = '600 15px system-ui, sans-serif'
    g.textAlign = 'center'
    for (let lane = 0; lane < LANES; lane++) {
      g.fillStyle = colors.bgSoft
      g.beginPath()
      g.roundRect(left + lane * width + 6, line + 10, width - 12, 34, 8)
      g.fill()
      g.fillStyle = colors.muted
      g.fillText(KEY_NAMES[lane], left + lane * width + width / 2, line + 32)
    }

    // The notes on their way down. A note's height is its time: the line is now, the top of the screen is a moment off.
    for (let i = 0; i < song.notes.length; i++) {
      if (!open[i]) continue
      const note = song.notes[i]
      const away = note.ms - songMs
      if (away > FALL_MS || away < -300) continue
      const y = line - (away / FALL_MS) * line
      const x = left + note.lane * width
      g.fillStyle = note.lane % 2 ? colors.secondary : colors.primary
      g.beginPath()
      g.roundRect(x + 8, y - 9, width - 16, 18, 6)
      g.fill()
    }

    // What just happened, in each lane.
    for (const pop of pops) {
      const fade = reduced ? 1 : Math.min(1, pop.leftMs / 400)
      g.globalAlpha = fade
      g.fillStyle = gradeColor(pop.grade)
      g.font = '600 15px system-ui, sans-serif'
      const words = pop.grade === 'miss' ? 'Missed' : pop.grade === 'perfect' ? 'Right on it' : pop.grade === 'good' ? 'Good' : 'Just about'
      g.fillText(words, left + pop.lane * width + width / 2, line - 30 - (reduced ? 0 : (1 - fade) * 20))
      if (pop.grade !== 'miss' && Math.abs(pop.deltaMs) > WINDOWS.perfect / 2) {
        g.fillStyle = colors.muted
        g.font = '11px system-ui, sans-serif'
        g.fillText(`${Math.abs(pop.deltaMs)}ms ${pop.early ? 'early' : 'late'}`, left + pop.lane * width + width / 2, line - 14)
      }
      g.globalAlpha = 1
    }

    // The timing strip: where the last two dozen taps landed, early on the left, late on the right.
    const stripW = Math.min(240, boardWidth())
    const stripX = (W - stripW) / 2
    const stripY = 18
    g.fillStyle = 'rgba(255,255,255,0.07)'
    g.fillRect(stripX, stripY, stripW, 6)
    g.fillStyle = colors.muted
    g.fillRect(stripX + stripW / 2 - 1, stripY - 3, 2, 12)
    for (const delta of deltas) {
      const at = stripX + stripW / 2 + (Math.max(-WINDOWS.ok, Math.min(WINDOWS.ok, delta)) / WINDOWS.ok) * (stripW / 2)
      g.fillStyle = gradeColor(judge(delta).grade)
      g.fillRect(at - 1, stripY, 2, 6)
    }
    g.fillStyle = colors.muted
    g.font = '10px system-ui, sans-serif'
    g.textAlign = 'left'
    g.fillText('early', stripX, stripY + 18)
    g.textAlign = 'right'
    g.fillText('late', stripX + stripW, stripY + 18)
    g.textAlign = 'center'
    if (deltas.length >= 6) {
      const average = deltas.reduce((sum, one) => sum + one, 0) / deltas.length
      g.fillStyle = Math.abs(average) > 35 ? colors.warn : colors.muted
      g.fillText(Math.abs(average) < 8 ? 'dead on' : `${Math.abs(Math.round(average))}ms ${average < 0 ? 'early' : 'late'} on average`, W / 2, stripY + 18)
    }

    // How much of the song is left.
    const through = Math.max(0, Math.min(1, songMs / song.lengthMs))
    g.fillStyle = colors.bgSoft
    g.fillRect(0, H - 4, W, 4)
    g.fillStyle = colors.primary
    g.fillRect(0, H - 4, W * through, 4)

    if (songMs < 0 && status === 'running') {
      g.fillStyle = colors.text
      g.font = '600 34px system-ui, sans-serif'
      g.fillText(String(Math.ceil(-songMs / (song.beatMs * 2))), W / 2, H * 0.4)
    }
    if (status === 'ready') {
      g.fillStyle = 'rgba(0,0,0,0.72)'
      g.fillRect(left, H * 0.3, boardWidth(), 132)
      g.fillStyle = colors.text
      g.font = '600 18px system-ui, sans-serif'
      g.fillText('Hit each note as it lands on the line', W / 2, H * 0.3 + 30)
      g.fillStyle = colors.muted
      g.font = '13px system-ui, sans-serif'
      g.fillText('D F J K for the four lanes, or tap a lane', W / 2, H * 0.3 + 56)
      g.fillText(`${rank(100)} is every note inside ${WINDOWS.perfect} thousandths of a second`, W / 2, H * 0.3 + 76)
      g.fillText(ctx.prefs.sound ? `${song.bpm} beats a minute` : 'Sound is off, so the beat is only on screen', W / 2, H * 0.3 + 96)
      g.fillStyle = colors.primary
      g.font = '600 14px system-ui, sans-serif'
      g.fillText('Press a key or tap to start', W / 2, H * 0.3 + 120)
    }
    if (status === 'over') {
      g.fillStyle = colors.text
      g.font = '600 20px system-ui, sans-serif'
      g.fillText(`${rank(accuracy())} — ${accuracy()}% of the notes`, W / 2, H * 0.4)
    }
  }

  const loop = createLoop(step, draw)
  const instance: GameInstance = {
    start() {
      reset()
      loop.start()
      // No shared background loop here: this game has a beat of its own.
      ctx.audio.pauseMusic()
    },
    pause() {
      if (status !== 'running') return
      status = 'paused'
      loop.stop()
      emit(true)
      draw()
    },
    resume() {
      if (status !== 'paused') return
      status = 'running'
      loop.start()
      emit(true)
    },
    restart() {
      loop.stop()
      reset()
      loop.start()
    },
    destroy() {
      loop.stop()
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

const rhythmTap: GameModule = { id: 'rhythm-tap', surface: 'canvas', create }
export default rhythmTap
