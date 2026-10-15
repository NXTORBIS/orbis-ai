import { useMemo, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const BAGS = [
  { label: '20 kg bag', yield: 0.01, weight: 20 },
  { label: '25 kg bag', yield: 0.0125, weight: 25 },
  { label: '40 kg bag', yield: 0.02, weight: 40 },
  { label: '60 lb bag', yield: 0.0127, weight: 27.2 },
  { label: '80 lb bag', yield: 0.017, weight: 36.3 },
];

const MIXES = [
  { id: 'c15', label: '1 : 3 : 6 — footing and mass fill', cement: 1, sand: 3, aggregate: 6, strength: 15 },
  { id: 'c20', label: '1 : 2 : 3 — general slabs and paths', cement: 1, sand: 2, aggregate: 3, strength: 20 },
  { id: 'c25', label: '1 : 1.5 : 3 — structural floors', cement: 1, sand: 1.5, aggregate: 3, strength: 25 },
  { id: 'c30', label: '1 : 1 : 2 — high strength', cement: 1, sand: 1, aggregate: 2, strength: 30 },
];

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const blank = () => ({ id: Math.random().toString(36).slice(2), name: 'Slab', shape: 'rect', a: '', b: '', depth: '0.1', count: '1' });

export default function ConcreteCalculator() {
  const [jobs, setJobs] = useState([
    { id: 'a', name: 'Patio slab', shape: 'rect', a: '4', b: '3', depth: '0.1', count: '1' },
    { id: 'b', name: 'Path', shape: 'rect', a: '8', b: '0.9', depth: '0.075', count: '1' },
    { id: 'c', name: 'Post footings', shape: 'round', a: '0.3', b: '', depth: '0.6', count: '6' },
  ]);
  const [unit, setUnit] = useState('m');
  const [bagIndex, setBagIndex] = useState(0);
  const [bagPrice, setBagPrice] = useState('7.5');
  const [wastage, setWastage] = useState('7');
  const [mix, setMix] = useState('c20');
  const [mixMode, setMixMode] = useState('bags');

  const set = (id, key, value) => setJobs((current) => current.map((job) => (job.id === id ? { ...job, [key]: value } : job)));

  const result = useMemo(() => {
    const factor = unit === 'ft' ? 0.0283168 : 1;
    const bag = BAGS[bagIndex];
    const waste = Math.max(0, Number(wastage) || 0) / 100;
    const chosen = MIXES.find((entry) => entry.id === mix) || MIXES[1];

    const table = jobs.map((job) => {
      const a = Number(job.a) || 0;
      const b = Number(job.b) || 0;
      const depth = Number(job.depth) || 0;
      const count = Math.max(1, Number(job.count) || 1);
      const single = job.shape === 'round' ? Math.PI * Math.pow(a / 2, 2) * depth : a * b * depth;
      const volume = single * count * factor;
      return { ...job, a, b, depth, count, single, volume, withWaste: volume * (1 + waste) };
    });

    const volume = table.reduce((sum, job) => sum + job.volume, 0);
    const withWaste = table.reduce((sum, job) => sum + job.withWaste, 0);
    const bags = Math.ceil(withWaste / bag.yield);
    const weight = bags * bag.weight;

    const dryVolume = withWaste * 1.54;
    const parts = chosen.cement + chosen.sand + chosen.aggregate;
    const cementVolume = (dryVolume * chosen.cement) / parts;
    const cementKg = cementVolume * 1440;
    const cementBags = Math.ceil(cementKg / 50);
    const sandVolume = (dryVolume * chosen.sand) / parts;
    const aggregateVolume = (dryVolume * chosen.aggregate) / parts;
    const water = weight * 0.5;

    return {
      table, volume, withWaste, bags, weight, bag, chosen, cementBags, cementKg, sandVolume, aggregateVolume, water,
      materialCost: bags * (Number(bagPrice) || 0),
      readyMix: withWaste >= 1,
      heaviest: [...table].sort((a, b) => b.volume - a.volume)[0],
    };
  }, [jobs, unit, bagIndex, bagPrice, wastage, mix]);

  const report = useMemo(() => [
    'Concrete volume: ' + result.volume.toFixed(3) + ' m³ (' + (result.volume * 35.3147).toFixed(1) + ' cubic feet)',
    'With ' + wastage + '% allowance: ' + result.withWaste.toFixed(3) + ' m³',
    '',
    mixMode === 'bags'
      ? 'Premixed bags: ' + result.bags + ' × ' + result.bag.label + ' (' + result.weight.toFixed(0) + ' kg of mix)'
      : 'Mixed on site: ' + result.chosen.label + ' · ' + result.cementBags + ' × 50 kg cement, ' + result.sandVolume.toFixed(3) + ' m³ sand, ' + result.aggregateVolume.toFixed(3) + ' m³ aggregate',
    'Water: about ' + result.water.toFixed(0) + ' litres',
    'Estimated material cost: ' + money(result.materialCost),
    '',
    ...result.table.map((job) => [job.name || 'Job', job.shape === 'round' ? 'Ø' + job.a : job.a + ' × ' + job.b, job.depth + ' deep', '×' + job.count, job.volume.toFixed(3) + ' m³'].join(' · ')),
  ].join('\n'), [result, wastage, mixMode]);

  return (
    <ToolShell
      toolId="concrete-calculator"
      icon={Layers}
      title="Concrete & Slab Calculator"
      desc="Slabs, paths and post footings into cubic metres, bags of premix or a full cement, sand and aggregate mix — with depth tolerance, water and cost."
      state={{ jobs, unit, bagIndex, bagPrice, wastage, mix, mixMode }}
      onRestore={(restored) => {
        if (Array.isArray(restored.jobs) && restored.jobs.length) setJobs(restored.jobs);
        if (restored.unit) setUnit(restored.unit);
        if (restored.bagIndex !== undefined) setBagIndex(Number(restored.bagIndex) || 0);
        if (restored.bagPrice !== undefined) setBagPrice(String(restored.bagPrice));
        if (restored.wastage !== undefined) setWastage(String(restored.wastage));
        if (restored.mix) setMix(restored.mix);
        if (restored.mixMode) setMixMode(restored.mixMode);
      }}
      exportText={report}
      exportName="concrete.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">What you are pouring</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.volume.toFixed(3)} m³ total</span>
        </div>
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-7">
              <Field label="Job"><input value={job.name} onChange={(e) => set(job.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Shape">
                <select value={job.shape} onChange={(e) => set(job.id, 'shape', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  <option value="rect">Rectangle</option>
                  <option value="round">Round post</option>
                </select>
              </Field>
              <Field label={job.shape === 'round' ? 'Diameter (' + unit + ')' : 'Length (' + unit + ')'}>
                <input value={job.a} onChange={(e) => set(job.id, 'a', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label={'Width (' + unit + ')'}>
                <input value={job.b} onChange={(e) => set(job.id, 'b', e.target.value)} disabled={job.shape === 'round'} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm disabled:opacity-40" />
              </Field>
              <Field label={'Depth (' + unit + ')'}><input value={job.depth} onChange={(e) => set(job.id, 'depth', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="How many"><input value={job.count} onChange={(e) => set(job.id, 'count', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <div className="flex items-end gap-2">
                <span className="font-mono-j text-[11px] text-cyan-j">{(job.shape === 'round' ? Math.PI * Math.pow((Number(job.a) || 0) / 2, 2) * (Number(job.depth) || 0) : (Number(job.a) || 0) * (Number(job.b) || 0) * (Number(job.depth) || 0)) * Math.max(1, Number(job.count) || 1) * (unit === 'ft' ? 0.0283168 : 1) > 0 ? (((job.shape === 'round' ? Math.PI * Math.pow((Number(job.a) || 0) / 2, 2) * (Number(job.depth) || 0) : (Number(job.a) || 0) * (Number(job.b) || 0) * (Number(job.depth) || 0)) * Math.max(1, Number(job.count) || 1) * (unit === 'ft' ? 0.0283168 : 1)).toFixed(3) + ' m³') : '—'}</span>
                <button type="button" onClick={() => setJobs((current) => current.filter((entry) => entry.id !== job.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setJobs((current) => [...current, blank()])} className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-20">
            <Plus className="h-3.5 w-3.5" /> Add a job
          </button>
          <Seg value={unit} onChange={setUnit} options={[{ value: 'm', label: 'Metres' }, { value: 'ft', label: 'Feet' }]} />
          <div className="w-40">
            <Field label={'Extra allowance · ' + wastage + '%'}>
              <input type="range" min={0} max={20} step={1} value={wastage} onChange={(e) => setWastage(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <Seg value={mixMode} onChange={setMixMode} options={[{ value: 'bags', label: 'Premixed bags' }, { value: 'mix', label: 'Cement, sand and gravel' }]} />
          {mixMode === 'bags' ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {BAGS.map((entry, index) => (
                  <button
                    key={entry.label}
                    type="button"
                    onClick={() => setBagIndex(index)}
                    className={index === bagIndex
                      ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
                      : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
                  >
                    {entry.label} · {entry.yield} m³
                  </button>
                ))}
              </div>
              <Field label="Price per bag"><input value={bagPrice} onChange={(e) => setBagPrice(e.target.value)} inputMode="decimal" className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              <p className="text-[11px] text-muted-foreground">
                Bag yields are the printed figures for a general-purpose premix, which include the aggregate already. Beyond about a cubic metre the ready-mix truck is
                cheaper, faster and far less work.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <Field label="Nominal mix">
                <select value={mix} onChange={(e) => setMix(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {MIXES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </select>
              </Field>
              <p className="text-[11px] text-muted-foreground">
                Dry volume is taken as 1.54 times the wet volume, which is the standard allowance for the voids that fill when the mix is compacted. Cement is measured at
                1440 kg per cubic metre and sold in 50 kg bags.
              </p>
            </div>
          )}
        </Panel>
        <div className="space-y-3">
          <Hero
            tone={result.readyMix ? 'amber' : 'emerald'}
            label={mixMode === 'bags' ? 'Bags of premix needed' : 'Cement bags needed'}
            value={String(mixMode === 'bags' ? result.bags : result.cementBags)}
            sub={mixMode === 'bags'
              ? 'That is about ' + result.weight.toFixed(0) + ' kg of mix and roughly ' + result.water.toFixed(0) + ' litres of water for ' + result.withWaste.toFixed(3) + ' m³ of finished concrete.'
              : 'For ' + result.withWaste.toFixed(3) + ' m³ of ' + result.chosen.label + ' you also need ' + result.sandVolume.toFixed(2) + ' m³ of sand and ' + result.aggregateVolume.toFixed(2) + ' m³ of aggregate.'}
          />
          <Ring
            value={result.withWaste}
            max={Math.max(1, result.withWaste * 1.5)}
            tone={result.readyMix ? 'amber' : 'emerald'}
            label="Volume to order"
            sub={result.volume.toFixed(3) + ' m³ measured, ' + result.withWaste.toFixed(3) + ' m³ with the allowance'}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Volume by job</div>
          <Bars
            data={result.table.map((job) => ({ label: (job.name || 'Job').slice(0, 10), value: Number(job.volume.toFixed(3)) }))}
            format={(value) => value.toFixed(2)}
            suffix=" m³"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.heaviest && result.heaviest.volume > 0 ? result.heaviest.name + ' is the largest pour at ' + result.heaviest.volume.toFixed(3) + ' m³ — plan the mixing and the helpers around that one first.' : 'Add dimensions to see the volumes.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Materials and cost</span>
            <CopyBtn value={report} label="Copy the list" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Measured volume</span><span>{result.volume.toFixed(3)} m³</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">With allowance</span><span className="text-cyan-j">{result.withWaste.toFixed(3)} m³</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Bags</span><span className="text-cyan-j">{result.bags} × {result.bag.label}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Weight of mix</span><span>{result.weight.toFixed(0)} kg</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Water</span><span>≈ {result.water.toFixed(0)} L</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cement at 1 : 2 : 3</span><span>{result.cementBags} bags of 50 kg</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Sand</span><span>{result.sandVolume.toFixed(3)} m³</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Aggregate</span><span>{result.aggregateVolume.toFixed(3)} m³</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Premix cost</span><span className="text-cyan-j">{money(result.materialCost)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Volume" value={result.withWaste.toFixed(3) + ' m³'} mono sub={result.volume.toFixed(3) + ' measured'} />
        <Stat label="Bags" value={String(result.bags)} mono sub={result.bag.label} />
        <Stat label="Mix weight" value={result.weight.toFixed(0) + ' kg'} mono sub="before water" />
        <Stat label="Cost" value={money(result.materialCost)} mono sub="premix only" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting the pour right</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Depth is where mistakes happen. A slab ordered at 100 mm but dug to 120 mm needs 20% more concrete, so measure the formwork rather than trusting the plan.</p>
            <p>· Order or mix 5 to 10% extra. Running short mid-pour leaves a cold joint that is a permanent weak line.</p>
            <p>· Water is the enemy of strength. Add only what the mix needs for workability — extra water to make it flow costs roughly 20% of the final strength.</p>
            <p>· Compact properly. Air pockets at the bottom and along the formwork are the usual causes of a surface that spalls a year later.</p>
            <p>· Cure it. Keep it damp for at least seven days; concrete gains most of its strength in the first week and needs moisture to do it.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Depth guides and site realities</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Paths and shed bases: 75 to 100 mm over compacted hardcore.</p>
            <p>· Patios and driveways for cars: 100 to 150 mm, thicker over soft ground.</p>
            <p>· Post footings: 600 to 900 mm deep and at least 3 times the post width, taken below the frost line.</p>
            <p>· Sub-base matters as much as thickness. 100 mm of compacted hardcore underneath prevents most cracking.</p>
            <p>· Cold weather below about 5 °C stops the set; hot, windy weather dries the surface before it cures. Both need covering.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Volume', value: result.withWaste.toFixed(2) + ' m³' },
                { label: 'Bags', value: String(result.bags) },
                { label: 'Cost', value: money(result.materialCost) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The working, step by step</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>Rectangle slab: length × width × depth</p>
          <p>Round footing: π × (diameter ÷ 2)² × depth</p>
          <p>Total = each shape × how many, then × (1 + allowance)</p>
          <p>Bags = total volume ÷ yield per bag, rounded up</p>
          <p>Cement, sand, aggregate = dry volume × ratio parts ÷ total parts</p>
          <p className="text-cyan-j">Dry volume = {result.withWaste.toFixed(3)} × 1.54 = {(result.withWaste * 1.54).toFixed(3)} m³ for a {result.chosen.label.split('—')[0].trim()} mix.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Mix ratios are nominal volume proportions, which is what site practice actually uses. Real strength depends on the water to cement ratio, the aggregate grading
          and the curing, so treat the bag count as a materials estimate rather than a structural specification.
        </p>
      </Panel>
    </ToolShell>
  );
}