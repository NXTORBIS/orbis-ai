import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { ToolHeader, Area, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const A = 65;
const a = 97;

const mathStyle = ({ u, l, d, uExceptions = {}, lExceptions = {} }) => (char) => {
  const code = char.codePointAt(0);
  if (code >= A && code <= A + 25) {
    const i = code - A;
    return String.fromCodePoint(uExceptions[i] ?? u + i);
  }
  if (code >= a && code <= a + 25) {
    const i = code - a;
    return String.fromCodePoint(lExceptions[i] ?? l + i);
  }
  if (d && code >= 48 && code <= 57) return String.fromCodePoint(d + (code - 48));
  return char;
};

const CIRCLED = (char) => {
  const code = char.codePointAt(0);
  if (code >= A && code <= A + 25) return String.fromCodePoint(0x24b6 + (code - A));
  if (code >= a && code <= a + 25) return String.fromCodePoint(0x24d0 + (code - a));
  if (code === 48) return '⓪';
  if (code >= 49 && code <= 57) return String.fromCodePoint(0x2460 + (code - 49));
  return char;
};

const FULLWIDTH = (char) => {
  const code = char.codePointAt(0);
  if (code >= A && code <= A + 25) return String.fromCodePoint(0xff21 + (code - A));
  if (code >= a && code <= a + 25) return String.fromCodePoint(0xff41 + (code - a));
  if (code >= 48 && code <= 57) return String.fromCodePoint(0xff10 + (code - 48));
  return char;
};

const SMALL_CAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘ?ʀꜱᴛᴜᴠᴡ?ʏᴢ';
const SUPERSCRIPT = 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖ?ʳˢᵗᵘᵛʷˣʸᶻ';
const FLIP = 'ɐqɔpǝɟƃɥıɾʞlɯuodbɹsʇnʌʍxʎz';

const fromTable = (table) => (char) => {
  const code = char.toLowerCase().codePointAt(0);
  if (code < 97 || code > 122) return char;
  const mapped = table[code - 97];
  return mapped === '?' ? char : mapped;
};

const UPSIDE_PUNCT = { '?': '¿', '!': '¡', '.': '˙', ',': "'", "'": ',', '"': '„', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '&': '⅋', '_': '‾' };

const STYLES = [
  ['Bold', mathStyle({ u: 0x1d400, l: 0x1d41a, d: 0x1d7ce })],
  ['Italic', mathStyle({ u: 0x1d434, l: 0x1d44e, lExceptions: { 7: 0x210e } })],
  ['Bold italic', mathStyle({ u: 0x1d468, l: 0x1d482 })],
  ['Script', mathStyle({ u: 0x1d49c, l: 0x1d4b6, uExceptions: { 1: 0x212c, 4: 0x2130, 5: 0x2131, 7: 0x210b, 8: 0x2110, 11: 0x2112, 12: 0x2133, 17: 0x211b }, lExceptions: { 4: 0x212f, 6: 0x210a, 14: 0x2134 } })],
  ['Fraktur', mathStyle({ u: 0x1d504, l: 0x1d51e, uExceptions: { 2: 0x212d, 7: 0x210c, 8: 0x2111, 17: 0x211c, 25: 0x2128 } })],
  ['Double-struck', mathStyle({ u: 0x1d538, l: 0x1d552, d: 0x1d7d8, uExceptions: { 2: 0x2102, 7: 0x210d, 13: 0x2115, 15: 0x2119, 16: 0x211a, 17: 0x211d, 25: 0x2124 } })],
  ['Monospace', mathStyle({ u: 0x1d670, l: 0x1d68a, d: 0x1d7f6 })],
  ['Circled', CIRCLED],
  ['Full width', FULLWIDTH],
  ['Small caps', fromTable(SMALL_CAPS)],
  ['Superscript', fromTable(SUPERSCRIPT)],
  ['Upside down', (char) => UPSIDE_PUNCT[char] ?? fromTable(FLIP)(char)],
  ['Struck through', (char) => `${char}\u0336`],
  ['Underlined', (char) => `${char}\u0332`],
];

export default function CoolText() {
  const [text, setText] = useState('Mark32');

  const render = (fn) => {
    const mapped = Array.from(text).map(fn).join('');
    return fn === STYLES[11][1] ? Array.from(mapped).reverse().join('') : mapped;
  };

  return (
    <ToolShell
      toolId="fancy-text"
      icon={Wand2}
      title="Fancy Text Generator"
      desc="Fourteen unicode styles for names, bios and social posts — tap any row to copy."
      state={{ text }}
      onRestore={(saved) => { if (saved.text !== undefined) setText(saved.text); }}
    >
      <Area value={text} onChange={setText} rows={3} placeholder="Type a name or short phrase…" />
      <div className="space-y-2">
        {STYLES.map(([label, fn]) => {
          const value = render(fn);
          return (
            <div key={label} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                <div className="mt-0.5 break-words text-base leading-snug">{value}</div>
              </div>
              <CopyBtn value={value} label="" />
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">These styles use real unicode characters, so they paste anywhere text is allowed. Some apps render a few of them as boxes — the plain styles (bold, italic, monospace) are the safest.</p>
    </ToolShell>
  );
}