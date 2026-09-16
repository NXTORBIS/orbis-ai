import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTag, filterNotes, newNote, noteFromPage, noteTags, noteTitle, noteToMarkdown, normalizeNote } from '../shared/notes.ts'

const note = (patch: Parameters<typeof newNote>[0]): ReturnType<typeof newNote> => newNote(patch)

test('a stored note is cleaned up: trimmed title, tidy unique tags, known colour', () => {
  const clean = normalizeNote({ id: 'n1', title: '  My   note  ', body: 'x'.repeat(200_000), tags: ['Work', 'work', '  a b!  ', ''], color: 'neon', pinned: 'yes', createdAt: 5 })
  assert.equal(clean?.title, 'My note')
  assert.equal(clean?.body.length, 100_000)
  assert.deepEqual(clean?.tags, ['work', 'a-b'])
  assert.equal(clean?.color, 'default')
  assert.equal(clean?.pinned, false)
  assert.equal(clean?.updatedAt, 5)
  assert.equal(normalizeNote({ title: 'no id' }), null)
  assert.equal(cleanTag('C++ / Rust!'), 'c-rust')
})

test('a note without a title is named by its first line', () => {
  assert.equal(noteTitle(note({ body: '# Shopping list\nmilk' })), 'Shopping list')
  assert.equal(noteTitle(note({ title: 'Named', body: 'x' })), 'Named')
  assert.equal(noteTitle(note({ body: '   ' })), 'Untitled note')
})

test('search matches words anywhere and quoted phrases together; pinned notes come first', () => {
  const notes = [
    note({ id: 'a', title: 'Groceries', body: 'milk and bread', tags: ['home'], updatedAt: 10 }),
    note({ id: 'b', title: 'Reading', body: 'bread baking book', updatedAt: 30 }),
    note({ id: 'c', title: 'Old', body: 'archived thing', archived: true, updatedAt: 40 }),
    note({ id: 'd', title: 'Pinned', body: 'milk', pinned: true, updatedAt: 1 })
  ]
  assert.deepEqual(filterNotes(notes).map((n) => n.id), ['d', 'b', 'a'])
  assert.deepEqual(filterNotes(notes, { query: 'milk' }).map((n) => n.id), ['d', 'a'])
  assert.deepEqual(filterNotes(notes, { query: 'bread book' }).map((n) => n.id), ['b'])
  assert.deepEqual(filterNotes(notes, { query: '"bread baking"' }).map((n) => n.id), ['b'])
  assert.deepEqual(filterNotes(notes, { archived: true }).map((n) => n.id), ['c'])
  assert.deepEqual(filterNotes(notes, { tag: 'home' }).map((n) => n.id), ['a'])
  assert.deepEqual(noteTags(notes), [{ tag: 'home', count: 1 }])
})

test('a note taken from a page quotes the selection and keeps the source', () => {
  const made = noteFromPage({ url: 'https://example.com/a', title: 'Example', selection: 'first line\nsecond line' }, 1000)
  assert.equal(made.body, '> first line\n> second line\n')
  assert.equal(made.source?.url, 'https://example.com/a')
  const markdown = noteToMarkdown({ ...made, tags: ['research'] })
  assert.match(markdown, /^# Example/)
  assert.match(markdown, /#research/)
  assert.match(markdown, /Source: \[Example\]\(https:\/\/example\.com\/a\)/)
})
