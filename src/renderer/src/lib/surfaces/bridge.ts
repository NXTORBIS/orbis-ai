import { SURFACE_CALLS } from '../../../../shared/surfaces.ts'
import { registerControlHandler } from '../browserControl.ts'
import { answerSurfaceCall, surfaceCallMutates } from './answer.ts'

/**
 * The wire, and only the wire.
 *
 * The six questions go over `control:window-run`, the same channel the address bar's capabilities have always been
 * carried out on, so there is one door between the application and its window with one sender check on it rather than
 * two that can disagree about who is allowed through. What each question answers is in `answer.ts`; nothing is
 * decided here.
 *
 * Nothing here decides who may ask, either. Whether a question is allowed, whether the person is asked first, how
 * many times it is tried and what goes in the log are all settled in `src/main/browserControl/` before it arrives,
 * which is the point of the capabilities being registered there like every other one.
 */

let attached = false

/** Starts answering, once. Called by every screen that registers, and by the window itself at startup. */
export function attachSurfaceBridge(): void {
  if (attached) return
  attached = true
  for (const call of Object.values(SURFACE_CALLS)) {
    registerControlHandler(call, surfaceCallMutates(call), (params) => answerSurfaceCall(call, params ?? {}))
  }
}
