import { useCallback, useEffect, useState } from 'react'
import type { StreamStatus } from '../../../../shared/f1/live/stream-types'
import { PROVIDER_NAME } from './shared'

interface ProviderRow {
  provider: 'jolpica' | 'openf1' | 'f1archive'
  base: string
  requests: number
  failures: number
  lastOkAt: string | null
  lastError: string | null
  rateLimitedUntil: string | null
  cached: number
}

const NOTES: Record<ProviderRow['provider'], string> = {
  jolpica: 'Calendar, results, standings and championship history. Free; no account or key. An Ergast-compatible service.',
  openf1: 'Sessions, drivers, laps with sector times, car telemetry, positions, tyre stints, pit stops, weather, race control. Free and keyless for finished sessions from 2023; its live feed is a paid plan and is not used.',
  f1archive: 'The recorded feeds of past sessions, used for replay. The same files the official live-timing stream is built from; unofficial and keyless.'
}

export default function SourcesPanel(): React.JSX.Element {
  const [rows, setRows] = useState<ProviderRow[] | null>(null)
  const [stream, setStream] = useState<StreamStatus | null>(null)
  const refresh = useCallback(() => {
    void window.api.f1Status().then((r) => setRows((r as { providers: ProviderRow[] }).providers))
    void window.api.f1StreamState().then((e) => setStream((e as { status: StreamStatus }).status))
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <>
      <p className="f1-note">
        Where each number comes from, and what has happened in this run. Nothing here is simulated: when a provider cannot be reached the page says so and, if it has one,
        shows its last answer marked as old.
      </p>
      <table className="f1-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th className="num">Requests</th>
            <th className="num">Failed</th>
            <th>Last success</th>
            <th>Last problem</th>
            <th className="num">Cached</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.provider}>
              <td>
                <strong>{PROVIDER_NAME[r.provider]}</strong>
                <small>{NOTES[r.provider]}</small>
                <small>{r.base}</small>
              </td>
              <td className="num">{r.requests}</td>
              <td className="num">{r.failures}</td>
              <td>{r.lastOkAt ? new Date(r.lastOkAt).toLocaleTimeString() : 'none yet'}</td>
              <td>{r.rateLimitedUntil ? `Asked to slow down until ${new Date(r.rateLimitedUntil).toLocaleTimeString()}` : (r.lastError ?? 'none')}</td>
              <td className="num">{r.cached}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="f1-h">Live timing service</h2>
      <table className="f1-table">
        <tbody>
          <tr>
            <td>State</td>
            <td>{stream ? `${stream.phase} (${stream.connection})` : '–'}</td>
          </tr>
          <tr>
            <td>What it means</td>
            <td>{stream?.message ?? '–'}</td>
          </tr>
          <tr>
            <td>Session status reported</td>
            <td>{stream?.sessionStatus ?? '–'}</td>
          </tr>
          <tr>
            <td>Records received</td>
            <td>{stream?.records ?? 0}</td>
          </tr>
          <tr>
            <td>Reconnections</td>
            <td>{stream?.reconnects ?? 0}</td>
          </tr>
          <tr>
            <td>Last record</td>
            <td>{stream?.lastRecordAt ? new Date(stream.lastRecordAt).toLocaleTimeString() : 'none'}</td>
          </tr>
          <tr>
            <td>Last problem</td>
            <td>{stream?.lastError ?? 'none'}</td>
          </tr>
        </tbody>
      </table>
      <p className="f1-note">
        Live timing uses Formula 1&apos;s public live-timing stream, the same one the sport&apos;s own pages and the FastF1 project read. It is unofficial: it can change or
        disappear without notice, and no key is needed. It only carries updates while a session is running; between sessions it shows the last session&apos;s final state, and
        the screen says so. Orbis stores none of it.
      </p>
    </>
  )
}
