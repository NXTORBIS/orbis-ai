import { useMemo, useState } from 'react';
import { Play, RefreshCw, Table2 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Field, Panel, Seg, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { PLANS, makeRows, verifyQuery } from './columnarCore';

const SIZES = [
  { value: 4000, label: '4 000 rows' },
  { value: 12000, label: '12 000 rows' },
  { value: 40000, label: '40 000 rows' },
];

const formatValue = (value) => {
  if (value == null) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  return String(value);
};

export default function ColumnarEngine() {
  const [rowCount, setRowCount] = useState(12000);
  const [seed, setSeed] = useState(11);
  const [planIndex, setPlanIndex] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const table = useMemo(() => makeRows({ seed, rows: rowCount }), [seed, rowCount]);
  const plan = PLANS[planIndex];

  const run = () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const outcome = verifyQuery(table, plan.plan);
      setResult(outcome);
    } catch (thrown) {
      setError(thrown.message || 'The query could not run.');
    }
    setBusy(false);
  };

  const columns = useMemo(() => {
    if (!result) return [];
    return result.roundTrip;
  }, [result]);

  const groupLabels = result ? result.fast.rows.map((row) => row.group ?? 'all') : [];
  const firstMeasure = result && result.fast.rows.length ? Object.keys(result.fast.rows[0]).find((key) => key !== 'group') : null;

  const exportText = result
    ? [
      `${plan.label} over ${rowCount} rows`,
      Object.keys(result.fast.rows[0] ?? {}).join('\t'),
      ...result.fast.rows.map((row) => Object.values(row).join('\t')),
      '',
      `rows scanned ${result.fast.stats.rowsScanned} of ${rowCount}, batches decoded ${result.fast.stats.batchesDecoded}`,
    ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="columnar-query"
      icon={Table2}
      title="Columnar Query Execution Engine"
      desc="Column stores with real encodings — frame-of-reference bit packing, dictionary codes, bit-packed booleans — executed in vectorised batches with zone-map skipping, checked against a naive row-oriented reference."
      state={{ rowCount, seed, planIndex }}
      onRestore={(state) => {
        if (!state) return;
        if (state.rowCount) setRowCount(state.rowCount);
        if (state.seed) setSeed(state.seed);
        if (typeof state.planIndex === 'number') setPlanIndex(state.planIndex);
      }}
      exportText={exportText}
      exportName="query-result.tsv"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={rowCount} onChange={setRowCount} options={SIZES} />
        <Button size="sm" variant="outline" onClick={() => { setSeed(Math.floor(Math.random() * 100000)); setResult(null); }} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> New data
        </Button>
        <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Run query</Button>
      </div>

      <Field label="Query plan" hint="Predicates are evaluated in order and combined as bitsets; a batch whose min/max range cannot satisfy the predicate is skipped without decoding it.">
        <div className="flex flex-wrap gap-1.5">
          {PLANS.map((entry, index) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => { setPlanIndex(index); setResult(null); }}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${index === planIndex ? 'border-cyan-j/60 bg-cyan-j/10 text-foreground' : 'border-border/60 text-muted-foreground hover:border-cyan-j/40'}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </Field>

      <EngineProgress busy={busy} phase={busy ? 'Scanning batches' : null} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label={firstMeasure ?? 'groups'}
              value={groupLabels.length ? formatValue(result.fast.rows[0][firstMeasure]) : '—'}
              sub={`${result.fast.stats.rowsOut} groups in ${result.fast.stats.ms} ms`}
              tone={result.rowsEqual ? 'emerald' : 'amber'}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Rows scanned" value={`${result.fast.stats.rowsScanned.toLocaleString()} / ${rowCount.toLocaleString()}`} sub={`${result.skippedRows.toLocaleString()} rows skipped by zone maps`} mono />
              <Stat label="Batches decoded" value={result.fast.stats.batchesDecoded} sub={`${(result.decodedShare * 100).toFixed(0)}% of the table touched`} mono />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Panel>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{plan.label}</span>
                <CopyBtn value={result.fast.rows.map((row) => Object.values(row).join('\t')).join('\n')} />
              </div>
              <div className="max-h-72 overflow-auto scrollbar-thin">
                <table className="w-full text-left font-mono-j text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      {Object.keys(result.fast.rows[0] ?? {}).map((key) => <th key={key} className="pb-1 pr-3 font-normal">{key}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.fast.rows.map((row, index) => (
                      <tr key={index} className="border-t border-border/40">
                        {Object.values(row).map((value, cell) => <td key={cell} className="py-1 pr-3">{formatValue(value)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel>
              <div className="mb-2 text-xs font-semibold">Encodings and compression</div>
              <div className="space-y-1.5">
                {columns.map((column) => (
                  <div key={column.name} className="flex items-center justify-between rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px]">
                    <span className="font-mono-j">{column.name}</span>
                    <span className="text-muted-foreground">{column.encoding}</span>
                    <span className="font-mono-j text-cyan-j">{column.ratio.toFixed(2)}×</span>
                    <span className="font-mono-j text-muted-foreground">{column.stored.toLocaleString()} B</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Stored size against the raw 8-byte-per-value layout, dictionary included.</p>
            </Panel>
          </div>

          {groupLabels.length > 1 && firstMeasure && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-semibold">{firstMeasure} by group</div>
              <Bars data={result.fast.rows.map((row) => ({ label: row.group ?? 'all', value: Number(row[firstMeasure]) || 0 }))} />
            </Panel>
          )}

          <Pills items={[
            { label: 'rows', value: rowCount.toLocaleString() },
            { label: 'groups', value: result.fast.stats.groups },
            { label: 'batches scanned', value: result.fast.stats.blocksScanned },
            { label: 'batches skipped', value: result.fast.stats.blocksSkipped },
            { label: 'query', value: `${result.fast.stats.ms} ms` },
          ]} />

          <VerifyPanel
            items={[
              { label: 'Matches the row-oriented reference exactly', ok: result.rowsEqual, detail: `${result.fast.rows.length} group rows compared cell by cell` },
              { label: 'Zone-map skipping is sound', ok: result.pushdownSound, detail: `${result.skippedRows.toLocaleString()} skipped rows re-checked, ${result.skippedMatches} would have matched` },
              { label: 'Every column decodes losslessly', ok: result.roundTrip.every((column) => column.lossless), detail: `${result.roundTrip.filter((column) => column.lossless).length}/${result.roundTrip.length} columns` },
            ]}
            note="The reference decodes every column in full and answers the same plan one row at a time with no pushdown, so agreement is evidence about the fast path rather than a comparison of the engine with itself."
          />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Integers are stored frame-of-reference: a per-batch minimum plus bit-packed offsets, so a narrow column costs a few bits per value rather than eight bytes.</p>
          <p>· Strings are dictionary-coded; because the dictionary is sorted, code ranges behave like value ranges, which is what makes a code-based zone map valid for a string comparison.</p>
          <p>· Nulls live in a per-batch bitmap and take no space in the encodings themselves.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}