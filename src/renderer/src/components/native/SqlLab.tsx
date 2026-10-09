import { useCallback, useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import Parameters from './Parameters'
import { Diagram } from './Draw'
import './phase2.css'
import './phase4.css'

/**
 * The Database Laboratory.
 *
 * ## The queries run in a real database engine, in the main process
 *
 * Unlike every other laboratory here, this one has no worker — the database engine lives in Orbis's main process,
 * which is where SQLite already is. So a query crosses one IPC call and comes back with the rows, the timing and the
 * engine's own query plan. Nothing is parsed or interpreted on this side.
 *
 * ## The plan panel is the reason this exists
 *
 * Anyone can be told that an index makes a query faster. This shows the plan the database actually chose, and
 * changes it in front of you when an index is added — which is a thing no explanation can do.
 *
 * ## The query box is a text area, not a code editor
 *
 * Orbis ships no editor component and no SQL language server, and pretending otherwise with syntax colouring that
 * did not understand SQL would be worse than plain text. What it does have is the engine's own error message, which
 * is precise, and a pointer at the usual cause.
 */

interface Column {
  name: string
  declared: string
}

interface ResultTable {
  columns: readonly Column[]
  rows: readonly (readonly (string | number | boolean | null)[])[]
  of: number
  truncated: boolean
}

interface PlanStep {
  detail: string
  scanning: boolean
  usingIndex: boolean
}

interface QueryResult {
  sql: string
  table: ResultTable | null
  changed: number | null
  took: number
  plan: readonly PlanStep[]
  planSays: string
  problem: { error: string; says: string; fix: string } | null
  statements: number
}

interface TableFacts {
  name: string
  columns: readonly { name: string; type: string; notNull: boolean; primaryKey: boolean }[]
  rows: number
  indexes: readonly { name: string; columns: readonly string[]; unique: boolean }[]
  /** What this table points at, as the database declares it. Empty when it declares none. */
  references?: readonly { toTable: string; from: string; to: string }[]
}

interface Schema {
  tables: readonly TableFacts[]
  dataset: string
  about: string
}

interface DatasetChoice {
  id: string
  name: string
  about: string
  teaches: readonly string[]
}

const isProblem = (value: unknown): value is { error: string; says: string; fix: string } =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value

/** A few queries worth starting from, per dataset. Each one works against the tables that dataset creates. */
const SUGGESTIONS: Readonly<Record<string, readonly { says: string; sql: string }[]>> = {
  shop: [
    { says: 'Everyone, in order', sql: 'SELECT name, city, joined FROM customers ORDER BY name' },
    {
      says: 'How much each order came to',
      sql: `SELECT orders.id, customers.name,
       ROUND(SUM(products.price * order_lines.quantity), 2) AS total
FROM orders
JOIN customers ON customers.id = orders.customer_id
JOIN order_lines ON order_lines.order_id = orders.id
JOIN products ON products.id = order_lines.product_id
GROUP BY orders.id
ORDER BY total DESC`
    },
    {
      says: 'Who has never ordered anything',
      sql: `SELECT customers.name, customers.city
FROM customers
LEFT JOIN orders ON orders.customer_id = customers.id
WHERE orders.id IS NULL`
    },
    {
      says: 'Cities with more than one customer',
      sql: `SELECT city, COUNT(*) AS customers
FROM customers
GROUP BY city
HAVING COUNT(*) > 1
ORDER BY customers DESC`
    }
  ],
  library: [
    { says: 'Everything still out', sql: `SELECT books.title, borrowers.name, loans.due
FROM loans
JOIN books ON books.id = loans.book_id
JOIN borrowers ON borrowers.id = loans.borrower_id
WHERE loans.returned IS NULL
ORDER BY loans.due` },
    {
      says: 'Returned late',
      sql: `SELECT books.title, borrowers.name,
       julianday(loans.returned) - julianday(loans.due) AS days_late
FROM loans
JOIN books ON books.id = loans.book_id
JOIN borrowers ON borrowers.id = loans.borrower_id
WHERE loans.returned IS NOT NULL AND loans.returned > loans.due`
    },
    {
      says: 'Books nobody has borrowed',
      sql: `SELECT books.title FROM books
LEFT JOIN loans ON loans.book_id = books.id
WHERE loans.id IS NULL`
    }
  ],
  weather: [
    {
      says: 'The average per month, per station',
      sql: `SELECT station_id, substr(day, 1, 7) AS month,
       ROUND(AVG(temperature_c), 2) AS average_c,
       ROUND(SUM(rain_mm), 1) AS rain_mm
FROM readings
GROUP BY station_id, month
ORDER BY station_id, month`
    },
    {
      says: 'A seven-day rolling average',
      sql: `SELECT day, temperature_c,
       ROUND(AVG(temperature_c) OVER (
         PARTITION BY station_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
       ), 2) AS past_week
FROM readings
WHERE station_id = 'VAL'
ORDER BY day`
    },
    {
      says: 'The coldest day at each station',
      sql: `SELECT station_id, day, temperature_c FROM readings
WHERE (station_id, temperature_c) IN (
  SELECT station_id, MIN(temperature_c) FROM readings GROUP BY station_id
)`
    }
  ],
  empty: [
    {
      says: 'Make a table and put something in it',
      sql: `CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  born INTEGER
);
INSERT INTO people (name, born) VALUES ('Someone', 1990), ('Someone else', 2001);
SELECT * FROM people;`
    },
    {
      says: 'Watch a constraint refuse something',
      sql: `CREATE TABLE unique_names (name TEXT PRIMARY KEY);
INSERT INTO unique_names (name) VALUES ('once');
INSERT INTO unique_names (name) VALUES ('once');`
    }
  ]
}

export default function SqlLab({ instance, onConfigure, onNotify }: SurfaceProps): React.JSX.Element {
  const values = instance?.values ?? {}
  const dataset = String(values.dataset ?? 'shop')
  const showPlan = values.showPlan !== false

  const [typed, setTyped] = useState(String(values.query ?? 'SELECT name, city FROM customers ORDER BY name'))
  const [schema, setSchema] = useState<Schema | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [choices, setChoices] = useState<readonly DatasetChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  /*
   * Every answer carries the request number it belongs to, and a late one is dropped. A query can take a second and
   * somebody can change the dataset in that time, so without this the rows of the old database would be drawn under
   * the new one's schema.
   */
  const generation = useRef(0)
  const instanceId = instance?.id ?? ''

  const call = useCallback(
    async (operation: string, a?: unknown, b?: unknown): Promise<unknown> => {
      const api = (window as unknown as { api?: { native?(op: string, a?: unknown, b?: unknown): Promise<unknown> } }).api
      if (!api?.native) throw new Error('The database laboratory is not available in this window.')
      return api.native(operation, a, b)
    },
    []
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const got = (await call('sql-datasets')) as readonly DatasetChoice[]
        if (alive) setChoices(got)
      } catch {
        // The list is a nicety; the laboratory still works without it.
      }
    })()
    return () => {
      alive = false
    }
  }, [call])

  // Loading the practice database. Changing the dataset throws the old one away, tables and all.
  useEffect(() => {
    if (instanceId.length === 0) return
    generation.current += 1
    const mine = generation.current
    setBusy(true)
    setProblem(null)
    setResult(null)
    void (async () => {
      try {
        const got = await call('sql-load', instanceId, dataset)
        if (generation.current !== mine) return
        if (isProblem(got)) {
          setProblem(`${got.says} ${got.fix}`)
          setSchema(null)
        } else {
          setSchema(got as Schema)
        }
      } catch (error) {
        if (generation.current === mine) setProblem(error instanceof Error ? error.message : String(error))
      } finally {
        if (generation.current === mine) setBusy(false)
      }
    })()
  }, [call, instanceId, dataset])

  const runIt = useCallback(async () => {
    if (instanceId.length === 0 || typed.trim().length === 0) return
    generation.current += 1
    const mine = generation.current
    setBusy(true)
    setProblem(null)
    try {
      const got = (await call('sql-run', instanceId, typed)) as QueryResult | null
      if (generation.current !== mine) return
      setResult(got)
      // A statement that changed something may have changed the schema too, so it is read again rather than assumed.
      if (got && got.problem === null && got.changed !== null) {
        const next = await call('sql-schema', instanceId)
        if (generation.current === mine && !isProblem(next)) setSchema(next as Schema)
      }
    } catch (error) {
      if (generation.current === mine) setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      if (generation.current === mine) setBusy(false)
    }
  }, [call, instanceId, typed])

  const chosen = choices.find((one) => one.id === dataset) ?? null
  const suggestions = SUGGESTIONS[dataset] ?? []

  const copyResult = (): void => {
    if (!result?.table) return
    const header = result.table.columns.map((one) => one.name).join('\t')
    const body = result.table.rows.map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join('\t'))
    void navigator.clipboard
      .writeText([header, ...body].join('\n'))
      .then(() => onNotify('The rows are on the clipboard.', 'info'))
      .catch(() => onNotify('The rows could not be copied.', 'warn'))
  }

  return (
    <section className="p2 p4" aria-label="Database Laboratory">
      <header className="p2-bar">
        <strong>{schema?.dataset ?? 'Database'}</strong>
        {result !== null && result.problem === null && (
          <span className="p2-faint">
            {result.table !== null
              ? `${result.table.of.toLocaleString()} ${result.table.of === 1 ? 'row' : 'rows'}`
              : `${(result.changed ?? 0).toLocaleString()} ${result.changed === 1 ? 'row' : 'rows'} changed`}{' '}
            in {result.took.toFixed(1)}ms
            {result.statements > 1 ? ` · ${result.statements} statements` : ''}
          </span>
        )}
      </header>

      {schema?.about && (
        <p className="p4-says" role="note">
          {schema.about}
        </p>
      )}
      {problem !== null && (
        <p className="p2-refused" role="status">
          {problem}
        </p>
      )}

      <div className="p4-sql-split">
        <div className="p4-sql-main">
          <label className="p4-sql-label" htmlFor="sql-query">
            Query
          </label>
          <textarea
            id="sql-query"
            className="p4-sql-box"
            value={typed}
            spellCheck={false}
            rows={8}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl+Enter runs it, which is what every database tool does and what anybody will try first.
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                void runIt()
              }
            }}
          />
          <div className="p2-controls">
            <button type="button" className="p2-btn primary" onClick={() => void runIt()} disabled={busy}>
              Run
            </button>
            <span className="p2-faint">Ctrl+Enter also runs it.</span>
            {result?.table && result.table.rows.length > 0 && (
              <button type="button" className="p2-btn" onClick={copyResult}>
                Copy the rows
              </button>
            )}
          </div>

          {result?.problem && (
            <div className="p2-refused" role="status">
              <strong>{result.problem.says}</strong>
              <br />
              {result.problem.fix}
            </div>
          )}

          {result?.table && (
            <>
              <div className="p2-table-wrap p4-sql-rows">
                <table className="p2-table">
                  <thead>
                    <tr>
                      {result.table.columns.map((column) => (
                        <th key={column.name} scope="col">
                          {column.name}
                          {column.declared ? <small> {column.declared.toLowerCase()}</small> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.table.rows.map((row, index) => (
                      <tr key={index}>
                        {row.map((cell, column) => (
                          <td key={column} className={cell === null ? 'p4-null' : typeof cell === 'number' ? 'p4-num' : ''}>
                            {cell === null ? 'NULL' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.table.rows.length === 0 && (
                <p className="p2-faint">
                  No rows matched. The columns above are the ones the query asked for, so it ran — there is simply
                  nothing that fits.
                </p>
              )}
              {result.table.truncated && (
                <p className="p2-faint">
                  Showing the first {result.table.rows.length.toLocaleString()} of {result.table.of.toLocaleString()}{' '}
                  rows. Add a LIMIT to see a chosen part rather than the beginning.
                </p>
              )}
            </>
          )}

          {result !== null && result.problem === null && result.table === null && (
            <p className="p4-says">
              {(result.changed ?? 0).toLocaleString()} {result.changed === 1 ? 'row was' : 'rows were'} changed. The
              tables on the right have been read again.
            </p>
          )}

          {showPlan && result !== null && result.plan.length > 0 && (
            <div className="p3-panel">
              <h4>How the database did it</h4>
              <ol className="p4-plan">
                {result.plan.map((step, index) => (
                  <li key={index} className={step.scanning ? 'scanning' : step.usingIndex ? 'indexed' : ''}>
                    {step.detail}
                  </li>
                ))}
              </ol>
              <p className="p2-faint">{result.planSays}</p>
            </div>
          )}
        </div>

        <div className="p3-side">
          {/*
            * The shape of the database, drawn from what it declares.
            *
            * Every arrow here came from `PRAGMA foreign_key_list` -- the database's own answer -- so a join that is
            * drawn is a join that exists. Tables whose names merely look related are left unjoined, because guessing
            * a relationship from a column name would make the picture claim something the schema does not.
            */}
          {schema !== null && schema.tables.length > 1 && (
            <div className="p3-panel">
              <h4>How the tables relate</h4>
              <Diagram
                height={Math.max(160, schema.tables.length * 44)}
                nodes={schema.tables.map((table) => ({
                  id: table.name,
                  label: table.name,
                  note: `${table.rows.toLocaleString('en-GB')} rows`,
                  group: table.references !== undefined && table.references.length > 0 ? 0 : 3
                }))}
                edges={schema.tables.flatMap((table) =>
                  (table.references ?? [])
                    .filter((one) => schema.tables.some((two) => two.name === one.toTable))
                    .map((one) => ({ from: table.name, to: one.toTable, label: one.from }))
                )}
                about={
                  schema.tables.some((one) => (one.references ?? []).length > 0)
                    ? 'An arrow is a foreign key the database declares, labelled with the column that holds it.'
                    : 'This database declares no foreign keys, so nothing is joined here — the tables stand alone.'
                }
              />
            </div>
          )}

          <div className="p3-panel">
            <h4>Tables</h4>
            {schema === null && <p className="p2-faint">{busy ? 'Loading…' : 'Nothing loaded.'}</p>}
            {schema?.tables.length === 0 && (
              <p className="p2-faint">No tables yet. Write CREATE TABLE and run it.</p>
            )}
            {schema?.tables.map((table) => (
              <details key={table.name} className="p4-table-facts">
                <summary>
                  {table.name} <small>{table.rows.toLocaleString()} rows</small>
                </summary>
                <ul>
                  {table.columns.map((column) => (
                    <li key={column.name}>
                      <button
                        type="button"
                        className="p4-insert"
                        onClick={() => setTyped((held) => `${held}${/\s$/.test(held) ? '' : ' '}${column.name}`)}
                        title={`Add ${column.name} to the query`}
                      >
                        {column.name}
                      </button>
                      <small>
                        {column.type.toLowerCase()}
                        {column.primaryKey ? ' · key' : ''}
                        {column.notNull && !column.primaryKey ? ' · required' : ''}
                      </small>
                    </li>
                  ))}
                </ul>
                {table.indexes.length > 0 && (
                  <p className="p2-faint">
                    Indexed on {table.indexes.map((one) => one.columns.join(', ')).join('; ')}. An index is what lets
                    the database go straight to a row instead of reading the whole table.
                  </p>
                )}
                {table.indexes.length === 0 && (
                  <p className="p2-faint">No index. Every search of this table reads all of it.</p>
                )}
              </details>
            ))}
          </div>

          {suggestions.length > 0 && (
            <div className="p3-panel">
              <h4>Queries to start from</h4>
              <ul className="p4-suggestions">
                {suggestions.map((one) => (
                  <li key={one.says}>
                    <button type="button" className="p2-btn" onClick={() => setTyped(one.sql)}>
                      {one.says}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chosen !== null && chosen.teaches.length > 0 && (
            <div className="p3-panel">
              <h4>What this database is good for practising</h4>
              <ul className="p4-notes">
                {chosen.teaches.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="p3-panel">
            <h4>What this does not do</h4>
            <ul className="p3-assumptions">
              <li>The data is made up. It is shaped like real data so joins have something to join.</li>
              <li>
                The database is kept in memory only. Nothing is written to disk, nothing survives closing Orbis, and it
                cannot reach any of your own files.
              </li>
              <li>Statements that would open a file are refused, with the reason. Everything else works.</li>
              <li>A query is stopped after five seconds, and a result is cut off after 2,000 rows.</li>
            </ul>
          </div>
        </div>
      </div>

      {instance && onConfigure && (
        <details className="p2-settings">
          <summary>Settings</summary>
          <Parameters
            definitions={instance.definitions}
            shown={instance.shown}
            values={instance.values}
            onSet={onConfigure}
            busy={busy}
          />
        </details>
      )}
    </section>
  )
}
