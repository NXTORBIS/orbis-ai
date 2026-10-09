import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useChemistry } from './useChemistry'
import Plot from './Plot'
import './phase6.css'

/**
 * The Virtual Laboratory — an acid–base titration, and the flame tests.
 *
 * ## The curve is solved, not drawn from a picture
 *
 * Every point is the pH at that volume, worked out from what is left: excess acid before equivalence, the conjugate
 * base's hydrolysis at it, excess alkali after. That is why a weak acid's curve has a buffer plateau and ends above
 * pH 7, and a strong acid's does not and ends at exactly 7. A curve copied from a textbook would be the same shape
 * for both, which is the single thing a student is meant to notice is false.
 *
 * ## The indicator is chosen from where the equivalence point landed
 *
 * Not from a list of which indicator goes with which titration. The laboratory works out the equivalence pH and
 * then picks the indicator whose range straddles it — which is the actual reason phenolphthalein is used for a weak
 * acid and methyl orange for a weak base.
 */

interface Point {
  added: number
  ph: number
  region: 'start' | 'buffer' | 'equivalence' | 'excess'
}

interface Report {
  curve: readonly Point[]
  equivalenceAt: number
  equivalencePh: number
  halfEquivalencePh: number
  indicator: { name: string; range: string; suits: boolean; why: string }
  says: string
  notes: readonly string[]
}

interface Flame {
  symbol: string
  ion: string
  colour: string
  wavelength: number | null
  says: string
}

/** Roughly what each named flame colour looks like, for the swatch. The engine owns the words; this owns the paint. */
const PAINT: Readonly<Record<string, string>> = Object.freeze({
  crimson: '#d32f3f',
  'intense yellow': '#f5c518',
  lilac: '#b98cd6',
  'orange-red': '#e2622f',
  scarlet: '#e03131',
  'apple green': '#86c440',
  'blue-green': '#2fb8a8',
  'red-violet': '#c43f73',
  'blue-violet': '#6a5acd',
  'pale blue-white': '#c9d8e8'
})

export default function TitrationLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useChemistry()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('titration')

  const acidMolarity = Number(values.acidMolarity ?? 0.1)
  const acidVolume = Number(values.acidVolume ?? 25)
  const baseMolarity = Number(values.baseMolarity ?? 0.1)
  const weak = values.weak === true
  const ka = Number(values.ka ?? 0.000018)
  const flameFor = String(values.flameFor ?? 'Na')

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'titration', acidMolarity, acidVolume, baseMolarity, weak, ka, flameFor })
  }, [engine.ready, acidMolarity, acidVolume, baseMolarity, weak, ka, flameFor])

  const held = engine.titration.value
  const report = (held?.report ?? null) as Report | null
  const flame = (held?.flame ?? null) as Flame | null
  const flames = (held?.flames ?? []) as readonly Flame[]

  return (
    <LabShell
      title="Virtual Laboratory"
      summary={report?.says}
      refused={engine.titration.refused}
      broke={engine.titration.broke}
      busy={engine.titration.busy}
      waitingFor="Running the titration…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'titration', label: 'Titration' },
        { id: 'flame', label: 'Flame tests' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {report !== null && showing === 'titration' && (
            <>
              <Facts
                title="The run"
                rows={[
                  ['Acid', `${acidMolarity} mol/L, ${acidVolume} mL`],
                  ['Alkali', `${baseMolarity} mol/L`],
                  ['Equivalence at', `${report.equivalenceAt.toFixed(2)} mL`],
                  ['pH there', report.equivalencePh.toFixed(2)],
                  ...(weak ? ([['pH half way', `${report.halfEquivalencePh.toFixed(2)} — this is the pKa`]] as const) : [])
                ]}
              />
              <Facts
                title="Indicator"
                rows={[
                  ['Use', report.indicator.name],
                  ['Changes over', report.indicator.range]
                ]}
                about={report.indicator.why}
              />
            </>
          )}
          {showing === 'flame' && flame !== null && (
            <Facts
              title={`${flame.ion} in a flame`}
              rows={[
                ['Colour', flame.colour],
                ['Line', flame.wavelength === null ? 'no single dominant line' : `${flame.wavelength} nm`]
              ]}
              about={flame.says}
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing === 'titration' && report !== null && (
        <>
          <h4 className="p4-heading">The curve</h4>
          <Plot
            series={[{ id: 'ph', label: 'pH', points: report.curve.map((one) => ({ x: one.added, y: one.ph })) }]}
            xLabel="alkali added (mL)"
            yLabel="pH"
            height={220}
            zero={7}
            markers={[{ x: report.equivalenceAt, label: 'equivalence' }, ...(weak ? [{ x: report.equivalenceAt / 2, label: 'pKa' }] : [])]}
            about={
              weak
                ? 'The flat part before the equivalence point is the buffer region: adding alkali there barely moves the pH, because the acid and its conjugate base are both present.'
                : 'Almost all of the pH change happens within a fraction of a millilitre of the equivalence point, which is why the end point can be found to a drop.'
            }
          />

          <h4 className="p4-heading">Point by point</h4>
          <div className="p2-table-wrap p6-curve">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Added (mL)</th>
                  <th scope="col">pH</th>
                  <th scope="col">What is happening</th>
                </tr>
              </thead>
              <tbody>
                {report.curve
                  .filter((_, at) => at % 12 === 0 || report.curve[at].region === 'equivalence')
                  .map((one, at) => (
                    <tr key={`${one.added}-${at}`} className={one.region === 'equivalence' ? 'p6-here' : undefined}>
                      <td>{one.added.toFixed(2)}</td>
                      <td>{one.ph.toFixed(2)}</td>
                      <td className="p2-faint">
                        {one.region === 'start'
                          ? 'the acid on its own'
                          : one.region === 'buffer'
                            ? weak
                              ? 'buffer — acid and conjugate base together'
                              : 'acid still in excess'
                            : one.region === 'equivalence'
                              ? 'equivalence — the moles match exactly'
                              : 'alkali now in excess'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showing === 'flame' && (
        <>
          <h4 className="p4-heading">What each ion colours a flame</h4>
          <div className="p6-flames">
            {flames.map((one) => (
              <div key={one.symbol} className={`p6-flame${one.symbol === flameFor ? ' here' : ''}`}>
                <span className="p6-flame-paint" style={{ background: PAINT[one.colour] ?? '#888' }} aria-hidden="true" />
                <strong>{one.ion}</strong>
                <span className="p2-faint">{one.colour}</span>
                <small>{one.wavelength === null ? 'mixed lines' : `${one.wavelength} nm`}</small>
              </div>
            ))}
          </div>
          <p className="p4-says">
            The colour is light emitted as an excited electron falls back, so it is the element's own line spectrum
            seen by eye. Sodium at 589 nm is so strong that a trace of it masks everything else, which is why the
            wire is cleaned in acid first and potassium is viewed through cobalt-blue glass.
          </p>
        </>
      )}
    </LabShell>
  )
}
