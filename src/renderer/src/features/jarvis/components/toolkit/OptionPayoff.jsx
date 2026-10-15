import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const STRATEGIES = [
  { id: 'longCall', label: 'Long call', legs: (k, p) => [{ type: 'call', strike: k, premium: p, side: 1 }] },
  { id: 'longPut', label: 'Long put', legs: (k, p) => [{ type: 'put', strike: k, premium: p, side: 1 }] },
  { id: 'coveredCall', label: 'Covered call', legs: (k, p, k2) => [{ type: 'stock', strike: 0, premium: 0, side: 1 }, { type: 'call', strike: k2, premium: p, side: -1 }] },
  { id: 'protectivePut', label: 'Protective put', legs: (k, p) => [{ type: 'stock', strike: 0, premium: 0, side: 1 }, { type: 'put', strike: k, premium: p, side: 1 }] },
  { id: 'bullSpread', label: 'Bull call spread', legs: (k, p, k2) => [{ type: 'call', strike: k, premium: p, side: 1 }, { type: 'call', strike: k2, premium: p * 0.45, side: -1 }] },
  { id: 'bearSpread', label: 'Bear put spread', legs: (k, p, k2) => [{ type: 'put', strike: k2, premium: p, side: 1 }, { type: 'put', strike: k, premium: p * 0.45, side: -1 }] },
  { id: 'straddle', label: 'Long straddle', legs: (k, p) => [{ type: 'call', strike: k, premium: p, side: 1 }, { type: 'put', strike: k, premium: p, side: 1 }] },
  { id: 'ironCondor', label: 'Iron condor', legs: (k, p, k2) => [{ type: 'put', strike: k * 0.94, premium: p * 0.4, side: -1 }, { type: 'put', strike: k * 0.9, premium: p * 0.2, side: 1 }, { type: 'call', strike: k2, premium: p * 0.4, side: -1 }, { type: 'call', strike: k2 * 1.04, premium: p * 0.2, side: 1 }] },
];

