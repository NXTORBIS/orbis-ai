import { useMemo, useState } from 'react';
import { Wallet, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const DEFAULT_BANDS = [
  { id: 'b1', upTo: '12570', rate: '0' },
  { id: 'b2', upTo: '50270', rate: '20' },
  { id: 'b3', upTo: '125140', rate: '40' },
  { id: 'b4', upTo: '', rate: '45' },
];

const money = (value, currency) => currency + Math.round(value).toLocaleString();

export default function NetPayCalculator() {
  const [gross, setGross] = useState('62000');
  const [frequency, setFrequency] = useState('annual');
  const [currency, setCurrency] = useState('$');
  const [bands, setBands] = useState(DEFAULT_BANDS);
  const [pension, setPension] = useState('5');
  const [employerMatch, setEmployerMatch] = useState('3');
  const [socialRate, setSocialRate] = useState('6.2');
  const [otherDeductions, setOtherDeductions] = useState('0');
  const [sacrifice, setSacrifice] = useState(true);

  const setBand = (id, key, value) => setBands((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const multiplier = frequency === 'monthly' ? 12 : frequency === 'weekly' ? 52 : 1;
    const annualGross = Math.max(0, (Number(gross) || 0) * multiplier);
    const pensionRate = Math.max(0, Math.min(60, Number(pension) || 0)) / 100;
    const matchRate = Math.max(0, Math.min(30, Number(employerMatch) || 0)) / 100;
    const socialPercent = Math.max(0, Math.min(30, Number(socialRate) || 0)) / 100;
    const extras = Math.max(0, (Number(otherDeductions) || 0) * multiplier);

    const pensionAnnual = annualGross * pensionRate;
    const effectivePension = sacrifice ? pensionAnnual : 0;
    const taxable = Math.max(0, annualGross - effectivePension);

    const parsedBands = bands
      .map((row) => ({ id: row.id, upTo: row.upTo === '' ? Infinity : Math.max(0, Number(row.upTo) || 0), rate: Math.max(0, Math.min(90, Number(row.rate) || 0)) / 100 }))
      .sort((a, b) => a.upTo - b.upTo);

    let lower = 0;
    let tax = 0;
    const bandRows = [];
    parsedBands.forEach((band) => {
      const upper = band.upTo;
      const slice = Math.max(0, Math.min(taxable, upper) - lower);
      const due = slice * band.rate;
      tax += due;
      if (upper === Infinity) {
        bandRows.push({ label: band.rate ? Math.round(band.rate * 100) + '% and above' : 'no tax', value: Number(due.toFixed(0)), slice: Number(slice.toFixed(0)), rate: band.rate });
      } else {
        bandRows.push({ label: Math.round(band.rate * 100) + '% up to ' + Math.round(upper / 1000) + 'k', value: Number(due.toFixed(0)), slice: Number(slice.toFixed(0)), rate: band.rate });
      }
      if (upper === Infinity || upper >= taxable) {
        lower = taxable;
      } else {
        lower = upper;
      }
    });

    const socialBase = sacrifice ? taxable : annualGross;
    const social = socialBase * socialPercent;
    const netAnnual = annualGross - effectivePension - (sacrifice ? 0 : pensionAnnual) - tax - social - extras;
    const netMonthly = netAnnual / 12;
    const netWeekly = netAnnual / 52;
    const takeHome = annualGross ? (netAnnual / annualGross) * 100 : 0;
    const effectiveTaxRate = annualGross ? ((tax + social) / annualGross) * 100 : 0;
    const marginalRate = (() => {
      let rate = 0;
      let cumulative = 0;
      parsedBands.forEach((band) => {
        if (taxable > cumulative) rate = band.rate;
        cumulative = band.upTo;
      });
      return rate * 100 + socialPercent * 100;
    })();

    const employerContribution = annualGross * matchRate;
    const totalPension = effectivePension + (sacrifice ? 0 : pensionAnnual) + employerContribution;
    const breakEvenPensionRate = (() => {
      if (!annualGross) return 0;
      const test = (value) => {
        const pensionValue = annualGross * value;
        const taxableValue = annualGross - pensionValue;
        let taxValue = 0;
        let floor = 0;
        parsedBands.forEach((band) => {
          const slice = Math.max(0, Math.min(taxableValue, band.upTo) - floor);
          taxValue += slice * band.rate;
          floor = band.upTo === Infinity ? taxableValue : band.upTo;
        });
        const socialValue = taxableValue * socialPercent;
        return annualGross - pensionValue - taxValue - socialValue - extras;
      };
      const netToday = annualGross - effectivePension - tax - social - extras;
      for (let rate = 0; rate <= 0.6; rate += 0.005) {
        if (test(rate) > netToday) return rate * 100;
      }
      return null;
    })();

    const sensitivity = [0.9, 0.95, 1, 1.05, 1.1].map((factor) => {
      const scaled = annualGross * factor;
      const scaledTaxable = Math.max(0, scaled - effectivePension * factor);
      let scaledTax = 0;
      let floor = 0;
      parsedBands.forEach((band) => {
        const slice = Math.max(0, Math.min(scaledTaxable, band.upTo) - floor);
        scaledTax += slice * band.rate;
        floor = band.upTo === Infinity ? scaledTaxable : band.upTo;
      });
      const scaledSocial = scaledTaxable * socialPercent;
      return { label: Math.round((factor - 1) * 100) + '%', value: Number(((scaled - scaledTax - scaledSocial - extras - (sacrifice ? scaled * pensionRate : 0)) / 12).toFixed(0)) };
    });

    const deductions = [
      { label: 'Income tax', value: Number(tax.toFixed(0)) },
      { label: 'Social contributions', value: Number(social.toFixed(0)) },
      { label: sacrifice ? 'Pension (salary sacrifice)' : 'Pension', value: Number((sacrifice ? pensionAnnual : pensionAnnual).toFixed(0)) },
      { label: 'Other deductions', value: Number(extras.toFixed(0)) },
    ].filter((entry) => entry.value > 0);

    const report = [
      'Gross ' + money(annualGross, currency) + ' a year',
      'Pension ' + (pensionRate * 100).toFixed(1) + '%' + (sacrifice ? ' by salary sacrifice, so it comes out before tax' : ' from net pay'),
      'Take-home ' + money(netAnnual, currency) + ' a year · ' + money(netMonthly, currency) + ' a month · ' + money(netWeekly, currency) + ' a week',
      'That is ' + takeHome.toFixed(1) + '% of gross, with an effective deduction rate of ' + effectiveTaxRate.toFixed(1) + '% and a marginal rate of ' + marginalRate.toFixed(1) + '%.',
      '',
      'Where the money goes:',
      ...deductions.map((entry) => '  ' + entry.label.padEnd(28, ' ') + money(entry.value, currency)),
      '  Net pay'.padEnd(30, ' ') + money(netAnnual, currency),
      '',
      'Employer pension contribution ' + money(employerContribution, currency) + ', making total retirement saving ' + money(totalPension, currency) + '.',
      breakEvenPensionRate !== null ? 'Contribution rate that maximises take-home here: about ' + breakEvenPensionRate.toFixed(1) + '%.' : '',
    ].join('\n');

    return {
      annualGross, taxable, tax, social, extras, pensionAnnual, netAnnual, netMonthly, netWeekly, takeHome, effectiveTaxRate,
      marginalRate, employerContribution, totalPension, breakEvenPensionRate, sensitivity, bandRows, deductions, report, pensionRate,
      monthlyChart: [
        { label: 'Gross', value: Number((annualGross / 12).toFixed(0)) },
        { label: 'Tax', value: Number((tax / 12).toFixed(0)) },
        { label: 'Social', value: Number((social / 12).toFixed(0)) },
        { label: 'Pension', value: Number((pensionAnnual / 12).toFixed(0)) },
        { label: 'Net', value: Number((netAnnual / 12).toFixed(0)) },
      ],
    };
  }, [gross, frequency, bands, pension, employerMatch, socialRate, otherDeductions, sacrifice]);

  return (
    <ToolShell
      toolId="net-pay"
      icon={Wallet}
      title="Net Pay & Take-Home Calculator"
      desc="Gross salary into real take-home with your own tax bands, pension including salary sacrifice, social contributions and other deductions — plus your marginal rate and the pension rate that maximises pay."
      state={{ gross, frequency, currency, bands, pension, employerMatch, socialRate, otherDeductions, sacrifice }}
      onRestore={(restored) => {
        if (restored.gross !== undefined) setGross(String(restored.gross));
        if (restored.frequency) setFrequency(restored.frequency);
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
        if (Array.isArray(restored.bands) && restored.bands.length) setBands(restored.bands);
        if (restored.pension !== undefined) setPension(String(restored.pension));
        if (restored.employerMatch !== undefined) setEmployerMatch(String(restored.employerMatch));
        if (restored.socialRate !== undefined) setSocialRate(String(restored.socialRate));
        if (restored.otherDeductions !== undefined) setOtherDeductions(String(restored.otherDeductions));
        if (typeof restored.sacrifice === 'boolean') setSacrifice(restored.sacrifice);
      }}
      exportText={result.report}
      exportName="net-pay.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Gross pay"><input value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Paid">
          <Seg value={frequency} onChange={setFrequency} options={[{ value: 'annual', label: 'Per year' }, { value: 'monthly', label: 'Per month' }, { value: 'weekly', label: 'Per week' }]} />
        </Field>
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={sacrifice ? 'Pension, % (salary sacrifice)' : 'Pension, % (from net pay)'}>
          <input value={pension} onChange={(e) => setPension(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Employer pension match, %"><input value={employerMatch} onChange={(e) => setEmployerMatch(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Social contributions, % of gross"><input value={socialRate} onChange={(e) => setSocialRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Other deductions per period"><input value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <ToggleRow label="Pension is salary sacrifice, so it comes out before tax and social contributions" checked={sacrifice} onChange={setSacrifice} />

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Tax bands — enter your own</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{bands.length} bands</span>
        </div>
        <div className="space-y-2">
          {bands.map((row) => {
            const computed = result.bandRows.find((entry) => entry.rate === (Number(row.rate) || 0) / 100);
            return (
              <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
                <Field label="Taxable income up to"><input value={row.upTo} onChange={(e) => setBand(row.id, 'upTo', e.target.value)} inputMode="decimal" placeholder="no limit" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Rate, %"><input value={row.rate} onChange={(e) => setBand(row.id, 'rate', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Tax from this band">
                  <div className="flex h-9 items-center font-mono-j text-[11px] text-muted-foreground">{computed ? money(computed.value, currency) + ' on ' + computed.slice.toLocaleString() : 'no income in this band'}</div>
                </Field>
                <div className="flex items-end">
                  <button type="button" onClick={() => setBands((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setBands((current) => [...current, { id: Math.random().toString(36).slice(2), upTo: '', rate: '0' }])}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a band
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Leave the top band limit empty to mean no upper limit. The bands are illustrative until you put your own in, since thresholds and rates differ by country and year.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone="emerald"
          label="Take-home each month"
          value={money(result.netMonthly, currency)}
          sub={'On ' + money(result.annualGross, currency) + ' gross that is ' + money(result.netAnnual, currency) + ' a year and ' + money(result.netWeekly, currency) + ' a week, or ' + result.takeHome.toFixed(1) + '% of gross. Your marginal rate on the next unit of pay is ' + result.marginalRate.toFixed(1) + '% and your effective rate across everything is ' + result.effectiveTaxRate.toFixed(1) + '%.'}
        />
        <Ring
          value={result.takeHome}
          max={100}
          tone={result.takeHome > 70 ? 'emerald' : result.takeHome > 60 ? 'cyan' : 'amber'}
          label="Kept from gross"
          sub={result.takeHome.toFixed(1) + '% of gross reaches your account'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Your month, before and after</div>
          <Bars data={result.monthlyChart} format={(value) => money(value, currency)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Deductions are not one thing. Income tax, social contributions, pension and everything else each behave differently when your pay changes, which is why the
            marginal rate matters more than the headline rate.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Where the money goes</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Gross</span><span>{money(result.annualGross, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Taxable after pension</span><span>{money(result.taxable, currency)}</span></div>
            {result.deductions.map((entry) => (
              <div key={entry.label} className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">{entry.label}</span><span>−{money(entry.value, currency)}</span></div>
            ))}
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Net per year</span><span className="text-cyan-j">{money(result.netAnnual, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Employer pension added</span><span>{money(result.employerContribution, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Total retirement saving</span><span>{money(result.totalPension, currency)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Marginal rate</span><span>{result.marginalRate.toFixed(1)}%</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Take-home as your pay moves</div>
        <Bars data={result.sensitivity} format={(value) => money(value, currency)} suffix="" highlightLast={false} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          The middle bar is your current monthly net. Notice how much of each increase you keep: at a marginal rate of {result.marginalRate.toFixed(1)}%, a raise of 5% adds far less
          to your account than the percentage suggests.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Gross" value={money(result.annualGross, currency)} mono sub="a year" />
        <Stat label="Net monthly" value={money(result.netMonthly, currency)} mono sub={result.takeHome.toFixed(1) + '% of gross'} />
        <Stat label="Effective rate" value={result.effectiveTaxRate.toFixed(1) + '%'} mono sub="tax and social together" />
        <Stat label="Marginal rate" value={result.marginalRate.toFixed(1) + '%'} mono sub="on the next unit of pay" />
      </div>

      {result.breakEvenPensionRate !== null && (
        <Panel className="!p-3 !border-cyan-j/40">
          <p className="text-[11px] text-muted-foreground">
            · At a marginal rate of {result.marginalRate.toFixed(1)}%, every 1% of gross you put into a salary-sacrifice pension costs about {(100 - result.marginalRate) / 100}% of that
            amount in take-home. Here, contributing up to about <span className="font-mono-j text-cyan-j">{result.breakEvenPensionRate.toFixed(1)}%</span> increases your net pay
            rather than reducing it, because the tax saved exceeds the contribution — and the employer match of {employerMatch}% is added on top.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the result correctly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Marginal rate versus effective rate: your marginal rate decides whether extra hours, overtime or a raise are worth it; your effective rate describes the average.</p>
            <p>· Salary sacrifice reduces taxable pay before tax and often before social contributions too, which is why it is worth more than the same contribution from net pay.</p>
            <p>· Employer contributions are part of your total reward and cost you nothing. Not taking a match is the most expensive mistake on this page.</p>
            <p>· Tax bands are yearly while many payslips are cumulative, so a bonus month can look wrong and then correct itself later in the year.</p>
            <p>· Anything deducted after tax — student loans, benefit repayments, court orders — behaves differently from tax and should go in other deductions.</p>
            <p>· {result.takeHome > 75 ? 'Keeping ' + result.takeHome.toFixed(1) + '% of gross is a healthy position; the next question is whether the pension share is enough for retirement rather than whether it is efficient.' : 'Keeping ' + result.takeHome.toFixed(1) + '% means deductions are doing real work. Check that the pension share is deliberate rather than accidental, since it is the largest single line you control.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What a payslip adds that a calculator cannot</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Cumulative tax and contributions year to date. If tax deducted so far looks wrong, the year-to-date figure tells you how it is being corrected.</p>
            <p>· Tax code or allowance adjustments, which can be a better answer than any band table.</p>
            <p>· Benefits in kind: a company car, private health or a season ticket changes the taxable amount.</p>
            <p>· A bonus, commission or back pay in the same period, which pushes part of the pay into a higher band for that month.</p>
            <p>· Employer costs you never see, such as employer social contributions, which explain why the total cost of employing you is far higher than your gross.</p>
            <p>· Any deduction with an end date — a loan repayment that finishes this year is a raise.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Gross', value: money(result.annualGross, currency) },
                { label: 'Net monthly', value: money(result.netMonthly, currency) },
                { label: 'Marginal', value: result.marginalRate.toFixed(1) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>annual gross = entered pay × pay periods a year</p>
          <p>taxable = gross − pension, when the pension is salary sacrifice</p>
          <p>tax = the sum of each band slice × its rate</p>
          <p>social = taxable × rate (or gross × rate when the pension comes from net pay)</p>
          <p>net = gross − pension − tax − social − other deductions</p>
          <p>marginal rate = the top band rate you touch + the social rate</p>
          <p className="text-cyan-j">Check: {money(result.annualGross, currency)} − {money(result.tax, currency)} tax − {money(result.social, currency)} social − {money(result.pensionAnnual, currency)} pension = {money(result.netAnnual, currency)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is arithmetic on the bands you enter, not tax advice. Real systems include allowances, cumulative adjustments, benefit-in-kind and rules that vary by
          jurisdiction and year — put your own figures in, then check the first payslip against it.
        </p>
      </Panel>
    </ToolShell>
  );
}