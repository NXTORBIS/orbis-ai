import { useId } from 'react'
import { Button, Modal } from '../../../ui'
import type { StoredGame } from '../../../../../shared/chess/model'
import { deleteWarning } from '../../../../../shared/chess/library'
import './library.css'

/**
 * The question asked before games are removed.
 *
 * "Delete 47 games?" is not a question anybody can answer. A selection built out of a filter and then added to by
 * hand is very easy to be wrong about, so this names the games -- the first few of them -- and says the two things
 * that are easy to forget: that some of them are starred, and that the collections they are in will lose them.
 *
 * It is an `alertdialog` and the backdrop does not dismiss it, because closing this by accident must not be the same
 * as answering it.
 */
export interface DeleteSheetProps {
  games: StoredGame[]
  onConfirm: () => void
  onClose: () => void
  busy: boolean
}

export function DeleteSheet({ games, onConfirm, onClose, busy }: DeleteSheetProps): React.JSX.Element {
  const stakes = useId()
  const warning = deleteWarning(games)
  return (
    <Modal
      label="Remove games"
      title={warning.heading}
      onClose={onClose}
      asking
      outsideCloses={false}
      canClose={!busy}
      describedBy={stakes}
      small
    >
      <div className="cw-lb-sheet">
        <div id={stakes}>
          {warning.lines.map((line) => (
            <p key={line} className={line.includes('cannot be undone') ? undefined : 'cw-lb-sheet-faint'}>{line}</p>
          ))}
        </div>
        <ul className="cw-lb-sheet-list" aria-label="Games that will be removed">
          {warning.names.map((name, at) => (
            <li key={`${name}-${at}`}>{name}</li>
          ))}
          {games.length > warning.names.length && (
            <li className="cw-lb-sheet-faint">…and {games.length - warning.names.length} more.</li>
          )}
        </ul>
        <div className="cw-lb-sheet-actions">
          <Button size="small" kind="quiet" disabled={busy} onClick={onClose}>Keep them</Button>
          <Button size="small" kind="danger" busy={busy} busyLabel="Removing…" onClick={onConfirm}>
            {games.length === 1 ? 'Remove this game' : `Remove ${games.length} games`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
