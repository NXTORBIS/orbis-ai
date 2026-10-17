import { useState } from 'react'
import { Button, Modal } from '../../../ui'
import type { ChessImportSummary } from '../../../../../shared/types'
import './library.css'

/**
 * Bringing games in, and saying what happened to every one of them.
 *
 * The summary is the point of this sheet. An import that quietly reports "12 games imported" out of a file of
 * fifteen has told a person nothing about the three that are missing, and they will not find out until they go
 * looking for a game that is not there. So all four numbers are shown, including the zeroes, and every failure is
 * listed with the reason the reader gave for it -- which is always one of two kinds of problem, a file that is not
 * shaped like a game or a move that cannot be played, and the difference matters when you go to fix it.
 *
 * Nothing in here invents a reason. What is shown is what `readPgn` said.
 */
export interface ImportSheetProps {
  /** Opens the file picker in the main process and comes back with what happened, or null if nobody chose a file. */
  onPickFile: () => Promise<ChessImportSummary | null>
  /** Reads text somebody pasted. */
  onPasteText: (text: string) => Promise<ChessImportSummary>
  onClose: () => void
}

export function ImportSheet({ onPickFile, onPasteText, onClose }: ImportSheetProps): React.JSX.Element {
  const [summary, setSummary] = useState<ChessImportSummary | null>(null)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)

  const run = async (work: () => Promise<ChessImportSummary | null>): Promise<void> => {
    setBusy(true)
    setFailure(null)
    setCancelled(false)
    try {
      const answer = await work()
      // null means the file picker was closed without choosing anything, which is not a failure.
      if (answer === null) setCancelled(true)
      else setSummary(answer)
    } catch (err) {
      setFailure(err instanceof Error ? plainError(err.message) : 'That could not be brought in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label="Bring in games" title="Bring in games" onClose={onClose} canClose={!busy} outsideCloses={!busy}>
      <div className="cw-lb-sheet">
        {summary === null ? (
          <>
            <p className="cw-lb-sheet-faint">
              A PGN file can hold one game or thousands. Every game in it is reported back: the ones that came in, the
              ones already here, and the ones that could not be read, with the reason for each.
            </p>
            <div className="cw-lb-sheet-actions">
              <Button size="small" kind="primary" busy={busy} busyLabel="Reading…" onClick={() => void run(onPickFile)}>
                Choose a PGN file
              </Button>
            </div>
            <div className="cw-lb-field">
              <label htmlFor="cw-lb-pasted">Or paste the text of a game</label>
              <textarea
                id="cw-lb-pasted"
                className="cw-lb-paste"
                value={pasted}
                aria-label="Paste the text of a game"
                spellCheck={false}
                onChange={(event) => setPasted(event.target.value)}
              />
            </div>
            <div className="cw-lb-sheet-actions">
              <Button size="small" busy={busy} busyLabel="Reading…" disabled={pasted.trim() === ''} onClick={() => void run(() => onPasteText(pasted))}>
                Bring in what is pasted
              </Button>
            </div>
            {cancelled && <p className="cw-lb-sheet-faint" role="status">No file was chosen, so nothing was brought in.</p>}
            {failure !== null && <p className="cw-lb-bad" role="alert">{failure}</p>}
          </>
        ) : (
          <>
            <div className="cw-lb-tally">
              <div className="cw-lb-tally-one">
                <span className="cw-lb-tally-n">{summary.imported}</span>
                <span className="cw-lb-tally-what">brought in</span>
              </div>
              <div className="cw-lb-tally-one">
                <span className="cw-lb-tally-n">{summary.skippedDuplicates}</span>
                <span className="cw-lb-tally-what">already here</span>
              </div>
              <div className="cw-lb-tally-one">
                <span className={`cw-lb-tally-n${summary.failed.length ? ' cw-lb-bad' : ''}`}>{summary.failed.length}</span>
                <span className="cw-lb-tally-what">could not be read</span>
              </div>
            </div>

            {summary.failed.length > 0 && (
              <>
                <p>Why each one could not be read</p>
                <ul className="cw-lb-sheet-list" aria-label="Games that could not be read">
                  {summary.failed.map((one) => (
                    <li key={one.index} className="cw-lb-sheet-row">
                      <span className="cw-lb-sheet-faint">
                        {/* The file's own numbering, counting from one, so it can be found in the file. */}
                        Game {one.index + 1}
                        {one.white || one.black ? `, ${one.white ?? 'an unnamed player'} vs ${one.black ?? 'an unnamed player'}` : ''}:
                      </span>
                      <span>{one.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {summary.warnings.length > 0 && (
              <>
                <p>Things worth knowing about the file</p>
                <ul className="cw-lb-sheet-list" aria-label="Notes about the file">
                  {summary.warnings.slice(0, 40).map((warning, at) => (
                    <li key={`${at}-${warning.slice(0, 20)}`} className="cw-lb-sheet-faint">{warning}</li>
                  ))}
                  {summary.warnings.length > 40 && (
                    <li className="cw-lb-sheet-faint">…and {summary.warnings.length - 40} more.</li>
                  )}
                </ul>
              </>
            )}

            {summary.imported === 0 && summary.skippedDuplicates === 0 && summary.failed.length === 0 && (
              <p>No games were found in that, so nothing changed.</p>
            )}

            <div className="cw-lb-sheet-actions">
              <Button size="small" onClick={() => { setSummary(null); setPasted('') }}>Bring in something else</Button>
              <Button size="small" kind="primary" onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** The main process wraps a thrown message; the wrapper is not something to show a person. */
const plainError = (message: string): string =>
  message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
