/**
 * Getting stuck, trying again, and explaining it back.
 *
 * ## The hint ladder
 *
 * Four rungs, and the student chooses when to climb. The first says only *where to look*, the last shows the answer
 * they wrote themselves. Each rung lowers what the attempt proves, and that is stated on screen before the rung is
 * taken -- a hint is not a punishment, but an answer reached with the answer visible is not recall, and recording it
 * as recall would put a lie in the mastery map.
 *
 * Nothing here writes a hint. Orbis cannot produce a hint for somebody else's material without inventing content,
 * so a rung is always one of: where it came from, what shape the answer takes, how much of their own note to
 * reveal, and all of it. The content is the student's own, every time.
 *
 * ## Retrying
 *
 * Something got wrong comes back *soon*, not tomorrow: the whole point of noticing a gap is closing it while the
 * student is still thinking about it. But a thing that has gone wrong three times in a row stops coming back
 * immediately -- at that point it is not a memory problem, and asking a fourth time is just unpleasant. It goes to
 * the mistake book and asks to be looked at properly instead.
 *
 * ## Teach-back
 *
 * Explaining something out loud is the strongest evidence there is, and Orbis cannot mark it. So it does not
 * pretend to: the student explains, *then* sees their own note, and ticks what they actually covered. A tick is
 * their claim, not a grade -- and the one rule is that a teach-back done with the note already open is worth
 * nothing, because it is reading aloud.
 */

import type { EvidenceKind } from './mastery.ts'

// ---------------------------------------------------------------- hints

export type Rung = 'where' | 'shape' | 'half' | 'all'

export interface Hint {
  rung: Rung
  /** What the student is told. Never written by Orbis -- always drawn from their own material. */
  text: string
  /** What it says on the button before they take it. */
  costs: string
  /** What an attempt is still worth after this rung, 0..1. */
  worth: number
}

/** The rungs in order, with what each one does to the value of the attempt. */
export const RUNGS: readonly { rung: Rung; label: string; worth: number; costs: string }[] = [
  { rung: 'where', label: 'Where does this come from?', worth: 0.85, costs: 'Still counts' },
  { rung: 'shape', label: 'What shape is the answer?', worth: 0.6, costs: 'Counts a little less' },
  { rung: 'half', label: 'Show me the first half', worth: 0.3, costs: 'Counts as practice, not recall' },
  { rung: 'all', label: 'Show me all of it', worth: 0, costs: 'Will not count as recall' }
]

/** What shape an answer is, from the answer itself. No guessing at meaning. */
function shapeOf(answer: string): string {
  const words = answer.trim().split(/\s+/).filter(Boolean)
  const lines = answer.split('\n').filter((one) => one.trim()).length
  // A number, possibly with units after it -- and units contain digits too (m/s^2, cm3), so they are allowed here.
  if (/^-?\d+(?:[.,]\d+)?(?:\s*[\p{L}µ°%/^*·\-\d²³]+)?$/u.test(answer.trim())) return 'A number, with units.'
  if (lines > 2) return `A list — ${lines} things.`
  if (/[=><+\-*/^]/.test(answer) && words.length <= 8) return 'A formula or an equation.'
  if (words.length <= 3) return `${words.length} ${words.length === 1 ? 'word' : 'words'}.`
  if (words.length <= 12) return `One sentence — about ${words.length} words.`
  return `A few sentences — about ${words.length} words.`
}

/** Half of it, cut at a word so nothing is chopped mid-word. */
function halfOf(answer: string): string {
  const words = answer.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 2) return `Starts with "${words[0] ?? ''}…"`
  const half = words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(' ')
  return `${half}…`
}

export function hintFor(
  rung: Rung,
  question: { ask: string; answer: string; source: 'flashcard' | 'mistake' | 'review'; where?: string | null }
): Hint {
  const found = RUNGS.find((one) => one.rung === rung) ?? RUNGS[0]
  const text =
    rung === 'where'
      ? question.where
        ? `From ${question.where}.`
        : question.source === 'mistake'
          ? 'From your mistake book — you have had this one wrong before.'
          : 'From one of your own cards.'
      : rung === 'shape'
        ? shapeOf(question.answer)
        : rung === 'half'
          ? halfOf(question.answer)
          : question.answer
  return { rung, text, costs: found.costs, worth: found.worth }
}

