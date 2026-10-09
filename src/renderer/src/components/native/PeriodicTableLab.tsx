import { useEffect, useMemo, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import './phase6.css'

/**
 * The Periodic Table.
 *
 * ## It is the real table, not a grid of 118 boxes
 *
 * Every element sits where the table puts it — its group is its column and its period is its row — and the
 * lanthanides and actinides are drawn as their own two rows underneath, which is how every printed table handles the
 * f-block and the only layout that does not stretch the grid to thirty-two columns. The placement comes from the
 * engine, so the picture and the data cannot disagree.
 *
 * ## What a tile will not claim
 *
 * Melting points, densities and discovery dates are the usual filler on a periodic table and none of them is here,
 * because each is a measurement with conditions attached that this would have to state and cannot. What is here is
 * what IUPAC publishes and what can be defended: the standard atomic weight with its uncertainty, the group and
 * period, the configuration, the oxidation states, and the note that says when a weight is conventional rather than
 * measured — which is true of fourteen elements and is the single most misunderstood thing about the table.
 */

interface Tile {
  number: number
  symbol: string
  name: string
  atomicWeight: number
  weightUncertainty: number | null
  group: number | null
  period: number
  category: string
  electronegativity: number | null
  configuration: string
  valenceElectrons: number | null
  oxidationStates: readonly number[]
  note: string
  column: number
  row: number
}

/** One colour per category, so the legend and the tiles are the same decision made once. */
const TONE: Readonly<Record<string, string>> = Object.freeze({
  'alkali metal': '#f0a33a',
  'alkaline earth metal': '#e8c547',
  'transition metal': '#56b4e9',
  'post-transition metal': '#8fa6ff',
  metalloid: '#37d67a',
  'reactive nonmetal': '#c08bf0',
  'noble gas': '#5cc8e0',
  lanthanide: '#e05c5c',
  actinide: '#e0845c',
  unknown: '#7a8597'
})

export default function PeriodicTableLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [picked, setPicked] = useState<number | null>(null)

  const search = String(values.search ?? '')
  const category = String(values.category ?? 'all')

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'table', search, category: category === 'all' ? null : category })
  }, [engine.ready, search, category])

  useEffect(() => {
    if (!engine.ready || picked === null) return
    engine.ask({ kind: 'element', key: picked })
  }, [engine.ready, picked])

  const held = engine.table.value
  const elements = (held?.elements ?? []) as readonly Tile[]
  const categories = (held?.categories ?? []) as readonly string[]
  const detail = (engine.element.value?.element ?? null) as Tile | null
  const flame = (engine.element.value?.flame ?? null) as { colour: string; wavelength: number | null; says: string } | null

  /* The whole table is always drawn; a search dims what it does not match rather than moving anything.
     A table that reflows under a search is a table whose shape — the thing it exists to show — keeps changing. */
  const matched = useMemo(() => new Set(elements.map((one) => one.number)), [elements])
  const all = useMemo(() => {
    const out: Tile[] = [...elements]
    return out.sort((a, b) => a.number - b.number)
  }, [elements])

  return (
    <LabShell
      title="Periodic Table"
      summary={held ? `${String(held.shown)} of ${String(held.total)} elements` : undefined}
      refused={engine.table.refused}
      broke={engine.table.broke}
      busy={engine.table.busy}
      waitingFor="Laying the table out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      aside={
        <>
          {detail !== null && (
            <>
              <Facts
                title={`${detail.number} · ${detail.name}`}
                rows={[
                  ['Symbol', detail.symbol],
                  ['Atomic weight', detail.weightUncertainty === null ? `${detail.atomicWeight}` : `${detail.atomicWeight} ± ${detail.weightUncertainty}`],
                  ['Group', detail.group === null ? 'in the f-block, which has no group' : detail.group],
                  ['Period', detail.period],
                  ['Category', detail.category],
                  ['Electronegativity', detail.electronegativity === null ? 'not defined' : detail.electronegativity],
                  ['Configuration', detail.configuration],
                  ['Outer electrons', detail.valenceElectrons === null ? 'not a simple count in the d-block' : detail.valenceElectrons],
                  ['Oxidation states', detail.oxidationStates.length === 0 ? 'never measured' : detail.oxidationStates.join(', ')]
                ]}
                about={detail.note || undefined}
              />
              {flame !== null && (
                <Facts
                  title="In a flame"
                  rows={[
                    ['Colour', flame.colour],
                    ['Line', flame.wavelength === null ? 'no single dominant line' : `${flame.wavelength} nm`]
                  ]}
                  about={flame.says}
                />
              )}
            </>
          )}
          <Notes title="Where the weights come from" notes={held?.source ? [String(held.source)] : undefined} />
        </>
      }
    >
      <div className="p6-legend">
        {categories.map((one) => (
          <span key={one} className="p6-legend-item">
            <span className="p6-swatch" style={{ background: TONE[one] ?? TONE.unknown }} aria-hidden="true" />
            {one}
          </span>
        ))}
      </div>

      <div className="p6-table" role="grid" aria-label="The periodic table">
        {all.map((one) => {
          const dim = search.trim() !== '' && !matched.has(one.number)
          return (
            <button
              key={one.number}
              type="button"
              role="gridcell"
              className={`p6-cell${picked === one.number ? ' here' : ''}${dim ? ' dim' : ''}`}
              style={{ gridColumn: one.column, gridRow: one.row, borderColor: TONE[one.category] ?? TONE.unknown }}
              title={`${one.name} — ${one.category}`}
              aria-label={`${one.number} ${one.name}`}
              onClick={() => setPicked(one.number === picked ? null : one.number)}
            >
              <small>{one.number}</small>
              <strong>{one.symbol}</strong>
              <span className="p6-cell-mass">{one.atomicWeight.toPrecision(4)}</span>
            </button>
          )
        })}
      </div>

      <p className="p4-says">
        The two rows underneath are the lanthanides and the actinides, pulled out of periods 6 and 7 where they
        belong — drawn in place they would make the table thirty-two columns wide.
      </p>

      {detail !== null && (
        <>
          <h4 className="p4-heading">{detail.name}</h4>
          <p className="p4-says">
            {detail.note ||
              `${detail.name} sits in period ${detail.period}${detail.group === null ? ' in the f-block' : `, group ${detail.group}`}, and its configuration is ${detail.configuration}.`}
          </p>
        </>
      )}
    </LabShell>
  )
}
