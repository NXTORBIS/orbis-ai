import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ToolHeader, Area, Stat, Panel, CopyBtn, Out } from './shared';
import ToolShell from './kit/ToolShell';

const CATEGORY = (char) => {
  if (/\s/.test(char)) return 'Whitespace';
  if (/[a-z]/.test(char)) return 'Lowercase letter';
  if (/[A-Z]/.test(char)) return 'Uppercase letter';
  if (/[0-9]/.test(char)) return 'Digit';
  if (/[\u0300-\u036f]/.test(char)) return 'Combining mark';
  if (/[\u200b-\u200f\u2060\ufeff]/.test(char)) return 'Invisible / zero-width';
  if (/[!-/:-@[-`{-~]/.test(char)) return 'Punctuation or symbol';
  return 'Symbol / other script';
};

const utf8Bytes = (char) => Array.from(new TextEncoder().encode(char)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

export default function TextInspector() {
  const [text, setText] = useState('Café ☕ — 2 spaces  here');

  const rows = useMemo(() => Array.from(text).map((char, i) => {
    const code = char.codePointAt(0);
    return {
      index: i,
      char,
      category: CATEGORY(char),
      hex: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
      dec: code,
      bytes: utf8Bytes(char),
      html: code > 126 ? `&#${code};` : char.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      js: code > 126 || code < 32 ? `\\u${code.toString(16).toUpperCase().padStart(4, '0')}` : char === "'" ? "\\'" : char === '\\' ? '\\\\' : char,
    };
  }), [text]);

  const summary = useMemo(() => {
    const visible = rows.filter((r) => r.category !== 'Invisible / zero-width');
    return {
      codePoints: rows.length,
      units: text.length,
      bytes: new TextEncoder().encode(text).length,
      nonAscii: rows.filter((r) => r.dec > 126).length,
      invisible: rows.length - visible.length,
      emoji: Array.from(text).filter((c) => /\p{Extended_Pictographic}/u.test(c)).length,
      categories: [...new Set(rows.map((r) => r.category))].length,
    };
  }, [rows, text]);

  const escapes = {
    json: JSON.stringify(text),
    unicode: Array.from(text).map((c) => (c.codePointAt(0) > 126 ? `\\u${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : c)).join(''),
    html: rows.map((r) => r.html).join(''),
    url: encodeURIComponent(text),
    hex: Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, '0')).join(' '),
    binary: Array.from(new TextEncoder().encode(text)).map((b) => b.toString(2).padStart(8, '0')).join(' '),
  };

  return (
    <ToolShell
      toolId="text-inspector"
      icon={Search}
      title="Character & Encoding Inspector"
      desc="See exactly what is inside a string — code points, UTF-8 bytes and escape forms."
      state={{ text }}
      onRestore={(saved) => { if (saved.text !== undefined) setText(saved.text); }}
      exportText={JSON.stringify({ summary, rows }, null, 2)}
      exportName="characters.json"
      exportMime="application/json"
    >
      <Area value={text} onChange={setText} rows={3} placeholder="Paste text to inspect…" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Code points" value={String(summary.codePoints)} />
        <Stat label="UTF-16 units" value={String(summary.units)} />
        <Stat label="UTF-8 bytes" value={String(summary.bytes)} />
        <Stat label="Non-ASCII" value={String(summary.nonAscii)} />
        <Stat label="Invisible characters" value={String(summary.invisible)} />
        <Stat label="Emoji" value={String(summary.emoji)} />
        <Stat label="Character types" value={String(summary.categories)} />
        <Stat label="Lines" value={String(text.split('\n').length)} />
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Character by character {rows.length > 200 ? '(first 200)' : ''}</div>
        <div className="max-h-80 overflow-auto scrollbar-thin">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1 font-medium">#</th>
                <th className="px-2 py-1 font-medium">Char</th>
                <th className="px-2 py-1 font-medium">Code point</th>
                <th className="px-2 py-1 font-medium">Dec</th>
                <th className="px-2 py-1 font-medium">UTF-8</th>
                <th className="px-2 py-1 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.index} className="border-t border-border/40">
                  <td className="px-2 py-1 text-muted-foreground">{r.index}</td>
                  <td className="px-2 py-1 font-mono-j">{r.category === 'Invisible / zero-width' ? '␀' : r.char === ' ' ? '␣' : r.char}</td>
                  <td className="px-2 py-1 font-mono-j text-cyan-j">{r.hex}</td>
                  <td className="px-2 py-1 font-mono-j">{r.dec}</td>
                  <td className="px-2 py-1 font-mono-j text-muted-foreground">{r.bytes}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="space-y-2">
        <Out label="JSON string" value={escapes.json}><pre className="break-all font-mono-j text-[11px]">{escapes.json}</pre></Out>
        <Out label="Unicode escapes" value={escapes.unicode}><pre className="break-all font-mono-j text-[11px]">{escapes.unicode}</pre></Out>
        <Out label="HTML entities" value={escapes.html}><pre className="break-all font-mono-j text-[11px]">{escapes.html}</pre></Out>
        <Out label="URL encoded" value={escapes.url}><pre className="break-all font-mono-j text-[11px]">{escapes.url}</pre></Out>
        <Out label="Hex bytes" value={escapes.hex}><pre className="break-all font-mono-j text-[11px]">{escapes.hex}</pre></Out>
        <Out label="Binary" value={escapes.binary}><pre className="break-all font-mono-j text-[11px]">{escapes.binary}</pre></Out>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={escapes.unicode} label="Copy escapes" />
        <CopyBtn value={escapes.json} label="Copy JSON" />
      </div>
    </ToolShell>
  );
}