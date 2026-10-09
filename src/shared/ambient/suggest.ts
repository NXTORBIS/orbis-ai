/**
 * Deciding whether to say anything at all.
 *
 * ## Silence is the default and usually the right answer
 *
 * This file exists to return `nothing` most of the time. Everything in it is a reason not to speak: too soon
 * after the last one, too uncertain, the same thing was dismissed twice, somebody is typing, a session is
 * running. A suggestion engine without this is a nagging engine, and people switch those off within a day —
 * at which point every good suggestion it would ever have made is lost too.
 *
 * ## It learns from being ignored
 *
 * Dismissing a kind of suggestion makes it rarer; accepting it makes it slightly more welcome. Three dismissals
 * and that kind stops for a long while. This is the whole of the learning — deliberately simple, because a model
 * that decides when to interrupt somebody is a model whose mistakes are maximally annoying.
 *
 * ## One at a time
 *
 * `decide` returns a single suggestion or none. Two suggestions on screen is a dialogue box wearing a disguise.
 */

import type { AmbientContext } from './context.ts'
import { SHOW_FROM } from './context.ts'

export type SuggestionKind =
  | 'nothing'
  | 'show-context'
  | 'continue'
  | 'ask-orion'
  | 'related-content'
  | 'group-tabs'
  | 'save-project'
  | 'related-file'

export interface Suggestion {
  kind: SuggestionKind
  /** What it says, in one short sentence. */
  says: string
  /** The buttons, in order. The first is the one that does the thing. */
  actions: { id: string; label: string }[]
  /** What it is about, so acting on it needs no second lookup. */
  contextId: string | null
  /** Why Orbis offered it, for the inspector and for "why am I seeing this". */
  because: string
}

export const NOTHING: Suggestion = { kind: 'nothing', says: '', actions: [], contextId: null, because: '' }

/** What has happened to each kind of suggestion so far. The whole of the memory. */
export interface SuggestionHistory {
  /** How many times each kind was dismissed, ever. */
  dismissed: Readonly<Record<string, number>>
  accepted: Readonly<Record<string, number>>
  /** When each kind was last shown, so the same thing is not offered twice in a row. */
  lastShown: Readonly<Record<string, number>>
  /** When anything at all was last shown. */
  lastAnything: number
}

export function newHistory(): SuggestionHistory {
  return { dismissed: {}, accepted: {}, lastShown: {}, lastAnything: 0 }
}

/** The shortest gap between any two suggestions. Twenty minutes is already often enough to be noticed. */
export const QUIET_FOR = 20 * 60_000
/** And the shortest gap between two of the *same* kind. */
export const SAME_KIND_QUIET_FOR = 3 * 60 * 60_000
/** Dismissed this many times, and the kind is not offered again for a long time. */
export const GIVE_UP_AFTER = 3

export interface Moment {
  now: number
  /** Nothing is offered while somebody is mid-sentence. */
  typing: boolean
  /** A Focus session is running: this is exactly when not to be interrupted. */
  focused: boolean
  /** Deep Focus, where even Orbis's own suggestions have no business appearing. */
  locked: boolean
  /** The person switched it off. */
  paused: boolean
  /** Quiet hours, or whatever else the rest of Orbis already decided. */
  quiet: boolean
  /** Something else is already on screen asking for an answer. */
  busy: boolean
}

/**
 * Whether anything at all may be said right now.
 *
 * Checked before any suggestion is even considered, so that the reasons for silence live in one place and a new
 * kind of suggestion cannot accidentally skip them.
 */
export function mayInterrupt(moment: Moment, history: SuggestionHistory): { may: boolean; why: string } {
  if (moment.paused) return { may: false, why: 'Ambient Intelligence is paused' }
  if (moment.locked) return { may: false, why: 'a locked Focus session is running' }
  if (moment.focused) return { may: false, why: 'a Focus session is running' }
  if (moment.quiet) return { may: false, why: 'quiet hours' }
  if (moment.typing) return { may: false, why: 'they are typing' }
  if (moment.busy) return { may: false, why: 'something else is already asking for an answer' }
  if (moment.now - history.lastAnything < QUIET_FOR) return { may: false, why: 'something was offered recently' }
  return { may: true, why: '' }
}

/** Whether this particular kind may be offered, given how it has gone before. */
export function mayOffer(kind: SuggestionKind, moment: Moment, history: SuggestionHistory): { may: boolean; why: string } {
  const dismissed = history.dismissed[kind] ?? 0
  const accepted = history.accepted[kind] ?? 0
  /*
   * Dismissed three times more than it was accepted: stop.
   *
   * Counted against acceptances rather than absolutely, so a suggestion somebody often finds useful is not
   * silenced by the few times it was not.
   */
  if (dismissed - accepted >= GIVE_UP_AFTER) return { may: false, why: 'this kind has been dismissed too often' }
  const last = history.lastShown[kind] ?? 0
  if (moment.now - last < SAME_KIND_QUIET_FOR) return { may: false, why: 'this kind was offered recently' }
  return { may: true, why: '' }
}

