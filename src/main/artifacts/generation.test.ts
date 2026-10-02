import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArtifactGeneration, instructions, type Asked } from './generation.ts'

/*
 * The model is a stand-in that answers from a script; everything after the answer -- validation, the retry with the
 * complaint, building the table, parsing the document -- is the real code.
 */

const withAnswers = (answers: (Record<string, unknown> | { failed: string })[]): { generation: ArtifactGeneration; asked: string[] } => {
  const asked: string[] = []
  const generation = new ArtifactGeneration({
    apiKeys: async () => ['k'],
    fetchFn: async () => {
      throw new Error('not used')
    },
    ask: async (_system, user): Promise<Asked> => {
      asked.push(user)
      const next = answers.shift()
      if (!next) return { failed: 'the script ran out' }
      return 'failed' in next ? (next as { failed: string }) : { json: next }
    }
  })
  return { generation, asked }
}

test('the instructions name every kind from the table and nothing else', () => {
  const text = instructions()
  assert.ok(text.includes('"table"'))
  assert.ok(text.includes('"document"'))
  assert.ok(text.includes('csv, xlsx, tsv, json, ndjson, markdown, text'))
  assert.ok(text.includes('markdown, html, pdf, docx, pptx, text'))
  assert.equal(text.includes('spreadsheet'), false)
})

test('a table proposal becomes a real typed table, with the columns noted as a model choice', async () => {
  const { generation } = withAnswers([
    { kind: 'table', title: 'Monthly expenses', purpose: 'Track spending', columns: [{ name: 'Date', type: 'date' }, { name: 'Category', type: 'category' }, { name: 'Amount', type: 'number' }] }
  ])
  const out = await generation.generate('make me a monthly expense tracker')
  assert.ok(out.body && out.body.kind === 'table')
  if (!out.body || out.body.kind !== 'table') throw new Error('no table')
  assert.deepEqual(out.body.table.columns.map((one) => `${one.name}:${one.type}`), ['Date:date', 'Category:category', 'Amount:number'])
  assert.equal(out.body.table.rows.length, 0)
  assert.equal(out.intent?.title, 'Monthly expenses')
  assert.ok(out.body.table.source.startsWith('Orion, asked for: make me'))
  assert.ok(out.notes.some((one) => /chosen by a model/.test(one)))
  assert.equal(out.notes.some((one) => /examples/.test(one)), false)
})

test('example rows are kept and labelled as examples, twice over', async () => {
  const { generation } = withAnswers([{ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] }])
  const out = await generation.generate('a table with an example row')
  assert.equal(out.body?.kind, 'table')
  assert.ok(out.notes.some((one) => /examples written by a model/.test(one)))
  assert.ok(out.notes.some((one) => /1 example row was written by a model/.test(one)))
})

test('a document proposal is parsed by the same parser pasted Markdown goes through', async () => {
  const { generation } = withAnswers([{ kind: 'document', title: 'Study plan', markdown: '# Study plan\n\n## Week 1\n\n- Read chapter 1\n- Do the exercises\n' }])
  const out = await generation.generate('a two week study plan')
  assert.ok(out.body && out.body.kind === 'document')
  if (!out.body || out.body.kind !== 'document') throw new Error('no document')
  assert.equal(out.body.document.blocks.length, 3)
  assert.equal(out.body.document.metadata.title, 'Study plan')
  assert.ok(out.notes.some((one) => /written by a model/.test(one)))
})

test('a bad answer is argued with once, and the complaint names the real fault', async () => {
  const { generation, asked } = withAnswers([
    { kind: 'table', title: 'T', columns: [{ name: 'Amount', type: 'money' }] },
    { kind: 'table', title: 'T', columns: [{ name: 'Amount', type: 'number' }] }
  ])
  const out = await generation.generate('x')
  assert.equal(out.body?.kind, 'table')
  assert.equal(asked.length, 2)
  assert.match(asked[1], /What was wrong:\n- columns\[0\] \("Amount"\) has type "money"/)
  assert.equal(out.attempts.length, 2)
})

test('two bad answers end with the problems named, not a third try', async () => {
  const { generation, asked } = withAnswers([{ kind: 'spreadsheet' }, { kind: 'table', title: 'T' }])
  const out = await generation.generate('x')
  assert.equal(out.body, null)
  assert.equal(asked.length, 2)
  assert.ok(out.problems.some((one) => /needs "columns"/.test(one.message)))
})

test('nothing coming back is not argued with, and the reason is carried through', async () => {
  const { generation, asked } = withAnswers([{ failed: 'Orion is busy right now. Try again in a minute.' }])
  const out = await generation.generate('x')
  assert.equal(out.body, null)
  assert.equal(out.failed, 'Orion is busy right now. Try again in a minute.')
  assert.equal(asked.length, 1)
})

test('an empty request is refused before any model is asked', async () => {
  const { generation, asked } = withAnswers([])
  const out = await generation.generate('   ')
  assert.equal(out.body, null)
  assert.equal(asked.length, 0)
})
