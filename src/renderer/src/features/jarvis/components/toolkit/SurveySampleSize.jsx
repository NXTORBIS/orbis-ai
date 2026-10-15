import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CONFIDENCE = [
  { value: '90', z: 1.645 },
  { value: '95', z: 1.96 },
  { value: '99', z: 2.576 },
];

const LADDER = [100, 250, 400, 500, 750, 1000, 1500, 2500, 5000, 10000];

export default function SurveySampleSize() {
  const [confidence, setConfidence] = useState('95');
  const [error, setError] = useState('5');
  const [population, setPopulation] = useState('0');
  const [proportion, setProportion] = useState('50');
  const [responseRate, setResponseRate] = useState('25');
  const [mode, setMode] = useState('sample');

  const result = useMemo(() => {
    const entry = CONFIDENCE.find((option) => option.value === confidence) || CONFIDENCE[1];
    const z = entry.z;
    const p = Math.max(0.001, Math.min(0.999, (Number(proportion) || 50) / 100));
    const margin = Math.max(0.001, (Number(error) || 5) / 100);
    const populationSize = Math.max(0, Number(population) || 0);
    const rate = Math.max(0.01, (Number(responseRate) || 25) / 100);

    const infinite = (Math.pow(z, 2) * p * (1 - p)) / Math.pow(margin, 2);
    const adjusted = populationSize ? infinite / (1 + (infinite - 1) / populationSize) : infinite;
    const required = Math.ceil(adjusted);
    const invitations = Math.ceil(required / rate);
    const populationShare = populationSize ? (required / populationSize) * 100 : 0;

    const curve = LADDER.map((size) => ({
      label: String(size),
      value: Number(((z * Math.sqrt(p * (1 - p))) / Math.sqrt(size) * 100).toFixed(2)),
    }));

    const marginFor = (size) => (z * Math.sqrt(p * (1 - p))) / Math.sqrt(size) * 100;

    const halfSample = Math.ceil(required / 4);
    const doubleSample = required * 4;

    return {
      z, p, margin, populationSize, rate, required, invitations, infinite, adjusted, curve, marginFor,
      populationShare, halfSample, doubleSample,
      subsampleMargin: required ? marginFor(Math.round(required * 0.2)) : 0,
      tight: LADDER.find((size) => marginFor(size) <= 3) || LADDER[LADDER.length - 1],
      loose: LADDER.find((size) => marginFor(size) <= 10) || LADDER[0],
      confidenceLabel: confidence,
    };
  }, [confidence, error, population, proportion, responseRate]);

  const report = useMemo(() => [
    'Survey of ' + (result.populationSize ? result.populationSize.toLocaleString() + ' people' : 'an unlimited population'),
    'Confidence ' + result.confidenceLabel + '% (z = ' + result.z + '), margin of error ±' + (result.margin * 100).toFixed(1) + '%',
    'Expected proportion ' + (result.p * 100).toFixed(0) + '%',
    '',
    'Responses needed: ' + result.required.toLocaleString(),
    result.populationSize ? 'Finite population correction applied: ' + Math.ceil(result.infinite).toLocaleString() + ' before, ' + result.required.toLocaleString() + ' after, which is ' + result.populationShare.toFixed(1) + '% of the whole population.' : 'No finite population correction, so the sample is the textbook figure.',
    'Invitations needed at a ' + (result.rate * 100).toFixed(0) + '% response rate: ' + result.invitations.toLocaleString(),
    '',
    'Margin of error at other sample sizes: ' + result.curve.map((row) => row.label + ' → ±' + row.value + '%').join(', '),
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="survey-sample-size"
      icon={Users}
      title="Survey Sample Size Calculator"
      desc="How many responses a survey actually needs for a given margin of error, how many invitations that implies at your response rate, and what the error becomes at other sample sizes."
      state={{ confidence, error, population, proportion, responseRate, mode }}
      onRestore={(restored) => {
        if (restored.confidence) setConfidence(restored.confidence);
        if (restored.error !== undefined) setError(String(restored.error));
        if (restored.population !== undefined) setPopulation(String(restored.population));
        if (restored.proportion !== undefined) setProportion(String(restored.proportion));
        if (restored.responseRate !== undefined) setResponseRate(String(restored.responseRate));
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={report}
      exportName="sample-size.txt"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'sample', label: 'How many responses' }, { value: 'error', label: 'What error will I get' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Confidence level">
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {CONFIDENCE.map((option) => <option key={option.value} value={option.value}>{option.value}% · z {option.z}</option>)}
          </select>
        </Field>
        <Field label="Margin of error, ±%"><input value={error} onChange={(e) => setError(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Population size, 0 for unlimited"><input value={population} onChange={(e) => setPopulation(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Expected proportion, %"><input value={proportion} onChange={(e) => setProportion(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Field label="Response rate, %">
        <input value={responseRate} onChange={(e) => setResponseRate(e.target.value)} inputMode="decimal" className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={mode === 'sample' ? 'Responses needed' : 'Margin of error at this sample'}
          value={mode === 'sample' ? result.required.toLocaleString() : '±' + result.marginFor(Math.max(1, Number(population) || 1000)).toFixed(2)}
          unit={mode === 'sample' ? 'responses' : '%'}
          sub={mode === 'sample'
            ? 'At a ' + (result.rate * 100).toFixed(0) + '% response rate that means sending about ' + result.invitations.toLocaleString() + ' invitations. A 50% proportion is the most conservative assumption and covers any answer between 30% and 70%.'
            : 'With the sample size in the population field, this is the error you should expect at that many responses, before any weighting or non-response bias.'}
        />
        <Ring
          value={result.populationSize ? result.populationShare : 100}
          max={100}
          label={result.populationSize ? 'Share of the population needed' : 'Unlimited population assumed'}
          sub={result.populationSize ? result.required.toLocaleString() + ' of ' + result.populationSize.toLocaleString() + ' people is ' + result.populationShare.toFixed(1) + '%' : 'For a small population the correction below matters more than the formula itself'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Margin of error at each sample size</div>
          <Bars data={result.curve} format={(value) => value.toFixed(1)} suffix="%" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The curve flattens fast. Going from {result.loose} to {result.tight} responses buys a few points of precision, and the next doubling buys far less. Precision is
            bought with diminishing returns.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Working and implications</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Confidence</span><span>{result.confidenceLabel}% · z {result.z}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Proportion used</span><span>{(result.p * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Unlimited-population sample</span><span>{Math.ceil(result.infinite).toLocaleString()}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">After the correction</span><span className="text-cyan-j">{result.required.toLocaleString()}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Invitations to send</span><span className="text-cyan-j">{result.invitations.toLocaleString()}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">A quarter of the sample</span><span>±{result.marginFor(result.halfSample).toFixed(2)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Four times the sample</span><span>±{result.marginFor(result.doubleSample).toFixed(2)}%</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Margin at 20% of the sample</span><span className="text-cyan-j">±{result.subsampleMargin.toFixed(2)}%</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Responses" value={result.required.toLocaleString()} mono />
        <Stat label="Invitations" value={result.invitations.toLocaleString()} mono sub={(result.rate * 100).toFixed(0) + '% response'} />
        <Stat label="Margin" value={'±' + (result.margin * 100).toFixed(1) + '%'} mono sub={result.confidenceLabel + '% confidence'} />
        <Stat label="Subgroups" value={'±' + result.subsampleMargin.toFixed(1) + '%'} mono sub="at a fifth of the sample" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Rules that save months of work</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The margin of error halves when the sample quadruples. Wanting ±2% instead of ±4% means four times the fieldwork, not twice.</p>
            <p>· A sample of about 1,000 gives roughly ±3% at 95% confidence for any large population. That is where the familiar number comes from.</p>
            <p>· The finite population correction only matters for small populations. Above about 20,000 people it changes almost nothing.</p>
            <p>· A 50% proportion gives the worst case and the widest error. If you genuinely expect 90% agreement, you can sample far fewer people for the same precision.</p>
            <p>· {result.subsampleMargin > 20 ? 'Any subgroup you look at will be much weaker than the headline figure — a fifth of the sample gives ±' + result.subsampleMargin.toFixed(0) + '%, which is barely a signal.' : 'Subgroup analysis is still weaker than the headline, since the error grows with the square root of the smaller group.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the maths stops being enough</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The formula assumes a random sample. An open link shared on social media is not one, and no sample size fixes that.</p>
            <p>· Non-response bias usually dominates sampling error. The people who did not answer are different in ways the margin says nothing about.</p>
            <p>· Question wording moves results far more than a couple of percentage points of error. Pilot the questions before worrying about the sample.</p>
            <p>· Weighting to match a known population is often necessary, and it widens the effective error beyond the raw figure.</p>
            <p>· Report the response rate, the field dates and the exact question alongside the margin. A percentage without those is not interpretable.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Responses', value: result.required.toLocaleString() },
                { label: 'Invitations', value: result.invitations.toLocaleString() },
                { label: 'Margin', value: '±' + (result.margin * 100).toFixed(1) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>n = z² × p(1 − p) ÷ e²</p>
          <p>finite population corrected n = n ÷ (1 + (n − 1) ÷ N)</p>
          <p>margin of error for a sample = z × √(p(1 − p) ÷ n)</p>
          <p>invitations = n ÷ response rate</p>
          <p className="text-cyan-j">Here: {result.z}² × {result.p.toFixed(2)} × {1 - result.p > 0 ? (1 - result.p).toFixed(2) : '0.00'} ÷ {result.margin.toFixed(3)}² = {Math.ceil(result.infinite).toLocaleString()}{result.populationSize ? ', corrected to ' + result.required.toLocaleString() : ''}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is the standard formula for estimating a single proportion in a simple random sample. It says nothing about whether your sample is actually random, which is
          the assumption that matters most in practice and the one no calculator can check for you.
        </p>
      </Panel>
    </ToolShell>
  );
}