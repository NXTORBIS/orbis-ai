import { useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const TYPES = [
  { id: 'feat', label: 'feat', hint: 'A new feature for the user' },
  { id: 'fix', label: 'fix', hint: 'A bug fix' },
  { id: 'docs', label: 'docs', hint: 'Documentation only' },
  { id: 'style', label: 'style', hint: 'Formatting, no code change' },
  { id: 'refactor', label: 'refactor', hint: 'Neither fixes a bug nor adds a feature' },
  { id: 'perf', label: 'perf', hint: 'Improves performance' },
  { id: 'test', label: 'test', hint: 'Adding or fixing tests' },
  { id: 'build', label: 'build', hint: 'Build system or dependencies' },
  { id: 'ci', label: 'ci', hint: 'CI configuration' },
  { id: 'chore', label: 'chore', hint: 'Routine tasks' },
  { id: 'revert', label: 'revert', hint: 'Undoes a previous commit' },
];

export default function CommitBuilder() {
  const [type, setType] = useState('feat');
  const [scope, setScope] = useState('toolkit');
  const [subject, setSubject] = useState('add 24 more utilities to the registry');
  const [body, setBody] = useState('');
  const [breaking, setBreaking] = useState(false);
  const [breakingNote, setBreakingNote] = useState('');
  const [issues, setIssues] = useState('closes #142');
  const [coAuthors, setCoAuthors] = useState('');
  const [emoji, setEmoji] = useState(false);

  const EMOJI = { feat: '✨', fix: '🐛', docs: '📝', style: '💄', refactor: '♻️', perf: '⚡', test: '✅', build: '📦', ci: '👷', chore: '🔧', revert: '⏪' };

  const parsed = useMemo(() => {
    const raw = subject.trim();
    const imperative = /^(add|fix|update|remove|rename|move|introduce|allow|prevent|simplify|extract|support|document|test|bump|drop|make|use|handle|improve|switch|replace|implement|correct|avoid|ensure|expose)\b/i.test(raw);
    const capitalised = /^[A-Z]/.test(raw) && !/^[A-Z]{2,}/.test(raw);
    const endsWithPeriod = /\.$/.test(raw);
    const length = raw.length;
    return { imperative, capitalised, endsWithPeriod, length };
  }, [subject]);

  const header = useMemo(() => {
    const tag = emoji ? `${EMOJI[type] || ''} ` : '';
    const breakingMark = breaking ? '!' : '';
    const scopePart = scope.trim() ? `(${scope.trim().replace(/\s+/g, '-')})` : '';
    return `${tag}${type}${scopePart}${breakingMark}: ${subject.trim()}`;
  }, [type, scope, subject, breaking, emoji]);

  const message = useMemo(() => {
    const lines = [header];
    if (body.trim()) lines.push('', body.trim());
    if (breaking) lines.push('', `BREAKING CHANGE: ${breakingNote.trim() || 'describe what callers must change'}`);
    if (issues.trim()) lines.push('', issues.trim());
    if (coAuthors.trim()) {
      coAuthors.split('\n').map((line) => line.trim()).filter(Boolean).forEach((person) => lines.push(`Co-authored-by: ${person}`));
    }
    return lines.join('\n');
  }, [header, body, breaking, breakingNote, issues, coAuthors]);

  const commitCommand = `git commit -m "${header.replace(/"/g, '\\"')}"${body.trim() ? ` -m "${body.trim().replace(/\n/g, ' ').replace(/"/g, '\\"')}"` : ''}`;

  const changelog = `### ${type === 'feat' ? 'Added' : type === 'fix' ? 'Fixed' : type === 'perf' ? 'Performance' : 'Changed'}
- ${subject.trim()}${scope.trim() ? ` (${scope.trim()})` : ''}`;

  const checks = [
    { ok: parsed.length > 0 && parsed.length <= 72, label: `${parsed.length}/72 characters`, hint: 'Header length — git log truncates beyond 72' },
    { ok: parsed.imperative, label: 'Starts with an imperative verb', hint: '“add”, not “added” or “adds”' },
    { ok: !parsed.capitalised, label: 'Subject starts lowercase', hint: 'The type prefix already carries the emphasis' },
    { ok: !parsed.endsWithPeriod, label: 'No full stop at the end', hint: 'The header is a title, not a sentence' },
    { ok: !/^(fixed|fixes|added|adds|updated|updates)\b/i.test(subject.trim()), label: 'Tense reads correctly', hint: 'Past tense reads as a changelog, not a diff' },
  ];

  return (
    <ToolShell
      toolId="commit"
      icon={GitBranch}
      title="Commit Message Builder"
      desc="Write a conventional commit that reviewers and changelog tools understand — with the tense, length and formatting checked for you."
      state={{ type, scope, subject, body, breaking, breakingNote, issues, coAuthors, emoji }}
      onRestore={(restored) => {
        if (restored.type) setType(restored.type);
        if (typeof restored.scope === 'string') setScope(restored.scope);
        if (typeof restored.subject === 'string') setSubject(restored.subject);
        if (typeof restored.body === 'string') setBody(restored.body);
        if (typeof restored.breaking === 'boolean') setBreaking(restored.breaking);
        if (typeof restored.breakingNote === 'string') setBreakingNote(restored.breakingNote);
        if (typeof restored.issues === 'string') setIssues(restored.issues);
        if (typeof restored.coAuthors === 'string') setCoAuthors(restored.coAuthors);
        if (typeof restored.emoji === 'boolean') setEmoji(restored.emoji);
      }}
      exportText={message}
      exportName="commit-message.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={message} label="Copy message" />
        <CopyBtn value={commitCommand} label="Copy git command" />
        <CopyBtn value={changelog} label="Copy changelog line" />
      </div>

      <Field label="Type">
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setType(option.id)}
              title={option.hint}
              className={`rounded-lg border px-2.5 py-1 font-mono-j text-[11px] transition ${type === option.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Scope (optional)" hint="Which area changed — toolkit, auth, api">
          <input value={scope} onChange={(e) => setScope(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Subject">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>

      <Field label="Body (optional)" hint="What changed and why — wrap at 72 columns">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 text-sm" />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Breaking change" checked={breaking} onChange={setBreaking} hint="Adds ! and a footer" />
        <ToggleRow label="Add a type emoji" checked={emoji} onChange={setEmoji} hint="Nice for changelogs, noisy in some repos" />
      </div>

      {breaking && (
        <Field label="What breaks for callers">
          <input value={breakingNote} onChange={(e) => setBreakingNote(e.target.value)} placeholder="the old export name is gone" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Issue references">
          <input value={issues} onChange={(e) => setIssues(e.target.value)} placeholder="closes #142" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Co-authors" hint="One per line, Name <email>">
          <input value={coAuthors} onChange={(e) => setCoAuthors(e.target.value)} placeholder="Ada Lovelace <ada@example.com>" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Commit message</div>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono-j text-[12px] text-cyan-j">{message}</pre>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Style checks</div>
        <div className="space-y-1">
          {checks.map((check) => (
            <div key={check.label} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${check.ok ? 'border-cyan-j/40 bg-cyan-j/5 text-cyan-j' : 'border-amber-500/40 bg-amber-500/5 text-amber-500'}`}>
              <span className="font-mono-j">{check.ok ? 'ok' : 'fix'}</span>
              <span className="flex-1">{check.label}</span>
              <span className="hidden text-muted-foreground sm:block">{check.hint}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Header" value={`${parsed.length} chars`} mono />
        <Stat label="Type" value={type} mono />
        <Stat label="Breaking" value={breaking ? 'yes' : 'no'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Conventional commits are useful because machines read them: changelog generators group by type, semantic-release cuts versions from them, and
          reviewers can see intent before code. The header line is the headline — put the reasoning in the body, where it belongs.
        </p>
      </Panel>
    </ToolShell>
  );
}