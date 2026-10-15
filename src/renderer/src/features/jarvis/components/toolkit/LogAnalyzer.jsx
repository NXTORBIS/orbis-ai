import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const SAMPLE = `2026-10-10T09:12:04Z INFO  request start method=GET path=/api/orders status=200 ms=38 user=8821
2026-10-10T09:12:05Z INFO  request start method=GET path=/api/orders status=200 ms=41 user=8822
2026-10-10T09:12:06Z WARN  slow query table=orders duration=1840ms statement=SELECT * FROM orders WHERE user_id = 8823
2026-10-10T09:12:09Z INFO  request start method=POST path=/api/orders status=201 ms=112 user=8824
2026-10-10T09:12:11Z ERROR upstream timeout service=payments attempt=1 trace=9f2a1c
2026-10-10T09:12:11Z ERROR upstream timeout service=payments attempt=2 trace=9f2a1c
2026-10-10T09:12:14Z INFO  request start method=GET path=/api/orders status=200 ms=44 user=8825
2026-10-10T09:12:19Z WARN  slow query table=users duration=2210ms statement=SELECT * FROM users WHERE id = 8826
2026-10-10T09:12:21Z INFO  cache hit key=orders:8827
2026-10-10T09:12:24Z ERROR upstream timeout service=payments attempt=3 trace=9f2a1c
2026-10-10T09:12:26Z INFO  request start method=GET path=/api/orders status=500 ms=3104 user=8828
2026-10-10T09:12:29Z DEBUG retry scheduled in=250ms job=reconcile
2026-10-10T09:12:31Z INFO  request start method=GET path=/health status=200 ms=3 user=-
2026-10-10T09:12:33Z WARN  connection pool at 92% capacity connections=46 max=50`;

const LEVELS = [
  { id: 'fatal', label: 'Fatal', pattern: /\b(fatal|critical|emergency|panic)\b/i },
  { id: 'error', label: 'Error', pattern: /\b(error|err|fail|failed|exception|timeout|refused)\b/i },
  { id: 'warn', label: 'Warning', pattern: /\b(warn|warning|deprecated|slow|retry)\b/i },
  { id: 'info', label: 'Info', pattern: /\b(info|notice|started|completed)\b/i },
  { id: 'debug', label: 'Debug', pattern: /\b(debug|trace|verbose)\b/i },
];

const normalise = (line) => line
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
  .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
  .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>')
  .replace(/\b\d+\.\d+\b/g, '<num>')
  .replace(/\b\d+\b/g, '<n>')
  .replace(/"[^"]*"/g, '"<str>"')
  .replace(/\s+/g, ' ')
  .trim();

