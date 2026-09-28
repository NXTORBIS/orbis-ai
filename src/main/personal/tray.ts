import { Collection, personalFile } from './store.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { MAX_TRAY, addToTray, normalizeTrayItem, removeFromTray } from '../../shared/tray.ts'
import type { TrayItem } from '../../shared/tray.ts'

/**
 * What is pinned for comparison, per profile, in one file beside the notes and tasks.
 *
 * It is kept rather than held in the page because a comparison outlives the tab it started in: somebody pins three
 * laptops, searches again, pins a fourth, and opens the tray a day later. A tray that lived in the results page would
 * lose the first three at the first navigation, which would make it a scratchpad rather than a place to collect.
 *
 * The page text of each pinned item is kept with it. That is deliberate and it is the point: every value in the
 * comparison is checked against the words that were actually read, so the text has to still be here when it is
 * checked. Without it a table could not be re-verified, only re-believed.
 */
export class TrayStore {
  private readonly items: Collection<TrayItem>

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.items = new Collection<TrayItem>(personalFile(userData, DEFAULT_PROFILE_ID, 'tray.json'), normalizeTrayItem, MAX_TRAY)
  }

  async useProfile(profileId: string): Promise<void> {
    await this.items.usePath(personalFile(this.userData, profileId, 'tray.json'))
  }

  onChange(listener: () => void): () => void {
    return this.items.onChange(listener)
  }

  all(): Promise<TrayItem[]> {
    return this.items.all()
  }

  /** Pins a result. Says whether it went in, and why it did not: already there, or the tray is full. */
  async add(raw: unknown): Promise<{ items: TrayItem[]; added: boolean; full: boolean }> {
    const item = normalizeTrayItem({ ...(raw && typeof raw === 'object' ? raw : {}), addedAt: Date.now() })
    if (!item) throw new Error('That is not a page Orbis can pin.')
    let outcome: { added: boolean; full: boolean } = { added: false, full: false }
    const items = await this.items.update((current) => {
      const result = addToTray(current, item)
      outcome = { added: result.added, full: result.full }
      return result.items
    })
    return { items, ...outcome }
  }

  async remove(id: string): Promise<TrayItem[]> {
    return this.items.update((current) => removeFromTray(current, id))
  }

  async clear(): Promise<TrayItem[]> {
    return this.items.replace([])
  }

  /**
   * Records what was read from a pinned page, or why it could not be. A failure is written down just as a success is:
   * "this page would not open" is something the comparison has to be able to say.
   */
  async recordRead(id: string, result: { text?: string; problem?: string }): Promise<TrayItem[]> {
    return this.items.update((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        const next: TrayItem = { ...item, readAt: Date.now() }
        if (result.text) {
          next.text = result.text
          delete next.problem
        } else {
          next.problem = result.problem || 'This page could not be read.'
          delete next.text
        }
        return next
      })
    )
  }

  flush(): Promise<void> {
    return this.items.flush()
  }
}
