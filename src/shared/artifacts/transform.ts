import {
  addColumn,
  asNumber,
  columnIndex,
  dropColumn,
  filterTable,
  groupBy,
  groupsToTable,
  invalid,
  isDataError,
  isInvalid,
  MISSING,
  readCell,
  renameColumn,
  selectColumns,
  sortTable,
  type Aggregate,
  type Cell,
  type Column,
  type Comparison,
  type Condition,
  type Table
} from '../compute/data.ts'
import { evaluateExpression, FUNCTIONS, isEvaluateError, isParseError, parseExpression, variablesOf } from '../compute/expression.ts'

/**
 * Changing a table: a short list of steps, each one a thing the table engine already does.
 *
 * This file adds no arithmetic and no second way to sort or filter. Sorting is `sortTable`, filtering is
 * `filterTable`, a computed column is the expression engine evaluated once per row, grouping is `groupBy`. What it
 * adds is the list: steps a person or a model can write down by column NAME, read through a deny-by-default
 * validator, applied in order, with a plain sentence about what each one did -- how many rows were kept, how many
 * could not be computed and why. The sentences are the point. A table that came back shorter with no word about it
 * is how a filter that matched nothing becomes a report with no data in it.
 *
 * Columns are named, not numbered, and resolved when the step runs rather than when the list is read, because an
 * earlier step may have made or renamed the column a later one uses.
 */

export const TRANSFORM_LIMITS = Object.freeze({ steps: 12, keys: 6, conditions: 12, columns: 64, totals: 12, name: 80, formula: 400, value: 200, cell: 2000, newRows: 200 })

const COMPARISONS: readonly Comparison[] = Object.freeze([
  'equals',
  'not-equals',
  'contains',
  'starts-with',
  'ends-with',
  'greater',
  'greater-or-equal',
  'less',
  'less-or-equal',
  'between',
  'is-empty',
  'is-not-empty',
  'is-invalid',
  'is-one-of'
])

const AGGREGATES: readonly Aggregate[] = Object.freeze(['count', 'count-values', 'count-distinct', 'sum', 'mean', 'median', 'minimum', 'maximum', 'standard-deviation', 'first', 'last'])

export interface WhereClause {
  column: string
  is: Comparison
  value?: string | number | boolean
  value2?: string | number
  values?: (string | number)[]
}

export type TransformStep =
  | { op: 'sort'; by: { column: string; descending: boolean }[] }
  | { op: 'filter'; match: 'all' | 'any'; where: WhereClause[] }
  | { op: 'keep'; columns: string[] }
  | { op: 'drop'; columns: string[] }
  | { op: 'rename'; column: string; to: string }
  | { op: 'compute'; name: string; formula: string }
  | { op: 'group'; by: string[]; totals: { column: string; how: Aggregate; as: string }[] }
  | { op: 'limit'; rows: number }
  /** One column given a new value, in every row the conditions match -- or in one row, by its number as shown. */
  | { op: 'set'; column: string; value: string; match: 'all' | 'any'; where: WhereClause[]; row?: number }
  /** New rows at the end. Each is its values by column name; a column not named is left empty. */
  | { op: 'add'; rows: Record<string, string>[] }
  /** Rows taken out: the ones the conditions match, or one by its number as shown. */
  | { op: 'remove'; match: 'all' | 'any'; where: WhereClause[]; row?: number }

export const TRANSFORM_OPS = Object.freeze(['sort', 'filter', 'keep', 'drop', 'rename', 'compute', 'group', 'limit', 'set', 'add', 'remove'] as const)

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '')
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
const scalar = (value: unknown): string | number | boolean | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'boolean' ? value : typeof value === 'string' ? value.slice(0, TRANSFORM_LIMITS.value) : undefined

/**
 * A list of steps read from untrusted JSON.
 *
 * Everything not recognised is a named problem, not something skipped: a step dropped in silence gives back a table
 * that was not changed the way that was asked, with nothing to say so.
 */
