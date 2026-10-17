import type { GameId, ScoreRecord } from '../../../shared/offlineGames'

/**
 * The offline games' shared engine: a fixed-timestep loop (gameplay speed never depends on the frame rate), input that
 * only listens while the game has focus and only takes the game's own keys, synthesized sound (no audio files), a
 * DPI-aware canvas, and colors that follow high contrast. Everything a game starts, it stops in destroy().
 */

export interface GamePrefs {
  reducedMotion: boolean
  highContrast: boolean
  sound: boolean
  music: boolean
  difficulty: 'easy' | 'normal' | 'hard'
}

/*
 * What a game reports about itself, from where both halves of Orbis can read it.
 *
 * `src/shared/games/reported.ts`, because the arcade's surface declaration needs this shape to say what a game is
 * doing and that declaration is read by the main process, where none of the browser types in this file exist. Still
 * exported from here, so everything that already asks the engine what a game's state looks like goes on working.
 */
export type { GameState, GameStatus } from '../../../shared/games/reported.ts'
import type { GameState } from '../../../shared/games/reported.ts'

export interface GameContext {
  gameId: GameId
  root: HTMLElement
  canvas: HTMLCanvasElement | null
  prefs: GamePrefs
  best: number | undefined
  input: Input
  audio: GameAudio
  /** The game's state changed (throttled by the shell). */
  emit(state: GameState): void
  /** The game ended with a real score. */
  over(result: { score: number; extra?: ScoreRecord['extra'] }): void
  /** A continuable game's progress, to save. */
  save?(state: unknown): void
}

export interface GameInstance {
  start(): void
  pause(): void
  resume(): void
  restart(): void
  destroy(): void
  resize(width: number, height: number): void
  /** Continuable games: load a saved state; false when it can't be used. */
  restore?(saved: unknown): boolean
}

export interface GameModule {
  id: GameId
  surface: 'canvas' | 'dom'
  create(ctx: GameContext): GameInstance
}

// ---------------------------------------------------------------- loop

export interface Loop {
  start(): void
  stop(): void
  readonly running: boolean
}

/** Runs `step` at a fixed rate (default 120 Hz) and `draw` once per animation frame, only while started. */
export function createLoop(step: (dt: number) => void, draw: () => void, hz = 120): Loop {
  const dt = 1 / hz
  let raf = 0
  let last = 0
  let acc = 0
  let running = false
  const frame = (time: number): void => {
    if (!running) return
    // A long gap (the tab was hidden) doesn't fast-forward the game.
    acc += Math.min(0.25, (time - last) / 1000)
    last = time
    while (acc >= dt) {
      step(dt)
      acc -= dt
    }
    draw()
    raf = requestAnimationFrame(frame)
  }
  return {
    start() {
      if (running) return
      running = true
      last = performance.now()
      acc = 0
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
    get running() {
      return running
    }
  }
}

// ---------------------------------------------------------------- input

/** Keys games use. Anything else (and anything with Ctrl, Alt or Meta) passes through to Orbis untouched. */
export const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyP', 'KeyF', 'KeyU', 'Enter'])

const PAD: Record<string, { button?: number[]; axis?: [number, number] }> = {
  ArrowLeft: { button: [14], axis: [0, -1] },
  ArrowRight: { button: [15], axis: [0, 1] },
  ArrowUp: { button: [12], axis: [1, -1] },
  ArrowDown: { button: [13], axis: [1, 1] },
  Space: { button: [0] },
  Enter: { button: [9] },
  KeyP: { button: [9] }
}

export interface Input {
  /** Held right now (keyboard or gamepad). */
  down(...codes: string[]): boolean
  /** Pressed since the last frame. */
  pressed(...codes: string[]): boolean
  /** Pointer position within the play area, whether it is down, and when it last moved. */
  pointer: { x: number; y: number; down: boolean; movedAt: number }
  /** Pointer presses (taps, clicks) since the last frame. */
  taps: number
  /** Call at the end of each fixed step. */
  endStep(): void
  destroy(): void
}

export function createInput(root: HTMLElement, surface: HTMLElement): Input {
  const held = new Set<string>()
  const edges = new Set<string>()
  const padPrev = new Set<string>()
  const pointer = { x: 0, y: 0, down: false, movedAt: 0 }
  const state = { taps: 0 }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || !GAME_KEYS.has(e.code)) return
    // Typing games take text themselves; these listeners only claim game keys.
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'keydown') {
      if (!held.has(e.code)) edges.add(e.code)
      held.add(e.code)
    } else held.delete(e.code)
  }
  const onBlur = (): void => held.clear()
  const onPointer = (e: PointerEvent): void => {
    const rect = surface.getBoundingClientRect()
    pointer.x = e.clientX - rect.left
    pointer.y = e.clientY - rect.top
    if (e.type === 'pointermove') pointer.movedAt = performance.now()
    if (e.type === 'pointerdown') {
      pointer.down = true
      state.taps++
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel') pointer.down = false
  }
  root.addEventListener('keydown', onKey)
  root.addEventListener('keyup', onKey)
  root.addEventListener('blur', onBlur, true)
  surface.addEventListener('pointerdown', onPointer)
  surface.addEventListener('pointermove', onPointer)
  window.addEventListener('pointerup', onPointer)
  window.addEventListener('pointercancel', onPointer)

  const padDown = (code: string): boolean => {
    const map = PAD[code]
    if (!map || typeof navigator.getGamepads !== 'function') return false
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue
      if (map.button?.some((b) => pad.buttons[b]?.pressed)) return true
      if (map.axis && Math.sign(pad.axes[map.axis[0]] ?? 0) === map.axis[1] && Math.abs(pad.axes[map.axis[0]] ?? 0) > 0.5) return true
    }
    return false
  }

  return {
    down: (...codes) => codes.some((c) => held.has(c) || padDown(c)),
    pressed: (...codes) => codes.some((c) => edges.has(c) || (padDown(c) && !padPrev.has(c))),
    pointer,
    get taps() {
      return state.taps
    },
    set taps(value: number) {
      state.taps = value
    },
    endStep() {
      edges.clear()
      state.taps = 0
      padPrev.clear()
      for (const code of Object.keys(PAD)) if (padDown(code)) padPrev.add(code)
    },
    destroy() {
      root.removeEventListener('keydown', onKey)
      root.removeEventListener('keyup', onKey)
      root.removeEventListener('blur', onBlur, true)
      surface.removeEventListener('pointerdown', onPointer)
      surface.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerup', onPointer)
      window.removeEventListener('pointercancel', onPointer)
      held.clear()
    }
  }
}

