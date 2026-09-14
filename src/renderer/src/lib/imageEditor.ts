import { createContext, useContext } from 'react'
import type { ChatMessage, Conversation } from '../../../shared/types'

export interface EditableImage {
  src: string
  prompt: string
  seed?: number
  /** Has transparency, so it must stay PNG. */
  alpha?: boolean
  /** Changed by a local tool rather than re-rendered from the prompt. */
  local?: boolean
}

export const ImageEditorContext = createContext<((image: EditableImage) => void) | null>(null)

export const useImageEditor = (): ((image: EditableImage) => void) | null => useContext(ImageEditorContext)

export interface GalleryImage extends EditableImage {
  key: string
  conversationId: string
  conversationTitle: string
  createdAt: number
}

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\((data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)(?:\s+"seed:(\d+)")?\)/g

// Messages are immutable objects, so parsing each one once keeps this cheap while replies stream.
const parsed = new WeakMap<ChatMessage, { prompt: string; src: string; seed?: number }[]>()

function messageImages(message: ChatMessage): { prompt: string; src: string; seed?: number }[] {
  let images = parsed.get(message)
  if (!images) {
    images = message.role === 'assistant' && message.content.includes('data:image/')
      ? [...message.content.matchAll(IMAGE_MARKDOWN)].map((m) => ({ prompt: m[1], src: m[2], seed: m[3] ? Number(m[3]) : undefined }))
      : []
    parsed.set(message, images)
  }
  return images
}

/** Every generated image across the given chats, newest first. */
export function collectImages(conversations: Conversation[]): GalleryImage[] {
  const images: GalleryImage[] = []
  for (const c of conversations) {
    for (const message of c.messages) {
      messageImages(message).forEach((image, i) =>
        images.push({ ...image, key: `${message.id}-${i}`, conversationId: c.id, conversationTitle: c.title, createdAt: message.createdAt, alpha: image.src.startsWith('data:image/png') })
      )
    }
  }
  return images.sort((a, b) => b.createdAt - a.createdAt)
}

/** The seed rides in the Markdown title so a saved chat can still be edited consistently later. */
export function imageMarkdown(image: EditableImage): string {
  const alt = image.prompt.replace(/[[\]\r\n]+/g, ' ').trim() || 'Generated image'
  return `![${alt}](${image.src}${image.seed !== undefined ? ` "seed:${image.seed}"` : ''})`
}
