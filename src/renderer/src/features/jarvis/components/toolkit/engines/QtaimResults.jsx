import { useState } from 'react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Bars } from '@jarvis/components/toolkit/kit/premium';
import ProjectionScene from '@jarvis/components/toolkit/engines/ProjectionScene';
import QtaimDensitySlice from '@jarvis/components/toolkit/engines/QtaimDensitySlice';
import QtaimBondDetails from '@jarvis/components/toolkit/engines/QtaimBondDetails';

export default function QtaimResults({ result }) {
  const [selected, setSelected] = useState('b0'), bas = result.basins;
  const points = [...result.atoms.map((a, i) => ({ p: a.p, label: `${a.sym}${i + 1}`, radius: 10 + Math.sqrt(a.z) * 2, kind: 'atom' })), ...result.bonds.map((b, i) => ({ p: b.cp.x, label: `B${i + 1}`, id: `b${i}`, radius: 4 })), ...result.rings.map((r, i) => ({ p: r.cp.x, label: `R${i + 1}`, id: `r${i}`, radius: 5 }))];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><Hero label="Bond critical points" value={result.bonds.length} sub={`${result.rings.length} ring critical points`} /><Stat label="Electron budget" value={`${bas.totalElectrons.toFixed(4)} / ${bas.totalZ}`} sub="Integrated / exact electron count" /><Stat label="Charge closure error" value={`${(100 * Math.abs(result.summary.chargeSum) / bas.totalZ).toFixed(3)}%`} sub={`${bas.unresolved} unresolved of ${bas.gridPoints} grid points`} /></div>
    <Panel className="space-y-3"><h3 className="text-sm font-semibold">Molecular topology · select a critical point</h3><ProjectionScene points={points} lines={result.bonds.map((b, i) => ({ points: b.path, id: `b${i}` }))} onSelect={setSelected} selected={selected} label="Rotatable molecular bond-path topology" /></Panel>
    <QtaimBondDetails result={result} selected={selected} onSelect={setSelected} />
    <div className="grid gap-4 lg:grid-cols-2"><QtaimDensitySlice atoms={result.atoms} /><Panel className="space-y-3">
      <h3 className="text-sm font-semibold">Atomic basins & charge partitioning</h3>
      <Bars data={result.atoms.map((a, i) => ({ label: `${a.sym}${i + 1}`, value: bas.charges[i], tone: bas.charges[i] < 0 ? 'rose' : 'cyan' }))} format={v => v.toFixed(3)} suffix=" e" />
      <p className="text-[10px] text-muted-foreground">Bar height is |charge|; negative values use the alternate tone. Signed values below.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><thead className="text-muted-foreground"><tr><th>Atom</th><th>Electrons</th><th>Basin q (e)</th><th>Hirshfeld q (e)</th><th>Volume (bohr³)</th></tr></thead><tbody>{result.atoms.map((a, i) => <tr key={i}><td className="py-2">{a.sym}{i + 1}</td>{[bas.elec[i], bas.charges[i], bas.hirsh[i], bas.cells[i]].map((v, j) => <td key={j} className="font-mono">{v.toFixed(4)}</td>)}</tr>)}</tbody></table></div>
      <p className="text-xs text-muted-foreground">Finite-box, midpoint quadrature. Refine the grid to assess convergence; charges are not rescaled to force closure.</p>
    </Panel></div>
  </div>;
}