/**
 * Taking notes while somebody talks.
 *
 * What this is, said plainly at the top because the whole design turns on it: **Orbis hears this computer's
 * microphone and nothing else.** It does not join a call, it is not in the room's other microphones, and it cannot
 * tell one voice from another. On a video call it hears you clearly and the other people only as much as your speakers
 * leak back into your own microphone, which is usually not at all.
 *
 * That makes this a very good notebook and a bad minute-taker, and it says so rather than letting somebody find out
 * afterwards by reading a summary with half a meeting missing. Every honest thing this can do, it does: the words are
 * transcribed on this machine by the local model, kept with the time each part was said, and turned into a summary
 * and a list of things to do.
 *
 * Three rules:
 *
 * **The transcript is the authority.** A summary and an action list are a model's reading of it, and are marked as
 * such. Where the two disagree the transcript is right, which is why it is always kept and always shown.
 *
 * **A pause is a pause, not a speaker.** Parts are split where somebody stopped talking, because that is a real
 * thing that happened. Nothing here guesses who was speaking, and nothing labels a part with a name.
 *
 * **Nothing is recorded that was not asked for.** A note is made only while it is running, it is obvious on screen
 * that it is running, and the audio itself is never kept -- the words are transcribed and the sound is dropped.
 */

export const MEETING_FORMAT = 1

/** One stretch of talking, between pauses. Never attributed to anybody: this cannot tell voices apart. */
export interface MeetingPart {
  readonly id: string
  /** Milliseconds from the start of the note, so the parts read as a timeline rather than a pile. */
  readonly at: number
  readonly text: string
}

export type MeetingState = 'idle' | 'listening' | 'paused' | 'done'

export interface Meeting {
  readonly id: string
  readonly title: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly parts: readonly MeetingPart[]
  /** Orion's reading of the transcript. Absent until it is asked for, and never written by the recorder. */
  readonly summary?: MeetingSummary
}

export interface MeetingSummary {
  readonly madeAt: number
  /** What was talked about, in a few lines. */
  readonly points: readonly string[]
  /** Things somebody said they would do. Each one quotes the part it came from, so it can be checked. */
  readonly actions: readonly { what: string; from: string }[]
  /** Decisions stated out loud. Same rule: each quotes where it came from. */
  readonly decisions: readonly { what: string; from: string }[]
  /** The model that read it, so the reading is attributable. */
  readonly model: string
}

/** How long a note may run. Four hours: longer than any meeting, short enough that a forgotten one stops. */
export const MAX_MEETING_MS = 4 * 60 * 60 * 1000

/** How much text one note may hold. Past it, recording stops and says so rather than quietly dropping the end. */
export const MAX_MEETING_CHARS = 400_000

const LF = String.fromCharCode(10)

/** Adds what was just heard, at the moment it was heard. Nothing with no words in it is kept. */
export function withPart(meeting: Meeting, text: string, at: number, id: string): Meeting {
  const words = text.trim()
  if (!words) return meeting
  return { ...meeting, parts: [...meeting.parts, { id, at: Math.max(0, at - meeting.startedAt), text: words }] }
}

/** How much has been said, in characters. What decides whether there is room for more. */
export const lengthOf = (meeting: Meeting): number => meeting.parts.reduce((n, one) => n + one.text.length, 0)

/** Whether this note has run out of room or out of time, and why. Null while it may carry on. */
export function mustStop(meeting: Meeting, now: number): string | null {
  if (now - meeting.startedAt >= MAX_MEETING_MS) return 'This note has been running for four hours, so Orbis stopped it.'
  if (lengthOf(meeting) >= MAX_MEETING_CHARS) return 'This note is as long as one note holds, so Orbis stopped it.'
  return null
}

/** A time as minutes and seconds from the start, for reading a timeline. */
export function atText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** The transcript as something a person reads, with the time each part was said. */
export function transcriptText(meeting: Meeting): string {
  return meeting.parts.map((one) => `[${atText(one.at)}] ${one.text}`).join(LF)
}

/**
 * A title from the first thing said, so a note is findable without anybody naming it.
 *
 * The person's own words, cut at a word. Never a model's: a title is how somebody finds a note again, and one that
 * changes when it is regenerated is one they cannot find twice.
 */
