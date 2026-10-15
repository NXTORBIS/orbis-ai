import type { LyricDocument, LyricNotice } from '../../../../shared/neurova/lyrics'
import { syllables } from '../../../../shared/neurova/lyrics'

export interface LyricsPanelProps {
  doc: LyricDocument
  notices: LyricNotice[]
  /** Whether the working text differs from the original. */
  changed?: boolean
  onRestoreOriginal: () => void
}

export function LyricsPanel({ doc, notices, changed = true, onRestoreOriginal }: LyricsPanelProps): React.JSX.Element {
  return (
    <section className="nv-lyrics" aria-label="Lyrics structure">
      <div className="nv-x-head">
        <h3>Lyrics</h3>
        <button type="button" className="queue-btn ghost" onClick={onRestoreOriginal} disabled={!changed}>Restore original</button>
      </div>
      <p className="nv-x-note">Your words are never rewritten. This only reads them. Syllable counts are approximate.</p>
      {!doc.labelled ? <p className="nv-x-note">No section markers found, so the text is treated as one block.</p> : null}
      <ul className="nv-x-list">
        {doc.sections.map((s) => {
          const lines = s.lines.filter((l) => l.trim() !== '')
          const syl = lines.reduce((n, l) => n + syllables(l).count, 0)
          return (
            <li key={s.id} className="nv-x-row">
              <strong>{s.label}</strong> <span className="nv-x-badge">{s.type}</span>
              <p className="nv-x-note">{lines.length} line{lines.length === 1 ? '' : 's'}, about {syl} syllables (approximate)</p>
            </li>
          )
        })}
      </ul>
      {doc.warnings.length + notices.length > 0 ? (
        <div className="nv-x-findings" aria-live="polite">
          <h4>Notices</h4>
          <ul>
            {doc.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
            {notices.map((n, i) => <li key={i}>{n.section}{n.line !== undefined ? `, line ${n.line + 1}` : ''}: {n.message}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
