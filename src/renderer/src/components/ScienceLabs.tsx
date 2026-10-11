import { useState } from 'react'
import { Activity, Book, CheckSquare, Compass, Hash, TrendingUp } from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import { Choice, Field, Notes, Problem, Stats, readNumbers, useEngine } from './PageTools'

/**
 * The Pages backed by the six scientific engines: signals, fitting, precision, constants, frames and constraints.
 *
 * Fourth file of the same kind, and every rule from the first three still applies -- **nothing on this screen computes
 * anything**. Every number, every refusal and every caveat came back from the main process through `pagesCompute`, the
 * one capability-checked route to an engine. A screen that worked out an answer locally would be a second
 * implementation nobody tests.
 *
 * ## What these screens are mostly showing
 *
 * Each of these engines spends much of its output saying what is *not* established -- that a frequency above Nyquist
 * cannot be recovered, that a curve was not evaluated outside its data, that a constant is exact rather than measured,
 * that an azimuth does not exist on the axis, that a rule could not be checked. Those are rendered as prominently as
 * the answers, because in every case they are the difference between a number and a number somebody can rely on.
 */

type Props = {
  pageId: string
  onNotify(m: string, k?: NoticeKind): void
  /**
   * Starting values, when the laboratory was opened by Orion with a configuration.
   *
   * Text, because every input here is a field somebody types in and keeps as text — which is correct, and which is
   * what makes wiring one of these cost a default rather than a rewrite.
   */
  initial?: Readonly<Record<string, string>>
}

const round = (value: number, digits = 6): string =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '—'

// ---------------------------------------------------------------- Signal Lab

const WINDOWS = [
  { value: 'hann', label: 'Hann — the usual first choice' },
  { value: 'rectangular', label: 'Rectangular — none' },
  { value: 'hamming', label: 'Hamming' },
  { value: 'blackman', label: 'Blackman — for a small tone near a large one' },
  { value: 'blackman-harris', label: 'Blackman–Harris' },
  { value: 'bartlett', label: 'Bartlett' },
  { value: 'welch', label: 'Welch' },
  { value: 'flat-top', label: 'Flat-top — for measuring amplitude' }
]

