import { useMemo, useState } from 'react';
import { Telescope, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const DEFAULT_EYEPIECES = [
  { id: 'a', fl: '25', afov: '52' },
  { id: 'b', fl: '10', afov: '60' },
  { id: 'c', fl: '6', afov: '66' },
];

const blank = () => ({ id: Math.random().toString(36).slice(2), fl: '12', afov: '60' });

export default function TelescopeCalculator() {
  const [aperture, setAperture] = useState('130');
  const [focal, setFocal] = useState('900');
  const [eyepieces, setEyepieces] = useState(DEFAULT_EYEPIECES);
  const [barlow, setBarlow] = useState('1');
  const [mode, setMode] = useState('visual');
  const [sensorWidth, setSensorWidth] = useState('23.5');
  const [pixelSize, setPixelSize] = useState('3.8');
  const [eyePupil, setEyePupil] = useState('6');

  const set = (id, key, value) => setEyepieces((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const d = Math.max(20, Number(aperture) || 130);
    const fl = Math.max(100, Number(focal) || 900);
    const barlowFactor = Math.max(1, Number(barlow) || 1);
    const pupil = Math.max(2, Math.min(8, Number(eyePupil) || 6));
    const ratio = fl / d;

    const maxUseful = d * 2;
    const minUseful = d / pupil;
    const rayleigh = 138 / d;
    const dawes = 116 / d;
    const limiting = 2.7 + 5 * Math.log10(d);
    const lightGathering = Math.pow(d / 7, 2);

    const eyepieceRows = eyepieces.map((row) => {
      const eyepieceFl = Math.max(1, Number(row.fl) || 10);
      const apparent = Math.max(30, Number(row.afov) || 50);
      const effectiveFl = fl * barlowFactor;
      const magnification = effectiveFl / eyepieceFl;
      const exitPupil = magnification ? d / magnification : 0;
      const trueFov = magnification ? apparent / magnification : 0;
      const inRange = magnification <= maxUseful * 1.15 && exitPupil >= 0.4;
      const planetary = exitPupil <= 1.2 && magnification <= maxUseful;
      const wide = exitPupil >= pupil * 0.9;
      return {
        ...row, eyepieceFl, apparent, magnification: Number(magnification.toFixed(0)), exitPupil: Number(exitPupil.toFixed(2)),
        trueFov: Number(trueFov.toFixed(2)), inRange, planetary, wide,
        note: !inRange ? (exitPupil < 0.4 ? 'too much magnification for this aperture' : 'beyond the useful magnification limit') : planetary ? 'planetary and lunar detail' : wide ? 'wide field and faint objects' : 'general purpose',
      };
    });

    const sensor = {
      width: Math.max(1, Number(sensorWidth) || 23.5),
      pixel: Math.max(1, Number(pixelSize) || 3.8),
    };
    const imagingFovWidth = (2 * Math.atan(sensor.width / 2 / fl) * 180) / Math.PI;
    const imagingFovHeight = imagingFovWidth * 0.667;
    const imageScale = (sensor.pixel / fl) * 206.265;
    const bestSeeing = imageScale * 2;

    const apertureLadder = [60, 80, 100, 130, 150, 200, 250, 300].map((value) => ({
      label: value + ' mm',
      value: Number((2.7 + 5 * Math.log10(value)).toFixed(2)),
    }));

    return {
      d, fl, ratio, barlowFactor, pupil, maxUseful, minUseful, rayleigh, dawes, limiting, lightGathering, eyepieceRows,
      sensor, imagingFovWidth, imagingFovHeight, imageScale, bestSeeing, apertureLadder,
      chart: eyepieceRows.map((row) => ({ label: row.fl + ' mm', value: row.magnification })),
      optimalEyepiece: Number((fl / (d / 1)).toFixed(1)),
      wideEyepiece: Number((fl / (d / pupil)).toFixed(1)),
    };
  }, [aperture, focal, eyepieces, barlow, sensorWidth, pixelSize, eyePupil]);

  const report = useMemo(() => [
    result.d + ' mm aperture, ' + result.fl + ' mm focal length, f/' + result.ratio.toFixed(1),
    '',
    'Useful magnification range: ' + result.minUseful.toFixed(0) + '× to ' + result.maxUseful.toFixed(0) + '×',
    'Resolving power: ' + result.rayleigh.toFixed(2) + ' arcseconds (Rayleigh), ' + result.dawes.toFixed(2) + ' arcseconds (Dawes)',
    'Limiting magnitude: about ' + result.limiting.toFixed(1),
    'Light gathering: ' + result.lightGathering.toFixed(0) + ' times a 7 mm dark-adapted pupil',
    '',
    'Eyepieces:',
    ...result.eyepieceRows.map((row) => '  ' + row.fl + ' mm → ' + row.magnification + '× · exit pupil ' + row.exitPupil + ' mm · true field ' + row.trueFov + '° · ' + row.note),
    '',
    'An eyepiece of about ' + result.optimalEyepiece.toFixed(0) + ' mm gives a 1 mm exit pupil, which is the sweet spot for planets.',
    'An eyepiece of about ' + result.wideEyepiece.toFixed(0) + ' mm matches your ' + result.pupil + ' mm pupil for the widest, brightest view.',
    '',
    'Imaging with a ' + result.sensor.width + ' mm sensor: field ' + result.imagingFovWidth.toFixed(2) + ' × ' + result.imagingFovHeight.toFixed(2) + '°, scale ' + result.imageScale.toFixed(2) + ' arcseconds per pixel',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="telescope"
      icon={Telescope}
      title="Telescope & Eyepiece Calculator"
      desc="Aperture and focal length into the useful magnification range, resolving power and limiting magnitude — then which of your eyepieces does what, and what it means for imaging."
      state={{ aperture, focal, eyepieces, barlow, mode, sensorWidth, pixelSize, eyePupil }}
      onRestore={(restored) => {
        if (restored.aperture !== undefined) setAperture(String(restored.aperture));
        if (restored.focal !== undefined) setFocal(String(restored.focal));
        if (Array.isArray(restored.eyepieces) && restored.eyepieces.length) setEyepieces(restored.eyepieces);
        if (restored.barlow !== undefined) setBarlow(String(restored.barlow));
        if (restored.mode) setMode(restored.mode);
        if (restored.sensorWidth !== undefined) setSensorWidth(String(restored.sensorWidth));
        if (restored.pixelSize !== undefined) setPixelSize(String(restored.pixelSize));
        if (restored.eyePupil !== undefined) setEyePupil(String(restored.eyePupil));
      }}
      exportText={report}
      exportName="telescope.txt"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'visual', label: 'Visual observing' }, { value: 'imaging', label: 'Imaging' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Aperture, mm"><input value={aperture} onChange={(e) => setAperture(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Focal length, mm"><input value={focal} onChange={(e) => setFocal(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Barlow factor"><input value={barlow} onChange={(e) => setBarlow(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Your dark-adapted pupil, mm"><input value={eyePupil} onChange={(e) => setEyePupil(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      {mode === 'imaging' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Camera sensor width, mm"><input value={sensorWidth} onChange={(e) => setSensorWidth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Pixel size, µm"><input value={pixelSize} onChange={(e) => setPixelSize(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Useful magnification range"
          value={result.minUseful.toFixed(0) + ' to ' + result.maxUseful.toFixed(0)}
          unit="×"
          sub={result.d + ' mm of aperture at f/' + result.ratio.toFixed(1) + ' resolves about ' + result.rayleigh.toFixed(2) + ' arcseconds and reaches magnitude ' + result.limiting.toFixed(1) + ' on a good night. It gathers ' + result.lightGathering.toFixed(0) + ' times as much light as your dark-adapted eye.'}
        />
        <Ring
          value={result.d}
          max={400}
          label="Aperture"
          sub="Aperture sets light gathering and resolution — nothing else compensates for it"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Eyepieces</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.eyepieceRows.length} in the case</span>
          </div>
          <div className="space-y-2">
            {eyepieces.map((row) => {
              const computed = result.eyepieceRows.find((entry) => entry.id === row.id) || {};
              return (
                <div key={row.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Field label="Focal length, mm"><input value={row.fl} onChange={(e) => set(row.id, 'fl', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                    <Field label="Apparent field, °"><input value={row.afov} onChange={(e) => set(row.id, 'afov', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                    <Field label="Magnification">
                      <div className="flex h-9 items-center font-mono-j text-[11px] text-cyan-j">{computed.magnification}× · pupil {computed.exitPupil} mm</div>
                    </Field>
                    <div className="flex items-end">
                      <button type="button" onClick={() => setEyepieces((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{computed.note}</p>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setEyepieces((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3.5 w-3.5" /> Add an eyepiece
          </button>
        </Panel>
        <div className="space-y-3">
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">What each eyepiece is for</div>
            <div className="space-y-1.5">
              {result.eyepieceRows.map((row) => (
                <div key={row.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono-j">{row.fl} mm → {row.magnification}×</span>
                    <span className={row.inRange ? 'text-emerald-300' : 'text-amber-300'}>{row.inRange ? 'usable' : 'outside the useful range'}</span>
                  </div>
                  <div className="mt-0.5 font-mono-j text-[10px] text-muted-foreground">
                    exit pupil {row.exitPupil} mm · true field {row.trueFov}° · {row.note}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The figures</div>
            <div className="space-y-1.5 font-mono-j text-[11px]">
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Focal ratio</span><span>f/{result.ratio.toFixed(1)}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Magnification range</span><span>{result.minUseful.toFixed(0)}× to {result.maxUseful.toFixed(0)}×</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Resolving power</span><span>{result.rayleigh.toFixed(2)}″</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Limiting magnitude</span><span>{result.limiting.toFixed(1)}</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Light gathering</span><span>{result.lightGathering.toFixed(0)}×</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Eyepiece for 1 mm pupil</span><span>{result.optimalEyepiece.toFixed(0)} mm</span></div>
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Eyepiece for widest view</span><span>{result.wideEyepiece.toFixed(0)} mm</span></div>
              {mode === 'imaging' && (
                <>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Image scale</span><span>{result.imageScale.toFixed(2)}″ per pixel</span></div>
                  <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Field of view</span><span className="text-cyan-j">{result.imagingFovWidth.toFixed(2)}° × {result.imagingFovHeight.toFixed(2)}°</span></div>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Magnification of each eyepiece</div>
          <Bars data={result.chart} format={(value) => String(value)} suffix="×" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Magnification is the least important number on this page. It is limited by aperture, and pushing past the top of the useful range only makes the image bigger and
            blurrier.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Limiting magnitude against aperture</div>
          <Bars data={result.apertureLadder} format={(value) => value.toFixed(1)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Each doubling of aperture gains about 1.5 magnitudes, which is roughly a factor of four in brightness. That is why aperture is the specification worth paying for.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Aperture" value={result.d + ' mm'} mono sub={'f/' + result.ratio.toFixed(1)} />
        <Stat label="Resolution" value={result.rayleigh.toFixed(2) + '″'} mono sub="Rayleigh criterion" />
        <Stat label="Limiting magnitude" value={result.limiting.toFixed(1)} mono sub="on a good night" />
        <Stat label="Best eyepiece" value={result.optimalEyepiece.toFixed(0) + ' mm'} mono sub="for a 1 mm exit pupil" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">{mode === 'imaging' ? 'What the imaging numbers mean' : 'Getting the most from this telescope'}</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {mode === 'imaging' ? (
            <>
              <p>· The image scale of {result.imageScale.toFixed(2)} arcseconds per pixel should be about half the seeing, so the sampling suits nights around {result.bestSeeing.toFixed(1)} arcseconds — typical of an average suburban night.</p>
              <p>· Oversampling below the seeing limit wastes light per pixel and needs longer exposures for no gain in detail.</p>
              <p>· The field of {result.imagingFovWidth.toFixed(2)} × {result.imagingFovHeight.toFixed(2)} degrees tells you the framing: the Moon needs about 0.5 degrees and most galaxies less.</p>
              <p>· A faster focal ratio gathers the same light into fewer pixels, so it looks brighter at a given exposure but resolves less per pixel. Matching the pixel size to the focal length matters more than the ratio.</p>
              <p>· Track, guide and stack. Modern results come from many short frames combined, not from single long exposures.</p>
              <p>· Check the back focus and whether your mount actually carries the weight. A telescope that shakes for five seconds after a touch ruins every frame.</p>
            </>
          ) : (
            <>
              <p>· Aperture is light gathering and resolution together. Everything else — eyepieces, filters, Barlows — redistributes what the aperture collects.</p>
              <p>· An eyepiece around {result.optimalEyepiece.toFixed(0)} mm gives a 1 mm exit pupil, the sweet spot for planets and double stars. Around {result.wideEyepiece.toFixed(0)} mm matches your {result.pupil} mm pupil for the brightest wide views.</p>
              <p>· Exit pupils below about 0.5 mm are uncomfortable and reveal floaters in your own eye. Above {result.pupil} mm, the light spills past your pupil and the telescope is effectively stopped down.</p>
              <p>· Let the scope cool to ambient temperature. A warm mirror or lens shows tube currents for twenty minutes, and that looks exactly like bad seeing.</p>
              <p>· Collimate if the design allows it, and give your eyes twenty to thirty minutes to dark-adapt. Both are free and both change what you can see.</p>
              <p>· On most nights the atmosphere limits detail to one or two arcseconds, so a well-collimated {result.d} mm telescope is already at the limit of the sky rather than the limit of the instrument.</p>
            </>
          )}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Eyepieces worth owning</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· One low-power wide field for finding things and for large clusters. This is the eyepiece you will use most.</p>
            <p>· One medium power for general viewing of galaxies, nebulae and the Moon at its full disc.</p>
            <p>· One high power for planets on steady nights, at roughly twice the aperture in millimetres.</p>
            <p>· A Barlow effectively doubles the focal length, giving you two powers per eyepiece. A good one is worth more than a mediocre high-power eyepiece.</p>
            <p>· Apparent field of view is what you actually feel: 50 degrees is standard, 68 feels wide, 82 feels immersive. Wide fields cost disproportionately more.</p>
            <p>· Eye relief matters if you wear glasses. Below about 15 mm of relief you will be taking them off to look through the scope.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Things that limit a telescope more than specification</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The atmosphere. Seeing is usually the ceiling on planets, and transparency on faint objects. Neither is fixed by equipment.</p>
            <p>· Light pollution. Aperture still helps on stars and clusters, but faint nebulae need dark skies or a narrowband filter to be worthwhile.</p>
            <p>· The mount. A shaky mount ruins more observing sessions than a small aperture ever has.</p>
            <p>· Collimation, cooling and focus technique. All three are free and all three are commonly neglected.</p>
            <p>· Experience at the eyepiece. Learning to see faint detail is a skill that improves over many sessions, which is why a beginner with a small scope sees less than the same person a year later.</p>
            <p>· {result.ratio < 5 ? 'Your focal ratio of f/' + result.ratio.toFixed(1) + ' is fast, which suits wide fields and imaging but demands better eyepieces to control edge aberrations.' : result.ratio > 10 ? 'Your focal ratio of f/' + result.ratio.toFixed(1) + ' is slow, which is forgiving on eyepieces and excellent for planets but narrow for wide-field views.' : 'Your focal ratio of f/' + result.ratio.toFixed(1) + ' is a good middle ground between wide-field and planetary use.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Aperture', value: result.d + ' mm' },
                { label: 'Ratio', value: 'f/' + result.ratio.toFixed(1) },
                { label: 'Range', value: result.minUseful.toFixed(0) + '–' + result.maxUseful.toFixed(0) + '×' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>magnification = telescope focal length × Barlow ÷ eyepiece focal length</p>
          <p>exit pupil = aperture ÷ magnification</p>
          <p>true field of view = apparent field ÷ magnification</p>
          <p>maximum useful magnification ≈ 2 × aperture in mm · minimum ≈ aperture ÷ 7 for a 7 mm pupil</p>
          <p>resolving power = 138 ÷ aperture in mm arcseconds · limiting magnitude ≈ 2.7 + 5 log₁₀(aperture)</p>
          <p>image scale = pixel size ÷ focal length × 206.265 arcseconds per pixel</p>
          <p className="text-cyan-j">Check: {result.fl} mm ÷ {result.eyepieceRows[0] ? result.eyepieceRows[0].fl : 25} mm = {result.eyepieceRows[0] ? result.eyepieceRows[0].magnification : 0}× with a {result.eyepieceRows[0] ? result.eyepieceRows[0].exitPupil : 0} mm exit pupil.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Limiting magnitude and resolving power are theoretical figures for ideal skies. In practice seeing, transparency and light pollution usually reduce both, which is why the
          same telescope shows very different things from a city garden and a dark site.
        </p>
      </Panel>
    </ToolShell>
  );
}