import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedWhen, MADE_LIMITS, searchArtifacts, summaryOfMade, type MadeArtifact } from './searching.ts'

/** Mid-afternoon on a Saturday, built from local parts so the day boundaries are the same wherever this runs. */
const NOW = new Date(2026, 9, 3, 15, 0, 0).getTime()
const DAY = 86_400_000
const at = (daysAgo: number, hour = 12): number => new Date(2026, 9, 3 - daysAgo, hour, 0, 0).getTime()

let made = 0
const record = (over: Partial<MadeArtifact> = {}): MadeArtifact => ({
  artifactId: `artifact_${String(++made).padStart(32, '0')}`,
  title: 'Untitled',
  kind: 'table',
  updatedAt: NOW - DAY,
  shape: { rows: 0, columns: 0 },
  notes: [],
  source: 'pasted',
  ...over
})

const find = (query: string, records: readonly MadeArtifact[], rows?: number): ReturnType<typeof searchArtifacts> =>
  searchArtifacts(query, { list: () => records, now: () => NOW, ...(rows === undefined ? {} : { rows }) })

test('a name that matches comes first, then words in what is kept, newest first on a tie', async () => {
  const records = [
    record({ title: 'Office electricity', kind: 'table', shape: { rows: 120, columns: 4 }, updatedAt: at(1) }),
    record({ title: 'Notes', kind: 'document', shape: { rows: 28, columns: 0 }, notes: ['Made from the office electricity table.'], updatedAt: at(0) }),
    record({ title: 'Electricity', kind: 'table', shape: { rows: 9, columns: 2 }, updatedAt: at(4) }),
    record({ title: 'Holiday plans', kind: 'document', shape: { rows: 3, columns: 0 }, updatedAt: at(0) })
  ]

  const exact = await find('electricity', records)
  assert.deepEqual(
    exact.map((one) => one.title),
    ['Electricity', 'Office electricity', 'Notes'],
    'the title that is exactly the query beats one that merely holds it, which beats a note'
  )
  assert.equal(exact[0].summary, 'Table, 9 rows, changed 4 days ago')
  assert.equal(exact[2].snippet, 'Made from the office electricity table.', 'the note that mentions what was asked for')

  // Two titles that match the same way: the one changed most recently is first.
  const both = await find('office electricity', [...records, record({ title: 'Office electricity again', updatedAt: at(0), shape: { rows: 5, columns: 1 } })])
  assert.deepEqual(
    both.map((one) => one.title),
    ['Office electricity', 'Office electricity again', 'Notes'],
    'a title that starts with the query beats one that only holds every word'
  )

  assert.deepEqual(await find('holiday', records), [
    { id: records[3].artifactId, title: 'Holiday plans', kind: 'document', summary: 'Document, 3 parts, changed today', snippet: '' }
  ])
})

test('nothing is read off disk, and nothing but a kept sentence comes back as the snippet', async () => {
  // The record is all this is given. There is no reader to hand it, so a file it cannot see cannot leak.
  const records = [record({ title: 'Keys', kind: 'code', shape: { rows: 40, columns: 0 }, notes: ['Pasted in. Orbis has not run it.'], source: 'pasted' })]
  const found = await find('keys', records)
  assert.equal(found.length, 1)
  assert.deepEqual(Object.keys(found[0]).sort(), ['id', 'kind', 'snippet', 'summary', 'title'], 'the row carries no content field at all')
  assert.equal(found[0].snippet, 'Pasted in. Orbis has not run it.')
  assert.equal(found[0].summary, 'Code, 40 lines, changed yesterday')

  // A note longer than a snippet is cut at a word and says it goes on.
  const long = await find('long', [record({ title: 'Long', notes: [`${'word '.repeat(80)}end`] })])
  assert.ok(long[0].snippet.length <= MADE_LIMITS.snippet + 1, long[0].snippet.length.toString())
  assert.match(long[0].snippet, /…$/)
  assert.doesNotMatch(long[0].snippet, /\s…$/, 'no space left hanging before the mark')
})

test('an empty query finds nothing, and nothing a search does can throw', async () => {
  const records = [record({ title: 'Anything' })]
  assert.deepEqual(await find('', records), [])
  assert.deepEqual(await find('   ', records), [])
  assert.deepEqual(await searchArtifacts(undefined, { list: () => records, now: () => NOW }), [])
  assert.deepEqual(await searchArtifacts(42, { list: () => records, now: () => NOW }), [])

  // A reader that refuses, a reader that hands back rubbish, and records that are damaged.
  assert.deepEqual(
    await searchArtifacts('anything', {
      list: () => {
        throw new Error('the store is busy')
      },
      now: () => NOW
    }),
    []
  )
  assert.deepEqual(await searchArtifacts('anything', { list: () => Promise.reject(new Error('gone')), now: () => NOW }), [])
  assert.deepEqual(await searchArtifacts('anything', { list: () => null as unknown as MadeArtifact[], now: () => NOW }), [])
  const broken = [
    null as unknown as MadeArtifact,
    record({ title: '   ' }),
    record({ kind: 'spreadsheet' as never, title: 'Anything at all' }),
    record({ artifactId: '', title: 'Anything whatsoever' }),
    record({ title: 'Anything good', updatedAt: Number.NaN, notes: ['fine' as never, 7 as never], shape: { rows: Number.NaN, columns: 0 } })
  ]
  const found = await searchArtifacts('anything', { list: () => broken, now: () => NOW })
  assert.deepEqual(
    found.map((one) => one.title),
    ['Anything good'],
    'the damaged records are left out rather than drawn as something'
  )
  assert.equal(found[0].summary, 'Table, changed at some point', 'a size and a time that are not numbers are not claimed')
})

test('how long ago it changed is said in days, and the group is capped', async () => {
  assert.equal(changedWhen(NOW - 30_000, NOW), 'changed just now')
  assert.equal(changedWhen(at(0, 1), NOW), 'changed today', 'early this morning is still today')
  assert.equal(changedWhen(at(1, 23), NOW), 'changed yesterday', 'late last night is yesterday, not hours ago')
  assert.equal(changedWhen(at(3), NOW), 'changed 3 days ago')
  assert.equal(changedWhen(at(6), NOW), 'changed 6 days ago')
  assert.equal(changedWhen(at(7), NOW), 'changed on 26 September')
  assert.equal(changedWhen(new Date(2024, 2, 14, 9, 0, 0).getTime(), NOW), 'changed on 14 March 2024', 'another year is named')
  assert.equal(changedWhen(NOW + DAY, NOW), 'changed today', 'a clock that went back is not "in a day"')

  assert.equal(summaryOfMade(record({ title: 'Flow', kind: 'diagram', shape: { rows: 9, columns: 11 }, updatedAt: at(1) }), NOW), 'Diagram, 9 boxes and 11 arrows, changed yesterday')
  assert.equal(summaryOfMade(record({ title: 'Spend', kind: 'plot', shape: { rows: 1, columns: 1 }, updatedAt: at(0) }), NOW), 'Chart, 1 point, changed today')

  const many = Array.from({ length: 40 }, (_, i) => record({ title: `Report ${i}`, kind: 'document', shape: { rows: 2, columns: 0 }, updatedAt: at(i % 9) }))
  assert.equal((await find('report', many)).length, MADE_LIMITS.rows, 'a group, not a second page of results')
  assert.equal((await find('report', many, 2)).length, 2)
  assert.equal((await find('report', many, 99)).length, MADE_LIMITS.rows, 'a caller cannot ask for more than the cap')
})
