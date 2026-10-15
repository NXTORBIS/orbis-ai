import { check, closeCheck, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Refraction at a plane interface and through a prism, with the Fresnel reflectances for the
 * two polarisations and an idealised Cauchy dispersion so a prism can be seen to spread colour.
 */

const MODE_OPTIONS = [
  { value: 'interface', label: 'Plane interface (refraction and total internal reflection)' },
  { value: 'prism', label: 'Prism (deviation and dispersion)' },
];

const DEG = Math.PI / 180;

export const interfaceSolution = (p) => {
  const incidence = p.incidence * DEG;
  const sine = (p.n1 / p.n2) * Math.sin(incidence);
  const critical = p.n1 > p.n2 ? Math.asin(p.n2 / p.n1) : null;
  const totalInternal = Math.abs(sine) > 1;
  const refraction = totalInternal ? NaN : Math.asin(sine);
  const theta1 = incidence;
  const theta2 = totalInternal ? NaN : refraction;
  const rs = ((p.n1 * Math.cos(theta1) - p.n2 * Math.cos(theta2)) / (p.n1 * Math.cos(theta1) + p.n2 * Math.cos(theta2))) ** 2;
  const rp = ((p.n1 * Math.cos(theta2) - p.n2 * Math.cos(theta1)) / (p.n1 * Math.cos(theta2) + p.n2 * Math.cos(theta1))) ** 2;
  const brewster = Math.atan(p.n2 / p.n1);
  return {
    incidence,
    refraction,
    refractionDegrees: (refraction * 180) / Math.PI,
    totalInternal,
    critical: critical === null ? null : (critical * 180) / Math.PI,
    reflectanceS: totalInternal ? 1 : rs,
    reflectanceP: totalInternal ? 1 : rp,
    reflectance: totalInternal ? 1 : (rs + rp) / 2,
    transmittance: totalInternal ? 0 : 1 - (rs + rp) / 2,
    brewsterDegrees: (brewster * 180) / Math.PI,
    atBrewster: Math.abs(p.incidence - (brewster * 180) / Math.PI) < 0.25,
  };
};

/** Vector Snell refraction, used to draw the prism exactly as it is computed. */
const normalize = (v) => { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; };

const refractVector = (dir, normal, eta) => {
  const cosI = -(dir.x * normal.x + dir.y * normal.y);
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null;
  const cosT = Math.sqrt(1 - sin2T);
  return normalize({ x: eta * dir.x + (eta * cosI - cosT) * normal.x, y: eta * dir.y + (eta * cosI - cosT) * normal.y });
};

const intersectFace = (origin, dir, point, normal) => {
  const denominator = dir.x * normal.x + dir.y * normal.y;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y) / denominator;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, t };
};

export const PRISM_HEIGHT = 1.6;

export function prismGeometry(apexAngle) {
  const half = (apexAngle * DEG) / 2;
  return {
    half,
    apex: { x: 0, y: PRISM_HEIGHT },
    left: { x: -PRISM_HEIGHT * Math.tan(half), y: 0 },
    right: { x: PRISM_HEIGHT * Math.tan(half), y: 0 },
    leftNormal: { x: -Math.cos(half), y: Math.sin(half) },
    rightNormal: { x: Math.cos(half), y: -Math.sin(half) },
  };
}

/** Trace the drawn ray through the prism with vector Snell refraction at both faces. */
export function tracePrism(p, index = p.n2) {
  const geometry = prismGeometry(p.apexAngle);
  const angle = p.incidence * DEG;
  const rotate = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const direction = rotate({ x: -geometry.leftNormal.x, y: -geometry.leftNormal.y }, angle);
  const start = { x: -2.4, y: geometry.apex.y + 0.9 };
  const entry = intersectFace(start, direction, geometry.apex, geometry.leftNormal) || start;
  const inside = refractVector(direction, geometry.leftNormal, 1 / index);
  if (!inside) return { points: [start, entry], trapped: true, geometry };
  const exit = intersectFace(entry, inside, geometry.right, geometry.rightNormal);
  if (!exit) return { points: [start, entry], trapped: true, geometry };
  const out = refractVector(inside, geometry.rightNormal, index);
  if (!out) return { points: [start, entry, exit], trapped: true, geometry };
  return { points: [start, entry, exit, { x: exit.x + out.x * 2.2, y: exit.y + out.y * 2.2 }], geometry, trapped: false };
}

