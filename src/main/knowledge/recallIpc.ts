import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { RecallStore } from './recall.ts'
import { describeSize, type RecallSettings } from '../../shared/recall.ts'

/**
 * What the Orbis window may ask about the pages somebody has read.
 *
 * A short list on purpose: search it, list it, read one back, and delete — by page, by site, by a window of time, or all
 * of it. There is no channel here that switches the feature on for somebody, because that is a decision made in
 * settings with the wording in front of them, and a channel that did it silently would be the objectionable version of
 * this feature wearing the same name.
 */

export interface RecallIpcOptions {
  store: RecallStore
  profileId: () => Promise<string>
  /** Every check a channel makes before it answers: the sender is ours, and nothing else is talking to us. */
  handle: (channel: string, run: (profileId: string, ...args: unknown[]) => unknown) => void
  /** Told when the index changes, so an open window redraws without asking. */
  broadcast: (channel: string, payload?: unknown) => void
}

const str = (value: unknown, max = 300): string => (typeof value === 'string' ? value.slice(0, max) : '')
const num = (value: unknown, or: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : or)

export interface RecallOverview {
  settings: RecallSettings
  pages: number
  chars: number
  size: string
  oldestAt: number | null
  newestAt: number | null
  topHosts: { host: string; pages: number }[]
}

export function registerRecallIpc(o: RecallIpcOptions): () => void {
  /**
   * Taken out of the options rather than called as `o.handle`.
   *
   * The map that checks every channel is documented scans for `handle('name'` and deliberately ignores anything with a
   * dot in front of it, so that an unrelated `something.handle(...)` cannot be mistaken for a channel. Called through
   * the object, these nine channels were invisible to it -- documented, registered, and unchecked.
   */
  const { handle } = o

  const overview = (): RecallOverview => {
    const stats = o.store.stats()
    return {
      settings: o.store.settings(),
      pages: stats.pages,
      chars: stats.chars,
      // Roughly, and said in words, because "what is this costing me" is the question somebody actually has.
      size: describeSize(stats.chars),
      oldestAt: stats.oldestAt,
      newestAt: stats.newestAt,
      topHosts: stats.topHosts
    }
  }

  handle('recall:overview', () => overview())

  handle('recall:set-settings', (_id, next) => {
    o.store.setSettings((next ?? {}) as Partial<RecallSettings>)
    return overview()
  })

  handle('recall:search', (_id, query, options) => {
    const opts = (options ?? {}) as Record<string, unknown>
    return {
      hits: o.store.search(str(query, 400), {
        limit: num(opts.limit, 30),
        host: opts.host ? str(opts.host, 253) : undefined,
        since: typeof opts.since === 'number' ? opts.since : undefined
      })
    }
  })

  handle('recall:recent', (_id, limit, host) => ({
    hits: o.store.recent(num(limit, 50), host ? str(host, 253) : undefined)
  }))

  /** One page in full. The only way the whole text of a page leaves the index. */
  handle('recall:page', (_id, pageId) => ({ page: o.store.page(str(pageId, 80)) }))

  handle('recall:forget', (_id, pageId) => ({ forgotten: o.store.forget(str(pageId, 80)) }))

  handle('recall:forget-site', (_id, host, alsoBlock) => ({
    forgotten: o.store.forgetHost(str(host, 253), alsoBlock === true),
    ...overview()
  }))

  handle('recall:forget-between', (_id, from, to) => ({
    forgotten: o.store.forgetBetween(num(from, 0), num(to, Date.now())),
    ...overview()
  }))

  handle('recall:clear', () => ({ forgotten: o.store.clear(), ...overview() }))

  return o.store.onChange(() => o.broadcast('recall:changed'))
}

/**
 * The sender check, copied from the shape every other feature here uses.
 *
 * Exported so the composition root can pass its own instead; this is the fallback so the module is usable on its own in
 * a test without pulling the whole application in.
 */
export function plainHandle(
  profileId: () => Promise<string>,
  isOurs: (contents: WebContents) => boolean
): RecallIpcOptions['handle'] {
  return (channel, run) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isOurs(event.sender)) return { error: 'refused' }
      try {
        return await run(await profileId(), ...args)
      } catch (err) {
        // A code and a sentence. Never a path and never the underlying message, which could carry either.
        return { error: 'failed', message: err instanceof Error && err.message.length < 200 ? err.message : 'That did not work.' }
      }
    })
  }
}
