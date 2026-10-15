import { Eye } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { lensSim } from './lensCore';

export default function LensLab() {
  return (
    <EngShell
      sim={lensSim}
      toolId="thin-lens-mirror"
      icon={Eye}
      title="Lens & Mirror Ray-Tracing Laboratory"
      desc="Move the object and change the focal length and the three principal rays redraw themselves from the image position: real or virtual, upright or inverted, enlarged or reduced, with the equation and the picture always agreeing."
    >
      {({ params, readings: r }) => {
        const e = r.extent;
        const element = r.mirror
          ? [{ points: Array.from({ length: 21 }, (_, i) => { const t = -1 + (i / 20) * 2; return { x: 0.5 * t * t * Math.sign(r.f) * -1, y: t * Math.max(1, params.objectHeight) * 1.6 }; }), closed: false }]
          : [];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Image distance" value={Number.isFinite(r.v) ? r.v.toFixed(2) : '∞'} unit="cm" sub={`object at ${params.objectDistance} cm · f = ${r.f} cm`} />
              <Stat label="Magnification" value={Number.isFinite(r.magnification) ? `${r.magnification.toFixed(3)}×` : '—'} sub={`image height ${r.imageHeight.toFixed(2)} cm`} mono />
              <Stat label="Image character" value={r.atInfinity ? 'at infinity' : r.real ? (r.inverted ? 'real, inverted' : 'real, upright') : 'virtual, upright'} sub={r.description} />
              <Stat label="Power" value={`${(1 / (r.f / 100)).toFixed(2)} D`} sub={`combined with f₂: ${Number.isFinite(r.combinedFocal) ? `${r.combinedFocal.toFixed(2)} cm` : '—'}`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Principal-ray construction</h3>
              <Scene
                xDomain={[-e, e]}
                yDomain={[-Math.max(1, params.objectHeight) * 2.4, Math.max(1, params.objectHeight) * 2.4]}
                height={320}
                xLabel="distance from the element (cm)"
                yLabel="height (cm)"
                ariaLabel="Ray diagram for a thin lens or spherical mirror showing the object, the image and three principal rays"
                series={[
                  { points: [{ x: -e, y: 0 }, { x: e, y: 0 }], tone: 'muted', width: 1, dashed: true },
                  ...(r.mirror ? element : [{ points: [{ x: 0, y: -params.objectHeight * 1.9 }, { x: 0, y: params.objectHeight * 1.9 }], tone: 'cyan', width: 2 }]),
                  ...r.rays.map((ray, index) => ({ points: ray.points, tone: ['cyan', 'violet', 'amber'][index], width: 1.6, opacity: 0.9 })),
                ]}
                arrows={[
                  { x: -params.objectDistance, y: 0, dx: 0, dy: params.objectHeight, tone: 'emerald', label: 'object' },
                  ...(r.atInfinity ? [] : [{ x: r.imageTip.x, y: 0, dx: 0, dy: r.imageTip.y, tone: r.real ? 'cyan' : 'rose', label: r.real ? 'real image' : 'virtual image' }]),
                ]}
                circles={[
                  { x: r.focusX, y: 0, r: e * 0.012, tone: 'amber', fill: 'amber' },
                  { x: -r.focusX, y: 0, r: e * 0.012, tone: 'amber', fill: 'amber' },
                ]}
                texts={[
                  { x: r.focusX, y: -Math.max(1, params.objectHeight) * 0.35, text: 'F', tone: 'amber', anchor: 'middle' },
                  { x: -r.focusX, y: -Math.max(1, params.objectHeight) * 0.35, text: 'F', tone: 'amber', anchor: 'middle' },
                  { x: -e * 0.95, y: Math.max(1, params.objectHeight) * 2.1, text: r.rays.map((ray) => ray.label).join(' · ') },
                ]}
              />
              <p className="text-[11px] text-muted-foreground/80">{r.mirror ? 'Mirror geometry: the object and its real image both sit in front of the reflecting surface, and the construction is the reflected form of the lens one.' : 'The parallel ray leaves through the far focal point, the ray through the centre is undeviated, and the ray aimed at the near focal point leaves parallel to the axis. All three cross at the image tip.'} {r.virtual ? 'Because the image is virtual, the rays only appear to diverge from it — extend them backwards to see where they meet.' : ''}</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Image position against object position</h3>
                <ul className="space-y-1 text-xs">
                  {[5, 10, 15, 20, 40].map((u) => {
                    const f = r.f;
                    const v = Math.abs(u - f) < 1e-9 ? Infinity : (u * f) / (u - f);
                    return (
                      <li key={u} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">u = {u} cm</span>
                        <span className="font-mono-j">{Number.isFinite(v) ? `v = ${v.toFixed(2)} cm, m = ${(-v / u).toFixed(2)}` : 'image at infinity'}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-muted-foreground/80">As the object approaches the focal point the image runs off to infinity; inside the focal length it switches to a virtual image on the object side.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Where the rules come from</h3>
                <Stat label="Lens equation" value={`1/${r.f} = 1/${params.objectDistance} + 1/${Number.isFinite(r.v) ? r.v.toFixed(2) : '∞'}`} sub="real-positive convention" mono />
                <Stat label="Newton’s relation" value={`(u − f)(v − f) = ${Number.isFinite(r.newton) ? r.newton.toFixed(2) : '—'} cm²`} sub={`f² = ${(r.f * r.f).toFixed(2)} cm²`} mono />
                <Stat label="Magnification" value={`m = −v/u = ${Number.isFinite(r.magnification) ? r.magnification.toFixed(3) : '—'}`} sub="negative means inverted" mono />
                {r.radiusOfCurvature && <Stat label="Radius of curvature" value={`R = ${r.radiusOfCurvature.toFixed(1)} cm`} sub="f = R/2 for a spherical mirror" mono />}
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Two lenses in contact</h3>
                <Stat label="Combined focal length" value={Number.isFinite(r.combinedFocal) ? `${r.combinedFocal.toFixed(2)} cm` : '—'} sub={`1/f = 1/${r.f} + 1/${params.secondFocal}`} mono />
                <Stat label="Combined power" value={`${((1 / (r.f / 100)) + (1 / (params.secondFocal / 100))).toFixed(2)} D`} sub="powers add for thin lenses in contact" mono />
                <p className="text-[11px] text-muted-foreground/80">A negative second lens cancels part of the converging power, which is exactly how a corrective lens is chosen for a long-sighted eye.</p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}