// A pure resource-lease manager. Named exclusive resources (for example "cpu-heavy", "gpu") plus a memory budget.
// No timers and no I/O: the caller supplies the clock and calls sweep(), so every rule is testable.

export interface LeaseRequest {
  owner: string
  /** Named exclusive resources, e.g. ['cpu-heavy', 'gpu']. */
  resources?: string[]
  memoryGb?: number
  /** A lease not renewed within this many ms is stale and is reclaimed by sweep(). */
  ttlMs?: number
}

export interface Lease { id: number; owner: string; resources: string[]; memoryGb: number; grantedAt: number; expiresAt: number }

export type RefusalCode = 'invalid' | 'too-large' | 'resource-busy' | 'memory-full' | 'queued-ahead'
export interface Refusal { ok: false; code: RefusalCode; reason: string; heldBy: string[] }
export type Acquired = { ok: true; lease: Lease } | Refusal

export interface LeaseSnapshot {
  memoryBudgetGb: number
  memoryUsedGb: number
  held: Array<{ id: number; owner: string; resources: string[]; memoryGb: number; heldMs: number; expiresInMs: number }>
  waiting: Array<{ owner: string; resources: string[]; memoryGb: number; waitedMs: number }>
}

export interface LeaseOptions { memoryBudgetGb: number; defaultTtlMs?: number; now?: () => number }

const NICE: Record<string, string> = { 'cpu-heavy': 'heavy processing', gpu: 'the graphics card' }
const nice = (r: string): string => NICE[r] ?? r

interface Waiter { req: Required<LeaseRequest>; since: number; grant: (l: Lease) => void; cancelled: boolean }

export class LeaseManager {
  private readonly budget: number
  private readonly ttl: number
  private readonly now: () => number
  private readonly held = new Map<number, Lease>()
  private readonly queue: Waiter[] = []
  private nextId = 1

  constructor(o: LeaseOptions) {
    this.budget = o.memoryBudgetGb
    this.ttl = o.defaultTtlMs ?? 6 * 60 * 60_000
    this.now = o.now ?? Date.now
  }

  private normalise(r: LeaseRequest): Required<LeaseRequest> | Refusal {
    const memoryGb = r.memoryGb ?? 0
    if (typeof r.owner !== 'string' || !r.owner) return { ok: false, code: 'invalid', reason: 'A lease needs an owner.', heldBy: [] }
    if (!Number.isFinite(memoryGb) || memoryGb < 0) return { ok: false, code: 'invalid', reason: 'The memory amount is not valid.', heldBy: [] }
    const ttlMs = r.ttlMs ?? this.ttl
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return { ok: false, code: 'invalid', reason: 'The time limit is not valid.', heldBy: [] }
    if (memoryGb > this.budget) return { ok: false, code: 'too-large', reason: `This needs about ${memoryGb} GB of memory, more than the ${this.budget} GB available for this work.`, heldBy: [] }
    return { owner: r.owner, resources: [...new Set(r.resources ?? [])], memoryGb, ttlMs }
  }

  private used(): number { let s = 0; for (const l of this.held.values()) s += l.memoryGb; return s }

  /** Why the request cannot be granted right now, or null if it fits. */
  private blocker(r: Required<LeaseRequest>): Refusal | null {
    for (const res of r.resources) {
      const h = [...this.held.values()].filter((l) => l.resources.includes(res))
      if (h.length) return { ok: false, code: 'resource-busy', reason: `${nice(res)} is being used by ${h[0].owner}. Wait for it to finish.`, heldBy: h.map((l) => l.owner) }
    }
    if (this.used() + r.memoryGb > this.budget) {
      return { ok: false, code: 'memory-full', reason: `Not enough memory free right now (${r.memoryGb} GB needed, ${Math.max(0, this.budget - this.used())} GB free).`, heldBy: [...this.held.values()].map((l) => l.owner) }
    }
    return null
  }

