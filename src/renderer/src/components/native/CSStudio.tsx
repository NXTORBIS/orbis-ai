import { useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell from './LabShell'
// The studio is the user's own, whole: their twenty-four-section rail, their problem bank, their lessons, their
// fourteen laboratories and their ninety traced algorithms. This file mounts it and carries a request into it.
import StudioPage from '../../cs/StudioPage.jsx'
import { apply, type Ask } from '../../cs/control'
import '../../physics/physics.css'
import '../../cs/cs.css'
import './phase8.css'

/**
 * The Computer Science Studio.
 *
 * ## It is their studio, not a frame around its parts
 *
 * The same lesson as the Physics and Chemistry studios: mounting their shell keeps the rail, the XP, the
 * progress and the navigation between twenty-four sections. Picking the sections out of a list and drawing a new
 * one would quietly lose all of it and would stop working the moment they changed a page.
 *
 * The chemistry stylesheet is not loaded here and the physics one is, because physics.css owns the `.jx` scope
 * that every ported studio's utilities live under. Loading only `cs.css` would leave some 240 of the 418
 * utilities these pages use undefined, which does not fail — it lays out wrong.
 */
export default function CSStudio({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const [doing, setDoing] = useState<{ done: string[]; refused: string[] } | null>(null)

  /*
   * What Orion asked for, carried out on the studio.
   *
   * Same approach as the other two studios and for the same reason: the pages each keep their own state and
   * share no store, so working the screen is the only way in.
   */
  const applied = useRef<string>('')
  const values = instance?.values
  useEffect(() => {
    if (!values) return
    const ask: Ask = {}
    if (typeof values.section === 'string' && values.section !== '') ask.section = values.section
    if (typeof values.problem === 'string' && values.problem !== '') ask.problem = values.problem
    if (typeof values.algorithm === 'string' && values.algorithm !== '') ask.algorithm = values.algorithm
    if (typeof values.language === 'string' && values.language !== '') ask.language = values.language
    if (typeof values.code === 'string' && values.code !== '') ask.code = values.code

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
      title="Computer Science Studio"
      summary="Ninety algorithms traced step by step, fourteen laboratories, a problem bank and a playground — across twenty-four sections."
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
