import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calloutOf, rehypeCallouts } from './chatCallout.ts'
import { parseCell, tableChart } from './chatTableChart.ts'
import { plotToSvg } from './artifacts/svg.ts'

test('callout labels: the GitHub form, the plain word, and prose that only starts with a word', () => {
  assert.equal(calloutOf('[!WARNING] Back up first')?.kind, 'warning')
  assert.equal(calloutOf('[!tip]\nTry it')?.kind, 'tip')
  assert.equal(calloutOf('Note: this is slow')?.kind, 'note')
  assert.equal(calloutOf('Heads up – it restarts')?.kind, 'warning')
  assert.equal(calloutOf('Note that this is slow'), null)
  assert.equal(calloutOf('Notes: x'), null)
  assert.equal(calloutOf('A quote about warning: x'), null)
})

const text = (value: string) => ({ type: 'text', value })
const el = (tagName: string, children: unknown[], properties: Record<string, unknown> = {}) => ({ type: 'element', tagName, properties, children })

test('the plugin marks a real quote, strips the label, and leaves ordinary quotes and bold labels right', () => {
  const plain = el('blockquote', [text('\n'), el('p', [text('Warning: this deletes the file')])])
  rehypeCallouts()({ type: 'root', children: [plain as never] })
  const props = (plain as { properties: Record<string, unknown> }).properties
  assert.deepEqual(props.className, ['callout', 'callout-warning'])
  assert.equal(props['data-callout'], 'Warning')
  assert.equal((plain.children[1] as { children: { value: string }[] }).children[0].value, 'this deletes the file')

  const bold = el('blockquote', [el('p', [el('strong', [text('Note:')]), text(' it is slow')])])
  rehypeCallouts()({ type: 'root', children: [bold as never] })
  assert.deepEqual((bold.properties as Record<string, unknown>).className, ['callout', 'callout-note'])
  const p = bold.children[0] as { children: { type: string; value?: string }[] }
  assert.equal(p.children.length, 1)
  assert.equal(p.children[0].value, 'it is slow')

  const ordinary = el('blockquote', [el('p', [text('Note that quotes stay quotes')])])
  rehypeCallouts()({ type: 'root', children: [ordinary as never] })
  assert.equal((ordinary.properties as Record<string, unknown>).className, undefined)
})

test('cells: currency, thousands, percent, units, negatives and gaps', () => {
  assert.deepEqual(parseCell('$1,234.50'), { value: 1234.5, unit: '$' })
  assert.deepEqual(parseCell('45%'), { value: 45, unit: '%' })
  assert.deepEqual(parseCell('12 ms'), { value: 12, unit: 'ms' })
  assert.deepEqual(parseCell('(3.2)'), { value: -3.2, unit: '' })
  assert.deepEqual(parseCell('**7**'), { value: 7, unit: '' })
  assert.equal(parseCell('n/a'), null)
  assert.equal(parseCell('—'), null)
  assert.equal(parseCell('Fast'), null)
  assert.equal(parseCell('v2 beta'), null)
})

test('a table of numbers becomes a chart; a table of words does not', () => {
  const c = tableChart(['Model', 'Latency (ms)', 'Cost'], [['A', '120 ms', '$3'], ['B', '95 ms', '$5'], ['C', '210 ms', '$1']])
  assert.ok(c)
  assert.equal(c.kind, 'bar')
  assert.deepEqual(c.columns, ['Latency (ms)'])
  assert.ok(c.notes.some((n) => /different unit/.test(n)))
  const svg = plotToSvg(c.plot, { width: 600, height: 300 }).svg
  assert.match(svg, /<svg/)
  assert.ok(svg.includes('Latency (ms) by Model'))

  assert.equal(tableChart(['Feature', 'What it does'], [['File operations', 'Read, write'], ['Text', 'Summarize'], ['Code', 'Generate']]), null)
  assert.equal(tableChart(['A', 'B'], [['x', '1'], ['y', '2']]), null)
})

test('years go on a line, gaps are gaps, and a column that is mostly text is not a series', () => {
  const c = tableChart(['Year', 'Revenue'], [['2021', '10'], ['2022', '14'], ['2023', 'n/a'], ['2024', '20']])
  assert.ok(c)
  assert.equal(c.kind, 'line')
  const pts = c.plot.series[0].segments.flatMap((s) => [...s.points])
  assert.equal(pts.length, 3)

  const mixed = tableChart(['Name', 'Score', 'Comment'], [['a', '1', 'good 1'], ['b', '2', 'ok'], ['c', '3', 'bad 2']])
  assert.deepEqual(mixed?.columns, ['Score'])
})
