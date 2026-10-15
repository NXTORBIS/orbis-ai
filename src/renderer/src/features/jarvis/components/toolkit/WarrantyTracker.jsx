import { useMemo, useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value) => Math.round(value).toLocaleString();

const daysBetween = (from, to) => Math.round((to - from) / 86400000);

const addMonths = (date, months) => {
  const copy = new Date(date.getTime());
  const day = copy.getDate();
  copy.setMonth(copy.getMonth() + months);
  if (copy.getDate() < day) copy.setDate(0);
  return copy;
};

const blank = () => ({ id: Math.random().toString(36).slice(2), name: '', purchased: '', months: '24', price: '', retailer: '' });

export default function WarrantyTracker() {
  const [rows, setRows] = useState([
    { id: 'a', name: 'Washing machine', purchased: '2024-03-14', months: '60', price: '620', retailer: 'Appliance Centre' },
    { id: 'b', name: 'Laptop', purchased: '2024-11-02', months: '24', price: '1240', retailer: 'Online store' },
    { id: 'c', name: 'Headphones', purchased: '2023-08-20', months: '24', price: '180', retailer: 'Airport' },
    { id: 'd', name: 'Espresso machine', purchased: '2022-09-05', months: '36', price: '410', retailer: 'Gift' },
  ]);
  const [filter, setFilter] = useState('all');
  const [window, setWindow] = useState('90');

  const set = (id, key, value) => setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const now = new Date();
    const soon = Math.max(1, Number(window) || 90);
    const items = rows.map((row) => {
      const purchased = row.purchased ? new Date(row.purchased) : null;
      const valid = purchased && !Number.isNaN(purchased.getTime());
      const months = Number(row.months) || 0;
      const expiry = valid ? addMonths(purchased, months) : null;
      const remaining = expiry ? daysBetween(now, expiry) : null;
      const elapsed = valid ? Math.max(0, daysBetween(purchased, now)) : 0;
      const durationDays = months / 12 * 365;
      const used = durationDays ? Math.min(100, (elapsed / durationDays) * 100) : 0;
      const status = remaining === null ? 'unknown' : remaining < 0 ? 'expired' : remaining <= soon ? 'expiring' : 'active';
      return {
        ...row,
        expiry,
        remaining,
        used,
        status,
        price: Number(row.price) || 0,
        months,
        expiredOn: expiry ? expiry.toLocaleDateString() : '—',
      };
    }).sort((a, b) => {
      if (a.remaining === null) return 1;
      if (b.remaining === null) return -1;
      if (a.status === 'expired' && b.status !== 'expired') return 1;
      if (b.status === 'expired' && a.status !== 'expired') return -1;
      return a.remaining - b.remaining;
    });

    const covered = items.filter((entry) => entry.status === 'active' || entry.status === 'expiring');
    const stats = {
      active: covered.length,
      expiring: items.filter((entry) => entry.status === 'expiring').length,
      expired: items.filter((entry) => entry.status === 'expired').length,
      unknown: items.filter((entry) => entry.status === 'unknown').length,
      coveredValue: covered.reduce((sum, entry) => sum + entry.price, 0),
      totalValue: items.reduce((sum, entry) => sum + entry.price, 0),
      expiringValue: items.filter((entry) => entry.status === 'expiring').reduce((sum, entry) => sum + entry.price, 0),
      coveredShare: items.length ? (covered.length / items.length) * 100 : 0,
    };

    const visible = items.filter((entry) => {
      if (filter === 'active') return entry.status === 'active';
      if (filter === 'expiring') return entry.status === 'expiring';
      if (filter === 'expired') return entry.status === 'expired';
      return true;
    });

    return { items, visible, stats };
  }, [rows, filter, window]);

  const report = useMemo(() => [
    'Warranty register — ' + result.stats.active + ' still covered, ' + result.stats.expiring + ' ending within ' + window + ' days',
    'Value under warranty: ' + money(result.stats.coveredValue),
    '',
    ...result.items.map((row) => [
      row.name,
      '  purchased ' + (row.purchased || '—') + ' · ' + row.months + ' months · expires ' + row.expiredOn,
      '  ' + (row.remaining === null ? 'no date' : row.remaining < 0 ? 'expired ' + Math.abs(row.remaining) + ' days ago' : row.remaining + ' days left') + ' · ' + money(row.price) + (row.retailer ? ' · ' + row.retailer : ''),
    ].join('\n')),
  ].join('\n'), [result, window]);

  const badge = (status) => {
    if (status === 'expired') return 'rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground';
    if (status === 'expiring') return 'rounded border border-amber-500/50 px-1.5 py-0.5 text-amber-300';
    if (status === 'active') return 'rounded border border-emerald-500/50 px-1.5 py-0.5 text-emerald-300';
    return 'rounded border border-rose-500/50 px-1.5 py-0.5 text-rose-300';
  };

  return (
    <ToolShell
      toolId="warranty-tracker"
      icon={ShieldCheck}
      title="Warranty & Guarantee Tracker"
      desc="Keep every guarantee in one place — expiry dates worked out from the purchase date, what is about to run out, and the value still protected."
      state={{ rows, window }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.window !== undefined) setWindow(String(restored.window));
      }}
      exportText={report}
      exportName="warranties.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Items, with purchase date and cover length</span>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blank()])}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-6">
              <Field label={index === 0 ? 'Item' : ''}>
                <input value={row.name} onChange={(e) => set(row.id, 'name', e.target.value)} placeholder="What it is" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
              </Field>
              <Field label={index === 0 ? 'Bought' : ''}>
                <input type="date" value={row.purchased} onChange={(e) => set(row.id, 'purchased', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label={index === 0 ? 'Cover, months' : ''}>
                <input value={row.months} onChange={(e) => set(row.id, 'months', e.target.value)} inputMode="numeric" placeholder="24" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label={index === 0 ? 'Price paid' : ''}>
                <input value={row.price} onChange={(e) => set(row.id, 'price', e.target.value)} inputMode="numeric" placeholder="0" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label={index === 0 ? 'Retailer' : ''}>
                <input value={row.retailer} onChange={(e) => set(row.id, 'retailer', e.target.value)} placeholder="Where from" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                  className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-border/60 text-[11px] text-muted-foreground transition hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.stats.expiring ? 'amber' : 'emerald'}
          label={result.stats.expiring
            ? result.stats.expiring + ' guarantee' + (result.stats.expiring === 1 ? '' : 's') + ' ending within ' + window + ' days'
            : 'Nothing ending in the next ' + window + ' days'}
          value={money(result.stats.coveredValue)}
          sub={'Worth of equipment still under guarantee, across ' + result.stats.active + ' item' + (result.stats.active === 1 ? '' : 's') + '. Anything failing before its date can be claimed.'}
        />
        <Ring
          value={result.stats.coveredShare}
          max={100}
          tone={result.stats.coveredShare > 50 ? 'emerald' : 'amber'}
          label="Still covered"
          sub={result.stats.active + ' of ' + result.items.length + ' items · ' + result.stats.expiring + ' ending soon, ' + result.stats.expired + ' already over'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'Everything' }, { value: 'active', label: 'Covered' }, { value: 'expiring', label: 'Ending soon' }, { value: 'expired', label: 'Expired' }]}
        />
        <Seg
          value={window}
          onChange={setWindow}
          options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '6 months' }]}
        />
        <CopyBtn value={report} label="Copy the register" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Soonest to expire first</div>
        <div className="space-y-1.5">
          {result.visible.map((row) => (
            <div key={row.id} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium">{row.name || 'Unnamed item'}</span>
                <span className={badge(row.status)}>
                  {row.status === 'expired' ? 'expired' : row.status === 'expiring' ? 'ending soon' : row.status === 'active' ? 'covered' : 'no date'}
                </span>
                <span className="ml-auto font-mono-j text-[11px] text-muted-foreground">{money(row.price)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono-j text-[10px] text-muted-foreground">
                <span>bought {row.purchased || '—'}</span>
                <span>{row.months} months</span>
                <span>expires {row.expiredOn}</span>
                <span>
                  {row.remaining === null ? 'no date yet' : row.remaining < 0 ? Math.abs(row.remaining) + ' days ago' : row.remaining + ' days left'}
                </span>
                {row.retailer && <span>{row.retailer}</span>}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={row.status === 'expired' ? 'h-full rounded-full bg-slate-500/60' : row.status === 'expiring' ? 'h-full rounded-full bg-amber-400/70' : 'h-full rounded-full bg-emerald-400/70'}
                  style={{ width: row.used + '%' }}
                />
              </div>
            </div>
          ))}
          {!result.visible.length && <p className="text-[12px] text-muted-foreground">Nothing in this view.</p>}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting a claim in before it lapses</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Do it while the fault is fresh. Most guarantees need the fault reported within the cover period, not merely occurring within it.</p>
            <p>· Keep the proof of purchase somewhere you can find it — a photographed receipt in the same note as the item is enough.</p>
            <p>· Quote the purchase date and the cover length when you contact the retailer; it moves the conversation from whether to when.</p>
            <p>· Check what the cover actually includes. Many exclude wear-and-tear parts, and some extend automatically once you register the product.</p>
            <p>· Statutory rights often run beyond the manufacturer's guarantee, so an expired date is not always the end of the story.</p>
            {result.stats.expiringValue > 0 && (
              <p>· {money(result.stats.expiringValue)} of equipment is ending soon — worth a quick check that each item is working properly now rather than discovering a fault afterwards.</p>
            )}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where expiry dates come from</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Expiry is the purchase date plus the cover length in months, clamped to the end of a shorter month so a 14 March purchase runs to 14 March.</p>
            <p>· The bar under each item shows how much of the cover has been used — a long guarantee barely started is worth knowing about when something fails early.</p>
            <p>· Items are sorted by what needs attention first: anything already ended drops to the bottom, and whatever is closest to ending sits at the top.</p>
            <p>· Price is carried through to give the total value protected, which is the figure that makes the register worth keeping.</p>
            <p>· Rows without a date are flagged rather than quietly excluded, since a missing purchase date is exactly what causes a claim to fail.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Still covered" value={String(result.stats.active)} mono sub={money(result.stats.coveredValue) + ' of value'} />
        <Stat label="Ending soon" value={String(result.stats.expiring)} mono sub={'within ' + window + ' days'} />
        <Stat label="Expired" value={String(result.stats.expired)} mono sub="no cover left" />
        <Stat label="Items logged" value={String(result.items.length)} mono sub={money(result.stats.totalValue) + ' paid'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Building the habit</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Add the item the day you buy it. Two minutes at the kitchen table saves an argument two years later.</p>
          <p>· Photograph the receipt and the serial number, and store both next to the item's row in your notes.</p>
          <p>· Diarise the expiring ones at ninety days rather than thirty — a repair arranged while still covered is a very different experience.</p>
          <p>· Note the retailer. Most claims go through the seller in the first year and the manufacturer afterwards.</p>
          <p>· Review the register once a year and remove what you no longer own, so the value under warranty stays meaningful.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Covered', value: String(result.stats.active) },
              { label: 'Ending soon', value: String(result.stats.expiring) },
              { label: 'Protected', value: money(result.stats.coveredValue) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Dates are computed from the purchase date and the cover length, so changing either updates the expiry, the days remaining and the progress bar together.
          Nothing is sent anywhere — the register lives in this tool on this device and is saved as you type.
        </p>
      </Panel>
    </ToolShell>
  );
}