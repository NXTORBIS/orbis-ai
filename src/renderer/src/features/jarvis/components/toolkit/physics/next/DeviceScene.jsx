import Scene from '@jarvis/components/toolkit/physics/Scene';

export default function DeviceScene({ params: p, r }) {
  const mos = p.mode === 'mosfet', solar = p.mode === 'solar';
  const bandTone = mos ? 'emerald' : solar ? 'amber' : 'cyan';
  const direction = r.current >= 0 ? 1 : -1;
  const markers = Math.abs(r.current) < 1e-15 ? [] : Array.from({ length: 9 }, (_, i) => ({ x: 0.08 + (((i / 9 + r.phase * direction) % 1 + 1) % 1) * 0.84, y: 0.42, tone: bandTone, r: 3 }));
  return <Scene height={205} xDomain={[0, 1]} yDomain={[0, 1]} grid={false} ariaLabel="Conceptual semiconductor cross-section, not to scale" bands={[
    { x0: 0.05, x1: 0.95, y0: 0.2, y1: 0.6, tone: 'border' },
    { x0: 0.08, x1: 0.42, y0: 0.25, y1: 0.56, tone: 'cyan', opacity: 0.22 },
    { x0: 0.58, x1: 0.92, y0: 0.25, y1: 0.56, tone: mos ? 'cyan' : 'violet', opacity: 0.22 },
    { x0: 0.42, x1: 0.58, y0: 0.25, y1: 0.56, tone: mos && r.region !== 'Cutoff' ? 'emerald' : 'muted', opacity: mos && r.region === 'Cutoff' ? 0.05 : 0.24 },
    ...(mos ? [{ x0: 0.35, x1: 0.65, y0: 0.7, y1: 0.85, tone: 'amber', opacity: 0.4 }] : []),
  ]} markers={markers} arrows={solar ? [0.2, 0.4, 0.6, 0.8].map((x) => ({ x, y: 0.9, dx: 0, dy: -0.3, tone: 'amber' })) : mos ? [{ x: 0.5, y: 0.7, dx: 0, dy: -0.13, tone: 'amber' }] : []} texts={[
    { x: 0.23, y: 0.14, anchor: 'middle', text: mos ? 'Source' : 'P region' },
    { x: 0.77, y: 0.14, anchor: 'middle', text: mos ? 'Drain' : 'N region' },
    { x: 0.5, y: mos ? 0.93 : 0.68, anchor: 'middle', text: mos ? 'Gate' : solar ? 'Photogenerated carriers' : 'Junction' },
  ]} />;
}