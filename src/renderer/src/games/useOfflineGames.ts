import { useCallback, useEffect, useState } from 'react'
import type { OfflineGamesData } from '../../../shared/offlineGames'
import { normalizeData } from '../../../shared/offlineGames'

const KEY = 'orbis.offlineGames'

export function loadOfflineGames(): OfflineGamesData {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return normalizeData(null)
  }
}

const listeners = new Set<(data: OfflineGamesData) => void>()

function saveOfflineGames(data: OfflineGamesData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Storage full or unavailable: the games still work, scores just aren't kept.
  }
  for (const listener of listeners) listener(data)
}

/** The offline games' saved data (scores, favorites, recents, preferences, saved games), shared by every tab and window. */
export function useOfflineGames(): [OfflineGamesData, (update: (data: OfflineGamesData) => OfflineGamesData) => void] {
  const [data, setData] = useState(loadOfflineGames)
  useEffect(() => {
    listeners.add(setData)
    // Another Orbis window changed it.
    const onStorage = (e: StorageEvent): void => {
      if (e.key === KEY) setData(loadOfflineGames())
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(setData)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  const update = useCallback((fn: (data: OfflineGamesData) => OfflineGamesData) => saveOfflineGames(fn(loadOfflineGames())), [])
  return [data, update]
}
