import { useMemo, useState } from 'react';
import { Palette } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const NAMES = [
  ['Black', '#000000'], ['Dim grey', '#696969'], ['Grey', '#808080'], ['Silver', '#c0c0c0'], ['Light grey', '#d3d3d3'], ['White smoke', '#f5f5f5'], ['White', '#ffffff'],
  ['Ivory', '#fffff0'], ['Cream', '#fffdd0'], ['Beige', '#f5f5dc'], ['Linen', '#faf0e6'], ['Wheat', '#f5deb3'], ['Tan', '#d2b48c'], ['Burlywood', '#deb887'],
  ['Khaki', '#f0e68c'], ['Sand', '#e3c16f'], ['Gold', '#ffd700'], ['Amber', '#ffbf00'], ['Orange', '#ffa500'], ['Dark orange', '#ff8c00'], ['Coral', '#ff7f50'],
  ['Tomato', '#ff6347'], ['Orange red', '#ff4500'], ['Red', '#ff0000'], ['Crimson', '#dc143c'], ['Firebrick', '#b22222'], ['Dark red', '#8b0000'], ['Maroon', '#800000'],
  ['Salmon', '#fa8072'], ['Light salmon', '#ffa07a'], ['Peach', '#ffdab9'], ['Apricot', '#fbceb1'], ['Pink', '#ffc0cb'], ['Hot pink', '#ff69b4'], ['Deep pink', '#ff1493'],
  ['Rose', '#ff007f'], ['Magenta', '#ff00ff'], ['Orchid', '#da70d6'], ['Plum', '#dda0dd'], ['Violet', '#ee82ee'], ['Medium purple', '#9370db'], ['Blue violet', '#8a2be2'],
  ['Purple', '#800080'], ['Indigo', '#4b0082'], ['Rebecca purple', '#663399'], ['Slate blue', '#6a5acd'], ['Navy', '#000080'], ['Midnight blue', '#191970'], ['Dark blue', '#00008b'],
  ['Medium blue', '#0000cd'], ['Blue', '#0000ff'], ['Royal blue', '#4169e1'], ['Cornflower blue', '#6495ed'], ['Dodger blue', '#1e90ff'], ['Sky blue', '#87ceeb'],
  ['Light sky blue', '#87cefa'], ['Deep sky blue', '#00bfff'], ['Steel blue', '#4682b4'], ['Powder blue', '#b0e0e6'], ['Cadet blue', '#5f9ea0'], ['Teal', '#008080'],
  ['Dark cyan', '#008b8b'], ['Cyan', '#00ffff'], ['Aqua', '#00ffff'], ['Turquoise', '#40e0d0'], ['Medium turquoise', '#48d1cc'], ['Aquamarine', '#7fffd4'],
  ['Pale turquoise', '#afeeee'], ['Mint cream', '#f5fffa'], ['Honeydew', '#f0fff0'], ['Sea green', '#2e8b57'], ['Medium sea green', '#3cb371'], ['Spring green', '#00ff7f'],
  ['Lime', '#00ff00'], ['Lime green', '#32cd32'], ['Green', '#008000'], ['Forest green', '#228b22'], ['Olive drab', '#6b8e23'], ['Olive', '#808000'],
  ['Dark olive', '#556b2f'], ['Yellow green', '#9acd32'], ['Chartreuse', '#7fff00'], ['Green yellow', '#adff2f'], ['Yellow', '#ffff00'], ['Lemon', '#fff44f'],
  ['Brown', '#a52a2a'], ['Sienna', '#a0522d'], ['Chocolate', '#d2691e'], ['Peru', '#cd853f'], ['Sandy brown', '#f4a460'], ['Rosy brown', '#bc8f8f'], ['Indian red', '#cd5c5c'],
  ['Slate grey', '#708090'], ['Light slate grey', '#778899'], ['Dark slate grey', '#2f4f4f'], ['Charcoal', '#36454f'], ['Ghost white', '#f8f8ff'], ['Azure', '#f0ffff'],
];

const HEX = (value) => {
  const clean = String(value).replace('#', '').trim();
  if (clean.length === 3) return '#' + clean.split('').map((char) => char + char).join('').toLowerCase();
  if (clean.length === 6) return '#' + clean.toLowerCase();
  return null;
};

const toRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const toHsl = (r, g, b) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === rn) hue = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / delta + 2);
    else hue = 60 * ((rn - gn) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation * 100, l: lightness * 100 };
};

const distance = (a, b) => {
  const redMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db);
};

