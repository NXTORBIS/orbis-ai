import { useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CONFIDENCE = [
  { value: '90', label: '90% · z 1.645', z: 1.645 },
  { value: '95', label: '95% · z 1.960', z: 1.96 },
  { value: '99', label: '99% · z 2.576', z: 2.576 },
];

const erf = (x) => {
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absolute);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absolute * absolute);
  return sign * y;
};

const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export default function AbTestCalculator() {
  const [a, setA] = useState({ visitors: '5200', conversions: '312' });
  const [b, setB] = useState({ visitors: '5250', conversions: '361' });
  const [confidence, setConfidence] = useState('95');
  const [tails, setTails] = useState('two');
  const [daily, setDaily] = useState('400');

  const result = useMemo(() => {
    const entry = CONFIDENCE.find((option) => option.value === confidence) || CONFIDENCE[1];
    const n1 = Math.max(0, Number(a.visitors) || 0);
    const c1 = Math.max(0, Number(a.conversions) || 0);
    const n2 = Math.max(0, Number(b.visitors) || 0);
    const c2 = Math.max(0, Number(b.conversions) || 0);

    const p1 = n1 ? c1 / n1 : 0;
    const p2 = n2 ? c2 / n2 : 0;
    const difference = p2 - p1;
    const pooled = n1 + n2 ? (c1 + c2) / (n1 + n2) : 0;
    const standardErrorPooled = Math.sqrt(pooled * (1 - pooled) * (n1 ? 1 / n1 : 0) + (n2 ? 1 / n2 : 0));
    const standardErrorFree = Math.sqrt((n1 ? (p1 * (1 - p1)) / n1 : 0) + (n2 ? (p2 * (1 - p2)) / n2 : 0));
    const z = standardErrorPooled ? difference / standardErrorPooled : 0;
    const pValue = tails === 'two' ? 2 * (1 - normalCdf(Math.abs(z))) : 1 - normalCdf(z);
    const significant = pValue < 1 - entry.z / 2.6;
    const relativeLift = p1 ? difference / p1 : 0;

    const margin = entry.z * standardErrorFree;
    const lowDifference = difference - margin;
    const highDifference = difference + margin;

    const beta = 0.8416;
    const delta = Math.abs(difference);
    const required = delta > 0 && pooled > 0
      ? Math.ceil((2 * Math.pow(entry.z + beta, 2) * pooled * (1 - pooled)) / Math.pow(delta, 2))
      : 0;
    const perVariantDaily = Math.max(0, Number(daily) || 0);
    const daysNeeded = perVariantDaily > 0 && required > 0 ? Math.ceil(required / perVariantDaily) : 0;
    const hasEnough = n1 >= required && n2 >= required && required > 0;

    const lift = relativeLift * 100;
    const verdict = !delta
      ? 'No difference at all between the two.'
      : hasEnough
        ? 'Significant: ' + (difference > 0 ? 'B' : 'A') + ' wins by ' + Math.abs(lift).toFixed(1) + '% relative, with a ' + confidence + '% confidence result.'
        : 'Not enough traffic yet: about ' + required.toLocaleString() + ' visitors per variant would be needed to call this.';

    return {
      entry, n1, c1, n2, c2, p1, p2, difference, relativeLift, z, pValue, significant, margin, lowDifference, highDifference,
      required, daysNeeded, hasEnough, verdict, pooled, standardErrorFree, standardErrorPooled,
      chart: [
        { label: 'A', value: Number((p1 * 100).toFixed(2)) },
        { label: 'B', value: Number((p2 * 100).toFixed(2)) },
      ],
    };
  }, [a, b, confidence, tails, daily]);

  const report = useMemo(() => [
    'Variant A: ' + result.c1 + ' of ' + result.n1 + ' = ' + (result.p1 * 100).toFixed(2) + '%',
    'Variant B: ' + result.c2 + ' of ' + result.n2 + ' = ' + (result.p2 * 100).toFixed(2) + '%',
    '',
    'Absolute difference: ' + (result.difference * 100).toFixed(2) + ' percentage points',
    'Relative lift: ' + (result.relativeLift * 100).toFixed(2) + '%',
    'z score: ' + result.z.toFixed(3),
    'p value: ' + result.pValue.toFixed(4) + ' (' + (result.pValue < 0.001 ? 'below 0.001' : 'exact') + ')',
    'Confidence ' + confidence + '%, ' + (tails === 'two' ? 'two' : 'one') + '-tailed',
    result.significant ? 'Result: statistically significant' : 'Result: not yet significant',
    '',
    'Confidence interval for the difference: ' + (result.lowDifference * 100).toFixed(2) + ' to ' + (result.highDifference * 100).toFixed(2) + ' percentage points',
    'Sample size for 80% power at this effect: ' + result.required.toLocaleString() + ' per variant',
    'At ' + daily + ' visitors per variant a day: about ' + result.daysNeeded + ' more days',
    '',
    result.verdict,
  ].join('\n'), [result, confidence, tails, daily]);

  return (
    <ToolShell
      toolId="ab-test-calculator"
      icon={Gauge}
      title="A/B Test Significance Calculator"
      desc="Two variants into a real significance test — rates, lift, z score, p value, a confidence interval and the sample size you still need before calling it."
      state={{ a, b, confidence, tails, daily }}
      onRestore={(restored) => {
        if (restored.a) setA((current) => ({ ...current, ...restored.a }));
        if (restored.b) setB((current) => ({ ...current, ...restored.b }));
        if (restored.confidence) setConfidence(restored.confidence);
        if (restored.tails) setTails(restored.tails);
        if (restored.daily !== undefined) setDaily(String(restored.daily));
      }}
      exportText={report}
      exportName="ab-test.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Variant A · control</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Visitors"><input value={a.visitors} onChange={(e) => setA((current) => ({ ...current, visitors: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Conversions"><input value={a.conversions} onChange={(e) => setA((current) => ({ ...current, conversions: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <p className="mt-2 font-mono-j text-[11px] text-muted-foreground">Rate {(result.p1 * 100).toFixed(2)}%</p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Variant B · challenger</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Visitors"><input value={b.visitors} onChange={(e) => setB((current) => ({ ...current, visitors: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Conversions"><input value={b.conversions} onChange={(e) => setB((current) => ({ ...current, conversions: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <p className="mt-2 font-mono-j text-[11px] text-muted-foreground">Rate {(result.p2 * 100).toFixed(2)}%</p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Confidence level">
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {CONFIDENCE.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Test type">
          <Seg value={tails} onChange={setTails} options={[{ value: 'two', label: 'Two-tailed' }, { value: 'one', label: 'One-tailed' }]} />
        </Field>
        <Field label="Visitors per variant per day"><input value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.significant ? 'emerald' : 'amber'}
          label={result.significant ? 'Lift, and significant' : 'Lift, not yet significant'}
          value={(result.relativeLift * 100).toFixed(1)}
          unit="%"
          sub={result.verdict + ' The absolute difference is ' + (result.difference * 100).toFixed(2) + ' percentage points, with a p value of ' + result.pValue.toFixed(4) + '.'}
        />
        <Ring
          value={Math.min(100, Math.max(0, (1 - result.pValue) * 100))}
          max={100}
          tone={result.significant ? 'emerald' : 'amber'}
          label="Confidence in the result"
          sub={(1 - result.pValue) * 100 > 99.9 ? 'Above 99.9% confident the difference is real' : ((1 - result.pValue) * 100).toFixed(2) + '% confident the difference is real'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Conversion rates</div>
          <Bars data={result.chart} format={(value) => value.toFixed(2)} suffix="%" highlightLast />
          <div className="mt-2 space-y-1 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Absolute difference</span><span>{(result.difference * 100).toFixed(3)} pp</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Relative lift</span><span>{(result.relativeLift * 100).toFixed(2)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">95% interval, low</span><span>{(result.lowDifference * 100).toFixed(2)} pp</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">95% interval, high</span><span>{(result.highDifference * 100).toFixed(2)} pp</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            If the interval crosses zero, the direction of the effect is still uncertain even when the point estimate looks convincing. That is the single most common way a
            test gets called too early.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The statistics</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pooled rate</span><span>{(result.pooled * 100).toFixed(2)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Standard error</span><span>{result.standardErrorFree.toFixed(5)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">z score</span><span>{result.z.toFixed(3)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">p value</span><span className="text-cyan-j">{result.pValue < 0.0001 ? 'below 0.0001' : result.pValue.toFixed(4)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Significant</span><span className={result.significant ? 'text-emerald-300' : 'text-amber-300'}>{result.significant ? 'yes' : 'not yet'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Sample needed per variant</span><span>{result.required.toLocaleString()}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Visitors so far</span><span>{result.n1} / {result.n2}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Extra days needed</span><span className="text-cyan-j">{result.hasEnough ? 'none' : String(result.daysNeeded)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Rate A" value={(result.p1 * 100).toFixed(2) + '%'} mono sub={result.c1 + ' of ' + result.n1} />
        <Stat label="Rate B" value={(result.p2 * 100).toFixed(2) + '%'} mono sub={result.c2 + ' of ' + result.n2} />
        <Stat label="Relative lift" value={(result.relativeLift * 100).toFixed(1) + '%'} mono sub={result.significant ? 'significant' : 'not yet'} />
        <Stat label="p value" value={result.pValue < 0.0001 ? '<0.0001' : result.pValue.toFixed(4)} mono sub={confidence + '% confidence'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Running a test that is actually worth trusting</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Decide the sample size before you start, then do not look at the result until it is reached. Checking daily and stopping when it first goes green roughly doubles the false positive rate.</p>
            <p>· Run for whole weeks. Weekday and weekend traffic behave differently, and a two-day test measures the weekday.</p>
            <p>· Change one thing. A test with a new headline, image and colour tells you nothing about which one worked.</p>
            <p>· A result that is significant but tiny is not worth shipping. Ask whether a {Math.abs(result.relativeLift * 100).toFixed(1)}% change is worth the maintenance of a second variant.</p>
            <p>· Segment afterwards, not before. Slicing until something looks significant is how noise becomes a roadmap decision.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How the maths is put together</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>p = conversions ÷ visitors for each variant</p>
            <p>pooled p = (c₁ + c₂) ÷ (n₁ + n₂)</p>
            <p>SE = √(p(1−p)(1/n₁ + 1/n₂)) with p pooled</p>
            <p>z = (p₂ − p₁) ÷ SE, then p value from the normal distribution</p>
            <p>interval = difference ± z_critical × SE, using the unpooled error</p>
            <p>sample = 2(z + 0.84)² × p(1−p) ÷ Δ² for 80% power</p>
            <p className="text-cyan-j">Here z = {result.z.toFixed(3)}, which gives a p value of {result.pValue.toFixed(4)}.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the numbers correctly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A p value of 0.03 does not mean a 97% chance that B is better. It means a difference this large would appear three times in a hundred if the two variants were identical.</p>
            <p>· Confidence intervals say more than p values: the interval above is the range of real effects consistent with your data.</p>
            <p>· Two-tailed is the honest default. One-tailed tests need a strong prior reason to look in only one direction, decided before the data arrives.</p>
            <p>· Statistical significance and business significance are different questions. A 0.2 percentage point lift on millions of visitors can be real and still irrelevant.</p>
            <p>· Low traffic suits bigger changes. Testing a button label on a few thousand visitors is a test that will never finish.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Practical planning</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· To detect a smaller effect you need disproportionately more traffic: halving the effect you want to detect roughly quadruples the sample.</p>
            <p>· At {daily} visitors per variant a day, this test needs {result.daysNeeded} more days to reach 80% power.</p>
            <p>· Round the required sample up and give it a buffer for bots, internal traffic and duplicate visitors.</p>
            <p>· If the required traffic is unrealistic, test a bolder change rather than waiting months for a small one to surface.</p>
            <p>· Record the decision along with the result, including the ones that did not win. Half the value of testing is the knowledge of what already failed.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Lift', value: (result.relativeLift * 100).toFixed(1) + '%' },
                { label: 'p value', value: result.pValue < 0.0001 ? '<0.0001' : result.pValue.toFixed(3) },
                { label: 'Needed', value: result.required.toLocaleString() },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is a two-proportion z test, the standard method for conversion comparisons, with the normal distribution evaluated to six decimal places. It assumes
          independent visitors and random assignment, which is exactly what breaks when the same person is counted twice or when traffic sources differ between variants.
        </p>
      </Panel>
    </ToolShell>
  );
}