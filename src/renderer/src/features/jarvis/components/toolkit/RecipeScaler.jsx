import { useMemo, useState } from 'react';
import { Utensils } from 'lucide-react';
import { ToolHeader, Area, Field, Seg, Out, CopyBtn, Stat, Panel, ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)\s*/;

const parseAmount = (raw) => {
  const text = raw.trim();
  if (/^\d+\s+\d+\/\d+$/.test(text)) {
    const [whole, frac] = text.split(/\s+/);
    const [n, d] = frac.split('/').map(Number);
    return Number(whole) + n / d;
  }
  if (/^\d+\/\d+$/.test(text)) {
    const [n, d] = text.split('/').map(Number);
    return n / d;
  }
  return Number(text);
};

const toFraction = (value, denominators = [2, 3, 4, 8]) => {
  if (!Number.isFinite(value)) return '';
  const whole = Math.floor(value + 1e-9);
  const rest = value - whole;
  if (rest < 0.02) return String(whole);
  let best = null;
  denominators.forEach((d) => {
    const n = Math.round(rest * d);
    if (n > 0 && n < d) {
      const error = Math.abs(rest - n / d);
      if (!best || error < best.error) best = { n, d, error };
    }
  });
  if (!best || best.error > 0.02) return value.toFixed(2).replace(/\.?0+$/, '');
  return whole > 0 ? `${whole} ${best.n}/${best.d}` : `${best.n}/${best.d}`;
};

const SAMPLE = `2 cups flour
1 1/2 tsp baking powder
1/2 tsp salt
3/4 cup butter, softened
1 1/4 cups sugar
2 eggs
1 cup milk`;

const VOLUME = [
  { unit: 'cup', smaller: [['tbsp', 16], ['tsp', 48]] },
  { unit: 'cups', smaller: [['tbsp', 16], ['tsp', 48]] },
  { unit: 'tbsp', smaller: [['tsp', 3]] },
  { unit: 'tsp', smaller: [] },
];

export default function RecipeScaler() {
  const [from, setFrom] = useState('8');
  const [to, setTo] = useState('12');
  const [text, setText] = useState(SAMPLE);
  const [fractions, setFractions] = useState(true);

  const factor = useMemo(() => {
    const origin = Number(from) || 0;
    const target = Number(to) || 0;
    return origin > 0 && target > 0 ? target / origin : 1;
  }, [from, to]);

  const rows = useMemo(() => text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const match = trimmed.match(AMOUNT);
    if (!match) return { originalName: trimmed, name: trimmed, scaled: null, display: '—', equivalents: [] };
    const amount = parseAmount(match[1]);
    const rest = trimmed.slice(match[0].length).trim();
    const scaled = amount * factor;
    const display = fractions ? toFraction(scaled) : String(Number(scaled.toFixed(2)));
    const unit = rest.split(/\s+/)[0] || '';
    const volume = VOLUME.find((v) => v.unit === unit.toLowerCase());
    const equivalents = volume && scaled % 1 > 0.01
      ? volume.smaller.map(([name, per]) => `${toFraction(scaled * per)} ${name}`)
      : [];
    return { name: rest, original: match[1], scaled, display, equivalents };
  }).filter(Boolean), [text, factor, fractions]);

  const scaled = rows.map((r) => (r.scaled === null ? r.name : `${r.display} ${r.name}`)).join('\n');
  const withEquivalents = rows.map((r) => (r.equivalents.length ? `${r.display} ${r.name}   (${r.equivalents.join(' · ')})` : r.scaled === null ? r.name : `${r.display} ${r.name}`)).join('\n');

  return (
    <ToolShell
      toolId="recipe-scaler"
      icon={Utensils}
      title="Recipe Scaler"
      desc="Resize a recipe to any number of servings, with fractions kept readable."
      state={{ from, to, text, fractions }}
      onRestore={(saved) => { setFrom(saved.from); setTo(saved.to); setText(saved.text); setFractions(saved.fractions); }}
      exportText={scaled}
      exportName="recipe-scaled.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Recipe serves (original)"><input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="You want to serve"><input value={to} onChange={(e) => setTo(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[2, 4, 6, 8, 10, 12, 16, 20].map((n) => (
          <button key={n} onClick={() => setTo(String(n))} className={`rounded-lg border px-2.5 py-1 text-xs transition ${Number(to) === n ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{n} servings</button>
        ))}
      </div>
      <Area value={text} onChange={setText} rows={8} placeholder={'2 cups flour\n1/2 tsp salt'} />
      <ToggleRow label="Show amounts as fractions" checked={fractions} onChange={setFractions} hint="3/4 cup rather than 0.75" />
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Multiplier</div>
        <div className="mt-1 font-display text-3xl font-bold text-cyan-j">×{factor.toFixed(3).replace(/\.?0+$/, '')}</div>
        <div className="mt-1 text-xs text-muted-foreground">{from} servings → {to} servings</div>
      </Panel>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Ingredients" value={String(rows.length)} />
        <Stat label="Scaled up" value={factor > 1 ? `${(factor * 100).toFixed(0)}%` : '—'} />
        <Stat label="Scaled down" value={factor < 1 ? `${(factor * 100).toFixed(0)}%` : '—'} />
      </div>
      <Out label="Scaled recipe" value={scaled}>
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2 border-b border-border/40 pb-1.5 text-sm last:border-0">
              <span className="font-mono-j font-semibold text-cyan-j">{r.scaled === null ? '—' : r.display}</span>
              <span>{r.name}</span>
              {r.equivalents.length > 0 && <span className="text-[11px] text-muted-foreground">also {r.equivalents.join(' or ')}</span>}
            </li>
          ))}
        </ul>
      </Out>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={scaled} label="Copy recipe" />
        <CopyBtn value={withEquivalents} label="Copy with equivalents" />
      </div>
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Amounts are converted to the nearest sensible fraction of a cup, tablespoon or teaspoon, so 1 cup × 1.5 becomes 1 1/2 cups rather than 1.5000. Seasonings, salt and leavening rarely need scaling exactly — taste as you go and round those down a little.
        </div>
      </Panel>
    </ToolShell>
  );
}