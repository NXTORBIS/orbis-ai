import { createBus } from '../shared/orbisEvents.ts'
import type { OrbisBus } from '../shared/orbisEvents.ts'
import { asFailure } from '../shared/orbisError.ts'

/**
 * The one bus for this Orbis process.
 *
 * A module-level instance rather than something threaded through twenty constructors, because every subsystem needs
 * it and none of them should have to be handed it by whoever happened to construct them. It is created once, here, so
 * there is exactly one -- two buses would be two sets of listeners, each hearing half of what happened.
 *
 * A listener that throws is reported and stepped over. Losing tab tracking because one subscriber has a bug is not a
 * trade worth making, and a failure swallowed in silence is one nobody fixes.
 */
export const bus: OrbisBus = createBus({
  onListenerError: (error, event) => {
    const failure = asFailure(error, 'event-listener')
    // Deliberately the console: this is a fault in Orbis itself rather than something a person can act on, and it
    // must not become a notification that interrupts somebody's browsing.
    console.error(`[orbis] a listener for ${event.name} threw: ${failure.message}`)
  }
})
