import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import CrystalScene from '@jarvis/components/toolkit/physics/next/CrystalScene';

export default function CrystalView({ params: p, r, a, onChange }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label={`Selected (${p.h}${p.k}${p.l}) reflection`} value={r.angle === null ? 'No angle' : r.angle.toFixed(4)} unit={r.angle === null ? '' : '° 2θ'} tone={r.allowed ? 'cyan' : 'rose'} sub={!r.allowed ? 'Systematically absent / invalid indices' : r.angle === null ? 'Wavelength too large for this spacing' : 'Bragg law: λ = 2d sin θ'} />
      <Stat label="Interplanar spacing" value={r.d === null ? 'Undefined for (000)' : `${r.d.toFixed(5)} Å`} sub="d = a/√(h²+k²+l²)" mono />
      <Stat label="Atoms per conventional cell" value={String(r.atoms)} sub={p.lattice.toUpperCase()} mono />
      <Stat label="Allowed powder families in view" value={String(a.peaks.length)} sub="Grouped coincident reflections · 10–140°" mono />
    </div>
    <Panel className="space-y-3">
      <h3 className="text-sm font-semibold">Powder X-ray diffraction — computed, broadened and normalised</h3>
      <ScientificPlot series={[{ label: 'Relative intensity', points: a.spectrum }]} xLabel="Scattering angle 2θ (degrees)" yLabel="Intensity (maximum = 100)" height={300} />
      <p className="text-xs leading-relaxed text-muted-foreground">Peak positions follow Bragg’s law; BCC permits even h+k+l and FCC requires all indices to share parity. Equivalent plane multiplicities weight the Gaussian peak areas. Smaller crystallites and larger microstrain broaden the pattern.</p>
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">Miller-plane orientation</h3><CrystalScene params={p} /><p className="text-[11px] text-muted-foreground">Amber lines solve hx + ky = integer on the z = 0 slice, with x and y in cell units. Atom markers depict the slice grid, not a full three-dimensional unit cell.</p></Panel>
      <Panel className="space-y-3"><h3 className="text-sm font-semibold">Reflection index — select a family</h3>
        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="p-2">Family</th><th className="p-2">2θ</th><th className="p-2">d (Å)</th><th className="p-2">FWHM</th></tr></thead><tbody>
            {a.peaks.map((peak) => <tr key={peak.angle} className="border-t border-border/50"><td className="p-2"><button type="button" className="rounded px-1 text-cyan-j underline underline-offset-2" onClick={() => onChange({ ...p, h: peak.h, k: peak.k, l: peak.l })} aria-label={`Select reflection ${peak.h} ${peak.k} ${peak.l}`}>{peak.families.map((family) => `(${family.join('')})`).join(', ')}</button></td><td className="p-2 font-mono">{peak.angle.toFixed(3)}°</td><td className="p-2 font-mono">{peak.d.toFixed(4)}</td><td className="p-2 font-mono">{peak.width.toFixed(3)}°</td></tr>)}
          </tbody></table>
          {!a.peaks.length && <p className="p-3 text-xs text-muted-foreground">No allowed reflections in this angular window. Adjust wavelength or lattice spacing.</p>}
        </div>
      </Panel>
    </div>
  </>;
}