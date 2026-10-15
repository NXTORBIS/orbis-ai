import { useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Spark } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SERVICE_LEVELS = [
  { id: '90', label: '90%', z: 1.28 },
  { id: '95', label: '95%', z: 1.65 },
  { id: '98', label: '98%', z: 2.05 },
  { id: '99', label: '99%', z: 2.33 },
  { id: '99.9', label: '99.9%', z: 3.09 },
];

export default function ReorderPoint() {
  const [demand, setDemand] = useState('40');
  const [demandVariation, setDemandVariation] = useState('30');
  const [leadTime, setLeadTime] = useState('12');
  const [leadVariation, setLeadVariation] = useState('25');
  const [service, setService] = useState('95');
  const [unitCost, setUnitCost] = useState('18');
  const [orderCost, setOrderCost] = useState('75');
  const [holdingRate, setHoldingRate] = useState('22');
  const [seasonal, setSeasonal] = useState('1');
  const [stockOnHand, setStockOnHand] = useState('320');
  const [workingDays, setWorkingDays] = useState('250');
  const [extra, setExtra] = useState({ review: false, backorder: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const d = Math.max(0.1, Number(demand) || 1);
    const demandCv = Math.min(200, Math.max(0, Number(demandVariation) || 0)) / 100;
    const lt = Math.max(0.5, Number(leadTime) || 1);
    const ltCv = Math.min(200, Math.max(0, Number(leadVariation) || 0)) / 100;
    const z = (SERVICE_LEVELS.find((entry) => entry.id === service) || SERVICE_LEVELS[1]).z;
    const cost = Math.max(0.01, Number(unitCost) || 1);
    const sCost = Math.max(1, Number(orderCost) || 1);
    const hold = Math.max(1, Number(holdingRate) || 0) / 100;
    const season = Math.max(0.2, Number(seasonal) || 1);
    const onHand = Math.max(0, Number(stockOnHand) || 0);
    const days = Math.max(100, Number(workingDays) || 250);

    const sigmaDemand = d * demandCv;
    const sigmaDaily = sigmaDemand / Math.sqrt(days);
    const sigmaLead = Math.sqrt(lt * sigmaDaily ** 2 + (d * ltCv) ** 2 * lt);

    // Safety stock covers the variability of demand during the lead time.
    const safetyStock = z * sigmaLead * season;
    const leadDemand = d * lt * season;
    const reorderPoint = leadDemand + safetyStock;
    const maxStock = reorderPoint + Math.sqrt(2 * d * days * sCost / (cost * hold)) * 0.35;

    // Economic order quantity.
    const annualDemand = d * days;
    const eoq = Math.sqrt((2 * annualDemand * sCost) / (cost * hold));
    const ordersPerYear = annualDemand / Math.max(1, eoq);
    const orderInterval = days / ordersPerYear;
    const averageStock = eoq / 2 + safetyStock;
    const totalCost = (annualDemand / eoq) * sCost + averageStock * cost * hold;
    const purchaseCost = annualDemand * cost;
    const inventoryTurns = annualDemand / Math.max(1, averageStock);
    const daysOfSupply = averageStock / d;

    const gap = onHand - reorderPoint;
    const needsOrder = gap <= 0;
    const orderQty = needsOrder ? Math.max(eoq, reorderPoint - onHand + eoq) : 0;
    const coverDays = onHand / d;
    const stockoutRisk = onHand < leadDemand;

    // Stock projection over the next few cycles.
    const projection = [];
    let inventory = onHand;
    for (let week = 0; week <= 26; week += 1) {
      inventory -= d * 5 * season;
      if (inventory <= reorderPoint) inventory += eoq;
      inventory = Math.min(inventory, maxStock * 1.6);
      projection.push({ label: 'W' + week, value: Number(Math.max(0, inventory).toFixed(0)) });
    }

    const serviceTable = SERVICE_LEVELS.map((entry) => ({
      label: entry.label,
      value: Number((entry.z * sigmaLead * season).toFixed(0)),
    }));

    const sensitivity = [0.7, 0.85, 1, 1.15, 1.3].map((factor) => ({
      label: Math.round(factor * 100) + '%',
      value: Number((reorderPoint * factor).toFixed(0)),
    }));

    const warnings = [];
    if (stockoutRisk) warnings.push('On hand is below the demand expected during the lead time alone. A stockout is likely before any replenishment can arrive.');
    if (needsOrder) warnings.push('Stock has reached the reorder point. Raise an order for about ' + Math.round(orderQty) + ' units now.');
    if (ltCv > 0.5) warnings.push('Lead-time variability of ' + Math.round(ltCv * 100) + '% is the dominant risk. Negotiating more reliable delivery lowers safety stock far more than cutting average lead time.');
    if (demandCv > 0.8) warnings.push('Demand variability of ' + Math.round(demandCv * 100) + '% is very high, so the safety stock is doing heavy lifting. Shorter review cycles or a closer supplier would help.');
    if (eoq > 6 * d) warnings.push('The economic order quantity is ' + (eoq / d).toFixed(1) + ' days of demand, which is a large cycle. Check storage capacity and whether the holding cost assumption is realistic.');
    if (hold < 0.1) warnings.push('A holding rate below 10% usually ignores obsolescence, shrinkage and the cost of the space itself.');
    if (service === '99.9') warnings.push('Chasing 99.9% service roughly doubles safety stock compared with 95%, purely to cover the last fraction of demand. It is only worth it where a stockout is genuinely expensive.');
    if (extra.review) warnings.push('With periodic review, add half a review period of demand to the reorder point — stock is only checked at intervals, not continuously.');

    const report = [
      'REORDER POINT AND SAFETY STOCK',
      'Average daily demand ' + d.toFixed(1) + ' units, lead time ' + lt.toFixed(1) + ' days',
      '',
      'Daily demand standard deviation: ' + sigmaDaily.toFixed(2),
      'Lead-time demand: ' + leadDemand.toFixed(0) + ' units',
      'Combined lead-time sigma: ' + sigmaLead.toFixed(1) + ' units',
      'Service level ' + (SERVICE_LEVELS.find((entry) => entry.id === service) || SERVICE_LEVELS[1]).label + ' (z = ' + z + ')',
      'Safety stock: ' + safetyStock.toFixed(0) + ' units',
      'REORDER POINT: ' + Math.round(reorderPoint) + ' units',
      '',
      'Annual demand: ' + Math.round(annualDemand) + ' units',
      'EOQ: ' + Math.round(eoq) + ' units, about ' + ordersPerYear.toFixed(1) + ' orders a year',
      'Order interval: ' + orderInterval.toFixed(1) + ' working days',
      'Average inventory: ' + Math.round(averageStock) + ' units (' + daysOfSupply.toFixed(1) + ' days of supply)',
      'Inventory turns: ' + inventoryTurns.toFixed(1) + ' a year',
      '',
      'Ordering cost: ' + ((annualDemand / eoq) * sCost).toFixed(0) + ' a year',
      'Holding cost: ' + (averageStock * cost * hold).toFixed(0) + ' a year',
      'Combined inventory cost: ' + totalCost.toFixed(0) + ' a year',
      'Purchase value: ' + purchaseCost.toFixed(0) + ' a year',
      '',
      'On hand: ' + onHand.toFixed(0) + ' units, ' + coverDays.toFixed(1) + ' days of cover',
      needsOrder ? 'ACTION: order ' + Math.round(orderQty) + ' units' : 'Action: no order needed, ' + gap.toFixed(0) + ' units above the trigger',
    ].join('\n');

    return {
      d, demandCv, lt, ltCv, z, cost, sCost, hold, season, onHand, days, sigmaDemand, sigmaDaily, sigmaLead, safetyStock,
      leadDemand, reorderPoint, maxStock, annualDemand, eoq, ordersPerYear, orderInterval, averageStock, totalCost,
      purchaseCost, inventoryTurns, daysOfSupply, gap, needsOrder, orderQty, coverDays, stockoutRisk, projection,
      serviceTable, sensitivity, warnings, report,
    };
  }, [demand, demandVariation, leadTime, leadVariation, service, unitCost, orderCost, holdingRate, seasonal, stockOnHand, workingDays, extra]);

  return (
    <ToolShell
      toolId="reorder-point"
      icon={ShoppingCart}
      title="Reorder Point, Safety Stock & EOQ"
      desc="Demand and lead-time variability into a reorder point that holds a chosen service level, with the economic order quantity, inventory turns and a running stock projection."
      state={{ demand, demandVariation, leadTime, leadVariation, service, unitCost, orderCost, holdingRate, seasonal, stockOnHand, workingDays, extra }}
      onRestore={(restored) => {
        const map = { demand: setDemand, demandVariation: setDemandVariation, leadTime: setLeadTime, leadVariation: setLeadVariation, unitCost: setUnitCost, orderCost: setOrderCost, holdingRate: setHoldingRate, seasonal: setSeasonal, stockOnHand: setStockOnHand, workingDays: setWorkingDays };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.service) setService(restored.service);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="reorder-point.txt"
    >
      <Field label="Target service level"><Seg value={service} onChange={setService} options={SERVICE_LEVELS.map((entry) => ({ value: entry.id, label: entry.label }))} /></Field>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Average daily demand"><input value={demand} onChange={(e) => setDemand(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Demand variation, %"><input value={demandVariation} onChange={(e) => setDemandVariation(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Lead time, days"><input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Lead-time variation, %"><input value={leadVariation} onChange={(e) => setLeadVariation(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Unit cost"><input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Cost per order"><input value={orderCost} onChange={(e) => setOrderCost(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Holding cost, % per year"><input value={holdingRate} onChange={(e) => setHoldingRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Seasonal index"><input value={seasonal} onChange={(e) => setSeasonal(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Stock on hand"><input value={stockOnHand} onChange={(e) => setStockOnHand(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Working days a year"><input value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Periodic review rather than continuous" checked={extra.review} onChange={() => toggle('review')} hint="Adds half a review period" />
        <ToggleRow label="Backorders allowed" checked={extra.backorder} onChange={() => toggle('backorder')} hint="No lost sales, just delayed" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Trigger at ' + Math.round(result.reorderPoint) + ' units with a ' + (SERVICE_LEVELS.find((entry) => entry.id === service) || SERVICE_LEVELS[1]).label + ' service level'}
          value={Math.round(result.safetyStock)}
          unit="units safety stock"
          sub={'Lead-time demand is ' + Math.round(result.leadDemand) + ' units and the variability adds ' + Math.round(result.safetyStock) + '. On hand right now is ' + Math.round(result.onHand) + ', which is ' + Math.abs(Math.round(result.gap)) + ' units ' + (result.gap >= 0 ? 'above' : 'below') + ' the trigger with ' + result.coverDays.toFixed(1) + ' days of cover.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Stock position</div>
          <div className={`rounded-lg border px-3 py-2 text-sm ${result.stockoutRisk ? 'border-rose-500/50 bg-rose-500/10 text-rose-400' : result.needsOrder ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : 'border-cyan-j/40 bg-cyan-j/10 text-cyan-j'}`}>
            {result.stockoutRisk ? 'Stockout risk before delivery' : result.needsOrder ? 'Order now' : 'Covered'}
          </div>
          <div className="mt-3 space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Reorder point</span><span>{Math.round(result.reorderPoint)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Lead-time demand</span><span>{Math.round(result.leadDemand)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Safety stock</span><span className="text-cyan-j">{Math.round(result.safetyStock)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">EOQ</span><span>{Math.round(result.eoq)} units</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Order interval</span><span>{result.orderInterval.toFixed(1)} days</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Suggested order</span><span>{result.needsOrder ? Math.round(result.orderQty) + ' units' : 'none needed'}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Service', value: (SERVICE_LEVELS.find((entry) => entry.id === service) || SERVICE_LEVELS[1]).label },
                { label: 'Turns', value: result.inventoryTurns.toFixed(1) + '/yr' },
                { label: 'Cover', value: result.coverDays.toFixed(1) + ' days', tone: result.stockoutRisk ? 'rose' : undefined },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Stock projection over six months</span>
            <span className="font-mono-j text-[11px] text-muted-foreground">weekly buckets</span>
          </div>
          <Spark data={result.projection.map((point) => point.value)} width={480} height={54} />
          <div className="mt-2">
            <Bars data={result.projection.slice(0, 14)} suffix="" format={(v) => Math.round(v).toLocaleString()} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A sawtooth between the reorder point and the order arriving is exactly what a good policy looks like. A flat line at zero is what a bad one looks like.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Cost and efficiency</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Annual demand</span><span>{Math.round(result.annualDemand).toLocaleString()}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Average inventory</span><span>{Math.round(result.averageStock)} units</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Days of supply</span><span>{result.daysOfSupply.toFixed(1)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Inventory turns</span><span>{result.inventoryTurns.toFixed(1)} a year</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Ordering cost</span><span>{((result.annualDemand / result.eoq) * result.sCost).toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Holding cost</span><span>{(result.averageStock * result.cost * result.hold).toFixed(0)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Combined</span><span>{result.totalCost.toFixed(0)} a year</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Purchase value</span><span>{result.purchaseCost.toFixed(0)} a year</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Safety stock climbs with service level</div>
          <Bars data={result.serviceTable} suffix=" units" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The last percentage points of service are expensive. Going from 95% to 99.9% costs roughly twice the buffer, and only pays where a stockout is genuinely costly.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reorder point across demand scenarios</div>
          <Bars data={result.sensitivity} suffix=" units" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Recalculated at ±30% demand. A trigger that only works at the forecast is a trigger that fails in the first busy week.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Reorder point" value={String(Math.round(result.reorderPoint))} mono sub="units" />
        <Stat label="Safety stock" value={String(Math.round(result.safetyStock))} mono sub="against variability" />
        <Stat label="EOQ" value={String(Math.round(result.eoq))} mono sub="units per order" />
        <Stat label="Inventory turns" value={result.inventoryTurns.toFixed(1)} mono sub="times a year" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Inventory notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Full inventory sheet</div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Safety stock is mostly about variability</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Average demand only sets the baseline. Every unit of safety stock exists to cover the spread around it, not the average itself.</p>
            <p>· Lead-time variability is usually more damaging than demand variability. A supplier who sometimes takes twenty days forces far more stock than one who reliably takes twelve.</p>
            <p>· The service level is a business decision, not a maths one. Work out what a stockout actually costs before choosing 99.9%.</p>
            <p>· EOQ balances order cost against holding cost. If your holding rate ignores obsolescence and space, the answer will be too large.</p>
            <p>· Inventory turns are the health metric. Rising turns with the same service level means the policy is genuinely working.</p>
            <p>· Review the numbers seasonally. A trigger point set in a quiet month will empty the shelf in a busy one.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Service level factors</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Service level</th><th className="py-1 text-right">z factor</th><th className="py-1 text-right">Safety stock</th><th className="py-1 pr-2 text-left">Stockouts per year</th></tr>
              </thead>
              <tbody>
                {SERVICE_LEVELS.map((entry, index) => (
                  <tr key={entry.id} className={`border-t border-border/40 ${entry.id === service ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{entry.label}</td>
                    <td className="py-1 text-right">{entry.z.toFixed(2)}</td>
                    <td className="py-1 text-right">{result.serviceTable[index].value.toFixed(0)}</td>
                    <td className="py-1 pr-2">{['10', '5', '2', '1', '0.1'][index]} cycles</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The z factor assumes demand is roughly normally distributed. For lumpy, low-volume items, a Poisson or empirical approach fits better than this formula.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Calculated with the standard reorder point formula combining demand and lead-time variability, and the classic economic order quantity for lot sizing. Both assume stable, roughly normal demand;
          intermittently demanded items need a different method, and any promotional or seasonal spike should be layered on top of the trigger rather than absorbed by it.
        </p>
      </Panel>
    </ToolShell>
  );
}