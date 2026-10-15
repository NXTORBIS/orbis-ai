/**
 * Geospatial raster warp engine.
 *
 * Reprojects raster data between coordinate systems by inverting the target-to-source
 * mapping per output pixel, tile by tile, with nearest, bilinear or bicubic resampling and
 * a nodata mask. The projections are the real series: WGS84 geodetic, Web Mercator, and the
 * Universal Transverse Mercator forward and inverse (Krüger/Snyder series on the GRS80
 * ellipsoid), with UTM zone selection and the southern-hemisphere false northing.
 *
 * The verification compares the implementation against closed forms rather than against
 * itself: analytic partial derivatives of the Mercator mapping, the meridian arc computed
 * by Gauss-Legendre quadrature instead of the truncated series, the scale factor recovered
 * by numerical differentiation and compared with the independent series, exactness of
 * bilinear interpolation on planar surfaces, and a reprojection round trip measured in metres.
 */

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = 2 * F - F * F;
const E_PRIME2 = E2 / (1 - E2);
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING = 10000000;
const DEG = Math.PI / 180;

export const CRS_LABELS = {
  'EPSG:4326': 'WGS84 geodetic (degrees)',
  'EPSG:3857': 'Web Mercator (metres)',
  'UTM': 'UTM zone (metres)',
};

const meridianRadius = (lat) => (A * (1 - E2)) / (1 - E2 * Math.sin(lat) ** 2) ** 1.5;

/** The meridian arc by Gauss-Legendre quadrature — independent of the truncated series. */
export function meridianArcExact(latRad) {
  const nodes = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
  const weights = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891];
  const half = latRad / 2;
  let sum = 0;
  for (let i = 0; i < nodes.length; i += 1) sum += weights[i] * meridianRadius(half * nodes[i] + half);
  return sum * half;
}

/** The truncated series for the same quantity, used by the forward UTM mapping. */
function meridianArcSeries(latRad) {
  return A * (
    (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * latRad
    - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * latRad)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * latRad)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * latRad)
  );
}

export const utmZoneOf = (lon) => Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
export const centralMeridianOf = (zone) => zone * 6 - 183;

export function geodeticToUtm(lon, lat, { zone = utmZoneOf(lon), south = lat < 0 } = {}) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const lambda0 = centralMeridianOf(zone) * DEG;
  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = E_PRIME2 * Math.cos(phi) ** 2;
  const AA = (lambda - lambda0) * Math.cos(phi);
  const M = meridianArcSeries(phi);
  const easting = K0 * N * (AA + ((1 - T + C) * AA ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * E_PRIME2) * AA ** 5) / 120) + FALSE_EASTING;
  let northing = K0 * (M + N * Math.tan(phi) * (AA ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * AA ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * E_PRIME2) * AA ** 6) / 720));
  if (south) northing += FALSE_NORTHING;
  const convergence = Math.atan(Math.tan(lambda - lambda0) * Math.sin(phi));
  const scale = K0 * (1 + ((1 + C) * AA ** 2) / 2 + ((5 - 18 * T + T * T + 72 * C - 58 * E_PRIME2) * AA ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * E_PRIME2) * AA ** 6) / 720);
  return { easting, northing, zone, south, convergenceDeg: convergence / DEG, scale };
}

export function utmToGeodetic(easting, northing, { zone = 33, south = false } = {}) {
  const x = easting - FALSE_EASTING;
  const y = northing - (south ? FALSE_NORTHING : 0);
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const C1 = E_PRIME2 * Math.cos(phi1) ** 2;
  const T1 = Math.tan(phi1) ** 2;
  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * K0);
  const phi = phi1 - ((N1 * Math.tan(phi1)) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * E_PRIME2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * E_PRIME2 - 3 * C1 * C1) * D ** 6) / 720);
  const lambda = centralMeridianOf(zone) * DEG + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * E_PRIME2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return { lon: lambda / DEG, lat: phi / DEG };
}

export function geodeticToMercator(lon, lat) {
  return { x: A * lon * DEG, y: A * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) };
}

