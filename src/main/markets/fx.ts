import { isSupported, type Rate } from '../../shared/markets/currency.ts'

/**
 * Exchange rates, from a real source.
 *
 * Frankfurter, which publishes the European Central Bank's daily reference rates. Chosen for the same reason Binance was
 * chosen for prices: it needs no key and no account, so Orbis can convert a price the first time it is opened rather
 * than showing a note about configuring a provider. There is deliberately nowhere in this file to put a credential.
 *
 * Two honest limitations, both reported rather than hidden.
 *
 * **These are daily reference rates, not a live FX market.** They are published once each working day. A price that is
 * live in dollars and converted through them is not live in rupees, and everything downstream is built to say so — the
 * rate's own timestamp travels with every conversion.
 *
 * **When it cannot be reached, nothing is converted.** The last rate is kept and served with its real age, so a screen
 * can say "converted using Friday's rate"; when even that is gone, callers get nothing and show the source-currency
 * price. There is no step anywhere that invents a number.
 */

const BASE = 'https://api.frankfurter.dev/v1'

/** How long a fetched set is reused before asking again. Reference rates change once a day; this is politeness. */
const TTL_MS = 60 * 60_000
/** After a failure, how long before trying again, so an outage is not met with a request per tick. */
const RETRY_MS = 5 * 60_000

export interface FxOptions {
  fetchFn?: typeof fetch
  now?(): number
  ttlMs?: number
}

interface Held {
  /** Rates from one base currency to every other, as the provider gave them. */
  rates: Map<string, number>
  /** The date the provider says these are for, as milliseconds. */
  at: number
  /** When Orbis fetched them, for deciding when to ask again. */
  fetchedAt: number
}

export class FxRates {
  readonly name = 'European Central Bank'
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly ttlMs: number

  private readonly held = new Map<string, Held>()
  private readonly inFlight = new Map<string, Promise<Held | null>>()
  private failingUntil = 0
  private lastFailure = ''

  constructor(options: FxOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? TTL_MS
  }

  /**
   * One rate, or null.
   *
   * Null means no conversion is possible right now — never a guess, and never the last rate presented as current. A
   * caller that gets null shows the price in its own currency, which is true.
   */
  async rate(from: string, to: string): Promise<Rate | null> {
    const source = String(from ?? '').toUpperCase()
    const target = String(to ?? '').toUpperCase()
    if (!source || !target) return null
    if (source === target) return { from: source, to: target, rate: 1, at: this.now(), source: this.name }
    // Only currencies Orbis offers: asking for one it does not know would be a request that can only fail.
    if (!isSupported(source) || !isSupported(target)) return null

    const set = await this.setFor(source)
    if (!set) return null
    const found = set.rates.get(target)
    if (typeof found !== 'number' || !Number.isFinite(found) || found <= 0) return null
    return { from: source, to: target, rate: found, at: set.at, source: this.name }
  }

  /** Several rates from one base in one go, for a screen pricing a whole watchlist. */
  async rates(from: string, targets: string[]): Promise<Map<string, Rate>> {
    const out = new Map<string, Rate>()
    const source = String(from ?? '').toUpperCase()
    const set = isSupported(source) ? await this.setFor(source) : null
    for (const one of targets) {
      const target = String(one ?? '').toUpperCase()
      if (target === source) {
        out.set(target, { from: source, to: target, rate: 1, at: this.now(), source: this.name })
        continue
      }
      const found = set?.rates.get(target)
      if (typeof found === 'number' && Number.isFinite(found) && found > 0) {
        out.set(target, { from: source, to: target, rate: found, at: set!.at, source: this.name })
      }
      // A target with no rate is simply absent. The caller shows the source price for it.
    }
    return out
  }

  /** What to tell a settings screen: where rates come from, how old they are, and whether the last attempt failed. */
  status(base = 'USD'): { source: string; at: number | null; fetchedAt: number | null; failing: string } {
    const set = this.held.get(String(base).toUpperCase())
    return {
      source: this.name,
      at: set?.at ?? null,
      fetchedAt: set?.fetchedAt ?? null,
      failing: this.now() < this.failingUntil ? this.lastFailure : ''
    }
  }

  /** Forgets everything, so the next ask fetches. */
  reset(): void {
    this.held.clear()
    this.inFlight.clear()
    this.failingUntil = 0
    this.lastFailure = ''
  }

  private async setFor(base: string): Promise<Held | null> {
    const at = this.now()
    const held = this.held.get(base)
    if (held && at - held.fetchedAt <= this.ttlMs) return held

    // One request at a time per base: a watchlist of forty opening at once should not become forty requests.
    const already = this.inFlight.get(base)
    if (already) return already

    // Backing off after a failure, and serving what is held rather than hammering a provider that is down. The held set
    // comes back with its real age, so a screen says "converted using an older rate" rather than claiming it is current.
    if (at < this.failingUntil) return held ?? null

    const job = this.fetch(base)
      .then((fetched) => {
        if (fetched) {
          this.held.set(base, fetched)
          this.failingUntil = 0
          this.lastFailure = ''
          return fetched
        }
        return held ?? null
      })
      .finally(() => {
        this.inFlight.delete(base)
      })
    this.inFlight.set(base, job)
    return job
  }

  private async fetch(base: string): Promise<Held | null> {
    try {
      const response = await this.fetchFn(`${BASE}/latest?base=${encodeURIComponent(base)}`, {
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) {
        this.fail(`The exchange-rate service answered ${response.status}.`)
        return null
      }
      const body = (await response.json()) as { date?: unknown; base?: unknown; rates?: Record<string, unknown> }
      const rates = new Map<string, number>()
      for (const [code, value] of Object.entries(body.rates ?? {})) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates.set(code.toUpperCase(), value)
      }
      if (rates.size === 0) {
        this.fail('The exchange-rate service sent no usable rates.')
        return null
      }

      // The provider's own date for the rates, which is what a conversion's age must be measured from. Its absence is
      // not an excuse to stamp them with now: a rate with an unknown date is reported as fetched-now and nothing more.
      const date = typeof body.date === 'string' ? Date.parse(`${body.date}T16:00:00Z`) : Number.NaN
      return {
        rates,
        at: Number.isFinite(date) ? date : this.now(),
        fetchedAt: this.now()
      }
    } catch {
      this.fail('The exchange-rate service could not be reached.')
      return null
    }
  }

  private fail(reason: string): void {
    this.lastFailure = reason
    this.failingUntil = this.now() + RETRY_MS
  }
}
