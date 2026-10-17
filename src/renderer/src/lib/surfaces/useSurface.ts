import { useEffect, useRef } from 'react'
import { registerSurface, surfacesDrawn, type SurfaceDeclaration } from './registry.ts'
import { attachSurfaceBridge } from './bridge.ts'

/**
 * How a screen says what can be done to it.
 *
 * One call, with the screen's own state in it:
 *
 * ```tsx
 * useSurface({
 *   id: 'notifications',
 *   parent: 'settings',
 *   name: 'Notifications',
 *   kind: 'page',
 *   controls: {
 *     quietHours: { name: 'Quiet hours', spec: { type: 'boolean', description: 'Hold notifications overnight.' }, get: () => quiet.enabled, set: (on) => save({ ...quiet, enabled: on === true }) }
 *   },
 *   actions: { sendTest: { name: 'Send a test', run: () => window.api.notificationTest() } }
 * })
 * ```
 *
 * No dependency list, deliberately. What the screen declared on its latest render is kept in a ref and the register
 * reads through that, so every getter and setter is the current one and a changing set of controls needs no
 * bookkeeping. The registration itself lasts from mount to unmount.
 *
 * Nothing about the screen changes by calling this. It draws the same, behaves the same, and keeps working exactly as
 * it does now when nothing is driving it: these are getters onto state the screen already has and setters onto the
 * functions its own controls already call.
 */
export function useSurface(declaration: SurfaceDeclaration): void {
  const latest = useRef(declaration)
  latest.current = declaration

  const { id } = declaration
  const parent = declaration.parent ?? null
  useEffect(() => {
    attachSurfaceBridge()
    /*
     * Gone on unmount, and that is the whole reason this is a hook.
     *
     * A control that is offered and no longer exists is the fault this product has suffered most: a plan reads the
     * tree, decides, and then sets something on a screen that closed while it was thinking. Unregistering here means
     * the worst that can happen is an honest "that is not on screen any more".
     */
    return registerSurface(() => latest.current)
  }, [id, parent])

  // Each draw wakes a write that is waiting to read its value back: setting a control asks React for a render, and
  // the new value does not exist until that render has happened.
  useEffect(() => surfacesDrawn())
}

/**
 * Answers questions about screens even while no screen has registered.
 *
 * Called once by the window itself, so "nothing is registered" comes back as that rather than as the window not
 * answering. Without it the first question asked before any screen mounted would look like a broken bridge.
 */
export function useSurfaceBridge(): void {
  useEffect(() => attachSurfaceBridge(), [])
}
