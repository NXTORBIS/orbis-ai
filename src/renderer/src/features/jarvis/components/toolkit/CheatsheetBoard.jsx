import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CopyBtn, Panel, Stat, useCopy } from './shared';

export default function CheatsheetBoard({ groups, placeholder, footer }) {
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState('all');
  const { copy, copied } = useCopy();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => openGroup === 'all' || g.id === openGroup)
      .map((g) => ({
        ...g,
        items: q
          ? g.items.filter((item) => item.cmd.toLowerCase().includes(q) || (item.what || '').toLowerCase().includes(q))
          : g.items,
      }))
      .filter((g) => g.items.length);
  }, [groups, query, openGroup]);

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const shown = filtered.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[{ id: 'all', label: 'Everything' }, ...groups].map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setOpenGroup(g.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              openGroup === g.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {!!query && <p className="text-[11px] text-muted-foreground">{shown} of {total} commands match “{query}”.</p>}

      <div className="space-y-3">
        {filtered.map((g) => (
          <Panel key={g.id} className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">{g.label}</span>
              {g.note && <span className="text-[10px] text-muted-foreground">{g.note}</span>}
            </div>
            <div className="space-y-1">
              {g.items.map((item) => (
                <div key={`${g.id}-${item.cmd}`} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-2 transition hover:border-cyan-j/40">
                  <button
                    type="button"
                    onClick={() => copy(item.cmd)}
                    title="Copy this command"
                    className="min-w-0 flex-1 text-left font-mono-j text-[11.5px] text-cyan-j"
                  >
                    {item.cmd}
                  </button>
                  <span className="min-w-0 flex-[1.1] text-[11px] text-muted-foreground">{item.what}</span>
                  <button
                    type="button"
                    onClick={() => copy(item.cmd)}
                    className="shrink-0 rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
                  >
                    {copied ? 'ok' : 'copy'}
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        ))}
        {!filtered.length && <Panel className="text-[11px] text-muted-foreground">No command here matches “{query}”.</Panel>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Commands" value={String(total)} mono />
        <Stat label="Shown" value={String(shown)} mono />
        <Stat label="Groups" value={String(groups.length)} mono />
      </div>

      {footer && (
        <Panel>
          <p className="text-[11px] text-muted-foreground">{footer}</p>
        </Panel>
      )}
    </>
  );
}

export function CopyAll({ groups, label = 'Copy everything' }) {
  const text = groups.map((g) => `# ${g.label}\n${g.items.map((i) => `${i.cmd}${i.what ? `\t# ${i.what}` : ''}`).join('\n')}`).join('\n\n');
  return <CopyBtn value={text} label={label} />;
}