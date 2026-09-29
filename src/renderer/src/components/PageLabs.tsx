import { useMemo, useState } from 'react'
import { Download, FileText, GitBranch, Grid3x3, Hash, Layers, MessageCircle, Shapes, Sigma, Sliders, Target, Triangle, Workflow } from 'lucide-react'
import type { NoticeKind } from '../App'
import {
  ConstantsLibraryPage,
  ConstraintCheckerPage,
  CoordinateLabPage,
  CurveFitterPage,
  SignalLabPage,
  SignificantFiguresPage
} from './ScienceLabs'
import {
  CollisionLabPage,
  IntegratorLabPage,
  MotionLabPage,
  OrbitLabPage,
  OscillatorLabPage,
  PendulumLabPage,
  ProjectileLabPage,
  RotationLabPage,
  WaveLabPage
} from './PhysicsLabs'
import { Field, Notes, Problem, readNumbers, useEngine } from './PageTools'

/**
 * The Pages backed by the mathematics, study, document, interchange and reasoning engines.
 *
 * Third file of the same kind, for the same reason as the second: `PagesView.tsx` is the library and the frame,
 * `PageTools.tsx` holds six Pages, and this holds thirteen more. Every rule from those two still applies here --
 * **nothing on this screen computes anything**. Every answer, every refusal and every caveat came back from the main
 * process through `pagesCompute`, the one capability-checked route to an engine.
 *
 * ## The refusals are the feature
 *
 * Several of these Pages spend most of their screen space saying what is *not* established: which assumptions have not
 * been reviewed, which concepts an explanation left out, which units do not line up, which artifact cannot be checked
 * at all. Those are rendered as prominently as the answers, because each of them exists to stop somebody acting on a
 * number that looks finished and is not.
 */

type Props = { pageId: string; onNotify(m: string, k?: NoticeKind): void }

