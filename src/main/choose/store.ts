import { join } from 'node:path'
import { Collection } from '../personal/store.ts'
import { dataDirFor, DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { cleanDecision, cleanResult, cleanScenario } from '../../shared/choose/validate.ts'
import type { Decision, Result, Scenario } from '../../shared/choose/types.ts'

/**
 * What Orbis keeps about decisions.
 *
 * One file per profile, holding every decision that is still live plus the ones somebody asked to keep. The last
 * result and the what-ifs are kept beside each decision, because reproducing an answer later means having the
 * inputs *and* what came out of them -- a saved decision that re-derives its answer on opening is not the answer
 * that was given.
 *
 * ## Why unsaved decisions are stored at all
 *
 * "Save this" is explicit, but a follow-up two days later is not: somebody who asked about two laptops on Monday
 * and says "actually my budget is higher" on Wednesday expects the comparison to still be there. Holding the open
 * decision only in memory would make that work until Orbis was closed and then stop working, which is worse than
 * never working.
 *
 * So everything is written, and `saved` marks what was asked for. Unsaved decisions past a few dozen are dropped,
 * least recently touched first, which keeps the file from growing for ever without ever dropping something
 * somebody said to keep.
 *
 * ## Nothing here decides anything
 *
 * No arithmetic, no prompts, no policy. It reads, writes, checks and prunes.
 */

export interface Kept {
  /** The decision's own id. */
  id: string
  decision: Decision
  /** What came out of it last time. Null before anything has been worked out. */
  result: Result | null
  /** The what-ifs that have been asked about it. */
  scenarios: Scenario[]
}

/** As many as are worth keeping at all, and as many unsaved ones as are worth carrying between sessions. */
export const MOST_KEPT = 200
export const MOST_UNSAVED = 40

const chooseFile = (userData: string, profileId: string): string => join(userData, dataDirFor(profileId), 'choose', 'decisions.json')

/**
 * One stored decision, checked.
 *
 * The decision is validated first and the result is validated against it, so a result that names an option the
 * decision no longer has is dropped rather than drawn. A decision that does not validate takes its result and its
 * what-ifs with it, because they are meaningless without it.
 */
export function cleanKept(raw: unknown): Kept | null {
  const one = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const decision = cleanDecision(one.decision)
  if (!decision) return null
  return {
    id: decision.id,
    decision,
    result: cleanResult(one.result, decision),
    scenarios: (Array.isArray(one.scenarios) ? one.scenarios : [])
      .map((two) => cleanScenario(two, decision))
      .filter((two): two is Scenario => two !== null)
      .slice(0, 12)
  }
}

export class ChooseStore {
  private readonly kept: Collection<Kept>

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.kept = new Collection<Kept>(chooseFile(userData, DEFAULT_PROFILE_ID), cleanKept, MOST_KEPT)
  }

  /** Moves to another profile's decisions. One profile never sees another's. */
  async useProfile(profileId: string): Promise<void> {
    await this.kept.usePath(chooseFile(this.userData, profileId))
  }

  all(): Promise<Kept[]> {
    return this.kept.all()
  }

  get(id: string): Promise<Kept | null> {
    return this.kept.get(id)
  }

  /** The decision open in one conversation: the most recently touched one belonging to it. */
  async openIn(conversationId: string): Promise<Kept | null> {
    if (conversationId === '') return null
    const all = await this.all()
    return (
      all
        .filter((one) => one.decision.conversationId === conversationId)
        .sort((a, b) => b.decision.changedAt - a.decision.changedAt)[0] ?? null
    )
  }

  /** The ones somebody asked to keep, most recently touched first. */
  async savedOnes(): Promise<Kept[]> {
    return (await this.all()).filter((one) => one.decision.saved).sort((a, b) => b.decision.changedAt - a.decision.changedAt)
  }

  /**
   * Writes one decision and prunes the unsaved ones.
   *
   * Returns what was actually stored, read back through the validator, so a caller never reports a save it did not
   * get. The one failure this is for: a decision that is written and then cannot be read back is not saved, and
   * telling somebody it was is the mistake worth engineering against.
   */
  async put(kept: Kept): Promise<Kept | null> {
    const checked = cleanKept(kept)
    if (!checked) return null
    await this.kept.update((all) => {
      const without = all.filter((one) => one.id !== checked.id)
      const next = [checked, ...without]
      const unsaved = next.filter((one) => !one.decision.saved).sort((a, b) => b.decision.changedAt - a.decision.changedAt)
      const dropping = new Set(unsaved.slice(MOST_UNSAVED).map((one) => one.id))
      return next.filter((one) => !dropping.has(one.id))
    })
    return this.get(checked.id)
  }

  /** Marks one as kept on purpose. False when there is no such decision. */
  async keep(id: string): Promise<boolean> {
    const one = await this.get(id)
    if (!one) return false
    const stored = await this.put({ ...one, decision: { ...one.decision, saved: true } })
    return stored?.decision.saved === true
  }

  remove(id: string): Promise<boolean> {
    return this.kept.remove(id)
  }

  flush(): Promise<void> {
    return this.kept.flush()
  }
}