/**
 * What an attempt proves, given how much help was taken.
 *
 * `null` means it proves nothing about recall and nothing is recorded -- which is different from recording a
 * failure. Somebody who asked to see the answer did not fail; they looked it up, and looking something up is
 * exposure.
 */
export function evidenceAfterHints(right: boolean, rungsTaken: readonly Rung[]): EvidenceKind | null {
  if (!right) return 'recall-failed'
  const deepest = RUNGS.filter((one) => rungsTaken.includes(one.rung)).reduce((worst, one) => Math.min(worst, one.worth), 1)
  if (deepest === 0) return 'read'
  if (deepest <= 0.3) return 'explained'
  return 'recalled'
}

// ---------------------------------------------------------------- retrying

export interface Retry {
  /** Minutes until it comes back. Zero means in this sitting. */
  inMinutes: number
  /** Said plainly, so nothing happens that was not announced. */
  says: string
  /** When it has gone wrong too often for another immediate go. */
  toMistakeBook: boolean
}

/** How soon something that went wrong comes back, by how many times in a row it has gone wrong. */
export function retryAfter(wrongRun: number): Retry {
  if (wrongRun <= 1) return { inMinutes: 0, says: 'This one comes back before you finish.', toMistakeBook: false }
  if (wrongRun === 2) return { inMinutes: 10, says: 'Back again in about ten minutes.', toMistakeBook: false }
  /*
   * Three in a row is not a memory problem.
   *
   * Asking a fourth time in the same sitting teaches somebody that they cannot do it. It goes to the mistake book
   * and comes back tomorrow, with the suggestion to look at it properly rather than guess again.
   */
  return { inMinutes: 24 * 60, says: 'Three tries is enough for now — this one is worth going back to the notes for.', toMistakeBook: true }
}

// ---------------------------------------------------------------- teach-back

export interface TeachBack {
  conceptId: string | null
  /** What the student said they would explain. */
  about: string
  /** Their own note, revealed only after they have explained. */
  note: string
  /** The things to tick, taken from their own note -- never a checklist Orbis wrote. */
  points: readonly string[]
}

/**
 * The points of their own note, as separate things to tick off.
 *
 * Split on the punctuation and line breaks people actually use. If a note is one unbroken sentence there is one
 * point, and that is correct: inventing three sub-points out of one sentence would be inventing the marking scheme.
 */
export function pointsIn(note: string): string[] {
  const rough = note
    .split(/\n+|(?<=[.;:])\s+|\s+[-•·]\s+/)
    .map((one) => one.replace(/^[\s\-*•·–]+/, '').trim())
    .filter((one) => one.length >= 3)
  const seen = new Set<string>()
  const out: string[] = []
  for (const one of rough) {
    const key = one.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(one.slice(0, 200))
  }
  return out.slice(0, 12)
}

export function teachBackFor(question: { ask: string; answer: string; conceptId?: string | null }): TeachBack {
  return {
    conceptId: question.conceptId ?? null,
    about: question.ask,
    note: question.answer,
    points: pointsIn(question.answer)
  }
}

/**
 * What a teach-back proves.
 *
 * The honest rules, in order: with the note open it is reading aloud and proves nothing; covering none of it is a
 * failed recall; covering most of it without looking is the strongest evidence Orbis can record; covering some of
 * it is understanding without full recall.
 */
export function evidenceAfterTeachBack(covered: number, outOf: number, lookedFirst: boolean): EvidenceKind | null {
  if (lookedFirst) return null
  if (outOf <= 0) return null
  if (covered <= 0) return 'recall-failed'
  const share = covered / outOf
  if (share >= 0.8) return 'taught-back'
  if (share >= 0.4) return 'explained'
  return 'recall-failed'
}

/** What to say about a teach-back, with nothing in it about the person. */
export function sayTeachBack(covered: number, outOf: number, lookedFirst: boolean): string {
  if (lookedFirst) return 'Read through with the note open — worth trying again from memory when you are ready.'
  if (outOf === 0) return 'Nothing written down to compare it with yet.'
  if (covered === 0) return 'None of it came back this time. That is what the note is for.'
  if (covered >= outOf) return 'All of it, from memory. That is the strongest sign there is.'
  return `${covered} of ${outOf} from memory. The rest is what to look at next.`
}
