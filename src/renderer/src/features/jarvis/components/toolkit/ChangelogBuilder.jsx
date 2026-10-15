import { useMemo, useState } from 'react';
import { Tags } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE = `feat(auth): add passkey sign in
fix(api): handle pagination when the cursor expires
feat(dashboard): add weekly summary card
perf(query): cache user lookups for 30 seconds
fix(ui): correct contrast on disabled buttons
docs: explain the deployment checklist
chore(deps): bump vite to 5.4.2
refactor(store): extract selection logic
test(api): cover the empty cursor case
feat!: drop support for the legacy token format
feat(reports): export the audit trail as CSV
ci: run the type check before the build`;

const SECTIONS = [
  { key: 'breaking', heading: 'Breaking changes', order: 0, types: [] },
  { key: 'feat', heading: 'Features', order: 1, types: ['feat', 'feature'] },
  { key: 'fix', heading: 'Fixes', order: 2, types: ['fix', 'bugfix'] },
  { key: 'perf', heading: 'Performance', order: 3, types: ['perf'] },
  { key: 'refactor', heading: 'Refactoring', order: 4, types: ['refactor'] },
  { key: 'docs', heading: 'Documentation', order: 5, types: ['docs'] },
  { key: 'test', heading: 'Tests', order: 6, types: ['test', 'tests'] },
  { key: 'build', heading: 'Build and CI', order: 7, types: ['build', 'ci', 'chore', 'deps'] },
  { key: 'style', heading: 'Style', order: 8, types: ['style'] },
  { key: 'revert', heading: 'Reverts', order: 9, types: ['revert'] },
  { key: 'other', heading: 'Other changes', order: 10, types: [] },
];

const bump = (version, level) => {
  const parts = String(version).replace(/^v/, '').split('.').map((value) => Number(value) || 0);
  while (parts.length < 3) parts.push(0);
  if (level === 'major') return (parts[0] + 1) + '.0.0';
  if (level === 'minor') return parts[0] + '.' + (parts[1] + 1) + '.0';
  return parts[0] + '.' + parts[1] + '.' + (parts[2] + 1);
};

