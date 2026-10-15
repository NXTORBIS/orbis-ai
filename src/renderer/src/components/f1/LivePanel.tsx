import { Maximize2, Pause, Play, Radio, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LiveDriverRow, LiveRaceControl } from '../../../../shared/f1/live/snapshot'
import type { StreamEvent, StreamPhase } from '../../../../shared/f1/live/stream-types'
import { formatLapTime } from '../../../../shared/f1/time'
import type { F1Answer } from '../../../../shared/f1/types'
import type { ArchiveSession } from '../../../../shared/f1/archive'
import { TrackMap, type MapCar } from './Chart'
import { ExportButton } from './shared'

const PHASE_LABEL: Record<StreamPhase, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  live: 'LIVE',
  'last-session': 'Last session (not live)',
  waiting: 'Waiting',
  stale: 'Live, but data is stale',
  disconnected: 'Connection lost',
  replay: 'REPLAY',
  loading: 'Loading'
}

const COMPOUND: Record<string, { short: string; colour: string }> = {
  SOFT: { short: 'S', colour: '#ff4d4d' },
  MEDIUM: { short: 'M', colour: '#ffd34d' },
  HARD: { short: 'H', colour: '#f2f2f2' },
  INTERMEDIATE: { short: 'I', colour: '#4dd36b' },
  WET: { short: 'W', colour: '#4d9bff' }
}