export function mercatorToGeodetic(x, y) {
  return { lon: x / A / DEG, lat: (2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) / DEG };
}

/** Forward projection for a target CRS. Raster rows increase downward, so y is negated. */
export function project(lon, lat, crs, { zone } = {}) {
  if (crs === 'EPSG:4326') return { x: lon, y: lat };
  if (crs === 'EPSG:3857') {
    const point = geodeticToMercator(lon, lat);
    return { x: point.x, y: -point.y };
  }
  const resolvedZone = zone ?? utmZoneOf(lon);
  const point = geodeticToUtm(lon, lat, { zone: resolvedZone });
  return { x: point.easting, y: -point.northing, zone: resolvedZone };
}

export function unproject(x, y, crs, { zone } = {}) {
  if (crs === 'EPSG:4326') return { lon: x, lat: y };
  if (crs === 'EPSG:3857') return mercatorToGeodetic(x, -y);
  return utmToGeodetic(x, -y, { zone: zone ?? 33, south: false });
}

/* ── rasters ── */

const valueNoise = (random, size) => {
  const grid = new Float64Array((size + 1) * (size + 1));
  for (let i = 0; i < grid.length; i += 1) grid[i] = random();
  return (fx, fy) => {
    const x = Math.max(0, Math.min(size - 0.0001, fx));
    const y = Math.max(0, Math.min(size - 0.0001, fy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const smooth = (t) => t * t * (3 - 2 * t);
    const sx = smooth(x - x0);
    const sy = smooth(y - y0);
    const at = (gx, gy) => grid[gy * (size + 1) + gx];
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
};

/** A synthetic elevation model: fractal noise plus a ridge line, so hillshading shows relief. */
export function makeDem({ width = 320, height = 240, extent, seed = 3, crs = 'EPSG:4326', base = 320 } = {}) {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const bounds = extent ?? { west: 6.4, south: 44.2, east: 8.6, north: 45.4 };
  const octaves = [valueNoise(random, 4), valueNoise(random, 8), valueNoise(random, 16), valueNoise(random, 32)];
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const fx = col / width;
      const fy = row / height;
      let value = 0;
      let amplitude = 1;
      let total = 0;
      octaves.forEach((noise, index) => {
        const scale = 2 ** index;
        value += amplitude * noise(fx * scale, fy * scale);
        total += amplitude;
        amplitude *= 0.5;
      });
      const ridge = Math.sin(fx * Math.PI * 1.4) * Math.cos(fy * Math.PI * 0.9) * 0.25;
      data[row * width + col] = base + (value / total) * 900 + ridge * 700;
    }
  }
  const dx = (bounds.east - bounds.west) / width;
  const dy = (bounds.north - bounds.south) / height;
  return {
    width,
    height,
    data,
    crs,
    extent: bounds,
    geo: { x0: bounds.west, y0: bounds.north, dx, dy: -dy },
    nodata: -9999,
  };
}

export const pixelToWorld = (raster, col, row) => ({
  x: raster.geo.x0 + raster.geo.dx * col,
  y: raster.geo.y0 + raster.geo.dy * row,
});

export const worldToPixel = (raster, x, y) => ({
  col: (x - raster.geo.x0) / raster.geo.dx,
  row: (y - raster.geo.y0) / raster.geo.dy,
});

function sampleNearest(raster, col, row) {
  const c = Math.round(col);
  const r = Math.round(row);
  if (c < 0 || r < 0 || c >= raster.width || r >= raster.height) return raster.nodata;
  const value = raster.data[r * raster.width + c];
  return value === raster.nodata ? raster.nodata : value;
}

export function sampleBilinear(raster, col, row) {
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= raster.width || r0 + 1 >= raster.height) return sampleNearest(raster, col, row);
  const tx = col - c0;
  const ty = row - r0;
  const at = (c, r) => raster.data[r * raster.width + c];
  const v00 = at(c0, r0);
  const v10 = at(c0 + 1, r0);
  const v01 = at(c0, r0 + 1);
  const v11 = at(c0 + 1, r0 + 1);
  if (v00 === raster.nodata || v10 === raster.nodata || v01 === raster.nodata || v11 === raster.nodata) return sampleNearest(raster, col, row);
  const top = v00 * (1 - tx) + v10 * tx;
  const bottom = v01 * (1 - tx) + v11 * tx;
  return top * (1 - ty) + bottom * ty;
}

