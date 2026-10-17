import CoachPanel from './CoachPanel'
import { useCoachEvidence } from './useCoachEvidence'
import type { StoredGame } from '../../../../../shared/chess/model'
import type { DayRules } from '../../../../../shared/chess/progress'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * The coach, with its own record fetched.
 *
 * `CoachPanel` is a window onto pure functions: it takes records and draws them. Something has to read those records
 * out of the profile, and this is it -- `useCoachEvidence` beside this does the four reads and
 * `shared/chess/evidence.ts` turns them into the shape the coach reads. Keeping them apart is what lets all the
 * counting be tested with `node --test` and none of it depend on a window.
 *
 * This is the component a host mounts. It takes the Library it already has, so the coach is never a second answer to
 * "which games are there".
 */

export interface CoachAreaProps {
  /** The person's saved games, as the host already holds them. */
  games?: readonly StoredGame[]
  /** Fixed for testing. Otherwise taken once when the panel opens. */
  now?: number
  dayRules?: DayRules
  /** Tells one person's saved plan from another's in this window's own storage. */
  storageKey?: string
}

export default function CoachArea({ games, now, dayRules, storageKey }: CoachAreaProps): React.JSX.Element {
  const read = useCoachEvidence(games)

  /*
   * What Orbis itself may do here.
   *
   * Nothing on this screen holds a value that can be set: the coach is a window onto the record, and what it says
   * comes out of games, attempts and recall records rather than out of a control. So this says what the record it is
   * reading really contains, and says plainly when that record could not be read -- which is a different thing from
   * a record with nothing in it.
   */
  useSurface(
    simpleAreaSurface({
      id: 'coach',
      name: 'Coach',
      about: 'What your own record shows, and what it cannot. Nothing here is set; it is all read out of the record.',
      keywords: ['coach', 'progress', 'weaknesses', 'plan', 'goals', 'evidence'],
      state: () => ({
        games: games?.length ?? 0,
        stillReading: read.loading,
        couldNotBeRead: [...read.problems]
      })
    })
  )

  return (
    <CoachPanel
      evidence={read.evidence}
      completions={read.completions}
      coverage={read.coverage}
      evidenceNotes={read.notes}
      problems={read.problems}
      loading={read.loading}
      onReload={read.reload}
      refresh={read.refresh}
      {...(games ? { played: games } : {})}
      {...(now === undefined ? {} : { now })}
      {...(dayRules ? { dayRules } : {})}
      {...(storageKey ? { storageKey } : {})}
    />
  )
}
