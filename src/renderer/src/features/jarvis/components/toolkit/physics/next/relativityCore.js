import { check, closeCheck, linspace } from '@jarvis/components/toolkit/physics/phys';

export const gamma = (beta) => 1 / Math.sqrt(1 - beta * beta);
export const lorentz = (x, t, beta) => ({ x: gamma(beta) * (x - beta * t), t: gamma(beta) * (t - beta * x) });
export const addVelocity = (u, v) => (u + v) / (1 + u * v);
const C = 299792458;
export const relativitySim = {
  id: 'special-relativity', unit: 'display s',
  isStatic: (p) => p.mode === 'events',
  endTime: (p) => p.mode === 'twins' ? 16 : p.duration,
  params: { mode: 'clocks', beta: 0.8, length: 10, duration: 10, distance: 4, mass: 1, objectBeta: 0.6, eventX: 4, eventT: 6 },
  fields: [
    { key: 'mode', label: 'Experiment', options: [{ value: 'clocks', label: 'Light clocks & length contraction' }, { value: 'twins', label: 'Twin round trip' }, { value: 'velocity', label: 'Relativistic velocity addition' }, { value: 'events', label: 'Lorentz event transformation' }] },
    { key: 'beta', label: 'Frame speed v/c', min: 0, max: 0.995, step: 0.005, slider: true },
    { key: 'length', label: 'Proper length (m)', min: 0.1, max: 100, step: 0.1, when: { mode: ['clocks'] } },
    { key: 'duration', label: 'Lab observation interval (s)', min: 1, max: 60, step: 1, when: { mode: ['clocks', 'velocity'] } },
    { key: 'mass', label: 'Rest mass (kg)', min: 0.001, max: 1000, step: 0.001, when: { mode: ['clocks', 'velocity'] } },
    { key: 'distance', label: 'One-way distance (light-years)', min: 0.1, max: 30, step: 0.1, when: { mode: ['twins'] } },
    { key: 'objectBeta', label: 'Object speed in moving frame u′/c', min: -0.995, max: 0.995, step: 0.005, slider: true, when: { mode: ['velocity'] } },
    { key: 'eventX', label: 'Event position (light-seconds)', min: -30, max: 30, step: 0.1, when: { mode: ['events'] } },
    { key: 'eventT', label: 'Event time (s)', min: -30, max: 30, step: 0.1, when: { mode: ['events'] } },
  ],
  options: { maxStep: 0.05, resetOn: ['mode', 'beta', 'duration', 'distance'] },
  init: () => ({}), step: (state) => state, series: [],
  read: (state, p) => {
    const g = gamma(p.beta), t = Math.min(state.t ?? 0, p.duration);
    const total = p.beta > 0 ? 2 * p.distance / p.beta : null;
    const progress = Math.min(1, (state.t ?? 0) / 16);
    const twinTime = total === null ? 0 : progress * total;
    return { gamma: g, labTime: t, properTime: t / g, contractedLength: p.length / g, energy: g * p.mass * C * C, kineticEnergy: (g - 1) * p.mass * C * C, momentum: g * p.mass * p.beta * C, velocity: addVelocity(p.objectBeta, p.beta), event: lorentz(p.eventX, p.eventT, p.beta), interval: p.eventT ** 2 - p.eventX ** 2, twinTotal: total, twinTime, twinProper: twinTime / g, twinPosition: p.distance * (progress <= 0.5 ? 2 * progress : 2 * (1 - progress)), progress };
  },
  analyse: (p) => ({ boost: linspace(0, 0.995, 150).map((x) => ({ x, y: gamma(x) })), clocks: linspace(0, p.duration, 100).map((x) => ({ x, y: x / gamma(p.beta) })), additions: linspace(-0.995, 0.995, 140).map((x) => ({ x, y: addVelocity(x, p.beta) })) }),
  note: 'Exact special-relativity equations. Event positions are in light-seconds, so c = 1 on spacetime diagrams. Twin trips use years/light-years, an instantaneous turnaround, and a 16-second display animation; acceleration phases are not modelled.',
  checkNote: 'Lorentz interval invariance, inverse boosts, the light-speed limit, rest energy, the Newtonian limit and independently computed twin proper time.',
  verify: () => {
    const event = lorentz(4, 6, 0.8), back = lorentz(event.x, event.t, -0.8);
    const r = relativitySim.read({ t: 16 }, { ...relativitySim.params, mode: 'twins' });
    return { checks: [
      closeCheck('At 0.8c the Lorentz factor is 5/3', gamma(0.8), 5 / 3, 1e-12),
      closeCheck('The spacetime interval is invariant under a boost', event.t ** 2 - event.x ** 2, 20, 1e-12),
      closeCheck('An inverse boost recovers the original position', back.x, 4, 1e-12),
      closeCheck('An inverse boost recovers the original time', back.t, 6, 1e-12),
      closeCheck('Two 0.6c velocities combine to 15/17c', addVelocity(0.6, 0.6), 15 / 17, 1e-12),
      closeCheck('Light is measured at c in every inertial frame', addVelocity(1, 0.93), 1, 1e-12),
      check('Opposite equal velocities cancel', Math.abs(addVelocity(-0.6, 0.6)) < 1e-12, 'u = 0'),
      closeCheck('Length contraction at 0.8c gives 60% of proper length', 10 / gamma(0.8), 6, 1e-12),
      closeCheck('The round-trip earth time is 2D/v', r.twinTotal, 10, 1e-12),
      closeCheck('The traveller ages six years on this ten-year trip', r.twinProper, 6, 1e-12),
      closeCheck('Small speeds recover Newtonian kinetic energy', (gamma(1e-3) - 1) / (0.5e-6), 1, 1e-5),
      closeCheck('E² − (pc)² recovers squared rest energy', (r.energy ** 2 - (r.momentum * C) ** 2) / (C ** 4), 1, 1e-12),
    ] };
  },
};