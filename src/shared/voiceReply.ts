/**
 * Reading an answer out loud: the rules, with no browser anywhere near them.
 *
 * Orbis had one microphone for the whole application and no single place that spoke. Reading aloud lived inside one
 * menu on one kind of message, which meant three things were true at once: nothing else in Orbis could speak; two
 * messages could be read at the same time, because nothing knew about anything else; and speaking carried straight on
 * while somebody held the microphone button down and talked over it.
 *
 * What is here is the part that can be tested: what to say out loud for text that was written to be looked at, and
 * when speaking has to stop. The speaking itself is one file in the window (src/renderer/src/lib/speak.ts), for the
 * same reason there is one microphone.
 *
 * The rule that matters: **speaking stops the moment the microphone opens.** Not fades, not finishes the sentence --
 * stops. Somebody who starts talking has decided they have heard enough, and a machine that keeps talking over them
 * is a machine they will turn off.
 */

/** What Orbis is doing with its voice. */
export type SpeechState = 'silent' | 'speaking'

/** Why speaking stopped, so what happens next can be different for each. */
export type SpeechStop =
  /** It reached the end. */
  | 'finished'
  /** Somebody asked it to stop. */
  | 'asked'
  /** The microphone opened: somebody started talking. */
  | 'interrupted'
  /** Something went wrong saying it. */
  | 'failed'

/** Nothing longer than this is read in one go. Past it the rest is dropped, and the person is told rather than cut off mid-word. */
export const MAX_SPOKEN = 6000

const FENCE = /```[\s\S]*?```/g
const INLINE_CODE = /`([^`]+)`/g
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g
const HEADING = /^#{1,6}\s+/gm
const EMPHASIS = /(\*\*|__|\*|_)(?=\S)([\s\S]*?\S)\1/g
const BULLET = /^\s*[-*+]\s+/gm
const QUOTE = /^\s*>\s?/gm
const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/gm
const CITATION = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g
const SPACE = /[ \t]+/g
const BLANK = /\n{3,}/g

/**
 * What to say out loud for text that was written to be read on a screen.
 *
 * Markdown read literally is unbearable -- "star star important star star" -- and a code block read aloud is noise
 * nobody can follow. So code blocks are named rather than read, links become their words, and a citation like [2]
 * becomes "source 2", which is what somebody would say. Nothing is summarised or reworded: it is the same words,
 * with the marks that only mean something on a screen taken out.
 */
export function speakable(markdown: string): { text: string; shortened: boolean } {
  const blocks = (markdown.match(FENCE) ?? []).length
  let text = markdown
    .replace(FENCE, blocks === 1 ? ' (there is a block of code here) ' : ' (there is a block of code here) ')
    .replace(IMAGE, (_m, alt: string) => (alt.trim() ? ` (an image: ${alt}) ` : ' (an image) '))
    .replace(LINK, '$1')
    .replace(HEADING, '')
    .replace(EMPHASIS, '$2')
    .replace(INLINE_CODE, '$1')
    .replace(RULE, '')
    .replace(BULLET, '')
    .replace(QUOTE, '')
    .replace(CITATION, (_m, numbers: string) => {
      const list = numbers.split(',').map((n) => n.trim())
      return list.length === 1 ? ` (source ${list[0]})` : ` (sources ${list.join(', ')})`
    })
    .replace(SPACE, ' ')
    .replace(BLANK, '\n\n')
    .trim()

  const shortened = text.length > MAX_SPOKEN
  if (shortened) {
    // Cut at a sentence rather than mid-word, and say that there is more.
    const cut = text.slice(0, MAX_SPOKEN)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    text = `${(end > MAX_SPOKEN / 2 ? cut.slice(0, end + 1) : cut).trim()} That is as much as I will read out; the rest is on the screen.`
  }
  return { text, shortened }
}

/**
 * Whether speaking should stop, given what just happened.
 *
 * One function so every caller agrees. The microphone opening always wins: it is the one event that means the person
 * has decided they have heard enough.
 */
export function shouldStopSpeaking(event: { microphoneOpen?: boolean; asked?: boolean; leftTheScreen?: boolean }): SpeechStop | null {
  if (event.microphoneOpen) return 'interrupted'
  if (event.asked) return 'asked'
  // Leaving the conversation that was being read is asking, in a different way.
  if (event.leftTheScreen) return 'asked'
  return null
}

/** What to tell somebody when speaking ended for a reason they did not choose. Nothing for the ordinary ones. */
export function stopNote(stop: SpeechStop): string | null {
  if (stop === 'failed') return 'Orbis could not read that out.'
  // Finishing, being asked, and being talked over are all plainly visible; saying so would be noise.
  return null
}
