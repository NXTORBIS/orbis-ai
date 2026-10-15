import { useMemo, useState } from 'react';
import { Table } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const SAMPLE = 'name\tscore\tcity\nAsha\t92\tPune\nRohan\t88\tDelhi\nMeera\t95\tKochi';

const detect = (text) => {
  if (text.includes('\t')) return '\t';
  if (text.includes('|')) return '|';
  if (text.includes(';')) return ';';
  return ',';
};

const splitLine = (line, delimiter) => {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim());
};

export default function MarkdownTable() {
  const [input, setInput] = useState(SAMPLE);
  const [style, setStyle] = useState('gfm');
  const [align, setAlign] = useState('left');
  const [header, setHeader] = useState(true);
  const [pad, setPad] = useState(true);

  const parsed = useMemo(() => {
    const raw = input.split(/\r?\n/).filter((l) => l.trim());
    if (!raw.length) return { rows: [], width: 0 };
    const delimiter = detect(input);
    const rows = raw.map((line) => splitLine(line, delimiter));
    const width = Math.max(...rows.map((r) => r.length));
    return { rows: rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]), width };
  }, [input]);

  const output = useMemo(() => {
    const { rows, width } = parsed;
    if (!rows.length || !width) return '';
    const body = header ? rows.slice(1) : rows;
    const head = header ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);

    if (style === 'csv') {
      return [head, ...body]
        .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
        .join('\n');
    }

    const widths = Array.from({ length: width }, (_, i) => Math.max(3, ...[head, ...body].map((r) => (r[i] || '').length)));
    const cell = (value, i) => {
      const text = value || '';
      if (!pad) return text;
      if (align === 'right') return text.padStart(widths[i]);
      if (align === 'center') return text.padStart(Math.floor((widths[i] + text.length) / 2)).padEnd(widths[i]);
      return text.padEnd(widths[i]);
    };

    if (style === 'boxed') {
      const line = (left, mid, right) => `${left}${widths.map((w) => '─'.repeat(w + 2)).join(mid)}${right}`;
      const row = (r) => `│${Array.from({ length: width }, (_, i) => ` ${cell(r[i], i)} `).join('│')}│`;
      return [line('┌', '┬', '┐'), row(head), line('├', '┼', '┤'), ...body.map(row), line('└', '┴', '┘')].join('\n');
    }

    const dashes = (w) => {
      if (align === 'center') return `:${'-'.repeat(Math.max(3, w - 2))}:`;
      if (align === 'right') return `${'-'.repeat(Math.max(3, w - 1))}:`;
      return '-'.repeat(Math.max(3, w));
    };
    return [
      `| ${head.map((c, i) => cell(c, i)).join(' | ')} |`,
      `| ${widths.map((w) => dashes(w)).join(' | ')} |`,
      ...body.map((r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i], i)).join(' | ')} |`),
    ].join('\n');
  }, [parsed, style, align, header, pad]);

  const columns = parsed.width;
  const dataRows = Math.max(0, parsed.rows.length - (header ? 1 : 0));

  return (
    <ToolShell
      toolId="markdown-table"
      icon={Table}
      title="Markdown Table Builder"
      desc="Paste tab, comma or pipe separated data and get a table ready for any README or issue."
      state={{ input, style, align, header, pad }}
      onRestore={(saved) => {
        setInput(saved.input); setStyle(saved.style || 'gfm');
        setAlign(saved.align || 'left'); setHeader(saved.header ?? true); setPad(saved.pad ?? true);
      }}
      exportText={output}
      exportName={style === 'csv' ? 'table.csv' : 'table.md'}
    >
      <Area value={input} onChange={setInput} rows={7} placeholder="Paste rows from a spreadsheet, CSV or pipe table…" />

      <Seg
        value={style}
        onChange={setStyle}
        options={[
          { value: 'gfm', label: 'Markdown' },
          { value: 'boxed', label: 'Boxed text' },
          { value: 'csv', label: 'CSV' },
        ]}
      />

      <Seg
        value={align}
        onChange={setAlign}
        options={[
          { value: 'left', label: 'Align left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Align right' },
        ]}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="First row is the header" checked={header} onChange={setHeader} />
        <ToggleRow label="Pad columns to equal width" checked={pad} onChange={setPad} hint="aligned source" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Columns" value={String(columns)} />
        <Stat label="Data rows" value={String(dataRows)} />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Result</span>
          <CopyBtn value={output} />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{output || '—'}</pre>
      </Panel>
    </ToolShell>
  );
}