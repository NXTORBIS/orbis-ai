import { useEffect, useState } from 'react'
import { Combine, Loader2, Sparkles, Wand2 } from 'lucide-react'

/**
 * Changing an opened table: by a sentence, by hand, or by joining it with another.
 *
 * All three end in the same place -- a list of steps the table engine runs -- and the screen shows what each step did
 * once it has. The by-hand form builds the steps itself, so nothing here needs Orion: it is the same door with no
 * model behind it.
 */

export interface ChangeColumn {
  id: string
  name: string
  type: string
  /** How the column is written in a formula. Worked out by the engine that reads the formula, not here. */
  formula: string
}

interface Props {
  artifactId: string
  title: string
  columns: ChangeColumn[]
  /** The other tables in the library, for a join. */
  others: { artifactId: string; title: string }[]
  /** Runs one request and reports whether it worked; the parent refreshes, opens the result and shows any failure. */
  run(request: Record<string, unknown>, said: (did: string[], title: string) => string): Promise<boolean>
}

const COMPARISONS: { id: string; label: string; needsValue: boolean }[] = [
  { id: 'equals', label: 'is', needsValue: true },
  { id: 'not-equals', label: 'is not', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'greater', label: 'is more than', needsValue: true },
  { id: 'greater-or-equal', label: 'is at least', needsValue: true },
  { id: 'less', label: 'is less than', needsValue: true },
  { id: 'less-or-equal', label: 'is at most', needsValue: true },
  { id: 'is-empty', label: 'is empty', needsValue: false },
  { id: 'is-not-empty', label: 'is not empty', needsValue: false }
]

const TOTALS: { id: string; label: string }[] = [
  { id: 'count', label: 'how many rows' },
  { id: 'sum', label: 'sum of' },
  { id: 'mean', label: 'mean of' },
  { id: 'median', label: 'median of' },
  { id: 'minimum', label: 'smallest' },
  { id: 'maximum', label: 'largest' }
]

const isNumeric = (type: string): boolean => type === 'number' || type === 'integer' || type === 'quantity'

