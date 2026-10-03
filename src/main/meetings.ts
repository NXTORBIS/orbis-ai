import { join } from 'node:path'
import { JsonFile } from './personal/store.ts'
import { dataDirFor } from '../shared/profiles.ts'
import { MEETING_FORMAT, type Meeting, type MeetingPart, type MeetingSummary } from '../shared/meeting.ts'

/**
 * Notes Orbis took while somebody talked, kept between runs.
 *
 * One file per profile, beside that profile's other things, written through the same debounced atomic writer
 * everything else uses. What is stored is the words and when they were said -- never the audio, which is transcribed
 * on this machine and then dropped, because keeping a recording of a room is a different promise from keeping a note
 * of it and nobody asked for the first one.
 */

interface Saved {
  v: number
  notes: Meeting[]
}

/** How many notes are kept. Past this the oldest go: this is a notebook, not an archive. */
export const MAX_MEETINGS = 100

const str = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '')

function readPart(raw: unknown): MeetingPart | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const text = str(o.text, 20_000).trim()
  if (!text || typeof o.id !== 'string') return null
  return { id: o.id.slice(0, 64), at: typeof o.at === 'number' && o.at >= 0 ? Math.round(o.at) : 0, text }
}

function readSummaryRecord(raw: unknown): MeetingSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.madeAt !== 'number') return undefined
  const quoted = (value: unknown): { what: string; from: string }[] =>
    (Array.isArray(value) ? value : [])
      .map((one) => ({ what: str((one as { what?: unknown })?.what, 300), from: str((one as { from?: unknown })?.from, 200) }))
      .filter((one) => one.what !== '')
  return {
    madeAt: o.madeAt,
    points: (Array.isArray(o.points) ? o.points : []).map((one) => str(one, 300)).filter(Boolean).slice(0, 8),
    actions: quoted(o.actions),
    decisions: quoted(o.decisions),
    model: str(o.model, 80)
  }
}

function readNote(raw: unknown): Meeting | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id || typeof o.startedAt !== 'number') return null
  const parts = (Array.isArray(o.parts) ? o.parts : []).map(readPart).filter((one): one is MeetingPart => one !== null)
  const summary = readSummaryRecord(o.summary)
  return {
    id: o.id.slice(0, 64),
    title: str(o.title, 160),
    startedAt: o.startedAt,
    endedAt: typeof o.endedAt === 'number' ? o.endedAt : null,
    parts,
    ...(summary ? { summary } : {})
  }
}

const read = (raw: unknown): Saved => {
  const notes = Array.isArray((raw as { notes?: unknown })?.notes) ? ((raw as { notes: unknown[] }).notes as unknown[]) : []
  return { v: MEETING_FORMAT, notes: notes.map(readNote).filter((one): one is Meeting => one !== null) }
}

export class Meetings {
  private readonly files = new Map<string, JsonFile<Saved>>()
  private readonly userData: string
  private readonly profileId: () => string

  constructor(o: { userData: string; profileId: () => string }) {
    this.userData = o.userData
    this.profileId = o.profileId
  }

  private file(): JsonFile<Saved> {
    const id = this.profileId()
    let found = this.files.get(id)
    if (!found) {
      found = new JsonFile<Saved>(join(this.userData, dataDirFor(id), 'meeting-notes.json'), () => ({ v: MEETING_FORMAT, notes: [] }), read)
      this.files.set(id, found)
    }
    return found
  }

  /** Every note, newest first. */
  async list(): Promise<Meeting[]> {
    const saved = await this.file().read()
    return [...saved.notes].sort((a, b) => b.startedAt - a.startedAt)
  }

  async get(id: string): Promise<Meeting | null> {
    return (await this.list()).find((one) => one.id === id) ?? null
  }

  /** Writes one note, replacing whatever was there under that id. */
  async save(note: Meeting): Promise<void> {
    const file = this.file()
    const saved = await file.read()
    const notes = [note, ...saved.notes.filter((one) => one.id !== note.id)].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_MEETINGS)
    await file.write({ v: MEETING_FORMAT, notes })
  }

  async remove(id: string): Promise<boolean> {
    const file = this.file()
    const saved = await file.read()
    const left = saved.notes.filter((one) => one.id !== id)
    if (left.length === saved.notes.length) return false
    await file.write({ v: MEETING_FORMAT, notes: left })
    return true
  }

  /** Writes anything pending. Called before quitting, so the end of a note is not the part that is lost. */
  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => file.flush()))
  }
}
