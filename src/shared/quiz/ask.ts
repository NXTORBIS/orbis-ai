/**
 * Whether a message is asking for a quiz, and which kind of quiz it means.
 *
 * ## Two different things wear the same word
 *
 * "Quiz me on the water cycle" wants something to answer, here, now, with buttons. "Write me a quiz on the water
 * cycle" wants a document — a sheet of questions to print or hand out. Answering the first with a file, or the
 * second with a card nobody can print, is the whole failure this file exists to avoid.
 *
 * So the wording decides, and the decision is made here rather than by a model: "quiz me", "test me", "ask me
 * some questions" is a card; "write", "make me a", "create a", "document", "worksheet", "pdf", "sheet" is a
 * document, and a document request is handed straight to the Creation Engine, which already makes documents.
 * Nothing in this file tries to make a file.
 *
 * ## It is deliberately strict
 *
 * A message that is not plainly one of the two is neither, and Orion answers it normally. Guessing wrong turns a
 * question about quizzes — "how do you write a good quiz question?" — into a quiz, which is the kind of thing
 * that makes an assistant feel like it is not listening.
 */

export type QuizWanted =
  /** Something to answer here, in the conversation. */
  | { kind: 'card'; about: string; count: number; difficulty: QuizDifficulty; pointsBack: boolean }
  /** A document of questions. Handed to the Creation Engine; nothing here makes it. */
  | { kind: 'document'; about: string; count: number; difficulty: QuizDifficulty; pointsBack: boolean }

export type QuizDifficulty = 'easy' | 'ordinary' | 'hard'

/** The most and fewest questions a quiz may have, and what it has when nobody says. */
export const FEWEST = 3
export const MOST = 20
export const USUALLY = 8

/** "quiz me", "test me", "ask me questions" — something to answer. */
const CARD_SAID =
  /\b(?:quiz|test|examine|grill|question)\s+(?:me|us)\b|\b(?:give|ask)\s+me\s+(?:a\s+)?(?:quick\s+)?(?:quiz|test|some\s+questions|questions)\b|\bstart\s+(?:a\s+)?quiz\b|\bi\s+want\s+(?:a\s+)?quiz\b/i

/** "write a quiz", "make a quiz document", "quiz worksheet" — a thing to keep. */
const DOCUMENT_SAID =
  /\b(?:write|make|create|produce|draft|generate|prepare|build)\b[^.!?]{0,40}\b(?:quiz|test|exam|worksheet|question\s+(?:paper|sheet|bank))\b/i

/** Words that mean a file whatever else the message says. */
const FILE_SAID = /\b(?:document|doc|worksheet|sheet|pdf|docx|word|handout|printable|print|paper|download)\b/i

/** A question about quizzes is not a request for one. */
const ABOUT_QUIZZES =
  /\b(?:how|why|what|when|should|could|can|do)\b[^.!?]{0,30}\b(?:a\s+good\s+quiz|quiz\s+(?:question|format|design)|quizz?es\s+work)\b/i

/** "on this", "about that", "from the above" — the subject is something already in the conversation. */
const POINTS_BACK =
  /\b(?:on|about|from|using|based\s+on|out\s+of)\s+(?:this|that|these|those|it|the\s+above|what\s+(?:you|we)\s+(?:just\s+)?(?:said|wrote|discussed)|the\s+(?:article|page|document|reply|answer|text|notes?))\b/i

const EASY = /\b(?:easy|easier|simple|basic|beginner|gentle|warm[\s-]?up)\b/i
const HARD = /\b(?:hard|harder|difficult|tough|challenging|advanced|tricky|expert)\b/i

/** "ten questions", "5 questions", "a quiz of 12". */
const HOW_MANY = /\b(\d{1,2})\s*(?:questions?|items?|q(?:s)?)\b|\b(?:quiz|test)\s+of\s+(\d{1,2})\b/i
const WORD_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20
})

