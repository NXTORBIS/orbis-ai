import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const INSTRUMENTS = [
  { id: 'stock', label: 'Stock, 2:1', initial: 0.5, maintenance: 0.25, borrow: 6.5 },
  { id: 'regt', label: 'Stock, 4:1', initial: 0.25, maintenance: 0.25, borrow: 8.5 },
  { id: 'futures', label: 'Futures / CFD', initial: 0.1, maintenance: 0.07, borrow: 5.5 },
  { id: 'crypto', label: 'Crypto, 5:1', initial: 0.2, maintenance: 0.1, borrow: 11 },
  { id: 'crypto10', label: 'Crypto, 10:1', initial: 0.1, maintenance: 0.05, borrow: 14 },
];

export default function MarginCall() {
  const [instrument, setInstrument] = useState('stock');
  const [equity, setEquity] = useState('10000');
  const [position, setPosition] = useState('20000');
  const [direction, setDirection] = useState('long');
  const [borrowRate, setBorrowRate] = useState('');
  const [days, setDays] = useState('30');
  const [stopLoss, setStopLoss] = useState('10');
  const [fees, setFees] = useState('0.1');
  const [extra, setExtra] = useState({ interest: true, feesOn: true, alert: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const inst = INSTRUMENTS.find((entry) => entry.id === instrument) || INSTRUMENTS[0];
    const cash = Math.max(1, Number(equity) || 0);
    const pos = Math.max(1, Number(position) || 0);
    const long = direction === 'long';
    const rate = borrowRate === '' ? inst.borrow : Math.max(0, Number(borrowRate) || 0);
    const holdDays = Math.max(1, Number(days) || 1);
    const stop = Math.min(95, Math.max(0, Number(stopLoss) || 0)) / 100;
    const feeRate = extra.feesOn ? Math.max(0, Number(fees) || 0) / 100 : 0;

    const loan = Math.max(0, pos - cash);
    const leverage = pos / cash;
    const initialRequired = pos * inst.initial;
    const freeCash = cash - initialRequired;
    const initialOk = cash >= initialRequired;

    // Liquidation price: where equity equals the maintenance requirement.
    const maintenanceReq = pos * inst.maintenance;
    const liquidationMove = (cash - maintenanceReq) / pos;
    const liquidationPriceIndex = long ? 1 - liquidationMove : 1 + liquidationMove;
    const liquidationBuffer = Math.abs(liquidationMove) * 100;

    const dailyInterest = (loan * (rate / 100)) / 365;
    const totalInterest = extra.interest ? dailyInterest * holdDays : 0;
    const entryFees = pos * feeRate;
    const exitFees = pos * feeRate;
    const roundTripCost = entryFees + exitFees + totalInterest;
    const breakEvenMove = (roundTripCost / pos) * 100;

    // Stop-loss outcome and whether it protects you before liquidation.
    const stopLossAmount = pos * stop;
    const stopEquity = cash - stopLossAmount - roundTripCost;
    const stopIsSafe = stop < liquidationBuffer;
    const stopMargin = liquidationBuffer - stop;

    // Sensitivity ladder: what equity and margin ratio look like after a move.
    const ladder = [20, 15, 10, 5, 0, -5, -10, -15, -20].map((movePercent) => {
      const move = long ? -movePercent : movePercent;
      const price = 1 + move / 100;
      const value = pos * price;
      const equityAfter = cash + (value - pos) - totalInterest;
      const ratio = value > 0 ? (equityAfter / value) * 100 : 0;
      const called = ratio / 100 <= inst.maintenance;
      return {
        label: (movePercent > 0 ? '+' : '') + movePercent + '%',
        value: Number(Math.max(-100, (equityAfter / cash) * 100 - 100).toFixed(1)),
        tone: called ? 'rose' : undefined,
        equityAfter,
        ratio,
        called,
      };
    });

    const calledRows = ladder.filter((row) => row.called).length;
    const distanceToCall = ladder.filter((row) => !row.called).length;

    // How much cash to add to push liquidation out by a given move.
    const extendTo20 = Math.max(0, pos * 0.2 * (inst.maintenance === 0 ? 1 : 1) - cash + maintenanceReq * 0);
    const cashToDoubleBuffer = Math.max(0, pos * (liquidationBuffer / 100) * 2 - cash + maintenanceReq);

    const riskScore = Math.min(100, Math.round((inst.maintenance / Math.max(0.001, cash / pos)) * 100));
    const marginRatio = ((cash - totalInterest) / pos) * 100;
    const maintenanceRatio = inst.maintenance * 100;

    const warnings = [];
    if (!initialOk) warnings.push('Initial margin of ' + initialRequired.toFixed(0) + ' is needed for this position and only ' + cash.toFixed(0) + ' is available. The broker will not open the trade.');
    if (liquidationBuffer < 10) warnings.push('Liquidation sits only ' + liquidationBuffer.toFixed(1) + '% away. Daily noise in most markets exceeds that, so the position can be closed before the thesis plays out.');
    if (!stopIsSafe) warnings.push('Your ' + (stop * 100).toFixed(1) + '% stop sits beyond the ' + liquidationBuffer.toFixed(1) + '% liquidation distance, so the broker closes the position first. Move the stop in or add cash.');
    if (leverage > 5) warnings.push('Leverage of ' + leverage.toFixed(1) + '× turns a normal 10% adverse move into a ' + Math.min(100, (10 * leverage)).toFixed(0) + '% hit to your equity.');
    if (rate > 10 && holdDays > 30) warnings.push('Borrowing at ' + rate.toFixed(1) + '% for ' + holdDays + ' days costs ' + totalInterest.toFixed(0) + '. High-rate leverage is only viable over short horizons.');
    if (breakEvenMove > 2) warnings.push('Costs mean the position must move ' + breakEvenMove.toFixed(2) + '% just to break even. High leverage multiplies the cost of being right too slowly.');
    if (inst.maintenance >= 0.25) warnings.push('Maintenance margin of ' + (inst.maintenance * 100).toFixed(0) + '% is high, which protects the broker rather than you. A small move triggers a call.');

    const report = [
      'LEVERAGE AND MARGIN RISK',
      inst.label + ', ' + direction + ' position of ' + pos.toFixed(0) + ' on ' + cash.toFixed(0) + ' of equity',
      '',
      'Borrowed: ' + loan.toFixed(0) + ' at ' + rate.toFixed(2) + '%',
      'Effective leverage: ' + leverage.toFixed(2) + 'x',
      'Initial margin required: ' + initialRequired.toFixed(0) + (initialOk ? ' (met)' : ' (short by ' + (initialRequired - cash).toFixed(0) + ')'),
      'Maintenance margin: ' + maintenanceReq.toFixed(0) + ' (' + maintenanceRatio.toFixed(1) + '%)',
      'Margin ratio now: ' + marginRatio.toFixed(2) + '%',
      '',
      'LIQUIDATION at a ' + liquidationBuffer.toFixed(2) + '% adverse move',
      'Price index: ' + liquidationPriceIndex.toFixed(4) + ' (entry = 1.0000)',
      'Equity left at that point: ' + maintenanceReq.toFixed(0),
      '',
      'Interest over ' + holdDays + ' days: ' + totalInterest.toFixed(2),
      'Round-trip fees: ' + (entryFees + exitFees).toFixed(2),
      'Total holding cost: ' + roundTripCost.toFixed(2) + ' (' + breakEvenMove.toFixed(3) + '% of position)',
      '',
      'With a ' + (stop * 100).toFixed(1) + '% stop: equity after ' + stopEquity.toFixed(0) + (stopIsSafe ? ' (stop triggers before liquidation)' : ' (liquidation happens first)'),
      '',
      'Scenario ladder',
      ...ladder.map((row) => '  ' + row.label + ' move: equity ' + row.equityAfter.toFixed(0) + ', margin ratio ' + row.ratio.toFixed(1) + '%' + (row.called ? '  MARGIN CALL' : '')),
    ].join('\n');

    return {
      inst, cash, pos, long, rate, holdDays, stop, feeRate, loan, leverage, initialRequired, freeCash, initialOk,
      maintenanceReq, liquidationMove, liquidationPriceIndex, liquidationBuffer, dailyInterest, totalInterest, entryFees,
      exitFees, roundTripCost, breakEvenMove, stopLossAmount, stopEquity, stopIsSafe, stopMargin, ladder, calledRows,
      distanceToCall, cashToDoubleBuffer, riskScore, marginRatio, maintenanceRatio, warnings, report, extendTo20,
    };
  }, [instrument, equity, position, direction, borrowRate, days, stopLoss, fees, extra]);

  return (
    <ToolShell
      toolId="margin-risk"
      icon={AlertTriangle}
      title="Leverage, Margin Call & Liquidation"
      desc="Position size and equity into effective leverage, the exact move that triggers liquidation, holding costs, breakeven and whether your stop-loss fires before the broker closes you out."
      state={{ instrument, equity, position, direction, borrowRate, days, stopLoss, fees, extra }}
      onRestore={(restored) => {
        const map = { equity: setEquity, position: setPosition, borrowRate: setBorrowRate, days: setDays, stopLoss: setStopLoss, fees: setFees };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.instrument) setInstrument(restored.instrument);
        if (restored.direction) setDirection(restored.direction);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="margin-risk.txt"
    >
      <Seg value={instrument} onChange={setInstrument} options={INSTRUMENTS.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={direction} onChange={setDirection} options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Own equity"><input value={equity} onChange={(e) => setEquity(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Position size"><input value={position} onChange={(e) => setPosition(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Borrow rate, % (' + result.inst.borrow + ' typical)'}><input value={borrowRate} onChange={(e) => setBorrowRate(e.target.value)} inputMode="decimal" placeholder={String(result.inst.borrow)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Holding period, days"><input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Stop-loss distance, %"><input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Fee per side, %"><input value={fees} onChange={(e) => setFees(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Charge interest" checked={extra.interest} onChange={() => toggle('interest')} />
        <ToggleRow label="Include trading fees" checked={extra.feesOn} onChange={() => toggle('feesOn')} />
        <ToggleRow label="Alert on approach" checked={extra.alert} onChange={() => toggle('alert')} hint="Warn at half the buffer" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.leverage.toFixed(1) + 'x ' + result.direction + ' on ' + result.pos.toFixed(0)}
          value={result.liquidationBuffer.toFixed(1)}
          unit="% to liquidation"
          sub={'You are borrowing ' + result.loan.toFixed(0) + ' at ' + result.rate.toFixed(2) + '%. A move of ' + result.liquidationBuffer.toFixed(1) + '% against the position wipes the equity down to the maintenance requirement and the broker closes it. Holding costs add ' + result.breakEvenMove.toFixed(2) + '% to the move you need just to break even.'}
        />
        <Gauge
          value={Number(result.riskScore)}
          min={0}
          max={100}
          label="Leverage risk"
          unit=""
          bands={[{ to: 35, tone: 'cyan' }, { to: 65, tone: 'violet' }, { to: 100, tone: 'rose' }]}
          caption="Risk rises as the maintenance requirement eats into the equity that cushions the position."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Equity change by market move</div>
          <Bars data={result.ladder} suffix="%" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Red bars are margin-call territory. Leverage turns the same market move into a multiple of the equity change, and the loss side is always the faster one.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Position mechanics</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Own equity</span><span>{result.cash.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Borrowed</span><span>{result.loan.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Position</span><span>{result.pos.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Leverage</span><span className="text-cyan-j">{result.leverage.toFixed(2)}×</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Initial margin needed</span><span className={result.initialOk ? '' : 'text-rose-400'}>{(result.inst.initial * 100).toFixed(0)}% = {result.initialRequired.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Maintenance</span><span>{result.maintenanceRatio.toFixed(0)}% = {result.maintenanceReq.toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Margin ratio now</span><span>{result.marginRatio.toFixed(2)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Interest</span><span>{result.totalInterest.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Fees round trip</span><span>{(result.entryFees + result.exitFees).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Breakeven move</span><span>{result.breakEvenMove.toFixed(3)}%</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Instrument', value: result.inst.label },
                { label: 'Days held', value: String(result.holdDays) },
                { label: 'Stop', value: (result.stop * 100).toFixed(1) + '%', tone: result.stopIsSafe ? undefined : 'rose' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Scenario ladder</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Move</th><th className="py-1 text-right">Equity after</th><th className="py-1 text-right">Change</th><th className="py-1 pr-2 text-right">Margin ratio</th></tr>
              </thead>
              <tbody>
                {result.ladder.map((row) => (
                  <tr key={row.label} className={`border-t border-border/40 ${row.called ? 'text-rose-400' : ''}`}>
                    <td className="py-1 pl-2">{row.label}</td>
                    <td className="py-1 text-right">{row.equityAfter.toFixed(0)}</td>
                    <td className="py-1 text-right">{row.value.toFixed(1)}%</td>
                    <td className="py-1 pr-2 text-right">{row.ratio.toFixed(1)}%{row.called ? ' · CALL' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Stop-loss versus liquidation</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Stop distance</span><span>{(result.stop * 100).toFixed(2)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Liquidation distance</span><span>{result.liquidationBuffer.toFixed(2)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Buffer between them</span><span className={result.stopIsSafe ? 'text-cyan-j' : 'text-rose-400'}>{result.stopMargin.toFixed(2)}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Equity if the stop fires</span><span>{result.stopEquity.toFixed(0)}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.stopIsSafe
              ? 'The stop fires first, so the worst case is the planned loss plus costs. Slippage in a fast market can still make it worse than planned.'
              : 'Liquidation happens first, which means the broker decides your exit price and charges for it. Reduce the size or add cash until the stop leads.'}
          </p>
          <div className="mt-3">
            <div className="mb-1 font-mono-j text-[9px] uppercase text-muted-foreground">Cash to double the buffer</div>
            <div className="font-mono-j text-sm text-cyan-j">{result.cashToDoubleBuffer.toFixed(0)}</div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Leverage" value={result.leverage.toFixed(2) + '×'} mono sub={result.inst.label} />
        <Stat label="To liquidation" value={result.liquidationBuffer.toFixed(1) + '%'} mono sub="adverse move" />
        <Stat label="Holding cost" value={result.roundTripCost.toFixed(0)} mono sub="interest and fees" />
        <Stat label="Breakeven move" value={result.breakEvenMove.toFixed(2) + '%'} mono sub="just to cover costs" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Risk notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Full risk sheet</div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How margin actually works</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Initial margin is what the broker wants to open the trade. Maintenance margin is what keeps it open. The gap between them is your survival room.</p>
            <p>· A margin call is not a warning you have time to consider. Many brokers close positions automatically once the maintenance ratio is breached.</p>
            <p>· Liquidation sells at the worst possible moment, by design. The price that triggers it is the price at which everyone else is selling too.</p>
            <p>· Leverage multiplies the equity change, not the price change. A 10× position moving 5% against you is a 50% loss of your own money.</p>
            <p>· Interest accrues every day including weekends, so a leveraged position held for weeks costs meaningfully more than the headline rate suggests.</p>
            <p>· Short positions have no cap on loss while long positions can only go to zero. That asymmetry matters enormously when you are levered.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Margin regimes</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Instrument</th><th className="py-1 text-right">Initial</th><th className="py-1 text-right">Maint.</th><th className="py-1 pr-2 text-right">Borrow</th></tr>
              </thead>
              <tbody>
                {INSTRUMENTS.map((entry) => (
                  <tr key={entry.id} className={`border-t border-border/40 ${entry.id === result.inst.id ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{entry.label}</td>
                    <td className="py-1 text-right">{(entry.initial * 100).toFixed(0)}%</td>
                    <td className="py-1 text-right">{(entry.maintenance * 100).toFixed(0)}%</td>
                    <td className="py-1 pr-2 text-right">{entry.borrow}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Typical regulated retail figures. Brokers, jurisdictions and products vary substantially, and crypto venues routinely change both the leverage and the maintenance requirement when volatility rises.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Liquidation is calculated as the adverse move at which your equity equals the maintenance requirement, using the margin regime you select. Real brokers compute this across a portfolio, include
          spread and funding, and can raise requirements at any time. This is a risk illustration, not a brokerage statement.
        </p>
      </Panel>
    </ToolShell>
  );
}