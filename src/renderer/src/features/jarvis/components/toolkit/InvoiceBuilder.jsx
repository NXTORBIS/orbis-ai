import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileJson, Printer, Receipt, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat, ToggleRow, downloadBlob } from './shared';
import { AddLineButton, LineItemRow, TotalsSummary } from './InvoiceParts';
import { buildInvoiceHtml, invoiceTotals, money } from './invoiceDocument';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'ZAR', 'BRL', 'CHF', 'NZD', 'SEK'];

const today = () => new Date().toISOString().slice(0, 10);
const later = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const emptyInvoice = () => ({
  from: { name: 'Your studio', email: 'hello@yourstudio.com', phone: '', address: '', taxId: '' },
  to: { name: 'Client name', email: '', address: '' },
  meta: { number: `INV-${new Date().getFullYear()}-001`, issueDate: today(), dueDate: later(14), currency: 'USD', accent: '#0ea5e9' },
  items: [
    { id: `i${Date.now()}`, description: 'Design and build', qty: 1, rate: 1200 },
    { id: `i${Date.now() + 1}`, description: 'Support retainer', qty: 2, rate: 250 },
  ],
  discountPct: 0,
  taxPct: 0,
  paid: 0,
  notes: 'Thank you for your business.',
  terms: 'Payment due within 14 days. Bank transfer preferred.',
});

