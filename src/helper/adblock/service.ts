import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FilterStore, type Catalog } from '../../main/adblock/store.ts'
import { buildAdblockAssets } from './build.ts'
import type { Handler } from '../server.ts'

/**
 * The ad blocker's filter-list management for the Chromium build, on the helper: the same FilterStore Electron Orbis
 * uses (download, validation against truncated or wrong files, atomic swap, rollback, corruption recovery), followed by
 * a rebuild of what the extension enforces. The extension reloads itself afterwards to pick the new rulesets up.
 *
 * Nothing about what the person browses goes anywhere: the only requests are the downloads of the public lists.
 */
export function createAdblockHandlers(o: { extensionDir: string; listsDir: string; bundledDir: string; fetchFn: (url: string, init?: RequestInit) => Promise<Response> }): Record<string, Handler> {
  let running = false
  const open = async (): Promise<{ store: FilterStore; catalog: Catalog }> => {
    const catalog = JSON.parse(await readFile(join(o.bundledDir, 'catalog.json'), 'utf8')) as Catalog
    return { catalog, store: new FilterStore({ dir: o.listsDir, bundledDir: o.bundledDir, catalog, fetchFn: o.fetchFn }) }
  }
  const rebuild = async (store: FilterStore, catalog: Catalog): Promise<{ version: string; rulesets: Record<string, number>; recovered?: string }> => {
    const loaded = await store.load()
    if (loaded.empty) throw new Error('There are no filter lists yet.')
    const index = await buildAdblockAssets(catalog, loaded, join(o.extensionDir, 'adblock'))
    return { version: index.version, rulesets: Object.fromEntries(Object.entries(index.rulesets).map(([k, v]) => [k, v.rules])), recovered: loaded.recovered }
  }
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running) throw new Error('The filter lists are already being updated.')
    running = true
    try {
      return await work()
    } finally {
      running = false
    }
  }

  return {
    'adblock:update': () =>
      exclusive(async () => {
        const { store, catalog } = await open()
        const result = await store.update()
        const built = await rebuild(store, catalog)
        return { updated: result.updated, unchanged: result.unchanged, failed: result.failed, ...built }
      }),
    'adblock:rollback': () =>
      exclusive(async () => {
        const { store, catalog } = await open()
        await store.rollback()
        return rebuild(store, catalog)
      })
  }
}
