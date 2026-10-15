import { check, closeCheck, linspace } from '@jarvis/components/toolkit/physics/phys';

const KBQ = 8.617333262145e-5;
export const diode = (voltage, is, thermal, resistance = 0) => {
  const currentAt = (v) => is * Math.expm1(v / thermal);
  if (!resistance) return { current: currentAt(voltage), junction: voltage };
  let lo = Math.min(0, voltage), hi = Math.max(0, voltage);
  for (let i = 0; i < 65; i++) { const mid = (lo + hi) / 2; if (mid + resistance * currentAt(mid) > voltage) hi = mid; else lo = mid; }
  const junction = (lo + hi) / 2;
  return { current: currentAt(junction), junction };
};
export const solarCell = (is, thermal, photo) => {
  const voc = thermal * Math.log1p(photo / is);
  const currentAt = (v) => photo - is * Math.expm1(v / thermal);
  let lo = 0, hi = voc;
  for (let i = 0; i < 65; i++) { const v = (lo + hi) / 2; if (currentAt(v) - v * is / thermal * Math.exp(v / thermal) > 0) lo = v; else hi = v; }
  const vmpp = (lo + hi) / 2, impp = currentAt(vmpp);
  return { voc, isc: photo, vmpp, impp, pmax: vmpp * impp, fill: photo > 0 ? vmpp * impp / (photo * voc) : 0, currentAt };
};
export const mosfet = (gate, drain, threshold, k, lambda) => {
  const over = gate - threshold;
  const region = over <= 0 ? 'Cutoff' : drain < over ? 'Triode' : 'Saturation';
  const base = over <= 0 ? 0 : drain < over ? k * (over * drain - drain ** 2 / 2) : k * over ** 2 / 2;
  return { current: base * (1 + lambda * drain), region, over };
};
export const semiconductorSim = {
  id: 'semiconductor-devices', unit: 'display s',
  isStatic: (p) => p.mode === 'solar',
  params: { mode: 'diode', temperature: 300, ideality: 1.5, saturation: 1, bias: 0.65, resistance: 100, illumination: 1000, photo: 30, area: 1, gate: 3, drain: 2, threshold: 1, k: 2, lambda: 0.02 },
  fields: [
    { key: 'mode', label: 'Device', options: [{ value: 'diode', label: 'PN diode with series resistance' }, { value: 'solar', label: 'Solar cell & maximum-power point' }, { value: 'mosfet', label: 'Long-channel nMOS transistor' }] },
    { key: 'temperature', label: 'Temperature (K)', min: 200, max: 450, step: 1, when: { mode: ['diode', 'solar'] } },
    { key: 'ideality', label: 'Ideality factor n', min: 1, max: 2.5, step: 0.05, when: { mode: ['diode', 'solar'] } },
    { key: 'saturation', label: 'Saturation current (nA)', min: 0.001, max: 100, step: 0.001, when: { mode: ['diode', 'solar'] }, hint: 'Held fixed with temperature; no material-specific Is(T) model.' },
    { key: 'bias', label: 'Applied voltage (V)', min: -1, max: 1.2, step: 0.01, slider: true, when: { mode: ['diode', 'solar'] } },
    { key: 'resistance', label: 'Series resistance (Ω)', min: 0, max: 10000, step: 1, when: { mode: ['diode'] } },
    { key: 'illumination', label: 'Irradiance (W/m²)', min: 1, max: 1500, step: 1, when: { mode: ['solar'] } },
    { key: 'photo', label: 'Photocurrent at 1000 W/m² (mA)', min: 0.1, max: 1000, step: 0.1, when: { mode: ['solar'] } },
    { key: 'area', label: 'Cell area (cm²)', min: 0.01, max: 100, step: 0.01, when: { mode: ['solar'] } },
    { key: 'gate', label: 'Gate voltage VGS (V)', min: 0, max: 8, step: 0.05, slider: true, when: { mode: ['mosfet'] } },
    { key: 'drain', label: 'Drain voltage VDS (V)', min: 0, max: 8, step: 0.05, slider: true, when: { mode: ['mosfet'] } },
    { key: 'threshold', label: 'Threshold voltage (V)', min: 0.2, max: 4, step: 0.05, when: { mode: ['mosfet'] } },
    { key: 'k', label: 'Conduction parameter k (mA/V²)', min: 0.1, max: 100, step: 0.1, when: { mode: ['mosfet'] } },
    { key: 'lambda', label: 'Channel modulation λ (1/V)', min: 0, max: 0.2, step: 0.005, when: { mode: ['mosfet'] } },
  ],
  options: { maxStep: 0.05, resetOn: ['mode'] }, init: () => ({}), step: (s) => s, series: [],
  read: (s, p) => {
    const thermal = p.ideality * KBQ * p.temperature, is = p.saturation * 1e-9;
    const d = diode(p.bias, is, thermal, p.mode === 'diode' ? p.resistance : 0);
    const solar = solarCell(is, thermal, p.photo * 1e-3 * p.illumination / 1000);
    const mos = mosfet(p.gate, p.drain, p.threshold, p.k * 1e-3, p.lambda);
    const current = p.mode === 'mosfet' ? mos.current : p.mode === 'solar' ? solar.currentAt(p.bias) : d.current;
    const h = 1e-4, gm = (mosfet(p.gate + h, p.drain, p.threshold, p.k * 1e-3, p.lambda).current - mosfet(p.gate - h, p.drain, p.threshold, p.k * 1e-3, p.lambda).current) / (2 * h);
    return { thermal, junction: d.junction, power: current * (p.mode === 'mosfet' ? p.drain : p.bias), ...mos, ...solar, current, gm, efficiency: solar.pmax / (p.illumination * p.area * 1e-4), phase: (s.t ?? 0) % 1 };
  },
  analyse: (p) => {
    const thermal = p.ideality * KBQ * p.temperature, is = p.saturation * 1e-9;
    const solar = solarCell(is, thermal, p.photo * 1e-3 * p.illumination / 1000);
    const xs = linspace(p.mode === 'diode' ? -0.2 : 0, p.mode === 'mosfet' ? 8 : p.mode === 'solar' ? solar.voc : 1.2, 151);
    if (p.mode === 'mosfet') return { curves: [-1, 0, 1].map((delta) => { const gate = Math.max(0, p.gate + delta); return { label: `VGS = ${gate.toFixed(2)} V`, points: xs.map((x) => ({ x, y: mosfet(gate, x, p.threshold, p.k * 1e-3, p.lambda).current * 1000 })) }; }) };
    return { curves: [{ label: 'Current (mA)', points: xs.map((x) => ({ x, y: (p.mode === 'solar' ? solar.currentAt(x) : diode(x, is, thermal, p.resistance).current) * 1000 })) }], power: p.mode === 'solar' ? xs.map((x) => ({ x, y: x * solar.currentAt(x) * 1000 })) : [] };
  },
  note: 'Educational compact models: Shockley diode (no breakdown or high-injection correction), ideal illuminated cell (no shunt/series loss), and long-channel square-law MOSFET. Charge animation is schematic, not microscopic carrier tracking. User-selected Is is held fixed as temperature varies.',
  checkNote: 'Kirchhoff residuals, numerical conductance, open/short-circuit solar limits, maximum-power derivative, MOS cutoff and continuity across saturation.',
  verify: () => {
    const thermal = 1.5 * KBQ * 300, d = diode(0.65, 1e-9, thermal, 100), solar = solarCell(1e-9, thermal, 0.03), h = 1e-6;
    const m = mosfet(3, 2, 1, 0.002, 0);
    return { checks: [
      closeCheck('Series diode satisfies V = Vjunction + IR', d.junction + 100 * d.current, 0.65, 1e-12),
      check('At zero bias the ideal diode carries no current', diode(0, 1e-9, thermal).current === 0, 'I = 0'),
      closeCheck('Strong reverse bias approaches −Is', diode(-1, 1e-9, thermal).current / 1e-9, -1, 1e-9),
      closeCheck('Shockley conductance matches a numerical derivative', (diode(0.5 + h, 1e-9, thermal).current - diode(0.5 - h, 1e-9, thermal).current) / (2 * h), 1e-9 / thermal * Math.exp(0.5 / thermal), 1e-8),
      closeCheck('Short-circuit current equals photocurrent', solar.currentAt(0), 0.03, 1e-12),
      check('The open-circuit solution carries zero current', Math.abs(solar.currentAt(solar.voc)) < 1e-12, 'I(Voc) = 0'),
      check('The power derivative vanishes at the computed MPP', Math.abs(((solar.vmpp + h) * solar.currentAt(solar.vmpp + h) - (solar.vmpp - h) * solar.currentAt(solar.vmpp - h)) / (2 * h)) < 1e-8, 'd(VI)/dV ≈ 0'),
      check('The fill factor is bounded by zero and one', solar.fill > 0 && solar.fill < 1, `FF = ${solar.fill.toFixed(5)}`),
      check('A gate below threshold turns the MOSFET off', mosfet(0.5, 4, 1, 0.002, 0).current === 0, 'cutoff'),
      closeCheck('The square-law saturation current is 4 mA', m.current, 0.004, 1e-12),
      closeCheck('Triode and saturation meet continuously', mosfet(3, 2 - 1e-7, 1, 0.002, 0.02).current, mosfet(3, 2, 1, 0.002, 0.02).current, 1e-7),
      closeCheck('The small-signal transconductance is k(VGS−VT)', (mosfet(3 + h, 4, 1, 0.002, 0).current - mosfet(3 - h, 4, 1, 0.002, 0).current) / (2 * h), 0.004, 1e-8),
    ] };
  },
};