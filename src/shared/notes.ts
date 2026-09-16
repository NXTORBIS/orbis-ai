/**
 * Notes: what a note is, how notes are searched, sorted and tidied, and how they are read back safely. Pure — no
 * storage, no browser — so the rules can be tested on their own.
 */

export interface NoteSource {
  /** The page a note was taken from, when it was. */
  url: string
  title: string
  /** The text that was selected, when the note came from a selection. */
  quote?: string
  savedAt: number
}

export interface Note {
  id: string
  title: string
  /** Plain text with Markdown-style headings, lists and links; kept as typed. */
  body: string
  tags: string[]
  pinned: boolean
  archived: boolean
  color: NoteColor
  createdAt: number
  updatedAt: number
  source?: NoteSource
}

export const NOTE_COLORS = ['default', 'cyan', 'green', 'amber', 'red', 'violet'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const MAX_NOTE_BODY = 100_000
export const MAX_TAGS = 20

export type NoteSort = 'updated' | 'created' | 'title'

export interface NoteFilter {
  query?: string
  tag?: string
  /** Archived notes are hidden unless asked for. */
  archived?: boolean
  sort?: NoteSort
}

const now = (): number => Date.now()

export function newNote(patch: Partial<Note> = {}): Note {
  const time = patch.createdAt ?? now()
  return {
    id: patch.id ?? crypto.randomUUID(),
    title: '',
    body: '',
    tags: [],
    pinned: false,
    archived: false,
    color: 'default',
    createdAt: time,
    updatedAt: patch.updatedAt ?? time,
    ...patch
  }
}

export const cleanTag = (tag: string): string => tag.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 30).toLowerCase()

/** A note as it should be stored: trimmed, capped, with tidy unique tags. */
export function normalizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Note>
  if (typeof r.id !== 'string' || !r.id) return null
  const body = typeof r.body === 'string' ? r.body.slice(0, MAX_NOTE_BODY) : ''
  const source = r.source && typeof r.source === 'object' && typeof r.source.url === 'string' ? { url: r.source.url.slice(0, 2048), title: String(r.source.title ?? '').slice(0, 300), ...(r.source.quote ? { quote: String(r.source.quote).slice(0, 5000) } : {}), savedAt: Number(r.source.savedAt) || now() } : undefined
  return {
    id: r.id,
    title: (typeof r.title === 'string' ? r.title : '').replace(/\s+/g, ' ').trim().slice(0, 200),
    body,
    tags: [...new Set((Array.isArray(r.tags) ? r.tags : []).map((t) => cleanTag(String(t))).filter(Boolean))].slice(0, MAX_TAGS),
    pinned: r.pinned === true,
    archived: r.archived === true,
    color: NOTE_COLORS.includes(r.color as NoteColor) ? (r.color as NoteColor) : 'default',
    createdAt: Number(r.createdAt) || now(),
    updatedAt: Number(r.updatedAt) || Number(r.createdAt) || now(),
    ...(source ? { source } : {})
  }
}

/** The title to show: the given one, else the note's first line, else a placeholder. */
export function noteTitle(note: Note): string {
  if (note.title) return note.title
  const line = note.body.split('\n').find((l) => l.trim())
  return line ? line.replace(/^#+\s*/, '').trim().slice(0, 80) : 'Untitled note'
}

export const notePreview = (note: Note, length = 140): string => {
  const body = note.title ? note.body : note.body.replace(/^.*\n?/, '')
  return body.replace(/\s+/g, ' ').trim().slice(0, length)
}

/** Every tag in use, most used first. */
export function noteTags(notes: Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const note of notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

const matches = (note: Note, query: string): boolean => {
  const haystack = `${note.title} ${note.body} ${note.tags.join(' ')} ${note.source?.url ?? ''}`.toLowerCase()
  // Every word must appear somewhere; quoted parts must appear together.
  const terms = query.toLowerCase().match(/"[^"]+"|\S+/g) ?? []
  return terms.every((term) => haystack.includes(term.replace(/"/g, '')))
}

/** Notes for a filter: pinned ones first, then by the chosen order. */
export function filterNotes(notes: Note[], filter: NoteFilter = {}): Note[] {
  const sort = filter.sort ?? 'updated'
  return notes
    .filter((n) => Boolean(n.archived) === Boolean(filter.archived))
    .filter((n) => !filter.tag || n.tags.includes(filter.tag))
    .filter((n) => !filter.query?.trim() || matches(n, filter.query.trim()))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sort === 'title') return noteTitle(a).localeCompare(noteTitle(b))
      return sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt
    })
}

/** A note written as Markdown, for export or the clipboard. */
export function noteToMarkdown(note: Note): string {
  const parts = [`# ${noteTitle(note)}`, '']
  if (note.tags.length) parts.push(note.tags.map((t) => `#${t}`).join(' '), '')
  parts.push(note.body.trim())
  if (note.source) parts.push('', `Source: [${note.source.title || note.source.url}](${note.source.url})`)
  return parts.join('\n').trim() + '\n'
}

/** A note from a page: the selection as a quote, with the page recorded as its source. */
export function noteFromPage(page: { url: string; title: string; selection?: string }, time = now()): Note {
  const quote = page.selection?.trim().slice(0, 5000)
  return newNote({
    title: page.title.slice(0, 200),
    body: quote ? quote.split('\n').map((l) => `> ${l}`).join('\n') + '\n' : '',
    source: { url: page.url, title: page.title, ...(quote ? { quote } : {}), savedAt: time },
    createdAt: time
  })
}
