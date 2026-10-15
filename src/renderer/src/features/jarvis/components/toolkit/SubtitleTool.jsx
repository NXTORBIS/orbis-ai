import { useMemo, useState } from 'react';
import { Captions } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow, downloadBlob } from './shared';

const pad = (value, size = 2) => String(value).padStart(size, '0');

const msToSrt = (ms) => {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
};

const msToVtt = (ms) => msToSrt(ms).replace(',', '.');

const parseTime = (text) => {
  const match = text.trim().match(/(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
  if (!match) return null;
  return Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number(match[4].padEnd(3, '0'));
};

const parseCues = (text) => {
  const clean = text.replace(/\r/g, '').replace(/^WEBVTT.*$/m, '').trim();
  if (!clean) return [];
  const blocks = clean.split(/\n{2,}/);
  const cues = [];
  blocks.forEach((block) => {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) return;
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex === -1) return;
    const [startRaw, endRaw] = lines[timeLineIndex].split('-->');
    const start = parseTime(startRaw);
    const end = parseTime(endRaw || '');
    const body = lines.slice(timeLineIndex + 1).join('\n').trim();
    if (start === null || end === null) return;
    cues.push({ start, end, text: body });
  });
  return cues.sort((a, b) => a.start - b.start);
};

const SAMPLE = `1
00:00:01,000 --> 00:00:04,200
Welcome back to the channel — today we are
looking at three tools you did not know you needed.

2
00:00:04,400 --> 00:00:07,000
The first one saves about an hour a week.

3
00:00:08,500 --> 00:00:12,000
<i>And yes, all of them are free.</i>`;

const stripTags = (text) => text.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '');