const family = (hsl) => {
  if (hsl.s < 8) return hsl.l < 12 ? 'Black' : hsl.l > 95 ? 'White' : 'Grey';
  if (hsl.l < 12) return 'Near black';
  if (hsl.l > 94) return 'Near white';
  const hue = hsl.h;
  if (hue < 12 || hue >= 345) return hsl.s < 25 ? 'Brown' : 'Red';
  if (hue < 40) return hsl.s < 30 ? 'Brown' : 'Orange';
  if (hue < 65) return 'Yellow';
  if (hue < 95) return 'Yellow-green';
  if (hue < 150) return 'Green';
  if (hue < 185) return 'Teal';
  if (hue < 215) return 'Cyan / sky';
  if (hue < 250) return 'Blue';
  if (hue < 290) return 'Violet';
  if (hue < 320) return 'Purple';
  return 'Pink';
};

const luminance = (rgb) => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return ratio;
};

const rating = (ratio, large) => {
  if (ratio >= (large ? 3 : 4.5)) return 'AA';
  if (ratio >= (large ? 3 : 4.5) * 1.0) return 'AA';
  if (ratio >= 3) return 'AA large';
  return 'fails';
};

const shade = (rgb, amount) => ({
  r: Math.round(rgb.r + (amount > 0 ? (255 - rgb.r) * amount : rgb.r * amount)),
  g: Math.round(rgb.g + (amount > 0 ? (255 - rgb.g) * amount : rgb.g * amount)),
  b: Math.round(rgb.b + (amount > 0 ? (255 - rgb.b) * amount : rgb.b * amount)),
});

