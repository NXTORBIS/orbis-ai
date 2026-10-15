import { useMemo, useState } from 'react';
import { Contrast, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const toRgb = (hex) => {
  const clean = String(hex).replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((character) => character + character).join('') : clean.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
};

const toHex = ({ r, g, b }) => '#' + [r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');

const luminance = (hex) => {
  const { r, g, b } = toRgb(hex);
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const ratio = (first, second) => {
  const a = luminance(first);
  const b = luminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

const mix = (hex, target, amount) => {
  const from = toRgb(hex);
  const to = toRgb(target);
  return toHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
};

const suggest = (foreground, background, target) => {
  if (ratio(foreground, background) >= target) return null;
  const direction = luminance(background) < 0.5 ? '#ffffff' : '#000000';
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(foreground, direction, step / 100);
    if (ratio(candidate, background) >= target) return candidate;
  }
  return direction;
};

const GRADE = (value) => {
  if (value >= 7) return { label: 'AAA', tone: 'emerald' };
  if (value >= 4.5) return { label: 'AA', tone: 'emerald' };
  if (value >= 3) return { label: 'AA large', tone: 'amber' };
  return { label: 'Fail', tone: 'rose' };
};

export default function ThemeContrastAuditor() {
  const [background, setBackground] = useState('#0f172a');
  const [surface, setSurface] = useState('#1e293b');
  const [target, setTarget] = useState('4.5');
  const [colors, setColors] = useState([
    { id: 'a', name: 'Body text', hex: '#f8fafc' },
    { id: 'b', name: 'Muted text', hex: '#94a3b8' },
    { id: 'c', name: 'Primary', hex: '#22d3ee' },
    { id: 'd', name: 'Success', hex: '#34d399' },
    { id: 'e', name: 'Warning', hex: '#fbbf24' },
    { id: 'f', name: 'Link', hex: '#60a5fa' },
  ]);

  const set = (id, key, value) => setColors((current) => current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));

  const result = useMemo(() => {
    const goal = Number(target) || 4.5;
    const rows = colors.map((entry) => {
      const onBackground = ratio(entry.hex, background);
      const onSurface = ratio(entry.hex, surface);
      const onBackgroundGrade = GRADE(onBackground);
      const onSurfaceGrade = GRADE(onSurface);
      const fix = suggest(entry.hex, background, goal);
      return {
        ...entry,
        onBackground, onSurface, onBackgroundGrade, onSurfaceGrade,
        fix,
        fixRatio: fix ? ratio(fix, background) : onBackground,
        uiOk: onBackground >= 3,
      };
    });

    const passing = rows.filter((row) => row.onBackground >= goal).length;
    const worst = [...rows].sort((a, b) => a.onBackground - b.onBackground)[0];
    const best = [...rows].sort((a, b) => b.onBackground - a.onBackground)[0];
    const failing = rows.filter((row) => row.onBackground < goal);
    const uiFailing = rows.filter((row) => !row.uiOk);
    const surfaceGap = surface.toLowerCase() !== background.toLowerCase();

    return { rows, passing, worst, best, failing, uiFailing, goal, surfaceGap };
  }, [colors, background, surface, target]);

  const report = useMemo(() => [
    'Background ' + background + ' · surface ' + surface,
    'Target ratio ' + result.goal + ':1 · ' + result.passing + ' of ' + result.rows.length + ' colours pass on the background',
    '',
    ...result.rows.map((row) => [
      row.name,
      row.hex,
      'on background ' + row.onBackground.toFixed(2) + ':1 (' + row.onBackgroundGrade.label + ')',
      'on surface ' + row.onSurface.toFixed(2) + ':1 (' + row.onSurfaceGrade.label + ')',
      row.fix ? 'suggested ' + row.fix : 'already passes',
    ].join(' · ')),
    '',
    result.failing.length
      ? 'Failing on the background: ' + result.failing.map((row) => row.name).join(', ')
      : 'Every colour passes the target against the background.',
  ].join('\n'), [result, background, surface]);

  return (
    <ToolShell
      toolId="contrast-auditor"
      icon={Contrast}
      title="Theme Contrast Auditor"
      desc="Check a whole palette at once against your background and surface, with WCAG grades, the UI threshold for non-text elements, and a suggested fix for every colour that fails."
      state={{ background, surface, target, colors }}
      onRestore={(restored) => {
        if (typeof restored.background === 'string') setBackground(restored.background);
        if (typeof restored.surface === 'string') setSurface(restored.surface);
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (Array.isArray(restored.colors) && restored.colors.length) setColors(restored.colors);
      }}
      exportText={report}
      exportName="contrast-audit.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Page background">
          <div className="flex gap-2">
            <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
            <input value={background} onChange={(e) => setBackground(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
          </div>
        </Field>
        <Field label="Surface or card background">
          <div className="flex gap-2">
            <input type="color" value={surface} onChange={(e) => setSurface(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
            <input value={surface} onChange={(e) => setSurface(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
          </div>
        </Field>
        <Field label="Target ratio">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="4.5">4.5:1 — AA body text</option>
            <option value="3">3:1 — AA large text and UI</option>
            <option value="7">7:1 — AAA body text</option>
            <option value="4.5">4.5:1 the usual floor</option>
          </select>
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Palette</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.passing} of {result.rows.length} pass at {result.goal}:1</span>
        </div>
        <div className="space-y-2">
          {colors.map((entry) => (
            <div key={entry.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <Field label="Name"><input value={entry.name} onChange={(e) => set(entry.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Value"><input value={entry.hex} onChange={(e) => set(entry.id, 'hex', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Pick"><input type="color" value={entry.hex} onChange={(e) => set(entry.id, 'hex', e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" /></Field>
              <div className="flex items-end gap-2">
                <span className="font-mono-j text-[11px] text-muted-foreground">on bg {ratio(entry.hex, background).toFixed(2)}:1</span>
                <button type="button" onClick={() => setColors((current) => current.filter((item) => item.id !== entry.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setColors((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'colour ' + (current.length + 1), hex: '#888888' }])}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a colour
        </button>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.failing.length ? 'rose' : 'emerald'}
          label={result.failing.length ? 'Colours failing on the background' : 'Every colour passes'}
          value={String(result.failing.length)}
          sub={result.failing.length
            ? 'Failing: ' + result.failing.map((row) => row.name).join(', ') + '. The suggested values below reach ' + result.goal + ':1 while staying as close to the original as possible.'
            : 'The weakest is ' + result.worst.name + ' at ' + result.worst.onBackground.toFixed(2) + ':1 and the strongest is ' + result.best.name + ' at ' + result.best.onBackground.toFixed(2) + ':1.'}
        />
        <Ring
          value={result.rows.length ? (result.passing / result.rows.length) * 100 : 0}
          max={100}
          tone={result.failing.length ? 'amber' : 'emerald'}
          label="Palette passing"
          sub={result.passing + ' of ' + result.rows.length + ' colours meet ' + result.goal + ':1 against ' + background}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Ratios and suggested fixes</span>
          <CopyBtn value={report} label="Copy the audit" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Colour</th>
                <th className="py-1 text-left font-medium">Sample</th>
                <th className="py-1 text-right font-medium">On background</th>
                <th className="py-1 text-right font-medium">On surface</th>
                <th className="py-1 text-right font-medium">UI 3:1</th>
                <th className="py-1 text-right font-medium">Suggested</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-border/50">
                  <td className="py-1.5">{row.name}<div className="text-[9px] text-muted-foreground">{row.hex}</div></td>
                  <td className="py-1.5">
                    <div className="rounded px-2 py-1" style={{ backgroundColor: background, color: row.hex }}>Aa</div>
                  </td>
                  <td className={'py-1.5 text-right ' + (row.onBackground >= result.goal ? 'text-emerald-300' : 'text-rose-300')}>
                    {row.onBackground.toFixed(2)}:1
                    <div className="text-[9px] text-muted-foreground">{row.onBackgroundGrade.label}</div>
                  </td>
                  <td className="py-1.5 text-right">
                    {row.onSurface.toFixed(2)}:1
                    <div className="text-[9px] text-muted-foreground">{row.onSurfaceGrade.label}</div>
                  </td>
                  <td className={'py-1.5 text-right ' + (row.uiOk ? 'text-emerald-300' : 'text-rose-300')}>{row.uiOk ? 'pass' : 'fail'}</td>
                  <td className="py-1.5 text-right">
                    {row.fix ? <span className="text-cyan-j">{row.fix}</span> : <span className="text-muted-foreground">ok</span>}
                    {row.fix && <div className="text-[9px] text-muted-foreground">{row.fixRatio.toFixed(2)}:1</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.surfaceGap && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            The surface is a different colour from the background, so both columns matter. Text sitting on a card is governed by the surface column, and a colour that passes
            on one can fail on the other.
          </p>
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How the ratio works</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Each colour is converted to relative luminance, weighted for how the eye responds to red, green and blue. The ratio is (lighter + 0.05) ÷ (darker + 0.05).</p>
            <p>· The range runs from 1:1 for identical colours to 21:1 for black on white. Higher is not always better: 21:1 body text is harsh for long reading.</p>
            <p>· 4.5:1 is the AA threshold for normal text. 3:1 applies to text 18.66px bold or 24px regular and above, and to icons, borders and focus rings.</p>
            <p>· 7:1 is AAA for body text. Aim for 4.5 to 10 for comfortable long-form reading.</p>
            <p>· Your weakest colour, {result.worst.name}, sits at {result.worst.onBackground.toFixed(2)}:1 — {result.worst.onBackground >= 4.5 ? 'above the AA floor, which is fine for body text but check it for anything small.' : 'below the AA floor, so it needs a fix before it carries body text.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Fixing a palette without wrecking it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Move lightness, not hue. A slightly darker or lighter version of the same colour keeps the brand and fixes the maths.</p>
            <p>· Dark themes fail on saturation more than lightness. A bright cyan that looks great at 3:1 becomes hard to read at scale.</p>
            <p>· Every muted or secondary text colour is a candidate to become a different token rather than a tint of the body colour.</p>
            <p>· Check the states too: hover, disabled and placeholder text are where contrast usually collapses in practice.</p>
            <p>· {result.uiFailing.length ? result.uiFailing.length + ' colours fall below 3:1, which is the threshold for icons, borders and controls — that is a usability problem, not just a compliance one.' : 'Everything clears the 3:1 threshold, so icons, borders and controls can use these colours safely.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Passing', value: result.passing + '/' + result.rows.length },
                { label: 'Target', value: result.goal + ':1' },
                { label: 'Weakest', value: result.worst.onBackground.toFixed(2) + ':1' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Passing" value={result.passing + '/' + result.rows.length} mono sub={'at ' + result.goal + ':1'} />
        <Stat label="Failing" value={String(result.failing.length)} mono />
        <Stat label="Weakest" value={result.worst.onBackground.toFixed(2) + ':1'} mono sub={result.worst.name} />
        <Stat label="Best" value={result.best.onBackground.toFixed(2) + ':1'} mono sub={result.best.name} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Contrast is calculated from relative luminance exactly as the WCAG definition specifies, with no gamma shortcuts, so the ratios match what an audit tool would
          report. Suggested values are found by walking the colour towards white or black in one percent steps and stopping at the first value that reaches the target.
        </p>
      </Panel>
    </ToolShell>
  );
}