import { useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat } from './shared';

const parse = (raw) => {
  const m = String(raw || '').trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] || 0), patch: Number(m[3] || 0), pre: m[4] || '', build: m[5] || '' };
};

const cmpPre = (a, b) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const A = a.split('.');
  const B = b.split('.');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i];
    const y = B[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
};

const compare = (a, b) => {
  const A = parse(a);
  const B = parse(b);
  if (!A || !B) return null;
  if (A.major !== B.major) return A.major > B.major ? 1 : -1;
  if (A.minor !== B.minor) return A.minor > B.minor ? 1 : -1;
  if (A.patch !== B.patch) return A.patch > B.patch ? 1 : -1;
  return cmpPre(A.pre, B.pre);
};

const expand = (token) => {
  const t = token.trim();
  if (!t || t === '*' || t === 'x' || t === 'X' || t === 'latest') return [['>=', '0.0.0']];
  if (t.startsWith('^')) {
    const v = parse(t.slice(1));
    if (!v) return null;
    const upper = v.major > 0 ? `${v.major + 1}.0.0` : v.minor > 0 ? `0.${v.minor + 1}.0` : `0.0.${v.patch + 1}`;
    return [['>=', `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ''}`], ['<', upper]];
  }
  if (t.startsWith('~')) {
    const v = parse(t.slice(1));
    if (!v) return null;
    return [['>=', `${v.major}.${v.minor}.${v.patch}`], ['<', `${v.major}.${v.minor + 1}.0`]];
  }
  const m = t.match(/^([<>]=?|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);
  if (!m) return null;
  const op = m[1] || '=';
  const major = Number(m[2]);
  const minor = m[3];
  const patch = m[4];
  if (op === '=' && (minor === undefined || minor === 'x' || minor === '*' || patch === 'x' || patch === '*')) {
    if (minor === undefined || minor === 'x' || minor === '*') return [['>=', `${major}.0.0`], ['<', `${major + 1}.0.0`]];
    return [['>=', `${major}.${Number(minor)}.0`], ['<', `${major}.${Number(minor) + 1}.0`]];
  }
  const minorNum = minor === undefined || minor === 'x' || minor === '*' ? 0 : Number(minor);
  const patchNum = patch === undefined || patch === 'x' || patch === '*' ? 0 : Number(patch);
  return [[op, `${major}.${minorNum}.${patchNum}`]];
};

const satisfies = (version, range) => {
  if (!parse(version)) return { ok: null, clauses: [] };
  const sets = String(range || '*').split('||');
  const clauses = [];
  let ok = false;
  sets.forEach((set) => {
    const hyphen = set.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/);
    const tests = hyphen
      ? [['>=', hyphen[1]], ['<=', hyphen[2]]]
      : set.trim().split(/\s+/).filter(Boolean).flatMap((token) => expand(token) || []);
    if (!tests.length) return;
    const result = tests.every(([op, target]) => {
      const c = compare(version, target);
      if (c === null) return false;
      if (op === '>') return c > 0;
      if (op === '>=') return c >= 0;
      if (op === '<') return c < 0;
      if (op === '<=') return c <= 0;
      return c === 0;
    });
    clauses.push({ source: set.trim(), tests, result });
    if (result) ok = true;
  });
  return { ok, clauses };
};

const RANGES = ['^1.2.3', '~1.2.0', '>=2.0.0 <3.0.0', '1.2.x', '1.x', '1.2.3 - 2.0.0', '>=1.5.0 || 0.9.x', '*'];