/** A list of short strings, as themselves. Used wherever an engine hands back findings rather than a number. */
function Lines({ title, items }: { title: string; items: readonly string[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="page-result">
      <h4>{title}</h4>
      <ul>
        {items.map((one, i) => (
          <li key={`${i}-${one}`}>{one}</li>
        ))}
      </ul>
    </div>
  )
}

/** JSON typed into a box. Parsed here only to tell the person it is not valid before it reaches the engine. */
function useJson<T>(text: string, fallback: T): { value: T; problem: string } {
  return useMemo(() => {
    if (text.trim() === '') return { value: fallback, problem: '' }
    try {
      return { value: JSON.parse(text) as T, problem: '' }
    } catch (err) {
      return { value: fallback, problem: err instanceof Error ? `That is not valid JSON: ${err.message}` : 'That is not valid JSON.' }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
}

// ---------------------------------------------------------------- Algebra Lab

export function AlgebraLabPage({ pageId }: Props): React.JSX.Element {
  const [coefficients, setCoefficients] = useState('-6, 1, 1')
  const [decimal, setDecimal] = useState('0.142857142857')

  const roots = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('algebra.roots', { coefficients: readNumbers(coefficients) }),
    [coefficients]
  )
  const fraction = useEngine<Record<string, unknown>>(pageId, async (call) => call('algebra.rational', { value: decimal }), [decimal])

  const rational = (roots.result?.rational ?? []) as { text: string }[]
  const numeric = (roots.result?.numeric ?? []) as { re: number; im: number }[]

  return (
    <section className="page-pane" aria-label="Algebra Lab">
      <div className="page-row">
        <Sigma size={16} className="page-arrow" aria-hidden />
        <Field label="Polynomial coefficients, lowest power first" value={coefficients} onChange={setCoefficients} wide placeholder="-6, 1, 1" />
      </div>
      <Problem text={roots.problem} />
      {roots.result && (
        <div className="page-result">
          <h4>Roots</h4>
          {rational.length > 0 && <p>Exactly: {rational.map((one) => one.text).join(', ')}</p>}
          {numeric.length > 0 && (
            <p>
              Numerically: {numeric.map((one) => (Math.abs(one.im) < 1e-12 ? String(Number(one.re.toPrecision(8))) : `${Number(one.re.toPrecision(6))} ${one.im < 0 ? '-' : '+'} ${Number(Math.abs(one.im).toPrecision(6))}i`)).join(', ')}
            </p>
          )}
          {roots.result.complete !== true && (
            <p className="page-note">
              Not every root was found exactly. The exact ones and the numeric ones are listed separately, because they are different kinds of answer.
            </p>
          )}
          <Notes notes={(roots.result.notes ?? []) as string[]} label="What was done" />
        </div>
      )}

      <div className="page-row">
        <Field label="A decimal, as an exact fraction" value={decimal} onChange={setDecimal} wide placeholder="0.142857142857" />
      </div>
      <Problem text={fraction.problem} />
      {fraction.result?.ok === true && (
        <div className="page-result">
          <h4>{String(fraction.result.text)}</h4>
          <p className="page-note">
            {(fraction.result.decimal as { describe?: string })?.describe ?? `Approximately ${Number((fraction.result.approximately as number).toPrecision(12))}.`}
          </p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Matrix Lab

export function MatrixLabPage({ pageId }: Props): React.JSX.Element {
  const [text, setText] = useState('2 1\n1 3')
  const [rhs, setRhs] = useState('5, 10')

  const matrix = useMemo(
    () =>
      text
        .split('\n')
        .map((line) => readNumbers(line))
        .filter((row) => row.length > 0),
    [text]
  )

  const solved = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (matrix.length === 0 ? null : call('matrix.solve', { matrix, rightHandSide: readNumbers(rhs) })),
    [matrix, rhs]
  )
  const spaces = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (matrix.length === 0 ? null : call('matrix.subspaces', { matrix })),
    [matrix]
  )

  const particular = (solved.result?.particular ?? null) as { text: string }[] | null

  return (
    <section className="page-pane" aria-label="Matrix Lab">
      <div className="page-row">
        <Grid3x3 size={16} className="page-arrow" aria-hidden />
        <Field label="The matrix, one row per line" value={text} onChange={setText} wide rows={4} placeholder={'2 1\n1 3'} />
      </div>
      <Field label="Right-hand side" value={rhs} onChange={setRhs} wide placeholder="5, 10" />
      <Problem text={solved.problem} />
      {solved.result && (
        <div className="page-result">
          <h4>
            {solved.result.kind === 'unique'
              ? 'One solution'
              : solved.result.kind === 'infinite'
                ? 'Infinitely many solutions'
                : 'No solution'}
          </h4>
          {particular && <p>x = ({particular.map((one) => one.text).join(', ')})</p>}
          <p className="page-note">{String(solved.result.describe ?? '')}</p>
        </div>
      )}
      {spaces.result && (
        <div className="page-result">
          <h4>Rank {String(spaces.result.rank)}</h4>
          <p className="page-note">{String(spaces.result.describe ?? '')}</p>
        </div>
      )}
      <Notes
        notes={[
          'Everything here is worked out in exact fractions, so a determinant of zero means zero rather than something very close to it.',
          'A system with no solution says so. It is never handed back a least-squares answer as if it were the solution.'
        ]}
      />
    </section>
  )
}

// ---------------------------------------------------------------- Geometry Lab

export function GeometryLabPage({ pageId }: Props): React.JSX.Element {
  const [a, setA] = useState('0, 0')
  const [b, setB] = useState('4, 0')
  const [c, setC] = useState('0, 3')

  const point = (text: string): { x: number; y: number } => {
    const parts = readNumbers(text)
    return { x: parts[0] ?? 0, y: parts[1] ?? 0 }
  }

  const facts = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('geometry.triangle', { a: point(a), b: point(b), c: point(c) }),
    [a, b, c]
  )

  const sides = (facts.result?.sides ?? null) as { a: number; b: number; c: number } | null
  const angles = (facts.result?.angles ?? null) as { a: { describe: string }; b: { describe: string }; c: { describe: string } } | null

  return (
    <section className="page-pane" aria-label="Geometry Lab">
      <div className="page-row">
        <Triangle size={16} className="page-arrow" aria-hidden />
        <Field label="A" value={a} onChange={setA} placeholder="0, 0" />
        <Field label="B" value={b} onChange={setB} placeholder="4, 0" />
        <Field label="C" value={c} onChange={setC} placeholder="0, 3" />
      </div>
      <Problem text={facts.problem} />
      {facts.result?.ok === true && (
        <>
          <div className="page-result">
            <h4>{String(facts.result.classification ?? 'Triangle')}</h4>
            <p>Area {Number((facts.result.area as number).toPrecision(8))}, perimeter {Number((facts.result.perimeter as number).toPrecision(8))}</p>
            {sides && (
              <p className="page-note">
                Sides {Number(sides.a.toPrecision(8))}, {Number(sides.b.toPrecision(8))}, {Number(sides.c.toPrecision(8))}
              </p>
            )}
          </div>
          {angles && (
            <Lines title="Angles" items={[angles.a.describe, angles.b.describe, angles.c.describe]} />
          )}
          <Notes notes={(facts.result.notes ?? []) as string[]} />
        </>
      )}
      <Notes
        notes={[
          'An angle that comes out to a recognised exact value is named as that value rather than as its decimal.',
          'Anything checked against one construction is checked numerically and never called proven.'
        ]}
        label="How this answers"
      />
    </section>
  )
}

// ---------------------------------------------------------------- Number and Graph Lab

export function NumberLabPage({ pageId }: Props): React.JSX.Element {
  const [value, setValue] = useState('2305843009213693951')

  const prime = useEngine<Record<string, unknown>>(pageId, async (call) => call('number.prime', { value: value.trim() }), [value])
  const factors = useEngine<Record<string, unknown>>(pageId, async (call) => call('number.factorise', { value: value.trim() }), [value])

  const parts = (factors.result?.factors ?? []) as { prime: string; power: number }[]

  return (
    <section className="page-pane" aria-label="Number and Graph Lab">
      <div className="page-row">
        <Hash size={16} className="page-arrow" aria-hidden />
        <Field label="A whole number, however large" value={value} onChange={setValue} wide placeholder="2305843009213693951" />
      </div>
      <Problem text={prime.problem} />
      {prime.result?.ok === true && (
        <div className="page-result">
          <h4>{prime.result.prime === true ? 'Prime' : 'Not prime'}</h4>
          <p className="page-note">{String(prime.result.describe ?? '')}</p>
          {prime.result.certainty === 'probable' && (
            <p className="page-note">
              This is a probable prime, not a proven one. The witness set that settles it is only complete below a
              certain size, and this number is above it.
            </p>
          )}
        </div>
      )}
      {factors.result?.ok === true && parts.length > 0 && (
        <div className="page-result">
          <h4>Factors</h4>
          <p>{parts.map((one) => (one.power === 1 ? one.prime : `${one.prime}^${one.power}`)).join(' × ')}</p>
          {factors.result.complete !== true && (
            <p className="page-note">
              This factorisation is not complete. {String(factors.result.remaining)} is left over and was not factored,
              rather than being reported as prime.
            </p>
          )}
        </div>
      )}
      <Notes
        notes={[
          'The number travels as text. A JSON number past about sixteen digits loses the rest silently, and a primality test on the wrong number is worse than a refusal.'
        ]}
      />
    </section>
  )
}

// ---------------------------------------------------------------- Uncertainty Lab

export function UncertaintyLabPage({ pageId }: Props): React.JSX.Element {
  const [model, setModel] = useState('a * b')
  const [raw, setRaw] = useState('[\n  { "id": "a", "value": 10, "uncertainty": 0.1 },\n  { "id": "b", "value": 4, "uncertainty": 0.2 }\n]')
  const inputs = useJson<Record<string, unknown>[]>(raw, [])

  const compared = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (inputs.problem !== '' || inputs.value.length === 0 ? null : call('uncertainty.compare', { inputs: inputs.value, model, samples: 20000, seed: 1 })),
    [inputs.value, inputs.problem, model]
  )

  const firstOrder = (compared.result?.firstOrder ?? null) as { value: number; standardUncertainty: number } | null
  const sampled = (compared.result?.sampled ?? null) as { mean: number; standardUncertainty: number } | null

  return (
    <section className="page-pane" aria-label="Uncertainty Lab">
      <div className="page-row">
        <Target size={16} className="page-arrow" aria-hidden />
        <Field label="The model, over the input ids" value={model} onChange={setModel} wide placeholder="a * b" />
      </div>
      <Field label="The inputs" value={raw} onChange={setRaw} wide rows={6} />
      <Problem text={inputs.problem || compared.problem} />
      {compared.result && (
        <>
          <div className="page-result">
            <h4>{compared.result.agree === true ? 'Both methods agree' : 'The two methods disagree'}</h4>
            {firstOrder && (
              <p>
                Linear: {Number(firstOrder.value.toPrecision(6))} ± {Number(firstOrder.standardUncertainty.toPrecision(4))}
              </p>
            )}
            {sampled && (
              <p>
                Sampled: {Number(sampled.mean.toPrecision(6))} ± {Number(sampled.standardUncertainty.toPrecision(4))}
              </p>
            )}
          </div>
          <Lines title="Where they differ" items={(compared.result.differences ?? []) as string[]} />
          <Notes notes={(compared.result.notes ?? []) as string[]} />
        </>
      )}
      <Notes
        notes={[
          'Both methods are run and compared rather than one being chosen. Where they disagree, linearising the model changed the answer, and that is the finding rather than a detail.',
          'The sampled run is reproducible from its seed.'
        ]}
        label="How this answers"
      />
    </section>
  )
}

// ---------------------------------------------------------------- Parameter Study

export function ParameterStudyPage({ pageId }: Props): React.JSX.Element {
  const [model, setModel] = useState('x * x + y')
  const [raw, setRaw] = useState(
    '{\n  "parameters": [\n    { "id": "x", "type": "number", "value": 1 },\n    { "id": "y", "type": "number", "value": 1 }\n  ],\n  "strategy": {\n    "kind": "grid",\n    "sweeps": [\n      { "parameterId": "x", "spec": { "kind": "count", "start": 0, "stop": 4, "count": 5 } },\n      { "parameterId": "y", "spec": { "kind": "count", "start": 0, "stop": 2, "count": 3 } }\n    ]\n  }\n}'
  )
  const study = useJson<Record<string, unknown>>(raw, {})

  const size = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (study.problem !== '' ? null : call('study.size', study.value)),
    [study.value, study.problem]
  )
  const run = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (study.problem !== '' ? null : call('study.run', { ...study.value, model, output: 'value' })),
    [study.value, study.problem, model]
  )

  const generated = (run.result?.generated ?? null) as { requested: number; excluded: unknown[] } | null

  return (
    <section className="page-pane" aria-label="Parameter Study">
      <div className="page-row">
        <Sliders size={16} className="page-arrow" aria-hidden />
        <Field label="The model, over the parameter ids" value={model} onChange={setModel} wide placeholder="x * x + y" />
      </div>
      <Field label="Parameters and how to sweep them" value={raw} onChange={setRaw} wide rows={12} />
      <Problem text={study.problem || size.problem || run.problem} />
      {size.result?.ok === true && (
        <p className="page-note">
          This sweep is {String(size.result.cases)} cases. The size is worked out before any of it runs, because a grid
          of a million is easy to ask for by accident.
        </p>
      )}
      {run.result?.ok === true && (
        <div className="page-result">
          <h4>
            {String(run.result.completed)} of {String((run.result.results as unknown[]).length)} cases finished
          </h4>
          {generated && generated.excluded.length > 0 && (
            <p className="page-note">
              {generated.requested} cases were generated and {generated.excluded.length} were removed by the
              constraints. Both numbers are here because &quot;nine cases ran&quot; needs the other one to mean anything.
            </p>
          )}
          {Number(run.result.failed ?? 0) > 0 && (
            <p className="page-note">{String(run.result.failed)} cases failed. A run with failures is not a finished run.</p>
          )}
          <Notes notes={(run.result.notes ?? []) as string[]} label="What happened" />
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Document Studio

export function DocumentStudioPage({ pageId }: Props): React.JSX.Element {
  const [source, setSource] = useState('# A title\n\nSome text, with a [[reference]] in it.\n\n## A section\n\nMore text.\n')

  const document = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('document.read', { from: 'markdown', source }),
    [source]
  )

  const blocks = (document.result?.blocks ?? null) as unknown[] | null

  const analysed = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (blocks === null ? null : call('document.analyse', { document: { blocks } })),
    [blocks]
  )
  const outline = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (blocks === null ? null : call('document.outline', { document: { blocks } })),
    [blocks]
  )

  const entries = (outline.result?.outline ?? []) as { number: string; text: string; level: number }[]

  return (
    <section className="page-pane" aria-label="Document Studio">
      <div className="page-row">
        <FileText size={16} className="page-arrow" aria-hidden />
        <Field label="Markdown" value={source} onChange={setSource} wide rows={10} />
      </div>
      <Problem text={document.problem} />
      {entries.length > 0 && (
        <Lines title="Outline" items={entries.map((one) => `${one.number} ${one.text}`)} />
      )}
      {analysed.result && (
        <div className="page-result">
          <h4>{String(analysed.result.words)} words</h4>
          <p className="page-note">
            About {String(analysed.result.readingMinutes)} minutes to read, at the rate this was given.
          </p>
        </div>
      )}
      <Notes notes={(document.result?.notes ?? []) as string[]} label="What was read" />
      <Notes
        notes={[
          'The numbering is computed from the structure rather than typed into a heading, so moving a section renumbers everything that follows it.',
          'A reference whose target has gone breaks loudly rather than rendering as a question mark.'
        ]}
        label="How this answers"
      />
    </section>
  )
}

// ---------------------------------------------------------------- Data Importer

export function DataImporterPage({ pageId }: Props): React.JSX.Element {
  const [name, setName] = useState('data.csv')
  const [sample, setSample] = useState('name,amount\nAda,10\nGrace,20\n')

  const detected = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => call('interchange.detect', { name, mediaType: '', sample }),
    [name, sample]
  )

  return (
    <section className="page-pane" aria-label="Data Importer">
      <div className="page-row">
        <Download size={16} className="page-arrow" aria-hidden />
        <Field label="File name" value={name} onChange={setName} placeholder="data.csv" />
      </div>
      <Field label="The first part of the file" value={sample} onChange={setSample} wide rows={8} />
      <Problem text={detected.problem} />
      {detected.result?.ok === true && (
        <>
          <div className="page-result">
            <h4>{String(detected.result.chosen)}</h4>
            <p className="page-note">Confidence: {String(detected.result.confidence)}</p>
            <p className="page-note">
              By name: {String(detected.result.byExtension ?? 'nothing') } · by type: {String(detected.result.byMediaType ?? 'nothing')} ·
              by content: {String(detected.result.byContent ?? 'nothing')}
            </p>
          </div>
          {detected.result.conflict !== null && detected.result.conflict !== undefined && (
            <p className="page-problem" role="alert">
              {String(detected.result.conflict)}
            </p>
          )}
          <Lines title="Why" items={(detected.result.reasons ?? []) as string[]} />
        </>
      )}
      <Notes
        notes={[
          'What the name claims, what the source claims and what the bytes show are reported separately. Only the third is evidence, and a disagreement between them is surfaced rather than resolved quietly.'
        ]}
      />
    </section>
  )
}

// ---------------------------------------------------------------- Problem Workspace

export function ProblemWorkspacePage({ pageId }: Props): React.JSX.Element {
  const [raw, setRaw] = useState(
    '{\n  "nodes": [\n    { "id": "rate", "kind": "assumption", "title": "Growth is 4% a year" },\n    { "id": "calc", "kind": "calculation", "title": "Projection" },\n    { "id": "revenue", "kind": "result", "title": "Revenue in 2030" }\n  ],\n  "links": [\n    { "id": "l1", "from": "rate", "to": "calc", "kind": "feeds" },\n    { "id": "l2", "from": "calc", "to": "revenue", "kind": "produces" }\n  ]\n}'
  )
  const workspace = useJson<Record<string, unknown>>(raw, {})

  const register = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (workspace.problem !== '' ? null : call('workspace.assumptions', { workspace: workspace.value })),
    [workspace.value, workspace.problem]
  )
  const report = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (workspace.problem !== '' ? null : call('workspace.report', { workspace: workspace.value })),
    [workspace.value, workspace.problem]
  )

  const assumptions = (register.result?.assumptions ?? []) as { id: string; describe: string }[]
  const sections = (report.result?.sections ?? []) as { heading: string; body: string[] }[]

  return (
    <section className="page-pane" aria-label="Problem Workspace">
      <div className="page-row">
        <GitBranch size={16} className="page-arrow" aria-hidden />
        <Field label="The workspace" value={raw} onChange={setRaw} wide rows={12} />
      </div>
      <Problem text={workspace.problem || register.problem} />
      <Lines title="What rests on what" items={assumptions.map((one) => one.describe)} />
      {sections.map((one) => (
        <Lines key={one.heading} title={one.heading} items={one.body} />
      ))}
      {report.result && (
        <Lines title="What this report does not establish" items={(report.result.caveats ?? []) as string[]} />
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Scenario Lab

export function ScenarioLabPage({ pageId }: Props): React.JSX.Element {
  const [raw, setRaw] = useState(
    '{\n  "baseline": { "label": "Now", "values": { "price": 100, "volume": 50 } },\n  "scenarios": [\n    {\n      "id": "tariff",\n      "label": "Tariff comes in",\n      "changes": [\n        { "key": "price", "how": "multiply", "to": 1.15, "because": "15% import duty" }\n      ]\n    }\n  ],\n  "scenarioId": "tariff"\n}'
  )
  const input = useJson<Record<string, unknown>>(raw, {})

  const resolved = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (input.problem !== '' ? null : call('scenario.resolve', input.value)),
    [input.value, input.problem]
  )

  const differences = (resolved.result?.differences ?? []) as { key: string; from: unknown; to: unknown; through: string[] }[]
  const refused = (resolved.result?.refused ?? []) as { why: string }[]

  return (
    <section className="page-pane" aria-label="Scenario Lab">
      <div className="page-row">
        <Layers size={16} className="page-arrow" aria-hidden />
        <Field label="Baseline and scenarios" value={raw} onChange={setRaw} wide rows={14} />
      </div>
      <Problem text={input.problem || resolved.problem} />
      {differences.length > 0 && (
        <Lines
          title="What is different from the baseline"
          items={differences.map(
            (one) => `${one.key}: ${String(one.from)} → ${String(one.to)}${one.through.length > 0 ? ` (through ${one.through.join(', ')})` : ''}`
          )}
        />
      )}
      {refused.length > 0 && <Lines title="Changes that could not be applied" items={refused.map((one) => one.why)} />}
      <Notes
        notes={[
          'The baseline is captured and frozen. A scenario is a difference from it, never an edit to it, so a comparison still means what it meant when it was made.',
          'A change that could not be applied is kept and listed rather than dropped.'
        ]}
      />
    </section>
  )
}

// ---------------------------------------------------------------- Explain It Yourself

export function ExplainYourselfPage({ pageId }: Props): React.JSX.Element {
  const [topicRaw, setTopicRaw] = useState(
    '{\n  "id": "photosynthesis",\n  "name": "Photosynthesis",\n  "concepts": [\n    { "id": "light", "name": "light energy", "aliases": ["sunlight"], "essential": true },\n    { "id": "chlorophyll", "name": "chlorophyll", "essential": true },\n    { "id": "carbon", "name": "carbon dioxide", "aliases": ["CO2"], "essential": true },\n    { "id": "glucose", "name": "glucose", "aliases": ["sugar"], "essential": true }\n  ]\n}'
  )
  const [explanation, setExplanation] = useState('Sunlight hits the chlorophyll and sugar comes out.')
  const [level, setLevel] = useState(1)
  const topic = useJson<Record<string, unknown>>(topicRaw, {})

  const analysed = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (topic.problem !== '' ? null : call('learning.analyse', { topic: topic.value, explanation })),
    [topic.value, topic.problem, explanation]
  )
  const hint = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (topic.problem !== '' ? null : call('learning.hint', { topic: topic.value, explanation, level })),
    [topic.value, topic.problem, explanation, level]
  )

  const covered = (analysed.result?.covered ?? []) as { name: string; mentioned: boolean; essential: boolean }[]
  const misconceptions = (analysed.result?.possibleMisconceptions ?? []) as { belief: string; because: string }[]

  return (
    <section className="page-pane" aria-label="Explain It Yourself">
      <div className="page-row">
        <MessageCircle size={16} className="page-arrow" aria-hidden />
        <Field label="Your explanation" value={explanation} onChange={setExplanation} wide rows={6} />
      </div>
      <Field label="The topic" value={topicRaw} onChange={setTopicRaw} wide rows={10} />
      <Problem text={topic.problem || analysed.problem} />
      {analysed.result?.ok === true && (
        <>
          <div className="page-result">
            <h4>{String(analysed.result.describe ?? '')}</h4>
            <p className="page-note">{String(analysed.result.claim)}</p>
          </div>
          <Lines
            title="Concepts"
            items={covered.map((one) => `${one.mentioned ? 'mentioned' : 'not mentioned'}: ${one.name}${one.essential ? ' (essential)' : ''}`)}
          />
          {misconceptions.length > 0 && (
            <Lines title="Something here would lead somewhere wrong" items={misconceptions.map((one) => `${one.belief}. ${one.because}`)} />
          )}
          <p className="page-note">{String(analysed.result.question ?? '')}</p>
        </>
      )}
      <div className="page-row">
        <label className="page-field">
          <span>Hint level</span>
          <input
            type="number"
            min={1}
            max={6}
            value={level}
            onChange={(e) => setLevel(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
          />
        </label>
      </div>
      {hint.result?.ok === true && <p className="page-note">{String(hint.result.text)}</p>}
      {hint.problem !== '' && <p className="page-note">{hint.problem}</p>}
    </section>
  )
}

// ---------------------------------------------------------------- Builder Studio

export function BuilderStudioPage({ pageId }: Props): React.JSX.Element {
  const [raw, setRaw] = useState(
    '{\n  "builderId": "flowchart",\n  "objects": [\n    { "id": "s", "type": "start", "text": "Start", "box": { "x": 0, "y": 0, "width": 100, "height": 40 } },\n    { "id": "d", "type": "decision", "text": "Is it ready?", "box": { "x": 0, "y": 80, "width": 120, "height": 60 } },\n    { "id": "e", "type": "end", "text": "Ship", "box": { "x": 0, "y": 180, "width": 100, "height": 40 } }\n  ],\n  "connectors": [\n    { "id": "c0", "from": "s", "to": "d", "type": "next" },\n    { "id": "c1", "from": "d", "to": "e", "type": "yes" }\n  ]\n}'
  )
  const artifact = useJson<Record<string, unknown>>(raw, {})

  const checked = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (artifact.problem !== '' ? null : call('builder.validate', { artifact: artifact.value })),
    [artifact.value, artifact.problem]
  )

  const issues = (checked.result?.issues ?? []) as { kind: string; describe: string; blocking: boolean }[]

  return (
    <section className="page-pane" aria-label="Builder Studio">
      <div className="page-row">
        <Shapes size={16} className="page-arrow" aria-hidden />
        <Field label="The artifact" value={raw} onChange={setRaw} wide rows={14} />
      </div>
      <Problem text={artifact.problem || checked.problem} />
      {checked.result?.ok === true && (
        <>
          <div className="page-result">
            <h4>{checked.result.valid === true ? 'Nothing here would stop it working' : 'There are problems'}</h4>
            <p className="page-note">{String(checked.result.describe ?? '')}</p>
          </div>
          {issues.length > 0 && (
            <Lines
              title="What was found"
              items={issues.map((one) => `${one.blocking ? 'Blocking' : 'Worth a look'}: ${one.describe}`)}
            />
          )}
          {checked.result.builderHasNoRules === true && (
            <p className="page-note">
              This builder registers no rules of its own, so only the structural checks ran. Nothing here says whether
              this is a sensible one of its kind.
            </p>
          )}
        </>
      )}
      <Notes
        notes={[
          'What an artifact carries is a list of typed actions, never code. Opening one somebody sent you never runs their program.'
        ]}
      />
    </section>
  )
}

// ---------------------------------------------------------------- Project

export function ProjectPage({ pageId }: Props): React.JSX.Element {
  const [raw, setRaw] = useState(
    '{\n  "pages": [\n    { "id": "source", "pageType": "data-explorer", "title": "Sales", "outputs": [{ "name": "data", "type": "table", "unit": "", "required": true, "describe": "" }] },\n    { "id": "study", "pageType": "parameter-study", "title": "Forecast", "inputs": [{ "name": "data", "type": "table", "unit": "", "required": true, "describe": "" }] }\n  ],\n  "connections": [\n    { "id": "c1", "fromPage": "source", "fromPort": "data", "toPage": "study", "toPort": "data" }\n  ]\n}'
  )
  const project = useJson<Record<string, unknown>>(raw, {})

  const checked = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (project.problem !== '' ? null : call('project.check', { project: project.value })),
    [project.value, project.problem]
  )
  const order = useEngine<Record<string, unknown>>(
    pageId,
    async (call) => (project.problem !== '' ? null : call('project.order', { project: project.value })),
    [project.value, project.problem]
  )

  const problems = (checked.result?.problems ?? []) as { describe: string; blocking: boolean }[]
  const unused = (checked.result?.unused ?? []) as { pageId: string; port: string }[]
  const levels = (order.result?.levels ?? []) as string[][]

  return (
    <section className="page-pane" aria-label="Project">
      <div className="page-row">
        <Workflow size={16} className="page-arrow" aria-hidden />
        <Field label="The project" value={raw} onChange={setRaw} wide rows={14} />
      </div>
      <Problem text={project.problem || checked.problem} />
      {checked.result?.ok === true && (
        <>
          <div className="page-result">
            <h4>{checked.result.holdsTogether === true ? 'This project holds together' : 'This project will not run'}</h4>
          </div>
          {problems.length > 0 && (
            <Lines title="What is wrong" items={problems.map((one) => `${one.blocking ? 'Blocking' : 'Worth a look'}: ${one.describe}`)} />
          )}
          {unused.length > 0 && (
            <Lines
              title="Outputs nothing uses"
              items={unused.map((one) => `${one.pageId}.${one.port} — usually a wire somebody forgot`)}
            />
          )}
          {(checked.result.lossy as string[])?.length > 0 && (
            <Lines
              title="Connections that lose information"
              items={(checked.result.lossy as string[]).map((one) => `${one} goes through a conversion that does not carry everything`)}
            />
          )}
        </>
      )}
      {levels.length > 0 && (
        <Lines
          title="Run order"
          items={levels.map((group, i) => `Step ${i + 1}: ${group.join(', ')}${group.length > 1 ? ' (together)' : ''}`)}
        />
      )}
      <Notes
        notes={[
          'A connection whose units differ is refused even when the types match. That is the mismatch that computes perfectly and gives a wrong answer.'
        ]}
      />
    </section>
  )
}

