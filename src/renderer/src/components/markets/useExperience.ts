import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EXPERIENCE,
  DEFAULT_SETTINGS,
  resolveExperience,
  type ExperienceLevel,
  type ExperienceSettings,
  type MarketsExperienceProfile,
  type SettingKey,
  type SettingSource
} from '../../../../shared/markets/experience'
import type { Explanation } from '../../../../shared/markets/glossary'
import type { ExperienceAnswer } from '../../../../main/markets/ipc'

/**
 * The one way a Markets screen asks how it should behave.
 *
 * Components ask `experience.get('chartAdvancedToolbar')`, never "is this person a beginner". That is the difference
 * between one adaptation layer and eleven copies of the same condition drifting apart across the panels — and it is what
 * makes the audit possible, because there is exactly one function turning answers into behaviour and it is shared with
 * the main process.
 *
 * Resolved here from the profile, by the same pure function the main process uses on the same data. Resolved once per
 * change of preference, and never on a market tick: a price arriving must not cost a re-resolution, which is why this
 * holds the answer rather than recomputing from the profile on every render.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

export interface ExperienceState {
  /** Null until the first answer arrives. */
  answer: ExperienceAnswer | null
  profile: MarketsExperienceProfile
  settings: ExperienceSettings
  level: ExperienceLevel
  /** True while the first answer is still on its way, so nothing flashes a default at somebody. */
  loading: boolean
  /** True when the first-launch questions have never been answered or skipped for this profile. */
  needsSetup: boolean
  get<K extends SettingKey>(key: K): ExperienceSettings[K]
  /** Where a setting came from, for the "set by you" mark in Settings. */
  source(key: SettingKey): SettingSource
  /** Whether a panel is on the dashboard by default. */
  wants(panel: string): boolean
  /** Whether something should explain itself unasked: education is on and this has not been read yet. */
  shouldIntroduce(termId: string): boolean
  /** Whether a definition is offered at all, however it is asked for. */
  explains: boolean
  setLevel(level: ExperienceLevel): Promise<void>
  /** Sets one thing by hand. From then on no preset changes it. */
  override<K extends SettingKey>(key: K, value: ExperienceSettings[K]): Promise<void>
  /** Back to the preset. Clears what was set by hand and nothing else. */
  reset(): Promise<void>
  setProfile(patch: Partial<MarketsExperienceProfile>): Promise<void>
  /** One definition, in this profile's vocabulary. Null when Markets has none — never invented. */
  explain(asked: string): Promise<Explanation | null>
  /** Remembers that something has been read, so it is not pushed at somebody twice. */
  learn(termId: string, hint?: boolean): Promise<void>
  refresh(): Promise<void>
}

export function useExperience(): ExperienceState {
  const [answer, setAnswer] = useState<ExperienceAnswer | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const got = await window.api.marketsExperience()
    if (!refused(got)) setAnswer(got)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return useMemo(() => {
    const profile = answer?.profile ?? DEFAULT_EXPERIENCE
    // Resolved rather than taken from the answer, so this hook and the main process cannot drift: same function, same
    // profile, same result. The answer's own copy is what a settings screen shows for the sources.
    const resolved = resolveExperience(profile)
    const settings = answer ? resolved.settings : DEFAULT_SETTINGS
    const learned = new Set([...profile.learned, ...profile.seenHints])

    const apply = (got: unknown): void => {
      if (!refused(got)) setAnswer(got as ExperienceAnswer)
    }

    return {
      answer,
      profile,
      settings,
      level: profile.level,
      loading,
      needsSetup: answer?.needsSetup ?? false,
      get: (key) => settings[key],
      source: (key) => (answer?.sources?.[key] as SettingSource | undefined) ?? resolved.source(key),
      wants: (panel) => (settings.panels as readonly string[]).includes(panel),
      // Twice is the thing to avoid. An explanation that keeps reappearing after somebody has read it stops being help.
      shouldIntroduce: (termId) => settings.autoEducation && !learned.has(termId),
      explains: settings.learnActions || settings.explanations !== 'minimal',
      setLevel: async (level) => apply(await window.api.marketsSetExperience({ level })),
      override: async (key, value) => apply(await window.api.marketsExperienceOverride({ [key]: value })),
      reset: async () => apply(await window.api.marketsResetExperience()),
      setProfile: async (patch) => apply(await window.api.marketsSetExperience(patch)),
      explain: async (asked) => {
        const got = await window.api.marketsExplain(asked)
        if (refused(got) || !got.found) return null
        return got.explanation
      },
      learn: async (termId, hint = false) => apply(await window.api.marketsLearned(termId, hint)),
      refresh
    }
  }, [answer, loading, refresh])
}
