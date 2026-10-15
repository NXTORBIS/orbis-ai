import { useCallback, useEffect, useRef, useState } from 'react'

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * The app's content security policy allows no blob: media, so playback uses Web Audio: the file is decoded once and
 * played through a buffer source. This small object has the same shape the rest of the component needs.
 */
class BufferPlayer {
  private readonly ctx = new AudioContext()
  private source: AudioBufferSourceNode | null = null
  private offset = 0
  private startedAt = 0
  paused = true
  duration = 0
  onended: (() => void) | null = null
  private buffer: AudioBuffer | null = null

  async load(bytes: ArrayBuffer): Promise<void> {
    this.buffer = await this.ctx.decodeAudioData(bytes.slice(0))
    this.duration = this.buffer.duration
  }

  get currentTime(): number {
    if (this.paused) return this.offset
    return Math.min(this.duration, this.offset + (this.ctx.currentTime - this.startedAt))
  }

  set currentTime(t: number) {
    const was = !this.paused
    this.stop()
    this.offset = Math.max(0, Math.min(this.duration, t))
    if (was) void this.play()
  }

  private stop(): void {
    if (this.source) { this.source.onended = null; try { this.source.stop() } catch { /* already stopped */ } this.source.disconnect(); this.source = null }
    if (!this.paused) this.offset = this.currentTime
    this.paused = true
  }

  async play(): Promise<void> {
    if (!this.buffer) throw new Error('not loaded')
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.offset >= this.duration) this.offset = 0
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.ctx.destination)
    src.onended = () => { if (this.source === src) { this.source = null; this.paused = true; this.offset = 0; this.onended?.() } }
    this.startedAt = this.ctx.currentTime
    src.start(0, this.offset)
    this.source = src
    this.paused = false
  }

  pause(): void { this.stop() }
  close(): void { this.stop(); void this.ctx.close().catch(() => undefined) }
}

/** Plays one stored version in the app and draws its real waveform. The file comes from the main process by artifact id. */
export function WavePlayer({ projectId, artifactId, label }: { projectId: string; artifactId: string; label: string }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const audio = useRef<BufferPlayer | null>(null)
  const peaks = useRef<number[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const draw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const w = c.clientWidth, h = c.clientHeight
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const color = getComputedStyle(c).color
    const p = peaks.current
    const a = audio.current
    const frac = a && a.duration ? a.currentTime / a.duration : 0
    g.fillStyle = color
    for (let i = 0; i < p.length; i++) {
      g.globalAlpha = i / p.length <= frac ? 1 : 0.4
      const hh = Math.max(1, p[i] * h)
      g.fillRect((i / p.length) * w, (h - hh) / 2, Math.max(1, w / p.length - 0.5), hh)
    }
    g.globalAlpha = 1
    g.fillRect(frac * w - 1, 0, 2, h)
  }, [])

  useEffect(() => {
    let dead = false
    setReady(false); setError(null); setPlaying(false); setTime(0)
    void (async () => {
      try {
        const [bytes, wave] = await Promise.all([window.api.neurovaAudioBytes(projectId, artifactId), window.api.neurovaWaveform(projectId, artifactId).catch(() => [] as number[])])
        if (dead) return
        peaks.current = wave
        const el = new BufferPlayer()
        try { await el.load(bytes) } catch { el.close(); throw new Error('This audio could not be played.') }
        if (dead) { el.close(); return }
        setDuration(el.duration)
        el.onended = () => setPlaying(false)
        audio.current = el
        setReady(true)
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not load this audio.')
      }
    })()
    return () => { dead = true; audio.current?.close(); audio.current = null }
  }, [projectId, artifactId])

  useEffect(() => { draw() }, [ready, draw, time])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => { const a = audio.current; if (a) setTime(a.currentTime); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = (): void => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setError('This audio could not be played.'))
    else { a.pause(); setPlaying(false) }
  }
  const seekTo = (t: number): void => { const a = audio.current; if (!a || !a.duration) return; a.currentTime = Math.max(0, Math.min(a.duration, t)); setTime(a.currentTime) }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === ' ') { e.preventDefault(); toggle() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo((audio.current?.currentTime ?? 0) + 5) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo((audio.current?.currentTime ?? 0) - 5) }
    else if (e.key === 'Home') { e.preventDefault(); seekTo(0) }
  }

  if (error) return <p className="nv-bad" role="alert">{error}</p>
  return (
    <div className="nv-player">
      <canvas ref={canvas} className="nv-wp-canvas" tabIndex={0} role="slider" aria-label={`Playback position of ${label}. Space plays or pauses, arrow keys move five seconds.`}
        aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={`${mmss(time)} of ${mmss(duration)}`}
        onKeyDown={onKey}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * (audio.current?.duration ?? 0)) }} />
      <div className="nv-wp-row">
        <button className="nv-wp-btn" disabled={!ready} onClick={toggle} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>{playing ? 'Pause' : 'Play'}</button>
        <span>{ready ? `${mmss(time)} / ${mmss(duration)}` : 'Loading...'}</span>
      </div>
    </div>
  )
}
