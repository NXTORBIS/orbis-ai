/**
 * Reading a student's own material and finding the topics in it.
 *
 * ## What this is not
 *
 * It is not a model and it does not summarise. It finds the lines in somebody's notes that *look like topic
 * headings* and says why each one looked like one, so a person can tick the ones that are. Nothing is added to a
 * syllabus without being ticked.
 *
 * That restraint is the whole design. A tool that reads a chapter and confidently produces "the twelve concepts in
 * this chapter" will be wrong about two or three of them, and a syllabus with invented topics in it sends somebody
 * revising things that are not on their course. Finding lines is a job plain code does reliably; deciding what a
 * course covers is not.
 *
 * ## How a heading is recognised
 *
 * Only from the shape of the text, never from its meaning:
 *
 *   numbered     "3.2 Projectile motion", "(iv) Friction"
 *   headed       a Markdown heading, or a line in capitals
 *   bulleted     a short bullet with no sentence punctuation
 *   colon        "Projectile motion: the path of a thrown object"
 *   short line   a short line on its own between longer paragraphs
 *
 * Each candidate carries which of those it was, so the student can see what Orbis actually noticed rather than
 * trusting a list.
 */

export type Clue = 'numbered' | 'headed' | 'bulleted' | 'colon' | 'short-line'

export interface Candidate {
  /** The topic, cleaned of its numbering and bullets. */
  name: string
  /** Which line it came from, counting from one, so somebody can find it in their own notes. */
  line: number
  clue: Clue
  /** How likely it is a topic, 0..1. Shown as a sort order, never as a fact. */
  confidence: number
}

export interface Found {
  candidates: readonly Candidate[]
  /** How many lines were looked at, so "nothing found" can be told apart from "nothing given". */
  lines: number
  /** Said plainly when there is nothing to show. */
  note: string
}

const MOST_LINES = 4000
const LONGEST_NAME = 120

/** A topic is a few words, not a sentence. Anything longer is prose. */
const LONGEST_TOPIC_WORDS = 9

const NUMBERED = /^\s*(?:\d+(?:\.\d+)*|\(?[ivxlcIVXLC]+\)|[A-Za-z]\)|\(\d+\))[.)]?\s+(.{2,})$/
const HEADING = /^\s*#{1,6}\s+(.{2,})$/
const BULLET = /^\s*[-*•·–]\s+(.{2,})$/
const COLON = /^\s*([^:]{3,60}):\s*\S/
const SENTENCE_END = /[.!?]\s*$/

function clean(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-*•·–#]+/, '')
    .replace(/[\s:;,.]+$/, '')
    .trim()
    .slice(0, LONGEST_NAME)
}

function looksLikeTopic(name: string): boolean {
  if (name.length < 3) return false
  const words = name.split(' ').filter(Boolean)
  if (words.length > LONGEST_TOPIC_WORDS) return false
  // A sentence is not a topic, however short.
  if (SENTENCE_END.test(name) && words.length > 4) return false
  // Something with no letters in it is a page number or a stray symbol.
  if (!/\p{L}/u.test(name)) return false
  return true
}

export function topicsIn(text: string): Found {
  const rows = (text ?? '').split('\n').slice(0, MOST_LINES)
  if (rows.length === 0 || (text ?? '').trim() === '') {
    return { candidates: [], lines: 0, note: 'Nothing to read yet. Paste your notes or a chapter list.' }
  }

  const seen = new Set<string>()
  const out: Candidate[] = []
  const add = (name: string, line: number, clue: Clue, confidence: number): void => {
    const tidy = clean(name)
    if (!looksLikeTopic(tidy)) return
    const key = tidy.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ name: tidy, line, clue, confidence })
  }

  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i]
    const line = i + 1
    const trimmed = raw.trim()
    if (!trimmed) continue

    const heading = HEADING.exec(raw)
    if (heading) {
      add(heading[1], line, 'headed', 0.9)
      continue
    }

    const numbered = NUMBERED.exec(raw)
    if (numbered) {
      add(numbered[1], line, 'numbered', 0.85)
      continue
    }

    // A whole line in capitals is a heading in somebody's handwriting-turned-typing.
    if (trimmed.length <= 60 && trimmed === trimmed.toUpperCase() && /\p{L}{3}/u.test(trimmed)) {
      add(trimmed, line, 'headed', 0.8)
      continue
    }

    const bullet = BULLET.exec(raw)
    if (bullet && !SENTENCE_END.test(bullet[1].trim())) {
      add(bullet[1], line, 'bulleted', 0.6)
      continue
    }

    const colon = COLON.exec(raw)
    if (colon) {
      add(colon[1], line, 'colon', 0.55)
      continue
    }

    /*
     * A short line surrounded by longer ones.
     *
     * The weakest clue by a distance, which is why it scores lowest and why the surrounding lines have to be
     * genuinely longer -- in a list of short lines, being short means nothing.
     */
    const before = rows[i - 1]?.trim() ?? ''
    const after = rows[i + 1]?.trim() ?? ''
    if (trimmed.length <= 45 && !SENTENCE_END.test(trimmed) && (before.length > 70 || after.length > 70)) {
      add(trimmed, line, 'short-line', 0.4)
    }
  }

  out.sort((a, b) => b.confidence - a.confidence || a.line - b.line)

  return {
    candidates: out.slice(0, 200),
    lines: rows.length,
    note:
      out.length === 0
        ? // The honest answer, with what would help rather than a shrug.
          `Nothing in those ${rows.length} lines looked like a topic heading. Headings, numbered lines and short bullets are what Orbis can spot.`
        : `${out.length} ${out.length === 1 ? 'possible topic' : 'possible topics'} in ${rows.length} lines. Tick the ones that are real.`
  }
}

/**
 * The ticked topics, written as a syllabus the importer already understands.
 *
 * Deliberately goes back through the same importer rather than writing concepts directly: one way into the
 * knowledge graph means one set of rules about ids, duplicates and chapters.
 */
export function asSyllabus(subject: string, chapter: string, names: readonly string[]): string {
  const lines = [subject.trim() || 'General', `  ${chapter.trim() || 'Notes'}`]
  for (const name of names) {
    const tidy = clean(name)
    if (tidy) lines.push(`    ${tidy}`)
  }
  return lines.join('\n')
}

/** Which clue, in the words a person would use. */
export const CLUE_WORDS: Readonly<Record<Clue, string>> = {
  headed: 'a heading',
  numbered: 'a numbered line',
  bulleted: 'a bullet',
  colon: 'a word before a colon',
  'short-line': 'a short line on its own'
}
