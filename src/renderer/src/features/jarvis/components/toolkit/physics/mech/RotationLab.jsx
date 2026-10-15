import { RotateCw } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { rotationSim, SHAPES } from './rotationCore';

export default function RotationLab() {
  return (
    <EngShell
      sim={rotationSim}
      toolId="rotational-dynamics"
      icon={RotateCw}
      title="Rotational Dynamics"
      desc="Rolling bodies racing down a slope, a spinning disk that meets another, an Atwood machine whose pulley has real mass, and a rod swinging as a physical pendulum. Every moment of inertia is built from the mass distribution, then tested against the textbook value, the parallel-axis theorem and the 5/7 energy split of a rolling sphere."
    >
      {({ params, readings: r }) => {
        const isRolling = params.mode === 'rolling';
        const isCollision = params.mode === 'collision';
        const isPulley = params.mode === 'pulley';
        const angle = (params.angle * Math.PI) / 180;
        const rampEnd = params.rampLength * Math.cos(angle);
        const rampTop = params.rampLength * Math.sin(angle);
        const bodyX = r.travel * Math.cos(angle);
        const bodyY = rampTop - r.travel * Math.sin(angle);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={isRolling ? 'Acceleration down the slope' : isCollision ? 'Spin after the grab' : isPulley ? 'Acceleration of the masses' : 'Period of the swing'}
                value={isRolling ? `${r.acceleration.toFixed(3)} m/s²` : isCollision ? `${r.finalSpin.toFixed(2)} rad/s` : isPulley ? `${r.acceleration.toFixed(3)} m/s²` : `${r.period.toFixed(4)} s`}
                unit=""
                sub={isRolling
                  ? `a = g sin θ /(1 + k) with k = ${r.k.toFixed(3)} — the shape, not the mass, sets this`
                  : isCollision
                    ? `from ${r.initialSpin.toFixed(2)} rad/s · angular momentum unchanged`
                    : isPulley
                      ? `a massless pulley would give ${r.idealAcceleration.toFixed(3)} m/s²`
                      : `a rod of ${params.rodLength} m pivoted at one end`}
                tone={isRolling ? 'cyan' : 'violet'}
              />
              <Stat
                label={isRolling ? 'Speed at the bottom' : isCollision ? 'Energy lost in the grab' : isPulley ? 'Tension difference' : 'Angular acceleration'}
                value={isRolling ? `${r.bottomSpeed.toFixed(3)} m/s` : isCollision ? `${r.energyLost.toFixed(3)} J` : isPulley ? `${r.tensionDifference.toFixed(3)} N` : `${r.angularAcceleration.toFixed(3)} rad/s²`}
                sub={isRolling ? 'from energy conservation, and confirmed by the kinematics' : isCollision ? `${(r.energyLostFraction * 100).toFixed(1)}% of the spin energy` : isPulley ? 'this is what the pulley’s inertia costs you' : 'this is what a torque of mgd gives a rigid rod'}
                mono
              />
              <Stat
                label="Moment of inertia"
                value={`${(isRolling ? r.inertia : isCollision ? r.first : isPulley ? r.pulleyInertia : r.inertia).toFixed(5)} kg·m²`}
                sub={isRolling ? `k mR² with k = ${r.k.toFixed(3)} for a ${params.shape}` : isPulley ? 'a solid pulley: ½mR²' : 'about the pivot actually being used'}
                mono
              />
              <Stat
                label={isRolling ? 'Energy split' : isCollision ? 'Angular momentum' : isPulley ? 'Torque on the pulley' : 'Compare with a point mass'}
                value={isRolling ? `${(r.translationShare * 100).toFixed(1)}% translating` : isCollision ? `${r.angularMomentum.toFixed(4)} kg·m²/s` : isPulley ? `${r.torque.toFixed(4)} N·m` : `${r.pointMassPeriod.toFixed(4)} s`}
                sub={isRolling ? `the other ${((1 - r.translationShare) * 100).toFixed(1)}% is in the spin` : isCollision ? 'the same before and after, which is the whole point' : isPulley ? '(T₁ − T₂)R, which is what turns it' : 'a rod is not a point mass on a string — it is faster'}
                mono
              />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">{isRolling ? 'The roll down the slope' : isCollision ? 'Two disks merging their spin' : isPulley ? 'The Atwood machine' : 'The rod as a pendulum'}</h3>
              {isRolling ? (
                <Scene
                  xDomain={[-0.3, rampEnd * 1.15]}
                  yDomain={[-0.3, rampTop * 1.2 + 0.2]}
                  height={300}
                  xLabel="distance along the ground (m)"
                  yLabel="height (m)"
                  ariaLabel="A rolling body descending an inclined plane"
                  series={[{ points: [{ x: 0, y: rampTop }, { x: rampEnd, y: 0 }], tone: 'slate', width: 3 }]}
                  markers={[{ x: bodyX, y: bodyY, tone: 'cyan', r: Math.max(5, params.radius * 0.55), label: `${r.speed.toFixed(2)} m/s · ω = ${r.omega.toFixed(2)} rad/s` }]}
                  arrows={[{ x: bodyX, y: bodyY, dx: 0.55, dy: -0.55 * Math.tan(angle), tone: 'violet', label: 'v' }]}
                  texts={[
                    { x: 0.02, y: rampTop * 1.1, text: `a = ${r.acceleration.toFixed(3)} m/s² down the slope, ω = ${r.omega.toFixed(2)} rad/s` },
                    { x: 0.02, y: rampTop * 1.02, text: `rolled ${r.travel.toFixed(2)} m of ${params.rampLength} m — ${(r.progress * 100).toFixed(0)}% of the way` },
                  ]}
                />
              ) : isCollision ? (
                <Scene
                  xDomain={[0, 100]}
                  yDomain={[0, Math.max(r.initialSpin, 1) * 1.15]}
                  height={260}
                  xLabel="before"
                  yLabel="spin (rad/s)"
                  ariaLabel="Spin rate before and after two disks merge"
                  series={[
                    { points: [{ x: 10, y: r.initialSpin }, { x: 45, y: r.initialSpin }], tone: 'cyan', width: 3 },
                    { points: [{ x: 55, y: r.finalSpin }, { x: 90, y: r.finalSpin }], tone: 'violet', width: 3 },
                  ]}
                  markers={[{ x: 90, y: r.finalSpin, tone: 'emerald', r: 3.4, label: `${r.finalSpin.toFixed(2)} rad/s` }]}
                  texts={[
                    { x: 5, y: Math.max(r.initialSpin, 1) * 1.08, text: 'a second disk drops on and they turn together' },
                    { x: 5, y: Math.max(r.initialSpin, 1) * 1.0, text: 'angular momentum is shared out, so the spin rate must fall' },
                  ]}
                />
              ) : isPulley ? (
                <Scene
                  xDomain={[-0.6, 0.6]}
                  yDomain={[-1.4, 1.4]}
                  height={260}
                  xLabel=""
                  yLabel="height (m)"
                  ariaLabel="Atwood machine with a pulley of real mass"
                  markers={[
                    { x: -0.3, y: -1, tone: 'cyan', r: 10, label: `${params.mass1} kg` },
                    { x: 0.3, y: -0.5, tone: 'violet', r: 8, label: `${params.mass2} kg` },
                    { x: 0, y: 1.15, tone: 'amber', r: Math.max(8, params.pulleyRadius * 0.5), label: 'pulley' },
                  ]}
                  series={[
                    { points: [{ x: -0.3, y: -1 }, { x: -0.3, y: 1.05 }, { x: -0.1, y: 1.15 }], tone: 'slate', width: 2 },
                    { points: [{ x: 0.3, y: -0.5 }, { x: 0.3, y: 1.05 }, { x: 0.1, y: 1.15 }], tone: 'slate', width: 2 },
                  ]}
                  texts={[
                    { x: -0.55, y: 1.32, text: `a = ${r.acceleration.toFixed(3)} m/s², pulley angular acceleration ${r.angularAcceleration.toFixed(3)} rad/s²` },
                    { x: -0.55, y: 1.25, text: `tensions ${r.tension1.toFixed(3)} N and ${r.tension2.toFixed(3)} N — they differ by exactly what it takes to turn the pulley` },
                  ]}
                />
              ) : (
                <Scene
                  xDomain={[-0.4, params.rodLength * 1.1]}
                  yDomain={[-params.rodLength * 0.35, params.rodLength * 1.15]}
                  height={260}
                  xLabel=""
                  yLabel="height (m)"
                  ariaLabel="A rod pivoted at one end, swinging as a physical pendulum"
                  series={[{ points: [{ x: 0, y: 0 }, { x: params.rodLength * 0.86, y: params.rodLength * 0.5 }], tone: 'cyan', width: 4 }]}
                  markers={[
                    { x: 0, y: 0, tone: 'amber', r: 5, label: 'pivot' },
                    { x: params.rodLength * 0.43, y: params.rodLength * 0.25, tone: 'violet', r: 4, label: 'centre of mass at L/2' },
                  ]}
                  texts={[
                    { x: -0.3, y: params.rodLength * 1.05, text: `period ${r.period.toFixed(4)} s · a point mass at the tip would take ${r.pointMassPeriod.toFixed(4)} s` },
                    { x: -0.3, y: params.rodLength * 0.95, text: 'the rod’s own inertia makes it quicker than the point-mass idealisation' },
                  ]}
                />
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy and spin</h3>
                {isRolling && (
                  <>
                    <Stat label="Translational energy" value={`${r.keTranslation.toFixed(3)} J`} mono />
                    <Stat label="Rotational energy" value={`${r.keRotation.toFixed(3)} J`} mono />
                    <Stat label="Total kinetic energy" value={`${r.total.toFixed(3)} J`} sub={`from falling ${r.height.toFixed(2)} m of ramp`} mono />
                  </>
                )}
                {isCollision && (
                  <>
                    <Stat label="Energy before" value={`${r.energyBefore.toFixed(3)} J`} mono />
                    <Stat label="Energy after" value={`${r.energyAfter.toFixed(3)} J`} mono />
                    <Stat label="Lost to the grab" value={`${r.energyLost.toFixed(3)} J`} sub="friction between the surfaces — angular momentum survives, kinetic energy does not" mono />
                  </>
                )}
                {isPulley && (
                  <>
                    <Stat label="Tension on the heavy side" value={`${r.tension1.toFixed(3)} N`} mono />
                    <Stat label="Tension on the light side" value={`${r.tension2.toFixed(3)} N`} mono />
                    <Stat label="Pulley inertia" value={`${r.pulleyInertia.toFixed(5)} kg·m²`} sub="set its mass to zero and the classic massless result returns" mono />
                  </>
                )}
                {!isRolling && !isCollision && !isPulley && (
                  <>
                    <Stat label="Rod inertia about the pivot" value={`${r.inertia.toFixed(5)} kg·m²`} mono />
                    <Stat label="Centre of mass" value={`${r.distance.toFixed(3)} m from the pivot`} mono />
                    <Stat label="Period formula" value="2π√(I/mgd)" sub="the same expression covers any rigid body hung from any point" mono />
                  </>
                )}
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The race, if you changed the shape</h3>
                {isRolling ? (
                  <ul className="space-y-1 text-[11px]">
                    {r.otherShapes.map((shape) => (
                      <li key={shape.shape} className="flex items-center justify-between gap-2">
                        <span className="truncate text-muted-foreground">{shape.shape.split(' (')[0]}</span>
                        <span className="font-mono-j">{shape.bottomSpeed.toFixed(3)} m/s</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-muted-foreground/80">Switch to the rolling situation to compare a sphere, a hollow sphere, a disk and a hoop. The solid sphere always wins: the further a body’s mass sits from its axis, the more of the fall it spends on spinning rather than travelling.</p>
                )}
                {isRolling && <p className="text-[11px] text-muted-foreground/80">Mass and radius drop out entirely — a marble and a boulder of the same shape finish together.</p>}
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The physics in one paragraph</h3>
                <p className="text-[11px] text-muted-foreground/80">
                  {isRolling && 'Rolling without slipping couples translation to rotation. Gravity’s pull is shared between moving the body and spinning it, and the shape decides the split — which is why the answer depends on k = I/mR² and on nothing else.'}
                  {isCollision && 'When two coaxial disks are brought together, the torque between them is internal, so total angular momentum cannot change. Kinetic energy, however, is not conserved: the surfaces slide against each other and the difference becomes heat.'}
                  {isPulley && 'A massive pulley has to be spun up as well as pulled, so the tension on the two sides can never be equal. The difference between the tensions, multiplied by the radius, is exactly the torque that accelerates the pulley.'}
                  {!isRolling && !isCollision && !isPulley && 'A physical pendulum swings by the same formula as a simple one, with the length replaced by I/md — the effective length of the body. A rod hung from its end swings faster than a point mass on a string of the same length, because much of the rod is closer to the pivot than the tip.'}
                  {isRolling && ` k is ${r.k.toFixed(3)} for this shape, and the race table shows what that buys: ${SHAPES.filter((s) => s.k < 1).length} of the four shapes beat a hoop every time.`}
                </p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}