import type { ControlErrorCode, WindowRunResult } from '../../../../shared/browserControl.ts'
import type { SurfaceOutcome } from '../../../../shared/surfaces.ts'
import { SURFACE_CALLS } from '../../../../shared/surfaces.ts'
import { brokenSurfaces, lookupSurface, readSurfaceControl, registeredSurfaces, runSurfaceAction, surfaceStateAt, surfaceTree, surfaceWiring, writeSurfaceControl } from './registry.ts'

/**
 * The six questions the application asks about what is on screen, answered from the register.
 *
 * Apart from `bridge.ts`, which is only the wire, because this is the half worth checking: what each question
 * answers, and which answers count as a failure. Nothing here touches React, the window object or a channel, so the
 * whole chain -- a capability in the main process, this, the register, a real screen's getter -- can be driven in a
 * test with no window at all. The wire it usually arrives over is one `registerControlHandler` per name.
 */

const read = (data: unknown): WindowRunResult => ({ ok: true, data })
const failed = (code: ControlErrorCode, message: string, recoverable = false): WindowRunResult => ({ ok: false, error: { code, message, recoverable } })

/**
 * What a write or an action did, as the control layer's answer.
 *
 * A refusal and a failure are failures, with the code that says which: a refusal is about the request and would fail
 * again unchanged, while a failure may well work next time. The two that were carried out come back as answers with
 * the whole outcome attached, and their verification is where "and nothing could confirm it" lives rather than being
 * flattened into a yes or a no.
 */
const asResult = (outcome: SurfaceOutcome): WindowRunResult => {
  if (outcome.status === 'refused') return failed('invalid-params', outcome.detail, false)
  if (outcome.status === 'failed') return failed(outcome.error?.code ?? 'failed', outcome.detail, outcome.error?.recoverable ?? true)
  return { ok: true, data: outcome, verification: { verified: outcome.verified, detail: outcome.detail } }
}

/** Whether a question changes anything, which is what decides whether the window waits for a draw before answering. */
export const surfaceCallMutates = (call: string): boolean => call === SURFACE_CALLS.write || call === SURFACE_CALLS.run

export async function answerSurfaceCall(call: string, params: Record<string, unknown>): Promise<WindowRunResult> {
  const path = String(params.path ?? '')
  switch (call) {
    case SURFACE_CALLS.tree: {
      const wanted = typeof params.path === 'string' && params.path ? params.path : undefined
      const depth = typeof params.depth === 'number' ? params.depth : undefined
      const wiring = surfaceWiring()
      const surfaces = surfaceTree({ ...(wanted ? { path: wanted } : {}), ...(depth === undefined ? {} : { depth }) })
      /*
       * An empty answer says which empty it is.
       *
       * "No screen has registered anything" and "that path is not on screen" are different situations with different
       * next moves, and a bare empty list is the same answer to both -- which is how a caller comes to report that
       * Orbis has no screens when what happened is that it asked about the wrong one.
       */
      return read({
        surfaces,
        count: surfaces.length,
        registered: registeredSurfaces(),
        // A screen that is on the person's screen and could not describe itself is said out loud, rather than being
        // one fewer row in a list nobody can check.
        ...(brokenSurfaces().length ? { broken: [...brokenSurfaces()] } : {}),
        /*
         * And where Orbis's own screens disagree with each other.
         *
         * A route that names a control the screen has not got, two screens claiming one path, a button whose name a
         * setting has already taken -- none of these makes anything throw. The walk produces a step, the step is
         * carried out, and the screen at the end of it simply never opens. Saying it here is what turns that into
         * something somebody can fix instead of a feature nobody can reach.
         */
        ...(wiring.length ? { wiring: wiring.map((one) => (one.at ? `${one.at}: ${one.message}` : one.message)) } : {}),
        ...(wanted && !surfaces.length ? { note: `Nothing on screen is at “${wanted}”.` } : {})
      })
    }
    case SURFACE_CALLS.state: {
      const got = surfaceStateAt(path)
      return got.ok ? read(got) : failed('not-found', got.message, true)
    }
    case SURFACE_CALLS.read: {
      const got = readSurfaceControl(path)
      return got.ok ? read(got) : failed('not-found', got.message, true)
    }
    case SURFACE_CALLS.write:
      return asResult(await writeSurfaceControl(path, params.value))
    case SURFACE_CALLS.run:
      return asResult(await runSurfaceAction(path, (params.params ?? {}) as Record<string, unknown>))
    case SURFACE_CALLS.lookup: {
      const got = lookupSurface(path)
      return 'ok' in got ? failed('not-found', got.message, true) : read(got)
    }
    default:
      return failed('unknown-capability', `The Orbis window was asked “${call}”, which is not one of the things it answers about its screens.`, false)
  }
}
