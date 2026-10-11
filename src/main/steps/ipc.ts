import type { BrowserWindow } from 'electron'

import { plainHandle } from '../ipc/handle.ts'
import type { StepRun } from '../stepRunner.ts'

/**
 * Driving a goal one step at a time, from the window.
 *
 * Seven channels. Six of them act on a run somebody already has; one starts a new one.
 *
 * **A run is found by id, and the id is not enough on its own.** The profile is read at the moment of the call and
 * compared with the run's own, so an id belonging to another profile's run resolves to nothing rather than to that
 * run. The window supplies the id, and an id is a guess anybody could make.
 *
 * **Nothing here waits for the run.** `steps:start` returns the first view and lets it go; the window follows it
 * through `steps:changed` instead. A goal worked through a browser takes minutes, and a channel that waited for
 * one would be a channel that looked hung.
 */

export interface StepsIpcOptions {
  getWindow(): BrowserWindow | null
  /** The active profile, read at the moment of the call. */
  profileId(): Promise<string>
  /** Every run this process is holding, by id. */
  runs(): Map<string, StepRun>
  /** Builds a run and starts nothing; the caller decides when it begins. */
  make(id: string, profileId: string, goal: string): StepRun
  /** A fresh id for a new run. */
  newId(): string
}

export function registerStepsIpc(o: StepsIpcOptions): void {
  const handle = plainHandle(o)

  /** Only this profile's run, and only one it really has. Anything else is nothing, not somebody else's run. */
  const onRun = <T>(act: (run: StepRun | undefined) => Promise<T> | T) => {
    return async (_event: unknown, runId: unknown): Promise<T> => {
      const profileId = await o.profileId()
      const found = typeof runId === 'string' ? o.runs().get(runId) : undefined
      return act(found && found.state.profileId === profileId ? found : undefined)
    }
  }

  handle('steps:start', async (_event, goal: unknown) => {
    const task = typeof goal === 'string' ? goal.trim().slice(0, 2000) : ''
    if (!task) return null
    const id = o.newId()
    const run = o.make(id, await o.profileId(), task)
    o.runs().set(id, run)
    // Started in the background: the window watches it through `steps:changed` rather than waiting on this call.
    void run.start().catch(() => undefined)
    return run.view()
  })

  handle('steps:read', onRun((run) => run?.view() ?? null))

  handle(
    'steps:pause',
    onRun((run) => {
      run?.pauseRun('Paused by you.')
      return run?.view() ?? null
    })
  )

  handle(
    'steps:resume',
    onRun(async (run) => {
      await run?.resumeRun()
      return run?.view() ?? null
    })
  )

  handle(
    'steps:stop',
    onRun((run) => {
      run?.stopRun('Stopped by you.')
      return run?.view() ?? null
    })
  )

  handle(
    'steps:skip',
    onRun(async (run) => {
      await run?.skipCurrent('You chose to skip this.')
      return run?.view() ?? null
    })
  )

  // The person says they have dealt with a challenge. The page is looked at before that is believed.
  handle(
    'steps:verified',
    onRun(async (run) => {
      await run?.captchaDone()
      return run?.view() ?? null
    })
  )
}
