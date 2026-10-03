import { applyChange, changeNote, describePlan, makePlan, type ResearchChange, type ResearchPlan, type ResearchStage } from '../shared/researchRun.ts'

/**
 * Holding a research run, and changing it while it runs.
 *
 * Research was one awaited call, so the only control anybody had was to stop it -- which threw away every page it had
 * already read. This is what sits between the window and that call: it hands research a gate to wait at, and holds or
 * changes the plan at each point research reaches one.
 *
 * Two things make this honest rather than a label on a button:
 *
 * **Pausing really pauses.** The gate does not resolve until the run is let go, so a paused run is a run that is not
 * doing anything, not one that carries on and pretends. It can only pause *between* stages: a page already being
 * fetched finishes, because abandoning a half-read page would lose it for nothing.
 *
 * **A change says what it did.** Asking for official sources after everything has been read cannot un-read it, and the
 * answer back says so rather than letting somebody believe it was applied. What each stage can still reach is decided
 * in src/shared/researchRun.ts, where it can be tested.
 */

export interface RunView {
  id: string
  /** Where it has got to. */
  stage: ResearchStage
  paused: boolean
  /** What it is going to do, in the words somebody would use. */
  plan: string[]
  question: string
}

interface Run {
  id: string
  question: string
  stage: ResearchStage
  plan: ResearchPlan
  paused: boolean
  /** Resolved when a paused run is let go. Null when it is not paused. */
  release: (() => void) | null
  /** Changes asked for while it runs, drained at the next stage it reaches. */
  pending: ResearchChange[]
  /** Told when the run moves or is changed, so the window can show it without asking. */
  notify(view: RunView, note: string | null): void
}

export class ResearchControl {
  private readonly runs = new Map<string, Run>()

  /** What is running now. Usually nothing. */
  list(): RunView[] {
    return [...this.runs.values()].map((run) => this.view(run))
  }

  private view(run: Run): RunView {
    return { id: run.id, stage: run.stage, paused: run.paused, plan: describePlan(run.plan), question: run.question }
  }

  /**
   * Starts following a run, and returns the gate to hand to research.
   *
   * `showPlanFirst` is the one thing here that waits on a person, and it is off unless somebody asked for it: research
   * that stops for permission on every question is research nobody uses.
   */
  begin(o: { id: string; question: string; showPlanFirst: boolean; notify(view: RunView, note: string | null): void }): (stage: ResearchStage, plan: ResearchPlan) => Promise<ResearchPlan> {
    const run: Run = { id: o.id, question: o.question, stage: 'planning', plan: makePlan({}), paused: false, release: null, pending: [], notify: o.notify }
    this.runs.set(o.id, run)

    return async (stage, plan) => {
      run.stage = stage
      run.plan = plan

      // Showing the plan first is a pause at the one stage where the searches can still be changed.
      if (stage === 'planning' && o.showPlanFirst && !run.paused) this.hold(run)

      run.notify(this.view(run), null)

      // Everything asked for while the previous stage ran, applied now that there is a stage to apply it at.
      for (const change of run.pending.splice(0)) {
        const applied = applyChange(run.plan, change, stage)
        run.plan = applied.plan
        run.notify(this.view(run), changeNote(applied))
      }

      // Waiting here is what a paused run is. Changes that arrive while it waits are applied before it goes on.
      while (run.paused) {
        await new Promise<void>((resolve) => {
          run.release = resolve
        })
        for (const change of run.pending.splice(0)) {
          const applied = applyChange(run.plan, change, stage)
          run.plan = applied.plan
          run.notify(this.view(run), changeNote(applied))
        }
      }

      return run.plan
    }
  }

  /** The run has finished, however it finished. */
  end(id: string): void {
    const run = this.runs.get(id)
    if (run) {
      // A run that ends while paused must not leave its gate waiting for ever.
      run.paused = false
      run.release?.()
    }
    this.runs.delete(id)
  }

  private hold(run: Run): void {
    run.paused = true
    run.release = null
  }

  /** Holds a run at the next point it reaches, or right now if it is already waiting at one. */
  pause(id: string): boolean {
    const run = this.runs.get(id)
    if (!run || run.stage === 'done') return false
    this.hold(run)
    run.notify(this.view(run), null)
    return true
  }

  /** Lets a held run go on. */
  resume(id: string): boolean {
    const run = this.runs.get(id)
    if (!run || !run.paused) return false
    run.paused = false
    run.release?.()
    run.release = null
    run.notify(this.view(run), null)
    return true
  }

  /**
   * Asks for something about a run to change.
   *
   * Queued rather than applied here, because what a change can reach depends on the stage the run is at, and the run
   * is between stages whenever this is called. It is applied at the next stage, which is also where it is told what
   * it managed to change and what arrived too late.
   */
  change(id: string, change: ResearchChange): boolean {
    const run = this.runs.get(id)
    if (!run || run.stage === 'done') return false
    run.pending.push(change)
    // A paused run is waiting; wake it so the change is applied, then it stops again unless it was also resumed.
    if (run.paused && run.release) {
      const go = run.release
      run.release = null
      run.paused = false
      go()
      this.hold(run)
    }
    return true
  }
}
