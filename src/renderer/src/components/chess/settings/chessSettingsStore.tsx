import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BOARD_STYLE_ATTRIBUTES,
  DEFAULT_CHESS_SETTINGS,
  boardStyleAttributes,
  resetGroup,
  withField,
  type ChessSettings,
  type FieldPath,
  type GroupId
} from '../../../../../shared/chess/settings'
import { coalesced, firstRead, reason, windowStore, type Answer } from '../keeping'
import { mirrorFrom, mirrorToWrite, nothingKept } from './mirror'

/**
 * Where Chess World's settings are kept, and how they reach a board.
 *
 * ## Where they are kept
 *
 * In the profile, in `personal/chess-settings.json`, through `window.api.chessSettings()` and
 * `window.api.chessSaveSettings()`. So they follow the profile rather than the computer, two accounts sharing one
 * machine no longer share a board colour, and they travel in a profile export.
 *
 * They used to be in this window's own storage under one key, and that key is still written -- but as a **mirror**,
 * not as a second answer. The reason is the next section, and the rule about it is simple: the profile is the truth,
 * the mirror is only ever used for the first frame, and whatever the profile says overwrites it the moment it
 * arrives. The old copy is also what the first launch after this change brings across (`firstRead` in `keeping.ts`).
 *
 * ## Why the mirror has to exist
 *
 * `applyStoredChessBoardSettings` is called from `ChessView`'s mount effect and puts the board settings on the
 * document element, where Chess World's stylesheet reads them. Every board in the window is painted from those
 * attributes, including boards in areas that know nothing about this file. Reading the profile is a message across
 * the boundary and takes a moment -- and a board painted before the answer arrives is painted in the colours Orbis
 * came with, which means somebody who chose Walnut yesterday sees Slate flash on every launch.
 *
 * So the call stays synchronous. It puts the mirror's colours on at once, then asks the profile and puts those on
 * when they come. The attributes are already set, so nothing is ever unstyled, and the only thing the mirror can be
 * wrong about is one frame of a board colour -- which is the whole of what it is for.
 *
 * ## How a board setting reaches a board
 *
 * By those attributes, which the stylesheet beside this file selects on. They are set and left there: the point of
 * them is that they outlive this panel, so the real board on the Study screen keeps the colours somebody chose after
 * they close the settings.
 */

/** The key the settings used to live under, now the first-frame mirror and the copy an older Orbis can still read. */
export const SETTINGS_KEY = 'orbis.chess.settings'

/** What a screen is handed. */
export interface ChessSettingsStore {
  settings: ChessSettings
  /** True until the profile has answered. Nothing about `settings` means anything yet while this is true. */
  loading: boolean
  /** What could not be read out of the saved settings, in sentences to show. Empty nearly always. */
  fallbacks: readonly string[]
  /**
   * Why nothing can be saved, when nothing can. Null when saving works.
   *
   * Set when the settings file is there and Orbis could not read it -- in which case nothing is written over it -- and
   * when a save was refused or could not be sent at all.
   */
  problem: string | null
  /** What was brought across from this window's own storage on the first read. Null nearly always. */
  carried: string | null
  setField: (path: FieldPath, value: string | number | boolean) => void
  resetOneGroup: (group: GroupId) => void
  /** Clears the notices once they have been read. The values themselves are already in force. */
  clearNotices: () => void
}

const defaults = (): ChessSettings => ({
  board: { ...DEFAULT_CHESS_SETTINGS.board },
  moves: { ...DEFAULT_CHESS_SETTINGS.moves },
  sound: { ...DEFAULT_CHESS_SETTINGS.sound },
  engine: { ...DEFAULT_CHESS_SETTINGS.engine },
  analysis: { ...DEFAULT_CHESS_SETTINGS.analysis }
})

/** The mirror, read without throwing. `mirror.ts` decides what a stored mirror may be. */
const fromMirror = (): ChessSettings | null => mirrorFrom(windowStore().get(SETTINGS_KEY))

/**
 * Keeps the mirror up to date, so the next launch's first frame is right.
 *
 * `mirrorToWrite` answers null for settings nothing has chosen, and that refusal is the whole of what keeps the old
 * copy safe until it has been brought across -- `mirror.ts` says why at length. Failing to write is not worth
 * saying; it is a cache.
 */
function keepMirror(settings: ChessSettings): void {
  const text = mirrorToWrite(settings)
  if (text !== null) windowStore().set(SETTINGS_KEY, text)
}

