/*
 * V27 — Research Workspace.
 *
 * Their registry listed this as "Design, run & save chemistry experiments" and marked it `soon`. This is it,
 * built to the same shape as their other studios.
 *
 * What makes it a research workspace rather than another calculator is the order it insists on: you say what you
 * expect before it runs, and it will not let you change that afterwards and call it the original. "Does not
 * support it" is reported as plainly as a confirmation, and "cannot tell from this" as plainly as either. The
 * rules live in `src/shared/chemistry/experiments.ts` with their own tests, so they can be checked without a
 * screen.
 *
 * The measurements come from the real chemistry engines — the bond curve, the reaction path, the orbitals. A
 * point an engine refuses is recorded as missing with its reason, never filled in.
 */
import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar, Scatter, ComposedChart, ReferenceLine } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';

const TABS = ['Design & run', 'What was found', 'Saved work'];

const EXPLAIN = {
  name: 'Research Workspace',
  nameMeaning: 'A place to ask a question of the models, answer it properly, and keep what you found.',
  whatItIs: 'You state what you are varying, what you are measuring, and what you expect — in that order. It runs the measurement across the range, repeats it as many times as you ask, and says whether the readings support what you said before you looked.',
  chemistry: 'Everything measured here comes from the studio’s own engines: a bond energy from the Morse potential, a reaction barrier from the energy path, an orbital size from the radial distribution. The workspace does not compute chemistry itself — it asks the parts that do, and judges the answer.',
  math: [
    { eq: 'mean = Σxᵢ/n', label: 'the average of the repeats' },
    { eq: 's = √(Σ(xᵢ−x̄)²/(n−1))', label: 'the scatter across them' },
    { eq: 'span ≤ 2s ⟹ no trend', label: 'when the change is inside the noise' }
  ],
  variables: [
    { sym: 'range', desc: 'what you vary, from and to', unit: 'whatever the variable is in' },
    { sym: 'points', desc: 'how many values across the range', unit: '3 or more' },
    { sym: 'repeats', desc: 'how many times each point is measured', unit: '1 to 50' },
    { sym: 's', desc: 'the typical scatter', unit: 'the measurement’s unit' }
  ],
  assumptions: [
    'The measurement is a model, not a bench. It says what the model gives under the conditions you set.',
    'Repeats differ only where the measurement itself varies between them.'
  ],
  limitations: [
    'A trend smaller than the scatter is reported as no trend. That is deliberate: reading a slope out of noise is the mistake this exists to prevent.',
    'An expectation cannot be changed after a run and the run repeated as though it were the original. Design it again instead.',
    'A point the measurement refuses is recorded as missing with the reason. Nothing is interpolated into the gap.',
    'This cannot tell you what a real experiment would measure. It tells you what the model says.'
  ],
  applications: ['Checking whether a parameter actually matters', 'Finding where a model stops behaving as expected', 'Keeping a record of what was tried and what it showed']
};

/**
 * What can be measured, and how.
 *
 * Each is a real engine call. The label says what is varied and what comes back, and `make` builds the
 * measurement function the workspace runs — including the refusals, which are passed through rather than
 * swallowed.
 */
