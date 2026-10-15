import { useMemo, useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const TODAY = new Date().toISOString().slice(0, 10);
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const START = [
  { id: uid(), name: 'Music streaming', cost: '11.99', cycle: 'monthly', renewal: inDays(6), essential: true },
  { id: uid(), name: 'Cloud storage', cost: '8.99', cycle: 'monthly', renewal: inDays(14), essential: true },
  { id: uid(), name: 'Video streaming', cost: '15.99', cycle: 'monthly', renewal: inDays(3), essential: false },
  { id: uid(), name: 'Gym', cost: '42.00', cycle: 'monthly', renewal: inDays(21), essential: false },
  { id: uid(), name: 'Software suite', cost: '119.00', cycle: 'yearly', renewal: inDays(120), essential: false },
  { id: uid(), name: 'News', cost: '4.50', cycle: 'monthly', renewal: inDays(9), essential: false },
];

const CYCLES = [
  { value: 'weekly', label: 'Weekly', perYear: 52 },
  { value: 'monthly', label: 'Monthly', perYear: 12 },
  { value: 'quarterly', label: 'Quarterly', perYear: 4 },
  { value: 'yearly', label: 'Yearly', perYear: 1 },
];

const perYear = (cost, cycle) => {
  const entry = CYCLES.find((item) => item.value === cycle) || CYCLES[1];
  return (Number(cost) || 0) * entry.perYear;
};

const daysUntil = (date) => {
  if (!date) return null;
  const target = new Date(date + 'T00:00:00').getTime();
  const today = new Date(TODAY + 'T00:00:00').getTime();
  return Math.round((target - today) / 86400000);
};

export default function SubscriptionAudit() {
  const [items, setItems] = useState(START);
  const [horizon, setHorizon] = useState('30');

  const audit = useMemo(() => {
    const rows = items.map((item) => {
      const annual = perYear(item.cost, item.cycle);
      const days = daysUntil(item.renewal);
      const entry = CYCLES.find((cycle) => cycle.value === item.cycle) || CYCLES[1];
      return {
        ...item,
        annual,
        monthly: annual / 12,
        weekly: annual / 52,
        daily: annual / 365,
        days,
        cadence: entry.label,
        chargePerYear: entry.perYear,
      };
    }).sort((a, b) => b.annual - a.annual);

    const total = rows.reduce((sum, row) => sum + row.annual, 0);
    const essential = rows.filter((row) => row.essential).reduce((sum, row) => sum + row.annual, 0);
    const optional = rows.filter((row) => !row.essential);
    const upcoming = rows
      .filter((row) => row.days !== null && row.days >= 0 && row.days <= (Number(horizon) || 30))
      .sort((a, b) => a.days - b.days);
    const soonest = upcoming[0] || null;
    const cut = optional.slice(0, 3);
    const cutValue = cut.reduce((sum, row) => sum + row.annual, 0);
    const topThree = rows.slice(0, 3).reduce((sum, row) => sum + row.annual, 0);
    const monthly = total / 12;

    return {
      rows, total, essential, optional, upcoming, soonest, cut, cutValue,
      monthly, weekly: total / 52, daily: total / 365,
      optionalTotal: optional.reduce((sum, row) => sum + row.annual, 0),
      topShare: total ? (topThree / total) * 100 : 0,
      average: rows.length ? total / rows.length : 0,
      count: rows.length,
    };
  }, [items, horizon]);

  const report = useMemo(() => [
    'Subscriptions · ' + audit.count + ' active · ' + audit.monthly.toFixed(2) + ' a month · ' + audit.total.toFixed(2) + ' a year',
    'Essential ' + audit.essential.toFixed(2) + ' · optional ' + audit.optionalTotal.toFixed(2),
    '',
    ...audit.rows.map((row) => [
      row.name || '(unnamed)',
      row.cost + ' ' + row.cadence.toLowerCase(),
      '= ' + row.monthly.toFixed(2) + '/month',
      '= ' + row.annual.toFixed(2) + '/year',
      row.days === null ? '' : row.days < 0 ? 'renewal date passed' : 'renews in ' + row.days + ' days',
    ].filter(Boolean).join('  ·  ')),
    '',
    audit.cut.length ? 'Cutting ' + audit.cut.map((row) => row.name || 'the unnamed one').join(', ') + ' frees ' + audit.cutValue.toFixed(2) + ' a year.' : '',
  ].filter(Boolean).join('\n'), [audit]);

  const setItem = (id, patch) => setItems((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <ToolShell
      toolId="subscription-audit"
      icon={CalendarClock}
      title="Subscription Audit"
      desc="Everything you pay for on a cycle, added up honestly — what it costs a month and a year, what renews next, and what cancelling would actually save."
      state={{ items, horizon }}
      onRestore={(restored) => {
        if (Array.isArray(restored.items) && restored.items.length) setItems(restored.items);
        if (restored.horizon !== undefined) setHorizon(String(restored.horizon));
      }}
      exportText={report}
      exportName="subscriptions.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label={'Renewals to look at · next ' + horizon + ' days'}>
          <input type="range" min={7} max={180} step={7} value={horizon} onChange={(e) => setHorizon(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="flex items-end">
          <CopyBtn value={report} label="Copy the audit" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Cost of all subscriptions"
          value={audit.monthly.toFixed(2)}
          unit="per month"
          sub={audit.total.toFixed(2) + ' a year · ' + audit.weekly.toFixed(2) + ' a week · ' + audit.daily.toFixed(2) + ' a day across ' + audit.count + ' services'}
        />
        <Ring
          value={audit.topShare}
          max={100}
          tone={audit.topShare > 65 ? 'amber' : 'emerald'}
          label="Your three biggest, as a share"
          sub={audit.topShare.toFixed(0) + '% of the annual total sits in three services'}
        />
      </div>

      <div className="space-y-2">
        {audit.rows.map((row) => (
          <div key={row.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[1.4fr_5rem_7rem_9rem_auto_auto] sm:items-center">
              <input value={row.name} onChange={(e) => setItem(row.id, { name: e.target.value })} placeholder="Service" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input value={row.cost} onChange={(e) => setItem(row.id, { cost: e.target.value })} inputMode="decimal" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <select value={row.cycle} onChange={(e) => setItem(row.id, { cycle: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-[11px]">
                {CYCLES.map((cycle) => <option key={cycle.value} value={cycle.value}>{cycle.label}</option>)}
              </select>
              <input type="date" value={row.renewal} onChange={(e) => setItem(row.id, { renewal: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
              <button
                type="button"
                onClick={() => setItem(row.id, { essential: !row.essential })}
                className={row.essential
                  ? 'rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-400'
                  : 'rounded-lg border border-border/70 px-2 py-1 text-[10px] text-muted-foreground'}
              >
                {row.essential ? 'essential' : 'optional'}
              </button>
              <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== row.id))} className="text-muted-foreground transition hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono-j text-[10px] text-muted-foreground">
              <span>{row.monthly.toFixed(2)}/month · {row.annual.toFixed(2)}/year</span>
              <span className={row.days !== null && row.days <= 7 ? 'text-amber-400' : ''}>
                {row.days === null
                  ? 'no renewal date'
                  : row.days < 0
                    ? 'renewal date has passed'
                    : row.days === 0
                      ? 'renews today'
                      : 'renews in ' + row.days + ' days'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setItems((current) => [...current, { id: uid(), name: '', cost: '', cycle: 'monthly', renewal: inDays(30), essential: false }].slice(0, 40))}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add a subscription
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Annual cost, biggest first</div>
          <Bars
            data={audit.rows.slice(0, 8).map((row) => ({ label: (row.name || '—').slice(0, 10), value: Number(row.annual.toFixed(2)) }))}
            format={(value) => value.toFixed(0)}
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {audit.average > 0 ? 'The average service here costs ' + audit.average.toFixed(2) + ' a year. ' : ''}
            A cheap monthly charge renews twelve times a year, which is why the annual column is the one to read when comparing a monthly plan against a yearly one.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Renewing in the next {horizon} days</div>
          <div className="space-y-1">
            {audit.upcoming.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span>{row.name || '(unnamed)'}</span>
                <span className={row.days <= 7 ? 'font-mono-j text-amber-400' : 'font-mono-j text-muted-foreground'}>
                  {row.days === 0 ? 'today' : row.days + 'd'} · {row.cost}
                </span>
              </div>
            ))}
            {!audit.upcoming.length && <span className="text-[11px] text-muted-foreground">Nothing renews in this window — widen it to see further ahead.</span>}
          </div>
          {audit.soonest && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Next up is {audit.soonest.name || 'an unnamed service'} at {audit.soonest.cost} in {audit.soonest.days} day{audit.soonest.days === 1 ? '' : 's'}. That is the
              decision point: cancel before it charges or accept another{' '}
              {audit.soonest.cadence.toLowerCase()} cycle at {audit.soonest.annual.toFixed(2)} a year.
            </p>
          )}
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Optional services, most expensive first</div>
        <div className="space-y-1.5">
          {audit.optional.slice(0, 6).map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span>{row.name || '(unnamed)'}</span>
              <span className="font-mono-j text-muted-foreground">{row.monthly.toFixed(2)}/month · {row.annual.toFixed(2)}/year</span>
            </div>
          ))}
          {!audit.optional.length && <span className="text-[11px] text-muted-foreground">Everything here is marked essential — the honest question is whether it really is.</span>}
        </div>
        {!!audit.cutValue && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Cancelling the three most expensive optional services ({audit.cut.map((row) => row.name || 'unnamed').join(', ')}) frees{' '}
            <span className="text-cyan-j">{audit.cutValue.toFixed(2)} a year</span> — about {(audit.cutValue / 12).toFixed(2)} a month, or {(audit.cutValue / 52).toFixed(2)} a week.
          </p>
        )}
        <div className="mt-3">
          <ToggleRow label="Count essentials separately" checked={true} onChange={() => {}} hint="Marked per service above" />
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Services" value={String(audit.count)} mono />
        <Stat label="Per month" value={audit.monthly.toFixed(0)} mono />
        <Stat label="Per year" value={audit.total.toFixed(0)} mono />
        <Stat label="Essential share" value={audit.total ? ((audit.essential / audit.total) * 100).toFixed(0) + '%' : '0%'} mono sub="of the total" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Auditing without fooling yourself</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Convert everything to a yearly figure before deciding. A 12-a-month plan and a 119-a-year plan look similar until they sit in the same column.</p>
          <p>· Price rises and silent renewals are the real cost. Put the renewal dates in and check them a week early, while cancelling is still free.</p>
          <p>· Annual plans usually save 15–20% over monthly, but only if you will still use it in eleven months' time.</p>
          <p>· The essential flag is a judgement, not a fact. Software you use daily is essential; a service you have not opened in a month is not, whatever the discount said.</p>
          <p>· Cancel, do not pause, when the pause button only defers the charge — and screenshot the confirmation.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Monthly', value: audit.monthly.toFixed(2) },
              { label: 'Yearly', value: audit.total.toFixed(2) },
              { label: 'Optional', value: audit.optional.length + ' services' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each row is converted to a common yearly basis using its real cadence, so weekly, quarterly and yearly charges compare like for like. Renewal counts are
          worked out from today's date, and past dates are flagged rather than quietly ignored — a renewal date in the past usually means the charge has already
          gone through.
        </p>
      </Panel>
    </ToolShell>
  );
}