export function applyBoardSettings(settings: ChessSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [name, value] of Object.entries(boardStyleAttributes(settings))) root.setAttribute(name, value)
}

/** Takes the attributes off again, so a board goes back to exactly what board.css draws. For the preview's own use. */
export function clearBoardSettings(): void {
  if (typeof document === 'undefined') return
  for (const name of BOARD_STYLE_ATTRIBUTES) document.documentElement.removeAttribute(name)
}

/**
 * Puts the saved board settings on the document element.
 *
 * Synchronous on purpose, and then asynchronous: the mirror goes on now so no board is ever painted in the wrong
 * colours, and the profile goes on when it answers. Safe to call more than once; it only ever sets.
 */
export function applyStoredChessBoardSettings(): void {
  if (typeof document === 'undefined') return
  const mirrored = fromMirror()
  if (mirrored !== null) applyBoardSettings(mirrored)
  /*
   * The profile is the truth, so it is asked -- and this is the one place in Chess World that asks it at the moment
   * a module loads, so it asks inside a guard. Nothing waits for the answer, and nothing goes wrong if it never
   * comes: what is on screen is already either the mirror's colours or exactly what board.css draws.
   */
  try {
    void window.api
      .chessSettings()
      .then((answer) => {
        // Nothing in the profile and something in the mirror means the mirror is still this person's own choice,
        // until the settings screen brings it across. Painting the stock board over it would make a chosen board
        // flash to Slate on every launch until somebody happened to open the settings.
        if (mirrored !== null && nothingKept(answer.value)) return
        applyBoardSettings(answer.value)
        keepMirror(answer.value)
      })
      .catch(() => undefined)
  } catch {
    // No way through to the application from this page. The mirror's colours are already on.
  }
}

/**
 * The settings, read from the profile and saved back to it.
 *
 * A change is applied to the screen first and sent afterwards. A send that fails must not stop a setting working for
 * the rest of the session, and `problem` is how the screen says so rather than quietly losing it.
 */
export function useChessSettings(): ChessSettingsStore {
  const [settings, setSettings] = useState<ChessSettings>(defaults)
  const [loading, setLoading] = useState(true)
  const [notices, setNotices] = useState<readonly string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [carried, setCarried] = useState<string | null>(null)
  /** The value as it stands now, for a sender that must not depend on the render it was made in. */
  const held = useRef(settings)
  held.current = settings

  /*
   * One message for a burst of changes rather than one per change. Dragging the volume slider is twenty changes in a
   * second, and each of them used to be a `setItem` that cost nothing.
   */
  const sender = useRef(
    coalesced<ChessSettings>(async (value) => {
      try {
        const answer = await window.api.chessSaveSettings(value)
        setProblem(answer.refused)
        if (answer.refused === null) keepMirror(answer.value)
      } catch (err) {
        setProblem(`Your chess settings were not saved (${reason(err)}). What you changed works until Orbis is closed and is then forgotten.`)
      }
    })
  )

  const take = useCallback((answer: Answer<ChessSettings> & { carried?: string | null }): void => {
    setSettings(answer.value)
    held.current = answer.value
    setNotices(answer.notes)
    setProblem(answer.refused)
    setCarried(answer.carried ?? null)
    setLoading(false)
    if (answer.refused === null) keepMirror(answer.value)
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      take(
        await firstRead<ChessSettings>({
          key: SETTINGS_KEY,
          what: 'chess settings',
          read: () => window.api.chessSettings(),
          save: (value) => window.api.chessSaveSettings(value),
          // Settings the profile has never changed are the ones Orbis came with, and an old copy has as good a claim
          // on a file with nothing chosen in it as on one that was never written.
          isEmpty: nothingKept,
          fromBrowser: mirrorFrom,
          storage: windowStore(),
          now: Date.now
        })
      )
    } catch (err) {
      // Read, and it could not be asked for at all. The screen keeps working on the defaults and says why.
      setLoading(false)
      setProblem(`Your chess settings could not be read (${reason(err)}), so these are the ones Orbis came with. Nothing has been written over them.`)
    }
  }, [take])

  useEffect(() => {
    void load()
    // A different profile is a different record, so it is read again rather than carried over.
    const stop = window.api.onProfileChanged(() => void load())
    return () => {
      stop()
      void sender.current.flush()
    }
  }, [load])

  // The board settings go on the document element and stay there, so every board in the window follows them.
  useEffect(() => {
    if (!loading) applyBoardSettings(settings)
  }, [loading, settings])

  // What is waiting goes before the window does. Without this a setting changed and then closed on is lost.
  useEffect(() => {
    const leaving = (): void => {
      void sender.current.flush()
    }
    window.addEventListener('pagehide', leaving)
    return () => window.removeEventListener('pagehide', leaving)
  }, [])

  /** Keeps a new value and arranges for it to be sent. Called from inside the updater so it has the new value. */
  const keep = useCallback((next: ChessSettings): ChessSettings => {
    held.current = next
    sender.current.queue(next)
    return next
  }, [])

  const setField = useCallback((path: FieldPath, value: string | number | boolean): void => {
    // Refused values come back as the same object, so nothing is sent for a change that was not one.
    setSettings((now) => {
      const next = withField(now, path, value)
      return next === now ? now : keep(next)
    })
  }, [keep])

  const resetOneGroup = useCallback((group: GroupId): void => {
    setSettings((now) => keep(resetGroup(now, group)))
  }, [keep])

  const clearNotices = useCallback(() => {
    setNotices([])
    setCarried(null)
  }, [])

  return { settings, loading, fallbacks: notices, problem, carried, setField, resetOneGroup, clearNotices }
}