function measurements(engine) {
  return [
    {
      id: 'bond-stretch',
      label: 'Bond energy as the bond stretches',
      variable: 'separation',
      unit: 'pm',
      measures: 'energy',
      measureUnit: 'kJ/mol',
      // Starting at the bond length, not below it. Below r₀ the repulsion climbs steeply, so a range that
      // begins there falls before it rises -- and a prediction of "levels off" is then correctly judged wrong,
      // which reads as the workspace misbehaving rather than as the range being the wrong one to ask about.
      from: 80,
      to: 320,
      about: 'How much energy it costs to hold two atoms further and further apart, starting from the bond length. Levels off once the bond has broken.',
      make: (settings) => (at) => {
        const curve = engine.bondCurve({ depth: settings.depth, length: settings.length, width: 0.0193, outTo: 6, points: 600 });
        if (engine.isLandscapeProblem(curve)) return { refused: curve.problem };
        if (at < curve.r[0]) return { refused: `below ${curve.r[0].toFixed(0)} pm the repulsion is off the scale of this model` };
        // Nearest sample. The curve is smooth, so this is the value at that separation.
        let best = 0;
        for (let i = 1; i < curve.r.length; i += 1) {
          if (Math.abs(curve.r[i] - at) < Math.abs(curve.r[best] - at)) best = i;
        }
        return curve.energy[best];
      }
    },
    {
      id: 'barrier-rate',
      label: 'Reaction barrier as the energy change varies',
      variable: 'energy change',
      unit: 'kJ/mol',
      measures: 'forward barrier',
      measureUnit: 'kJ/mol',
      from: -120,
      to: 60,
      about: 'Holding the barrier setting fixed, how the barrier the reaction actually climbs depends on how far downhill it goes.',
      make: (settings) => (at) => {
        const path = engine.reactionPath({ barrier: settings.barrier, change: at, points: 200 });
        if (engine.isLandscapeProblem(path)) return { refused: path.problem };
        return path.forward;
      }
    },
    {
      id: 'orbital-size',
      label: 'Orbital size as the nuclear charge rises',
      variable: 'nuclear charge Z',
      unit: '',
      measures: 'most likely radius',
      measureUnit: 'a₀',
      from: 1,
      to: 12,
      about: 'How far from the nucleus the electron is most likely to be found, as the nucleus pulls harder. Should fall as 1/Z.',
      make: (settings) => (at) => {
        if (at < 1) return { refused: 'a nuclear charge below 1 is not an atom' };
        const curve = engine.radialCurve({ n: settings.n, l: 0, m: 0 }, { Z: at, points: 900 });
        if (engine.isOrbitalProblem(curve)) return { refused: curve.problem };
        return curve.mostLikely;
      }
    },
    {
      id: 'orbital-nodes',
      label: 'Node count as the shell number rises',
      variable: 'n (shell)',
      unit: '',
      measures: 'total nodes',
      measureUnit: '',
      from: 1,
      to: 8,
      about: 'How many nodes an s orbital has, shell by shell. The answer is exactly n − 1, which is a trend with no scatter at all.',
      make: () => (at) => {
        const n = Math.round(at);
        const got = engine.facts({ n, l: 0, m: 0 });
        if (engine.isOrbitalProblem(got)) return { refused: got.problem };
        return got.totalNodes;
      }
    }
  ];
}

