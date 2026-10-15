import { useMemo, useState } from 'react';
import { Regex } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const PRESETS = [
  { label: 'Email', pattern: '^[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}$', flags: 'i' },
  { label: 'URL', pattern: 'https?:\\/\\/[\\w.-]+(?:\\/[^\\s]*)?', flags: 'g' },
  { label: 'Date (ISO)', pattern: '\\d{4}-\\d{2}-\\d{2}', flags: 'g' },
  { label: 'Time', pattern: '([01]\\d|2[0-3]):[0-5]\\d', flags: 'g' },
  { label: 'Phone (loose)', pattern: '\\+?\\d[\\d\\s().-]{7,}\\d', flags: 'g' },
  { label: 'Hex colour', pattern: '#(?:[0-9a-f]{3}|[0-9a-f]{6})\\b', flags: 'gi' },
  { label: 'Strong password', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{10,}$', flags: '' },
  { label: 'Number', pattern: '-?\\d+(?:\\.\\d+)?', flags: 'g' },
  { label: 'Whitespace runs', pattern: '\\s{2,}', flags: 'g' },
];

const FLAG_NOTES = {
  g: 'global — find every match, not just the first',
  i: 'ignore case',
  m: 'multiline — ^ and $ match at each line break',
  s: 'dotall — . also matches newlines',
  u: 'unicode — proper handling of astral characters',
  y: 'sticky — match only at lastIndex',
};

const tokenise = (pattern) => {
  const tokens = [];
  let index = 0;
  const push = (text, meaning) => tokens.push({ text, meaning });
  while (index < pattern.length) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '\\' && next) {
      const escapes = {
        d: 'any digit 0–9', D: 'anything except a digit', w: 'letters, digits or underscore', W: 'anything except a word character',
        s: 'any whitespace', S: 'anything except whitespace', b: 'a word boundary', B: 'not a word boundary',
        n: 'newline', t: 'tab', '.': 'a literal dot', '+': 'a literal plus', '-': 'a literal hyphen', '/': 'a literal slash',
      };
      push(`\\${next}`, escapes[next] || `the literal character “${next}”`);
      index += 2;
      continue;
    }
    if (char === '[') {
      let end = index + 1;
      while (end < pattern.length && pattern[end] !== ']') end += 1;
      const inside = pattern.slice(index + 1, end);
      const negated = inside.startsWith('^');
      push(pattern.slice(index, end + 1), `${negated ? 'any character except ' : 'one character from '}${negated ? inside.slice(1) : inside}`);
      index = end + 1;
      continue;
    }
    if (char === '(') {
      if (pattern.startsWith('(?=', index)) push('(?=', 'start of a positive lookahead (must be followed by)');
      else if (pattern.startsWith('(?!', index)) push('(?!', 'start of a negative lookahead (must NOT be followed by)');
      else if (pattern.startsWith('(?<=', index)) push('(?<=', 'start of a positive lookbehind (must be preceded by)');
      else if (pattern.startsWith('(?<!', index)) push('(?<!', 'start of a negative lookbehind (must NOT be preceded by)');
      else if (pattern.startsWith('(?:', index)) push('(?:', 'start of a non-capturing group — groups without capturing');
      else if (pattern.startsWith('(?<', index)) push('(?<', 'start of a named capture group');
      else push('(', 'start of a capture group — the matched text is remembered');
      index += pattern.startsWith('(?<', index) && !pattern.startsWith('(?<=', index) && !pattern.startsWith('(?<!', index) ? 3 : 2;
      continue;
    }
    if (char === ')') { push(')', 'end of the group'); index += 1; continue; }
    if ('*+?'.includes(char)) {
      if (next === '?') { push(`${char}?`, `lazy repeat — ${char === '*' ? 'zero or more' : char === '+' ? 'one or more' : 'zero or one'}, as few as possible`); index += 2; continue; }
      if (next === '+') { push(`${char}+`, 'possessive repeat — do not backtrack'); index += 2; continue; }
      push(char, char === '*' ? 'repeat zero or more times (greedy)' : char === '+' ? 'repeat one or more times (greedy)' : 'optional — zero or one time');
      index += 1;
      continue;
    }
    if (char === '{') {
      const end = pattern.indexOf('}', index);
      if (end > index) {
        push(pattern.slice(index, end + 1), `repeat between ${pattern.slice(index + 1, end).replace(',', ' and ')} times`);
        index = end + 1;
        continue;
      }
    }
    if (char === '^') { push('^', 'start of the line or string'); index += 1; continue; }
    if (char === '$') { push('$', 'end of the line or string'); index += 1; continue; }
    if (char === '.') { push('.', 'any single character (except a newline unless the s flag is set)'); index += 1; continue; }
    if (char === '|') { push('|', 'alternation — match what is on the left OR the right'); index += 1; continue; }
    push(char, `the literal character “${char}”`);
    index += 1;
  }
  return tokens;
};

