import { useEffect, useMemo, useState } from 'react';
import { Type } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const FAMILIES = [
  { name: 'Inter', category: 'Neutral sans' },
  { name: 'Manrope', category: 'Geometric sans' },
  { name: 'Work Sans', category: 'Neutral sans' },
  { name: 'DM Sans', category: 'Geometric sans' },
  { name: 'Space Grotesk', category: 'Technical sans' },
  { name: 'IBM Plex Sans', category: 'Technical sans' },
  { name: 'JetBrains Mono', category: 'Monospace' },
  { name: 'Poppins', category: 'Geometric sans' },
  { name: 'Montserrat', category: 'Display sans' },
  { name: 'Roboto', category: 'Neutral sans' },
  { name: 'Nunito', category: 'Friendly sans' },
  { name: 'Lora', category: 'Serif' },
  { name: 'Merriweather', category: 'Serif' },
  { name: 'Playfair Display', category: 'High-contrast serif' },
  { name: 'Cormorant Garamond', category: 'Elegant serif' },
  { name: 'Bebas Neue', category: 'Condensed display' },
  { name: 'Archivo', category: 'Neutral sans' },
  { name: 'Source Serif 4', category: 'Serif' },
];

const SERIFS = ['Lora', 'Merriweather', 'Playfair Display', 'Cormorant Garamond', 'Source Serif 4'];

const PRESETS = [
  { label: 'Editorial', heading: 'Playfair Display', body: 'Source Serif 4' },
  { label: 'Modern product', heading: 'Space Grotesk', body: 'Inter' },
  { label: 'Friendly app', heading: 'Poppins', body: 'Nunito' },
  { label: 'Technical', heading: 'IBM Plex Sans', body: 'JetBrains Mono' },
  { label: 'Quiet luxury', heading: 'Cormorant Garamond', body: 'Manrope' },
  { label: 'Loud poster', heading: 'Bebas Neue', body: 'Work Sans' },
];

const SAMPLE = 'Every detail is a decision';

const SUBTEXT = 'Design is not decoration — it is the sum of a hundred small choices made deliberately.';

const BODY_TEXT = "Typography carries more of a product's character than any colour or illustration. A pairing works when the two faces disagree in exactly one dimension: weight, width or warmth.";

const stackFor = (family) => {
  if (family.includes('Mono')) return 'ui-monospace, monospace';
  if (SERIFS.includes(family)) return 'serif';
  return 'sans-serif';
};

