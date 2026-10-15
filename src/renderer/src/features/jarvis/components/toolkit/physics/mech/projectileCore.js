import { rk4, relErr, check, closeCheck, sig } from '@jarvis/components/toolkit/physics/phys';

/**
 * Projectile motion under gravity with no drag, linear drag or quadratic drag.
 * The vacuum comparisons are closed-form; the with-drag results come from the integrator.
 */

const DRAG_OPTIONS = [
  { value: 'none', label: 'No drag (vacuum)' },
  { value: 'linear', label: 'Linear drag — F = −k v' },
  { value: 'quadratic', label: 'Quadratic drag — F = −k |v| v' },
];

export const dragLabel = (mode) => DRAG_OPTIONS.find((o) => o.value === mode)?.label || mode;

const accel = (p) => (_y, _t) => {
  const [x, y, vx, vy] = _y;
  const speed = Math.hypot(vx, vy) || 1e-12;
  const factor = p.drag === 'linear' ? p.dragK / p.mass : p.drag === 'quadratic' ? (p.dragK / p.mass) * speed : 0;
  return [vx, vy, -factor * vx, -p.gravity - factor * vy];
};

/** Closed-form vacuum trajectory, range, apex height and flight time. */
export function vacuum(p) {
  const angle = (p.angle * Math.PI) / 180;
  const vx = p.speed * Math.cos(angle);
  const vy = p.speed * Math.sin(angle);
  const root = Math.sqrt(vy * vy + 2 * p.gravity * p.y0);
  const time = (vy + root) / p.gravity;
  return {
    vx,
    vy,
    range: Math.max(0, vx * time),
    apex: p.y0 + (vy > 0 ? (vy * vy) / (2 * p.gravity) : 0),
    time,
    height: (x) => {
      const t = x / (vx || 1e-9);
      return p.y0 + vy * t - 0.5 * p.gravity * t * t;
    },
  };
}

export function vacuumPath(p, count = 60) {
  const reference = vacuum(p);
  return Array.from({ length: count }, (_, i) => {
    const fraction = i / (count - 1);
    const x = reference.range * fraction;
    return { x, y: Math.max(0, reference.height(x)) };
  });
}