// ---------------------------------------------------------------- sound

export interface GameAudio {
  /** A short synthesized sound. */
  blip(frequency: number, ms?: number, type?: OscillatorType, volume?: number): void
  setSound(on: boolean): void
  /** A quiet, slow background pattern (only while playing and when music is on). */
  setMusic(on: boolean): void
  pauseMusic(): void
  resumeMusic(): void
  destroy(): void
}

export function createAudio(sound: boolean, music: boolean): GameAudio {
  let ctx: AudioContext | null = null
  let soundOn = sound
  let musicOn = music
  let musicTimer = 0
  let note = 0
  const context = (): AudioContext | null => {
    try {
      ctx ??= new AudioContext()
      if (ctx.state === 'suspended') void ctx.resume()
      return ctx
    } catch {
      return null
    }
  }
  const tone = (frequency: number, ms: number, type: OscillatorType, volume: number): void => {
    const c = context()
    if (!c) return
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = type
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(Math.min(0.2, 0.06 * volume), c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + ms / 1000)
    osc.connect(gain).connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + ms / 1000 + 0.02)
  }
  const PATTERN = [220, 277.18, 329.63, 415.3, 329.63, 277.18]
  const startMusic = (): void => {
    if (!musicOn || musicTimer) return
    musicTimer = window.setInterval(() => tone(PATTERN[note++ % PATTERN.length], 380, 'sine', 0.35), 520)
  }
  const stopMusic = (): void => {
    window.clearInterval(musicTimer)
    musicTimer = 0
  }
  return {
    blip(frequency, ms = 90, type = 'square', volume = 1) {
      if (soundOn) tone(frequency, ms, type, volume)
    },
    setSound(on) {
      soundOn = on
    },
    setMusic(on) {
      musicOn = on
      if (on) startMusic()
      else stopMusic()
    },
    pauseMusic: stopMusic,
    resumeMusic: startMusic,
    destroy() {
      stopMusic()
      void ctx?.close().catch(() => undefined)
      ctx = null
    }
  }
}

// ---------------------------------------------------------------- drawing helpers

/** Sizes a canvas for the screen's pixel density; returns its 2D context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const g = canvas.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return g
}

export interface Palette {
  bg: string
  bgSoft: string
  text: string
  muted: string
  primary: string
  secondary: string
  accent: string
  good: string
  warn: string
  danger: string
}

export const palette = (highContrast: boolean): Palette =>
  highContrast
    ? { bg: '#000000', bgSoft: '#111111', text: '#ffffff', muted: '#dddddd', primary: '#00ffff', secondary: '#ffff00', accent: '#ff66ff', good: '#00ff66', warn: '#ffcc00', danger: '#ff3333' }
    : { bg: '#05070c', bgSoft: '#0d1220', text: '#e8f4ff', muted: '#7d8aa3', primary: '#3fd8ff', secondary: '#a78bfa', accent: '#f472b6', good: '#34d399', warn: '#fbbf24', danger: '#f87171' }

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export const difficultyFactor = (d: GamePrefs['difficulty']): number => (d === 'easy' ? 0.8 : d === 'hard' ? 1.25 : 1)

/** Circle vs axis-aligned rectangle overlap. */
export function circleRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = clamp(cx, x, x + w)
  const ny = clamp(cy, y, y + h)
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r
}

/** A small, seedable random generator (for layouts that should be the same each time). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}
