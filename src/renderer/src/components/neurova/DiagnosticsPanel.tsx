export interface DiagnosticItem {
  id: string
  severity: 'error' | 'warning' | 'info'
  summary: string
  evidence: string
  suggestion: string
  dismissed: boolean
}

export interface EvidenceItem {
  id: string
  label: string
  value: string
  kind: 'measured' | 'estimated' | 'judgement'
}

export interface DiagnosticsPanelProps {
  diagnostics: DiagnosticItem[]
  evidence: EvidenceItem[]
  onDismiss: (id: string) => void
  onUndismiss: (id: string) => void
}

const ICON = { error: '✖', warning: '⚠', info: 'ℹ' } as const
const WORD = { error: 'Error', warning: 'Warning', info: 'Note' } as const
const KINDS: { k: EvidenceItem['kind']; title: string }[] = [
  { k: 'measured', title: 'Measured' },
  { k: 'estimated', title: 'Estimated' },
  { k: 'judgement', title: 'Your judgement' }
]

export function DiagnosticsPanel({ diagnostics, evidence, onDismiss, onUndismiss }: DiagnosticsPanelProps): React.JSX.Element {
  const live = diagnostics.filter((d) => !d.dismissed)
  const gone = diagnostics.filter((d) => d.dismissed)
  const item = (d: DiagnosticItem): React.JSX.Element => (
    <li key={d.id} className={`nv-x-diag nv-x-${d.severity}${d.dismissed ? ' is-dismissed' : ''}`}>
      <p><span aria-hidden="true">{ICON[d.severity]}</span> <strong>{WORD[d.severity]}:</strong> {d.summary}</p>
      <p className="nv-x-note">Evidence: {d.evidence}</p>
      <p className="nv-x-note">Suggestion: {d.suggestion}</p>
      <button type="button" className="queue-btn ghost" onClick={() => (d.dismissed ? onUndismiss(d.id) : onDismiss(d.id))}>
        {d.dismissed ? 'Show again' : 'Dismiss'}
      </button>
    </li>
  )
  return (
    <section className="nv-diag" aria-label="Diagnostics">
      <h3>Diagnostics</h3>
      <div aria-live="polite">
        {live.length === 0 ? <p className="nv-x-note">Nothing to report.</p> : <ul className="nv-x-list">{live.map(item)}</ul>}
      </div>
      {gone.length > 0 ? <details><summary>Dismissed ({gone.length})</summary><ul className="nv-x-list">{gone.map(item)}</ul></details> : null}
      <h3>Evidence</h3>
      {KINDS.map(({ k, title }) => {
        const rows = evidence.filter((e) => e.kind === k)
        return (
          <div key={k}>
            <h4>{title}</h4>
            {rows.length === 0 ? <p className="nv-x-note">None.</p> : <ul>{rows.map((e) => <li key={e.id}>{e.label}: {e.value}</li>)}</ul>}
          </div>
        )
      })}
    </section>
  )
}
