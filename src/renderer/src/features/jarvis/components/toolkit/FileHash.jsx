import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldCheck, Upload, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Field, Panel, Stat, fmtBytes, readFileAsArrayBuffer } from './shared';
import { md5Hex } from './md5';

const WEB_ALGOS = ['SHA-1', 'SHA-256', 'SHA-512'];
const ALL_ALGOS = ['MD5', ...WEB_ALGOS];
const BY_LENGTH = { 32: 'MD5', 40: 'SHA-1', 64: 'SHA-256', 128: 'SHA-512' };
const LARGE_FILE = 200 * 1024 * 1024;

const toHex = (buffer) => Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const tidy = (value) => String(value || '').toLowerCase().replace(/[^0-9a-f]/g, '');

export default function FileHash() {
  const [file, setFile] = useState(null);
  const [hashes, setHashes] = useState({});
  const [expected, setExpected] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const run = async (picked) => {
    if (!picked) return;
    setFile(picked);
    setHashes({});
    setError('');
    setLoading(true);
    try {
      const buffer = await readFileAsArrayBuffer(picked);
      const out = { MD5: md5Hex(new Uint8Array(buffer)) };
      for (const algo of WEB_ALGOS) {
        try {
          out[algo] = toHex(await crypto.subtle.digest(algo, buffer));
        } catch {
          out[algo] = 'unsupported';
        }
      }
      setHashes(out);
    } catch {
      setError('That file could not be read. Hashing loads the whole file into memory, so a very large video or disk image may be too big for the browser.');
    }
    setLoading(false);
  };

  const verdict = useMemo(() => {
    const clean = tidy(expected);
    if (!clean) return null;
    const algo = BY_LENGTH[clean.length];
    if (!algo) return { algo: null, clean };
    const computed = hashes[algo];
    return {
      algo,
      clean,
      computed,
      match: computed && computed !== 'unsupported' ? computed.toLowerCase() === clean : null,
    };
  }, [expected, hashes]);

  const all = ALL_ALGOS.map((algo) => `${algo}: ${hashes[algo] || ''}`).join('\n');

  return (
    <div className="space-y-4">
      <label
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); run(event.dataTransfer.files?.[0]); }}
        className={dragging
          ? 'flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-cyan-j/70 bg-cyan-j/5 px-4 py-8 text-center'
          : 'flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-border/70 bg-card/40 px-4 py-8 text-center transition hover:border-cyan-j/50'}
      >
        <Upload className="h-5 w-5 text-cyan-j" />
        <span className="text-sm font-medium">Drop a file here, or choose one</span>
        <span className="text-[11px] text-muted-foreground">It is read and hashed inside this tab. Nothing is uploaded anywhere.</span>
        <input type="file" onChange={(event) => run(event.target.files?.[0])} className="hidden" />
      </label>

      {file && !loading && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="File" value={file.name} sub={fmtBytes(file.size)} />
          <Stat label="Last modified" value={file.lastModified ? new Date(file.lastModified).toLocaleString() : '—'} />
          <Stat label="Algorithms computed" value={Object.keys(hashes).length + ' of ' + ALL_ALGOS.length} mono />
        </div>
      )}

      {file && file.size > LARGE_FILE && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This file is {fmtBytes(file.size)}. Reading it whole can exhaust the tab’s memory — if it stalls, a command-line tool will handle it more comfortably.</span>
        </div>
      )}

      {loading && <div className="text-sm text-muted-foreground">Reading the file and computing hashes…</div>}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-400">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Field label="Published checksum" hint="Paste the hash the download page gives you. The algorithm is worked out from its length, and it is compared as soon as it matches something already computed.">
          <div className="flex gap-2">
            <input
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
              placeholder="e.g. 900150983cd24fb0d6963f7d28e17f72"
              spellCheck={false}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
            />
            {expected && (
              <Button size="sm" variant="outline" onClick={() => setExpected('')} className="gap-1.5"><X className="h-3.5 w-3.5" /> Clear</Button>
            )}
          </div>
        </Field>

        <div className="flex items-end">
          {!verdict && (
            <div className="w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground">
              Paste a checksum to check the file against it. Without one, the hashes below are still there to compare by eye.
            </div>
          )}
          {verdict && !verdict.algo && (
            <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-500">
              {verdict.clean.length} hex characters is not a checksum length this tool knows — 32 for MD5, 40 for SHA-1, 64 for SHA-256, 128 for SHA-512.
            </div>
          )}
          {verdict && verdict.algo && verdict.match === null && (
            <div className="w-full rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground">
              That looks like {verdict.algo}. {file ? (hashes[verdict.algo] ? 'This browser cannot compute it.' : 'Waiting for the hash to finish…') : 'Choose a file to compare.'}
            </div>
          )}
          {verdict && verdict.algo && verdict.match === true && (
            <div className="flex w-full items-start gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>The {verdict.algo} matches. This file is byte-for-byte the one that checksum describes — the download arrived intact.</span>
            </div>
          )}
          {verdict && verdict.algo && verdict.match === false && (
            <div className="flex w-full items-start gap-2 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400">
              <X className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Does not match the {verdict.algo}. The file is corrupted, truncated, or simply a different build from the one that checksum belongs to.</span>
            </div>
          )}
        </div>
      </div>

      {Object.keys(hashes).length > 0 && (
        <div className="space-y-2">
          {ALL_ALGOS.map((algo) => {
            const matched = verdict?.algo === algo && verdict.match === true;
            const failed = verdict?.algo === algo && verdict.match === false;
            return (
              <div
                key={algo}
                className={matched
                  ? 'rounded-lg border border-emerald-500/50 bg-emerald-500/5 p-3'
                  : failed
                    ? 'rounded-lg border border-rose-500/50 bg-rose-500/5 p-3'
                    : 'rounded-lg border border-border/70 bg-card/60 p-3'}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-cyan-j">
                    {algo}
                    {matched && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    {failed && <X className="h-3.5 w-3.5 text-rose-400" />}
                  </span>
                  <CopyBtn value={hashes[algo]} />
                </div>
                <div className="mt-1 break-all font-mono-j text-xs">{hashes[algo] || '—'}</div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <CopyBtn value={all} label="Copy every hash" />
          </div>
        </div>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· A match proves the bytes are identical to the ones the publisher hashed. A mismatch almost always means an interrupted download, a proxy that rewrote the file, or a checksum belonging to a different release.</p>
          <p>· MD5 is perfectly good for spotting corruption, and it is what many download pages still publish. It is not a security guarantee: deliberate collisions are easy to construct, so if the checksum exists to prove nothing was tampered with, use the SHA-256 value.</p>
          <p>· Case and stray spaces are ignored, so an uppercase checksum from a webpage compares correctly. What is not ignored is a different release: version 2 and version 2.1 have entirely different hashes.</p>
          <p>· Web Crypto computes SHA-1, SHA-256 and SHA-512 natively and quickly. MD5 has no browser equivalent, so it is computed in JavaScript here — accurate, but slower on large files.</p>
          <p>· Every hash is calculated from the file as it exists on disk right now, in this tab. The file itself is never sent anywhere.</p>
        </div>
      </Panel>
    </div>
  );
}