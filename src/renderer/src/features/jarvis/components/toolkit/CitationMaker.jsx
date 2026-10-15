import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const STYLES = [
  { id: 'apa', label: 'APA 7' },
  { id: 'mla', label: 'MLA 9' },
  { id: 'harvard', label: 'Harvard' },
  { id: 'chicago', label: 'Chicago' },
  { id: 'ieee', label: 'IEEE' },
];

const surnames = (authors) => authors.map((author) => author.split(',')[0]?.trim()).filter(Boolean);

const initials = (name) => {
  const parts = name.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}, ${parts.slice(1).map((p) => `${p[0]}.`).join(' ')}`;
  const words = name.split(/\s+/);
  return `${words[words.length - 1]}, ${words.slice(0, -1).map((w) => `${w[0]}.`).join(' ')}`.trim();
};

export default function CitationMaker() {
  const [style, setStyle] = useState('apa');
  const [type, setType] = useState('book');
  const [authors, setAuthors] = useState('Orwell, George');
  const [year, setYear] = useState('1949');
  const [title, setTitle] = useState('Nineteen Eighty-Four');
  const [container, setContainer] = useState('Secker & Warburg');
  const [location, setLocation] = useState('London');
  const [publisher, setPublisher] = useState('Secker & Warburg');
  const [url, setUrl] = useState('https://example.com/1984');
  const [accessed, setAccessed] = useState(new Date().toISOString().slice(0, 10));
  const [pages, setPages] = useState('12–34');
  const [edition, setEdition] = useState('');

  const citation = useMemo(() => {
    const list = authors.split(';').map((a) => a.trim()).filter(Boolean);
    const yearValue = year || 'n.d.';
    const authorText = list.length ? list.map(initials).join(list.length > 1 ? ', & ' : '') : 'Unknown author';

    if (style === 'apa') {
      if (type === 'book') return `${authorText} (${yearValue}). ${title}${edition ? ` (${edition})` : ''}. ${publisher || location || ''}.`.replace(/\s+/g, ' ').replace(' .', '.');
      if (type === 'journal') return `${authorText} (${yearValue}). ${title}. ${container}, ${pages}. ${url}`;
      return `${authorText} (${yearValue}). ${title}. Retrieved ${accessed}, from ${url}`;
    }
    if (style === 'mla') {
      if (type === 'web') return `${authorText}. “${title}.” ${container}, ${yearValue}, ${url}. Accessed ${accessed}.`;
      if (type === 'journal') return `${authorText}. “${title}.” ${container}, ${pages}, ${yearValue}.`;
      return `${authorText}. ${title}. ${edition ? `${edition}, ` : ''}${publisher || location}, ${yearValue}.`;
    }
    if (style === 'harvard') {
      return `${authorText} (${yearValue}) ${title}. ${location || publisher || ''}${type === 'web' ? ` Available at: ${url} (Accessed: ${accessed})` : '.'}`.replace(/\s+/g, ' ');
    }
    if (style === 'chicago') {
      return `${list.join('; ') || 'Unknown'} ${yearValue}. “${title}.” ${container}. ${location || publisher}: ${publisher}.${url ? ` ${url}.` : ''}`;
    }
    return `[${surnames(list).join(' and ') || 'Anonymous'}] ${yearValue}. ${title}. ${container || publisher}. ${type === 'web' ? `${url}, accessed ${accessed}.` : `pp. ${pages}.`.trim()}`;
  }, [style, type, authors, year, title, container, location, publisher, url, accessed, pages, edition]);

  const inText = useMemo(() => {
    const list = authors.split(';').map((a) => a.trim()).filter(Boolean);
    const names = surnames(list);
    const yearValue = year || 'n.d.';
    if (style === 'apa' || style === 'harvard') {
      if (!names.length) return `(Unknown, ${yearValue})`;
      if (names.length === 1) return `(${names[0]}, ${yearValue})`;
      if (names.length === 2) return `(${names[0]} & ${names[1]}, ${yearValue})`;
      return `(${names[0]} et al., ${yearValue})`;
    }
    if (style === 'mla') return names.length > 2 ? `(${names[0]} et al.)` : `(${names.join(' and ')})`;
    if (style === 'chicago') return `(${names[0]} ${yearValue})`;
    return `[${list.map((_, index) => index + 1).join('], [')}]`;
  }, [authors, year, style]);

  const report = `${citation}\n\nIn-text: ${inText}`;

  return (
    <ToolShell
      toolId="citation"
      icon={BookOpen}
      title="Citation Maker"
      desc="Fill in the details once and get the reference in APA, MLA, Harvard, Chicago or IEEE — plus the matching in-text form."
      state={{ style, type, authors, year, title, container, location, publisher, url, accessed, pages, edition }}
      onRestore={(restored) => {
        if (restored.style) setStyle(restored.style);
        if (restored.type) setType(restored.type);
        if (typeof restored.authors === 'string') setAuthors(restored.authors);
        if (restored.year !== undefined) setYear(String(restored.year));
        if (typeof restored.title === 'string') setTitle(restored.title);
        if (typeof restored.container === 'string') setContainer(restored.container);
        if (typeof restored.location === 'string') setLocation(restored.location);
        if (typeof restored.publisher === 'string') setPublisher(restored.publisher);
        if (typeof restored.url === 'string') setUrl(restored.url);
        if (restored.accessed) setAccessed(restored.accessed);
        if (typeof restored.pages === 'string') setPages(restored.pages);
        if (typeof restored.edition === 'string') setEdition(restored.edition);
      }}
      exportText={report}
      exportName="citation.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={style} onChange={setStyle} options={STYLES.map((s) => ({ value: s.id, label: s.label }))} />
        <Seg value={type} onChange={setType} options={[{ value: 'book', label: 'Book' }, { value: 'journal', label: 'Journal' }, { value: 'web', label: 'Website' }]} />
        <CopyBtn value={citation} label="Copy reference" />
        <CopyBtn value={inText} label="Copy in-text" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Authors" hint="One per entry, “Surname, First” — separate multiple with ;">
          <input value={authors} onChange={(e) => setAuthors(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="Year">
          <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label={type === 'book' ? 'Edition (optional)' : 'Journal or site name'}>
          {type === 'book'
            ? <input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="2nd ed." className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            : <input value={container} onChange={(e) => setContainer(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />}
        </Field>
        {type === 'book' && (
          <>
            <Field label="Publisher">
              <input value={publisher} onChange={(e) => setPublisher(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Place of publication">
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
          </>
        )}
        {type !== 'book' && (
          <>
            <Field label="Pages">
              <input value={pages} onChange={(e) => setPages(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Accessed on">
              <input type="date" value={accessed} onChange={(e) => setAccessed(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
          </>
        )}
        <Field label="URL" hint="Leave blank for print sources">
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reference — {STYLES.find((s) => s.id === style)?.label}</div>
        <p className="mt-2 text-sm leading-relaxed">{citation}</p>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">In-text citation</div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
          <span className="font-mono-j text-xs text-cyan-j">{inText}</span>
          <CopyBtn value={inText} label="Copy" />
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Style" value={STYLES.find((s) => s.id === style)?.label || style} />
        <Stat label="Authors" value={String(authors.split(';').filter((a) => a.trim()).length)} mono />
        <Stat label="Characters" value={String(citation.length)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each style has its own obsession: APA wants the year early and uses “&”, MLA puts the title in quotes, Harvard prefers “Available at”, and
          IEEE numbers the reference. Italics are hard to express in plain text — when you paste this into a document, italicise the book or journal
          title and the volume number yourself.
        </p>
      </Panel>
    </ToolShell>
  );
}