import { DEFAULT_DAY_RULES, type DayRules } from './calendar.ts'
import { totalsOf, type ArcadeRecord } from './record.ts'
import { PLAY_ONE, streakOf } from './streaks.ts'

/**
 * Things that open as you play, and what each one actually does.
 *
 * ## Two rules, and they are the whole design
 *
 * **Every unlock opens from something counted.** Finished runs, different games finished, day challenges completed, a
 * run of days. Nothing opens because you have been here a while, or because the arcade would like you to stay: there
 * is no engagement figure anywhere in these files to open anything from.
 *
 * **Every unlock does something, and the something is written down.** An unlock whose reward is a word on a screen is
 * a lie with a progress bar in front of it. So `does` says what appears when it opens, in plain words, and if a thing
 * is not built it is not on this list.
 *
 * Nothing here is ever taken away to be sold back: the difficulties, the sound, the high contrast, the whole library
 * and every game in it are there from the first run. What opens is extra -- a challenge, a board, a round, harder
 * goals to hold a streak to.
 */

export type UnlockId = 'daily' | 'board' | 'streak-goals' | 'replay' | 'mixed' | 'daily-second'

export interface Unlock {
  id: UnlockId
  label: string
  /** What appears when it opens. */
  does: string
  /** What it takes, in words. The sentence and the arithmetic come from the same place. */
  condition: string
  check(facts: UnlockFacts): { done: number; target: number }
}

export interface UnlockFacts {
  finished: number
  gamesPlayed: number
  gamesFinished: number
  challenges: number
  /** The longest run of days with a finished run in it, over the days that can be judged. */
  longestRun: number
}

export const UNLOCKS: readonly Unlock[] = Object.freeze([
  {
    id: 'daily',
    label: "The day's challenge",
    does: 'A challenge appears each day -- the same one all day, different tomorrow -- with exactly how it is counted written on it.',
    condition: 'Three runs finished, in any games.',
    check: (f) => ({ done: f.finished, target: 3 })
  },
  {
    id: 'board',
    label: 'The record board',
    does: 'A table of every game you have played: your best, how many runs you finished, and where you stand in it.',
    condition: 'A finished run in five different games.',
    check: (f) => ({ done: f.gamesFinished, target: 5 })
  },
  {
    id: 'streak-goals',
    label: 'Harder daily goals',
    does: "The day's goal can be set to three runs, two different games, or the day's challenge, and the run of days is counted against whichever you chose.",
    condition: 'Three days in a row with a finished run in them.',
    check: (f) => ({ done: f.longestRun, target: 3 })
  },
  {
    id: 'replay',
    label: 'Replay a past day',
    does: "The last seven days' challenges, each still playable, worked out from that day's own date.",
    condition: "Three runs that completed a day's challenge.",
    check: (f) => ({ done: f.challenges, target: 3 })
  },
  {
    id: 'mixed',
    label: 'Mixed round',
    does: "Five games picked by the day's seed, in a set order, to play one after another.",
    condition: 'Eight different games played.',
    check: (f) => ({ done: f.gamesPlayed, target: 8 })
  },
  {
    id: 'daily-second',
    label: 'A second challenge each day',
    does: 'Two challenges a day instead of one, and the run of days counts the first of them.',
    condition: 'Twenty-five runs finished.',
    check: (f) => ({ done: f.finished, target: 25 })
  }
])

/**
 * The counted facts the conditions are checked against.
 *
 * Every one of them only ever goes up, which is what lets an unlock stay open. The run of days needs saying: the list
 * of runs keeps four hundred and adds the older ones up, so a run of days counted from the list alone would shrink
 * when old runs were dropped and something already earned would close again. The longest run measured before they
 * were added up is kept on the roll-up, and the answer here is whichever is longer.
 */
export function unlockFacts(record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): UnlockFacts {
  const totals = totalsOf(record)
  return {
    finished: totals.finished,
    gamesPlayed: totals.gamesPlayed,
    gamesFinished: totals.gamesFinished,
    challenges: totals.challenges,
    longestRun: Math.max(streakOf(PLAY_ONE, record, now, rules).longest, record.before?.longestRun ?? 0)
  }
}

export interface UnlockStanding {
  unlock: Unlock
  open: boolean
  done: number
  target: number
  /** 0..1, for a bar. */
  fraction: number
  says: string
}

export function unlockStandings(record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): UnlockStanding[] {
  const facts = unlockFacts(record, now, rules)
  return UNLOCKS.map((unlock) => {
    const { done, target } = unlock.check(facts)
    const open = done >= target
    return {
      unlock,
      open,
      done: Math.min(done, target),
      target,
      fraction: target > 0 ? Math.min(1, done / target) : 0,
      says: open ? `Open. ${unlock.does}` : `${Math.min(done, target)} of ${target}. ${unlock.condition}`
    }
  })
}

/** Whether one thing is open. The screen asks this before offering it, so nothing is offered that has not been earned. */
export function isOpen(id: UnlockId, record: ArcadeRecord, now: number, rules: DayRules = DEFAULT_DAY_RULES): boolean {
  const facts = unlockFacts(record, now, rules)
  const unlock = UNLOCKS.find((one) => one.id === id)
  if (!unlock) return false
  const { done, target } = unlock.check(facts)
  return done >= target
}
