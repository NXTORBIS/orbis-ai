/**
 * How the Orbis interface talks to the rest of Orbis.
 *
 * Today that is Electron's IPC. In the Chromium browser it will be Mojo. The interface itself should not have to care,
 * and after this it does not: everything it asks for goes through one small surface, and which wire carries it is
 * decided in one place.
 *
 * This is the seam the migration turns on. Both transports can exist at once, one channel at a time can be moved
 * across, and anything already moved keeps working while the rest has not been. A migration that cannot be done in
 * pieces cannot be done at all.
 *
 * Pure — no browser, no Electron, no Chromium.
 */

/** A request that expects an answer. */
export type Invoke = (method: string, ...args: unknown[]) => Promise<unknown>

/** Something the application announces, that the interface may want to hear about. */
export type Subscribe = (event: string, listener: (...args: unknown[]) => void) => () => void

export interface Transport {
  /** What carries this: useful in diagnostics, and in deciding what has been migrated. */
  readonly kind: 'electron' | 'mojo' | 'memory'
  invoke: Invoke
  subscribe: Subscribe
}

/**
 * Which transport carries which method.
 *
 * During the migration some of Orbis speaks Mojo and the rest still speaks Electron IPC. This routes each call to
 * whichever carries it, so a domain can be moved on its own and everything else keeps working while it is.
 */
export class TransportRouter implements Transport {
  readonly kind = 'electron' as const
  private readonly fallback: Transport
  /** Method prefixes that have been moved, and where they went. Longest prefix wins. */
  private readonly routes: { prefix: string; transport: Transport }[] = []

  constructor(fallback: Transport) {
    this.fallback = fallback
  }

  /** Declares that everything under a prefix — `settings:`, say — now goes somewhere else. */
  moveTo(prefix: string, transport: Transport): this {
    this.routes.push({ prefix, transport })
    this.routes.sort((a, b) => b.prefix.length - a.prefix.length)
    return this
  }

  /** Which transport carries this method, and why — the answer to "has this been migrated yet". */
  routeFor(method: string): Transport {
    return this.routes.find((route) => method.startsWith(route.prefix))?.transport ?? this.fallback
  }

  /** What has moved so far, for the migration's own reporting. */
  moved(): string[] {
    return this.routes.map((route) => route.prefix)
  }

  invoke: Invoke = (method, ...args) => this.routeFor(method).invoke(method, ...args)
  subscribe: Subscribe = (event, listener) => this.routeFor(event).subscribe(event, listener)
}

/**
 * A transport that answers from a table of functions, with nothing underneath it. Used in tests, and by anything that
 * needs to run with no application behind it at all.
 */
export function memoryTransport(handlers: Record<string, (...args: unknown[]) => unknown>): Transport & {
  /** Announces something to whoever is listening, the way the application would. */
  emit(event: string, ...args: unknown[]): void
  /** Every method asked for, in order, so a test can say what was called. */
  readonly calls: { method: string; args: unknown[] }[]
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const calls: { method: string; args: unknown[] }[] = []
  return {
    kind: 'memory',
    calls,
    invoke: async (method, ...args) => {
      calls.push({ method, args })
      const handler = handlers[method]
      if (!handler) throw new Error(`Nothing answers ${method}`)
      return handler(...args)
    },
    subscribe: (event, listener) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
  }
}
