import { aggregateCells, asNumber, columnIndex, isInvalid, isMissing, isQuantityCell, type Cell, type Column, type Table } from '../compute/data.ts'
import { CONSTANTS, isParseError, parseExpression, variablesOf, type Expression } from '../compute/expression.ts'
import { formulaName } from './transform.ts'

/**
 * Formulas that live in a cell.
 *
 * A computed column and a total are written to a workbook as numbers today, so changing a figure in Excel leaves the
 * total it belonged to saying what it said before. This turns the engine's own expressions into real Excel formulas,
 * so the workbook recalculates the way the person expects -- and refuses to write one wherever Excel would not give
 * the same answer Orbis gave. A formula that is nearly right is worse than a number: the number is at least honestly
 * stale, while the formula looks live and lies.
 *
 * So everything here is built around one rule: **a formula is written only when it has been proved.** The printer
 * turns an `Expression` into Excel syntax, and then a small evaluator of Orbis's own -- a parser and an interpreter
 * for exactly the subset the printer emits, and nothing else -- works the emitted text out over the very cells the
 * sheet will hold and compares its answer with the answer the engine already computed. Disagree, and the column is
 * written as numbers with the reason said in plain words.
 *
 * The places Excel and Orbis differ, each refused rather than approximated:
 *
 * - `%` is a remainder here and a per cent sign in Excel; Excel's `MOD` differs in sign for a negative number.
 * - `round(x)` rounds a half upwards here (`Math.round`) and away from zero in Excel's `ROUND`.
 * - `atan2(y, x)` takes its arguments the other way round in Excel.
 * - `cbrt` and `hypot` have no exact Excel form; a power of a third is not a third.
 * - `e` is a constant here and `EXP(1)` there, which is a computation, not the same bits.
 * - A blank cell is nothing here and zero in Excel, so every formula with inputs is wrapped in a count of them.
 * - Text, dates and yes/no columns are refused as inputs: Excel's `COUNT` does not count them, so the guard above
 *   would empty every row.
 *
 * Pure. No files, no clock, no model.
 */

export const FORMULA_LIMITS = Object.freeze({
  /** Past this many rows the proof of every cell is too slow to be worth it, so the table is written as numbers. */
  rows: 20_000,
  /** What Excel accepts in one formula is 8,192 characters; a little under that is the most Orbis writes. */
  formula: 8_000,
  /** Excel's last column is XFD and its last row is 1,048,576. */
  columns: 16_384,
  sheetRows: 1_048_576
})

/** The prefix `compute` writes into a column's reason, which is where a computed column's expression survives. */
const COMPUTED_REASON = 'Computed by Orbis: '

/** The expression a column was computed by, or null for a column that holds what somebody gave. */
export function computedFormulaOf(column: Pick<Column, 'reason'>): string | null {
  if (!column.reason.startsWith(COMPUTED_REASON)) return null
  const formula = column.reason.slice(COMPUTED_REASON.length).trim()
  return formula === '' ? null : formula
}

// ---------------------------------------------------------------- addresses

/** A column's letters, counting from 1: A, Z, AA, XFD. */
export function columnLetter(column: number): string {
  let left = Math.floor(column)
  let out = ''
  while (left > 0) {
    const remainder = (left - 1) % 26
    out = String.fromCharCode(65 + remainder) + out
    left = Math.floor((left - 1) / 26)
  }
  return out
}

/** An A1 address from a column and a row, both counting from 1. */
export const addressOf = (column: number, row: number): string => `${columnLetter(column)}${row}`

// ---------------------------------------------------------------- what Excel will hold in a cell

export type SheetValue =
  | { kind: 'number'; value: number }
  | { kind: 'date'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'logical'; value: boolean }
  | { kind: 'blank' }

/**
 * The value the workbook writer will put in a cell.
 *
 * This mirrors `excelValue` in the workbook writer, and has to: the proof below is worked out over these values, so if
 * the two disagreed the proof would be about a sheet nobody wrote. It is deliberately small -- the one case where the
 * two could drift, a column that is not plain numbers, is refused as a formula's input before it is ever read here.
 */
