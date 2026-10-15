import { defineTool, numberField, choiceField, metric } from '@jarvis/components/toolkit/science50/model';

const D = defineTool, F = numberField, C = choiceField, M = metric;

const MATERIALS = {
  steel: { modulus: 200e9, poisson: 0.3, density: 7850, yield: 250, label: 'Steel' },
  aluminium: { modulus: 70e9, poisson: 0.33, density: 2700, yield: 240, label: 'Aluminium' },
  concrete: { modulus: 30e9, poisson: 0.2, density: 2400, yield: 30, label: 'Concrete' },
  glass: { modulus: 70e9, poisson: 0.22, density: 2500, yield: 60, label: 'Glass' },
};
const MATERIAL_CHOICES = [['steel', 'Steel (200 GPa, ν 0.30)'], ['aluminium', 'Aluminium (70 GPa, ν 0.33)'], ['concrete', 'Concrete (30 GPa, ν 0.20)'], ['glass', 'Glass (70 GPa, ν 0.22)']];

const TORSION_TABLE = [[1, 0.208, 0.1406], [1.2, 0.219, 0.166], [1.5, 0.231, 0.196], [2, 0.246, 0.229], [2.5, 0.258, 0.249], [3, 0.267, 0.263], [4, 0.282, 0.281], [6, 0.299, 0.299], [10, 0.312, 0.312], [50, 0.333, 0.333]];
const torsionCoefficients = (ratio) => {
  const table = TORSION_TABLE;
  if (ratio <= table[0][0]) return [table[0][1], table[0][2]];
  for (let index = 1; index < table.length; index += 1) {
    if (ratio <= table[index][0]) {
      const [r0, a0, b0] = table[index - 1], [r1, a1, b1] = table[index];
      const t = (ratio - r0) / (r1 - r0);
      return [a0 + t * (a1 - a0), b0 + t * (b1 - b0)];
    }
  }
  return [0.333, 0.333];
};

const CREEP_MATERIALS = {
  'steel-austenitic': { a: 51290, m: 6000, label: 'Austenitic steel' },
  'nickel-superalloy': { a: 56000, m: 7500, label: 'Nickel superalloy' },
  'silicon-nitride': { a: 62000, m: 9000, label: 'Silicon-nitride ceramic' },
};