/**
 * What the message is asking for, or null.
 *
 * `null` is the common answer and the safe one: Orion then replies in words, which is what every other message
 * gets.
 */
export function quizWanted(message: string): QuizWanted | null {
  const text = String(message ?? '')
  if (text.trim() === '') return null
  if (ABOUT_QUIZZES.test(text)) return null

  const asCard = CARD_SAID.test(text)
  const asDocument = DOCUMENT_SAID.test(text)
  if (!asCard && !asDocument) return null

  // A file named anywhere wins. "Quiz me — and give me the pdf" is asking for the file, and a card that cannot
  // be printed is not an answer to it.
  const kind: 'card' | 'document' = FILE_SAID.test(text) || (asDocument && !asCard) ? 'document' : 'card'

  return {
    kind,
    about: subjectOf(text),
    count: countIn(text),
    difficulty: difficultyIn(text),
    pointsBack: POINTS_BACK.test(text)
  }
}

/** How hard, when the message says. */
export function difficultyIn(message: string): QuizDifficulty {
  const text = String(message ?? '')
  if (HARD.test(text)) return 'hard'
  if (EASY.test(text)) return 'easy'
  return 'ordinary'
}

/** How many questions, kept inside what a quiz can sensibly be. */
export function countIn(message: string): number {
  const text = String(message ?? '')
  const digits = HOW_MANY.exec(text)
  const said = digits ? Number(digits[1] ?? digits[2]) : NaN
  if (Number.isFinite(said)) return Math.min(MOST, Math.max(FEWEST, said))
  for (const [word, many] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\s+(?:questions?|items?)\\b`, 'i').test(text)) return many
  }
  return USUALLY
}

/**
 * What the quiz is about, taken out of the message.
 *
 * Only ever what the person wrote. When they pointed back — "quiz me on this" — this comes back empty and the
 * caller supplies the thing being pointed at, because only the caller knows what was on screen.
 */
export function subjectOf(message: string): string {
  let text = String(message ?? '').trim()
  if (POINTS_BACK.test(text)) return ''

  // Everything up to and including the asking words is not the subject.
  const after =
    /\b(?:quiz|test|examine|grill|question)\s+(?:me|us)\b|\b(?:give|ask)\s+me\s+(?:a\s+)?(?:quick\s+)?(?:quiz|test|some\s+questions|questions)\b|\b(?:write|make|create|produce|draft|generate|prepare|build)\b[^.!?]{0,40}?\b(?:quiz|test|exam|worksheet|question\s+(?:paper|sheet|bank))\b/i
  const found = after.exec(text)
  if (found) text = text.slice(found.index + found[0].length)

  // How many, how hard and what format go first. Stripping the leading "on" before them left
  // "document on photosynthesis" as "on photosynthesis", because the preposition was not at the front yet.
  text = text
    .replace(/\b(?:with|of|in)?\s*\d{1,2}\s+(?:[a-z-]+\s+){0,2}?(?:questions?|items?|qs?)\b/gi, ' ')
    .replace(/\b(?:easy|easier|simple|basic|beginner|gentle|hard|harder|difficult|tough|challenging|advanced|tricky|expert|quick|short|long)\b/gi, ' ')
    .replace(/\b(?:document|doc|worksheet|sheet|pdf|docx|word|handout|printable|print|paper|download|questions?)\b/gi, ' ')
    .replace(/\bplease\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Then the prepositions, as many as are left at the front: "a quiz document on the Tudors" leaves "on".
  let before = ''
  while (before !== text) {
    before = text
    text = text.replace(/^\s*(?:on|about|covering|for|regarding|of|from|a|an)\b\s*/i, '').trim()
  }

  return text.replace(/[,.!?;:]+\s*$/g, '').trim()
}

/** What to say when a quiz was asked for but nothing says what about. */
export const NOTHING_TO_GO_ON =
  'What should the quiz be about? Say a subject — "quiz me on the water cycle" — or ask about something already in this conversation.'