/** Every built-in Page in this file, by slug, so the frame does not need a chain of comparisons. */
export const LAB_PAGES: Readonly<Record<string, (props: Props) => React.JSX.Element>> = Object.freeze({
  'algebra-lab': AlgebraLabPage,
  'matrix-lab': MatrixLabPage,
  'geometry-lab': GeometryLabPage,
  'number-lab': NumberLabPage,
  'uncertainty-lab': UncertaintyLabPage,
  'parameter-study': ParameterStudyPage,
  'document-studio': DocumentStudioPage,
  'data-importer': DataImporterPage,
  'problem-workspace': ProblemWorkspacePage,
  'scenario-lab': ScenarioLabPage,
  'explain-it-yourself': ExplainYourselfPage,
  'builder-studio': BuilderStudioPage,
  project: ProjectPage,
  // The six science Pages live in their own file; they are listed here so the frame still has one map to look in.
  'signal-lab': SignalLabPage,
  'curve-fitter': CurveFitterPage,
  'significant-figures': SignificantFiguresPage,
  'constants-library': ConstantsLibraryPage,
  'coordinate-lab': CoordinateLabPage,
  'constraint-checker': ConstraintCheckerPage,
  // The nine physics Pages, in their own file for the same reason the science ones are: one file of thirty screens
  // is a file nobody can find anything in.
  'motion-lab': MotionLabPage,
  'projectile-lab': ProjectileLabPage,
  'oscillator-lab': OscillatorLabPage,
  'pendulum-lab': PendulumLabPage,
  'collision-lab': CollisionLabPage,
  'orbit-lab': OrbitLabPage,
  'rotation-lab': RotationLabPage,
  'wave-lab': WaveLabPage,
  'integrator-lab': IntegratorLabPage
})
