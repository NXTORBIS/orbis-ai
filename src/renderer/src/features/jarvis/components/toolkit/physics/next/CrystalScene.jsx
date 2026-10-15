import Scene from '@jarvis/components/toolkit/physics/Scene';

export default function CrystalScene({ params: p }) {
  const atoms = Array.from({ length: 25 }, (_, i) => ({ x: (i % 5) / 4, y: Math.floor(i / 5) / 4, r: 0.018, tone: 'cyan' }));
  const lines = [];
  if (p.h || p.k) for (let m = 0; m <= p.h + p.k; m++) {
    const ends = [];
    if (p.k) for (const x of [0, 1]) { const y = (m - p.h * x) / p.k; if (y >= 0 && y <= 1) ends.push({ x, y }); }
    if (p.h) for (const y of [0, 1]) { const x = (m - p.k * y) / p.h; if (x >= 0 && x <= 1 && !ends.some((end) => Math.abs(end.x - x) + Math.abs(end.y - y) < 1e-10)) ends.push({ x, y }); }
    if (ends.length >= 2) lines.push({ points: ends.slice(0, 2), tone: 'amber', width: 1.6 });
  }
  return <Scene height={230} xDomain={[-0.1, 1.1]} yDomain={[-0.1, 1.15]} grid={false} ariaLabel="Miller-plane traces in the z equals zero slice of a cubic lattice" circles={atoms} series={lines} texts={[{ x: 0, y: 1.1, text: `(${p.h}${p.k}${p.l}) plane traces · z = 0 slice` }, ...(!p.h && !p.k ? [{ x: 0.5, y: 0.55, anchor: 'middle', text: p.l ? 'Planes parallel to this slice' : '(000) is not a plane family' }] : [])]} />;
}