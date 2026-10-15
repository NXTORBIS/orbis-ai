import { useState } from 'react'
import type { Evidence, Ranked } from '../../../../shared/neurova/candidates'

export interface CandidateCard {
  id: string
  name: string
  state: string
  durationSec: number | null
  engine: string
  changeSummary: string
  preference: 'strong' | 'prefer' | null
  rejected: boolean
  finalist: boolean
  note: string
}

export interface CandidateBoardProps {
  candidates: CandidateCard[]
  evidence: Evidence[]
  criteria: string[]
  ranking: Ranked[]
  selectedId?: string | null
  onPreference: (id: string, pref: 'strong' | 'prefer' | null) => void
  onReject: (id: string, rejected: boolean) => void
  onFinalist: (id: string, finalist: boolean) => void
  onNote: (id: string, note: string) => void
  onSelect: (id: string) => void
  onCompare?: (ids: string[]) => void
}

const fmt = (s: number | null): string => (s === null ? 'unknown length' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

export function CandidateBoard(p: CandidateBoardProps): React.JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string): void => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id]))
  const name = (id: string): string => p.candidates.find((c) => c.id === id)?.name ?? id
  return (
    <section className="nv-cands" aria-label="Candidates">
      <div className="nv-x-head">
        <h3>Candidates</h3>
        <button type="button" className="queue-btn" disabled={picked.length < 2 || !p.onCompare} onClick={() => p.onCompare?.(picked)}>
          Compare {picked.length > 0 ? `(${picked.length} of 3)` : ''}
        </button>
      </div>
      {p.candidates.length === 0 ? <p className="nv-x-note">No candidates yet.</p> : null}
      <ul className="nv-x-grid">
        {p.candidates.map((c) => {
          const mine = p.evidence.filter((e) => e.candidate === c.id)
          const checked = p.criteria.filter((k) => { const e = mine.find((x) => x.criterion === k); return e !== undefined && e.status !== 'unknown' }).length
          const total = p.criteria.length
          const pct = total ? Math.round((checked / total) * 100) : 0
          const isPicked = picked.includes(c.id)
          return (
            <li key={c.id} className={`nv-x-card${p.selectedId === c.id ? ' is-selected' : ''}${c.rejected ? ' is-rejected' : ''}`}>
              <div className="nv-x-card-head">
                <label className="nv-x-check">
                  <input type="checkbox" checked={isPicked} disabled={!isPicked && picked.length >= 3} onChange={() => toggle(c.id)} />
                  <span>Compare {c.name}</span>
                </label>
                <span className="nv-x-badge">{c.state}</span>
              </div>
              <p><strong>{c.name}</strong> · {fmt(c.durationSec)} · {c.engine}</p>
              <p className="nv-x-note">{c.changeSummary || 'No change summary recorded.'}</p>
              <div className="nv-x-meter" role="img" aria-label={total ? `Evidence available: ${checked} of ${total} checks` : 'Evidence available: not checked'}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="nv-x-note">Evidence available: {total ? `${checked} of ${total} (not a quality score)` : 'not checked'}</p>
              {total > 0 ? (
                <ul className="nv-x-ev">
                  {p.criteria.map((k) => {
                    const e = mine.find((x) => x.criterion === k)
                    const st = !e || e.status === 'unknown' ? 'not checked' : e.status
                    return <li key={k}>{k}: <em>{st}</em></li>
                  })}
                </ul>
              ) : null}
              <div className="nv-x-actions">
                <button type="button" className="queue-btn ghost" aria-pressed={c.preference === 'prefer'} onClick={() => p.onPreference(c.id, c.preference === 'prefer' ? null : 'prefer')}>Prefer</button>
                <button type="button" className="queue-btn ghost" aria-pressed={c.preference === 'strong'} onClick={() => p.onPreference(c.id, c.preference === 'strong' ? null : 'strong')}>Strongly prefer</button>
                <button type="button" className="queue-btn ghost" aria-pressed={c.rejected} onClick={() => p.onReject(c.id, !c.rejected)}>{c.rejected ? 'Undo reject' : 'Reject'}</button>
                <button type="button" className="queue-btn ghost" aria-pressed={c.finalist} onClick={() => p.onFinalist(c.id, !c.finalist)}>Finalist</button>
                <button type="button" className="queue-btn" onClick={() => p.onSelect(c.id)} disabled={p.selectedId === c.id}>{p.selectedId === c.id ? 'Selected' : 'Select'}</button>
              </div>
              <label className="nv-x-field"><span>Note</span>
                <input value={c.note} maxLength={500} onChange={(e) => p.onNote(c.id, e.target.value)} />
              </label>
            </li>
          )
        })}
      </ul>
      <h4>Ranking</h4>
      {p.ranking.length === 0 ? <p className="nv-x-note">Nothing to rank yet.</p> : (
        <ol className="nv-x-list">
          {p.ranking.map((r) => (
            <li key={r.id} className="nv-x-row">
              <strong>#{r.position} {name(r.id)}</strong>
              <ul>{r.reasons.length ? r.reasons.map((x, i) => <li key={i}>{x}</li>) : <li>No reasons recorded; nothing separates it from the rest.</li>}</ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
