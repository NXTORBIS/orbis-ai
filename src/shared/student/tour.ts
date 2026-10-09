/**
 * Orbi showing somebody round, on the real screens.
 *
 * ## No tutorial screens
 *
 * Every step names a **real Student screen** and a **real element on it**. The tour navigates there and Orbi
 * points at the actual thing, so "this is Focus" is said while Focus is on screen rather than over a drawing of
 * it. A tour made of its own pictures teaches somebody a product that does not exist, and the moment they finish
 * it they are lost.
 *
 * It also means the tour cannot drift: if a screen is renamed or an element goes, `missingSteps` says so and the
 * guard test fails, rather than the tour quietly pointing at nothing.
 *
 * ## Every step is skippable and the whole thing is replayable
 *
 * Twenty-one steps is a lot to sit through, and somebody who wants to start studying should be able to. So the
 * tour can be left at any point, remembers where it got to, and can be started again from Settings — nothing here
 * is a one-time cutscene that can never be seen a second time.
 *
 * ## It teaches, it does not configure
 *
 * The questions about name, age and how somebody likes to work are onboarding's job and happen before this. The
 * tour only ever shows and explains. Mixing the two makes a form that feels like a tour and a tour that feels
 * like a form.
 */

import type { AnchorKind, Expression, Pose } from './orbiCharacter.ts'

/** The screens the tour may visit. The same ids the nav uses, so a wrong one cannot compile. */
export type TourScreen =
  | 'home'
  | 'focus'
  | 'plan'
  | 'learn'
  | 'cards'
  | 'missions'
  | 'mastery'
  | 'goals'
  | 'exams'
  | 'study'
  | 'day'
  | 'progress'
  | 'orbi'
  | 'settings'

export interface TourStep {
  id: string
  /** The real screen this is shown on. The tour navigates here before saying anything. */
  screen: TourScreen
  /**
   * A `data-tour` attribute on the real element Orbi should point at.
   *
   * Null means the step is about the screen as a whole, and Orbi stands beside it rather than pointing at
   * something in particular. Never a CSS selector: a class name is a styling decision and would make the tour
   * break every time somebody tidied a stylesheet.
   */
  mark: string | null
  how: AnchorKind
  pose: Pose
  expression: Expression
  /** What Orbi says. One or two short sentences — the animation does the explaining. */
  says: string
  /** The label on the button that moves on. Usually just "Next". */
  next?: string
}

/**
 * The tour, in order.
 *
 * Ordered the way somebody actually meets the product: what it is for, then how to start, then what protects the
 * session, then what it remembers, and only then the long tail of goals, progress and settings. The first five
 * steps are the ones somebody who leaves immediately will still have seen, so they are the ones that matter.
 */
