import { useMemo, useState } from 'react';
import { Regex } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE = `ORDER-2024-0187
ORDER-2024-0983
ORDER-2023-4410
INV-2024-0021
INV-2024-1176`;

const SAMPLE_NEGATIVE = `order-2024-0187
ORDER-24-0187
ORDERS-2024-0187
ORDER-2024-87`;

const escapeLiteral = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tokenise = (value) => {
  const tokens = [];
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (/[a-zA-Z]/.test(character)) {
      let run = '';
      while (index < value.length && /[a-zA-Z]/.test(value[index])) {
        run += value[index];
        index += 1;
      }
      tokens.push({ type: run.length === 1 ? 'letter' : 'word', value: run, length: run.length });
    } else if (/[0-9]/.test(character)) {
      let run = '';
      while (index < value.length && /[0-9]/.test(value[index])) {
        run += value[index];
        index += 1;
      }
      tokens.push({ type: 'digits', value: run, length: run.length });
    } else {
      let run = '';
      while (index < value.length && !/[a-zA-Z0-9]/.test(value[index])) {
        run += value[index];
        index += 1;
      }
      tokens.push({ type: 'symbol', value: run, length: run.length });
    }
  }
  return tokens;
};

const mergeTokens = (allTokens) => {
  const length = Math.max(...allTokens.map((tokens) => tokens.length));
  const merged = [];
  for (let index = 0; index < length; index += 1) {
    const column = allTokens.map((tokens) => tokens[index]).filter(Boolean);
    const types = new Set(column.map((token) => token.type));
    const lengths = new Set(column.map((token) => token.length));
    const values = new Set(column.map((token) => token.value));
    if (column.length !== allTokens.length) {
      merged.push({ type: 'optional', token: column[0], length: column[0].length });
      continue;
    }
    if (types.size === 1 && lengths.size === 1 && values.size === 1) {
      merged.push({ type: 'literal', token: column[0], length: column[0].length });
      continue;
    }
    merged.push({ type: column[0].type === 'digits' ? 'digits' : 'variable', length: Math.max(...lengths), minLength: Math.min(...lengths) });
  }
  return merged;
};

const buildPattern = (columns, options) => {
  const parts = columns.map((column) => {
    if (column.type === 'literal') {
      if (column.token.type === 'digits') return column.token.value;
      return escapeLiteral(column.token.value);
    }
    if (column.type === 'word') return '[A-Za-z]+';
    if (column.type === 'letter') return '[A-Za-z]';
    if (column.type === 'digits') {
      if (options.fixedDigits && column.minLength === column.length) return '[0-9]{' + column.length + '}';
      if (column.minLength !== undefined && column.minLength !== column.length) return '[0-9]{' + column.minLength + ',' + column.length + '}';
      return '[0-9]{' + column.length + '}';
    }
    if (column.type === 'symbol') return escapeLiteral(column.token.value);
    if (column.type === 'optional') return '(?:' + escapeLiteral(column.token.value) + ')?';
    return '[A-Za-z0-9]+';
  });
  const body = parts.join('');
  return (options.anchors ? '^' : '') + body + (options.anchors ? '$' : '');
};

