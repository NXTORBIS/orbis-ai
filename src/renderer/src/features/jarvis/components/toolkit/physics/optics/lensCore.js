import { relErr, check, closeCheck, sig } from '@jarvis/components/toolkit/physics/phys';

/**
 * Thin lens and spherical mirror imaging with the real-positive convention:
 * 1/f = 1/u + 1/v, magnification m = −v/u. The three principal rays are built from the image
 * position the equation returns, so the drawing is a picture of the calculation.
 */

const MODE_OPTIONS = [
  { value: 'lens', label: 'Thin lens' },
  { value: 'concave', label: 'Concave mirror (converging)' },
  { value: 'convex', label: 'Convex mirror (diverging)' },
];

export const focalOf = (p) => {
  if (p.mode === 'lens') return p.focal;
  return p.mode === 'concave' ? Math.abs(p.focal) : -Math.abs(p.focal);
};

export const image = (p) => {
  const f = focalOf(p);
  const u = Math.max(1e-6, p.objectDistance);
  const denominator = u - f;
  const v = Math.abs(denominator) < 1e-9 ? Infinity : (u * f) / denominator;
  const magnification = Number.isFinite(v) ? -v / u : Infinity;
  return {
    f,
    u,
    v,
    magnification,
    imageHeight: Math.abs(magnification) * p.objectHeight,
    real: Number.isFinite(v) ? v > 0 : false,
    inverted: magnification < 0,
    atInfinity: !Number.isFinite(v) || Math.abs(v) > 1e5,
    power: 1 / f,
    radiusOfCurvature: p.mode === 'lens' ? null : 2 * f,
    newton: (u - f) * (v - f),
    mirror: p.mode !== 'lens',
  };
};

/** Height of the emerging ray at the image plane, extending the last segment when the image is virtual. */
const heightAt = (points, x) => {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return a.y + ((x - a.x) / (b.x - a.x || 1e-12)) * (b.y - a.y);
};

/** The three principal rays, drawn in the convention of the element chosen. */
export function principalRays(p) {
  const base = image(p);
  const { f, u, v, magnification, mirror } = base;
  const h = p.objectHeight;
  const tip = { x: -u, y: h };
  const imageX = mirror ? -v : v;
  const imageTip = { x: Number.isFinite(v) ? imageX : 0, y: Number.isFinite(magnification) ? h * magnification : 0 };
  const extent = Math.max(Math.abs(u), Math.abs(Number.isFinite(v) ? v : u), Math.abs(f)) * 1.2 + 2;
  const focusX = mirror ? -f : f;
  const forward = mirror ? -1 : 1;
  const walk = (from, dir) => {
    const dx = dir.x;
    if (Math.abs(dx) < 1e-12) return { x: from.x, y: from.y + dir.y };
    const targetX = forward * extent;
    const scale = (targetX - from.x) / dx;
    return { x: from.x + dx * scale, y: from.y + dir.y * scale };
  };
  const yAtElement = (-h * f) / (u - f);
  const rays = [
    {
      label: 'ray parallel to the axis',
      note: `then through the focal point at x = ${focusX.toFixed(1)} cm`,
      points: [tip, { x: 0, y: h }, walk({ x: 0, y: h }, { x: forward * Math.abs(f), y: -h * Math.sign(f) })],
    },
    {
      label: mirror ? 'ray to the vertex' : 'ray through the optical centre',
      note: mirror ? 'reflected symmetrically about the axis' : 'passes straight through, undeviated',
      points: [tip, { x: 0, y: 0 }, walk({ x: 0, y: 0 }, { x: forward * u, y: -h })],
    },
    {
      label: 'ray aimed at the focal point',
      note: 'emerges parallel to the axis',
      points: [tip, { x: 0, y: yAtElement }, { x: forward * extent, y: yAtElement }],
    },
  ];
  const virtual = !Number.isFinite(v) || (mirror ? -v < 0 : v < 0);
  return {
    ...base,
    tip,
    imageTip,
    focusX,
    extent,
    rays,
    virtual,
    // where each ray meets the image plane — used by the checks
    crossings: rays.map((ray) => heightAt(ray.points, Number.isFinite(v) ? imageX : 0)),
  };
}