const catmull = (t, a, b, c, d) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};

function sampleBicubic(raster, col, row) {
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  if (c0 - 1 < 0 || r0 - 1 < 0 || c0 + 2 >= raster.width || r0 + 2 >= raster.height) return sampleBilinear(raster, col, row);
  const tx = col - c0;
  const ty = row - r0;
  const rows = [];
  for (let m = -1; m <= 2; m += 1) {
    const values = [];
    for (let n = -1; n <= 2; n += 1) {
      const value = raster.data[(r0 + m) * raster.width + (c0 + n)];
      if (value === raster.nodata) return sampleBilinear(raster, col, row);
      values.push(value);
    }
    rows.push(catmull(tx, values[0], values[1], values[2], values[3]));
  }
  return catmull(ty, rows[0], rows[1], rows[2], rows[3]);
}

const SAMPLERS = { nearest: sampleNearest, bilinear: sampleBilinear, bicubic: sampleBicubic };

const targetExtentFor = (raster, targetCrs, zone) => {
  const corners = [
    [0, 0],
    [raster.width - 1, 0],
    [0, raster.height - 1],
    [raster.width - 1, raster.height - 1],
    [raster.width / 2, raster.height / 2],
  ].map(([col, row]) => {
    const world = pixelToWorld(raster, col, row);
    return project(world.x, world.y, targetCrs, { zone });
  });
  const xs = corners.map((point) => point.x);
  // the extent is built from the top and bottom rows themselves, which keeps the row order
  // correct whether the CRS's y grows upward (geodetic) or downward (northing negated)
  const top = corners[0].y;
  const bottom = corners[2].y;
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.02;
  const padY = Math.abs(top - bottom) * 0.02;
  return { west: Math.min(...xs) - padX, east: Math.max(...xs) + padX, north: top - padY, south: bottom + padY };
};

/**
 * Warps a raster onto a target grid. Each output pixel is mapped back through the target
 * projection and the source geotransform, so no forward hole-filling is needed.
 */
