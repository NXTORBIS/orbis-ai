import { OfflineGameSettingsFields } from './OfflineGames'
import { useOfflineGames } from '../games/useOfflineGames'

/** The offline games' preferences in Orbis settings (the same ones the offline page offers). */
export default function OfflineGamesSettings(): React.JSX.Element {
  const [data, update] = useOfflineGames()
  return <OfflineGameSettingsFields prefs={data.prefs} setPref={(key, value) => update((d) => ({ ...d, prefs: { ...d.prefs, [key]: value } }))} />
}
