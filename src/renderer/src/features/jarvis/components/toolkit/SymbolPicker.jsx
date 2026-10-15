import { useMemo, useState } from 'react';
import { Omega, Search, Star, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat, useCopy } from './shared';

const GROUPS = [
  { id: 'arrows', label: 'Arrows', chars: '←↑→↓↔↕⇐⇒⇔↖↗↘↙↺↻⟲⟳⇄⇅⇆⇋⇌⟨⟩«»‹›➔➜➝➞➟➠➡➢➣➤➥➦➧➨➩➪➫➬➭➮➯➱➲➳➵➸➺➻➼➽➾⇧⇩⤴⤵⤶⤷↩↪⏎⌂⌘⌥⌫⌦⏏' },
  { id: 'math', label: 'Math', chars: '±×÷−∓≈≠≡≤≥≪≫∞∅∝∴∵∑∏∫∬∮√∛∜∂∇∆∈∉∋∌⊂⊃⊆⊇∪∩∧∨¬⊕⊗⊙⊘⊛⊥∠∟⊿∴°′″‱‰℅№℮ℏ℧ℑℜℓµπτφθλ∆ΩΣΠΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΡΤΥΦΧΨΩαβγδεζηθικλμνξοπρςστυφχψω' },
  { id: 'currency', label: 'Currency', chars: '€£¥₹₩₪₫₴₦₲₵₡₱₭₮₸₺₼₽₾₿¢₠₢₣₤₥₧₨₯₰₳₶₷₻₿ ﷼ ৳ ฿ ៛ ₠ ₡ ₢ ₣ ₤ ₥ ₦ ₧ ₨ ₩ ₪ ₫ € ₭ ₮ ₯ ₰ ₱ ₲ ₳ ₴ ₵ ₶ ₷ ₸ ₹ ₺ ₻ ₼ ₽ ₾ ₿' },
  { id: 'shapes', label: 'Shapes', chars: '●○◐◑◒◓◔◕◖◗◘◙◚◛◜◝◞◟◠◡◦◧◨◩◪◫◬◭◮◯▲△▼▽◀◁▶▷◆◇◈◉◊○◌◍◎★☆✦✧✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽❂❖❘❙❚▪▫▬▭▮▯▰▱■□▢▣▤▥▦▧▨▩▪▫♦♠♣♥♤♡♧♢◆⬢⬡⬣⬤⬥⬦⬧⬨⬩⬪⬫⬬⬭⬮⬯' },
  { id: 'marks', label: 'Marks', chars: '✓✔✕✖✗✘☑☒☓✚✛✜✝✞✟❌❎✅⚠⚡☠☢☣⚑⚐⚔⚖⚗⚙⚛⚜♻♼♽⚕␀␁␂␃␄␅␆␇␈␉␊␋␌␍␎␏␐␑␒␓␔␕␖␗␘␙␚␛␜␝␞␟' },
  { id: 'lines', label: 'Lines & Box', chars: '─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬━┃┏┓┗┛┣┫┳┻╋┠┨┯┷┿╱╲╳╴╵╶╷▔▕▏▎▍▌▋▊▉█▓▒░▁▂▃▄▅▆▇▀▄▐▌·•‣⁃◦∙▪▫' },
  { id: 'typeset', label: 'Typeset', chars: '“”‘’‚„«»‹›–—―…‽?!¡¿§¶†‡*№⁂⁑⁕⁜⁘⁙⁂☙❧♪♫♬♭♮♯♩†‡◊※⁕♨☏☎✉✂✃✄⚑‱‰′″‴⁗⁙⁘⁜⁝⁞№℅™®©℠☞☜☝☟' },
  { id: 'super', label: 'Powers & Fracs', chars: '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ°ⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅟↉' },
  { id: 'check', label: 'Bullets', chars: '•‣⁃⁌⁍◦⦾⦿▪▫▸▹►▻◂◃○●◉◎◍⁕❖＊✱✳✽∙⋅⸱‧・●◘◙❥♥★☆✓➤➔→»›' },
];

