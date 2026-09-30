/**
 * What is on the market strip, and where each of it came from.
 *
 * The strip along the bottom has to be full enough to be worth the pixels it takes and short enough to loop, and the
 * markets that belong on it are not all in one list: some were chosen deliberately, some were merely looked at, and the
 * rest are whatever else this person has already told Orbis they care about. Deciding between those is the whole of this
 * file, and it is here -- pure, with no provider, no store and no clock -- because the same decision is made twice: once
 * by the strip inside the Orbis window and once by the strip along the bottom of the browser. Two strips disagreeing
 * about which coins they show would be the same bug the duplicated panels were.
 *
 * What it will not do:
 *
 * **It never passes off a suggestion as a choice.** Every id it returns came from one of the lists it was given, and
 * every one carries where it came from. Once somebody has asked for a full rail it will top the last places up from the
 * busiest markets -- but those are labelled `busiest`, shown as such, and never mixed in with what the person picked,
 * because a strip that quietly added Bitcoin would be telling somebody they watch Bitcoin.
 *
 * **It never loses a deliberate choice to an automatic one.** The chosen group is always first and always complete, even
 * when it alone overruns the slots. Automatic filling is a top-up, so switching it on cannot reorder or evict anything
 * somebody picked.
 *
 * **It says where everything came from.** Each entry carries its origin, so the strip can show a coin somebody chose
 * differently from one it filled in for them, and so "why is this on my ticker" always has an answer.
 */

/** Why a market is on the rail. */
export type StripOrigin =
  /** In the group somebody chose. */
  | 'chosen'
  /** Opened recently. Only ever from the person's own recents, never a guess at what they might have opened. */
  | 'viewed'
  /** Named by one of their watchlists or alerts, used to top the rail up to length. */
  | 'watched'
  /**
   * Nobody asked for this one; it is filling the last places.
   *
   * The busiest markets, and the only entries that did not come from something the person did. They exist because a
   * rail asked to hold sixteen and given four looks like a strip that lost twelve, and they are labelled so that is
   * never mistaken for a list somebody built.
   */
  | 'busiest'

export interface StripSlot {
  instrumentId: string
  origin: StripOrigin
}

export interface StripRequest {
  /** The active group's markets, in the order they were put there. Always kept, always first. */
  chosen: readonly string[]
  /** Markets opened recently, newest first. */
  viewed: readonly string[]
  /** Markets this person's watchlists and alerts already name. Used only to fill. */
  watched: readonly string[]
  /**
   * The busiest markets, most active first. Used last, only with `auto` on, and only to fill places nothing else
   * claimed. Pass nothing and the rail simply ends where the person's own markets end.
   */
  busiest?: readonly string[]
  /** How many distinct markets the rail should hold. */
  slots: number
  /** Whether to fill past the chosen group at all. */
  auto: boolean
}

/** The most a rail may hold, whatever it is asked for. Past this the loop costs more than the strip is worth. */
export const MAX_STRIP_SLOTS = 64

/**
 * The rail, in order.
 *
 * Chosen first, then the most recently opened, then anything else already watched -- each source contributing only what
 * the ones before it did not already cover, so a coin that is both chosen and viewed appears once, as chosen.
 */
export function stripSlots(request: StripRequest): StripSlot[] {
  const slots = Math.max(0, Math.min(Math.floor(request.slots) || 0, MAX_STRIP_SLOTS))
  const out: StripSlot[] = []
  const seen = new Set<string>()

  const take = (ids: readonly string[], origin: StripOrigin, limit: number): void => {
    for (const id of ids) {
      if (out.length >= limit) return
      if (typeof id !== 'string' || id.length === 0) continue
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ instrumentId: id, origin })
    }
  }

  // The chosen group in full, past the slot count if it has to be: the slots are a target for filling, not a limit on
  // what somebody asked to see. A rail cut off in the middle of a list somebody built would look like data loss.
  take(request.chosen, 'chosen', Number.POSITIVE_INFINITY)
  if (!request.auto) return out

  take(request.viewed, 'viewed', slots)
  take(request.watched, 'watched', slots)
  // Last, and labelled. A rail asked to hold sixteen and given four looks like a strip that lost twelve.
  take(request.busiest ?? [], 'busiest', slots)
  return out
}

/** Just the ids, for the places that only need something to subscribe to. */
export function stripInstruments(request: StripRequest): string[] {
  return stripSlots(request).map((one) => one.instrumentId)
}

/**
 * Whether the rail is long enough to loop smoothly, in plain terms, for the strip to say so honestly.
 *
 * A rail with three coins on a wide screen cannot move continuously -- there is nothing to move into view -- so the
 * strip stops rather than jerking, and this is how it knows to say "add more markets" instead of looking broken.
 */
export function stripIsSparse(slots: readonly StripSlot[]): boolean {
  return slots.length < 4
}
