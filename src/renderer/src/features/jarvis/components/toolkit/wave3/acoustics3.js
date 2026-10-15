import { defineTool, numberField, choiceField, metric, samples } from '@jarvis/components/toolkit/science50/model';

const D = defineTool, F = numberField, C = choiceField, M = metric;
const SPEED_OF_SOUND = 343;
const RAD = Math.PI / 180;

export const acousticsTools = [
  D({
    id: 'sabine-reverb', title: 'Room Reverberation (Sabine)', tone: 'violet',
    desc: 'Reverberation time, total absorption and critical distance from a room’s volume and surfaces.',
    fields: [F('volume_m3', 'Room volume (m³)', 100, 1, 20000), F('surface_area_m2', 'Total surface area (m²)', 200, 5, 20000), F('avg_absorption', 'Average absorption coefficient', 0.05, 0.0005, 1), F('source_level_db', 'Source level (dB)', 80, 30, 140)],
    sweep: 'avg_absorption',
    scenarios: [{ label: 'Bare room (α 0.05)', input: { volume_m3: 100, surface_area_m2: 200, avg_absorption: 0.05 } }, { label: 'Carpeted studio', input: { volume_m3: 100, surface_area_m2: 200, avg_absorption: 0.2 } }, { label: 'Treated control room', input: { volume_m3: 60, surface_area_m2: 140, avg_absorption: 0.4 } }, { label: 'Large hall', input: { volume_m3: 8000, surface_area_m2: 3200, avg_absorption: 0.15 } }],
    equation: 'RT = 0.161V/A   ·   A = S·α   ·   RT_Eyring = 0.161V/(−S ln(1−α))   ·   D_c = 0.141√(QA)',
    note: 'Sabine assumes a diffuse field with low absorption. Above α ≈ 0.2 the Eyring form is the better estimate; air absorption is ignored.',
    calculate: (p) => {
      const absorption = p.surface_area_m2 * p.avg_absorption;
      const sabine = (0.161 * p.volume_m3) / absorption;
      const eyring = (0.161 * p.volume_m3) / (-p.surface_area_m2 * Math.log(1 - p.avg_absorption));
      const meanFree = (4 * p.volume_m3) / p.surface_area_m2;
      return {
        primary: M('Reverberation time RT₆₀', sabine, 's'),
        metrics: [M('Eyring RT₆₀', eyring, 's'), M('Total absorption', absorption, 'm² sabin'), M('Mean free path', meanFree, 'm'), M('Schroeder frequency', 2000 * Math.sqrt(sabine / p.volume_m3), 'Hz'), M('Critical distance Q = 1', 0.141 * Math.sqrt(absorption), 'm'), M('Reverberant level rise', 10 * Math.log10(4 / absorption), 'dB')],
        status: sabine <= 0.6 ? 'Speech-friendly decay.' : sabine <= 1.2 ? 'Musical but lively.' : 'Long decay — expect intelligibility problems.',
      };
    },
    references: [
      { label: '100 m³ with 10 m² of absorption reverberates for 1.61 s', input: { volume_m3: 100, surface_area_m2: 200, avg_absorption: 0.05 }, expected: (0.161 * 100) / (200 * 0.05), tolerance: 1e-12 },
      { label: 'Halving the absorption area doubles RT₆₀', input: { volume_m3: 100, surface_area_m2: 200, avg_absorption: 0.1 }, expected: (0.161 * 100) / (200 * 0.1), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'sound-transmission-loss', title: 'Partition Sound Insulation', tone: 'cyan',
    desc: 'Mass-law transmission loss, the level that leaks through a partition and the level in the next room.',
    fields: [F('surface_mass_kg_m2', 'Surface mass (kg/m²)', 20, 0.5, 500), F('frequency_hz', 'Frequency (Hz)', 500, 20, 8000), F('source_level_db', 'Source level (dB)', 85, 30, 140), F('partition_area_m2', 'Partition area (m²)', 20, 1, 2000), F('receiver_absorption_m2', 'Receiving-room absorption (m²)', 10, 0.5, 500)],
    sweep: 'surface_mass_kg_m2',
    scenarios: [{ label: 'Single 100 mm blockwork', input: { surface_mass_kg_m2: 200, frequency_hz: 500 } }, { label: 'Plasterboard leaf', input: { surface_mass_kg_m2: 10, frequency_hz: 500 } }, { label: 'Heavy concrete', input: { surface_mass_kg_m2: 400, frequency_hz: 500 } }, { label: 'Low-frequency check', input: { surface_mass_kg_m2: 20, frequency_hz: 63 } }],
    equation: 'R = 20 log₁₀(m f) − 47.4 (field incidence)   ·   τ = 10^(−R/10)   ·   L₂ = L₁ − R + 10 log₁₀(S/A)',
    note: 'Field-incidence mass law. Real partitions dip below the mass law at their coincidence frequency and rely on cavity, absorbent and resilient layers.',
    calculate: (p) => {
      const loss = 20 * Math.log10(p.surface_mass_kg_m2 * p.frequency_hz) - 47.4;
      const received = p.source_level_db - loss + 10 * Math.log10(p.partition_area_m2 / p.receiver_absorption_m2);
      return {
        primary: M('Sound reduction index', loss, 'dB'),
        metrics: [M('Transmission coefficient', Math.pow(10, -loss / 10), ''), M('Receiving-room level', received, 'dB'), M('Level drop across the partition', p.source_level_db - received, 'dB'), M('Mass doubling gain', 20 * Math.log10(2), 'dB'), M('Approximate STC class', loss >= 50 ? 'STC 50+' : loss >= 40 ? 'STC 40–49' : loss >= 30 ? 'STC 30–39' : 'Below STC 30'), M('Privacy', received <= 35 ? 'Confidential speech' : received <= 45 ? 'Normal speech audible' : 'Raised speech clearly audible')],
        status: `Listener hears ${received.toFixed(1)} dB through the partition.`,
      };
    },
    curve: (p) => {
      const x = samples(50, 5000, 100);
      return { x, y: x.map((f) => 20 * Math.log10(p.surface_mass_kg_m2 * f) - 47.4), xLabel: 'Frequency (Hz)', yLabel: 'Sound reduction index (dB)', unit: 'dB', scale: 'log' };
    },
    references: [
      { label: '20 kg/m² at 500 Hz gives 32.6 dB', input: { surface_mass_kg_m2: 20, frequency_hz: 500 }, expected: 20 * Math.log10(20 * 500) - 47.4, tolerance: 1e-12 },
      { label: 'Doubling the surface mass adds 20 log₁₀2 ≈ 6.02 dB', input: { surface_mass_kg_m2: 40, frequency_hz: 500 }, expected: 20 * Math.log10(20 * 500) - 47.4 + 20 * Math.log10(2), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'helmholtz-resonator', title: 'Helmholtz Resonator', tone: 'amber',
    desc: 'The tuned frequency of a cavity-and-neck absorber, with end corrections for flanged and open necks.',
    fields: [F('cavity_volume_l', 'Cavity volume (litres)', 1, 0.001, 200), F('neck_area_cm2', 'Neck area (cm²)', 1, 0.001, 1000), F('neck_length_cm', 'Neck length (cm)', 2, 0.01, 100), C('end_condition', 'Neck termination', 'flanged', [['flanged', 'Flanged (mounted in a panel)'], ['unflanged', 'Unflanged (open tube)'], ['none', 'No end correction']])],
    sweep: 'neck_length_cm',
    scenarios: [{ label: '1 L bottle', input: { cavity_volume_l: 1, neck_area_cm2: 1, neck_length_cm: 2, end_condition: 'flanged' } }, { label: 'Panel absorber 100 Hz', input: { cavity_volume_l: 20, neck_area_cm2: 40, neck_length_cm: 5, end_condition: 'flanged' } }, { label: 'Small duct silencer', input: { cavity_volume_l: 5, neck_area_cm2: 20, neck_length_cm: 30, end_condition: 'unflanged' } }],
    equation: 'f₀ = (c/2π)√(A/(V L_eff))   ·   L_eff = L + δ   ·   δ = 0.85r flanged, 0.61r unflanged',
    note: 'Lumped-parameter resonator — valid while the cavity is much smaller than a wavelength. Real absorbers add damping material in the neck.',
    calculate: (p) => {
      const area = p.neck_area_cm2 * 1e-4, volume = p.cavity_volume_l * 1e-3, length = p.neck_length_cm * 1e-2;
      const radius = Math.sqrt(area / Math.PI);
      const factor = p.end_condition === 'flanged' ? 0.85 : p.end_condition === 'unflanged' ? 0.61 : 0;
      const effective = length + factor * radius;
      if (effective <= 0) return { error: 'Add a neck length or an end correction so the effective length stays positive.' };
      const frequency = (SPEED_OF_SOUND / (2 * Math.PI)) * Math.sqrt(area / (volume * effective));
      return {
        primary: M('Resonance frequency', frequency, 'Hz'),
        metrics: [M('Neck radius', radius * 1000, 'mm'), M('Effective neck length', effective * 100, 'cm'), M('End correction', factor * radius * 1000, 'mm'), M('Wavelength at resonance', SPEED_OF_SOUND / frequency, 'm'), M('Cavity size check', SPEED_OF_SOUND / frequency / Math.cbrt(volume), 'λ per cavity edge'), M('Compactness', SPEED_OF_SOUND / frequency > 10 * Math.cbrt(volume) ? 'Lumped model valid' : 'Cavity too large for this model')],
        status: `Tuned to ${frequency.toFixed(1)} Hz.`,
      };
    },
    references: [
      { label: '1 L cavity, 1 cm² neck, 2 cm long, flanged → 109.6 Hz', input: { cavity_volume_l: 1, neck_area_cm2: 1, neck_length_cm: 2, end_condition: 'flanged' }, expected: (343 / (2 * Math.PI)) * Math.sqrt(1e-4 / (1e-3 * (0.02 + 0.85 * Math.sqrt(1e-4 / Math.PI)))), tolerance: 1e-9 },
      { label: 'The same neck unflanged tunes slightly lower', input: { cavity_volume_l: 1, neck_area_cm2: 1, neck_length_cm: 2, end_condition: 'unflanged' }, expected: (343 / (2 * Math.PI)) * Math.sqrt(1e-4 / (1e-3 * (0.02 + 0.61 * Math.sqrt(1e-4 / Math.PI)))), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'duct-attenuation', title: 'Ducted HVAC Attenuation', tone: 'emerald',
    desc: 'How much a duct run takes out of a fan’s level before the air reaches the occupied room.',
    fields: [F('source_level_db', 'Fan or unit level (dB)', 80, 30, 140), F('duct_length_m', 'Duct length (m)', 10, 0.1, 300), F('attenuation_per_m_db', 'Duct attenuation (dB/m)', 0.5, 0, 3), F('elbows', 'Elbows', 3, 0, 30, 1), F('elbow_loss_db', 'Loss per elbow (dB)', 3, 0, 15), F('end_reflection_db', 'Terminal end reflection (dB)', 8, 0, 25), F('room_attenuation_db', 'Room attenuation (dB)', 6, 0, 30)],
    sweep: 'duct_length_m',
    scenarios: [{ label: '10 m branch', input: { duct_length_m: 10, attenuation_per_m_db: 0.5, elbows: 3 } }, { label: 'Short 2 m run', input: { duct_length_m: 2, attenuation_per_m_db: 0.5, elbows: 1 } }, { label: 'Long 40 m run', input: { duct_length_m: 40, attenuation_per_m_db: 0.5, elbows: 6 } }],
    equation: 'L = L_source − (L·a + n·a_elbow + a_end + a_room)',
    note: 'Element losses add in dB. Attenuation varies strongly with frequency, so check the octave band that matters for the noise complaint.',
    calculate: (p) => {
      const duct = p.duct_length_m * p.attenuation_per_m_db;
      const bends = p.elbows * p.elbow_loss_db;
      const total = duct + bends + p.end_reflection_db + p.room_attenuation_db;
      const level = p.source_level_db - total;
      return {
        primary: M('Level at the listener', level, 'dB'),
        metrics: [M('Total path attenuation', total, 'dB'), M('Straight duct attenuation', duct, 'dB'), M('Elbow attenuation', bends, 'dB'), M('Terminal + room attenuation', p.end_reflection_db + p.room_attenuation_db, 'dB'), M('Silencer needed for 35 dB', Math.max(0, level - 35), 'dB'), M('Speech interference', level <= 35 ? 'Conversation is easy' : level <= 45 ? 'Slight annoyance' : 'Speech intelligibility drops')],
        status: level <= 35 ? 'Comfortable for an occupied room.' : 'Add attenuation to reach a 35 dB target.',
      };
    },
    references: [
      { label: '10 m run with three elbows leaves 52 dB', input: { source_level_db: 80, duct_length_m: 10, attenuation_per_m_db: 0.5, elbows: 3, elbow_loss_db: 3, end_reflection_db: 8, room_attenuation_db: 6 }, expected: 80 - 10 * 0.5 - 3 * 3 - 8 - 6, tolerance: 1e-12 },
      { label: 'Doubling the duct length takes out another 5 dB', input: { source_level_db: 80, duct_length_m: 20, attenuation_per_m_db: 0.5, elbows: 3, elbow_loss_db: 3, end_reflection_db: 8, room_attenuation_db: 6 }, expected: 80 - 20 * 0.5 - 3 * 3 - 8 - 6, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'vibration-transmissibility', title: 'Vibration Isolation Sizing', tone: 'cyan',
    desc: 'Transmissibility through a mount, the isolation you gain, and the static deflection it implies.',
    fields: [F('excitation_hz', 'Excitation frequency (Hz)', 60, 1, 5000), F('natural_hz', 'Mount natural frequency (Hz)', 10, 0.5, 500), F('damping_ratio', 'Damping ratio ζ', 0.05, 0, 1), F('force_input_n', 'Disturbing force (N)', 100, 0, 1e6)],
    sweep: 'natural_hz',
    scenarios: [{ label: 'Fan at 60 Hz, 10 Hz mount', input: { excitation_hz: 60, natural_hz: 10, damping_ratio: 0.05 } }, { label: 'At resonance', input: { excitation_hz: 10, natural_hz: 10, damping_ratio: 0.05 } }, { label: 'Soft mount 3 Hz', input: { excitation_hz: 60, natural_hz: 3, damping_ratio: 0.1 } }, { label: 'Stiff mount 40 Hz', input: { excitation_hz: 60, natural_hz: 40, damping_ratio: 0.1 } }],
    equation: 'T = √((1 + (2ζr)²)/((1 − r²)² + (2ζr)²))   ·   r = f/f_n   ·   isolation = 1 − T',
    note: 'Single-degree-of-freedom rigid body on a linear isolator. Real installations need the six rigid-body modes and the isolator’s load-line checked.',
    calculate: (p) => {
      const r = p.excitation_hz / p.natural_hz, z = p.damping_ratio;
      const transmissibility = Math.sqrt((1 + (2 * z * r) ** 2) / ((1 - r * r) ** 2 + (2 * z * r) ** 2));
      const deflection = 9.80665 / ((2 * Math.PI * p.natural_hz) ** 2) * 1000;
      return {
        primary: M('Transmissibility', transmissibility * 100, '%'),
        metrics: [M('Frequency ratio r', r, ''), M('Isolation efficiency', (1 - transmissibility) * 100, '%'), M('Transmitted force', transmissibility * p.force_input_n, 'N'), M('Static deflection needed', deflection, 'mm'), M('Natural frequency for 90 % isolation', p.excitation_hz / 3.16227766, 'Hz'), M('Mount state', r > 1.414 ? 'Isolating' : r > 0.8 ? 'Near resonance — amplification' : 'Quasi-static — no isolation')],
        status: r > 1.414 ? `Isolating ${((1 - transmissibility) * 100).toFixed(1)} % of the vibration.` : 'Below the isolation threshold: the mount amplifies or passes vibration.',
      };
    },
    curve: (p) => {
      const x = samples(0.05, 4, 120);
      return { x, y: x.map((r) => Math.sqrt((1 + (2 * p.damping_ratio * r) ** 2) / ((1 - r * r) ** 2 + (2 * p.damping_ratio * r) ** 2)) * 100), xLabel: 'Frequency ratio r', yLabel: 'Transmissibility (%)', unit: '%' };
    },
    references: [
      { label: 'At r = √2 every mount transmits exactly 100 %', input: { excitation_hz: Math.SQRT2 * 10, natural_hz: 10, damping_ratio: 0.05 }, expected: 100, tolerance: 1e-9 },
      { label: 'At resonance with ζ = 0.05 the mount amplifies to 1005 %', input: { excitation_hz: 10, natural_hz: 10, damping_ratio: 0.05 }, expected: Math.sqrt(1.01 / 0.01) * 100, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'beam-mode-frequency', title: 'Beam Natural Frequency', tone: 'violet',
    desc: 'Fundamental and second bending mode of a beam, with the static sag that goes with it.',
    fields: [C('material', 'Material', 'steel', [['steel', 'Steel (E 200 GPa, ρ 7850)'], ['aluminium', 'Aluminium (70 GPa, ρ 2700)'], ['timber', 'Timber (11 GPa, ρ 600)'], ['concrete', 'Concrete (30 GPa, ρ 2400)']]), F('breadth_mm', 'Section breadth (mm)', 50, 1, 2000), F('depth_mm', 'Section depth (mm)', 100, 1, 2000), F('span_m', 'Span (m)', 2, 0.1, 40), C('support', 'End condition', 'simply-supported', [['simply-supported', 'Simply supported'], ['cantilever', 'Cantilever'], ['fixed-fixed', 'Fixed–fixed'], ['free-free', 'Free–free']])],
    sweep: 'span_m',
    scenarios: [{ label: '50×100 steel, 2 m', input: { material: 'steel', breadth_mm: 50, depth_mm: 100, span_m: 2, support: 'simply-supported' } }, { label: 'Cantilever', input: { material: 'steel', breadth_mm: 50, depth_mm: 100, span_m: 2, support: 'cantilever' } }, { label: 'Fixed–fixed', input: { material: 'steel', breadth_mm: 50, depth_mm: 100, span_m: 2, support: 'fixed-fixed' } }, { label: 'Timber joist 4 m', input: { material: 'timber', breadth_mm: 45, depth_mm: 200, span_m: 4, support: 'simply-supported' } }],
    equation: 'f_n = (β_n²/2π)√(EI/(mL⁴))   ·   βL = π (simple), 1.875 (cantilever), 4.730 (fixed–fixed)',
    note: 'Euler–Bernoulli bending with a uniform prismatic section and no axial load. Rotary inertia and shear matter for short, deep beams.',
    calculate: (p) => {
      const materials = { steel: [200e9, 7850], aluminium: [70e9, 2700], timber: [11e9, 600], concrete: [30e9, 2400] };
      const [modulus, density] = materials[p.material];
      const b = p.breadth_mm / 1000, h = p.depth_mm / 1000, L = p.span_m;
      const inertia = (b * h ** 3) / 12;
      const area = b * h;
      const massPerLength = density * area;
      const rigidity = modulus * inertia;
      const modes = { 'simply-supported': [Math.PI, 2 * Math.PI], cantilever: [1.8751, 4.6941], 'fixed-fixed': [4.73, 7.8532], 'free-free': [4.73, 7.8532] };
      const [k1, k2] = modes[p.support];
      const scale = Math.sqrt(rigidity / (massPerLength * L ** 4));
      const first = ((k1 * k1) / (2 * Math.PI)) * scale;
      const second = ((k2 * k2) / (2 * Math.PI)) * scale;
      const sag = p.support === 'cantilever' ? (massPerLength * 9.80665 * L ** 4) / (8 * rigidity) : (5 * massPerLength * 9.80665 * L ** 4) / (384 * rigidity);
      return {
        primary: M('Fundamental frequency', first, 'Hz'),
        metrics: [M('Second bending mode', second, 'Hz'), M('Bending stiffness EI', rigidity / 1000, 'kN·m²'), M('Second moment of area', inertia * 1e8, 'cm⁴'), M('Mass per length', massPerLength, 'kg/m'), M('Static sag under self weight', -sag * 1000, 'mm'), M('Dynamic amplification risk', first < 5 ? 'Low-frequency structure — check excitation' : 'Comfortably above typical machinery')],
        status: `First mode at ${first.toFixed(1)} Hz, then ${second.toFixed(1)} Hz.`,
      };
    },
    references: [
      { label: 'Simply supported steel 50×100 over 2 m → 57.2 Hz', input: { material: 'steel', breadth_mm: 50, depth_mm: 100, span_m: 2, support: 'simply-supported' }, expected: (Math.PI ** 2 / (2 * Math.PI)) * Math.sqrt((200e9 * (0.05 * 0.1 ** 3 / 12)) / (7850 * 0.05 * 0.1 * 2 ** 4)), tolerance: 1e-9 },
      { label: 'The same section clamped at one end → 14.0 Hz', input: { material: 'steel', breadth_mm: 50, depth_mm: 100, span_m: 2, support: 'cantilever' }, expected: (1.8751 ** 2 / (2 * Math.PI)) * Math.sqrt((200e9 * (0.05 * 0.1 ** 3 / 12)) / (7850 * 0.05 * 0.1 * 2 ** 4)), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'damped-free-decay', title: 'Damping from a Decay Trace', tone: 'amber',
    desc: 'Logarithmic decrement, damping ratio and quality factor from two peaks on a decay record.',
    fields: [F('initial_amplitude', 'First peak amplitude', 1, 0.0001, 1e6), F('later_amplitude', 'Later peak amplitude', 0.5, 0.00001, 1e6), F('cycles', 'Cycles between the peaks', 1, 1, 200, 1), F('damped_frequency_hz', 'Damped frequency (Hz)', 10, 0.01, 1000)],
    sweep: 'cycles',
    scenarios: [{ label: 'Halved in one cycle', input: { initial_amplitude: 1, later_amplitude: 0.5, cycles: 1, damped_frequency_hz: 10 } }, { label: 'Halved over ten cycles', input: { initial_amplitude: 1, later_amplitude: 0.5, cycles: 10, damped_frequency_hz: 10 } }, { label: 'Light damping', input: { initial_amplitude: 1, later_amplitude: 0.9, cycles: 1, damped_frequency_hz: 25 } }],
    equation: 'δ = (1/n) ln(x₀/x_n)   ·   ζ = δ/√(4π² + δ²)   ·   f_n = f_d/√(1 − ζ²)   ·   Q = 1/(2ζ)',
    note: 'Viscous (linear) damping with a single dominant mode. Coulomb friction decays linearly and needs a different fit.',
    calculate: (p) => {
      if (p.later_amplitude >= p.initial_amplitude) return { error: 'The later peak must be smaller than the first peak for a decay to be visible.' };
      const decrement = Math.log(p.initial_amplitude / p.later_amplitude) / p.cycles;
      const zeta = decrement / Math.sqrt(4 * Math.PI ** 2 + decrement ** 2);
      const natural = p.damped_frequency_hz / Math.sqrt(1 - zeta ** 2);
      const tau = 1 / (zeta * 2 * Math.PI * natural);
      return {
        primary: M('Damping ratio ζ', zeta * 100, '%'),
        metrics: [M('Logarithmic decrement δ', decrement, ''), M('Natural frequency', natural, 'Hz'), M('Quality factor Q', 1 / (2 * zeta), ''), M('Decay time constant', tau, 's'), M('Amplitude after 10 more cycles', p.later_amplitude * Math.exp(-decrement * 10), ''), M('Time to settle to 5 %', 3 * tau, 's')],
        status: `Decay of ${(decrement).toFixed(3)} per cycle ⇒ ζ = ${(zeta * 100).toFixed(2)} %.`,
      };
    },
    references: [
      { label: 'A halving in one cycle gives ζ = 10.95 %', input: { initial_amplitude: 1, later_amplitude: 0.5, cycles: 1, damped_frequency_hz: 10 }, expected: (Math.log(2) / Math.sqrt(4 * Math.PI ** 2 + Math.log(2) ** 2)) * 100, tolerance: 1e-9 },
      { label: 'Halving over two cycles gives the same ζ — the decrement per cycle is unchanged', input: { initial_amplitude: 1, later_amplitude: 0.25, cycles: 2, damped_frequency_hz: 10 }, expected: (Math.log(2) / Math.sqrt(4 * Math.PI ** 2 + Math.log(2) ** 2)) * 100, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'band-level-summation', title: 'Octave-Band Level Summation', tone: 'rose',
    desc: 'Add band levels into an overall level, with A and C weighting applied band by band.',
    fields: [F('level_500_hz', '500 Hz band (dB)', 60, 0, 140), F('level_1000_hz', '1 kHz band (dB)', 60, 0, 140), F('level_2000_hz', '2 kHz band (dB)', 60, 0, 140), F('level_4000_hz', '4 kHz band (dB)', 60, 0, 140), C('weighting', 'Weighting', 'a', [['a', 'A-weighted (dB(A))'], ['c', 'C-weighted (dB(C))'], ['none', 'Unweighted (dB)']])],
    sweep: 'level_1000_hz',
    scenarios: [{ label: 'Flat 60 dB, A-weighted', input: { level_500_hz: 60, level_1000_hz: 60, level_2000_hz: 60, level_4000_hz: 60, weighting: 'a' } }, { label: 'Low-frequency hum', input: { level_500_hz: 75, level_1000_hz: 60, level_2000_hz: 50, level_4000_hz: 45, weighting: 'a' } }, { label: 'High-frequency hiss', input: { level_500_hz: 50, level_1000_hz: 60, level_2000_hz: 70, level_4000_hz: 72, weighting: 'a' } }, { label: 'Unweighted', input: { level_500_hz: 60, level_1000_hz: 60, level_2000_hz: 60, level_4000_hz: 60, weighting: 'none' } }],
    equation: 'L = 10 log₁₀ Σ 10^((L_i + w_i)/10)   ·   A: 500 Hz −3.2, 1 kHz 0, 2 kHz +1.2, 4 kHz +1.0 dB',
    note: 'Four octave bands only, with tabulated weighting offsets. A full rating needs all eight octave bands or a third-octave spectrum.',
    calculate: (p) => {
      const offsets = {
        a: { 500: -3.2, 1000: 0, 2000: 1.2, 4000: 1.0 },
        c: { 500: 0, 1000: 0, 2000: -0.2, 4000: -0.8 },
        none: { 500: 0, 1000: 0, 2000: 0, 4000: 0 },
      }[p.weighting];
      const bands = [{ key: '500', level: p.level_500_hz }, { key: '1000', level: p.level_1000_hz }, { key: '2000', level: p.level_2000_hz }, { key: '4000', level: p.level_4000_hz }];
      const weighted = (item) => item.level + offsets[item.key];
      const total = 10 * Math.log10(bands.reduce((sum, item) => sum + Math.pow(10, weighted(item) / 10), 0));
      const unweighted = 10 * Math.log10(bands.reduce((sum, item) => sum + Math.pow(10, item.level / 10), 0));
      const loudest = bands.reduce((best, item) => (weighted(item) > weighted(best) ? item : best), bands[0]);
      return {
        primary: M('Weighted overall level', total, p.weighting === 'a' ? 'dB(A)' : p.weighting === 'c' ? 'dB(C)' : 'dB'),
        metrics: [M('Unweighted overall level', unweighted, 'dB'), M('Weighting penalty', unweighted - total, 'dB'), M('Dominant band', `${loudest.key} Hz`, ''), M('Loudness estimate', Math.pow(2, (total - 40) / 10), 'sones'), M('Level from a single band alone', Math.max(...bands.map((item) => weighted(item))), 'dB'), M('Bands within 10 dB of the total', bands.filter((item) => total - weighted(item) < 10).length, '')],
        status: `${loudest.key} Hz carries the most weighted energy.`,
      };
    },
    references: [
      { label: 'Four equal 60 dB bands sum to 66.02 dB', input: { level_500_hz: 60, level_1000_hz: 60, level_2000_hz: 60, level_4000_hz: 60, weighting: 'none' }, expected: 60 + 10 * Math.log10(4), tolerance: 1e-9 },
      { label: 'Four equal 70 dB bands sum to 76.02 dB', input: { level_500_hz: 70, level_1000_hz: 70, level_2000_hz: 70, level_4000_hz: 70, weighting: 'none' }, expected: 70 + 10 * Math.log10(4), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'underwater-sonar', title: 'Sonar Equation Solver', tone: 'cyan',
    desc: 'Transmission loss, signal excess and the detection range a sonar can expect.',
    fields: [F('source_level_db', 'Source level (dB)', 180, 100, 250), F('range_km', 'Range (km)', 10, 0.01, 800), F('absorption_db_km', 'Absorption (dB/km)', 0.05, 0, 5), F('target_strength_db', 'Target strength (dB)', 10, -40, 40), F('noise_level_db', 'Noise level (dB)', 60, 0, 130), F('directivity_index_db', 'Array directivity index (dB)', 20, 0, 40), F('detection_threshold_db', 'Detection threshold (dB)', 10, 0, 30)],
    sweep: 'range_km',
    scenarios: [{ label: 'Hull array, 10 km', input: { source_level_db: 180, range_km: 10, absorption_db_km: 0.05 } }, { label: 'Long range 50 km', input: { source_level_db: 180, range_km: 50, absorption_db_km: 0.05 } }, { label: 'Quiet target', input: { source_level_db: 180, range_km: 10, target_strength_db: -10 } }, { label: 'Rough weather', input: { source_level_db: 180, range_km: 10, noise_level_db: 80 } }],
    equation: 'TL = 20 log₁₀ r + αr   ·   SE = SL − 2TL + TS − (NL − DI) − DT',
    note: 'Spherical spreading with absorption. Sound-speed profiles, surface and bottom bounces and multipath make real detection ranges vary widely.',
    calculate: (p) => {
      const range = p.range_km * 1000;
      const spreading = 20 * Math.log10(range);
      const absorption = p.absorption_db_km * p.range_km;
      const loss = spreading + absorption;
      const excess = p.source_level_db - 2 * loss + p.target_strength_db - (p.noise_level_db - p.directivity_index_db) - p.detection_threshold_db;
      const figure = p.source_level_db + p.target_strength_db - (p.noise_level_db - p.directivity_index_db) - p.detection_threshold_db;
      const target = figure / 2;
      let detection = 0.1;
      for (let step = 0.1; step <= 800; step += 0.1) {
        const spread = 20 * Math.log10(step * 1000);
        if (spread + p.absorption_db_km * step > target) break;
        detection = step;
      }
      return {
        primary: M('Signal excess', excess, 'dB'),
        metrics: [M('One-way transmission loss', loss, 'dB'), M('Two-way loss', 2 * loss, 'dB'), M('Figure of merit', figure, 'dB'), M('Detection range estimate', detection, 'km'), M('Spreading loss', spreading, 'dB'), M('Absorption loss', absorption, 'dB'), M('Verdict', excess >= 0 ? 'Detectable' : 'Below the detection threshold')],
        status: excess >= 0 ? `Detectable with ${excess.toFixed(1)} dB of excess signal.` : `${Math.abs(excess).toFixed(1)} dB short of detection at this range.`,
      };
    },
    references: [
      { label: '1 km with no absorption: 60 dB spreading, 20 dB excess', input: { source_level_db: 180, range_km: 1, absorption_db_km: 0, target_strength_db: 10, noise_level_db: 60, directivity_index_db: 20, detection_threshold_db: 10 }, expected: 180 - 2 * 60 + 10 - (60 - 20) - 10, tolerance: 1e-9 },
      { label: '10 km with 0.05 dB/km absorption: 80.5 dB per leg', input: { source_level_db: 180, range_km: 10, absorption_db_km: 0.05, target_strength_db: 10, noise_level_db: 60, directivity_index_db: 20, detection_threshold_db: 10 }, expected: 180 - 2 * (20 * Math.log10(10000) + 0.05 * 10) + 10 - (60 - 20) - 10, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'loudspeaker-enclosure', title: 'Loudspeaker Enclosure Sizing', tone: 'amber',
    desc: 'Box volume, tuning and alignment class from a driver’s Thiele–Small parameters.',
    fields: [F('fs_hz', 'Resonant frequency f_s (Hz)', 40, 5, 500), F('qts', 'Total Q (Q_ts)', 0.4, 0.05, 2), F('vas_l', 'Equivalent volume V_as (litres)', 50, 0.5, 1000), F('xmax_mm', 'Cone excursion X_max (mm)', 5, 0.1, 50), F('cone_area_cm2', 'Cone area S_d (cm²)', 220, 1, 5000)],
    sweep: 'qts',
    scenarios: [{ label: 'Classic 40 Hz driver', input: { fs_hz: 40, qts: 0.4, vas_l: 50 } }, { label: 'Low-Q subwoofer', input: { fs_hz: 25, qts: 0.25, vas_l: 150 } }, { label: 'High-Q small driver', input: { fs_hz: 60, qts: 0.7, vas_l: 15 } }, { label: 'Studio monitor', input: { fs_hz: 45, qts: 0.35, vas_l: 30 } }],
    equation: 'V_b ≈ 15 V_as Q_ts^2.87   ·   f_b ≈ 0.42 f_s Q_ts^(−0.96)   ·   EBP = f_s/Q_ts',
    note: 'Small-signal closed-form alignment estimate. A real design needs the full transfer function, box losses and a check against X_max.',
    calculate: (p) => {
      const volume = 15 * p.vas_l * Math.pow(p.qts, 2.87);
      const tuned = 0.42 * p.fs_hz * Math.pow(p.qts, -0.96);
      const ebp = p.fs_hz / p.qts;
      const displacement = p.cone_area_cm2 * p.xmax_mm / 10;
      return {
        primary: M('Recommended box volume', volume, 'L'),
        metrics: [M('Box volume', volume / 28.3168, 'ft³'), M('Efficiency bandwidth product', ebp, ''), M('Suggested alignment', ebp >= 50 ? 'Vented enclosure' : ebp >= 40 ? 'Either — taste decides' : 'Sealed enclosure', ''), M('Box tuning frequency f_b', tuned, 'Hz'), M('Volume ratio V_as/V_b', p.vas_l / volume, ''), M('Peak displacement volume', displacement, 'cm³')],
        status: `EBP ${ebp.toFixed(0)} points towards a ${ebp >= 50 ? 'vented' : ebp >= 40 ? 'flexible' : 'sealed'} alignment.`,
      };
    },
    references: [
      { label: 'V_as 50 L, Q_ts 0.4 → 54.1 L box', input: { fs_hz: 40, qts: 0.4, vas_l: 50, xmax_mm: 5, cone_area_cm2: 220 }, expected: 15 * 50 * Math.pow(0.4, 2.87), tolerance: 1e-9 },
      { label: 'Doubling V_as doubles the box', input: { fs_hz: 40, qts: 0.4, vas_l: 100, xmax_mm: 5, cone_area_cm2: 220 }, expected: 15 * 100 * Math.pow(0.4, 2.87), tolerance: 1e-9 },
    ],
  }),
];

export default acousticsTools;