export default function FontPairing() {
  const [heading, setHeading] = useState('Space Grotesk');
  const [body, setBody] = useState('Inter');
  const [headingSize, setHeadingSize] = useState('44');
  const [bodySize, setBodySize] = useState('16');
  const [tracking, setTracking] = useState('0');
  const [lineHeight, setLineHeight] = useState('1.6');
  const [sample, setSample] = useState(SAMPLE);

  useEffect(() => {
    const families = [
      'family=' + heading.split(' ').join('+') + ':wght@400;600;700',
      'family=' + body.split(' ').join('+') + ':wght@400;500;700',
    ].join('&');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + families + '&display=swap';
    document.head.appendChild(link);
    return () => {
      if (link.parentNode) link.parentNode.removeChild(link);
    };
  }, [heading, body]);

  const headingPx = Number(headingSize) || 44;
  const bodyPx = Number(bodySize) || 16;
  const lineHeightNum = Number(lineHeight) || 1.6;

  const headingStyle = {
    fontFamily: '"' + heading + '", ' + stackFor(heading),
    fontSize: headingPx + 'px',
    letterSpacing: tracking + 'em',
    lineHeight: 1.1,
  };
  const subStyle = {
    fontFamily: '"' + body + '", ' + stackFor(body),
    fontSize: (bodyPx + 2) + 'px',
  };
  const bodyStyle = {
    fontFamily: '"' + body + '", ' + stackFor(body),
    fontSize: bodyPx + 'px',
    lineHeight: lineHeightNum,
  };
  const buttonStyle = {
    fontFamily: '"' + body + '", ' + stackFor(body),
    fontSize: (bodyPx - 1) + 'px',
  };
  const numeralStyle = {
    fontFamily: '"' + heading + '", ' + stackFor(heading),
    fontSize: (bodyPx + 4) + 'px',
  };

  const importUrl = 'https://fonts.googleapis.com/css2?family=' + heading.split(' ').join('+') + ':wght@400;600;700&family=' + body.split(' ').join('+') + ':wght@400;500;700&display=swap';

  const css = [
    "@import url('" + importUrl + "');",
    '',
    ':root {',
    "  --font-heading: '" + heading + "', " + stackFor(heading) + ';',
    "  --font-body: '" + body + "', " + stackFor(body) + ';',
    '}',
    '',
    'h1 {',
    '  font-family: var(--font-heading);',
    '  font-size: ' + headingPx + 'px;',
    '  letter-spacing: ' + tracking + 'em;',
    '  line-height: 1.1;',
    '}',
    '',
    'p {',
    '  font-family: var(--font-body);',
    '  font-size: ' + bodyPx + 'px;',
    '  line-height: ' + lineHeightNum + ';',
    '}',
  ].join('\n');

  const contrast = useMemo(() => {
    const headingFamily = FAMILIES.find((family) => family.name === heading);
    const bodyFamily = FAMILIES.find((family) => family.name === body);
    const headingCat = headingFamily ? headingFamily.category : '';
    const bodyCat = bodyFamily ? bodyFamily.category : '';
    const sameCategory = headingCat === bodyCat;
    const bothDisplay = /Display|Condensed/.test(headingCat) && /Display|Condensed/.test(bodyCat);
    if (bothDisplay) return { verdict: 'Fighting', tone: 'rose', note: 'Two display faces compete for the same role — let one of them be quiet.' };
    if (sameCategory && !headingCat.includes('Neutral')) return { verdict: 'Subtle', tone: 'amber', note: 'Very similar faces: elegant, but hierarchy has to come from weight and size.' };
    if (sameCategory) return { verdict: 'Safe', tone: 'emerald', note: 'One family class at different weights is the most reliable pairing there is.' };
    return { verdict: 'Contrast', tone: 'emerald', note: 'Different classes — the heading sets the character and the body stays out of the way.' };
  }, [heading, body]);

  const ratio = headingPx / Math.max(1, bodyPx);

  const report = [
    'Heading: ' + heading + ' · Body: ' + body,
    contrast.verdict + ' — ' + contrast.note,
    'Heading ' + headingPx + 'px, tracking ' + tracking + 'em · body ' + bodyPx + 'px at ' + lineHeightNum + ' line height',
    'Size ratio ' + ratio.toFixed(2) + '× (2.5–3× is a classic hierarchy)',
    '',
    css,
  ].join('\n');

  return (
    <ToolShell
      toolId="font-pair"
      icon={Type}
      title="Font Pairing Studio"
      desc="Try a heading face against a body face, see them rendered together at real sizes, and take the CSS with you."
      state={{ heading, body, headingSize, bodySize, tracking, lineHeight, sample }}
      onRestore={(restored) => {
        if (restored.heading) setHeading(restored.heading);
        if (restored.body) setBody(restored.body);
        if (restored.headingSize !== undefined) setHeadingSize(String(restored.headingSize));
        if (restored.bodySize !== undefined) setBodySize(String(restored.bodySize));
        if (restored.tracking !== undefined) setTracking(String(restored.tracking));
        if (restored.lineHeight !== undefined) setLineHeight(String(restored.lineHeight));
        if (typeof restored.sample === 'string') setSample(restored.sample);
      }}
      exportText={report}
      exportName="font-pairing.css"
    >
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => { setHeading(preset.heading); setBody(preset.body); }}
            className={
              heading === preset.heading && body === preset.body
                ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j'
                : 'rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'
            }
          >
            {preset.label}
          </button>
        ))}
        <CopyBtn value={css} label="Copy the CSS" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={'Heading font · ' + heading}>
          <select value={heading} onChange={(e) => setHeading(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {FAMILIES.map((family) => <option key={family.name} value={family.name}>{family.name} — {family.category}</option>)}
          </select>
        </Field>
        <Field label={'Body font · ' + body}>
          <select value={body} onChange={(e) => setBody(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {FAMILIES.map((family) => <option key={family.name} value={family.name}>{family.name} — {family.category}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Heading size · ' + headingPx + 'px'}>
          <input type="range" min={24} max={96} step={2} value={headingSize} onChange={(e) => setHeadingSize(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Body size · ' + bodyPx + 'px'}>
          <input type="range" min={12} max={24} step={1} value={bodySize} onChange={(e) => setBodySize(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Heading tracking · ' + tracking + 'em'}>
          <input type="range" min={-0.05} max={0.2} step={0.005} value={tracking} onChange={(e) => setTracking(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Line height · ' + lineHeight}>
          <input type="range" min={1.2} max={2} step={0.05} value={lineHeight} onChange={(e) => setLineHeight(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <Panel className="!p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live preview</span>
          <input
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="Your own headline"
            className="h-8 w-52 max-w-[60%] rounded-md border border-input bg-transparent px-2 text-[11px]"
          />
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 p-5">
          <h3 style={headingStyle} className="font-semibold">{sample || SAMPLE}</h3>
          <p style={subStyle} className="mt-2 text-muted-foreground">{SUBTEXT}</p>
          <p style={bodyStyle} className="mt-3">{BODY_TEXT}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span style={buttonStyle} className="rounded-lg bg-cyan-j/15 px-3 py-1.5 font-medium text-cyan-j">Primary action</span>
            <span style={buttonStyle} className="rounded-lg border border-border px-3 py-1.5">Secondary</span>
            <span style={numeralStyle} className="ml-auto text-muted-foreground">1 234 · 56.78</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero tone={contrast.tone} label="The pairing reads as" value={contrast.verdict} sub={contrast.note} />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What to check before you commit</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Does the heading still read as a heading at 24px? Some display faces collapse below 32px.</p>
            <p>· Read the body paragraph above at the size you actually ship. {bodyPx < 15 ? 'Under 15px is hard on most screens — 16px is the safe floor.' : 'This size is comfortable on a phone.'}</p>
            <p>· Check digits and punctuation in the sample row — tabular figures matter for tables and prices.</p>
            <p>· {contrast.verdict === 'Fighting' ? 'Drop the body face to a neutral sans and let only the heading carry character.' : 'Hierarchy is coming from size and weight rather than a clash of styles, which is what makes it look deliberate.'}</p>
            <p>· Load only the weights you use. Three per family is usually plenty, at roughly 20–40 KB each.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Heading" value={heading} mono />
        <Stat label="Body" value={body} mono />
        <Stat label="Size ratio" value={ratio.toFixed(2) + '×'} mono sub="2.5–3× is a classic hierarchy" />
        <Stat label="Weights" value="3 + 3" mono sub="heading + body" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The CSS to drop into a project</div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{css}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Pairings that hold up</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· One characterful face plus one neutral face. If both are expressive, the page looks unsure of itself.</p>
            <p>· A serif heading over a sans body reads as considered; the reverse reads as editorial or academic.</p>
            <p>· Same family, different weight (700 heading / 400 body) is never wrong, and it is what most design systems ship.</p>
            <p>· Match x-height rather than style: a body face with a much smaller x-height makes the heading look oversized.</p>
            <p>· Test with real content — long words, numbers and punctuation — before you commit to a face.</p>
          </div>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Heading', value: heading },
                { label: 'Body', value: body },
                { label: 'Verdict', value: contrast.verdict },
              ]}
            />
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Performance notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Every extra weight is a separate file. Four weights of one family costs about as much as two families with two weights each.</p>
            <p>· Always set a fallback stack (as the CSS here does) so text is readable before the font loads.</p>
            <p>· Use <span className="font-mono-j">font-display: swap</span> — visible text immediately, font swapped in when ready.</p>
            <p>· Preload the body face only; a late heading swap is noticed far less than a late paragraph swap.</p>
            <p>· A system-font stack costs nothing and is often the right answer for dense product UI.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Families load from Google Fonts as you pick them, so the preview is the real typeface rather than a substituted system font. It is scoped to this
          page and changes nothing about the app you are in — the CSS above is there for you to paste wherever the design actually lives.
        </p>
      </Panel>
    </ToolShell>
  );
}