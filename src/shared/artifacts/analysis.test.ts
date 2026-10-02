import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDataError, parseDelimited } from '../compute/data.ts'
import { checkFinding } from '../pages/analyzer.ts'
import { analyseTable, analysisDocument, num } from './analysis.ts'

const table = (csv: string) => {
  const parsed = parseDelimited(csv)
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

// Twelve rows: x and y move together exactly, z is constant, note is half empty, and the last row repeats the first.
const CSV = [
  'x,y,z,note',
  '1,2,7,a',
  '2,4,7,',
  '3,6,7,b',
  '4,8,7,',
  '5,10,7,c',
  '6,12,7,',
  '7,14,7,d',
  '8,16,7,',
  '9,18,7,e',
  '10,20,7,',
  '11,22,7,f',
  '1,2,7,a'
].join('\n')

test('every finding carries evidence, and the measured things are found', () => {
  const analysis = analyseTable(table(CSV))
  assert.ok(analysis.findings.length >= 5)
  for (const one of analysis.findings) assert.ok(checkFinding(one).ok, `${one.id} ${one.type} has no evidence`)
  const types = analysis.findings.map((one) => one.type)
  assert.ok(types.includes('duplicate-rows'))
  assert.ok(types.includes('correlation'))
  assert.ok(types.some((one) => one.startsWith('quality-')))
  assert.equal(analysis.correlations.length, 1)
  assert.equal(analysis.correlations[0].a, 'x')
  assert.equal(analysis.correlations[0].b, 'y')
  assert.ok(Math.abs(analysis.correlations[0].r - 1) < 1e-9)
  assert.ok(analysis.headlines.some((one) => /move together/.test(one)))
  assert.ok(analysis.headlines.some((one) => /identical to an earlier row/.test(one)))
})

test('the constant column and the half-empty column are named in the quality findings', () => {
  const analysis = analyseTable(table(CSV))
  const kinds = analysis.quality.issues.map((one) => `${one.kind}:${one.column}`)
  assert.ok(kinds.includes('constant:z'), kinds.join(', '))
  assert.ok(kinds.includes('missing:note'), kinds.join(', '))
})

test('the write-up is a real document with the numbers in it, and says they were computed', () => {
  const analysis = analyseTable(table(CSV))
  const doc = analysisDocument(analysis, 'Pairs')
  assert.equal(doc.metadata.title, 'Analysis of Pairs')
  assert.match(doc.metadata.source, /Computed by Orbis/)
  const headings = doc.blocks.filter((one) => one.kind === 'heading').map((one) => (one.kind === 'heading' ? one.content.map((r) => ('text' in r ? r.text : '')).join('') : ''))
  assert.deepEqual(headings.slice(0, 3), ['Analysis of Pairs', 'In short', 'Columns'])
  assert.ok(headings.includes('Numbers'))
  assert.ok(headings.includes('Relationships'))
  assert.ok(headings.includes('How this was worked out'))
  const tables = doc.blocks.filter((one) => one.kind === 'table')
  assert.ok(tables.length >= 3)
  // The mean of x over twelve rows (1..11 plus a repeated 1) is 67/12 = 5.583.
  const numbers = tables[1]
  if (numbers.kind !== 'table') throw new Error('no numbers table')
  const xRow = numbers.rows[1].map((c) => c.content.map((r) => ('text' in r ? r.text : '')).join(''))
  assert.equal(xRow[0], 'x')
  assert.equal(xRow[2], '5.583')
})

test('a table with nothing wrong says so, rather than saying nothing', () => {
  const analysis = analyseTable(table('a,b\n1,x\n2,y\n3,z\n'))
  assert.equal(analysis.quality.issues.length, 0)
  const doc = analysisDocument(analysis, 'Clean')
  const texts = doc.blocks.filter((one) => one.kind === 'paragraph').map((one) => (one.kind === 'paragraph' ? one.content.map((r) => ('text' in r ? r.text : '')).join('') : ''))
  assert.ok(texts.some((one) => /Nothing out of the ordinary was found/.test(one)))
})

test('numbers are written for a person', () => {
  assert.equal(num(5), '5')
  assert.equal(num(5.5), '5.5')
  assert.equal(num(1234567), '1,234,567')
  assert.equal(num(3.14159265), '3.142')
  assert.equal(num(0.00001234), '1.234e-5')
  assert.equal(num(Number.NaN), '—')
})