/**
 * The settings, read and never written. For a screen that has to honour a preference rather than change one.
 *
 * This exists because of one setting and the fault it had. "The bar beside the board" is a `board-prop` field: the
 * board takes an `evalBar` prop and the honest route for it is the prop, not the stylesheet. But no screen read the
 * value, so the switch was drawn as a live control -- the settings screen's whole promise is that a control means
 * something -- and it neither put a bar on a board nor took away the one the Study screen draws. A switch somebody
 * has found to be false is the reason they stop believing the rest of the screen.
 *
 * Deliberately not `useChessSettings`. That one migrates an old copy on its first read and saves the result, so two
 * of them mounted at once would be two migrations of the same file. This only ever reads.
 *
 * Seeded from the mirror so the first frame is already right, exactly as `applyStoredChessBoardSettings` is, and a
 * profile with nothing chosen in it leaves the mirror alone for the same reason that one does.
 */
export function useChessPrefs(): ChessSettings {
  const [settings, setSettings] = useState<ChessSettings>(() => fromMirror() ?? defaults())
  useEffect(() => {
    let alive = true
    const read = (): void => {
      try {
        void window.api
          .chessSettings()
          .then((answer) => {
            if (!alive || nothingKept(answer.value)) return
            setSettings(answer.value)
          })
          .catch(() => undefined)
      } catch {
        // No way through to the application from this page. The mirror's answer is already in hand, and the
        // defaults behind it are the ones Orbis came with -- never a blank.
      }
    }
    read()
    let stop = (): void => undefined
    try {
      stop = window.api.onProfileChanged(read)
    } catch {
      // Same as above: no application, and so no profile to change.
    }
    return () => {
      alive = false
      stop()
    }
  }, [])
  return settings
}

/*
 * Put the board settings in force as soon as anything in Chess World loads this module, rather than waiting for
 * somebody to open the settings panel. Without this, a board chosen yesterday would be the standard blue-grey one
 * until the settings were opened once -- a preference that looks like it did not save.
 */
applyStoredChessBoardSettings()

/*
 * And take them off again when the profile changes.
 *
 * The attributes sit on the document element and outlive every screen, so nothing else would ever remove the last
 * profile's board colours: switching from somebody who chose Walnut to somebody who chose nothing would leave the
 * second person looking at the first person's board. Listened for here rather than in the settings screen, because
 * the screen is usually not open and the boards that read these attributes are everywhere.
 *
 * What the profile says is applied exactly, including "nothing chosen", which really is the stock board for a
 * profile that has not chosen. The mirror is not consulted: after a switch there is no telling whose it is, and it
 * exists for one frame at launch rather than as a second answer.
 */
try {
  window.api.onProfileChanged(() => {
    void window.api
      .chessSettings()
      .then((answer) => {
        applyBoardSettings(answer.value)
        keepMirror(answer.value)
      })
      .catch(() => undefined)
  })
} catch {
  // No way through to the application from this page, and so no profile to change.
}

export { DEFAULT_CHESS_SETTINGS }
