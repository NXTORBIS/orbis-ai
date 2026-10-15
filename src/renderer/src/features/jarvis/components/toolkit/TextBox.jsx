import { useMemo, useState } from 'react';
import { Type } from 'lucide-react';
import { ToolHeader, Area, Field, Seg, Out, CopyBtn, Stat, ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const BORDERS = [
  { value: 'single', label: 'Single', c: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' } },
  { value: 'double', label: 'Double', c: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' } },
  { value: 'rounded', label: 'Rounded', c: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' } },
  { value: 'heavy', label: 'Heavy', c: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' } },
  { value: 'dashed', label: 'Dashed', c: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '╌', v: '╎' } },
  { value: 'dots', label: 'Dots', c: { tl: '.', tr: '.', bl: "'", br: "'", h: '.', v: ':' } },
  { value: 'stars', label: 'Stars', c: { tl: '*', tr: '*', bl: '*', br: '*', h: '*', v: '*' } },
  { value: 'hash', label: 'Hash', c: { tl: '#', tr: '#', bl: '#', br: '#', h: '#', v: '#' } },
];

const wrap = (text, width) => {
  const lines = [];
  text.split('\n').forEach((paragraph) => {
    let line = '';
    paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else { lines.push(line); line = word; }
      while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
    });
    lines.push(line);
  });
  return lines;
};

export default function TextBox() {
  const [text, setText] = useState('Mark32\nYour personal operating system');
  const [style, setStyle] = useState('rounded');
  const [width, setWidth] = useState(44);
  const [padding, setPadding] = useState(1);
  const [align, setAlign] = useState('left');
  const [upper, setUpper] = useState(false);

  const box = useMemo(() => {
    const border = BORDERS.find((b) => b.value === style).c;
    const normalized = upper ? text.toUpperCase() : text;
    const lines = wrap(normalized, width);
    const inner = width + padding * 2;
    const pad = ' '.repeat(padding);
    const body = lines.map((line) => {
      const trimmed = line.slice(0, width);
      const space = width - trimmed.length;
      const left = align === 'right' ? space : align === 'center' ? Math.floor(space / 2) : 0;
      return `${border.v}${pad}${' '.repeat(left)}${trimmed}${' '.repeat(space - left)}${pad}${border.v}`;
    });
    return [
      `${border.tl}${border.h.repeat(inner)}${border.tr}`,
      ...(padding ? [`${border.v}${' '.repeat(inner)}${border.v}`] : []),
      ...body,
      ...(padding ? [`${border.v}${' '.repeat(inner)}${border.v}`] : []),
      `${border.bl}${border.h.repeat(inner)}${border.br}`,
    ].join('\n');
  }, [text, style, width, padding, align, upper]);

  const asciiOnly = useMemo(() => {
    const border = BORDERS.find((b) => b.value === style).c;
    const ascii = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
    if (Object.values(border).every((ch) => ch.charCodeAt(0) < 128)) return box;
    const lines = box.split('\n').map((line) => asciiLine(line, ascii));
    return lines.join('\n');
  }, [box, style]);

  function asciiLine(line, ascii) {
    return line
      .replace(/^./, ascii.tl)
      .replace(/.$/, ascii.tr)
      .replace(/[─═━╌]/g, ascii.h)
      .replace(/[│║┃╎:]/g, ascii.v);
  }

  return (
    <ToolShell
      toolId="text-box"
      icon={Type}
      title="Text Box & Banner"
      desc="Wrap a message in a tidy unicode frame for READMEs, commit notes and plain-text docs."
      state={{ text, style, width, padding, align, upper }}
      onRestore={(saved) => { setText(saved.text); setStyle(saved.style); setWidth(saved.width); setPadding(saved.padding); setAlign(saved.align); setUpper(saved.upper); }}
      exportText={box}
      exportName="banner.txt"
    >
      <Area value={text} onChange={setText} rows={4} placeholder="Type the message — new lines are kept" />
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Frame</span>
        <Seg value={style} onChange={setStyle} options={BORDERS.map(({ value, label }) => ({ value, label }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Width · ${width} characters`}>
          <input type="range" min={16} max={80} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Padding · ${padding} characters`}>
          <input type="range" min={0} max={4} value={padding} onChange={(e) => setPadding(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Text alignment">
          <Seg value={align} onChange={setAlign} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
        </Field>
      </div>
      <ToggleRow label="Uppercase the text" checked={upper} onChange={setUpper} />
      <Out label="Framed text" value={box}>
        <pre className="overflow-x-auto whitespace-pre font-mono-j text-xs text-cyan-j scrollbar-thin">{box}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Lines" value={String(box.split('\n').length)} />
        <Stat label="Box width" value={`${box.split('\n')[0].length} chars`} />
        <Stat label="Characters" value={String(box.length)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={box} label="Copy box" />
        <CopyBtn value={asciiOnly} label="Copy ASCII-only" />
      </div>
      <p className="text-[11px] text-muted-foreground">ASCII-only swaps the unicode frame for +, - and | characters, for tools that struggle with box drawing.</p>
    </ToolShell>
  );
}