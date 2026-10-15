import { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Input } from '@jarvis/components/ui/input';
import { Field, Panel, Seg, Stat } from './shared';

const CURRENCIES = ['$', '₹', '€', '£', '¥'];

const START = {
  account: 10000,
  riskPct: 1,
  entry: 100,
  stop: 95,
  target: 115,
  winRate: 45,
  feePct: 0.08,
  currency: '$',
};

const PRESETS = [
  { label: 'Swing trade, 1R risk', values: { account: 25000, riskPct: 1, entry: 82.5, stop: 78, target: 98, winRate: 45, feePct: 0.08 } },
  { label: 'Tight scalp', values: { account: 10000, riskPct: 0.5, entry: 240, stop: 237.5, target: 249, winRate: 55, feePct: 0.04 } },
  { label: 'Long-term, wide stop', values: { account: 100000, riskPct: 2, entry: 410, stop: 340, target: 700, winRate: 40, feePct: 0.1 } },
  { label: 'Crypto, volatile', values: { account: 5000, riskPct: 1.5, entry: 64000, stop: 58500, target: 82000, winRate: 38, feePct: 0.15 } },
];

export default function PositionSizing() {
  const [v, setV] = useState(START);
  const set = (key, value) => setV((current) => ({ ...current, [key]: value }));

  const calc = useMemo(() => {
    const account = Number(v.account) || 0;
    const riskPct = Number(v.riskPct) || 0;
    const entry = Number(v.entry) || 0;
    const stop = Number(v.stop) || 0;
    const target = Number(v.target) || 0;
    const winRate = Math.min(99, Math.max(0, Number(v.winRate) || 0)) / 100;
    const feePct = Number(v.feePct) || 0;

    const riskPerUnit = Math.abs(entry - stop);
    const feePerUnit = (entry * feePct) / 100;
    const totalRiskPerUnit = riskPerUnit + feePerUnit;
    const riskAmount = (account * riskPct) / 100;
    const quantity = totalRiskPerUnit > 0 && entry > 0 ? riskAmount / totalRiskPerUnit : 0;
    const positionValue = quantity * entry;
    const leverage = account > 0 ? positionValue / account : 0;
    const rewardPerUnit = Math.abs(target - entry) - feePerUnit;
    const rr = totalRiskPerUnit > 0 ? rewardPerUnit / totalRiskPerUnit : 0;
    const maxLoss = quantity * totalRiskPerUnit;
    const maxGain = quantity * Math.max(0, rewardPerUnit);
    const expectancy = winRate * rr - (1 - winRate);
    const expectancyCash = expectancy * riskAmount;
    const breakEvenWinRate = rr > 0 ? 1 / (1 + rr) : 1;
    const kelly = rr > 0 ? winRate - (1 - winRate) / rr : 0;
    const lossesTo20 = riskPct > 0 ? Math.log(0.8) / Math.log(1 - riskPct / 100) : Infinity;

    return {
      account, riskPct, entry, stop, target, rr, quantity, positionValue, leverage,
      riskAmount, maxLoss, maxGain, expectancy, expectancyCash, breakEvenWinRate,
      kelly, lossesTo20, riskPerUnit, feePerUnit, totalRiskPerUnit, rewardPerUnit, winRate,
      targetMove: entry ? ((target - entry) / entry) * 100 : 0,
      stopMove: entry ? ((stop - entry) / entry) * 100 : 0,
    };
  }, [v]);

  const c = v.currency;
  const money = (value) => c + (Math.abs(value) >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(2));
  const units = calc.quantity >= 1 ? Math.floor(calc.quantity).toLocaleString() : calc.quantity.toFixed(4);

  const report = [
    'Position sizing',
    '',
    'Account ' + c + calc.account.toLocaleString() + ' · risking ' + calc.riskPct + '% (' + money(calc.riskAmount) + ') per trade',
    'Entry ' + c + calc.entry + ' · stop ' + c + calc.stop + ' (' + calc.stopMove.toFixed(2) + '%) · target ' + c + calc.target + ' (' + calc.targetMove.toFixed(2) + '%)',
    '',
    'Position: ' + units + ' units for ' + money(calc.positionValue) + ' (' + calc.leverage.toFixed(2) + '× account)',
    'Maximum loss ' + money(calc.maxLoss) + ' · maximum gain ' + money(calc.maxGain),
    'Reward to risk ' + calc.rr.toFixed(2) + 'R · break-even win rate ' + (calc.breakEvenWinRate * 100).toFixed(1) + '%',
    'Expectancy at ' + (calc.winRate * 100).toFixed(0) + '% win rate: ' + calc.expectancy.toFixed(2) + 'R (' + money(calc.expectancyCash) + ') per trade',
    'Kelly share of the account: ' + (calc.kelly * 100).toFixed(2) + '%',
  ].join('\n');

  return (
    <ToolShell
      toolId="position-sizing"
      icon={Scale}
      title="Position Sizing & Risk"
      desc="Turn a stop loss and a risk budget into an exact position size, then check whether the trade is worth taking at all — reward to risk, break-even win rate, expectancy and the Kelly share of the account."
      state={v}
      onRestore={(restored) => setV({ ...START, ...restored })}
      exportText={report}
      exportName="position-sizing.txt"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setV({ ...START, ...preset.values })}
            className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            {preset.label}
          </button>
        ))}
        <Seg value={v.currency} onChange={(value) => set('currency', value)} options={CURRENCIES} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The trade</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Account size"><Input type="number" value={v.account} onChange={(e) => set('account', e.target.value)} /></Field>
            <Field label="Risk per trade (%)"><Input type="number" step="0.1" value={v.riskPct} onChange={(e) => set('riskPct', e.target.value)} /></Field>
            <Field label="Entry price"><Input type="number" step="any" value={v.entry} onChange={(e) => set('entry', e.target.value)} /></Field>
            <Field label="Stop loss"><Input type="number" step="any" value={v.stop} onChange={(e) => set('stop', e.target.value)} /></Field>
            <Field label="Target"><Input type="number" step="any" value={v.target} onChange={(e) => set('target', e.target.value)} /></Field>
            <Field label="Expected win rate (%)"><Input type="number" step="1" value={v.winRate} onChange={(e) => set('winRate', e.target.value)} /></Field>
            <Field label="Round-trip costs (%)" hint="Commission, spread and slippage."><Input type="number" step="0.01" value={v.feePct} onChange={(e) => set('feePct', e.target.value)} /></Field>
          </div>
        </Panel>

        <div className="space-y-3">
          <Hero
            tone={calc.leverage > 5 ? 'rose' : calc.leverage > 2 ? 'amber' : 'emerald'}
            label="Position size"
            value={units}
            unit="units"
            sub={money(calc.positionValue) + ' · ' + calc.leverage.toFixed(2) + '× the account'}
          />
          <Ring
            value={calc.riskPct}
            max={5}
            tone={calc.riskPct > 2 ? 'rose' : calc.riskPct > 1 ? 'amber' : 'emerald'}
            label="Account risked on this trade"
            sub={money(calc.riskAmount) + ' of ' + money(calc.account)}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Risk per unit" value={money(calc.totalRiskPerUnit)} mono sub={'incl. ' + money(calc.feePerUnit) + ' costs'} />
        <Stat label="Reward to risk" value={calc.rr.toFixed(2) + 'R'} mono sub={calc.rr >= 2 ? 'strong' : calc.rr >= 1 ? 'workable' : 'thin'} />
        <Stat label="Break-even win rate" value={(calc.breakEvenWinRate * 100).toFixed(1) + '%'} mono sub={'you assume ' + (calc.winRate * 100).toFixed(0) + '%'} />
        <Stat label="Expectancy" value={calc.expectancy.toFixed(2) + 'R'} mono sub={money(calc.expectancyCash) + ' per trade'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The two outcomes, in money</div>
        <Bars
          data={[
            { label: 'Stop hit', value: calc.maxLoss },
            { label: 'Target hit', value: calc.maxGain },
          ]}
          format={(value) => c + Math.round(value).toLocaleString()}
          highlightLast
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          The distance from entry to stop is {calc.entry ? (Math.abs(calc.stop - calc.entry) / calc.entry * 100).toFixed(2) : '0'}% of price, and to the target{' '}
          {calc.entry ? (Math.abs(calc.target - calc.entry) / calc.entry * 100).toFixed(2) : '0'}%. Because costs come out of every trade, the size that risks
          exactly {calc.riskPct}% is slightly smaller than the naive calculation that ignores them.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Is the edge real?</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Break-even win rate is {(calc.breakEvenWinRate * 100).toFixed(1)}% at {calc.rr.toFixed(2)}R. Any win rate above that is profitable over time, and below it is a slow loss.</p>
            <p>· At your assumed {(calc.winRate * 100).toFixed(0)}% win rate the expectancy is {calc.expectancy.toFixed(2)}R per trade, or {money(calc.expectancyCash)}. Over 200 trades that is {money(calc.expectancyCash * 200)}.</p>
            <p>· Kelly says the mathematically optimal risk is {(calc.kelly * 100).toFixed(2)}% of the account per trade. Half of that is the number most professionals actually use, because Kelly assumes you know your win rate exactly — you do not.</p>
            <p>· Expectancy turns negative the moment your real win rate falls {((calc.winRate - calc.breakEvenWinRate) * 100).toFixed(1)} percentage points below your estimate. Be honest about how the estimate was made.</p>
            <p>· A {calc.rr.toFixed(2)}R trade needs the target to be {calc.entry ? (Math.abs(calc.target - calc.entry) / calc.entry * 100).toFixed(1) : '0'}% away. If that requires a move the market rarely makes in your holding period, the reward to risk is theoretical.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the sizing protects you from</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· At {calc.riskPct}% per trade it takes {Number.isFinite(calc.lossesTo20) ? Math.round(calc.lossesTo20) : '—'} consecutive losses to draw the account down 20%. That is the real test of a risk setting.</p>
            <p>· Ten correlated positions sized this way is a {calc.riskPct * 10}% bet on one theme, not ten independent trades. Cap the total heat, not just the single trade.</p>
            <p>· A stop is an instruction, not a guarantee. Gaps and halted markets can fill you far beyond it, which is why a {calc.riskPct}% plan can turn into 5% overnight.</p>
            <p>· The position is {calc.leverage.toFixed(2)}× your account. Above about 3×, a normal adverse move becomes a margin problem rather than a stop-out.</p>
            <p>· Size in units, not money. Round lots, minimum increments and contract multipliers all move the real risk away from the plan, so re-check the actual number after rounding.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Risk', value: money(calc.riskAmount) },
                { label: 'R:R', value: calc.rr.toFixed(2) + 'R' },
                { label: 'Edge', value: calc.expectancy >= 0 ? 'positive' : 'negative', tone: calc.expectancy >= 0 ? undefined : 'rose' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every figure is arithmetic on the numbers you enter: quantity is the risk budget divided by the per-unit distance to the stop plus costs, and every
          other metric derives from that. The tool has no view on what you should trade, and no assumption about your win rate beyond the one you supply. What it
          does is make the size explicit before the order goes in, which is the single decision most traders skip.
        </p>
      </Panel>
    </ToolShell>
  );
}