import { useMemo, useState } from 'react';
import { Plus, ShoppingCart, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const CATEGORIES = ['Produce', 'Bakery', 'Dairy & Eggs', 'Meat & Fish', 'Pantry', 'Frozen', 'Drinks', 'Household', 'Other'];

const START = [
  { id: uid(), name: 'Bananas', qty: '6', unit: 'each', price: '0.25', category: 'Produce', done: false },
  { id: uid(), name: 'Whole milk', qty: '2', unit: 'l', price: '1.45', category: 'Dairy & Eggs', done: false },
  { id: uid(), name: 'Chicken breast', qty: '1', unit: 'kg', price: '8.90', category: 'Meat & Fish', done: false },
  { id: uid(), name: 'Coffee beans', qty: '1', unit: 'pack', price: '11.50', category: 'Pantry', done: false },
  { id: uid(), name: 'Dishwasher tablets', qty: '1', unit: 'box', price: '6.20', category: 'Household', done: false },
];

const CURRENCY = '$';

export default function GroceryPlanner() {
  const [items, setItems] = useState(START);
  const [budget, setBudget] = useState('80');
  const [draft, setDraft] = useState({ name: '', qty: '1', unit: 'each', price: '', category: 'Produce' });

  const totals = useMemo(() => {
    const line = (item) => (Number(item.qty) || 0) * (Number(item.price) || 0);
    const withTotals = items.map((item) => ({ ...item, line: line(item) }));
    const basket = withTotals.reduce((sum, item) => sum + item.line, 0);
    const bought = withTotals.filter((item) => item.done);
    const spent = bought.reduce((sum, item) => sum + item.line, 0);
    const remaining = (Number(budget) || 0) - basket;
    const byCategory = CATEGORIES
      .map((category) => ({
        label: category.length > 9 ? `${category.slice(0, 8)}…` : category,
        value: withTotals.filter((item) => item.category === category).reduce((sum, item) => sum + item.line, 0),
      }))
      .filter((row) => row.value > 0);
    const most = [...withTotals].sort((a, b) => b.line - a.line)[0];
    return { withTotals, basket, spent, remaining, byCategory, most, boughtCount: bought.length };
  }, [items, budget]);

  const grouped = useMemo(() => CATEGORIES
    .map((category) => ({ category, rows: totals.withTotals.filter((item) => item.category === category) }))
    .filter((group) => group.rows.length), [totals]);

  const setItem = (id, patch) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const addDraft = () => {
    if (!draft.name.trim()) return;
    setItems((current) => [...current, { id: uid(), ...draft, name: draft.name.trim(), done: false }]);
    setDraft({ name: '', qty: '1', unit: 'each', price: '', category: draft.category });
  };

  const report = [
    `Shopping list · basket ${CURRENCY}${totals.basket.toFixed(2)}${budget ? ` of ${CURRENCY}${Number(budget).toFixed(2)}` : ''}`,
    '',
    ...grouped.flatMap((group) => [
      `${group.category} — ${CURRENCY}${group.rows.reduce((sum, row) => sum + row.line, 0).toFixed(2)}`,
      ...group.rows.map((row) => `  [${row.done ? 'x' : ' '}] ${row.name} — ${row.qty} ${row.unit} × ${CURRENCY}${row.price} = ${CURRENCY}${row.line.toFixed(2)}`),
    ]),
  ].join('\n');

  return (
    <ToolShell
      toolId="grocery"
      icon={ShoppingCart}
      title="Grocery List & Budget"
      desc="A real shopping list that adds itself up aisle by aisle, so the total is not a surprise at the till."
      state={{ items, budget }}
      onRestore={(restored) => {
        if (Array.isArray(restored.items) && restored.items.length) setItems(restored.items);
        if (restored.budget !== undefined) setBudget(String(restored.budget));
      }}
      exportText={report}
      exportName="grocery-list.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Field label="Budget">
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono-j text-xs text-muted-foreground">{CURRENCY}</span>
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent pl-6 pr-2 text-right font-mono-j text-sm" />
          </div>
        </Field>
        <div className="self-end">
          <CopyBtn value={report} label="Copy list" />
        </div>
        <div className="self-end">
          <button
            type="button"
            onClick={() => setItems((current) => current.map((item) => ({ ...item, done: false })))}
            className="rounded-lg border border-border/70 px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
          >
            Untick everything
          </button>
        </div>
      </div>

      <div className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-3">
        <div className="mb-2 text-xs font-medium">Add an item</div>
        <div className="grid gap-2 sm:grid-cols-[2fr_0.8fr_1fr_1fr_1.4fr_auto]">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addDraft()} placeholder="Item" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
          <input value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} inputMode="decimal" placeholder="Qty" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
          <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="Unit" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
          <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} inputMode="decimal" placeholder="Price" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button type="button" onClick={addDraft} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={totals.remaining < 0 ? 'rose' : 'cyan'}
          label="Basket total"
          value={`${CURRENCY}${totals.basket.toFixed(2)}`}
          sub={budget
            ? totals.remaining >= 0
              ? `${CURRENCY}${totals.remaining.toFixed(2)} left of your ${CURRENCY}${Number(budget).toFixed(2)} budget`
              : `${CURRENCY}${Math.abs(totals.remaining).toFixed(2)} over budget — trim before you shop, not at the till`
            : `${items.length} items on the list`}
        />
        <Ring
          value={Math.min(totals.basket, Number(budget) || totals.basket || 1)}
          max={Number(budget) || totals.basket || 1}
          tone={totals.remaining < 0 ? 'rose' : totals.basket > (Number(budget) || 0) * 0.85 ? 'amber' : 'emerald'}
          label="Budget used"
          sub={`${totals.boughtCount} of ${items.length} items picked up`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {grouped.map((group) => (
          <div key={group.category} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">{group.category}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{CURRENCY}{group.rows.reduce((sum, row) => sum + row.line, 0).toFixed(2)}</span>
            </div>
            <div className="space-y-1.5">
              {group.rows.map((item) => (
                <div key={item.id} className="grid grid-cols-[auto_1.6fr_0.7fr_0.7fr_0.9fr_auto] items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setItem(item.id, { done: !item.done })}
                    className={`grid h-5 w-5 place-items-center rounded border text-[10px] transition ${item.done ? 'border-cyan-j bg-cyan-j/20 text-cyan-j' : 'border-border/70 text-transparent'}`}
                  >
                    ✓
                  </button>
                  <input value={item.name} onChange={(e) => setItem(item.id, { name: e.target.value })} className={`h-7 rounded-md border border-input bg-transparent px-2 text-[11px] ${item.done ? 'line-through opacity-60' : ''}`} />
                  <input value={item.qty} onChange={(e) => setItem(item.id, { qty: e.target.value })} inputMode="decimal" className="h-7 rounded-md border border-input bg-transparent px-1.5 text-right font-mono-j text-[10px]" />
                  <input value={item.unit} onChange={(e) => setItem(item.id, { unit: e.target.value })} className="h-7 rounded-md border border-input bg-transparent px-1.5 text-[10px]" />
                  <input value={item.price} onChange={(e) => setItem(item.id, { price: e.target.value })} inputMode="decimal" className="h-7 rounded-md border border-input bg-transparent px-1.5 text-right font-mono-j text-[10px]" />
                  <button type="button" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))} className="text-muted-foreground transition hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where the money goes</div>
        <Bars data={totals.byCategory} format={(value) => `${CURRENCY}${value.toFixed(0)}`} highlightLast={false} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {totals.most ? `Biggest single line: ${totals.most.name} at ${CURRENCY}${totals.most.line.toFixed(2)}.` : 'Add items to see the breakdown.'}{' '}
          Categories are ordered by how a shop is usually laid out, so the list runs in aisle order and you walk it once.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Items" value={String(items.length)} mono />
        <Stat label="Picked up" value={`${totals.boughtCount}`} mono />
        <Stat label="Unit lines" value={String(totals.byCategory.length)} mono sub="categories in the basket" />
        <Stat label="Average line" value={`${CURRENCY}${(items.length ? totals.basket / items.length : 0).toFixed(2)}`} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Shopping so the total stays honest</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Enter a price you actually remember for each line, not an optimistic one — the total is only useful if the numbers are real.</p>
          <p>· Sort by price before you go: {totals.most ? `${totals.most.name} alone is ${((totals.most.line / Math.max(0.01, totals.basket)) * 100).toFixed(0)}% of the basket.` : 'knowing the biggest line tells you where to substitute.'}</p>
          <p>· Buy the heavy or bulky items last so you are not carrying them around the whole shop.</p>
          <p>· Tick items off as you go — the ring tells you how much of the budget is already spent versus still planned.</p>
          <p>· A budget that is always exceeded is too low, not a moral failing. Set it from three real shops and then trim the category that keeps overshooting.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Basket', value: `${CURRENCY}${totals.basket.toFixed(2)}` },
              { label: 'Budget', value: budget ? `${CURRENCY}${Number(budget).toFixed(0)}` : 'none' },
              { label: 'Left', value: `${CURRENCY}${totals.remaining.toFixed(2)}` },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Quantities and unit prices are kept separately, so changing a pack size does not mean redoing the maths — put the price per item (or per kilo) in
          the price column and the maths keeps up. Nothing here is a database: the list lives in this page and travels with the share link if you send one to
          whoever is doing the shopping.
        </p>
      </Panel>
    </ToolShell>
  );
}