import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SIZES = {
  og: { label: 'Open Graph 1200×630', width: 1200, height: 630 },
  twitter: { label: 'Twitter 1600×900', width: 1600, height: 900 },
  square: { label: 'Square 1080×1080', width: 1080, height: 1080 },
  story: { label: 'Story 1080×1920', width: 1080, height: 1920 },
};

const svgToBase64 = (markup) => {
  const bytes = new TextEncoder().encode(markup);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const wrap = (text, perLine) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > perLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines;
};

export default function SocialCard() {
  const [title, setTitle] = useState('Build a personal operating system');
  const [subtitle, setSubtitle] = useState('Notes, tasks, files and knowledge in one intelligent workspace.');
  const [badge, setBadge] = useState('NEW');
  const [handle, setHandle] = useState('mark37.app');
  const [size, setSize] = useState('og');
  const [layout, setLayout] = useState('left');
  const [theme, setTheme] = useState('dark');
  const [from, setFrom] = useState('#0b1120');
  const [to, setTo] = useState('#164e63');
  const [accent, setAccent] = useState('#22d3ee');
  const [dots, setDots] = useState(true);
  const [mark, setMark] = useState('M');
  const [stamp, setStamp] = useState(0);
  const svgRef = useRef(null);

  const sizeConfig = SIZES[size] || SIZES.og;
  const { width, height } = sizeConfig;

  useEffect(() => {
    setStamp((current) => current + 1);
    if (svgRef.current) svgRef.current.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }, [title, subtitle, badge, handle, size, layout, theme, from, to, accent, dots, mark]);

  const design = useMemo(() => {
    const dark = theme === 'dark';
    const textColour = dark ? '#f8fafc' : '#0f172a';
    const mutedColour = dark ? '#94a3b8' : '#475569';
    const scale = Math.min(width, height);
    const titleSize = Math.round(scale * (layout === 'centred' ? 0.075 : 0.07));
    const titleChars = Math.round((layout === 'centred' ? width * 0.82 : width * 0.58) / (titleSize * 0.52));
    const titleLines = wrap(title, Math.max(12, titleChars)).slice(0, 5);
    const subtitleSize = Math.round(titleSize * 0.42);
    const subtitleChars = Math.round((layout === 'centred' ? width * 0.78 : width * 0.54) / (subtitleSize * 0.5));
    const subtitleLines = wrap(subtitle, Math.max(16, subtitleChars)).slice(0, 4);

    const left = layout === 'centred' ? width / 2 : Math.round(width * 0.08);
    const align = layout === 'centred' ? 'middle' : 'start';
    const blockHeight = titleLines.length * titleSize * 1.14 + subtitleLines.length * subtitleSize * 1.4;
    const startY = layout === 'centred'
      ? Math.round(height / 2 - blockHeight / 2)
      : Math.round(height / 2 - blockHeight / 2 + (badge ? 18 : 0));

    return { dark, textColour, mutedColour, titleSize, titleLines, subtitleSize, subtitleLines, left, align, startY, scale };
  }, [title, subtitle, badge, handle, size, layout, theme, width, height]);

  const download = (format) => {
    const svg = svgRef.current;
    if (!svg) return;
    const markup = svg.outerHTML;
    if (format === 'svg') {
      const blob = new Blob([markup], { type: 'image/svg+xml' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'social-card.svg';
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, width, height);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = 'social-card-' + width + 'x' + height + '.png';
      link.click();
    };
    image.src = 'data:image/svg+xml;base64,' + svgToBase64(markup);
  };

  const report = useMemo(() => [
    'Card ' + width + ' × ' + height + ' (' + sizeConfig.label + ')',
    'Layout: ' + layout + ' · theme: ' + theme,
    'Title: ' + title,
    'Subtitle: ' + subtitle,
    badge ? 'Badge: ' + badge : '',
    handle ? 'Handle: ' + handle : '',
    'Colours: ' + from + ' → ' + to + ', accent ' + accent,
  ].filter(Boolean).join('\n'), [title, subtitle, badge, handle, size, layout, theme, from, to, accent, width, height, sizeConfig]);

  return (
    <ToolShell
      toolId="social-card"
      icon={ImageIcon}
      title="Social Share Card Maker"
      desc="Design an Open Graph or story card with a gradient backdrop, badge and wrapped title, then export a pixel-perfect PNG or the SVG behind it."
      state={{ title, subtitle, badge, handle, size, layout, theme, from, to, accent, dots, mark }}
      onRestore={(restored) => {
        if (typeof restored.title === 'string') setTitle(restored.title);
        if (typeof restored.subtitle === 'string') setSubtitle(restored.subtitle);
        if (typeof restored.badge === 'string') setBadge(restored.badge);
        if (typeof restored.handle === 'string') setHandle(restored.handle);
        if (restored.size) setSize(restored.size);
        if (restored.layout) setLayout(restored.layout);
        if (restored.theme) setTheme(restored.theme);
        if (restored.from) setFrom(restored.from);
        if (restored.to) setTo(restored.to);
        if (restored.accent) setAccent(restored.accent);
        if (typeof restored.dots === 'boolean') setDots(restored.dots);
        if (typeof restored.mark === 'string') setMark(restored.mark);
      }}
      exportText={report}
      exportName="social-card.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3">
          <Field label="Headline">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
          <Field label="Supporting line">
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Badge">
              <input value={badge} onChange={(e) => setBadge(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Handle or domain">
              <input value={handle} onChange={(e) => setHandle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
            </Field>
            <Field label="Monogram">
              <input value={mark} onChange={(e) => setMark(e.target.value.slice(0, 2))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-center text-sm" />
            </Field>
          </div>
          <Seg value={size} onChange={setSize} options={[{ value: 'og', label: '1200×630' }, { value: 'twitter', label: '1600×900' }, { value: 'square', label: '1080²' }, { value: 'story', label: '1080×1920' }]} />
          <Seg value={layout} onChange={setLayout} options={[{ value: 'left', label: 'Left aligned' }, { value: 'centred', label: 'Centred' }, { value: 'split', label: 'Split' }]} />
          <Seg value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Gradient from"><input type="color" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" /></Field>
            <Field label="Gradient to"><input type="color" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" /></Field>
            <Field label="Accent"><input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" /></Field>
          </div>
          <ToggleRow label="Add a dot texture" checked={dots} onChange={setDots} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download('png')} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">Download PNG</button>
            <button type="button" onClick={() => download('svg')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground">Download SVG</button>
            <CopyBtn value={report} label="Copy the settings" />
          </div>
        </div>

        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Preview</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{width} × {height}</span>
          </div>
          <svg ref={svgRef} key={stamp} viewBox={'0 0 ' + width + ' ' + height} className="w-full rounded-xl border border-border/60">
            <defs>
              <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={from} />
                <stop offset="100%" stopColor={to} />
              </linearGradient>
              <pattern id="cardDots" width="34" height="34" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.4" fill={design.dark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.07)'} />
              </pattern>
            </defs>
            <rect x="0" y="0" width={width} height={height} fill="url(#cardBg)" />
            {dots && <rect x="0" y="0" width={width} height={height} fill="url(#cardDots)" />}
            <circle cx={width * 0.86} cy={height * 0.16} r={design.scale * 0.34} fill={accent} opacity="0.09" />
            <circle cx={width * 0.12} cy={height * 0.88} r={design.scale * 0.24} fill={accent} opacity="0.07" />

            {design.dark && <rect x="0" y="0" width={width} height={height} fill="#020617" opacity="0.18" />}

            {(layout === 'left' || layout === 'split') && (
              <g>
                <rect x={design.left} y={Math.round(height * 0.1)} width={design.scale * 0.11} height={design.scale * 0.11} rx={(design.scale * 0.11) / 3.2} fill={accent} opacity="0.16" />
                <text x={design.left + design.scale * 0.055} y={Math.round(height * 0.1) + design.scale * 0.075} textAnchor="middle" fontSize={design.scale * 0.055} fontWeight="700" fill={accent}>{mark || 'M'}</text>
              </g>
            )}

            {badge && (
              <g>
                <rect x={design.left} y={design.startY - Math.round(design.titleSize * 0.95)} width={Math.max(86, badge.length * design.scale * 0.032 + 34)} height={Math.round(design.scale * 0.055)} rx={Math.round(design.scale * 0.027)} fill={accent} opacity="0.18" />
                <text x={design.left + Math.max(17, (badge.length * design.scale * 0.032 + 34) / 2)} y={design.startY - Math.round(design.titleSize * 0.95) + Math.round(design.scale * 0.037)} textAnchor="middle" fontSize={Math.round(design.scale * 0.026)} fontWeight="700" fill={accent} letterSpacing="1.5">{badge.toUpperCase()}</text>
              </g>
            )}

            {design.titleLines.map((line, index) => (
              <text
                key={line + index}
                x={design.left}
                y={design.startY + index * design.titleSize * 1.14}
                textAnchor={design.align}
                fontSize={design.titleSize}
                fontWeight="700"
                fill={design.textColour}
              >
                {line}
              </text>
            ))}

            {design.subtitleLines.map((line, index) => (
              <text
                key={line + 'sub' + index}
                x={design.left}
                y={design.startY + design.titleLines.length * design.titleSize * 1.14 + design.subtitleSize * 1.1 + index * design.subtitleSize * 1.4}
                textAnchor={design.align}
                fontSize={design.subtitleSize}
                fill={design.mutedColour}
              >
                {line}
              </text>
            ))}

            <rect x={design.left} y={height - Math.round(height * 0.18)} width={Math.round(width * 0.085)} height={Math.max(4, Math.round(height * 0.008))} rx="3" fill={accent} />
            {handle && (
              <text x={design.left} y={height - Math.round(height * 0.13)} textAnchor={design.align} fontSize={Math.round(design.scale * 0.03)} fill={design.mutedColour}>{handle}</text>
            )}
          </svg>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Text is wrapped to the width automatically, so long headlines reflow instead of running off the edge. The exported PNG is rasterised from this exact
            drawing, which keeps the preview and the file identical.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Export size"
          value={width + ' × ' + height}
          sub={sizeConfig.label + ' · ' + design.titleLines.length + ' headline line' + (design.titleLines.length === 1 ? '' : 's') + ' at ' + design.titleSize + 'px, ' + design.subtitleLines.length + ' supporting line' + (design.subtitleLines.length === 1 ? '' : 's') + '.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Wrapping check</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            {design.titleLines.map((line, index) => <p key={index} className="text-foreground">{line}</p>)}
            {design.subtitleLines.map((line, index) => <p key={'s' + index}>{line}</p>)}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizes that matter for sharing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· 1200 × 630 is the Open Graph standard used by Facebook, LinkedIn and Slack previews. Under that ratio the image is cropped.</p>
            <p>· Twitter summary cards with a large image want 1600 × 900, a 16:9 frame.</p>
            <p>· Square 1080 × 1080 covers Instagram feeds, and the tall 1080 × 1920 suits stories and reels covers.</p>
            <p>· Text must survive being viewed at thumbnail size — a third of the width on a phone. If the headline is unreadable small, shorten it rather than shrink it.</p>
            <p>· Keep the headline to four or five words where possible, and never let the text come within about 8% of the edges.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Colour and contrast</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The dark theme lays a tint over the gradient so white text keeps its contrast no matter which colours you choose.</p>
            <p>· The accent is used for the badge, the monogram and the underline — one accent colour used consistently reads as a brand.</p>
            <p>· Pick the gradient from the product itself. Two unrelated bright colours look like a template rather than a piece of design.</p>
            <p>· Light text on a light gradient is the most common mistake here; if you switch to the light theme, check the result rather than assuming.</p>
            <p>· The dot texture adds texture at full size and disappears at thumbnail size, which is exactly what you want from a background detail.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Size" value={width + 'w'} mono sub={height + ' tall'} />
        <Stat label="Headline" value={design.titleSize + 'px'} mono sub={design.titleLines.length + ' lines'} />
        <Stat label="Layout" value={layout} mono sub={theme + ' theme'} />
        <Stat label="Aspect" value={(width / height).toFixed(2) + ':1'} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where the file goes</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Add it to a page as an og:image tag so link previews show the card instead of a screenshot of whatever loads first.</p>
          <p>· Social platforms cache previews aggressively. After replacing the image, ask the platform to re-scrape the URL, or append a query string to force a refresh.</p>
          <p>· The SVG export stays editable, which is useful when a headline changes and you would rather edit text than rebuild the card.</p>
          <p>· Because the PNG is rasterised from the same vector drawing, there is no scaling blur and no discrepancy between what you saw and what you saved.</p>
          <p>· Everything is generated in the browser, so nothing about your copy or colours is sent anywhere.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Preset', value: size },
              { label: 'Theme', value: theme },
              { label: 'Accent', value: accent },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Headlines are wrapped by measuring character counts against the font size for the chosen layout, with a generous line height so long titles stay legible.
          Change any setting and both the SVG and the exported PNG follow, because the export is rasterised from the very drawing you are looking at.
        </p>
      </Panel>
    </ToolShell>
  );
}