export default function LogAnalyzer() {
  const [raw, setRaw] = useState(SAMPLE);
  const [filter, setFilter] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [groupSimilar, setGroupSimilar] = useState(true);

  const result = useMemo(() => {
    const allLines = String(raw).split('\n');
    const lines = allLines.filter((line) => line.trim());
    const needle = filter.trim().toLowerCase();
    const filtered = lines.filter((line) => (!needle || line.toLowerCase().includes(needle)));
    const working = onlyProblems ? filtered.filter((line) => LEVELS[0].pattern.test(line) || LEVELS[1].pattern.test(line) || LEVELS[2].pattern.test(line)) : filtered;

    const levelCounts = LEVELS.map((level) => ({
      label: level.label,
      value: working.filter((line) => level.pattern.test(line)).length,
      id: level.id,
    }));
    const uncategorised = working.filter((line) => !LEVELS.some((level) => level.pattern.test(line))).length;

    const timestamps = [];
    working.forEach((line) => {
      const iso = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/);
      const clock = line.match(/\b\d{2}:\d{2}:\d{2}\b/);
      const value = iso ? iso[0].replace(' ', 'T') : clock ? '1970-01-01T' + clock[0] : null;
      if (value) {
        const time = Date.parse(value.endsWith('Z') || iso ? value : value + 'Z');
        if (!Number.isNaN(time)) timestamps.push(time);
      }
    });
    const sorted = [...timestamps].sort((a, b) => a - b);
    const spanMs = sorted.length > 1 ? sorted[sorted.length - 1] - sorted[0] : 0;
    const spanMinutes = spanMs / 60000;

    const groups = new Map();
    working.forEach((line) => {
      let key;
      if (groupSimilar) {
        const stripped = line.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[Z]?/, '').replace(/\b\d{2}:\d{2}:\d{2}\b/, '');
        key = normalise(stripped) || '<blank>';
      } else {
        key = line;
      }
      const entry = groups.get(key) || { pattern: key, count: 0, sample: line };
      entry.count += 1;
      groups.set(key, entry);
    });
    const patterns = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 15);

    const ips = new Map();
    working.forEach((line) => {
      (line.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) || []).forEach((ip) => ips.set(ip, (ips.get(ip) || 0) + 1));
    });

    const statusCodes = new Map();
    working.forEach((line) => {
      const matches = line.match(/\b(?:status[=:\s]+|HTTP\/[\d.]+\s+)([1-5]\d{2})\b/g) || [];
      matches.forEach((match) => {
        const code = match.match(/([1-5]\d{2})/);
        if (code) statusCodes.set(code[1], (statusCodes.get(code[1]) || 0) + 1);
      });
    });

    const slowest = [];
    working.forEach((line) => {
      const ms = line.match(/(?:ms|duration|took)[=:\s]+(\d+)/i);
      if (ms) slowest.push({ line, value: Number(ms[1]) });
    });
    slowest.sort((a, b) => b.value - a.value);

    const problems = working.filter((line) => LEVELS[0].pattern.test(line) || LEVELS[1].pattern.test(line));
    const uniqueProblems = [...new Set(problems.map(normalise))];

    const busiest = (() => {
      if (!sorted.length) return 0;
      const perMinute = new Map();
      sorted.forEach((time) => {
        const bucket = Math.floor(time / 60000);
        perMinute.set(bucket, (perMinute.get(bucket) || 0) + 1);
      });
      return Math.max(...perMinute.values());
    })();

    const longest = working.reduce((best, line) => (line.length > best.length ? line : best), '');

    const report = [
      'Log analysis',
      'Lines read ' + allLines.length + ', non-blank ' + lines.length + ', analysed ' + working.length,
      'Levels: ' + levelCounts.map((level) => level.label + ' ' + level.value).join(' · ') + ' · unclassified ' + uncategorised,
      spanMs ? 'Time span ' + (spanMs / 1000).toFixed(1) + ' s (' + spanMinutes.toFixed(1) + ' min), busiest minute had ' + busiest + ' lines' : 'No timestamps detected',
      '',
      'Most repeated patterns:',
      ...patterns.map((entry) => '  ' + entry.count + ' × ' + entry.pattern.slice(0, 110)),
      '',
      problems.length ? 'Distinct problems (' + uniqueProblems.length + '):' : 'No error or warning lines found.',
      ...uniqueProblems.slice(0, 10).map((line) => '  ' + line.slice(0, 110)),
      '',
      slowest.length ? 'Slowest operations: ' + slowest.slice(0, 5).map((entry) => entry.value + ' ms (' + entry.line.slice(0, 60) + ')').join('; ') : '',
    ].join('\n');

    return {
      lines: lines.length, working, levelCounts, uncategorised, patterns, spanMs, spanMinutes, busiest, problems, uniqueProblems,
      ips: [...ips.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      statusCodes: [...statusCodes.entries()].sort((a, b) => Number(a[0]) - Number(b[0])),
      slowest: slowest.slice(0, 8), errorRate: working.length ? (problems.length / working.length) * 100 : 0,
      uniqueLines: groups.size, longest: longest.length, report,
      levelChart: levelCounts.filter((level) => level.value > 0),
      patternChart: patterns.slice(0, 8).map((entry) => ({ label: entry.pattern.split(' ').slice(0, 2).join(' ').slice(0, 12), value: entry.count })),
    };
  }, [raw, filter, onlyProblems, groupSimilar]);

  return (
    <ToolShell
      toolId="log-analyzer"
      icon={ScrollText}
      title="Log Analyser"
      desc="Paste a log and get the shape of it: levels, repeated patterns, error rate, the busiest minute, status codes, slowest operations and every distinct problem — all grouped automatically."
      state={{ raw, filter, onlyProblems, groupSimilar }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (typeof restored.filter === 'string') setFilter(restored.filter);
        if (typeof restored.onlyProblems === 'boolean') setOnlyProblems(restored.onlyProblems);
        if (typeof restored.groupSimilar === 'boolean') setGroupSimilar(restored.groupSimilar);
      }}
      exportText={result.report}
      exportName="log-analysis.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Log text</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.lines} lines</span>
          </div>
          <Area value={raw} onChange={setRaw} rows={16} mono placeholder="Paste log lines here" />
        </Panel>
        <div className="space-y-3">
          <Field label="Only lines containing"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="payments, user=8821, /api/orders" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label="Problems only" checked={onlyProblems} onChange={setOnlyProblems} />
            <ToggleRow label="Group similar lines" checked={groupSimilar} onChange={setGroupSimilar} />
          </div>
          <Panel className="!p-3">
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Similar lines are grouped by blanking out timestamps, numbers, identifiers, IPs and quoted strings, so a thousand request lines collapse into one pattern.</p>
              <p>· The filter searches the whole line, so paths, users, services and trace ids all work.</p>
              <p>· Nothing is uploaded. Logs often carry personal data, which is exactly why the work happens in this page.</p>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.errorRate > 10 ? 'rose' : result.errorRate > 3 ? 'amber' : 'emerald'}
          label="Lines that are errors or warnings"
          value={result.errorRate.toFixed(1)}
          unit="%"
          sub={result.problems.length + ' of ' + result.working.length + ' analysed lines, collapsing to ' + result.uniqueProblems.length + ' distinct problems. ' + (result.spanMinutes ? 'The lines span ' + result.spanMinutes.toFixed(1) + ' minutes and the busiest minute held ' + result.busiest + ' lines.' : 'No timestamps were recognised in these lines.')}
        />
        <Ring
          value={result.uniqueLines}
          max={Math.max(10, result.working.length)}
          tone="cyan"
          label="Distinct patterns"
          sub={result.uniqueLines + ' patterns across ' + result.working.length + ' lines — a low ratio means a few shapes are repeating' }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Level breakdown</div>
          <Bars data={result.levelChart} format={(value) => String(value)} suffix=" lines" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.levelChart.length ? 'Levels are inferred from wording rather than any fixed schema, which works across most logging libraries.' : 'No level keywords were found in these lines.'}
            {result.uncategorised ? ' ' + result.uncategorised + ' lines matched no level at all.' : ''}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Most repeated patterns</span>
            <CopyBtn value={result.report} label="Copy the report" />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {result.patterns.map((entry) => (
              <div key={entry.pattern} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono-j text-cyan-j">{entry.count}×</span>
                  <span className="truncate text-muted-foreground">{entry.pattern}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Analysed lines" value={String(result.working.length)} mono sub={result.lines + ' non-blank'} />
        <Stat label="Distinct problems" value={String(result.uniqueProblems.length)} mono sub={result.problems.length + ' matching lines'} />
        <Stat label="Busiest minute" value={String(result.busiest)} mono sub={result.spanMinutes ? result.spanMinutes.toFixed(0) + ' min span' : 'no timestamps'} />
        <Stat label="Longest line" value={result.longest + ' chars'} mono sub="often a stack trace" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Distinct problems, deduplicated</div>
          {result.uniqueProblems.length ? (
            <div className="max-h-56 space-y-1 overflow-auto">
              {result.uniqueProblems.map((line) => (
                <div key={line} className="rounded-lg border border-rose-400/40 bg-rose-400/5 px-2.5 py-1.5 font-mono-j text-[10px] text-rose-100">{line}</div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-emerald-200">Nothing at error or warning level in the analysed lines.</p>
          )}
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Slowest operations and traffic sources</div>
          <div className="space-y-1.5">
            {result.slowest.map((entry) => (
              <div key={entry.line} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="font-mono-j text-amber-200">{entry.value} ms</span>
                <span className="text-muted-foreground"> · {entry.line.slice(0, 80)}</span>
              </div>
            ))}
            {!result.slowest.length && <p className="text-[11px] text-muted-foreground">No timings found. Lines containing ms, duration or took are picked up here.</p>}
          </div>
          {result.ips.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] text-muted-foreground">Most frequent IP addresses</div>
              <div className="space-y-1">
                {result.ips.map(([ip, count]) => (
                  <div key={ip} className="flex justify-between font-mono-j text-[11px]">
                    <span>{ip}</span>
                    <span className="text-cyan-j">{count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {result.statusCodes.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">HTTP status codes</div>
          <Bars
            data={result.statusCodes.map(([code, count]) => ({ label: code, value: count }))}
            format={(value) => String(value)}
            suffix=""
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A cluster of 5xx codes points at a failure in the service itself; a cluster of 4xx codes usually points at a client, a stale token or a bad deploy of a caller.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading a log efficiently</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Start with distinct problems rather than line count. Two hundred identical timeout lines are one problem, not two hundred.</p>
            <p>· Look at the first occurrence of each distinct error, not the last. The earliest instance usually carries the original cause.</p>
            <p>· Check the rate, not just the volume. Errors rising across the span matter far more than a steady background of the same warning.</p>
            <p>· Follow a trace identifier through the log. This analyser surfaces repeated patterns, but the causal chain lives in the request id.</p>
            <p>· Warnings that never become errors are still worth fixing. Slow queries and pool exhaustion almost always precede the incident.</p>
            <p>· {result.errorRate > 10 ? 'An error rate above 10% is an incident rather than a hygiene problem. Fix the most frequent distinct error first, then re-measure.' : 'At ' + result.errorRate.toFixed(1) + '% the situation looks like background noise rather than an incident — which makes it a good week to delete the noisiest patterns.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the grouping does</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>timestamps are stripped before comparison</p>
            <p>UUIDs, long hashes, IPv4 addresses, decimals, integers and quoted strings become placeholders</p>
            <p>runs of whitespace collapse to a single space</p>
            <p>the remaining text is the pattern key, counted across all lines</p>
            <p>levels are matched by keyword, most severe first</p>
            <p className="text-cyan-j">Check: {result.working.length} lines produced {result.uniqueLines} distinct patterns.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Lines', value: String(result.working.length) },
                { label: 'Patterns', value: String(result.uniqueLines) },
                { label: 'Error rate', value: result.errorRate.toFixed(1) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Level detection is heuristic, so a log format that buries severity inside a JSON field will need the filter instead. Grouping is deliberately conservative:
          it removes identifiers but keeps wording, so patterns stay readable.
        </p>
      </Panel>
    </ToolShell>
  );
}