export default function ChangelogBuilder() {
  const [raw, setRaw] = useState(SAMPLE);
  const [version, setVersion] = useState('1.4.2');
  const [repo, setRepo] = useState('');
  const [options, setOptions] = useState({ links: true, scopes: true, bump: true });
  const [mode, setMode] = useState('notes');

  const result = useMemo(() => {
    const lines = String(raw).split('\n').map((line) => line.trim()).filter(Boolean);
    const entries = [];
    const unmapped = [];

    lines.forEach((line) => {
      const match = line.match(/^([a-zA-Z]+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
      if (!match) {
        unmapped.push(line);
        return;
      }
      const type = match[1].toLowerCase();
      const scope = match[3] || '';
      const breaking = Boolean(match[4]) || /breaking change/i.test(line);
      const subject = match[5].trim();
      const refs = (subject.match(/#\d+/g) || []);
      const clean = subject.replace(/\s*\(#\d+\)\s*$/, '').trim();
      entries.push({ type, scope, breaking, subject: clean, refs, raw: line });
    });

    const grouped = SECTIONS.map((section) => ({
      ...section,
      items: entries.filter((entry) => {
        if (section.key === 'breaking') return entry.breaking;
        if (section.key === 'other') {
          return !entry.breaking && !SECTIONS.some((other) => other.types.includes(entry.type));
        }
        return section.types.includes(entry.type);
      }),
    })).filter((section) => section.items.length > 0).sort((a, b) => a.order - b.order);

    const hasBreaking = entries.some((entry) => entry.breaking);
    const hasFeature = entries.some((entry) => entry.type === 'feat' || entry.type === 'feature');
    const level = hasBreaking ? 'major' : hasFeature ? 'minor' : 'patch';
    const next = bump(version, level);

    const body = grouped.map((section) => {
      const heading = (section.key === 'breaking' ? '### Breaking changes' : '### ' + section.heading);
      const items = section.items.map((entry) => {
        const scope = options.scopes && entry.scope ? '**' + entry.scope + ':** ' : '';
        const refs = options.links && entry.refs.length
          ? ' (' + entry.refs.map((ref) => {
            const number = ref.replace('#', '');
            return repo ? '[' + ref + '](' + repo.replace(/\/$/, '') + '/issues/' + number + ')' : ref;
          }).join(', ') + ')'
          : entry.refs.join(', ');
        const marker = entry.breaking ? '**breaking** ' : '';
        return '- ' + marker + scope + entry.subject + refs;
      }).join('\n');
      return heading + '\n\n' + items;
    }).join('\n\n');

    const header = [
      '## ' + String(version).replace(/^v/, '') + ' — ' + new Date().toISOString().slice(0, 10),
      '',
      entries.length + ' changes: ' + entries.filter((entry) => entry.type === 'feat').length + ' features, ' +
      entries.filter((entry) => entry.type === 'fix').length + ' fixes, ' +
      entries.filter((entry) => entry.breaking).length + ' breaking.',
      '',
      hasBreaking ? 'Upgrading requires changes: read the breaking section before updating.' : 'This release is a drop-in upgrade.',
      '',
      body,
    ].join('\n');

    const summary = entries.length
      ? entries.length + ' changes parsed from ' + lines.length + ' lines. Recommended version bump: ' + level + ', from ' + version + ' to ' + next + '.'
      : 'Paste conventional commits to build a changelog.';

    return {
      entries, grouped, unmapped, header, level, next, summary,
      parsedShare: lines.length ? (entries.length / lines.length) * 100 : 0,
      counts: grouped.map((section) => ({ label: section.heading.split(' ')[0], value: section.items.length })),
      features: entries.filter((entry) => entry.type === 'feat').length,
      fixes: entries.filter((entry) => entry.type === 'fix').length,
      breaking: entries.filter((entry) => entry.breaking).length,
    };
  }, [raw, version, repo, options]);

  return (
    <ToolShell
      toolId="changelog"
      icon={Tags}
      title="Changelog & Release Notes Builder"
      desc="Paste conventional commits and get grouped release notes, the semantic version bump they imply and a list of anything that did not parse — ready to paste into a release."
      state={{ raw, version, repo, options, mode }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (typeof restored.version === 'string') setVersion(restored.version);
        if (typeof restored.repo === 'string') setRepo(restored.repo);
        if (restored.options) setOptions((current) => ({ ...current, ...restored.options }));
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={result.header}
      exportName="CHANGELOG.md"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'notes', label: 'Release notes' }, { value: 'parsed', label: 'What was parsed' }]} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Commit lines</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.entries.length} parsed of {result.entries.length + result.unmapped.length}</span>
          </div>
          <Area value={raw} onChange={setRaw} rows={12} mono placeholder={'feat(api): add pagination\nfix: correct the empty cursor case'} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            One commit per line in conventional form: type, optional scope in brackets, optional exclamation mark for a breaking change, then a colon and the description.
          </p>
        </Panel>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Current version"><input value={version} onChange={(e) => setVersion(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Repository URL, optional"><input value={repo} onChange={(e) => setRepo(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" placeholder="https://github.com/you/project" /></Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ToggleRow label="Link issue references" checked={options.links} onChange={() => setOptions((current) => ({ ...current, links: !current.links }))} />
            <ToggleRow label="Show scopes in bold" checked={options.scopes} onChange={() => setOptions((current) => ({ ...current, scopes: !current.scopes }))} />
            <ToggleRow label="Recommend a version bump" checked={options.bump} onChange={() => setOptions((current) => ({ ...current, bump: !current.bump }))} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Features" value={String(result.features)} mono />
            <Stat label="Fixes" value={String(result.fixes)} mono />
            <Stat label="Breaking" value={String(result.breaking)} mono sub="need a major bump" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.breaking ? 'amber' : 'emerald'}
          label={options.bump ? 'Recommended version' : 'Version being released'}
          value={options.bump ? result.next : version.replace(/^v/, '')}
          sub={options.bump
            ? 'The ' + result.level + ' bump follows from the commit types: ' + (result.breaking ? 'a breaking change always forces a major release, whatever else is included.' : result.features ? 'a new feature forces a minor release, and fixes ride along with it.' : 'fixes alone only need a patch release.')
            : 'Bump detection is switched off, so this is the version you entered unchanged.'}
        />
        <Ring
          value={result.parsedShare}
          max={100}
          tone={result.unmapped.length ? 'amber' : 'emerald'}
          label="Lines that parsed"
          sub={result.unmapped.length ? result.unmapped.length + ' lines did not follow the format and are listed below' : 'Every line followed the conventional format'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Changes per section</div>
          <Bars data={result.counts} format={(value) => String(value)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            This is the shape of the release. A version with twenty fixes and no features reads very differently to users than one with a single headline feature.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Anything the parser could not use</div>
          {result.unmapped.length ? (
            <div className="max-h-48 space-y-1 overflow-auto">
              {result.unmapped.map((line) => (
                <div key={line} className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-2.5 py-1.5 font-mono-j text-[11px] text-amber-200">{line}</div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Every line parsed cleanly.</p>
          )}
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            <p>· Merge commits, version bumps and dependabot lines usually land here. They rarely belong in user-facing notes.</p>
            <p>· A line that looks like a commit but has no type prefix is often a squash message that lost its formatting on the way in.</p>
            <p>· Rather than dropping these silently, decide per line whether a reader of the release notes would want to know.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Generated release notes</span>
          <div className="flex gap-2">
            <CopyBtn value={result.header} label="Copy Markdown" />
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([result.header], { type: 'text/markdown' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'CHANGELOG.md';
                link.click();
                URL.revokeObjectURL(link.href);
              }}
              className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
            >
              Download .md
            </button>
          </div>
        </div>
        <pre className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.header}</pre>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Every parsed change</div>
        <div className="max-h-72 space-y-1 overflow-auto">
          {result.entries.map((entry) => (
            <div key={entry.raw} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="rounded border border-border/60 px-1.5 py-0.5 font-mono-j text-[10px] text-cyan-j">{entry.type}</span>
              {entry.scope && <span className="font-mono-j text-[10px] text-muted-foreground">{entry.scope}</span>}
              {entry.breaking && <span className="rounded border border-amber-400/50 px-1.5 py-0.5 font-mono-j text-[10px] text-amber-300">breaking</span>}
              <span>{entry.subject}</span>
              {entry.refs.length > 0 && <span className="ml-auto font-mono-j text-[10px] text-muted-foreground">{entry.refs.join(' ')}</span>}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Writing a changelog people read</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Write for the person using the software, not for the person who wrote the commit. The message should say what changed for them.</p>
            <p>· Lead with the breaking changes. Anything else buried above them is a support ticket waiting to happen.</p>
            <p>· Group consistently. Features, fixes and everything else, every release, in the same order, so people can skim.</p>
            <p>· Cut the noise. Dependency bumps, formatting and internal refactors rarely deserve a line in user-facing notes.</p>
            <p>· Keep the headings stable so links to sections keep working release after release.</p>
            <p>· {result.breaking ? 'This release has ' + result.breaking + ' breaking change' + (result.breaking === 1 ? '' : 's') + ', so the upgrade instructions belong at the very top of the notes.' : 'Nothing here breaks compatibility, which is worth saying explicitly so people can upgrade without reading further.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Conventional commits, quickly</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>feat: a new capability for the user · minor bump</p>
            <p>fix: a bug fix for the user · patch bump</p>
            <p>feat!: or BREAKING CHANGE in the body · major bump</p>
            <p>perf, refactor, docs, test, build, ci, chore, style: no version change on their own</p>
            <p>scope in brackets names the area: feat(api), fix(ui)</p>
            <p className="text-cyan-j">The type is the contract. It is what lets a release be generated instead of assembled by hand.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Changes', value: String(result.entries.length) },
                { label: 'Bump', value: result.level },
                { label: 'Next version', value: result.next },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the version is decided</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>any breaking change → major: {result.breaking} found</p>
          <p>otherwise any feat → minor: {result.features} found</p>
          <p>otherwise → patch: {result.fixes} fixes and {result.entries.length - result.features - result.fixes} other changes</p>
          <p className="text-cyan-j">{version} with a {result.level} bump becomes {result.next}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The parser is deliberately strict so that anything it cannot classify is shown to you rather than guessed at. The generated notes are a solid first draft; the judgement
          about what a user needs to read stays with you.
        </p>
      </Panel>
    </ToolShell>
  );
}