export function readSteps(raw: unknown): { steps: TransformStep[]; problems: string[] } {
  const problems: string[] = []
  const steps: TransformStep[] = []
  const given = Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null && Array.isArray((raw as { steps?: unknown }).steps) ? (raw as { steps: unknown[] }).steps : null
  if (given === null) return { steps, problems: ['"steps" has to be a list of steps.'] }
  if (given.length === 0) return { steps, problems: ['There are no steps: nothing would change.'] }
  if (given.length > TRANSFORM_LIMITS.steps) problems.push(`At most ${TRANSFORM_LIMITS.steps} steps at once; there are ${given.length}.`)

  given.slice(0, TRANSFORM_LIMITS.steps).forEach((one, i) => {
    const at = `steps[${i}]`
    if (typeof one !== 'object' || one === null || Array.isArray(one)) {
      problems.push(`${at} is not a step.`)
      return
    }
    const step = one as Record<string, unknown>
    const op = text(step.op, 20).toLowerCase()
    switch (op) {
      case 'sort': {
        const by = list(step.by)
          .slice(0, TRANSFORM_LIMITS.keys)
          .map((key) => (typeof key === 'string' ? { column: key.trim(), descending: false } : typeof key === 'object' && key !== null ? { column: text((key as Record<string, unknown>).column, TRANSFORM_LIMITS.name), descending: (key as Record<string, unknown>).descending === true } : { column: '', descending: false }))
        if (by.length === 0 || by.some((key) => key.column === '')) problems.push(`${at} (sort) needs "by": a list of {column, descending?}.`)
        else steps.push({ op: 'sort', by })
        return
      }
      case 'filter': {
        const match = step.match === 'any' ? 'any' : 'all'
        const where: WhereClause[] = []
        const clauses = list(step.where).slice(0, TRANSFORM_LIMITS.conditions)
        if (clauses.length === 0) problems.push(`${at} (filter) needs "where": a list of {column, is, value}.`)
        clauses.forEach((clause, j) => {
          const c = (typeof clause === 'object' && clause !== null ? clause : {}) as Record<string, unknown>
          const column = text(c.column, TRANSFORM_LIMITS.name)
          const is = text(c.is, 30).toLowerCase() as Comparison
          if (column === '') {
            problems.push(`${at}.where[${j}] has no column.`)
            return
          }
          if (!COMPARISONS.includes(is)) {
            problems.push(`${at}.where[${j}] has "is": "${text(c.is, 30)}", which is not one of: ${COMPARISONS.join(', ')}.`)
            return
          }
          const needsValue = !['is-empty', 'is-not-empty', 'is-invalid', 'is-one-of'].includes(is)
          const value = scalar(c.value)
          if (needsValue && value === undefined) {
            problems.push(`${at}.where[${j}] ("${column}" ${is}) has no value to compare with.`)
            return
          }
          const value2 = scalar(c.value2)
          if (is === 'between' && (value2 === undefined || typeof value2 === 'boolean')) {
            problems.push(`${at}.where[${j}] ("${column}" between) needs "value" and "value2".`)
            return
          }
          const values = list(c.values)
            .map(scalar)
            .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
          if (is === 'is-one-of' && values.length === 0) {
            problems.push(`${at}.where[${j}] ("${column}" is-one-of) needs "values": a list.`)
            return
          }
          where.push({ column, is, ...(value !== undefined ? { value } : {}), ...(typeof value2 === 'string' || typeof value2 === 'number' ? { value2 } : {}), ...(values.length ? { values } : {}) })
        })
        if (where.length > 0) steps.push({ op: 'filter', match, where })
        return
      }
      case 'keep':
      case 'drop': {
        const columns = list(step.columns)
          .slice(0, TRANSFORM_LIMITS.columns)
          .map((name) => text(name, TRANSFORM_LIMITS.name))
          .filter((name) => name !== '')
        if (columns.length === 0) problems.push(`${at} (${op}) needs "columns": a list of column names.`)
        else steps.push({ op, columns })
        return
      }
      case 'rename': {
        const column = text(step.column, TRANSFORM_LIMITS.name)
        const to = text(step.to, TRANSFORM_LIMITS.name)
        if (column === '' || to === '') problems.push(`${at} (rename) needs "column" and "to".`)
        else steps.push({ op: 'rename', column, to })
        return
      }
      case 'compute': {
        const name = text(step.name, TRANSFORM_LIMITS.name)
        const formula = text(step.formula, TRANSFORM_LIMITS.formula)
        if (name === '' || formula === '') {
          problems.push(`${at} (compute) needs "name" and "formula".`)
          return
        }
        const parsed = parseExpression(formula)
        if (isParseError(parsed)) {
          problems.push(`${at} (compute "${name}") has a formula that cannot be read: ${parsed.message}`)
          return
        }
        steps.push({ op: 'compute', name, formula })
        return
      }
      case 'group': {
        const by = list(step.by)
          .slice(0, TRANSFORM_LIMITS.keys)
          .map((name) => text(name, TRANSFORM_LIMITS.name))
          .filter((name) => name !== '')
        if (by.length === 0) {
          problems.push(`${at} (group) needs "by": the columns to group on.`)
          return
        }
        const totals: { column: string; how: Aggregate; as: string }[] = []
        let bad = false
        list(step.totals)
          .slice(0, TRANSFORM_LIMITS.totals)
          .forEach((total, j) => {
            const t = (typeof total === 'object' && total !== null ? total : {}) as Record<string, unknown>
            const how = text(t.how, 30).toLowerCase() as Aggregate
            const column = text(t.column, TRANSFORM_LIMITS.name)
            if (!AGGREGATES.includes(how)) {
              problems.push(`${at}.totals[${j}] has "how": "${text(t.how, 30)}", which is not one of: ${AGGREGATES.join(', ')}.`)
              bad = true
              return
            }
            if (column === '' && how !== 'count') {
              problems.push(`${at}.totals[${j}] (${how}) has no column.`)
              bad = true
              return
            }
            totals.push({ column, how, as: text(t.as, TRANSFORM_LIMITS.name) })
          })
        if (!bad) steps.push({ op: 'group', by, totals: totals.length ? totals : [{ column: '', how: 'count', as: 'rows' }] })
        return
      }
      case 'limit': {
        const rows = typeof step.rows === 'number' ? Math.floor(step.rows) : Number.NaN
        if (!Number.isFinite(rows) || rows < 1) problems.push(`${at} (limit) needs "rows": a whole number of at least 1.`)
        else steps.push({ op: 'limit', rows })
        return
      }
      case 'set':
      case 'remove': {
        const match = step.match === 'any' ? 'any' : 'all'
        const row = typeof step.row === 'number' && Number.isInteger(step.row) && step.row >= 1 ? step.row : undefined
        const where: WhereClause[] = []
        let bad = false
        list(step.where)
          .slice(0, TRANSFORM_LIMITS.conditions)
          .forEach((clause, j) => {
            const c = (typeof clause === 'object' && clause !== null ? clause : {}) as Record<string, unknown>
            const column = text(c.column, TRANSFORM_LIMITS.name)
            const is = text(c.is, 30).toLowerCase() as Comparison
            const value = scalar(c.value)
            const value2 = scalar(c.value2)
            const values = list(c.values)
              .map(scalar)
              .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
            if (column === '' || !COMPARISONS.includes(is)) {
              problems.push(`${at}.where[${j}] needs a "column" and an "is" that is one of: ${COMPARISONS.join(', ')}.`)
              bad = true
              return
            }
            if (!['is-empty', 'is-not-empty', 'is-invalid', 'is-one-of'].includes(is) && value === undefined) {
              problems.push(`${at}.where[${j}] ("${column}" ${is}) has no value to compare with.`)
              bad = true
              return
            }
            where.push({ column, is, ...(value !== undefined ? { value } : {}), ...(typeof value2 === 'string' || typeof value2 === 'number' ? { value2 } : {}), ...(values.length ? { values } : {}) })
          })
        if (bad) return
        // Which rows has to be said. A change to "every row" by forgetting to say which is the mistake to refuse.
        if (where.length === 0 && row === undefined) {
          problems.push(`${at} (${op}) has to say which rows: "where": [{column, is, value}], or "row": the row's number counting from 1.`)
          return
        }
        if (op === 'remove') {
          steps.push({ op: 'remove', match, where, ...(row !== undefined ? { row } : {}) })
          return
        }
        const column = text(step.column, TRANSFORM_LIMITS.name)
        const value = typeof step.value === 'string' ? step.value.slice(0, TRANSFORM_LIMITS.cell) : typeof step.value === 'number' && Number.isFinite(step.value) ? String(step.value) : typeof step.value === 'boolean' ? String(step.value) : step.value === null ? '' : undefined
        if (column === '' || value === undefined) problems.push(`${at} (set) needs "column": the column to change, and "value": what to put there (an empty string empties it).`)
        else steps.push({ op: 'set', column, value, match, where, ...(row !== undefined ? { row } : {}) })
        return
      }
      case 'add': {
        const rows: Record<string, string>[] = []
        for (const one of list(step.rows).slice(0, TRANSFORM_LIMITS.newRows)) {
          if (typeof one !== 'object' || one === null || Array.isArray(one)) continue
          const row: Record<string, string> = {}
          for (const [name, value] of Object.entries(one as Record<string, unknown>).slice(0, TRANSFORM_LIMITS.columns)) {
            if (typeof value === 'string') row[name.slice(0, TRANSFORM_LIMITS.name)] = value.slice(0, TRANSFORM_LIMITS.cell)
            else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') row[name.slice(0, TRANSFORM_LIMITS.name)] = String(value)
          }
          if (Object.keys(row).length > 0) rows.push(row)
        }
        if (rows.length === 0) problems.push(`${at} (add) needs "rows": a list of rows, each {column name: value}.`)
        else steps.push({ op: 'add', rows })
        return
      }
      default:
        problems.push(`${at} has "op": "${text(step.op, 20) || 'missing'}", which is not one of: ${TRANSFORM_OPS.join(', ')}.`)
    }
  })
  return { steps, problems }
}

