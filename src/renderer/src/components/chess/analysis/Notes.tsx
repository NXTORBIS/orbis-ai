import { useEffect, useState } from 'react'
import { Button } from '../../../ui'
import type { Annotation } from '../../../../../shared/chess/analysis'

/**
 * Writing something down about the position in front of you.
 *
 * The note belongs to the position, not to a place in a list, so promoting a line or taking one out never moves
 * somebody's words onto a different move. What the imported file said is shown beside your note and is never
 * overwritten by it: those are two different claims about the same move and merging them would lose which was which
 * (Sections 118, 119).
 */

const NAGS = ['!', '?', '!!', '??', '!?', '?!']

export interface NotesProps {
  /** Which position the note is about, said in words for the heading. */
  about: string
  annotation: Annotation | null
  /** The comment the PGN carried, when it carried one. */
  sourceComment: string | null
  /** The node the note belongs to. The box reloads from it, so moving the board never carries a draft across. */
  nodeId: string
  onSave: (patch: { text?: string; nags?: string[] }) => void
  onClear: () => void
}

export function Notes({ about, annotation, sourceComment, nodeId, onSave, onClear }: NotesProps): React.JSX.Element {
  const [draft, setDraft] = useState(annotation?.text ?? '')
  // Moving the board moves the note: the box always shows the note for the position in front of you.
  useEffect(() => { setDraft(annotation?.text ?? '') }, [nodeId, annotation?.text])
  const nags = annotation?.nags ?? []
  const dirty = draft.trim() !== (annotation?.text ?? '')

  return (
    <section className="cw-an-notes" aria-label="Your note">
      <h4 className="cw-an-h">Your note on {about}</h4>
      <div className="cw-an-nags" role="group" aria-label="Mark the move">
        {NAGS.map((nag) => {
          const on = nags.includes(nag)
          return (
            <button
              key={nag}
              type="button"
              className={`cw-an-nag-btn${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onSave({ nags: on ? nags.filter((n) => n !== nag) : [...nags, nag] })}
            >
              {nag}
            </button>
          )
        })}
      </div>
      <textarea
        className="cw-an-text"
        value={draft}
        rows={4}
        placeholder="What is going on here?"
        aria-label={`Your note on ${about}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (dirty) onSave({ text: draft }) }}
      />
      <div className="cw-an-row">
        <Button size="tiny" kind="primary" disabled={!dirty} onClick={() => onSave({ text: draft })}>Save the note</Button>
        <Button size="tiny" disabled={!annotation} onClick={onClear}>Clear it</Button>
        {annotation && <span className="cw-an-faint">Saved.</span>}
      </div>
      {sourceComment && (
        <p className="cw-an-source">
          <span className="cw-an-source-tag">From the file</span> {sourceComment}
        </p>
      )}
    </section>
  )
}
