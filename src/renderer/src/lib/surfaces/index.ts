/**
 * What can be done inside the Orbis window's own screens.
 *
 * A screen calls `useSurface` and becomes reachable: its controls can be read and set, its actions can be done, and
 * what it is doing can be asked. One import for a screen to use, and the register underneath it knows nothing about
 * React so that the whole chain can be tested without a window.
 *
 * The protocol itself -- what a surface, a control, an action and an outcome are, and how a path through them is
 * resolved -- is in `src/shared/surfaces.ts`. The capabilities that ask these questions are in
 * `src/main/browserControl/surfaceCapabilities.ts`. The contract between them is `docs/orbis-control.md`.
 */

export { useSurface, useSurfaceBridge } from './useSurface.ts'
export { attachSurfaceBridge } from './bridge.ts'
export { answerSurfaceCall, surfaceCallMutates } from './answer.ts'
export {
  brokenSurfaces,
  forgetSurfaces,
  lookupSurface,
  readSurfaceControl,
  registerSurface,
  registeredSurfaces,
  runSurfaceAction,
  surfaceStateAt,
  surfaceTree,
  surfaceWiring,
  surfacesDrawn,
  writeSurfaceControl
} from './registry.ts'
export type { ActionDeclaration, ControlDeclaration, ControlReading, StateDeclaration, SurfaceDeclaration } from './registry.ts'
