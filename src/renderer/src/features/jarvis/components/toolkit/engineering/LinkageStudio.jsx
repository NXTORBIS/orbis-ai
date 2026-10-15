import { MoveDiagonal } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Pills } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import LinkageView from '@jarvis/components/toolkit/engineering/LinkageView';
import { linkageSim } from '@jarvis/components/toolkit/engineering/linkageCore';

export default function LinkageStudio() {
  return (
    <EngShell
      sim={linkageSim}
      toolId="four-bar-linkage"
      icon={MoveDiagonal}
      title="Four-Bar Linkage Simulator"
      desc="Change any link length and the input angle: loop closure is solved exactly each step, so positions, output speed and acceleration, transmission angle, coupler curve and mechanical advantage all follow from the geometry you set."
    >
      {({ params, readings: r }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Output speed" value={r.omega4.toFixed(3)} unit="rad/s" sub={`input ${r.omega2.toFixed(3)} rad/s · ${params.rpm} rpm`} />
            <Stat label="Transmission angle" value={`${(r.transmission * 180 / Math.PI).toFixed(1)}°`} sub="Best near 90°; below 40° the joint loads spike" mono />
            <Stat label="Mechanical advantage" value={Number.isFinite(r.mechanicalAdvantage) ? r.mechanicalAdvantage.toFixed(2) : '∞'} sub="ω2 / ω4 with a rigid linkage" mono />
            <Stat label="Linkage type" value={r.grashof.type} sub={r.grashof.behaviour} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel className="lg:col-span-2"><LinkageView readings={r} /></Panel>
            <div className="space-y-3">
              <Gauge value={(r.transmission * 180) / Math.PI} min={0} max={180} label="Transmission angle" unit="°" bands={[{ min: 0, max: 40, label: 'poor', stroke: 'hsl(350 89% 60%)' }, { min: 40, max: 140, label: 'good', stroke: 'hsl(160 84% 52%)' }, { min: 140, max: 180, label: 'poor', stroke: 'hsl(350 89% 60%)' }]} />
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Joint solution</h3>
                <Stat label="Input / coupler / output" value={`${(r.theta2 * 180 / Math.PI).toFixed(1)}° / ${(r.theta3 * 180 / Math.PI).toFixed(1)}° / ${(r.theta4 * 180 / Math.PI).toFixed(1)}°`} mono />
                <Stat label="Coupler point" value={`${r.point.x.toFixed(3)} / ${r.point.y.toFixed(3)} m`} sub={`${r.pointSpeed.toFixed(3)} m/s`} mono />
                <Stat label="Loop-closure residual" value={r.residual.toExponential(2)} sub="metres; solved in closed form" mono />
                <Stat label="Output acceleration" value={`${r.alpha4.toFixed(3)} rad/s²`} sub={`coupler ${r.alpha3.toFixed(3)} rad/s²`} mono />
              </Panel>
            </div>
          </div>

          <Panel className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Assembly</h3>
              <Pills items={[{ label: 'a', value: params.crank }, { label: 'b', value: params.coupler }, { label: 'c', value: params.rocker }, { label: 'd', value: params.ground }]} />
            </div>
            <p className="text-xs text-muted-foreground">
              Shortest + longest = {r.grashof.sum.toFixed(2)} against the other pair {r.grashof.other.toFixed(2)} → {r.grashof.type}. {r.grashof.behaviour}. Rigid planar links are assumed: no joint clearance, no link bending, no friction, and the input speed is constant.
            </p>
          </Panel>
        </>
      )}
    </EngShell>
  );
}