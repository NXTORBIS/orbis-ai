import { useMemo, useState } from 'react';
import { Fuel } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function EvRunningCost() {
  const [inputs, setInputs] = useState({
    km: '15000',
    petrolPrice: '1.85',
    petrolUse: '7.2',
    evUse: '17',
    homePrice: '0.28',
    homeShare: '80',
    publicPrice: '0.55',
    premium: '9000',
    years: '7',
    grid: '0.42',
  });

  const set = (key, value) => setInputs((current) => ({ ...current, [key]: value }));
  const n = (key) => Number(inputs[key]) || 0;

  const result = useMemo(() => {
    const km = n('km');
    const petrolLitres = (km / 100) * n('petrolUse');
    const petrolCost = petrolLitres * n('petrolPrice');
    const evKwh = (km / 100) * n('evUse');
    const homeShare = Math.min(100, Math.max(0, n('homeShare'))) / 100;
    const evCost = evKwh * (homeShare * n('homePrice') + (1 - homeShare) * n('publicPrice'));
    const saving = petrolCost - evCost;
    const years = Math.max(1, n('years'));
    const cumulativeSaving = saving * years;
    const breakEven = saving > 0 ? n('premium') / saving : null;
    const co2Petrol = petrolLitres * 2.31;
    const co2Ev = evKwh * n('grid');
    const co2Saved = co2Petrol - co2Ev;
    const petrolPerKm = km ? petrolCost / km : 0;
    const evPerKm = km ? evCost / km : 0;
    const petrolServicing = km * 0.045;
    const evServicing = km * 0.02;
    const servicingSaving = petrolServicing - evServicing;

    return {
      km, petrolLitres, petrolCost, evKwh, evCost, saving, years, cumulativeSaving, breakEven,
      co2Petrol, co2Ev, co2Saved, petrolPerKm, evPerKm, petrolServicing, evServicing,
      servicingSaving, totalSaving: saving * years + servicingSaving * years,
      homeKwh: evKwh * homeShare, publicKwh: evKwh * (1 - homeShare),
    };
  }, [inputs]);

  const report = useMemo(() => [
    'Annual distance: ' + money(result.km) + ' km',
    '',
    'Petrol: ' + result.petrolLitres.toFixed(0) + ' L = ' + money(result.petrolCost) + ' · ' + result.petrolPerKm.toFixed(3) + ' per km',
    'Electric: ' + result.evKwh.toFixed(0) + ' kWh = ' + money(result.evCost) + ' · ' + result.evPerKm.toFixed(3) + ' per km',
    '',
    'Annual saving: ' + money(result.saving),
    'Break-even on the price premium: ' + (result.breakEven ? result.breakEven.toFixed(1) + ' years' : 'never at these figures'),
    'Over ' + result.years + ' years: ' + money(result.cumulativeSaving) + ' fuel, ' + money(result.servicingSaving * result.years) + ' servicing',
    'CO₂ saved each year: ' + money(result.co2Saved) + ' kg',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="ev-running-cost"
      icon={Fuel}
      title="Petrol vs Electric Running Cost"
      desc="Compare what a year of driving actually costs on fuel and on electricity — per kilometre, with servicing, break-even on the purchase premium and the CO₂ difference."
      state={inputs}
      onRestore={(restored) => setInputs((current) => ({ ...current, ...restored }))}
      exportText={report}
      exportName="running-cost.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Kilometres a year"><input value={inputs.km} onChange={(e) => set('km', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Petrol price per litre"><input value={inputs.petrolPrice} onChange={(e) => set('petrolPrice', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Petrol use, L/100 km"><input value={inputs.petrolUse} onChange={(e) => set('petrolUse', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="EV use, kWh/100 km"><input value={inputs.evUse} onChange={(e) => set('evUse', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Home electricity per kWh"><input value={inputs.homePrice} onChange={(e) => set('homePrice', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Charging at home, % of the time"><input value={inputs.homeShare} onChange={(e) => set('homeShare', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Public charging per kWh"><input value={inputs.publicPrice} onChange={(e) => set('publicPrice', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="EV price premium"><input value={inputs.premium} onChange={(e) => set('premium', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Years you will keep it"><input value={inputs.years} onChange={(e) => set('years', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Grid CO₂, kg per kWh"><input value={inputs.grid} onChange={(e) => set('grid', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.saving > 0 ? 'emerald' : 'rose'}
          label={result.saving > 0 ? 'You save each year' : 'Electric costs more each year'}
          value={money(Math.abs(result.saving))}
          sub={'Fuel alone: petrol ' + money(result.petrolCost) + ' against electricity ' + money(result.evCost) + ' for the same ' + money(result.km) + ' km.'}
        />
        <Ring
          value={result.petrolCost ? (result.evCost / result.petrolCost) * 100 : 0}
          max={100}
          tone={result.saving > 0 ? 'emerald' : 'rose'}
          label="Electric as a share of petrol cost"
          sub={result.evKwh.toFixed(0) + ' kWh a year — ' + result.homeKwh.toFixed(0) + ' at home, ' + result.publicKwh.toFixed(0) + ' on public chargers'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Annual running cost</div>
          <Bars
            data={[
              { label: 'Petrol', value: Number(result.petrolCost.toFixed(0)) },
              { label: 'Electric', value: Number(result.evCost.toFixed(0)) },
              { label: 'Petrol service', value: Number(result.petrolServicing.toFixed(0)) },
              { label: 'EV service', value: Number(result.evServicing.toFixed(0)) },
            ]}
            format={(value) => money(value)}
            suffix=""
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Servicing is estimated from typical rates — electric drivetrains have fewer moving parts, no oil changes and less brake wear thanks to regenerative
            braking. It is the second saving that people forget to count.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Break-even and the long view</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Fuel saving a year</span><span>{money(result.saving)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Servicing saving a year</span><span>{money(result.servicingSaving)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Break-even on the premium</span>
              <span>{result.breakEven ? result.breakEven.toFixed(1) + ' years' : 'not reached'}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
              <span>Saved over {result.years} years</span><span className="text-cyan-j">{money(result.totalSaving)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Cost per kilometre</span><span>{result.petrolPerKm.toFixed(3)} → {result.evPerKm.toFixed(3)}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Emissions this year</div>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Petrol tailpipe</span><span className="font-mono-j">{money(result.co2Petrol)} kg</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-rose-400/70" style={{ width: '100%' }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Electricity to charge</span><span className="font-mono-j">{money(result.co2Ev)} kg</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-400/70" style={{ width: Math.min(100, result.co2Petrol ? (result.co2Ev / result.co2Petrol) * 100 : 0) + '%' }} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              An electric car is only as clean as the grid that charges it, which is why the grid figure matters and why it falls every year as generation changes
              over. The saving of {money(result.co2Saved)} kg is real but not absolute — moving the charging to a low-carbon tariff improves it further.
            </p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What shifts the answer</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Charging at home rather than on public chargers is usually the single biggest lever — at {inputs.publicPrice} per kWh on the road, the same energy costs about {(n('publicPrice') / (n('homePrice') || 1)).toFixed(1)}× the home rate.</p>
            <p>· Motorway efficiency differs: an electric car loses more range at sustained high speed, a petrol car loses more in stop-start traffic.</p>
            <p>· Where a per-kilometre tax replaces fuel duty, that would move the numbers again — worth allowing for in a long ownership horizon.</p>
            <p>· Resale value matters as much as running cost to the total picture; this comparison deliberately stops at running costs.</p>
            <p>· {result.breakEven && result.breakEven < result.years ? 'At these figures the premium is repaid inside your ownership window, so the electric option wins outright.' : 'At these figures the premium is not repaid inside your ownership window — a longer horizon, cheaper electricity or a smaller premium would change that.'}</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The working</span>
          <CopyBtn value={report} label="Copy the comparison" />
        </div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>Petrol: {money(result.km)} km ÷ 100 × {inputs.petrolUse} L × {inputs.petrolPrice} = {money(result.petrolCost)}</p>
          <p>Electric: {money(result.km)} km ÷ 100 × {inputs.evUse} kWh × mixed tariff = {money(result.evCost)}</p>
          <p>Mixed tariff: {inputs.homeShare}% at {inputs.homePrice} plus {(100 - Math.min(100, n('homeShare'))).toFixed(0)}% at {inputs.publicPrice}</p>
          <p>Savings: {money(result.saving)} a year on fuel, {money(result.servicingSaving)} on servicing</p>
          <p>Premium {money(n('premium'))} ÷ {money(result.saving)} a year = {result.breakEven ? result.breakEven.toFixed(1) + ' years' : 'no break-even'}</p>
        </div>
        <div className="mt-3">
          <Pills
            items={[
              { label: 'Per km', value: result.evPerKm.toFixed(3) },
              { label: 'Premium repaid', value: result.breakEven ? result.breakEven.toFixed(1) + ' yrs' : 'never' },
              { label: 'CO₂ down', value: money(result.co2Saved) + ' kg' },
            ]}
          />
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Petrol a year" value={money(result.petrolCost)} mono />
        <Stat label="Electric a year" value={money(result.evCost)} mono />
        <Stat label="Saving a year" value={money(result.saving)} mono sub="fuel only" />
        <Stat label="Over the years" value={money(result.totalSaving)} mono sub={result.years + ' years, with servicing'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The comparison uses your own figures rather than averages, because electricity tariffs and petrol prices vary far more between regions than any
          published estimate can capture. Servicing is a rate estimate rather than a schedule, and emissions come from standard fuel and grid factors — treat it
          as a well-founded estimate, not a quotation.
        </p>
      </Panel>
    </ToolShell>
  );
}