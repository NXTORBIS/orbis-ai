const TAU = Math.PI * 2;

export const MODES = {
  'ring-fixed': 'Ring fixed',
  'sun-fixed': 'Sun fixed',
  'carrier-fixed': 'Carrier fixed',
  'two-input': 'Two inputs',
};

const RPM_TO_RAD = TAU / 60;

export function gearGeometry(p) {
  const module = Number(p.module) || 2;
  const sun = (module * p.sun) / 2;
  const planet = (module * p.planet) / 2;
  return { module, sun, planet, ring: sun + 2 * planet, ringTeeth: p.sun + 2 * p.planet };
}

/**
 * Solve the gear set from its driven members. Speeds are rpm, positive in the same
 * direction; the missing member follows from the Willis equation
 * Ns·ωs + Nr·ωr = (Ns + Nr)·ωc, and the planet spin from roll without slip at the sun mesh.
 */
export function planetarySolution(p) {
  const teeth = { sun: p.sun, planet: p.planet, ring: p.sun + 2 * p.planet };
  const speed = { sunSpeed: p.sunSpeed, ringSpeed: p.ringSpeed, carrierSpeed: p.carrierSpeed };
  let modeNote = '';
  let ratio = 1;

  if (p.mode === 'ring-fixed') {
    speed.ringSpeed = 0;
    speed.carrierSpeed = (speed.sunSpeed * teeth.sun) / (teeth.sun + teeth.ring);
    ratio = speed.carrierSpeed ? speed.sunSpeed / speed.carrierSpeed : 1;
    modeNote = 'Ring held: the carrier turns Ns/(Ns+Nr) of the sun — a simple reduction.';
  } else if (p.mode === 'sun-fixed') {
    speed.sunSpeed = 0;
    speed.carrierSpeed = (speed.ringSpeed * teeth.ring) / (teeth.sun + teeth.ring);
    ratio = speed.carrierSpeed ? speed.ringSpeed / speed.carrierSpeed : 1;
    modeNote = 'Sun held: the carrier takes Nr/(Ns+Nr) of the ring speed.';
  } else if (p.mode === 'carrier-fixed') {
    speed.carrierSpeed = 0;
    speed.ringSpeed = -(speed.sunSpeed * teeth.sun) / teeth.ring;
    ratio = speed.ringSpeed ? speed.sunSpeed / speed.ringSpeed : 1;
    modeNote = 'Carrier held: sun and ring counter-rotate at −Nr/Ns.';
  } else {
    speed.carrierSpeed = (speed.sunSpeed * teeth.sun + speed.ringSpeed * teeth.ring) / (teeth.sun + teeth.ring);
    ratio = speed.carrierSpeed ? speed.sunSpeed / speed.carrierSpeed : 1;
    modeNote = 'Both sun and ring driven: the carrier speed is their tooth-weighted mean — a differential.';
  }

  const sunRad = speed.sunSpeed * RPM_TO_RAD;
  const ringRad = speed.ringSpeed * RPM_TO_RAD;
  const carrierRad = speed.carrierSpeed * RPM_TO_RAD;
  const planetRel = -((sunRad - carrierRad) * teeth.sun) / teeth.planet;
  const planetAbs = carrierRad + planetRel;

  const efficiency = Math.max(0.5, Math.min(1, p.efficiency / 100));
  const scale = p.inputTorque / teeth.sun;
  const sunTorque = scale * teeth.sun;
  const ringTorque = scale * teeth.ring;
  const carrierTorque = -scale * (teeth.sun + teeth.ring);

  const pitch = gearGeometry(p);
  const relative = Math.abs(sunRad - carrierRad);
  const assemblyValue = (teeth.sun + teeth.ring) / p.planets;
  const centreDistance = pitch.sun + pitch.planet;

  return {
    teeth, mode: p.mode, modeNote, ratio: Math.abs(ratio) < 1e-12 ? 1 : ratio,
    sunSpeed: speed.sunSpeed, ringSpeed: speed.ringSpeed, carrierSpeed: speed.carrierSpeed,
    sunRad, ringRad, carrierRad, planetRel, planetAbs,
    planetRpm: planetAbs / RPM_TO_RAD, planetRelRpm: planetRel / RPM_TO_RAD,
    outputRpm: Math.abs(carrierRad) / RPM_TO_RAD,
    meshHz: (teeth.sun * relative) / TAU,
    pitch,
    pitchSpeed: {
      sun: Math.abs(sunRad) * (pitch.sun / 1000),
      ring: Math.abs(ringRad) * (pitch.ring / 1000),
      planet: Math.abs(planetAbs) * (pitch.planet / 1000),
    },
    assembly: {
      value: assemblyValue,
      ok: Math.abs(assemblyValue - Math.round(assemblyValue)) < 1e-9,
      adjacent: centreDistance * Math.sin(Math.PI / p.planets) >= pitch.planet - 1e-9,
    },
    sunTorque, ringTorque, carrierTorque,
    outputTorque: Math.abs(carrierTorque) * efficiency,
    wilis: speed.sunSpeed * teeth.sun + speed.ringSpeed * teeth.ring - (teeth.sun + teeth.ring) * speed.carrierSpeed,
    inputPower: Math.abs((sunTorque * sunRad + ringTorque * ringRad) * (p.mode === 'two-input' ? 0.5 : 1)),
  };
}