export interface Situation {
  /** What somebody appears to be doing now. */
  current: AmbientContext | null
  /** Something from before that they did not finish, and might want back. */
  unfinished: (AmbientContext & { daysAgo: number }) | null
  /** How many tabs look like they belong together but are not grouped. */
  looseRelatedTabs: number
  /** A file of theirs that matches what they are reading. */
  relatedFile: { id: string; name: string } | null
  /** How many separate times this same subject has come back. A sign it is a project rather than an errand. */
  timesReturned: number
}

/**
 * The one thing worth saying, if anything is.
 *
 * Ordered by how much it helps rather than how clever it is. Picking up something unfinished is the most useful
 * thing this feature does; noticing that some tabs are related is the least, and it comes last.
 */
export function decide(situation: Situation, moment: Moment, history: SuggestionHistory): Suggestion {
  const allowed = mayInterrupt(moment, history)
  if (!allowed.may) return { ...NOTHING, because: allowed.why }

  const offer = (one: Suggestion): Suggestion | null => (mayOffer(one.kind, moment, history).may ? one : null)

  const choices: (Suggestion | null)[] = []

  if (situation.unfinished && situation.unfinished.confidence >= SHOW_FROM) {
    const when = situation.unfinished.daysAgo <= 0 ? 'earlier today' : situation.unfinished.daysAgo === 1 ? 'yesterday' : `${situation.unfinished.daysAgo} days ago`
    choices.push(
      offer({
        kind: 'continue',
        says: `Pick up ${situation.unfinished.title} from ${when}?`,
        actions: [
          { id: 'continue', label: 'Continue' },
          { id: 'dismiss', label: 'Not now' }
        ],
        contextId: situation.unfinished.id,
        because: `you spent ${Math.round(situation.unfinished.seconds / 60)} minutes on it and did not come back`
      })
    )
  }

  /*
   * A subject that keeps coming back is a project.
   *
   * Four separate returns is the threshold, and it still only ever *asks* — nothing here creates a project on
   * somebody's behalf, because a list of projects they did not make is worse than no list.
   */
  if (situation.current && situation.timesReturned >= 4 && situation.current.confidence >= 0.8) {
    choices.push(
      offer({
        kind: 'save-project',
        says: `You keep coming back to ${situation.current.title}. Keep it as a project?`,
        actions: [
          { id: 'save', label: 'Save as a project' },
          { id: 'dismiss', label: 'Not now' },
          { id: 'never', label: 'Stop asking' }
        ],
        contextId: situation.current.id,
        because: `this is the ${situation.timesReturned}th separate time`
      })
    )
  }

  if (situation.relatedFile && situation.current && situation.current.confidence >= SHOW_FROM) {
    choices.push(
      offer({
        kind: 'related-file',
        says: `You have ${situation.relatedFile.name} about this.`,
        actions: [
          { id: 'open', label: 'Open it' },
          { id: 'dismiss', label: 'Not now' }
        ],
        contextId: situation.current.id,
        because: 'a file of yours matches what you are reading'
      })
    )
  }

  if (situation.looseRelatedTabs >= 4) {
    choices.push(
      offer({
        kind: 'group-tabs',
        says: `${situation.looseRelatedTabs} of your tabs look related. Group them?`,
        actions: [
          { id: 'group', label: 'Group them' },
          { id: 'dismiss', label: 'Leave them' }
        ],
        contextId: situation.current?.id ?? null,
        because: 'they are about the same thing and opened together'
      })
    )
  }

  const chosen = choices.find((one): one is Suggestion => one !== null)
  return chosen ?? { ...NOTHING, because: choices.length > 0 ? 'every useful suggestion is in its quiet period' : 'nothing worth saying' }
}

/** The history after a suggestion was shown. */
export function shown(history: SuggestionHistory, kind: SuggestionKind, now: number): SuggestionHistory {
  if (kind === 'nothing') return history
  return { ...history, lastShown: { ...history.lastShown, [kind]: now }, lastAnything: now }
}

/**
 * The history after somebody answered one.
 *
 * "Stop asking" is counted heavily rather than as a flag, so the same give-up rule handles it and there is only
 * one way a kind can fall silent.
 */
export function answered(history: SuggestionHistory, kind: SuggestionKind, how: 'accepted' | 'dismissed' | 'never'): SuggestionHistory {
  if (kind === 'nothing') return history
  if (how === 'accepted') {
    return { ...history, accepted: { ...history.accepted, [kind]: (history.accepted[kind] ?? 0) + 1 } }
  }
  const by = how === 'never' ? GIVE_UP_AFTER + 10 : 1
  return { ...history, dismissed: { ...history.dismissed, [kind]: (history.dismissed[kind] ?? 0) + by } }
}
