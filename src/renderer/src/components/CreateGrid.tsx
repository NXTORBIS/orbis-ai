import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'

/**
 * A table on the Create screen, edited where it is shown.
 *
 * Click a cell and type; take a row out; add one at the end. Nothing is kept until "Save changes", and then all of it
 * is kept as ONE new version -- the version before is still there, and the history is not a line per keystroke.
 *
 * The screen decides nothing about what a value is. It sends the row's number, the column and the words typed; the
 * main process reads each value the way a pasted table is read and refuses, by name, the one that does not fit
 * ("old" in a column of numbers). The edit also says which version it was made against, so a table changed
 * somewhere else in the meantime is not edited in the wrong rows.
 */

export interface GridColumn {
  id: string
  name: string
  type: string
}

interface Props {
  artifactId: string
  versionId: string
  title: string
  columns: GridColumn[]
  grid: { rows: string[][]; total: number; from: number }
  /** How many rows one screenful is. */
  pageSize: number
  /** Shows the screenful that starts at this row (counted from 0). */
  onPage(from: number): void
  /** Runs one request and reports whether it worked; the parent refreshes, reopens and shows any failure. */
  run(request: Record<string, unknown>, said: (did: string[], title: string) => string): Promise<boolean>
}

const numeric = (type: string): boolean => type === 'number' || type === 'integer' || type === 'quantity'

