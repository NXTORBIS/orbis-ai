import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { featureState, type FeatureState, type VisibilityChoice } from '../../../shared/featureVisibility'
import type { FeatureVisibilityAnswer } from '../../../shared/types'

/**
 * Which features this person has showing, in the window.
 *
 * One of these per window, held by `App.tsx` and handed down. Three channels underneath
 * (`src/main/features/ipc.ts`) and no others: whether a feature is visible, what is essential and what depends on
 * what are all pure shared code, and asking the main process for a computed answer would be a second answer to a
 * question that already has one.
 *
 * ## While it is still arriving
 *
 * `choice` starts null, and null is not "everything" -- `isVisible` answers the essentials for it and nothing else.
 * So in the first few milliseconds of a start the menu is short rather than wrong, which is the direction that
 * matters: a menu that fills in is a menu, and a menu that briefly offers a screen somebody switched off has broken
 * the one promise this feature makes.
 *
 * Anything that acts on somebody's keypress rather than drawing a list uses `settled()` instead, which waits for the
 * first read. A slash command typed into a window one frame old must not be told a screen is off because the file
 * had not been read yet.
 *
 * ## A save that did not happen
 *
 * `refused` set means **nothing was written**. The store refuses rather than overwriting a file it could not read,
 * because a settings file replaced with defaults silently resets somebody's choices and they find out by opening
 * Orbis to a different app. So `set` and `choose` hand the refusal back and the state is left exactly as it was --
 * never the new value, which would show somebody a switch that did not land.
 */
export interface FeatureVisibility {
  /** What is saved, or null until the first read comes back. */
  choice: VisibilityChoice | null
  /** Anything that could not be read, in sentences somebody can be shown. */
  notes: readonly string[]
  /** Set when the file cannot be written. Nothing can be switched while this is set. */
  refused: string | null
  /** The saved choice, waiting for the first read if it has not arrived. Stable across renders. */
  settled(): Promise<VisibilityChoice | null>
  /** What is true about one surface right now, waiting for the first read. Stable across renders. */
  stateOf(id: string): Promise<FeatureState>
  /** Turns one feature on or off. The answer says what was really stored. */
  set(id: string, on: boolean): Promise<FeatureVisibilityAnswer>
  /** Replaces the whole set: what a chooser and the first-run step send. */
  choose(ids: readonly string[]): Promise<FeatureVisibilityAnswer>
}

export function useFeatureVisibility(): FeatureVisibility {
  const [answer, setAnswer] = useState<FeatureVisibilityAnswer | null>(null)
  /** The latest answer, for the callbacks below, which are asked at the moment somebody presses something. */
  const live = useRef<FeatureVisibilityAnswer | null>(null)
  live.current = answer
  /** The first read, so something acting on a keypress can wait for it instead of guessing. */
  const first = useRef<Promise<void> | null>(null)

  const load = useCallback((): Promise<void> => {
    if (first.current) return first.current
    first.current = window.api
      .featureVisibility()
      .then((got) => {
        live.current = got
        setAnswer(got)
      })
      .catch(() => {
        // Nothing is invented here. A read that failed leaves `choice` null, which answers the essentials -- the
        // chat, Settings and the way back -- and nothing else. The app works and nothing is claimed to be on.
        first.current = null
      })
    return first.current
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const settled = useCallback(async (): Promise<VisibilityChoice | null> => {
    await load()
    return live.current?.choice ?? null
  }, [load])

  const stateOf = useCallback(async (id: string): Promise<FeatureState> => featureState(id, await settled()), [settled])

  /** The one write path, so a refusal is handled the same way whichever button asked. */
  const write = useCallback(async (run: () => Promise<FeatureVisibilityAnswer>): Promise<FeatureVisibilityAnswer> => {
    await load()
    const got = await run()
    // Only a save that happened changes what is on screen. A refusal is reported and the old value kept.
    if (got.refused === null) {
      live.current = got
      setAnswer(got)
    } else {
      setAnswer((was) => (was ? { ...was, notes: got.notes, refused: got.refused } : got))
    }
    return got
  }, [load])

  const set = useCallback((id: string, on: boolean) => write(() => window.api.setFeatureVisible(id, on)), [write])
  const choose = useCallback((ids: readonly string[]) => write(() => window.api.chooseVisibleFeatures(ids)), [write])

  /*
   * One object per answer, not one per render.
   *
   * Everything that opens a screen takes this, and several of them hand a function built from it to the control
   * layer, which registers what the window can do. A fresh object every render would re-register the window's own
   * screen on every keystroke in the message box.
   */
  return useMemo(
    () => ({
      choice: answer?.choice ?? null,
      notes: answer?.notes ?? [],
      refused: answer?.refused ?? null,
      settled,
      stateOf,
      set,
      choose
    }),
    [answer, settled, stateOf, set, choose]
  )
}
