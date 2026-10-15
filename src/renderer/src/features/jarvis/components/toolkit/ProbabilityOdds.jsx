import { useMemo, useState } from 'react';
import { Dices } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const fromProbability = (p) => {
  const probability = Math.min(0.999999, Math.max(0.000001, p / 100));
  const decimal = 1 / probability;
  const decimalProfit = decimal - 1;
  const american = decimalProfit >= 1 ? `+${Math.round(decimalProfit * 100)}` : `−${Math.round(100 / decimalProfit)}`;
  let numerator = Math.round(decimalProfit * 100);
  let denominator = 100;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const divisor = gcd(numerator, denominator) || 1;
  numerator /= divisor;
  denominator /= divisor;
  return { decimal: decimal.toFixed(3), american, fractional: `${numerator}/${denominator}`, oneIn: Math.round(1 / probability) };
};

export default function ProbabilityOdds() {
  const [probability, setProbability] = useState('25');
  const [dice, setDice] = useState('6');
  const [rolls, setRolls] = useState('4');
  const [target, setTarget] = useState('6');
  const [wins, setWins] = useState('50');
  const [stake, setStake] = useState('10');
  const [evProbability, setEvProbability] = useState('35');

  const odds = useMemo(() => fromProbability(Number(probability) || 1), [probability]);

  const diceResult = useMemo(() => {
    const sides = Math.max(2, Number(dice) || 6);
    const count = Math.max(1, Number(rolls) || 1);
    const wanted = Math.min(sides, Math.max(1, Number(target) || 1));
    const miss = ((sides - 1) / sides) ** count;
    const atLeastOne = 1 - miss;
    const allWanted = (1 / sides) ** count;
    const exactlyOne = count * (1 / sides) * miss;
    return { sides, count, wanted, atLeastOne: atLeastOne * 100, allWanted: allWanted * 100, exactlyOne: exactlyOne * 100, expected: count / sides };
  }, [dice, rolls, target]);

  const ev = useMemo(() => {
    const p = Math.min(100, Math.max(0, Number(evProbability) || 0)) / 100;
    const win = Number(wins) || 0;
    const loss = Number(stake) || 0;
    const value = p * win - (1 - p) * loss;
    return { p, win, loss, value, breakEven: win + loss ? (loss / (win + loss)) * 100 : 0, edge: (p * (win + loss) - loss) / Math.max(1, loss) * 100 };
  }, [wins, stake, evProbability]);

  const report = [
    `${probability}% probability`,
    `Decimal odds: ${odds.decimal} · American: ${odds.american} · Fractional: ${odds.fractional} · One in ${odds.oneIn}`,
    '',
    `Dice: at least one ${diceResult.wanted} in ${diceResult.count} rolls of a d${diceResult.sides} — ${diceResult.atLeastOne.toFixed(2)}%`,
    `Expected value: ${ev.value >= 0 ? '+' : ''}${ev.value.toFixed(2)} per bet · break-even needs ${ev.breakEven.toFixed(1)}% wins`,
  ].join('\n');

  return (
    <ToolShell
      toolId="probability"
      icon={Dices}
      title="Probability & Odds"
      desc="Move between percentages, decimal, fractional and American odds — then check dice odds and whether a bet is actually worth taking."
      state={{ probability, dice, rolls, target, wins, stake, evProbability }}
      onRestore={(restored) => {
        if (restored.probability !== undefined) setProbability(String(restored.probability));
        if (restored.dice !== undefined) setDice(String(restored.dice));
        if (restored.rolls !== undefined) setRolls(String(restored.rolls));
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (restored.wins !== undefined) setWins(String(restored.wins));
        if (restored.stake !== undefined) setStake(String(restored.stake));
        if (restored.evProbability !== undefined) setEvProbability(String(restored.evProbability));
      }}
      exportText={report}
      exportName="probability.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy results" />
      </div>

      <Field label={`Probability · ${probability}%`}>
        <input type="range" min={0.1} max={99.9} step={0.1} value={probability} onChange={(e) => setProbability(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Decimal odds" value={odds.decimal} mono />
        <Stat label="Fractional" value={odds.fractional} mono />
        <Stat label="American" value={odds.american} mono />
        <Stat label="One in" value={odds.oneIn} mono sub="occurrences" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Dice and repeated chances</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Die faces">
            <select value={dice} onChange={(e) => setDice(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
              {[4, 6, 8, 10, 12, 20].map((sides) => <option key={sides} value={sides}>d{sides}</option>)}
            </select>
          </Field>
          <Field label="Number rolled">
            <input value={rolls} onChange={(e) => setRolls(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="Wanted result">
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Stat label={`At least one ${diceResult.wanted}`} value={`${diceResult.atLeastOne.toFixed(2)}%`} mono />
          <Stat label="Exactly one" value={`${diceResult.exactlyOne.toFixed(2)}%`} mono />
          <Stat label="All of them" value={`${diceResult.allWanted.toFixed(2)}%`} mono />
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Is it worth taking? Expected value</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Chance of winning %">
            <input value={evProbability} onChange={(e) => setEvProbability(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="You win">
            <input value={wins} onChange={(e) => setWins(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="You lose">
            <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
        <div className={`mt-3 rounded-xl border p-3 text-center ${ev.value >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Expected value per attempt</div>
          <div className={`tk-title-glow mt-1 font-mono-j text-2xl font-semibold ${ev.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {ev.value >= 0 ? '+' : ''}{ev.value.toFixed(2)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Break-even needs {ev.breakEven.toFixed(1)}% wins — you are {ev.p * 100 >= ev.breakEven ? 'above' : 'below'} that line
          </div>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The classic trap is “surely it lands eventually” — four rolls of a die give you a 51.8% chance of seeing a six, not 66%. Probability also
          has no memory: after three misses the fourth roll is still one in six, which is why expected value rather than gut feel decides whether a
          bet is good. Positive expected value is rare by design in any game run for profit.
        </p>
      </Panel>
    </ToolShell>
  );
}