export function CreateChange({ artifactId, title, columns, others, run }: Props): React.JSX.Element {
  const [request, setRequest] = useState('')
  const [asNew, setAsNew] = useState(false)
  const [busy, setBusy] = useState<'orion' | 'hand' | 'join' | null>(null)

  const [whereColumn, setWhereColumn] = useState('')
  const [whereIs, setWhereIs] = useState('equals')
  const [whereValue, setWhereValue] = useState('')
  const [newName, setNewName] = useState('')
  const [formula, setFormula] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [totalHow, setTotalHow] = useState('count')
  const [totalOf, setTotalOf] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [descending, setDescending] = useState(false)

  const [joinWith, setJoinWith] = useState('')
  const [joinOn, setJoinOn] = useState('')
  const [joinKind, setJoinKind] = useState('inner')

  // A different table is a different form: nothing typed for the last one applies to this one.
  useEffect(() => {
    setRequest('')
    setWhereColumn('')
    setWhereValue('')
    setNewName('')
    setFormula('')
    setGroupBy('')
    setTotalOf('')
    setSortBy('')
    setJoinWith('')
    setJoinOn(columns[0]?.name ?? '')
  }, [artifactId]) // eslint-disable-line react-hooks/exhaustive-deps

  const numeric = columns.filter((one) => isNumeric(one.type))
  const comparison = COMPARISONS.find((one) => one.id === whereIs) ?? COMPARISONS[0]

  /** The steps the by-hand form describes, in the order they make sense: narrow, add, total, order. */
  const handSteps = (): Record<string, unknown>[] => {
    const steps: Record<string, unknown>[] = []
    if (whereColumn !== '' && (!comparison.needsValue || whereValue.trim() !== '')) {
      const typed = whereValue.trim()
      const column = columns.find((one) => one.name === whereColumn)
      const value = column && isNumeric(column.type) && typed !== '' && Number.isFinite(Number(typed)) ? Number(typed) : typed
      steps.push({ op: 'filter', match: 'all', where: [{ column: whereColumn, is: whereIs, ...(comparison.needsValue ? { value } : {}) }] })
    }
    if (newName.trim() !== '' && formula.trim() !== '') steps.push({ op: 'compute', name: newName.trim(), formula: formula.trim() })
    if (groupBy !== '') steps.push({ op: 'group', by: [groupBy], totals: [{ column: totalHow === 'count' ? '' : totalOf, how: totalHow }] })
    // After a group only the grouping column and the total are left, so a sort on anything else would be refused.
    if (sortBy !== '' && (groupBy === '' || sortBy === groupBy)) steps.push({ op: 'sort', by: [{ column: sortBy, descending }] })
    return steps
  }
  const steps = handSteps()
  const groupNeedsColumn = groupBy !== '' && totalHow !== 'count' && totalOf === ''

  const said = (did: string[], made: string): string => (did.length ? `${made}: ${did.join(' ')}` : `Changed "${made}".`)

  const byOrion = async (): Promise<void> => {
    if (busy || request.trim() === '') return
    setBusy('orion')
    try {
      if (await run({ operation: 'artifact.transform', artifactId, request: request.trim(), ...(asNew ? { as: 'new' } : {}) }, said)) setRequest('')
    } finally {
      setBusy(null)
    }
  }

  const byHand = async (): Promise<void> => {
    if (busy || steps.length === 0 || groupNeedsColumn) return
    setBusy('hand')
    try {
      await run({ operation: 'artifact.transform', artifactId, steps, ...(asNew ? { as: 'new' } : {}) }, said)
    } finally {
      setBusy(null)
    }
  }

  const join = async (): Promise<void> => {
    if (busy || joinWith === '' || joinOn.trim() === '') return
    setBusy('join')
    try {
      await run({ operation: 'artifact.join', artifactId, withArtifactId: joinWith, on: joinOn.trim(), kind: joinKind }, (_did, made) => `Joined into "${made}". The notes say how many rows found a partner.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <details className="create-change">
      <summary>
        <Wand2 size={13} /> Change this table
      </summary>

      <form
        className="create-change-row"
        aria-label="Change this table by describing it"
        onSubmit={(event) => {
          event.preventDefault()
          void byOrion()
        }}
      >
        <input
          className="create-change-ask"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Say the change — e.g. only HQ, biggest first, add solar ÷ consumption"
          aria-label="The change, in words"
          maxLength={2000}
        />
        <button type="submit" className="queue-btn small" disabled={busy !== null || request.trim() === ''} title="Orion turns the sentence into steps. It is shown the column names, not the data; Orbis works out every number.">
          {busy === 'orion' ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          Change it with Orion
        </button>
      </form>

      <form
        className="create-change-hand"
        aria-label="Change this table by hand"
        onSubmit={(event) => {
          event.preventDefault()
          void byHand()
        }}
      >
        <div className="create-change-row">
          <span className="create-change-label">Only rows where</span>
          <select value={whereColumn} onChange={(event) => setWhereColumn(event.target.value)} aria-label="Column to filter on">
            <option value="">— every row —</option>
            {columns.map((one) => (
              <option key={one.id} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
          <select value={whereIs} onChange={(event) => setWhereIs(event.target.value)} aria-label="Comparison" disabled={whereColumn === ''}>
            {COMPARISONS.map((one) => (
              <option key={one.id} value={one.id}>
                {one.label}
              </option>
            ))}
          </select>
          {comparison.needsValue && <input value={whereValue} onChange={(event) => setWhereValue(event.target.value)} placeholder="value" aria-label="Value to compare with" disabled={whereColumn === ''} maxLength={200} />}
        </div>

        <div className="create-change-row">
          <span className="create-change-label">New column</span>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="its name" aria-label="New column name" maxLength={80} />
          <span>=</span>
          <input className="create-change-formula" value={formula} onChange={(event) => setFormula(event.target.value)} placeholder={numeric.length >= 2 ? `${numeric[0].formula} / ${numeric[1].formula}` : 'a formula'} aria-label="Formula" maxLength={400} />
        </div>
        {numeric.length > 0 && (
          <p className="create-change-hint">
            In a formula, write columns as: {numeric.map((one) => one.formula).join(', ')}. Use + − × as <code>+ - *</code>, ÷ as <code>/</code>, and brackets.
          </p>
        )}

        <div className="create-change-row">
          <span className="create-change-label">Group by</span>
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} aria-label="Column to group by">
            <option value="">— no grouping —</option>
            {columns.map((one) => (
              <option key={one.id} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
          <span>and show</span>
          <select value={totalHow} onChange={(event) => setTotalHow(event.target.value)} aria-label="What to total" disabled={groupBy === ''}>
            {TOTALS.map((one) => (
              <option key={one.id} value={one.id}>
                {one.label}
              </option>
            ))}
          </select>
          {totalHow !== 'count' && (
            <select value={totalOf} onChange={(event) => setTotalOf(event.target.value)} aria-label="Column to total" disabled={groupBy === ''}>
              <option value="">— which column —</option>
              {numeric.map((one) => (
                <option key={one.id} value={one.name}>
                  {one.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="create-change-row">
          <span className="create-change-label">Sort by</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Column to sort by">
            <option value="">— as it is —</option>
            {columns.map((one) => (
              <option key={one.id} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
          <select value={descending ? 'down' : 'up'} onChange={(event) => setDescending(event.target.value === 'down')} aria-label="Direction" disabled={sortBy === ''}>
            <option value="up">smallest / A first</option>
            <option value="down">largest / Z first</option>
          </select>
        </div>

        <div className="create-change-row">
          <label className="create-chip">
            <input type="checkbox" checked={asNew} onChange={(event) => setAsNew(event.target.checked)} />
            Keep the result as a separate table
          </label>
          <button type="submit" className="queue-btn small" disabled={busy !== null || steps.length === 0 || groupNeedsColumn} title={asNew ? `"${title}" stays as it is` : `"${title}" gets a new version; the one before is kept`}>
            {busy === 'hand' ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
            Apply {steps.length > 0 ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}
          </button>
        </div>
      </form>

      {others.length > 0 && (
        <form
          className="create-change-row"
          aria-label="Join this table with another"
          onSubmit={(event) => {
            event.preventDefault()
            void join()
          }}
        >
          <span className="create-change-label">Join with</span>
          <select value={joinWith} onChange={(event) => setJoinWith(event.target.value)} aria-label="The other table">
            <option value="">— another table —</option>
            {others.map((one) => (
              <option key={one.artifactId} value={one.artifactId}>
                {one.title}
              </option>
            ))}
          </select>
          <span>where both have the same</span>
          <select value={joinOn} onChange={(event) => setJoinOn(event.target.value)} aria-label="Column to match on">
            {columns.map((one) => (
              <option key={one.id} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
          <select value={joinKind} onChange={(event) => setJoinKind(event.target.value)} aria-label="Which rows to keep">
            <option value="inner">only matching rows</option>
            <option value="left">every row of this table</option>
            <option value="full">every row of both</option>
          </select>
          <button type="submit" className="queue-btn small" disabled={busy !== null || joinWith === ''} title="Makes a new table. The notes say how many rows on each side found a partner.">
            {busy === 'join' ? <Loader2 size={13} className="spin" /> : <Combine size={13} />}
            Join
          </button>
        </form>
      )}
    </details>
  )
}
