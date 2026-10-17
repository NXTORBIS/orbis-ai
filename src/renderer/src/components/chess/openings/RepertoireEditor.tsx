import { useMemo, useState } from 'react'
import { Button, EmptyState, Field } from '../../../ui'
import { identify } from '../../../../../shared/chess/openings'
import { bookProblems, summarise, type RepertoireLine } from '../../../../../shared/chess/repertoire'

/**
 * The lines you have decided to play.
 *
 * A line is written by playing it on the board and giving it a name -- there is no text box to type moves into,
 * because a typed line can contain a move that will not play and the board cannot (Sections 139, 140).
 *
 * Saved lines are real records in your own chess library: a game with `source.kind: 'study'` and a `repertoire` tag.
 * That is said on screen, because "is this actually saved?" is a fair question and the answer here is yes.
 */

export interface RepertoireEditorProps {
  side: 'w' | 'b'
  lines: RepertoireLine[]
  /** False until the store has answered once, so an empty list is not shown as an answer before it is one. */
  loaded: boolean
  /** The line currently on the board, which is what gets saved. */
  boardLine: string[]
  busy?: boolean
  onSave: (name: string) => void
  onRename: (line: RepertoireLine, name: string) => void
  onRemove: (line: RepertoireLine) => void
  onReplace: (line: RepertoireLine) => void
  onOpen: (line: RepertoireLine) => void
  onExport: () => void
  onImport: () => void
}

const sideWord = (side: 'w' | 'b'): string => (side === 'w' ? 'White' : 'Black')

