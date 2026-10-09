import { useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell from './LabShell'
// The studio is the user's own, whole: their hub, their twenty-six modules, their periodic table and their
// element pages. This file mounts it and carries a request from Orion into it.
import StudioPage from '../../chemistry/StudioPage.jsx'
import { apply, type Ask } from '../../chemistry/control'
import '../../physics/physics.css'
import '../../chemistry/chemistry.css'
import './phase8.css'

/**
 * The Chemistry Studio.
 *
 * ## It is their studio, not a frame around its parts
 *
 * The same lesson as the Physics Studio: mounting the hub keeps their grouping, their search across modules,
 * their version labels and their periodic table. Picking the modules out of the registry and drawing a new list
 * would quietly lose all of it, and would stop working the moment they changed a page.
 *
 * The chemistry stylesheet needs the physics one first, because the ported pages are written in the same
 * utilities and the physics port already defines most of them. Loading only the chemistry sheet would leave
 * about 140 of them undefined, which does not fail — it lays out wrong.
 */
export default function ChemistryStudio({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const [doing, setDoing] = useState<{ done: string[]; refused: string[] } | null>(null)

  /*
   * What Orion asked for, carried out on the studio.
   *
   * Same approach as the physics studio and for the same reason: their twenty-six modules each keep their own
   * state and share no store, so working the screen is the only way in.
   */
  const applied = useRef<string>('')
  const values = instance?.values
  useEffect(() => {
    if (!values) return
    const ask: Ask = {}
    if (typeof values.module === 'string' && values.module !== '') ask.module = values.module
    if (typeof values.element === 'string' && values.element !== '') ask.element = values.element
    if (typeof values.tab === 'string' && values.tab !== '') ask.tab = values.tab
    if (typeof values.settings === 'string' && values.settings.trim() !== '') {
      const set: Record<string, string> = {}
      for (const part of values.settings.split(/[,;]/)) {
        const at = part.indexOf('=')
        if (at < 0) continue
        const name = part.slice(0, at).trim()
        const value = part.slice(at + 1).trim()
        if (name !== '' && value !== '') set[name] = value
      }
      if (Object.keys(set).length > 0) ask.set = set
    }

    const signature = JSON.stringify(ask)
    if (signature === applied.current || signature === '{}') return
    applied.current = signature

    let alive = true
    void (async () => {
      const got = await apply(ask)
      if (!alive) return
      setDoing(got.refused.length > 0 || got.done.length > 0 ? { done: got.done, refused: got.refused } : null)
    })()
    return () => {
      alive = false
    }
  }, [values])

  return (
    <LabShell
      title="Chemistry Studio"
      summary="Twenty-six modules — the periodic table, reactions, kinetics, spectroscopy, biochemistry and the rest — each one worked out rather than looked up."
      refused={null}
      broke={null}
      busy={false}
      ready
      instance={instance}
      onConfigure={onConfigure}
      tabs={undefined}
      showing="studio"
      onShow={() => undefined}
      aside={null}
    >
      {doing !== null && (doing.done.length > 0 || doing.refused.length > 0) && (
        <div className={`p8-did${doing.refused.length > 0 ? ' partly' : ''}`} role="status">
          {doing.done.map((one) => (
            <span key={one} className="p8-did-done">
              {one}
            </span>
          ))}
          {doing.refused.map((one) => (
            <span key={one} className="p8-did-not">
              {one}
            </span>
          ))}
          <button type="button" className="p8-did-close" aria-label="Hide this" onClick={() => setDoing(null)}>
            ×
          </button>
        </div>
      )}

      <StudioPage />
    </LabShell>
  )
}
