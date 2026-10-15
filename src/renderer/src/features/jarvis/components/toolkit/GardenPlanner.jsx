import { useMemo, useState } from 'react';
import { Sprout, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CROPS = [
  { label: 'Tomato', offset: 8, indoor: true, days: 80, spacing: 60, family: 'Nightshade' },
  { label: 'Pepper', offset: 9, indoor: true, days: 85, spacing: 45, family: 'Nightshade' },
  { label: 'Cucumber', offset: 3, indoor: true, days: 60, spacing: 45, family: 'Cucurbit' },
  { label: 'Courgette', offset: 4, indoor: true, days: 55, spacing: 90, family: 'Cucurbit' },
  { label: 'Lettuce', offset: -4, indoor: false, days: 45, spacing: 25, family: 'Leaf' },
  { label: 'Spinach', offset: -4, indoor: false, days: 45, spacing: 15, family: 'Leaf' },
  { label: 'Kale', offset: -3, indoor: false, days: 60, spacing: 40, family: 'Brassica' },
  { label: 'Radish', offset: -4, indoor: false, days: 25, spacing: 5, family: 'Brassica' },
  { label: 'Carrot', offset: -2, indoor: false, days: 70, spacing: 5, family: 'Root' },
  { label: 'Beetroot', offset: -3, indoor: false, days: 60, spacing: 10, family: 'Root' },
  { label: 'Onion', offset: -4, indoor: false, days: 100, spacing: 10, family: 'Allium' },
  { label: 'Potato', offset: -2, indoor: false, days: 90, spacing: 30, family: 'Nightshade' },
  { label: 'Peas', offset: -6, indoor: false, days: 65, spacing: 8, family: 'Legume' },
  { label: 'Beans', offset: 1, indoor: false, days: 60, spacing: 15, family: 'Legume' },
  { label: 'Basil', offset: 2, indoor: true, days: 60, spacing: 25, family: 'Herb' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const shortDate = (value) => value.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longMonth = (value) => value.toLocaleDateString(undefined, { month: 'long' });

const blank = () => ({ id: Math.random().toString(36).slice(2), crop: 'Custom crop', offset: '0', indoor: false, days: '60', spacing: '30', plants: '10' });

export default function GardenPlanner() {
  const [frost, setFrost] = useState('2026-04-15');
  const [rows, setRows] = useState([
    { id: 'a', crop: 'Tomato', offset: '8', indoor: true, days: '80', spacing: '60', plants: '12' },
    { id: 'b', crop: 'Lettuce', offset: '-4', indoor: false, days: '45', spacing: '25', plants: '24' },
    { id: 'c', crop: 'Carrot', offset: '-2', indoor: false, days: '70', spacing: '5', plants: '120' },
    { id: 'd', crop: 'Beans', offset: '1', indoor: false, days: '60', spacing: '15', plants: '40' },
    { id: 'e', crop: 'Courgette', offset: '4', indoor: true, days: '55', spacing: '90', plants: '3' },
  ]);
  const [mode, setMode] = useState('dates');

  const set = (id, key, value) => setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const frostDate = new Date(frost);
    const valid = !Number.isNaN(frostDate.getTime());
    const base = valid ? frostDate : new Date();

    const planned = rows.map((row) => {
      const offset = Number(row.offset) || 0;
      const days = Number(row.days) || 60;
      const spacing = Math.max(2, Number(row.spacing) || 30);
      const plants = Math.max(0, Number(row.plants) || 0);
      const sow = new Date(base.getTime() + offset * 7 * 86400000);
      const harvest = new Date(sow.getTime() + days * 86400000);
      const density = Math.pow(100 / spacing, 2);
      const area = density ? plants / density : 0;
      const seeds = Math.ceil(plants * 1.5);
      return {
        ...row, offset, days, spacing, plants, sow, harvest, density, area, seeds,
        sowLabel: shortDate(sow),
        harvestLabel: shortDate(harvest),
        harvestMonthLabel: longMonth(harvest),
        sowMonth: sow.getMonth(),
        harvestMonth: harvest.getMonth(),
        timing: offset < 0 ? Math.abs(offset) + ' weeks before the frost date' : offset === 0 ? 'on the frost date' : offset + ' weeks after the frost date',
      };
    });

    const totalArea = planned.reduce((sum, row) => sum + row.area, 0);
    const totalPlants = planned.reduce((sum, row) => sum + row.plants, 0);
    const sortedBySow = [...planned].sort((a, b) => a.sow - b.sow);
    const sortedByHarvest = [...planned].sort((a, b) => b.harvest - a.harvest);
    const earliest = sortedBySow[0] || null;
    const latest = sortedByHarvest[0] || null;
    const busiest = planned.reduce((best, row) => (row.plants > (best.plants || 0) ? row : best), {});
    const families = {};
    planned.forEach((row) => {
      const entry = CROPS.find((crop) => crop.label === row.crop);
      const family = entry ? entry.family : 'Other';
      families[family] = (families[family] || 0) + 1;
    });

    return {
      planned, totalArea, totalPlants, earliest, latest, busiest,
      families: Object.entries(families).map(([label, count]) => ({ label, count })),
      succession: planned.filter((row) => row.days <= 70 && !row.indoor),
      frostLabel: valid ? base.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : 'not set',
      frostRisk: planned.filter((row) => row.offset < 0).length,
      earliestText: earliest ? earliest.crop + ' on ' + earliest.sowLabel : 'not set',
      latestText: latest ? latest.crop + ' into ' + latest.harvestMonthLabel : 'not set',
    };
  }, [rows, frost]);

  const report = useMemo(() => [
    'Last frost date: ' + result.frostLabel,
    result.planned.length + ' crops, ' + result.totalPlants + ' plants, about ' + result.totalArea.toFixed(2) + ' m² of bed space',
    '',
    ...result.planned.map((row) => [
      row.crop,
      row.indoor ? 'sow indoors' : 'sow outside',
      row.sowLabel + ' (' + row.timing + ')',
      'harvest from ' + row.harvestLabel,
      row.plants + ' plants',
      row.spacing + ' cm apart',
      row.area.toFixed(2) + ' m²',
      'about ' + row.seeds + ' seeds',
    ].join(' · ')),
    '',
    'Families to rotate: ' + result.families.map((entry) => entry.label + ' ×' + entry.count).join(', '),
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="garden-planner"
      icon={Sprout}
      title="Vegetable Garden Planner"
      desc="Last frost date into a real sowing calendar — what to start when, indoors or out, how many plants fit the space, seeds to buy and the family rotation to avoid."
      state={{ frost, rows, mode }}
      onRestore={(restored) => {
        if (typeof restored.frost === 'string') setFrost(restored.frost);
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={report}
      exportName="garden-plan.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Last expected frost date"><input type="date" value={frost} onChange={(e) => setFrost(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Show dates or bed space">
          <Seg value={mode} onChange={setMode} options={[{ value: 'dates', label: 'Sowing dates' }, { value: 'space', label: 'Bed space' }]} />
        </Field>
        <Field label="Frost-sensitive crops">
          <div className="flex h-9 items-center font-mono-j text-sm text-muted-foreground">{result.frostRisk} sown before the frost date</div>
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Quick add from the crop list</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">frost date {result.frostLabel}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CROPS.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => setRows((current) => current.some((row) => row.crop === entry.label)
                ? current
                : [...current, {
                  id: Math.random().toString(36).slice(2),
                  crop: entry.label,
                  offset: String(entry.offset),
                  indoor: entry.indoor,
                  days: String(entry.days),
                  spacing: String(entry.spacing),
                  plants: '10',
                }])}
              className={rows.some((row) => row.crop === entry.label)
                ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
                : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
            >
              {entry.label}{entry.indoor ? ' · indoors' : ''}
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Your crops</div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-6">
              <Field label="Crop"><input value={row.crop} onChange={(e) => set(row.id, 'crop', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Weeks from frost"><input value={row.offset} onChange={(e) => set(row.id, 'offset', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Days to harvest"><input value={row.days} onChange={(e) => set(row.id, 'days', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Spacing, cm"><input value={row.spacing} onChange={(e) => set(row.id, 'spacing', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Plants"><input value={row.plants} onChange={(e) => set(row.id, 'plants', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => set(row.id, 'indoor', !row.indoor)}
                  className={row.indoor
                    ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2 py-1.5 text-[10px] text-cyan-j'
                    : 'rounded-lg border border-border/70 px-2 py-1.5 text-[10px] text-muted-foreground'}
                >
                  {row.indoor ? 'Indoors' : 'Outside'}
                </button>
                <button type="button" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a crop
        </button>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The season at a glance</div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-13 gap-1 text-[9px] text-muted-foreground">
            <span />
            {MONTHS.map((month) => <span key={month} className="text-center">{month.slice(0, 1)}</span>)}
          </div>
          {result.planned.map((row) => (
            <div key={row.id} className="grid grid-cols-13 items-center gap-1">
              <span className="truncate text-[10px]">{row.crop.slice(0, 9)}</span>
              {MONTHS.map((month, index) => {
                const sowing = index === row.sowMonth;
                const harvesting = index >= row.harvestMonth && index <= Math.min(11, row.harvestMonth + 2);
                return (
                  <span
                    key={month}
                    className="h-3 rounded-sm"
                    style={{ backgroundColor: sowing ? 'hsl(var(--cyan))' : harvesting ? 'hsl(var(--cyan) / 0.28)' : 'hsl(var(--muted))' }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-3 rounded-sm bg-cyan-j" /> sowing</span>
          <span className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-3 rounded-sm bg-cyan-j/30" /> harvesting</span>
          <span className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-3 rounded-sm bg-muted" /> nothing to do</span>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Bed space needed"
          value={result.totalArea.toFixed(1)}
          unit="m²"
          sub={result.totalPlants + ' plants across ' + result.planned.length + ' crops. Earliest sowing is ' + result.earliestText + ', and the last harvest runs ' + result.latestText + '.'}
        />
        <Ring
          value={result.planned.length}
          max={Math.max(6, result.planned.length)}
          label="Crops planned"
          sub={result.families.length + ' plant families, which determines the rotation'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Each crop, in detail</span>
            <CopyBtn value={report} label="Copy the plan" />
          </div>
          <div className="max-h-72 overflow-auto space-y-1.5">
            {result.planned.map((row) => (
              <div key={row.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{row.crop}</span>
                  <span className="font-mono-j text-cyan-j">{row.plants} plants · {row.spacing} cm</span>
                </div>
                <div className="mt-0.5 font-mono-j text-[10px] text-muted-foreground">
                  {row.indoor ? 'Start indoors ' : 'Sow outside '}{row.sowLabel} · harvest from {row.harvestLabel} · {row.area.toFixed(2)} m² · about {row.seeds} seeds
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <div className="space-y-3">
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Summary</div>
            <div className="space-y-1.5 font-mono-j text-[11px]">
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Last frost</span><span>{result.frostLabel}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Total plants</span><span className="text-cyan-j">{result.totalPlants}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Bed area</span><span className="text-cyan-j">{result.totalArea.toFixed(2)} m²</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Biggest planting</span><span>{(result.busiest.crop || 'none') + ' · ' + (result.busiest.plants || 0)}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Plants per m²</span><span>{result.totalArea ? (result.totalPlants / result.totalArea).toFixed(1) : '—'}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Succession crops</span><span>{result.succession.length}</span></div>
            </div>
          </Panel>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Plant families here</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              {result.families.map((entry) => (
                <p key={entry.label}>· {entry.label} — {entry.count} crop{entry.count === 1 ? '' : 's'}</p>
              ))}
              <p className="mt-2">· Never follow a family with itself in the same bed. Rotate leaf, root, legume and brassica groups round so soil-borne problems do not build up.</p>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Crops" value={String(result.planned.length)} mono sub={result.totalPlants + ' plants'} />
        <Stat label="Bed area" value={result.totalArea.toFixed(2) + ' m²'} mono />
        <Stat label="First sowing" value={result.earliest ? result.earliest.sowLabel : '—'} mono sub={result.earliest ? result.earliest.crop : ''} />
        <Stat label="Last harvest" value={result.latest ? result.latest.harvestLabel : '—'} mono sub={result.latest ? result.latest.crop : ''} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting the season right</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The frost date is an average, not a promise. It can be two weeks either way, so keep fleece handy for anything sown before it.</p>
            <p>· Days to harvest count from sowing indoors rather than from planting out. Starting tomatoes eight weeks before the frost date gives them a long enough season to ripen.</p>
            <p>· Harden off anything raised indoors over a week — a few hours outside each day, extended gradually. Straight from a warm windowsill into a cold bed sets a plant back a fortnight.</p>
            <p>· Lettuce, radish, spinach and beetroot are the succession crops: a small row every two to three weeks feeds a kitchen for months instead of for a fortnight.</p>
            <p>· Tall crops shade their neighbours. Put tomatoes, beans and courgettes where their shadow falls away from the low salads.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Spacing, yield and seeds</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The spacing figure sets plants per square metre — {result.totalArea ? (result.totalPlants / result.totalArea).toFixed(1) : '0'} here. Crowding increases disease and lowers total yield even though it looks like more.</p>
            <p>· Buy about half again as much seed as the planted count, which is what the seeds column assumes. Germination rates vary and gaps always appear.</p>
            <p>· Root crops do not transplant well. Carrot and radish go straight into their final position and are thinned in place.</p>
            <p>· Feed by need: leaf crops want nitrogen, fruiting crops want potassium once they flower, root crops want neither heavily.</p>
            <p>· Keep a note of what worked and where. A season of your own records beats any general guide, because it is specific to your soil and light.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Crops', value: String(result.planned.length) },
                { label: 'Area', value: result.totalArea.toFixed(1) + ' m²' },
                { label: 'Families', value: String(result.families.length) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic behind the plan</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>sowing date = frost date + (weeks from frost × 7 days), negative meaning before</p>
          <p>harvest date = sowing date + days to harvest</p>
          <p>plants per m² = (100 ÷ spacing in cm)²</p>
          <p>bed area = plants ÷ plants per m²</p>
          <p className="text-cyan-j">Check: {(result.busiest.crop || 'a crop') + ' at ' + (result.busiest.spacing || 0) + ' cm fits ' + (result.busiest.density ? result.busiest.density.toFixed(1) : '0') + ' plants per square metre.'}</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Crop timings are typical figures for a temperate climate with a defined frost date, and they shift with variety, soil temperature and how much sun the bed gets. Treat
          the calendar as a plan for the season and adjust it from what your own ground tells you.
        </p>
      </Panel>
    </ToolShell>
  );
}