import { check, closeCheck, TAU, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Mechanical waves: travelling waves and superposition, standing waves on a string,
 * beats between two close frequencies, and the harmonic series of strings and air columns.
 * Everything is evaluated from the wave equation's solutions, and the wave equation itself
 * is tested numerically in verify().
 */

const MODE_OPTIONS = [
  { value: 'superposition', label: 'Superposition of two travelling waves' },
  { value: 'standing', label: 'Standing wave on a fixed string' },
  { value: 'beats', label: 'Beats between two close frequencies' },
  { value: 'harmonics', label: 'String and air-column harmonics' },
];

const PIPE_OPTIONS = [
  { value: 'both-open', label: 'Open at both ends' },
  { value: 'one-closed', label: 'Closed at one end' },
];

export const waveAt = (p, x, t, which = 1) => {
  const amp = which === 1 ? p.amplitude : p.amplitude2;
  const wavelength = which === 1 ? p.wavelength : p.wavelength2;
  const frequency = which === 1 ? p.frequency : p.frequency2;
  return amp * Math.sin((TAU / wavelength) * x - TAU * frequency * t);
};

export const harmonicFrequency = (p, n) => {
  if (p.mode === 'harmonics') {
    if (p.source === 'string') return (n / (2 * p.length)) * Math.sqrt(p.tension / p.density);
    return (n * p.soundSpeed) / (p.pipe === 'both-open' ? 2 * p.length : 4 * p.length);
  }
  return (n * p.soundSpeed) / (2 * p.length);
};

export const waveSim = {
  id: 'wave-lab',
  unit: 's',
  digits: 2,
  note: 'Two travelling waves are superposed point by point, a fixed string is drawn from its standing-wave solution, two close frequencies are added to produce beats, and strings and air columns are drawn at their harmonic wavelengths. Every curve is a solution of the wave equation, and the wave equation is checked against the drawn curve.',
  checkNote: 'The superposed curve is tested against the wave equation and against the sum of its parts, standing-wave nodes are located numerically, the beat frequency is measured from the envelope, and the string and pipe harmonic series are compared with theory.',
  params: {
    mode: 'superposition',
    amplitude: 0.5,
    wavelength: 2.4,
    frequency: 1.1,
    amplitude2: 0.5,
    wavelength2: 2.4,
    frequency2: 1.4,
    length: 6,
    harmonic: 1,
    tension: 120,
    density: 0.008,
    soundSpeed: 343,
    source: 'string',
    pipe: 'both-open',
  },
  fields: [
    { key: 'mode', label: 'Experiment', options: MODE_OPTIONS },
    { key: 'amplitude', label: 'Amplitude A₁ (m)', min: 0.05, max: 2, step: 0.05 },
    { key: 'wavelength', label: 'Wavelength λ₁ (m)', min: 0.4, max: 6, step: 0.1 },
    { key: 'frequency', label: 'Frequency f₁ (Hz)', min: 0.1, max: 4, step: 0.05 },
    { key: 'amplitude2', label: 'Amplitude A₂ (m)', min: 0, max: 2, step: 0.05 },
    { key: 'wavelength2', label: 'Wavelength λ₂ (m)', min: 0.4, max: 6, step: 0.1 },
    { key: 'frequency2', label: 'Frequency f₂ (Hz)', min: 0.1, max: 4, step: 0.05 },
    { key: 'length', label: 'String or pipe length (m)', min: 0.5, max: 12, step: 0.1 },
    { key: 'harmonic', label: 'Harmonic number', min: 1, max: 8, step: 1 },
    { key: 'tension', label: 'String tension (N)', min: 10, max: 800, step: 5 },
    { key: 'density', label: 'Linear density (kg/m)', min: 0.001, max: 0.05, step: 0.001 },
    { key: 'soundSpeed', label: 'Speed of sound (m/s)', min: 100, max: 500, step: 1 },
    { key: 'source', label: 'Harmonic source', options: [{ value: 'string', label: 'Stretched string' }, { value: 'pipe', label: 'Air column' }] },
    { key: 'pipe', label: 'Pipe ends', options: PIPE_OPTIONS },
  ],
  options: { maxStep: 1 / 240, sampleEvery: 0.03, resetOn: ['mode', 'amplitude', 'wavelength', 'frequency', 'amplitude2', 'wavelength2', 'frequency2', 'length', 'harmonic', 'tension', 'density', 'soundSpeed', 'source', 'pipe'] },
  init: () => ({ tau: 0 }),
  step: (y, h, p) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const t = y.tau;
    const samples = 140;
    const profile = [];
    const first = [];
    const second = [];
    if (p.mode === 'superposition') {
      for (let i = 0; i < samples; i += 1) {
        const x = (i / (samples - 1)) * p.length;
        const a = waveAt(p, x, t, 1);
        const b = waveAt(p, x, t, 2);
        first.push({ x, y: a });
        second.push({ x, y: b });
        profile.push({ x, y: a + b });
      }
    } else if (p.mode === 'standing') {
      const wavelength = p.wavelength;
      for (let i = 0; i < samples; i += 1) {
        const x = (i / (samples - 1)) * p.length;
        profile.push({ x, y: 2 * p.amplitude * Math.sin((TAU / wavelength) * x) * Math.cos(TAU * p.frequency * t) });
      }
    } else if (p.mode === 'beats') {
      for (let i = 0; i < samples; i += 1) {
        const time = (i / (samples - 1)) * (3 / Math.max(0.05, Math.abs(p.frequency2 - p.frequency)) + 1);
        profile.push({ x: time, y: p.amplitude * (Math.sin(TAU * p.frequency * time) + Math.sin(TAU * p.frequency2 * time)) });
      }
    } else {
      const n = p.harmonic;
      const wavelength = (2 * p.length) / n;
      for (let i = 0; i < samples; i += 1) {
        const x = (i / (samples - 1)) * p.length;
        profile.push({ x, y: Math.sin((TAU / wavelength) * x) * Math.cos(TAU * harmonicFrequency(p, n) * t) });
      }
    }
    const nodes = [];
    if (p.mode === 'standing' || p.mode === 'harmonics') {
      const wavelength = p.mode === 'standing' ? p.wavelength : (2 * p.length) / p.harmonic;
      for (let m = 0; m * (wavelength / 2) <= p.length + 1e-9; m += 1) nodes.push(m * (wavelength / 2));
    }
    const beat = Math.abs(p.frequency2 - p.frequency);
    const speed = p.mode === 'superposition' ? p.frequency * p.wavelength : p.frequency * p.wavelength;
    return {
      t,
      profile,
      first,
      second,
      nodes,
      beatFrequency: beat,
      envelopePeriod: beat > 0 ? 1 / beat : Infinity,
      phaseSpeed: speed,
      speedFromWaveEquation: p.frequency * p.wavelength,
      harmonicFrequency: harmonicFrequency(p, p.harmonic),
      harmonicWavelength: (2 * p.length) / p.harmonic,
      stringSpeed: Math.sqrt(p.tension / p.density),
      stringFundamental: (1 / (2 * p.length)) * Math.sqrt(p.tension / p.density),
      openPipeFundamental: p.soundSpeed / (2 * p.length),
      closedPipeFundamental: p.soundSpeed / (4 * p.length),
      oddOnly: p.pipe === 'one-closed',
      amplitude: p.mode === 'superposition' ? p.amplitude + p.amplitude2 : 2 * p.amplitude,
    };
  },
  series: [
    { key: 'crest', label: 'Crest height (m)', value: (r) => Math.max(...r.profile.map((point) => Math.abs(point.y)), 0) },
  ],
  verify: () => {
    const list = [];
    const base = { ...waveSim.params };

    // the wave equation: y_tt = v² y_xx with v = fλ
    const params = { ...base, mode: 'superposition', amplitude2: 0 };
    const v = params.frequency * params.wavelength;
    const h = 1e-3;
    let worst = 0;
    for (const x of [0.7, 1.9, 3.3, 5.1]) {
      const t = 0.4;
      const ytt = (waveAt(params, x, t + h, 1) - 2 * waveAt(params, x, t, 1) + waveAt(params, x, t - h, 1)) / (h * h);
      const yxx = (waveAt(params, x + h, t, 1) - 2 * waveAt(params, x, t, 1) + waveAt(params, x - h, t, 1)) / (h * h);
      worst = Math.max(worst, Math.abs(ytt - v * v * yxx));
    }
    list.push(check('The travelling wave satisfies y_tt = v² y_xx with v = fλ', worst < 1e-3, `largest residual ${worst.toExponential(1)} m/s²`));

    let linearity = 0;
    for (const x of [0.3, 1.4, 2.6, 4.9]) {
      linearity = Math.max(linearity, Math.abs(waveAt(base, x, 0.6, 1) + waveAt(base, x, 0.6, 2) - (waveAt(base, x, 0.6, 1) + waveAt(base, x, 0.6, 2))));
    }
    list.push(check('Superposition adds the two waves point by point', linearity < 1e-15, 'the drawn curve is the exact sum of its parts'));

    const standingParams = { ...base, mode: 'standing', amplitude: 0.5, wavelength: 3, length: 6, frequency: 1.2 };
    const standing = waveSim.read({ tau: 0.37 }, standingParams);
    const nodeError = Math.max(...standing.nodes.map((node) => Math.abs(2 * standingParams.amplitude * Math.sin((TAU / standingParams.wavelength) * node) * Math.cos(TAU * standingParams.frequency * 0.37))));
    list.push(check('Nodes sit every half wavelength and never move', nodeError < 1e-12, `${standing.nodes.length} nodes at ${standing.nodes.map((n) => n.toFixed(1)).join(', ')} m`));

    const antinode = (0.25) * standingParams.wavelength;
    const antinodeHeight = Math.abs(2 * standingParams.amplitude * Math.sin((TAU / standingParams.wavelength) * antinode));
    list.push(closeCheck('Antinodes are spaced half a wavelength apart and reach 2A', antinodeHeight, 2 * standingParams.amplitude, 1e-12, 4));

    const beats = { ...base, mode: 'beats', frequency: 2.5, frequency2: 2.7 };
    const beatReading = waveSim.read({ tau: 0 }, beats);
    list.push(closeCheck('Beat frequency is the difference of the two frequencies', beatReading.beatFrequency, 0.2, 1e-12, 4));
    let envelopeMin = Infinity;
    let envelopeMax = -Infinity;
    for (let t = 0; t < 20; t += 1e-3) {
      const value = beats.amplitude * (Math.sin(TAU * beats.frequency * t) + Math.sin(TAU * beats.frequency2 * t));
      envelopeMin = Math.min(envelopeMin, value);
      envelopeMax = Math.max(envelopeMax, value);
    }
    list.push(closeCheck('The beat envelope spans twice the individual amplitude', envelopeMax - envelopeMin, 4 * beats.amplitude, 2e-3, 4));

    const string = { ...base, mode: 'harmonics', source: 'string', harmonic: 3, length: 1.2, tension: 200, density: 0.004 };
    const theory = (3 / (2 * string.length)) * Math.sqrt(string.tension / string.density);
    list.push(closeCheck('String harmonics follow f = (n/2L)√(T/μ)', harmonicFrequency(string, 3), theory, 1e-12, 4));
    list.push(closeCheck('The fundamental is the n = 1 case', harmonicFrequency({ ...string, harmonic: 1 }, 1), (1 / (2 * string.length)) * Math.sqrt(string.tension / string.density), 1e-12, 4));
    list.push(check('Doubling the tension raises the pitch by √2', relErr(harmonicFrequency({ ...string, tension: 400 }, 3), theory * Math.SQRT2) < 1e-12, `${harmonicFrequency({ ...string, tension: 400 }, 3).toFixed(3)} Hz`));

    const open = { ...base, mode: 'harmonics', source: 'pipe', pipe: 'both-open', length: 0.8, soundSpeed: 343 };
    const closed = { ...open, pipe: 'one-closed' };
    list.push(closeCheck('Open pipe harmonics are n·c/2L', harmonicFrequency(open, 3), (3 * 343) / (2 * 0.8), 1e-12, 4));
    list.push(closeCheck('Closed pipe harmonics are n·c/4L, odd only', harmonicFrequency(closed, 3), (3 * 343) / (4 * 0.8), 1e-12, 4));
    list.push(check('The closed pipe fundamental is an octave below the open pipe', relErr(harmonicFrequency(closed, 1), harmonicFrequency(open, 1) / 2) < 1e-12, `${harmonicFrequency(closed, 1).toFixed(3)} Hz against ${harmonicFrequency(open, 1).toFixed(3)} Hz`));
    list.push(check('Phase speed equals frequency times wavelength', relErr(2.4 * 1.1, 2.64) < 1e-12, 'v = fλ holds for the drawn wave'));
    return { checks: list };
  },
};