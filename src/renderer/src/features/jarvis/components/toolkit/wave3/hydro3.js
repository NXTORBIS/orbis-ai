import { defineTool, numberField, choiceField, metric, samples } from '@jarvis/components/toolkit/science50/model';

const D = defineTool, F = numberField, C = choiceField, M = metric;

const AQI_BANDS = {
  pm25: [[0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500]],
  pm10: [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150], [255, 354, 151, 200], [355, 424, 201, 300], [425, 604, 301, 500]],
  ozone: [[0, 54, 0, 50], [55, 70, 51, 100], [71, 85, 101, 150], [86, 105, 151, 200], [106, 200, 201, 300]],
  no2: [[0, 53, 0, 50], [54, 100, 51, 100], [101, 360, 101, 150], [361, 649, 151, 200], [650, 1249, 201, 300], [1250, 2049, 301, 500]],
};

const subIndex = (pollutant, concentration) => {
  const bands = AQI_BANDS[pollutant];
  const value = Math.max(0, concentration);
  for (const [low, high, indexLow, indexHigh] of bands) {
    if (value <= high) return ((indexHigh - indexLow) / (high - low)) * (value - low) + indexLow;
  }
  return 500;
};

export const hydroTools = [
  D({
    id: 'rational-runoff', title: 'Rational Method Runoff', tone: 'cyan',
    desc: 'Peak storm flow, runoff volume and effective rainfall depth from a catchment.',
    fields: [F('runoff_coefficient', 'Runoff coefficient C', 0.5, 0.02, 1), F('rainfall_intensity_mm_h', 'Rainfall intensity (mm/h)', 50, 0.5, 500), F('area_ha', 'Catchment area (ha)', 10, 0.05, 20000), F('storm_duration_min', 'Storm duration (min)', 30, 1, 1440)],
    sweep: 'rainfall_intensity_mm_h',
    scenarios: [{ label: '10 ha suburban', input: { runoff_coefficient: 0.5, rainfall_intensity_mm_h: 50, area_ha: 10, storm_duration_min: 30 } }, { label: 'Catchment doubled', input: { runoff_coefficient: 0.5, rainfall_intensity_mm_h: 50, area_ha: 20, storm_duration_min: 30 } }, { label: 'Paved, C 0.9', input: { runoff_coefficient: 0.9, rainfall_intensity_mm_h: 50, area_ha: 10, storm_duration_min: 30 } }, { label: 'Design storm 1 in 100', input: { runoff_coefficient: 0.7, rainfall_intensity_mm_h: 120, area_ha: 45, storm_duration_min: 60 } }],
    equation: 'Q = C i A/360  (m³/s, mm/h, ha)   ·   V = Q·t   ·   runoff depth = C·i·t',
    note: 'Rational method for small urban catchments, always paired with a design duration equal to the time of concentration.',
    calculate: (p) => {
      const peak = (p.runoff_coefficient * p.rainfall_intensity_mm_h * p.area_ha) / 360;
      const seconds = p.storm_duration_min * 60;
      const depth = (p.runoff_coefficient * p.rainfall_intensity_mm_h * p.storm_duration_min) / 60;
      return {
        primary: M('Peak runoff', peak, 'm³/s'),
        metrics: [M('Peak runoff', peak * 1000, 'L/s'), M('Runoff volume', peak * seconds, 'm³'), M('Effective rainfall depth', depth, 'mm'), M('Catchment area', p.area_ha * 1e4, 'm²'), M('Equivalent impervious cover', (p.runoff_coefficient * 100), '%'), M('Volume per hectare', (depth * 10), 'm³/ha')],
        status: `${(peak * 1000).toFixed(0)} litres per second at peak.`,
      };
    },
    references: [
      { label: 'C 0.5, 50 mm/h over 10 ha → 0.694 m³/s', input: { runoff_coefficient: 0.5, rainfall_intensity_mm_h: 50, area_ha: 10, storm_duration_min: 30 }, expected: (0.5 * 50 * 10) / 360, tolerance: 1e-12 },
      { label: 'Doubling the catchment doubles the flow', input: { runoff_coefficient: 0.5, rainfall_intensity_mm_h: 50, area_ha: 20, storm_duration_min: 30 }, expected: (0.5 * 50 * 20) / 360, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'solar-pv-yield', title: 'Solar PV Yield & Payback', tone: 'amber',
    desc: 'Daily and annual generation, bill savings, carbon avoided and the simple payback period.',
    fields: [F('capacity_kwp', 'Array size (kWp)', 5, 0.1, 100000), F('peak_sun_hours', 'Peak sun hours (h/day)', 4.5, 0.1, 10), F('performance_ratio', 'Performance ratio', 0.8, 0.3, 1), F('tariff_per_kwh', 'Electricity price per kWh', 0.15, 0, 10), F('co2_factor_kg_kwh', 'Grid carbon factor (kg/kWh)', 0.4, 0, 1.5), F('installed_cost', 'Installed cost', 5000, 0, 1e8)],
    sweep: 'peak_sun_hours',
    scenarios: [{ label: '5 kWp home', input: { capacity_kwp: 5, peak_sun_hours: 4.5, performance_ratio: 0.8, tariff_per_kwh: 0.15, installed_cost: 5000 } }, { label: 'Sunny 5.8 PSH', input: { capacity_kwp: 5, peak_sun_hours: 5.8, performance_ratio: 0.8, tariff_per_kwh: 0.15, installed_cost: 5000 } }, { label: 'Cloudy 2.8 PSH', input: { capacity_kwp: 5, peak_sun_hours: 2.8, performance_ratio: 0.75, tariff_per_kwh: 0.2, installed_cost: 5000 } }, { label: 'Rooftop 50 kWp', input: { capacity_kwp: 50, peak_sun_hours: 4.5, performance_ratio: 0.82, tariff_per_kwh: 0.18, installed_cost: 45000 } }],
    equation: 'E_day = kWp × PSH × PR   ·   E_year = 365 E_day   ·   payback = cost/(E_year × tariff)',
    note: 'Simplified yield model driven by peak sun hours and a performance ratio. Shading, soiling, temperature derating and inverter clipping are bundled into PR.',
    calculate: (p) => {
      const daily = p.capacity_kwp * p.peak_sun_hours * p.performance_ratio;
      const annual = daily * 365;
      const savings = annual * p.tariff_per_kwh;
      return {
        primary: M('Annual generation', annual, 'kWh'),
        metrics: [M('Daily generation', daily, 'kWh'), M('Monthly average', annual / 12, 'kWh'), M('Annual bill saving', savings, ''), M('Carbon avoided', (annual * p.co2_factor_kg_kwh) / 1000, 't CO₂/yr'), M('Specific yield', annual / p.capacity_kwp, 'kWh/kWp'), M('Simple payback', p.installed_cost > 0 && savings > 0 ? p.installed_cost / savings : '—', 'years')],
        status: `About ${daily.toFixed(1)} kWh a day, ${(annual / 1000).toFixed(1)} MWh a year.`,
      };
    },
    references: [
      { label: '5 kWp at 4.5 PSH with PR 0.8 → 6 570 kWh/yr', input: { capacity_kwp: 5, peak_sun_hours: 4.5, performance_ratio: 0.8 }, expected: 5 * 4.5 * 0.8 * 365, tolerance: 1e-12 },
      { label: 'A performance ratio of 0.9 lifts it to 7 391 kWh', input: { capacity_kwp: 5, peak_sun_hours: 4.5, performance_ratio: 0.9 }, expected: 5 * 4.5 * 0.9 * 365, tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'wind-turbine-power', title: 'Wind Turbine Power Curve', tone: 'emerald',
    desc: 'Electrical power at a given wind speed, the Betz ceiling, and how much of the rating it uses.',
    fields: [F('rotor_diameter_m', 'Rotor diameter (m)', 90, 0.5, 250), F('wind_speed_ms', 'Wind speed (m/s)', 12, 0.5, 40), F('power_coefficient', 'Power coefficient C_p', 0.45, 0.01, 0.593), F('air_density', 'Air density (kg/m³)', 1.225, 0.5, 1.5), F('rated_power_kw', 'Rated power (kW)', 3000, 1, 25000), F('capacity_factor', 'Capacity factor', 0.35, 0.05, 0.7)],
    sweep: 'wind_speed_ms',
    scenarios: [{ label: '90 m rotor, 12 m/s', input: { rotor_diameter_m: 90, wind_speed_ms: 12, power_coefficient: 0.45, air_density: 1.225, rated_power_kw: 3000 } }, { label: 'Cut-in 5 m/s', input: { rotor_diameter_m: 90, wind_speed_ms: 5, power_coefficient: 0.45, air_density: 1.225, rated_power_kw: 3000 } }, { label: 'Rated wind 14 m/s', input: { rotor_diameter_m: 90, wind_speed_ms: 14, power_coefficient: 0.45, air_density: 1.225, rated_power_kw: 3000 } }, { label: 'Small 10 m rotor', input: { rotor_diameter_m: 10, wind_speed_ms: 9, power_coefficient: 0.35, air_density: 1.225, rated_power_kw: 20 } }, { label: 'High-altitude air 1.0 kg/m³', input: { rotor_diameter_m: 90, wind_speed_ms: 12, power_coefficient: 0.45, air_density: 1, rated_power_kw: 3000 } }],
    equation: 'P = ½ ρ A v³ C_p   ·   A = πD²/4   ·   Betz limit C_p = 16/27 ≈ 0.593',
    note: 'Aerodynamic power through the rotor disc; the nacelle’s electrical efficiency is inside C_p here. Real machines follow a measured power curve with cut-in and cut-out speeds.',
    calculate: (p) => {
      const area = (Math.PI * p.rotor_diameter_m ** 2) / 4;
      const available = 0.5 * p.air_density * area * p.wind_speed_ms ** 3;
      const electrical = (available * p.power_coefficient) / 1000;
      const capped = Math.min(electrical, p.rated_power_kw);
      return {
        primary: M('Electrical power', capped, 'kW'),
        metrics: [M('Available wind power', available / 1000, 'kW'), M('Betz limit power', (available * (16 / 27)) / 1000, 'kW'), M('Power coefficient', p.power_coefficient, ''), M('Share of Betz limit', (p.power_coefficient / (16 / 27)) * 100, '%'), M('Swept area', area, 'm²'), M('Capacity used', (capped / p.rated_power_kw) * 100, '%'), M('Annual energy at this capacity factor', (p.rated_power_kw * p.capacity_factor * 8760) / 1000, 'MWh')],
        status: electrical > p.rated_power_kw ? 'Above rated wind — the turbine would pitch back to hold rated power.' : `Delivering ${capped.toFixed(0)} kW at ${p.wind_speed_ms} m/s.`,
        warning: electrical > p.rated_power_kw ? 'Power is capped at the machine rating; the surplus is shed by pitch control.' : '',
      };
    },
    curve: (p) => {
      const x = samples(0, 30, 91);
      return {
        x,
        y: x.map((v) => Math.min((0.5 * p.air_density * ((Math.PI * p.rotor_diameter_m ** 2) / 4) * v ** 3 * p.power_coefficient) / 1000, p.rated_power_kw)),
        xLabel: 'Wind speed (m/s)', yLabel: 'Electrical power (kW)', unit: 'kW',
      };
    },
    references: [
      { label: '90 m rotor at 12 m/s with C_p 0.45 → 3 030 kW', input: { rotor_diameter_m: 90, wind_speed_ms: 12, power_coefficient: 0.45, air_density: 1.225, rated_power_kw: 20000 }, expected: (0.5 * 1.225 * ((Math.PI * 90 ** 2) / 4) * 12 ** 3 * 0.45) / 1000, tolerance: 1e-9 },
      { label: 'Cube law: 24 m/s gives eight times the power', input: { rotor_diameter_m: 90, wind_speed_ms: 24, power_coefficient: 0.45, air_density: 1.225, rated_power_kw: 100000 }, expected: (0.5 * 1.225 * ((Math.PI * 90 ** 2) / 4) * 24 ** 3 * 0.45) / 1000, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'river-pollutant-decay', title: 'River BOD/DO (Streeter–Phelps)', tone: 'cyan',
    desc: 'How a pollutant load decays downstream and how far the oxygen deficit reaches.',
    fields: [F('initial_bod_mg_l', 'Initial BOD (mg/L)', 20, 0.1, 500), F('decay_rate_per_day', 'BOD decay rate k (1/day)', 0.2, 0.001, 5), F('travel_time_days', 'Travel time (days)', 5, 0.001, 60), F('initial_do_deficit_mg_l', 'Initial DO deficit (mg/L)', 2, 0, 14), F('reaeration_rate_per_day', 'Reaeration rate k₂ (1/day)', 0.5, 0.001, 20), F('river_flow_m3s', 'River flow (m³/s)', 5, 0.001, 10000)],
    sweep: 'travel_time_days',
    scenarios: [{ label: '5 days of travel', input: { initial_bod_mg_l: 20, decay_rate_per_day: 0.2, travel_time_days: 5, reaeration_rate_per_day: 0.5 } }, { label: 'Slow river, 15 days', input: { initial_bod_mg_l: 20, decay_rate_per_day: 0.2, travel_time_days: 15, reaeration_rate_per_day: 0.5 } }, { label: 'Heavy load 40 mg/L', input: { initial_bod_mg_l: 40, decay_rate_per_day: 0.3, travel_time_days: 5, reaeration_rate_per_day: 0.5 } }, { label: 'Warm river, fast decay', input: { initial_bod_mg_l: 20, decay_rate_per_day: 0.6, travel_time_days: 5, reaeration_rate_per_day: 1.2 } }],
    equation: 'L(t) = L₀e^(−k t)   ·   D(t) = (kL₀/(k₂−k))(e^(−kt) − e^(−k₂t)) + D₀e^(−k₂t)   ·   DO = saturation − D',
    note: 'Classic first-order BOD decay with reaeration, constant temperature and no photosynthesis or sediment oxygen demand.',
    validate: (p) => (Math.abs(p.reaeration_rate_per_day - p.decay_rate_per_day) < 1e-9 ? 'Choose a reaeration rate different from the decay rate so the deficit expression stays finite.' : null),
    calculate: (p) => {
      const saturation = 9.1;
      const bod = p.initial_bod_mg_l * Math.exp(-p.decay_rate_per_day * p.travel_time_days);
      const k = p.decay_rate_per_day, k2 = p.reaeration_rate_per_day, t = p.travel_time_days, l0 = p.initial_bod_mg_l;
      const deficit = (k * l0 / (k2 - k)) * (Math.exp(-k * t) - Math.exp(-k2 * t)) + p.initial_do_deficit_mg_l * Math.exp(-k2 * t);
      const criticalTime = Math.log((k2 / k) * (1 - (p.initial_do_deficit_mg_l * (k2 - k)) / (k * l0))) / (k2 - k);
      const peak = Number.isFinite(criticalTime) && criticalTime > 0
        ? (k * l0 / (k2 - k)) * (Math.exp(-k * criticalTime) - Math.exp(-k2 * criticalTime)) + p.initial_do_deficit_mg_l * Math.exp(-k2 * criticalTime)
        : deficit;
      const doConcentration = saturation - deficit;
      return {
        primary: M('BOD after travel', bod, 'mg/L'),
        metrics: [M('BOD removed', (1 - bod / p.initial_bod_mg_l) * 100, '%'), M('DO deficit at arrival', deficit, 'mg/L'), M('Dissolved oxygen at arrival', doConcentration, 'mg/L'), M('Critical deficit', peak, 'mg/L'), M('Critical time downstream', criticalTime > 0 ? criticalTime : 0, 'days'), M('Oxygen demand load', p.river_flow_m3s * p.initial_bod_mg_l * 86.4, 'kg/day'), M('Water quality', doConcentration >= 5 ? 'Healthy for fish' : doConcentration >= 2 ? 'Stressed' : 'Hypoxic')],
        status: doConcentration >= 5 ? 'Oxygen stays comfortable for aquatic life.' : 'Oxygen sags below the fish-health threshold.',
      };
    },
    curve: (p) => {
      const x = samples(0, 30, 91);
      return { x, y: x.map((t) => p.initial_bod_mg_l * Math.exp(-p.decay_rate_per_day * t)), xLabel: 'Travel time (days)', yLabel: 'BOD (mg/L)', unit: 'mg/L' };
    },
    references: [
      { label: '20 mg/L with k 0.2/day after 5 days → 7.358 mg/L', input: { initial_bod_mg_l: 20, decay_rate_per_day: 0.2, travel_time_days: 5, reaeration_rate_per_day: 0.5, initial_do_deficit_mg_l: 2, river_flow_m3s: 5 }, expected: 20 * Math.exp(-0.2 * 5), tolerance: 1e-12 },
      { label: 'At the outfall no decay has happened yet → 20 mg/L', input: { initial_bod_mg_l: 20, decay_rate_per_day: 0.2, travel_time_days: 0.001, reaeration_rate_per_day: 0.5, initial_do_deficit_mg_l: 2, river_flow_m3s: 5 }, expected: 20 * Math.exp(-0.2 * 0.001), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'horton-infiltration', title: 'Horton Infiltration & Runoff', tone: 'emerald',
    desc: 'Infiltration capacity decaying with time, cumulative infiltration and the rainfall that becomes runoff.',
    fields: [F('initial_capacity_mm_h', 'Initial capacity f₀ (mm/h)', 100, 1, 600), F('final_capacity_mm_h', 'Final capacity f_c (mm/h)', 10, 0.1, 200), F('decay_constant_per_h', 'Decay constant k (1/h)', 2, 0.01, 30), F('rainfall_intensity_mm_h', 'Rainfall intensity (mm/h)', 60, 0.1, 400), F('duration_h', 'Storm duration (h)', 2, 0.05, 24)],
    sweep: 'rainfall_intensity_mm_h',
    scenarios: [{ label: '2 hour storm', input: { initial_capacity_mm_h: 100, final_capacity_mm_h: 10, decay_constant_per_h: 2, rainfall_intensity_mm_h: 60, duration_h: 2 } }, { label: 'Gentle 15 mm/h', input: { initial_capacity_mm_h: 100, final_capacity_mm_h: 10, decay_constant_per_h: 2, rainfall_intensity_mm_h: 15, duration_h: 2 } }, { label: 'Intense 150 mm/h', input: { initial_capacity_mm_h: 100, final_capacity_mm_h: 10, decay_constant_per_h: 2, rainfall_intensity_mm_h: 150, duration_h: 2 } }, { label: 'Sandy soil f₀ 250', input: { initial_capacity_mm_h: 250, final_capacity_mm_h: 40, decay_constant_per_h: 4, rainfall_intensity_mm_h: 60, duration_h: 2 } }],
    equation: 'f(t) = f_c + (f₀ − f_c)e^(−kt)   ·   F(t) = f_c t + (f₀ − f_c)(1 − e^(−kt))/k',
    note: 'Horton capacity curve with rainfall applied at a constant rate. Depression storage, interception and soil layering are treated separately.',
    calculate: (p) => {
      const integral = (from, to) => (p.final_capacity_mm_h * (to - from)) + ((p.initial_capacity_mm_h - p.final_capacity_mm_h) * (Math.exp(-p.decay_constant_per_h * from) - Math.exp(-p.decay_constant_per_h * to))) / p.decay_constant_per_h;
      const capacityAt = (t) => p.final_capacity_mm_h + (p.initial_capacity_mm_h - p.final_capacity_mm_h) * Math.exp(-p.decay_constant_per_h * t);
      const infiltration = integral(0, p.duration_h);
      const rain = p.rainfall_intensity_mm_h * p.duration_h;
      const panels = 400;
      const step = p.duration_h / panels;
      let runoff = 0;
      for (let index = 0; index < panels; index += 1) {
        const t = index * step;
        runoff += Math.max(0, p.rainfall_intensity_mm_h - capacityAt(t)) * step;
      }
      return {
        primary: M('Cumulative infiltration', infiltration, 'mm'),
        metrics: [M('Infiltration at the end of the storm', capacityAt(p.duration_h), 'mm/h'), M('Average infiltration rate', infiltration / p.duration_h, 'mm/h'), M('Rainfall depth', rain, 'mm'), M('Runoff depth', runoff, 'mm'), M('Runoff coefficient', rain > 0 ? runoff / rain : 0, ''), M('Time to reach f_c within 5 %', Math.log(20) / p.decay_constant_per_h, 'h')],
        status: runoff > 0 ? `${runoff.toFixed(1)} mm of the ${rain.toFixed(0)} mm rainfall becomes runoff.` : 'The soil absorbs the whole storm — no runoff.',
      };
    },
    curve: (p) => {
      const x = samples(0, 6, 91);
      return { x, y: x.map((t) => p.final_capacity_mm_h + (p.initial_capacity_mm_h - p.final_capacity_mm_h) * Math.exp(-p.decay_constant_per_h * t)), xLabel: 'Time (h)', yLabel: 'Infiltration capacity (mm/h)', unit: 'mm/h' };
    },
    references: [
      { label: 'f₀ 100, f_c 10, k 2 over one hour → 48.9 mm', input: { initial_capacity_mm_h: 100, final_capacity_mm_h: 10, decay_constant_per_h: 2, duration_h: 1, rainfall_intensity_mm_h: 60 }, expected: 10 * 1 + 90 * (1 - Math.exp(-2)) / 2, tolerance: 1e-9 },
      { label: 'Two hours → 64.18 mm', input: { initial_capacity_mm_h: 100, final_capacity_mm_h: 10, decay_constant_per_h: 2, duration_h: 2, rainfall_intensity_mm_h: 60 }, expected: 10 * 2 + 90 * (1 - Math.exp(-4)) / 2, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'wind-chill-heat-index', title: 'Apparent Temperature', tone: 'rose',
    desc: 'Wind chill, heat index and humidex — the temperature your body actually experiences.',
    fields: [F('temperature_c', 'Air temperature (°C)', 0, -60, 60), F('wind_speed_kmh', 'Wind speed (km/h)', 20, 0, 200), F('humidity_pct', 'Relative humidity (%)', 50, 0, 100)],
    sweep: 'temperature_c',
    scenarios: [{ label: 'Cold and windy', input: { temperature_c: -10, wind_speed_kmh: 30, humidity_pct: 60 } }, { label: 'Hot and humid', input: { temperature_c: 35, wind_speed_kmh: 5, humidity_pct: 70 } }, { label: 'Mild breeze', input: { temperature_c: 15, wind_speed_kmh: 25, humidity_pct: 50 } }, { label: 'Dangerous heat', input: { temperature_c: 42, wind_speed_kmh: 3, humidity_pct: 40 } }, { label: 'Extreme wind chill', input: { temperature_c: -25, wind_speed_kmh: 60, humidity_pct: 50 } }],
    equation: 'Wind chill = 13.12 + 0.6215T − 11.37v^0.16 + 0.3965T v^0.16   ·   Heat index = Rothfusz regression on T (°F) and RH',
    note: 'Environment Canada wind chill (valid at or below 10 °C and above 4.8 km/h) and the US NWS heat index (valid above 26.7 °C). Humidity is irrelevant to wind chill.',
    calculate: (p) => {
      const v = p.wind_speed_kmh;
      const windChill = 13.12 + 0.6215 * p.temperature_c - 11.37 * Math.pow(v, 0.16) + 0.3965 * p.temperature_c * Math.pow(v, 0.16);
      const fahrenheit = (p.temperature_c * 9) / 5 + 32;
      const rh = p.humidity_pct;
      const hi = -42.379 + 2.04901523 * fahrenheit + 10.14333127 * rh - 0.22475541 * fahrenheit * rh - 6.83783e-3 * fahrenheit ** 2 - 5.481717e-2 * rh ** 2 + 1.22874e-3 * fahrenheit ** 2 * rh + 8.5282e-4 * fahrenheit * rh ** 2 - 1.99e-6 * fahrenheit ** 2 * rh ** 2;
      const heatIndex = ((hi - 32) * 5) / 9;
      const vapour = (rh / 100) * 6.105 * Math.exp((17.27 * p.temperature_c) / (237.7 + p.temperature_c));
      const humidex = p.temperature_c + 0.5555 * (vapour - 10);
      const apparent = p.temperature_c <= 10 ? windChill : p.temperature_c >= 26.7 ? heatIndex : p.temperature_c;
      const frostbite = windChill <= -27 ? Math.max(2, 30 - 0.6 * (-windChill - 27)) : 0;
      return {
        primary: M('Apparent temperature', apparent, '°C'),
        metrics: [M('Wind chill', windChill, '°C'), M('Heat index', heatIndex, '°C'), M('Humidex', humidex, ''), M('Wind chill factor', p.temperature_c - windChill, 'K of extra cold'), M('Frostbite risk time', frostbite > 0 ? frostbite : 'Low', frostbite > 0 ? 'min' : ''), M('Condition', p.temperature_c <= 10 ? 'Cold — wind chill applies' : p.temperature_c >= 26.7 ? 'Hot — heat index applies' : 'Mild — feels like the air temperature')],
        status: apparent < p.temperature_c ? `Feels ${(p.temperature_c - apparent).toFixed(1)} K colder than the air.` : apparent > p.temperature_c ? `Feels ${(apparent - p.temperature_c).toFixed(1)} K hotter than the air.` : 'Feels like the measured temperature.',
        warning: frostbite > 0 ? 'Exposed skin can freeze quickly — cover up and limit exposure.' : '',
      };
    },
    references: [
      { label: '−10 °C in a 30 km/h wind feels like −19.5 °C', input: { temperature_c: -10, wind_speed_kmh: 30, humidity_pct: 50 }, expected: 13.12 + 0.6215 * -10 - 11.37 * Math.pow(30, 0.16) + 0.3965 * -10 * Math.pow(30, 0.16), tolerance: 1e-9 },
      { label: '35 °C at 70 % humidity is the primary reading', input: { temperature_c: 35, wind_speed_kmh: 5, humidity_pct: 70 }, expected: (((-42.379 + 2.04901523 * 95 + 10.14333127 * 70 - 0.22475541 * 95 * 70 - 6.83783e-3 * 95 ** 2 - 5.481717e-2 * 70 ** 2 + 1.22874e-3 * 95 ** 2 * 70 + 8.5282e-4 * 95 * 70 ** 2 - 1.99e-6 * 95 ** 2 * 70 ** 2) - 32) * 5) / 9, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'air-quality-index', title: 'Air Quality Index', tone: 'amber',
    desc: 'US EPA sub-indices for PM2.5, PM10, ozone and NO₂, the dominant pollutant and the health band.',
    fields: [F('pm25_ug_m3', 'PM2.5 (µg/m³)', 35, 0, 500), F('pm10_ug_m3', 'PM10 (µg/m³)', 80, 0, 600), F('ozone_ppb', 'Ozone, 8 h (ppb)', 60, 0, 500), F('no2_ppb', 'Nitrogen dioxide (ppb)', 40, 0, 2000)],
    sweep: 'pm25_ug_m3',
    scenarios: [{ label: 'Typical city day', input: { pm25_ug_m3: 20, pm10_ug_m3: 45, ozone_ppb: 40, no2_ppb: 30 } }, { label: 'Wildfire smoke', input: { pm25_ug_m3: 120, pm10_ug_m3: 180, ozone_ppb: 30, no2_ppb: 25 } }, { label: 'Summer smog', input: { pm25_ug_m3: 25, pm10_ug_m3: 50, ozone_ppb: 90, no2_ppb: 60 } }, { label: 'Traffic corridor', input: { pm25_ug_m3: 40, pm10_ug_m3: 90, ozone_ppb: 35, no2_ppb: 140 } }, { label: 'Clean air', input: { pm25_ug_m3: 5, pm10_ug_m3: 15, ozone_ppb: 25, no2_ppb: 15 } }],
    equation: 'AQI = (I_hi − I_lo)/(C_hi − C_lo) × (C − C_lo) + I_lo   ·   overall AQI = max(sub-indices)',
    note: 'US EPA breakpoint table with linear interpolation, using the 2024 PM2.5 bands and 8-hour ozone. Air-quality standards differ between countries.',
    calculate: (p) => {
      const indices = {
        'PM2.5': subIndex('pm25', p.pm25_ug_m3),
        PM10: subIndex('pm10', p.pm10_ug_m3),
        Ozone: subIndex('ozone', p.ozone_ppb),
        'NO₂': subIndex('no2', p.no2_ppb),
      };
      const dominant = Object.entries(indices).reduce((best, entry) => (entry[1] > best[1] ? entry : best), ['PM2.5', 0]);
      const overall = dominant[1];
      const category = overall <= 50 ? 'Good' : overall <= 100 ? 'Moderate' : overall <= 150 ? 'Unhealthy for sensitive groups' : overall <= 200 ? 'Unhealthy' : overall <= 300 ? 'Very unhealthy' : 'Hazardous';
      return {
        primary: M('Overall AQI', Math.round(overall), ''),
        metrics: [M('PM2.5 sub-index', Math.round(indices['PM2.5']), ''), M('PM10 sub-index', Math.round(indices.PM10), ''), M('Ozone sub-index', Math.round(indices.Ozone), ''), M('NO₂ sub-index', Math.round(indices['NO₂']), ''), M('Dominant pollutant', dominant[0], ''), M('Health category', category, '')],
        status: `${category} — driven by ${dominant[0]}.`,
        warning: overall > 100 ? 'Sensitive groups should limit outdoor exertion while levels stay this high.' : '',
      };
    },
    references: [
      { label: 'PM2.5 at the top of the second band gives AQI 100', input: { pm25_ug_m3: 35.4, pm10_ug_m3: 0, ozone_ppb: 0, no2_ppb: 0 }, expected: 100, tolerance: 1e-9 },
      { label: 'PM2.5 at the bottom of that band gives AQI 51', input: { pm25_ug_m3: 12.1, pm10_ug_m3: 0, ozone_ppb: 0, no2_ppb: 0 }, expected: 51, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'soil-erosion-usle', title: 'Soil Loss (USLE)', tone: 'emerald',
    desc: 'Annual soil loss from rainfall, soil, slope, crop cover and conservation practice.',
    fields: [F('rainfall_factor_r', 'Rainfall erosivity R', 300, 0, 3000), F('soil_erodibility_k', 'Soil erodibility K', 0.3, 0, 1), F('slope_length_m', 'Slope length (m)', 50, 0.5, 2000), F('slope_percent', 'Slope steepness (%)', 8, 0, 100), F('crop_cover_c', 'Crop cover factor C', 0.3, 0, 1), F('support_practice_p', 'Support practice factor P', 0.5, 0, 1), F('tolerable_loss', 'Tolerable soil loss (t/ha/yr)', 11, 0.1, 100)],
    sweep: 'slope_percent',
    scenarios: [{ label: 'Cultivated 8 % slope', input: { rainfall_factor_r: 300, soil_erodibility_k: 0.3, slope_length_m: 50, slope_percent: 8, crop_cover_c: 0.3, support_practice_p: 0.5 } }, { label: 'Steep 20 % slope', input: { rainfall_factor_r: 300, soil_erodibility_k: 0.3, slope_length_m: 50, slope_percent: 20, crop_cover_c: 0.3, support_practice_p: 0.5 } }, { label: 'Contour ploughing', input: { rainfall_factor_r: 300, soil_erodibility_k: 0.3, slope_length_m: 50, slope_percent: 8, crop_cover_c: 0.3, support_practice_p: 0.2 } }, { label: 'Good grass cover', input: { rainfall_factor_r: 300, soil_erodibility_k: 0.3, slope_length_m: 50, slope_percent: 8, crop_cover_c: 0.02, support_practice_p: 0.2 } }],
    equation: 'A = R·K·LS·C·P   ·   LS = (λ/22.13)^0.5 (0.065 + 0.045S + 0.0065S²)',
    note: 'Empirical USLE with the Wischmeier LS slope term. RUSLE2 and process models replace this where land management is being certified.',
    calculate: (p) => {
      const slopeLength = Math.pow(p.slope_length_m / 22.13, 0.5);
      const slopeSteepness = 0.065 + 0.045 * p.slope_percent + 0.0065 * p.slope_percent ** 2;
      const ls = slopeLength * slopeSteepness;
      const loss = p.rainfall_factor_r * p.soil_erodibility_k * ls * p.crop_cover_c * p.support_practice_p;
      const needed = loss / p.tolerable_loss;
      return {
        primary: M('Annual soil loss', loss, 't/ha/yr'),
        metrics: [M('Slope factor LS', ls, ''), M('Loss against tolerable', needed * 100, '%'), M('Excess above tolerance', Math.max(0, loss - p.tolerable_loss), 't/ha/yr'), M('Topsoil depth lost per decade', (loss / 1300) * 10 * 1000, 'mm/10 yr'), M('Crop cover required to meet tolerance', (p.tolerable_loss / (p.rainfall_factor_r * p.soil_erodibility_k * ls * p.support_practice_p)), ''), M('Erosion class', loss < 2 ? 'Very low' : loss < 5 ? 'Low' : loss < 11 ? 'Moderate' : loss < 50 ? 'High' : 'Very high')],
        status: loss <= p.tolerable_loss ? 'Erosion stays within the tolerable loss.' : `Erosion is ${needed.toFixed(1)}× the tolerable loss — cover or practice must improve.`,
      };
    },
    references: [
      { label: 'A flat 22.13 m plot has LS = 0.065, giving 0.878 t/ha/yr', input: { rainfall_factor_r: 300, soil_erodibility_k: 0.3, slope_length_m: 22.13, slope_percent: 0, crop_cover_c: 0.3, support_practice_p: 0.5, tolerable_loss: 11 }, expected: 300 * 0.3 * 0.065 * 0.3 * 0.5, tolerance: 1e-9 },
      { label: 'Doubling the R factor doubles the loss', input: { rainfall_factor_r: 600, soil_erodibility_k: 0.3, slope_length_m: 22.13, slope_percent: 0, crop_cover_c: 0.3, support_practice_p: 0.5, tolerable_loss: 11 }, expected: 2 * 300 * 0.3 * 0.065 * 0.3 * 0.5, tolerance: 1e-9 },
    ],
  }),
  D({
    id: 'evapotranspiration-hargreaves', title: 'Reference Evapotranspiration', tone: 'amber',
    desc: 'Hargreaves reference ET, crop water use and the irrigation a field actually needs.',
    fields: [F('t_max_c', 'Daily maximum temperature (°C)', 30, -30, 60), F('t_min_c', 'Daily minimum temperature (°C)', 18, -40, 45), F('extraterrestrial_radiation_mj', 'Extraterrestrial radiation (MJ/m²/day)', 35, 1, 50), F('crop_coefficient', 'Crop coefficient K_c', 0.85, 0, 1.5), F('rainfall_mm', 'Effective rainfall (mm/day)', 5, 0, 300), F('area_ha', 'Field area (ha)', 2, 0.01, 10000)],
    sweep: 't_max_c',
    scenarios: [{ label: 'Summer maize', input: { t_max_c: 30, t_min_c: 18, extraterrestrial_radiation_mj: 35, crop_coefficient: 0.85, rainfall_mm: 5, area_ha: 2 } }, { label: 'Hot dry day 38 °C', input: { t_max_c: 38, t_min_c: 24, extraterrestrial_radiation_mj: 40, crop_coefficient: 0.85, rainfall_mm: 0, area_ha: 2 } }, { label: 'Cool cloudy day', input: { t_max_c: 20, t_min_c: 12, extraterrestrial_radiation_mj: 18, crop_coefficient: 0.7, rainfall_mm: 8, area_ha: 2 } }, { label: 'Mature orchard K_c 1.1', input: { t_max_c: 32, t_min_c: 20, extraterrestrial_radiation_mj: 38, crop_coefficient: 1.1, rainfall_mm: 2, area_ha: 5 } }],
    equation: 'ET₀ = 0.0023 R_a (T_mean + 17.8)√(T_max − T_min)   ·   ET_c = K_c ET₀   ·   irrigation = max(0, ET_c − rain)',
    note: 'Hargreaves–Samani temperature method for a grass reference crop. Full FAO-56 Penman–Monteith needs humidity, wind and net radiation.',
    validate: (p) => (p.t_max_c <= p.t_min_c ? 'The maximum temperature must exceed the minimum temperature.' : null),
    calculate: (p) => {
      const mean = (p.t_max_c + p.t_min_c) / 2;
      const et0 = 0.0023 * p.extraterrestrial_radiation_mj * (mean + 17.8) * Math.sqrt(p.t_max_c - p.t_min_c);
      const crop = et0 * p.crop_coefficient;
      const irrigation = Math.max(0, crop - p.rainfall_mm);
      return {
        primary: M('Reference ET₀', et0, 'mm/day'),
        metrics: [M('Crop water use ET_c', crop, 'mm/day'), M('Net irrigation need', irrigation, 'mm/day'), M('Weekly irrigation depth', irrigation * 7, 'mm'), M('Daily field volume', irrigation * 10 * p.area_ha, 'm³/day'), M('Monthly crop use', crop * 30, 'mm/month'), M('Temperature range', p.t_max_c - p.t_min_c, 'K')],
        status: irrigation > 0 ? `Irrigate ${irrigation.toFixed(1)} mm/day (${(irrigation * 10 * p.area_ha).toFixed(0)} m³/day for the field).` : 'Rainfall covers crop demand — no irrigation needed.',
      };
    },
    references: [
      { label: '30/18 °C with 35 MJ/m²/day → 11.66 mm/day', input: { t_max_c: 30, t_min_c: 18, extraterrestrial_radiation_mj: 35, crop_coefficient: 1, rainfall_mm: 0, area_ha: 1 }, expected: 0.0023 * 35 * (24 + 17.8) * Math.sqrt(12), tolerance: 1e-12 },
      { label: 'A narrower 8 K range lowers the demand', input: { t_max_c: 30, t_min_c: 22, extraterrestrial_radiation_mj: 35, crop_coefficient: 1, rainfall_mm: 0, area_ha: 1 }, expected: 0.0023 * 35 * (26 + 17.8) * Math.sqrt(8), tolerance: 1e-12 },
    ],
  }),
  D({
    id: 'groundwater-darcy-well', title: 'Pumping Well Yield (Thiem)', tone: 'cyan',
    desc: 'Sustainable well yield, transmissivity and specific capacity from aquifer properties.',
    fields: [F('hydraulic_conductivity_m_day', 'Hydraulic conductivity (m/day)', 10, 0.001, 500), F('aquifer_thickness_m', 'Aquifer thickness (m)', 20, 0.5, 500), F('drawdown_m', 'Drawdown at the well (m)', 5, 0.01, 300), F('well_radius_m', 'Well radius (m)', 0.15, 0.02, 3), F('influence_radius_m', 'Radius of influence (m)', 300, 5, 5000), F('observation_radius_m', 'Observation radius (m)', 50, 1, 2000)],
    sweep: 'drawdown_m',
    scenarios: [{ label: 'Sand aquifer 10 m/day', input: { hydraulic_conductivity_m_day: 10, aquifer_thickness_m: 20, drawdown_m: 5, well_radius_m: 0.15, influence_radius_m: 300 } }, { label: 'Deep drawdown 15 m', input: { hydraulic_conductivity_m_day: 10, aquifer_thickness_m: 20, drawdown_m: 15, well_radius_m: 0.15, influence_radius_m: 300 } }, { label: 'Gravel 50 m/day', input: { hydraulic_conductivity_m_day: 50, aquifer_thickness_m: 30, drawdown_m: 5, well_radius_m: 0.2, influence_radius_m: 500 } }, { label: 'Low-yield clay 0.5 m/day', input: { hydraulic_conductivity_m_day: 0.5, aquifer_thickness_m: 8, drawdown_m: 5, well_radius_m: 0.15, influence_radius_m: 100 } }],
    equation: 'Q = 2πKb s/ln(R/r_w)   ·   T = Kb   ·   specific capacity = Q/s   ·   s(r) = Q ln(R/r)/(2πKb)',
    note: 'Steady-state Thiem solution for a confined aquifer with a fully penetrating well. Transient drawdown, well losses and partial penetration need test-pumping analysis.',
    calculate: (p) => {
      const transmissivity = p.hydraulic_conductivity_m_day * p.aquifer_thickness_m;
      const yieldRate = (2 * Math.PI * transmissivity * p.drawdown_m) / Math.log(p.influence_radius_m / p.well_radius_m);
      const observation = (yieldRate * Math.log(p.influence_radius_m / p.observation_radius_m)) / (2 * Math.PI * transmissivity);
      return {
        primary: M('Sustainable well yield', yieldRate, 'm³/day'),
        metrics: [M('Yield', yieldRate / 86.4, 'L/s'), M('Transmissivity', transmissivity, 'm²/day'), M('Specific capacity', yieldRate / p.drawdown_m, 'm³/day per m'), M('Drawdown at the observation well', observation, 'm'), M('Drawdown cone reach', p.influence_radius_m, 'm'), M('Volume in a year', yieldRate * 365, 'm³/yr')],
        status: `${(yieldRate / 86.4).toFixed(1)} L/s for ${p.drawdown_m} m of drawdown.`,
      };
    },
    references: [
      { label: 'K 10 m/day over 20 m with 5 m drawdown → 827 m³/day', input: { hydraulic_conductivity_m_day: 10, aquifer_thickness_m: 20, drawdown_m: 5, well_radius_m: 0.15, influence_radius_m: 300, observation_radius_m: 50 }, expected: (2 * Math.PI * 10 * 20 * 5) / Math.log(300 / 0.15), tolerance: 1e-9 },
      { label: 'Doubling conductivity doubles the yield to 1 653 m³/day', input: { hydraulic_conductivity_m_day: 20, aquifer_thickness_m: 20, drawdown_m: 5, well_radius_m: 0.15, influence_radius_m: 300, observation_radius_m: 50 }, expected: (2 * Math.PI * 20 * 20 * 5) / Math.log(300 / 0.15), tolerance: 1e-9 },
    ],
  }),
];

export default hydroTools;