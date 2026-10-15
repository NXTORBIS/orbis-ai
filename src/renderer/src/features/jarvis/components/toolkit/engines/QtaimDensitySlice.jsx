import { useEffect, useRef, useState } from 'react';
import { BOHR, fieldAt } from '@jarvis/components/toolkit/engines/qtaimCore';
import { Panel, Seg } from '@jarvis/components/toolkit/shared';

export default function QtaimDensitySlice({ atoms }) {
  const canvas = useRef(null), [plane, setPlane] = useState('xy'), [offset, setOffset] = useState(0), [probe, setProbe] = useState(null);
  const axes = plane === 'xy' ? [0, 1, 2] : plane === 'xz' ? [0, 2, 1] : [1, 2, 0];
  const bounds = axes.slice(0, 2).map(axis => [Math.min(...atoms.map(a => a.p[axis])) - 2, Math.max(...atoms.map(a => a.p[axis])) + 2]);
  useEffect(() => {
    const ctx = canvas.current.getContext('2d'), size = 112, img = ctx.createImageData(size, size), values = [], a = plane === 'xy' ? [0, 1, 2] : plane === 'xz' ? [0, 2, 1] : [1, 2, 0];
    const box = a.slice(0, 2).map(axis => [Math.min(...atoms.map(atom => atom.p[axis])) - 2, Math.max(...atoms.map(atom => atom.p[axis])) + 2]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const p = [0, 0, 0]; p[a[0]] = box[0][0] + x / (size - 1) * (box[0][1] - box[0][0]); p[a[1]] = box[1][1] - y / (size - 1) * (box[1][1] - box[1][0]); p[a[2]] = offset / BOHR; values.push(Math.log10(Math.max(1e-8, fieldAt(atoms, p).rho))); }
    const lo = Math.min(...values), hi = Math.max(...values), hue = Number(window.getComputedStyle(canvas.current).getPropertyValue('--cyan').trim().split(' ')[0]) || 189;
    values.forEach((v, i) => { const t = (v - lo) / (hi - lo || 1), c = t * 0.85, h = hue / 60, z = c * (1 - Math.abs(h % 2 - 1)), m = 0.04, rgb = h < 3 ? [0, c, z] : [0, z, c]; rgb.forEach((v, j) => { img.data[4 * i + j] = Math.round(255 * (v + m)); }); img.data[4 * i + 3] = 255; });
    ctx.putImageData(img, 0, 0);
  }, [atoms, plane, offset]);
  return <Panel className="space-y-3">
    <h3 className="text-sm font-semibold">Electron-density slice</h3>
    <Seg value={plane} onChange={setPlane} options={['xy', 'xz', 'yz']} />
    <label className="block text-xs text-muted-foreground">Plane offset {offset.toFixed(2)} Å <input className="w-full accent-cyan-j" type="range" min="-2" max="2" step="0.05" value={offset} onChange={e => setOffset(Number(e.target.value))} /></label>
    <canvas ref={canvas} width="112" height="112" className="aspect-square w-full max-w-sm rounded-lg" aria-label="Logarithmic promolecular density map" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(), p = [0, 0, 0]; p[axes[0]] = bounds[0][0] + (e.clientX - r.left) / r.width * (bounds[0][1] - bounds[0][0]); p[axes[1]] = bounds[1][1] - (e.clientY - r.top) / r.height * (bounds[1][1] - bounds[1][0]); p[axes[2]] = offset / BOHR; setProbe(fieldAt(atoms, p).rho); }} />
    <p className="font-mono text-[10px] text-muted-foreground">Brighter = greater log₁₀ρ · {probe != null ? `probe ρ = ${probe.toExponential(4)} e/bohr³` : 'Move over the slice to inspect ρ.'}</p>
  </Panel>;
}