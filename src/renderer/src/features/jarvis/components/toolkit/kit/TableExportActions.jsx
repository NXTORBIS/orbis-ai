import { useRef, useState } from 'react';
import { Braces, Check, Table } from 'lucide-react';
import { cn } from '@jarvis/lib/utils';
import { downloadBlob } from '../shared';
import { largestRows, rowsToCsv, rowsToJson, useTablePresence } from './tableExport';

const CHIP = 'inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground active:scale-[0.97]';

/**
 * CSV and JSON export for any tool showing a table.
 *
 * It watches the tool it sits in and only appears once there is a table with rows
 * to hand over, so the buttons never lie about having something to export.
 */
export default function TableExportActions({ toolId }) {
  const ref = useRef(null);
  const present = useTablePresence(ref);
  const [done, setDone] = useState('');

  const run = (format) => {
    const root = ref.current?.closest('.tk-frame, .tk-shell') || ref.current?.parentElement;
    const table = largestRows(root);
    if (!table) return;
    const text = format === 'csv' ? rowsToCsv(table.rows) : rowsToJson(table.rows);
    const mime = format === 'csv' ? 'text/csv' : 'application/json';
    downloadBlob(new Blob([text], { type: mime }), `${toolId || 'table'}.${format}`);
    setDone(format);
    setTimeout(() => setDone(''), 1500);
  };

  if (!present) return <div ref={ref} className="contents" />;

  return (
    <div ref={ref} className="contents">
      <button type="button" onClick={() => run('csv')} className={cn(CHIP, done === 'csv' && 'border-cyan-j/60 text-cyan-j')} title="Download this table as a CSV file">
        {done === 'csv' ? <Check className="h-3.5 w-3.5" /> : <Table className="h-3.5 w-3.5" />} CSV
      </button>
      <button type="button" onClick={() => run('json')} className={cn(CHIP, done === 'json' && 'border-cyan-j/60 text-cyan-j')} title="Download this table as JSON">
        {done === 'json' ? <Check className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />} JSON
      </button>
    </div>
  );
}