export default function RegexBuilder() {
  const [positives, setPositives] = useState(SAMPLE);
  const [negatives, setNegatives] = useState(SAMPLE_NEGATIVE);
  const [options, setOptions] = useState({ anchors: true, fixedDigits: true, ignoreCase: false });

  const result = useMemo(() => {
    const lines = String(positives).split('\n').map((line) => line.trim()).filter(Boolean);
    const negativesList = String(negatives).split('\n').map((line) => line.trim()).filter(Boolean);

    if (!lines.length) return { pattern: '', columns: [], matches: [], failures: [], negativeHits: [], flags: 'g', groups: [], coverage: 0 };

    const tokenised = lines.map(tokenise);
    const columns = mergeTokens(tokenised);
    const body = buildPattern(columns, options);
    const flags = 'g' + (options.ignoreCase ? 'i' : '');

    let pattern = body;
    try {
      const test = new RegExp(pattern, flags);
      const matches = lines.map((line) => ({ line, ok: test.test(line), parts: (() => {
        const fresh = new RegExp(pattern, flags);
        const found = fresh.exec(line);
        return found ? found[0] : '';
      })() }));
      const negativeHits = negativesList.map((line) => ({ line, hit: new RegExp(pattern, flags).test(line) }));
      const passing = matches.filter((entry) => entry.ok).length;

      const groups = columns
        .map((column, index) => ({ column, index }))
        .filter((entry) => entry.column.type !== 'literal')
        .map((entry) => 'group ' + (entry.index + 1) + ': ' + (entry.column.type === 'digits' ? entry.column.length + ' digit' + (entry.column.length === 1 ? '' : 's') : entry.column.type));

      return {
        pattern, columns, matches, failures: matches.filter((entry) => !entry.ok), negativeHits, flags, groups,
        coverage: (passing / lines.length) * 100,
        falsePositives: negativeHits.filter((entry) => entry.hit).length,
      };
    } catch (error) {
      return { pattern: body, columns, matches: [], failures: [], negativeHits: [], flags, groups: [], coverage: 0, error: error.message };
    }
  }, [positives, negatives, options]);

  const patternLiteral = '/' + result.pattern + '/' + result.flags;

  return (
    <ToolShell
      toolId="regex-builder"
      icon={Regex}
      title="Regex Builder from Examples"
      desc="Paste a handful of sample strings and get a candidate pattern that matches them, plus a check against the examples it must not match — with every part of the pattern explained."
      state={{ positives, negatives, options }}
      onRestore={(restored) => {
        if (typeof restored.positives === 'string') setPositives(restored.positives);
        if (typeof restored.negatives === 'string') setNegatives(restored.negatives);
        if (restored.options) setOptions((current) => ({ ...current, ...restored.options }));
      }}
      exportText={patternLiteral}
      exportName="pattern.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Strings the pattern must match</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{String(positives).split('\n').filter((line) => line.trim()).length} examples</span>
          </div>
          <Area value={positives} onChange={setPositives} rows={10} mono placeholder={'ORDER-2024-0187\nORDER-2024-0983'} />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Strings it must not match</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{String(negatives).split('\n').filter((line) => line.trim()).length} counter-examples</span>
          </div>
          <Area value={negatives} onChange={setNegatives} rows={10} mono placeholder={'order-2024-0187\nORDER-24-0187'} />
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ToggleRow label="Anchor with ^ and $" checked={options.anchors} onChange={() => setOptions((current) => ({ ...current, anchors: !current.anchors }))} />
        <ToggleRow label="Fixed digit counts rather than ranges" checked={options.fixedDigits} onChange={() => setOptions((current) => ({ ...current, fixedDigits: !current.fixedDigits }))} />
        <ToggleRow label="Case insensitive" checked={options.ignoreCase} onChange={() => setOptions((current) => ({ ...current, ignoreCase: !current.ignoreCase }))} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.falsePositives ? 'amber' : 'emerald'}
          label="Coverage of your examples"
          value={result.coverage.toFixed(0)}
          unit="%"
          sub={result.matches.length
            ? result.failures.length
              ? result.failures.length + ' examples are not matched. The strings differ in structure rather than in content, so check the token table below and adjust the pattern by hand.'
              : 'Every example matches and ' + (result.falsePositives ? result.falsePositives + ' of the counter-examples also match, which means the pattern is too loose.' : 'no counter-example matches, which is what you want.')
            : 'Paste a few examples to see a pattern.'}
        />
        <Ring
          value={result.coverage}
          max={100}
          tone={result.falsePositives ? 'amber' : 'emerald'}
          label="Agreement with your examples"
          sub={result.columns.length + ' token positions detected across the samples'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Suggested pattern</span>
          <div className="flex gap-2">
            <CopyBtn value={result.pattern} label="Copy pattern" />
            <CopyBtn value={patternLiteral} label="Copy literal" />
          </div>
        </div>
        <pre className="overflow-auto rounded-lg border border-cyan-j/40 bg-cyan-j/5 p-2.5 font-mono-j text-[12px] text-cyan-j">{result.pattern || '—'}</pre>
        {result.error && <p className="mt-2 text-[11px] text-rose-300">That pattern is not valid: {result.error}</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span>flags: {result.flags}</span>
          <span>{result.columns.length} tokens</span>
          <span>{result.groups.length} variable positions</span>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How the pattern is built</div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground">
                  <th className="py-1 text-left font-medium">Position</th>
                  <th className="py-1 text-left font-medium">Detected</th>
                  <th className="py-1 text-left font-medium">Emitted</th>
                </tr>
              </thead>
              <tbody className="font-mono-j">
                {result.columns.map((column, index) => (
                  <tr key={index} className="border-t border-border/50">
                    <td className="py-1 text-muted-foreground">{index + 1}</td>
                    <td className="py-1">{column.type}{column.length ? ' · ' + column.length : ''}</td>
                    <td className="py-1 text-cyan-j">
                      {column.type === 'literal' ? escapeLiteral(column.token.value) : column.type === 'digits' ? '[0-9]{' + column.length + '}' : column.type === 'word' ? '[A-Za-z]+' : column.type === 'letter' ? '[A-Za-z]' : column.type === 'symbol' ? escapeLiteral(column.token.value) : column.type === 'optional' ? '(optional)' : '[A-Za-z0-9]+'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Literal runs that are identical across every example become plain text. Positions that vary become character classes, and digit runs keep their length as a quantifier.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Test against the examples</div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {result.matches.map((entry) => (
              <div key={entry.line} className={(entry.ok ? 'border-emerald-400/40 ' : 'border-rose-400/40 ') + 'flex items-center justify-between rounded-lg border bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]'}>
                <span className="truncate">{entry.line}</span>
                <span className={entry.ok ? 'text-emerald-300' : 'text-rose-300'}>{entry.ok ? 'match' : 'no match'}</span>
              </div>
            ))}
            {result.negativeHits.map((entry) => (
              <div key={entry.line} className={(entry.hit ? 'border-amber-400/40 ' : 'border-border/50 ') + 'flex items-center justify-between rounded-lg border bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]'}>
                <span className="truncate">{entry.line}</span>
                <span className={entry.hit ? 'text-amber-300' : 'text-muted-foreground'}>{entry.hit ? 'also matches' : 'excluded'}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Coverage" value={result.coverage.toFixed(0) + '%'} mono sub={result.matches.length + ' examples'} />
        <Stat label="Tokens" value={String(result.columns.length)} mono sub={result.groups.length + ' variable'} />
        <Stat label="Counter-examples hit" value={String(result.falsePositives)} mono sub="want zero" />
        <Stat label="Flags" value={result.flags} mono sub={options.anchors ? 'anchored' : 'unanchored'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using an inferred pattern safely</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Three to five examples reveal the shape. More examples of the same shape add nothing; examples of a different shape are what improve it.</p>
            <p>· Always include counter-examples. A pattern inferred only from matching strings tends to be far too permissive.</p>
            <p>· Check the anchors. Without ^ and ^ $ a pattern will happily match in the middle of a longer string, which is usually not what you want for validation.</p>
            <p>· Inferred character classes are wide. If the real values are always upper case, tighten [A-Za-z]+ to [A-Z]+ by hand.</p>
            <p>· Test the final pattern against real data, not just the samples. The samples are the specification you gave; the data is the behaviour that matters.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Pattern pieces you will see here</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>[A-Za-z]+ letters, one or more</p>
            <p>[A-Za-z] exactly one letter</p>
            <p>[0-9]{'{4}'} exactly four digits</p>
            <p>[0-9]{'{2,4}'} two to four digits</p>
            <p>(?:...) a group that does not capture</p>
            <p>^ and $ start and end of the string</p>
            <p className="text-cyan-j">Escape literal dots and brackets with a backslash, which this tool does for you in any fixed text.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where this saves real time</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Validation patterns for identifiers, order numbers, ticket references and internal codes where you know the format but not the syntax.</p>
          <p>· Log parsing: drop in a few lines and get a starting pattern rather than writing one from scratch.</p>
          <p>· Cleaning data: extract the common shape from a column of messy values. When no pattern emerges, that is itself the finding — the format is not consistent.</p>
          <p>· Teaching: the token table shows exactly how a sample becomes a character class, which makes the syntax obvious in a way that documentation does not.</p>
          <p>· Migration work: compare the format of old and new identifiers by inferring a pattern for each and diffing them.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Coverage', value: result.coverage.toFixed(0) + '%' },
              { label: 'False positives', value: String(result.falsePositives) },
              { label: 'Tokens', value: String(result.columns.length) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The inference is positional and conservative: it only widens a position into a character class when the examples genuinely differ there. That produces a starting point you can
          review and tighten, not a finished expression to paste and forget.
        </p>
      </Panel>
    </ToolShell>
  );
}