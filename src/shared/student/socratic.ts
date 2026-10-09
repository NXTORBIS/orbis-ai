/**
 * A tutor that asks instead of telling.
 *
 * ## What it is for
 *
 * Reading an explanation feels like understanding and is mostly gone by tomorrow. Producing the answer yourself is
 * what makes it stick. So this asks a question, reads the reply, and asks the next one — each built on what the
 * student just said — until they can say the thing themselves.
 *
 * ## Why every rule here is about stopping
 *
 * A tutor you cannot escape is a trap, and a tutor that keeps asking a student who is lost is unkind. So:
 *
 * - **"Just tell me" is on every turn.** Always, and it always works immediately.
 * - **Six questions, then it tells you anyway.** Past that the questioning has stopped being teaching.
 * - **Two blanks in a row and it stops by itself.** "I don't know" twice means the questions are pitched wrong,
 *   which is the tutor's fault and not the student's.
 * - **It never says the student is wrong.** It says what is true and asks the next question.
 *
 * ## What it is worth
 *
 * Getting there through questions records `explained` — understanding — and not `recalled`. The student produced
 * it, which is real, but they produced it with scaffolding, and recall means producing it without.
 */

import type { EvidenceKind } from './mastery.ts'

export type Turn = { who: 'orbis'; text: string } | { who: 'student'; text: string }

export interface Conversation {
  conceptId: string
  topic: string
  turns: Turn[]
  /** Questions asked so far. The cap is on these, not on the turns. */
  asked: number
  /** Finished, and how. */
  ended: null | 'got-there' | 'told' | 'gave-up' | 'left'
}

/** Past this many questions, the tutor explains it instead. */
export const MOST_QUESTIONS = 6

/** Two of these in a row and the questions were pitched wrong. */
const BLANKS = ['i dont know', "i don't know", 'no idea', 'dunno', 'no', 'nope', 'not sure', 'idk', '?']

export const SOCRATIC_SYSTEM = `You are teaching one student one topic by asking them questions, never by explaining.

How to do it:
- Ask exactly one question per reply. Never two. Never a question plus an explanation.
- Start from something they already know, and build toward the idea one step at a time.
- When they answer, say in a few words what is true about their answer, then ask the next question.
- Never say they are wrong. Say what is actually true, and ask something that takes them to it.
- Never give the answer, however they ask inside the conversation. The student has a separate button for that.
- When they have said the idea themselves, stop asking and say so in one short sentence beginning "That is it".
- If they say they do not know twice, stop and say "Let me just tell you" and nothing else.
- Short sentences. No praise, no encouragement, no comment on the student.

Reply with JSON only:
{"say":"what you say to them","asking":true,"done":false}
"asking" is false when you are not asking a question. "done" is true only when they have said the idea themselves.`

export function firstPrompt(options: { topic: string; subject: string | null; band: string; missing: string | null; knows: readonly string[] }): string {
  const lines = [`Topic: ${options.topic}`]
  if (options.subject) lines.push(`Subject: ${options.subject}`)
  lines.push(`Age group: ${options.band}`)
  if (options.missing) lines.push(`Where they are stuck: ${options.missing}`)
  if (options.knows.length > 0) lines.push(`Things they already know, so build from these:\n${options.knows.slice(0, 8).map((one) => `- ${one}`).join('\n')}`)
  lines.push('Ask your first question.')
  return lines.join('\n')
}

/** The conversation so far, as the model sees it. Nothing about the student beyond what they said here. */
export function turnsPrompt(conversation: Conversation): string {
  return conversation.turns.map((one) => `${one.who === 'orbis' ? 'You' : 'Student'}: ${one.text}`).join('\n')
}

export interface Reply {
  say: string
  asking: boolean
  done: boolean
}

export function readReply(raw: unknown): Reply | null {
  if (!raw || typeof raw !== 'object') return null
  const held = raw as Record<string, unknown>
  const say = typeof held.say === 'string' ? held.say.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
  if (say.length < 2) return null
  return { say, asking: held.asking !== false, done: held.done === true }
}

/** Whether a student's reply was a blank. Two of these in a row ends it. */
export function isBlank(text: string): boolean {
  const tidy = text.toLowerCase().replace(/[^\p{L}\s'?]/gu, '').replace(/\s+/g, ' ').trim()
  return tidy.length === 0 || BLANKS.includes(tidy)
}

export function newConversation(conceptId: string, topic: string): Conversation {
  return { conceptId, topic, turns: [], asked: 0, ended: null }
}

/**
 * What happens next, decided here rather than by the model.
 *
 * The model proposes what to say; these rules decide whether the conversation carries on. Leaving the stopping to
 * a model would mean a model deciding how long somebody has to be questioned, which is exactly the decision it
 * should not have.
 */
export function advance(
  conversation: Conversation,
  said: string,
  reply: Reply | null
): { conversation: Conversation; stop: null | 'told' | 'gave-up' | 'got-there'; say: string } {
  const withStudent: Conversation = { ...conversation, turns: [...conversation.turns, { who: 'student', text: said.slice(0, 2000) }] }

  // Two blanks in a row: the questions were wrong for them, so stop asking.
  const recent = withStudent.turns.filter((one) => one.who === 'student').slice(-2)
  if (recent.length === 2 && recent.every((one) => isBlank(one.text))) {
    return {
      conversation: { ...withStudent, ended: 'gave-up' },
      stop: 'gave-up',
      say: 'Let me just tell you.'
    }
  }

  if (!reply) {
    return {
      conversation: { ...withStudent, ended: 'told' },
      stop: 'told',
      say: 'Nothing came back. Let me just tell you instead.'
    }
  }

  const asked = withStudent.asked + (reply.asking ? 1 : 0)
  const next: Conversation = { ...withStudent, asked, turns: [...withStudent.turns, { who: 'orbis', text: reply.say }] }

  if (reply.done) return { conversation: { ...next, ended: 'got-there' }, stop: 'got-there', say: reply.say }

  // The cap, kept here so no prompt can talk its way past it.
  if (asked >= MOST_QUESTIONS) {
    return { conversation: { ...next, ended: 'told' }, stop: 'told', say: reply.say }
  }

  return { conversation: next, stop: null, say: reply.say }
}

/**
 * What a finished conversation proves.
 *
 * Getting there through questions is understanding, not recall: they produced it, with scaffolding. Being told is
 * exposure. Giving up records nothing at all -- a student who could not answer has not failed at anything, and a
 * wrong-pitched question is not evidence about them.
 */
export function evidenceFor(ended: Conversation['ended']): EvidenceKind | null {
  if (ended === 'got-there') return 'explained'
  if (ended === 'told') return 'read'
  return null
}

/** What the screen says when it finishes, with nothing about the student in it. */
export function sayEnd(ended: Conversation['ended']): string {
  switch (ended) {
    case 'got-there':
      return 'You said it yourself, which is the part that sticks.'
    case 'told':
      return 'That one is written out above. Worth coming back to it from memory later.'
    case 'gave-up':
      return 'Those questions were not the right way in. The explanation is above instead.'
    default:
      return ''
  }
}
