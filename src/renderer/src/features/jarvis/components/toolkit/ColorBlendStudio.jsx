import { useMemo, useState } from 'react';
import { Blend } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const MODES = [
  { value: 'mix', label: 'Mix' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'darken', label: 'Darken' },
  { value: 'difference', label: 'Difference' },
  { value: 'pigment', label: 'Pigment' },
];

const hexToRgb = (value) => {
  const clean = String(value).replace('#', '').trim();
  if (clean.length === 3 && /^[0-9a-f]{3}$/i.test(clean)) {
    return [parseInt(clean[0] + clean[0], 16), parseInt(clean[1] + clean[1], 16), parseInt(clean[2] + clean[2], 16)];
  }
  if (clean.length !== 6 || /[^0-9a-f]/i.test(clean)) return null;
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
};

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
const toHex = (rgb) => '#' + rgb.map((value) => clamp(value).toString(16).padStart(2, '0')).join('');

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

const rgbToHsl = (rgb) => {
  const [r, g, b] = rgb.map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  hue = (hue * 60 + 360) % 360;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation * 100, l: lightness * 100 };
};

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const lightness = Math.max(0, Math.min(100, l)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  let rgb;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return rgb.map((value) => clamp((value + m) * 255));
};

const blendChannel = (base, other, mode) => {
  const x = base / 255;
  const y = other / 255;
  switch (mode) {
    case 'multiply': return x * y;
    case 'screen': return 1 - (1 - x) * (1 - y);
    case 'overlay': return x < 0.5 ? 2 * x * y : 1 - 2 * (1 - x) * (1 - y);
    case 'lighten': return Math.max(x, y);
    case 'darken': return Math.min(x, y);
    case 'difference': return Math.abs(x - y);
    case 'pigment': return 1 - (1 - x) * (1 - y);
    default: return y;
  }
};

