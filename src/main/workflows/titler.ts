import type { Workflow } from '../../shared/workflows'
import { decideTitle, preferTitle, titleContext, titleIdentity } from '../../shared/workflowTitle.ts'

/**
 * Giving workflows their names.
 *
 * Nobody should have to name every workflow they make, so this watches what is saved and asks Orion for a name when
 * one is actually due. "Due" is doing most of the work here: a name is asked for when a workflow has none, or when
 * what it is for has genuinely changed — never because a selector was fixed, a timeout raised or a step reordered.
 *
 * It never blocks. A workflow is saved, usable and runnable the instant it is made; the name arrives a moment later
 * and the window is told. If Orion cannot be reached the workflow keeps the name it has, is tried again a couple of
 * times, and is then left alone rather than retried for ever.
 */

/** Several edits in quick succession are one change, not several, so the name is asked for once. */
const SETTLE_MS = 2_500
/** Orion being briefly unreachable is worth another go; being unreachable for a while is not. */
const RETRY_DELAYS = [15_000, 90_000]

export interface TitlerOptions {
  /** The workflow as it is stored now, or null when it has since been deleted. */
  get(workflowId: string): Promise<Workflow | null>
  /** Stores the named workflow. Does not count as an edit by the user. */
  save(workflow: Workflow): Promise<Workflow>
  /** Asks Orion. Returns null whenever it cannot answer; it never invents a name. */
  ask(context: string): Promise<string | null>
  /** The window, so a name that arrives after the fact appears without a reload. */
  announce(workflow: Workflow): void
}

interface Pending {
  timer: ReturnType<typeof setTimeout>
  attempt: number
}

export class WorkflowTitler {
  private readonly o: TitlerOptions
  private readonly pending = new Map<string, Pending>()
  private readonly running = new Set<string>()
  private stopped = false

  constructor(options: TitlerOptions) {
    this.o = options
  }

  /**
   * A workflow was saved. Decides whether a name is due and, if so, asks for one shortly.
   *
   * Called on every save, including the ones this class makes itself — which is why the decision is made from the
   * stored workflow rather than from what was passed in: once a name is written, the next call sees that it is the
   * same workflow it was and does nothing.
   */
  onSaved(workflow: Workflow): void {
    if (this.stopped) return
    const decision = decideTitle(workflow)
    if (!decision.generate) {
      // Whatever was queued no longer applies: an edit that took it back to what it was should not still rename it.
      this.cancel(workflow.id)
      return
    }
    this.queue(workflow.id, 0, SETTLE_MS)
  }

  /**
   * The user asked for a name outright.
   *
   * This ignores every reason not to generate — a name they chose themselves included, since asking is how somebody
   * hands naming back to Orbis. The workflow returns to being Orbis's to name afterwards.
   */
  async regenerate(workflowId: string): Promise<Workflow | null> {
    this.cancel(workflowId)
    const workflow = await this.o.get(workflowId)
    if (!workflow) return null
    return this.name(workflow, { forced: true })
  }

  private cancel(workflowId: string): void {
    const pending = this.pending.get(workflowId)
    if (pending) clearTimeout(pending.timer)
    this.pending.delete(workflowId)
  }

  private queue(workflowId: string, attempt: number, delay: number): void {
    this.cancel(workflowId)
    const timer = setTimeout(() => {
      this.pending.delete(workflowId)
      void this.attempt(workflowId, attempt)
    }, delay)
    // A name is never a reason to keep Orbis running.
    timer.unref?.()
    this.pending.set(workflowId, { timer, attempt })
  }

  private async attempt(workflowId: string, attempt: number): Promise<void> {
    if (this.stopped || this.running.has(workflowId)) return
    this.running.add(workflowId)
    try {
      const workflow = await this.o.get(workflowId)
      // Deleted, renamed by hand, or edited back into its old self while we waited.
      if (!workflow || !decideTitle(workflow).generate) return
      const named = await this.name(workflow, { forced: false })
      if (!named && attempt < RETRY_DELAYS.length) this.queue(workflowId, attempt + 1, RETRY_DELAYS[attempt])
    } catch {
      // A name is never worth failing anything else over.
    } finally {
      this.running.delete(workflowId)
    }
  }

  /** Asks Orion, keeps the answer only if it is better than what is there, and tells the window. */
  private async name(workflow: Workflow, { forced }: { forced: boolean }): Promise<Workflow | null> {
    const candidate = await this.o.ask(titleContext(workflow))
    const identity = titleIdentity(workflow)

    if (!candidate) {
      // Orion could not answer. The workflow keeps its name; nothing is invented in its place.
      return null
    }

    // Asking outright means taking the new name; otherwise one that merely rewords the old one is churn.
    const name = forced ? candidate : preferTitle(workflow.name, candidate)

    // What it is for is recorded either way, so an unchanged name is not reconsidered on every save from now on.
    const latest = (await this.o.get(workflow.id)) ?? workflow
    if (!forced && latest.titleSource === 'user') return null

    const saved = await this.o.save({
      ...latest,
      name,
      titleSource: 'ai',
      lastTitleContext: identity,
      lastGeneratedAt: Date.now(),
      titleVersion: (latest.titleVersion ?? 0) + 1
    })
    this.o.announce(saved)
    return saved
  }

  /** Nothing pending survives a quit. */
  stop(): void {
    this.stopped = true
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }
}
