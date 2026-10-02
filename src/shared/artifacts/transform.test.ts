import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asNumber, isDataError, isInvalid, isMissing, parseDelimited, type Table } from '../compute/data.ts'
import { applySteps, formulaName, isTransformFailure, readSteps, stepInstructions, type TransformStep } from './transform.ts'

const READINGS = `date,site,Consumption (MWh),solar
2026-10-01,HQ,412,96
2026-10-02,Depot,288,12
2026-10-03,Warehouse,530,140
2026-10-04,HQ,415,99
2026-10-05,Depot,290,
2026-10-06,Warehouse,525,0
`

const table = (): Table => {
  const parsed = parseDelimited(READINGS)
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

const run = (steps: TransformStep[]) => {
  const out = applySteps(table(), steps)
  if (isTransformFailure(out)) throw new Error(`step ${out.step}: ${out.message}`)
  return out
}

const column = (t: Table, name: string): unknown[] => {
  const at = t.columns.findIndex((one) => one.name === name)
  assert.ok(at >= 0, `no column ${name} in ${t.columns.map((one) => one.name).join(', ')}`)
  return t.rows.map((row) => row.cells[at])
}

test('steps are read deny-by-default, and every fault is named with where it is', () => {
  assert.deepEqual(readSteps('sort it').problems, ['"steps" has to be a list of steps.'])
  assert.deepEqual(readSteps({ steps: [] }).problems, ['There are no steps: nothing would change.'])
  const bad = readSteps({
    steps: [
      { op: 'explode' },
      { op: 'sort' },
      { op: 'filter', where: [{ column: 'site', is: 'resembles', value: 'HQ' }, { column: 'solar', is: 'greater' }, { column: 'solar', is: 'between', value: 1 }, { is: 'equals', value: 1 }] },
      { op: 'compute', name: 'x', formula: '2 +* 3' },
      { op: 'group', by: ['site'], totals: [{ column: 'solar', how: 'average' }] },
      { op: 'limit', rows: 0 },
      'nope'
    ]
  })
  const said = bad.problems.join(' | ')
  assert.match(said, /steps\[0\] has "op": "explode", which is not one of: sort, filter, keep, drop, rename, compute, group, limit/)
  assert.match(said, /steps\[1\] \(sort\) needs "by"/)
  assert.match(said, /steps\[2\]\.where\[0\] has "is": "resembles"/)
  assert.match(said, /steps\[2\]\.where\[1\] \("solar" greater\) has no value/)
  assert.match(said, /steps\[2\]\.where\[2\] \("solar" between\) needs "value" and "value2"/)
  assert.match(said, /steps\[2\]\.where\[3\] has no column/)
  assert.match(said, /steps\[3\] \(compute "x"\) has a formula that cannot be read/)
  assert.match(said, /steps\[4\]\.totals\[0\] has "how": "average"/)
  assert.match(said, /steps\[5\] \(limit\) needs "rows"/)
  assert.match(said, /steps\[6\] is not a step/)
  assert.equal(bad.steps.length, 0)

  const good = readSteps([{ op: 'sort', by: ['site', { column: 'solar', descending: true }] }, { op: 'group', by: 'site' }])
  assert.deepEqual(good.problems, [])
  assert.deepEqual(good.steps[0], { op: 'sort', by: [{ column: 'site', descending: false }, { column: 'solar', descending: true }] })
  assert.deepEqual(good.steps[1], { op: 'group', by: ['site'], totals: [{ column: '', how: 'count', as: 'rows' }] })
})

test('a filter says how many rows it kept, and a filter that matches nothing says so instead of handing back silence', () => {
  const hq = run([{ op: 'filter', match: 'all', where: [{ column: 'site', is: 'equals', value: 'hq' }] }])
  assert.equal(hq.table.rows.length, 2)
  assert.equal(hq.notes[0], 'Kept 2 of 6 rows where site is "hq".')
  assert.deepEqual(hq.table.rows.map((row) => row.id), [1, 4], 'a kept row is still the same row')

  const either = run([{ op: 'filter', match: 'any', where: [{ column: 'solar', is: 'greater', value: 100 }, { column: 'solar', is: 'is-empty' }] }])
  assert.equal(either.table.rows.length, 2)
  assert.match(either.notes[0], /Kept 2 of 6 rows where solar is more than 100 or solar is empty\./)

  const none = run([{ op: 'filter', match: 'all', where: [{ column: 'site', is: 'equals', value: 'Moon' }] }])
  assert.equal(none.table.rows.length, 0)
  assert.equal(none.table.columns.length, 4)
  assert.match(none.notes[0], /^No row matched: site is "Moon"\./)
})

test('sorting is by type, says which way in the words of the type, and a top-N is a sort and a limit', () => {
  const out = run([{ op: 'sort', by: [{ column: 'consumption (mwh)', descending: true }] }, { op: 'limit', rows: 2 }])
  assert.deepEqual(column(out.table, 'Consumption (MWh)').map((cell) => asNumber(cell as never)), [530, 525])
  assert.equal(out.notes[0], 'Sorted by Consumption (MWh) (largest first). Rows with no value sort last.')
  assert.equal(out.notes[1], 'Kept the first 2 of 6 rows.')
  const dated = run([{ op: 'sort', by: [{ column: 'date', descending: true }] }, { op: 'limit', rows: 50 }])
  assert.match(dated.notes[0], /date \(newest first\)/)
  assert.match(dated.notes[1], /there are only 6, so all were kept/)
})

test('a computed column is worked out per row by the expression engine, and every row it could not do is counted with why', () => {
  assert.equal(formulaName('Consumption (MWh)'), 'consumption_mwh')
  const out = run([{ op: 'compute', name: 'Solar share', formula: 'solar / consumption_mwh * 100' }])
  const share = column(out.table, 'Solar share')
  assert.ok(Math.abs((asNumber(share[0] as never) ?? 0) - (96 / 412) * 100) < 1e-9)
  assert.ok(isMissing(share[4] as never), 'a row with no solar value has no share, not zero')
  assert.equal(asNumber(share[5] as never), 0)
  assert.equal(out.notes[0], '"Solar share" = solar / consumption_mwh * 100: computed for 5 of 6 rows; 1 row left empty because an input had no number. Units are not carried through a formula: Consumption (MWh) is in MWh, and the result is a plain number.')
  const made = out.table.columns[4]
  assert.equal(made.id, 'solar_share')
  assert.equal(made.type, 'number')
  assert.match(made.reason, /Computed by Orbis/)

  // Dividing by a zero is a reason in the cell, not Infinity and not a blank.
  const ratio = run([{ op: 'compute', name: 'ratio', formula: 'consumption_mwh / solar' }])
  const cells = column(ratio.table, 'ratio')
  assert.ok(isInvalid(cells[5] as never))
  assert.match(ratio.notes[0], /computed for 4 of 6 rows; 1 row left empty because an input had no number; 1 row could not be worked out \(/)
})

test('a formula that names something that is not a column is refused with the names it could have used', () => {
  const out = applySteps(table(), [{ op: 'compute', name: 'x', formula: 'solar + wind' }])
  assert.ok(isTransformFailure(out))
  if (!isTransformFailure(out)) return
  assert.equal(out.step, 1)
  assert.match(out.message, /uses "wind", which is not a column\. In a formula the columns are written: date, site, consumption_mwh, solar\./)
  const twice = applySteps(table(), [{ op: 'compute', name: 'SOLAR', formula: 'solar * 2' }])
  assert.ok(isTransformFailure(twice) && /already a column called "SOLAR"/.test(twice.message))
})

test('grouping totals through the statistics engine and names what it made; a later step can use those names', () => {
  const out = run([
    { op: 'group', by: ['site'], totals: [{ column: 'Consumption (MWh)', how: 'sum', as: '' }, { column: 'solar', how: 'mean', as: 'average solar' }, { column: '', how: 'count', as: '' }] },
    { op: 'sort', by: [{ column: 'sum of Consumption (MWh)', descending: true }] }
  ])
  assert.deepEqual(out.table.columns.map((one) => one.name), ['site', 'sum of Consumption (MWh)', 'average solar', 'rows'])
  assert.deepEqual(column(out.table, 'site'), ['Warehouse', 'HQ', 'Depot'])
  assert.deepEqual(column(out.table, 'sum of Consumption (MWh)').map((cell) => asNumber(cell as never)), [1055, 827, 578])
  const summed = out.table.columns[1]
  assert.equal(summed.type, 'quantity', 'a sum of megawatt-hours is still megawatt-hours')
  assert.equal(summed.unit?.display, 'MWh')
  assert.deepEqual(column(out.table, 'rows'), [2, 2, 2])
  assert.equal(asNumber(column(out.table, 'average solar')[2] as never), 12, 'the mean of the one value there is, not of a blank counted as zero')
  assert.equal(out.notes[0], 'Grouped 6 rows by site into 3 groups, with: sum of Consumption (MWh), average solar, rows.')

  const words = applySteps(table(), [{ op: 'group', by: ['date'], totals: [{ column: 'site', how: 'sum', as: '' }] }])
  assert.ok(isTransformFailure(words) && /"site" is (text|category), not numbers, so there is no sum of it/.test(words.message))
})

test('columns are kept, dropped and renamed by name, and the first step that cannot run stops the rest and says which', () => {
  const out = run([
    { op: 'keep', columns: ['site', 'solar', 'date'] },
    { op: 'rename', column: 'solar', to: 'Solar (MWh)' },
    { op: 'drop', columns: ['date'] }
  ])
  assert.deepEqual(out.table.columns.map((one) => one.name), ['site', 'Solar (MWh)'])
  assert.deepEqual(out.notes, ['Kept 3 columns: site, solar, date.', 'Renamed "solar" to "Solar (MWh)".', 'Removed 1 column: date.'])

  const stopped = applySteps(table(), [{ op: 'keep', columns: ['site'] }, { op: 'sort', by: [{ column: 'solar', descending: false }] }, { op: 'limit', rows: 1 }])
  assert.ok(isTransformFailure(stopped))
  if (!isTransformFailure(stopped)) return
  assert.equal(stopped.step, 2)
  assert.equal(stopped.op, 'sort')
  assert.match(stopped.message, /no column called "solar"\. The columns are: site\./)

  const last = applySteps(table(), [{ op: 'keep', columns: ['site'] }, { op: 'drop', columns: ['site'] }])
  assert.ok(isTransformFailure(last) && /would leave a table with no columns/.test(last.message))
  const clash = applySteps(table(), [{ op: 'rename', column: 'solar', to: 'Site' }])
  assert.ok(isTransformFailure(clash) && /already a column called "site"/.test(clash.message))
})

test('the model is told the columns and how to write them in a formula, and is shown none of the data', () => {
  const said = stepInstructions(table().columns)
  assert.ok(said.includes('Consumption (MWh): quantity'))
  assert.ok(said.includes('Consumption (MWh) -> consumption_mwh'))
  assert.equal(said.includes('412'), false)
  assert.equal(said.includes('Warehouse'), false)
})
