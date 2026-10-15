import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import { BOHR } from '@jarvis/components/toolkit/engines/qtaimCore';

export default function QtaimBondDetails({ result, selected, onSelect }) {
  const entries = [...result.bonds.map((b, i) => ({ ...b, id: `b${i}`, label: `${result.atoms[b.i].sym}${b.i + 1}–${result.atoms[b.j].sym}${b.j + 1}`, signature: '(3,−1)' })), ...result.rings.map((r, i) => ({ ...r, id: `r${i}`, label: `Ring ${i + 1}`, signature: '(3,+1)' }))];
  const entry = entries.find(e => e.id === selected) ?? entries[0];
  let distance = 0;
  const density = entry?.path?.map((p, i) => { if (i) distance += Math.hypot(...p.map((v, j) => v - entry.path[i - 1][j])) * BOHR; return { x: distance, y: entry.rhoPath[i] }; }) ?? [];
  return <Panel className="space-y-3">
    <h3 className="text-sm font-semibold">Critical-point inspector</h3>
    <div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><thead className="text-muted-foreground"><tr><th className="p-2">Point</th><th>ρ</th><th>∇²ρ</th><th>Ellipticity</th><th>H</th><th>|V|/G</th></tr></thead><tbody>
      {entries.map(e => <tr key={e.id} className={e.id === entry?.id ? 'bg-cyan-j/10' : ''}><td className="p-2"><button className="text-cyan-j underline-offset-2 hover:underline" onClick={() => onSelect(e.id)}>{e.label} {e.signature}</button></td>{[e.rho, e.lap, e.eps, e.H, e.ratio].map((v, i) => <td key={i} className="px-2 font-mono">{v != null ? v.toFixed(4) : '—'}</td>)}</tr>)}
    </tbody></table></div>
    {!entry ? <p className="text-xs text-muted-foreground">No critical points found.</p> : <>
      <Hero label={`${entry.label} · electron density`} value={entry.rho.toFixed(5)} unit="a.u." sub={`∇ρ residual ${entry.cp.gradNorm.toExponential(2)} · ${entry.signature}`} />
      <div className="grid gap-2 sm:grid-cols-3"><Stat label="Hessian eigenvalues" value={entry.eigs.map(v => v.toFixed(4)).join(' · ')} mono /><Stat label="G · V · H (a.u.)" value={[entry.G, entry.V, entry.H].map(v => v.toFixed(5)).join(' · ')} mono /><Stat label="Position (Å)" value={entry.cp.x.map(v => (v * BOHR).toFixed(4)).join(' · ')} mono /></div>
      <p className="text-xs text-muted-foreground">{entry.H < 0 && entry.ratio > 2 ? 'Shared-shell indicator in this approximate density model.' : 'Energy-density indicators are model estimates, not a wavefunction-based bond classification.'}</p>
      {density.length > 0 && <ScientificPlot series={[{ label: 'ρ along bond path', points: density }]} xLabel="Path distance (Å)" yLabel="ρ (e/bohr³)" />}
    </>}
  </Panel>;
}