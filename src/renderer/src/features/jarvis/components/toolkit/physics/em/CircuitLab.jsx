import { CircuitBoard } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { circuitSim } from './circuitCore';

/** Fixed schematic coordinates for each topology. */
function schematic(p) {
  if (p.topology === 'bridge') {
    return {
      nodes: { S: { x: 5, y: 6 }, A: { x: 2, y: 3.6 }, B: { x: 8, y: 3.6 }, G: { x: 5, y: 1.2 } },
      wires: [
        ['S', 'A', 'R₁', 0], ['S', 'B', 'R₂', 1], ['A', 'G', 'R₃', 2], ['B', 'G', 'R₄', 3],
        ['A', 'B', 'R₅', 4], ['G', 'S', 'source', null],
      ],
      labels: { S: 'source terminal', A: 'left junction', B: 'right junction', G: 'ground' },
    };
  }
  return {
    nodes: { S: { x: 5, y: 3 }, A1: { x: 1.8, y: 3 }, A2: { x: 8.2, y: 3 }, G: { x: 5, y: 0.8 } },
    wires: [
      ['A1', 'S', 'R₁', 0], ['A2', 'S', 'R₂', 1], ['S', 'G', 'R₃ — load', 2],
    ],
    labels: { S: 'junction A', A1: 'source 1', A2: 'source 2', G: 'ground' },
  };
}

export default function CircuitLab() {
  return (
    <EngShell
      sim={circuitSim}
      toolId="dc-network-solver"
      icon={CircuitBoard}
      title="DC Circuit Solver & Wheatstone Bridge"
      desc="A resistor network solved by nodal analysis: every node voltage, branch current and power is computed from your component values, so Kirchhoff’s laws, the bridge balance condition and Thevenin’s theorem can all be read straight off the schematic."
    >
      {({ params, readings: r }) => {
        const layout = schematic(params);
        if (!r.valid) {
          return <Panel><p className="text-sm text-muted-foreground">{r.reason}</p></Panel>;
        }
        const branchByIndex = layout.wires.map((wire) => r.branches.find((branch) => branch.name === wire[2]));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={params.topology === 'bridge' ? 'Bridge voltage' : 'Load voltage'}
                value={Math.abs(r.bridgeVoltage).toFixed(3)}
                unit="V"
                sub={params.topology === 'bridge' ? (r.balanced ? 'balanced: no current through R₅' : `R₅ carries ${r.branches[4].current.toExponential(2)} A`) : `junction A at ${r.bridgeVoltage.toFixed(3)} V`}
                tone={params.topology === 'bridge' && r.balanced ? 'emerald' : 'cyan'}
              />
              <Stat label="Source current" value={`${(r.sourceCurrent * 1000).toFixed(3)} mA`} sub={`equivalent resistance ${r.equivalentResistance.toFixed(1)} Ω`} mono />
              <Stat label="Power balance" value={`${r.dissipatedPower.toFixed(5)} W`} sub={`supplied ${r.suppliedPower.toFixed(5)} W · difference ${(r.powerError * 100).toExponential(1)}%`} mono />
              <Stat label="Thevenin equivalent" value={`${r.theveninResistance.toFixed(1)} Ω`} sub={`open-circuit voltage ${params.topology === 'bridge' ? `${Math.abs(r.bridgeVoltage).toFixed(3)} V` : `${r.bridgeVoltage.toFixed(3)} V`}`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Schematic with the solved currents</h3>
              <Scene
                xDomain={[0, 10]}
                yDomain={[0, 7]}
                height={330}
                ariaLabel="Circuit schematic with measured currents in each branch"
                series={layout.wires.map((wire, index) => ({
                  points: index === 5
                    ? [layout.nodes.G, { x: 0.8, y: 1.2 }, { x: 0.8, y: 6 }, layout.nodes.S]
                    : [layout.nodes[wire[0]], layout.nodes[wire[1]]],
                  tone: index === 5 ? 'amber' : 'cyan',
                  width: index === 5 ? 2.4 : 1.6,
                }))}
                markers={Object.entries(layout.nodes).map(([key, node]) => ({ x: node.x, y: node.y, tone: 'foreground', r: 3.4, label: layout.labels[key] }))}
                texts={layout.wires.map((wire, index) => {
                  const a = layout.nodes[wire[0]];
                  const b = layout.nodes[wire[1]];
                  const branch = branchByIndex[index];
                  const mid = index === 5
                    ? { x: 0.8, y: 3.6 }
                    : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                  return {
                    x: mid.x + 0.15,
                    y: mid.y + 0.28,
                    text: branch ? `${branch.name}: ${(branch.current * 1000).toFixed(3)} mA` : `source ${params.voltage1} V`,
                    tone: branch ? 'cyan' : 'amber',
                  };
                })}
              />
              <p className="text-[11px] text-muted-foreground/80">Node voltages and branch currents are the direct output of one linear solve of the conductance matrix — no iteration and no sign guessing. The amber branch is the source loop.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Node voltages</h3>
                <ul className="space-y-1 text-xs">
                  {r.nodes.map((node) => (
                    <li key={node.name} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{node.name}</span>
                      <span className="font-mono-j">{node.voltage.toFixed(4)} V</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Branch by branch</h3>
                <ul className="space-y-1 text-xs">
                  {r.branches.map((branch) => (
                    <li key={branch.name} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{branch.name}</span>
                      <span className="font-mono-j">{(branch.current * 1000).toFixed(3)} mA · {branch.power.toFixed(5)} W</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Bridge condition</h3>
                {params.topology === 'bridge' ? (
                  <>
                    <Stat label="Balance ratio R₁R₄/(R₂R₃)" value={r.balanceRatio.toFixed(6)} sub={r.balanced ? 'exactly one: the bridge is balanced' : 'away from one, so R₅ carries current'} mono />
                    <Stat label="Galvanometer voltage" value={`${r.bridgeVoltage.toExponential(3)} V`} sub="zero means the bridge is balanced" mono />
                    <p className="text-[11px] text-muted-foreground/80">A bridge balances when R₁/R₂ = R₃/R₄, which is how an unknown resistance is measured: adjust one arm until the galvanometer reads zero and read the ratio.</p>
                  </>
                ) : (
                  <>
                    <Stat label="Source 1 current" value={`${(r.sourceCurrent * 1000).toFixed(3)} mA`} sub={`delivering ${(r.sourceCurrent * params.voltage1).toFixed(5)} W`} mono />
                    <Stat label="Source 2 current" value={`${(r.secondSourceCurrent * 1000).toFixed(3)} mA`} sub={`${r.secondSourceCurrent * params.voltage2 >= 0 ? 'delivering' : 'absorbing'} ${Math.abs(r.secondSourceCurrent * params.voltage2).toFixed(5)} W`} mono />
                    <p className="text-[11px] text-muted-foreground/80">Set one source to zero and the node voltage is that source acting alone — the two single-source answers add up to the full one, which is superposition.</p>
                  </>
                )}
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}