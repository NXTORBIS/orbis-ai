import { check, closeCheck, linspace } from '@jarvis/components/toolkit/physics/phys';
export const soundSpeed = (temperature) => 331.3 * Math.sqrt((temperature + 273.15) / 273.15);
export const tubeFrequency = (length, speed, n, closed) => (closed ? 2 * n - 1 : n * 2) * speed / (4 * length);
export const roomReverb = (length, width, height, alpha) => {
  const volume = length * width * height, surface = 2 * (length * width + length * height + width * height);
  return { volume, surface, absorption: surface * alpha, sabine: 0.161 * volume / (surface * alpha), eyring: 0.161 * volume / (-surface * Math.log1p(-alpha)) };
};
export const acousticSim = {
  id: 'acoustics-resonance', unit: 'display s',
  endTime: (p) => p.mode === 'room' ? 1.5 * roomReverb(p.roomLength, p.roomWidth, p.roomHeight, p.absorption).eyring : undefined,
  params: { mode: 'tube', boundary: 'open', temperature: 20, length: 1, harmonic: 1, f1: 440, f2: 444, roomLength: 6, roomWidth: 4, roomHeight: 3, absorption: 0.2 },
  fields: [
    { key: 'mode', label: 'Experiment', options: [{ value: 'tube', label: 'Air-column standing waves' }, { value: 'beats', label: 'Two-tone beating' }, { value: 'room', label: 'Room reverberation' }] },
    { key: 'boundary', label: 'Tube ends', options: [{ value: 'open', label: 'Open / open' }, { value: 'closed', label: 'Closed / open' }], when: { mode: ['tube'] } },
    { key: 'temperature', label: 'Air temperature (°C)', min: -20, max: 60, step: 1, when: { mode: ['tube', 'room'] } },
    { key: 'length', label: 'Tube length (m)', min: 0.05, max: 5, step: 0.01, when: { mode: ['tube'] } },
    { key: 'harmonic', label: 'Mode number', min: 1, max: 8, integer: true, when: { mode: ['tube'] } },
    { key: 'f1', label: 'First tone (Hz)', min: 20, max: 2000, step: 1, when: { mode: ['beats'] } },
    { key: 'f2', label: 'Second tone (Hz)', min: 20, max: 2000, step: 1, when: { mode: ['beats'] } },
    { key: 'roomLength', label: 'Room length (m)', min: 1, max: 40, step: 0.1, when: { mode: ['room'] } },
    { key: 'roomWidth', label: 'Room width (m)', min: 1, max: 40, step: 0.1, when: { mode: ['room'] } },
    { key: 'roomHeight', label: 'Room height (m)', min: 1, max: 15, step: 0.1, when: { mode: ['room'] } },
    { key: 'absorption', label: 'Mean absorption coefficient α', min: 0.02, max: 0.9, step: 0.01, slider: true, when: { mode: ['room'] } },
  ],
  options: { maxStep: 0.05, resetOn: ['mode', 'boundary', 'length', 'harmonic', 'absorption', 'roomLength', 'roomWidth', 'roomHeight'] }, init: () => ({}), step: (s) => s, series: [],
  read: (s, p) => {
    const c = soundSpeed(p.temperature), closed = p.boundary === 'closed', frequency = tubeFrequency(p.length, c, p.harmonic, closed);
    const room = roomReverb(p.roomLength, p.roomWidth, p.roomHeight, p.absorption), time = Math.min(s.t ?? 0, room.eyring * 1.5);
    const beat = Math.abs(p.f1 - p.f2), phase = (s.t ?? 0) * Math.PI * 2;
    return { c, frequency, wavelength: c / frequency, room, beat, beatPeriod: beat ? 1 / beat : null, db: -60 * time / room.eyring, roomTime: time, phase, amplitude: Math.abs(Math.cos(Math.PI * beat * (s.t ?? 0) / 10)) };
  },
  analyse: (p) => {
    const r = acousticSim.read({}, p), closed = p.boundary === 'closed';
    if (p.mode === 'tube') return { shape: linspace(0, p.length, 161).map((x) => ({ x, y: closed ? Math.cos((2 * p.harmonic - 1) * Math.PI * x / (2 * p.length)) : Math.sin(p.harmonic * Math.PI * x / p.length) })), modes: Array.from({ length: 8 }, (_, i) => ({ mode: i + 1, frequency: tubeFrequency(p.length, r.c, i + 1, closed) })) };
    if (p.mode === 'room') return { curves: ['sabine', 'eyring'].map((key) => ({ label: key === 'sabine' ? 'Sabine' : 'Eyring', points: linspace(0, r.room.sabine * 1.5, 151).map((x) => ({ x, y: -60 * x / r.room[key] })) })) };
    const xs = linspace(0, 5 / Math.min(p.f1, p.f2), 401), envelope = linspace(0, r.beat ? 4 / r.beat : 1, 201);
    return { waveform: xs.map((x) => ({ x, y: (Math.sin(2 * Math.PI * p.f1 * x) + Math.sin(2 * Math.PI * p.f2 * x)) / 2 })), envelope: envelope.map((x) => ({ x, y: Math.abs(Math.cos(Math.PI * r.beat * x)) })) };
  },
  note: 'Ideal one-dimensional tubes without end correction; pressure has nodes at open ends and an antinode at a closed end. The tube animation is slowed to one displayed cycle per second. Beats can be heard using quiet local audio. Room times use diffuse-field Sabine and Eyring estimates, not a geometric wave solver.',
  checkNote: 'Open/closed pressure boundary conditions, harmonic ratios, the beat identity, low-absorption Sabine–Eyring agreement and the 60 dB pressure decay.',
  verify: () => {
    const c = soundSpeed(20), f = tubeFrequency(1, c, 1, false), closed = tubeFrequency(1, c, 1, true), room = roomReverb(6, 4, 3, 0.2), low = roomReverb(6, 4, 3, 0.001);
    const t = 0.003;
    return { checks: [
      closeCheck('Room-temperature sound speed is about 343.2 m/s', c, 343.2, 0.001),
      closeCheck('An open tube fundamental satisfies f = c/2L', f, c / 2, 1e-12),
      closeCheck('Closing an end halves the fundamental', closed / f, 0.5, 1e-12),
      closeCheck('The second closed-tube mode is the third harmonic', tubeFrequency(1, c, 2, true) / closed, 3, 1e-12),
      check('Open-tube pressure vanishes at both ends', Math.abs(Math.sin(3 * Math.PI)) < 1e-12, 'sin(nπx/L) has two end nodes'),
      check('A closed-tube pressure antinode faces an open-end node', Math.cos(0) === 1 && Math.abs(Math.cos(5 * Math.PI / 2)) < 1e-12, 'cos((2n−1)πx/2L)'),
      closeCheck('Two tones obey the exact product-to-sum beat identity', Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 444 * t), 2 * Math.sin(2 * Math.PI * 442 * t) * Math.cos(2 * Math.PI * 2 * t), 1e-12),
      closeCheck('The room volume is 72 m³', room.volume, 72, 1e-12),
      closeCheck('The surface area is 108 m²', room.surface, 108, 1e-12),
      closeCheck('At low absorption Eyring approaches Sabine', low.eyring / low.sabine, 1, 0.001),
      check('Eyring gives faster decay at appreciable absorption', room.eyring < room.sabine, '−ln(1−α) > α'),
      closeCheck('60 dB decay means pressure falls by a factor 1000', Math.pow(10, -60 / 20), 0.001, 1e-12),
    ] };
  },
};