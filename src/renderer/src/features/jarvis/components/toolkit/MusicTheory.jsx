import { useMemo, useState } from 'react';
import { Music } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DEGREE = ['1', '2', '3', '4', '5', '6', '7'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const SIGNATURES = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F♯': 6, 'C♯': 7, F: -1, 'B♭': -2, 'E♭': -3, 'A♭': -4, 'D♭': -5, 'G♭': -6, 'C♭': -7,
};

const qualityOf = (intervals) => {
  const key = intervals.join(',');
  if (key === '0,4,7') return 'major';
  if (key === '0,3,7') return 'minor';
  if (key === '0,3,6') return 'diminished';
  if (key === '0,4,8') return 'augmented';
  return 'other';
};

const SUFFIX = { major: '', minor: 'm', diminished: 'dim', augmented: 'aug' };

export default function MusicTheory() {
  const [root, setRoot] = useState(1);
  const [scale, setScale] = useState('major');
  const [accidentals, setAccidentals] = useState('sharps');
  const [transposeBy, setTransposeBy] = useState('2');

  const notes = accidentals === 'flats' ? FLAT : SHARP;
  const steps = scale === 'major' ? MAJOR : MINOR;

  const result = useMemo(() => {
    const scaleNotes = steps.map((step) => (root + step) % 12);
    const chordRows = steps.map((_, degree) => {
      const indices = [degree, (degree + 2) % 7, (degree + 4) % 7].map((position) => (root + steps[position]) % 12);
      const rootNote = indices[0];
      const intervals = indices.map((value) => (value - rootNote + 12) % 12).sort((a, b) => a - b);
      const quality = qualityOf(intervals);
      return {
        degree,
        roman: scale === 'major' ? ROMAN[degree] : ROMAN[degree].toLowerCase(),
        label: scale === 'major' ? ROMAN[degree] : ROMAN[degree].toLowerCase(),
        triad: indices.map((value) => notes[value]).join(' '),
        rootName: notes[rootNote],
        quality,
        name: notes[rootNote] + SUFFIX[quality],
        symbol: (scale === 'major' ? (quality === 'major' ? ROMAN[degree] : quality === 'diminished' ? ROMAN[degree].toLowerCase() + '°' : ROMAN[degree].toLowerCase()) : (quality === 'minor' ? ROMAN[degree].toLowerCase() : quality === 'diminished' ? ROMAN[degree].toLowerCase() + '°' : ROMAN[degree])),
        intervals,
      };
    });

    const keyName = notes[root] + (scale === 'major' ? ' major' : ' natural minor');
    const relativeIndex = scale === 'major' ? (root + 9) % 12 : (root + 3) % 12;
    const relative = notes[relativeIndex] + (scale === 'major' ? ' natural minor' : ' major');
    const parallel = notes[root] + (scale === 'major' ? ' natural minor' : ' major');
    const sharps = SIGNATURES[SHARP[root]] !== undefined ? SIGNATURES[SHARP[root]] : 0;
    const transposeTarget = (root + (Number(transposeBy) || 0) + 120) % 12;

    return {
      scaleNotes, chordRows, keyName, relative, parallel, sharps,
      transposeTarget,
      transposeFrom: notes[root],
      transposeTo: notes[transposeTarget],
      semitones: steps,
      signatureText: sharps === 0
        ? 'no sharps or flats'
        : sharps > 0
          ? sharps + ' sharp' + (sharps === 1 ? '' : 's')
          : Math.abs(sharps) + ' flat' + (Math.abs(sharps) === 1 ? '' : 's'),
    };
  }, [root, scale, accidentals, transposeBy, notes, steps]);

  const report = useMemo(() => [
    result.keyName + ' — ' + result.signatureText,
    'Notes: ' + result.scaleNotes.map((value) => notes[value]).join(' · '),
    'Intervals from the root: ' + result.semitones.join(', ') + ' semitones',
    'Relative: ' + result.relative + ' · parallel: ' + result.parallel,
    '',
    ...result.chordRows.map((row) => row.label + ' (' + row.symbol + ') — ' + row.triad + ' · ' + row.quality),
  ].join('\n'), [result, notes]);

  const isBlack = (index) => [1, 3, 6, 8, 10].includes(index);

  return (
    <ToolShell
      toolId="music-theory"
      icon={Music}
      title="Scales, Keys & Chords"
      desc="Every major and minor scale with its key signature, diatonic triads, relative and parallel keys, a clickable circle of fifths and a transposition helper."
      state={{ root, scale, accidentals, transposeBy }}
      onRestore={(restored) => {
        if (restored.root !== undefined) setRoot(Number(restored.root) || 0);
        if (restored.scale) setScale(restored.scale);
        if (restored.accidentals) setAccidentals(restored.accidentals);
        if (restored.transposeBy !== undefined) setTransposeBy(String(restored.transposeBy));
      }}
      exportText={report}
      exportName="music-theory.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <Seg
            value={scale}
            onChange={setScale}
            options={[{ value: 'major', label: 'Major' }, { value: 'minor', label: 'Natural minor' }]}
          />
          <Seg
            value={accidentals}
            onChange={setAccidentals}
            options={[{ value: 'sharps', label: 'Sharps ♯' }, { value: 'flats', label: 'Flats ♭' }]}
          />
          <Field label="Root note">
            <select value={root} onChange={(e) => setRoot(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
              {SHARP.map((note, index) => <option key={note} value={index}>{FLAT[index]} / {note}</option>)}
            </select>
          </Field>
          <Field label="Transpose up or down by semitones">
            <input value={transposeBy} onChange={(e) => setTransposeBy(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
        </div>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Click a key on the circle of fifths</div>
          <svg viewBox="0 0 220 220" className="mx-auto w-full max-w-[260px]">
            {SHARP.map((note, index) => {
              const position = index * 7;
              const angle = (position / 12) * Math.PI * 2 - Math.PI / 2;
              const innerAngle = ((index * 7 + 9) / 12) * Math.PI * 2 - Math.PI / 2;
              const x = 110 + Math.cos(angle) * 86;
              const y = 110 + Math.sin(angle) * 86;
              const ix = 110 + Math.cos(innerAngle) * 56;
              const iy = 110 + Math.sin(innerAngle) * 56;
              return (
                <g key={note}>
                  <g onClick={() => { setRoot(index); setAccidentals('sharps'); }} className="cursor-pointer">
                    <circle cx={x} cy={y} r="19" className={index === root ? 'fill-cyan-j/20 stroke-[hsl(var(--cyan))]' : 'fill-transparent stroke-[hsl(var(--border))]'} strokeWidth="1.5" />
                    <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="currentColor">{note}</text>
                  </g>
                  <g onClick={() => { setRoot((index + 9) % 12); setAccidentals('sharps'); }} className="cursor-pointer">
                    <circle cx={ix} cy={iy} r="14" className="fill-transparent stroke-[hsl(var(--border))]" strokeWidth="1" opacity="0.7" />
                    <text x={ix} y={iy + 3.5} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.75">{SHARP[(index + 9) % 12]}m</text>
                  </g>
                </g>
              );
            })}
            <circle cx="110" cy="110" r="34" className="fill-transparent stroke-[hsl(var(--border))]" strokeDasharray="3 3" />
            <text x="110" y="108" textAnchor="middle" fontSize="10" fill="currentColor">{SHARP[root]}</text>
            <text x="110" y="120" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.7">{scale === 'major' ? 'major' : 'minor'}</text>
          </svg>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Outer ring is major, inner is relative minor. Neighbours on the circle differ by one sharp or flat, which is why keys next to each other sound so
            closely related.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.keyName}
          value={result.signatureText}
          sub={'Notes ' + result.scaleNotes.map((value) => notes[value]).join(' · ') + ' · relative ' + result.relative + ', parallel ' + result.parallel + '.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The scale on a keyboard</div>
          <div className="relative h-24">
            {SHARP.map((note, index) => {
              const white = !isBlack(index);
              const inScale = result.scaleNotes.includes(index);
              if (!white) return null;
              const whiteIndex = SHARP.slice(0, index + 1).filter((entry, position) => !isBlack(position)).length - 1;
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => setRoot(index)}
                  style={{ left: whiteIndex * 34 }}
                  className={inScale
                    ? 'absolute bottom-0 h-24 w-8 rounded-b-md border border-cyan-j bg-cyan-j/25 text-[9px] text-foreground'
                    : 'absolute bottom-0 h-24 w-8 rounded-b-md border border-border bg-card/60 text-[9px] text-muted-foreground'}
                >
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2">{note}</span>
                </button>
              );
            })}
            {SHARP.map((note, index) => {
              if (!isBlack(index)) return null;
              const whitesBefore = SHARP.slice(0, index).filter((entry, position) => !isBlack(position)).length;
              const inScale = result.scaleNotes.includes(index);
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => setRoot(index)}
                  style={{ left: whitesBefore * 34 - 10 }}
                  className={inScale
                    ? 'absolute top-0 z-10 h-14 w-5 rounded-b-md border border-cyan-j bg-cyan-j text-[8px] text-background'
                    : 'absolute top-0 z-10 h-14 w-5 rounded-b-md border border-border bg-slate-900 text-[8px] text-slate-400'}
                >
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2">{note.replace('♯', '')}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Highlighted keys are the notes of the scale. Click any key to make it the root.</p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The notes, degree by degree</div>
        <div className="grid grid-cols-7 gap-1.5">
          {result.scaleNotes.map((value, index) => (
            <div key={value + '-' + index} className="rounded-lg border border-border/60 bg-card/40 px-2 py-2 text-center">
              <div className="font-mono-j text-[10px] text-muted-foreground">{DEGREE[index]}</div>
              <div className="mt-0.5 text-sm">{notes[value]}</div>
              <div className="mt-0.5 font-mono-j text-[10px] text-cyan-j">+{result.semitones[index]}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The numbers under each note are semitones from the root. The pattern {result.semitones.join('–')} is what makes this a{' '}
          {scale === 'major' ? 'major scale' : 'natural minor scale'} — the same pattern starting on any note gives the same type of scale.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Chords built on each degree</span>
          <CopyBtn value={report} label="Copy the key" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Degree</th>
                <th className="py-1 text-left font-medium">Chord</th>
                <th className="py-1 text-left font-medium">Notes</th>
                <th className="py-1 text-right font-medium">Quality</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.chordRows.map((row) => (
                <tr key={row.degree} className="border-t border-border/50">
                  <td className="py-1 text-cyan-j">{row.symbol}</td>
                  <td className="py-1">{row.name}</td>
                  <td className="py-1 text-muted-foreground">{row.triad}</td>
                  <td className="py-1 text-right">{row.quality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          In a major key the pattern is always major, minor, minor, major, major, minor, diminished — I, ii, iii, IV, V, vi, vii°. The chords that carry the most
          weight are I, IV and V, which is why so much music is built from just three of them.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Transposing</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Root</span><span>{result.transposeFrom}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Shift</span><span>{transposeBy} semitones</span>
            </div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
              <span>New root</span><span className="text-cyan-j">{result.transposeTo}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Transposing means moving every note by the same interval, so the shape of the music survives and only the pitch changes. A shift of 12 semitones is an
            octave and sounds identical in isolation. Singers ask for a shift when a song sits too high or too low; instrumentalists ask when a key is awkward on
            their instrument — guitar players like E, A and D, and horn players often prefer flat keys.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Intervals from the root</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.semitones.map((value, index) => (
              <p key={value}>· Degree {DEGREE[index]} — {notes[result.scaleNotes[index]]}: {value} semitones from {notes[root]}{value === 0 ? ' (the root itself)' : ''}</p>
            ))}
            <p>· Any interval can be counted the same way, which is how a scale is transposed by ear rather than by note name.</p>
            <p>· {result.sharps === 0 ? 'This key has no accidentals — the easiest key to read at sight.' : 'This key carries ' + result.signatureText + ', which is what appears at the start of the staff.'}</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Key" value={result.keyName.split(' ')[0]} mono sub={scale === 'major' ? 'major' : 'minor'} />
        <Stat label="Signature" value={result.sharps === 0 ? '0' : String(Math.abs(result.sharps))} mono sub={result.signatureText} />
        <Stat label="Relative" value={result.relative.split(' ')[0]} mono sub="same notes" />
        <Stat label="Parallel" value={result.parallel.split(' ')[0]} mono sub="same root" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Using the theory</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Relative keys share every note: {result.keyName} and {result.relative} are the same set of pitches with a different home.</p>
          <p>· Parallel keys keep the root and change the third and sixth — the fastest way to make a bright piece sound suddenly serious.</p>
          <p>· Moving to a neighbour on the circle of fifths, like {SHARP[(root + 7) % 12]} major, shares six of seven notes and sounds like a small step rather than a leap.</p>
          <p>· A diminished triad on the seventh degree is unstable on purpose: it pulls strongly back to the tonic, which is why it usually appears just before the end.</p>
          <p>· The chord numbers let you talk about progressions without naming keys — I–V–vi–IV works in all twelve.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Key', value: result.keyName },
              { label: 'Notes', value: result.scaleNotes.map((value) => notes[value]).join(' ') },
              { label: 'Relative', value: result.relative },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Scales are built from the semitone pattern rather than from a table of note names, so the transposition and the chord qualities follow automatically.
          Key signatures come from the standard map, and the circle is drawn from the same data — every selection stays consistent across the tool.
        </p>
      </Panel>
    </ToolShell>
  );
}