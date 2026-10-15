import { check, closeCheck, relErr, TAU } from '@jarvis/components/toolkit/physics/phys';

/**
 * The Doppler effect, including the wavefront picture: the source emits a crest every 1/f
 * seconds and those crests travel at the speed of sound, so the observed frequency is
 * measured from the arrival times rather than assumed.
 */

const MODE_OPTIONS = [
  { value: 'source', label: 'Moving source, stationary observer' },
  { value: 'observer', label: 'Stationary source, moving observer' },
  { value: 'both', label: 'Both moving' },
];

export const doppler = (p, overrides = {}) => {
  const sourceSpeed = overrides.sourceSpeed ?? (p.mode === 'observer' ? 0 : p.sourceSpeed);
  const observerSpeed = overrides.observerSpeed ?? (p.mode === 'source' ? 0 : p.observerSpeed);
  const c = p.soundSpeed;
  const denominator = c - sourceSpeed;
  const observed = denominator !== 0 ? (p.frequency * (c - observerSpeed)) / denominator : Infinity;
  const wavelength = denominator / p.frequency;
  const mach = Math.abs(sourceSpeed) / c;
  return {
    sourceSpeed,
    observerSpeed,
    observed,
    wavelength,
    shift: observed - p.frequency,
    ratio: observed / p.frequency,
    mach,
    machAngle: mach > 1 ? (Math.asin(1 / mach) * 180) / Math.PI : 0,
    supersonic: mach > 1,
    approachingSource: sourceSpeed > 0,
    recedingObserver: observerSpeed > 0,
    crestSpacing: denominator / p.frequency,
  };
};

/** Arrival times of successive crests at the observer: an independent route to the answer. */
export function arrivalFrequency(params) {
  const c = params.soundSpeed;
  const d0 = 40; // emitter and observer start 40 m apart, source travelling towards the observer
  const times = [];
  for (let n = 0; n < 40; n += 1) {
    const emission = n / params.frequency;
    const arrival = (emission * (c - params.sourceSpeed) + d0) / (c - params.observerSpeed);
    times.push(arrival);
  }
  const intervals = times.slice(1).map((time, index) => time - times[index]);
  const tail = intervals.slice(-8);
  return 1 / (tail.reduce((a, b) => a + b, 0) / tail.length);
}

