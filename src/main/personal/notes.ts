import type { Note, NoteFilter } from '../../shared/notes.ts'
import { filterNotes, newNote, noteFromPage, normalizeNote, noteTags, noteToMarkdown } from '../../shared/notes.ts'
import { Collection, personalFile } from './store.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'

/** Notes as they are kept and changed: one file of notes, searched and edited through here. */
export class NotesStore {
  private readonly notes: Collection<Note>

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.notes = new Collection<Note>(personalFile(userData, DEFAULT_PROFILE_ID, 'notes.json'), normalizeNote, 20_000)
  }

  /** Moves to another profile's notes. Each profile keeps its own; the default profile keeps what was there before. */
  async useProfile(profileId: string): Promise<void> {
    await Promise.all([
      this.notes.usePath(personalFile(this.userData, profileId, 'notes.json')),
    ])
  }

  onChange(listener: () => void): () => void {
    return this.notes.onChange(listener)
  }

  all(): Promise<Note[]> {
    return this.notes.all()
  }

  get(id: string): Promise<Note | null> {
    return this.notes.get(id)
  }

  async search(filter: NoteFilter = {}): Promise<Note[]> {
    return filterNotes(await this.all(), filter)
  }

  async tags(): Promise<{ tag: string; count: number }[]> {
    return noteTags(await this.all())
  }

  /** Creates a note; anything not given takes its default. */
  create(patch: Partial<Note> = {}): Promise<Note> {
    return this.notes.put(newNote(patch))
  }

  /** Saves a whole note, stamping when it changed (unless only its place in the list changed). */
  async save(note: Note, touch = true): Promise<Note> {
    return this.notes.put({ ...note, updatedAt: touch ? Date.now() : note.updatedAt })
  }

  async update(id: string, patch: Partial<Note>): Promise<Note> {
    const current = await this.get(id)
    if (!current) throw new Error('That note no longer exists.')
    return this.save({ ...current, ...patch, id: current.id })
  }

  remove(id: string): Promise<boolean> {
    return this.notes.remove(id)
  }

  /** Archives instead of deleting, so nothing is lost by accident. */
  archive(id: string, archived: boolean): Promise<Note> {
    return this.update(id, { archived })
  }

  /** A note from the page in front, quoting the selection when there is one. */
  fromPage(page: { url: string; title: string; selection?: string }): Promise<Note> {
    return this.notes.put(noteFromPage(page))
  }

  /** Adds text to the end of a note (used when saving several things to the same note). */
  async append(id: string, text: string): Promise<Note> {
    const note = await this.get(id)
    if (!note) throw new Error('That note no longer exists.')
    return this.save({ ...note, body: `${note.body.trimEnd()}\n\n${text.trim()}`.trim() })
  }

  async exportMarkdown(ids?: string[]): Promise<string> {
    const notes = await this.all()
    return notes
      .filter((n) => !ids || ids.includes(n.id))
      .map((n) => noteToMarkdown(n))
      .join('\n---\n\n')
  }

  /** Imports notes from a JSON export; each gets a new id so nothing is overwritten. */
  async importJson(json: string): Promise<Note[]> {
    const raw: unknown = JSON.parse(json)
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { notes?: unknown[] })?.notes) ? (raw as { notes: unknown[] }).notes : []
    const imported: Note[] = []
    for (const item of list) {
      const note = normalizeNote({ ...(item as object), id: crypto.randomUUID() })
      if (note) imported.push(await this.notes.put(note))
    }
    return imported
  }

  flush(): Promise<void> {
    return this.notes.flush()
  }
}
