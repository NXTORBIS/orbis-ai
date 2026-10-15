import { useMemo, useState } from 'react';
import { Type } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const RATIOS = [
  { value: '1.125', label: '1.125 · major second', note: 'Subtle. Safe for dense interfaces with many levels of hierarchy.' },
  { value: '1.2', label: '1.2 · minor third', note: 'A common default for product interfaces. Restrained but clearly stepped.' },
  { value: '1.25', label: '1.25 · major third', note: 'The most widely used scale. Distinct levels without shouting.' },
  { value: '1.333', label: '1.333 · perfect fourth', note: 'Editorial and confident. Works best with fewer sizes.' },
  { value: '1.5', label: '1.5 · perfect fifth', note: 'Marketing pages and hero headings. Too loud for a dense dashboard.' },
  { value: '1.618', label: '1.618 · golden ratio', note: 'Dramatic jumps. Usually needs the intermediate steps dropped.' },
];

const USAGE = ['Display', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Lead', 'Body', 'Small', 'Caption', 'Micro'];

export default function TypeScale() {
  const [base, setBase] = useState('16');
  const [ratio, setRatio] = useState('1.25');
  const [up, setUp] = useState('4');
  const [down, setDown] = useState('2');
  const [headingFont, setHeadingFont] = useState('serif');
  const [bodyFont, setBodyFont] = useState('sans');
  const [preview, setPreview] = useState(true);
  const [rem, setRem] = useState(true);

  const result = useMemo(() => {
    const baseSize = Math.max(10, Number(base) || 16);
    const multiplier = Number(ratio) || 1.25;
    const upSteps = Math.max(1, Math.min(6, Number(up) || 4));
    const downSteps = Math.max(0, Math.min(3, Number(down) || 2));

    const steps = [];
    for (let index = upSteps; index >= -downSteps; index -= 1) {
      const size = baseSize * Math.pow(multiplier, index);
      const lineHeight = Math.max(1.05, Math.min(1.75, 1.72 - (size - baseSize) / 46));
      const tracking = size >= 44 ? -0.03 : size >= 32 ? -0.02 : size >= 24 ? -0.01 : size >= 18 ? 0 : 0.01;
      steps.push({
        step: index,
        size: Number(size.toFixed(2)),
        rem: Number((size / 16).toFixed(4)),
        lineHeight: Number(lineHeight.toFixed(2)),
        tracking,
        usage: index === upSteps ? USAGE[0] : USAGE[Math.min(USAGE.length - 1, upSteps - index + 5)] || 'Body',
        weight: size >= 32 ? 700 : size >= 22 ? 600 : 400,
      });
    }

    const css = [
      ':root {',
      '  --font-heading: ' + (headingFont === 'serif' ? 'Georgia, "Times New Roman", serif' : headingFont === 'mono' ? 'ui-monospace, SFMono-Regular, monospace' : 'system-ui, -apple-system, "Segoe UI", sans-serif') + ';',
      '  --font-body: ' + (bodyFont === 'serif' ? 'Georgia, "Times New Roman", serif' : bodyFont === 'mono' ? 'ui-monospace, SFMono-Regular, monospace' : 'system-ui, -apple-system, "Segoe UI", sans-serif') + ';',
      '',
      ...steps.map((entry) => '  --text-' + (entry.step === 0 ? 'base' : entry.step > 0 ? 'up-' + entry.step : 'down-' + Math.abs(entry.step)) + ': ' + entry.rem.toFixed(3) + 'rem;'),
      '}',
      '',
      ...steps.map((entry) => [
        '.text-' + (entry.step === 0 ? 'base' : entry.step > 0 ? 'up-' + entry.step : 'down-' + Math.abs(entry.step)) + ' {',
        '  font-size: var(--text-' + (entry.step === 0 ? 'base' : entry.step > 0 ? 'up-' + entry.step : 'down-' + Math.abs(entry.step)) + ');',
        '  line-height: ' + entry.lineHeight + ';',
        '  letter-spacing: ' + entry.tracking + 'em;',
        '}',
      ].join('\n')),
    ].join('\n');

    const tailwind = steps.map((entry) => "      '" + (entry.step === 0 ? 'base' : entry.step > 0 ? 'up-' + entry.step : 'down-' + Math.abs(entry.step)) + "': '" + entry.rem.toFixed(3) + "rem',").join('\n');

    return {
      steps, css, tailwind, baseSize, multiplier, upSteps, downSteps,
      bodyStep: steps.find((entry) => entry.step === 0),
      biggest: steps[0],
      smallest: steps[steps.length - 1],
      spread: steps[0] && steps[steps.length - 1] ? steps[0].size / steps[steps.length - 1].size : 1,
      chart: steps.map((entry) => ({ label: entry.step > 0 ? 'up ' + entry.step : entry.step === 0 ? 'base' : 'down ' + Math.abs(entry.step), value: Number(entry.size.toFixed(1)) })),
      note: (RATIOS.find((entry) => entry.value === ratio) || RATIOS[2]).note,
      bodyTooSmall: baseSize < 15,
      tooManySteps: steps.length > 8,
    };
  }, [base, ratio, up, down, headingFont, bodyFont]);

  const report = useMemo(() => [
    'Type scale at a ratio of ' + result.multiplier + ' from a base of ' + result.baseSize + 'px',
    '',
    ...result.steps.map((entry) => [
      (entry.step > 0 ? '+' + entry.step : entry.step === 0 ? ' base' : ' ' + entry.step).padStart(5, ' '),
      entry.rem.toFixed(3) + 'rem',
      entry.size.toFixed(1) + 'px',
      'line-height ' + entry.lineHeight,
      'tracking ' + entry.tracking + 'em',
    ].join('  ')),
    '',
    result.css,
  ].join('\n'), [result]);

  const fontFamily = (kind) => (kind === 'serif' ? 'Georgia, "Times New Roman", serif' : kind === 'mono' ? 'ui-monospace, SFMono-Regular, monospace' : 'system-ui, -apple-system, "Segoe UI", sans-serif');

  return (
    <ToolShell
      toolId="type-scale"
      icon={Type}
      title="Modular Type Scale Studio"
      desc="Build a type ramp from a base size and a ratio, with line heights and letter spacing that follow the size, a live preview at real size and the CSS or Tailwind tokens to copy."
      state={{ base, ratio, up, down, headingFont, bodyFont, preview, rem }}
      onRestore={(restored) => {
        if (restored.base !== undefined) setBase(String(restored.base));
        if (restored.ratio) setRatio(restored.ratio);
        if (restored.up !== undefined) setUp(String(restored.up));
        if (restored.down !== undefined) setDown(String(restored.down));
        if (restored.headingFont) setHeadingFont(restored.headingFont);
        if (restored.bodyFont) setBodyFont(restored.bodyFont);
        if (restored.preview !== undefined) setPreview(!!restored.preview);
        if (restored.rem !== undefined) setRem(!!restored.rem);
      }}
      exportText={report}
      exportName="type-scale.css"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Base size, px"><input value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Steps above the base"><input value={up} onChange={(e) => setUp(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Steps below the base"><input value={down} onChange={(e) => setDown(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Units">
          <Seg value={rem ? 'rem' : 'px'} onChange={(value) => setRem(value === 'rem')} options={[{ value: 'rem', label: 'rem' }, { value: 'px', label: 'px' }]} />
        </Field>
      </div>

      <Field label="Scale ratio">
        <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm">
          {RATIOS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
      </Field>
      <p className="text-[11px] text-muted-foreground">{result.note}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Heading typeface">
          <Seg value={headingFont} onChange={setHeadingFont} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'mono', label: 'Mono' }]} />
        </Field>
        <Field label="Body typeface">
          <Seg value={bodyFont} onChange={setBodyFont} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'mono', label: 'Mono' }]} />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Show the live preview" checked={preview} onChange={() => setPreview((current) => !current)} />
        <ToggleRow label="Report sizes in rem" checked={rem} onChange={() => setRem((current) => !current)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Scale spread"
          value={result.spread.toFixed(1)}
          unit="×"
          sub={'From ' + result.smallest.size.toFixed(1) + 'px at the bottom to ' + result.biggest.size.toFixed(1) + 'px at the top, across ' + result.steps.length + ' levels at a ratio of ' + result.multiplier + '. The body sits at ' + result.baseSize + 'px.'}
        />
        <Ring
          value={result.steps.length}
          max={10}
          tone={result.tooManySteps ? 'amber' : 'emerald'}
          label="Levels in the ramp"
          sub={result.tooManySteps ? 'More than eight sizes is hard to use consistently' : 'A workable number of distinct sizes'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The ramp</span>
          <CopyBtn value={result.css} label="Copy the CSS" />
        </div>
        <div className="space-y-1.5">
          {result.steps.map((entry) => (
            <div key={entry.step} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono-j text-[11px]">
                <span className="w-14 text-muted-foreground">{entry.step > 0 ? 'up ' + entry.step : entry.step === 0 ? 'base' : 'down ' + Math.abs(entry.step)}</span>
                <span className="w-16 text-cyan-j">{entry.size.toFixed(1)}px</span>
                <span className="w-20 text-muted-foreground">{entry.rem.toFixed(3)}rem</span>
                <span className="w-24 text-muted-foreground">lh {entry.lineHeight}</span>
                <span className="w-24 text-muted-foreground">track {entry.tracking}em</span>
                <span className="text-muted-foreground">weight {entry.weight} · {entry.usage}</span>
              </div>
              {preview && (
                <p
                  className="mt-1 truncate"
                  style={{
                    fontSize: entry.size + 'px',
                    lineHeight: entry.lineHeight,
                    letterSpacing: entry.tracking + 'em',
                    fontWeight: entry.weight,
                    fontFamily: fontFamily(entry.size >= 20 ? headingFont : bodyFont),
                  }}
                >
                  The quick brown fox jumps over the lazy dog
                </p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizes across the ramp</div>
          <Bars data={result.chart} format={(value) => value.toFixed(0)} suffix=" px" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A geometric scale grows by a fixed multiplier, so the jump between levels is proportionally the same everywhere. That is what makes a well-chosen ratio look
            deliberate rather than arbitrary.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Line height and tracking follow the size</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Line height falls as type grows. Body text at {result.bodyStep ? result.bodyStep.lineHeight : 1.5} stays relaxed, headings tighten up to avoid gaps.</p>
            <p>· Letter spacing is negative at display sizes, because large type looks loose at normal tracking, and slightly positive for small caps and micro text.</p>
            <p>· Weight climbs at the top of the ramp. Big headings can carry 700 without feeling heavy; body text at 700 feels like shouting.</p>
            <p>· Long-line body text needs more line height than short measure text at the same size.</p>
            <p>· Never set line height in pixels. It should scale with the type, or every size needs its own override.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Base" value={result.baseSize + 'px'} mono sub={result.bodyStep ? result.bodyStep.rem.toFixed(3) + 'rem' : ''} />
        <Stat label="Smallest" value={result.smallest.size.toFixed(1) + 'px'} mono sub={'step ' + result.smallest.step} />
        <Stat label="Largest" value={result.biggest.size.toFixed(1) + 'px'} mono sub={'step ' + result.biggest.step} />
        <Stat label="Ratio" value={String(result.multiplier)} mono sub={'×' + result.multiplier + ' per step'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS variables and classes</span>
          <CopyBtn value={result.css} label="Copy" />
        </div>
        <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[10px] leading-relaxed">{result.css}</pre>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Tailwind theme extension</span>
          <CopyBtn value={"fontSize: {\n" + result.tailwind + "\n}"} label="Copy" />
        </div>
        <pre className="overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[10px]">{'fontSize: {\n' + result.tailwind + '\n}'}</pre>
      </Panel>

      {result.bodyTooSmall && (
        <Panel className="!p-3 !border-amber-400/50">
          <p className="text-[11px] text-amber-200">
            The base size is below 15 pixels. Body text that small is uncomfortable on a phone and is the most common accessibility complaint in interface design. Sixteen
            pixels is the safe default for body copy.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing a ratio</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Dense interfaces, dashboards and documentation suit 1.125 to 1.2. The steps are small enough that nothing dominates the viewport.</p>
            <p>· Most product sites and marketing pages sit comfortably at 1.25, which is why it has become the default in so many design systems.</p>
            <p>· 1.333 and above belong to editorial layouts and landing pages where one headline is meant to carry the page.</p>
            <p>· Larger ratios need fewer steps. Six levels at 1.5 produces a colossal top size that only works on a poster.</p>
            <p>· Consistency beats cleverness. Pick one ratio and use it everywhere, rather than hand-tuning each heading.</p>
            <p>· {result.tooManySteps ? 'This ramp has ' + result.steps.length + ' levels. Consider dropping one or two — most interfaces need six or fewer distinct sizes.' : 'The ' + result.steps.length + ' levels here are within the range a team can actually use consistently.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Making a scale work in practice</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Use rem, not pixels, for sizes. A user who has raised their browser default font size deserves a page that responds.</p>
            <p>· Set the base at 16px. A smaller base shrinks everything proportionally and quietly fails accessibility checks.</p>
            <p>· Body copy between 60 and 75 characters per line reads best. Type size and container width have to be chosen together.</p>
            <p>· Keep heading and body typefaces to two at most, and give them clearly different roles. The scale supplies the hierarchy; the fonts should not compete with it.</p>
            <p>· Test the scale with real content and real headings, in the languages you support. A scale that holds in English can break in German compound words.</p>
            <p>· Fluid sizing with clamp between the smallest and largest step saves a breakpoint without abandoning the scale.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Base', value: result.baseSize + 'px' },
                { label: 'Ratio', value: String(result.multiplier) },
                { label: 'Levels', value: String(result.steps.length) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>size at step n = base × ratioⁿ, with positive n above the base and negative n below</p>
          <p>line height = 1.72 − (size − base) ÷ 46, clamped between 1.05 and 1.75</p>
          <p>letter spacing: −0.03em at 44px and above, −0.02em at 32, −0.01em at 24, +0.01em below 18</p>
          <p className="text-cyan-j">Check: {result.baseSize} × {result.multiplier}⁴ = {(result.baseSize * Math.pow(result.multiplier, 4)).toFixed(1)}px at the top step.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The line heights and tracking are rules of thumb that keep a generated ramp usable, not typographic law. The preview shows the sizes honestly, though the fonts used are
          system faces rather than whichever ones your project actually loads.
        </p>
      </Panel>
    </ToolShell>
  );
}