import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Panel, Seg, Stat } from './shared';

const GROUPS = [
  {
    id: 'perceivable',
    label: 'Perceivable',
    intro: 'Information must be present in a way people can take in',
    items: [
      { id: 'alt', text: 'Every meaningful image has alternative text; decorative ones are marked as such', level: 'A', severity: 'blocker' },
      { id: 'video-captions', text: 'Video with speech has captions, and audio-only content has a transcript', level: 'A', severity: 'blocker' },
      { id: 'contrast-text', text: 'Body text reaches a 4.5:1 contrast ratio against its background', level: 'AA', severity: 'blocker' },
      { id: 'contrast-large', text: 'Large text and UI borders reach at least 3:1', level: 'AA', severity: 'high' },
      { id: 'colour-alone', text: 'Nothing relies on colour alone to carry meaning', level: 'A', severity: 'high' },
      { id: 'headings', text: 'Content is structured with real headings in a sensible order', level: 'A', severity: 'high' },
      { id: 'reflow', text: 'Content reflows to a narrow screen without horizontal scrolling', level: 'AA', severity: 'high' },
      { id: 'resize-text', text: 'Text can be enlarged to 200% without loss of content or function', level: 'AA', severity: 'high' },
      { id: 'audio-control', text: 'Any audio that plays automatically can be paused or stopped', level: 'A', severity: 'medium' },
    ],
  },
  {
    id: 'operable',
    label: 'Operable',
    intro: 'Every control must be reachable and usable',
    items: [
      { id: 'keyboard', text: 'Everything works with a keyboard alone, including menus and modals', level: 'A', severity: 'blocker' },
      { id: 'no-trap', text: 'Focus is never trapped inside a component with no way out', level: 'A', severity: 'blocker' },
      { id: 'focus-visible', text: 'The focused element is always visibly indicated', level: 'AA', severity: 'high' },
      { id: 'skip-link', text: 'A skip-to-content link is offered before repeated navigation', level: 'A', severity: 'medium' },
      { id: 'target-size', text: 'Touch targets are at least 24×24 CSS pixels, with space around them', level: 'AA', severity: 'high' },
      { id: 'no-timing', text: 'Time limits can be extended, or are generous enough not to matter', level: 'A', severity: 'medium' },
      { id: 'no-flash', text: 'Nothing flashes more than three times a second', level: 'A', severity: 'blocker' },
      { id: 'motion', text: 'Animation respects prefers-reduced-motion', level: 'AAA', severity: 'medium' },
      { id: 'page-title', text: 'Every page has a title that describes it', level: 'A', severity: 'medium' },
    ],
  },
  {
    id: 'understandable',
    label: 'Understandable',
    intro: 'The interface must behave predictably and be written clearly',
    items: [
      { id: 'lang', text: 'The page language is declared, and any change of language inside it is marked', level: 'A', severity: 'medium' },
      { id: 'labels', text: 'Every input has a visible label that stays visible while typing', level: 'A', severity: 'blocker' },
      { id: 'errors', text: 'Errors name the field, describe the problem and say how to fix it', level: 'A', severity: 'blocker' },
      { id: 'required', text: 'Required fields are marked before submission, not only after failing', level: 'A', severity: 'high' },
      { id: 'reversible', text: 'Destructive actions can be undone or confirmed', level: 'AA', severity: 'high' },
      { id: 'consistency', text: 'Navigation and components behave the same way across the product', level: 'AA', severity: 'medium' },
      { id: 'plain-language', text: 'Instructions are in plain language, with jargon expanded on first use', level: 'AAA', severity: 'low' },
      { id: 'autocomplete', text: 'Inputs that ask for personal data allow autofill', level: 'AA', severity: 'low' },
    ],
  },
  {
    id: 'robust',
    label: 'Robust',
    intro: 'It must work with assistive technology, now and later',
    items: [
      { id: 'semantics', text: 'Native elements are used for buttons, links and inputs rather than clickable divs', level: 'A', severity: 'blocker' },
      { id: 'name-role', text: 'Custom widgets expose a name, a role and a state', level: 'A', severity: 'high' },
      { id: 'aria-live', text: 'Status messages that appear dynamically are announced', level: 'AA', severity: 'high' },
      { id: 'parse', text: 'Markup is valid: no duplicate ids, no broken nesting', level: 'A', severity: 'medium' },
      { id: 'zoom-mobile', text: 'Pinch zoom is not disabled on mobile', level: 'AA', severity: 'high' },
      { id: 'orientation', text: 'The layout works in both portrait and landscape', level: 'AA', severity: 'medium' },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, group: group.id, groupLabel: group.label })));

