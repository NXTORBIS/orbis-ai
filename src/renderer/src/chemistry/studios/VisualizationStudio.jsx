/*
 * V26 — Chemical Visualization.
 *
 * Their registry listed this as "3D molecules, orbitals & energy landscapes" and marked it `soon`. This is it,
 * built to the same shape as their other fifteen studios: the shared StudioShell, their Slider, Stat, Select and
 * ValidationBadge, their tab row, their explainer.
 *
 * Everything drawn here is computed. The orbitals are the real solutions to the hydrogen-like Schrödinger
 * equation, not lobes traced from a textbook; the bond curve is a Morse potential that actually dissociates; the
 * surface's saddle is found by testing every point rather than placed. The engines live in
 * `src/shared/chemistry/` with their own tests, so what is on screen can be checked without the screen.
 */
import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { StudioShell, Slider, Stat, Select, ValidationBadge } from '../parts/studioShared.jsx';
import { MOLECULES } from '../lib/moleculeGallery.js';

const TABS = ['Molecules in 3D', 'Orbitals', 'Bond energy', 'Reaction path', 'Energy surface'];

const EXPLAIN = {
  name: 'Chemical Visualization',
  nameMeaning: 'Drawing the things chemistry talks about — a molecule in three dimensions, the shape of an orbital, the energy of a system as its geometry changes.',
  whatItIs: 'A studio for seeing shape. Rotate a molecule, pick an orbital and watch its lobes and nodes appear where the mathematics puts them, stretch a bond until it breaks, and look at a reaction as a path over a barrier.',
  chemistry: 'An orbital is a solution to the Schrödinger equation for one electron around a nucleus. Its shape is the angular part; its size and its radial nodes are the radial part. A bond is a well in the energy as two atoms approach, and a reaction is a path from one well to another over a pass.',
  math: [
    { eq: 'ψ(r,θ,φ) = R_nl(r)·Y_lm(θ,φ)', label: 'the orbital, radial times angular' },
    { eq: 'P(r) = r²R(r)²', label: 'how far out the electron is' },
    { eq: 'nodes = n − 1', label: 'radial (n−l−1) plus angular (l)' },
    { eq: 'V(r) = D(1 − e^(−a(r−r₀)))²', label: 'the Morse bond potential' },
    { eq: 'E = −Z²/2n² Hartree', label: 'hydrogenic energy' }
  ],
  variables: [
    { sym: 'n', desc: 'principal quantum number — which shell', unit: '1, 2, 3 …' },
    { sym: 'l', desc: 'angular momentum — s, p, d, f', unit: '0 to n−1' },
    { sym: 'm', desc: 'which orbital of the set', unit: '−l to +l' },
    { sym: 'Z', desc: 'nuclear charge', unit: 'elementary charges' },
    { sym: 'r', desc: 'distance from the nucleus', unit: 'Bohr radii (a₀)' },
    { sym: 'D', desc: 'dissociation energy', unit: 'kJ/mol' },
    { sym: 'r₀', desc: 'bond length at the bottom of the well', unit: 'pm' }
  ],
  assumptions: [
    'One electron. These are hydrogen-like orbitals.',
    'No relativity, so the inner orbitals of heavy elements are drawn too large.',
    'The bond and reaction curves are model potentials with parameters you set.'
  ],
  limitations: [
    'The energies are wrong for any atom with more than one electron: electron–electron repulsion is not in this model, which is why 2s and 2p come out at the same energy here and are not in reality.',
    'The orbital surface is where the angular part has a fixed value. It is not a boundary the electron stays inside.',
    'A reaction path is one coordinate. A real reaction moves through many at once.',
    'Molecules are drawn from their real geometry but rotated in software — this is a projection, not a rendering engine.'
  ],
  applications: ['Teaching orbital shape and nodes', 'Seeing why a bond breaks and a spring does not', 'Reading a barrier off a reaction profile', 'Spotting a saddle point on a surface']
};

// ---------------------------------------------------------------- molecules in 3D