export function excelSees(cell: Cell, column: Pick<Column, 'type'>): SheetValue {
  if (cell === null || cell === undefined || isMissing(cell)) return { kind: 'blank' }
  if (isInvalid(cell)) return cell.raw === '' ? { kind: 'blank' } : { kind: 'text', value: cell.raw }
  if (isQuantityCell(cell)) return Number.isFinite(cell.value) ? { kind: 'number', value: cell.value } : { kind: 'blank' }
  if (typeof cell === 'boolean') return { kind: 'logical', value: cell }
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return { kind: 'blank' }
    return column.type === 'date' ? { kind: 'date', value: cell } : { kind: 'number', value: cell }
  }
  return cell === '' ? { kind: 'blank' } : { kind: 'text', value: String(cell) }
}

/** The 1900 serial number Excel keeps a date as, so a date in the sheet is a number to the evaluator as well. */
const serialOf = (ms: number): number => ms / 86_400_000 + 25_569

const asExcelValue = (value: SheetValue): ExcelValue => {
  switch (value.kind) {
    case 'number':
      return value.value
    case 'date':
      return serialOf(value.value)
    case 'text':
      return value.value
    case 'logical':
      return value.value
    case 'blank':
      return null
  }
}

// ---------------------------------------------------------------- the printer

export interface FormulaRefusal {
  error: 'cannot-express'
  message: string
}

export const isFormulaRefusal = (value: unknown): value is FormulaRefusal =>
  typeof value === 'object' && value !== null && (value as { error?: string }).error === 'cannot-express'

const cannot = (message: string): FormulaRefusal => ({ error: 'cannot-express', message })

/** A number as an Excel formula writes it. Exponent notation is refused rather than guessed at. */
const numberText = (value: number): string | FormulaRefusal => {
  if (!Number.isFinite(value)) return cannot('a number in it has no finite value')
  const written = String(value)
  if (!/^-?\d+(\.\d+)?$/.test(written)) return cannot(`the number ${written} cannot be written in a formula exactly`)
  return written
}

/** The constants that have an Excel form giving the very same number. `e` does not: `EXP(1)` is a computation. */
const CONSTANT_TEXT: Readonly<Record<string, string>> = Object.freeze({
  pi: 'PI()',
  'π': 'PI()',
  tau: '(2*PI())',
  phi: '((1+SQRT(5))/2)'
})

/**
 * An expression as an Excel formula, without the leading `=`.
 *
 * `refOf` says what a column's symbol becomes -- an address for the row being written -- or refuses it. Brackets are
 * put round every compound part rather than worked out from precedence, because Orbis and Excel do not agree about
 * what `-2^2` means and a bracket costs nothing.
 */
export function toExcelFormula(node: Expression, refOf: (symbol: string) => string | FormulaRefusal): string | FormulaRefusal {
  const grouped = (child: Expression): string | FormulaRefusal => {
    const written = write(child)
    if (isFormulaRefusal(written)) return written
    if (child.kind === 'symbol' || child.kind === 'call') return written
    if (child.kind === 'number' && child.value >= 0) return written
    return `(${written})`
  }

  const args = (nodes: readonly Expression[]): string[] | FormulaRefusal => {
    const out: string[] = []
    for (const one of nodes) {
      const written = write(one)
      if (isFormulaRefusal(written)) return written
      out.push(written)
    }
    return out
  }

  const write = (current: Expression): string | FormulaRefusal => {
    switch (current.kind) {
      case 'number':
        return numberText(current.value)
      case 'symbol': {
        const constant = Object.prototype.hasOwnProperty.call(CONSTANT_TEXT, current.name) ? CONSTANT_TEXT[current.name] : null
        if (constant !== null) return constant
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, current.name)) {
          return cannot(`"${current.name}" has no Excel form that is the same number to the last digit`)
        }
        return refOf(current.name)
      }
      case 'unary': {
        const inner = grouped(current.operand)
        if (isFormulaRefusal(inner)) return inner
        return current.op === '-' ? `-${inner}` : inner
      }
      case 'binary': {
        if (current.op === '%') {
          return cannot('"%" here is the remainder, and Excel\'s MOD gives a different answer when a number is negative')
        }
        const left = grouped(current.left)
        if (isFormulaRefusal(left)) return left
        const right = grouped(current.right)
        if (isFormulaRefusal(right)) return right
        return `${left}${current.op}${right}`
      }
      case 'call': {
        const written = args(current.args)
        if (isFormulaRefusal(written)) return written
        const n = written.length
        switch (current.name) {
          case 'sqrt':
            return `SQRT(${written[0]})`
          case 'abs':
            return `ABS(${written[0]})`
          case 'sign':
            return `SIGN(${written[0]})`
          case 'exp':
            return `EXP(${written[0]})`
          case 'ln':
            return `LN(${written[0]})`
          case 'log':
            return n === 1 ? `LOG10(${written[0]})` : `LOG(${written[0]},${written[1]})`
          case 'log2':
            return `LOG(${written[0]},2)`
          case 'sin':
          case 'cos':
          case 'tan':
          case 'asin':
          case 'acos':
          case 'atan':
          case 'sinh':
          case 'cosh':
          case 'tanh':
            return `${current.name.toUpperCase()}(${written[0]})`
          case 'atan2':
            // Excel takes the across-the-page coordinate first; Orbis, like most languages, takes the up-the-page one.
            return `ATAN2(${written[1]},${written[0]})`
          case 'floor':
            return `INT(${written[0]})`
          case 'ceil':
            // INT rounds down, so rounding up is rounding the other sign down and turning it back.
            return `(-INT(-(${written[0]})))`
          case 'round':
            if (n !== 1) return cannot('"round" to a number of places rounds a half the other way in Excel')
            // Excel's ROUND sends a half away from zero; Orbis sends it upwards, which is what INT(x + 0.5) does.
            return `INT((${written[0]})+0.5)`
          case 'min':
            return `MIN(${written.join(',')})`
          case 'max':
            return `MAX(${written.join(',')})`
          case 'cbrt':
            return cannot('a cube root has no exact Excel form: a power of a third is not a third')
          case 'hypot':
            return cannot('"hypot" is worked out here in a way Excel has no function for')
          default:
            return cannot(`Excel has no exact form for "${current.name}"`)
        }
      }
    }
  }

  return write(node)
}

