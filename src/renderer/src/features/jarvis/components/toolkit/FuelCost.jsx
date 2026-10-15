import { useMemo, useState } from 'react';
import { Fuel } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const CURRENCIES = [['$', 'USD  $'], ['₹', 'INR  ₹'], ['€', 'EUR  €'], ['£', 'GBP  £']];
const KM_PER_MILE = 1.609344;
const LITRES_PER_GALLON = 3.785411784;

const money = (value, symbol) => `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FuelCost() {
  const [distance, setDistance] = useState('420');
  const [distanceUnit, setDistanceUnit] = useState('km');
  const [consumption, setConsumption] = useState('16');
  const [consumptionUnit, setConsumptionUnit] = useState('kmpl');
  const [price, setPrice] = useState('1.45');
  const [priceUnit, setPriceUnit] = useState('litre');
  const [roundTrip, setRoundTrip] = useState(false);
  const [passengers, setPassengers] = useState('2');
  const [symbol, setSymbol] = useState('$');

  const result = useMemo(() => {
    const rawDistance = Math.max(0, Number(distance) || 0);
    const oneWayKm = distanceUnit === 'mi' ? rawDistance * KM_PER_MILE : rawDistance;
    const totalKm = oneWayKm * (roundTrip ? 2 : 1);

    const c = Math.max(0.0001, Number(consumption) || 0);
    const kmPerLitre = consumptionUnit === 'kmpl' ? c : consumptionUnit === 'l100' ? 100 / c : c * 0.425144;

    const litres = kmPerLitre > 0 ? totalKm / kmPerLitre : 0;
    const fuelUnits = priceUnit === 'litre' ? litres : litres / LITRES_PER_GALLON;
    const fuelPrice = Math.max(0, Number(price) || 0);
    const total = fuelUnits * fuelPrice;
    const people = Math.max(1, Math.floor(Number(passengers) || 1));

    return {
      totalKm,
      litres,
      fuelUnits,
      total,
      perPerson: total / people,
      perKm: totalKm ? total / totalKm : 0,
      kmPerLitre,
      mpg: kmPerLitre / 0.425144,
    };
  }, [distance, distanceUnit, consumption, consumptionUnit, price, priceUnit, roundTrip, passengers]);

  return (
    <ToolShell
      toolId="fuel-cost"
      icon={Fuel}
      title="Fuel Cost Calculator"
      desc="Work out the fuel a trip needs and what it costs — with or without passengers."
      state={{ distance, distanceUnit, consumption, consumptionUnit, price, priceUnit, roundTrip, passengers, symbol }}
      onRestore={(saved) => {
        setDistance(saved.distance); setDistanceUnit(saved.distanceUnit);
        setConsumption(saved.consumption); setConsumptionUnit(saved.consumptionUnit);
        setPrice(saved.price); setPriceUnit(saved.priceUnit);
        setRoundTrip(!!saved.roundTrip); setPassengers(saved.passengers); setSymbol(saved.symbol);
      }}
      exportText={JSON.stringify(result, null, 2)}
      exportName="fuel-cost.json"
      exportMime="application/json"
    >
      <Seg value={symbol} onChange={setSymbol} options={CURRENCIES.map(([value, label]) => ({ value, label }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Distance (one way)">
          <div className="flex gap-2">
            <input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="km">km</option>
              <option value="mi">miles</option>
            </select>
          </div>
        </Field>
        <Field label="Fuel economy">
          <div className="flex gap-2">
            <input value={consumption} onChange={(e) => setConsumption(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={consumptionUnit} onChange={(e) => setConsumptionUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="kmpl">km / litre</option>
              <option value="l100">litres / 100 km</option>
              <option value="mpg">miles / gallon</option>
            </select>
          </div>
        </Field>
        <Field label="Fuel price">
          <div className="flex gap-2">
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="litre">per litre</option>
              <option value="gallon">per gallon</option>
            </select>
          </div>
        </Field>
        <Field label="Passengers splitting the cost">
          <input value={passengers} onChange={(e) => setPassengers(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <ToggleRow label="Round trip (double the distance)" checked={roundTrip} onChange={setRoundTrip} />
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Total fuel cost</div>
        <div className="mt-1 font-display text-4xl font-bold text-cyan-j">{money(result.total, symbol)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{result.totalKm.toFixed(1)} km · {result.litres.toFixed(2)} litres{roundTrip ? ' · round trip' : ''}</div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Cost per person" value={money(result.perPerson, symbol)} />
        <Stat label="Cost per km" value={money(result.perKm, symbol)} />
        <Stat label={priceUnit === 'litre' ? 'Litres needed' : 'Gallons needed'} value={result.fuelUnits.toFixed(2)} />
        <Stat label="Litres needed" value={result.litres.toFixed(2)} />
        <Stat label="Your economy" value={`${result.kmPerLitre.toFixed(1)} km/l`} />
        <Stat label="In miles per gallon" value={`${result.mpg.toFixed(1)} mpg`} />
        <Stat label="Distance" value={`${result.totalKm.toFixed(1)} km`} />
        <Stat label="Fuel price used" value={`${money(Number(price) || 0, symbol)} / ${priceUnit}`} />
      </div>
      <p className="text-[11px] text-muted-foreground">Consumption is converted between km/l, litres per 100 km and US mpg, so any combination of units gives the same trip cost.</p>
    </ToolShell>
  );
}