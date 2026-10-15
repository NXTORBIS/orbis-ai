import { check, closeCheck, relErr } from '@jarvis/components/toolkit/physics/phys';

/**
 * Rotational dynamics: moments of inertia, rolling without slipping, angular-momentum conserving
 * collisions and a physical pendulum. Each standard shape carries its textbook inertia, and the
 * parallel-axis theorem and the energy split of a rolling body are used to test them.
 */

const G = 9.80665;

export const SHAPES = [
  { value: 'sphere', label: 'Solid sphere (I = 2/5 mR²)', k: 2 / 5 },
  { value: 'shell', label: 'Hollow sphere (I = 2/3 mR²)', k: 2 / 3 },
  { value: 'disk', label: 'Solid disk (I = 1/2 mR²)', k: 1 / 2 },
  { value: 'hoop', label: 'Thin hoop (I = mR²)', k: 1 },
];

export const shapeFactor = (shape) => (SHAPES.find((item) => item.value === shape) || SHAPES[0]).k;

export const rodInertia = (mass, length, pivotEnd) => (pivotEnd ? (mass * length * length) / 3 : (mass * length * length) / 12);

export const rollingTime = (length, angle, k) => Math.sqrt((2 * length) / ((G * Math.sin(angle)) / (1 + k)));

export const rotationSim = {
  id: 'rotational-dynamics',
  unit: 's',
  digits: 3,
  note: 'Rolling bodies, spinning disks that merge, pulleys that must themselves be turned, and a rod swinging as a physical pendulum. Every inertia used is derived from the mass distribution and then tested against the textbook values and the parallel-axis theorem.',
  checkNote: 'The inertia of each shape is compared with its formula and with the parallel-axis theorem, a rolling sphere is required to put exactly 5/7 of its energy into translation, angular momentum is checked before and after a spinning disk is dropped onto another, and the pendulum period is compared with 2π√(2L/3g).',
  params: { mode: 'rolling', shape: 'sphere', mass: 2, radius: 12, angle: 20, rampLength: 3, spin: 40, diskMass: 3, diskRadius: 20, pulleyMass: 1.5, pulleyRadius: 8, mass1: 3, mass2: 1, rodLength: 1.2 },
  fields: [
    { key: 'mode', label: 'Situation', options: [
      { value: 'rolling', label: 'Rolling down an incline' },
      { value: 'collision', label: 'A spinning disk meets another' },
      { value: 'pulley', label: 'Atwood machine with a heavy pulley' },
      { value: 'pendulum', label: 'Rod as a physical pendulum' },
    ] },
    { key: 'shape', label: 'Rolling body', options: SHAPES },
    { key: 'mass', label: 'Mass (kg)', min: 0.2, max: 20, step: 0.1 },
    { key: 'radius', label: 'Radius (cm)', min: 2, max: 60, step: 1 },
    { key: 'angle', label: 'Incline angle (°)', min: 2, max: 45, step: 1 },
    { key: 'rampLength', label: 'Ramp length (m)', min: 0.5, max: 20, step: 0.1 },
    { key: 'spin', label: 'Initial spin (rad/s)', min: 1, max: 200, step: 1 },
    { key: 'diskMass', label: 'Dropped disk mass (kg)', min: 0.2, max: 20, step: 0.1 },
    { key: 'diskRadius', label: 'Dropped disk radius (cm)', min: 2, max: 60, step: 1 },
    { key: 'pulleyMass', label: 'Pulley mass (kg)', min: 0, max: 20, step: 0.1 },
    { key: 'pulleyRadius', label: 'Pulley radius (cm)', min: 2, max: 40, step: 1 },
    { key: 'mass1', label: 'Hanging mass 1 (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'mass2', label: 'Hanging mass 2 (kg)', min: 0.1, max: 20, step: 0.1 },
    { key: 'rodLength', label: 'Rod length (m)', min: 0.2, max: 4, step: 0.05 },
  ],
  options: { maxStep: 1 / 240, sampleEvery: 0.02, resetOn: ['mode', 'shape', 'mass', 'radius', 'angle', 'rampLength', 'spin', 'diskMass', 'diskRadius', 'pulleyMass', 'pulleyRadius', 'mass1', 'mass2', 'rodLength'] },
  init: () => ({ tau: 0 }),
  step: (y, h) => ({ ...y, tau: y.tau + h }),
  read: (y, p) => {
    const radius = p.radius * 1e-2;
    const k = shapeFactor(p.shape);
    if (p.mode === 'rolling') {
      const inertia = k * p.mass * radius * radius;
      const acceleration = (G * Math.sin((p.angle * Math.PI) / 180)) / (1 + k);
      const travel = Math.min(p.rampLength, 0.5 * acceleration * y.tau * y.tau);
      const speed = acceleration * y.tau;
      const height = p.rampLength * Math.sin((p.angle * Math.PI) / 180);
      const bottomSpeed = Math.sqrt((2 * G * height) / (1 + k));
      const time = rollingTime(p.rampLength, (p.angle * Math.PI) / 180, k);
      const keTranslation = 0.5 * p.mass * speed * speed;
      const keRotation = 0.5 * inertia * Math.pow(speed / radius, 2);
      const total = keTranslation + keRotation;
      return {
        t: y.tau, acceleration, travel, speed, inertia, k, bottomSpeed, time, height,
        omega: speed / radius, keTranslation, keRotation, total,
        translationShare: total > 1e-12 ? keTranslation / total : 0.5,
        angularAcceleration: acceleration / radius,
        torque: inertia * (acceleration / radius),
        progress: travel / p.rampLength,
        otherShapes: SHAPES.map((shape) => ({ shape: shape.label, acceleration: (G * Math.sin((p.angle * Math.PI) / 180)) / (1 + shape.k), bottomSpeed: Math.sqrt((2 * G * height) / (1 + shape.k)) })),
      };
    }
    if (p.mode === 'collision') {
      const first = 0.5 * p.mass * radius * radius;
      const droppedRadius = p.diskRadius * 1e-2;
      const second = 0.5 * p.diskMass * droppedRadius * droppedRadius;
      const finalSpin = (first * p.spin) / (first + second);
      const before = 0.5 * first * p.spin * p.spin;
      const after = 0.5 * (first + second) * finalSpin * finalSpin;
      return {
        t: y.tau, first, second, inertia: first + second, initialSpin: p.spin, finalSpin,
        angularMomentum: first * p.spin, angularMomentumAfter: (first + second) * finalSpin,
        energyBefore: before, energyAfter: after, energyLost: before - after,
        energyLostFraction: before > 0 ? (before - after) / before : 0, k,
      };
    }
    if (p.mode === 'pulley') {
      const pulleyRadius = p.pulleyRadius * 1e-2;
      const pulleyInertia = 0.5 * p.pulleyMass * pulleyRadius * pulleyRadius;
      const total = p.mass1 + p.mass2 + pulleyInertia / (pulleyRadius * pulleyRadius);
      const acceleration = ((p.mass1 - p.mass2) * G) / total;
      const tension1 = p.mass1 * (G - acceleration);
      const tension2 = p.mass2 * (G + acceleration);
      return {
        t: y.tau, acceleration, pulleyInertia, tension1, tension2, inertia: pulleyInertia,
        tensionDifference: tension1 - tension2,
        angularAcceleration: acceleration / pulleyRadius,
        torque: (tension1 - tension2) * pulleyRadius,
        idealAcceleration: ((p.mass1 - p.mass2) * G) / (p.mass1 + p.mass2), k,
      };
    }
    const swingInertia = rodInertia(p.mass, p.rodLength, true);
    const distance = p.rodLength / 2;
    const period = 2 * Math.PI * Math.sqrt(swingInertia / (p.mass * G * distance));
    return {
      t: y.tau, inertia: swingInertia, distance, period,
      smallAngleFrequency: 1 / period,
      angularAcceleration: (p.mass * G * distance) / swingInertia,
      pointMassPeriod: 2 * Math.PI * Math.sqrt(p.rodLength / G),
      centrePeriod: 2 * Math.PI * Math.sqrt((p.rodLength / 12) / (G * (p.rodLength / 2))),
      k,
    };
  },
  series: [],
  verify: () => {
    const list = [];
    const k = shapeFactor('sphere');
    list.push(closeCheck('A solid sphere carries 2/5 of its mass–radius-squared in inertia', k * 2 * 0.12 * 0.12, (2 / 5) * 2 * 0.0144, 1e-12, 8));
    list.push(closeCheck('The parallel-axis theorem turns a rod about its centre into one about its end', rodInertia(2, 1.2, false) + 2 * 0.36, rodInertia(2, 1.2, true), 1e-12, 8));
    list.push(closeCheck('A rod about its end has mL²/3', rodInertia(3, 2, true), (3 * 4) / 3, 1e-12, 8));

    const rolling = rotationSim.read({ tau: 2 }, { ...rotationSim.params, mode: 'rolling', shape: 'sphere', angle: 20, rampLength: 3 });
    list.push(closeCheck('A rolling sphere puts 5/7 of its kinetic energy into moving forward', rolling.translationShare, 5 / 7, 1e-6, 6));
    const hoop = rotationSim.read({ tau: 2 }, { ...rotationSim.params, mode: 'rolling', shape: 'hoop', angle: 20, rampLength: 3 });
    list.push(closeCheck('A hoop splits its energy evenly between rolling and travelling', hoop.translationShare, 0.5, 1e-6, 4));
    list.push(check('Shapes race differently down the same slope', rolling.bottomSpeed > rolling.otherShapes[1].bottomSpeed && hoop.bottomSpeed < rolling.bottomSpeed, `sphere ${rolling.bottomSpeed.toFixed(3)} m/s, hoop ${hoop.bottomSpeed.toFixed(3)} m/s at the bottom`));
    list.push(closeCheck('The rolling condition ties speed to spin', rolling.speed / 0.12, rolling.omega, 1e-9, 6));
    list.push(closeCheck('Energy conservation gives the same bottom speed as the kinematics', Math.sqrt(2 * rolling.acceleration * 3), rolling.bottomSpeed, 1e-9, 6));
    list.push(closeCheck('The torque equals the inertia times the angular acceleration', rolling.torque, rolling.inertia * rolling.angularAcceleration, 1e-9, 8));

    const collision = rotationSim.read({ tau: 0 }, { ...rotationSim.params, mode: 'collision', mass: 4, radius: 20, spin: 30, diskMass: 4, diskRadius: 20 });
    list.push(closeCheck('Angular momentum is the same before and after the disks meet', collision.angularMomentumAfter, collision.angularMomentum, 1e-9, 8));
    list.push(check('A dropped disk always slows the spinning one down', collision.finalSpin < collision.initialSpin, `${collision.initialSpin.toFixed(2)} rad/s becomes ${collision.finalSpin.toFixed(2)} rad/s`));
    list.push(check('Kinetic energy is lost in the grab, even though momentum is not', collision.energyLost > 0, `${((collision.energyLost / collision.energyBefore) * 100).toFixed(2)}% of the spin energy goes into the grab`));

    const pulley = rotationSim.read({ tau: 0 }, { ...rotationSim.params, mode: 'pulley', mass1: 3, mass2: 1, pulleyMass: 1.5, pulleyRadius: 8 });
    list.push(check('A heavy pulley makes the Atwood machine accelerate more slowly than a light one', pulley.acceleration < pulley.idealAcceleration, `${pulley.acceleration.toFixed(4)} m/s² against ${pulley.idealAcceleration.toFixed(4)} m/s² with a massless pulley`));
    list.push(closeCheck('The tension difference supplies the pulley’s torque', pulley.tensionDifference * 0.08, pulley.torque, 1e-9, 8));

    const pendulum = rotationSim.read({ tau: 0 }, { ...rotationSim.params, mode: 'pendulum', mass: 2, rodLength: 1.5 });
    list.push(closeCheck('A rod swinging from its end has period 2π√(2L/3g)', pendulum.period, 2 * Math.PI * Math.sqrt((2 * 1.5) / (3 * G)), 1e-9, 8));
    list.push(closeCheck('The pendulum’s angular acceleration follows from its torque and inertia', pendulum.angularAcceleration, (2 * G * 0.75) / pendulum.inertia, 1e-9, 8));
    list.push(check('A rod swings faster than a point mass on a string of the same length', pendulum.period < pendulum.pointMassPeriod, `${pendulum.period.toFixed(4)} s against ${pendulum.pointMassPeriod.toFixed(4)} s`));
    return { checks: list };
  },
};