export function RepertoireEditor({
  side, lines, loaded, boardLine, busy, onSave, onRename, onRemove, onReplace, onOpen, onExport, onImport
}: RepertoireEditorProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const mine = useMemo(() => lines.filter((one) => one.side === side), [lines, side])
  const summary = useMemo(() => summarise(lines, side), [lines, side])
  const problems = useMemo(() => bookProblems(lines, side).filter((one) => one.kind !== 'no-lines'), [lines, side])
  /** What the line on the board would be called, so a line can be named after the opening it actually is. */
  const boardNamed = useMemo(() => (boardLine.length ? identify({ moves: boardLine }) : null), [boardLine])

  return (
    <div className="cw-ol-pane">
      <section aria-label={`Save the line on the board to your ${sideWord(side)} repertoire`}>
        <h4 className="cw-ol-h">Add the line on the board</h4>
        {boardLine.length === 0
          ? <p className="cw-ol-faint">Play the line on the board first. Then it can be saved here.</p>
          : (
            <>
              <p className="cw-ol-faint">
                {boardLine.length} {boardLine.length === 1 ? 'move' : 'moves'}: {boardLine.join(' ')}
                {boardNamed?.known ? ` — ${boardNamed.eco} ${boardNamed.name}` : ' — the dataset has no name for where this ends'}
              </p>
              <form
                className="cw-ol-saverow"
                onSubmit={(event) => {
                  event.preventDefault()
                  const chosen = name.trim() || (boardNamed?.known ? boardNamed.name : '')
                  if (!chosen) return
                  onSave(chosen)
                  setName('')
                }}
              >
                <Field
                  label="What to call this line"
                  className="cw-ol-field"
                  labelClassName="cw-ol-label"
                  hintClassName="cw-ol-hint"
                  hint={boardNamed?.known ? `Left empty, it is saved as "${boardNamed.name}".` : 'A name is needed: the dataset has none for this line.'}
                >
                  {(wiring) => (
                    <input
                      {...wiring}
                      className="cw-ol-input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={boardNamed?.known ? boardNamed.name : 'My line'}
                      spellCheck={false}
                    />
                  )}
                </Field>
                <Button type="submit" size="small" kind="primary" disabled={busy || (!name.trim() && !boardNamed?.known)}>
                  Save to {sideWord(side)}
                </Button>
              </form>
            </>
          )}
      </section>

      <section aria-label={`Your ${sideWord(side)} lines`}>
        <h4 className="cw-ol-h">Your {sideWord(side)} lines</h4>
        {!loaded
          ? <p className="cw-ol-faint">Reading your saved lines…</p>
          : mine.length === 0
            ? (
              <EmptyState action={<Button size="small" disabled={busy} onClick={onImport}>Bring in a PGN file</Button>}>
                Nothing in your {sideWord(side)} repertoire yet. Play a line on the board and save it, or bring one in
                from a file.
              </EmptyState>
            )
            : (
              <ul className="cw-ol-lines">
                {mine.map((line) => (
                  <li key={line.id} className="cw-ol-lineitem">
                    <div className="cw-ol-linetop">
                      <button type="button" className="cw-ol-lineopen" onClick={() => onOpen(line)} disabled={busy}>
                        <strong>{line.name}</strong>
                        <small>
                          {line.eco ? <span className="cw-ol-eco">{line.eco}</span> : null}
                          {line.opening ? ` ${line.opening} · ` : line.eco ? ' · ' : ''}
                          {line.moves.length} {line.moves.length === 1 ? 'move' : 'moves'}
                        </small>
                      </button>
                    </div>
                    {line.note && <p className="cw-ol-faint">{line.note}</p>}
                    <div className="cw-ol-lineacts">
                      <Button size="tiny" kind="quiet" disabled={busy} onClick={() => { setRenaming(line.id); setNewName(line.name) }}>
                        Rename
                      </Button>
                      <Button
                        size="tiny"
                        kind="quiet"
                        disabled={busy || boardLine.length === 0}
                        title={boardLine.length === 0 ? 'Put a line on the board first.' : 'Make this line follow the board'}
                        onClick={() => onReplace(line)}
                      >
                        Replace with the board
                      </Button>
                      {confirming === line.id
                        ? (
                          <>
                            <Button size="tiny" kind="danger" disabled={busy} onClick={() => { onRemove(line); setConfirming(null) }}>
                              Really remove
                            </Button>
                            <Button size="tiny" kind="quiet" onClick={() => setConfirming(null)}>Keep it</Button>
                          </>
                        )
                        : <Button size="tiny" kind="quiet" disabled={busy} onClick={() => setConfirming(line.id)}>Remove</Button>}
                    </div>
                    {renaming === line.id && (
                      <form
                        className="cw-ol-saverow"
                        onSubmit={(event) => { event.preventDefault(); onRename(line, newName); setRenaming(null) }}
                      >
                        <Field label="A new name for this line" className="cw-ol-field" labelClassName="cw-ol-label">
                          {(wiring) => (
                            <input {...wiring} className="cw-ol-input" value={newName} onChange={(event) => setNewName(event.target.value)} spellCheck={false} />
                          )}
                        </Field>
                        <Button type="submit" size="tiny" disabled={busy || !newName.trim()}>Rename</Button>
                        <Button size="tiny" kind="quiet" onClick={() => setRenaming(null)}>Cancel</Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </section>

      {mine.length > 0 && (
        <section aria-label="What is in this repertoire">
          <h4 className="cw-ol-h">What is in it</h4>
          <p className="cw-ol-faint">
            {summary.lines} {summary.lines === 1 ? 'line' : 'lines'}, {summary.yourMoves} moves of your own across{' '}
            {summary.positions} positions.
            {summary.deepest && ` The longest is "${summary.deepest.name}" at ${summary.deepest.plies} moves.`}
            {summary.eco.length > 0
              ? ` It covers ${summary.eco.join(', ')}.`
              : ' The opening dataset names none of these lines.'}
          </p>
          {problems.length > 0 && (
            <ul className="cw-ol-problems">
              {problems.map((problem, index) => (
                <li key={`${problem.kind}-${index}`}>{problem.message}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-label="Repertoire files">
        <h4 className="cw-ol-h">Files</h4>
        <div className="cw-ol-row">
          <Button size="small" disabled={busy || mine.length === 0} onClick={onExport}>Save this repertoire as PGN</Button>
          <Button size="small" disabled={busy} onClick={onImport}>Bring in a PGN file</Button>
        </div>
        <p className="cw-ol-faint">
          A repertoire written here carries the colour it is for in its own tag, so bringing it back gives you the same
          lines. A file from somewhere else does not say which colour a line is for; those games come into your library
          as games, and are not filed under either repertoire on a guess.
        </p>
      </section>
    </div>
  )
}
