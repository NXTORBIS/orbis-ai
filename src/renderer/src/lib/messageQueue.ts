import type { Attachment } from '../../../shared/types'

/** Messages that can wait behind a reply in one chat. */
export const MAX_QUEUED_MESSAGES = 5

export interface QueuedMessage {
  id: string
  text: string
  attachments: Attachment[]
}

export interface ChatQueue {
  items: QueuedMessage[]
  /** Set when the user stops a reply or a reply fails, so the rest don't fire unattended. */
  paused: boolean
}
