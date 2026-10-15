import { useEffect, useMemo, useRef, useState } from 'react';
import { Map, Play, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Seg, Stat } from '../shared';
import { Bars, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { CRS_LABELS, hillshade, makeDem, rasterStats, utmZoneOf, verifyProjections, verifyWarp, warp } from './rasterWarpCore';

const CRS_OPTIONS = [
  { value: 'EPSG:3857', label: 'Web Mercator' },
  { value: 'UTM', label: 'UTM zone' },
  { value: 'EPSG:4326', label: 'WGS84' },
];

const RESAMPLERS = [
  { value: 'bilinear', label: 'Bilinear' },
  { value: 'nearest', label: 'Nearest' },
  { value: 'bicubic', label: 'Bicubic' },
];

const SIZES = [
  { value: 160, label: '160 × 120' },
  { value: 320, label: '320 × 240' },
  { value: 640, label: '640 × 480' },
];

const paint = (canvas, shade, tint) => {
  if (!canvas || !shade) return;
  canvas.width = shade.width;
  canvas.height = shade.height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(shade.width, shade.height);
  for (let i = 0; i < shade.grey.length; i += 1) {
    const value = shade.grey[i];
    image.data[i * 4] = tint ? Math.round(value * 0.35) : Math.round(value * 0.7);
    image.data[i * 4 + 1] = tint ? Math.round(value * 0.8) : Math.round(value * 0.9);
    image.data[i * 4 + 2] = tint ? value : value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
};

/** Gaps are filled along each row for display only, so the preview is not ringed in black. */
const fillGaps = (raster) => {
  const out = { ...raster, data: new Float32Array(raster.data) };
  for (let row = 0; row < raster.height; row += 1) {
    let last = null;
    for (let col = 0; col < raster.width; col += 1) {
      const at = row * raster.width + col;
      if (out.data[at] === raster.nodata) {
        if (last !== null) out.data[at] = last;
      } else last = out.data[at];
    }
  }
  return out;
};

export default function RasterWarpLab() {
  const [width, setWidth] = useState(320);
  const [seed, setSeed] = useState(3);
  const [targetCrs, setTargetCrs] = useState('EPSG:3857');
  const [resample, setResample] = useState('bilinear');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [warped, setWarped] = useState(null);
  const [checks, setChecks] = useState(null);
  const [projections, setProjections] = useState(null);
  const [error, setError] = useState('');
  const [controller] = useState(() => ({ current: null }));
  const sourceCanvas = useRef(null);
  const warpedCanvas = useRef(null);

  const height = Math.round((width * 3) / 4);
  const dem = useMemo(() => makeDem({ width, height, seed }), [width, height, seed]);
  const sourceShade = useMemo(() => hillshade(dem, { exaggeration: 1.4 }), [dem]);
  const stats = useMemo(() => rasterStats(dem), [dem]);

  useEffect(() => { paint(sourceCanvas.current, sourceShade, false); }, [sourceShade]);
  useEffect(() => {
    if (!warped) return;
    paint(warpedCanvas.current, hillshade(fillGaps(warped.raster), { exaggeration: targetCrs === 'EPSG:4326' ? 1.4 : 40 }), true);
  }, [warped, targetCrs]);

  const run = async () => {
    setBusy(true);
    setError('');
    setWarped(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const outcome = await warp(dem, {
        targetCrs,
        resample,
        outWidth: dem.width,
        outHeight: dem.height,
        zone: targetCrs === 'UTM' ? utmZoneOf((dem.extent.west + dem.extent.east) / 2) : undefined,
      }, { onProgress: (update) => setProgress(update), signal: abort.signal });
      setWarped(outcome);
    } catch (thrown) {
      setError(thrown.message || 'The warp could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const runChecks = async () => {
    setBusy(true);
    setError('');
    setProjections(verifyProjections());
    try {
      setChecks(await verifyWarp({ seed }));
    } catch (thrown) {
      setError(thrown.message || 'The checks could not run.');
    }
    setBusy(false);
  };

  return (
    <ToolShell
      toolId="raster-warp"
      icon={Map}
      title="Geospatial Raster Warp Engine"
      desc="Reprojects raster data between WGS84, Web Mercator and UTM by inverting the mapping per output pixel, tile by tile, with nearest, bilinear or bicubic resampling — and checks the projection series against closed forms."
      state={{ width, seed, targetCrs, resample }}
      onRestore={(state) => {
        if (!state) return;
        if (state.width) setWidth(state.width);
        if (state.seed) setSeed(state.seed);
        if (state.targetCrs) setTargetCrs(state.targetCrs);
        if (state.resample) setResample(state.resample);
      }}
      exportText={warped ? [
        `warped ${dem.width}×${dem.height} to ${CRS_LABELS[targetCrs]}`,
        `nodata ${(warped.stats.nodataShare * 100).toFixed(2)}%, ${warped.stats.tiles} tiles, ${warped.stats.ms} ms`,
        `destination extent ${JSON.stringify(warped.stats.extent)}`,
        `elevation ${stats.min.toFixed(1)}–${stats.max.toFixed(1)} m, mean ${stats.mean.toFixed(1)} m`,
      ].join('\n') : ''}
      exportName="warp-report.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={width} onChange={setWidth} options={SIZES} />
        <Seg value={targetCrs} onChange={setTargetCrs} options={CRS_OPTIONS} />
        <Seg value={resample} onChange={setResample} options={RESAMPLERS} />
        <Button size="sm" variant="outline" onClick={() => { setSeed(Math.floor(Math.random() * 999)); setWarped(null); }} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> New terrain
        </Button>
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Warp</Button>}
        <Button size="sm" variant="outline" onClick={runChecks} className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Run projection checks</Button>
      </div>

      <EngineProgress busy={busy} phase={progress?.phase} done={progress?.done} total={progress?.total} stats={progress?.tiles ? [`${progress.tiles} tiles`] : []} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Source — {dem.width}×{dem.height} on {CRS_LABELS['EPSG:4326']}</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{stats.min.toFixed(0)}–{stats.max.toFixed(0)} m</span>
          </div>
          <canvas ref={sourceCanvas} className="w-full rounded-lg border border-border/60" />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Warped — {CRS_LABELS[targetCrs]}</span>
            {warped && <span className="font-mono-j text-[10px] text-muted-foreground">{warped.stats.tiles} tiles · {warped.stats.ms} ms</span>}
          </div>
          <canvas ref={warpedCanvas} className="w-full rounded-lg border border-border/60" />
          {!warped && <div className="mt-2 text-[11px] text-muted-foreground">Warp the terrain to fill this panel. Gaps at the edge of the reprojected footprint are filled along each row for display only.</div>}
        </Panel>
      </div>

      {warped && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Valid pixels" value={`${(100 - warped.stats.nodataShare * 100).toFixed(2)}%`} sub={`${warped.stats.nodataPixels.toLocaleString()} nodata of ${(dem.width * dem.height).toLocaleString()}`} mono />
          <Stat label="Throughput" value={`${warped.stats.megapixelsPerSecond.toFixed(2)} Mpx/s`} sub={`${warped.stats.resample} resampling`} mono />
          <Stat label="Zone used" value={warped.stats.zone ?? '—'} sub={targetCrs === 'UTM' ? 'central meridian per raster' : 'not zone-based'} mono />
        </div>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-semibold">Elevation histogram</div>
        <Bars data={stats.bins.map((bin) => ({ label: bin.label, value: bin.value }))} />
      </Panel>

      {projections && (
        <VerifyPanel
          title="Projection checks"
          items={[
            { label: 'Mercator round trip returns the same point', ok: projections.mercator.roundTripMaxDeg < 1e-9, detail: `worst ${projections.mercator.roundTripMaxDeg.toExponential(2)}°` },
            { label: 'UTM round trip returns the same point', ok: projections.utm.roundTripMaxMetres < 0.01, detail: `worst ${projections.utm.roundTripMaxMetres.toExponential(2)} m` },
            { label: 'The central meridian sits exactly on 500 000 m easting', ok: projections.utm.eastingDeviationMetres < 1e-6, detail: `deviation ${projections.utm.eastingDeviationMetres.toExponential(2)} m` },
            { label: 'The meridian arc matches quadrature, not just its own series', ok: projections.utm.meridianArcRelative < 1e-6, detail: `relative difference ${projections.utm.meridianArcRelative.toExponential(2)}` },
            { label: 'Numerically differentiated scale matches the independent series', ok: projections.scale.maxRelativeDifference < 0.01, detail: `worst ${(projections.scale.maxRelativeDifference * 100).toFixed(3)}%, 0.9996 on the central meridian` },
            { label: 'Mercator derivatives match their closed forms', ok: projections.mercatorDerivatives.maxRelativeError < 1e-5, detail: `worst ${projections.mercatorDerivatives.maxRelativeError.toExponential(2)}` },
          ]}
          note="The meridian arc is independently integrated by Gauss-Legendre quadrature, and the scale factor is recovered by differentiating the forward mapping numerically rather than by reading the series it is compared with."
        />
      )}

      {checks && (
        <VerifyPanel
          title="Warp checks"
          items={[
            { label: 'A warp onto its own grid is bit-exact', ok: checks.passed.identityExact, detail: `worst difference ${checks.identityWorst.toExponential(2)} m` },
            { label: 'Bilinear reproduces a planar surface through a fractional shift', ok: checks.passed.planeReproduced, detail: `worst interior error ${checks.planeExactness.toExponential(2)} m (${checks.borderNearestFallback} border pixel(s) use nearest by design)` },
            { label: 'Reprojection and read-back agree with the source', ok: checks.passed.roundTripBounded, detail: `${checks.reprojection.compared} points compared, mean ${checks.reprojection.meanMetres.toFixed(3)} m, worst ${checks.reprojection.maxMetres.toFixed(2)} m` },
          ]}
          note="The planar test is a property the resampler must satisfy exactly: bilinear interpolation reproduces any linear surface, so any error there is the resampler's, not the terrain's."
        />
      )}

      <Pills items={[
        { label: 'raster', value: `${dem.width}×${dem.height}` },
        { label: 'target', value: CRS_LABELS[targetCrs] },
        { label: 'resampling', value: resample },
        { label: 'extent', value: `${dem.extent.west.toFixed(1)}–${dem.extent.east.toFixed(1)}°E` },
      ]} />

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Each output pixel is mapped back through the target projection and the source geotransform, so there is no forward scatter and no hole filling to invent data.</p>
          <p>· UTM is the full Krüger series on the GRS80 ellipsoid, with zone selection and the southern false northing, not a spherical approximation.</p>
          <p>· Work proceeds tile by tile with a hand-back to the browser between rows, which keeps the progress line and the Stop button honest on large rasters.</p>
          <p>· Pixels that fall outside the source footprint stay nodata rather than being clipped to the nearest edge.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}