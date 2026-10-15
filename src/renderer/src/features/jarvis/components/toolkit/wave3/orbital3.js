import { defineTool, numberField, choiceField, metric } from '@jarvis/components/toolkit/science50/model';

const D = defineTool, F = numberField, C = choiceField, M = metric;
const MU_EARTH = 398600.4418;
const R_EARTH = 6378.137;
const G = 6.674e-11;
const SIGMA = 5.670374419e-8;
const AU_KM = 149597870.7;
const DEG = 180 / Math.PI;

const BODIES = {
  earth: { mu: MU_EARTH, radius: R_EARTH, label: 'Earth' },
  mars: { mu: 42828.37, radius: 3396.19, label: 'Mars' },
  moon: { mu: 4902.8, radius: 1737.4, label: 'Moon' },
  jupiter: { mu: 126686534, radius: 71492, label: 'Jupiter' },
};
const BODY_CHOICES = [['earth', 'Earth'], ['mars', 'Mars'], ['moon', 'Moon'], ['jupiter', 'Jupiter']];
const circularSpeed = (radiusKm) => Math.sqrt(MU_EARTH / radiusKm);
const samplingNote = (perPixel, resolution) => (perPixel < resolution / 3 ? 'Oversampled' : perPixel < resolution / 1.5 ? 'Well sampled' : 'Undersampled');

