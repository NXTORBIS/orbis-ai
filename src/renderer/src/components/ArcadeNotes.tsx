import { AlertTriangle, Info } from 'lucide-react'
import type { ArcadeKeeping } from '../games/useOfflineGames'

/**
 * What the arcade has to say about its own record, in the words it was given.
 *
 * There are four different sentences here and they are four different situations, which is the whole reason this is
 * a component rather than one line of text:
 *
 *   **refused** -- the file is there and Orbis could not read it. Nothing has been written over it and nothing will
 *   be until it can be read. This one cannot be dismissed, because everything the player does next is not being
 *   kept and they are entitled to know that the whole time.
 *
 *   **saveProblem** -- a save did not happen. The change is on screen; it is not on the disk.
 *
 *   **notes** -- parts of the record could not be read and were left out. The rest is fine.
 *
 *   **carried** -- scores that were kept in this window have been brought into this profile. Said once, and it is
 *   good news rather than a warning.
 *
 * None of these is written here. Every sentence comes from the store or from `keeping.ts`, which is what makes them
 * accurate: a screen that writes its own version of "something went wrong" is a screen guessing at what happened.
 */
export function ArcadeNotes({ arcade }: { arcade: Pick<ArcadeKeeping, 'notes' | 'refused' | 'saveProblem' | 'carried'> }): React.JSX.Element | null {
  const problems = [arcade.refused, arcade.saveProblem].filter((one): one is string => one !== null)
  if (problems.length === 0 && arcade.notes.length === 0 && arcade.carried === null) return null
  return (
    <div className="og-notes">
      {problems.map((one) => (
        <p key={one} className="og-note bad" role="alert">
          <AlertTriangle size={14} aria-hidden /> {one}
        </p>
      ))}
      {arcade.notes.map((one) => (
        <p key={one} className="og-note" role="status">
          <Info size={14} aria-hidden /> {one}
        </p>
      ))}
      {arcade.carried !== null && (
        <p className="og-note good" role="status">
          <Info size={14} aria-hidden /> {arcade.carried}
        </p>
      )}
    </div>
  )
}