export default function ColorBlendStudio() {
  const [colorA, setColorA] = useState('#22d3ee');
  const [colorB, setColorB] = useState('#a855f7');
  const [mode, setMode] = useState('mix');
  const [amount, setAmount] = useState('50');
  const [sampleText, setSampleText] = useState('Blended headline');
  const [showLadder, setShowLadder] = useState(true);

  const result = useMemo(() => {
    const a = hexToRgb(colorA) || [34, 211, 238];
    const b = hexToRgb(colorB) || [168, 85, 247];
    const mix = Math.max(0, Math.min(100, Number(amount) || 50)) / 100;

    const blended = a.map((channel, index) => {
      const target = 255 * blendChannel(channel, b[index], mode);
      return clamp(channel + (target - channel) * mix);
    });

    const hex = toHex(blended);
    const white = [255, 255, 255];
    const black = [15, 23, 42];
    const onWhite = contrast(blended, white);
    const onBlack = contrast(blended, black);
    const onText = onWhite >= onBlack ? '#ffffff' : '#0f172a';
    const bestContrast = Math.max(onWhite, onBlack);

    const ladder = Array.from({ length: 9 }, (unusedValue, index) => {
      const step = index / 8;
      const value = a.map((channel, position) => clamp(channel + (b[position] - channel) * step));
      return { label: index === 0 ? 'A' : index === 8 ? 'B' : Math.round(step * 100) + '%', hex: toHex(value), step };
    });

    const tints = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15].map((weight) => ({
      label: 'lighten ' + Math.round(weight * 100) + '%',
      hex: toHex(blended.map((channel) => clamp(channel + (255 - channel) * weight))),
    }));
    const shades = [0.1, 0.2, 0.3, 0.45, 0.6, 0.75].map((weight) => ({
      label: 'darken ' + Math.round(weight * 100) + '%',
      hex: toHex(blended.map((channel) => clamp(channel * (1 - weight)))),
    }));

    const hsl = rgbToHsl(blended);
    const harmony = [
      { label: 'Complement +180°', h: hsl.h + 180, s: hsl.s, l: hsl.l },
      { label: 'Analogous +30°', h: hsl.h + 30, s: hsl.s, l: hsl.l },
      { label: 'Analogous −30°', h: hsl.h - 30, s: hsl.s, l: hsl.l },
      { label: 'Triad +120°', h: hsl.h + 120, s: hsl.s, l: hsl.l },
      { label: 'Split complement', h: hsl.h + 150, s: hsl.s, l: hsl.l },
      { label: 'Muted partner', h: hsl.h + 180, s: Math.max(8, hsl.s * 0.55), l: Math.min(92, hsl.l + 12) },
    ].map((entry) => ({ label: entry.label, hex: toHex(hslToRgb(entry.h, entry.s, entry.l)) }));

    const rgbText = 'rgb(' + blended.join(', ') + ')';
    const hslText = 'hsl(' + Math.round(hsl.h) + ' ' + Math.round(hsl.s) + '% ' + Math.round(hsl.l) + '%)';

    const report = [
      'Blend ' + mode + ' of ' + colorA + ' and ' + colorB + ' at ' + amount + '%',
      'Result ' + hex + ' · ' + rgbText + ' · ' + hslText,
      'Contrast against white ' + onWhite.toFixed(2) + ':1 and against near-black ' + onBlack.toFixed(2) + ':1',
      'Best text colour on this background: ' + onText,
      '',
      'Ladder from A to B:',
      ...ladder.map((entry) => '  ' + entry.label.padEnd(6, ' ') + entry.hex),
      '',
      'Tints: ' + tints.map((entry) => entry.hex).join(' '),
      'Shades: ' + shades.map((entry) => entry.hex).join(' '),
      'Harmony: ' + harmony.map((entry) => entry.label + ' ' + entry.hex).join(' · '),
    ].join('\n');

    return { blended, hex, rgbText, hslText, onWhite, onBlack, onText, bestContrast, ladder, tints, shades, harmony, report, readable: bestContrast >= 4.5 };
  }, [colorA, colorB, mode, amount]);

  const validA = hexToRgb(colorA);
  const validB = hexToRgb(colorB);

  return (
    <ToolShell
      toolId="color-blend"
      icon={Blend}
      title="Colour Blend Studio"
      desc="Two colours into one through every blend mode, including a real subtractive pigment mix — with a tint and shade ladder, harmony colours, a text recommendation and WCAG contrast."
      state={{ colorA, colorB, mode, amount, sampleText, showLadder }}
      onRestore={(restored) => {
        if (typeof restored.colorA === 'string') setColorA(restored.colorA);
        if (typeof restored.colorB === 'string') setColorB(restored.colorB);
        if (restored.mode) setMode(restored.mode);
        if (restored.amount !== undefined) setAmount(String(restored.amount));
        if (typeof restored.sampleText === 'string') setSampleText(restored.sampleText);
        if (typeof restored.showLadder === 'boolean') setShowLadder(restored.showLadder);
      }}
      exportText={result.report}
      exportName="colour-blend.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <Field label="Colour A">
            <div className="flex items-center gap-2">
              <input type="color" value={validA ? colorA : '#22d3ee'} onChange={(e) => setColorA(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
              <input value={colorA} onChange={(e) => setColorA(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </div>
          </Field>
        </Panel>
        <Panel className="!p-3">
          <Field label="Colour B">
            <div className="flex items-center gap-2">
              <input type="color" value={validB ? colorB : '#a855f7'} onChange={(e) => setColorB(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
              <input value={colorB} onChange={(e) => setColorB(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </div>
          </Field>
        </Panel>
      </div>

      <Seg value={mode} onChange={setMode} options={MODES} />
      <Field label={'Mix amount — ' + amount + '%'}>
        <input type="range" min="0" max="100" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full accent-cyan-j" />
      </Field>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Live preview</span>
          <CopyBtn value={result.hex} label={'Copy ' + result.hex} />
        </div>
        <div className="rounded-xl border border-border/60 px-4 py-6" style={{ backgroundColor: result.hex, color: result.onText }}>
          <input
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            className="w-full bg-transparent text-lg font-medium outline-none"
            style={{ color: result.onText }}
          />
          <p className="mt-1 text-[12px] opacity-90">
            Small sample text at 12 pixels to check legibility. {result.readable ? 'This combination passes WCAG AA for body text.' : 'This combination is below the 4.5 to 1 ratio needed for body text, so use it for large text or decoration only.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded px-2 py-1 text-[11px]" style={{ backgroundColor: result.onText, color: result.hex }}>Inverted</span>
            <span className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: result.onText }}>Outlined</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Blended colour"
          value={result.hex}
          sub={result.rgbText + ' · ' + result.hslText + '. Contrast is ' + result.onWhite.toFixed(2) + ':1 against white and ' + result.onBlack.toFixed(2) + ':1 against near-black, so the better text colour on this background is ' + result.onText + '.'}
        />
        <Ring
          value={Math.min(result.bestContrast, 21)}
          max={21}
          tone={result.bestContrast >= 7 ? 'emerald' : result.bestContrast >= 4.5 ? 'cyan' : 'rose'}
          label="Best contrast ratio"
          sub={result.bestContrast >= 7 ? 'Passes AAA for body text' : result.bestContrast >= 4.5 ? 'Passes AA for body text' : result.bestContrast >= 3 ? 'Passes AA for large text only' : 'Fails every WCAG text level'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium">Ladder from A to B</span>
          <ToggleRow label="Show ladder" checked={showLadder} onChange={setShowLadder} />
        </div>
        {showLadder && (
          <>
            <div className="flex overflow-hidden rounded-lg border border-border/60">
              {result.ladder.map((entry) => (
                <div
                  key={'step' + entry.hex + entry.label}
                  className="flex-1 px-1 py-6 text-center text-[10px]"
                  style={{ backgroundColor: entry.hex, color: contrast(hexToRgb(entry.hex) || [0, 0, 0], [255, 255, 255]) >= 4.5 ? '#0f172a' : '#ffffff' }}
                >
                  {entry.label}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.ladder.map((entry) => (
                <CopyBtn key={'copy' + entry.label + entry.hex} value={entry.hex} label={entry.hex} />
              ))}
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Tints and shades of the result</div>
          <div className="space-y-1">
            {[...result.tints, ...result.shades].map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 text-[11px]">
                <span className="h-5 w-5 shrink-0 rounded border border-border/60" style={{ backgroundColor: entry.hex }} />
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="ml-auto font-mono-j">{entry.hex}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Harmony colours from the result</div>
          <div className="grid grid-cols-2 gap-2">
            {result.harmony.map((entry) => (
              <div key={entry.label} className="rounded-lg border border-border/60 p-2">
                <div className="h-10 rounded" style={{ backgroundColor: entry.hex }} />
                <div className="mt-1 text-[10px] text-muted-foreground">{entry.label}</div>
                <div className="font-mono-j text-[10px]">{entry.hex}</div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <CopyBtn
              value={':root {\n  --blend: ' + result.hex + ';\n  --blend-rgb: ' + result.blended.join(' ') + ';\n  --on-blend: ' + result.onText + ';\n}'}
              label="Copy as CSS variables"
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Result" value={result.hex} mono sub={result.hslText} />
        <Stat label="RGB" value={result.blended.join(', ')} mono sub="0 to 255 per channel" />
        <Stat label="On white" value={result.onWhite.toFixed(2) + ':1'} mono sub={result.onWhite >= 4.5 ? 'passes AA' : 'fails AA'} />
        <Stat label="Best text" value={result.onText} mono sub={result.bestContrast.toFixed(2) + ':1'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing the right mode</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Mix with a percentage moves linearly between the two colours, which is what almost every brand gradient actually needs.</p>
            <p>· Multiply darkens: white becomes the other colour and black stays black. Use it for shading a colour with a texture or a shadow tint.</p>
            <p>· Screen does the opposite and lightens: black becomes the other colour, white stays white. Use it for glows and light overlays.</p>
            <p>· Overlay is contrast-dependent — it darkens the darker half and lightens the lighter half — so it adds depth without flattening.</p>
            <p>· Difference subtracts channel by channel and is mostly a diagnostic: if the result is near black, the two colours are almost identical.</p>
            <p>· Pigment is subtractive, like mixing paint. Cyan and yellow give green here, where a screen mix gives a pale grey. Use it for anything printed or painted.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using the result well</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A blend is not automatically accessible. Check the ratio first, and if body text fails, keep text on white or near-black and use the colour for fills and borders.</p>
            <p>· Large text only needs 3 to 1, so a borderline blend can still carry a headline while the caption stays dark.</p>
            <p>· Blends lose saturation fast. A cyan mixed with magenta at 50% usually reads greyish rather than vivid, which is why gradient designers interpolate in a wider colour space.</p>
            <p>· For button states, blend against the background at 8 to 12%, not 50%. A 50% blend is a new brand colour rather than a hover state.</p>
            <p>· Keep the tint ladder. Shifting one hue for hover, border and disabled states looks far more coherent than inventing a second colour.</p>
            <p>· Put the text rule in your tokens rather than eyeballing it per component — {result.onText} on {result.hex} gives {result.bestContrast.toFixed(2)} to 1.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: mode },
                { label: 'Mix', value: amount + '%' },
                { label: 'Contrast', value: result.bestContrast.toFixed(2) + ':1' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>mix: result = A + (B − A) × amount</p>
          <p>multiply: x × y · screen: 1 − (1 − x)(1 − y) · overlay: x &lt; 0.5 ? 2xy : 1 − 2(1 − x)(1 − y)</p>
          <p>pigment: 1 − (1 − x)(1 − y) per channel, a subtractive approximation</p>
          <p>relative luminance uses linearised channels weighted 0.2126, 0.7152 and 0.0722</p>
          <p>contrast = (lighter + 0.05) ÷ (darker + 0.05)</p>
          <p className="text-cyan-j">Check: {colorA} blended with {colorB} at {amount}% gives {result.hex}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Blending happens in plain sRGB without linear-light correction, which matches how CSS blend modes behave on screen. The pigment mode approximates subtractive mixing,
          which is close enough for interface choices but not for paint matching.
        </p>
      </Panel>
    </ToolShell>
  );
}