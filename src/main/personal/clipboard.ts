import { clipboard, ClipboardItem, nativeImage } from 'electron'
import { join } from 'node:path'
import type { ClipboardSettings, ClipItem, ClipKind } from '../../shared/clipboardHistory'
import { addClip, clipKind, clipPreview, DEFAULT_CLIPBOARD_SETTINGS, MAX_CLIP_IMAGE_BYTES, normalizeClip, normalizeClipboardSettings, pruneClips, searchClips, shouldCapture } from '../../shared/clipboardHistory'
import { Collection, JsonFile } from './store'

export interface ClipboardContext {
  /** Whether the page in front is a private tab, and which page it is, so copies can be attributed or skipped. */
  private?: boolean
  url?: string
  title?: string
}

export interface ClipboardHistoryOptions {
  userData: string
  /** Whether Orbis is the app in front: it is watched closely then, and only loosely otherwise. */
  isActive(): boolean
  context(): ClipboardContext
}

/** Checked this often while Orbis is in front, and this much more slowly while it is not. */
const POLL_MS = 700
const IDLE_POLL_MS = 2500

/**
 * Clipboard history: what you copy is remembered here while Orbis is running — including copies made in other apps,
 * which is the point of a clipboard history — minus anything that looks like a password or a key, anything copied in a
 * private tab, and anything from a site you have excluded. The clipboard is read often while Orbis is the app in front
 * and only every couple of seconds otherwise, and putting an entry back on the clipboard doesn't record it again.
 */
export class ClipboardHistory {
  private readonly clips: Collection<ClipItem>
  private readonly settingsFile: JsonFile<ClipboardSettings>
  private readonly listeners = new Set<() => void>()
  private timer: NodeJS.Timeout | null = null
  /** What the clipboard held when last looked at, so only changes are recorded. */
  private lastSeen: string | null = null
  private ownWrite: string | null = null
  private paused = false
  private lastSkip: string | null = null

