import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSearchable, searchDownloads, type DownloadRow } from './downloadSearch.ts'

const files: Record<string, string> = {
  'C:\\d\\notes.txt': 'first line\nthe Quarterly Budget is final\nlast',
  'C:\\d\\other.md': 'nothing relevant here',
  'C:\\d\\budget-plan.csv': 'a,b,c'
}
const read = async (p: string): Promise<string | null> => files[p] ?? null
const rows: DownloadRow[] = [
  { id: '1', filename: 'notes.txt', path: 'C:\\d\\notes.txt', state: 'completed', exists: true, totalBytes: 40 },
  { id: '2', filename: 'other.md', path: 'C:\\d\\other.md', state: 'completed', exists: true, totalBytes: 20 },
  { id: '3', filename: 'budget-plan.csv', path: 'C:\\d\\budget-plan.csv', state: 'completed', exists: true, totalBytes: 5 },
  { id: '4', filename: 'report.pdf', path: 'C:\\d\\report.pdf', state: 'completed', exists: true, totalBytes: 900 },
  { id: '5', filename: 'gone.txt', path: 'C:\\d\\gone.txt', state: 'completed', exists: false },
  { id: '6', filename: 'half.txt', path: 'C:\\d\\half.txt', state: 'in_progress', exists: true }
]

test('finds the file that contains the words, with the line and a snippet', async () => {
  const r = await searchDownloads(rows, 'quarterly budget', read)
  const hit = r.hits.find((h) => h.id === '1')
  assert.ok(hit && hit.kind === 'content' && hit.line === 2 && /Quarterly Budget/.test(hit.snippet))
})

test('a file matched only by its name is marked as a name match, not a content match', async () => {
  const r = await searchDownloads(rows, 'budget', read)
  assert.equal(r.hits.find((h) => h.id === '3')?.kind, 'name')
})

test('what could not be read is counted, never silently treated as searched', async () => {
  const r = await searchDownloads(rows, 'budget', read)
  assert.equal(r.skipped, 1) // the PDF
  assert.equal(r.missing, 1) // the deleted file
  assert.equal(r.searched, 3)
})

test('unfinished downloads and very short queries do nothing', async () => {
  assert.deepEqual((await searchDownloads(rows, 'a', read)).hits, [])
  assert.ok(!(await searchDownloads(rows, 'half', read)).hits.some((h) => h.id === '6'))
})

test('only plain text of a sensible size is searchable', () => {
  assert.equal(isSearchable('x.txt', 100), true)
  assert.equal(isSearchable('x.pdf', 100), false)
  assert.equal(isSearchable('x.txt', 50 * 1024 * 1024), false)
})
