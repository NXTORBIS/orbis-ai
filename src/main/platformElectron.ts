import { clipboard, ClipboardItem, nativeImage, safeStorage } from 'electron'
import type { ClipboardImage, Platform } from './platform'

/**
 * What the platform's small surface means while Orbis still runs on Electron.
 *
 * This file is one of the few that will be replaced wholesale by a Chromium implementation. Everything it serves —
 * the clipboard history, workflow secrets — depends on the interfaces in `platform.ts` rather than on anything in
 * here, so replacing it is the whole of that change.
 */
export function electronPlatform(): Platform {
  return {
    clipboard: {
      readText: () => Promise.resolve(clipboard.readText()).catch(() => ''),
      writeText: async (text) => clipboard.writeText(text),
      readImage: async () => {
        try {
          for (const item of await clipboard.read()) {
            for (const type of item.types) {
              if (!type.startsWith('image/')) continue
              const blob = (await item.getType(type)) as Blob | null
              if (!blob || typeof blob.arrayBuffer !== 'function') continue
              return { type, bytes: new Uint8Array(await blob.arrayBuffer()) }
            }
          }
        } catch {
          // Nothing readable on the clipboard.
        }
        return null
      },
      writeImage: async (image: ClipboardImage) => {
        await clipboard.write([new ClipboardItem({ [image.type]: new Blob([image.bytes], { type: image.type }) })])
      }
    },
    secrets: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value)
    }
  }
}

/** Kept for the clipboard history, which measures pictures to describe them. */
export const imageSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    const size = image.getSize()
    return size.width > 0 ? size : null
  } catch {
    return null
  }
}