export default function SubtitleTool() {
  const [input, setInput] = useState(SAMPLE);
  const [format, setFormat] = useState('srt');
  const [shift, setShift] = useState('0');
  const [speed, setSpeed] = useState('100');
  const [minDuration, setMinDuration] = useState('1000');
  const [strip, setStrip] = useState(false);
  const [renumber, setRenumber] = useState(true);

  const cues = useMemo(() => parseCues(input), [input]);

  const output = useMemo(() => {
    if (!cues.length) return '';
    const shiftMs = (Number(shift) || 0) * 1000;
    const factor = (Number(speed) || 100) / 100;
    const minimum = Number(minDuration) || 0;

    const processed = cues.map((cue) => {
      const start = Math.max(0, cue.start * factor + shiftMs);
      let end = Math.max(0, cue.end * factor + shiftMs);
      if (end - start < minimum) end = start + minimum;
      return { start, end, text: strip ? stripTags(cue.text) : cue.text };
    });

    if (format === 'txt') return processed.map((cue) => stripTags(cue.text).replace(/\n/g, ' ')).join('\n');
    if (format === 'vtt') {
      return ['WEBVTT', '', ...processed.map((cue, index) => `${renumber ? `${index + 1}\n` : ''}${msToVtt(cue.start)} --> ${msToVtt(cue.end)}\n${cue.text}`)].join('\n\n');
    }
    return processed.map((cue, index) => `${renumber ? index + 1 : ''}\n${msToSrt(cue.start)} --> ${msToSrt(cue.end)}\n${cue.text}`.trim()).join('\n\n');
  }, [cues, shift, speed, minDuration, strip, renumber, format]);

  const stats = useMemo(() => {
    if (!cues.length) return { count: 0, duration: 0, longest: null, cps: [], gaps: 0 };
    const last = cues[cues.length - 1];
    const cps = cues.map((cue, index) => {
      const seconds = Math.max(0.1, (cue.end - cue.start) / 1000);
      const chars = stripTags(cue.text).replace(/\s+/g, ' ').trim().length;
      return { index: index + 1, cps: chars / seconds, chars, duration: cue.end - cue.start };
    });
    const gaps = cues.slice(1).filter((cue, index) => cue.start - cues[index].end > 1500).length;
    const longest = [...cps].sort((a, b) => b.duration - a.duration)[0];
    return { count: cues.length, duration: last.end, longest, cps, gaps };
  }, [cues]);

  const tooFast = stats.cps.filter((entry) => entry.cps > 20);
  const veryShort = stats.cps.filter((entry) => entry.duration < 1000);

  const report = [
    `${stats.count} cues · ${msToSrt(stats.duration)} long · exported as ${format.toUpperCase()}`,
    tooFast.length ? `${tooFast.length} cues read faster than 20 characters a second` : 'Reading speed is comfortable throughout',
    '',
    output,
  ].join('\n');

  return (
    <ToolShell
      toolId="subtitle-tool"
      icon={Captions}
      title="Subtitle Studio"
      desc="Convert between SRT, VTT and plain text, shift or re-time every cue, and catch the lines that flash past too fast to read."
      state={{ input, format, shift, speed, minDuration, strip, renumber }}
      onRestore={(restored) => {
        if (typeof restored.input === 'string') setInput(restored.input);
        if (restored.format) setFormat(restored.format);
        if (restored.shift !== undefined) setShift(String(restored.shift));
        if (restored.speed !== undefined) setSpeed(String(restored.speed));
        if (restored.minDuration !== undefined) setMinDuration(String(restored.minDuration));
        if (typeof restored.strip === 'boolean') setStrip(restored.strip);
        if (typeof restored.renumber === 'boolean') setRenumber(restored.renumber);
      }}
      exportText={output}
      exportName={format === 'txt' ? 'captions.txt' : format === 'vtt' ? 'captions.vtt' : 'captions.srt'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={format} onChange={setFormat} options={[{ value: 'srt', label: 'SRT' }, { value: 'vtt', label: 'WebVTT' }, { value: 'txt', label: 'Plain text' }]} />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([output], { type: 'text/plain' }), format === 'txt' ? 'captions.txt' : format === 'vtt' ? 'captions.vtt' : 'captions.srt')}
          disabled={!output}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          Download file
        </button>
        <CopyBtn value={output} label="Copy output" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Area label="Paste SRT, WebVTT or caption text" value={input} onChange={setInput} rows={14} mono />
        <Panel className="!p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{format.toUpperCase()} output</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{output || 'Nothing parsed yet — paste captions on the left.'}</pre>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Shift all cues (seconds)" hint="Negative moves them earlier">
          <input value={shift} onChange={(e) => setShift(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={`Speed · ${speed}%`}>
          <input type="range" min={80} max={120} step={1} value={speed} onChange={(e) => setSpeed(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Minimum cue length (ms)">
          <input value={minDuration} onChange={(e) => setMinDuration(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <div className="space-y-1 self-end">
          <ToggleRow label="Strip styling tags" checked={strip} onChange={setStrip} />
          <ToggleRow label="Renumber cues" checked={renumber} onChange={setRenumber} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Cues parsed"
          value={stats.count}
          sub={`${msToSrt(stats.duration)} of captions · ${tooFast.length ? `${tooFast.length} too fast to read comfortably` : 'every cue readable at normal speed'}`}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading speed (characters per second)</div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {stats.cps.slice(0, 14).map((entry) => (
              <div key={entry.index} className="flex items-center gap-2 text-[11px]">
                <span className="w-8 font-mono-j text-muted-foreground">#{entry.index}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${entry.cps > 20 ? 'bg-rose-400' : entry.cps > 17 ? 'bg-amber-400' : 'bg-cyan-j'}`}
                    style={{ width: `${Math.min(100, (entry.cps / 25) * 100)}%` }}
                  />
                </div>
                <span className={`w-12 text-right font-mono-j ${entry.cps > 20 ? 'text-rose-400' : 'text-muted-foreground'}`}>{entry.cps.toFixed(1)}</span>
              </div>
            ))}
            {!stats.cps.length && <span className="text-[11px] text-muted-foreground">Paste captions to see the reading-speed trace.</span>}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Aim for under 17 characters a second; above 20 is a subtitle people cannot finish.</p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Cues" value={String(stats.count)} mono />
        <Stat label="Longest cue" value={stats.longest ? `${(stats.longest.duration / 1000).toFixed(1)} s` : '—'} mono />
        <Stat label="Cues too fast" value={String(tooFast.length)} mono sub="over 20 characters a second" />
        <Stat label="Very short cues" value={String(veryShort.length)} mono sub="under a second on screen" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Timing and tidiness notes</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· {stats.gaps ? `${stats.gaps} gap${stats.gaps > 1 ? 's' : ''} longer than 1.5 seconds — fine for scene changes, suspicious anywhere else.` : 'Cue spacing is even with no long silent gaps.'}</p>
          <p>· Use a shift when captions arrive late as a block: shifting by a single number beats re-timing cue by cue.</p>
          <p>· Speeding all cues to {speed}% is the standard fix when captions drift progressively — it corrects a different frame-rate assumption in one step.</p>
          <p>· Keep two lines per cue and about 42 characters per line; a third line covers the picture and slows reading more than shortening does.</p>
          <p>· {tooFast.length ? `Split cue${tooFast.length > 1 ? 's' : ''} ${tooFast.map((entry) => `#${entry.index}`).slice(0, 6).join(', ')} across two cues to bring the reading speed down.` : 'Nothing needs splitting for reading speed.'}</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Format', value: format.toUpperCase() },
              { label: 'Shift', value: `${shift} s` },
              { label: 'Speed', value: `${speed}%` },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          SRT and WebVTT differ in only two ways that matter: VTT separates the millisecond part with a dot and starts with a WEBVTT line. Everything here
          runs in your browser, so nothing is uploaded — handy when the captions belong to an unreleased cut.
        </p>
      </Panel>
    </ToolShell>
  );
}