// ---------------------------------------------------------------- the evaluator for what the printer emits

export interface ExcelError {
  excel: '#VALUE!' | '#DIV/0!' | '#NUM!' | '#NAME?'
  why: string
}

export const isExcelError = (value: unknown): value is ExcelError =>
  typeof value === 'object' && value !== null && typeof (value as { excel?: unknown }).excel === 'string'

export type ExcelValue = number | string | boolean | null | ExcelError

type Evaluated = ExcelValue | ExcelValue[]

const problem = (excel: ExcelError['excel'], why: string): ExcelError => ({ excel, why })

interface Token {
  kind: 'number' | 'ref' | 'name' | 'string' | 'symbol'
  text: string
}

const REF = /^[A-Z]{1,3}[1-9][0-9]*$/

function tokenise(source: string): Token[] | ExcelError {
  const tokens: Token[] = []
  let at = 0
  while (at < source.length) {
    const ch = source[at]
    if (ch === ' ') {
      at += 1
      continue
    }
    if (ch === '"') {
      let end = at + 1
      while (end < source.length && source[end] !== '"') end += 1
      if (end >= source.length) return problem('#VALUE!', 'a piece of text in the formula has no closing quote')
      tokens.push({ kind: 'string', text: source.slice(at + 1, end) })
      at = end + 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[at + 1] ?? ''))) {
      let end = at
      while (end < source.length && /[0-9.]/.test(source[end])) end += 1
      tokens.push({ kind: 'number', text: source.slice(at, end) })
      at = end
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let end = at
      while (end < source.length && /[A-Za-z0-9.]/.test(source[end])) end += 1
      const word = source.slice(at, end)
      tokens.push({ kind: REF.test(word) ? 'ref' : 'name', text: word })
      at = end
      continue
    }
    if ('+-*/^(),:='.includes(ch)) {
      tokens.push({ kind: 'symbol', text: ch })
      at += 1
      continue
    }
    return problem('#VALUE!', `"${ch}" is not something this formula may contain`)
  }
  return tokens
}

const RANGE_FUNCTIONS = new Set(['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'])