export const dopplerSim = {
  id: 'doppler-lab',
  unit: 's',
  digits: 2,
  note: 'A source emits a crest every 1/f seconds and each crest travels outward at the speed of sound. Because the source moves between emissions the crests bunch ahead of it and stretch behind, and because the observer may be moving the rate at which crests arrive changes again: f′ = f(c − v_observer)/(c − v_source), with the source speed positive towards the observer.',
  checkNote: 'The observed frequency is re-derived from the arrival times of successive wavefronts, the wavelength in the medium is measured from the crest spacing, and the at-rest case, the moving-source asymmetry and the Mach cone are all tested.',
  params: { mode: 'source', frequency: 420, sourceSpeed: 40, observerSpeed: 0, soundSpeed: 343 },
  fields: [
    { key: 'mode', label: 'Experiment', options: MODE_OPTIONS },
    { key: 'frequency', label: 'Emitted frequency (Hz)', min: 80, max: 1200, step: 5 },
    { key: 'sourceSpeed', label: 'Source speed (m/s, + approaching)', min: -420, max: 420, step: 5 },
    { key: 'observerSpeed', label: 'Observer speed (m/s, + receding)', min: -300, max: 300, step: 5 },
    { key: 'soundSpeed', label: 'Speed of sound (m/s)', min: 150, max: 500, step: 1 },
  ],
  options: { maxStep: 1 / 240, sampleEvery: 0.05, resetOn: ['mode', 'frequency', 'sourceSpeed', 'observerSpeed', 'soundSpeed'] },
  init: (p) => ({ tau: 0, nextCrest: 0, crests: [], sourceX: -30, observerX: 30, measured: 0, lastArrival: null }),
  step: (y, h, p) => {
    const state = { ...y, tau: y.tau + h };
    const speeds = doppler(p);
    state.sourceX = -30 + speeds.sourceSpeed * state.tau;
    state.observerX = 30 + speeds.observerSpeed * state.tau;
    if (state.tau >= state.nextCrest) {
      state.crests = [...state.crests, { x: state.sourceX, born: state.tau }].slice(-30);
      state.nextCrest += 1 / p.frequency;
    }
    // arrival of the fastest crest at the observer, timed to measure the observed frequency
    const arrivals = state.crests
      .map((crest) => ({ crest, time: (state.observerX - crest.x) / p.soundSpeed + crest.born }))
      .filter((item) => item.time <= state.tau && (y.lastArrival === null || item.time > y.lastArrival));
    if (arrivals.length) {
      const last = arrivals[arrivals.length - 1];
      const previous = y.lastArrival;
      state.lastArrival = last.time;
      state.measured = previous === null ? 0 : 1 / (last.time - previous);
    }
    return state;
  },
  read: (y, p) => {
    const speeds = doppler(p);
    const radius = (crest) => (y.tau - crest.born) * p.soundSpeed;
    return {
      t: y.tau,
      ...speeds,
      sourceX: y.sourceX,
      observerX: y.observerX,
      measured: y.measured,
      crests: y.crests.map((crest) => ({ ...crest, r: radius(crest) })),
      gapAhead: speeds.wavelength,
      gapBehind: (p.soundSpeed + speeds.sourceSpeed) / p.frequency,
      wavelengthInMedium: speeds.wavelength,
      arrivalWavelength: (p.soundSpeed - speeds.observerSpeed) / speeds.observed,
    };
  },
  series: [
    { key: 'measured', label: 'Observed frequency (Hz)', value: (r) => r.measured || r.observed },
    { key: 'ratio', label: 'Observed / emitted', value: (r) => r.ratio },
  ],
  verify: () => {
    const list = [];
    const base = { ...dopplerSim.params };

    list.push(closeCheck('At rest the observed frequency equals the emitted frequency', doppler({ ...base, sourceSpeed: 0, observerSpeed: 0 }).observed, base.frequency, 1e-12, 6));
    list.push(check('Approaching source raises the pitch', doppler({ ...base, sourceSpeed: 60 }).observed > base.frequency, `${doppler({ ...base, sourceSpeed: 60 }).observed.toFixed(1)} Hz`));
    list.push(check('Receding source lowers the pitch', doppler({ ...base, sourceSpeed: -60 }).observed < base.frequency, `${doppler({ ...base, sourceSpeed: -60 }).observed.toFixed(1)} Hz`));
    list.push(check('An approaching source beats an approaching observer at the same speed', doppler({ ...base, sourceSpeed: 100, observerSpeed: 0 }).observed > doppler({ ...base, sourceSpeed: 0, observerSpeed: -100 }).observed, `${doppler({ ...base, sourceSpeed: 100 }).observed.toFixed(1)} Hz against ${doppler({ ...base, observerSpeed: -100 }).observed.toFixed(1)} Hz`));

    for (const speeds of [{ sourceSpeed: 60, observerSpeed: 0 }, { sourceSpeed: 0, observerSpeed: 40 }, { sourceSpeed: 80, observerSpeed: 30 }, { sourceSpeed: -50, observerSpeed: -20 }]) {
      const params = { ...base, mode: 'both', ...speeds };
      list.push(closeCheck(`Arrival-time simulation agrees for v_s = ${speeds.sourceSpeed} m/s, v_o = ${speeds.observerSpeed} m/s`, arrivalFrequency(params), doppler(params).observed, 5e-3, 3));
    }

    const moving = { ...base, sourceSpeed: 80, observerSpeed: 0 };
    list.push(closeCheck('Wavelength ahead of the source is (c − v_s)/f', doppler(moving).wavelength, (base.soundSpeed - 80) / base.frequency, 1e-12, 5));
    list.push(closeCheck('Wavelength behind the source is (c + v_s)/f', (base.soundSpeed + 80) / base.frequency, doppler({ ...base, sourceSpeed: -80 }).wavelength, 1e-12, 5));
    list.push(closeCheck('Observed frequency times wavelength equals the wave speed in the medium', doppler(moving).observed * doppler(moving).wavelength, base.soundSpeed, 1e-12, 4));

    const supersonic = doppler({ ...base, sourceSpeed: 400 });
    list.push(check('Faster than sound the Mach angle appears', supersonic.supersonic && supersonic.machAngle > 0, `Mach ${supersonic.mach.toFixed(2)}, cone half-angle ${supersonic.machAngle.toFixed(1)}°`));
    list.push(closeCheck('Mach angle satisfies sin θ = c/v_s', Math.sin((supersonic.machAngle * Math.PI) / 180), base.soundSpeed / 400, 1e-12, 6));

    const octave = doppler({ ...base, sourceSpeed: base.soundSpeed / 2 });
    list.push(closeCheck('At half the speed of sound an approaching source doubles the frequency', octave.observed, 2 * base.frequency, 1e-12, 4));
    list.push(check('The shift is negative for a receding observer', doppler({ ...base, mode: 'both', observerSpeed: 120 }).shift < 0, `${doppler({ ...base, mode: 'both', observerSpeed: 120 }).shift.toFixed(1)} Hz`));
    list.push(check('Frequency ratio is dimensionless and consistent', relErr(doppler(moving).ratio, doppler(moving).observed / base.frequency) < 1e-12, `${doppler(moving).ratio.toFixed(4)}×`));
    list.push(check('A crest emitted every 1/f seconds leaves a gap of λ in the medium', Math.abs(doppler({ ...base, sourceSpeed: 0 }).crestSpacing - base.soundSpeed / base.frequency) < 1e-12, `${(base.soundSpeed / base.frequency).toFixed(3)} m`));
    list.push(closeCheck('Phase constant ω/c matches 2π/λ for the observed wave', TAU / doppler(moving).wavelength, TAU * doppler(moving).observed / base.soundSpeed, 1e-12, 6));
    return { checks: list };
  },
};