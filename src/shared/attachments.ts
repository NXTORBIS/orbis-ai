import type { Attachment } from './types'

/**
 * The address to draw an attached picture from.
 *
 * An attachment's `content` arrives in two shapes and both are legitimate: bare base64 from the composer, which reads
 * a file and keeps the bytes, and a whole `data:` url from Visual Search, which is what a capture already is.
 * Prefixing the second produces `data:image/png;base64,data:image/png;base64,...` -- a url nothing can decode, which
 * `nim.ts` has a long comment about because it is how Orbis's eyes once appeared not to work.
 *
 * One function, used everywhere a picture is drawn, so the two cannot disagree about which shape they are holding.
 */
export function pictureSrc(attachment: Pick<Attachment, 'content' | 'mimeType'>): string {
  const content = attachment.content ?? ''
  if (content.startsWith('data:')) return content
  return `data:${attachment.mimeType || 'image/jpeg'};base64,${content}`
}
