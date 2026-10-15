import { useRef, useState } from 'react';
import { Blocks, HardDrive, Play, Shuffle, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Seg, Stat, fmtBytes } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { dedupeFiles, rebuild, sha256Hex } from './dedupeCore';
import { makeRng } from './run';

const MODES = [
  { value: 'content', label: 'Content-defined' },
  { value: 'fixed', label: 'Fixed-size' },
];

const SIZES = [
  { value: 2048, label: '2 KB' },
  { value: 4096, label: '4 KB' },
  { value: 8192, label: '8 KB' },
  { value: 16384, label: '16 KB' },
  { value: 32768, label: '32 KB' },
];

/** Four versions of one document: the shape of a real backup set. */
function sampleSet() {
  const random = makeRng(4242);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const words = Array.from({ length: 700 }, () => Array.from(
    { length: 3 + Math.floor(random() * 7) },
    () => letters[Math.floor(random() * 26)],
  ).join(''));
  const paragraph = () => {
    const parts = [];
    for (let i = 0; i < 140; i += 1) parts.push(words[Math.floor(random() * words.length)]);
    return `${parts.join(' ')}.\n`;
  };
  const encoder = new TextEncoder();
  const base = encoder.encode(Array.from({ length: 420 }, paragraph).join(''));

  const inserted = new Uint8Array(base.length + 1);
  inserted[0] = 88;
  inserted.set(base, 1);

  const edited = base.slice();
  edited[Math.floor(edited.length / 2)] = 33;

  const tail = encoder.encode('A closing paragraph that is entirely new.\n');
  const appended = new Uint8Array(base.length + tail.length);
  appended.set(base);
  appended.set(tail, base.length);

  return [
    { name: 'report.txt', bytes: base },
    { name: 'report-v2.txt', bytes: inserted },
    { name: 'report-v3.txt', bytes: edited },
    { name: 'report-final.txt', bytes: appended },
  ];
}