export default function OptionPayoff() {
  const [strategy, setStrategy] = useState('longCall');
  const [spot, setSpot] = useState('100');
  const [strike, setStrike] = useState('100');
  const [strike2, setStrike2] = useState('110');
  const [premium, setPremium] = useState('5');
  const [contracts, setContracts] = useState('1');
  const [contractSize, setContractSize] = useState('100');
  const [iv, setIv] = useState('30');
  const [days, setDays] = useState('45');
  const [rate, setRate] = useState('4');
  const [extra, setExtra] = useState({ commissions: true, chart: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const s0 = Math.max(0.01, Number(spot) || 100);
    const k1 = Math.max(0.01, Number(strike) || s0);
    const k2 = Math.max(0.01, Number(strike2) || k1 * 1.1);
    const prem = Math.max(0, Number(premium) || 0);
    const qty = Math.max(1, Number(contracts) || 1);
    const multiplier = Math.max(1, Number(contractSize) || 100);
    const selected = STRATEGIES.find((entry) => entry.id === strategy) || STRATEGIES[0];
    const legs = selected.legs(k1, prem, k2);
    const commission = extra.commissions ? qty * legs.length * 1.3 : 0;

    const payoffAt = (price) => {
      let total = 0;
      legs.forEach((leg) => {
        if (leg.type === 'stock') {
          total += (price - s0) * leg.side;
        } else if (leg.type === 'call') {
          total += (Math.max(0, price - leg.strike) - leg.premium) * leg.side;
        } else {
          total += (Math.max(0, leg.strike - price) - leg.premium) * leg.side;
        }
      });
      return total * multiplier * qty - commission;
    };

    const range = [];
    const low = Math.max(0.01, s0 * 0.6);
    const high = s0 * 1.4;
    const steps = 41;
    for (let i = 0; i < steps; i += 1) {
      const price = low + ((high - low) * i) / (steps - 1);
      range.push({ price, payoff: payoffAt(price) });
    }

    // Find breakevens by scanning for sign changes.
    const breakevens = [];
    for (let i = 1; i < range.length; i += 1) {
      const a = range[i - 1];
      const b = range[i];
      if ((a.payoff <= 0 && b.payoff >= 0) || (a.payoff >= 0 && b.payoff <= 0)) {
        const t = Math.abs(a.payoff) / (Math.abs(a.payoff) + Math.abs(b.payoff) || 1);
        breakevens.push(a.price + (b.price - a.price) * t);
      }
    }

    const netCost = payoffAt(s0);
    const maxLoss = Math.min(...range.map((point) => point.payoff));
    const maxProfit = Math.max(...range.map((point) => point.payoff));
    const capitalAtRisk = Math.abs(maxLoss);
    const rewardRisk = capitalAtRisk > 0 ? maxProfit / capitalAtRisk : Infinity;
    const debit = legs.reduce((sum, leg) => sum + (leg.type === 'stock' ? 0 : leg.premium * leg.side * multiplier * qty), 0);
    const premiumCollected = legs.reduce((sum, leg) => sum + (leg.side < 0 ? leg.premium * multiplier * qty : 0), 0);
    const premiumPaid = legs.reduce((sum, leg) => sum + (leg.side > 0 && leg.type !== 'stock' ? leg.premium * multiplier * qty : 0), 0);

    // Delta at the money, approximated from a finite difference of the payoff plus a simple model.
    const h = s0 * 0.01;
    const delta = (payoffAt(s0 + h) - payoffAt(s0 - h)) / (2 * h);
    const gamma = (payoffAt(s0 + h) - 2 * payoffAt(s0) + payoffAt(s0 - h)) / (h * h);
    const t = Math.max(1, Number(days) || 45) / 365;
    const r = (Number(rate) || 0) / 100;
    const sigma = (Number(iv) || 30) / 100;

    // A plain Black-Scholes price for reference on the first option leg.
    const nd = (x) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
    const firstOption = legs.find((leg) => leg.type !== 'stock');
    let theoPrice = 0;
    if (firstOption) {
      const k = firstOption.strike;
      const d1 = (Math.log(s0 / k) + (r + sigma ** 2 / 2) * t) / (sigma * Math.sqrt(t));
      const d2 = d1 - sigma * Math.sqrt(t);
      theoPrice = firstOption.type === 'call'
        ? s0 * nd(d1) - k * Math.exp(-r * t) * nd(d2)
        : k * Math.exp(-r * t) * nd(-d2) - s0 * nd(-d1);
    }
    const edge = firstOption ? firstOption.premium - theoPrice : 0;

    const margin = strategy === 'ironCondor' || strategy.startsWith('bear') ? Math.abs(maxLoss) * 1.15 : capitalAtRisk;

    const warnings = [];
    if (maxLoss < -0.0001 && capitalAtRisk > Math.max(1, multiplier * qty * s0 * 5)) warnings.push('The maximum loss on this structure is ' + capitalAtRisk.toFixed(0) + ', which is a large multiple of the premium involved. Check the margin requirement before trading it.');
    if (rewardRisk !== Infinity && rewardRisk < 0.5) warnings.push('Reward to risk is only ' + rewardRisk.toFixed(2) + ':1. You need a high win rate for that to work over time.');
    if (firstOption && edge > 0) warnings.push('The option you are buying is priced about ' + edge.toFixed(2) + ' above the plain Black-Scholes value at ' + iv + '% implied volatility — you are paying above model value.');
    if (firstOption && edge < 0) warnings.push('The option is priced about ' + Math.abs(edge).toFixed(2) + ' below model value. Cheap options are often cheap for a reason; check the liquidity.');
    if (iv > 70) warnings.push('At ' + iv + '% implied volatility the option is expensive in absolute terms. High volatility helps long options and hurts short ones.');
    if (days < 10) warnings.push('With ' + days + ' days to expiry, theta decay is brutal. Short-dated options lose value quickly even when the underlying barely moves.');
    if (premium <= 0) warnings.push('A premium of zero makes the payoff theoretical. Real quotes include a spread, and the spread is a real cost.');

    const report = [
      'OPTION STRATEGY PAYOFF',
      selected.label + ', ' + qty + ' contract' + (qty > 1 ? 's' : '') + ' at ' + multiplier + ' per contract',
      'Underlying ' + s0.toFixed(2) + ', strike ' + k1.toFixed(2) + (selected.legs === STRATEGIES[0].legs && (strategy === 'bullSpread' || strategy === 'bearSpread' || strategy === 'coveredCall' || strategy === 'ironCondor') ? '/' + k2.toFixed(2) : ''),
      'Premium ' + prem.toFixed(2) + ' per share, ' + days + ' days to expiry, implied volatility ' + iv + '%',
      '',
      'Debit paid: ' + premiumPaid.toFixed(2),
      'Premium collected: ' + premiumCollected.toFixed(2),
      'Net premium: ' + debit.toFixed(2) + (commission ? ', commissions ' + commission.toFixed(2) : ''),
      'Value today: ' + netCost.toFixed(2),
      '',
      'Maximum profit: ' + maxProfit.toFixed(2) + (maxProfit >= 1e8 ? ' (unlimited)' : ''),
      'Maximum loss: ' + maxLoss.toFixed(2),
      'Reward to risk: ' + (rewardRisk === Infinity ? 'unlimited' : rewardRisk.toFixed(2) + ':1'),
      'Approximate margin: ' + margin.toFixed(2),
      'Delta at spot: ' + delta.toFixed(3),
      'Gamma at spot: ' + gamma.toFixed(4),
      firstOption ? 'Model price of the lead option: ' + theoPrice.toFixed(2) + ' (edge ' + (edge >= 0 ? '+' : '') + edge.toFixed(2) + ')' : '',
      '',
      'Breakeven' + (breakevens.length > 1 ? 's' : '') + ': ' + (breakevens.length ? breakevens.map((value) => value.toFixed(2)).join(' and ') : 'none in the scanned range'),
      '',
      'Payoff at expiry',
      ...range.filter((_, index) => index % 4 === 0).map((point) => '  ' + point.price.toFixed(2) + ': ' + point.payoff.toFixed(2)),
    ].filter(Boolean).join('\n');

    return {
      selected, legs, s0, k1, k2, prem, qty, multiplier, commission, range, breakevens, netCost, maxLoss, maxProfit,
      capitalAtRisk, rewardRisk, debit, premiumPaid, premiumCollected, delta, gamma, theoPrice, edge, margin, iv, days,
      warnings, report, hasSecondStrike: ['bullSpread', 'bearSpread', 'coveredCall', 'ironCondor'].includes(strategy),
    };
  }, [strategy, spot, strike, strike2, premium, contracts, contractSize, iv, days, rate, extra]);

  // Payoff chart drawn directly so profit and loss read immediately.
  const chartW = 520;
  const chartH = 180;
  const maxAbs = Math.max(Math.abs(result.maxProfit), Math.abs(result.maxLoss), 1);
  const points = result.range.map((point, index) => {
    const x = (index / (result.range.length - 1)) * chartW;
    const y = chartH / 2 - (point.payoff / maxAbs) * (chartH / 2 - 8);
    return { x, y, ...point };
  });
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const zeroY = chartH / 2;
  const areaPath = `M 0 ${zeroY} L ${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' L ')} L ${chartW} ${zeroY} Z`;

  return (
    <ToolShell
      toolId="option-payoff"
      icon={TrendingUp}
      title="Option Strategy Payoff & Breakevens"
      desc="Model a call, put, covered call, spread, straddle or iron condor: the payoff curve, breakevens, maximum profit and loss, margin and the delta and gamma at today's price."
      state={{ strategy, spot, strike, strike2, premium, contracts, contractSize, iv, days, rate, extra }}
      onRestore={(restored) => {
        const map = { spot: setSpot, strike: setStrike, strike2: setStrike2, premium: setPremium, contracts: setContracts, contractSize: setContractSize, iv: setIv, days: setDays, rate: setRate };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.strategy) setStrategy(restored.strategy);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="option-payoff.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {STRATEGIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setStrategy(entry.id)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${strategy === entry.id ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 text-muted-foreground hover:border-cyan-j/40'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Underlying price"><input value={spot} onChange={(e) => setSpot(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Strike 1"><input value={strike} onChange={(e) => setStrike(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Strike 2"><input value={strike2} onChange={(e) => setStrike2(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Premium per share"><input value={premium} onChange={(e) => setPremium(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Contracts"><input value={contracts} onChange={(e) => setContracts(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Contract size"><input value={contractSize} onChange={(e) => setContractSize(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Implied volatility, %"><input value={iv} onChange={(e) => setIv(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Days to expiry"><input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Include commissions" checked={extra.commissions} onChange={() => toggle('commissions')} hint="1.30 per contract per leg" />
        <ToggleRow label="Show payoff curve" checked={extra.chart} onChange={() => toggle('chart')} />
      </div>

      {extra.chart && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Payoff at expiry — {result.selected.label}</span>
            <span className="font-mono-j text-[11px] text-muted-foreground">{result.legs.length} leg{result.legs.length > 1 ? 's' : ''}</span>
          </div>
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="h-44 w-full">
            <defs>
              <linearGradient id="payoffFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(189 100% 50%)" stopOpacity="0.25" />
                <stop offset="50%" stopColor="hsl(189 100% 50%)" stopOpacity="0.03" />
                <stop offset="50%" stopColor="hsl(350 80% 55%)" stopOpacity="0.03" />
                <stop offset="100%" stopColor="hsl(350 80% 55%)" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width={chartW} height={chartH} fill="transparent" />
            <path d={areaPath} fill="url(#payoffFill)" />
            <line x1="0" y1={zeroY} x2={chartW} y2={zeroY} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 3" />
            {result.breakevens.map((value) => {
              const x = ((value - result.range[0].price) / (result.range[result.range.length - 1].price - result.range[0].price)) * chartW;
              return <line key={value} x1={x} y1="0" x2={x} y2={chartH} stroke="hsl(38 100% 50%)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />;
            })}
            <polyline points={line} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={((result.s0 - result.range[0].price) / (result.range[result.range.length - 1].price - result.range[0].price)) * chartW} cy={zeroY} r="3.5" fill="hsl(265 80% 65%)" />
          </svg>
          <div className="flex justify-between font-mono-j text-[10px] text-muted-foreground">
            <span>{result.range[0].price.toFixed(1)}</span>
            <span>purple dot is today's price · amber lines are breakevens</span>
            <span>{result.range[result.range.length - 1].price.toFixed(1)}</span>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.selected.label + ' at ' + result.s0.toFixed(2)}
          value={result.maxProfit >= 1e8 ? 'Unlimited' : result.maxProfit.toFixed(0)}
          unit="max profit"
          sub={'Maximum loss is ' + result.maxLoss.toFixed(0) + (result.rewardRisk === Infinity ? ', with unlimited upside.' : ', giving reward to risk of ' + result.rewardRisk.toFixed(2) + ':1.') + ' Breakeven' + (result.breakevens.length > 1 ? 's' : '') + ': ' + (result.breakevens.length ? result.breakevens.map((value) => value.toFixed(2)).join(' and ') : 'none in the scanned range') + '.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Position economics</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Premium paid</span><span>{result.premiumPaid.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Premium received</span><span>{result.premiumCollected.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Net premium</span><span>{result.debit.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Value today</span><span className={result.netCost >= 0 ? 'text-cyan-j' : 'text-rose-400'}>{result.netCost.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Commissions</span><span>{result.commission.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Delta</span><span>{result.delta.toFixed(3)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Gamma</span><span>{result.gamma.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Approx. margin</span><span>{result.margin.toFixed(0)}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Structure', value: result.selected.label },
                { label: 'Legs', value: String(result.legs.length) },
                { label: 'Model edge', value: (result.edge >= 0 ? '+' : '') + result.edge.toFixed(2), tone: result.edge > 0 ? 'amber' : undefined },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Max profit" value={result.maxProfit >= 1e8 ? 'Unlimited' : result.maxProfit.toFixed(0)} mono sub="at expiry" />
        <Stat label="Max loss" value={result.maxLoss.toFixed(0)} mono sub="defined by the structure" />
        <Stat label="Reward / risk" value={result.rewardRisk === Infinity ? '∞' : result.rewardRisk.toFixed(2)} mono sub="ratio" />
        <Stat label="Breakevens" value={result.breakevens.length ? result.breakevens.map((value) => value.toFixed(1)).join(' / ') : '—'} mono sub="at expiry" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Risk notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Full payoff sheet</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading these structures</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Long options define risk to the premium paid, and their value bleeds away with time even when the underlying does nothing. The clock is the enemy.</p>
            <p>· Short options collect premium and take on the risk. Naked short calls have theoretically unlimited loss, which is why margin exists.</p>
            <p>· Spreads cap both sides. You give up the tail of the profit in exchange for a much smaller capital commitment and a defined worst case.</p>
            <p>· A covered call is a stock position with a sold upside. It underperforms badly in a sharp rally, and that is the trade you have chosen.</p>
            <p>· Breakevens move with implied volatility before expiry. At expiry they are the sharp lines; today they are a curve.</p>
            <p>· Liquidity and spread decide the real outcome. A theoretically profitable structure in a wide market can still lose money on the round trip.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Payoffs are calculated at expiry assuming European exercise and no early assignment, with a plain Black-Scholes figure shown for the lead option leg by way of price comparison. American
          options, dividends, borrow costs and assignment all change real outcomes, and none of this is investment advice.
        </p>
      </Panel>
    </ToolShell>
  );
}