import { useEffect, useMemo, useState } from 'react';
import { Coffee, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PRESETS = [
  { label: 'Filter coffee, 250 ml', mg: 95 },
  { label: 'Espresso, single', mg: 63 },
  { label: 'Flat white or latte', mg: 63 },
  { label: 'Instant coffee', mg: 60 },
  { label: 'Black tea', mg: 47 },
  { label: 'Green tea', mg: 28 },
  { label: 'Cola, 330 ml', mg: 34 },
  { label: 'Energy drink, 250 ml', mg: 80 },
  { label: 'Pre-workout scoop', mg: 200 },
  { label: 'Dark chocolate, 50 g', mg: 40 },
];

const toMinutes = (value) => {
  const parts = String(value || '0:0').split(':');
  const hours = Number(parts[0]) || 0;
  const minutes = Number(parts[1]) || 0;
  return hours * 60 + minutes;
};

const clock = (minutes) => {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(wrapped / 60)).padStart(2, '0') + ':' + String(wrapped % 60).padStart(2, '0');
};

const remainingAt = (drink, minutes) => {
  const elapsed = (minutes - toMinutes(drink.time)) / 60;
  if (elapsed < 0) return 0;
  return drink.mg * Math.pow(0.5, elapsed / (drink.halfLife || 5));
};