const PALETTES = [
  { id: 'aurora', label: 'Aurora', colors: ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'] },
  { id: 'ink', label: 'Ink', colors: ['#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1'] },
  { id: 'sunset', label: 'Sunset', colors: ['#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#f59e0b'] },
  { id: 'forest', label: 'Forest', colors: ['#065f46', '#059669', '#10b981', '#84cc16', '#facc15'] },
];

export default function SymbolPicker() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [picked, setPicked] = useState('');
  const [favourites, setFavourites] = useState([]);
  const { copy, copied } = useCopy();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = group === 'all' ? GROUPS : GROUPS.filter((g) => g.id === group);
    if (!q) return list;
    return list
      .map((g) => {
        const chars = [...g.chars.replace(/\s+/g, '')];
        const match = chars.filter((ch) => {
          const code = ch.codePointAt(0).toString(16);
          const name = ch.codePointAt(0) >= 32 ? ch : '';
          return name.includes(q) || code.includes(q) || `u+${code}`.includes(q);
        });
        const words = g.label.toLowerCase().includes(q) || g.id.includes(q) ? chars : match;
        return { ...g, chars: words.join('') };
      })
      .filter((g) => g.chars.length);
  }, [query, group]);

  const total = useMemo(() => GROUPS.reduce((sum, g) => sum + g.chars.replace(/\s+/g, '').length, 0), []);
  const shown = groups.reduce((sum, g) => sum + [...new Set(g.chars.replace(/\s+/g, ''))].length, 0);

  const add = (ch) => {
    setPicked((current) => current + ch);
  };

  const toggleFavourite = (ch) => {
    setFavourites((current) => (current.includes(ch) ? current.filter((c) => c !== ch) : [ch, ...current].slice(0, 40)));
  };

  return (
    <ToolShell
      toolId="symbols"
      icon={Omega}
      title="Symbol & Unicode Picker"
      desc="Every arrow, currency mark, mathematical sign and box-drawing glyph you keep hunting for — click to build a string, then copy it."
      state={{ picked, favourites }}
      onRestore={(restored) => {
        if (typeof restored.picked === 'string') setPicked(restored.picked);
        if (Array.isArray(restored.favourites)) setFavourites(restored.favourites);
      }}
      exportText={picked}
      exportName="symbols.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[190px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by glyph, code or group (try 20ac or arrow)"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm"
          />
        </div>
        <CopyBtn value={picked} label="Copy string" />
        <button
          type="button"
          onClick={() => setPicked('')}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </button>
      </div>

      <Field label="Group">
        <div className="flex flex-wrap gap-1.5">
          {[{ id: 'all', label: 'All' }, ...GROUPS].map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                group === g.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </Field>

      {!!favourites.length && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <Star className="h-3.5 w-3.5 fill-current text-cyan-j" /> Starred
          </div>
          <div className="flex flex-wrap gap-1.5">
            {favourites.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => add(ch)}
                onDoubleClick={() => toggleFavourite(ch)}
                title="Click to add · double-click to unstar"
                className="tk-card h-9 w-9 rounded-lg border border-cyan-j/40 bg-card/60 text-base"
              >
                {ch}
              </button>
            ))}
          </div>
        </Panel>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <Panel key={g.id} className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">{g.label}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{[...new Set(g.chars.replace(/\s+/g, ''))].length} glyphs</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {[...new Set(g.chars.replace(/\s+/g, ''))].map((ch) => (
                <button
                  key={`${g.id}-${ch}`}
                  type="button"
                  onClick={() => add(ch)}
                  onContextMenu={(e) => { e.preventDefault(); toggleFavourite(ch); }}
                  title={`U+${ch.codePointAt(0).toString(16).toUpperCase()} · click to add · right-click to star`}
                  className="group relative grid h-9 w-9 place-items-center rounded-lg border border-border/60 bg-card/40 text-base transition hover:border-cyan-j/50 hover:bg-cyan-j/10 hover:text-cyan-j"
                >
                  {ch}
                  {favourites.includes(ch) && <Star className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 fill-current text-cyan-j" />}
                </button>
              ))}
            </div>
          </Panel>
        ))}
        {!groups.length && <Panel className="text-[11px] text-muted-foreground">Nothing matched “{query}”. Try a code like 2022 or 00a9.</Panel>}
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Your string</span>
          {copied && <span className="text-[10px] text-cyan-j">copied</span>}
        </div>
        <div className="min-h-[62px] break-all rounded-lg border border-border/70 bg-card/60 p-3 text-lg">{picked || <span className="text-sm text-muted-foreground">Click any glyph above to collect it here — the string is what gets copied.</span>}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => copy(picked)} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/20">
            Copy {picked.length} character{picked.length === 1 ? '' : 's'}
          </button>
          <button type="button" onClick={() => setPicked(picked.slice(0, -1))} disabled={!picked} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/40 disabled:opacity-40">
            Remove last
          </button>
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Glyphs in library" value={String(total)} mono />
        <Stat label="Shown now" value={String(shown)} mono />
        <Stat label="Starred" value={String(favourites.length)} mono sub="right-click a glyph" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Right-click any glyph to star it for quick access, and hover to see its Unicode code point. Because these are real Unicode characters and
          not images, they keep their shape in names, bios, documents and spreadsheets — as long as the font on the other end covers them.
        </p>
      </Panel>
    </ToolShell>
  );
}