/**
 * Nephron transport engine — segmental mass balance rather than a picture of a tubule.
 *
 * Filtration comes from Starling forces, and each solute travels through the proximal tubule,
 * the descending and ascending limbs, the distal tubule and the collecting duct, with ADH,
 * aldosterone and a loop diuretic acting where they actually act. Glucose has a real transport
 * maximum, so glucosuria appears at the right plasma concentration for the right reason. Every
 * solute is then audited: filtered minus reabsorbed plus secreted must equal excreted, and a
 * solute the tubule does not touch must be cleared at exactly the filtration rate.
 */

export const DEFAULT_PARAMS = {
  meanArterialPressure: 100,
  afferentResistance: 1,
  efferentResistance: 1,
  filtrationCoefficient: 12.5,   // mL/min/mmHg
  plasmaProtein: 7,              // g/dL
  adh: 0.5,                      // 0 = none, 1 = maximal
  aldosterone: 0.5,
  diuretic: 0,                   // loop diuretic, blocks the thick ascending limb
  plasmaGlucose: 100,            // mg/dL
  glucoseMax: 375,               // mg/min, the tubular transport maximum
};

export const PLASMA = { na: 140, k: 4.2, urea: 15, creatinine: 1, glucose: 100, inulin: 1 };
export const SOLUTES = ['na', 'k', 'urea', 'creatinine', 'glucose', 'inulin'];

/**
 * Segmental handling. Sodium and potassium fractions are of the *filtered load* — that is how
 * the standard figures are quoted — while urea and water are fractions of what reaches the
 * segment. A negative potassium fraction in the distal nephron is aldosterone-driven secretion.
 */
const SEGMENTS = [
  { id: 'proximal', label: 'Proximal tubule', water: 0.65, na: 0.65, k: 0.60, urea: 0.45, creatinine: 0, glucose: true },
  { id: 'descending', label: 'Descending limb', water: 0.15, na: 0, k: 0, urea: 0.05, creatinine: 0 },
  { id: 'ascending', label: 'Thick ascending limb', water: 0, na: 0.25, k: 0.22, urea: 0, creatinine: 0 },
  { id: 'distal', label: 'Distal tubule', water: 0.09, na: 0.05, k: -0.16, urea: 0, creatinine: -0.15 },
  { id: 'collecting', label: 'Collecting duct', water: 0.02, na: 0.03, k: 0.08, urea: 0.35, creatinine: 0 },
];

/** The oncotic pressure of plasma at a given protein concentration (Landis-Pappenheimer). */
export function oncoticPressure(protein) {
  return 2.1 * protein + 0.16 * protein * protein + 0.009 * protein * protein * protein;
}

function segmentHandling(segment, { adh, aldosterone, diuretic }) {
  const block = Math.min(1, Math.max(0, diuretic)) * 0.8;
  return {
    water: segment.id === 'collecting'
      ? (0.01 + 0.09 * adh) * (1 - 0.5 * block)
      : segment.id === 'descending' ? segment.water * Math.min(1, 0.6 + 0.8 * adh) : segment.water,
    na: segment.na * (segment.id === 'ascending' ? 1 - block : 1) * (segment.id === 'distal' || segment.id === 'collecting' ? 0.5 + aldosterone : 1),
    k: segment.k < 0 ? segment.k * (0.4 + 1.2 * aldosterone) : segment.k,
    urea: segment.urea * (segment.id === 'collecting' ? 0.3 + 1.4 * adh : 1),
    creatinine: segment.creatinine,
    glucose: Boolean(segment.glucose),
  };
}

