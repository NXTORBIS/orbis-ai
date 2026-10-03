import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited, type Table } from '../compute/data.ts'
import { parseExpression, isParseError } from '../compute/expression.ts'
import { applySteps, isTransformFailure } from './transform.ts'
import { addressOf, columnLetter, computedFormulaOf, evaluateExcel, everyTotal, isExcelError, isFormulaRefusal, planFormulas, sameNumber, toExcelFormula } from './formula.ts'

/*
 * Every formula here is checked the way the engine checks one: emitted, then worked out again by the evaluator in
 * formula.ts over the cells the sheet will hold, and compared with the number the table engine already computed. The
 * tests that matter most are the refusals -- the places Excel and Orbis disagree, where a plausible formula would be
 * wrong in a way nobody would notice.
 */

const tableFrom = (text: string): Table => {
  const parsed = parseDelimited(text)
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

const base = () => tableFrom('site,qty,price\nHQ,2,3.5\nDepot,4,2\nYard,3,1.25\n')

const withComputed = (formula: string, name = 'total', from: Table = base()): Table => {
  const result = applySteps(from, [{ op: 'compute', name, formula }])
  if (isTransformFailure(result)) throw new Error(result.message)
  return result.table
}

const expression = (source: string) => {
  const parsed = parseExpression(source)
  if (isParseError(parsed)) throw new Error(parsed.message)
  return parsed
}

/** A refOf that gives every symbol the same cell, for testing the printer on its own. */
const toA2 = () => 'A2'

// ---------------------------------------------------------------- addresses

test('a column letter is right past Z, and past ZZ', () => {
  assert.equal(columnLetter(1), 'A')
  assert.equal(columnLetter(26), 'Z')
  assert.equal(columnLetter(27), 'AA')
  assert.equal(columnLetter(52), 'AZ')
  assert.equal(columnLetter(53), 'BA')
  assert.equal(columnLetter(702), 'ZZ')
  assert.equal(columnLetter(703), 'AAA')
  assert.equal(columnLetter(16_384), 'XFD')
  assert.equal(addressOf(28, 100), 'AB100')
})

// ---------------------------------------------------------------- the printer

test('the arithmetic Orbis and Excel agree about is printed with brackets rather than precedence', () => {
  assert.equal(toExcelFormula(expression('1 + 2 * 3'), toA2), '1+(2*3)')
  assert.equal(toExcelFormula(expression('(1 + 2) * 3'), toA2), '(1+2)*3')
  // Orbis reads -2^2 as -(2^2); Excel reads =-2^2 as 4. The brackets are what keeps them the same.
  assert.equal(toExcelFormula(expression('-2^2'), toA2), '-(2^2)')
  assert.equal(toExcelFormula(expression('a - (b - c)'), () => 'A2'), 'A2-(A2-A2)')
})

test('the functions with an exact Excel form are printed, including the two that are not what they look like', () => {
  assert.equal(toExcelFormula(expression('sqrt(x)'), toA2), 'SQRT(A2)')
  assert.equal(toExcelFormula(expression('log(x)'), toA2), 'LOG10(A2)')
  assert.equal(toExcelFormula(expression('log(x, 3)'), toA2), 'LOG(A2,3)')
  assert.equal(toExcelFormula(expression('log2(x)'), toA2), 'LOG(A2,2)')
  assert.equal(toExcelFormula(expression('floor(x)'), toA2), 'INT(A2)')
  // round and ceil cannot be ROUND and CEILING: one rounds a half the other way, the other needs a function
  // Excel would have to be asked for by its new name.
  assert.equal(toExcelFormula(expression('round(x)'), toA2), 'INT((A2)+0.5)')
  assert.equal(toExcelFormula(expression('ceil(x)'), toA2), '(-INT(-(A2)))')
  // Excel's ATAN2 takes the across coordinate first.
  assert.equal(toExcelFormula(expression('atan2(y, x)'), (name) => (name === 'y' ? 'B2' : 'C2')), 'ATAN2(C2,B2)')
})

test('a constant is printed only when Excel has the very same number for it', () => {
  assert.equal(toExcelFormula(expression('pi'), toA2), 'PI()')
  assert.equal(toExcelFormula(expression('tau'), toA2), '(2*PI())')
  assert.equal(toExcelFormula(expression('phi'), toA2), '((1+SQRT(5))/2)')
  const refused = toExcelFormula(expression('e * 2'), toA2)
  assert.ok(isFormulaRefusal(refused))
  assert.match(refused.message, /same number/)
})

test('everything with no exact Excel form is refused by name, never approximated', () => {
  for (const [source, says] of [
    ['a % b', /remainder/],
    ['round(a, 2)', /the other way/],
    ['cbrt(a)', /cube root/],
    ['hypot(a, b)', /hypot/]
  ] as const) {
    const refused = toExcelFormula(expression(source), toA2)
    assert.ok(isFormulaRefusal(refused), `${source} should be refused`)
    assert.match(refused.message, says)
  }
})

// ---------------------------------------------------------------- the evaluator

test('the evaluator works out the subset the printer emits, Excel style', () => {
  const sheet: Record<string, number | string | null> = { A2: 2, B2: 3.5, C2: null, D2: 'words' }
  const at = (address: string) => sheet[address] ?? null
  assert.equal(evaluateExcel('A2*B2', at), 7)
  assert.equal(evaluateExcel('INT((B2)+0.5)', at), 4)
  assert.equal(evaluateExcel('(-INT(-(B2)))', at), 4)
  assert.equal(evaluateExcel('SQRT(16)', at), 4)
  assert.equal(evaluateExcel('PI()', at), Math.PI)
  assert.equal(evaluateExcel('MIN(A2,B2)', at), 2)
  // A blank is zero to Excel, which is exactly why the guard exists.
  assert.equal(evaluateExcel('A2+C2', at), 2)
  assert.equal(evaluateExcel('COUNT(A2,C2)', at), 1)
  assert.equal(evaluateExcel('IF(COUNT(A2,C2)=2,A2*C2,"")', at), '')
  assert.equal(evaluateExcel('IF(COUNT(A2,B2)=2,A2*B2,"")', at), 7)
})

test('the evaluator answers an Excel error rather than a number it cannot justify', () => {
  const at = () => null
  const divided = evaluateExcel('1/0', at)
  assert.ok(isExcelError(divided) && divided.excel === '#DIV/0!')
  const unknown = evaluateExcel('CEILING.MATH(1.2)', at)
  assert.ok(isExcelError(unknown) && unknown.excel === '#NAME?')
  const leftover = evaluateExcel('1+2)', at)
  assert.ok(isExcelError(leftover))
  assert.ok(isExcelError(evaluateExcel('SUM(A2:B3)*2', (address) => (address === 'A2' ? 'text' : 1))) === false)
})

test('a range is read cell by cell, and only the numbers count', () => {
  const sheet: Record<string, number | string | null> = { B2: 10, B3: 20, B4: null, B5: 'n/a' }
  const at = (address: string) => sheet[address] ?? null
  assert.equal(evaluateExcel('SUM(B2:B5)', at), 30)
  assert.equal(evaluateExcel('COUNT(B2:B5)', at), 2)
  assert.equal(evaluateExcel('AVERAGE(B2:B5)', at), 15)
  assert.equal(evaluateExcel('MAX(B2:B5)', at), 20)
})

test('two numbers are the same number when a workbook could not tell them apart', () => {
  assert.equal(sameNumber(1, 1), true)
  assert.equal(sameNumber(0.1 + 0.2, 0.3), true, 'fifteen digits is all Excel keeps')
  assert.equal(sameNumber(1, 1.000001), false)
  assert.equal(sameNumber(Number.NaN, Number.NaN), false)
})

// ---------------------------------------------------------------- the plan

test('a table with no computed columns and no totals asked for is left exactly as it was', () => {
  const plan = planFormulas(base(), { computed: true })
  assert.deepEqual(plan.cells, [])
  assert.equal(plan.totals, null)
  assert.deepEqual(plan.notes, [])
  assert.deepEqual(planFormulas(base()), planFormulas(base(), {}))
})

test('a computed column is a formula per row, pointing at the right cells, with the number Orbis worked out', () => {
  const table = withComputed('qty * price')
  assert.equal(computedFormulaOf(table.columns[3]), 'qty * price')
  const plan = planFormulas(table, { computed: true })
  assert.deepEqual(plan.live, ['total'])
  assert.deepEqual(plan.refused, [])
  assert.deepEqual(
    plan.cells.map((one) => [one.address, one.formula, one.value]),
    [
      ['D2', 'IF(COUNT(B2,C2)=2,B2*C2,"")', 7],
      ['D3', 'IF(COUNT(B3,C3)=2,B3*C3,"")', 8],
      ['D4', 'IF(COUNT(B4,C4)=2,B4*C4,"")', 3.75]
    ]
  )
  assert.match(plan.notes[0], /real Excel formula/)
})

test('a row whose inputs are empty is written as a formula whose answer is empty, which is what Orbis shows', () => {
  const table = withComputed('qty * price', 'total', tableFrom('site,qty,price\nHQ,2,3.5\nDepot,,2\n'))
  const plan = planFormulas(table, { computed: true })
  assert.deepEqual(plan.refused, [])
  assert.deepEqual(
    plan.cells.map((one) => [one.address, one.value]),
    [
      ['D2', 7],
      ['D3', '']
    ]
  )
})

test('a formula worked out from a column of text is refused: an Excel formula over it would empty every row', () => {
  const table = withComputed('qty * 2', 'doubled')
  const broken: Table = { ...table, columns: table.columns.map((one) => (one.name === 'qty' ? { ...one, type: 'text' as const } : one)) }
  const plan = planFormulas(broken, { computed: true })
  assert.deepEqual(plan.live, [])
  assert.equal(plan.refused.length, 1)
  assert.match(plan.refused[0].why, /holds text/)
  assert.match(plan.notes[0], /"doubled" is written as numbers, not a formula, because/)
})

test('a column the engine could not work out in one row is written as numbers, with the row named', () => {
  const table = withComputed('qty / price', 'rate', tableFrom('site,qty,price\nHQ,2,3.5\nDepot,4,0\n'))
  const plan = planFormulas(table, { computed: true })
  assert.deepEqual(plan.live, [])
  assert.match(plan.refused[0].why, /row 2/)
})

test('a formula using "%" leaves the column as numbers and says why in words a person reads', () => {
  const table = withComputed('qty % 2', 'odd')
  const plan = planFormulas(table, { computed: true })
  assert.deepEqual(plan.live, [])
  assert.match(plan.refused[0].why, /remainder/)
})

test('a chain of computed columns is live all the way down', () => {
  const first = withComputed('qty * price', 'total')
  const second = withComputed('total * 2', 'doubled', first)
  const plan = planFormulas(second, { computed: true })
  assert.deepEqual(plan.live, ['total', 'doubled'])
  assert.equal(plan.cells.find((one) => one.address === 'E2')?.formula, 'IF(COUNT(D2)=1,D2*2,"")')
  assert.equal(plan.cells.find((one) => one.address === 'E2')?.value, 14)
})

// ---------------------------------------------------------------- the totals row

test('a totals row is real formulas over the rows above it, each proved against the engine', () => {
  const plan = planFormulas(base(), { totals: [{ column: 'qty', how: 'sum' }, { column: 'price', how: 'average' }] })
  assert.deepEqual(plan.totals, { row: 5, label: 'Totals', labelColumn: 1 })
  assert.deepEqual(
    plan.cells.map((one) => [one.address, one.formula, one.value]),
    [
      ['B5', 'SUM(B2:B4)', 9],
      ['C5', 'AVERAGE(C2:C4)', 6.75 / 3]
    ]
  )
  assert.ok(plan.cells.every((one) => one.what === 'total'))
})

test('every sort of total has the Excel function that gives the engine the same answer', () => {
  const plan = planFormulas(base(), {
    totals: [
      { column: 'qty', how: 'count' },
      { column: 'qty', how: 'minimum' },
      { column: 'qty', how: 'maximum' }
    ]
  })
  assert.deepEqual(
    plan.cells.map((one) => [one.formula, one.value]),
    [
      ['COUNT(B2:B4)', 3],
      ['MIN(B2:B4)', 2],
      ['MAX(B2:B4)', 4]
    ]
  )
  assert.equal(plan.totals?.label, 'Totals')
})

test('a totals row of one kind is named for that kind', () => {
  const plan = planFormulas(base(), { totals: everyTotal(base()) })
  assert.equal(plan.totals?.label, 'Total')
  assert.deepEqual(plan.cells.map((one) => one.formula), ['SUM(B2:B4)', 'SUM(C2:C4)'])
})

test('a total of a column of text, or of a column that is not there, is refused by name', () => {
  const plan = planFormulas(base(), { totals: [{ column: 'site', how: 'sum' }, { column: 'nothing', how: 'sum' }] })
  assert.equal(plan.totals, null)
  assert.deepEqual(plan.refused.map((one) => one.column), ['site', 'nothing'])
  assert.match(plan.refused[0].why, /text/)
  assert.match(plan.refused[1].why, /no column called/)
})

test('a table with no rows gets no totals row and says so', () => {
  const plan = planFormulas({ ...base(), rows: [] }, { totals: everyTotal(base()) })
  assert.equal(plan.totals, null)
  assert.deepEqual(plan.cells, [])
  assert.match(plan.notes[0], /no rows to total/)
})

test('the same table gives the same plan every time', () => {
  const table = withComputed('qty * price')
  assert.deepEqual(planFormulas(table, { computed: true, totals: everyTotal(table) }), planFormulas(table, { computed: true, totals: everyTotal(table) }))
})
