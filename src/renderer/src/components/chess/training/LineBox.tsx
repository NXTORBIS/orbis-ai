import { useCallback, useMemo, useState } from 'react'
import { Button } from '../../../ui'
import { Mic } from './Mic'
import { splitLine, type LineEntry, type ReadResult } from '../../../../../shared/chess/calculation'
import { hearMove } from '../../../../../shared/chess/spoken'
import { lineRows, lineText } from '../../../../../shared/chess/trainingView'

/**
 * Writing a line out, move by move (Sections 213 and 216).
 *
 * The box both trainers use, because writing a line is the same job in both: the Gym's whole exercise, and the top
 * rung of the blindfold ladder.
 *
 * ## It decides nothing
 *
 * Not which position the next move is read against, not whether a move can be played, not what the line is. All
 * three are handed in. That is not tidiness: **which position the next move belongs to depends on who is writing
 * the other side's moves**, and getting it wrong is invisible until the second move. A box that read every move
 * against the draft's own last position would refuse White's second move whenever Orbis was supplying Black's,
 * because that position has Black to move. `appendSolverMove` and `nextFen` in `trainingView.ts` answer it, and
 * they are tested; this file calls `onAdd` and draws what comes back.
 *
 * ## A notation mistake is not a chess mistake
 *
 * `readMove` answers with the kind of fault as well as the words -- `notation` for "that is not how you write it"
 * and `chess` for "that cannot be played here" -- and the two are shown differently and never merged. Somebody who
 * found the right idea and wrote it badly has not made a chess mistake, and telling them they have is how a trainer
 * teaches the wrong lesson.
 */

export interface LineBoxProps {
  /** The line as it will be compared, already walked through the rules. */
  entry: LineEntry
  /** The position the next move will be read against, for the microphone. */
  nextFen: string
  /** How many moves the person has written, for the undo and restart buttons. */
  written: number
  /**
   * Moves to add, in order. Null back when every one was added; otherwise the first refusal, which carries whether
   * it was the writing or the chess. Several at once because a whole line can be pasted in, and only the caller
   * holds the draft each move has to be read against.
   */
  onAdd: (texts: readonly string[]) => ReadResult | null
  onUndo: () => void
  onRestart: () => void
  /** The sentence above the box, saying whose moves to write. */
  label: string
  /** A unique id for the microphone, when one may be offered. Absent means no microphone. */
  micId?: string
}

export function LineBox({
  entry, nextFen, written, onAdd, onUndo, onRestart, label, micId
}: LineBoxProps): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<{ kind: 'notation' | 'chess'; says: string; suggest: readonly string[] } | null>(null)

  const laid = useMemo(() => lineRows(entry), [entry])

  const add = useCallback((text: string): void => {
    const value = (text ?? '').trim()
    if (!value) return
    // Split the way lines are written, so a pasted line arrives as moves and a single "1.Kb6" arrives as "Kb6".
    // Always, not only when there is a space in it: somebody typing one move with its number in front is the
    // commonest way this went wrong.
    const pieces = splitLine(value)
    if (pieces.length === 0) return
    const refused = onAdd(pieces)
    if (refused !== null && !refused.ok) {
      setProblem({ kind: refused.fault, says: refused.says, suggest: refused.suggest ?? [] })
      return
    }
    setTyped('')
    setProblem(null)
  }, [onAdd])

  const undo = useCallback((): void => {
    onUndo()
    setProblem(null)
  }, [onUndo])

  const restart = useCallback((): void => {
    onRestart()
    setTyped('')
    setProblem(null)
  }, [onRestart])

  return (
    <div className="cw-tr-line">
      <p className="cw-tr-line-label">{label}</p>

      {laid.rows.length === 0
        ? <p className="cw-tr-line-none">Nothing written yet.</p>
        : (
          <ol className="cw-tr-rows" aria-label="The line as you have written it">
            {laid.rows.map((row) => (
              <li key={`${row.number}-${row.white?.ply ?? 'b'}${row.black?.ply ?? ''}`} className="cw-tr-row">
                <span className="cw-tr-num">{row.number}.{row.white === null ? '..' : ''}</span>
                <span className="cw-tr-cell">{row.white?.san ?? ''}</span>
                <span className="cw-tr-cell">{row.black?.san ?? ''}</span>
              </li>
            ))}
          </ol>
        )}

      {/* How a move is properly written, where what was typed was not it. Not a mistake, so it is not shown as one. */}
      {entry.tidied.length > 0 && (
        <p className="cw-tr-tidied">
          {entry.tidied.map((one) => `"${one.wrote}" is written ${one.properly}`).join('; ')}.
        </p>
      )}

      <div className="cw-tr-enter">
        <label className="cw-tr-enter-field">
          <span className="cw-tr-enter-name">The next move</span>
          <input
            className="cw-tr-enter-box"
            value={typed}
            placeholder="Nf3, exd5, O-O"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              add(typed)
            }}
          />
        </label>
        <Button size="small" kind="primary" disabled={typed.trim() === ''} onClick={() => add(typed)}>Add it</Button>
        <Button size="small" disabled={written === 0} onClick={undo}>Take the last one off</Button>
        <Button size="small" kind="quiet" disabled={written === 0} onClick={restart}>Start the line again</Button>
      </div>

      {micId !== undefined && (
        <Mic
          inputId={micId}
          label="Speak the next move"
          hear={(spoken) => hearMove(nextFen, spoken)}
          onHeard={(text) => add(text)}
        />
      )}

      {problem !== null && (
        <div className={`cw-tr-fault cw-tr-fault-${problem.kind}`} role="status">
          <p className="cw-tr-fault-kind">
            {problem.kind === 'notation' ? 'That is a writing mistake, not a chess one.' : 'That cannot be played here.'}
          </p>
          <p className="cw-tr-fault-says">{problem.says}</p>
          {problem.suggest.length > 0 && (
            <div className="cw-tr-fault-try" role="group" aria-label="Did you mean">
              {problem.suggest.slice(0, 6).map((one) => (
                <Button key={one} size="tiny" onClick={() => add(one)}>{one}</Button>
              ))}
            </div>
          )}
        </div>
      )}

      {entry.moves.length > 0 && <p className="cw-tr-line-text">{lineText(entry)}</p>}
    </div>
  )
}

export default LineBox
