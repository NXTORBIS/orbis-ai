import { useMemo, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const CATEGORIES = ['Electronics', 'Furniture', 'Appliance', 'Clothing', 'Tools', 'Kitchen', 'Outdoor', 'Other'];

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const blank = () => ({ id: Math.random().toString(36).slice(2), room: '', item: '', category: 'Electronics', quantity: '1', value: '', year: '' });

export default function HomeInventory() {
  const [rows, setRows] = useState([
    { id: 'a', room: 'Living room', item: 'Television', category: 'Electronics', quantity: '1', value: '750', year: '2023' },
    { id: 'b', room: 'Living room', item: 'Sofa', category: 'Furniture', quantity: '1', value: '900', year: '2022' },
    { id: 'c', room: 'Kitchen', item: 'Fridge freezer', category: 'Appliance', quantity: '1', value: '620', year: '2024' },
    { id: 'd', room: 'Bedroom', item: 'Wardrobe', category: 'Furniture', quantity: '2', value: '380', year: '2021' },
    { id: 'e', room: 'Home office', item: 'Laptop', category: 'Electronics', quantity: '1', value: '1250', year: '2024' },
    { id: 'f', room: 'Home office', item: 'Desk chair', category: 'Furniture', quantity: '1', value: '310', year: '2023' },
  ]);
  const [inflation, setInflation] = useState('4');
  const [currentYear, setCurrentYear] = useState(String(new Date().getFullYear()));

  const set = (id, key, value) => setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const now = Number(currentYear) || new Date().getFullYear();
    const rate = (Number(inflation) || 0) / 100;

    const items = rows.map((row) => {
      const quantity = Number(row.quantity) || 0;
      const unit = Number(row.value) || 0;
      const year = Number(String(row.year).replace(/[^\d]/g, '')) || null;
      const total = quantity * unit;
      const age = year ? Math.max(0, now - year) : 0;
      const replacement = total * Math.pow(1 + rate, age);
      return { ...row, quantity, unit, total, year, age, replacement, category: row.category || 'Other', room: row.room || 'Unassigned' };
    });

    const byRoom = {};
    const byCategory = {};
    items.forEach((item) => {
      byRoom[item.room] = (byRoom[item.room] || 0) + item.total;
      byCategory[item.category] = (byCategory[item.category] || 0) + item.total;
    });

    const total = items.reduce((sum, item) => sum + item.total, 0);
    const replacement = items.reduce((sum, item) => sum + item.replacement, 0);
    const rooms = Object.entries(byRoom).map(([label, value]) => ({ label, value, share: total ? (value / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
    const categories = Object.entries(byCategory).map(([label, value]) => ({ label, value, share: total ? (value / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
    const top = [...items].sort((a, b) => b.total - a.total).slice(0, 5);

    return {
      items, rooms, categories, total, replacement, top,
      units: items.reduce((sum, item) => sum + item.quantity, 0),
      average: items.length ? total / items.length : 0,
      inflated: replacement - total,
      oldest: [...items].filter((item) => item.year).sort((a, b) => (a.year || 0) - (b.year || 0))[0],
    };
  }, [rows, inflation, currentYear]);

  const report = useMemo(() => [
    'Home inventory — ' + result.items.length + ' lines, ' + result.units + ' items',
    'Current value: ' + money(result.total),
    'Replacement at ' + inflation + '% a year: ' + money(result.replacement),
    '',
    ...result.items.map((item) => [item.room, item.item, item.category, item.quantity + '×', money(item.unit), item.year || '', 'total ' + money(item.total)].join(' · ')),
    '',
    ...result.rooms.map((room) => room.label + ': ' + money(room.value) + ' (' + room.share.toFixed(0) + '%)'),
    '',
    ...result.categories.map((category) => category.label + ': ' + money(category.value) + ' (' + category.share.toFixed(0) + '%)'),
  ].join('\n'), [result, inflation]);

  const downloadCsv = () => {
    const header = ['Room', 'Item', 'Category', 'Quantity', 'Unit value', 'Year', 'Line total'];
    const lines = [header.join(',')].concat(result.items.map((item) => [
      '"' + item.room + '"', '"' + item.item + '"', item.category, item.quantity, item.unit, item.year || '', item.total,
    ].join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'home-inventory.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="home-inventory"
      icon={Layers}
      title="Home Inventory & Contents Value"
      desc="List what you own room by room with values and purchase years — totals per room and category, a replacement cost allowance for inflation, and a CSV for your insurer."
      state={{ rows, inflation, currentYear }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.inflation !== undefined) setInflation(String(restored.inflation));
        if (restored.currentYear !== undefined) setCurrentYear(String(restored.currentYear));
      }}
      exportText={report}
      exportName="home-inventory.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current year"><input value={currentYear} onChange={(e) => setCurrentYear(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inflation to allow for, % a year"><input value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Add a line">
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blank()])}
            className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-cyan-j/50 bg-cyan-j/10 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Plus className="h-3.5 w-3.5" /> New item
          </button>
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Everything you own</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.items.length} lines · {result.units} items</span>
        </div>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-7">
              <Field label={index === 0 ? 'Room' : ''}>
                <input value={row.room} onChange={(e) => set(row.id, 'room', e.target.value)} placeholder="Kitchen" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
              </Field>
              <Field label={index === 0 ? 'Item' : ''}>
                <input value={row.item} onChange={(e) => set(row.id, 'item', e.target.value)} placeholder="Oven" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
              </Field>
              <Field label={index === 0 ? 'Category' : ''}>
                <select value={row.category} onChange={(e) => set(row.id, 'category', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </Field>
              <Field label={index === 0 ? 'Qty' : ''}>
                <input value={row.quantity} onChange={(e) => set(row.id, 'quantity', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label={index === 0 ? 'Unit value' : ''}>
                <input value={row.value} onChange={(e) => set(row.id, 'value', e.target.value)} inputMode="numeric" placeholder="0" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label={index === 0 ? 'Year bought' : ''}>
                <input value={row.year} onChange={(e) => set(row.id, 'year', e.target.value)} inputMode="numeric" placeholder="2023" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <div className="flex items-end gap-2">
                <span className="font-mono-j text-[11px] text-cyan-j">{money((Number(row.quantity) || 0) * (Number(row.value) || 0))}</span>
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                  className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg border border-border/60 px-2 text-[11px] text-muted-foreground transition hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Contents value today"
          value={money(result.total)}
          sub={'Replacing everything at ' + inflation + '% a year of inflation would cost about ' + money(result.replacement) + ' — ' + money(result.inflated) + ' more than the current value.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">By room</div>
          <div className="space-y-1.5">
            {result.rooms.map((room) => (
              <div key={room.label}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{room.label}</span>
                  <span className="font-mono-j">{money(room.value)} · {room.share.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: room.share + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">By category</div>
          <Bars
            data={result.categories.map((category) => ({ label: category.label.slice(0, 10), value: category.value }))}
            format={(value) => money(value)}
            suffix=""
            highlightLast={false}
          />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Most valuable items</span>
            <CopyBtn value={report} label="Copy the inventory" />
          </div>
          <div className="space-y-1.5">
            {result.top.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="truncate">{item.item || 'Unnamed'}</span>
                <span className="ml-2 shrink-0 font-mono-j text-muted-foreground">{item.room}</span>
                <span className="ml-2 shrink-0 font-mono-j text-cyan-j">{money(item.total)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={downloadCsv} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              Download CSV for the insurer
            </button>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Whole-house summary</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Total value" value={money(result.total)} mono />
          <Stat label="Items" value={String(result.units)} mono sub={result.items.length + ' lines'} />
          <Stat label="Average line" value={money(result.average)} mono />
          <Stat label="Replacement" value={money(result.replacement)} mono sub={inflation + '% a year'} />
        </div>
        <div className="mt-3">
          <Pills
            items={[
              { label: 'Rooms', value: String(result.rooms.length) },
              { label: 'Categories', value: String(result.categories.length) },
              { label: 'Oldest item', value: result.oldest && result.oldest.year ? String(result.oldest.year) : '—' },
            ]}
          />
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why an inventory is worth the hour</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· After a fire or flood nobody can remember what was in a cupboard, let alone what it cost. A list written calmly is worth far more than a perfect one written in a crisis.</p>
            <p>· Insurers settle on evidence. Purchase years and values turn a claim from a negotiation into an arithmetic exercise.</p>
            <p>· Total contents cover is usually set too low, and the shortfall only appears when it is needed. {money(result.total)} plus the inflation allowance is the figure to check against your policy.</p>
            <p>· High-value single items are often excluded or capped. Your top five lines total {money(result.top.reduce((sum, item) => sum + item.total, 0))} — check whether each needs naming separately on the policy.</p>
            <p>· The same list is useful when moving house: it gives you the weight to quote and a checklist to tick off on arrival.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Keeping it accurate</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Walk one room at a time with the list open. Doing it in one sweep per room is faster than trying to recall the whole house.</p>
            <p>· Photograph receipts for anything substantial and store them with the item's line. A photograph of the item itself is the second-best evidence.</p>
            <p>· Use the price to replace the item today, not what you paid for it — that is what the policy covers.</p>
            <p>· The inflation allowance compounds from the year of purchase, which is why older items can cost surprisingly more to replace than the figure you wrote down.</p>
            <p>· Review once a year. Sell something, remove it; buy something, add it. Fifteen minutes annually keeps the total honest.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the replacement figure is worked out</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>Line total = quantity × unit value</p>
          <p>Replacement = line total × (1 + rate) ^ (current year − purchase year)</p>
          <p className="text-cyan-j">The difference of {money(result.inflated)} is the effect of inflation since each item was bought, compounding per item rather than in one blanket allowance.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every line keeps its own purchase year, so the inflation allowance compounds from the right starting point for each item instead of applying one blanket
          uplift to the whole house. The CSV export uses exactly the numbers shown here, ready to send with a policy application.
        </p>
      </Panel>
    </ToolShell>
  );
}