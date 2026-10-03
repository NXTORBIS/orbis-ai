import { join } from 'node:path'
import { JsonFile } from './personal/store.ts'
import { dataDirFor } from '../shared/profiles.ts'
import type { AutomationState } from '../shared/types.ts'

/**
 * What a long automation has already done, kept where a crash cannot take it.
 *
 * Workflows checkpoint every step and the scheduler survives being closed, and Orion's own automations -- the ones
 * that work through fifty search results, or play a game for twenty minutes -- did neither. Their whole state lived
 * in memory and in the conversation that started them, so Orbis closing unexpectedly in the middle of one lost the
 * list of what had already been handled. Resuming then meant doing it all again, which for anything that acts on a
 * page is worse than not resuming at all.
 *
 * Three rules, and the second is the one that keeps this honest:
 *
 * **Only what really happened.** Everything written here came from the automation's own verified progress -- the
 * items it confirmed it processed, the pages it actually visited. Nothing is estimated and nothing is predicted.
 *
 * **A checkpoint is not a claim that it can be resumed.** It is a record of where something got to. Whether picking
 * it up is safe is the automation's decision when it reads one back, with the browser in front of it; a checkpoint
 * that is hours old describes a page that has almost certainly moved on, and is offered as history rather than as a
 * place to carry on from. Anything past `STALE_AFTER` is not offered at all.
 *
 * **It holds no page content beyond short excerpts, and no secrets.** It is the same state the conversation already
 * shows, written to disk; nothing is collected for this that was not already being kept.
 */

/** Past this, a checkpoint describes a browser that has moved on. Kept as history, never offered to resume. */
export const STALE_AFTER = 6 * 60 * 60 * 1000

/** How many are kept per profile. A handful: this is for picking up what you were doing, not an archive. */
export const MAX_CHECKPOINTS = 10

export interface AutomationCheckpoint {
  readonly state: AutomationState
  /** When it was written. */
  readonly at: number
  /** The conversation it belongs to, so it can be offered where it came from and nowhere else. */
  readonly conversationId: string
}

interface Saved {
  v: number
  runs: AutomationCheckpoint[]
}

const VERSION = 1

const readOne = (raw: unknown): AutomationCheckpoint | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const state = o.state as AutomationState | undefined
  if (!state || typeof state.id !== 'string' || typeof state.objective !== 'string') return null
  if (typeof o.at !== 'number' || typeof o.conversationId !== 'string') return null
  return { state, at: o.at, conversationId: o.conversationId }
}

const read = (raw: unknown): Saved => {
  const runs = Array.isArray((raw as { runs?: unknown })?.runs) ? ((raw as { runs: unknown[] }).runs as unknown[]) : []
  return { v: VERSION, runs: runs.map(readOne).filter((one): one is AutomationCheckpoint => one !== null) }
}

/** The ones worth keeping: newest first, capped. Finished runs are not kept -- there is nothing to pick up. */
export function keepable(runs: readonly AutomationCheckpoint[], now: number): AutomationCheckpoint[] {
  return [...runs]
    .filter((one) => one.state.status !== 'completed' && one.state.status !== 'stopped')
    .filter((one) => now - one.at <= STALE_AFTER)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_CHECKPOINTS)
}

/** Whether this is something Orbis may offer to carry on with, rather than only show. */
export function resumable(one: AutomationCheckpoint, now: number): boolean {
  if (now - one.at > STALE_AFTER) return false
  // Paused and stuck are the two a person would want back. Running means Orbis was closed mid-step, which also counts.
  return one.state.status === 'paused' || one.state.status === 'stuck' || one.state.status === 'running'
}

/** What to say about one, in the words somebody would use. Never a promise that carrying on will work. */
export function describeCheckpoint(one: AutomationCheckpoint, now: number): string {
  const mins = Math.max(1, Math.round((now - one.at) / 60000))
  const when = mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'} ago` : `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago`
  const done = `${one.state.completed}${one.state.total ? ` of ${one.state.total}` : ''} ${one.state.unit}`
  return `${one.state.objective} — ${done}, last moved ${when}`
}

export class AutomationCheckpoints {
  private readonly files = new Map<string, JsonFile<Saved>>()
  private readonly userData: string
  private readonly profileId: () => string
  private readonly now: () => number

  constructor(o: { userData: string; profileId: () => string; now?: () => number }) {
    this.userData = o.userData
    this.profileId = o.profileId
    this.now = o.now ?? (() => Date.now())
  }

  private file(): JsonFile<Saved> {
    const id = this.profileId()
    let found = this.files.get(id)
    if (!found) {
      found = new JsonFile<Saved>(join(this.userData, dataDirFor(id), 'automation-checkpoints.json'), () => ({ v: VERSION, runs: [] }), read)
      this.files.set(id, found)
    }
    return found
  }

  /**
   * Records where an automation has got to.
   *
   * Called as the automation's own progress changes, and deliberately cheap: it never blocks a step, and a file that
   * will not write costs the checkpoint and nothing else. The automation's own state stays the authority.
   */
  async save(state: AutomationState, conversationId: string): Promise<void> {
    if (!conversationId) return
    try {
      const file = this.file()
      const saved = await file.read()
      const at = this.now()
      const runs = keepable([{ state, at, conversationId }, ...saved.runs.filter((one) => one.state.id !== state.id)], at)
      await file.write({ v: VERSION, runs })
    } catch {
      // A checkpoint that could not be written is a checkpoint that is not there, never a failed step.
    }
  }

  /** Everything that could be picked up, newest first. Empty when there is nothing, which is the usual answer. */
  async list(): Promise<AutomationCheckpoint[]> {
    try {
      const saved = await this.file().read()
      const now = this.now()
      return keepable(saved.runs, now).filter((one) => resumable(one, now))
    } catch {
      return []
    }
  }

  /** Forgets one, because it was carried on with or because it was not wanted. */
  async forget(id: string): Promise<void> {
    try {
      const file = this.file()
      const saved = await file.read()
      await file.write({ v: VERSION, runs: saved.runs.filter((one) => one.state.id !== id) })
    } catch {
      // Nothing to do: a checkpoint that cannot be removed is one that will go stale on its own.
    }
  }

  /** Writes anything pending. Called before quitting. */
  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => file.flush()))
  }
}