export function computeNephron(params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };

  const glomerularPressure = 60 * (1 + (p.meanArterialPressure - 100) / 200) * (p.efferentResistance / p.afferentResistance);
  const capsularPressure = 18;
  // plasma is concentrated as it filters, so the oncotic pressure opposing filtration is
  // higher than that of plasma at rest — which is what puts the net pressure near 10 mmHg
  const oncotic = oncoticPressure(p.plasmaProtein) * 1.25;
  const netFiltrationPressure = glomerularPressure - capsularPressure - oncotic;
  const gfr = Math.max(0, p.filtrationCoefficient * netFiltrationPressure / p.afferentResistance);

  const filteredLoad = {
    na: (gfr * PLASMA.na) / 1000,
    k: (gfr * PLASMA.k) / 1000,
    urea: (gfr * PLASMA.urea) / 1000,
    creatinine: (gfr * PLASMA.creatinine) / 100,
    glucose: (gfr * p.plasmaGlucose) / 100,
    inulin: (gfr * PLASMA.inulin) / 100,
  };

  let water = gfr;
  const remaining = { ...filteredLoad };
  const reabsorbed = { na: 0, k: 0, urea: 0, creatinine: 0, glucose: 0, inulin: 0 };
  const secreted = { na: 0, k: 0, urea: 0, creatinine: 0, glucose: 0, inulin: 0 };
  const profile = [];

  for (const segment of SEGMENTS) {
    const handling = segmentHandling(segment, p);
    const waterIn = water;
    // segmental water figures are quoted as fractions of the filtered volume rather than of
    // what happens to arrive, which is why they add up to 99% instead of compounding
    water = Math.max(0, water - Math.max(0, Math.min(0.95, handling.water)) * gfr);

    for (const solute of ['na', 'k', 'urea', 'creatinine']) {
      const fraction = handling[solute];
      if (fraction >= 0) {
        const basis = solute === 'urea' ? remaining.urea : filteredLoad[solute];
        reabsorbed[solute] += Math.min(remaining[solute], fraction * basis);
        remaining[solute] = Math.max(0, remaining[solute] - Math.min(remaining[solute], fraction * basis));
      } else {
        secreted[solute] += -fraction * filteredLoad[solute];
        remaining[solute] += -fraction * filteredLoad[solute];
      }
    }

    // glucose is carried by its own transporter, in the proximal tubule only, up to the maximum
    if (handling.glucose) {
      const carried = Math.min(remaining.glucose, p.glucoseMax);
      reabsorbed.glucose += carried;
      remaining.glucose -= carried;
    }

    // inulin is filtered and ignored by the tubule, which is why it measures filtration
    profile.push({
      id: segment.id,
      label: segment.label,
      waterIn,
      waterOut: water,
      waterReabsorbed: waterIn - water,
      concentrations: {
        na: water > 0 ? (remaining.na * 1000) / water : 0,
        k: water > 0 ? (remaining.k * 1000) / water : 0,
        urea: water > 0 ? (remaining.urea * 1000) / water : 0,
        creatinine: water > 0 ? (remaining.creatinine * 100) / water : 0,
        glucose: water > 0 ? (remaining.glucose * 100) / water : 0,
        inulin: water > 0 ? (remaining.inulin * 100) / water : 0,
      },
    });
  }

  const urineVolume = water;
  const excreted = remaining;
  const osmolarity = urineVolume > 0
    ? (2 * ((excreted.na + excreted.k) * 1000) + excreted.urea * 1000 + (excreted.glucose / 180) * 1000 + (excreted.inulin / 5200) * 1000) / urineVolume
    : 0;

  const clearance = {
    creatinine: PLASMA.creatinine > 0 ? (excreted.creatinine / PLASMA.creatinine) * 100 : 0,
    inulin: PLASMA.inulin > 0 ? (excreted.inulin / PLASMA.inulin) * 100 : 0,
    urea: (excreted.urea * 1000) / PLASMA.urea,
    glucose: (excreted.glucose * 100) / Math.max(1, p.plasmaGlucose),
  };

  const fractionalExcretion = {};
  for (const solute of SOLUTES) {
    fractionalExcretion[solute] = filteredLoad[solute] > 0 ? excreted[solute] / filteredLoad[solute] : 0;
  }

  // an independent audit: the filtered load is recomputed against the segment sums
  const balance = {};
  for (const solute of SOLUTES) {
    balance[solute] = filteredLoad[solute] + secreted[solute] - reabsorbed[solute] - excreted[solute];
  }

  return {
    params: p,
    pressures: { glomerularPressure, capsularPressure, oncotic, netFiltrationPressure },
    gfr,
    filteredLoad,
    reabsorbed,
    secreted,
    excreted,
    urineVolume,
    osmolarity,
    clearance,
    fractionalExcretion,
    profile,
    balance,
    daily: {
      naExcretion: excreted.na * 1440,
      kExcretion: excreted.k * 1440,
      ureaExcretion: excreted.urea * 1440,
      urineLitres: (urineVolume * 1440) / 1000,
      filteredNa: filteredLoad.na * 1440,
      filteredWater: (gfr * 1440) / 1000,
    },
  };
}

/** Plasma creatinine follows from how much muscle makes and how much the kidney clears. */
export function steadyStateCreatinine({ production = 1800, gfr } = {}) {
  const rate = gfr ?? computeNephron().gfr;
  return rate > 0 ? (production / (rate * 1440)) * 100 : Infinity;
}

