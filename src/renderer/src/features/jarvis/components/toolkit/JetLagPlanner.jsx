import { useMemo, useState } from 'react';
import { Plane } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const ZONES = [
  { label: 'London', offset: 0 },
  { label: 'Paris', offset: 1 },
  { label: 'Dubai', offset: 4 },
  { label: 'Delhi', offset: 5.5 },
  { label: 'Singapore', offset: 8 },
  { label: 'Tokyo', offset: 9 },
  { label: 'Sydney', offset: 10 },
  { label: 'Los Angeles', offset: -8 },
  { label: 'New York', offset: -5 },
  { label: 'Sao Paulo', offset: -3 },
];

const clock = (hours) => {
  const wrapped = ((hours % 24) + 24) % 24;
  const whole = Math.floor(wrapped);
  const minutes = Math.round((wrapped - whole) * 60);
  return String(whole).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
};

export default function JetLagPlanner() {
  const [home, setHome] = useState(5.5);
  const [destination, setDestination] = useState(0);
  const [departure, setDeparture] = useState(new Date().toISOString().slice(0, 10));
  const [flightHours, setFlightHours] = useState('10');
  const [wake, setWake] = useState('07:00');
  const [sleep, setSleep] = useState('23:00');
  const [direction, setDirection] = useState('east');

  const result = useMemo(() => {
    const shift = destination - home;
    const magnitude = Math.abs(shift);
    const travelling = direction === 'east' ? Math.abs(shift) : -Math.abs(shift);
    const rate = direction === 'east' ? 1 : 1.5;
    const days = Math.max(1, Math.ceil(magnitude / rate));
    const severity = magnitude >= 9 ? 'severe' : magnitude >= 6 ? 'substantial' : magnitude >= 3 ? 'mild' : 'negligible';

    const wakeParts = wake.split(':').map(Number);
    const sleepParts = sleep.split(':').map(Number);
    const homeWake = (wakeParts[0] || 7) + (wakeParts[1] || 0) / 60;
    const homeSleep = (sleepParts[0] || 23) + (sleepParts[1] || 0) / 60;

    const departureDate = new Date(departure + 'T12:00:00');
    const arrivalDate = new Date(departureDate.getTime() + (Number(flightHours) || 0) * 3600000);

    const plan = [];
    for (let day = 0; day <= 5; day += 1) {
      const remaining = travelling - (direction === 'east' ? rate : -rate) * day;
      const bodyOffset = shift - remaining;
      const targetSleep = clock(homeSleep + bodyOffset);
      const targetWake = clock(homeWake + bodyOffset);
      const seek = direction === 'east'
        ? { label: 'Morning light', window: clock(homeWake + bodyOffset) + ' – ' + clock(homeWake + bodyOffset + 2) }
        : { label: 'Late afternoon and evening light', window: clock(homeWake + bodyOffset + 9) + ' – ' + clock(homeWake + bodyOffset + 11) };
      const avoid = direction === 'east'
        ? { label: 'Evening light', window: clock(homeSleep + bodyOffset - 3) + ' – ' + clock(homeSleep + bodyOffset) }
        : { label: 'Early morning light', window: clock(homeWake + bodyOffset - 3) + ' – ' + clock(homeWake + bodyOffset) };
      const date = new Date(arrivalDate.getTime() + day * 86400000);
      plan.push({
        day, date, remaining, bodyOffset, targetSleep, targetWake, seek, avoid,
        note: day === 0
          ? 'Arrival day. Stay awake until at least ' + targetSleep + ' local, even if it is hard, and get outside in daylight.'
          : day <= Math.min(3, days)
            ? 'Push bedtime towards local time. The gain per day is ' + rate + ' hours, so this is ' + Math.min(magnitude, rate * day).toFixed(1) + ' hours in.'
            : 'The clock is close to local now. Keep the light exposure and the timing steady to lock it in.',
      });
    }

    const planeAdvice = direction === 'east'
      ? (Number(flightHours) >= 8
        ? 'Sleep the first half of the flight only, then stay awake for the last four hours with lights on. Arriving awake at local evening is the goal.'
        : 'Stay awake on the flight. A short eastward hop does not justify a nap that lands you at the wrong end of the day.')
      : (Number(flightHours) >= 8
        ? 'Stay awake for the first half and sleep the second half so you arrive towards local morning feeling rested.'
        : 'Sleep if the flight overlaps your normal night, otherwise stay awake and rest your eyes only.');

    const preTrip = direction === 'east'
      ? 'Two or three nights before departure, go to bed 30 to 60 minutes earlier and get bright light in the morning. That starts the shift before you leave.'
      : 'Two or three nights before departure, stay up 30 to 60 minutes later and seek evening light. Westward travel is easier because the body prefers a longer day.';

    return { shift, magnitude, travelling, rate, days, severity, plan, planeAdvice, preTrip, arrivalDate, departureDate, bodyClockAtArrival: home };
  }, [home, destination, departure, flightHours, wake, sleep, direction]);

  const report = useMemo(() => [
    'Time zone shift: ' + result.shift.toFixed(1) + ' hours',
    'Direction: ' + direction + ' — adaptation of about ' + result.rate + ' hours a day',
    'Estimated days to adapt: ' + result.days,
    'Severity: ' + result.severity,
    '',
    result.preTrip,
    'On the plane: ' + result.planeAdvice,
    '',
    ...result.plan.map((entry) => entry.date.toDateString() + ' · sleep ' + entry.targetSleep + ' · wake ' + entry.targetWake + ' · seek light ' + entry.seek.window + ' · avoid ' + entry.avoid.window),
  ].join('\n'), [result, direction]);

  return (
    <ToolShell
      toolId="jet-lag-planner"
      icon={Plane}
      title="Jet Lag Planner"
      desc="Turn a time zone shift into a day-by-day plan: target sleep and wake times in local time, when to seek light and when to hide from it, and what to do on the plane."
      state={{ home, destination, departure, flightHours, wake, sleep, direction }}
      onRestore={(restored) => {
        if (restored.home !== undefined) setHome(Number(restored.home) || 0);
        if (restored.destination !== undefined) setDestination(Number(restored.destination) || 0);
        if (typeof restored.departure === 'string') setDeparture(restored.departure);
        if (restored.flightHours !== undefined) setFlightHours(String(restored.flightHours));
        if (typeof restored.wake === 'string') setWake(restored.wake);
        if (typeof restored.sleep === 'string') setSleep(restored.sleep);
        if (restored.direction) setDirection(restored.direction);
      }}
      exportText={report}
      exportName="jet-lag-plan.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Leaving from">
          <select value={home} onChange={(e) => setHome(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {ZONES.map((zone) => <option key={zone.label} value={zone.offset}>{zone.label} · UTC{zone.offset >= 0 ? '+' : ''}{zone.offset}</option>)}
          </select>
        </Field>
        <Field label="Flying to">
          <select value={destination} onChange={(e) => setDestination(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {ZONES.map((zone) => <option key={zone.label + 'd'} value={zone.offset}>{zone.label} · UTC{zone.offset >= 0 ? '+' : ''}{zone.offset}</option>)}
          </select>
        </Field>
        <Field label="Departure date"><input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
        <Field label="Flight time, hours"><input value={flightHours} onChange={(e) => setFlightHours(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
        <Field label="Usual wake time"><input type="time" value={wake} onChange={(e) => setWake(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
        <Field label="Usual bedtime"><input type="time" value={sleep} onChange={(e) => setSleep(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
        <Field label="Direction of travel">
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="east">Eastward — clock ahead</option>
            <option value="west">Westward — clock back</option>
          </select>
        </Field>
        <Field label="Net shift">
          <div className="flex h-9 items-center font-mono-j text-sm text-cyan-j">{result.travelling > 0 ? '+' : ''}{result.travelling.toFixed(1)} h · {result.rate} h a day</div>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.severity === 'severe' ? 'rose' : result.severity === 'substantial' ? 'amber' : 'emerald'}
          label="Days to adjust"
          value={String(result.days)}
          unit={result.days === 1 ? 'day' : 'days'}
          sub={'A shift of ' + result.magnitude.toFixed(1) + ' hours is ' + result.severity + ' jet lag. Adjusting in the ' + direction + ' direction runs at about ' + result.rate + ' hours a day, so the whole shift needs ' + result.days + ' days of deliberate light and sleep timing.'}
        />
        <Ring
          value={result.magnitude}
          max={12}
          tone={result.magnitude > 8 ? 'rose' : 'amber'}
          label="Shift against a body clock that can move about 1 hour a day"
          sub={'Arriving ' + result.arrivalDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) + ' with your body still on home time'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Day by day, in local time at your destination</span>
          <CopyBtn value={report} label="Copy the plan" />
        </div>
        <div className="space-y-2">
          {result.plan.map((entry) => (
            <div key={entry.day} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-medium">{entry.day === 0 ? 'Arrival day' : 'Day ' + entry.day} · {entry.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className="font-mono-j text-muted-foreground">{Math.abs(entry.remaining).toFixed(1)} h still to shift</span>
              </div>
              <div className="mt-2 grid gap-1.5 font-mono-j text-[11px] sm:grid-cols-4">
                <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1">
                  <div className="text-[9px] uppercase text-muted-foreground">Sleep</div>
                  <div className="text-cyan-j">{entry.targetSleep}</div>
                </div>
                <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1">
                  <div className="text-[9px] uppercase text-muted-foreground">Wake</div>
                  <div className="text-cyan-j">{entry.targetWake}</div>
                </div>
                <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1">
                  <div className="text-[9px] uppercase text-muted-foreground">Seek light</div>
                  <div>{entry.seek.window}</div>
                </div>
                <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1">
                  <div className="text-[9px] uppercase text-muted-foreground">Avoid light</div>
                  <div>{entry.avoid.window}</div>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{entry.note}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before you fly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· {result.preTrip}</p>
            <p>· Book flights that land in the late afternoon or early evening where you can. Arriving with a few hours of daylight left makes the first night far easier.</p>
            <p>· Set your watch, and ideally your phone, to destination time as soon as you board. Eating and sleeping on the plane to the new schedule helps more than it sounds.</p>
            <p>· Drink water rather than alcohol on the flight. Alcohol at altitude disturbs sleep and dehydrates, which amplifies the disorientation on arrival.</p>
            <p>· Pack for the first morning: eye mask, earplugs and, if you know you will wake early, something to do quietly without light.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">On the plane</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· {result.planeAdvice}</p>
            <p>· Aim to arrive at the destination with 6 to 8 hours of sleep behind you if the flight crosses a night, rather than chasing a full eight hours in a seat.</p>
            <p>· Meals are a useful anchor: eating at destination mealtimes, even when not hungry, is one of the strongest signals the body clock responds to.</p>
            <p>· The last two hours of the flight are the important ones. Set your sleep and wake so you step off into local daytime.</p>
            <p>· Do not nap on arrival unless it is a short 20 minute rest before local evening.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Direction changes everything</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Eastward travel shortens the day, so the body has to advance its clock — the harder direction, and the one that most people underestimate.</p>
            <p>· Westward travel lengthens the day, which the body adapts to more easily. The evenings feel long and you wake early, but the fog lifts faster.</p>
            <p>· This trip shifts {result.magnitude.toFixed(1)} hours {direction}ward, so the practical rate is about {result.rate} hours a day.</p>
            <p>· A shift of more than 9 hours is often easier to handle by adapting in the other direction entirely — treating the destination as a new schedule rather than a shifted one.</p>
            <p>· Light is the strongest lever and the only free one. Meals and exercise are secondary anchors; caffeine can mask the timing but cannot move the clock.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Expectations worth setting</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The first night is usually poor whatever you do. The plan is about the following three days, not the first one.</p>
            <p>· Waking at 3 am wide awake on the second day is normal and is the signal to stay in bed without light until your wake time.</p>
            <p>· Sleepiness in the mid-afternoon on day one is not a reason for a long nap — a long nap pushes the whole plan back a day.</p>
            <p>· Age, chronotype and general sleep debt all change the pace. Night owls generally adapt faster going west, morning people faster going east.</p>
            <p>· Return trips usually need the same treatment, so plan the recovery days as well as the outbound ones.</p>
            <p>· If the direction is reversed at short notice, the plan above is still the right method. Only the light windows need to swap round.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Shift', value: result.travelling.toFixed(1) + ' h' },
                { label: 'Direction', value: direction },
                { label: 'Days', value: String(result.days) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Shift" value={(result.travelling > 0 ? '+' : '') + result.travelling.toFixed(1) + ' h'} mono sub={direction + 'ward'} />
        <Stat label="Adaptation" value={result.rate + ' h/day'} mono sub="with good light timing" />
        <Stat label="Days needed" value={String(result.days)} mono />
        <Stat label="Severity" value={result.severity} mono sub={result.magnitude.toFixed(1) + ' h shift'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the plan is worked out</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>shift = destination offset − home offset</p>
          <p>hours adapted on day d = rate × d, with rate 1 h eastward and 1.5 h westward</p>
          <p>target bedtime = usual bedtime + (shift − hours adapted)</p>
          <p>light windows follow the bedtime and wake times of the body clock, not the local clock</p>
          <p className="text-cyan-j">Your body clock stays at {clock(result.bodyClockAtArrival)} home time while the local clock reads {clock(result.bodyClockAtArrival + result.shift)} — that gap is the jet lag.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The shift between two fixed offsets is exact; the adaptation rate is a working rule of thumb from typical travellers, not a guarantee. Treat the windows as
          guidance for light exposure and sleep timing and adjust from how you actually feel in the first two days.
        </p>
      </Panel>
    </ToolShell>
  );
}