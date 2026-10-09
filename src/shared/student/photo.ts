/**
 * Reading a photograph of somebody's work.
 *
 * ## What it is for
 *
 * A page of a textbook, a worked solution, a question sheet, the margin of an exercise book. Typing that in is the
 * reason material never makes it into a study app, and a camera skips the typing entirely.
 *
 * ## What it refuses to do
 *
 * **It does not mark the work.** Looking at a photograph of somebody's answer and saying it is wrong is the single
 * most tempting and most dangerous thing here: a model misreading a minus sign would tell a student their correct
 * answer is wrong, and they would believe it. So it reads the picture into text and topics, and the marking stays
 * where marking already lives — the student's own tick, against their own notes.
 *
 * **It does not keep the picture.** The text comes back, the student decides what to keep, and the image is not
 * stored anywhere by Student.
 *
 * **Everything it reads is shown before it is used.** A photograph read wrongly is obvious when the text is on
 * screen, and silent when it goes straight into a syllabus.
 */

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.replace(/[^\S\n]+/g, ' ').trim().slice(0, limit) : '')

export type PhotoKind = 'notes' | 'question' | 'worked-answer' | 'timetable' | 'unreadable'

export interface ReadPhoto {
  /** What it appears to be. A guess, labelled as one on screen. */
  kind: PhotoKind
  /** Everything legible, as written. The student reads this before anything is done with it. */
  words: string
  /** Topics it seems to be about, for ticking into a syllabus. Never added by themselves. */
  topics: string[]
  /** What was unreadable, said plainly rather than quietly skipped. */
  unreadable: string | null
}

export const PHOTO_SYSTEM = `You read a photograph of a student's study material and write out what is in it.

Rules:
- Write out the words you can actually read, as they are written. Do not correct, improve or summarise them.
- Say what the page appears to be: notes, a question, a worked answer, a timetable, or unreadable.
- List the topics it is about, as a few words each, only if they are clearly there.
- If part of it is blurred, cut off or in handwriting you cannot read, say so in "unreadable".
- Never say whether the work is right or wrong. Never mark it. Never comment on the student.
- If you cannot read it at all, say so and return empty words.

Reply with JSON only:
{"kind":"notes","words":"...","topics":["..."],"unreadable":"..."}`

export const PHOTO_PROMPT = 'Read this photograph of my study material.'

export function readPhoto(raw: unknown): ReadPhoto | null {
  if (!raw || typeof raw !== 'object') return null
  const held = raw as Record<string, unknown>
  const kind = text(held.kind, 20)
  const words = text(held.words, 8000)
  const topics = (Array.isArray(held.topics) ? held.topics : [])
    .map((one) => text(one, 120))
    .filter((one) => one.length > 1)
    .slice(0, 30)
  const unreadable = text(held.unreadable, 400) || null

  // Nothing legible and nothing noticed: that is a failed read, not an empty page.
  if (words.length < 2 && topics.length === 0) return null

  return {
    kind:
      kind === 'question' || kind === 'worked-answer' || kind === 'timetable' || kind === 'unreadable' || kind === 'notes'
        ? (kind as PhotoKind)
        : 'notes',
    words,
    topics,
    unreadable
  }
}

/** What the screen offers to do with it, decided by what the picture turned out to be. */
export function whatNext(read: ReadPhoto): { label: string; action: 'cards' | 'syllabus' | 'mistake' | 'nothing' }[] {
  const out: { label: string; action: 'cards' | 'syllabus' | 'mistake' | 'nothing' }[] = []
  if (read.words.length > 60) out.push({ label: 'Make cards from this', action: 'cards' })
  if (read.topics.length > 0) out.push({ label: 'Add these topics to my syllabus', action: 'syllabus' })
  if (read.kind === 'worked-answer' || read.kind === 'question') out.push({ label: 'Write it in my mistake book', action: 'mistake' })
  return out
}

/** The topics, as a syllabus the importer already understands. Ticked first, always. */
export function asSyllabusLines(subject: string, chapter: string, topics: readonly string[]): string {
  const gap = String.fromCharCode(10)
  return [subject.trim() || 'General', `  ${chapter.trim() || 'From a photo'}`, ...topics.map((one) => `    ${one.trim()}`)].join(gap)
}

/** Said on screen about a picture that could not be read, with nothing in it about the photographer. */
export const CANNOT_READ = 'Orbis could not read that picture. A closer, flatter photo in better light usually works.'
