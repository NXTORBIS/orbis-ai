import {
  DEFAULT_CHESS_SETTINGS, FIELDS, readChessSettings, valueAt, type ChessSettings
} from '../../../../../shared/chess/settings.ts'

/**
 * The copy of the settings kept in this window's own storage, and the one rule that makes it safe.
 *
 * The settings live in the profile now. This copy is a **mirror**, not a second answer: it exists so that the board
 * colours can go on the document element synchronously, before a message across the boundary could possibly have
 * come back. Without it, somebody who chose Walnut sees one frame of Slate on every launch.
 *
 * A mirror of something slower is an ordinary thing to want and a dangerous thing to write, because the first launch
 * after this change is a profile with no settings file and a window with a year of settings in it. The profile's
 * answer in that moment is *the defaults*, and a mirror that wrote whatever the profile last said would replace the
 * person's real settings with stock ones a moment before anything had a chance to move them into the profile. They
 * would then be moved -- and what moved would be the stock ones.
 *
 * So: **the mirror is only ever written from settings something really holds.** Never from the untouched defaults.
 * `mirrorToWrite` is that rule, it is the only way the mirror is written, and it is why this is a separate file with
 * nothing in it but pure functions -- it can be tested, and it is.
 */

/**
 * True when nothing has been chosen: every field is still what Orbis came with.
 *
 * Field by field through the one list of fields, rather than by comparing two pieces of JSON. Two identical sets of
 * settings whose keys were written in a different order are the same settings, and `JSON.stringify` says they are
 * not -- which here would mean writing a mirror that should not be written.
 */
export const nothingKept = (settings: ChessSettings): boolean =>
  FIELDS.every((field) => valueAt(settings, field.path) === valueAt(DEFAULT_CHESS_SETTINGS, field.path))

/**
 * The mirror read back from whatever text was stored, or null when there is nothing usable there.
 *
 * `readChessSettings` does the deciding, field by field, so one bad value in the mirror costs that value rather than
 * the whole first frame. Text that is not JSON at all is null: this is a cache, so there is nothing to recover and
 * nothing to report -- and the real copy, in the profile, has not been touched.
 */
export function mirrorFrom(text: string | null): ChessSettings | null {
  if (text === null || text.trim() === '') return null
  try {
    return readChessSettings(JSON.parse(text) as unknown).settings
  } catch {
    return null
  }
}

/** The text to write into the mirror, or null when it must not be written. See the note at the top of this file. */
export function mirrorToWrite(settings: ChessSettings): string | null {
  return nothingKept(settings) ? null : JSON.stringify(settings)
}
