import { useMemo, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const START = {
  people: [
    { id: 'p1', name: 'You' },
    { id: 'p2', name: 'Priya' },
    { id: 'p3', name: 'Sam' },
  ],
  expenses: [
    { id: uid(), label: 'Groceries', amount: '84', paidBy: 'p1', among: ['p1', 'p2', 'p3'] },
    { id: uid(), label: 'Taxi', amount: '36', paidBy: 'p2', among: ['p1', 'p2', 'p3'] },
    { id: uid(), label: 'Dinner', amount: '129', paidBy: 'p3', among: ['p1', 'p2', 'p3'] },
  ],
};

const money = (value) => (Math.round((Number(value) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExpenseSplitter() {
  const [people, setPeople] = useState(START.people);
  const [expenses, setExpenses] = useState(START.expenses);
  const [newName, setNewName] = useState('');

  const computed = useMemo(() => {
    const balances = new Map(people.map((p) => [p.id, 0]));
    expenses.forEach((expense) => {
      const amount = Number(expense.amount) || 0;
      const sharers = (expense.among || []).filter((id) => balances.has(id));
      if (!sharers.length) return;
      const share = amount / sharers.length;
      balances.set(expense.paidBy, (balances.get(expense.paidBy) || 0) + amount);
      sharers.forEach((id) => balances.set(id, (balances.get(id) || 0) - share));
    });
    const entries = [...balances.entries()].map(([id, balance]) => ({
      id,
      name: people.find((p) => p.id === id)?.name || 'Someone',
      balance: Math.round(balance * 100) / 100,
    }));
    const debtors = entries.filter((e) => e.balance < -0.004).map((e) => ({ ...e, owed: -e.balance })).sort((a, b) => b.owed - a.owed);
    const creditors = entries.filter((e) => e.balance > 0.004).map((e) => ({ ...e, due: e.balance })).sort((a, b) => b.due - a.due);
    const transfers = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].owed, creditors[j].due);
      if (amount > 0.004) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: Math.round(amount * 100) / 100 });
      debtors[i].owed -= amount;
      creditors[j].due -= amount;
      if (debtors[i].owed <= 0.004) i += 1;
      if (creditors[j].due <= 0.004) j += 1;
    }
    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return { entries, transfers, total, perHead: people.length ? total / people.length : 0 };
  }, [people, expenses]);

  const setExpense = (id, patch) => setExpenses((current) => current.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const toggleSharer = (expense, id) => {
    const among = expense.among || [];
    setExpense(expense.id, { among: among.includes(id) ? among.filter((x) => x !== id) : [...among, id] });
  };

  const addPerson = () => {
    const name = newName.trim();
    if (!name) return;
    const id = uid();
    setPeople((current) => [...current, { id, name }]);
    setExpenses((current) => current.map((e) => ({ ...e, among: [...(e.among || []), id] })));
    setNewName('');
  };

  const report = [
    `Total spent: ${money(computed.total)} · ${people.length} people · ${money(computed.perHead)} each on average`,
    '',
    'Balances:',
    ...computed.entries.map((e) => `${e.name}: ${e.balance >= 0 ? '+' : ''}${money(e.balance)}`),
    '',
    'Settle up:',
    ...(computed.transfers.length ? computed.transfers.map((t) => `${t.from} pays ${t.to} ${money(t.amount)}`) : ['Nobody owes anybody anything.']),
  ].join('\n');

  return (
    <ToolShell
      toolId="split-expenses"
      icon={Wallet}
      title="Group Expense Splitter"
      desc="Log who paid what for whom, then settle the whole trip in the fewest possible transfers."
      state={{ people, expenses, newName }}
      onRestore={(restored) => {
        if (Array.isArray(restored.people) && restored.people.length) setPeople(restored.people);
        if (Array.isArray(restored.expenses)) setExpenses(restored.expenses);
      }}
      exportText={report}
      exportName="expense-split.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Who is in</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {people.map((person) => (
            <span key={person.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1 text-[11px]">
              {person.name}
              <button
                type="button"
                onClick={() => {
                  setPeople(people.filter((p) => p.id !== person.id));
                  setExpenses(expenses.map((e) => ({ ...e, among: (e.among || []).filter((id) => id !== person.id) })));
                }}
                disabled={people.length <= 2}
                className="text-muted-foreground transition hover:text-red-500 disabled:opacity-30"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addPerson(); }}
            placeholder="Add a name"
            className="h-8 w-32 rounded-md border border-input bg-transparent px-2.5 text-[11px]"
          />
          <button type="button" onClick={addPerson} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j">
            Add
          </button>
        </div>
      </Panel>

      <div className="space-y-2">
        {expenses.map((expense) => (
          <div key={expense.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-3">
            <div className="grid grid-cols-[1fr_96px_auto] items-center gap-2">
              <input value={expense.label} onChange={(e) => setExpense(expense.id, { label: e.target.value })} placeholder="What was it" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input value={expense.amount} onChange={(e) => setExpense(expense.id, { amount: e.target.value })} inputMode="decimal" placeholder="Amount" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <button type="button" onClick={() => setExpenses(expenses.filter((e) => e.id !== expense.id))} className="justify-self-end text-muted-foreground transition hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="Paid by">
                <select value={expense.paidBy} onChange={(e) => setExpense(expense.id, { paidBy: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </Field>
              <Field label="Split between" hint="click names to include or leave out">
                <div className="flex flex-wrap gap-1.5">
                  {people.map((person) => {
                    const on = (expense.among || []).includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => toggleSharer(expense, person.id)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${on ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
                      >
                        {person.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {(expense.among || []).length ? `${money((Number(expense.amount) || 0) / (expense.among || []).length)} each` : 'Nobody selected yet'}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpenses((current) => [...current, { id: uid(), label: '', amount: '', paidBy: people[0].id, among: people.map((p) => p.id) }])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add an expense
        </button>
        <CopyBtn value={report} label="Copy settlement" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Settle up in the fewest transfers</div>
        <div className="space-y-1.5">
          {computed.transfers.map((transfer) => (
            <div key={`${transfer.from}-${transfer.to}`} className="flex items-center justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-2 text-[11px]">
              <span><span className="text-cyan-j">{transfer.from}</span> → <span className="text-cyan-j">{transfer.to}</span></span>
              <span className="font-mono-j">{money(transfer.amount)}</span>
            </div>
          ))}
          {!computed.transfers.length && <span className="text-[11px] text-muted-foreground">Everyone is square — no transfers needed.</span>}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Total spent" value={money(computed.total)} mono />
        <Stat label="Average per head" value={money(computed.perHead)} mono />
        <Stat label="Transfers needed" value={String(computed.transfers.length)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Who is up, who is down</div>
        <div className="space-y-1">
          {computed.entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span>{entry.name}</span>
              <span className={`font-mono-j ${entry.balance >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{entry.balance >= 0 ? '+' : ''}{money(entry.balance)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Unequal splits are handled properly — leave someone out of a dinner they skipped and their share is redistributed among the rest. The
          settlement uses the greedy least-transfers approach, so a five-person trip usually clears in three or four payments instead of a dozen.
        </p>
      </Panel>
    </ToolShell>
  );
}