export default function RegexExplainer() {
  const [pattern, setPattern] = useState('^(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]{2,})$');
  const [flags, setFlags] = useState('gm');
  const [test, setTest] = useState('ada@example.com\nnot-an-email\npriya.sharma@mark32.dev');
  const [showTokens, setShowTokens] = useState(true);

  const compiled = useMemo(() => {
    try {
      return { regex: new RegExp(pattern, flags), error: '' };
    } catch (err) {
      return { regex: null, error: String(err.message || err) };
    }
  }, [pattern, flags]);

  const matches = useMemo(() => {
    if (!compiled.regex || !test) return { list: [], error: '' };
    const list = [];
    try {
      if (flags.includes('g')) {
        const all = test.matchAll(new RegExp(pattern, flags));
        for (const match of all) {
          list.push({ text: match[0], index: match.index, groups: match.groups || null, captures: match.slice(1) });
          if (list.length > 200) break;
        }
      } else {
        const match = test.match(compiled.regex);
        if (match) list.push({ text: match[0], index: match.index, groups: match.groups || null, captures: match.slice(1) });
      }
    } catch (err) {
      return { list: [], error: String(err.message || err) };
    }
    return { list, error: '' };
  }, [compiled, test, pattern, flags]);

  const tokens = useMemo(() => tokenise(pattern), [pattern]);

  const highlighted = useMemo(() => {
    if (!test) return [];
    if (!matches.list.length) return [{ text: test, match: false }];
    const segments = [];
    let cursor = 0;
    matches.list.forEach((match) => {
      if (match.index > cursor) segments.push({ text: test.slice(cursor, match.index), match: false });
      segments.push({ text: match.text, match: true });
      cursor = match.index + match.text.length;
    });
    if (cursor < test.length) segments.push({ text: test.slice(cursor), match: false });
    return segments;
  }, [test, matches]);

  const snippet = `const regex = /${pattern.replace(/\//g, '\\/')}/${flags};
const matches = [...text.matchAll(new RegExp(regex))];
matches.forEach((m) => console.log(m.index, m[0], m.groups));`;

  const difficulty = useMemo(() => {
    const score = pattern.length + tokens.length * 2 + (pattern.includes('(?') ? 12 : 0) + (pattern.includes('|') ? 6 : 0);
    return score < 40 ? { label: 'easy to read', tone: 'emerald' } : score < 90 ? { label: 'moderate', tone: 'amber' } : { label: 'getting hairy', tone: 'rose' };
  }, [pattern, tokens]);

  const report = [
    `/${pattern}/${flags}`,
    compiled.error ? `Error: ${compiled.error}` : `${matches.list.length} match(es) in the test text`,
    difficulty.label,
    '',
    ...tokens.map((token) => `${token.text.padEnd(8)} ${token.meaning}`),
  ].join('\n');

  return (
    <ToolShell
      toolId="regex-explain"
      icon={Regex}
      title="Regex Explainer"
      desc="Paste a pattern and get it read back piece by piece in plain English — with live matches on your own test text."
      state={{ pattern, flags, test, showTokens }}
      onRestore={(restored) => {
        if (typeof restored.pattern === 'string') setPattern(restored.pattern);
        if (typeof restored.flags === 'string') setFlags(restored.flags);
        if (typeof restored.test === 'string') setTest(restored.test);
        if (typeof restored.showTokens === 'boolean') setShowTokens(restored.showTokens);
      }}
      exportText={report}
      exportName="regex-explained.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value=""
          onChange={(value) => {
            const preset = PRESETS.find((item) => item.label === value);
            if (preset) {
              setPattern(preset.pattern);
              setFlags(preset.flags);
            }
          }}
          options={PRESETS.map((item) => ({ value: item.label, label: item.label }))}
        />
        <CopyBtn value={snippet} label="Copy JS snippet" />
      </div>

      <Field label="Pattern" hint="Without the surrounding slashes">
        <div className="flex items-center gap-2">
          <span className="font-mono-j text-sm text-muted-foreground">/</span>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j" />
          <span className="font-mono-j text-sm text-muted-foreground">/{flags}</span>
        </div>
      </Field>

      <div className="flex flex-wrap gap-1.5">
        {['g', 'i', 'm', 's', 'u'].map((flag) => (
          <button
            key={flag}
            type="button"
            onClick={() => setFlags((current) => (current.includes(flag) ? current.replace(flag, '') : current + flag))}
            title={FLAG_NOTES[flag]}
            className={`rounded-lg border px-3 py-1 font-mono-j text-xs transition ${flags.includes(flag) ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
          >
            {flag}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{flags ? flags.split('').map((flag) => FLAG_NOTES[flag]).filter(Boolean).join(' · ') : 'No flags — case-sensitive, first match only.'}</p>

      {compiled.error && <Panel className="border-rose-500/40 text-[11px] text-rose-400">That pattern is not valid: {compiled.error}</Panel>}

      <Area label="Test text" value={test} onChange={setTest} rows={6} mono />

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Matches highlighted</div>
        <div className="whitespace-pre-wrap break-words font-mono-j text-[12px] leading-relaxed">
          {highlighted.map((segment, index) => (
            <span key={index} className={segment.match ? 'rounded bg-cyan-j/20 px-0.5 text-cyan-j' : 'text-muted-foreground'}>
              {segment.text}
            </span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Matches" value={String(matches.list.length)} mono />
        <Stat label="Tokens in pattern" value={String(tokens.length)} mono />
        <Stat label="Capture groups" value={String(matches.list[0]?.captures.length ?? 0)} mono />
        <Stat label="Readability" value={difficulty.label} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Piece by piece</span>
            <ToggleRow label="show" checked={showTokens} onChange={setShowTokens} />
          </div>
          {showTokens && (
            <div className="max-h-80 space-y-1 overflow-auto">
              {tokens.map((token, index) => (
                <div key={`${token.text}-${index}`} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="w-16 shrink-0 font-mono-j text-[11px] text-cyan-j">{token.text}</span>
                  <span className="flex-1 text-[11px] text-muted-foreground">{token.meaning}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What each match captured</div>
          <div className="max-h-80 space-y-1.5 overflow-auto">
            {matches.list.slice(0, 12).map((match, index) => (
              <div key={`${match.index}-${index}`} className="rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono-j text-cyan-j">#{index + 1} at {match.index}</span>
                  <span className="truncate font-mono-j text-muted-foreground">{match.text.slice(0, 40)}</span>
                </div>
                {match.groups && (
                  <div className="mt-1 space-y-0.5">
                    {Object.entries(match.groups).map(([name, value]) => (
                      <div key={name} className="font-mono-j text-[10px] text-muted-foreground">{name} → {value}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!matches.list.length && !matches.error && <span className="text-[11px] text-muted-foreground">No matches yet — adjust the pattern or the test text.</span>}
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Use it in code</span>
          <CopyBtn value={snippet} label="Copy" />
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{snippet}</pre>
      </Panel>

      <Panel className="!p-3">
        <Hero label="Pattern size" value={`${pattern.length}`} unit="characters" sub={`${tokens.length} pieces · ${difficulty.label}`} />
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The two rules that prevent most regex bugs: quantifiers are greedy by default (add ? to make them lazy), and <span className="font-mono-j">.</span>{' '}
          does not match newlines unless the s flag is set. Anchors <span className="font-mono-j">^</span> and <span className="font-mono-j">$</span> behave
          per line when m is on, which is usually what you want for pasted text.
        </p>
      </Panel>
    </ToolShell>
  );
}