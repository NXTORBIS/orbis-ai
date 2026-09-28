import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExperienceConfig } from '../../../shared/experience'
import { activePreset, appearanceVariables, defaultConfig, wantsReducedMotion } from '../../../shared/experience'
import { presetBackdrop } from '../../../shared/presets'

/**
 * The Experience Runtime in the window: it applies whatever the user has personalised, and nothing else. Every value
 * Orbis itself decides is left alone, so an untouched Orbis looks and behaves exactly as it always has.
 */

const MARK = 'data-experience'

/**
 * Whether anyone is looking.
 *
 * A background that moves should stop moving when the window is minimised or covered, and this is the whole of how
 * that happens: one listener, registered once, writing one attribute that the stylesheet pauses animations on. It is
 * set up on first use rather than at import so that nothing is registered in a window that never applies a
 * configuration, and it is never torn down because the document outlives every screen that reads it.
 */
let watchingVisibility = false

function watchVisibility(): void {
  if (watchingVisibility) return
  watchingVisibility = true
  const show = (): void => {
    if (document.visibilityState === 'visible') delete document.documentElement.dataset.window
    else document.documentElement.dataset.window = 'hidden'
  }
  document.addEventListener('visibilitychange', show)
  show()
}

/** Puts a configuration on screen. Anything not personalised is removed rather than set to a default. */
export function applyExperience(config: ExperienceConfig, systemReducedMotion: boolean): void {
  const root = document.documentElement
  watchVisibility()
  const variables = appearanceVariables(config, systemReducedMotion)
  // Whatever this runtime set last time is taken off first, so turning a setting off really turns it off.
  const previous = (root.getAttribute(MARK) ?? '').split(' ').filter(Boolean)
  for (const name of previous) if (!(name in variables)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
  root.setAttribute(MARK, Object.keys(variables).join(' '))

  const density = config.appearance.density
  if (density === 'comfortable') delete root.dataset.density
  else root.dataset.density = density

  const uiScale = Math.max(config.appearance.fontScale, config.accessibility.largerText ? 1.15 : 0)
  if (uiScale === 1) {
    delete root.dataset.uiScale
    root.style.removeProperty('--ui-scale')
  } else {
    root.dataset.uiScale = 'on'
    root.style.setProperty('--ui-scale', String(uiScale))
  }

  if (config.appearance.cornerRadius) {
    root.dataset.corners = 'on'
    root.style.setProperty('--corner-radius', `${config.appearance.cornerRadius}px`)
  } else {
    delete root.dataset.corners
    root.style.removeProperty('--corner-radius')
  }

  if (config.appearance.blur === 1) {
    delete root.dataset.blur
    root.style.removeProperty('--blur-scale')
  } else {
    root.dataset.blur = 'on'
    root.style.setProperty('--blur-scale', String(config.appearance.blur))
  }

  if (config.accessibility.highContrast) root.dataset.contrast = 'high'
  else delete root.dataset.contrast

  if (config.accessibility.alwaysShowFocus) root.dataset.focusRings = 'always'
  else delete root.dataset.focusRings

  const still = wantsReducedMotion(config, systemReducedMotion)
  if (still) root.dataset.motion = 'reduced'
  else delete root.dataset.motion

  // Which of Orbis's background animations runs, if any. Naming it on the document rather than as a variable means
  // stillness is the absence of a rule: nothing is animating at zero speed in the background of a quiet Orbis.
  const backdrop = presetBackdrop(activePreset(config), still)
  if (backdrop) root.dataset.backdrop = backdrop
  else delete root.dataset.backdrop
}

export interface Experience {
  config: ExperienceConfig
  /** What is really stored, ignoring any preview: what a screen should compare its own draft against. */
  saved: ExperienceConfig
  /** True until the stored configuration has been read, so nothing flashes on startup. */
  loading: boolean
  /** Shows a configuration without saving it, for live preview while the user is choosing. */
  preview(config: ExperienceConfig | null): void
  /** Saves a configuration (and keeps a snapshot of what it was). */
  save(config: ExperienceConfig, reason?: string): Promise<void>
  /** Throws away a preview and puts back what is saved. */
  cancelPreview(): void
}

/**
 * The window's view of the Experience Runtime. One of these is created in App; everything else reads the configuration
 * from the DOM, so no component has to subscribe to anything to look right.
 */
export function useExperience(): Experience {
  const [config, setConfig] = useState<ExperienceConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [previewed, setPreviewed] = useState<ExperienceConfig | null>(null)
  const savedRef = useRef<ExperienceConfig>(defaultConfig())
  const systemMotion = useRef(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    systemMotion.current = query.matches
    const onChange = (): void => {
      systemMotion.current = query.matches
      applyExperience(previewed ?? savedRef.current, systemMotion.current)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [previewed])

  useEffect(() => {
    let alive = true
    void window.api.getExperience().then((stored) => {
      if (!alive) return
      savedRef.current = stored
      setConfig(stored)
      setLoading(false)
      applyExperience(stored, systemMotion.current)
    })
    const off = window.api.onExperienceChanged((next) => {
      savedRef.current = next
      setConfig(next)
      // A change from elsewhere (another window, or Orion) shows at once, unless the user is previewing something.
      setPreviewed((current) => {
        applyExperience(current ?? next, systemMotion.current)
        return current
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const preview = useCallback((next: ExperienceConfig | null): void => {
    setPreviewed(next)
    applyExperience(next ?? savedRef.current, systemMotion.current)
  }, [])

  const cancelPreview = useCallback((): void => {
    setPreviewed(null)
    applyExperience(savedRef.current, systemMotion.current)
  }, [])

  const save = useCallback(async (next: ExperienceConfig, reason?: string): Promise<void> => {
    const { config: saved } = await window.api.saveExperience(next, reason)
    savedRef.current = saved
    setConfig(saved)
    setPreviewed(null)
    applyExperience(saved, systemMotion.current)
  }, [])

  return { config: previewed ?? config, saved: config, loading, preview, save, cancelPreview }
}