export default function ResearchStudio({ engine, store }) {
  const WHAT = useMemo(() => (engine ? measurements(engine) : []), [engine]);

  const [whichId, setWhichId] = useState('bond-stretch');
  const which = WHAT.find((one) => one.id === whichId) ?? WHAT[0];

  const [question, setQuestion] = useState('Does the energy level off once the bond has broken?');
  const [because, setBecause] = useState('A real bond dissociates, so past a certain separation holding the atoms further apart should cost nothing more.');
  const [expects, setExpects] = useState('flattens');
  const [from, setFrom] = useState(80);
  const [to, setTo] = useState(320);
  const [points, setPoints] = useState(14);
  const [repeats, setRepeats] = useState(1);

  // Settings the chosen measurement needs.
  const [depth, setDepth] = useState(436);
  const [length, setLength] = useState(74);
  const [barrier, setBarrier] = useState(90);
  const [n, setN] = useState(4);

  const [finding, setFinding] = useState(null);
  const [refused, setRefused] = useState(null);
  const [saved, setSaved] = useState([]);
  const [showing, setShowing] = useState(0);

  const choose = (id) => {
    const one = WHAT.find((two) => two.id === id);
    setWhichId(id);
    if (one) {
      // The range follows the measurement, because 60 to 300 pm means nothing for a nuclear charge.
      setFrom(one.from);
      setTo(one.to);
    }
    setFinding(null);
    setRefused(null);
  };

  const go = () => {
    if (!which || !engine) return;
    setRefused(null);
    const plan = engine.design({
      question,
      variable: which.variable,
      unit: which.unit,
      from,
      to,
      points,
      measures: which.measures,
      measureUnit: which.measureUnit,
      expects,
      because,
      repeats
    });
    if (engine.isExperimentProblem(plan)) {
      setRefused(plan);
      setFinding(null);
      return;
    }
    const got = engine.run(plan, which.make({ depth, length, barrier, n }));
    if (engine.isExperimentProblem(got)) {
      setRefused(got);
      setFinding(null);
      return;
    }
    setFinding(got);
    setShowing(1);
  };

  const keep = async () => {
    if (!finding || !store) return;
    const record = engine.toRecord(finding, `exp-${Date.now().toString(36)}`, new Date().toISOString());
    try {
      await store.create(record);
      const rows = await store.list('-created_date', 50);
      setSaved(rows.map(engine.readRecord).filter(Boolean));
      setShowing(2);
    } catch {
      setRefused({ problem: 'It could not be saved.', fix: 'Storage is not available here, so the run is still on screen but not kept.' });
    }
  };

  const load = async () => {
    if (!store) return;
    try {
      const rows = await store.list('-created_date', 50);
      setSaved(rows.map(engine.readRecord).filter(Boolean));
    } catch {
      setSaved([]);
    }
  };

  const plotted = useMemo(() => {
    if (!finding) return [];
    return finding.readings
      .filter((one) => one.value !== null)
      .map((one) => ({ at: Number(one.at.toFixed(3)), value: one.value, spread: one.spread }));
  }, [finding]);

  if (!engine) {
    return (
      <StudioShell title="Research Workspace" subtitle="Nothing to measure with." tabs={[]} explain={EXPLAIN}>
        <ValidationBadge status="failed" note="The research engines were not handed to this studio, so there is nothing to run." />
      </StudioShell>
    );
  }

  const EXPECTS = engine.EXPECTATIONS.map((one) => ({ value: one.id, label: one.label }));

  return (
    <StudioShell
      title="Research Workspace"
      subtitle="State what you expect, then measure. It will tell you if you were wrong."
      tabs={TABS}
      explain={EXPLAIN}
      showing={showing}
      onShow={setShowing}
    >
      {/* ---------------------------------------------------------------- design & run */}
      <div className="space-y-4">
        <div className="rounded-xl border border-cyan-j/30 bg-cyan-j/5 px-3 py-2 text-[11px] text-muted-foreground">
          The expectation is recorded before the run and cannot be changed afterwards and re-run as the original.
          That is the one rule this workspace exists for.
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">What are you trying to find out?</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                aria-label="What are you trying to find out?"
                className="mt-1 w-full rounded-xl border border-border/60 bg-card/60 px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>

            <Select label="What to measure" value={whichId} set={choose} options={WHAT.map((one) => ({ value: one.id, label: one.label }))} />
            {which && <p className="text-[11px] text-muted-foreground">{which.about}</p>}

            <Select label="What do you expect?" value={expects} set={setExpects} options={EXPECTS} />
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Why? (recorded with the run)</span>
              <textarea
                value={because}
                onChange={(event) => setBecause(event.target.value)}
                rows={2}
                aria-label="Why do you expect that?"
                className="mt-1 w-full rounded-xl border border-border/60 bg-card/60 px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>

          <div className="space-y-3">
            <Slider label={`${which?.variable ?? 'from'} — start`} value={from} set={setFrom} min={which ? Math.min(which.from, which.to) - Math.abs(which.to - which.from) : 0} max={which ? Math.max(which.from, which.to) : 100} step={(Math.abs(to - from) || 100) / 200} unit={which?.unit ?? ''} />
            <Slider label={`${which?.variable ?? 'to'} — finish`} value={to} set={setTo} min={which ? Math.min(which.from, which.to) : 0} max={which ? Math.max(which.from, which.to) + Math.abs(which.to - which.from) : 100} step={(Math.abs(to - from) || 100) / 200} unit={which?.unit ?? ''} />
            <Slider label="Points across the range" value={points} set={setPoints} min={3} max={60} step={1} />
            <Slider label="Repeats at each point" value={repeats} set={setRepeats} min={1} max={20} step={1} />

            {whichId === 'bond-stretch' && (
              <>
                <Slider label="Dissociation energy" value={depth} set={setDepth} min={100} max={900} step={1} unit="kJ/mol" />
                <Slider label="Bond length" value={length} set={setLength} min={60} max={250} step={1} unit="pm" />
              </>
            )}
            {whichId === 'barrier-rate' && (
              <Slider label="Barrier setting" value={barrier} set={setBarrier} min={10} max={240} step={1} unit="kJ/mol" />
            )}
            {(whichId === 'orbital-size') && (
              <Slider label="Shell n" value={n} set={setN} min={1} max={6} step={1} />
            )}

            <button
              type="button"
              onClick={go}
              className="w-full rounded-xl bg-cyan-j px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
            >
              Run it
            </button>
          </div>
        </div>

        {refused && <ValidationBadge status="failed" note={`${refused.problem} ${refused.fix}`} />}
      </div>

      {/* ---------------------------------------------------------------- what was found */}
      <div className="space-y-4">
        {!finding ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing has been run yet.</p>
        ) : (
          <>
            <ValidationBadge
              status={finding.supports === 'yes' ? 'passed' : finding.supports === 'no' ? 'failed' : 'warning'}
              note={finding.says}
            />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Expected" value={engine.EXPECTATIONS.find((one) => one.id === finding.plan.expects)?.label ?? finding.plan.expects} />
              <Stat label="Readings show" value={engine.EXPECTATIONS.find((one) => one.id === finding.shows)?.label ?? finding.shows} />
              <Stat label="Change across range" value={finding.change === null ? '—' : `${finding.change.toPrecision(3)} ${finding.plan.measureUnit}`} />
              <Stat label="Typical scatter" value={`${finding.noise.toPrecision(3)} ${finding.plan.measureUnit}`} />
              {finding.peakAt !== null && <Stat label="Peak at" value={`${finding.peakAt.toPrecision(3)} ${finding.plan.unit}`} />}
              {finding.missed > 0 && <Stat label="Points missing" value={`${finding.missed} of ${finding.plan.points}`} />}
            </div>

            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={plotted} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="at" tick={{ fontSize: 10 }} label={{ value: `${finding.plan.variable} ${finding.plan.unit}`.trim(), position: 'insideBottom', offset: -2, fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: `${finding.plan.measures} ${finding.plan.measureUnit}`.trim(), angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Line type="monotone" dataKey="value" stroke="#22d3ee" dot={{ r: 2 }} strokeWidth={2} />
                  {/* The scatter is drawn, so a trend can be compared against it by eye as well as by the verdict. */}
                  {repeats > 1 && (
                    <Scatter dataKey="value" fill="#22d3ee">
                      <ErrorBar dataKey="spread" width={3} strokeWidth={1} stroke="#f0a33a" direction="y" />
                    </Scatter>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {finding.missed > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                <div className="text-[11px] font-medium text-amber-400">Points that could not be measured</div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  {finding.readings
                    .filter((one) => one.value === null)
                    .slice(0, 6)
                    .map((one, i) => (
                      <li key={i}>
                        <span className="font-mono-j">{one.at.toPrecision(4)}</span> — {one.missing}
                      </li>
                    ))}
                </ul>
                <p className="mt-1 text-[10px] text-muted-foreground/80">Nothing was filled in for these.</p>
              </div>
            )}

            <div className="rounded-xl border border-border/60 bg-card/40 p-3 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground/90">What was recorded before the run</div>
              <p className="mt-1">{finding.plan.question}</p>
              <p className="mt-1">
                Expected: <span className="text-foreground/90">{engine.EXPECTATIONS.find((one) => one.id === finding.plan.expects)?.label}</span>
                {finding.plan.because ? ` — ${finding.plan.because}` : ''}
              </p>
            </div>

            {store && (
              <button
                type="button"
                onClick={keep}
                className="rounded-xl border border-border/60 bg-card/50 px-4 py-2 text-sm transition hover:border-cyan-j/50"
              >
                Keep this
              </button>
            )}
          </>
        )}
      </div>

      {/* ---------------------------------------------------------------- saved work */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-xs transition hover:border-border"
        >
          Load what is saved
        </button>
        {saved.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing saved yet, or nothing could be read back. An unreadable record is left alone rather than overwritten.
          </p>
        ) : (
          <div className="space-y-2">
            {saved.map((one) => (
              <div key={one.id} className="rounded-xl border border-border/60 bg-card/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{one.plan.question}</span>
                  <span className="font-mono-j text-[10px] text-muted-foreground">{one.at.slice(0, 16).replace('T', ' ')}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{one.says}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground/80">
                  <span>
                    {one.plan.variable} {one.plan.from} → {one.plan.to} {one.plan.unit}
                  </span>
                  <span>·</span>
                  <span>{one.readings.length} points</span>
                  <span>·</span>
                  <span
                    className={
                      one.supports === 'yes' ? 'text-emerald-400' : one.supports === 'no' ? 'text-rose-400' : 'text-amber-400'
                    }
                  >
                    {one.supports === 'yes' ? 'supported' : one.supports === 'no' ? 'not supported' : 'could not tell'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </StudioShell>
  );
}
