import { useState } from 'react';
import { Archive, Upload, Download, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, downloadBlob, fmtBytes } from './shared';

// Minimal STORE-mode (no compression) ZIP writer with CRC32.
const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function strBytes(s) { return new TextEncoder().encode(s); }
function u16(n) { return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]); }
function u32(n) { return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]); }
function dosTime(d) { return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (d.getSeconds() / 2) & 0x1f; }
function dosDate(d) { return (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | d.getDate() & 0x1f; }

export default function ZipCreator() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    const list = Array.from(e.target.files || []);
    const items = await Promise.all(list.map(async (f) => ({ name: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()), size: f.size })));
    setFiles((p) => [...p, ...items]);
    e.target.value = '';
  };
  const remove = (i) => setFiles((p) => p.filter((_, x) => x !== i));

  const build = async () => {
    setBusy(true);
    const chunks = []; let offset = 0; const central = [];
    for (const f of files) {
      const nameBytes = strBytes(f.name); const crc = crc32(f.data);
      const local = [u16(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime(new Date())), u16(dosDate(new Date())), u32(crc), u32(f.data.length), u32(f.data.length), u16(nameBytes.length), u16(0)];
      const localLen = local.reduce((a, p) => a + p.length, 0) + nameBytes.length + f.data.length;
      const localBuf = new Uint8Array(localLen); let p = 0;
      [...local, nameBytes, f.data].forEach((b) => { localBuf.set(b, p); p += b.length; });
      chunks.push(localBuf);
      central.push({ name: nameBytes, crc, size: f.data.length, offset });
      offset += localLen;
    }
    const centralChunks = [];
    for (const c of central) {
      const rec = [u16(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime(new Date())), u16(dosDate(new Date())), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)];
      const buf = new Uint8Array(rec.reduce((a, x) => a + x.length, 0) + c.name.length); let pp = 0;
      [...rec, c.name].forEach((b) => { buf.set(b, pp); pp += b.length; });
      centralChunks.push(buf);
    }
    const centralSize = centralChunks.reduce((a, b) => a + b.length, 0);
    const centralOffset = offset;
    const end = [u16(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(centralOffset), u16(0)];
    const total = chunks.reduce((a, b) => a + b.length, 0) + centralSize + end.reduce((a, x) => a + x.length, 0);
    const out = new Uint8Array(total); let pos = 0;
    [...chunks, ...centralChunks, ...end].forEach((b) => { out.set(b, pos); pos += b.length; });
    downloadBlob(new Blob([out], { type: 'application/zip' }), 'archive.zip');
    setBusy(false);
  };

  const total = files.reduce((a, f) => a + f.size, 0);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Archive} title="ZIP Creator" desc="Bundle multiple files into a ZIP archive — entirely in your browser, no upload." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Add files</Button>
        <input type="file" multiple onChange={add} className="hidden" />
      </label>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-sm">
              <span className="truncate">{f.name}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">{fmtBytes(f.size)}<button onClick={() => remove(i)}><X className="h-3.5 w-3.5 hover:text-red-500" /></button></span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{files.length} files · {fmtBytes(total)}</span>
            <Button size="sm" onClick={build} disabled={busy} className="gap-1.5"><Download className="h-4 w-4" /> {busy ? 'Building…' : 'Create ZIP'}</Button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Uses store (no-compression) mode — ideal for already-compressed files. Filenames are preserved.</p>
    </div>
  );
}