export const orbitalTools = [
  D({
    id: 'orbital-circular', title: 'Circular Orbit Calculator', tone: 'cyan',
    desc: 'Orbital speed, period, energy and escape speed for a circular orbit around a chosen body.',
    fields: [C('body', 'Central body', 'earth', BODY_CHOICES), F('altitude_km', 'Altitude above the surface (km)', 300, 0, 500000)],
    sweep: 'altitude_km',
    scenarios: [{ label: 'ISS-like 300 km', input: { body: 'earth', altitude_km: 300 } }, { label: 'Sun-synchronous 700 km', input: { body: 'earth', altitude_km: 700 } }, { label: 'GEO 35 786 km', input: { body: 'earth', altitude_km: 35786 } }, { label: 'Mars 400 km', input: { body: 'mars', altitude_km: 400 } }, { label: 'Low lunar orbit 100 km', input: { body: 'moon', altitude_km: 100 } }],
    equation: 'v = √(μ/r)   ·   T = 2π√(r³/μ)   ·   ε = −μ/(2r)   ·   v_esc = √2 v',
    note: 'Two-body Keplerian motion around a spherical body. Real orbits drift under J2 oblateness, drag and third-body effects.',
    calculate: (p) => {
      const body = BODIES[p.body];
      const radius = body.radius + p.altitude_km;
      const speed = Math.sqrt(body.mu / radius);
      const period = 2 * Math.PI * Math.sqrt(radius ** 3 / body.mu);
      return {
        primary: M('Orbital speed', speed, 'km/s'),
        metrics: [M('Orbital period', period / 60, 'min'), M('Revolutions per day', 86400 / period, ''), M('Specific orbital energy', -body.mu / (2 * radius), 'MJ/kg'), M('Escape speed at this radius', speed * Math.SQRT2, 'km/s'), M('Orbit circumference', 2 * Math.PI * radius, 'km'), M('Altitude in body radii', p.altitude_km / body.radius, 'R')],
        status: `${body.label} orbit at ${radius.toFixed(0)} km radius, period ${(period / 60).toFixed(1)} min.`,
      };
    },
    references: [
      { label: '300 km above Earth → 7.726 km/s', input: { body: 'earth', altitude_km: 300 }, expected: circularSpeed(R_EARTH + 300), tolerance: 1e-12 },
      { label: 'At the surface, the orbital speed is 7.905 km/s', input: { body: 'earth', altitude_km: 0 }, expected: circularSpeed(R_EARTH), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'hohmann-transfer', title: 'Hohmann Transfer Planner', tone: 'violet',
    desc: 'Both engine burns, the transfer time and the total Δv between two circular Earth orbits.',
    fields: [F('departure_altitude_km', 'Departure altitude (km)', 300, 100, 200000), F('arrival_altitude_km', 'Arrival altitude (km)', 35786, 100, 400000)],
    sweep: 'arrival_altitude_km',
    scenarios: [{ label: 'LEO → GEO', input: { departure_altitude_km: 300, arrival_altitude_km: 35786 } }, { label: 'LEO → MEO 20 200 km', input: { departure_altitude_km: 300, arrival_altitude_km: 20200 } }, { label: 'LEO → Moon distance', input: { departure_altitude_km: 300, arrival_altitude_km: 384400 } }, { label: 'GTO top-up', input: { departure_altitude_km: 250, arrival_altitude_km: 35786 } }],
    equation: 'a_t = (r₁+r₂)/2   ·   Δv₁ = v₁(√(2r₂/(r₁+r₂)) − 1)   ·   Δv₂ = v₂(1 − √(2r₁/(r₁+r₂)))   ·   t = π√(a_t³/μ)',
    note: 'Ideal impulsive two-burn transfer between coplanar circular orbits. Plane changes, finite burn times and launch-site latitude add cost.',
    calculate: (p) => {
      const r1 = R_EARTH + p.departure_altitude_km;
      const r2 = R_EARTH + p.arrival_altitude_km;
      if (Math.abs(r1 - r2) < 1e-6) return { error: 'Choose a different arrival altitude — departure and arrival orbits are the same.' };
      const v1 = circularSpeed(r1), v2 = circularSpeed(r2);
      const first = v1 * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
      const second = v2 * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
      const axis = (r1 + r2) / 2;
      const time = Math.PI * Math.sqrt(axis ** 3 / MU_EARTH);
      return {
        primary: M('Total Δv', first + second, 'km/s'),
        metrics: [M('Departure burn Δv₁', first, 'km/s'), M('Arrival burn Δv₂', second, 'km/s'), M('Transfer time', time / 3600, 'h'), M('Transfer semi-major axis', axis, 'km'), M('Transfer eccentricity', Math.abs(r2 - r1) / (r1 + r2), ''), M('Departure orbital speed', v1, 'km/s'), M('Arrival orbital speed', v2, 'km/s')],
        status: `${(first + second).toFixed(3)} km/s in two burns over ${(time / 3600).toFixed(1)} hours.`,
      };
    },
    references: [
      { label: 'LEO 300 km → GEO costs 3.89 km/s', input: { departure_altitude_km: 300, arrival_altitude_km: 35786 }, expected: circularSpeed(R_EARTH + 300) * (Math.sqrt((2 * (R_EARTH + 35786)) / ((R_EARTH + 300) + (R_EARTH + 35786))) - 1) + circularSpeed(R_EARTH + 35786) * (1 - Math.sqrt((2 * (R_EARTH + 300)) / ((R_EARTH + 300) + (R_EARTH + 35786)))), tolerance: 1e-9 },
      { label: 'A short LEO → 1 000 km hop costs 0.24 km/s', input: { departure_altitude_km: 300, arrival_altitude_km: 1000 }, expected: circularSpeed(R_EARTH + 300) * (Math.sqrt((2 * (R_EARTH + 1000)) / ((R_EARTH + 300) + (R_EARTH + 1000))) - 1) + circularSpeed(R_EARTH + 1000) * (1 - Math.sqrt((2 * (R_EARTH + 300)) / ((R_EARTH + 300) + (R_EARTH + 1000)))), tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'vis-viva-velocity', title: 'Elliptical Orbit Velocities', tone: 'emerald',
    desc: 'Perigee and apogee speeds, semi-major axis, eccentricity and period of an elliptical orbit.',
    fields: [F('perigee_altitude_km', 'Perigee altitude (km)', 300, 100, 300000), F('apogee_altitude_km', 'Apogee altitude (km)', 1000, 100, 500000)],
    sweep: 'apogee_altitude_km',
    scenarios: [{ label: 'LEO 300 × 1 000 km', input: { perigee_altitude_km: 300, apogee_altitude_km: 1000 } }, { label: 'GTO', input: { perigee_altitude_km: 250, apogee_altitude_km: 35786 } }, { label: 'Circular 700 km', input: { perigee_altitude_km: 700, apogee_altitude_km: 700 } }, { label: 'Highly eccentric', input: { perigee_altitude_km: 300, apogee_altitude_km: 200000 } }],
    equation: 'v = √(μ(2/r − 1/a))   ·   a = (r_p + r_a)/2   ·   e = (r_a − r_p)/(r_a + r_p)   ·   h = r_p v_p',
    note: 'Two-body orbit with no perturbations. Atmospheric drag dominates below roughly 200 km altitude.',
    calculate: (p) => {
      const rp = R_EARTH + p.perigee_altitude_km;
      const ra = R_EARTH + p.apogee_altitude_km;
      const axis = (rp + ra) / 2;
      const speedAt = (r) => Math.sqrt(MU_EARTH * (2 / r - 1 / axis));
      const vp = speedAt(rp), va = speedAt(ra);
      const period = 2 * Math.PI * Math.sqrt(axis ** 3 / MU_EARTH);
      return {
        primary: M('Perigee speed', vp, 'km/s'),
        metrics: [M('Apogee speed', va, 'km/s'), M('Semi-major axis', axis, 'km'), M('Eccentricity', (ra - rp) / (ra + rp), ''), M('Orbital period', period / 60, 'min'), M('Specific angular momentum', rp * vp, 'km²/s'), M('Specific energy', -MU_EARTH / (2 * axis), 'MJ/kg')],
        status: `e = ${((ra - rp) / (ra + rp)).toFixed(4)}, period ${(period / 60).toFixed(1)} min.`,
      };
    },
    references: [
      { label: 'A circular orbit has equal perigee and apogee speeds (7.55 km/s at 700 km)', input: { perigee_altitude_km: 700, apogee_altitude_km: 700 }, expected: Math.sqrt(MU_EARTH * (2 / (R_EARTH + 700) - 1 / (R_EARTH + 700))), tolerance: 1e-12 },
      { label: 'A 300 × 1 000 km orbit peaks at 7.79 km/s', input: { perigee_altitude_km: 300, apogee_altitude_km: 1000 }, expected: Math.sqrt(MU_EARTH * (2 / (R_EARTH + 300) - 1 / ((R_EARTH + 300 + R_EARTH + 1000) / 2))), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'rocket-equation', title: 'Rocket Equation & Staging', tone: 'rose',
    desc: 'Δv from propellant mass and exhaust velocity, plus what it costs to buy another kilometre per second.',
    fields: [F('specific_impulse_s', 'Specific impulse I_sp (s)', 350, 50, 5000), F('propellant_mass_kg', 'Propellant mass (kg)', 667, 0.001, 1e8), F('dry_mass_kg', 'Dry mass (kg)', 333, 0.001, 1e8), F('payload_mass_kg', 'Payload mass (kg)', 100, 0, 1e8)],
    sweep: 'propellant_mass_kg',
    scenarios: [{ label: 'Mass ratio 3', input: { specific_impulse_s: 350, propellant_mass_kg: 667, dry_mass_kg: 333, payload_mass_kg: 100 } }, { label: 'Mass ratio 4', input: { specific_impulse_s: 350, propellant_mass_kg: 750, dry_mass_kg: 250, payload_mass_kg: 100 } }, { label: 'Hydrogen upper stage', input: { specific_impulse_s: 450, propellant_mass_kg: 667, dry_mass_kg: 333, payload_mass_kg: 100 } }, { label: 'Heavy lift ratio 5', input: { specific_impulse_s: 340, propellant_mass_kg: 800, dry_mass_kg: 200, payload_mass_kg: 100 } }],
    equation: 'Δv = I_sp g₀ ln(m₀/m_f)   ·   v_e = I_sp g₀   ·   m₀/m_f is the mass ratio',
    note: 'Tsiolkovsky ideal rocket, ignoring gravity, drag, pressure and steering losses. Real ascent needs 1.5–2 km/s more than orbital speed.',
    calculate: (p) => {
      const g0 = 9.80665;
      const initial = p.propellant_mass_kg + p.dry_mass_kg + p.payload_mass_kg;
      const final = p.dry_mass_kg + p.payload_mass_kg;
      if (final <= 0 || p.propellant_mass_kg <= 0) return { error: 'The vehicle needs propellant, a dry mass and a non-zero final mass.' };
      const delta = p.specific_impulse_s * g0 * Math.log(initial / final);
      const exhaust = p.specific_impulse_s * g0;
      const extraPropellant = Math.exp(delta / exhaust + 1000 / exhaust);
      return {
        primary: M('Velocity change Δv', delta, 'm/s'),
        metrics: [M('Mass ratio', initial / final, ''), M('Propellant mass fraction', (p.propellant_mass_kg / initial) * 100, '%'), M('Exhaust velocity', exhaust, 'm/s'), M('Launch mass', initial, 'kg'), M('Mass ratio needed for +1 km/s', extraPropellant, ''), M('Ideal Δv in km/s', delta / 1000, 'km/s')],
        status: `${(delta / 1000).toFixed(2)} km/s from a mass ratio of ${(initial / final).toFixed(2)}.`,
      };
    },
    references: [
      { label: 'Mass ratio 3 003/1 000 at I_sp 350 gives 3 774 m/s', input: { specific_impulse_s: 350, propellant_mass_kg: 667, dry_mass_kg: 333, payload_mass_kg: 0 }, expected: 350 * 9.80665 * Math.log(1000 / 333), tolerance: 1e-12 },
      { label: 'Mass ratio 4 gives 4 757 m/s', input: { specific_impulse_s: 350, propellant_mass_kg: 750, dry_mass_kg: 250, payload_mass_kg: 0 }, expected: 350 * 9.80665 * Math.log(4), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'escape-velocity', title: 'Escape Velocity & Surface Gravity', tone: 'amber',
    desc: 'Escape speed, circular speed and surface gravity for any mass and radius you enter.',
    fields: [F('central_mass_kg', 'Body mass (kg)', 5.972e24, 1e18, 1e34), F('radius_km', 'Body radius (km)', 6371, 1, 1e9), F('specific_impulse_s', 'Rocket I_sp for the mass-ratio view (s)', 350, 50, 1000)],
    sweep: 'radius_km',
    scenarios: [{ label: 'Earth', input: { central_mass_kg: 5.972e24, radius_km: 6371 } }, { label: 'Moon', input: { central_mass_kg: 7.342e22, radius_km: 1737.4 } }, { label: 'Mars', input: { central_mass_kg: 6.417e23, radius_km: 3389.5 } }, { label: 'Jupiter', input: { central_mass_kg: 1.898e27, radius_km: 69911 } }, { label: 'Asteroid 10 km', input: { central_mass_kg: 1e16, radius_km: 5 } }],
    equation: 'v_esc = √(2GM/R)   ·   v_circ = √(GM/R)   ·   g = GM/R²   ·   mass ratio = e^(v_esc/v_e)',
    note: 'Spherical, non-rotating body with no atmosphere. Rotation lowers the required speed at the equator and drag raises it.',
    calculate: (p) => {
      const radius = p.radius_km * 1000;
      const mu = G * p.central_mass_kg;
      const escape = Math.sqrt((2 * mu) / radius);
      const exhaust = p.specific_impulse_s * 9.80665;
      const ratio = Math.exp(escape / exhaust);
      return {
        primary: M('Escape velocity', escape / 1000, 'km/s'),
        metrics: [M('Circular orbital velocity', Math.sqrt(mu / radius) / 1000, 'km/s'), M('Surface gravity', mu / radius ** 2, 'm/s²'), M('Escape energy per kg', (mu / radius) / 1e6, 'MJ/kg'), M('Single-stage mass ratio to escape', ratio, ''), M('Propellant fraction for that ratio', (1 - 1 / ratio) * 100, '%'), M('Thermal escape reference', Math.sqrt((2 * 1.380649e-23 * 288) / 4.8e-26) / 1000, 'km/s (N₂ at 288 K)')],
        status: `Needs ${(escape / 1000).toFixed(2)} km/s to escape — a mass ratio of ${ratio.toFixed(1)} in one stage.`,
      };
    },
    references: [
      { label: 'Earth: 5.972×10²⁴ kg and 6 371 km → 11.19 km/s', input: { central_mass_kg: 5.972e24, radius_km: 6371 }, expected: Math.sqrt((2 * 6.674e-11 * 5.972e24) / 6.371e6) / 1000, tolerance: 1e-12 },
      { label: 'The Moon, at 7.342×10²² kg and 1 737.4 km → 2.375 km/s', input: { central_mass_kg: 7.342e22, radius_km: 1737.4 }, expected: Math.sqrt((2 * 6.674e-11 * 7.342e22) / 1.7374e6) / 1000, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'synodic-period', title: 'Synodic Period & Launch Windows', tone: 'violet',
    desc: 'How often two planets line up again, and how fast the geometry drifts between windows.',
    fields: [F('inner_period_days', 'Inner body period (days)', 365.25, 0.1, 200000), F('outer_period_days', 'Outer body period (days)', 686.98, 0.1, 200000)],
    sweep: 'outer_period_days',
    scenarios: [{ label: 'Earth → Mars', input: { inner_period_days: 365.25, outer_period_days: 686.98 } }, { label: 'Earth → Jupiter', input: { inner_period_days: 365.25, outer_period_days: 4332.59 } }, { label: 'Earth → Venus (inner)', input: { inner_period_days: 224.7, outer_period_days: 365.25 } }, { label: 'Moon → Earth', input: { inner_period_days: 27.32, outer_period_days: 365.25 } }],
    equation: '1/S = |1/P₁ − 1/P₂|   ·   drift = 360/S per day',
    note: 'Keplerian circular coplanar approximation. Real launch windows also depend on orbital inclination, eccentricity and phasing.',
    calculate: (p) => {
      if (Math.abs(p.inner_period_days - p.outer_period_days) < 1e-9) return { error: 'Equal periods mean the bodies never change their relative position — the synodic period is infinite.' };
      const synodic = 1 / Math.abs(1 / p.inner_period_days - 1 / p.outer_period_days);
      return {
        primary: M('Synodic period', synodic, 'days'),
        metrics: [M('Synodic period', synodic / 365.25, 'years'), M('Conjunctions per decade', 3652.5 / synodic, ''), M('Relative drift', 360 / synodic, '°/day'), M('Inner body revolutions per cycle', synodic / p.inner_period_days, ''), M('Outer body revolutions per cycle', synodic / p.outer_period_days, ''), M('Window repeat', synodic / 30.44, 'months')],
        status: `They line up again every ${synodic.toFixed(1)} days (${(synodic / 365.25).toFixed(2)} years).`,
      };
    },
    references: [
      { label: 'Earth and Mars repeat every 779.9 days', input: { inner_period_days: 365.25, outer_period_days: 686.98 }, expected: 1 / Math.abs(1 / 365.25 - 1 / 686.98), tolerance: 1e-12 },
      { label: 'Earth and the Moon repeat every 29.5 days', input: { inner_period_days: 27.32, outer_period_days: 365.25 }, expected: 1 / Math.abs(1 / 27.32 - 1 / 365.25), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'insolation-flux', title: 'Insolation & Equilibrium Temperature', tone: 'amber',
    desc: 'Solar flux at any heliocentric distance and the temperature a body settles at.',
    fields: [F('distance_au', 'Heliocentric distance (AU)', 1, 0.05, 60), F('albedo', 'Bond albedo', 0.3, 0, 1), F('emissivity', 'Infrared emissivity', 1, 0.05, 1)],
    sweep: 'distance_au',
    scenarios: [{ label: 'Earth', input: { distance_au: 1, albedo: 0.3, emissivity: 1 } }, { label: 'Mars', input: { distance_au: 1.524, albedo: 0.25, emissivity: 1 } }, { label: 'Venus', input: { distance_au: 0.723, albedo: 0.77, emissivity: 1 } }, { label: 'A blackbody world', input: { distance_au: 1, albedo: 0, emissivity: 1 } }, { label: 'Inner edge 0.5 AU', input: { distance_au: 0.5, albedo: 0.3, emissivity: 1 } }],
    equation: 'S = S₀/d²   ·   T_eq = (S(1−a)/(4σε))^¼   ·   T_subsolar = 4^¼ T_eq',
    note: 'Fast-rotating airless body in radiative balance, ignoring greenhouse warming, internal heat and latitude.'  ,
    calculate: (p) => {
      const flux = 1361 / p.distance_au ** 2;
      const absorbed = flux * (1 - p.albedo);
      const equilibrium = Math.pow(absorbed / (4 * SIGMA * p.emissivity), 0.25);
      return {
        primary: M('Equilibrium temperature', equilibrium, 'K'),
        metrics: [M('Solar flux', flux, 'W/m²'), M('Equilibrium temperature', equilibrium - 273.15, '°C'), M('Subsolar temperature', equilibrium * Math.pow(4, 0.25), 'K'), M('Absorbed flux', absorbed, 'W/m²'), M('Radiated flux', SIGMA * p.emissivity * equilibrium ** 4, 'W/m²'), M('Solar constant ratio', flux / 1361, '×')],
        status: `Flux of ${flux.toFixed(0)} W/m² holds the surface near ${(equilibrium - 273.15).toFixed(1)} °C without an atmosphere.`,
      };
    },
    references: [
      { label: 'Earth at 1 AU with albedo 0.3 settles near 254.6 K', input: { distance_au: 1, albedo: 0.3, emissivity: 1 }, expected: Math.pow((1361 * 0.7) / (4 * 5.670374419e-8), 0.25), tolerance: 1e-12 },
      { label: 'A perfectly absorbing world reaches 278.3 K', input: { distance_au: 1, albedo: 0, emissivity: 1 }, expected: Math.pow(1361 / (4 * 5.670374419e-8), 0.25), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'magnitude-distance', title: 'Magnitude & Distance Modulus', tone: 'cyan',
    desc: 'Absolute magnitude, distance modulus and luminosity ratio from an apparent magnitude and distance.',
    fields: [F('apparent_magnitude', 'Apparent magnitude', 8, -30, 40), F('distance_pc', 'Distance (pc)', 100, 0.0001, 1e9), F('extinction_mag', 'Interstellar extinction (mag)', 0, 0, 20)],
    sweep: 'distance_pc',
    scenarios: [{ label: 'Star at 100 pc', input: { apparent_magnitude: 8, distance_pc: 100, extinction_mag: 0 } }, { label: 'Same star at 10 pc', input: { apparent_magnitude: 8, distance_pc: 10, extinction_mag: 0 } }, { label: 'Dusty field', input: { apparent_magnitude: 12, distance_pc: 1000, extinction_mag: 1.5 } }, { label: 'Andromeda-like 780 kpc', input: { apparent_magnitude: 4, distance_pc: 780000, extinction_mag: 0.2 } }],
    equation: 'm − M = 5 log₁₀(d/10 pc)   ·   M = m − 5 log₁₀(d/10) − A   ·   L/L☉ = 10^(0.4(4.83 − M))',
    note: 'Distance modulus with a single extinction term. Bolometric corrections, K-corrections and bandpass differences are not applied.',
    calculate: (p) => {
      const modulus = 5 * Math.log10(p.distance_pc / 10);
      const absolute = p.apparent_magnitude - modulus - p.extinction_mag;
      return {
        primary: M('Absolute magnitude', absolute, 'mag'),
        metrics: [M('Distance modulus', modulus, 'mag'), M('Distance', p.distance_pc * 3.26156, 'light years'), M('Luminosity versus the Sun', Math.pow(10, 0.4 * (4.83 - absolute)), 'L☉'), M('Extinction correction', p.extinction_mag, 'mag'), M('Flux versus a 0-mag star', Math.pow(10, -0.4 * p.apparent_magnitude), '×'), M('Apparent magnitude at 10 pc', absolute + p.extinction_mag, 'mag')],
        status: `Distance modulus ${modulus.toFixed(2)} mag ⇒ M = ${absolute.toFixed(2)}.`,
      };
    },
    references: [
      { label: 'At 10 pc the distance modulus is zero', input: { apparent_magnitude: 8, distance_pc: 10, extinction_mag: 0 }, expected: 8 - 5 * Math.log10(10 / 10), tolerance: 1e-12 },
      { label: 'At 100 pc the modulus is 5 mag', input: { apparent_magnitude: 8, distance_pc: 100, extinction_mag: 0 }, expected: 8 - 5, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'telescope-resolution', title: 'Telescope Resolution & Sampling', tone: 'violet',
    desc: 'Diffraction limit, plate scale, pixel sampling and what the atmosphere does to it all.',
    fields: [F('aperture_mm', 'Aperture (mm)', 200, 5, 5000), F('wavelength_nm', 'Wavelength (nm)', 550, 300, 5000), F('focal_length_mm', 'Focal length (mm)', 1200, 20, 20000), F('pixel_size_um', 'Pixel size (µm)', 3.76, 0.5, 40), F('seeing_arcsec', 'Seeing (arcsec)', 2, 0, 10)],
    sweep: 'aperture_mm',
    scenarios: [{ label: '200 mm f/6 refractor', input: { aperture_mm: 200, focal_length_mm: 1200, wavelength_nm: 550, pixel_size_um: 3.76, seeing_arcsec: 2 } }, { label: 'Large 500 mm', input: { aperture_mm: 500, focal_length_mm: 2000, wavelength_nm: 550, pixel_size_um: 3.76, seeing_arcsec: 2 } }, { label: 'Small 80 mm', input: { aperture_mm: 80, focal_length_mm: 560, wavelength_nm: 550, pixel_size_um: 3.76, seeing_arcsec: 2 } }, { label: 'Infrared 2 µm', input: { aperture_mm: 200, focal_length_mm: 1200, wavelength_nm: 2000, pixel_size_um: 10, seeing_arcsec: 1.2 } }, { label: 'Excellent seeing', input: { aperture_mm: 200, focal_length_mm: 1200, wavelength_nm: 550, pixel_size_um: 3.76, seeing_arcsec: 0.6 } }],
    equation: 'θ_Rayleigh = 1.22λ/D   ·   Dawes = 116/D(mm) arcsec   ·   plate scale = 206 265/f(mm) arcsec/mm',
    note: 'Diffraction-limited optics with a perfect mount and no atmospheric dispersion. Real performance also depends on optical quality and guiding.',
    calculate: (p) => {
      const rayleigh = ((1.22 * p.wavelength_nm * 1e-9) / (p.aperture_mm / 1000)) * 206264.806;
      const dawes = 116 / p.aperture_mm;
      const plateScale = 206264.806 / p.focal_length_mm;
      const perPixel = (plateScale * p.pixel_size_um) / 1000;
      const effective = Math.max(rayleigh, p.seeing_arcsec);
      return {
        primary: M('Rayleigh resolution', rayleigh, 'arcsec'),
        metrics: [M('Dawes limit', dawes, 'arcsec'), M('Plate scale', plateScale, 'arcsec/mm'), M('Arcseconds per pixel', perPixel, 'arcsec'), M('Sampling', samplingNote(perPixel, effective), ''), M('Effective resolution with seeing', effective, 'arcsec'), M('Limiting magnitude estimate', 1.77 + 5 * Math.log10(p.aperture_mm), 'mag')],
        status: effective > rayleigh + 1e-9 ? 'Seeing limits the image, not the optics.' : 'Optics alone set the resolution.',
      };
    },
    references: [
      { label: '200 mm at 550 nm resolves 0.692 arcsec', input: { aperture_mm: 200, wavelength_nm: 550, focal_length_mm: 1200, pixel_size_um: 3.76, seeing_arcsec: 2 }, expected: ((1.22 * 550e-9) / 0.2) * 206264.806, tolerance: 1e-9 },
      { label: 'Doubling the aperture halves it to 0.346 arcsec', input: { aperture_mm: 400, wavelength_nm: 550, focal_length_mm: 1200, pixel_size_um: 3.76, seeing_arcsec: 2 }, expected: ((1.22 * 550e-9) / 0.4) * 206264.806, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'hill-sphere', title: 'Hill Sphere & Satellite Stability', tone: 'emerald',
    desc: 'How far a moon can orbit before the primary star steals it, plus the tidal field across the body.',
    fields: [F('primary_mass_kg', 'Primary mass (kg)', 1.989e30, 1e20, 1e36), F('secondary_mass_kg', 'Secondary body mass (kg)', 5.972e24, 1e15, 1e33), F('separation_km', 'Orbital separation (km)', 149.6e6, 100, 1e10), F('secondary_radius_km', 'Secondary body radius (km)', 6371, 1, 1e8)],
    sweep: 'separation_km',
    scenarios: [{ label: 'Earth around the Sun', input: { primary_mass_kg: 1.989e30, secondary_mass_kg: 5.972e24, separation_km: 149.6e6, secondary_radius_km: 6371 } }, { label: 'The Moon around Earth', input: { primary_mass_kg: 5.972e24, secondary_mass_kg: 7.342e22, separation_km: 384400, secondary_radius_km: 1737.4 } }, { label: 'Mars around the Sun', input: { primary_mass_kg: 1.989e30, secondary_mass_kg: 6.417e23, separation_km: 227.9e6, secondary_radius_km: 3389.5 } }, { label: 'A close binary', input: { primary_mass_kg: 1.989e30, secondary_mass_kg: 1.989e30, separation_km: 20e6, secondary_radius_km: 696340 } }],
    equation: 'r_H = a (m/(3M))^⅓   ·   r_SOI = a (m/M)^⅖   ·   tidal field ≈ 2GM R/d³',
    note: 'Hill-sphere estimate for a circular orbit. Prograde satellites stay stable only inside roughly half the Hill radius.',
    calculate: (p) => {
      const hill = p.separation_km * Math.cbrt(p.secondary_mass_kg / (3 * p.primary_mass_kg));
      const influence = p.separation_km * Math.pow(p.secondary_mass_kg / p.primary_mass_kg, 0.4);
      const periodDays = (2 * Math.PI * Math.sqrt((p.separation_km * 1000) ** 3 / (G * (p.primary_mass_kg + p.secondary_mass_kg)))) / 86400;
      const tidal = (2 * G * p.primary_mass_kg * (p.secondary_radius_km * 1000)) / (p.separation_km * 1000) ** 3;
      return {
        primary: M('Hill sphere radius', hill, 'km'),
        metrics: [M('Hill radius in AU', hill / AU_KM, 'AU'), M('Hill radius / orbital separation', (hill / p.separation_km) * 100, '%'), M('Hill radius in body radii', hill / p.secondary_radius_km, ''), M('Sphere of influence (Laplace)', influence, 'km'), M('Tidal acceleration across the body', tidal, 'm/s²'), M('Orbital period of the pair', periodDays, 'days'), M('Stable satellite limit', hill * 0.5, 'km')],
        status: `Moons can orbit out to about ${(hill * 0.5).toFixed(0)} km before the primary takes over.`,
      };
    },
    references: [
      { label: 'Earth’s Hill sphere reaches 1.496 million km', input: { primary_mass_kg: 1.989e30, secondary_mass_kg: 5.972e24, separation_km: 149.6e6, secondary_radius_km: 6371 }, expected: 149.6e6 * Math.cbrt(5.972e24 / (3 * 1.989e30)), tolerance: 1e-12 },
      { label: 'The Moon’s Hill sphere around Earth is 61 500 km', input: { primary_mass_kg: 5.972e24, secondary_mass_kg: 7.342e22, separation_km: 384400, secondary_radius_km: 1737.4 }, expected: 384400 * Math.cbrt(7.342e22 / (3 * 5.972e24)), tolerance: 1e-12 },
    ],
  }),
];

export default orbitalTools;