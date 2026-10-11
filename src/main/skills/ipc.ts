import type { BrowserWindow } from 'electron'

import { plainHandle } from '../ipc/handle.ts'
import type { SkillManager } from '../skillManager.ts'
import type { SkillEdits } from '../../shared/skills.ts'
import type { StepSession } from '../../shared/stepPlan.ts'

/**
 * Learned skills: the window's door to them.
 *
 * A skill is a successful step-by-step run the person chose to keep. It is stored per profile beside that profile's
 * workflows and run by the workflow engine like any workflow -- there is no second automation engine here, and
 * nothing below runs a step itself. Fourteen channels, written out in the middle of `index.ts` with everything
 * else until now.
 *
 * **Only the Orbis window may ask for any of this.** `plainHandle` establishes that by construction, which is the
 * one thing the hand-written `fromWindow(event)` above these channels used to do.
 *
 * **A run is identified, never handed over.** `skills:preview` and `skills:save` are given a run id and nothing
 * more; `ownRun` turns it into the run in this process, and only if that run belongs to the profile in use. A
 * window cannot describe a run to Orbis, and cannot save a skill out of somebody else's.
 *
 * **The page comes from the browser, not from the message.** `skills:match` is told what the person asked for and
 * works out where they are itself, so a match cannot be steered at a site the person is not on.
 *
 * The manager stays in `index.ts`, where it is built with the profile, the capability list and the workflow engine
 * it needs: Orion reaches it directly for `match` and `preview`, and a finished run counts a success through it.
 * This file registers channels over a manager it is handed and keeps no state of its own.
 */

export interface SkillsIpcOptions {
  skills: SkillManager
  getWindow(): BrowserWindow | null
  /** The run itself, in the main process, and only if it belongs to the profile in use. */
  ownRun(runId: unknown): Promise<{ state: StepSession }>
  /** The address of the page in front, asked at the moment of the call. Undefined when the browser is closed. */
  pageUrl(): string | undefined
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

const edits = (value: unknown): SkillEdits => {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    ...(typeof v.name === 'string' ? { name: v.name } : {}),
    ...(typeof v.whenToUse === 'string' ? { whenToUse: v.whenToUse } : {}),
    ...(typeof v.category === 'string' ? { category: v.category } : {}),
    ...(Array.isArray(v.domains) ? { domains: v.domains.filter((d): d is string => typeof d === 'string') } : {})
  }
}

export function registerSkillsIpc(o: SkillsIpcOptions): void {
  const { skills, ownRun } = o
  const handle = plainHandle(o)

  handle('skills:settings', () => skills.settings())
  handle('skills:set-settings', (_e, next: unknown) => {
    const v = (next ?? {}) as Record<string, unknown>
    return skills.setSettings({
      ...(typeof v.enabled === 'boolean' ? { enabled: v.enabled } : {}),
      ...(typeof v.learnFromRuns === 'boolean' ? { learnFromRuns: v.learnFromRuns } : {}),
      ...(v.reuse === 'never' || v.reuse === 'suggest' || v.reuse === 'auto' ? { reuse: v.reuse } : {})
    })
  })
  handle('skills:list', () => skills.list())
  handle('skills:preview', async (_e, runId: unknown) => {
    const settings = await skills.settings()
    const run = await ownRun(runId)
    const { candidate, why } = skills.preview(run.state)
    return {
      offer: settings.learnFromRuns && Boolean(candidate),
      timesDone: await skills.timesDone(run.state.goal),
      why,
      candidate: candidate && {
        name: candidate.workflow.name,
        whenToUse: candidate.meta.whenToUse,
        category: candidate.meta.category,
        domains: candidate.meta.domains,
        steps: candidate.workflow.steps.map((step) => ({ name: step.name, byYou: step.type === 'userAction' })),
        inputs: candidate.workflow.inputs.map((input) => ({ label: input.label || input.name, asked: input.default === undefined })),
        permissions: candidate.workflow.settings.permissions,
        notes: candidate.notes
      }
    }
  })
  handle('skills:save', async (_e, runId: unknown, changes: unknown) => skills.saveFromRun((await ownRun(runId)).state, edits(changes)))
  handle('skills:match', (_e, request: unknown) => {
    // The page the person is really on, read here rather than taken from the window.
    const url = o.pageUrl()
    return skills.match(text(request, 2000), url)
  })
  handle('skills:run', (_e, workflowId: unknown, inputs: unknown, request: unknown) => {
    const values = inputs && typeof inputs === 'object' ? Object.fromEntries(Object.entries(inputs as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 2000)])) : {}
    return skills.run(text(workflowId, 80), values, text(request, 200) || undefined)
  })
  handle('skills:edit', (_e, workflowId: unknown, changes: unknown) => skills.edit(text(workflowId, 80), edits(changes)))
  handle('skills:set-enabled', (_e, workflowId: unknown, on: unknown) => skills.setEnabled(text(workflowId, 80), on === true))
  handle('skills:remove', (_e, workflowId: unknown, alsoWorkflow: unknown) => skills.remove(text(workflowId, 80), alsoWorkflow === true))
  handle('skills:remove-all', () => skills.removeAll())
  handle('skills:roll-back', (_e, workflowId: unknown) => skills.rollBack(text(workflowId, 80)))
  handle('skills:export', (_e, workflowId: unknown) => skills.exportSkill(text(workflowId, 80)))
  handle('skills:import', (_e, json: unknown) => skills.importSkill(text(json, 2_000_000)))
}
