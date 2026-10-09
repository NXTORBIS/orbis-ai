import { useEffect, useRef, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell from './LabShell'
// The studio is the original, whole: its own front page, its own section tabs, its own search, its own concept
// panels and explainer, and all 245 topics. This file mounts it and offers the Formula Vault beside it.
import StudioPage from '../../physics/StudioPage.jsx'
import { apply, type Ask } from '../../physics/control'
import { FORMULA_COUNTS, formulaSections, searchFormulas, solve, type Formula } from '../../../../shared/physics/formulas'
import { isSimulationError } from '../../../../shared/physics/simulation'
import '../../physics/physics.css'
import './phase8.css'

/**
 * The Physics Studio.
 *
 * ## It is the original studio, not a frame around its parts
 *
 * An earlier version of this file picked the topics out of the registry and drew its own list. That quietly lost
 * everything the studio's own page does and the registry does not hold: the section tabs, the concept summary on
 * every card, the explainer and its auto-explain setting. Mounting the page itself keeps all of it, and keeps it
 * working when the page changes.
 *
 * ## What this file is responsible for
 *
 * Mounting that page, and offering the Formula Vault on a second tab. Nothing else: the moment this started
 * deciding how the studio should look, it would stop being the studio.
 */
export default function PhysicsStudio({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const [showing, setShowing] = useState('studio')
  const [doing, setDoing] = useState<{ done: string[]; refused: string[] } | null>(null)

  /*
   * What Orion asked for, carried out on the studio.
   *
   * The values arrive as the app's parameters — a topic, the simulation's own settings, a speed, whether to run.
   * They are applied by working the screen, which is the only way in: the 230 simulations each keep their own
   * state and share no store, so there is nothing to write to.
   *
   * The signature of the request is what decides whether to act. Re-applying the same request on every render
   * would fight whoever is using the sliders.
   */
  const applied = useRef<string>('')
  const values = instance?.values
  useEffect(() => {
    if (!values) return
    const ask: Ask = {}
    if (typeof values.topic === 'string' && values.topic !== '') ask.topic = values.topic
    if (typeof values.speed === 'number') ask.speed = values.speed
    if (typeof values.playing === 'boolean') ask.playing = values.playing
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
      // What could not be done is said on screen. A request that half worked and reported success would be worse
      // than one that failed outright, because nothing would disagree with it.
      setDoing(got.refused.length > 0 || got.done.length > 0 ? { done: got.done, refused: got.refused } : null)
      if (showing !== 'studio') setShowing('studio')
    })()
    return () => {
      alive = false
    }
    // `showing` is deliberately out: switching tabs must not re-run somebody's request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values])

  return (
    <LabShell
      title="Physics Studio"
      summary="245 topics across 15 sections, each a simulation you can run, pause, step and change while it goes."
      refused={null}
      broke={null}
      busy={false}
      ready
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'studio', label: 'The studio' },
        { id: 'formulas', label: 'Formula vault' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={null}
    >
      {/* The wrapper is the query container for the studio's own three-column layouts, and `.jx` is the scope its
          styles live under. Both belong outside the page rather than inside it, which is why they are here. */}
      {showing === 'studio' && doing !== null && (doing.done.length > 0 || doing.refused.length > 0) && (
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

      {showing === 'studio' && (
        <div className="jx-wrap">
          <div className="jx p8-studio">
            <StudioPage />
          </div>
        </div>
      )}

      {showing === 'formulas' && <FormulaVault />}
    </LabShell>
  )
}

/**
 * The Formula Vault, inside the Studio.
 *
 * Pick a formula, pick the quantity you want, fill in the rest, and it rearranges and answers — with the working
 * written out so the answer can be checked rather than trusted. Where the vault has no rearrangement for what was
 * asked, the quantity cannot be picked at all, and saying why beats producing a number.
 */
function FormulaVault(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Formula | null>(null)
  const [want, setWant] = useState<string>('')
  const [given, setGiven] = useState<Record<string, string>>({})

  const found = searchFormulas(query)
  const groups = formulaSections()

  const choose = (formula: Formula): void => {
    setPicked(formula)
    // Default to the first quantity the vault can actually rearrange for, not just the first one written down.
    const first = formula.quantities.find((one) => formula.solve[one.symbol] !== undefined)
    setWant(first?.symbol ?? '')
    setGiven({})
  }

  // Only values actually typed are passed on. A blank field must read as missing, never as zero — zero is a
  // perfectly good physical value and treating an empty box as one would answer a question nobody asked.
  const answer = (() => {
    if (!picked || want === '') return null
    const numbers: Record<string, number> = {}
    for (const [key, text] of Object.entries(given)) {
      const value = Number(text)
      if (text.trim() !== '' && Number.isFinite(value)) numbers[key] = value
    }
    return solve(picked.id, want, numbers)
  })()

  return (
    <>
      <div className="p8-vault-head">
        <h4 className="p4-heading">
          {FORMULA_COUNTS.formulas} formulas · {FORMULA_COUNTS.rearrangements} rearrangements
        </h4>
        <input
          className="p8-vault-search"
          type="search"
          value={query}
          placeholder="Search by name, symbol or unit"
          aria-label="Search the formula vault"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {query.trim() !== '' && (
        <p className="p4-says">
          {found.length === 0
            ? 'Nothing in the vault matches that.'
            : `${found.length} of ${FORMULA_COUNTS.formulas} match.`}
        </p>
      )}

      <div className="p8-vault">
        <div className="p8-vault-list">
          {groups.map((group) => {
            const mine = group.formulas.filter((one) => found.includes(one))
            if (mine.length === 0) return null
            return (
              <div key={group.section.id} className="p8-section">
                <div className="p8-section-head">
                  <strong>{group.section.name}</strong>
                  <span className="p2-faint">{group.section.about}</span>
                </div>
                {mine.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    className={`p8-formula${picked?.id === one.id ? ' here' : ''}`}
                    aria-pressed={picked?.id === one.id}
                    onClick={() => choose(one)}
                  >
                    <strong>{one.name}</strong>
                    <code>{one.written}</code>
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        <div className="p8-vault-detail">
          {picked === null ? (
            <p className="p4-says">Pick a formula to work something out with it.</p>
          ) : (
            <>
              <h4 className="p4-heading">{picked.name}</h4>
              <code className="p8-written">{picked.written}</code>
              <p className="p8-about">{picked.about}</p>

              <h5 className="p8-sub">Work out</h5>
              <div className="p8-wants">
                {picked.quantities.map((one) => {
                  const can = picked.solve[one.symbol] !== undefined
                  return (
                    <button
                      key={one.symbol}
                      type="button"
                      className={`p8-want${want === one.symbol ? ' here' : ''}${can ? '' : ' cannot'}`}
                      aria-pressed={want === one.symbol}
                      disabled={!can}
                      title={
                        can
                          ? `Work out ${one.name}`
                          : `This vault has no rearrangement for ${one.name}, so it will not guess at one`
                      }
                      onClick={() => setWant(one.symbol)}
                    >
                      {one.symbol}
                    </button>
                  )
                })}
              </div>

              <h5 className="p8-sub">From</h5>
              <div className="p8-fields">
                {picked.quantities
                  .filter((one) => one.symbol !== want)
                  .map((one) => (
                    <label key={one.symbol} className="p8-field">
                      <span>
                        {one.name} <code>{one.symbol}</code>
                        {one.unit ? <small className="p2-faint"> {one.unit}</small> : null}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={given[one.symbol] ?? ''}
                        onChange={(event) => setGiven((was) => ({ ...was, [one.symbol]: event.target.value }))}
                      />
                    </label>
                  ))}
              </div>

              {answer !== null &&
                (isSimulationError(answer) ? (
                  <div className="p8-refused" role="status">
                    <strong>{answer.message}</strong>
                    <span>{answer.fix}</span>
                  </div>
                ) : (
                  <div className="p8-answer" role="status">
                    <div className="p8-answer-value">
                      {answer.symbol} = {formatAnswer(answer.value)}
                      {answer.unit ? <small> {answer.unit}</small> : null}
                    </div>
                    <p className="p8-working">{answer.working}</p>
                    {answer.warning ? <p className="p8-warning">{answer.warning}</p> : null}
                  </div>
                ))}

              <h5 className="p8-sub">When this holds</h5>
              <ul className="p8-limits">
                {picked.holds.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>

              {picked.near && picked.near.length > 0 && (
                <>
                  <h5 className="p8-sub">See also</h5>
                  <div className="p8-near">
                    {picked.near.map((id) => {
                      const other = searchFormulas('').find((one) => one.id === id)
                      if (!other) return null
                      return (
                        <button key={id} type="button" className="p8-formula" onClick={() => choose(other)}>
                          <strong>{other.name}</strong>
                          <code>{other.written}</code>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** Big and small numbers written the way a physicist writes them, without claiming more figures than there are. */
function formatAnswer(value: number): string {
  const size = Math.abs(value)
  if (value === 0) return '0'
  if (size >= 1e6 || size < 1e-4) return value.toExponential(6)
  return Number(value.toPrecision(8)).toString()
}