export default function A11yChecklist() {
  const [done, setDone] = useState({});
  const [notes, setNotes] = useState({});
  const [filter, setFilter] = useState('all');
  const [noteFor, setNoteFor] = useState('');

  const stats = useMemo(() => {
    const total = ALL_ITEMS.length;
    const complete = ALL_ITEMS.filter((item) => done[item.id]).length;
    const blockers = ALL_ITEMS.filter((item) => item.severity === 'blocker');
    const blockersDone = blockers.filter((item) => done[item.id]).length;
    const openBlockers = blockers.length - blockersDone;
    const groups = GROUPS.map((group) => {
      const items = group.items;
      const completeGroup = items.filter((item) => done[item.id]).length;
      return {
        id: group.id,
        label: group.label,
        intro: group.intro,
        total: items.length,
        complete: completeGroup,
        percent: items.length ? (completeGroup / items.length) * 100 : 0,
        blockersOpen: items.filter((item) => item.severity === 'blocker' && !done[item.id]).length,
        items,
      };
    });
    return { total, complete, percent: total ? (complete / total) * 100 : 0, blockersOpen: openBlockers, blockersDone, blockers: blockers.length, groups, open: total - complete };
  }, [done]);

  const report = useMemo(() => [
    'Accessibility review — ' + stats.complete + ' of ' + stats.total + ' checks done (' + stats.percent.toFixed(0) + '%)',
    stats.blockersOpen ? 'Open blockers: ' + stats.blockersOpen : 'No open blockers',
    '',
    ...stats.groups.map((group) => [
      group.label + ' — ' + group.complete + '/' + group.total,
      ...group.items.map((item) => (done[item.id] ? '[x] ' : '[ ] ') + item.text + (notes[item.id] ? ' — ' + notes[item.id] : '')),
      '',
    ].join('\n')),
  ].join('\n'), [stats, done, notes]);

  const groupsToShow = stats.groups.map((group) => ({
    ...group,
    visible: group.items.filter((item) => {
      if (filter === 'todo') return !done[item.id];
      if (filter === 'done') return !!done[item.id];
      if (filter === 'blockers') return item.severity === 'blocker' && !done[item.id];
      return true;
    }),
  })).filter((group) => group.visible.length);

  const toggle = (id) => setDone((current) => ({ ...current, [id]: !current[id] }));

  return (
    <ToolShell
      toolId="a11y-checklist"
      icon={Eye}
      title="Accessibility Review Checklist"
      desc="A working WCAG-derived checklist grouped by principle, with blockers called out, progress per area, notes against each item and a report you can hand over."
      state={{ done, notes }}
      onRestore={(restored) => {
        if (restored.done && typeof restored.done === 'object') setDone(restored.done);
        if (restored.notes && typeof restored.notes === 'object') setNotes(restored.notes);
      }}
      exportText={report}
      exportName="accessibility-review.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <Hero
          tone={stats.blockersOpen === 0 ? 'emerald' : stats.blockersOpen <= 3 ? 'amber' : 'rose'}
          label={stats.blockersOpen === 0 ? 'No open blockers' : stats.blockersOpen + ' blocker' + (stats.blockersOpen === 1 ? '' : 's') + ' still open'}
          value={stats.percent.toFixed(0) + '%'}
          sub={stats.complete + ' of ' + stats.total + ' checks signed off. Blockers are the failures that make part of the product unusable for somebody — they come before everything else.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Progress by principle</div>
          <div className="space-y-2">
            {stats.groups.map((group) => (
              <div key={group.id}>
                <div className="flex justify-between text-[11px]">
                  <span>{group.label}{group.blockersOpen ? ' · ' + group.blockersOpen + ' blocker open' : ''}</span>
                  <span className="font-mono-j text-muted-foreground">{group.complete}/{group.total}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: group.percent + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all', label: 'Everything' }, { value: 'todo', label: 'Still to do' }, { value: 'blockers', label: 'Blockers' }, { value: 'done', label: 'Done' }]}
        />
        <CopyBtn value={report} label="Copy the report" />
        <button type="button" onClick={() => { setDone({}); setNotes({}); }} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground">
          Reset the review
        </button>
      </div>

      {groupsToShow.map((group) => (
        <Panel key={group.id} className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium">{group.label}</div>
              <div className="text-[10px] text-muted-foreground">{group.intro}</div>
            </div>
            <span className="font-mono-j text-[10px] text-muted-foreground">{group.complete}/{group.total}</span>
          </div>
          <div className="space-y-1.5">
            {group.visible.map((item) => (
              <div key={item.id} className={done[item.id] ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2' : 'rounded-lg border border-border/60 bg-card/40 px-2.5 py-2'}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={!!done[item.id]} onChange={() => toggle(item.id)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--cyan))]" />
                  <div className="flex-1">
                    <div className={done[item.id] ? 'text-[11px] line-through decoration-emerald-500/60' : 'text-[11px]'}>{item.text}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="rounded border border-border/60 px-1.5 py-0.5 font-mono-j text-muted-foreground">WCAG {item.level}</span>
                      <span className={item.severity === 'blocker' ? 'rounded border border-rose-500/40 px-1.5 py-0.5 text-rose-300' : item.severity === 'high' ? 'rounded border border-amber-500/40 px-1.5 py-0.5 text-amber-300' : 'rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground'}>
                        {item.severity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNoteFor(noteFor === item.id ? '' : item.id)}
                        className="rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground transition hover:text-foreground"
                      >
                        {notes[item.id] ? 'Edit note' : 'Add note'}
                      </button>
                      {notes[item.id] && <span className="truncate text-muted-foreground">{notes[item.id]}</span>}
                    </div>
                    {noteFor === item.id && (
                      <input
                        autoFocus
                        value={notes[item.id] || ''}
                        onChange={(e) => setNotes((current) => ({ ...current, [item.id]: e.target.value }))}
                        onBlur={() => setNoteFor('')}
                        placeholder="What did you find, and what needs changing?"
                        className="mt-2 h-8 w-full rounded-md border border-input bg-transparent px-2 text-[11px]"
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}

      {!groupsToShow.length && <Panel className="text-[12px] text-muted-foreground">Nothing matches this filter.</Panel>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How to work through this</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Fix blockers first, in the operability group especially. A control that cannot be reached by keyboard is not inconvenient, it is missing.</p>
            <p>· Then contrast and focus. Those two carry most of the difference between a usable interface and a frustrating one.</p>
            <p>· Test with the keyboard alone before anything else: tab through the whole page and check you can always see where you are and always get back out.</p>
            <p>· Zoom to 200% and to a 320-pixel-wide window. Most layout failures appear in one of those two states.</p>
            <p>· Run a screen reader through the primary task once. Five minutes of listening finds more than an hour of reading rules.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why it is worth the time</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Accessible interfaces tend to be faster, calmer and easier for everyone — captions, contrast and focus states all help people with no impairment at all.</p>
            <p>· Screen readers, keyboard users and voice control are one audience with three routes into the same interface; making one work usually fixes the others.</p>
            <p>· Legal requirements increasingly point at this standard, and a logged review is the evidence that you looked.</p>
            <p>· {stats.blockersDone ? 'You have closed ' + stats.blockersDone + ' blocker' + (stats.blockersDone === 1 ? '' : 's') + ' already — that is the part that changes whether a person can use the product at all.' : 'Start with the nine blocker items; the rest of the list is polish by comparison.'}</p>
            <p>· Notes are kept per item, so a review can be handed over with the reasoning attached rather than as a bare tick list.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Complete" value={stats.percent.toFixed(0) + '%'} mono sub={stats.complete + ' of ' + stats.total} />
        <Stat label="Blockers open" value={String(stats.blockersOpen)} mono sub={stats.blockers + ' in total'} />
        <Stat label="Still to do" value={String(stats.open)} mono />
        <Stat label="Notes added" value={String(Object.values(notes).filter(Boolean).length)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What the levels mean</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· <span className="font-mono-j text-cyan-j">A</span> — the baseline. Missing these makes the product unusable for some people, and they are the first thing an audit flags.</p>
          <p>· <span className="font-mono-j text-cyan-j">AA</span> — the level most requirements and policies actually name. Contrast, focus, reflow and target size live here.</p>
          <p>· <span className="font-mono-j text-cyan-j">AAA</span> — enhanced: reduced motion, plain language, stronger contrast. Worth reaching for, not always achievable.</p>
          <p>· Severity is about consequence rather than level: a blocker means somebody cannot complete the task at all, whatever the letter.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Filter', value: filter },
              { label: 'Checks', value: String(stats.total) },
              { label: 'Blockers closed', value: stats.blockersDone + '/' + stats.blockers },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The list is drawn from the four principles of the guidelines rather than copied clause by clause, so it reads as a review you can actually run: one item,
          one thing to check, one place to note what you found. Ticks and notes are saved with the tool, so a review can be paused and resumed.
        </p>
      </Panel>
    </ToolShell>
  );
}