export default function InvoiceBuilder() {
  const [invoice, setInvoice] = useState(emptyInvoice);
  const [printed, setPrinted] = useState('');
  const frameRef = useRef(null);

  const deferred = useDeferredValue(invoice);
  const html = useMemo(() => buildInvoiceHtml(deferred), [deferred]);
  const totals = useMemo(() => invoiceTotals(invoice), [invoice]);
  const currency = invoice.meta.currency;

  const setFrom = (patch) => setInvoice((i) => ({ ...i, from: { ...i.from, ...patch } }));
  const setTo = (patch) => setInvoice((i) => ({ ...i, to: { ...i.to, ...patch } }));
  const setMeta = (patch) => setInvoice((i) => ({ ...i, meta: { ...i.meta, ...patch } }));
  const setItem = (id, patch) => setInvoice((i) => ({ ...i, items: i.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  const addItem = () => setInvoice((i) => ({ ...i, items: [...i.items, { id: `i${Date.now()}`, description: '', qty: 1, rate: 0 }] }));
  const removeItem = (id) => setInvoice((i) => ({ ...i, items: i.items.filter((item) => item.id !== id) }));

  const print = () => {
    const frame = frameRef.current;
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setPrinted('print');
    } catch {
      openTab();
    }
    setTimeout(() => setPrinted(''), 2000);
  };

  const openTab = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setPrinted('tab');
    setTimeout(() => setPrinted(''), 2000);
  };

  const saveJson = () => {
    downloadBlob(new Blob([JSON.stringify(invoice, null, 2)], { type: 'application/json' }), `${invoice.meta.number || 'invoice'}.json`);
  };

  const fillSample = () => setInvoice({
    from: { name: 'Northlight Studio', email: 'billing@northlight.studio', phone: '+91 98200 11223', address: '14 Marine Lane\nMumbai 400001', taxId: '27AABCU9603R1ZM' },
    to: { name: 'Harbour Coffee Co.', email: 'accounts@harbourcoffee.com', address: '9 Dock Road\nPanjim 403001' },
    meta: { number: `INV-${new Date().getFullYear()}-014`, issueDate: today(), dueDate: later(21), currency: 'INR', accent: '#0ea5e9' },
    items: [
      { id: `s${Date.now()}`, description: 'Brand identity — logo, palette, type', qty: 1, rate: 85000 },
      { id: `s${Date.now() + 1}`, description: 'Packaging design, 3 SKUs', qty: 3, rate: 12000 },
      { id: `s${Date.now() + 2}`, description: 'Photography day', qty: 1, rate: 28000 },
    ],
    discountPct: 5,
    taxPct: 18,
    paid: 50000,
    notes: 'Files handed over on final payment.',
    terms: 'Payment within 21 days. 1.5% monthly on overdue balances.',
  });

  const summary = `${invoice.meta.number} · ${invoice.to.name || 'client'} · ${money(totals.total, currency)}${totals.paid ? ` (${money(totals.balance, currency)} due)` : ''} · due ${invoice.meta.dueDate}`;

  return (
    <ToolShell
      toolId="invoice"
      icon={Receipt}
      title="Invoice Builder"
      desc="Write an invoice on one screen, watch the finished document beside it, then print it or save it as a PDF."
      state={invoice}
      onRestore={(restored) => { if (restored?.meta?.number) setInvoice({ ...emptyInvoice(), ...restored }); }}
      exportText={summary}
      exportName={`${invoice.meta.number || 'invoice'}.txt`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={print} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Printer className="h-3.5 w-3.5" /> {printed === 'print' ? 'Printing…' : 'Print / Save as PDF'}
        </button>
        <button type="button" onClick={openTab} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
          <ExternalLink className="h-3.5 w-3.5" /> {printed === 'tab' ? 'Opened' : 'Open as a page'}
        </button>
        <button type="button" onClick={saveJson} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
          <FileJson className="h-3.5 w-3.5" /> Save data
        </button>
        <button type="button" onClick={fillSample} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
          <Sparkles className="h-3.5 w-3.5" /> Fill with a sample
        </button>
        <button type="button" onClick={() => setInvoice(emptyInvoice())} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-cyan-j">
          <RefreshCw className="h-3.5 w-3.5" /> Start a new invoice
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
        <div className="space-y-4">
          <Panel>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium">
              <Receipt className="h-3.5 w-3.5 text-cyan-j" /> Your details
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business or your name">
                <input value={invoice.from.name} onChange={(e) => setFrom({ name: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
              <Field label="Email">
                <input value={invoice.from.email} onChange={(e) => setFrom({ email: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
              <Field label="Phone">
                <input value={invoice.from.phone} onChange={(e) => setFrom({ phone: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
              <Field label="Tax / registration number">
                <input value={invoice.from.taxId} onChange={(e) => setFrom({ taxId: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
            </div>
            <Field label="Address">
              <textarea value={invoice.from.address} onChange={(e) => setFrom({ address: e.target.value })} rows={2} className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 text-sm" />
            </Field>
          </Panel>

          <Panel>
            <div className="mb-3 text-xs font-medium">Billed to</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client name">
                <input value={invoice.to.name} onChange={(e) => setTo({ name: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
              <Field label="Client email">
                <input value={invoice.to.email} onChange={(e) => setTo({ email: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
            </div>
            <Field label="Client address">
              <textarea value={invoice.to.address} onChange={(e) => setTo({ address: e.target.value })} rows={2} className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 text-sm" />
            </Field>
          </Panel>

          <Panel>
            <div className="mb-3 text-xs font-medium">Invoice details</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Invoice number">
                <input value={invoice.meta.number} onChange={(e) => setMeta({ number: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
              <Field label="Currency">
                <select value={currency} onChange={(e) => setMeta({ currency: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </Field>
              <Field label="Issue date">
                <input type="date" value={invoice.meta.issueDate} onChange={(e) => setMeta({ issueDate: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
              <Field label="Due date">
                <input type="date" value={invoice.meta.dueDate} onChange={(e) => setMeta({ dueDate: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
              </Field>
              <Field label={`Accent · ${invoice.meta.accent.toUpperCase()}`}>
                <input type="color" value={invoice.meta.accent} onChange={(e) => setMeta({ accent: e.target.value })} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
              </Field>
              <Field label="Amount already paid">
                <input
                  value={String(invoice.paid)}
                  onChange={(e) => setInvoice((i) => ({ ...i, paid: e.target.value === '' ? '' : Number(e.target.value) }))}
                  inputMode="decimal"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
                />
              </Field>
            </div>
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium">Line items</span>
              <span className="text-[11px] text-muted-foreground">{invoice.items.length} line{invoice.items.length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-2">
              {invoice.items.map((item) => (
                <LineItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                  canRemove={invoice.items.length > 1}
                  onChange={(patch) => setItem(item.id, patch)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AddLineButton onClick={addItem} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={`Discount · ${invoice.discountPct}%`}>
                <input type="range" min={0} max={50} step={1} value={invoice.discountPct} onChange={(e) => setInvoice((i) => ({ ...i, discountPct: Number(e.target.value) }))} className="w-full accent-[hsl(var(--cyan))]" />
              </Field>
              <Field label={`Tax · ${invoice.taxPct}%`}>
                <input type="range" min={0} max={40} step={0.5} value={invoice.taxPct} onChange={(e) => setInvoice((i) => ({ ...i, taxPct: Number(e.target.value) }))} className="w-full accent-[hsl(var(--cyan))]" />
              </Field>
            </div>
          </Panel>

          <Panel>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Notes shown at the bottom">
                <textarea value={invoice.notes} onChange={(e) => setInvoice((i) => ({ ...i, notes: e.target.value }))} rows={2} className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 text-sm" />
              </Field>
              <Field label="Payment terms">
                <textarea value={invoice.terms} onChange={(e) => setInvoice((i) => ({ ...i, terms: e.target.value }))} rows={2} className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 text-sm" />
              </Field>
            </div>
            <div className="mt-3">
              <TotalsSummary totals={totals} currency={currency} />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Save your business details as a preset from the toolbar above and reuse them as a template for every invoice.
            </p>
          </Panel>
        </div>

        <div className="space-y-3 xl:sticky xl:top-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <TrendingUp className="h-3.5 w-3.5 text-cyan-j" /> The document
            </span>
            <div className="flex gap-2">
              <CopyBtn value={`${summary}\n\n${invoice.items.map((i) => `${i.description} × ${i.qty} @ ${i.rate}`).join('\n')}`} label="Copy summary" />
            </div>
          </div>
          <iframe
            ref={frameRef}
            title="Invoice preview"
            srcDoc={html}
            className="h-[38rem] w-full rounded-xl border border-border/70 bg-white"
          />
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total" value={money(totals.total, currency)} mono />
            <Stat label="Paid" value={money(totals.paid, currency)} sub={totals.isPaid ? 'settled' : ''} mono />
            <Stat label="Balance" value={money(totals.balance, currency)} sub={invoice.meta.dueDate ? `due ${invoice.meta.dueDate}` : ''} mono />
          </div>
          <Panel>
            <p className="text-[11px] text-muted-foreground">
              Print / Save as PDF gives you a crisp A4 page — in the print dialog pick "Save as PDF" as the destination to keep a file. If your browser
              blocks printing from a preview frame, use "Open as a page" and print from there.
            </p>
          </Panel>
          <ToggleRow
            label="Mark as fully paid"
            checked={Number(invoice.paid) >= totals.total && totals.total > 0}
            onChange={(on) => setInvoice((i) => ({ ...i, paid: on ? Number(invoiceTotals(i).total.toFixed(2)) : 0 }))}
            hint="stamps the invoice"
          />
        </div>
      </div>
    </ToolShell>
  );
}