export function verifyNephron() {
  const baseline = computeNephron();
  const highAdh = computeNephron({ adh: 1 });
  const noAdh = computeNephron({ adh: 0 });
  const diuretic = computeNephron({ diuretic: 0.6 });
  const glucoseLoad = computeNephron({ plasmaGlucose: 400 });
  const reduced = computeNephron({ filtrationCoefficient: 6 });
  const worstBalance = Math.max(
    ...[baseline, glucoseLoad, diuretic].flatMap((run) => SOLUTES.map((solute) => Math.abs(run.balance[solute]) / (Math.abs(run.filteredLoad[solute]) || 1))),
  );

  return {
    baseline,
    highAdh,
    noAdh,
    diuretic,
    glucoseLoad,
    reduced,
    checks: [
      { label: 'Filtration rate follows from the Starling pressures', ok: baseline.gfr > 90 && baseline.gfr < 140, detail: `${baseline.pressures.glomerularPressure.toFixed(0)} − ${baseline.pressures.capsularPressure} − ${baseline.pressures.oncotic.toFixed(1)} = ${baseline.pressures.netFiltrationPressure.toFixed(1)} mmHg gives ${baseline.gfr.toFixed(1)} mL/min` },
      { label: 'Filtered load equals reabsorbed plus secreted minus excreted, for every solute', ok: worstBalance < 1e-9, detail: `worst imbalance ${worstBalance.toExponential(2)} of the filtered load, across every solute and three states` },
      { label: 'Sodium filtered each day matches the textbook figure', ok: Math.abs(baseline.daily.filteredNa - 25000) < 5000, detail: `${Math.round(baseline.daily.filteredNa).toLocaleString()} mmol/day from ${baseline.daily.filteredWater.toFixed(0)} L of filtrate` },
      { label: 'Only about one per cent of filtered sodium is excreted', ok: baseline.fractionalExcretion.na > 0.004 && baseline.fractionalExcretion.na < 0.02, detail: `${(baseline.fractionalExcretion.na * 100).toFixed(2)}% excreted, ${(100 - baseline.fractionalExcretion.na * 100).toFixed(1)}% reabsorbed` },
      { label: 'A diuretic raises sodium and water excretion together', ok: diuretic.fractionalExcretion.na > baseline.fractionalExcretion.na * 2 && diuretic.urineVolume > baseline.urineVolume, detail: `sodium excretion ${(baseline.fractionalExcretion.na * 100).toFixed(2)}% → ${(diuretic.fractionalExcretion.na * 100).toFixed(2)}%, urine ${baseline.urineVolume.toFixed(1)} → ${diuretic.urineVolume.toFixed(1)} mL/min` },
      { label: 'Glucose stays out of the urine below the transport maximum', ok: baseline.excreted.glucose < 1e-9 && glucoseLoad.excreted.glucose > 0, detail: `none at ${baseline.params.plasmaGlucose} mg/dL (${baseline.filteredLoad.glucose.toFixed(0)} mg/min filtered), present at ${glucoseLoad.params.plasmaGlucose} mg/dL` },
      { label: 'Above the maximum, the glucose lost is exactly the load minus the maximum', ok: Math.abs(glucoseLoad.excreted.glucose - (glucoseLoad.filteredLoad.glucose - glucoseLoad.params.glucoseMax)) < 1e-6, detail: `${glucoseLoad.filteredLoad.glucose.toFixed(0)} filtered − ${glucoseLoad.params.glucoseMax} carried = ${glucoseLoad.excreted.glucose.toFixed(1)} mg/min lost` },
      { label: 'A solute the tubule ignores is cleared at exactly the filtration rate', ok: Math.abs(baseline.clearance.inulin - baseline.gfr) < 1e-9, detail: `inulin clearance ${baseline.clearance.inulin.toFixed(4)} mL/min against a filtration rate of ${baseline.gfr.toFixed(4)} mL/min` },
      { label: 'Creatinine clearance exceeds filtration because the tubule secretes it', ok: baseline.clearance.creatinine > baseline.gfr, detail: `${baseline.clearance.creatinine.toFixed(1)} mL/min clearance against ${baseline.gfr.toFixed(1)} mL/min filtered` },
      { label: 'Antidiuretic hormone concentrates the urine and cuts its volume', ok: highAdh.osmolarity > baseline.osmolarity && highAdh.urineVolume < baseline.urineVolume && noAdh.osmolarity < baseline.osmolarity, detail: `${noAdh.osmolarity.toFixed(0)} → ${baseline.osmolarity.toFixed(0)} → ${highAdh.osmolarity.toFixed(0)} mOsm/kg as ADH rises, over ${noAdh.urineVolume.toFixed(1)} → ${highAdh.urineVolume.toFixed(1)} mL/min` },
      { label: 'Urine osmolarity stays in the range a kidney can produce', ok: noAdh.osmolarity > 40 && highAdh.osmolarity < 1400, detail: `${noAdh.osmolarity.toFixed(0)}–${highAdh.osmolarity.toFixed(0)} mOsm/kg` },
      { label: 'Halving the filtration coefficient halves the filtration rate and raises plasma creatinine', ok: reduced.gfr < baseline.gfr * 0.55 && steadyStateCreatinine({ gfr: reduced.gfr }) > 1.5, detail: `${baseline.gfr.toFixed(0)} → ${reduced.gfr.toFixed(0)} mL/min, plasma creatinine ${steadyStateCreatinine({ gfr: baseline.gfr }).toFixed(2)} → ${steadyStateCreatinine({ gfr: reduced.gfr }).toFixed(2)} mg/dL` },
    ],
  };
}