import { useMemo, useState } from 'react';
import { Luggage, Plus, RefreshCw, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const TYPES = [
  { id: 'city', label: 'City break' },
  { id: 'beach', label: 'Beach' },
  { id: 'business', label: 'Business' },
  { id: 'hiking', label: 'Hiking' },
  { id: 'camping', label: 'Camping' },
  { id: 'ski', label: 'Ski' },
];

const TEMPLATE = [
  { name: 'Passport / ID', group: 'Documents', qty: 1, always: true },
  { name: 'Tickets and bookings', group: 'Documents', qty: 1, always: true },
  { name: 'Travel insurance details', group: 'Documents', qty: 1, always: true },
  { name: 'Bank cards', group: 'Documents', qty: 1, always: true },
  { name: 'Toothbrush', group: 'Toiletries', qty: 1, always: true },
  { name: 'Deodorant', group: 'Toiletries', qty: 1, always: true },
  { name: 'Painkillers', group: 'Toiletries', qty: 1, always: true },
  { name: 'Sunscreen', group: 'Toiletries', qty: 1, weather: 'hot' },
  { name: 'Phone charger', group: 'Tech', qty: 1, always: true },
  { name: 'Power bank', group: 'Tech', qty: 1, always: true },
  { name: 'Earphones', group: 'Tech', qty: 1, always: true },
  { name: 'Travel adapter', group: 'Tech', qty: 1, types: ['business', 'city'] },
  { name: 'Laptop + charger', group: 'Tech', qty: 1, types: ['business'] },
  { name: 'Underwear', group: 'Clothing', perDay: 1, countDays: true },
  { name: 'Socks', group: 'Clothing', perDay: 1, countDays: true },
  { name: 'T-shirts', group: 'Clothing', perDay: 1, countDays: true },
  { name: 'Trousers / jeans', group: 'Clothing', perDay: 0.4 },
  { name: 'Light jacket', group: 'Clothing', qty: 1, weather: 'mild' },
  { name: 'Warm coat', group: 'Clothing', qty: 1, weather: 'cold' },
  { name: 'Thermal base layers', group: 'Clothing', perDay: 0.5, weather: 'cold' },
  { name: 'Rain shell', group: 'Clothing', qty: 1, weather: 'wet' },
  { name: 'Swimwear', group: 'Clothing', qty: 2, types: ['beach', 'city'] },
  { name: 'Sandals', group: 'Clothing', qty: 1, types: ['beach'] },
  { name: 'Walking shoes', group: 'Clothing', qty: 1, types: ['hiking', 'city', 'camping'] },
  { name: 'Smart outfit', group: 'Clothing', qty: 1, types: ['business'] },
  { name: 'Hat and gloves', group: 'Clothing', qty: 1, weather: 'cold' },
  { name: 'Sun hat', group: 'Clothing', qty: 1, weather: 'hot' },
  { name: 'Hiking boots', group: 'Clothing', qty: 1, types: ['hiking'] },
  { name: 'Tent and pegs', group: 'Gear', qty: 1, types: ['camping'] },
  { name: 'Sleeping bag', group: 'Gear', qty: 1, types: ['camping'] },
  { name: 'Water bottle', group: 'Gear', qty: 1, types: ['hiking', 'camping', 'ski'] },
  { name: 'Head torch', group: 'Gear', qty: 1, types: ['camping', 'hiking'] },
  { name: 'Dry bag', group: 'Gear', qty: 1, types: ['hiking', 'camping'] },
  { name: 'Ski goggles', group: 'Gear', qty: 1, types: ['ski'] },
  { name: 'First-aid kit', group: 'Health', qty: 1, types: ['hiking', 'camping', 'beach'] },
  { name: 'Insect repellent', group: 'Health', qty: 1, weather: 'hot' },
  { name: 'Prescription medicine', group: 'Health', qty: 1, always: true },
];

const BUILD = (types, days, weather, wet, laundry) => {
  const chosen = TEMPLATE.filter((item) => {
    if (item.always) return true;
    if (item.types && !item.types.some((type) => types.includes(type))) return false;
    if (item.weather && item.weather !== weather && !(item.weather === 'wet' && wet)) return false;
    return true;
  });

  return chosen.map((item, index) => {
    let quantity = item.qty || 0;
    if (item.perDay) {
      const needed = Math.max(1, Math.ceil(item.perDay * days));
      quantity = laundry ? Math.max(2, Math.ceil(needed / 3)) : needed;
    }
    if (item.countDays && !laundry) quantity = Math.max(1, Math.ceil(item.perDay * (days + 1)));
    return { id: `${item.name}-${index}`, name: item.name, group: item.group, qty: quantity, checked: false, custom: false };
  });
};

export default function PackingList() {
  const [types, setTypes] = useState(['city']);
  const [days, setDays] = useState('5');
  const [weather, setWeather] = useState('mild');
  const [wet, setWet] = useState(false);
  const [laundry, setLaundry] = useState(false);
  const [custom, setCustom] = useState([]);
  const [newItem, setNewItem] = useState('');
  const [checked, setChecked] = useState({});
  const [generation, setGeneration] = useState(0);

  const list = useMemo(() => {
    const generated = BUILD(types, Math.max(1, Number(days) || 1), weather, wet, laundry);
    return [...generated, ...custom].map((item) => ({ ...item, checked: !!checked[item.id] }));
  }, [types, days, weather, wet, laundry, custom, checked, generation]);

  const grouped = useMemo(() => {
    const order = ['Documents', 'Clothing', 'Toiletries', 'Tech', 'Gear', 'Health', 'Other'];
    const groups = {};
    list.forEach((item) => {
      const key = order.includes(item.group) ? item.group : 'Other';
      groups[key] = groups[key] || [];
      groups[key].push(item);
    });
    return order.filter((key) => groups[key]?.length).map((key) => ({ key, items: groups[key] }));
  }, [list]);

  const totalItems = list.reduce((sum, item) => sum + item.qty, 0);
  const packedItems = list.filter((item) => item.checked).reduce((sum, item) => sum + item.qty, 0);
  const packedLines = list.filter((item) => item.checked).length;

  const toggle = (id) => setChecked((current) => ({ ...current, [id]: !current[id] }));

  const addCustom = () => {
    const name = newItem.trim();
    if (!name) return;
    setCustom((current) => [...current, { id: `custom-${Date.now()}`, name, group: 'Other', qty: 1, checked: false, custom: true }]);
    setNewItem('');
  };

  const report = [
    `${TYPES.filter((type) => types.includes(type.id)).map((type) => type.label).join(' + ') || 'Trip'} · ${days} days · ${weather}${wet ? ' and wet' : ''}${laundry ? ' · laundry available' : ''}`,
    '',
    ...grouped.flatMap((group) => [`${group.key}`, ...group.items.map((item) => `  [${item.checked ? 'x' : ' '}] ${item.name}${item.qty > 1 ? ` ×${item.qty}` : ''}`)]),
  ].join('\n');

  return (
    <ToolShell
      toolId="packing-list"
      icon={Luggage}
      title="Packing List Builder"
      desc="Describe the trip and get a complete, quantity-aware packing list — with laundry, weather and trip type actually taken into account."
      state={{ types, days, weather, wet, laundry, custom, checked }}
      onRestore={(restored) => {
        if (Array.isArray(restored.types) && restored.types.length) setTypes(restored.types);
        if (restored.days !== undefined) setDays(String(restored.days));
        if (restored.weather) setWeather(restored.weather);
        if (typeof restored.wet === 'boolean') setWet(restored.wet);
        if (typeof restored.laundry === 'boolean') setLaundry(restored.laundry);
        if (Array.isArray(restored.custom)) setCustom(restored.custom);
        if (restored.checked && typeof restored.checked === 'object') setChecked(restored.checked);
      }}
      exportText={report}
      exportName="packing-list.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            onClick={() => setTypes((current) => (current.includes(type.id) ? current.filter((id) => id !== type.id) : [...current, type.id]))}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${types.includes(type.id) ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Days away">
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Weather">
          <Seg value={weather} onChange={setWeather} options={[{ value: 'hot', label: 'Hot' }, { value: 'mild', label: 'Mild' }, { value: 'cold', label: 'Cold' }]} />
        </Field>
        <ToggleRow label="Expect rain" checked={wet} onChange={setWet} />
        <ToggleRow label="Laundry available" checked={laundry} onChange={setLaundry} hint="Cuts clothing quantities hard" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Items on the list"
          value={totalItems}
          sub={`${list.length} lines across ${grouped.length} groups · ${days} days, ${weather}${wet ? ', wet' : ''}`}
        />
        <Ring
          value={packedItems}
          max={totalItems || 1}
          tone={packedItems >= totalItems ? 'emerald' : 'cyan'}
          label="Packed"
          sub={`${packedLines} of ${list.length} lines ticked · ${totalItems - packedItems} items to go`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            placeholder="Add something of your own…"
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
          />
          <button type="button" onClick={addCustom} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        <button
          type="button"
          onClick={() => { setChecked({}); setCustom([]); setGeneration((value) => value + 1); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Start over
        </button>
        <CopyBtn value={report} label="Copy list" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {grouped.map((group) => (
          <div key={group.key} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">{group.key}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{group.items.reduce((sum, item) => sum + item.qty, 0)} items</span>
            </div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition ${item.checked ? 'border-cyan-j bg-cyan-j/20 text-cyan-j' : 'border-border/70 text-transparent'}`}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className={`flex-1 text-left text-[11px] transition ${item.checked ? 'text-muted-foreground line-through' : ''}`}
                  >
                    {item.name}
                    {item.qty > 1 && <span className="ml-1 font-mono-j text-[10px] text-cyan-j">×{item.qty}</span>}
                  </button>
                  {item.custom && (
                    <button type="button" onClick={() => setCustom((current) => current.filter((row) => row.id !== item.id))} className="text-muted-foreground transition hover:text-rose-400">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total items" value={String(totalItems)} mono />
        <Stat label="Packed" value={String(packedItems)} mono />
        <Stat label="Lines" value={String(list.length)} mono />
        <Stat label="Trip" value={`${days} days`} sub={`${weather}${wet ? ' · wet' : ''}${laundry ? ' · laundry' : ''}`} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What people always forget</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Chargers for the devices you actually pack, including the watch and the headphones — count cables against devices.</p>
          <p>· Prescriptions in the original packaging, plus a copy of the prescription itself if you are crossing a border.</p>
          <p>· One complete change of clothes in your carry-on if you are checking a bag; {days > 7 ? 'on a trip this long, a lost bag on day one is a real problem.' : 'it costs nothing and saves a trip.'}</p>
          <p>· {weather === 'cold' ? 'Gloves and a hat — cold hands ruin a day faster than anything else on this list.' : weather === 'hot' ? 'Sunscreen and a refillable bottle; both cost a fortune at the airport.' : 'A light layer for evenings; mild days get cold quickly after sunset.'}</p>
          <p>· Snacks and an empty bottle for the travel day itself, not the destination.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Trip types', value: types.length || 1 },
              { label: 'Clothing lines', value: list.filter((item) => item.group === 'Clothing').length },
              { label: 'Laundry', value: laundry ? 'yes' : 'no' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Quantities scale with the trip: day-counted items get one per day, less if laundry is available, and everything conditional (cold-weather
          layers, camping gear, smart outfits) only appears when it applies. A five-day city break with laundry in the building needs about half the
          clothes of the same trip without it — which is usually the difference between hand luggage and a checked bag.
        </p>
      </Panel>
    </ToolShell>
  );
}