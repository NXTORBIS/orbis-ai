import type { ChatMessage, Conversation } from './types'

/**
 * Keeping the answer you are about to throw away.
 *
 * Editing an earlier message, or asking for a different answer, used to cut the conversation at that point and drop
 * everything after it. The new reply is usually better, which is why nobody noticed -- until the time it is not, and
 * the thing you wanted is gone with no way back to it.
 *
 * So nothing is cut any more. What was after the point you changed is kept as a **branch**: the messages, where they
 * split off, and when. The conversation still has one `messages` array -- the path you are looking at -- because
 * every other part of Orbis reads that array and a tree would have meant changing all of them. A branch is simply the
 * other tail, parked.
 *
 * Three rules:
 *
 * **Switching is a swap, never a delete.** Going back to an earlier answer parks the current tail in its place, so
 * the one you are leaving is as recoverable as the one you are returning to. There is no move here that loses
 * anything.
 *
 * **A branch is only ever a tail.** It starts at the message that was changed and runs to the end. It never holds a
 * copy of the part both paths share, so returning to a branch cannot resurrect an older version of a message you have
 * since edited.
 *
 * **Old branches go, and it is said.** Past the cap the oldest are dropped, because a conversation that keeps every
 * discarded answer for ever becomes a file nobody can open. The cap is here, in one place, rather than per-caller.
 */

export interface ConversationBranch {
  readonly id: string
  /** The index in `messages` this tail was cut from: it replaces everything from here on. */
  readonly fromIndex: number
  /** What to call it in a list -- the first few words of its first message. Never written by a model. */
  readonly label: string
  readonly messages: readonly ChatMessage[]
  readonly at: number
}

/** How many parked tails a conversation keeps. Past this the oldest go. */
export const MAX_BRANCHES = 8

/** A conversation that may have parked tails. The field is optional so every file written before this still reads. */
export interface Branched extends Conversation {
  branches?: ConversationBranch[]
}

const WORDS = /\s+/

/** The first few words of a message, for naming a branch. Never a model's words: this is a label, not a summary. */
export function labelFor(messages: readonly ChatMessage[]): string {
  const first = messages.find((m) => m.content.trim() !== '')
  if (!first) return 'Empty'
  const words = first.content.trim().split(WORDS).slice(0, 7).join(' ')
  return words.length > 60 ? `${words.slice(0, 57)}...` : words
}

const newest = (branches: readonly ConversationBranch[]): ConversationBranch[] => [...branches].sort((a, b) => b.at - a.at).slice(0, MAX_BRANCHES)

/**
 * Parks everything from `fromIndex` on, and returns the conversation with that tail removed from the visible path.
 *
 * Called before an edit or a regenerate. A tail with nothing in it parks nothing -- there is no point keeping an
 * empty branch, and one would clutter the list with something that cannot be returned to.
 */
export function parkTail(conversation: Branched, fromIndex: number, at: number, id: string): Branched {
  const tail = conversation.messages.slice(Math.max(0, fromIndex))
  if (tail.length === 0) return conversation
  const branch: ConversationBranch = { id, fromIndex: Math.max(0, fromIndex), label: labelFor(tail), messages: tail, at }
  return {
    ...conversation,
    messages: conversation.messages.slice(0, Math.max(0, fromIndex)),
    branches: newest([branch, ...(conversation.branches ?? [])])
  }
}

/**
 * Goes back to a parked tail, parking whatever is currently in its place.
 *
 * Returns the conversation unchanged when there is no branch by that name, rather than emptying the conversation,
 * which is what a lookup returning undefined would otherwise do.
 */
export function switchToBranch(conversation: Branched, branchId: string, at: number, id: string): Branched {
  const branches = conversation.branches ?? []
  const wanted = branches.find((one) => one.id === branchId)
  if (!wanted) return conversation

  const shared = conversation.messages.slice(0, wanted.fromIndex)
  const leaving = conversation.messages.slice(wanted.fromIndex)
  const kept = branches.filter((one) => one.id !== branchId)
  const parked: ConversationBranch[] =
    leaving.length === 0 ? kept : [{ id, fromIndex: wanted.fromIndex, label: labelFor(leaving), messages: leaving, at }, ...kept]

  return { ...conversation, messages: [...shared, ...wanted.messages], branches: newest(parked) }
}

/** Throws one away on purpose. The only thing here that loses anything, and it is only ever asked for. */
export function dropBranch(conversation: Branched, branchId: string): Branched {
  const branches = (conversation.branches ?? []).filter((one) => one.id !== branchId)
  return { ...conversation, branches }
}

/** What to offer in a list: newest first, with the point each one leaves from. */
export function branchList(conversation: Branched): ConversationBranch[] {
  return [...(conversation.branches ?? [])].sort((a, b) => b.at - a.at)
}

/** One branch read back from disk, or null if it is not one. A damaged record is dropped, never repaired. */
export function readBranch(raw: unknown): ConversationBranch | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return null
  if (!Array.isArray(o.messages) || o.messages.length === 0) return null
  const messages = (o.messages as unknown[]).filter((m): m is ChatMessage => Boolean(m) && typeof (m as ChatMessage).role === 'string' && typeof (m as ChatMessage).content === 'string')
  if (messages.length === 0) return null
  return {
    id: o.id,
    fromIndex: typeof o.fromIndex === 'number' && o.fromIndex >= 0 ? Math.floor(o.fromIndex) : 0,
    label: typeof o.label === 'string' && o.label !== '' ? o.label.slice(0, 80) : labelFor(messages),
    messages,
    at: typeof o.at === 'number' ? o.at : 0
  }
}

/** Every branch in a saved conversation that is really one. */
export function readBranches(raw: unknown): ConversationBranch[] {
  if (!Array.isArray(raw)) return []
  return newest(raw.map(readBranch).filter((one): one is ConversationBranch => one !== null))
}
