import { useMemo, useState } from 'react';
import { Hash, Search } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Panel, Seg, Stat, useCopy } from './shared';

const CONTROL_NAMES = 'NUL,SOH,STX,ETX,EOT,ENQ,ACK,BEL,BS,HT,LF,VT,FF,CR,SO,SI,DLE,DC1,DC2,DC3,DC4,NAK,SYN,ETB,CAN,EM,SUB,ESC,FS,GS,RS,US'.split(',');
const NAMED = {
  32: 'Space', 33: 'Exclamation mark', 34: 'Quotation mark', 35: 'Number sign', 36: 'Dollar sign', 37: 'Percent sign', 38: 'Ampersand',
  39: 'Apostrophe', 40: 'Left parenthesis', 41: 'Right parenthesis', 42: 'Asterisk', 43: 'Plus sign', 44: 'Comma', 45: 'Hyphen-minus',
  46: 'Full stop', 47: 'Solidus', 58: 'Colon', 59: 'Semicolon', 60: 'Less-than sign', 61: 'Equals sign', 62: 'Greater-than sign',
  63: 'Question mark', 64: 'Commercial at', 91: 'Left square bracket', 92: 'Reverse solidus', 93: 'Right square bracket',
  94: 'Circumflex accent', 95: 'Low line', 96: 'Grave accent', 123: 'Left curly bracket', 124: 'Vertical line', 125: 'Right curly bracket',
  126: 'Tilde', 127: 'Delete', 160: 'No-break space', 169: 'Copyright sign', 174: 'Registered sign', 176: 'Degree sign',
  177: 'Plus-minus sign', 181: 'Micro sign', 183: 'Middle dot', 215: 'Multiplication sign', 247: 'Division sign', 8364: 'Euro sign',
  8377: 'Indian rupee sign', 163: 'Pound sign', 165: 'Yen sign', 162: 'Cent sign', 8212: 'Em dash', 8211: 'En dash', 8230: 'Horizontal ellipsis',
  8216: 'Left single quote', 8217: 'Right single quote', 8220: 'Left double quote', 8221: 'Right double quote', 8226: 'Bullet',
  8593: 'Upwards arrow', 8595: 'Downwards arrow', 8592: 'Leftwards arrow', 8594: 'Rightwards arrow', 8730: 'Square root',
  8734: 'Infinity', 8800: 'Not equal to', 8804: 'Less-than or equal', 8805: 'Greater-than or equal', 931: 'Greek capital sigma',
  960: 'Greek small pi', 937: 'Greek capital omega',
};

const RANGES = [
  { id: 'ascii', label: 'ASCII 0–127', from: 0, to: 127 },
  { id: 'print', label: 'Keyboard 32–126', from: 32, to: 126 },
  { id: 'latin', label: 'Latin-1 160–255', from: 160, to: 255 },
  { id: 'math', label: 'Math 8704–8967', from: 8704, to: 8967 },
  { id: 'arrows', label: 'Arrows 8592–8703', from: 8592, to: 8703 },
];

const ENTITIES = { 34: '&quot;', 38: '&amp;', 39: '&apos;', 60: '&lt;', 62: '&gt;', 160: '&nbsp;', 169: '&copy;', 174: '&reg;' };

const nameFor = (code) => {
  if (code < 32 || code === 127) return CONTROL_NAMES[code < 32 ? code : 31] === undefined ? '' : (code === 127 ? 'DEL' : CONTROL_NAMES[code]);
  if (code === 127) return 'DEL';
  if (NAMED[code]) return NAMED[code];
  if (code >= 48 && code <= 57) return `Digit ${code - 48}`;
  if (code >= 65 && code <= 90) return `Latin capital letter ${String.fromCharCode(code)}`;
  if (code >= 97 && code <= 122) return `Latin small letter ${String.fromCharCode(code)}`;
  if (code >= 160 && code <= 255) return 'Latin-1 character';
  return '';
};

