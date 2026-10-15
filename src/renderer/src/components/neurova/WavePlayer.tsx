import { useCallback, useEffect, useRef, useState } from 'react'

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Plays one stored version in the app and draws its real waveform. The file comes from the main process by artifact id. */
export function WavePlayer({ projectId, artifactId, label }: { projectId: string; artifactId: string; label: string }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
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
    let url: string | null = null
    setReady(false); setError(null); setPlaying(false); setTime(0)
    void (async () => {
      try {
        const [bytes, wave] = await Promise.all([window.api.neurovaAudioBytes(projectId, artifactId), window.api.neurovaWaveform(projectId, artifactId).catch(() => [] as number[])])
        if (dead) return
        peaks.current = wave
        url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
        const el = new Audio(url)
        el.preload = 'auto'
        el.onloadedmetadata = () => setDuration(el.duration)
        el.onended = () => setPlaying(false)
        el.onerror = () => setError('This audio could not be played.')
        audio.current = el
        setReady(true)
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not load this audio.')
      }
    })()
    return () => { dead = true; audio.current?.pause(); audio.current = null; if (url) URL.revokeObjectURL(url) }
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
