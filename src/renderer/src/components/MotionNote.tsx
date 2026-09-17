import { useCallback, useEffect, useState } from 'react'
import type { ExperienceConfig } from '../../../shared/experience'
import { wantsReducedMotion } from '../../../shared/experience'

/**
 * Why Orbis has stopped animating, when it has.
 *
 * Orbis follows Windows: with animation effects turned off there, every animation and transition is cut to nothing —
 * the chat box's sheen and glide, the orb, the greeting. That is right by default, but with the Visual effects switch
 * still showing "on" it looks like a fault, so the reason is said here, with a way to animate anyway.
 */
export default function MotionNote(): React.JSX.Element | null {
  const [config, setConfig] = useState<ExperienceConfig | null>(null)
  const [systemReduced, setSystemReduced] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    void window.api.getExperience().then(setConfig)
  }, [])

  useEffect(() => {
    load()
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setSystemReduced(query.matches)
    const onChange = (): void => setSystemReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [load])

  if (!config || !wantsReducedMotion(config, systemReduced)) return null

  const bySystem = config.appearance.reducedMotion === 'system' && systemReduced
  const byPerformance = config.performance.mode === 'battery' || config.performance.mode === 'performance'

  const animateAnyway = async (): Promise<void> => {
    setSaving(true)
    try {
      const next: ExperienceConfig = {
        ...config,
        appearance: { ...config.appearance, reducedMotion: 'off' },
        ...(byPerformance ? { performance: { ...config.performance, mode: 'balanced' } } : {})
      }
      await window.api.saveExperience(next, 'Animation turned back on from Settings')
      setConfig(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="setting-note motion-note" role="note">
      <p>
        {bySystem
          ? 'Animations are off because Windows animation effects are turned off (Settings → Accessibility → Visual effects). Orbis follows that, so the chat box, orb and greeting stay still.'
          : byPerformance
            ? `Animations are off because Orbis is in ${config.performance.mode} mode, which keeps movement to a minimum.`
            : 'Animations are off because “Less movement” is set to on in Customize.'}
      </p>
      <button type="button" className="setting-action" disabled={saving} onClick={() => void animateAnyway()}>
        {saving ? 'Turning on…' : 'Animate anyway'}
      </button>
    </div>
  )
}