/** Accumulate the visible rotation of each member at the solved rates. */
export function spinMembers(y, dt, p) {
  const s = planetarySolution(p);
  y.sunAngle += s.sunRad * dt;
  y.ringAngle += s.ringRad * dt;
  y.carrierAngle += s.carrierRad * dt;
  y.planetAngle += s.planetAbs * dt;
  return y;
}

function verifyPlanetary() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });
  const base = { sun: 12, planet: 15, planets: 3, mode: 'ring-fixed', sunSpeed: 1500, ringSpeed: 0, carrierSpeed: 0, inputTorque: 40, efficiency: 97, module: 2 };

  const ringFixed = planetarySolution({ ...base, mode: 'ring-fixed' });
  push('Ring fixed reproduces 1 + Nr/Ns', Math.abs(Math.abs(ringFixed.ratio) - (1 + (2 * base.planet + base.sun) / base.sun)) < 1e-9, `${Math.abs(ringFixed.ratio).toFixed(6)}`);

  const carrierFixed = planetarySolution({ ...base, mode: 'carrier-fixed' });
  push('Carrier fixed reproduces −Nr/Ns', Math.abs(carrierFixed.ratio + (2 * base.planet + base.sun) / base.sun) < 1e-9, `${carrierFixed.ratio.toFixed(6)}`);

  const sunFixed = planetarySolution({ ...base, mode: 'sun-fixed', ringSpeed: 1200 });
  push('Sun fixed reproduces 1 + Ns/Nr', Math.abs(sunFixed.ratio - (1 + base.sun / (2 * base.planet + base.sun))) < 1e-9, `${sunFixed.ratio.toFixed(6)}`);

  const s = ringFixed;
  push('Willis equation closes exactly on the solved speeds', Math.abs(s.wilis) < 1e-9, `residual ${s.wilis.toExponential(2)} rpm·teeth`);

  const sunContact = Math.abs((s.sunRad - s.carrierRad) * (s.pitch.sun / 1000));
  const planetContact = Math.abs(s.planetRel * (s.pitch.planet / 1000));
  const ringContact = Math.abs((s.ringRad - s.carrierRad) * (s.pitch.ring / 1000));
  push('Roll without slip at the sun mesh', Math.abs(sunContact - planetContact) < 1e-12, `${sunContact.toFixed(6)} vs ${planetContact.toFixed(6)} m/s`);
  push('Roll without slip at the ring mesh', Math.abs(ringContact - planetContact) < 1e-12, `${ringContact.toFixed(6)} vs ${planetContact.toFixed(6)} m/s`);

  push('Torque split sums to zero', Math.abs(s.sunTorque + s.ringTorque + s.carrierTorque) < 1e-9, `${(s.sunTorque + s.ringTorque + s.carrierTorque).toExponential(2)} N·m`);
  push('Ideal power balance closes with the ring held', Math.abs(s.sunTorque * s.sunRad + s.carrierTorque * s.carrierRad) < 1e-9, `${(s.sunTorque * s.sunRad + s.carrierTorque * s.carrierRad).toExponential(2)} W`);

  const bad = planetarySolution({ ...base, planets: 5 });
  push('Assembly condition is evaluated, not assumed', bad.assembly.ok === false, `(Ns+Nr)/5 = ${bad.assembly.value.toFixed(3)} is not a whole number, so five planets will not index`);

  const adjacent = planetarySolution({ ...base, planets: 6, planet: 15 });
  push('Adjacency check catches planets that would overlap', adjacent.assembly.adjacent === false, `six 15-tooth planets would collide on a 12-tooth sun even though the assembly condition passes`);

  const differential = planetarySolution({ ...base, mode: 'two-input', sunSpeed: 1000, ringSpeed: -1000 });
  const expectedCarrier = (1000 * base.sun - 1000 * (base.sun + 2 * base.planet)) / (2 * base.sun + 2 * base.planet);
  push('Two-input differential matches the tooth-weighted mean', Math.abs(differential.carrierSpeed - expectedCarrier) < 1e-9, `${differential.carrierSpeed.toFixed(4)} vs ${expectedCarrier.toFixed(4)} rpm`);

  const geometry = gearGeometry({ ...base, module: 2 });
  push('Ring teeth equal Ns + 2·Np and radii follow the module', geometry.ringTeeth === base.sun + 2 * base.planet && Math.abs(geometry.ring - (geometry.sun + 2 * geometry.planet)) < 1e-12, `module 2 mm · ring ${geometry.ring.toFixed(2)} mm`);

  return { checks };
}

export const planetaryVerify = verifyPlanetary;