export default function AsciiTable() {
  const [range, setRange] = useState('print');
  const [query, setQuery] = useState('');
  const { copy, copied } = useCopy();

  const rows = useMemo(() => {
    const found = RANGES.find((r) => r.id === range) || RANGES[1];
    const all = [];
    for (let code = found.from; code <= found.to; code += 1) {
      all.push({
        code,
        char: String.fromCodePoint(code),
        hex: code.toString(16).toUpperCase().padStart(2, '0'),
        oct: code.toString(8),
        bin: code.toString(2).padStart(code > 255 ? 16 : 8, '0'),
        html: ENTITIES[code] || `&#${code};`,
        name: nameFor(code),
      });
    }
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) =>
      row.char.toLowerCase() === q ||
      String(row.code) === q ||
      row.hex.toLowerCase().replace(/^0x/, '') === q.replace(/^0x/, '') ||
      row.name.toLowerCase().includes(q) ||
      `u+${row.hex}`.toLowerCase() === q,
    );
  }, [range, query]);

  const preview = rows.slice(0, 400);

  return (
    <ToolShell
      toolId="ascii-table"
      icon={Hash}
      title="ASCII & Unicode Table"
      desc="The code for every character — decimal, hex, octal, binary, HTML entity and its name — searchable by the character itself."
      state={{ range, query }}
      onRestore={(restored) => {
        if (restored.range) setRange(restored.range);
        if (typeof restored.query === 'string') setQuery(restored.query);
      }}
      exportText={rows.map((r) => `${r.code}\t0x${r.hex}\t${r.char}\t${r.html}\t${r.name}`).join('\n')}
      exportName="ascii-table.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.id, label: r.label }))} />
        {copied && <span className="text-[10px] text-cyan-j">copied</span>}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a character, 233, 0xE9, U+20AC or &quot;copyright&quot;"
          className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm"
        />
      </div>

      <div className="tk-card tk-depth max-h-[30rem] overflow-auto rounded-xl border border-border/70 bg-card/40">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Char</th>
              <th className="px-3 py-2">Dec</th>
              <th className="px-3 py-2">Hex</th>
              <th className="px-3 py-2">Oct</th>
              <th className="px-3 py-2">Bin</th>
              <th className="px-3 py-2">HTML</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="font-mono-j text-[11px]">
            {preview.map((row) => (
              <tr key={row.code} className="border-t border-border/40 hover:bg-accent/40">
                <td className="px-3 py-1.5 text-base">{row.char === ' ' ? '␠' : row.char}</td>
                <td className="px-3 py-1.5">{row.code}</td>
                <td className="px-3 py-1.5">{row.hex}</td>
                <td className="px-3 py-1.5">{row.oct}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{row.bin}</td>
                <td className="px-3 py-1.5">{row.html}</td>
                <td className="px-3 py-1.5 font-body text-muted-foreground">{row.name}</td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => copy(row.char)}
                    className="rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
                  >
                    copy
                  </button>
                </td>
              </tr>
            ))}
            {!preview.length && (
              <tr>
                <td colSpan={8} className="px-3 py-4 font-body text-[11px] text-muted-foreground">No code point matched that search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={`U+${(rows[0]?.hex || '')}`} label="Copy first hex" />
        <span className="text-[11px] text-muted-foreground">
          Showing {preview.length} of {rows.length} code points{rows.length > 400 ? ' — search to narrow it down' : ''}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Range" value={(RANGES.find((r) => r.id === range) || RANGES[1]).label} />
        <Stat label="Matches" value={String(rows.length)} mono />
        <Stat label="Copy as" value="char / hex" mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Useful when a CSV will not open because of a stray non-breaking space, when a JSON feed returns a control character, or when you need the
          escape for a symbol you cannot type. Copy the character itself, or its HTML entity for a template.
        </p>
      </Panel>
    </ToolShell>
  );
}