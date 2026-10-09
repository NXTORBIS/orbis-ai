/**
 * Saying what you want instead of pressing it.
 *
 * ## Plain matching, deliberately
 *
 * No model decides what a spoken sentence meant here. The commands are a short list of things somebody actually
 * says out loud, matched by their words, and anything outside that list is **not understood** rather than guessed
 * at. A model guessing wrong at "stop" while a session is running is a thing that loses somebody's work; plain
 * matching that says "I did not catch that" costs them one repeat.
 *
 * ## Nothing destructive without the word for it
 *
 * Starting, pausing, ending and opening screens are all reachable. Deleting anything is not: there is no spoken
 * command in here that destroys a card, a board, a goal or a record, because a microphone is the one input where
 * a misheard word is likely.
 *
 * ## It says what it heard
 *
 * Every command comes back with the sentence it will act on, so the screen can show "starting 25 minutes" before
 * anything happens. Voice that acts silently is voice nobody trusts twice.
 */

export type Command =
  | { kind: 'start-focus'; minutes: number | null; subject: string | null }
  | { kind: 'end-focus' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'break' }
  | { kind: 'what-next' }
  | { kind: 'go'; where: 'home' | 'plan' | 'learn' | 'cards' | 'missions' | 'mastery' | 'goals' | 'study' | 'board' | 'day' | 'progress' | 'orbi' | 'exams' | 'settings' }
  | { kind: 'rest-day' }
  | { kind: 'how-long' }

export interface Heard {
  command: Command
  /** What the screen says before it acts. */
  says: string
}

const WORDS: Record<string, number> = {
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  'twenty five': 25,
  thirty: 30,
  forty: 40,
  'forty five': 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  'an hour': 60,
  'half an hour': 30
}

const SCREENS: { where: Extract<Command, { kind: 'go' }>['where']; words: string[] }[] = [
  { where: 'home', words: ['home', 'dashboard', 'the board'] },
  { where: 'plan', words: ['plan', 'my plan', 'my week', 'schedule'] },
  { where: 'learn', words: ['learn', 'review', 'revision', 'mistakes', 'mix ups', 'mix-ups'] },
  { where: 'cards', words: ['cards', 'flashcards', 'my cards'] },
  { where: 'missions', words: ['missions', 'a mission'] },
  { where: 'mastery', words: ['what i know', 'what you know', 'mastery', 'my topics'] },
  { where: 'goals', words: ['goals', 'tasks', 'my goals'] },
  { where: 'study', words: ['study', 'spaces', 'capsules', 'my library', 'library'] },
  { where: 'board', words: ['whiteboard', 'board', 'draw'] },
  { where: 'day', words: ['today', 'my day', 'the day'] },
  { where: 'progress', words: ['progress', 'my progress', 'stats', 'report'] },
  { where: 'orbi', words: ['orbi', "orbi's room", 'the room'] },
  { where: 'exams', words: ['exams', 'exam', 'my exam', 'exam mode'] },
  { where: 'settings', words: ['settings', 'preferences'] }
]

const tidy = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Minutes, written or spoken. Null when no length was said, which means "use my usual". */
function minutesIn(text: string): number | null {
  const digits = /(\d{1,3})\s*(?:minute|minutes|min|mins)?\b/.exec(text)
  if (digits) {
    const n = Number(digits[1])
    if (n >= 1 && n <= 600) return n
  }
  /*
   * Longest phrase first.
   *
   * "twenty five minutes" contains "five", so checking in the order the list happens to be written heard a
   * twenty-five minute session as a five minute one -- which is the sort of mistake somebody only notices when the
   * timer goes off twenty minutes early.
   */
  for (const [word, value] of Object.entries(WORDS).sort((a, b) => b[0].length - a[0].length)) {
    if (text.includes(word)) return value
  }
  return null
}

/** The subject, when the sentence names one with "on" or "for". Never guessed from a bare noun. */
function subjectIn(text: string): string | null {
  const found = /\b(?:on|for|about)\s+([a-z][a-z\s]{2,30}?)(?:\s+for\b|\s+\d|$)/.exec(text)
  if (!found) return null
  const word = found[1].trim()
  if (!word || /^(a|an|the|me|it|that|this|now|today|minutes?|mins?)$/.test(word)) return null
  /*
   * A length is not a subject.
   *
   * "focus for half an hour" put the words "half an hour" in as a subject, which would then have been shown on the
   * session and counted against a subject nobody is studying.
   */
  if (new RegExp(String.raw`\b(${Object.keys(WORDS).join('|')}|hours?|minutes?|mins?)\b`).test(word)) return null
  // Title case, because it is going to be shown as a subject name.
  return word.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

export function understand(spoken: string): Heard | null {
  const text = tidy(spoken)
  if (!text) return null

  // ---- ending and pausing first: when a session is running these are the words that must not be missed.
  if (/\b(stop|end|finish|done|that's it|thats it)\b/.test(text) && !/\bbreak\b/.test(text)) {
    return { command: { kind: 'end-focus' }, says: 'Finishing the session.' }
  }
  if (/\bpause\b|\bhold on\b|\bwait\b/.test(text)) return { command: { kind: 'pause' }, says: 'Pausing.' }
  if (/\b(resume|carry on|keep going|continue)\b/.test(text)) return { command: { kind: 'resume' }, says: 'Carrying on.' }
  if (/\b(break|rest for a bit|breather)\b/.test(text) && !/\brest day\b/.test(text)) {
    return { command: { kind: 'break' }, says: 'Taking a break.' }
  }

  if (/\brest day\b|\bday off\b|\bdone for today\b/.test(text)) {
    return { command: { kind: 'rest-day' }, says: 'Marking today as a rest day.' }
  }

  if (/\bhow (long|much longer|much time)\b|\btime left\b/.test(text)) {
    return { command: { kind: 'how-long' }, says: 'Checking the time left.' }
  }

  // ---- what to do
  if (/\bwhat (should i|do i|shall i)\b|\bwhat next\b|\bwhat now\b/.test(text)) {
    return { command: { kind: 'what-next' }, says: 'Working out what is worth doing.' }
  }

  // ---- starting
  if (/\b(start|begin|focus|let's go|lets go|work on|study)\b/.test(text)) {
    const minutes = minutesIn(text)
    const subject = subjectIn(text)
    return {
      command: { kind: 'start-focus', minutes, subject },
      says: `Starting${minutes ? ` ${minutes} minutes` : ' a session'}${subject ? ` on ${subject}` : ''}.`
    }
  }

  // ---- going somewhere
  if (/\b(open|show|go to|take me to|see)\b/.test(text)) {
    for (const screen of SCREENS) {
      if (screen.words.some((word) => text.includes(word))) {
        return { command: { kind: 'go', where: screen.where }, says: `Opening ${screen.words[0]}.` }
      }
    }
  }

  // A bare screen name on its own is enough: people say "cards" as often as "open cards".
  for (const screen of SCREENS) {
    if (screen.words.some((word) => text === word)) {
      return { command: { kind: 'go', where: screen.where }, says: `Opening ${screen.words[0]}.` }
    }
  }

  // Not understood, and said as that rather than acted on.
  return null
}

/** Every phrase Orbis knows, for the screen that lists what can be said. */
export const EXAMPLES: readonly string[] = [
  'Start twenty five minutes on Physics',
  'What should I do now?',
  'How long is left?',
  'Pause',
  'Carry on',
  'Take a break',
  'Finish the session',
  'Open my cards',
  'Show my plan',
  'Make today a rest day'
]