  private grant(r: Required<LeaseRequest>): Lease {
    const t = this.now()
    const lease: Lease = { id: this.nextId++, owner: r.owner, resources: r.resources, memoryGb: r.memoryGb, grantedAt: t, expiresAt: t + r.ttlMs }
    this.held.set(lease.id, lease)
    return lease
  }

  /** Immediate grant or a plain refusal. A request never jumps ahead of anyone already waiting. */
  acquire(request: LeaseRequest): Acquired {
    this.sweep()
    const r = this.normalise(request)
    if ('ok' in r) return r
    const ahead = this.queue.find((w) => !w.cancelled)
    if (ahead) return { ok: false, code: 'queued-ahead', reason: `${ahead.req.owner} is already waiting for its turn.`, heldBy: [ahead.req.owner] }
    const b = this.blocker(r)
    if (b) return b
    return { ok: true, lease: this.grant(r) }
  }

  /** Joins a first-in-first-out line; resolves when granted. Invalid requests resolve to a refusal at once. */
  wait(request: LeaseRequest, signal?: AbortSignal): Promise<Acquired> {
    this.sweep()
    const r = this.normalise(request)
    if ('ok' in r) return Promise.resolve(r)
    if (!this.queue.some((w) => !w.cancelled) && !this.blocker(r)) return Promise.resolve({ ok: true, lease: this.grant(r) })
    return new Promise((resolve) => {
      const w: Waiter = { req: r, since: this.now(), cancelled: false, grant: (l) => resolve({ ok: true, lease: l }) }
      this.queue.push(w)
      signal?.addEventListener('abort', () => {
        if (w.cancelled) return
        w.cancelled = true
        const i = this.queue.indexOf(w)
        if (i >= 0) this.queue.splice(i, 1)
        resolve({ ok: false, code: 'queued-ahead', reason: 'Stopped waiting.', heldBy: [] })
        this.pump()
      }, { once: true })
    })
  }

  /** Frees a lease. Returns false if it was already released or reclaimed (a second release is a no-op). */
  release(lease: Lease | number): boolean {
    const had = this.held.delete(typeof lease === 'number' ? lease : lease.id)
    if (had) this.pump()
    return had
  }

  /** Extends a live lease. False if it is gone. */
  renew(lease: Lease | number, ttlMs?: number): boolean {
    const l = this.held.get(typeof lease === 'number' ? lease : lease.id)
    if (!l) return false
    l.expiresAt = this.now() + (ttlMs ?? this.ttl)
    return true
  }

  /** Reclaims stale leases. Returns the ones reclaimed. */
  sweep(): Lease[] {
    const t = this.now()
    const gone: Lease[] = []
    for (const l of [...this.held.values()]) if (l.expiresAt <= t) { this.held.delete(l.id); gone.push(l) }
    if (gone.length) this.pump()
    return gone
  }

  /** Runs fn holding the lease; the lease is always released, including when fn throws. */
  async run<T>(request: LeaseRequest, fn: (lease: Lease) => Promise<T> | T): Promise<{ ok: true; value: T } | Refusal> {
    const a = this.acquire(request)
    if (!a.ok) return a
    try { return { ok: true, value: await fn(a.lease) } } finally { this.release(a.lease) }
  }

  private pump(): void {
    while (this.queue.length) {
      const w = this.queue[0]
      if (w.cancelled) { this.queue.shift(); continue }
      if (this.blocker(w.req)) return // strict FIFO: the head waits, nobody passes it
      this.queue.shift()
      w.grant(this.grant(w.req))
    }
  }

  snapshot(): LeaseSnapshot {
    this.sweep()
    const t = this.now()
    return {
      memoryBudgetGb: this.budget,
      memoryUsedGb: this.used(),
      held: [...this.held.values()].map((l) => ({ id: l.id, owner: l.owner, resources: [...l.resources], memoryGb: l.memoryGb, heldMs: t - l.grantedAt, expiresInMs: l.expiresAt - t })),
      waiting: this.queue.filter((w) => !w.cancelled).map((w) => ({ owner: w.req.owner, resources: [...w.req.resources], memoryGb: w.req.memoryGb, waitedMs: t - w.since }))
    }
  }
}
