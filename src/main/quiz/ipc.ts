import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import { quizPrompt, readQuiz, isQuizRefusal, type Quiz, type QuizDifficulty } from '../../shared/quiz/build.ts'

/**
 * Writing a quiz for the conversation.
 *
 * One channel, because there is one thing to do: ask Orion for questions about a subject and hand back the ones
 * that hold up. The asking and the checking both happen here rather than in the window, for two reasons — the
 * window never sees a model's unchecked answer, and the checks live in one place with tests around them.
 *
 * Nothing is stored here. A quiz belongs to the message it was made for, and the conversation it is in is
 * already saved, so an attempt survives a restart without a store of its own.
 */

export interface QuizIpcOptions {
  getWindow(): BrowserWindow | null
  /** The same one-shot ask the labs and the execution service use. */
  ask(prompt: string): Promise<string | null>
  /** For ids, handed in so this file has no clock of its own. */
  now?(): number
}

export interface QuizAsked {
  about?: unknown
  count?: unknown
  difficulty?: unknown
  /** Text the questions must come from, when the quiz is about something already on screen. */
  source?: unknown
  /** What to say the questions came from. */
  from?: unknown
}

export function registerQuizIpc(o: QuizIpcOptions): void {
  const now = o.now ?? ((): number => Date.now())

  const handle = plainHandle(o)

  handle('quiz:write', async (_event, asked) => {
    const want = (typeof asked === 'object' && asked !== null ? asked : {}) as QuizAsked

    const about = String(want.about ?? '').trim().slice(0, 300)
    const source = typeof want.source === 'string' ? want.source.slice(0, 12_000) : ''
    if (about === '' && source === '') {
      return { problem: 'Nothing says what the quiz should be about.', fix: 'Name a subject.', failed: 'no subject' }
    }

    const count = Math.min(20, Math.max(3, Number(want.count) || 8))
    const difficulty: QuizDifficulty =
      want.difficulty === 'easy' || want.difficulty === 'hard' ? want.difficulty : 'ordinary'

    const subject = about === '' ? 'the text below' : about
    let text: string | null
    try {
      text = await o.ask(quizPrompt({ about: subject, count, difficulty, ...(source === '' ? {} : { source }) }))
    } catch (error) {
      return {
        problem: 'The quiz could not be written.',
        fix: error instanceof Error ? error.message : String(error),
        failed: 'ask threw'
      }
    }
    if (text === null || text.trim() === '') {
      return { problem: 'Orion did not answer.', fix: 'Try again in a moment.', failed: 'no answer' }
    }

    const made = readQuiz(text, {
      about: about === '' ? String(want.from ?? 'what you were reading').slice(0, 120) : about,
      difficulty,
      from: String(want.from ?? (about === '' ? 'this conversation' : about)).slice(0, 160),
      count,
      id: `qz_${now().toString(36)}`,
      now: now()
    })
    if (isQuizRefusal(made)) return made

    // The dropped ones are counted on the quiz itself; what each one got wrong is not sent to the window,
    // because it is of no use there and would only be shown.
    return { quiz: made.quiz satisfies Quiz }
  })
}
