import { defineTool, numberField, choiceField, metric, samples } from '@jarvis/components/toolkit/science50/model';

const D = defineTool, F = numberField, C = choiceField, M = metric;
const DEG = 180 / Math.PI, RAD = Math.PI / 180;
const inRange = (value) => Math.min(1, Math.max(0, value));

export const opticsTools = [
  D({
    id: 'thin-lens-imaging', title: 'Thin-Lens Imaging Studio', tone: 'cyan',
    desc: 'Where a single thin lens puts the image, how large it is, and whether it is real or virtual.',
    fields: [F('focal_length_m', 'Focal length (m)', 0.1, 0.005, 10), F('object_distance_m', 'Object distance (m)', 0.3, 0.006, 40)],
    sweep: 'object_distance_m',
    scenarios: [{ label: 'u = 3f', input: { focal_length_m: 0.1, object_distance_m: 0.3 } }, { label: 'u = 2f', input: { focal_length_m: 0.1, object_distance_m: 0.2 } }, { label: 'Near focus', input: { focal_length_m: 0.1, object_distance_m: 0.12 } }, { label: 'Magnifier (u < f)', input: { focal_length_m: 0.1, object_distance_m: 0.06 } }],
    equation: '1/v = 1/f − 1/u   ·   m = −v/u   ·   object at f sends parallel rays',
    note: 'Thin-lens approximation with paraxial rays and air on both sides. Curved, thick or compound systems need a ray trace.',
    calculate: (p) => {
      const f = p.focal_length_m, u = p.object_distance_m;
      if (Math.abs(u - f) < 1e-9) return { error: 'An object exactly at the focal point sends parallel rays, so no finite image forms.' };
      const v = (f * u) / (u - f), m = -v / u, real = v > 0;
      return {
        primary: M('Image distance', v, 'm'),
        metrics: [M('Transverse magnification', m, '×'), M('Image size factor', Math.abs(m), '×'), M('Object–image separation', Math.abs(u + v), 'm'), M('Lens power', 1 / f, 'D'), M('Image type', real ? 'Real, inverted' : 'Virtual, upright')],
        status: real ? 'Real image on the far side of the lens.' : 'Virtual image on the object side.',
        warning: u < f ? 'Magnifier arrangement — the image cannot be caught on a screen, but an eye can view it.' : '',
      };
    },
    references: [
      { label: 'Object at 3f forms an image at 1.5f', input: { focal_length_m: 0.1, object_distance_m: 0.3 }, expected: 0.1 * 0.3 / (0.3 - 0.1), tolerance: 1e-12 },
      { label: 'Object at 2f forms an image at 2f', input: { focal_length_m: 0.2, object_distance_m: 0.4 }, expected: 0.2 * 0.4 / (0.4 - 0.2), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'gaussian-beam-profile', title: 'Gaussian Beam Profile', tone: 'cyan',
    desc: 'Waist, Rayleigh range, divergence and the spot size a laser actually delivers at a distance.',
    fields: [F('wavelength_nm', 'Wavelength (nm)', 1064, 200, 2000), F('waist_mm', 'Beam waist radius (mm)', 1, 0.05, 20), F('distance_m', 'Distance from waist (m)', 10, 0, 1000)],
    sweep: 'distance_m',
    scenarios: [{ label: 'Nd:YAG, 1 mm waist', input: { wavelength_nm: 1064, waist_mm: 1, distance_m: 10 } }, { label: 'Tight focus', input: { wavelength_nm: 1064, waist_mm: 0.1, distance_m: 10 } }, { label: 'Fibre output', input: { wavelength_nm: 1550, waist_mm: 5, distance_m: 100 } }],
    equation: 'z_R = π w₀²/λ   ·   w(z) = w₀ √(1 + (z/z_R)²)   ·   θ = λ/(π w₀)',
    note: 'Ideal TEM₀₀ beam with an M² of 1. Real lasers have a larger M², so the delivered spot is bigger and diverges faster.',
    calculate: (p) => {
      const lambda = p.wavelength_nm * 1e-9, w0 = p.waist_mm * 1e-3, z = p.distance_m;
      const zR = (Math.PI * w0 * w0) / lambda;
      const w = w0 * Math.sqrt(1 + (z / zR) ** 2);
      const theta = lambda / (Math.PI * w0);
      return {
        primary: M('Beam radius at distance', w * 1e3, 'mm'),
        metrics: [M('Rayleigh range', zR, 'm'), M('Half-angle divergence', theta * 1e3, 'mrad'), M('Beam diameter at distance', 2 * w * 1e3, 'mm'), M('Beam area at distance', Math.PI * w * w * 1e6, 'mm²'), M('Wavefront radius', z > 0 ? z * (1 + (zR / z) ** 2) : 'Plane wavefront', 'm'), M('Gouy phase', Math.atan(z / zR) * DEG, '°')],
        status: `Spot grows from ${(w0 * 2e3).toFixed(2)} mm to ${(w * 2e3).toFixed(2)} mm over ${z} m.`,
      };
    },
    curve: (p) => {
      const lambda = p.wavelength_nm * 1e-9, w0 = p.waist_mm * 1e-3, zR = (Math.PI * w0 * w0) / lambda;
      const x = samples(0, 20, 101);
      return { x, y: x.map((z) => w0 * Math.sqrt(1 + (z / zR) ** 2) * 1e3), xLabel: 'Distance from waist (m)', yLabel: 'Beam radius (mm)', unit: 'mm' };
    },
    references: [
      { label: 'At the waist the radius equals w₀', input: { wavelength_nm: 1000, waist_mm: 1, distance_m: 0 }, expected: 1, tolerance: 1e-12 },
      { label: 'One Rayleigh range from the waist the beam is √2 w₀', input: { wavelength_nm: 1000, waist_mm: 1, distance_m: Math.PI }, expected: Math.SQRT2, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'diffraction-grating', title: 'Diffraction Grating Designer', tone: 'violet',
    desc: 'Groove spacing, diffraction angle, resolving power and the highest order a grating can reach.',
    fields: [F('lines_per_mm', 'Groove density (lines/mm)', 600, 50, 2400), F('wavelength_nm', 'Wavelength (nm)', 500, 200, 2000), F('order', 'Diffraction order', 1, 1, 8, 1), F('illuminated_width_mm', 'Illuminated width (mm)', 50, 1, 300)],
    sweep: 'wavelength_nm',
    scenarios: [{ label: '600 lines, order 1', input: { lines_per_mm: 600, wavelength_nm: 500, order: 1 } }, { label: '600 lines, order 2', input: { lines_per_mm: 600, wavelength_nm: 500, order: 2 } }, { label: 'High dispersion', input: { lines_per_mm: 1200, wavelength_nm: 600, order: 1 } }],
    equation: 'd sinθ = mλ   ·   R = mN   ·   dθ/dλ = m/(d cosθ)   ·   m_max = ⌊d/λ⌋',
    note: 'Plane-wave grating in air with an infinite-groove model. Blazed profiles, polarisation and aberrations change real throughput.',
    calculate: (p) => {
      const d = 1e-3 / p.lines_per_mm, lambda = p.wavelength_nm * 1e-9, m = p.order;
      const ratio = (m * lambda) / d;
      if (ratio > 1) return { error: `Order ${m} does not propagate: mλ exceeds the groove spacing of ${(d * 1e9).toFixed(0)} nm.` };
      const theta = Math.asin(ratio);
      const n = p.lines_per_mm * p.illuminated_width_mm;
      const dispersion = (m / (d * Math.cos(theta))) * 1e-9 * DEG;
      return {
        primary: M('Diffraction angle', theta * DEG, '°'),
        metrics: [M('Groove spacing', d * 1e9, 'nm'), M('Resolving power mN', m * n, ''), M('Resolved bandwidth Δλ', (lambda / (m * n)) * 1e12, 'pm'), M('Angular dispersion', dispersion * 1e3, 'm° /nm'), M('Highest propagating order', Math.floor(d / lambda), ''), M('Diffracted path difference', m * p.wavelength_nm, 'nm')],
        status: `Order ${m} leaves at ${(theta * DEG).toFixed(3)}° for ${p.wavelength_nm} nm light.`,
      };
    },
    references: [
      { label: '600 lines/mm, 500 nm, first order → 17.46°', input: { lines_per_mm: 600, wavelength_nm: 500, order: 1 }, expected: Math.asin(500e-9 * 1 / (1e-3 / 600)) * DEG, tolerance: 1e-12 },
      { label: 'The same groove at second order → 36.87°', input: { lines_per_mm: 600, wavelength_nm: 500, order: 2 }, expected: Math.asin(0.6) * DEG, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'fiber-link-budget', title: 'Fibre Link Budget', tone: 'emerald',
    desc: 'Every loss along a fibre span, the power that arrives, and the margin you still have.',
    fields: [F('length_km', 'Span length (km)', 20, 0.1, 300), F('attenuation_db_km', 'Fibre attenuation (dB/km)', 0.35, 0.05, 3), F('connector_count', 'Connectors', 2, 0, 20, 1), F('connector_loss_db', 'Loss per connector (dB)', 0.5, 0, 3), F('splice_count', 'Splices', 20, 0, 400, 1), F('splice_loss_db', 'Loss per splice (dB)', 0.1, 0, 1), F('source_power_dbm', 'Launch power (dBm)', 0, -10, 20), F('receiver_sensitivity_dbm', 'Receiver sensitivity (dBm)', -28, -45, 0), F('margin_required_db', 'Required margin (dB)', 3, 0, 15)],
    sweep: 'length_km',
    scenarios: [{ label: 'Metro 20 km', input: { length_km: 20, attenuation_db_km: 0.35, splice_count: 20 } }, { label: 'Long haul 80 km', input: { length_km: 80, attenuation_db_km: 0.22, splice_count: 80 } }, { label: 'Legacy 1310 nm', input: { length_km: 40, attenuation_db_km: 0.5, splice_count: 20 } }],
    equation: 'P_rx = P_tx − (αL + 2n_c + n_s)   ·   margin = P_rx − sensitivity   ·   spare reach = (margin − required)/α',
    note: 'Linear dB budget. Chromatic dispersion, non-linear thresholds, ageing and temperature swings are handled separately in a real span design.',
    calculate: (p) => {
      const fibre = p.length_km * p.attenuation_db_km;
      const connectors = p.connector_count * p.connector_loss_db;
      const splices = p.splice_count * p.splice_loss_db;
      const total = fibre + connectors + splices;
      const received = p.source_power_dbm - total;
      const margin = received - p.receiver_sensitivity_dbm;
      const spareReach = Math.max(0, (margin - p.margin_required_db) / p.attenuation_db_km);
      return {
        primary: M('Link margin', margin, 'dB'),
        metrics: [M('Total span loss', total, 'dB'), M('Received power', received, 'dBm'), M('Fibre loss', fibre, 'dB'), M('Connector + splice loss', connectors + splices, 'dB'), M('Spare reach', spareReach, 'km'), M('Verdict', margin >= p.margin_required_db ? 'Passes budget' : 'Fails budget')],
        status: margin >= p.margin_required_db ? `Passes with ${(margin - p.margin_required_db).toFixed(2)} dB to spare.` : `Short by ${(p.margin_required_db - margin).toFixed(2)} dB.`,
      };
    },
    references: [
      { label: '10 km at 0.35 dB/km with two 0.5 dB connectors leaves 23.5 dB margin', input: { length_km: 10, attenuation_db_km: 0.35, connector_count: 2, connector_loss_db: 0.5, splice_count: 0, source_power_dbm: 0, receiver_sensitivity_dbm: -28 }, expected: -(-28) + (0 - (10 * 0.35 + 2 * 0.5)), tolerance: 1e-12 },
      { label: 'Four connectors add 2 dB of loss against two', input: { length_km: 10, attenuation_db_km: 0.35, connector_count: 4, connector_loss_db: 0.5, splice_count: 0, source_power_dbm: 0, receiver_sensitivity_dbm: -28 }, expected: -(-28) + (0 - (10 * 0.35 + 4 * 0.5)), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'fresnel-reflection', title: 'Fresnel Reflection Explorer', tone: 'amber',
    desc: 'How much light bounces off a bare interface, split into s and p polarisation, with the Brewster angle.',
    fields: [C('polarisation', 'Polarisation state', 'unpolarised', [['unpolarised', 'Unpolarised'], ['s', 's-polarised'], ['p', 'p-polarised']]), F('n1', 'Incident index n₁', 1, 1, 4), F('n2', 'Transmitting index n₂', 1.5, 1, 4), F('incidence_deg', 'Angle of incidence (°)', 0, 0, 89.9)],
    sweep: 'incidence_deg',
    scenarios: [{ label: 'Air → glass', input: { n1: 1, n2: 1.5, incidence_deg: 0 } }, { label: 'Brewster angle', input: { n1: 1, n2: 1.5, incidence_deg: 56.31 } }, { label: 'Glass → air', input: { n1: 1.5, n2: 1, incidence_deg: 40 } }, { label: 'Air → diamond', input: { n1: 1, n2: 2.42, incidence_deg: 0 } }],
    equation: 'r_s = (n₁cosθᵢ − n₂cosθₜ)/(n₁cosθᵢ + n₂cosθₜ)   ·   r_p = (n₂cosθᵢ − n₁cosθₜ)/(n₂cosθᵢ + n₁cosθₜ)   ·   θ_B = tan⁻¹(n₂/n₁)',
    note: 'Smooth planar interface, no absorption or roughness. Surface films and scatter change real reflectance.',
    calculate: (p) => {
      const theta = p.incidence_deg * RAD;
      const sinT = (p.n1 * Math.sin(theta)) / p.n2;
      const totalInternal = Math.abs(sinT) > 1;
      let rs = 1, rp = 1;
      if (!totalInternal) {
        const cosI = Math.cos(theta), cosT = Math.sqrt(1 - sinT * sinT);
        rs = (p.n1 * cosI - p.n2 * cosT) / (p.n1 * cosI + p.n2 * cosT);
        rp = (p.n2 * cosI - p.n1 * cosT) / (p.n2 * cosI + p.n1 * cosT);
      }
      const Rs = rs * rs, Rp = rp * rp;
      const R = p.polarisation === 's' ? Rs : p.polarisation === 'p' ? Rp : (Rs + Rp) / 2;
      const critical = p.n1 > p.n2 ? Math.asin(p.n2 / p.n1) * DEG : null;
      return {
        primary: M('Reflectance', R * 100, '%'),
        metrics: [M('s-polarised reflectance', Rs * 100, '%'), M('p-polarised reflectance', Rp * 100, '%'), M('Transmittance', (1 - R) * 100, '%'), M('Brewster angle', Math.atan(p.n2 / p.n1) * DEG, '°'), M('Reflection loss', R > 0 ? -10 * Math.log10(1 - R) : 0, 'dB'), M('Critical angle', critical ? critical : 'None — light leaves the denser medium', '')],
        status: totalInternal ? 'Beyond the critical angle: all light is reflected.' : `Reflectance ${(R * 100).toFixed(3)} % at ${p.incidence_deg}°.`,
      };
    },
    curve: (p) => {
      const x = samples(0, 89, 90);
      const y = x.map((deg) => {
        const theta = deg * RAD, sinT = (p.n1 * Math.sin(theta)) / p.n2;
        if (Math.abs(sinT) > 1) return 100;
        const cosI = Math.cos(theta), cosT = Math.sqrt(1 - sinT * sinT);
        const rs = (p.n1 * cosI - p.n2 * cosT) / (p.n1 * cosI + p.n2 * cosT);
        const rp = (p.n2 * cosI - p.n1 * cosT) / (p.n2 * cosI + p.n1 * cosT);
        return (rs * rs + rp * rp) / 2 * 100;
      });
      return { x, y, xLabel: 'Angle of incidence (°)', yLabel: 'Unpolarised reflectance (%)', unit: '%' };
    },
    references: [
      { label: 'Normal incidence on air → glass reflects 4 %', input: { n1: 1, n2: 1.5, incidence_deg: 0, polarisation: 'unpolarised' }, expected: Math.pow((1 - 1.5) / (1 + 1.5), 2) * 100, tolerance: 1e-12 },
      { label: 'Normal incidence on air → n = 2 reflects 11.11 %', input: { n1: 1, n2: 2, incidence_deg: 0, polarisation: 'unpolarised' }, expected: Math.pow((1 - 2) / (1 + 2), 2) * 100, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'antireflection-stack', title: 'Quarter-Wave AR Coating', tone: 'violet',
    desc: 'A single quarter-wave layer, its reflectance dip, and how wide the low-reflection band really is.',
    fields: [F('substrate_index', 'Substrate index n_s', 1.5, 1.3, 4), F('design_wavelength_nm', 'Design wavelength (nm)', 550, 300, 1600), F('layer_index', 'Layer index n_c', Math.sqrt(1.5), 1, 3), F('thickness_nm', 'Layer thickness (nm)', 550 / (4 * Math.sqrt(1.5)), 5, 2000)],
    sweep: 'layer_index',
    scenarios: [{ label: 'Ideal on glass', input: { substrate_index: 1.5, design_wavelength_nm: 550, layer_index: Math.sqrt(1.5), thickness_nm: 550 / (4 * Math.sqrt(1.5)) } }, { label: 'MgF₂ on glass', input: { substrate_index: 1.5, design_wavelength_nm: 550, layer_index: 1.38, thickness_nm: 550 / (4 * 1.38) } }, { label: 'No coating', input: { substrate_index: 1.5, design_wavelength_nm: 550, layer_index: 1, thickness_nm: 100 } }, { label: 'Silicon optics', input: { substrate_index: 3.5, design_wavelength_nm: 1550, layer_index: Math.sqrt(3.5), thickness_nm: 1550 / (4 * Math.sqrt(3.5)) } }],
    equation: 'r = (r₁ + r₂e^(−2iδ))/(1 + r₁r₂e^(−2iδ))   ·   δ = 2π n_c t/λ   ·   n_ideal = √n_s   ·   t = λ/(4n_c)',
    note: 'Single-layer thin-film interference at normal incidence. Broadband and multi-angle coatings use multi-layer stacks.',
    calculate: (p) => {
      const ns = p.substrate_index, nc = p.layer_index, t = p.thickness_nm * 1e-9, design = p.design_wavelength_nm * 1e-9;
      const r1 = (1 - nc) / (1 + nc), r2 = (nc - ns) / (nc + ns);
      const reflectance = (lambda) => {
        const delta = (2 * Math.PI * nc * t) / lambda;
        const cos = Math.cos(-2 * delta), sin = Math.sin(-2 * delta);
        const nr = r1 + r2 * cos, ni = r2 * sin;
        const dr = 1 + r1 * r2 * cos, di = r1 * r2 * sin;
        return inRange((nr * nr + ni * ni) / (dr * dr + di * di));
      };
      const band = samples(400, 700, 121).map((nm) => ({ nm, R: reflectance(nm * 1e-9) * 100 }));
      const trough = band.reduce((best, item) => (item.R < best.R ? item : best), band[0]);
      const wide = band.filter((item) => item.R < 1).length / (band.length - 1) * 300;
      return {
        primary: M('Reflectance at design wavelength', reflectance(design) * 100, '%'),
        metrics: [M('Ideal coating index', Math.sqrt(ns), ''), M('Quarter-wave thickness', (p.design_wavelength_nm / (4 * nc)), 'nm'), M('Minimum reflectance (400–700 nm)', trough.R, '%'), M('Wavelength of minimum', trough.nm, 'nm'), M('Width below 1 % reflectance', wide, 'nm'), M('Layer optical thickness', nc * p.thickness_nm, 'nm')],
        status: `Dip centred near ${trough.nm.toFixed(0)} nm.`,
      };
    },
    curve: (p) => {
      const ns = p.substrate_index, nc = p.layer_index, t = p.thickness_nm * 1e-9;
      const r1 = (1 - nc) / (1 + nc), r2 = (nc - ns) / (nc + ns);
      const x = samples(380, 800, 106);
      const y = x.map((nm) => {
        const delta = (2 * Math.PI * nc * t) / (nm * 1e-9);
        const cos = Math.cos(-2 * delta), sin = Math.sin(-2 * delta);
        const nr = r1 + r2 * cos, ni = r2 * sin, dr = 1 + r1 * r2 * cos, di = r1 * r2 * sin;
        return inRange((nr * nr + ni * ni) / (dr * dr + di * di)) * 100;
      });
      return { x, y, xLabel: 'Wavelength (nm)', yLabel: 'Reflectance (%)', unit: '%' };
    },
    references: [
      { label: 'A layer with the index of air behaves as a bare surface (4 %)', input: { substrate_index: 1.5, design_wavelength_nm: 550, layer_index: 1, thickness_nm: 100 }, expected: Math.pow((1 - 1.5) / (1 + 1.5), 2) * 100, tolerance: 1e-9 },
      { label: 'Quarter-wave with the ideal index nulls reflectance', input: { substrate_index: 1.5, design_wavelength_nm: 550, layer_index: Math.sqrt(1.5), thickness_nm: 550 / (4 * Math.sqrt(1.5)) }, expected: 0, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'photometry-lux', title: 'Radiometric to Photometric', tone: 'amber',
    desc: 'Luminous flux, intensity and the illuminance a source actually delivers at a distance.',
    fields: [F('radiant_power_w', 'Radiant power (W)', 10, 0.001, 5000), F('luminous_efficacy', 'Luminous efficacy (lm/W)', 100, 1, 683), F('distance_m', 'Distance (m)', 5, 0.05, 200), F('beam_cone_deg', 'Beam full angle (°)', 60, 1, 180)],
    sweep: 'distance_m',
    scenarios: [{ label: '100 lm/W lamp, 5 m', input: { radiant_power_w: 10, luminous_efficacy: 100, distance_m: 5, beam_cone_deg: 60 } }, { label: 'Ideal 683 lm/W', input: { radiant_power_w: 10, luminous_efficacy: 683, distance_m: 1, beam_cone_deg: 180 } }, { label: 'Narrow 15° spot', input: { radiant_power_w: 10, luminous_efficacy: 100, distance_m: 5, beam_cone_deg: 15 } }, { label: 'Wide flood 120°', input: { radiant_power_w: 10, luminous_efficacy: 100, distance_m: 5, beam_cone_deg: 120 } }],
    equation: 'Φ = P·K   ·   Ω = 2π(1 − cos(θ/2))   ·   I = Φ/Ω   ·   E = I/d²',
    note: 'Uniform intensity inside an ideal conical beam. Real luminaires have a measured intensity distribution file.',
    calculate: (p) => {
      const flux = p.radiant_power_w * p.luminous_efficacy;
      const solid = 2 * Math.PI * (1 - Math.cos((p.beam_cone_deg * RAD) / 2));
      if (solid <= 0) return { error: 'Choose a beam angle between 1° and 180°.' };
      const intensity = flux / solid;
      const illuminance = intensity / (p.distance_m * p.distance_m);
      const radius = p.distance_m * Math.tan((p.beam_cone_deg * RAD) / 2);
      const area = Math.PI * radius * radius;
      return {
        primary: M('Illuminance on axis', illuminance, 'lux'),
        metrics: [M('Luminous flux', flux, 'lm'), M('Luminous intensity', intensity, 'cd'), M('Illuminated disc area', area, 'm²'), M('Flux inside the disc', flux, 'lm'), M('Relative to a 500 lx task light', (illuminance / 500) * 100, '%'), M('Beam efficiency into the disc', 100, '%')],
        status: illuminance >= 300 ? 'Bright enough for focused work.' : 'Dim for task lighting — increase power or narrow the beam.',
      };
    },
    references: [
      { label: '10 W at 683 lm/W spreads to 6830 lm and 1087 lx at 1 m', input: { radiant_power_w: 10, luminous_efficacy: 683, distance_m: 1, beam_cone_deg: 180 }, expected: (10 * 683) / (2 * Math.PI), tolerance: 1e-12 },
      { label: 'Doubling distance quarters the illuminance', input: { radiant_power_w: 10, luminous_efficacy: 683, distance_m: 2, beam_cone_deg: 180 }, expected: (10 * 683) / (2 * Math.PI) / 4, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'laser-rate-equations', title: 'Laser Threshold Calculator', tone: 'rose',
    desc: 'Round-trip loss, threshold gain and how much headroom the small-signal gain has.',
    fields: [F('gain_length_cm', 'Gain length (cm)', 10, 0.1, 200), F('internal_loss_per_cm', 'Internal loss αᵢ (cm⁻¹)', 0.01, 0.0001, 2), F('mirror_r1_pct', 'Mirror 1 reflectivity (%)', 99, 1, 100), F('mirror_r2_pct', 'Mirror 2 reflectivity (%)', 99, 1, 100), F('small_signal_gain_per_cm', 'Small-signal gain g₀ (cm⁻¹)', 0.05, 0.0001, 5)],
    sweep: 'small_signal_gain_per_cm',
    scenarios: [{ label: 'Low-loss cavity', input: { gain_length_cm: 10, internal_loss_per_cm: 0.01, mirror_r1_pct: 99, mirror_r2_pct: 99, small_signal_gain_per_cm: 0.05 } }, { label: 'High-gain medium', input: { gain_length_cm: 10, internal_loss_per_cm: 0.01, mirror_r1_pct: 99, mirror_r2_pct: 99, small_signal_gain_per_cm: 0.1 } }, { label: 'Lossy short cavity', input: { gain_length_cm: 2, internal_loss_per_cm: 0.05, mirror_r1_pct: 95, mirror_r2_pct: 90, small_signal_gain_per_cm: 0.05 } }],
    equation: 'g_th = αᵢ + (1/2L)ln(1/(R₁R₂))   ·   gain margin = g₀/g_th',
    note: 'Steady-state gain-loss balance only. Pumping dynamics, thermal lensing and transverse modes require a rate-equation simulation.',
    calculate: (p) => {
      const r1 = p.mirror_r1_pct / 100, r2 = p.mirror_r2_pct / 100;
      if (r1 <= 0 || r2 <= 0) return { error: 'Mirror reflectivity must be positive.' };
      const mirror = Math.log(1 / (r1 * r2)) / (2 * p.gain_length_cm);
      const threshold = p.internal_loss_per_cm + mirror;
      const margin = p.small_signal_gain_per_cm / threshold;
      return {
        primary: M('Threshold gain coefficient', threshold, 'cm⁻¹'),
        metrics: [M('Output-coupling loss', mirror, 'cm⁻¹'), M('Gain margin', margin, '×'), M('Output coupling share', (mirror / threshold) * 100, '%'), M('Round-trip loss', 2 * threshold * p.gain_length_cm, ''), M('Single-pass small-signal gain', (Math.exp(p.small_signal_gain_per_cm * p.gain_length_cm) - 1) * 100, '%'), M('Cavity state', margin >= 1 ? 'Above threshold — lases' : 'Below threshold')],
        status: margin >= 1 ? `Lases with ${(margin - 1).toFixed(2)}× headroom.` : 'Gain is below the round-trip loss, so no oscillation.',
      };
    },
    references: [
      { label: 'Lossless mirrors leave only the internal loss as threshold gain', input: { gain_length_cm: 10, internal_loss_per_cm: 0.01, mirror_r1_pct: 100, mirror_r2_pct: 100, small_signal_gain_per_cm: 0.05 }, expected: 0.01, tolerance: 1e-12 },
      { label: '50 % mirrors on a 1 cm gain block give 0.0001 + ln 2', input: { gain_length_cm: 1, internal_loss_per_cm: 0.0001, mirror_r1_pct: 50, mirror_r2_pct: 50, small_signal_gain_per_cm: 1 }, expected: 0.0001 + Math.log(2), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'photodetector-noise', title: 'Photodetector Noise & NEP', tone: 'emerald',
    desc: 'Shot and thermal noise, signal-to-noise ratio, and the noise-equivalent power of a detector.',
    fields: [F('responsivity_a_per_w', 'Responsivity (A/W)', 0.8, 0.001, 100), F('optical_power_nw', 'Optical power (nW)', 1000, 0.001, 1e9), F('dark_current_na', 'Dark current (nA)', 1, 0, 1e6), F('bandwidth_hz', 'Bandwidth (Hz)', 1e7, 1, 1e12), F('load_resistance_ohm', 'Load resistance (Ω)', 1000, 1, 1e8), F('temperature_k', 'Temperature (K)', 300, 1, 500)],
    sweep: 'optical_power_nw',
    scenarios: [{ label: 'PIN, 1 nW signal', input: { optical_power_nw: 1, dark_current_na: 1, load_resistance_ohm: 1000 } }, { label: 'Low-noise TIA', input: { optical_power_nw: 1, dark_current_na: 0.01, load_resistance_ohm: 1e5 } }, { label: 'Strong signal', input: { optical_power_nw: 10000, dark_current_na: 1, load_resistance_ohm: 1000 } }],
    equation: 'i_shot = √(2q(I_ph + I_d)B)   ·   i_th = √(4kTB/R)   ·   NEP = √(2qI_d + 4kT/R)/R',
    note: 'Shot and Johnson noise only, with unity gain. Avalanche or transimpedance gain multiplies the noise in ways this model does not capture.',
    calculate: (p) => {
      const q = 1.602176634e-19, kB = 1.380649e-23;
      const photonCurrent = p.responsivity_a_per_w * p.optical_power_nw * 1e-9;
      const dark = p.dark_current_na * 1e-9;
      const shot = Math.sqrt(2 * q * (photonCurrent + dark) * p.bandwidth_hz);
      const thermal = Math.sqrt((4 * kB * p.temperature_k * p.bandwidth_hz) / p.load_resistance_ohm);
      const total = Math.hypot(shot, thermal);
      const density = Math.sqrt(2 * q * dark + (4 * kB * p.temperature_k) / p.load_resistance_ohm);
      const snr = total > 0 ? photonCurrent / total : Infinity;
      return {
        primary: M('Noise-equivalent power', (density / p.responsivity_a_per_w) * 1e12, 'pW/√Hz'),
        metrics: [M('Photocurrent', photonCurrent * 1e6, 'µA'), M('Shot noise', shot * 1e9, 'nA rms'), M('Thermal noise', thermal * 1e9, 'nA rms'), M('Signal-to-noise ratio', 20 * Math.log10(snr), 'dB'), M('NEP in this bandwidth', (total / p.responsivity_a_per_w) * 1e12, 'pW'), M('Noise regime', shot >= thermal ? 'Shot-noise limited' : 'Thermal-noise limited')],
        status: `Shot noise ${shot >= thermal ? 'dominates' : 'is below'} the thermal noise floor.`,
      };
    },
    references: [
      { label: 'Pure Johnson limit at 1 K and 10 MΩ', input: { responsivity_a_per_w: 1, optical_power_nw: 0, dark_current_na: 0, bandwidth_hz: 1e7, load_resistance_ohm: 1e7, temperature_k: 1 }, expected: Math.hypot(Math.sqrt(4 * 1.380649e-23 * 1 / 1e7), 0) * 1e12, tolerance: 1e-6 },
      { label: 'Shot limit from 1 nA of dark current', input: { responsivity_a_per_w: 1, optical_power_nw: 0, dark_current_na: 1, bandwidth_hz: 1e7, load_resistance_ohm: 1e7, temperature_k: 1 }, expected: Math.hypot(Math.sqrt(2 * 1.602176634e-19 * 1e-9), Math.sqrt(4 * 1.380649e-23 * 1 / 1e7)) * 1e12, tolerance: 1e-6 },
    ],
  }),
  D({
    id: 'coherence-interferometer', title: 'Coherence & Fringe Visibility', tone: 'cyan',
    desc: 'Coherence length, fringe visibility and how many fringes fit into a given path difference.',
    fields: [F('wavelength_nm', 'Wavelength (nm)', 632.8, 200, 2000), F('linewidth_nm', 'Spectral linewidth (nm)', 0.001, 1e-6, 50), F('path_difference_mm', 'Path difference (mm)', 0.2, 0, 1000)],
    sweep: 'path_difference_mm',
    scenarios: [{ label: 'Stabilised HeNe', input: { wavelength_nm: 632.8, linewidth_nm: 0.0001, path_difference_mm: 100 } }, { label: 'Typical HeNe', input: { wavelength_nm: 632.8, linewidth_nm: 0.002, path_difference_mm: 100 } }, { label: 'LED source', input: { wavelength_nm: 550, linewidth_nm: 30, path_difference_mm: 0.2 } }, { label: 'Laser diode', input: { wavelength_nm: 780, linewidth_nm: 0.5, path_difference_mm: 2 } }],
    equation: 'L_c = λ²/Δλ   ·   τ_c = L_c/c   ·   V = e^(−(ΔL/L_c)²)',
    note: 'Gaussian spectral profile, so visibility falls smoothly. Lorentzian sources decay exponentially instead.',
    calculate: (p) => {
      const lambda = p.wavelength_nm * 1e-9, width = p.linewidth_nm * 1e-9;
      if (width <= 0) return { error: 'Linewidth must be positive.' };
      const length = (lambda * lambda) / width;
      const path = p.path_difference_mm * 1e-3;
      const visibility = Math.exp(-((path / length) ** 2)) * 100;
      const c = 299792458;
      return {
        primary: M('Fringe visibility', visibility, '%'),
        metrics: [M('Coherence length', length * 1e3, 'mm'), M('Coherence time', (length / c) * 1e12, 'ps'), M('Fringe spacing λ/2', (p.wavelength_nm / 2), 'nm'), M('Fringes across the path difference', path / (lambda / 2), ''), M('Spectral width Δf', (c * width) / (lambda * lambda) / 1e9, 'GHz'), M('Fringe quality', visibility > 50 ? 'Strong fringes' : visibility > 5 ? 'Weak fringes' : 'Fringes washed out')],
        status: path < length ? 'Path difference is inside the coherence length.' : 'Path difference exceeds the coherence length — expect washed-out fringes.',
      };
    },
    references: [
      { label: 'A path difference equal to L_c leaves 1/e visibility (36.8 %)', input: { wavelength_nm: 1000, linewidth_nm: 0.001, path_difference_mm: 1000 }, expected: 100 * Math.exp(-1), tolerance: 1e-9 },
      { label: 'Half the coherence length leaves 77.9 %', input: { wavelength_nm: 1000, linewidth_nm: 0.001, path_difference_mm: 500 }, expected: 100 * Math.exp(-0.25), tolerance: 1e-9 },
    ],
  }),
];

export default opticsTools;