export const lensSim = {
  id: 'thin-lens-mirror',
  unit: 's',
  digits: 2,
  note: 'A single thin lens or spherical mirror in the real-positive convention: 1/f = 1/u + 1/v, with a positive focal length for anything converging and the image distance measured from the element. The three principal rays are constructed from the image position the equation returns, so the diagram cannot disagree with the numbers.',
  checkNote: 'The lens equation, Newton’s relation, the meeting of the three constructed rays at the image tip, the equal-size case at u = 2f, the mirror relation f = R/2, the power of two lenses in contact and the focal-point limit are all tested.',
  params: { mode: 'lens', focal: 10, objectDistance: 25, objectHeight: 4, secondFocal: -20 },
  fields: [
    { key: 'mode', label: 'Optical element', options: MODE_OPTIONS },
    { key: 'focal', label: 'Focal length f (cm)', min: -40, max: 40, step: 1, hint: 'Positive converges; the sign is set by the mirror type' },
    { key: 'objectDistance', label: 'Object distance u (cm)', min: 1, max: 120, step: 1 },
    { key: 'objectHeight', label: 'Object height (cm)', min: 0.5, max: 12, step: 0.5 },
    { key: 'secondFocal', label: 'Second lens in contact f₂ (cm)', min: -40, max: 40, step: 1 },
  ],
  options: { maxStep: 1 / 60, sampleEvery: 0.1, resetOn: ['mode', 'focal', 'objectDistance', 'objectHeight', 'secondFocal'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const result = principalRays(p);
    return {
      t: y.tau,
      ...result,
      combinedFocal: 1 / (1 / result.f + 1 / p.secondFocal),
      combinationPower: 1 / result.f + 1 / p.secondFocal,
      description: result.atInfinity
        ? 'the object sits at the focal point, so the emerging beam is parallel and the image is at infinity'
        : result.real
          ? `real ${result.inverted ? 'and inverted' : ''} image, ${result.magnification < 0 ? 'enlarged' : 'reduced'} by ${Math.abs(result.magnification).toFixed(2)}×`
          : `virtual, upright image on the ${result.mirror ? 'reflecting' : 'object'} side, ${Math.abs(result.magnification).toFixed(2)}× the object`,
      objectAngle: Math.atan(p.objectHeight / p.objectDistance),
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const base = { ...lensSim.params };

    for (const mode of ['lens', 'concave', 'convex']) {
      const params = { ...base, mode, focal: mode === 'lens' ? 10 : 12 };
      const result = image(params);
      const residual = 1 / result.f - (1 / params.objectDistance + 1 / result.v);
      list.push(check(`${mode}: 1/f = 1/u + 1/v holds`, Math.abs(residual) < 1e-12, `residual ${residual.toExponential(1)} cm⁻¹`));
      list.push(closeCheck(`${mode}: Newton’s relation (u − f)(v − f) = f²`, result.newton, result.f * result.f, 1e-9, 5));
      list.push(closeCheck(`${mode}: magnification is −v/u`, result.magnification, -result.v / result.u, 1e-12, 5));
      const rays = principalRays(params);
      const spread = Math.max(...rays.crossings.map((crossing) => Math.abs(crossing - params.objectHeight * result.magnification)));
      list.push(check(`${mode}: all three constructed rays meet at the image tip`, spread < 1e-6, `largest mismatch ${spread.toExponential(1)} cm`));
    }

    const equal = image({ ...base, objectDistance: 20, focal: 10 });
    list.push(closeCheck('At u = 2f the image sits at 2f', equal.v, 20, 1e-12, 5));
    list.push(closeCheck('At u = 2f the magnification is exactly −1', equal.magnification, -1, 1e-12, 5));

    const infinite = image({ ...base, objectDistance: 10, focal: 10 });
    list.push(check('An object at the focal point gives an image at infinity', infinite.atInfinity, 'the emerging rays are parallel'));

    const swapped = image({ ...base, objectDistance: image(base).v });
    list.push(closeCheck('Object and image distances can be swapped', swapped.v, base.objectDistance, 1e-9, 5));

    const real = image(base);
    list.push(check('A real image from the default setup is inverted', real.real && real.inverted, `m = ${real.magnification.toFixed(3)}, image height ${real.imageHeight.toFixed(2)} cm`));

    const convex = image({ ...base, mode: 'convex', focal: 15 });
    list.push(check('A convex mirror always gives a virtual, diminished image', !convex.real && convex.imageHeight < base.objectHeight, `image height ${convex.imageHeight.toFixed(2)} cm against object ${base.objectHeight} cm`));
    list.push(closeCheck('A concave mirror has f = R/2', image({ ...base, mode: 'concave', focal: 15 }).radiusOfCurvature / 2, 15, 1e-12, 4));

    const reading = lensSim.read({ tau: 0 }, base);
    list.push(closeCheck('The combined focal length is 1/(1/f₁ + 1/f₂)', reading.combinedFocal, 1 / (1 / base.focal + 1 / base.secondFocal), 1e-12, 5));
    list.push(closeCheck('Two lenses in contact add their powers', reading.combinationPower, 1 / base.focal + 1 / base.secondFocal, 1e-12, 6));
    list.push(check('Power in dioptres is the reciprocal of the focal length in metres', relErr(image({ ...base, focal: 50 }).power * 100, 1 / 0.5) < 1e-12, `${(image({ ...base, focal: 50 }).power * 100).toFixed(2)} D for f = 50 cm`));
    list.push(check('A shorter object distance magnifies more', Math.abs(image({ ...base, objectDistance: 30 }).magnification) > Math.abs(image({ ...base, objectDistance: 60 }).magnification), `|m| = ${Math.abs(image({ ...base, objectDistance: 30 }).magnification).toFixed(3)} at 30 cm`));
    return { checks: list };
  },
};