  constructor(private readonly o: ClipboardHistoryOptions) {
    this.clips = new Collection<ClipItem>(join(o.userData, 'personal', 'clipboard.json'), normalizeClip, 2000)
    this.settingsFile = new JsonFile<ClipboardSettings>(join(o.userData, 'personal', 'clipboard-settings.json'), () => ({ ...DEFAULT_CLIPBOARD_SETTINGS }), normalizeClipboardSettings)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  async start(): Promise<void> {
    const settings = await this.settings()
    // The clipboard as it is now is the starting point: what was copied before Orbis opened isn't taken.
    this.lastSeen = await this.signature()
    await this.clips.replace(pruneClips(await this.clips.all(), settings))
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Looks again after a pause that depends on whether Orbis is the app in front. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule())
    }, this.o.isActive() ? POLL_MS : IDLE_POLL_MS)
    this.timer.unref?.()
  }

  settings(): Promise<ClipboardSettings> {
    return this.settingsFile.read()
  }

  async updateSettings(patch: Partial<ClipboardSettings>): Promise<ClipboardSettings> {
    const next = normalizeClipboardSettings({ ...(await this.settings()), ...patch })
    await this.settingsFile.write(next)
    await this.clips.replace(pruneClips(await this.clips.all(), next))
    this.changed()
    return next
  }

  /** Stops recording until told otherwise (the history stays). */
  setPaused(paused: boolean): void {
    this.paused = paused
    this.changed()
  }

  isPaused(): boolean {
    return this.paused
  }

  /** Why the last copy wasn't kept, so the window can say so instead of silently ignoring it. */
  lastSkipped(): string | null {
    return this.lastSkip
  }

  all(): Promise<ClipItem[]> {
    return this.clips.all()
  }

  async search(query: string, kind?: ClipKind | 'all' | 'pinned'): Promise<ClipItem[]> {
    return searchClips(await this.all(), query, kind)
  }

  private async signature(): Promise<string | null> {
    const text = await clipboard.readText().catch(() => '')
    if (text) return `text:${text}`
    const image = await this.readImage()
    return image ? `image:${image.dataUrl.length}:${image.dataUrl.slice(-64)}` : null
  }

  private async readImage(): Promise<{ dataUrl: string; width: number; height: number; bytes: number } | null> {
    try {
      for (const item of await clipboard.read()) {
        const type = item.types.find((t) => t === 'image/png' || t === 'image/jpeg')
        if (!type) continue
        const blob = (await item.getType(type)) as Blob | null
        if (!blob) continue
        const buffer = Buffer.from(await blob.arrayBuffer())
        if (!buffer.length || buffer.length > MAX_CLIP_IMAGE_BYTES) return null
        const image = nativeImage.createFromBuffer(buffer)
        const size = image.getSize()
        return { dataUrl: `data:${type};base64,${buffer.toString('base64')}`, width: size.width, height: size.height, bytes: buffer.length }
      }
    } catch {
      // Nothing readable on the clipboard.
    }
    return null
  }

  private async tick(): Promise<void> {
    if (this.paused) return
    const settings = await this.settings()
    if (!settings.enabled) return
    const signature = await this.signature()
    if (signature === null || signature === this.lastSeen) return
    this.lastSeen = signature
    if (signature === this.ownWrite) return

    const context = this.o.isActive() ? this.o.context() : {}
    if (signature.startsWith('image:')) {
      if (!settings.captureImages) return
      if (settings.skipPrivate && context.private) {
        this.lastSkip = 'Copied in a private tab.'
        return
      }
      const image = await this.readImage()
      if (!image) return
      await this.add({ kind: 'image', content: image.dataUrl, size: { width: image.width, height: image.height }, bytes: image.bytes }, context)
      return
    }
    const text = signature.slice(5)
    const decision = shouldCapture(text, settings, context)
    if (!decision.keep) {
      this.lastSkip = decision.reason ?? null
      this.changed()
      return
    }
    await this.add({ kind: clipKind(text), content: text, bytes: Buffer.byteLength(text) }, context)
  }

  private async add(part: { kind: ClipKind; content: string; bytes: number; size?: { width: number; height: number } }, context: ClipboardContext): Promise<ClipItem> {
    const settings = await this.settings()
    const item: ClipItem = {
      id: crypto.randomUUID(),
      kind: part.kind,
      content: part.content,
      preview: clipPreview(part.kind, part.content, part.size),
      ...(context.url && !context.private ? { source: { url: context.url, ...(context.title ? { title: context.title } : {}) } } : {}),
      pinned: false,
      copiedAt: Date.now(),
      times: 1,
      ...(part.size ? { size: part.size } : {}),
      bytes: part.bytes
    }
    this.lastSkip = null
    await this.clips.replace(addClip(await this.clips.all(), item, settings))
    this.changed()
    return item
  }

  /** Puts an entry back on the clipboard. It isn't recorded again as a new copy. */
  async copyToClipboard(id: string): Promise<ClipItem> {
    const item = (await this.clips.get(id)) ?? null
    if (!item) throw new Error('That entry is no longer in the history.')
    if (item.kind === 'image') {
      const base64 = item.content.slice(item.content.indexOf(',') + 1)
      const type = item.content.slice(5, item.content.indexOf(';')) || 'image/png'
      await clipboard.write([new ClipboardItem({ [type]: new Blob([new Uint8Array(Buffer.from(base64, 'base64'))], { type }) })])
      this.ownWrite = `image:${item.content.length}:${item.content.slice(-64)}`
    } else {
      await clipboard.writeText(item.content)
      this.ownWrite = `text:${item.content}`
    }
    this.lastSeen = this.ownWrite
    // Using an entry moves it back to the top, as the newest thing copied.
    await this.clips.update((clips) => clips.map((c) => (c.id === id ? { ...c, copiedAt: Date.now() } : c)).sort((a, b) => b.copiedAt - a.copiedAt))
    this.changed()
    return item
  }

  async setPinned(id: string, pinned: boolean): Promise<ClipItem | null> {
    const clips = await this.clips.update((list) => list.map((c) => (c.id === id ? { ...c, pinned } : c)))
    this.changed()
    return clips.find((c) => c.id === id) ?? null
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.clips.remove(id)
    if (removed) this.changed()
    return removed
  }

  /** Empties the history. Pinned entries stay unless asked for too. */
  async clear(includePinned = false): Promise<number> {
    const before = await this.clips.all()
    const next = includePinned ? [] : before.filter((c) => c.pinned)
    await this.clips.replace(next)
    this.changed()
    return before.length - next.length
  }

  async flush(): Promise<void> {
    await Promise.all([this.clips.flush(), this.settingsFile.flush()])
  }
}
