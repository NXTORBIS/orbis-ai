import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Panel, Seg, Stat } from './shared';

const PRESETS = {
  common: [
    '.card',
    '.card .title',
    'nav ul li a',
    '#sidebar .menu > li.active',
    'article p:first-child',
    'button:hover',
    'input[type="text"]:focus',
    'body .wrapper #main .content p',
  ],
  modern: [
    ':where(.card) .title',
    ':is(h1, h2, h3)',
    '.grid > *:not(.hidden)',
    '.btn:hover::before',
    'ul > li:nth-child(2n + 1)',
    '[data-state="open"] .panel',
    '.theme-dark .card',
    ':root .card',
  ],
  utilities: [
    '.p-4',
    '.flex.items-center',
    '.text-sm.font-medium',
    'button.bg-primary.text-white',
    '.hover\\:underline:hover',
    '.md\\:grid-cols-3',
    '.dark .bg-card',
    'input:disabled',
  ],
};

const splitTop = (selector) => {
  let depth = 0;
  const parts = [];
  let current = '';
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
};

const scoreSelector = (selector) => {
  let a = 0;
  let b = 0;
  let c = 0;
  const notes = [];
  let working = selector;

  if (working.indexOf('!important') >= 0) {
    notes.push('!important overrides the whole cascade unless another declaration is also important');
    working = working.replace(/!important/g, '');
  }

  // Functional pseudo-classes carry the specificity of their strongest argument.
  const functional = /:(not|is|has|matches)\(([^()]*)\)/g;
  let match = functional.exec(working);
  while (match) {
    const inner = splitTop(match[2]);
    const innerScores = inner.map((part) => scoreSelector(part));
    const strongest = innerScores.reduce((best, entry) => (entry.score > best.score ? entry : best), { score: 0 });
    a += strongest.a;
    b += strongest.b;
    c += strongest.c;
    notes.push(match[1] + ' takes the specificity of its strongest argument');
    working = working.replace(match[0], ' ');
    match = functional.exec(working);
  }

  working = working.replace(/:where\([^()]*\)/g, ' ');
  if (/:where\(/.test(selector)) notes.push(':where() contributes nothing, which makes it ideal for resets and overrides');

  const ids = (working.match(/#[A-Za-z0-9_-]+/g) || []).length;
  const classes = (working.match(/\.[A-Za-z0-9_-]+/g) || []).length;
  const attributes = (working.match(/\[[^\]]+\]/g) || []).length;
  const pseudoElements = (working.match(/::[A-Za-z-]+/g) || []).length;
  const pseudoClasses = (working.replace(/::[A-Za-z-]+/g, ' ').match(/(?<!:):[A-Za-z-]+/g) || []).length;
  const stripped = working
    .replace(/#[A-Za-z0-9_-]+/g, ' ')
    .replace(/\.[A-Za-z0-9_-]+/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/::[A-Za-z-]+/g, ' ')
    .replace(/(?<!:):[A-Za-z-]+/g, ' ')
    .replace(/[>+~*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const elements = stripped ? stripped.split(' ').filter((token) => /^[A-Za-z][A-Za-z0-9-]*$/.test(token)).length : 0;

  a += ids;
  b += classes + attributes + pseudoClasses;
  c += elements + pseudoElements;

  return {
    a, b, c,
    score: a * 100 + b * 10 + c,
    label: '(' + a + ',' + b + ',' + c + ')',
    notes,
    tokens: { ids, classes, attributes, pseudoClasses, pseudoElements, elements },
  };
};

export default function CSSSpecificity() {
  const [raw, setRaw] = useState(PRESETS.common.join('\n'));
  const [preset, setPreset] = useState('common');
  const [ignoreImportant, setIgnoreImportant] = useState(false);

  const result = useMemo(() => {
    const selectors = String(raw)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => splitTop(line));

    const scored = selectors.map((selector, index) => {
      const detail = scoreSelector(selector);
      return { order: index, selector, ...detail };
    });

    const ranked = [...scored].sort((a, b) => b.score - a.score || a.order - b.order);
    const winner = ranked[0] || null;
    const highest = ranked.filter((entry) => winner && entry.score === winner.score).length;
    const tie = highest > 1;
    const overloaded = scored.filter((entry) => entry.a > 0 || entry.b >= 3);
    const hasImportant = scored.some((entry) => /important/.test(entry.selector) && !ignoreImportant);

    return {
      scored, ranked, winner, tie, overloaded, hasImportant,
      chart: ranked.slice(0, 10).map((entry) => ({ label: entry.selector.slice(0, 14), value: entry.score })),
      depthWarning: scored.filter((entry) => entry.c > 3).length,
    };
  }, [raw, ignoreImportant]);

  const report = useMemo(() => [
    'Specificity ranking for ' + result.scored.length + ' selectors',
    '',
    ...result.ranked.map((entry, index) => (index + 1) + '. (' + entry.a + ',' + entry.b + ',' + entry.c + ') score ' + entry.score + '  ' + entry.selector),
    '',
    result.winner ? 'Winner: ' + result.winner.selector + (result.tie ? ' — tied with another selector, so source order decides' : '') : 'No selectors entered.',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="css-specificity"
      icon={Layers}
      title="CSS Specificity Calculator"
      desc="Paste your selectors and see how the cascade will actually resolve them — the id, class and element counts, the winner, and the ties that source order has to break."
      state={{ raw, preset, ignoreImportant }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.preset) setPreset(restored.preset);
        if (restored.ignoreImportant !== undefined) setIgnoreImportant(!!restored.ignoreImportant);
      }}
      exportText={report}
      exportName="specificity.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setPreset(key); setRaw(PRESETS[key].join('\n')); }}
            className={key === preset
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {key} selectors
          </button>
        ))}
        <Seg value={ignoreImportant ? 'yes' : 'no'} onChange={(value) => setIgnoreImportant(value === 'yes')} options={[{ value: 'no', label: 'Show !important' }, { value: 'yes', label: 'Ignore it' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Selectors, one per line</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.scored.length} parsed</span>
          </div>
          <Area value={raw} onChange={setRaw} rows={14} mono placeholder={'.card\n#sidebar .item'} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Comma-separated lists count as separate selectors and are scored individually, because that is how the browser treats them.
          </p>
        </Panel>
        <div className="space-y-3">
          <Hero
            label="Winning selector"
            value={result.winner ? '(' + result.winner.a + ',' + result.winner.b + ',' + result.winner.c + ')' : '—'}
            sub={result.winner
              ? result.winner.selector + ' scores ' + result.winner.score + '.' + (result.tie ? ' Another selector scores identically, so whichever comes later in the stylesheet wins.' : ' Nothing else here outranks it, so its declarations apply.')
              : 'Enter some selectors to compare.'}
          />
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">How specificity is counted</div>
            <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
              <p>a — ids</p>
              <p>b — classes, attributes, and pseudo-classes</p>
              <p>c — element names and pseudo-elements</p>
              <p>the universal selector and :where() count as nothing</p>
              <p className="text-cyan-j">Compared left to right: any id beats any number of classes.</p>
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Ranked by specificity</span>
          <CopyBtn value={report} label="Copy the analysis" />
        </div>
        <div className="space-y-1.5">
          {result.ranked.map((entry, index) => (
            <div key={entry.selector + entry.order} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={'rounded border px-1.5 py-0.5 font-mono-j text-[10px] ' + (index === 0 ? 'border-cyan-j/50 text-cyan-j' : 'border-border/60 text-muted-foreground')}>
                  ({entry.a},{entry.b},{entry.c})
                </span>
                <span className="font-mono-j text-[11px]">{entry.selector}</span>
                <span className="ml-auto font-mono-j text-[11px] text-cyan-j">{entry.score}</span>
              </div>
              <div className="mt-0.5 font-mono-j text-[10px] text-muted-foreground">
                {entry.tokens.ids} id · {entry.tokens.classes} class · {entry.tokens.attributes} attribute · {entry.tokens.pseudoClasses} pseudo-class · {entry.tokens.elements} element · {entry.tokens.pseudoElements} pseudo-element
              </div>
              {entry.notes.length > 0 && (
                <div className="mt-0.5 space-y-0.5 text-[10px] text-amber-200">
                  {entry.notes.map((note) => <p key={note}>· {note}</p>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Scores at a glance</div>
          <Bars data={result.chart} format={(value) => String(value)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The score is a readable shorthand — a hundred per id, ten per class, one per element — not the real comparison, which is strictly lexicographic. It still shows the
            shape of the problem: one selector far above the rest will be hard to override later.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Warnings</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.overloaded.length > 0
              ? <p>· {result.overloaded.length} selector{result.overloaded.length === 1 ? '' : 's'} rely on ids or three or more classes. Overriding them later means writing something even heavier.</p>
              : <p>· Nothing here leans on ids, which keeps every rule replaceable without escalating the selector.</p>}
            {result.depthWarning > 0 && <p>· {result.depthWarning} selector{result.depthWarning === 1 ? '' : 's'} chain more than three elements deep, which couples the CSS to the exact HTML structure.</p>}
            {result.tie ? <p>· There is a tie at the top. The browser falls back to source order, so moving the rules around silently changes which one applies.</p> : <p>· There is a single clear winner, so no tie-break by source order is needed.</p>}
            {result.hasImportant ? <p>· At least one selector carries !important, which removes the usefulness of everything on this page. Treat it as a temporary escape hatch rather than a tool.</p> : <p>· No !important in sight. That is the healthy state: the cascade is doing its job without being overruled.</p>}
            <p>· Inline styles outrank every selector here, and shadow DOM has its own separate cascade entirely.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Selectors" value={String(result.scored.length)} mono />
        <Stat label="Top score" value={result.winner ? String(result.winner.score) : '—'} mono sub={result.winner ? result.winner.label : ''} />
        <Stat label="With ids" value={String(result.scored.filter((entry) => entry.a > 0).length)} mono sub="hard to override" />
        <Stat label="Tie at the top" value={result.tie ? 'yes' : 'no'} mono sub={result.tie ? 'source order decides' : 'clear winner'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Keeping specificity boring</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Aim for one class per rule. When two rules match, whoever wrote the lower specificity wins the argument about maintainability.</p>
            <p>· Never style by id. An id rule can only be beaten by another id rule, which is how stylesheets become a chain of escalating selectors.</p>
            <p>· Keep selector chains to two levels at most. Deep chains break the moment the markup changes, which it will.</p>
            <p>· Order matters as much as weight. Put base rules first, components next and overrides last, so the cascade is doing the work instead of the selectors.</p>
            <p>· BEM and utility frameworks work precisely because they keep everything at the same low specificity, which makes source order the only variable.</p>
            <p>· If a rule needs !important to apply, the real problem is somewhere above it in the file.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Modern tools for the exact problem</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Cascade layers let you state an order of intent rather than fight with weights: put your reset in the first layer and your components in the next.</p>
            <p>· :where() has zero specificity, so it is perfect for defaults that must be easy to override.</p>
            <p>· :is() takes the specificity of its strongest argument, which is often higher than people expect.</p>
            <p>· :not() also takes the specificity of its argument, so :not(#main) is not a cheap way to exclude something.</p>
            <p>· Shadow DOM resets the game: styles inside a component cannot leak out and outside styles cannot easily get in.</p>
            <p>· Devtools shows the computed specificity and the winning declaration, which is the fastest way to confirm a suspicion from this page.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Winner', value: result.winner ? result.winner.label : '—' },
                { label: 'Selectors', value: String(result.scored.length) },
                { label: 'Ties', value: result.tie ? 'yes' : 'no' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The rules in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>count ids (a), then classes, attributes and pseudo-classes (b), then elements and pseudo-elements (c)</p>
          <p>compare a first, then b, then c — a single id beats any number of classes</p>
          <p>:where() and the universal selector contribute nothing</p>
          <p>:is(), :not() and :has() contribute the specificity of their strongest argument</p>
          <p>inline styles beat everything in the stylesheet, and !important beats inline unless it is also important</p>
          <p className="text-cyan-j">Equal specificity is resolved by source order: the later rule wins.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This counts the weight of selectors only. Which declaration actually applies still depends on source order, cascade layers, inheritance and whether either value is marked
          important, so treat the ranking as the first question rather than the whole answer.
        </p>
      </Panel>
    </ToolShell>
  );
}