import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const money = (value) => Math.round(value).toLocaleString();

export default function RentVsBuy() {
  const [price, setPrice] = useState('400000');
  const [downPct, setDownPct] = useState('15');
  const [rate, setRate] = useState('5.5');
  const [term, setTerm] = useState('30');
  const [tax, setTax] = useState('1.1');
  const [maintenance, setMaintenance] = useState('1');
  const [insurance, setInsurance] = useState('120');
  const [appreciation, setAppreciation] = useState('3');
  const [rent, setRent] = useState('1800');
  const [rentGrowth, setRentGrowth] = useState('3');
  const [horizon, setHorizon] = useState('10');

  const model = useMemo(() => {
    const homePrice = Math.max(0, Number(price) || 0);
    const down = (Number(downPct) || 0) / 100;
    const annualRate = (Number(rate) || 0) / 100;
    const termYears = Math.max(1, Number(term) || 30);
    const taxRate = (Number(tax) || 0) / 100;
    const upkeep = (Number(maintenance) || 0) / 100;
    const insuranceMonthly = Number(insurance) || 0;
    const growth = (Number(appreciation) || 0) / 100;
    const rentMonthly = Number(rent) || 0;
    const rentRise = (Number(rentGrowth) || 0) / 100;
    const years = Math.max(1, Math.min(40, Number(horizon) || 1));

    const downPayment = homePrice * down;
    const loan = Math.max(0, homePrice - downPayment);
    const monthlyRate = annualRate / 12;
    const months = termYears * 12;
    const payment = monthlyRate > 0
      ? (loan * monthlyRate) / (1 - (1 + monthlyRate) ** -months)
      : loan / months;

    let balance = loan;
    let buySpent = downPayment;
    let rentSpent = 0;
    let currentRent = rentMonthly;
    const rows = [];

    for (let year = 1; year <= years; year += 1) {
      for (let month = 0; month < 12; month += 1) {
        if (balance > 0) {
          const interest = balance * monthlyRate;
          balance = Math.max(0, balance + interest - payment);
        }
      }
      const ownedMonths = Math.min(12, months - (year - 1) * 12);
      const paidThisYear = Math.max(0, payment * Math.max(0, ownedMonths)) + insuranceMonthly * 12;
      const carrying = homePrice * taxRate + homePrice * upkeep;
      buySpent += paidThisYear + carrying;
      rentSpent += currentRent * 12;
      const homeValue = homePrice * (1 + growth) ** year;
      const equity = homeValue - balance;
      rows.push({
        year,
        buySpent,
        rentSpent,
        balance,
        homeValue,
        equity,
        netBuy: buySpent - equity,
        netRent: rentSpent,
        rentYear: currentRent,
        payment,
      });
      currentRent = currentRent * (1 + rentRise);
    }

    const last = rows[rows.length - 1];
    const breakEven = rows.find((row) => row.netBuy <= row.netRent) || null;
    const advantage = last.netRent - last.netBuy;
    const upfront = downPayment + homePrice * 0.02;

    return {
      rows, payment, downPayment, loan, upfront, years,
      breakEven, advantage, last,
      monthlyBuy: payment + (homePrice * taxRate) / 12 + (homePrice * upkeep) / 12 + insuranceMonthly,
      ownAtEnd: last.equity / last.homeValue * 100,
      netWorthGap: last.equity - (last.netRent - last.netBuy < 0 ? 0 : 0),
    };
  }, [price, downPct, rate, term, tax, maintenance, insurance, appreciation, rent, rentGrowth, horizon]);

  const report = useMemo(() => [
    'Buying cost about ' + money(model.monthlyBuy) + ' a month all in; renting starts at ' + money(Number(rent) || 0) + '.',
    'Over ' + model.years + ' years the buyer has spent ' + money(model.last.buySpent) + ' and holds ' + money(model.last.equity) + ' of equity.',
    'The renter has spent ' + money(model.last.netRent) + ' and holds none.',
    model.breakEven
      ? 'Buying pulls ahead in year ' + model.breakEven.year + ' and is ' + money(Math.abs(model.advantage)) + ' ' + (model.advantage >= 0 ? 'ahead' : 'behind') + ' at the horizon.'
      : 'Buying never pulls ahead within ' + model.years + ' years on these assumptions.',
    '',
    'Year   buy net cost   rent net cost   equity',
    ...model.rows.map((row) => String(row.year).padStart(4) + '  ' + money(row.netBuy).padStart(12) + '  ' + money(row.netRent).padStart(13) + '  ' + money(row.equity).padStart(9)),
  ].join('\n'), [model, rent]);

  const breakEvenNote = model.breakEven
    ? 'Buying costs less than renting from year ' + model.breakEven.year + ' onward.'
    : 'On these assumptions renting stays cheaper for the whole ' + model.years + ' years.';

  return (
    <ToolShell
      toolId="rent-vs-buy"
      icon={Landmark}
      title="Rent vs Buy Calculator"
      desc="Both paths costed year by year — mortgage, taxes, upkeep, insurance and rent rises — with the break-even year and the equity you would hold at the end."
      state={{ price, downPct, rate, term, tax, maintenance, insurance, appreciation, rent, rentGrowth, horizon }}
      onRestore={(restored) => {
        const keys = ['price', 'downPct', 'rate', 'term', 'tax', 'maintenance', 'insurance', 'appreciation', 'rent', 'rentGrowth', 'horizon'];
        keys.forEach((key) => {
          if (restored[key] !== undefined) {
            if (key === 'price') setPrice(String(restored[key]));
            if (key === 'downPct') setDownPct(String(restored[key]));
            if (key === 'rate') setRate(String(restored[key]));
            if (key === 'term') setTerm(String(restored[key]));
            if (key === 'tax') setTax(String(restored[key]));
            if (key === 'maintenance') setMaintenance(String(restored[key]));
            if (key === 'insurance') setInsurance(String(restored[key]));
            if (key === 'appreciation') setAppreciation(String(restored[key]));
            if (key === 'rent') setRent(String(restored[key]));
            if (key === 'rentGrowth') setRentGrowth(String(restored[key]));
            if (key === 'horizon') setHorizon(String(restored[key]));
          }
        });
      }}
      exportText={report}
      exportName="rent-vs-buy.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Home price">
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={'Deposit · ' + downPct + '%'}>
          <input type="range" min={0} max={50} step={1} value={downPct} onChange={(e) => setDownPct(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Mortgage rate · ' + rate + '%'}>
          <input type="range" min={0} max={12} step={0.1} value={rate} onChange={(e) => setRate(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Term · ' + term + ' years'}>
          <input type="range" min={5} max={40} step={1} value={term} onChange={(e) => setTerm(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Property tax · ' + tax + '% a year'}>
          <input type="range" min={0} max={3} step={0.05} value={tax} onChange={(e) => setTax(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Maintenance · ' + maintenance + '% a year'}>
          <input type="range" min={0} max={3} step={0.05} value={maintenance} onChange={(e) => setMaintenance(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Insurance · ' + insurance + ' a month'}>
          <input type="range" min={0} max={500} step={10} value={insurance} onChange={(e) => setInsurance(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Home appreciation · ' + appreciation + '% a year'}>
          <input type="range" min={-2} max={8} step={0.25} value={appreciation} onChange={(e) => setAppreciation(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Rent now">
          <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={'Rent rises · ' + rentGrowth + '% a year'}>
          <input type="range" min={0} max={10} step={0.25} value={rentGrowth} onChange={(e) => setRentGrowth(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Compare over · ' + horizon + ' years'}>
          <input type="range" min={2} max={40} step={1} value={horizon} onChange={(e) => setHorizon(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="flex items-end">
          <CopyBtn value={report} label="Copy the working" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={model.breakEven ? 'emerald' : 'amber'}
          label={model.breakEven ? 'Buying pulls ahead' : 'Renting stays ahead'}
          value={model.breakEven ? 'Year ' + model.breakEven.year : model.years + ' years'}
          sub={breakEvenNote + ' At the horizon the difference is ' + money(Math.abs(model.advantage)) + ' in favour of ' + (model.advantage >= 0 ? 'buying' : 'renting') + '.'}
        />
        <Ring
          value={model.ownAtEnd}
          max={100}
          label="Of the home you actually own at the end"
          sub={'Equity of ' + money(model.last.equity) + ' against a home worth ' + money(model.last.homeValue)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Monthly cash cost</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Mortgage payment</span>
              <span>{money(model.payment)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Tax + upkeep + insurance</span>
              <span>{money(model.monthlyBuy - model.payment)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
              <span>Buying, all in</span>
              <span className="text-cyan-j">{money(model.monthlyBuy)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Renting today</span>
              <span>{money(Number(rent) || 0)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Renting in year {model.years}</span>
              <span>{money(model.last.rentYear)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Cash needed up front</span>
              <span>{money(model.upfront)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Buying costs {money(model.monthlyBuy - (Number(rent) || 0))} a month more than renting today, but that gap shrinks as rent rises — by year {model.years} the
            rent is {money(model.last.rentYear)}.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Net cost at each milestone</div>
          <Bars
            data={[5, 10, 15, 20, 25, 30].filter((year) => year <= model.years).map((year) => {
              const row = model.rows[year - 1];
              return { label: 'Y' + year, value: Math.round(row.netRent - row.netBuy) };
            })}
            format={(value) => value.toLocaleString()}
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bars above zero mean buying is cheaper by that amount by that year. The early years usually sit below zero: buying carries fees, and the first years of
            a mortgage are mostly interest.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Year by year</div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Year</th>
                <th className="py-1 text-right font-medium">Buy net cost</th>
                <th className="py-1 text-right font-medium">Rent net cost</th>
                <th className="py-1 text-right font-medium">Mortgage left</th>
                <th className="py-1 text-right font-medium">Equity</th>
                <th className="py-1 text-right font-medium">Home value</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {model.rows.map((row) => (
                <tr key={row.year} className={model.breakEven && row.year === model.breakEven.year ? 'border-t border-cyan-j/40 bg-cyan-j/5' : 'border-t border-border/50'}>
                  <td className="py-1">{row.year}</td>
                  <td className="py-1 text-right">{money(row.netBuy)}</td>
                  <td className="py-1 text-right text-muted-foreground">{money(row.netRent)}</td>
                  <td className="py-1 text-right text-muted-foreground">{money(row.balance)}</td>
                  <td className="py-1 text-right text-cyan-j">{money(row.equity)}</td>
                  <td className="py-1 text-right">{money(row.homeValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Net cost is everything paid out minus what you would keep — for buying, that is the deposit, payments, tax, upkeep and insurance minus equity. The
          highlighted year is where the two cross.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Monthly buy" value={money(model.monthlyBuy)} mono sub="all in" />
        <Stat label="Deposit" value={money(model.downPayment)} mono sub={downPct + '% down'} />
        <Stat label="Loan" value={money(model.loan)} mono sub={term + ' years'} />
        <Stat label="Equity at end" value={money(model.last.equity)} mono sub={model.ownAtEnd.toFixed(0) + '% of value'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What decides this</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· How long you stay. The break-even is usually five to eight years; below that, buying simply pays fees and interest.</p>
          <p>· Rent versus the monthly cost of owning. When rent is well below the true cost of owning, renting and investing the difference wins.</p>
          <p>· Appreciation is the assumption doing the most work here. Run it at 0% before believing a positive result.</p>
          <p>· Mortgage interest in the early years is mostly not equity — the mortgage-left column shows how slowly that changes.</p>
          <p>· Upkeep and tax never build equity and never stop. They are the honest reason owning costs more per month than the payment alone.</p>
          <p>· Not priced here: buying and selling costs, stamp duty, mortgage fees, or the return on investing the deposit instead.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Break-even', value: model.breakEven ? 'year ' + model.breakEven.year : 'not within ' + model.years },
              { label: 'Horizon', value: model.years + ' years' },
              { label: 'Advantage', value: money(Math.abs(model.advantage)) + (model.advantage >= 0 ? ' to buying' : ' to renting') },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The model amortises the loan monthly, then totals what each path has actually cost by the end of each year: for buying that is the deposit plus every
          payment, tax, upkeep and insurance charge, less the equity you would hold after selling; for renting it is simply the rent paid, rising each year. Cash
          flows are not discounted for inflation, so read the figures as money of the day.
        </p>
      </Panel>
    </ToolShell>
  );
}