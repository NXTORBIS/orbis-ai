import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArtifactGeneration, figuresGiven, instructions, LONG_STATUS, longDocumentAsked, readOutline, tidyPart, type Asked } from './generation.ts'

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

test('a diagram proposal becomes an editable, laid-out diagram', async () => {
  const { generation } = withAnswers([
    {
      kind: 'diagram',
      title: 'Login flow',
      nodes: [{ id: 'start', label: 'Open the page', shape: 'start' }, { id: 'ok', label: 'Password right?', shape: 'decision' }, { id: 'in', label: 'Signed in', shape: 'end' }],
      edges: [{ from: 'start', to: 'ok' }, { from: 'ok', to: 'in', label: 'yes' }, { from: 'ok', to: 'start', label: 'no' }]
    }
  ])
  const out = await generation.generate('a flowchart of logging in')
  assert.ok(out.body && out.body.kind === 'diagram')
  if (!out.body || out.body.kind !== 'diagram') throw new Error('no diagram')
  assert.equal(out.body.diagram.objects.length, 3)
  assert.equal(out.body.diagram.connectors.length, 3)
  assert.ok(out.body.diagram.objects[1].box.x > out.body.diagram.objects[0].box.x, 'laid out left to right')
  assert.ok(out.notes.some((one) => /laid out|worked out by Orbis/.test(one)))
})