export function titleFrom(meeting: Meeting, when: number): string {
  const first = meeting.parts[0]?.text.trim() ?? ''
  if (!first) return `Note, ${new Date(when).toLocaleString()}`
  const words = first.split(/\s+/).slice(0, 8).join(' ')
  return words.length > 70 ? `${words.slice(0, 67)}...` : words
}

// ---------------------------------------------------------------- what the model is asked, and what it may claim

/**
 * What Orion is asked to do with a transcript.
 *
 * The limits in it are not politeness, they are the thing that makes the result usable: a summary that invents an
 * action item produces a task nobody agreed to, and somebody acts on it. So every action and decision has to quote
 * the words it came from, which both makes it checkable and makes inventing one much harder.
 */
export function summaryPrompt(meeting: Meeting): string {
  return [
    'Below is a transcript Orbis took from one microphone. Read it and report what is in it.',
    '',
    'What you must not do:',
    '- Do not invent an action or a decision. If nobody said they would do something, the list is empty, and an empty list is the right answer.',
    '- Do not attribute anything to a named person. This recording cannot tell voices apart, so there is no way to know who said what.',
    '- Do not fill in what you think was probably meant. Report what was said.',
    '',
    'Answer as JSON with exactly these keys:',
    '{"points": ["..."], "actions": [{"what": "...", "from": "the words it came from"}], "decisions": [{"what": "...", "from": "the words it came from"}]}',
    '',
    '"points" is what was talked about, at most eight short lines.',
    '"actions" is things somebody said they would do. "from" must be a phrase that really appears in the transcript.',
    '"decisions" is choices stated out loud, with the same rule for "from".',
    '',
    'Transcript:',
    transcriptText(meeting)
  ].join(LF)
}

/** One line of a summary, cleaned. */
const line = (value: unknown, limit = 300): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')

/**
 * The model's answer, read back and checked against the transcript.
 *
 * The check is the point. An action whose quoted words do not appear in what was actually said is dropped, because
 * that is the failure that matters: a task nobody agreed to, written down as though they had. Dropping it silently
 * would hide the same problem, so how many were dropped is returned.
 */
export function readSummary(raw: unknown, meeting: Meeting, model: string, at: number): { summary: MeetingSummary; dropped: number } {
  const said = transcriptText(meeting).toLowerCase()
  const o = (raw ?? {}) as Record<string, unknown>
  let dropped = 0

  const quoted = (value: unknown): { what: string; from: string }[] => {
    const list = Array.isArray(value) ? value : []
    const out: { what: string; from: string }[] = []
    for (const one of list.slice(0, 20)) {
      const what = line((one as { what?: unknown })?.what)
      const from = line((one as { from?: unknown })?.from, 200)
      if (!what) continue
      // The quote has to be in the transcript. Not a near match: a near match is how a sentence nobody said gets in.
      if (!from || !said.includes(from.toLowerCase())) {
        dropped++
        continue
      }
      out.push({ what, from })
    }
    return out
  }

  const points = (Array.isArray(o.points) ? o.points : []).map((one) => line(one)).filter(Boolean).slice(0, 8)

  return { summary: { madeAt: at, points, actions: quoted(o.actions), decisions: quoted(o.decisions), model }, dropped }
}

/** What to say about a summary, so nobody takes it for the transcript. Always said; never optional. */
export function summaryNote(summary: MeetingSummary, dropped: number): string {
  const base = `Read from the transcript by ${summary.model}. The transcript is what was actually said.`
  if (dropped > 0) {
    return `${base} ${dropped} ${dropped === 1 ? 'item was' : 'items were'} left out because the words quoted for ${dropped === 1 ? 'it' : 'them'} are not in the transcript.`
  }
  return base
}

/** What Orbis can and cannot hear, in the words somebody would use. Shown before recording, every time. */
export const WHAT_IT_HEARS =
  'Orbis hears this computer’s microphone and nothing else. On a call it will hear you clearly and the other people only if your speakers are loud enough to reach your microphone. It cannot tell one voice from another, so nothing is attributed to anybody.'