export const TOUR: readonly TourStep[] = [
  {
    id: 'hello',
    screen: 'home',
    mark: null,
    how: 'beside',
    pose: 'wave',
    expression: 'welcoming',
    says: "I'm Orbi. I live in here, and my job is to turn what you mean to do into something you actually finish."
  },
  {
    id: 'next-action',
    screen: 'home',
    mark: 'next-best',
    how: 'point-at',
    pose: 'point',
    expression: 'encouraging',
    says: 'When you have no idea where to start, this is my answer. One thing, with a reason.'
  },
  {
    id: 'focus',
    screen: 'focus',
    mark: 'focus-start',
    how: 'point-at',
    pose: 'point',
    expression: 'determined',
    says: "This is Focus. You tell me what done looks like, and I'll keep the rest of the web out of the way."
  },
  {
    id: 'focus-lock',
    screen: 'focus',
    mark: 'focus-level',
    how: 'point-at',
    pose: 'point',
    expression: 'guardian',
    says: 'Deep Focus locks the session. You can always end it — it just takes a deliberate press.'
  },
  {
    id: 'shield',
    screen: 'focus',
    /*
     * Guarding something real, not described in a card.
     *
     * The shield is the one thing in the tour that has to be *shown*: Orbi standing in the middle of the panel,
     * in the way, is the whole explanation. Said from a bubble it is a claim; done on screen it is a promise
     * somebody has watched being kept.
     */
    mark: 'focus-start',
    how: 'guard',
    pose: 'shield',
    expression: 'guardian',
    says: "If you open something distracting mid-session, I stand in front of it like this and show you what you're in the middle of."
  },
  {
    id: 'later',
    screen: 'focus',
    mark: null,
    how: 'carry-to',
    pose: 'carry',
    expression: 'playful',
    says: "And I keep it. Nothing is lost — it goes in here, and you can open it after you've finished."
  },
  {
    id: 'music',
    screen: 'settings',
    mark: 'settings-sound',
    how: 'sit-on',
    pose: 'sit',
    expression: 'calm',
    says: 'Sound for the session comes from Orbis Music, the same player as everywhere else.'
  },
  {
    id: 'orion',
    screen: 'learn',
    mark: 'learn-ask',
    how: 'point-at',
    pose: 'point',
    expression: 'thinking',
    says: "When you need something explained, that's Orion. I decide what is worth doing; it does the teaching."
  },
  {
    id: 'cards',
    screen: 'cards',
    mark: null,
    how: 'beside',
    pose: 'read',
    expression: 'reading',
    says: 'Cards are for the things you want to be able to recall without looking them up.'
  },
  {
    id: 'missions',
    screen: 'missions',
    mark: null,
    how: 'beside',
    pose: 'stand',
    expression: 'focused',
    says: "A mission is today's piece of a chapter. Small enough to finish, big enough to count."
  },
  {
    id: 'mastery',
    screen: 'mastery',
    mark: null,
    how: 'beside',
    pose: 'look-around',
    expression: 'curious',
    says: "This is what you know, and I only ever fill it in from things you've actually done."
  },
  {
    id: 'goals',
    screen: 'goals',
    mark: null,
    how: 'beside',
    pose: 'point',
    expression: 'encouraging',
    says: 'A goal is the thing all of this is for. Everything else is a step toward one.'
  },
  {
    id: 'exams',
    screen: 'exams',
    mark: null,
    how: 'beside',
    pose: 'stand',
    expression: 'determined',
    says: 'Tell me when an exam is and I work backwards from it rather than forwards from today.'
  },
  {
    id: 'study',
    screen: 'study',
    mark: null,
    how: 'beside',
    pose: 'carry',
    expression: 'studying',
    says: 'Anything you are reading can come in here — a page, a PDF, a photo of your notes.'
  },
  {
    id: 'day',
    screen: 'day',
    mark: null,
    how: 'beside',
    pose: 'read',
    expression: 'calm',
    says: 'Today is what actually happened, not what you planned. Both are useful.'
  },
  {
    id: 'progress',
    screen: 'progress',
    mark: null,
    how: 'beside',
    pose: 'stand',
    expression: 'proud',
    says: "Progress compares you to you. There's nobody else on these charts."
  },
  {
    id: 'constellation',
    screen: 'progress',
    mark: 'progress-sky',
    how: 'point-at',
    pose: 'point',
    expression: 'excited',
    says: 'Every concept you prove lights one of these. It fills in as you go.'
  },
  {
    id: 'room',
    screen: 'orbi',
    mark: null,
    how: 'sit-on',
    pose: 'sit',
    expression: 'happy',
    says: "And this is mine. It fills up as you get on with things — that's most of what I spend rewards on."
  },
  {
    id: 'notifications',
    screen: 'settings',
    mark: 'settings-notices',
    how: 'point-at',
    pose: 'point',
    expression: 'concerned',
    says: "I'll nudge you sometimes. If I get it wrong, turn it down here and I'll stop."
  },
  {
    id: 'quiet',
    screen: 'settings',
    mark: 'settings-orbi',
    how: 'point-at',
    pose: 'stand',
    expression: 'calm',
    says: 'You can also make me quiet, or smaller, or make me stop moving entirely.'
  },
  {
    id: 'finish',
    screen: 'home',
    mark: null,
    how: 'beside',
    pose: 'wave',
    expression: 'encouraging',
    says: "That's the important part. You don't need to learn the rest today — I'll be here when you need me.",
    next: 'Start my first session'
  }
]