test('a chart cannot be written by a model, and the refusal says where charts come from', async () => {
  const { generation } = withAnswers([{ kind: 'plot', title: 'x' }, { kind: 'plot', title: 'x' }])
  const out = await generation.generate('a chart')
  assert.equal(out.body, null)
  assert.ok(out.problems.some((one) => /made from a table/.test(one.message)))
  assert.equal(instructions().includes('"plot"'), false)
  assert.ok(instructions().includes('"diagram"'))
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

test('rows written out from what the person gave are not called examples, and only when every value in them was given', async () => {
  const { generation } = withAnswers([
    { kind: 'table', title: 'Sales', columns: ['Month', 'Units', 'Revenue'], rows: [['January', '12', '1200'], ['February', '18', '1,800']] }
  ])
  const out = await generation.generate('A spreadsheet of sales: January revenue 1200 and units 12, February revenue 1800 and units 18.')
  assert.equal(out.body?.kind, 'table')
  assert.ok(out.notes.some((one) => /Every value in them is in what you gave/.test(one)), out.notes.join(' | '))
  assert.equal(out.notes.some((one) => /example/i.test(one)), false, 'neither the note nor the planner calls the person\'s own figures examples')

  // The numbers were given; the months were filled in by the model. Said exactly, and nothing is called "yours" that is not.
  const filled = withAnswers([{ kind: 'table', title: 'Sales', columns: ['Month', 'Revenue'], rows: [['January 2025', '1200'], ['February 2025', '1800']] }])
  const some = await filled.generation.generate('Sales for the first two months of 2025: 1200 and 1800.')
  assert.ok(some.notes.some((one) => /4 of the 4 numbers in the rows are in what you gave\. Everything else in the rows was written by a model: treat anything you did not give as an example\./.test(one)), some.notes.join(' | '))
  assert.equal(some.notes.some((one) => /Every value in them/.test(one)), false)
})

test('invented rows are never called the person\'s own, however the numbers are dressed or happen to coincide', async () => {
  // Figures with a sign, a unit or a percent are still figures, and these were not given.
  const dressed = withAnswers([{ kind: 'table', title: 'Sales', columns: ['Year', 'Revenue', 'Growth'], rows: [['2024', '$1.2M', '12%'], ['2025', '$1.5M', '25%']] }])
  const out = await dressed.generation.generate('A sales table for 2024 and 2025 with example revenue')
  assert.equal(out.notes.some((one) => /Every value in them/.test(one)), false, out.notes.join(' | '))
  assert.ok(out.notes.some((one) => /2 of the 6 numbers in the rows are in what you gave/.test(one)), out.notes.join(' | '))

  // Three invented students in "grade 5": the 5 is in the request, the students are not.
  const roster = withAnswers([{ kind: 'table', title: 'Roster', columns: ['Student', 'Grade'], rows: [['Alice', '5'], ['Bob', '5'], ['Cara', '5']] }])
  const made = await roster.generation.generate('Create a class roster spreadsheet for grade 5 with 3 students')
  assert.equal(made.notes.some((one) => /Every value in them/.test(one)), false, made.notes.join(' | '))
  assert.ok(made.notes.some((one) => /treat anything you did not give as an example/.test(one)))

  // Nothing given at all: examples, said twice over as before.
  const none = withAnswers([{ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['x', '42']] }])
  const plain = await none.generation.generate('a table with an example row')
  assert.ok(plain.notes.some((one) => /examples written by a model/.test(one)))
  assert.ok(plain.notes.some((one) => /example row was written by a model/.test(one)))

  assert.deepEqual(figuresGiven([['a', '12'], ['b', 3.5], ['c', '-7'], ['d', 'n/a']], 'a b c d: twelve is 12, and 3.5, and 7, or n/a'), { numbers: 3, found: 3, words: 5, wordsFound: 5 })
  assert.deepEqual(figuresGiven([['1,200']], 'it was 1200'), { numbers: 1, found: 1, words: 0, wordsFound: 0 })
  assert.deepEqual(figuresGiven([['1200'], ['300']], 'Jan,1200,300'), { numbers: 2, found: 2, words: 0, wordsFound: 0 }, 'a comma between two numbers is not a thousands comma')
  assert.deepEqual(figuresGiven([['1'], ['2'], ['3']], 'Use these figures: 1,2,3'), { numbers: 3, found: 3, words: 0, wordsFound: 0 })
  assert.deepEqual(figuresGiven([['3'], ['12'], ['31']], 'Budget from 2024-03-12 to 2024-12-31'), { numbers: 3, found: 0, words: 0, wordsFound: 0 }, 'the parts of a date are not figures somebody gave')
  assert.deepEqual(figuresGiven([['2026-10-01', 'x']], 'x'), { numbers: 0, found: 0, words: 1, wordsFound: 1 }, 'a date in a cell is not a figure either')
  assert.deepEqual(figuresGiven([['$1.2M', '12%']], 'nothing numeric here'), { numbers: 2, found: 0, words: 1, wordsFound: 0 })

  // From material handed over (a reply, an attached file), the same rule: checked against the material.
  const fromMaterial = withAnswers([{ kind: 'table', title: 'Moons', columns: ['Planet', 'Moons'], rows: [['Mars', '2'], ['Jupiter', '95']] }])
  const moons = await fromMaterial.generation.generate('Make a table from that', { context: 'Mars has 2 moons and Jupiter has 95.' })
  assert.ok(moons.notes.some((one) => /Every value in them is in what you gave/.test(one)))
})

test('a document is written in parts only when length is asked for, and a number of pages decides how many', () => {
  assert.equal(longDocumentAsked('a report on remote work'), null)
  assert.equal(longDocumentAsked('a one-page summary of the meeting'), null)
  assert.equal(longDocumentAsked('a 2 page letter'), null)
  assert.equal(longDocumentAsked('a 500 word essay'), null)
  assert.equal(longDocumentAsked('a detailed spreadsheet of costs'), null, 'long is about documents')
  assert.deepEqual(longDocumentAsked('a detailed report on remote work'), { parts: 6, short: null })
  assert.deepEqual(longDocumentAsked('write an in-depth guide to composting'), { parts: 6, short: null })
  assert.deepEqual(longDocumentAsked('a 5-page proposal for the client'), { parts: 5, short: null })
  assert.deepEqual(longDocumentAsked('a 3000 word essay on rivers'), { parts: 8, short: null })
  assert.deepEqual(longDocumentAsked('a 40 page handbook'), { parts: 10, short: '40 pages' }, 'more than can be written in one go is said')
  assert.deepEqual(longDocumentAsked('a 10,000 word thesis'), { parts: 10, short: '10,000 words' })
})

test('an outline is a title and at least three parts with different headings; a part loses its own heading and keeps its place', () => {
  const good = readOutline({ title: ' Remote work ', purpose: 'p', parts: [{ heading: '## Why', brief: 'b' }, { heading: 'How' }, { heading: 'why' }, { heading: 'What next', brief: 'c' }, 'junk'] })
  assert.deepEqual(good.outline?.parts.map((one) => one.heading), ['Why', 'How', 'What next'], 'a repeated heading is one part')
  assert.equal(good.outline?.title, 'Remote work')
  assert.equal(readOutline({ title: 'T', parts: [{ heading: 'a' }, { heading: 'b' }] }).outline, null)
  assert.equal(readOutline({ parts: [{ heading: 'a' }, { heading: 'b' }, { heading: 'c' }] }).outline, null)
  assert.equal(readOutline('no').outline, null)
  assert.equal(readOutline({ title: 'T', parts: Array.from({ length: 30 }, (_, i) => ({ heading: `h${i}` })) }).outline?.parts.length, 10)

  assert.equal(tidyPart('## Why it matters\n\nBecause.\n\n# Costs\n\nLow.\n\n```\n# not a heading\n```', 'Why it matters'), 'Because.\n\n### Costs\n\nLow.\n\n```\n# not a heading\n```')
  assert.equal(tidyPart('Plain words.', 'Why'), 'Plain words.')
})

const OUTLINE = { title: 'Remote work', purpose: 'A report.', parts: [{ heading: 'Why it matters', brief: 'The case.' }, { heading: 'What it costs', brief: 'Money and time.' }, { heading: 'How to start', brief: 'First steps.' }, { heading: 'What to watch', brief: 'Risks.' }] }
const part = (words: string): Record<string, unknown> => ({ markdown: `${words} `.repeat(12).trim() })

test('a long document is an outline and then each part, assembled in the outline\'s order, with progress that is true', async () => {
  const { generation, asked } = withAnswers([OUTLINE, part('one'), part('two'), part('three'), part('four')])
  const said: string[] = []
  const out = await generation.generateLong('a detailed report on remote work', { parts: 6, progress: (message) => said.push(message) })
  assert.ok(out.body && out.body.kind === 'document', JSON.stringify(out.problems))
  if (!out.body || out.body.kind !== 'document') return
  assert.equal(out.intent?.title, 'Remote work')
  const headings = out.body.document.blocks.filter((one) => one.kind === 'heading').map((one) => (one as { content: { text: string }[] }).content.map((run) => run.text).join(''))
  assert.deepEqual(headings, ['Remote work', 'Why it matters', 'What it costs', 'How to start', 'What to watch'])
  assert.equal(asked.length, 5, 'one request for the outline and one for each part')
  assert.deepEqual(said, [LONG_STATUS.planning, 'Written 1 of 4 parts…', 'Written 2 of 4 parts…', 'Written 3 of 4 parts…', 'Written 4 of 4 parts…'])
  assert.match(out.notes[0], /Written by a model in 4 parts, from an outline it made first\./)
})

test('a part that cannot be written means nothing is kept, and the reply says which part', async () => {
  // Part two comes back empty twice. The parts after it may already have been asked for; none of it is kept.
  const { generation } = withAnswers([OUTLINE, part('one'), { markdown: '' }, part('three'), { markdown: '  ' }, part('four')])
  const out = await generation.generateLong('a detailed report on remote work', { parts: 6 })
  assert.equal(out.body, null)
  assert.match(out.problems[0].message, /Part 2 of 4 \("What it costs"\) could not be written: .* Nothing was kept, because a document with a part missing would read as finished\./)

  const noOutline = withAnswers([{ title: 'T', parts: [] }, { nonsense: true }])
  const none = await noOutline.generation.generateLong('a detailed report', { parts: 6 })
  assert.equal(none.body, null)
  assert.match(none.problems[0].message, /did not plan a document/)

  const refused = withAnswers([{ failed: 'Orion is busy right now. Try again in a minute.' }])
  const busy = await refused.generation.generateLong('a detailed report', { parts: 6 })
  assert.equal(busy.failed, 'Orion is busy right now. Try again in a minute.')

  const short = withAnswers([OUTLINE, part('one'), part('two'), part('three'), part('four')])
  const said = await short.generation.generateLong('a 40 page handbook', { parts: 10, short: '40 pages' })
  assert.ok(said.notes.some((one) => /You asked for 40 pages\. Orbis writes at most 10 parts in one go, so this is shorter than that\./.test(one)))
})