const TRACK_WORDS: Record<string, string> = {
  AllClear: 'Track clear',
  Yellow: 'Yellow flag',
  DoubleYellow: 'Double yellow',
  SCDeployed: 'Safety car',
  VSCDeployed: 'Virtual safety car',
  VSCEnding: 'VSC ending',
  Red: 'Red flag'
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const sectorClass = (m: 'overall' | 'personal' | 'none'): string => (m === 'overall' ? 'is-session' : m === 'personal' ? 'is-personal' : '')

export default function LivePanel({ year }: { year: number }): React.JSX.Element {
  const [ev, setEv] = useState<StreamEvent | null>(null)
  const [archive, setArchive] = useState<ArchiveSession[] | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [rcFilter, setRcFilter] = useState('')
  const [find, setFind] = useState('')
  const [dense, setDense] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [traps, setTraps] = useState(false)
  const [history, setHistory] = useState<{ at: string; text: string }[]>([])
  const prevRows = useRef<Map<string, LiveDriverRow>>(new Map())
  const grid = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const off = window.api.onF1Stream((e) => setEv(e as StreamEvent))
    void window.api.f1StreamState().then((e) => setEv(e as StreamEvent))
    return () => {
      off()
      void window.api.f1StreamStop()
    }
  }, [])

  useEffect(() => {
    let live = true
    setArchive(null)
    setArchiveError(null)
    window.api
      .f1Archive(year)
      .then((raw) => {
        if (!live) return
        const a = raw as F1Answer<ArchiveSession[]>
        if (a.ok) setArchive(a.data)
        else setArchiveError(a.message)
      })
      .catch((e: unknown) => live && setArchiveError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [year])

  const status = ev?.status ?? null
  const snap = ev?.snapshot ?? null
  const colours = useMemo(() => new Map((snap?.drivers ?? []).map((d) => [d.number, d])), [snap])

  const goLive = useCallback(() => void window.api.f1StreamLive(), [])
  const loadReplay = useCallback(() => {
    if (pick) void window.api.f1StreamReplay(pick)
  }, [pick])
  const control = (action: 'play' | 'pause' | 'seek' | 'speed', value?: number): void => void window.api.f1StreamControl(action, value)

  const cars: MapCar[] = (ev?.cars ?? []).map((c) => {
    const d = colours.get(c.number)
    return { number: c.number, code: d?.code ?? c.number, x: c.x, y: c.y, colour: d?.colour ?? '888888', speed: c.speed }
  })

  const messages: LiveRaceControl[] = useMemo(() => {
    const all = snap?.raceControl ?? []
    const f = rcFilter.trim().toLowerCase()
    return (f ? all.filter((m) => `${m.message} ${m.category ?? ''} ${m.flag ?? ''}`.toLowerCase().includes(f)) : all).slice().reverse()
  }, [snap, rcFilter])

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    const all = snap?.drivers ?? []
    return q ? all.filter((d) => `${d.code} ${d.name} ${d.team ?? ''} ${d.number}`.toLowerCase().includes(q)) : all
  }, [snap, find])
  const focused = focus ? (snap?.drivers.find((d) => d.number === focus) ?? null) : null

  // What changed between two pictures of the timing: pit entries and exits, retirements, a new leader, a new session-best lap.
  useEffect(() => {
    if (!snap) return
    const found: { at: string; text: string }[] = []
    const at = snap.clock.remaining ? `${snap.clock.remaining} left` : snap.lap.current !== null ? `Lap ${snap.lap.current}` : ''
    const before = prevRows.current
    if (before.size > 0) {
      for (const d of snap.drivers) {
        const p = before.get(d.number)
        if (!p) continue
        if (!p.inPit && d.inPit) found.push({ at, text: `${d.code} into the pits` })
        if (p.inPit && !d.inPit) found.push({ at, text: `${d.code} out of the pits` })
        if (!p.retired && d.retired) found.push({ at, text: `${d.code} out of the session` })
        if (d.position === 1 && p.position !== null && p.position !== 1) found.push({ at, text: `${d.code} takes the lead` })
        if (d.lastLap.mark === 'overall' && p.lastLap.mark !== 'overall' && d.lastLap.time !== null) found.push({ at, text: `${d.code} sets the fastest lap so far: ${formatLapTime(d.lastLap.time)}` })
      }
    }
    prevRows.current = new Map(snap.drivers.map((d) => [d.number, d]))
    if (found.length) setHistory((h) => [...found.reverse(), ...h].slice(0, 60))
  }, [snap])
  useEffect(() => {
    if (status?.phase === 'loading') setHistory([])
  }, [status?.phase])

  const replay = status?.replay ?? null
  const busy = status?.phase === 'loading' || status?.phase === 'connecting'
  const sessions = (archive ?? []).filter((s) => !/^\s*$/.test(s.path))

  return (
    <div className="f1-live">
      <div className="f1-sourcebar">
        <button type="button" className="f1-btn" onClick={goLive} disabled={busy}>
          <Radio size={14} /> Connect to live timing
        </button>
        <span className="f1-or">or replay a finished session</span>
        <select aria-label="Recorded session" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!archive}>
          <option value="">{archive ? 'Choose a session…' : archiveError ? 'Archive unavailable' : 'Loading sessions…'}</option>
          {sessions
            .slice()
            .reverse()
            .map((s) => (
              <option key={s.path} value={s.path}>
                {s.meeting} · {s.name}
              </option>
            ))}
        </select>
        <button type="button" className="f1-btn" onClick={loadReplay} disabled={!pick || busy}>
          <RotateCcw size={14} /> Replay
        </button>
      </div>
      {archiveError && <p className="f1-note f1-bad">The recorded-session list could not be loaded: {archiveError}</p>}

      <div className={`f1-status is-${status?.phase ?? 'idle'}`} role="status">
        <strong>{PHASE_LABEL[status?.phase ?? 'idle']}</strong>
        <span>{status?.message && status.message.replace(/\.$/, '') !== PHASE_LABEL[status.phase] ? status.message : 'Choose live timing, or a recorded session to replay.'}</span>
        {status?.loading && (
          <progress value={status.loading.done} max={status.loading.total} aria-label="Loading the recording">
            {status.loading.done}/{status.loading.total}
          </progress>
        )}
        {status && status.source === 'live' && (
          <small>
            {status.records} updates · {status.reconnects} reconnects{status.ageMs !== null ? ` · last ${Math.round(status.ageMs / 1000)}s ago` : ''}
            {status.lastError ? ` · ${status.lastError}` : ''}
          </small>
        )}
      </div>

      {replay && (
        <div className="f1-replaybar">
          <button type="button" className="f1-btn" onClick={() => control(replay.playing ? 'pause' : 'play')} aria-label={replay.playing ? 'Pause' : 'Play'}>
            {replay.playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={replay.durationMs}
            step={1000}
            value={replay.t}
            aria-label="Position in the recording"
            onChange={(e) => control('seek', Number(e.target.value))}
          />
          <span className="f1-time">
            {clock(replay.t)} / {clock(replay.durationMs)}
          </span>
          <label>
            Speed
            <select value={replay.speed} onChange={(e) => control('speed', Number(e.target.value))}>
              {[1, 2, 4, 8, 16, 32].map((s) => (
                <option key={s} value={s}>
                  ×{s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {snap && snap.drivers.length > 0 && (
        <>
          <div className="f1-sourcebar">
            <input className="f1-search" style={{ maxWidth: 260, marginBottom: 0 }} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a driver or team" aria-label="Find a driver or team" />
            <label className="f1-check">
              <input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} /> Compact
            </label>
            <label className="f1-check">
              <input type="checkbox" checked={traps} onChange={(e) => setTraps(e.target.checked)} /> Speed traps
            </label>
            <button type="button" className="f1-btn" onClick={() => void grid.current?.requestFullscreen?.().catch(() => undefined)} title="Fill the screen with the timing">
              <Maximize2 size={14} /> Full screen
            </button>
            <ExportButton
              name={`timing-${snap.session.meeting ?? 'session'}`}
              header={['Position', 'Driver', 'Team', 'Gap', 'Interval', 'Last lap', 'Best lap', 'S1', 'S2', 'S3', 'Tyre', 'Tyre laps', 'Pit stops']}
              rows={snap.drivers.map((d) => [d.position, d.code, d.team, d.gapToLeader, d.interval, formatLapTime(d.lastLap.time), formatLapTime(d.bestLap.time), ...d.sectors.map((x) => formatLapTime(x.time)), d.tyre?.compound ?? null, d.tyre?.laps ?? null, d.pitStops])}
            />
          </div>
          <div className="f1-headline">
            <span>
              <b>{snap.session.meeting ?? '–'}</b> · {snap.session.name ?? snap.session.type ?? ''}
            </span>
            <span>
              {snap.lap.current !== null ? `Lap ${snap.lap.current}${snap.lap.total ? ` / ${snap.lap.total}` : ''}` : ''}
              {snap.clock.remaining ? ` · ${snap.clock.remaining} left` : ''}
            </span>
            <span className={`f1-track is-${(snap.trackStatus.message ?? '').toLowerCase()}`}>{TRACK_WORDS[snap.trackStatus.message ?? ''] ?? snap.trackStatus.message ?? ''}</span>
            <span>
              {snap.weather.airTemp !== null ? `Air ${snap.weather.airTemp}°` : ''}
              {snap.weather.trackTemp !== null ? ` · Track ${snap.weather.trackTemp}°` : ''}
              {snap.weather.rainfall ? ' · Rain' : ''}
            </span>
          </div>
          <div className={`f1-livegrid${dense ? ' is-dense' : ''}`} ref={grid}>
            <table className="f1-table f1-leader">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Driver</th>
                  <th className="num">Gap</th>
                  <th className="num">Int</th>
                  <th className="num">Last</th>
                  <th className="num">Best</th>
                  <th className="num">S1</th>
                  <th className="num">S2</th>
                  <th className="num">S3</th>
                  {traps && <th className="num">Trap km/h</th>}
                  <th>Tyre</th>
                  <th className="num">Pits</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <Row key={d.number} d={d} traps={traps} focused={focus === d.number} onFocus={() => setFocus(focus === d.number ? null : d.number)} />
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={traps ? 12 : 11}>No driver or team matches “{find}”.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <aside>
              {focused && (
                <section className="f1-alerts" aria-label="Focused driver">
                  <h3 className="f1-h">
                    {focused.name} · #{focused.number}
                  </h3>
                  <p className="f1-note">
                    {focused.team ?? ''} · P{focused.position ?? '–'} · {focused.laps ?? '–'} laps · {focused.pitStops ?? 0} stops{focused.grid ? ` · started P${focused.grid}` : ''}
                  </p>
                  <p className="f1-note">
                    Best {formatLapTime(focused.bestLap.time)}
                    {focused.bestLap.lap !== null ? ` (lap ${focused.bestLap.lap})` : ''} · last {formatLapTime(focused.lastLap.time)}
                  </p>
                  <p className="f1-note">
                    Speed traps (km/h): I1 {focused.speeds.i1 ?? '–'} · I2 {focused.speeds.i2 ?? '–'} · finish {focused.speeds.fl ?? '–'} · straight {focused.speeds.st ?? '–'}
                  </p>
                  {focused.stints.length > 0 && <p className="f1-note">Tyres: {focused.stints.map((t) => `${COMPOUND[t.compound ?? '']?.short ?? '?'}${t.laps ?? ''}`).join(' → ')}</p>}
                </section>
              )}
              <TrackMap outline={ev?.outline ?? null} cars={cars} height={300} corners />
              <p className="f1-legend">
                <span className="is-session">Session best</span> <span className="is-personal">Personal best</span>
              </p>
              <h2 className="f1-h">Timing events</h2>
              <ul className="f1-rc">
                {history.length === 0 && <li className="f1-note">Pit stops, retirements, lead changes and session-best laps appear here as they happen. Nothing is back-filled.</li>}
                {history.slice(0, 40).map((h, i) => (
                  <li key={i}>
                    <small>{h.at}</small>
                    {h.text}
                  </li>
                ))}
              </ul>
              <h2 className="f1-h">Race control</h2>
              <input className="f1-search" placeholder="Filter messages" aria-label="Filter race control messages" value={rcFilter} onChange={(e) => setRcFilter(e.target.value)} />
              <ul className="f1-rc">
                {messages.length === 0 && <li className="f1-note">No race control messages.</li>}
                {messages.slice(0, 80).map((m, i) => (
                  <li key={i} className={m.flag ? `flag-${m.flag.toLowerCase().replace(/\s+/g, '-')}` : ''}>
                    <small>
                      {m.lap !== null ? `Lap ${m.lap}` : ''} {m.utc ? m.utc.slice(11, 19) : ''}
                    </small>
                    {m.message}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      )}
      {(!snap || snap.drivers.length === 0) && status && status.phase !== 'loading' && status.phase !== 'idle' && <p className="f1-note">No timing has arrived yet.</p>}
    </div>
  )
}

function Row({ d, traps, focused, onFocus }: { d: LiveDriverRow; traps: boolean; focused: boolean; onFocus: () => void }): React.JSX.Element {
  const c = d.tyre?.compound ? COMPOUND[d.tyre.compound] : null
  const trap = [d.speeds.st, d.speeds.fl, d.speeds.i1, d.speeds.i2].filter((x): x is number => x !== null)
  return (
    <tr className={`${d.retired ? 'is-out' : d.inPit ? 'is-pit' : ''}${focused ? ' is-on' : ''}`} onClick={onFocus} style={{ cursor: 'pointer' }} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onFocus()} aria-pressed={focused}>
      <td>{d.position ?? '–'}</td>
      <td>
        <span className="f1-swatch" style={{ background: d.colour ? `#${d.colour}` : 'transparent' }} aria-hidden="true" />
        {d.code} <small>#{d.number}</small>
      </td>
      <td className="num">{d.position === 1 ? 'Leader' : (d.gapToLeader ?? '–')}</td>
      <td className="num">{d.position === 1 ? '' : (d.interval ?? '–')}</td>
      <td className={`num ${sectorClass(d.lastLap.mark)}`}>{formatLapTime(d.lastLap.time)}</td>
      <td className="num">{formatLapTime(d.bestLap.time)}</td>
      {d.sectors.map((s, i) => (
        <td key={i} className={`num ${sectorClass(s.mark)}`}>
          {formatLapTime(s.time)}
        </td>
      ))}
      {traps && <td className="num">{trap.length ? Math.max(...trap) : '–'}</td>}
      <td>
        {d.tyre ? (
          <span title={d.tyre.compound ?? 'Compound not reported'}>
            <b style={{ color: c?.colour ?? 'var(--muted)' }}>{c?.short ?? '?'}</b> {d.tyre.laps ?? ''}
            {d.tyre.isNew === false ? ' used' : ''}
          </span>
        ) : (
          '–'
        )}
      </td>
      <td className="num">
        {d.retired ? 'OUT' : d.inPit ? 'PIT' : (d.pitStops ?? '–')}
      </td>
    </tr>
  )
}
