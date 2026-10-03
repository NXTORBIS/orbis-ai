/**
 * Talking with Orbis instead of dictating to it.
 *
 * Voice was push-to-talk and nothing else: hold the key, speak, let go, read the answer. That is dictation. A
 * conversation is the loop -- you speak, it answers out loud, and then it listens again without being asked -- and the
 * loop was the part that did not exist.
 *
 * What is here is the part that can be tested: when it should be listening, when it should be speaking, and the
 * several ways a conversation ends. The microphone and the voice belong to the two services that already own them
 * (src/renderer/src/lib/voiceInput.ts and speak.ts); this only decides what should be happening.
 *
 * Three rules:
 *
 * **It never listens while it is speaking.** Not because it technically could not, but because a machine that hears
 * its own voice answers itself, and the recording that catches the tail of its own sentence is the one that produces
 * a reply to nothing.
 *
 * **Silence ends a turn, and a long silence ends the conversation.** Somebody who stops talking has finished their
 * sentence; somebody who says nothing at all has walked away, and a microphone left open because nobody formally
 * closed it is the thing people are right to be uneasy about.
 *
 * **Every way out is a way out.** Interrupting, saying stop, pressing the button, an error, leaving the screen: all of
 * them end it. There is no state this can be in where the only way to stop it is to quit Orbis.
 */

export type ConversationState =
  /** Not in a conversation. */
  | 'off'
  /** Waiting for the person to say something. */
  | 'listening'
  /** They stopped; the words are being worked out. */
  | 'transcribing'
  /** Orbis is answering, in text. */
  | 'thinking'
  /** Orbis is saying the answer out loud. */
  | 'speaking'

export type ConversationEvent =
  | { type: 'start' }
  | { type: 'heard'; text: string }
  | { type: 'nothing-heard' }
  | { type: 'answering' }
  | { type: 'answered'; text: string }
  | { type: 'spoke-to-the-end' }
  | { type: 'interrupted' }
  | { type: 'stop' }
  | { type: 'failed' }

/** How long with nobody saying anything before the conversation ends itself. */
export const GIVE_UP_AFTER_MS = 25_000

/** How many times in a row nothing can be heard before it stops waiting. */
export const QUIET_TURNS_BEFORE_STOPPING = 2

export interface Conversation {
  readonly state: ConversationState
  /** How many turns in a row nobody said anything. */
  readonly quietTurns: number
  /** Why it ended, when it has. Null while it is going. */
  readonly ended: 'asked' | 'nobody-there' | 'interrupted' | 'failed' | null
}

export const OFF: Conversation = Object.freeze({ state: 'off', quietTurns: 0, ended: null })

/** Phrases that end a conversation when they are the whole of what somebody said. */
// The apostrophe is matched in both its shapes: speech transcription produces the curly one, and a person typing
// produces the straight one, and only accepting one of them means "that's all" works and "that’s all" does not.
const ENOUGH = /^\s*(stop|that['’]?s? ?all|thanks,? ?that['’]?s ?all|goodbye|bye|never ?mind|cancel|quiet|be quiet|shut up)\s*[.!]?\s*$/i

/** Whether what somebody said was them ending the conversation rather than asking something. */
export const saidStop = (text: string): boolean => ENOUGH.test(text)

/**
 * Where a conversation goes next.
 *
 * A pure table, so the loop can be read in one place rather than inferred from which handler happened to fire. Every
 * state has a way out, and `stop` works from all of them -- that is checked by a test rather than left to inspection.
 */
export function next(now: Conversation, event: ConversationEvent): Conversation {
  // Asked to stop: from anywhere, always, including before it has started.
  if (event.type === 'stop') return { state: 'off', quietTurns: 0, ended: 'asked' }
  if (event.type === 'failed') return { state: 'off', quietTurns: 0, ended: 'failed' }

  switch (now.state) {
    case 'off':
      return event.type === 'start' ? { state: 'listening', quietTurns: 0, ended: null } : now

    case 'listening':
      if (event.type === 'heard') {
        // Saying "stop" is stopping, not a question to answer.
        if (saidStop(event.text)) return { state: 'off', quietTurns: 0, ended: 'asked' }
        return { state: 'transcribing', quietTurns: 0, ended: null }
      }
      if (event.type === 'nothing-heard') {
        const quiet = now.quietTurns + 1
        // Nobody there. Ending is the honest answer; a microphone left open because nothing formally closed it is
        // exactly what people are right to be uneasy about.
        return quiet >= QUIET_TURNS_BEFORE_STOPPING ? { state: 'off', quietTurns: 0, ended: 'nobody-there' } : { state: 'listening', quietTurns: quiet, ended: null }
      }
      return now

    case 'transcribing':
      return event.type === 'answering' ? { state: 'thinking', quietTurns: 0, ended: null } : now

    case 'thinking':
      // An answer with nothing in it is not worth saying out loud; go back to listening.
      if (event.type === 'answered') return { state: event.text.trim() ? 'speaking' : 'listening', quietTurns: 0, ended: null }
      return now

    case 'speaking':
      // Interrupting is not an error and does not end the conversation: it is somebody wanting to say the next thing.
      if (event.type === 'interrupted') return { state: 'listening', quietTurns: 0, ended: null }
      if (event.type === 'spoke-to-the-end') return { state: 'listening', quietTurns: 0, ended: null }
      return now

    default:
      return now
  }
}

/** Whether the microphone should be open right now. Never while it is speaking. */
export const shouldListen = (one: Conversation): boolean => one.state === 'listening'

/** Whether Orbis should be talking right now. */
export const shouldSpeak = (one: Conversation): boolean => one.state === 'speaking'

/** What to show, in the words somebody would use. Null when there is nothing to say. */
export function statusOf(one: Conversation): string | null {
  switch (one.state) {
    case 'listening':
      return one.quietTurns > 0 ? 'Still listening' : 'Listening'
    case 'transcribing':
      return 'Working out what you said'
    case 'thinking':
      return 'Thinking'
    case 'speaking':
      return 'Speaking — start talking to interrupt'
    default:
      return null
  }
}

/** Why it ended, said plainly. Null when it was asked to stop, which needs no explanation. */
export function endingNote(one: Conversation): string | null {
  if (one.ended === 'nobody-there') return 'Nobody said anything, so Orbis stopped listening.'
  if (one.ended === 'failed') return 'Something went wrong with the microphone, so the conversation stopped.'
  return null
}
