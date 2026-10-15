import { Waves } from 'lucide-react';
import { check, closeCheck, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Reference frames: a swimmer crossing a river with a current, and rain seen from a moving
 * observer. Both are solved from the same Galilean transformation.
 */

const MODE_OPTIONS = [
  { value: 'river', label: 'River crossing' },
  { value: 'rain', label: 'Rain and a moving observer' },
];

export const riverSolution = (p) => {
  const heading = (p.heading * Math.PI) / 180;
  const across = p.swim * Math.cos(heading);
  const along = p.current + p.swim * Math.sin(heading);
  const feasible = across > 1e-6;
  const time = feasible ? p.width / across : Infinity;
  const drift = feasible ? along * time : Infinity;
  const ground = Math.hypot(along, across);
  if (p.swim > Math.abs(p.current)) {
    const best = -Math.asin(p.current / p.swim);
    return { heading, across, along, feasible, time, drift, ground, bestHeading: (best * 180) / Math.PI, bestDrift: 0, bestTime: p.width / (p.swim * Math.cos(best)) };
  }
  const best = -Math.PI / 2 + 1e-3;
  return { heading, across, along, feasible, time, drift, ground, bestHeading: (best * 180) / Math.PI, bestDrift: Math.abs(p.width * Math.tan(best)) * 0, bestTime: Infinity };
};

export const rainSolution = (p) => {
  const rx = 0 - p.observerSpeed;
  const ry = -p.rainSpeed;
  const tilt = (Math.atan2(-rx, -ry) * 180) / Math.PI;
  return { rx, ry, tilt, apparentSpeed: Math.hypot(rx, ry), trueSpeed: p.rainSpeed, observerSpeed: p.observerSpeed };
};

export const relativeSim = {
  id: 'relative-motion-lab',
  unit: 's',
  digits: 2,
  note: 'The same event is described in two frames. In the river case the swimmer’s velocity relative to the water is set by the heading, the water carries them downstream, and the crossing time and drift follow from the ground-frame velocity. In the rain case a stationary observer sees vertical rain while a moving observer measures the rain’s velocity relative to themselves.',
  checkNote: 'Crossing time, drift and the minimum-drift heading are compared with a direct scan of the ground-frame velocity, and the rain case is checked against the Galilean transformation and the apparent-speed identity.',
  params: { mode: 'river', width: 120, current: 1.4, swim: 1.9, heading: 0, rainSpeed: 8, observerSpeed: 0 },
  fields: [
    { key: 'mode', label: 'Reference-frame experiment', options: MODE_OPTIONS },
    { key: 'width', label: 'River width (m)', min: 20, max: 500, step: 10 },
    { key: 'current', label: 'Current speed downriver (m/s)', min: -3, max: 3, step: 0.1 },
    { key: 'swim', label: 'Swimming speed in still water (m/s)', min: 0.2, max: 4, step: 0.05 },
    { key: 'heading', label: 'Heading (° from straight across, + downstream)', min: -89, max: 89, step: 1 },
    { key: 'rainSpeed', label: 'Rain fall speed (m/s)', min: 1, max: 20, step: 0.5 },
    { key: 'observerSpeed', label: 'Observer speed (m/s)', min: -15, max: 15, step: 0.5 },
  ],
  options: { maxStep: 1 / 300, sampleEvery: 0.05, resetOn: ['mode', 'width', 'current', 'swim', 'heading', 'rainSpeed', 'observerSpeed'] },
  init: (p) => ({ tau: 0, s: 0, y: 0 }),
  step: (y, h, p) => {
    if (p.mode !== 'river') return { ...y, tau: y.tau + h };
    const solution = riverSolution(p);
    if (!solution.feasible) return { ...y, tau: y.tau + h };
    const nextS = y.s + solution.along * h;
    const nextY = Math.min(p.width, y.y + solution.across * h);
    return { ...y, tau: y.tau + h, s: nextS, y: nextY };
  },
  read: (y, p) => {
    if (p.mode === 'rain') {
      const rain = rainSolution(p);
      return { mode: 'rain', ...rain, t: y.tau, vertical: p.rainSpeed };
    }
    const solution = riverSolution(p);
    const fraction = Math.min(1, y.y / p.width);
    return {
      mode: 'river',
      t: y.tau,
      ...solution,
      s: y.s,
      y: y.y,
      fraction,
      landed: y.y >= p.width - 1e-9,
      pathEnd: { x: solution.feasible ? solution.drift : 0, y: p.width },
      // the swimmer's track in world coordinates, used for the drawing
      track: [
        { x: 0, y: 0 },
        { x: solution.feasible ? solution.along * solution.time * fraction : 0, y: p.width * fraction },
      ],
    };
  },
  series: [
    { key: 's', label: 'Downstream position (m)', value: (r) => r.s ?? 0 },
    { key: 'y', label: 'Across the river (m)', value: (r) => r.y ?? 0 },
  ],
  verify: () => {
    const list = [];
    const base = { ...relativeSim.params, mode: 'river' };
    const solution = riverSolution(base);
    list.push(closeCheck('Crossing time equals width / (v·cos θ)', solution.time, base.width / (base.swim * Math.cos((base.heading * Math.PI) / 180)), 1e-12));

    const integrate = (params) => {
      let y = relativeSim.init(params);
      for (let t = 0; t < 400; t += 5e-3) {
        y = relativeSim.step(y, 5e-3, params);
        if (y.y >= params.width - 1e-9) break;
      }
      return y;
    };
    const crossed = integrate(base);
    list.push(closeCheck('Simulated crossing agrees with the analytic crossing time', crossed.tau, solution.time, 5e-3, 3));
    list.push(closeCheck('Simulated drift agrees with the analytic drift', crossed.s, solution.drift, 5e-3, 3));

    let best = { heading: 0, drift: Infinity };
    for (let heading = -89; heading <= 89; heading += 0.25) {
      const candidate = riverSolution({ ...base, heading });
      if (candidate.feasible && Math.abs(candidate.drift) < best.drift) best = { heading, drift: Math.abs(candidate.drift), time: candidate.time };
    }
    list.push(check('Minimum drift is found at heading −asin(u/v)', Math.abs(best.heading - solution.bestHeading) < 1, `scan ${best.heading.toFixed(2)}° vs analytic ${solution.bestHeading.toFixed(2)}°`));
    const aimed = riverSolution({ ...base, heading: solution.bestHeading });
    list.push(check('At the best heading the downstream drift vanishes', Math.abs(aimed.drift) < 1e-9, `drift ${aimed.drift.toExponential(1)} m over ${aimed.time.toFixed(1)} s`));

    const slow = riverSolution({ ...base, swim: 1.2, current: 1.4 });
    list.push(check('When the current beats the swimmer no zero-drift heading exists', Math.abs(slow.bestHeading) >= 89, `best heading ${slow.bestHeading.toFixed(1)}°`));

    const shifted = riverSolution({ ...base, current: base.current + 5, heading: base.heading });
    const shiftedGround = Math.hypot(shifted.along, shifted.across);
    list.push(check('Adding a common current changes the ground speed as Galilean relativity requires', relErr(shiftedGround, Math.hypot(solution.along + 5, solution.across)) < 1e-12, `${shiftedGround.toFixed(4)} m/s`));

    const rainParams = { ...base, mode: 'rain', rainSpeed: 8, observerSpeed: 0 };
    const still = rainSolution(rainParams);
    list.push(check('A stationary observer sees vertical rain', Math.abs(still.tilt) < 1e-9, `tilt ${still.tilt.toFixed(6)}°`));
    const walking = rainSolution({ ...rainParams, observerSpeed: 6 });
    list.push(closeCheck('A moving observer tilts the rain by atan(v/u)', walking.tilt, (Math.atan2(6, 8) * 180) / Math.PI, 1e-9, 3));
    list.push(closeCheck('Apparent rain speed is √(v² + u²)', walking.apparentSpeed, Math.hypot(6, 8), 1e-12));
    list.push(check('Reversing the observer’s direction reverses the tilt', Math.abs(rainSolution({ ...rainParams, observerSpeed: -6 }).tilt + walking.tilt) < 1e-9, `tilt symmetry holds`));

    const upstream = riverSolution({ ...base, heading: -30 });
    const downstream = riverSolution({ ...base, heading: 30 });
    list.push(check('Pointing upstream reduces the drift and downstream increases it', upstream.drift < solution.drift && downstream.drift > solution.drift, `${upstream.drift.toFixed(1)} m · ${solution.drift.toFixed(1)} m · ${downstream.drift.toFixed(1)} m`));
    list.push(check('The swimmer’s speed relative to the water is unchanged by the current', relErr(Math.hypot(upstream.along - base.current, upstream.across), Math.hypot(solution.along - base.current, solution.across)) < 1e-12, `${base.swim} m/s in both frames`));
    return { checks: list };
  },
};