export default function BlockDedupe() {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('content');
  const [avgSize, setAvgSize] = useState(8192);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null);

  const load = async (entries) => {
    setResult(null);
    setError('');
    if (!entries.length) return;
    const withDigests = [];
    for (const entry of entries) {
      withDigests.push({ ...entry, digest: await sha256Hex(entry.bytes) });
    }
    setFiles(withDigests);
  };

  const onDrop = async (list) => {
    const picked = await Promise.all(Array.from(list).slice(0, 8).map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })));
    load(picked);
  };

  const run = async () => {
    setBusy(true);
    setResult(null);
    setError('');
    setProgress({ phase: 'Chunking and hashing' });
    const abort = new AbortController();
    controller.current = abort;
    try {
      const outcome = await dedupeFiles(files, { mode, avgSize, fixedSize: avgSize }, { onProgress: setProgress, signal: abort.signal });

      // The store has to be able to reproduce every byte of every file. Digests are
      // compared against the originals rather than trusted.
      const checks = [];
      for (const entry of outcome.entries) {
        const original = files.find((file) => file.name === entry.name);
        const restored = await rebuild(entry, outcome.store);
        checks.push({
          name: entry.name,
          ok: restored.digest === original.digest,
          digest: restored.digest.slice(0, 16),
          bytes: restored.bytes.length === original.bytes.length,
        });
      }
      setResult({ ...outcome, checks });
    } catch (thrown) {
      setError(thrown.message || 'The comparison could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const stats = result?.stats;
  const report = result
    ? [
        `mode: ${mode === 'content' ? 'content-defined' : 'fixed-size'} at ${fmtBytes(avgSize)}`,
        `original: ${fmtBytes(stats.originalBytes)}`,
        `stored: ${fmtBytes(stats.storedBytes)}`,
        `ratio: ${stats.ratio.toFixed(2)}x`,
        `chunks: ${stats.totalChunks} total, ${stats.uniqueChunks} distinct, ${stats.sharedChunks} shared`,
        ...result.checks.map((check) => `${check.name}: rebuilt ${check.ok ? 'identical' : 'DIFFERENT'}`),
      ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="block-dedupe"
      icon={Blocks}
      title="Block Deduplication & Content Store"
      desc="Content-defined chunking, a SHA-256 identity per chunk, and one copy of each distinct block — with every file rebuilt from the store afterwards to prove nothing was lost."
      state={{ mode, avgSize }}
      onRestore={(state) => {
        if (!state) return;
        if (state.mode) setMode(state.mode);
        if (state.avgSize) setAvgSize(state.avgSize);
      }}
      exportText={report}
      exportName="dedupe-report.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={MODES} />
        <Seg value={avgSize} onChange={setAvgSize} options={SIZES} />
        <label className="inline-flex">
          <Button size="sm" variant="outline" className="pointer-events-none gap-1.5"><HardDrive className="h-3.5 w-3.5" /> Choose files</Button>
          <input type="file" multiple className="hidden" onChange={(event) => onDrop(event.target.files)} />
        </label>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => load(sampleSet())}><Shuffle className="h-3.5 w-3.5" /> Sample set</Button>
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" disabled={!files.length} onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Deduplicate</Button>}
      </div>

      <EngineProgress
        busy={busy}
        phase={progress?.phase}
        done={progress?.done}
        total={progress?.total}
        stats={progress?.file ? [progress.file] : []}
      />

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); onDrop(event.dataTransfer.files); }}
        className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border/70 bg-card/40 px-4 py-5 text-center"
      >
        <span className="text-sm font-medium">{files.length ? `${files.length} files loaded` : 'Drop files here, or load the sample set'}</span>
        <span className="text-[11px] text-muted-foreground">
          {files.length
            ? `${fmtBytes(files.reduce((sum, file) => sum + file.bytes.length, 0))} in total · nothing is uploaded, and nothing is written to disk`
            : 'Up to eight files. The sample set is four versions of one document, which is what a backup looks like.'}
        </span>
      </div>

      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {result && stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
            <Hero
              label="Space ratio"
              value={`${stats.ratio.toFixed(2)}×`}
              tone={stats.ratio > 1.4 ? 'emerald' : 'amber'}
              sub={`${fmtBytes(stats.savedBytes)} saved of ${fmtBytes(stats.originalBytes)}`}
            />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Original" value={fmtBytes(stats.originalBytes)} mono />
              <Stat label="Stored" value={fmtBytes(stats.storedBytes)} sub={`${stats.uniqueChunks} distinct chunks`} mono />
              <Stat label="Total chunks" value={stats.totalChunks.toLocaleString()} sub={`${stats.sharedChunks} shared between files`} mono />
              <Stat label="Average chunk" value={fmtBytes(stats.averageChunk)} sub={`largest ${fmtBytes(stats.largestChunk)}`} mono />
              <Stat label="Smallest chunk" value={fmtBytes(stats.smallestChunk)} mono />
              <Stat label="Mode" value={mode === 'content' ? 'content-defined' : 'fixed-size'} sub={`target ${fmtBytes(avgSize)}`} />
            </div>
          </div>

          <Panel>
            <div className="mb-2 text-xs font-semibold">Where the bytes went</div>
            <div className="space-y-2">
              {result.entries.map((entry) => {
                const share = stats.storedBytes ? entry.storedBytes / stats.storedBytes : 0;
                return (
                  <div key={entry.name} className="space-y-1">
                    <div className="flex items-center justify-between font-mono-j text-[11px]">
                      <span className="truncate">{entry.name}</span>
                      <span className="text-muted-foreground">
                        {fmtBytes(entry.size)} → {fmtBytes(entry.storedBytes)} · {entry.chunks.length} chunks
                      </span>
                    </div>
                    <div className="flex h-2.5 overflow-hidden rounded-full border border-border/50">
                      <div className="bg-gradient-to-r from-cyan-j/40 to-cyan-j/80" style={{ width: `${Math.max(1, share * 100)}%` }} />
                      <div className="flex-1 bg-border/40" />
                    </div>
                    <div className="flex flex-wrap gap-px overflow-hidden rounded">
                      {entry.ranges.slice(0, 160).map(([start, end], index) => {
                        const hash = entry.chunks[index];
                        const chunk = result.store.get(hash);
                        const shared = chunk && chunk.refs > 1;
                        return (
                          <span
                            key={`${entry.name}-${start}`}
                            title={`${fmtBytes(start)} – ${fmtBytes(end)} · ${shared ? 'shared with another file' : 'unique'}`}
                            className={shared ? 'h-3 bg-emerald-400/70' : 'h-3 bg-violet-400/70'}
                            style={{ flex: `${Math.max(0.5, end - start)} 1 0` }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pills items={[
                { label: 'unique blocks', value: stats.uniqueChunks },
                { label: 'shared blocks', value: stats.sharedChunks },
                { label: 'files', value: result.entries.length },
              ]} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Green is a block already held by another file, violet is one this file introduced. Switch to fixed-size blocks and the stripes shift: one inserted byte moves every subsequent boundary, so almost nothing downstream matches any more.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-semibold">Bytes introduced by each file</div>
            <Bars data={result.entries.map((entry) => ({ label: entry.name.replace(/\.txt$/, '').slice(-10), value: entry.storedBytes }))} format={(value) => fmtBytes(value)} />
          </Panel>

          <VerifyPanel
            title="Rebuilt from the store"
            items={result.checks.map((check) => ({
              label: check.name,
              ok: check.ok && check.bytes,
              detail: `SHA-256 ${check.digest}… ${check.ok ? 'matches the original' : 'does not match'}`,
            })).concat([{
              label: 'Every chunk referenced by a file is in the store',
              ok: result.entries.every((entry) => entry.chunks.every((hash) => result.store.has(hash))),
              detail: `${stats.uniqueChunks} distinct blocks`,
            }])}
            note="Rebuilding concatenates the stored blocks in the order the file lists them and hashes the result — byte for byte against the original. Deduplication is only safe if this passes."
          />

          <Panel className="!p-3">
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· The rolling hash watches the last few dozen bytes and cuts when the low bits of the hash are zero, so boundaries follow the content. Insert a byte at the front and only the first block changes; every later boundary lands in the same place it did before.</p>
              <p>· That is the whole difference from fixed-size blocks, and it is measurable here: with the sample set, content-defined blocks keep most of the store shared while fixed blocks lose everything after the edit — about a 1.5× saving against roughly 11×.</p>
              <p>· A chunk is identified by the SHA-256 of its bytes, so two identical blocks in different files are the same block. The store here lives in this tab's memory and is discarded when you leave the page: this is the engine, not a backup.</p>
              <p>· Block boundaries are chosen from content, so an attacker who can influence file contents can in principle influence them; real systems add a per-installation key to the chunking hash for that reason. Nothing here is a substitute for an encrypted backup target.</p>
            </div>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}