/** A name as a formula may write it: lower case, with anything that is not a letter or a digit turned into `_`. */
export const formulaName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** The column a name means: by id, then by name whatever its case, then by the name a formula would write. */
function resolve(table: Table, name: string): Column | null {
  const wanted = name.trim()
  return (
    table.columns.find((one) => one.id === wanted) ??
    table.columns.find((one) => one.name.toLowerCase() === wanted.toLowerCase()) ??
    table.columns.find((one) => formulaName(one.name) === formulaName(wanted) && formulaName(wanted) !== '') ??
    null
  )
}

const noColumn = (table: Table, name: string): string => `There is no column called "${name}". The columns are: ${table.columns.map((one) => one.name).join(', ')}.`

const COMPARISON_WORDS: Record<Comparison, string> = {
  equals: 'is',
  'not-equals': 'is not',
  contains: 'contains',
  'starts-with': 'starts with',
  'ends-with': 'ends with',
  greater: 'is more than',
  'greater-or-equal': 'is at least',
  less: 'is less than',
  'less-or-equal': 'is at most',
  between: 'is between',
  'is-empty': 'is empty',
  'is-not-empty': 'is not empty',
  'is-invalid': 'could not be read',
  'is-one-of': 'is one of'
}

const quote = (value: unknown): string => (typeof value === 'string' ? `"${value}"` : String(value))