export default function CaffeineTracker() {
  const [drinks, setDrinks] = useState([
    { id: 'a', label: 'Filter coffee', mg: '95', time: '07:30' },
    { id: 'b', label: 'Espresso', mg: '63', time: '11:00' },
    { id: 'c', label: 'Energy drink', mg: '80', time: '15:30' },
  ]);
  const [halfLife, setHalfLife] = useState('5');
  const [bedtime, setBedtime] = useState('23:00');
  const [threshold, setThreshold] = useState('30');
  const [now, setNow] = useState(() => {
    const date = new Date();
    return date.getHours() * 60 + date.getMinutes();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const date = new Date();
      setNow(date.getHours() * 60 + date.getMinutes());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const set = (id, key, value) => setDrinks((current) => current.map((drink) => (drink.id === id ? { ...drink, [key]: value } : drink)));

  const result = useMemo(() => {
    const life = Math.max(0.5, Number(halfLife) || 5);
    const limit = Number(threshold) || 30;
    const bed = toMinutes(bedtime);
    const bedMinutes = bed > now ? bed : bed + 1440;

    const loaded = drinks.map((drink) => ({
      ...drink,
      mg: Number(drink.mg) || 0,
      halfLife: life,
      start: toMinutes(drink.time),
    }));

    const totalMg = loaded.reduce((sum, drink) => sum + drink.mg, 0);
    const current = loaded.reduce((sum, drink) => sum + remainingAt(drink, now), 0);
    const atBed = loaded.reduce((sum, drink) => sum + remainingAt(drink, bedMinutes), 0);
    const peakDrink = loaded.reduce((best, drink) => (drink.mg > (best.mg || 0) ? drink : best), {});
    const peakMinutes = peakDrink.start !== undefined ? peakDrink.start + 45 : now;
    const peakValue = loaded.reduce((sum, drink) => sum + remainingAt(drink, peakMinutes), 0);

    const hoursToLimit = current > limit ? life * Math.log2(current / limit) : 0;
    const safeMinutes = bedMinutes - (current > limit ? hoursToLimit * 60 : 0);
    const lastSafe = safeMinutes > peakMinutes
      ? safeMinutes
      : bedMinutes - (peakDrink.mg ? life * Math.log2(peakDrink.mg / limit) * 60 : 0);

    const chart = [];
    for (let offset = 0; offset <= 24; offset += 2) {
      const minutes = now + offset * 60;
      const value = loaded.reduce((sum, drink) => sum + remainingAt(drink, minutes), 0);
      chart.push({ label: clock(minutes).slice(0, 2), value: Math.round(value), bedtime: minutes >= bedMinutes });
    }

    const clearing = Math.max(0, now + hoursToLimit * 60);

    return {
      loaded, totalMg, current, atBed, peakValue, peakMinutes, hoursToLimit, lastSafe, chart, life, limit,
      bedLabel: clock(bedMinutes), clearingLabel: clock(clearing),
      overLimit: atBed > limit,
      drinksAfterCutoff: loaded.filter((drink) => drink.start > lastSafe && drink.mg > 0).length,
    };
  }, [drinks, halfLife, bedtime, threshold, now]);

  const report = useMemo(() => [
    'Total consumed today: ' + result.totalMg.toFixed(0) + ' mg of caffeine',
    'In your system now (' + clock(now) + '): about ' + result.current.toFixed(0) + ' mg',
    'Still in your system at bedtime ' + result.bedLabel + ': about ' + result.atBed.toFixed(0) + ' mg (target under ' + result.limit + ' mg)',
    'Peak of about ' + result.peakValue.toFixed(0) + ' mg around ' + clock(result.peakMinutes),
    'Half-life assumed: ' + result.life + ' hours',
    '',
    'Last coffee that still clears your bedtime target: around ' + clock(result.lastSafe),
    result.overLimit
      ? 'You are above your target at bedtime — the biggest remaining contributor is ' + (result.peakDrink ? result.peakDrink.label : 'your latest drink') + '.'
      : 'You are inside your bedtime target.',
    '',
    ...result.loaded.map((drink) => clock(drink.start) + ' · ' + drink.label + ' · ' + drink.mg + ' mg · at bedtime ' + (drink.start <= toMinutes(result.bedLabel) ? (drink.mg * Math.pow(0.5, (toMinutes(result.bedLabel) > drink.start ? toMinutes(result.bedLabel) - drink.start : toMinutes(result.bedLabel) + 1440 - drink.start) / 60 / result.life)).toFixed(0) : String(drink.mg)) + ' mg'),
  ].join('\n'), [result, now]);

  return (
    <ToolShell
      toolId="caffeine-tracker"
      icon={Coffee}
      title="Caffeine Tracker & Sleep Cutoff"
      desc="Log what you have had and when, then watch the caffeine decay through the day — how much is still in your system at bedtime, and the last hour a coffee still leaves you clear."
      state={{ drinks, halfLife, bedtime, threshold }}
      onRestore={(restored) => {
        if (Array.isArray(restored.drinks) && restored.drinks.length) setDrinks(restored.drinks);
        if (restored.halfLife !== undefined) setHalfLife(String(restored.halfLife));
        if (typeof restored.bedtime === 'string') setBedtime(restored.bedtime);
        if (restored.threshold !== undefined) setThreshold(String(restored.threshold));
      }}
      exportText={report}
      exportName="caffeine.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={'Bedtime · ' + result.bedLabel}>
          <input type="time" value={bedtime} onChange={(e) => setBedtime(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Caffeine half-life, hours">
          <input value={halfLife} onChange={(e) => setHalfLife(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Target left in system at bedtime, mg">
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">What you have had — now is {clock(now)}</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.totalMg.toFixed(0)} mg total</span>
        </div>
        <div className="space-y-2">
          {drinks.map((drink) => (
            <div key={drink.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <Field label="Drink">
                <input value={drink.label} onChange={(e) => set(drink.id, 'label', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
              </Field>
              <Field label="Caffeine, mg">
                <input value={drink.mg} onChange={(e) => set(drink.id, 'mg', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label="Time">
                <input type="time" value={drink.time} onChange={(e) => set(drink.id, 'time', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <div className="flex items-end gap-2">
                <span className="font-mono-j text-[11px] text-cyan-j">now {remainingAt({ ...drink, mg: Number(drink.mg) || 0, halfLife: Number(halfLife) || 5 }, now).toFixed(0)} mg</span>
                <button
                  type="button"
                  onClick={() => setDrinks((current) => current.filter((entry) => entry.id !== drink.id))}
                  className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setDrinks((current) => [...current, {
                id: Math.random().toString(36).slice(2),
                label: preset.label.split(',')[0],
                mg: String(preset.mg),
                time: clock(now),
              }])}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
            >
              <Plus className="h-3 w-3" /> {preset.label}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.overLimit ? 'rose' : result.atBed > result.limit * 0.6 ? 'amber' : 'emerald'}
          label={'Left in your system at bedtime'}
          value={result.atBed.toFixed(0)}
          unit="mg"
          sub={result.overLimit
            ? 'That is above your ' + result.limit + ' mg target. Caffeine this close to sleep lengthens the time it takes to fall asleep and thins the deep-sleep stages, even when you feel fine.'
            : 'Inside your ' + result.limit + ' mg target, so caffeine is unlikely to be what keeps you awake tonight.'}
        />
        <Ring
          value={Math.min(400, result.atBed)}
          max={Math.max(100, result.limit * 4)}
          tone={result.overLimit ? 'rose' : 'emerald'}
          label="Against your bedtime target"
          sub={result.atBed.toFixed(0) + ' mg at ' + result.bedLabel + ' against a target of ' + result.limit + ' mg'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Caffeine through the next 24 hours</div>
          <Bars data={result.chart} format={(value) => String(value)} suffix=" mg" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bars are the hours of the day from now onwards. The curve is the sum of every drink decaying independently — the half-life figure is doing all the work,
            so it is worth setting it to how you actually respond.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Timings that matter</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">In your system now</span>
              <span className="font-mono-j text-cyan-j">{result.current.toFixed(0)} mg</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Peak today</span>
              <span className="font-mono-j">{result.peakValue.toFixed(0)} mg at {clock(result.peakMinutes)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Last drink that still clears bedtime</span>
              <span className="font-mono-j text-cyan-j">{clock(result.lastSafe)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Dropping under {result.limit} mg</span>
              <span className="font-mono-j">{result.current > result.limit ? 'about ' + result.clearingLabel : 'already there'}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Half gone</span>
              <span className="font-mono-j">{clock(now + result.life * 60)}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">A quarter left</span>
              <span className="font-mono-j">{clock(now + result.life * 120)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Caffeine peaks in the blood roughly 30 to 60 minutes after drinking, which is why the peak above sits slightly after your largest drink rather than at it.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The half-life is the whole calculation</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Five hours is a common average, but the real range runs roughly three to seven hours. Smoking speeds it up; pregnancy, some medicines and oral contraceptives slow it down considerably.</p>
            <p>· At five hours, a quarter of the caffeine is still there after ten hours. That is why a 15:30 drink shows up at midnight.</p>
            <p>· Caffeine blocks adenosine, the molecule that builds sleep pressure. It does not remove the pressure — it hides it, and the debt arrives when the caffeine clears.</p>
            <p>· Even at low bedtime levels, caffeine shortens total sleep and reduces deep sleep. Feeling sleepy at bedtime is not evidence that it cleared.</p>
            <p>· Tolerance to the alertness effect builds within days, while the sleep effect does not. Needing more for the same lift is the sign it is time for a reset.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using this well</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Set your bedtime, then push the cut-off earlier until the bedtime figure sits under your target. Most people land somewhere between 8 and 10 hours before bed.</p>
            <p>· Your figure of {clock(result.lastSafe)} assumes the drink you are considering is a single strong coffee. A tea or a cola buys you a couple more hours.</p>
            <p>· {result.drinksAfterCutoff > 0 ? result.drinksAfterCutoff + ' of your logged drinks sit after that cut-off — worth moving rather than removing.' : 'Nothing you logged sits after the cut-off, which is the pattern you want.'}</p>
            <p>· Do not add up caffeine from yesterday: at five hours, a drink from 24 hours ago leaves less than 4% behind.</p>
            <p>· Total daily intake still matters. Up to about 400 mg is the usual guidance for healthy adults; half that if pregnant, and much less for children and adolescents.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total today" value={result.totalMg.toFixed(0) + ' mg'} mono sub={result.loaded.length + ' drinks'} />
        <Stat label="In system now" value={result.current.toFixed(0) + ' mg'} mono sub={clock(now)} />
        <Stat label="At bedtime" value={result.atBed.toFixed(0) + ' mg'} mono sub={result.bedLabel} />
        <Stat label="Last safe drink" value={clock(result.lastSafe)} mono sub={'for ' + result.limit + ' mg at bed'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How this is worked out</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>remaining = dose × 0.5 ^ (hours since drunk ÷ half-life)</p>
          <p>system total = sum of every drink decaying independently</p>
          <p>hours to reach a target = half-life × log2(current ÷ target)</p>
          <p className="text-cyan-j">At {result.life} hours, {result.current.toFixed(0)} mg now becomes {result.atBed.toFixed(0)} mg by {result.bedLabel}.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Total', value: result.totalMg.toFixed(0) + ' mg' },
              { label: 'At bed', value: result.atBed.toFixed(0) + ' mg' },
              { label: 'Target', value: result.limit + ' mg' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Decay mathematics only. Absorption is treated as instant, individual metabolism is not modelled, and food, medication and genetics all shift the real curve.
          Treat the bedtime figure as a planning tool rather than a measurement, and never use it in place of medical advice.
        </p>
      </Panel>
    </ToolShell>
  );
}