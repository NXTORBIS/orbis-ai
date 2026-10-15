import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const FREQUENCIES = [
  { id: '1', label: 'Annual', perYear: 1 },
  { id: '2', label: 'Semi-annual', perYear: 2 },
  { id: '4', label: 'Quarterly', perYear: 4 },
  { id: '12', label: 'Monthly', perYear: 12 },
];

export default function BondYield() {
  const [face, setFace] = useState('1000');
  const [coupon, setCoupon] = useState('5');
  const [price, setPrice] = useState('950');
  const [years, setYears] = useState('10');
  const [frequency, setFrequency] = useState('2');
  const [settlement, setSettlement] = useState('0.5');
  const [taxRate, setTaxRate] = useState('20');
  const [inflation, setInflation] = useState('2.5');
  const [rating, setRating] = useState('BBB');
  const [extra, setExtra] = useState({ callable: false, accrued: true, compare: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const f = Math.max(1, Number(face) || 1000);
    const cRate = Math.max(0, Number(coupon) || 0) / 100;
    const p = Math.max(1, Number(price) || 100);
    const n = Math.max(0.25, Number(years) || 1);
    const freq = (FREQUENCIES.find((entry) => entry.id === frequency) || FREQUENCIES[1]).perYear;
    const accruedDays = extra.accrued ? Math.max(0, Number(settlement) || 0) : 0;
    const tax = Math.min(60, Math.max(0, Number(taxRate) || 0)) / 100;
    const infl = Math.max(0, Number(inflation) || 0) / 100;

    const couponPerPeriod = (f * cRate) / freq;
    const periods = Math.max(1, Math.round(n * freq));

    const priceFromYield = (y) => {
      const perPeriod = y / freq;
      let total = 0;
      for (let i = 1; i <= periods; i += 1) {
        total += couponPerPeriod / Math.pow(1 + perPeriod, i);
      }
      total += f / Math.pow(1 + perPeriod, periods);
      return total;
    };

    // Solve for yield by bisection: robust, and fast enough for a slider.
    let low = -0.9;
    let high = 2;
    let ytm = 0;
    for (let i = 0; i < 80; i += 1) {
      const mid = (low + high) / 2;
      const value = priceFromYield(mid);
      if (value > p) low = mid; else high = mid;
      ytm = mid;
    }
    const ytmPercent = ytm * 100;
    const currentYield = ((f * cRate) / p) * 100;
    const annualCoupon = f * cRate;
    const accrued = (couponPerPeriod * (accruedDays / (1 / freq))) * (extra.accrued ? 1 : 0);
    const dirty = p + accrued;

    // Duration and convexity from the cash flow schedule.
    let weighted = 0;
    let totalPv = 0;
    let convexity = 0;
    for (let i = 1; i <= periods; i += 1) {
      const pv = couponPerPeriod / Math.pow(1 + ytm / freq, i);
      const time = i / freq;
      weighted += pv * time;
      convexity += (pv * time * (time + 1 / freq)) / Math.pow(1 + ytm / freq, 2);
      totalPv += pv;
    }
    const finalPv = f / Math.pow(1 + ytm / freq, periods);
    const totalPvFull = totalPv + finalPv;
    weighted += finalPv * n;
    const macaulay = weighted / Math.max(1, totalPvFull);
    const modified = macaulay / (1 + ytm / freq);
    const convexityValue = convexity / Math.max(1, totalPvFull);

    const priceUp1 = priceFromYield(ytm + 0.01);
    const priceDown1 = priceFromYield(ytm - 0.01);
    const durationEstimate = p * (1 - modified * 0.01);
    const dollarDuration = modified * p * 0.0001;

    const totalCoupons = couponPerPeriod * periods;
    const capitalGain = f - p;
    const pretaxReturn = totalCoupons + capitalGain;
    const afterTax = totalCoupons * (1 - tax) + capitalGain * (1 - tax * 0.6);
    const afterTaxYield = (afterTax / p / n) * 100;
    const realYield = ((1 + ytmPercent / 100) / (1 + infl) - 1) * 100;

    const ladder = [0, 1, 2, 3, 4, 5].map((step) => {
      const y = ytm + (step - 2.5) * 0.0075;
      return { label: (y * 100).toFixed(1) + '%', value: Number(priceFromYield(y).toFixed(1)) };
    });

    const cashflow = [];
    for (let year = 1; year <= Math.min(15, Math.ceil(n)); year += 1) {
      cashflow.push({ label: 'Y' + year, value: Number((annualCoupon * (year < Math.ceil(n) ? 1 : 1) + (year === Math.ceil(n) ? f : 0)).toFixed(0)) });
    }

    const riskSpread = { AAA: 0.4, AA: 0.6, A: 0.9, BBB: 1.4, BB: 2.6, B: 4.2 }[rating] || 1.4;

    const warnings = [];
    if (p > f) warnings.push('The bond trades at a premium to face value, so part of the yield is a return of capital as it pulls to par at maturity.');
    if (p < f * 0.85) warnings.push('A price this far below par usually means either a high market yield or genuine credit concern. Check which before assuming the discount is free money.');
    if (ytm < infl) warnings.push('Yield of ' + ytmPercent.toFixed(2) + '% is below inflation of ' + (infl * 100).toFixed(1) + '%, so the real return is negative — you are being paid to lose purchasing power.');
    if (n > 15 && modified > 8) warnings.push('Modified duration of ' + modified.toFixed(1) + ' means a 1% rise in yields knocks about ' + (modified).toFixed(1) + '% off the price. Long bonds are rate bets.');
    if (extra.callable) warnings.push('A callable bond gets redeemed when yields fall, which caps exactly the upside you were being paid for. Yield to call matters more than yield to maturity here.');
    if (rating === 'B' || rating === 'BB') warnings.push('Sub-investment-grade credit. The spread compensates for real default risk, and recovery is never the full face value.');
    if (tax > 0.3) warnings.push('At a ' + Math.round(tax * 100) + '% tax rate the coupon is heavily reduced in hand. Municipal or tax-sheltered wrappers often beat a higher headline yield.');

    const report = [
      'BOND YIELD AND RISK',
      'Face value ' + f.toFixed(0) + ', coupon ' + (cRate * 100).toFixed(3) + '%, price ' + p.toFixed(3) + ', ' + n.toFixed(1) + ' years, ' + (FREQUENCIES.find((entry) => entry.id === frequency) || FREQUENCIES[1]).label + ' coupons',
      '',
      'Coupon per period: ' + couponPerPeriod.toFixed(3) + ' across ' + periods + ' periods',
      'Current yield: ' + currentYield.toFixed(3) + '%',
      'Yield to maturity: ' + ytmPercent.toFixed(3) + '%',
      'After-tax yield: ' + afterTaxYield.toFixed(3) + '%',
      'Real yield after ' + (infl * 100).toFixed(1) + '% inflation: ' + realYield.toFixed(3) + '%',
      '',
      'Macaulay duration: ' + macaulay.toFixed(2) + ' years',
      'Modified duration: ' + modified.toFixed(2),
      'Convexity: ' + convexityValue.toFixed(2),
      'Dollar duration per basis point: ' + dollarDuration.toFixed(4),
      '',
      'Total coupons over life: ' + totalCoupons.toFixed(2),
      'Capital gain or loss at maturity: ' + capitalGain.toFixed(2),
      'Total pretax return: ' + pretaxReturn.toFixed(2) + ' (' + ((pretaxReturn / p) * 100).toFixed(2) + '% of cost)',
      'Rating ' + rating + ', indicative spread about ' + riskSpread.toFixed(2) + '%',
      extra.accrued ? 'Accrued interest: ' + accrued.toFixed(3) + ', dirty price ' + dirty.toFixed(3) : 'Clean price only',
      '',
      'Price at 1% lower yield: ' + priceDown1.toFixed(2) + ' (duration estimate ' + (p * (1 + modified * 0.01)).toFixed(2) + ')',
      'Price at 1% higher yield: ' + priceUp1.toFixed(2) + ' (duration estimate ' + durationEstimate.toFixed(2) + ')',
    ].join('\n');

    return {
      f, cRate, p, n, freq, accrued, dirty, ytm, ytmPercent, currentYield, couponPerPeriod, periods, macaulay, modified,
      convexityValue, dollarDuration, priceUp1, priceDown1, durationEstimate, totalCoupons, capitalGain, pretaxReturn,
      afterTax, afterTaxYield, realYield, ladder, cashflow, riskSpread, warnings, report, infl, tax, rating,
    };
  }, [face, coupon, price, years, frequency, settlement, taxRate, inflation, rating, extra]);

  return (
    <ToolShell
      toolId="bond-yield"
      icon={Landmark}
      title="Bond Yield, Duration & Price"
      desc="Price and coupon into yield to maturity, after-tax and real yield, Macaulay and modified duration and convexity — with what a 1% rate move does to the price."
      state={{ face, coupon, price, years, frequency, settlement, taxRate, inflation, rating, extra }}
      onRestore={(restored) => {
        const map = { face: setFace, coupon: setCoupon, price: setPrice, years: setYears, settlement: setSettlement, taxRate: setTaxRate, inflation: setInflation };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.frequency) setFrequency(restored.frequency);
        if (restored.rating) setRating(restored.rating);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="bond-yield.txt"
    >
      <Seg value={frequency} onChange={setFrequency} options={FREQUENCIES.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Face value"><input value={face} onChange={(e) => setFace(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Coupon rate, %"><input value={coupon} onChange={(e) => setCoupon(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Clean price"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Years to maturity"><input value={years} onChange={(e) => setYears(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Days since last coupon"><input value={settlement} onChange={(e) => setSettlement(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Tax rate, %"><input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inflation, %"><input value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Credit rating">
          <select value={rating} onChange={(e) => setRating(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {['AAA', 'AA', 'A', 'BBB', 'BB', 'B'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Include accrued interest" checked={extra.accrued} onChange={() => toggle('accrued')} hint="Clean versus dirty price" />
        <ToggleRow label="Callable bond" checked={extra.callable} onChange={() => toggle('callable')} />
        <ToggleRow label="Show rate sensitivity" checked={extra.compare} onChange={() => toggle('compare')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Bond at ' + result.p.toFixed(2) + ' with a ' + (result.cRate * 100).toFixed(2) + '% coupon'}
          value={result.ytmPercent.toFixed(2)}
          unit="% YTM"
          sub={'Current yield is ' + result.currentYield.toFixed(2) + '% and the real return after ' + (result.infl * 100).toFixed(1) + '% inflation is ' + result.realYield.toFixed(2) + '%. Modified duration is ' + result.modified.toFixed(2) + ', so a one percentage point move in yields shifts the price by roughly ' + result.modified.toFixed(1) + '%.'}
        />
        <Ring
          value={Math.round(Math.min(100, result.modified * 8))}
          max={100}
          label="Interest-rate risk"
          sub={result.modified.toFixed(2) + ' years modified duration'}
          unit="%"
          tone={result.modified > 8 ? 'rose' : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Price across the yield curve</div>
          <Bars data={result.ladder} suffix="" format={(v) => v.toFixed(1)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The curve is convex: gains from falling yields slightly exceed losses from rising ones. That convexity is the one thing a bond holder gets for free.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Yield and risk summary</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Yield to maturity</span><span className="text-cyan-j">{result.ytmPercent.toFixed(3)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Current yield</span><span>{result.currentYield.toFixed(3)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">After tax</span><span>{result.afterTaxYield.toFixed(3)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Real yield</span><span className={result.realYield < 0 ? 'text-rose-400' : ''}>{result.realYield.toFixed(3)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Macaulay duration</span><span>{result.macaulay.toFixed(2)} yr</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Modified duration</span><span>{result.modified.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Convexity</span><span>{result.convexityValue.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Dollar duration</span><span>{result.dollarDuration.toFixed(4)} per bp</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Dirty price</span><span>{result.dirty.toFixed(3)}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Total coupons', value: result.totalCoupons.toFixed(0) },
                { label: 'Capital gain', value: result.capitalGain.toFixed(2), tone: result.capitalGain < 0 ? 'rose' : undefined },
                { label: 'Spread', value: result.riskSpread.toFixed(2) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Rate sensitivity</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Scenario</th><th className="py-1 text-right">Full repricing</th><th className="py-1 text-right">Duration only</th><th className="py-1 pr-2 text-right">Difference</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40">
                  <td className="py-1 pl-2">Yields −1%</td>
                  <td className="py-1 text-right text-cyan-j">{result.priceDown1.toFixed(2)}</td>
                  <td className="py-1 text-right">{(result.p * (1 + result.modified * 0.01)).toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{(result.priceDown1 - result.p * (1 + result.modified * 0.01)).toFixed(2)}</td>
                </tr>
                <tr className="border-t border-border/40">
                  <td className="py-1 pl-2">Yields +1%</td>
                  <td className="py-1 text-right text-rose-400">{result.priceUp1.toFixed(2)}</td>
                  <td className="py-1 text-right">{result.durationEstimate.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{(result.priceUp1 - result.durationEstimate).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Duration is a straight line through a curved relationship. The difference column is convexity doing its work, and it grows quickly on long maturities.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Cash flow per year</div>
          <Bars data={result.cashflow} suffix="" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The final bar carries both the last coupon and the returned face value, which is why duration sits well below the maturity date on a coupon-paying bond.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Yield to maturity" value={result.ytmPercent.toFixed(2) + '%'} mono sub="annualised" />
        <Stat label="Modified duration" value={result.modified.toFixed(2)} mono sub="years" />
        <Stat label="Real yield" value={result.realYield.toFixed(2) + '%'} mono sub="after inflation" />
        <Stat label="Total return" value={result.pretaxReturn.toFixed(0)} mono sub="coupons plus par" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Risk notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Full analysis</div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What moves a bond price</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Yield and price move in opposite directions, always. There is no bond where both rise together, whatever the marketing says.</p>
            <p>· Duration is the sensitivity; maturity is only its main input. A long bond with a big coupon has a shorter duration than a zero-coupon bond of the same maturity.</p>
            <p>· Credit spread widening hurts a corporate bond exactly as a rate rise does. Watching only the policy rate misses half the risk.</p>
            <p>· Inflation erodes a fixed coupon invisibly. A bond yielding 4% with inflation at 5% is a guaranteed real loss, no matter how safe the issuer.</p>
            <p>· Pull to par means a bond bought at a discount and held to maturity delivers its yield only if it is held, not traded.</p>
            <p>· Callable bonds cap the upside that convexity provides — the issuer takes the good outcome and leaves you the bad one.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Indicative credit spreads</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Rating</th><th className="py-1 text-right">Typical spread</th><th className="py-1 pr-2 text-left">Meaning</th></tr>
              </thead>
              <tbody>
                {[['AAA', 0.4, 'Highest quality'], ['AA', 0.6, 'Very strong'], ['A', 0.9, 'Strong'], ['BBB', 1.4, 'Lowest investment grade'], ['BB', 2.6, 'Speculative'], ['B', 4.2, 'High risk']].map(([label, spread, note]) => (
                  <tr key={label} className={`border-t border-border/40 ${label === result.rating ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{label}</td>
                    <td className="py-1 text-right">{spread}%</td>
                    <td className="py-1 pr-2">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Spreads widen sharply in a downturn, which is exactly when a portfolio most needs to sell. That is why credit risk is not the same thing as credit rating.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Yield to maturity is solved numerically from the price you enter; duration and convexity come from the actual cash flow schedule. Day-count conventions, settlement rules and accrued interest
          differ between markets and issuers, so use this as an analytical estimate rather than a settlement figure.
        </p>
      </Panel>
    </ToolShell>
  );
}