const toHex = (rgb) => '#' + [rgb.r, rgb.g, rgb.b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('');

export default function ColorNames() {
  const [input, setInput] = useState('#22d3ee');

  const data = useMemo(() => {
    const hex = HEX(input) || '#22d3ee';
    const rgb = toRgb(hex);
    const hsl = toHsl(rgb.r, rgb.g, rgb.b);
    const ranked = NAMES
      .map(([name, value]) => ({ name, hex: value, distance: distance(rgb, toRgb(value)) }))
      .sort((a, b) => a.distance - b.distance);
    const ladder = [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6].map((amount) => toHex(shade(rgb, amount)));
    const onWhite = contrast(rgb, { r: 255, g: 255, b: 255 });
    const onBlack = contrast(rgb, { r: 0, g: 0, b: 0 });
    return {
      hex, rgb, hsl, nearest: ranked[0], close: ranked.slice(1, 4), ladder,
      onWhite, onBlack, family: family(hsl),
      css: 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')',
      hslString: 'hsl(' + hsl.h.toFixed(0) + ', ' + hsl.s.toFixed(0) + '%, ' + hsl.l.toFixed(0) + '%)',
    };
  }, [input]);

  const report = [
    data.hex + ' — nearest CSS name: ' + data.nearest.name + ' (' + data.nearest.hex + ')',
    'rgb(' + data.rgb.r + ', ' + data.rgb.g + ', ' + data.rgb.b + ') · ' + data.hslString,
    'Family: ' + data.family,
    'Contrast on white ' + data.onWhite.toFixed(2) + ':1 (' + rating(data.onWhite) + ') · on black ' + data.onBlack.toFixed(2) + ':1 (' + rating(data.onBlack) + ')',
    'Ladder: ' + data.ladder.join(', '),
  ].join('\n');

  return (
    <ToolShell
      toolId="color-names"
      icon={Palette}
      title="Colour Name Finder"
      desc="Turn any hex into the closest real colour name, its family, a nine-step shade ladder and the contrast it has against white and black."
      state={{ input }}
      onRestore={(restored) => {
        if (typeof restored.input === 'string') setInput(restored.input);
      }}
      exportText={report}
      exportName="colour.txt"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Colour">
          <div className="flex items-center gap-2">
            <input type="color" value={HEX(input) || '#22d3ee'} onChange={(e) => setInput(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
            <input value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} className="h-9 w-32 rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </div>
        </Field>
        <CopyBtn value={data.hex} label="Copy hex" />
        <CopyBtn value={data.hslString} label="Copy HSL" />
        <CopyBtn value={data.css} label="Copy rgb()" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <div className="tk-card tk-depth overflow-hidden rounded-xl border border-border/70">
          <div className="h-32 w-full" style={{ backgroundColor: data.hex }} />
          <div className="p-3">
            <div className="font-display text-lg font-semibold">{data.nearest.name}</div>
            <div className="font-mono-j text-[11px] text-muted-foreground">
              {data.hex} · {data.nearest.hex} · distance {data.nearest.distance.toFixed(1)}
            </div>
          </div>
        </div>
        <Hero
          label="Family"
          value={data.family}
          sub={data.nearest.distance < 10
            ? 'Almost exactly a standard named colour.'
            : data.nearest.distance < 40
              ? 'Close to a standard name, but not a match — worth saying “' + data.nearest.name.toLowerCase() + '” in conversation.'
              : 'Between names: nearest is ' + data.nearest.name + ', but ' + data.close[0].name + ' is nearly as close.'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Closest standard names</div>
        <div className="grid gap-1.5 sm:grid-cols-4">
          {[data.nearest, ...data.close].map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => setInput(entry.hex)}
              className="rounded-lg border border-border/60 bg-card/40 p-2 text-left transition hover:border-cyan-j/50"
            >
              <div className="h-8 w-full rounded" style={{ backgroundColor: entry.hex }} />
              <div className="mt-1.5 text-[11px] font-medium">{index === 0 ? entry.name + ' ←' : entry.name}</div>
              <div className="font-mono-j text-[10px] text-muted-foreground">{entry.hex} · Δ{entry.distance.toFixed(1)}</div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Nine-step ladder — darker to lighter</div>
        <div className="grid grid-cols-9 gap-1">
          {data.ladder.map((step, index) => (
            <button key={step} type="button" onClick={() => setInput(step)} className="overflow-hidden rounded-md border border-border/50">
              <div className="h-12 w-full" style={{ backgroundColor: step }} />
              <div className="bg-card/60 py-0.5 font-mono-j text-[8px] text-muted-foreground">{index === 4 ? 'base' : step.slice(1, 4)}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The middle swatch is your colour; the rest step toward black and white. A nine-step ladder like this is what design tokens call a 100–900 scale.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Used as text on white and black</div>
          <div className="space-y-2">
            <div className="rounded-lg bg-white p-2 text-center" style={{ color: data.hex }}>
              <span className="text-sm font-medium">The quick brown fox</span>
            </div>
            <div className="rounded-lg bg-black p-2 text-center" style={{ color: data.hex }}>
              <span className="text-sm font-medium">The quick brown fox</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">On white {data.onWhite.toFixed(2)}:1 · {rating(data.onWhite)}</span>
              <span className="text-muted-foreground">On black {data.onBlack.toFixed(2)}:1 · {rating(data.onBlack)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {data.onWhite >= 4.5 ? 'Legible as body text on a white background.' : data.onWhite >= 3 ? 'Only large text or UI shapes on white; body text will strain.' : 'Too light for text on white — use it for fills and borders only.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where it sits in HSL</div>
          <Bars
            data={[
              { label: 'Hue', value: data.hsl.h },
              { label: 'Sat', value: data.hsl.s },
              { label: 'Light', value: data.hsl.l },
            ]}
            format={(value) => value.toFixed(0)}
            suffix="%"
            highlightLast={false}
          />
          <div className="mt-2 space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>hex {data.hex}</p>
            <p>rgb {data.css}</p>
            <p>hsl {data.hslString}</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Red" value={String(data.rgb.r)} mono />
        <Stat label="Green" value={String(data.rgb.g)} mono />
        <Stat label="Blue" value={String(data.rgb.b)} mono />
        <Stat label="Hue" value={data.hsl.h.toFixed(0) + '°'} mono sub={data.family} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Using colour names well</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Names are for talking to people, hex is for shipping. "A cyan with a bit of green in it" lands better in a meeting than #22d3ee.</p>
          <p>· Only 148 colours have CSS names, and most of them are clustered in the same few regions — two visibly different colours can share a nearest name.</p>
          <p>· When designing a scale, keep the hue and vary lightness in even steps. Changing hue mid-ladder is what makes a palette look muddy.</p>
          <p>· Contrast is not a preference: 4.5:1 is the floor for body text, 3:1 for large text and UI borders. The numbers above are the same ones an audit will use.</p>
          <p>· The distance here uses the red-mean formula, which tracks human perception far better than plain RGB distance — a difference under about 20 is genuinely hard to see.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Nearest', value: data.nearest.name },
              { label: 'Family', value: data.family },
              { label: 'Contrast on white', value: data.onWhite.toFixed(1) + ':1' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The nearest-name search compares your colour against the standard CSS palette and the widely used design names, weighting the channels the way the
          eye does. The ladder and the contrast figures are computed from the actual channels, so a colour that looks fine on your screen but fails contrast
          will say so here rather than in an accessibility review later.
        </p>
      </Panel>
    </ToolShell>
  );
}