export async function warp(raster, options = {}, { onProgress, signal } = {}) {
  const {
    targetCrs = 'EPSG:3857',
    outWidth = raster.width,
    outHeight = raster.height,
    targetExtent,
    resample = 'bilinear',
    tile = 128,
  } = options;
  const centreLon = (raster.extent.west + raster.extent.east) / 2;
  const zone = options.zone ?? (targetCrs === 'UTM' ? utmZoneOf(centreLon) : undefined);
  const sampler = SAMPLERS[resample] ?? sampleBilinear;
  const bounds = targetExtent ?? targetExtentFor(raster, targetCrs, zone);
  const out = {
    width: outWidth,
    height: outHeight,
    data: new Float32Array(outWidth * outHeight).fill(raster.nodata),
    crs: targetCrs,
    nodata: raster.nodata,
    extent: bounds,
    geo: { x0: bounds.west, y0: bounds.north, dx: (bounds.east - bounds.west) / outWidth, dy: -(bounds.north - bounds.south) / outHeight },
  };
  const started = Date.now();
  let nodataPixels = 0;
  let tiles = 0;
  for (let rowStart = 0; rowStart < outHeight; rowStart += tile) {
    if (signal?.aborted) throw new Error('cancelled');
    const rowEnd = Math.min(outHeight, rowStart + tile);
    for (let colStart = 0; colStart < outWidth; colStart += tile) {
      const colEnd = Math.min(outWidth, colStart + tile);
      for (let row = rowStart; row < rowEnd; row += 1) {
        for (let col = colStart; col < colEnd; col += 1) {
          const x = out.geo.x0 + out.geo.dx * col;
          const y = out.geo.y0 + out.geo.dy * row;
          const geographic = unproject(x, y, targetCrs, { zone });
          const source = worldToPixel(raster, geographic.lon, geographic.lat);
          if (source.col < -1 || source.row < -1 || source.col > raster.width || source.row > raster.height) {
            nodataPixels += 1;
            continue;
          }
          const value = sampler(raster, source.col, source.row);
          if (value === raster.nodata) nodataPixels += 1;
          else out.data[row * outWidth + col] = value;
        }
      }
      tiles += 1;
    }
    onProgress?.({ phase: 'Warping', done: rowEnd, total: outHeight, tiles });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const ms = Math.max(1, Date.now() - started);
  return {
    raster: out,
    stats: {
      tiles,
      nodataPixels,
      nodataShare: nodataPixels / (outWidth * outHeight),
      ms,
      megapixelsPerSecond: (outWidth * outHeight) / 1e6 / (ms / 1000),
      resample,
      targetCrs,
      zone,
      extent: bounds,
    },
  };
}

export function hillshade(raster, { azimuth = 315, altitude = 45, exaggeration = 1.4 } = {}) {
  const az = (90 - azimuth) * DEG;
  const alt = altitude * DEG;
  const out = new Uint8Array(raster.width * raster.height).fill(30);
  const values = new Float32Array(raster.width * raster.height);
  let min = Infinity;
  let max = -Infinity;
  for (let row = 1; row < raster.height - 1; row += 1) {
    for (let col = 1; col < raster.width - 1; col += 1) {
      const dzdx = ((raster.data[row * raster.width + col + 1] - raster.data[row * raster.width + col - 1]) / (2 * Math.abs(raster.geo.dx) * 111320)) * exaggeration;
      const dzdy = ((raster.data[(row + 1) * raster.width + col] - raster.data[(row - 1) * raster.width + col]) / (2 * Math.abs(raster.geo.dy) * 111320)) * exaggeration;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
      const index = row * raster.width + col;
      values[index] = shade;
      min = Math.min(min, shade);
      max = Math.max(max, shade);
    }
  }
  const span = max - min || 1;
  for (let i = 0; i < values.length; i += 1) out[i] = Math.round(30 + ((values[i] - min) / span) * 200);
  return { width: raster.width, height: raster.height, grey: out };
}

export function rasterStats(raster) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < raster.data.length; i += 1) {
    const value = raster.data[i];
    if (value === raster.nodata || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    count += 1;
  }
  const span = max - min || 1;
  const bins = new Array(24).fill(0);
  for (let i = 0; i < raster.data.length; i += 1) {
    const value = raster.data[i];
    if (value === raster.nodata || !Number.isFinite(value)) continue;
    bins[Math.min(bins.length - 1, Math.floor(((value - min) / span) * bins.length))] += 1;
  }
  return {
    min,
    max,
    mean: count ? sum / count : 0,
    count,
    bins: bins.map((value, index) => ({ label: `${Math.round(min + (span * index) / bins.length)}`, value })),
  };
}

/* ── verification ── */

