import { Sparkles } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { interferenceSim, intensity } from './interferenceCore';

export default function InterferenceLab() {
  return (
    <EngShell
      sim={interferenceSim}
      toolId="interference-diffraction"
      icon={Sparkles}
      title="Interference & Diffraction Laboratory"
      desc="Two slits, one slit or a grating: the screen intensity is computed point by point from the geometry, so the fringe spacing, the single-slit envelope, the grating orders and their angular width all follow from the wavelength and the slit dimensions."
    >
      {({ params, readings: r }) => {
        const half = params.screenWidth;
        const envelope = Array.from({ length: 180 }, (_, i) => ({ x: -half + (i / 179) * 2 * half, y: intensity({ ...params, mode: 'single' }, -half + (i / 179) * 2 * half) }));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Fringe spacing" value={r.spacing.toFixed(3)} unit="mm" sub={`measured from the computed pattern: ${r.measuredSpacing.toFixed(3)} mm`} />
              <Stat label="Wavelength on the screen" value={`${params.wavelength} nm`} sub={`d = ${params.separation} mm · L = ${params.screenDistance} m`} mono />
              <Stat label={params.mode === 'single' ? 'Central maximum width' : 'First order at'} value={params.mode === 'single' ? `${r.singleSlit.centralWidth.toFixed(2)} mm` : `${r.firstOrderPosition.toFixed(2)} mm`} sub={params.mode === 'grating' ? `${r.orders.length} orders inside the screen` : `${r.measuredPeaks.length} maxima measured`} mono />
              <Stat label="Envelope" value={params.mode === 'single' ? 'the pattern itself' : `first zero at ${r.singleSlit.zeros[0].toFixed(2)} mm`} sub={`slit width a = ${params.slitWidth} mm`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Intensity across the screen</h3>
              <Scene
                xDomain={[-half, half]}
                yDomain={[-0.15, 1.1]}
                height={280}
                xLabel="position on the screen (mm)"
                yLabel="relative intensity"
                ariaLabel="Diffraction and interference intensity pattern across the screen"
                series={[
                  ...(params.mode === 'double' ? [{ points: envelope, tone: 'muted', width: 1.2, dashed: true }] : []),
                  { points: r.profile, tone: 'cyan', width: 2, fill: 'cyan', fillOpacity: 0.12 },
                ]}
                markers={r.measuredPeaks.map((position) => ({ x: position, y: intensity(params, position), tone: 'amber', r: 2.4 }))}
                texts={[
                  { x: -half * 0.97, y: 0.98, text: params.mode === 'single' ? 'single slit: a broad central maximum with zeros at a sin θ = mλ' : params.mode === 'grating' ? `${params.slits} slits: sharp principal maxima at d sin θ = mλ, with ${r.secondaryMaxima} secondary maxima between them` : 'two slits: cos² fringes under the dashed single-slit envelope' },
                ]}
              />
              <p className="text-[11px] text-muted-foreground/80">The dashed curve is the pattern a single slit of the same width would give. Where it goes dark, no light reaches the screen whatever the interference term is doing — those positions are missing orders.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The fringe pattern as a picture</h3>
                <div className="flex h-24 overflow-hidden rounded-lg border border-border/60">
                  {Array.from({ length: 120 }, (_, i) => {
                    const y = -half + (i / 119) * 2 * half;
                    const value = intensity(params, y);
                    return <div key={i} className="h-full flex-1" style={{ background: `hsl(189 100% ${8 + value * 52}% / ${0.25 + value * 0.75})` }} />;
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground/80">Bright bands where the waves arrive in step, dark where they cancel. Red, green and blue light of the same geometry would give three different spacings, which is why a white-light pattern shows coloured fringes.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Positions of the maxima</h3>
                <ul className="space-y-1 text-xs">
                  {r.orders.length ? r.orders.map((position, index) => (
                    <li key={position} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">order {index + 1}</span>
                      <span className="font-mono-j">{position.toFixed(2)} mm</span>
                    </li>
                  )) : <li className="text-muted-foreground">No orders fall on this screen width — widen the screen or increase the wavelength.</li>}
                </ul>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The rules in numbers</h3>
                <Stat label="Fringe spacing" value={`Δy = λL/d = ${r.spacing.toFixed(3)} mm`} sub={`λ ${params.wavelength} nm, L ${params.screenDistance} m, d ${params.separation} mm`} mono />
                <Stat label="Single-slit zeros" value={r.singleSlit.zeros.slice(0, 3).map((z) => z.toFixed(2)).join(' · ') + ' mm'} sub="mλ/a on the screen" mono />
                {params.mode === 'grating' && <Stat label="Angular width of an order" value={`${r.angularWidth.toFixed(3)} mm`} sub="narrows as the number of slits rises" mono />}
                <Stat label="Mean intensity" value={r.averageIntensity.toFixed(4)} sub={params.mode === 'double' ? 'half the peak, as the mean of cos² requires' : 'over the sampled screen'} mono />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}