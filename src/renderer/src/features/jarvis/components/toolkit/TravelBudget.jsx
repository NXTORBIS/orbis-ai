import { useMemo, useState } from 'react';
import { Luggage } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const money = (value) => Math.round(value).toLocaleString();

export default function TravelBudget() {
  const [inputs, setInputs] = useState({
    destination: 'Lisbon',
    travellers: '2',
    nights: '7',
    flights: '260',
    hotel: '140',
    food: '38',
    activities: '22',
    transport: '9',
    insurance: '28',
    visa: '0',
    shopping: '120',
    buffer: '10',
  });

  const set = (key, value) => setInputs((current) => ({ ...current, [key]: value }));
  const n = (key) => Number(inputs[key]) || 0;

  const result = useMemo(() => {
    const people = Math.max(1, n('travellers'));
    const nights = Math.max(1, n('nights'));
    const days = nights;

    const flights = n('flights') * people;
    const hotelTotal = n('hotel') * nights;
    const food = n('food') * people * days;
    const activities = n('activities') * people * days;
    const transport = n('transport') * days;
    const insurance = n('insurance') * people;
    const visa = n('visa') * people;
    const shopping = n('shopping');
    const subtotal = flights + hotelTotal + food + activities + transport + insurance + visa + shopping;
    const buffer = subtotal * (n('buffer') / 100);
    const total = subtotal + buffer;

    const categories = [
      { label: 'Flights', value: flights },
      { label: 'Hotel', value: hotelTotal },
      { label: 'Food', value: food },
      { label: 'Activities', value: activities },
      { label: 'Local transport', value: transport },
      { label: 'Insurance', value: insurance },
      { label: 'Visa', value: visa },
      { label: 'Shopping', value: shopping },
    ].filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);

    return {
      people, nights, days, flights, hotelTotal, food, activities, transport, insurance, visa, shopping,
      subtotal, buffer, total, categories,
      perPerson: total / people,
      perDay: total / days,
      perPersonDay: total / people / days,
      hotelShare: total ? (hotelTotal / total) * 100 : 0,
      trim: total * 0.1,
    };
  }, [inputs]);

  const report = useMemo(() => [
    n('destination') + ' · ' + result.people + ' travelling · ' + result.nights + ' nights',
    '',
    ...result.categories.map((entry) => entry.label + ': ' + money(entry.value)),
    'Contingency ' + n('buffer') + '%: ' + money(result.buffer),
    'Total: ' + money(result.total),
    '',
    'Per person: ' + money(result.perPerson),
    'Per day: ' + money(result.perDay),
    'Per person per day: ' + money(result.perPersonDay),
  ].join('\n'), [result, inputs]);

  return (
    <ToolShell
      toolId="travel-budget"
      icon={Luggage}
      title="Travel Budget Planner"
      desc="Build a trip budget from flights, nights and daily spend — with per-person and per-day averages, a contingency, and a ranked view of what is actually eating the money."
      state={inputs}
      onRestore={(restored) => setInputs((current) => ({ ...current, ...restored }))}
      exportText={report}
      exportName="travel-budget.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Destination"><input value={inputs.destination} onChange={(e) => set('destination', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Travellers"><input value={inputs.travellers} onChange={(e) => set('travellers', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Nights"><input value={inputs.nights} onChange={(e) => set('nights', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Contingency, %"><input value={inputs.buffer} onChange={(e) => set('buffer', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Flights, each"><input value={inputs.flights} onChange={(e) => set('flights', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Hotel, per night"><input value={inputs.hotel} onChange={(e) => set('hotel', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Food, each per day"><input value={inputs.food} onChange={(e) => set('food', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Activities, each per day"><input value={inputs.activities} onChange={(e) => set('activities', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Local transport, per day"><input value={inputs.transport} onChange={(e) => set('transport', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Insurance, each"><input value={inputs.insurance} onChange={(e) => set('insurance', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Visa, each"><input value={inputs.visa} onChange={(e) => set('visa', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Shopping and extras"><input value={inputs.shopping} onChange={(e) => set('shopping', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Total for ' + (n('destination') || 'the trip')}
          value={money(result.total)}
          sub={result.people + ' travelling for ' + result.nights + ' nights · ' + money(result.perPerson) + ' each · ' + money(result.perPersonDay) + ' per person per day.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the money goes</div>
          <div className="space-y-1.5">
            {result.categories.map((entry) => (
              <div key={entry.label}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{entry.label}</span>
                  <span className="font-mono-j">{money(entry.value)} · {result.total ? ((entry.value / result.total) * 100).toFixed(0) : 0}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: (result.subtotal ? (entry.value / result.subtotal) * 100 : 0) + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Category totals</div>
          <Bars
            data={result.categories.slice(0, 6).map((entry) => ({ label: entry.label.slice(0, 12), value: entry.value }))}
            format={(value) => money(value)}
            suffix=""
            highlightLast={false}
          />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The full breakdown</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Flights</span><span>{money(result.flights)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Hotel, {result.nights} nights</span><span>{money(result.hotelTotal)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Food, {result.people} × {result.days} days</span><span>{money(result.food)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Activities</span><span>{money(result.activities)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Local transport</span><span>{money(result.transport)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Insurance and visa</span><span>{money(result.insurance + result.visa)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Shopping and extras</span><span>{money(result.shopping)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Contingency {n('buffer')}%</span><span>{money(result.buffer)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Total</span><span className="text-cyan-j">{money(result.total)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">If you need to trim it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Ten per cent off the whole trip is {money(result.trim)} — the equivalent of dropping one night in a mid-range hotel.</p>
            <p>· Accommodation is {result.hotelShare.toFixed(0)}% of the budget, so it is almost always the fastest lever. One grade down on the hotel beats a week of skipped dinners.</p>
            <p>· Flights move the most from timing, not from comfort class. Shifting dates by a few days often beats every other saving combined.</p>
            <p>· Food is {result.total ? ((result.food / result.total) * 100).toFixed(0) : 0}% here. Breakfast in and one proper meal out a day usually halves it without the trip feeling cheap.</p>
            <p>· The contingency is not optional. Something always costs more than planned, and {money(result.buffer)} is what stops the last day being decided by the balance.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using this well</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Put everything in one currency. Mixing currencies in a planner is how budgets quietly drift.</p>
            <p>· Flights are quoted per person and hotels per room, which is why the two are treated differently here — a room shared by three people does not triple.</p>
            <p>· Daily figures are the ones to test against reality before booking: {money(result.perPersonDay)} per person per day is either comfortable or tight depending on the city.</p>
            <p>· Add a shopping line even if you never shop. It is the category most consistently underestimated.</p>
            <p>· Copy the breakdown into your notes or a spreadsheet; it doubles as the checklist for what to book and in what order.</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={report} label="Copy the budget" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total" value={money(result.total)} mono />
        <Stat label="Per person" value={money(result.perPerson)} mono />
        <Stat label="Per day" value={money(result.perDay)} mono sub="whole party" />
        <Stat label="Per person day" value={money(result.perPersonDay)} mono sub="the real number" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Splitting it between people</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Item</th>
                <th className="py-1 text-right font-medium">Total</th>
                <th className="py-1 text-right font-medium">Each of {result.people}</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.categories.map((entry) => (
                <tr key={entry.label} className="border-t border-border/50">
                  <td className="py-1">{entry.label}</td>
                  <td className="py-1 text-right">{money(entry.value)}</td>
                  <td className="py-1 text-right text-muted-foreground">{money(entry.value / result.people)}</td>
                </tr>
              ))}
              <tr className="border-t border-cyan-j/40 bg-cyan-j/5">
                <td className="py-1">Everything, with contingency</td>
                <td className="py-1 text-right text-cyan-j">{money(result.total)}</td>
                <td className="py-1 text-right text-cyan-j">{money(result.perPerson)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Travellers', value: String(result.people) },
              { label: 'Nights', value: String(result.nights) },
              { label: 'Contingency', value: n('buffer') + '%' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Per-person and per-room costs are kept apart, so adding a traveller raises flights and daily spending without multiplying the hotel — which is exactly
          where naive trip budgets go wrong. Everything is in one currency and stays on this device.
        </p>
      </Panel>
    </ToolShell>
  );
}