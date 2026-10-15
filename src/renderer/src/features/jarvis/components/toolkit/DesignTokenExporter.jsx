import { useMemo, useState } from 'react';
import { Braces, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DEFAULT_COLORS = [
  { id: 'a', name: 'primary', hex: '#22d3ee' },
  { id: 'b', name: 'primary dark', hex: '#0891b2' },
  { id: 'c', name: 'surface', hex: '#0f172a' },
  { id: 'd', name: 'text', hex: '#f8fafc' },
  { id: 'e', name: 'muted text', hex: '#94a3b8' },
  { id: 'f', name: 'success', hex: '#34d399' },
  { id: 'g', name: 'warning', hex: '#fbbf24' },
  { id: 'h', name: 'danger', hex: '#f87171' },
];

const FORMATS = [
  { value: 'css', label: 'CSS variables' },
  { value: 'scss', label: 'SCSS' },
  { value: 'tailwind', label: 'Tailwind config' },
  { value: 'json', label: 'JSON tokens' },
  { value: 'android', label: 'Android XML' },
  { value: 'swift', label: 'Swift' },
];

const kebab = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token';
const camel = (value) => kebab(value).replace(/-([a-z0-9])/g, (match, letter) => letter.toUpperCase());
const pascal = (value) => camel(value).replace(/^[a-z]/, (letter) => letter.toUpperCase());
const snake = (value) => kebab(value).replace(/-/g, '_');

const TYPE_RATIOS = [
  { label: '1.125 — major second', value: 1.125 },
  { label: '1.200 — minor third', value: 1.2 },
  { label: '1.250 — major third', value: 1.25 },
  { label: '1.333 — perfect fourth', value: 1.333 },
  { label: '1.414 — perfect fifth', value: 1.414 },
  { label: '1.500 — perfect fifth', value: 1.5 },
  { label: '1.618 — golden ratio', value: 1.618 },
];

export default function DesignTokenExporter() {
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [format, setFormat] = useState('css');
  const [prefix, setPrefix] = useState('');
  const [includeSpacing, setIncludeSpacing] = useState(true);
  const [spacingBase, setSpacingBase] = useState('4');
  const [spacingSteps, setSpacingSteps] = useState('8');
  const [includeRadius, setIncludeRadius] = useState(true);
  const [radiusBase, setRadiusBase] = useState('4');
  const [includeType, setIncludeType] = useState(true);
  const [typeBase, setTypeBase] = useState('16');
  const [typeRatio, setTypeRatio] = useState('1.25');

  const set = (id, key, value) => setColors((current) => current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));

  const result = useMemo(() => {
    const colorTokens = colors.map((entry) => ({ name: kebab(entry.name), value: entry.hex, id: entry.id, raw: entry.name }));
    const spacing = includeSpacing
      ? Array.from({ length: Math.max(1, Math.min(16, Number(spacingSteps) || 8)) }, (unused, index) => ({
        name: String(index + 1),
        value: (Number(spacingBase) || 4) * (index + 1),
      }))
      : [];
    const radii = includeRadius
      ? [0, 1, 2, 3].map((step) => ({ name: String(step), value: (Number(radiusBase) || 4) * step * (step === 0 ? 1 : 1) }))
      : [];
    const type = includeType
      ? [-1, 0, 1, 2, 3, 4, 5].map((step) => {
        const ratio = Number(typeRatio) || 1.25;
        const size = (Number(typeBase) || 16) * Math.pow(ratio, step);
        return { name: step <= 0 ? 'sm' + (step < 0 ? '-1' : '') : 'lg' + step, value: Math.round(size * 100) / 100, size };
      })
      : [];

    const nameOf = (raw, pattern) => {
      const base = pattern.map((part) => (part.startsWith('$') ? { kebab, camel, pascal, snake }[part.slice(1)](raw) : part)).join('');
      return kebab(prefix) ? (prefixPattern(prefix) + base) : base;
    };
    const prefixPattern = (value) => kebab(value) + '-';
    const prefixCamel = (value) => (kebab(value) ? camel(value) : '');

    let output = '';
    if (format === 'css') {
      const lines = [':root {'];
      colorTokens.forEach((token) => lines.push('  --' + nameOf(token.raw, ['$kebab']) + ': ' + token.value + ';'));
      spacing.forEach((token) => lines.push('  --space-' + token.name + ': ' + token.value + 'px;'));
      radii.forEach((token) => lines.push('  --radius' + (token.name === '0' ? '' : '-' + token.name) + ': ' + token.value + 'px;'));
      type.forEach((token) => lines.push('  --font-size-' + token.name + ': ' + token.value + 'px;'));
      lines.push('}');
      output = lines.join('\n');
    } else if (format === 'scss') {
      const lines = ['// Generated design tokens'];
      colorTokens.forEach((token) => lines.push('$' + nameOf(token.raw, ['$kebab']) + ': ' + token.value + ';'));
      spacing.forEach((token) => lines.push('$space-' + token.name + ': ' + token.value + 'px;'));
      radii.forEach((token) => lines.push('$radius-' + token.name + ': ' + token.value + 'px;'));
      type.forEach((token) => lines.push('$font-size-' + token.name + ': ' + token.value + 'px;'));
      output = lines.join('\n');
    } else if (format === 'tailwind') {
      const lines = ['module.exports = {', '  theme: {', '    extend: {'];
      lines.push('      colors: {');
      colorTokens.forEach((token) => lines.push("        '" + nameOf(token.raw, ['$kebab']) + "': '" + token.value + "',"));
      lines.push('      },');
      if (spacing.length) {
        lines.push('      spacing: {');
        spacing.forEach((token) => lines.push("        '" + token.name + "': '" + token.value + "px',"));
        lines.push('      },');
      }
      if (radii.length) {
        lines.push('      borderRadius: {');
        radii.forEach((token) => lines.push("        '" + token.name + "': '" + token.value + "px',"));
        lines.push('      },');
      }
      if (type.length) {
        lines.push('      fontSize: {');
        type.forEach((token) => lines.push("        '" + token.name + "': '" + token.value + "px',"));
        lines.push('      },');
      }
      lines.push('    },', '  },', '};');
      output = lines.join('\n');
    } else if (format === 'json') {
      const document = {
        color: Object.fromEntries(colorTokens.map((token) => [snake(token.raw), { value: token.value, type: 'color' }])),
        space: Object.fromEntries(spacing.map((token) => ['space-' + token.name, { value: token.value + 'px', type: 'dimension' }])),
        radius: Object.fromEntries(radii.map((token) => ['radius-' + token.name, { value: token.value + 'px', type: 'dimension' }])),
        font: Object.fromEntries(type.map((token) => ['size-' + token.name, { value: token.value + 'px', type: 'dimension' }])),
      };
      output = JSON.stringify(document, null, 2);
    } else if (format === 'android') {
      const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>'];
      colorTokens.forEach((token) => lines.push('  <color name="' + nameOf(token.raw, ['$snake']) + '">' + token.value + '</color>'));
      spacing.forEach((token) => lines.push('  <dimen name="space_' + token.name + '">' + token.value + 'dp</dimen>'));
      radii.forEach((token) => lines.push('  <dimen name="radius_' + token.name + '">' + token.value + 'dp</dimen>'));
      type.forEach((token) => lines.push('  <dimen name="font_size_' + token.name + '">' + token.value + 'sp</dimen>'));
      lines.push('</resources>');
      output = lines.join('\n');
    } else {
      const lines = ['import SwiftUI', '', 'public enum DesignTokens {'];
      colorTokens.forEach((token) => lines.push('    public static let ' + nameOf(token.raw, ['$camel']) + ' = Color(hex: "' + token.value + '")'));
      spacing.forEach((token) => lines.push('    public static let space' + token.name + ': CGFloat = ' + token.value));
      radii.forEach((token) => lines.push('    public static let radius' + token.name + ': CGFloat = ' + token.value));
      type.forEach((token) => lines.push('    public static let fontSize' + pascal(token.name) + ': CGFloat = ' + token.value));
      lines.push('}');
      output = lines.join('\n');
    }

    const count = colorTokens.length + spacing.length + radii.length + type.length;
    return { colorTokens, spacing, radii, type, output, count, prefixCamel: prefixCamel(prefix) };
  }, [colors, format, prefix, includeSpacing, spacingBase, spacingSteps, includeRadius, radiusBase, includeType, typeBase, typeRatio]);

  const download = () => {
    const extension = format === 'css' ? 'css' : format === 'scss' ? 'scss' : format === 'tailwind' ? 'js' : format === 'json' ? 'json' : format === 'android' ? 'xml' : 'swift';
    const blob = new Blob([result.output], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'design-tokens.' + extension;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="token-exporter"
      icon={Braces}
      title="Design Token Exporter"
      desc="One palette and scale, exported in the format your project already uses — CSS variables, SCSS, a Tailwind config, JSON tokens, Android XML or Swift."
      state={{ colors, format, prefix, includeSpacing, spacingBase, spacingSteps, includeRadius, radiusBase, includeType, typeBase, typeRatio }}
      onRestore={(restored) => {
        if (Array.isArray(restored.colors) && restored.colors.length) setColors(restored.colors);
        if (restored.format) setFormat(restored.format);
        if (typeof restored.prefix === 'string') setPrefix(restored.prefix);
        if (restored.includeSpacing !== undefined) setIncludeSpacing(!!restored.includeSpacing);
        if (restored.spacingBase !== undefined) setSpacingBase(String(restored.spacingBase));
        if (restored.spacingSteps !== undefined) setSpacingSteps(String(restored.spacingSteps));
        if (restored.includeRadius !== undefined) setIncludeRadius(!!restored.includeRadius);
        if (restored.radiusBase !== undefined) setRadiusBase(String(restored.radiusBase));
        if (restored.includeType !== undefined) setIncludeType(!!restored.includeType);
        if (restored.typeBase !== undefined) setTypeBase(String(restored.typeBase));
        if (restored.typeRatio !== undefined) setTypeRatio(String(restored.typeRatio));
      }}
      exportText={result.output}
      exportName="design-tokens.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Colours</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.colorTokens.length} tokens</span>
        </div>
        <div className="space-y-2">
          {colors.map((entry) => (
            <div key={entry.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <Field label="Name"><input value={entry.name} onChange={(e) => set(entry.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Value"><input value={entry.hex} onChange={(e) => set(entry.id, 'hex', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Pick">
                <input type="color" value={entry.hex} onChange={(e) => set(entry.id, 'hex', e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
              </Field>
              <div className="flex items-end gap-2">
                <span className="font-mono-j text-[11px] text-muted-foreground">{kebab(entry.name)}</span>
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Scales</div>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Include spacing">
                <Seg value={includeSpacing ? 'yes' : 'no'} onChange={(value) => setIncludeSpacing(value === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
              </Field>
              <Field label="Base unit, px"><input value={spacingBase} onChange={(e) => setSpacingBase(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Steps"><input value={spacingSteps} onChange={(e) => setSpacingSteps(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Include radius">
                <Seg value={includeRadius ? 'yes' : 'no'} onChange={(value) => setIncludeRadius(value === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
              </Field>
              <Field label="Radius step, px"><input value={radiusBase} onChange={(e) => setRadiusBase(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Include type scale">
                <Seg value={includeType ? 'yes' : 'no'} onChange={(value) => setIncludeType(value === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
              </Field>
              <Field label="Base size, px"><input value={typeBase} onChange={(e) => setTypeBase(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Ratio">
                <select value={typeRatio} onChange={(e) => setTypeRatio(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs">
                  {TYPE_RATIOS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Output format and naming</div>
          <Seg value={format} onChange={setFormat} options={FORMATS.slice(0, 3)} />
          <div className="mt-2">
            <Seg value={format} onChange={setFormat} options={FORMATS.slice(3)} />
          </div>
          <div className="mt-3">
            <Field label="Prefix, optional">
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="acme" className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Names are normalised per format: kebab-case for CSS, SCSS and Tailwind, snake_case for JSON and Android, camelCase for Swift. A prefix of {prefix || 'none'} produces
            {' '}{nameOfPreview(prefix, colors)} as the first key.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Tokens generated"
          value={String(result.count)}
          sub={result.colorTokens.length + ' colours, ' + result.spacing.length + ' spacing steps, ' + result.radii.length + ' radii and ' + result.type.length + ' type sizes — all from this one screen, in ' + (FORMATS.find((entry) => entry.value === format) || {}).label + ' format.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Swatches</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {result.colorTokens.map((token) => (
              <div key={token.id} className="overflow-hidden rounded-lg border border-border/60">
                <div className="h-10" style={{ backgroundColor: token.value }} />
                <div className="px-1.5 py-1">
                  <div className="truncate font-mono-j text-[10px]">{kebab(token.raw)}</div>
                  <div className="font-mono-j text-[9px] text-muted-foreground">{token.value}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">{(FORMATS.find((entry) => entry.value === format) || {}).label}</span>
          <div className="flex gap-2">
            <CopyBtn value={result.output} label="Copy" />
            <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              Download
            </button>
          </div>
        </div>
        <pre className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.output}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why tokens rather than values</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· One decision in one place. Changing the brand colour later is a single edit rather than a search through every component.</p>
            <p>· Names carry meaning: primary, surface, muted. The hex value is an implementation detail that will change.</p>
            <p>· The same set feeds web, Android and iOS, so the palette cannot drift between platforms.</p>
            <p>· Designers and developers argue less when the vocabulary is shared and written down.</p>
            <p>· Theme switching, dark mode and high-contrast variants all become a second set of the same names.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Naming that survives contact with a codebase</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Prefer semantic over literal: name a token by where it is used, not what it looks like, or a rebrand renames everything.</p>
            <p>· Keep one naming convention across formats. Machines normalise case; humans still have to read it.</p>
            <p>· Do not encode the value in the name. A token called blue-500 that is green after a rebrand is a permanent trap.</p>
            <p>· Add a prefix when tokens could collide with anything else in the project, which is most of the time in a large codebase.</p>
            <p>· Ship the file from source control rather than copying it around, so there is exactly one version of the truth.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Tokens', value: String(result.count) },
                { label: 'Format', value: format },
                { label: 'Prefix', value: prefix || 'none' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Colours" value={String(result.colorTokens.length)} mono />
        <Stat label="Spacing" value={String(result.spacing.length)} mono sub={spacingBase + 'px base'} />
        <Stat label="Radii" value={String(result.radii.length)} mono sub={radiusBase + 'px step'} />
        <Stat label="Type sizes" value={String(result.type.length)} mono sub={'ratio ' + typeRatio} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything is generated from the values on this screen, so the swatches, the token count and the exported file always describe the same design system. Values of
          other types — shadows, motion easing, breakpoints — are deliberately left out so the output stays short enough to review properly.
        </p>
      </Panel>
    </ToolShell>
  );
}

const nameOfPreview = (prefix, colors) => {
  const first = colors[0] && colors[0].name ? colors[0].name : 'primary';
  return (prefix ? prefix : '') + (prefix ? '-' : '') + kebab(first);
};