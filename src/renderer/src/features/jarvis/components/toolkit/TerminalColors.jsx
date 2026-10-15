import { useMemo, useState } from 'react';
import { Terminal } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const THEMES = {
  default: ['#000000', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf', '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'],
  solarized: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  dracula: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  nord: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#d08770', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  gruvbox: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  onedark: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
};

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'bright black', 'bright red', 'bright green', 'bright yellow', 'bright blue', 'bright magenta', 'bright cyan', 'bright white'];
const CUBE = [0, 95, 135, 175, 215, 255];
const toHex = (r, g, b) => '#' + [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('');
const luminance = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const channel = (value) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export default function TerminalColors() {
  const [theme, setTheme] = useState('dracula');
  const [pick, setPick] = useState({ r: 88, g: 166, b: 255 });
  const [mode, setMode] = useState('fg');
  const [sample, setSample] = useState('deploy finished in 12.4s');

  const palette16 = THEMES[theme] || THEMES.dracula;

  const palette256 = useMemo(() => {
    const list = palette16.map((hex, index) => ({ index, hex, label: NAMES[index] }));
    for (let r = 0; r < 6; r += 1) {
      for (let g = 0; g < 6; g += 1) {
        for (let b = 0; b < 6; b += 1) {
          list.push({ index: 16 + 36 * r + 6 * g + b, hex: toHex(CUBE[r], CUBE[g], CUBE[b]), label: 'cube ' + r + ',' + g + ',' + b });
        }
      }
    }
    for (let i = 0; i < 24; i += 1) {
      const level = 8 + i * 10;
      list.push({ index: 232 + i, hex: toHex(level, level, level), label: 'grey ' + level });
    }
    return list;
  }, [palette16]);

  const truecolorHex = toHex(pick.r, pick.g, pick.b);
  const escape256 = '\\x1b[38;5;' + (mode === 'fg' ? 'N' : '48;5;N') + 'm';
  const escapeTrue = '\\x1b[' + (mode === 'fg' ? '38' : '48') + ';2;' + pick.r + ';' + pick.g + ';' + pick.b + 'm';
  const resolvedEscape = mode === 'fg' ? escapeTrue : escapeTrue;

  const snippets = useMemo(() => ({
    bash: [
      '# 256 colour foreground and background',
      "printf '\\x1b[38;5;%sm%s\\x1b[0m\\n' 208 'orange text'",
      "printf '\\x1b[48;5;%sm%s\\x1b[0m\\n' 236 'on a dark background'",
      '',
      '# 24-bit truecolor',
      "printf '\\x1b[38;2;%s;%s;%sm%s\\x1b[0m\\n' " + pick.r + ' ' + pick.g + ' ' + pick.b + " 'custom colour'",
      '',
      '# Respect terminals that cannot do colour',
      'if [ -n "$NO_COLOR" ]; then plain=true; fi',
    ].join('\n'),
    js: [
      'const reset = "\\x1b[0m";',
      'const fg256 = (n) => "\\x1b[38;5;" + n + "m";',
      'const bg256 = (n) => "\\x1b[48;5;" + n + "m";',
      'const rgb = (r, g, b) => "\\x1b[38;2;" + r + ";" + g + ";" + b + "m";',
      '',
      'const orange = rgb(' + pick.r + ', ' + pick.g + ', ' + pick.b + ');',
      'console.log(orange + "coloured output" + reset);',
      '',
      '// Loggers should check first, or piping to a file fills it with escape codes',
      'const useColour = process.stdout.isTTY && !process.env.NO_COLOR;',
    ].join('\n'),
    css: [
      '/* Terminal themes translate directly to CSS variables */',
      palette16.slice(0, 8).map((hex, index) => '--ansi-' + index + ': ' + hex + ';').join('\n'),
      '',
      '/* Semantic names age better than colour names */',
      '--term-error: ' + palette16[1] + ';',
      '--term-success: ' + palette16[2] + ';',
      '--term-warning: ' + palette16[3] + ';',
      '--term-info: ' + palette16[4] + ';',
      '--term-muted: ' + palette16[8] + ';',
    ].join('\n'),
  }), [palette16, pick]);

  const report = useMemo(() => [
    'Terminal palette: ' + theme + ' (' + palette16.length + ' base colours plus the 256 index palette)',
    'Custom colour: ' + truecolorHex + ' rgb(' + pick.r + ', ' + pick.g + ', ' + pick.b + ')',
    'Truecolor escape: ' + escapeTrue,
    '',
    palette16.map((hex, index) => (index + '').padStart(2, ' ') + '  ' + NAMES[index].padEnd(14, ' ') + hex).join('\n'),
  ].join('\n'), [theme, palette16, pick, truecolorHex, escapeTrue]);

  return (
    <ToolShell
      toolId="terminal-colors"
      icon={Terminal}
      title="Terminal Colour Palette"
      desc="Every ANSI colour, the full 256 index palette and a truecolor picker — with the exact escape sequences to copy, and the snippets that stop them leaking into log files."
      state={{ theme, pick, mode, sample }}
      onRestore={(restored) => {
        if (restored.theme) setTheme(restored.theme);
        if (restored.pick) setPick((current) => ({ ...current, ...restored.pick }));
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.sample === 'string') setSample(restored.sample);
      }}
      exportText={report}
      exportName="terminal-palette.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={theme}
          onChange={setTheme}
          options={Object.keys(THEMES).map((key) => ({ value: key, label: key }))}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The sixteen base colours</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{theme}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {palette16.map((hex, index) => (
            <button
              key={hex + index}
              type="button"
              onClick={() => {
                setPick({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
              }}
              className="rounded-lg border border-border/60 p-2 text-left transition hover:border-cyan-j/60"
              style={{ backgroundColor: hex, color: luminance(hex) > 0.4 ? '#111111' : '#f5f5f5' }}
              title={NAMES[index] + ' ' + hex}
            >
              <div className="font-mono-j text-[10px]">{index}</div>
              <div className="font-mono-j text-[9px] opacity-80">{hex}</div>
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyBtn value={palette16.join(', ')} label="Copy hex list" />
          <CopyBtn value={'\\x1b[38;5;Nm ... \\x1b[0m'} label="Copy escape pattern" />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Click a swatch to load it into the truecolor picker below. These sixteen are the colours a terminal emulator is allowed to define itself, which is why a theme looks
          completely different in two terminals while the code stays identical.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The 256 index palette</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{palette256.length} entries</span>
        </div>
        <div className="grid grid-cols-12 gap-0.5 sm:grid-cols-16">
          {palette256.map((entry) => (
            <button
              key={entry.index}
              type="button"
              onClick={() => setPick({ r: parseInt(entry.hex.slice(1, 3), 16), g: parseInt(entry.hex.slice(3, 5), 16), b: parseInt(entry.hex.slice(5, 7), 16) })}
              className="h-4 w-full rounded-sm border border-black/20 transition hover:scale-125"
              style={{ backgroundColor: entry.hex }}
              title={entry.index + ' · ' + entry.label + ' · ' + entry.hex}
            />
          ))}
        </div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
            {escape256}
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
            0 to 15 themes · 16 to 231 a 6×6×6 cube · 232 to 255 greys
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The cube steps are uneven on purpose: six levels from 0 to 255 including 95 and 135, which is why 256 colour gradients look slightly banded compared with truecolor.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Selected colour"
          value={truecolorHex}
          sub={'rgb(' + pick.r + ', ' + pick.g + ', ' + pick.b + ') with a relative luminance of ' + luminance(truecolorHex).toFixed(3) + '. The escape sequence below sets it as a ' + (mode === 'fg' ? 'foreground' : 'background') + ' colour.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Truecolor picker</div>
          <div className="space-y-2">
            {[['r', pick.r], ['g', pick.g], ['b', pick.b]].map((entry) => (
              <div key={entry[0]} className="flex items-center gap-2">
                <span className="w-3 font-mono-j text-[11px] uppercase text-muted-foreground">{entry[0]}</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={entry[1]}
                  onChange={(e) => setPick((current) => ({ ...current, [entry[0]]: Number(e.target.value) }))}
                  className="flex-1 accent-[hsl(var(--cyan))]"
                />
                <span className="w-9 text-right font-mono-j text-[11px]">{entry[1]}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Seg value={mode} onChange={setMode} options={[{ value: 'fg', label: 'Foreground' }, { value: 'bg', label: 'Background' }]} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyBtn value={resolvedEscape} label="Copy escape" />
            <CopyBtn value={truecolorHex} label="Copy hex" />
          </div>
          <div className="mt-3 rounded-lg p-3 font-mono-j text-[11px]" style={{ backgroundColor: mode === 'bg' ? truecolorHex : 'transparent', color: mode === 'fg' ? truecolorHex : luminance(truecolorHex) > 0.4 ? '#111111' : '#f5f5f5' }}>
            {sample || 'sample output'}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Theme" value={theme} mono sub="16 base colours" />
        <Stat label="Selected" value={truecolorHex} mono sub={'rgb ' + pick.r + ',' + pick.g + ',' + pick.b} />
        <Stat label="Palette size" value={String(palette256.length)} mono sub="indices 0 to 255" />
        <Stat label="Luminance" value={luminance(truecolorHex).toFixed(3)} mono sub={luminance(truecolorHex) > 0.4 ? 'light, use dark text' : 'dark, use light text'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Snippets that behave themselves</span>
          <div className="flex gap-2">
            <CopyBtn value={snippets.bash} label="Copy bash" />
            <CopyBtn value={snippets.js} label="Copy JS" />
            <CopyBtn value={snippets.css} label="Copy CSS" />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {['bash', 'js', 'css'].map((key) => (
            <pre key={key} className="max-h-52 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[10px] leading-relaxed">{snippets[key]}</pre>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <Field label="Preview text">
          <input value={sample} onChange={(e) => setSample(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Colour in terminals, honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Codes 0 to 7 and their bright variants 8 to 15 are chosen by the user theme, so never pick them expecting an exact colour. Only 16 to 255 and truecolor are predictable.</p>
            <p>· Bold historically forced the bright variant, which is why some terminals change colour when you add a bold attribute. Most now treat bold and bright separately.</p>
            <p>· Truecolor needs terminal support. Fall back to the 256 palette rather than emitting escape sequences into a terminal that will print them literally.</p>
            <p>· Always reset with the plain reset sequence. A missing reset leaks the colour into whatever is printed next, including the shell prompt.</p>
            <p>· Never hardcode colour when output is piped. Check whether stdout is a terminal, and honour the NO_COLOR variable that users set deliberately.</p>
            <p>· Colour alone cannot carry meaning. Add a marker, a word or an icon, because roughly one in twelve men cannot reliably separate red from green.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Building a palette that reads well</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Use one colour per meaning and never two meanings per colour. If red is an error it cannot also be a warning.</p>
            <p>· Reserve the brightest colours for the highest severity. A bright yellow info line competes with the error above it.</p>
            <p>· Dim rather than delete. Muted text for secondary detail keeps the structure visible without pulling the eye.</p>
            <p>· Test on light and dark backgrounds. A palette tuned only for dark themes loses all contrast the moment someone switches.</p>
            <p>· Keep the interface chrome greyscale. Colour then means something, because it is never used for decoration.</p>
            <p>· Your selected colour has a luminance of {luminance(truecolorHex).toFixed(2)}, which means {luminance(truecolorHex) > 0.4 ? 'it needs dark text on top rather than light.' : 'it needs light text on top to stay readable.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Theme', value: theme },
                { label: 'Colour', value: truecolorHex },
                { label: 'Setting', value: mode === 'fg' ? 'foreground' : 'background' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The escape sequences in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>foreground: ESC[38;5;Nm · background: ESC[48;5;Nm, with N from 0 to 255</p>
          <p>truecolor: ESC[38;2;R;G;Bm for text and ESC[48;2;R;G;Bm for the background</p>
          <p>reset: ESC[0m clears every attribute, including bold and underline</p>
          <p>attributes: ESC[1m bold · ESC[2m dim · ESC[3m italic · ESC[4m underline · ESC[7m inverted</p>
          <p className="text-cyan-j">Here: {escapeTrue}{sample || 'sample output'}{'\\x1b[0m'} places this colour on the screen.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The sixteen base colours are the widely used defaults and the same values most theme files ship as a starting point; the 256 palette is computed exactly as the specification
          defines it. What you actually see still depends on the font and the terminal, so treat any swatch as a good approximation rather than a guarantee.
        </p>
      </Panel>
    </ToolShell>
  );
}