export interface TourState {
  /** Where the tour got to. Null means it has never been started. */
  at: string | null
  /** True once somebody reached the end or left deliberately. */
  done: boolean
  /** Steps whose screens somebody has already been shown, so a replay can skip ahead. */
  seen: readonly string[]
}

export function newTourState(): TourState {
  return { at: null, done: false, seen: [] }
}

export const stepById = (id: string): TourStep | null => TOUR.find((one) => one.id === id) ?? null

export function stepAt(index: number): TourStep | null {
  return TOUR[index] ?? null
}

export function indexOfStep(id: string | null): number {
  if (!id) return 0
  const at = TOUR.findIndex((one) => one.id === id)
  return at < 0 ? 0 : at
}

/** Moving on. Returns null at the end, which is what the caller treats as "finished". */
export function nextStep(id: string | null): TourStep | null {
  return TOUR[indexOfStep(id) + 1] ?? null
}

export function previousStep(id: string | null): TourStep | null {
  const at = indexOfStep(id)
  return at <= 0 ? null : TOUR[at - 1]
}

/** How far through, for the little row of dots. Counted, never estimated. */
export function tourProgress(id: string | null): { step: number; total: number; says: string } {
  const step = indexOfStep(id) + 1
  return { step, total: TOUR.length, says: `${step} of ${TOUR.length}` }
}

/**
 * The screens the tour visits, in the order it first visits them.
 *
 * Used by the guard test: every one of these must be a real screen, and every `mark` must exist somewhere in the
 * renderer. That is the check that keeps a tour honest as the product moves under it.
 */
export function screensVisited(): TourScreen[] {
  const out: TourScreen[] = []
  for (const one of TOUR) if (!out.includes(one.screen)) out.push(one.screen)
  return out
}

/** Every element the tour expects to find. The other half of the same guard. */
export function marksNeeded(): string[] {
  return [...new Set(TOUR.map((one) => one.mark).filter((one): one is string => one !== null))]
}

/**
 * Whether a step can be shown.
 *
 * A step whose element is not on screen — because that screen is empty for a new student, or the feature needs
 * something not set up — is **skipped rather than shown pointing at nothing**. Orbi pointing confidently at empty
 * space is worse than one fewer step.
 */
export function canShow(step: TourStep, presentMarks: readonly string[], onScreen?: TourScreen): boolean {
  if (step.mark === null) return true
  /*
   * A step on another screen is never judged by what is on this one.
   *
   * This was a real bug: asked "can you show the Focus step?" while Home was open, the honest answer is "ask me
   * again once Focus is open" -- and answering "no" skipped almost every step that pointed at anything. So a step
   * elsewhere is always allowed through; the anchor on the arrived screen is what finally reports a miss.
   */
  if (onScreen !== undefined && step.screen !== onScreen) return true
  return presentMarks.includes(step.mark)
}

/** The next step that can actually be shown, from where we are. */
export function nextShowable(id: string | null, presentMarks: readonly string[], onScreen?: TourScreen): TourStep | null {
  let at = indexOfStep(id) + 1
  while (at < TOUR.length) {
    const one = TOUR[at]
    if (canShow(one, presentMarks, onScreen)) return one
    at += 1
  }
  return null
}

/**
 * One feature, explained on its own.
 *
 * What "Explain this feature" uses: somebody on the Cards screen asks what it is for and gets that step's sentence
 * without the other twenty. The whole tour being replayable is not the same as being forced to replay it.
 */
export function explainScreen(screen: TourScreen): TourStep | null {
  return TOUR.find((one) => one.screen === screen) ?? null
}