export const projectileSim = {
  id: 'drag-projectile',
  unit: 's',
  digits: 2,
  note: 'The projectile is integrated with a fourth-order Runge-Kutta step under gravity plus the drag law you select — no drag, linear (Stokes-like) drag or quadratic drag. The dashed curve is the drag-free prediction from the same launch conditions, so the effect of air resistance is visible against an exact reference.',
  checkNote: 'With drag switched off the integrated range, apex height and flight time are compared with the closed-form vacuum results; the drag cases are checked for shorter range, monotonic energy loss and the correct terminal velocity.',
  params: { drag: 'none', speed: 32, angle: 42, dragK: 0.35, mass: 0.5, gravity: 9.81, y0: 0 },
  fields: [
    { key: 'drag', label: 'Drag model', options: DRAG_OPTIONS },
    { key: 'speed', label: 'Launch speed (m/s)', min: 2, max: 120, step: 1 },
    { key: 'angle', label: 'Launch angle (°)', min: 5, max: 85, step: 1 },
    { key: 'y0', label: 'Launch height (m)', min: 0, max: 60, step: 1 },
    { key: 'mass', label: 'Mass (kg)', min: 0.05, max: 20, step: 0.05 },
    { key: 'dragK', label: 'Drag coefficient k (N·s/m or N·s²/m²)', min: 0, max: 3, step: 0.02 },
    { key: 'gravity', label: 'Gravitational acceleration (m/s²)', min: 1, max: 25, step: 0.01, hint: 'Try 1.62 for the Moon, 3.72 for Mars' },
  ],
  options: { maxStep: 1 / 400, sampleEvery: 0.03, resetOn: ['drag', 'speed', 'angle', 'y0', 'mass', 'dragK', 'gravity'] },
  init: (p) => {
    const angle = (p.angle * Math.PI) / 180;
    return { tau: 0, x: 0, y: p.y0, vx: p.speed * Math.cos(angle), vy: p.speed * Math.sin(angle), apex: p.y0, landX: 0, landed: false, energy0: 0.5 * p.mass * p.speed * p.speed + p.mass * p.gravity * p.y0 };
  },
  step: (y, h, p) => {
    if (y.landed) return y;
    let [x, yy, vx, vy] = rk4(accel(p), [y.x, y.y, y.vx, y.vy], y.tau, h);
    let landed = false;
    let landX = y.landX;
    if (yy <= 0 && vy < 0) {
      landed = true;
      landX = x;
      yy = 0;
      vx = 0;
      vy = 0;
    }
    return { ...y, tau: y.tau + h, x, y: yy, vx, vy, apex: Math.max(y.apex, yy), landed: landed || y.landed, landX: landed ? landX : y.landX };
  },
  read: (y, p) => {
    const speed = Math.hypot(y.vx, y.vy);
    const reference = vacuum(p);
    const energy = 0.5 * p.mass * speed * speed + p.mass * p.gravity * y.y;
    return {
      t: y.tau,
      x: y.x,
      y: y.y,
      vx: y.vx,
      vy: y.vy,
      speed,
      apex: y.apex,
      landed: y.landed,
      range: y.landed ? y.landX : y.x,
      flightTime: y.tau,
      energy,
      energyLost: y.energy0 - energy,
      vacuumRange: reference.range,
      vacuumApex: reference.apex,
      vacuumTime: reference.time,
      rangePenalty: reference.range > 0 ? (1 - (y.landed ? y.landX : y.x) / reference.range) * 100 : 0,
      comparison: p.drag === 'none' ? 'matches the vacuum prediction' : 'falls short of the vacuum prediction',
      path: vacuumPath(p),
    };
  },
  series: [
    { key: 'x', label: 'Downrange (m)', value: (r) => r.x },
    { key: 'y', label: 'Height (m)', value: (r) => r.y },
    { key: 'speed', label: 'Speed (m/s)', value: (r) => r.speed },
    { key: 'energy', label: 'Mechanical energy (J)', value: (r) => r.energy },
  ],
  verify: () => {
    const list = [];
    const fly = (params, h = 2e-4, limit = 60) => {
      let y = projectileSim.init(params);
      for (let t = 0; t < limit && !y.landed; t += h) y = projectileSim.step(y, h, params);
      return y;
    };
    const base = { ...projectileSim.params, drag: 'none' };
    const free = fly(base);
    const reference = vacuum(base);
    list.push(closeCheck('Vacuum range matches the closed-form prediction', free.landX, reference.range, 2e-3, 3));
    list.push(closeCheck('Vacuum apex height matches v₀ᵧ²/2g + y₀', free.apex, reference.apex, 2e-3, 3));
    list.push(closeCheck('Vacuum flight time matches the closed-form prediction', free.tau, reference.time, 2e-3, 3));

    const lifted = fly({ ...base, y0: 20, angle: 55 });
    const liftedRef = vacuum({ ...base, y0: 20, angle: 55 });
    list.push(closeCheck('Launch from a height: range still matches the closed form', lifted.landX, liftedRef.range, 3e-3, 3));

    const linear = fly({ ...base, drag: 'linear', dragK: 0.4 });
    const quadratic = fly({ ...base, drag: 'quadratic', dragK: 0.02 });
    list.push(check('Linear drag shortens the range', linear.landX < reference.range, `${linear.landX.toFixed(2)} m vs ${reference.range.toFixed(2)} m`));
    list.push(check('Quadratic drag shortens the range', quadratic.landX < reference.range, `${quadratic.landX.toFixed(2)} m vs ${reference.range.toFixed(2)} m`));

    const terminal = (params) => {
      let y = { tau: 0, x: 0, y: 20000, vx: 0, vy: 0, apex: 20000, landX: 0, landed: false, energy0: 0 };
      for (let t = 0; t < 60; t += 5e-4) y = projectileSim.step(y, 5e-4, params);
      return Math.abs(y.vy);
    };
    const linearTerminal = terminal({ ...base, drag: 'linear', dragK: 0.4, y0: 20000 });
    const quadraticTerminal = terminal({ ...base, drag: 'quadratic', dragK: 0.02, y0: 20000 });
    list.push(closeCheck('Linear drag terminal velocity reaches mg/k', linearTerminal, (base.mass * base.gravity) / 0.4, 5e-3, 3));
    list.push(closeCheck('Quadratic drag terminal velocity reaches √(mg/k)', quadraticTerminal, Math.sqrt((base.mass * base.gravity) / 0.02), 5e-3, 3));

    let dragState = projectileSim.init({ ...base, drag: 'quadratic', dragK: 0.02 });
    let previous = dragState.energy0;
    let monotone = true;
    for (let t = 0; t < 4; t += 1e-3) {
      dragState = projectileSim.step(dragState, 1e-3, { ...base, drag: 'quadratic', dragK: 0.02 });
      const energy = 0.5 * base.mass * (dragState.vx ** 2 + dragState.vy ** 2) + base.mass * base.gravity * dragState.y;
      if (energy > previous + 1e-9) monotone = false;
      previous = energy;
    }
    list.push(check('Drag removes mechanical energy at every step', monotone, `energy ${previous.toFixed(4)} J after 4 s`));

    let noDrag = projectileSim.init(base);
    let constant = true;
    for (let t = 0; t < 4 && !noDrag.landed; t += 1e-3) {
      noDrag = projectileSim.step(noDrag, 1e-3, base);
      const energy = 0.5 * base.mass * (noDrag.vx ** 2 + noDrag.vy ** 2) + base.mass * base.gravity * noDrag.y;
      if (Math.abs(energy - noDrag.energy0) > 1e-6) constant = false;
    }
    list.push(check('Without drag the mechanical energy is conserved', constant, `E = ${noDrag.energy0.toFixed(6)} J throughout`));

    const low = fly({ ...base, angle: 30 });
    const high = fly({ ...base, angle: 60 });
    list.push(check('Complementary angles give the same vacuum range', relErr(low.landX, high.landX) < 5e-3, `${low.landX.toFixed(3)} m and ${high.landX.toFixed(3)} m`));

    const landing = fly({ ...base, angle: 35 });
    list.push(check('The projectile lands exactly at ground level with downward velocity gone', Math.abs(landing.y) < 1e-12, `y = ${sig(landing.y, 2)} m at x = ${landing.landX.toFixed(2)} m`));
    return { checks: list };
  },
};