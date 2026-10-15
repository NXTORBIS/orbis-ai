import { useMemo, useState } from 'react';
import { PartyPopper } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const STYLES = [
  { id: 'cocktail', label: 'Cocktail and canapes', mains: 150, sides: 60, dessert: 60, note: 'Bite-sized, eaten standing. Allow 12 to 15 pieces per person.' },
  { id: 'buffet', label: 'Buffet', mains: 350, sides: 150, dessert: 120, note: 'People take more than they eat, so plan the buffer deliberately.' },
  { id: 'dinner', label: 'Seated dinner', mains: 300, sides: 180, dessert: 130, note: 'Portions are controlled, which makes this the easiest to cost.' },
  { id: 'bbq', label: 'Barbecue', mains: 400, sides: 150, dessert: 100, note: 'Outdoor eating and longer events push consumption up noticeably.' },
  { id: 'birthday', label: 'Birthday party', mains: 250, sides: 120, dessert: 150, note: 'Cake plus buffet. Children eat less but take more.' },
];

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PartyPlanner() {
  const [adults, setAdults] = useState('20');
  const [children, setChildren] = useState('4');
  const [hours, setHours] = useState('4');
  const [style, setStyle] = useState('buffet');
  const [alcohol, setAlcohol] = useState(true);
  const [veg, setVeg] = useState('6');
  const [vegan, setVegan] = useState('2');
  const [glutenFree, setGlutenFree] = useState('2');
  const [costs, setCosts] = useState({ beer: '1.4', wine: '7', spirits: '18', food: '9', soft: '0.6' });

  const setCost = (key, value) => setCosts((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => {
    const grown = Math.max(0, Number(adults) || 0);
    const kids = Math.max(0, Number(children) || 0);
    const duration = Math.max(1, Number(hours) || 1);
    const chosen = STYLES.find((entry) => entry.id === style) || STYLES[1];
    const guests = grown + kids;
    const childFactor = 0.6;

    const servingHours = duration;
    const alcoholDrinks = alcohol ? grown * (2 + Math.max(0, servingHours - 1)) : 0;
    const softDrinks = (grown * (0.8 + 0.5 * servingHours)) + kids * (1 + 0.7 * servingHours);

    const beerDrinks = Math.round(alcoholDrinks * 0.45);
    const wineDrinks = Math.round(alcoholDrinks * 0.35);
    const spiritDrinks = alcoholDrinks - beerDrinks - wineDrinks;

    const beerBottles = Math.ceil(beerDrinks / 1);
    const wineBottles = Math.ceil(wineDrinks / 5);
    const spiritBottles = Math.ceil(spiritDrinks / 22);
    const softLitres = Math.ceil(softDrinks * 0.33);

    const grams = (entryFactor) => ((grown + kids * childFactor) * entryFactor) / 1000;
    const mains = grams(chosen.mains);
    const sides = grams(chosen.sides);
    const dessert = grams(chosen.dessert);
    const foodWeight = mains + sides + dessert;

    const plates = Math.ceil(guests * 1.5);
    const cutlery = Math.ceil(guests * 1.2);
    const cups = Math.ceil(guests * 2.5);
    const napkins = Math.ceil(guests * 3);
    const iceKg = Math.ceil((guests * 0.5 + (beerBottles + wineBottles + softLitres) * 0.4) * 10) / 10;
    const binBags = Math.max(2, Math.ceil(guests / 8));

    const drinkCost = beerBottles * (Number(costs.beer) || 0) + wineBottles * (Number(costs.wine) || 0) + spiritBottles * (Number(costs.spirits) || 0) + softLitres * (Number(costs.soft) || 0);
    const foodCost = foodWeight * (Number(costs.food) || 0);
    const extras = guests * 1.5;
    const total = drinkCost + foodCost + extras;

    const prepHours = Math.max(1, Math.round((foodWeight * 4 + guests * 0.35) / 2) / 2);

    return {
      grown, kids, guests, duration, chosen, alcoholDrinks, softDrinks, beerDrinks, wineDrinks, spiritDrinks,
      beerBottles, wineBottles, spiritBottles, softLitres, mains, sides, dessert, foodWeight,
      plates, cutlery, cups, napkins, iceKg, binBags, drinkCost, foodCost, extras, total, prepHours,
      vegPortions: Math.ceil(guests * ((Number(veg) || 0) / 100)),
      veganPortions: Math.ceil(guests * ((Number(vegan) || 0) / 100)),
      glutenFreePortions: Math.ceil(guests * ((Number(glutenFree) || 0) / 100)),
      perHead: guests ? total / guests : 0,
      drinksPerAdult: grown ? alcoholDrinks / grown : 0,
    };
  }, [adults, children, hours, style, alcohol, veg, vegan, glutenFree, costs]);

  const report = useMemo(() => [
    result.guests + ' guests (' + result.grown + ' adults, ' + result.kids + ' children) for ' + result.duration + ' hours · ' + result.chosen.label,
    '',
    'Drinks: ' + result.beerBottles + ' beers, ' + result.wineBottles + ' bottles of wine, ' + result.spiritBottles + ' bottles of spirits, ' + result.softLitres + ' litres of soft drinks',
    'Ice: about ' + result.iceKg + ' kg',
    '',
    'Food: ' + result.mains.toFixed(1) + ' kg mains, ' + result.sides.toFixed(1) + ' kg sides, ' + result.dessert.toFixed(1) + ' kg dessert (' + result.foodWeight.toFixed(1) + ' kg total)',
    'Dietary: ' + result.vegPortions + ' vegetarian, ' + result.veganPortions + ' vegan, ' + result.glutenFreePortions + ' gluten free portions',
    '',
    'Serving: ' + result.plates + ' plates, ' + result.cutlery + ' cutlery sets, ' + result.cups + ' cups, ' + result.napkins + ' napkins, ' + result.binBags + ' bin bags',
    'Prep time: about ' + result.prepHours + ' hours',
    '',
    'Budget: drinks ' + money(result.drinkCost) + ' · food ' + money(result.foodCost) + ' · extras ' + money(result.extras) + ' · total ' + money(result.total) + ' (' + money(result.perHead) + ' per head)',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="party-planner"
      icon={PartyPopper}
      title="Party Food & Drink Planner"
      desc="Guest count, duration and style into quantities that actually work — bottles, kilos, ice, plates and cups, with dietary portions and a full budget."
      state={{ adults, children, hours, style, alcohol, veg, vegan, glutenFree, costs }}
      onRestore={(restored) => {
        if (restored.adults !== undefined) setAdults(String(restored.adults));
        if (restored.children !== undefined) setChildren(String(restored.children));
        if (restored.hours !== undefined) setHours(String(restored.hours));
        if (restored.style) setStyle(restored.style);
        if (restored.alcohol !== undefined) setAlcohol(!!restored.alcohol);
        if (restored.veg !== undefined) setVeg(String(restored.veg));
        if (restored.vegan !== undefined) setVegan(String(restored.vegan));
        if (restored.glutenFree !== undefined) setGlutenFree(String(restored.glutenFree));
        if (restored.costs) setCosts((current) => ({ ...current, ...restored.costs }));
      }}
      exportText={report}
      exportName="party-plan.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Adults"><input value={adults} onChange={(e) => setAdults(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Children"><input value={children} onChange={(e) => setChildren(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="How long, hours"><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Alcohol served">
          <Seg value={alcohol ? 'yes' : 'no'} onChange={(value) => setAlcohol(value === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        </Field>
      </div>

      <Seg value={style} onChange={setStyle} options={STYLES.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <p className="text-[11px] text-muted-foreground">{result.chosen.note}</p>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Estimated total"
          value={money(result.total)}
          sub={money(result.perHead) + ' per head for ' + result.guests + ' guests. That covers ' + result.beerBottles + ' beers, ' + result.wineBottles + ' bottles of wine, ' + result.spiritBottles + ' bottles of spirits, ' + result.foodWeight.toFixed(1) + ' kg of food and the serving items.'}
        />
        <Ring
          value={result.drinksPerAdult}
          max={Math.max(4, result.drinksPerAdult)}
          label="Drinks per adult"
          sub={result.alcoholDrinks + ' alcoholic drinks across ' + result.duration + ' hours — the two in the first hour, one an hour after rule'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Drinks to buy</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Beer, 330 ml bottles</span><span className="text-cyan-j">{result.beerBottles}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wine, 750 ml bottles</span><span className="text-cyan-j">{result.wineBottles}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Spirits, 700 ml bottles</span><span className="text-cyan-j">{result.spiritBottles}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Soft drinks</span><span>{result.softLitres} litres</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Ice</span><span>{result.iceKg} kg</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Drinks budget</span><span className="text-cyan-j">{money(result.drinkCost)}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The split follows how parties actually drink: roughly 45% beer, 35% wine and 20% spirits. A wine bottle pours about five decent glasses, and a spirits
            bottle about twenty-two single measures.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Food quantities</div>
          <Bars
            data={[
              { label: 'Mains', value: Number(result.mains.toFixed(2)) },
              { label: 'Sides', value: Number(result.sides.toFixed(2)) },
              { label: 'Dessert', value: Number(result.dessert.toFixed(2)) },
            ]}
            format={(value) => value.toFixed(1)}
            suffix=" kg"
            highlightLast={false}
          />
          <div className="mt-2 space-y-1 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Vegetarian portions</span><span>{result.vegPortions}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Vegan portions</span><span>{result.veganPortions}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Gluten free portions</span><span>{result.glutenFreePortions}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Children are counted at 60% of an adult portion. These are per-person weights, so {result.guests} guests at {result.chosen.label.toLowerCase()} works out to {result.foodWeight.toFixed(1)} kg in total.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Serving items and budget</span>
            <CopyBtn value={report} label="Copy the list" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Plates</span><span>{result.plates}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cutlery sets</span><span>{result.cutlery}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cups and glasses</span><span>{result.cups}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Napkins</span><span>{result.napkins}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Bin bags</span><span>{result.binBags}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Food budget</span><span>{money(result.foodCost)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Extras and decor</span><span>{money(result.extras)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Total</span><span className="text-cyan-j">{money(result.total)}</span></div>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Prices per unit</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Beer per bottle"><input value={costs.beer} onChange={(e) => setCost('beer', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            <Field label="Wine per bottle"><input value={costs.wine} onChange={(e) => setCost('wine', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            <Field label="Spirits per bottle"><input value={costs.spirits} onChange={(e) => setCost('spirits', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            <Field label="Food per kg"><input value={costs.food} onChange={(e) => setCost('food', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            <Field label="Soft drink per litre"><input value={costs.soft} onChange={(e) => setCost('soft', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            <Field label="Dietary percentages">
              <div className="flex gap-1.5">
                <input value={veg} onChange={(e) => setVeg(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
                <input value={vegan} onChange={(e) => setVegan(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
                <input value={glutenFree} onChange={(e) => setGlutenFree(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </div>
            </Field>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The three dietary fields are percentages of the guest list: vegetarian, vegan and gluten free. Ask for these when invitations go out rather than on the day.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Timeline for the day</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· {result.prepHours} hours of preparation is the realistic figure for this guest count. Shopping is additional.</p>
            <p>· Ice and drinks into the fridge or cool boxes first, at least two hours before anyone arrives.</p>
            <p>· Food out 60 to 90 minutes after the start time for a buffet, once early drinks have settled.</p>
            <p>· Cold items out first, hot items in batches so nothing sits warm for an hour. Replenish rather than putting everything out at once.</p>
            <p>· Dessert roughly two hours in, and cake, if there is any, later still — it is the last thing anyone actually wants early.</p>
            <p>· Bin bags out and a cleaning plan before the last guests leave, not after.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Quantity rules that save a party</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Two drinks in the first hour, then one per person per hour. Heavier early, steadier later — it is how consumption actually behaves.</p>
            <p>· Ice is always underestimated. {result.iceKg} kg sounds like a lot until it is in the bowl.</p>
            <p>· Offer at least as much non-alcoholic choice as alcoholic. Guests who are driving or not drinking should not be left with water.</p>
            <p>· Label everything you can. A folded card in front of each dish prevents the same four questions all evening.</p>
            <p>· Over-catering by about 10% is cheaper than running out, and leftovers are a gift to the host rather than a waste.</p>
            <p>· Cups go missing at roughly twice the rate guests drink, which is why the count is 2.5 per person.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Guests', value: String(result.guests) },
                { label: 'Per head', value: money(result.perHead) },
                { label: 'Prep', value: result.prepHours + ' h' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Guests" value={String(result.guests)} mono sub={result.grown + ' adults, ' + result.kids + ' children'} />
        <Stat label="Drinks" value={String(result.alcoholDrinks + Math.round(result.softDrinks))} mono sub={result.alcoholDrinks + ' alcoholic'} />
        <Stat label="Food" value={result.foodWeight.toFixed(1) + ' kg'} mono sub={result.chosen.label} />
        <Stat label="Total" value={money(result.total)} mono sub={money(result.perHead) + ' a head'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic behind the quantities</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>alcoholic drinks = adults × (2 + hours − 1)</p>
          <p>soft drinks = adults × (0.8 + 0.5 × hours) + children × (1 + 0.7 × hours)</p>
          <p>food = (adults + 0.6 × children) × grams per head per course</p>
          <p>ice = guests × 0.5 kg + drinks × 0.4 kg</p>
          <p className="text-cyan-j">Here: {result.grown} adults × (2 + {Math.max(0, result.duration - 1)}) = {result.alcoholDrinks} drinks, split {result.beerDrinks} beer, {result.wineDrinks} wine, {result.spiritDrinks} spirits.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These are planning figures built on standard catering rules of thumb and real consumption patterns, not a guarantee for your particular guests. Weather, the
          room, the music and how well everyone knows each other all move the numbers by 20% either way.
        </p>
      </Panel>
    </ToolShell>
  );
}