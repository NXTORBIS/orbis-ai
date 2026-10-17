import { OfflineGameSettingsFields } from './OfflineGames'
import { ArcadeNotes } from './ArcadeNotes'
import { useOfflineGames } from '../games/useOfflineGames'
import { useSurface } from '../lib/surfaces'
import { gameSettingsSurface } from './arcadeSurfaces'

/**
 * The games' preferences in Orbis settings (the same ones the arcade offers).
 *
 * It waits for the profile rather than drawing the defaults. Showing "sound off, normal difficulty" before the
 * answer arrives, and then having it jump, is the smaller version of the same mistake as showing somebody an empty
 * high-score table: a preference drawn before it is known is a preference somebody may change by accident.
 */
export default function OfflineGamesSettings(): React.JSX.Element {
  const arcade = useOfflineGames()
  const setPref = <K extends keyof NonNullable<typeof arcade.record>['library']['prefs']>(
    key: K,
    value: NonNullable<typeof arcade.record>['library']['prefs'][K]
  ): void => arcade.update((r) => ({ ...r, library: { ...r.library, prefs: { ...r.library.prefs, [key]: value } } }))

  /*
   * What this page lets Orbis read and set.
   *
   * Above the early return, because a hook runs on every draw -- and here that is the point rather than the rule:
   * until the profile has answered there is nothing to read, and `prefs` below throws instead of answering. A getter
   * that throws is reported as "could not be read"; one that handed back the defaults would report the sound as on
   * because a file was slow, which is the same mistake this screen refuses to make on its own.
   */
  useSurface(
    gameSettingsSurface({
      prefs: () => {
        if (arcade.record === null) throw new Error('Your game settings have not been read from this profile yet.')
        return arcade.record.library.prefs
      },
      setPref,
      dayStartHour: () => {
        if (arcade.record === null) throw new Error('Your game settings have not been read from this profile yet.')
        return arcade.record.dayStartHour
      },
      setDayStartHour: (hour) => arcade.update((r) => ({ ...r, dayStartHour: hour })),
      refused: () => arcade.refused
    })
  )

  if (arcade.record === null) {
    return <p className="og-muted og-reading">Reading your game settings…</p>
  }
  return (
    <>
      <ArcadeNotes arcade={arcade} />
      <OfflineGameSettingsFields
        prefs={arcade.record.library.prefs}
        setPref={setPref}
        day={{ hour: arcade.record.dayStartHour, setHour: (hour) => arcade.update((r) => ({ ...r, dayStartHour: hour })) }}
      />
    </>
  )
}