export function verifyProjections() {
  let mercatorWorst = 0;
  let mercatorWhere = null;
  for (let lon = -175; lon <= 175; lon += 17) {
    for (let lat = -80; lat <= 80; lat += 10) {
      const point = geodeticToMercator(lon, lat);
      const back = mercatorToGeodetic(point.x, point.y);
      const error = Math.max(Math.abs(back.lon - lon), Math.abs(back.lat - lat));
      if (error > mercatorWorst) {
        mercatorWorst = error;
        mercatorWhere = { lon, lat };
      }
    }
  }

  let utmRoundWorst = 0;
  let utmWhere = null;
  for (let zone = 1; zone <= 60; zone += 7) {
    const centre = centralMeridianOf(zone);
    for (let lat = -76; lat <= 76; lat += 6) {
      for (let dLon = -3; dLon <= 3; dLon += 1.5) {
        const lon = centre + dLon;
        const projected = geodeticToUtm(lon, lat, { zone });
        const back = utmToGeodetic(projected.easting, projected.northing, { zone, south: projected.south });
        const dx = (back.lon - lon) * DEG * A * Math.cos(lat * DEG);
        const dy = (back.lat - lat) * DEG * A;
        const error = Math.hypot(dx, dy);
        if (error > utmRoundWorst) {
          utmRoundWorst = error;
          utmWhere = { zone, lon, lat };
        }
      }
    }
  }

  // the central meridian must sit exactly on the false easting, and its northing must match
  // the meridian arc from quadrature rather than the truncated series the mapping uses
  let eastingWorst = 0;
  let arcWorst = 0;
  for (let lat = -76; lat <= 76; lat += 4) {
    const projected = geodeticToUtm(centralMeridianOf(21), lat, { zone: 21 });
    eastingWorst = Math.max(eastingWorst, Math.abs(projected.easting - FALSE_EASTING));
    const arc = meridianArcExact(lat * DEG);
    if (arc) arcWorst = Math.max(arcWorst, Math.abs(Math.abs(projected.northing) / K0 - arc) / arc);
  }

  // scale factor from numerical differentiation against the series the mapping reports
  let scaleWorst = 0;
  let scaleWhere = null;
  for (let lat = 20; lat <= 70; lat += 10) {
    for (let dLon = -2.5; dLon <= 2.5; dLon += 1.25) {
      const lon = centralMeridianOf(21) + dLon;
      const step = 1e-5;
      const plus = geodeticToUtm(lon + step, lat, { zone: 21 });
      const minus = geodeticToUtm(lon - step, lat, { zone: 21 });
      // the derivative is per degree of longitude, so it is converted to per radian
      const numeric = (Math.abs(plus.easting - minus.easting) / (2 * step)) * (180 / Math.PI);
      const N = A / Math.sqrt(1 - E2 * Math.sin(lat * DEG) ** 2);
      const scaleFromNumeric = numeric / (N * Math.cos(lat * DEG));
      const series = geodeticToUtm(lon, lat, { zone: 21 }).scale;
      const relative = Math.abs(scaleFromNumeric - series) / series;
      if (relative > scaleWorst) {
        scaleWorst = relative;
        scaleWhere = { lon, lat, numeric: scaleFromNumeric, series };
      }
    }
  }

  // Mercator partial derivatives against the closed form
  let mercatorDerivativeWorst = 0;
  for (let lat = -70; lat <= 70; lat += 10) {
    const lon = 12.5;
    const step = 1e-7;
    const plus = geodeticToMercator(lon + step, lat);
    const minus = geodeticToMercator(lon - step, lat);
    const dxdLon = (plus.x - minus.x) / (2 * step * DEG);
    const up = geodeticToMercator(lon, lat + step);
    const down = geodeticToMercator(lon, lat - step);
    const dydLat = (up.y - down.y) / (2 * step * DEG);
    const expectedY = A / Math.cos(lat * DEG);
    mercatorDerivativeWorst = Math.max(
      mercatorDerivativeWorst,
      Math.abs(dxdLon - A) / A,
      Math.abs(dydLat - expectedY) / expectedY,
    );
  }

  return {
    mercator: { roundTripMaxDeg: mercatorWorst, where: mercatorWhere },
    utm: { roundTripMaxMetres: utmRoundWorst, where: utmWhere, eastingDeviationMetres: eastingWorst, meridianArcRelative: arcWorst },
    scale: { maxRelativeDifference: scaleWorst, where: scaleWhere, onCentralMeridian: geodeticToUtm(centralMeridianOf(21), 45, { zone: 21 }).scale },
    mercatorDerivatives: { maxRelativeError: mercatorDerivativeWorst },
  };
}

