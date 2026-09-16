/**
 * The few things Orbis's own services need from the machine underneath them.
 *
 * Almost all of Orbis — profiles, workspaces, notes, tasks, personalization, widgets, workflows, updates, Orion —
 * has no business knowing which browser engine it is running on. It needs a disk, and it needs these two small
 * things: somewhere to read and write the clipboard, and somewhere to keep a secret encrypted by the operating
 * system.
 *
 * Naming them here is what lets those services move to Chromium unchanged. They depend on these interfaces; only the
 * implementation behind them is Electron's today, and Chromium's tomorrow. It is also what lets them be tested
 * without a browser at all.
 */

/** A picture on the clipboard, as bytes and the kind of picture it is. */
export interface ClipboardImage {
  type: string
  bytes: Uint8Array
}

export interface ClipboardPort {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  /** The first image on the clipboard, or null when there is none. */
  readImage(): Promise<ClipboardImage | null>
  writeImage(image: ClipboardImage): Promise<void>
}

/**
 * Keeping something secret on this computer. Whether that is possible at all depends on the machine, so it is asked
 * rather than assumed: where it is not, Orbis says so and keeps nothing instead of keeping it badly.
 */
export interface SecretStorePort {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export interface Platform {
  clipboard: ClipboardPort
  secrets: SecretStorePort
}

/** A platform that can do neither, for tests and for anywhere the real one is not available yet. */
export const nullPlatform = (): Platform => ({
  clipboard: {
    readText: async () => '',
    writeText: async () => undefined,
    readImage: async () => null,
    writeImage: async () => undefined
  },
  secrets: {
    available: () => false,
    encrypt: () => {
      throw new Error('This computer cannot encrypt stored secrets.')
    },
    decrypt: () => {
      throw new Error('This computer cannot encrypt stored secrets.')
    }
  }
})