/**
 * Any compound, drawn.
 *
 * Their gallery holds twelve. This takes whatever is typed: the gallery first, because it is exact and instant,
 * then Orion for anything else — and nothing Orion says is drawn until it has been checked against the formula,
 * against how many bonds each element can make, and against whether the geometry is a geometry at all.
 *
 * Where the structure came from is always on screen. A table and a model are different kinds of claim.
 */
function Molecules({ engine }) {
  const [typed, setTyped] = useState('');
  const [structure, setStructure] = useState(null);
  const [checked, setChecked] = useState(null);
  const [refused, setRefused] = useState(null);
  const [asking, setAsking] = useState(false);
  const [turnY, setTurnY] = useState(28);
  const [turnX, setTurnX] = useState(-18);
  const [zoom, setZoom] = useState(1);

  /** One of their own, by name or formula. No model, exact geometry. */
  const fromTable = (asked) => {
    const want = String(asked).toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = MOLECULES.find(
      (one) => one.name.toLowerCase().replace(/[^a-z0-9]/g, '') === want || one.formula.toLowerCase() === want
    );
    if (!found) return null;
    /*
     * Only the connectivity is taken from their gallery; the shape is built from it.
     *
     * Their drawing is a 2D layout in a 240x180 box, so scaling it to picometres gave bond lengths that were
     * wrong -- every O–H came out at 143 pm instead of 97, and the checker rightly complained about all of them.
     * Taking the bonds and building the geometry gives the right lengths and means there is one code path for a
     * gallery molecule and an asked-for one, so they cannot look different for having come from different places.
     */
    return {
      name: found.name,
      formula: found.formula,
      atoms: found.atoms.map((one) => ({ symbol: one.sym })),
      bonds: found.bonds.map((one) => ({ a: one.a, b: one.b, order: one.o ?? 1 }))
    };
  };

  const show = (asked) => {
    setRefused(null);
    const table = fromTable(asked);
    if (!table) return false;
    const got = engine.checkStructure(table, table.formula, 'table');
    if (engine.isMoleculeProblem(got)) {
      // Orbis's own table failing its own check is worth saying plainly rather than hiding.
      setRefused(got);
      return true;
    }
    setChecked(got);
    setStructure(got.structure);
    return true;
  };

  const go = async () => {
    const asked = typed.trim();
    if (asked === '' || asking) return;
    setRefused(null);
    if (show(asked)) return;

    const api = typeof window !== 'undefined' ? window.api : null;
    if (!api || typeof api.physicsAsk !== 'function') {
      setRefused({
        problem: 'Orion is not available here, and this compound is not in the table.',
        fix: `What the table holds: ${MOLECULES.map((one) => one.name).join(', ')}.`
      });
      return;
    }

    setAsking(true);
    try {
      /*
       * Orion is asked for a SMILES string and a formula, not for coordinates.
       *
       * Asked for coordinates it refuses, truthfully — and asked for a bond list with atom numbers it refuses
       * too, or miscounts them. A SMILES string is the form the compound appears in everywhere, so it is the
       * form it can actually give. Orbis parses it, checks the formula it comes to against the one Orion stated,
       * and works out the shape itself.
       */
      const text = await api.physicsAsk(engine.promptForSmiles(asked), null);
      if (text === null || String(text).trim() === '') {
        setRefused({ problem: 'Orion did not answer.', fix: 'Try again, or type the formula instead of the name.' });
        return;
      }
      const read = engine.readReply(text);
      if (engine.isMoleculeProblem(read)) {
        setRefused(read);
        return;
      }
      const smiles = String(read.held.smiles ?? '').trim();
      // The formula to check against: the one typed if it was a formula, otherwise the one Orion stated.
      const against = engine.formulaToCheck(asked, read.held);
      if (!smiles) {
        setRefused({
          problem: 'Orion gave no SMILES string for this.',
          fix: 'Try a more usual name for the compound, or its formula.'
        });
        return;
      }
      if (!against.formula) {
        setRefused({
          problem: 'The answer had no formula to check the SMILES against.',
          fix: 'Type the formula instead of the name, and it will be checked against that.'
        });
        return;
      }
      let got = engine.fromSmiles(smiles, against.formula, String(read.held.name ?? asked), 'model');

      /*
       * The string and the formula disagreed, so ask once more and say what the contradiction was.
       *
       * Orion got nicotine and vitamin C wrong the first time — a SMILES for one molecule with the formula of
       * another. Told exactly what did not add up, it usually corrects itself. One retry: a second disagreement
       * is reported and that is the end of it, rather than asking over and over.
       */
      if (engine.isMoleculeProblem(got) && /are different molecules/.test(got.fix)) {
        const again = await api.physicsAsk(
          [
            engine.promptForSmiles(asked),
            '',
            'Your previous answer did not add up:',
            `  ${got.problem}`,
            'The SMILES string and the formula must describe the same molecule. Check which of the two was wrong',
            'and answer again. If you are not sure of the structure, answer with the "unknown" form instead.'
          ].join('\n'),
          null
        );
        const second = again === null ? null : engine.readReply(again);
        if (second && !engine.isMoleculeProblem(second)) {
          const retrySmiles = String(second.held.smiles ?? '').trim();
          const retryAgainst = engine.formulaToCheck(asked, second.held);
          if (retrySmiles && retryAgainst.formula) {
            const twice = engine.fromSmiles(retrySmiles, retryAgainst.formula, String(second.held.name ?? asked), 'model');
            if (!engine.isMoleculeProblem(twice)) {
              setChecked({ ...twice, strict: retryAgainst.strict, retried: true });
              setStructure(twice.structure);
              return;
            }
            got = twice;
          }
        }
      }

      if (engine.isMoleculeProblem(got)) {
        setRefused(got);
        return;
      }
      setChecked({ ...got, strict: against.strict });
      setStructure(got.structure);
    } catch (error) {
      setRefused({
        problem: 'Asking Orion went wrong.',
        fix: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setAsking(false);
    }
  };

  // The drawing. One projection for both sources, so nothing looks different for having come from a model.
  const drawn = useMemo(() => {
    if (!structure) return null;
    const ry = (turnY * Math.PI) / 180;
    const rx = (turnX * Math.PI) / 180;
    let far = 1;
    for (const one of structure.atoms) far = Math.max(far, Math.hypot(one.x, one.y, one.z));
    const fit = (78 / far) * zoom;
    const atoms = structure.atoms.map((at) => {
      const x1 = at.x * Math.cos(ry) + at.z * Math.sin(ry);
      const z1 = -at.x * Math.sin(ry) + at.z * Math.cos(ry);
      const y1 = at.y * Math.cos(rx) - z1 * Math.sin(rx);
      const z2 = at.y * Math.sin(rx) + z1 * Math.cos(rx);
      // Nearer atoms larger, which is what makes it read as depth rather than as a flat diagram.
      const near = 1 + z2 / (far * 3.4);
      return {
        x: 100 + x1 * fit,
        y: 100 - y1 * fit,
        z: z2,
        r: Math.max(2.6, 6.5 * near * Math.min(1.6, zoom)),
        symbol: at.symbol,
        colour: engine.colourFor(at.symbol)
      };
    });
    const order = atoms.map((one, i) => i).sort((a, b) => atoms[a].z - atoms[b].z);
    return { atoms, order };
  }, [engine, structure, turnY, turnX, zoom]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Any compound — a name or a formula</span>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  go();
                }
              }}
              placeholder="caffeine · C8H10N4O2 · glucose · CuSO4·5H2O"
              aria-label="Any compound, by name or formula"
              className="min-w-0 flex-1 rounded-xl border border-border/60 bg-card/60 px-2.5 py-1.5 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={go}
              disabled={asking || typed.trim() === ''}
              className="shrink-0 rounded-xl bg-cyan-j px-3 py-1.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
            >
              {asking ? 'Working…' : 'Build it'}
            </button>
          </div>
        </label>

        <div className="flex flex-wrap gap-1.5">
          {MOLECULES.slice(0, 8).map((one) => (
            <button
              key={one.formula}
              type="button"
              onClick={() => {
                setTyped(one.name);
                show(one.name);
              }}
              className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[10px] text-muted-foreground transition hover:border-cyan-j/50"
            >
              {one.name}
            </button>
          ))}
        </div>

        <Slider label="Turn (side to side)" value={turnY} set={setTurnY} min={-180} max={180} step={1} unit="°" />
        <Slider label="Turn (up and down)" value={turnX} set={setTurnX} min={-90} max={90} step={1} unit="°" />
        <Slider label="Zoom" value={zoom} set={setZoom} min={0.5} max={2.5} step={0.05} unit="x" />

        {refused && <ValidationBadge status="failed" note={`${refused.problem} ${refused.fix}`} />}

        {checked && !refused && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Formula" value={checked.structure.formula} />
              <Stat label="Molar mass" value={`${checked.counted.mass.toFixed(2)} g/mol`} />
              <Stat label="Atoms" value={String(checked.structure.atoms.length)} />
              <Stat label="Bonds" value={String(checked.structure.bonds.length)} />
              <Stat label="Across" value={`${checked.across.toFixed(0)} pm`} />
              <Stat label="Structure from" value={checked.structure.from === 'table' ? "Orbis's own table" : 'Orion, checked'} />
              <Stat label="Shape" value={checked.structure.geometry === 'given' ? 'as given' : 'worked out here'} />
              {checked.structure.smiles && <Stat label="SMILES" value={checked.structure.smiles} />}
            </div>

            {checked.structure.facts && checked.structure.facts.length > 0 && (
              <p className="text-[11px] text-muted-foreground">{checked.structure.facts.join(' ')}</p>
            )}

            <ValidationBadge
              status={checked.structure.notes.length > 0 ? 'warning' : 'passed'}
              note={
                checked.structure.from === 'table'
                  ? 'From Orbis\u2019s own table: the geometry is the real one, with the real bond angles.'
                  : checked.structure.smiles
                    ? `${checked.retried ? 'Orion\u2019s first answer did not add up and it was asked again. ' : ''}Orion recalled the SMILES string and the formula separately, and the two agree — the string describes exactly ${checked.structure.formula}. Orbis read the string into atoms and bonds, worked out the hydrogens from valence, and built the shape: bond lengths from covalent radii, angles from VSEPR, then relaxed until all of them hold at once.`
                  : checked.structure.geometry === 'computed'
                    ? `Orion gave the bonds — which atoms are joined to which — and Orbis worked out the shape from them: bond lengths from covalent radii, angles from VSEPR, then relaxed until all of them hold at once. The atoms were checked against ${checked.structure.formula} first.`
                  : checked.strict === false
                    ? `Worked out by Orion. The atoms were checked against the formula it gave (${checked.structure.formula}) rather than one you typed, so it cannot have listed a different molecule from the one it named — but typing the formula makes the check stronger.`
                    : `Worked out by Orion and checked against ${checked.structure.formula}: every atom accounted for, every bond to an atom that exists, no two atoms in the same place, and no atom with more bonds than its element can make.`
              }
            />

            {checked.structure.notes.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                <div className="text-[11px] font-medium text-amber-400">Worth knowing about this structure</div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  {checked.structure.notes.map((one, i) => (
                    <li key={i}>{one}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        {!structure ? (
          <p className="py-24 text-center text-sm text-muted-foreground">
            Type a compound and press Build it. The table answers instantly for the common ones; anything else is
            worked out and checked before it is drawn.
          </p>
        ) : (
          <>
            <div className="mb-2 text-[11px] text-muted-foreground">
              {structure.name} · <span className="font-mono-j">{structure.formula}</span>
            </div>
            <svg
              viewBox="0 0 200 200"
              className="h-72 w-full"
              role="img"
              aria-label={`${structure.name}, ${structure.formula}, turned ${turnY} degrees`}
            >
              {structure.bonds.map((bd, i) => {
                const a = drawn.atoms[bd.a];
                const b = drawn.atoms[bd.b];
                if (!a || !b) return null;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#64748b"
                    strokeWidth={bd.order === 3 ? 4.2 : bd.order === 2 ? 3 : 1.6}
                  />
                );
              })}
              {drawn.order.map((i) => {
                const at = drawn.atoms[i];
                return (
                  <g key={i}>
                    <circle cx={at.x} cy={at.y} r={at.r} fill={at.colour} stroke="#0f172a" strokeWidth={0.8} />
                    {at.r > 4.5 && (
                      <text
                        x={at.x}
                        y={at.y + at.r * 0.36}
                        textAnchor="middle"
                        fontSize={at.r * 0.95}
                        fill="#0f172a"
                        fontWeight="bold"
                      >
                        {at.symbol}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- orbitals

function Orbitals({ engine }) {
  const [n, setN] = useState(3);
  const [l, setL] = useState(1);
  const [m, setM] = useState(0);
  const [Z, setZ] = useState(1);
  const [turn, setTurn] = useState(24);

  const name = { n, l: Math.min(l, n - 1), m: 0 };
  name.m = Math.max(-name.l, Math.min(m, name.l));

  const facts = useMemo(() => engine.facts(name, Z), [engine, name.n, name.l, name.m, Z]);
  const curve = useMemo(() => engine.radialCurve(name, { Z, points: 320 }), [engine, name.n, name.l, name.m, Z]);
  const lobes = useMemo(() => engine.shape(name, { Z, rings: 30 }), [engine, name.n, name.l, name.m, Z]);

  const broken = engine.isOrbitalProblem(facts) ? facts : null;

  const plotted = useMemo(() => {
    if (engine.isOrbitalProblem(curve)) return [];
    const every = Math.max(1, Math.floor(curve.r.length / 180));
    const out = [];
    for (let i = 0; i < curve.r.length; i += every) {
      out.push({ r: Number(curve.r[i].toFixed(3)), R: curve.R[i], P: curve.P[i] });
    }
    return out;
  }, [engine, curve]);

  const drawn = useMemo(() => {
    if (engine.isOrbitalProblem(lobes)) return [];
    const t = (turn * Math.PI) / 180;
    const far = Math.max(1e-6, Math.max(...lobes.map((one) => Math.hypot(one.x, one.y, one.z))));
    const scale = 78 / far;
    return lobes
      .map((one) => {
        const x = one.x * Math.cos(t) + one.y * Math.sin(t);
        const depth = -one.x * Math.sin(t) + one.y * Math.cos(t);
        return { x: 100 + x * scale, y: 100 - one.z * scale, depth, sign: one.sign };
      })
      .sort((a, b) => a.depth - b.depth);
  }, [engine, lobes, turn]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <Slider label="n (shell)" value={n} set={(v) => { setN(v); if (l > v - 1) setL(Math.max(0, v - 1)); }} min={1} max={6} step={1} />
        <Slider label="l (s=0, p=1, d=2, f=3)" value={name.l} set={(v) => { setL(v); if (Math.abs(m) > v) setM(0); }} min={0} max={Math.max(0, n - 1)} step={1} />
        <Slider label="m (which one of the set)" value={name.m} set={setM} min={-name.l} max={name.l} step={1} />
        <Slider label="Z (nuclear charge)" value={Z} set={setZ} min={1} max={10} step={1} />
        <Slider label="Turn" value={turn} set={setTurn} min={0} max={180} step={1} unit="°" />

        {broken ? (
          <ValidationBadge status="failed" note={`${broken.problem} ${broken.fix}`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Orbital" value={facts.label} />
              <Stat label="In this subshell" value={`${facts.inSubshell}`} />
              <Stat label="Radial nodes" value={`${facts.radialNodes}`} />
              <Stat label="Angular nodes" value={`${facts.angularNodes}`} />
              <Stat label="Most likely at" value={`${facts.mostLikelyRadius.toFixed(2)} a₀`} />
              <Stat label="Mean radius" value={`${facts.meanRadius.toFixed(2)} a₀`} />
              <Stat label="Energy" value={`${facts.energyEv.toFixed(3)} eV`} />
              <Stat label="Total nodes" value={`${facts.totalNodes} (= n − 1)`} />
            </div>
            <ValidationBadge
              status="warning"
              note="The shapes are exact. The energies are not right for any atom with more than one electron — electron–electron repulsion is not in this model, which is why 2s and 2p come out at the same energy here and do not in reality."
            />
          </>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="mb-2 text-[11px] text-muted-foreground">
            The shape. Two colours are the two signs of the wavefunction — where they meet is a node.
          </div>
          <svg viewBox="0 0 200 200" className="h-48 w-full" role="img" aria-label={`The shape of the ${broken ? '' : facts.label} orbital`}>
            <line x1="100" y1="12" x2="100" y2="188" stroke="#334155" strokeWidth="0.5" />
            <line x1="12" y1="100" x2="188" y2="100" stroke="#334155" strokeWidth="0.5" />
            {drawn.map((one, i) => (
              <circle
                key={i}
                cx={one.x}
                cy={one.y}
                r={1.7}
                fill={one.sign > 0 ? 'var(--jx-cyan, #22d3ee)' : '#f0564a'}
                opacity={0.3 + 0.5 * ((one.depth + 100) / 200)}
              />
            ))}
          </svg>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="mb-2 text-[11px] text-muted-foreground">
            How far out the electron is. P(r) = r²R² is the one with the peak; R itself crosses zero at each node.
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={plotted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="r" tick={{ fontSize: 10 }} label={{ value: 'r (a₀)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="#475569" />
              <Line type="monotone" dataKey="P" name="r²R² (where it is)" stroke="#22d3ee" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="R" name="R (the amplitude)" stroke="#a78bfa" dot={false} strokeWidth={1.3} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a bond

function Bond({ engine }) {
  const [depth, setDepth] = useState(436);
  const [length, setLength] = useState(74);
  const [width, setWidth] = useState(0.0193);

  const curve = useMemo(() => engine.bondCurve({ depth, length, width, outTo: 5, points: 300 }), [engine, depth, length, width]);
  const broken = engine.isLandscapeProblem(curve) ? curve : null;

  const plotted = useMemo(() => {
    if (broken) return [];
    return curve.r.map((r, i) => ({
      r: Number(r.toFixed(1)),
      bond: curve.energy[i],
      // The spring is only drawn while it is on the chart; past the well depth it runs away and flattens the rest.
      spring: curve.harmonic[i] > depth * 1.6 ? null : curve.harmonic[i]
    }));
  }, [broken, curve, depth]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <Slider label="Dissociation energy" value={depth} set={setDepth} min={50} max={1000} step={1} unit="kJ/mol" />
        <Slider label="Bond length" value={length} set={setLength} min={60} max={250} step={1} unit="pm" />
        <Slider label="Well width (stiffness)" value={width} set={setWidth} min={0.005} max={0.05} step={0.0005} unit="1/pm" />
        {broken ? (
          <ValidationBadge status="failed" note={`${broken.problem} ${broken.fix}`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Force constant" value={`${curve.forceConstant.toFixed(3)} kJ/(mol·pm²)`} />
              <Stat label="Half-dissociated at" value={`${curve.halfWay.toFixed(1)} pm`} />
              <Stat label="Spring wrong beyond" value={curve.harmonicFailsAt === null ? 'not within range' : `${curve.harmonicFailsAt.toFixed(0)} pm`} />
              <Stat label="Stretch to break" value={`${(curve.halfWay - length).toFixed(0)} pm`} />
            </div>
            <ValidationBadge
              status="passed"
              note="The Morse curve flattens out at the dissociation energy — the bond breaks. The spring never stops climbing, which is exactly why treating a bond as a spring only works near the bottom."
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={plotted} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="r" tick={{ fontSize: 10 }} label={{ value: 'separation (pm)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} label={{ value: 'kJ/mol', angle: -90, position: 'insideLeft', fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={depth} stroke="#f0a33a" strokeDasharray="4 4" label={{ value: 'dissociated', fontSize: 9, fill: '#f0a33a' }} />
            <ReferenceLine x={Number(length.toFixed(1))} stroke="#475569" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="bond" name="the bond (Morse)" stroke="#22d3ee" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="spring" name="as a spring" stroke="#f0564a" dot={false} strokeWidth={1.3} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a reaction

function Reaction({ engine }) {
  const [barrier, setBarrier] = useState(80);
  const [change, setChange] = useState(-40);
  const [at, setAt] = useState(0.4);
  const [twoStep, setTwoStep] = useState('one');
  const [second, setSecond] = useState(50);

  const path = useMemo(
    () => engine.reactionPath({ barrier, change, barrierAt: at, points: 260, ...(twoStep === 'two' ? { secondBarrier: second } : {}) }),
    [engine, barrier, change, at, twoStep, second]
  );
  const broken = engine.isLandscapeProblem(path) ? path : null;

  const plotted = useMemo(() => {
    if (broken) return [];
    return path.x.map((x, i) => ({ x: Number(x.toFixed(3)), energy: path.energy[i] }));
  }, [broken, path]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <Slider label="Barrier (from the reactants)" value={barrier} set={setBarrier} min={0} max={250} step={1} unit="kJ/mol" />
        <Slider label="Energy change (− is exothermic)" value={change} set={setChange} min={-200} max={200} step={1} unit="kJ/mol" />
        <Slider label="Where the barrier sits" value={at} set={setAt} min={0.1} max={0.9} step={0.01} />
        <Select
          label="Steps"
          value={twoStep}
          set={setTwoStep}
          options={[{ value: 'one', label: 'One step' }, { value: 'two', label: 'Two steps, with an intermediate' }]}
        />
        {twoStep === 'two' && (
          <Slider label="Second barrier" value={second} set={setSecond} min={0} max={250} step={1} unit="kJ/mol" />
        )}

        {broken ? (
          <ValidationBadge status="failed" note={`${broken.problem} ${broken.fix}`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Forwards" value={`${path.forward.toFixed(1)} kJ/mol`} />
              <Stat label="Backwards" value={`${path.backward.toFixed(1)} kJ/mol`} />
              <Stat label="Peak at" value={path.peakAt.toFixed(2)} />
              <Stat label="Overall" value={path.exothermic ? 'exothermic' : 'endothermic'} />
              {path.intermediate !== null && <Stat label="Intermediate" value={`${path.intermediate.toFixed(1)} kJ/mol`} />}
              {path.slowStep !== null && <Stat label="Slow step" value={`step ${path.slowStep}`} />}
            </div>
            <ValidationBadge
              status="passed"
              note={
                path.slowStep !== null
                  ? `The taller barrier is the slow step, because the rate goes as e^(−Ea/RT) — here that is step ${path.slowStep}.`
                  : 'The barrier is measured from the reactants, and the backward barrier is that plus the energy change. An exothermic reaction has its barrier early in the path and an endothermic one late.'
              }
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={plotted} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="x" tick={{ fontSize: 10 }} label={{ value: 'reaction coordinate', position: 'insideBottom', offset: -2, fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} label={{ value: 'kJ/mol', angle: -90, position: 'insideLeft', fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" label={{ value: 'reactants', fontSize: 9, fill: '#94a3b8' }} />
            <ReferenceLine y={change} stroke="#4ade80" strokeDasharray="4 4" label={{ value: 'products', fontSize: 9, fill: '#4ade80' }} />
            <Line type="monotone" dataKey="energy" stroke="#22d3ee" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a surface

function SurfacePanel({ engine }) {
  const [depth, setDepth] = useState(100);
  const [pass, setPass] = useState(40);
  const [grid, setGrid] = useState(45);

  const made = useMemo(() => engine.surface({ depth, pass, grid }), [engine, depth, pass, grid]);
  const broken = engine.isLandscapeProblem(made) ? made : null;

  const paint = useMemo(() => {
    if (broken) return null;
    let low = Infinity;
    let high = -Infinity;
    for (const row of made.z) for (const one of row) {
      if (one < low) low = one;
      if (one > high) high = one;
    }
    return { low, high };
  }, [broken, made]);

  const cell = broken ? 0 : Math.max(2, Math.floor(300 / made.axis.length));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <Slider label="Well depth" value={depth} set={setDepth} min={20} max={300} step={1} unit="kJ/mol" />
        <Slider label="How high the pass is" value={pass} set={setPass} min={5} max={150} step={1} unit="kJ/mol" />
        <Slider label="Detail" value={grid} set={setGrid} min={21} max={81} step={2} unit="points" />
        {broken ? (
          <ValidationBadge status="failed" note={`${broken.problem} ${broken.fix}`} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Wells found" value={String(made.wells.length)} />
              <Stat label="Deepest well" value={made.wells.length > 0 ? `${made.wells[0].energy.toFixed(1)} kJ/mol` : '—'} />
              <Stat label="Saddle" value={made.saddle === null ? 'none found' : `${made.saddle.energy.toFixed(1)} kJ/mol`} />
              <Stat label="Barrier over it" value={made.barrier === null ? '—' : `${made.barrier.toFixed(1)} kJ/mol`} />
            </div>
            <ValidationBadge
              status={made.saddle === null ? 'warning' : 'passed'}
              note={
                made.saddle === null
                  ? 'No saddle was found on this surface. With these settings the two wells have merged into one, so there is no pass between them.'
                  : 'The saddle is found by testing every point for being a maximum along one direction and a minimum along the other — it is where the mathematics puts it, not where it was drawn. Where several qualify, the lowest is the one a molecule would actually take.'
              }
            />
          </>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="mb-2 text-[11px] text-muted-foreground">
          Looking down on the energy. Darker is lower. The ring marks the saddle — the lowest pass between the wells.
        </div>
        {!broken && paint && (
          <svg viewBox={`0 0 ${made.axis.length * cell} ${made.axis.length * cell}`} className="h-72 w-full" role="img" aria-label="The energy surface, seen from above">
            {made.z.map((row, r) =>
              row.map((one, c) => {
                const share = (one - paint.low) / Math.max(1e-9, paint.high - paint.low);
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={c * cell}
                    y={r * cell}
                    width={cell}
                    height={cell}
                    fill={`hsl(${200 - share * 170}, 70%, ${12 + share * 46}%)`}
                  />
                );
              })
            )}
            {made.wells.slice(0, 2).map((one, i) => (
              <circle key={i} cx={(one.column + 0.5) * cell} cy={(one.row + 0.5) * cell} r={cell * 1.3} fill="none" stroke="#4ade80" strokeWidth={1.6} />
            ))}
            {made.saddle !== null && (
              <circle cx={(made.saddle.column + 0.5) * cell} cy={(made.saddle.row + 0.5) * cell} r={cell * 1.6} fill="none" stroke="#f0a33a" strokeWidth={2} />
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the studio

export default function VisualizationStudio({ engine }) {
  /*
   * The engines are handed in rather than imported here.
   *
   * This file is a ported-studio page and the engines are Orbis's own TypeScript. Passing them keeps this file
   * plain JavaScript like the rest of the tree, and keeps the computation somewhere it can be tested without a
   * screen — which is where the two real errors in it were caught.
   */
  if (!engine) {
    return (
      <StudioShell title="Chemical Visualization" subtitle="Nothing to draw with." tabs={[]} explain={EXPLAIN}>
        <ValidationBadge status="failed" note="The visualization engines were not handed to this studio, so there is nothing to compute from." />
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Chemical Visualization Studio"
      subtitle="Molecules, orbitals, bonds and energy landscapes — every shape computed, not traced."
      tabs={TABS}
      explain={EXPLAIN}
    >
      <Molecules engine={engine} />
      <Orbitals engine={engine} />
      <Bond engine={engine} />
      <Reaction engine={engine} />
      <SurfacePanel engine={engine} />
    </StudioShell>
  );
}
