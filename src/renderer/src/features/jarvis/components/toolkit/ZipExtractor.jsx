import { useState } from 'react';
import { Archive, Upload, Download, FileArchive } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, fmtBytes, downloadBlob, Unsupported } from './shared';

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflate(raw) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no-inflate');
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter(); writer.write(raw); writer.close();
  const reader = ds.readable.getReader(); const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
  const out = new Uint8Array(total); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export default function ZipExtractor() {
  const [entries, setEntries] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(null); setBusy(true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const list = [];
      let offset = 0;
      while (offset < buf.length - 4) {
        if (u32(buf, offset) !== 0x04034b50) break;
        const nameLen = u16(buf, offset + 26), extraLen = u16(buf, offset + 28);
        const method = u16(buf, offset + 8), compSize = u32(buf, offset + 20), uncompSize = u32(buf, offset + 24);
        const name = new TextDecoder().decode(buf.subarray(offset + 30, offset + 30 + nameLen));
        const dataStart = offset + 30 + nameLen + extraLen;
        const compressed = buf.subarray(dataStart, dataStart + compSize);
        list.push({ name, method, compSize, uncompSize, compressed });
        offset = dataStart + compSize;
      }
      setEntries(list);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  const extract = async (entry) => {
    let data;
    if (entry.method === 0) data = entry.compressed;
    else if (entry.method === 8) { try { data = await inflate(entry.compressed); } catch { setErr('Deflate needs DecompressionStream support.'); return; } }
    else { setErr(`Unsupported compression method ${entry.method}`); return; }
    downloadBlob(new Blob([data]), entry.name.split('/').pop() || 'extracted');
  };

  const extractAll = async () => {
    for (const entry of entries) { if (!entry.name.endsWith('/')) { await extract(entry); await new Promise((r) => setTimeout(r, 150)); } }
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={FileArchive} title="ZIP Extractor" desc="Preview and extract files from a ZIP archive — fully in-browser. Supports store and deflate entries." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Choose ZIP</Button>
        <input type="file" accept=".zip,application/zip" onChange={onFile} className="hidden" />
      </label>
      {busy && <div className="text-sm text-muted-foreground">Reading archive…</div>}
      {err && <Unsupported msg={err} />}
      {entries.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={extractAll} className="gap-1.5"><Download className="h-4 w-4" /> Extract all</Button></div>
          {entries.map((en, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-sm">
              <span className="truncate">{en.name}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">{fmtBytes(en.uncompSize)}
                {!en.name.endsWith('/') && <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => extract(en)}><Download className="h-3.5 w-3.5" /></Button>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}