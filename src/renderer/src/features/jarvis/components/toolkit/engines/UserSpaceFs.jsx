import { useMemo, useState } from 'react';
import { FolderTree, Play, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Area, CopyBtn, Field, Panel, Seg, Stat, downloadBlob } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { createImage, fsCheck, fsMkdir, fsRead, fsRename, fsSerialize, fsSnapshot, fsUnlink, fsWrite, runWorkload } from './usfsCore';

const SIZES = [
  { value: 'small', label: '256 KB image' },
  { value: 'large', label: '2 MB image' },
];

const buildImage = (size) => createImage(size === 'large' ? { blocks: 640, inodes: 128 } : { blocks: 64, inodes: 32 });

const parseRows = (rows) => rows.map((row) => {
  const [path, type, size, hash] = row.split('|');
  return { path, type, size: Number(size), hash: hash ?? '' };
});

export default function UserSpaceFs() {
  const [size, setSize] = useState('small');
  const [fs, setFs] = useState(() => buildImage('small'));
  const [tick, setTick] = useState(0);
  const [path, setPath] = useState('/notes.txt');
  const [content, setContent] = useState('A file written straight into the image.');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [stress, setStress] = useState(null);
  const [controller] = useState(() => ({ current: null }));

  const rows = useMemo(() => parseRows(fsSnapshot(fs)), [fs, tick]);
  const check = useMemo(() => fsCheck(fs), [fs, tick]);
  const listing = rows.filter((row) => row.path !== '/');
  const capacity = fs.blockCount * fs.blockSize;

  const act = (run) => {
    try {
      run();
      setMessage('');
      setTick((value) => value + 1);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const format = () => act(() => {
    setFs(buildImage(size));
    setStress(null);
  });

  const write = () => act(() => {
    const bytes = new TextEncoder().encode(content);
    fsWrite(fs, path, bytes);
  });

  const makeDir = () => act(() => fsMkdir(fs, path));

  const remove = () => act(() => fsUnlink(fs, path, { recursive: true }));

  const rename = () => act(() => {
    const target = path.replace(/([^/]*)$/, (name) => `moved-${name}`);
    fsRename(fs, path, target);
    setPath(target);
  });

  const runStress = async () => {
    setBusy(true);
    setStress(null);
    setProgress({ phase: 'Running the operation sequence' });
    const abort = new AbortController();
    controller.current = abort;
    const steps = 120;
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const outcome = runWorkload({ seed: Math.floor(Math.random() * 100000), steps });
      setFs(outcome.fs ?? buildImage(size));
      setStress(outcome);
    } catch (error) {
      setMessage(error.message);
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const exportText = [
    `image ${fs.blockCount} blocks × ${fs.blockSize} bytes = ${Math.round(capacity / 1024)} KB`,
    `used ${check.stats.usedBlocks} blocks, free ${check.stats.freeBlocks}`,
    ...listing.map((row) => `${row.path} — ${row.type === 'dir' ? 'directory' : `${row.size} bytes (${row.hash})`}`),
  ].join('\n');

  return (
    <ToolShell
      toolId="user-space-fs"
      icon={FolderTree}
      title="User-Space Filesystem Engine"
      desc="A real filesystem layout — superblock, block bitmap, inode table, direct and indirect block maps, directory entries — that serialises to a byte image, with an fsck and a model-based differential test."
      state={{ size, path, content }}
      onRestore={(state) => {
        if (!state) return;
        if (state.size) setSize(state.size);
        if (state.path) setPath(state.path);
        if (state.content) setContent(state.content);
      }}
      exportText={exportText}
      exportName="filesystem-listing.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={size} onChange={(value) => { setSize(value); setFs(buildImage(value)); setStress(null); }} options={SIZES} />
        <Button size="sm" variant="outline" onClick={format} className="gap-1.5"><Shuffle className="h-3.5 w-3.5" /> Format image</Button>
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={runStress} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Run 120-operation stress test</Button>}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => downloadBlob(new Blob([fsSerialize(fs)], { type: 'application/octet-stream' }), 'image.usfs')}
        >
          Download image
        </Button>
      </div>

      <EngineProgress busy={busy} phase={progress?.phase} />

      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <Field label="Path" hint="Directories are created with mkdir; a nested path needs its parent to exist.">
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
            />
          </Field>
          <Field label="File contents" hint="Written through the block allocator — eight direct pointers first, then a single indirect block.">
            <Area value={content} onChange={setContent} rows={4} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={write} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Write file</Button>
            <Button size="sm" variant="outline" onClick={makeDir} className="gap-1.5">mkdir</Button>
            <Button size="sm" variant="outline" onClick={rename} className="gap-1.5">Rename</Button>
            <Button size="sm" variant="outline" onClick={remove} className="gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => act(() => { const bytes = fsRead(fs, path); setContent(new TextDecoder().decode(bytes.subarray(0, 2000))); })}
            >
              Read back
            </Button>
          </div>
          {message && <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">{message}</div>}
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <Hero label="Blocks in use" value={check.stats.usedBlocks} unit="blocks" tone={check.ok ? 'emerald' : 'amber'} sub={`${check.stats.freeBlocks} free of ${fs.blockCount}`} />
            <div className="grid gap-2">
              <Stat label="Live inodes" value={check.stats.liveInodes} sub={`${check.stats.directories} dirs · ${check.stats.files} files`} mono />
              <Stat label="Reachable blocks" value={check.stats.referencedBlocks} sub={`${check.stats.orphans} orphans · ${check.stats.crossLinks} cross-links`} mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Directory tree ({listing.length} entries)</span>
              <CopyBtn value={listing.map((row) => `${row.path} ${row.type} ${row.size}`).join('\n')} />
            </div>
            <div className="max-h-64 space-y-1 overflow-auto scrollbar-thin">
              {listing.map((row) => (
                <button
                  key={row.path}
                  type="button"
                  onClick={() => setPath(row.path)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left font-mono-j text-[11px] hover:bg-accent/40"
                >
                  <span className="truncate">{row.path}</span>
                  <span className="shrink-0 text-muted-foreground">{row.type === 'dir' ? 'dir' : `${row.size}b`}</span>
                </button>
              ))}
              {!listing.length && <div className="text-xs text-muted-foreground">The image holds only its root directory.</div>}
            </div>
          </Panel>

          <Pills items={[
            { label: 'image', value: `${Math.round(capacity / 1024)} KB` },
            { label: 'block', value: `${fs.blockSize} B` },
            { label: 'inodes', value: fs.inodeCount },
            { label: 'generation', value: fs.generation },
          ]} />
        </div>
      </div>

      {stress && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero label="Divergences from the reference model" value={stress.mismatches} tone={stress.mismatches ? 'amber' : 'emerald'} sub={`${stress.operationsApplied} operations, ${stress.rejected} rejected`} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="fsck on the live image" value={stress.check.ok ? 'clean' : `${stress.check.totalProblems} problems`} mono />
              <Stat label="After write and reopen" value={stress.afterReopen.ok ? 'clean' : `${stress.afterReopen.totalProblems} problems`} mono />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-semibold">Filesystem usage</div>
            <Bars
              data={[
                { label: 'metadata', value: fs.dataStart },
                { label: 'in use', value: stress.check.stats.usedBlocks - fs.dataStart },
                { label: 'free', value: stress.check.stats.freeBlocks },
              ]}
            />
          </Panel>

          <VerifyPanel
            items={[
              { label: 'Every operation matches the reference model', ok: stress.mismatches === 0, detail: stress.firstMismatch ? `first difference after ${stress.firstMismatch.label}` : '' },
              { label: 'Structural check passes on the live image', ok: stress.check.ok, detail: stress.check.problems[0] ?? '' },
              { label: 'Image serialises and reopens identically', ok: stress.roundTrip.identical, detail: `${stress.roundTrip.filesCompared} entries compared` },
              { label: 'Reopened image passes its own check', ok: stress.roundTrip.checkClean, detail: stress.roundTrip.problems[0] ?? '' },
              { label: 'No blocks leaked by rejected operations', ok: stress.check.stats.orphans === 0 && stress.check.stats.crossLinks === 0, detail: `${stress.check.stats.orphans} orphans, ${stress.check.stats.crossLinks} cross-links` },
            ]}
            note="The fsck re-derives the bitmap, link counts, reachability and block ownership from the structure itself; the differential test runs the same operations against a plain Map and compares every path, size and content digest after each step."
          />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Block 0 holds the superblock, then the block bitmap, then the inode table, then data. An inode addresses its data through eight direct block numbers plus a single indirect block of {fs.blockSize / 4} more.</p>
          <p>· Directories are ordinary files of fixed 32-byte entries, so <span className="font-mono-j">.</span> and <span className="font-mono-j">..</span> are real entries and link counts follow from them.</p>
          <p>· Every rejected operation rolls back: a write that runs out of space frees its blocks and its inode rather than leaving an orphan for the fsck to find.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}