const describeClause = (clause: WhereClause, column: Column): string => {
  const words = COMPARISON_WORDS[clause.is]
  if (clause.is === 'is-empty' || clause.is === 'is-not-empty' || clause.is === 'is-invalid') return `${column.name} ${words}`
  if (clause.is === 'between') return `${column.name} ${words} ${quote(clause.value)} and ${quote(clause.value2)}`
  if (clause.is === 'is-one-of') return `${column.name} ${words} ${(clause.values ?? []).map(quote).join(', ')}`
  return `${column.name} ${words} ${quote(clause.value)}`
}

const AGGREGATE_WORDS: Record<Aggregate, string> = {
  count: 'rows',
  'count-values': 'values of',
  'count-distinct': 'distinct',
  sum: 'sum of',
  mean: 'mean of',
  median: 'median of',
  minimum: 'smallest',
  maximum: 'largest',
  'standard-deviation': 'spread of',
  first: 'first',
  last: 'last'
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** What each kind of column holds, in the words a refusal uses. */
const TYPE_WORDS: Readonly<Record<Column['type'], string>> = Object.freeze({
  text: 'text',
  category: 'text',
  number: 'numbers',
  integer: 'whole numbers',
  boolean: 'yes or no',
  date: 'dates',
  quantity: 'amounts with a unit'
})

/** An id no column in the table has yet, made from a name. */
const freshId = (table: Table, name: string): string => {
  const base = formulaName(name) || 'column'
  let id = base
  for (let n = 2; table.columns.some((one) => one.id === id); n++) id = `${base}_${n}`
  return id
}

export interface TransformFailure {
  error: 'bad-step'
  /** Which step, counted from 1, so the message can say "step 3". */
  step: number
  op: string
  message: string
}

export interface TransformResult {
  table: Table
  /** One sentence per step, in order, saying what it did to the table. */
  notes: string[]
}

export const isTransformFailure = (value: TransformResult | TransformFailure): value is TransformFailure => 'error' in value

/**
 * The steps applied in order.
 *
 * The first step that cannot run stops everything and says which one and why; nothing after it runs, and nothing is
 * half-applied, because the table is a new value at each step and the caller only ever sees the last.
 */
export function applySteps(table: Table, steps: readonly TransformStep[]): TransformResult | TransformFailure {
  let current = table
  const notes: string[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stop = (message: string): TransformFailure => ({ error: 'bad-step', step: i + 1, op: step.op, message })
    switch (step.op) {
      case 'sort': {
        const keys: { columnId: string; descending: boolean }[] = []
        const words: string[] = []
        for (const key of step.by) {
          const column = resolve(current, key.column)
          if (!column) return stop(noColumn(current, key.column))
          keys.push({ columnId: column.id, descending: key.descending })
          const numeric = column.type === 'number' || column.type === 'integer' || column.type === 'quantity'
          const dated = column.type === 'date'
          words.push(`${column.name} (${key.descending ? (dated ? 'newest first' : numeric ? 'largest first' : 'Z to A') : dated ? 'oldest first' : numeric ? 'smallest first' : 'A to Z'})`)
        }
        const sorted = sortTable(current, keys)
        if (isDataError(sorted)) return stop(sorted.message)
        current = sorted
        notes.push(`Sorted by ${words.join(', then ')}. Rows with no value sort last.`)
        break
      }
      case 'filter': {
        const conditions: Condition[] = []
        const words: string[] = []
        for (const clause of step.where) {
          const column = resolve(current, clause.column)
          if (!column) return stop(noColumn(current, clause.column))
          conditions.push({ columnId: column.id, comparison: clause.is, value: clause.value, value2: clause.value2, values: clause.values })
          words.push(describeClause(clause, column))
        }
        const before = current.rows.length
        const kept = filterTable(current, { match: step.match, conditions })
        if (isDataError(kept)) return stop(kept.message)
        current = kept
        const joined = words.join(step.match === 'any' ? ' or ' : ' and ')
        notes.push(
          current.rows.length === 0
            ? `No row matched: ${joined}. The table has its columns and no rows.`
            : `Kept ${current.rows.length.toLocaleString('en')} of ${plural(before, 'row')} where ${joined}.`
        )
        break
      }
      case 'keep': {
        const ids: string[] = []
        for (const name of step.columns) {
          const column = resolve(current, name)
          if (!column) return stop(noColumn(current, name))
          if (!ids.includes(column.id)) ids.push(column.id)
        }
        const selected = selectColumns(current, ids)
        if (isDataError(selected)) return stop(selected.message)
        current = selected
        notes.push(`Kept ${plural(ids.length, 'column')}: ${current.columns.map((one) => one.name).join(', ')}.`)
        break
      }
      case 'drop': {
        const names: string[] = []
        for (const name of step.columns) {
          const column = resolve(current, name)
          if (!column) return stop(noColumn(current, name))
          if (current.columns.length === 1) return stop(`Removing "${column.name}" would leave a table with no columns.`)
          const dropped = dropColumn(current, column.id)
          if (isDataError(dropped)) return stop(dropped.message)
          current = dropped
          names.push(column.name)
        }
        notes.push(`Removed ${plural(names.length, 'column')}: ${names.join(', ')}.`)
        break
      }
      case 'rename': {
        const column = resolve(current, step.column)
        if (!column) return stop(noColumn(current, step.column))
        const taken = current.columns.find((one) => one.id !== column.id && one.name.toLowerCase() === step.to.toLowerCase())
        if (taken) return stop(`There is already a column called "${taken.name}".`)
        const renamed = renameColumn(current, column.id, step.to)
        if (isDataError(renamed)) return stop(renamed.message)
        current = renamed
        notes.push(`Renamed "${column.name}" to "${step.to}".`)
        break
      }
      case 'compute': {
        const parsed = parseExpression(step.formula)
        if (isParseError(parsed)) return stop(`The formula cannot be read: ${parsed.message}`)
        if (current.columns.some((one) => one.name.toLowerCase() === step.name.toLowerCase())) return stop(`There is already a column called "${step.name}".`)
        const inputs: { symbol: string; at: number; column: Column }[] = []
        for (const symbol of variablesOf(parsed)) {
          const column = current.columns.find((one) => one.id === symbol) ?? current.columns.find((one) => formulaName(one.name) === symbol.toLowerCase())
          if (!column) {
            return stop(`The formula uses "${symbol}", which is not a column. In a formula the columns are written: ${current.columns.map((one) => formulaName(one.name)).join(', ')}.`)
          }
          inputs.push({ symbol, at: columnIndex(current, column.id), column })
        }
        let computed = 0
        let missing = 0
        let failed = 0
        let firstFailure = ''
        const next = addColumn(
          current,
          { id: freshId(current, step.name), sourceName: step.name, name: step.name, type: 'number', unit: null, confidence: 'given', reason: `Computed by Orbis: ${step.formula}` },
          (row): Cell => {
            const scope: Record<string, number> = {}
            for (const input of inputs) {
              const value = asNumber(row.cells[input.at] ?? MISSING)
              if (value === null) {
                missing += 1
                return MISSING
              }
              scope[input.symbol] = value
            }
            const value = evaluateExpression(parsed, scope)
            if (isEvaluateError(value)) {
              failed += 1
              if (firstFailure === '') firstFailure = value.message
              return invalid('', value.message)
            }
            computed += 1
            return value
          }
        )
        if (isDataError(next)) return stop(next.message)
        current = next
        const parts = [`"${step.name}" = ${step.formula}: computed for ${computed.toLocaleString('en')} of ${plural(current.rows.length, 'row')}`]
        if (missing > 0) parts.push(`${plural(missing, 'row')} left empty because an input had no number`)
        if (failed > 0) parts.push(`${plural(failed, 'row')} could not be worked out (${firstFailure})`)
        const measured = inputs.filter((one) => one.column.unit !== null).map((one) => `${one.column.name} is in ${one.column.unit?.display}`)
        notes.push(`${parts.join('; ')}.${measured.length ? ` Units are not carried through a formula: ${measured.join(', ')}, and the result is a plain number.` : ''}`)
        break
      }
      case 'group': {
        const by: Column[] = []
        for (const name of step.by) {
          const column = resolve(current, name)
          if (!column) return stop(noColumn(current, name))
          if (!by.some((one) => one.id === column.id)) by.push(column)
        }
        const requests: { columnId: string; aggregate: Aggregate; as: string }[] = []
        for (const total of step.totals) {
          const column = total.column === '' ? by[0] : resolve(current, total.column)
          if (!column) return stop(noColumn(current, total.column))
          const numeric = column.type === 'number' || column.type === 'integer' || column.type === 'quantity'
          if (!numeric && ['sum', 'mean', 'median', 'standard-deviation'].includes(total.how)) {
            return stop(`"${column.name}" is ${column.type}, not numbers, so there is no ${total.how} of it.`)
          }
          const as = total.as || (total.how === 'count' ? 'rows' : `${AGGREGATE_WORDS[total.how]} ${column.name}`)
          if (requests.some((one) => one.as === as)) return stop(`Two totals would both be called "${as}".`)
          requests.push({ columnId: column.id, aggregate: total.how, as })
        }
        const before = current.rows.length
        const groups = groupBy(
          current,
          by.map((one) => one.id),
          requests
        )
        if (isDataError(groups)) return stop(groups.message)
        current = groupsToTable(groups, by, current.source)
        notes.push(`Grouped ${plural(before, 'row')} by ${by.map((one) => one.name).join(', ')} into ${plural(groups.length, 'group')}, with: ${requests.map((one) => one.as).join(', ')}.`)
        break
      }
      case 'set':
      case 'remove': {
        // Which rows: the one numbered, or the ones the conditions match -- found by the same filter a filter step uses.
        let ids: Set<number>
        let which: string
        if (step.row !== undefined) {
          const row = current.rows[step.row - 1]
          if (!row) return stop(`There is no row ${step.row}: the table has ${plural(current.rows.length, 'row')}.`)
          ids = new Set([row.id])
          which = `row ${step.row}`
        } else {
          const conditions: Condition[] = []
          const words: string[] = []
          for (const clause of step.where) {
            const column = resolve(current, clause.column)
            if (!column) return stop(noColumn(current, clause.column))
            conditions.push({ columnId: column.id, comparison: clause.is, value: clause.value, value2: clause.value2, values: clause.values })
            words.push(describeClause(clause, column))
          }
          const matched = filterTable(current, { match: step.match, conditions })
          if (isDataError(matched)) return stop(matched.message)
          ids = new Set(matched.rows.map((one) => one.id))
          which = `where ${words.join(step.match === 'any' ? ' or ' : ' and ')}`
          // Nothing matched: said, and stopped. "Changed 0 rows" reported as a change is how a typo goes unnoticed.
          if (ids.size === 0) return stop(`No row matched (${which}), so nothing was changed.`)
        }
        if (step.op === 'remove') {
          const before = current.rows.length
          current = Object.freeze({ ...current, rows: Object.freeze(current.rows.filter((one) => !ids.has(one.id))) })
          notes.push(`Removed ${plural(before - current.rows.length, 'row')} (${which}). ${plural(current.rows.length, 'row')} left.`)
          break
        }
        const column = resolve(current, step.column)
        if (!column) return stop(noColumn(current, step.column))
        const at = columnIndex(current, column.id)
        const cell = readCell(step.value, column.type, column.unit)
        // A value that does not fit the column is refused, not kept as a broken cell: the person is editing, and can be told.
        if (isInvalid(cell)) return stop(`"${step.value.slice(0, 60)}" does not fit the "${column.name}" column, which holds ${TYPE_WORDS[column.type]}. ${cell.why}`)
        let changed = 0
        const rows = current.rows.map((one) => {
          if (!ids.has(one.id)) return one
          changed += 1
          const cells = [...one.cells]
          cells[at] = cell
          return Object.freeze({ ...one, cells: Object.freeze(cells) })
        })
        current = Object.freeze({ ...current, rows: Object.freeze(rows) })
        notes.push(`Set "${column.name}" to ${step.value.trim() === '' ? 'empty' : `"${step.value.slice(0, 80)}"`} in ${plural(changed, 'row')} (${which}).`)
        break
      }
      case 'add': {
        let nextId = current.nextId
        const added: Table['rows'][number][] = []
        for (const [n, given] of step.rows.entries()) {
          const cells: Cell[] = current.columns.map(() => null)
          for (const [name, value] of Object.entries(given)) {
            const column = resolve(current, name)
            if (!column) return stop(noColumn(current, name))
            const cell = readCell(value, column.type, column.unit)
            if (isInvalid(cell)) return stop(`In new row ${n + 1}, "${value.slice(0, 60)}" does not fit the "${column.name}" column, which holds ${TYPE_WORDS[column.type]}. ${cell.why}`)
            cells[columnIndex(current, column.id)] = cell
          }
          added.push(Object.freeze({ id: nextId++, cells: Object.freeze(cells) }))
        }
        current = Object.freeze({ ...current, rows: Object.freeze([...current.rows, ...added]), nextId })
        notes.push(`Added ${plural(added.length, 'row')} at the end. The table has ${plural(current.rows.length, 'row')}.`)
        break
      }
      case 'limit': {
        const before = current.rows.length
        if (before > step.rows) {
          current = Object.freeze({ ...current, rows: Object.freeze(current.rows.slice(0, step.rows)) })
          notes.push(`Kept the first ${step.rows.toLocaleString('en')} of ${plural(before, 'row')}.`)
        } else {
          notes.push(`Asked for the first ${step.rows.toLocaleString('en')} rows; there are only ${before.toLocaleString('en')}, so all were kept.`)
        }
        break
      }
    }
  }
  return { table: current, notes }
}

/**
 * What a model is told when it is asked to turn a sentence into steps.
 *
 * It is given the columns and their types and nothing of the data: the steps are a plan, the engine does the work,
 * and a model that never saw a number cannot have invented one.
 */
export function stepInstructions(columns: readonly Pick<Column, 'name' | 'type'>[]): string {
  return `You turn a request to change a table into a list of steps. Answer with JSON only: {"steps": [ ... ]}.

The table's columns (name: type):
${columns.map((one) => `  ${one.name}: ${one.type}`).join('\n')}

Each step is one of:
  {"op": "filter", "match": "all" | "any", "where": [{"column": name, "is": comparison, "value": ..., "value2": ..., "values": [...]}]}
      comparison is one of: ${COMPARISONS.join(', ')}. "between" needs value and value2. "is-one-of" needs values.
  {"op": "sort", "by": [{"column": name, "descending": true | false}]}
  {"op": "keep", "columns": [name, ...]}        keep only these columns, in this order
  {"op": "drop", "columns": [name, ...]}
  {"op": "rename", "column": name, "to": new name}
  {"op": "compute", "name": new column name, "formula": expression}
      the formula is arithmetic over numeric columns: + - * / ^ and parentheses, numbers, and the functions
      ${Object.keys(FUNCTIONS).join(', ')}.
      In a formula a column is written in lower case with every space or symbol as an underscore:
${columns.map((one) => `        ${one.name} -> ${formulaName(one.name)}`).join('\n')}
  {"op": "group", "by": [name, ...], "totals": [{"column": name, "how": aggregate, "as": result name}]}
      aggregate is one of: ${AGGREGATES.join(', ')}. After a group the table has only the "by" columns and the totals.
  {"op": "limit", "rows": N}                    keep the first N rows
  {"op": "set", "column": name, "value": text, "where": [{"column": name, "is": comparison, "value": ...}]}
      put a new value in one column, in the rows the conditions match ("change February's revenue to 2000").
      For "the third row", use "row": 3 instead of "where". An empty "value" empties the cell.
  {"op": "add", "rows": [{column name: value, ...}]}    new rows at the end, with the values the person gave
  {"op": "remove", "where": [...]}              take out the rows that match; or "row": N for one row by its number

Rules:
- Use only the column names above, or names an earlier step made.
- Steps run in order. To get "top 5 by X": sort by X descending, then limit 5.
- "set", "add" and "remove" carry only values the person gave. Never fill in a value they did not give: leave it out.
- Do not compute anything yourself and do not include any data values that are not in the request.
- If the request cannot be done with these steps, answer {"steps": [], "cannot": "why, in one sentence"}.`
}