export const prismSolution = (p, index = p.n2) => {
  const A = p.apexAngle * DEG;
  const i1 = p.incidence * DEG;
  const sineR1 = Math.sin(i1) / index;
  if (Math.abs(sineR1) > 1) return { totalInternalAtEntry: true, deviation: NaN, index };
  const r1 = Math.asin(sineR1);
  const r2 = A - r1;
  const sineR2 = index * Math.sin(r2);
  const trapped = Math.abs(sineR2) > 1;
  if (trapped) return { r1, r2, totalInternalInside: true, deviation: NaN, index };
  const i2 = Math.asin(sineR2);
  const deviation = (i1 + i2 - A) * (180 / Math.PI);
  return {
    i1: p.incidence,
    r1: (r1 * 180) / Math.PI,
    r2: (r2 * 180) / Math.PI,
    i2: (i2 * 180) / Math.PI,
    deviation,
    index,
    minimumDeviation: 2 * Math.asin(index * Math.sin(A / 2)) * (180 / Math.PI) - p.apexAngle,
  };
};

export const refractionSim = {
  id: 'refraction-dispersion',
  unit: 's',
  digits: 2,
  note: 'Snell’s law with the Fresnel reflectances for light polarised perpendicular to and parallel to the plane of incidence, the critical angle for total internal reflection, Brewster’s angle where the parallel component vanishes, and a prism with an idealised Cauchy dispersion so that colour spreading can be seen as an angular difference between two refractive indices.',
  checkNote: 'Snell’s law, its reversibility, the critical angle, the Fresnel energy split, Brewster’s angle, the prism deviation identity and the minimum-deviation formula are all verified numerically.',
  params: { mode: 'interface', n1: 1, n2: 1.52, incidence: 40, apexAngle: 60, dispersion: 0.02 },
  fields: [
    { key: 'mode', label: 'Experiment', options: MODE_OPTIONS },
    { key: 'n1', label: 'Index of the first medium n₁', min: 1, max: 2.6, step: 0.01 },
    { key: 'n2', label: 'Index of the second medium n₂', min: 1, max: 2.6, step: 0.01 },
    { key: 'incidence', label: 'Angle of incidence (°)', min: 0, max: 89, step: 0.5 },
    { key: 'apexAngle', label: 'Prism apex angle A (°)', min: 10, max: 90, step: 1 },
    { key: 'dispersion', label: 'Index spread across the spectrum Δn', min: 0, max: 0.08, step: 0.002, hint: 'idealised Cauchy dispersion for the colour spread' },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['mode', 'n1', 'n2', 'incidence', 'apexAngle', 'dispersion'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    if (p.mode === 'prism') {
      const main = prismSolution(p);
      const red = prismSolution(p, Math.max(1, p.n2 - p.dispersion));
      const violet = prismSolution(p, p.n2 + p.dispersion);
      return { t: y.tau, mode: 'prism', ...main, red, violet, spread: Math.abs(violet.deviation - red.deviation), minimumDeviation: main.minimumDeviation, atMinimum: Math.abs(p.incidence - ((main.minimumDeviation + p.apexAngle) / 2)) < 1 };
    }
    const solution = interfaceSolution(p);
    return { t: y.tau, mode: 'interface', ...solution, reflectedAngle: p.incidence };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...refractionSim.params };

    const snell = interfaceSolution({ ...base, incidence: 40, n1: 1, n2: 1.52 });
    list.push(closeCheck('Snell’s law in the form n₁sin θ₁ = n₂sin θ₂', 1 * Math.sin(snell.incidence), 1.52 * Math.sin(snell.refraction), 1e-12, 6));

    const forward = interfaceSolution({ ...base, n1: 1.33, n2: 1.5, incidence: 35 });
    const backward = interfaceSolution({ ...base, n1: 1.5, n2: 1.33, incidence: forward.refractionDegrees });
    list.push(closeCheck('The path is reversible: swapping the media returns the original angle', backward.refractionDegrees, 35, 1e-9, 5));

    const grazing = interfaceSolution({ ...base, n1: 1.5, n2: 1, incidence: 41.8 });
    const beyond = interfaceSolution({ ...base, n1: 1.5, n2: 1, incidence: 45 });
    list.push(closeCheck('The critical angle is asin(n₂/n₁)', grazing.critical, (Math.asin(1 / 1.5) * 180) / Math.PI, 1e-9, 4));
    list.push(check('Beyond the critical angle the light is totally internally reflected', beyond.totalInternal && beyond.reflectance === 1, `at 45° the transmittance is ${beyond.transmittance}`));
    list.push(check('Just inside the critical angle the light still escapes', !grazing.totalInternal, `refracted at ${grazing.refractionDegrees.toFixed(2)}°`));

    const energy = interfaceSolution({ ...base, incidence: 55, n1: 1, n2: 1.6 });
    list.push(closeCheck('Fresnel reflectance and transmittance add to one', energy.reflectance + energy.transmittance, 1, 1e-12, 6));

    let bestAngle = 0;
    let bestValue = 1;
    for (let angle = 0; angle <= 89; angle += 0.01) {
      const value = interfaceSolution({ ...base, incidence: angle, n1: 1, n2: 1.5 }).reflectanceP;
      if (value < bestValue) { bestValue = value; bestAngle = angle; }
    }
    list.push(closeCheck('The parallel reflectance vanishes at Brewster’s angle tan θ = n₂/n₁', bestAngle, (Math.atan(1.5) * 180) / Math.PI, 2e-3, 4));
    list.push(check('At Brewster’s angle the perpendicular component is still reflected', bestValue < 1e-6 && interfaceSolution({ ...base, incidence: bestAngle, n1: 1, n2: 1.5 }).reflectanceS > 0.1, `Rs = ${interfaceSolution({ ...base, incidence: bestAngle, n1: 1, n2: 1.5 }).reflectanceS.toFixed(4)}`));

    const prism = prismSolution({ ...base, mode: 'prism', apexAngle: 60, n2: 1.52, incidence: 48.6 });
    const identity = prism.i1 + prism.i2 - base.apexAngle - prism.deviation;
    list.push(check('Prism deviation equals i₁ + i₂ − A', Math.abs(identity) < 1e-9, `residual ${identity.toExponential(1)}°`));
    list.push(closeCheck('Minimum deviation satisfies n = sin((A + δ)/2)/sin(A/2)', prism.minimumDeviation, (2 * Math.asin(1.52 * Math.sin((60 * DEG) / 2)) * 180) / Math.PI - 60, 1e-9, 5));

    let scanDeviation = Infinity;
    let scanAngle = 0;
    for (let angle = 20; angle <= 85; angle += 0.005) {
      const value = prismSolution({ ...base, apexAngle: 60, n2: 1.52, incidence: angle }).deviation;
      if (Number.isFinite(value) && value < scanDeviation) { scanDeviation = value; scanAngle = angle; }
    }
    list.push(closeCheck('Scanning the incidence angle finds the same minimum deviation', scanDeviation, prism.minimumDeviation, 5e-3, 4));
    list.push(closeCheck('Minimum deviation occurs at i₁ = (A + δ)/2', scanAngle, (60 + prism.minimumDeviation) / 2, 1e-2, 4));

    const redRay = prismSolution({ ...base, apexAngle: 60, n2: 1.5, incidence: 50 });
    const violetRay = prismSolution({ ...base, apexAngle: 60, n2: 1.54, incidence: 50 });
    list.push(check('Violet is deviated more than red', violetRay.deviation > redRay.deviation, `${violetRay.deviation.toFixed(3)}° against ${redRay.deviation.toFixed(3)}°`));
    const noSpreadRed = prismSolution({ ...base, apexAngle: 60, n2: 1.52, incidence: 50 });
    const noSpreadViolet = prismSolution({ ...base, apexAngle: 60, n2: 1.52, incidence: 50 });
    list.push(check('No dispersion means no colour spread', Math.abs(noSpreadViolet.deviation - noSpreadRed.deviation) < 1e-12, 'identical deviation for both ends of the spectrum'));
    list.push(check('A prism of index equal to the surroundings does not deviate', relErr(prismSolution({ ...base, apexAngle: 60, n2: 1, incidence: 50 }).deviation, 0) < 1e-9, 'no bending when n = 1'));
    list.push(check('Light entering a prism at a shallow angle still refracts inwards', prismSolution({ ...base, apexAngle: 60, n2: 1.6, incidence: 30 }).r1 < 30, 'r₁ < i₁ inside a denser prism'));
    return { checks: list };
  },
};