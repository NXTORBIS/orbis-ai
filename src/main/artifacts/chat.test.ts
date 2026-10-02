import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatArtifact, StreamEvent } from '../../shared/types.ts'
import { ArtifactChat, hasRuledTable, materialIn, notDrawable, tableTextIn, tabularIn, type ArtifactChatTurn } from './chat.ts'
import { ArtifactGeneration, type Asked } from './generation.ts'
import { ArtifactService } from './service.ts'
import { ArtifactStore } from './store.ts'

/*
 * A conversation, played against the real service, the real store and a real folder. Only Orion is a stand-in: each
 * test hands it the answers it will give, in order -- first what the message is asking for, then whatever the engine
 * asks it to write. Everything the chat would show is in `events`.
 */

interface Stage {
  chat: ArtifactChat
  service: ArtifactService
  dir: string
  asked: { system: string; user: string }[]
  /** Every artifact a reply showed, by message, so the next turn knows what was made. */
  history: ArtifactChatTurn['history']
  say(message: string, more?: Partial<ArtifactChatTurn>): Promise<{ outcome: Awaited<ReturnType<ArtifactChat['consider']>>; events: StreamEvent[]; text: string; cards: ChatArtifact[]; statuses: string[] }>
}

const stage = async (answers: (Record<string, unknown> | { failed: string })[], run: (s: Stage) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-artifact-chat-'))
  await mkdir(join(dir, 'Downloads'))
  let n = 0
  const asked: Stage['asked'] = []
  const generation = new ArtifactGeneration({
    apiKeys: async () => ['k'],
    fetchFn: async () => {
      throw new Error('not used')
    },
    ask: async (system, user): Promise<Asked> => {
      asked.push({ system, user })
      const next = answers.shift()
      if (!next) return { failed: 'the script ran out' }
      return 'failed' in next ? (next as { failed: string }) : { json: next }
    }
  })
  const service = new ArtifactService({
    store: new ArtifactStore({ userData: dir }),
    now: () => 1000 + n,
    random: () => (++n).toString(16).padStart(32, '0'),
    chooseDestination: async () => null,
    downloadsDir: () => join(dir, 'Downloads'),
    renderPdf: async (html: string) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Pages /Count 1 >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF ${html.length}`),
    generation
  })
  const chat = new ArtifactChat({ service, generation })
  const history: Stage['history'] = []
  const s: Stage = {
    chat,
    service,
    dir,
    asked,
    history,
    say: async (message, more = {}) => {
      const events: StreamEvent[] = []
      const outcome = await chat.consider({ profileId: 'default', message, attachments: [], history: [...history], conversationId: 'chat_1', signal: new AbortController().signal, emit: (event) => events.push(event), ...more })
      const text = events.filter((e): e is Extract<StreamEvent, { type: 'delta' }> => e.type === 'delta').map((e) => e.content ?? '').join('')
      const cards = events.filter((e): e is Extract<StreamEvent, { type: 'artifact' }> => e.type === 'artifact').map((e) => e.artifact)
      history.push({ role: 'user', content: message, artifactIds: [] })
      if (outcome.handled === 'done') history.push({ role: 'assistant', content: text, artifactIds: cards.map((one) => one.ref.artifactId) })
      return { outcome, events, text, cards, statuses: events.filter((e): e is Extract<StreamEvent, { type: 'status' }> => e.type === 'status').map((e) => e.message) }
    }
  }
  try {
    await run(s)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('ordinary conversation never reaches a model for this, and never makes a file', () =>
  stage([], async (s) => {
    for (const message of ['hello', 'what is the capital of France?', 'explain what a PDF is', 'how do I make a spreadsheet in Excel?']) {
      assert.deepEqual((await s.say(message)).outcome, { handled: 'no' }, message)
    }
    assert.equal(s.asked.length, 0, 'the check before the model answered every one')
    const listed = await s.service.run('default', { operation: 'artifact.list' })
    assert.equal(listed.ok && (listed.value as unknown[]).length, 0)
  }))

test('a spreadsheet is asked for, made, changed by a sentence, charted, and handed over as a PDF -- one conversation, the same artifacts throughout', () =>
  stage(
    [
      // 1. "Create an expense spreadsheet"
      { act: 'make', kind: 'table', format: 'excel', request: 'An expense tracker spreadsheet', sure: true },
      { kind: 'table', title: 'Expenses', columns: [{ name: 'Date', type: 'date' }, { name: 'Category', type: 'category' }, { name: 'Amount', type: 'number' }], rows: [['2026-10-01', 'Food', '12.5'], ['2026-10-02', 'Travel', '40'], ['2026-10-03', 'Food', '7.5']] },
      // 2. "Sort it biggest first"
      { act: 'change', target: 'A1', request: 'Sort by Amount, largest first', sure: true },
      { steps: [{ op: 'sort', by: [{ column: 'Amount', descending: true }] }] },
      // 3. "Add a chart"
      { act: 'chart', target: 'A1', request: 'A chart of Amount by Date', sure: true },
      { x: 'Date', y: ['Amount'], kind: 'line' },
      // 4. "Make the chart a bar chart"
      { act: 'change', target: 'A2', request: 'Make it a bar chart', sure: true },
      { x: 'Date', y: ['Amount'], kind: 'bar' },
      // 5. "Export it as PDF" -- "it" is the spreadsheet
      { act: 'export', target: 'A1', format: 'pdf', request: 'Export the spreadsheet as PDF', sure: true }
    ],
    async (s) => {
      const made = await s.say('Create an expense spreadsheet')
      assert.deepEqual(made.outcome, { handled: 'done' })
      assert.equal(made.cards.length, 1)
      assert.deepEqual([made.cards[0].action, made.cards[0].ref.kind, made.cards[0].ref.title, made.cards[0].format, made.cards[0].ref.verified], ['made', 'table', 'Expenses', 'xlsx', true])
      assert.match(made.text, /^I made \*\*Expenses\*\*: a table with 3 rows and 3 columns\./)
      assert.deepEqual(made.statuses, ['Writing it…'], 'the status said is the step that ran')
      const tableId = made.cards[0].ref.artifactId
      assert.ok(s.asked[1].user.includes('It has to be a table'), 'what was settled in the chat is not the generator\'s to change')

      const sorted = await s.say('Sort it biggest first')
      assert.deepEqual(sorted.outcome, { handled: 'done' })
      assert.deepEqual([sorted.cards[0].action, sorted.cards[0].ref.artifactId, sorted.cards[0].ref.version], ['changed', tableId, 2], 'the same spreadsheet, a new version')
      assert.match(sorted.text, /now version 2, and the one before is kept\. Sorted by Amount \(largest first\)/)
      assert.ok(s.asked[2].user.includes('A1 table "Expenses" columns: "Date" (date)'), 'the model was shown the artifact by handle')
      assert.equal(s.asked[2].user.includes(tableId), false, 'and never its id')
      assert.ok(s.asked[2].user.includes('about an artifact'), 'it was told the reply before showed one')

      const chart = await s.say('Add a chart')
      assert.deepEqual([chart.cards[0].action, chart.cards[0].ref.kind], ['drew', 'plot'])
      const chartId = chart.cards[0].ref.artifactId
      assert.match(chart.text, /I drew \*\*Amount by Date\*\* from \*\*Expenses\*\*\. The numbers are the table's own\./)

      const bars = await s.say('Make the chart a bar chart')
      assert.deepEqual([bars.cards[0].action, bars.cards[0].ref.artifactId, bars.cards[0].ref.version], ['changed', chartId, 2], 'the chart is redrawn as its own next version, not as a second chart')
      assert.ok(bars.cards[0].did.some((one) => /as bars/.test(one)))

      const pdf = await s.say('Export it as PDF')
      assert.deepEqual(pdf.outcome, { handled: 'done' })
      assert.deepEqual([pdf.cards[0].ref.kind, pdf.cards[0].format, pdf.cards[0].action], ['document', 'pdf', 'made'], 'a spreadsheet becomes a PDF by really being put into a document')
      assert.match(pdf.text, /is ready as PDF/)
      assert.match(pdf.text, /I put it into a document, row for row, with nothing rewritten/)
      // The download the card will ask for is a real file.
      const file = await s.service.run('default', { operation: 'artifact.download', artifactId: pdf.cards[0].ref.artifactId, format: 'pdf' })
      assert.equal(file.ok, true)
      if (file.ok) assert.equal((await readFile((file.value as { path: string }).path)).subarray(0, 5).toString('latin1'), '%PDF-')

      // Everything made here belongs to this conversation, and to no other.
      const mine = await s.service.run('default', { operation: 'artifact.list', within: 'chat_1' })
      assert.equal(mine.ok && (mine.value as unknown[]).length, 3)
      const theirs = await s.service.run('default', { operation: 'artifact.list', within: 'chat_2' })
      assert.equal(theirs.ok && (theirs.value as unknown[]).length, 0)
    }
  ))

test('a reply with a table in it becomes a real spreadsheet with nothing rewritten, and a document is kept as written', () =>
  stage(
    [
      { act: 'keep', source: 'reply', kind: 'table', format: 'excel', request: 'Put the table from the reply into Excel', sure: true },
      { act: 'keep', source: 'reply', kind: 'document', format: 'word', request: 'Turn the reply into a Word document', sure: true }
    ],
    async (s) => {
      s.history.push({ role: 'user', content: 'compare the planets', artifactIds: [] })
      s.history.push({ role: 'assistant', content: 'Here is the comparison:\n\n| Planet | Moons |\n| --- | --- |\n| Earth | 1 |\n| Mars | 2 |\n\nLet me know if you want more.', artifactIds: [] })
      const sheet = await s.say('Put this into Excel')
      assert.deepEqual(sheet.outcome, { handled: 'done' })
      assert.deepEqual([sheet.cards[0].ref.kind, sheet.cards[0].format, sheet.cards[0].action], ['table', 'xlsx', 'kept'])
      assert.match(sheet.text, /a table with 2 rows and 2 columns\. Nothing in it was rewritten\./)
      assert.equal(s.asked.length, 1, 'no model wrote the table: it was read from the reply')
      const read = await s.service.run('default', { operation: 'artifact.read', artifactId: sheet.cards[0].ref.artifactId })
      assert.deepEqual(read.ok && (read.value as { grid: { rows: string[][] } }).grid.rows, [['Earth', '1'], ['Mars', '2']])

      s.history.push({ role: 'assistant', content: '# Plan\n\nShip it on Friday.\n', artifactIds: [] })
      const doc = await s.say('Turn this into a Word document')
      assert.deepEqual([doc.cards[0].ref.kind, doc.cards[0].ref.title, doc.cards[0].format], ['document', 'Plan', 'docx'])
    }
  ))

test('an attached file is read from the bytes that were attached, and data typed into the message is taken as typed', () =>
  stage(
    [
      { act: 'keep', source: 'attachment', kind: 'table', format: 'xlsx', request: 'Turn the attached CSV into a spreadsheet', sure: true },
      { act: 'keep', source: 'message', kind: 'table', request: 'Make a table from the data', sure: true }
    ],
    async (s) => {
      const attached = await s.say('Turn the attached file into an Excel spreadsheet', { attachments: [{ name: 'sales.csv', content: 'month,sales\nJan,100\nFeb,140\n' }] })
      assert.deepEqual(attached.outcome, { handled: 'done' })
      assert.deepEqual([attached.cards[0].ref.kind, attached.cards[0].ref.title, attached.cards[0].format], ['table', 'sales', 'xlsx'])
      const record = await s.service.run('default', { operation: 'artifact.read', artifactId: attached.cards[0].ref.artifactId })
      assert.equal(record.ok && (record.value as { record: { source: string; conversationId?: string } }).record.source, 'file: sales.csv')
      assert.equal(record.ok && (record.value as { record: { conversationId?: string } }).record.conversationId, 'chat_1')

      const typed = await s.say('Create a table from this data:\nx,y\n1,2\n2,4\n3,6')
      assert.deepEqual(typed.outcome, { handled: 'done' })
      const grid = await s.service.run('default', { operation: 'artifact.read', artifactId: typed.cards[0].ref.artifactId })
      assert.deepEqual(grid.ok && (grid.value as { grid: { rows: string[][] } }).grid.rows, [['1', '2'], ['2', '4'], ['3', '6']], 'the person\'s own numbers, untouched')
      assert.equal(s.asked.length, 2, 'nothing was rewritten by a model')
    }
  ))

test('a question about what was made is answered from figures Orbis worked out, and nothing is made', () =>
  stage(
    [
      { act: 'make', kind: 'table', request: 'Expenses', sure: true },
      { kind: 'table', title: 'Expenses', columns: [{ name: 'Item', type: 'text' }, { name: 'Amount', type: 'number' }], rows: [['Rent', '900'], ['Food', '310.5'], ['Bus', '42']] },
      { act: 'ask', target: 'A1', request: 'What is the highest expense?', sure: true }
    ],
    async (s) => {
      await s.say('Make an expense table with examples')
      const asked = await s.say('What is the highest expense?')
      assert.equal(asked.outcome.handled, 'context')
      if (asked.outcome.handled !== 'context') return
      assert.match(asked.outcome.context, /Worked out by Orbis over ALL the rows/)
      assert.match(asked.outcome.context, /- Amount: 3 values, sum 1252\.5, mean 417\.5, smallest 42 \(row: Item=Bus, Amount=42\), largest 900 \(row: Item=Rent, Amount=900\)\./)
      assert.match(asked.outcome.context, /quote it, never recompute it/)
      assert.equal(asked.cards.length, 0)
      const listed = await s.service.run('default', { operation: 'artifact.list' })
      assert.equal(listed.ok && (listed.value as unknown[]).length, 1, 'asking made nothing')
    }
  ))

test('a report made from a spreadsheet is computed, shows a chart of it, and stopping makes nothing', () =>
  stage(
    [
      { act: 'make', kind: 'table', request: 'Readings', sure: true },
      { kind: 'table', title: 'Readings', columns: [{ name: 'Day', type: 'integer' }, { name: 'Used', type: 'number' }], rows: [['1', '412'], ['2', '288'], ['3', '530'], ['4', '415']] },
      { act: 'make', kind: 'document', target: 'A1', format: 'pdf', request: 'A PDF report from the spreadsheet', sure: true },
      { x: 'Day', y: ['Used'], kind: 'line' },
      { act: 'make', kind: 'document', request: 'A report about tides', sure: true }
    ],
    async (s) => {
      await s.say('Make a table of readings with example rows')
      const report = await s.say('Now make a PDF report from it')
      assert.deepEqual(report.outcome, { handled: 'done' })
      assert.deepEqual([report.cards[0].ref.kind, report.cards[0].format, report.cards[0].ref.version], ['document', 'pdf', 2], 'the report, with the chart placed in it as its second version')
      assert.match(report.text, /Every figure in it was worked out by Orbis from "Readings"\. None was written by a model\./)
      assert.match(report.text, /It shows the chart "Used by Day"/)
      assert.deepEqual(report.statuses, ['Reading the file…', 'Choosing what to draw…'])

      const stop = new AbortController()
      stop.abort()
      const before = await s.service.run('default', { operation: 'artifact.list' })
      const stopped = await s.say('Create a document about tides', { signal: stop.signal })
      assert.equal(stopped.outcome.handled, 'stopped')
      assert.equal(stopped.cards.length, 0)
      const after = await s.service.run('default', { operation: 'artifact.list' })
      const count = (result: typeof before): number => (result.ok ? (result.value as unknown[]).length : -1)
      assert.equal(count(after), count(before), 'nothing was kept')
    }
  ))

test('when the engine cannot do it the reply says why, a secret is stopped, and an unsure model means an ordinary reply', () =>
  stage(
    [
      { act: 'make', kind: 'document', request: 'A deploy note', sure: true },
      { kind: 'document', title: 'Deploy', markdown: '# Deploy\n\nUse the token ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6' + ' to push.\n' },
      { act: 'make', kind: 'table', request: 'A table', sure: false },
      { failed: 'Orion is busy right now.' },
      { failed: 'Orion is busy right now.' }
    ],
    async (s) => {
      const leaked = await s.say('Create a document with my deploy notes')
      assert.equal(leaked.outcome.handled, 'failed')
      if (leaked.outcome.handled === 'failed') assert.match(leaked.outcome.message, /It was not written\. Take the key or password out and ask again/)
      assert.equal(leaked.cards.length, 0)

      assert.deepEqual((await s.say('make me a table maybe')).outcome, { handled: 'no' }, 'not sure is an ordinary reply')

      // No model can be asked. A request in the plainest words still works when the engine itself can do it without one...
      const plain = await s.say('Create a spreadsheet for my reading list')
      assert.equal(plain.outcome.handled, 'failed', 'the engine needs Orion to choose the columns, and says it could not be asked')
      if (plain.outcome.handled === 'failed') assert.match(plain.outcome.message, /Orion is busy right now/)
      const listed = await s.service.run('default', { operation: 'artifact.list' })
      assert.equal(listed.ok && (listed.value as unknown[]).length, 0)
    }
  ))

test('incognito is said plainly, and the pieces of a message are found as written', () =>
  stage(
    [
      { act: 'make', kind: 'diagram', request: 'A flowchart for signing in', sure: true },
      { kind: 'diagram', title: 'Sign in', nodes: [{ id: 'a', label: 'Start', shape: 'start' }, { id: 'b', label: 'Done', shape: 'end' }], edges: [{ from: 'a', to: 'b' }] }
    ],
    async (s) => {
      const flow = await s.say('draw a flowchart for signing in', { incognito: true })
      assert.deepEqual([flow.cards[0].ref.kind, flow.cards[0].action], ['diagram', 'made'])
      assert.match(flow.text, /This chat is incognito and will not be saved, but what was made is kept in Create until you remove it\./)

      assert.equal(materialIn('Make a table from this:\na,b\n1,2'), 'a,b\n1,2')
      assert.equal(materialIn('Chart this: 1, 2, 3'), '1, 2, 3')
      assert.equal(materialIn('make a table'), '')
      assert.equal(tableTextIn('Here you go:\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAnything else?'), '| a | b |\n| --- | --- |\n| 1 | 2 |')
      assert.equal(tableTextIn('a,b\n1,2'), 'a,b\n1,2')
    }
  ))

test('a table that is already in the reply is read, not written again, whichever way the request was understood', () =>
  stage(
    // The model called it "make" rather than "keep". The table in the reply is still taken as it stands.
    [{ act: 'make', source: 'reply', kind: 'table', format: 'excel', request: 'Put the comparison into Excel', sure: true }],
    async (s) => {
      s.history.push({ role: 'user', content: 'compare the phones', artifactIds: [] })
      s.history.push({ role: 'assistant', content: 'Here is a comparison:\n\n| Phone | Price | Battery |\n| --- | --- | --- |\n| Pixel 9 | 799 | 4700 |\n| iPhone 16 | 799 | 3561 |\n\nThe Pixel has the larger battery.', artifactIds: [] })
      const sheet = await s.say('Put that in Excel')
      assert.deepEqual(sheet.outcome, { handled: 'done' })
      assert.deepEqual([sheet.cards[0].ref.kind, sheet.cards[0].format, sheet.cards[0].action], ['table', 'xlsx', 'kept'])
      assert.equal(s.asked.length, 1, 'only the question of what was asked for went to a model; nothing was written by one')
      const read = await s.service.run('default', { operation: 'artifact.read', artifactId: sheet.cards[0].ref.artifactId })
      assert.deepEqual(read.ok && (read.value as { grid: { rows: string[][] } }).grid.rows, [['Pixel 9', '799', '4700'], ['iPhone 16', '799', '3561']])
      assert.match(sheet.text, /Nothing in it was rewritten/)
    }
  ))

test('a chart or a report asked for about an attached file: the file is kept as a table first, then drawn or reported from', () =>
  stage(
    [
      { act: 'chart', target: null, source: 'attachment', request: 'A bar chart of sales by month', sure: true },
      { x: 'month', y: ['sales'], kind: 'bar' },
      { act: 'make', kind: 'document', source: 'attachment', format: 'pdf', request: 'A report about the attached sales', sure: true },
      { x: 'month', y: ['sales'], kind: 'line' },
      { act: 'chart', target: null, source: 'attachment', request: 'chart it', sure: true }
    ],
    async (s) => {
      // A workbook attached to the chat arrives as rows of text under its own name, and is opened as rows of text.
      const attachments = [{ name: 'sales.xlsx', content: 'month,sales\nJan,100\nFeb,140\nMar,90\n', openAs: 'sales.csv' }]
      const drawn = await s.say('Chart the attached file as bars', { attachments })
      assert.deepEqual(drawn.outcome, { handled: 'done' })
      assert.deepEqual(drawn.cards.map((one) => [one.action, one.ref.kind, one.ref.title]), [['kept', 'table', 'sales'], ['drew', 'plot', drawn.cards[1].ref.title]])
      assert.match(drawn.text, /I kept the attached file as \*\*sales\*\*: a table with 3 rows and 2 columns\. Nothing in it was rewritten\./)
      assert.match(drawn.text, /I drew \*\*.+\*\* from \*\*sales\*\*\. The numbers are the table's own\./)

      const report = await s.say('Write a report about the attached file as a PDF', { attachments })
      assert.deepEqual(report.outcome, { handled: 'done' })
      const made = report.cards[report.cards.length - 1]
      assert.deepEqual([made.action, made.ref.kind, made.format], ['made', 'document', 'pdf'])
      assert.match(report.text, /Every figure in it was worked out by Orbis from "sales"\. None was written by a model\./)

      // A file that is words, not rows: nothing to draw from, said plainly, and nothing left behind in the library.
      const before = await s.service.run('default', { operation: 'artifact.list' })
      const words = await s.say('chart the attached file', { attachments: [{ name: 'notes.md', content: '# Notes\n\nNothing to count here.\n' }] })
      assert.equal(words.outcome.handled, 'failed')
      if (words.outcome.handled === 'failed') assert.match(words.outcome.message, /did not read as a table/)
      const after = await s.service.run('default', { operation: 'artifact.list' })
      const count = (result: typeof before): number => (result.ok ? (result.value as unknown[]).length : -1)
      assert.equal(count(after), count(before), 'the document kept for a moment was taken away again')
    }
  ))

test('asked for a kind of chart Orbis does not draw, the reply says so and says what it drew instead', () =>
  stage(
    [
      { act: 'make', kind: 'table', request: 'ages', sure: true },
      { kind: 'table', title: 'Ages', columns: [{ name: 'Person', type: 'text' }, { name: 'Age', type: 'number' }], rows: [['a', '31'], ['b', '44'], ['c', '29']] },
      { act: 'chart', target: 'A1', request: 'A histogram of Age', sure: true },
      { x: 'Person', y: ['Age'], kind: 'bar' }
    ],
    async (s) => {
      await s.say('Make a table of ages: a 31, b 44, c 29')
      const drawn = await s.say('Draw a histogram of the ages')
      assert.deepEqual(drawn.outcome, { handled: 'done' })
      assert.match(drawn.text, /Orbis does not draw a histogram chart yet\. It draws lines, bars, points, areas, steps and pies, so this is one of those from the same numbers\./)
      assert.equal(notDrawable('a bar chart of sales'), null)
      assert.equal(notDrawable('a pie chart of sales'), null, 'a pie is drawn')
      assert.match(notDrawable('a Heat Map of visits') ?? '', /heat map chart yet/)
    }
  ))

const titles = async (s: Stage): Promise<string[]> => {
  const listed = await s.service.run('default', { operation: 'artifact.list' })
  return listed.ok ? (listed.value as { record: { kind: string; title: string; version: number } }[]).map((one) => `${one.record.kind}:${one.record.title}:v${one.record.version}`).sort() : []
}

test('the request can come before the data or after it, and the data is the same either way', () => {
  assert.equal(materialIn('Make a spreadsheet from this:\nname,amount\nrent,1200'), 'name,amount\nrent,1200')
  assert.equal(materialIn('name,amount\nrent,1200\nfood,300\n\nmake a spreadsheet from this'), 'name,amount\nrent,1200\nfood,300')
  assert.equal(materialIn('| a | b |\n| --- | --- |\n| 1 | 2 |\n\nput this in a spreadsheet please'), '| a | b |\n| --- | --- |\n| 1 | 2 |')
  // A heading row that happens to start with a word people ask with is still a heading row.
  assert.equal(materialIn('make,model,year\nFord,Focus,2019\n\nturn this into a table'), 'make,model,year\nFord,Focus,2019')
  // Neither end is a request: nothing is guessed at.
  assert.equal(materialIn('name,amount\nrent,1200'), '')
  assert.equal(materialIn('Put this in a table: a,b'), 'a,b')
})

test('a table is read only from text that is one; anything else is not passed off as a table', () => {
  assert.equal(tabularIn('| Month | Sales |\n|---|---|\n| Jan | 1200 |'), '| Month | Sales |\n|---|---|\n| Jan | 1200 |', 'text that is nothing but the table is still a table')
  assert.equal(hasRuledTable('| Month | Sales |\n|---|---|\n| Jan | 1200 |'), true)
  assert.equal(tabularIn('Here it is:\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nDone.'), '| a | b |\n| --- | --- |\n| 1 | 2 |')
  assert.equal(tabularIn('name,amount\nrent,1200\nfood,300'), 'name,amount\nrent,1200\nfood,300')
  assert.equal(tabularIn('Here you go:\n```csv\na,b\n1,2\n```'), 'a,b\n1,2', 'rows inside the one fenced block')
  assert.equal(tabularIn('Here are the planets:\n- Mercury: 4,879 km\n- Venus: 12,104 km\n- Earth: 12,756 km'), null, 'a list with thousands commas is not rows')
  assert.equal(tabularIn('Tea is a drink. People like it.'), null)
  assert.equal(tableTextIn('no table here'), 'no table here')
  const started = Date.now()
  assert.equal(tabularIn(`a | b\n${' \t'.repeat(100_000)}x`), null)
  assert.ok(Date.now() - started < 1000, 'a long run of space does not hold everything up')
})

test('data pasted before the request, a table that is the whole message, and a list that is not a table', () =>
  stage(
    [
      { act: 'keep', source: 'message', kind: 'table', request: 'A spreadsheet from the pasted rows', sure: true },
      { act: 'make', source: 'message', kind: 'table', request: 'A spreadsheet of sales', sure: true },
      { act: 'keep', source: 'reply', kind: 'table', format: 'excel', request: 'The planets as a spreadsheet', sure: true },
      { kind: 'table', title: 'Planets', columns: [{ name: 'Planet', type: 'text' }, { name: 'Diameter (km)', type: 'number' }], rows: [['Mercury', '4879'], ['Venus', '12104'], ['Earth', '12756']] }
    ],
    async (s) => {
      const pasted = await s.say('name,amount\nrent,1200\nfood,300\n\nmake a spreadsheet from this')
      assert.deepEqual(pasted.outcome, { handled: 'done' })
      const first = await s.service.run('default', { operation: 'artifact.read', artifactId: pasted.cards[0].ref.artifactId })
      assert.deepEqual(first.ok && (first.value as { columns: { name: string }[]; grid: { rows: string[][] } }).columns.map((one) => one.name), ['name', 'amount'], 'the heading row is the heading row')
      assert.deepEqual(first.ok && (first.value as { grid: { rows: string[][] } }).grid.rows, [['rent', '1200'], ['food', '300']], 'and the request is not a row')

      // The model called this "make". The table is the whole of the material, and it is read, not written again.
      const asked = s.asked.length
      const whole = await s.say('Make a spreadsheet from this:\n| Month | Sales |\n|---|---|\n| Jan | 1200 |\n| Feb | 1800 |')
      assert.deepEqual([whole.cards[0].action, whole.outcome.handled], ['kept', 'done'])
      assert.equal(s.asked.length, asked + 1, 'only the question of what was asked for went to a model')
      const second = await s.service.run('default', { operation: 'artifact.read', artifactId: whole.cards[0].ref.artifactId })
      assert.deepEqual(second.ok && (second.value as { grid: { rows: string[][] } }).grid.rows, [['Jan', '1200'], ['Feb', '1800']])

      // A list is not a table. Orion writes one out from it, and the reply says that is what happened.
      s.history.push({ role: 'assistant', content: 'Here are the planets:\n- Mercury: 4,879 km\n- Venus: 12,104 km\n- Earth: 12,756 km', artifactIds: [] })
      const list = await s.say('put that in Excel')
      assert.deepEqual([list.cards[0].action, list.cards[0].ref.title], ['made', 'Planets'])
      assert.match(list.text, /There was no table in it as it stood, so Orion wrote one out from it: check it against the original\./)
      assert.equal(/Nothing in it was rewritten/.test(list.text), false)
    }
  ))

test('code is found wherever in the reply it is, and when there is more than one piece the reply asks which', () =>
  stage(
    [
      { act: 'keep', source: 'reply', kind: 'code', request: 'Save the script as a Python file', sure: true },
      { act: 'keep', source: 'reply', kind: 'code', request: 'Save the code', sure: true },
      { act: 'keep', source: 'reply', kind: 'code', request: 'Save the JavaScript', sure: true }
    ],
    async (s) => {
      s.history.push({ role: 'user', content: 'a script please', artifactIds: [] })
      s.history.push({ role: 'assistant', content: "Here's the script:\n\n```python\nprint(1)\n```\n\nRun it with `python script.py`.", artifactIds: [] })
      const one = await s.say('save that as a python file')
      assert.deepEqual([one.cards[0].ref.kind, one.cards[0].action], ['code', 'kept'])
      const read = await s.service.run('default', { operation: 'artifact.read', artifactId: one.cards[0].ref.artifactId })
      assert.equal(read.ok && (read.value as { preview: string }).preview, 'print(1)\n')

      s.history.push({ role: 'assistant', content: 'Two ways:\n\n```python\nprint(1)\n```\n\n```javascript\nconsole.log(1)\n```\n', artifactIds: [] })
      const two = await s.say('save that code as a file')
      assert.equal(two.outcome.handled, 'failed')
      if (two.outcome.handled === 'failed') assert.match(two.outcome.message, /There are 2 pieces of code in it\. Say which one to keep, by its language\./)
      s.history.push({ role: 'assistant', content: 'Two ways:\n\n```python\nprint(1)\n```\n\n```javascript\nconsole.log(1)\n```\n', artifactIds: [] })
      const named = await s.say('save that JavaScript as a file')
      assert.equal(named.cards[0].ref.kind, 'code')
      const js = await s.service.run('default', { operation: 'artifact.read', artifactId: named.cards[0].ref.artifactId })
      assert.equal(js.ok && (js.value as { preview: string }).preview, 'console.log(1)\n')
    }
  ))

test('a request stopped part-way leaves nothing behind, and "put the chart into the report" places the chart there is', () =>
  stage(
    [
      { act: 'make', kind: 'table', request: 'sales', sure: true },
      { kind: 'table', title: 'Sales', columns: [{ name: 'Month', type: 'text' }, { name: 'Amount', type: 'number' }], rows: [['Jan', '10'], ['Feb', '14']] },
      // "write a report about this table", stopped while the chart is being chosen
      { act: 'make', kind: 'document', target: 'A1', request: 'A report about the table', sure: true },
      { x: 'Month', y: ['Amount'], kind: 'bar' },
      // the same again, allowed to finish
      { act: 'make', kind: 'document', target: 'A1', request: 'A report about the table', sure: true },
      { x: 'Month', y: ['Amount'], kind: 'bar' },
      // a second chart, then "put the chart into the report"
      // By now the conversation holds the report's own chart (A1), the table (A2) and the report (A3).
      { act: 'chart', target: 'A2', request: 'a line chart', sure: true },
      { x: 'Month', y: ['Amount'], kind: 'line' },
      { act: 'chart', target: 'A4', into: 'A3', request: 'put the chart into the report', sure: true }
    ],
    async (s) => {
      await s.say('Make a table of sales: Jan 10, Feb 14')
      assert.deepEqual(await titles(s), ['table:Sales:v1'])

      const controller = new AbortController()
      const stopped = await s.say('write a report about this table', {
        signal: controller.signal,
        emit: (event) => {
          // Stop, the moment the report has been worked out and the chart is being chosen.
          if (event.type === 'status' && /Choosing what to draw/.test(event.message)) controller.abort()
        }
      })
      assert.deepEqual(stopped.outcome, { handled: 'stopped' })
      assert.deepEqual(await titles(s), ['table:Sales:v1'], 'the report that had already been kept is taken away again')

      const report = await s.say('write a report about this table')
      assert.deepEqual(report.outcome, { handled: 'done' })
      const made = (await titles(s)).filter((one) => one.startsWith('document:'))
      assert.equal(made.length, 1)

      const line = await s.say('draw a line chart of it')
      assert.equal(line.cards[0].ref.kind, 'plot')
      const before = (await titles(s)).filter((one) => one.startsWith('plot:')).length
      const placed = await s.say('put the chart into the report')
      assert.deepEqual(placed.outcome, { handled: 'done' })
      assert.deepEqual(placed.cards.map((one) => [one.ref.kind, one.action]), [['document', 'changed']])
      assert.match(placed.text, /is now a figure in \*\*Analysis of Sales\*\*/)
      assert.equal((await titles(s)).filter((one) => one.startsWith('plot:')).length, before, 'no chart was redrawn or made')
    }
  ))

test('answering again undoes what the first answer did: a change is redone from the version before it, and a thing made is made once', () =>
  stage(
    [
      { act: 'make', kind: 'table', request: 'tasks', sure: true },
      { kind: 'table', title: 'Tasks', columns: [{ name: 'Task', type: 'text' }, { name: 'Notes', type: 'text' }], rows: [['a', 'x'], ['b', 'y']] },
      { act: 'change', target: 'A1', request: 'Remove the Notes column', sure: true },
      { steps: [{ op: 'drop', columns: ['Notes'] }] },
      // Regenerate: the same message again
      { act: 'change', target: 'A1', request: 'Remove the Notes column', sure: true },
      { steps: [{ op: 'drop', columns: ['Notes'] }] },
      // Regenerate on the reply that made the table
      { act: 'make', kind: 'table', request: 'tasks', sure: true },
      { kind: 'table', title: 'Tasks', columns: [{ name: 'Task', type: 'text' }], rows: [['a'], ['b'], ['c']] }
    ],
    async (s) => {
      const made = await s.say('Make a table of tasks with notes')
      const changed = await s.say('remove the Notes column')
      assert.equal(changed.cards[0].ref.version, 2)

      // Regenerate that reply: its card goes with it, and the message is answered again.
      s.history.splice(-2)
      const replaced = changed.cards.map((one) => ({ artifactId: one.ref.artifactId, versionId: one.ref.versionId, version: one.ref.version, action: one.action }))
      await s.chat.undo({ profileId: 'default', message: '', attachments: [], history: [], conversationId: 'chat_1', replaced, signal: new AbortController().signal, emit: () => undefined })
      const again = await s.say('remove the Notes column')
      assert.deepEqual(again.outcome, { handled: 'done' }, 'the column is there to be removed again')
      const read = await s.service.run('default', { operation: 'artifact.read', artifactId: made.cards[0].ref.artifactId })
      assert.deepEqual(read.ok && (read.value as { columns: { name: string }[] }).columns.map((one) => one.name), ['Task'])
      assert.equal(read.ok && (read.value as { record: { version: number } }).record.version, 4, 'put back as a version, then changed as a version: nothing is lost')

      // Regenerate the reply that made the table: the first one is removed, and there is one table, not two.
      s.history.splice(0)
      await s.chat.undo({ profileId: 'default', message: '', attachments: [], history: [], conversationId: 'chat_1', replaced: [{ artifactId: made.cards[0].ref.artifactId, versionId: made.cards[0].ref.versionId, version: 1, action: 'made' }], signal: new AbortController().signal, emit: () => undefined })
      assert.deepEqual(await titles(s), [])
      await s.say('Make a table of tasks with notes')
      assert.deepEqual(await titles(s), ['table:Tasks:v1'])

      // Something made in another conversation is never removed on a window's say-so, and nonsense is ignored.
      const other = await s.service.run('default', { operation: 'artifact.create', kind: 'table', title: 'Elsewhere', text: 'a,b\n1,2\n', conversationId: 'another_chat' })
      const otherId = other.ok ? (other.value as { record: { artifactId: string; versionId: string } }).record : null
      await s.chat.undo({ profileId: 'default', message: '', attachments: [], history: [], conversationId: 'chat_1', replaced: [{ artifactId: otherId!.artifactId, versionId: otherId!.versionId, version: 1, action: 'made' }, { artifactId: '../../etc', versionId: 'x', version: 1, action: 'made' }], signal: new AbortController().signal, emit: () => undefined })
      assert.ok((await titles(s)).includes('table:Elsewhere:v1'))
    }
  ))
