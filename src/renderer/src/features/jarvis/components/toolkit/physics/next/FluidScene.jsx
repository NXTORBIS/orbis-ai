import Scene from '@jarvis/components/toolkit/physics/Scene';

export default function FluidScene({ params: p, r }) {
  if (p.mode === 'tank') {
    const level = r.tank.height / p.height;
    return <Scene height={230} xDomain={[0, 1.8]} yDomain={[0, 1.2]} grid={false} ariaLabel="Tank liquid level decreases according to the computed drainage solution" bands={[{ x0: 0.08, x1: 0.9, y0: 0.1, y1: 0.1 + level * 0.9, tone: 'cyan', opacity: 0.25 }]} polys={[{ closed: false, points: [{ x: 0.08, y: 1.1 }, { x: 0.08, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 1.1 }], tone: 'foreground' }]} arrows={level ? [{ x: 0.9, y: 0.16, dx: Math.min(0.6, level * 0.6), dy: 0, tone: 'cyan' }] : []} texts={[{ x: 0.15, y: 1.15, text: `${r.tank.height.toFixed(3)} m remaining` }, { x: 1, y: 0.36, text: `${(r.tank.flow * 1000).toFixed(3)} L/s` }]} />;
  }
  const ratio = p.mode === 'pipe' ? 1 : Math.min(1.8, p.throat / p.diameter);
  const boundary = [{ x: 0, y: 0.9 }, { x: 0.32, y: 0.9 }, { x: 0.62, y: 0.5 + 0.4 * ratio }, { x: 1, y: 0.5 + 0.4 * ratio }, { x: 1, y: 0.5 - 0.4 * ratio }, { x: 0.62, y: 0.5 - 0.4 * ratio }, { x: 0.32, y: 0.1 }, { x: 0, y: 0.1 }];
  return <Scene height={230} xDomain={[0, 1]} yDomain={[-0.4, 1.4]} grid={false} ariaLabel="Flow through a pipe or contraction, animated tracers are schematic" polys={[{ points: boundary, tone: 'cyan', fill: 'cyan', fillOpacity: 0.06 }]} markers={Array.from({ length: 24 }, (_, i) => {
    const x = (i / 24 + r.phase * Math.min(3, r.velocity)) % 1, shape = x < 0.32 ? 1 : x > 0.62 ? ratio : 1 + (ratio - 1) * (x - 0.32) / 0.3;
    return { x, y: 0.5 + ((i % 3) - 1) * 0.24 * shape, r: 2.5, tone: 'cyan' };
  })} texts={[{ x: 0.04, y: 1.15, text: `${r.velocity.toFixed(3)} m/s` }, { x: 0.65, y: 1.15, text: p.mode === 'pipe' ? r.regime : `${r.v2.toFixed(3)} m/s` }, { x: 0.04, y: -0.12, text: p.mode === 'pipe' ? `ΔP = ${(r.pressure / 1000).toFixed(3)} kPa` : `${p.inlet.toFixed(1)} → ${(r.pressure2 / 1000).toFixed(1)} kPa` }]} />;
}