export const structureTools = [
  D({
    id: 'beam-simply-supported', title: 'Simply Supported Beam', tone: 'cyan',
    desc: 'Deflection, bending moment, shear and bending stress for a uniformly loaded simply supported beam.',
    fields: [F('span_m', 'Span (m)', 6, 0.2, 60), F('load_kn_m', 'Uniform load (kN/m)', 10, 0.001, 1000), F('flexural_rigidity_knm2', 'Flexural rigidity EI (kN·m²)', 10000, 1, 1e9), F('section_modulus_cm3', 'Elastic section modulus (cm³)', 500, 1, 1e6)],
    sweep: 'load_kn_m',
    scenarios: [{ label: '10 kN/m over 6 m', input: { span_m: 6, load_kn_m: 10, flexural_rigidity_knm2: 10000 } }, { label: 'Long span 12 m', input: { span_m: 12, load_kn_m: 10, flexural_rigidity_knm2: 10000 } }, { label: 'Heavy load 40 kN/m', input: { span_m: 6, load_kn_m: 40, flexural_rigidity_knm2: 20000 } }, { label: 'Stiff section', input: { span_m: 6, load_kn_m: 10, flexural_rigidity_knm2: 60000 } }],
    equation: 'δ = 5wL⁴/(384EI)   ·   M = wL²/8   ·   V = wL/2   ·   σ = M/W',
    note: 'Linear elastic Euler–Bernoulli bending of a prismatic beam. Deflection limits (span/250 or span/360) are checked separately by the applicable code.',
    calculate: (p) => {
      const moment = (p.load_kn_m * p.span_m ** 2) / 8;
      const shear = (p.load_kn_m * p.span_m) / 2;
      const deflection = (5 * p.load_kn_m * p.span_m ** 4) / (384 * p.flexural_rigidity_knm2);
      const stress = (moment * 1000) / (p.section_modulus_cm3 / 1e6) / 1e6;
      const ratio = (p.span_m * 1000) / (deflection * 1000);
      return {
        primary: M('Maximum deflection', deflection * 1000, 'mm'),
        metrics: [M('Maximum bending moment', moment, 'kN·m'), M('End reaction', shear, 'kN'), M('Maximum bending stress', stress, 'MPa'), M('Span/deflection ratio', ratio, ''), M('Deflection limit check (span/250)', ratio >= 250 ? 'Within span/250' : 'Exceeds span/250'), M('Load total', p.load_kn_m * p.span_m, 'kN')],
        status: ratio >= 250 ? `Deflection is span/${ratio.toFixed(0)} — within a typical limit.` : `Deflection is span/${ratio.toFixed(0)} — a tighter section is needed.`,
      };
    },
    references: [
      { label: '10 kN/m on a 6 m span with EI 10 000 kN·m² → 16.875 mm', input: { span_m: 6, load_kn_m: 10, flexural_rigidity_knm2: 10000, section_modulus_cm3: 500 }, expected: (5 * 10 * 6 ** 4 / (384 * 10000)) * 1000, tolerance: 1e-12 },
      { label: 'Deflection grows with the fourth power of span: 12 m → 270 mm', input: { span_m: 12, load_kn_m: 10, flexural_rigidity_knm2: 10000, section_modulus_cm3: 500 }, expected: (5 * 10 * 12 ** 4 / (384 * 10000)) * 1000, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'cantilever-tip-load', title: 'Cantilever with Tip Load', tone: 'violet',
    desc: 'Tip deflection, root moment, bending stress and the vibration frequency a cantilever can expect.',
    fields: [F('span_m', 'Cantilever length (m)', 2, 0.1, 30), F('tip_load_kn', 'Tip load (kN)', 5, 0.001, 500), F('flexural_rigidity_knm2', 'Flexural rigidity EI (kN·m²)', 2000, 1, 1e9), F('section_modulus_cm3', 'Elastic section modulus (cm³)', 200, 1, 1e6), F('mass_per_length_kg_m', 'Mass per length (kg/m)', 20, 0.01, 5000)],
    sweep: 'tip_load_kn',
    scenarios: [{ label: '5 kN on a 2 m bracket', input: { span_m: 2, tip_load_kn: 5, flexural_rigidity_knm2: 2000 } }, { label: 'Doubled load', input: { span_m: 2, tip_load_kn: 10, flexural_rigidity_knm2: 2000 } }, { label: 'Long cantilever', input: { span_m: 4, tip_load_kn: 5, flexural_rigidity_knm2: 2000 } }, { label: 'Stiff bracket', input: { span_m: 2, tip_load_kn: 5, flexural_rigidity_knm2: 10000 } }],
    equation: 'δ = PL³/(3EI)   ·   M_root = PL   ·   θ = PL²/(2EI)   ·   f₁ ≈ (1.875²/2π)√(EI/(mL⁴))',
    note: 'Small-deflection linear elasticity. The tip load’s own weight, second-order effects and connection flexibility are not included.',
    calculate: (p) => {
      const deflection = (p.tip_load_kn * p.span_m ** 3) / (3 * p.flexural_rigidity_knm2);
      const moment = p.tip_load_kn * p.span_m;
      const slope = (p.tip_load_kn * p.span_m ** 2) / (2 * p.flexural_rigidity_knm2);
      const stress = (moment * 1000) / (p.section_modulus_cm3 / 1e6) / 1e6;
      const stiffness = p.flexural_rigidity_knm2 * 1000;
      const frequency = (1.8751 ** 2 / (2 * Math.PI)) * Math.sqrt(stiffness / (p.mass_per_length_kg_m * p.span_m ** 4));
      return {
        primary: M('Tip deflection', deflection * 1000, 'mm'),
        metrics: [M('Root bending moment', moment, 'kN·m'), M('Maximum bending stress', stress, 'MPa'), M('Tip rotation', slope, 'rad'), M('First natural frequency', frequency, 'Hz'), M('Tip stiffness', p.tip_load_kn / (deflection * 1000), 'kN/mm'), M('Deflection / length', (deflection / p.span_m) * 100, '%')],
        status: deflection / p.span_m <= 0.02 ? 'Tip movement is modest relative to the length.' : 'Large tip movement — check second-order effects and serviceability.',
      };
    },
    references: [
      { label: '5 kN on a 2 m cantilever with EI 2000 kN·m² → 6.667 mm', input: { span_m: 2, tip_load_kn: 5, flexural_rigidity_knm2: 2000, section_modulus_cm3: 200, mass_per_length_kg_m: 20 }, expected: (5 * 2 ** 3 / (3 * 2000)) * 1000, tolerance: 1e-12 },
      { label: 'Doubling the load doubles the deflection → 13.33 mm', input: { span_m: 2, tip_load_kn: 10, flexural_rigidity_knm2: 2000, section_modulus_cm3: 200, mass_per_length_kg_m: 20 }, expected: (5 * 2 ** 3 / (3 * 2000)) * 1000 * 2, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'circular-plate-bending', title: 'Circular Plate Under Pressure', tone: 'emerald',
    desc: 'Centre deflection and edge stress of a flat circular plate carrying uniform pressure.',
    fields: [F('radius_m', 'Plate radius (m)', 1, 0.05, 20), F('pressure_kpa', 'Uniform pressure (kPa)', 10, 0.001, 5000), F('thickness_mm', 'Plate thickness (mm)', 10, 0.5, 300), C('material', 'Material', 'steel', MATERIAL_CHOICES), C('edge', 'Edge support', 'clamped', [['clamped', 'Clamped edge'], ['simply-supported', 'Simply supported']])],
    sweep: 'thickness_mm',
    scenarios: [{ label: 'Clamped steel 10 mm', input: { radius_m: 1, pressure_kpa: 10, thickness_mm: 10, material: 'steel', edge: 'clamped' } }, { label: 'Simply supported', input: { radius_m: 1, pressure_kpa: 10, thickness_mm: 10, material: 'steel', edge: 'simply-supported' } }, { label: 'Thick plate 25 mm', input: { radius_m: 1, pressure_kpa: 10, thickness_mm: 25, material: 'steel', edge: 'clamped' } }, { label: 'Glass window', input: { radius_m: 0.6, pressure_kpa: 2, thickness_mm: 12, material: 'glass', edge: 'simply-supported' } }],
    equation: 'D = Et³/(12(1−ν²))   ·   clamped: w = pa⁴/(64D), σ = 3pa²/(4t²)   ·   simply supported: w = (5+ν)pa⁴/(64D(1+ν)), σ = 3(3+ν)pa²/(8t²)',
    note: 'Thin-plate (Kirchhoff) theory, small deflections, uniform pressure. Large-deflection membrane action and edge details need a plate finite-element model.',
    calculate: (p) => {
      const material = MATERIALS[p.material];
      const radius = p.radius_m, pressure = p.pressure_kpa * 1000, thickness = p.thickness_mm / 1000;
      const rigidity = (material.modulus * thickness ** 3) / (12 * (1 - material.poisson ** 2));
      const clamped = p.edge === 'clamped';
      const deflection = clamped ? (pressure * radius ** 4) / (64 * rigidity) : ((5 + material.poisson) * pressure * radius ** 4) / (64 * rigidity * (1 + material.poisson));
      const stress = clamped ? (3 * pressure * radius ** 2) / (4 * thickness ** 2) : (3 * (3 + material.poisson) * pressure * radius ** 2) / (8 * thickness ** 2);
      const mass = Math.PI * radius ** 2 * thickness * material.density;
      const frequency = (10.21 / (2 * Math.PI * radius ** 2)) * Math.sqrt(rigidity / (material.density * thickness));
      return {
        primary: M('Centre deflection', deflection * 1000, 'mm'),
        metrics: [M('Maximum bending stress', stress / 1e6, 'MPa'), M('Flexural rigidity D', rigidity, 'N·m'), M('Stress against yield', (stress / 1e6 / material.yield) * 100, '%'), M('Plate mass', mass, 'kg'), M('First mode estimate', frequency, 'Hz'), M('Deflection / thickness', deflection / thickness, '')],
        status: stress / 1e6 < material.yield ? `Peak stress is ${((stress / 1e6 / material.yield) * 100).toFixed(0)} % of yield.` : 'Peak stress exceeds the yield strength.',
      };
    },
    references: [
      { label: 'Clamped 1 m steel plate, 10 mm thick, 10 kPa → 8.53 mm', input: { radius_m: 1, pressure_kpa: 10, thickness_mm: 10, material: 'steel', edge: 'clamped' }, expected: (10000 * 1 ** 4) / (64 * ((200e9 * 0.01 ** 3) / (12 * (1 - 0.3 ** 2)))) * 1000, tolerance: 1e-9 },
      { label: 'Simply supported the same plate deflects about twice as far', input: { radius_m: 1, pressure_kpa: 10, thickness_mm: 10, material: 'steel', edge: 'simply-supported' }, expected: ((5 + 0.3) * 10000 * 1 ** 4) / (64 * ((200e9 * 0.01 ** 3) / (12 * (1 - 0.3 ** 2))) * (1 + 0.3)) * 1000, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'torsion-noncircular', title: 'Torsion of a Rectangular Shaft', tone: 'amber',
    desc: 'Peak shear stress and twist angle of a solid rectangular shaft, with the standard section coefficients.',
    fields: [F('torque_nm', 'Torque (N·m)', 500, 0.1, 1e6), F('width_mm', 'Width (mm)', 40, 1, 500), F('height_mm', 'Height (mm)', 60, 1, 500), F('length_m', 'Shaft length (m)', 1, 0.01, 20), C('material', 'Material', 'steel', [['steel', 'Steel (G 79.3 GPa)'], ['aluminium', 'Aluminium (G 26 GPa)'], ['brass', 'Brass (G 39 GPa)']])],
    sweep: 'torque_nm',
    scenarios: [{ label: '40 × 60 mm shaft', input: { torque_nm: 500, width_mm: 40, height_mm: 60 } }, { label: 'Square 40 mm', input: { torque_nm: 500, width_mm: 40, height_mm: 40 } }, { label: 'Flat strip', input: { torque_nm: 500, width_mm: 20, height_mm: 120 } }, { label: 'Heavy torque', input: { torque_nm: 2000, width_mm: 60, height_mm: 90 } }],
    equation: 'τ_max = T/(α b t²)   ·   θ = TL/(β b t³ G)   ·   t = shorter side, b = longer side',
    note: 'Roark’s tabulated torsion coefficients interpolated across the side ratio. Stress concentrations at keyways and fillets are separate.',
    calculate: (p) => {
      const shearModulus = { steel: 79.3e9, aluminium: 26e9, brass: 39e9 }[p.material];
      const t = Math.min(p.width_mm, p.height_mm) / 1000;
      const b = Math.max(p.width_mm, p.height_mm) / 1000;
      const [alpha, beta] = torsionCoefficients(b / t);
      const stress = p.torque_nm / (alpha * b * t * t);
      const twist = (p.torque_nm * p.length_m) / (beta * b * t ** 3 * shearModulus);
      const stiffness = p.torque_nm / twist;
      return {
        primary: M('Peak shear stress', stress / 1e6, 'MPa'),
        metrics: [M('Angle of twist', twist * (180 / Math.PI), '°'), M('Torsional stiffness', stiffness, 'N·m/rad'), M('Side ratio b/t', b / t, ''), M('Section coefficients α / β', `${alpha.toFixed(3)} / ${beta.toFixed(3)}`, ''), M('Equivalent circular diameter', 2 * Math.cbrt(stiffness * p.length_m / (shearModulus * Math.PI) * 2) * 1000, 'mm'), M('Stress utilisation vs 100 MPa', (stress / 1e6 / 100) * 100, '%')],
        status: `Twist of ${(twist * 180 / Math.PI).toFixed(3)}° over ${p.length_m} m.`,
      };
    },
    references: [
      { label: 'A 40 mm square shaft with α = 0.208 → 37.6 MPa at 500 N·m', input: { torque_nm: 500, width_mm: 40, height_mm: 40, material: 'steel', length_m: 1 }, expected: 500 / (0.208 * 0.04 * 0.04 ** 2) / 1e6, tolerance: 1e-9 },
      { label: 'A 40 × 120 strip uses α = 0.267 → 9.75 MPa', input: { torque_nm: 500, width_mm: 40, height_mm: 120, material: 'steel', length_m: 1 }, expected: 500 / (0.267 * 0.12 * 0.04 ** 2) / 1e6, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'stress-concentration', title: 'Notch Stress Concentration', tone: 'rose',
    desc: 'Elastic Kt, Neuber notch sensitivity, Kf and the fatigue strength left at a notch.',
    fields: [C('geometry', 'Notch geometry', 'elliptical-hole', [['elliptical-hole', 'Elliptical hole (a/b)'], ['finite-width-hole', 'Circular hole in a finite plate (d/W)'], ['u-groove', 'U-groove (depth/radius)']]), F('nominal_stress_mpa', 'Nominal stress (MPa)', 100, 0.01, 5000), F('ratio', 'Geometry ratio', 2, 0.005, 50), F('notch_radius_mm', 'Notch radius (mm)', 1, 0.001, 200), F('neuber_constant_mm', 'Neuber constant √a (mm)', 0.5, 0.005, 20), F('endurance_limit_mpa', 'Unnotched endurance limit (MPa)', 250, 1, 5000)],
    sweep: 'ratio',
    scenarios: [{ label: 'Elliptical a/b = 2', input: { geometry: 'elliptical-hole', ratio: 2, nominal_stress_mpa: 100 } }, { label: 'Sharp elliptical a/b = 5', input: { geometry: 'elliptical-hole', ratio: 5, nominal_stress_mpa: 100 } }, { label: 'Circular hole', input: { geometry: 'elliptical-hole', ratio: 1, nominal_stress_mpa: 100 } }, { label: 'U-groove depth/radius 3', input: { geometry: 'u-groove', ratio: 3, nominal_stress_mpa: 100 } }, { label: 'Hole in a 200 mm plate', input: { geometry: 'finite-width-hole', ratio: 0.2, nominal_stress_mpa: 100 } }],
    equation: 'elliptical: K_t = 1 + 2a/b   ·   finite width: K_t = 3 − 3.14(d/W) + 3.667(d/W)² − 1.527(d/W)³   ·   U-groove: K_t = 1 + 2√(depth/r)   ·   q = 1/(1 + √a/r)',
    note: 'Elastic stress concentration for the stated idealised shapes, with a Neuber notch-sensitivity correction. Notch-root plasticity and residual stress are not modelled.',
    validate: (p) => (p.geometry === 'finite-width-hole' && p.ratio > 0.5 ? 'The finite-width hole approximation needs d/W below 0.5.' : null),
    calculate: (p) => {
      const ratio = p.ratio;
      const kt = p.geometry === 'elliptical-hole'
        ? 1 + 2 * ratio
        : p.geometry === 'u-groove'
          ? 1 + 2 * Math.sqrt(ratio)
          : 3 - 3.14 * ratio + 3.667 * ratio ** 2 - 1.527 * ratio ** 3;
      const sensitivity = 1 / (1 + p.neuber_constant_mm / p.notch_radius_mm);
      const kf = 1 + sensitivity * (kt - 1);
      const peak = p.nominal_stress_mpa * kt;
      const fatigue = p.endurance_limit_mpa / kf;
      return {
        primary: M('Peak elastic stress', peak, 'MPa'),
        metrics: [M('Elastic K_t', kt, ''), M('Neuber notch sensitivity q', sensitivity, ''), M('Fatigue K_f', kf, ''), M('Fatigue strength at the notch', fatigue, 'MPa'), M('Fatigue strength reduction', (1 - 1 / kf) * 100, '%'), M('Stress on nominal', (kt - 1) * 100, '%')],
        status: `Notch multiplies the nominal stress by ${kt.toFixed(2)}.`,
      };
    },
    references: [
      { label: 'An elliptical hole with a/b = 2 gives K_t = 5', input: { geometry: 'elliptical-hole', ratio: 2, nominal_stress_mpa: 100 }, expected: 100 * (1 + 2 * 2), tolerance: 1e-12 },
      { label: 'A circular hole gives K_t = 3', input: { geometry: 'elliptical-hole', ratio: 1, nominal_stress_mpa: 100 }, expected: 100 * (1 + 2 * 1), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'thermal-stress', title: 'Restrained Thermal Stress', tone: 'amber',
    desc: 'The stress a restrained member builds up when it cannot expand, and the force it pushes with.',
    fields: [C('material', 'Material', 'steel', [['steel', 'Steel (E 200 GPa, α 12 µε/K)'], ['stainless', 'Stainless (193 GPa, 17 µε/K)'], ['aluminium', 'Aluminium (70 GPa, 23 µε/K)'], ['concrete', 'Concrete (30 GPa, 10 µε/K)']]), F('temperature_change_c', 'Temperature change (K)', 50, -200, 600), C('restraint', 'Restraint', 'uniaxial', [['uniaxial', 'Restrained along one axis'], ['biaxial', 'Restrained in two axes']]), F('length_mm', 'Member length (mm)', 2000, 10, 100000), F('area_mm2', 'Cross-section area (mm²)', 1000, 0.01, 1e7)],
    sweep: 'temperature_change_c',
    scenarios: [{ label: 'Steel +50 K, axial', input: { material: 'steel', temperature_change_c: 50, restraint: 'uniaxial' } }, { label: 'Steel +50 K, biaxial', input: { material: 'steel', temperature_change_c: 50, restraint: 'biaxial' } }, { label: 'Aluminium +40 K', input: { material: 'aluminium', temperature_change_c: 40, restraint: 'uniaxial' } }, { label: 'Stainless +120 K', input: { material: 'stainless', temperature_change_c: 120, restraint: 'uniaxial' } }, { label: 'Cooling −60 K', input: { material: 'steel', temperature_change_c: -60, restraint: 'uniaxial' } }],
    equation: 'σ = E α ΔT   (biaxial: σ = E α ΔT/(1 − ν))   ·   ΔL_free = L α ΔT   ·   F = σ A',
    note: 'Linear elastic, uniform temperature change, no buckling and no creep. Long slender members in compression also need a stability check.',
    calculate: (p) => {
      const table = { steel: [200e9, 12e-6, 0.3, 250], stainless: [193e9, 17e-6, 0.29, 210], aluminium: [70e9, 23e-6, 0.33, 240], concrete: [30e9, 10e-6, 0.2, 30] }[p.material];
      const [modulus, expansion, poisson, yieldStrength] = table;
      const stress = p.restraint === 'biaxial'
        ? (modulus * expansion * p.temperature_change_c) / (1 - poisson)
        : modulus * expansion * p.temperature_change_c;
      const force = (stress * p.area_mm2) / 1e6 / 1000;
      const free = p.length_mm * expansion * p.temperature_change_c;
      return {
        primary: M('Thermal stress', stress / 1e6, 'MPa'),
        metrics: [M('Free expansion', free, 'mm'), M('Restraining force', Math.abs(force), 'kN'), M('Thermal strain', expansion * p.temperature_change_c * 1e6, 'µε'), M('Stress on yield', (Math.abs(stress / 1e6) / yieldStrength) * 100, '%'), M('Plasticity check', Math.abs(stress / 1e6) > yieldStrength ? 'Yields — stress is capped by yield' : 'Remains elastic'), M('Uniaxial stress', (modulus * expansion * p.temperature_change_c) / 1e6, 'MPa')],
        status: Math.abs(stress / 1e6) > yieldStrength ? 'The member would yield: the real stress stops at the yield strength.' : 'The member stays elastic.',
        warning: Math.abs(stress / 1e6) > yieldStrength ? 'Above yield the elastic formula overestimates stress; plasticity or buckling takes over.' : '',
      };
    },
    references: [
      { label: 'Steel restrained axially through +50 K develops 120 MPa', input: { material: 'steel', temperature_change_c: 50, restraint: 'uniaxial' }, expected: (200e9 * 12e-6 * 50) / 1e6, tolerance: 1e-9 },
      { label: 'Two-axis restraint divides by (1 − ν) instead → 171 MPa', input: { material: 'steel', temperature_change_c: 50, restraint: 'biaxial' }, expected: (200e9 * 12e-6 * 50) / (1 - 0.3) / 1e6, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'creep-larson-miller', title: 'Creep Rupture Life (Larson–Miller)', tone: 'rose',
    desc: 'Rupture life at temperature and stress, and the stress or temperature that gives a 100 000 hour life.',
    fields: [C('material', 'Material class', 'steel-austenitic', [['steel-austenitic', 'Austenitic steel (A 51 290, m 6000)'], ['nickel-superalloy', 'Nickel superalloy (A 56 000, m 7500)'], ['silicon-nitride', 'Silicon nitride (A 62 000, m 9000)']]), F('temperature_c', 'Temperature (°C)', 600, 20, 2000), F('stress_mpa', 'Stress (MPa)', 100, 1, 2000), F('lm_constant', 'Larson–Miller constant C', 20, 8, 50), F('design_life_h', 'Design life (h)', 100000, 1, 1e7)],
    sweep: 'stress_mpa',
    scenarios: [{ label: '600 °C, 100 MPa', input: { temperature_c: 600, stress_mpa: 100, material: 'steel-austenitic' } }, { label: '650 °C, 100 MPa', input: { temperature_c: 650, stress_mpa: 100, material: 'steel-austenitic' } }, { label: '600 °C, 150 MPa', input: { temperature_c: 600, stress_mpa: 150, material: 'steel-austenitic' } }, { label: 'Superalloy at 750 °C', input: { temperature_c: 750, stress_mpa: 120, material: 'nickel-superalloy' } }],
    equation: 'P = T_R(C + log₁₀ t_r),  T_R = 1.8(T + 273.15)   ·   P = A − m log₁₀ σ   ·   t_r = 10^(P/T_R − C)',
    note: 'Larson–Miller time–temperature parameter with indicative constants for each material class. Real design must use measured rupture data for the actual heat and environment.',
    calculate: (p) => {
      const material = CREEP_MATERIALS[p.material];
      const rankine = 1.8 * (p.temperature_c + 273.15);
      const parameter = material.a - material.m * Math.log10(p.stress_mpa);
      const exponent = parameter / rankine - p.lm_constant;
      if (exponent > 12) return { error: 'Rupture life is beyond the model’s useful range at this stress — increase the stress or temperature.' };
      const life = Math.pow(10, exponent);
      const stressForLife = Math.pow(10, (material.a - rankine * (p.lm_constant + Math.log10(p.design_life_h))) / material.m);
      const temperatureForLife = (parameter / (p.lm_constant + Math.log10(p.design_life_h))) / 1.8 - 273.15;
      return {
        primary: M('Rupture life', life, 'h'),
        metrics: [M('Larson–Miller parameter', parameter, ''), M('Life in years', life / 8760, 'years'), M('Life utilisation', (p.design_life_h / life) * 100, '%'), M('Stress for a 100 000 h life', stressForLife, 'MPa'), M('Temperature for a 100 000 h life', temperatureForLife, '°C'), M('Rankine temperature', rankine, '°R')],
        status: life >= p.design_life_h ? 'Meets the design life.' : 'Falls short of the design life — reduce stress or temperature.',
      };
    },
    references: [
      { label: 'Austenitic steel at 600 °C and 100 MPa gives 100 000 h', input: { material: 'steel-austenitic', temperature_c: 600, stress_mpa: 100, lm_constant: 20, design_life_h: 100000 }, expected: Math.pow(10, (51290 - 6000 * Math.log10(100)) / (1.8 * (600 + 273.15)) - 20), tolerance: 1e-9 },
      { label: 'Nickel superalloy at 700 °C and 100 MPa', input: { material: 'nickel-superalloy', temperature_c: 700, stress_mpa: 100, lm_constant: 20, design_life_h: 100000 }, expected: Math.pow(10, (56000 - 7500 * Math.log10(100)) / (1.8 * (700 + 273.15)) - 20), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'paris-crack-growth', title: 'Fatigue Crack Growth (Paris)', tone: 'cyan',
    desc: 'Cycles to grow a crack from an initial size to a limit, and the growth rate at any crack length.',
    fields: [F('stress_range_mpa', 'Stress range Δσ (MPa)', 100, 1, 2000), F('c_constant', 'Paris constant C', 1e-11, 1e-17, 1e-4), F('m_exponent', 'Paris exponent m', 3, 2, 6), F('initial_crack_mm', 'Initial crack (mm)', 5, 0.01, 500), F('final_crack_mm', 'Final crack (mm)', 20, 0.02, 1000), F('geometry_factor', 'Geometry factor F', 1, 0.1, 3)],
    sweep: 'stress_range_mpa',
    scenarios: [{ label: 'Baseline 100 MPa', input: { stress_range_mpa: 100, c_constant: 1e-11, m_exponent: 3 } }, { label: 'Higher stress 150 MPa', input: { stress_range_mpa: 150, c_constant: 1e-11, m_exponent: 3 } }, { label: 'Longer initial flaw', input: { stress_range_mpa: 100, c_constant: 1e-11, m_exponent: 3, initial_crack_mm: 10 } }, { label: 'Steeper exponent m = 4', input: { stress_range_mpa: 100, c_constant: 1e-11, m_exponent: 4 } }],
    equation: 'da/dN = C(ΔK)^m   ·   ΔK = F Δσ √(πa)   ·   N = ∫ da/(C ΔK^m)',
    note: 'Paris-regime integration between two crack sizes, with constant amplitude loading. Threshold and final-fracture regions are outside this law.',
    validate: (p) => (p.final_crack_mm <= p.initial_crack_mm ? 'The final crack must be larger than the initial crack.' : null),
    calculate: (p) => {
      const a0 = p.initial_crack_mm / 1000, af = p.final_crack_mm / 1000;
      const growth = (a) => p.c_constant * Math.pow(p.geometry_factor * p.stress_range_mpa * Math.sqrt(Math.PI * a), p.m_exponent);
      const integrand = (a) => 1 / growth(a);
      const panels = 2000;
      const h = (af - a0) / panels;
      let sum = 0;
      for (let index = 0; index <= panels; index += 1) {
        const a = a0 + index * h;
        sum += (index === 0 || index === panels ? 1 : index % 2 ? 4 : 2) * integrand(a);
      }
      const cycles = (sum * h) / 3;
      const deltaK = (a) => p.geometry_factor * p.stress_range_mpa * Math.sqrt(Math.PI * a);
      const half = integrand
        ? (() => {
            const mid = (a0 + af) / 2;
            const hh = (mid - a0) / 500;
            let s = 0;
            for (let index = 0; index <= 500; index += 1) {
              const a = a0 + index * hh;
              s += (index === 0 || index === 500 ? 1 : index % 2 ? 4 : 2) * integrand(a);
            }
            return (s * hh) / 3;
          })()
        : 0;
      return {
        primary: M('Cycles to reach the limit', cycles, 'cycles'),
        metrics: [M('ΔK at the initial crack', deltaK(a0), 'MPa√m'), M('ΔK at the limit', deltaK(af), 'MPa√m'), M('Growth rate at the initial crack', growth(a0) * 1e9, 'nm/cycle'), M('Growth rate at the limit', growth(af) * 1e9, 'nm/cycle'), M('Life in the first half of the growth', (half / cycles) * 100, '%'), M('Blocks of 1000 cycles', cycles / 1000, 'blocks')],
        status: `${(cycles / 1000).toFixed(0)} thousand cycles from ${p.initial_crack_mm} mm to ${p.final_crack_mm} mm.`,
      };
    },
    curve: (p) => {
      const x = [];
      const y = [];
      for (let index = 0; index <= 120; index += 1) {
        const a = 0.2 + (index / 120) * (p.final_crack_mm * 1.2 - 0.2);
        x.push(a);
        y.push(p.c_constant * Math.pow(p.geometry_factor * p.stress_range_mpa * Math.sqrt(Math.PI * (a / 1000)), p.m_exponent) * 1e9);
      }
      return { x, y, xLabel: 'Crack length (mm)', yLabel: 'Growth rate (nm/cycle)', unit: 'nm/cycle' };
    },
    references: [
      { label: 'Crack of 1 → 4 mm at 100 MPa, C 1e−11, m 3 → 568 000 cycles', input: { stress_range_mpa: 100, c_constant: 1e-11, m_exponent: 3, initial_crack_mm: 1, final_crack_mm: 4, geometry_factor: 1 }, expected: (0.004 ** -0.5 - 0.001 ** -0.5) / (1e-11 * (100 * Math.sqrt(Math.PI)) ** 3 * (1 - 3 / 2)), tolerance: 1e-6 },
      { label: 'Growing on to 9 mm takes about twice as long', input: { stress_range_mpa: 100, c_constant: 1e-11, m_exponent: 3, initial_crack_mm: 1, final_crack_mm: 9, geometry_factor: 1 }, expected: (0.009 ** -0.5 - 0.001 ** -0.5) / (1e-11 * (100 * Math.sqrt(Math.PI)) ** 3 * (1 - 3 / 2)), tolerance: 1e-6 },
    ],
  }),
  D({
    id: 'composite-laminate', title: 'Composite Laminate Properties', tone: 'emerald',
    desc: 'Longitudinal and transverse stiffness, density, specific stiffness and the load the fibres carry.',
    fields: [F('fiber_volume_fraction', 'Fibre volume fraction V_f', 0.6, 0, 0.95), F('fiber_modulus_gpa', 'Fibre modulus (GPa)', 230, 1, 1000), F('matrix_modulus_gpa', 'Matrix modulus (GPa)', 3.5, 0.001, 100), F('fiber_density_g_cm3', 'Fibre density (g/cm³)', 1.8, 0.5, 25), F('matrix_density_g_cm3', 'Matrix density (g/cm³)', 1.2, 0.5, 25)],
    sweep: 'fiber_volume_fraction',
    scenarios: [{ label: 'Carbon/epoxy 60 %', input: { fiber_volume_fraction: 0.6, fiber_modulus_gpa: 230, matrix_modulus_gpa: 3.5, fiber_density_g_cm3: 1.8, matrix_density_g_cm3: 1.2 } }, { label: 'Glass/polyester 50 %', input: { fiber_volume_fraction: 0.5, fiber_modulus_gpa: 73, matrix_modulus_gpa: 3.2, fiber_density_g_cm3: 2.55, matrix_density_g_cm3: 1.2 } }, { label: 'High fibre content 70 %', input: { fiber_volume_fraction: 0.7, fiber_modulus_gpa: 230, matrix_modulus_gpa: 3.5, fiber_density_g_cm3: 1.8, matrix_density_g_cm3: 1.2 } }, { label: 'Aramid 60 %', input: { fiber_volume_fraction: 0.6, fiber_modulus_gpa: 130, matrix_modulus_gpa: 3.5, fiber_density_g_cm3: 1.44, matrix_density_g_cm3: 1.2 } }],
    equation: 'E₁ = V_f E_f + V_m E_m   ·   E₂ = 1/(V_f/E_f + V_m/E_m)   ·   ρ = V_f ρ_f + V_m ρ_m',
    note: 'Rule-of-mixtures unidirectional ply. Ply stacking, transverse cracking and interlaminar shear need classical laminate theory.',
    calculate: (p) => {
      const vf = p.fiber_volume_fraction, vm = 1 - vf;
      const longitudinal = vf * p.fiber_modulus_gpa + vm * p.matrix_modulus_gpa;
      const transverse = 1 / (vf / p.fiber_modulus_gpa + vm / p.matrix_modulus_gpa);
      const density = vf * p.fiber_density_g_cm3 + vm * p.matrix_density_g_cm3;
      const massSaving = (1 - (density / p.matrix_density_g_cm3) * (p.matrix_modulus_gpa / longitudinal)) * 100;
      return {
        primary: M('Longitudinal modulus E₁', longitudinal, 'GPa'),
        metrics: [M('Transverse modulus E₂', transverse, 'GPa'), M('Density', density, 'g/cm³'), M('Specific stiffness', longitudinal / density, 'MN·m/kg'), M('Fibre load share at equal strain', ((vf * p.fiber_modulus_gpa) / longitudinal) * 100, '%'), M('Anisotropy E₁/E₂', longitudinal / transverse, ''), M('Mass saving at equal stiffness', massSaving, '%')],
        status: `${(longitudinal / p.matrix_modulus_gpa).toFixed(0)}× stiffer along the fibres than the matrix alone.`,
      };
    },
    references: [
      { label: '60 % carbon fibre in epoxy → 139.4 GPa', input: { fiber_volume_fraction: 0.6, fiber_modulus_gpa: 230, matrix_modulus_gpa: 3.5 }, expected: 0.6 * 230 + 0.4 * 3.5, tolerance: 1e-12 },
      { label: '50 % fibre → 116.75 GPa', input: { fiber_volume_fraction: 0.5, fiber_modulus_gpa: 230, matrix_modulus_gpa: 3.5 }, expected: 0.5 * 230 + 0.5 * 3.5, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'bolt-group-eccentric', title: 'Eccentric Bolt Group (Elastic Method)', tone: 'violet',
    desc: 'Direct and torsional shear in a circular bolt group under an offset load, and the worst-loaded bolt.',
    fields: [F('load_kn', 'Applied load (kN)', 50, 0.05, 10000), F('eccentricity_mm', 'Eccentricity (mm)', 300, 0, 5000), F('bolt_count', 'Bolts in the group', 6, 2, 36, 1), F('group_radius_mm', 'Bolt circle radius (mm)', 150, 10, 3000), F('bolt_capacity_kn', 'Shear capacity per bolt (kN)', 30, 0.1, 2000)],
    sweep: 'eccentricity_mm',
    scenarios: [{ label: '50 kN, 300 mm offset', input: { load_kn: 50, eccentricity_mm: 300, bolt_count: 6, group_radius_mm: 150 } }, { label: 'Centric load', input: { load_kn: 50, eccentricity_mm: 0, bolt_count: 6, group_radius_mm: 150 } }, { label: 'Eight bolts', input: { load_kn: 50, eccentricity_mm: 300, bolt_count: 8, group_radius_mm: 150 } }, { label: 'Wider group', input: { load_kn: 50, eccentricity_mm: 300, bolt_count: 6, group_radius_mm: 250 } }, { label: 'Heavy load 150 kN', input: { load_kn: 150, eccentricity_mm: 400, bolt_count: 8, group_radius_mm: 200 } }],
    equation: 'V_direct = P/n   ·   V_torsion = P·e/(n·R)   ·   R_max = √(V_direct² + V_torsion²)',
    note: 'Elastic vector method for a circular pattern, where every bolt sits at the same radius from the group centre. Rectangular groups need Σr² and the instantaneous centre method for a plastic check.',
    calculate: (p) => {
      const radius = p.group_radius_mm / 1000;
      const direct = p.load_kn / p.bolt_count;
      const torsion = (p.load_kn * (p.eccentricity_mm / 1000)) / (p.bolt_count * radius);
      const worst = Math.hypot(direct, torsion);
      return {
        primary: M('Worst bolt shear', worst, 'kN'),
        metrics: [M('Direct shear per bolt', direct, 'kN'), M('Torsional shear per bolt', torsion, 'kN'), M('Applied moment', p.load_kn * (p.eccentricity_mm / 1000), 'kN·m'), M('Resultant angle to the load', Math.atan2(torsion, direct) * (180 / Math.PI), '°'), M('Bolt utilisation', (worst / p.bolt_capacity_kn) * 100, '%'), M('Governing action', torsion > direct ? 'Torsion governs' : 'Direct shear governs')],
        status: worst <= p.bolt_capacity_kn ? `Worst bolt at ${(worst / p.bolt_capacity_kn * 100).toFixed(0)} % of capacity.` : 'The worst bolt exceeds its shear capacity — add bolts or increase the radius.',
      };
    },
    references: [
      { label: '50 kN, 300 mm offset, 6 bolts at 150 mm → 18.63 kN', input: { load_kn: 50, eccentricity_mm: 300, bolt_count: 6, group_radius_mm: 150, bolt_capacity_kn: 30 }, expected: Math.hypot(50 / 6, (50 * 0.3) / (6 * 0.15)), tolerance: 1e-12 },
      { label: 'Eight bolts instead of six reduce the worst bolt to 16.24 kN', input: { load_kn: 50, eccentricity_mm: 300, bolt_count: 8, group_radius_mm: 150, bolt_capacity_kn: 30 }, expected: Math.hypot(50 / 8, (50 * 0.3) / (8 * 0.15)), tolerance: 1e-12 },
    ],
  }),
];

export default structureTools;