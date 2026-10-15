import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Ring } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';

export default function NuclearView({ params: p, r, a }) {
  const binding = p.mode === 'binding', chain = p.mode === 'chain';
  const parentShare = r.parent / r.n0, daughterShare = r.daughter / r.n0;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label={binding ? 'Binding per nucleon' : 'Parent activity'} value={binding ? r.perNucleon.toFixed(4) : r.activity.toExponential(3)} unit={binding ? 'MeV' : 'Bq'} sub={binding ? 'Semi-empirical liquid-drop estimate' : 'One becquerel = one decay per second'} tone={binding ? 'violet' : 'cyan'} />
      <Stat label={binding ? 'Total binding energy' : 'Parent atoms remaining'} value={binding ? `${r.binding.toFixed(3)} MeV` : r.parent.toExponential(5)} sub={binding ? 'Positive binding means a lower mass than free nucleons' : `${(parentShare * 100).toFixed(3)}% of the initial parent atoms`} mono />
      <Stat label={binding ? 'Nuclear mass (no electrons)' : chain ? 'Daughter activity' : 'Parent half-life'} value={binding ? `${r.nuclearMass.toFixed(6)} u` : chain ? `${r.daughterActivity.toExponential(3)} Bq` : `${r.half.toPrecision(6)} days`} mono />
      <Stat label={binding ? 'Protons / neutrons' : 'Elapsed physical time'} value={binding ? `${p.z} / ${p.a - p.z}` : `${r.days.toPrecision(5)} days`} sub={binding ? `Mass number A = ${p.a}` : `${r.time.toFixed(3)} parent half-lives`} mono />
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="space-y-3 lg:col-span-2">
        <h3 className="text-sm font-semibold">{binding ? 'The binding-energy landscape' : chain ? 'Decay-chain populations' : 'An exponential, not a straight line'}</h3>
        <ScientificPlot series={binding ? [{ label: 'Binding per nucleon', points: a.binding }] : a.decay} xLabel={binding ? 'Mass number A' : 'Parent half-lives'} yLabel={binding ? 'Binding (MeV/nucleon)' : 'Fraction of initial atoms'} height={300} />
        <p className="text-xs leading-relaxed text-muted-foreground">{binding ? 'The curve follows the model’s approximate valley of stability. Coulomb repulsion and neutron/proton asymmetry compete with bulk and surface binding; this approximation does not prove an isotope is stable.' : chain ? 'The daughter builds up while parents feed it, then falls as its own decay wins. The equal-half-life case uses the analytic limit rather than dividing by a vanishing rate difference.' : 'N(t) = N₀·2^(−t/T½). Activity is λN in decays per second, with day-to-second conversion applied explicitly.'}</p>
      </Panel>
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{binding ? 'Mass defect' : 'Population snapshot'}</h3>
        {binding ? <>
          <Stat label="Mass converted to binding" value={`${(r.binding / 931.49410242).toFixed(6)} u`} sub="Δm = B / 931.494 MeV per u" mono />
          <p className="text-xs leading-relaxed text-muted-foreground">The nucleus is lighter than its separated nucleons. Negative binding values for highly asymmetric inputs mean this model does not predict a bound nucleus.</p>
        </> : <>
          <Ring value={parentShare * 100} label="Parent fraction" sub={`${(r.stable / r.n0 * 100).toFixed(2)}% stable products`} size={120} />
          <div className="grid grid-cols-10 gap-1" role="img" aria-label="Representative population of 100 atoms: cyan parent, bright daughter, muted stable">
            {Array.from({ length: 100 }, (_, i) => <span key={i} className={`aspect-square rounded-full ${i < Math.round(parentShare * 100) ? 'bg-cyan-j shadow-sm shadow-cyan-j/50' : i < Math.round((parentShare + daughterShare) * 100) ? 'bg-primary/70' : 'bg-muted'}`} />)}
          </div>
          <p className="text-[11px] text-muted-foreground">100 representative markers, rounded from expected fractions; cyan parent, bright daughter, muted stable.</p>
          {chain && <Stat label="Daughter population" value={r.daughter.toExponential(5)} sub={`${(daughterShare * 100).toFixed(3)}% of initial atoms`} mono />}
        </>}
      </Panel>
    </div>
  </>;
}