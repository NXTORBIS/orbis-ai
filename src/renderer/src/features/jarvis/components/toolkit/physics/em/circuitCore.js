import { solveLinear, check, closeCheck, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Direct-current networks solved by nodal analysis. Two topologies — two sources feeding a
 * common load, and a Wheatstone bridge — are small enough to verify every node against
 * Kirchhoff's laws, superposition, Thevenin's theorem and the bridge balance condition.
 */

const TOPOLOGIES = [
  { value: 'two-source', label: 'Two sources into a common load' },
  { value: 'bridge', label: 'Wheatstone bridge' },
];

const conductance = (value) => 1 / Math.max(0.01, value);

const makeBranch = (name, resistance, voltage) => ({
  name,
  resistance,
  voltage,
  current: voltage / Math.max(0.01, resistance),
  power: (voltage * voltage) / Math.max(0.01, resistance),
});

export function solveNetwork(p) {
  if (p.topology === 'bridge') {
    // unknowns: the voltage at the left and right junctions, with the source terminal fixed
    const matrix = [
      [conductance(p.r1) + conductance(p.r3) + conductance(p.r5), -conductance(p.r5)],
      [-conductance(p.r5), conductance(p.r2) + conductance(p.r4) + conductance(p.r5)],
    ];
    const rhs = [p.voltage1 * conductance(p.r1), p.voltage1 * conductance(p.r2)];
    const solution = solveLinear(matrix, rhs);
    if (!solution) return null;
    const [va, vb] = solution;
    const branches = [
      makeBranch('R₁', p.r1, p.voltage1 - va),
      makeBranch('R₂', p.r2, p.voltage1 - vb),
      makeBranch('R₃', p.r3, va),
      makeBranch('R₄', p.r4, vb),
      makeBranch('R₅ — galvanometer', p.r5, va - vb),
    ];
    return {
      topology: 'bridge',
      nodes: [
        { name: 'source terminal', voltage: p.voltage1 },
        { name: 'left junction', voltage: va },
        { name: 'right junction', voltage: vb },
        { name: 'ground', voltage: 0 },
      ],
      branches,
      sourceCurrent: branches[0].current + branches[1].current,
      bridgeVoltage: va - vb,
      balanced: Math.abs(va - vb) < 1e-9,
      balanceRatio: (p.r1 * p.r4) / (p.r2 * p.r3),
      equivalentResistance: p.voltage1 / (branches[0].current + branches[1].current),
      theveninResistance: (p.r1 * p.r3) / (p.r1 + p.r3) + (p.r2 * p.r4) / (p.r2 + p.r4),
    };
  }

  const matrix = [[conductance(p.r1) + conductance(p.r2) + conductance(p.r3)]];
  const rhs = [p.voltage1 * conductance(p.r1) + p.voltage2 * conductance(p.r2)];
  const [va] = solveLinear(matrix, rhs);
  const branches = [
    makeBranch('R₁', p.r1, p.voltage1 - va),
    makeBranch('R₂', p.r2, p.voltage2 - va),
    makeBranch('R₃ — load', p.r3, va),
  ];
  return {
    topology: 'two-source',
    nodes: [
      { name: 'source terminal 1', voltage: p.voltage1 },
      { name: 'source terminal 2', voltage: p.voltage2 },
      { name: 'junction A', voltage: va },
      { name: 'ground', voltage: 0 },
    ],
    branches,
    sourceCurrent: branches[0].current,
    secondSourceCurrent: branches[1].current,
    bridgeVoltage: va,
    balanced: false,
    balanceRatio: NaN,
    equivalentResistance: p.voltage1 / branches[0].current,
    theveninResistance: (p.r1 * (p.r2 + p.r3)) / (p.r1 + p.r2 + p.r3),
  };
}

export const circuitSim = {
  id: 'dc-network-solver',
  unit: 's',
  digits: 2,
  note: 'The network is solved by nodal analysis: every resistor contributes a conductance to the matrix, the sources enter the current vector, and one linear solve gives the node voltages. Branch currents, powers, the equivalent resistance and the bridge balance condition are all read from that solution.',
  checkNote: 'Kirchhoff’s current law is checked at every node, the power balance between sources and resistors, superposition, the bridge balance condition, series and parallel equivalents, and Thevenin’s theorem against V_open/I_short.',
  params: { topology: 'bridge', voltage1: 12, voltage2: 6, r1: 220, r2: 220, r3: 330, r4: 330, r5: 1000 },
  fields: [
    { key: 'topology', label: 'Circuit', options: TOPOLOGIES },
    { key: 'voltage1', label: 'Source 1 (V)', min: -24, max: 24, step: 0.5 },
    { key: 'voltage2', label: 'Source 2 (V)', min: -24, max: 24, step: 0.5 },
    { key: 'r1', label: 'R₁ (Ω)', min: 10, max: 2000, step: 10 },
    { key: 'r2', label: 'R₂ (Ω)', min: 10, max: 2000, step: 10 },
    { key: 'r3', label: 'R₃ (Ω)', min: 10, max: 2000, step: 10 },
    { key: 'r4', label: 'R₄ (Ω)', min: 10, max: 2000, step: 10 },
    { key: 'r5', label: 'R₅ — bridge arm or load (Ω)', min: 10, max: 5000, step: 10 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['topology', 'voltage1', 'voltage2', 'r1', 'r2', 'r3', 'r4', 'r5'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const network = solveNetwork(p);
    if (!network) return { t: y.tau, valid: false, reason: 'this network has no unique solution' };
    const dissipated = network.branches.reduce((sum, branch) => sum + branch.power, 0);
    const supplied = network.topology === 'bridge'
      ? network.sourceCurrent * p.voltage1
      : network.sourceCurrent * p.voltage1 + network.secondSourceCurrent * p.voltage2;
    return {
      t: y.tau,
      valid: true,
      ...network,
      dissipatedPower: dissipated,
      suppliedPower: supplied,
      powerError: relErr(dissipated, supplied),
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...circuitSim.params };
    const bridge = solveNetwork(base);

    const kclResidual = (p) => {
      const network = solveNetwork(p);
      const g = conductance;
      if (p.topology === 'bridge') {
        const [va, vb] = [network.nodes[1].voltage, network.nodes[2].voltage];
        const atA = (p.voltage1 - va) * g(p.r1) - va * g(p.r3) - (va - vb) * g(p.r5);
        const atB = (p.voltage1 - vb) * g(p.r2) - vb * g(p.r4) + (va - vb) * g(p.r5);
        return Math.max(Math.abs(atA), Math.abs(atB));
      }
      const va = network.nodes[2].voltage;
      return Math.abs((p.voltage1 - va) * g(p.r1) + (p.voltage2 - va) * g(p.r2) - va * g(p.r3));
    };

    list.push(check('Kirchhoff’s current law holds at every node of the bridge', kclResidual(base) < 1e-12, `largest imbalance ${kclResidual(base).toExponential(1)} A`));
    list.push(closeCheck('A balanced bridge has no current through the galvanometer', bridge.bridgeVoltage, 0, 1e-9, 6));
    list.push(check('Balance needs R₁/R₂ = R₃/R₄, not merely equal values', Math.abs(bridge.balanceRatio - 1) < 1e-12, `R₁R₄/(R₂R₃) = ${bridge.balanceRatio.toFixed(6)}`));

    const unbalanced = { ...base, r4: 470 };
    const unbalancedNetwork = solveNetwork(unbalanced);
    list.push(check('Unbalancing one arm produces a voltage across the bridge', Math.abs(unbalancedNetwork.bridgeVoltage) > 0.1, `${unbalancedNetwork.bridgeVoltage.toFixed(3)} V across R₅`));
    list.push(check('The unbalanced bridge still satisfies Kirchhoff’s current law', kclResidual(unbalanced) < 1e-12, `largest imbalance ${kclResidual(unbalanced).toExponential(1)} A`));

    const twoSource = { ...base, topology: 'two-source', voltage1: 12, voltage2: 6, r1: 100, r2: 150, r3: 220 };
    list.push(check('Kirchhoff’s current law holds for the two-source network', kclResidual(twoSource) < 1e-12, `largest imbalance ${kclResidual(twoSource).toExponential(1)} A`));

    const full = solveNetwork(twoSource);
    const onlyFirst = solveNetwork({ ...twoSource, voltage2: 0 });
    const onlySecond = solveNetwork({ ...twoSource, voltage1: 0 });
    list.push(closeCheck('Superposition: the node voltage is the sum of the single-source cases', full.nodes[2].voltage, onlyFirst.nodes[2].voltage + onlySecond.nodes[2].voltage, 1e-9, 8));

    const power = circuitSim.read({ tau: 0 }, twoSource);
    list.push(closeCheck('Power supplied equals power dissipated', power.dissipatedPower, power.suppliedPower, 1e-9, 8));

    const seriesCase = solveNetwork({ ...twoSource, voltage2: 0, r2: 1e6 });
    list.push(closeCheck('Resistors in series add up', seriesCase.equivalentResistance, twoSource.r1 + twoSource.r3, 2e-3, 4));

    const parallelCase = solveNetwork({ ...twoSource, voltage2: 0, r1: 1e-6, r2: 220, r3: 220 });
    list.push(closeCheck('Two equal resistors in parallel give half the resistance', parallelCase.equivalentResistance, 110, 5e-3, 4));

    const open = solveNetwork({ ...unbalanced, r5: 1e9 });
    const shorted = solveNetwork({ ...unbalanced, r5: 1e-3 });
    const shortBranch = shorted.branches.find((branch) => branch.name.startsWith('R₅'));
    list.push(closeCheck('Thevenin resistance equals V_open/I_short', open.bridgeVoltage / shortBranch.current, unbalancedNetwork.theveninResistance, 2e-2, 4));

    const divider = solveNetwork({ ...twoSource, voltage2: 0, r1: 1000, r3: 1000, r2: 1e6 });
    list.push(closeCheck('A potential divider splits the voltage in proportion to the resistances', divider.nodes[2].voltage, 12 / 2, 5e-3, 4));

    const reversed = solveNetwork({ ...base, voltage1: -12 });
    list.push(closeCheck('Reversing the source reverses every voltage', reversed.nodes[1].voltage, -bridge.nodes[1].voltage, 1e-12, 6));

    const bridgePower = circuitSim.read({ tau: 0 }, base);
    list.push(check('Resistor power is always positive', bridgePower.dissipatedPower > 0, `${bridgePower.dissipatedPower.toFixed(4)} W dissipated`));
    list.push(check('The galvanometer current is zero when balanced but not otherwise', Math.abs(bridge.branches[4].current) < 1e-12 && Math.abs(unbalancedNetwork.branches[4].current) > 1e-4, `${unbalancedNetwork.branches[4].current.toExponential(2)} A when unbalanced`));
    list.push(closeCheck('Equivalent resistance is the source voltage over the source current', bridge.equivalentResistance, base.voltage1 / bridge.sourceCurrent, 1e-12, 6));
    return { checks: list };
  },
};