/** A value as a number the way Excel coerces one in arithmetic: a blank is zero, a yes is one, text that reads as a number is that number. */
const arithmetic = (value: ExcelValue): number | ExcelError => {
  if (isExcelError(value)) return value
  if (value === null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  const read = Number(value.trim())
  return value.trim() !== '' && Number.isFinite(read) ? read : problem('#VALUE!', `"${value}" is text, not a number`)
}

/** Only the numbers: what SUM, COUNT, AVERAGE, MIN and MAX see. Text, a yes or no, and a blank are passed over. */
const numbersIn = (values: readonly ExcelValue[]): number[] | ExcelError => {
  const out: number[] = []
  for (const one of values) {
    if (isExcelError(one)) return one
    if (typeof one === 'number' && Number.isFinite(one)) out.push(one)
  }
  return out
}

/**
 * The emitted formula worked out, cell by cell, the way Excel would.
 *
 * `cellAt` hands back what the sheet holds at an address. The answer is a number, a piece of text, a yes or no, or an
 * Excel error -- never a guess: a formula with anything in it this evaluator does not know is an error, which is what
 * makes it usable as a proof.
 */
export function evaluateExcel(formula: string, cellAt: (address: string) => ExcelValue): ExcelValue {
  const tokens = tokenise(formula)
  if (isExcelError(tokens)) return tokens
  let at = 0
  const peek = (): Token | null => tokens[at] ?? null
  const eat = (text: string): boolean => {
    if (tokens[at] && tokens[at].text === text) {
      at += 1
      return true
    }
    return false
  }

  const scalar = (value: Evaluated): ExcelValue =>
    Array.isArray(value) ? problem('#VALUE!', 'a range of cells was used where one value was wanted') : value

  const primary = (): Evaluated => {
    const token = peek()
    if (!token) return problem('#VALUE!', 'the formula stops before it is finished')
    if (token.text === '(') {
      at += 1
      const inner = expression()
      if (!eat(')')) return problem('#VALUE!', 'a bracket in the formula was never closed')
      return inner
    }
    if (token.text === '-' || token.text === '+') {
      at += 1
      const inner = arithmetic(scalar(primary()))
      if (isExcelError(inner)) return inner
      return token.text === '-' ? -inner : inner
    }
    if (token.kind === 'number') {
      at += 1
      const value = Number(token.text)
      return Number.isFinite(value) ? value : problem('#VALUE!', `"${token.text}" is not a number`)
    }
    if (token.kind === 'string') {
      at += 1
      return token.text
    }
    if (token.kind === 'ref') {
      at += 1
      if (eat(':')) {
        const end = peek()
        if (!end || end.kind !== 'ref') return problem('#VALUE!', 'a range needs a cell at each end')
        at += 1
        return rangeValues(token.text, end.text, cellAt)
      }
      return cellAt(token.text)
    }
    if (token.kind === 'name') {
      at += 1
      if (!eat('(')) return problem('#NAME?', `"${token.text}" is not a function this formula may use`)
      const given: Evaluated[] = []
      if (!eat(')')) {
        for (;;) {
          given.push(expression())
          if (eat(')')) break
          if (!eat(',')) return problem('#VALUE!', 'the arguments of a function are separated by commas')
        }
      }
      return apply(token.text.toUpperCase(), given)
    }
    return problem('#VALUE!', `"${token.text}" is not something this formula may contain`)
  }

  const power = (): Evaluated => {
    let left = primary()
    while (peek()?.text === '^') {
      at += 1
      const a = arithmetic(scalar(left))
      if (isExcelError(a)) return a
      const b = arithmetic(scalar(primary()))
      if (isExcelError(b)) return b
      if (a < 0 && !Number.isInteger(b)) return problem('#NUM!', 'a negative number raised to a fractional power has no real value')
      const result = Math.pow(a, b)
      left = Number.isFinite(result) ? result : problem('#NUM!', 'that power has no finite value')
    }
    return left
  }

  const product = (): Evaluated => {
    let left = power()
    for (;;) {
      const op = peek()?.text
      if (op !== '*' && op !== '/') return left
      at += 1
      const a = arithmetic(scalar(left))
      if (isExcelError(a)) return a
      const b = arithmetic(scalar(power()))
      if (isExcelError(b)) return b
      if (op === '/' && b === 0) return problem('#DIV/0!', 'division by zero')
      left = op === '*' ? a * b : a / b
    }
  }

  const sum = (): Evaluated => {
    let left = product()
    for (;;) {
      const op = peek()?.text
      if (op !== '+' && op !== '-') return left
      at += 1
      const a = arithmetic(scalar(left))
      if (isExcelError(a)) return a
      const b = arithmetic(scalar(product()))
      if (isExcelError(b)) return b
      left = op === '+' ? a + b : a - b
    }
  }

  const expression = (): Evaluated => {
    const left = sum()
    if (peek()?.text !== '=') return left
    at += 1
    const right = sum()
    const a = scalar(left)
    const b = scalar(right)
    if (isExcelError(a)) return a
    if (isExcelError(b)) return b
    if (typeof a === 'number' && typeof b === 'number') return a === b
    return String(a ?? '') === String(b ?? '')
  }

  const apply = (name: string, given: readonly Evaluated[]): Evaluated => {
    if (name === 'IF') {
      if (given.length !== 3) return problem('#VALUE!', 'IF takes a test and two answers')
      const test = scalar(given[0])
      if (isExcelError(test)) return test
      const truth = typeof test === 'boolean' ? test : typeof test === 'number' ? test !== 0 : test !== null && test !== ''
      return scalar(given[truth ? 1 : 2])
    }
    if (name === 'PI') {
      if (given.length !== 0) return problem('#VALUE!', 'PI takes nothing')
      return Math.PI
    }
    if (RANGE_FUNCTIONS.has(name)) {
      const flat: ExcelValue[] = []
      for (const one of given) {
        if (Array.isArray(one)) flat.push(...one)
        else flat.push(one)
      }
      const numbers = numbersIn(flat)
      if (isExcelError(numbers)) return numbers
      if (name === 'COUNT') return numbers.length
      if (name === 'SUM') {
        // Left to right, as Excel adds: this is the point of the check, so it must not be a cleverer sum than Excel's.
        let total = 0
        for (const value of numbers) total += value
        return total
      }
      if (name === 'AVERAGE') {
        if (numbers.length === 0) return problem('#DIV/0!', 'there is nothing to average')
        let total = 0
        for (const value of numbers) total += value
        return total / numbers.length
      }
      if (numbers.length === 0) return 0
      return name === 'MIN' ? Math.min(...numbers) : Math.max(...numbers)
    }
    const ones: Record<string, (x: number) => number> = {
      SQRT: Math.sqrt,
      ABS: Math.abs,
      SIGN: Math.sign,
      EXP: Math.exp,
      LN: Math.log,
      LOG10: Math.log10,
      SIN: Math.sin,
      COS: Math.cos,
      TAN: Math.tan,
      ASIN: Math.asin,
      ACOS: Math.acos,
      ATAN: Math.atan,
      SINH: Math.sinh,
      COSH: Math.cosh,
      TANH: Math.tanh,
      INT: Math.floor
    }
    const one = Object.prototype.hasOwnProperty.call(ones, name) ? ones[name] : null
    if (one) {
      if (given.length !== 1) return problem('#VALUE!', `${name} takes one number`)
      const x = arithmetic(scalar(given[0]))
      if (isExcelError(x)) return x
      const result = one(x)
      return Number.isFinite(result) ? result : problem('#NUM!', `${name} has no value there`)
    }
    if (name === 'LOG' || name === 'ATAN2') {
      if (given.length !== 2) return problem('#VALUE!', `${name} takes two numbers`)
      const a = arithmetic(scalar(given[0]))
      if (isExcelError(a)) return a
      const b = arithmetic(scalar(given[1]))
      if (isExcelError(b)) return b
      const result = name === 'LOG' ? Math.log(a) / Math.log(b) : Math.atan2(b, a)
      return Number.isFinite(result) ? result : problem('#NUM!', `${name} has no value there`)
    }
    return problem('#NAME?', `"${name}" is not a function this formula may use`)
  }

  const answer = expression()
  if (at < tokens.length) return problem('#VALUE!', `the formula has "${tokens[at].text}" left over at the end`)
  return scalar(answer)
}

/** Every cell of a rectangle, read in reading order. Only a single column or a single row is ever emitted. */
function rangeValues(from: string, to: string, cellAt: (address: string) => ExcelValue): ExcelValue[] | ExcelError {
  const a = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(from)
  const b = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(to)
  if (!a || !b) return problem('#VALUE!', 'a range needs a cell at each end')
  const letterNumber = (letters: string): number => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
  const c1 = Math.min(letterNumber(a[1]), letterNumber(b[1]))
  const c2 = Math.max(letterNumber(a[1]), letterNumber(b[1]))
  const r1 = Math.min(Number(a[2]), Number(b[2]))
  const r2 = Math.max(Number(a[2]), Number(b[2]))
  const out: ExcelValue[] = []
  for (let row = r1; row <= r2; row++) {
    for (let column = c1; column <= c2; column++) out.push(cellAt(addressOf(column, row)))
  }
  return out
}

// ---------------------------------------------------------------- is the formula's answer the engine's answer

/**
 * Whether two numbers are the same number as far as a workbook can tell.
 *
 * Excel keeps fifteen significant decimal digits, so two answers that agree to fifteen digits are the same cell
 * contents however they were worked out. Anything coarser would let a real disagreement through; anything finer would
 * refuse a formula over the last bit of a compensated sum, which no reader could ever see.
 */
export const sameNumber = (a: number, b: number): boolean => {
  if (a === b) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return a.toPrecision(15) === b.toPrecision(15)
}

// ---------------------------------------------------------------- the plan a workbook writer follows

export type TotalHow = 'sum' | 'average' | 'count' | 'minimum' | 'maximum'

/** Which total of which column. `count` is how many rows have a number in them. */
export interface TotalRequest {
  column: string
  how: TotalHow
}

export interface FormulaCell {
  /** Where it goes: an A1 address in the written sheet. */
  address: string
  row: number
  column: number
  /** The Excel formula, without the leading `=`. */
  formula: string
  /** The answer Orbis worked out, written into the file as the cached value so every viewer shows a number. */
  value: number | string
  what: 'computed' | 'total'
}

export interface FormulaPlan {
  /** Every cell to write as a formula rather than as a plain value. */
  cells: FormulaCell[]
  /** The totals row, when one was asked for and could be written: the sheet row, and where its label goes. */
  totals: { row: number; label: string; labelColumn: number } | null
  /** Columns written as numbers after all, each with the reason, in the words a person reads. */
  refused: { column: string; why: string }[]
  /** Names of the columns written as live formulas. */
  live: string[]
  /** Plain sentences for the artifact's notes. */
  notes: string[]
}

const EMPTY_PLAN: FormulaPlan = Object.freeze({ cells: [], totals: null, refused: [], live: [], notes: [] })

const NUMERIC: ReadonlySet<Column['type']> = new Set(['number', 'integer', 'quantity'])

const TOTAL_WORDS: Readonly<Record<TotalHow, string>> = Object.freeze({
  sum: 'Total',
  average: 'Average',
  count: 'Count',
  minimum: 'Smallest',
  maximum: 'Largest'
})

const EXCEL_TOTAL: Readonly<Record<TotalHow, string>> = Object.freeze({
  sum: 'SUM',
  average: 'AVERAGE',
  count: 'COUNT',
  minimum: 'MIN',
  maximum: 'MAX'
})

/** The engine's own aggregate behind each total, so the figure in the cell is the figure the engine works out. */
const ENGINE_TOTAL = Object.freeze({
  sum: 'sum',
  average: 'mean',
  count: 'count-values',
  minimum: 'minimum',
  maximum: 'maximum'
} as const)

export interface FormulaOptions {
  /** Turn the engine's computed columns into live formulas. */
  computed?: boolean
  /** A row of totals under the table. */
  totals?: readonly TotalRequest[]
  /** Which row of the sheet the first row of data sits in. The heading is row 1, so this is 2. */
  firstDataRow?: number
}

/**
 * What a workbook writer should write as a formula, having proved each one.
 *
 * Nothing in here writes a file. It names cells, their formulas and the numbers Orbis already worked out, so the
 * writer puts them in and the reader-back can look for exactly those.
 */
export function planFormulas(table: Table, options: FormulaOptions = {}): FormulaPlan {
  const firstDataRow = options.firstDataRow ?? 2
  const wantComputed = options.computed === true
  const wantedTotals = options.totals ?? []
  if (!wantComputed && wantedTotals.length === 0) return EMPTY_PLAN

  const cells: FormulaCell[] = []
  const refused: { column: string; why: string }[] = []
  const live: string[] = []
  const notes: string[] = []
  const rows = table.rows.length
  const lastRow = firstDataRow + rows - 1

  if (table.columns.length > FORMULA_LIMITS.columns) {
    return { ...EMPTY_PLAN, notes: [`The table has more columns than a worksheet has, so nothing was written as a formula.`] }
  }

  /** What the sheet will hold at an address, for the proof. */
  const at = (address: string): ExcelValue => {
    const parsed = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(address)
    if (!parsed) return problem('#VALUE!', `"${address}" is not an address`)
    const column = [...parsed[1]].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
    const row = Number(parsed[2])
    const found = table.columns[column - 1]
    const data = table.rows[row - firstDataRow]
    if (!found || !data) return null
    return asExcelValue(excelSees(data.cells[column - 1] ?? null, found))
  }

  // ---- computed columns
  if (wantComputed) {
    const computedColumns = table.columns.map((column, index) => ({ column, index, formula: computedFormulaOf(column) })).filter((one) => one.formula !== null)
    if (computedColumns.length > 0 && rows > FORMULA_LIMITS.rows) {
      notes.push(
        `The computed columns are written as numbers: Orbis checks every formula it writes against its own answer, and ${rows.toLocaleString('en')} rows is past the ${FORMULA_LIMITS.rows.toLocaleString('en')} it will check.`
      )
    } else if (computedColumns.length > 0 && lastRow > FORMULA_LIMITS.sheetRows) {
      notes.push('The computed columns are written as numbers: the table has more rows than a worksheet has.')
    } else {
      for (const one of computedColumns) {
        const outcome = columnFormulas(table, one.index, one.formula!, firstDataRow, at)
        if (isFormulaRefusal(outcome)) {
          refused.push({ column: one.column.name, why: outcome.message })
          continue
        }
        cells.push(...outcome)
        live.push(one.column.name)
      }
    }
  }

  // ---- the totals row
  let totals: FormulaPlan['totals'] = null
  if (wantedTotals.length > 0) {
    if (rows === 0) {
      notes.push('There is no totals row: the table has no rows to total.')
    } else if (lastRow + 1 > FORMULA_LIMITS.sheetRows) {
      notes.push('There is no totals row: the table already fills the worksheet.')
    } else {
      const row = lastRow + 1
      const done: FormulaCell[] = []
      const totalled: number[] = []
      const hows: TotalHow[] = []
      for (const want of wantedTotals) {
        const index = table.columns.findIndex((column) => column.id === want.column || column.name.toLowerCase() === want.column.trim().toLowerCase() || formulaName(column.name) === formulaName(want.column))
        if (index < 0) {
          refused.push({ column: want.column, why: `there is no column called "${want.column}"` })
          continue
        }
        const column = table.columns[index]
        if (!NUMERIC.has(column.type)) {
          refused.push({ column: column.name, why: `it holds ${column.type === 'date' ? 'dates' : column.type === 'boolean' ? 'yes or no' : 'text'}, so there is no total of it to put in a cell` })
          continue
        }
        const letter = columnLetter(index + 1)
        const formula = `${EXCEL_TOTAL[want.how]}(${letter}${firstDataRow}:${letter}${lastRow})`
        const engine = aggregateCells(
          table.rows.map((one) => one.cells[index] ?? null),
          ENGINE_TOTAL[want.how],
          column
        )
        const expected = asNumber(engine)
        if (expected === null) {
          refused.push({ column: column.name, why: `${TOTAL_WORDS[want.how].toLowerCase()} has no value: the column has no numbers in it` })
          continue
        }
        const got = evaluateExcel(formula, at)
        if (isExcelError(got) || typeof got !== 'number' || !sameNumber(got, expected)) {
          refused.push({
            column: column.name,
            why: isExcelError(got)
              ? `Excel would answer ${got.excel} there (${got.why})`
              : `Excel's ${EXCEL_TOTAL[want.how]} would answer ${String(got)} where Orbis works out ${expected}`
          })
          continue
        }
        done.push({ address: addressOf(index + 1, row), row, column: index + 1, formula, value: expected, what: 'total' })
        totalled.push(index)
        if (!hows.includes(want.how)) hows.push(want.how)
      }
      if (done.length > 0) {
        // The label goes in the first column that has no total of its own. If every column is totalled there is
        // nowhere to put it, and a word over somebody's figures would be worse than no word.
        const labelColumn = table.columns.findIndex((_, index) => !totalled.includes(index)) + 1
        const label = hows.length === 1 ? TOTAL_WORDS[hows[0]] : 'Totals'
        totals = { row, label: labelColumn > 0 ? label : '', labelColumn }
        cells.push(...done)
      }
    }
  }

  if (live.length > 0) {
    notes.push(
      `${live.map((one) => `"${one}"`).join(', ')} ${live.length === 1 ? 'is' : 'are'} written as ${live.length === 1 ? 'a real Excel formula' : 'real Excel formulas'} with the number Orbis worked out already in the cell, so changing a figure in Excel brings ${live.length === 1 ? 'it' : 'them'} up to date.`
    )
  }
  if (totals) notes.push('The row under the table holds real Excel formulas over the rows above it, so it follows anything you change.')
  for (const one of refused) notes.push(`"${one.column}" is written as numbers, not a formula, because ${one.why}.`)

  return { cells, totals, refused, live, notes }
}

/**
 * One computed column as a formula per row, proved against the engine's own answers.
 *
 * Either every row of the column is a formula or none is. A column that is live in most rows and fixed in a few is a
 * column nobody can reason about: the one wrong cell is the one that gets acted on.
 */
function columnFormulas(
  table: Table,
  index: number,
  source: string,
  firstDataRow: number,
  at: (address: string) => ExcelValue
): FormulaCell[] | FormulaRefusal {
  const parsed = parseExpression(source)
  if (isParseError(parsed)) return cannot(`its formula cannot be read back: ${parsed.message}`)

  // The same resolution the `compute` step uses, so the formula points at the columns the numbers were worked out from.
  const inputs: { symbol: string; index: number; column: Column }[] = []
  for (const symbol of variablesOf(parsed)) {
    const found = table.columns.find((one) => one.id === symbol) ?? table.columns.find((one) => formulaName(one.name) === symbol.toLowerCase())
    if (!found) return cannot(`its formula uses "${symbol}", which is no longer a column`)
    const place = columnIndex(table, found.id)
    if (place === index) return cannot('its formula refers to the column itself')
    if (!NUMERIC.has(found.type)) {
      return cannot(`it is worked out from "${found.name}", which holds ${found.type === 'date' ? 'dates' : found.type === 'boolean' ? 'yes or no' : 'text'}, and an Excel formula over that would empty every row`)
    }
    inputs.push({ symbol, index: place, column: found })
  }

  const cells: FormulaCell[] = []
  for (const [position, row] of table.rows.entries()) {
    const sheetRow = firstDataRow + position
    const refs = inputs.map((one) => addressOf(one.index + 1, sheetRow))
    const written = toExcelFormula(parsed, (symbol) => {
      const which = inputs.findIndex((one) => one.symbol === symbol)
      return which < 0 ? cannot(`its formula uses "${symbol}", which is no longer a column`) : refs[which]
    })
    if (isFormulaRefusal(written)) return written
    // A blank is nothing to Orbis and zero to Excel, so the formula only works out when every input really has a number.
    const formula = refs.length === 0 ? written : `IF(COUNT(${refs.join(',')})=${refs.length},${written},"")`
    if (formula.length > FORMULA_LIMITS.formula) return cannot(`its formula comes to ${formula.length.toLocaleString('en')} characters, past the ${FORMULA_LIMITS.formula.toLocaleString('en')} a cell may hold`)

    const made = row.cells[index] ?? null
    const expected = asNumber(made)
    const got = evaluateExcel(formula, at)
    if (expected === null) {
      // Orbis left the cell empty or could not work it out. Excel has to agree, and an error is not agreement.
      if (isInvalid(made)) return cannot(`row ${position + 1} could not be worked out (${made.why}), and Excel would show an error there instead`)
      if (got !== '' && got !== null) {
        return cannot(`row ${position + 1} is empty here and the formula would put ${isExcelError(got) ? got.excel : String(got)} in it`)
      }
      cells.push({ address: addressOf(index + 1, sheetRow), row: sheetRow, column: index + 1, formula, value: '', what: 'computed' })
      continue
    }
    if (isExcelError(got)) return cannot(`Excel would answer ${got.excel} in row ${position + 1} (${got.why})`)
    if (typeof got !== 'number' || !sameNumber(got, expected)) {
      return cannot(`the formula answers ${typeof got === 'number' ? got : `"${String(got)}"`} in row ${position + 1} where Orbis worked out ${expected}`)
    }
    cells.push({ address: addressOf(index + 1, sheetRow), row: sheetRow, column: index + 1, formula, value: expected, what: 'computed' })
  }
  return cells
}

/** Every numeric column totalled, which is what "keep the totals as formulas" means when nobody named a column. */
export function everyTotal(table: Table, how: TotalHow = 'sum'): TotalRequest[] {
  return table.columns.filter((one) => NUMERIC.has(one.type)).map((one) => ({ column: one.id, how }))
}

/** What was written, for the reader-back to look for. */
export interface XlsxFormulas {
  cells: readonly FormulaCell[]
  /** The sheet row the totals are on, when there is one. */
  totalsRow: number | null
}