export default function SemverTool() {
  const [a, setA] = useState('2.4.1');
  const [b, setB] = useState('2.5.0');
  const [range, setRange] = useState('^2.4.0');

  const ordering = compare(a, b);
  const parsedA = parse(a);
  const parsedB = parse(b);
  const check = useMemo(() => satisfies(a, range), [a, range]);

  const bumps = useMemo(() => {
    const v = parse(a);
    if (!v) return [];
    return [
      { label: 'Patch', value: `${v.major}.${v.minor}.${v.patch + 1}` },
      { label: 'Minor', value: `${v.major}.${v.minor + 1}.0` },
      { label: 'Major', value: `${v.major + 1}.0.0` },
      { label: 'Prerelease', value: `${v.major}.${v.minor}.${v.patch}-rc.1` },
      { label: 'Next from here', value: `${v.major}.${v.minor}.${v.patch + 1}-beta.1` },
    ];
  }, [a]);

  const verdict = ordering === null ? 'One of these is not a valid version' : ordering > 0 ? `${a} is newer than ${b}` : ordering < 0 ? `${a} is older than ${b}` : 'Both versions are equal in precedence';

  const report = [
    `Ordering: ${verdict}`,
    `Range ${range}: ${check.ok === null ? 'cannot test' : check.ok ? 'satisfied by ' + a : a + ' does NOT satisfy it'}`,
    ...bumps.map((bump) => `${bump.label}: ${bump.value}`),
  ].join('\n');

  return (
    <ToolShell
      toolId="semver"
      icon={GitBranch}
      title="Semver Toolkit"
      desc="Compare versions the way package managers do, bump them correctly and test any range."
      state={{ a, b, range }}
      onRestore={(saved) => {
        if (saved.a !== undefined) setA(saved.a);
        if (saved.b !== undefined) setB(saved.b);
        if (saved.range !== undefined) setRange(saved.range);
      }}
      exportText={report}
      exportName="semver.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Version A">
          <input value={a} onChange={(e) => setA(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Version B">
          <input value={b} onChange={(e) => setB(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Range">
          <input value={range} onChange={(e) => setRange(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>

      <Panel className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Ordering</span>
        <span className={`text-sm font-semibold ${ordering === null ? 'text-red-500' : 'text-cyan-j'}`}>{verdict}</span>
      </Panel>

      <div className="flex flex-wrap gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`rounded-lg border px-2.5 py-1.5 font-mono-j text-[11px] transition ${range === r ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {r}
          </button>
        ))}
      </div>

      <Panel className={check.ok === false ? 'border-red-500/40' : check.ok ? 'border-cyan-j/40' : ''}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Does {a} satisfy {range}?</span>
          <span className={`text-sm font-semibold ${check.ok ? 'text-cyan-j' : 'text-red-500'}`}>{check.ok === null ? '—' : check.ok ? 'Yes' : 'No'}</span>
        </div>
        <div className="space-y-1">
          {check.clauses.map((clause, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="font-mono-j text-[11px]">{clause.source}</span>
              <span className="text-[10px] text-muted-foreground">→</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">
                {clause.tests.map(([op, v]) => `${v} ${op === '>=' ? '≤' : op === '<=' ? '≥' : op === '>' ? '<' : op === '<' ? '>' : '='} version`).join(' · ')}
              </span>
              <span className={`ml-auto text-[10px] font-semibold ${clause.result ? 'text-cyan-j' : 'text-red-500'}`}>{clause.result ? 'match' : 'no'}</span>
            </div>
          ))}
          {!check.clauses.length && <p className="py-2 text-center text-[11px] text-muted-foreground">Enter a valid version and range.</p>}
        </div>
      </Panel>

      <Panel>
        <div className="mb-2 text-xs font-medium">Parts</div>
        <div className="grid grid-cols-2 gap-2">
          {[{ label: 'Version A', v: parsedA }, { label: 'Version B', v: parsedB }].map(({ label, v }) => (
            <div key={label} className="rounded-lg border border-border/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
              {v ? (
                <div className="mt-1 space-y-0.5 font-mono-j text-[11px]">
                  <div>{v.major} . {v.minor} . {v.patch}</div>
                  <div className="text-muted-foreground">pre: {v.pre || '—'}</div>
                  <div className="text-muted-foreground">build: {v.build || '—'}</div>
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-red-500">not a version</div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="mb-2 text-xs font-medium">Bump {a}</div>
        <div className="space-y-1">
          {bumps.map((bump) => (
            <div key={bump.label} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{bump.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono-j text-xs">{bump.value}</span>
              <CopyBtn value={bump.value} />
            </div>
          ))}
          {!bumps.length && <p className="py-2 text-center text-[11px] text-muted-foreground">Enter a version like 2.4.1.</p>}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="A parts" value={parsedA ? `${parsedA.major}.${parsedA.minor}.${parsedA.patch}` : '—'} mono />
        <Stat label="B parts" value={parsedB ? `${parsedB.major}.${parsedB.minor}.${parsedB.patch}` : '—'} mono />
        <Stat label="Prereleases" value={[parsedA, parsedB].filter((v) => v && v.pre).length ? 'in play' : 'none'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A version without a prerelease is newer than the same version with one, so 2.0.0 beats 2.0.0-rc.1. Caret ranges allow changes that don't touch
          the leftmost non-zero number, and tildes allow only patch-level drift.
        </p>
      </Panel>
    </ToolShell>
  );
}