/** Interpolation and reprojection checks whose correct answers are known in advance. */
export async function verifyWarp({ seed = 3 } = {}) {
  // a plane over the raster: bilinear must reproduce it exactly, whatever the output grid
  const plane = makeDem({ width: 96, height: 72, seed });
  for (let row = 0; row < plane.height; row += 1) {
    for (let col = 0; col < plane.width; col += 1) plane.data[row * plane.width + col] = 100 + 3 * col - 2 * row;
  }
  const identity = await warp(plane, { targetCrs: 'EPSG:4326', outWidth: plane.width, outHeight: plane.height, targetExtent: plane.extent, resample: 'bilinear' }, {});
  let identityWorst = 0;
  for (let i = 0; i < plane.data.length; i += 1) identityWorst = Math.max(identityWorst, Math.abs(identity.raster.data[i] - plane.data[i]));

  // a fractional shift: bilinear on a plane still lands exactly on the plane's values
  const shiftX = 0.37;
  const shiftY = 0.63;
  const shiftedExtent = {
    west: plane.extent.west - plane.geo.dx * shiftX,
    east: plane.extent.east - plane.geo.dx * shiftX,
    north: plane.extent.north - plane.geo.dy * shiftY,
    south: plane.extent.south - plane.geo.dy * shiftY,
  };
  const shifted = { ...plane, extent: shiftedExtent, geo: { x0: shiftedExtent.west, y0: shiftedExtent.north, dx: plane.geo.dx, dy: plane.geo.dy } };
  const shiftedWarp = await warp(shifted, { targetCrs: 'EPSG:4326', outWidth: plane.width, outHeight: plane.height, targetExtent: plane.extent, resample: 'bilinear' }, {});
  let shiftedWorst = 0;
  let borderPixels = 0;
  for (let row = 0; row < plane.height; row += 1) {
    for (let col = 0; col < plane.width; col += 1) {
      const value = shiftedWarp.raster.data[row * plane.width + col];
      if (value === plane.nodata) continue;
      const expected = 100 + 3 * (col + shiftX) - 2 * (row + shiftY);
      const error = Math.abs(value - expected);
      // the outermost pixels fall back to nearest-neighbour by design, so they are counted
      // separately rather than folded into the interpolation check
      if (row < 2 || col < 2 || row > plane.height - 3 || col > plane.width - 3) {
        if (error > 1e-6) borderPixels += 1;
      } else shiftedWorst = Math.max(shiftedWorst, error);
    }
  }

  // reproject a relief model to UTM and read it back through the projection
  const relief = makeDem({ width: 160, height: 120, seed: seed + 1 });
  const zone = utmZoneOf((relief.extent.west + relief.extent.east) / 2);
  const toUtm = await warp(relief, { targetCrs: 'UTM', zone, resample: 'bilinear' }, {});
  let roundTripMax = 0;
  let roundTripSum = 0;
  let compared = 0;
  for (let row = 0; row < relief.height; row += 2) {
    for (let col = 0; col < relief.width; col += 2) {
      const world = pixelToWorld(relief, col, row);
      const projected = project(world.x, world.y, 'UTM', { zone });
      const target = worldToPixel(toUtm.raster, projected.x, projected.y);
      const sampled = sampleBilinear(toUtm.raster, target.col, target.row);
      if (sampled === toUtm.raster.nodata) continue;
      const error = Math.abs(sampled - relief.data[row * relief.width + col]);
      roundTripMax = Math.max(roundTripMax, error);
      roundTripSum += error;
      compared += 1;
    }
  }

  return {
    identityWorst,
    planeExactness: shiftedWorst,
    borderNearestFallback: borderPixels,
    reprojection: {
      maxMetres: roundTripMax,
      meanMetres: compared ? roundTripSum / compared : 0,
      compared,
      nodataShare: toUtm.stats.nodataShare,
      tiles: toUtm.stats.tiles,
      ms: toUtm.stats.ms,
      megapixelsPerSecond: toUtm.stats.megapixelsPerSecond,
      utmZone: zone,
    },
    passed: {
      identityExact: identityWorst < 1e-6,
      planeReproduced: shiftedWorst < 1e-6,
      roundTripBounded: compared > 0 && roundTripSum / compared < 1,
    },
  };
}