export function CreateGrid({ artifactId, versionId, title, columns, grid, pageSize, onPage, run }: Props): React.JSX.Element {
  const shown = columns.slice(0, grid.rows[0]?.length ?? columns.length)
  /** New values, by "row number:column number". The row number is the row's place in the whole table, from 1. */
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<number[]>([])
  const [added, setAdded] = useState<string[][]>([])
  const [editing, setEditing] = useState<{ row: number; col: number; fresh: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // A different version or a different screenful is a different set of rows: what was pending belonged to the old one.
  useEffect(() => {
    setEdits({})
    setRemoved([])
    setAdded([])
    setEditing(null)
  }, [artifactId, versionId, grid.from])

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const changes = Object.keys(edits).length + removed.length + added.filter((row) => row.some((cell) => cell.trim() !== '')).length
  const valueAt = (row: number, col: number, fresh: boolean, original: string): string => (fresh ? (added[row]?.[col] ?? '') : (edits[`${row}:${col}`] ?? original))

  const begin = (row: number, col: number, fresh: boolean, current: string): void => {
    if (saving) return
    setEditing({ row, col, fresh })
    setDraft(current)
  }

  const commit = (): void => {
    if (!editing) return
    const { row, col, fresh } = editing
    if (fresh) {
      setAdded((rows) => rows.map((cells, at) => (at === row ? cells.map((cell, c) => (c === col ? draft : cell)) : cells)))
    } else {
      const original = grid.rows[row - grid.from - 1]?.[col] ?? ''
      setEdits((all) => {
        const next = { ...all }
        // Typed back to what it was: not a change.
        if (draft === original) delete next[`${row}:${col}`]
        else next[`${row}:${col}`] = draft
        return next
      })
    }
    setEditing(null)
  }

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(null)
      return
    }
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    if (!editing) return
    commit()
    // Enter goes down the column, Tab along the row, the way a spreadsheet does.
    const { row, col, fresh } = editing
    if (event.key === 'Tab') {
      const next = col + (event.shiftKey ? -1 : 1)
      if (next >= 0 && next < shown.length) {
        const original = fresh ? '' : (grid.rows[row - grid.from - 1]?.[next] ?? '')
        begin(row, next, fresh, valueAt(row, next, fresh, original))
      }
    } else if (!fresh) {
      const below = row + 1
      if (below - grid.from - 1 < grid.rows.length) begin(below, col, false, valueAt(below, col, false, grid.rows[below - grid.from - 1]?.[col] ?? ''))
    }
  }

  const save = async (): Promise<void> => {
    if (saving || changes === 0) return
    setSaving(true)
    try {
      const set = Object.entries(edits).map(([key, value]) => {
        const [row, col] = key.split(':').map(Number)
        return { row, column: shown[col].id, value }
      })
      const add = added
        .filter((row) => row.some((cell) => cell.trim() !== ''))
        .map((row) => Object.fromEntries(row.map((cell, at) => [shown[at].id, cell] as const).filter(([, cell]) => cell.trim() !== '')))
      // Cells in a row that is being taken out are not sent: the row is going.
      const kept = set.filter((one) => !removed.includes(one.row))
      await run({ operation: 'artifact.edit', artifactId, versionId, set: kept, remove: removed, add }, (did) => did.join(' ') || `Saved the changes to "${title}".`)
    } finally {
      setSaving(false)
    }
  }

  const discard = (): void => {
    setEdits({})
    setRemoved([])
    setAdded([])
    setEditing(null)
  }

  const cell = (row: number, col: number, fresh: boolean, original: string): React.JSX.Element => {
    const value = valueAt(row, col, fresh, original)
    const changed = fresh ? value !== '' : edits[`${row}:${col}`] !== undefined
    const active = editing && editing.row === row && editing.col === col && editing.fresh === fresh
    return (
      <td key={col} className={`${numeric(shown[col].type) ? 'num' : ''}${changed ? ' changed' : ''}`}>
        {active ? (
          <input
            ref={input}
            className="create-cell-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            aria-label={`${shown[col].name}, row ${fresh ? 'new' : row}`}
            maxLength={2000}
          />
        ) : (
          <button type="button" className="create-cell" onClick={() => begin(row, col, fresh, value)} title="Click to change" aria-label={`${shown[col].name}, row ${fresh ? 'new' : row}: ${value || 'empty'}. Change`}>
            {value === '' ? ' ' : value}
          </button>
        )}
      </td>
    )
  }

  const last = grid.from + grid.rows.length
  return (
    <div className="create-grid-wrap">
      <div className="create-grid editable" role="region" aria-label={`${title}, as a table you can edit`} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col" className="create-rownum" aria-label="Row" />
              {shown.map((one) => (
                <th key={one.id} scope="col" className={numeric(one.type) ? 'num' : ''} title={one.type}>
                  {one.name}
                </th>
              ))}
              <th scope="col" className="create-rowact" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, i) => {
              const number = grid.from + i + 1
              const gone = removed.includes(number)
              return (
                <tr key={number} className={gone ? 'gone' : ''}>
                  <td className="create-rownum">{number}</td>
                  {gone
                    ? row.map((value, j) => (
                        <td key={j} className={numeric(shown[j]?.type ?? '') ? 'num' : ''}>
                          {value}
                        </td>
                      ))
                    : row.map((value, j) => cell(number, j, false, value))}
                  <td className="create-rowact">
                    <button
                      type="button"
                      className="icon-btn small"
                      disabled={saving}
                      title={gone ? 'Keep this row after all' : 'Remove this row'}
                      aria-label={gone ? `Keep row ${number}` : `Remove row ${number}`}
                      onClick={() => setRemoved((all) => (gone ? all.filter((one) => one !== number) : [...all, number]))}
                    >
                      {gone ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              )
            })}
            {added.map((row, i) => (
              <tr key={`new-${i}`} className="fresh">
                <td className="create-rownum">new</td>
                {row.map((_value, j) => cell(i, j, true, ''))}
                <td className="create-rowact">
                  <button type="button" className="icon-btn small" disabled={saving} title="Take this new row away" aria-label="Take this new row away" onClick={() => setAdded((rows) => rows.filter((_, at) => at !== i))}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {grid.total === 0 && added.length === 0 && <p className="create-grid-more">No rows yet. Add one below.</p>}
      </div>

      <div className="create-grid-bar">
        <button type="button" className="queue-btn small" disabled={saving || added.length >= 200} onClick={() => setAdded((rows) => [...rows, shown.map(() => '')])} title="A new row at the end of the table">
          <Plus size={13} />
          Add a row
        </button>
        {grid.total > pageSize && (
          <span className="create-grid-pages">
            <button type="button" className="icon-btn small" disabled={grid.from === 0 || changes > 0 || saving} aria-label="Earlier rows" title={changes > 0 ? 'Save or discard the changes first' : 'Earlier rows'} onClick={() => onPage(Math.max(0, grid.from - pageSize))}>
              <ChevronLeft size={14} />
            </button>
            Rows {(grid.from + 1).toLocaleString()}–{last.toLocaleString()} of {grid.total.toLocaleString()}
            <button type="button" className="icon-btn small" disabled={last >= grid.total || changes > 0 || saving} aria-label="Later rows" title={changes > 0 ? 'Save or discard the changes first' : 'Later rows'} onClick={() => onPage(grid.from + pageSize)}>
              <ChevronRight size={14} />
            </button>
          </span>
        )}
        {changes > 0 ? (
          <span className="create-grid-pending" role="status">
            {changes} change{changes === 1 ? '' : 's'} not saved yet
            <button type="button" className="queue-btn small primary" disabled={saving} onClick={() => void save()} title="Keeps every change as one new version. The version before stays.">
              {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="queue-btn small" disabled={saving} onClick={discard}>
              Discard
            </button>
          </span>
        ) : (
          <span className="create-grid-hint">Click a cell to change it. Every row is in the saved file.</span>
        )}
      </div>
    </div>
  )
}
