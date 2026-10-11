import { plainHandle } from '../ipc/handle.ts'
import type { BrowserWindow } from 'electron'
import { LANGUAGES, starterFor, EXECUTION_NOTES } from '../../shared/cs/execution.ts'
import type { ExecutionService } from './service.ts'

export interface ExecutionIpcOptions {
  service: ExecutionService
  getWindow(): BrowserWindow | null
}

/**
 * The window's access to running code.
 *
 * Nothing here takes a sandbox address or a key from the renderer: both live in settings, in the main process,
 * and the renderer is told only whether a sandbox is configured. A channel that accepted a URL from the page
 * would let a generated page point the runner at anywhere it liked.
 */
export function registerExecutionIpc(o: ExecutionIpcOptions): void {
  const handle = plainHandle(o)

  handle('execution:languages', () => ({
    languages: LANGUAGES.map((one) => ({
      id: one.id,
      name: one.name,
      category: one.category,
      extension: one.extension,
      syntax: one.syntax,
      // Null means Judge0 cannot run it, so only a prediction is ever possible for that one. The lab says so
      // rather than offering a Run button that quietly becomes a guess.
      canReallyRun: one.judge0 !== null
    })),
    notes: EXECUTION_NOTES
  }))

  handle('execution:starter', (_event, language) => starterFor(String(language ?? '')))

  handle('execution:ready', () => o.service.ready())

  handle('execution:run', (_event, request) => {
    const asked = (request ?? {}) as Record<string, unknown>
    return o.service.run({
      language: String(asked.language ?? ''),
      source: String(asked.source ?? ''),
      stdin: String(asked.stdin ?? ''),
      predictOnly: asked.predictOnly === true
    })
  })
}