export function SignalLabPage({ pageId, initial }: Props): React.JSX.Element {
  const [values, setValues] = useState(
    Array.from({ length: 128 }, (_, i) => Number((Math.sin((2 * Math.PI * 8 * i) / 128) + 0.4 * Math.sin((2 * Math.PI * 21 * i) / 128)).toFixed(4))).join(', ')
  )
  const [rate, setRate] = useState(() => initial?.rate ?? '128')
  const [window, setWindow] = useState(() => initial?.window ?? 'hann')
  const [removeMean, setRemoveMean] = useState(true)

  const samples = readNumbers(values)
  const rateHz = Number(rate)

  const peaks = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (samples.length < 4 || !(rateHz > 0) ? null : call('signal.peaks', { values: samples, rateHz, window, removeMean })),
    [values, rate, window, removeMean]
  )
  const facts = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (samples.length < 2 ? null : call('signal.facts', { values: samples })),
    [values]
  )
  const repeat = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (samples.length < 6 ? null : call('signal.autocorrelation', { values: samples })),
    [values]
  )

  const found = (peaks.result?.peaks ?? []) as {
    index: number
    frequencyHz: number
    binFrequencyHz: number
    interpolated: boolean
    amplitude: number
    aboveMedian: number
  }[]
  const sampling = peaks.result?.sampling as { nyquistHz: number; resolutionHz: number; durationSeconds: number } | undefined
  const signal = facts.result as
    | { count: number; mean: number; rmsAboutMean: number; crestFactor: number | null; peakToPeak: number; why: string }
    | null
  const repeatAt = repeat.result?.repeatAt as { lag: number; correlation: number } | null | undefined

  return (
    <section className="page-pane" aria-label="Signal Lab">
      <div className="page-row">
        <Activity size={16} className="page-arrow" aria-hidden />
        <Field label="Samples, evenly spaced in time" value={values} onChange={setValues} wide rows={4} placeholder="0, 0.38, 0.71, …" />
      </div>
      <div className="page-row">
        <Field label="Sampling rate (samples per second)" value={rate} onChange={setRate} placeholder="128" />
        <Choice label="Window" value={window} options={WINDOWS} onChange={setWindow} />
        <label className="page-field">
          <span>Remove the mean first</span>
          <input type="checkbox" checked={removeMean} onChange={(e) => setRemoveMean(e.target.checked)} />
        </label>
      </div>

      <Problem text={peaks.problem} />

      {sampling !== undefined && (
        <Stats
          items={[
            ['Samples', String(samples.length)],
            ['Record length', `${round(sampling.durationSeconds, 4)} s`],
            ['Highest readable', `${round(sampling.nyquistHz, 6)} Hz`],
            ['Bin spacing', `${round(sampling.resolutionHz, 4)} Hz`]
          ]}
        />
      )}

      {peaks.result !== null && (
        <div className="page-result">
          <h4>Frequencies found</h4>
          {found.length === 0 ? (
            <p className="page-note">
              No peak stands far enough above the rest of the spectrum to be worth reporting. That is an answer: this
              record has no tone in it that the noise does not explain.
            </p>
          ) : (
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th scope="col">Frequency</th>
                    <th scope="col">Amplitude</th>
                    <th scope="col">Above the median bin</th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((one) => (
                    <tr key={one.index}>
                      <td>
                        {round(one.frequencyHz, 6)} Hz
                        {/* Only worth saying when the estimate actually moved off the bin. A tone that lands on a
                            bin centre is interpolated too, and reporting that as "estimated between bins" would be
                            describing the method rather than the answer. */}
                        {one.interpolated && Math.abs(one.frequencyHz - one.binFrequencyHz) > 1e-6 && (
                          <em title={`The bin itself is centred on ${round(one.binFrequencyHz, 6)} Hz. A tone rarely lands exactly on a bin, so this was estimated by fitting a curve through the bin and its neighbours.`}>
                            {' '}
                            estimated between bins
                          </em>
                        )}
                      </td>
                      <td>{round(one.amplitude, 5)}</td>
                      <td>{Number.isFinite(one.aboveMedian) ? `${round(one.aboveMedian, 3)}×` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Notes notes={(peaks.result.caveats ?? []) as string[]} label="What this spectrum does and does not say" />
        </div>
      )}

      {signal !== null && (
        <div className="page-result">
          <h4>The series itself</h4>
          <Stats
            items={[
              ['Mean', round(signal.mean, 6)],
              ['Variation (RMS)', round(signal.rmsAboutMean, 6)],
              ['Peak to peak', round(signal.peakToPeak, 6)],
              ['Crest factor', signal.crestFactor === null ? 'none' : round(signal.crestFactor, 4)]
            ]}
          />
          <p className="page-note">{signal.why}</p>
        </div>
      )}

      {repeat.result !== null && (
        <div className="page-result">
          <h4>What repeats</h4>
          {repeatAt === null || repeatAt === undefined ? (
            <p className="page-note">Nothing in this series peaks positively when shifted against itself, so no period is suggested.</p>
          ) : (
            <p>
              The series resembles itself shifted by <strong>{repeatAt.lag}</strong> samples, at {round(repeatAt.correlation, 4)}.
              {rateHz > 0 && ` That is ${round(repeatAt.lag / rateHz, 5)} s, or about ${round(rateHz / repeatAt.lag, 5)} Hz.`}
            </p>
          )}
          <Notes notes={(repeat.result.caveats ?? []) as string[]} label="What a repeat does and does not establish" />
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Curve Fitter

const FAMILIES = [
  { value: 'linear', label: 'Straight line — y = a + b·x' },
  { value: 'polynomial', label: 'Polynomial — y = a₀ + a₁x + …' },
  { value: 'exponential', label: 'Exponential — y = a·e^(b·x)' },
  { value: 'power', label: 'Power law — y = a·x^b' },
  { value: 'logarithmic', label: 'Logarithmic — y = a + b·ln(x)' },
  { value: 'reciprocal', label: 'Reciprocal — y = a + b/x' },
  { value: 'logistic', label: 'Logistic — needs a ceiling' }
]

const INTERPOLATIONS = [
  { value: 'linear', label: 'Straight lines between points' },
  { value: 'monotone-cubic', label: 'Monotone cubic — smooth, cannot overshoot' },
  { value: 'cubic-spline', label: 'Cubic spline — smooth, can overshoot' },
  { value: 'nearest', label: 'Nearest value — a staircase' },
  { value: 'polynomial', label: 'One polynomial through every point' }
]

export function CurveFitterPage({ pageId, initial }: Props): React.JSX.Element {
  const [xs, setXs] = useState(() => initial?.xs ?? '1, 2, 3, 4, 5, 6, 7, 8')
  const [ys, setYs] = useState(() => initial?.ys ?? '2.1, 4.4, 9.1, 15.8, 25.2, 36.1, 49.4, 63.8')
  const [family, setFamily] = useState(() => initial?.family ?? 'polynomial')
  const [degree, setDegree] = useState(() => initial?.degree ?? '2')
  const [ceiling, setCeiling] = useState('100')
  const [kind, setKind] = useState('monotone-cubic')

  const x = readNumbers(xs)
  const y = readNumbers(ys)
  const enough = x.length >= 2 && x.length === y.length

  const fitted = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      !enough
        ? null
        : call('fit.curve', { x, y, family, degree: Number(degree), ceiling: Number(ceiling) }),
    [xs, ys, family, degree, ceiling]
  )
  const residuals = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      !enough
        ? null
        : call('fit.residuals', { x, y, family, degree: Number(degree), ceiling: Number(ceiling) }),
    [xs, ys, family, degree, ceiling]
  )
  const curve = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (x.length < 3 || x.length !== y.length ? null : call('interpolate.build', { x, y, kind })),
    [xs, ys, kind]
  )

  const findings = (residuals.result?.findings ?? []) as { kind: string; severity: string; detail: string }[]
  const overshoot = curve.result?.overshoot as number | undefined

  return (
    <section className="page-pane" aria-label="Curve Fitter">
      <div className="page-row">
        <TrendingUp size={16} className="page-arrow" aria-hidden />
        <Field label="x values" value={xs} onChange={setXs} wide rows={2} />
      </div>
      <div className="page-row">
        <Field label="y values" value={ys} onChange={setYs} wide rows={2} />
      </div>
      {x.length !== y.length && x.length > 0 && y.length > 0 && (
        <p className="page-problem" role="alert">
          There are {x.length} x values and {y.length} y values. A point needs both.
        </p>
      )}

      <div className="page-row">
        <Choice label="Shape to fit" value={family} options={FAMILIES} onChange={setFamily} />
        {family === 'polynomial' && <Field label="Degree" value={degree} onChange={setDegree} />}
        {family === 'logistic' && <Field label="Ceiling it levels off at" value={ceiling} onChange={setCeiling} />}
      </div>

      <Problem text={fitted.problem} />

      {fitted.result !== null && (
        <div className="page-result">
          <h4>Fitted</h4>
          <p className="page-answer">{String(fitted.result.equation)}</p>
          <Stats
            items={[
              ['R²', round(fitted.result.rSquared as number, 5)],
              ['Adjusted R²', round(fitted.result.adjustedRSquared as number, 5)],
              ['RMS error', round(fitted.result.rootMeanSquaredError as number, 5)],
              ['Points', String(fitted.result.count)]
            ]}
          />
          {fitted.result.viaTransform === true && (
            <p className="page-note">
              This was fitted by taking a logarithm and fitting a straight line to it, so it minimised proportional
              error rather than absolute error. The R² above is on the original scale of y, not the log scale — the
              log-scale figure would be higher and would describe the transform rather than the data.
            </p>
          )}
          <Notes notes={(fitted.result.caveats ?? []) as string[]} label="What this fit assumes" />
        </div>
      )}

      {residuals.result !== null && (
        <div className="page-result">
          <h4>Do the residuals object?</h4>
          {findings.length === 0 ? (
            <p>{String(residuals.result.why)}</p>
          ) : (
            <ul>
              {findings.map((one) => (
                <li key={one.kind + one.detail.slice(0, 20)}>
                  <strong>{one.severity === 'concern' ? 'Concern' : 'Note'}:</strong> {one.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="page-row">
        <Choice label="Or draw a curve through every point" value={kind} options={INTERPOLATIONS} onChange={setKind} />
      </div>
      <Problem text={curve.problem} />
      {curve.result !== null && (
        <div className="page-result">
          <h4>Through the points</h4>
          <p>{String(curve.result.describe)}</p>
          {overshoot !== undefined && overshoot > 0 && (
            <p className="page-note">
              The curve goes {round(overshoot, 4)} outside the range of the measurements. Whether that is wrong depends
              on the data: a real peak falling between two samples should be exceeded, and a step should not be.
            </p>
          )}
          <Notes notes={(curve.result.caveats ?? []) as string[]} label="What this curve does and does not say" />
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Significant Figures

export function SignificantFiguresPage({ pageId }: Props): React.JSX.Element {
  const [written, setWritten] = useState('1200')
  const [a, setA] = useState('12.30')
  const [b, setB] = useState('1.2')
  const [operation, setOperation] = useState('add')
  const [value, setValue] = useState('1234.5678')
  const [figures, setFigures] = useState('3')
  const [notation, setNotation] = useState('plain')

  const read = useEngine<Record<string, unknown>>(pageId, async (call) => call('precision.read', { text: written }), [written])
  const combined = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('precision.combine', { a, b, operation }),
    [a, b, operation]
  )
  const shown = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('precision.write', { value: Number(value), figures: Number(figures), notation }),
    [value, figures, notation]
  )
  const stored = useEngine<Record<string, unknown>>(pageId, async (call) => call('precision.represent', { value: Number(value) }), [value])

  return (
    <section className="page-pane" aria-label="Significant Figures">
      <div className="page-row">
        <Hash size={16} className="page-arrow" aria-hidden />
        <Field label="A number as somebody wrote it" value={written} onChange={setWritten} placeholder="1200" />
      </div>
      <Problem text={read.problem} />
      {read.result !== null && (
        <div className="page-result">
          <h4>How many digits does that claim?</h4>
          <p className="page-answer">
            {read.result.ambiguous === true ? 'It does not say' : `${String(read.result.significantFigures)} significant figures`}
          </p>
          <p className={read.result.ambiguous === true ? 'page-note' : undefined}>{String(read.result.why)}</p>
        </div>
      )}

      <div className="page-row">
        <Field label="First number, as written" value={a} onChange={setA} />
        <Choice
          label="Operation"
          value={operation}
          options={[
            { value: 'add', label: 'add' },
            { value: 'subtract', label: 'subtract' },
            { value: 'multiply', label: 'multiply' },
            { value: 'divide', label: 'divide' },
            { value: 'power', label: 'to the power of' }
          ]}
          onChange={setOperation}
        />
        <Field label="Second number, as written" value={b} onChange={setB} />
      </div>
      <Problem text={combined.problem} />
      {combined.result !== null && (
        <div className="page-result">
          <h4>The answer, to the precision it earned</h4>
          <p className="page-answer">{round(combined.result.rounded as number, 12)}</p>
          <p>
            Unrounded it is {round(combined.result.value as number, 12)}. {String(combined.result.why)}
          </p>
          <Notes notes={(combined.result.caveats ?? []) as string[]} label="Worth knowing" />
        </div>
      )}

      <div className="page-row">
        <Field label="Write this number" value={value} onChange={setValue} />
        <Field label="to this many figures" value={figures} onChange={setFigures} />
        <Choice
          label="in"
          value={notation}
          options={[
            { value: 'plain', label: 'plain notation' },
            { value: 'scientific', label: 'scientific notation' },
            { value: 'engineering', label: 'engineering notation' }
          ]}
          onChange={setNotation}
        />
      </div>
      <Problem text={shown.problem} />
      {shown.result !== null && (
        <div className="page-result">
          <h4>Written down</h4>
          <p className="page-answer">
            {String(shown.result.text)}
            {shown.result.prefix !== null && shown.result.prefix !== undefined && (
              <em> ({(shown.result.prefix as { name: string }).name})</em>
            )}
          </p>
          <p className="page-note">{String(shown.result.why)}</p>
        </div>
      )}
      {stored.result !== null && stored.result.exactInBinary === false && (
        <p className="page-note">{String(stored.result.why)}</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Constants Library

export function ConstantsLibraryPage({ pageId }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState('speed-of-light')
  const [measurement, setMeasurement] = useState('')
  const [uncertainty, setUncertainty] = useState('')

  const found = useEngine<Record<string, unknown>>(pageId, async (call) => call('constants.search', { text: query }), [query])
  const detail = useEngine<Record<string, unknown>>(pageId, async (call) => call('constants.get', { id: chosen }), [chosen])
  const against = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      measurement.trim() === '' || !Number.isFinite(Number(measurement))
        ? null
        : call('constants.compare', { id: chosen, value: Number(measurement), uncertainty: Number(uncertainty) || 0 }),
    [chosen, measurement, uncertainty]
  )

  const list = (found.result?.constants ?? []) as { id: string; symbol: string; name: string; kind: string }[]
  const one = detail.result?.constant as
    | { id: string; symbol: string; name: string; kind: string; value: number; unit: string; uncertainty: number; source: string; publishedText: string; describe: string; definedBy: string | null }
    | undefined

  return (
    <section className="page-pane" aria-label="Constants Library">
      <div className="page-row">
        <Book size={16} className="page-arrow" aria-hidden />
        <Field label="Search" value={query} onChange={setQuery} wide placeholder="planck, gravitational, pi…" />
      </div>
      <Problem text={found.problem} />
      <div className="page-chips">
        {list.slice(0, 18).map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="page-chip"
            aria-pressed={entry.id === chosen}
            onClick={() => setChosen(entry.id)}
          >
            {entry.symbol} — {entry.name}
          </button>
        ))}
      </div>
      {list.length === 0 && query.trim() !== '' && <p className="page-note">Nothing here matches that.</p>}

      <Problem text={detail.problem} />
      {one !== undefined && (
        <div className="page-result">
          <h4>
            {one.symbol} — {one.name}
          </h4>
          <p className="page-answer">
            {one.value} {one.unit}
          </p>
          <p>{one.describe}</p>
          <Stats
            items={[
              ['Kind', one.kind === 'derived-exact' ? 'exactly derived' : one.kind],
              ['Uncertainty', one.uncertainty === 0 ? 'none' : String(one.uncertainty)],
              ['As published', one.publishedText],
              ['Source', one.source]
            ]}
          />
          {one.definedBy !== null && <p className="page-note">Defined as {one.definedBy}.</p>}
          <Notes notes={(detail.result?.caveats ?? []) as string[]} label="What using this commits a calculation to" />
        </div>
      )}

      <div className="page-row">
        <Field label="Compare a measurement of it" value={measurement} onChange={setMeasurement} placeholder="6.6740e-11" />
        <Field label="± its own uncertainty" value={uncertainty} onChange={setUncertainty} placeholder="2e-15" />
      </div>
      <Problem text={against.problem} />
      {against.result !== null && (
        <div className="page-result">
          <h4>{against.result.agree === true ? 'Consistent' : 'Not consistent'}</h4>
          <p>{String(against.result.why)}</p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Coordinate Lab

export function CoordinateLabPage({ pageId, initial }: Props): React.JSX.Element {
  const [point, setPoint] = useState(() => initial?.point ?? '1, 1, 1')
  const [convention, setConvention] = useState(() => initial?.convention ?? 'physics')
  const [unit, setUnit] = useState(() => initial?.unit ?? 'degrees')
  const [axis, setAxis] = useState('0, 0, 1')
  const [angle, setAngle] = useState('90')

  const xyz = readNumbers(point)
  const axisParts = readNumbers(axis)
  const vector = { x: xyz[0] ?? 0, y: xyz[1] ?? 0, z: xyz[2] ?? 0 }
  const complete = xyz.length === 3
  const axisComplete = axisParts.length === 3

  const spherical = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (!complete ? null : call('frames.to-spherical', { point: vector, convention, unit })),
    [point, convention, unit]
  )
  const cylindrical = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (!complete ? null : call('frames.to-cylindrical', { point: vector, unit })),
    [point, unit]
  )
  const turned = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      !complete || !axisComplete || !Number.isFinite(Number(angle))
        ? null
        : call('frames.rotate', {
            axis: { x: axisParts[0] ?? 0, y: axisParts[1] ?? 0, z: axisParts[2] ?? 1 },
            angle: Number(angle),
            unit,
            point: vector
          }),
    [point, axis, angle, unit]
  )

  return (
    <section className="page-pane" aria-label="Coordinate Lab">
      <div className="page-row">
        <Compass size={16} className="page-arrow" aria-hidden />
        <Field label="A point, as x, y, z" value={point} onChange={setPoint} placeholder="1, 1, 1" />
        <Choice
          label="Angles in"
          value={unit}
          options={[
            { value: 'degrees', label: 'degrees' },
            { value: 'radians', label: 'radians' }
          ]}
          onChange={setUnit}
        />
      </div>
      {!complete && point.trim() !== '' && <p className="page-problem" role="alert">A point needs three numbers.</p>}

      <div className="page-row">
        <Choice
          label="Spherical convention"
          value={convention}
          options={[
            { value: 'physics', label: 'Physics / ISO — θ is the polar angle' },
            { value: 'mathematics', label: 'Mathematics — θ is the azimuth' }
          ]}
          onChange={setConvention}
        />
      </div>
      <Problem text={spherical.problem} />
      {spherical.result !== null && (
        <div className="page-result">
          <h4>Spherical</h4>
          <Stats
            items={[
              ['Radius', round(spherical.result.radius as number, 6)],
              [`Polar (${String(spherical.result.polarSymbol)})`, round(spherical.result.polar as number, 6)],
              [
                `Azimuth (${String(spherical.result.azimuthSymbol)})`,
                spherical.result.azimuthDefined === false ? 'no value here' : round(spherical.result.azimuth as number, 6)
              ]
            ]}
          />
          <p className={spherical.result.azimuthDefined === false ? 'page-note' : undefined}>{String(spherical.result.why)}</p>
        </div>
      )}

      {cylindrical.result !== null && (
        <div className="page-result">
          <h4>Cylindrical</h4>
          <Stats
            items={[
              ['Radius from the z axis', round(cylindrical.result.radius as number, 6)],
              [
                'Azimuth',
                cylindrical.result.azimuthDefined === false ? 'no value here' : round(cylindrical.result.azimuth as number, 6)
              ],
              ['Height', round(cylindrical.result.height as number, 6)]
            ]}
          />
          <p className={cylindrical.result.azimuthDefined === false ? 'page-note' : undefined}>{String(cylindrical.result.why)}</p>
        </div>
      )}

      <div className="page-row">
        <Field label="Turn it about this axis" value={axis} onChange={setAxis} placeholder="0, 0, 1" />
        <Field label="by this angle" value={angle} onChange={setAngle} placeholder="90" />
      </div>
      <Problem text={turned.problem} />
      {turned.result !== null && (
        <div className="page-result">
          <h4>Rotated</h4>
          <p className="page-answer">
            {round(turned.result.x as number, 6)}, {round(turned.result.y as number, 6)}, {round(turned.result.z as number, 6)}
          </p>
          <p className="page-note">
            An active rotation by the right-hand rule: the point moves and the frame stays still. Rotating the frame
            instead would turn it the other way.
          </p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Constraint Checker

const EXAMPLE_CONSTRAINTS = `[
  { "kind": "range", "id": "width", "label": "Fits the opening", "variable": "w", "maximum": { "value": 1, "unit": "m" } },
  { "kind": "sum", "id": "budget", "label": "Parts add up", "variables": ["a", "b"], "total": 100 },
  { "kind": "comparison", "id": "stress", "label": "Under the limit", "left": "force / area", "comparison": "less", "right": "limit" }
]`

const EXAMPLE_VALUES = `{
  "w": { "value": 80, "unit": "cm" },
  "a": 60,
  "b": 40,
  "force": 100,
  "area": 10,
  "limit": 20
}`

export function ConstraintCheckerPage({ pageId }: Props): React.JSX.Element {
  const [constraintsText, setConstraintsText] = useState(EXAMPLE_CONSTRAINTS)
  const [valuesText, setValuesText] = useState(EXAMPLE_VALUES)

  const parse = (text: string, fallback: unknown): { value: unknown; problem: string } => {
    if (text.trim() === '') return { value: fallback, problem: '' }
    try {
      return { value: JSON.parse(text) as unknown, problem: '' }
    } catch (err) {
      return { value: fallback, problem: err instanceof Error ? `That is not valid JSON: ${err.message}` : 'That is not valid JSON.' }
    }
  }
  const constraints = parse(constraintsText, [])
  const values = parse(valuesText, {})

  const report = useEngine<Record<string, unknown>>(
    pageId,
    async (call) =>
      constraints.problem !== '' || values.problem !== ''
        ? null
        : call('constraints.check', { constraints: constraints.value, values: values.value }),
    [constraintsText, valuesText]
  )
  const possible = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (constraints.problem !== '' ? null : call('constraints.feasible', { constraints: constraints.value })),
    [constraintsText]
  )

  const checks = (report.result?.checks ?? []) as {
    constraintId: string
    label: string
    status: string
    binding: boolean
    why: string
  }[]
  const ranked = (report.result?.ranked ?? []) as string[]
  const ordered = ranked.map((id) => checks.find((one) => one.constraintId === id)).filter((one): one is (typeof checks)[number] => one !== undefined)
  const conflicts = (possible.result?.conflicts ?? []) as { detail: string }[]

  return (
    <section className="page-pane" aria-label="Constraint Checker">
      <div className="page-row">
        <CheckSquare size={16} className="page-arrow" aria-hidden />
        <Field label="The rules" value={constraintsText} onChange={setConstraintsText} wide rows={8} />
      </div>
      <Problem text={constraints.problem} />
      <div className="page-row">
        <Field label="The values" value={valuesText} onChange={setValuesText} wide rows={6} />
      </div>
      <Problem text={values.problem} />
      <Problem text={report.problem} />

      {possible.result !== null && possible.result.possible === false && (
        <div className="page-result">
          <h4>These rules cannot all hold</h4>
          <ul>
            {conflicts.map((one) => (
              <li key={one.detail.slice(0, 30)}>{one.detail}</li>
            ))}
          </ul>
          <p className="page-note">{String(possible.result.why)}</p>
        </div>
      )}

      {report.result !== null && (
        <div className="page-result">
          <h4>{report.result.allSatisfied === true ? 'Everything checked, everything holds' : 'Not everything holds'}</h4>
          <Stats
            items={[
              ['Satisfied', String(report.result.satisfied)],
              ['Violated', String(report.result.violated)],
              ['Not checkable', String(report.result.unevaluable)],
              ['Malformed', String(report.result.malformed)]
            ]}
          />
          <p className={report.result.allSatisfied === true ? undefined : 'page-note'}>{String(report.result.why)}</p>
          <ul>
            {ordered.map((one) => (
              <li key={one.constraintId}>
                <strong>{one.label}</strong>
                {one.binding && <em> — at its limit</em>}: {one.why}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
